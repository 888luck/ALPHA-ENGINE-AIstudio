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
                    
                    response = self._dispatch_command(line)
                    response_payload = json.dumps(response) + "\n"
                    sock.sendall(response_payload.encode("utf-8"))
        except Exception as e:
            pass
        finally:
            try:
                sock.close()
            except Exception:
                pass

    def _dispatch_command(self, raw_json: str) -> Dict[str, Any]:
        try:
            cmd = json.loads(raw_json)
        except Exception as e:
            return {"status": "ERROR", "message": f"Malformed JSON: {e}"}

        # Token Authentication check
        token = cmd.get("token")
        if self.auth_token and token != self.auth_token:
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
                    res = self.settings_handler(cmd.get("settings", {}))
                    return {"status": "ACK", "result": res, "timestamp": timestamp}
                except Exception as ex:
                    return {"status": "ERROR", "message": str(ex), "timestamp": timestamp}
            return {"status": "ACK", "message": "Settings received", "timestamp": timestamp}

        elif action == "GET_TELEMETRY":
            if self.telemetry_provider:
                try:
                    telemetry = self.telemetry_provider()
                    return {"status": "OK", "telemetry": telemetry, "timestamp": timestamp}
                except Exception as ex:
                    return {"status": "ERROR", "message": str(ex), "timestamp": timestamp}
            return {"status": "OK", "telemetry": {}, "timestamp": timestamp}

        elif action in ["DISPATCH_IBKR", "GET_QUOTE", "GET_HISTORICAL_BARS", "GET_FUNDAMENTALS"]:
            method = cmd.get("method") or ("reqHistoricalData" if action in ["GET_QUOTE", "GET_HISTORICAL_BARS"] else "reqFundamentalData")
            args = cmd.get("args", {})
            if "symbol" in cmd and "symbol" not in args:
                args["symbol"] = cmd["symbol"]
            for field in ["secType", "currency", "exchange"]:
                if field in cmd and field not in args:
                    args[field] = cmd[field]
            if self.ibkr_dispatcher:
                try:
                    res = self.ibkr_dispatcher(method, args)
                    return {"status": "OK", "result": res, "timestamp": timestamp, "source": "Interactive Brokers Pro Official Tape"}
                except Exception as ex:
                    return {"status": "ERROR", "message": str(ex), "timestamp": timestamp}
            return {"status": "ERROR", "message": "IBKR dispatcher not registered on bridge", "timestamp": timestamp}

        else:
            return {"status": "UNKNOWN_ACTION", "action": action, "timestamp": timestamp}
