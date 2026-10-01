import path from "path";
import fs from "fs";
import { initializeApp, getApps, applicationDefault } from "firebase-admin/app";
import { getFirestore, Firestore } from "firebase-admin/firestore";
import { SystemSettings, ActiveTrade, HistoricalLog, Level2Book, ExecutionRecord } from "./types";

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

try {
  if (getApps().length === 0) {
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.K_SERVICE) {
      initializeApp({
        credential: applicationDefault(),
        ...(firebaseProjectId ? { projectId: firebaseProjectId } : {})
      });
      console.log("[FIREBASE] Admin SDK initialized for settings persistence.");
    } else {
      console.log("[FIREBASE] Local environment detected (no ADC credentials). Running in high-performance local memory mode.");
    }
  }
} catch (e: any) {
  console.warn("[FIREBASE] Admin initialization skipped or failed. Error:", e.message);
}

export const db_fs: Firestore | null = getApps().length > 0 ? (databaseId ? getFirestore(getApps()[0], databaseId) : getFirestore()) : null;
export const SETTINGS_DOC_PATH = "system_config/alpha_engine_v1";

export let systemSettings: SystemSettings = {
  ibkrAccountNumber: "U8129384",
  ibkrPort: 4002,
  ibkrClientId: 10,
  mifid2DecisionMaker: "ALGO_DEC_992",
  mifid2ExecutionTrader: "ALGO_EXE_554",
  referenceEquity: 154200.00,
  netLiquidation: 154200.00,
  maintenanceMargin: 12400.00,
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

// Zero Synthetic Policy: executionBlotter is populated exclusively from verified IBKR execDetails callbacks.
// No mock, fixture, or test trades may be initialised here.
export let executionBlotter: ExecutionRecord[] = [];

export async function persistSettings() {
  if (!db_fs) return;
  try {
    await db_fs.doc(SETTINGS_DOC_PATH).set(systemSettings, { merge: true });
    console.log("[FIREBASE] System settings successfully persisted to Firestore.");
  } catch (err) {
    console.error("[FIREBASE] Failed to persist settings:", err);
  }
}

export async function loadPersistentSettings() {
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
      await persistSettings();
    }

    db_fs.collection("active_trades").onSnapshot(
      snapshot => {
        const trades: any[] = [];
        snapshot.forEach(d => {
          trades.push({ id: d.id, ...d.data() });
        });
        activeTrades = trades;
      },
      err => {
        console.warn("[FIREBASE] active_trades snapshot listener offline:", err.message);
      }
    );

    db_fs.collection("historical_logs").orderBy("timestamp", "desc").limit(50).onSnapshot(
      snapshot => {
        const logs: any[] = [];
        snapshot.forEach(d => {
          logs.push({ id: d.id, ...d.data() });
        });
        historicalLogs = logs;
      },
      err => {
        console.warn("[FIREBASE] historical_logs snapshot listener offline:", err.message);
      }
    );

    db_fs.doc("system_risk_state/current_state").onSnapshot(
      snapshot => {
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
      },
      err => {
        console.warn("[FIREBASE] system_risk_state snapshot listener offline:", err.message);
      }
    );
  } catch (err) {
    console.error("[FIREBASE] Error loading persistent settings:", err);
  }
}

export function calculateIBIECommission(symbol: string, primaryExchange: string, quantity: number, price: number): number {
  const exch = (primaryExchange || "").toUpperCase();
  const symb = (symbol || "").toUpperCase();
  const isEuropean = ["SBF", "IBIS", "PARIS", "XETRA", "XETR", "AEB", "SB", "LSE"].includes(exch) ||
                     ["SGO", "ENGI", "RWE", "SAP"].includes(symb);

  if (isEuropean) {
    const tradeValue = quantity * price;
    const baseComm = tradeValue * 0.0005;
    return Number(Math.max(1.25, baseComm).toFixed(2));
  } else {
    const baseComm = quantity * 0.005;
    return Number(Math.max(1.00, baseComm).toFixed(2));
  }
}

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

export function setActiveTrades(trades: ActiveTrade[]) {
  activeTrades = trades;
}

export function setHistoricalLogs(logs: HistoricalLog[]) {
  historicalLogs = logs;
}
