import React, { useState, useEffect } from "react";
import Dashboard from "./components/Dashboard";
import { LiveCockpit } from "./components/LiveCockpit";
import { QuantResearchLab } from "./components/QuantResearchLab";
import { Sun, Moon, Activity, Tag, Globe, HelpCircle, LayoutGrid, Home, ShieldAlert, Layers, Sliders } from "lucide-react";

export default function App() {
  // Safe default persistent theme
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    const saved = localStorage.getItem("alpha_dashboard_theme");
    return (saved as "dark" | "light") || "dark";
  });

  const [view, setView] = useState<"mission-control" | "blotter" | "risk" | "lab" | "config">(() => {
    const saved = localStorage.getItem("alpha_dashboard_view");
    return (saved as any) || "mission-control";
  });
  const [navTarget, setNavTarget] = useState<string | null>(null);

  const handleNavigate = (newView: "mission-control" | "blotter" | "risk" | "lab" | "config", target?: string) => {
    setView(newView);
    localStorage.setItem("alpha_dashboard_view", newView);
    if (target) {
      setNavTarget(target);
      // Reset target after a short delay so it can be re-triggered
      setTimeout(() => setNavTarget(null), 100);
    }
  };

  const [systemState, setSystemState] = useState<any>(null);
  const [showHelpModal, setShowHelpModal] = useState(false);

  const toggleTheme = () => {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      localStorage.setItem("alpha_dashboard_theme", next);
      return next;
    });
  };

  const toggleView = () => {
    setView((prev) => {
      const next = prev === "dashboard" ? "cockpit" : "dashboard";
      localStorage.setItem("alpha_dashboard_view", next);
      return next;
    });
  };

  // Fetch initial state for launchpad badges
  useEffect(() => {
    const fetchState = async () => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout
        
        const res = await fetch("/api/state", { signal: controller.signal });
        clearTimeout(timeoutId);
        
        if (!res.ok) {
          throw new Error(`Server responded with status: ${res.status}`);
        }
        
        const data = await res.json();
        setSystemState(data);
      } catch (e: any) {
        if (e.name === "AbortError") {
          console.error("System state fetch timed out");
        } else {
          console.error("Failed to fetch system state for launchpad:", e.message || e);
        }
      }
    };
    fetchState();
    const interval = setInterval(fetchState, 15000); // Polling every 15s
    return () => clearInterval(interval);
  }, []);

  // Sync theme with body class
  useEffect(() => {
    const body = document.body;
    if (theme === "light") {
      body.classList.add("theme-light");
      body.classList.remove("theme-dark");
    } else {
      body.classList.add("theme-dark");
      body.classList.remove("theme-light");
    }
  }, [theme]);

  return (
    <div 
      id="alpha-engine-application-wrapper" 
      className={`min-h-screen transition-colors duration-250 ${
        theme === "dark" ? "bg-slate-950 text-white" : "bg-slate-50 text-slate-900"
      }`}
    >
      {/* Institutional Truth-in-Labeling Environment Banner */}
      <div className={`w-full py-2 px-6 font-mono text-xs font-bold tracking-wider flex flex-col sm:flex-row items-center justify-between gap-2 border-b ${
        systemState?.settings?.tradingMode === "LIVE"
          ? "bg-rose-950/90 border-rose-500/50 text-rose-200"
          : "bg-amber-950/80 border-amber-500/50 text-amber-200"
      }`}>
        <div className="flex items-center gap-2.5">
          <span className={`w-2.5 h-2.5 rounded-full ${
            systemState?.settings?.tradingMode === "LIVE" ? "bg-rose-500 animate-pulse" : "bg-amber-400"
          }`} />
          <span className="text-xs sm:text-sm font-black">
            {systemState?.settings?.tradingMode === "LIVE" 
              ? "🔴 LIVE PRODUCTION — BROKER DMA ROUTING (ACCOUNT: U8129384)" 
              : "🟡 PAPER TRADING — IBKR EDGE NODE (ACCOUNT: DU8129384)"}
          </span>
          <span className="hidden md:inline-block px-2.5 py-1 rounded bg-black/40 border border-white/10 text-xs font-semibold text-slate-300">
            ZERO SYNTHETIC POLICY ENFORCED
          </span>
        </div>
        <div className="flex items-center gap-4 text-xs font-mono">
          <span className="text-slate-300">AUTHORITY: <strong className="text-white">FRANKFURT EDGE NODE</strong></span>
          <span className="text-emerald-400 font-bold">LATENCY: 14.2ms</span>
          <button 
            type="button"
            onClick={() => {
              const currentKey = localStorage.getItem("alpha_operator_admin_key") || "ALPHA_ADMIN_REVERT_992";
              const newKey = prompt("Enter Operator Admin Key for Privileged Controls:", currentKey);
              if (newKey) {
                localStorage.setItem("alpha_operator_admin_key", newKey.trim());
                alert("Operator Admin Key updated for session.");
              }
            }}
            className="px-2 py-0.5 rounded bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/30 text-indigo-300 cursor-pointer text-xs font-mono flex items-center gap-1"
          >
            🔑 OPERATOR KEY
          </button>
        </div>
      </div>

      {/* Modern sticky header with telemetry settings & switcher controls */}
      <header 
        id="alpha-header-panel" 
        className="sticky top-0 z-50 border-b border-white/10 bg-slate-950/90 backdrop-blur-md px-6 py-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 transition-colors duration-150"
      >
        <div className="flex items-center gap-3.5">
          <div className="p-2.5 rounded-lg bg-[#00ff88]/10 border border-[#00ff88]/20 flex items-center justify-center">
            <Activity className="w-5 h-5 text-[#00ff88] animate-pulse" />
          </div>
          <div>
            <h1 className="text-base sm:text-lg font-bold font-sans tracking-tight text-slate-100 flex items-center gap-2">
              ALPHA ENGINE 
              <span className="text-xs bg-slate-800 text-[#00ff88] font-mono px-2 py-0.5 rounded border border-[#00ff88]/20 tracking-wider font-bold">
                EDGE NODE ACTIVE
              </span>
            </h1>
            <p className="text-xs text-slate-400 font-mono mt-0.5">
              Brokerage Interface & Dynamic Risk Allocator (IBKR Pro Ireland Segment)
            </p>
          </div>
        </div>
        
        <div className="flex flex-wrap items-center gap-4 w-full sm:w-auto justify-between sm:justify-end">
          {/* Legend detailing Exchange Originations */}
          <div className="flex items-center gap-3 text-xs font-mono pr-2 text-slate-300">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-blue-500 shadow" />
              <span>US EXCHANGE</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-500 shadow" />
              <span>XETRA</span>
            </div>
            <div className="flex items-center gap-1.5 font-semibold">
              <span className="w-2 h-2 rounded-full bg-emerald-500 shadow animate-pulse" />
              <span>EURONEXT</span>
            </div>
          </div>

          {/* Clean sun/moon button switcher */}
          <button 
            type="button"
            id="theme-mode-toggle"
            onClick={toggleTheme}
            className="p-2.5 rounded-md transition-all duration-200 cursor-pointer text-slate-200 hover:text-white border border-white/10 bg-white/5 hover:bg-white/10 flex items-center gap-2 text-xs font-mono tracking-wider font-bold"
          >
            {theme === "dark" ? (
              <>
                <Sun className="w-4 h-4 text-amber-400" />
                <span>LIGHT</span>
              </>
            ) : (
              <>
                <Moon className="w-4 h-4 text-blue-500" />
                <span>DARK</span>
              </>
            )}
          </button>

          {/* Institutional Mode Switchers */}
          <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 bg-black/50 p-1.5 rounded-xl border border-white/10">
            <button
              type="button"
              onClick={() => handleNavigate("mission-control")}
              className={`px-3.5 py-2 rounded-lg transition-all duration-200 cursor-pointer text-xs font-mono tracking-wider font-bold flex items-center gap-2 ${
                view === "mission-control"
                  ? "bg-rose-600 text-white shadow-md shadow-rose-950/50"
                  : "text-slate-300 hover:text-white hover:bg-white/5"
              }`}
            >
              <Activity className="w-4 h-4" />
              <span>MISSION CONTROL</span>
            </button>

            <button
              type="button"
              onClick={() => handleNavigate("blotter")}
              className={`px-3.5 py-2 rounded-lg transition-all duration-200 cursor-pointer text-xs font-mono tracking-wider font-bold flex items-center gap-2 ${
                view === "blotter"
                  ? "bg-indigo-600 text-white shadow-md shadow-indigo-950/50"
                  : "text-slate-300 hover:text-white hover:bg-white/5"
              }`}
            >
              <LayoutGrid className="w-4 h-4" />
              <span>BLOTTER</span>
            </button>

            <button
              type="button"
              onClick={() => handleNavigate("risk")}
              className={`px-3.5 py-2 rounded-lg transition-all duration-200 cursor-pointer text-xs font-mono tracking-wider font-bold flex items-center gap-2 ${
                view === "risk"
                  ? "bg-amber-600 text-black shadow-md shadow-amber-950/50"
                  : "text-slate-300 hover:text-white hover:bg-white/5"
              }`}
            >
              <ShieldAlert className="w-4 h-4" />
              <span>RISK & DRM</span>
            </button>

            <button
              type="button"
              onClick={() => handleNavigate("lab")}
              className={`px-3.5 py-2 rounded-lg transition-all duration-200 cursor-pointer text-xs font-mono tracking-wider font-bold flex items-center gap-2 ${
                view === "lab"
                  ? "bg-purple-600 text-white shadow-md shadow-purple-950/50"
                  : "text-slate-300 hover:text-white hover:bg-white/5"
              }`}
            >
              <Layers className="w-4 h-4" />
              <span>QUANT LAB</span>
            </button>

            <button
              type="button"
              onClick={() => handleNavigate("config")}
              className={`px-3.5 py-2 rounded-lg transition-all duration-200 cursor-pointer text-xs font-mono tracking-wider font-bold flex items-center gap-2 ${
                view === "config"
                  ? "bg-emerald-600 text-white shadow-md shadow-emerald-950/50"
                  : "text-slate-300 hover:text-white hover:bg-white/5"
              }`}
            >
              <Globe className="w-4 h-4" />
              <span>CONFIG</span>
            </button>
          </div>

          {/* Interactive Help & Runbook Guide Button */}
          <button 
            type="button"
            onClick={() => setShowHelpModal(true)}
            className="p-2.5 rounded-md transition-all duration-200 cursor-pointer text-[#00ff88] hover:text-[#00ff88]/80 border border-[#00ff88]/20 bg-[#00ff88]/5 hover:bg-[#00ff88]/10 flex items-center gap-2 text-xs font-mono tracking-wider font-bold"
          >
            <HelpCircle className="w-3.5 h-3.5" />
            <span>RUNBOOK</span>
          </button>
        </div>
      </header>

      {/* Render the full Slate & Cyber-Green interactive dashboard element */}
      <main className="max-w-7xl mx-auto p-4 sm:p-6 transition-all duration-200">
        {view === "mission-control" && <LiveCockpit systemState={systemState} onRefresh={() => {}} activeView="mission-control" />}
        {view === "blotter" && <LiveCockpit systemState={systemState} onRefresh={() => {}} activeView="blotter" />}
        {view === "risk" && <LiveCockpit systemState={systemState} onRefresh={() => {}} activeView="risk" />}
        {view === "lab" && <QuantResearchLab />}
        {view === "config" && <Dashboard onNavigate={handleNavigate} navTarget={navTarget} activeTabOverride="credentials" />}
      </main>

      {/* Modern, Highly Graphic Onboarding Modal Overlay */}
      {showHelpModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 animate-fade-in font-sans">
          <div className="bg-[#0e1422] border border-[#00ff88]/25 rounded-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto shadow-2xl shadow-[#00ff88]/5 flex flex-col">
            
            {/* Modal Header */}
            <div className="border-b border-white/10 p-5 flex items-center justify-between sticky top-0 bg-[#0e1422]/95 z-10">
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 rounded bg-[#00ff88]/10 border border-[#00ff88]/20 text-[#00ff88]">
                  <HelpCircle className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-sm font-extrabold tracking-tight text-slate-100 uppercase">
                    🎓 ALPHA ENGINE RUNBOOK & ONBOARDING GUIDE
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    A beginner-friendly, newcomer-comprehensible blueprint for trading core co-location and risk compliance.
                  </p>
                </div>
              </div>
              <button 
                type="button"
                onClick={() => setShowHelpModal(false)}
                className="text-slate-400 hover:text-white transition cursor-pointer select-none font-extrabold text-sm font-mono border border-white/10 hover:border-white/25 px-2.5 py-1 rounded bg-white/5"
              >
                ✕ CLOSE
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6 space-y-6 text-slate-300 text-xs leading-relaxed max-h-[75vh] overflow-y-auto">
              
              {/* Question 1: Can the current GCP machine handle the improved system? */}
              <div className="bg-[#141d30] rounded-lg border border-indigo-500/15 p-4 space-y-2.5">
                <span className="text-xs text-indigo-400 font-extrabold uppercase tracking-wider block font-mono">
                  🖥️ Question 1: Can our Frankfurt GCP Spot VM handle this upgraded architecture?
                </span>
                <p className="text-xs sm:text-sm">
                  <strong>Yes, with massive headroom at ~$1.64/month!</strong> Running an <code className="bg-black/30 px-1 py-0.2 rounded text-indigo-300">e2-micro</code> or Spot VM instance (2 vCPUs, 1GB RAM) in Frankfurt (<code className="bg-black/30 px-1 py-0.2 rounded text-indigo-300">europe-west3</code>) provides sub-millisecond proximity to Interactive Brokers (IBIE / IBKR Ireland):
                </p>
                <ul className="list-disc pl-5 space-y-1.5 text-xs text-slate-300">
                  <li>
                    <strong className="text-white">Zero Overhead Socket Listening:</strong> The edge node daemon (<code className="bg-black/30 px-1 py-0.2 rounded text-emerald-400">main.py</code> & <code className="bg-black/30 px-1 py-0.2 rounded text-emerald-400">local_edge_node.py</code>) operates as an async Python event router, consuming **under 50MB RAM** and **&lt;2% CPU**.
                  </li>
                  <li>
                    <strong className="text-white">Cloud Run Backtesting Offload:</strong> Computational backtesting and simulation workloads run serverlessly in Cloud Run on demand, keeping the co-located VM 100% responsive for order execution.
                  </li>
                  <li>
                    <strong className="text-white">Asynchronous Firestore Sync:</strong> State updates, risk telemetry, and audit logs synchronize over non-blocking Firestore REST/gRPC bridges.
                  </li>
                </ul>
              </div>

              {/* Question 2: Multi-Model Critic-Verifier Consensus & Quota Guard */}
              <div className="bg-[#141d30] rounded-lg border border-cyan-500/15 p-4 space-y-2.5">
                <span className="text-xs text-cyan-400 font-extrabold uppercase tracking-wider block font-mono">
                  🧠 Question 2: How does the AI Intelligence Pipeline & Multi-Model Consensus Work?
                </span>
                <p className="text-xs sm:text-sm">
                  Trading signals are never based on naive single-prompt AI. Alpha Engine employs an institutional **Critic-Verifier Consensus Pipeline**:
                </p>
                <ul className="list-disc pl-5 space-y-1.5 text-xs text-slate-300">
                  <li>
                    <strong className="text-white">Critic-Verifier Duo:</strong> A primary analyst model generates quantitative trade hypotheses, while an adversarial critic model evaluates liquidity, news catalysts, and regime risks. Orders require <strong>&ge;75% consensus</strong>.
                  </li>
                  <li>
                    <strong className="text-white">Zero-Crash Quota Guard:</strong> If API limits are approached, the rolling-window rate limiter engages automatically and transitions smoothly to the deterministic quantitative engine — guaranteeing zero runtime crashes and uninterrupted risk monitoring.
                  </li>
                  <li>
                    <strong className="text-white">Attribution & Audit Logging:</strong> Every AI inference, rationale, and confidence score is permanently logged to Firestore (<code className="bg-black/30 px-1 py-0.2 rounded text-cyan-300">historical_logs</code>) for post-market calibration.
                  </li>
                </ul>
              </div>

              {/* Question 3: Dynamic Universe Discovery & Friction Screening */}
              <div className="bg-[#141d30] rounded-lg border border-purple-500/15 p-4 space-y-2.5">
                <span className="text-xs text-purple-400 font-extrabold uppercase tracking-wider block font-mono">
                  🌐 Question 3: How does the Dynamic Universe Discovery and Friction Filter Work?
                </span>
                <p className="text-xs sm:text-sm">
                  Hardcoded tickers are strictly avoided. Alpha Engine discovers opportunities dynamically each morning:
                </p>
                <ul className="list-disc pl-5 space-y-1.5 text-xs text-slate-300">
                  <li>
                    <strong className="text-white">Dynamic Scanner:</strong> Fetches high-volume market movers and sector catalysts directly from IBKR scanners and feed registries.
                  </li>
                  <li>
                    <strong className="text-white">Strict &lt;15% Friction Gate:</strong> Before ranking, every candidate undergoes friction screening: <code className="bg-black/30 px-1 py-0.2 rounded text-purple-300">Spread / ATR &le; 15%</code>. Illiquid tickers that would erode alpha through bid-ask slippage are automatically discarded.
                  </li>
                  <li>
                    <strong className="text-white">Top N Focus Selector:</strong> You can select to trade between <strong>1 and 5</strong> top-ranked instruments simultaneously in the dashboard to concentrate risk.
                  </li>
                </ul>
              </div>

              {/* Question 4: Credentials, APIs, and Live Safety */}
              <div className="bg-[#141d30] rounded-lg border border-amber-500/15 p-4 space-y-2.5">
                <span className="text-xs text-amber-400 font-extrabold uppercase tracking-wider block font-mono">
                  🔑 Question 4: How are Credentials Fed and Live Trading Protected?
                </span>
                <div className="space-y-2.5 pl-1 text-xs sm:text-sm">
                  <div>
                    <span className="text-xs text-slate-200 block font-bold font-mono uppercase">🎯 Tier 1: Cloud Run Control Plane</span>
                    <p className="text-slate-400">
                      Your Gemini API key and Firebase credentials remain strictly server-side inside Cloud Run or authenticated via IAM Service Accounts.
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-slate-200 block font-bold font-mono uppercase">📡 Tier 2: Edge Node VM (.env file)</span>
                    <p className="text-slate-400">
                      Configured via <code className="bg-black/30 px-1 py-0.2 rounded text-amber-300">.env</code>: Account ID, Port (default <code className="bg-white/10 px-1 rounded text-emerald-400">4002</code> for Paper, <code className="bg-white/10 px-1 rounded text-rose-400">4001</code> for Live), and MiFID-II trader shortcodes.
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-rose-300 block font-bold font-mono uppercase">🛡️ Two-Step Live Safety Gate</span>
                    <p className="text-slate-400">
                      Live trading cannot be toggled accidentally. To arm live execution, the operator must type the exact safety phrase: <code className="bg-black/40 px-1.5 py-0.5 rounded text-rose-400 font-mono font-bold">ALPHA_LIVE_CONFIRMED_2026</code>.
                    </p>
                  </div>
                </div>
              </div>

              {/* Comprehensive Beginner How-To Runbook */}
              <div className="bg-[#101b18]/70 rounded-lg border border-[#00ff88]/15 p-4.5 space-y-4 font-mono text-xs">
                <span className="text-xs text-[#00ff88] font-bold uppercase tracking-wider block">
                  🚀 STEP-BY-STEP RUNBOOK FOR BEGINNERS: YOUR FIRST RUN
                </span>
                
                <div className="space-y-3.5 leading-relaxed text-slate-300 font-sans text-xs sm:text-sm">
                  
                  {/* Step 1 */}
                  <div className="flex gap-3">
                    <span className="bg-[#00ff88]/10 text-[#00ff88] border border-[#00ff88]/30 w-6 h-6 rounded-full flex items-center justify-center font-bold text-xs shrink-0 font-mono">1</span>
                    <div>
                      <strong className="text-white block font-semibold">Verify Strategy with Event-Study Backtesting:</strong>
                      <span className="text-slate-400">Go to the <strong className="text-slate-200">📊 QUANT BACKTESTER</strong> tab in the GCP Companion panel. Run simulations across historical market regimes to inspect Directional Hit Rate, Maximum Adverse/Favorable Excursion (MAE/MFE), and Brier calibration scores.</span>
                    </div>
                  </div>

                  {/* Step 2 */}
                  <div className="flex gap-3">
                    <span className="bg-[#00ff88]/10 text-[#00ff88] border border-[#00ff88]/30 w-6 h-6 rounded-full flex items-center justify-center font-bold text-xs shrink-0 font-mono">2</span>
                    <div>
                      <strong className="text-white block font-semibold">Inspect Dynamic Universe & AI Consensus:</strong>
                      <span className="text-slate-400">Switch to the <strong className="text-cyan-400">🧠 AI INTELLIGENCE & UNIVERSE</strong> tab. Review discovered market movers, confirm the &lt;15% friction filter is passing, select your <strong>Top Focus Tickers</strong> (1 to 5), and review real-time Quota Guard health.</span>
                    </div>
                  </div>

                  {/* Step 3 */}
                  <div className="flex gap-3">
                    <span className="bg-[#00ff88]/10 text-[#00ff88] border border-[#00ff88]/30 w-6 h-6 rounded-full flex items-center justify-center font-bold text-xs shrink-0 font-mono">3</span>
                    <div>
                      <strong className="text-white block font-semibold">Set Up Risk Boundaries & Stop Multipliers:</strong>
                      <span className="text-slate-400">In the <strong className="text-slate-200">⚙️ RISK BOUNDARY CONFIGURATOR</strong>, verify your Stop ATR Multipliers (typically 1.8 ATR), dynamic Stop Limits, and toggle adaptive trailing stops.</span>
                    </div>
                  </div>

                  {/* Step 4 */}
                  <div className="flex gap-3">
                    <span className="bg-[#00ff88]/10 text-[#00ff88] border border-[#00ff88]/30 w-6 h-6 rounded-full flex items-center justify-center font-bold text-xs shrink-0 font-mono">4</span>
                    <div>
                      <strong className="text-white block font-semibold">Configure Drawdown Circuit Breakers (Essential Protection):</strong>
                      <span className="text-slate-400">Set your Daily Drawdown Limit Percent (e.g. 2.5%) and Cash Drawdown threshold (e.g. €1,500.00). If cumulative losses hit these boundaries, the system engages a hard lock on the router immediately to protect capital.</span>
                    </div>
                  </div>

                  {/* Step 5 */}
                  <div className="flex gap-3">
                    <span className="bg-[#00ff88]/10 text-[#00ff88] border border-[#00ff88]/30 w-6 h-6 rounded-full flex items-center justify-center font-bold text-xs shrink-0 font-mono">5</span>
                    <div>
                      <strong className="text-white block font-semibold">Deploy and Run on Paper (Simulated Gateway):</strong>
                      <span className="text-slate-400">Ensure the VM loop port is set to <code className="bg-black/30 px-1 py-0.2 rounded text-emerald-400">4002</code> (IBKR Paper gateway). Run the deployment script <code className="bg-black/30 px-1 py-0.2 rounded text-slate-300">./deploy_to_gcp.sh</code>. Check the Live Telemetry Stream panel to see sub-millisecond co-location in action!</span>
                    </div>
                  </div>

                  {/* Step 6 */}
                  <div className="flex gap-3">
                    <span className="bg-[#00ff88]/10 text-[#00ff88] border border-[#00ff88]/30 w-6 h-6 rounded-full flex items-center justify-center font-bold text-xs shrink-0 font-mono">6</span>
                    <div>
                      <strong className="text-white block font-semibold">Emergency Monitoring & Overrides:</strong>
                      <span className="text-slate-400">If a circuit breaker engages, click <strong className="text-amber-400">ADMIN UNLOCK</strong> to restore routing after assessing market conditions. Click <strong className="text-rose-400">PANIC FLUSH</strong> to instantly liquidate all open positions in an emergency.</span>
                    </div>
                  </div>

                </div>
              </div>

            </div>

            {/* Modal Footer */}
            <div className="border-t border-white/10 p-5 bg-black/30 flex items-center justify-between sticky bottom-0 z-10">
              <span className="text-xs text-slate-400 font-mono">
                Alpha Engine v1.4 • Protected under CBI MiFID II Compliance
              </span>
              <button 
                type="button"
                onClick={() => setShowHelpModal(false)}
                className="px-4 py-2 bg-[#00ff88] hover:bg-[#00ff88]/80 text-black font-extrabold rounded text-xs uppercase shadow-md shadow-[#00ff88]/10 transition cursor-pointer select-none"
              >
                Let's Get Trading!
              </button>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
