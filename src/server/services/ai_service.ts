import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { systemSettings } from "../state";

export interface UniversalAIOptions {
  provider?: string;
  systemPrompt?: string;
  jsonMode?: boolean;
}

export async function getUniversalAIResponse(
  prompt: string, 
  options: UniversalAIOptions = {}
): Promise<string> {
  const provider = options.provider || systemSettings.selectedAiProvider;
  const sysPrompt = options.systemPrompt || "You are the Alpha Engine AI. Provide precise, quantitative trading insights.";

  let targetProvider = provider;
  if (provider === "auto") {
    const hasGemini = systemSettings.geminiApiKey || process.env.GEMINI_API_KEY;
    if (hasGemini) {
      targetProvider = prompt.length > 2000 ? "gemini-pro" : "gemini-flash";
    } else {
      targetProvider = prompt.length > 800 ? "openai-4o" : "openai-4o-mini";
    }
  }

  try {
    if (targetProvider.startsWith("gemini")) {
      const rawKey = systemSettings.geminiApiKey || process.env.GEMINI_API_KEY || ""; 
      if (!rawKey || rawKey === "MY_GEMINI_API_KEY") throw new Error("Gemini API Key missing. Please provide it in the System Control Center.");
      
      const ai = new GoogleGenAI({ 
        apiKey: rawKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });
      
      const modelName = targetProvider === "gemini-pro" ? "gemini-2.5-pro" : "gemini-2.5-flash";
      const result = await ai.models.generateContent({
        model: modelName,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: options.jsonMode ? { responseMimeType: "application/json" } : undefined
      });
      return result.text || "";
    }

    if (targetProvider.startsWith("openai")) {
      const apiKey = systemSettings.openaiApiKey || process.env.OPENAI_API_KEY;
      if (!apiKey) throw new Error("OpenAI API Key missing. Please provide it in Settings.");
      const openai = new OpenAI({ apiKey });
      const modelName = targetProvider === "openai-4o-mini" ? "gpt-4o-mini" : "gpt-4o";
      const response = await openai.chat.completions.create({
        model: modelName,
        messages: [
          { role: "system", content: sysPrompt },
          { role: "user", content: prompt }
        ],
        response_format: options.jsonMode ? { type: "json_object" } : undefined
      });
      return response.choices[0]?.message?.content || "";
    }

    if (targetProvider.startsWith("anthropic")) {
      const apiKey = systemSettings.anthropicApiKey || process.env.ANTHROPIC_API_KEY;
      if (!apiKey) throw new Error("Anthropic API Key missing. Please provide it in Settings.");
      const anthropic = new Anthropic({ apiKey });
      const modelName = targetProvider === "anthropic-haiku" ? "claude-3-haiku-20240307" : "claude-3-5-sonnet-20240620";
      const response = await anthropic.messages.create({
        model: modelName,
        max_tokens: 4096,
        system: sysPrompt + (options.jsonMode ? " Ensure your response is valid JSON." : ""),
        messages: [{ role: "user", content: prompt }],
      });
      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      return text;
    }

    if (targetProvider.startsWith("nvidia")) {
      const apiKey = systemSettings.nvidiaApiKey || process.env.NVIDIA_API_KEY;
      if (!apiKey) throw new Error("NVIDIA API Key missing. Please provide it in Settings.");
      const openai = new OpenAI({ 
        apiKey,
        baseURL: 'https://integrate.api.nvidia.com/v1' 
      });
      
      let modelName = "meta/llama-3.1-405b-instruct";
      if (targetProvider === "nvidia-llama-70") modelName = "meta/llama-3.1-70b-instruct";
      
      const response = await openai.chat.completions.create({
        model: modelName,
        messages: [
          { role: "system", content: sysPrompt },
          { role: "user", content: prompt }
        ],
        response_format: options.jsonMode ? { type: "json_object" } : undefined
      });
      return response.choices[0]?.message?.content || "";
    }

    if (targetProvider === "custom") {
      const apiKey = systemSettings.customAiApiKey;
      const baseURL = systemSettings.customAiBaseUrl;
      const modelName = systemSettings.customAiModelName;
      
      if (!apiKey || !baseURL || !modelName) {
        throw new Error("Custom AI Configuration incomplete. Please provide API Key, Base URL, and Model Name in Settings.");
      }

      const openai = new OpenAI({ apiKey, baseURL });
      const response = await openai.chat.completions.create({
        model: modelName,
        messages: [
          { role: "system", content: sysPrompt },
          { role: "user", content: prompt }
        ],
        response_format: options.jsonMode ? { type: "json_object" } : undefined
      });
      return response.choices[0]?.message?.content || "";
    }
  } catch (e: any) {
    console.error(`[AI_ROUTER_ERR] Provider: ${targetProvider} | Error:`, e.message);
    throw e;
  }

  throw new Error(`Unsupported AI Provider: ${targetProvider}`);
}
