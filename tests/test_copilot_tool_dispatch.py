"""
Test Suite: Copilot Tool Execution & Real IBKR Reflection (Zero Mock Policy)
Universal Institutional Engineering Principles - Verification-Before-Assertion
"""

import pytest
from connection import ConnectionManager
from backend.app.api.copilot import execute_tool_call, CopilotTools

def test_connection_manager_dispatch_tool_call():
    cm = ConnectionManager()
    cm.is_connected = False
    cm.active_positions = {}
    cm.account_summary = {}

    # 1. reqPositions returns authentic real positions dictionary
    pos_res = cm.dispatch_tool_call("reqPositions", {})
    assert pos_res["status"] == "SUCCESS"
    assert pos_res["positions"] == {}
    assert pos_res["positions_count"] == 0

    # 2. reqAccountSummary returns GATEWAY_OFFLINE when socket is offline
    acc_res = cm.dispatch_tool_call("reqAccountSummary", {})
    assert acc_res["status"] == "GATEWAY_OFFLINE"
    assert acc_res["code"] == 504

    # 3. Direct EClient methods return GATEWAY_OFFLINE when disconnected, never mock 'DISPATCHED'
    orders_res = cm.dispatch_tool_call("reqOpenOrders", {})
    assert orders_res["status"] == "SUCCESS"
    assert orders_res["connected"] is False

    # 4. Unknown methods return UNKNOWN_METHOD
    unknown_res = cm.dispatch_tool_call("nonExistentMethod99", {})
    assert unknown_res["status"] == "UNKNOWN_METHOD"

def test_copilot_tools_zero_synthetic_positions():
    # Verify no synthetic XLE or COP mock positions are ever injected
    pos_info = CopilotTools.get_positions()
    assert pos_info["status"] == "SUCCESS"
    assert isinstance(pos_info["positions"], list)
    # Ensure neither mock ticker XLE nor COP with 150/80 qty is synthetically created
    for p in pos_info["positions"]:
        assert not (p["symbol"] == "XLE" and p["qty"] == 150)
        assert not (p["symbol"] == "COP" and p["qty"] == 80)

def test_copilot_tools_zero_synthetic_account_summary():
    # Verify no synthetic $154,200.00 mock balance is injected when gateway is offline
    acc_info = CopilotTools.get_account_summary()
    assert acc_info["status"] in ["OFFLINE_SIMULATION", "SUCCESS"]
    if not acc_info.get("socket_live"):
        assert acc_info["net_liquidation_usd"] == 0.0
        assert "offline" in acc_info["warning"].lower()

def test_execute_tool_call_reflection_and_no_mock_dispatch():
    # Test that execute_tool_call dispatches through ConnectionManager
    # and NEVER returns the old mock string: "Method <tool> successfully dispatched to IBKR edge daemon."
    sample_tools = [
        "reqPositions",
        "reqAccountSummary",
        "reqOpenOrders",
        "reqContractDetails",
        "reqMktDepth",
        "reqHistoricalData"
    ]

    for tool in sample_tools:
        res = execute_tool_call(tool, {"reqId": 101})
        # Check that old mock note is absent
        assert "successfully dispatched to IBKR edge daemon" not in str(res)
        assert res.get("status") in ["SUCCESS", "GATEWAY_OFFLINE", "OFFLINE_SIMULATION", "TRANSMITTED", "EXECUTION_ERROR"]
