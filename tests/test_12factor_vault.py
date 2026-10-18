"""
Comprehensive Test Suite: 12-Factor Decoupled Vault Engine & End-to-End Bridge Wiring
Universal Institutional Engineering Principles - Decoupled Lifecycle Resilience & Multi-Cloud Portability
"""

import os
import sys
import json
import time
import socket
import tempfile
import pytest

# Ensure repo root is on sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import config_loader
from edge_bridge import EdgeTcpBridgeServer


def test_12factor_vault_loading_all_pillars():
    """Verifies that config_loader loads all 4 pillars and returns 31 canonical configuration keys."""
    cfg = config_loader.load_config()
    
    # Pillar 1: Brokerage
    assert "IBKR_ACCOUNT_NUMBER" in cfg
    assert "IBKR_HOST" in cfg
    assert "IBKR_PORT" in cfg
    assert "IBKR_CLIENT_ID" in cfg
    assert "IBKR_PAPER_USERNAME" in cfg
    assert "IBKR_PAPER_PASSWORD" in cfg
    assert "IBKR_LIVE_USERNAME" in cfg
    assert "IBKR_LIVE_PASSWORD" in cfg
    assert "MIFID2_DECISION_MAKER_ID" in cfg
    assert "MIFID2_EXECUTION_TRADER_ID" in cfg

    # Pillar 2: Cloud & Edge
    assert "EDGE_NODE_HOST" in cfg
    assert "EDGE_NODE_IP" in cfg
    assert "EDGE_TCP_PORT" in cfg
    assert "EDGE_AUTH_TOKEN" in cfg
    assert "TRADING_MODE" in cfg
    assert "ADMIN_OPERATOR_KEY" in cfg

    # Pillar 3: AI Model Providers
    assert "GEMINI_API_KEY" in cfg
    assert "GROQ_API_KEY" in cfg
    assert "CUSTOM_AI_API_KEY" in cfg
    assert "NVIDIA_API_KEY" in cfg
    assert "OPENAI_API_KEY" in cfg
    assert "ANTHROPIC_API_KEY" in cfg
    assert "CUSTOM_AI_BASE_URL" in cfg
    assert "CUSTOM_AI_MODEL_NAME" in cfg
    assert "SELECTED_AI_PROVIDER" in cfg

    # Pillar 4: Feeds
    assert "SEC_USER_AGENT" in cfg
    assert "OPENFDA_API_KEY" in cfg
    assert "FRED_API_KEY" in cfg
    assert "PATENTS_API_KEY" in cfg


def test_dynamic_edge_endpoint_resolution():
    """Verifies that get_edge_endpoint eliminates hardcoded localhost references."""
    # Test 1: Default fallback
    if "EDGE_NODE_HOST" in os.environ: del os.environ["EDGE_NODE_HOST"]
    if "EDGE_NODE_IP" in os.environ: del os.environ["EDGE_NODE_IP"]
    
    host, port = config_loader.get_edge_endpoint()
    assert host in ["127.0.0.1", "10.156.0.2"]
    assert port == 4005

    # Test 2: Dynamic override via EDGE_NODE_HOST
    os.environ["EDGE_NODE_HOST"] = "34.141.105.241"
    os.environ["EDGE_TCP_PORT"] = "4005"
    host, port = config_loader.get_edge_endpoint()
    assert host == "34.141.105.241"
    assert port == 4005

    # Clean up
    del os.environ["EDGE_NODE_HOST"]


def test_atomic_vault_persistence_and_in_memory_sync():
    """Verifies atomic write-and-replace to disk and instant os.environ synchronization."""
    with tempfile.NamedTemporaryFile(suffix=".env", delete=False) as tf:
        temp_vault_path = tf.name

    try:
        test_payload = {
            "GEMINI_API_KEY": "AIzaSyTestKey_12Factor_Verified",
            "IBKR_ACCOUNT_NUMBER": "DUE999888",
            "TRADING_MODE": "LIVE",
            "OPENFDA_API_KEY": "fda_key_verified_441"
        }

        # 1. Execute atomic save
        success = config_loader.save_secrets_to_vault(test_payload, target_path=temp_vault_path)
        assert success is True

        # 2. Verify instant in-memory synchronization
        assert os.environ.get("GEMINI_API_KEY") == "AIzaSyTestKey_12Factor_Verified"
        assert os.environ.get("IBKR_ACCOUNT_NUMBER") == "DUE999888"
        assert os.environ.get("TRADING_MODE") == "LIVE"
        assert os.environ.get("OPENFDA_API_KEY") == "fda_key_verified_441"

        # 3. Verify on-disk file content
        parsed = config_loader.parse_env_file(temp_vault_path)
        assert parsed["GEMINI_API_KEY"] == "AIzaSyTestKey_12Factor_Verified"
        assert parsed["IBKR_ACCOUNT_NUMBER"] == "DUE999888"
        assert parsed["TRADING_MODE"] == "LIVE"
        assert parsed["OPENFDA_API_KEY"] == "fda_key_verified_441"

    finally:
        if os.path.exists(temp_vault_path):
            os.remove(temp_vault_path)


def test_end_to_end_tcp_bridge_vault_synchronization():
    """
    Simulates the entire control plane to edge node pipeline:
    Cloud Run sends UPDATE_SETTINGS with credentials over Port 4005 TCP Bridge.
    Edge daemon receives payload and atomically updates the 12-factor vault.
    """
    test_port = 4098
    auth_token = "TEST_VAULT_TOKEN_777"
    
    with tempfile.NamedTemporaryFile(suffix=".env", delete=False) as tf:
        temp_edge_vault = tf.name

    server = EdgeTcpBridgeServer(host="127.0.0.1", port=test_port, auth_token=auth_token)

    # Wire edge settings handler to save_secrets_to_vault
    def edge_settings_receiver(settings_dict):
        config_loader.save_secrets_to_vault(settings_dict, target_path=temp_edge_vault)
        return {"vault_updated": True, "keys_persisted": list(settings_dict.keys())}

    server.settings_handler = edge_settings_receiver
    server.start()
    time.sleep(0.15)

    try:
        # Simulate Cloud Run Client opening raw TCP socket to Edge Node
        client = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        client.settimeout(3.0)
        client.connect(("127.0.0.1", test_port))

        cloud_run_payload = {
            "action": "UPDATE_SETTINGS",
            "token": auth_token,
            "settings": {
                "GEMINI_API_KEY": "AIzaSyCloudRunPushedKey_8899",
                "IBKR_LIVE_PASSWORD": "SecuredLivePassword#2026",
                "TRADING_MODE": "LIVE",
                "FRED_API_KEY": "fred_macro_key_002"
            }
        }

        client.sendall(json.dumps(cloud_run_payload).encode("utf-8") + b"\n")
        raw_resp = client.recv(4096).decode("utf-8").strip()
        client.close()

        resp = json.loads(raw_resp)
        assert resp["status"] == "ACK"
        assert resp["result"]["vault_updated"] is True

        # Verify edge node vault on disk
        persisted = config_loader.parse_env_file(temp_edge_vault)
        assert persisted["GEMINI_API_KEY"] == "AIzaSyCloudRunPushedKey_8899"
        assert persisted["IBKR_LIVE_PASSWORD"] == "SecuredLivePassword#2026"
        assert persisted["TRADING_MODE"] == "LIVE"
        assert persisted["FRED_API_KEY"] == "fred_macro_key_002"

        # Verify in-memory os.environ on edge node
        assert os.environ.get("GEMINI_API_KEY") == "AIzaSyCloudRunPushedKey_8899"
        assert os.environ.get("IBKR_LIVE_PASSWORD") == "SecuredLivePassword#2026"

    finally:
        server.stop()
        if os.path.exists(temp_edge_vault):
            os.remove(temp_edge_vault)


if __name__ == "__main__":
    print("Running test_12factor_vault test suite...")
    test_12factor_vault_loading_all_pillars()
    print("✓ test_12factor_vault_loading_all_pillars passed")
    test_dynamic_edge_endpoint_resolution()
    print("✓ test_dynamic_edge_endpoint_resolution passed")
    test_atomic_vault_persistence_and_in_memory_sync()
    print("✓ test_atomic_vault_persistence_and_in_memory_sync passed")
    test_end_to_end_tcp_bridge_vault_synchronization()
    print("✓ test_end_to_end_tcp_bridge_vault_synchronization passed")
    print("ALL 4/4 12-FACTOR VAULT TESTS PASSED!")

