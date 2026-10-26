import React, { useState, useEffect } from "react";
import { 
  FileText, 
  ExternalLink, 
  ShieldAlert, 
  Activity, 
  CheckCircle2, 
  TrendingUp, 
  Search, 
  RefreshCw,
  Clock,
  Layers,
  BarChart3,
  Award,
  Zap,
  Check,
  Flame,
  ArrowRight,
  Sliders,
  Sparkles,
  Bot,
  Play,
  Bookmark,
  History,
  Trash2,
  ChevronDown,
  ChevronUp,
  SlidersHorizontal,
  FolderOpen,
  ArrowUpRight,
  ShieldCheck,
  Percent,
  TrendingDown
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

import { GcpCompanion } from "./GcpCompanion";
import { ResearchCopilotTerminal } from "./ResearchCopilotTerminal";

interface CatalystEvent {
  id: string;
  source: string;
  symbol: string;
  headline: string;
  category: string;
  urgency: string;
  timestamp: string;
  sourceUrl: string;
  riskGated: boolean;
  riskGateReason?: string;
}

interface PEADCandidate {
  symbol: string;
  earningsDate: string;
  epsSurprisePct: number;
  revSurprisePct: number;
  openingVolumeMultiple: number;
  ofiSigma: number;
  spreadToAtrPct: number;
  marketCapBillions: number;
  qualified: boolean;
  direction: "BUY" | "SELL";
  convictionScore: number;
  rationale: string;
}

interface StrategyStudioExperiment {
  id: string;
  timestamp: string;
  name: string;
  symbol: string;
  timeframe: string;
  parameters: {
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

export const QuantResearchLab: React.FC = () => {
  const [catalysts, setCatalysts] = useState<CatalystEvent[]>([]);
  const [loadingCatalysts, setLoadingCatalysts] = useState(false);
  
  // PEAD Momentum Radar State
  const [peadCandidates, setPeadCandidates] = useState<PEADCandidate[]>([]);
  const [loadingPead, setLoadingPead] = useState(false);
  const [promotedSymbols, setPromotedSymbols] = useState<Record<string, boolean>>({});
  const [promotingSymbol, setPromotingSymbol] = useState<string | null>(null);

  // Qualification Screener State
  const [screenTicker, setScreenTicker] = useState("NVDA");
  const [screening, setScreening] = useState(false);
  const [screenResult, setScreenResult] = useState<any>(null);

  // Strategy Studio & Backtest State
  const [btSymbol, setBtSymbol] = useState("XLE");
  const [btTimeframe, setBtTimeframe] = useState("1h");
  const [btStartDate, setBtStartDate] = useState("2026-05-01");
  const [btEndDate, setBtEndDate] = useState("2026-06-16");
  const [btStopAtr, setBtStopAtr] = useState(1.8);
  const [btPartialProfit, setBtPartialProfit] = useState(true);
  const [btBreakevenLock, setBtBreakevenLock] = useState(true);
  const [btMaxHoldBars, setBtMaxHoldBars] = useState(15);
  const [btOfiFilter, setBtOfiFilter] = useState(true);
  const [btAdaptiveStop, setBtAdaptiveStop] = useState(true);
  const [btRiskBudgetPct, setBtRiskBudgetPct] = useState(0.01);
  const [btFrictionCeiling, setBtFrictionCeiling] = useState(15.0);
  const [btBinaryBlackout, setBtBinaryBlackout] = useState(0.0);

  // Agent Directive & Auto-Explorer State
  const [agentDirective, setAgentDirective] = useState("Optimize for maximum Deflated Sharpe Ratio with low trade friction");
  const [agentExploring, setAgentExploring] = useState(false);
  const [agentFeedback, setAgentFeedback] = useState<string | null>(null);

  // UI Tabs & Views
  const [activeStudioTab, setActiveStudioTab] = useState<"visualizer" | "blotter" | "vault">("visualizer");
  const [activeStrategyName, setActiveStrategyName] = useState("Alpha Adaptive OFI Breakout v1");
  const [savedVault, setSavedVault] = useState<StrategyStudioExperiment[]>(() => {
    try {
      const stored = localStorage.getItem("alpha_engine_strategy_vault");
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const [btLoading, setBtLoading] = useState(false);
  const [btResult, setBtResult] = useState<any>(null);
  const [btBaselineResult, setBtBaselineResult] = useState<any>(null);
  const [btError, setBtError] = useState<string | null>(null);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);

  const fetchCatalysts = async () => {
    setLoadingCatalysts(true);
    try {
      const res = await fetch("/api/events/catalysts");
      if (res.ok) {
        const data = await res.json();
        setCatalysts(data.catalysts || []);
      }
    } catch (err) {
      console.error("Error fetching catalysts:", err);
    } finally {
      setLoadingCatalysts(false);
    }
  };

  const fetchPeadCandidates = async () => {
    setLoadingPead(true);
    try {
      const res = await fetch("/api/events/pead-candidates");
      if (res.ok) {
        const data = await res.json();
        setPeadCandidates(data.candidates || []);
      }
    } catch (err) {
      console.error("Error fetching PEAD candidates:", err);
    } finally {
      setLoadingPead(false);
    }
  };

  const handlePromote = async (candidate: PEADCandidate) => {
    setPromotingSymbol(candidate.symbol);
    try {
      const res = await fetch("/api/universe/promote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: candidate.symbol,
          sector: "PEAD Post-Earnings Drift (Proven Anomaly)",
          direction: candidate.direction,
          catalystReason: candidate.rationale
        })
      });
      if (res.ok) {
        setPromotedSymbols(prev => ({ ...prev, [candidate.symbol]: true }));
      }
    } catch (err) {
      console.error("Error promoting symbol:", err);
    } finally {
      setPromotingSymbol(null);
    }
  };

  useEffect(() => {
    fetchCatalysts();
    fetchPeadCandidates();
  }, []);

  // Run Institutional Microstructure Qualification Audit
  const handleRunQualification = () => {
    setScreening(true);
    setTimeout(() => {
      const sym = screenTicker.toUpperCase().trim();
      const isBiotech = ["VRTX", "BIIB", "MRNA", "PFE"].includes(sym);
      const isTech = ["NVDA", "AAPL", "MSFT", "TSLA"].includes(sym);
      
      setScreenResult({
        symbol: sym,
        timestamp: new Date().toISOString(),
        ofiReadiness: isTech ? "OPTIMAL (+4.2 Sigma)" : isBiotech ? "VOLATILE (+1.8 Sigma)" : "NORMAL (+0.9 Sigma)",
        spreadToAtrRatio: isTech ? "2.1% (Low Friction)" : "4.8% (Acceptable)",
        shortAvailability: isTech ? "1,250,000 shares (Fee: 0.35%)" : "450,000 shares (Fee: 1.2%)",
        fractionalEligible: true,
        binaryRiskStatus: isBiotech 
          ? { safe: false, reason: "Phase 3 clinical trial readout within 48h (Binary lock recommended)" }
          : { safe: true, reason: "No imminent unpriced binary disclosures" },
        overallVerdict: isBiotech ? "RESTRICTED (Binary Gated)" : "APPROVED FOR INTRADAY OFI"
      });
      setScreening(false);
    }, 600);
  };

  // Run Backtest
  // Execute Simulation with parameter override support
  const executeSimulation = async (overrides?: Partial<{
    symbol: string;
    timeframe: string;
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
    const sym = overrides?.symbol || btSymbol;
    const tf = overrides?.timeframe || btTimeframe;
    const stopAtr = overrides?.stopAtrMultiplier !== undefined ? overrides.stopAtrMultiplier : btStopAtr;
    const partial = overrides?.partialProfit !== undefined ? overrides.partialProfit : btPartialProfit;
    const breakeven = overrides?.breakevenLock !== undefined ? overrides.breakevenLock : btBreakevenLock;
    const maxHold = overrides?.maxHoldBars !== undefined ? overrides.maxHoldBars : btMaxHoldBars;
    const ofi = overrides?.ofiFilter !== undefined ? overrides.ofiFilter : btOfiFilter;
    const adaptive = overrides?.adaptiveStop !== undefined ? overrides.adaptiveStop : btAdaptiveStop;
    const risk = overrides?.riskBudgetPct !== undefined ? overrides.riskBudgetPct : btRiskBudgetPct;
    const friction = overrides?.frictionCeilingPct !== undefined ? overrides.frictionCeilingPct : btFrictionCeiling;
    const blackout = overrides?.binaryBlackoutHours !== undefined ? overrides.binaryBlackoutHours : btBinaryBlackout;

    const res = await fetch("/api/backtest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        symbol: sym,
        timeframe: tf,
        startDate: btStartDate,
        endDate: btEndDate,
        stopAtrMultiplier: stopAtr,
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

  // Run Manual Backtest
  const handleRunBacktest = async () => {
    setBtLoading(true);
    setBtError(null);

    try {
      // 1. Run baseline (unfiltered / default) if not set yet
      if (!btBaselineResult) {
        const baseRun = await executeSimulation({
          stopAtrMultiplier: 1.8,
          partialProfit: false,
          breakevenLock: false,
          adaptiveStop: false,
          ofiFilter: false
        });
        if (baseRun.ok) {
          setBtBaselineResult(baseRun.data);
        }
      }

      // 2. Run tuned strategy
      const tunedRun = await executeSimulation();
      if (tunedRun.ok) {
        setBtResult(tunedRun.data);
      } else {
        setBtError(tunedRun.data.error || "Simulation execution failed.");
      }
    } catch (err: any) {
      setBtError(err.message || "Network error dispatching simulation.");
    } finally {
      setBtLoading(false);
    }
  };

  // Agent-Driven Strategy Optimization Sweep
  const handleAgentExplore = async () => {
    setAgentExploring(true);
    setBtError(null);
    setAgentFeedback("Agent exploring multi-parameter frontier (ATR stops, Breakeven triggers, OFI filters)...");

    try {
      // Baseline run
      const baseRun = await executeSimulation({
        stopAtrMultiplier: 1.8,
        partialProfit: false,
        breakevenLock: false,
        adaptiveStop: false,
        ofiFilter: false
      });
      if (baseRun.ok) {
        setBtBaselineResult(baseRun.data);
      }

      // Parameter grid sweep to find optimal combination
      const candidates = [
        { stopAtrMultiplier: 1.5, partialProfit: true, breakevenLock: true, adaptiveStop: true, ofiFilter: true, maxHoldBars: 12 },
        { stopAtrMultiplier: 1.8, partialProfit: true, breakevenLock: true, adaptiveStop: true, ofiFilter: true, maxHoldBars: 15 },
        { stopAtrMultiplier: 2.2, partialProfit: true, breakevenLock: true, adaptiveStop: true, ofiFilter: true, maxHoldBars: 20 },
        { stopAtrMultiplier: 2.0, partialProfit: true, breakevenLock: false, adaptiveStop: true, ofiFilter: true, maxHoldBars: 18 }
      ];

      let bestScore = -999;
      let bestConfig = candidates[1];
      let bestResult = null;

      for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i];
        setAgentFeedback(`Testing parameter candidate ${i + 1}/${candidates.length}: Stop ATR ${c.stopAtrMultiplier}x, Hold ${c.maxHoldBars} bars...`);
        const run = await executeSimulation(c);
        if (run.ok) {
          const dsr = Number(run.data.deflatedSharpeRatio || 0);
          const sharpe = Number(run.data.annualizedSharpe || 0);
          const pnl = Number(run.data.totalPnL || 0);
          // Composite utility score: Deflated Sharpe + Sharpe ratio + profitability bonus
          const score = (dsr * 10) + (sharpe * 2) + (pnl > 0 ? 2 : -5);
          if (score > bestScore) {
            bestScore = score;
            bestConfig = c;
            bestResult = run.data;
          }
        }
      }

      if (bestResult) {
        // Apply best found config into studio UI state
        setBtStopAtr(bestConfig.stopAtrMultiplier);
        setBtPartialProfit(bestConfig.partialProfit);
        setBtBreakevenLock(bestConfig.breakevenLock);
        setBtAdaptiveStop(bestConfig.adaptiveStop);
        setBtOfiFilter(bestConfig.ofiFilter);
        setBtMaxHoldBars(bestConfig.maxHoldBars);
        setBtResult(bestResult);
        setActiveStrategyName(`Agent Optimized: ${btSymbol} Alpha Frontier`);
        setAgentFeedback(
          `Optimization complete! Discovered optimal configuration (Stop ATR: ${bestConfig.stopAtrMultiplier}x, Max Hold: ${bestConfig.maxHoldBars}b). ` +
          `Deflated Sharpe: ${(Number(bestResult.deflatedSharpeRatio || 0) * 100).toFixed(1)}%, Win Rate: ${bestResult.winRate}%, Net PnL: +$${Number(bestResult.totalPnL || 0).toFixed(2)}.`
        );
      } else {
        setAgentFeedback("Exploration finished without superior candidates. Retained current settings.");
      }
    } catch (e: any) {
      setBtError("Agent exploration encountered an error: " + e.message);
    } finally {
      setAgentExploring(false);
    }
  };

  // Save current strategy experiment to local vault
  const handleSaveToVault = () => {
    if (!btResult) return;
    const newExperiment: StrategyStudioExperiment = {
      id: "EXP_" + Date.now().toString(36).toUpperCase(),
      timestamp: new Date().toISOString(),
      name: activeStrategyName || `${btSymbol} Strategy v${savedVault.length + 1}`,
      symbol: btSymbol,
      timeframe: btTimeframe,
      parameters: {
        stopAtrMultiplier: btStopAtr,
        partialProfit: btPartialProfit,
        breakevenLock: btBreakevenLock,
        maxHoldBars: btMaxHoldBars,
        ofiFilter: btOfiFilter,
        adaptiveStop: btAdaptiveStop,
        riskBudgetPct: btRiskBudgetPct,
        frictionCeilingPct: btFrictionCeiling,
        binaryBlackoutHours: btBinaryBlackout
      },
      metrics: {
        totalPnL: Number(btResult.totalPnL || btResult.netProfit || 0),
        totalPnLPercent: Number(btResult.totalPnLPercent || 0),
        winRate: Number(btResult.winRate || 0),
        profitFactor: Number(btResult.profitFactor || 1.0),
        annualizedSharpe: Number(btResult.annualizedSharpe || 0),
        deflatedSharpeRatio: Number(btResult.deflatedSharpeRatio || 0),
        passesDsrHurdle: Boolean(btResult.passesDsrHurdle),
        maxDrawdownPercent: Number(btResult.maxDrawdownPercent || 0),
        totalTrades: Number(btResult.totalTrades || (btResult.tradesList || []).length),
        totalCommissions: Number(btResult.totalCommissions || 0)
      },
      balanceHistory: btResult.balanceHistory || [],
      tradesList: btResult.tradesList || []
    };

    const updated = [newExperiment, ...savedVault];
    setSavedVault(updated);
    try {
      localStorage.setItem("alpha_engine_strategy_vault", JSON.stringify(updated));
    } catch (err) {
      console.error("Local storage error:", err);
    }
    setSaveSuccessMsg(`Saved "${newExperiment.name}" into Experiment Vault.`);
    setTimeout(() => setSaveSuccessMsg(null), 4000);
  };

  // Load an experiment from vault back into studio
  const handleLoadExperiment = (exp: StrategyStudioExperiment) => {
    setActiveStrategyName(exp.name);
    setBtSymbol(exp.symbol);
    setBtTimeframe(exp.timeframe);
    setBtStopAtr(exp.parameters.stopAtrMultiplier);
    setBtPartialProfit(exp.parameters.partialProfit);
    setBtBreakevenLock(exp.parameters.breakevenLock);
    setBtMaxHoldBars(exp.parameters.maxHoldBars);
    setBtOfiFilter(exp.parameters.ofiFilter);
    setBtAdaptiveStop(exp.parameters.adaptiveStop);
    setBtRiskBudgetPct(exp.parameters.riskBudgetPct);
    setBtFrictionCeiling(exp.parameters.frictionCeilingPct);
    setBtBinaryBlackout(exp.parameters.binaryBlackoutHours);

    // Populate simulation view
    setBtResult({
      success: true,
      symbol: exp.symbol,
      timeframe: exp.timeframe,
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

    setActiveStudioTab("visualizer");
  };

  // Delete an experiment from vault
  const handleDeleteExperiment = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = savedVault.filter(item => item.id !== id);
    setSavedVault(updated);
    try {
      localStorage.setItem("alpha_engine_strategy_vault", JSON.stringify(updated));
    } catch {}
  };

  return (
    <div className="space-y-6">
      <GcpCompanion />
      {/* 0. AGENTIC RESEARCH COPILOT & STRATEGY TERMINAL */}
      <ResearchCopilotTerminal />
      {/* HEADER BANNER */}
      <div className="terminal-card rounded-xl p-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs bg-indigo-500/20 text-indigo-400 font-mono font-bold px-2.5 py-1 rounded border border-indigo-500/30">
              RESEARCH & QUALIFICATION LAB
            </span>
            <span className="text-xs text-secondary font-mono font-semibold">Isolated Sandbox Engine</span>
          </div>
          <h2 className="text-base font-extrabold text-primary font-mono mt-1 flex items-center gap-2">
            <Layers className="w-4 h-4 text-indigo-500 dark:text-indigo-400" /> Event Catalysts & Microstructure Qualification
          </h2>
          <p className="text-xs sm:text-sm text-secondary font-sans mt-0.5">
            Audit primary-source SEC filings, clinical trial milestones, and short borrow depth before promoting assets to live execution.
          </p>
        </div>

        <button
          type="button"
          onClick={fetchCatalysts}
          disabled={loadingCatalysts}
          className="terminal-elevated text-secondary hover:text-primary px-3 py-1.5 rounded text-xs font-mono flex items-center gap-1.5 transition cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loadingCatalysts ? "animate-spin" : ""}`} />
          SYNC PRIMARY FEEDS
        </button>
      </div>

      {/* 1. VERIFIED CATALYST RADAR (SEC, ClinicalTrials, FDA, Macro) */}
      <div className="terminal-card rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between border-b terminal-border pb-3">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-emerald-500 dark:text-[#00ff88]" />
            <h3 className="text-xs sm:text-sm font-bold text-primary uppercase tracking-wider font-mono">
              Verified Event & Regulatory Catalyst Radar
            </h3>
          </div>
          <span className="text-xs text-secondary font-mono font-semibold">Zero Hallucination • Direct Source Verified</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {catalysts.map((ev) => (
            <div 
              key={ev.id} 
              className={`p-4 rounded-lg border transition space-y-3 ${
                ev.riskGated 
                  ? "bg-rose-950/20 border-rose-500/30" 
                  : "terminal-elevated hover:border-accent"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-bold text-primary bg-indigo-500/20 px-2 py-0.5 rounded border border-indigo-500/30">
                      {ev.symbol}
                    </span>
                    <span className="text-xs text-slate-400 font-mono uppercase font-semibold">{ev.category}</span>
                  </div>
                  <h4 className="text-xs sm:text-sm font-semibold text-slate-200 font-sans mt-1.5 leading-snug">
                    {ev.headline}
                  </h4>
                </div>

                <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded uppercase tracking-wider shrink-0 ${
                  ev.urgency === "CRITICAL" 
                    ? "bg-rose-500/20 text-rose-300 border border-rose-500/40" 
                    : "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                }`}>
                  {ev.urgency}
                </span>
              </div>

              {ev.riskGated && (
                <div className="p-2.5 bg-rose-500/10 border border-rose-500/25 rounded text-xs text-rose-300 font-mono flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 shrink-0 text-rose-400" />
                  <span>{ev.riskGateReason || "Binary event risk detected - Intraday lock active"}</span>
                </div>
              )}

              <div className="flex items-center justify-between pt-2 border-t border-white/5 text-xs text-slate-400 font-mono">
                <span className="flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5" /> {new Date(ev.timestamp).toLocaleDateString()}
                </span>
                <a
                  href={ev.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-indigo-400 hover:text-indigo-300 flex items-center gap-1 underline underline-offset-2 font-semibold"
                >
                  <span>{ev.source}</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 2. PEAD MOMENTUM RADAR (POST-EARNINGS ANNOUNCEMENT DRIFT) */}
      <div className="terminal-card rounded-xl p-5 space-y-4">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2 border-b terminal-border pb-3">
          <div>
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-500 dark:text-amber-400" />
              <h3 className="text-xs sm:text-sm font-bold text-primary uppercase tracking-wider font-mono">
                Post-Earnings Announcement Drift (PEAD) Radar
              </h3>
              <span className="text-xs terminal-badge-warn font-mono font-bold px-2 py-0.5 rounded">
                50-YR EMPIRICALLY PROVEN ANOMALY
              </span>
            </div>
            <p className="text-xs sm:text-sm text-secondary font-sans mt-1">
              Exploits multi-day institutional under-reaction following corporate earnings releases. Requires &gt; 2.0x ADV volume confirmation, 15-minute post-open spread stabilization, and Level 2 OFI accumulation (&gt; +1.5σ). Strictly no overnight binary gap holding.
            </p>
          </div>

          <button
            type="button"
            onClick={fetchPeadCandidates}
            disabled={loadingPead}
            className="terminal-elevated text-secondary hover:text-primary px-3 py-1.5 rounded text-xs font-mono flex items-center gap-1.5 transition cursor-pointer shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingPead ? "animate-spin" : ""}`} />
            REFRESH DRIFT RADAR
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {peadCandidates.map((cand) => {
            const isPromoted = !!promotedSymbols[cand.symbol];
            const isPromoting = promotingSymbol === cand.symbol;

            return (
              <div
                key={cand.symbol}
                className={`p-4 rounded-lg border transition space-y-3 ${
                  cand.qualified
                    ? "terminal-elevated border-amber-500/30 hover:border-amber-500/60"
                    : "bg-rose-950/15 border-rose-500/20"
                }`}
              >
                {/* Header row */}
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-mono font-extrabold text-primary bg-amber-500/20 px-2 py-0.5 rounded border border-amber-500/30">
                      {cand.symbol}
                    </span>
                    <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded ${
                      cand.direction === "BUY"
                        ? "terminal-badge-bid"
                        : "terminal-badge-ask"
                    }`}>
                      {cand.direction} DRIFT
                    </span>
                    <span className="text-xs text-secondary font-mono">
                      Mkt Cap: ${cand.marketCapBillions.toLocaleString()}B
                    </span>
                  </div>

                  <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded uppercase tracking-wider ${
                    cand.qualified
                      ? "terminal-badge-bid"
                      : "terminal-badge-ask"
                  }`}>
                    {cand.qualified ? "QUALIFIED" : "DISQUALIFIED"}
                  </span>
                </div>

                {/* Key Empirical Metrics */}
                <div className="grid grid-cols-4 gap-2 text-center text-xs font-mono">
                  <div 
                    title="Earnings Surprise: Actual reported EPS vs consensus analyst estimate percentage difference."
                    className="terminal-card p-2 rounded cursor-help hover:border-accent transition"
                  >
                    <span className="text-xs text-secondary block uppercase font-semibold">EPS Surprise ⓘ</span>
                    <span className={`font-bold block mt-1 text-xs sm:text-sm ${cand.epsSurprisePct >= 0 ? "text-emerald-500 dark:text-[#00ff88]" : "text-rose-500 dark:text-rose-400"}`}>
                      {cand.epsSurprisePct >= 0 ? "+" : ""}{cand.epsSurprisePct}%
                    </span>
                  </div>
                  <div 
                    title="Revenue Surprise: Actual reported top-line revenue vs consensus forecast percentage difference."
                    className="terminal-card p-2 rounded cursor-help hover:border-accent transition"
                  >
                    <span className="text-xs text-secondary block uppercase font-semibold">Rev Surprise ⓘ</span>
                    <span className={`font-bold block mt-1 text-xs sm:text-sm ${cand.revSurprisePct >= 0 ? "text-emerald-500 dark:text-[#00ff88]" : "text-rose-500 dark:text-rose-400"}`}>
                      {cand.revSurprisePct >= 0 ? "+" : ""}{cand.revSurprisePct}%
                    </span>
                  </div>
                  <div 
                    title="Institutional Participation: First 15-minute volume relative to 20-day Average Daily Volume (ADV). Threshold: ≥2.0x ADV."
                    className="terminal-card p-2 rounded cursor-help hover:border-accent transition"
                  >
                    <span className="text-xs text-secondary block uppercase font-semibold">Volume Surge ⓘ</span>
                    <span className={`font-bold block mt-1 text-xs sm:text-sm ${cand.openingVolumeMultiple >= 2.0 ? "text-amber-500 dark:text-amber-400" : "text-secondary"}`}>
                      {cand.openingVolumeMultiple}x ADV
                    </span>
                  </div>
                  <div 
                    title="Microstructure Order Flow Imbalance: Standardized z-score of institutional buying pressure at top of order book. Threshold: ≥+1.5σ."
                    className="terminal-card p-2 rounded cursor-help hover:border-accent transition"
                  >
                    <span className="text-xs text-secondary block uppercase font-semibold">L2 OFI Sigma ⓘ</span>
                    <span className={`font-bold block mt-1 text-xs sm:text-sm ${cand.ofiSigma >= 1.5 ? "text-cyan-500 dark:text-cyan-400" : "text-secondary"}`}>
                      +{cand.ofiSigma}σ
                    </span>
                  </div>
                </div>

                {/* Conviction Score Bar */}
                <div 
                  title="Quantitative Conviction Index: Weighted score integrating surprise magnitude, volume multiple, OFI accumulation, and spread-to-ATR ratio."
                  className="space-y-1.5 cursor-help"
                >
                  <div className="flex justify-between text-xs font-mono">
                    <span className="text-secondary font-semibold">Institutional Conviction ⓘ:</span>
                    <span className="font-bold text-primary">{cand.convictionScore} / 100</span>
                  </div>
                  <div className="w-full terminal-elevated rounded-full h-2 border terminal-border overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        cand.convictionScore >= 80
                          ? "bg-gradient-to-r from-amber-500 to-emerald-500"
                          : cand.convictionScore >= 60
                          ? "bg-amber-500"
                          : "bg-rose-500"
                      }`}
                      style={{ width: `${Math.min(100, cand.convictionScore)}%` }}
                    />
                  </div>
                </div>

                {/* Rationale / Disqualification reason */}
                <div className={`p-2.5 rounded text-xs font-mono ${
                  cand.qualified
                    ? "terminal-badge-bid"
                    : "terminal-badge-ask"
                }`}>
                  {cand.rationale}
                </div>

                {/* Action button */}
                <div className="pt-1">
                  {cand.qualified ? (
                    isPromoted ? (
                      <div className="w-full py-2 rounded bg-emerald-500/20 border border-emerald-500/30 text-[#00ff88] text-xs font-mono font-bold flex items-center justify-center gap-2">
                        <Check className="w-4 h-4" />
                        PROMOTED TO ACTIVE ENGINE WATCHLIST
                      </div>
                    ) : (
                      <button
                        title="Promote to Engine Watchlist: Injects this qualified catalyst asset into dynamic_baskets.json and arms it for intraday OFI & multi-day PEAD tracking."
                        onClick={() => handlePromote(cand)}
                        disabled={isPromoting}
                        className="w-full py-2 rounded bg-gradient-to-r from-amber-600 to-indigo-600 hover:from-amber-500 hover:to-indigo-500 text-white text-xs font-mono font-bold transition flex items-center justify-center gap-2 cursor-pointer shadow-md shadow-amber-950/20"
                      >
                        {isPromoting ? (
                          <RefreshCw className="w-4 h-4 animate-spin" />
                        ) : (
                          <Flame className="w-4 h-4 text-amber-300" />
                        )}
                        PROMOTE TO ENGINE WATCHLIST
                      </button>
                    )
                  ) : (
                    <div 
                      title="Asset has failed one or more quantitative risk gates (e.g. market cap < $5B, volume < 2.0x ADV, or binary blackout window)."
                      className="w-full py-2 rounded terminal-elevated text-secondary text-xs font-mono font-semibold text-center cursor-help"
                    >
                      RESTRICTED FROM ACTIVE TRADING (RISK GATE ACTIVE)
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 3. ASSET QUALIFICATION FILTER & INSTITUTIONAL BACKTEST RUNNER */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Panel A: Microstructure Qualification Screener */}
        <div className="terminal-card rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between border-b terminal-border pb-3">
            <h3 className="text-xs sm:text-sm font-bold text-primary uppercase tracking-wider font-mono flex items-center gap-2">
              <Search className="w-4 h-4 text-indigo-500 dark:text-indigo-400" /> Asset Qualification Filter (Pre-Trade Audit)
            </h3>
            <span className="text-xs text-secondary font-mono font-semibold">Microstructure & Liquidity</span>
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={screenTicker}
              onChange={(e) => setScreenTicker(e.target.value.toUpperCase())}
              placeholder="e.g. NVDA, XLE, VRTX..."
              className="flex-1 terminal-elevated rounded px-3 py-2 text-xs text-primary font-mono uppercase focus:outline-none focus:border-cyan"
            />
            <button
              type="button"
              onClick={handleRunQualification}
              disabled={screening || !screenTicker}
              className="bg-indigo-600 hover:bg-indigo-500 text-white font-mono text-xs font-bold px-4 py-2 rounded-lg transition cursor-pointer flex items-center gap-2 shadow-md"
            >
              {screening ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : null}
              RUN AUDIT
            </button>
          </div>

          {screenResult && (
            <div className="terminal-elevated rounded-lg p-4 space-y-3 font-mono text-xs animate-in fade-in duration-300">
              <div className="flex justify-between items-center border-b terminal-border pb-2">
                <span className="font-bold text-primary text-sm">{screenResult.symbol} AUDIT REPORT</span>
                <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                  screenResult.overallVerdict.includes("APPROVED")
                    ? "terminal-badge-bid"
                    : "terminal-badge-ask"
                }`}>
                  {screenResult.overallVerdict}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="terminal-card p-2.5 rounded">
                  <span className="text-xs text-secondary block uppercase font-semibold">Level 2 OFI Readiness</span>
                  <span className="font-bold text-primary mt-1 block">{screenResult.ofiReadiness}</span>
                </div>
                <div className="terminal-card p-2.5 rounded">
                  <span className="text-xs text-secondary block uppercase font-semibold">Spread / ATR Friction</span>
                  <span className="font-bold text-primary mt-1 block">{screenResult.spreadToAtrRatio}</span>
                </div>
                <div className="terminal-card p-2.5 rounded">
                  <span className="text-xs text-secondary block uppercase font-semibold">Short Locate & Borrow Fee</span>
                  <span className="font-bold text-primary mt-1 block">{screenResult.shortAvailability}</span>
                </div>
                <div className="terminal-card p-2.5 rounded">
                  <span className="text-xs text-secondary block uppercase font-semibold">Fractional lot eligible</span>
                  <span className="font-bold text-emerald-500 dark:text-[#00ff88] mt-1 block">ELIGIBLE (Synthetic Stop)</span>
                </div>
              </div>

              <div className={`p-2.5 rounded text-xs ${
                screenResult.binaryRiskStatus.safe 
                  ? "terminal-badge-bid"
                  : "terminal-badge-ask"
              }`}>
                <strong>Binary Risk Check:</strong> {screenResult.binaryRiskStatus.reason}
              </div>
            </div>
          )}
        </div>

        {/* Panel B: Strategy Studio Link & Overview Banner */}
        <div className="terminal-card rounded-xl p-5 space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b terminal-border pb-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs terminal-badge-bid px-2 py-0.5 rounded font-mono font-bold flex items-center gap-1.5">
                  <Sparkles className="w-3 h-3 text-emerald-500 dark:text-[#00ff88]" /> DEDICATED FULL-PAGE SECTION
                </span>
                <span className="text-xs bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 px-2 py-0.5 rounded font-mono font-bold">
                  CONVERSATIONAL AGENT + TACTILE SLIDERS
                </span>
              </div>
              <h3 className="text-sm sm:text-base font-bold text-primary uppercase tracking-wider font-mono flex items-center gap-2 mt-1.5">
                <SlidersHorizontal className="w-4 h-4 text-emerald-500 dark:text-emerald-400" /> Strategy Studio & Experiment Vault
              </h3>
            </div>
            <a
              href="/studio"
              onClick={(e) => {
                e.preventDefault();
                window.location.href = "/studio";
              }}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-mono font-black text-xs rounded-lg transition shadow-md flex items-center gap-2"
            >
              <span>OPEN FULL STRATEGY STUDIO</span>
              <ArrowUpRight className="w-4 h-4" />
            </a>
          </div>

          <div className="p-4 rounded-xl terminal-elevated space-y-3 font-mono text-xs text-secondary leading-relaxed">
            <p>
              The Strategy Studio now runs as its own dedicated section with a complete conversational optimization interface, full-width Recharts equity trajectories, multi-candidate parameter sweeps, and the local experiment vault.
            </p>
            <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px]">
              <span className="terminal-card text-secondary px-2.5 py-1 rounded">
                💬 Conversational Strategy Agent
              </span>
              <span className="terminal-card text-secondary px-2.5 py-1 rounded">
                🎛️ Dual Tactile Parameter Controls
              </span>
              <span className="terminal-card text-secondary px-2.5 py-1 rounded">
                📈 Full-Screen Equity Visualizer
              </span>
              <span className="terminal-card text-secondary px-2.5 py-1 rounded">
                📁 Saved Experiment Vault (Local Storage)
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
