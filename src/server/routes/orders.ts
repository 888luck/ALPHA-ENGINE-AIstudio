import { Router } from "express";
import { systemSettings, activeTrades, executionBlotter, db_fs, persistSettings, setActiveTrades } from "../state";
import { authMiddleware, getMaskedSettings } from "../middleware/auth";

export const ordersRouter = Router();

ordersRouter.get("/api/execution/blotter", (req, res) => {
  res.json({ success: true, blotter: executionBlotter });
});

// Single Execution Authority: Order Relay to Frankfurt Python Edge Node via Firestore
ordersRouter.post("/api/place-trade", authMiddleware, async (req, res) => {
  if (systemSettings.routerLocked) {
    return res.status(403).json({ error: "EXECUTION ROUTER HARD-LOCKED: Risk circuit breaker or session termination in progress." });
  }

  const { symbol, direction, entryPrice, stopPrice, quantity } = req.body;

  if (!symbol || !direction || !entryPrice || !stopPrice) {
    return res.status(400).json({ error: "Missing required order parameters (symbol, direction, entry, stop)." });
  }

  // Single Authority Policy: The Frankfurt Python Edge Node is the sole execution authority.
  // Express relays the authenticated order command to Firestore for execution by the Edge Node.
  if (db_fs) {
    try {
      const cmdId = `CMD_${Date.now()}_${symbol}`;
      await db_fs.collection("system_commands").doc(cmdId).set({
        type: "SUBMIT_ORDER",
        symbol: symbol.toUpperCase(),
        direction: direction.toUpperCase(),
        entryPrice: Number(entryPrice),
        stopPrice: Number(stopPrice),
        quantity: quantity ? Number(quantity) : null,
        status: "PENDING_EDGE_DISPATCH",
        createdAt: new Date().toISOString()
      });
      return res.json({ 
        success: true, 
        message: `Order command queued for Frankfurt Python Edge Node execution (Ref: ${cmdId})`,
        commandId: cmdId
      });
    } catch (err: any) {
      return res.status(500).json({ error: `Failed queuing order command to Edge Node: ${err.message}` });
    }
  } else {
    return res.status(503).json({ 
      error: "Edge Node communication link offline (Firestore uninitialized). Simulated execution is disabled under Zero Synthetic Policy." 
    });
  }
});

// Manual override emergency kill button endpoint
ordersRouter.post("/api/trigger-flush", authMiddleware, async (req, res) => {
  console.log(`[EMERGENCY FLUSH] MANUAL SYSTEMIC OVERRIDE KILL-SWITCH INITIATED VIA PORTFOLIO WEB PANEL`);
  setActiveTrades([]);
  systemSettings.routerLocked = true;
  persistSettings();

  if (db_fs) {
    try {
      await db_fs.collection("system_commands").add({
        type: "EMERGENCY_FLUSH",
        reason: "Manual flush initiated via web control plane",
        timestamp: new Date().toISOString()
      });
    } catch (e: any) {
      console.warn("[FIREBASE] Command forward warning:", e.message);
    }
  }
  res.json({ success: true, settings: getMaskedSettings(systemSettings), activeTrades });
});
