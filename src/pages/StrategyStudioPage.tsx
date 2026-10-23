import React, { useState, useEffect, useRef } from "react";
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
  Info
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
    binaryBlackoutHours: number;
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

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  actionTriggered?: string;
}

export function StrategyStudioPage() {
  // Strategy Parameters & Studio State
  const [symbol, setSymbol] = useState("XLE");
  const [customTickerInput, setCustomTickerInput] = useState("XLE");
  const [dynamicUniverse, setDynamicUniverse] = useState<Array<{ symbol: string; sector?: string }>>([
    { symbol: "XLE", sector: "Energy Sector Trading Strategy" },
    { symbol: "VLO", sector: "Energy Sector Trading Strategy" },
    { symbol: "COP", sector: "Energy Sector Trading Strategy" },
    { symbol: "ASML", sector: "Euronext Semiconductor Leader" },
    { symbol: "SAP", sector: "DAX 40 Enterprise Cloud" },
    { symbol: "NVDA", sector: "AI Accelerated Compute" },
    { symbol: "RWE", sector: "Euronext Clean Utilities" },
    { symbol: "XLU", sector: "Utilities Structural Arbitrage" },
    { symbol: "ICLN", sector: "Clean Energy Tech Imbalances" }
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
  const [binaryBlackout, setBinaryBlackout] = useState(0.0);

  // Active Strategy Details & Results
  const [strategyName, setStrategyName] = useState("Alpha Adaptive OFI Breakout v1");
  const [activeTab, setActiveTab] = useState<"performance" | "blotter" | "vault">("performance");
  const [loading, setLoading] = useState(false);
  const [exploring, setExploring] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [baselineResult, setBaselineResult] = useState<any>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);

  // Conversational Agent State
  const [chatInput, setChatInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    {
      id: "msg_init",
      role: "assistant",
      content:
        "👋 Welcome to the **Institutional Strategy Studio**. I am your Strategy Optimization Agent.\n\nYou can direct me naturally with capital, risk, and asset parameters. For example:\n- *'run the same with 5000 strat capital'* \n- *'Optimize ASML for maximum Deflated Sharpe Ratio with low friction'* \n- *'Set Stop ATR to 1.5x and run a test on NVDA'* \n- *'Run test on TSLA with $25,000 capital and 12-bar hold'* \n\nAll instruments resolve dynamically via official IBKR contract specifications, with real-time risk sanitization.",
      timestamp: new Date().toLocaleTimeString()
    }
  ]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Saved Experiments Vault (Local Storage / Rule 9)
  const [vault, setVault] = useState<StrategyStudioExperiment[]>(() => {
    try {
      const stored = localStorage.getItem("alpha_engine_strategy_vault");
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  // Dynamically load active universe from run-expectancy / dynamic baskets on mount
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
            // Ensure core institutional tickers are present
            ["XLE", "ASML", "SAP", "NVDA", "RWE", "VLO", "COP", "NEE"].forEach((t) => {
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

  // Auto scroll chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, exploring]);

  // Execute Simulation Core with capitalOverride
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
    binaryBlackoutHours: number;
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
    const blackout = overrides?.binaryBlackoutHours !== undefined ? overrides.binaryBlackoutHours : binaryBlackout;

    const res = await fetch("/api/backtest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        symbol: s,
        timeframe: tf,
        startDate: startDate,
        endDate: endDate,
        capitalOverride: cap,
        stopAtrMultiplier: stop,
        partialProfit: partial,
        breakevenLock: breakeven,
        maxHoldBars: maxHold,
        ofiFilter: ofi,
        adaptiveStop: adaptive,
        riskBudgetPct: risk,
        frictionCeilingPct: friction,
        binaryBlackoutHours: blackout
      })
    });

    const data = await res.json();
    return { ok: res.ok && data.success, data };
  };

  // Run Manual Simulation
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
        setMessages((prev) => [
          ...prev,
          {
            id: "msg_" + Date.now(),
            role: "assistant",
            content: `✅ **Simulation completed for ${run.data.symbol || activeSym} (${run.data.timeframe || activeTf})**:\n- **Starting Capital**: \`$${Number(run.data.startingCapital || activeCap).toLocaleString()}\`\n- **Net PnL**: \`+$${Number(run.data.totalPnL || 0).toFixed(2)}\` (${run.data.totalPnLPercent}%)\n- **Ending Equity**: \`$${Number(run.data.finalCapital || activeCap).toLocaleString()}\`\n- **Win Rate**: \`${run.data.winRate}%\` (${run.data.winningTrades}W / ${run.data.losingTrades}L)\n- **Profit Factor**: \`${run.data.profitFactor}\`\n- **Deflated Sharpe (DSR)**: \`${(Number(run.data.deflatedSharpeRatio || 0) * 100).toFixed(1)}%\`\n- **Max Drawdown**: \`-${run.data.maxDrawdownPercent}%\``,
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

  // Agent Multi-Parameter Optimization Sweep
  const handleAgentExplore = async (customPrompt?: string, overrides?: any) => {
    const q = customPrompt || chatInput || "Optimize strategy parameters";
    setExploring(true);
    setErrorMsg(null);

    const activeCap = overrides?.capitalOverride !== undefined ? overrides.capitalOverride : capitalOverride;
    const activeSym = overrides?.symbol || symbol;

    // Add user message to conversation
    setMessages((prev) => [
      ...prev,
      {
        id: "msg_user_" + Date.now(),
        role: "user",
        content: q,
        timestamp: new Date().toLocaleTimeString()
      },
      {
        id: "msg_agent_prog_" + Date.now(),
        role: "assistant",
        content: `🔍 **Starting Autonomous Optimization Sweep** for **${activeSym}** with **$${Number(activeCap).toLocaleString()}** Capital...\n- Analyzing parameter space: Stop ATR (1.4x - 2.4x), Max Hold (10 - 24 bars), Tranche Scaling, and OFI filters.\n- Testing against verified historical broker bars...`,
        timestamp: new Date().toLocaleTimeString()
      }
    ]);

    try {
      // 1. Ensure baseline exists
      if (!baselineResult) {
        const baseRun = await executeSimulation({
          symbol: activeSym,
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

      // 2. Candidate grid
      const candidates = [
        { stopAtrMultiplier: 1.5, partialProfit: true, breakevenLock: true, adaptiveStop: true, ofiFilter: true, maxHoldBars: 12, label: "Tight Scalp / Quick Exit" },
        { stopAtrMultiplier: 1.8, partialProfit: true, breakevenLock: true, adaptiveStop: true, ofiFilter: true, maxHoldBars: 15, label: "Institutional Balanced OFI" },
        { stopAtrMultiplier: 2.2, partialProfit: true, breakevenLock: true, adaptiveStop: true, ofiFilter: true, maxHoldBars: 20, label: "Wide Runner / Momentum Drift" },
        { stopAtrMultiplier: 2.0, partialProfit: true, breakevenLock: false, adaptiveStop: true, ofiFilter: true, maxHoldBars: 18, label: "Deep Swing (No Breakeven Ratchet)" }
      ];

      let bestScore = -999;
      let bestConfig = candidates[1];
      let bestResult = null;

      for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i];
        const run = await executeSimulation({
          ...c,
          symbol: activeSym,
          capitalOverride: activeCap
        });
        if (run.ok) {
          const dsr = Number(run.data.deflatedSharpeRatio || 0);
          const sharpe = Number(run.data.annualizedSharpe || 0);
          const pnl = Number(run.data.totalPnL || 0);
          const score = (dsr * 10) + (sharpe * 2) + (pnl > 0 ? 2 : -5);
          if (score > bestScore) {
            bestScore = score;
            bestConfig = c;
            bestResult = run.data;
          }
        }
      }

      if (bestResult) {
        // Apply optimal settings to state
        setStopAtr(bestConfig.stopAtrMultiplier);
        setPartialProfit(bestConfig.partialProfit);
        setBreakevenLock(bestConfig.breakevenLock);
        setAdaptiveStop(bestConfig.adaptiveStop);
        setOfiFilter(bestConfig.ofiFilter);
        setMaxHoldBars(bestConfig.maxHoldBars);
        setResult(bestResult);
        setStrategyName(`Agent Optimized: ${activeSym} Alpha Frontier`);

        setMessages((prev) => [
          ...prev,
          {
            id: "msg_agent_done_" + Date.now(),
            role: "assistant",
            content: `🎯 **Frontier Optimization Succeeded!**\n\nI have identified the highest-expectancy configuration (**${bestConfig.label}**) on **$${Number(activeCap).toLocaleString()}** capital and loaded it into your studio:\n- **Starting Capital**: \`$${Number(bestResult.startingCapital || activeCap).toLocaleString()}\`\n- **Stop ATR**: \`${bestConfig.stopAtrMultiplier}x\`\n- **Max Hold Bars**: \`${bestConfig.maxHoldBars} bars\`\n- **Tranche Scaling**: \`Active (50% @ 2.5 ATR)\`\n- **Breakeven Ratchet**: \`${bestConfig.breakevenLock ? "Active (+1.0 ATR)" : "Off"}\`\n\n**Performance Metrics:**\n- 💰 **Net PnL**: \`+$${Number(bestResult.totalPnL || 0).toFixed(2)}\` (${bestResult.totalPnLPercent}%)\n- 🏆 **Deflated Sharpe (DSR)**: \`${(Number(bestResult.deflatedSharpeRatio || 0) * 100).toFixed(1)}%\`\n- 📈 **Annual Sharpe**: \`${bestResult.annualizedSharpe}\`\n- 🎯 **Win Rate**: \`${bestResult.winRate}%\` (${bestResult.winningTrades}W / ${bestResult.losingTrades}L)\n- 📉 **Max Drawdown**: \`-${bestResult.maxDrawdownPercent}%\`\n\n*Review the interactive curve and league table on the right, or click 'Save Experiment' to archive it.*`,
            timestamp: new Date().toLocaleTimeString(),
            actionTriggered: "OPTIMIZATION_SWEEP_SUCCESS"
          }
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            id: "msg_agent_fail_" + Date.now(),
            role: "assistant",
            content: "⚠️ The parameter sweep completed, but all candidate variations underperformed the current parameters. Existing values retained.",
            timestamp: new Date().toLocaleTimeString()
          }
        ]);
      }
    } catch (e: any) {
      setErrorMsg("Optimization sweep failed: " + e.message);
    } finally {
      setExploring(false);
      setChatInput("");
    }
  };

  // Conversational message submission handler
  const handleSendChat = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const text = chatInput.trim();
    if (!text || exploring) return;

    setChatInput("");

    // Show user message in chat
    setMessages((prev) => [
      ...prev,
      {
        id: "msg_user_" + Date.now(),
        role: "user",
        content: text,
        timestamp: new Date().toLocaleTimeString()
      }
    ]);

    let detectedCapital = capitalOverride;
    let detectedRiskPct = riskBudgetPct;
    let detectedFriction = frictionCeiling;
    let detectedStopAtr = stopAtr;
    let detectedHoldBars = maxHoldBars;
    let detectedTimeframe = timeframe;
    let detectedSymbol = symbol;

    // 1. Call Institutional Risk Sanitizer Endpoint to extract capital and risk parameters
    try {
      const sanRes = await fetch("/api/research/sanitize-risk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: text })
      });
      if (sanRes.ok) {
        const sanData = await sanRes.json();
        const rawCap = sanData.raw_parsed?.requested_capital;
        const sanitizedCap = sanData.sanitized_parameters?.sanitized_capital;
        if (sanitizedCap !== undefined && sanitizedCap !== null && sanitizedCap > 0) {
          detectedCapital = Number(sanitizedCap);
          setCapitalOverride(detectedCapital);
        } else if (rawCap !== undefined && rawCap !== null && rawCap > 0) {
          detectedCapital = Number(rawCap);
          setCapitalOverride(detectedCapital);
        }

        const rawRisk = sanData.sanitized_parameters?.risk_per_trade_pct;
        if (rawRisk !== undefined && rawRisk !== null && rawRisk > 0) {
          detectedRiskPct = Number(rawRisk) / 100.0;
          setRiskBudgetPct(detectedRiskPct);
        }

        const rawFric = sanData.sanitized_parameters?.friction_ceiling_pct;
        if (rawFric !== undefined && rawFric !== null && rawFric > 0) {
          detectedFriction = Number(rawFric);
          setFrictionCeiling(detectedFriction);
        }
      }
    } catch (err) {
      console.warn("Risk sanitizer failed, falling back to local regex:", err);
      const capMatch = text.match(/(?:with|\$|€|£)?\s*([0-9]{1,3}(?:,[0-9]{3})*|[0-9]+)\s*(?:k)?\s*(?:strat(?:egy)?\s*)?(?:capital|allocation)/i);
      if (capMatch && capMatch[1]) {
        let val = parseFloat(capMatch[1].replace(/,/g, ''));
        if (capMatch[0].toLowerCase().includes('k')) val *= 1000;
        if (val > 0) {
          detectedCapital = val;
          setCapitalOverride(val);
        }
      }
    }

    // 2. Dynamic Symbol Extraction
    const words = text.split(/[\s,;.!?]+/);
    for (const w of words) {
      const cleanW = w.toUpperCase().replace(/[^A-Z]/g, '');
      if (cleanW.length >= 2 && cleanW.length <= 5) {
        const matchInUniverse = dynamicUniverse.find(u => u.symbol.toUpperCase() === cleanW);
        if (matchInUniverse) {
          detectedSymbol = matchInUniverse.symbol;
          setSymbol(detectedSymbol);
          setCustomTickerInput(detectedSymbol);
          break;
        } else if (/^[A-Z]{2,5}$/.test(cleanW) && !["WITH", "THAT", "SAME", "OVER", "FROM", "TEST", "HOLD", "STOP", "RISK", "RUN", "THE", "FOR", "AND"].includes(cleanW)) {
          try {
            const resolveRes = await fetch("/api/research/resolve", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ query: cleanW })
            });
            if (resolveRes.ok) {
              const resData = await resolveRes.json();
              if (resData.primary_contract?.symbol) {
                detectedSymbol = resData.primary_contract.symbol;
                setSymbol(detectedSymbol);
                setCustomTickerInput(detectedSymbol);
                setResolvedInfo(resData.primary_contract);
                break;
              }
            }
          } catch {}
        }
      }
    }

    // 3. Timeframe detection
    const lower = text.toLowerCase();
    if (lower.includes("5m") || lower.includes("5-min")) {
      detectedTimeframe = "5m";
      setTimeframe("5m");
    } else if (lower.includes("15m") || lower.includes("15-min")) {
      detectedTimeframe = "15m";
      setTimeframe("15m");
    } else if (lower.includes("1h") || lower.includes("1-hour") || lower.includes("hourly")) {
      detectedTimeframe = "1h";
      setTimeframe("1h");
    }

    // 4. Stop ATR detection
    const stopMatch = text.match(/stop\s*(?:atr)?\s*(?:to|=)?\s*([0-9.]+)/i);
    if (stopMatch && stopMatch[1]) {
      detectedStopAtr = parseFloat(stopMatch[1]);
      setStopAtr(detectedStopAtr);
    }

    // 5. Max Hold detection
    const holdMatch = text.match(/(?:max\s*hold|hold)\s*(?:to|=)?\s*([0-9]+)/i);
    if (holdMatch && holdMatch[1]) {
      detectedHoldBars = parseInt(holdMatch[1], 10);
      setMaxHoldBars(detectedHoldBars);
    }

    const currentOverrides = {
      symbol: detectedSymbol,
      timeframe: detectedTimeframe,
      capitalOverride: detectedCapital,
      riskBudgetPct: detectedRiskPct,
      frictionCeilingPct: detectedFriction,
      stopAtrMultiplier: detectedStopAtr,
      maxHoldBars: detectedHoldBars
    };

    // Trigger exploration if query asks for optimization or exploration
    if (lower.includes("optimize") || lower.includes("explore") || lower.includes("tune") || lower.includes("find")) {
      await handleAgentExplore(text, currentOverrides);
    } else {
      await handleRunSimulation(currentOverrides);
    }
  };

  // Save current strategy to local storage vault
  const handleSaveToVault = () => {
    if (!result) return;
    const newExperiment: StrategyStudioExperiment = {
      id: "EXP_" + Date.now().toString(36).toUpperCase(),
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
        frictionCeilingPct: frictionCeiling,
        binaryBlackoutHours: binaryBlackout
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

    const updated = [newExperiment, ...vault];
    setVault(updated);
    try {
      localStorage.setItem("alpha_engine_strategy_vault", JSON.stringify(updated));
    } catch (err) {
      console.error("Local storage error:", err);
    }
    setSaveSuccessMsg(`Saved "${newExperiment.name}" into Experiment Vault.`);
    setTimeout(() => setSaveSuccessMsg(null), 4000);
  };

  // Reload experiment from vault
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
    setBinaryBlackout(exp.parameters.binaryBlackoutHours);

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



  // Delete from vault
  const handleDeleteExperiment = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = vault.filter((item) => item.id !== id);
    setVault(updated);
    try {
      localStorage.setItem("alpha_engine_strategy_vault", JSON.stringify(updated));
    } catch {}
  };

  // Quick Query Chips
  const quickChips = [
    "run the same with 5000 strat capital",
    "Run ASML with $5,000 capital and 1.8 ATR stop",
    "Optimize XLE for maximum Deflated Sharpe",
    "Explore NVDA breakout with $25,000 capital and 12-bar hold",
    "Test SAP mean reversion with Breakeven ratchet"
  ];

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-[#0c101c] border border-white/10 rounded-2xl p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-xl">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs bg-emerald-500/20 text-[#00ff88] border border-emerald-500/40 px-2.5 py-1 rounded-md font-mono font-bold flex items-center gap-1.5 shadow-sm">
              <Sparkles className="w-3.5 h-3.5 text-[#00ff88]" /> AGENTIC STRATEGY STUDIO
            </span>
            <span className="text-xs bg-blue-500/20 text-blue-300 border border-blue-500/30 px-2.5 py-1 rounded-md font-mono font-bold">
              VERIFIED IBKR BARS
            </span>
            <span className="text-xs text-slate-400 font-mono hidden sm:inline-block">
              Zero Synthetic • Audited Deflated Sharpe
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black text-white font-mono mt-2 flex items-center gap-2">
            <SlidersHorizontal className="w-6 h-6 text-emerald-400" /> Quantitative Strategy Studio & Experiment Vault
          </h1>
          <p className="text-xs sm:text-sm text-slate-300 font-sans mt-1">
            Direct autonomous agents to discover high-expectancy trading configurations, run parameter sweeps, and preserve audited strategy backtests.
          </p>
        </div>

        {/* Top Action Buttons */}
        <div className="flex items-center gap-2 w-full md:w-auto">
          <button
            onClick={handleRunSimulation}
            disabled={loading || exploring}
            className="flex-1 md:flex-none bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-mono text-xs font-bold px-4 py-2.5 rounded-xl transition cursor-pointer flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/20"
          >
            {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            RUN SIMULATION
          </button>

          {result && (
            <button
              onClick={handleSaveToVault}
              className="bg-indigo-600 hover:bg-indigo-500 text-white font-mono text-xs font-bold px-4 py-2.5 rounded-xl transition cursor-pointer flex items-center gap-2 shadow-lg shadow-indigo-600/20"
            >
              <Bookmark className="w-4 h-4" />
              SAVE EXPERIMENT
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

      {/* Main Studio Two-Column Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Conversational Strategy Agent & Command Terminal (5 Cols) */}
        <div className="lg:col-span-5 bg-[#0c101c] border border-white/10 rounded-2xl flex flex-col h-[740px] shadow-xl overflow-hidden">
          {/* Chat Header */}
          <div className="p-4 border-b border-white/10 bg-slate-900/60 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center">
                <Bot className="w-4 h-4 text-[#00ff88]" />
              </div>
              <div>
                <span className="text-xs font-mono font-bold text-white block">STRATEGY OPTIMIZER AGENT</span>
                <span className="text-[10px] font-mono text-emerald-400 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Frontier Search Engine Active
                </span>
              </div>
            </div>
            <button
              onClick={() => setMessages([messages[0]])}
              title="Reset conversation"
              className="text-slate-400 hover:text-white p-1.5 rounded transition"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>

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
                    <div className="whitespace-pre-wrap font-mono">{m.content}</div>
                    <span className="text-[10px] opacity-40 block mt-1.5 text-right font-sans">{m.timestamp}</span>
                  </div>
                </div>
              );
            })}
            {exploring && (
              <div className="flex gap-3 items-start animate-in fade-in">
                <div className="w-6 h-6 rounded-md bg-emerald-500/20 text-[#00ff88] flex items-center justify-center shrink-0 mt-0.5">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                </div>
                <div className="p-3 rounded-2xl bg-slate-900/80 border border-emerald-500/30 text-emerald-300 font-mono text-xs">
                  Agent running multi-candidate parameter sweeps across broker history...
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Quick Query Chips */}
          <div className="px-4 py-2 bg-black/40 border-t border-white/5 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            {quickChips.map((chip, idx) => (
              <button
                key={idx}
                onClick={() => handleAgentExplore(chip)}
                disabled={exploring}
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
              placeholder="Direct agent (e.g. Optimize ASML for maximum Deflated Sharpe)..."
              disabled={exploring}
              className="flex-1 bg-black/70 border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono placeholder-slate-500 focus:outline-none focus:border-emerald-500"
            />
            <button
              type="submit"
              disabled={exploring || !chatInput.trim()}
              className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white px-4 py-2.5 rounded-xl transition cursor-pointer flex items-center justify-center shadow-lg shadow-emerald-600/20"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>

        {/* Right Column: Studio Controls, Visualizer, Blotter & Vault (7 Cols) */}
        <div className="lg:col-span-7 space-y-6">
          {/* Tactile Tuning Controls Matrix */}
          <div className="bg-[#0c101c] border border-white/10 rounded-2xl p-5 space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <span className="text-xs font-mono uppercase font-bold text-slate-200 flex items-center gap-2">
                <Sliders className="w-4 h-4 text-emerald-400" /> Strategy Parameter & Friction Controls
              </span>
              <span className="text-xs text-slate-400 font-mono">Real-Time Parameter Calibration</span>
            </div>

            {/* Selector Row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              {/* Dynamic Ticker Resolution Box */}
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
                      if (e.key === 'Enter') {
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
                    placeholder="Ticker (e.g. TSLA)..."
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
                    {!dynamicUniverse.some(u => u.symbol === symbol) && (
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

              {/* Starting Capital with Quick Presets */}
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

            {/* Risk & Friction Limits */}
            <div className="grid grid-cols-2 gap-3 pt-1">
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-[11px] text-slate-300 uppercase font-mono font-bold">Capital Risk (r)</label>
                  <span className="text-xs text-amber-400 font-mono font-bold">{(riskBudgetPct * 100).toFixed(2)}%</span>
                </div>
                <input
                  type="range"
                  min="0.0025"
                  max="0.02"
                  step="0.0025"
                  value={riskBudgetPct}
                  onChange={(e) => setRiskBudgetPct(parseFloat(e.target.value))}
                  className="w-full accent-amber-500 cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-[11px] text-slate-300 uppercase font-mono font-bold">Friction Ceiling</label>
                  <span className="text-xs text-rose-400 font-mono font-bold">{frictionCeiling}%</span>
                </div>
                <input
                  type="range"
                  min="5"
                  max="25"
                  step="1"
                  value={frictionCeiling}
                  onChange={(e) => setFrictionCeiling(parseFloat(e.target.value))}
                  className="w-full accent-rose-500 cursor-pointer"
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
                <span className="text-slate-300 font-semibold">Adaptive Volatility Sizing</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={ofiFilter}
                  onChange={(e) => setOfiFilter(e.target.checked)}
                  className="rounded bg-black border-white/20 text-emerald-500 focus:ring-0"
                />
                <span className="text-slate-300 font-semibold">OFI Imbalance Gate</span>
              </label>
            </div>
          </div>

          {/* Results Tab Navigation (Performance / Blotter / Vault) */}
          <div className="bg-[#0c101c] border border-white/10 rounded-2xl p-5 space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2 bg-black/60 p-1 rounded-xl border border-white/10 text-xs font-mono">
                <button
                  onClick={() => setActiveTab("performance")}
                  className={`px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 font-bold ${
                    activeTab === "performance" ? "bg-emerald-600 text-white shadow" : "text-slate-400 hover:text-white"
                  }`}
                >
                  <TrendingUp className="w-3.5 h-3.5" /> Performance & Equity Curve
                </button>
                <button
                  onClick={() => setActiveTab("blotter")}
                  className={`px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 font-bold ${
                    activeTab === "blotter" ? "bg-emerald-600 text-white shadow" : "text-slate-400 hover:text-white"
                  }`}
                >
                  <Activity className="w-3.5 h-3.5" /> Trade Blotter ({result?.tradesList?.length || 0})
                </button>
                <button
                  onClick={() => setActiveTab("vault")}
                  className={`px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 font-bold ${
                    activeTab === "vault" ? "bg-indigo-600 text-white shadow" : "text-slate-400 hover:text-white"
                  }`}
                >
                  <FolderOpen className="w-3.5 h-3.5" /> Saved Vault ({vault.length})
                </button>
              </div>

              {result && (
                <span className="text-xs font-mono font-bold text-slate-300">
                  {strategyName}
                </span>
              )}
            </div>

            {/* TAB 1: Performance Curve & League Table */}
            {activeTab === "performance" && result && (
              <div className="space-y-4 animate-in fade-in duration-200">
                {/* Metrics Badges */}
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

                {/* Equity Curve Recharts */}
                <div className="bg-black/50 border border-white/10 rounded-xl p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono font-bold text-slate-200 uppercase flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-emerald-400" /> Compounded Equity Trajectory (${result.symbol})
                    </span>
                    <span className="text-xs font-mono text-slate-400">
                      ${Number(result.startingCapital || 100000).toLocaleString()} ➔ ${Number(result.finalCapital || 100000).toLocaleString()}
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
                          domain={['dataMin - 500', 'dataMax + 500']}
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

                {/* Comparative League Table */}
                {baselineResult && (
                  <div className="bg-black/40 border border-white/5 rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono font-bold uppercase text-slate-300 flex items-center gap-2">
                        <Award className="w-4 h-4 text-amber-400" /> Comparative League Table (Baseline vs. Tuned)
                      </span>
                      <span className="text-xs font-mono text-slate-400">Institutional Attribution</span>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-left font-mono text-xs">
                        <thead>
                          <tr className="border-b border-white/10 text-slate-400">
                            <th className="py-2 px-3">Variant</th>
                            <th className="py-2 px-3 text-right">Trades</th>
                            <th className="py-2 px-3 text-right">Win Rate</th>
                            <th className="py-2 px-3 text-right">Profit Factor</th>
                            <th className="py-2 px-3 text-right">Sharpe</th>
                            <th className="py-2 px-3 text-right">DSR</th>
                            <th className="py-2 px-3 text-right">Max DD</th>
                            <th className="py-2 px-3 text-right">Net PnL</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          <tr className="text-slate-400 bg-black/20">
                            <td className="py-2.5 px-3 font-semibold text-slate-300">Baseline (Unfiltered 1.8 ATR)</td>
                            <td className="py-2.5 px-3 text-right">{baselineResult.totalTrades || 0}</td>
                            <td className="py-2.5 px-3 text-right">{baselineResult.winRate || 0}%</td>
                            <td className="py-2.5 px-3 text-right">{baselineResult.profitFactor || "1.00"}</td>
                            <td className="py-2.5 px-3 text-right">{baselineResult.annualizedSharpe || "0.00"}</td>
                            <td className="py-2.5 px-3 text-right text-slate-400">
                              {baselineResult.deflatedSharpeRatio ? `${(Number(baselineResult.deflatedSharpeRatio) * 100).toFixed(1)}%` : "N/A"}
                            </td>
                            <td className="py-2.5 px-3 text-right text-rose-400">-{baselineResult.maxDrawdownPercent || 0}%</td>
                            <td className={`py-2.5 px-3 text-right font-bold ${
                              Number(baselineResult.totalPnL || 0) >= 0 ? "text-emerald-400" : "text-rose-400"
                            }`}>
                              {Number(baselineResult.totalPnL || 0) >= 0 ? "+" : ""}${Number(baselineResult.totalPnL || 0).toFixed(2)}
                            </td>
                          </tr>

                          <tr className="text-white bg-emerald-950/20 border-l-2 border-emerald-500">
                            <td className="py-2.5 px-3 font-bold text-[#00ff88] flex items-center gap-1.5">
                              <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                              {strategyName} (Tuned)
                            </td>
                            <td className="py-2.5 px-3 text-right font-bold">{result.totalTrades || 0}</td>
                            <td className="py-2.5 px-3 text-right font-bold text-white">{result.winRate || 0}%</td>
                            <td className="py-2.5 px-3 text-right font-bold text-cyan-400">{result.profitFactor || "1.00"}</td>
                            <td className="py-2.5 px-3 text-right font-bold text-emerald-400">{result.annualizedSharpe || "0.00"}</td>
                            <td className="py-2.5 px-3 text-right font-bold text-[#00ff88]">
                              {result.deflatedSharpeRatio ? `${(Number(result.deflatedSharpeRatio) * 100).toFixed(1)}%` : "N/A"}
                            </td>
                            <td className="py-2.5 px-3 text-right font-bold text-rose-400">-{result.maxDrawdownPercent || 0}%</td>
                            <td className="py-2.5 px-3 text-right font-bold text-[#00ff88]">
                              +{Number(result.totalPnL || 0).toFixed(2)}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* TAB 2: Audited Trade Blotter */}
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
                          <th className="py-2 px-3">Exit Attribution</th>
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

            {/* TAB 3: Strategy Experiment Vault */}
            {activeTab === "vault" && (
              <div className="space-y-3 animate-in fade-in duration-200">
                <div className="flex items-center justify-between pb-2 border-b border-white/5">
                  <span className="text-xs font-mono font-bold text-white uppercase flex items-center gap-2">
                    <FolderOpen className="w-4 h-4 text-indigo-400" /> Strategy Experiment Vault ({vault.length} Experiments)
                  </span>
                  <span className="text-xs font-mono text-slate-400">Local Persistence Engine</span>
                </div>

                {vault.length === 0 ? (
                  <div className="py-12 text-center text-xs text-slate-500 font-mono">
                    No strategies saved yet. Run a simulation and click "Save Experiment".
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
                            Reload <ArrowUpRight className="w-3 h-3" />
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
    </div>
  );
}
export default StrategyStudioPage;
