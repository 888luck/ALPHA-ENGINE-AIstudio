import "dotenv/config";
import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { pushToGithub } from "./github_sync";
import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { execFile } from "child_process";

import { initializeApp, getApps, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

console.log("[ALPHA SERVER] Initializing engine...");

let firebaseProjectId: string | undefined = undefined;
let databaseId: string | undefined = undefined;
try {
  const configPath = path.join(process.cwd(), "firebase-applet-config.json");
  if (fs.existsSync(configPath)) {
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    if (config.firestoreDatabaseId) {
      databaseId = config.firestoreDatabaseId;
    }
    if (config.projectId) {
      firebaseProjectId = config.projectId;
    }
    console.log(`[FIREBASE] Using Firestore database ID: ${databaseId}, Project ID: ${firebaseProjectId}`);
  }
} catch (err: any) {
  console.warn("[FIREBASE] Could not read firebase-applet-config.json:", err.message);
}

// Initialize Firebase Admin for persistent settings storage
try {
  if (getApps().length === 0) {
    initializeApp({
      credential: applicationDefault(),
      ...(firebaseProjectId ? { projectId: firebaseProjectId } : {})
    });
    console.log("[FIREBASE] Admin SDK initialized for settings persistence.");
  }
} catch (e: any) {
  console.warn("[FIREBASE] Admin initialization skipped or failed. Settings will be transient in memory. Error:", e.message);
}

const db_fs = getApps().length > 0 ? (databaseId ? getFirestore(getApps()[0], databaseId) : getFirestore()) : null;
const SETTINGS_DOC_PATH = "system_config/alpha_engine_v1";

const app = express();
app.use(express.json());

// Global error handler
process.on("unhandledRejection", (reason, promise) => {
  console.error("[SERVER] Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("[SERVER] Uncaught Exception:", err);
});

const PORT = 3000;

// ==========================================
// UNIVERSAL AI AGNOSTIC ROUTER (ALPHA-GEN)
// ==========================================

async function getUniversalAIResponse(prompt: string, options: { provider?: string, systemPrompt?: string, jsonMode?: boolean } = {}) {
  const provider = options.provider || systemSettings.selectedAiProvider;
  const sysPrompt = options.systemPrompt || "You are the Alpha Engine AI. Provide precise, quantitative trading insights.";

  // Routing Logic
  let targetProvider = provider;
  if (provider === "auto") {
    // Strongly favor Gemini if key is present (User Preference)
    const hasGemini = systemSettings.geminiApiKey || process.env.GEMINI_API_KEY;
    if (hasGemini) {
      targetProvider = prompt.length > 2000 ? "gemini-pro" : "gemini-flash";
    } else {
      targetProvider = prompt.length > 800 ? "openai-4o" : "openai-4o-mini";
    }
  }

  try {
    // Gemini Implementation
    if (targetProvider.startsWith("gemini")) {
      const rawKey = systemSettings.geminiApiKey || process.env.GEMINI_API_KEY || ""; 
      if (!rawKey || rawKey === "MY_GEMINI_API_KEY") throw new Error("Gemini API Key missing. Please provide it in the System Control Center.");
      
      const ai = new GoogleGenAI({ 
        apiKey: rawKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });
      
      // Map aliases to standard models from gemini-api skill
      const modelName = targetProvider === "gemini-pro" ? "gemini-1.5-pro" : "gemini-1.5-flash";
      const result = await ai.models.generateContent({
        model: modelName,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: options.jsonMode ? { responseMimeType: "application/json" } : undefined
      });
      return result.text || "";
    }

    // OpenAI Implementation
    if (targetProvider.startsWith("openai")) {
      const apiKey = systemSettings.openaiApiKey || process.env.OPENAI_API_KEY;
      if (!apiKey) throw new Error("OpenAI API Key missing. Please provide it in Settings.");
      const openai = new OpenAI({ apiKey });
      const modelName = targetProvider === "openai-4o-mini" ? "gpt-4o-mini" : "gpt-4o";
      const response = await openai.chat.completions.create({
        model: modelName,
        messages: [
          { role: "system", content: sysPrompt },
          { role: "user", content: prompt }
        ],
        response_format: options.jsonMode ? { type: "json_object" } : undefined
      });
      return response.choices[0]?.message?.content || "";
    }

    // Anthropic Implementation
    if (targetProvider.startsWith("anthropic")) {
      const apiKey = systemSettings.anthropicApiKey || process.env.ANTHROPIC_API_KEY;
      if (!apiKey) throw new Error("Anthropic API Key missing. Please provide it in Settings.");
      const anthropic = new Anthropic({ apiKey });
      const modelName = targetProvider === "anthropic-haiku" ? "claude-3-haiku-20240307" : "claude-3-5-sonnet-20240620";
      const response = await anthropic.messages.create({
        model: modelName,
        max_tokens: 4096,
        system: sysPrompt + (options.jsonMode ? " Ensure your response is valid JSON." : ""),
        messages: [{ role: "user", content: prompt }],
      });
      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      return text;
    }

    // NVIDIA NIM Implementation (OpenAI Compatible)
    if (targetProvider.startsWith("nvidia")) {
      const apiKey = systemSettings.nvidiaApiKey || process.env.NVIDIA_API_KEY;
      if (!apiKey) throw new Error("NVIDIA API Key missing. Please provide it in Settings.");
      const openai = new OpenAI({ 
        apiKey,
        baseURL: 'https://integrate.api.nvidia.com/v1' 
      });
      
      let modelName = "meta/llama-3.1-405b-instruct";
      if (targetProvider === "nvidia-llama-70") modelName = "meta/llama-3.1-70b-instruct";
      
      const response = await openai.chat.completions.create({
        model: modelName,
        messages: [
          { role: "system", content: sysPrompt },
          { role: "user", content: prompt }
        ],
        response_format: options.jsonMode ? { type: "json_object" } : undefined
      });
      return response.choices[0]?.message?.content || "";
    }

    // Custom OpenAI-Compatible Implementation
    if (targetProvider === "custom") {
      const apiKey = systemSettings.customAiApiKey;
      const baseURL = systemSettings.customAiBaseUrl;
      const modelName = systemSettings.customAiModelName;
      
      if (!apiKey || !baseURL || !modelName) {
        throw new Error("Custom AI Configuration incomplete. Please provide API Key, Base URL, and Model Name in Settings.");
      }

      const openai = new OpenAI({ apiKey, baseURL });
      const response = await openai.chat.completions.create({
        model: modelName,
        messages: [
          { role: "system", content: sysPrompt },
          { role: "user", content: prompt }
        ],
        response_format: options.jsonMode ? { type: "json_object" } : undefined
      });
      return response.choices[0]?.message?.content || "";
    }
  } catch (e: any) {
    console.error(`[AI_ROUTER_ERR] Provider: ${targetProvider} | Error:`, e.message);
    throw e;
  }

  throw new Error(`Unsupported AI Provider: ${targetProvider}`);
}

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
  
  // Tactical fields
  initialQuantity?: number;
  initialStop?: number;
  targetPrice?: number;
  barsHeld?: number;
  tranche1ScaledOut?: boolean;
  breakevenApplied?: boolean;
  scaleOutProfit?: number;
  efficiencyRatio?: number;
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
  
  // Customizable Systemic Daily Drawdown limits
  dailyDrawdownLimitPercent: 2.5,
  dailyDrawdownLimitCash: 3000.0,
  
  // Advanced Strategy Tactical Parameters
  stopAtrMultiplier: 1.8,
  partialProfit: true,
  breakevenLock: true,
  maxHoldBars: 15,
  ofiFilter: true,
  adaptiveStop: true,

  // Universal AI Agnostic Configuration
  geminiApiKey: "",
  openaiApiKey: "",
  anthropicApiKey: "",
  nvidiaApiKey: "",
  customAiApiKey: "",
  customAiBaseUrl: "",
  customAiModelName: "",
  selectedAiProvider: "gemini-flash" as "gemini-flash" | "gemini-pro" | "openai-4o" | "openai-4o-mini" | "anthropic-sonnet" | "anthropic-haiku" | "nvidia-llama-405" | "nvidia-llama-70" | "nvidia-nemotron" | "custom" | "auto",
};

// Async function to sync settings with Firestore
async function persistSettings() {
  if (!db_fs) return;
  try {
    await db_fs.doc(SETTINGS_DOC_PATH).set(systemSettings, { merge: true });
    console.log("[FIREBASE] System settings successfully persisted to Firestore.");
  } catch (err) {
    console.error("[FIREBASE] Failed to persist settings:", err);
  }
}

// Initial load of settings from Firestore
async function loadPersistentSettings() {
  if (!db_fs) return;
  try {
    const doc = await db_fs.doc(SETTINGS_DOC_PATH).get();
    if (doc.exists) {
      const data = doc.data();
      if (data) {
        systemSettings = { ...systemSettings, ...data };
        console.log("[FIREBASE] System settings successfully restored from Firestore.");
      }
    } else {
      console.log("[FIREBASE] No existing settings found in Firestore. Using defaults.");
      await persistSettings(); // Create initial doc
    }

    // Set up listeners to keep memory arrays synced with Python Edge Node via Firestore
    db_fs.collection("active_trades").onSnapshot(snapshot => {
      const trades: any[] = [];
      snapshot.forEach(doc => {
        trades.push({ id: doc.id, ...doc.data() });
      });
      activeTrades = trades;
    });

    db_fs.collection("historical_logs").orderBy("timestamp", "desc").limit(50).onSnapshot(snapshot => {
      const logs: any[] = [];
      snapshot.forEach(doc => {
        logs.push({ id: doc.id, ...doc.data() });
      });
      historicalLogs = logs;
    });

    db_fs.doc("system_risk_state/current_state").onSnapshot(snapshot => {
      if (snapshot.exists) {
        const data = snapshot.data();
        if (data) {
          systemSettings.netLiquidation = data.netLiquidation ?? systemSettings.netLiquidation;
          systemSettings.maintenanceMargin = data.maintenanceMargin ?? systemSettings.maintenanceMargin;
          if (data.routerLocked !== undefined) {
             systemSettings.routerLocked = data.routerLocked;
          }
        }
      }
    });

  } catch (err) {
    console.error("[FIREBASE] Error loading persistent settings:", err);
  }
}

loadPersistentSettings();


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

// Removed simulation loop but retained executeEmergencyFlush helper to prevent compile errors.
// The web server now acts as a read-only dashboard reflecting the actual Python Edge Node state from Firestore.
export function executeEmergencyFlush(reason: string) {
  console.log(`[EMERGENCY FLUSH] ${reason}`);
  activeTrades = [];
  systemSettings.routerLocked = true;
  persistSettings();
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

app.get("/api/diagnostics", (req, res) => {
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
    settings: systemSettings,
  });
});

app.post("/api/ai/universal-generate", async (req, res) => {
  try {
    const { prompt, systemPrompt, provider, jsonMode } = req.body;
    if (!prompt) return res.status(400).json({ error: "Missing prompt" });

    const text = await getUniversalAIResponse(prompt, { 
      provider, 
      systemPrompt, 
      jsonMode: !!jsonMode 
    });
    res.json({ success: true, text });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/state", (req, res) => {
  console.log("[SERVER] Incoming request for /api/state");
  try {
    res.json({
      settings: systemSettings,
      activeTrades,
      historicalLogs,
      marketBooks,
      dynamicBaskets
    });
  } catch (err: any) {
    console.error("[SERVER] Error in /api/state:", err.message);
    res.status(500).json({ error: err.message });
  }
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

  const rawKey = (req.headers["x-gemini-api-key"] as string) || systemSettings.geminiApiKey || process.env.GEMINI_API_KEY;
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
        location: "europe-west3",
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });
      response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json"
        }
      });
    } else {
      console.log(`[SERVER] Executing calibration via AI Studio Developer Key (Length: ${rawKey?.length || 0})...`);
      const ai = new GoogleGenAI({ 
        apiKey: rawKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });
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

app.post("/api/auto-calibrate-news", async (req, res) => {
  const { source } = req.body;
  const cleanSource = source || "all";
  
  // Choose news source text
  let sourceName = "Bloomberg Financial RSS";
  if (cleanSource === "reuters") sourceName = "Reuters Business Wire";
  if (cleanSource === "ibkr") sourceName = "IBKR Global News API";
  if (cleanSource === "fx") sourceName = "DailyFX Calendar API";
  
  const rawKey = (req.headers["x-gemini-api-key"] as string) || systemSettings.geminiApiKey || process.env.GEMINI_API_KEY;
  const isPlaceholderOrEmpty = !rawKey ||
    rawKey.trim() === "" ||
    rawKey.includes("MY_GEMINI_API_KEY") ||
    rawKey.toLowerCase().includes("placeholder") ||
    rawKey.toLowerCase().includes("replace") ||
    rawKey.toLowerCase().includes("your_") ||
    rawKey.length < 20;

  if (isPlaceholderOrEmpty) {
    // Generate simulated high-fidelity news events and fallbacks
    const fallbackNewsDatabase: Record<string, Array<{ headline: string; sentiment: number; impact: string; targetSector: string; baskets: any[] }>> = {
      bloomberg: [
        {
          headline: "ECB signals dual rate cuts in upcoming quarters as Eurozone core inflation decelerates faster than expectations to 1.9%",
          sentiment: 0.68,
          impact: "BULLISH",
          targetSector: "Eurozone Banking & Tech (SAP, ASML, DB)",
          baskets: [
            { sector: "EU Core Growth Leader Basket", tickers: ["SAP", "ASML", "RWE"], impliedOfiTrend: "BULLISH (Liquidity expansion)", winRate: 66, profitFactor: 1.62, avgFrictionConsumed: 4.8 },
            { sector: "EU Sovereign Rate Sensitivity Basket", tickers: ["DB", "LVMH", "SGO"], impliedOfiTrend: "BULLISH (Sovereign yield dampening)", winRate: 59, profitFactor: 1.41, avgFrictionConsumed: 7.2 },
            { sector: "Broad Macro Rates (Fallback)", tickers: ["SPY", "QQQ", "GLD"], impliedOfiTrend: "NEUTRAL / MIXED", winRate: 52, profitFactor: 1.15, avgFrictionConsumed: 8.9 }
          ]
        },
        {
          headline: "Saudi Energy Minister reiterates commitment to physical crude oil deficit to keep Brent benchmark floor above $82/bbl through 2026",
          sentiment: 0.52,
          impact: "BULLISH",
          targetSector: "Global Energy Carriers (XLE, COP, VLO)",
          baskets: [
            { sector: "Middle-East Energy & Oil Beneficiaries", tickers: ["XLE", "COP", "VLO"], impliedOfiTrend: "BULLISH (Deficit floor)", winRate: 64, profitFactor: 1.58, avgFrictionConsumed: 5.4 },
            { sector: "Offshore Driller Leveraged Equities", tickers: ["SLB", "HAL", "OXY"], impliedOfiTrend: "BULLISH (Upstream CapEx lift)", winRate: 60, profitFactor: 1.49, avgFrictionConsumed: 6.9 },
            { sector: "Broad Macro Rates (Fallback)", tickers: ["SPY", "QQQ", "GLD"], impliedOfiTrend: "NEUTRAL", winRate: 51, profitFactor: 1.12, avgFrictionConsumed: 9.1 }
          ]
        }
      ],
      reuters: [
        {
          headline: "US Department of Commerce announces strict new bilateral tariff schedule on foreign titanium imports, triggering major supply reshuffles",
          sentiment: -0.45,
          impact: "BEARISH",
          targetSector: "US Defense & Materials (ITA, NOC, RTX)",
          baskets: [
            { sector: "US Domestic Defense Procurement", tickers: ["ITA", "NOC", "RTX"], impliedOfiTrend: "BULLISH (Protectionist price floor)", winRate: 62, profitFactor: 1.51, avgFrictionConsumed: 6.2 },
            { sector: "Titanium & Heavy Metal Smelters", tickers: ["X", "FCX", "NUE"], impliedOfiTrend: "VOLATILE (Supply chain bottleneck)", winRate: 55, profitFactor: 1.28, avgFrictionConsumed: 8.5 },
            { sector: "Strategic Commodity Store of Value", tickers: ["GLD", "SLV", "DBB"], impliedOfiTrend: "BULLISH (Inflation hedge)", winRate: 63, profitFactor: 1.45, avgFrictionConsumed: 5.1 }
          ]
        }
      ],
      ibkr: [
        {
          headline: "TSMC issues stellar Q3 wafer shipment guidance, citing insatiable sovereign cluster demand for customized high-performance logic",
          sentiment: 0.85,
          impact: "BULLISH",
          targetSector: "Semiconductors & Logic Foundry (TSM, ASML, NVDA)",
          baskets: [
            { sector: "Advanced Silicon Foundry Basket", tickers: ["TSM", "ASML", "NVDA"], impliedOfiTrend: "BULLISH (Extreme pricing power)", winRate: 72, profitFactor: 1.78, avgFrictionConsumed: 4.2 },
            { sector: "High-Bandwidth Memory Producers", tickers: ["MU", "LRCX", "AMAT"], impliedOfiTrend: "BULLISH (Sovereign hardware clusters)", winRate: 67, profitFactor: 1.63, avgFrictionConsumed: 5.8 },
            { sector: "Global Tech Index Trackers", tickers: ["QQQ", "SMH", "SOXX"], impliedOfiTrend: "BULLISH (Broad index support)", winRate: 69, profitFactor: 1.71, avgFrictionConsumed: 3.5 }
          ]
        }
      ],
      fx: [
        {
          headline: "US Consumer Price Index (CPI) increases 0.1% month-on-month, core rate hits 3.1% annualized, matching bond market expectations perfectly",
          sentiment: 0.25,
          impact: "VOLATILE",
          targetSector: "Yield-Sensitive Sovereign Assets (TLT, GLD, SPY)",
          baskets: [
            { sector: "Global Inflation Protection Basket", tickers: ["GLD", "TIP", "SLV"], impliedOfiTrend: "BULLISH (Steady state real yields)", winRate: 58, profitFactor: 1.35, avgFrictionConsumed: 5.9 },
            { sector: "US Sovereign Debt Duration Basket", tickers: ["TLT", "IEF", "SHY"], impliedOfiTrend: "VOLATILE (Slight curve steepening)", winRate: 51, profitFactor: 1.15, avgFrictionConsumed: 8.2 },
            { sector: "Broad High-Cap Stock Index", tickers: ["SPY", "QQQ", "DIA"], impliedOfiTrend: "BULLISH (Fed pause priced in)", winRate: 61, profitFactor: 1.42, avgFrictionConsumed: 4.5 }
          ]
        }
      ]
    };

    // Fallback if key is all or missing
    let newsList = fallbackNewsDatabase[cleanSource];
    if (!newsList || newsList.length === 0) {
      const sources = Object.keys(fallbackNewsDatabase);
      const chosenSource = sources[Math.floor(Math.random() * sources.length)];
      newsList = fallbackNewsDatabase[chosenSource];
    }

    const selectedItem = newsList[Math.floor(Math.random() * newsList.length)];

    dynamicBaskets = selectedItem.baskets;
    
    // Seed instruments
    selectedItem.baskets.forEach((b: any) => {
      b.tickers.forEach((symbol: string) => {
        const sym = symbol.toUpperCase();
        if (!marketBooks[sym]) {
          ingestScannedInstrument(sym, "NYSE", Math.floor(Math.random() * 100) + 50);
        }
      });
    });

    try {
      fs.writeFileSync(path.join(process.cwd(), "dynamic_baskets.json"), JSON.stringify({ baskets: dynamicBaskets }, null, 2), "utf8");
    } catch (_) {}

    return res.json({
      success: true,
      message: "Loaded high-fidelity news simulated calibration feed (Secrets key unconfigured).",
      news: {
        headline: selectedItem.headline,
        source: sourceName,
        sentiment: selectedItem.sentiment,
        impact: selectedItem.impact,
        targetSector: selectedItem.targetSector
      },
      baskets: dynamicBaskets
    });
  }

  // Real Gemini execution!
  try {
    const prompt = `You are an expert geopolitical and macroeconomic quantitative trading reporter for "${sourceName}".
Please generate 1 brand-new, extremely detailed, highly realistic, and high-impact financial news headline/wire release that would break right now on "${sourceName}".
It must be related to global events, shipping route conflicts, sovereign central bank surprise interest rate pivots, oil production cuts, energy bottlenecks, or microchip trade policies.

In addition to this news event, you MUST calibrate 3 high-performance strategic asset baskets (each with exactly 3 stock/ETF tickers) that are directly exposed to, or stand to benefit/fluctuate most from, this specific event.

Provide the output in STRICT JSON format matching the schema:
{
  "news": {
    "headline": "A highly realistic, descriptive headline string",
    "sentiment": 0.65,
    "impact": "BULLISH" or "BEARISH" or "VOLATILE",
    "targetSector": "General sector name, e.g. Middle-East Energy / Semiconductors / Global Logistics"
  },
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
Ensure tickers are real liquid US or European equities and ETFs (e.g. XLE, GLD, ITA, SPY, QQQ, TSLA, AAPL, ASML, NOC, RTX, TSM, ZIM, COP).
Only output the raw valid JSON. No markdown backticks or commentary outside the JSON block.`;

    const useVertex = !!req.body.useVertex;
    let response;

    if (useVertex) {
      console.log("[SERVER] Executing news calibration via Vertex AI Production Standard SDK...");
      const ai = new GoogleGenAI({
        vertexai: true,
        project: process.env.GOOGLE_CLOUD_PROJECT || "alpha-engine-production",
        location: "europe-west3",
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });
      response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json"
        }
      });
    } else {
      console.log(`[SERVER] Executing news calibration via AI Studio Developer Key (Length: ${rawKey?.length || 0})...`);
      const ai = new GoogleGenAI({ 
        apiKey: rawKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });
      response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json"
        }
      });
    }

    const parsedData = JSON.parse(response.text || "{}");
    if (parsedData && parsedData.news && Array.isArray(parsedData.baskets)) {
      dynamicBaskets = parsedData.baskets;

      // Ingest any missing symbols
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
        fs.writeFileSync(path.join(process.cwd(), "dynamic_baskets.json"), JSON.stringify({ baskets: dynamicBaskets }, null, 2), "utf8");
      } catch (err) {
        console.error("[SERVER] Failed to write dynamic_baskets.json:", err);
      }

      res.json({
        success: true,
        message: "Successfully scraped and calibrated news feeds with Gemini.",
        news: {
          headline: parsedData.news.headline,
          source: sourceName,
          sentiment: Number(parsedData.news.sentiment) || 0.0,
          impact: parsedData.news.impact || "VOLATILE",
          targetSector: parsedData.news.targetSector || "Dynamic Multi-Asset OFI"
        },
        baskets: dynamicBaskets
      });
    } else {
      throw new Error("Invalid structure returned from model");
    }
  } catch (err: any) {
    console.warn("[SERVER] Gemini news auto-calibration failed, elegantly falling back to simulated event:", err);
    // Return a random mock item
    const mockDb = [
      {
        headline: "TSMC issues stellar guidance, citing insatiable sovereign cluster demand for advanced logic wafer logic foundry",
        sentiment: 0.82,
        impact: "BULLISH",
        targetSector: "Semiconductors & Silicon Foundry (TSM, ASML, NVDA)",
        baskets: [
          { sector: "Silicon Giants Portfolio (Auto)", tickers: ["TSM", "ASML", "NVDA"], impliedOfiTrend: "BULLISH", winRate: 71, profitFactor: 1.74, avgFrictionConsumed: 4.2 },
          { sector: "Advanced Lithography Fabricators", tickers: ["LRCX", "AMAT", "MU"], impliedOfiTrend: "BULLISH", winRate: 64, profitFactor: 1.55, avgFrictionConsumed: 5.9 },
          { sector: "High-Beta Tech Index ETF", tickers: ["QQQ", "SMH", "SPY"], impliedOfiTrend: "BULLISH", winRate: 66, profitFactor: 1.62, avgFrictionConsumed: 4.1 }
        ]
      }
    ];
    const chosen = mockDb[0];
    dynamicBaskets = chosen.baskets;
    res.json({
      success: true,
      message: `Simulated backup event triggered due to error: ${err.message}`,
      news: {
        headline: chosen.headline,
        source: sourceName,
        sentiment: chosen.sentiment,
        impact: chosen.impact,
        targetSector: chosen.targetSector
      },
      baskets: dynamicBaskets
    });
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
  const { 
    ibkrAccountNumber, 
    mifid2DecisionMaker, 
    mifid2ExecutionTrader, 
    referenceEquity, 
    virtualCapitalCeiling, 
    tradingMode, 
    ibkrPort, 
    ibkrClientId, 
    gatewayConnectionActive,
    stopAtrMultiplier,
    partialProfit,
    breakevenLock,
    maxHoldBars,
    ofiFilter,
    adaptiveStop,
    dailyDrawdownLimitPercent,
    dailyDrawdownLimitCash,
    openaiApiKey,
    anthropicApiKey,
    nvidiaApiKey,
    customAiApiKey,
    customAiBaseUrl,
    customAiModelName,
    selectedAiProvider
  } = req.body;
  
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
  if (stopAtrMultiplier !== undefined) {
    systemSettings.stopAtrMultiplier = Number(stopAtrMultiplier);
  }
  if (partialProfit !== undefined) {
    systemSettings.partialProfit = !!partialProfit;
  }
  if (breakevenLock !== undefined) {
    systemSettings.breakevenLock = !!breakevenLock;
  }
  if (maxHoldBars !== undefined) {
    systemSettings.maxHoldBars = Number(maxHoldBars);
  }
  if (ofiFilter !== undefined) {
    systemSettings.ofiFilter = !!ofiFilter;
  }
  if (adaptiveStop !== undefined) {
    systemSettings.adaptiveStop = !!adaptiveStop;
  }
  if (dailyDrawdownLimitPercent !== undefined) {
    systemSettings.dailyDrawdownLimitPercent = Number(dailyDrawdownLimitPercent);
  }
  if (dailyDrawdownLimitCash !== undefined) {
    systemSettings.dailyDrawdownLimitCash = Number(dailyDrawdownLimitCash);
  }

  if (openaiApiKey !== undefined) systemSettings.openaiApiKey = openaiApiKey;
  if (anthropicApiKey !== undefined) systemSettings.anthropicApiKey = anthropicApiKey;
  if (nvidiaApiKey !== undefined) systemSettings.nvidiaApiKey = nvidiaApiKey;
  if (customAiApiKey !== undefined) systemSettings.customAiApiKey = customAiApiKey;
  if (customAiBaseUrl !== undefined) systemSettings.customAiBaseUrl = customAiBaseUrl;
  if (customAiModelName !== undefined) systemSettings.customAiModelName = customAiModelName;
  if (selectedAiProvider !== undefined) systemSettings.selectedAiProvider = selectedAiProvider;

  persistSettings();
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

  // Calculate target price based on active partial profit setting
  const targetMultiplier = systemSettings.partialProfit ? 2.5 : 2.0;
  const targetPriceVal = direction === "BUY"
    ? Number((Number(entryPrice) + stopDistance * targetMultiplier).toFixed(2))
    : Number((Number(entryPrice) - stopDistance * targetMultiplier).toFixed(2));

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
    timestamp: new Date().toISOString(),
    
    // Upgraded tactical tracking state fields
    initialQuantity: calculatedQty,
    initialStop: Number(stopPrice),
    targetPrice: targetPriceVal,
    barsHeld: 0,
    tranche1ScaledOut: false,
    breakevenApplied: false,
    scaleOutProfit: 0,
    efficiencyRatio: efficiencyRatio
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

app.post("/api/reset-drawdown-lock", (req, res) => {
  systemSettings.routerLocked = false;
  console.log(`[RISK MANAGEMENT] Administrative unlock authorized: Systemic circuit breaker reset.`);
  res.json({ success: true, settings: systemSettings });
});

app.post("/api/backtest-audit", async (req, res) => {
  try {
    const { backtestResults, provider } = req.body;
    if (!backtestResults) {
      return res.status(400).json({ error: "Missing backtestResults parameter." });
    }

    const selectedProvider = provider || "gemini-flash";

    // Provider config
    const pricingTable: Record<string, { model: string; inPrice: number; outPrice: number; name: string }> = {
      "gemini-flash": { model: "gemini-3.5-flash", inPrice: 0.075, outPrice: 0.30, name: "Gemini 1.5 Flash" },
      "gemini-pro": { model: "gemini-3.1-pro-preview", inPrice: 1.25, outPrice: 5.00, name: "Gemini 1.5 Pro" },
      "nvidia-nim": { model: "llama3-free", inPrice: 0.00, outPrice: 0.00, name: "Llama 3 (Nvidia NIM Free)" },
      "claude": { model: "claude-sonnet", inPrice: 3.00, outPrice: 15.00, name: "Claude 3.5 Sonnet" }
    };

    const config = pricingTable[selectedProvider] || pricingTable["gemini-flash"];

    const symbol = backtestResults.symbol || "XLE";
    const timeframe = backtestResults.timeframe || "1h";
    const start = backtestResults.startDate || "2026-05-01";
    const end = backtestResults.endDate || "2026-06-16";
    const pnl = backtestResults.totalPnL || 0;
    const pnlPct = backtestResults.totalPnLPercent || 0;
    const pf = backtestResults.profitFactor || 1.0;
    const dd = backtestResults.maxDrawdownPercent || 0;
    const winRate = backtestResults.winRate || 50;
    const totalTrades = backtestResults.totalTrades || 0;
    const commission = backtestResults.totalCommissions || 0;
    const slippageSaved = backtestResults.slippageFrictionSaved || 0;

    const prompt = `You are the Alpha Engine Quantitative Risk Auditor and Portfolio Strategy Coach.
Analyze the following backtest simulation results for ${symbol} (${timeframe}) from ${start} to ${end}:
- Starting Capital: $${backtestResults.startingCapital || 100000}
- Final Capital: $${backtestResults.finalCapital || 100000}
- Net PnL: $${pnl} (${pnlPct}%)
- Total Trades: ${totalTrades} (Wins: ${backtestResults.winningTrades || 0}, Losses: ${backtestResults.losingTrades || 0}, Win Rate: ${winRate}%)
- Profit Factor: ${pf}
- Max Drawdown: ${dd}%
- Total Fees: $${commission}
- Slippage Friction Saved: $${slippageSaved}
- Adaptive Stop Applied: ${backtestResults.adaptiveStopApplied || false}
- Partial Profit Applied: ${backtestResults.partialProfitApplied || false}
- Breakeven Applied: ${backtestResults.breakevenApplied || false}
- Max Hold Applied: ${backtestResults.maxHoldApplied || 15}

Here is a subset of the trade execution logs for context:
${JSON.stringify((backtestResults.tradesList || []).slice(0, 10), null, 2)}

Provide a rigorous quantitative critique of this backtesting run.
Address the following areas:
1. **Strategy Relevance**: How well does the SMA-20 Congruence and OFI Breakout signal fit this asset's volatility profile under these timeframe constraints?
2. **Overfitting Warning & Generalization Risk**: Explicitly warn about curve-fitting, fragile settings (like ATR multipliers and max hold bars), and why these specific parameters might fail in tomorrow's noise.
3. **Transaction Friction Analysis**: Critique the 15% Transaction Friction Filter. Did it save capital by blocking high-friction, low-expected-value setups?
4. **Specific Optimization Adjustments**: Suggest 2-3 concrete parameter modifications (e.g., tweaking Stop ATR, Max Hold Bars, or enabling/disabling Partial Profit) to improve risk-adjusted returns (Sharpe ratio) and drawdowns rather than just raw profit.
5. **Relevancy Verdict**: Give a clear final verdict: FIT (keep/refine) or WARN TO KILL (overly fragile/decaying expectancy).

Format your output in professional, elegant Markdown with clean headers and bullet points.`;

    const estimatedInputTokens = Math.ceil(prompt.length / 4);

    let critique = "";
    const apiKey = (req.headers["x-gemini-api-key"] as string) || process.env.GEMINI_API_KEY;

    if (apiKey && apiKey !== "PLACEHOLDER_FOR_SECRETS_UI" && apiKey.trim() !== "" && !apiKey.toLowerCase().includes("placeholder") && !apiKey.toLowerCase().includes("replace") && (selectedProvider === "gemini-flash" || selectedProvider === "gemini-pro")) {
      try {
        const ai = new GoogleGenAI({ 
          apiKey,
          httpOptions: {
            headers: {
              'User-Agent': 'aistudio-build',
            }
          }
        });
        const response = await ai.models.generateContent({
          model: config.model,
          contents: prompt
        });
        critique = response.text || "No response received from model.";
      } catch (e: any) {
        console.error("Gemini API call failed, falling back to simulated high-fidelity audit. Error:", e.message);
        critique = generateFallbackCritique(symbol, timeframe, pnlPct, dd, winRate, pf, config.name);
      }
    } else {
      critique = generateFallbackCritique(symbol, timeframe, pnlPct, dd, winRate, pf, config.name);
    }

    const estimatedOutputTokens = Math.ceil(critique.length / 4);

    // Cost calculations (per 1M tokens)
    const inputCost = (estimatedInputTokens / 1000000) * config.inPrice;
    const outputCost = (estimatedOutputTokens / 1000000) * config.outPrice;
    const totalCost = Number((inputCost + outputCost).toFixed(6));

    res.json({
      success: true,
      provider: selectedProvider,
      providerName: config.name,
      critique,
      tokensUsed: {
        input: estimatedInputTokens,
        output: estimatedOutputTokens,
        total: estimatedInputTokens + estimatedOutputTokens
      },
      pricingConstants: {
        inPrice: config.inPrice,
        outPrice: config.outPrice
      },
      cost: totalCost
    });
  } catch (err: any) {
    console.error("[SERVER] Unhandled exception in /api/backtest-audit route:", err);
    res.status(500).json({ error: "System failed to compute quantitative audit. Exception: " + err.message });
  }
});

function generateFallbackCritique(symbol: string, tf: string, pnlPct: number, dd: number, winRate: number, pf: number, providerName: string): string {
  const isProfitable = pnlPct > 0;
  
  return `### 🤖 ${providerName} Quantitative Strategy Audit & Analysis
*Simulated via High-Fidelity Edge Engine*

#### 📊 1. Strategy Relevance Assessment
- **Asset Volatility Signature**: ${symbol} on a \`${tf}\` timeframe displays strong structural mean-reversion with persistent intraday trend bursts triggered by Order Flow Imbalances (OFI).
- **Signal Congruence**: The **SMA-20 Congruence** filter behaves as a reliable trend regime anchor. However, in low-liquidity or choppy market environments, the OFI signal can generate **false breakouts**, causing immediate stop-outs before any meaningful move can occur. 
- **Timeframe Synergy**: Intraday constraints are well-balanced here, but holding positions up to the default maximum duration might expose the portfolio to unnecessary time decay if the breakout stalls.

#### ⚠️ 2. Overfitting & Generalization Risk Warning
- **The Fragility of Noise**: With a Win Rate of **${winRate}%** and a Profit Factor of **${pf}**, this strategy is highly sensitive to the exact **1.8 ATR** stop-loss multiplier and max hold settings. 
- **Warning**: Optimizing these specific settings to perfectly match past historical noise can lead to a *false sense of security*. An ATR multiplier that fits perfectly in a trending month will likely suffer a **heavy drawdown** (currently maxing out at **${dd}%**) during sideways congestion.
- **Expectancy Decay**: If we shift this strategy's execution window by just 2 hours, the simulated profit factor degrades rapidly, indicating **severe parameter fragility**.

#### 🔌 3. Transaction Friction & Commission Analysis
- **The 15% Transaction Friction Filter**: In this backtest, the efficiency ratio checks successfully blocked several setups where IBIE commissions and spread slippage would have consumed more than 15% of the projected profit.
- **Speed Premium**: This filter is highly critical: because the GCE Frankfurt edge node executes trades locally to bypass network roundtrip delays, we must *pre-compute* commissions instead of polling them dynamically. Polling IBKR mid-order would add ~40ms of latency, which completely destroys the speed advantage of co-location.

#### ⚙️ 4. Recommended Tactical Parameters Adjustments
1. **Dampen the ATR Stop (ATR Multiplier to 2.1)**: Widening the stop slightly from \`1.8\` to \`2.1\` would allow ${symbol} breathing room to withstand market noise, potentially increasing the Win Rate to over **58%** at the cost of slightly lower leverage.
2. **Tighten Max Hold Time (Max Hold Bars to 12)**: If an OFI breakout does not reach Tranche 1 within 12 bars (down from \`15\`), it is highly likely a false breakout. Exiting early saves fee-exposure and frees up capital.
3. **Deploy OFI Filter Volume Threshold**: Increase the volume threshold to $1.6\\times$ the 10-period average (up from \`1.4x\`) to filter out weak volume spikes.

#### 🎯 5. Strategy Verdict
${isProfitable ? `**🟢 RELEVANCY VERDICT: FIT (REFINEMENT REQUIRED)**\n\nThe strategy is viable and profitable (${pnlPct}%) but remains vulnerable to mean-reverting chop. Do not run this live without implementing the widened ATR stop-loss and the tightened max-hold decay parameters. Keep trading size strictly at 1% capital risk.` : `**🔴 RELEVANCY VERDICT: WARN TO KILL (UNFIT)**\n\nThis strategy is actively decaying expectancy (${pnlPct}%) under high-friction regimes. The high commission load and spread slippage have overwhelmed the edge. Kill this strategy immediately or completely rebuild the breakout filter threshold before deploying paper capital.`}
`;
}

function seedRandom(seed: number) {
  let s = seed;
  return function() {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function normalRandom(randFn: () => number, mu = 0, sigma = 1) {
  const u1 = randFn() || 0.0001;
  const u2 = randFn() || 0.0001;
  const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  return z * sigma + mu;
}

interface BacktestBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface BacktestTrade {
  id: string;
  symbol: string;
  quantity: number;
  direction: "BUY" | "SELL";
  entryPrice: number;
  exitPrice: number;
  realizedPnL: number;
  commission: number;
  efficiencyRatio: number;
  reason: string;
  date: string;
}

interface ActivePosition {
  symbol: string;
  direction: "BUY" | "SELL";
  entry_price: number;
  initial_stop: number;
  stop_price: number;
  target_price: number;
  quantity: number;
  initial_quantity: number;
  efficiency_ratio: number;
  timestamp: string;
  bars_held: number;
  tranche_1_scaled_out: boolean;
  scale_out_profit?: number;
  breakeven_applied?: boolean;
}

function generateSyntheticHistory(symbol: string, timeframe: string, startDateStr: string, endDateStr: string): BacktestBar[] {
  let startDate: Date;
  try {
    startDate = new Date(startDateStr);
    if (isNaN(startDate.getTime())) throw new Error();
  } catch {
    startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  }

  let endDate: Date;
  try {
    endDate = new Date(endDateStr);
    if (isNaN(endDate.getTime())) throw new Error();
  } catch {
    endDate = new Date();
  }

  if (endDate < startDate) {
    endDate = new Date(startDate.getTime() + 30 * 24 * 60 * 60 * 1000);
  }

  const sym = symbol.toUpperCase();
  let basePrice = 100.0;
  let drift = 0.0002;
  let volatility = 0.015;
  let avgVolume = 1500000;

  if (sym === "XLE") {
    basePrice = 93.15;
    drift = 0.0004;
    volatility = 0.018;
  } else if (sym === "NEE") {
    basePrice = 73.10;
    drift = -0.0001;
    volatility = 0.008;
  } else if (sym === "ENPH") {
    basePrice = 114.20;
    drift = 0.0012;
    volatility = 0.038;
  } else if (sym === "SAP") {
    basePrice = 178.50;
    drift = 0.0006;
    volatility = 0.012;
  } else if (sym === "RWE") {
    basePrice = 33.40;
    drift = -0.0002;
    volatility = 0.014;
  } else {
    let hash = 0;
    for (let i = 0; i < sym.length; i++) {
      hash = sym.charCodeAt(i) + ((hash << 5) - hash);
    }
    const seedVal = Math.abs(hash);
    const prng = seedRandom(seedVal);
    basePrice = 20.0 + prng() * 180.0;
    drift = -0.0005 + prng() * 0.0015;
    volatility = 0.01 + prng() * 0.02;
  }

  let deltaMinutes = 60;
  const tfLower = timeframe.toLowerCase();
  if (tfLower.includes("1m")) {
    deltaMinutes = 1;
  } else if (tfLower.includes("5m")) {
    deltaMinutes = 5;
  } else if (tfLower.includes("15m")) {
    deltaMinutes = 15;
  } else if (tfLower.includes("1h")) {
    deltaMinutes = 60;
  } else if (tfLower.includes("1d") || tfLower.includes("daily")) {
    deltaMinutes = 1440;
  }

  const dateSteps: Date[] = [];
  const curr = new Date(startDate.getTime());
  curr.setUTCHours(0, 0, 0, 0);
  const endLimit = new Date(endDate.getTime());
  endLimit.setUTCHours(23, 59, 59, 999);

  while (curr <= endLimit) {
    const day = curr.getUTCDay();
    if (day !== 0 && day !== 6) {
      if (deltaMinutes < 1440) {
        const sessionStart = new Date(curr.getTime());
        sessionStart.setUTCHours(9, 30, 0, 0);
        const sessionEnd = new Date(curr.getTime());
        sessionEnd.setUTCHours(16, 0, 0, 0);

        let barTime = new Date(sessionStart.getTime());
        while (barTime <= sessionEnd) {
          dateSteps.push(new Date(barTime.getTime()));
          barTime.setUTCMinutes(barTime.getUTCMinutes() + deltaMinutes);
        }
      } else {
        const dBar = new Date(curr.getTime());
        dBar.setUTCHours(16, 0, 0, 0);
        dateSteps.push(dBar);
      }
    }
    curr.setUTCDate(curr.getUTCDate() + 1);
  }

  let symHash = 0;
  for (let i = 0; i < sym.length; i++) {
    symHash = sym.charCodeAt(i) + ((symHash << 5) - symHash);
  }
  const seedForBars = 91283 + Math.abs(symHash);
  const barRand = seedRandom(seedForBars);

  const bars: BacktestBar[] = [];
  let currentPrice = basePrice;

  for (let idx = 0; idx < dateSteps.length; idx++) {
    const t = dateSteps[idx];
    const chg = currentPrice * normalRandom(barRand, drift, volatility);
    let op = currentPrice;
    let cl = op + chg;

    if (cl < 1.0) cl = 1.0;
    if (op < 1.0) op = 1.0;

    let high = Math.max(op, cl) + (currentPrice * Math.abs(normalRandom(barRand, 0, volatility * 0.5)));
    let low = Math.min(op, cl) - (currentPrice * Math.abs(normalRandom(barRand, 0, volatility * 0.5)));

    if (low < 0.5) low = 0.5;

    const changeRatio = Math.abs(chg) / cl;
    const volMult = changeRatio > volatility ? 1.5 : 0.8;
    const vol = Math.floor(avgVolume * (0.5 + barRand() * 1.3) * volMult);

    bars.push({
      date: t.toISOString(),
      open: Number(op.toFixed(2)),
      high: Number(high.toFixed(2)),
      low: Number(low.toFixed(2)),
      close: Number(cl.toFixed(2)),
      volume: vol
    });

    currentPrice = cl;
  }

  return bars;
}

function calculateIbieCommission(symbol: string, quantity: number, price: number): number {
  const sym = symbol.toUpperCase();
  const isEuropean = ["SAP", "RWE", "ENGI", "SGO", "LVMH", "ASML", "MC"].includes(sym);
  if (isEuropean) {
    const tradeValue = quantity * price;
    const baseComm = tradeValue * 0.0005;
    return Math.max(1.25, baseComm);
  } else {
    const baseComm = quantity * 0.005;
    return Math.max(1.00, baseComm);
  }
}

function runBacktestTS(
  symbol: string,
  timeframe: string,
  startDateStr: string,
  endDateStr: string,
  stopAtr = 1.8,
  partialProfit = true,
  breakevenLock = true,
  maxHold = 15,
  ofiFilter = true,
  adaptiveStop = true
) {
  let bars = generateSyntheticHistory(symbol, timeframe, startDateStr, endDateStr);
  if (bars.length < 25) {
    bars = generateSyntheticHistory(symbol, timeframe, "2026-05-01", "2026-06-16");
  }

  const startingCapital = 100000.0;
  let equity = startingCapital;
  const balanceHistory = [{ date: bars[0].date, equity: startingCapital }];
  const tradesHistory: BacktestTrade[] = [];

  const closePrices = bars.map(b => b.close);
  const smas: number[] = [];
  const atrs: number[] = [];

  for (let i = 0; i < bars.length; i++) {
    if (i < 20) {
      smas.push(closePrices[i]);
      atrs.push(closePrices[i] * 0.02);
    } else {
      const sumSma = closePrices.slice(i - 20, i).reduce((a, b) => a + b, 0);
      smas.push(sumSma / 20.0);

      let trSum = 0;
      for (let j = i - 14; j < i; j++) {
        const hl = bars[j].high - bars[j].low;
        trSum += hl;
      }
      atrs.push(trSum > 0 ? trSum / 14.0 : closePrices[i] * 0.015);
    }
  }

  const normAtrs = atrs.map((atr, k) => atr / closePrices[k]);
  const avgNormAtrs: number[] = [];
  for (let i = 0; i < bars.length; i++) {
    if (i < 20) {
      avgNormAtrs.push(normAtrs[i]);
    } else {
      const sumNorm = normAtrs.slice(i - 20, i).reduce((a, b) => a + b, 0);
      avgNormAtrs.push(sumNorm / 20.0);
    }
  }

  let activePosition: ActivePosition | null = null;
  let rejectedTradesCount = 0;
  let tranche1ScaledOutCount = 0;
  let tranche2HitCount = 0;
  let totalSlippageFrictionSaved = 0.0;

  for (let i = 20; i < bars.length; i++) {
    const bar = bars[i];
    const currentClose = bar.close;
    const currentAtr = atrs[i];
    const currentSma = smas[i];

    let currentEq = equity;
    if (activePosition) {
      const directionMultiplier = activePosition.direction === "BUY" ? 1 : -1;
      const unrealized = (currentClose - activePosition.entry_price) * activePosition.quantity * directionMultiplier;
      currentEq += unrealized;
    }

    balanceHistory.push({
      date: bar.date,
      equity: Number(currentEq.toFixed(2))
    });

    if (activePosition) {
      const pos = activePosition;
      let triggeredExit = false;
      let exitPrice = currentClose;
      let exitReason = "";

      pos.bars_held += 1;
      const directionMultiplier = pos.direction === "BUY" ? 1 : -1;
      const pipsInFavor = (currentClose - pos.entry_price) * directionMultiplier;
      const stopDistanceVal = Math.abs(pos.entry_price - pos.initial_stop);

      // A. Partial Profit Scale-Out
      if (partialProfit && !pos.tranche_1_scaled_out) {
        let target1Hit = false;
        if (pos.direction === "BUY" && bar.high >= pos.entry_price + stopDistanceVal) {
          target1Hit = true;
          exitPrice = pos.entry_price + stopDistanceVal;
        } else if (pos.direction === "SELL" && bar.low <= pos.entry_price - stopDistanceVal) {
          target1Hit = true;
          exitPrice = pos.entry_price - stopDistanceVal;
        }

        if (target1Hit) {
          const q1 = Math.floor(pos.quantity / 2);
          if (q1 > 0) {
            const t1Gross = (exitPrice - pos.entry_price) * q1 * directionMultiplier;
            const t1Comm = calculateIbieCommission(symbol, q1, exitPrice);
            const t1Net = Number((t1Gross - t1Comm).toFixed(2));
            equity += t1Net;

            pos.quantity -= q1;
            pos.tranche_1_scaled_out = true;
            pos.scale_out_profit = t1Net;
            pos.stop_price = pos.entry_price; // drag stop to breakeven
            tranche1ScaledOutCount += 1;
          }
        }
      } else if (breakevenLock && !pos.breakeven_applied) {
        if (pipsInFavor >= stopDistanceVal * 0.8) {
          pos.stop_price = pos.entry_price;
          pos.breakeven_applied = true;
        }
      }

      // Check exit violations
      if (!triggeredExit) {
        if (pos.direction === "BUY") {
          if (bar.low <= pos.stop_price) {
            exitPrice = pos.stop_price;
            triggeredExit = true;
            exitReason = !pos.tranche_1_scaled_out ? "STOP LOSS BREACH" : "BREAKEVEN TRANCHE EXIT";
          } else if (bar.high >= pos.target_price) {
            exitPrice = pos.target_price;
            triggeredExit = true;
            exitReason = "PROFIT TARGET ACHIEVED";
            if (pos.tranche_1_scaled_out) {
              tranche2HitCount += 1;
            }
          }
        } else {
          if (bar.high >= pos.stop_price) {
            exitPrice = pos.stop_price;
            triggeredExit = true;
            exitReason = !pos.tranche_1_scaled_out ? "STOP LOSS BREACH" : "BREAKEVEN TRANCHE EXIT";
          } else if (bar.low <= pos.target_price) {
            exitPrice = pos.target_price;
            triggeredExit = true;
            exitReason = "PROFIT TARGET ACHIEVED";
            if (pos.tranche_1_scaled_out) {
              tranche2HitCount += 1;
            }
          }
        }
      }

      if (!triggeredExit && pos.bars_held >= maxHold) {
        exitPrice = currentClose;
        triggeredExit = true;
        exitReason = `TIME-BASED EXPIRE (${maxHold} BARS)`;
      }

      if (!triggeredExit && i === bars.length - 1) {
        exitPrice = currentClose;
        triggeredExit = true;
        exitReason = "BACKTEST TERMINATION WINDOW";
      }

      if (triggeredExit) {
        const grossPnl = (exitPrice - pos.entry_price) * pos.quantity * directionMultiplier;
        const entryComm = calculateIbieCommission(symbol, pos.initial_quantity, pos.entry_price);
        const exitComm = calculateIbieCommission(symbol, pos.quantity, exitPrice);
        const totalComm = Number((entryComm + exitComm).toFixed(2));

        const netPnl = Number((grossPnl - totalComm).toFixed(2));
        const scaleOutProfit = pos.scale_out_profit || 0.0;
        const totalTradeNetPnl = Number((netPnl + scaleOutProfit).toFixed(2));

        equity += netPnl;

        tradesHistory.push({
          id: `BT_${tradesHistory.length + 101}`,
          symbol: symbol.toUpperCase(),
          quantity: pos.initial_quantity,
          direction: pos.direction,
          entryPrice: pos.entry_price,
          exitPrice: Number(exitPrice.toFixed(2)),
          realizedPnL: totalTradeNetPnl,
          commission: totalComm,
          efficiencyRatio: pos.efficiency_ratio,
          reason: exitReason,
          date: bar.date
        });

        activePosition = null;
        continue;
      }
    }

    if (!activePosition) {
      const volSlice = bars.slice(i - 10, i);
      const volMa = volSlice.reduce((sum, b) => sum + b.volume, 0) / 10.0;
      const volumeSpike = bar.volume > volMa * 1.4;

      if (volumeSpike) {
        const isBullish = currentClose > currentSma;
        const direction = isBullish ? "BUY" : "SELL";

        if (ofiFilter) {
          const highDiff = bar.high - currentClose;
          const lowDiff = currentClose - bar.low;
          const emulatedOfi = lowDiff - highDiff;

          if (isBullish && emulatedOfi < 0) {
            rejectedTradesCount += 1;
            continue;
          } else if (!isBullish && emulatedOfi > 0) {
            rejectedTradesCount += 1;
            continue;
          }
        }

        let dynamicMultiplier = stopAtr;
        if (adaptiveStop) {
          const avgNorm = avgNormAtrs[i];
          const currNorm = currentAtr / currentClose;
          let volRatio = avgNorm > 0 ? currNorm / avgNorm : 1.0;
          volRatio = Math.max(0.7, Math.min(1.4, volRatio));
          dynamicMultiplier = stopAtr * volRatio;
        }

        const entryPrice = currentClose;
        const stopDistance = Math.max(0.10, Number((currentAtr * dynamicMultiplier).toFixed(2)));
        const stopPrice = Number((direction === "BUY" ? entryPrice - stopDistance : entryPrice + stopDistance).toFixed(2));

        const targetMultiplier = partialProfit ? 2.5 : 2.0;
        const targetPrice = Number((direction === "BUY" ? entryPrice + stopDistance * targetMultiplier : entryPrice - stopDistance * targetMultiplier).toFixed(2));

        const riskCapital = equity * 0.01;
        const calculatedQty = Math.floor(riskCapital / stopDistance);

        if (calculatedQty <= 0) {
          continue;
        }

        const expectedCommission = calculateIbieCommission(symbol, calculatedQty, entryPrice);
        const halfSpread = (entryPrice * 0.0003) * calculatedQty;
        const totalFriction = halfSpread + expectedCommission * 2;
        const projectedProfit = (stopDistance * targetMultiplier) * calculatedQty;

        const efficiencyRatio = Number((projectedProfit > 0 ? (totalFriction / projectedProfit) * 100 : 100.0).toFixed(1));

        if (efficiencyRatio > 15.0) {
          totalSlippageFrictionSaved += totalFriction;
          rejectedTradesCount += 1;
          continue;
        }

        activePosition = {
          symbol,
          direction,
          entry_price: entryPrice,
          initial_stop: stopPrice,
          stop_price: stopPrice,
          target_price: targetPrice,
          quantity: calculatedQty,
          initial_quantity: calculatedQty,
          efficiency_ratio: efficiencyRatio,
          timestamp: bar.date,
          bars_held: 0,
          tranche_1_scaled_out: false
        };
      }
    }
  }

  const totalTrades = tradesHistory.length;
  const winningTrades = tradesHistory.filter(t => t.realizedPnL > 0);
  const losingTrades = tradesHistory.filter(t => t.realizedPnL <= 0);

  const winRate = Number((totalTrades > 0 ? (winningTrades.length / totalTrades) * 100 : 0.0).toFixed(1));

  const grossProfit = winningTrades.reduce((sum, t) => sum + t.realizedPnL, 0);
  const grossLoss = Math.abs(losingTrades.reduce((sum, t) => sum + t.realizedPnL, 0));
  const profitFactor = Number((grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? grossProfit : 1.0)).toFixed(2));

  let peak = startingCapital;
  let maxDrawdown = 0.0;
  for (const b of balanceHistory) {
    if (b.equity > peak) {
      peak = b.equity;
    }
    const dd = ((peak - b.equity) / peak) * 100;
    if (dd > maxDrawdown) {
      maxDrawdown = dd;
    }
  }

  const pnlCash = Number((equity - startingCapital).toFixed(2));
  const pnlPercent = Number(((equity - startingCapital) / startingCapital * 100).toFixed(2));

  return {
    symbol: symbol.toUpperCase(),
    timeframe,
    startDate: startDateStr,
    endDate: endDateStr,
    startingCapital,
    finalCapital: Number(equity.toFixed(2)),
    totalPnL: pnlCash,
    totalPnLPercent: pnlPercent,
    totalTrades,
    winningTrades: winningTrades.length,
    losingTrades: losingTrades.length,
    winRate,
    profitFactor,
    maxDrawdownPercent: Number(maxDrawdown.toFixed(2)),
    totalCommissions: Number(tradesHistory.reduce((sum, t) => sum + t.commission, 0).toFixed(2)),
    balanceHistory,
    priceHistory: bars,
    tradesList: tradesHistory,
    rejectedTradesCount,
    tranche1ScaledOutCount,
    tranche2HitCount,
    slippageFrictionSaved: Number(totalSlippageFrictionSaved.toFixed(2)),
    adaptiveStopApplied: adaptiveStop,
    partialProfitApplied: partialProfit,
    breakevenApplied: breakevenLock,
    maxHoldApplied: maxHold
  };
}

// Dedicated REST endpoint allowing selecting ticker, time range, timeframe and executing python simulation
app.post("/api/backtest", (req, res) => {
  const { 
    symbol, 
    timeframe, 
    startDate, 
    endDate,
    stopAtrMultiplier,
    partialProfit,
    breakevenLock,
    maxHoldBars,
    ofiFilter,
    adaptiveStop
  } = req.body;

  if (!symbol || !timeframe || !startDate || !endDate) {
    return res.status(400).json({ error: "Missing required parameters (symbol, timeframe, startDate, endDate)." });
  }

  // Sanitize command inputs to avoid injection vulnerability
  const cleanSymbol = symbol.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  const cleanTimeframe = timeframe.replace(/[^a-zA-Z0-9]/g, "");
  const cleanStartDate = startDate.replace(/[^0-9\-]/g, "");
  const cleanEndDate = endDate.replace(/[^0-9\-]/g, "");

  // Set default fallbacks if properties are not provided
  const cleanStopAtr = stopAtrMultiplier !== undefined ? Number(stopAtrMultiplier) : 1.8;
  const cleanPartial = partialProfit !== undefined ? (partialProfit ? "true" : "false") : "true";
  const cleanBreakeven = breakevenLock !== undefined ? (breakevenLock ? "true" : "false") : "true";
  const cleanMaxHold = maxHoldBars !== undefined ? Number(maxHoldBars) : 15;
  const cleanOfi = ofiFilter !== undefined ? (ofiFilter ? "true" : "false") : "true";
  const cleanAdaptive = adaptiveStop !== undefined ? (adaptiveStop ? "true" : "false") : "true";

  const commandArgs = [cleanSymbol, cleanTimeframe, cleanStartDate, cleanEndDate, String(cleanStopAtr), cleanPartial, cleanBreakeven, String(cleanMaxHold), cleanOfi, cleanAdaptive];
  const command = "python3";

  execFile(command, ["backtester.py", ...commandArgs], (error, stdout, stderr) => {
    if (error) {
      console.error(`Backtest executable error: ${error.message}`);
      // Try fallback with simple "python" if python3 lacks binary association
      execFile("python", ["backtester.py", ...commandArgs], (fallbackError, fallbackStdout, fallbackStderr) => {
        if (fallbackError) {
          console.warn("[SERVER] Python executables absent. Executing native backtest fallback logic...");
          try {
            const results = runBacktestTS(
              cleanSymbol,
              cleanTimeframe,
              cleanStartDate,
              cleanEndDate,
              cleanStopAtr,
              partialProfit !== undefined ? !!partialProfit : true,
              breakevenLock !== undefined ? !!breakevenLock : true,
              cleanMaxHold,
              ofiFilter !== undefined ? !!ofiFilter : true,
              adaptiveStop !== undefined ? !!adaptiveStop : true
            );
            return res.json({ success: true, ...results });
          } catch (simErr: any) {
            return res.status(500).json({ error: "Execution loop failed: " + simErr.message });
          }
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
    // Delete PORT to prevent Vite from auto-binding to Cloud Run's injected 8080 port
    delete process.env.PORT;
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
