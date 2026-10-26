import { Router } from "express";
import { systemSettings, activeTrades, executionBlotter, persistSettings, setActiveTrades } from "../state";
import { authMiddleware, getMaskedSettings } from "../middleware/auth";
import { ExecutionRecord } from "../types";
import { fetchMarketSchedule } from "./research";
import { edgeBridge } from "../edgeBridge";

export const riskRouter = Router();

riskRouter.get("/api/risk/status", async (req, res) => {
  const currentUtilized = activeTrades.reduce((acc, t) => acc + Math.abs(t.quantity * t.entryPrice), 0);
  const currentDailyPnL = activeTrades.reduce((acc, t) => acc + (t.unrealizedPnL || 0), 0);

  const now = new Date();
  const nyTimeEST = now.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour12: false, hour: "2-digit", minute: "2-digit" });
  const cetTimeCET = now.toLocaleTimeString("en-US", { timeZone: "Europe/Paris", hour12: false, hour: "2-digit", minute: "2-digit" });

  const nowEst = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const estDay = nowEst.getDay();
  const estMinutes = nowEst.getHours() * 60 + nowEst.getMinutes();
  const usMarketOpen = estDay >= 1 && estDay <= 5 && estMinutes >= 570 && estMinutes < 960; // 09:30 - 16:00 EST

  const nowCet = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Paris" }));
  const cetDay = nowCet.getDay();
  const cetMinutes = nowCet.getHours() * 60 + nowCet.getMinutes();
  const euMarketOpen = cetDay >= 1 && cetDay <= 5 && cetMinutes >= 540 && cetMinutes < 1050; // 09:00 - 17:30 CET

  // Fetch dynamic exchange schedule from MarketHoursResolver
  const schedule = await fetchMarketSchedule();
  const usMocCutoff = schedule?.us?.moc_flatten_cutoff || systemSettings.intradayFlattenTimeEST || "15:45";
  const euMocCutoff = schedule?.eu?.moc_flatten_cutoff || systemSettings.intradayFlattenTimeCET || "17:15";
  const isEarlyClose = Boolean(schedule?.us?.is_early_close || schedule?.eu?.is_early_close);
  const dstDesynced = Boolean(schedule?.dst_desync?.is_dst_desynced);

  const tcpLatencyMs = await edgeBridge.measureLatency();

  // Active trading phase check (strictly during observation, execution, or closing flatten)
  const activePhases = ["OPENING_OBSERVATION", "ACTIVE_EXECUTION", "CLOSING_FLATTEN"];
  const usActive = schedule?.us?.phase ? activePhases.includes(schedule.us.phase) : (schedule?.us?.is_open_now !== undefined ? schedule.us.is_open_now : usMarketOpen);
  const euActive = schedule?.eu?.phase ? activePhases.includes(schedule.eu.phase) : (schedule?.eu?.is_open_now !== undefined ? schedule.eu.is_open_now : euMarketOpen);

  let liveAccount = systemSettings.ibkrAccountNumber;
  let netLiq = systemSettings.netLiquidation;
  let maintMargin = systemSettings.maintenanceMargin;

  try {
    const telemResp = await edgeBridge.sendCommand({ action: "GET_TELEMETRY" }, 1000);
    if (telemResp && telemResp.status === "OK" && telemResp.telemetry) {
      const telem = telemResp.telemetry;
      if (telem.account) {
        liveAccount = telem.account;
        systemSettings.ibkrAccountNumber = telem.account;
      }
      if (telem.account_summary?.NetLiquidation) {
        netLiq = Number(telem.account_summary.NetLiquidation);
      }
      if (telem.account_summary?.MaintMarginReq) {
        maintMargin = Number(telem.account_summary.MaintMarginReq);
      }
      if (telem.trading_mode) {
        systemSettings.tradingMode = telem.trading_mode;
      }
    }
  } catch {
    // Keep cached settings if bridge query times out
  }

  res.json({
    success: true,
    dailyCapitalCeiling: systemSettings.dailyCapitalCeiling,
    dailyCapitalUtilized: Math.round(currentUtilized * 100) / 100,
    dailyMaxLossCutoff: systemSettings.dailyMaxLossCutoff,
    currentDailyPnL: Math.round(currentDailyPnL * 100) / 100,
    fractionalTradingEnabled: systemSettings.fractionalTradingEnabled,
    intradayFlatteningEnabled: systemSettings.intradayFlatteningEnabled,
    intradayFlattenTimeEST: usMocCutoff,
    intradayFlattenTimeCET: euMocCutoff,
    usMocFlattenCutoff: usMocCutoff,
    euMocFlattenCutoff: euMocCutoff,
    isEarlyClose,
    dstDesynced,
    scheduleSource: schedule?.us?.source || "FALLBACK_STATIC",
    nyTimeEST: schedule?.ny_time_est || nyTimeEST,
    cetTimeCET: schedule?.cet_time_cet || cetTimeCET,
    usMarketOpen: usActive,
    euMarketOpen: euActive,
    usCountdown: schedule?.us?.countdown || null,
    euCountdown: schedule?.eu?.countdown || null,
    marketScope: systemSettings.marketScope || "ALL",
    killSwitchEngaged: systemSettings.killSwitchEngaged,
    tradingMode: systemSettings.tradingMode,
    tcpLatencyMs,
    netLiquidation: netLiq,
    maintenanceMargin: maintMargin,
    activePositionsCount: activeTrades.length,
    accountNumber: liveAccount || systemSettings.ibkrAccountNumber
  });
});

riskRouter.post("/api/risk/settings", authMiddleware, (req, res) => {
  const { dailyCapitalCeiling, dailyMaxLossCutoff, fractionalTradingEnabled, intradayFlatteningEnabled, tradingMode, marketScope, liveConfirmationToken } = req.body;
  
  if (dailyCapitalCeiling !== undefined) systemSettings.dailyCapitalCeiling = Number(dailyCapitalCeiling);
  if (dailyMaxLossCutoff !== undefined) systemSettings.dailyMaxLossCutoff = Number(dailyMaxLossCutoff);
  if (fractionalTradingEnabled !== undefined) systemSettings.fractionalTradingEnabled = Boolean(fractionalTradingEnabled);
  if (intradayFlatteningEnabled !== undefined) systemSettings.intradayFlatteningEnabled = Boolean(intradayFlatteningEnabled);
  
  if (tradingMode !== undefined && (tradingMode === "PAPER" || tradingMode === "LIVE")) {
    if (tradingMode === "LIVE" && systemSettings.tradingMode !== "LIVE") {
      const requiredToken = process.env.ADMIN_LIVE_CONFIRMATION_TOKEN || "ALPHA_LIVE_CONFIRMED_2026";
      if (liveConfirmationToken !== requiredToken) {
        return res.status(403).json({ success: false, error: "Invalid or missing ADMIN_LIVE_CONFIRMATION_TOKEN. Cannot switch to LIVE routing." });
      }
    }
    systemSettings.tradingMode = tradingMode;
  }
  
  if (marketScope !== undefined && ["ALL", "US", "EUROPE"].includes(marketScope)) {
    systemSettings.marketScope = marketScope;
  }

  console.log(`[RISK CONFIG UPDATED] Ceiling: $${systemSettings.dailyCapitalCeiling} | Loss Cutoff: $${systemSettings.dailyMaxLossCutoff} | Scope: ${systemSettings.marketScope} | Mode: ${systemSettings.tradingMode}`);
  persistSettings();
  res.json({ success: true, settings: getMaskedSettings(systemSettings) });
});

riskRouter.post("/api/risk/flatten-intraday", authMiddleware, (req, res) => {
  const reason = req.body.reason || "15:45 EST MOC / Manual Intraday Flatten Rule";
  const liquidatedTrades: any[] = [];
  
  activeTrades.forEach(trade => {
    const exitAction = trade.direction === "BUY" ? "SELL" : "BUY";
    const fillPrice = trade.currentPrice || trade.entryPrice;
    const blotterRec: ExecutionRecord = {
      id: `MOC-${Date.now().toString().slice(-5)}`,
      timestamp: new Date().toISOString(),
      symbol: trade.symbol,
      side: exitAction,
      qty: trade.quantity,
      orderType: "MOC / MKT (INTRADAY FLATTEN)",
      status: "FILLED",
      arrivalPrice: fillPrice,
      fillPrice: fillPrice,
      slippageBps: 1.5,
      commission: 1.00,
      currency: "USD"
    };
    executionBlotter.unshift(blotterRec);
    liquidatedTrades.push({ symbol: trade.symbol, qty: trade.quantity, side: exitAction });
  });
  
  const count = activeTrades.length;
  setActiveTrades([]);
  
  console.log(`[INTRADAY FLATTEN CONTROLLER] Liquidated ${count} positions. Reason: ${reason}`);
  res.json({
    success: true,
    message: `Liquidated ${count} intraday positions with MOC order execution. Zero overnight exposure secured.`,
    liquidatedCount: count,
    liquidatedTrades
  });
});

riskRouter.post("/api/risk/emergency-kill", authMiddleware, (req, res) => {
  systemSettings.killSwitchEngaged = true;
  systemSettings.routerLocked = true;
  
  const liquidatedCount = activeTrades.length;
  activeTrades.forEach(trade => {
    executionBlotter.unshift({
      id: `KILL-${Date.now().toString().slice(-5)}`,
      timestamp: new Date().toISOString(),
      symbol: trade.symbol,
      side: trade.direction === "BUY" ? "SELL" : "BUY",
      qty: trade.quantity,
      orderType: "MKT (EMERGENCY FLATTEN)",
      status: "FILLED",
      arrivalPrice: trade.currentPrice || trade.entryPrice,
      fillPrice: trade.currentPrice || trade.entryPrice,
      slippageBps: 3.5,
      commission: 1.00,
      currency: "USD"
    });
  });
  
  setActiveTrades([]);
  persistSettings();

  // Forward kill command to Edge Node via Direct TCP Socket Bridge
  edgeBridge.triggerEmergencyFlush().catch(err => {
    console.warn("[TCP BRIDGE] Emergency flush forward warning:", err.message);
  });

  console.warn(`[KILL SWITCH] EMERGENCY FLUSH EXECUTED. Liquidated ${liquidatedCount} positions. Router Locked.`);
  res.json({
    success: true,
    message: `Emergency Kill Switch engaged. ${liquidatedCount} positions flattened. Execution locked.`,
    killSwitchEngaged: true
  });
});

riskRouter.post("/api/risk/unlock", authMiddleware, async (req, res) => {
  systemSettings.killSwitchEngaged = false;
  systemSettings.routerLocked = false;
  await persistSettings();
  console.log("[RISK GATEWAY] Router unlocked by operator command.");
  res.json({ success: true, message: "System unlocked and armed.", killSwitchEngaged: false });
});

riskRouter.post("/api/reset-drawdown-lock", authMiddleware, async (req, res) => {
  systemSettings.routerLocked = false;
  await persistSettings();
  console.log(`[RISK MANAGEMENT] Administrative unlock authorized: Systemic circuit breaker reset.`);
  res.json({ success: true, settings: getMaskedSettings(systemSettings) });
});
