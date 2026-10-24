import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  MessageSquare,
  Sparkles,
  Send,
  Square,
  Trash2,
  Cpu,
  Shield,
  ShieldAlert,
  ArrowLeft,
  ChevronDown,
  Activity,
  DollarSign,
  Layers,
  CheckCircle2,
  Clock,
  Terminal,
  Zap,
  RefreshCw,
  ExternalLink,
  Copy,
  Check,
  AlertTriangle,
  Search,
  X
} from "lucide-react";

export interface CopilotMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  activeTools?: string[];
  telemetry?: {
    provider: string;
    model: string;
    model_name: string;
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    latency_ms: number;
    cost_usd: number;
    daily_spent_usd: number;
    daily_requests: number;
    daily_quota: number;
    circuit_breaker_active: boolean;
  };
}

interface ModelItem {
  id: string;
  rawId?: string;
  name: string;
  provider: string;
  tier: string;
  badge: string;
  costStr: string;
  icon: string;
  isFree?: boolean;
}

interface CopilotStats {
  daily_spent_usd: number;
  daily_requests: number;
  daily_quota: number;
  daily_budget_ceiling_usd: number;
  circuit_breaker_active: boolean;
  provider_counts: Record<string, number>;
}

import { ApiVaultModal } from "../components/ApiVaultModal";
import {
  getAllStoredVaultSettings,
  persistVaultItem,
  persistVaultBatch,
  syncVaultToServer,
  getStoredVaultValue
} from "../utils/vaultStorage";

// Offline default model (local CPU ONNX embedded in container)
const TIER0_OFFLINE_MODEL: ModelItem = {
  id: "local/finbert-int8",
  name: "INT8 ONNX FinBERT (CPU Offline)",
  provider: "Local Tier 0",
  tier: "Tier 0 Offline",
  badge: "$0 Cost / <15ms",
  costStr: "$0.00 (Offline)",
  icon: "🛡️",
  isFree: true
};

export function CopilotPage({ onNavigateHome }: { onNavigateHome?: () => void }) {
  const [availableModels, setAvailableModels] = useState<ModelItem[]>([TIER0_OFFLINE_MODEL]);
  const [isVaultOpen, setIsVaultOpen] = useState(false);
  const [vaultSettings, setVaultSettings] = useState<any>(() => getAllStoredVaultSettings());
  const [tradingMode, setTradingMode] = useState<"PAPER" | "LIVE">(() => {
    return (localStorage.getItem("alpha_trading_mode") as "PAPER" | "LIVE") || "PAPER";
  });

  const handleToggleTradingMode = async () => {
    const nextMode = tradingMode === "LIVE" ? "PAPER" : "LIVE";
    const nextPort = nextMode === "LIVE" ? 4001 : 4002;
    setTradingMode(nextMode);
    localStorage.setItem("alpha_trading_mode", nextMode);
    try {
      const adminKey = localStorage.getItem("alpha_operator_admin_key") || "ALPHA_ADMIN_REVERT_992";
      await fetch("/api/set-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-key": adminKey },
        body: JSON.stringify({ tradingMode: nextMode, ibkrPort: nextPort })
      });
      await fetch("/api/risk/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-key": adminKey },
        body: JSON.stringify({ tradingMode: nextMode })
      });
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("alpha_trading_mode_toggled", { detail: { mode: nextMode } }));
      }
    } catch (e) {
      console.warn("Could not sync trading mode:", e);
    }
  };

  const handleSaveSetting = async (key: string, value: any) => {
    persistVaultItem(key, value);
    setVaultSettings((prev: any) => ({ ...prev, [key]: value }));
    try {
      await fetch("/api/set-settings", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "x-admin-key": "ALPHA_ADMIN_REVERT_992"
        },
        body: JSON.stringify({ [key]: value }),
      });
      await fetchStatsAndModels(true);
    } catch (e) {
      console.warn("Could not persist setting to server:", e);
    }
  };

  const handleSaveMultipleSettings = async (updates: Record<string, any>) => {
    persistVaultBatch(updates);
    setVaultSettings((prev: any) => ({ ...prev, ...updates }));
    try {
      await syncVaultToServer(updates);
      await fetch("/api/copilot/models?refresh=1");
      await fetchStatsAndModels(true);
    } catch (e) {
      console.warn("Could not persist settings batch to server:", e);
    }
  };
  const [messages, setMessages] = useState<CopilotMessage[]>(() => {
    const saved = localStorage.getItem("alpha_copilot_messages");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.warn("Failed to parse saved copilot messages", e);
      }
    }
    return [
      {
        id: "welcome-1",
        role: "assistant",
        content: `### 🤖 AlphaEngine Institutional Trading Copilot

Welcome to your standalone conversational trading co-pilot. I am connected directly to:
- 🏛️ **Frankfurt GCE Edge Node** (\`10.156.0.2:4002\`) for live IBKR Pro portfolio & cash balances.
- 📋 **SEC EDGAR Submissions API** for real-time 8-K, 10-Q, 10-K, and Form 4 regulatory filings.
- 🧬 **ClinicalTrials.gov (API v2) & OpenFDA** for Phase II/III trial readouts and drug safety alerts.
- ⚡ **U.S. EIA Energy Telemetry** for real-time natural gas underground storage & petroleum prints.
- 🛡️ **Local Tier 0 INT8 ONNX FinBERT** for zero-cost, instant offline sentiment inference.

Click any quick query below or type your request:`,
        timestamp: new Date().toLocaleTimeString()
      }
    ];
  });

  const [input, setInput] = useState("");
  const [selectedModel, setSelectedModel] = useState<string>(() => {
    const saved = localStorage.getItem("alpha_copilot_model");
    if (saved) {
      return saved;
    }
    return "local/finbert-int8";
  });
  const [isGenerating, setIsGenerating] = useState(false);
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [modelSearchQuery, setModelSearchQuery] = useState("");
  const [selectedProviderFilter, setSelectedProviderFilter] = useState<string>("ALL");
  const [activeTools, setActiveTools] = useState<string[]>([]);
  const [stats, setStats] = useState<CopilotStats>({
    daily_spent_usd: 0.00041,
    daily_requests: 2,
    daily_quota: 1500,
    daily_budget_ceiling_usd: 1.00,
    circuit_breaker_active: false,
    provider_counts: { Groq: 0, "Google GenAI": 0, "NVIDIA NIM": 2, "Local Tier 0": 0 }
  });
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Sync messages with localStorage
  useEffect(() => {
    localStorage.setItem("alpha_copilot_messages", JSON.stringify(messages));
  }, [messages]);

  // Sync selected model
  useEffect(() => {
    localStorage.setItem("alpha_copilot_model", selectedModel);
  }, [selectedModel]);

  // Auto scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, activeTools]);

  // Fetch telemetry stats & dynamic model discovery
  const fetchStatsAndModels = async (force = false) => {
    try {
      const url = force ? "/api/copilot/stats?refresh=1" : "/api/copilot/stats";
      const gKey = vaultSettings.geminiApiKey || getStoredVaultValue("geminiApiKey");
      const qKey = vaultSettings.customAiApiKey || getStoredVaultValue("customAiApiKey");
      const nvKey = vaultSettings.nvidiaApiKey || getStoredVaultValue("nvidiaApiKey");
      const oaKey = vaultSettings.openaiApiKey || getStoredVaultValue("openaiApiKey");

      const res = await fetch(url, {
        headers: {
          "x-gemini-api-key": gKey || "",
          "x-groq-api-key": qKey || "",
          "x-nvidia-api-key": nvKey || "",
          "x-openai-api-key": oaKey || ""
        }
      });
      if (res.ok) {
        const data = await res.json();
        setStats({
          daily_spent_usd: data.daily_spent_usd || 0.0,
          daily_requests: data.daily_requests || 0,
          daily_quota: data.daily_quota || 1500,
          daily_budget_ceiling_usd: data.daily_budget_ceiling_usd || 1.0,
          circuit_breaker_active: !!data.circuit_breaker_active,
          provider_counts: data.provider_counts || {}
        });

        if (Array.isArray(data.models_catalog) && data.models_catalog.length > 0) {
          // Zero Synthetic Policy: Render live discovered provider catalog directly without string masking
          const cleanCatalog = data.models_catalog;
          setAvailableModels(cleanCatalog);
          // If online models were discovered, auto-select the best one if currently on offline fallback
          if (cleanCatalog.length > 1) {
            setSelectedModel((prev) => {
              if (prev === "local/finbert-int8" || !cleanCatalog.some((m: any) => m.id === prev)) {
                const online = cleanCatalog.find((m: any) => m.id !== "local/finbert-int8");
                return online ? online.id : prev;
              }
              return prev;
            });
          }
        }
      }
    } catch (e) {
      console.warn("Could not fetch copilot stats", e);
    }
  };

  useEffect(() => {
    // 1. Fetch centralized server credentials (guarantees access from any machine worldwide)
    fetch("/api/vault/credentials", {
      headers: { "x-admin-key": "ALPHA_ADMIN_REVERT_992" }
    })
      .then((r) => r.json())
      .then((creds) => {
        if (creds && typeof creds === "object") {
          setVaultSettings((prev: any) => ({ ...prev, ...creds }));
          fetchStatsAndModels(true);
        }
      })
      .catch(() => {});

    // 2. Re-hydrate any missing credentials from storage
    const currentStored = getAllStoredVaultSettings();
    setVaultSettings((prev: any) => ({ ...currentStored, ...prev }));

    fetchStatsAndModels(true);

    // Load initial settings from server, but NEVER overwrite real stored keys with empty or masked values
    fetch("/api/state")
      .then((r) => r.json())
      .then((data) => {
        if (data?.settings) {
          setVaultSettings((prev: any) => {
            const cleanServerSettings: Record<string, any> = {};
            for (const [k, v] of Object.entries(data.settings)) {
              if (v !== "" && v !== null && v !== undefined && v !== "configured") {
                cleanServerSettings[k] = v;
              }
            }
            return { ...cleanServerSettings, ...prev };
          });
        }
      })
      .catch(() => {});

    const interval = setInterval(() => fetchStatsAndModels(false), 10000);
    const handleInvalidated = () => {
      fetchStatsAndModels(true);
    };
    const handleVaultUpdated = (e: any) => {
      if (e?.detail) {
        setVaultSettings((prev: any) => ({ ...prev, ...e.detail }));
        fetchStatsAndModels(true);
      }
    };

    window.addEventListener("copilot:models_invalidated", handleInvalidated);
    window.addEventListener("alpha_vault_settings_updated", handleVaultUpdated);
    return () => {
      clearInterval(interval);
      window.removeEventListener("copilot:models_invalidated", handleInvalidated);
      window.removeEventListener("alpha_vault_settings_updated", handleVaultUpdated);
    };
  }, []);

  const handleSend = async (queryText?: string) => {
    const textToSend = (queryText !== undefined ? queryText : input).trim();
    if (!textToSend || isGenerating) return;

    setInput("");
    const userMsgId = `user-${Date.now()}`;
    const assistantMsgId = `assistant-${Date.now()}`;

    const userMessage: CopilotMessage = {
      id: userMsgId,
      role: "user",
      content: textToSend,
      timestamp: new Date().toLocaleTimeString()
    };

    const initialAssistantMessage: CopilotMessage = {
      id: assistantMsgId,
      role: "assistant",
      content: "",
      timestamp: new Date().toLocaleTimeString(),
      activeTools: []
    };

    setMessages((prev) => [...prev, userMessage, initialAssistantMessage]);
    setIsGenerating(true);
    setActiveTools([]);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    let receivedAnyText = false;

    try {
      // Sliding context window: filter out welcome banner and retain only the most recent 6 messages to prevent 413/429 quota exhaustion
      const slidingHistory = messages.filter((m) => m.id !== 'welcome-1').slice(-6);
      const payloadMessages = [...slidingHistory, userMessage].map((m) => ({
        role: m.role,
        content: m.content
      }));

      const storedVault = getAllStoredVaultSettings();
      const gKey = vaultSettings.geminiApiKey || storedVault.geminiApiKey || getStoredVaultValue("geminiApiKey") || "";
      const qKey = vaultSettings.customAiApiKey || storedVault.customAiApiKey || getStoredVaultValue("customAiApiKey") || "";
      const nvKey = vaultSettings.nvidiaApiKey || storedVault.nvidiaApiKey || getStoredVaultValue("nvidiaApiKey") || "";
      const oaKey = vaultSettings.openaiApiKey || storedVault.openaiApiKey || getStoredVaultValue("openaiApiKey") || "";
      const orKey = vaultSettings.openrouterApiKey || storedVault.openrouterApiKey || getStoredVaultValue("openrouterApiKey") || "";

      const res = await fetch("/api/copilot/chat", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "x-gemini-api-key": gKey || "",
          "x-groq-api-key": qKey || "",
          "x-nvidia-api-key": nvKey || "",
          "x-openai-api-key": oaKey || "",
          "x-openrouter-api-key": orKey || ""
        },
        body: JSON.stringify({
          messages: payloadMessages,
          model: selectedModel,
          rawId: activeModelObj.rawId || activeModelObj.id,
          temperature: 0.2,
          max_tokens: 2048,
          daily_budget_ceiling: stats.daily_budget_ceiling_usd,
          keys: {
            gemini: gKey,
            groq: qKey,
            nvidia: nvKey,
            openai: oaKey,
            openrouter: orKey
          }
        }),
        signal: controller.signal
      });

      if (!res.ok) {
        throw new Error(`Server returned ${res.status}: ${res.statusText}`);
      }

      if (!res.body) {
        throw new Error("No response body received from copilot API.");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";

        for (const part of parts) {
          if (!part.trim()) continue;
          const lines = part.split("\n");
          let eventType = "delta";
          const dataLines: string[] = [];

          for (const line of lines) {
            if (line.startsWith("event: ")) {
              eventType = line.slice(7).trim();
            } else if (line.startsWith("data: ")) {
              dataLines.push(line.slice(6));
            } else if (line.startsWith("data:")) {
              dataLines.push(line.slice(5));
            } else if (dataLines.length > 0) {
              dataLines.push(line);
            }
          }

          const dataStr = dataLines.join("\n").trim();
          if (!dataStr) continue;

          if (eventType === "tool_call") {
            try {
              const parsed = JSON.parse(dataStr);
              setActiveTools((prev) => [...prev, parsed.tool]);
            } catch (e) {}
          } else if (eventType === "delta") {
            let chunk = "";
            try {
              const parsed = JSON.parse(dataStr);
              chunk = typeof parsed === "string" ? parsed : (parsed.content || parsed.message || "");
            } catch (e) {
              chunk = dataStr;
            }
            if (chunk) {
              receivedAnyText = true;
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantMsgId ? { ...msg, content: msg.content + chunk } : msg
                )
              );
            }
          } else if (eventType === "telemetry") {
            try {
              const tel = JSON.parse(dataStr);
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantMsgId ? { ...msg, telemetry: tel } : msg
                )
              );
              fetchStatsAndModels();
            } catch (e) {}
          }
        }
      }

      // If stream ended with zero text, provide accurate notice
      if (!receivedAnyText) {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMsgId && !msg.content
              ? {
                  ...msg,
                  content: `> ⚠️ **Provider Notice**: The selected model (\`${selectedModel}\`) returned no output. Please verify that the provider API key is active in the **4-Pillar Vault**, or select a verified active model like **Local Tier 0 FinBERT** or **NVIDIA Llama-3.2-11B**.`
                }
              : msg
          )
        );
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMsgId
              ? {
                  ...msg,
                  content:
                    msg.content +
                    `\n\n> ❌ **Execution Error**: ${err.message || "Failed to complete stream."}`
                }
              : msg
          )
        );
      }
    } finally {
      setIsGenerating(false);
      setActiveTools([]);
      abortControllerRef.current = null;
    }
  };

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsGenerating(false);
      setActiveTools([]);
    }
  };

  const handleClearHistory = () => {
    if (confirm("Clear conversational history?")) {
      setMessages([
        {
          id: "welcome-1",
          role: "assistant",
          content: "### 🤖 Copilot Memory Reset\n\nSession history cleared. Ask any query to initiate a new analysis.",
          timestamp: new Date().toLocaleTimeString()
        }
      ]);
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Markdown Simple Renderer for tables and styling
  const renderMarkdown = (text: string) => {
    if (!text || text.trim() === "") {
      return (
        <div className="flex items-center gap-2 text-xs text-slate-400 py-1">
          <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#00ff88]" />
          <span>Synthesizing response from verified institutional tools...</span>
        </div>
      );
    }

    if (!text.includes("|")) {
      return (
        <div className="whitespace-pre-wrap leading-relaxed text-sm text-slate-200 font-sans">
          {text}
        </div>
      );
    }

    const lines = text.split("\n");
    const elements: React.ReactNode[] = [];
    let tableLines: string[] = [];
    let inTable = false;

    const flushTable = (key: number) => {
      if (tableLines.length < 2) {
        elements.push(
          <div key={`txt-${key}`} className="whitespace-pre-wrap leading-relaxed text-sm text-slate-200">
            {tableLines.join("\n")}
          </div>
        );
        tableLines = [];
        return;
      }

      const headers = tableLines[0]
        .split("|")
        .map((h) => h.trim())
        .filter((h) => h.length > 0);

      const rows = tableLines.slice(2).map((rowStr) =>
        rowStr
          .split("|")
          .map((c) => c.trim())
          .filter((c, idx, arr) => idx > 0 && idx < arr.length)
      );

      elements.push(
        <div key={`tbl-${key}`} className="my-3 overflow-x-auto rounded-lg border border-white/10 shadow-lg">
          <table className="w-full text-xs font-mono text-left border-collapse">
            <thead className="bg-slate-900/90 text-slate-200 uppercase tracking-wider border-b border-white/10">
              <tr>
                {headers.map((h, i) => (
                  <th key={i} className="py-2.5 px-3 font-bold border-r border-white/5 last:border-none">
                    {h.replace(/\*\*/g, "")}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 bg-slate-950/60">
              {rows.map((r, ri) => (
                <tr key={ri} className="hover:bg-white/5 transition-colors">
                  {r.map((cell, ci) => {
                    const isProfit = cell.includes("+$");
                    const isLoss = cell.includes("-$");
                    return (
                      <td
                        key={ci}
                        className={`py-2 px-3 border-r border-white/5 last:border-none ${
                          isProfit ? "text-emerald-400 font-bold" : isLoss ? "text-rose-400 font-bold" : "text-slate-300"
                        }`}
                      >
                        {cell.replace(/\*\*/g, "").replace(/`/g, "")}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      tableLines = [];
    };

    lines.forEach((line, idx) => {
      if (line.trim().startsWith("|") && line.trim().endsWith("|")) {
        inTable = true;
        tableLines.push(line);
      } else {
        if (inTable) {
          flushTable(idx);
          inTable = false;
        }
        if (line.startsWith("### ")) {
          elements.push(
            <h3 key={idx} className="text-base font-bold text-white mt-4 mb-2 flex items-center gap-2">
              {line.replace("### ", "")}
            </h3>
          );
        } else if (line.startsWith("#### ")) {
          elements.push(
            <h4 key={idx} className="text-sm font-bold text-[#00ff88] mt-3 mb-1.5">
              {line.replace("#### ", "")}
            </h4>
          );
        } else if (line.startsWith("- ")) {
          elements.push(
            <li key={idx} className="ml-4 text-xs text-slate-300 my-1 list-disc">
              {line.replace("- ", "")}
            </li>
          );
        } else if (line.trim().length > 0) {
          elements.push(
            <p key={idx} className="text-xs text-slate-300 my-1 font-sans leading-relaxed">
              {line}
            </p>
          );
        }
      }
    });

    if (inTable) {
      flushTable(lines.length);
    }

    return <div className="space-y-1">{elements}</div>;
  };

  const filteredModels = useMemo(() => {
    return availableModels.filter((m) => {
      if (selectedProviderFilter !== "ALL") {
        if (selectedProviderFilter === "FREE") {
          const isFree = m.isFree === true || m.id.includes(":free") || m.costStr.includes("$0.00") || m.id.startsWith("local");
          if (!isFree) return false;
        } else if (selectedProviderFilter === "LOCAL" && !m.id.startsWith("local")) {
          return false;
        } else if (selectedProviderFilter === "OPENROUTER" && !m.id.startsWith("openrouter")) {
          return false;
        } else if (selectedProviderFilter === "NVIDIA" && !m.id.startsWith("nvidia")) {
          return false;
        } else if (selectedProviderFilter === "GOOGLE" && !m.id.startsWith("google")) {
          return false;
        } else if (selectedProviderFilter === "GROQ" && !m.id.startsWith("groq")) {
          return false;
        } else if (selectedProviderFilter === "OPENAI" && !m.id.startsWith("openai")) {
          return false;
        }
      }
      if (modelSearchQuery.trim()) {
        const q = modelSearchQuery.toLowerCase();
        return (
          m.name.toLowerCase().includes(q) ||
          m.id.toLowerCase().includes(q) ||
          m.provider.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [availableModels, selectedProviderFilter, modelSearchQuery]);

  const activeModelObj = availableModels.find((m) => m.id === selectedModel) || availableModels[0];
  const quotaPct = Math.min(100, Math.round((stats.daily_requests / stats.daily_quota) * 100));

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-[#00ff88]/30 selection:text-white">
      {/* Institutional Top Header */}
      <header className="sticky top-0 z-40 bg-slate-950/95 backdrop-blur-md border-b border-white/10 px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {onNavigateHome && (
            <button
              onClick={onNavigateHome}
              className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 hover:text-white transition cursor-pointer"
              title="Return to Dashboard"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          <div className="p-2 rounded-lg bg-[#00ff88]/10 border border-[#00ff88]/20 text-[#00ff88]">
            <Sparkles className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm sm:text-base font-extrabold tracking-tight text-white uppercase flex items-center gap-1.5">
                ALPHA ENGINE <span className="text-[#00ff88]">COPILOT</span>
              </h1>
              <span className="px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-mono text-[10px] font-bold">
                STANDALONE AD-HOC
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2.5 mt-1 font-mono text-[11px]">
              <button
                type="button"
                onClick={handleToggleTradingMode}
                className={`px-2.5 py-0.5 rounded text-xs font-bold border transition cursor-pointer flex items-center gap-1.5 shadow-sm active:scale-95 ${
                  tradingMode === "LIVE"
                    ? "bg-rose-600 hover:bg-rose-500 text-white border-rose-400 animate-pulse"
                    : "bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border-amber-500/40"
                }`}
                title="Click to toggle execution lane between PAPER (4002) and LIVE (4001)"
              >
                <span>{tradingMode === "LIVE" ? "🔴 LIVE PRODUCTION (PORT: 4001)" : "🟡 PAPER SIMULATION (PORT: 4002)"}</span>
                <span className="text-[10px] uppercase underline opacity-80">SWITCH</span>
              </button>
              <span className="text-slate-400">
                Host: <strong className="text-white">{vaultSettings?.ibkrHost || "127.0.0.1"}</strong>
              </span>
              <span className="text-emerald-400 font-bold">• EDGE ACTIVE</span>
            </div>
          </div>
        </div>

        {/* Cost Governance Header Telemetry Bar */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Daily Quota Meter */}
          <div className="bg-slate-900/90 border border-white/10 rounded-lg px-3 py-1.5 flex items-center gap-2.5 text-xs font-mono">
            <Activity className="w-3.5 h-3.5 text-indigo-400" />
            <div>
              <div className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">Today's Quota</div>
              <div className="text-white font-bold flex items-center gap-1.5">
                <span>{stats.daily_requests} / {stats.daily_quota.toLocaleString()}</span>
                <span className={`text-[10px] px-1 rounded ${quotaPct > 80 ? "bg-amber-500/20 text-amber-300" : "bg-emerald-500/20 text-emerald-300"}`}>
                  {quotaPct}%
                </span>
              </div>
            </div>
          </div>

          {/* Daily Cumulative Spent */}
          <div className="bg-slate-900/90 border border-white/10 rounded-lg px-3 py-1.5 flex items-center gap-2.5 text-xs font-mono">
            <DollarSign className="w-3.5 h-3.5 text-[#00ff88]" />
            <div>
              <div className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">Daily Estimated Cost</div>
              <div className="text-[#00ff88] font-bold">
                ${stats.daily_spent_usd.toFixed(4)}
              </div>
            </div>
          </div>

          {/* Circuit Breaker Ceiling Badge */}
          <div className={`border rounded-lg px-3 py-1.5 flex items-center gap-2 text-xs font-mono ${
            stats.circuit_breaker_active
              ? "bg-rose-950/80 border-rose-500/50 text-rose-300 animate-pulse"
              : "bg-slate-900/90 border-white/10 text-slate-300"
          }`}>
            <Shield className={`w-3.5 h-3.5 ${stats.circuit_breaker_active ? "text-rose-400" : "text-blue-400"}`} />
            <div>
              <div className="text-[10px] uppercase tracking-wider opacity-75">Ceiling: ${stats.daily_budget_ceiling_usd.toFixed(2)}</div>
              <div className="font-bold text-[11px]">
                {stats.circuit_breaker_active ? "THROTTLED (CIRCUIT BREAKER)" : "CIRCUIT BREAKER: ARMED"}
              </div>
            </div>
          </div>

          {/* Direct 4-Pillar Key Vault Access Button */}
          <button
            onClick={() => setIsVaultOpen(true)}
            className="bg-indigo-950/70 hover:bg-indigo-900 border border-indigo-500/40 text-indigo-300 hover:text-white rounded-lg px-3 py-1.5 flex items-center gap-2 text-xs font-mono transition cursor-pointer shadow-md"
            title="Open 4-Pillar Connection & Feed Vault to configure Cloud LLMs, IBKR, and Market Feeds"
          >
            <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
            <span className="font-bold">4-Pillar Vault</span>
          </button>

          {/* Active Model Selector Dropdown with Dynamic Discovery */}
          <div className="relative">
            <button
              onClick={() => setShowModelDropdown(!showModelDropdown)}
              className="bg-slate-900 hover:bg-slate-800 border border-[#00ff88]/30 rounded-lg px-3 py-1.5 flex items-center gap-2 text-xs font-mono transition cursor-pointer shadow-md"
            >
              <span>{activeModelObj.icon}</span>
              <div className="text-left">
                <div className="text-[9px] text-[#00ff88] font-bold uppercase">{activeModelObj.provider}</div>
                <div className="text-white font-bold max-w-[170px] truncate">{activeModelObj.name}</div>
              </div>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 ml-1" />
            </button>

            {showModelDropdown && (
              <div className="absolute right-0 mt-2 w-[420px] max-w-[90vw] bg-[#0e1422] border border-white/15 rounded-xl shadow-2xl p-3 z-50 animate-fade-in font-mono text-xs">
                {/* Catalog Header */}
                <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-white/10 mb-2 flex items-center justify-between">
                  <span>Dynamic Model Catalog</span>
                  <span className="text-[9px] text-[#00ff88] bg-[#00ff88]/10 px-1.5 py-0.5 rounded border border-[#00ff88]/20 font-bold">
                    {availableModels.length} Active Verified
                  </span>
                </div>

                {/* Instant Search Bar */}
                <div className="relative mb-2">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={modelSearchQuery}
                    onChange={(e) => setModelSearchQuery(e.target.value)}
                    placeholder="Search model name, provider, or size..."
                    className="w-full bg-slate-900 border border-white/10 rounded-lg pl-8 pr-7 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#00ff88]/50"
                  />
                  {modelSearchQuery && (
                    <button
                      type="button"
                      onClick={() => setModelSearchQuery("")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Provider Filter Tabs */}
                <div className="flex items-center gap-1 mb-2 pb-2 border-b border-white/10 overflow-x-auto text-[10px]">
                  {["ALL", "FREE", "OPENROUTER", "GROQ", "NVIDIA", "GOOGLE", "LOCAL"].map((tab) => {
                    const count = tab === "ALL" 
                      ? availableModels.length 
                      : tab === "FREE"
                        ? availableModels.filter(m => m.isFree === true || m.id.includes(":free") || m.costStr.includes("$0.00") || m.id.startsWith("local")).length
                        : availableModels.filter(m => m.id.toUpperCase().startsWith(tab) || m.provider.toUpperCase().includes(tab)).length;
                    return (
                      <button
                        key={tab}
                        type="button"
                        onClick={() => setSelectedProviderFilter(tab)}
                        className={`px-2 py-0.5 rounded transition cursor-pointer font-bold whitespace-nowrap flex items-center gap-1 ${
                          selectedProviderFilter === tab
                            ? tab === "FREE"
                              ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                              : "bg-[#00ff88]/20 text-[#00ff88] border border-[#00ff88]/40"
                            : "bg-white/5 hover:bg-white/10 text-slate-400"
                        }`}
                      >
                        <span>{tab === "FREE" ? "🎁 FREE ONLY" : tab}</span>
                        <span className="text-[9px] opacity-75">({count})</span>
                      </button>
                    );
                  })}
                </div>

                {/* Fast Access / Recommended Section (When No Search Query) */}
                {!modelSearchQuery.trim() && selectedProviderFilter === "ALL" && (
                  <div className="mb-2 pb-2 border-b border-white/10 space-y-1">
                    <div className="text-[10px] font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1 px-1">
                      <span>⭐</span>
                      <span>Recommended & Tested Active</span>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {availableModels.filter(m => 
                        m.id === "local/finbert-int8" || 
                        m.id.includes("llama-3.2-11b-vision") || 
                        m.id.includes("qwen3.8-27b") || 
                        m.id.includes("gpt-oss-120b")
                      ).map(m => (
                        <button
                          key={`rec-${m.id}`}
                          type="button"
                          onClick={() => {
                            setSelectedModel(m.id);
                            setShowModelDropdown(false);
                          }}
                          className={`p-1.5 rounded-lg border text-left flex items-center gap-1.5 transition cursor-pointer ${
                            selectedModel === m.id
                              ? "bg-[#00ff88]/20 border-[#00ff88] text-white"
                              : "bg-white/5 hover:bg-white/10 border-white/10 text-slate-300"
                          }`}
                        >
                          <span className="text-xs">{m.icon}</span>
                          <div className="truncate min-w-0">
                            <div className="text-[10px] font-bold truncate text-white">{m.name.split("/").pop()}</div>
                            <div className="text-[9px] text-[#00ff88]">{m.badge}</div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Scrollable Model List */}
                <div className="max-h-72 overflow-y-auto space-y-1 pr-1">
                  {filteredModels.length === 0 ? (
                    <div className="text-center py-6 text-slate-400 text-xs">
                      No models matching "{modelSearchQuery}"
                    </div>
                  ) : (
                    filteredModels.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => {
                          setSelectedModel(m.id);
                          setShowModelDropdown(false);
                          setModelSearchQuery("");
                        }}
                        className={`w-full text-left p-2 rounded-lg flex items-start gap-2.5 transition cursor-pointer ${
                          selectedModel === m.id
                            ? "bg-[#00ff88]/15 border border-[#00ff88]/40 text-white"
                            : "hover:bg-white/5 text-slate-300"
                        }`}
                      >
                        <span className="text-base shrink-0">{m.icon}</span>
                        <div className="flex-1 min-w-0">
                          <div className="font-bold text-white truncate flex items-center justify-between">
                            <span className="truncate" title={m.name}>{m.name}</span>
                            <div className="flex items-center gap-1.5 shrink-0 ml-2">
                              {(m.isFree || m.id.includes(":free")) && (
                                <span className="text-[9px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-1.5 py-0.2 rounded font-mono font-bold">
                                  FREE
                                </span>
                              )}
                              {selectedModel === m.id && <Check className="w-3.5 h-3.5 text-[#00ff88] shrink-0" />}
                            </div>
                          </div>
                          <div className="text-[10px] text-slate-400 flex items-center gap-1.5 mt-0.5">
                            <span className="text-indigo-400 font-bold">{m.provider}</span>
                            <span>•</span>
                            <span className="text-slate-300">{m.costStr}</span>
                          </div>
                        </div>
                      </button>
                    ))
                  )}
                </div>

                {/* Vault Config Button Footer */}
                <div className="mt-2 pt-2 border-t border-white/10">
                  <button
                    type="button"
                    onClick={() => {
                      setShowModelDropdown(false);
                      setIsVaultOpen(true);
                    }}
                    className="w-full p-2 rounded-lg bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/30 text-indigo-300 text-[11px] font-mono font-bold flex items-center justify-center gap-1.5 transition cursor-pointer"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Manage Keys in 4-Pillar Vault</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Chat Workspace */}
      <div className="flex-1 max-w-5xl w-full mx-auto p-4 sm:p-6 flex flex-col justify-between">
        {/* Messages Feed */}
        <div className="space-y-4 mb-4">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}
            >
              <div className="flex items-center gap-2 mb-1 px-1 text-[11px] font-mono text-slate-400">
                {msg.role === "user" ? (
                  <>
                    <span>OPERATOR</span>
                    <span>•</span>
                    <span>{msg.timestamp}</span>
                  </>
                ) : (
                  <>
                    <span className="text-[#00ff88] font-bold">ALPHA COPILOT</span>
                    <span>•</span>
                    <span>{msg.timestamp}</span>
                  </>
                )}
              </div>

              {/* Message Bubble */}
              <div
                className={`rounded-2xl p-4 sm:p-5 max-w-[90%] sm:max-w-[85%] border shadow-lg relative group ${
                  msg.role === "user"
                    ? "bg-indigo-950/40 border-indigo-500/30 text-white rounded-tr-none"
                    : "bg-slate-900/80 border-white/10 text-slate-100 rounded-tl-none"
                }`}
              >
                {/* Copy Button */}
                <button
                  onClick={() => copyToClipboard(msg.content, msg.id)}
                  className="absolute top-3 right-3 p-1 rounded bg-black/40 hover:bg-black/60 text-slate-400 hover:text-white transition opacity-0 group-hover:opacity-100 cursor-pointer"
                  title="Copy message"
                >
                  {copiedId === msg.id ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                </button>

                {/* Content */}
                {renderMarkdown(msg.content)}

                {msg.content.includes("4-Pillar") && (
                  <div className="mt-3 pt-2 border-t border-white/5">
                    <button
                      onClick={() => setIsVaultOpen(true)}
                      className="px-3 py-1.5 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/40 text-indigo-300 hover:text-white font-mono text-xs font-bold flex items-center gap-2 transition cursor-pointer"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                      <span>Open 4-Pillar Connection & Feed Vault</span>
                    </button>
                  </div>
                )}

                {/* Per-Message Telemetry Badge */}
                {msg.telemetry && (
                  <div className="mt-4 pt-3 border-t border-white/10 flex flex-wrap items-center gap-2 text-[10px] font-mono text-slate-400">
                    <span className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-slate-300 font-bold">
                      {msg.telemetry.provider} • {msg.telemetry.model_name}
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-indigo-500/10 border border-indigo-500/20 text-indigo-300">
                      {msg.telemetry.total_tokens} tokens ({msg.telemetry.prompt_tokens}p / {msg.telemetry.completion_tokens}c)
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-[#00ff88]/10 border border-[#00ff88]/20 text-[#00ff88] font-bold">
                      ${msg.telemetry.cost_usd.toFixed(5)}
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                      {msg.telemetry.latency_ms}ms latency
                    </span>
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Active Tool Execution Indicator */}
          {activeTools.length > 0 && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-slate-900/90 border border-[#00ff88]/30 max-w-md animate-pulse">
              <RefreshCw className="w-4 h-4 text-[#00ff88] animate-spin" />
              <div className="text-xs font-mono text-slate-300">
                <span className="text-[#00ff88] font-bold">Executing Tools: </span>
                {activeTools.map((t) => (
                  <span key={t} className="px-1.5 py-0.5 mx-1 rounded bg-black/50 border border-white/10 text-white font-bold">
                    {t}()
                  </span>
                ))}
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Quick Query Recommendation Pills */}
        <div className="pt-2 pb-3">
          <div className="text-[10px] font-mono text-slate-400 mb-2 uppercase tracking-wider font-semibold">
            Institutional Tool Presets
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              "What is my ibkr cash balance?",
              "What are my current IBKR positions and cash balance?",
              "What are the latest SEC filings for NVDA?",
              "Show me recent FDA alerts or Phase 3 trial updates.",
              "Check U.S. EIA energy storage telemetry for natural gas."
            ].map((preset, idx) => (
              <button
                key={idx}
                onClick={() => handleSend(preset)}
                disabled={isGenerating}
                className="px-3 py-1.5 rounded-lg bg-slate-900/90 hover:bg-slate-800 border border-white/10 hover:border-[#00ff88]/40 text-xs font-mono text-slate-300 hover:text-white transition cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
              >
                <Terminal className="w-3 h-3 text-[#00ff88]" />
                <span>{preset}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Chat Input Console */}
        <div className="sticky bottom-4 bg-[#0e1422]/95 backdrop-blur-md border border-white/15 rounded-2xl p-2.5 shadow-2xl flex flex-col gap-2">
          <div className="flex items-center justify-between px-2 text-[10px] font-mono text-slate-400">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>ACTIVE: <strong className="text-white">{activeModelObj.name}</strong></span>
            </div>
            <button
              onClick={handleClearHistory}
              className="hover:text-rose-400 transition cursor-pointer flex items-center gap-1"
              title="Clear conversational memory"
            >
              <Trash2 className="w-3 h-3" />
              <span>Reset Context</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Ask an ad-hoc portfolio question, SEC filing check, or clinical trial query..."
              rows={1}
              className="flex-1 bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-xs sm:text-sm font-sans text-white placeholder:text-slate-500 focus:outline-none focus:border-[#00ff88]/50 resize-none"
            />

            {isGenerating ? (
              <button
                onClick={handleStop}
                className="p-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white transition cursor-pointer shadow-lg flex items-center justify-center"
                title="Stop generation"
              >
                <Square className="w-4 h-4 fill-current" />
              </button>
            ) : (
              <button
                onClick={() => handleSend()}
                disabled={!input.trim()}
                className="p-3 rounded-xl bg-[#00ff88] hover:bg-[#00ff88]/80 text-black transition cursor-pointer shadow-lg shadow-[#00ff88]/20 flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed font-bold"
                title="Send query"
              >
                <Send className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 4-Pillar API Connection & Feed Vault Modal */}
      <ApiVaultModal
        isOpen={isVaultOpen}
        onClose={() => {
          setIsVaultOpen(false);
          fetchStatsAndModels(true);
        }}
        settings={vaultSettings}
        onSaveSetting={handleSaveSetting}
        onSaveMultipleSettings={handleSaveMultipleSettings}
        customGeminiApiKey={vaultSettings.geminiApiKey || ""}
        onSaveGeminiKey={(k) => handleSaveSetting("geminiApiKey", k)}
      />
    </div>
  );
}

export default CopilotPage;
