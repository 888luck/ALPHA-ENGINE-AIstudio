import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { pushToGithub } from "./github_sync";
import { GoogleGenAI } from "@google/genai";
import { exec } from "child_process";

const app = express();
app.use(express.json());

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// ==========================================
// ALPHA ENGINE INTRANET STATE CONTROLLER
// ==========================================

interface ActiveTrade {
  id: string;
  symbol: string;
  quantity: number;
  direction: "BUY" | "SELL";
  entryPrice: number;
  stopPrice: number;
  currentPrice: number;
  unrealizedPnL: number;
  mifidDecisionMaker: string;
  mifidExecutionTrader: string;
  timestamp: string;
}

interface HistoricalLog {
  id: string;
  symbol: string;
  quantity: number;
  direction: "BUY" | "SELL";
  entryPrice: number;
  exitPrice: number;
  realizedPnL: number;
  commission: number;
  efficiencyRatio: number;
  timestamp: string;
}

// Global System Parameters & DRM Engine
let systemSettings = {
  ibkrAccountNumber: "U8129384",
  ibkrPort: 4002,
  ibkrClientId: 10,
  mifid2DecisionMaker: "ALGO_DEC_992",
  mifid2ExecutionTrader: "ALGO_EXE_554",
  referenceEquity: 154200.00,
  netLiquidation: 154200.00,
  maintenanceMargin: 12400.00,
  routerLocked: false,
  marketTime: "10:30", // Simulated Ny Clock
  marketPhase: "EXECUTION" as "CALIBRATION" | "EXECUTION" | "FLUSH" | "SYNC" | "POST-MARKET",
  virtualCapitalCeiling: 25000.00, // Ceiling to protect real capital base
  tradingMode: "PAPER" as "PAPER" | "LIVE",
  gatewayConnectionActive: false, // Setup active connection trigger
};

let dynamicBaskets: any[] = [];

// Commission helper incorporating IBKR Ireland (IBIE) Tiered pricing rules for French tax residents & SMART routing
export function calculateIBIECommission(symbol: string, primaryExchange: string, quantity: number, price: number): number {
  const exch = (primaryExchange || "").toUpperCase();
  const symb = (symbol || "").toUpperCase();
  // If SBF (Euronext Paris), AEB (Amsterdam), SB (Brussels), IBIS (XETRA) or asset symbols known to be European SGO, ENGI, RWE, SAP
  const isEuropean = ["SBF", "IBIS", "PARIS", "XETRA", "XETR", "AEB", "SB", "LSE"].includes(exch) ||
                     ["SGO", "ENGI", "RWE", "SAP"].includes(symb);

  if (isEuropean) {
    // Euronext Equities: Tiered/Fixed is typically 0.05% of trade value, minimum €1.25 per order
    const tradeValue = quantity * price;
    const baseComm = tradeValue * 0.0005; // 0.05%
    return Number(Math.max(1.25, baseComm).toFixed(2));
  } else {
    // US Equities: SDK/IBKR Fixed rate is USD 0.005 per share, minimum USD 1.00
    const baseComm = quantity * 0.005;
    return Number(Math.max(1.00, baseComm).toFixed(2));
  }
}

// Seed initial active trades & historical files
let activeTrades: ActiveTrade[] = [
  {
    id: "TRD_001",
    symbol: "XLE",
    quantity: 650,
    direction: "BUY",
    entryPrice: 92.40,
    stopPrice: 91.20,
    currentPrice: 93.15,
    unrealizedPnL: 487.50,
    mifidDecisionMaker: "ALGO_DEC_992",
    mifidExecutionTrader: "ALGO_EXE_554",
    timestamp: new Date().toISOString()
  }
];

let historicalLogs: HistoricalLog[] = [
  {
    id: "LOG_101",
    symbol: "NEE",
    quantity: 420,
    direction: "BUY",
    entryPrice: 72.80,
    exitPrice: 74.20,
    realizedPnL: 588.00,
    commission: 4.80,
    efficiencyRatio: 8.5, // Total friction consumed 8.5% of gross profits
    timestamp: new Date(Date.now() - 3600000).toISOString()
  },
  {
    id: "LOG_102",
    symbol: "ENPH",
    quantity: 110,
    direction: "SELL",
    entryPrice: 115.60,
    exitPrice: 113.10,
    realizedPnL: 275.00,
    commission: 2.20,
    efficiencyRatio: 11.2,
    timestamp: new Date(Date.now() - 7200000).toISOString()
  }
];

// Level 2 Order Book Simulation Variables
// Pre-seed ticks of Energy, Utilities, and Clean Tech targets
interface DepthItem {
  price: number;
  size: number;
  impliedOfi: number;
}

interface Level2Book {
  symbol: string;
  bids: DepthItem[];
  asks: DepthItem[];
  lastOfi: number;
  lastPrice: number;
  primaryExchange: string;
}

let marketBooks: Record<string, Level2Book> = {};

// Ingest function dynamically parsing current ScannerData callbacks natively
export function ingestScannedInstrument(symbol: string, primaryExchange: string, lastPrice: number) {
  if (marketBooks[symbol]) {
    marketBooks[symbol].primaryExchange = primaryExchange;
    return;
  }
  
  marketBooks[symbol] = {
    symbol,
    primaryExchange,
    lastPrice,
    lastOfi: Math.floor(Math.random() * 200) - 100,
    bids: Array.from({ length: 5 }, (_, idx) => ({
      price: Number((lastPrice - 0.01 - idx * 0.02 * (Math.random() * 0.5 + 0.8)).toFixed(2)),
      size: Math.floor(Math.random() * 800) + 200,
      impliedOfi: 0
    })),
    asks: Array.from({ length: 5 }, (_, idx) => ({
      price: Number((lastPrice + 0.01 + idx * 0.02 * (Math.random() * 0.5 + 0.8)).toFixed(2)),
      size: Math.floor(Math.random() * 800) + 200,
      impliedOfi: 0
    }))
  };
}

// Simulated active scanner feed sequence triggers on start up (500ms delay)
setTimeout(() => {
  console.log("[SCANNER DISCOVERY FEED] Processing dynamic incoming ScannerData callbacks...");
  ingestScannedInstrument("XLE", "NYSE", 93.15);
  ingestScannedInstrument("NEE", "NYSE", 73.10);
  ingestScannedInstrument("ENPH", "NASDAQ", 114.20);
  ingestScannedInstrument("SGO", "SBF", 77.20);
  ingestScannedInstrument("ENGI", "SBF", 14.80);
  ingestScannedInstrument("RWE", "IBIS", 33.40);
  ingestScannedInstrument("SAP", "IBIS", 178.50);
  console.log(`[SCANNER DISCOVERY FEED] Ingested ${Object.keys(marketBooks).length} dynamic multi-exchange targets.`);
}, 500);

// Background simulation ticker loop: ticks book dynamics to evaluate real-time OFI
setInterval(() => {
  if (systemSettings.routerLocked) return;

  // 1. Progress simulated clock time
  let [hours, minutes] = systemSettings.marketTime.split(":").map(Number);
  minutes += 1;
  if (minutes >= 60) {
    hours += 1;
    minutes = 0;
  }
  if (hours >= 24) hours = 0;
  systemSettings.marketTime = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;

  // Update market phases automatically
  if (systemSettings.marketTime >= "04:00" && systemSettings.marketTime < "09:30") {
    systemSettings.marketPhase = "CALIBRATION";
  } else if (systemSettings.marketTime >= "09:30" && systemSettings.marketTime < "15:50") {
    systemSettings.marketPhase = "EXECUTION";
  } else if (systemSettings.marketTime >= "15:50" && systemSettings.marketTime < "16:00") {
    // EOD Flat Flush sequence automatically triggers if state is not already flat
    if (activeTrades.length > 0 && systemSettings.marketPhase !== "FLUSH") {
      executeEmergencyFlush("AUTOMATED INTRA-DAY SESSION LOCK (EOD TIMEOUT)");
    }
    systemSettings.marketPhase = "FLUSH";
  } else if (systemSettings.marketTime >= "16:00" && systemSettings.marketTime < "16:20") {
    systemSettings.marketPhase = "SYNC";
  } else {
    systemSettings.marketPhase = "POST-MARKET";
  }

  // 2. Perform live price and book fluctuation ticks
  Object.keys(marketBooks).forEach((symbol) => {
    const book = marketBooks[symbol];
    const side = Math.random() > 0.48 ? 1 : -1; // Subtle upward trend
    const increment = Number((Math.random() * 0.04).toFixed(2)) * side;
    
    // Process price update
    const oldPrice = book.lastPrice;
    book.lastPrice = Number((book.lastPrice + increment).toFixed(2));
    
    // Shift Level 2 depth lists relative to price
    book.bids = book.bids.map((item, idx) => {
      const basePrice = Number((book.lastPrice - 0.01 - idx * 0.02 * (Math.random() * 0.5 + 0.8)).toFixed(2));
      const sizeShift = Math.floor(Math.random() * 80) * (Math.random() > 0.5 ? 1 : -1);
      const newSize = Math.max(80, item.size + sizeShift);
      return { price: basePrice, size: newSize, impliedOfi: 0 };
    });

    book.asks = book.asks.map((item, idx) => {
      const basePrice = Number((book.lastPrice + 0.01 + idx * 0.02 * (Math.random() * 0.5 + 0.8)).toFixed(2));
      const sizeShift = Math.floor(Math.random() * 80) * (Math.random() > 0.5 ? 1 : -1);
      const newSize = Math.max(80, item.size + sizeShift);
      return { price: basePrice, size: newSize, impliedOfi: 0 };
    });

    // 3. Compute real-time Order Flow Imbalance (OFI)
    // Formula check: evaluate volume differences between matching price slots
    const currentBidPrice = book.bids[0].price;
    const currentBidSize = book.bids[0].size;
    const currentAskPrice = book.asks[0].price;
    const currentAskSize = book.asks[0].size;

    // We emulate OFI calculations on top level bid/ask changes
    const ofiNoise = Math.floor(Math.random() * 120) * side;
    book.lastOfi = Math.min(1000, Math.max(-1000, book.lastOfi + ofiNoise));

    // Update prices inside current active trade indexes
    activeTrades.forEach((trade) => {
      if (trade.symbol === symbol) {
        trade.currentPrice = book.lastPrice;
        const multiplier = trade.direction === "BUY" ? 1 : -1;
        trade.unrealizedPnL = Number(((trade.currentPrice - trade.entryPrice) * trade.quantity * multiplier).toFixed(2));
      }
    });
  });

  // Calculate live daily portfolio stats
  let totalUnrealized = activeTrades.reduce((acc, curr) => acc + curr.unrealizedPnL, 0);
  let totalRealized = historicalLogs.reduce((acc, curr) => acc + curr.realizedPnL, 0);
  
  systemSettings.netLiquidation = Number((systemSettings.referenceEquity + totalUnrealized + totalRealized).toFixed(2));
  systemSettings.maintenanceMargin = activeTrades.length * 12400.00; // Multiplied under typical leverage ratios

  // Monitor daily drawdown circuit breaker (-2.5% drawdown trigger)
  const aggregatedPnL = totalUnrealized + totalRealized;
  const drawdownThreshold = -systemSettings.referenceEquity * 0.025;
  
  if (aggregatedPnL <= drawdownThreshold && !systemSettings.routerLocked) {
    executeEmergencyFlush("DRAWDOWN BREACH EXCEEDED SESSION CAP (-2.5% NET EQUITY)");
  }

}, 4000);

// Helper function implementing emergency liquidation and lock operations (DRM)
function executeEmergencyFlush(reason: string) {
  systemSettings.routerLocked = true;
  console.log(`!!! RISK ENFORCED DRIVER: EMERGENCY FLUSH TRIGGERED. Reason: ${reason} !!!`);
  
  // Flatten all positions to historic logs instantly with current prices
  activeTrades.forEach((trade) => {
    const multiplier = trade.direction === "BUY" ? 1 : -1;
    const realized = Number(((trade.currentPrice - trade.entryPrice) * trade.quantity * multiplier).toFixed(2));
    const commission = calculateIBIECommission(trade.symbol, "", trade.quantity, trade.entryPrice); // Use European/US aware IBIE commission Model
    
    // Assess spread cost
    const spreadCost = 0.02 * trade.quantity;
    const totalFriction = spreadCost + commission;
    const ratio = Number(((totalFriction / Math.abs(realized || 1)) * 100).toFixed(1));

    historicalLogs.unshift({
      id: `LOG_${Math.floor(Math.random() * 1000) + 200}`,
      symbol: trade.symbol,
      quantity: trade.quantity,
      direction: trade.direction,
      entryPrice: trade.entryPrice,
      exitPrice: trade.currentPrice,
      realizedPnL: realized,
      commission,
      efficiencyRatio: Number.isNaN(ratio) ? 0.2 : Math.min(100, ratio),
      timestamp: new Date().toISOString()
    });
  });

  activeTrades = [];
}

// ==========================================
// REST FULL-STACK ENDPOINTS FOR PORTFOLIO CONTROL
// ==========================================

app.get("/api/security-rules", (req, res) => {
  try {
    const rulesPath = path.join(process.cwd(), "firestore.rules");
    const rulesContent = fs.readFileSync(rulesPath, "utf8");
    res.json({ rules: rulesContent });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to read firestore.rules on server: " + err.message });
  }
});

app.get("/api/state", (req, res) => {
  res.json({
    settings: systemSettings,
    activeTrades,
    historicalLogs,
    marketBooks,
    dynamicBaskets
  });
});

// Helper to load and seed high-quality fallback asset portfolios during API key absence or API failures
const initializeFallbackBaskets = (reason: string, res: any) => {
  const backup = {
    baskets: [
      {
        sector: "AI Calibrated Strategic Energy Portfolio (Fallback)",
        tickers: ["XLE", "VLO", "COP"],
        impliedOfiTrend: "BULLISH (Middle-East Sea Lane Concerns)",
        winRate: 64,
        profitFactor: 1.58,
        avgFrictionConsumed: 5.4
      },
      {
        sector: "AI Calibrated High-Vol Defence Basket (Fallback)",
        tickers: ["ITA", "NOC", "RTX"],
        impliedOfiTrend: "BULLISH (Strategic Posturing)",
        winRate: 61,
        profitFactor: 1.48,
        avgFrictionConsumed: 6.8
      },
      {
        sector: "AI Calibrated Tech Sovereignty Portfolio (Fallback)",
        tickers: ["SAP", "RWE", "ENPH"],
        impliedOfiTrend: "NEUTRAL / MIXED",
        winRate: 53,
        profitFactor: 1.22,
        avgFrictionConsumed: 10.5
      }
    ]
  };
  dynamicBaskets = backup.baskets;
  
  // Seed any missing fallback symbols
  backup.baskets.forEach((b: any) => {
    b.tickers.forEach((symbol: string) => {
      const sym = symbol.toUpperCase();
      if (!marketBooks[sym]) {
        ingestScannedInstrument(sym, "NYSE", Math.floor(Math.random() * 100) + 50);
      }
    });
  });

  try {
    fs.writeFileSync(path.join(process.cwd(), "dynamic_baskets.json"), JSON.stringify(backup, null, 2), "utf8");
  } catch (_) {}

  return res.json({
    success: true,
    message: reason,
    baskets: dynamicBaskets
  });
};

app.post("/api/calibrate-geopolitical", async (req, res) => {
  const { eventDescription } = req.body;
  if (!eventDescription) {
    return res.status(400).json({ error: "Missing required parameter: eventDescription" });
  }

  const rawKey = process.env.GEMINI_API_KEY;
  const isPlaceholderOrEmpty = !rawKey ||
    rawKey.trim() === "" ||
    rawKey.includes("MY_GEMINI_API_KEY") ||
    rawKey.toLowerCase().includes("placeholder") ||
    rawKey.toLowerCase().includes("replace") ||
    rawKey.toLowerCase().includes("your_") ||
    rawKey.length < 20;

  if (isPlaceholderOrEmpty) {
    return initializeFallbackBaskets(
      "Unconfigured/Placeholder API Key. Using high-quality simulated backup portfolios. Configure a real GEMINI_API_KEY in the Secrets panel to enable Live GPT-4o-level macro calibration.",
      res
    );
  }

  try {
    const prompt = `You are an expert geopolitical and macroeconomic quantitative trading strategist who calibrates high-frequency algorithmic portfolio baskets for Order Flow Imbalance.
Analyze this high-impact real-world event/development:
"${eventDescription}"

Generate 3 high-performance strategic asset baskets (each with exactly 3 stock/ETF tickers) that are directly exposed to, or stand to benefit/fluctuate most from, this specific event.
Provide the output in STRICT JSON format matching the schema:
{
  "baskets": [
    {
      "sector": "Descriptive basket name, e.g., Middle-East Strategic Oil Beneficiaries",
      "tickers": ["TICKER1", "TICKER2", "TICKER3"],
      "impliedOfiTrend": "BULLISH or BEARISH or VOLATILE with brief explanation of impact",
      "winRate": 64,
      "profitFactor": 1.55,
      "avgFrictionConsumed": 5.4
    }
  ]
}
Ensure winRate is an integer between 48 and 75, profitFactor is a float between 1.10 and 1.85, and avgFrictionConsumed is a float between 4.0 and 15.0.
Ensure tickers are real liquid US or European equities and ETFs (e.g. XLE, GLD, ITA, SPY, QQQ, AAPL, EURX, TSLA, COP, VLO, SAP, RWE).
Only output the raw valid JSON. No markdown backticks or commentary outside the JSON block.`;

    const useVertex = !!req.body.useVertex;
    let response;

    if (useVertex) {
      console.log("[SERVER] Executing calibration via Vertex AI Production Standard SDK (europe-west3)...");
      const ai = new GoogleGenAI({
        vertexai: true,
        project: process.env.GOOGLE_CLOUD_PROJECT || "alpha-engine-production",
        location: "europe-west3"
      });
      response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json"
        }
      });
    } else {
      console.log("[SERVER] Executing calibration via AI Studio Developer Key...");
      const ai = new GoogleGenAI({ apiKey: rawKey });
      response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json"
        }
      });
    }

    const parsedData = JSON.parse(response.text || "{}");
    if (parsedData && Array.isArray(parsedData.baskets)) {
      dynamicBaskets = parsedData.baskets;
      
      parsedData.baskets.forEach((b: any) => {
        if (Array.isArray(b.tickers)) {
          b.tickers.forEach((ticker: string) => {
            const sym = ticker.toUpperCase();
            if (!marketBooks[sym]) {
              const defaultExch = ["SGO", "ENGI", "RWE", "SAP", "LVMH", "ASML"].includes(sym) ? "SBF" : "NYSE";
              const defaultPrice = Math.floor(Math.random() * 120) + 40;
              ingestScannedInstrument(sym, defaultExch, defaultPrice);
            }
          });
        }
      });

      try {
        fs.writeFileSync(path.join(process.cwd(), "dynamic_baskets.json"), JSON.stringify(parsedData, null, 2), "utf8");
        console.log("[SERVER] Successfully wrote dynamic_baskets.json for python node syncing.");
      } catch (err) {
        console.error("[SERVER] Failed to write dynamic_baskets.json:", err);
      }

      res.json({ success: true, message: `Geopolitical Sectors successfully calibrated via Gemini for "${eventDescription.slice(0, 45)}..."`, baskets: dynamicBaskets });
    } else {
      throw new Error("Invalid structure returned from model");
    }
  } catch (err: any) {
    console.warn("[SERVER] Gemini calibration failed, elegantly falling back to simulated baskets:", err);
    return initializeFallbackBaskets(
      `Elegantly recovering: Calibrator encountered a technical error (${err.message}) with the configured key. Auto-reverting to simulated portfolios to maintain continuous trading logic.`,
      res
    );
  }
});

app.post("/api/scanner-ingest", (req, res) => {
  const { symbol, primaryExchange, lastPrice } = req.body;
  if (!symbol) {
    return res.status(400).json({ error: "Missing required parameter: symbol" });
  }
  const exch = (primaryExchange || "SMART").toUpperCase();
  const price = Number(lastPrice) || 50.00;
  ingestScannedInstrument(symbol, exch, price);
  res.json({ success: true, symbol, primaryExchange: exch, marketBooks });
});

app.post("/api/set-settings", (req, res) => {
  const { ibkrAccountNumber, mifid2DecisionMaker, mifid2ExecutionTrader, referenceEquity, virtualCapitalCeiling, tradingMode, ibkrPort, ibkrClientId, gatewayConnectionActive } = req.body;
  
  if (ibkrAccountNumber) systemSettings.ibkrAccountNumber = ibkrAccountNumber;
  if (mifid2DecisionMaker) systemSettings.mifid2DecisionMaker = mifid2DecisionMaker;
  if (mifid2ExecutionTrader) systemSettings.mifid2ExecutionTrader = mifid2ExecutionTrader;
  if (referenceEquity) {
    systemSettings.referenceEquity = Number(referenceEquity);
    systemSettings.netLiquidation = Number(referenceEquity);
  }
  if (virtualCapitalCeiling !== undefined) {
    systemSettings.virtualCapitalCeiling = Number(virtualCapitalCeiling);
  }
  if (tradingMode) {
    systemSettings.tradingMode = tradingMode;
  }
  if (ibkrPort !== undefined) {
    systemSettings.ibkrPort = Number(ibkrPort);
  }
  if (ibkrClientId !== undefined) {
    systemSettings.ibkrClientId = Number(ibkrClientId);
  }
  if (gatewayConnectionActive !== undefined) {
    systemSettings.gatewayConnectionActive = !!gatewayConnectionActive;
  }

  res.json({ success: true, settings: systemSettings });
});

app.post("/api/github-sync-action", async (req, res) => {
  const { token, repoPath, branch } = req.body;
  if (!token) {
    return res.status(400).json({ error: "Missing required parameter: GitHub Personal Access Token (PAT)" });
  }
  const cleanRepo = repoPath || "888luck/ALPHA-ENGINE-AIstudio";
  const cleanBranch = branch || "main";

  try {
    const result = await pushToGithub(token, cleanRepo, cleanBranch);
    if (result.success) {
      res.json({ success: true, message: result.message, commitSha: result.commitSha, url: result.url });
    } else {
      res.status(400).json({ error: result.message });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message || "An unexpected error occurred during GitHub synchronization." });
  }
});

app.post("/api/sync-from-cloud", (req, res) => {
  const { trades, logs, settings } = req.body;
  if (Array.isArray(trades)) {
    activeTrades = trades;
  }
  if (Array.isArray(logs)) {
    historicalLogs = logs;
  }
  if (settings) {
    if (typeof settings.netLiquidation === "number") {
      systemSettings.netLiquidation = settings.netLiquidation;
    }
    if (typeof settings.routerLocked === "boolean") {
      systemSettings.routerLocked = settings.routerLocked;
    }
    if (typeof settings.maintenanceMargin === "number") {
      systemSettings.maintenanceMargin = settings.maintenanceMargin;
    }
    if (typeof settings.virtualCapitalCeiling === "number") {
      systemSettings.virtualCapitalCeiling = settings.virtualCapitalCeiling;
    }
    if (settings.tradingMode) {
      systemSettings.tradingMode = settings.tradingMode;
    }
    if (typeof settings.ibkrPort === "number") {
      systemSettings.ibkrPort = settings.ibkrPort;
    }
    if (typeof settings.ibkrClientId === "number") {
      systemSettings.ibkrClientId = settings.ibkrClientId;
    }
    if (typeof settings.gatewayConnectionActive === "boolean") {
      systemSettings.gatewayConnectionActive = settings.gatewayConnectionActive;
    }
  }
  res.json({ success: true, settings: systemSettings, activeTrades, historicalLogs });
});

// Trigger a structural Level 2 tick pulse manually
app.post("/api/simulate-tick", (req, res) => {
  const { symbol, direction } = req.body;
  if (!symbol || !marketBooks[symbol]) {
    return res.status(400).json({ error: "Invalid symbol supplied" });
  }

  const book = marketBooks[symbol];
  const side = direction === "UP" ? 1 : -1;
  const increment = 0.04 * side;
  
  book.lastPrice = Number((book.lastPrice + increment).toFixed(2));
  book.lastOfi = Math.min(1000, Math.max(-1000, book.lastOfi + (280 * side)));
  
  // Re-map bids and asks relative to price movement
  book.bids = book.bids.map((item, idx) => ({
    price: Number((book.lastPrice - 0.01 - idx * 0.02).toFixed(2)),
    size: Math.floor(Math.random() * 500) + 400,
    impliedOfi: 0
  }));

  book.asks = book.asks.map((item, idx) => ({
    price: Number((book.lastPrice + 0.01 + idx * 0.02).toFixed(2)),
    size: Math.floor(Math.random() * 500) + 400,
    impliedOfi: 0
  }));

  res.json({ success: true, book });
});

// Dynamic pre-trade order sizing router & 1% risk pool allocator
app.post("/api/place-trade", (req, res) => {
  if (systemSettings.routerLocked) {
    return res.status(403).json({ error: "EXECUTION ROUTER HARD-LOCKED: Risk circuit breaker or session termination in progress." });
  }

  const { symbol, direction, entryPrice, stopPrice, targetProfit } = req.body;

  if (!symbol || !direction || !entryPrice || !stopPrice) {
    return res.status(400).json({ error: "Missing required order parameters (symbol, direction, entry, stop)." });
  }

  const book = marketBooks[symbol];
  if (!book) return res.status(404).json({ error: "Target asset book not found." });

  // 1. DRM 1% Position Sizing check based on Virtual Capital Ceiling if specified, else netLiquidation
  const stopDistance = Math.abs(entryPrice - stopPrice);
  if (stopDistance <= 0) {
    return res.status(400).json({ error: "Initial stop distance cannot be zero or negative." });
  }

  const activeCapital = (systemSettings.virtualCapitalCeiling && systemSettings.virtualCapitalCeiling > 0)
    ? systemSettings.virtualCapitalCeiling
    : systemSettings.netLiquidation;

  const riskCapital = activeCapital * 0.01;
  const calculatedQty = Math.floor(riskCapital / stopDistance);

  if (calculatedQty <= 0) {
    return res.status(400).json({ error: "Required stop-distance too wide compared to Virtual Capital Ceiling. Implied position size is 0 units." });
  }

  // 2. Spread & 15% Friction Rule Validation Filter incorporating exact IBIE commissions
  const currentSpread = Number((book.asks[0].price - book.bids[0].price).toFixed(2));
  const expectedCommission = calculateIBIECommission(symbol, book.primaryExchange, calculatedQty, entryPrice);
  
  // Friction = Spread difference cost + commissions
  const halfSpreadCost = (currentSpread / 2) * calculatedQty;
  const roundTripComm = expectedCommission * 2;
  const totalFriction = halfSpreadCost + roundTripComm;
  
  const projectedGrossProfit = (targetProfit || (stopDistance * 1.5)) * calculatedQty;
  const efficiencyRatio = Number(((totalFriction / projectedGrossProfit) * 100).toFixed(1));

  if (efficiencyRatio > 15) {
    return res.status(422).json({
      error: "TRADE REJECTED FOR EFFICIENCY LOSS: Transaction fee + spread friction consumes over 15% of projected profit ceiling.",
      efficiencyRatio,
      frictionCost: totalFriction,
      calculatedQty
    });
  }

  // 3. Margin requirement safety rule checks (ensure net liq covers minimum requirements)
  const virtualMarginImpact = calculatedQty * 15.00; // Estimated intraday initial margin
  if (systemSettings.maintenanceMargin + virtualMarginImpact > activeCapital * 0.85) {
    return res.status(422).json({ error: "TRADE ABORTED: Margin leverage check failed. Intraday deployment triggers systemic margin risk threshold under specified Capital Ceiling." });
  }

  // Place trade setup inside active trades list
  const newTrade: ActiveTrade = {
    id: `TRD_${Math.floor(Math.random() * 9000) + 1000}`,
    symbol,
    quantity: calculatedQty,
    direction,
    entryPrice: Number(entryPrice),
    stopPrice: Number(stopPrice),
    currentPrice: book.lastPrice,
    unrealizedPnL: 0.0,
    mifidDecisionMaker: systemSettings.mifid2DecisionMaker,
    mifidExecutionTrader: systemSettings.mifid2ExecutionTrader,
    timestamp: new Date().toISOString()
  };

  activeTrades.push(newTrade);
  res.json({ success: true, trade: newTrade, efficiencyRatio, calculatedQty });
});

// Manual override emergency kill button endpoint
app.post("/api/trigger-flush", (req, res) => {
  executeEmergencyFlush("MANUAL SYSTEMIC OVERRIDE KILL-SWITCH INITIATED VIA PORTFOLIO WEB PANEL");
  res.json({ success: true, settings: systemSettings, activeTrades });
});

app.post("/api/reset-simulation", (req, res) => {
  systemSettings.routerLocked = false;
  systemSettings.netLiquidation = systemSettings.referenceEquity;
  systemSettings.maintenanceMargin = 0.00;
  systemSettings.marketTime = "09:30";
  systemSettings.marketPhase = "EXECUTION";
  activeTrades = [];
  historicalLogs = [
    {
      id: "LOG_101",
      symbol: "NEE",
      quantity: 420,
      direction: "BUY",
      entryPrice: 72.80,
      exitPrice: 74.20,
      realizedPnL: 588.00,
      commission: 4.80,
      efficiencyRatio: 8.5,
      timestamp: new Date().toISOString()
    }
  ];
  res.json({ success: true });
});

// Pre-flight proactive simulator across multiple asset baskets
app.get("/api/run-expectancy", (req, res) => {
  if (dynamicBaskets && dynamicBaskets.length > 0) {
    return res.json({ baskets: dynamicBaskets });
  }
  const resultData = {
    baskets: [
      {
        sector: "Energy Sector Trading Strategy",
        tickers: ["XLE", "VLO", "COP"],
        impliedOfiTrend: "BULLISH (Macro Divergence +)",
        winRate: 58,
        profitFactor: 1.45,
        avgFrictionConsumed: 7.2
      },
      {
        sector: "Utilities Structural Arbitrage",
        tickers: ["XLU", "NEE", "DUK"],
        impliedOfiTrend: "NEUTRAL / FLAT",
        winRate: 54,
        profitFactor: 1.28,
        avgFrictionConsumed: 9.8
      },
      {
        sector: "Clean Energy Tech Imbalances",
        tickers: ["ICLN", "ENPH", "FSLR"],
        impliedOfiTrend: "VOLATILE / DIVERGENT",
        winRate: 51,
        profitFactor: 1.15,
        avgFrictionConsumed: 13.4
      }
    ]
  };
  res.json(resultData);
});

// Dedicated REST endpoint allowing selecting ticker, time range, timeframe and executing python simulation
app.post("/api/backtest", (req, res) => {
  const { symbol, timeframe, startDate, endDate } = req.body;
  if (!symbol || !timeframe || !startDate || !endDate) {
    return res.status(400).json({ error: "Missing required parameters (symbol, timeframe, startDate, endDate)." });
  }

  // Sanitize command inputs to avoid injection vulnerability
  const cleanSymbol = symbol.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  const cleanTimeframe = timeframe.replace(/[^a-zA-Z0-9]/g, "");
  const cleanStartDate = startDate.replace(/[^0-9\-]/g, "");
  const cleanEndDate = endDate.replace(/[^0-9\-]/g, "");

  const command = `python3 backtester.py "${cleanSymbol}" "${cleanTimeframe}" "${cleanStartDate}" "${cleanEndDate}"`;

  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error(`Backtest executable error: ${error.message}`);
      // Try fallback with simple "python" if python3 lacks binary association
      const fallbackCommand = `python backtester.py "${cleanSymbol}" "${cleanTimeframe}" "${cleanStartDate}" "${cleanEndDate}"`;
      exec(fallbackCommand, (fallbackError, fallbackStdout, fallbackStderr) => {
        if (fallbackError) {
          return res.status(500).json({ error: "Execution loop failed: " + fallbackError.message });
        }
        try {
          const parsed = JSON.parse(fallbackStdout);
          res.json({ success: true, ...parsed });
        } catch (e: any) {
          res.status(500).json({ error: "Failed to parse system results feed: " + e.message, output: fallbackStdout });
        }
      });
      return;
    }

    try {
      const parsed = JSON.parse(stdout);
      res.json({ success: true, ...parsed });
    } catch (e: any) {
      console.warn("Retrying parser error on blank output, stderr: ", stderr);
      res.status(500).json({ error: "Invalid JSON response from backtest engine: " + e.message, output: stdout });
    }
  });
});

// Setup backend with static or dev mode bundler configurations
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[ALPHA SERVER] Running successfully on local container: http://0.0.0.0:${PORT}`);
  });
}

startServer();
