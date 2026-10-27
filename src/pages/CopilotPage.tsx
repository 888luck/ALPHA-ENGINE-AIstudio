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
  SlidersHorizontal,
  X,
  ArrowDown,
  Maximize2,
  Minimize2
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
import { InstitutionalModelSelector, getProviderIcon, isModelConfiguredDefault } from "../components/InstitutionalModelSelector";
import {
  getAllStoredVaultSettings,
  persistVaultItem,
  persistVaultBatch,
  syncVaultToServer,
  getStoredVaultValue
} from "../utils/vaultStorage";
import { getAdminHeaders } from "../utils/auth";

// Offline default model (local CPU ONNX embedded in container)
const TIER0_OFFLINE_MODEL: ModelItem = {
  id: "local/tier0-encoder",
  name: "Tier 0 Institutional Encoder (CPU Offline)",
  provider: "Local Tier 0",
  tier: "Tier 0 Offline",
  badge: "$0 Cost / <15ms",
  costStr: "$0.00 (Offline)",
  icon: "🛡️",
  isFree: true
};

export interface CopilotPageProps {
  onNavigateHome?: () => void;
  onNavigate?: (view: "mission-control" | "blotter" | "risk" | "lab" | "config" | "copilot" | "studio", target?: string) => void;
}

export function CopilotPage({ onNavigateHome, onNavigate }: CopilotPageProps = {}) {
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
      await fetch("/api/set-settings", {
        method: "POST",
        headers: getAdminHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ tradingMode: nextMode, ibkrPort: nextPort })
      });
      await fetch("/api/risk/settings", {
        method: "POST",
        headers: getAdminHeaders({ "Content-Type": "application/json" }),
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
        headers: getAdminHeaders({ "Content-Type": "application/json" }),
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
- 🛡️ **Local Tier 0 Institutional Encoder** for zero-cost, instant offline sentiment inference.

Click any quick query below or type your request:`,
        timestamp: new Date().toLocaleTimeString()
      }
    ];
  });

  const [input, setInput] = useState("");
  const [selectedModel, setSelectedModel] = useState<string>(() => {
    const saved = localStorage.getItem("alpha_copilot_model");
    if (saved && saved !== "local/finbert-int8") {
      return saved;
    }
    return "local/tier0-encoder";
  });
  const activeModelObj = availableModels.find((m) => m.id === selectedModel) || availableModels[0] || TIER0_OFFLINE_MODEL;
  const [isGenerating, setIsGenerating] = useState(false);
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
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);
  const [showScrollBottomBtn, setShowScrollBottomBtn] = useState(false);
  const [isExpandedInput, setIsExpandedInput] = useState(false);

  // Sync messages with localStorage (debounced during active generation to prevent I/O blocking)
  useEffect(() => {
    if (isGenerating) {
      const timer = setTimeout(() => {
        localStorage.setItem("alpha_copilot_messages", JSON.stringify(messages));
      }, 800);
      return () => clearTimeout(timer);
    } else {
      localStorage.setItem("alpha_copilot_messages", JSON.stringify(messages));
    }
  }, [messages, isGenerating]);

  // Sync selected model
  useEffect(() => {
    localStorage.setItem("alpha_copilot_model", selectedModel);
  }, [selectedModel]);

  // Dynamic auto-expanding height for textarea based on user typing
  const adjustTextareaHeight = () => {
    const el = textareaRef.current;
    if (!el) return;
    if (isExpandedInput) {
      el.style.height = "220px";
      return;
    }
    el.style.height = "auto";
    const minHeight = 44;
    const maxHeight = 200; // up to ~8-9 lines before enabling internal scroll
    const newHeight = Math.min(Math.max(el.scrollHeight, minHeight), maxHeight);
    el.style.height = `${newHeight}px`;
  };

  useEffect(() => {
    adjustTextareaHeight();
  }, [input, isExpandedInput]);

  // Scroll to bottom helper
  const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
    const container = messagesContainerRef.current;
    if (!container) return;
    if (behavior === "auto") {
      container.scrollTop = container.scrollHeight;
    } else {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: "smooth"
      });
    }
  };

  // User scroll listener to detect if they intentionally scrolled up
  const handleScroll = () => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const { scrollTop, scrollHeight, clientHeight } = container;
    const distanceFromBottom = scrollHeight - (scrollTop + clientHeight);
    const isUp = distanceFromBottom > 70;
    setIsUserScrolledUp(isUp);
    setShowScrollBottomBtn(isUp);
  };

  // Auto-scroll: only when user has NOT scrolled up intentionally
  useEffect(() => {
    if (isUserScrolledUp) return;
    const container = messagesContainerRef.current;
    if (!container) return;

    if (isGenerating) {
      // Instant scrollTop during streaming SSE eliminates animation frame collision & page stutter
      container.scrollTop = container.scrollHeight;
    } else {
      // Smooth scroll on turn completion / new message creation
      scrollToBottom("smooth");
    }
  }, [messages, activeTools, isGenerating, isUserScrolledUp]);

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
              if (prev === "local/tier0-encoder" || prev === "local/finbert-int8" || !cleanCatalog.some((m: any) => m.id === prev)) {
                const online = cleanCatalog.find((m: any) => m.id !== "local/tier0-encoder" && m.id !== "local/finbert-int8");
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
      headers: getAdminHeaders()
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
    setIsUserScrolledUp(false);
    if (textareaRef.current) {
      textareaRef.current.style.height = "44px";
    }
    setTimeout(() => scrollToBottom("smooth"), 40);

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
                  content: `> ⚠️ **Provider Notice**: The selected model (\`${selectedModel}\`) returned no output. Please verify that the provider API key is active in the **4-Pillar Vault**, or select a verified active model like **Local Tier 0 Encoder** or **NVIDIA Llama-3.2-11B**.`
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
        <div key={`tbl-${key}`} className="my-3 overflow-x-auto rounded-lg border terminal-border shadow-md">
          <table className="w-full text-xs font-mono text-left border-collapse">
            <thead className="terminal-elevated text-secondary uppercase tracking-wider border-b terminal-border">
              <tr>
                {headers.map((h, i) => (
                  <th key={i} className="py-2.5 px-3 font-bold border-r terminal-border last:border-none">
                    {h.replace(/\*\*/g, "")}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y terminal-border terminal-card">
              {rows.map((r, ri) => (
                <tr key={ri} className="hover:bg-slate-500/5 transition-colors">
                  {r.map((cell, ci) => {
                    const isProfit = cell.includes("+$");
                    const isLoss = cell.includes("-$");
                    return (
                      <td
                        key={ci}
                        className={`py-2 px-3 border-r terminal-border last:border-none ${
                          isProfit ? "text-emerald-500 dark:text-[#00ff88] font-bold" : isLoss ? "text-rose-500 dark:text-rose-400 font-bold" : "text-secondary"
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

  const quotaPct = Math.min(100, Math.round((stats.daily_requests / stats.daily_quota) * 100));

  return (
    <div className="space-y-4 font-sans text-primary">
      {/* Institutional Copilot Executive Telemetry Ribbon */}
      <div className="terminal-card border terminal-border rounded-2xl p-4 sm:p-5 flex flex-wrap items-center justify-between gap-4 shadow-xl">
        <div className="flex items-center gap-3">
          {(onNavigateHome || onNavigate) && (
            <button
              type="button"
              onClick={() => onNavigate ? onNavigate("mission-control") : (onNavigateHome ? onNavigateHome() : undefined)}
              className="p-1.5 rounded-lg terminal-elevated hover:border-accent text-secondary hover:text-primary transition cursor-pointer"
              title="Return to Mission Control"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          <div className="p-2 rounded-lg terminal-badge-bid">
            <Sparkles className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm sm:text-base font-extrabold tracking-tight text-primary uppercase flex items-center gap-1.5">
                ALPHA ENGINE <span className="text-emerald-500 dark:text-[#00ff88]">COPILOT</span>
              </h1>
              <span className="px-2 py-0.5 rounded terminal-badge-bid font-mono text-[10px] font-bold">
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
                    : "terminal-badge-warn"
                }`}
                title="Click to toggle execution lane between PAPER (4002) and LIVE (4001)"
              >
                <span>{tradingMode === "LIVE" ? "🔴 LIVE PRODUCTION (PORT: 4001)" : "🟡 PAPER SIMULATION (PORT: 4002)"}</span>
                <span className="text-[10px] uppercase underline opacity-80">SWITCH</span>
              </button>
              <span className="text-secondary">
                Host: <strong className="text-primary">{vaultSettings?.ibkrHost || "127.0.0.1"}</strong>
              </span>
              <span className="text-emerald-500 dark:text-emerald-400 font-bold">• EDGE ACTIVE</span>
            </div>
          </div>
        </div>

        {/* Cost Governance Header Telemetry Bar */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Daily Quota Meter */}
          <div className="terminal-elevated rounded-lg px-3 py-1.5 flex items-center gap-2.5 text-xs font-mono">
            <Activity className="w-3.5 h-3.5 text-indigo-500 dark:text-indigo-400" />
            <div>
              <div className="text-[10px] text-secondary uppercase tracking-wider font-semibold">Today's Quota</div>
              <div className="text-primary font-bold flex items-center gap-1.5">
                <span>{stats.daily_requests} / {stats.daily_quota.toLocaleString()}</span>
                <span className={`text-[10px] px-1 rounded ${quotaPct > 80 ? "terminal-badge-warn" : "terminal-badge-bid"}`}>
                  {quotaPct}%
                </span>
              </div>
            </div>
          </div>

          {/* Daily Cumulative Spent */}
          <div className="terminal-elevated rounded-lg px-3 py-1.5 flex items-center gap-2.5 text-xs font-mono">
            <DollarSign className="w-3.5 h-3.5 text-emerald-500 dark:text-[#00ff88]" />
            <div>
              <div className="text-[10px] text-secondary uppercase tracking-wider font-semibold">Daily Estimated Cost</div>
              <div className="text-emerald-500 dark:text-[#00ff88] font-bold">
                ${stats.daily_spent_usd.toFixed(4)}
              </div>
            </div>
          </div>

          {/* Circuit Breaker Ceiling Badge */}
          <div className={`border rounded-lg px-3 py-1.5 flex items-center gap-2 text-xs font-mono ${
            stats.circuit_breaker_active
              ? "terminal-badge-ask animate-pulse"
              : "terminal-elevated text-secondary"
          }`}>
            <Shield className={`w-3.5 h-3.5 ${stats.circuit_breaker_active ? "text-rose-500" : "text-blue-500"}`} />
            <div>
              <div className="text-[10px] uppercase tracking-wider opacity-75">Ceiling: ${stats.daily_budget_ceiling_usd.toFixed(2)}</div>
              <div className="font-bold text-[11px]">
                {stats.circuit_breaker_active ? "THROTTLED (CIRCUIT BREAKER)" : "CIRCUIT BREAKER: ARMED"}
              </div>
            </div>
          </div>

          {/* Direct 4-Pillar Key Vault Access Button */}
          <button
            type="button"
            onClick={() => setIsVaultOpen(true)}
            className="terminal-card hover:border-accent text-secondary hover:text-primary rounded-lg px-3 py-1.5 flex items-center gap-2 text-xs font-mono transition cursor-pointer shadow-sm"
            title="Open 4-Pillar Connection & Feed Vault to configure Cloud LLMs, IBKR, and Market Feeds"
          >
            <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
            <span className="font-bold">4-Pillar Vault</span>
          </button>

          {/* Institutional Dynamic Model Selector with Monoline Icons & Vault Probing */}
          <InstitutionalModelSelector
            availableModels={availableModels}
            selectedModel={selectedModel}
            onSelectModel={(id) => {
              setSelectedModel(id);
              localStorage.setItem("alpha_copilot_model", id);
            }}
            onOpenVault={() => setIsVaultOpen(true)}
            vaultSettings={vaultSettings}
          />
        </div>
      </div>

      {/* Main Chat Workspace (Contained Viewport - Prevents Page-Level Jumping) */}
      <div className="terminal-card border terminal-border rounded-2xl shadow-xl flex flex-col max-w-5xl mx-auto w-full h-[calc(100vh-10rem)] min-h-[640px] overflow-hidden">
        {/* Messages Feed (Scrollable Viewport Container) */}
        <div
          ref={messagesContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-4 relative overscroll-contain"
        >
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
                    <span className="text-emerald-500 dark:text-[#00ff88] font-bold">ALPHA COPILOT</span>
                    <span>•</span>
                    <span>{msg.timestamp}</span>
                  </>
                )}
              </div>

              {/* Message Bubble */}
              <div
                className={`rounded-2xl p-4 sm:p-5 max-w-[90%] sm:max-w-[85%] border shadow-md relative group ${
                  msg.role === "user"
                    ? "bg-indigo-950/30 border-indigo-500/40 text-primary rounded-tr-none"
                    : "terminal-card rounded-tl-none"
                }`}
              >
                {/* Copy Button */}
                <button
                  type="button"
                  onClick={() => copyToClipboard(msg.content, msg.id)}
                  className="absolute top-3 right-3 p-1 rounded terminal-elevated text-secondary hover:text-primary transition opacity-0 group-hover:opacity-100 cursor-pointer"
                  title="Copy message"
                >
                  {copiedId === msg.id ? <Check className="w-3 h-3 text-emerald-500 dark:text-[#00ff88]" /> : <Copy className="w-3 h-3" />}
                </button>

                {/* Content */}
                {renderMarkdown(msg.content)}

                {msg.content.includes("4-Pillar") && (
                  <div className="mt-3 pt-2 border-t terminal-border">
                    <button
                      type="button"
                      onClick={() => setIsVaultOpen(true)}
                      className="px-3 py-1.5 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/40 text-indigo-400 hover:text-primary font-mono text-xs font-bold flex items-center gap-2 transition cursor-pointer"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                      <span>Open 4-Pillar Connection & Feed Vault</span>
                    </button>
                  </div>
                )}

                {msg.role === "assistant" && onNavigate && (
                  <div className="mt-3 pt-2 border-t terminal-border flex flex-wrap items-center gap-2">
                    {(msg.content.toLowerCase().includes("strategy") || msg.content.toLowerCase().includes("backtest") || msg.content.toLowerCase().includes("sweep") || msg.content.toLowerCase().includes("dsr") || msg.content.toLowerCase().includes("hurst")) && (
                      <button
                        type="button"
                        onClick={() => onNavigate("studio")}
                        className="px-2.5 py-1 rounded bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-400 hover:text-emerald-300 font-mono text-[11px] font-bold flex items-center gap-1.5 transition cursor-pointer"
                      >
                        <SlidersHorizontal className="w-3 h-3 text-emerald-400" />
                        <span>Open in Strategy Studio</span>
                      </button>
                    )}
                    {(msg.content.toLowerCase().includes("position") || msg.content.toLowerCase().includes("blotter") || msg.content.toLowerCase().includes("execution") || msg.content.toLowerCase().includes("cash balance") || msg.content.toLowerCase().includes("holdings")) && (
                      <button
                        type="button"
                        onClick={() => onNavigate("blotter")}
                        className="px-2.5 py-1 rounded bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/30 text-indigo-400 hover:text-indigo-300 font-mono text-[11px] font-bold flex items-center gap-1.5 transition cursor-pointer"
                      >
                        <Activity className="w-3 h-3 text-indigo-400" />
                        <span>Inspect in Blotter</span>
                      </button>
                    )}
                    {(msg.content.toLowerCase().includes("risk") || msg.content.toLowerCase().includes("circuit breaker") || msg.content.toLowerCase().includes("drawdown") || msg.content.toLowerCase().includes("gate")) && (
                      <button
                        type="button"
                        onClick={() => onNavigate("risk")}
                        className="px-2.5 py-1 rounded bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-400 hover:text-amber-300 font-mono text-[11px] font-bold flex items-center gap-1.5 transition cursor-pointer"
                      >
                        <ShieldAlert className="w-3 h-3 text-amber-400" />
                        <span>Check Risk Gates</span>
                      </button>
                    )}
                  </div>
                )}

                {/* Per-Message Telemetry Badge */}
                {msg.telemetry && (
                  <div className="mt-4 pt-3 border-t terminal-border flex flex-wrap items-center gap-2 text-[10px] font-mono text-secondary">
                    <span className="px-1.5 py-0.5 rounded terminal-card text-secondary font-bold">
                      {msg.telemetry.provider} • {msg.telemetry.model_name}
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
                      {msg.telemetry.total_tokens} tokens ({msg.telemetry.prompt_tokens}p / {msg.telemetry.completion_tokens}c)
                    </span>
                    <span className="px-1.5 py-0.5 rounded terminal-badge-bid font-bold">
                      ${msg.telemetry.cost_usd.toFixed(5)}
                    </span>
                    <span className="px-1.5 py-0.5 rounded terminal-elevated text-secondary">
                      {msg.telemetry.latency_ms}ms latency
                    </span>
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Active Tool Execution Indicator */}
          {activeTools.length > 0 && (
            <div className="flex items-center gap-2 p-3 rounded-xl terminal-card border border-emerald-500/40 max-w-md animate-pulse">
              <RefreshCw className="w-4 h-4 text-emerald-500 dark:text-[#00ff88] animate-spin" />
              <div className="text-xs font-mono text-secondary">
                <span className="text-emerald-500 dark:text-[#00ff88] font-bold">Executing Tools: </span>
                {activeTools.map((t) => (
                  <span key={t} className="px-1.5 py-0.5 mx-1 rounded terminal-elevated text-primary font-bold">
                    {t}()
                  </span>
                ))}
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />

          {/* Floating Jump to Latest Button */}
          {showScrollBottomBtn && (
            <button
              type="button"
              onClick={() => {
                setIsUserScrolledUp(false);
                scrollToBottom("smooth");
              }}
              className="sticky bottom-2 ml-auto p-2 rounded-full terminal-card border terminal-border hover:border-accent text-secondary hover:text-primary shadow-xl flex items-center gap-1.5 text-xs font-mono transition cursor-pointer z-20 animate-in fade-in"
              title="Jump to latest response"
            >
              <ArrowDown className="w-3.5 h-3.5 text-emerald-500 dark:text-[#00ff88]" />
              <span className="font-bold">Latest</span>
              {isGenerating && <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />}
            </button>
          )}
        </div>

        {/* Bottom Pinned Controls (Presets + Dynamic Textarea Console) */}
        <div className="border-t terminal-border p-3 sm:p-4 bg-inherit shrink-0 space-y-2.5">
          {/* Quick Query Recommendation Presets (Scrollable Ribbon) */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1 text-[11px] font-mono">
            <span className="text-[10px] text-secondary uppercase tracking-wider font-semibold shrink-0 pr-1 flex items-center gap-1">
              <Terminal className="w-3 h-3 text-emerald-500 dark:text-[#00ff88]" />
              PRESETS:
            </span>
            {[
              "What is my ibkr cash balance?",
              "What are my current IBKR positions and cash balance?",
              "What are the latest SEC filings for NVDA?",
              "Show me recent FDA alerts or Phase 3 trial updates.",
              "Check U.S. EIA energy storage telemetry for natural gas.",
              "Analyze Hurst regime and runs test for NVDA",
              "Optimize intraday strategy with 1.8 ATR stop for AAPL"
            ].map((preset, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => handleSend(preset)}
                disabled={isGenerating}
                className="px-2.5 py-1 rounded-lg terminal-elevated hover:border-accent text-[11px] font-mono text-secondary hover:text-primary transition cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50"
              >
                {preset}
              </button>
            ))}
          </div>

          {/* Active Model Status & Action Bar */}
          <div className="flex items-center justify-between px-1 text-[10px] font-mono text-secondary">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="shrink-0 p-0.5 rounded bg-black/40 border border-white/5">
                {getProviderIcon(activeModelObj.provider, activeModelObj.tier)}
              </span>
              <span>
                ACTIVE: <strong className="text-primary">{activeModelObj.name}</strong>
              </span>
              <span className="text-muted">•</span>
              <span className="text-secondary">{activeModelObj.costStr}</span>
              {Boolean(activeModelObj.isFree || activeModelObj.id.includes(":free")) ? (
                <span className="px-1.5 py-0.2 rounded text-[9px] bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-bold">
                  UNMETERED
                </span>
              ) : isModelConfiguredDefault(activeModelObj, vaultSettings) ? (
                <span className="px-1.5 py-0.2 rounded text-[9px] bg-emerald-500/20 text-emerald-400 dark:text-[#00ff88] border border-emerald-500/40 font-bold flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 dark:bg-[#00ff88]" /> READY
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsVaultOpen(true)}
                  className="px-1.5 py-0.2 rounded text-[9px] bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 font-bold flex items-center gap-1 cursor-pointer transition"
                  title="Configure provider key in 4-Pillar Vault"
                >
                  <AlertTriangle className="w-2.5 h-2.5" />
                  <span>KEY REQUIRED • CONFIGURE</span>
                </button>
              )}
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setIsExpandedInput((prev) => !prev)}
                className="text-secondary hover:text-primary transition cursor-pointer flex items-center gap-1 font-semibold"
                title={isExpandedInput ? "Collapse to auto-sizing input" : "Expand to multi-line prompt editor"}
              >
                {isExpandedInput ? (
                  <>
                    <Minimize2 className="w-3 h-3 text-cyan-400" />
                    <span>Compact Input</span>
                  </>
                ) : (
                  <>
                    <Maximize2 className="w-3 h-3 text-slate-400 hover:text-cyan-400" />
                    <span>Expand Input</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={handleClearHistory}
                className="text-secondary hover:text-rose-500 transition cursor-pointer flex items-center gap-1"
                title="Clear conversational memory"
              >
                <Trash2 className="w-3 h-3" />
                <span>Reset Context</span>
              </button>
            </div>
          </div>

          {/* Multi-line User Input Console */}
          <div className="flex items-end gap-2">
            <div className="flex-1 relative flex flex-col">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder="Ask an ad-hoc portfolio question, SEC filing check, or clinical trial query... (Shift + Enter for new line)"
                rows={1}
                className={`w-full terminal-elevated rounded-xl px-4 py-3 text-xs sm:text-sm font-sans text-primary placeholder:text-muted focus:outline-none focus:border-cyan resize-none transition-[height] duration-75 leading-relaxed ${
                  isExpandedInput ? "h-[220px] overflow-y-auto" : "overflow-y-auto"
                }`}
              />
              {/* Multi-line Hint & Length counter */}
              <div className="flex items-center justify-between px-2 pt-1 text-[10px] font-mono text-secondary">
                <span className="opacity-80">Shift + Enter for new line • Enter to send</span>
                {input.length > 0 && (
                  <span className="opacity-75">{input.length} chars</span>
                )}
              </div>
            </div>

            {isGenerating ? (
              <button
                type="button"
                onClick={handleStop}
                className="p-3 mb-5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white transition cursor-pointer shadow-md flex items-center justify-center shrink-0"
                title="Stop generation"
              >
                <Square className="w-4 h-4 fill-current" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleSend()}
                disabled={!input.trim()}
                className="p-3 mb-5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white dark:bg-emerald-400 dark:hover:bg-emerald-300 dark:text-slate-950 transition cursor-pointer shadow-md flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed font-bold shrink-0"
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
