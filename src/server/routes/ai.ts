import { Router } from "express";
import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import { systemSettings, dynamicBaskets, marketBooks, ingestScannedInstrument, persistSettings } from "../state";
import { getUniversalAIResponse } from "../services/ai_service";
import { isMaskedString, saveVaultCredentials } from "../vault";

export const aiRouter = Router();

aiRouter.post("/api/ai/universal-generate", async (req, res) => {
  try {
    const { prompt, systemPrompt, provider, jsonMode } = req.body;
    if (!prompt) return res.status(400).json({ error: "Missing prompt" });

    const text = await getUniversalAIResponse(prompt, { 
      provider, 
      systemPrompt, 
      jsonMode: !!jsonMode 
    });
    res.json({ success: true, text });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

aiRouter.post("/api/calibrate-geopolitical", async (req, res) => {
  const { eventDescription } = req.body;
  if (!eventDescription) {
    return res.status(400).json({ error: "Missing required parameter: eventDescription" });
  }

  const rawKey = (req.headers["x-gemini-api-key"] as string) || systemSettings.geminiApiKey || process.env.GEMINI_API_KEY;
  const isPlaceholderOrEmpty = !rawKey ||
    rawKey.trim() === "" ||
    rawKey.includes("MY_GEMINI_API_KEY") ||
    rawKey.toLowerCase().includes("placeholder") ||
    rawKey.toLowerCase().includes("replace") ||
    rawKey.toLowerCase().includes("your_") ||
    rawKey.length < 20;

  if (isPlaceholderOrEmpty) {
    return res.status(400).json({ 
      error: "Gemini API key is unconfigured. Please configure a valid key in System Settings to calibrate macro portfolios." 
    });
  }

  try {
    const prompt = `You are an expert macroeconomic quantitative trading strategist who calibrates algorithmic portfolio baskets for Order Flow Imbalance.
Analyze this high-impact real-world event:
"${eventDescription}"

Generate 3 strategic asset baskets (each with exactly 3 stock/ETF tickers) that are directly exposed to this event.
Provide the output in STRICT JSON format matching the schema:
{
  "baskets": [
    {
      "sector": "Descriptive basket name",
      "tickers": ["TICKER1", "TICKER2", "TICKER3"],
      "impliedOfiTrend": "BULLISH or BEARISH or VOLATILE with brief explanation",
      "winRate": 64,
      "profitFactor": 1.55,
      "avgFrictionConsumed": 5.4
    }
  ]
}
Ensure tickers are real liquid US or European equities and ETFs (e.g. XLE, GLD, ITA, SPY, QQQ, AAPL, EURX, TSLA, COP, VLO, SAP, RWE).
Only output raw valid JSON.`;

    const ai = new GoogleGenAI({ 
      apiKey: rawKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json"
      }
    });

    const parsedData = JSON.parse(response.text || "{}");
    if (parsedData && Array.isArray(parsedData.baskets)) {
      parsedData.baskets.forEach((b: any) => {
        if (Array.isArray(b.tickers)) {
          b.tickers.forEach((ticker: string) => {
            const sym = ticker.toUpperCase();
            if (!marketBooks[sym]) {
              const defaultExch = ["SGO", "ENGI", "RWE", "SAP", "LVMH", "ASML"].includes(sym) ? "SBF" : "NYSE";
              ingestScannedInstrument(sym, defaultExch, 100.0);
            }
          });
        }
      });

      try {
        fs.writeFileSync(path.join(process.cwd(), "dynamic_baskets.json"), JSON.stringify(parsedData, null, 2), "utf8");
      } catch (err: any) {
        console.error("[SERVER] Failed to write dynamic_baskets.json:", err.message);
      }

      res.json({ success: true, message: `Geopolitical Sectors successfully calibrated via Gemini for "${eventDescription.slice(0, 45)}..."`, baskets: parsedData.baskets });
    } else {
      throw new Error("Invalid structure returned from model");
    }
  } catch (err: any) {
    res.status(500).json({ error: "Macro calibration failed: " + err.message });
  }
});

aiRouter.post("/api/test-ai-key", async (req, res) => {
  const { provider, apiKey, baseUrl } = req.body;
  const startTime = Date.now();

  try {
    if (provider === "gemini") {
      let key = (apiKey && !isMaskedString(apiKey)) ? apiKey.trim() : (systemSettings.geminiApiKey || process.env.GEMINI_API_KEY || "");
      if (key && isMaskedString(key)) {
        key = process.env.GEMINI_API_KEY || "";
      }
      if (!key || key === "MY_GEMINI_API_KEY" || isMaskedString(key)) {
        throw new Error("No Gemini API key supplied. Please paste your AIzaSy... key from https://aistudio.google.com/app/apikey");
      }
      if (key.startsWith("AQ.")) {
        throw new Error("Detected Google Cloud OAuth token ('AQ...'). Google Gemini API requires a standard API key starting with 'AIzaSy...' from https://aistudio.google.com/app/apikey");
      }
      
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Google API returned ${response.status}: ${errText}`);
      }
      const data = await response.json();
      const rawModels = data.models || [];
      const discoveredModels = rawModels
        .filter((m: any) => m.supportedGenerationMethods?.includes("generateContent"))
        .map((m: any) => {
          const cleanId = m.name?.replace(/^models\//, "");
          return {
            id: `google/${cleanId}`,
            rawId: cleanId,
            name: m.displayName || cleanId,
            description: m.description || "",
            provider: "Google GenAI",
            tier: cleanId.includes("flash") ? "Tier 1 Next-Gen" : "Tier 2 Deep Reasoning",
            badge: "Active Discovered",
            costStr: cleanId.includes("flash") ? "$0.10 / 1M tokens" : "$1.25 / 1M tokens",
            icon: "💎"
          };
        });

      if (apiKey && !isMaskedString(apiKey)) {
        saveVaultCredentials({ geminiApiKey: key });
        systemSettings.geminiApiKey = key;
        persistSettings();
      }

      const latencyMs = Date.now() - startTime;
      return res.json({
        success: true,
        latencyMs,
        provider: "Google GenAI",
        models: discoveredModels,
        message: `Google GenAI verified. Discovered ${discoveredModels.length} active models directly from API.`
      });
    }

    if (provider === "groq") {
      let key = (apiKey && !isMaskedString(apiKey)) ? apiKey.trim() : (systemSettings.customAiApiKey || process.env.GROQ_API_KEY || "");
      if (key && isMaskedString(key)) {
        key = process.env.GROQ_API_KEY || "";
      }
      if (!key || isMaskedString(key)) {
        throw new Error("No Groq API key supplied. Please paste your gsk_... key from https://console.groq.com/keys");
      }

      const response = await fetch("https://api.groq.com/openai/v1/models", {
        headers: { "Authorization": `Bearer ${key}` }
      });
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Groq API returned ${response.status}: ${errText}`);
      }
      const data = await response.json();
      const rawModels = data.data || [];
      const discoveredModels = rawModels
        .filter((m: any) => m.active !== false && !m.id?.includes("whisper"))
        .map((m: any) => ({
          id: `groq/${m.id}`,
          rawId: m.id,
          name: m.id,
          provider: "Groq",
          tier: m.id.includes("70b") ? "Tier 1 LPU" : "Tier 0.5 LPU",
          badge: "Ultra-Fast LPU",
          costStr: "$0.59 / 1M tokens",
          icon: "⚡"
        }));

      if (apiKey && !isMaskedString(apiKey)) {
        saveVaultCredentials({ customAiApiKey: key, groqApiKey: key });
        systemSettings.customAiApiKey = key;
        persistSettings();
      }

      const latencyMs = Date.now() - startTime;
      return res.json({
        success: true,
        latencyMs,
        provider: "Groq Cloud",
        models: discoveredModels,
        message: `Groq Cloud verified. Discovered ${discoveredModels.length} active models directly from API.`
      });
    }

    if (provider === "nvidia") {
      let key = (apiKey && !isMaskedString(apiKey)) ? apiKey.trim() : (systemSettings.nvidiaApiKey || process.env.NVIDIA_API_KEY || "");
      if (key && isMaskedString(key)) {
        key = process.env.NVIDIA_API_KEY || "";
      }
      if (!key || isMaskedString(key)) {
        throw new Error("No NVIDIA API key supplied. Please paste your nvapi-... key from https://build.nvidia.com");
      }

      const response = await fetch("https://integrate.api.nvidia.com/v1/models", {
        headers: { "Authorization": `Bearer ${key}` }
      });
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`NVIDIA API returned ${response.status}: ${errText}`);
      }
      const data = await response.json();
      const rawModels = data.data || [];
      const discoveredModels = rawModels.map((m: any) => ({
        id: `nvidia/${m.id}`,
        rawId: m.id,
        name: m.id,
        provider: "NVIDIA NIM",
        tier: "Tier 1 NIM",
        badge: "NIM Microservice",
        costStr: "$0.70 / 1M tokens",
        icon: "🟢"
      }));

      if (apiKey && !isMaskedString(apiKey)) {
        saveVaultCredentials({ nvidiaApiKey: key });
        systemSettings.nvidiaApiKey = key;
        persistSettings();
      }

      const latencyMs = Date.now() - startTime;
      return res.json({
        success: true,
        latencyMs,
        provider: "NVIDIA NIM",
        models: discoveredModels,
        message: `NVIDIA NIM verified. Discovered ${discoveredModels.length} active models directly from API.`
      });
    }

    if (provider === "openai") {
      let key = (apiKey && !isMaskedString(apiKey)) ? apiKey.trim() : (systemSettings.openaiApiKey || process.env.OPENAI_API_KEY || "");
      if (key && isMaskedString(key)) {
        key = process.env.OPENAI_API_KEY || "";
      }
      if (!key || isMaskedString(key)) {
        throw new Error("No OpenAI API key supplied. Please paste your sk-... key from https://platform.openai.com/api-keys");
      }

      const response = await fetch("https://api.openai.com/v1/models", {
        headers: { "Authorization": `Bearer ${key}` }
      });
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`OpenAI API returned ${response.status}: ${errText}`);
      }
      const data = await response.json();
      const rawModels = data.data || [];
      const discoveredModels = rawModels
        .filter((m: any) => m.id?.startsWith("gpt-") || m.id?.startsWith("o1"))
        .map((m: any) => ({
          id: `openai/${m.id}`,
          rawId: m.id,
          name: m.id,
          provider: "OpenAI",
          tier: "Tier 1 Frontier",
          badge: "OpenAI Official",
          costStr: "$2.50 / 1M tokens",
          icon: "🧠"
        }));

      if (apiKey && !isMaskedString(apiKey)) {
        saveVaultCredentials({ openaiApiKey: key });
        systemSettings.openaiApiKey = key;
        persistSettings();
      }

      const latencyMs = Date.now() - startTime;
      return res.json({
        success: true,
        latencyMs,
        provider: "OpenAI",
        models: discoveredModels,
        message: `OpenAI verified. Discovered ${discoveredModels.length} active models directly from API.`
      });
    }

    if (provider === "openrouter") {
      let key = (apiKey && !isMaskedString(apiKey)) ? apiKey.trim() : ((systemSettings as any).openrouterApiKey || process.env.OPENROUTER_API_KEY || "");
      if (key && isMaskedString(key)) {
        key = process.env.OPENROUTER_API_KEY || "";
      }
      const headers: Record<string, string> = { "User-Agent": "AlphaEngine/2.0" };
      if (key) headers["Authorization"] = `Bearer ${key}`;

      const response = await fetch("https://openrouter.ai/api/v1/models", { headers });
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`OpenRouter API returned ${response.status}: ${errText}`);
      }
      const data = await response.json();
      const rawModels = data.data || [];
      const discoveredModels = rawModels
        .filter((m: any) => {
          const mid = (m.id || "").toLowerCase();
          const pPrompt = parseFloat(m.pricing?.prompt || "0");
          return mid.includes(":free") || pPrompt === 0 || mid.includes("deepseek") || mid.includes("qwen") || mid.includes("nemotron") || mid.includes("llama-3.3");
        })
        .slice(0, 30)
        .map((m: any) => ({
          id: `openrouter/${m.id}`,
          rawId: m.id,
          name: m.name || m.id,
          provider: "OpenRouter",
          tier: m.id.includes(":free") ? "Free Tier" : "Tier 1 OpenRouter",
          badge: m.id.includes(":free") ? "🎁 FREE" : "OpenRouter",
          costStr: m.id.includes(":free") ? "$0.00 / 1M tokens" : `$${(parseFloat(m.pricing?.prompt || "0") * 1000000).toFixed(2)} / 1M`,
          icon: m.id.includes(":free") ? "🎁" : "🌐",
          isFree: m.id.includes(":free")
        }));

      if (apiKey && !isMaskedString(apiKey)) {
        saveVaultCredentials({ openrouterApiKey: key });
        (systemSettings as any).openrouterApiKey = key;
        persistSettings();
      }

      const latencyMs = Date.now() - startTime;
      return res.json({
        success: true,
        latencyMs,
        provider: "OpenRouter",
        models: discoveredModels,
        message: `OpenRouter verified. Discovered ${discoveredModels.length} models directly from OpenRouter API.`
      });
    }

    if (provider === "custom") {
      const targetUrl = baseUrl || systemSettings.customAiBaseUrl || "http://localhost:11434/v1";
      const modelsEndpoint = targetUrl.endsWith("/") ? `${targetUrl}models` : `${targetUrl}/models`;
      const response = await fetch(modelsEndpoint);
      if (!response.ok) {
        throw new Error(`Custom endpoint returned ${response.status}`);
      }
      const data = await response.json();
      const rawModels = data.data || data.models || [];
      const discoveredModels = rawModels.map((m: any) => {
        const mid = typeof m === "string" ? m : (m.id || m.name || "custom-model");
        return {
          id: `custom/${mid}`,
          rawId: mid,
          name: mid,
          provider: "Custom Local",
          tier: "Tier 0 Self-Hosted",
          badge: "Local Runtime",
          costStr: "$0.00 (Self-Hosted)",
          icon: "🦙"
        };
      });

      const latencyMs = Date.now() - startTime;
      return res.json({
        success: true,
        latencyMs,
        provider: "Custom Endpoint",
        models: discoveredModels,
        message: `Custom endpoint verified. Discovered ${discoveredModels.length} models.`
      });
    }

    throw new Error(`Unsupported provider for test: ${provider}`);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message, message: err.message });
  }
});

aiRouter.get("/api/models/live-catalog", async (req, res) => {
  // Purged static catalogs - redirect to dynamic model discovery
  res.redirect("/api/copilot/models");
});
