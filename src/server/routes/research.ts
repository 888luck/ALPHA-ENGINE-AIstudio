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
    const scriptPath = path.join(process.cwd(), "research_controller.py");

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
  const scriptPath = path.join(process.cwd(), "research_controller.py");

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
  const scriptPath = path.join(process.cwd(), "research_controller.py");

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
  const scriptPath = path.join(process.cwd(), "research_controller.py");
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
  const scriptPath = path.join(process.cwd(), "research_controller.py");
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
