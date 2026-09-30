#!/usr/bin/env python3
"""
Native Mode Switcher for IB Gateway (Option C)
Orchestrates seamless switching between Paper (Port 4002) and Live (Port 4001) lanes.
Handles configuration updates, service restart, xdotool autologin, and alpha-engine re-binding.
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
                        lines.append(f"IBKR_PORT={port}\n")
                    elif line.startswith("TRADING_MODE="):
                        lines.append(f"TRADING_MODE={mode.upper()}\n")
                    else:
                        lines.append(line)
            with open(ENV_PATH, "w") as f:
                f.writelines(lines)
            print(f"[SWITCHER] Updated {ENV_PATH}")
        except Exception as e:
            print(f"[SWITCHER] Warning updating {ENV_PATH}: {e}")


def restart_service(service_name: str):
    """Restart a systemd service."""
    print(f"[SWITCHER] Restarting {service_name}...")
    subprocess.run(["sudo", "systemctl", "restart", service_name], check=True)


def switch_lane(mode: str, password: Optional[str] = None) -> bool:
    mode = mode.upper()
    if mode not in ["PAPER", "LIVE"]:
        print(f"[SWITCHER] Error: Invalid mode '{mode}'. Must be 'PAPER' or 'LIVE'.")
        return False

    target_port = 4001 if mode == "LIVE" else 4002
    print(f"==================================================")
    print(f"  ALPHAENGINE MODE SWITCH: -> {mode} (PORT {target_port})")
    print(f"==================================================")

    # 1. Update jts.ini
    update_jts_ini(mode)

    # 2. Restart ibgateway.service
    restart_service("ibgateway.service")
    time.sleep(3)

    # 3. Invoke native xdotool autologin
    script_dir = os.path.dirname(os.path.abspath(__file__))
    autologin_path = os.path.join(script_dir, "gateway_autologin.py")

    cmd = ["python3", autologin_path, "--mode", mode]
    if password:
        cmd.extend(["--password", password])

    print(f"[SWITCHER] Executing native headless login ({autologin_path})...")
    res = subprocess.run(cmd)

    if res.returncode != 0:
        print(f"[SWITCHER] ERROR: Gateway failed to authenticate on port {target_port}.")
        return False

    # 4. Update engine config and re-bind alpha-engine.service
    update_engine_config(target_port, mode)
    restart_service("alpha-engine.service")

    print(f"==================================================")
    print(f"  SUCCESS: {mode} LANE ACTIVE & CONNECTED (PORT {target_port})")
    print(f"==================================================")
    return True


def main():
    parser = argparse.ArgumentParser(description="Switch AlphaEngine Gateway Mode (Option C)")
    parser.add_argument("--mode", required=True, choices=["PAPER", "LIVE", "paper", "live"], help="Target lane")
    parser.add_argument("--password", default=os.environ.get("IBKR_PASSWORD"), help="Password for Live account")

    args = parser.parse_args()
    success = switch_lane(mode=args.mode, password=args.password)
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
