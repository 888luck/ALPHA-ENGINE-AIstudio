#!/usr/bin/env python3
"""
Native In-House Headless IB Gateway Automation (Option C - Event-Driven & IPC Upgraded)
Automates IB Gateway authentication on DISPLAY=:1 with state-aware 2FA protection.
Features:
- Adaptive 3-attempt burst with 3-minute gap for Live accounts (Zero 2FA spam)
- IPC Bridge on-demand trigger (/tmp/gateway_login.trigger or --trigger-now)
- 2FA Screen Detection: Never double-submits while an approval is pending
- Status Reporting via /tmp/gateway_status.json for dashboard telemetry
"""

import argparse
import json
import os
import re
import socket
import subprocess
import sys
import time
from typing import List, Optional, Tuple

DISPLAY = os.environ.get("DISPLAY", ":1")
ENV_PATH = "/opt/alpha-engine/.env"
TRIGGER_FILE = "/tmp/gateway_login.trigger"
STATUS_FILE = "/tmp/gateway_status.json"

# Screen coordinates on 1280x800 virtual display for IB Gateway 10.50
COORD_LIVE_TAB = (440, 398)
COORD_PAPER_TAB = (590, 398)
COORD_USERNAME_FIELD = (660, 378)
COORD_PASSWORD_FIELD = (660, 422)
COORD_LOGIN_BUTTON = (660, 485)

MAX_LIVE_ATTEMPTS = 3
INTER_ATTEMPT_COOLDOWN_SEC = 180  # 3 minutes between polite Live retries


def write_status(mode: str, port: int, state: str, attempts: int, message: str) -> None:
    """Atomic write of gateway authentication status for telemetry providers."""
    payload = {
        "mode": mode.upper(),
        "port": port,
        "state": state,  # "CONNECTED", "2FA_PENDING", "COOLDOWN", "STANDBY", "AUTHENTICATING", "DISCONNECTED"
        "attempts": attempts,
        "max_attempts": MAX_LIVE_ATTEMPTS,
        "message": message,
        "timestamp": time.time(),
    }
    tmp_path = f"{STATUS_FILE}.tmp"
    try:
        with open(tmp_path, "w") as f:
            json.dump(payload, f, indent=2)
        os.replace(tmp_path, STATUS_FILE)
        try:
            os.chmod(STATUS_FILE, 0o666)
        except Exception:
            pass
    except Exception:
        pass


def check_and_clear_trigger() -> bool:
    """Check if an on-demand IPC trigger was requested via trigger file."""
    if os.path.exists(TRIGGER_FILE):
        try:
            os.remove(TRIGGER_FILE)
        except Exception:
            pass
        return True
    return False


def load_env_credentials():
    """Load credentials from /opt/alpha-engine/.env if present."""
    creds = {}
    if os.path.exists(ENV_PATH):
        try:
            with open(ENV_PATH, "r") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, v = line.split("=", 1)
                        creds[k.strip()] = v.strip().strip('"').strip("'")
        except Exception as e:
            print(f"[AUTOLOGIN] Notice: Could not read .env: {e}")
    return creds


def run_xdotool(args: List[str]) -> subprocess.CompletedProcess:
    """Run an xdotool command on the specified DISPLAY."""
    env = os.environ.copy()
    env["DISPLAY"] = DISPLAY
    return subprocess.run(
        ["xdotool"] + args,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )


def is_port_open(port: int, host: str = "127.0.0.1", timeout: float = 1.0) -> bool:
    """Check if the target IB Gateway TCP socket is listening and accepting connections."""
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except (socket.timeout, ConnectionRefusedError, OSError):
        return False


def get_windows() -> List[Tuple[str, str]]:
    """Return a list of (window_id, window_name) on DISPLAY."""
    res = run_xdotool(["search", "--all", ""])
    if res.returncode != 0 or not res.stdout.strip():
        return []
    
    windows = []
    for wid in res.stdout.strip().split("\n"):
        wid = wid.strip()
        if not wid:
            continue
        name_res = run_xdotool(["getwindowname", wid])
        name = name_res.stdout.strip()
        if name:
            windows.append((wid, name))
    return windows


def get_window_geometry(wid: str) -> Optional[Tuple[int, int, int, int]]:
    """Return (x, y, width, height) of a window via xdotool."""
    res = run_xdotool(["getwindowgeometry", wid])
    pos_match = re.search(r"Position:\s*(\d+),(\d+)", res.stdout)
    geo_match = re.search(r"Geometry:\s*(\d+)x(\d+)", res.stdout)
    if pos_match and geo_match:
        return (int(pos_match.group(1)), int(pos_match.group(2)), int(geo_match.group(1)), int(geo_match.group(2)))
    return None


def is_2fa_active_on_screen() -> Tuple[bool, Optional[str]]:
    """Check if IB Gateway has an active 2FA / authentication countdown modal on screen."""
    patterns = [
        re.compile(r"Second Factor", re.I),
        re.compile(r"Authenticating", re.I),
        re.compile(r"IB Key", re.I),
    ]
    for wid, name in get_windows():
        for pat in patterns:
            if pat.search(name):
                return True, name
    return False, None


def dismiss_known_dialogs() -> int:
    """Dismiss auxiliary popups (Login Messages, Bulletins, Paper notices, etc.)."""
    dismissed = 0
    patterns = [
        re.compile(r"Login Messages", re.I),
        re.compile(r"Pending Tasks", re.I),
        re.compile(r"Warning", re.I),
        re.compile(r"Notice", re.I),
        re.compile(r"Simultaneous Session", re.I),
        re.compile(r"Unrecognized", re.I),
    ]
    
    for wid, name in get_windows():
        for pat in patterns:
            if pat.search(name):
                print(f"[AUTOLOGIN] Dismissing auxiliary dialog: '{name}' (WID: {wid})")
                geo = get_window_geometry(wid)
                if geo:
                    gx, gy, gw, gh = geo
                    btn_x = gx + gw // 2
                    btn_y = gy + gh - 25
                    run_xdotool(["mousemove", str(btn_x), str(btn_y), "click", "1"])
                    time.sleep(0.2)
                run_xdotool(["windowactivate", "--sync", wid])
                time.sleep(0.2)
                run_xdotool(["key", "--window", wid, "Return"])
                time.sleep(0.2)
                run_xdotool(["key", "--window", wid, "space"])
                time.sleep(0.2)
                dismissed += 1
                break
    return dismissed


def perform_login(mode: str, username: Optional[str] = None, password: Optional[str] = None, timeout: int = 120, attempt_num: int = 1) -> bool:
    """
    Automate the login sequence for IB Gateway.
    - If 2FA window is already up, waits passively without double-clicking.
    - Enters credentials and submits login if form is ready.
    - Listens for IPC triggers or port opening during the wait loop.
    """
    mode = mode.upper()
    target_port = 4001 if mode == "LIVE" else 4002
    print(f"[AUTOLOGIN] Starting automated login sequence for mode: {mode} (Target Port: {target_port}, Attempt {attempt_num})", flush=True)

    if is_port_open(target_port):
        print(f"[AUTOLOGIN] Target port {target_port} is ALREADY OPEN and accepting connections.", flush=True)
        dismiss_known_dialogs()
        write_status(mode, target_port, "CONNECTED", attempt_num, "Port open and listening.")
        return True

    # 1. Check if 2FA prompt is already pending on screen
    is_2fa, win_name = is_2fa_active_on_screen()
    if is_2fa:
        print(f"[AUTOLOGIN] ⚠️ 2FA prompt '{win_name}' is ALREADY ACTIVE on screen. Waiting for phone approval without re-submitting form...", flush=True)
        write_status(mode, target_port, "2FA_PENDING", attempt_num, f"2FA approval challenge pending ({win_name})")
    
    # Load credentials
    env_creds = load_env_credentials()
    if not username:
        username = env_creds.get(f"IBKR_{mode}_USERNAME") or env_creds.get("IBKR_USERNAME")
    if not password:
        password = env_creds.get(f"IBKR_{mode}_PASSWORD") or env_creds.get("IBKR_PASSWORD")

    start_time = time.time()
    login_attempted = is_2fa  # If 2FA is already active, don't re-click

    while time.time() - start_time < timeout:
        if is_port_open(target_port):
            print(f"[AUTOLOGIN] SUCCESS! Target port {target_port} is ACTIVE and accepting broker traffic.", flush=True)
            dismiss_known_dialogs()
            write_status(mode, target_port, "CONNECTED", attempt_num, "Authentication successful.")
            return True

        dismiss_known_dialogs()

        # Find main login window if login has not been attempted yet
        if not login_attempted:
            windows = get_windows()
            login_wid = None
            for wid, name in windows:
                if "IBKR Gateway" in name or "IB Gateway" in name or "Login" in name:
                    login_wid = wid
                    break

            if login_wid:
                print(f"[AUTOLOGIN] Found IB Gateway window (WID: {login_wid}). Activating...", flush=True)
                run_xdotool(["windowactivate", "--sync", login_wid])
                time.sleep(0.5)

                # Select mode tab
                tab_coord = COORD_LIVE_TAB if mode == "LIVE" else COORD_PAPER_TAB
                print(f"[AUTOLOGIN] Selecting {mode} Trading tab at {tab_coord}...", flush=True)
                run_xdotool(["mousemove", str(tab_coord[0]), str(tab_coord[1]), "click", "1"])
                time.sleep(0.5)

                # Enter username
                if username:
                    print(f"[AUTOLOGIN] Entering username in field {COORD_USERNAME_FIELD}...", flush=True)
                    run_xdotool(["mousemove", str(COORD_USERNAME_FIELD[0]), str(COORD_USERNAME_FIELD[1]), "click", "1"])
                    time.sleep(0.3)
                    run_xdotool(["key", "ctrl+a", "BackSpace"])
                    time.sleep(0.1)
                    run_xdotool(["type", "--delay", "50", username])
                    time.sleep(0.3)

                # Enter password
                if password:
                    print("[AUTOLOGIN] Entering password via Tab...", flush=True)
                    run_xdotool(["key", "Tab"])
                    time.sleep(0.3)
                    run_xdotool(["key", "ctrl+a", "BackSpace"])
                    time.sleep(0.1)
                    run_xdotool(["type", "--delay", "50", "--", password])
                    time.sleep(0.5)

                # Click Login
                print(f"[AUTOLOGIN] Submitting login (click {COORD_LOGIN_BUTTON})...", flush=True)
                run_xdotool(["mousemove", str(COORD_LOGIN_BUTTON[0]), str(COORD_LOGIN_BUTTON[1]), "click", "1"])
                time.sleep(0.3)
                run_xdotool(["key", "Return"])
                login_attempted = True

                if mode == "LIVE":
                    print("[AUTOLOGIN] 📲 LIVE LOGIN SUBMITTED: IBKR is dispatching IB Key 2FA push notification to your smartphone.", flush=True)
                    print("[AUTOLOGIN] Please tap 'Approve' on your phone to complete authentication...", flush=True)
                    write_status(mode, target_port, "2FA_PENDING", attempt_num, "2FA push dispatched. Waiting for smartphone approval.")
                else:
                    print("[AUTOLOGIN] Paper Login submitted. Awaiting broker session handshake...", flush=True)
                    write_status(mode, target_port, "AUTHENTICATING", attempt_num, "Paper login submitted.")

        elapsed = int(time.time() - start_time)
        if elapsed % 10 == 0:
            status_desc = "Waiting for IB Key phone approval..." if (mode == "LIVE" and login_attempted) else "Waiting for gateway initialization..."
            print(f"[AUTOLOGIN] [{elapsed}s/{timeout}s] {status_desc} (Port {target_port})", flush=True)

        time.sleep(2)

    print(f"[AUTOLOGIN] Notice: Window timeout after {timeout} seconds waiting for port {target_port} to open.", flush=True)
    write_status(mode, target_port, "TIMEOUT", attempt_num, f"Attempt {attempt_num} timed out after {timeout}s.")
    return False


def run_daemon_loop(mode: str, username: Optional[str], password: Optional[str], timeout: int):
    """
    Persistent daemon watcher loop with:
    1. Adaptive 3-attempt burst with 3-minute gap for Live mode.
    2. Zero spam / quiet Standby state after 3 unapproved tries.
    3. Instant On-Demand wakeup when trigger file (/tmp/gateway_login.trigger) is written.
    """
    mode = mode.upper()
    target_port = 4001 if mode == "LIVE" else 4002
    live_attempts = 0

    print(f"==================================================", flush=True)
    print(f"  ALPHAENGINE GATEWAY WATCHER DAEMON (EVENT-DRIVEN)", flush=True)
    print(f"  Mode: {mode} | Target Port: {target_port}", flush=True)
    print(f"  Max Live Attempts: {MAX_LIVE_ATTEMPTS} | Cooldown: {INTER_ATTEMPT_COOLDOWN_SEC}s", flush=True)
    print(f"  IPC Trigger File: {TRIGGER_FILE}", flush=True)
    print(f"==================================================", flush=True)

    while True:
        try:
            # 1. Check for on-demand trigger (resets attempt counter immediately)
            if check_and_clear_trigger():
                print(f"\n[AUTOLOGIN DAEMON] ⚡ ON-DEMAND TRIGGER RECEIVED! Resetting retry count and waking daemon immediately...", flush=True)
                live_attempts = 0
                write_status(mode, target_port, "TRIGGERED", 0, "On-demand trigger received. Initiating immediate login.")
                perform_login(mode=mode, username=username, password=password, timeout=timeout, attempt_num=1)
                time.sleep(2)
                continue

            # 2. Check if port is already active and healthy
            if is_port_open(target_port):
                if live_attempts > 0:
                    print(f"[AUTOLOGIN DAEMON] Broker socket {target_port} is ACTIVE. Resetting attempt counter to 0.", flush=True)
                    live_attempts = 0
                write_status(mode, target_port, "CONNECTED", 0, "Socket active.")
                dismiss_known_dialogs()
                time.sleep(3)
                continue

            # 3. Port is closed — handle according to mode
            if mode == "PAPER":
                # Paper trading does not send 2FA challenges; safe to reconnect with gentle backoff
                print(f"[AUTOLOGIN DAEMON] Paper socket {target_port} closed. Initiating automated reconnection...", flush=True)
                perform_login(mode=mode, username=username, password=password, timeout=timeout, attempt_num=1)
                time.sleep(5)
                continue

            # 4. LIVE MODE — Adaptive 3-Attempt Burst Logic
            if live_attempts >= MAX_LIVE_ATTEMPTS:
                # Standby state: STOP all automated clicks. Wait for user trigger or port open.
                write_status(mode, target_port, "STANDBY", live_attempts, f"Max attempts ({MAX_LIVE_ATTEMPTS}) reached. Waiting for on-demand trigger.")
                print(f"[AUTOLOGIN DAEMON] 🛑 Max Live attempts ({MAX_LIVE_ATTEMPTS}) reached without 2FA approval. Entering quiet STANDBY.", flush=True)
                print(f"[AUTOLOGIN DAEMON] To request login when ready, tap 'Request 2FA' on the dashboard or run: python3 gateway_autologin.py --trigger-now", flush=True)

                # Sleep in 1-second ticks so trigger or port open is responded to instantly
                for _ in range(60):
                    if check_and_clear_trigger():
                        print(f"[AUTOLOGIN DAEMON] ⚡ Trigger received during STANDBY! Waking up...", flush=True)
                        live_attempts = 0
                        break
                    if is_port_open(target_port):
                        print(f"[AUTOLOGIN DAEMON] Port {target_port} opened during STANDBY!", flush=True)
                        live_attempts = 0
                        break
                    time.sleep(1)
                continue

            # Increment attempt counter and execute polite login
            live_attempts += 1
            print(f"\n[AUTOLOGIN DAEMON] Live socket {target_port} closed. Initiating Attempt {live_attempts}/{MAX_LIVE_ATTEMPTS}...", flush=True)
            success = perform_login(mode=mode, username=username, password=password, timeout=timeout, attempt_num=live_attempts)

            if success:
                live_attempts = 0
                time.sleep(3)
            else:
                if live_attempts < MAX_LIVE_ATTEMPTS:
                    print(f"[AUTOLOGIN DAEMON] Attempt {live_attempts} unapproved. Pausing for {INTER_ATTEMPT_COOLDOWN_SEC}s before attempt {live_attempts + 1} (or until on-demand trigger)...", flush=True)
                    write_status(mode, target_port, "COOLDOWN", live_attempts, f"Waiting {INTER_ATTEMPT_COOLDOWN_SEC}s before attempt {live_attempts + 1}.")
                    
                    # Sleep in 1-second ticks to wake up immediately on trigger
                    for _ in range(INTER_ATTEMPT_COOLDOWN_SEC):
                        if check_and_clear_trigger():
                            print(f"[AUTOLOGIN DAEMON] ⚡ Trigger received during cooldown! Breaking out immediately...", flush=True)
                            live_attempts = 0
                            break
                        if is_port_open(target_port):
                            print(f"[AUTOLOGIN DAEMON] Port {target_port} opened during cooldown!", flush=True)
                            live_attempts = 0
                            break
                        time.sleep(1)

        except Exception as e:
            print(f"[AUTOLOGIN DAEMON] Watcher cycle exception: {e}", flush=True)
            time.sleep(3)


def trigger_now():
    """CLI utility to dispatch an instant on-demand login trigger."""
    try:
        with open(TRIGGER_FILE, "w") as f:
            f.write(str(time.time()))
        try:
            os.chmod(TRIGGER_FILE, 0o666)
        except Exception:
            pass
        print(f"✅ On-demand login trigger written to {TRIGGER_FILE}.")
        print("The daemon will immediately initiate authentication and dispatch 2FA to your smartphone.")
        sys.exit(0)
    except Exception as e:
        print(f"❌ Failed to write trigger file: {e}")
        sys.exit(1)


def show_status():
    """CLI utility to inspect current daemon authentication status."""
    if os.path.exists(STATUS_FILE):
        try:
            with open(STATUS_FILE, "r") as f:
                data = json.load(f)
            print(json.dumps(data, indent=2))
            sys.exit(0)
        except Exception as e:
            print(f"Error reading status: {e}")
            sys.exit(1)
    else:
        print(f"No active status file found at {STATUS_FILE}.")
        sys.exit(0)


def main():
    parser = argparse.ArgumentParser(description="AlphaEngine Event-Driven & IPC IB Gateway Autologin")
    parser.add_argument("--mode", choices=["PAPER", "LIVE", "paper", "live"], default="PAPER", help="Trading mode")
    parser.add_argument("--username", default=os.environ.get("IBKR_USERNAME"), help="Account username")
    parser.add_argument("--password", default=os.environ.get("IBKR_PASSWORD"), help="Account password")
    parser.add_argument("--timeout", type=int, default=120, help="Timeout in seconds")
    parser.add_argument("--daemon", action="store_true", help="Run indefinitely as a state-aware modal & 2FA watcher")
    parser.add_argument("--trigger-now", action="store_true", help="Signal the daemon to initiate an instant login now")
    parser.add_argument("--status", action="store_true", help="Show current daemon authentication status")

    args = parser.parse_args()

    if args.trigger_now:
        trigger_now()

    if args.status:
        show_status()

    if args.daemon:
        run_daemon_loop(mode=args.mode, username=args.username, password=args.password, timeout=args.timeout)
    else:
        success = perform_login(mode=args.mode, username=args.username, password=args.password, timeout=args.timeout, attempt_num=1)
        sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
