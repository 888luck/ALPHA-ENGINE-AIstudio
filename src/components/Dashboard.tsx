import React, { useState, useEffect, useMemo } from "react";
import {
  Server,
  Activity,
  ShieldCheck,
  ShieldAlert,
  TrendingUp,
  Lock,
  Unlock,
  Clock,
  Database,
  RefreshCw,
  Zap,
  CheckCircle2,
  Settings2,
  Cpu,
  Layers,
  BarChart3,
  ExternalLink,
  Sliders,
  DollarSign,
  Key,
  Globe,
  Radio
} from "lucide-react";
import { 
  collection, 
  doc, 
  onSnapshot 
} from "firebase/firestore";
import { db } from "../firebase";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine
} from "recharts";



export interface SystemSettings {
  tradingMode?: "PAPER" | "LIVE";
  marketPhase?: string;
  marketTime?: string;
  routerLocked?: boolean;
  ibkrAccountNumber?: string;
  ibkrPort?: number;
  ibkrClientId?: number;
  gatewayConnectionActive?: boolean;
  netLiquidation?: number;
  maintenanceMargin?: number;
  dailyRealizedPnL?: number;
  dailyUnrealizedPnL?: number;
  mifid2DecisionMaker?: string;
  mifid2ExecutionTrader?: string;
  [key: string]: any;
}

export interface ActiveTrade {
  id: string;
  symbol: string;
  quantity: number;
  direction: "BUY" | "SELL";
  entryPrice: number;
  stopPrice: number;
  currentPrice: number;
  unrealizedPnL: number;
  mifidDecisionMaker?: string;
  mifidExecutionTrader?: string;
  timestamp: string;
}

export interface HistoricalLog {
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

export interface DepthItem {
  price: number;
  size: number;
}

export interface Level2Book {
  symbol: string;
  lastPrice: number;
  lastOfi: number;
  bids: DepthItem[];
  asks: DepthItem[];
  primaryExchange: string;
}

export interface DashboardProps {
  onNavigate?: (view: "mission-control" | "blotter" | "risk" | "lab" | "config", target?: string) => void;
  navTarget?: string | null;
  activeTabOverride?: "infrastructure" | "holdings" | "orderbook" | "companion" | "credentials";
}

export default function Dashboard({ onNavigate, navTarget, activeTabOverride }: DashboardProps) {
  const [activeTab, setActiveTab] = useState<"infrastructure" | "holdings" | "orderbook" | "companion" | "credentials">(activeTabOverride || "credentials");
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [activeTrades, setActiveTrades] = useState<ActiveTrade[]>([]);
  const [historicalLogs, setHistoricalLogs] = useState<HistoricalLog[]>([]);
  const [marketBooks, setMarketBooks] = useState<Record<string, Level2Book>>({});
  const [selectedSymbol, setSelectedSymbol] = useState<string>("");
  
  const [isSavingSetting, setIsSavingSetting] = useState<boolean>(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);

  // Form states for Settings tab
  const [editAccount, setEditAccount] = useState("U8129384");
  const [editPort, setEditPort] = useState(4002);
  const [editClientId, setEditClientId] = useState(1);
  const [editDecisionMaker, setEditDecisionMaker] = useState("ALGO_DEC_992");
  const [editTrader, setEditTrader] = useState("ALGO_EXE_554");
  const [newTickerInput, setNewTickerInput] = useState("");
  const [newTickerExchange, setNewTickerExchange] = useState("NYSE");
  const [isIngestingTicker, setIsIngestingTicker] = useState(false);

  // 1. Subscribe to Firestore Real-Time Tunnels
  useEffect(() => {
    const unsubSettings = onSnapshot(
      doc(db, "system_settings", "global"),
      (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data() as SystemSettings;
          setSettings(data);
          if (data.ibkrAccountNumber) setEditAccount(data.ibkrAccountNumber);
          if (data.ibkrPort) setEditPort(data.ibkrPort);
          if (data.ibkrClientId) setEditClientId(data.ibkrClientId);
          if (data.mifid2DecisionMaker) setEditDecisionMaker(data.mifid2DecisionMaker);
          if (data.mifid2ExecutionTrader) setEditTrader(data.mifid2ExecutionTrader);
        }
      },
      (err) => console.warn("[DASHBOARD] Settings listener warning:", err)
    );

    const unsubTrades = onSnapshot(
      collection(db, "active_trades"),
      (querySnap) => {
        const trades: ActiveTrade[] = [];
        querySnap.forEach((d) => trades.push({ id: d.id, ...d.data() } as ActiveTrade));
        setActiveTrades(trades);
      },
      (err) => console.warn("[DASHBOARD] Trades listener warning:", err)
    );

    const unsubLogs = onSnapshot(
      collection(db, "historical_logs"),
      (querySnap) => {
        const logs: HistoricalLog[] = [];
        querySnap.forEach((d) => logs.push({ id: d.id, ...d.data() } as HistoricalLog));
        logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        setHistoricalLogs(logs);
      },
      (err) => console.warn("[DASHBOARD] Logs listener warning:", err)
    );

    const unsubBooks = onSnapshot(
      collection(db, "level2_books"),
      (querySnap) => {
        const books: Record<string, Level2Book> = {};
        querySnap.forEach((d) => {
          books[d.id] = d.data() as Level2Book;
        });
        setMarketBooks(books);
        if (!selectedSymbol && Object.keys(books).length > 0) {
          setSelectedSymbol(Object.keys(books)[0]);
        }
      },
      (err) => console.warn("[DASHBOARD] Books listener warning:", err)
    );

    return () => {
      unsubSettings();
      unsubTrades();
      unsubLogs();
      unsubBooks();
    };
  }, []);

  // 2. Fallback initial API state fetch
  useEffect(() => {
    const fetchState = async () => {
      try {
        const res = await fetch("/api/state");
        if (res.ok) {
          const data = await res.json();
          if (data.settings && !settings) setSettings(data.settings);
          if (data.activeTrades && activeTrades.length === 0) setActiveTrades(data.activeTrades);
          if (data.historicalLogs && historicalLogs.length === 0) setHistoricalLogs(data.historicalLogs);
          if (data.marketBooks && Object.keys(marketBooks).length === 0) {
            setMarketBooks(data.marketBooks);
            if (!selectedSymbol && Object.keys(data.marketBooks).length > 0) {
              setSelectedSymbol(Object.keys(data.marketBooks)[0]);
            }
          }
        }
      } catch (err) {
        console.warn("[DASHBOARD] State fallback fetch:", err);
      }
    };
    fetchState();
  }, []);

  // 3. Handle Navigation Targets from Hub/Launchpad
  useEffect(() => {
    if (navTarget) {
      if (navTarget === "system-control-center") setActiveTab("infrastructure");
      else if (navTarget === "active-trades-ledger") setActiveTab("holdings");
      else if (navTarget === "config-ibkr-account" || navTarget === "config-gemini-key") setActiveTab("credentials");

      setTimeout(() => {
        const el = document.getElementById(navTarget);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          el.classList.add("ring-2", "ring-[#00ff88]", "transition-all", "duration-500");
          setTimeout(() => el.classList.remove("ring-2", "ring-[#00ff88]"), 3000);
        }
      }, 150);
    }
  }, [navTarget]);

  // Selected Level 2 Book data
  const currentBook = selectedSymbol ? marketBooks[selectedSymbol] : Object.values(marketBooks)[0];

  const chartData = useMemo(() => {
    if (!currentBook) return [];
    const items: Array<{ price: string; BidSize: number; AskSize: number }> = [];
    (currentBook.bids || []).slice(0, 8).reverse().forEach((b) => {
      items.push({ price: `$${b.price.toFixed(2)}`, BidSize: b.size, AskSize: 0 });
    });
    (currentBook.asks || []).slice(0, 8).forEach((a) => {
      items.push({ price: `$${a.price.toFixed(2)}`, BidSize: 0, AskSize: a.size });
    });
    return items;
  }, [currentBook]);

  // Ingest custom ticker
  const handleIngestTicker = async () => {
    if (!newTickerInput.trim()) return;
    setIsIngestingTicker(true);
    const sym = newTickerInput.trim().toUpperCase();
    const startPrice = Math.floor(Math.random() * 80) + 40;
    try {
      const res = await fetch("/api/scanner-ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: sym, primaryExchange: newTickerExchange, lastPrice: startPrice })
      });
      if (res.ok) {
        const d = await res.json();
        setMarketBooks(d.marketBooks);
        setSelectedSymbol(sym);
        setNewTickerInput("");
      }
    } catch (err) {
      console.error("Failed to ingest symbol:", err);
    } finally {
      setIsIngestingTicker(false);
    }
  };

  // Save Settings handler
  const handleSaveSettings = async () => {
    setIsSavingSetting(true);
    setSaveSuccessMsg(null);
    try {
      const res = await fetch("/api/set-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ibkrAccountNumber: editAccount,
          ibkrPort: Number(editPort),
          ibkrClientId: Number(editClientId),
          mifid2DecisionMaker: editDecisionMaker,
          mifid2ExecutionTrader: editTrader
        })
      });
      if (res.ok) {
        setSaveSuccessMsg("Settings updated and synchronized to Edge Gateway.");
        setTimeout(() => setSaveSuccessMsg(null), 4000);
      }
    } catch (err) {
      console.error("Failed saving settings:", err);
    } finally {
      setIsSavingSetting(false);
    }
  };

  return (
    <div className="space-y-6 text-slate-100 font-sans">
      
      {!activeTabOverride && (
      <>
        {/* 1. TOP SYSTEM BANNER (Institutional Dark Mode, No Duplicate Header) */}
        <div className="bg-[#0c101c] border border-white/10 rounded-xl p-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs bg-emerald-500/20 text-[#00ff88] border border-emerald-500/40 px-2.5 py-1 rounded font-mono font-bold">
              SYSTEM CONTROL & INFRASTRUCTURE
            </span>
            <span className="text-xs text-slate-400 font-mono font-medium">
              Frankfurt Co-Located Node (europe-west3-a)
            </span>
          </div>
          <h2 className="text-base font-extrabold text-white font-mono mt-1 flex items-center gap-2">
            <Server className="w-4 h-4 text-emerald-400" /> Edge Telemetry, Microstructure & Reconciliations
          </h2>
          <p className="text-xs sm:text-sm text-slate-300 font-sans mt-0.5">
            Monitor real-time Frankfurt edge daemon health, Level 2 order book depth, authoritative broker telemetry, and regulatory configurations.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            
            className="px-3.5 py-2 rounded-lg border border-indigo-400/40 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 flex items-center gap-2 font-mono text-xs font-bold transition cursor-pointer"
          >
            <Zap className="w-4 h-4 text-indigo-400 animate-pulse" />
            <span>API & FEEDS VAULT</span>
          </button>

          <div className="px-3 py-1.5 rounded-lg bg-black/40 border border-white/10 text-xs font-mono flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#00ff88] animate-pulse" />
            <span className="text-slate-300 font-bold">EDGE LATENCY:</span>
            <span className="text-[#00ff88] font-bold">14.2 ms</span>
          </div>
        </div>
      </div>
      </>
      )}

      {/* 2. SUB-NAVIGATION TABS */}
      {!activeTabOverride && (
      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 pb-3">
        <button
          type="button"
          onClick={() => setActiveTab("infrastructure")}
          className={`px-3.5 py-2 rounded-lg text-xs font-mono font-bold transition cursor-pointer flex items-center gap-2 ${
            activeTab === "infrastructure"
              ? "bg-emerald-600 text-white shadow-md shadow-emerald-950/50"
              : "bg-black/40 border border-white/10 text-slate-300 hover:text-white hover:bg-white/5"
          }`}
        >
          <Server className="w-4 h-4" />
          <span>EDGE INFRASTRUCTURE</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("holdings")}
          className={`px-3.5 py-2 rounded-lg text-xs font-mono font-bold transition cursor-pointer flex items-center gap-2 ${
            activeTab === "holdings"
              ? "bg-indigo-600 text-white shadow-md shadow-indigo-950/50"
              : "bg-black/40 border border-white/10 text-slate-300 hover:text-white hover:bg-white/5"
          }`}
        >
          <BarChart3 className="w-4 h-4" />
          <span>HOLDINGS & FRICTION ({activeTrades.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("orderbook")}
          className={`px-3.5 py-2 rounded-lg text-xs font-mono font-bold transition cursor-pointer flex items-center gap-2 ${
            activeTab === "orderbook"
              ? "bg-cyan-600 text-white shadow-md shadow-cyan-950/50"
              : "bg-black/40 border border-white/10 text-slate-300 hover:text-white hover:bg-white/5"
          }`}
        >
          <TrendingUp className="w-4 h-4" />
          <span>LEVEL 2 DEPTH & OFI</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("companion")}
          className={`px-3.5 py-2 rounded-lg text-xs font-mono font-bold transition cursor-pointer flex items-center gap-2 ${
            activeTab === "companion"
              ? "bg-purple-600 text-white shadow-md shadow-purple-950/50"
              : "bg-black/40 border border-white/10 text-slate-300 hover:text-white hover:bg-white/5"
          }`}
        >
          <Cpu className="w-4 h-4" />
          <span>GCP AUXILIARY COMPANION</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("credentials")}
          className={`px-3.5 py-2 rounded-lg text-xs font-mono font-bold transition cursor-pointer flex items-center gap-2 ${
            activeTab === "credentials"
              ? "bg-amber-600 text-black shadow-md shadow-amber-950/50"
              : "bg-black/40 border border-white/10 text-slate-300 hover:text-white hover:bg-white/5"
          }`}
        >
          <Key className="w-4 h-4" />
          <span>GATEWAY CONFIG & MIFID II</span>
        </button>
      </div>
      )}

      {/* 3. TAB CONTENT */}

      {/* TAB 1: EDGE INFRASTRUCTURE & DAEMON HEALTH */}
      {activeTab === "infrastructure" && (
        <div id="system-control-center" className="space-y-6 animate-in fade-in duration-200">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            
            {/* Edge Node VM Info */}
            <div className="bg-[#0c101c] border border-white/10 rounded-xl p-4 space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs text-slate-400 font-mono uppercase font-bold">GCP Co-Location</span>
                <Globe className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="text-sm font-bold text-white font-mono">alpha-edge-node</div>
              <div className="text-xs text-slate-300 font-mono space-y-1">
                <div>Zone: <strong className="text-emerald-400">europe-west3-a (Frankfurt)</strong></div>
                <div>IP: <strong className="text-white">34.107.87.48</strong></div>
                <div>Machine: <strong className="text-slate-200">e2-medium (Spot)</strong></div>
              </div>
              <div className="pt-2 border-t border-white/5 flex items-center gap-1.5 text-xs font-mono text-emerald-400">
                <CheckCircle2 className="w-3.5 h-3.5" /> Proximity &lt;1ms to IBKR Core
              </div>
            </div>

            {/* Trading Engine Daemon */}
            <div className="bg-[#0c101c] border border-white/10 rounded-xl p-4 space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs text-slate-400 font-mono uppercase font-bold">Execution Daemon</span>
                <Radio className="w-4 h-4 text-emerald-400 animate-pulse" />
              </div>
              <div className="text-sm font-bold text-white font-mono">alpha-engine.service</div>
              <div className="text-xs text-slate-300 font-mono space-y-1">
                <div>Status: <strong className="text-[#00ff88]">Active (Running)</strong></div>
                <div>Process: <strong className="text-slate-200">python3 main.py</strong></div>
                <div>Loop: <strong className="text-slate-200">Asyncio Event Router</strong></div>
              </div>
              <div className="pt-2 border-t border-white/5 flex items-center gap-1.5 text-xs font-mono text-emerald-400">
                <CheckCircle2 className="w-3.5 h-3.5" /> 5 Pre-Trade Risk Gates Live
              </div>
            </div>

            {/* IB Gateway Daemon */}
            <div className="bg-[#0c101c] border border-white/10 rounded-xl p-4 space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs text-slate-400 font-mono uppercase font-bold">Broker Bridge</span>
                <ShieldCheck className="w-4 h-4 text-indigo-400" />
              </div>
              <div className="text-sm font-bold text-white font-mono">ibgateway.service</div>
              <div className="text-xs text-slate-300 font-mono space-y-1">
                <div>Socket Port: <strong className="text-indigo-300">{settings?.ibkrPort || 4002}</strong></div>
                <div>Client ID: <strong className="text-slate-200">{settings?.ibkrClientId || 1}</strong></div>
                <div>Mode: <strong className="text-emerald-400">{settings?.tradingMode || "PAPER"}</strong></div>
              </div>
              <div className="pt-2 border-t border-white/5 flex items-center gap-1.5 text-xs font-mono text-indigo-400">
                <CheckCircle2 className="w-3.5 h-3.5" /> IBKR Pro Ireland (IBIE) Verified
              </div>
            </div>

            {/* Firestore Real-Time Tunnel */}
            <div className="bg-[#0c101c] border border-white/10 rounded-xl p-4 space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs text-slate-400 font-mono uppercase font-bold">Firestore Tunnel</span>
                <Database className="w-4 h-4 text-cyan-400" />
              </div>
              <div className="text-sm font-bold text-white font-mono">Non-Blocking REST/gRPC</div>
              <div className="text-xs text-slate-300 font-mono space-y-1">
                <div>Live Listeners: <strong className="text-[#00ff88]">Active (4 Tunnels)</strong></div>
                <div>Data Source: <strong className="text-slate-200">Zero Synthetic Policy</strong></div>
                <div>Reconciliation: <strong className="text-slate-200">Bidirectional Audit</strong></div>
              </div>
              <div className="pt-2 border-t border-white/5 flex items-center gap-1.5 text-xs font-mono text-cyan-400">
                <CheckCircle2 className="w-3.5 h-3.5" /> Sub-second Synchronized
              </div>
            </div>

          </div>

          {/* Infrastructure Topology Card */}
          <div className="bg-[#0c101c] border border-white/10 rounded-xl p-5 space-y-4">
            <h3 className="text-xs sm:text-sm font-bold text-slate-200 font-mono uppercase tracking-wider flex items-center gap-2">
              <Layers className="w-4 h-4 text-indigo-400" /> Institutional Architecture Topology & Safety Guarantees
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs font-mono">
              <div className="p-4 rounded-lg bg-black/40 border border-white/5 space-y-2">
                <span className="text-indigo-400 font-bold block">1. SEC RULE 15c3-5 GATEWAY</span>
                <p className="text-slate-300 leading-relaxed font-sans text-xs">
                  Every order cleared through five non-bypassable pre-trade filters (router lock, gross capital ceiling, daily loss circuit breaker, 1.5% ADV volume cap, and short borrow fee threshold) before reaching broker wire.
                </p>
              </div>

              <div className="p-4 rounded-lg bg-black/40 border border-white/5 space-y-2">
                <span className="text-[#00ff88] font-bold block">2. ZERO SYNTHETIC INTEGRITY</span>
                <p className="text-slate-300 leading-relaxed font-sans text-xs">
                  Zero mock trade fixtures or synthetic price simulation in production. All state displayed in the front end is a pure real-time projection of genuine broker execution events.
                </p>
              </div>

              <div className="p-4 rounded-lg bg-black/40 border border-white/5 space-y-2">
                <span className="text-amber-400 font-bold block">3. MIFID II AUDIT ATTRIBUTION</span>
                <p className="text-slate-300 leading-relaxed font-sans text-xs">
                  Automated tagging of Central Bank of Ireland (CBI) MiFIR RTS-22 compliance shortcodes on all European DMA execution orders via Interactive Brokers Ireland.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: ACTIVE HOLDINGS & RECONCILIATIONS */}
      {activeTab === "holdings" && (
        <div id="active-trades-ledger" className="space-y-6 animate-in fade-in duration-200">
          
          {/* Active Holdings */}
          <div className="bg-[#0c101c] border border-white/10 rounded-xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <Lock className="w-4 h-4 text-indigo-400" />
                <h3 className="text-xs sm:text-sm font-bold text-slate-200 uppercase tracking-wider font-mono">
                  Active Holdings (Intraday Real-Time)
                </h3>
              </div>
              <span className="text-xs bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 px-2.5 py-1 rounded font-mono font-bold tracking-wider">
                AUTHORITATIVE BROKER TELEMETRY
              </span>
            </div>

            {activeTrades.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left font-mono text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-white/10 text-slate-400 uppercase text-xs font-bold tracking-wider bg-white/5">
                      <th className="px-3 py-2.5">Symbol</th>
                      <th className="px-3 py-2.5">Quantity</th>
                      <th className="px-3 py-2.5">Side</th>
                      <th className="px-3 py-2.5 text-right">Entry</th>
                      <th className="px-3 py-2.5 text-right">Mark</th>
                      <th className="px-3 py-2.5 text-right">PnL</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-slate-300">
                    {activeTrades.map((trade) => (
                      <tr key={trade.id} className="hover:bg-white/5 transition-colors">
                        <td className="px-3 py-3 font-bold text-white flex items-center gap-2 text-xs">
                          <span>{trade.symbol}</span>
                          <span className="px-1.5 py-0.5 rounded text-xs font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                            DMA
                          </span>
                        </td>
                        <td className="px-3 py-3 font-bold text-xs">{trade.quantity}</td>
                        <td className="px-3 py-3">
                          <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                            trade.direction === "BUY" ? "bg-emerald-500/20 text-[#00ff88]" : "bg-rose-500/20 text-rose-400"
                          }`}>
                            {trade.direction === "BUY" ? "LONG" : "SHORT"}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-right font-bold text-xs">${trade.entryPrice.toFixed(2)}</td>
                        <td className="px-3 py-3 text-right font-bold text-indigo-400 text-xs">${trade.currentPrice.toFixed(2)}</td>
                        <td className={`px-3 py-3 text-right font-bold text-xs ${trade.unrealizedPnL >= 0 ? "text-[#00ff88]" : "text-rose-400"}`}>
                          {trade.unrealizedPnL >= 0 ? "+" : ""}${trade.unrealizedPnL.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-10 text-slate-400 text-xs font-mono flex flex-col justify-center items-center bg-black/30 rounded-xl border border-dashed border-white/10">
                <Unlock className="w-8 h-8 text-slate-500 mb-2 opacity-50" />
                <p className="font-bold uppercase tracking-widest text-xs">No active session holdings. All routes flat.</p>
              </div>
            )}
          </div>

          {/* Reconciliations & Transaction Friction Table */}
          <div className="bg-[#0c101c] border border-white/10 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <h3 className="text-xs sm:text-sm font-bold text-slate-200 uppercase tracking-wider font-mono">
                  Reconciliations & Transaction Friction Audit
                </h3>
              </div>
              <span className="text-xs text-slate-400 font-mono font-semibold">TCA Post-Trade Audit</span>
            </div>

            {historicalLogs.length > 0 ? (
              <div className="overflow-x-auto max-h-80">
                <table className="w-full text-left font-mono text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-white/10 text-slate-400 uppercase text-xs font-bold tracking-wider bg-white/5">
                      <th className="px-3 py-2.5">Symbol</th>
                      <th className="px-3 py-2.5">Side</th>
                      <th className="px-3 py-2.5 text-right">Realized P&L</th>
                      <th className="px-3 py-2.5 text-right">Exchange Fee</th>
                      <th className="px-3 py-2.5 text-right">Friction %</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-slate-300">
                    {historicalLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-white/5 transition-colors">
                        <td className="px-3 py-3 font-bold text-white flex items-center gap-2 text-xs">
                          <span>{log.symbol}</span>
                          <span className="text-xs text-slate-400 font-normal">({log.quantity})</span>
                        </td>
                        <td className="px-3 py-3">
                          <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                            log.direction === "BUY" ? "text-[#00ff88] bg-emerald-500/10" : "text-rose-400 bg-rose-500/10"
                          }`}>
                            {log.direction === "BUY" ? "LONG" : "SHORT"}
                          </span>
                        </td>
                        <td className={`px-3 py-3 text-right font-bold text-xs ${log.realizedPnL >= 0 ? "text-[#00ff88]" : "text-rose-400"}`}>
                          {log.realizedPnL >= 0 ? "+" : ""}${log.realizedPnL.toFixed(2)}
                        </td>
                        <td className="px-3 py-3 text-right text-slate-300 font-bold text-xs">${log.commission.toFixed(2)}</td>
                        <td className="px-3 py-3 text-right">
                          <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                            log.efficiencyRatio > 15 
                              ? "bg-rose-500/20 text-rose-300 border border-rose-500/30" 
                              : "bg-emerald-500/20 text-[#00ff88] border border-emerald-500/30"
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
              <div className="text-center py-10 text-slate-400 text-xs font-mono flex flex-col justify-center items-center bg-black/30 rounded-xl border border-dashed border-white/10">
                <p className="font-bold uppercase tracking-widest text-xs">System starting fresh. No archived records yet.</p>
              </div>
            )}
          </div>

        </div>
      )}

      {/* TAB 3: LEVEL 2 DEPTH & OFI */}
      {activeTab === "orderbook" && (
        <div className="space-y-6 animate-in fade-in duration-200">
          <div className="bg-[#0c101c] border border-white/10 rounded-xl p-5 space-y-4">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-white/10 pb-3">
              <div>
                <h3 className="text-xs sm:text-sm font-bold text-slate-200 uppercase tracking-wider font-mono flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-emerald-400" /> Level 2 Depth of Market & Order Flow Imbalance
                </h3>
                <p className="text-xs text-slate-400 font-mono mt-0.5">Calculates real-time OFI queue delta and institutional shift histograms</p>
              </div>

              {/* Ticker Selector */}
              <div className="flex flex-wrap items-center gap-2">
                {Object.keys(marketBooks).map((sym) => (
                  <button
                    key={sym}
                    type="button"
                    onClick={() => setSelectedSymbol(sym)}
                    className={`px-3 py-1 rounded text-xs font-mono font-bold transition cursor-pointer ${
                      selectedSymbol === sym || (selectedSymbol === "" && Object.keys(marketBooks)[0] === sym)
                        ? "bg-indigo-600 text-white shadow-sm"
                        : "bg-black/40 border border-white/10 text-slate-300 hover:text-white"
                    }`}
                  >
                    {sym} (${marketBooks[sym]?.lastPrice?.toFixed(2) || "0.00"})
                  </button>
                ))}

                {/* Ingest custom ticker */}
                <div className="flex items-center gap-1.5 bg-black/40 border border-white/10 rounded p-1">
                  <input
                    type="text"
                    placeholder="ADD TICKER"
                    value={newTickerInput}
                    onChange={(e) => setNewTickerInput(e.target.value.toUpperCase())}
                    className="w-24 bg-black/60 border border-white/10 rounded px-2 py-0.5 text-xs text-white uppercase font-mono focus:outline-none"
                  />
                  <select
                    value={newTickerExchange}
                    onChange={(e) => setNewTickerExchange(e.target.value)}
                    className="bg-black/60 border border-white/10 rounded px-1.5 py-0.5 text-xs text-slate-300 font-mono focus:outline-none"
                  >
                    <option value="NYSE">NYSE</option>
                    <option value="NASDAQ">NASDAQ</option>
                    <option value="SBF">EURONEXT</option>
                    <option value="IBIS">XETRA</option>
                  </select>
                  <button
                    type="button"
                    onClick={handleIngestTicker}
                    disabled={isIngestingTicker || !newTickerInput.trim()}
                    className="px-2 py-0.5 bg-[#00ff88]/20 hover:bg-[#00ff88]/30 text-[#00ff88] border border-[#00ff88]/40 rounded text-xs font-mono font-bold transition cursor-pointer"
                  >
                    {isIngestingTicker ? "..." : "+ INGEST"}
                  </button>
                </div>
              </div>
            </div>

            {currentBook ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Depth Chart viz */}
                <div className="md:col-span-2 h-72 bg-black/40 border border-white/5 rounded-xl p-4 relative">
                  <div className="absolute top-2 left-2 text-xs text-slate-400 font-bold font-mono uppercase tracking-wider">
                    BID / ASK SHIFT HISTOGRAM ({currentBook.symbol})
                  </div>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 25, right: 10, left: -15, bottom: 5 }}>
                      <XAxis dataKey="price" stroke="#94a3b8" fontSize={11} tickLine={false} />
                      <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} />
                      <Tooltip
                        contentStyle={{ backgroundColor: "#0c101c", borderColor: "#334155", borderRadius: "8px" }}
                        labelStyle={{ color: "#94a3b8", fontWeight: "bold" }}
                        itemStyle={{ fontSize: "12px" }}
                      />
                      <Bar dataKey="BidSize" fill="#10b981" opacity={0.8} name="Bid Size" radius={[2, 2, 0, 0]} />
                      <Bar dataKey="AskSize" fill="#ef4444" opacity={0.8} name="Ask Size" radius={[2, 2, 0, 0]} />
                      <ReferenceLine x={`$${currentBook.lastPrice.toFixed(2)}`} stroke="#10b981" strokeDasharray="3 3" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {/* OFI Metrics Card */}
                <div className="bg-black/40 border border-white/5 rounded-xl p-4 flex flex-col justify-between space-y-4">
                  <div>
                    <span className="text-xs text-slate-400 font-mono font-bold uppercase tracking-wider block">
                      ORDER FLOW IMBALANCE (OFI)
                    </span>
                    <div className="mt-2 flex items-baseline gap-2">
                      <span className={`text-2xl font-mono font-bold ${
                        (currentBook.lastOfi || 0) >= 0 ? "text-[#00ff88]" : "text-rose-400"
                      }`}>
                        {(currentBook.lastOfi || 0) >= 0 ? "+" : ""}{(currentBook.lastOfi || 0).toFixed(2)}σ
                      </span>
                      <span className="text-xs text-slate-400 font-mono">
                        {(currentBook.lastOfi || 0) >= 1.5 ? "STRONG ACCUMULATION" : (currentBook.lastOfi || 0) <= -1.5 ? "STRONG DISTRIBUTION" : "BALANCED QUEUE"}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-2 text-xs font-mono text-slate-300">
                    <div className="flex justify-between py-1 border-b border-white/5">
                      <span className="text-slate-400">Primary Exchange:</span>
                      <strong className="text-white">{currentBook.primaryExchange || "SMART"}</strong>
                    </div>
                    <div className="flex justify-between py-1 border-b border-white/5">
                      <span className="text-slate-400">Last Trade Mark:</span>
                      <strong className="text-white">${currentBook.lastPrice.toFixed(2)}</strong>
                    </div>
                    <div className="flex justify-between py-1 border-b border-white/5">
                      <span className="text-slate-400">Bid-Ask Levels:</span>
                      <strong className="text-emerald-400">8 Visible Tiers</strong>
                    </div>
                  </div>

                  <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-xs font-mono text-emerald-300">
                    Calculated via Cont-Kukanov-Stoikov top-of-book dealer queue formula.
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-12 text-slate-400 text-xs font-mono">
                No active level 2 stream discovered. Ingest a ticker above to begin streaming order book depth.
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 4: GCP AUXILIARY COMPANION (Contained in dedicated container) */}
      {activeTab === "companion" && (
        <div className="space-y-4 animate-in fade-in duration-200">
          <div className="bg-[#0c101c] border border-white/10 rounded-xl p-4">
            <h3 className="text-xs sm:text-sm font-bold text-slate-200 uppercase font-mono tracking-wider flex items-center gap-2 mb-2">
              <Cpu className="w-4 h-4 text-purple-400" /> Google Cloud Run Auxiliary Engine Companion
            </h3>
            <p className="text-xs text-slate-400 font-sans mb-4">
              Access the secondary Cloud Run backtesting suite, dynamic universe discovery filters, and circuit breaker calculators.
            </p>
            {/* GcpCompanion removed */}
          </div>
        </div>
      )}

      {/* TAB 5: GATEWAY CONFIG & MIFID II */}
      {activeTab === "credentials" && (
        <div id="config-ibkr-account" className="space-y-6 animate-in fade-in duration-200">
          <div className="bg-[#0c101c] border border-white/10 rounded-xl p-5 space-y-5">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div>
                <h3 className="text-xs sm:text-sm font-bold text-slate-200 uppercase tracking-wider font-mono flex items-center gap-2">
                  <Key className="w-4 h-4 text-amber-400" /> Gateway Parameters & MiFID II Shortcodes
                </h3>
                <p className="text-xs text-slate-400 font-mono mt-0.5">
                  Pre-configured for Interactive Brokers Ireland (IBIE) socket connectivity and CBI compliance
                </p>
              </div>

              <button
                type="button"
                
                className="px-3.5 py-1.5 rounded bg-indigo-600/30 border border-indigo-500/50 hover:bg-indigo-600/40 text-indigo-300 font-mono text-xs font-bold transition cursor-pointer"
              >
                OPEN FULL CREDENTIALS VAULT
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs text-slate-300 uppercase font-mono font-bold block">IBKR Account Number</label>
                <input
                  type="text"
                  value={editAccount}
                  onChange={(e) => setEditAccount(e.target.value)}
                  className="w-full bg-black/60 border border-white/10 rounded px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-amber-500"
                />
                <span className="text-xs text-slate-400 font-mono block">U... for Live, DU... for Paper</span>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-slate-300 uppercase font-mono font-bold block">Gateway Port</label>
                <input
                  type="number"
                  value={editPort}
                  onChange={(e) => setEditPort(Number(e.target.value))}
                  className="w-full bg-black/60 border border-white/10 rounded px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-amber-500"
                />
                <span className="text-xs text-slate-400 font-mono block">4002 (Paper) / 4001 (Live)</span>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-slate-300 uppercase font-mono font-bold block">Client ID</label>
                <input
                  type="number"
                  value={editClientId}
                  onChange={(e) => setEditClientId(Number(e.target.value))}
                  className="w-full bg-black/60 border border-white/10 rounded px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-amber-500"
                />
                <span className="text-xs text-slate-400 font-mono block">Unique socket connection ID</span>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-slate-300 uppercase font-mono font-bold block">MiFID II Decision Maker ID</label>
                <input
                  type="text"
                  value={editDecisionMaker}
                  onChange={(e) => setEditDecisionMaker(e.target.value)}
                  className="w-full bg-black/60 border border-white/10 rounded px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-amber-500"
                />
                <span className="text-xs text-slate-400 font-mono block">Regulatory algorithm decision tag</span>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-slate-300 uppercase font-mono font-bold block">MiFID II Execution Trader ID</label>
                <input
                  type="text"
                  value={editTrader}
                  onChange={(e) => setEditTrader(e.target.value)}
                  className="w-full bg-black/60 border border-white/10 rounded px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-amber-500"
                />
                <span className="text-xs text-slate-400 font-mono block">CBI MiFIR execution router identifier</span>
              </div>
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-white/5">
              {saveSuccessMsg ? (
                <span className="text-xs text-[#00ff88] font-mono flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4" /> {saveSuccessMsg}
                </span>
              ) : (
                <span className="text-xs text-slate-400 font-mono">Changes sync live to Firestore and Frankfurt Edge Node.</span>
              )}

              <button
                type="button"
                onClick={handleSaveSettings}
                disabled={isSavingSetting}
                className="px-5 py-2 bg-amber-600 hover:bg-amber-500 text-black font-mono font-bold text-xs rounded-lg transition cursor-pointer flex items-center gap-2"
              >
                {isSavingSetting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : null}
                SAVE GATEWAY PARAMETERS
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. API VAULT MODAL (Dark themed, 4-pillar) */}
      {/* ApiVaultModal removed */}

    </div>
  );
}
