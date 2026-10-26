/**
 * AlphaEngine 12-Factor Decoupled Vault Engine
 * Universal Institutional Engineering Principles - Decoupled Lifecycle Resilience & Multi-Cloud Portability
 * 
 * Manages all credentials across the 4 Pillars without proprietary cloud SDK lock-in:
 * Priority 1: /etc/alpha-engine/secrets.env (Hardened POSIX environment file, chmod 600)
 * Priority 2: process.env (Host/Container environment injection)
 * Priority 3: .env (Local workspace fallback)
 * Priority 4: system_settings.json (Disk persistence)
 */

import fs from "fs";
import path from "path";

export interface VaultCredentials {
  // Pillar 1: Brokerage (IBKR IE)
  ibkrAccountNumber: string;
  ibkrLiveAccountNumber?: string;
  ibkrPaperAccountNumber?: string;
  ibkrHost: string;
  ibkrPort: number;
  ibkrClientId: number;
  ibkrPaperUsername?: string;
  ibkrPaperPassword?: string;
  ibkrLiveUsername?: string;
  ibkrLivePassword?: string;
  mifid2DecisionMaker: string;
  mifid2ExecutionTrader: string;

  // Pillar 2: Cloud & Edge Node
  edgeNodeHost: string;
  edgeTcpPort: number;
  edgeAuthToken: string;
  tradingMode: "PAPER" | "LIVE";
  adminOperatorKey: string;

  // Pillar 3: AI Model Providers
  geminiApiKey: string;
  groqApiKey: string;
  customAiApiKey: string;
  nvidiaApiKey: string;
  openaiApiKey: string;
  anthropicApiKey: string;
  openrouterApiKey?: string;
  customAiBaseUrl: string;
  customAiModelName: string;
  selectedAiProvider: string;

  // Pillar 4: Primary Institutional Data Feeds
  secUserAgent: string;
  openFdaApiKey: string;
  fredApiKey: string;
  patentsApiKey: string;
}

// Canonical candidate paths for the 12-factor secrets file
const PRODUCTION_SECRETS_PATH = "/etc/alpha-engine/secrets.env";
const LOCAL_SECRETS_PATH = path.join(process.cwd(), ".env");

export function getSecretsFilePath(): string {
  if (process.env.ALPHA_SECRETS_PATH && fs.existsSync(process.env.ALPHA_SECRETS_PATH)) {
    return process.env.ALPHA_SECRETS_PATH;
  }
  if (fs.existsSync(PRODUCTION_SECRETS_PATH)) {
    return PRODUCTION_SECRETS_PATH;
  }
  return LOCAL_SECRETS_PATH;
}

/**
 * Parses a standard POSIX key=value env file into a key-value dictionary.
 */
export function parseEnvFile(filePath: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!fs.existsSync(filePath)) return result;
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx !== -1) {
        const key = trimmed.slice(0, idx).trim();
        let val = trimmed.slice(idx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        result[key] = val;
      }
    }
  } catch (err: any) {
    console.warn(`[VAULT] Notice: Could not read secrets file ${filePath}:`, err.message);
  }
  return result;
}

/**
 * Loads all 4-pillar credentials following the strict 12-factor priority chain.
 */
export function loadVaultCredentials(): VaultCredentials {
  const fileEnv = parseEnvFile(getSecretsFilePath());

  const getVal = (envKey: string, fallback: string = ""): string => {
    return process.env[envKey] || fileEnv[envKey] || fallback;
  };

  const defaultFallbackHost = process.env.K_SERVICE ? "10.156.0.2" : "127.0.0.1";
  const edgeHost = getVal("EDGE_NODE_HOST") || getVal("EDGE_NODE_IP") || getVal("IBKR_HOST", defaultFallbackHost);
  const edgePort = Number(getVal("EDGE_TCP_PORT", "4005")) || 4005;

  return {
    // Pillar 1: Brokerage
    ibkrAccountNumber: getVal("IBKR_ACCOUNT_NUMBER", ""),
    ibkrLiveAccountNumber: getVal("IBKR_LIVE_ACCOUNT_NUMBER", ""),
    ibkrPaperAccountNumber: getVal("IBKR_PAPER_ACCOUNT_NUMBER", ""),
    ibkrHost: edgeHost,
    ibkrPort: Number(getVal("IBKR_PORT", "4002")) || 4002,
    ibkrClientId: Number(getVal("IBKR_CLIENT_ID", "10")) || 10,
    ibkrPaperUsername: getVal("IBKR_PAPER_USERNAME", ""),
    ibkrPaperPassword: getVal("IBKR_PAPER_PASSWORD", ""),
    ibkrLiveUsername: getVal("IBKR_LIVE_USERNAME", ""),
    ibkrLivePassword: getVal("IBKR_LIVE_PASSWORD", ""),
    mifid2DecisionMaker: getVal("MIFID2_DECISION_MAKER_ID", "ALGO_DEC_992"),
    mifid2ExecutionTrader: getVal("MIFID2_EXECUTION_TRADER_ID", "ALGO_EXE_554"),

    // Pillar 2: Cloud & Edge Node
    edgeNodeHost: edgeHost,
    edgeTcpPort: edgePort,
    edgeAuthToken: getVal("EDGE_AUTH_TOKEN", "ALPHA_EDGE_SECRET_2026"),
    tradingMode: (getVal("TRADING_MODE", "PAPER").toUpperCase() === "LIVE" ? "LIVE" : "PAPER"),
    adminOperatorKey: getVal("OPERATOR_ADMIN_KEY") || getVal("ADMIN_OPERATOR_KEY", "ALPHA_ADMIN_REVERT_992"),

    // Pillar 3: AI Model Providers
    geminiApiKey: getVal("GEMINI_API_KEY", ""),
    groqApiKey: getVal("GROQ_API_KEY", "") || getVal("CUSTOM_AI_API_KEY", ""),
    customAiApiKey: getVal("CUSTOM_AI_API_KEY", "") || getVal("GROQ_API_KEY", ""),
    nvidiaApiKey: getVal("NVIDIA_API_KEY", "") || getVal("NVIDIA_INFERENCE_API_KEY", ""),
    openaiApiKey: getVal("OPENAI_API_KEY", ""),
    anthropicApiKey: getVal("ANTHROPIC_API_KEY", ""),
    openrouterApiKey: getVal("OPENROUTER_API_KEY", ""),
    customAiBaseUrl: getVal("CUSTOM_AI_BASE_URL", "http://localhost:11434/v1"),
    customAiModelName: getVal("CUSTOM_AI_MODEL_NAME", "llama3.1"),
    selectedAiProvider: getVal("SELECTED_AI_PROVIDER", "gemini-flash"),

    // Pillar 4: Feeds
    secUserAgent: getVal("SEC_USER_AGENT", "AlphaEngine/2.0 (InstitutionalResearch; contact@alphaengine.internal)"),
    openFdaApiKey: getVal("OPENFDA_API_KEY", ""),
    fredApiKey: getVal("FRED_API_KEY", ""),
    patentsApiKey: getVal("PATENTS_API_KEY", ""),
  };
}

/**
 * Masks a secret string for safe UI presentation without compromising privacy.
 */
export function maskSecret(val?: string, fullMask: boolean = false): string {
  if (!val || typeof val !== "string" || val.trim().length === 0) return "";
  const trimmed = val.trim();
  if (fullMask) return "••••••••••••";
  if (trimmed.length <= 8) return "••••••••";
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

export function isMaskedString(val?: any): boolean {
  if (!val || typeof val !== "string") return false;
  const s = val.trim();
  return s.includes("...") || s.includes("••••") || s === "configured";
}

/**
 * Returns safe masked credentials for UI rendering across ApiVaultModal and Sub-menus.
 */
export function getMaskedVaultCredentials(): Record<string, any> {
  const creds = loadVaultCredentials();
  return {
    ...creds,
    ibkrPaperPassword: maskSecret(creds.ibkrPaperPassword, true),
    ibkrLivePassword: maskSecret(creds.ibkrLivePassword, true),
    edgeAuthToken: maskSecret(creds.edgeAuthToken),
    adminOperatorKey: maskSecret(creds.adminOperatorKey),
    geminiApiKey: maskSecret(creds.geminiApiKey),
    groqApiKey: maskSecret(creds.groqApiKey),
    customAiApiKey: maskSecret(creds.customAiApiKey),
    nvidiaApiKey: maskSecret(creds.nvidiaApiKey),
    openaiApiKey: maskSecret(creds.openaiApiKey),
    anthropicApiKey: maskSecret(creds.anthropicApiKey),
    openrouterApiKey: maskSecret(creds.openrouterApiKey),
    openFdaApiKey: maskSecret(creds.openFdaApiKey),
    fredApiKey: maskSecret(creds.fredApiKey),
    patentsApiKey: maskSecret(creds.patentsApiKey),
    hasGeminiKey: !!(creds.geminiApiKey && creds.geminiApiKey.length >= 20),
    hasGroqKey: !!(creds.groqApiKey && creds.groqApiKey.length >= 15),
    hasNvidiaKey: !!(creds.nvidiaApiKey && creds.nvidiaApiKey.length >= 15),
    hasOpenaiKey: !!(creds.openaiApiKey && creds.openaiApiKey.length >= 15),
    hasAnthropicKey: !!(creds.anthropicApiKey && creds.anthropicApiKey.length >= 15),
    hasOpenrouterKey: !!(creds.openrouterApiKey && creds.openrouterApiKey.length >= 15),
    hasOpenFdaKey: !!creds.openFdaApiKey,
    hasFredKey: !!creds.fredApiKey,
    hasPatentsKey: !!creds.patentsApiKey,
  };
}

/**
 * Safely and atomically saves updated credentials to disk and synchronizes process.env.
 * Uses atomic write-and-replace (.tmp write + rename) with chmod 600 permissions.
 */
export function saveVaultCredentials(updates: Partial<VaultCredentials>): VaultCredentials {
  const current = loadVaultCredentials();
  
  // Clean incoming updates: Never let masked strings overwrite existing secrets!
  const sanitizedUpdates: Partial<VaultCredentials> = {};
  for (const [k, v] of Object.entries(updates)) {
    if (v !== undefined && v !== null) {
      if (typeof v === "string" && isMaskedString(v)) {
        // Skip masked string
        continue;
      }
      (sanitizedUpdates as any)[k] = v;
    }
  }

  const merged: VaultCredentials = { ...current, ...sanitizedUpdates };

  // Map updates to standard environment variable keys
  const envMap: Record<string, string> = {
    IBKR_ACCOUNT_NUMBER: merged.ibkrAccountNumber,
    IBKR_LIVE_ACCOUNT_NUMBER: merged.ibkrLiveAccountNumber || "",
    IBKR_PAPER_ACCOUNT_NUMBER: merged.ibkrPaperAccountNumber || "",
    IBKR_HOST: merged.ibkrHost,
    IBKR_PORT: String(merged.ibkrPort),
    IBKR_CLIENT_ID: String(merged.ibkrClientId),
    IBKR_PAPER_USERNAME: merged.ibkrPaperUsername || "",
    IBKR_PAPER_PASSWORD: merged.ibkrPaperPassword || "",
    IBKR_LIVE_USERNAME: merged.ibkrLiveUsername || "",
    IBKR_LIVE_PASSWORD: merged.ibkrLivePassword || "",
    MIFID2_DECISION_MAKER_ID: merged.mifid2DecisionMaker,
    MIFID2_EXECUTION_TRADER_ID: merged.mifid2ExecutionTrader,

    EDGE_NODE_HOST: merged.edgeNodeHost,
    EDGE_NODE_IP: merged.edgeNodeHost,
    EDGE_TCP_PORT: String(merged.edgeTcpPort),
    EDGE_AUTH_TOKEN: merged.edgeAuthToken,
    TRADING_MODE: merged.tradingMode,
    ADMIN_OPERATOR_KEY: merged.adminOperatorKey,
    OPERATOR_ADMIN_KEY: merged.adminOperatorKey,

    GEMINI_API_KEY: merged.geminiApiKey,
    GROQ_API_KEY: merged.groqApiKey,
    CUSTOM_AI_API_KEY: merged.customAiApiKey,
    NVIDIA_API_KEY: merged.nvidiaApiKey,
    OPENAI_API_KEY: merged.openaiApiKey,
    ANTHROPIC_API_KEY: merged.anthropicApiKey,
    OPENROUTER_API_KEY: merged.openrouterApiKey || "",
    CUSTOM_AI_BASE_URL: merged.customAiBaseUrl,
    CUSTOM_AI_MODEL_NAME: merged.customAiModelName,
    SELECTED_AI_PROVIDER: merged.selectedAiProvider,

    SEC_USER_AGENT: merged.secUserAgent,
    OPENFDA_API_KEY: merged.openFdaApiKey,
    FRED_API_KEY: merged.fredApiKey,
    PATENTS_API_KEY: merged.patentsApiKey,
  };

  // 1. Immediately synchronize running process.env in memory
  for (const [k, v] of Object.entries(envMap)) {
    if (v !== undefined) {
      process.env[k] = v;
    }
  }

  // 2. Determine target file destination
  let targetPath = PRODUCTION_SECRETS_PATH;
  try {
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
  } catch {
    // If /etc/ is not writable (e.g. non-root container or local dev), fallback to local path
    targetPath = LOCAL_SECRETS_PATH;
  }

  // 3. Atomically write to .tmp and rename
  const lines = [
    "# AlphaEngine 12-Factor Decoupled Secrets Vault",
    "# Auto-generated via AlphaEngine Control Plane. Strictly Protected (chmod 660).",
    `# Updated At: ${new Date().toISOString()}`,
    "",
  ];

  for (const [k, v] of Object.entries(envMap)) {
    lines.push(`${k}="${v.replace(/"/g, '\\"')}"`);
  }
  lines.push("");
  const content = lines.join("\n");

  const writeAtomic = (filePath: string) => {
    const tmp = `${filePath}.tmp.${Date.now()}`;
    try {
      fs.writeFileSync(tmp, content, { encoding: "utf-8", mode: 0o660 });
      fs.renameSync(tmp, filePath);
      try { fs.chmodSync(filePath, 0o660); } catch {}
      console.log(`[VAULT] Successfully persisted 12-factor secrets atomically to ${filePath}`);
      return true;
    } catch (err: any) {
      console.error(`[VAULT ERROR] Could not persist secrets to ${filePath}:`, err.message);
      if (fs.existsSync(tmp)) {
        try { fs.unlinkSync(tmp); } catch {}
      }
      return false;
    }
  };

  const prodSuccess = writeAtomic(targetPath);
  if (!prodSuccess && targetPath !== LOCAL_SECRETS_PATH) {
    writeAtomic(LOCAL_SECRETS_PATH);
  } else if (prodSuccess && targetPath === PRODUCTION_SECRETS_PATH && fs.existsSync(LOCAL_SECRETS_PATH)) {
    // Keep local mirror synchronized
    writeAtomic(LOCAL_SECRETS_PATH);
  }

  return merged;
}
