import React, { useState } from "react";
import { ExchangeTag } from "./ExchangeTag";
import { 
  Lock, 
  Unlock, 
  TrendingUp, 
  ArrowUpRight, 
  ArrowDownRight, 
  ShieldAlert, 
  RefreshCw, 
  XOctagon, 
  Sliders, 
  AlertTriangle,
  CheckCircle2
} from "lucide-react";
import { ActiveTrade } from "../server/types";
import { getAdminHeaders } from "../utils/auth";

interface ActiveHoldingsTableProps {
  activeTrades: ActiveTrade[];
  onRefresh?: () => void;
  compact?: boolean;
}

export const ActiveHoldingsTable: React.FC<ActiveHoldingsTableProps> = ({
  activeTrades = [],
  onRefresh,
  compact = false
}) => {
  const [filterScope, setFilterScope] = useState<"ALL" | "US" | "EUROPE">("ALL");
  const [liquidatingSymbol, setLiquidatingSymbol] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Classify EU vs US by symbol heuristics or currency
  const isEuropean = (trade: ActiveTrade) => {
    const s = trade.symbol.toUpperCase();
    return s in ["SAP", "RWE", "ENGI", "SGO", "LVMH", "ASML", "MC", "ATO", "ATOS", "ONWD"] ||
           s.endsWith(".PA") || s.endsWith(".AS") || s.endsWith(".DE") || s.endsWith(".MC");
  };

  const filteredTrades = activeTrades.filter((t) => {
    if (filterScope === "US") return !isEuropean(t);
    if (filterScope === "EUROPE") return isEuropean(t);
    return true;
  });

  const totalUnrealizedPnL = filteredTrades.reduce((sum, t) => sum + (t.unrealizedPnL || 0), 0);
  const totalNotionalExposure = filteredTrades.reduce((sum, t) => sum + Math.abs(t.quantity * (t.currentPrice || t.entryPrice)), 0);

  const handleLiquidateSingle = async (trade: ActiveTrade) => {
    const confirm = window.confirm(`CONFIRM IMMEDIATE FLATTEN:\n\nClose active position in ${trade.symbol} (${trade.quantity} shares @ market)?`);
    if (!confirm) return;

    setLiquidatingSymbol(trade.symbol);
    setActionError(null);
    setActionSuccess(null);

    try {
      const exitSide = trade.direction === "BUY" ? "SELL" : "BUY";
      const res = await fetch("/api/place-trade", {
        method: "POST",
        headers: getAdminHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          symbol: trade.symbol,
          direction: exitSide,
          quantity: trade.quantity,
          entryPrice: trade.currentPrice || trade.entryPrice,
          stopPrice: (trade.currentPrice || trade.entryPrice) * (exitSide === "SELL" ? 0.95 : 1.05),
          orderType: "MKT",
          notes: "Manual Single Position Liquidation"
        })
      });

      if (res.ok) {
        setActionSuccess(`Liquidated position for ${trade.symbol}.`);
        setTimeout(() => setActionSuccess(null), 4000);
        if (onRefresh) onRefresh();
      } else {
        const err = await res.json().catch(() => ({}));
        setActionError(err.error || `Failed to liquidate ${trade.symbol}.`);
        setTimeout(() => setActionError(null), 6000);
      }
    } catch (err: any) {
      setActionError(`Network error liquidating ${trade.symbol}: ${err.message}`);
      setTimeout(() => setActionError(null), 6000);
    } finally {
      setLiquidatingSymbol(null);
    }
  };

  return (
    <div className="terminal-card p-4 space-y-3 font-mono text-xs">
      {/* Header & Filter Controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-border/80 pb-3">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded bg-indigo-500/10 border border-indigo-500/20 text-indigo-500 dark:text-indigo-400">
            <Lock className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-xs sm:text-sm font-bold text-primary uppercase tracking-wider font-mono">
                Active DMA Working Positions
              </h3>
              <span className="text-[10px] bg-indigo-500/20 text-indigo-600 dark:text-indigo-300 border border-indigo-500/40 px-2 py-0.2 rounded font-mono font-bold tracking-wider">
                AUTHORITATIVE BROKER TELEMETRY
              </span>
            </div>
            <p className="text-[11px] text-secondary font-sans mt-0.5">
              Real-time mark-to-market valuations, dynamic stop distances, and single-click position flattener.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Market Scope Filters */}
          <div className="flex items-center bg-surface/50 border border-border rounded p-0.5 text-xs font-mono">
            <button
              type="button"
              onClick={() => setFilterScope("ALL")}
              className={`px-2 py-0.5 rounded transition cursor-pointer font-bold text-[11px] ${
                filterScope === "ALL" ? "bg-accent text-background" : "text-secondary hover:text-primary"
              }`}
            >
              ALL ({activeTrades.length})
            </button>
            <button
              type="button"
              onClick={() => setFilterScope("US")}
              className={`px-2 py-0.5 rounded transition cursor-pointer font-bold text-[11px] ${
                filterScope === "US" ? "bg-blue-600 text-white" : "text-secondary hover:text-primary"
              }`}
            >
              US ({activeTrades.filter(t => !isEuropean(t)).length})
            </button>
            <button
              type="button"
              onClick={() => setFilterScope("EUROPE")}
              className={`px-2 py-0.5 rounded transition cursor-pointer font-bold text-[11px] ${
                filterScope === "EUROPE" ? "bg-emerald-600 text-white" : "text-secondary hover:text-primary"
              }`}
            >
              EU ({activeTrades.filter(t => isEuropean(t)).length})
            </button>
          </div>

          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              className="p-1 rounded border border-border bg-surface/40 hover:bg-surface text-secondary hover:text-primary transition cursor-pointer text-xs"
              title="Refresh Position Telemetry"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {actionSuccess && (
        <div className="p-2 bg-emerald-500/10 border border-emerald-500/30 text-emerald-500 dark:text-[#00ff88] text-[11px] rounded flex items-center gap-1.5 animate-in fade-in">
          <CheckCircle2 className="w-3.5 h-3.5" />
          <span>{actionSuccess}</span>
        </div>
      )}

      {actionError && (
        <div className="p-2 bg-rose-500/10 border border-rose-500/30 text-rose-500 text-[11px] rounded flex items-center gap-1.5 animate-in fade-in">
          <AlertTriangle className="w-3.5 h-3.5" />
          <span>{actionError}</span>
        </div>
      )}

      {/* Exposure Summary Strip */}
      {filteredTrades.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 rounded-lg bg-surface/40 border border-border/60 text-[11px]">
          <div className="flex items-center gap-4 text-secondary">
            <span>
              Committed Exposure: <strong className="text-primary font-bold">${totalNotionalExposure.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
            </span>
            <span>•</span>
            <span>
              Active Lanes: <strong className="text-primary font-bold">{filteredTrades.length} Symbol(s)</strong>
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-secondary font-bold">Unrealized Pool P&L:</span>
            <span className={`font-black font-mono px-2 py-0.5 rounded ${
              totalUnrealizedPnL >= 0 
                ? "bg-emerald-500/15 text-emerald-500 dark:text-[#00ff88] border border-emerald-500/30" 
                : "bg-rose-500/15 text-rose-500 dark:text-rose-400 border border-rose-500/30"
            }`}>
              {totalUnrealizedPnL >= 0 ? "+" : ""}${totalUnrealizedPnL.toFixed(2)}
            </span>
          </div>
        </div>
      )}

      {/* High-Density Data Table */}
      {filteredTrades.length > 0 ? (
        <div className="overflow-x-auto border border-border/80 rounded-lg">
          <table className="w-full text-left font-mono text-[11px]">
            <thead>
              <tr className="border-b border-border/80 text-[10px] text-secondary font-bold uppercase tracking-wider bg-surface/60 select-none">
                <th className="py-2 px-3">Symbol / Venue</th>
                <th className="py-2 px-3">Side</th>
                <th className="py-2 px-3 text-right">Quantity</th>
                <th className="py-2 px-3 text-right">Entry Price</th>
                <th className="py-2 px-3 text-right">Current Mark</th>
                <th className="py-2 px-3 text-right">Stop Loss</th>
                <th className="py-2 px-3 text-right">Unrealized P&L</th>
                <th className="py-2 px-3 text-center">Lifecycle Status</th>
                <th className="py-2 px-3 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {filteredTrades.map((trade) => {
                const eu = isEuropean(trade);
                const currSymbol = eu ? "€" : "$";
                const isLong = trade.direction === "BUY";
                const stopDist = Math.abs(trade.currentPrice - (trade.stopPrice || trade.entryPrice * 0.98));
                const pnl = trade.unrealizedPnL || 0;
                const costBasis = trade.quantity * trade.entryPrice;
                const pnlPct = costBasis > 0 ? (pnl / costBasis) * 100 : 0;

                return (
                  <tr key={trade.id} className="hover:bg-surface/50 transition">
                    {/* Symbol & Venue */}
                    <td className="py-2 px-3 font-bold text-primary flex items-center gap-2">
                      <span>{trade.symbol}</span>
                      <ExchangeTag symbol={trade.symbol} />
                      <span className={`text-[9px] px-1 py-0.2 rounded font-bold font-mono ${
                        eu ? "bg-emerald-500/15 text-emerald-400" : "bg-blue-500/15 text-blue-400"
                      }`}>
                        {eu ? "EUR" : "USD"}
                      </span>
                    </td>

                    {/* Side */}
                    <td className="py-2 px-3">
                      <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold font-mono ${
                        isLong 
                          ? "bg-emerald-500/20 text-emerald-600 dark:text-[#00ff88]" 
                          : "bg-rose-500/20 text-rose-500 dark:text-rose-400"
                      }`}>
                        {isLong ? "LONG" : "SHORT"}
                      </span>
                    </td>

                    {/* Quantity */}
                    <td className="py-2 px-3 text-right font-bold text-primary tabular-nums">
                      {trade.quantity.toFixed(4)}
                    </td>

                    {/* Entry Price */}
                    <td className="py-2 px-3 text-right text-secondary tabular-nums">
                      {currSymbol}{trade.entryPrice.toFixed(2)}
                    </td>

                    {/* Current Mark */}
                    <td className="py-2 px-3 text-right font-bold text-indigo-500 dark:text-indigo-400 tabular-nums">
                      {currSymbol}{trade.currentPrice.toFixed(2)}
                    </td>

                    {/* Stop Loss & Distance */}
                    <td className="py-2 px-3 text-right tabular-nums">
                      <div className="flex flex-col items-end">
                        <span className="font-bold text-rose-500/90 dark:text-rose-400">
                          {currSymbol}{(trade.stopPrice || (trade.entryPrice * (isLong ? 0.98 : 1.02))).toFixed(2)}
                        </span>
                        <span className="text-[10px] text-secondary">
                          Δ {currSymbol}{stopDist.toFixed(2)}
                        </span>
                      </div>
                    </td>

                    {/* Unrealized P&L */}
                    <td className="py-2 px-3 text-right tabular-nums">
                      <div className="flex flex-col items-end">
                        <span className={`font-bold ${pnl >= 0 ? "text-emerald-500 dark:text-[#00ff88]" : "text-rose-500 dark:text-rose-400"}`}>
                          {pnl >= 0 ? "+" : ""}{currSymbol}{pnl.toFixed(2)}
                        </span>
                        <span className={`text-[10px] ${pnl >= 0 ? "text-emerald-500/80" : "text-rose-500/80"}`}>
                          {pnl >= 0 ? "+" : ""}{pnlPct.toFixed(2)}%
                        </span>
                      </div>
                    </td>

                    {/* Lifecycle Status */}
                    <td className="py-2 px-3 text-center">
                      {trade.breakevenApplied ? (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-cyan-500/15 text-cyan-500 dark:text-cyan-300 border border-cyan-500/30">
                          BE LATCHED (+1.0x ATR)
                        </span>
                      ) : trade.tranche1ScaledOut ? (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/15 text-amber-500 dark:text-amber-300 border border-amber-500/30">
                          50% SCALED (+2.0x ATR)
                        </span>
                      ) : (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-surface border border-border text-secondary">
                          ACTIVE RUNNER (1.8 ATR)
                        </span>
                      )}
                    </td>

                    {/* Action */}
                    <td className="py-2 px-3 text-center">
                      <button
                        type="button"
                        disabled={liquidatingSymbol === trade.symbol}
                        onClick={() => handleLiquidateSingle(trade)}
                        className="px-2 py-0.5 rounded bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 dark:text-rose-400 border border-rose-500/30 hover:border-rose-500 text-[10px] font-bold transition cursor-pointer disabled:opacity-40 flex items-center gap-1 mx-auto"
                        title={`Instantly liquidate active position in ${trade.symbol}`}
                      >
                        {liquidatingSymbol === trade.symbol ? (
                          <RefreshCw className="w-3 h-3 animate-spin" />
                        ) : (
                          <XOctagon className="w-3 h-3" />
                        )}
                        <span>FLATTEN</span>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-center py-10 text-secondary text-xs font-mono flex flex-col justify-center items-center terminal-elevated rounded-xl border border-dashed border-border/80">
          <Unlock className="w-8 h-8 text-secondary mb-2 opacity-40" />
          <p className="font-bold uppercase tracking-widest text-xs text-primary">
            All Execution Routes Flat
          </p>
          <p className="text-[11px] text-secondary mt-1">
            Portfolio sits 100% in cash/treasuries with zero overnight gap risk. Router awaiting signal triggers.
          </p>
        </div>
      )}
    </div>
  );
};
