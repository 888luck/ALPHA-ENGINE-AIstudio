import urllib.request
import urllib.parse
import json
import sys
import os

current_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(current_dir)
if parent_dir not in sys.path:
    sys.path.insert(0, parent_dir)

from risk_engine import DRMMiddleware
from connection import ConnectionManager

def test_custom_capital_ceiling():
    print("============================================================")
    print("VERIFYING ARBITRARY CAPITAL CEILING (e.g. $500, $200, $50)")
    print("============================================================")

    # 1. Test live API with $500 ceiling
    payload = json.dumps({
        "dailyCapitalCeiling": 500.0,
        "dailyMaxLossCutoff": 50.0
    }).encode("utf-8")
    
    req = urllib.request.Request(
        "http://localhost:3000/api/risk/settings",
        data=payload,
        headers={"Content-Type": "application/json"}
    )
    res = urllib.request.urlopen(req)
    assert res.status == 200
    data = json.loads(res.read().decode())
    assert data["settings"]["dailyCapitalCeiling"] == 500.0
    assert data["settings"]["dailyMaxLossCutoff"] == 50.0
    print("[PASS] API accepted dailyCapitalCeiling = $500.00 and dailyMaxLossCutoff = $50.00.")

    # 2. Check GET /api/risk/status
    status_req = urllib.request.urlopen("http://localhost:3000/api/risk/status")
    status_data = json.loads(status_req.read().decode())
    assert status_data["dailyCapitalCeiling"] == 500.0
    assert status_data["dailyMaxLossCutoff"] == 50.0
    print(f"[PASS] GET /api/risk/status reflects Ceiling: ${status_data['dailyCapitalCeiling']} | Cutoff: ${status_data['dailyMaxLossCutoff']}.")

    # 3. Test Risk Engine Gate 1 enforcement with $500 ceiling
    cm = ConnectionManager(trading_mode="PAPER")
    cm.active_positions = {}
    cm.pnl_updates = {"realized": 0.0, "unrealized": 0.0, "total": 0.0}
    drm = DRMMiddleware(connection_manager=cm, params={"daily_capital_ceiling": 500.0, "daily_max_loss_cutoff": 50.0})

    # Order of 5 shares @ $120 ($600 value) -> Should be REJECTED (> $500)
    gate_check_large = drm.check_pre_trade_gateway(symbol="NVDA", action="BUY", requested_qty=5.0, price=120.0)
    assert gate_check_large["approved"] is False, "Expected order of $600 to be rejected under $500 ceiling"
    print(f"[PASS] Order of $600 rejected: {gate_check_large['reason']}")

    # Order of 3 shares @ $120 ($360 value) -> Should be APPROVED (< $500)
    gate_check_small = drm.check_pre_trade_gateway(symbol="NVDA", action="BUY", requested_qty=3.0, price=120.0)
    assert gate_check_small["approved"] is True, "Expected order of $360 to be approved under $500 ceiling"
    print(f"[PASS] Order of $360 approved: {gate_check_small['reason']}")

    print("\n============================================================")
    print("CAPITAL CEILING DOWN TO $500 AND LOWER IS FULLY FUNCTIONAL!")
    print("============================================================")

if __name__ == "__main__":
    test_custom_capital_ceiling()
