import { Router } from "express";
import { execFile } from "child_process";
import fs from "fs";
import path from "path";

export const researchRouter = Router();

// Locate Python executable dynamically
export function getPythonExecutable(): string {
  if (process.platform === "win32") {
    const py312 = "C:\\Users\\Misha\\AppData\\Local\\Programs\\Python\\Python312\\python.exe";
    if (fs.existsSync(py312)) return py312;
    return "python";
  }
  return "python3";
}

export function getResearchScriptPath(): string {
  const local = path.join(process.cwd(), "research_controller.py");
  if (fs.existsSync(local)) return local;
  const inStudio = path.join(process.cwd(), "ALPHA-ENGINE-AIstudio", "research_controller.py");
  if (fs.existsSync(inStudio)) return inStudio;
  return local;
}

export function getStrategyVaultPath(): string {
  const local = path.join(process.cwd(), "strategy_vault.json");
  if (fs.existsSync(local)) return local;
  const inStudio = path.join(process.cwd(), "ALPHA-ENGINE-AIstudio", "strategy_vault.json");
  if (fs.existsSync(inStudio)) return inStudio;
  return local;
}

// In-memory cache for market schedule (30-second TTL to avoid frequent child-process spawns)
let cachedScheduleData: any = null;
let cachedScheduleExpiry: number = 0;

export async function fetchMarketSchedule(): Promise<any> {
  const now = Date.now();
  if (cachedScheduleData && now < cachedScheduleExpiry) {
    return cachedScheduleData;
  }

  return new Promise((resolve) => {
    const py = getPythonExecutable();
    const scriptPath = getResearchScriptPath();

    execFile(py, [scriptPath, "schedule"], { timeout: 15000 }, (error, stdout, stderr) => {
      if (error) {
        if (!cachedScheduleData) {
          console.warn("[MARKET SCHEDULE] Dynamic resolver failed, using fallback:", stderr || error.message);
        }
        return resolve(cachedScheduleData);
      }
      try {
        const jsonStart = stdout.indexOf("{");
        const jsonEnd = stdout.lastIndexOf("}");
        if (jsonStart !== -1 && jsonEnd !== -1) {
          const jsonStr = stdout.substring(jsonStart, jsonEnd + 1);
          const data = JSON.parse(jsonStr);
          if (data.status === "success") {
            cachedScheduleData = data;
            cachedScheduleExpiry = Date.now() + 60000; // 60 seconds TTL
            return resolve(data);
          }
        }
        return resolve(cachedScheduleData);
      } catch (e: any) {
        console.warn("[MARKET SCHEDULE] JSON parse failed:", e.message);
        return resolve(cachedScheduleData);
      }
    });
  });
}

// 0. GET /api/market/schedule - Dynamic exchange hours, MOC cutoff, DST desync
researchRouter.get("/api/market/schedule", async (req, res) => {
  const schedule = await fetchMarketSchedule();
  if (schedule) {
    return res.json({ success: true, ...schedule });
  }
  // Resilient fallback if python is starting
  return res.json({
    success: true,
    status: "fallback",
    us: { exchange: "XNYS", is_open: true, moc_flatten_cutoff: "15:45", is_early_close: false, source: "FALLBACK_STATIC" },
    eu: { exchange: "XPAR", is_open: true, moc_flatten_cutoff: "17:15", is_early_close: false, source: "FALLBACK_STATIC" },
    dst_desync: { is_dst_desynced: false, hour_difference: 6.0 }
  });
});

// 1. POST /api/research/resolve - Universal IBKR instrument disambiguation
researchRouter.post("/api/research/resolve", (req, res) => {
  const { query } = req.body;
  if (!query || typeof query !== "string") {
    return res.status(400).json({ error: "Missing or invalid query string." });
  }

  const py = getPythonExecutable();
  const scriptPath = getResearchScriptPath();

  execFile(py, [scriptPath, "resolve", "--query", query], (error, stdout, stderr) => {
    if (error) {
      console.error("[RESEARCH] Resolve error:", stderr || error.message);
      return res.status(500).json({ error: "Contract resolution failed", details: stderr || error.message });
    }
    try {
      const data = JSON.parse(stdout);
      res.json({ success: true, ...data });
    } catch (e: any) {
      res.status(500).json({ error: "Failed to parse resolution JSON", raw: stdout });
    }
  });
});

// 2. POST /api/research/sanitize-risk - Natural language risk parser & gate clamping
researchRouter.post("/api/research/sanitize-risk", (req, res) => {
  const { prompt } = req.body;
  if (!prompt || typeof prompt !== "string") {
    return res.status(400).json({ error: "Missing or invalid natural language prompt." });
  }

  const py = getPythonExecutable();
  const scriptPath = getResearchScriptPath();

  execFile(py, [scriptPath, "sanitize", "--prompt", prompt], (error, stdout, stderr) => {
    if (error) {
      console.error("[RESEARCH] Sanitize error:", stderr || error.message);
      return res.status(500).json({ error: "Risk sanitization failed", details: stderr || error.message });
    }
    try {
      const data = JSON.parse(stdout);
      res.json({ success: true, ...data });
    } catch (e: any) {
      res.status(500).json({ error: "Failed to parse sanitizer JSON", raw: stdout });
    }
  });
});

// 3. POST /api/research/analyze-pattern - Runs quant discovery & news event correlation
researchRouter.post("/api/research/analyze-pattern", (req, res) => {
  const payload = req.body;
  if (!payload || !payload.symbol || !payload.bars) {
    return res.status(400).json({ error: "Missing required payload (symbol, bars)." });
  }

  const py = getPythonExecutable();
  const scriptPath = getResearchScriptPath();
  const tempInputPath = path.join(process.cwd(), "scratch", `research_input_${Date.now()}.json`);

  if (!fs.existsSync(path.join(process.cwd(), "scratch"))) {
    fs.mkdirSync(path.join(process.cwd(), "scratch"), { recursive: true });
  }

  fs.writeFileSync(tempInputPath, JSON.stringify(payload), "utf-8");

  execFile(py, [scriptPath, "analyze", "--input-json", tempInputPath], (error, stdout, stderr) => {
    // Clean up temporary file
    try { fs.unlinkSync(tempInputPath); } catch (_) {}

    if (error) {
      console.error("[RESEARCH] Analyze error:", stderr || error.message);
      return res.status(500).json({ error: "Analysis execution failed", details: stderr || error.message });
    }
    try {
      const data = JSON.parse(stdout);
      res.json({ success: true, ...data });
    } catch (e: any) {
      res.status(500).json({ error: "Failed to parse analysis JSON", raw: stdout });
    }
  });
});

// 4. POST /api/research/audit-dsr - López de Prado Deflated Sharpe Ratio audit
researchRouter.post("/api/research/audit-dsr", (req, res) => {
  const payload = req.body;
  if (!payload || !payload.trades || !payload.balance_history) {
    return res.status(400).json({ error: "Missing required payload (trades, balance_history)." });
  }

  const py = getPythonExecutable();
  const scriptPath = getResearchScriptPath();
  const tempInputPath = path.join(process.cwd(), "scratch", `audit_input_${Date.now()}.json`);

  if (!fs.existsSync(path.join(process.cwd(), "scratch"))) {
    fs.mkdirSync(path.join(process.cwd(), "scratch"), { recursive: true });
  }

  fs.writeFileSync(tempInputPath, JSON.stringify(payload), "utf-8");

  execFile(py, [scriptPath, "audit", "--input-json", tempInputPath], (error, stdout, stderr) => {
    // Clean up temporary file
    try { fs.unlinkSync(tempInputPath); } catch (_) {}

    if (error) {
      console.error("[RESEARCH] Audit error:", stderr || error.message);
      return res.status(500).json({ error: "DSR audit execution failed", details: stderr || error.message });
    }
    try {
      const data = JSON.parse(stdout);
      res.json({ success: true, ...data });
    } catch (e: any) {
      res.status(500).json({ error: "Failed to parse audit JSON", raw: stdout });
    }
  });
});

// 5. POST /api/research/discovery - Empirical price series analysis (Hurst, Runs test, Markov)
researchRouter.post("/api/research/discovery", (req, res) => {
  const { symbol, timeframe, start_date, end_date } = req.body;
  if (!symbol) {
    return res.status(400).json({ error: "Missing required symbol parameter." });
  }

  const py = getPythonExecutable();
  const scriptPath = getResearchScriptPath();
  const args = [
    scriptPath,
    "discovery",
    "--symbol", String(symbol).toUpperCase().trim(),
    "--timeframe", String(timeframe || "1h"),
    "--start-date", String(start_date || "2026-05-01"),
    "--end-date", String(end_date || "2026-06-16"),
  ];

  execFile(py, args, { timeout: 30000 }, (error, stdout, stderr) => {
    if (error) {
      console.error("[RESEARCH] Discovery error:", stderr || error.message);
      return res.status(500).json({ error: "Discovery failed", details: stderr || error.message });
    }
    try {
      const data = JSON.parse(stdout);
      res.json({ success: true, ...data });
    } catch (e: any) {
      res.status(500).json({ error: "Failed to parse discovery JSON", raw: stdout });
    }
  });
});

// 6. POST /api/research/sweep - Autonomous multi-parameter sweep with DSR audit
researchRouter.post("/api/research/sweep", (req, res) => {
  const { symbol, timeframe, capital, trials, start_date, end_date } = req.body;
  if (!symbol) {
    return res.status(400).json({ error: "Missing required symbol parameter." });
  }

  const py = getPythonExecutable();
  const scriptPath = getResearchScriptPath();
  const args = [
    scriptPath,
    "sweep",
    "--symbol", String(symbol).toUpperCase().trim(),
    "--timeframe", String(timeframe || "1h"),
    "--capital", String(capital || 100000),
    "--trials", String(trials || 16),
    "--start-date", String(start_date || "2026-05-01"),
    "--end-date", String(end_date || "2026-06-16"),
  ];

  execFile(py, args, { timeout: 60000, maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
    if (error) {
      console.error("[RESEARCH] Sweep error:", stderr || error.message);
      return res.status(500).json({ error: "Sweep failed", details: stderr || error.message });
    }
    try {
      const data = JSON.parse(stdout);
      res.json({ success: true, ...data });
    } catch (e: any) {
      res.status(500).json({ error: "Failed to parse sweep JSON", raw: stdout });
    }
  });
});

// 7. GET /api/vault/strategies - Retrieve all preserved quantitative strategies
researchRouter.get("/api/vault/strategies", (req, res) => {
  try {
    const vaultPath = getStrategyVaultPath();
    if (!fs.existsSync(vaultPath)) {
      return res.json({ success: true, total: 0, strategies: [] });
    }
    const content = fs.readFileSync(vaultPath, "utf-8");
    const strategies = JSON.parse(content);
    return res.json({ success: true, total: strategies.length, strategies });
  } catch (err: any) {
    console.error("[VAULT] Read error:", err.message);
    return res.status(500).json({ error: "Failed to read strategy vault", details: err.message });
  }
});

// 8. POST /api/vault/strategies - Atomically save audited strategy (Rule 9)
researchRouter.post("/api/vault/strategies", (req, res) => {
  try {
    const strategy = req.body;
    if (!strategy || !strategy.name) {
      return res.status(400).json({ error: "Missing strategy payload or name." });
    }

    const vaultPath = getStrategyVaultPath();
    let items: any[] = [];
    if (fs.existsSync(vaultPath)) {
      try {
        items = JSON.parse(fs.readFileSync(vaultPath, "utf-8"));
      } catch (_) {
        items = [];
      }
    }

    const newEntry = {
      id: strategy.id || `EXP_${Date.now().toString(16).toUpperCase()}`,
      timestamp: new Date().toISOString(),
      name: strategy.name,
      symbol: (strategy.symbol || "UNKNOWN").toUpperCase(),
      timeframe: strategy.timeframe || "1h",
      parameters: strategy.parameters || {},
      metrics: strategy.metrics || {},
      balanceHistory: strategy.balanceHistory || [],
      tradesList: strategy.tradesList || []
    };

    items = [newEntry, ...items.filter((i: any) => i.id !== newEntry.id)];

    // Atomic write-and-replace (Rule 9)
    const tmpPath = `${vaultPath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(items, null, 2), "utf-8");
    fs.renameSync(tmpPath, vaultPath);

    return res.json({ success: true, message: `Strategy '${strategy.name}' preserved to Experiment Vault.`, strategy: newEntry });
  } catch (err: any) {
    console.error("[VAULT] Save error:", err.message);
    return res.status(500).json({ error: "Failed to save strategy to vault", details: err.message });
  }
});

// 9. DELETE /api/vault/strategies/:id - Atomically delete strategy by ID
researchRouter.delete("/api/vault/strategies/:id", (req, res) => {
  try {
    const { id } = req.params;
    const vaultPath = getStrategyVaultPath();
    if (!fs.existsSync(vaultPath)) {
      return res.json({ success: true, message: "Vault empty, nothing to delete." });
    }

    let items: any[] = [];
    try {
      items = JSON.parse(fs.readFileSync(vaultPath, "utf-8"));
    } catch (_) {
      items = [];
    }

    items = items.filter((i: any) => i.id !== id);

    // Atomic write-and-replace
    const tmpPath = `${vaultPath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(items, null, 2), "utf-8");
    fs.renameSync(tmpPath, vaultPath);

    return res.json({ success: true, message: `Strategy ${id} removed from vault.`, total: items.length });
  } catch (err: any) {
    console.error("[VAULT] Delete error:", err.message);
    return res.status(500).json({ error: "Failed to delete strategy from vault", details: err.message });
  }
});
