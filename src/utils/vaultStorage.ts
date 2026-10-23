// ==============================================================================
//           ALPHA ENGINE - DUAL-LAYER PERSISTENT VAULT STORAGE
// ==============================================================================
// Institutional principle: Zero-Omission Credential Retention.
// Credentials and API keys stored on the client origin persist permanently across
// page refreshes, tab closures, and Cloud Run scale-to-zero container recycles.
// ==============================================================================

const MASTER_KEY = "alpha_engine_settings";

const KEY_MAPPINGS: Record<string, string[]> = {
  geminiApiKey: ["alpha_gemini_key", "alpha_gemini_api_key", "customGeminiApiKey"],
  customAiApiKey: ["alpha_groq_key", "alpha_groq_api_key", "alpha_custom_ai_key"],
  nvidiaApiKey: ["alpha_nvidia_key", "alpha_nvidia_api_key"],
  openaiApiKey: ["alpha_openai_key", "alpha_openai_api_key"],
  anthropicApiKey: ["alpha_anthropic_key", "alpha_anthropic_api_key"],
  openrouterApiKey: ["alpha_openrouter_key", "alpha_openrouter_api_key"],
  openFdaApiKey: ["alpha_openfda_key"],
  fredApiKey: ["alpha_fred_key"],
  patentsApiKey: ["alpha_patents_key"],
  secUserAgent: ["alpha_sec_user_agent"],
  ibkrAccountNumber: ["alpha_ibkr_account_number"],
  ibkrHost: ["alpha_ibkr_host"],
  ibkrPort: ["alpha_ibkr_port"],
  ibkrClientId: ["alpha_ibkr_client_id"],
  mifid2DecisionMaker: ["alpha_mifid_maker"],
  mifid2ExecutionTrader: ["alpha_mifid_trader"],
  ibkrPaperUsername: ["alpha_ibkr_username"],
  ibkrPaperPassword: ["alpha_ibkr_password"],
  customAiBaseUrl: ["alpha_custom_ai_base_url"],
  customAiModelName: ["alpha_custom_ai_model_name"],
};

export function isMaskedString(val?: any): boolean {
  if (!val || typeof val !== "string") return false;
  const s = val.trim();
  return s.includes("...") || s.includes("••••") || s === "configured";
}

export function getStoredVaultValue(key: string, fallback?: string): string {
  if (typeof window === "undefined") return fallback || "";

  // 1. If fallback is a real non-empty unmasked key, return it
  if (fallback && fallback.trim() !== "" && !isMaskedString(fallback)) {
    return fallback.trim();
  }

  // 2. Check master JSON storage in localStorage
  try {
    const raw = localStorage.getItem(MASTER_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const val = parsed[key];
      if (val !== undefined && val !== null && String(val).trim() !== "" && !isMaskedString(String(val))) {
        return String(val).trim();
      }
    }
  } catch (e) {}

  // 3. Check individual key aliases in localStorage
  const aliases = KEY_MAPPINGS[key] || [`alpha_${key.toLowerCase()}`];
  for (const alias of aliases) {
    try {
      const val = localStorage.getItem(alias);
      if (val !== undefined && val !== null && val.trim() !== "" && !isMaskedString(val)) {
        return val.trim();
      }
    } catch (e) {}
  }

  return (fallback && !isMaskedString(fallback)) ? fallback : "";
}

export function getAllStoredVaultSettings(): Record<string, any> {
  if (typeof window === "undefined") return {};
  let master: Record<string, any> = {};
  try {
    const raw = localStorage.getItem(MASTER_KEY);
    if (raw) master = JSON.parse(raw);
  } catch (e) {}

  // Merge individual aliases in case any were written separately
  for (const [key, aliases] of Object.entries(KEY_MAPPINGS)) {
    if (!master[key] || master[key] === "configured") {
      for (const alias of aliases) {
        const val = localStorage.getItem(alias);
        if (val && val !== "configured" && val.trim() !== "") {
          master[key] = val.trim();
          break;
        }
      }
    }
  }

  return master;
}

export function persistVaultItem(key: string, value: any): void {
  if (typeof window === "undefined") return;
  const strVal = value !== undefined && value !== null ? String(value) : "";
  
  // Institutional protection: Never persist masked strings (•••• or ...) into localStorage
  if (isMaskedString(strVal)) return;

  // Save in master object
  try {
    const raw = localStorage.getItem(MASTER_KEY);
    const master = raw ? JSON.parse(raw) : {};
    master[key] = value;
    localStorage.setItem(MASTER_KEY, JSON.stringify(master));
  } catch (e) {}

  // Save in individual aliases
  const aliases = KEY_MAPPINGS[key] || [`alpha_${key.toLowerCase()}`];
  for (const alias of aliases) {
    try {
      if (strVal) {
        localStorage.setItem(alias, strVal);
      } else {
        localStorage.removeItem(alias);
      }
    } catch (e) {}
  }

  // Notify active components
  window.dispatchEvent(new CustomEvent("alpha_vault_settings_updated", { detail: { [key]: value } }));
}

export function persistVaultBatch(updates: Record<string, any>): void {
  if (typeof window === "undefined" || !updates) return;

  // Filter out any masked values
  const cleanUpdates: Record<string, any> = {};
  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined && value !== null && !isMaskedString(value)) {
      cleanUpdates[key] = value;
    }
  }

  if (Object.keys(cleanUpdates).length === 0) return;

  try {
    const raw = localStorage.getItem(MASTER_KEY);
    const master = raw ? JSON.parse(raw) : {};
    const merged = { ...master, ...cleanUpdates };
    localStorage.setItem(MASTER_KEY, JSON.stringify(merged));
  } catch (e) {}

  for (const [key, value] of Object.entries(cleanUpdates)) {
    const strVal = String(value);
    const aliases = KEY_MAPPINGS[key] || [`alpha_${key.toLowerCase()}`];
    for (const alias of aliases) {
      try {
        if (strVal) {
          localStorage.setItem(alias, strVal);
        }
      } catch (e) {}
    }
  }

  window.dispatchEvent(new CustomEvent("alpha_vault_settings_updated", { detail: cleanUpdates }));
}

// Background Server Re-hydration: Sends verified local client keys to server so current container instance stays in sync
export async function syncVaultToServer(updates?: Record<string, any>): Promise<boolean> {
  const settingsToSync = updates || getAllStoredVaultSettings();
  const cleanPayload: Record<string, any> = {};
  for (const [k, v] of Object.entries(settingsToSync)) {
    if (v !== undefined && v !== null && v !== "" && v !== "configured" && !isMaskedString(v)) {
      cleanPayload[k] = v;
    }
  }

  if (Object.keys(cleanPayload).length === 0) return false;

  try {
    const res = await fetch("/api/set-settings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-key": "ALPHA_ADMIN_REVERT_992"
      },
      body: JSON.stringify(cleanPayload)
    });
    return res.ok;
  } catch (e) {
    console.warn("[VaultStorage] Server sync deferred:", e);
    return false;
  }
}
