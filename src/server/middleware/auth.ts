import express from "express";
import { SystemSettings } from "../types";

export const authMiddleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const configuredKeys = [
    process.env.OPERATOR_ADMIN_KEY,
    process.env.ADMIN_OPERATOR_KEY,
    process.env.ADMIN_KEY
  ].filter(Boolean) as string[];

  // Fallback to ALPHA_ADMIN_REVERT_992 ONLY if no custom operator key has been configured in the environment
  const allowedKeys = new Set(
    configuredKeys.length > 0 ? configuredKeys : ["ALPHA_ADMIN_REVERT_992"]
  );

  const authHeader = (req.headers["authorization"] || req.headers["Authorization"] || "") as string;
  const token = authHeader.startsWith("Bearer ") ? authHeader.substring(7).trim() : authHeader.trim();
  const xKey = ((req.headers["x-admin-key"] || req.headers["X-Admin-Key"] || req.body?.operator_key || req.body?.admin_key || req.query?.operator_key || req.query?.admin_key || "") as string).trim();

  // Authenticated key extraction (strictly require provided credentials, zero public fallback)
  const suppliedKey = xKey || token;

  if (suppliedKey && allowedKeys.has(suppliedKey)) {
    return next();
  }

  // Allow bypass ONLY in explicit offline development mode
  if (process.env.NODE_ENV === "development" && process.env.ALLOW_INSECURE_DEV === "true") {
    return next();
  }

  return res.status(401).json({
    error: "UNAUTHORIZED: Valid Operator Admin Key required to execute state-changing or risk operations."
  });
};

export function getMaskedSettings(settings: SystemSettings) {
  const masked = { ...settings };
  if (masked.geminiApiKey) masked.geminiApiKey = "configured";
  if (masked.openaiApiKey) masked.openaiApiKey = "configured";
  if (masked.anthropicApiKey) masked.anthropicApiKey = "configured";
  if (masked.nvidiaApiKey) masked.nvidiaApiKey = "configured";
  if (masked.customAiApiKey) masked.customAiApiKey = "configured";
  if (masked.openFdaApiKey) masked.openFdaApiKey = "configured";
  if (masked.fredApiKey) masked.fredApiKey = "configured";
  if (masked.patentsApiKey) masked.patentsApiKey = "configured";
  if (masked.ibkrPaperPassword) masked.ibkrPaperPassword = "configured";
  return masked;
}
