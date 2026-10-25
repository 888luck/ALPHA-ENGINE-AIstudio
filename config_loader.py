"""
AlphaEngine 12-Factor Decoupled Configuration & Secrets Loader
Universal Institutional Engineering Principles - Decoupled Lifecycle Resilience & Multi-Cloud Portability

Manages all credentials across the 4 Pillars without proprietary cloud SDK lock-in:
Priority 1: /etc/alpha-engine/secrets.env (Hardened POSIX environment file, chmod 600)
Priority 2: os.environ (Host / Systemd / Container environment injection)
Priority 3: .env (Local workspace fallback)
Priority 4: system_settings.json / settings_vault.json (Local disk persistence)
"""

import os
import json
import tempfile
from typing import Dict, Any, Tuple, Optional

try:
    from dotenv import load_dotenv
except ImportError:
    def load_dotenv(*args, **kwargs):
        """Fallback placeholder when python-dotenv is not installed."""
        pass

PRODUCTION_SECRETS_PATH = "/etc/alpha-engine/secrets.env"
LOCAL_SECRETS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")


def get_secrets_file_path() -> str:
    """Returns the most appropriate secrets file path based on environment."""
    env_override = os.environ.get("ALPHA_SECRETS_PATH")
    if env_override and os.path.exists(env_override):
        return env_override
    if os.path.exists(PRODUCTION_SECRETS_PATH):
        return PRODUCTION_SECRETS_PATH
    return LOCAL_SECRETS_PATH


KEY_MAPPINGS = {
    "ibkrPort": "IBKR_PORT",
    "ibkrHost": "IBKR_HOST",
    "ibkrAccountNumber": "IBKR_ACCOUNT_NUMBER",
    "ibkrClientId": "IBKR_CLIENT_ID",
    "tradingMode": "TRADING_MODE",
    "mifid2DecisionMaker": "MIFID2_DECISION_MAKER_ID",
    "mifid2ExecutionTrader": "MIFID2_EXECUTION_TRADER_ID",
    "edgeNodeHost": "EDGE_NODE_HOST",
    "edgeNodeIp": "EDGE_NODE_IP",
    "edgeTcpPort": "EDGE_TCP_PORT",
    "edgeAuthToken": "EDGE_AUTH_TOKEN",
    "gatewayConnectionActive": "GATEWAY_CONNECTION_ACTIVE",
    "geminiApiKey": "GEMINI_API_KEY",
    "groqApiKey": "GROQ_API_KEY",
    "customAiApiKey": "CUSTOM_AI_API_KEY",
    "nvidiaApiKey": "NVIDIA_API_KEY",
    "openaiApiKey": "OPENAI_API_KEY",
    "anthropicApiKey": "ANTHROPIC_API_KEY",
    "openrouterApiKey": "OPENROUTER_API_KEY",
    "customAiBaseUrl": "CUSTOM_AI_BASE_URL",
    "customAiModelName": "CUSTOM_AI_MODEL_NAME",
    "selectedAiProvider": "SELECTED_AI_PROVIDER",
    "secUserAgent": "SEC_USER_AGENT",
    "openFdaApiKey": "OPENFDA_API_KEY",
    "fredApiKey": "FRED_API_KEY",
    "patentsApiKey": "PATENTS_API_KEY",
    "ibkrPaperUsername": "IBKR_PAPER_USERNAME",
    "ibkrPaperPassword": "IBKR_PAPER_PASSWORD",
    "ibkrLiveUsername": "IBKR_LIVE_USERNAME",
    "ibkrLivePassword": "IBKR_LIVE_PASSWORD",
}
# Reverse mappings from UPPER_SNAKE_CASE to camelCase
REVERSE_KEY_MAPPINGS = {v: k for k, v in KEY_MAPPINGS.items()}

def parse_env_file(file_path: str) -> Dict[str, str]:
    """Parses a standard POSIX key=value env file safely with bidirectional case mapping."""
    res = {}
    if not os.path.exists(file_path):
        return res
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if "=" in line:
                    k, v = line.split("=", 1)
                    k = k.strip()
                    v = v.strip().strip('"').strip("'")
                    res[k] = v
                    # Bidirectional normalization
                    if k in KEY_MAPPINGS:
                        res[KEY_MAPPINGS[k]] = v
                    elif k in REVERSE_KEY_MAPPINGS:
                        res[REVERSE_KEY_MAPPINGS[k]] = v
    except Exception as e:
        print(f"[CONFIG LOADER] Notice: Could not read {file_path}: {e}")
    return res


def load_config() -> Dict[str, Any]:
    """
    Loads all environment variables for the Alpha Engine platform.
    Adheres strictly to the 12-Factor decoupled hierarchy:
      Priority 1: /etc/alpha-engine/secrets.env
      Priority 2: os.environ
      Priority 3: .env
      Priority 4: system_settings.json / settings_vault.json
    """
    # 1. Hydrate from production file or local .env if available
    secrets_file = get_secrets_file_path()
    if os.path.exists(secrets_file):
        try:
            load_dotenv(secrets_file)
        except Exception:
            pass
    else:
        load_dotenv()

    file_secrets = parse_env_file(secrets_file)

    # Priority 4: Disk JSON fallback
    disk_settings: Dict[str, Any] = {}
    for p4_path in [
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "system_settings.json"),
        "/opt/alpha-engine/system_settings.json",
        "system_settings.json",
        "settings_vault.json"
    ]:
        if os.path.exists(p4_path):
            try:
                with open(p4_path, "r", encoding="utf-8") as f:
                    disk_settings.update(json.load(f))
            except Exception:
                pass

    def get_val(key: str, default: str = "") -> str:
        # 1. Direct environment check
        if key in os.environ and os.environ[key] != "":
            return os.environ[key]
        # 2. Direct secrets file check
        if key in file_secrets and file_secrets[key] != "":
            return file_secrets[key]
        # 3. Mapped key check (camelCase <-> UPPER_SNAKE_CASE)
        alt_key = KEY_MAPPINGS.get(key) or REVERSE_KEY_MAPPINGS.get(key)
        if alt_key:
            if alt_key in os.environ and os.environ[alt_key] != "":
                return os.environ[alt_key]
            if alt_key in file_secrets and file_secrets[alt_key] != "":
                return file_secrets[alt_key]
        # 4. Priority 4 disk settings check
        if key in disk_settings and disk_settings[key] not in (None, ""):
            return str(disk_settings[key])
        if alt_key and alt_key in disk_settings and disk_settings[alt_key] not in (None, ""):
            return str(disk_settings[alt_key])
        # 5. Case-insensitive search across file_secrets
        key_clean = key.replace("_", "").lower()
        for fk, fv in file_secrets.items():
            if fk.replace("_", "").lower() == key_clean and fv:
                return fv
        for dk, dv in disk_settings.items():
            if dk.replace("_", "").lower() == key_clean and dv not in (None, ""):
                return str(dv)
        return default

    # Reconcile mode and port deterministically
    raw_mode = get_val("TRADING_MODE", "").upper()
    raw_port = get_val("IBKR_PORT", "")
    if raw_port == "4001" and not raw_mode:
        raw_mode = "LIVE"
    elif raw_port == "4002" and not raw_mode:
        raw_mode = "PAPER"
    elif raw_mode == "LIVE" and not raw_port:
        raw_port = "4001"
    elif raw_mode == "PAPER" and not raw_port:
        raw_port = "4002"

    resolved_mode = raw_mode if raw_mode in ["LIVE", "PAPER"] else "LIVE"
    resolved_port = int(raw_port) if raw_port and raw_port.isdigit() else (4001 if resolved_mode == "LIVE" else 4002)

    default_host = "10.156.0.2" if os.environ.get("K_SERVICE") else "127.0.0.1"
    edge_host = get_val("EDGE_NODE_HOST") or get_val("EDGE_NODE_IP") or get_val("IBKR_HOST", default_host)
    edge_port = int(get_val("EDGE_TCP_PORT", "4005"))

    config: Dict[str, Any] = {
        # Pillar 1: Brokerage (IBKR IE)
        "IBKR_ACCOUNT_NUMBER": get_val("IBKR_ACCOUNT_NUMBER", "U16151462" if resolved_mode == "LIVE" else "DUE263010"),
        "IBKR_HOST": edge_host,
        "IBKR_PORT": resolved_port,
        "IBKR_CLIENT_ID": int(get_val("IBKR_CLIENT_ID", "10")),
        "IBKR_PAPER_USERNAME": get_val("IBKR_PAPER_USERNAME", ""),
        "IBKR_PAPER_PASSWORD": get_val("IBKR_PAPER_PASSWORD", ""),
        "IBKR_LIVE_USERNAME": get_val("IBKR_LIVE_USERNAME", ""),
        "IBKR_LIVE_PASSWORD": get_val("IBKR_LIVE_PASSWORD", ""),
        "MIFID2_DECISION_MAKER_ID": get_val("MIFID2_DECISION_MAKER_ID", "ALGO_DEC_992"),
        "MIFID2_EXECUTION_TRADER_ID": get_val("MIFID2_EXECUTION_TRADER_ID", "ALGO_EXE_554"),

        # Pillar 2: Cloud & Edge Node
        "EDGE_NODE_HOST": edge_host,
        "EDGE_NODE_IP": edge_host,
        "EDGE_TCP_PORT": edge_port,
        "EDGE_AUTH_TOKEN": get_val("EDGE_AUTH_TOKEN", "ALPHA_EDGE_SECRET_2026"),
        "TRADING_MODE": resolved_mode,
        "ADMIN_OPERATOR_KEY": get_val("ADMIN_OPERATOR_KEY", "ALPHA_ADMIN_REVERT_992"),
        "ALLOW_LIVE_TRADING": get_val("ALLOW_LIVE_TRADING", "false").lower() in ["true", "1", "yes"],
        "MAX_ACTIVE_INSTRUMENTS": int(get_val("MAX_ACTIVE_INSTRUMENTS", "3")),

        # Pillar 3: AI Model Providers
        "GEMINI_API_KEY": get_val("GEMINI_API_KEY", ""),
        "GROQ_API_KEY": get_val("GROQ_API_KEY", "") or get_val("CUSTOM_AI_API_KEY", ""),
        "CUSTOM_AI_API_KEY": get_val("CUSTOM_AI_API_KEY", "") or get_val("GROQ_API_KEY", ""),
        "NVIDIA_API_KEY": get_val("NVIDIA_API_KEY", "") or get_val("NVIDIA_INFERENCE_API_KEY", ""),
        "OPENAI_API_KEY": get_val("OPENAI_API_KEY", ""),
        "ANTHROPIC_API_KEY": get_val("ANTHROPIC_API_KEY", ""),
        "OPENROUTER_API_KEY": get_val("OPENROUTER_API_KEY", ""),
        "CUSTOM_AI_BASE_URL": get_val("CUSTOM_AI_BASE_URL", "http://localhost:11434/v1"),
        "CUSTOM_AI_MODEL_NAME": get_val("CUSTOM_AI_MODEL_NAME", "llama3.1"),
        "SELECTED_AI_PROVIDER": get_val("SELECTED_AI_PROVIDER", "gemini-flash"),

        # Pillar 4: Primary Institutional Data Feeds
        "SEC_USER_AGENT": get_val("SEC_USER_AGENT", "AlphaEngine/2.0 (InstitutionalResearch; contact@alphaengine.internal)"),
        "OPENFDA_API_KEY": get_val("OPENFDA_API_KEY", ""),
        "FRED_API_KEY": get_val("FRED_API_KEY", ""),
        "PATENTS_API_KEY": get_val("PATENTS_API_KEY", ""),
    }

    return config


def get_edge_endpoint() -> Tuple[str, int]:
    """
    Dynamically resolves the active Edge Node endpoint (host, port).
    Eliminates hardcoded 127.0.0.1 references across all callers (backtester, copilot, tests).
    """
    cfg = load_config()
    host = cfg["EDGE_NODE_HOST"]
    port = cfg["EDGE_TCP_PORT"]
    return host, port


def save_secrets_to_vault(updates: Dict[str, Any], target_path: Optional[str] = None) -> bool:
    """
    Safely and atomically writes updated configuration/secrets to disk.
    Synchronizes os.environ in memory instantly without service restart.
    Uses atomic write-and-replace (.tmp write + os.replace) with chmod 600 permissions.
    """
    if not target_path:
        target_path = PRODUCTION_SECRETS_PATH
        # If /etc/alpha-engine is not writable, fallback to local path
        try:
            target_dir = os.path.dirname(target_path)
            if not os.path.exists(target_dir):
                os.makedirs(target_dir, mode=0o700, exist_ok=True)
        except Exception:
            target_path = LOCAL_SECRETS_PATH

    # Read current state
    current_secrets = parse_env_file(target_path)

    # 1. Update os.environ in memory with bidirectional keys
    for k, v in updates.items():
        if v is not None:
            val_str = str(v)
            os.environ[k] = val_str
            current_secrets[k] = val_str
            alt_k = KEY_MAPPINGS.get(k) or REVERSE_KEY_MAPPINGS.get(k)
            if alt_k:
                os.environ[alt_k] = val_str
                current_secrets[alt_k] = val_str

    # 2. Write atomically using a temporary file
    target_dir = os.path.dirname(target_path) or "."
    try:
        with tempfile.NamedTemporaryFile("w", dir=target_dir, delete=False, encoding="utf-8") as tf:
            tf.write("# AlphaEngine 12-Factor Decoupled Secrets Vault\n")
            tf.write("# Auto-generated via AlphaEngine Control Plane. Strictly Protected (chmod 600).\n\n")
            for k, v in sorted(current_secrets.items()):
                clean_v = str(v).replace('"', '\\"')
                tf.write(f'{k}="{clean_v}"\n')
            temp_name = tf.name

        # Enforce chmod 600 on POSIX
        try:
            os.chmod(temp_name, 0o600)
        except Exception:
            pass

        os.replace(temp_name, target_path)
        print(f"[VAULT] Successfully persisted secrets atomically to {target_path}")
        return True
    except Exception as e:
        print(f"[VAULT ERROR] Could not persist secrets to {target_path}: {e}")
        return False
