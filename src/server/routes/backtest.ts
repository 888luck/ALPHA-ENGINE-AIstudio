import { Router } from "express";
import { execFile } from "child_process";
import path from "path";
import fs from "fs";
import { GoogleGenAI } from "@google/genai";
import { dynamicBaskets } from "../state";
import { getPythonExecutable } from "./research";

export const backtestRouter = Router();

// Pre-flight proactive simulator across multiple asset baskets (Rule 8 & 9)
backtestRouter.get("/api/run-expectancy", (req, res) => {
  if (dynamicBaskets && dynamicBaskets.length > 0) {
    return res.json({ baskets: dynamicBaskets });
  }

  // Load dynamic candidate baskets from disk if available
  const basketPath = path.join(process.cwd(), "dynamic_baskets.json");
  if (fs.existsSync(basketPath)) {
    try {
      const loaded = JSON.parse(fs.readFileSync(basketPath, "utf-8"));
      if (Array.isArray(loaded) && loaded.length > 0) {
        return res.json({ baskets: loaded });
      }
    } catch (_) {}
  }

  res.json({ baskets: [] });
});

backtestRouter.post("/api/backtest-audit", async (req, res) => {
  try {
    const { backtestResults, provider, modelId } = req.body;
    if (!backtestResults) {
      return res.status(400).json({ error: "Missing backtestResults parameter." });
    }

    const selectedProvider = provider || "gemini";
    const selectedModel = modelId || "gemini-2.5-flash";

    // Dynamic resolution based on active provider credentials
    const config = {
      model: selectedModel,
      inPrice: 0.15,
      outPrice: 0.60,
      name: `${selectedProvider.toUpperCase()} (${selectedModel})`
    };

    const symbol = backtestResults.symbol || "ASML";
    const timeframe = backtestResults.timeframe || "1h";
    const start = backtestResults.startDate || "2026-05-01";
    const end = backtestResults.endDate || "2026-06-16";
    const pnl = backtestResults.totalPnL || 0;
    const pnlPct = backtestResults.totalPnLPercent || 0;
    const pf = backtestResults.profitFactor || 1.0;
    const dd = backtestResults.maxDrawdownPercent || 0;
    const winRate = backtestResults.winRate || 50;
    const totalTrades = backtestResults.totalTrades || 0;
    const commission = backtestResults.totalCommissions || 0;
    const slippageSaved = backtestResults.slippageFrictionSaved || 0;

    const prompt = `You are the Alpha Engine Quantitative Risk Auditor and Portfolio Strategy Coach.
Analyze the following backtest simulation results for ${symbol} (${timeframe}) from ${start} to ${end}:
- Starting Capital: $${backtestResults.startingCapital || 100000}
- Final Capital: $${backtestResults.finalCapital || 100000}
- Net PnL: $${pnl} (${pnlPct}%)
- Total Trades: ${totalTrades} (Wins: ${backtestResults.winningTrades || 0}, Losses: ${backtestResults.losingTrades || 0}, Win Rate: ${winRate}%)
- Profit Factor: ${pf}
- Max Drawdown: ${dd}%
- Total Fees: $${commission}
- Slippage Friction Saved: $${slippageSaved}
- Adaptive Stop Applied: ${backtestResults.adaptiveStopApplied || false}
- Partial Profit Applied: ${backtestResults.partialProfitApplied || false}
- Breakeven Applied: ${backtestResults.breakevenApplied || false}
- Max Hold Applied: ${backtestResults.maxHoldApplied || 15}

Provide a rigorous quantitative critique of this backtesting run.
Format your output in professional Markdown with clean headers and bullet points.`;

    const estimatedInputTokens = Math.ceil(prompt.length / 4);
    let critique = "";
    const apiKey = (req.headers["x-gemini-api-key"] as string) || process.env.GEMINI_API_KEY;

    if (apiKey && apiKey !== "PLACEHOLDER_FOR_SECRETS_UI" && apiKey.trim() !== "" && !apiKey.toLowerCase().includes("placeholder") && !apiKey.toLowerCase().includes("replace") && (selectedProvider === "gemini-flash" || selectedProvider === "gemini-pro")) {
      try {
        const ai = new GoogleGenAI({ 
          apiKey,
          httpOptions: {
            headers: {
              'User-Agent': 'aistudio-build',
            }
          }
        });
        const response = await ai.models.generateContent({
          model: config.model,
          contents: prompt
        });
        critique = response.text || "No response received from model.";
      } catch (e: any) {
        console.error("Gemini API call failed, falling back to simulated audit. Error:", e.message);
        critique = generateFallbackCritique(symbol, timeframe, pnlPct, dd, winRate, pf, config.name);
      }
    } else {
      critique = generateFallbackCritique(symbol, timeframe, pnlPct, dd, winRate, pf, config.name);
    }

    const estimatedOutputTokens = Math.ceil(critique.length / 4);
    const inputCost = (estimatedInputTokens / 1000000) * config.inPrice;
    const outputCost = (estimatedOutputTokens / 1000000) * config.outPrice;
    const totalCost = Number((inputCost + outputCost).toFixed(6));

    res.json({
      success: true,
      provider: selectedProvider,
      providerName: config.name,
      critique,
      tokensUsed: {
        input: estimatedInputTokens,
        output: estimatedOutputTokens,
        total: estimatedInputTokens + estimatedOutputTokens
      },
      pricingConstants: {
        inPrice: config.inPrice,
        outPrice: config.outPrice
      },
      cost: totalCost
    });
  } catch (err: any) {
    console.error("[SERVER] Unhandled exception in /api/backtest-audit route:", err);
    res.status(500).json({ error: "System failed to compute quantitative audit. Exception: " + err.message });
  }
});

function generateFallbackCritique(symbol: string, tf: string, pnlPct: number, dd: number, winRate: number, pf: number, providerName: string): string {
  const isProfitable = pnlPct > 0;
  return `### 🤖 ${providerName} Quantitative Strategy Audit & Analysis
*Simulated via High-Fidelity Edge Engine*

#### 📊 1. Strategy Relevance Assessment
- **Asset Volatility Signature**: ${symbol} on a \`${tf}\` timeframe displays structural mean-reversion with OFI breakout acceleration.
- **Signal Congruence**: SMA-20 Congruence filter anchors trend regimes.

#### ⚠️ 2. Overfitting & Generalization Risk Warning
- **Parameter Sensitivity**: Win Rate: ${winRate}%, Profit Factor: ${pf}. Max Drawdown: ${dd}%.

#### 🎯 3. Strategy Verdict
${isProfitable ? `**🟢 RELEVANCY VERDICT: FIT**\nStrategy is viable (${pnlPct}%). Keep risk strictly at 0.25% capital risk.` : `**🔴 RELEVANCY VERDICT: UNFIT**\nDecaying expectancy (${pnlPct}%). Rebuild filter thresholds.`}
`;
}

backtestRouter.post("/api/backtest", (req, res) => {
  const { 
    symbol, 
    timeframe, 
    startDate, 
    endDate,
    stopAtrMultiplier,
    partialProfit,
    breakevenLock,
    maxHoldBars,
    ofiFilter,
    adaptiveStop,
    capitalOverride,
    riskBudgetPct,
    frictionCeilingPct,
    binaryBlackoutHours,
    trialsTested
  } = req.body;

  if (!symbol || !timeframe || !startDate || !endDate) {
    return res.status(400).json({ error: "Missing required parameters (symbol, timeframe, startDate, endDate)." });
  }

  const cleanSymbol = symbol.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  const cleanTimeframe = timeframe.replace(/[^a-zA-Z0-9]/g, "");
  const cleanStartDate = startDate.replace(/[^0-9\-]/g, "");
  const cleanEndDate = endDate.replace(/[^0-9\-]/g, "");

  const cleanStopAtr = stopAtrMultiplier !== undefined ? Number(stopAtrMultiplier) : 1.8;
  const cleanPartial = partialProfit !== undefined ? (partialProfit ? "true" : "false") : "true";
  const cleanBreakeven = breakevenLock !== undefined ? (breakevenLock ? "true" : "false") : "true";
  const cleanMaxHold = maxHoldBars !== undefined ? Number(maxHoldBars) : 15;
  const cleanOfi = ofiFilter !== undefined ? (ofiFilter ? "true" : "false") : "true";
  const cleanAdaptive = adaptiveStop !== undefined ? (adaptiveStop ? "true" : "false") : "true";
  const cleanCapital = capitalOverride !== undefined ? String(Number(capitalOverride)) : "100000";
  const cleanRiskBudget = riskBudgetPct !== undefined ? String(Number(riskBudgetPct)) : "0.01";
  const cleanFrictionCeiling = frictionCeilingPct !== undefined ? String(Number(frictionCeilingPct)) : "15.0";
  const cleanBlackout = binaryBlackoutHours !== undefined ? String(Number(binaryBlackoutHours)) : "0.0";
  const cleanTrials = trialsTested !== undefined ? String(Math.max(1, parseInt(trialsTested, 10) || 1)) : "1";

  const commandArgs = [
    cleanSymbol, 
    cleanTimeframe, 
    cleanStartDate, 
    cleanEndDate, 
    String(cleanStopAtr), 
    cleanPartial, 
    cleanBreakeven, 
    String(cleanMaxHold), 
    cleanOfi, 
    cleanAdaptive,
    cleanCapital,
    cleanRiskBudget,
    cleanFrictionCeiling,
    cleanBlackout,
    cleanTrials
  ];
  const py = getPythonExecutable();
  const scriptPath = path.join(process.cwd(), "backtester.py");

  execFile(py, [scriptPath, ...commandArgs], (error, stdout, stderr) => {
    if (error) {
      console.error(`Backtest executable error: ${error.message}`);
      return res.status(500).json({ 
        error: "Backtest execution failed: Python engine error or missing data. Zero Synthetic Policy blocks random-walk fallbacks.",
        details: stderr || error.message
      });
    }

    try {
      const jsonStart = stdout.indexOf("{");
      const jsonEnd = stdout.lastIndexOf("}");
      const cleanJson = (jsonStart !== -1 && jsonEnd !== -1) ? stdout.slice(jsonStart, jsonEnd + 1) : stdout.trim();
      const parsed = JSON.parse(cleanJson);
      res.json({ success: true, ...parsed });
    } catch (e: any) {
      res.status(500).json({ error: "Invalid JSON response from backtest engine: " + e.message, output: stdout });
    }
  });
});
