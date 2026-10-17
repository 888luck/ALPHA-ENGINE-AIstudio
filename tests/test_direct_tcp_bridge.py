"""
Test Suite: Direct TCP Socket Bridge (Zero Firestore Compliance)
Universal Institutional Engineering Principles - Decoupled Lifecycle Resilience
"""

import time
import pytest
from edge_bridge import EdgeTcpBridgeServer
import socket
import json

def test_direct_tcp_bridge_lifecycle_and_commands():
    # 1. Start EdgeTcpBridgeServer on test port
    test_port = 4099
    server = EdgeTcpBridgeServer(host="127.0.0.1", port=test_port, auth_token="TEST_TOKEN_123")
    
    order_received = {}
    flush_called = False
    settings_received = {}

    def mock_order(o):
        nonlocal order_received
        order_received = o
        return {"executed": True, "symbol": o["symbol"]}

    def mock_flush():
        nonlocal flush_called
        flush_called = True
        return {"flushed": True}

    def mock_settings(s):
        nonlocal settings_received
        settings_received = s
        return {"updated": True}

    server.order_handler = mock_order
    server.flush_handler = mock_flush
    server.settings_handler = mock_settings
    server.telemetry_provider = lambda: {"status": "LIVE", "positions": 2}
    
    server.start()
    time.sleep(0.1)

    try:
        # 2. Test Direct TCP Socket Communication using native client socket
        client = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        client.settimeout(2.0)
        client.connect(("127.0.0.1", test_port))

        # Test A: PING
        t0 = time.time()
        client.sendall(json.dumps({"action": "PING", "token": "TEST_TOKEN_123", "timestamp": t0}).encode() + b"\n")
        resp_line = client.recv(4096).decode().strip()
        resp = json.loads(resp_line)
        latency_ms = (time.time() - t0) * 1000.0

        assert resp["status"] == "PONG"
        assert latency_ms < 50.0 # Strict sub-50ms local loopback latency
        print(f"\n[PASS] Direct TCP Ping latency: {latency_ms:.2f}ms")

        # Test B: UPDATE_SETTINGS
        client.sendall(json.dumps({
            "action": "UPDATE_SETTINGS",
            "token": "TEST_TOKEN_123",
            "settings": {"routerLocked": False, "dailyCapitalCeiling": 5000.0}
        }).encode() + b"\n")
        resp = json.loads(client.recv(4096).decode().strip())
        assert resp["status"] == "ACK"
        assert settings_received["dailyCapitalCeiling"] == 5000.0

        # Test C: SUBMIT_ORDER
        client.sendall(json.dumps({
            "action": "SUBMIT_ORDER",
            "token": "TEST_TOKEN_123",
            "order": {"symbol": "NVDA", "direction": "BUY", "entryPrice": 120.0, "stopPrice": 115.0, "quantity": 10}
        }).encode() + b"\n")
        resp = json.loads(client.recv(4096).decode().strip())
        assert resp["status"] == "EXECUTED"
        assert order_received["symbol"] == "NVDA"

        # Test D: EMERGENCY_FLUSH
        client.sendall(json.dumps({
            "action": "EMERGENCY_FLUSH",
            "token": "TEST_TOKEN_123"
        }).encode() + b"\n")
        resp = json.loads(client.recv(4096).decode().strip())
        assert resp["status"] == "EXECUTED"
        assert flush_called is True

        # Test E: Unauthorized rejection
        client.sendall(json.dumps({
            "action": "PING",
            "token": "WRONG_TOKEN"
        }).encode() + b"\n")
        resp = json.loads(client.recv(4096).decode().strip())
        assert resp["status"] == "UNAUTHORIZED"

        client.close()

    finally:
        server.stop()
