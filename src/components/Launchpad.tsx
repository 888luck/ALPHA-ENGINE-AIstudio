import React from "react";
import { 
  Server, 
  Cpu, 
  Settings, 
  TrendingUp, 
  ShieldCheck, 
  Activity, 
  Terminal, 
  Key,
  ChevronRight,
  AlertCircle,
  Database,
  Globe,
  Zap
} from "lucide-react";
import { motion } from "motion/react";

interface LaunchpadProps {
  onNavigate: (view: "dashboard" | "launchpad", target?: string) => void;
  systemState: any;
}

export default function Launchpad({ onNavigate, systemState }: LaunchpadProps) {
  const settings = systemState?.settings || {};
  
  // Requirement Logic
  const aiConfigured = !!(settings.geminiApiKey || settings.openaiApiKey || settings.anthropicApiKey || settings.nvidiaApiKey || (settings.customAiApiKey && settings.customAiBaseUrl));
  const gcpConfigured = settings.ibkrAccountNumber && settings.ibkrAccountNumber !== "U8129384";
  const riskConfigured = settings.dailyDrawdownLimitCash > 0 && settings.dailyDrawdownLimitPercent > 0;
  
  const sections = [
    {
      id: "env",
      title: "Environment Setup",
      description: "Core workspace and persistence layer configuration.",
      icon: <Database className="w-5 h-5 text-blue-400" />,
      status: "Operational",
      statusColor: "text-emerald-400",
      actionRequired: false,
      navTarget: "system-control-center",
      details: [
        { label: "Storage", value: "Firestore Persistent", icon: <ShieldCheck className="w-3 h-3" /> },
        { label: "Workspace", value: "Alpha-Engine-Hybrid", icon: <Globe className="w-3 h-3" /> }
      ]
    },
    {
      id: "infra",
      title: "Server Infrastructure",
      description: "GCE Edge node & IBKR Gateway connection parameters.",
      icon: <Server className="w-5 h-5 text-purple-400" />,
      status: gcpConfigured ? "Configured" : "Awaiting Credentials",
      statusColor: gcpConfigured ? "text-emerald-400" : "text-amber-400",
      actionRequired: !gcpConfigured,
      navTarget: "config-ibkr-account",
      details: [
        { label: "Account", value: settings.ibkrAccountNumber || "Unset", icon: <Key className="w-3 h-3" /> },
        { label: "Gateway", value: settings.gatewayConnectionActive ? "Active" : "Disconnected", icon: <Activity className="w-3 h-3" /> }
      ]
    },
    {
      id: "ai",
      title: "AI Strategy Engine",
      description: "Universal model routing and geopolitical calibrators.",
      icon: <Cpu className="w-5 h-5 text-cyan-400" />,
      status: aiConfigured ? "Ready" : "API Keys Needed",
      statusColor: aiConfigured ? "text-emerald-400" : "text-amber-400",
      actionRequired: !aiConfigured,
      navTarget: "config-gemini-key",
      details: [
        { label: "Provider", value: settings.selectedAiProvider || "Gemini Flash", icon: <Zap className="w-3 h-3" /> },
        { label: "State", value: aiConfigured ? "Synchronized" : "Local Fallback", icon: <Terminal className="w-3 h-3" /> }
      ]
    },
    {
      id: "trading",
      title: "Trading Execution",
      description: "Live portfolio visualizer and tactical execution router.",
      icon: <TrendingUp className="w-5 h-5 text-emerald-400" />,
      status: "Ready to Deploy",
      statusColor: "text-emerald-400",
      actionRequired: !riskConfigured,
      navTarget: "active-trades-ledger",
      details: [
        { label: "Risk Model", value: "1% ATR Adaptive", icon: <ShieldCheck className="w-3 h-3" /> },
        { label: "Session", value: settings.marketPhase || "IDLE", icon: <Activity className="w-3 h-3" /> }
      ],
      primary: true
    }
  ];

  return (
    <div className="space-y-8 py-8 animate-in fade-in duration-500">
      {/* Hero Header */}
      <div className="text-center space-y-3 max-w-2xl mx-auto">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#00ff88]/5 border border-[#00ff88]/10 text-[#00ff88] text-[10px] font-mono tracking-widest uppercase font-bold"
        >
          <Activity className="w-3 h-3" />
          System Launchpad v1.4
        </motion.div>
        <motion.h1 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="text-4xl font-extrabold tracking-tight text-white sm:text-5xl"
        >
          The Alpha <span className="text-[#00ff88]">Engine</span>
        </motion.h1>
        <motion.p 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="text-slate-400 text-sm leading-relaxed"
        >
          Deploy modular hybrid trading architecture with co-located edge execution. 
          Monitor institutional risk and AI-calibrated baskets from a single control plane.
        </motion.p>
      </div>

      {/* Grid Layout */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 px-4">
        {sections.map((section, idx) => (
          <motion.div
            key={section.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 * (idx + 3) }}
            className={`group relative overflow-hidden rounded-2xl border transition-all duration-300 hover:scale-[1.02] cursor-pointer ${
              section.primary 
                ? "bg-slate-900/40 border-[#00ff88]/20 hover:border-[#00ff88]/40 shadow-lg shadow-[#00ff88]/5" 
                : "bg-slate-900/20 border-white/5 hover:border-white/10"
            }`}
            onClick={() => onNavigate("dashboard", section.navTarget)}
          >
            {/* Action Required Badge */}
            {section.actionRequired && (
              <div className="absolute top-4 right-4 flex items-center gap-1.5 px-2 py-1 rounded bg-amber-400/10 border border-amber-400/20 text-amber-400 text-[9px] font-mono font-bold animate-pulse">
                <AlertCircle className="w-3 h-3" />
                ACTION REQUIRED
              </div>
            )}

            <div className="p-6 space-y-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-white/5 border border-white/10 group-hover:bg-white/10 transition-colors">
                  {section.icon}
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white group-hover:text-[#00ff88] transition-colors">{section.title}</h3>
                  <div className={`text-[10px] font-mono font-bold ${section.statusColor}`}>
                    {section.status}
                  </div>
                </div>
              </div>

              <p className="text-[11px] text-slate-400 leading-relaxed h-8">
                {section.description}
              </p>

              <div className="pt-4 border-t border-white/5 space-y-2">
                {section.details.map((detail, dIdx) => (
                  <div key={dIdx} className="flex items-center justify-between text-[10px] font-mono">
                    <span className="text-slate-500 flex items-center gap-1.5">
                      {detail.icon}
                      {detail.label}
                    </span>
                    <span className="text-slate-300 font-bold">{detail.value}</span>
                  </div>
                ))}
              </div>

              <div className="pt-2 flex items-center justify-end text-[10px] font-bold text-[#00ff88] opacity-0 group-hover:opacity-100 transition-opacity">
                Configure Section
                <ChevronRight className="w-3 h-3 ml-1" />
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Global Status Footer */}
      <div className="flex items-center justify-center gap-8 text-[10px] font-mono text-slate-500 bg-slate-900/10 py-3 rounded-full border border-white/5 max-w-fit mx-auto px-8">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)] animate-pulse" />
          EDGE NODE: FRANKFURT (ACTIVE)
        </div>
        <div className="flex items-center gap-2 border-l border-white/10 pl-8">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)] animate-pulse" />
          FIRESTORE SYNC: CONNECTED
        </div>
        <div className="flex items-center gap-2 border-l border-white/10 pl-8">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.6)]" />
          PERSISTENCE: DURABLE
        </div>
      </div>
    </div>
  );
}
