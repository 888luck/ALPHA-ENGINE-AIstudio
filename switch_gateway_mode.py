#!/usr/bin/env python3
"""
Native Mode Switcher for IB Gateway (Option C - Institutional IBC Standard)
Orchestrates seamless switching between Paper (Port 4002) and Live (Port 4001) lanes.
Handles configuration updates, service restart, IBC automated JVM login, and alpha-engine re-binding.
"""

import argparse
import configparser
import json
import os
import subprocess
import sys
import time
from typing import Optional

JTS_PATHS = [
    "/opt/ibgateway/jts.ini",
    "/root/Jts/jts.ini",
    "/home/mstouff/Jts/jts.ini",
]

CONFIG_JSON_PATH = "/opt/alpha-engine/config.json"
ENV_PATH = "/opt/alpha-engine/.env"


def update_jts_ini(mode: str):
    """Update tradingMode in all relevant jts.ini files."""
    jts_mode = "l" if mode.upper() == "LIVE" else "p"
    print(f"[SWITCHER] Updating jts.ini files to tradingMode='{jts_mode}'...")

    for path in JTS_PATHS:
        if not os.path.exists(path):
            continue
        try:
            config = configparser.ConfigParser()
            config.read(path)
            if not config.has_section("Logon"):
                config.add_section("Logon")
            config.set("Logon", "tradingMode", jts_mode)
            with open(path, "w") as f:
                config.write(f)
            print(f"[SWITCHER] Successfully updated: {path}")
        except Exception as e:
            print(f"[SWITCHER] Warning: Failed to update {path}: {e}")


def update_engine_config(port: int, mode: str):
    """Update local engine config and .env to route to the new port."""
    print(f"[SWITCHER] Updating engine port configuration to {port} ({mode})...")
    # Update config.json if present
    if os.path.exists(CONFIG_JSON_PATH):
        try:
            with open(CONFIG_JSON_PATH, "r") as f:
                data = json.load(f)
            data["IBKR_PORT"] = port
            data["TRADING_MODE"] = mode.upper()
            with open(CONFIG_JSON_PATH, "w") as f:
                json.dump(data, f, indent=2)
            print(f"[SWITCHER] Updated {CONFIG_JSON_PATH}")
        except Exception as e:
            print(f"[SWITCHER] Warning updating {CONFIG_JSON_PATH}: {e}")

    # Update .env
    if os.path.exists(ENV_PATH):
        try:
            lines = []
            with open(ENV_PATH, "r") as f:
                for line in f:
                    if line.startswith("IBKR_PORT="):
                        lines.append(f"IBKR_PORT=\"{port}\"\n")
                    elif line.startswith("TRADING_MODE="):
                        lines.append(f"TRADING_MODE=\"{mode.upper()}\"\n")
                    else:
                        lines.append(line)
            with open(ENV_PATH, "w") as f:
                f.writelines(lines)
            print(f"[SWITCHER] Updated {ENV_PATH}")
        except Exception as e:
            print(f"[SWITCHER] Warning updating {ENV_PATH}: {e}")


def update_ibc_config(mode: str, user: Optional[str] = None, password: Optional[str] = None):
    """Update TradingMode and credentials in /opt/ibc/config.ini."""
    ibc_ini = "/opt/ibc/config.ini"
    if not os.path.exists(ibc_ini):
        return

    target_mode = "live" if mode.upper() == "LIVE" else "paper"
    target_port = 4001 if mode.upper() == "LIVE" else 4002

    try:
        with open(ibc_ini, "r") as f:
            lines = f.readlines()

        new_lines = []
        for line in lines:
            if line.startswith("TradingMode="):
                new_lines.append(f"TradingMode={target_mode}\n")
            elif line.startswith("OverrideTwsApiPort="):
                new_lines.append(f"OverrideTwsApiPort={target_port}\n")
            elif user and line.startswith("IbLoginId="):
                new_lines.append(f"IbLoginId={user}\n")
            elif password and line.startswith("IbPassword="):
                new_lines.append(f"IbPassword={password}\n")
            else:
                new_lines.append(line)

        tmp_path = f"{ibc_ini}.tmp"
        with open(tmp_path, "w") as f:
            f.writelines(new_lines)
        os.replace(tmp_path, ibc_ini)
        os.chmod(ibc_ini, 0o600)
        print(f"[SWITCHER] Updated IBC configuration: TradingMode={target_mode} (Port {target_port}, User {user or 'unchanged'})")
    except Exception as e:
        print(f"[SWITCHER] Warning updating IBC config: {e}")


def wait_for_gateway_port(port: int, host: str = "127.0.0.1", timeout: int = 90) -> bool:
    """Poll until the Gateway API port is accepting connections via IBC authentication."""
    import socket
    print(f"[SWITCHER] Waiting for IB Gateway API socket on {host}:{port} via IBC...")
    start_time = time.time()
    while time.time() - start_time < timeout:
        try:
            with socket.create_connection((host, port), timeout=2):
                print(f"[SWITCHER] Verified active connection on port {port} in {time.time() - start_time:.1f}s")
                return True
        except (socket.timeout, ConnectionRefusedError, OSError):
            time.sleep(2)
    print(f"[SWITCHER] Timeout after {timeout}s waiting for port {port} to open.")
    return False


def restart_service(service_name: str):
    """Restart a systemd service."""
    print(f"[SWITCHER] Restarting {service_name}...")
    subprocess.run(["sudo", "systemctl", "restart", service_name], check=True)


def switch_lane(mode: str, password: Optional[str] = None, username: Optional[str] = None) -> bool:
    mode = mode.upper()
    if mode not in ["PAPER", "LIVE"]:
        print(f"[SWITCHER] Error: Invalid mode '{mode}'. Must be 'PAPER' or 'LIVE'.")
        return False

    target_port = 4001 if mode == "LIVE" else 4002
    print(f"==================================================")
    print(f"  ALPHAENGINE MODE SWITCH: -> {mode} (PORT {target_port})")
    print(f"==================================================")

    # Resolve credentials from .env if not explicitly provided
    env_vars = {}
    if os.path.exists(ENV_PATH):
        try:
            with open(ENV_PATH, "r") as f:
                for line in f:
                    line = line.strip()
                    if "=" in line and not line.startswith("#"):
                        k, v = line.split("=", 1)
                        env_vars[k.strip()] = v.strip().strip('"').strip("'")
        except Exception:
            pass

    if mode == "LIVE":
        resolved_user = username or env_vars.get("IBKR_LIVE_USERNAME") or env_vars.get("IBKR_USERNAME")
        resolved_pass = password or env_vars.get("IBKR_LIVE_PASSWORD") or env_vars.get("IBKR_PASSWORD")
    else:
        resolved_user = username or env_vars.get("IBKR_PAPER_USERNAME") or env_vars.get("IBKR_USERNAME") or "mstouff17"
        resolved_pass = password or env_vars.get("IBKR_PAPER_PASSWORD") or env_vars.get("IBKR_PASSWORD")

    # 1. Update engine config and .env FIRST so any downstream service reads correct lane
    update_engine_config(target_port, mode)

    # 2. Update jts.ini
    update_jts_ini(mode)

    # 3. Update IBC configuration with lane & resolved credentials
    update_ibc_config(mode, user=resolved_user, password=resolved_pass)

    # 4. Restart ibgateway.service (IBC automatically handles JVM login & Swing dialogs)
    restart_service("ibgateway.service")

    # 5. Wait for IBC to authenticate and open the target API port
    if not wait_for_gateway_port(target_port, timeout=90):
        print(f"[SWITCHER] ERROR: Gateway failed to authenticate on port {target_port}.")
        return False

    # 6. Re-bind alpha-engine.service to connect to the active port
    restart_service("alpha-engine.service")

    print(f"==================================================")
    print(f"  SUCCESS: {mode} LANE ACTIVE & CONNECTED (PORT {target_port})")
    print(f"==================================================")
    return True


def main():
    parser = argparse.ArgumentParser(description="Switch AlphaEngine Gateway Mode (Option C - IBC Standard)")
    parser.add_argument("--mode", required=True, choices=["PAPER", "LIVE", "paper", "live"], help="Target lane")
    parser.add_argument("--user", "--username", default=None, help="Username for account")
    parser.add_argument("--password", default=os.environ.get("IBKR_PASSWORD"), help="Password for account")

    args = parser.parse_args()
    success = switch_lane(mode=args.mode, password=args.password, username=args.user)
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
