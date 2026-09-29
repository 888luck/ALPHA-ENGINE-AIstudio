import urllib.request
import json
import sys
import os

current_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(current_dir)
if parent_dir not in sys.path:
    sys.path.insert(0, parent_dir)

from risk_engine import DRMMiddleware
from connection import ConnectionManager

def test_market_isolation():
    print("============================================================")
    print("TESTING MARKET ISOLATION & DESK FILTERING (US vs EUROPE)")
    print("============================================================")

    # 1. Test API endpoint GET /api/risk/status
    res = urllib.request.urlopen("http://localhost:3000/api/risk/status")
    status = json.loads(res.read().decode())
    assert "marketScope" in status, "marketScope missing from /api/risk/status"
    assert "usMarketOpen" in status, "usMarketOpen missing from /api/risk/status"
    assert "euMarketOpen" in status, "euMarketOpen missing from /api/risk/status"
    print(f"[PASS] API Status: Market Scope={status['marketScope']} | US Open={status['usMarketOpen']} (EST {status['nyTimeEST']}) | EU Open={status['euMarketOpen']} (CET {status['cetTimeCET']})")

    # 2. Test API endpoint POST /api/risk/settings with US Only isolation
    req = urllib.request.Request(
        "http://localhost:3000/api/risk/settings",
        data=json.dumps({"marketScope": "US"}).encode("utf-8"),
        headers={"Content-Type": "application/json"}
    )
    res_update = urllib.request.urlopen(req)
    updated = json.loads(res_update.read().decode())
    assert updated["settings"]["marketScope"] == "US"
    print("[PASS] API accepted marketScope = 'US'")

    # 3. Test DRMMiddleware Gate 0: Market Isolation Policy
    cm = ConnectionManager(trading_mode="PAPER")
    cm.active_positions = {}
    cm.pnl_updates = {"realized": 0.0, "unrealized": 0.0, "total": 0.0}

    # Policy: US ONLY
    drm_us = DRMMiddleware(connection_manager=cm, params={"market_scope": "US", "daily_capital_ceiling": 10000.0})
    
    # European asset (SAP) under US ONLY -> MUST BE REJECTED
    chk_sap = drm_us.check_pre_trade_gateway(symbol="SAP", action="BUY", requested_qty=10.0, price=180.0)
    assert chk_sap["approved"] is False
    assert "Market Isolation Policy" in chk_sap["reason"]
    print(f"[PASS] US Only Mode correctly BLOCKED European asset (SAP): {chk_sap['reason']}")

    # US asset (NVDA) under US ONLY -> MUST BE APPROVED
    chk_nvda = drm_us.check_pre_trade_gateway(symbol="NVDA", action="BUY", requested_qty=10.0, price=120.0)
    assert chk_nvda["approved"] is True
    print(f"[PASS] US Only Mode correctly APPROVED US asset (NVDA): {chk_nvda['reason']}")

    # Policy: EUROPE ONLY
    drm_eu = DRMMiddleware(connection_manager=cm, params={"market_scope": "EUROPE", "daily_capital_ceiling": 10000.0})

    # US asset (NVDA) under EUROPE ONLY -> MUST BE REJECTED
    chk_nvda_eu = drm_eu.check_pre_trade_gateway(symbol="NVDA", action="BUY", requested_qty=10.0, price=120.0)
    assert chk_nvda_eu["approved"] is False
    assert "Market Isolation Policy" in chk_nvda_eu["reason"]
    print(f"[PASS] Europe Only Mode correctly BLOCKED US asset (NVDA): {chk_nvda_eu['reason']}")

    # European asset (SAP) under EUROPE ONLY -> MUST BE APPROVED
    chk_sap_eu = drm_eu.check_pre_trade_gateway(symbol="SAP", action="BUY", requested_qty=10.0, price=180.0)
    assert chk_sap_eu["approved"] is True
    print(f"[PASS] Europe Only Mode correctly APPROVED European asset (SAP): {chk_sap_eu['reason']}")

    # Revert API back to ALL
    req_all = urllib.request.Request(
        "http://localhost:3000/api/risk/settings",
        data=json.dumps({"marketScope": "ALL"}).encode("utf-8"),
        headers={"Content-Type": "application/json"}
    )
    urllib.request.urlopen(req_all)
    print("[PASS] Reverted API marketScope back to 'ALL'.")

    print("\n============================================================")
    print("MARKET ISOLATION ARCHITECTURE IS 100% OPERATIONAL!")
    print("============================================================")

if __name__ == "__main__":
    test_market_isolation()
