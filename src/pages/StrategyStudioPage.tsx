import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  Sparkles,
  Bot,
  Send,
  Play,
  RotateCcw,
  Bookmark,
  FolderOpen,
  Trash2,
  TrendingUp,
  Activity,
  Award,
  ArrowUpRight,
  ShieldCheck,
  ChevronRight,
  Sliders,
  RefreshCw,
  SlidersHorizontal,
  CheckCircle2,
  Clock,
  ExternalLink,
  ChevronDown,
  Layers,
  Zap,
  Info,
  Shield,
  Search,
  X,
  Square,
  Filter,
  Check,
  AlertTriangle,
  AlertCircle,
  BarChart2,
  Rocket
} from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid
} from "recharts";
import { ApiVaultModal } from "../components/ApiVaultModal";
import { InstitutionalModelSelector } from "../components/InstitutionalModelSelector";
import { InstitutionalCandleChart } from "../components/InstitutionalCandleChart";
import { InfoTip, InstitutionalTooltip } from "../components/InstitutionalTooltip";
import {
  getAllStoredVaultSettings,
  persistVaultItem,
  persistVaultBatch,
  syncVaultToServer,
  getStoredVaultValue,
  isMaskedString
} from "../utils/vaultStorage";
import { getAdminHeaders } from "../utils/auth";

export interface StrategyStudioExperiment {
  id: string;
  timestamp: string;
  name: string;
  symbol: string;
  timeframe: string;
  parameters: {
    capitalOverride?: number;
    stopAtrMultiplier: number;
    partialProfit: boolean;
    breakevenLock: boolean;
    maxHoldBars: number;
    ofiFilter: boolean;
    adaptiveStop: boolean;
    riskBudgetPct: number;
    frictionCeilingPct: number;
    binaryBlackoutHours?: number;
  };
  metrics: {
    totalPnL: number;
    totalPnLPercent: number;
    winRate: number;
    profitFactor: number;
    annualizedSharpe: number;
    deflatedSharpeRatio: number;
    passesDsrHurdle: boolean;
    maxDrawdownPercent: number;
    totalTrades: number;
    totalCommissions: number;
  };
  balanceHistory: Array<{ date: string; equity: number }>;
  tradesList: any[];
}

interface StudioChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  activeTools?: string[];
  actionTriggered?: string;
  telemetry?: any;
  isTruncated?: boolean;
}

interface ModelItem {
  id: string;
  rawId?: string;
  name: string;
  provider: string;
  tier: string;
  badge: string;
  costStr: string;
  icon: string;
  isFree?: boolean;
}

const TIER0_OFFLINE_MODEL: ModelItem = {
  id: "local/finbert-int8",
  name: "INT8 ONNX FinBERT (CPU Offline)",
  provider: "Local Tier 0",
  tier: "Tier 0 Offline",
  badge: "$0 Cost / <15ms",
  costStr: "$0.00 (Offline)",
  icon: "🛡️",
  isFree: true
};

export interface StrategyStudioPageProps {
  onNavigate?: (view: "mission-control" | "blotter" | "risk" | "lab" | "config" | "copilot" | "studio", target?: string) => void;
}

export function StrategyStudioPage({ onNavigate }: StrategyStudioPageProps = {}) {
  // =========================================================================
  // 1. LLM Model Selection & 4-Pillar Vault Integration (Rule 6)
  // =========================================================================
  const [availableModels, setAvailableModels] = useState<ModelItem[]>([TIER0_OFFLINE_MODEL]);
  const [selectedModel, setSelectedModel] = useState<string>(() => {
    return localStorage.getItem("alpha_copilot_model") || "local/finbert-int8";
  });
  const [isVaultOpen, setIsVaultOpen] = useState(false);
  const [vaultSettings, setVaultSettings] = useState<any>(() => getAllStoredVaultSettings());
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [modelSearchQuery, setModelSearchQuery] = useState("");
  const [selectedProviderFilter, setSelectedProviderFilter] = useState<string>("ALL");

  // Sync selected model to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem("alpha_copilot_model", selectedModel);
  }, [selectedModel]);

  const activeModelObj = useMemo(() => {
    return availableModels.find((m) => m.id === selectedModel) || availableModels[0] || TIER0_OFFLINE_MODEL;
  }, [availableModels, selectedModel]);

  const isModelConfigured = (m: ModelItem): boolean => {
    if (m.id.startsWith("local") || m.provider?.toLowerCase().includes("local")) return true;
    const stored = getAllStoredVaultSettings();
    if (m.id.startsWith("google") || m.provider?.toLowerCase().includes("google")) {
      const k = vaultSettings.geminiApiKey || stored.geminiApiKey || getStoredVaultValue("geminiApiKey");
      return Boolean(k && k.trim() && !isMaskedString(k) && k.length > 15);
    }
    if (m.id.startsWith("groq") || m.provider?.toLowerCase().includes("groq")) {
      const k = vaultSettings.customAiApiKey || stored.customAiApiKey || getStoredVaultValue("customAiApiKey") || vaultSettings.groqApiKey || stored.groqApiKey || getStoredVaultValue("groqApiKey");
      return Boolean(k && k.trim() && !isMaskedString(k) && k.length > 5);
    }
    if (m.id.startsWith("nvidia") || m.provider?.toLowerCase().includes("nvidia")) {
      const k = vaultSettings.nvidiaApiKey || stored.nvidiaApiKey || getStoredVaultValue("nvidiaApiKey");
      return Boolean(k && k.trim() && !isMaskedString(k) && k.length > 15);
    }
    if (m.id.startsWith("openai") || m.provider?.toLowerCase().includes("openai")) {
      const k = vaultSettings.openaiApiKey || stored.openaiApiKey || getStoredVaultValue("openaiApiKey");
      return Boolean(k && k.trim() && !isMaskedString(k) && k.length > 15);
    }
    if (m.id.startsWith("openrouter") || m.provider?.toLowerCase().includes("openrouter")) {
      const k = vaultSettings.openrouterApiKey || stored.openrouterApiKey || getStoredVaultValue("openrouterApiKey");
      return Boolean(k && k.trim() && !isMaskedString(k) && k.length > 10);
    }
    return false;
  };

  const filteredModels = useMemo(() => {
    return availableModels.filter((m) => {
      if (selectedProviderFilter !== "ALL") {
        if (selectedProviderFilter === "FREE") {
          const isFree = m.isFree === true || m.id.includes(":free") || m.costStr.includes("$0.00") || m.id.startsWith("local");
          if (!isFree) return false;
        } else if (selectedProviderFilter === "LOCAL" && !m.id.startsWith("local")) {
          return false;
        } else if (selectedProviderFilter === "OPENROUTER" && !m.id.startsWith("openrouter")) {
          return false;
        } else if (selectedProviderFilter === "NVIDIA" && !m.id.startsWith("nvidia")) {
          return false;
        } else if (selectedProviderFilter === "GOOGLE" && !m.id.startsWith("google")) {
          return false;
        } else if (selectedProviderFilter === "GROQ" && !m.id.startsWith("groq")) {
          return false;
        } else if (selectedProviderFilter === "OPENAI" && !m.id.startsWith("openai")) {
          return false;
        }
      }
      if (modelSearchQuery.trim()) {
        const q = modelSearchQuery.toLowerCase();
        return (
          m.name.toLowerCase().includes(q) ||
          m.id.toLowerCase().includes(q) ||
          m.provider.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [availableModels, selectedProviderFilter, modelSearchQuery]);

  const fetchStatsAndModels = async (force = false) => {
    try {
      const url = force ? "/api/copilot/stats?refresh=1" : "/api/copilot/stats";
      const gKey = vaultSettings.geminiApiKey || getStoredVaultValue("geminiApiKey");
      const qKey = vaultSettings.customAiApiKey || getStoredVaultValue("customAiApiKey");
      const nvKey = vaultSettings.nvidiaApiKey || getStoredVaultValue("nvidiaApiKey");
      const oaKey = vaultSettings.openaiApiKey || getStoredVaultValue("openaiApiKey");
      const orKey = vaultSettings.openrouterApiKey || getStoredVaultValue("openrouterApiKey");

      const res = await fetch(url, {
        headers: {
          "x-gemini-api-key": gKey || "",
          "x-groq-api-key": qKey || "",
          "x-nvidia-api-key": nvKey || "",
          "x-openai-api-key": oaKey || "",
          "x-openrouter-api-key": orKey || ""
        }
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.models_catalog) && data.models_catalog.length > 0) {
          const cleanCatalog = data.models_catalog;
          setAvailableModels(cleanCatalog);
          if (cleanCatalog.length > 1) {
            setSelectedModel((prev) => {
              if (prev === "local/finbert-int8" || !cleanCatalog.some((m: any) => m.id === prev)) {
                const online = cleanCatalog.find((m: any) => m.id !== "local/finbert-int8");
                return online ? online.id : prev;
              }
              return prev;
            });
          }
        }
      }
    } catch (e) {
      console.warn("Could not fetch models for Strategy Studio:", e);
    }
  };

  const handleSaveSetting = async (key: string, value: any) => {
    persistVaultItem(key, value);
    setVaultSettings((prev: any) => ({ ...prev, [key]: value }));
    try {
      await fetch("/api/set-settings", {
        method: "POST",
        headers: getAdminHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ [key]: value })
      });
      await fetchStatsAndModels(true);
    } catch (e) {
      console.warn("Could not persist setting:", e);
    }
  };

  const handleSaveMultipleSettings = async (updates: Record<string, any>) => {
    persistVaultBatch(updates);
    setVaultSettings((prev: any) => ({ ...prev, ...updates }));
    try {
      await syncVaultToServer(updates);
      await fetchStatsAndModels(true);
    } catch (e) {
      console.warn("Could not persist settings batch:", e);
    }
  };

  useEffect(() => {
    // 1. Fetch centralized server credentials
    fetch("/api/vault/credentials", {
      headers: getAdminHeaders()
    })
      .then((r) => r.json())
      .then((creds) => {
        if (creds && typeof creds === "object") {
          setVaultSettings((prev: any) => ({ ...prev, ...creds }));
          fetchStatsAndModels(true);
        }
      })
      .catch(() => {});

    fetchStatsAndModels(true);
    const interval = setInterval(() => fetchStatsAndModels(false), 15000);

    const handleInvalidated = () => {
      fetchStatsAndModels(true);
    };
    const handleVaultUpdated = (e: any) => {
      if (e?.detail) {
        setVaultSettings((prev: any) => ({ ...prev, ...e.detail }));
        fetchStatsAndModels(true);
      }
    };

    window.addEventListener("copilot:models_invalidated", handleInvalidated);
    window.addEventListener("alpha_vault_settings_updated", handleVaultUpdated);
    return () => {
      clearInterval(interval);
      window.removeEventListener("copilot:models_invalidated", handleInvalidated);
      window.removeEventListener("alpha_vault_settings_updated", handleVaultUpdated);
    };
  }, []);

  // =========================================================================
  // 2. Strategy Parameters & Dynamic Instrument State
  // =========================================================================
  const [symbol, setSymbol] = useState<string>(() => {
    try {
      return localStorage.getItem("alpha_last_symbol") || "";
    } catch (_) {
      return "";
    }
  });
  const [customTickerInput, setCustomTickerInput] = useState<string>(() => {
    try {
      return localStorage.getItem("alpha_last_symbol") || "";
    } catch (_) {
      return "";
    }
  });
  const [dynamicUniverse, setDynamicUniverse] = useState<Array<{ symbol: string; sector?: string }>>([]);
  const [resolvedInfo, setResolvedInfo] = useState<any>(null);
  const [resolvingSymbol, setResolvingSymbol] = useState(false);

  // Helper to atomically update symbol and persist across user sessions
  const updateActiveSymbol = (sym: string) => {
    const clean = sym.trim().toUpperCase();
    setSymbol(clean);
    setCustomTickerInput(clean);
    try {
      if (clean) {
        localStorage.setItem("alpha_last_symbol", clean);
      } else {
        localStorage.removeItem("alpha_last_symbol");
      }
    } catch (_) {}
    if (clean) {
      resolveContractForSymbol(clean);
    } else {
      setResolvedInfo(null);
    }
  };

  const [timeframe, setTimeframe] = useState("1h");
  const [startDate, setStartDate] = useState("2026-05-01");
  const [endDate, setEndDate] = useState("2026-06-16");
  const [capitalOverride, setCapitalOverride] = useState<number>(100000);
  const [stopAtr, setStopAtr] = useState(1.8);
  const [partialProfit, setPartialProfit] = useState(true);
  const [breakevenLock, setBreakevenLock] = useState(true);
  const [maxHoldBars, setMaxHoldBars] = useState(15);
  const [ofiFilter, setOfiFilter] = useState(true);
  const [adaptiveStop, setAdaptiveStop] = useState(true);
  const [riskBudgetPct, setRiskBudgetPct] = useState(0.01);
  const [frictionCeiling, setFrictionCeiling] = useState(15.0);
  const [dsrHurdlePct, setDsrHurdlePct] = useState(95.0);

  // Live Execution Pool Deployment State
  const [isDeployModalOpen, setIsDeployModalOpen] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [deploySector, setDeploySector] = useState("Calibrated Quant Strategy Basket");
  const [deployFrictionCeiling, setDeployFrictionCeiling] = useState(15.0);
  const [deployedSymbols, setDeployedSymbols] = useState<Set<string>>(new Set());
  const [deployToast, setDeployToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  // Sync active deployed universe from backend
  useEffect(() => {
    fetch("/api/universe/active")
      .then((r) => r.json())
      .then((d) => {
        if (d?.deployedSymbols && Array.isArray(d.deployedSymbols)) {
          setDeployedSymbols(new Set(d.deployedSymbols.map((s: string) => s.toUpperCase().trim())));
        }
      })
      .catch(() => {});
  }, []);

  const handleDeployStrategy = async () => {
    if (!symbol) return;
    setIsDeploying(true);
    try {
      const sym = symbol.toUpperCase().trim();
      const currentFriction = result?.slippageFrictionSaved !== undefined
        ? Number(result.slippageFrictionSaved)
        : Number(result?.frictionPct || 10.0);

      const payload = {
        symbol: sym,
        sector: deploySector,
        timeframe,
        parameters: {
          stopAtrMultiplier: stopAtr,
          maxHoldBars,
          riskBudgetPct,
          frictionCeilingPct: deployFrictionCeiling,
          ofiFilter,
          partialProfit,
          breakevenLock,
          adaptiveStop
        },
        metrics: {
          winRate: result?.winRate || 65,
          profitFactor: result?.profitFactor || 1.6,
          frictionPct: currentFriction,
          dsr: result?.deflatedSharpeRatio || 0.95
        }
      };

      const res = await fetch("/api/universe/deploy", {
        method: "POST",
        headers: getAdminHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        setDeployedSymbols((prev) => new Set(prev).add(sym));
        setDeployToast({
          message: `✓ ${sym} successfully armed & deployed to Frankfurt Edge Node (Port 4005)!`,
          type: "success"
        });
        setIsDeployModalOpen(false);
      } else {
        setDeployToast({
          message: `Failed to deploy ${sym}: ${data.error || "Unknown error"}`,
          type: "error"
        });
      }
    } catch (err: any) {
      setDeployToast({
        message: `Deployment error: ${err.message}`,
        type: "error"
      });
    } finally {
      setIsDeploying(false);
      setTimeout(() => setDeployToast(null), 6000);
    }
  };

  // Active Strategy Details & Results
  const [strategyName, setStrategyName] = useState("Alpha Adaptive OFI Breakout");
  const [activeTab, setActiveTab] = useState<"candles" | "performance" | "frontier" | "blotter" | "vault">("candles");
  const [loading, setLoading] = useState(false);
  const [sweeping, setSweeping] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [baselineResult, setBaselineResult] = useState<any>(null);
  const [sweepCandidates, setSweepCandidates] = useState<any[]>([]);
  const [paretoFrontier, setParetoFrontier] = useState<any[]>([]);
  const [discoveryData, setDiscoveryData] = useState<any>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);

  // =========================================================================
  // 3. Conversational Agent SSE State
  // =========================================================================
  const [chatInput, setChatInput] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [activeTools, setActiveTools] = useState<string[]>([]);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [stalledWarning, setStalledWarning] = useState<string | null>(null);
  const timerRef = useRef<any>(null);
  const lastActiveRef = useRef<number>(Date.now());
  const [messages, setMessages] = useState<StudioChatMessage[]>(() => [
    {
      id: "msg_init",
      role: "assistant",
      content:
        "👋 Welcome to the **Institutional Strategy Studio & Experiment Vault**.\n\nI am your quantitative reasoning agent wired directly into:\n- 🔬 **Wald-Wolfowitz Runs & Hurst Exponent Analysis** (`run_quant_discovery`)\n- ⚡ **16-Parameter Optimization Sweeps** audited under López de Prado's Deflated Sharpe Ratio (`run_strategy_sweep`)\n- 🏛️ **Verified Broker History & Direct TCP Sockets** (`run_strategy_backtest`)\n- 🔒 **Deterministic Local Experiment Vault** (`save_strategy_to_vault` / `get_strategy_vault`)\n\nEnter any European or US equity ticker, or ask me: *'Run an optimization sweep'*, *'Analyze Hurst regime and persistence'*, or *'Test with 1.8 ATR stop'*.",
      timestamp: new Date().toLocaleTimeString()
    }
  ]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // =========================================================================
  // 4. Server Experiment Vault Sync (Rule 9)
  // =========================================================================
  const [vault, setVault] = useState<StrategyStudioExperiment[]>(() => {
    try {
      const stored = localStorage.getItem("alpha_engine_strategy_vault");
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const fetchVaultStrategies = async () => {
    try {
      const res = await fetch("/api/vault/strategies");
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.strategies)) {
          setVault(data.strategies);
          localStorage.setItem("alpha_engine_strategy_vault", JSON.stringify(data.strategies));
        }
      }
    } catch (e) {
      console.warn("Could not load server strategy vault:", e);
    }
  };

  useEffect(() => {
    fetchVaultStrategies();
  }, []);

  // Universal Contract Resolver
  const resolveContractForSymbol = async (sym: string) => {
    if (!sym) return;
    setResolvingSymbol(true);
    try {
      const res = await fetch("/api/research/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: sym })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.primary_contract) {
          setResolvedInfo(data.primary_contract);
        }
      }
    } catch (err) {
      console.warn("Contract resolution error:", err);
    } finally {
      setResolvingSymbol(false);
    }
  };

  useEffect(() => {
    if (symbol && symbol.trim()) {
      resolveContractForSymbol(symbol);
    } else {
      setResolvedInfo(null);
    }
  }, [symbol]);

  // Load dynamic universe from active live baskets
  useEffect(() => {
    const loadUniverse = async () => {
      try {
        const res = await fetch("/api/run-expectancy");
        if (res.ok) {
          const data = await res.json();
          if (data.baskets && Array.isArray(data.baskets)) {
            const list: Array<{ symbol: string; sector?: string }> = [];
            const seen = new Set<string>();
            data.baskets.forEach((b: any) => {
              (b.tickers || []).forEach((t: string) => {
                const cleanT = (t || "").trim().toUpperCase();
                if (cleanT && !seen.has(cleanT)) {
                  seen.add(cleanT);
                  list.push({ symbol: cleanT, sector: b.sector || "Candidate Basket" });
                }
              });
            });
            setDynamicUniverse(list);
          }
        }
      } catch (err) {
        console.warn("Failed to fetch dynamic universe:", err);
      }
    };
    loadUniverse();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sweeping, discovering, isGenerating]);

  // =========================================================================
  // 5. Execution Core: Single Simulation
  // =========================================================================
  const executeSimulation = async (overrides?: Partial<{
    symbol: string;
    timeframe: string;
    capitalOverride: number;
    stopAtrMultiplier: number;
    partialProfit: boolean;
    breakevenLock: boolean;
    maxHoldBars: number;
    ofiFilter: boolean;
    adaptiveStop: boolean;
    riskBudgetPct: number;
    frictionCeilingPct: number;
  }>) => {
    const s = overrides?.symbol || symbol;
    const tf = overrides?.timeframe || timeframe;
    const cap = overrides?.capitalOverride !== undefined ? overrides.capitalOverride : capitalOverride;
    const stop = overrides?.stopAtrMultiplier !== undefined ? overrides.stopAtrMultiplier : stopAtr;
    const partial = overrides?.partialProfit !== undefined ? overrides.partialProfit : partialProfit;
    const breakeven = overrides?.breakevenLock !== undefined ? overrides.breakevenLock : breakevenLock;
    const maxHold = overrides?.maxHoldBars !== undefined ? overrides.maxHoldBars : maxHoldBars;
    const ofi = overrides?.ofiFilter !== undefined ? overrides.ofiFilter : ofiFilter;
    const adaptive = overrides?.adaptiveStop !== undefined ? overrides.adaptiveStop : adaptiveStop;
    const risk = overrides?.riskBudgetPct !== undefined ? overrides.riskBudgetPct : riskBudgetPct;
    const friction = overrides?.frictionCeilingPct !== undefined ? overrides.frictionCeilingPct : frictionCeiling;

    const res = await fetch("/api/backtest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        symbol: s,
        timeframe: tf,
        startDate,
        endDate,
        capitalOverride: cap,
        stopAtrMultiplier: stop,
        partialProfit: partial,
        breakevenLock: breakeven,
        maxHoldBars: maxHold,
        ofiFilter: ofi,
        adaptiveStop: adaptive,
        riskBudgetPct: risk,
        frictionCeilingPct: friction,
        binaryBlackoutHours: 0
      })
    });

    const data = await res.json();
    return { ok: res.ok && data.success, data };
  };

  const handleRunSimulation = async (overrides?: any) => {
    setLoading(true);
    setErrorMsg(null);

    const activeCap = overrides?.capitalOverride !== undefined ? overrides.capitalOverride : capitalOverride;
    const activeSym = overrides?.symbol || symbol;
    const activeTf = overrides?.timeframe || timeframe;

    if (!activeSym || !activeSym.trim()) {
      setErrorMsg("Please enter or select an instrument symbol before running simulation.");
      setLoading(false);
      return;
    }

    try {
      if (!baselineResult) {
        const baseRun = await executeSimulation({
          symbol: activeSym,
          timeframe: activeTf,
          capitalOverride: activeCap,
          stopAtrMultiplier: 1.8,
          partialProfit: false,
          breakevenLock: false,
          adaptiveStop: false,
          ofiFilter: false
        });
        if (baseRun.ok) {
          setBaselineResult(baseRun.data);
        }
      }

      const run = await executeSimulation(overrides);
      if (run.ok) {
        setResult(run.data);
        setActiveTab("performance");
        setMessages((prev) => [
          ...prev,
          {
            id: "msg_" + Date.now(),
            role: "assistant",
            content: `✅ **Single simulation completed for ${run.data.symbol || activeSym} (${run.data.timeframe || activeTf})**:\n- **Starting Capital**: \`$${Number(run.data.startingCapital || activeCap).toLocaleString()}\`\n- **Net PnL**: \`+$${Number(run.data.totalPnL || 0).toFixed(2)}\` (${run.data.totalPnLPercent}%)\n- **Ending Equity**: \`$${Number(run.data.finalCapital || activeCap).toLocaleString()}\`\n- **Win Rate**: \`${run.data.winRate}%\` (${run.data.winningTrades}W / ${run.data.losingTrades}L)\n- **Profit Factor**: \`${run.data.profitFactor}\`\n- **Annual Sharpe**: \`${run.data.annualizedSharpe}\`\n- **Deflated Sharpe (DSR)**: \`${(Number(run.data.deflatedSharpeRatio || 0) * 100).toFixed(1)}%\`\n- **Max Drawdown**: \`-${run.data.maxDrawdownPercent}%\``,
            timestamp: new Date().toLocaleTimeString(),
            actionTriggered: "RUN_SIMULATION"
          }
        ]);
      } else {
        setErrorMsg(run.data.error || "Simulation failed.");
      }
    } catch (e: any) {
      setErrorMsg(e.message || "Network error running simulation.");
    } finally {
      setLoading(false);
    }
  };

  // =========================================================================
  // 6. Direct Parameter Sweep (16 Trials via research_controller.py)
  // =========================================================================
  const handleRunSweep = async () => {
    if (!symbol || !symbol.trim()) {
      setErrorMsg("Please enter or select an instrument symbol before running optimization sweep.");
      return;
    }

    setSweeping(true);
    setErrorMsg(null);

    setMessages((prev) => [
      ...prev,
      {
        id: "msg_sweep_start_" + Date.now(),
        role: "assistant",
        content: `⚡ **Initiating Autonomous 16-Parameter Sweep** for **${symbol}** (${timeframe}, $${capitalOverride.toLocaleString()})...\n- Exploring ATR cushions (1.2x - 2.6x), Hold horizons (8 - 28 bars), Tranche scaling, and OFI filters.\n- Applying Marcos López de Prado's Deflated Sharpe Ratio with selection bias penalty (N=16)...`,
        timestamp: new Date().toLocaleTimeString()
      }
    ]);

    try {
      const res = await fetch("/api/research/sweep", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol,
          timeframe,
          capital: capitalOverride,
          trials: 16,
          start_date: startDate,
          end_date: endDate
        })
      });

      if (!res.ok) {
        throw new Error(`Sweep API returned status ${res.status}`);
      }

      const sweepData = await res.json();
      if (sweepData.status === "SUCCESS" && sweepData.best_candidate) {
        setSweepCandidates(sweepData.candidates || []);
        setParetoFrontier(sweepData.pareto_frontier || []);
        setResult(sweepData.best_candidate);
        setActiveTab("frontier");

        const best = sweepData.best_candidate;
        if (best.parameters) {
          setStopAtr(best.parameters.stop_atr);
          setMaxHoldBars(best.parameters.max_hold);
          setPartialProfit(best.parameters.partial_profit);
          setBreakevenLock(best.parameters.breakeven_lock);
          setOfiFilter(best.parameters.ofi_filter);
        }

        setStrategyName(`Optimal Sweep: ${symbol} (${best.label || "Frontier Leader"})`);

        setMessages((prev) => [
          ...prev,
          {
            id: "msg_sweep_done_" + Date.now(),
            role: "assistant",
            content: `🏆 **Optimization Sweep Complete (${sweepData.trials_tested} Permutations Evaluated)**!\n\n**Frontier Leader Identified:** \`${best.label}\`\n- **Parameters**: Stop ATR \`${best.parameters?.stop_atr}x\`, Hold \`${best.parameters?.max_hold} bars\`, Tranche \`${best.parameters?.partial_profit ? "ON" : "OFF"}\`, Breakeven \`${best.parameters?.breakeven_lock ? "ON" : "OFF"}\`\n- **Net PnL**: \`+$${Number(best.totalPnL || 0).toFixed(2)}\` (${best.totalPnLPercent}%)\n- **Annual Sharpe**: \`${best.annualizedSharpe}\`\n- **Deflated Sharpe (DSR, N=16)**: \`${(Number(best.deflatedSharpeRatio || 0) * 100).toFixed(1)}%\` (${best.passesDsrHurdle ? "✓ Passed 95% Hurdle" : "⚠️ Sub-hurdle"})\n- **Win Rate**: \`${best.winRate}%\` (${best.winningTrades}W / ${best.losingTrades}L)\n- **Max Drawdown**: \`-${best.maxDrawdownPercent}%\`\n\nAll 16 candidates are now charted in the **Pareto Frontier** tab. Click any candidate in the matrix to load its equity curve.`,
            timestamp: new Date().toLocaleTimeString(),
            actionTriggered: "SWEEP_COMPLETE"
          }
        ]);
      } else {
        throw new Error(sweepData.error || "Sweep returned no candidates");
      }
    } catch (e: any) {
      setErrorMsg("Sweep failed: " + e.message);
    } finally {
      setSweeping(false);
    }
  };

  // =========================================================================
  // 7. Direct Quant Discovery (Wald-Wolfowitz + Hurst Exponent)
  // =========================================================================
  const handleRunDiscovery = async () => {
    if (!symbol || !symbol.trim()) {
      setErrorMsg("Please enter or select an instrument symbol before running empirical microstructure discovery.");
      return;
    }

    setDiscovering(true);
    setErrorMsg(null);

    setMessages((prev) => [
      ...prev,
      {
        id: "msg_disc_start_" + Date.now(),
        role: "assistant",
        content: `🔬 **Running Empirical Microstructure Discovery** for **${symbol}**...\n- Computing Wald-Wolfowitz runs test for return sequence randomness.\n- Estimating Hurst exponent over rescaled range.\n- Calculating 2-state Markov transition matrix...`,
        timestamp: new Date().toLocaleTimeString()
      }
    ]);

    try {
      const res = await fetch("/api/research/discovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, timeframe, start_date: startDate, end_date: endDate })
      });

      if (!res.ok) throw new Error(`Discovery returned ${res.status}`);
      const data = await res.json();
      if (data.status === "SUCCESS") {
        setDiscoveryData(data);
        setActiveTab("frontier");

        const hVal = data.quant_discovery?.hurst_exponent?.hurst_exponent || 0.5;
        const runsZ = data.quant_discovery?.runs_test?.z_score || 0.0;
        const pVal = data.quant_discovery?.runs_test?.p_value || 1.0;

        setMessages((prev) => [
          ...prev,
          {
            id: "msg_disc_done_" + Date.now(),
            role: "assistant",
            content: `📊 **Empirical Discovery Findings for ${symbol}**:\n- **Regime Classification**: \`${data.regime}\`\n- **Hurst Exponent (H)**: \`${Number(hVal).toFixed(3)}\` (${hVal > 0.55 ? "Persistent Trend" : hVal < 0.45 ? "Mean-Reverting" : "Random Walk"})\n- **Wald-Wolfowitz Runs Test**: Z=\`${Number(runsZ).toFixed(2)}\`, p-value=\`${Number(pVal).toFixed(4)}\`\n- **Institutional Guidance**: ${data.guidance}`,
            timestamp: new Date().toLocaleTimeString(),
            actionTriggered: "DISCOVERY_COMPLETE"
          }
        ]);
      } else {
        throw new Error(data.error || "Discovery failed");
      }
    } catch (e: any) {
      setErrorMsg("Discovery error: " + e.message);
    } finally {
      setDiscovering(false);
    }
  };

  // =========================================================================
  // 8. Conversational Agent SSE Streaming (POST /api/copilot/chat)
  // =========================================================================
  const handleSendChat = async (e?: React.FormEvent, overrideText?: string) => {
    if (e) e.preventDefault();
    const text = (overrideText !== undefined ? overrideText : chatInput).trim();
    if (!text || isGenerating) return;

    if (overrideText === undefined) {
      setChatInput("");
    }
    const userMsgId = "msg_user_" + Date.now();
    const assistantMsgId = "msg_agent_" + Date.now();

    const userMsg: StudioChatMessage = {
      id: userMsgId,
      role: "user",
      content: text,
      timestamp: new Date().toLocaleTimeString()
    };

    const initialAssistantMsg: StudioChatMessage = {
      id: assistantMsgId,
      role: "assistant",
      content: "",
      timestamp: new Date().toLocaleTimeString(),
      activeTools: []
    };

    setMessages((prev) => [...prev, userMsg, initialAssistantMsg]);
    setIsGenerating(true);
    setActiveTools([]);
    setElapsedSeconds(0);
    setStalledWarning(null);
    lastActiveRef.current = Date.now();

    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
      if (Date.now() - lastActiveRef.current > 35000) {
        setStalledWarning("Execution appears stalled: No stream deltas received from edge node or model provider for >35s.");
      }
    }, 1000);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    let receivedAnyText = false;

    try {
      const slidingHistory = messages.filter((m) => m.id !== "msg_init").slice(-6);
      const payloadMessages = [...slidingHistory, userMsg].map((m) => ({
        role: m.role,
        content: m.content
      }));

      const storedVault = getAllStoredVaultSettings();
      const gKey = vaultSettings.geminiApiKey || storedVault.geminiApiKey || getStoredVaultValue("geminiApiKey") || "";
      const qKey = vaultSettings.customAiApiKey || storedVault.customAiApiKey || getStoredVaultValue("customAiApiKey") || "";
      const nvKey = vaultSettings.nvidiaApiKey || storedVault.nvidiaApiKey || getStoredVaultValue("nvidiaApiKey") || "";
      const oaKey = vaultSettings.openaiApiKey || storedVault.openaiApiKey || getStoredVaultValue("openaiApiKey") || "";
      const orKey = vaultSettings.openrouterApiKey || storedVault.openrouterApiKey || getStoredVaultValue("openrouterApiKey") || "";

      const keysPayload = {
        gemini: gKey,
        groq: qKey,
        nvidia: nvKey,
        openai: oaKey,
        openrouter: orKey
      };

      const res = await fetch("/api/copilot/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-gemini-api-key": gKey || "",
          "x-groq-api-key": qKey || "",
          "x-nvidia-api-key": nvKey || "",
          "x-openai-api-key": oaKey || "",
          "x-openrouter-api-key": orKey || ""
        },
        body: JSON.stringify({
          messages: payloadMessages,
          model: selectedModel,
          rawId: activeModelObj.rawId || activeModelObj.id,
          temperature: 0.2,
          max_tokens: 4096,
          keys: keysPayload,
          system_context: `Active Strategy Studio Context: Symbol=${symbol}, Timeframe=${timeframe}, Capital=$${capitalOverride}, StopATR=${stopAtr}x, Hold=${maxHoldBars} bars.`
        }),
        signal: controller.signal
      });

      if (!res.ok) {
        throw new Error(`Server returned ${res.status}: ${res.statusText}`);
      }

      if (!res.body) {
        throw new Error("No response body received from Copilot chat stream.");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";

        for (const part of parts) {
          if (!part.trim()) continue;
          const lines = part.split("\n");
          let eventType = "delta";
          const dataLines: string[] = [];

          for (const line of lines) {
            if (line.startsWith("event: ")) {
              eventType = line.slice(7).trim();
            } else if (line.startsWith("data: ")) {
              dataLines.push(line.slice(6));
            } else if (line.startsWith("data:")) {
              dataLines.push(line.slice(5));
            } else if (dataLines.length > 0) {
              dataLines.push(line);
            }
          }

          const dataStr = dataLines.join("\n").trim();
          if (!dataStr) continue;

          lastActiveRef.current = Date.now();
          setStalledWarning(null);

          if (eventType === "tool_call") {
            try {
              const parsed = JSON.parse(dataStr);
              setActiveTools((prev) => [...prev, parsed.tool]);
            } catch (e) {}
          } else if (eventType === "tool_result") {
            try {
              const parsed = JSON.parse(dataStr);
              const toolName = parsed.tool;
              const toolData = parsed.data;

              if (toolName === "run_strategy_sweep" && toolData?.best_candidate) {
                setSweepCandidates(toolData.candidates || []);
                setParetoFrontier(toolData.pareto_frontier || []);
                setResult(toolData.best_candidate);
                setActiveTab("frontier");

                const best = toolData.best_candidate;
                if (best.parameters) {
                  setStopAtr(best.parameters.stop_atr);
                  setMaxHoldBars(best.parameters.max_hold);
                  setPartialProfit(best.parameters.partial_profit);
                  setBreakevenLock(best.parameters.breakeven_lock);
                  setOfiFilter(best.parameters.ofi_filter);
                }
                if (toolData.symbol) {
                  setSymbol(toolData.symbol);
                  setCustomTickerInput(toolData.symbol);
                }
                setStrategyName(`Optimal Sweep: ${toolData.symbol || symbol} (${best.label || "Frontier"})`);
              } else if (toolName === "run_strategy_backtest" && toolData?.success) {
                setResult(toolData);
                setActiveTab("performance");
                if (toolData.parameters) {
                  setStopAtr(toolData.parameters.stop_atr || stopAtr);
                  setMaxHoldBars(toolData.parameters.max_hold || maxHoldBars);
                }
                if (toolData.symbol) {
                  setSymbol(toolData.symbol);
                  setCustomTickerInput(toolData.symbol);
                }
              } else if (toolName === "run_quant_discovery" && toolData?.status === "SUCCESS") {
                setDiscoveryData(toolData);
                setActiveTab("frontier");
                if (toolData.symbol) {
                  setSymbol(toolData.symbol);
                  setCustomTickerInput(toolData.symbol);
                }
              } else if (toolName === "save_strategy_to_vault" && toolData?.status === "SUCCESS") {
                fetchVaultStrategies();
              }
            } catch (e) {
              console.warn("Error processing tool_result in Strategy Studio:", e);
            }
          } else if (eventType === "truncated") {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === assistantMsgId ? { ...msg, isTruncated: true } : msg
              )
            );
          } else if (eventType === "delta") {
            let chunk = "";
            try {
              const parsed = JSON.parse(dataStr);
              chunk = typeof parsed === "string" ? parsed : (parsed.content || parsed.message || "");
            } catch (e) {
              chunk = dataStr;
            }
            if (chunk) {
              receivedAnyText = true;
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantMsgId ? { ...msg, content: msg.content + chunk } : msg
                )
              );
            }
          }
        }
      }

      if (!receivedAnyText) {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMsgId && !msg.content
              ? {
                  ...msg,
                  content: `> ⚠️ **Provider Notice**: The selected model (\`${selectedModel}\`) returned no output. Please ensure the provider API key is active in the **4-Pillar Vault**, or select **Local Tier 0 FinBERT**.`
                }
              : msg
          )
        );
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMsgId
              ? {
                  ...msg,
                  content: msg.content + `\n\n> ❌ **Execution Error**: ${err.message || "Failed to complete stream."}`
                }
              : msg
          )
        );
      }
    } finally {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setIsGenerating(false);
      setActiveTools([]);
      abortControllerRef.current = null;
    }
  };

  const handleStopChat = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsGenerating(false);
      setActiveTools([]);
    }
  };

  const handleContinueChat = () => {
    handleSendChat(undefined, "Continue rendering the quantitative analysis from where you left off. Do not repeat previous sections, complete the remainder.");
  };

  const handleRetryChat = () => {
    handleStopChat();
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (lastUser) {
      handleSendChat(undefined, lastUser.content);
    }
  };

  // =========================================================================
  // 9. Experiment Vault Save, Load, and Delete Handlers
  // =========================================================================
  const handleSaveToVault = async () => {
    if (!result) return;
    const newExperiment: StrategyStudioExperiment = {
      id: "EXP_" + Date.now().toString(16).toUpperCase(),
      timestamp: new Date().toISOString(),
      name: strategyName || `${symbol} Strategy v${vault.length + 1}`,
      symbol,
      timeframe,
      parameters: {
        capitalOverride,
        stopAtrMultiplier: stopAtr,
        partialProfit,
        breakevenLock,
        maxHoldBars,
        ofiFilter,
        adaptiveStop,
        riskBudgetPct,
        frictionCeilingPct: frictionCeiling
      },
      metrics: {
        totalPnL: Number(result.totalPnL || result.netProfit || 0),
        totalPnLPercent: Number(result.totalPnLPercent || 0),
        winRate: Number(result.winRate || 0),
        profitFactor: Number(result.profitFactor || 1.0),
        annualizedSharpe: Number(result.annualizedSharpe || 0),
        deflatedSharpeRatio: Number(result.deflatedSharpeRatio || 0),
        passesDsrHurdle: Boolean(result.passesDsrHurdle),
        maxDrawdownPercent: Number(result.maxDrawdownPercent || 0),
        totalTrades: Number(result.totalTrades || (result.tradesList || []).length),
        totalCommissions: Number(result.totalCommissions || 0)
      },
      balanceHistory: result.balanceHistory || [],
      tradesList: result.tradesList || []
    };

    // 1. Update client local storage
    const updated = [newExperiment, ...vault.filter((v) => v.id !== newExperiment.id)];
    setVault(updated);
    try {
      localStorage.setItem("alpha_engine_strategy_vault", JSON.stringify(updated));
    } catch (err) {}

    // 2. Persist to server strategy vault (Rule 9)
    try {
      await fetch("/api/vault/strategies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newExperiment)
      });
    } catch (err) {
      console.warn("Could not save to server vault:", err);
    }

    setSaveSuccessMsg(`Saved "${newExperiment.name}" into Experiment Vault.`);
    setTimeout(() => setSaveSuccessMsg(null), 4000);
  };

  const handleLoadExperiment = (exp: StrategyStudioExperiment) => {
    setStrategyName(exp.name);
    setSymbol(exp.symbol);
    setCustomTickerInput(exp.symbol);
    setTimeframe(exp.timeframe);
    if (exp.parameters.capitalOverride) {
      setCapitalOverride(exp.parameters.capitalOverride);
    }
    setStopAtr(exp.parameters.stopAtrMultiplier);
    setPartialProfit(exp.parameters.partialProfit);
    setBreakevenLock(exp.parameters.breakevenLock);
    setMaxHoldBars(exp.parameters.maxHoldBars);
    setOfiFilter(exp.parameters.ofiFilter);
    setAdaptiveStop(exp.parameters.adaptiveStop);
    setRiskBudgetPct(exp.parameters.riskBudgetPct);
    setFrictionCeiling(exp.parameters.frictionCeilingPct);

    setResult({
      success: true,
      symbol: exp.symbol,
      timeframe: exp.timeframe,
      startingCapital: exp.parameters.capitalOverride || 100000,
      finalCapital: (exp.parameters.capitalOverride || 100000) + exp.metrics.totalPnL,
      totalPnL: exp.metrics.totalPnL,
      totalPnLPercent: exp.metrics.totalPnLPercent,
      winRate: exp.metrics.winRate,
      profitFactor: exp.metrics.profitFactor,
      annualizedSharpe: exp.metrics.annualizedSharpe,
      deflatedSharpeRatio: exp.metrics.deflatedSharpeRatio,
      passesDsrHurdle: exp.metrics.passesDsrHurdle,
      maxDrawdownPercent: exp.metrics.maxDrawdownPercent,
      totalTrades: exp.metrics.totalTrades,
      totalCommissions: exp.metrics.totalCommissions,
      balanceHistory: exp.balanceHistory,
      tradesList: exp.tradesList
    });

    setActiveTab("performance");
    setMessages((prev) => [
      ...prev,
      {
        id: "msg_load_" + Date.now(),
        role: "assistant",
        content: `📂 **Loaded Experiment from Vault:** *${exp.name}* (${exp.symbol} ${exp.timeframe}). Parameters and equity curve restored.`,
        timestamp: new Date().toLocaleTimeString()
      }
    ]);
  };

  const handleDeleteExperiment = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = vault.filter((item) => item.id !== id);
    setVault(updated);
    try {
      localStorage.setItem("alpha_engine_strategy_vault", JSON.stringify(updated));
      await fetch(`/api/vault/strategies/${id}`, { method: "DELETE" });
    } catch {}
  };

  const handleSelectCandidate = (cand: any) => {
    setResult(cand);
    if (cand.parameters) {
      setStopAtr(cand.parameters.stop_atr);
      setMaxHoldBars(cand.parameters.max_hold);
      setPartialProfit(cand.parameters.partial_profit);
      setBreakevenLock(cand.parameters.breakeven_lock);
      setOfiFilter(cand.parameters.ofi_filter);
    }
    setStrategyName(`${symbol} - ${cand.label || `Trial #${cand.trial_index + 1}`}`);
    setActiveTab("performance");
  };

  // Quick Action Chips
  const quickChips = [
    symbol ? `Run 16-parameter sweep on ${symbol}` : "Run 16-parameter optimization sweep",
    symbol ? `Analyze Hurst exponent & regime for ${symbol}` : "Analyze Hurst exponent & regime",
    "Optimize with $25k capital and Deflated Sharpe hurdle",
    "Run single simulation with 1.8 ATR stop and 15 hold bars",
    "Preserve current strategy to Experiment Vault"
  ];

  return (
    <div className="space-y-6">
      {/* =========================================================================
          Top Navigation & Header Controls
          ========================================================================= */}
      <div className="terminal-card rounded-2xl p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-xl">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs terminal-badge-bid px-2.5 py-1 rounded-md font-mono font-bold flex items-center gap-1.5 shadow-sm">
              <Sparkles className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400" /> AGENTIC STRATEGY STUDIO
            </span>
            <span className="text-xs bg-blue-500/20 text-blue-500 dark:text-blue-300 border border-blue-500/30 px-2.5 py-1 rounded-md font-mono font-bold">
              VERIFIED BROKER BARS
            </span>
            <span className="text-xs text-secondary font-mono hidden sm:inline-block">
              Marcos López de Prado DSR (N=16) • Multi-Permutation Pareto Frontier
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black text-primary font-mono mt-2 flex items-center gap-2">
            <SlidersHorizontal className="w-6 h-6 text-emerald-500 dark:text-emerald-400" /> Quantitative Strategy Studio & Experiment Vault
          </h1>
          <p className="text-xs sm:text-sm text-secondary font-sans mt-0.5">
            Direct autonomous agents to discover high-expectancy trading configurations, run parameter sweeps, and preserve audited strategy backtests.
          </p>
        </div>

        {/* Top Control Plane: Model Dropdown + 4-Pillar Vault + Action Buttons */}
        <div className="flex items-center gap-2 flex-wrap w-full md:w-auto justify-end">
          {/* Dynamic Institutional Model Selector */}
          <InstitutionalModelSelector
            availableModels={availableModels}
            selectedModel={selectedModel}
            onSelectModel={(modelId) => {
              setSelectedModel(modelId);
              localStorage.setItem("alpha_copilot_model", modelId);
            }}
            isModelConfigured={isModelConfigured}
            onOpenVault={() => setIsVaultOpen(true)}
          />

          {/* 4-Pillar Vault Button */}
          <button
            onClick={() => setIsVaultOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-600/20 border border-indigo-500/40 hover:bg-indigo-600/30 text-indigo-300 font-mono text-xs font-bold transition cursor-pointer shadow-sm"
          >
            <Shield className="w-3.5 h-3.5 text-indigo-400" />
            4-PILLAR VAULT
          </button>

          {/* Single Simulation Button */}
          <button
            onClick={() => handleRunSimulation()}
            disabled={loading || sweeping || discovering}
            className="bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white font-mono text-xs font-bold px-3 py-2 rounded-xl transition cursor-pointer flex items-center gap-1.5 border border-white/10"
          >
            {loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            SIMULATE
          </button>

          {/* 16-Trial Sweep Button */}
          <button
            onClick={handleRunSweep}
            disabled={loading || sweeping || discovering}
            className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-mono text-xs font-bold px-3.5 py-2 rounded-xl transition cursor-pointer flex items-center gap-1.5 shadow-lg shadow-emerald-600/20"
          >
            {sweeping ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
            16-TRIAL SWEEP
          </button>

          {/* Quant Discovery Button */}
          <button
            onClick={handleRunDiscovery}
            disabled={loading || sweeping || discovering}
            className="bg-cyan-700 hover:bg-cyan-600 disabled:opacity-50 text-white font-mono text-xs font-bold px-3 py-2 rounded-xl transition cursor-pointer flex items-center gap-1.5 border border-cyan-500/30"
          >
            {discovering ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Activity className="w-3.5 h-3.5" />}
            DISCOVERY
          </button>

          {result && (
            <button
              onClick={handleSaveToVault}
              className="bg-indigo-600 hover:bg-indigo-500 text-white font-mono text-xs font-bold px-3 py-2 rounded-xl transition cursor-pointer flex items-center gap-1.5 shadow-lg shadow-indigo-600/20"
            >
              <Bookmark className="w-3.5 h-3.5" />
              SAVE
            </button>
          )}

          {/* Live Pool Deployment Button */}
          <button
            type="button"
            onClick={() => {
              setDeployFrictionCeiling(frictionCeiling);
              setIsDeployModalOpen(true);
            }}
            disabled={!result || loading || sweeping}
            className={`font-mono text-xs font-black px-4 py-2 rounded-xl transition cursor-pointer flex items-center gap-1.5 shadow-md ${
              deployedSymbols.has(symbol.toUpperCase().trim())
                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 hover:bg-emerald-500/30"
                : "bg-gradient-to-r from-emerald-600 to-indigo-600 hover:from-emerald-500 hover:to-indigo-500 text-white shadow-emerald-950/20"
            }`}
            title="Deploy strategy into live candidate execution pool"
          >
            <Rocket className="w-3.5 h-3.5" />
            <span>{deployedSymbols.has(symbol.toUpperCase().trim()) ? "ARMED (UPDATE POOL)" : "DEPLOY TO POOL"}</span>
          </button>
        </div>
      </div>

      {deployToast && (
        <div className={`p-3.5 rounded-xl text-xs font-mono font-bold flex items-center justify-between gap-2 animate-in fade-in ${
          deployToast.type === "success" 
            ? "bg-emerald-500/15 border border-emerald-500/30 text-emerald-400" 
            : "bg-rose-500/15 border border-rose-500/30 text-rose-400"
        }`}>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{deployToast.message}</span>
          </div>
          {deployToast.type === "success" && (
            <button
              type="button"
              onClick={() => {
                if (onNavigate) {
                  onNavigate("blotter");
                } else {
                  localStorage.setItem("alpha_dashboard_view", "blotter");
                  window.location.href = "/";
                }
              }}
              className="px-2.5 py-1 rounded bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 text-[11px] font-mono font-black flex items-center gap-1 shrink-0 cursor-pointer"
            >
              <span>VIEW IN BLOTTER</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {saveSuccessMsg && (
        <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-xs text-emerald-500 dark:text-emerald-400 font-mono flex items-center gap-2 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-500 dark:text-emerald-400" />
          <span>{saveSuccessMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div className="p-3 bg-rose-500/10 border border-rose-500/25 rounded-xl text-xs text-rose-300 font-mono font-semibold">
          {errorMsg}
        </div>
      )}

      {/* =========================================================================
          Main Studio Grid: Conversational Agent (5 Cols) + Visualizer (7 Cols)
          ========================================================================= */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Conversational Agent Terminal */}
        <div className="lg:col-span-5 terminal-card rounded-2xl flex flex-col h-[760px] shadow-xl overflow-hidden">
          {/* Chat Header */}
          <div className="p-4 border-b terminal-border terminal-elevated flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center">
                <Bot className="w-4 h-4 text-emerald-500 dark:text-emerald-400" />
              </div>
              <div>
                <span className="text-xs font-mono font-bold text-primary block">STRATEGY OPTIMIZER AGENT</span>
                <span className="text-[10px] font-mono text-emerald-500 dark:text-emerald-400 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  {isGenerating ? `Streaming Reasoning & Tools (${elapsedSeconds}s)...` : "Pareto Frontier Engine Active"}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {isGenerating && (
                <button
                  onClick={handleStopChat}
                  title="Stop generation"
                  className="text-rose-400 hover:text-rose-300 p-1.5 rounded transition bg-rose-500/10 border border-rose-500/30"
                >
                  <Square className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                onClick={() => setMessages([messages[0]])}
                title="Reset conversation"
                className="text-slate-400 hover:text-white p-1.5 rounded transition"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Active Tool Indicators */}
          {activeTools.length > 0 && (
            <div className="px-4 py-2 bg-emerald-950/40 border-b border-emerald-500/30 flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-mono text-emerald-400 uppercase font-bold flex items-center gap-1">
                  <RefreshCw className="w-3 h-3 animate-spin text-emerald-500 dark:text-emerald-400" /> Invoking Tool:
                </span>
                {activeTools.map((t, idx) => (
                  <span key={idx} className="text-[10px] bg-emerald-500/20 text-emerald-500 dark:text-emerald-400 border border-emerald-500/40 px-2 py-0.5 rounded font-mono font-bold">
                    {t}
                  </span>
                ))}
              </div>
              <span className="text-[10px] font-mono text-emerald-300 font-semibold">
                {elapsedSeconds}s elapsed
              </span>
            </div>
          )}

          {/* Stalled Warning Banner */}
          {stalledWarning && (
            <div className="px-4 py-2.5 bg-amber-500/10 border-b border-amber-500/30 flex items-center justify-between gap-2 text-xs font-mono text-amber-300 animate-in fade-in">
              <span className="flex items-center gap-1.5 font-bold">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400 animate-pulse shrink-0" />
                <span className="truncate max-w-[260px]">{stalledWarning}</span>
              </span>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={handleRetryChat}
                  className="px-2 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-[10px] text-amber-200 font-bold cursor-pointer transition"
                >
                  Retry Tool
                </button>
                <button
                  type="button"
                  onClick={handleStopChat}
                  className="px-2 py-0.5 rounded bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-[10px] text-rose-300 font-bold cursor-pointer transition"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Chat Messages Log */}
          <div className="flex-1 p-4 overflow-y-auto space-y-4 font-mono text-xs">
            {messages.map((m) => {
              const isAgent = m.role === "assistant";
              return (
                <div
                  key={m.id}
                  className={`flex gap-3 ${isAgent ? "items-start" : "items-start flex-row-reverse"}`}
                >
                  <div
                    className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 mt-0.5 ${
                      isAgent ? "bg-emerald-500/20 text-emerald-500 dark:text-emerald-400" : "bg-indigo-600 text-white"
                    }`}
                  >
                    {isAgent ? <Bot className="w-3.5 h-3.5" /> : <span className="font-bold text-[10px]">YOU</span>}
                  </div>
                  <div
                    className={`p-3.5 rounded-2xl max-w-[85%] leading-relaxed ${
                      isAgent
                        ? "terminal-elevated text-primary"
                        : "bg-indigo-600 text-white shadow-md shadow-indigo-600/20"
                    }`}
                  >
                    <div className="whitespace-pre-wrap font-mono">{m.content || "..."}</div>
                    {m.isTruncated && (
                      <div className="mt-2.5 pt-2 border-t border-border/60 flex items-center justify-between gap-2">
                        <span className="text-[10px] text-amber-400 font-mono flex items-center gap-1">
                          <AlertCircle className="w-3 h-3 text-amber-400 shrink-0" />
                          Reached 4,096-token ceiling.
                        </span>
                        <button
                          type="button"
                          onClick={handleContinueChat}
                          disabled={isGenerating}
                          className="px-2 py-0.5 rounded bg-accent/20 hover:bg-accent/30 border border-accent/40 text-[10px] text-accent font-bold cursor-pointer flex items-center gap-1 transition"
                        >
                          <Play className="w-2.5 h-2.5" /> Continue
                        </button>
                      </div>
                    )}

                    {/* Two-Way Action Chips on Agent Recommendations */}
                    {isAgent && (
                      <div className="mt-3 pt-2.5 border-t border-border/60 flex flex-wrap items-center gap-1.5 text-[10px] font-mono">
                        {result?.parameters && (
                          <button
                            type="button"
                            onClick={() => {
                              const p = result.parameters;
                              if (p.stop_atr !== undefined) setStopAtr(p.stop_atr);
                              if (p.stopAtrMultiplier !== undefined) setStopAtr(p.stopAtrMultiplier);
                              if (p.max_hold !== undefined) setMaxHoldBars(p.max_hold);
                              if (p.maxHoldBars !== undefined) setMaxHoldBars(p.maxHoldBars);
                              if (p.partial_profit !== undefined) setPartialProfit(p.partial_profit);
                              if (p.partialProfit !== undefined) setPartialProfit(p.partialProfit);
                              if (p.breakeven_lock !== undefined) setBreakevenLock(p.breakeven_lock);
                              if (p.breakevenLock !== undefined) setBreakevenLock(p.breakevenLock);
                              if (p.ofi_filter !== undefined) setOfiFilter(p.ofi_filter);
                              if (p.ofiFilter !== undefined) setOfiFilter(p.ofiFilter);
                              setSaveSuccessMsg("Applied strategy parameters directly to interactive control deck!");
                              setTimeout(() => setSaveSuccessMsg(null), 3500);
                            }}
                            className="px-2 py-0.5 rounded bg-accent/15 hover:bg-accent/25 border border-accent/40 text-accent font-bold transition cursor-pointer flex items-center gap-1 shadow-xs"
                          >
                            <span>📥 APPLY TO FORM</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setActiveTab("candles")}
                          className="px-2 py-0.5 rounded bg-surface hover:bg-surface/80 border border-border text-foreground font-semibold transition cursor-pointer flex items-center gap-1"
                        >
                          <BarChart2 className="w-3 h-3 text-accent" />
                          <span>L1 CANDLES</span>
                        </button>
                        {sweepCandidates.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setActiveTab("frontier")}
                            className="px-2 py-0.5 rounded bg-surface hover:bg-surface/80 border border-border text-amber-400 font-semibold transition cursor-pointer flex items-center gap-1"
                          >
                            <Zap className="w-3 h-3" />
                            <span>LOAD PARETO</span>
                          </button>
                        )}
                        {result && (
                          <button
                            type="button"
                            onClick={handleSaveToVault}
                            className="px-2 py-0.5 rounded bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/40 text-indigo-300 font-bold transition cursor-pointer flex items-center gap-1"
                          >
                            <Bookmark className="w-3 h-3" />
                            <span>SAVE TO VAULT</span>
                          </button>
                        )}
                      </div>
                    )}

                    <span className="text-[10px] opacity-40 block mt-1.5 text-right font-sans">{m.timestamp}</span>
                  </div>
                </div>
              );
            })}
            {(sweeping || discovering) && (
              <div className="flex gap-3 items-start animate-in fade-in">
                <div className="w-6 h-6 rounded-md bg-emerald-500/20 text-emerald-500 dark:text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                </div>
                <div className="p-3 rounded-2xl terminal-elevated text-emerald-500 dark:text-emerald-300 font-mono text-xs">
                  {sweeping ? "Executing 16-parameter sweep across verified broker bars..." : "Computing Wald-Wolfowitz & Hurst exponent..."}
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Quick Action Chips */}
          <div className="px-4 py-2 terminal-elevated border-t terminal-border flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            {quickChips.map((chip, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => {
                  setChatInput(chip);
                }}
                disabled={isGenerating}
                className="whitespace-nowrap px-2.5 py-1 rounded-md terminal-card hover:border-accent text-[11px] font-mono text-secondary hover:text-primary transition cursor-pointer shrink-0"
              >
                {chip}
              </button>
            ))}
          </div>

          {/* Chat Input Bar */}
          <form onSubmit={handleSendChat} className="p-3 terminal-card border-t terminal-border flex gap-2">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder={symbol ? `Direct agent (e.g. Run 16-parameter sweep on ${symbol})...` : "Direct agent (e.g. Run 16-parameter sweep, test Hurst exponent)..."}
              disabled={isGenerating}
              className="flex-1 terminal-elevated rounded-xl px-3.5 py-2.5 text-xs text-primary font-mono placeholder:text-muted focus:outline-none focus:border-cyan"
            />
            <button
              type="submit"
              disabled={isGenerating || !chatInput.trim()}
              className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white px-4 py-2.5 rounded-xl transition cursor-pointer flex items-center justify-center shadow-md"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>

        {/* Right Column: Tactical Parameters & Results Visualizer */}
        <div className="lg:col-span-7 space-y-5">
          {/* Parameter Tuning Controls */}
          <div className="terminal-card rounded-2xl p-5 space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b terminal-border pb-3">
              <span className="text-xs font-mono uppercase font-bold text-primary flex items-center gap-2">
                <Sliders className="w-4 h-4 text-emerald-500 dark:text-emerald-400" /> Strategy Parameter & Friction Controls
              </span>
              <span className="text-xs text-secondary font-mono">Calibrated against IBKR Europe Rates</span>
            </div>

            {/* Selector Grid: Organized in 2 spacious responsive tiers */}
            <div className="space-y-3.5">
              {/* Row 1: Asset, Timeframe, and Capital Allocation */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {/* Dynamic Ticker Resolution */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11px] text-secondary uppercase font-mono font-bold">
                      Ticker (Dynamic)
                    </label>
                    {resolvingSymbol ? (
                      <span className="text-[10px] text-cyan-400 font-mono animate-pulse">Resolving...</span>
                    ) : resolvedInfo ? (
                      <span className="text-[10px] terminal-badge-bid font-mono font-semibold px-1.5 py-0.2 rounded">
                        {resolvedInfo.exchange || "SMART"} • {resolvedInfo.currency || "USD"}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      value={customTickerInput}
                      onChange={(e) => setCustomTickerInput(e.target.value.toUpperCase())}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          updateActiveSymbol(customTickerInput);
                        }
                      }}
                      onBlur={() => {
                        if (customTickerInput.trim().toUpperCase() !== symbol) {
                          updateActiveSymbol(customTickerInput);
                        }
                      }}
                      placeholder="Enter symbol..."
                      className="flex-1 terminal-elevated rounded-lg px-2.5 py-1.5 text-xs text-primary font-mono uppercase font-bold focus:outline-none focus:border-cyan"
                    />
                    <select
                      value={symbol}
                      onChange={(e) => {
                        updateActiveSymbol(e.target.value);
                      }}
                      className="w-36 terminal-elevated rounded-lg px-2 py-1.5 text-xs text-primary font-mono focus:outline-none focus:border-cyan font-bold"
                    >
                      <option value="">{dynamicUniverse.length > 0 ? "Select Symbol..." : "No universe"}</option>
                      {dynamicUniverse.map((u) => (
                        <option key={u.symbol} value={u.symbol}>
                          {u.symbol}
                        </option>
                      ))}
                      {symbol && !dynamicUniverse.some((u) => u.symbol.toUpperCase() === symbol.toUpperCase()) && (
                        <option value={symbol}>{symbol} (Custom)</option>
                      )}
                    </select>
                  </div>
                </div>

                {/* Timeframe */}
                <div>
                  <label className="text-[11px] text-secondary uppercase font-mono font-bold block mb-1">Timeframe</label>
                  <select
                    value={timeframe}
                    onChange={(e) => setTimeframe(e.target.value)}
                    className="w-full terminal-elevated rounded-lg px-2.5 py-1.5 text-xs text-primary font-mono focus:outline-none focus:border-cyan font-bold"
                  >
                    <option value="5m">5 Min (Microstructure)</option>
                    <option value="15m">15 Min (Intraday Drift)</option>
                    <option value="1h">1 Hour (Session Swing)</option>
                  </select>
                </div>

                {/* Starting Capital */}
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-[11px] text-secondary uppercase font-mono font-bold">Capital ($)</label>
                    <span className="text-xs text-emerald-500 font-mono font-bold">${capitalOverride.toLocaleString()}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="flex items-center gap-1 w-1/2">
                      {[5000, 25000, 100000].map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => setCapitalOverride(preset)}
                          className={`flex-1 py-1 rounded text-[10px] font-mono cursor-pointer transition ${
                            capitalOverride === preset
                              ? "terminal-badge-bid font-bold"
                              : "terminal-elevated text-secondary hover:text-primary"
                          }`}
                        >
                          ${preset >= 1000 ? `${preset / 1000}k` : preset}
                        </button>
                      ))}
                    </div>
                    <input
                      type="number"
                      min="500"
                      max="10000000"
                      step="1000"
                      value={capitalOverride}
                      onChange={(e) => setCapitalOverride(Math.max(500, parseFloat(e.target.value) || 500))}
                      className="w-1/2 terminal-elevated rounded-lg px-2.5 py-1 text-xs text-primary font-mono focus:outline-none focus:border-cyan"
                    />
                  </div>
                </div>
              </div>

              {/* Row 2: Algorithmic Stops, Holding Horizon & Risk Budget */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-subtle">
                {/* Stop ATR */}
                <div className="terminal-elevated p-2.5 rounded-xl">
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-[11px] text-secondary uppercase font-mono font-bold flex items-center gap-1">
                      Stop ATR Cushion <InfoTip id="atr" />
                    </label>
                    <span className="text-xs text-emerald-500 font-mono font-bold">{stopAtr.toFixed(1)}x ATR</span>
                  </div>
                  <input
                    type="range"
                    min="0.8"
                    max="3.5"
                    step="0.1"
                    value={stopAtr}
                    onChange={(e) => setStopAtr(parseFloat(e.target.value))}
                    className="w-full accent-emerald-500 cursor-pointer mt-1.5"
                  />
                  <div className="flex justify-between text-[9px] text-muted font-mono mt-0.5">
                    <span>Tight (0.8x)</span>
                    <span>Standard (1.8x)</span>
                    <span>Wide (3.5x)</span>
                  </div>
                </div>

                {/* Max Hold */}
                <div className="terminal-elevated p-2.5 rounded-xl">
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-[11px] text-secondary uppercase font-mono font-bold">Max Hold Horizon</label>
                    <span className="text-xs text-cyan-400 font-mono font-bold">{maxHoldBars} bars</span>
                  </div>
                  <input
                    type="range"
                    min="5"
                    max="40"
                    step="1"
                    value={maxHoldBars}
                    onChange={(e) => setMaxHoldBars(parseInt(e.target.value, 10))}
                    className="w-full accent-cyan-500 cursor-pointer mt-1.5"
                  />
                  <div className="flex justify-between text-[9px] text-muted font-mono mt-0.5">
                    <span>Scalp (5b)</span>
                    <span>Standard (15b)</span>
                    <span>Swing (40b)</span>
                  </div>
                </div>

                {/* Per-Trade Risk Budget (r %) */}
                <div className="terminal-elevated p-2.5 rounded-xl">
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-[11px] text-secondary uppercase font-mono font-bold flex items-center gap-1">
                      Risk Budget (r %) <InfoTip id="risk" />
                    </label>
                    <span className="text-xs text-indigo-400 font-mono font-bold">{(riskBudgetPct * 100).toFixed(2)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0.001"
                    max="0.03"
                    step="0.001"
                    value={riskBudgetPct}
                    onChange={(e) => setRiskBudgetPct(parseFloat(e.target.value))}
                    className="w-full accent-indigo-500 cursor-pointer mt-1.5"
                  />
                  <div className="flex justify-between text-[9px] text-muted font-mono mt-0.5">
                    <button type="button" onClick={() => setRiskBudgetPct(0.0025)} className="hover:text-primary cursor-pointer">0.25%</button>
                    <button type="button" onClick={() => setRiskBudgetPct(0.005)} className="hover:text-primary cursor-pointer">0.50%</button>
                    <button type="button" onClick={() => setRiskBudgetPct(0.01)} className="hover:text-primary cursor-pointer font-bold text-indigo-400">1.0%</button>
                    <button type="button" onClick={() => setRiskBudgetPct(0.02)} className="hover:text-primary cursor-pointer">2.0%</button>
                  </div>
                </div>
              </div>

              {/* Row 3: Pre-Flight Quant Gates (Friction Ceiling & DSR Hurdle Dual Controls) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-subtle">
                {/* Transaction Friction Ceiling */}
                <div className="terminal-elevated p-2.5 rounded-xl">
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-[11px] text-secondary uppercase font-mono font-bold flex items-center gap-1">
                      Friction Ceiling Gate (≤ %) <InfoTip id="friction" />
                    </label>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min="2"
                        max="50"
                        step="0.5"
                        value={frictionCeiling}
                        onChange={(e) => setFrictionCeiling(Math.max(1, parseFloat(e.target.value) || 15.0))}
                        className="w-16 terminal-card border border-border rounded px-1.5 py-0.5 text-xs text-amber-500 font-mono font-bold text-right"
                      />
                      <span className="text-xs text-amber-500 font-mono font-bold">%</span>
                    </div>
                  </div>
                  <input
                    type="range"
                    min="5"
                    max="30"
                    step="0.5"
                    value={frictionCeiling}
                    onChange={(e) => setFrictionCeiling(parseFloat(e.target.value))}
                    className="w-full accent-amber-500 cursor-pointer mt-1"
                  />
                  <div className="flex justify-between text-[9px] text-muted font-mono mt-1">
                    <button type="button" onClick={() => setFrictionCeiling(10.0)} className={`hover:text-primary cursor-pointer ${frictionCeiling === 10 ? "text-amber-400 font-bold" : ""}`}>10% (Strict)</button>
                    <button type="button" onClick={() => setFrictionCeiling(15.0)} className={`hover:text-primary cursor-pointer ${frictionCeiling === 15 ? "text-amber-400 font-bold" : ""}`}>15% (IBKR)</button>
                    <button type="button" onClick={() => setFrictionCeiling(20.0)} className={`hover:text-primary cursor-pointer ${frictionCeiling === 20 ? "text-amber-400 font-bold" : ""}`}>20% (Wide)</button>
                  </div>
                </div>

                {/* Deflated Sharpe Ratio (DSR) Hurdle */}
                <div className="terminal-elevated p-2.5 rounded-xl">
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-[11px] text-secondary uppercase font-mono font-bold flex items-center gap-1">
                      DSR Confidence Hurdle (≥ %) <InfoTip id="dsr" />
                    </label>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min="50"
                        max="99.9"
                        step="1.0"
                        value={dsrHurdlePct}
                        onChange={(e) => setDsrHurdlePct(Math.min(99.9, Math.max(50, parseFloat(e.target.value) || 95.0)))}
                        className="w-16 terminal-card border border-border rounded px-1.5 py-0.5 text-xs text-indigo-400 font-mono font-bold text-right"
                      />
                      <span className="text-xs text-indigo-400 font-mono font-bold">%</span>
                    </div>
                  </div>
                  <input
                    type="range"
                    min="50"
                    max="99"
                    step="1"
                    value={dsrHurdlePct}
                    onChange={(e) => setDsrHurdlePct(parseFloat(e.target.value))}
                    className="w-full accent-indigo-500 cursor-pointer mt-1"
                  />
                  <div className="flex justify-between text-[9px] text-muted font-mono mt-1">
                    <button type="button" onClick={() => setDsrHurdlePct(80.0)} className={`hover:text-primary cursor-pointer ${dsrHurdlePct === 80 ? "text-indigo-400 font-bold" : ""}`}>80% (Sandbox)</button>
                    <button type="button" onClick={() => setDsrHurdlePct(90.0)} className={`hover:text-primary cursor-pointer ${dsrHurdlePct === 90 ? "text-indigo-400 font-bold" : ""}`}>90% (Quant)</button>
                    <button type="button" onClick={() => setDsrHurdlePct(95.0)} className={`hover:text-primary cursor-pointer ${dsrHurdlePct === 95 ? "text-indigo-400 font-bold" : ""}`}>95% (Inst.)</button>
                    <button type="button" onClick={() => setDsrHurdlePct(99.0)} className={`hover:text-primary cursor-pointer ${dsrHurdlePct === 99 ? "text-indigo-400 font-bold" : ""}`}>99% (Tier-1)</button>
                  </div>
                </div>
              </div>
            </div>

            {/* Friction Gating Checkboxes */}
            <div className="flex flex-wrap items-center gap-4 pt-2 border-t terminal-border text-xs font-mono">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={partialProfit}
                  onChange={(e) => setPartialProfit(e.target.checked)}
                  className="rounded terminal-elevated text-emerald-500 focus:ring-0"
                />
                <span className="text-secondary font-semibold">Tranche Scaling (50% @ 2.5 ATR)</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={breakevenLock}
                  onChange={(e) => setBreakevenLock(e.target.checked)}
                  className="rounded terminal-elevated text-emerald-500 focus:ring-0"
                />
                <span className="text-secondary font-semibold">Breakeven Ratchet (+1.0 ATR)</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={adaptiveStop}
                  onChange={(e) => setAdaptiveStop(e.target.checked)}
                  className="rounded terminal-elevated text-emerald-500 focus:ring-0"
                />
                <span className="text-secondary font-semibold">Adaptive Stop Cushion</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={ofiFilter}
                  onChange={(e) => setOfiFilter(e.target.checked)}
                  className="rounded terminal-elevated text-emerald-500 focus:ring-0"
                />
                <span className="text-secondary font-semibold flex items-center gap-1">
                  OFI Imbalance Gate (1.4x) <InfoTip id="ofi" />
                </span>
              </label>
            </div>
          </div>

          {/* Results Tab Navigation (Candles / Performance / Pareto Frontier / Blotter / Vault) */}
          <div className="terminal-card p-5 space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-border/80 pb-3 flex-wrap gap-2">
              <div className="flex items-center gap-1.5 bg-surface/50 p-1 rounded-xl border border-border text-xs font-mono flex-wrap">
                <button
                  onClick={() => setActiveTab("candles")}
                  className={`px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 font-bold cursor-pointer ${
                    activeTab === "candles" ? "bg-accent text-background shadow" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <BarChart2 className="w-3.5 h-3.5" /> Intraday Candles & OFI
                </button>
                <button
                  onClick={() => setActiveTab("performance")}
                  className={`px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 font-bold cursor-pointer ${
                    activeTab === "performance" ? "bg-accent text-background shadow" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <TrendingUp className="w-3.5 h-3.5" /> Performance & Curve
                </button>
                <button
                  onClick={() => setActiveTab("frontier")}
                  className={`px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 font-bold cursor-pointer ${
                    activeTab === "frontier" ? "bg-accent text-background shadow" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Zap className="w-3.5 h-3.5 text-amber-400" /> Pareto Frontier ({sweepCandidates.length || 0})
                </button>
                <button
                  onClick={() => setActiveTab("blotter")}
                  className={`px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 font-bold cursor-pointer ${
                    activeTab === "blotter" ? "bg-accent text-background shadow" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Activity className="w-3.5 h-3.5" /> Trade Blotter ({result?.tradesList?.length || 0})
                </button>
                <button
                  onClick={() => setActiveTab("vault")}
                  className={`px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 font-bold cursor-pointer ${
                    activeTab === "vault" ? "bg-indigo-600 text-white shadow" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <FolderOpen className="w-3.5 h-3.5" /> Saved Vault ({vault.length})
                </button>
              </div>

              {result && (
                <span className="text-xs font-mono font-bold text-foreground truncate max-w-[200px]">
                  {strategyName}
                </span>
              )}
            </div>

            {/* =========================================================================
                TAB 0: Intraday Candlestick & Order Flow Imbalance (OFI) Canvas
                ========================================================================= */}
            {activeTab === "candles" && (
              <div className="space-y-4 animate-in fade-in duration-200">
                <InstitutionalCandleChart
                  symbol={symbol}
                  data={result?.priceHistory}
                  trades={result?.tradesList}
                  timeframe={timeframe}
                  onTimeframeChange={(tf) => setTimeframe(tf)}
                  height={500}
                />
              </div>
            )}

            {/* =========================================================================
                TAB 1: Performance Curve & League Table
                ========================================================================= */}
            {activeTab === "performance" && result && (
              <div className="space-y-4 animate-in fade-in duration-200">
                {/* Metric Badges */}
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2.5 text-center font-mono text-xs">
                  <div className="terminal-elevated p-3 rounded-xl">
                    <span className="text-[10px] text-secondary block uppercase font-semibold">Net PnL</span>
                    <span className={`font-bold text-base mt-1 block ${
                      (Number(result.totalPnL || 0)) >= 0 ? "text-emerald-500 dark:text-emerald-400" : "text-rose-500 dark:text-rose-400"
                    }`}>
                      {(Number(result.totalPnL || 0)) >= 0 ? "+" : ""}${Number(result.totalPnL || 0).toFixed(2)}
                    </span>
                    <span className="text-[10px] text-muted">({result.totalPnLPercent || "0.0"}%)</span>
                  </div>

                  <div className="terminal-elevated p-3 rounded-xl">
                    <span className="text-[10px] text-secondary block uppercase font-semibold">Annual Sharpe</span>
                    <span className="font-bold text-base text-emerald-500 dark:text-emerald-400 mt-1 block">
                      {result.annualizedSharpe !== undefined ? result.annualizedSharpe : "0.00"}
                    </span>
                    <span className="text-[10px] text-muted">Roll-adjusted</span>
                  </div>

                  <div className="terminal-elevated p-3 rounded-xl">
                    <span className="text-[10px] text-secondary block uppercase font-semibold flex items-center justify-center gap-1">
                      Deflated Sharpe <InfoTip id="dsr" />
                    </span>
                    <span className={`font-bold text-base mt-1 block ${
                      result.passesDsrHurdle ? "text-emerald-500 dark:text-emerald-400" : "text-amber-500 dark:text-amber-400"
                    }`}>
                      {result.deflatedSharpeRatio !== undefined ? `${(Number(result.deflatedSharpeRatio) * 100).toFixed(1)}%` : "N/A"}
                    </span>
                    <span className="text-[10px] text-muted">{result.passesDsrHurdle ? "✓ DSR ≥ 95%" : "⚠️ Sub-hurdle"}</span>
                  </div>

                  <div className="terminal-elevated p-3 rounded-xl">
                    <span className="text-[10px] text-secondary block uppercase font-semibold">Win Rate</span>
                    <span className="font-bold text-base text-primary mt-1 block">
                      {result.winRate !== undefined ? result.winRate : "0.0"}%
                    </span>
                    <span className="text-[10px] text-muted">{result.winningTrades || 0}W / {result.losingTrades || 0}L</span>
                  </div>

                  <div className="terminal-elevated p-3 rounded-xl">
                    <span className="text-[10px] text-secondary block uppercase font-semibold">Profit Factor</span>
                    <span className="font-bold text-base text-cyan-500 dark:text-cyan-400 mt-1 block">
                      {result.profitFactor !== undefined ? result.profitFactor : "1.00"}
                    </span>
                    <span className="text-[10px] text-muted">Gross W/L Ratio</span>
                  </div>

                  <div className="terminal-elevated p-3 rounded-xl">
                    <span className="text-[10px] text-secondary block uppercase font-semibold">Max Drawdown</span>
                    <span className="font-bold text-base text-rose-500 dark:text-rose-400 mt-1 block">
                      -{result.maxDrawdownPercent !== undefined ? result.maxDrawdownPercent : "0.0"}%
                    </span>
                    <span className="text-[10px] text-muted">Peak-to-trough</span>
                  </div>
                </div>

                {/* Equity Curve */}
                <div className="terminal-elevated rounded-xl p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono font-bold text-primary uppercase flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-emerald-500 dark:text-emerald-400" /> Compounded Equity Trajectory ({result.symbol || symbol})
                    </span>
                    <span className="text-xs font-mono text-secondary">
                      ${Number(result.startingCapital || capitalOverride).toLocaleString()} ➔ ${Number(result.finalCapital || capitalOverride).toLocaleString()}
                    </span>
                  </div>

                  <div className="h-64 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart
                        data={result.balanceHistory || []}
                        margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                      >
                        <defs>
                          <linearGradient id="studioEquityGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                            <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.25} />
                        <XAxis
                          dataKey="date"
                          stroke="#64748b"
                          fontSize={10}
                          tickLine={false}
                          tickFormatter={(val) => {
                            if (!val) return "";
                            const parts = val.split(" ");
                            return parts[0] ? parts[0].slice(5) : val;
                          }}
                        />
                        <YAxis
                          stroke="#64748b"
                          fontSize={10}
                          tickLine={false}
                          domain={["dataMin - 500", "dataMax + 500"]}
                          tickFormatter={(v) => `$${(v / 1000).toFixed(1)}k`}
                        />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "#0f172a",
                            borderColor: "#334155",
                            borderRadius: "8px",
                            fontFamily: "monospace",
                            fontSize: "12px"
                          }}
                          formatter={(val: any) => [`$${Number(val).toLocaleString()}`, "Equity"]}
                          labelFormatter={(lbl) => `Bar: ${lbl}`}
                        />
                        <Area
                          type="monotone"
                          dataKey="equity"
                          stroke="#10b981"
                          strokeWidth={2}
                          fillOpacity={1}
                          fill="url(#studioEquityGradient)"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            )}

            {/* =========================================================================
                TAB 2: Pareto Frontier & Optimization Candidates Matrix
                ========================================================================= */}
            {activeTab === "frontier" && (
              <div className="space-y-4 animate-in fade-in duration-200">
                {/* Discovery Microstructure Card (if available) */}
                {discoveryData && (
                  <div className="terminal-elevated border border-cyan-500/30 rounded-xl p-4 space-y-2 font-mono text-xs">
                    <div className="flex items-center justify-between border-b terminal-border pb-2">
                      <span className="font-bold text-cyan-400 flex items-center gap-2">
                        <Activity className="w-4 h-4 text-cyan-400" /> Empirical Microstructure Analysis ({discoveryData.symbol})
                      </span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        discoveryData.regime === "PERSISTENT_TRENDING" ? "terminal-badge-bid" :
                        discoveryData.regime === "MEAN_REVERTING" ? "terminal-badge-warn" :
                        "terminal-card text-secondary"
                      }`}>
                        {discoveryData.regime}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-3 pt-1 text-center">
                      <div className="terminal-card p-2 rounded-lg">
                        <span className="text-[10px] text-secondary block">HURST EXPONENT (H)</span>
                        <span className="font-bold text-emerald-500 dark:text-emerald-400 text-sm">
                          {Number(discoveryData.quant_discovery?.hurst_exponent?.hurst_exponent || 0.5).toFixed(3)}
                        </span>
                      </div>
                      <div className="terminal-card p-2 rounded-lg">
                        <span className="text-[10px] text-secondary block">RUNS TEST (Z-SCORE)</span>
                        <span className="font-bold text-cyan-500 dark:text-cyan-400 text-sm">
                          {Number(discoveryData.quant_discovery?.runs_test?.z_score || 0).toFixed(2)}
                        </span>
                      </div>
                      <div className="terminal-card p-2 rounded-lg">
                        <span className="text-[10px] text-secondary block">MARKOV P(UP|UP)</span>
                        <span className="font-bold text-primary text-sm">
                          {(Number(discoveryData.quant_discovery?.markov_transitions?.transition_matrix?.up_to_up || 0.5) * 100).toFixed(1)}%
                        </span>
                      </div>
                    </div>
                    <p className="text-[11px] text-secondary font-sans italic pt-1">{discoveryData.guidance}</p>
                  </div>
                )}

                {/* Pareto Candidates Table */}
                <div className="terminal-card rounded-xl p-4 space-y-3 font-mono text-xs">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <span className="font-bold uppercase text-primary flex items-center gap-2">
                      <Zap className="w-4 h-4 text-amber-500 dark:text-amber-400" /> Multi-Permutation Candidates Matrix ({sweepCandidates.length} Trials Tested)
                    </span>
                    <span className="text-[11px] text-secondary">
                      Selection Bias Penalty: N={sweepCandidates.length || 16} • Click any row to load
                    </span>
                  </div>

                  {sweepCandidates.length === 0 ? (
                    <div className="py-12 text-center text-xs text-muted">
                      No sweep completed yet. Click <strong>16-TRIAL SWEEP</strong> above or direct the agent: <em>"Run 16-parameter sweep on {symbol}"</em>.
                    </div>
                  ) : (
                    <div className="overflow-x-auto max-h-96">
                      <table className="w-full text-left">
                        <thead className="sticky top-0 terminal-elevated border-b terminal-border text-secondary">
                          <tr>
                            <th className="py-2 px-2.5">Trial / Label</th>
                            <th className="py-2 px-2 text-right">Stop ATR</th>
                            <th className="py-2 px-2 text-right">Hold</th>
                            <th className="py-2 px-2 text-right">Win Rate</th>
                            <th className="py-2 px-2 text-right">Sharpe</th>
                            <th className="py-2 px-2 text-right">DSR</th>
                            <th className="py-2 px-2 text-right">Max DD</th>
                            <th className="py-2 px-2 text-right">Net PnL</th>
                            <th className="py-2 px-2 text-center">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          {sweepCandidates.map((c, idx) => {
                            const isOptimal = paretoFrontier.some((pf) => pf.trial_index === c.trial_index);
                            const isCurrent = result?.parameters?.stop_atr === c.parameters?.stop_atr &&
                                              result?.parameters?.max_hold === c.parameters?.max_hold;
                            return (
                              <tr
                                key={idx}
                                onClick={() => handleSelectCandidate(c)}
                                className={`transition cursor-pointer hover:bg-emerald-950/20 ${
                                  isCurrent ? "bg-emerald-950/40 border-l-2 border-emerald-500 font-bold" : ""
                                }`}
                              >
                                <td className="py-2 px-2.5 text-white flex items-center gap-1.5">
                                  {isOptimal && <Sparkles className="w-3 h-3 text-amber-400 shrink-0" />}
                                  <span className="truncate max-w-[140px]">{c.label || `Candidate #${c.trial_index + 1}`}</span>
                                </td>
                                <td className="py-2 px-2 text-right text-slate-300">{c.parameters?.stop_atr}x</td>
                                <td className="py-2 px-2 text-right text-slate-300">{c.parameters?.max_hold}b</td>
                                <td className="py-2 px-2 text-right text-white">{c.winRate}%</td>
                                <td className="py-2 px-2 text-right text-emerald-400">{c.annualizedSharpe}</td>
                                <td className={`py-2 px-2 text-right font-bold ${
                                  c.passesDsrHurdle ? "text-emerald-500 dark:text-emerald-400" : "text-amber-400"
                                }`}>
                                  {(Number(c.deflatedSharpeRatio || 0) * 100).toFixed(1)}%
                                </td>
                                <td className="py-2 px-2 text-right text-rose-400">-{c.maxDrawdownPercent}%</td>
                                <td className={`py-2 px-2 text-right font-bold ${
                                  Number(c.totalPnL || 0) >= 0 ? "text-emerald-500 dark:text-emerald-400" : "text-rose-400"
                                }`}>
                                  {Number(c.totalPnL || 0) >= 0 ? "+" : ""}${Number(c.totalPnL || 0).toFixed(2)}
                                </td>
                                <td className="py-2 px-2 text-center">
                                  {isOptimal ? (
                                    <span className="px-1.5 py-0.5 rounded text-[9px] bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold">
                                      PARETO
                                    </span>
                                  ) : (
                                    <span className="text-[10px] text-slate-500">-</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* =========================================================================
                TAB 3: Audited Trade Blotter
                ========================================================================= */}
            {activeTab === "blotter" && (
              <div className="space-y-3 animate-in fade-in duration-200">
                <div className="flex items-center justify-between pb-2 border-b border-white/5">
                  <span className="text-xs font-mono font-bold text-white uppercase flex items-center gap-2">
                    <Activity className="w-4 h-4 text-emerald-400" /> Audited Execution Blotter ({result?.tradesList?.length || 0} Trades)
                  </span>
                  <span className="text-xs font-mono text-slate-400">
                    Commissions: ${Number(result?.totalCommissions || 0).toFixed(2)}
                  </span>
                </div>

                {(!result?.tradesList || result.tradesList.length === 0) ? (
                  <div className="py-12 text-center text-xs text-slate-500 font-mono">
                    No trades in current simulation. Run a simulation or direct the agent to generate trades.
                  </div>
                ) : (
                  <div className="overflow-x-auto max-h-96">
                    <table className="w-full text-left font-mono text-xs">
                      <thead className="sticky top-0 terminal-elevated border-b terminal-border text-secondary">
                        <tr>
                          <th className="py-2 px-3">Trade ID</th>
                          <th className="py-2 px-3">Timestamp</th>
                          <th className="py-2 px-3">Direction</th>
                          <th className="py-2 px-3 text-right">Shares</th>
                          <th className="py-2 px-3 text-right">Entry</th>
                          <th className="py-2 px-3 text-right">Exit</th>
                          <th className="py-2 px-3">Reason</th>
                          <th className="py-2 px-3 text-right">Fee</th>
                          <th className="py-2 px-3 text-right">Net PnL</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y terminal-border">
                        {result.tradesList.map((tr: any) => {
                          const isWin = Number(tr.realizedPnL || 0) >= 0;
                          return (
                            <tr key={tr.id} className="hover:bg-slate-500/5 transition">
                              <td className="py-2 px-3 font-semibold text-primary">{tr.id}</td>
                              <td className="py-2 px-3 text-secondary">{tr.date}</td>
                              <td className="py-2 px-3">
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                  tr.direction === "BUY" ? "terminal-badge-bid" : "terminal-badge-ask"
                                }`}>
                                  {tr.direction}
                                </span>
                              </td>
                              <td className="py-2 px-3 text-right text-secondary">{tr.quantity}</td>
                              <td className="py-2 px-3 text-right text-secondary">${Number(tr.entryPrice).toFixed(2)}</td>
                              <td className="py-2 px-3 text-right text-secondary">${Number(tr.exitPrice).toFixed(2)}</td>
                              <td className="py-2 px-3 text-secondary">
                                <span className="terminal-elevated text-secondary px-1.5 py-0.5 rounded text-[10px]">
                                  {tr.reason}
                                </span>
                              </td>
                              <td className="py-2 px-3 text-right text-secondary">${Number(tr.commission || 0).toFixed(2)}</td>
                              <td className={`py-2 px-3 text-right font-bold ${isWin ? "text-emerald-500 dark:text-emerald-400" : "text-rose-500 dark:text-rose-400"}`}>
                                {isWin ? "+" : ""}${Number(tr.realizedPnL || 0).toFixed(2)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* =========================================================================
                TAB 4: Strategy Experiment Vault (Rule 9 Local + Server Persistence)
                ========================================================================= */}
            {activeTab === "vault" && (
              <div className="space-y-3 animate-in fade-in duration-200">
                <div className="flex items-center justify-between pb-2 border-b border-subtle">
                  <span className="text-xs font-mono font-bold text-primary uppercase flex items-center gap-2">
                    <FolderOpen className="w-4 h-4 text-accent" /> Preserved Strategy Experiment Vault ({vault.length} Audited Records)
                  </span>
                  <span className="text-xs font-mono text-muted">Deterministic Local Atomic Engine (Rule 9)</span>
                </div>

                {vault.length === 0 ? (
                  <div className="py-12 text-center text-xs text-muted font-mono">
                    No strategies saved yet. Run a simulation or parameter sweep, then click "SAVE".
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-96 overflow-y-auto">
                    {vault.map((exp) => (
                      <div
                        key={exp.id}
                        onClick={() => handleLoadExperiment(exp)}
                        className="p-3.5 rounded-xl terminal-card hover:border-accent transition cursor-pointer space-y-2 group"
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold text-xs text-primary group-hover:text-accent transition">
                                {exp.name}
                              </span>
                              <span className="text-[10px] terminal-elevated text-secondary px-1.5 py-0.2 rounded font-mono font-bold">
                                {exp.symbol} • {exp.timeframe}
                              </span>
                            </div>
                            <span className="text-[10px] text-muted font-mono block mt-0.5">
                              {new Date(exp.timestamp).toLocaleDateString()} {new Date(exp.timestamp).toLocaleTimeString()}
                            </span>
                          </div>

                          <button
                            onClick={(e) => handleDeleteExperiment(exp.id, e)}
                            title="Delete from vault"
                            className="text-muted hover:text-rose-400 p-1 rounded transition opacity-0 group-hover:opacity-100"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        <div className="grid grid-cols-4 gap-2 text-center text-[11px] font-mono terminal-elevated p-2 rounded-lg">
                          <div>
                            <span className="text-muted block text-[9px]">NET PNL</span>
                            <span className={`font-bold ${exp.metrics.totalPnL >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
                              {exp.metrics.totalPnL >= 0 ? "+" : ""}${exp.metrics.totalPnL.toFixed(0)}
                            </span>
                          </div>
                          <div>
                            <span className="text-muted block text-[9px]">SHARPE</span>
                            <span className="font-bold text-primary">{exp.metrics.annualizedSharpe.toFixed(2)}</span>
                          </div>
                          <div>
                            <span className="text-muted block text-[9px]">WIN RATE</span>
                            <span className="font-bold text-primary">{exp.metrics.winRate}%</span>
                          </div>
                          <div>
                            <span className="text-muted block text-[9px]">TRADES</span>
                            <span className="font-bold text-secondary">{exp.metrics.totalTrades}</span>
                          </div>
                        </div>

                        <div className="flex items-center justify-between text-[10px] text-accent font-mono font-semibold pt-1">
                          <span>Stop ATR: {exp.parameters.stopAtrMultiplier}x • Hold: {exp.parameters.maxHoldBars}b</span>
                          <span className="flex items-center gap-1 group-hover:translate-x-0.5 transition-transform">
                            Restore to Studio <ArrowUpRight className="w-3 h-3" />
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* =========================================================================
          5. Institutional Pre-Flight Gate & Pool Deployment Modal
          ========================================================================= */}
      {isDeployModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-in fade-in duration-150 font-sans">
          <div className="terminal-card border border-border rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden font-mono">
            {/* Modal Header */}
            <div className="p-4 sm:p-5 border-b border-border flex items-center justify-between bg-elevated">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                  <Rocket className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-sm sm:text-base font-bold text-primary tracking-tight flex items-center gap-2">
                    PRE-FLIGHT EXECUTION GATE & POOL REGISTRATION
                  </h2>
                  <p className="text-xs text-secondary mt-0.5">
                    CBI MiFID II RTS-22 & López de Prado pre-trade validation for {symbol}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsDeployModalOpen(false)}
                className="text-secondary hover:text-primary transition-colors p-1.5 hover:bg-elevated rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 overflow-y-auto space-y-4 text-xs leading-relaxed max-h-[75vh]">
              {/* Strategy Specs Card */}
              <div className="terminal-elevated rounded-xl p-4 border border-border space-y-2">
                <div className="flex justify-between items-center border-b border-border pb-2">
                  <span className="font-bold text-primary text-sm flex items-center gap-2">
                    <span className="bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded border border-emerald-500/30">
                      {symbol}
                    </span>
                    <span>{timeframe} Calibrated Blueprint</span>
                  </span>
                  <span className="text-secondary text-[11px]">
                    Capital: ${capitalOverride.toLocaleString()}
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-[11px]">
                  <div>
                    <span className="text-muted block text-[10px]">STOP ATR</span>
                    <span className="font-bold text-primary">{stopAtr.toFixed(1)}x ATR</span>
                  </div>
                  <div>
                    <span className="text-muted block text-[10px]">HOLD BARS</span>
                    <span className="font-bold text-primary">{maxHoldBars} bars</span>
                  </div>
                  <div>
                    <span className="text-muted block text-[10px]">RISK BUDGET</span>
                    <span className="font-bold text-indigo-400">{(riskBudgetPct * 100).toFixed(2)}% ($r)</span>
                  </div>
                  <div>
                    <span className="text-muted block text-[10px]">OFI FILTER</span>
                    <span className="font-bold text-emerald-400">{ofiFilter ? "Active (1.4x)" : "Bypassed"}</span>
                  </div>
                </div>
              </div>

              {/* Pre-Flight Gate 1: Deflated Sharpe Ratio (DSR) */}
              {(() => {
                const currentDsr = Number(result?.deflatedSharpeRatio || 0) * 100;
                const passesDsr = currentDsr >= dsrHurdlePct;

                return (
                  <div className={`terminal-card rounded-xl p-4 border ${passesDsr ? "border-emerald-500/30 bg-emerald-500/5" : "border-amber-500/30 bg-amber-500/5"} space-y-2`}>
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        <Award className={`w-4 h-4 ${passesDsr ? "text-emerald-400" : "text-amber-400"}`} />
                        <span className="font-bold text-primary uppercase text-xs">
                          Gate 1: Deflated Sharpe Ratio (Selection Bias Penalty)
                        </span>
                      </div>
                      <span className={`px-2 py-0.5 rounded font-bold text-[10px] uppercase ${passesDsr ? "terminal-badge-bid" : "terminal-badge-warn"}`}>
                        {passesDsr ? "Passed DSR Hurdle" : "Sub-Hurdle Warning"}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-[11px] pt-1">
                      <span className="text-secondary">Strategy DSR (N=16 Permutations): <strong className="text-primary">{currentDsr.toFixed(1)}%</strong></span>
                      <span className="text-secondary">Selected Hurdle: <strong className="text-indigo-400">{dsrHurdlePct.toFixed(1)}%</strong></span>
                    </div>
                    <p className="text-[10px] text-muted leading-tight">
                      {passesDsr 
                        ? "Statistical test confirms with high confidence that strategy expectancy is not an artifact of data-snooping." 
                        : "Nominal Sharpe may be elevated by curve-fitting. Review out-of-sample persistence before high-capital deployment."}
                    </p>
                  </div>
                );
              })()}

              {/* Pre-Flight Gate 2: Transaction Friction Ceiling (Dual Control) */}
              {(() => {
                const currentFriction = result?.slippageFrictionSaved !== undefined
                  ? Number(result.slippageFrictionSaved)
                  : Number(result?.frictionPct || 10.0);
                const passesFriction = currentFriction <= deployFrictionCeiling;

                return (
                  <div className={`terminal-card rounded-xl p-4 border ${passesFriction ? "border-emerald-500/30 bg-emerald-500/5" : "border-rose-500/30 bg-rose-500/5"} space-y-3`}>
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        <Sliders className={`w-4 h-4 ${passesFriction ? "text-emerald-400" : "text-rose-400"}`} />
                        <span className="font-bold text-primary uppercase text-xs">
                          Gate 2: MiFID II Transaction Friction Ceiling
                        </span>
                      </div>
                      <span className={`px-2 py-0.5 rounded font-bold text-[10px] uppercase ${passesFriction ? "terminal-badge-bid" : "terminal-badge-ask"}`}>
                        {passesFriction ? "Passed Friction Gate" : "Exceeds Ceiling"}
                      </span>
                    </div>

                    <div className="flex justify-between items-center text-[11px]">
                      <span className="text-secondary">Projected Friction (Spread + 2x Comms): <strong className={passesFriction ? "text-emerald-400" : "text-rose-400"}>{currentFriction.toFixed(1)}%</strong></span>
                      <div className="flex items-center gap-2">
                        <span className="text-secondary">Enforced Ceiling:</span>
                        <input
                          type="number"
                          step="0.5"
                          min="2"
                          max="50"
                          value={deployFrictionCeiling}
                          onChange={(e) => setDeployFrictionCeiling(parseFloat(e.target.value) || 15.0)}
                          className="w-16 terminal-card border border-border rounded px-1.5 py-0.5 text-xs text-primary font-bold text-right"
                        />
                        <span className="text-secondary">%</span>
                      </div>
                    </div>

                    {/* Dual-Control Quick Action Snap Chip */}
                    {!passesFriction && (
                      <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/25 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-[11px]">
                        <span className="text-rose-300">
                          Current friction ({currentFriction.toFixed(1)}%) exceeds target ceiling ({deployFrictionCeiling.toFixed(1)}%).
                        </span>
                        <button
                          type="button"
                          onClick={() => setDeployFrictionCeiling(Math.ceil(currentFriction))}
                          className="px-2.5 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 font-bold transition cursor-pointer shrink-0 flex items-center gap-1"
                        >
                          <Zap className="w-3 h-3" />
                          <span>Snap Ceiling to {Math.ceil(currentFriction)}%</span>
                        </button>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Execution Pool & Sector Assignment */}
              <div className="space-y-1.5 pt-1">
                <label className="text-[10px] text-secondary uppercase font-bold block">
                  Target Candidate Execution Basket:
                </label>
                <input
                  type="text"
                  value={deploySector}
                  onChange={(e) => setDeploySector(e.target.value)}
                  placeholder="e.g. Calibrated Quant Strategy Basket"
                  className="w-full terminal-elevated border border-border rounded-lg px-3 py-2 text-xs text-primary focus:outline-hidden focus:border-emerald-500"
                />
                <span className="text-[9px] text-muted block">
                  Persisted to dynamic_baskets.json and synchronized via Direct TCP Bridge (Port 4005) to Frankfurt Spot VM.
                </span>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 bg-elevated border-t border-border flex items-center justify-between">
              <button
                type="button"
                onClick={() => setIsDeployModalOpen(false)}
                className="px-4 py-2 terminal-elevated hover:bg-elevated text-secondary hover:text-primary font-bold rounded-xl border border-border text-xs transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeployStrategy}
                disabled={isDeploying}
                className="px-5 py-2 bg-gradient-to-r from-emerald-600 to-indigo-600 hover:from-emerald-500 hover:to-indigo-500 text-white font-extrabold rounded-xl text-xs uppercase transition cursor-pointer flex items-center gap-2 shadow-lg shadow-emerald-950/30"
              >
                {isDeploying ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Rocket className="w-3.5 h-3.5" />}
                <span>{isDeploying ? "Deploying to Edge Node..." : "Confirm & Arm Execution Pool"}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4-Pillar Vault Credentials Modal */}
      <ApiVaultModal
        isOpen={isVaultOpen}
        onClose={() => setIsVaultOpen(false)}
        settings={vaultSettings}
        onSaveSetting={handleSaveSetting}
        onSaveMultipleSettings={handleSaveMultipleSettings}
      />
    </div>
  );
}

export default StrategyStudioPage;
