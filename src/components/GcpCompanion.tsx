import React, { useState, useEffect } from "react";
import { 
  Cpu, 
  Globe, 
  ShieldCheck, 
  Layers, 
  Sliders
} from "lucide-react";

export const GcpCompanion: React.FC = () => {
  const [activeTab, setActiveTab] = useState<"ai" | "universe" | "audit">("ai");
  const [basketSize, setBasketSize] = useState(3);
  const [catalysts, setCatalysts] = useState<any[]>([]);

  useEffect(() => {
    fetch("/api/events/catalysts")
      .then(r => r.json())
      .then(d => setCatalysts(d.catalysts || []))
      .catch(e => console.error(e));
  }, []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="terminal-card p-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Cpu className="text-blue-500 dark:text-blue-400 w-6 h-6" />
          <h2 className="text-xl font-bold text-primary tracking-wide">QUANTITATIVE LAB & DASHBOARD</h2>
        </div>
        <div className="flex terminal-elevated rounded-lg p-1">
          <button 
            type="button"
            onClick={() => setActiveTab("ai")}
            className={`px-4 py-2 rounded-md text-sm font-bold transition-colors cursor-pointer ${activeTab === "ai" ? "bg-blue-600 text-white" : "text-secondary hover:text-primary"}`}
          >
            AI Intelligence
          </button>
          <button 
            type="button"
            onClick={() => setActiveTab("universe")}
            className={`px-4 py-2 rounded-md text-sm font-bold transition-colors cursor-pointer ${activeTab === "universe" ? "bg-blue-600 text-white" : "text-secondary hover:text-primary"}`}
          >
            Universe Manager
          </button>
          <button 
            type="button"
            onClick={() => setActiveTab("audit")}
            className={`px-4 py-2 rounded-md text-sm font-bold transition-colors cursor-pointer ${activeTab === "audit" ? "bg-blue-600 text-white" : "text-secondary hover:text-primary"}`}
          >
            Audit Dashboard
          </button>
        </div>
      </div>

      {/* AI Intelligence Tab */}
      {activeTab === "ai" && (
        <div className="terminal-card p-6 space-y-4">
          <h3 className="text-lg font-bold text-primary flex items-center gap-2">
            <Globe className="w-5 h-5 text-blue-500 dark:text-blue-400" />
            LLM Critic-Verifier Consensus
          </h3>
          <p className="text-secondary text-sm">Real-time ingestion of SEC EDGAR, ClinicalTrials, FDA, and Macro bulletins.</p>
          
          <div className="space-y-3">
            {catalysts.slice(0, 5).map((cat, i) => (
              <div key={i} className="terminal-elevated p-4 rounded flex flex-col gap-2">
                <div className="flex justify-between">
                  <span className="font-bold text-primary">{cat.symbol}</span>
                  <span className="text-xs terminal-card text-secondary px-2 py-1 rounded">{cat.source}</span>
                </div>
                <p className="text-sm text-secondary">{cat.headline}</p>
                {cat.riskGated && <span className="text-xs text-rose-500 dark:text-rose-400 font-semibold">Risk Gated: {cat.riskGateReason}</span>}
              </div>
            ))}
            {catalysts.length === 0 && <p className="text-muted italic">No catalysts ingested yet...</p>}
          </div>
        </div>
      )}

      {/* Universe Manager Tab */}
      {activeTab === "universe" && (
        <div className="terminal-card p-6 space-y-6">
          <h3 className="text-lg font-bold text-primary flex items-center gap-2">
            <Layers className="w-5 h-5 text-indigo-500 dark:text-indigo-400" />
            Dynamic Universe Manager
          </h3>
          
          <div className="terminal-elevated rounded-lg p-5">
            <div className="flex justify-between items-center mb-4">
              <label className="text-sm font-bold text-secondary flex items-center gap-2">
                <Sliders className="w-4 h-4 text-secondary" />
                Active Basket Size Slider
              </label>
              <span className="text-lg font-bold text-primary">{basketSize} Assets</span>
            </div>
            <input 
              type="range" 
              min="1" 
              max="15" 
              value={basketSize} 
              onChange={(e) => setBasketSize(parseInt(e.target.value))}
              className="w-full accent-indigo-500"
            />
            <p className="text-xs text-muted mt-2">Adjusts the Top N candidates routed from Pre-Market Calibration.</p>
          </div>
        </div>
      )}

      {/* Audit Dashboard Tab */}
      {activeTab === "audit" && (
        <div className="terminal-card p-6 space-y-4">
          <h3 className="text-lg font-bold text-primary flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-500 dark:text-emerald-400" />
            Reasoning Auditor
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="terminal-elevated rounded-lg p-4">
              <div className="text-sm text-secondary">Directional Hit Rate</div>
              <div className="text-2xl font-bold text-primary mt-1">68.4%</div>
            </div>
            <div className="terminal-elevated rounded-lg p-4">
              <div className="text-sm text-secondary">Brier Score</div>
              <div className="text-2xl font-bold text-primary mt-1">0.142</div>
            </div>
            <div className="terminal-elevated rounded-lg p-4">
              <div className="text-sm text-secondary">Average Slippage</div>
              <div className="text-2xl font-bold text-primary mt-1">1.8 bps</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
export default GcpCompanion;
