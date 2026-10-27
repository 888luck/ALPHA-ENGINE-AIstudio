"""
AlphaEngine Direct TCP Socket Bridge (Edge Node Server)
Universal Institutional Engineering Principles - Decoupled Lifecycle Resilience

Replaces deprecated Firestore polling tunnel with a direct, ultra-low-latency (< 5ms)
TCP socket server connecting Google Cloud Run control plane with the Frankfurt GCE edge node.
"""

import json
import socket
import threading
import time
import os
from typing import Callable, Dict, Any, Optional

class EdgeTcpBridgeServer:
    def __init__(self, host: str = "0.0.0.0", port: int = 4005, auth_token: Optional[str] = None):
        self.host = host
        self.port = port if port != 4005 else int(os.getenv("EDGE_TCP_PORT", 4005))
        self.auth_token = auth_token or os.getenv("EDGE_AUTH_TOKEN", "ALPHA_EDGE_SECRET_2026")
        self.running = False
        self.server_socket: Optional[socket.socket] = None
        self.server_thread: Optional[threading.Thread] = None
        
        # Callbacks registered by main.py
        self.order_handler: Optional[Callable[[Dict[str, Any]], Dict[str, Any]]] = None
        self.flush_handler: Optional[Callable[[], Dict[str, Any]]] = None
        self.settings_handler: Optional[Callable[[Dict[str, Any]], Dict[str, Any]]] = None
        self.telemetry_provider: Optional[Callable[[], Dict[str, Any]]] = None
        self.ibkr_dispatcher: Optional[Callable[[str, Dict[str, Any]], Dict[str, Any]]] = None

    def start(self):
        """Starts the TCP command listener in a background daemon thread."""
        self.running = True
        self.server_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.server_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.server_socket.bind((self.host, self.port))
        self.server_socket.listen(5)
        self.server_socket.settimeout(1.0)
        
        self.server_thread = threading.Thread(target=self._listen_loop, daemon=True, name="EdgeTcpBridgeThread")
        self.server_thread.start()
        print(f"[EDGE TCP BRIDGE] Listening for authenticated Cloud Run commands on {self.host}:{self.port}")

    def stop(self):
        """Gracefully terminates socket listener."""
        self.running = False
        if self.server_socket:
            try:
                self.server_socket.close()
            except Exception:
                pass
        if self.server_thread and self.server_thread.is_alive():
            self.server_thread.join(timeout=2.0)
        print("[EDGE TCP BRIDGE] Bridge server stopped.")

    def _listen_loop(self):
        while self.running:
            try:
                client_sock, client_addr = self.server_socket.accept()
                threading.Thread(target=self._handle_client, args=(client_sock, client_addr), daemon=True).start()
            except socket.timeout:
                continue
            except Exception as e:
                if self.running:
                    print(f"[EDGE TCP BRIDGE WARN] Accept error: {e}")
                break

    def _handle_client(self, sock: socket.socket, addr):
        sock.settimeout(10.0)
        buffer = ""
        client_ip = addr[0] if addr else ""
        try:
            while self.running:
                data = sock.recv(4096)
                if not data:
                    break
                buffer += data.decode("utf-8")
                while "\n" in buffer:
                    line, buffer = buffer.split("\n", 1)
                    line = line.strip()
                    if not line:
                        continue
                    
                    response = self._dispatch_command(line, client_ip=client_ip)
                    response_payload = json.dumps(response) + "\n"
                    sock.sendall(response_payload.encode("utf-8"))
        except Exception as e:
            pass
        finally:
            try:
                sock.close()
            except Exception:
                pass

    def _dispatch_command(self, raw_json: str, client_ip: str = "") -> Dict[str, Any]:
        try:
            cmd = json.loads(raw_json)
        except Exception as e:
            return {"status": "ERROR", "message": f"Malformed JSON: {e}"}

        # Token Authentication check (Allow loopback connections from local edge callers)
        token = cmd.get("token")
        is_loopback = client_ip in ["127.0.0.1", "::1", "localhost", ""]
        if self.auth_token and not is_loopback and token != self.auth_token:
            return {"status": "UNAUTHORIZED", "message": "Invalid EDGE_AUTH_TOKEN"}

        action = cmd.get("action")
        timestamp = time.time()

        if action == "PING":
            return {"status": "PONG", "timestamp": timestamp, "received_ts": cmd.get("timestamp")}

        elif action == "SUBMIT_ORDER":
            if self.order_handler:
                try:
                    res = self.order_handler(cmd.get("order", {}))
                    return {"status": "EXECUTED", "result": res, "timestamp": timestamp}
                except Exception as ex:
                    return {"status": "REJECTED", "message": str(ex), "timestamp": timestamp}
            return {"status": "REJECTED", "message": "Order handler not registered", "timestamp": timestamp}

        elif action == "EMERGENCY_FLUSH":
            if self.flush_handler:
                try:
                    res = self.flush_handler()
                    return {"status": "EXECUTED", "result": res, "timestamp": timestamp}
                except Exception as ex:
                    return {"status": "ERROR", "message": str(ex), "timestamp": timestamp}
            return {"status": "ERROR", "message": "Flush handler not registered", "timestamp": timestamp}

        elif action == "UPDATE_SETTINGS":
            if self.settings_handler:
                try:
                    payload = cmd.get("settings") or cmd.get("args") or {}
                    res = self.settings_handler(payload)
                    return {"status": "ACK", "result": res, "timestamp": timestamp}
                except Exception as ex:
                    return {"status": "ERROR", "message": str(ex), "timestamp": timestamp}
            return {"status": "ACK", "message": "Settings received", "timestamp": timestamp}

        elif action == "TRIGGER_GATEWAY_LOGIN":
            try:
                import subprocess
                # Purge legacy trigger file if present
                trigger_path = "/tmp/gateway_login.trigger"
                if os.path.exists(trigger_path):
                    try:
                        os.remove(trigger_path)
                    except Exception:
                        pass

                # Institutional restart of official IBC daemon to trigger fresh login & 2FA push
                proc = subprocess.Popen(
                    ["sudo", "systemctl", "restart", "ibgateway.service"],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE
                )
                print(f"[EDGE TCP BRIDGE] Dispatched 'sudo systemctl restart ibgateway.service' (PID {proc.pid}) for on-demand 2FA login.")
                return {
                    "status": "TRIGGERED",
                    "message": "IB Gateway restarted via official IBC daemon. Please approve the 2FA push on your IBKR Mobile app.",
                    "timestamp": timestamp
                }
            except Exception as ex:
                return {"status": "ERROR", "message": f"Failed to restart ibgateway: {ex}", "timestamp": timestamp}

        elif action == "GET_TELEMETRY":
            telemetry = {}
            if self.telemetry_provider:
                try:
                    telemetry = self.telemetry_provider() or {}
                except Exception as ex:
                    return {"status": "ERROR", "message": str(ex), "timestamp": timestamp}
            # Prioritize live socket probe under institutional IBC standard
            try:
                from config_loader import load_config
                cfg = load_config()
                mode = str(telemetry.get("trading_mode") or cfg.get("TRADING_MODE", "LIVE")).upper()
                target_port = 4001 if mode == "LIVE" else 4002
            except Exception:
                mode = str(telemetry.get("trading_mode", "LIVE")).upper()
                target_port = 4001 if mode == "LIVE" else 4002
            is_open = False
            try:
                with socket.create_connection(("127.0.0.1", target_port), timeout=0.5):
                    is_open = True
            except Exception:
                pass

            if is_open:
                telemetry["gateway_auth"] = {
                    "mode": mode.upper(),
                    "port": target_port,
                    "state": "CONNECTED",
                    "manager": "IBC",
                    "message": f"IB Gateway active on port {target_port} via IBC standard",
                    "timestamp": timestamp,
                }
            else:
                telemetry["gateway_auth"] = {
                    "mode": mode.upper(),
                    "port": target_port,
                    "state": "DISCONNECTED",
                    "manager": "IBC",
                    "message": f"IB Gateway offline on port {target_port} (IBC Standby)",
                    "timestamp": timestamp,
                }
            return {"status": "OK", "telemetry": telemetry, "timestamp": timestamp}

        elif action in ["DISPATCH_IBKR", "GET_QUOTE", "GET_HISTORICAL_BARS", "GET_FUNDAMENTALS"]:
            method = cmd.get("method") or ("reqHistoricalData" if action in ["GET_QUOTE", "GET_HISTORICAL_BARS"] else "reqFundamentalData")
            args = cmd.get("args") or cmd.get("arguments") or {}
            if "symbol" in cmd and "symbol" not in args:
                args["symbol"] = cmd["symbol"]
            if "contract" in cmd and "contract" not in args:
                args["contract"] = cmd["contract"]
            for field in ["secType", "currency", "exchange", "durationStr", "barSizeSetting", "whatToShow", "useRTH"]:
                if field in cmd and field not in args:
                    args[field] = cmd[field]
            if self.ibkr_dispatcher:
                try:
                    res = self.ibkr_dispatcher(method, args)
                    is_success = isinstance(res, dict) and res.get("status") == "SUCCESS"
                    resp: Dict[str, Any] = {
                        "status": "SUCCESS" if is_success else (res.get("status", "OK") if isinstance(res, dict) else "OK"),
                        "result": res,
                        "timestamp": timestamp,
                        "source": "Interactive Brokers Pro Official Tape"
                    }
                    if isinstance(res, dict):
                        if "bars" in res:
                            resp["bars"] = res["bars"]
                        if "total_bars" in res:
                            resp["total_bars"] = res["total_bars"]
                        if "latest_closing_price" in res:
                            resp["latest_closing_price"] = res["latest_closing_price"]
                    return resp
                except Exception as ex:
                    return {"status": "ERROR", "message": str(ex), "timestamp": timestamp}
            return {"status": "ERROR", "message": "IBKR dispatcher not registered on bridge", "timestamp": timestamp}

        else:
            return {"status": "UNKNOWN_ACTION", "action": action, "timestamp": timestamp}
