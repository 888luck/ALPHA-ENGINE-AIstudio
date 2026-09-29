import urllib.request
import json

def run_tests():
    print("[TEST SUITE] Verifying Institutional Phase 2 Endpoints...")
    
    # 1. Test PEAD candidates endpoint
    req = urllib.request.urlopen("http://localhost:3000/api/events/pead-candidates")
    data = json.loads(req.read().decode("utf-8"))
    assert data["success"] is True, "PEAD endpoint did not return success=True"
    candidates = data["candidates"]
    assert len(candidates) >= 3, "Expected at least 3 PEAD candidates"
    print(f"[TEST 1 PASS] PEAD candidates returned: {len(candidates)}")
    for c in candidates:
        print(f"  - {c['symbol']}: Qualified={c['qualified']}, Vol={c['openingVolumeMultiple']}x, OFI={c['ofiSigma']}σ, Conviction={c['convictionScore']}/100")

    # 2. Test Universe Promotion endpoint
    payload = json.dumps({
        "symbol": "NVDA",
        "sector": "PEAD Post-Earnings Drift (Proven Anomaly)",
        "direction": "BUY",
        "catalystReason": "EPS +14.2%, 2.6x ADV Vol, OFI +2.8σ"
    }).encode("utf-8")
    
    post_req = urllib.request.Request(
        "http://localhost:3000/api/universe/promote",
        data=payload,
        headers={"Content-Type": "application/json"}
    )
    post_res = urllib.request.urlopen(post_req)
    post_data = json.loads(post_res.read().decode("utf-8"))
    assert post_data["success"] is True, "Promotion endpoint did not return success=True"
    print(f"[TEST 2 PASS] Universe Promotion Successful: {post_data['message']}")

    # 3. Test state endpoint confirms NVDA is in dynamic baskets
    state_req = urllib.request.urlopen("http://localhost:3000/api/state")
    state_data = json.loads(state_req.read().decode("utf-8"))
    baskets = state_data.get("dynamicBaskets", [])
    nvda_found = any("NVDA" in b.get("tickers", []) for b in baskets)
    assert nvda_found, "NVDA was not found in dynamic baskets after promotion"
    print("[TEST 3 PASS] Verified NVDA in live server dynamic baskets state!")
    
    print("\nALL PHASE 2 ENDPOINTS AND WORKFLOW TESTS PASSED!")

if __name__ == "__main__":
    run_tests()
