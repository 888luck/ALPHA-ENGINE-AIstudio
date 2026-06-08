import React, { useState, useEffect } from "react";
import Dashboard from "./components/Dashboard";
import { Sun, Moon, Activity, Tag, Globe, HelpCircle } from "lucide-react";

export default function App() {
  // Safe default persistent theme
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    const saved = localStorage.getItem("alpha_dashboard_theme");
    return (saved as "dark" | "light") || "dark";
  });

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
        </div>
      </header>

      {/* Render the full Slate & Cyber-Green interactive dashboard element */}
      <main className="max-w-7xl mx-auto p-4 sm:p-6 transition-all duration-200">
        <Dashboard />
      </main>
    </div>
  );
}
