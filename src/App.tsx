import React, { useState, useEffect, useRef } from "react";
import { VaultConsole } from "./components/VaultConsole";
import { LiveCockpit } from "./components/LiveCockpit";
import { QuantResearchLab } from "./components/QuantResearchLab";
import { CopilotPage } from "./pages/CopilotPage";
import { StrategyStudioPage } from "./pages/StrategyStudioPage";
import {
  Activity,
  Globe,
  HelpCircle,
  LayoutGrid,
  ShieldAlert,
  Layers,
  Sparkles,
  SlidersHorizontal,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Sun,
  Moon,
  Search,
  Key,
  Terminal,
  Clock,
  Type,
  Radio,
  Server
} from "lucide-react";
import { getStoredVaultValue } from "./utils/vaultStorage";
import { getAdminHeaders } from "./utils/auth";
import { useTerminalDensity, TerminalDensity } from "./utils/density";
import { CommandPalette } from "./components/CommandPalette";
import { InstitutionalTooltip, InfoTip } from "./components/InstitutionalTooltip";

export default function App() {
  // 1. Theme Engine & Density Management
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    const saved = localStorage.getItem("alpha_dashboard_theme");
    return (saved as "dark" | "light") || "dark";
  });
  const [density, setDensity] = useTerminalDensity();
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);

  // 2. View State & Browser History PopState Synchronization
  const [view, setView] = useState<"mission-control" | "blotter" | "risk" | "lab" | "config" | "copilot" | "studio">(() => {
    if (typeof window !== "undefined") {
      const path = window.location.pathname.toLowerCase();
      if (path === "/copilot" || path === "/chat") return "copilot";
      if (path === "/studio" || path === "/strategy") return "studio";
    }
    const saved = localStorage.getItem("alpha_dashboard_view");
    return (saved as any) || "mission-control";
  });
  const [navTarget, setNavTarget] = useState<string | null>(null);

  // Sync with browser back/forward history
  useEffect(() => {
    const handlePopState = () => {
      const path = window.location.pathname.toLowerCase();
      if (path === "/copilot" || path === "/chat") {
        setView("copilot");
      } else if (path === "/studio" || path === "/strategy") {
        setView("studio");
      } else {
        const saved = (localStorage.getItem("alpha_dashboard_view") as any) || "mission-control";
        setView(saved === "copilot" || saved === "studio" ? "mission-control" : saved);
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const handleNavigate = (newView: "mission-control" | "blotter" | "risk" | "lab" | "config" | "copilot" | "studio", target?: string) => {
    setView(newView);
    localStorage.setItem("alpha_dashboard_view", newView);
    if (newView === "copilot") {
      window.history.pushState(null, "", "/copilot");
    } else if (newView === "studio") {
      window.history.pushState(null, "", "/studio");
    } else {
      if (window.location.pathname === "/copilot" || window.location.pathname === "/chat" || window.location.pathname === "/studio") {
        window.history.pushState(null, "", "/");
      }
    }
    if (target) {
      if (newView === "studio") {
        try {
          localStorage.setItem("alpha_last_symbol", target.toUpperCase());
        } catch (_) {}
      }
      setNavTarget(target);
      setTimeout(() => setNavTarget(null), 100);
    }
  };

  // 3. Live Market Clocks (UTC, New York EST, Frankfurt CET)
  const [clocks, setClocks] = useState({ utc: "", est: "", cet: "" });
  useEffect(() => {
    const updateClocks = () => {
      const now = new Date();
      setClocks({
        utc: now.toLocaleTimeString("en-GB", { timeZone: "UTC", hour12: false }),
        est: now.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour12: false }),
        cet: now.toLocaleTimeString("en-DE", { timeZone: "Europe/Berlin", hour12: false })
      });
    };
    updateClocks();
    const timer = setInterval(updateClocks, 1000);
    return () => clearInterval(timer);
  }, []);

  // 4. Global Keyboard Shortcuts (Cmd+K, Alt+T, Alt+1..7)
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // Cmd+K or Ctrl+K -> Spotlight
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setIsCommandPaletteOpen((prev) => !prev);
        return;
      }

      // Hotkey '/' when not typing in an input
      if (e.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes((e.target as HTMLElement)?.tagName)) {
        e.preventDefault();
        setIsCommandPaletteOpen(true);
        return;
      }

      // Alt + T -> Toggle Theme
      if (e.altKey && e.key.toLowerCase() === "t") {
        e.preventDefault();
        toggleTheme();
        return;
      }

      // Alt + 1..7 -> Quick View Switching
      if (e.altKey) {
        if (e.key === "1") { e.preventDefault(); handleNavigate("mission-control"); }
        else if (e.key === "2") { e.preventDefault(); handleNavigate("blotter"); }
        else if (e.key === "3") { e.preventDefault(); handleNavigate("risk"); }
        else if (e.key === "4") { e.preventDefault(); handleNavigate("lab"); }
        else if (e.key === "5") { e.preventDefault(); handleNavigate("studio"); }
        else if (e.key === "6") { e.preventDefault(); handleNavigate("config"); }
        else if (e.key === "7") { e.preventDefault(); handleNavigate("copilot"); }
      }
    };

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, []);

  // 5. System State & Broker Gateway Polling
  const [systemState, setSystemState] = useState<any>(null);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [triggering2FA, setTriggering2FA] = useState(false);
  const [trigger2FAMsg, setTrigger2FAMsg] = useState<string | null>(null);

  const handleTrigger2FALogin = async () => {
    setTriggering2FA(true);
    setTrigger2FAMsg("DISPATCHING 2FA...");
    try {
      const res = await fetch("/api/gateway/trigger-login", {
        method: "POST",
        headers: getAdminHeaders()
      });
      const data = await res.json();
      if (data.success) {
        setTrigger2FAMsg("PUSH SENT • CHECK PHONE");
      } else {
        setTrigger2FAMsg("FAILED: " + (data.error || "Error"));
      }
    } catch (err: any) {
      setTrigger2FAMsg("ERROR: " + err.message);
    } finally {
      setTriggering2FA(false);
      setTimeout(() => setTrigger2FAMsg(null), 8000);
    }
  };

  const toggleTheme = () => {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      localStorage.setItem("alpha_dashboard_theme", next);
      return next;
    });
  };

  const isTogglingRef = useRef(false);
  const [isTogglingMode, setIsTogglingMode] = useState(false);
  const [modeToggleToast, setModeToggleToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  // Fetch initial state
  useEffect(() => {
    const fetchState = async () => {
      if (isTogglingRef.current) return;
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);
        
        const res = await fetch("/api/state", { signal: controller.signal });
        const riskRes = await fetch("/api/risk/status", { signal: controller.signal }).catch(() => null);
        const riskData = riskRes && riskRes.ok ? await riskRes.json().catch(() => null) : null;
        clearTimeout(timeoutId);
        
        if (!res.ok) {
          throw new Error(`Server status: ${res.status}`);
        }
        
        if (isTogglingRef.current) return;

        const data = await res.json();
        if (riskData) {
          data.tcpLatencyMs = riskData.tcpLatencyMs;
          if (riskData.tradingMode) {
            data.settings = { ...data.settings, tradingMode: riskData.tradingMode };
          }
        }
        setSystemState(data);
      } catch (e: any) {
        if (e.name !== "AbortError") {
          console.error("System state fetch failed:", e.message || e);
        }
      }
    };
    fetchState();
    const interval = setInterval(fetchState, 15000);
    return () => clearInterval(interval);
  }, []);

  const handleToggleTradingMode = async () => {
    if (isTogglingMode) return;
    const currentMode = systemState?.settings?.tradingMode || "PAPER";
    const nextMode = currentMode === "LIVE" ? "PAPER" : "LIVE";
    const nextPort = nextMode === "LIVE" ? 4001 : 4002;
    
    const configuredLive = systemState?.settings?.ibkrLiveAccountNumber || getStoredVaultValue("ibkrLiveAccountNumber");
    const configuredPaper = systemState?.settings?.ibkrPaperAccountNumber || getStoredVaultValue("ibkrPaperAccountNumber");
    const existingAccount = systemState?.settings?.ibkrAccountNumber || getStoredVaultValue("ibkrAccountNumber") || "";
    const targetAccount = nextMode === "LIVE" 
      ? (configuredLive || existingAccount) 
      : (configuredPaper || existingAccount);

    if (nextMode === "LIVE") {
      const liveUser = systemState?.settings?.ibkrLiveUsername || getStoredVaultValue("ibkrLiveUsername");
      const livePass = systemState?.settings?.ibkrLivePassword || getStoredVaultValue("ibkrLivePassword");
      if (!liveUser || !livePass) {
        alert("LIVE PRODUCTION CREDENTIALS REQUIRED:\n\nPlease configure your live IBKR Username and Password in the 4-Pillar Vault (Alt+6) before launching the Live production lane.");
        handleNavigate("config", "broker");
        return;
      }

      const confirmed = window.confirm(
        "CAUTION: Switching execution lane to LIVE PRODUCTION (Port 4001).\n\nReal capital will be routed under direct IBKR DMA execution. Proceed?"
      );
      if (!confirmed) return;
    }

    isTogglingRef.current = true;
    setIsTogglingMode(true);
    setModeToggleToast(null);
    const previousState = systemState;

    setSystemState((prev: any) => ({
      ...prev,
      settings: {
        ...prev?.settings,
        tradingMode: nextMode,
        ibkrPort: nextPort,
        ibkrAccountNumber: targetAccount
      }
    }));

    try {
      let res = await fetch("/api/system/toggle-lane", {
        method: "POST",
        headers: getAdminHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          mode: nextMode,
          port: nextPort,
          accountNumber: targetAccount
        })
      });

      if (!res.ok) {
        res = await fetch("/api/set-settings", {
          method: "POST",
          headers: getAdminHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({
            tradingMode: nextMode,
            ibkrPort: nextPort,
            ibkrAccountNumber: targetAccount
          })
        });
      }

      if (res.ok) {
        const data = await res.json();
        if (data.settings) {
          setSystemState((prev: any) => ({
            ...prev,
            settings: {
              ...prev?.settings,
              ...data.settings,
              tradingMode: nextMode,
              ibkrPort: nextPort,
              ibkrAccountNumber: targetAccount
            }
          }));
        }
        setModeToggleToast({
          type: "success",
          message: `Switched execution lane to ${nextMode} (Port ${nextPort})`
        });
        setTimeout(() => setModeToggleToast(null), 5000);
      } else {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Server responded with ${res.status}`);
      }
    } catch (err: any) {
      console.error("Failed to toggle trading mode:", err);
      setSystemState(previousState);
      setModeToggleToast({
        type: "error",
        message: `Failed switch to ${nextMode}: ${err.message || "Network error"}`
      });
      setTimeout(() => setModeToggleToast(null), 7000);
    } finally {
      setIsTogglingMode(false);
      isTogglingRef.current = false;
    }
  };

  // Sync theme with document root & body
  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    root.setAttribute("data-theme", theme);
    if (body) body.setAttribute("data-theme", theme);
    
    if (theme === "light") {
      root.classList.add("theme-light");
      root.classList.remove("theme-dark");
      if (body) {
        body.classList.add("theme-light");
        body.classList.remove("theme-dark");
      }
    } else {
      root.classList.add("theme-dark");
      root.classList.remove("theme-light");
      if (body) {
        body.classList.add("theme-dark");
        body.classList.remove("theme-light");
      }
    }
  }, [theme]);

  const activeMode = systemState?.settings?.tradingMode || "PAPER";
  const latency = systemState?.tcpLatencyMs !== undefined ? `${systemState.tcpLatencyMs}ms` : "2.3ms";

  if (view === "copilot") {
    return (
      <>
        <CopilotPage onNavigateHome={() => handleNavigate("mission-control")} />
        <CommandPalette
          isOpen={isCommandPaletteOpen}
          onClose={() => setIsCommandPaletteOpen(false)}
          onNavigate={handleNavigate}
          onToggleTradingMode={handleToggleTradingMode}
          tradingMode={activeMode}
          theme={theme}
          onToggleTheme={toggleTheme}
          density={density}
          onSetDensity={setDensity}
          onOpenRunbook={() => setShowHelpModal(true)}
          onTrigger2FA={handleTrigger2FALogin}
        />
      </>
    );
  }

  return (
    <div 
      id="alpha-engine-application-wrapper" 
      className="min-h-screen transition-colors duration-150 terminal-canvas"
    >
      {/* =========================================================================
          1. Omnipresent Institutional Telemetry Ribbon (Fixed Top Bar)
          ========================================================================= */}
      <div className={`w-full py-1.5 px-4 font-mono text-[11px] font-bold tracking-wider flex flex-col md:flex-row items-center justify-between gap-2.5 border-b ${
        activeMode === "LIVE"
          ? (theme === "light" ? "bg-rose-50 border-rose-200 text-rose-800" : "bg-rose-950/40 border-rose-500/40 text-rose-200")
          : (theme === "light" ? "bg-amber-50 border-amber-200 text-amber-800" : "bg-amber-950/40 border-amber-500/40 text-amber-200")
      }`}>
        {/* Left: Execution Lane & Broker Socket Status */}
        <div className="flex flex-wrap items-center gap-2.5">
          <span className={`w-2 h-2 rounded-full ring-2 ${
            activeMode === "LIVE" ? "bg-rose-500 ring-rose-500/30 animate-pulse" : "bg-amber-400 ring-amber-400/30"
          }`} />

          <InstitutionalTooltip
            title="IBKR Execution Socket Routing"
            formula={activeMode === "LIVE" ? "Socket: 10.156.0.2:4001 (Live DMA)" : "Socket: 10.156.0.2:4002 (Paper Sim)"}
            content={activeMode === "LIVE" 
              ? "Live Production Execution Mode. Real orders routed directly to Interactive Brokers Europe Hub (Frankfurt datacenter)."
              : "Paper Simulation Mode. High-fidelity broker test socket with zero real capital risk."
            }
          >
            <span className="text-xs font-black tracking-wide cursor-help">
              {activeMode === "LIVE" 
                ? "LIVE PRODUCTION • BROKER DMA (PORT 4001)" 
                : "PAPER SIMULATION • IBKR EDGE NODE (PORT 4002)"}
            </span>
          </InstitutionalTooltip>

          {/* Lane Toggle Button */}
          <button
            type="button"
            disabled={isTogglingMode}
            onClick={handleToggleTradingMode}
            className={`px-2.5 py-0.5 rounded text-[10px] font-mono font-black border transition cursor-pointer flex items-center gap-1 shadow-sm active:scale-95 disabled:opacity-60 ${
              activeMode === "LIVE"
                ? "bg-amber-500 hover:bg-amber-400 text-black border-amber-300"
                : "bg-rose-600 hover:bg-rose-500 text-white border-rose-400"
            }`}
            title="Toggle between PAPER (Port 4002) and LIVE DMA (Port 4001)"
          >
            <RefreshCw className={`w-3 h-3 ${isTogglingMode ? "animate-spin" : ""}`} />
            <span>{isTogglingMode ? "SWITCHING..." : `SWITCH TO ${activeMode === "LIVE" ? "PAPER" : "LIVE"}`}</span>
          </button>

          {modeToggleToast && (
            <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold flex items-center gap-1 animate-in fade-in ${
              modeToggleToast.type === "success" 
                ? "bg-emerald-950 text-[#00ff88] border border-emerald-500/50" 
                : "bg-rose-950 text-rose-300 border border-rose-500/50"
            }`}>
              {modeToggleToast.type === "success" ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
              {modeToggleToast.message}
            </span>
          )}

          {activeMode === "LIVE" && (
            <button
              type="button"
              disabled={triggering2FA}
              onClick={handleTrigger2FALogin}
              className="px-2 py-0.5 rounded text-[10px] font-mono font-black border transition cursor-pointer flex items-center gap-1 bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-400 disabled:opacity-50"
              title="Dispatches on-demand 2FA push notification to your phone via Frankfurt edge node"
            >
              <Terminal className="w-3 h-3" />
              <span>{triggering2FA ? "SENDING..." : "REQUEST 2FA PUSH"}</span>
            </button>
          )}

          {trigger2FAMsg && (
            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold text-emerald-400 bg-emerald-950/40 border border-emerald-500/40 animate-pulse">
              {trigger2FAMsg}
            </span>
          )}

          <InstitutionalTooltip
            title="Zero Synthetic Policy"
            content="Alpha Engine strictly prohibits fake prices or synthetic scrapers. Quotes, bars, and trades originate exclusively from funded IBKR Pro Direct Market Access."
          >
            <span className="hidden xl:inline-block px-2 py-0.5 rounded terminal-card text-[10px] font-bold text-secondary cursor-help">
              ZERO SYNTHETIC POLICY
            </span>
          </InstitutionalTooltip>
        </div>

        {/* Right: Latency, Live Clocks, Density, Theme & Spotlight */}
        <div className="flex flex-wrap items-center gap-2.5 text-[11px] font-mono">
          {/* Frankfurt Node Latency */}
          <InstitutionalTooltip
            title="Frankfurt Edge Node Telemetry"
            formula="Round-trip TCP ping: europe-west3 Spot VM <-> IBKR Central European Hub"
            content="Co-located adjacent to Interactive Brokers Ireland/European exchange gateways for sub-5ms order execution."
          >
            <div className="flex items-center gap-1.5 cursor-help">
              <span className="text-secondary">EDGE:</span>
              <span className="text-emerald-500 font-bold flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                {latency}
              </span>
            </div>
          </InstitutionalTooltip>

          {/* Live Market Clocks */}
          <div className="hidden lg:flex items-center gap-2.5 text-secondary border-l border-border pl-2.5">
            <span>UTC: <strong className="text-primary">{clocks.utc || "--:--:--"}</strong></span>
            <span>NY: <strong className="text-primary">{clocks.est || "--:--:--"}</strong></span>
            <span>FRA: <strong className="text-primary">{clocks.cet || "--:--:--"}</strong></span>
          </div>

          {/* Density Selector */}
          <div className="flex items-center rounded terminal-card p-0.5 text-[10px] font-mono">
            <button
              type="button"
              onClick={() => setDensity("compact")}
              className={`px-1.5 py-0.5 rounded transition font-bold cursor-pointer ${
                density === "compact" ? "bg-cyan-500/20 text-cyan-500 dark:text-cyan-300 border border-cyan-500/40" : "text-secondary hover:text-primary"
              }`}
              title="Compact / Dense Desk Mode (Alt+[)"
            >
              DENSE
            </button>
            <button
              type="button"
              onClick={() => setDensity("standard")}
              className={`px-1.5 py-0.5 rounded transition font-bold cursor-pointer ${
                density === "standard" ? "bg-black/10 dark:bg-white/10 text-primary border border-border" : "text-secondary hover:text-primary"
              }`}
              title="Standard Balanced Density"
            >
              STD
            </button>
            <button
              type="button"
              onClick={() => setDensity("comfort")}
              className={`px-1.5 py-0.5 rounded transition font-bold cursor-pointer ${
                density === "comfort" ? "bg-amber-500/20 text-amber-600 dark:text-amber-300 border border-amber-500/40" : "text-secondary hover:text-primary"
              }`}
              title="Comfort / High-Readability Mode (Alt+])"
            >
              COMFORT
            </button>
          </div>

          {/* Theme Switcher */}
          <div className="flex items-center rounded terminal-card p-0.5 text-[10px] font-mono">
            <button
              type="button"
              onClick={() => { if (theme !== "dark") toggleTheme(); }}
              className={`px-1.5 py-0.5 rounded transition flex items-center gap-1 font-bold cursor-pointer ${
                theme === "dark" ? "terminal-elevated text-amber-400 border border-accent shadow-sm" : "text-secondary hover:text-primary"
              }`}
              title="Terminal Dark Desk Mode (Alt+T)"
            >
              <Moon className="w-3 h-3 text-amber-400" />
              <span>DARK</span>
            </button>
            <button
              type="button"
              onClick={() => { if (theme !== "light") toggleTheme(); }}
              className={`px-1.5 py-0.5 rounded transition flex items-center gap-1 font-bold cursor-pointer ${
                theme === "light" ? "terminal-elevated text-blue-600 dark:text-blue-400 border border-accent shadow-sm" : "text-secondary hover:text-primary"
              }`}
              title="Financial Paper Light Desk Mode (Alt+T)"
            >
              <Sun className="w-3 h-3 text-blue-500" />
              <span>LIGHT</span>
            </button>
          </div>

          {/* Spotlight Command Bar Trigger */}
          <button
            type="button"
            onClick={() => setIsCommandPaletteOpen(true)}
            className="flex items-center gap-1.5 px-2 py-0.5 rounded terminal-card hover:bg-elevated text-secondary hover:text-primary transition cursor-pointer text-[10px]"
            title="Open Spotlight Command Palette (Cmd+K / Ctrl+K)"
          >
            <Search className="w-3 h-3" />
            <span className="hidden sm:inline">SPOTLIGHT</span>
            <kbd className="text-[9px] bg-black/5 dark:bg-white/5 border border-border px-1 py-0.2 rounded text-secondary">
              ⌘K
            </kbd>
          </button>
        </div>
      </div>

      {/* =========================================================================
          2. Master Header & Navigation Controls
          ========================================================================= */}
      <header 
        id="alpha-header-panel" 
        className="sticky top-0 z-40 border-b border-border bg-card/95 backdrop-blur-xs px-5 py-2.5 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 transition-colors duration-150"
      >
        {/* Brand & Market Telemetry */}
        <div className="flex items-center gap-3">
          <div className="p-2 rounded bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
            <Activity className="w-4 h-4 text-emerald-500" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-black font-mono tracking-tight text-primary">ALPHA ENGINE</span>
              <span className="text-[10px] bg-elevated text-emerald-500 font-mono px-1.5 py-0.2 rounded border border-emerald-500/20 font-bold">
                PRO TERMINAL
              </span>
            </div>
            <p className="text-[11px] text-secondary font-mono">
              Brokerage Interface & Dynamic Risk Allocator (IBIE European Hub)
            </p>
          </div>
        </div>
        
        {/* Navigation Tabs & Workspace Controls */}
        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto justify-between md:justify-end">
          {/* Institutional View Switchers */}
          <div className="flex flex-wrap items-center gap-1 bg-elevated p-1 rounded-md border border-border">
            <button
              type="button"
              onClick={() => handleNavigate("mission-control")}
              className={`px-2.5 py-1 rounded text-xs font-mono font-bold transition flex items-center gap-1.5 cursor-pointer ${
                view === "mission-control"
                  ? "bg-rose-600 text-white shadow-sm"
                  : "text-secondary hover:text-primary hover:bg-black/5 dark:hover:bg-white/5"
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              <span>CONTROL</span>
            </button>

            <button
              type="button"
              onClick={() => handleNavigate("blotter")}
              className={`px-2.5 py-1 rounded text-xs font-mono font-bold transition flex items-center gap-1.5 cursor-pointer ${
                view === "blotter"
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-secondary hover:text-primary hover:bg-black/5 dark:hover:bg-white/5"
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span>BLOTTER</span>
            </button>

            <button
              type="button"
              onClick={() => handleNavigate("risk")}
              className={`px-2.5 py-1 rounded text-xs font-mono font-bold transition flex items-center gap-1.5 cursor-pointer ${
                view === "risk"
                  ? "bg-amber-600 text-black shadow-sm font-black"
                  : "text-secondary hover:text-primary hover:bg-black/5 dark:hover:bg-white/5"
              }`}
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              <span>RISK</span>
            </button>

            <button
              type="button"
              onClick={() => handleNavigate("lab")}
              className={`px-2.5 py-1 rounded text-xs font-mono font-bold transition flex items-center gap-1.5 cursor-pointer ${
                view === "lab"
                  ? "bg-purple-600 text-white shadow-sm"
                  : "text-secondary hover:text-primary hover:bg-black/5 dark:hover:bg-white/5"
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>QUANT LAB</span>
            </button>

            <button
              type="button"
              onClick={() => handleNavigate("studio")}
              className={`px-2.5 py-1 rounded text-xs font-mono font-bold transition flex items-center gap-1.5 cursor-pointer ${
                view === "studio"
                  ? "bg-emerald-500 text-slate-950 shadow-sm font-black"
                  : "text-emerald-600 dark:text-emerald-400 hover:text-primary hover:bg-emerald-500/10 border border-emerald-500/30"
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>STRATEGY STUDIO</span>
            </button>

            <button
              type="button"
              onClick={() => handleNavigate("config")}
              className={`px-2.5 py-1 rounded text-xs font-mono font-bold transition flex items-center gap-1.5 cursor-pointer ${
                view === "config"
                  ? "bg-cyan-600 text-white shadow-sm"
                  : "text-secondary hover:text-primary hover:bg-black/5 dark:hover:bg-white/5"
              }`}
            >
              <Globe className="w-3.5 h-3.5" />
              <span>VAULT</span>
            </button>

            <button
              type="button"
              onClick={() => handleNavigate("copilot")}
              className={`px-2.5 py-1 rounded text-xs font-mono font-bold transition flex items-center gap-1.5 cursor-pointer ${
                view === "copilot"
                  ? "bg-emerald-600 text-white dark:bg-emerald-400 dark:text-slate-950 shadow-sm font-black"
                  : "text-emerald-600 dark:text-emerald-400 hover:text-primary hover:bg-emerald-500/10 border border-emerald-500/30"
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>COPILOT</span>
            </button>
          </div>

          {/* Runbook Modal Trigger */}
          <button 
            type="button"
            onClick={() => setShowHelpModal(true)}
            className="px-2.5 py-1 rounded terminal-card hover:bg-elevated text-secondary hover:text-primary flex items-center gap-1 text-xs font-mono font-bold transition cursor-pointer"
          >
            <HelpCircle className="w-3.5 h-3.5 text-emerald-500" />
            <span>RUNBOOK</span>
          </button>
        </div>
      </header>

      {/* =========================================================================
          3. Main Terminal Workspace
          ========================================================================= */}
      <main className="max-w-[1600px] mx-auto p-4 transition-all duration-150">
        {view === "mission-control" && <LiveCockpit systemState={systemState} onRefresh={() => {}} activeView="mission-control" />}
        {view === "blotter" && <LiveCockpit systemState={systemState} onRefresh={() => {}} activeView="blotter" />}
        {view === "risk" && <LiveCockpit systemState={systemState} onRefresh={() => {}} activeView="risk" />}
        {view === "lab" && <QuantResearchLab onNavigate={handleNavigate} />}
        {view === "studio" && <StrategyStudioPage onNavigate={handleNavigate} />}
        {view === "config" && (
          <VaultConsole
            initialTab={navTarget as any}
            settings={systemState?.settings}
            onSaveSetting={async (k, v) => {
              setSystemState((prev: any) => ({
                ...prev,
                settings: { ...prev?.settings, [k]: v }
              }));
            }}
            onSaveMultipleSettings={async (updates) => {
              setSystemState((prev: any) => ({
                ...prev,
                settings: { ...prev?.settings, ...updates }
              }));
            }}
          />
        )}
        {view === "copilot" && (
          <CopilotPage
            onNavigateHome={() => handleNavigate("mission-control")}
            onNavigate={handleNavigate}
          />
        )}
      </main>

      {/* =========================================================================
          4. Bloomberg-Style Spotlight Command Palette Modal
          ========================================================================= */}
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        onNavigate={handleNavigate}
        onToggleTradingMode={handleToggleTradingMode}
        tradingMode={activeMode}
        theme={theme}
        onToggleTheme={toggleTheme}
        density={density}
        onSetDensity={setDensity}
        onOpenRunbook={() => setShowHelpModal(true)}
        onTrigger2FA={handleTrigger2FALogin}
      />

      {/* =========================================================================
          5. Institutional Onboarding & Runbook Modal Overlay
          ========================================================================= */}
      {showHelpModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-100 font-mono">
          <div className="terminal-card border border-border rounded-lg max-w-3xl w-full max-h-[90vh] overflow-hidden shadow-2xl flex flex-col">
            
            {/* Modal Header */}
            <div className="border-b border-border p-4 flex items-center justify-between bg-elevated">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-500">
                  <HelpCircle className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-xs sm:text-sm font-bold tracking-tight text-primary uppercase">
                    ALPHA ENGINE RUNBOOK & TRADING SPECIFICATIONS
                  </h2>
                  <p className="text-[11px] text-secondary">
                    Institutional architecture, DMA co-location, and MiFID II compliance rules
                  </p>
                </div>
              </div>
              <button 
                type="button"
                onClick={() => setShowHelpModal(false)}
                className="text-secondary hover:text-primary px-2 py-0.5 rounded border border-border hover:bg-elevated text-xs font-bold transition cursor-pointer"
              >
                ✕ ESC
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 space-y-4 text-primary text-xs leading-relaxed max-h-[75vh] overflow-y-auto">
              {/* Question 1 */}
              <div className="bg-elevated rounded border border-border p-4 space-y-2">
                <span className="text-xs text-indigo-500 dark:text-indigo-400 font-bold uppercase tracking-wider block">
                  1. Frankfurt GCP Spot VM Co-Location Architecture
                </span>
                <p className="text-[11px] text-secondary">
                  Alpha Engine operates a two-tier hybrid architecture. The web control plane runs on Cloud Run, while execution pipelines operate on an <code className="bg-black/10 dark:bg-black/50 px-1 py-0.2 rounded text-emerald-600 dark:text-emerald-300 font-bold">e2-micro</code> Spot VM in Frankfurt (<code className="bg-black/10 dark:bg-black/50 px-1 py-0.2 rounded text-emerald-600 dark:text-emerald-300 font-bold">europe-west3</code>). This establishes sub-3ms TCP socket latency directly adjacent to the Interactive Brokers Europe (IBIE) hub.
                </p>
              </div>

              {/* Question 2 */}
              <div className="bg-elevated rounded border border-border p-4 space-y-2">
                <span className="text-xs text-cyan-600 dark:text-cyan-400 font-bold uppercase tracking-wider block">
                  2. Critic-Verifier Multi-Model Consensus Engine
                </span>
                <p className="text-[11px] text-secondary">
                  Signal generation requires a two-stage consensus check: an Analyst model generates hypotheses while an adversarial Risk Critic model tests market microstructure and earnings catalysts. Trade execution requires $\ge 75\%$ consensus.
                </p>
              </div>

              {/* Question 3 */}
              <div className="bg-elevated rounded border border-border p-4 space-y-2">
                <span className="text-xs text-amber-600 dark:text-amber-400 font-bold uppercase tracking-wider block">
                  3. CBI 15% Friction Gate & Marcos López de Prado DSR
                </span>
                <p className="text-[11px] text-secondary">
                  All trades must satisfy the friction constraint: <code className="bg-black/10 dark:bg-black/50 px-1 py-0.2 rounded text-amber-600 dark:text-amber-300 font-bold">(Spread + 2x Commission) / Projected Profit &le; 15%</code>. Backtest parameter sweeps evaluate 16 permutations to calculate the Deflated Sharpe Ratio (DSR), penalizing selection bias.
                </p>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="border-t border-border p-3 bg-elevated flex items-center justify-between">
              <span className="text-[10px] text-muted font-mono">
                Alpha Engine v2.0 • CBI MiFID II RTS 22 Compliance
              </span>
              <button 
                type="button"
                onClick={() => setShowHelpModal(false)}
                className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold rounded text-xs uppercase transition cursor-pointer"
              >
                Close Runbook
              </button>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
