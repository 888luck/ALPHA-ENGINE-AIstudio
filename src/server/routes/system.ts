import { Router } from "express";
import fs from "fs";
import path from "path";
import net from "net";
import { systemSettings, activeTrades, historicalLogs, marketBooks, dynamicBaskets, persistSettings, setActiveTrades, setHistoricalLogs } from "../state";
import { authMiddleware, getMaskedSettings } from "../middleware/auth";

export const systemRouter = Router();

systemRouter.get("/api/security-rules", (req, res) => {
  try {
    const rulesPath = path.join(process.cwd(), "firestore.rules");
    const rulesContent = fs.readFileSync(rulesPath, "utf8");
    res.json({ rules: rulesContent });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to read firestore.rules on server: " + err.message });
  }
});

systemRouter.get("/api/diagnostics", (req, res) => {
  const serverKey = process.env.GEMINI_API_KEY;
  const hasServerKey = !!(serverKey && 
    serverKey.trim() !== "" && 
    !serverKey.includes("MY_GEMINI_API_KEY") && 
    !serverKey.toLowerCase().includes("placeholder") && 
    !serverKey.toLowerCase().includes("replace") && 
    !serverKey.toLowerCase().includes("your_") && 
    serverKey.length >= 20);

  res.json({
    hasServerKey,
    nodeEnv: process.env.NODE_ENV || "development",
    tradingMode: systemSettings.tradingMode,
    routerLocked: systemSettings.routerLocked,
    mifid2DecisionMaker: systemSettings.mifid2DecisionMaker,
    openaiConfigured: !!(systemSettings.openaiApiKey || process.env.OPENAI_API_KEY),
    anthropicConfigured: !!(systemSettings.anthropicApiKey || process.env.ANTHROPIC_API_KEY),
    selectedAiProvider: systemSettings.selectedAiProvider,
    firebaseStatus: process.env.FIREBASE_API_KEY ? "configured" : "unconfigured",
    settings: getMaskedSettings(systemSettings),
  });
});

systemRouter.get("/api/state", (req, res) => {
  try {
    res.json({
      settings: getMaskedSettings(systemSettings),
      activeTrades,
      historicalLogs,
      marketBooks,
      dynamicBaskets
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

systemRouter.post("/api/set-settings", authMiddleware, (req, res) => {
  const { 
    ibkrAccountNumber, 
    ibkrHost,
    ibkrPort, 
    ibkrClientId, 
    ibkrPaperUsername,
    ibkrPaperPassword,
    mifid2DecisionMaker, 
    mifid2ExecutionTrader, 
    referenceEquity, 
    virtualCapitalCeiling, 
    tradingMode, 
    gatewayConnectionActive,
    stopAtrMultiplier,
    partialProfit,
    breakevenLock,
    maxHoldBars,
    ofiFilter,
    adaptiveStop,
    dailyDrawdownLimitPercent,
    dailyDrawdownLimitCash,
    marketScope,
    geminiApiKey,
    openaiApiKey,
    anthropicApiKey,
    nvidiaApiKey,
    customAiApiKey,
    customAiBaseUrl,
    customAiModelName,
    selectedAiProvider,
    openFdaApiKey,
    fredApiKey,
    patentsApiKey,
    secUserAgent
  } = req.body;

  if (ibkrAccountNumber !== undefined) systemSettings.ibkrAccountNumber = ibkrAccountNumber;
  if (ibkrHost !== undefined) systemSettings.ibkrHost = ibkrHost;
  if (ibkrPort !== undefined) systemSettings.ibkrPort = Number(ibkrPort);
  if (ibkrClientId !== undefined) systemSettings.ibkrClientId = Number(ibkrClientId);
  if (ibkrPaperUsername !== undefined) systemSettings.ibkrPaperUsername = ibkrPaperUsername;
  if (ibkrPaperPassword !== undefined) systemSettings.ibkrPaperPassword = ibkrPaperPassword;
  if (mifid2DecisionMaker !== undefined) systemSettings.mifid2DecisionMaker = mifid2DecisionMaker;
  if (mifid2ExecutionTrader !== undefined) systemSettings.mifid2ExecutionTrader = mifid2ExecutionTrader;
  if (gatewayConnectionActive !== undefined) systemSettings.gatewayConnectionActive = Boolean(gatewayConnectionActive);
  if (stopAtrMultiplier !== undefined) systemSettings.stopAtrMultiplier = Number(stopAtrMultiplier);
  if (partialProfit !== undefined) systemSettings.partialProfit = Boolean(partialProfit);
  if (breakevenLock !== undefined) systemSettings.breakevenLock = Boolean(breakevenLock);
  if (maxHoldBars !== undefined) systemSettings.maxHoldBars = Number(maxHoldBars);
  if (ofiFilter !== undefined) systemSettings.ofiFilter = Boolean(ofiFilter);
  if (adaptiveStop !== undefined) systemSettings.adaptiveStop = Boolean(adaptiveStop);
  if (dailyDrawdownLimitPercent !== undefined) systemSettings.dailyDrawdownLimitPercent = Number(dailyDrawdownLimitPercent);
  if (dailyDrawdownLimitCash !== undefined) systemSettings.dailyDrawdownLimitCash = Number(dailyDrawdownLimitCash);
  if (marketScope !== undefined) systemSettings.marketScope = marketScope;

  if (geminiApiKey !== undefined) systemSettings.geminiApiKey = geminiApiKey;
  if (openaiApiKey !== undefined) systemSettings.openaiApiKey = openaiApiKey;
  if (anthropicApiKey !== undefined) systemSettings.anthropicApiKey = anthropicApiKey;
  if (nvidiaApiKey !== undefined) systemSettings.nvidiaApiKey = nvidiaApiKey;
  if (customAiApiKey !== undefined) systemSettings.customAiApiKey = customAiApiKey;
  if (customAiBaseUrl !== undefined) systemSettings.customAiBaseUrl = customAiBaseUrl;
  if (customAiModelName !== undefined) systemSettings.customAiModelName = customAiModelName;
  if (selectedAiProvider !== undefined) systemSettings.selectedAiProvider = selectedAiProvider;
  if (openFdaApiKey !== undefined) systemSettings.openFdaApiKey = openFdaApiKey;
  if (fredApiKey !== undefined) systemSettings.fredApiKey = fredApiKey;
  if (patentsApiKey !== undefined) systemSettings.patentsApiKey = patentsApiKey;
  if (secUserAgent !== undefined) systemSettings.secUserAgent = secUserAgent;

  persistSettings();
  res.json({ success: true, settings: getMaskedSettings(systemSettings) });
});

systemRouter.post("/api/sync-from-cloud", (req, res) => {
  const { trades, logs, settings } = req.body;
  if (Array.isArray(trades)) {
    setActiveTrades(trades);
  }
  if (Array.isArray(logs)) {
    setHistoricalLogs(logs);
  }
  if (settings) {
    if (typeof settings.netLiquidation === "number") systemSettings.netLiquidation = settings.netLiquidation;
    if (typeof settings.routerLocked === "boolean") systemSettings.routerLocked = settings.routerLocked;
    if (typeof settings.maintenanceMargin === "number") systemSettings.maintenanceMargin = settings.maintenanceMargin;
    if (typeof settings.virtualCapitalCeiling === "number") systemSettings.virtualCapitalCeiling = settings.virtualCapitalCeiling;
    if (settings.tradingMode) systemSettings.tradingMode = settings.tradingMode;
    if (typeof settings.ibkrPort === "number") systemSettings.ibkrPort = settings.ibkrPort;
    if (typeof settings.ibkrClientId === "number") systemSettings.ibkrClientId = settings.ibkrClientId;
    if (typeof settings.gatewayConnectionActive === "boolean") systemSettings.gatewayConnectionActive = settings.gatewayConnectionActive;
  }
  res.json({ success: true, settings: getMaskedSettings(systemSettings), activeTrades, historicalLogs });
});

systemRouter.post("/api/test-broker-connection", (req, res) => {
  // If running on Cloud Run and no host is explicitly provided, default to EDGE_NODE_IP or loopback
  const defaultHost = process.env.EDGE_NODE_IP || (process.env.K_SERVICE ? "34.141.105.241" : "127.0.0.1");
  const host = req.body.host || defaultHost;
  const port = Number(req.body.port) || systemSettings.ibkrPort || 4002;
  const startTime = Date.now();
  const isCloudRun = !!process.env.K_SERVICE;
  
  const socket = new net.Socket();
  let finished = false;
  socket.setTimeout(3500);

  socket.on("connect", () => {
    if (finished) return;
    finished = true;
    const latencyMs = Date.now() - startTime;
    socket.destroy();
    res.json({
      success: true,
      latencyMs,
      host,
      port,
      status: "CONNECTED",
      message: `TCP handshake with IB Gateway (${host}:${port}) succeeded in ${latencyMs}ms.`
    });
  });

  socket.on("timeout", () => {
    if (finished) return;
    finished = true;
    socket.destroy();
    res.json({
      success: false,
      host,
      port,
      status: "TIMEOUT",
      message: isCloudRun && host === "127.0.0.1"
        ? `Cloud Run container isolation: IB Gateway runs on the Frankfurt Edge Node VM (34.141.105.241:4002), not inside this stateless Cloud Run container.`
        : `TCP socket timeout after 3500ms attempting to reach IB Gateway (${host}:${port}).`
    });
  });

  socket.on("error", (err: any) => {
    if (finished) return;
    finished = true;
    socket.destroy();
    res.json({
      success: false,
      host,
      port,
      status: "REFUSED",
      message: isCloudRun && host === "127.0.0.1"
        ? `Cloud Run container isolation: IB Gateway runs on the Frankfurt Edge Node VM (34.141.105.241:4002), not inside this stateless Cloud Run container (127.0.0.1:4002 returned ECONNREFUSED).`
        : `TCP connection to ${host}:${port} failed: ${err.message}`
    });
  });

  socket.connect(port, host);
});

systemRouter.post("/api/reset-simulation", authMiddleware, (req, res) => {
  systemSettings.routerLocked = false;
  systemSettings.netLiquidation = systemSettings.referenceEquity;
  systemSettings.maintenanceMargin = 0.00;
  systemSettings.marketTime = "09:30";
  systemSettings.marketPhase = "EXECUTION";
  setActiveTrades([]);
  setHistoricalLogs([]);
  res.json({ success: true, settings: getMaskedSettings(systemSettings) });
});
