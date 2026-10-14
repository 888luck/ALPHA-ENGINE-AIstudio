import { Router } from "express";
import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import { systemSettings, dynamicBaskets, marketBooks, ingestScannedInstrument } from "../state";
import { getUniversalAIResponse } from "../services/ai_service";

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
      const key = apiKey || systemSettings.geminiApiKey || process.env.GEMINI_API_KEY;
      if (!key || key === "MY_GEMINI_API_KEY") throw new Error("No Gemini API key supplied.");
      
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
      const key = apiKey || systemSettings.customAiApiKey || process.env.GROQ_API_KEY;
      if (!key) throw new Error("No Groq API key supplied.");

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
      const key = apiKey || systemSettings.nvidiaApiKey || process.env.NVIDIA_API_KEY;
      if (!key) throw new Error("No NVIDIA API key supplied.");

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
      const key = apiKey || systemSettings.openaiApiKey || process.env.OPENAI_API_KEY;
      if (!key) throw new Error("No OpenAI API key supplied.");

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

      const latencyMs = Date.now() - startTime;
      return res.json({
        success: true,
        latencyMs,
        provider: "OpenAI",
        models: discoveredModels,
        message: `OpenAI verified. Discovered ${discoveredModels.length} active models directly from API.`
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
