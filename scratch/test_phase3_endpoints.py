import pytest
import urllib.request
import urllib.parse
import json

def is_server_running():
    try:
        with urllib.request.urlopen("http://127.0.0.1:3000/api/risk/status", timeout=5.0):
            return True
    except Exception as e:
        print(f"[DEBUG] is_server_running exception: {e}")
        return False

def test_endpoints():
    if not is_server_running():
        pytest.skip("Express server not running on 127.0.0.1:3000")

    print("============================================================")
    print("TESTING PHASE 3 LIVE API ENDPOINTS (http://127.0.0.1:3000)")
    print("============================================================")

    # 1. Test GET /api/risk/status
    req = urllib.request.urlopen("http://127.0.0.1:3000/api/risk/status")
    assert req.status == 200
    data = json.loads(req.read().decode())
    print("\n--- 1. GET /api/risk/status ---")
    print(f"Status: {req.status}")
    print(f"Intraday Flattening Enabled: {data.get('intradayFlatteningEnabled')}")
    print(f"Intraday Flatten Time (EST): {data.get('intradayFlattenTimeEST')}")
    print(f"Intraday Flatten Time (CET): {data.get('intradayFlattenTimeCET')}")
    print(f"Live NY Time (EST): {data.get('nyTimeEST')}")
    print(f"Live Paris Time (CET): {data.get('cetTimeCET')}")
    assert data.get("intradayFlatteningEnabled") is True, "Expected intradayFlatteningEnabled to be True"
    assert data.get("intradayFlattenTimeEST") == "15:45", "Expected 15:45 EST"

    # 2. Test POST /api/risk/settings
    print("\n--- 2. POST /api/risk/settings (Toggle Intraday Flattening) ---")
    admin_headers = {
        "Content-Type": "application/json",
        "Authorization": "Bearer ALPHA_ADMIN_REVERT_992"
    }
    settings_payload = json.dumps({"intradayFlatteningEnabled": False}).encode("utf-8")
    post_req = urllib.request.Request(
        "http://127.0.0.1:3000/api/risk/settings",
        data=settings_payload,
        headers=admin_headers
    )
    res = urllib.request.urlopen(post_req)
    assert res.status == 200
    res_data = json.loads(res.read().decode())
    assert res_data["settings"]["intradayFlatteningEnabled"] is False, "Expected settings to update to False"
    print("[PASS] Successfully updated intradayFlatteningEnabled to False.")

    # Re-enable intraday flattening
    settings_payload_revert = json.dumps({"intradayFlatteningEnabled": True}).encode("utf-8")
    res_revert = urllib.request.urlopen(urllib.request.Request(
        "http://127.0.0.1:3000/api/risk/settings",
        data=settings_payload_revert,
        headers=admin_headers
    ))
    res_revert_data = json.loads(res_revert.read().decode())
    assert res_revert_data["settings"]["intradayFlatteningEnabled"] is True
    print("[PASS] Reverted intradayFlatteningEnabled to True.")

    # 3. Test POST /api/risk/flatten-intraday
    print("\n--- 3. POST /api/risk/flatten-intraday ---")
    flatten_payload = json.dumps({"reason": "15:45 EST EOD Cutoff Rule Test"}).encode("utf-8")
    flatten_req = urllib.request.Request(
        "http://127.0.0.1:3000/api/risk/flatten-intraday",
        data=flatten_payload,
        headers=admin_headers
    )
    res_flatten = urllib.request.urlopen(flatten_req)
    assert res_flatten.status == 200
    flatten_data = json.loads(res_flatten.read().decode())
    print(f"Message: {flatten_data.get('message')}")
    print(f"Liquidated Count: {flatten_data.get('liquidatedCount')}")
    assert flatten_data.get("success") is True

    # 4. Test GET /api/execution/blotter
    print("\n--- 4. GET /api/execution/blotter ---")
    blotter_res = urllib.request.urlopen("http://127.0.0.1:3000/api/execution/blotter")
    assert blotter_res.status == 200
    blotter_data = json.loads(blotter_res.read().decode())
    orders = blotter_data.get("blotter", [])
    print(f"Total blotter orders recorded: {len(orders)}")
    assert isinstance(orders, list), "Expected blotter to be a list"
    if len(orders) > 0:
        first_order = orders[0]
        print(f"Top order: ID={first_order['id']} | Type={first_order['orderType']} | Symbol={first_order['symbol']} | Qty={first_order['qty']}")
        assert "MOC / MKT (INTRADAY FLATTEN)" in first_order["orderType"] or "FLATTEN" in first_order["orderType"]
    else:
        print("[PASS] Zero-Synthetic Policy: Blotter accurately reflects 0 unconfirmed mock orders on cold start.")

    print("\n============================================================")
    print("ALL PHASE 3 API ENDPOINTS VERIFIED AND OPERATIONAL!")
    print("============================================================")

if __name__ == "__main__":
    test_endpoints()
