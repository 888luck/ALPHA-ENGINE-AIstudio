import React, { useState } from "react";
import { 
  CheckCircle2, 
  AlertTriangle, 
  ShieldCheck, 
  FileSpreadsheet, 
  Download, 
  RefreshCw,
  TrendingUp,
  Percent,
  Coins
} from "lucide-react";
import { HistoricalLog } from "../server/types";
import { ExchangeTag } from "./ExchangeTag";
import { InfoTip } from "./InstitutionalTooltip";

interface TcaAuditTableProps {
  historicalLogs: HistoricalLog[];
  onRefresh?: () => void;
}

export const TcaAuditTable: React.FC<TcaAuditTableProps> = ({
  historicalLogs = [],
  onRefresh
}) => {
  const [filterScope, setFilterScope] = useState<"ALL" | "US" | "EUROPE">("ALL");

  const isEuropean = (log: HistoricalLog) => {
    const s = log.symbol.toUpperCase();
    return s in ["SAP", "RWE", "ENGI", "SGO", "LVMH", "ASML", "MC", "ATO", "ATOS", "ONWD"] ||
           s.endsWith(".PA") || s.endsWith(".AS") || s.endsWith(".DE") || s.endsWith(".MC");
  };

  const filteredLogs = historicalLogs.filter((log) => {
    if (filterScope === "US") return !isEuropean(log);
    if (filterScope === "EUROPE") return isEuropean(log);
    return true;
  });

  const totalRealizedPnL = filteredLogs.reduce((sum, l) => sum + (l.realizedPnL || 0), 0);
  const totalCommissions = filteredLogs.reduce((sum, l) => sum + (l.commission || 0), 0);
  const avgEfficiency = filteredLogs.length > 0 
    ? filteredLogs.reduce((sum, l) => sum + (l.efficiencyRatio || 0), 0) / filteredLogs.length 
    : 0;
  const compliantCount = filteredLogs.filter(l => (l.efficiencyRatio || 0) <= 15).length;
  const complianceRate = filteredLogs.length > 0 ? (compliantCount / filteredLogs.length) * 100 : 100;

  const exportCSV = () => {
    if (filteredLogs.length === 0) return;
    const headers = ["Audit ID", "Timestamp (UTC)", "Symbol", "Side", "Qty", "Entry Price", "Exit Price", "Realized PnL", "Commission", "Friction Ratio %", "15% Filter Status"];
    const rows = filteredLogs.map((l) => [
      l.id,
      l.timestamp,
      l.symbol,
      l.direction,
      l.quantity,
      l.entryPrice,
      l.exitPrice,
      l.realizedPnL,
      l.commission,
      l.efficiencyRatio,
      l.efficiencyRatio <= 15 ? "PASSED" : "VIOLATION"
    ]);
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `mifid_rts22_tca_audit_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="terminal-card p-4 space-y-3 font-mono text-xs">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-border/80 pb-3">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 dark:text-[#00ff88]">
            <ShieldCheck className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-xs sm:text-sm font-bold text-primary uppercase tracking-wider font-mono">
                MiFID II RTS-22 Audit & Transaction Cost Analysis (TCA)
              </h3>
              <InfoTip id="mifid" />
            </div>
            <p className="text-[11px] text-secondary font-sans mt-0.5">
              Authoritative transaction friction verification, IBIE clearing commissions, and 15% efficiency gate compliance.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Scope Filter */}
          <div className="flex items-center bg-surface/50 border border-border rounded p-0.5 text-xs font-mono">
            <button
              type="button"
              onClick={() => setFilterScope("ALL")}
              className={`px-2 py-0.5 rounded transition cursor-pointer font-bold text-[11px] ${
                filterScope === "ALL" ? "bg-accent text-background" : "text-secondary hover:text-primary"
              }`}
            >
              ALL ({historicalLogs.length})
            </button>
            <button
              type="button"
              onClick={() => setFilterScope("US")}
              className={`px-2 py-0.5 rounded transition cursor-pointer font-bold text-[11px] ${
                filterScope === "US" ? "bg-blue-600 text-white" : "text-secondary hover:text-primary"
              }`}
            >
              US ({historicalLogs.filter(l => !isEuropean(l)).length})
            </button>
            <button
              type="button"
              onClick={() => setFilterScope("EUROPE")}
              className={`px-2 py-0.5 rounded transition cursor-pointer font-bold text-[11px] ${
                filterScope === "EUROPE" ? "bg-emerald-600 text-white" : "text-secondary hover:text-primary"
              }`}
            >
              EU ({historicalLogs.filter(l => isEuropean(l)).length})
            </button>
          </div>

          <button
            type="button"
            onClick={exportCSV}
            disabled={filteredLogs.length === 0}
            className="px-2.5 py-1 rounded border border-border bg-surface/40 hover:bg-surface text-secondary hover:text-primary transition cursor-pointer disabled:opacity-40 flex items-center gap-1.5 text-[11px]"
            title="Export MiFID II audit trail to CSV"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-500" />
            <span>CSV</span>
          </button>

          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              className="p-1 rounded border border-border bg-surface/40 hover:bg-surface text-secondary hover:text-primary transition cursor-pointer text-xs"
              title="Refresh TCA Logs"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* KPI Overview */}
      {filteredLogs.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="terminal-elevated p-2.5 space-y-1">
            <span className="text-[10px] text-secondary uppercase font-mono font-bold block">
              Cumulative Realized P&L
            </span>
            <div className={`text-sm font-bold font-mono ${totalRealizedPnL >= 0 ? "text-emerald-500 dark:text-[#00ff88]" : "text-rose-500 dark:text-rose-400"}`}>
              {totalRealizedPnL >= 0 ? "+" : ""}${totalRealizedPnL.toFixed(2)}
            </div>
          </div>

          <div className="terminal-elevated p-2.5 space-y-1">
            <span className="text-[10px] text-secondary uppercase font-mono font-bold block">
              Total Clearing Fees (IBIE)
            </span>
            <div className="text-sm font-bold font-mono text-primary">
              ${totalCommissions.toFixed(2)}
            </div>
          </div>

          <div className="terminal-elevated p-2.5 space-y-1">
            <span className="text-[10px] text-secondary uppercase font-mono font-bold block">
              Average Friction Ratio
            </span>
            <div className={`text-sm font-bold font-mono ${avgEfficiency <= 15 ? "text-emerald-500" : "text-rose-500"}`}>
              {avgEfficiency.toFixed(1)}% <span className="text-[10px] text-secondary font-normal">(Target &le; 15%)</span>
            </div>
          </div>

          <div className="terminal-elevated p-2.5 space-y-1">
            <span className="text-[10px] text-secondary uppercase font-mono font-bold block">
              MiFID II Compliance Gate
            </span>
            <div className="text-sm font-bold font-mono text-emerald-500 dark:text-[#00ff88] flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>{complianceRate.toFixed(0)}% Compliant</span>
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      {filteredLogs.length > 0 ? (
        <div className="overflow-x-auto border border-border/80 rounded-lg">
          <table className="w-full text-left font-mono text-[11px]">
            <thead>
              <tr className="border-b border-border/80 text-[10px] text-secondary font-bold uppercase tracking-wider bg-surface/60 select-none">
                <th className="py-2 px-3">Symbol</th>
                <th className="py-2 px-3">Side</th>
                <th className="py-2 px-3 text-right">Quantity</th>
                <th className="py-2 px-3 text-right">Entry Price</th>
                <th className="py-2 px-3 text-right">Exit Price</th>
                <th className="py-2 px-3 text-right">Realized P&L</th>
                <th className="py-2 px-3 text-right">Clearing Fee</th>
                <th className="py-2 px-3 text-right">Friction %</th>
                <th className="py-2 px-3 text-center">RTS-22 Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {filteredLogs.map((log) => {
                const eu = isEuropean(log);
                const currSymbol = eu ? "€" : "$";
                const isLong = log.direction === "BUY";
                const isCompliant = log.efficiencyRatio <= 15;

                return (
                  <tr key={log.id} className="hover:bg-surface/50 transition">
                    <td className="py-2 px-3 font-bold text-primary flex items-center gap-2">
                      <span>{log.symbol}</span>
                      <ExchangeTag symbol={log.symbol} />
                      <span className={`text-[9px] px-1 py-0.2 rounded font-bold font-mono ${
                        eu ? "bg-emerald-500/15 text-emerald-400" : "bg-blue-500/15 text-blue-400"
                      }`}>
                        {eu ? "EUR" : "USD"}
                      </span>
                    </td>

                    <td className="py-2 px-3">
                      <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold font-mono ${
                        isLong 
                          ? "bg-emerald-500/20 text-emerald-600 dark:text-[#00ff88]" 
                          : "bg-rose-500/20 text-rose-500 dark:text-rose-400"
                      }`}>
                        {isLong ? "LONG" : "SHORT"}
                      </span>
                    </td>

                    <td className="py-2 px-3 text-right font-bold text-primary tabular-nums">
                      {log.quantity}
                    </td>

                    <td className="py-2 px-3 text-right text-secondary tabular-nums">
                      {currSymbol}{log.entryPrice.toFixed(2)}
                    </td>

                    <td className="py-2 px-3 text-right font-bold text-primary tabular-nums">
                      {currSymbol}{log.exitPrice.toFixed(2)}
                    </td>

                    <td className={`py-2 px-3 text-right font-bold tabular-nums ${
                      log.realizedPnL >= 0 ? "text-emerald-500 dark:text-[#00ff88]" : "text-rose-500 dark:text-rose-400"
                    }`}>
                      {log.realizedPnL >= 0 ? "+" : ""}{currSymbol}{log.realizedPnL.toFixed(2)}
                    </td>

                    <td className="py-2 px-3 text-right text-secondary tabular-nums">
                      {currSymbol}{log.commission.toFixed(2)}
                    </td>

                    <td className="py-2 px-3 text-right tabular-nums">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        isCompliant 
                          ? "bg-emerald-500/20 text-emerald-600 dark:text-[#00ff88] border border-emerald-500/30" 
                          : "bg-rose-500/20 text-rose-600 dark:text-rose-300 border border-rose-500/30"
                      }`}>
                        {log.efficiencyRatio}%
                      </span>
                    </td>

                    <td className="py-2 px-3 text-center">
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold font-mono ${
                        isCompliant 
                          ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/30" 
                          : "bg-amber-500/10 text-amber-500 border border-amber-500/30"
                      }`}>
                        {isCompliant ? "MiFIR COMPLIANT" : "FRICTION ALERT"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-center py-10 text-secondary text-xs font-mono flex flex-col justify-center items-center terminal-elevated rounded-xl border border-dashed border-border/80">
          <CheckCircle2 className="w-8 h-8 text-secondary mb-2 opacity-40" />
          <p className="font-bold uppercase tracking-widest text-xs text-primary">
            No Closed Trades in Current Audit Window
          </p>
          <p className="text-[11px] text-secondary mt-1">
            Transaction Cost Analysis logs record automatically upon order fills and exit executions.
          </p>
        </div>
      )}
    </div>
  );
};
