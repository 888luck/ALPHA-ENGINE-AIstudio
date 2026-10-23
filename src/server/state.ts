import path from "path";
import fs from "fs";
import { SystemSettings, ActiveTrade, HistoricalLog, Level2Book, ExecutionRecord } from "./types";
import { edgeBridge } from "./edgeBridge";
import { loadVaultCredentials } from "./vault";

// Dedicated Local JSON Persistence for System Settings (Zero Firestore Dependency)
const SETTINGS_FILE_PATH = path.join(process.cwd(), "system_settings.json");

export const db_fs = null; // Deprecated and permanently disabled per Universal Institutional Principles

export let systemSettings: SystemSettings = {
  ibkrAccountNumber: "DUE263010",
  ibkrHost: process.env.EDGE_NODE_IP || "127.0.0.1",
  ibkrPort: 4002,
  ibkrClientId: 10,
  mifid2DecisionMaker: "ALGO_DEC_992",
  mifid2ExecutionTrader: "ALGO_EXE_554",
  referenceEquity: 1023930.83,
  netLiquidation: 1023930.83,
  maintenanceMargin: 11901.58,
  routerLocked: false,
  marketTime: "10:30",
  marketPhase: "EXECUTION",
  virtualCapitalCeiling: 25000.00,
  dailyCapitalCeiling: 10000.00,
  dailyMaxLossCutoff: 250.00,
  fractionalTradingEnabled: true,
  intradayFlatteningEnabled: true,
  intradayFlattenTimeEST: "15:45",
  intradayFlattenTimeCET: "17:15",
  killSwitchEngaged: false,
  tradingMode: "PAPER",
  marketScope: "ALL",
  gatewayConnectionActive: false,
  dailyDrawdownLimitPercent: 2.5,
  dailyDrawdownLimitCash: 3000.0,
  stopAtrMultiplier: 1.8,
  partialProfit: true,
  breakevenLock: true,
  maxHoldBars: 15,
  ofiFilter: true,
  adaptiveStop: true,
  geminiApiKey: "",
  openaiApiKey: "",
  anthropicApiKey: "",
  nvidiaApiKey: "",
  customAiApiKey: "",
  customAiBaseUrl: "",
  customAiModelName: "",
  selectedAiProvider: "gemini-flash",
  openrouterApiKey: "",
  openFdaApiKey: "",
  fredApiKey: "",
  patentsApiKey: "",
  secUserAgent: "AlphaEngine/2.0 (InstitutionalResearch; contact@alphaengine.internal)",
};

// Zero Synthetic Policy: Active trades and historical blotters are maintained strictly by broker execution feeds
export let activeTrades: ActiveTrade[] = [];
export let historicalLogs: HistoricalLog[] = [];
export let marketBooks: Record<string, Level2Book> = {};
export let dynamicBaskets: any[] = [];

// Load calibrated dynamic baskets from disk on boot
try {
  const dbPath = path.join(process.cwd(), "dynamic_baskets.json");
  if (fs.existsSync(dbPath)) {
    const raw = JSON.parse(fs.readFileSync(dbPath, "utf-8"));
    dynamicBaskets = raw.baskets || [];
    console.log(`[STATE] Ingested ${dynamicBaskets.length} dynamic candidate baskets from disk on initialization.`);
  }
} catch (e: any) {
  console.warn("[STATE] Could not read dynamic_baskets.json on boot:", e.message);
}

// Zero Synthetic Policy: executionBlotter is populated exclusively from verified IBKR execDetails callbacks.
export let executionBlotter: ExecutionRecord[] = [];

export async function persistSettings() {
  try {
    fs.writeFileSync(SETTINGS_FILE_PATH, JSON.stringify(systemSettings, null, 2), "utf-8");
    console.log("[SETTINGS] System settings successfully persisted to local storage.");
    
    // Proactively push updated settings directly to Edge Node via Direct TCP Bridge
    edgeBridge.syncSettings(systemSettings).catch((err: any) => {
      console.warn("[EDGE BRIDGE WARN] Async edge settings sync queued or offline:", err.message);
    });
  } catch (err: any) {
    console.error("[SETTINGS] Failed to persist settings to disk:", err.message);
  }
}

export async function loadPersistentSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE_PATH)) {
      const data = JSON.parse(fs.readFileSync(SETTINGS_FILE_PATH, "utf-8"));
      if (data) {
        systemSettings = { ...systemSettings, ...data };
        console.log("[SETTINGS] System settings successfully restored from disk.");
      }
    } else {
      console.log("[SETTINGS] No existing settings file found on disk. Initializing defaults.");
      await persistSettings();
    }

    // Hydrate 12-factor vault credentials (overriding stale mocks with real credentials)
    const vaultCreds = loadVaultCredentials();
    systemSettings.geminiApiKey = vaultCreds.geminiApiKey || systemSettings.geminiApiKey;
    systemSettings.customAiApiKey = vaultCreds.customAiApiKey || systemSettings.customAiApiKey;
    systemSettings.nvidiaApiKey = vaultCreds.nvidiaApiKey || systemSettings.nvidiaApiKey;
    systemSettings.openaiApiKey = vaultCreds.openaiApiKey || systemSettings.openaiApiKey;
    systemSettings.anthropicApiKey = vaultCreds.anthropicApiKey || systemSettings.anthropicApiKey;
    systemSettings.customAiBaseUrl = vaultCreds.customAiBaseUrl || systemSettings.customAiBaseUrl;
    systemSettings.customAiModelName = vaultCreds.customAiModelName || systemSettings.customAiModelName;
    systemSettings.selectedAiProvider = (vaultCreds.selectedAiProvider as any) || systemSettings.selectedAiProvider;
    systemSettings.openFdaApiKey = vaultCreds.openFdaApiKey || systemSettings.openFdaApiKey;
    systemSettings.fredApiKey = vaultCreds.fredApiKey || systemSettings.fredApiKey;
    systemSettings.patentsApiKey = vaultCreds.patentsApiKey || systemSettings.patentsApiKey;
    systemSettings.secUserAgent = vaultCreds.secUserAgent || systemSettings.secUserAgent;
    systemSettings.ibkrHost = vaultCreds.edgeNodeHost || systemSettings.ibkrHost;
    systemSettings.ibkrPort = vaultCreds.ibkrPort || systemSettings.ibkrPort;
    systemSettings.ibkrClientId = vaultCreds.ibkrClientId || systemSettings.ibkrClientId;
    systemSettings.ibkrAccountNumber = vaultCreds.ibkrAccountNumber || systemSettings.ibkrAccountNumber;
    systemSettings.tradingMode = vaultCreds.tradingMode || systemSettings.tradingMode;
    console.log("[VAULT] 12-Factor vault credentials successfully synchronized into runtime state.");
  } catch (err: any) {
    console.warn("[SETTINGS] Error loading settings from disk:", err.message);
  }
}

export function calculateEstimatedCommission(quantity: number, price: number, isEuropean: boolean = false): number {
  if (isEuropean) {
    const tradeValue = quantity * price;
    const baseComm = tradeValue * 0.0005;
    return Number(Math.max(1.25, baseComm).toFixed(2));
  } else {
    const baseComm = quantity * 0.005;
    return Number(Math.max(1.00, baseComm).toFixed(2));
  }
}

/**
 * Zero Synthetic Policy Compliant Book Ingestion:
 * Populates real market books without synthetic Math.random() mock data generation.
 */
export function ingestScannedInstrument(symbol: string, primaryExchange: string, lastPrice: number) {
  if (marketBooks[symbol]) {
    marketBooks[symbol].primaryExchange = primaryExchange;
    marketBooks[symbol].lastPrice = lastPrice;
    return;
  }
  
  marketBooks[symbol] = {
    symbol,
    primaryExchange,
    lastPrice,
    lastOfi: 0,
    bids: [], // Populated strictly via verified IBKR MktDepth callbacks
    asks: []  // Populated strictly via verified IBKR MktDepth callbacks
  };
}

export function setActiveTrades(trades: ActiveTrade[]) {
  activeTrades = trades;
}

export function setHistoricalLogs(logs: HistoricalLog[]) {
  historicalLogs = logs;
}
