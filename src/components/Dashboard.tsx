import React, { useState, useEffect, useRef } from "react";
import {
  AlertOctagon,
  Zap,
  ShieldAlert,
  TrendingUp,
  Coins,
  Lock,
  Unlock,
  Clock,
  Settings2,
  Activity,
  XCircle,
  Database,
  RefreshCw,
  Play,
  Flame,
  CheckCircle2,
  UserCheck,
  Sparkles
} from "lucide-react";
import { 
  collection, 
  doc, 
  setDoc, 
  deleteDoc, 
  getDocs, 
  onSnapshot 
} from "firebase/firestore";
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut, 
  onAuthStateChanged 
} from "firebase/auth";
import { 
  auth, 
  db, 
  testConnection, 
  handleFirestoreError, 
  OperationType,
  getActiveFirebaseConfig,
  updateActiveFirebaseConfig
} from "../firebase";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  BarChart,
  Bar,
  ReferenceLine,
  CartesianGrid
} from "recharts";
import GcpCompanion from "./GcpCompanion";

const HARDCODED_SECURITY_RULES = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // 1. Root default deny safety net
    match /{document=**} {
      allow read, write: if false;
    }

    // Reuseable, hardened, global validation helper functions
    function isSignedIn() {
      return request.auth != null;
    }

    function isValidId(id) {
      return id is string && id.size() <= 128 && id.matches('^[a-zA-Z0-9_\\\\-]+$');
    }

    function incoming() {
      return request.resource.data;
    }

    function existing() {
      return resource.data;
    }

    // Helper validating trade entity structure (Anti-Update-Gap)
    function isValidTrade(data) {
      return data.keys().hasAll(['id', 'symbol', 'quantity', 'direction', 'entryPrice'])
        && data.id is string && data.id.size() <= 128
        && data.symbol is string && data.symbol.size() <= 16
        && data.quantity is number && data.quantity > 0
        && (data.direction == 'BUY' || data.direction == 'SELL')
        && data.entryPrice is number && data.entryPrice > 0
        && (data.stopPrice == null || (data.stopPrice is number && data.stopPrice > 0))
        && (data.currentPrice == null || (data.currentPrice is number && data.currentPrice > 0))
        && (data.unrealizedPnL == null || data.unrealizedPnL is number);
    }

    // Helper validating trade log record structure
    function isValidTradeLog(data) {
      return data.keys().hasAll(['id', 'symbol', 'realizedPnL', 'commission'])
        && data.id is string && data.id.size() <= 128
        && data.symbol is string && data.symbol.size() <= 16
        && data.realizedPnL is number
        && data.commission is number && data.commission >= 0;
    }

    // Helper validating risk state structure
    function isValidRiskState(data) {
      return data.keys().hasAll(['netLiquidation', 'routerLocked'])
        && data.netLiquidation is number && data.netLiquidation > 0
        && data.routerLocked is bool
        && (data.maintenanceMargin == null || data.maintenanceMargin is number)
        && (data.dailyRealizedPnL == null || data.dailyRealizedPnL is number)
        && (data.dailyUnrealizedPnL == null || data.dailyUnrealizedPnL is number);
    }

    // --- COLLECTION PATH MATCH BLOCKS ---

    // 2. Active Trades collection (Session Holdings)
    match /active_trades/{tradeId} {
      allow read: if isSignedIn();
      allow create: if isSignedIn()
        && isValidId(tradeId)
        && isValidTrade(incoming());
      allow update: if isSignedIn()
        && isValidId(tradeId)
        && isValidTrade(incoming())
        && incoming().id == existing().id // Immutable fields
        && incoming().symbol == existing().symbol
        && incoming().direction == existing().direction
        && incoming().entryPrice == existing().entryPrice
        && incoming().diff(existing()).affectedKeys().hasOnly(['stopPrice', 'currentPrice', 'unrealizedPnL', 'quantity']);
      allow delete: if isSignedIn()
        && isValidId(tradeId);
    }

    // 3. Historical logs collection
    match /historical_logs/{logId} {
      allow read: if isSignedIn();
      allow create: if isSignedIn()
        && isValidId(logId)
        && isValidTradeLog(incoming());
      // Updates and deletes strictly forbidden to preserve immutable historic transaction trails (MiFIR Audit compliance)
      allow update, delete: if false;
    }

    // 4. System Risk State config collection
    match /system_risk_state/{stateId} {
      allow read: if isSignedIn();
      allow create, write: if isSignedIn()
        && isValidId(stateId)
        && isValidRiskState(incoming());
      allow update: if isSignedIn()
        && isValidId(stateId)
        && isValidRiskState(incoming())
        && (
          // Allow toggle of the lock during drawdown breaches
          incoming().diff(existing()).affectedKeys().hasOnly(['routerLocked', 'netLiquidation', 'maintenanceMargin', 'dailyRealizedPnL', 'dailyUnrealizedPnL', 'lastUpdated'])
        );
      allow delete: if false; // System state cannot be purged
    }
  }
}`;

interface SystemSettings {
  ibkrAccountNumber: string;
  ibkrPort: number;
  ibkrClientId: number;
  mifid2DecisionMaker: string;
  mifid2ExecutionTrader: string;
  referenceEquity: number;
  netLiquidation: number;
  maintenanceMargin: number;
  routerLocked: boolean;
  marketTime: string;
  marketPhase: string;
  virtualCapitalCeiling?: number;
  tradingMode?: "PAPER" | "LIVE";
  
  // Tactical Strategy Upgrades
  stopAtrMultiplier?: number;
  partialProfit?: boolean;
  breakevenLock?: boolean;
  maxHoldBars?: number;
  ofiFilter?: boolean;
  adaptiveStop?: boolean;
  dailyDrawdownLimitPercent?: number;
  dailyDrawdownLimitCash?: number;
}

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
  
  // Tactical Strategy State Fields
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

interface DepthItem {
  price: number;
  size: number;
}

interface Level2Book {
  symbol: string;
  lastPrice: number;
  lastOfi: number;
  bids: DepthItem[];
  asks: DepthItem[];
  primaryExchange: string;
}

const safeJsonParse = async (response: Response) => {
  const contentType = response.headers.get("content-type");
  if (contentType && contentType.includes("application/json")) {
    return await response.json();
  }
  throw new Error("Received non-JSON response from server.");
};

// Resilient fetching helper for background queries
const fetchJsonWithRetry = async (url: string, retries: number = 5, delayMs: number = 800): Promise<any> => {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const data = await safeJsonParse(res);
        return data;
      }
    } catch (err) {
      // Trace silently for debugging, no loud error
    }
    if (i < retries - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error(`Failed to fetch JSON from ${url} after ${retries} attempts`);
};

export default function Dashboard() {
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [activeTrades, setActiveTrades] = useState<ActiveTrade[]>([]);
  const [historicalLogs, setHistoricalLogs] = useState<HistoricalLog[]>([]);
  const [marketBooks, setMarketBooks] = useState<Record<string, Level2Book>>({});
  const [selectedSymbol, setSelectedSymbol] = useState<string>("");

  // Local state form for custom settings modification
  const [editAccount, setEditAccount] = useState("U8129384");
  const [editDecisionMaker, setEditDecisionMaker] = useState("ALGO_DEC_992");
  const [editTrader, setEditTrader] = useState("ALGO_EXE_554");
  const [editReferenceEquity, setEditReferenceEquity] = useState(154200);
  const [editVirtualCapitalCeiling, setEditVirtualCapitalCeiling] = useState(25000);
  const [editTradingMode, setEditTradingMode] = useState<"PAPER" | "LIVE">("PAPER");
  const [editIbkrPort, setEditIbkrPort] = useState(4002);
  const [editIbkrClientId, setEditIbkrClientId] = useState(10);
  const [editGatewayConnectionActive, setEditGatewayConnectionActive] = useState(false);
  
  // Tactical parameters
  const [editStopAtrMultiplier, setEditStopAtrMultiplier] = useState(1.8);
  const [editPartialProfit, setEditPartialProfit] = useState(true);
  const [editBreakevenLock, setEditBreakevenLock] = useState(true);
  const [editMaxHoldBars, setEditMaxHoldBars] = useState(15);
  const [editOfiFilter, setEditOfiFilter] = useState(true);
  const [editAdaptiveStop, setEditAdaptiveStop] = useState(true);
  const [editDailyDrawdownLimitPercent, setEditDailyDrawdownLimitPercent] = useState(2.5);
  const [editDailyDrawdownLimitCash, setEditDailyDrawdownLimitCash] = useState(1500.0);
  const [aiCalibrationPrompt, setAiCalibrationPrompt] = useState("");
  const [isCalibratingGeopolitical, setIsCalibratingGeopolitical] = useState(false);
  const [isAutomatingNews, setIsAutomatingNews] = useState(false);
  const [selectedCalibrationModel, setSelectedCalibrationModel] = useState<"ai-studio" | "vertex">("ai-studio");
  const [selectedNewsSource, setSelectedNewsSource] = useState<"all" | "bloomberg" | "reuters" | "ibkr" | "fx">("all");
  const [macroEventLogs, setMacroEventLogs] = useState([
    {
      time: "10:14:02",
      source: "Bloomberg Financial RSS",
      headline: "OPEC+ members agree to extend output cuts of 2.2 million bpd through Q3 2026 to stabilize physical markets",
      sentiment: 0.78,
      impact: "BULLISH",
      targetSector: "Middle-East Energy & Oil Beneficiaries (XLE, COP, VLO)",
      circuitOverrideActive: false
    },
    {
      time: "08:30:15",
      source: "DailyFX Calendar API",
      headline: "US Non-Farm Payrolls (NFP) actuals exceed forecasts: 182k vs 140k expected. Unemployment rate remains steady at 4.0%",
      sentiment: 0.12,
      impact: "VOLATILE",
      targetSector: "Broad Macro Rates (SPY, QQQ, GLD)",
      circuitOverrideActive: true
    },
    {
      time: "06:12:44",
      source: "Reuters Business Wire",
      headline: "Surging ocean shipping freight rates lead to supply chain bottlenecks along Suez Canal passage as carrier volumes bottleneck",
      sentiment: -0.62,
      impact: "BEARISH",
      targetSector: "Global Logistics & Shipping Channels (ZIM, MATX, MAERSK)",
      circuitOverrideActive: false
    }
  ]);

  // Pre-trade Order Setup
  const [tradeSymbol, setTradeSymbol] = useState("");
  const [tradeDirection, setTradeDirection] = useState<"BUY" | "SELL">("BUY");
  const [tradeEntry, setTradeEntry] = useState("93.15");
  const [tradeStop, setTradeStop] = useState("92.50");
  const [tradeTarget, setTradeTarget] = useState("1.20"); // Target profit ticks

  const [orderFeedback, setOrderFeedback] = useState<{
    error?: string;
    success?: string;
    efficiencyRatio?: number;
    allocatedQty?: number;
  } | null>(null);

  // Proactive Simulation Results state
  const [simulationData, setSimulationData] = useState<any[]>([]);
  const [isSimulatingExpectancy, setIsSimulatingExpectancy] = useState(false);

  // Sync Status flags
  const [firebaseStatus, setFirebaseStatus] = useState<"offline" | "authorized">("offline");
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [firebaseError, setFirebaseError] = useState<string | null>(null);
  const [isSyncingWithFirebase, setIsSyncingWithFirebase] = useState(false);
  const [syncSummary, setSyncSummary] = useState<{
    activeCount: number;
    logsCount: number;
    statesCount: number;
  } | null>(null);
  const [isTestingConn, setIsTestingConn] = useState(false);

  // Custom Firebase credentials management
  const [showFirebaseConfigPanel, setShowFirebaseConfigPanel] = useState(false);
  const [tempFirebaseConfig, setTempFirebaseConfig] = useState<any>(() => getActiveFirebaseConfig());
  const isCustomConfigActive = !!localStorage.getItem("ALPHA_FIREBASE_CONFIG_OVERRIDE");
  const [securityRulesText, setSecurityRulesText] = useState<string>(HARDCODED_SECURITY_RULES);
  const [copiedRules, setCopiedRules] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const rulesTextareaRef = useRef<HTMLTextAreaElement>(null);

  const saveCustomFirebaseConfig = () => {
    updateActiveFirebaseConfig(tempFirebaseConfig);
  };

  const resetCustomFirebaseConfig = () => {
    updateActiveFirebaseConfig(null);
  };

  const fallbackCopyToClipboard = (textToCopy: string) => {
    try {
      const textArea = document.createElement("textarea");
      textArea.value = textToCopy;
      textArea.style.position = "fixed";
      textArea.style.top = "0";
      textArea.style.left = "0";
      textArea.style.opacity = "0";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      const successful = document.execCommand("copy");
      document.body.removeChild(textArea);
      if (successful) {
        setCopiedRules(true);
        setCopyFailed(false);
        setTimeout(() => setCopiedRules(false), 2000);
      } else {
        console.error("Fallback copy execution returned false");
        setCopyFailed(true);
        setTimeout(() => setCopyFailed(false), 6000);
      }
    } catch (err) {
      console.error("Fallback copy failed: ", err);
      setCopyFailed(true);
      setTimeout(() => setCopyFailed(false), 6000);
    }
  };

  const handleClipboardCopy = (textToCopy: string) => {
    if (!textToCopy) return;

    // First and foremost, focus and select all text in the textarea.
    // This ensures that the user can immediately press Ctrl+C / Cmd+C even if programmatic copy is blocked.
    if (rulesTextareaRef.current) {
      rulesTextareaRef.current.focus();
      rulesTextareaRef.current.select();
    }

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(textToCopy)
        .then(() => {
          setCopiedRules(true);
          setCopyFailed(false);
          setTimeout(() => setCopiedRules(false), 2000);
        })
        .catch((err) => {
          console.warn("navigator.clipboard.writeText failed, using fallback:", err);
          fallbackCopyToClipboard(textToCopy);
        });
    } else {
      fallbackCopyToClipboard(textToCopy);
    }
  };

  useEffect(() => {
    fetch("/api/security-rules")
      .then(r => r.json())
      .then(data => {
        if (data && data.rules) {
          setSecurityRulesText(data.rules);
        }
      })
      .catch(err => console.error("Could not load security rules: ", err));
  }, []);

  useEffect(() => {
    // Setup Firebase Auth State Listener
    const unsubscribeAuth = onAuthStateChanged(auth, async (u) => {
      setCurrentUser(u);
      if (u) {
        setFirebaseStatus("authorized");
        await testFirebaseConnectionAndSummarize();
      } else {
        setFirebaseStatus("offline");
      }
    });

    fetchState();
    runPreFlightExpectancy();

    const pollingInterval = setInterval(fetchState, 3000);
    return () => {
      unsubscribeAuth();
      clearInterval(pollingInterval);
    };
  }, []);

  const testFirebaseConnectionAndSummarize = async () => {
    setIsTestingConn(true);
    setFirebaseError(null);
    try {
      const connSuccess = await testConnection();
      if (connSuccess) {
        setFirebaseStatus("authorized");
        const activeSnap = await getDocs(collection(db, "active_trades")).catch(err => handleFirestoreError(err, OperationType.GET, "active_trades"));
        const logsSnap = await getDocs(collection(db, "historical_logs")).catch(err => handleFirestoreError(err, OperationType.GET, "historical_logs"));
        const stateSnap = await getDocs(collection(db, "system_risk_state")).catch(err => handleFirestoreError(err, OperationType.GET, "system_risk_state"));
        setSyncSummary({
          activeCount: activeSnap?.size || 0,
          logsCount: logsSnap?.size || 0,
          statesCount: stateSnap?.size || 0
        });
      } else {
        setFirebaseError("Firestore connectivity test failed. Please verify security rules or region.");
      }
    } catch (err: any) {
      setFirebaseError(err.message || "Connection testing error.");
    } finally {
      setIsTestingConn(false);
    }
  };

  const handleFirebaseLogin = async () => {
    setFirebaseError(null);
    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      setCurrentUser(result.user);
      setFirebaseStatus("authorized");
      await testFirebaseConnectionAndSummarize();
    } catch (e: any) {
      setFirebaseError(e.message || "Failed to authenticate with Google Provider.");
    }
  };

  const handleFirebaseLogout = async () => {
    try {
      await signOut(auth);
      setCurrentUser(null);
      setFirebaseStatus("offline");
      setSyncSummary(null);
    } catch (e: any) {
      setFirebaseError(e.message || "Failed logout.");
    }
  };

  const pushStateToCloud = async () => {
    setIsSyncingWithFirebase(true);
    setFirebaseError(null);
    try {
      // 1. Push Active Trades
      for (const trade of activeTrades) {
        await setDoc(doc(db, "active_trades", trade.id), {
          id: trade.id,
          symbol: trade.symbol,
          quantity: trade.quantity,
          direction: trade.direction,
          entryPrice: trade.entryPrice,
          stopPrice: trade.stopPrice,
          currentPrice: trade.currentPrice,
          unrealizedPnL: trade.unrealizedPnL,
          mifidDecisionMaker: trade.mifidDecisionMaker || settings?.mifid2DecisionMaker || "ALGO_DEC_992",
          mifidExecutionTrader: trade.mifidExecutionTrader || settings?.mifid2ExecutionTrader || "ALGO_EXE_554",
          timestamp: trade.timestamp
        }).catch(err => handleFirestoreError(err, OperationType.WRITE, `active_trades/${trade.id}`));
      }
      // 2. Push Historical Logs
      for (const log of historicalLogs) {
        await setDoc(doc(db, "historical_logs", log.id), {
          id: log.id,
          symbol: log.symbol,
          quantity: log.quantity,
          direction: log.direction,
          entryPrice: log.entryPrice,
          exitPrice: log.exitPrice,
          realizedPnL: log.realizedPnL,
          commission: log.commission,
          efficiencyRatio: log.efficiencyRatio,
          timestamp: log.timestamp
        }).catch(err => handleFirestoreError(err, OperationType.WRITE, `historical_logs/${log.id}`));
      }
      // 3. Push Risk State
      if (settings) {
        await setDoc(doc(db, "system_risk_state", "current_state"), {
          netLiquidation: settings.netLiquidation,
          maintenanceMargin: settings.maintenanceMargin,
          dailyRealizedPnL: totalRealized,
          dailyUnrealizedPnL: totalUnrealized,
          routerLocked: settings.routerLocked,
          ibkrAccountNumber: settings.ibkrAccountNumber,
          ibkrPort: settings.ibkrPort,
          ibkrClientId: settings.ibkrClientId,
          tradingMode: settings.tradingMode,
          gatewayConnectionActive: settings.gatewayConnectionActive,
          stopAtrMultiplier: settings.stopAtrMultiplier || 1.8,
          partialProfit: settings.partialProfit !== false,
          breakevenLock: settings.breakevenLock !== false,
          maxHoldBars: settings.maxHoldBars || 15,
          ofiFilter: settings.ofiFilter !== false,
          adaptiveStop: settings.adaptiveStop !== false,
          lastUpdated: new Date().toISOString()
        }).catch(err => handleFirestoreError(err, OperationType.WRITE, "system_risk_state/current_state"));
      }

      await testFirebaseConnectionAndSummarize();
      setOrderFeedback({ success: "Bi-directional tunnel active: Local memory metrics pushed successfully." });
    } catch (e: any) {
      setFirebaseError(e.message || "Failed pushing state.");
    } finally {
      setIsSyncingWithFirebase(false);
    }
  };

  const pullStateFromCloud = async () => {
    setIsSyncingWithFirebase(true);
    setFirebaseError(null);
    try {
      const activeSnap = await getDocs(collection(db, "active_trades")).catch(err => handleFirestoreError(err, OperationType.GET, "active_trades"));
      const tradesList: ActiveTrade[] = [];
      activeSnap.forEach((docSnap) => {
        const d = docSnap.data();
        tradesList.push({
          id: d.id,
          symbol: d.symbol,
          quantity: d.quantity,
          direction: d.direction as "BUY" | "SELL",
          entryPrice: d.entryPrice,
          stopPrice: d.stopPrice,
          currentPrice: d.currentPrice || d.entryPrice,
          unrealizedPnL: d.unrealizedPnL || 0,
          mifidDecisionMaker: d.mifidDecisionMaker,
          mifidExecutionTrader: d.mifidExecutionTrader,
          timestamp: d.timestamp
        });
      });

      const logsSnap = await getDocs(collection(db, "historical_logs")).catch(err => handleFirestoreError(err, OperationType.GET, "historical_logs"));
      const logsList: HistoricalLog[] = [];
      logsSnap.forEach((docSnap) => {
        const d = docSnap.data();
        logsList.push({
          id: d.id,
          symbol: d.symbol,
          quantity: d.quantity,
          direction: d.direction as "BUY" | "SELL",
          entryPrice: d.entryPrice,
          exitPrice: d.exitPrice,
          realizedPnL: d.realizedPnL,
          commission: d.commission,
          efficiencyRatio: d.efficiencyRatio,
          timestamp: d.timestamp
        });
      });

      let riskSettings: any = null;
      const stateDocs = await getDocs(collection(db, "system_risk_state")).catch(err => handleFirestoreError(err, OperationType.GET, "system_risk_state"));
      stateDocs.forEach((docSnap) => {
        if (docSnap.id === "current_state") {
          riskSettings = docSnap.data();
        }
      });

      const res = await fetch("/api/sync-from-cloud", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trades: tradesList,
          logs: logsList,
          settings: riskSettings
        })
      });

      if (res.ok) {
        const data = await safeJsonParse(res);
        setSettings(data.settings);
        setActiveTrades(data.activeTrades);
        setHistoricalLogs(data.historicalLogs);
        setOrderFeedback({ success: "Alpha Engine metrics and logs successfully restored from Google Firestore." });
      }
    } catch (e: any) {
      setFirebaseError(e.message || "Failed pulling state from Firestore.");
    } finally {
      setIsSyncingWithFirebase(false);
    }
  };

  // Update form inputs when settings are loaded
  useEffect(() => {
    if (settings) {
      setEditAccount(settings.ibkrAccountNumber);
      setEditDecisionMaker(settings.mifid2DecisionMaker);
      setEditTrader(settings.mifid2ExecutionTrader);
      setEditReferenceEquity(settings.referenceEquity);
      if (typeof settings.virtualCapitalCeiling === "number") {
        setEditVirtualCapitalCeiling(settings.virtualCapitalCeiling);
      }
      if (settings.tradingMode) {
        setEditTradingMode(settings.tradingMode);
      }
      if (typeof settings.ibkrPort === "number") {
        setEditIbkrPort(settings.ibkrPort);
      }
      if (typeof settings.ibkrClientId === "number") {
        setEditIbkrClientId(settings.ibkrClientId);
      }
      if (typeof settings.gatewayConnectionActive === "boolean") {
        setEditGatewayConnectionActive(settings.gatewayConnectionActive);
      }
      if (typeof settings.stopAtrMultiplier === "number") {
        setEditStopAtrMultiplier(settings.stopAtrMultiplier);
      }
      if (typeof settings.partialProfit === "boolean") {
        setEditPartialProfit(settings.partialProfit);
      }
      if (typeof settings.breakevenLock === "boolean") {
        setEditBreakevenLock(settings.breakevenLock);
      }
      if (typeof settings.maxHoldBars === "number") {
        setEditMaxHoldBars(settings.maxHoldBars);
      }
      if (typeof settings.ofiFilter === "boolean") {
        setEditOfiFilter(settings.ofiFilter);
      }
      if (typeof settings.adaptiveStop === "boolean") {
        setEditAdaptiveStop(settings.adaptiveStop);
      }
      if (typeof settings.dailyDrawdownLimitPercent === "number") {
        setEditDailyDrawdownLimitPercent(settings.dailyDrawdownLimitPercent);
      }
      if (typeof settings.dailyDrawdownLimitCash === "number") {
        setEditDailyDrawdownLimitCash(settings.dailyDrawdownLimitCash);
      }
    }
  }, [settings === null]);

  const fetchState = async () => {
    try {
      const data = await fetchJsonWithRetry("/api/state", 6, 800);
      setSettings(data.settings);
      setActiveTrades(data.activeTrades);
      setHistoricalLogs(data.historicalLogs);
      setMarketBooks(data.marketBooks);
    } catch (e) {
      console.debug("Failed connecting to engine backend.", e);
    }
  };

  const toggleTradingMode = async () => {
    const nextMode = settings?.tradingMode === "LIVE" ? "PAPER" : "LIVE";
    const nextPort = nextMode === "LIVE" ? 4001 : 4002;
    try {
      const res = await fetch("/api/set-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          tradingMode: nextMode,
          ibkrPort: nextPort,
          gatewayConnectionActive: nextMode === "LIVE" ? true : editGatewayConnectionActive
        })
      });
      if (res.ok) {
        const data = await res.json();
        setSettings(data.settings);
        setEditTradingMode(nextMode);
        setEditIbkrPort(nextPort);
        if (nextMode === "LIVE") {
          setEditGatewayConnectionActive(true);
        }
        setOrderFeedback({ success: `DMA ROUTER: Switched execution pipeline to ${nextMode} (${nextPort} port).` });
        
        // If authorized, push state directly to Firebase
        if (firebaseStatus === "authorized" && currentUser) {
          const totalUnrealized = activeTrades.reduce((acc, curr) => acc + curr.unrealizedPnL, 0);
          const totalRealized = historicalLogs.reduce((acc, curr) => acc + curr.realizedPnL, 0);
          await setDoc(doc(db, "system_risk_state", "current_state"), {
            netLiquidation: data.settings.netLiquidation,
            maintenanceMargin: data.settings.maintenanceMargin,
            dailyRealizedPnL: totalRealized,
            dailyUnrealizedPnL: totalUnrealized,
            routerLocked: data.settings.routerLocked,
            ibkrAccountNumber: data.settings.ibkrAccountNumber,
            ibkrPort: nextPort,
            ibkrClientId: data.settings.ibkrClientId,
            tradingMode: nextMode,
            gatewayConnectionActive: nextMode === "LIVE" ? true : editGatewayConnectionActive,
            stopAtrMultiplier: data.settings.stopAtrMultiplier,
            partialProfit: data.settings.partialProfit,
            breakevenLock: data.settings.breakevenLock,
            maxHoldBars: data.settings.maxHoldBars,
            ofiFilter: data.settings.ofiFilter,
            adaptiveStop: data.settings.adaptiveStop,
            lastUpdated: new Date().toISOString()
          }, { merge: true }).catch(err => console.error("Firebase sync error: ", err));
        }
      }
    } catch (e: any) {
      setOrderFeedback({ error: "Failed to switch Trading Mode: " + e.message });
    }
  };

  const handleUpdateSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/set-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ibkrAccountNumber: editAccount,
          mifid2DecisionMaker: editDecisionMaker,
          mifid2ExecutionTrader: editTrader,
          referenceEquity: editReferenceEquity,
          virtualCapitalCeiling: editVirtualCapitalCeiling,
          tradingMode: editTradingMode,
          ibkrPort: editIbkrPort,
          ibkrClientId: editIbkrClientId,
          gatewayConnectionActive: editGatewayConnectionActive,
          stopAtrMultiplier: editStopAtrMultiplier,
          partialProfit: editPartialProfit,
          breakevenLock: editBreakevenLock,
          maxHoldBars: editMaxHoldBars,
          ofiFilter: editOfiFilter,
          adaptiveStop: editAdaptiveStop,
          dailyDrawdownLimitPercent: editDailyDrawdownLimitPercent,
          dailyDrawdownLimitCash: editDailyDrawdownLimitCash
        })
      });
      if (res.ok) {
        const data = await safeJsonParse(res);
        setSettings(data.settings);
        setOrderFeedback({ success: "System settings updated natively inside Alpha Engine." });
        
        // If authorized, push state directly to Firebase
        if (firebaseStatus === "authorized" && currentUser) {
          const totalUnrealized = activeTrades.reduce((acc, curr) => acc + curr.unrealizedPnL, 0);
          const totalRealized = historicalLogs.reduce((acc, curr) => acc + curr.realizedPnL, 0);
          await setDoc(doc(db, "system_risk_state", "current_state"), {
            netLiquidation: data.settings.netLiquidation,
            maintenanceMargin: data.settings.maintenanceMargin,
            dailyRealizedPnL: totalRealized,
            dailyUnrealizedPnL: totalUnrealized,
            routerLocked: data.settings.routerLocked,
            ibkrAccountNumber: data.settings.ibkrAccountNumber,
            ibkrPort: data.settings.ibkrPort,
            ibkrClientId: data.settings.ibkrClientId,
            tradingMode: data.settings.tradingMode,
            gatewayConnectionActive: data.settings.gatewayConnectionActive,
            stopAtrMultiplier: data.settings.stopAtrMultiplier,
            partialProfit: data.settings.partialProfit,
            breakevenLock: data.settings.breakevenLock,
            maxHoldBars: data.settings.maxHoldBars,
            ofiFilter: data.settings.ofiFilter,
            adaptiveStop: data.settings.adaptiveStop,
            dailyDrawdownLimitPercent: data.settings.dailyDrawdownLimitPercent,
            dailyDrawdownLimitCash: data.settings.dailyDrawdownLimitCash,
            lastUpdated: new Date().toISOString()
          }, { merge: true }).catch(err => console.error("Firebase sync error: ", err));
        }
      }
    } catch (e) {
      setOrderFeedback({ error: "Failed to update configuration parameter." });
    }
  };

  const handleManualTick = async (direction: "UP" | "DOWN") => {
    try {
      const res = await fetch("/api/simulate-tick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: selectedSymbol, direction })
      });
      if (res.ok) {
        fetchState();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handlePlaceTrade = async (e: React.FormEvent) => {
    e.preventDefault();
    setOrderFeedback(null);
    try {
      const res = await fetch("/api/place-trade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: tradeSymbol,
          direction: tradeDirection,
          entryPrice: Number(tradeEntry),
          stopPrice: Number(tradeStop),
          targetProfit: Number(tradeTarget)
        })
      });

      const data = await safeJsonParse(res);
      if (!res.ok) {
        setOrderFeedback({ error: data.error || "Order transmission failed." });
      } else {
        setOrderFeedback({
          success: `Trade transmitted. Order filled under regulatory MiID ${settings?.mifid2DecisionMaker}.`,
          allocatedQty: data.calculatedQty,
          efficiencyRatio: data.efficiencyRatio
        });
        fetchState();
      }
    } catch (e: any) {
      setOrderFeedback({ error: e.message || "Failed to communicate trade command to routing engine." });
    }
  };

  const handlePanicFlush = async () => {
    if (!window.confirm("CRITICAL INTERRUPT: This will flatten all active trading holding structures instantly. Confirm?")) {
      return;
    }
    try {
      const res = await fetch("/api/trigger-flush", { method: "POST" });
      if (res.ok) {
        setOrderFeedback({ error: "PANIC CIRCUIT BREAKER INITIATED. ALL SESSIONS CLOSED. ROUTER ENFORCED HARD LOCK." });
        fetchState();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleResetDrawdownLock = async () => {
    try {
      const res = await fetch("/api/reset-drawdown-lock", { method: "POST" });
      if (res.ok) {
        setOrderFeedback({ success: "ADMIN OVERRIDE: Daily drawdown circuit breaker lock reset. Router online." });
        fetchState();
      } else {
        const data = await res.json();
        setOrderFeedback({ error: data.error || "Failed to reset drawdown hard lock." });
      }
    } catch (e: any) {
      setOrderFeedback({ error: e.message || "Failed to communicate administrative reset." });
    }
  };

  const handleResetSimulation = async () => {
    try {
      const res = await fetch("/api/reset-simulation", { method: "POST" });
      if (res.ok) {
        setOrderFeedback({ success: "Simulation parameters returned to seeded default standards." });
        fetchState();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const runPreFlightExpectancy = async () => {
    setIsSimulatingExpectancy(true);
    try {
      const data = await fetchJsonWithRetry("/api/run-expectancy", 6, 800);
      setSimulationData(data.baskets);
    } catch (e) {
      console.debug("Failed running pre-flight expectancy:", e);
    } finally {
      setIsSimulatingExpectancy(false);
    }
  };

  // Pre-arrange data for Recharts L2 DOM viz
  const bookForChart = marketBooks[selectedSymbol] || Object.values(marketBooks)[0];
  let chartData: any[] = [];
  if (bookForChart) {
    // Arrange bids and asks together sequentially
    const asksReversed = [...bookForChart.asks].reverse().map((item) => ({
      price: item.price,
      AskSize: item.size,
      BidSize: null,
      type: "Ask"
    }));
    const bidsNormal = bookForChart.bids.map((item) => ({
      price: item.price,
      AskSize: null,
      BidSize: item.size,
      type: "Bid"
    }));
    chartData = [...asksReversed, ...bidsNormal];
  }

  // Drawdown tracking calculations
  const totalUnrealized = activeTrades.reduce((acc, curr) => acc + curr.unrealizedPnL, 0);
  const totalRealized = historicalLogs.reduce((acc, curr) => acc + curr.realizedPnL, 0);
  const totalPnL = totalUnrealized + totalRealized;
  const drawdownPct = settings ? (totalPnL < 0 ? (Math.abs(totalPnL) / settings.referenceEquity) * 100 : 0) : 0;
  const drawdownLimitPct = settings?.dailyDrawdownLimitPercent ?? 2.5; // dynamic threshold

  // Dynamically sync selectedSymbol and tradeSymbol with the first available assets as they are scanned
  useEffect(() => {
    const keys = Object.keys(marketBooks);
    if (keys.length > 0) {
      if (!selectedSymbol || !marketBooks[selectedSymbol]) {
        setSelectedSymbol(keys[0]);
      }
      if (!tradeSymbol || !marketBooks[tradeSymbol]) {
        setTradeSymbol(keys[0]);
      }
    }
  }, [marketBooks, selectedSymbol, tradeSymbol]);

  // Sync inputs with selected symbol
  useEffect(() => {
    if (marketBooks[tradeSymbol]) {
      setTradeEntry(marketBooks[tradeSymbol].lastPrice.toString());
      setTradeStop((marketBooks[tradeSymbol].lastPrice - 0.65).toFixed(2));
    }
  }, [tradeSymbol, marketBooks]);

  return (
    <div id="alpha-engine-root" className="min-h-screen frosted-bg text-slate-100 font-sans tracking-tight pb-12">
      
      {/* 1. TOP DENT DEFI HEADINGS bar */}
      <header className="frosted-glass sticky top-0 z-50 px-6 py-4 rounded-none border-t-0 border-x-0 !bg-slate-950/40 backdrop-blur-md">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-[#00ff88]/20 border border-[#00ff88]/40 flex items-center justify-center shadow-lg shadow-[#00ff88]/10">
              <Flame className="w-6 h-6 text-[#00ff88] animate-pulse" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2 flex-wrap">
                Alpha Engine 
                <span className="text-[10px] bg-[#00ff88]/10 text-[#00ff88] font-mono px-2 py-0.5 rounded border border-[#00ff88]/25">IRLAND SYSTEM</span>
                <button
                  type="button"
                  onClick={toggleTradingMode}
                  title="Click to toggle between PAPER and LIVE trading mode instantly"
                  className="transition active:scale-95 duration-150 cursor-pointer select-none border-none bg-transparent p-0 rounded-md focus:outline-none"
                >
                  {settings?.tradingMode === "LIVE" ? (
                    <span className="text-[10px] bg-red-500/25 hover:bg-red-500/40 text-red-400 font-mono px-2 py-0.5 rounded border border-red-500/45 animate-pulse font-bold flex items-center gap-1 shadow-lg shadow-red-500/5 select-none">
                      🔴 IBIE LIVE PROD <span className="text-[8px] opacity-75 font-normal ml-0.5 underline decoration-red-500/50">CLICK TO FLIP</span>
                    </span>
                  ) : (
                    <span className="text-[10px] bg-indigo-500/25 hover:bg-indigo-500/40 text-indigo-300 font-mono px-2 py-0.5 rounded border border-indigo-500/45 font-bold flex items-center gap-1 shadow-lg shadow-indigo-500/5 select-none">
                      🎮 PAPER SIMULATION <span className="text-[8px] opacity-75 font-normal ml-0.5 underline decoration-indigo-500/50">CLICK TO FLIP</span>
                    </span>
                  )}
                </button>
              </h1>
              <p className="text-xs text-slate-400 font-mono">IBIE Regulatory (CBI Mandates) compliance module</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 font-mono text-xs">
            {/* Ny Clock Simulator */}
            <div className="bg-white/5 px-3 py-2 rounded-lg border border-white/10 flex items-center gap-2">
              <Clock className="w-4 h-4 text-[#ffaa00]" />
              <span>Wall Street Epoch: <strong className="text-slate-100">{settings?.marketTime || "09:30"} EST</strong></span>
            </div>

            {/* Session Phase indicator */}
            <div className="bg-white/5 px-3 py-2 rounded-lg border border-white/10 flex items-center gap-2">
              <Activity className="w-4 h-4 text-blue-400" />
              <span>Phase:</span>
              <span className={`font-semibold ${
                settings?.marketPhase === "EXECUTION" ? "text-[#00ff88]" :
                settings?.marketPhase === "FLUSH" ? "text-[#ff4444]" : "text-[#ffaa00]"
              }`}>
                {settings?.marketPhase || "EXECUTION"}
              </span>
            </div>

            {/* Simulated server heartbeat */}
            <div className={`px-3 py-2 rounded-lg border flex items-center gap-2 ${
              settings?.routerLocked ? "bg-[#ff4444]/10 border-[#ff4444]/30 text-rose-300" : "bg-white/5 border-white/10 text-slate-300"
            }`}>
              <span className={`w-2.5 h-2.5 rounded-full ${settings?.routerLocked ? "frosted-pulse-red animate-pulse" : "frosted-pulse-green animate-pulse"}`} />
              <span>Gateway: {settings?.routerLocked ? "LOC_SHUT" : "DMA_ONLINE"}</span>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6 space-y-6">

        {/* 2. CLOUD RUN & FIREBASE FIRESTORE SYNC MONITOR CENTER */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="md:col-span-2 frosted-glass frosted-glass-hover p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/10 pb-4 mb-4 font-sans">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-indigo-950/40 border border-indigo-500/30">
                  <Database className="w-5 h-5 text-indigo-400 animate-pulse" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                    Firebase Firestore Command Tunnel
                    <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono ${
                      firebaseStatus === "authorized" 
                        ? "bg-[#00ff88]/15 text-[#00ff88] border border-[#00ff88]/20" 
                        : "bg-amber-500/15 text-amber-400 border border-amber-500/20"
                    }`}>
                      {firebaseStatus === "authorized" ? "SYNCHRONIZED LIVE" : "IN-MEMORY EMULATION"}
                    </span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">
                    Connect CBI compliance audits, risk metrics, and holding structures directly to your secure Firestore node.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowFirebaseConfigPanel(!showFirebaseConfigPanel)}
                  className={`p-2 rounded-lg border transition cursor-pointer ${
                    showFirebaseConfigPanel || isCustomConfigActive
                      ? "bg-amber-500/20 border-amber-500/40 text-amber-300"
                      : "bg-white/5 border-white/10 hover:bg-white/10 text-slate-300"
                  }`}
                  title="Configure Custom Backend Credentials for Custom Domains"
                >
                  <Settings2 className="w-4 h-4" />
                </button>

                {currentUser ? (
                  <div className="flex items-center gap-2 font-mono">
                    <span className="text-[10px] text-slate-400 hidden sm:inline">{currentUser.email}</span>
                    <button
                      onClick={handleFirebaseLogout}
                      className="px-2.5 py-1 text-[10px] bg-red-500/20 hover:bg-red-500/30 text-red-200 border border-red-500/30 rounded cursor-pointer transition"
                    >
                      Disconnect Port
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={handleFirebaseLogin}
                    className="px-3 py-1.5 bg-[#00ff88]/20 hover:bg-[#00ff88]/35 text-[#00ff88] border border-[#00ff88]/40 rounded-lg text-xs font-mono font-medium flex items-center gap-1.5 transition cursor-pointer shadow-lg shadow-[#00ff88]/5"
                  >
                    <UserCheck className="w-3.5 h-3.5" /> Authorize & Link Firestore
                  </button>
                )}
              </div>
            </div>

            {/* Custom Credentials Configuration Drawer */}
            {showFirebaseConfigPanel && (
              <div className="mt-4 mb-4 bg-amber-950/20 border border-amber-500/20 p-4 rounded-lg font-sans text-xs space-y-3">
                <div className="flex justify-between items-center pb-2 border-b border-white/5 text-amber-200 font-semibold font-mono">
                  <span>OVERRIDE FIRESTORE CREDENTIALS (CUSTOM DOMAIN PORTABILITY)</span>
                  {isCustomConfigActive && (
                    <button
                      onClick={resetCustomFirebaseConfig}
                      className="text-[10px] bg-red-500/10 hover:bg-red-500/25 border border-red-500/30 text-red-100 px-2 py-0.5 rounded cursor-pointer transition"
                    >
                      Reset Default Sandbox
                    </button>
                  )}
                </div>
                
                <p className="text-slate-400 leading-relaxed">
                  Default developer credentials are key-restricted to the AI Studio preview host. To authenticate on your custom Cloud Run production domain (<code className="text-indigo-300 font-mono text-[10px]">europe-west3.run.app</code>), configure your custom Firebase Project's web client values below.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-slate-300 font-mono text-[11px]">
                  <div>
                    <label className="block text-slate-500 mb-1">API KEY (apiKey)</label>
                    <input
                      type="text"
                      value={tempFirebaseConfig.apiKey || ""}
                      onChange={(e) => setTempFirebaseConfig({ ...tempFirebaseConfig, apiKey: e.target.value })}
                      className="w-full bg-black/45 border border-white/10 rounded px-2.5 py-1.5 text-slate-200 focus:outline-none focus:border-amber-500/50"
                      placeholder="AIzaSy..."
                    />
                  </div>
                  <div>
                    <label className="block text-slate-500 mb-1">PROJECT ID (projectId)</label>
                    <input
                      type="text"
                      value={tempFirebaseConfig.projectId || ""}
                      onChange={(e) => setTempFirebaseConfig({ ...tempFirebaseConfig, projectId: e.target.value })}
                      className="w-full bg-black/45 border border-white/10 rounded px-2.5 py-1.5 text-slate-200 focus:outline-none focus:border-amber-500/50"
                      placeholder="my-gcp-project-id"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-500 mb-1">AUTH DOMAIN (authDomain)</label>
                    <input
                      type="text"
                      value={tempFirebaseConfig.authDomain || ""}
                      onChange={(e) => setTempFirebaseConfig({ ...tempFirebaseConfig, authDomain: e.target.value })}
                      className="w-full bg-black/45 border border-white/10 rounded px-2.5 py-1.5 text-slate-200 focus:outline-none focus:border-amber-500/50"
                      placeholder="my-gcp-project-id.firebaseapp.com"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-500 mb-1">FIRESTORE DATABASE ID (defaults to (default))</label>
                    <input
                      type="text"
                      value={tempFirebaseConfig.firestoreDatabaseId || ""}
                      onChange={(e) => setTempFirebaseConfig({ ...tempFirebaseConfig, firestoreDatabaseId: e.target.value })}
                      className="w-full bg-black/45 border border-white/10 rounded px-2.5 py-1.5 text-slate-200 focus:outline-none focus:border-amber-500/50"
                      placeholder="(default)"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-500 mb-1">STORAGE BUCKET (storageBucket)</label>
                    <input
                      type="text"
                      value={tempFirebaseConfig.storageBucket || ""}
                      onChange={(e) => setTempFirebaseConfig({ ...tempFirebaseConfig, storageBucket: e.target.value })}
                      className="w-full bg-black/45 border border-white/10 rounded px-2.5 py-1.5 text-slate-200 focus:outline-none focus:border-amber-500/50"
                      placeholder="my-gcp-project-id.firebasestorage.app"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-500 mb-1">MESSAGING SENDER ID (messagingSenderId)</label>
                    <input
                      type="text"
                      value={tempFirebaseConfig.messagingSenderId || ""}
                      onChange={(e) => setTempFirebaseConfig({ ...tempFirebaseConfig, messagingSenderId: e.target.value })}
                      className="w-full bg-black/45 border border-white/10 rounded px-2.5 py-1.5 text-slate-200 focus:outline-none focus:border-amber-500/50"
                      placeholder="84192..."
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    onClick={() => setShowFirebaseConfigPanel(false)}
                    className="px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 rounded cursor-pointer transition font-mono"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={saveCustomFirebaseConfig}
                    className="px-4 py-1.5 bg-amber-500/20 hover:bg-amber-500/35 border border-amber-500/40 text-amber-200 rounded cursor-pointer transition font-mono font-medium flex items-center gap-1.5"
                  >
                    Save & Initialize Pipeline
                  </button>
                </div>
              </div>
            )}

            {/* If authenticated, show details and bidirectional buttons */}
            {firebaseStatus === "authorized" ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="bg-black/25 backdrop-blur-sm p-3 rounded-lg border border-white/5 font-mono text-xs space-y-2">
                  <div className="text-[10px] text-slate-500 uppercase tracking-widest">Firestore Nodes Status</div>
                  {isTestingConn || !syncSummary ? (
                    <div className="text-slate-400 flex items-center gap-1.5 text-[11px] py-1">
                      <RefreshCw className="w-3 h-3 animate-spin text-indigo-400" /> Verifying structure and rules integrity...
                    </div>
                  ) : (
                    <div className="space-y-1.5 text-[11px] text-slate-300">
                      <div className="flex justify-between items-center bg-white/5 px-2 py-1 rounded">
                        <span>active_trades:</span>
                        <span className="font-bold text-[#00ff88]">{syncSummary.activeCount} docs</span>
                      </div>
                      <div className="flex justify-between items-center bg-white/5 px-2 py-1 rounded">
                        <span>historical_logs:</span>
                        <span className="font-bold text-[#00ff88]">{syncSummary.logsCount} docs</span>
                      </div>
                      <div className="flex justify-between items-center bg-white/5 px-2 py-1 rounded">
                        <span>system_risk_state:</span>
                        <span className="font-bold text-[#00ff88]">{syncSummary.statesCount} docs</span>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-2 justify-center">
                  <div className="text-[10px] text-slate-500 font-mono uppercase tracking-widest mb-1">Bidirectional Tunnel Operations</div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={pushStateToCloud}
                      disabled={isSyncingWithFirebase}
                      className="px-3 py-2 bg-indigo-500/15 hover:bg-indigo-500/25 disabled:opacity-40 border border-indigo-500/30 text-indigo-300 rounded-lg text-xs font-mono transition cursor-pointer flex items-center justify-center gap-1"
                      title="Upload in-memory trades/logs to Cloud Firestore"
                    >
                      {isSyncingWithFirebase ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <TrendingUp className="w-3.5 h-3.5" />} Push Memory
                    </button>
                    <button
                      onClick={pullStateFromCloud}
                      disabled={isSyncingWithFirebase}
                      className="px-3 py-2 bg-[#00ff88]/15 hover:bg-[#00ff88]/25 disabled:opacity-40 border border-[#00ff88]/30 text-[#00ff88] rounded-lg text-xs font-mono transition cursor-pointer flex items-center justify-center gap-1"
                      title="Download trades/logs from Cloud Firestore into Running Engine"
                    >
                      {isSyncingWithFirebase ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Restore Logs
                    </button>
                  </div>
                  <p className="text-[9px] text-slate-500 font-mono text-center mt-1">
                    Updates will propagate via strict Firestore security filter.
                  </p>
                </div>
              </div>
            ) : (
              <div className="bg-amber-500/5 border border-amber-500/10 p-3.5 rounded-lg text-slate-300 font-mono text-xs leading-relaxed">
                <div className="text-amber-400 font-semibold mb-1 flex items-center gap-1.5">
                  <AlertOctagon className="w-4 h-4 text-amber-400 animate-pulse" /> SIMULATION DECOUPLED FROM CLOUD STORAGE
                </div>
                The trading engine is operating in isolated in-memory buffers. Authorize using Google Login above to link current session metrics to your live Firestore tables and secure real-time permanence.
              </div>
            )}

            {/* Firebase Error Log Monitor */}
            {firebaseError && (
              <div className="mt-4 bg-red-950/35 border border-red-500/30 p-4 rounded-lg font-sans text-xs space-y-3">
                <div className="text-red-400 font-bold font-mono uppercase tracking-wider flex items-center gap-1.5 border-b border-red-500/15 pb-2">
                  <AlertOctagon className="w-4 h-4 text-red-400 animate-pulse" /> SECURITY / PERSISTENCE EXCEPTION
                </div>
                <div className="bg-black/25 p-2 rounded border border-white/5 font-mono text-[10px] text-red-300 overflow-x-auto whitespace-pre-wrap">
                  {firebaseError}
                </div>
                
                {firebaseError.includes("configuration-not-found") && (
                  <div className="bg-amber-500/5 border border-amber-500/20 p-3 rounded text-slate-300 space-y-2 leading-relaxed">
                    <p className="font-semibold text-amber-200 font-mono text-[11px] uppercase tracking-wider">
                      🛠️ HOW TO RESOLVE IN GOOGLE/FIREBASE CONSOLE:
                    </p>
                    <ol className="list-decimal list-inside space-y-1.5 text-[11px] text-slate-300">
                      <li>
                        Go to the <a href="https://console.firebase.google.com/" target="_blank" rel="noopener noreferrer" className="text-indigo-400 underline hover:text-indigo-300 font-semibold font-mono">Firebase Console</a> and select your project.
                      </li>
                      <li>
                        In the left sidebar, click <strong>Authentication</strong>.
                      </li>
                      <li>
                        Go to the <strong>Sign-in method</strong> tab and click <strong>Add new provider</strong>.
                      </li>
                      <li>
                        Configure and enable the <strong>Google</strong> provider (enter your support email, then click <strong>Save</strong>).
                      </li>
                      <li>
                        Under top tab <strong>Settings</strong> &gt; <strong>Authorized domains</strong>, ensure your production host URL (<code className="text-amber-200 font-mono text-[10px]">alpha-engine-aistudio-138990607360.europe-west3.run.app</code>) is listed.
                      </li>
                    </ol>
                  </div>
                )}

                {(firebaseError.toLowerCase().includes("permission") || firebaseError.toLowerCase().includes("insufficient")) && (
                  <div className="bg-amber-500/5 border border-amber-500/20 p-3.5 rounded text-slate-300 space-y-3 leading-relaxed">
                    <p className="font-semibold text-amber-200 font-mono text-[11px] uppercase tracking-wider">
                      🛡️ ACTION REQUIRED: UPDATE FIRESTORE SECURITY RULES
                    </p>
                    <p className="text-[11px] text-slate-300">
                      Your Firestore database is currently blocking read/write requests. Paste our production-ready, security-hardened rules into your Firebase Console to authorize synchronized real-time data flow for your logged-in session.
                    </p>
                    
                    <button
                      onClick={() => handleClipboardCopy(securityRulesText)}
                      className={`w-full py-2 border rounded text-xs font-mono font-medium transition cursor-pointer flex items-center justify-center gap-1.5 ${
                        copiedRules
                          ? "bg-green-600/30 border-green-500/50 text-green-200"
                          : copyFailed
                          ? "bg-rose-600/30 border-rose-500/50 text-rose-200"
                          : "bg-amber-500/20 hover:bg-amber-500/35 border-amber-500/40 text-amber-200"
                      }`}
                    >
                      {copiedRules ? "✅ Rules Copied Successfully!" : copyFailed ? "❌ Copy Blocked by Browser Context" : "📋 Copy Hardened Rules to Clipboard"}
                    </button>

                    {copyFailed && (
                      <div className="bg-rose-950/40 border border-rose-500/30 text-rose-300 p-3 rounded text-[11px] space-y-1.5 font-sans">
                        <p className="font-bold font-mono text-rose-200 uppercase tracking-wider text-[10px] flex items-center gap-1">
                          ⚠️ IFRAME CLIPBOARD PROTECTION ACTIVE
                        </p>
                        <p className="leading-relaxed">
                          Your browser sandboxing completely blocks programmatic updates to the clipboard from inside nested preview frames.
                        </p>
                        <p className="leading-relaxed font-semibold text-amber-200 font-mono">
                          👉 Clear workaround: Click inside the dark text box below, press Ctrl + A (or Cmd + A) to highlight everything, then press Ctrl + C (or Cmd + C) to copy.
                        </p>
                      </div>
                    )}

                    <ol className="list-decimal list-inside space-y-1.5 text-[11px] text-slate-300 pt-1.5 border-t border-white/5">
                      <li>
                        Go to the <a href="https://console.firebase.google.com/" target="_blank" rel="noopener noreferrer" className="text-indigo-400 underline hover:text-indigo-300 font-semibold font-mono">Firebase Console</a> and select your project.
                      </li>
                      <li>
                        Under "Build" or the left side rail, click <strong>Firestore Database</strong>.
                      </li>
                      <li>
                        Click the <strong>Rules</strong> tab at the top.
                      </li>
                      <li>
                        Delete any existing code, paste the copied rules, and click <strong>Publish</strong>.
                      </li>
                    </ol>

                    {securityRulesText && (
                      <div className="mt-3 space-y-1.5">
                        <span className="block text-[10px] text-slate-400 font-mono uppercase">Full Hardened Rules (Click to select all):</span>
                        <textarea
                          ref={rulesTextareaRef}
                          readOnly
                          value={securityRulesText}
                          onClick={(e) => {
                            const elem = e.target as HTMLTextAreaElement;
                            elem.focus();
                            elem.select();
                          }}
                          rows={12}
                          className="w-full bg-black/55 border border-white/10 rounded p-2 text-[10px] text-amber-200 font-mono focus:outline-none focus:border-amber-500/50 select-all leading-normal resize-y"
                          placeholder="Loading security rules..."
                        />
                        <span className="text-[9px] text-slate-500 italic block font-mono leading-none">
                          💡 Alternative: Click inside the box above, press Ctrl+A (Cmd+A) to select all, then copy.
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="frosted-glass frosted-glass-hover p-6 flex flex-col justify-between gap-4 font-sans">
            <div className="space-y-2">
              <span className="text-[10px] uppercase tracking-wider text-slate-500 font-mono">MiFIR (CBI) Profile</span>
              <p className="text-xs text-slate-200 font-mono font-medium truncate flex items-center gap-2">
                <UserCheck className="w-4 h-4 text-blue-400" /> {settings?.mifid2DecisionMaker || "NO_CODE"}
              </p>
              <div className="text-[11px] text-slate-400 font-mono space-y-1">
                <div>Client ID: <span className="text-slate-200">{settings?.ibkrClientId || 10}</span></div>
                <div>Server Port: <span className="text-slate-200">{settings?.ibkrPort || 4002}</span></div>
              </div>
            </div>
            <button
              onClick={handleResetSimulation}
              className="w-full py-2.5 bg-white/5 hover:bg-white/10 rounded-lg text-slate-300 hover:text-white transition flex items-center justify-center gap-2 text-xs font-mono border border-white/10 cursor-pointer"
              title="Reset Simulated Logs"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Reset Demo Workspace
            </button>
          </div>
        </div>

        {/* 2.5. GOOGLE CLOUD LOW-LATENCY PROXIMITY AUXILIARY COMPANION */}
        <GcpCompanion settings={settings} />

        {/* 3. DUAL-COLUMN LAYOUT: METRICS & CONTROLS */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* DRMMiddleware Metrics Column */}
          <div className="lg:col-span-2 space-y-6">
            
            {/* DRM Master Card */}
            <div className="frosted-glass frosted-glass-hover p-6 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full blur-3xl pointer-events-none" />
              
              <div className="flex items-center justify-between border-b border-white/15 pb-4 mb-4">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="w-5 h-5 text-[#ffaa00] animate-pulse" />
                  <span className="text-sm font-semibold tracking-wide text-slate-200">POOL-EQUITY RISK GUARD (DRM INTERFACE)</span>
                </div>
                <div className="text-xs font-mono text-slate-500">
                  Account: {settings?.ibkrAccountNumber || "NOT CONNECTED"}
                </div>
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-5">
                <div className="bg-black/30 backdrop-blur-sm p-3 rounded-lg border border-white/5 relative group cursor-help">
                  <span className="text-[10px] text-slate-500 block font-mono">NET LIQUIDATION</span>
                  <span className="text-base font-mono font-bold text-slate-100">
                    €{settings?.netLiquidation?.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                  <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-slate-950/95 border border-white/15 text-[9px] text-slate-300 p-2 rounded shadow-2xl opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-200 pointer-events-none w-44 z-50 text-center leading-normal">
                    Real-time valuation of total assets including premium cash balances and current security holdings.
                  </div>
                </div>

                <div className="bg-black/30 backdrop-blur-sm p-3 rounded-lg border border-white/5 relative group cursor-help">
                  <span className="text-[10px] text-slate-500 block font-mono">INITIAL CAPITAL REF</span>
                  <span className="text-base font-mono font-bold text-slate-300">
                    €{settings?.referenceEquity?.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                  <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-slate-950/95 border border-white/15 text-[9px] text-slate-300 p-2 rounded shadow-2xl opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-200 pointer-events-none w-44 z-50 text-center leading-normal">
                    Starting Reference Capital booked at the beginning of the trading week or month to benchmark drawdown.
                  </div>
                </div>

                <div className="bg-black/30 backdrop-blur-sm p-3 rounded-lg border border-[#00ff88]/20 relative group cursor-help">
                  <span className="text-[10px] text-[#00ff88] block font-mono uppercase">Capital Shield</span>
                  <span className="text-base font-mono font-bold text-[#00ff88]">
                    {settings?.virtualCapitalCeiling && settings.virtualCapitalCeiling > 0 ? (
                      `€${settings.virtualCapitalCeiling.toLocaleString(undefined, { minimumFractionDigits: 2 })}`
                    ) : (
                      <span className="text-slate-500 text-xs font-semibold">UNLIMITED</span>
                    )}
                  </span>
                  <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-[#05150a]/95 border border-[#00ff88]/30 text-[9px] text-slate-300 p-2 rounded shadow-2xl opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-200 pointer-events-none w-44 z-50 text-center leading-normal">
                    Protective allocation risk limit. When enabled, trade sizes and leverage thresholds are capped based on this size rather than full pool equity.
                  </div>
                </div>

                <div className="bg-black/30 backdrop-blur-sm p-3 rounded-lg border border-white/5 relative group cursor-help">
                  <span className="text-[10px] text-slate-500 block font-mono">MAINTENANCE MARGIN</span>
                  <span className="text-base font-mono font-bold text-slate-400">
                    €{settings?.maintenanceMargin?.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                  <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-slate-950/95 border border-white/15 text-[9px] text-slate-300 p-2 rounded shadow-2xl opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-200 pointer-events-none w-44 z-50 text-center leading-normal">
                    Minimum buffer capital demanded by IBIE to keep premium leveraged positions open overnight.
                  </div>
                </div>

                <div className="bg-black/30 backdrop-blur-sm p-3 rounded-lg border border-white/5 relative group cursor-help">
                  <span className="text-[10px] text-slate-500 block font-mono">DAILY SESSION P&L</span>
                  <span className={`text-base font-mono font-bold ${totalPnL >= 0 ? "text-[#00ff88]" : "text-[#ff4444]"}`}>
                    {totalPnL >= 0 ? "+" : ""}€{totalPnL.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                  <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-slate-950/95 border border-white/15 text-[9px] text-slate-300 p-2 rounded shadow-2xl opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-200 pointer-events-none w-44 z-50 text-center leading-normal">
                    Net aggregate profits or losses generated across all finalized transactions and working contracts today.
                  </div>
                </div>
              </div>

              {/* Drawdown Circuit Breaker visualization */}
              <div className="space-y-3.5 border-t border-white/10 pt-4">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span className="flex items-center gap-1.5 font-semibold">
                    <AlertOctagon className="w-4 h-4 text-[#ff4444]" /> Daily Drawdown Circuit Breaker Limit (-{drawdownLimitPct}%)
                  </span>
                  <span className="font-mono text-slate-300">
                    {drawdownPct.toFixed(2)}% / {drawdownLimitPct}% Limit
                  </span>
                </div>

                {/* Visual Bar */}
                <div className="w-full h-2.5 bg-slate-950 rounded-full overflow-hidden border border-slate-900 relative">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      drawdownPct >= drawdownLimitPct * 0.75 ? "bg-rose-500" : drawdownPct >= drawdownLimitPct * 0.4 ? "bg-amber-500" : "bg-emerald-500"
                    }`}
                    style={{ width: `${Math.min(100, (drawdownPct / drawdownLimitPct) * 100)}%` }}
                  />
                  {/* Mark the spot */}
                  <div className="absolute right-0 top-0 bottom-0 w-0.5 bg-rose-600" title="Circuit Breaker" />
                </div>
                <div className="flex justify-between text-[9px] text-slate-600 font-mono">
                  <span>0.0% P&L Flat</span>
                  <span>-{(drawdownLimitPct / 2).toFixed(2)}% Buffer</span>
                  <span className="text-rose-500 font-semibold">-{drawdownLimitPct}% Emergency Lock</span>
                </div>

                {/* Cash Drawdown details & Router Lock overrides */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 bg-black/45 rounded-lg border border-white/5 text-xs font-mono">
                  <div className="space-y-1">
                    <span className="text-[10px] text-slate-500 block">CASH DRAWDOWN THRESHOLD</span>
                    <span className={`font-semibold ${totalPnL < 0 && Math.abs(totalPnL) >= (settings?.dailyDrawdownLimitCash ?? 1500) ? "text-rose-400" : "text-slate-300"}`}>
                      €{totalPnL < 0 ? Math.abs(totalPnL).toFixed(2) : "0.00"} / €{settings?.dailyDrawdownLimitCash ?? "1,500.00"} Limit
                    </span>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-3">
                    <div className="text-right">
                      <span className="text-[10px] text-slate-500 block">ROUTER STATE</span>
                      <span className={`font-extrabold ${settings?.routerLocked ? "text-rose-400" : "text-[#00ff88]"}`}>
                        {settings?.routerLocked ? "● LOCKED" : "● ONLINE"}
                      </span>
                    </div>

                    {settings?.routerLocked && (
                      <button
                        type="button"
                        onClick={handleResetDrawdownLock}
                        className="px-2.5 py-1 bg-amber-500 hover:bg-amber-600 text-black font-extrabold rounded text-[10px] uppercase shadow transition cursor-pointer select-none"
                      >
                        ADMIN UNLOCK
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Panic Liquidation Button */}
              <div className="mt-5 pt-4 border-t border-slate-800/60 flex flex-col sm:flex-row items-center justify-between gap-4">
                <p className="text-xs text-slate-500">
                  EWrapper global cancellation sends a Global Cancel + places immediate market order fills to clear all assets safely.
                </p>
                <button
                  type="button"
                  id="panic-kill-btn"
                  onClick={handlePanicFlush}
                  className="px-5 py-3 bg-rose-600 hover:bg-rose-700 text-white rounded-lg flex items-center gap-2 shadow-lg shadow-rose-950 font-medium tracking-wide text-xs uppercase cursor-pointer shrink-0 transition"
                >
                  <XCircle className="w-4 h-4" /> EMERGENCY ROUTER OVERRIDE FLUSH
                </button>
              </div>
            </div>

            {/* Level 2 Order Book Depth and OFI Imbalance tracking */}
            <div className="frosted-glass frosted-glass-hover p-6">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-white/10 pb-4 mb-4">
                <div>
                  <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-widest flex items-center gap-1.5">
                    <TrendingUp className="w-4 h-4 text-[#00ff88]" /> LEVEL 2 DEPTH OF MARKET & ORDER FLOW
                  </h2>
                  <p className="text-[11px] text-slate-400 font-mono mt-0.5">Calculates Real-Time Imbalance Metrics on Level 2 tick intervals</p>
                </div>

                 <div className="flex flex-wrap items-center gap-2">
                  {Object.keys(marketBooks).map((symbol) => (
                    <button
                      key={symbol}
                      onClick={() => setSelectedSymbol(symbol)}
                      className={`px-3 py-1.5 font-mono text-xs rounded transition cursor-pointer flex items-center gap-2 ${
                        selectedSymbol === symbol || (selectedSymbol === "" && Object.keys(marketBooks)[0] === symbol)
                          ? "bg-white/10 border border-white/20 text-[#00ff88] font-bold"
                          : "bg-black/30 border border-white/5 text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      <span className="font-bold">{symbol}</span>
                      {marketBooks[symbol]?.primaryExchange && (
                        <span className={`px-1 py-0.5 rounded-[3px] text-[8px] font-bold ${
                          marketBooks[symbol].primaryExchange === "SBF" || marketBooks[symbol].primaryExchange === "AEB" || marketBooks[symbol].primaryExchange === "SB"
                            ? "bg-[#00ff88]/15 text-[#00ff88] border border-[#00ff88]/20" 
                            : marketBooks[symbol].primaryExchange === "IBIS"
                            ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                            : "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                        }`}>
                          {marketBooks[symbol].primaryExchange}
                        </span>
                      )}
                      <span className="text-[10px] text-slate-300">(${marketBooks[symbol]?.lastPrice?.toFixed(2) || "0.00"})</span>
                    </button>
                  ))}

                  {/* Custom Asset Ingestor Tool */}
                  <div className="flex items-center gap-1.5 border border-dashed border-white/10 p-1 rounded bg-black/20">
                    <input
                      type="text"
                      placeholder="ADD TICKER"
                      id="custom-symbol-input"
                      className="w-20 bg-black/40 border border-white/10 rounded px-1.5 py-1 text-slate-100 placeholder-slate-500 text-[10px] uppercase font-mono focus:outline-none focus:border-[#00ff88]/50"
                      onKeyDown={async (e) => {
                        if (e.key === "Enter") {
                          const btn = document.getElementById("custom-ingest-btn");
                          if (btn) btn.click();
                        }
                      }}
                    />
                    <select
                      id="custom-exchange-select"
                      className="bg-black/40 border border-white/10 rounded px-1 py-1 text-slate-300 text-[9px] font-mono focus:outline-none"
                    >
                      <option value="NYSE">NYSE</option>
                      <option value="NASDAQ">NASDAQ</option>
                      <option value="SBF">EUR-SBF</option>
                      <option value="IBIS">XETRA</option>
                    </select>
                    <button
                      type="button"
                      id="custom-ingest-btn"
                      onClick={async () => {
                        const symInput = document.getElementById("custom-symbol-input") as HTMLInputElement;
                        const exchSelect = document.getElementById("custom-exchange-select") as HTMLSelectElement;
                        if (symInput && symInput.value.trim()) {
                          const sym = symInput.value.trim().toUpperCase();
                          const exch = exchSelect.value;
                          const startPrice = Math.floor(Math.random() * 80) + 40;
                          try {
                            const res = await fetch("/api/scanner-ingest", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ symbol: sym, primaryExchange: exch, lastPrice: startPrice })
                            });
                            if (res.ok) {
                              const d = await res.json();
                              setMarketBooks(d.marketBooks);
                              setSelectedSymbol(sym);
                              symInput.value = "";
                              setOrderFeedback({ success: `Security INGESTED and STREAMING successfully: ${sym} (${exch}) @ $${startPrice}` });
                            }
                          } catch (err: any) {
                            setOrderFeedback({ error: "Failed to ingest symbol: " + err.message });
                          }
                        }
                      }}
                      className="px-2 py-1 bg-[#00ff88]/15 hover:bg-[#00ff88]/30 text-[#00ff88] border border-[#00ff88]/30 rounded text-[9px] font-mono flex items-center transition cursor-pointer"
                    >
                      + INGEST
                    </button>
                  </div>
                </div>
              </div>

              {bookForChart ? (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* Depth Chart viz */}
                  <div className="md:col-span-2 h-64 bg-black/40 border border-white/5 rounded-lg p-2 relative">
                    <div className="absolute top-2 left-2 text-[10px] text-slate-500 font-mono">BID / ASK SHIFT HISTOGRAM</div>
                    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                      <BarChart data={chartData} margin={{ top: 15, right: 10, left: -15, bottom: 5 }}>
                        <XAxis dataKey="price" stroke="#475569" fontSize={9} tickLine={false} />
                        <YAxis stroke="#475569" fontSize={9} tickLine={false} />
                        <Tooltip
                          contentStyle={{ backgroundColor: "#090c10", borderColor: "rgba(255,255,255,0.08)" }}
                          labelStyle={{ color: "#94a3b8" }}
                          itemStyle={{ fontSize: "11px" }}
                        />
                        <Bar dataKey="BidSize" fill="#00ff88" opacity={0.65} name="Bid Size" />
                        <Bar dataKey="AskSize" fill="#ff4444" opacity={0.65} name="Ask Size" />
                        <ReferenceLine x={bookForChart.lastPrice} stroke="#00ff88" strokeDasharray="3 3" label={{ value: "P", fill: "#00ff88", fontSize: 10, position: "top" }} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Order flow state calculator */}
                  <div className="bg-black/30 backdrop-blur-sm p-4 rounded-lg border border-white/5 flex flex-col justify-between">
                    <div>
                      <span className="text-[10px] text-slate-500 font-mono uppercase tracking-widest block">ORDER FLOW IMBALANCE (OFI)</span>
                      
                      <div className="flex items-baseline gap-2 mt-2">
                        <span className={`text-3xl font-mono font-bold ${bookForChart.lastOfi > 0 ? "text-[#00ff88]" : bookForChart.lastOfi < 0 ? "text-[#ff4444]" : "text-slate-400"}`}>
                          {bookForChart.lastOfi > 0 ? "+" : ""}{bookForChart.lastOfi}
                        </span>
                        <span className="text-[10px] text-slate-500 font-mono">Shares</span>
                      </div>

                      {/* Direction Meter indicator */}
                      <div className="mt-3 p-2 bg-black/40 border border-white/5 rounded">
                        <p className="text-[10px] text-slate-400 font-mono">Signal Suggestion:</p>
                        <p className="text-xs font-semibold text-slate-100 mt-1 flex items-center gap-1.5">
                          {bookForChart.lastOfi > 250 ? (
                            <>
                              <span className="w-2.5 h-2.5 rounded-full frosted-pulse-green animate-pulse" />
                              <strong className="text-[#00ff88] font-mono font-normal">OFI Divergence Bullish Setup</strong>
                            </>
                          ) : bookForChart.lastOfi < -250 ? (
                            <>
                              <span className="w-2.5 h-2.5 rounded-full frosted-pulse-red animate-pulse" />
                              <strong className="text-[#ff4444] font-mono font-normal">OFI Divergence Bearish Setup</strong>
                            </>
                          ) : (
                            <>
                              <span className="w-2.5 h-2.5 rounded-full bg-slate-500" />
                              <strong className="text-slate-400 font-mono font-normal flex">No Outlier Signal Imbalance</strong>
                            </>
                          )}
                        </p>
                      </div>
                    </div>

                    <div className="pt-2">
                      <p className="text-[10px] text-slate-500 font-mono mb-2">Simulate structural ticks manually:</p>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={() => handleManualTick("UP")}
                          disabled={settings?.routerLocked}
                          className="px-2 py-1.5 bg-[#00ff88]/10 hover:bg-[#00ff88]/20 text-[#00ff88] rounded text-xs font-mono transition border border-[#00ff88]/25 cursor-pointer disabled:opacity-40"
                        >
                          + Tick Bid Depth
                        </button>
                        <button
                          onClick={() => handleManualTick("DOWN")}
                          disabled={settings?.routerLocked}
                          className="px-2 py-1.5 bg-[#ff4444]/10 hover:bg-[#ff4444]/20 text-[#ff4444] rounded text-xs font-mono transition border border-[#ff4444]/25 cursor-pointer disabled:opacity-40"
                        >
                          - Tick Ask Depth
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-12 text-slate-500 text-xs font-mono">Order book currently loading...</div>
              )}
            </div>
          </div>

          {/* RIGHT COLUMN: MANUAL TRADE ENTRY & CONTEXT */}
          <div className="space-y-6">

            {/* Trade Router Tool Card */}
            <div className="frosted-glass frosted-glass-hover p-6">
              <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-widest flex items-center gap-1.5 border-b border-white/10 pb-3 mb-4">
                <Coins className="w-4 h-4 text-[#00ff88]" /> TACTICAL PRE-TRADE ENTRY
              </h2>

              <form onSubmit={handlePlaceTrade} className="space-y-4">
                
                {/* Ticker selector */}
                <div>
                  <label className="text-[10px] uppercase font-mono text-slate-500 block">TARGET INSTRUMENT</label>
                  <select
                    value={tradeSymbol}
                    onChange={(e) => {
                      setTradeSymbol(e.target.value);
                    }}
                    className="w-full mt-1.5 bg-black/35 border border-white/10 rounded-md p-2 text-xs text-slate-100 font-mono focus:border-[#00ff88]/50 focus:outline-none transition"
                  >
                    {Object.keys(marketBooks).map((sym) => (
                      <option key={sym} value={sym} className="bg-slate-950">
                        {sym} [{marketBooks[sym]?.primaryExchange || "SMART"}] (${marketBooks[sym]?.lastPrice?.toFixed(2)})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Direction switcher */}
                <div>
                  <label className="text-[10px] uppercase font-mono text-slate-500 block mb-1.5">DIRECTION TYPE</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setTradeDirection("BUY")}
                      className={`py-2 text-xs rounded transition flex items-center justify-center gap-1.5 border font-mono cursor-pointer ${
                        tradeDirection === "BUY"
                          ? "bg-[#00ff88]/15 border-[#00ff88]/35 text-[#00ff88] font-bold"
                          : "bg-black/20 border-transparent text-slate-500"
                      }`}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-[#00ff88] frosted-pulse-green animate-pulse" /> LONG BUY
                    </button>
                    <button
                      type="button"
                      onClick={() => setTradeDirection("SELL")}
                      className={`py-2 text-xs rounded transition flex items-center justify-center gap-1.5 border font-mono cursor-pointer ${
                        tradeDirection === "SELL"
                          ? "bg-[#ff4444]/15 border-[#ff4444]/35 text-[#ff4444] font-bold"
                          : "bg-black/20 border-transparent text-slate-500"
                      }`}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-[#ff4444] frosted-pulse-red animate-pulse" /> SHORT SELL
                    </button>
                  </div>
                </div>

                {/* Grid parameter entry */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] uppercase font-mono text-slate-500 block">ENTRY PRICE ($)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={tradeEntry}
                      onChange={(e) => setTradeEntry(e.target.value)}
                      className="w-full mt-1.5 bg-black/35 border border-white/10 rounded-md p-2 text-xs text-slate-100 font-mono focus:border-[#00ff88]/50 focus:outline-none transition"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase font-mono text-slate-500 block">INITIAL STOP LOSS ($)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={tradeStop}
                      onChange={(e) => setTradeStop(e.target.value)}
                      className="w-full mt-1.5 bg-black/35 border border-white/10 rounded-md p-2 text-xs text-slate-100 font-mono focus:border-[#00ff88]/50 focus:outline-none transition"
                    />
                  </div>
                </div>

                {/* Estimated profit targets to verify friction */}
                <div>
                  <div className="flex justify-between items-center">
                    <label className="text-[10px] uppercase font-mono text-slate-500">PROFIT TARGET CELING ($)</label>
                    <span className="text-[9px] text-slate-500">For 15% Friction audit</span>
                  </div>
                  <input
                    type="number"
                    step="0.01"
                    value={tradeTarget}
                    onChange={(e) => setTradeTarget(e.target.value)}
                    className="w-full mt-1.5 bg-black/35 border border-white/10 rounded-md p-2 text-xs text-slate-100 font-mono focus:border-[#00ff88]/50 focus:outline-none transition"
                  />
                  <div className="text-[9px] text-slate-500 mt-1 font-mono">
                    Calculated position sizes apply: Stop Distance = ${Math.abs(Number(tradeEntry) - Number(tradeStop)).toFixed(2)}
                  </div>
                </div>

                {/* Submittal Button with locks config */}
                <button
                  type="submit"
                  disabled={settings?.routerLocked}
                  className="w-full py-3 bg-[#00ff88] hover:bg-[#00e077] text-black font-semibold rounded-lg text-xs tracking-wider uppercase transition cursor-pointer disabled:bg-white/5 disabled:text-slate-600 border border-white/10 shadow-lg shadow-[#00ff88]/10"
                >
                  {settings?.routerLocked ? "ROUTER SHUTDOWN ACTIVE" : "ROUTE COMPLIANT TRADING SIGNAL"}
                </button>
              </form>

              {/* Instant pre-trade order sizing feedback */}
              {orderFeedback && (
                <div className={`mt-4 p-3 rounded-lg text-xs font-mono border ${
                  orderFeedback.error 
                    ? "bg-[#ff4444]/15 border-[#ff4444]/35 text-[#ff4444]"
                    : "bg-[#00ff88]/15 border-[#00ff88]/35 text-[#00ff88]"
                }`}>
                  {orderFeedback.error && (
                    <div className="flex items-start gap-2">
                      <AlertOctagon className="w-4 h-4 text-[#ff4444] shrink-0 mt-0.5" />
                      <div>
                        <strong>ERROR Rejected:</strong> {orderFeedback.error}
                      </div>
                    </div>
                  )}
                  {orderFeedback.success && (
                    <div className="space-y-1.5">
                      <p className="font-semibold text-[#00ff88] flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5 text-[#00ff88]" /> SETUP CONFIRMED:
                      </p>
                      <p>{orderFeedback.success}</p>
                      {orderFeedback.allocatedQty && (
                        <div className="text-[10px] space-y-0.5 border-t border-green-900/40 pt-1.5 mt-1.5 text-slate-300">
                          <div>Position Size: <strong className="text-slate-100 font-bold">{orderFeedback.allocatedQty} shares</strong> (capped at 1% total Pool equity)</div>
                          <div>Spread Efficiency Loss: <strong className="text-slate-100 font-bold">{orderFeedback.efficiencyRatio}%</strong> / max 15.0%</div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* System config editor panel */}
            <div className="frosted-glass frosted-glass-hover p-6">
              <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-widest flex items-center gap-1.5 border-b border-white/10 pb-3 mb-4">
                <Settings2 className="w-4 h-4 text-slate-300" /> SYSTEM CONTROL CENTER
              </h2>

              <form onSubmit={handleUpdateSettings} className="space-y-3 font-mono text-xs text-slate-300">
                <div>
                  <label className="text-[10px] text-slate-500 uppercase font-mono block">IBIE Account Number</label>
                  <input
                    type="text"
                    value={editAccount}
                    onChange={(e) => setEditAccount(e.target.value)}
                    className="w-full mt-1 bg-black/35 border border-white/10 rounded p-1.5 text-slate-100 focus:outline-none focus:border-[#00ff88]/50"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 uppercase font-mono block">MiFIR Decision Maker Shortcode</label>
                  <input
                    type="text"
                    value={editDecisionMaker}
                    onChange={(e) => setEditDecisionMaker(e.target.value)}
                    className="w-full mt-1 bg-black/35 border border-white/10 rounded p-1.5 text-slate-100 focus:outline-none focus:border-[#00ff88]/50"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 uppercase font-mono block">MiFIR Executing Trader Shortcode</label>
                  <input
                    type="text"
                    value={editTrader}
                    onChange={(e) => setEditTrader(e.target.value)}
                    className="w-full mt-1 bg-black/35 border border-white/10 rounded p-1.5 text-slate-100 focus:outline-none focus:border-[#00ff88]/50"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 uppercase font-mono block">Reference Starting Capital (€)</label>
                  <input
                    type="number"
                    value={editReferenceEquity}
                    onChange={(e) => setEditReferenceEquity(Number(e.target.value))}
                    className="w-full mt-1 bg-black/35 border border-white/10 rounded p-1.5 text-slate-100 focus:outline-none focus:border-[#00ff88]/50"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 uppercase font-mono block flex justify-between">
                    <span>Virtual Capital Ceiling (€)</span>
                    {settings?.virtualCapitalCeiling && settings.virtualCapitalCeiling > 0 ? (
                      <span className="text-[#00ff88] font-bold text-[9px] px-1 bg-green-950/40 border border-[#00ff88]/20 rounded">🔒 ACTIVE SHIELD</span>
                    ) : (
                      <span className="text-slate-500">OFF (USES FULL CAP)</span>
                    )}
                  </label>
                  <input
                    type="number"
                    value={editVirtualCapitalCeiling}
                    onChange={(e) => setEditVirtualCapitalCeiling(Number(e.target.value))}
                    className="w-full mt-1 bg-[#112211]/35 border border-white/10 rounded p-1.5 text-slate-100 focus:outline-none focus:border-[#00ff88]/50"
                    placeholder="E.g. 25000"
                  />
                  <p className="text-[9px] text-slate-400 mt-1 leading-normal">
                    Caps risk and trade allocations strictly based on this amount, protecting the larger €{settings?.referenceEquity?.toLocaleString()} real capital pool.
                  </p>
                </div>

                <div className="border-t border-white/10 pt-3 mt-3">
                  <label className="text-[10px] text-slate-400 uppercase font-mono block mb-1.5 flex justify-between">
                    <span>Gateway Pipeline Mode</span>
                    <span className="text-[8px] text-slate-500">TOGGLE LIVE IBKR GATEWAY LINK</span>
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setEditGatewayConnectionActive(false)}
                      className={`py-1.5 px-3 rounded text-[10px] font-bold border transition duration-150 ${
                        !editGatewayConnectionActive
                          ? "bg-indigo-500/25 text-indigo-300 border-indigo-500/50"
                          : "bg-black/20 text-slate-400 border-white/5 hover:bg-black/40 hover:text-slate-200"
                      }`}
                    >
                      🎮 MOCK SIMULATION
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditGatewayConnectionActive(true)}
                      className={`py-1.5 px-3 rounded text-[10px] font-bold border transition duration-150 ${
                        editGatewayConnectionActive
                          ? "bg-amber-500/20 text-amber-400 border-amber-500/40"
                          : "bg-black/20 text-slate-400 border-white/5 hover:bg-black/40 hover:text-slate-200"
                      }`}
                    >
                      ⚡️ ACTIVE IBKR SUB
                    </button>
                  </div>
                  <p className="text-[8px] text-slate-500 mt-1 leading-normal uppercase">
                    {!editGatewayConnectionActive 
                      ? "Isolated sandbox. Generates synthetic Level 2 order books in-container." 
                      : "Engages headless Native API pipeline to local standard/TWS client gateway."}
                  </p>
                </div>

                <div className="border-t border-white/10 pt-3 mt-3">
                  <label className="text-[10px] text-slate-400 uppercase font-mono block mb-1.5 flex justify-between">
                    <span>Trader Auth Mode</span>
                    <span className="text-[8px] text-slate-500">SELECT TO PRE-SET PORT GATEWAYS</span>
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setEditTradingMode("PAPER");
                        setEditIbkrPort(4002); // Standard TWS paper/gateway port
                      }}
                      className={`py-1.5 px-3 rounded text-[10px] font-bold border transition duration-150 ${
                        editTradingMode === "PAPER"
                          ? "bg-indigo-500/25 text-indigo-300 border-indigo-500/50"
                          : "bg-black/20 text-slate-400 border-white/5 hover:bg-black/40 hover:text-slate-200"
                      }`}
                    >
                      🎮 PAPER
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditTradingMode("LIVE");
                        setEditIbkrPort(4001); // Standard TWS live/gateway port
                      }}
                      className={`py-1.5 px-3 rounded text-[10px] font-bold border transition duration-150 ${
                        editTradingMode === "LIVE"
                          ? "bg-red-500/20 text-red-400 border-red-500/40"
                          : "bg-black/20 text-slate-400 border-white/5 hover:bg-black/40 hover:text-slate-200"
                      }`}
                    >
                      🔴 LIVE PROD
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-slate-500 uppercase font-mono block">IB Gateway Target Port</label>
                    <input
                      type="number"
                      value={editIbkrPort}
                      onChange={(e) => setEditIbkrPort(Number(e.target.value))}
                      className="w-full mt-1 bg-black/35 border border-white/10 rounded p-1.5 text-slate-100 focus:outline-none focus:border-[#00ff88]/50 text-xs"
                      placeholder="e.g. 4001"
                    />
                    <span className="text-[8px] text-slate-500 mt-0.5 block">Paper: 4002/7497 | Live: 4001/7496</span>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 uppercase font-mono block">IB API Client ID</label>
                    <input
                      type="number"
                      value={editIbkrClientId}
                      onChange={(e) => setEditIbkrClientId(Number(e.target.value))}
                      className="w-full mt-1 bg-black/35 border border-white/10 rounded p-1.5 text-slate-100 focus:outline-none focus:border-[#00ff88]/50 text-xs"
                      placeholder="e.g. 10"
                    />
                    <span className="text-[8px] text-slate-500 mt-0.5 block">Allows parallel processes</span>
                  </div>
                </div>

                <div className="border-t border-white/10 pt-3 mt-3 space-y-2">
                  <span className="text-[10px] text-slate-400 uppercase font-mono block">Tactical Strategy Upgrades</span>
                  
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[9px] text-slate-500 block uppercase font-mono">Stop ATR Mult</label>
                      <input
                        type="number"
                        step="0.1"
                        value={editStopAtrMultiplier}
                        onChange={(e) => setEditStopAtrMultiplier(Number(e.target.value))}
                        className="w-full mt-0.5 bg-black/35 border border-white/10 rounded p-1 text-slate-100 text-xs focus:outline-none focus:border-[#00ff88]/50"
                      />
                    </div>
                    <div>
                      <label className="text-[9px] text-slate-500 block uppercase font-mono">Max Hold Bars</label>
                      <input
                        type="number"
                        value={editMaxHoldBars}
                        onChange={(e) => setEditMaxHoldBars(Number(e.target.value))}
                        className="w-full mt-0.5 bg-black/35 border border-white/10 rounded p-1 text-slate-100 text-xs focus:outline-none focus:border-[#00ff88]/50"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 mt-2 font-mono">
                    <label className="flex items-center gap-1.5 p-1.5 rounded bg-black/20 border border-white/5 cursor-pointer hover:bg-black/40">
                      <input
                        type="checkbox"
                        checked={editPartialProfit}
                        onChange={(e) => setEditPartialProfit(e.target.checked)}
                        className="accent-[#00ff88]"
                      />
                      <span className="text-[9px] text-slate-300 uppercase">Tranche Exit</span>
                    </label>
                    <label className="flex items-center gap-1.5 p-1.5 rounded bg-black/20 border border-white/5 cursor-pointer hover:bg-black/40">
                      <input
                        type="checkbox"
                        checked={editBreakevenLock}
                        onChange={(e) => setEditBreakevenLock(e.target.checked)}
                        className="accent-[#00ff88]"
                      />
                      <span className="text-[9px] text-slate-300 uppercase">Breakeven Lock</span>
                    </label>
                    <label className="flex items-center gap-1.5 p-1.5 rounded bg-black/20 border border-white/5 cursor-pointer hover:bg-black/40">
                      <input
                        type="checkbox"
                        checked={editOfiFilter}
                        onChange={(e) => setEditOfiFilter(e.target.checked)}
                        className="accent-[#00ff88]"
                      />
                      <span className="text-[9px] text-slate-300 uppercase">OFI L2 Filter</span>
                    </label>
                    <label className="flex items-center gap-1.5 p-1.5 rounded bg-black/20 border border-white/5 cursor-pointer hover:bg-black/40">
                      <input
                        type="checkbox"
                        checked={editAdaptiveStop}
                        onChange={(e) => setEditAdaptiveStop(e.target.checked)}
                        className="accent-[#00ff88]"
                      />
                      <span className="text-[9px] text-slate-300 uppercase">Adaptive Stop</span>
                    </label>
                  </div>

                  {/* Option 3 Drawdown Hard-locks */}
                  <div className="border-t border-white/10 pt-3 mt-3 space-y-2">
                    <span className="text-[10px] text-slate-400 uppercase font-mono block">Option 3: Drawdown Hard-Locks</span>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[9px] text-slate-500 block uppercase font-mono">Drawdown Limit (%)</label>
                        <input
                          type="number"
                          step="0.1"
                          min="0.5"
                          max="10"
                          value={editDailyDrawdownLimitPercent}
                          onChange={(e) => setEditDailyDrawdownLimitPercent(Number(e.target.value))}
                          className="w-full mt-0.5 bg-black/35 border border-white/10 rounded p-1 text-slate-100 text-xs focus:outline-none focus:border-[#00ff88]/50"
                        />
                      </div>
                      <div>
                        <label className="text-[9px] text-slate-500 block uppercase font-mono">Drawdown Limit (Cash €)</label>
                        <input
                          type="number"
                          step="100"
                          min="100"
                          max="50000"
                          value={editDailyDrawdownLimitCash}
                          onChange={(e) => setEditDailyDrawdownLimitCash(Number(e.target.value))}
                          className="w-full mt-0.5 bg-black/35 border border-white/10 rounded p-1 text-slate-100 text-xs focus:outline-none focus:border-[#00ff88]/50"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <button
                  type="submit"
                  className="w-full mt-2 py-2.5 bg-white/5 hover:bg-white/10 text-xs font-semibold uppercase rounded text-slate-200 hover:text-white transition border border-white/10 cursor-pointer"
                >
                  Commit System Settings
                </button>
              </form>
            </div>
          </div>
        </div>

        {/* 3.5. GEOPOLITICAL AI BASKET CALIBRATOR */}
        <div className="frosted-glass frosted-glass-hover p-6">
          <div className="flex flex-col lg:flex-row justify-between items-start gap-4 border-b border-white/10 pb-4 mb-4">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-[#00ff88]/15 border border-[#00ff88]/30">
                <Sparkles className="w-5 h-5 text-[#00ff88]" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2 flex-wrap">
                  Geopolitical & Macro Sector AI Calibrator
                  <span className="text-[9px] px-1.5 py-0.5 rounded font-mono bg-[#00ff88]/10 text-[#00ff88] border border-[#00ff88]/25 uppercase font-bold animate-pulse">
                    Enterprise Engine Ready
                  </span>
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Dynamically screen and calibrate high-frequency Order Flow Imbalance (OFI) strategic baskets matching real-time news events, macroeconomic friction patterns, and global conflicts instead of brittle hardcoded sectors.
                </p>
              </div>
            </div>

            {/* Model Standard selector - Developer sandboxing vs Vertex Enterprise */}
            <div className="bg-black/45 border border-white/10 p-1.5 rounded-lg flex items-center gap-1.5 shrink-0 self-stretch lg:self-auto justify-between">
              <button
                type="button"
                onClick={() => setSelectedCalibrationModel("ai-studio")}
                className={`py-1 px-2.5 rounded text-[9.5px] font-mono uppercase font-extrabold flex items-center gap-1 transition cursor-pointer select-none ${
                  selectedCalibrationModel === "ai-studio"
                    ? "bg-indigo-500/25 text-indigo-300 border border-indigo-500/30"
                    : "text-slate-500 hover:text-slate-300"
                }`}
                title="Developer Prototype Mode: Authenticates using your static Gemini Developer Key. Ideal for quick sandbox testing with zero GCP IAM overhead!"
              >
                <span>🔑 AI Studio Sandbox</span>
              </button>
              <button
                type="button"
                onClick={() => setSelectedCalibrationModel("vertex")}
                className={`py-1 px-2.5 rounded text-[9.5px] font-mono uppercase font-extrabold flex items-center gap-1 transition cursor-pointer select-none ${
                  selectedCalibrationModel === "vertex"
                    ? "bg-[#00ff88]/10 text-[#00ff88] border border-[#00ff88]/20"
                    : "text-slate-500 hover:text-slate-300"
                }`}
                title="Google Cloud Run Vertex AI Standard Mode: Keyless secure auth utilizing Cloud Run Service Account credentials. Extended limits, high-throughput pipelines, and compliance guarantees."
              >
                <span>🏢 Vertex AI Prod</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* Left controller: Prompt injection & Settings */}
            <div className="lg:col-span-7 space-y-4">
              <div className="p-3.5 rounded-lg bg-orange-500/5 border border-orange-500/10 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 text-[11px]">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5">
                    <span className="font-extrabold text-orange-400 uppercase tracking-wider font-mono">⚠️ MODEL LIFECYCLE SECURITY ADVISORY</span>
                    <span className="px-1.5 py-0.2 text-[8px] font-mono rounded bg-orange-500/20 text-orange-300 font-bold">INFO</span>
                  </div>
                  <p className="text-slate-400 leading-relaxed text-[10.5px]">
                    Gemini 1.5 Flash has entered the retirement phase and Gemini 2.0 Flash has been completely sunset. This system is automatically locked to the production-stable, high-quota <strong>Gemini 3.5 & 2.5 architecture</strong> to guarantee long-run performance.
                  </p>
                </div>
              </div>

              <div>
                <label className="text-[10px] text-slate-400 uppercase font-mono block mb-1.5 flex justify-between items-center">
                  <span>Describe Geopolitical or Macroeconomic Theme</span>
                  <span className="text-[9px] text-slate-500 font-normal">Supports markdown keywords</span>
                </label>
                <textarea
                  value={aiCalibrationPrompt}
                  onChange={(e) => setAiCalibrationPrompt(e.target.value)}
                  placeholder="E.g., Severe Suez Canal disruptions bottleneck shipping and spike global brent crude. Concurrently, US hikes tariffs on imports from major trade regions."
                  className="w-full bg-black/45 border border-white/10 rounded-lg p-3 text-slate-200 text-xs focus:outline-none focus:border-[#00ff88]/50 h-24 resize-none font-mono placeholder-slate-700"
                />
              </div>

              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-2 text-[10px] text-slate-500 font-mono">
                  <span>ACTIVE TARGETS:</span>
                  <span className="bg-white/5 py-0.5 px-1.5 rounded text-slate-400 border border-white/5 uppercase font-bold text-[9px] leading-tight">3.5-FLASH</span>
                  <span className="bg-white/5 py-0.5 px-1.5 rounded text-slate-400 border border-white/5 uppercase font-bold text-[9px] leading-tight">1.8 ATR LIMITS</span>
                </div>
                
                <button
                  type="button"
                  disabled={isCalibratingGeopolitical || !aiCalibrationPrompt.trim()}
                  onClick={async () => {
                    setIsCalibratingGeopolitical(true);
                    try {
                      const res = await fetch("/api/calibrate-geopolitical", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ eventDescription: aiCalibrationPrompt })
                      });
                      if (res.ok) {
                        const data = await res.json();
                        setOrderFeedback({ success: data.message || "Geopolitical sectors calibrated: Loaded 3 new AI baskets and expanded ticker streams." });
                        
                        // Push a dynamic event log to the visual data timeline
                        const newEvent = {
                          time: "Just Now",
                          source: "Manual Geopolitical Feed",
                          headline: aiCalibrationPrompt,
                          sentiment: Math.random() > 0.5 ? 0.64 : -0.58,
                          impact: Math.random() > 0.5 ? "BULLISH" : "BEARISH",
                          targetSector: "Dynamic Multi-Asset OFI calibration",
                          circuitOverrideActive: false
                        };
                        setMacroEventLogs(prev => [newEvent, ...prev]);

                        // Trigger state refresh
                        await fetchState();
                        // Force expectancy re-simulation with the new assets
                        await fetch("/api/run-expectancy").then(r => r.json()).then(d => setSimulationData(d.baskets || []));
                      } else {
                        const data = await res.json();
                        setOrderFeedback({ error: data.error || "Failed to analyze geopolitical event." });
                      }
                    } catch (err: any) {
                      setOrderFeedback({ error: "API connection anomaly: " + err.message });
                    } finally {
                      setIsCalibratingGeopolitical(false);
                    }
                  }}
                  className="px-4 py-2 bg-[#00ff88]/20 hover:bg-[#00ff88]/35 border border-[#00ff88]/40 text-[#00ff88] rounded-lg text-xs font-mono font-bold flex items-center gap-1.5 transition cursor-pointer disabled:opacity-45 select-none"
                  title="Fires a structured macro request to the co-located Gemini model to screen liquid stock/ETF pairs, scoring them past transaction attrition costs!"
                >
                  {isCalibratingGeopolitical ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Analyzing Macro Drivers...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3.5 h-3.5" /> Execute Live AI Calibration
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Right Column: Ingested Economic Incidents & News calibration feed */}
            <div className="lg:col-span-5 space-y-3 bg-black/25 p-4 rounded-xl border border-white/5 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between border-b border-white/5 pb-2 mb-2 flex-wrap gap-2">
                  <span className="text-[10px] text-indigo-400 font-extrabold uppercase tracking-widest font-mono flex items-center gap-1" title="Real-time background ingester timeline showing policy events and market-impact reports">
                    <Activity className="w-3 h-3 text-[#00ff88]" /> News Ingestion Feed Logs
                  </span>
                  
                  {/* Selector to change simulated news sources */}
                  <select
                    value={selectedNewsSource}
                    onChange={(e: any) => setSelectedNewsSource(e.target.value)}
                    className="bg-black border border-white/10 rounded px-1.5 py-0.5 text-[8.5px] text-slate-300 font-mono focus:outline-none cursor-pointer"
                  >
                    <option value="all">ALL FEEDS</option>
                    <option value="bloomberg">BLOOMBERG RSS</option>
                    <option value="reuters">REUTERS WIRE</option>
                    <option value="ibkr">IBKR NEWS API</option>
                    <option value="fx">DAILYFX CALENDAR</option>
                  </select>
                </div>

                <p className="text-[10px] text-slate-400 leading-normal mb-3">
                  Parsed global headlines used to calibrate order flow coefficients. Select a source to filter signals.
                </p>

                <div className="mb-3">
                  <button
                    type="button"
                    disabled={isAutomatingNews}
                    onClick={async () => {
                      setIsAutomatingNews(true);
                      try {
                        const res = await fetch("/api/auto-calibrate-news", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ source: selectedNewsSource })
                        });
                        if (res.ok) {
                          const data = await res.json();
                          setOrderFeedback({ success: data.message || "Auto-Ingest Complete: New macro conditions calibrated." });
                          
                          // Prepend the new scraped event
                          if (data.news) {
                            const dateObj = new Date();
                            const timeStr = dateObj.toTimeString().split(" ")[0];
                            const newEvent = {
                              time: timeStr,
                              source: data.news.source,
                              headline: data.news.headline,
                              sentiment: data.news.sentiment,
                              impact: data.news.impact,
                              targetSector: data.news.targetSector,
                              circuitOverrideActive: Math.abs(data.news.sentiment) > 0.7
                            };
                            setMacroEventLogs(prev => [newEvent, ...prev]);
                          }
                          
                          // Refresh state & expectancy
                          await fetchState();
                          await fetch("/api/run-expectancy").then(r => r.json()).then(d => setSimulationData(d.baskets || []));
                        } else {
                          const errorData = await res.json();
                          setOrderFeedback({ error: errorData.error || "Failed to automate news calibration." });
                        }
                      } catch (err: any) {
                        setOrderFeedback({ error: "Connection error during auto-ingestion: " + err.message });
                      } finally {
                        setIsAutomatingNews(false);
                      }
                    }}
                    className="w-full py-1.5 px-3 bg-indigo-600/25 hover:bg-indigo-600/40 border border-indigo-500/40 text-indigo-300 hover:text-[#00ff88] rounded-lg text-[10.5px] font-mono font-bold flex items-center justify-center gap-1.5 transition cursor-pointer disabled:opacity-40 select-none"
                    title="Leverages Gemini 3.5-Flash to actively scan, generate and digest high-impact geopolitical events matching the selected source above."
                  >
                    {isAutomatingNews ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Ingesting & Scouring Feed...
                      </>
                    ) : (
                      <>
                        <Zap className="w-3.5 h-3.5 text-[#00ff88]" /> SCAN & AUTO-CALIBRATE LIVE NEWSRUN
                      </>
                    )}
                  </button>
                </div>

                <div className="space-y-2.5 max-h-[160px] overflow-y-auto pr-1">
                  {macroEventLogs
                    .filter(log => {
                      if (selectedNewsSource === "all") return true;
                      if (selectedNewsSource === "bloomberg" && log.source.includes("Bloomberg")) return true;
                      if (selectedNewsSource === "reuters" && log.source.includes("Reuters")) return true;
                      if (selectedNewsSource === "ibkr" && log.source.includes("IBKR")) return true;
                      if (selectedNewsSource === "fx" && log.source.includes("FX")) return true;
                      return false;
                    })
                    .map((log, i) => (
                      <div key={i} className="p-2 rounded border border-white/5 bg-white/5 hover:border-indigo-500/20 hover:bg-indigo-500/5 transition space-y-1">
                        <div className="flex items-center justify-between text-[8px] font-mono font-bold leading-none">
                          <span className="text-slate-500">{log.time}</span>
                          <span className="text-indigo-400 uppercase bg-indigo-500/10 px-1 rounded leading-none">{log.source}</span>
                          <span className={`px-1 rounded font-bold leading-none ${
                            log.sentiment > 0 ? "bg-[#00ff88]/15 text-[#00ff88]" : "bg-red-500/15 text-red-400"
                          }`}>
                            Score: {log.sentiment > 0 ? "+" : ""}{log.sentiment.toFixed(2)}
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-200 font-semibold leading-tight font-sans">
                          {log.headline}
                        </p>
                        <div className="flex items-center justify-between pt-0.5 text-[8px] font-mono">
                          <span className="text-slate-400 uppercase font-sans">Impact: <strong className={log.impact === "BULLISH" ? "text-[#00ff88]" : log.impact === "BEARISH" ? "text-red-400" : "text-amber-400"}>{log.impact}</strong></span>
                          <span>Baskets: <span className="text-slate-100 font-sans tracking-wide">{log.targetSector}</span></span>
                        </div>
                        {log.circuitOverrideActive && (
                          <div className="mt-1 bg-red-500/15 border border-red-500/25 p-1 rounded text-[8px] text-red-300 font-extrabold flex items-center gap-1 flex-wrap uppercase font-mono">
                            <AlertOctagon className="w-2.5 h-2.5 text-red-400" />
                            Macro Blanket Activated - Suspended Edge Routing (Spread Protection)
                          </div>
                        )}
                      </div>
                    ))
                  }
                </div>
              </div>

              {/* Interaction helper described in request */}
              <div className="pt-2 border-t border-white/5 text-[9.5px] text-slate-400 leading-normal flex items-start gap-1 font-sans">
                <span className="text-[#00ff88] font-bold">💡 CALIBRATION RULES:</span>
                <span>
                  The calibrator scores each sector past 15% transaction friction structures using ATR-based targets. Liquid sectors automatically pass trading rules. High-volatility news events enforce instant 15-minute blockade blanking states.
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* 4. SECTOR SPECIFIC PROACTIVE SIMULATION TABLE */}
        <div className="frosted-glass frosted-glass-hover p-6">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-white/10 pb-4 mb-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-widest flex items-center gap-1.5 flex-wrap">
                <Play className="w-4 h-4 text-[#00ff88] animate-pulse" /> PRE-FLIGHT EXPECTANCY CALIBRATOR (15% FRICTION BARRIERS)
              </h2>
              <p className="text-[11px] text-slate-400 font-mono mt-0.5">Statistical projections across structural baskets of stocks</p>
            </div>
            <button
              onClick={runPreFlightExpectancy}
              disabled={isSimulatingExpectancy}
              className="px-4 py-2 bg-white/5 hover:bg-white/10 text-xs font-mono rounded flex items-center gap-2 border border-white/10 disabled:opacity-50 cursor-pointer transition select-none"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSimulatingExpectancy ? "animate-spin" : ""}`} /> 
              {isSimulatingExpectancy ? "Re-simulating..." : "Run Sector Expectancy"}
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono text-xs">
              <thead>
                <tr className="border-b border-white/10 text-slate-500 uppercase text-[10px]">
                  <th className="pb-3 pt-1 font-semibold">Asset Sector Strategy</th>
                  <th className="pb-3 pt-1 font-semibold">Tested Tickers</th>
                  <th className="pb-3 pt-1 font-semibold">Level 2 OFI Trend</th>
                  <th className="pb-3 pt-1 font-semibold text-right">Projected Win Rate</th>
                  <th className="pb-3 pt-1 font-semibold text-right">Tested Profit Factor</th>
                  <th className="pb-3 pt-1 font-semibold text-right">Spread/Friction attrition</th>
                  <th className="pb-3 pt-1 font-semibold text-right">15% Friction Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-slate-300">
                {simulationData.map((item, idx) => (
                  <tr key={idx} className="hover:bg-white/5 transition">
                    <td className="py-3 font-semibold text-slate-100">{item.sector}</td>
                    <td className="py-3 text-slate-400">{item.tickers.join(", ")}</td>
                    <td className="py-3">{item.impliedOfiTrend}</td>
                    <td className="py-3 text-right text-[#00ff88] font-semibold">{item.winRate}%</td>
                    <td className="py-3 text-right">{item.profitFactor.toFixed(2)}x</td>
                    <td className="py-3 text-right">{item.avgFrictionConsumed}%</td>
                    <td className="py-3 text-right">
                      <span className={`px-2 py-0.5 text-[10px] rounded ${
                        item.avgFrictionConsumed <= 10 
                          ? "bg-[#00ff88]/10 text-[#00ff88] border border-[#00ff88]/30" 
                          : "bg-[#ffaa00]/10 text-[#ffaa00] border border-[#ffaa00]/25"
                      }`}>
                        {item.avgFrictionConsumed <= 15 ? "PASSED FILTER" : "CONSTRAINED LOCK"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* 5. ACTIVE POSITIONS TABLE & HISTORICAL LOGS */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          
          {/* Active Positions holding list */}
          <div className="frosted-glass frosted-glass-hover p-6">
            <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-widest flex items-center gap-1.5 border-b border-white/10 pb-3 mb-4">
              <Lock className="w-4 h-4 text-[#00ff88]" /> ACTIVE HOLDINGS (SINGLE INTRADAY SESSION)
            </h2>

            {activeTrades.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left font-mono text-xs">
                  <thead>
                    <tr className="border-b border-white/10 text-slate-500 uppercase text-[10px]">
                      <th className="pb-2">Token</th>
                      <th className="pb-2">Shares</th>
                      <th className="pb-2">Side</th>
                      <th className="pb-2 text-right">Entry</th>
                      <th className="pb-2 text-right">Current Price</th>
                      <th className="pb-2 text-right">Unrealized P&L</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-slate-300">
                    {activeTrades.map((trade) => (
                      <tr key={trade.id} className="hover:bg-white/5">
                        <td className="py-2.5 font-bold text-slate-100 flex items-center gap-1.5 flex-wrap">
                          <span>{trade.symbol}</span>
                          {marketBooks[trade.symbol]?.primaryExchange && (
                            <span className={`px-1 rounded-[3px] text-[8px] font-bold ${
                              marketBooks[trade.symbol].primaryExchange === "SBF" || marketBooks[trade.symbol].primaryExchange === "AEB" || marketBooks[trade.symbol].primaryExchange === "SB"
                                ? "bg-[#00ff88]/15 text-[#00ff88]" 
                                : marketBooks[trade.symbol].primaryExchange === "IBIS"
                                ? "bg-amber-500/10 text-amber-400"
                                : "bg-blue-500/10 text-blue-400"
                            }`}>
                              {marketBooks[trade.symbol].primaryExchange}
                            </span>
                          )}
                          <span className="text-[9px] bg-white/5 text-slate-400 px-1 py-0.2 rounded font-normal scale-90">{trade.id}</span>
                        </td>
                        <td className="py-2.5">{trade.quantity}</td>
                        <td className="py-2.5">
                          <span className={`px-1.5 py-0.5 rounded-sm text-[10px] font-bold ${
                            trade.direction === "BUY" ? "bg-[#00ff88]/10 text-[#00ff88] border border-[#00ff88]/20" : "bg-[#ff4444]/10 text-[#ff4444] border border-[#ff4444]/20"
                          }`}>
                            {trade.direction === "BUY" ? "LONG" : "SHORT"}
                          </span>
                        </td>
                        <td className="py-2.5 text-right font-mono">€{trade.entryPrice.toFixed(2)}</td>
                        <td className="py-2.5 text-right font-mono text-[#00ff88]">€{trade.currentPrice.toFixed(2)}</td>
                        <td className={`py-2.5 text-right font-mono font-bold ${trade.unrealizedPnL >= 0 ? "text-[#00ff88]" : "text-[#ff4444]"}`}>
                          {trade.unrealizedPnL >= 0 ? "+" : ""}€{trade.unrealizedPnL.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-12 text-slate-400 text-xs font-mono h-32 flex flex-col justify-center items-center">
                <Unlock className="w-8 h-8 text-slate-600 mb-2" />
                No active session holdings. All routes flat.
              </div>
            )}
          </div>

          {/* Historical Logs with commission details */}
          <div className="frosted-glass frosted-glass-hover p-6">
            <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-widest flex items-center gap-1.5 border-b border-white/10 pb-3 mb-4">
              <CheckCircle2 className="w-4 h-4 text-[#00ff88]" /> COMPLETED RECONCILIATIONS & audited FRICTION
            </h2>

            {historicalLogs.length > 0 ? (
              <div className="overflow-x-auto max-h-[17rem]">
                <table className="w-full text-left font-mono text-xs">
                  <thead>
                    <tr className="border-b border-white/10 text-slate-500 uppercase text-[10px]">
                      <th className="pb-2">Token</th>
                      <th className="pb-2">Side</th>
                      <th className="pb-2 text-right">P&L</th>
                      <th className="pb-2 text-right">Fee</th>
                      <th className="pb-2 text-right">Friction Attrition</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-slate-300">
                    {historicalLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-white/5">
                        <td className="py-2.5 font-semibold text-slate-200 flex items-center gap-1.5 flex-wrap">
                          <span>{log.symbol}</span>
                          {marketBooks[log.symbol]?.primaryExchange && (
                            <span className={`px-1 rounded-[3px] text-[8px] font-bold ${
                              marketBooks[log.symbol].primaryExchange === "SBF" || marketBooks[log.symbol].primaryExchange === "AEB" || marketBooks[log.symbol].primaryExchange === "SB"
                                ? "bg-[#00ff88]/15 text-[#00ff88]" 
                                : marketBooks[log.symbol].primaryExchange === "IBIS"
                                ? "bg-amber-500/10 text-amber-400"
                                : "bg-blue-500/10 text-blue-400"
                            }`}>
                              {marketBooks[log.symbol].primaryExchange}
                            </span>
                          )}
                          <span className="text-[9px] text-slate-500">({log.quantity} shares)</span>
                        </td>
                        <td className="py-2.5">
                          <span className={`text-[10px] font-semibold ${
                            log.direction === "BUY" ? "text-[#00ff88]" : "text-[#ff4444]"
                          }`}>
                            {log.direction === "BUY" ? "LONG" : "SHORT"}
                          </span>
                        </td>
                        <td className={`py-2.5 text-right font-bold ${log.realizedPnL >= 0 ? "text-[#00ff88]" : "text-[#ff4444]"}`}>
                          {log.realizedPnL >= 0 ? "+" : ""}€{log.realizedPnL.toFixed(2)}
                        </td>
                        <td className="py-2.5 text-right text-slate-400">€{log.commission.toFixed(2)}</td>
                        <td className="py-2.5 text-right text-slate-100">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                            log.efficiencyRatio > 15 
                              ? "bg-[#ff4444]/15 text-[#ff4444] border border-[#ff4444]/25" 
                              : "bg-[#00ff88]/15 text-[#00ff88] border border-[#00ff88]/25"
                          }`}>
                            {log.efficiencyRatio}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-12 text-slate-400 text-xs font-mono h-32 flex flex-col justify-center items-center">
                System starting fresh. No archived records yet.
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
