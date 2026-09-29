import React, { useState, useEffect } from "react";
import { 
  ShieldAlert, 
  ShieldCheck, 
  Sliders, 
  AlertTriangle, 
  RefreshCw, 
  CheckCircle2, 
  TrendingUp, 
  Activity, 
  Server, 
  Zap, 
  Lock, 
  Unlock,
  DollarSign,
  Clock
} from "lucide-react";

interface RiskStatus {
  dailyCapitalCeiling: number;
  dailyCapitalUtilized: number;
  dailyMaxLossCutoff: number;
  currentDailyPnL: number;
  fractionalTradingEnabled: boolean;
  intradayFlatteningEnabled?: boolean;
  intradayFlattenTimeEST?: string;
  intradayFlattenTimeCET?: string;
  nyTimeEST?: string;
  cetTimeCET?: string;
  usMarketOpen?: boolean;
  euMarketOpen?: boolean;
  marketScope?: "ALL" | "US" | "EUROPE";
  killSwitchEngaged: boolean;
  tradingMode: "PAPER" | "LIVE";
  tcpLatencyMs: number;
  netLiquidation: number;
  maintenanceMargin: number;
  activePositionsCount: number;
}

interface ExecutionRecord {
  id: string;
  timestamp: string;
  symbol: string;
  side: "BUY" | "SELL";
  qty: number;
  orderType: string;
  status: "FILLED" | "PENDING" | "CANCELLED" | "REJECTED";
  arrivalPrice: number;
  fillPrice: number;
  slippageBps: number;
  commission: number;
  currency: string;
}

interface LiveCockpitProps {
  systemState?: any;
  onRefresh?: () => void;
}

export const LiveCockpit: React.FC<LiveCockpitProps> = ({ systemState, onRefresh }) => {
  const [riskStatus, setRiskStatus] = useState<RiskStatus | null>(null);
  const [blotter, setBlotter] = useState<ExecutionRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Risk inputs (stored as strings to prevent leading zero 0XXX formatting bugs)
  const [capCeilingInput, setCapCeilingInput] = useState<string>("10000");
  const [maxLossInput, setMaxLossInput] = useState<string>("250");
  const [fractionalToggle, setFractionalToggle] = useState<boolean>(true);
  const [intradayFlattenToggle, setIntradayFlattenToggle] = useState<boolean>(true);
  const [modeToggle, setModeToggle] = useState<"PAPER" | "LIVE">("PAPER");
  const [marketScopeToggle, setMarketScopeToggle] = useState<"ALL" | "US" | "EUROPE">("ALL");
  const [blotterMarketFilter, setBlotterMarketFilter] = useState<"ALL" | "US" | "EUROPE">("ALL");
  
  // Intraday manual flattening state
  const [isFlatteningIntraday, setIsFlatteningIntraday] = useState(false);
  const [intradayMsg, setIntradayMsg] = useState<string | null>(null);

  // Track if user inputs have been initialized from the server
  const [hasInitializedInputs, setHasInitializedInputs] = useState(false);

  // Kill switch modal state
  const [confirmKill, setConfirmKill] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Fetch live risk status and blotter
  const fetchRiskData = async () => {
    try {
      const [resRisk, resBlotter] = await Promise.all([
        fetch("/api/risk/status"),
        fetch("/api/execution/blotter")
      ]);
      
      if (resRisk.ok) {
        const data = await resRisk.json();
        setRiskStatus(data);
        // Only set form inputs on initial mount so we never overwrite what the user is typing
        if (!hasInitializedInputs) {
          setCapCeilingInput(String(data.dailyCapitalCeiling ?? 10000));
          setMaxLossInput(String(data.dailyMaxLossCutoff ?? 250));
          setFractionalToggle(data.fractionalTradingEnabled);
          if (data.intradayFlatteningEnabled !== undefined) {
            setIntradayFlattenToggle(data.intradayFlatteningEnabled);
          }
          if (data.marketScope) {
            setMarketScopeToggle(data.marketScope);
          }
          setModeToggle(data.tradingMode);
          setHasInitializedInputs(true);
        }
      }
      
      if (resBlotter.ok) {
        const blotterData = await resBlotter.json();
        setBlotter(blotterData.blotter || []);
      }
    } catch (err: any) {
      console.error("Failed to fetch risk data:", err);
    }
  };

  useEffect(() => {
    fetchRiskData();
    const interval = setInterval(fetchRiskData, 4000);
    return () => clearInterval(interval);
  }, [hasInitializedInputs]);

  // Save risk configuration
  const handleSaveRiskSettings = async () => {
    setLoading(true);
    setError(null);
    setSaveSuccess(false);
    try {
      const parsedCap = Number(capCeilingInput);
      const parsedLoss = Number(maxLossInput);
      const safeCap = !isNaN(parsedCap) && parsedCap > 0 ? parsedCap : 500;
      const safeLoss = !isNaN(parsedLoss) && parsedLoss > 0 ? parsedLoss : 50;

      const res = await fetch("/api/risk/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dailyCapitalCeiling: safeCap,
          dailyMaxLossCutoff: safeLoss,
          fractionalTradingEnabled: Boolean(fractionalToggle),
          intradayFlatteningEnabled: Boolean(intradayFlattenToggle),
          tradingMode: modeToggle,
          marketScope: marketScopeToggle
        })
      });
      if (res.ok) {
        const result = await res.json();
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3000);
        if (result.settings) {
          setCapCeilingInput(String(result.settings.dailyCapitalCeiling));
          setMaxLossInput(String(result.settings.dailyMaxLossCutoff));
          setRiskStatus(prev => prev ? {
            ...prev,
            dailyCapitalCeiling: result.settings.dailyCapitalCeiling,
            dailyMaxLossCutoff: result.settings.dailyMaxLossCutoff,
            fractionalTradingEnabled: result.settings.fractionalTradingEnabled,
            intradayFlatteningEnabled: result.settings.intradayFlatteningEnabled,
            tradingMode: result.settings.tradingMode,
            marketScope: result.settings.marketScope
          } : null);
        }
      } else {
        setError("Failed to update risk parameters on gateway.");
      }
    } catch (err: any) {
      setError(err.message || "Network error updating risk settings.");
    } finally {
      setLoading(false);
    }
  };

  // Immediate Intraday Market-on-Close Flush
  const handleFlattenIntraday = async () => {
    setIsFlatteningIntraday(true);
    setIntradayMsg(null);
    try {
      const res = await fetch("/api/risk/flatten-intraday", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Manual Operator 15:45 MOC Execution Rule" })
      });
      const data = await res.json();
      if (res.ok) {
        setIntradayMsg(`MOC Executed: Flattened ${data.liquidatedCount || 0} position(s). Zero overnight exposure.`);
        setTimeout(() => setIntradayMsg(null), 4000);
        await fetchRiskData();
        if (onRefresh) onRefresh();
      }
    } catch (err: any) {
      console.error("Failed to execute intraday flatten:", err);
    } finally {
      setIsFlatteningIntraday(false);
    }
  };

  // Trigger Emergency Kill Switch
  const handleEmergencyKill = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/risk/emergency-kill", { method: "POST" });
      if (res.ok) {
        setConfirmKill(false);
        fetchRiskData();
        if (onRefresh) onRefresh();
      } else {
        setError("Kill switch execution failed on server.");
      }
    } catch (err: any) {
      setError(err.message || "Network error dispatching kill switch.");
    } finally {
      setLoading(false);
    }
  };

  // Unlock system
  const handleUnlockSystem = async () => {
    setLoading(true);
    try {
      await fetch("/api/risk/unlock", { method: "POST" });
      fetchRiskData();
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const isLive = riskStatus?.tradingMode === "LIVE";
  const isLocked = riskStatus?.killSwitchEngaged;
  const utilizedCap = riskStatus?.dailyCapitalUtilized || 0;
  const maxCap = (riskStatus?.dailyCapitalCeiling !== undefined && riskStatus.dailyCapitalCeiling > 0) 
    ? riskStatus.dailyCapitalCeiling 
    : 10000;
  const capPct = Math.min(100, Math.round((utilizedCap / (maxCap || 1)) * 100));
  const dailyPnL = riskStatus?.currentDailyPnL || 0;
  const maxLoss = riskStatus?.dailyMaxLossCutoff || 250;
  const lossDistance = maxLoss + dailyPnL; // Positive if safe

  return (
    <div className="space-y-6">
      {/* 1. TOP STATUS BAR & SAFETY AIRBAG */}
      <div className={`p-4 rounded-xl border flex flex-col md:flex-row items-start md:items-center justify-between gap-4 transition-all duration-300 ${
        isLocked
          ? "bg-rose-950/40 border-rose-500/60 shadow-lg shadow-rose-950/50"
          : isLive 
            ? "bg-amber-950/30 border-amber-500/50" 
            : "bg-[#0b101b] border-emerald-500/30"
      }`}>
        <div className="flex items-center gap-3">
          <div className={`p-2.5 rounded-lg border ${
            isLocked 
              ? "bg-rose-500/20 border-rose-500/40 text-rose-400 animate-pulse" 
              : isLive 
                ? "bg-amber-500/20 border-amber-500/40 text-amber-400" 
                : "bg-emerald-500/20 border-emerald-500/40 text-[#00ff88]"
          }`}>
            {isLocked ? <Lock className="w-5 h-5" /> : isLive ? <AlertTriangle className="w-5 h-5" /> : <ShieldCheck className="w-5 h-5" />}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className={`text-xs font-mono font-black uppercase px-2 py-0.5 rounded tracking-widest ${
                isLocked
                  ? "bg-rose-600 text-white animate-bounce"
                  : isLive
                    ? "bg-amber-500 text-black font-extrabold"
                    : "bg-emerald-500/20 border border-emerald-500/40 text-[#00ff88]"
              }`}>
                {isLocked ? "ROUTER HARD-LOCKED" : isLive ? "🔴 LIVE CAPITAL AT RISK" : "🟡 PAPER SIMULATION"}
              </span>
              <span className="text-[10px] text-slate-400 font-mono">
                IBKR IE: {riskStatus?.tradingMode === "LIVE" ? "U8129384" : "DU902144"}
              </span>
            </div>
            <div className="text-[11px] text-slate-300 font-sans mt-0.5">
              {isLocked 
                ? "Emergency Kill Switch engaged. All market orders halted." 
                : isLive 
                  ? "Production gateway active. Real money execution enabled under strict CBI/MiFID II risk gates." 
                  : "Virtual matching engine running against live Level 2 microstructure data."}
            </div>
          </div>
        </div>

        {/* Telemetry Metrics & Global Market Clocks */}
        <div className="flex flex-wrap items-center gap-4 sm:gap-6 font-mono text-right">
          <div className="bg-black/40 border border-white/5 px-2.5 py-1 rounded text-right">
            <div className="flex items-center justify-end gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${riskStatus?.euMarketOpen ? "bg-[#00ff88] animate-pulse" : "bg-slate-500"}`} />
              <span className="text-[9px] text-slate-300 font-bold">🇪🇺 EURONEXT/XETRA</span>
              <span className={`text-[8px] font-bold px-1 rounded ${riskStatus?.euMarketOpen ? "bg-emerald-500/20 text-[#00ff88]" : "bg-slate-800 text-slate-400"}`}>
                {riskStatus?.euMarketOpen ? "OPEN" : "CLOSED"}
              </span>
            </div>
            <span className="text-[9px] text-slate-400">CET {riskStatus?.cetTimeCET || "--:--"}</span>
          </div>

          <div className="bg-black/40 border border-white/5 px-2.5 py-1 rounded text-right">
            <div className="flex items-center justify-end gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${riskStatus?.usMarketOpen ? "bg-blue-400 animate-pulse" : "bg-slate-500"}`} />
              <span className="text-[9px] text-slate-300 font-bold">🇺🇸 NYSE/NASDAQ</span>
              <span className={`text-[8px] font-bold px-1 rounded ${riskStatus?.usMarketOpen ? "bg-blue-500/20 text-blue-300" : "bg-slate-800 text-slate-400"}`}>
                {riskStatus?.usMarketOpen ? "OPEN" : "CLOSED"}
              </span>
            </div>
            <span className="text-[9px] text-slate-400">EST {riskStatus?.nyTimeEST || "--:--"}</span>
          </div>

          <div>
            <span className="text-[9px] text-slate-400 uppercase tracking-wider block">TCP PING</span>
            <span className="text-xs text-[#00ff88] font-bold flex items-center justify-end gap-1">
              <Activity className="w-3 h-3 animate-pulse" /> {riskStatus?.tcpLatencyMs || 14.2} ms
            </span>
          </div>
          <div>
            <span className="text-[9px] text-slate-400 uppercase tracking-wider block">NET LIQUIDATION</span>
            <span className="text-xs text-white font-bold">
              ${(riskStatus?.netLiquidation || 154200).toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </span>
          </div>
          <div>
            <span className="text-[9px] text-slate-400 uppercase tracking-wider block">DAY P&L</span>
            <span className={`text-xs font-bold ${dailyPnL >= 0 ? "text-[#00ff88]" : "text-rose-400"}`}>
              {dailyPnL >= 0 ? "+" : ""}${dailyPnL.toFixed(2)}
            </span>
          </div>
        </div>
      </div>

      {/* 2. OPERATIONAL GRID: RISK CONTROLS & KILL SWITCH */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Panel A: Pre-Trade Risk Gateway Controls */}
        <div className="lg:col-span-2 bg-[#0c101c] border border-white/10 rounded-xl p-5 space-y-5">
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2 font-mono">
              <Sliders className="w-4 h-4 text-indigo-400" /> Pre-Trade Risk Gateway & Capital Allocation
            </h3>
            <span className="text-[9.5px] text-slate-400 font-mono">MiFID II / SEC Rule 15c3-5 Gatekeeper</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {/* Daily Capital Allocation */}
            <div 
              title="SEC Rule 15c3-5 Pre-Trade Gateway: Total gross capital committed across all open trades cannot exceed this ceiling. Orders exceeding this are rejected pre-trade."
              className="bg-black/40 border border-white/5 rounded-lg p-3.5 space-y-1.5 hover:border-white/10 transition"
            >
              <div className="flex justify-between items-center">
                <label className="text-[10px] text-slate-400 uppercase font-mono font-bold flex items-center gap-1 cursor-help">
                  Daily Capital Ceiling <span className="text-[9px] text-indigo-400">ⓘ</span>
                </label>
                <DollarSign className="w-3.5 h-3.5 text-indigo-400" />
              </div>
              <div className="relative">
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={capCeilingInput}
                  onChange={(e) => {
                    let val = e.target.value.replace(/[^0-9]/g, "");
                    // Automatically strip leading zero(s) if user types digits after 0 (e.g. "0200" -> "200")
                    if (val.length > 1 && val.startsWith("0")) {
                      val = val.replace(/^0+/, "");
                    }
                    setCapCeilingInput(val);
                  }}
                  onBlur={() => {
                    if (!capCeilingInput || Number(capCeilingInput) <= 0) {
                      setCapCeilingInput("500");
                    }
                  }}
                  placeholder="500"
                  className="w-full bg-black/60 border border-white/10 rounded px-2.5 py-1.5 text-xs text-white font-mono focus:border-indigo-500 focus:outline-none"
                />
                <span title="Applies to your account base currency (USD or EUR)" className="absolute right-2.5 top-2 text-[9px] text-indigo-300 font-mono cursor-help">USD / EUR</span>
              </div>
              <div className="flex items-center gap-1 pt-0.5">
                <span className="text-[8px] text-slate-500 uppercase font-mono">Preset:</span>
                {["200", "500", "1000", "5000", "10000"].map((amt) => (
                  <button
                    key={amt}
                    type="button"
                    onClick={() => setCapCeilingInput(amt)}
                    className={`px-1.5 py-0.5 text-[8.5px] font-mono rounded border transition cursor-pointer ${
                      capCeilingInput === amt
                        ? "bg-indigo-600/40 text-indigo-300 border-indigo-500"
                        : "bg-white/5 text-slate-400 border-white/5 hover:bg-white/10 hover:text-slate-200"
                    }`}
                  >
                    ${amt}
                  </button>
                ))}
              </div>
              <div className="text-[9px] text-slate-400">
                Utilized: <strong className="text-slate-200">${utilizedCap.toFixed(2)}</strong> ({capPct}%)
              </div>
              <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                <div 
                  className={`h-full transition-all duration-300 ${capPct > 80 ? "bg-rose-500" : "bg-indigo-500"}`}
                  style={{ width: `${capPct}%` }}
                />
              </div>
            </div>

            {/* Hard Daily Loss Circuit Breaker */}
            <div 
              title="Hard Daily Circuit Breaker: If cumulative intraday loss reaches this threshold, all open orders are cancelled, active positions are flattened at market, and execution router is hard-locked."
              className="bg-black/40 border border-white/5 rounded-lg p-3.5 space-y-1.5 hover:border-white/10 transition"
            >
              <div className="flex justify-between items-center">
                <label className="text-[10px] text-slate-400 uppercase font-mono font-bold flex items-center gap-1 cursor-help">
                  Hard Daily Loss Cutoff <span className="text-[9px] text-rose-400">ⓘ</span>
                </label>
                <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
              </div>
              <div className="relative">
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={maxLossInput}
                  onChange={(e) => {
                    let val = e.target.value.replace(/[^0-9]/g, "");
                    if (val.length > 1 && val.startsWith("0")) {
                      val = val.replace(/^0+/, "");
                    }
                    setMaxLossInput(val);
                  }}
                  onBlur={() => {
                    if (!maxLossInput || Number(maxLossInput) <= 0) {
                      setMaxLossInput("50");
                    }
                  }}
                  placeholder="50"
                  className="w-full bg-black/60 border border-white/10 rounded px-2.5 py-1.5 text-xs text-rose-300 font-mono focus:border-rose-500 focus:outline-none"
                />
                <span title="Applies to your account base currency (USD or EUR)" className="absolute right-2.5 top-2 text-[9px] text-rose-300 font-mono cursor-help">USD / EUR</span>
              </div>
              <div className="flex items-center gap-1 pt-0.5">
                <span className="text-[8px] text-slate-500 uppercase font-mono">Preset:</span>
                {["50", "100", "250", "500"].map((amt) => (
                  <button
                    key={amt}
                    type="button"
                    onClick={() => setMaxLossInput(amt)}
                    className={`px-1.5 py-0.5 text-[8.5px] font-mono rounded border transition cursor-pointer ${
                      maxLossInput === amt
                        ? "bg-rose-600/40 text-rose-300 border-rose-500"
                        : "bg-white/5 text-slate-400 border-white/5 hover:bg-white/10 hover:text-slate-200"
                    }`}
                  >
                    ${amt}
                  </button>
                ))}
              </div>
              <div className="text-[9px] text-slate-400">
                Buffer: <strong className={lossDistance > 50 ? "text-[#00ff88]" : "text-amber-400"}>${lossDistance.toFixed(2)}</strong> to auto-lock
              </div>
              <p className="text-[8.5px] text-slate-400 leading-tight">
                Auto-flattens portfolio and locks execution if daily loss exceeds this value.
              </p>
            </div>

            {/* Fractional Trading Compliance */}
            <div 
              title="IBKR Fractional Lot Rule: IBKR rejects native STP/STP LMT orders on fractional quantities. Synthetic Stops run in memory, triggering fractional MKT/LMT DAY exits when price crosses."
              className="bg-black/40 border border-white/5 rounded-lg p-3.5 space-y-2 hover:border-white/10 transition"
            >
              <div className="flex justify-between items-center">
                <label className="text-[10px] text-slate-400 uppercase font-mono font-bold flex items-center gap-1 cursor-help">
                  Fractional Execution <span className="text-[9px] text-emerald-400">ⓘ</span>
                </label>
                <span className="text-[9px] bg-emerald-500/20 text-[#00ff88] px-1.5 py-0.5 rounded font-mono font-bold">
                  SYNTHETIC STOPS
                </span>
              </div>
              <div className="flex items-center justify-between pt-1">
                <span className="text-xs text-slate-300 font-sans">Allow Decimal Lots</span>
                <button
                  type="button"
                  onClick={() => setFractionalToggle(!fractionalToggle)}
                  className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer ${
                    fractionalToggle ? "bg-emerald-600" : "bg-slate-700"
                  }`}
                >
                  <span className={`block w-4 h-4 rounded-full bg-white transition-transform ${
                    fractionalToggle ? "translate-x-6" : "translate-x-1"
                  }`} />
                </button>
              </div>
              <p className="text-[8.5px] text-slate-400 leading-tight">
                IBKR-compliant synthetic exit triggers bypass broker fractional stop rejections.
              </p>
            </div>

            {/* Intraday Auto-Flatten Controller (15:45 EST MOC) */}
            <div 
              title="Market-on-Close (MOC) Rule: Automatically flattens open intraday positions at 15:45 EST (US) and 17:15 CET (Europe) to eliminate overnight gap risk. Multi-day PEAD swings remain protected."
              className="bg-black/40 border border-white/5 rounded-lg p-3.5 space-y-2 hover:border-white/10 transition"
            >
              <div className="flex justify-between items-center">
                <label className="text-[10px] text-slate-400 uppercase font-mono font-bold flex items-center gap-1 cursor-help">
                  Auto-Flatten Intraday <span className="text-[9px] text-amber-400">ⓘ</span>
                </label>
                <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono font-bold ${
                  intradayFlattenToggle ? "bg-emerald-500/20 text-[#00ff88]" : "bg-amber-500/20 text-amber-400"
                }`}>
                  {intradayFlattenToggle ? "15:45 EST MOC" : "SWING ALLOWED"}
                </span>
              </div>
              <div className="flex items-center justify-between pt-1">
                <span className="text-xs text-slate-300 font-sans">0 Overnight Exposure</span>
                <button
                  type="button"
                  onClick={() => setIntradayFlattenToggle(!intradayFlattenToggle)}
                  className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer ${
                    intradayFlattenToggle ? "bg-emerald-600" : "bg-slate-700"
                  }`}
                >
                  <span className={`block w-4 h-4 rounded-full bg-white transition-transform ${
                    intradayFlattenToggle ? "translate-x-6" : "translate-x-1"
                  }`} />
                </button>
              </div>
              <div className="flex justify-between items-center text-[9px] font-mono text-slate-400">
                <span>EST: <strong className="text-slate-200">{riskStatus?.nyTimeEST || "--:--"}</strong></span>
                <span>CET: <strong className="text-slate-200">{riskStatus?.cetTimeCET || "--:--"}</strong></span>
              </div>
              <button
                type="button"
                onClick={handleFlattenIntraday}
                disabled={isFlatteningIntraday || (riskStatus?.activePositionsCount || 0) === 0}
                className="w-full mt-1 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 text-[9.5px] font-mono font-bold py-1 rounded transition disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-1 cursor-pointer"
              >
                {isFlatteningIntraday ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Clock className="w-3 h-3" />}
                FLATTEN INTRADAY NOW
              </button>
            </div>
          </div>

          {/* Lifecycle & Feedback Sub-Bar */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-2 px-3 py-2 bg-black/30 border border-white/5 rounded-lg text-[9.5px] font-mono">
            <div className="flex items-center gap-2 text-slate-400">
              <span className="text-indigo-400 font-bold">PEAD & INTRADAY LIFECYCLE:</span>
              <span title="When profit reaches +1.0x ATR, stop moves to entry price ($0 downside risk)">
                Breakeven Latch: <strong className="text-emerald-400 cursor-help">+1.0x ATR ⓘ</strong>
              </span>
              <span>•</span>
              <span title="At +2.0x ATR profit, scales out 50% of position size and ratchets runner stop to +0.5x ATR locked profit">
                Tiered Scale-Out: <strong className="text-emerald-400 cursor-help">+2.0x ATR (50%) ⓘ</strong>
              </span>
            </div>
            {intradayMsg && (
              <span className="text-[#00ff88] font-bold animate-pulse">{intradayMsg}</span>
            )}
          </div>

          {/* Action Bar */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 border-t border-white/5">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-slate-400 uppercase font-mono">Target Mode:</span>
                <select
                  value={modeToggle}
                  onChange={(e) => setModeToggle(e.target.value as "PAPER" | "LIVE")}
                  className="bg-black/60 border border-white/10 rounded px-2.5 py-1 text-xs text-white font-mono focus:outline-none"
                >
                  <option value="PAPER">PAPER (Port 4002 / DU...)</option>
                  <option value="LIVE">LIVE (Port 4001 / U...)</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[10px] text-slate-400 uppercase font-mono" title="Pre-Trade Gate 0 Market Isolation: Restrict trading to US only, Europe only, or all markets">
                  Market Scope:
                </span>
                <select
                  value={marketScopeToggle}
                  onChange={(e) => setMarketScopeToggle(e.target.value as "ALL" | "US" | "EUROPE")}
                  className="bg-black/60 border border-white/10 rounded px-2.5 py-1 text-xs text-white font-mono focus:outline-none"
                >
                  <option value="ALL">🌐 ALL MARKETS (US & Europe)</option>
                  <option value="US">🇺🇸 US ONLY (USD - NYSE/NASDAQ)</option>
                  <option value="EUROPE">🇪🇺 EUROPE ONLY (EUR - Euronext/XETRA)</option>
                </select>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {saveSuccess && (
                <span className="text-xs text-[#00ff88] font-mono flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Parameters Synced
                </span>
              )}
              {error && <span className="text-xs text-rose-400 font-mono">{error}</span>}
              <button
                onClick={handleSaveRiskSettings}
                disabled={loading}
                className="bg-indigo-600 hover:bg-indigo-500 text-white font-mono text-xs font-bold px-4 py-1.5 rounded transition cursor-pointer flex items-center gap-1.5"
              >
                {loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : null}
                APPLY RISK GATES
              </button>
            </div>
          </div>
        </div>

        {/* Panel B: Hard Physical Kill Switch */}
        <div className={`border rounded-xl p-5 flex flex-col justify-between transition ${
          isLocked 
            ? "bg-rose-950/40 border-rose-500/60" 
            : "bg-[#0c101c] border-white/10"
        }`}>
          <div>
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h3 className="text-xs font-bold text-rose-400 uppercase tracking-wider flex items-center gap-2 font-mono">
                <AlertTriangle className="w-4 h-4 text-rose-500" /> Emergency Circuit Breaker
              </h3>
              <span className="text-[9px] text-slate-500 font-mono">Instant Panic Button</span>
            </div>
            
            <p className="text-[11px] text-slate-300 font-sans mt-3 leading-relaxed">
              Instantly sends global order cancel to IBKR, liquidates all active fractional & integer positions at market, and hard-locks the execution router.
            </p>
          </div>

          <div className="space-y-3 pt-4">
            {isLocked ? (
              <button
                onClick={handleUnlockSystem}
                disabled={loading}
                className="w-full bg-amber-600 hover:bg-amber-500 text-black font-mono font-bold text-xs py-3 rounded-lg transition flex items-center justify-center gap-2 cursor-pointer"
              >
                <Unlock className="w-4 h-4" /> AUTHORIZE ROUTER UNLOCK
              </button>
            ) : !confirmKill ? (
              <button
                onClick={() => setConfirmKill(true)}
                className="w-full bg-rose-600/20 hover:bg-rose-600/30 border border-rose-500/40 text-rose-400 hover:text-white font-mono font-bold text-xs py-3 rounded-lg transition flex items-center justify-center gap-2 cursor-pointer"
              >
                <ShieldAlert className="w-4 h-4" /> FLATTEN ALL & ABORT (KILL SWITCH)
              </button>
            ) : (
              <div className="space-y-2 bg-rose-950/80 p-3 rounded-lg border border-rose-500">
                <span className="text-[10px] text-rose-200 font-mono font-bold block text-center uppercase">
                  CONFIRM EMERGENCY FLUSH?
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={handleEmergencyKill}
                    disabled={loading}
                    className="flex-1 bg-rose-600 hover:bg-rose-500 text-white font-mono font-bold text-xs py-2 rounded transition cursor-pointer"
                  >
                    YES, FLATTEN NOW
                  </button>
                  <button
                    onClick={() => setConfirmKill(false)}
                    className="px-3 bg-slate-800 hover:bg-slate-700 text-slate-300 font-mono text-xs rounded transition cursor-pointer"
                  >
                    CANCEL
                  </button>
                </div>
              </div>
            )}

            <div className="text-[9px] text-slate-500 font-mono text-center">
              Active Positions in Risk Pool: <strong className="text-white">{riskStatus?.activePositionsCount || 0}</strong>
            </div>
          </div>
        </div>
      </div>

      {/* 3. LIVE TRANSACTION EXECUTION BLOTTER & TCA (Transaction Cost Analysis) */}
      <div className="bg-[#0c101c] border border-white/10 rounded-xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-white/10 pb-3">
          <div>
            <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2 font-mono">
              <Server className="w-4 h-4 text-emerald-400" /> Live Execution Blotter & Transaction Cost Analysis (TCA)
            </h3>
            <p className="text-[10.5px] text-slate-400 font-sans">
              Real-time audit trail of all orders, fill slippage against arrival price, and IBKR exchange fees.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* Market Scope Blotter Filter */}
            <div className="flex items-center bg-black/50 border border-white/10 rounded p-0.5 text-[9.5px] font-mono">
              <button
                type="button"
                onClick={() => setBlotterMarketFilter("ALL")}
                className={`px-2 py-0.5 rounded transition cursor-pointer ${
                  blotterMarketFilter === "ALL" ? "bg-indigo-600 text-white font-bold" : "text-slate-400 hover:text-white"
                }`}
              >
                ALL ({blotter.length})
              </button>
              <button
                type="button"
                onClick={() => setBlotterMarketFilter("US")}
                className={`px-2 py-0.5 rounded transition cursor-pointer ${
                  blotterMarketFilter === "US" ? "bg-blue-600 text-white font-bold" : "text-slate-400 hover:text-white"
                }`}
              >
                🇺🇸 US ({blotter.filter(b => b.currency !== "EUR").length})
              </button>
              <button
                type="button"
                onClick={() => setBlotterMarketFilter("EUROPE")}
                className={`px-2 py-0.5 rounded transition cursor-pointer ${
                  blotterMarketFilter === "EUROPE" ? "bg-emerald-600 text-white font-bold" : "text-slate-400 hover:text-white"
                }`}
              >
                🇪🇺 EUROPE ({blotter.filter(b => b.currency === "EUR").length})
              </button>
            </div>

            <button 
              onClick={fetchRiskData} 
              className="text-[10px] text-slate-400 hover:text-white font-mono flex items-center gap-1 border border-white/10 px-2.5 py-1 rounded cursor-pointer"
            >
              <RefreshCw className="w-3 h-3" /> REFRESH BLOTTER
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left font-mono text-xs">
            <thead>
              <tr className="border-b border-white/5 text-[9px] text-slate-400 uppercase tracking-wider">
                <th className="py-2 px-3">Order ID</th>
                <th className="py-2 px-3">Time (UTC)</th>
                <th className="py-2 px-3">Symbol</th>
                <th className="py-2 px-3">Side</th>
                <th className="py-2 px-3">Qty</th>
                <th className="py-2 px-3">Order Type</th>
                <th className="py-2 px-3">Arrival</th>
                <th className="py-2 px-3">Fill Price</th>
                <th className="py-2 px-3">Slippage</th>
                <th className="py-2 px-3">Fee</th>
                <th className="py-2 px-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {blotter
                .filter((rec) => {
                  if (blotterMarketFilter === "US") return rec.currency !== "EUR";
                  if (blotterMarketFilter === "EUROPE") return rec.currency === "EUR";
                  return true;
                })
                .map((rec) => (
                <tr key={rec.id} className="hover:bg-white/5 transition">
                  <td className="py-2.5 px-3 text-slate-400 text-[10px]">{rec.id}</td>
                  <td className="py-2.5 px-3 text-slate-400 text-[10px]">
                    {new Date(rec.timestamp).toLocaleTimeString()}
                  </td>
                  <td className="py-2.5 px-3 font-bold text-white flex items-center gap-1.5">
                    {rec.symbol}
                    <span className={`text-[8.5px] px-1 py-0.2 rounded font-mono font-bold ${
                      rec.currency === "EUR" ? "bg-emerald-500/20 text-emerald-300" : "bg-blue-500/20 text-blue-300"
                    }`}>
                      {rec.currency || "USD"}
                    </span>
                  </td>
                  <td className="py-2.5 px-3">
                    <span className={`px-1.5 py-0.5 rounded text-[9.5px] font-bold ${
                      rec.side === "BUY" ? "bg-emerald-500/20 text-[#00ff88]" : "bg-rose-500/20 text-rose-400"
                    }`}>
                      {rec.side}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-slate-200 font-bold">{rec.qty.toFixed(4)}</td>
                  <td className="py-2.5 px-3 text-[10px]">
                    {rec.orderType.includes("INTRADAY FLATTEN") ? (
                      <span className="text-amber-400 bg-amber-500/10 border border-amber-500/30 px-1.5 py-0.5 rounded font-bold">
                        {rec.orderType}
                      </span>
                    ) : rec.orderType.includes("Synthetic Stop") ? (
                      <span className="text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-1.5 py-0.5 rounded font-mono">
                        {rec.orderType}
                      </span>
                    ) : rec.orderType.includes("EMERGENCY FLATTEN") ? (
                      <span className="text-rose-400 bg-rose-500/10 border border-rose-500/30 px-1.5 py-0.5 rounded font-bold">
                        {rec.orderType}
                      </span>
                    ) : (
                      <span className="text-slate-400 font-mono">{rec.orderType}</span>
                    )}
                  </td>
                  <td className="py-2.5 px-3 text-slate-400">
                    {rec.currency === "EUR" ? "€" : "$"}{rec.arrivalPrice.toFixed(2)}
                  </td>
                  <td className="py-2.5 px-3 text-slate-100 font-bold">
                    {rec.currency === "EUR" ? "€" : "$"}{rec.fillPrice.toFixed(2)}
                  </td>
                  <td className="py-2.5 px-3">
                    <span className={`text-[10px] font-bold ${rec.slippageBps <= 2 ? "text-[#00ff88]" : "text-amber-400"}`}>
                      +{rec.slippageBps} bps
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-slate-400 text-[10px]">
                    {rec.currency === "EUR" ? "€" : "$"}{rec.commission.toFixed(2)}
                  </td>
                  <td className="py-2.5 px-3">
                    <span className="px-1.5 py-0.5 rounded text-[9px] bg-emerald-500/10 text-[#00ff88] border border-emerald-500/30">
                      {rec.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
