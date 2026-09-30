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
  const { provider, apiKey } = req.body;
  const startTime = Date.now();
  const testPrompt = "Ping: respond with READY.";

  try {
    if (provider === "gemini") {
      const key = apiKey || systemSettings.geminiApiKey || process.env.GEMINI_API_KEY;
      if (!key || key === "MY_GEMINI_API_KEY") throw new Error("No Gemini API key supplied.");
      const ai = new GoogleGenAI({ apiKey: key });
      const resp = await ai.models.generateContent({ model: "gemini-2.5-flash", contents: testPrompt });
      const latencyMs = Date.now() - startTime;
      return res.json({
        success: true,
        latencyMs,
        provider: "Google Gemini 2.5 Flash",
        reply: resp.text?.trim() || "READY",
        message: `Gemini 2.5 Flash responded in ${latencyMs}ms.`
      });
    }

    if (provider === "openai") {
      const key = apiKey || systemSettings.openaiApiKey || process.env.OPENAI_API_KEY;
      if (!key) throw new Error("No OpenAI API key supplied.");
      const openai = new OpenAI({ apiKey: key });
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: testPrompt }],
        max_tokens: 5,
      });
      const latencyMs = Date.now() - startTime;
      return res.json({
        success: true,
        latencyMs,
        provider: "OpenAI (GPT-4o-mini)",
        reply: completion.choices[0]?.message?.content?.trim() || "READY",
        message: `OpenAI GPT-4o-mini responded in ${latencyMs}ms.`
      });
    }

    if (provider === "anthropic") {
      const key = apiKey || systemSettings.anthropicApiKey || process.env.ANTHROPIC_API_KEY;
      if (!key) throw new Error("No Anthropic API key supplied.");
      const anthropic = new Anthropic({ apiKey: key });
      const msg = await anthropic.messages.create({
        model: "claude-3-haiku-20240307",
        max_tokens: 5,
        messages: [{ role: "user", content: testPrompt }],
      });
      const latencyMs = Date.now() - startTime;
      return res.json({
        success: true,
        latencyMs,
        provider: "Anthropic (Claude 3 Haiku)",
        reply: (msg.content[0] as any)?.text?.trim() || "READY",
        message: `Claude 3 Haiku responded in ${latencyMs}ms.`
      });
    }

    if (provider === "nvidia") {
      const key = apiKey || systemSettings.nvidiaApiKey || process.env.NVIDIA_API_KEY;
      if (!key) throw new Error("No NVIDIA API key supplied.");
      const openai = new OpenAI({ apiKey: key, baseURL: "https://integrate.api.nvidia.com/v1" });
      const completion = await openai.chat.completions.create({
        model: "meta/llama-3.1-70b-instruct",
        messages: [{ role: "user", content: testPrompt }],
        max_tokens: 5,
      });
      const latencyMs = Date.now() - startTime;
      return res.json({
        success: true,
        latencyMs,
        provider: "NVIDIA NIM (Llama 3.1 70B)",
        reply: completion.choices[0]?.message?.content?.trim() || "READY",
        message: `NVIDIA NIM responded in ${latencyMs}ms.`
      });
    }

    throw new Error(`Unsupported provider for test: ${provider}`);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

aiRouter.get("/api/models/live-catalog", async (req, res) => {
  const catalog = {
    google_genai: [
      { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", inputTokenLimit: 1048576, outputTokenLimit: 8192, recommendedRole: "verifier_2", status: "active" },
      { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", inputTokenLimit: 2097152, outputTokenLimit: 8192, recommendedRole: "judge", status: "active" }
    ],
    openai: [
      { id: "gpt-4o", name: "GPT-4o", recommendedRole: "judge", status: "active" },
      { id: "gpt-4o-mini", name: "GPT-4o Mini", recommendedRole: "generator", status: "active" }
    ],
    anthropic: [
      { id: "claude-3-5-sonnet-20240620", name: "Claude 3.5 Sonnet", recommendedRole: "judge", status: "active" },
      { id: "claude-3-haiku-20240307", name: "Claude 3 Haiku", recommendedRole: "generator", status: "active" }
    ],
    nvidia_nim: [
      { id: "meta/llama-3.1-405b-instruct", name: "Llama 3.1 405B", recommendedRole: "judge", status: "active" },
      { id: "meta/llama-3.1-70b-instruct", name: "Llama 3.1 70B", recommendedRole: "verifier_1", status: "active" }
    ]
  };

  res.json({ success: true, catalog });
});

aiRouter.get("/api/gemini/available-models", async (req, res) => {
  res.json({
    success: true,
    models: [
      { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash (Default)" },
      { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro (Deep Reasoning)" }
    ]
  });
});
