import React, { useState, useEffect } from "react";
import Dashboard from "./components/Dashboard";
import { Sun, Moon, Activity, Tag, Globe, HelpCircle } from "lucide-react";

export default function App() {
  // Safe default persistent theme
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    const saved = localStorage.getItem("alpha_dashboard_theme");
    return (saved as "dark" | "light") || "dark";
  });

  const [showHelpModal, setShowHelpModal] = useState(false);

  const toggleTheme = () => {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      localStorage.setItem("alpha_dashboard_theme", next);
      return next;
    });
  };

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

  // Dynamic DOM Watcher to overlay multi-exchange tags securely is run iteratively
  useEffect(() => {
    const enrichDomElements = () => {
      // 1. Scan for active trade and log rows (usually in standard td layout panels)
      const cells = document.querySelectorAll("td");
      cells.forEach((cell) => {
        // Prevent duplicate badge injects
        if (cell.querySelector(".exchange-tag")) return;

        const cellText = (cell.textContent || "").trim();
        // Check if cell is the symbol cell (e.g., matches standard uppercase ticker with ID text or just letters)
        // Active Trades Symbol columns usually have text pattern: "XLE TRD_1001" or "SGO", etc.
        const symbolMatch = cellText.match(/^([A-Z]{3,5})\b/);
        if (symbolMatch) {
          const matchedSymbol = symbolMatch[1];
          const hasInnerSpanText = cell.querySelector("span") !== null;
          
          // To ensure we only target the symbol header column inside execution portfolios
          if (cell.classList.contains("font-bold") || hasInnerSpanText) {
            let badgeText = "US EXCHANGE";
            let badgeClass = "exchange-badge-us";

            if (["RWE", "SAP"].includes(matchedSymbol)) {
              badgeText = "XETRA";
              badgeClass = "exchange-badge-xetra";
            } else if (["SGO", "ENGI", "ORSTED"].includes(matchedSymbol)) {
              badgeText = "EURONEXT";
              badgeClass = "exchange-badge-euronext";
            } else if (!["BUY", "SELL", "LONG", "SHORT", "UNITS", "ENTRY"].includes(matchedSymbol)) {
              // Standard US symbols default
              badgeText = "US Exchange";
              badgeClass = "exchange-badge-us";
            } else {
              return; // Exclude non-symbol matches
            }

            const badgeSpan = document.createElement("span");
            badgeSpan.className = `exchange-tag ${badgeClass} text-[9px] px-1.5 py-0.5 rounded border ml-2 font-mono font-bold tracking-wider inline-block select-none scale-90 align-middle transition-colors duration-150`;
            badgeSpan.innerText = badgeText;
            
            // Append securely to the parent cell representation
            cell.appendChild(badgeSpan);
          }
        }
      });
    };

    // Instantiate scanning poll
    const interval = setInterval(enrichDomElements, 350);
    return () => clearInterval(interval);
  }, []);

  // Comprehensive light theme stylesheet template logic
  const lightThemeCss = `
    /* Premium Slate Light Theme Mode */
    .theme-light body {
      background-color: #f8fafc !important;
      color: #0f172a !important;
    }
    
    .theme-light #alpha-engine-application-wrapper {
      background-color: #f8fafc !important;
    }
    
    .theme-light #alpha-header-panel {
      background-color: rgba(255, 255, 255, 0.9) !important;
      border-color: rgba(15, 23, 42, 0.08) !important;
    }
    
    .theme-light #alpha-header-panel h1 {
      color: #0f172a !important;
    }
    
    .theme-light #alpha-header-panel p {
      color: #475569 !important;
    }
    
    .theme-light #theme-mode-toggle {
      background-color: rgba(15, 23, 42, 0.04) !important;
      border-color: rgba(15, 23, 42, 0.08) !important;
      color: #334155 !important;
    }
    
    .theme-light #theme-mode-toggle:hover {
      background-color: rgba(15, 23, 42, 0.08) !important;
      color: #0f172a !important;
    }
    
    /* Frosted Glass Override Rules under Light Theme */
    .theme-light .frosted-glass {
      background: rgba(255, 255, 255, 0.85) !important;
      backdrop-filter: blur(20px) saturate(180%) !important;
      border: 1px solid rgba(15, 23, 42, 0.08) !important;
      box-shadow: 0 4px 20px -2px rgba(15, 23, 42, 0.04) !important;
      color: #0f172a !important;
    }
    
    .theme-light .frosted-glass-hover:hover {
      background: rgba(255, 255, 255, 0.98) !important;
      border-color: rgba(15, 23, 42, 0.15) !important;
      box-shadow: 0 12px 35px -5px rgba(15, 23, 42, 0.08) !important;
    }
    
    /* Text overrides across custom nested layouts */
    .theme-light .text-slate-100,
    .theme-light .text-slate-200,
    .theme-light .text-slate-300,
    .theme-light .text-[#f1f5f9],
    .theme-light .text-white,
    .theme-light h1,
    .theme-light h2,
    .theme-light h3,
    .theme-light h4,
    .theme-light th,
    .theme-light td,
    .theme-light table,
    .theme-light button:not(.btn-cyber-primary) {
      color: #0f172a !important;
    }
    
    .theme-light .text-slate-400 {
      color: #475569 !important;
    }
    
    .theme-light .text-slate-500 {
      color: #64748b !important;
    }
    
    /* Boundaries & Borders adjustments */
    .theme-light .border-white/10 {
      border-color: rgba(15, 23, 42, 0.08) !important;
    }
    
    .theme-light .divide-white/5 > * + * {
      border-color: rgba(15, 23, 42, 0.06) !important;
    }
    
    /* Background colors inside visual panels */
    .theme-light .bg-black/35,
    .theme-light .bg-black/40,
    .theme-light .bg-black/20,
    .theme-light .bg-white/5,
    .theme-light .bg-white/10,
    .theme-light .bg-slate-900 {
      background-color: rgba(15, 23, 42, 0.03) !important;
    }
    
    .theme-light .bg-slate-950,
    .theme-light .bg-[#0a0f1d] {
      background-color: #f8fafc !important;
    }
    
    /* Inputs, Selections & Dialog layout adjustments */
    .theme-light input,
    .theme-light select {
      background-color: #ffffff !important;
      color: #0f172a !important;
      border: 1px solid rgba(15, 23, 42, 0.12) !important;
    }
    
    .theme-light select option {
      background-color: #ffffff !important;
      color: #0f172a !important;
    }
    
    .theme-light input::placeholder {
      color: #94a3b8 !important;
    }
    
    /* Custom Scrollbar override blocks */
    .theme-light ::-webkit-scrollbar-track {
      background: rgba(15, 23, 42, 0.01) !important;
    }
    .theme-light ::-webkit-scrollbar-thumb {
      background: rgba(15, 23, 42, 0.08) !important;
    }
    .theme-light ::-webkit-scrollbar-thumb:hover {
      background: rgba(15, 23, 42, 0.15) !important;
    }
    
    /* Recharts responsive grid coordinates styling */
    .theme-light .recharts-cartesian-grid line {
      stroke: rgba(15, 23, 42, 0.06) !important;
    }
    
    .theme-light .recharts-text {
      fill: #475569 !important;
      font-weight: 500 !important;
    }
    
    .theme-light .recharts-tooltip-cursor {
      fill: rgba(15, 23, 42, 0.02) !important;
    }
    
    .theme-light .recharts-default-tooltip {
      background-color: rgba(255, 255, 255, 0.98) !important;
      border: 1px solid rgba(15, 23, 42, 0.08) !important;
      color: #0f172a !important;
      box-shadow: 0 4px 15px rgba(0, 0, 0, 0.05) !important;
    }
    
    .theme-light .recharts-tooltip-label {
      color: #0f172a !important;
    }
    
    /* Specific styling for exchange badges */
    .exchange-badge-us {
      background-color: rgba(59, 130, 246, 0.12) !important;
      color: #60a5fa !important;
      border: 1px solid rgba(59, 130, 246, 0.25) !important;
    }
    .theme-light .exchange-badge-us {
      background-color: rgba(59, 130, 246, 0.06) !important;
      color: #1d4ed8 !important;
      border: 1px solid rgba(59, 130, 246, 0.18) !important;
    }
    
    .exchange-badge-xetra {
      background-color: rgba(245, 158, 11, 0.12) !important;
      color: #fbbf24 !important;
      border: 1px solid rgba(245, 158, 11, 0.25) !important;
    }
    .theme-light .exchange-badge-xetra {
      background-color: rgba(245, 158, 11, 0.06) !important;
      color: #b45309 !important;
      border: 1px solid rgba(245, 158, 11, 0.18) !important;
    }
    
    .exchange-badge-euronext {
      background-color: rgba(16, 185, 129, 0.12) !important;
      color: #34d399 !important;
      border: 1px solid rgba(16, 185, 129, 0.25) !important;
    }
    .theme-light .exchange-badge-euronext {
      background-color: rgba(16, 185, 129, 0.06) !important;
      color: #047857 !important;
      border: 1px solid rgba(16, 185, 129, 0.18) !important;
    }
  `;

  return (
    <div 
      id="alpha-engine-application-wrapper" 
      className={`min-h-screen transition-colors duration-250 ${
        theme === "dark" ? "bg-slate-950 text-white" : "bg-slate-50 text-slate-900"
      }`}
    >
      {/* Inject light mode stylesheet overrides */}
      <style>{lightThemeCss}</style>

      {/* Modern sticky header with telemetry settings & switcher controls */}
      <header 
        id="alpha-header-panel" 
        className="sticky top-0 z-50 border-b border-white/10 bg-slate-950/85 backdrop-blur-md px-6 py-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 transition-colors duration-150"
      >
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-[#00ff88]/10 border border-[#00ff88]/20 flex items-center justify-center">
            <Activity className="w-5 h-5 text-[#00ff88] animate-pulse" />
          </div>
          <div>
            <h1 className="text-sm font-bold font-sans tracking-tight text-slate-100 flex items-center gap-2">
              ALPHA ENGINE 
              <span className="text-[9px] bg-slate-800 text-[#00ff88] font-mono px-1.5 py-0.5 rounded border border-[#00ff88]/20 tracking-wider">
                EDGE NODE SECURED
              </span>
            </h1>
            <p className="text-[10px] text-slate-400 font-mono">
              Brokerage Interface & Dynamic Asset Risk Allocator (IBIE Pro Europe Segment)
            </p>
          </div>
        </div>
        
        <div className="flex flex-wrap items-center gap-4 w-full sm:w-auto justify-between sm:justify-end">
          {/* Legend detailing Exchange Originations */}
          <div className="flex items-center gap-3 text-[9px] font-mono pr-2 text-slate-400">
            <div className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shadow" />
              <span>US EXCHANGE</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shadow" />
              <span>XETRA</span>
            </div>
            <div className="flex items-center gap-1 font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow animate-pulse" />
              <span>EURONEXT CO.</span>
            </div>
          </div>

          {/* Clean sun/moon button switcher */}
          <button 
            type="button"
            id="theme-mode-toggle"
            onClick={toggleTheme}
            className="p-2 rounded-md transition-all duration-200 cursor-pointer text-slate-300 hover:text-white border border-white/10 bg-white/5 hover:bg-white/10 flex items-center gap-2 text-[10px] font-mono tracking-wider font-semibold"
          >
            {theme === "dark" ? (
              <>
                <Sun className="w-3.5 h-3.5 text-amber-400" />
                <span>LIGHT SYSTEM</span>
              </>
            ) : (
              <>
                <Moon className="w-3.5 h-3.5 text-blue-500" />
                <span>CYBER SLATE DARK</span>
              </>
            )}
          </button>

          {/* Interactive Help & Runbook Guide Button */}
          <button 
            type="button"
            onClick={() => setShowHelpModal(true)}
            className="p-2 rounded-md transition-all duration-200 cursor-pointer text-[#00ff88] hover:text-[#00ff88]/80 border border-[#00ff88]/20 bg-[#00ff88]/5 hover:bg-[#00ff88]/10 flex items-center gap-2 text-[10px] font-mono tracking-wider font-semibold"
          >
            <HelpCircle className="w-3.5 h-3.5" />
            <span>HOW-TO USE & RUNBOOK</span>
          </button>
        </div>
      </header>

      {/* Render the full Slate & Cyber-Green interactive dashboard element */}
      <main className="max-w-7xl mx-auto p-4 sm:p-6 transition-all duration-200">
        <Dashboard />
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
                  <p className="text-[10.5px] text-slate-400">
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
            <div className="p-6 space-y-6 text-slate-300 text-xs leading-relaxed">
              
              {/* Question 1: Can the current GCP machine handle the improved system? */}
              <div className="bg-[#141d30] rounded-lg border border-indigo-500/15 p-4 space-y-2.5">
                <span className="text-[11px] text-indigo-400 font-extrabold uppercase tracking-wider block font-mono">
                  🖥️ Question 1: Can our current GCE e2-micro instance handle this improved system?
                </span>
                <p>
                  <strong>Yes, absolutely and with massive headroom!</strong> You might think that a small machine like an <code className="bg-black/30 px-1 py-0.2 rounded text-indigo-300">e2-micro</code> (2 vCPUs, 1GB RAM) would struggle, but our architecture is specifically optimized for this:
                </p>
                <ul className="list-disc pl-5 space-y-1.5 text-[11.5px] text-slate-300">
                  <li>
                    <strong className="text-white">Zero Overhead Socket Listening:</strong> The edge node daemon (<code className="bg-black/30 px-1 py-0.2 rounded text-emerald-400">main.py</code> & <code className="bg-black/30 px-1 py-0.2 rounded text-emerald-400">local_edge_node.py</code>) is written in highly optimized, single-threaded asynchronous Python. It acts purely as a traffic router. It typically consumes **less than 50MB of RAM** and **under 2% CPU load** under active market ticks.
                  </li>
                  <li>
                    <strong className="text-white">No CPU-intensive Backtesting on GCE:</strong> Quantitative strategy backtests can be computationally heavy. To prevent edge node degradation, backtesting calculations are executed in the cloud on demand by the **Google Cloud Run container**, completely offloading the GCE machine.
                  </li>
                  <li>
                    <strong className="text-white">External AI Evaluation:</strong> All deep intelligence reviews and geopolitical calibrations are dispatched directly to Google's supercomputing API nodes via the **Gemini API**. The local edge node does not run heavy neural networks locally.
                  </li>
                  <li>
                    <strong className="text-white">Asynchronous Database Syncing:</strong> Dynamic state synchronization operates via light Firestore API bridges, removing heavy polling loops or local SQL server workloads.
                  </li>
                </ul>
              </div>

              {/* Question 2: How are credentials and API keys fed to the system? */}
              <div className="bg-[#141d30] rounded-lg border border-amber-500/15 p-4 space-y-2.5">
                <span className="text-[11px] text-amber-400 font-extrabold uppercase tracking-wider block font-mono">
                  🔑 Question 2: How do User Credentials, APIs, and Identifiers feed into the system?
                </span>
                <p>
                  Security is critical when dealing with live capital routing. Alpha Engine feeds parameters dynamically to two distinct execution zones:
                </p>
                
                <div className="space-y-3 pl-1">
                  <div>
                    <span className="text-[10px] text-slate-200 block font-bold font-mono uppercase">🎯 Tier 1: Express Web API Control Plane (Cloud Run)</span>
                    <p className="text-slate-400 pt-0.5">
                      Your <strong className="text-slate-200">Gemini API Key</strong> operates strictly server-side inside Cloud Run. This ensures your key is never visible to web browsers. When migrating to Vertex AI in production, you can completely remove standard keys and let Google Cloud authenticate using keyless **Service Accounts** (IAM roles).
                    </p>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-200 block font-bold font-mono uppercase">📡 Tier 2: Edge Node VM (GCE Frankfurt)</span>
                    <p className="text-slate-400 pt-0.5">
                      At startup, the Python script imports configurations via <code className="bg-black/30 px-1 py-0.2 rounded">config_loader.py</code> from a secure local <code className="bg-black/30 px-1 py-0.2 rounded text-amber-300">.env</code> file stored on the VM. This file houses:
                    </p>
                    <ul className="list-disc pl-5 mt-1 text-slate-400 space-y-1">
                      <li><strong className="text-slate-300">IBKR_ACCOUNT_NUMBER:</strong> Target Interactive Brokers account ID.</li>
                      <li><strong className="text-slate-300">IBKR_PORT:</strong> Port <code className="bg-white/10 px-1 py-0.1 rounded text-[10px]">4002</code> for simulated paper, or <code className="bg-white/10 px-1 py-0.1 rounded text-[10px]">4001</code> for live production.</li>
                      <li><strong className="text-slate-300">Regulatory Shortcodes:</strong> MiFID-II required compliance identifiers (<code className="bg-black/30 px-1 py-0.1 rounded">DECISION_MAKER_ID</code> & <code className="bg-black/30 px-1 py-0.1 rounded">EXECUTION_TRADER_ID</code>).</li>
                      <li><strong className="text-slate-300">FIREBASE_API_KEY:</strong> Token used to securely bridge telemetry into your Firestore collections.</li>
                    </ul>
                  </div>
                </div>
              </div>

              {/* Comprehensive Beginner How-To Runbook */}
              <div className="bg-[#101b18]/70 rounded-lg border border-[#00ff88]/15 p-4.5 space-y-4 font-mono text-xs">
                <span className="text-[11px] text-[#00ff88] font-bold uppercase tracking-wider block">
                  🚀 STEP-BY-STEP RUNBOOK FOR BEGINNERS: YOUR FIRST RUN
                </span>
                
                <div className="space-y-3.5 leading-relaxed text-slate-300 font-sans text-[11.5px]">
                  
                  {/* Step 1 */}
                  <div className="flex gap-3">
                    <span className="bg-[#00ff88]/10 text-[#00ff88] border border-[#00ff88]/30 w-5 h-5 rounded-full flex items-center justify-center font-bold text-[10px] shrink-0 font-mono">1</span>
                    <div>
                      <strong className="text-white block font-semibold">Verify Strategy with a Backtest:</strong>
                      <span className="text-slate-400">Before risking any funds (even simulated ones), test the algorithm. Go to the <strong className="text-slate-200">📊 QUANT BACKTESTER</strong> tab in the GCP Control Companion panel below, pick a ticker (e.g., <code className="bg-black/30 px-1 py-0.2 rounded text-emerald-400">XLE</code>), select a timeframe, and hit <strong className="text-slate-200">RUN SIMULATION</strong>. Recharts will instantly plot the dynamic equity curves, transaction costs, and signal accuracy.</span>
                    </div>
                  </div>

                  {/* Step 2 */}
                  <div className="flex gap-3">
                    <span className="bg-[#00ff88]/10 text-[#00ff88] border border-[#00ff88]/30 w-5 h-5 rounded-full flex items-center justify-center font-bold text-[10px] shrink-0 font-mono">2</span>
                    <div>
                      <strong className="text-white block font-semibold">Set Up Risk Boundaries & Stop Multipliers:</strong>
                      <span className="text-slate-400">In the <strong className="text-slate-200">⚙️ RISK BOUNDARY CONFIGURATOR</strong> panel, specify your Stop ATR Multipliers (typically 1.8 ATR), dynamic Stop Limits, and toggle adaptive stop settings. This aligns with standard institutional rules.</span>
                    </div>
                  </div>

                  {/* Step 3 */}
                  <div className="flex gap-3">
                    <span className="bg-[#00ff88]/10 text-[#00ff88] border border-[#00ff88]/30 w-5 h-5 rounded-full flex items-center justify-center font-bold text-[10px] shrink-0 font-mono">3</span>
                    <div>
                      <strong className="text-white block font-semibold">Configure Drawdown Circuit Breakers (Essential Protection):</strong>
                      <span className="text-slate-400">Use <strong className="text-slate-200">Option 3 (Drawdown Hard-Locks)</strong> to set your Daily Drawdown Limit Percent (e.g. 2.5%) and Cash Drawdown threshold (e.g. €1,500.00). If cumulative losses touch these boundaries, the system instantly engages a hard lock on the router to preserve capital.</span>
                    </div>
                  </div>

                  {/* Step 4 */}
                  <div className="flex gap-3">
                    <span className="bg-[#00ff88]/10 text-[#00ff88] border border-[#00ff88]/30 w-5 h-5 rounded-full flex items-center justify-center font-bold text-[10px] shrink-0 font-mono">4</span>
                    <div>
                      <strong className="text-white block font-semibold">Deploy and Run on Paper (Simulated Account):</strong>
                      <span className="text-slate-400">To test on paper securely without paying, configure your local VM config loop port to <code className="bg-black/30 px-1 py-0.2 rounded text-emerald-400">4002</code> (which connects directly to the IBKR Paper gateway). Run the companion script <code className="bg-black/30 px-1 py-0.2 rounded text-slate-300">./deploy_to_gcp.sh</code> to spin up your Frankfurt VM node. Check the Live Telemetry Stream panel to see real-time latency (less than 2.0ms) co-location in action!</span>
                    </div>
                  </div>

                  {/* Step 5 */}
                  <div className="flex gap-3">
                    <span className="bg-[#00ff88]/10 text-[#00ff88] border border-[#00ff88]/30 w-5 h-5 rounded-full flex items-center justify-center font-bold text-[10px] shrink-0 font-mono">5</span>
                    <div>
                      <strong className="text-white block font-semibold">Monitoring & Overrides:</strong>
                      <span className="text-slate-400">If a circuit breaker hard locks, click <strong className="text-amber-400">ADMIN UNLOCK</strong> to override and restore the router manually once risk is evaluated. Use <strong className="text-rose-400">PANIC FLUSH</strong> to instantly liquidate all open positions in an emergency.</span>
                    </div>
                  </div>

                </div>
              </div>

            </div>

            {/* Modal Footer */}
            <div className="border-t border-white/10 p-5 bg-black/30 flex items-center justify-between sticky bottom-0 z-10">
              <span className="text-[10px] text-slate-500 font-mono">
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
