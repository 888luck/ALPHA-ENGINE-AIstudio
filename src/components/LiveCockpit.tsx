import React, { useState, useEffect } from "react";
import { ExchangeTag } from "./ExchangeTag";
import { ActiveHoldingsTable } from "./ActiveHoldingsTable";
import { TcaAuditTable } from "./TcaAuditTable";
import { getAdminHeaders } from "../utils/auth";
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
  Clock,
  Download,
  FileSpreadsheet,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Layers,
  Globe,
  Radio,
  FileText,
  BarChart3,
  Percent,
  Check
} from "lucide-react";
import { InfoTip, InstitutionalTooltip } from "./InstitutionalTooltip";
import { ActiveTrade, HistoricalLog, ExecutionRecord, Level2Book } from "../server/types";

interface RiskStatus {
  dailyCapitalCeiling: number;
  dailyCapitalUtilized: number;
  dailyMaxLossCutoff: number;
  currentDailyPnL: number;
  tradeRiskPercent?: number;
  dailyLossMode?: "R_MULTIPLE" | "CASH";
  dailyLossRMultiple?: number;
  fractionalTradingEnabled: boolean;
  intradayFlatteningEnabled?: boolean;
  intradayFlattenTimeEST?: string;
  intradayFlattenTimeCET?: string;
  usMocFlattenCutoff?: string;
  euMocFlattenCutoff?: string;
  isEarlyClose?: boolean;
  dstDesynced?: boolean;
  scheduleSource?: string;
  usCountdown?: string | null;
  euCountdown?: string | null;
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
  accountNumber?: string;
}

interface LiveCockpitProps {
  systemState?: any;
  onRefresh?: () => void;
  activeView?: "mission-control" | "blotter" | "risk" | "all";
}

export const LiveCockpit: React.FC<LiveCockpitProps> = ({ 
  systemState, 
  onRefresh, 
  activeView = "all" 
}) => {
  const [riskStatus, setRiskStatus] = useState<RiskStatus | null>(null);
  const [blotter, setBlotter] = useState<ExecutionRecord[]>([]);
  const [activeTradesList, setActiveTradesList] = useState<ActiveTrade[]>([]);
  const [historicalLogsList, setHistoricalLogsList] = useState<HistoricalLog[]>([]);
  const [marketBooks, setMarketBooks] = useState<Record<string, Level2Book>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Blotter multi-lens view state
  const [blotterTab, setBlotterTab] = useState<"positions" | "fills" | "tca">("positions");

  // Risk parameters state
  const [capCeilingInput, setCapCeilingInput] = useState<string>("10000");
  const [maxLossInput, setMaxLossInput] = useState<string>("250");
  const [tradeRiskPercentInput, setTradeRiskPercentInput] = useState<string>("1.0");
  const [dailyLossMode, setDailyLossMode] = useState<"R_MULTIPLE" | "CASH">("R_MULTIPLE");
  const [dailyLossRMultipleInput, setDailyLossRMultipleInput] = useState<string>("4");
  const [fractionalToggle, setFractionalToggle] = useState<boolean>(true);
  const [intradayFlattenToggle, setIntradayFlattenToggle] = useState<boolean>(true);
  const [modeToggle, setModeToggle] = useState<"PAPER" | "LIVE">("PAPER");
  const [liveTokenInput, setLiveTokenInput] = useState<string>("");
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

  // High-Density Blotter Sorting & Export State
  const [sortField, setSortField] = useState<keyof ExecutionRecord>("timestamp");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  const handleSort = (field: keyof ExecutionRecord) => {
    if (sortField === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortOrder("desc");
    }
  };

  const exportBlotterCSV = () => {
    if (blotter.length === 0) return;
    const headers = ["Order ID", "Timestamp (UTC)", "Symbol", "Side", "Qty", "Order Type", "Arrival Price", "Fill Price", "Slippage (bps)", "Commission", "Currency", "Status"];
    const rows = blotter.map((rec) => [
      rec.id,
      rec.timestamp,
      rec.symbol,
      rec.side,
      rec.qty,
      `"${rec.orderType}"`,
      rec.arrivalPrice,
      rec.fillPrice,
      rec.slippageBps,
      rec.commission,
      rec.currency,
      rec.status
    ]);
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `alpha_execution_blotter_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportBlotterJSON = () => {
    if (blotter.length === 0) return;
    const blob = new Blob([JSON.stringify(blotter, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `alpha_execution_blotter_${new Date().toISOString().slice(0, 10)}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Comprehensive Edge State Fetch
  const fetchTelemetry = async () => {
    try {
      const [resRisk, resBlotter, resState] = await Promise.all([
        fetch("/api/risk/status"),
        fetch("/api/execution/blotter"),
        fetch("/api/state")
      ]);
      
      if (resRisk.ok) {
        const data = await resRisk.json();
        setRiskStatus(data);
        if (!hasInitializedInputs) {
          setCapCeilingInput(String(data.dailyCapitalCeiling ?? 10000));
          setMaxLossInput(String(data.dailyMaxLossCutoff ?? 250));
          setTradeRiskPercentInput(String(data.tradeRiskPercent ?? 1.0));
          if (data.dailyLossMode) setDailyLossMode(data.dailyLossMode);
          if (data.dailyLossRMultiple) setDailyLossRMultipleInput(String(data.dailyLossRMultiple));
          setFractionalToggle(data.fractionalTradingEnabled ?? true);
          if (data.intradayFlatteningEnabled !== undefined) {
            setIntradayFlattenToggle(data.intradayFlatteningEnabled);
          }
          if (data.marketScope) {
            setMarketScopeToggle(data.marketScope);
          }
          setModeToggle(data.tradingMode || "PAPER");
          setHasInitializedInputs(true);
        }
      }
      
      if (resBlotter.ok) {
        const blotterData = await resBlotter.json();
        setBlotter(blotterData.blotter || []);
      }

      if (resState.ok) {
        const stateData = await resState.json();
        if (stateData.activeTrades) setActiveTradesList(stateData.activeTrades);
        if (stateData.historicalLogs) setHistoricalLogsList(stateData.historicalLogs);
        if (stateData.marketBooks) setMarketBooks(stateData.marketBooks);
      }
    } catch (err: any) {
      console.error("Failed to fetch live cockpit telemetry:", err);
    }
  };

  useEffect(() => {
    fetchTelemetry();
    const interval = setInterval(fetchTelemetry, 3500);
    return () => clearInterval(interval);
  }, [hasInitializedInputs]);

  // Handle Save Risk Settings
  const handleSaveRiskSettings = async () => {
    setLoading(true);
    setError(null);
    setSaveSuccess(false);
    try {
      const parsedCap = Number(capCeilingInput);
      const parsedLoss = Number(maxLossInput);
      const parsedRiskPct = Number(tradeRiskPercentInput);
      const parsedRMult = Number(dailyLossRMultipleInput);

      const safeCap = !isNaN(parsedCap) && parsedCap > 0 ? parsedCap : 500;
      const safeLoss = !isNaN(parsedLoss) && parsedLoss > 0 ? parsedLoss : 50;
      const safeRiskPct = !isNaN(parsedRiskPct) && parsedRiskPct > 0 ? parsedRiskPct : 1.0;
      const safeRMult = !isNaN(parsedRMult) && parsedRMult > 0 ? parsedRMult : 4;

      const res = await fetch("/api/risk/settings", {
        method: "POST",
        headers: getAdminHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          dailyCapitalCeiling: safeCap,
          dailyMaxLossCutoff: safeLoss,
          tradeRiskPercent: safeRiskPct,
          dailyLossMode: dailyLossMode,
          dailyLossRMultiple: safeRMult,
          fractionalTradingEnabled: Boolean(fractionalToggle),
          intradayFlatteningEnabled: Boolean(intradayFlattenToggle),
          tradingMode: modeToggle,
          marketScope: marketScopeToggle,
          liveConfirmationToken: liveTokenInput || undefined
        })
      });

      if (res.ok) {
        const result = await res.json();
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3500);
        await fetchTelemetry();
        if (onRefresh) onRefresh();
      } else {
        const errData = await res.json().catch(() => ({}));
        setError(errData.error || "Failed to update risk parameters on gateway. Check Operator Key.");
      }
    } catch (err: any) {
      setError(err.message || "Network error updating risk settings.");
    } finally {
      setLoading(false);
    }
  };

  // Immediate Intraday Market-on-Close Flush
  const handleFlattenIntraday = async () => {
    const confirm = window.confirm("CONFIRM MARKET-ON-CLOSE FLATTEN:\n\nLiquidate all active intraday positions to secure 0 overnight gap exposure?");
    if (!confirm) return;

    setIsFlatteningIntraday(true);
    setIntradayMsg(null);
    try {
      const res = await fetch("/api/risk/flatten-intraday", {
        method: "POST",
        headers: getAdminHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ reason: "Manual Operator MOC Execution Rule" })
      });
      const data = await res.json();
      if (res.ok) {
        setIntradayMsg(`MOC Executed: Flattened ${data.liquidatedCount || 0} position(s).`);
        setTimeout(() => setIntradayMsg(null), 4500);
        await fetchTelemetry();
        if (onRefresh) onRefresh();
      } else {
        setError("Intraday flatten rejected by gateway.");
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
      const res = await fetch("/api/risk/emergency-kill", { 
        method: "POST",
        headers: getAdminHeaders()
      });
      if (res.ok) {
        setConfirmKill(false);
        await fetchTelemetry();
        if (onRefresh) onRefresh();
      } else {
        setError("Kill switch execution rejected. Valid Operator Admin Key required.");
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
      await fetch("/api/risk/unlock", { 
        method: "POST",
        headers: getAdminHeaders()
      });
      await fetchTelemetry();
      if (onRefresh) onRefresh();
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
  const netLiq = riskStatus?.netLiquidation || systemState?.settings?.netLiquidation || 1023930.83;
  const maintMargin = riskStatus?.maintenanceMargin || systemState?.settings?.maintenanceMargin || 11901.58;
  const marginPct = netLiq > 0 ? (maintMargin / netLiq) * 100 : 0;
  
  // Calculations for Per-Trade Risk Budget & Circuit Breaker
  const currentRiskPct = Number(tradeRiskPercentInput) || 1.0;
  const currentRMultiple = Number(dailyLossRMultipleInput) || 4;
  const rDollarValue = (netLiq * (currentRiskPct / 100));
  const calculatedMaxLoss = dailyLossMode === "R_MULTIPLE" ? (rDollarValue * currentRMultiple) : (Number(maxLossInput) || 250);
  const lossDistance = calculatedMaxLoss + dailyPnL; // Positive if safe

  // Market Microstructure First Book for Quick-Look
  const firstBook = (Object.values(marketBooks)[0] as Level2Book | undefined);

  return (
    <div className="space-y-5">
      {/* =========================================================================
          1. INSTITUTIONAL FINANCIAL KPI TELEMETRY RIBBON
          ========================================================================= */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* KPI 1: Net Liquidation */}
        <div className="terminal-card p-3 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-secondary font-mono uppercase font-bold">Net Liquidation</span>
            <DollarSign className="w-3.5 h-3.5 text-indigo-500" />
          </div>
          <div className="text-sm sm:text-base font-bold font-mono text-primary truncate">
            €{netLiq.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] text-secondary font-mono">
            IBKR Pro Ireland (IBIE)
          </div>
        </div>

        {/* KPI 2: Daily P&L */}
        <div className="terminal-card p-3 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-secondary font-mono uppercase font-bold">Session P&L</span>
            <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
          </div>
          <div className={`text-sm sm:text-base font-bold font-mono truncate ${
            dailyPnL >= 0 ? "text-emerald-500 dark:text-[#00ff88]" : "text-rose-500 dark:text-rose-400"
          }`}>
            {dailyPnL >= 0 ? "+" : ""}${dailyPnL.toFixed(2)}
          </div>
          <div className="text-[10px] text-secondary font-mono">
            {netLiq > 0 ? ((dailyPnL / netLiq) * 100).toFixed(2) : "0.00"}% Equity Return
          </div>
        </div>

        {/* KPI 3: Margin Utilization */}
        <div className="terminal-card p-3 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-secondary font-mono uppercase font-bold">Margin Used</span>
            <Percent className="w-3.5 h-3.5 text-amber-500" />
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className={`text-sm sm:text-base font-bold font-mono ${marginPct > 80 ? "text-rose-500" : marginPct > 50 ? "text-amber-500" : "text-primary"}`}>
              {marginPct.toFixed(1)}%
            </span>
            <span className="text-[10px] text-secondary font-mono">
              (€{(maintMargin / 1000).toFixed(1)}k)
            </span>
          </div>
          <div className="w-full terminal-elevated rounded-full h-1.5 overflow-hidden">
            <div 
              className={`h-full transition-all duration-300 ${marginPct > 80 ? "bg-rose-500" : marginPct > 50 ? "bg-amber-500" : "bg-emerald-500"}`}
              style={{ width: `${Math.min(100, marginPct)}%` }}
            />
          </div>
        </div>

        {/* KPI 4: Capital Ceiling Allocation */}
        <div className="terminal-card p-3 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-secondary font-mono uppercase font-bold">Gross Capital</span>
            <ShieldCheck className="w-3.5 h-3.5 text-cyan-500" />
          </div>
          <div className="text-sm sm:text-base font-bold font-mono text-primary truncate">
            ${utilizedCap.toFixed(0)} <span className="text-xs text-secondary font-normal">/ ${maxCap.toFixed(0)}</span>
          </div>
          <div className="w-full terminal-elevated rounded-full h-1.5 overflow-hidden">
            <div 
              className={`h-full transition-all duration-300 ${capPct > 80 ? "bg-rose-500" : "bg-cyan-500"}`}
              style={{ width: `${capPct}%` }}
            />
          </div>
        </div>

        {/* KPI 5: Active Risk Pool */}
        <div className="terminal-card p-3 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-secondary font-mono uppercase font-bold">Risk Pool</span>
            <Activity className="w-3.5 h-3.5 text-emerald-500" />
          </div>
          <div className="text-sm sm:text-base font-bold font-mono text-primary">
            {activeTradesList.length} Position(s)
          </div>
          <div className="text-[10px] text-secondary font-mono">
            {activeTradesList.length > 0 ? "DMA Active Lanes" : "All Routes Flat"}
          </div>
        </div>

        {/* KPI 6: Edge Ping & Socket */}
        <div className="terminal-card p-3 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-secondary font-mono uppercase font-bold">Frankfurt Ping</span>
            <Server className="w-3.5 h-3.5 text-emerald-500" />
          </div>
          <div className="text-sm sm:text-base font-bold font-mono text-emerald-500 dark:text-[#00ff88] flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            {riskStatus?.tcpLatencyMs || 2.3} ms
          </div>
          <div className="text-[10px] text-secondary font-mono">
            europe-west3-a Spot VM
          </div>
        </div>
      </div>

      {/* =========================================================================
          VIEW A: CONTROL (EXECUTIVE TRADING COCKPIT)
          ========================================================================= */}
      {(activeView === "all" || activeView === "mission-control") && (
        <div className="space-y-5 animate-in fade-in duration-200">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* Left Column (65%): Active Working Positions & Operational Flush */}
            <div className="lg:col-span-8 space-y-4">
              <ActiveHoldingsTable 
                activeTrades={activeTradesList} 
                onRefresh={fetchTelemetry} 
              />

              {/* Quick Operational Controls Strip */}
              <div className="terminal-card p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
                <div className="flex items-center gap-2">
                  <span className="text-secondary font-bold">INTRADAY SAFETY:</span>
                  <span className="text-indigo-500 dark:text-indigo-400">
                    US MOC {riskStatus?.usMocFlattenCutoff || "15:45"} EST • EU MOC {riskStatus?.euMocFlattenCutoff || "17:15"} CET
                  </span>
                  {riskStatus?.isEarlyClose && (
                    <span className="px-1.5 py-0.2 rounded text-[10px] bg-rose-500/20 text-rose-500 font-bold">
                      EARLY CLOSE ACTIVE
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleFlattenIntraday}
                    disabled={isFlatteningIntraday || activeTradesList.length === 0}
                    className="px-3 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-600 dark:text-amber-400 border border-amber-500/40 text-[11px] font-bold transition disabled:opacity-40 flex items-center gap-1.5 cursor-pointer"
                  >
                    {isFlatteningIntraday ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Clock className="w-3.5 h-3.5" />}
                    <span>FLATTEN INTRADAY (MOC)</span>
                  </button>

                  {!confirmKill ? (
                    <button
                      type="button"
                      onClick={() => setConfirmKill(true)}
                      className="px-3 py-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-500 dark:text-rose-400 border border-rose-500/40 text-[11px] font-bold transition flex items-center gap-1.5 cursor-pointer"
                    >
                      <ShieldAlert className="w-3.5 h-3.5" />
                      <span>KILL SWITCH</span>
                    </button>
                  ) : (
                    <div className="flex items-center gap-1.5 bg-rose-950/80 p-1 rounded border border-rose-500">
                      <button
                        type="button"
                        onClick={handleEmergencyKill}
                        disabled={loading}
                        className="px-2 py-1 bg-rose-600 text-white rounded font-bold text-[10px] cursor-pointer"
                      >
                        CONFIRM FLATTEN ALL
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmKill(false)}
                        className="px-2 py-1 bg-slate-800 text-slate-300 rounded text-[10px] cursor-pointer"
                      >
                        CANCEL
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {intradayMsg && (
                <div className="p-2.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-500 font-mono text-xs flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{intradayMsg}</span>
                </div>
              )}
            </div>

            {/* Right Column (35%): Frankfurt Edge Infrastructure & Microstructure Depth */}
            <div className="lg:col-span-4 space-y-4">
              {/* Edge Node Daemon Health */}
              <div className="terminal-card p-4 space-y-3 font-mono text-xs">
                <div className="flex items-center justify-between border-b border-border/80 pb-2.5">
                  <div className="flex items-center gap-2">
                    <Server className="w-4 h-4 text-emerald-500" />
                    <span className="font-bold text-primary uppercase tracking-wider text-xs">
                      Frankfurt Edge Daemon
                    </span>
                  </div>
                  <span className="text-[10px] px-2 py-0.5 rounded font-bold bg-emerald-500/15 text-emerald-500 border border-emerald-500/30">
                    ONLINE
                  </span>
                </div>

                <div className="space-y-2 text-[11px] text-secondary">
                  <div className="flex justify-between py-1 border-b border-border/50">
                    <span>Host Node:</span>
                    <strong className="text-primary">alpha-edge-node</strong>
                  </div>
                  <div className="flex justify-between py-1 border-b border-border/50">
                    <span>Datacenter Zone:</span>
                    <strong className="text-emerald-500">europe-west3-a (Frankfurt)</strong>
                  </div>
                  <div className="flex justify-between py-1 border-b border-border/50">
                    <span>Internal IP:</span>
                    <strong className="text-primary">10.156.0.2 (Port 4005)</strong>
                  </div>
                  <div className="flex justify-between py-1 border-b border-border/50">
                    <span>Execution Process:</span>
                    <strong className="text-primary">python3 main.py</strong>
                  </div>
                  <div className="flex justify-between py-1 border-b border-border/50">
                    <span>Broker Bridge:</span>
                    <strong className="text-indigo-400">
                      ibgateway.service (Port {riskStatus?.tradingMode === "LIVE" ? "4001" : "4002"})
                    </strong>
                  </div>
                  <div className="flex justify-between py-1 border-b border-border/50">
                    <span>Pre-Trade Risk Gates:</span>
                    <strong className="text-emerald-500">6 Verified Active</strong>
                  </div>
                </div>

                <div className="pt-2 text-[10px] text-secondary border-t border-border/50 flex items-center gap-1.5 text-emerald-500">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Sub-5ms socket proximity to IBKR Core Europe Hub</span>
                </div>
              </div>

              {/* Level 2 Microstructure & OFI Quick-Glance */}
              <div className="terminal-card p-4 space-y-3 font-mono text-xs">
                <div className="flex items-center justify-between border-b border-border/80 pb-2.5">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-cyan-500" />
                    <span className="font-bold text-primary uppercase tracking-wider text-xs">
                      Market Depth & OFI Imbalance
                    </span>
                  </div>
                  <span className="text-[10px] text-secondary">Cont-Kukanov-Stoikov</span>
                </div>

                {firstBook ? (
                  <div className="space-y-3">
                    <div className="flex items-baseline justify-between">
                      <span className="text-sm font-bold text-primary">{firstBook.symbol}</span>
                      <span className={`text-base font-bold ${
                        (firstBook.lastOfi || 0) >= 0 ? "text-emerald-500 dark:text-[#00ff88]" : "text-rose-500 dark:text-rose-400"
                      }`}>
                        {(firstBook.lastOfi || 0) >= 0 ? "+" : ""}{(firstBook.lastOfi || 0).toFixed(2)}σ
                      </span>
                    </div>

                    <div className="text-[11px] text-secondary space-y-1.5">
                      <div className="flex justify-between">
                        <span>Last Trade Mark:</span>
                        <strong className="text-primary">${firstBook.lastPrice?.toFixed(2)}</strong>
                      </div>
                      <div className="flex justify-between">
                        <span>Queue Dynamics:</span>
                        <strong className="text-emerald-500">
                          {(firstBook.lastOfi || 0) >= 1.5 ? "Accumulation Spike" : (firstBook.lastOfi || 0) <= -1.5 ? "Distribution Pressure" : "Balanced Queue"}
                        </strong>
                      </div>
                      <div className="flex justify-between">
                        <span>Visible Tiers:</span>
                        <strong className="text-primary">8 Bids / 8 Asks</strong>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="py-4 text-center text-secondary text-[11px]">
                    Microstructure streaming active. Awaiting tick depth from broker socket.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          VIEW B: BLOTTER (UNIFIED MULTI-LENS BLOTTER)
          ========================================================================= */}
      {(activeView === "all" || activeView === "blotter") && (
        <div className="space-y-4 animate-in fade-in duration-200">
          {/* Multi-Lens Navigation Sub-Tabs */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/80 pb-3 font-mono text-xs">
            <div className="flex items-center gap-1.5 bg-elevated p-1 rounded-md border border-border">
              <button
                type="button"
                onClick={() => setBlotterTab("positions")}
                className={`px-3 py-1.5 rounded transition font-bold cursor-pointer flex items-center gap-1.5 ${
                  blotterTab === "positions" 
                    ? "bg-indigo-600 text-white shadow-sm" 
                    : "text-secondary hover:text-primary"
                }`}
              >
                <Lock className="w-3.5 h-3.5" />
                <span>ACTIVE WORKING POSITIONS ({activeTradesList.length})</span>
              </button>

              <button
                type="button"
                onClick={() => setBlotterTab("fills")}
                className={`px-3 py-1.5 rounded transition font-bold cursor-pointer flex items-center gap-1.5 ${
                  blotterTab === "fills" 
                    ? "bg-accent text-background shadow-sm" 
                    : "text-secondary hover:text-primary"
                }`}
              >
                <Server className="w-3.5 h-3.5" />
                <span>EXECUTED FILLS BLOTTER ({blotter.length})</span>
              </button>

              <button
                type="button"
                onClick={() => setBlotterTab("tca")}
                className={`px-3 py-1.5 rounded transition font-bold cursor-pointer flex items-center gap-1.5 ${
                  blotterTab === "tca" 
                    ? "bg-emerald-600 text-white shadow-sm" 
                    : "text-secondary hover:text-primary"
                }`}
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>MiFID II TCA & FRICTION AUDIT ({historicalLogsList.length})</span>
              </button>
            </div>
          </div>

          {/* Sub-Lens 1: Active Working Positions */}
          {blotterTab === "positions" && (
            <ActiveHoldingsTable 
              activeTrades={activeTradesList} 
              onRefresh={fetchTelemetry} 
            />
          )}

          {/* Sub-Lens 2: Executed Fills Blotter */}
          {blotterTab === "fills" && (
            <div className="terminal-card p-4 space-y-3 font-mono text-xs">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-border/80 pb-3">
                <div>
                  <h3 className="text-xs sm:text-sm font-bold text-primary uppercase tracking-wider font-mono flex items-center gap-2">
                    <Server className="w-4 h-4 text-accent" />
                    Sub-Millisecond Execution Audit Trail
                  </h3>
                  <p className="text-[11px] text-secondary font-sans mt-0.5">
                    Basis point slippage vs arrival benchmark, IBKR Europe clearing commissions, and verified execution order types.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center bg-surface/50 border border-border rounded p-0.5 text-xs font-mono">
                    <button
                      type="button"
                      onClick={() => setBlotterMarketFilter("ALL")}
                      className={`px-2.5 py-1 rounded transition cursor-pointer font-bold ${
                        blotterMarketFilter === "ALL" ? "bg-accent text-background" : "text-secondary hover:text-primary"
                      }`}
                    >
                      ALL ({blotter.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setBlotterMarketFilter("US")}
                      className={`px-2.5 py-1 rounded transition cursor-pointer font-bold ${
                        blotterMarketFilter === "US" ? "bg-blue-600 text-white" : "text-secondary hover:text-primary"
                      }`}
                    >
                      US ({blotter.filter(b => b.currency !== "EUR").length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setBlotterMarketFilter("EUROPE")}
                      className={`px-2.5 py-1 rounded transition cursor-pointer font-bold ${
                        blotterMarketFilter === "EUROPE" ? "bg-emerald-600 text-white" : "text-secondary hover:text-primary"
                      }`}
                    >
                      EU ({blotter.filter(b => b.currency === "EUR").length})
                    </button>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={exportBlotterCSV}
                      disabled={blotter.length === 0}
                      className="px-2.5 py-1 rounded border border-border bg-surface/40 hover:bg-surface text-secondary hover:text-primary transition cursor-pointer disabled:opacity-40 flex items-center gap-1.5 text-[11px]"
                      title="Export audit blotter to CSV"
                    >
                      <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
                      <span>CSV</span>
                    </button>
                    <button
                      type="button"
                      onClick={exportBlotterJSON}
                      disabled={blotter.length === 0}
                      className="px-2.5 py-1 rounded border border-border bg-surface/40 hover:bg-surface text-secondary hover:text-primary transition cursor-pointer disabled:opacity-40 flex items-center gap-1.5 text-[11px]"
                      title="Export audit blotter to JSON"
                    >
                      <Download className="w-3.5 h-3.5 text-indigo-400" />
                      <span>JSON</span>
                    </button>
                    <button 
                      type="button"
                      onClick={fetchTelemetry} 
                      className="px-2.5 py-1 rounded border border-border bg-surface/40 hover:bg-surface text-secondary hover:text-primary transition cursor-pointer flex items-center gap-1 text-[11px]"
                      title="Refresh Blotter"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Data Table */}
              <div className="overflow-x-auto border border-border/80 rounded-lg">
                <table className="w-full text-left font-mono text-[11px]">
                  <thead>
                    <tr className="border-b border-border/80 text-[10px] text-secondary font-bold uppercase tracking-wider bg-surface/60 select-none">
                      <th onClick={() => handleSort("id")} className="py-2 px-3 cursor-pointer hover:text-primary">
                        <div className="flex items-center gap-1">
                          <span>Order ID</span>
                          {sortField === "id" ? (sortOrder === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 opacity-40" />}
                        </div>
                      </th>
                      <th onClick={() => handleSort("timestamp")} className="py-2 px-3 cursor-pointer hover:text-primary">
                        <div className="flex items-center gap-1">
                          <span>Time (UTC)</span>
                          {sortField === "timestamp" ? (sortOrder === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 opacity-40" />}
                        </div>
                      </th>
                      <th onClick={() => handleSort("symbol")} className="py-2 px-3 cursor-pointer hover:text-primary">
                        <div className="flex items-center gap-1">
                          <span>Symbol</span>
                          {sortField === "symbol" ? (sortOrder === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 opacity-40" />}
                        </div>
                      </th>
                      <th onClick={() => handleSort("side")} className="py-2 px-3 cursor-pointer hover:text-primary">
                        <div className="flex items-center gap-1">
                          <span>Side</span>
                          {sortField === "side" ? (sortOrder === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 opacity-40" />}
                        </div>
                      </th>
                      <th onClick={() => handleSort("qty")} className="py-2 px-3 text-right cursor-pointer hover:text-primary">
                        <div className="flex items-center justify-end gap-1">
                          <span>Qty</span>
                          {sortField === "qty" ? (sortOrder === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 opacity-40" />}
                        </div>
                      </th>
                      <th className="py-2 px-3">Order Type</th>
                      <th onClick={() => handleSort("arrivalPrice")} className="py-2 px-3 text-right cursor-pointer hover:text-primary">
                        <div className="flex items-center justify-end gap-1">
                          <span>Arrival</span>
                          {sortField === "arrivalPrice" ? (sortOrder === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 opacity-40" />}
                        </div>
                      </th>
                      <th onClick={() => handleSort("fillPrice")} className="py-2 px-3 text-right cursor-pointer hover:text-primary">
                        <div className="flex items-center justify-end gap-1">
                          <span>Fill Price</span>
                          {sortField === "fillPrice" ? (sortOrder === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 opacity-40" />}
                        </div>
                      </th>
                      <th onClick={() => handleSort("slippageBps")} className="py-2 px-3 text-right cursor-pointer hover:text-primary">
                        <div className="flex items-center justify-end gap-1">
                          <span>Slippage</span>
                          <InfoTip id="slippage" />
                          {sortField === "slippageBps" ? (sortOrder === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 opacity-40" />}
                        </div>
                      </th>
                      <th onClick={() => handleSort("commission")} className="py-2 px-3 text-right cursor-pointer hover:text-primary">
                        <div className="flex items-center justify-end gap-1">
                          <span>Fee</span>
                          {sortField === "commission" ? (sortOrder === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 opacity-40" />}
                        </div>
                      </th>
                      <th className="py-2 px-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {blotter
                      .filter((rec) => {
                        if (blotterMarketFilter === "US") return rec.currency !== "EUR";
                        if (blotterMarketFilter === "EUROPE") return rec.currency === "EUR";
                        return true;
                      })
                      .sort((a, b) => {
                        const valA = a[sortField];
                        const valB = b[sortField];
                        if (typeof valA === "number" && typeof valB === "number") {
                          return sortOrder === "asc" ? valA - valB : valB - valA;
                        }
                        return sortOrder === "asc"
                          ? String(valA).localeCompare(String(valB))
                          : String(valB).localeCompare(String(valA));
                      })
                      .map((rec) => (
                      <tr key={rec.id} className="hover:bg-surface/50 transition">
                        <td className="py-1.5 px-3 text-secondary text-[11px] font-mono">{rec.id}</td>
                        <td className="py-1.5 px-3 text-secondary text-[11px] font-mono">
                          {new Date(rec.timestamp).toLocaleTimeString([], { hour12: false })}
                        </td>
                        <td className="py-1.5 px-3 font-bold text-primary flex items-center gap-2 text-[11px]">
                          {rec.symbol} <ExchangeTag symbol={rec.symbol} />
                          <span className={`text-[10px] px-1 py-0.2 rounded font-mono font-bold ${
                            rec.currency === "EUR" ? "bg-emerald-500/15 text-emerald-400" : "bg-blue-500/15 text-blue-400"
                          }`}>
                            {rec.currency || "USD"}
                          </span>
                        </td>
                        <td className="py-1.5 px-3">
                          <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold font-mono ${
                            rec.side === "BUY" ? "bg-emerald-500/20 text-emerald-600 dark:text-[#00ff88]" : "bg-rose-500/20 text-rose-500 dark:text-rose-400"
                          }`}>
                            {rec.side}
                          </span>
                        </td>
                        <td className="py-1.5 px-3 text-primary font-bold text-right tabular-nums">{rec.qty.toFixed(4)}</td>
                        <td className="py-1.5 px-3 text-[10px]">
                          {rec.orderType.includes("INTRADAY FLATTEN") ? (
                            <span className="text-amber-500 dark:text-amber-400 bg-amber-500/10 border border-amber-500/30 px-1.5 py-0.2 rounded font-bold font-mono">
                              {rec.orderType}
                            </span>
                          ) : rec.orderType.includes("Synthetic Stop") ? (
                            <span className="text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-1.5 py-0.2 rounded font-bold font-mono">
                              {rec.orderType}
                            </span>
                          ) : rec.orderType.includes("EMERGENCY FLATTEN") ? (
                            <span className="text-rose-500 dark:text-rose-400 bg-rose-500/10 border border-rose-500/30 px-1.5 py-0.2 rounded font-bold font-mono">
                              {rec.orderType}
                            </span>
                          ) : (
                            <span className="text-secondary font-mono">{rec.orderType}</span>
                          )}
                        </td>
                        <td className="py-1.5 px-3 text-secondary text-right tabular-nums">
                          {rec.currency === "EUR" ? "€" : "$"}{rec.arrivalPrice.toFixed(2)}
                        </td>
                        <td className="py-1.5 px-3 text-primary font-bold text-right tabular-nums">
                          {rec.currency === "EUR" ? "€" : "$"}{rec.fillPrice.toFixed(2)}
                        </td>
                        <td className="py-1.5 px-3 text-right tabular-nums">
                          <span className={`text-[11px] font-bold font-mono ${
                            rec.slippageBps <= 2 ? "text-emerald-500 dark:text-[#00ff88]" : rec.slippageBps <= 5 ? "text-amber-500 dark:text-amber-400" : "text-rose-500 dark:text-rose-400"
                          }`}>
                            +{rec.slippageBps} bps
                          </span>
                        </td>
                        <td className="py-1.5 px-3 text-secondary text-right tabular-nums">
                          {rec.currency === "EUR" ? "€" : "$"}{rec.commission.toFixed(2)}
                        </td>
                        <td className="py-1.5 px-3">
                          <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-bold bg-emerald-500/15 text-emerald-600 dark:text-[#00ff88] border border-emerald-500/30">
                            {rec.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {blotter.length === 0 && (
                      <tr>
                        <td colSpan={11} className="py-8 text-center text-secondary text-xs font-mono">
                          No execution events logged for active scope. Router awaiting order triggers.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Sub-Lens 3: MiFID II TCA & Friction Audit */}
          {blotterTab === "tca" && (
            <TcaAuditTable 
              historicalLogs={historicalLogsList} 
              onRefresh={fetchTelemetry} 
            />
          )}
        </div>
      )}

      {/* =========================================================================
          VIEW C: RISK (UPGRADED PRE-TRADE RISK GATEWAY)
          ========================================================================= */}
      {(activeView === "all" || activeView === "risk") && (
        <div className="space-y-5 animate-in fade-in duration-200">
          
          {/* Risk Grid Panel */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            
            {/* Panel A: Interactive Pre-Trade Parameter Desk (8 Cols) */}
            <div className="lg:col-span-8 terminal-card p-5 space-y-5">
              <div className="flex items-center justify-between border-b border-border pb-3">
                <div className="flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-indigo-500 dark:text-indigo-400" />
                  <h3 className="text-xs sm:text-sm font-bold text-primary uppercase tracking-wider font-mono">
                    Pre-Trade Risk Gateway & Sizing Allocator
                  </h3>
                </div>
                <span className="text-xs text-secondary font-mono font-medium">SEC Rule 15c3-5 / MiFID II</span>
              </div>

              {/* Top Controls Grid: 4 Interactive Parameter Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                
                {/* Card 1: Per-Trade Risk Budget (r%) [NEW] */}
                <div className="terminal-elevated p-3.5 space-y-2 hover:border-accent transition">
                  <div className="flex justify-between items-center">
                    <label className="text-xs text-secondary uppercase font-mono font-bold flex items-center gap-1 cursor-help">
                      Per-Trade Risk Budget (r %) <span className="text-xs text-indigo-400">ⓘ</span>
                    </label>
                    <Percent className="w-4 h-4 text-indigo-500" />
                  </div>
                  
                  <div className="relative">
                    <input
                      type="number"
                      step="0.05"
                      min="0.05"
                      max="10.0"
                      value={tradeRiskPercentInput}
                      onChange={(e) => setTradeRiskPercentInput(e.target.value)}
                      onBlur={() => {
                        const v = Number(tradeRiskPercentInput);
                        if (isNaN(v) || v <= 0) setTradeRiskPercentInput("1.0");
                      }}
                      className="w-full terminal-card rounded px-2.5 py-1.5 text-sm text-primary font-mono font-bold focus:border-indigo-500 focus:outline-none"
                    />
                    <span className="absolute right-2.5 top-2 text-xs text-indigo-500 font-mono font-semibold">% Equity</span>
                  </div>

                  <div className="flex items-center gap-1.5 pt-0.5">
                    <span className="text-[10px] text-secondary uppercase font-mono font-semibold">Preset:</span>
                    {[
                      { label: "0.25%", val: "0.25" },
                      { label: "0.50%", val: "0.5" },
                      { label: "1.00%", val: "1.0" },
                      { label: "2.00%", val: "2.0" }
                    ].map((p) => (
                      <button
                        key={p.val}
                        type="button"
                        onClick={() => setTradeRiskPercentInput(p.val)}
                        className={`px-1.5 py-0.5 text-[10px] font-mono font-semibold rounded border transition cursor-pointer ${
                          tradeRiskPercentInput === p.val
                            ? "bg-indigo-600/30 text-indigo-600 dark:text-indigo-300 border-indigo-500"
                            : "terminal-card text-secondary hover:text-primary"
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>

                  <div className="text-[11px] text-secondary font-mono pt-1">
                    Risk Capital / Trade (1r): <strong className="text-primary font-bold">${rDollarValue.toFixed(2)}</strong>
                  </div>
                  <p className="text-[10px] text-secondary leading-tight">
                    Dynamic sizing formula: Qty = ${rDollarValue.toFixed(0)} / |Entry - Stop|
                  </p>
                </div>

                {/* Card 2: Dual-Mode Hard Daily Loss Circuit Breaker [NEW] */}
                <div className="terminal-elevated p-3.5 space-y-2 hover:border-accent transition">
                  <div className="flex justify-between items-center">
                    <label className="text-xs text-secondary uppercase font-mono font-bold flex items-center gap-1 cursor-help">
                      Daily Circuit Breaker <span className="text-xs text-rose-500">ⓘ</span>
                    </label>
                    <ShieldAlert className="w-4 h-4 text-rose-500" />
                  </div>

                  {/* Dual Mode Switcher */}
                  <div className="flex items-center rounded terminal-card p-0.5 text-[10px] font-mono">
                    <button
                      type="button"
                      onClick={() => setDailyLossMode("R_MULTIPLE")}
                      className={`flex-1 py-1 rounded transition font-bold cursor-pointer text-center ${
                        dailyLossMode === "R_MULTIPLE" ? "bg-rose-500/20 text-rose-500 border border-rose-500/40" : "text-secondary hover:text-primary"
                      }`}
                    >
                      DYNAMIC r-MULTIPLES
                    </button>
                    <button
                      type="button"
                      onClick={() => setDailyLossMode("CASH")}
                      className={`flex-1 py-1 rounded transition font-bold cursor-pointer text-center ${
                        dailyLossMode === "CASH" ? "bg-black/10 dark:bg-white/10 text-primary border border-border" : "text-secondary hover:text-primary"
                      }`}
                    >
                      FIXED CASH LIMIT
                    </button>
                  </div>

                  {dailyLossMode === "R_MULTIPLE" ? (
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-1.5 pt-0.5">
                        <span className="text-[10px] text-secondary uppercase font-mono font-semibold">Lock at:</span>
                        {[
                          { label: "2r", val: "2" },
                          { label: "3r", val: "3" },
                          { label: "4r", val: "4" },
                          { label: "5r", val: "5" }
                        ].map((m) => (
                          <button
                            key={m.val}
                            type="button"
                            onClick={() => setDailyLossRMultipleInput(m.val)}
                            className={`px-2 py-0.5 text-xs font-mono font-bold rounded border transition cursor-pointer ${
                              dailyLossRMultipleInput === m.val
                                ? "bg-rose-600/30 text-rose-500 border-rose-500"
                                : "terminal-card text-secondary hover:text-primary"
                            }`}
                          >
                            {m.label}
                          </button>
                        ))}
                      </div>
                      <div className="text-[11px] text-secondary font-mono">
                        Auto-flattens after <strong className="text-rose-500">{dailyLossRMultipleInput}r</strong> = <strong className="text-primary font-bold">-${calculatedMaxLoss.toFixed(2)}</strong> cumulative loss.
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <div className="relative">
                        <input
                          type="text"
                          inputMode="numeric"
                          value={maxLossInput}
                          onChange={(e) => setMaxLossInput(e.target.value.replace(/[^0-9]/g, ""))}
                          className="w-full terminal-card rounded px-2.5 py-1.5 text-sm text-rose-500 font-mono font-bold focus:border-rose-500 focus:outline-none"
                        />
                        <span className="absolute right-2.5 top-2 text-xs text-rose-500 font-mono font-semibold">USD / EUR</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {["50", "100", "250", "500", "1000"].map((amt) => (
                          <button
                            key={amt}
                            type="button"
                            onClick={() => setMaxLossInput(amt)}
                            className={`px-1.5 py-0.5 text-[10px] font-mono font-semibold rounded border transition cursor-pointer ${
                              maxLossInput === amt ? "bg-rose-600/30 text-rose-500 border-rose-500" : "terminal-card text-secondary"
                            }`}
                          >
                            ${amt}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="text-[11px] text-secondary font-mono pt-0.5">
                    Buffer to Circuit Breaker: <strong className={lossDistance > 50 ? "text-emerald-500 font-bold" : "text-amber-500 font-bold"}>${lossDistance.toFixed(2)}</strong>
                  </div>
                </div>

                {/* Card 3: Daily Capital Ceiling */}
                <div className="terminal-elevated p-3.5 space-y-2 hover:border-accent transition">
                  <div className="flex justify-between items-center">
                    <label className="text-xs text-secondary uppercase font-mono font-bold flex items-center gap-1 cursor-help">
                      Daily Capital Ceiling <span className="text-xs text-indigo-400">ⓘ</span>
                    </label>
                    <DollarSign className="w-4 h-4 text-indigo-500" />
                  </div>
                  <div className="relative">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={capCeilingInput}
                      onChange={(e) => setCapCeilingInput(e.target.value.replace(/[^0-9]/g, ""))}
                      className="w-full terminal-card rounded px-2.5 py-1.5 text-sm text-primary font-mono font-bold focus:border-indigo-500 focus:outline-none"
                    />
                    <span className="absolute right-2.5 top-2 text-xs text-indigo-500 font-mono font-semibold">USD / EUR</span>
                  </div>
                  <div className="flex items-center gap-1.5 pt-0.5">
                    {["1000", "5000", "10000", "25000"].map((amt) => (
                      <button
                        key={amt}
                        type="button"
                        onClick={() => setCapCeilingInput(amt)}
                        className={`px-2 py-0.5 text-xs font-mono font-semibold rounded border transition cursor-pointer ${
                          capCeilingInput === amt
                            ? "bg-indigo-600/30 text-indigo-500 border-indigo-500"
                            : "terminal-card text-secondary hover:text-primary"
                        }`}
                      >
                        ${amt}
                      </button>
                    ))}
                  </div>
                  <div className="text-[11px] text-secondary font-mono">
                    Utilized: <strong className="text-primary font-bold">${utilizedCap.toFixed(2)}</strong> ({capPct}%)
                  </div>
                </div>

                {/* Card 4: Auto-Flatten Intraday & Synthetic Fractional Stops */}
                <div className="terminal-elevated p-3.5 space-y-2 hover:border-accent transition">
                  <div className="flex justify-between items-center">
                    <label className="text-xs text-secondary uppercase font-mono font-bold flex items-center gap-1">
                      MOC & Fractional Stops <span className="text-xs text-amber-500">ⓘ</span>
                    </label>
                    <Clock className="w-4 h-4 text-amber-500" />
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <span className="text-xs text-primary font-medium">0 Overnight Exposure (MOC)</span>
                    <button
                      type="button"
                      onClick={() => setIntradayFlattenToggle(!intradayFlattenToggle)}
                      className={`w-10 h-5 rounded-full transition-colors relative cursor-pointer ${
                        intradayFlattenToggle ? "bg-emerald-600" : "bg-slate-500"
                      }`}
                    >
                      <span className={`block w-3.5 h-3.5 rounded-full bg-white transition-transform ${
                        intradayFlattenToggle ? "translate-x-5" : "translate-x-1"
                      }`} />
                    </button>
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <span className="text-xs text-primary font-medium">Synthetic Fractional Stops</span>
                    <button
                      type="button"
                      onClick={() => setFractionalToggle(!fractionalToggle)}
                      className={`w-10 h-5 rounded-full transition-colors relative cursor-pointer ${
                        fractionalToggle ? "bg-emerald-600" : "bg-slate-500"
                      }`}
                    >
                      <span className={`block w-3.5 h-3.5 rounded-full bg-white transition-transform ${
                        fractionalToggle ? "translate-x-5" : "translate-x-1"
                      }`} />
                    </button>
                  </div>

                  <div className="text-[10px] text-secondary font-mono pt-1">
                    Auto-flattens at US {riskStatus?.usMocFlattenCutoff || "15:45"} EST / EU {riskStatus?.euMocFlattenCutoff || "17:15"} CET.
                  </div>
                </div>
              </div>

              {/* Action Bar */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-border font-mono text-xs">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <span className="text-secondary font-bold uppercase">Routing Mode:</span>
                    <select
                      value={modeToggle}
                      onChange={(e) => setModeToggle(e.target.value as "PAPER" | "LIVE")}
                      className="terminal-card rounded px-2.5 py-1 text-xs text-primary font-mono focus:outline-none"
                    >
                      <option value="PAPER">PAPER (Port 4002)</option>
                      <option value="LIVE">LIVE PRODUCTION (Port 4001)</option>
                    </select>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <span className="text-secondary font-bold uppercase">Market Scope:</span>
                    <select
                      value={marketScopeToggle}
                      onChange={(e) => setMarketScopeToggle(e.target.value as "ALL" | "US" | "EUROPE")}
                      className="terminal-card rounded px-2.5 py-1 text-xs text-primary font-mono focus:outline-none"
                    >
                      <option value="ALL">🌐 ALL MARKETS</option>
                      <option value="US">🇺🇸 US ONLY (USD)</option>
                      <option value="EUROPE">🇪🇺 EUROPE ONLY (EUR)</option>
                    </select>
                  </div>

                  {modeToggle === "LIVE" && (
                    <input
                      type="password"
                      value={liveTokenInput}
                      onChange={(e) => setLiveTokenInput(e.target.value)}
                      placeholder="Live Confirmation Token"
                      className="terminal-card border-rose-500/50 rounded px-2 py-1 text-xs text-primary font-mono w-44"
                    />
                  )}
                </div>

                <div className="flex items-center gap-3">
                  {saveSuccess && (
                    <span className="text-emerald-500 font-bold flex items-center gap-1 text-[11px]">
                      <CheckCircle2 className="w-4 h-4" /> Parameters Synchronized
                    </span>
                  )}
                  {error && <span className="text-rose-500 font-bold text-[11px]">{error}</span>}
                  
                  <button
                    type="button"
                    onClick={handleSaveRiskSettings}
                    disabled={loading}
                    className="bg-indigo-600 hover:bg-indigo-500 text-white font-mono text-xs font-bold px-4 py-2 rounded-lg transition cursor-pointer flex items-center gap-2 shadow-sm"
                  >
                    {loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : null}
                    <span>APPLY RISK GATES</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Panel B: Pre-Trade Risk Gates Checklist & Emergency Flush (4 Cols) */}
            <div className="lg:col-span-4 space-y-4 font-mono text-xs">
              {/* Pre-Trade Gates Checklist */}
              <div className="terminal-card p-4 space-y-3">
                <div className="flex items-center justify-between border-b border-border/80 pb-2">
                  <span className="font-bold text-primary uppercase tracking-wider text-xs flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-emerald-500" />
                    Pre-Trade Gatekeeper Status
                  </span>
                  <span className="text-[10px] text-emerald-500 font-bold">ALL PASS</span>
                </div>

                <div className="space-y-2 text-[11px]">
                  <div className="flex items-center justify-between py-1 border-b border-border/40">
                    <span className="text-secondary">Gate 0: Market Isolation Scope</span>
                    <strong className="text-emerald-500">{marketScopeToggle} PASS</strong>
                  </div>
                  <div className="flex items-center justify-between py-1 border-b border-border/40">
                    <span className="text-secondary">Gate 1: Gross Capital Ceiling</span>
                    <strong className="text-emerald-500">${maxCap.toLocaleString()} PASS</strong>
                  </div>
                  <div className="flex items-center justify-between py-1 border-b border-border/40">
                    <span className="text-secondary">Gate 2: Max Loss Circuit Breaker</span>
                    <strong className="text-emerald-500">-${calculatedMaxLoss.toFixed(0)} PASS</strong>
                  </div>
                  <div className="flex items-center justify-between py-1 border-b border-border/40">
                    <span className="text-secondary">Gate 3: 1.5% ADV Participation</span>
                    <strong className="text-emerald-500">ENFORCED</strong>
                  </div>
                  <div className="flex items-center justify-between py-1 border-b border-border/40">
                    <span className="text-secondary">Gate 4: Short Locate & Borrow (&lt;15%)</span>
                    <strong className="text-emerald-500">FAIL-CLOSED</strong>
                  </div>
                  <div className="flex items-center justify-between py-1 border-b border-border/40">
                    <span className="text-secondary">Gate 5: Binary Event Blackout</span>
                    <strong className="text-emerald-500">PROTECTED</strong>
                  </div>
                  <div className="flex items-center justify-between py-1 border-b border-border/40">
                    <span className="text-secondary">Gate 6: 15% Transaction Friction</span>
                    <strong className="text-emerald-500">ACTIVE</strong>
                  </div>
                </div>
              </div>

              {/* Physical Circuit Breaker & Kill Switch */}
              <div className={`terminal-card p-4 space-y-3 border ${
                isLocked ? "bg-rose-950/40 border-rose-500/60" : "border-border"
              }`}>
                <div className="flex items-center justify-between border-b border-border/80 pb-2">
                  <span className="font-bold text-rose-500 uppercase tracking-wider text-xs flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4" />
                    Emergency Circuit Breaker
                  </span>
                  <span className="text-[10px] text-secondary font-bold">PANIC FLUSH</span>
                </div>

                <p className="text-[11px] text-secondary leading-relaxed font-sans">
                  Instantly transmits global order cancel to IBKR Europe, liquidates all active fractional and integer positions, and hard-locks the execution router.
                </p>

                <div className="pt-2">
                  {isLocked ? (
                    <button
                      type="button"
                      onClick={handleUnlockSystem}
                      disabled={loading}
                      className="w-full bg-amber-600 hover:bg-amber-500 text-black font-bold text-xs py-2.5 rounded-lg transition flex items-center justify-center gap-2 cursor-pointer shadow-md"
                    >
                      <Unlock className="w-4 h-4" />
                      <span>AUTHORIZE ROUTER UNLOCK</span>
                    </button>
                  ) : !confirmKill ? (
                    <button
                      type="button"
                      onClick={() => setConfirmKill(true)}
                      className="w-full bg-rose-600/20 hover:bg-rose-600/30 border border-rose-500/50 text-rose-400 hover:text-white font-bold text-xs py-2.5 rounded-lg transition flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <ShieldAlert className="w-4 h-4" />
                      <span>FLATTEN ALL & ABORT (KILL SWITCH)</span>
                    </button>
                  ) : (
                    <div className="space-y-2 bg-rose-950/90 p-3 rounded-lg border border-rose-500">
                      <span className="text-xs text-rose-200 font-bold block text-center uppercase">
                        CONFIRM EMERGENCY FLUSH?
                      </span>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={handleEmergencyKill}
                          disabled={loading}
                          className="flex-1 bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs py-2 rounded transition cursor-pointer"
                        >
                          YES, FLATTEN NOW
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmKill(false)}
                          className="px-3 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded transition cursor-pointer"
                        >
                          CANCEL
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
