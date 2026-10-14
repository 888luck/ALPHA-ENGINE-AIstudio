#!/usr/bin/env python3
"""
Native In-House Headless IB Gateway Automation (Option C)
Automates IB Gateway graphical dialogs on DISPLAY=:1 using standard Linux xdotool.
100% transparent and auditable. Zero third-party JARs.
"""

import argparse
import os
import re
import socket
import subprocess
import sys
import time
from typing import List, Optional

DISPLAY = os.environ.get("DISPLAY", ":1")
ENV_PATH = "/opt/alpha-engine/.env"

# Screen coordinates on 1280x800 virtual display for IB Gateway 10.50
COORD_LIVE_TAB = (440, 398)
COORD_PAPER_TAB = (590, 398)
COORD_USERNAME_FIELD = (660, 378)
COORD_PASSWORD_FIELD = (660, 422)
COORD_LOGIN_BUTTON = (660, 485)



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


def paste_clipboard(text: str) -> None:
    """Inject text safely via X11 clipboard without shell or layout interpretation."""
    env = os.environ.copy()
    env["DISPLAY"] = DISPLAY
    try:
        p = subprocess.Popen(["xclip", "-selection", "clipboard"], stdin=subprocess.PIPE, env=env, stderr=subprocess.PIPE)
        p.communicate(input=text.encode("utf-8"))
        time.sleep(0.1)
        p = subprocess.Popen(["xclip", "-selection", "primary"], stdin=subprocess.PIPE, env=env, stderr=subprocess.PIPE)
        p.communicate(input=text.encode("utf-8"))
        time.sleep(0.1)
        run_xdotool(["key", "ctrl+v"])
    except Exception as e:
        print(f"[AUTOLOGIN] Warning: xclip injection fallback ({e})...")
        subprocess.run(["xdotool", "type", "--delay", "50", "--", text], env=env)



def is_port_open(port: int, host: str = "127.0.0.1", timeout: float = 1.0) -> bool:
    """Check if the target IB Gateway TCP socket is listening and accepting connections."""
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except (socket.timeout, ConnectionRefusedError, OSError):
        return False


def get_windows() -> List[tuple[str, str]]:
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


def get_window_geometry(wid: str) -> Optional[tuple[int, int, int, int]]:
    """Return (x, y, width, height) of a window via xdotool."""
    res = run_xdotool(["getwindowgeometry", wid])
    pos_match = re.search(r"Position:\s*(\d+),(\d+)", res.stdout)
    geo_match = re.search(r"Geometry:\s*(\d+)x(\d+)", res.stdout)
    if pos_match and geo_match:
        return (int(pos_match.group(1)), int(pos_match.group(2)), int(geo_match.group(1)), int(geo_match.group(2)))
    return None


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
                    # Click modal confirmation button at bottom center
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


def perform_login(mode: str, username: Optional[str] = None, password: Optional[str] = None, timeout: int = 120) -> bool:
    """
    Automate the login sequence for IB Gateway.
    - Selects Live or Paper tab.
    - Injects credentials into form fields.
    - Triggers login submission.
    - Awaits 2FA phone approval (for Live) and socket opening.
    """
    mode = mode.upper()
    target_port = 4001 if mode == "LIVE" else 4002
    print(f"[AUTOLOGIN] Starting automated login sequence for mode: {mode} (Target Port: {target_port})")

    # Step 1: Check if target port is already open
    if is_port_open(target_port):
        print(f"[AUTOLOGIN] Target port {target_port} is ALREADY OPEN and accepting connections.")
        dismiss_known_dialogs()
        return True

    # Load credentials from .env if not passed explicitly
    env_creds = load_env_credentials()
    if not username:
        username = env_creds.get(f"IBKR_{mode}_USERNAME") or env_creds.get("IBKR_USERNAME")
    if not password:
        password = env_creds.get(f"IBKR_{mode}_PASSWORD") or env_creds.get("IBKR_PASSWORD")

    start_time = time.time()
    login_attempted = False

    while time.time() - start_time < timeout:
        # Check port continuously
        if is_port_open(target_port):
            print(f"[AUTOLOGIN] SUCCESS! Target port {target_port} is ACTIVE and accepting broker traffic.")
            dismiss_known_dialogs()
            return True

        # Dismiss any popup dialogs that might be blocking the port
        dismiss_known_dialogs()

        # Find main login window
        windows = get_windows()
        login_wid = None
        for wid, name in windows:
            if "IBKR Gateway" in name or "IB Gateway" in name or "Login" in name:
                login_wid = wid
                break

        if login_wid and not login_attempted:
            print(f"[AUTOLOGIN] Found IB Gateway window (WID: {login_wid}). Activating...")
            run_xdotool(["windowactivate", "--sync", login_wid])
            time.sleep(0.5)

            # 1. Switch Mode Tab (Live vs Paper)
            tab_coord = COORD_LIVE_TAB if mode == "LIVE" else COORD_PAPER_TAB
            print(f"[AUTOLOGIN] Selecting {mode} Trading tab at {tab_coord}...")
            run_xdotool(["mousemove", str(tab_coord[0]), str(tab_coord[1]), "click", "1"])
            time.sleep(0.5)

            # 2. Enter Username (if provided)
            if username:
                print(f"[AUTOLOGIN] Focusing username field at {COORD_USERNAME_FIELD}...", flush=True)
                run_xdotool(["mousemove", str(COORD_USERNAME_FIELD[0]), str(COORD_USERNAME_FIELD[1]), "click", "1"])
                time.sleep(0.3)
                run_xdotool(["key", "ctrl+a", "BackSpace"])
                time.sleep(0.1)
                run_xdotool(["type", "--delay", "50", username])
                time.sleep(0.3)

            # 3. Enter Password (if provided)
            if password:
                print("[AUTOLOGIN] Navigating to password field via Tab...", flush=True)
                run_xdotool(["key", "Tab"])
                time.sleep(0.3)
                run_xdotool(["key", "ctrl+a", "BackSpace"])
                time.sleep(0.1)
                run_xdotool(["type", "--delay", "50", "--", password])
                time.sleep(0.5)

            # 4. Click Log In button
            print(f"[AUTOLOGIN] Clicking Log In button at {COORD_LOGIN_BUTTON}...", flush=True)
            run_xdotool(["mousemove", str(COORD_LOGIN_BUTTON[0]), str(COORD_LOGIN_BUTTON[1]), "click", "1"])
            time.sleep(0.3)
            run_xdotool(["key", "Return"])
            login_attempted = True

            if mode == "LIVE":
                print("[AUTOLOGIN] 📲 LIVE LOGIN SUBMITTED: IBKR is dispatching IB Key 2FA push notification to your smartphone.")
                print("[AUTOLOGIN] Please tap 'Approve' on your phone to complete authentication...")
            else:
                print("[AUTOLOGIN] Paper Login submitted. Awaiting broker session handshake...")

        elapsed = int(time.time() - start_time)
        if elapsed % 10 == 0:
            status = "Waiting for IB Key phone approval..." if (mode == "LIVE" and login_attempted) else "Waiting for gateway initialization..."
            print(f"[AUTOLOGIN] [{elapsed}s/{timeout}s] {status} (Port {target_port})")

        time.sleep(2)

    print(f"[AUTOLOGIN] ERROR: Timed out after {timeout} seconds waiting for port {target_port} to open.")
    return False


def main():
    parser = argparse.ArgumentParser(description="Native Headless IB Gateway Autologin (Option C)")
    parser.add_argument("--mode", choices=["PAPER", "LIVE", "paper", "live"], default="PAPER", help="Trading mode")
    parser.add_argument("--username", default=os.environ.get("IBKR_USERNAME"), help="Account username")
    parser.add_argument("--password", default=os.environ.get("IBKR_PASSWORD"), help="Account password")
    parser.add_argument("--timeout", type=int, default=120, help="Timeout in seconds")
    parser.add_argument("--daemon", action="store_true", help="Run indefinitely as a background dialog-clearing daemon")

    args = parser.parse_args()
    success = perform_login(mode=args.mode, username=args.username, password=args.password, timeout=args.timeout)
    
    if args.daemon:
        print(f"[AUTOLOGIN DAEMON] Entering persistent modal watcher loop (polling every 3s)...", flush=True)
        target_port = 4001 if args.mode.upper() == "LIVE" else 4002
        while True:
            try:
                # If port went down, attempt relogin
                if not is_port_open(target_port):
                    print(f"[AUTOLOGIN DAEMON] Socket {target_port} closed! Initiating self-healing re-login...", flush=True)
                    perform_login(mode=args.mode, username=args.username, password=args.password, timeout=args.timeout)
                else:
                    dismiss_known_dialogs()
            except Exception as e:
                print(f"[AUTOLOGIN DAEMON] Watcher cycle exception: {e}", flush=True)
            time.sleep(3)
            
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
