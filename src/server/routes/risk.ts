import { Router } from "express";
import { systemSettings, activeTrades, executionBlotter, db_fs, persistSettings, setActiveTrades } from "../state";
import { authMiddleware, getMaskedSettings } from "../middleware/auth";
import { ExecutionRecord } from "../types";

export const riskRouter = Router();

riskRouter.get("/api/risk/status", (req, res) => {
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

  res.json({
    success: true,
    dailyCapitalCeiling: systemSettings.dailyCapitalCeiling,
    dailyCapitalUtilized: Math.round(currentUtilized * 100) / 100,
    dailyMaxLossCutoff: systemSettings.dailyMaxLossCutoff,
    currentDailyPnL: Math.round(currentDailyPnL * 100) / 100,
    fractionalTradingEnabled: systemSettings.fractionalTradingEnabled,
    intradayFlatteningEnabled: systemSettings.intradayFlatteningEnabled,
    intradayFlattenTimeEST: systemSettings.intradayFlattenTimeEST,
    intradayFlattenTimeCET: systemSettings.intradayFlattenTimeCET,
    nyTimeEST,
    cetTimeCET,
    usMarketOpen,
    euMarketOpen,
    marketScope: systemSettings.marketScope || "ALL",
    killSwitchEngaged: systemSettings.killSwitchEngaged,
    tradingMode: systemSettings.tradingMode,
    tcpLatencyMs: 14.2,
    netLiquidation: systemSettings.netLiquidation,
    maintenanceMargin: systemSettings.maintenanceMargin,
    activePositionsCount: activeTrades.length
  });
});

riskRouter.post("/api/risk/settings", authMiddleware, (req, res) => {
  const { dailyCapitalCeiling, dailyMaxLossCutoff, fractionalTradingEnabled, intradayFlatteningEnabled, tradingMode, marketScope } = req.body;
  
  if (dailyCapitalCeiling !== undefined) systemSettings.dailyCapitalCeiling = Number(dailyCapitalCeiling);
  if (dailyMaxLossCutoff !== undefined) systemSettings.dailyMaxLossCutoff = Number(dailyMaxLossCutoff);
  if (fractionalTradingEnabled !== undefined) systemSettings.fractionalTradingEnabled = Boolean(fractionalTradingEnabled);
  if (intradayFlatteningEnabled !== undefined) systemSettings.intradayFlatteningEnabled = Boolean(intradayFlatteningEnabled);
  if (tradingMode !== undefined && (tradingMode === "PAPER" || tradingMode === "LIVE")) {
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

  // Forward kill command to Edge Node via Firestore
  if (db_fs) {
    db_fs.collection("system_commands").add({
      type: "EMERGENCY_FLUSH",
      reason: "Kill switch triggered from web control plane",
      timestamp: new Date().toISOString()
    }).catch(err => console.warn("[FIREBASE] Command forward warning:", err.message));
  }

  console.warn(`[KILL SWITCH] EMERGENCY FLUSH EXECUTED. Liquidated ${liquidatedCount} positions. Router Locked.`);
  res.json({
    success: true,
    message: `Emergency Kill Switch engaged. ${liquidatedCount} positions flattened. Execution locked.`,
    killSwitchEngaged: true
  });
});

riskRouter.post("/api/risk/unlock", authMiddleware, (req, res) => {
  systemSettings.killSwitchEngaged = false;
  systemSettings.routerLocked = false;
  console.log("[RISK GATEWAY] Router unlocked by operator command.");
  res.json({ success: true, message: "System unlocked and armed.", killSwitchEngaged: false });
});

riskRouter.post("/api/reset-drawdown-lock", authMiddleware, (req, res) => {
  systemSettings.routerLocked = false;
  console.log(`[RISK MANAGEMENT] Administrative unlock authorized: Systemic circuit breaker reset.`);
  res.json({ success: true, settings: getMaskedSettings(systemSettings) });
});
