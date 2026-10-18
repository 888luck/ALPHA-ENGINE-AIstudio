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


def parse_env_file(file_path: str) -> Dict[str, str]:
    """Parses a standard POSIX key=value env file safely."""
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
    except Exception as e:
        print(f"[CONFIG LOADER] Notice: Could not read {file_path}: {e}")
    return res


def load_config() -> Dict[str, Any]:
    """
    Loads all environment variables for the Alpha Engine platform.
    Adheres strictly to the 12-Factor decoupled hierarchy.
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

    def get_val(key: str, default: str = "") -> str:
        return os.environ.get(key) or file_secrets.get(key) or default

    default_host = "10.156.0.2" if os.environ.get("K_SERVICE") else "127.0.0.1"
    edge_host = get_val("EDGE_NODE_HOST") or get_val("EDGE_NODE_IP") or get_val("IBKR_HOST", default_host)
    edge_port = int(get_val("EDGE_TCP_PORT", "4005"))

    config: Dict[str, Any] = {
        # Pillar 1: Brokerage (IBKR IE)
        "IBKR_ACCOUNT_NUMBER": get_val("IBKR_ACCOUNT_NUMBER", "DUE263010"),
        "IBKR_HOST": edge_host,
        "IBKR_PORT": int(get_val("IBKR_PORT", "4002")),  # 4001 Live, 4002 Paper
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
        "TRADING_MODE": get_val("TRADING_MODE", "PAPER").upper(),
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

    # 1. Update os.environ in memory
    for k, v in updates.items():
        if v is not None:
            val_str = str(v)
            os.environ[k] = val_str
            current_secrets[k] = val_str

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
