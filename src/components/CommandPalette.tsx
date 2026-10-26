// ==============================================================================
//        ALPHA ENGINE - BLOOMBERG-STYLE SPOTLIGHT COMMAND PALETTE
// ==============================================================================
// Institutional keyboard-driven command & ticker spotlight:
// - Accessible via Cmd+K (Mac) / Ctrl+K (Windows) or '/' hotkey
// - Instant ticker jump, execution lane toggle, view switcher, and font density
// - Up/Down arrow key navigation, Enter execution, and Esc dismiss
// ==============================================================================

import React, { useState, useEffect, useRef } from "react";
import {
  Search,
  Activity,
  LayoutGrid,
  ShieldAlert,
  Layers,
  SlidersHorizontal,
  Sparkles,
  Globe,
  Sun,
  Moon,
  TrendingUp,
  AlertTriangle,
  RefreshCw,
  Terminal,
  X,
  Type
} from "lucide-react";
import { TerminalDensity } from "../utils/density";

export interface CommandItem {
  id: string;
  category: "Navigation" | "Execution" | "Tickers" | "Display" | "Emergency";
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  shortcut?: string;
  onSelect: () => void;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (view: any, target?: string) => void;
  onToggleTradingMode: () => void;
  tradingMode: "PAPER" | "LIVE";
  theme: "dark" | "light";
  onToggleTheme: () => void;
  density: TerminalDensity;
  onSetDensity: (density: TerminalDensity) => void;
  onOpenRunbook?: () => void;
  onTrigger2FA?: () => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  onNavigate,
  onToggleTradingMode,
  tradingMode,
  theme,
  onToggleTheme,
  density,
  onSetDensity,
  onOpenRunbook,
  onTrigger2FA
}) => {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Master command catalog
  const commands: CommandItem[] = [
    // Navigation
    {
      id: "nav-studio",
      category: "Navigation",
      title: "Strategy Studio & 16-Trial DSR Sweep",
      subtitle: "Autonomous quant strategy discovery and backtester",
      icon: <SlidersHorizontal className="w-4 h-4 text-emerald-400" />,
      shortcut: "Alt+5",
      onSelect: () => onNavigate("studio")
    },
    {
      id: "nav-copilot",
      category: "Navigation",
      title: "Strategy Copilot Terminal",
      subtitle: "Multi-model reasoning, tool execution, and token audit",
      icon: <Sparkles className="w-4 h-4 text-[#00ff88]" />,
      shortcut: "Alt+7",
      onSelect: () => onNavigate("copilot")
    },
    {
      id: "nav-mission",
      category: "Navigation",
      title: "Mission Control Overview",
      subtitle: "Live telemetry, open PnL, and socket status",
      icon: <Activity className="w-4 h-4 text-rose-400" />,
      shortcut: "Alt+1",
      onSelect: () => onNavigate("mission-control")
    },
    {
      id: "nav-blotter",
      category: "Navigation",
      title: "Order Blotter & Executions",
      subtitle: "Real-time execution ledger, basis point slippage, RTS 22 tags",
      icon: <LayoutGrid className="w-4 h-4 text-indigo-400" />,
      shortcut: "Alt+2",
      onSelect: () => onNavigate("blotter")
    },
    {
      id: "nav-risk",
      category: "Navigation",
      title: "Risk Boundary & DRM Configurator",
      subtitle: "Drawdown circuit breakers, max loss cutoffs, VaR ceilings",
      icon: <ShieldAlert className="w-4 h-4 text-amber-400" />,
      shortcut: "Alt+3",
      onSelect: () => onNavigate("risk")
    },
    {
      id: "nav-lab",
      category: "Navigation",
      title: "Quant Research Lab & Universe Builder",
      subtitle: "SEC EDGAR filings, clinical trials, and microstructure qualification",
      icon: <Layers className="w-4 h-4 text-purple-400" />,
      shortcut: "Alt+4",
      onSelect: () => onNavigate("lab")
    },
    {
      id: "nav-config",
      category: "Navigation",
      title: "4-Pillar Connection & Feed Vault",
      subtitle: "Broker DMA, GCP Cloud, AI Providers, and secondary feeds",
      icon: <Globe className="w-4 h-4 text-cyan-400" />,
      shortcut: "Alt+6",
      onSelect: () => onNavigate("config")
    },

    // Execution Controls
    {
      id: "exec-lane",
      category: "Execution",
      title: tradingMode === "LIVE" ? "Switch Execution Lane to PAPER (Port 4002)" : "Switch Execution Lane to LIVE DMA (Port 4001)",
      subtitle: `Current active lane: ${tradingMode}`,
      icon: <RefreshCw className="w-4 h-4 text-emerald-400" />,
      onSelect: () => onToggleTradingMode()
    },
    ...(onTrigger2FA
      ? [
          {
            id: "exec-2fa",
            category: "Execution" as const,
            title: "Request Instant Phone 2FA Approval",
            subtitle: "Dispatches push signal to Frankfurt edge daemon",
            icon: <Terminal className="w-4 h-4 text-emerald-400" />,
            onSelect: () => onTrigger2FA()
          }
        ]
      : []),

    // Quick Ticker Focus (Jumps directly to Strategy Studio)
    {
      id: "ticker-asml",
      category: "Tickers",
      title: "ASML Holding NV (Euronext Amsterdam)",
      subtitle: "Semi-conductor capital equipment • 15m/5m momentum candidate",
      icon: <TrendingUp className="w-4 h-4 text-emerald-400" />,
      onSelect: () => onNavigate("studio", "ASML")
    },
    {
      id: "ticker-nvda",
      category: "Tickers",
      title: "NVIDIA Corp (NASDAQ)",
      subtitle: "AI accelerator hardware • High OFI volume expansion profile",
      icon: <TrendingUp className="w-4 h-4 text-blue-400" />,
      onSelect: () => onNavigate("studio", "NVDA")
    },
    {
      id: "ticker-ato",
      category: "Tickers",
      title: "Atos SE (Euronext Paris)",
      subtitle: "European technology turnaround • 1-year verified minute bars",
      icon: <TrendingUp className="w-4 h-4 text-emerald-400" />,
      onSelect: () => onNavigate("studio", "ATO")
    },
    {
      id: "ticker-cue",
      category: "Tickers",
      title: "Cue Biopharma (NASDAQ)",
      subtitle: "Clinical trial catalyst candidate • Low-spread friction hurdle",
      icon: <TrendingUp className="w-4 h-4 text-blue-400" />,
      onSelect: () => onNavigate("studio", "CUE")
    },
    {
      id: "ticker-onwd",
      category: "Tickers",
      title: "Onward Medical NV (Euronext Brussels)",
      subtitle: "Medical neuro-stimulation • 1-year verified bar dataset",
      icon: <TrendingUp className="w-4 h-4 text-emerald-400" />,
      onSelect: () => onNavigate("studio", "ONWD")
    },

    // Display & Density
    {
      id: "disp-density-compact",
      category: "Display",
      title: "Display Density: COMPACT (Dense Desk)",
      subtitle: "11.5px base font, 24px row height • Optimal for 4K / Multi-Monitors",
      icon: <Type className="w-4 h-4 text-cyan-400" />,
      shortcut: "Alt+[",
      onSelect: () => onSetDensity("compact")
    },
    {
      id: "disp-density-standard",
      category: "Display",
      title: "Display Density: STANDARD (Balanced)",
      subtitle: "13px base font, 28px row height • Default 1080p/1440p scale",
      icon: <Type className="w-4 h-4 text-slate-300" />,
      onSelect: () => onSetDensity("standard")
    },
    {
      id: "disp-density-comfort",
      category: "Display",
      title: "Display Density: COMFORT (High Readability)",
      subtitle: "14.5px base font, 34px row height • Optimal for Laptops",
      icon: <Type className="w-4 h-4 text-amber-400" />,
      shortcut: "Alt+]",
      onSelect: () => onSetDensity("comfort")
    },
    {
      id: "disp-theme-toggle",
      category: "Display",
      title: theme === "dark" ? "Switch to Light Desk Mode (Financial Paper)" : "Switch to Dark Desk Mode (Night Desk)",
      subtitle: `Current active theme: ${theme.toUpperCase()}`,
      icon: theme === "dark" ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-blue-400" />,
      shortcut: "Alt+T",
      onSelect: () => onToggleTheme()
    },

    // Runbook & Guides
    ...(onOpenRunbook
      ? [
          {
            id: "help-runbook",
            category: "Emergency" as const,
            title: "Alpha Engine Institutional Runbook",
            subtitle: "Architectural blueprint, risk constraints, and beginner guide",
            icon: <Terminal className="w-4 h-4 text-[#00ff88]" />,
            onSelect: () => onOpenRunbook()
          }
        ]
      : [])
  ];

  // Filter commands by query
  const filtered = commands.filter((c) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase().trim();
    return (
      c.title.toLowerCase().includes(q) ||
      (c.subtitle && c.subtitle.toLowerCase().includes(q)) ||
      c.category.toLowerCase().includes(q)
    );
  });

  // Handle keyboard navigation inside the palette
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1 < filtered.length ? prev + 1 : 0));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 >= 0 ? prev - 1 : filtered.length - 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (filtered[selectedIndex]) {
          filtered[selectedIndex].onSelect();
          onClose();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, filtered, selectedIndex, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-20 px-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-100">
      {/* Click outside to close */}
      <div className="fixed inset-0" onClick={onClose} />

      <div className="relative w-full max-w-2xl bg-[#0d1117] border border-[#21262d] rounded-lg shadow-2xl shadow-black/90 overflow-hidden font-mono z-10 animate-in zoom-in-95 duration-100">
        {/* Top Input Bar */}
        <div className="flex items-center px-4 py-3 border-b border-[#21262d] bg-[#161b22]/50">
          <Search className="w-4 h-4 text-slate-400 mr-3 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder="Type a ticker (ASML, NVDA), command (/studio, /risk), or action..."
            className="w-full bg-transparent text-sm text-white placeholder-slate-500 focus:outline-none font-mono"
          />
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded hover:bg-white/5 transition ml-2"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Command Results List */}
        <div className="max-h-96 overflow-y-auto p-2 space-y-1">
          {filtered.length === 0 ? (
            <div className="py-8 text-center text-slate-400 text-xs">
              No institutional commands matching "{query}"
            </div>
          ) : (
            filtered.map((item, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    item.onSelect();
                    onClose();
                  }}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`w-full text-left px-3 py-2 rounded-md flex items-center justify-between gap-3 transition cursor-pointer ${
                    isSelected
                      ? "bg-[#161b22] border border-[#30363d] text-white"
                      : "text-slate-300 hover:bg-white/5 border border-transparent"
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="shrink-0 p-1 rounded bg-black/40 border border-white/5">{item.icon}</span>
                    <div className="min-w-0 truncate">
                      <div className="text-xs font-bold truncate text-white flex items-center gap-2">
                        <span>{item.title}</span>
                        <span className="text-[9px] px-1.5 py-0.2 rounded bg-white/5 text-slate-400 uppercase">
                          {item.category}
                        </span>
                      </div>
                      {item.subtitle && (
                        <div className="text-[10px] text-slate-400 truncate mt-0.5">{item.subtitle}</div>
                      )}
                    </div>
                  </div>

                  {item.shortcut && (
                    <span className="text-[10px] text-slate-400 bg-white/5 border border-white/10 px-1.5 py-0.5 rounded shrink-0">
                      {item.shortcut}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>

        {/* Footer Hotkey Legend */}
        <div className="px-4 py-2 border-t border-[#21262d] bg-[#080b10] flex items-center justify-between text-[10px] text-slate-400">
          <div className="flex items-center gap-3">
            <span>↑↓ Navigate</span>
            <span>↵ Select</span>
            <span>ESC Close</span>
          </div>
          <div className="text-[#00ff88] font-bold">ALPHA SPOTLIGHT • BLOOMBERG DESK QUALITY</div>
        </div>
      </div>
    </div>
  );
};
