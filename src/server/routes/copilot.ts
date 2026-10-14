import { Router } from "express";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { systemSettings } from "../state";

export const copilotRouter = Router();

// Locate Python executable dynamically
function getPythonExecutable(): string {
  if (process.platform === "win32") {
    const py312 = "C:\\Users\\Misha\\AppData\\Local\\Programs\\Python\\Python312\\python.exe";
    if (fs.existsSync(py312)) return py312;
    return "python";
  }
  return "python3";
}

function getCopilotScriptPath(): string {
  const p1 = path.join(process.cwd(), "backend", "app", "api", "copilot.py");
  if (fs.existsSync(p1)) return p1;
  const p2 = path.join(process.cwd(), "..", "backend", "app", "api", "copilot.py");
  if (fs.existsSync(p2)) return p2;
  return p1;
}

export interface DiscoveredModel {
  id: string;
  rawId: string;
  name: string;
  provider: string;
  tier: string;
  badge: string;
  costStr: string;
  icon: string;
}

let cachedDiscoveredModels: DiscoveredModel[] = [];
let modelsCacheTimestamp = 0;

export function invalidateModelsCache() {
  cachedDiscoveredModels = [];
  modelsCacheTimestamp = 0;
}

export async function discoverActiveModels(forceRefresh = false): Promise<DiscoveredModel[]> {
  const now = Date.now();
  const cacheTtl = cachedDiscoveredModels.length > 1 ? 300000 : 2000;
  if (!forceRefresh && cachedDiscoveredModels.length > 0 && now - modelsCacheTimestamp < cacheTtl) {
    return cachedDiscoveredModels;
  }

  const models: DiscoveredModel[] = [];

  // 1. Local Tier 0 INT8 FinBERT (Always available offline, $0 cost)
  models.push({
    id: "local/finbert-int8",
    rawId: "finbert-int8",
    name: "INT8 ONNX FinBERT (CPU Offline)",
    provider: "Local Tier 0",
    tier: "Tier 0 Offline",
    badge: "$0 Cost / <15ms",
    costStr: "$0.00 (Offline)",
    icon: "🛡️"
  });

  // 2. Google GenAI (Query live API if key is present)
  const geminiKey = (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== "MY_GEMINI_API_KEY") 
    ? process.env.GEMINI_API_KEY 
    : systemSettings.geminiApiKey;
  if (geminiKey && geminiKey.length > 20 && !geminiKey.includes("MY_GEMINI")) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${geminiKey}`, {
        signal: AbortSignal.timeout(4000)
      });
      if (res.ok) {
        const data = await res.json();
        const raw = data.models || [];
        raw
          .filter((m: any) => m.supportedGenerationMethods?.includes("generateContent"))
          .forEach((m: any) => {
            const cleanId = m.name?.replace(/^models\//, "");
            models.push({
              id: `google/${cleanId}`,
              rawId: cleanId,
              name: m.displayName || cleanId,
              provider: "Google GenAI",
              tier: cleanId.includes("flash") ? "Tier 1 Next-Gen" : "Tier 2 Deep Reasoning",
              badge: "Live Discovered",
              costStr: cleanId.includes("flash") ? "$0.10 / 1M tokens" : "$1.25 / 1M tokens",
              icon: "💎"
            });
          });
      }
    } catch (e) {
      console.warn("[COPILOT DISCOVERY] Error querying Google GenAI /models:", e);
    }
  }

  // 3. Groq Cloud (Query live API if key is present)
  const groqKey = process.env.GROQ_API_KEY || systemSettings.customAiApiKey;
  if (groqKey) {
    try {
      const res = await fetch("https://api.groq.com/openai/v1/models", {
        headers: { Authorization: `Bearer ${groqKey}` },
        signal: AbortSignal.timeout(4000)
      });
      if (res.ok) {
        const data = await res.json();
        const raw = data.data || [];
        raw
          .filter((m: any) => m.active !== false && !m.id?.includes("whisper"))
          .forEach((m: any) => {
            models.push({
              id: `groq/${m.id}`,
              rawId: m.id,
              name: m.id,
              provider: "Groq",
              tier: m.id.includes("70b") ? "Tier 1 LPU" : "Tier 0.5 LPU",
              badge: "Live Discovered",
              costStr: "$0.59 / 1M tokens",
              icon: "⚡"
            });
          });
      }
    } catch (e) {
      console.warn("[COPILOT DISCOVERY] Error querying Groq /models:", e);
    }
  }

  // 4. NVIDIA NIM (Query live API if key is present)
  const nvidiaKey = process.env.NVIDIA_API_KEY || process.env.NVIDIA_INFERENCE_API_KEY || systemSettings.nvidiaApiKey;
  if (nvidiaKey) {
    try {
      const res = await fetch("https://integrate.api.nvidia.com/v1/models", {
        headers: { Authorization: `Bearer ${nvidiaKey}` },
        signal: AbortSignal.timeout(4000)
      });
      if (res.ok) {
        const data = await res.json();
        const raw = data.data || [];
        raw.forEach((m: any) => {
          models.push({
            id: `nvidia/${m.id}`,
            rawId: m.id,
            name: m.id,
            provider: "NVIDIA NIM",
            tier: "Tier 1 NIM",
            badge: "Live Discovered",
            costStr: "$0.70 / 1M tokens",
            icon: "🟢"
          });
        });
      }
    } catch (e) {
      console.warn("[COPILOT DISCOVERY] Error querying NVIDIA NIM /models:", e);
    }
  }

  // 5. OpenAI (Query live API if key is present)
  const openaiKey = process.env.OPENAI_API_KEY || systemSettings.openaiApiKey;
  if (openaiKey && openaiKey.startsWith("sk-")) {
    try {
      const res = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${openaiKey}` },
        signal: AbortSignal.timeout(4000)
      });
      if (res.ok) {
        const data = await res.json();
        const raw = data.data || [];
        raw
          .filter((m: any) => m.id?.startsWith("gpt-") || m.id?.startsWith("o1"))
          .forEach((m: any) => {
            models.push({
              id: `openai/${m.id}`,
              rawId: m.id,
              name: m.id,
              provider: "OpenAI",
              tier: "Tier 1 Frontier",
              badge: "Live Discovered",
              costStr: "$2.50 / 1M tokens",
              icon: "🧠"
            });
          });
      }
    } catch (e) {
      console.warn("[COPILOT DISCOVERY] Error querying OpenAI /models:", e);
    }
  }

  cachedDiscoveredModels = models;
  modelsCacheTimestamp = now;
  return models;
}

// 1. GET /api/copilot/models - Return discovered active models
copilotRouter.get("/api/copilot/models", async (req, res) => {
  const force = req.query.refresh === "1" || req.query.refresh === "true";
  const models = await discoverActiveModels(force);
  res.json({
    status: "SUCCESS",
    models: models
  });
});

// 2. GET /api/copilot/stats - Daily telemetry, cost, free-tier quotas & circuit breaker status
copilotRouter.get("/api/copilot/stats", async (req, res) => {
  const quotaPath = path.join(process.cwd(), "backend", "app", "api", "copilot_quota_state.json");
  const fallbackQuotaPath = path.join(process.cwd(), "..", "backend", "app", "api", "copilot_quota_state.json");
  const targetPath = fs.existsSync(quotaPath) ? quotaPath : (fs.existsSync(fallbackQuotaPath) ? fallbackQuotaPath : null);

  let state: any = {
    daily_spent_usd: 0.00000,
    daily_requests: 0,
    daily_quota: 1500,
    daily_budget_ceiling_usd: 1.00,
    circuit_breaker_active: false,
    provider_counts: { Groq: 0, "Google GenAI": 0, "NVIDIA NIM": 0, "Local Tier 0": 0 }
  };

  if (targetPath) {
    try {
      const data = JSON.parse(fs.readFileSync(targetPath, "utf-8"));
      state.daily_spent_usd = data.total_cost_usd || 0.0;
      state.daily_requests = data.total_requests || 0;
      state.daily_budget_ceiling_usd = data.daily_budget_ceiling || 1.0;
      state.circuit_breaker_active = state.daily_spent_usd >= state.daily_budget_ceiling_usd;
      state.provider_counts = data.provider_counts || state.provider_counts;
    } catch (e) {
      console.warn("[COPILOT ROUTE] Could not read quota state:", e);
    }
  }

  const force = req.query.refresh === "1" || req.query.refresh === "true";
  const models = await discoverActiveModels(force);

  res.json({
    status: "SUCCESS",
    ...state,
    models_available: models.map((m) => m.id),
    models_catalog: models
  });
});

function getToolsRegistry(): any {
  const p1 = path.join(process.cwd(), "tools_registry.json");
  const p2 = path.join(process.cwd(), "..", "tools_registry.json");
  const target = fs.existsSync(p1) ? p1 : (fs.existsSync(p2) ? p2 : null);
  if (target) {
    try {
      return JSON.parse(fs.readFileSync(target, "utf-8"));
    } catch (e) {
      console.warn("[COPILOT ROUTE] Error reading tools_registry.json:", e);
    }
  }
  return { version: "1.0.0", total_tools: 0, tools: [] };
}

// 3. GET /api/copilot/tools & GET /api/v1/tools/registry - Official Shared Tool Registry
copilotRouter.get(["/api/copilot/tools", "/api/v1/tools/registry"], (req, res) => {
  const reg = getToolsRegistry();
  res.json({
    status: "SUCCESS",
    ...reg
  });
});

// POST /api/copilot/tools/refresh & POST /api/v1/tools/refresh - Force re-reflection
copilotRouter.post(["/api/copilot/tools/refresh", "/api/v1/tools/refresh"], (req, res) => {
  const py = getPythonExecutable();
  const reflectorScript = fs.existsSync(path.join(process.cwd(), "tools_reflector.py"))
    ? path.join(process.cwd(), "tools_reflector.py")
    : path.join(process.cwd(), "..", "tools_reflector.py");

  const proc = spawn(py, [reflectorScript, "--force"]);
  proc.on("close", (code) => {
    const reg = getToolsRegistry();
    res.json({
      status: code === 0 ? "SUCCESS" : "ERROR",
      exitCode: code,
      ...reg
    });
  });
});

// 4. POST /api/copilot/chat - Real-time SSE streaming tool router
copilotRouter.post("/api/copilot/chat", (req, res) => {
  const py = getPythonExecutable();
  const scriptPath = getCopilotScriptPath();

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  const geminiKey = (req.headers["x-gemini-api-key"] as string) || systemSettings.geminiApiKey || process.env.GEMINI_API_KEY || "";
  const groqKey = (req.headers["x-groq-api-key"] as string) || systemSettings.customAiApiKey || process.env.GROQ_API_KEY || "";
  const nvidiaKey = (req.headers["x-nvidia-api-key"] as string) || systemSettings.nvidiaApiKey || process.env.NVIDIA_API_KEY || process.env.NVIDIA_INFERENCE_API_KEY || "";
  const openaiKey = (req.headers["x-openai-api-key"] as string) || systemSettings.openaiApiKey || process.env.OPENAI_API_KEY || "";

  const childEnv = {
    ...process.env,
    GEMINI_API_KEY: geminiKey,
    GROQ_API_KEY: groqKey,
    NVIDIA_API_KEY: nvidiaKey,
    OPENAI_API_KEY: openaiKey,
    CUSTOM_AI_BASE_URL: systemSettings.customAiBaseUrl || process.env.CUSTOM_AI_BASE_URL || "",
    CUSTOM_AI_MODEL_NAME: systemSettings.customAiModelName || process.env.CUSTOM_AI_MODEL_NAME || ""
  };

  const child = spawn(py, [scriptPath, "--stdin"], {
    cwd: process.cwd(),
    env: childEnv
  });

  let hasReceivedData = false;
  let stderrOutput = "";

  child.stdout.on("data", (data: Buffer) => {
    hasReceivedData = true;
    res.write(data);
  });

  child.stderr.on("data", (data: Buffer) => {
    stderrOutput += data.toString();
    console.warn("[COPILOT STDERR]:", data.toString());
  });

  child.on("close", (code) => {
    if (!hasReceivedData) {
      const errMsg = stderrOutput.trim() || `Subprocess exited with status ${code}`;
      res.write("event: delta\ndata: " + JSON.stringify({ content: `> ⚠️ **Subprocess Notice**: ${errMsg}\n\n` }) + "\n\n");
      res.write("event: done\ndata: " + JSON.stringify({ status: "error" }) + "\n\n");
    }
    res.end();
  });

  child.on("error", (err) => {
    console.error("[COPILOT SPAWN ERROR]:", err);
    res.write("event: delta\ndata: " + JSON.stringify({ content: `> ❌ **Child Process Error**: ${err.message}\n\n` }) + "\n\n");
    res.write("event: done\ndata: " + JSON.stringify({ status: "error" }) + "\n\n");
    res.end();
  });

  // Write payload to child process stdin with attached keys
  const payload = {
    ...(req.body || {}),
    keys: {
      gemini: geminiKey,
      groq: groqKey,
      nvidia: nvidiaKey,
      openai: openaiKey
    }
  };
  const payloadStr = JSON.stringify(payload);
  child.stdin.write(payloadStr);
  child.stdin.end();
});
