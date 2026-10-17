import { Router } from "express";
import { systemSettings, activeTrades, executionBlotter, persistSettings, setActiveTrades } from "../state";
import { authMiddleware, getMaskedSettings } from "../middleware/auth";
import { edgeBridge } from "../edgeBridge";

export const ordersRouter = Router();

ordersRouter.get("/api/execution/blotter", (req, res) => {
  res.json({ success: true, blotter: executionBlotter });
});

/**
 * Single Execution Authority: Direct TCP Order Relay to Frankfurt Python Edge Node
 * Replaces deprecated Firestore polling bus with direct TCP socket dispatch.
 */
ordersRouter.post("/api/place-trade", authMiddleware, async (req, res) => {
  if (systemSettings.routerLocked) {
    return res.status(403).json({ error: "EXECUTION ROUTER HARD-LOCKED: Risk circuit breaker or session termination in progress." });
  }

  const { symbol, direction, entryPrice, stopPrice, quantity } = req.body;

  if (!symbol || !direction || !entryPrice || !stopPrice) {
    return res.status(400).json({ error: "Missing required order parameters (symbol, direction, entry, stop)." });
  }

  try {
    const edgeResponse = await edgeBridge.submitOrder({
      symbol: symbol.toUpperCase(),
      direction: direction.toUpperCase(),
      entryPrice: Number(entryPrice),
      stopPrice: Number(stopPrice),
      quantity: quantity ? Number(quantity) : 1.0,
    });

    if (edgeResponse.status === "EXECUTED") {
      return res.json({
        success: true,
        message: `Order dispatched directly to Frankfurt IBKR Edge Daemon via TCP Socket: ${direction} ${quantity || 1} ${symbol}`,
        result: edgeResponse.result,
      });
    } else {
      return res.status(400).json({
        success: false,
        error: edgeResponse.message || "Edge Node rejected order dispatch.",
        details: edgeResponse,
      });
    }
  } catch (err: any) {
    return res.status(503).json({
      success: false,
      error: `Direct TCP Edge Node link failure: ${err.message}. Order was not transmitted to IBKR.`,
    });
  }
});

/**
 * Manual Emergency Flush Kill-Switch
 * Instantly transmits emergency portfolio liquidation command directly to Frankfurt Edge Daemon via TCP.
 */
ordersRouter.post("/api/trigger-flush", authMiddleware, async (req, res) => {
  console.log(`[EMERGENCY FLUSH] MANUAL SYSTEMIC OVERRIDE KILL-SWITCH INITIATED VIA PORTFOLIO WEB PANEL`);
  setActiveTrades([]);
  systemSettings.routerLocked = true;
  await persistSettings();

  try {
    const edgeResponse = await edgeBridge.triggerEmergencyFlush();
    return res.json({
      success: true,
      message: "Emergency liquidation executed directly on Frankfurt Edge Node via TCP Socket.",
      settings: getMaskedSettings(systemSettings),
      activeTrades,
      edgeResponse,
    });
  } catch (e: any) {
    console.warn("[EDGE TCP BRIDGE WARN] Direct socket flush dispatch error:", e.message);
    return res.json({
      success: true,
      warning: `Local router locked, but direct edge dispatch failed: ${e.message}`,
      settings: getMaskedSettings(systemSettings),
      activeTrades,
    });
  }
});
