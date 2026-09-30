"""
Verification Test Suite for the 5 Dynamic Core Pillars of AlphaEngine
Tests:
- Pillar 1: Dynamic Model Catalog & Multi-Model Auto-Discovery
- Pillar 2: Dynamic Exchange Calendars (XNYS, XPAR, XETR) & Dual DST Alignment
- Pillar 3: Dynamic Regulatory Feed Schema & CIK Directory Auto-Discovery
- Pillar 4: Native IBKR Contract Details Resolution & Persistent Caching
- Pillar 5: Dynamic Volatility Risk Scaling (ATR-14 Brackets & Position Sizing)
"""

import sys
import os
import json
from datetime import datetime, date, timezone

# Ensure project root is in sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from market_hours_resolver import MarketHoursResolver, MarketSessionPhase, HAS_EXCHANGE_CALENDARS
from news_ingestor import NewsIngestor
from universe_builder import UniverseBuilder
from risk_engine import DRMMiddleware
from connection import ConnectionManager
from llm_ensemble import MultiModelEnsemble

def test_pillar_1_model_discovery():
    print("\n--- [TEST PILLAR 1: DYNAMIC MODEL CATALOG DISCOVERY] ---")
    ensemble = MultiModelEnsemble()
    endpoints = ensemble.registry.get("endpoints", {})
    
    # Assert no deprecated Gemini 1.5 strings anywhere
    gemini_models = [
        endpoints.get("verifier_2", {}).get("active_model", ""),
        endpoints.get("judge", {}).get("active_model", "")
    ]
    for gm in gemini_models:
        assert "1.5" not in gm, f"Deprecated model string found in registry: {gm}"
        assert "1.0" not in gm, f"Deprecated model string found in registry: {gm}"
        
    print(f"  ✓ Active Generator Model : {endpoints.get('generator', {}).get('active_model')}")
    print(f"  ✓ Active Verifier 1 (Groq): {endpoints.get('verifier_1', {}).get('active_model')}")
    print(f"  ✓ Active Verifier 2 (Flash): {endpoints.get('verifier_2', {}).get('active_model')}")
    print(f"  ✓ Active Judge (Pro)     : {endpoints.get('judge', {}).get('active_model')}")
    print("  ✓ Pillar 1 Passed: Deprecated models excluded, dynamic discovery verified.")

def test_pillar_2_exchange_calendars():
    print("\n--- [TEST PILLAR 2: DYNAMIC EXCHANGE CALENDARS & DST] ---")
    resolver = MarketHoursResolver()
    
    print(f"  • HAS_EXCHANGE_CALENDARS: {HAS_EXCHANGE_CALENDARS}")
    
    # Test DST Desync Detection for known 2026 dates:
    # 2026 US DST starts March 8, 2026; Europe DST starts March 29, 2026.
    # Therefore, on March 15, 2026, DST is desynced (5 hours diff)!
    desync_test_date = date(2026, 3, 15)
    desync_res = resolver.resolve_dst_desync(desync_test_date)
    print(f"  • March 15, 2026 DST Check: Hour Diff={desync_res['hour_difference']}h | Desynced={desync_res['is_dst_desynced']} ({desync_res['note']})")
    assert desync_res["is_dst_desynced"] is True, "Expected DST desync to be True during March 2026 gap!"
    assert desync_res["hour_difference"] == 5.0, f"Expected 5.0h difference, got {desync_res['hour_difference']}"

    # Normal summer alignment date (July 15, 2026) -> 6 hours diff
    normal_date = date(2026, 7, 15)
    normal_res = resolver.resolve_dst_desync(normal_date)
    print(f"  • July 15, 2026 DST Check: Hour Diff={normal_res['hour_difference']}h | Desynced={normal_res['is_dst_desynced']} ({normal_res['note']})")
    assert normal_res["is_dst_desynced"] is False, "Expected normal alignment in July!"
    assert normal_res["hour_difference"] == 6.0, f"Expected 6.0h difference, got {normal_res['hour_difference']}"

    # Session test
    us_session = resolver.resolve_session(is_european=False, target_date=normal_date)
    eu_session = resolver.resolve_session(is_european=True, target_date=normal_date)
    print(f"  ✓ US Session Open (UTC): {us_session['session_open_utc'].strftime('%H:%M')} | Source: {us_session['source']}")
    print(f"  ✓ EU Session Open (UTC): {eu_session['session_open_utc'].strftime('%H:%M')} | Source: {eu_session['source']}")
    print("  ✓ Pillar 2 Passed: Dual DST desync and exchange session hours resolved dynamically.")

def test_pillar_3_feed_adaptation():
    print("\n--- [TEST PILLAR 3: DYNAMIC FEED & CIK DISCOVERY] ---")
    ingestor = NewsIngestor()
    
    # Test dynamic CIK resolution
    nvda_cik = ingestor.resolve_cik("NVDA")
    vlo_cik = ingestor.resolve_cik("VLO")
    amd_cik = ingestor.resolve_cik("AMD")
    
    assert nvda_cik == "0001045810", f"Unexpected CIK for NVDA: {nvda_cik}"
    assert vlo_cik == "0001035002", f"Unexpected CIK for VLO: {vlo_cik}"
    assert amd_cik == "0000002488", f"Unexpected CIK for AMD: {amd_cik}"
    print(f"  ✓ Dynamic SEC CIK Resolution: NVDA={nvda_cik}, VLO={vlo_cik}, AMD={amd_cik}")
    
    # Test adaptive nested extraction
    test_json = {
        "protocolSection": {
            "statusModule": {
                "overallStatus": "COMPLETED"
            }
        }
    }
    extracted = ingestor._adaptive_get_nested(test_json, ["protocolSection", "statusModule", "overallStatus"])
    assert extracted == "COMPLETED", f"Expected COMPLETED, got {extracted}"
    print(f"  ✓ Adaptive Schema Navigation: Extracted '{extracted}' across nested OpenAPI tree.")
    print("  ✓ Pillar 3 Passed: Dynamic CIK auto-discovery and adaptive JSON parsing verified.")

def test_pillar_4_contract_resolution():
    print("\n--- [TEST PILLAR 4: DYNAMIC CONTRACT DETAILS & CACHE] ---")
    cm = ConnectionManager()
    ub = UniverseBuilder(connection_manager=cm)
    
    spec_us = ub.resolve_contract("NVDA")
    spec_eu = ub.resolve_contract("ASML")
    
    assert spec_us is not None
    assert spec_us.currency == "USD"
    assert spec_us.primaryExchange in ["NASDAQ", "SMART"]
    
    assert spec_eu is not None
    assert spec_eu.currency == "EUR"
    assert spec_eu.isEuropean is True
    
    print(f"  ✓ Resolved US Contract: {spec_us.symbol} | Currency={spec_us.currency} | MinTick={spec_us.minTick}")
    print(f"  ✓ Resolved EU Contract: {spec_eu.symbol} | Currency={spec_eu.currency} | PrimaryExchange={spec_eu.primaryExchange}")
    print("  ✓ Pillar 4 Passed: Native contract resolution and specification mapping verified.")

def test_pillar_5_volatility_risk_scaling():
    print("\n--- [TEST PILLAR 5: DYNAMIC ATR(14) RISK SCALING] ---")
    cm = ConnectionManager()
    drm = DRMMiddleware(cm, "DU1234567")
    
    # Create sample 15 daily bars with varying volatility
    sample_bars = []
    base_price = 100.0
    for i in range(15):
        sample_bars.append({
            "high": base_price + 2.5,
            "low": base_price - 1.5,
            "close": base_price + 1.0,
            "open": base_price
        })
        base_price += 0.5
        
    atr = drm.calculate_atr14(sample_bars, current_price=107.5)
    print(f"  • Calculated Live ATR(14): ${atr:.2f}")
    assert atr > 0.0, "ATR must be positive"
    
    # Calculate dynamic brackets for BUY order
    entry_price = 107.50
    brackets = drm.calculate_dynamic_brackets(entry_price, "BUY", atr, k_stop=1.5, min_tick=0.01)
    
    assert brackets["stop_price"] < entry_price, "Stop price for BUY must be below entry"
    assert brackets["take_profit"] > entry_price, "Take profit for BUY must be above entry"
    assert brackets["breakeven_trigger"] > entry_price, "Breakeven trigger must be above entry"
    
    print(f"  ✓ Entry Price      : ${brackets['entry_price']:.2f}")
    print(f"  ✓ Dynamic Stop-Loss : ${brackets['stop_price']:.2f} (Dist: ${brackets['stop_distance']:.2f})")
    print(f"  ✓ Breakeven Trigger: ${brackets['breakeven_trigger']:.2f} (+1.0x ATR)")
    print(f"  ✓ Scale-Out Target : ${brackets['scale_out_trigger']:.2f} (+2.0x ATR)")
    print(f"  ✓ Take-Profit Target: ${brackets['take_profit']:.2f} (+3.0x ATR)")
    
    # Position sizing invariant to capital risk
    qty = drm.calculate_position_size(entry_price, brackets["stop_price"])
    print(f"  ✓ Volatility-Calibrated Position Size: {qty} shares")
    assert qty > 0, "Position size must be positive"
    print("  ✓ Pillar 5 Passed: Dynamic ATR brackets and volatility risk sizing verified.")

if __name__ == "__main__":
    print("==============================================================")
    print("     ALPHA ENGINE 5 DYNAMIC CORE PILLARS VALIDATION SUITE     ")
    print("==============================================================")
    try:
        test_pillar_1_model_discovery()
        test_pillar_2_exchange_calendars()
        test_pillar_3_feed_adaptation()
        test_pillar_4_contract_resolution()
        test_pillar_5_volatility_risk_scaling()
        print("\n==============================================================")
        print("     ALL 5 DYNAMIC CORE PILLARS PASSED SUCCESSFULLY!          ")
        print("==============================================================\n")
    except AssertionError as e:
        print(f"\n❌ ASSERTION FAILED: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ UNEXPECTED ERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
