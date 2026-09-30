import "dotenv/config";
import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { riskRouter } from "./src/server/routes/risk";
import { ordersRouter } from "./src/server/routes/orders";
import { eventsRouter } from "./src/server/routes/events";
import { backtestRouter } from "./src/server/routes/backtest";
import { systemRouter } from "./src/server/routes/system";
import { aiRouter } from "./src/server/routes/ai";
import { loadPersistentSettings, systemSettings, db_fs } from "./src/server/state";
import { authMiddleware, getMaskedSettings } from "./src/server/middleware/auth";
import { ActiveTrade, HistoricalLog } from "./src/server/types";

console.log("[ALPHA SERVER] Initializing institutional modular server...");

// Institutional Zero-Mock State Containers
let activeTrades: ActiveTrade[] = [];
let historicalLogs: HistoricalLog[] = [];

export { activeTrades, historicalLogs, authMiddleware, getMaskedSettings, systemSettings, db_fs };

const app = express();
app.use(express.json());

// Cloud Run health check endpoint
app.get("/healthz", (req, res) => {
  res.status(200).send("OK");
});

// Mount Modular Institutional Routers
app.use(riskRouter);
app.use(ordersRouter);
app.use(eventsRouter);
app.use(backtestRouter);
app.use(systemRouter);
app.use(aiRouter);

// Global Error Handlers
process.on("unhandledRejection", (reason, promise) => {
  console.error("[SERVER] Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("[SERVER] Uncaught Exception:", err);
});

// Setup backend with static serving or Vite dev mode middleware
async function startServer() {
  await loadPersistentSettings();

  const distPath = path.join(process.cwd(), "dist");
  const distExists = fs.existsSync(path.join(distPath, "index.html"));

  if (process.env.NODE_ENV === "production" || distExists) {
    console.log("[ALPHA SERVER] Serving production static bundle from /dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  } else {
    console.log("[ALPHA SERVER] Initializing Vite dev middleware...");
    delete process.env.PORT;
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  const listenPort = Number(process.env.PORT) || 3000;
  app.listen(listenPort, "0.0.0.0", () => {
    console.log(`[ALPHA SERVER] Running successfully on port: http://0.0.0.0:${listenPort}`);
  });
}

startServer();
