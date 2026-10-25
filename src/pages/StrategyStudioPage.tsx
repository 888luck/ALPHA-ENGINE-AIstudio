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
  AlertCircle
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

export function StrategyStudioPage() {
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
  const [symbol, setSymbol] = useState("ASML");
  const [customTickerInput, setCustomTickerInput] = useState("ASML");
  const [dynamicUniverse, setDynamicUniverse] = useState<Array<{ symbol: string; sector?: string }>>([
    { symbol: "ASML", sector: "Euronext Semiconductor Leader" },
    { symbol: "NVDA", sector: "AI Accelerated Compute" },
    { symbol: "SAP", sector: "DAX 40 Enterprise Cloud" },
    { symbol: "RWE", sector: "Euronext Clean Utilities" },
    { symbol: "XLE", sector: "Energy Sector SPDR" }
  ]);
  const [resolvedInfo, setResolvedInfo] = useState<any>(null);
  const [resolvingSymbol, setResolvingSymbol] = useState(false);

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

  // Active Strategy Details & Results
  const [strategyName, setStrategyName] = useState("Alpha Adaptive OFI Breakout");
  const [activeTab, setActiveTab] = useState<"performance" | "frontier" | "blotter" | "vault">("performance");
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
        "👋 Welcome to the **Institutional Strategy Studio & Experiment Vault**.\n\nI am your quantitative reasoning agent wired directly into:\n- 🔬 **Wald-Wolfowitz Runs & Hurst Exponent Analysis** (`run_quant_discovery`)\n- ⚡ **16-Parameter Optimization Sweeps** audited under López de Prado's Deflated Sharpe Ratio (`run_strategy_sweep`)\n- 🏛️ **Verified Broker History & Direct TCP Sockets** (`run_strategy_backtest`)\n- 🔒 **Deterministic Local Experiment Vault** (`save_strategy_to_vault` / `get_strategy_vault`)\n\nAsk me anything: *'Run a 16-parameter sweep on ASML'*, *'Analyze the Hurst regime for NVDA'*, or *'Test with $25k capital and 1.5 ATR stop'*.",
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
    resolveContractForSymbol(symbol);
  }, [symbol]);

  // Load dynamic universe
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
                if (!seen.has(t)) {
                  seen.add(t);
                  list.push({ symbol: t, sector: b.sector });
                }
              });
            });
            ["ASML", "NVDA", "SAP", "RWE", "XLE"].forEach((t) => {
              if (!seen.has(t)) {
                seen.add(t);
                list.push({ symbol: t, sector: "Core Dynamic Universe" });
              }
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
    `Run 16-parameter sweep on ${symbol}`,
    `Analyze Hurst exponent & regime for ${symbol}`,
    `Optimize with $25k capital and Deflated Sharpe hurdle`,
    `Run single simulation with 2.2 ATR stop and 20 hold bars`,
    `Preserve current strategy to Experiment Vault`
  ];

  return (
    <div className="space-y-6">
      {/* =========================================================================
          Top Navigation & Header Controls
          ========================================================================= */}
      <div className="bg-[#0c101c] border border-white/10 rounded-2xl p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-xl">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs bg-emerald-500/20 text-[#00ff88] border border-emerald-500/40 px-2.5 py-1 rounded-md font-mono font-bold flex items-center gap-1.5 shadow-sm">
              <Sparkles className="w-3.5 h-3.5 text-[#00ff88]" /> AGENTIC STRATEGY STUDIO
            </span>
            <span className="text-xs bg-blue-500/20 text-blue-300 border border-blue-500/30 px-2.5 py-1 rounded-md font-mono font-bold">
              VERIFIED BROKER BARS
            </span>
            <span className="text-xs text-slate-400 font-mono hidden sm:inline-block">
              Marcos López de Prado DSR (N=16) • Multi-Permutation Pareto Frontier
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black text-white font-mono mt-2 flex items-center gap-2">
            <SlidersHorizontal className="w-6 h-6 text-emerald-400" /> Quantitative Strategy Studio & Experiment Vault
          </h1>
          <p className="text-xs sm:text-sm text-slate-300 font-sans mt-0.5">
            Direct autonomous agents to discover high-expectancy trading configurations, run parameter sweeps, and preserve audited strategy backtests.
          </p>
        </div>

        {/* Top Control Plane: Model Dropdown + 4-Pillar Vault + Action Buttons */}
        <div className="flex items-center gap-2 flex-wrap w-full md:w-auto justify-end">
          {/* Dynamic Model Dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowModelDropdown(!showModelDropdown)}
              className="bg-slate-900 hover:bg-slate-800 border border-[#00ff88]/30 rounded-xl px-3 py-2 flex items-center gap-2 text-xs font-mono transition cursor-pointer shadow-md"
            >
              <span>{activeModelObj.icon}</span>
              <div className="text-left">
                <div className="text-[9px] text-[#00ff88] font-bold uppercase">{activeModelObj.provider}</div>
                <div className="text-white font-bold max-w-[150px] truncate">{activeModelObj.name}</div>
              </div>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 ml-1" />
            </button>

            {showModelDropdown && (
              <>
                {/* Backdrop to close on outside click */}
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setShowModelDropdown(false)}
                />

                <div className="absolute right-0 mt-2 w-[420px] max-w-[90vw] bg-[#0e1422] border border-white/15 rounded-xl shadow-2xl p-3 z-50 animate-in fade-in zoom-in-95 font-mono text-xs">
                  {/* Catalog Header */}
                  <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-white/10 mb-2 flex items-center justify-between">
                    <span>Dynamic Model Catalog</span>
                    <span className="text-[9px] text-[#00ff88] bg-[#00ff88]/10 px-1.5 py-0.5 rounded border border-[#00ff88]/20 font-bold">
                      {availableModels.length} Active Verified
                    </span>
                  </div>

                  {/* Instant Search Bar */}
                  <div className="relative mb-2">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={modelSearchQuery}
                      onChange={(e) => setModelSearchQuery(e.target.value)}
                      placeholder="Search model name, provider, or size..."
                      className="w-full bg-slate-900 border border-white/10 rounded-lg pl-8 pr-7 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#00ff88]/50"
                    />
                    {modelSearchQuery && (
                      <button
                        type="button"
                        onClick={() => setModelSearchQuery("")}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Provider Filter Tabs */}
                  <div className="flex items-center gap-1 mb-2 pb-2 border-b border-white/10 overflow-x-auto text-[10px]">
                    {["ALL", "FREE", "OPENROUTER", "GROQ", "NVIDIA", "GOOGLE", "LOCAL"].map((tab) => {
                      const count = tab === "ALL" 
                        ? availableModels.length 
                        : tab === "FREE"
                          ? availableModels.filter(m => m.isFree === true || m.id.includes(":free") || m.costStr.includes("$0.00") || m.id.startsWith("local")).length
                          : availableModels.filter(m => m.id.toUpperCase().startsWith(tab) || m.provider.toUpperCase().includes(tab)).length;
                      return (
                        <button
                          key={tab}
                          type="button"
                          onClick={() => setSelectedProviderFilter(tab)}
                          className={`px-2 py-0.5 rounded transition cursor-pointer font-bold whitespace-nowrap flex items-center gap-1 ${
                            selectedProviderFilter === tab
                              ? tab === "FREE"
                                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                                : "bg-[#00ff88]/20 text-[#00ff88] border border-[#00ff88]/40"
                              : "bg-white/5 hover:bg-white/10 text-slate-400"
                          }`}
                        >
                          <span>{tab === "FREE" ? "🎁 FREE ONLY" : tab}</span>
                          <span className="text-[9px] opacity-75">({count})</span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Fast Access / Recommended Section (When No Search Query) */}
                  {!modelSearchQuery.trim() && selectedProviderFilter === "ALL" && (
                    <div className="mb-2 pb-2 border-b border-white/10 space-y-1">
                      <div className="text-[10px] font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1 px-1">
                        <span>⭐</span>
                        <span>Recommended & Tested Active</span>
                      </div>
                      <div className="grid grid-cols-2 gap-1.5">
                        {(() => {
                          const configured = availableModels.filter(m => isModelConfigured(m));
                          const unconfigured = availableModels.filter(m => !isModelConfigured(m));
                          return (configured.length >= 4 ? configured.slice(0, 4) : [...configured, ...unconfigured].slice(0, 4));
                        })().map(m => {
                          const isConfigured = isModelConfigured(m);
                          return (
                            <button
                              key={`rec-${m.id}`}
                              type="button"
                              onClick={() => {
                                setSelectedModel(m.id);
                                localStorage.setItem("alpha_copilot_model", m.id);
                                setShowModelDropdown(false);
                              }}
                              className={`p-1.5 rounded-lg border text-left flex items-center gap-1.5 transition cursor-pointer ${
                                selectedModel === m.id
                                  ? "bg-[#00ff88]/20 border-[#00ff88] text-white"
                                  : isConfigured
                                  ? "bg-white/5 hover:bg-white/10 border-white/10 text-slate-300"
                                  : "bg-white/5 hover:bg-white/10 border-amber-500/20 text-slate-400 opacity-80"
                              }`}
                            >
                              <span className="text-xs">{m.icon}</span>
                              <div className="truncate min-w-0 flex-1">
                                <div className="text-[10px] font-bold truncate text-white flex items-center justify-between">
                                  <span className="truncate">{m.name.split("/").pop()}</span>
                                  {isConfigured ? (
                                    <span className="text-[8px] bg-emerald-500/20 text-[#00ff88] border border-emerald-500/40 px-1 py-0.2 rounded font-mono font-bold shrink-0 ml-1">READY</span>
                                  ) : (
                                    <span className="text-[8px] bg-amber-500/10 text-amber-300 border border-amber-500/30 px-1 py-0.2 rounded font-mono font-medium shrink-0 ml-1">KEY REQ</span>
                                  )}
                                </div>
                                <div className="text-[9px] text-[#00ff88]">{m.badge}</div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Scrollable Model List */}
                  <div className="max-h-72 overflow-y-auto space-y-1 pr-1">
                    {filteredModels.length === 0 ? (
                      <div className="text-center py-6 text-slate-400 text-xs">
                        No models matching "{modelSearchQuery}"
                      </div>
                    ) : (
                      filteredModels.map((m) => {
                        const isConfigured = isModelConfigured(m);
                        return (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => {
                              setSelectedModel(m.id);
                              localStorage.setItem("alpha_copilot_model", m.id);
                              setShowModelDropdown(false);
                              setModelSearchQuery("");
                            }}
                            className={`w-full text-left p-2 rounded-lg flex items-start gap-2.5 transition cursor-pointer ${
                              selectedModel === m.id
                                ? "bg-[#00ff88]/15 border border-[#00ff88]/40 text-white"
                                : isConfigured
                                ? "hover:bg-white/5 text-slate-300"
                                : "hover:bg-white/5 text-slate-400 opacity-80"
                            }`}
                          >
                            <span className="text-base shrink-0">{m.icon}</span>
                            <div className="flex-1 min-w-0">
                              <div className="font-bold text-white truncate flex items-center justify-between">
                                <span className="truncate" title={m.name}>{m.name}</span>
                                <div className="flex items-center gap-1.5 shrink-0 ml-2">
                                  {isConfigured ? (
                                    <span className="text-[9px] bg-emerald-500/20 text-[#00ff88] border border-emerald-500/40 px-1.5 py-0.2 rounded font-mono font-bold flex items-center gap-1">
                                      <span className="w-1.5 h-1.5 rounded-full bg-[#00ff88]" /> KEY ACTIVE
                                    </span>
                                  ) : (
                                    <span className="text-[9px] bg-amber-500/10 text-amber-300 border border-amber-500/30 px-1.5 py-0.2 rounded font-mono font-medium">
                                      NEEDS KEY
                                    </span>
                                  )}
                                  {(m.isFree || m.id.includes(":free")) && (
                                    <span className="text-[9px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-1.5 py-0.2 rounded font-mono font-bold">
                                      FREE
                                    </span>
                                  )}
                                  {selectedModel === m.id && <Check className="w-3.5 h-3.5 text-[#00ff88] shrink-0" />}
                                </div>
                              </div>
                              <div className="text-[10px] text-slate-400 flex items-center gap-1.5 mt-0.5">
                                <span className="text-indigo-400 font-bold">{m.provider}</span>
                                <span>•</span>
                                <span className="text-slate-300">{m.costStr}</span>
                              </div>
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

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
        </div>
      </div>

      {saveSuccessMsg && (
        <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-xs text-[#00ff88] font-mono flex items-center gap-2 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-[#00ff88]" />
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
        <div className="lg:col-span-5 bg-[#0c101c] border border-white/10 rounded-2xl flex flex-col h-[760px] shadow-xl overflow-hidden">
          {/* Chat Header */}
          <div className="p-4 border-b border-white/10 bg-slate-900/60 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center">
                <Bot className="w-4 h-4 text-[#00ff88]" />
              </div>
              <div>
                <span className="text-xs font-mono font-bold text-white block">STRATEGY OPTIMIZER AGENT</span>
                <span className="text-[10px] font-mono text-emerald-400 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
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
                  <RefreshCw className="w-3 h-3 animate-spin text-[#00ff88]" /> Invoking Tool:
                </span>
                {activeTools.map((t, idx) => (
                  <span key={idx} className="text-[10px] bg-emerald-500/20 text-[#00ff88] border border-emerald-500/40 px-2 py-0.5 rounded font-mono font-bold">
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
                      isAgent ? "bg-emerald-500/20 text-[#00ff88]" : "bg-indigo-600 text-white"
                    }`}
                  >
                    {isAgent ? <Bot className="w-3.5 h-3.5" /> : <span className="font-bold text-[10px]">YOU</span>}
                  </div>
                  <div
                    className={`p-3.5 rounded-2xl max-w-[85%] leading-relaxed ${
                      isAgent
                        ? "bg-slate-900/80 border border-white/10 text-slate-200"
                        : "bg-indigo-600 text-white shadow-md shadow-indigo-600/20"
                    }`}
                  >
                    <div className="whitespace-pre-wrap font-mono">{m.content || "..."}</div>
                    {m.isTruncated && (
                      <div className="mt-2.5 pt-2 border-t border-white/10 flex items-center justify-between gap-2">
                        <span className="text-[10px] text-amber-400 font-mono flex items-center gap-1">
                          <AlertCircle className="w-3 h-3 text-amber-400 shrink-0" />
                          Reached 4,096-token ceiling.
                        </span>
                        <button
                          type="button"
                          onClick={handleContinueChat}
                          disabled={isGenerating}
                          className="px-2 py-0.5 rounded bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-[10px] text-[#00ff88] font-bold cursor-pointer flex items-center gap-1 transition"
                        >
                          <Play className="w-2.5 h-2.5" /> Continue
                        </button>
                      </div>
                    )}
                    <span className="text-[10px] opacity-40 block mt-1.5 text-right font-sans">{m.timestamp}</span>
                  </div>
                </div>
              );
            })}
            {(sweeping || discovering) && (
              <div className="flex gap-3 items-start animate-in fade-in">
                <div className="w-6 h-6 rounded-md bg-emerald-500/20 text-[#00ff88] flex items-center justify-center shrink-0 mt-0.5">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                </div>
                <div className="p-3 rounded-2xl bg-slate-900/80 border border-emerald-500/30 text-emerald-300 font-mono text-xs">
                  {sweeping ? "Executing 16-parameter sweep across verified broker bars..." : "Computing Wald-Wolfowitz & Hurst exponent..."}
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Quick Action Chips */}
          <div className="px-4 py-2 bg-black/40 border-t border-white/5 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            {quickChips.map((chip, idx) => (
              <button
                key={idx}
                onClick={() => {
                  setChatInput(chip);
                }}
                disabled={isGenerating}
                className="whitespace-nowrap px-2.5 py-1 rounded-md bg-white/5 hover:bg-emerald-500/20 hover:border-emerald-500/40 border border-white/10 text-[11px] font-mono text-slate-300 hover:text-[#00ff88] transition cursor-pointer shrink-0"
              >
                {chip}
              </button>
            ))}
          </div>

          {/* Chat Input Bar */}
          <form onSubmit={handleSendChat} className="p-3 bg-slate-950 border-t border-white/10 flex gap-2">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="Direct agent (e.g. Run 16-parameter sweep on ASML)..."
              disabled={isGenerating}
              className="flex-1 bg-black/70 border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono placeholder-slate-500 focus:outline-none focus:border-emerald-500"
            />
            <button
              type="submit"
              disabled={isGenerating || !chatInput.trim()}
              className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white px-4 py-2.5 rounded-xl transition cursor-pointer flex items-center justify-center shadow-lg shadow-emerald-600/20"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>

        {/* Right Column: Tactical Parameters & Results Visualizer */}
        <div className="lg:col-span-7 space-y-5">
          {/* Parameter Tuning Controls */}
          <div className="bg-[#0c101c] border border-white/10 rounded-2xl p-5 space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <span className="text-xs font-mono uppercase font-bold text-slate-200 flex items-center gap-2">
                <Sliders className="w-4 h-4 text-emerald-400" /> Strategy Parameter & Friction Controls
              </span>
              <span className="text-xs text-slate-400 font-mono">Calibrated against IBKR Europe Rates</span>
            </div>

            {/* Selector Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              {/* Dynamic Ticker Resolution */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] text-slate-300 uppercase font-mono font-bold">
                    Ticker (Dynamic)
                  </label>
                  {resolvingSymbol ? (
                    <span className="text-[10px] text-emerald-400 font-mono animate-pulse">Resolving...</span>
                  ) : resolvedInfo ? (
                    <span className="text-[10px] text-[#00ff88] font-mono font-semibold truncate max-w-[120px]">
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
                        if (customTickerInput.trim()) {
                          const s = customTickerInput.trim().toUpperCase();
                          setSymbol(s);
                          resolveContractForSymbol(s);
                        }
                      }
                    }}
                    onBlur={() => {
                      if (customTickerInput.trim() && customTickerInput.trim().toUpperCase() !== symbol) {
                        const s = customTickerInput.trim().toUpperCase();
                        setSymbol(s);
                        resolveContractForSymbol(s);
                      }
                    }}
                    placeholder="Ticker (e.g. ASML)..."
                    className="flex-1 bg-slate-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono uppercase font-bold focus:outline-none focus:border-emerald-500"
                  />
                  <select
                    value={symbol}
                    onChange={(e) => {
                      setSymbol(e.target.value);
                      setCustomTickerInput(e.target.value);
                      resolveContractForSymbol(e.target.value);
                    }}
                    className="w-24 bg-slate-900 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-emerald-500 font-bold"
                  >
                    {dynamicUniverse.map((u) => (
                      <option key={u.symbol} value={u.symbol}>
                        {u.symbol}
                      </option>
                    ))}
                    {!dynamicUniverse.some((u) => u.symbol === symbol) && (
                      <option value={symbol}>{symbol}</option>
                    )}
                  </select>
                </div>
              </div>

              {/* Timeframe */}
              <div>
                <label className="text-[11px] text-slate-300 uppercase font-mono font-bold block mb-1">Timeframe</label>
                <select
                  value={timeframe}
                  onChange={(e) => setTimeframe(e.target.value)}
                  className="w-full bg-slate-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-emerald-500 font-bold"
                >
                  <option value="5m">5 Min (Microstructure)</option>
                  <option value="15m">15 Min (Intraday Drift)</option>
                  <option value="1h">1 Hour (Session Swing)</option>
                </select>
              </div>

              {/* Starting Capital */}
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-[11px] text-slate-300 uppercase font-mono font-bold">Capital ($)</label>
                  <span className="text-xs text-emerald-400 font-mono font-bold">${capitalOverride.toLocaleString()}</span>
                </div>
                <div className="flex items-center gap-1 mb-1">
                  {[5000, 25000, 100000].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setCapitalOverride(preset)}
                      className={`flex-1 py-0.5 rounded text-[10px] font-mono cursor-pointer transition ${
                        capitalOverride === preset
                          ? "bg-emerald-500/30 text-[#00ff88] border border-emerald-500/50 font-bold"
                          : "bg-white/5 text-slate-400 hover:text-white border border-white/5"
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
                  className="w-full bg-slate-900 border border-white/10 rounded-lg px-2.5 py-1 text-xs text-white font-mono focus:outline-none focus:border-emerald-500"
                />
              </div>

              {/* Stop ATR */}
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-[11px] text-slate-300 uppercase font-mono font-bold">Stop ATR</label>
                  <span className="text-xs text-emerald-400 font-mono font-bold">{stopAtr.toFixed(1)}x</span>
                </div>
                <input
                  type="range"
                  min="0.8"
                  max="3.5"
                  step="0.1"
                  value={stopAtr}
                  onChange={(e) => setStopAtr(parseFloat(e.target.value))}
                  className="w-full accent-emerald-500 cursor-pointer mt-2"
                />
              </div>

              {/* Max Hold */}
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-[11px] text-slate-300 uppercase font-mono font-bold">Max Hold</label>
                  <span className="text-xs text-cyan-400 font-mono font-bold">{maxHoldBars} bars</span>
                </div>
                <input
                  type="range"
                  min="5"
                  max="40"
                  step="1"
                  value={maxHoldBars}
                  onChange={(e) => setMaxHoldBars(parseInt(e.target.value, 10))}
                  className="w-full accent-cyan-500 cursor-pointer mt-2"
                />
              </div>
            </div>

            {/* Friction Gating Checkboxes */}
            <div className="flex flex-wrap items-center gap-4 pt-2 border-t border-white/5 text-xs font-mono">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={partialProfit}
                  onChange={(e) => setPartialProfit(e.target.checked)}
                  className="rounded bg-black border-white/20 text-emerald-500 focus:ring-0"
                />
                <span className="text-slate-300 font-semibold">Tranche Scaling (50% @ 2.5 ATR)</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={breakevenLock}
                  onChange={(e) => setBreakevenLock(e.target.checked)}
                  className="rounded bg-black border-white/20 text-emerald-500 focus:ring-0"
                />
                <span className="text-slate-300 font-semibold">Breakeven Ratchet (+1.0 ATR)</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={adaptiveStop}
                  onChange={(e) => setAdaptiveStop(e.target.checked)}
                  className="rounded bg-black border-white/20 text-emerald-500 focus:ring-0"
                />
                <span className="text-slate-300 font-semibold">Adaptive Stop Cushion</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={ofiFilter}
                  onChange={(e) => setOfiFilter(e.target.checked)}
                  className="rounded bg-black border-white/20 text-emerald-500 focus:ring-0"
                />
                <span className="text-slate-300 font-semibold">OFI Imbalance Gate (1.4x)</span>
              </label>
            </div>
          </div>

          {/* Results Tab Navigation (Performance / Pareto Frontier / Blotter / Vault) */}
          <div className="bg-[#0c101c] border border-white/10 rounded-2xl p-5 space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-white/10 pb-3 flex-wrap gap-2">
              <div className="flex items-center gap-2 bg-black/60 p-1 rounded-xl border border-white/10 text-xs font-mono flex-wrap">
                <button
                  onClick={() => setActiveTab("performance")}
                  className={`px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 font-bold cursor-pointer ${
                    activeTab === "performance" ? "bg-emerald-600 text-white shadow" : "text-slate-400 hover:text-white"
                  }`}
                >
                  <TrendingUp className="w-3.5 h-3.5" /> Performance & Curve
                </button>
                <button
                  onClick={() => setActiveTab("frontier")}
                  className={`px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 font-bold cursor-pointer ${
                    activeTab === "frontier" ? "bg-emerald-600 text-white shadow" : "text-slate-400 hover:text-white"
                  }`}
                >
                  <Zap className="w-3.5 h-3.5 text-amber-400" /> Pareto Frontier ({sweepCandidates.length || 0})
                </button>
                <button
                  onClick={() => setActiveTab("blotter")}
                  className={`px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 font-bold cursor-pointer ${
                    activeTab === "blotter" ? "bg-emerald-600 text-white shadow" : "text-slate-400 hover:text-white"
                  }`}
                >
                  <Activity className="w-3.5 h-3.5" /> Trade Blotter ({result?.tradesList?.length || 0})
                </button>
                <button
                  onClick={() => setActiveTab("vault")}
                  className={`px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 font-bold cursor-pointer ${
                    activeTab === "vault" ? "bg-indigo-600 text-white shadow" : "text-slate-400 hover:text-white"
                  }`}
                >
                  <FolderOpen className="w-3.5 h-3.5" /> Saved Vault ({vault.length})
                </button>
              </div>

              {result && (
                <span className="text-xs font-mono font-bold text-slate-300 truncate max-w-[200px]">
                  {strategyName}
                </span>
              )}
            </div>

            {/* =========================================================================
                TAB 1: Performance Curve & League Table
                ========================================================================= */}
            {activeTab === "performance" && result && (
              <div className="space-y-4 animate-in fade-in duration-200">
                {/* Metric Badges */}
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2.5 text-center font-mono text-xs">
                  <div className="bg-black/50 p-3 rounded-xl border border-white/5">
                    <span className="text-[10px] text-slate-400 block uppercase font-semibold">Net PnL</span>
                    <span className={`font-bold text-base mt-1 block ${
                      (Number(result.totalPnL || 0)) >= 0 ? "text-[#00ff88]" : "text-rose-400"
                    }`}>
                      {(Number(result.totalPnL || 0)) >= 0 ? "+" : ""}${Number(result.totalPnL || 0).toFixed(2)}
                    </span>
                    <span className="text-[10px] text-slate-500">({result.totalPnLPercent || "0.0"}%)</span>
                  </div>

                  <div className="bg-black/50 p-3 rounded-xl border border-white/5">
                    <span className="text-[10px] text-slate-400 block uppercase font-semibold">Annual Sharpe</span>
                    <span className="font-bold text-base text-[#00ff88] mt-1 block">
                      {result.annualizedSharpe !== undefined ? result.annualizedSharpe : "0.00"}
                    </span>
                    <span className="text-[10px] text-slate-500">Roll-adjusted</span>
                  </div>

                  <div className="bg-black/50 p-3 rounded-xl border border-white/5">
                    <span className="text-[10px] text-slate-400 block uppercase font-semibold">Deflated Sharpe</span>
                    <span className={`font-bold text-base mt-1 block ${
                      result.passesDsrHurdle ? "text-[#00ff88]" : "text-amber-400"
                    }`}>
                      {result.deflatedSharpeRatio !== undefined ? `${(Number(result.deflatedSharpeRatio) * 100).toFixed(1)}%` : "N/A"}
                    </span>
                    <span className="text-[10px] text-slate-500">{result.passesDsrHurdle ? "✓ DSR ≥ 95%" : "⚠️ Sub-hurdle"}</span>
                  </div>

                  <div className="bg-black/50 p-3 rounded-xl border border-white/5">
                    <span className="text-[10px] text-slate-400 block uppercase font-semibold">Win Rate</span>
                    <span className="font-bold text-base text-white mt-1 block">
                      {result.winRate !== undefined ? result.winRate : "0.0"}%
                    </span>
                    <span className="text-[10px] text-slate-500">{result.winningTrades || 0}W / {result.losingTrades || 0}L</span>
                  </div>

                  <div className="bg-black/50 p-3 rounded-xl border border-white/5">
                    <span className="text-[10px] text-slate-400 block uppercase font-semibold">Profit Factor</span>
                    <span className="font-bold text-base text-cyan-400 mt-1 block">
                      {result.profitFactor !== undefined ? result.profitFactor : "1.00"}
                    </span>
                    <span className="text-[10px] text-slate-500">Gross W/L Ratio</span>
                  </div>

                  <div className="bg-black/50 p-3 rounded-xl border border-white/5">
                    <span className="text-[10px] text-slate-400 block uppercase font-semibold">Max Drawdown</span>
                    <span className="font-bold text-base text-rose-400 mt-1 block">
                      -{result.maxDrawdownPercent !== undefined ? result.maxDrawdownPercent : "0.0"}%
                    </span>
                    <span className="text-[10px] text-slate-500">Peak-to-trough</span>
                  </div>
                </div>

                {/* Equity Curve */}
                <div className="bg-black/50 border border-white/10 rounded-xl p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono font-bold text-slate-200 uppercase flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-emerald-400" /> Compounded Equity Trajectory ({result.symbol || symbol})
                    </span>
                    <span className="text-xs font-mono text-slate-400">
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
                  <div className="bg-black/50 border border-cyan-500/30 rounded-xl p-4 space-y-2 font-mono text-xs">
                    <div className="flex items-center justify-between border-b border-white/10 pb-2">
                      <span className="font-bold text-cyan-300 flex items-center gap-2">
                        <Activity className="w-4 h-4 text-cyan-400" /> Empirical Microstructure Analysis ({discoveryData.symbol})
                      </span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        discoveryData.regime === "PERSISTENT_TRENDING" ? "bg-emerald-500/20 text-[#00ff88]" :
                        discoveryData.regime === "MEAN_REVERTING" ? "bg-amber-500/20 text-amber-300" :
                        "bg-slate-700 text-slate-300"
                      }`}>
                        {discoveryData.regime}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-3 pt-1 text-center">
                      <div className="bg-slate-900/80 p-2 rounded-lg">
                        <span className="text-[10px] text-slate-400 block">HURST EXPONENT (H)</span>
                        <span className="font-bold text-emerald-400 text-sm">
                          {Number(discoveryData.quant_discovery?.hurst_exponent?.hurst_exponent || 0.5).toFixed(3)}
                        </span>
                      </div>
                      <div className="bg-slate-900/80 p-2 rounded-lg">
                        <span className="text-[10px] text-slate-400 block">RUNS TEST (Z-SCORE)</span>
                        <span className="font-bold text-cyan-400 text-sm">
                          {Number(discoveryData.quant_discovery?.runs_test?.z_score || 0).toFixed(2)}
                        </span>
                      </div>
                      <div className="bg-slate-900/80 p-2 rounded-lg">
                        <span className="text-[10px] text-slate-400 block">MARKOV P(UP|UP)</span>
                        <span className="font-bold text-white text-sm">
                          {(Number(discoveryData.quant_discovery?.markov_transitions?.transition_matrix?.up_to_up || 0.5) * 100).toFixed(1)}%
                        </span>
                      </div>
                    </div>
                    <p className="text-[11px] text-slate-300 font-sans italic pt-1">{discoveryData.guidance}</p>
                  </div>
                )}

                {/* Pareto Candidates Table */}
                <div className="bg-black/40 border border-white/5 rounded-xl p-4 space-y-3 font-mono text-xs">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <span className="font-bold uppercase text-slate-200 flex items-center gap-2">
                      <Zap className="w-4 h-4 text-amber-400" /> Multi-Permutation Candidates Matrix ({sweepCandidates.length} Trials Tested)
                    </span>
                    <span className="text-[11px] text-slate-400">
                      Selection Bias Penalty: N={sweepCandidates.length || 16} • Click any row to load
                    </span>
                  </div>

                  {sweepCandidates.length === 0 ? (
                    <div className="py-12 text-center text-xs text-slate-500">
                      No sweep completed yet. Click <strong>16-TRIAL SWEEP</strong> above or direct the agent: <em>"Run 16-parameter sweep on {symbol}"</em>.
                    </div>
                  ) : (
                    <div className="overflow-x-auto max-h-96">
                      <table className="w-full text-left">
                        <thead className="sticky top-0 bg-slate-900 border-b border-white/10 text-slate-400">
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
                                  c.passesDsrHurdle ? "text-[#00ff88]" : "text-amber-400"
                                }`}>
                                  {(Number(c.deflatedSharpeRatio || 0) * 100).toFixed(1)}%
                                </td>
                                <td className="py-2 px-2 text-right text-rose-400">-{c.maxDrawdownPercent}%</td>
                                <td className={`py-2 px-2 text-right font-bold ${
                                  Number(c.totalPnL || 0) >= 0 ? "text-[#00ff88]" : "text-rose-400"
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
                      <thead className="sticky top-0 bg-slate-900 border-b border-white/10 text-slate-400">
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
                      <tbody className="divide-y divide-white/5">
                        {result.tradesList.map((tr: any) => {
                          const isWin = Number(tr.realizedPnL || 0) >= 0;
                          return (
                            <tr key={tr.id} className="hover:bg-white/5 transition">
                              <td className="py-2 px-3 font-semibold text-slate-300">{tr.id}</td>
                              <td className="py-2 px-3 text-slate-400">{tr.date}</td>
                              <td className="py-2 px-3">
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                  tr.direction === "BUY" ? "bg-emerald-500/20 text-[#00ff88]" : "bg-rose-500/20 text-rose-400"
                                }`}>
                                  {tr.direction}
                                </span>
                              </td>
                              <td className="py-2 px-3 text-right text-slate-300">{tr.quantity}</td>
                              <td className="py-2 px-3 text-right text-slate-300">${Number(tr.entryPrice).toFixed(2)}</td>
                              <td className="py-2 px-3 text-right text-slate-300">${Number(tr.exitPrice).toFixed(2)}</td>
                              <td className="py-2 px-3 text-slate-400">
                                <span className="bg-slate-800 text-slate-300 px-1.5 py-0.5 rounded text-[10px]">
                                  {tr.reason}
                                </span>
                              </td>
                              <td className="py-2 px-3 text-right text-slate-400">${Number(tr.commission || 0).toFixed(2)}</td>
                              <td className={`py-2 px-3 text-right font-bold ${isWin ? "text-[#00ff88]" : "text-rose-400"}`}>
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
                <div className="flex items-center justify-between pb-2 border-b border-white/5">
                  <span className="text-xs font-mono font-bold text-white uppercase flex items-center gap-2">
                    <FolderOpen className="w-4 h-4 text-indigo-400" /> Preserved Strategy Experiment Vault ({vault.length} Audited Records)
                  </span>
                  <span className="text-xs font-mono text-slate-400">Deterministic Local Atomic Engine (Rule 9)</span>
                </div>

                {vault.length === 0 ? (
                  <div className="py-12 text-center text-xs text-slate-500 font-mono">
                    No strategies saved yet. Run a simulation or parameter sweep, then click "SAVE".
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-96 overflow-y-auto">
                    {vault.map((exp) => (
                      <div
                        key={exp.id}
                        onClick={() => handleLoadExperiment(exp)}
                        className="p-3.5 rounded-xl border border-white/10 bg-black/40 hover:border-indigo-500/40 hover:bg-slate-900/60 transition cursor-pointer space-y-2 group"
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold text-xs text-white group-hover:text-indigo-300 transition">
                                {exp.name}
                              </span>
                              <span className="text-[10px] bg-slate-800 text-slate-300 px-1.5 py-0.2 rounded font-mono font-bold">
                                {exp.symbol} • {exp.timeframe}
                              </span>
                            </div>
                            <span className="text-[10px] text-slate-500 font-mono block mt-0.5">
                              {new Date(exp.timestamp).toLocaleDateString()} {new Date(exp.timestamp).toLocaleTimeString()}
                            </span>
                          </div>

                          <button
                            onClick={(e) => handleDeleteExperiment(exp.id, e)}
                            title="Delete from vault"
                            className="text-slate-500 hover:text-rose-400 p-1 rounded transition opacity-0 group-hover:opacity-100"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        <div className="grid grid-cols-4 gap-2 text-center text-[11px] font-mono bg-black/30 p-2 rounded-lg border border-white/5">
                          <div>
                            <span className="text-slate-500 block text-[9px]">NET PNL</span>
                            <span className={`font-bold ${exp.metrics.totalPnL >= 0 ? "text-[#00ff88]" : "text-rose-400"}`}>
                              {exp.metrics.totalPnL >= 0 ? "+" : ""}${exp.metrics.totalPnL.toFixed(0)}
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-500 block text-[9px]">SHARPE</span>
                            <span className="font-bold text-white">{exp.metrics.annualizedSharpe.toFixed(2)}</span>
                          </div>
                          <div>
                            <span className="text-slate-500 block text-[9px]">WIN RATE</span>
                            <span className="font-bold text-white">{exp.metrics.winRate}%</span>
                          </div>
                          <div>
                            <span className="text-slate-500 block text-[9px]">TRADES</span>
                            <span className="font-bold text-slate-300">{exp.metrics.totalTrades}</span>
                          </div>
                        </div>

                        <div className="flex items-center justify-between text-[10px] text-indigo-400 font-mono font-semibold pt-1">
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
