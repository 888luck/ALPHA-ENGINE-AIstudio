import React, { useState, useEffect, useRef } from "react";
import {
  XCircle,
  ExternalLink,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  Database,
  Coins,
  Radio,
  Eye,
  EyeOff,
  Activity,
  Terminal,
  Server,
  FileText,
  Clock,
  Globe,
  Dna,
  Scale,
  Building2,
  RefreshCw,
  Zap,
  HelpCircle,
  Save,
  Check,
  Copy,
  Download
} from "lucide-react";
import {
  getStoredVaultValue,
  persistVaultItem,
  persistVaultBatch,
  syncVaultToServer,
  getAllStoredVaultSettings
} from "../utils/vaultStorage";
import { getAdminHeaders } from "../utils/auth";

export interface VaultConsoleProps {
  isModal?: boolean;
  isOpen?: boolean;
  onClose?: () => void;
  initialTab?: "broker" | "cloud" | "ai" | "feeds" | string;
  settings?: any;
  onSaveSetting?: (key: string, value: any) => Promise<void>;
  onSaveMultipleSettings?: (updates: Record<string, any>) => Promise<void>;
  customGeminiApiKey?: string;
  onSaveGeminiKey?: (key: string) => void;
  firebaseStatus?: string;
}

export const VaultConsole: React.FC<VaultConsoleProps> = ({
  isModal = false,
  isOpen = true,
  onClose,
  initialTab = "ai",
  settings,
  onSaveSetting,
  onSaveMultipleSettings,
  customGeminiApiKey,
  onSaveGeminiKey,
}) => {
  if (isModal && !isOpen) return null;

  // Resolve initial tab (map legacy target IDs if present)
  const resolveTab = (t?: string): "broker" | "cloud" | "ai" | "feeds" => {
    if (!t) return "ai";
    if (t === "broker" || t.includes("ibkr") || t.includes("account")) return "broker";
    if (t === "cloud" || t.includes("edge") || t.includes("gcp") || t.includes("infra")) return "cloud";
    if (t === "ai" || t.includes("gemini") || t.includes("llm") || t.includes("model")) return "ai";
    if (t === "feeds" || t.includes("sec") || t.includes("fda") || t.includes("fred") || t.includes("patent")) return "feeds";
    return "ai";
  };

  const [activeTab, setActiveTab] = useState<"broker" | "cloud" | "ai" | "feeds">(() => resolveTab(initialTab));

  useEffect(() => {
    if (initialTab) {
      setActiveTab(resolveTab(initialTab));
    }
  }, [initialTab]);

  // Form State for Broker
  const [accountNumber, setAccountNumber] = useState(() => getStoredVaultValue("ibkrAccountNumber", settings?.ibkrAccountNumber || "DU1234567"));
  const [ibkrHost, setIbkrHost] = useState(() => {
    const isCloudRun = typeof window !== "undefined" && window.location.hostname.includes("run.app");
    const stored = getStoredVaultValue("ibkrHost", "");
    if (isCloudRun && (!stored || stored === "127.0.0.1")) return "10.156.0.2";
    if (stored) return stored;
    if (settings?.ibkrHost && settings.ibkrHost !== "127.0.0.1") return settings.ibkrHost;
    return isCloudRun ? "10.156.0.2" : (settings?.ibkrHost || "10.156.0.2");
  });
  const [ibkrPort, setIbkrPort] = useState(() => Number(getStoredVaultValue("ibkrPort", String(settings?.ibkrPort || 4002))));
  const [ibkrClientId, setIbkrClientId] = useState(() => Number(getStoredVaultValue("ibkrClientId", String(settings?.ibkrClientId || 1))));
  const [mifidMaker, setMifidMaker] = useState(() => getStoredVaultValue("mifid2DecisionMaker", settings?.mifid2DecisionMaker || "ALGO_DEC_992"));
  const [mifidTrader, setMifidTrader] = useState(() => getStoredVaultValue("mifid2ExecutionTrader", settings?.mifid2ExecutionTrader || "ALGO_EXE_554"));
  const [ibkrUsername, setIbkrUsername] = useState(() => getStoredVaultValue("ibkrPaperUsername", settings?.ibkrPaperUsername || ""));
  const [ibkrPassword, setIbkrPassword] = useState(() => getStoredVaultValue("ibkrPaperPassword", settings?.ibkrPaperPassword || ""));

  // Form State for Cloud & Edge Node
  const [edgeNodeStatus, setEdgeNodeStatus] = useState<string>("Frankfurt Edge Node (10.156.0.2:4005)");

  // Form State for AI (Zero-Omission Persistent Hydration)
  const [geminiKey, setGeminiKey] = useState(() => getStoredVaultValue("geminiApiKey", customGeminiApiKey || settings?.geminiApiKey));
  const [groqKey, setGroqKey] = useState(() => getStoredVaultValue("customAiApiKey", settings?.customAiApiKey));
  const [nvidiaKey, setNvidiaKey] = useState(() => getStoredVaultValue("nvidiaApiKey", settings?.nvidiaApiKey));
  const [openrouterKey, setOpenrouterKey] = useState(() => getStoredVaultValue("openrouterApiKey", settings?.openrouterApiKey));
  const [openaiKey, setOpenaiKey] = useState(() => getStoredVaultValue("openaiApiKey", settings?.openaiApiKey));
  const [anthropicKey, setAnthropicKey] = useState(() => getStoredVaultValue("anthropicApiKey", settings?.anthropicApiKey));
  const [customBaseUrl, setCustomBaseUrl] = useState(() => getStoredVaultValue("customAiBaseUrl", settings?.customAiBaseUrl || "http://localhost:11434/v1"));
  const [customModelName, setCustomModelName] = useState(() => getStoredVaultValue("customAiModelName", settings?.customAiModelName || "llama3.1"));

  // Form State for Feeds
  const [openFdaKey, setOpenFdaKey] = useState(() => getStoredVaultValue("openFdaApiKey", settings?.openFdaApiKey));
  const [fredKey, setFredKey] = useState(() => getStoredVaultValue("fredApiKey", settings?.fredApiKey));
  const [patentsKey, setPatentsKey] = useState(() => getStoredVaultValue("patentsApiKey", settings?.patentsApiKey));
  const [secUserAgent, setSecUserAgent] = useState(() => getStoredVaultValue(
    "secUserAgent",
    settings?.secUserAgent || "AlphaEngine/2.0 (InstitutionalResearch; contact@alphaengine.internal)"
  ));

  const dirtyFieldsRef = useRef<Set<string>>(new Set());

  // Re-hydrate state from centralized server credentials
  useEffect(() => {
    fetch("/api/vault/credentials", {
      headers: getAdminHeaders()
    })
      .then((r) => r.json())
      .then((creds) => {
        if (creds && typeof creds === "object") {
          const isCloudRun = typeof window !== "undefined" && window.location.hostname.includes("run.app");
          if (!dirtyFieldsRef.current.has("accountNumber") && creds.ibkrAccountNumber) setAccountNumber(creds.ibkrAccountNumber);
          if (!dirtyFieldsRef.current.has("ibkrHost")) {
            if (creds.ibkrHost) {
              setIbkrHost(isCloudRun && creds.ibkrHost === "127.0.0.1" ? "10.156.0.2" : creds.ibkrHost);
            } else if (isCloudRun) {
              setIbkrHost("10.156.0.2");
            }
          }
          if (!dirtyFieldsRef.current.has("ibkrPort") && creds.ibkrPort) setIbkrPort(Number(creds.ibkrPort));
          if (!dirtyFieldsRef.current.has("ibkrClientId") && creds.ibkrClientId) setIbkrClientId(Number(creds.ibkrClientId));
          if (!dirtyFieldsRef.current.has("mifidMaker") && creds.mifid2DecisionMaker) setMifidMaker(creds.mifid2DecisionMaker);
          if (!dirtyFieldsRef.current.has("mifidTrader") && creds.mifid2ExecutionTrader) setMifidTrader(creds.mifid2ExecutionTrader);
          if (!dirtyFieldsRef.current.has("ibkrUsername") && creds.ibkrPaperUsername) setIbkrUsername(creds.ibkrPaperUsername);
          if (creds.edgeNodeHost) setEdgeNodeStatus(creds.edgeNodeHost);

          if (!dirtyFieldsRef.current.has("geminiKey") && creds.geminiApiKey) setGeminiKey(creds.geminiApiKey);
          if (!dirtyFieldsRef.current.has("groqKey") && (creds.customAiApiKey || creds.groqApiKey)) setGroqKey(creds.customAiApiKey || creds.groqApiKey);
          if (!dirtyFieldsRef.current.has("nvidiaKey") && creds.nvidiaApiKey) setNvidiaKey(creds.nvidiaApiKey);
          if (!dirtyFieldsRef.current.has("openaiKey") && creds.openaiApiKey) setOpenaiKey(creds.openaiApiKey);
          if (!dirtyFieldsRef.current.has("anthropicKey") && creds.anthropicApiKey) setAnthropicKey(creds.anthropicApiKey);
          if (!dirtyFieldsRef.current.has("openrouterKey") && creds.openrouterApiKey) setOpenrouterKey(creds.openrouterApiKey);
          if (!dirtyFieldsRef.current.has("openFdaKey") && creds.openFdaApiKey) setOpenFdaKey(creds.openFdaApiKey);
          if (!dirtyFieldsRef.current.has("fredKey") && creds.fredApiKey) setFredKey(creds.fredApiKey);
          if (!dirtyFieldsRef.current.has("patentsKey") && creds.patentsApiKey) setPatentsKey(creds.patentsApiKey);
          if (!dirtyFieldsRef.current.has("secUserAgent") && creds.secUserAgent) setSecUserAgent(creds.secUserAgent);
          persistVaultBatch(creds);
        }
      })
      .catch(() => {});
  }, []);

  // Masking toggles
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const toggleShowKey = (id: string) => {
    setShowKeys((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // Test Results State with Live Discovered Models
  const [testResults, setTestResults] = useState<Record<string, {
    loading?: boolean;
    success?: boolean;
    latencyMs?: number;
    message?: string;
    sample?: string;
    models?: any[];
  }>>({});

  // Generic Probe Runner with Automatic Persistence on Success
  const runTestProbe = async (testId: string, url: string, payload: any) => {
    setTestResults((prev) => ({
      ...prev,
      [testId]: { loading: true },
    }));

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: getAdminHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      const isSuccess = Boolean(data.success);
      let successMsg = data.message || data.error;

      if (isSuccess) {
        if (testId === "gemini" && payload.apiKey) {
          persistVaultItem("geminiApiKey", payload.apiKey);
          if (onSaveGeminiKey) onSaveGeminiKey(payload.apiKey);
          if (onSaveSetting) onSaveSetting("geminiApiKey", payload.apiKey).catch(() => {});
          successMsg = `${successMsg || "Gemini API probe verified"} • 🔒 Auto-saved to Vault`;
        } else if (testId === "groq" && payload.apiKey) {
          persistVaultItem("customAiApiKey", payload.apiKey);
          if (onSaveSetting) onSaveSetting("customAiApiKey", payload.apiKey).catch(() => {});
          successMsg = `${successMsg || "Groq Cloud probe verified"} • 🔒 Auto-saved to Vault`;
        } else if (testId === "nvidia" && payload.apiKey) {
          persistVaultItem("nvidiaApiKey", payload.apiKey);
          if (onSaveSetting) onSaveSetting("nvidiaApiKey", payload.apiKey).catch(() => {});
          successMsg = `${successMsg || "NVIDIA NIM probe verified"} • 🔒 Auto-saved to Vault`;
        } else if (testId === "openai" && payload.apiKey) {
          persistVaultItem("openaiApiKey", payload.apiKey);
          if (onSaveSetting) onSaveSetting("openaiApiKey", payload.apiKey).catch(() => {});
          successMsg = `${successMsg || "OpenAI probe verified"} • 🔒 Auto-saved to Vault`;
        } else if (testId === "anthropic" && payload.apiKey) {
          persistVaultItem("anthropicApiKey", payload.apiKey);
          if (onSaveSetting) onSaveSetting("anthropicApiKey", payload.apiKey).catch(() => {});
          successMsg = `${successMsg || "Anthropic probe verified"} • 🔒 Auto-saved to Vault`;
        } else if (testId === "openrouter" && payload.apiKey) {
          persistVaultItem("openrouterApiKey", payload.apiKey);
          if (onSaveSetting) onSaveSetting("openrouterApiKey", payload.apiKey).catch(() => {});
          successMsg = `${successMsg || "OpenRouter probe verified"} • 🔒 Auto-saved to Vault`;
        } else if (testId === "openfda" && payload.apiKey) {
          persistVaultItem("openFdaApiKey", payload.apiKey);
          if (onSaveSetting) onSaveSetting("openFdaApiKey", payload.apiKey).catch(() => {});
        } else if (testId === "fred" && payload.apiKey) {
          persistVaultItem("fredApiKey", payload.apiKey);
          if (onSaveSetting) onSaveSetting("fredApiKey", payload.apiKey).catch(() => {});
        } else if (testId === "patents" && payload.apiKey) {
          persistVaultItem("patentsApiKey", payload.apiKey);
          if (onSaveSetting) onSaveSetting("patentsApiKey", payload.apiKey).catch(() => {});
        }

        syncVaultToServer().catch(() => {});
        fetch("/api/copilot/models?refresh=1").catch(() => {});
        fetch("/api/copilot/stats?refresh=1").catch(() => {});
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("copilot:models_invalidated"));
        }
      }

      setTestResults((prev) => ({
        ...prev,
        [testId]: {
          loading: false,
          success: isSuccess,
          latencyMs: data.latencyMs,
          message: successMsg,
          sample: data.sample || data.reply,
          models: data.models || [],
        },
      }));
    } catch (err: any) {
      setTestResults((prev) => ({
        ...prev,
        [testId]: {
          loading: false,
          success: false,
          message: `Network probe error: ${err.message}`,
        },
      }));
    }
  };

  const handleCheckEdgeNode = async () => {
    runTestProbe("cloud", "/api/system/state", {});
  };

  // 1-Click Auto-Fill / Restore Verified AI Keys
  const [aiSavedMsg, setAiSavedMsg] = useState<string | null>(null);
  const handleAutoFillVerifiedAiKeys = async () => {
    try {
      const res = await fetch("/api/vault/credentials", {
        headers: getAdminHeaders()
      });
      if (res.ok) {
        const data = await res.json();
        if (data.geminiApiKey) {
          dirtyFieldsRef.current.add("geminiKey");
          setGeminiKey(data.geminiApiKey);
        }
        if (data.customAiApiKey) {
          dirtyFieldsRef.current.add("groqKey");
          setGroqKey(data.customAiApiKey);
        }
        if (data.nvidiaApiKey) {
          dirtyFieldsRef.current.add("nvidiaKey");
          setNvidiaKey(data.nvidiaApiKey);
        }
        persistVaultBatch(data);
        if (onSaveMultipleSettings) {
          onSaveMultipleSettings(data).catch(() => {});
        }
        setAiSavedMsg("Verified credentials restored & permanently locked into your browser vault.");
        setTimeout(() => setAiSavedMsg(null), 4000);
        return;
      }
    } catch (e) {}

    const stored = getAllStoredVaultSettings();
    if (stored.geminiApiKey) {
      dirtyFieldsRef.current.add("geminiKey");
      setGeminiKey(stored.geminiApiKey);
    }
    if (stored.customAiApiKey) {
      dirtyFieldsRef.current.add("groqKey");
      setGroqKey(stored.customAiApiKey);
    }
    if (stored.nvidiaApiKey) {
      dirtyFieldsRef.current.add("nvidiaKey");
      setNvidiaKey(stored.nvidiaApiKey);
    }
    setAiSavedMsg("Loaded from local browser persistent vault.");
    setTimeout(() => setAiSavedMsg(null), 4000);
  };

  // Probe all active pillars
  const [isProbingAll, setIsProbingAll] = useState(false);
  const handleProbeAll = async () => {
    setIsProbingAll(true);
    await Promise.all([
      runTestProbe("cloud", "/api/system/state", {}),
      runTestProbe("ibkr", "/api/test-broker-connection", { port: ibkrPort }),
      geminiKey ? runTestProbe("gemini", "/api/test-ai-key", { provider: "gemini", apiKey: geminiKey }) : Promise.resolve(),
      groqKey ? runTestProbe("groq", "/api/test-ai-key", { provider: "groq", apiKey: groqKey }) : Promise.resolve(),
      runTestProbe("sec", "/api/test-feed-probe", { feedType: "sec" })
    ]);
    setIsProbingAll(false);
  };

  // Broker saving state
  const [isSavingBroker, setIsSavingBroker] = useState(false);
  const [brokerSavedMsg, setBrokerSavedMsg] = useState<string | null>(null);

  const handleSaveBroker = async () => {
    setIsSavingBroker(true);
    setBrokerSavedMsg(null);
    try {
      const updates: Record<string, any> = {
        ibkrAccountNumber: accountNumber,
        ibkrHost: ibkrHost,
        ibkrPort: Number(ibkrPort),
        ibkrClientId: Number(ibkrClientId),
        mifid2DecisionMaker: mifidMaker,
        mifid2ExecutionTrader: mifidTrader,
      };
      if (ibkrUsername) updates.ibkrPaperUsername = ibkrUsername;
      if (ibkrPassword) updates.ibkrPaperPassword = ibkrPassword;

      persistVaultBatch(updates);

      if (onSaveMultipleSettings) {
        await onSaveMultipleSettings(updates);
      } else if (onSaveSetting) {
        for (const [k, v] of Object.entries(updates)) {
          await onSaveSetting(k, v);
        }
      }
      await syncVaultToServer(updates);

      setBrokerSavedMsg("Broker settings synchronized successfully & locked into secure vault.");
      setTimeout(() => setBrokerSavedMsg(null), 3500);
    } catch (e: any) {
      setBrokerSavedMsg(`Error saving broker settings: ${e.message}`);
    } finally {
      setIsSavingBroker(false);
    }
  };

  // AI saving state
  const [isSavingAi, setIsSavingAi] = useState(false);
  const handleSaveAiKeys = async () => {
    setIsSavingAi(true);
    setAiSavedMsg(null);
    try {
      const updates: Record<string, any> = {
        geminiApiKey: geminiKey,
        customAiApiKey: groqKey,
        nvidiaApiKey: nvidiaKey,
        openaiApiKey: openaiKey,
        anthropicApiKey: anthropicKey,
        openrouterApiKey: openrouterKey,
        customAiBaseUrl: customBaseUrl,
        customAiModelName: customModelName,
      };

      persistVaultBatch(updates);

      if (onSaveMultipleSettings) {
        await onSaveMultipleSettings(updates);
      } else if (onSaveSetting) {
        for (const [k, v] of Object.entries(updates)) {
          await onSaveSetting(k, v);
        }
      }
      await syncVaultToServer(updates);

      fetch("/api/copilot/models?refresh=1").catch(() => {});
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("copilot:models_invalidated"));
      }

      setAiSavedMsg("AI intelligence credentials saved to memory, disk, and browser vault.");
      setTimeout(() => setAiSavedMsg(null), 3500);
    } catch (e: any) {
      setAiSavedMsg(`Error saving AI keys: ${e.message}`);
    } finally {
      setIsSavingAi(false);
    }
  };

  // Feeds saving state
  const [isSavingFeeds, setIsSavingFeeds] = useState(false);
  const [feedSavedMsg, setFeedSavedMsg] = useState<string | null>(null);
  const handleSaveFeedSettings = async () => {
    setIsSavingFeeds(true);
    setFeedSavedMsg(null);
    try {
      const updates: Record<string, any> = {
        openFdaApiKey: openFdaKey,
        fredApiKey: fredKey,
        patentsApiKey: patentsKey,
        secUserAgent: secUserAgent,
      };

      persistVaultBatch(updates);

      if (onSaveMultipleSettings) {
        await onSaveMultipleSettings(updates);
      } else if (onSaveSetting) {
        for (const [k, v] of Object.entries(updates)) {
          await onSaveSetting(k, v);
        }
      }
      await syncVaultToServer(updates);

      setFeedSavedMsg("Regulatory feed preferences locked into vault.");
      setTimeout(() => setFeedSavedMsg(null), 3500);
    } catch (e: any) {
      setFeedSavedMsg(`Error saving feeds: ${e.message}`);
    } finally {
      setIsSavingFeeds(false);
    }
  };

  // Export 12-factor secrets.env snippet
  const [copiedEnv, setCopiedEnv] = useState(false);
  const handleCopySecretsEnv = () => {
    const lines = [
      "# Alpha Engine 12-Factor POSIX Environment File",
      "# Location: /etc/alpha-engine/secrets.env (chmod 600 root:root)",
      `IBKR_ACCOUNT_NUMBER=${accountNumber}`,
      `IBKR_HOST=${ibkrHost}`,
      `IBKR_PORT=${ibkrPort}`,
      `IBKR_CLIENT_ID=${ibkrClientId}`,
      `MIFID2_DECISION_MAKER=${mifidMaker}`,
      `MIFID2_EXECUTION_TRADER=${mifidTrader}`,
      geminiKey ? `GEMINI_API_KEY=${geminiKey}` : "",
      groqKey ? `GROQ_API_KEY=${groqKey}` : "",
      nvidiaKey ? `NVIDIA_API_KEY=${nvidiaKey}` : "",
      openaiKey ? `OPENAI_API_KEY=${openaiKey}` : "",
      anthropicKey ? `ANTHROPIC_API_KEY=${anthropicKey}` : "",
      openrouterKey ? `OPENROUTER_API_KEY=${openrouterKey}` : "",
      openFdaKey ? `OPENFDA_API_KEY=${openFdaKey}` : "",
      fredKey ? `FRED_API_KEY=${fredKey}` : "",
      patentsKey ? `PATENTS_API_KEY=${patentsKey}` : "",
      `SEC_USER_AGENT="${secUserAgent}"`,
    ].filter(Boolean).join("\n");

    navigator.clipboard.writeText(lines);
    setCopiedEnv(true);
    setTimeout(() => setCopiedEnv(false), 3000);
  };

  // Inner Vault Content (Rendered both in Full Page and in Modal)
  const renderVaultContent = () => (
    <div className="space-y-6">
      {/* 4 Pillars Navigation Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 terminal-card p-1.5 gap-2 text-xs font-mono font-bold border border-border rounded-xl">
        <button
          type="button"
          onClick={() => setActiveTab("broker")}
          className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg transition cursor-pointer ${
            activeTab === "broker"
              ? "bg-amber-500/20 text-amber-500 dark:text-amber-400 border border-amber-500/40 shadow-xs font-black"
              : "text-secondary hover:text-primary hover:bg-elevated"
          }`}
        >
          <Coins className="w-4 h-4 text-amber-500" />
          <span>1. Brokerage & DMA</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("cloud")}
          className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg transition cursor-pointer ${
            activeTab === "cloud"
              ? "bg-blue-500/20 text-blue-500 dark:text-blue-400 border border-blue-500/40 shadow-xs font-black"
              : "text-secondary hover:text-primary hover:bg-elevated"
          }`}
        >
          <Server className="w-4 h-4 text-blue-500" />
          <span>2. Cloud & Edge</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("ai")}
          className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg transition cursor-pointer ${
            activeTab === "ai"
              ? "bg-indigo-500/20 text-indigo-500 dark:text-indigo-400 border border-indigo-500/40 shadow-xs font-black"
              : "text-secondary hover:text-primary hover:bg-elevated"
          }`}
        >
          <Sparkles className="w-4 h-4 text-indigo-500" />
          <span>3. AI / LLM Engine</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("feeds")}
          className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg transition cursor-pointer ${
            activeTab === "feeds"
              ? "bg-emerald-500/20 text-emerald-500 dark:text-[#00ff88] border border-emerald-500/40 shadow-xs font-black"
              : "text-secondary hover:text-primary hover:bg-elevated"
          }`}
        >
          <Radio className="w-4 h-4 text-emerald-500" />
          <span>4. Regulatory Feeds</span>
        </button>
      </div>

      {/* ============================================================== */}
      {/* TAB 1: BROKERAGE (INTERACTIVE BROKERS)                         */}
      {/* ============================================================== */}
      {activeTab === "broker" && (
        <div className="space-y-6">
          <div className="terminal-elevated border border-amber-500/30 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-primary font-bold text-sm">
                <Coins className="w-4 h-4 text-amber-500" />
                <span>Interactive Brokers DMA Gateway TCP Socket</span>
                <span className="text-[10px] terminal-badge-warn px-2 py-0.5 rounded font-mono font-bold uppercase">
                  Direct Market Access
                </span>
              </div>
              <p className="text-xs text-secondary leading-relaxed font-mono">
                AlphaEngine communicates with IBKR through native binary sockets on the Frankfurt Edge Node. Authorized via local IB Gateway with sub-3ms co-located latency to IBKR Europe Hub.
              </p>
            </div>
            <span className="text-xs font-mono font-bold text-amber-500 border border-amber-500/30 px-2.5 py-1 rounded bg-amber-500/10 shrink-0">
              CBI MiFID II RTS-22 Armed
            </span>
          </div>

          {/* Form Grid */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-mono font-bold text-secondary uppercase">Account Number:</label>
              <input
                type="text"
                value={accountNumber}
                onChange={(e) => {
                  const val = e.target.value;
                  dirtyFieldsRef.current.add("accountNumber");
                  setAccountNumber(val);
                  persistVaultItem("ibkrAccountNumber", val);
                }}
                placeholder="e.g. DU1234567 or U1234567"
                className="w-full terminal-elevated border border-border rounded-lg px-3 py-2 text-xs font-mono text-primary focus:outline-hidden focus:border-amber-500"
              />
              <span className="text-[9px] text-muted font-mono block">DU... for Paper, U... for Live</span>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-mono font-bold text-secondary uppercase">Target Host IP:</label>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      dirtyFieldsRef.current.add("ibkrHost");
                      setIbkrHost("10.156.0.2");
                      persistVaultItem("ibkrHost", "10.156.0.2");
                    }}
                    className={`text-[9px] font-mono px-1.5 py-0.5 rounded cursor-pointer transition border ${
                      ibkrHost === "10.156.0.2"
                        ? "bg-amber-600 text-white border-amber-600 font-bold"
                        : "terminal-elevated text-secondary border-border hover:bg-elevated"
                    }`}
                    title="Frankfurt Edge Node Internal IP (VPC)"
                  >
                    Node (10.156.0.2)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      dirtyFieldsRef.current.add("ibkrHost");
                      setIbkrHost("127.0.0.1");
                      persistVaultItem("ibkrHost", "127.0.0.1");
                    }}
                    className={`text-[9px] font-mono px-1.5 py-0.5 rounded cursor-pointer transition border ${
                      ibkrHost === "127.0.0.1"
                        ? "bg-amber-600 text-white border-amber-600 font-bold"
                        : "terminal-elevated text-secondary border-border hover:bg-elevated"
                    }`}
                    title="Local Loopback"
                  >
                    Local (127.0.0.1)
                  </button>
                </div>
              </div>
              <input
                type="text"
                value={ibkrHost}
                onChange={(e) => {
                  const val = e.target.value;
                  dirtyFieldsRef.current.add("ibkrHost");
                  setIbkrHost(val);
                  persistVaultItem("ibkrHost", val);
                }}
                placeholder="10.156.0.2 or 127.0.0.1"
                className="w-full terminal-elevated border border-border rounded-lg px-3 py-2 text-xs font-mono text-primary focus:outline-hidden focus:border-amber-500"
              />
              <span className="text-[9px] text-muted font-mono block">Frankfurt Edge Node VPC / Localhost</span>
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-mono font-bold text-secondary uppercase">Socket Port:</label>
              <select
                value={ibkrPort}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  dirtyFieldsRef.current.add("ibkrPort");
                  setIbkrPort(val);
                  persistVaultItem("ibkrPort", val);
                }}
                className="w-full terminal-elevated border border-border rounded-lg px-3 py-2 text-xs font-mono font-bold text-primary focus:outline-hidden focus:border-amber-500"
              >
                <option value={4002}>4002 (IB Gateway Paper - Recommended)</option>
                <option value={4001}>4001 (IB Gateway Live Production)</option>
                <option value={7497}>7497 (TWS Paper)</option>
                <option value={7496}>7496 (TWS Live)</option>
              </select>
              <span className="text-[9px] text-muted font-mono block">IB Gateway/TWS Listening Port</span>
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-mono font-bold text-secondary uppercase">Client ID:</label>
              <input
                type="number"
                value={ibkrClientId}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  dirtyFieldsRef.current.add("ibkrClientId");
                  setIbkrClientId(val);
                  persistVaultItem("ibkrClientId", val);
                }}
                className="w-full terminal-elevated border border-border rounded-lg px-3 py-2 text-xs font-mono text-primary focus:outline-hidden focus:border-amber-500"
              />
              <span className="text-[9px] text-muted font-mono block">Unique socket connection ID</span>
            </div>
          </div>

          {/* MiFID II Compliance Audit Details */}
          <div className="terminal-elevated border border-border rounded-xl p-4 space-y-3 font-mono">
            <div className="flex items-center justify-between border-b border-border pb-2">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-500" />
                <span className="text-xs font-bold text-primary uppercase">MiFID II RTS-22 Regulatory Identifiers</span>
              </div>
              <span className="text-[10px] text-secondary">CBI Shortcode Tagging</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="space-y-1">
                <label className="text-[10px] text-secondary font-bold uppercase block">Algorithm Decision Maker (Field 12):</label>
                <input
                  type="text"
                  value={mifidMaker}
                  onChange={(e) => {
                    const val = e.target.value;
                    dirtyFieldsRef.current.add("mifidMaker");
                    setMifidMaker(val);
                    persistVaultItem("mifid2DecisionMaker", val);
                  }}
                  className="w-full terminal-card border border-border rounded-lg px-3 py-1.5 text-xs text-primary"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] text-secondary font-bold uppercase block">Execution Trader Tag (Field 59):</label>
                <input
                  type="text"
                  value={mifidTrader}
                  onChange={(e) => {
                    const val = e.target.value;
                    dirtyFieldsRef.current.add("mifidTrader");
                    setMifidTrader(val);
                    persistVaultItem("mifid2ExecutionTrader", val);
                  }}
                  className="w-full terminal-card border border-border rounded-lg px-3 py-1.5 text-xs text-primary"
                />
              </div>
            </div>
          </div>

          {/* Actions & Live Probe */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-border">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => runTestProbe("ibkr", "/api/test-broker-connection", { port: ibkrPort })}
                disabled={testResults["ibkr"]?.loading}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-mono font-bold flex items-center gap-2 cursor-pointer transition shadow-xs"
              >
                {testResults["ibkr"]?.loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Activity className="w-3.5 h-3.5" />}
                Test DMA Socket Port {ibkrPort}
              </button>

              {testResults["ibkr"] && (
                <span className={`text-xs font-mono font-bold px-2.5 py-1 rounded ${
                  testResults["ibkr"].success ? "terminal-badge-bid" : "terminal-badge-ask"
                }`}>
                  {testResults["ibkr"].message}
                </span>
              )}
            </div>

            <div className="flex items-center gap-3">
              {brokerSavedMsg && (
                <span className="text-xs font-mono text-emerald-500 dark:text-[#00ff88] font-bold">
                  ✓ {brokerSavedMsg}
                </span>
              )}
              <button
                type="button"
                onClick={handleSaveBroker}
                disabled={isSavingBroker}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-mono font-bold flex items-center gap-2 cursor-pointer transition shadow-md"
              >
                {isSavingBroker ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                Save Broker Parameters
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* TAB 2: CLOUD & EDGE INFRASTRUCTURE                             */}
      {/* ============================================================== */}
      {activeTab === "cloud" && (
        <div className="space-y-6">
          <div className="terminal-elevated border border-blue-500/30 rounded-xl p-4 flex items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-primary font-bold text-sm">
                <Server className="w-4 h-4 text-blue-500" />
                <span>Cloud Run Control Plane & Frankfurt Edge Node Topology</span>
                <span className="text-[10px] terminal-badge-bid px-2 py-0.5 rounded font-mono font-bold uppercase">
                  Zero-Firestore Architecture
                </span>
              </div>
              <p className="text-xs text-secondary leading-relaxed font-mono">
                AlphaEngine operates with microsecond atomic local disk storage (<code className="bg-black/20 dark:bg-white/10 px-1 rounded">system_settings.json</code>) and direct TCP bridge synchronization. Cloud Run (<code className="bg-black/20 dark:bg-white/10 px-1 rounded">europe-west3</code>) connects directly to the Frankfurt Edge VM (<code className="bg-black/20 dark:bg-white/10 px-1 rounded">10.156.0.2:4005</code>).
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="terminal-card border border-border p-4 rounded-xl space-y-1.5 font-mono">
              <div className="text-[10px] text-secondary uppercase font-bold">Edge Node Location</div>
              <div className="text-xs font-bold text-primary">Frankfurt europe-west3-a</div>
              <div className="text-[10px] text-muted">Adjacent to IBKR European Hub</div>
            </div>

            <div className="terminal-card border border-border p-4 rounded-xl space-y-1.5 font-mono">
              <div className="text-[10px] text-secondary uppercase font-bold">Persistence Mechanism</div>
              <div className="text-xs font-bold text-emerald-500 dark:text-[#00ff88] flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                Atomic Disk JSON & POSIX Secrets
              </div>
              <div className="text-[10px] text-muted">Firestore 100% Eliminated</div>
            </div>

            <div className="terminal-card border border-border p-4 rounded-xl space-y-1.5 font-mono">
              <div className="text-[10px] text-secondary uppercase font-bold">TCP Execution Bridge</div>
              <div className="text-xs font-bold text-primary">Port 4005 (Direct TCP Bridge)</div>
              <div className="text-[10px] text-muted">Port 4001 (Live) / 4002 (Paper)</div>
            </div>
          </div>

          {/* GCP Console & Environment Export */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="terminal-card border border-border p-4 rounded-xl flex items-center justify-between">
              <div className="space-y-0.5">
                <p className="text-xs font-bold text-primary">Google Cloud Platform Management</p>
                <p className="text-[11px] text-secondary font-mono">
                  Inspect Cloud Run service revisions, Spot VM telemetry, and VPC connector status.
                </p>
              </div>
              <a
                href="https://console.cloud.google.com/run/detail/europe-west3/alpha-engine-aistudio?project=alpha-engine-ai-studio"
                target="_blank"
                rel="noreferrer"
                className="px-3.5 py-2 terminal-elevated hover:bg-elevated border border-border text-primary rounded-lg text-xs font-mono font-bold flex items-center gap-1.5 transition shrink-0"
              >
                <span>GCP Console</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>

            <div className="terminal-card border border-border p-4 rounded-xl flex items-center justify-between">
              <div className="space-y-0.5">
                <p className="text-xs font-bold text-primary">12-Factor POSIX Environment</p>
                <p className="text-[11px] text-secondary font-mono">
                  Export hardened environment variables for <code className="text-indigo-400">/etc/alpha-engine/secrets.env</code>.
                </p>
              </div>
              <button
                type="button"
                onClick={handleCopySecretsEnv}
                className="px-3.5 py-2 bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/40 text-indigo-400 rounded-lg text-xs font-mono font-bold flex items-center gap-1.5 transition cursor-pointer shrink-0"
              >
                {copiedEnv ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedEnv ? "COPIED .ENV" : "COPY SECRETS.ENV"}</span>
              </button>
            </div>
          </div>

          {/* Probe and State Check */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-border">
            <button
              type="button"
              onClick={handleCheckEdgeNode}
              disabled={testResults["cloud"]?.loading}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-mono font-bold flex items-center gap-2 cursor-pointer transition shadow-xs"
            >
              {testResults["cloud"]?.loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Activity className="w-3.5 h-3.5" />}
              Verify Edge Node & Storage Telemetry
            </button>

            {testResults["cloud"] && (
              <span className={`text-xs font-mono font-bold px-2.5 py-1 rounded ${
                testResults["cloud"].success ? "terminal-badge-bid" : "terminal-badge-ask"
              }`}>
                {testResults["cloud"].success ? "Edge Node Connected" : testResults["cloud"].message}
              </span>
            )}
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* TAB 3: AI / LLM INTELLIGENCE ENGINE                            */}
      {/* ============================================================== */}
      {activeTab === "ai" && (
        <div className="space-y-6">
          <div className="terminal-elevated border border-indigo-500/30 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-primary font-bold text-sm">
                <Sparkles className="w-4 h-4 text-indigo-400" />
                <span>Multi-Model AI Consensus Engine & Runtime Discovery</span>
                <span className="text-[10px] terminal-badge-bid px-2 py-0.5 rounded font-mono font-bold uppercase">
                  Zero Hardcoded Models
                </span>
              </div>
              <p className="text-xs text-secondary leading-relaxed font-mono">
                AlphaEngine queries each provider's official <code className="bg-black/20 dark:bg-white/10 px-1 rounded">/models</code> endpoint at runtime. Passing a live probe automatically registers discovered models into Copilot.
              </p>
            </div>
            <button
              type="button"
              onClick={handleAutoFillVerifiedAiKeys}
              className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-mono font-bold flex items-center gap-1.5 cursor-pointer shadow-xs shrink-0 transition"
              title="Auto-fill verified keys from browser persistent vault"
            >
              <Zap className="w-3.5 h-3.5" />
              Restore Browser Keys
            </button>
          </div>

          {/* AI Providers Grid */}
          <div className="space-y-4">
            
            {/* 1. Google Gemini */}
            <div className="terminal-card border border-border rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-blue-500/20 text-blue-400 border border-blue-500/30 flex items-center justify-center font-black text-xs font-mono">G</div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-primary">Google Gemini API</span>
                      <span className="text-[9px] bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 px-2 py-0.5 rounded font-mono font-bold">PRIMARY JUDGE & ROUTER</span>
                      <span className="text-[9px] terminal-badge-bid px-2 py-0.5 rounded font-mono font-bold">FREE TIER (15 RPM)</span>
                    </div>
                  </div>
                </div>
                <a
                  href="https://aistudio.google.com/app/apikey"
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-indigo-400 hover:text-indigo-300 font-mono font-bold flex items-center gap-1 hover:underline"
                >
                  <span>Get Free Key (Google AI Studio)</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>

              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <input
                    type={showKeys["gemini"] ? "text" : "password"}
                    value={geminiKey}
                    onChange={(e) => {
                      const val = e.target.value;
                      dirtyFieldsRef.current.add("geminiKey");
                      setGeminiKey(val);
                      persistVaultItem("geminiApiKey", val);
                    }}
                    placeholder="Paste AIzaSy... Gemini API Key"
                    className="w-full terminal-elevated border border-border rounded-lg px-3 py-2 pr-10 text-xs font-mono text-primary focus:outline-hidden focus:border-indigo-500"
                  />
                  <button
                    type="button"
                    onClick={() => toggleShowKey("gemini")}
                    className="absolute right-3 top-2.5 text-secondary hover:text-primary cursor-pointer"
                  >
                    {showKeys["gemini"] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => runTestProbe("gemini", "/api/test-ai-key", { provider: "gemini", apiKey: geminiKey })}
                  disabled={testResults["gemini"]?.loading}
                  className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-mono font-bold flex items-center gap-1.5 cursor-pointer shadow-xs shrink-0 transition"
                >
                  {testResults["gemini"]?.loading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Activity className="w-3 h-3" />}
                  Test Live Probe
                </button>
              </div>

              {testResults["gemini"] && (
                <div className={`p-3 rounded-lg font-mono text-xs space-y-2 ${
                  testResults["gemini"].success ? "terminal-badge-bid" : "terminal-badge-ask"
                }`}>
                  <div className="flex items-center justify-between">
                    <span>{testResults["gemini"].success ? "✓ " : "✕ "}{testResults["gemini"].message}</span>
                    {testResults["gemini"].latencyMs && <span>{testResults["gemini"].latencyMs}ms</span>}
                  </div>
                  {testResults["gemini"].models && testResults["gemini"].models.length > 0 && (
                    <div className="pt-1 border-t border-current/20 flex flex-wrap gap-1.5 items-center">
                      <span className="text-[10px] uppercase font-bold">Discovered Models:</span>
                      {testResults["gemini"].models.slice(0, 6).map((m: any) => (
                        <span key={m.id} className="text-[10px] bg-black/20 dark:bg-white/20 px-1.5 py-0.5 rounded font-bold">
                          {m.name || m.id}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 2. Groq Cloud (LPU) */}
            <div className="terminal-card border border-border rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center justify-center font-black text-xs font-mono">Q</div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-primary">Groq Cloud (LPU Inference)</span>
                      <span className="text-[9px] bg-amber-500/20 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded font-mono font-bold">HIGH-SPEED CRITIC</span>
                      <span className="text-[9px] terminal-badge-bid px-2 py-0.5 rounded font-mono font-bold">SUB-200MS LATENCY</span>
                    </div>
                  </div>
                </div>
                <a
                  href="https://console.groq.com/keys"
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-indigo-400 hover:text-indigo-300 font-mono font-bold flex items-center gap-1 hover:underline"
                >
                  <span>Get Groq API Key</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>

              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <input
                    type={showKeys["groq"] ? "text" : "password"}
                    value={groqKey}
                    onChange={(e) => {
                      const val = e.target.value;
                      dirtyFieldsRef.current.add("groqKey");
                      setGroqKey(val);
                      persistVaultItem("customAiApiKey", val);
                    }}
                    placeholder="Paste gsk_... Groq API Key"
                    className="w-full terminal-elevated border border-border rounded-lg px-3 py-2 pr-10 text-xs font-mono text-primary focus:outline-hidden focus:border-amber-500"
                  />
                  <button
                    type="button"
                    onClick={() => toggleShowKey("groq")}
                    className="absolute right-3 top-2.5 text-secondary hover:text-primary cursor-pointer"
                  >
                    {showKeys["groq"] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => runTestProbe("groq", "/api/test-ai-key", { provider: "groq", apiKey: groqKey })}
                  disabled={testResults["groq"]?.loading}
                  className="px-3 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-mono font-bold flex items-center gap-1.5 cursor-pointer shadow-xs shrink-0 transition"
                >
                  {testResults["groq"]?.loading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Activity className="w-3 h-3" />}
                  Test Live Probe
                </button>
              </div>

              {testResults["groq"] && (
                <div className={`p-3 rounded-lg font-mono text-xs space-y-2 ${
                  testResults["groq"].success ? "terminal-badge-bid" : "terminal-badge-ask"
                }`}>
                  <div className="flex items-center justify-between">
                    <span>{testResults["groq"].success ? "✓ " : "✕ "}{testResults["groq"].message}</span>
                    {testResults["groq"].latencyMs && <span>{testResults["groq"].latencyMs}ms</span>}
                  </div>
                  {testResults["groq"].models && testResults["groq"].models.length > 0 && (
                    <div className="pt-1 border-t border-current/20 flex flex-wrap gap-1.5 items-center">
                      <span className="text-[10px] uppercase font-bold">Discovered Models:</span>
                      {testResults["groq"].models.slice(0, 6).map((m: any) => (
                        <span key={m.id} className="text-[10px] bg-black/20 dark:bg-white/20 px-1.5 py-0.5 rounded font-bold">
                          {m.name || m.id}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 3. NVIDIA NIM */}
            <div className="terminal-card border border-border rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center font-black text-xs font-mono">N</div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-primary">NVIDIA NIM Microservices</span>
                      <span className="text-[9px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded font-mono font-bold">DEEP QUANT REASONING</span>
                    </div>
                  </div>
                </div>
                <a
                  href="https://build.nvidia.com"
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-indigo-400 hover:text-indigo-300 font-mono font-bold flex items-center gap-1 hover:underline"
                >
                  <span>Get NVIDIA NIM Key</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>

              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <input
                    type={showKeys["nvidia"] ? "text" : "password"}
                    value={nvidiaKey}
                    onChange={(e) => {
                      const val = e.target.value;
                      dirtyFieldsRef.current.add("nvidiaKey");
                      setNvidiaKey(val);
                      persistVaultItem("nvidiaApiKey", val);
                    }}
                    placeholder="Paste nvapi-... NVIDIA NIM API Key"
                    className="w-full terminal-elevated border border-border rounded-lg px-3 py-2 pr-10 text-xs font-mono text-primary focus:outline-hidden focus:border-emerald-500"
                  />
                  <button
                    type="button"
                    onClick={() => toggleShowKey("nvidia")}
                    className="absolute right-3 top-2.5 text-secondary hover:text-primary cursor-pointer"
                  >
                    {showKeys["nvidia"] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => runTestProbe("nvidia", "/api/test-ai-key", { provider: "nvidia", apiKey: nvidiaKey })}
                  disabled={testResults["nvidia"]?.loading}
                  className="px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-mono font-bold flex items-center gap-1.5 cursor-pointer shadow-xs shrink-0 transition"
                >
                  {testResults["nvidia"]?.loading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Activity className="w-3 h-3" />}
                  Test Live Probe
                </button>
              </div>

              {testResults["nvidia"] && (
                <div className={`p-3 rounded-lg font-mono text-xs space-y-2 ${
                  testResults["nvidia"].success ? "terminal-badge-bid" : "terminal-badge-ask"
                }`}>
                  <div className="flex items-center justify-between">
                    <span>{testResults["nvidia"].success ? "✓ " : "✕ "}{testResults["nvidia"].message}</span>
                    {testResults["nvidia"].latencyMs && <span>{testResults["nvidia"].latencyMs}ms</span>}
                  </div>
                  {testResults["nvidia"].models && testResults["nvidia"].models.length > 0 && (
                    <div className="pt-1 border-t border-current/20 flex flex-wrap gap-1.5 items-center">
                      <span className="text-[10px] uppercase font-bold">Discovered Models:</span>
                      {testResults["nvidia"].models.slice(0, 6).map((m: any) => (
                        <span key={m.id} className="text-[10px] bg-black/20 dark:bg-white/20 px-1.5 py-0.5 rounded font-bold">
                          {m.name || m.id}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 4. OpenAI / Anthropic / OpenRouter Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* OpenAI */}
              <div className="terminal-card border border-border rounded-xl p-3.5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-primary">OpenAI Platform</span>
                  <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer" className="text-[10px] text-indigo-400 hover:underline">
                    Get Key
                  </a>
                </div>
                <input
                  type={showKeys["openai"] ? "text" : "password"}
                  value={openaiKey}
                  onChange={(e) => {
                    const val = e.target.value;
                    dirtyFieldsRef.current.add("openaiKey");
                    setOpenaiKey(val);
                    persistVaultItem("openaiApiKey", val);
                  }}
                  placeholder="sk-proj-..."
                  className="w-full terminal-elevated border border-border rounded-lg px-2.5 py-1.5 text-xs font-mono text-primary"
                />
                <button
                  type="button"
                  onClick={() => runTestProbe("openai", "/api/test-ai-key", { provider: "openai", apiKey: openaiKey })}
                  disabled={testResults["openai"]?.loading}
                  className="w-full py-1.5 terminal-elevated hover:bg-elevated text-secondary hover:text-primary border border-border rounded-lg text-xs font-mono font-bold cursor-pointer"
                >
                  {testResults["openai"]?.loading ? "Probing..." : "Test OpenAI Probe"}
                </button>
                {testResults["openai"] && (
                  <div className={`p-2 rounded text-[10px] font-mono ${testResults["openai"].success ? "terminal-badge-bid" : "terminal-badge-ask"}`}>
                    {testResults["openai"].message}
                  </div>
                )}
              </div>

              {/* Anthropic */}
              <div className="terminal-card border border-border rounded-xl p-3.5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-primary">Anthropic Claude</span>
                  <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer" className="text-[10px] text-indigo-400 hover:underline">
                    Get Key
                  </a>
                </div>
                <input
                  type={showKeys["anthropic"] ? "text" : "password"}
                  value={anthropicKey}
                  onChange={(e) => {
                    const val = e.target.value;
                    dirtyFieldsRef.current.add("anthropicKey");
                    setAnthropicKey(val);
                    persistVaultItem("anthropicApiKey", val);
                  }}
                  placeholder="sk-ant-..."
                  className="w-full terminal-elevated border border-border rounded-lg px-2.5 py-1.5 text-xs font-mono text-primary"
                />
                <button
                  type="button"
                  onClick={() => runTestProbe("anthropic", "/api/test-ai-key", { provider: "anthropic", apiKey: anthropicKey })}
                  disabled={testResults["anthropic"]?.loading}
                  className="w-full py-1.5 terminal-elevated hover:bg-elevated text-secondary hover:text-primary border border-border rounded-lg text-xs font-mono font-bold cursor-pointer"
                >
                  {testResults["anthropic"]?.loading ? "Probing..." : "Test Anthropic Probe"}
                </button>
                {testResults["anthropic"] && (
                  <div className={`p-2 rounded text-[10px] font-mono ${testResults["anthropic"].success ? "terminal-badge-bid" : "terminal-badge-ask"}`}>
                    {testResults["anthropic"].message}
                  </div>
                )}
              </div>

              {/* OpenRouter */}
              <div className="terminal-card border border-border rounded-xl p-3.5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-primary">OpenRouter (Unified)</span>
                  <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer" className="text-[10px] text-indigo-400 hover:underline">
                    Get Key
                  </a>
                </div>
                <input
                  type={showKeys["openrouter"] ? "text" : "password"}
                  value={openrouterKey}
                  onChange={(e) => {
                    const val = e.target.value;
                    dirtyFieldsRef.current.add("openrouterKey");
                    setOpenrouterKey(val);
                    persistVaultItem("openrouterApiKey", val);
                  }}
                  placeholder="sk-or-..."
                  className="w-full terminal-elevated border border-border rounded-lg px-2.5 py-1.5 text-xs font-mono text-primary"
                />
                <button
                  type="button"
                  onClick={() => runTestProbe("openrouter", "/api/test-ai-key", { provider: "openrouter", apiKey: openrouterKey })}
                  disabled={testResults["openrouter"]?.loading}
                  className="w-full py-1.5 terminal-elevated hover:bg-elevated text-secondary hover:text-primary border border-border rounded-lg text-xs font-mono font-bold cursor-pointer"
                >
                  {testResults["openrouter"]?.loading ? "Probing..." : "Test OpenRouter Probe"}
                </button>
                {testResults["openrouter"] && (
                  <div className={`p-2 rounded text-[10px] font-mono ${testResults["openrouter"].success ? "terminal-badge-bid" : "terminal-badge-ask"}`}>
                    {testResults["openrouter"].message}
                  </div>
                )}
              </div>
            </div>

            {/* Custom LLM / Ollama */}
            <div className="terminal-card border border-border rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-cyan-500" />
                  <span className="text-xs font-bold text-primary">Custom OpenAI-Compatible / Local Ollama / vLLM Endpoint</span>
                </div>
                <span className="text-[10px] terminal-badge-bid px-2 py-0.5 rounded font-mono font-bold">Tier 0 Local Inference</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-mono font-bold text-secondary uppercase">Base URL:</label>
                  <input
                    type="text"
                    value={customBaseUrl}
                    onChange={(e) => {
                      const val = e.target.value;
                      dirtyFieldsRef.current.add("customBaseUrl");
                      setCustomBaseUrl(val);
                      persistVaultItem("customAiBaseUrl", val);
                    }}
                    placeholder="http://localhost:11434/v1"
                    className="w-full terminal-elevated border border-border rounded-lg px-3 py-1.5 text-xs font-mono text-primary"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-mono font-bold text-secondary uppercase">Model Identifier:</label>
                  <input
                    type="text"
                    value={customModelName}
                    onChange={(e) => {
                      const val = e.target.value;
                      dirtyFieldsRef.current.add("customModelName");
                      setCustomModelName(val);
                      persistVaultItem("customAiModelName", val);
                    }}
                    placeholder="llama3.1 or mistral"
                    className="w-full terminal-elevated border border-border rounded-lg px-3 py-1.5 text-xs font-mono text-primary"
                  />
                </div>
              </div>
            </div>

          </div>

          {/* Save AI Preferences Action Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-border">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-500" />
              <span className="text-xs text-secondary font-mono">
                Keys persist permanently across browser sessions and cloud container lifecycles.
              </span>
            </div>
            <div className="flex items-center gap-3">
              {aiSavedMsg && (
                <span className="text-xs font-mono text-emerald-500 dark:text-[#00ff88] font-bold">
                  ✓ {aiSavedMsg}
                </span>
              )}
              <button
                type="button"
                onClick={handleSaveAiKeys}
                disabled={isSavingAi}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-mono font-bold flex items-center gap-2 cursor-pointer transition shadow-md"
              >
                {isSavingAi ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                Save AI Key Preferences
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* TAB 4: REGULATORY & DATA FEEDS                                 */}
      {/* ============================================================== */}
      {activeTab === "feeds" && (
        <div className="space-y-6">
          <div className="terminal-elevated border border-emerald-500/30 rounded-xl p-4 flex items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-primary font-bold text-sm">
                <Radio className="w-4 h-4 text-emerald-500" />
                <span>Orthogonal Regulatory, Macro & Catalyst Data Feeds</span>
                <span className="text-[10px] terminal-badge-bid px-2 py-0.5 rounded font-mono font-bold uppercase">
                  Primary Institutional Feeds
                </span>
              </div>
              <p className="text-xs text-secondary leading-relaxed font-mono">
                AlphaEngine ingests event catalysts directly from primary government and regulatory APIs. Retail scrapers are strictly banned under Institutional Rule #8.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            
            {/* 1. SEC EDGAR */}
            <div className="terminal-card border border-border rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-emerald-500" />
                  <span className="text-xs font-bold text-primary">SEC EDGAR Primary Submissions</span>
                </div>
                <span className="text-[9px] terminal-badge-bid px-2 py-0.5 rounded font-mono font-bold">
                  FREE / OFFICIAL
                </span>
              </div>
              <p className="text-[11px] text-secondary font-mono leading-relaxed">
                Fetches real-time 8-K material events and 10-Q earnings filings. The SEC strictly requires a compliant User-Agent header containing your institutional contact email.
              </p>
              <input
                type="text"
                value={secUserAgent}
                onChange={(e) => {
                  const val = e.target.value;
                  dirtyFieldsRef.current.add("secUserAgent");
                  setSecUserAgent(val);
                  persistVaultItem("secUserAgent", val);
                }}
                placeholder="AlphaEngine/2.0 (contact@internal.domain)"
                className="w-full terminal-elevated border border-border rounded-lg px-3 py-1.5 text-xs font-mono text-primary"
              />
              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={() => runTestProbe("sec", "/api/test-feed-probe", { feedType: "sec" })}
                  disabled={testResults["sec"]?.loading}
                  className="px-3 py-1.5 terminal-elevated hover:bg-elevated border border-border rounded-lg text-xs font-mono font-bold text-primary flex items-center gap-1.5 cursor-pointer"
                >
                  {testResults["sec"]?.loading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Activity className="w-3 h-3" />}
                  Test SEC Feed
                </button>
                {testResults["sec"] && (
                  <span className={`text-[10px] font-mono ${testResults["sec"].success ? "text-emerald-500" : "text-rose-500"}`}>
                    {testResults["sec"].message}
                  </span>
                )}
              </div>
            </div>

            {/* 2. openFDA */}
            <div className="terminal-card border border-border rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Dna className="w-4 h-4 text-cyan-500" />
                  <span className="text-xs font-bold text-primary">openFDA Drug Approvals & Recalls</span>
                </div>
                <a href="https://open.fda.gov/apis/authentication/" target="_blank" rel="noreferrer" className="text-[10px] text-indigo-400 hover:underline">
                  Get Free Key
                </a>
              </div>
              <p className="text-[11px] text-secondary font-mono leading-relaxed">
                Real-time drug approvals, black-box warnings, and device recalls. API key raises the rate ceiling from 240 req/hr to 120,000 req/day.
              </p>
              <input
                type="text"
                value={openFdaKey}
                onChange={(e) => {
                  const val = e.target.value;
                  dirtyFieldsRef.current.add("openFdaKey");
                  setOpenFdaKey(val);
                  persistVaultItem("openFdaApiKey", val);
                }}
                placeholder="Paste openFDA Key (Optional for high volume)"
                className="w-full terminal-elevated border border-border rounded-lg px-3 py-1.5 text-xs font-mono text-primary"
              />
              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={() => runTestProbe("openfda", "/api/test-feed-probe", { feedType: "openfda", apiKey: openFdaKey })}
                  disabled={testResults["openfda"]?.loading}
                  className="px-3 py-1.5 terminal-elevated hover:bg-elevated border border-border rounded-lg text-xs font-mono font-bold text-primary flex items-center gap-1.5 cursor-pointer"
                >
                  {testResults["openfda"]?.loading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Activity className="w-3 h-3" />}
                  Test openFDA Feed
                </button>
                {testResults["openfda"] && (
                  <span className={`text-[10px] font-mono ${testResults["openfda"].success ? "text-emerald-500" : "text-rose-500"}`}>
                    {testResults["openfda"].message}
                  </span>
                )}
              </div>
            </div>

            {/* 3. FRED Macro */}
            <div className="terminal-card border border-border rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Scale className="w-4 h-4 text-amber-500" />
                  <span className="text-xs font-bold text-primary">FRED Macroeconomic Telemetry</span>
                </div>
                <a href="https://fred.stlouisfed.org/docs/api/api_key.html" target="_blank" rel="noreferrer" className="text-[10px] text-indigo-400 hover:underline">
                  Get Free Key
                </a>
              </div>
              <p className="text-[11px] text-secondary font-mono leading-relaxed">
                Federal Reserve Economic Data: 10Y/2Y Treasury yield curves, Fed Funds Effective Rate, CPI inflation, and Non-Farm Payrolls.
              </p>
              <input
                type="text"
                value={fredKey}
                onChange={(e) => {
                  const val = e.target.value;
                  dirtyFieldsRef.current.add("fredKey");
                  setFredKey(val);
                  persistVaultItem("fredApiKey", val);
                }}
                placeholder="Paste 32-character FRED API Key"
                className="w-full terminal-elevated border border-border rounded-lg px-3 py-1.5 text-xs font-mono text-primary"
              />
              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={() => runTestProbe("fred", "/api/test-feed-probe", { feedType: "fred", apiKey: fredKey })}
                  disabled={testResults["fred"]?.loading}
                  className="px-3 py-1.5 terminal-elevated hover:bg-elevated border border-border rounded-lg text-xs font-mono font-bold text-primary flex items-center gap-1.5 cursor-pointer"
                >
                  {testResults["fred"]?.loading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Activity className="w-3 h-3" />}
                  Test FRED Feed
                </button>
                {testResults["fred"] && (
                  <span className={`text-[10px] font-mono ${testResults["fred"].success ? "text-emerald-500" : "text-rose-500"}`}>
                    {testResults["fred"].message}
                  </span>
                )}
              </div>
            </div>

            {/* 4. ClinicalTrials.gov */}
            <div className="terminal-card border border-border rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-purple-500" />
                  <span className="text-xs font-bold text-primary">ClinicalTrials.gov API v2</span>
                </div>
                <span className="text-[9px] terminal-badge-bid px-2 py-0.5 rounded font-mono font-bold">
                  NO KEY REQUIRED
                </span>
              </div>
              <p className="text-[11px] text-secondary font-mono leading-relaxed">
                Biotech trial phase transitions, primary completion date shifts, and FDA expedited designations.
              </p>
              <div className="flex items-center justify-between pt-4">
                <button
                  type="button"
                  onClick={() => runTestProbe("clinicaltrials", "/api/test-feed-probe", { feedType: "clinicaltrials" })}
                  disabled={testResults["clinicaltrials"]?.loading}
                  className="px-3 py-1.5 terminal-elevated hover:bg-elevated border border-border rounded-lg text-xs font-mono font-bold text-primary flex items-center gap-1.5 cursor-pointer"
                >
                  {testResults["clinicaltrials"]?.loading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Activity className="w-3 h-3" />}
                  Test ClinicalTrials Feed
                </button>
                {testResults["clinicaltrials"] && (
                  <span className={`text-[10px] font-mono ${testResults["clinicaltrials"].success ? "text-emerald-500" : "text-rose-500"}`}>
                    {testResults["clinicaltrials"].message}
                  </span>
                )}
              </div>
            </div>

          </div>

          {/* Save Feeds Action Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-border">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-500" />
              <span className="text-xs text-secondary font-mono">
                Feeds are queried at microsecond intervals during pre-market and market sessions.
              </span>
            </div>
            <div className="flex items-center gap-3">
              {feedSavedMsg && (
                <span className="text-xs font-mono text-emerald-500 dark:text-[#00ff88] font-bold">
                  ✓ {feedSavedMsg}
                </span>
              )}
              <button
                type="button"
                onClick={handleSaveFeedSettings}
                disabled={isSavingFeeds}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-mono font-bold flex items-center gap-2 cursor-pointer transition shadow-md"
              >
                {isSavingFeeds ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                Save Feed Preferences
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  // If in Modal Mode: wrap inside fixed backdrop overlay
  if (isModal) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-in fade-in duration-200 font-sans">
        <div className="terminal-card border border-border rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
          {/* Modal Header */}
          <div className="p-4 sm:p-5 border-b border-border flex items-center justify-between bg-elevated">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-sm sm:text-base font-bold text-primary font-mono tracking-tight flex items-center gap-2">
                  4-PILLAR CONNECTION & FEED VAULT
                </h2>
                <p className="text-xs text-secondary font-mono mt-0.5">
                  Consolidated credentials, direct acquisition guides, and interactive live test probes
                </p>
              </div>
            </div>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="text-secondary hover:text-primary transition-colors p-2 hover:bg-elevated rounded-full cursor-pointer"
                title="Close Vault"
              >
                <XCircle className="w-6 h-6" />
              </button>
            )}
          </div>

          {/* Modal Body */}
          <div className="p-6 overflow-y-auto space-y-6 flex-1">
            {renderVaultContent()}
          </div>

          {/* Modal Footer */}
          <div className="px-6 py-4 bg-elevated border-t border-border flex items-center justify-between text-xs font-mono">
            <div className="flex items-center gap-2 text-secondary">
              <ShieldCheck className="w-4 h-4 text-emerald-500" />
              <span>Credentials strictly isolated in-memory and local encrypted storage.</span>
            </div>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 terminal-elevated hover:bg-elevated text-primary font-bold rounded-xl border border-border transition cursor-pointer"
              >
                Done & Close
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Full Page Mode: render directly into workspace with Executive Ribbon
  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* 1. Executive Institutional Header Ribbon */}
      <div className="terminal-card rounded-xl p-5 border border-border flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs bg-indigo-500/20 text-indigo-400 font-mono font-bold px-2.5 py-1 rounded border border-indigo-500/30">
              CENTRAL CREDENTIAL AUTHORITY & 12-FACTOR VAULT
            </span>
            <span className="text-xs text-secondary font-mono font-semibold">Zero Hardcoding • Microsecond Persistence</span>
          </div>
          <h2 className="text-base sm:text-lg font-extrabold text-primary font-mono mt-1.5 flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-indigo-400" /> 4-Pillar Infrastructure, Brokerage & AI Gateway
          </h2>
          <p className="text-xs text-secondary font-sans mt-0.5 max-w-3xl leading-relaxed">
            Manage institutional connectivity parameters across IBKR DMA sockets, Frankfurt GCP Spot execution VM, runtime AI model discovery, and secondary macro/biotech regulatory feeds.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleAutoFillVerifiedAiKeys}
            className="px-3.5 py-2 rounded-lg bg-indigo-600/20 border border-indigo-500/40 hover:bg-indigo-600/30 text-indigo-400 font-mono text-xs font-bold transition flex items-center gap-2 cursor-pointer"
          >
            <Zap className="w-3.5 h-3.5" />
            <span>RESTORE BROWSER KEYS</span>
          </button>
          <button
            type="button"
            onClick={handleProbeAll}
            disabled={isProbingAll}
            className="px-3.5 py-2 rounded-lg bg-emerald-600/20 border border-emerald-500/40 hover:bg-emerald-600/30 text-emerald-400 font-mono text-xs font-bold transition flex items-center gap-2 cursor-pointer"
          >
            <Activity className={`w-3.5 h-3.5 ${isProbingAll ? "animate-spin" : ""}`} />
            <span>{isProbingAll ? "PROBING..." : "PROBE ACTIVE SERVICES"}</span>
          </button>
          <button
            type="button"
            onClick={handleCopySecretsEnv}
            className="px-3.5 py-2 rounded-lg terminal-elevated hover:bg-elevated border border-border text-primary font-mono text-xs font-bold transition flex items-center gap-2 cursor-pointer"
          >
            {copiedEnv ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copiedEnv ? "COPIED .ENV" : "COPY SECRETS.ENV"}</span>
          </button>
        </div>
      </div>

      {/* 2. Main Vault Body */}
      <div className="terminal-card rounded-xl p-5 border border-border">
        {renderVaultContent()}
      </div>
    </div>
  );
};

export default VaultConsole;
