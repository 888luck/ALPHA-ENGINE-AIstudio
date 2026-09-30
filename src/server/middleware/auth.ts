import express from "express";
import { SystemSettings } from "../types";

export const authMiddleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const operatorKey = process.env.OPERATOR_ADMIN_KEY || "ALPHA_ADMIN_REVERT_992";
  const authHeader = (req.headers["authorization"] || "") as string;
  const token = authHeader.startsWith("Bearer ") ? authHeader.substring(7).trim() : authHeader.trim();
  const xKey = ((req.headers["x-admin-key"] || req.body?.operator_key || req.query?.operator_key || "") as string).trim();

  if (token === operatorKey || xKey === operatorKey) {
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
  return masked;
}
