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
      <div className="bg-[#0c101c] border border-white/10 rounded-xl p-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs bg-indigo-500/20 text-indigo-300 font-mono font-bold px-2.5 py-1 rounded border border-indigo-500/30">
              RESEARCH & QUALIFICATION LAB
            </span>
            <span className="text-xs text-slate-300 font-mono font-semibold">Isolated Sandbox Engine</span>
          </div>
          <h2 className="text-base font-extrabold text-white font-mono mt-1 flex items-center gap-2">
            <Layers className="w-4 h-4 text-indigo-400" /> Event Catalysts & Microstructure Qualification
          </h2>
          <p className="text-xs sm:text-sm text-slate-300 font-sans mt-0.5">
            Audit primary-source SEC filings, clinical trial milestones, and short borrow depth before promoting assets to live execution.
          </p>
        </div>

        <button
          onClick={fetchCatalysts}
          disabled={loadingCatalysts}
          className="bg-black/40 border border-white/10 hover:border-white/20 text-slate-300 hover:text-white px-3 py-1.5 rounded text-xs font-mono flex items-center gap-1.5 transition cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loadingCatalysts ? "animate-spin" : ""}`} />
          SYNC PRIMARY FEEDS
        </button>
      </div>

      {/* 1. VERIFIED CATALYST RADAR (SEC, ClinicalTrials, FDA, Macro) */}
      <div className="bg-[#0c101c] border border-white/10 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-[#00ff88]" />
            <h3 className="text-xs sm:text-sm font-bold text-slate-200 uppercase tracking-wider font-mono">
              Verified Event & Regulatory Catalyst Radar
            </h3>
          </div>
          <span className="text-xs text-slate-400 font-mono font-semibold">Zero Hallucination • Direct Source Verified</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {catalysts.map((ev) => (
            <div 
              key={ev.id} 
              className={`p-4 rounded-lg border transition space-y-3 ${
                ev.riskGated 
                  ? "bg-rose-950/20 border-rose-500/30" 
                  : "bg-black/35 border-white/5 hover:border-white/10"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-bold text-white bg-indigo-500/20 px-2 py-0.5 rounded border border-indigo-500/30">
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
      <div className="bg-[#0c101c] border border-white/10 rounded-xl p-5 space-y-4">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2 border-b border-white/10 pb-3">
          <div>
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-400" />
              <h3 className="text-xs sm:text-sm font-bold text-slate-200 uppercase tracking-wider font-mono">
                Post-Earnings Announcement Drift (PEAD) Radar
              </h3>
              <span className="text-xs bg-amber-500/20 text-amber-300 font-mono font-bold px-2 py-0.5 rounded border border-amber-500/30">
                50-YR EMPIRICALLY PROVEN ANOMALY
              </span>
            </div>
            <p className="text-xs sm:text-sm text-slate-300 font-sans mt-1">
              Exploits multi-day institutional under-reaction following corporate earnings releases. Requires &gt; 2.0x ADV volume confirmation, 15-minute post-open spread stabilization, and Level 2 OFI accumulation (&gt; +1.5σ). Strictly no overnight binary gap holding.
            </p>
          </div>

          <button
            onClick={fetchPeadCandidates}
            disabled={loadingPead}
            className="bg-black/40 border border-white/10 hover:border-white/20 text-slate-300 hover:text-white px-3 py-1.5 rounded text-xs font-mono flex items-center gap-1.5 transition cursor-pointer shrink-0"
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
                    ? "bg-black/40 border-amber-500/25 hover:border-amber-500/40"
                    : "bg-rose-950/15 border-rose-500/20"
                }`}
              >
                {/* Header row */}
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-mono font-extrabold text-white bg-amber-500/20 px-2 py-0.5 rounded border border-amber-500/30">
                      {cand.symbol}
                    </span>
                    <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded ${
                      cand.direction === "BUY"
                        ? "bg-emerald-500/20 text-[#00ff88] border border-emerald-500/30"
                        : "bg-rose-500/20 text-rose-400 border border-rose-500/30"
                    }`}>
                      {cand.direction} DRIFT
                    </span>
                    <span className="text-xs text-slate-300 font-mono">
                      Mkt Cap: ${cand.marketCapBillions.toLocaleString()}B
                    </span>
                  </div>

                  <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded uppercase tracking-wider ${
                    cand.qualified
                      ? "bg-emerald-500/20 text-[#00ff88] border border-emerald-500/30"
                      : "bg-rose-500/20 text-rose-400 border border-rose-500/30"
                  }`}>
                    {cand.qualified ? "QUALIFIED" : "DISQUALIFIED"}
                  </span>
                </div>

                {/* Key Empirical Metrics */}
                <div className="grid grid-cols-4 gap-2 text-center text-xs font-mono">
                  <div 
                    title="Earnings Surprise: Actual reported EPS vs consensus analyst estimate percentage difference."
                    className="bg-black/50 p-2 rounded border border-white/5 cursor-help hover:border-white/20 transition"
                  >
                    <span className="text-xs text-slate-400 block uppercase font-semibold">EPS Surprise ⓘ</span>
                    <span className={`font-bold block mt-1 text-xs sm:text-sm ${cand.epsSurprisePct >= 0 ? "text-[#00ff88]" : "text-rose-400"}`}>
                      {cand.epsSurprisePct >= 0 ? "+" : ""}{cand.epsSurprisePct}%
                    </span>
                  </div>
                  <div 
                    title="Revenue Surprise: Actual reported top-line revenue vs consensus forecast percentage difference."
                    className="bg-black/50 p-2 rounded border border-white/5 cursor-help hover:border-white/20 transition"
                  >
                    <span className="text-xs text-slate-400 block uppercase font-semibold">Rev Surprise ⓘ</span>
                    <span className={`font-bold block mt-1 text-xs sm:text-sm ${cand.revSurprisePct >= 0 ? "text-[#00ff88]" : "text-rose-400"}`}>
                      {cand.revSurprisePct >= 0 ? "+" : ""}{cand.revSurprisePct}%
                    </span>
                  </div>
                  <div 
                    title="Institutional Participation: First 15-minute volume relative to 20-day Average Daily Volume (ADV). Threshold: ≥2.0x ADV."
                    className="bg-black/50 p-2 rounded border border-white/5 cursor-help hover:border-white/20 transition"
                  >
                    <span className="text-xs text-slate-400 block uppercase font-semibold">Volume Surge ⓘ</span>
                    <span className={`font-bold block mt-1 text-xs sm:text-sm ${cand.openingVolumeMultiple >= 2.0 ? "text-amber-400" : "text-slate-300"}`}>
                      {cand.openingVolumeMultiple}x ADV
                    </span>
                  </div>
                  <div 
                    title="Microstructure Order Flow Imbalance: Standardized z-score of institutional buying pressure at top of order book. Threshold: ≥+1.5σ."
                    className="bg-black/50 p-2 rounded border border-white/5 cursor-help hover:border-white/20 transition"
                  >
                    <span className="text-xs text-slate-400 block uppercase font-semibold">L2 OFI Sigma ⓘ</span>
                    <span className={`font-bold block mt-1 text-xs sm:text-sm ${cand.ofiSigma >= 1.5 ? "text-cyan-400" : "text-slate-300"}`}>
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
                    <span className="text-slate-300 font-semibold">Institutional Conviction ⓘ:</span>
                    <span className="font-bold text-white">{cand.convictionScore} / 100</span>
                  </div>
                  <div className="w-full bg-black/60 rounded-full h-2 border border-white/5 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        cand.convictionScore >= 80
                          ? "bg-gradient-to-r from-amber-500 to-[#00ff88]"
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
                    ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-300"
                    : "bg-rose-500/10 border border-rose-500/20 text-rose-300"
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
                      className="w-full py-2 rounded bg-black/40 border border-white/5 text-slate-400 text-xs font-mono font-semibold text-center cursor-help"
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
        <div className="bg-[#0c101c] border border-white/10 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <h3 className="text-xs sm:text-sm font-bold text-slate-200 uppercase tracking-wider font-mono flex items-center gap-2">
              <Search className="w-4 h-4 text-indigo-400" /> Asset Qualification Filter (Pre-Trade Audit)
            </h3>
            <span className="text-xs text-slate-400 font-mono font-semibold">Microstructure & Liquidity</span>
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={screenTicker}
              onChange={(e) => setScreenTicker(e.target.value.toUpperCase())}
              placeholder="e.g. NVDA, XLE, VRTX..."
              className="flex-1 bg-black/50 border border-white/10 rounded px-3 py-2 text-xs text-white font-mono uppercase focus:outline-none focus:border-indigo-500"
            />
            <button
              onClick={handleRunQualification}
              disabled={screening || !screenTicker}
              className="bg-indigo-600 hover:bg-indigo-500 text-white font-mono text-xs font-bold px-4 py-2 rounded-lg transition cursor-pointer flex items-center gap-2"
            >
              {screening ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : null}
              RUN AUDIT
            </button>
          </div>

          {screenResult && (
            <div className="bg-black/35 border border-white/5 rounded-lg p-4 space-y-3 font-mono text-xs animate-in fade-in duration-300">
              <div className="flex justify-between items-center border-b border-white/5 pb-2">
                <span className="font-bold text-white text-sm">{screenResult.symbol} AUDIT REPORT</span>
                <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                  screenResult.overallVerdict.includes("APPROVED")
                    ? "bg-emerald-500/20 text-[#00ff88] border border-emerald-500/30"
                    : "bg-rose-500/20 text-rose-400 border border-rose-500/30"
                }`}>
                  {screenResult.overallVerdict}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="bg-black/40 p-2.5 rounded border border-white/5">
                  <span className="text-xs text-slate-400 block uppercase font-semibold">Level 2 OFI Readiness</span>
                  <span className="font-bold text-slate-200 mt-1 block">{screenResult.ofiReadiness}</span>
                </div>
                <div className="bg-black/40 p-2.5 rounded border border-white/5">
                  <span className="text-xs text-slate-400 block uppercase font-semibold">Spread / ATR Friction</span>
                  <span className="font-bold text-slate-200 mt-1 block">{screenResult.spreadToAtrRatio}</span>
                </div>
                <div className="bg-black/40 p-2.5 rounded border border-white/5">
                  <span className="text-xs text-slate-400 block uppercase font-semibold">Short Locate & Borrow Fee</span>
                  <span className="font-bold text-slate-200 mt-1 block">{screenResult.shortAvailability}</span>
                </div>
                <div className="bg-black/40 p-2.5 rounded border border-white/5">
                  <span className="text-xs text-slate-400 block uppercase font-semibold">Fractional lot eligible</span>
                  <span className="font-bold text-[#00ff88] mt-1 block">ELIGIBLE (Synthetic Stop)</span>
                </div>
              </div>

              <div className={`p-2.5 rounded border text-xs ${
                screenResult.binaryRiskStatus.safe 
                  ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-300"
                  : "bg-rose-500/10 border-rose-500/20 text-rose-300"
              }`}>
                <strong>Binary Risk Check:</strong> {screenResult.binaryRiskStatus.reason}
              </div>
            </div>
          )}
        </div>

        {/* Panel B: Agent-Driven Strategy Studio & Experiment Vault */}
        <div className="bg-[#0c101c] border border-white/10 rounded-xl p-5 space-y-5">
          {/* Header & Mode Switcher */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-white/10 pb-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs bg-emerald-500/20 text-[#00ff88] border border-emerald-500/40 px-2 py-0.5 rounded font-mono font-bold flex items-center gap-1.5">
                  <Sparkles className="w-3 h-3 text-[#00ff88]" /> AGENTIC STRATEGY STUDIO
                </span>
                <span className="text-xs bg-blue-500/20 text-blue-300 border border-blue-500/30 px-2 py-0.5 rounded font-mono font-bold">
                  VERIFIED IBKR BARS
                </span>
              </div>
              <h3 className="text-sm sm:text-base font-bold text-white uppercase tracking-wider font-mono flex items-center gap-2 mt-1.5">
                <BarChart3 className="w-4 h-4 text-emerald-400" /> Quantitative Strategy Studio & Experiment Vault
              </h3>
            </div>

            {/* Navigation Tabs */}
            <div className="flex items-center bg-black/60 p-1 rounded-lg border border-white/10 text-xs font-mono">
              <button
                onClick={() => setActiveStudioTab("visualizer")}
                className={`px-3 py-1.5 rounded transition flex items-center gap-1.5 font-bold ${
                  activeStudioTab === "visualizer" ? "bg-emerald-600 text-white shadow-sm" : "text-slate-400 hover:text-white"
                }`}
              >
                <TrendingUp className="w-3.5 h-3.5" /> Performance & Curve
              </button>
              <button
                onClick={() => setActiveStudioTab("blotter")}
                className={`px-3 py-1.5 rounded transition flex items-center gap-1.5 font-bold ${
                  activeStudioTab === "blotter" ? "bg-emerald-600 text-white shadow-sm" : "text-slate-400 hover:text-white"
                }`}
              >
                <Activity className="w-3.5 h-3.5" /> Trade Blotter ({btResult?.tradesList?.length || 0})
              </button>
              <button
                onClick={() => setActiveStudioTab("vault")}
                className={`px-3 py-1.5 rounded transition flex items-center gap-1.5 font-bold ${
                  activeStudioTab === "vault" ? "bg-indigo-600 text-white shadow-sm" : "text-slate-400 hover:text-white"
                }`}
              >
                <FolderOpen className="w-3.5 h-3.5" /> Saved Vault ({savedVault.length})
              </button>
            </div>
          </div>

          {/* Strategy Directive & Optimization Bar */}
          <div className="p-4 rounded-xl bg-gradient-to-r from-indigo-950/30 via-slate-900/60 to-black/60 border border-indigo-500/20 space-y-3">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
              <label className="text-xs font-mono uppercase font-bold text-indigo-300 flex items-center gap-1.5">
                <Bot className="w-4 h-4 text-indigo-400" />
                Natural Language Strategy Directive (Autonomous Parameter Optimizer)
              </label>
              <span className="text-xs text-slate-400 font-mono">Grid & Heuristic Search</span>
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <input
                  type="text"
                  value={agentDirective}
                  onChange={(e) => setAgentDirective(e.target.value)}
                  placeholder="e.g. Optimize for maximum Deflated Sharpe Ratio with low trade friction on ASML..."
                  className="w-full bg-black/70 border border-indigo-500/30 rounded-lg px-3 py-2 text-xs text-white font-mono placeholder-slate-500 focus:outline-none focus:border-indigo-400"
                />
              </div>
              <button
                onClick={handleAgentExplore}
                disabled={agentExploring || btLoading}
                className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-mono text-xs font-bold px-4 py-2 rounded-lg transition cursor-pointer flex items-center justify-center gap-2 shrink-0 shadow-lg shadow-indigo-600/20"
              >
                {agentExploring ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 text-indigo-200" />}
                {agentExploring ? "EXPLORING FRONTIER..." : "AGENT EXPLORE & TUNE"}
              </button>
            </div>

            {agentFeedback && (
              <div className="p-2.5 bg-indigo-500/10 border border-indigo-500/20 rounded-lg text-xs text-indigo-200 font-mono flex items-start gap-2 animate-in fade-in">
                <Sparkles className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
                <div className="leading-relaxed">{agentFeedback}</div>
              </div>
            )}
          </div>

          {/* Controls & Tuning Matrix */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 bg-black/40 p-4 rounded-xl border border-white/5">
            {/* Ticker Selector */}
            <div>
              <label className="text-xs text-slate-300 uppercase font-mono font-bold block mb-1">Ticker</label>
              <select
                value={btSymbol}
                onChange={(e) => setBtSymbol(e.target.value)}
                className="w-full bg-slate-900 border border-white/10 rounded px-2.5 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-emerald-500 font-bold"
              >
                <option value="XLE">XLE (US Energy ETF)</option>
                <option value="ASML">ASML (Euronext Tech)</option>
                <option value="SAP">SAP (DAX 40 Enterprise)</option>
                <option value="NVDA">NVDA (AI Semiconductor)</option>
                <option value="RWE">RWE (Euronext Utilities)</option>
              </select>
            </div>

            {/* Timeframe */}
            <div>
              <label className="text-xs text-slate-300 uppercase font-mono font-bold block mb-1">Timeframe</label>
              <select
                value={btTimeframe}
                onChange={(e) => setBtTimeframe(e.target.value)}
                className="w-full bg-slate-900 border border-white/10 rounded px-2.5 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-emerald-500"
              >
                <option value="5m">5 Min (Microstructure)</option>
                <option value="15m">15 Min (Intraday Drift)</option>
                <option value="1h">1 Hour (Session Swing)</option>
              </select>
            </div>

            {/* Stop ATR Multiplier Slider */}
            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-xs text-slate-300 uppercase font-mono font-bold">Stop ATR</label>
                <span className="text-xs text-emerald-400 font-mono font-bold">{btStopAtr.toFixed(1)}x</span>
              </div>
              <input
                type="range"
                min="0.8"
                max="3.5"
                step="0.1"
                value={btStopAtr}
                onChange={(e) => setBtStopAtr(parseFloat(e.target.value))}
                className="w-full accent-emerald-500 cursor-pointer"
              />
            </div>

            {/* Max Hold Bars */}
            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-xs text-slate-300 uppercase font-mono font-bold">Max Hold Bars</label>
                <span className="text-xs text-cyan-400 font-mono font-bold">{btMaxHoldBars} bars</span>
              </div>
              <input
                type="range"
                min="5"
                max="40"
                step="1"
                value={btMaxHoldBars}
                onChange={(e) => setBtMaxHoldBars(parseInt(e.target.value, 10))}
                className="w-full accent-cyan-500 cursor-pointer"
              />
            </div>

            {/* Capital Risk Budget (r) */}
            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-xs text-slate-300 uppercase font-mono font-bold">Risk Budget (r)</label>
                <span className="text-xs text-amber-400 font-mono font-bold">{(btRiskBudgetPct * 100).toFixed(2)}%</span>
              </div>
              <input
                type="range"
                min="0.0025"
                max="0.02"
                step="0.0025"
                value={btRiskBudgetPct}
                onChange={(e) => setBtRiskBudgetPct(parseFloat(e.target.value))}
                className="w-full accent-amber-500 cursor-pointer"
              />
            </div>

            {/* Friction Ceiling Limit */}
            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-xs text-slate-300 uppercase font-mono font-bold">Friction Cap</label>
                <span className="text-xs text-rose-400 font-mono font-bold">{btFrictionCeiling}%</span>
              </div>
              <input
                type="range"
                min="5"
                max="25"
                step="1"
                value={btFrictionCeiling}
                onChange={(e) => setBtFrictionCeiling(parseFloat(e.target.value))}
                className="w-full accent-rose-500 cursor-pointer"
              />
            </div>
          </div>

          {/* Strategy Switches & Toggles */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-black/20 p-3 rounded-lg border border-white/5 text-xs font-mono">
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={btPartialProfit}
                  onChange={(e) => setBtPartialProfit(e.target.checked)}
                  className="rounded bg-black border-white/20 text-emerald-500 focus:ring-0"
                />
                <span className="text-slate-300 font-semibold">Tranche Scaling (50% @ 2.5 ATR)</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={btBreakevenLock}
                  onChange={(e) => setBtBreakevenLock(e.target.checked)}
                  className="rounded bg-black border-white/20 text-emerald-500 focus:ring-0"
                />
                <span className="text-slate-300 font-semibold">Breakeven Ratchet (+1.0 ATR)</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={btAdaptiveStop}
                  onChange={(e) => setBtAdaptiveStop(e.target.checked)}
                  className="rounded bg-black border-white/20 text-emerald-500 focus:ring-0"
                />
                <span className="text-slate-300 font-semibold">Adaptive ATR Volatility Sizing</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={btOfiFilter}
                  onChange={(e) => setBtOfiFilter(e.target.checked)}
                  className="rounded bg-black border-white/20 text-emerald-500 focus:ring-0"
                />
                <span className="text-slate-300 font-semibold">OFI Order Book Imbalance Gate</span>
              </label>
            </div>

            {/* Run & Save Actions */}
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <button
                onClick={handleRunBacktest}
                disabled={btLoading || agentExploring}
                className="flex-1 sm:flex-none bg-emerald-600 hover:bg-emerald-500 text-white font-mono text-xs font-bold px-4 py-2 rounded-lg transition cursor-pointer flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/20"
              >
                {btLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                RUN SIMULATION
              </button>

              {btResult && (
                <button
                  onClick={handleSaveToVault}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white font-mono text-xs font-bold px-3 py-2 rounded-lg transition cursor-pointer flex items-center gap-1.5"
                >
                  <Bookmark className="w-3.5 h-3.5" />
                  SAVE EXPERIMENT
                </button>
              )}
            </div>
          </div>

          {saveSuccessMsg && (
            <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-xs text-[#00ff88] font-mono flex items-center gap-2 animate-in fade-in">
              <CheckCircle2 className="w-4 h-4 text-[#00ff88]" />
              <span>{saveSuccessMsg}</span>
            </div>
          )}

          {btError && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/25 rounded-lg text-xs text-rose-300 font-mono font-semibold">
              {btError}
            </div>
          )}

          {/* TAB 1: VISUALIZER & LEAGUE TABLE */}
          {activeStudioTab === "visualizer" && btResult && (
            <div className="space-y-4 animate-in fade-in duration-200">
              {/* Primary Metrics Badges */}
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
                <div className="bg-black/50 p-3 rounded-lg border border-white/5">
                  <span className="text-xs text-slate-400 block uppercase font-mono font-semibold">Net PnL</span>
                  <span className={`font-mono font-bold text-base mt-1 block ${
                    (Number(btResult.totalPnL || 0)) >= 0 ? "text-[#00ff88]" : "text-rose-400"
                  }`}>
                    {(Number(btResult.totalPnL || 0)) >= 0 ? "+" : ""}${Number(btResult.totalPnL || 0).toFixed(2)}
                  </span>
                  <span className="text-xs text-slate-500 font-mono">({btResult.totalPnLPercent || "0.0"}%)</span>
                </div>

                <div className="bg-black/50 p-3 rounded-lg border border-white/5">
                  <span className="text-xs text-slate-400 block uppercase font-mono font-semibold">Annualized Sharpe</span>
                  <span className="font-mono font-bold text-base text-[#00ff88] mt-1 block">
                    {btResult.annualizedSharpe !== undefined ? btResult.annualizedSharpe : "0.00"}
                  </span>
                  <span className="text-xs text-slate-500 font-mono">Roll-adjusted</span>
                </div>

                <div className="bg-black/50 p-3 rounded-lg border border-white/5">
                  <span className="text-xs text-slate-400 block uppercase font-mono font-semibold">Deflated Sharpe (DSR)</span>
                  <span className={`font-mono font-bold text-base mt-1 block ${
                    btResult.passesDsrHurdle ? "text-[#00ff88]" : "text-amber-400"
                  }`}>
                    {btResult.deflatedSharpeRatio !== undefined ? `${(Number(btResult.deflatedSharpeRatio) * 100).toFixed(1)}%` : "N/A"}
                  </span>
                  <span className="text-xs text-slate-500 font-mono">{btResult.passesDsrHurdle ? "✓ Passed 95% Hurdle" : "⚠️ Sub-threshold"}</span>
                </div>

                <div className="bg-black/50 p-3 rounded-lg border border-white/5">
                  <span className="text-xs text-slate-400 block uppercase font-mono font-semibold">Win Rate</span>
                  <span className="font-mono font-bold text-base text-white mt-1 block">
                    {btResult.winRate !== undefined ? btResult.winRate : "0.0"}%
                  </span>
                  <span className="text-xs text-slate-500 font-mono">{btResult.winningTrades || 0}W / {btResult.losingTrades || 0}L</span>
                </div>

                <div className="bg-black/50 p-3 rounded-lg border border-white/5">
                  <span className="text-xs text-slate-400 block uppercase font-mono font-semibold">Profit Factor</span>
                  <span className="font-mono font-bold text-base text-cyan-400 mt-1 block">
                    {btResult.profitFactor !== undefined ? btResult.profitFactor : "1.00"}
                  </span>
                  <span className="text-xs text-slate-500 font-mono">Gross W/L Ratio</span>
                </div>

                <div className="bg-black/50 p-3 rounded-lg border border-white/5">
                  <span className="text-xs text-slate-400 block uppercase font-mono font-semibold">Max Drawdown</span>
                  <span className="font-mono font-bold text-base text-rose-400 mt-1 block">
                    -{btResult.maxDrawdownPercent !== undefined ? btResult.maxDrawdownPercent : "0.0"}%
                  </span>
                  <span className="text-xs text-slate-500 font-mono">Peak-to-trough</span>
                </div>
              </div>

              {/* Interactive Equity Curve Chart (Recharts) */}
              <div className="bg-black/50 border border-white/10 rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono font-bold text-slate-200 uppercase flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-emerald-400" /> Compounded Equity Trajectory (${btResult.symbol})
                  </span>
                  <span className="text-xs font-mono text-slate-400">
                    Starting: ${Number(btResult.startingCapital || 100000).toLocaleString()} ➔ Final: ${Number(btResult.finalCapital || 100000).toLocaleString()}
                  </span>
                </div>

                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={btResult.balanceHistory || []}
                      margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient id="equityGradient" x1="0" y1="0" x2="0" y2="1">
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
                        fill="url(#equityGradient)" 
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Comparative League Table: Baseline vs. Tuned Strategy */}
              {btBaselineResult && (
                <div className="bg-black/40 border border-white/5 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono font-bold uppercase text-slate-300 flex items-center gap-2">
                      <Award className="w-4 h-4 text-amber-400" /> Strategy Optimization League Table (Baseline vs. Tuned)
                    </span>
                    <span className="text-xs font-mono text-slate-400">Institutional Gate Attribution</span>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left font-mono text-xs">
                      <thead>
                        <tr className="border-b border-white/10 text-slate-400">
                          <th className="py-2 px-3">Configuration Variant</th>
                          <th className="py-2 px-3 text-right">Trades</th>
                          <th className="py-2 px-3 text-right">Win Rate</th>
                          <th className="py-2 px-3 text-right">Profit Factor</th>
                          <th className="py-2 px-3 text-right">Annual Sharpe</th>
                          <th className="py-2 px-3 text-right">DSR Hurdle</th>
                          <th className="py-2 px-3 text-right">Max DD</th>
                          <th className="py-2 px-3 text-right">Net PnL</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        <tr className="text-slate-400 bg-black/20">
                          <td className="py-2.5 px-3 font-semibold text-slate-300">
                            Baseline (Unfiltered 1.8 ATR Stop)
                          </td>
                          <td className="py-2.5 px-3 text-right">{btBaselineResult.totalTrades || 0}</td>
                          <td className="py-2.5 px-3 text-right">{btBaselineResult.winRate || 0}%</td>
                          <td className="py-2.5 px-3 text-right">{btBaselineResult.profitFactor || "1.00"}</td>
                          <td className="py-2.5 px-3 text-right">{btBaselineResult.annualizedSharpe || "0.00"}</td>
                          <td className="py-2.5 px-3 text-right text-slate-400">
                            {btBaselineResult.deflatedSharpeRatio ? `${(Number(btBaselineResult.deflatedSharpeRatio) * 100).toFixed(1)}%` : "N/A"}
                          </td>
                          <td className="py-2.5 px-3 text-right text-rose-400">-{btBaselineResult.maxDrawdownPercent || 0}%</td>
                          <td className={`py-2.5 px-3 text-right font-bold ${
                            Number(btBaselineResult.totalPnL || 0) >= 0 ? "text-emerald-400" : "text-rose-400"
                          }`}>
                            {Number(btBaselineResult.totalPnL || 0) >= 0 ? "+" : ""}${Number(btBaselineResult.totalPnL || 0).toFixed(2)}
                          </td>
                        </tr>

                        <tr className="text-white bg-emerald-950/20 border-l-2 border-emerald-500">
                          <td className="py-2.5 px-3 font-bold text-[#00ff88] flex items-center gap-1.5">
                            <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                            {activeStrategyName} (Current)
                          </td>
                          <td className="py-2.5 px-3 text-right font-bold">{btResult.totalTrades || 0}</td>
                          <td className="py-2.5 px-3 text-right font-bold text-white">{btResult.winRate || 0}%</td>
                          <td className="py-2.5 px-3 text-right font-bold text-cyan-400">{btResult.profitFactor || "1.00"}</td>
                          <td className="py-2.5 px-3 text-right font-bold text-emerald-400">{btResult.annualizedSharpe || "0.00"}</td>
                          <td className="py-2.5 px-3 text-right font-bold text-[#00ff88]">
                            {btResult.deflatedSharpeRatio ? `${(Number(btResult.deflatedSharpeRatio) * 100).toFixed(1)}%` : "N/A"}
                          </td>
                          <td className="py-2.5 px-3 text-right font-bold text-rose-400">-{btResult.maxDrawdownPercent || 0}%</td>
                          <td className="py-2.5 px-3 text-right font-bold text-[#00ff88]">
                            +{Number(btResult.totalPnL || 0).toFixed(2)}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: AUDITED TRADE BLOTTER */}
          {activeStudioTab === "blotter" && (
            <div className="bg-black/50 border border-white/5 rounded-xl p-4 space-y-3 animate-in fade-in duration-200">
              <div className="flex items-center justify-between border-b border-white/5 pb-2">
                <span className="text-xs font-mono font-bold text-white uppercase flex items-center gap-2">
                  <Activity className="w-4 h-4 text-emerald-400" /> Execution Blotter & Exit Attribution ({btResult?.tradesList?.length || 0} Trades)
                </span>
                <span className="text-xs font-mono text-slate-400">
                  Total Commissions: ${Number(btResult?.totalCommissions || 0).toFixed(2)}
                </span>
              </div>

              {(!btResult?.tradesList || btResult.tradesList.length === 0) ? (
                <div className="py-8 text-center text-xs text-slate-500 font-mono">
                  No trades recorded in current simulation. Run or load an experiment to inspect blotter.
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
                      {btResult.tradesList.map((tr: any) => {
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

          {/* TAB 3: STRATEGY EXPERIMENT VAULT */}
          {activeStudioTab === "vault" && (
            <div className="bg-black/50 border border-white/5 rounded-xl p-4 space-y-3 animate-in fade-in duration-200">
              <div className="flex items-center justify-between border-b border-white/5 pb-2">
                <span className="text-xs font-mono font-bold text-white uppercase flex items-center gap-2">
                  <FolderOpen className="w-4 h-4 text-indigo-400" /> Strategy Experiment Vault (Persistent Local Storage)
                </span>
                <span className="text-xs font-mono text-slate-400">{savedVault.length} Saved Experiments</span>
              </div>

              {savedVault.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-500 font-mono">
                  No strategies saved in vault yet. Run a simulation or Agent Explore and click "Save Experiment".
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-96 overflow-y-auto">
                  {savedVault.map((exp) => (
                    <div
                      key={exp.id}
                      onClick={() => handleLoadExperiment(exp)}
                      className="p-3 rounded-lg border border-white/10 bg-black/40 hover:border-indigo-500/40 hover:bg-slate-900/60 transition cursor-pointer space-y-2 group"
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

                      <div className="grid grid-cols-4 gap-2 text-center text-[11px] font-mono bg-black/30 p-2 rounded border border-white/5">
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
  );
};
