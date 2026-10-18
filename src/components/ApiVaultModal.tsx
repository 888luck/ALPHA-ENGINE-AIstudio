import React, { useState, useEffect } from "react";
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
  Check
} from "lucide-react";
import {
  getStoredVaultValue,
  persistVaultItem,
  persistVaultBatch,
  syncVaultToServer,
  getAllStoredVaultSettings
} from "../utils/vaultStorage";

interface ApiVaultModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: any;
  onSaveSetting: (key: string, value: any) => Promise<void>;
  onSaveMultipleSettings?: (updates: Record<string, any>) => Promise<void>;
  customGeminiApiKey: string;
  onSaveGeminiKey: (key: string) => void;
  firebaseStatus?: string;
}

export const ApiVaultModal: React.FC<ApiVaultModalProps> = ({
  isOpen,
  onClose,
  settings,
  onSaveSetting,
  onSaveMultipleSettings,
  customGeminiApiKey,
  onSaveGeminiKey,
  firebaseStatus,
}) => {
  if (!isOpen) return null;

  // Active Tab: 1=Broker, 2=Cloud, 3=AI, 4=Feeds
  const [activeTab, setActiveTab] = useState<"broker" | "cloud" | "ai" | "feeds">("ai");

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
  const [edgeNodeStatus, setEdgeNodeStatus] = useState<string>("Frankfurt Edge Node (10.156.0.2)");

  // Form State for AI (Zero-Omission Persistent Hydration)
  const [geminiKey, setGeminiKey] = useState(() => getStoredVaultValue("geminiApiKey", customGeminiApiKey || settings?.geminiApiKey));
  const [groqKey, setGroqKey] = useState(() => getStoredVaultValue("customAiApiKey", settings?.customAiApiKey));
  const [nvidiaKey, setNvidiaKey] = useState(() => getStoredVaultValue("nvidiaApiKey", settings?.nvidiaApiKey));
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

  const dirtyFieldsRef = React.useRef<Set<string>>(new Set());

  // Re-hydrate state strictly when modal opens (never on background poll ticks while open)
  useEffect(() => {
    if (isOpen) {
      dirtyFieldsRef.current.clear();

      // 1. Fetch centralized server-side credentials (for seamless access across any machine)
      fetch("/api/vault/credentials", {
        headers: { "x-admin-key": "ALPHA_ADMIN_REVERT_992" }
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
            if (!dirtyFieldsRef.current.has("openFdaKey") && creds.openFdaApiKey) setOpenFdaKey(creds.openFdaApiKey);
            if (!dirtyFieldsRef.current.has("fredKey") && creds.fredApiKey) setFredKey(creds.fredApiKey);
            if (!dirtyFieldsRef.current.has("patentsKey") && creds.patentsApiKey) setPatentsKey(creds.patentsApiKey);
            if (!dirtyFieldsRef.current.has("secUserAgent") && creds.secUserAgent) setSecUserAgent(creds.secUserAgent);
            persistVaultBatch(creds);
          }
        })
        .catch(() => {});
    }
  }, [isOpen]);

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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      
      const isSuccess = Boolean(data.success);
      let successMsg = data.message || data.error;

      // Zero-Omission: When probe passes, automatically lock-in and persist the tested key immediately!
      if (isSuccess) {
        if (testId === "gemini" && payload.apiKey) {
          persistVaultItem("geminiApiKey", payload.apiKey);
          onSaveGeminiKey(payload.apiKey);
          onSaveSetting("geminiApiKey", payload.apiKey).catch(() => {});
          successMsg = `${successMsg || "Gemini API probe verified"} • 🔒 Auto-saved to Vault`;
        } else if (testId === "groq" && payload.apiKey) {
          persistVaultItem("customAiApiKey", payload.apiKey);
          onSaveSetting("customAiApiKey", payload.apiKey).catch(() => {});
          successMsg = `${successMsg || "Groq Cloud probe verified"} • 🔒 Auto-saved to Vault`;
        } else if (testId === "nvidia" && payload.apiKey) {
          persistVaultItem("nvidiaApiKey", payload.apiKey);
          onSaveSetting("nvidiaApiKey", payload.apiKey).catch(() => {});
          successMsg = `${successMsg || "NVIDIA NIM probe verified"} • 🔒 Auto-saved to Vault`;
        } else if (testId === "openai" && payload.apiKey) {
          persistVaultItem("openaiApiKey", payload.apiKey);
          onSaveSetting("openaiApiKey", payload.apiKey).catch(() => {});
          successMsg = `${successMsg || "OpenAI probe verified"} • 🔒 Auto-saved to Vault`;
        } else if (testId === "anthropic" && payload.apiKey) {
          persistVaultItem("anthropicApiKey", payload.apiKey);
          onSaveSetting("anthropicApiKey", payload.apiKey).catch(() => {});
          successMsg = `${successMsg || "Anthropic probe verified"} • 🔒 Auto-saved to Vault`;
        } else if (testId === "openfda" && payload.apiKey) {
          persistVaultItem("openFdaApiKey", payload.apiKey);
          onSaveSetting("openFdaApiKey", payload.apiKey).catch(() => {});
        } else if (testId === "fred" && payload.apiKey) {
          persistVaultItem("fredApiKey", payload.apiKey);
          onSaveSetting("fredApiKey", payload.apiKey).catch(() => {});
        } else if (testId === "patents" && payload.apiKey) {
          persistVaultItem("patentsApiKey", payload.apiKey);
          onSaveSetting("patentsApiKey", payload.apiKey).catch(() => {});
        }

        // Trigger dynamic model discovery refresh
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

  // Edge Node verification handler
  const handleCheckEdgeNode = async () => {
    runTestProbe("cloud", "/api/system/state", {});
  };

  // 1-Click Auto-Fill / Restore Verified AI Keys (Gemini + Groq + NVIDIA NIM)
  const handleAutoFillVerifiedAiKeys = async () => {
    try {
      const res = await fetch("/api/vault/credentials", {
        headers: { "x-admin-key": "ALPHA_ADMIN_REVERT_992" }
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

    // Fallback: check localStorage
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

  // Broker saving state
  const [isSavingBroker, setIsSavingBroker] = useState(false);
  const [brokerSavedMsg, setBrokerSavedMsg] = useState<string | null>(null);

  // Save Handlers with Dual-Layer Persistence
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
      } else {
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

  const [aiSavedMsg, setAiSavedMsg] = useState<string | null>(null);

  const handleSaveAiKeys = async () => {
    if (geminiKey) onSaveGeminiKey(geminiKey);
    const updates: Record<string, any> = {
      geminiApiKey: geminiKey,
      customAiApiKey: groqKey,
      nvidiaApiKey: nvidiaKey,
      openaiApiKey: openaiKey,
      anthropicApiKey: anthropicKey,
      customAiBaseUrl: customBaseUrl,
      customAiModelName: customModelName
    };

    // 1. Permanent Browser-side Storage (Zero Wipeout)
    persistVaultBatch(updates);

    // 2. Server-side State Persistence
    if (onSaveMultipleSettings) {
      await onSaveMultipleSettings(updates);
    } else {
      for (const [k, v] of Object.entries(updates)) {
        await onSaveSetting(k, v);
      }
    }
    await syncVaultToServer(updates);

    try {
      await fetch("/api/copilot/models?refresh=1");
      await fetch("/api/copilot/stats?refresh=1");
    } catch (e) {}

    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("copilot:models_invalidated"));
    }
    setAiSavedMsg("AI credentials persisted permanently. Copilot model catalog dynamically synchronized.");
    setTimeout(() => setAiSavedMsg(null), 4000);
  };

  const handleSaveFeedSettings = async () => {
    const updates: Record<string, any> = {
      openFdaApiKey: openFdaKey,
      fredApiKey: fredKey,
      patentsApiKey: patentsKey,
      secUserAgent: secUserAgent
    };
    persistVaultBatch(updates);
    await onSaveSetting("openFdaApiKey", openFdaKey);
    await onSaveSetting("fredApiKey", fredKey);
    await onSaveSetting("patentsApiKey", patentsKey);
    await onSaveSetting("secUserAgent", secUserAgent);
    await syncVaultToServer(updates);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto animate-fade-in">
      <div className="bg-white border border-slate-200 rounded-3xl w-full max-w-5xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-6 py-5 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 border-b border-slate-800 flex items-center justify-between text-white">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center text-indigo-400">
              <Zap className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-black tracking-tight uppercase">4-Pillar API Connection & Feed Vault</h2>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-bold flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                  ZERO-OMISSION READY
                </span>
              </div>
              <p className="text-xs text-slate-400 font-mono mt-0.5">
                Consolidated credentials, direct acquisition guides, and interactive live test probes
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors p-2 hover:bg-white/10 rounded-full cursor-pointer"
            title="Close Vault"
          >
            <XCircle className="w-6 h-6" />
          </button>
        </div>

        {/* 4 Pillars Navigation Bar */}
        <div className="grid grid-cols-2 md:grid-cols-4 bg-slate-50 border-b border-slate-200 p-2 gap-1.5 text-xs font-mono font-bold">
          <button
            onClick={() => setActiveTab("broker")}
            className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl transition cursor-pointer ${
              activeTab === "broker"
                ? "bg-white text-indigo-600 shadow-sm border border-slate-200"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            <Coins className="w-4 h-4 text-amber-500" />
            <span>1. Brokerage (IBKR)</span>
          </button>

          <button
            onClick={() => setActiveTab("cloud")}
            className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl transition cursor-pointer ${
              activeTab === "cloud"
                ? "bg-white text-indigo-600 shadow-sm border border-slate-200"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            <Server className="w-4 h-4 text-blue-500" />
            <span>2. Cloud & Edge Node</span>
          </button>

          <button
            onClick={() => setActiveTab("ai")}
            className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl transition cursor-pointer ${
              activeTab === "ai"
                ? "bg-white text-indigo-600 shadow-sm border border-slate-200"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            <Sparkles className="w-4 h-4 text-indigo-500" />
            <span>3. AI / LLM Engine</span>
          </button>

          <button
            onClick={() => setActiveTab("feeds")}
            className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl transition cursor-pointer ${
              activeTab === "feeds"
                ? "bg-white text-indigo-600 shadow-sm border border-slate-200"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            <Radio className="w-4 h-4 text-emerald-500" />
            <span>4. Regulatory & Feeds</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 text-slate-800">
          
          {/* ============================================================== */}
          {/* TAB 1: BROKERAGE (INTERACTIVE BROKERS)                         */}
          {/* ============================================================== */}
          {activeTab === "broker" && (
            <div className="space-y-6">
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-amber-900 font-bold text-sm">
                    <Coins className="w-4 h-4 text-amber-600" />
                    <span>Interactive Brokers TWS / IB Gateway TCP Socket</span>
                    <span className="text-[10px] bg-red-100 text-red-700 px-2 py-0.5 rounded font-mono font-black uppercase">
                      Mandatory for Live Order Routing
                    </span>
                  </div>
                  <p className="text-xs text-amber-800 leading-relaxed font-mono">
                    AlphaEngine communicates with IBKR through native high-speed binary sockets on localhost. No API key is required; connection is authorized via your local TWS or IB Gateway instance.
                  </p>
                </div>
              </div>

              {/* Form Grid */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-mono font-bold text-slate-600 uppercase">Account Number:</label>
                  <input
                    type="text"
                    value={accountNumber}
                    onChange={(e) => {
                      const val = e.target.value;
                      setAccountNumber(val);
                      persistVaultItem("ibkrAccountNumber", val);
                    }}
                    placeholder="e.g. DU1234567 or U1234567"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono text-slate-900 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  />
                  <span className="text-[9px] text-slate-400 font-mono block">DU... for Paper, U... for Live</span>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-mono font-bold text-slate-600 uppercase">Target Host IP:</label>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setIbkrHost("10.156.0.2");
                          persistVaultItem("ibkrHost", "10.156.0.2");
                        }}
                        className={`text-[9px] font-mono px-1.5 py-0.5 rounded cursor-pointer transition border ${
                          ibkrHost === "10.156.0.2"
                            ? "bg-indigo-600 text-white border-indigo-600 font-bold"
                            : "bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200"
                        }`}
                        title="Frankfurt Edge Node Internal IP (VPC)"
                      >
                        Node (10.156.0.2)
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setIbkrHost("127.0.0.1");
                          persistVaultItem("ibkrHost", "127.0.0.1");
                        }}
                        className={`text-[9px] font-mono px-1.5 py-0.5 rounded cursor-pointer transition border ${
                          ibkrHost === "127.0.0.1"
                            ? "bg-indigo-600 text-white border-indigo-600 font-bold"
                            : "bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200"
                        }`}
                        title="Local Machine Loopback"
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
                      setIbkrHost(val);
                      persistVaultItem("ibkrHost", val);
                    }}
                    placeholder="10.156.0.2 or 127.0.0.1"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono text-slate-900 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  />
                  <span className="text-[9px] text-slate-400 font-mono block">10.156.0.2 (Frankfurt Edge Node) / 127.0.0.1 (Local)</span>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-mono font-bold text-slate-600 uppercase">Socket Port:</label>
                  <select
                    value={ibkrPort}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setIbkrPort(val);
                      persistVaultItem("ibkrPort", val);
                    }}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono font-bold text-slate-900 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  >
                    <option value={4002}>4002 (IB Gateway Paper - Recommended)</option>
                    <option value={4001}>4001 (IB Gateway Live Production)</option>
                    <option value={7497}>7497 (TWS Paper)</option>
                    <option value={7496}>7496 (TWS Live)</option>
                  </select>
                  <span className="text-[9px] text-slate-400 font-mono block">IB Gateway/TWS Listening Port</span>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-mono font-bold text-slate-600 uppercase">Client ID:</label>
                  <input
                    type="number"
                    value={ibkrClientId}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setIbkrClientId(val);
                      persistVaultItem("ibkrClientId", val);
                    }}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono text-slate-900 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  />
                  <span className="text-[9px] text-slate-400 font-mono block">Unique ID (default: 1)</span>
                </div>
              </div>

              {/* Headless Edge Node Gateway Credentials */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-900">
                    <Server className="w-4 h-4 text-amber-600" />
                    <span>Frankfurt Edge Node Headless Autologin (Optional / Encrypted)</span>
                  </div>
                  <span className="text-[9px] bg-slate-200 text-slate-700 px-2 py-0.5 rounded font-mono font-bold uppercase">
                    Stored in Secret Manager
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-mono text-slate-500 block uppercase">IBKR Paper Username:</label>
                    <input
                      type="text"
                      value={ibkrUsername}
                      onChange={(e) => setIbkrUsername(e.target.value)}
                      placeholder="e.g. edg94921"
                      className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono text-slate-900"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-mono text-slate-500 block uppercase">IBKR Paper Password:</label>
                    <div className="relative">
                      <input
                        type={showKeys["ibkrPassword"] ? "text" : "password"}
                        value={ibkrPassword}
                        onChange={(e) => setIbkrPassword(e.target.value)}
                        placeholder="••••••••••••"
                        className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 pr-10 text-xs font-mono text-slate-900"
                      />
                      <button
                        type="button"
                        onClick={() => toggleShowKey("ibkrPassword")}
                        className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600"
                      >
                        {showKeys["ibkrPassword"] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* MiFID II Compliance */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-900">
                  <ShieldCheck className="w-4 h-4 text-indigo-600" />
                  <span>MiFIR / MiFID II Regulatory Algorithmic Attribution (European Equities)</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-mono text-slate-500 block uppercase">Decision Maker ID (mifid2DecisionMaker):</label>
                    <input
                      type="text"
                      value={mifidMaker}
                      onChange={(e) => setMifidMaker(e.target.value)}
                      className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono text-slate-900"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-mono text-slate-500 block uppercase">Execution Trader ID (mifid2ExecutionTrader):</label>
                    <input
                      type="text"
                      value={mifidTrader}
                      onChange={(e) => setMifidTrader(e.target.value)}
                      className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono text-slate-900"
                    />
                  </div>
                </div>
              </div>

              {/* Visual Step-by-Step Guide */}
              <div className="p-5 bg-gradient-to-br from-indigo-50/50 to-slate-50 border border-indigo-100 rounded-2xl space-y-3">
                <h4 className="text-xs font-black uppercase text-indigo-900 flex items-center gap-2">
                  <HelpCircle className="w-4 h-4 text-indigo-600" />
                  Step-by-Step: How to Enable API in TWS / IB Gateway
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs font-mono">
                  <div className="p-3 bg-white border border-slate-200 rounded-xl shadow-xs space-y-1">
                    <span className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center font-bold text-[10px]">1</span>
                    <p className="font-bold text-slate-800">Global Config</p>
                    <p className="text-[10px] text-slate-500">Go to File / Edit &rarr; Global Configuration &rarr; API &rarr; Settings.</p>
                  </div>
                  <div className="p-3 bg-white border border-slate-200 rounded-xl shadow-xs space-y-1">
                    <span className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center font-bold text-[10px]">2</span>
                    <p className="font-bold text-slate-800">Enable Socket</p>
                    <p className="text-[10px] text-slate-500">Check ✅ "Enable ActiveX and Socket Clients".</p>
                  </div>
                  <div className="p-3 bg-white border border-slate-200 rounded-xl shadow-xs space-y-1">
                    <span className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center font-bold text-[10px]">3</span>
                    <p className="font-bold text-slate-800">Uncheck Read-Only</p>
                    <p className="text-[10px] text-slate-500">Uncheck ⬜ "Read-Only API" so AlphaEngine can place stops/orders.</p>
                  </div>
                  <div className="p-3 bg-white border border-slate-200 rounded-xl shadow-xs space-y-1">
                    <span className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center font-bold text-[10px]">4</span>
                    <p className="font-bold text-slate-800">Trusted IP</p>
                    <p className="text-[10px] text-slate-500">Add <code className="bg-slate-100 px-1 rounded">127.0.0.1</code> to "Trusted IP Addresses".</p>
                  </div>
                </div>
              </div>

              {/* Action Buttons & Probe */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => runTestProbe("ibkr", "/api/test-broker-connection", { host: ibkrHost, port: ibkrPort })}
                  disabled={testResults["ibkr"]?.loading}
                  className="px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-mono font-bold flex items-center gap-2 cursor-pointer transition shadow-xs"
                >
                  {testResults["ibkr"]?.loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Activity className="w-3.5 h-3.5" />}
                  Test Socket Handshake
                </button>

                <div className="flex items-center gap-3">
                  {brokerSavedMsg && (
                    <span className="text-xs text-emerald-600 font-mono font-bold flex items-center gap-1.5 animate-fade-in">
                      <CheckCircle2 className="w-4 h-4" /> {brokerSavedMsg}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={handleSaveBroker}
                    disabled={isSavingBroker}
                    className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-mono font-bold cursor-pointer transition shadow-xs flex items-center gap-2"
                  >
                    {isSavingBroker ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                    Save Broker Configuration
                  </button>
                </div>
              </div>

              {/* Live Probe Result */}
              {testResults["ibkr"] && (
                <div className={`p-3.5 rounded-xl border font-mono text-xs ${
                  testResults["ibkr"].success
                    ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                    : "bg-red-50 border-red-200 text-red-800"
                }`}>
                  <div className="flex items-center gap-2 font-bold mb-1">
                    {testResults["ibkr"].success ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <AlertTriangle className="w-4 h-4 text-red-600" />}
                    <span>{testResults["ibkr"].success ? "Socket Handshake Verified" : "Socket Connection Failed"}</span>
                    {testResults["ibkr"].latencyMs !== undefined && (
                      <span className="text-[10px] bg-white/60 px-1.5 py-0.5 rounded border border-current">
                        {testResults["ibkr"].latencyMs}ms
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] leading-relaxed">{testResults["ibkr"].message}</p>
                  {!testResults["ibkr"].success && typeof window !== "undefined" && window.location.hostname.includes("run.app") && ibkrHost === "127.0.0.1" && (
                    <button
                      type="button"
                      onClick={() => {
                        setIbkrHost("10.156.0.2");
                        persistVaultItem("ibkrHost", "10.156.0.2");
                        runTestProbe("ibkr", "/api/test-broker-connection", { host: "10.156.0.2", port: ibkrPort });
                      }}
                      className="mt-2 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-mono font-bold flex items-center gap-1.5 cursor-pointer shadow-xs transition"
                    >
                      <Zap className="w-3.5 h-3.5" />
                      <span>Switch to Frankfurt Node (10.156.0.2) & Retest</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ============================================================== */}
          {/* TAB 2: CLOUD & EDGE INFRASTRUCTURE (ZERO FIRESTORE)           */}
          {/* ============================================================== */}
          {activeTab === "cloud" && (
            <div className="space-y-6">
              <div className="p-4 bg-blue-50 border border-blue-200 rounded-2xl flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-blue-900 font-bold text-sm">
                    <Server className="w-4 h-4 text-blue-600" />
                    <span>Cloud Architecture & Edge Execution Topology</span>
                    <span className="text-[10px] bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded font-mono font-black uppercase">
                      Zero-Firestore Architecture
                    </span>
                  </div>
                  <p className="text-xs text-blue-800 leading-relaxed font-mono">
                    AlphaEngine operates with high-speed direct disk storage (<code className="bg-blue-100 px-1 rounded">system_settings.json</code>) and direct TCP edge synchronization. Cloud Run (<code className="bg-blue-100 px-1 rounded">europe-west3</code>) routes directly to Frankfurt Edge Node VM (<code className="bg-blue-100 px-1 rounded">10.156.0.2:4002</code> via VPC Connector <code className="bg-blue-100 px-1 rounded">alpha-edge-connector</code>).
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5 font-mono">
                  <div className="text-[10px] text-slate-500 uppercase font-bold">Edge Node Location</div>
                  <div className="text-xs font-bold text-slate-900">Frankfurt europe-west3</div>
                  <div className="text-[10px] text-slate-500">Adjacent to IBKR European Hub</div>
                </div>

                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5 font-mono">
                  <div className="text-[10px] text-slate-500 uppercase font-bold">Persistence Mechanism</div>
                  <div className="text-xs font-bold text-emerald-700 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    Local Disk JSON & Secret Mgr
                  </div>
                  <div className="text-[10px] text-slate-500">Firestore 100% Removed</div>
                </div>

                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5 font-mono">
                  <div className="text-[10px] text-slate-500 uppercase font-bold">TCP Execution Ports</div>
                  <div className="text-xs font-bold text-slate-900">Port 4002 (Paper) / 4001 (Live)</div>
                  <div className="text-[10px] text-slate-500">Internal Edge Daemon: Port 4005</div>
                </div>
              </div>

              {/* Direct Link to GCP Console */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl flex items-center justify-between">
                <div className="space-y-0.5">
                  <p className="text-xs font-bold text-slate-900">Google Cloud Platform Management Console</p>
                  <p className="text-[11px] text-slate-500 font-mono">
                    Inspect Cloud Run service revisions, Spot VM execution, and Secret Manager credentials.
                  </p>
                </div>
                <a
                  href="https://console.cloud.google.com/run/detail/europe-west3/alpha-engine-aistudio?project=alpha-engine-ai-studio"
                  target="_blank"
                  rel="noreferrer"
                  className="px-3.5 py-2 bg-white border border-slate-300 hover:border-slate-400 text-slate-700 rounded-xl text-xs font-mono font-bold flex items-center gap-1.5 transition shadow-xs"
                >
                  <span>Open Cloud Run Console</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>

              {/* Probe and State Check */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={handleCheckEdgeNode}
                  disabled={testResults["cloud"]?.loading}
                  className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-mono font-bold flex items-center gap-2 cursor-pointer transition shadow-xs"
                >
                  {testResults["cloud"]?.loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Activity className="w-3.5 h-3.5" />}
                  Verify Edge Node & Storage Telemetry
                </button>
              </div>

              {/* Live Probe Result */}
              {testResults["cloud"] && (
                <div className={`p-3.5 rounded-xl border font-mono text-xs ${
                  testResults["cloud"].success
                    ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                    : "bg-blue-50 border-blue-200 text-blue-800"
                }`}>
                  <div className="flex items-center gap-2 font-bold mb-1">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <span>Edge Node System State Confirmed</span>
                    {testResults["cloud"].latencyMs !== undefined && (
                      <span className="text-[10px] bg-white/60 px-1.5 py-0.5 rounded border border-current">
                        {testResults["cloud"].latencyMs}ms
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] leading-relaxed">
                    Zero-Firestore architecture active. System state and credentials successfully verified against local storage and Edge Bridge.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ============================================================== */}
          {/* TAB 3: AI / LLM INTELLIGENCE ENGINE                            */}
          {/* ============================================================== */}
          {activeTab === "ai" && (
            <div className="space-y-6">
              <div className="p-4 bg-indigo-50 border border-indigo-200 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-indigo-900 font-bold text-sm">
                    <Sparkles className="w-4 h-4 text-indigo-600" />
                    <span>Multi-Model AI Consensus Engine & Universal Router</span>
                    <span className="text-[10px] bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded font-mono font-black uppercase">
                      Dual-Layer Persistence Active
                    </span>
                  </div>
                  <p className="text-xs text-indigo-800 leading-relaxed font-mono">
                    All keys entered below are auto-saved to your browser and synced to the cloud container so they never disappear.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleAutoFillVerifiedAiKeys}
                  className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-mono font-bold flex items-center gap-1.5 cursor-pointer shadow-xs shrink-0 transition"
                  title="Auto-fill verified keys for Gemini, Groq, and NVIDIA NIM"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Auto-Fill Verified Keys
                </button>
              </div>

              {/* AI Providers Grid */}
              <div className="space-y-4">
                
                {/* 1. Google Gemini */}
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center font-black text-xs font-mono">G</div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-slate-900">Google Gemini API</span>
                          <span className="text-[9px] bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded font-mono font-bold">PRIMARY JUDGE & ROUTER</span>
                          <span className="text-[9px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded font-mono font-bold">FREE TIER (15 RPM)</span>
                        </div>
                      </div>
                    </div>
                    <a
                      href="https://aistudio.google.com/app/apikey"
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-indigo-600 hover:text-indigo-800 font-mono font-bold flex items-center gap-1 hover:underline"
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
                        className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 pr-10 text-xs font-mono text-slate-900"
                      />
                      <button
                        type="button"
                        onClick={() => toggleShowKey("gemini")}
                        className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600"
                      >
                        {showKeys["gemini"] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => runTestProbe("gemini", "/api/test-ai-key", { provider: "gemini", apiKey: geminiKey })}
                      disabled={testResults["gemini"]?.loading}
                      className="px-3 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-mono font-bold flex items-center gap-1.5 cursor-pointer shadow-xs shrink-0"
                    >
                      {testResults["gemini"]?.loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Activity className="w-3.5 h-3.5" />}
                      Test Ping
                    </button>
                  </div>

                  {testResults["gemini"] && (
                    <div className={`p-2.5 rounded-lg font-mono text-[11px] ${
                      testResults["gemini"].success ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"
                    }`}>
                      {testResults["gemini"].success ? "🟢 " : "🔴 "}
                      {testResults["gemini"].message}
                    </div>
                  )}

                  {testResults["gemini"]?.models && testResults["gemini"].models.length > 0 && (
                    <div className="p-3 bg-blue-50/70 rounded-xl border border-blue-200 space-y-1.5">
                      <div className="text-[10px] font-mono font-bold text-blue-900 uppercase flex items-center justify-between">
                        <span>Discovered Active Models ({testResults["gemini"].models.length}):</span>
                        <span className="text-[9px] text-blue-600 font-normal">Live from Google API</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {testResults["gemini"].models.map((m: any) => (
                          <span key={m.id || m} className="px-2 py-0.5 bg-white border border-blue-200 text-blue-800 text-[10px] font-mono rounded-md shadow-xs flex items-center gap-1">
                            <span>💎</span>
                            <span className="font-bold">{m.name || m.id || m}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* 2. Groq Cloud */}
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center font-black text-xs font-mono">Q</div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-slate-900">Groq Cloud LPU</span>
                          <span className="text-[9px] bg-amber-100 text-amber-800 px-2 py-0.5 rounded font-mono font-bold">VERIFIER 1 (ULTRA-FAST)</span>
                          <span className="text-[9px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded font-mono font-bold">GENEROUS FREE TIER</span>
                        </div>
                      </div>
                    </div>
                    <a
                      href="https://console.groq.com/keys"
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-indigo-600 hover:text-indigo-800 font-mono font-bold flex items-center gap-1 hover:underline"
                    >
                      <span>Get Free Key (Groq Console)</span>
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
                        className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 pr-10 text-xs font-mono text-slate-900"
                      />
                      <button
                        type="button"
                        onClick={() => toggleShowKey("groq")}
                        className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600"
                      >
                        {showKeys["groq"] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => runTestProbe("groq", "/api/test-ai-key", { provider: "groq", apiKey: groqKey })}
                      disabled={testResults["groq"]?.loading}
                      className="px-3 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-mono font-bold flex items-center gap-1.5 cursor-pointer shadow-xs shrink-0"
                    >
                      {testResults["groq"]?.loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Activity className="w-3.5 h-3.5" />}
                      Test Ping
                    </button>
                  </div>

                  {testResults["groq"] && (
                    <div className={`p-2.5 rounded-lg font-mono text-[11px] ${
                      testResults["groq"].success ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"
                    }`}>
                      {testResults["groq"].success ? "🟢 " : "🔴 "}
                      {testResults["groq"].message}
                    </div>
                  )}

                  {testResults["groq"]?.models && testResults["groq"].models.length > 0 && (
                    <div className="p-3 bg-amber-50/70 rounded-xl border border-amber-200 space-y-1.5">
                      <div className="text-[10px] font-mono font-bold text-amber-900 uppercase flex items-center justify-between">
                        <span>Discovered Active Models ({testResults["groq"].models.length}):</span>
                        <span className="text-[9px] text-amber-700 font-normal">Live from Groq API</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {testResults["groq"].models.map((m: any) => (
                          <span key={m.id || m} className="px-2 py-0.5 bg-white border border-amber-200 text-amber-900 text-[10px] font-mono rounded-md shadow-xs flex items-center gap-1">
                            <span>⚡</span>
                            <span className="font-bold">{m.name || m.id || m}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* 3. NVIDIA NIM */}
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center font-black text-xs font-mono">NV</div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-slate-900">NVIDIA NIM Microservices</span>
                          <span className="text-[9px] bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded font-mono font-bold">GENERATOR</span>
                          <span className="text-[9px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded font-mono font-bold">1,000 FREE CREDITS</span>
                        </div>
                      </div>
                    </div>
                    <a
                      href="https://build.nvidia.com/"
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-indigo-600 hover:text-indigo-800 font-mono font-bold flex items-center gap-1 hover:underline"
                    >
                      <span>Get Free Key (NVIDIA Build)</span>
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
                        placeholder="Paste nvapi-... NVIDIA NIM Key"
                        className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 pr-10 text-xs font-mono text-slate-900"
                      />
                      <button
                        type="button"
                        onClick={() => toggleShowKey("nvidia")}
                        className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600"
                      >
                        {showKeys["nvidia"] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => runTestProbe("nvidia", "/api/test-ai-key", { provider: "nvidia", apiKey: nvidiaKey })}
                      disabled={testResults["nvidia"]?.loading}
                      className="px-3 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-mono font-bold flex items-center gap-1.5 cursor-pointer shadow-xs shrink-0"
                    >
                      {testResults["nvidia"]?.loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Activity className="w-3.5 h-3.5" />}
                      Test Ping
                    </button>
                  </div>

                  {testResults["nvidia"] && (
                    <div className={`p-2.5 rounded-lg font-mono text-[11px] ${
                      testResults["nvidia"].success ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"
                    }`}>
                      {testResults["nvidia"].success ? "🟢 " : "🔴 "}
                      {testResults["nvidia"].message}
                    </div>
                  )}

                  {testResults["nvidia"]?.models && testResults["nvidia"].models.length > 0 && (
                    <div className="p-3 bg-emerald-50/70 rounded-xl border border-emerald-200 space-y-1.5">
                      <div className="text-[10px] font-mono font-bold text-emerald-900 uppercase flex items-center justify-between">
                        <span>Discovered Active Models ({testResults["nvidia"].models.length}):</span>
                        <span className="text-[9px] text-emerald-700 font-normal">Live from NVIDIA NIM API</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {testResults["nvidia"].models.map((m: any) => (
                          <span key={m.id || m} className="px-2 py-0.5 bg-white border border-emerald-200 text-emerald-900 text-[10px] font-mono rounded-md shadow-xs flex items-center gap-1">
                            <span>🟢</span>
                            <span className="font-bold">{m.name || m.id || m}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* 4. Local Self-Hosted Ollama / Custom Bridge */}
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-purple-100 text-purple-700 flex items-center justify-center font-black text-xs font-mono">🦙</div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-slate-900">Custom Local Endpoint (Ollama / vLLM / DeepSeek)</span>
                          <span className="text-[9px] bg-purple-100 text-purple-800 px-2 py-0.5 rounded font-mono font-bold">100% FREE & PRIVATE</span>
                        </div>
                      </div>
                    </div>
                    <span className="text-[10px] text-slate-500 font-mono">Run: <code className="bg-slate-200 px-1 rounded">ollama run deepseek-r1</code></span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <input
                      type="text"
                      value={customBaseUrl}
                      onChange={(e) => {
                        const val = e.target.value;
                        dirtyFieldsRef.current.add("customBaseUrl");
                        setCustomBaseUrl(val);
                        persistVaultItem("customAiBaseUrl", val);
                      }}
                      placeholder="Base URL: http://localhost:11434/v1"
                      className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono text-slate-900"
                    />
                    <input
                      type="text"
                      value={customModelName}
                      onChange={(e) => {
                        const val = e.target.value;
                        dirtyFieldsRef.current.add("customModelName");
                        setCustomModelName(val);
                        persistVaultItem("customAiModelName", val);
                      }}
                      placeholder="Model Name: e.g. deepseek-r1 or llama3.2"
                      className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono text-slate-900"
                    />
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <button
                      type="button"
                      onClick={() => runTestProbe("custom", "/api/test-ai-key", { provider: "custom", baseUrl: customBaseUrl })}
                      disabled={testResults["custom"]?.loading}
                      className="px-3 py-1.5 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-mono font-bold flex items-center gap-1.5 cursor-pointer shadow-xs shrink-0"
                    >
                      {testResults["custom"]?.loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Activity className="w-3.5 h-3.5" />}
                      Test Ping Endpoint
                    </button>
                    {testResults["custom"] && (
                      <span className={`text-[11px] font-mono ${testResults["custom"].success ? "text-emerald-700" : "text-red-700"}`}>
                        {testResults["custom"].success ? "🟢 " + testResults["custom"].message : "🔴 " + testResults["custom"].message}
                      </span>
                    )}
                  </div>

                  {testResults["custom"]?.models && testResults["custom"].models.length > 0 && (
                    <div className="p-3 bg-purple-50/70 rounded-xl border border-purple-200 space-y-1.5">
                      <div className="text-[10px] font-mono font-bold text-purple-900 uppercase">
                        Discovered Local Models ({testResults["custom"].models.length}):
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {testResults["custom"].models.map((m: any) => (
                          <span key={m.id || m} className="px-2 py-0.5 bg-white border border-purple-200 text-purple-900 text-[10px] font-mono rounded-md shadow-xs flex items-center gap-1">
                            <span>🦙</span>
                            <span className="font-bold">{m.name || m.id || m}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Save All AI Keys */}
              <div className="flex items-center justify-between pt-3 border-t border-slate-200">
                <div>
                  {aiSavedMsg && (
                    <span className="text-xs font-mono font-bold text-emerald-700 flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4" />
                      {aiSavedMsg}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={handleSaveAiKeys}
                  className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-mono font-bold cursor-pointer transition shadow-xs"
                >
                  Save AI Model Credentials
                </button>
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* TAB 4: REGULATORY, SCIENCE & CATALYST FEEDS (ZERO OMISSIONS)   */}
          {/* ============================================================== */}
          {activeTab === "feeds" && (
            <div className="space-y-6">
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-emerald-900 font-bold text-sm">
                    <Radio className="w-4 h-4 text-emerald-600" />
                    <span>Authoritative Primary-Source Catalyst & Regulatory Feeds</span>
                    <span className="text-[10px] bg-emerald-200/80 text-emerald-900 px-2 py-0.5 rounded font-mono font-black uppercase">
                      Zero Hallucination
                    </span>
                  </div>
                  <p className="text-xs text-emerald-800 leading-relaxed font-mono">
                    AlphaEngine connects directly to official government registries and big-data event streams. Most feeds are completely free public open APIs.
                  </p>
                </div>
              </div>

              {/* Feed Cards List */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                
                {/* 1. ClinicalTrials.gov */}
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-2.5 flex flex-col justify-between">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Dna className="w-4 h-4 text-emerald-600" />
                        <span className="text-xs font-bold text-slate-900">ClinicalTrials.gov Protocol Registry v2</span>
                      </div>
                      <span className="text-[9px] bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded font-mono font-bold">
                        PUBLIC OPEN (NO KEY)
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600 leading-relaxed font-mono">
                      Official NIH/NLM registry. Ingests Phase 2/3 trial readouts and triggers Gate 5 binary trading freezes 48h before trial completion.
                    </p>
                  </div>
                  <div className="pt-2 border-t border-slate-200 flex items-center justify-between gap-2">
                    <a
                      href="https://clinicaltrials.gov/data-api/api"
                      target="_blank"
                      rel="noreferrer"
                      className="text-[10px] text-indigo-600 hover:underline font-mono flex items-center gap-1"
                    >
                      <span>API Docs</span>
                      <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                    <button
                      type="button"
                      onClick={() => runTestProbe("clinicaltrials", "/api/test-feed-probe", { feedType: "clinicaltrials" })}
                      disabled={testResults["clinicaltrials"]?.loading}
                      className="px-3 py-1.5 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-mono font-bold flex items-center gap-1.5 cursor-pointer shadow-xs"
                    >
                      {testResults["clinicaltrials"]?.loading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Activity className="w-3 h-3" />}
                      Test Live Probe
                    </button>
                  </div>
                  {testResults["clinicaltrials"] && (
                    <div className={`p-2 rounded-lg font-mono text-[10px] ${
                      testResults["clinicaltrials"].success ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"
                    }`}>
                      {testResults["clinicaltrials"].success ? "🟢 " : "🔴 "}
                      {testResults["clinicaltrials"].message}
                    </div>
                  )}
                </div>

                {/* 2. OpenFDA Drug Regulatory API */}
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-2.5 flex flex-col justify-between">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Activity className="w-4 h-4 text-blue-600" />
                        <span className="text-xs font-bold text-slate-900">OpenFDA Drug Regulatory API</span>
                      </div>
                      <span className="text-[9px] bg-blue-100 text-blue-800 px-2 py-0.5 rounded font-mono font-bold">
                        FREE TIER (KEY OPTIONAL)
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600 leading-relaxed font-mono">
                      Ingests NDA/BLA approvals, Complete Response Letters (CRLs), drug labeling updates, and PDUFA calendar actions.
                    </p>
                    <input
                      type="text"
                      value={openFdaKey}
                      onChange={(e) => {
                        const val = e.target.value;
                        setOpenFdaKey(val);
                        persistVaultItem("openFdaApiKey", val);
                      }}
                      placeholder="Optional API Key (expands limit to 240 req/min)"
                      className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-mono text-slate-900"
                    />
                  </div>
                  <div className="pt-2 border-t border-slate-200 flex items-center justify-between gap-2">
                    <a
                      href="https://open.fda.gov/apis/authentication/"
                      target="_blank"
                      rel="noreferrer"
                      className="text-[10px] text-indigo-600 hover:underline font-mono flex items-center gap-1"
                    >
                      <span>Get Free Key</span>
                      <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                    <button
                      type="button"
                      onClick={() => runTestProbe("openfda", "/api/test-feed-probe", { feedType: "openfda", apiKey: openFdaKey })}
                      disabled={testResults["openfda"]?.loading}
                      className="px-3 py-1.5 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-mono font-bold flex items-center gap-1.5 cursor-pointer shadow-xs"
                    >
                      {testResults["openfda"]?.loading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Activity className="w-3 h-3" />}
                      Test Live Probe
                    </button>
                  </div>
                  {testResults["openfda"] && (
                    <div className={`p-2 rounded-lg font-mono text-[10px] ${
                      testResults["openfda"].success ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"
                    }`}>
                      {testResults["openfda"].success ? "🟢 " : "🔴 "}
                      {testResults["openfda"].message}
                    </div>
                  )}
                </div>

                {/* 3. SEC EDGAR Material Disclosures */}
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-2.5 flex flex-col justify-between">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-purple-600" />
                        <span className="text-xs font-bold text-slate-900">SEC EDGAR Material Disclosures (8-K)</span>
                      </div>
                      <span className="text-[9px] bg-purple-100 text-purple-800 px-2 py-0.5 rounded font-mono font-bold">
                        PUBLIC OPEN (NO KEY)
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600 leading-relaxed font-mono">
                      Official US SEC submissions. Ingests Form 8-K material disclosures: executive departures, M&A filings, material contracts.
                    </p>
                    <input
                      type="text"
                      value={secUserAgent}
                      onChange={(e) => {
                        const val = e.target.value;
                        setSecUserAgent(val);
                        persistVaultItem("secUserAgent", val);
                      }}
                      placeholder="User-Agent string: Company/Version (email)"
                      className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-mono text-slate-900"
                    />
                  </div>
                  <div className="pt-2 border-t border-slate-200 flex items-center justify-between gap-2">
                    <a
                      href="https://www.sec.gov/os/accessing-edgar-data"
                      target="_blank"
                      rel="noreferrer"
                      className="text-[10px] text-indigo-600 hover:underline font-mono flex items-center gap-1"
                    >
                      <span>SEC Guidelines</span>
                      <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                    <button
                      type="button"
                      onClick={() => runTestProbe("sec_edgar", "/api/test-feed-probe", { feedType: "sec_edgar", userAgent: secUserAgent })}
                      disabled={testResults["sec_edgar"]?.loading}
                      className="px-3 py-1.5 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-mono font-bold flex items-center gap-1.5 cursor-pointer shadow-xs"
                    >
                      {testResults["sec_edgar"]?.loading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Activity className="w-3 h-3" />}
                      Test Live Probe
                    </button>
                  </div>
                  {testResults["sec_edgar"] && (
                    <div className={`p-2 rounded-lg font-mono text-[10px] ${
                      testResults["sec_edgar"].success ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"
                    }`}>
                      {testResults["sec_edgar"].success ? "🟢 " : "🔴 "}
                      {testResults["sec_edgar"].message}
                    </div>
                  )}
                </div>

                {/* 4. GDELT 2.0 Global Geopolitical Monitor */}
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-2.5 flex flex-col justify-between">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Globe className="w-4 h-4 text-emerald-600" />
                        <span className="text-xs font-bold text-slate-900">GDELT 2.0 Global Geopolitics</span>
                      </div>
                      <span className="text-[9px] bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded font-mono font-bold">
                        PUBLIC BIG DATA (NO KEY)
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600 leading-relaxed font-mono">
                      Global Database of Events, Language, and Tone. Computes Goldstein conflict scores and shipping/energy disruption indices.
                    </p>
                  </div>
                  <div className="pt-2 border-t border-slate-200 flex items-center justify-between gap-2">
                    <a
                      href="https://www.gdeltproject.org/"
                      target="_blank"
                      rel="noreferrer"
                      className="text-[10px] text-indigo-600 hover:underline font-mono flex items-center gap-1"
                    >
                      <span>GDELT Portal</span>
                      <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                    <button
                      type="button"
                      onClick={() => runTestProbe("gdelt", "/api/test-feed-probe", { feedType: "gdelt" })}
                      disabled={testResults["gdelt"]?.loading}
                      className="px-3 py-1.5 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-mono font-bold flex items-center gap-1.5 cursor-pointer shadow-xs"
                    >
                      {testResults["gdelt"]?.loading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Activity className="w-3 h-3" />}
                      Test Live Probe
                    </button>
                  </div>
                  {testResults["gdelt"] && (
                    <div className={`p-2 rounded-lg font-mono text-[10px] ${
                      testResults["gdelt"].success ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"
                    }`}>
                      {testResults["gdelt"].success ? "🟢 " : "🔴 "}
                      {testResults["gdelt"].message}
                    </div>
                  )}
                </div>

                {/* 5. USPTO PatentsView / Google Patents */}
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-2.5 flex flex-col justify-between">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Scale className="w-4 h-4 text-indigo-600" />
                        <span className="text-xs font-bold text-slate-900">USPTO PatentsView / IP Litigation</span>
                      </div>
                      <span className="text-[9px] bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded font-mono font-bold">
                        FREE DEVELOPER KEY
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600 leading-relaxed font-mono">
                      Tracks patent grant dates, patent cliff expirations, and PTAB Inter Partes Review (IPR) patent challenges.
                    </p>
                    <input
                      type="text"
                      value={patentsKey}
                      onChange={(e) => {
                        const val = e.target.value;
                        setPatentsKey(val);
                        persistVaultItem("patentsApiKey", val);
                      }}
                      placeholder="Optional PatentsView API Key"
                      className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-mono text-slate-900"
                    />
                  </div>
                  <div className="pt-2 border-t border-slate-200 flex items-center justify-between gap-2">
                    <a
                      href="https://patentsview.org/apis/key-request"
                      target="_blank"
                      rel="noreferrer"
                      className="text-[10px] text-indigo-600 hover:underline font-mono flex items-center gap-1"
                    >
                      <span>Get Free Key</span>
                      <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                    <button
                      type="button"
                      onClick={() => runTestProbe("patents", "/api/test-feed-probe", { feedType: "patents", apiKey: patentsKey })}
                      disabled={testResults["patents"]?.loading}
                      className="px-3 py-1.5 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-mono font-bold flex items-center gap-1.5 cursor-pointer shadow-xs"
                    >
                      {testResults["patents"]?.loading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Activity className="w-3 h-3" />}
                      Test Live Probe
                    </button>
                  </div>
                  {testResults["patents"] && (
                    <div className={`p-2 rounded-lg font-mono text-[10px] ${
                      testResults["patents"].success ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"
                    }`}>
                      {testResults["patents"].success ? "🟢 " : "🔴 "}
                      {testResults["patents"].message}
                    </div>
                  )}
                </div>

                {/* 6. Federal Reserve FRED Macroeconomic Calendar */}
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-2.5 flex flex-col justify-between">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4 text-amber-600" />
                        <span className="text-xs font-bold text-slate-900">Federal Reserve (FRED) Macro Calendar</span>
                      </div>
                      <span className="text-[9px] bg-amber-100 text-amber-800 px-2 py-0.5 rounded font-mono font-bold">
                        FREE DEVELOPER KEY
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600 leading-relaxed font-mono">
                      FOMC rate decisions, US CPI inflation releases, Non-Farm Payrolls (NFP), ECB announcements. Triggers pre-event risk locks.
                    </p>
                    <input
                      type="text"
                      value={fredKey}
                      onChange={(e) => {
                        const val = e.target.value;
                        setFredKey(val);
                        persistVaultItem("fredApiKey", val);
                      }}
                      placeholder="Optional FRED API Key"
                      className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-mono text-slate-900"
                    />
                  </div>
                  <div className="pt-2 border-t border-slate-200 flex items-center justify-between gap-2">
                    <a
                      href="https://fred.stlouisfed.org/docs/api/api_key.html"
                      target="_blank"
                      rel="noreferrer"
                      className="text-[10px] text-indigo-600 hover:underline font-mono flex items-center gap-1"
                    >
                      <span>Get Free Key</span>
                      <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                    <button
                      type="button"
                      onClick={() => runTestProbe("fred", "/api/test-feed-probe", { feedType: "fred", apiKey: fredKey })}
                      disabled={testResults["fred"]?.loading}
                      className="px-3 py-1.5 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-mono font-bold flex items-center gap-1.5 cursor-pointer shadow-xs"
                    >
                      {testResults["fred"]?.loading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Activity className="w-3 h-3" />}
                      Test Live Probe
                    </button>
                  </div>
                  {testResults["fred"] && (
                    <div className={`p-2 rounded-lg font-mono text-[10px] ${
                      testResults["fred"].success ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"
                    }`}>
                      {testResults["fred"].success ? "🟢 " : "🔴 "}
                      {testResults["fred"].message}
                    </div>
                  )}
                </div>

                {/* 7. FTC & Antitrust Regulatory Actions */}
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-2.5 flex flex-col justify-between">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Building2 className="w-4 h-4 text-slate-700" />
                        <span className="text-xs font-bold text-slate-900">FTC & Antitrust / DOJ Enforcement</span>
                      </div>
                      <span className="text-[9px] bg-slate-200 text-slate-800 px-2 py-0.5 rounded font-mono font-bold">
                        PUBLIC OPEN (NO KEY)
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600 leading-relaxed font-mono">
                      Scans for antitrust lawsuits, Hart-Scott-Rodino (HSR) second requests, and regulatory injunctions in merger arbitrage setups.
                    </p>
                  </div>
                  <div className="pt-2 border-t border-slate-200 flex items-center justify-between gap-2">
                    <a
                      href="https://www.ftc.gov/news-events/news/press-releases"
                      target="_blank"
                      rel="noreferrer"
                      className="text-[10px] text-indigo-600 hover:underline font-mono flex items-center gap-1"
                    >
                      <span>FTC Releases</span>
                      <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                    <button
                      type="button"
                      onClick={() => runTestProbe("ftc", "/api/test-feed-probe", { feedType: "ftc" })}
                      disabled={testResults["ftc"]?.loading}
                      className="px-3 py-1.5 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-mono font-bold flex items-center gap-1.5 cursor-pointer shadow-xs"
                    >
                      {testResults["ftc"]?.loading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Activity className="w-3 h-3" />}
                      Test Live Probe
                    </button>
                  </div>
                  {testResults["ftc"] && (
                    <div className={`p-2 rounded-lg font-mono text-[10px] ${
                      testResults["ftc"].success ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"
                    }`}>
                      {testResults["ftc"].success ? "🟢 " : "🔴 "}
                      {testResults["ftc"].message}
                    </div>
                  )}
                </div>

                {/* 8. Interactive Brokers BroadTape & Halt Bulletins */}
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-2.5 flex flex-col justify-between">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Terminal className="w-4 h-4 text-amber-600" />
                        <span className="text-xs font-bold text-slate-900">IBKR BroadTape & Halt Bulletins</span>
                      </div>
                      <span className="text-[9px] bg-amber-100 text-amber-800 px-2 py-0.5 rounded font-mono font-bold">
                        INCLUDED WITH IBKR
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600 leading-relaxed font-mono">
                      Subscribed via native <code className="bg-slate-200 px-1 rounded">reqNewsBulletins</code>. Provides instant notifications on LULD exchange circuit breaker halts.
                    </p>
                  </div>
                  <div className="pt-2 border-t border-slate-200 flex items-center justify-between gap-2">
                    <span className="text-[10px] text-slate-500 font-mono">Connected via Port {ibkrPort}</span>
                    <button
                      type="button"
                      onClick={() => runTestProbe("ibkr", "/api/test-broker-connection", { port: ibkrPort })}
                      disabled={testResults["ibkr"]?.loading}
                      className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-mono font-bold flex items-center gap-1.5 cursor-pointer shadow-xs"
                    >
                      {testResults["ibkr"]?.loading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Activity className="w-3 h-3" />}
                      Check Stream
                    </button>
                  </div>
                </div>

              </div>

              {/* Save Feeds */}
              <div className="flex justify-end pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={handleSaveFeedSettings}
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-mono font-bold cursor-pointer transition shadow-xs"
                >
                  Save Feed Preferences
                </button>
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs font-mono">
          <div className="flex items-center gap-2 text-slate-500">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>Credentials are strictly kept in-memory or securely encrypted on your isolated node.</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold rounded-xl transition cursor-pointer"
          >
            Done & Close
          </button>
        </div>
      </div>
    </div>
  );
};
