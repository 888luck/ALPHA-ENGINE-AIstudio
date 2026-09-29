import sys
import os
import json
import urllib.request
import urllib.parse

# Ensure imports work from ALPHA-ENGINE-AIstudio directory
current_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(current_dir)
if parent_dir not in sys.path:
    sys.path.insert(0, parent_dir)

from risk_engine import DRMMiddleware, SyntheticStopManager
from connection import ConnectionManager

def test_phase3_core():
    print("============================================================")
    print("PHASE 3 CORE VERIFICATION: INTRADAY FLATTEN & PEAD LIFECYCLE")
    print("============================================================")

    # 1. Setup Mock Broker Connection
    cm = ConnectionManager(trading_mode="PAPER")
    cm.active_positions = {
        "NVDA": {"qty": 50, "avgCost": 120.0, "exchange": "NASDAQ", "is_swing": False},
        "XLE": {"qty": 100, "avgCost": 90.0, "exchange": "NYSE", "is_swing": True}, # Swing holding
        "SAP": {"qty": 20, "avgCost": 180.0, "exchange": "IBIS", "is_swing": False}  # European Euronext/Xetra
    }
    
    drm = DRMMiddleware(connection_manager=cm)
    stop_mgr = SyntheticStopManager(connection_manager=cm, drm_middleware=drm)
    
    # ------------------------------------------------------------
    # TEST 1: Intraday Flattening Controller at 15:45 EST
    # ------------------------------------------------------------
    print("\n--- TEST 1: Intraday Flattening Controller (15:45 EST Cutoff) ---")
    
    # Pre-market time: 14:30 EST (no flattening expected)
    orders_early = drm.check_intraday_flattening(current_time_est="14:30", current_time_cet="16:00")
    assert len(orders_early) == 0, f"Expected 0 liquidations before 15:45 EST, got {len(orders_early)}"
    print("[PASS] 14:30 EST: No premature liquidations triggered.")
    
    # US EOD time: 15:45 EST (NVDA should flatten, XLE is swing so should remain, SAP is European)
    orders_eod = drm.check_intraday_flattening(current_time_est="15:45", current_time_cet="16:00")
    flattened_symbols = [o["symbol"] for o in orders_eod]
    assert "NVDA" in flattened_symbols, "Expected NVDA to be flattened at 15:45 EST"
    assert "XLE" not in flattened_symbols, "Expected swing position XLE to be protected from intraday flatten"
    assert cm.active_positions["NVDA"]["qty"] == 0, "NVDA position should now be 0"
    assert cm.active_positions["XLE"]["qty"] == 100, "XLE swing position should remain 100"
    print(f"[PASS] 15:45 EST: NVDA successfully flattened ({orders_eod[0]['order_type']}). Swing holding XLE protected.")
    
    # European EOD time: 17:15 CET (SAP should flatten)
    orders_eu_eod = drm.check_intraday_flattening(current_time_est="11:15", current_time_cet="17:15")
    eu_symbols = [o["symbol"] for o in orders_eu_eod]
    assert "SAP" in eu_symbols, "Expected European SAP to be flattened at 17:15 CET"
    assert cm.active_positions["SAP"]["qty"] == 0, "SAP position should now be 0"
    print(f"[PASS] 17:15 CET: European asset SAP successfully flattened.")

    # ------------------------------------------------------------
    # TEST 2: Multi-Day PEAD & Intraday Breakeven Latch (+1.0x ATR)
    # ------------------------------------------------------------
    print("\n--- TEST 2: Breakeven Latch (+1.0x ATR Ratchet) ---")
    # Buy 10 shares of NVDA at $100.0, Stop loss $92.0 (-1.6x ATR), ATR = $5.0
    stop_mgr.register_position_stop(
        symbol="NVDA_PEAD",
        qty=10.0,
        stop_price=92.0,
        direction="BUY",
        entry_price=100.0,
        atr=5.0,
        is_swing=True
    )
    
    # Live tick at $103.0 (+0.6x ATR): Stop remains $92.0
    ev1 = stop_mgr.evaluate_live_price("NVDA_PEAD", 103.0)
    assert ev1 is None, f"Expected None at +0.6x ATR, got {ev1}"
    assert stop_mgr.synthetic_stops["NVDA_PEAD"]["stop_price"] == 92.0, "Stop should remain at initial stop $92.0"
    print("[PASS] Price at $103.0 (+0.6x ATR): Stop remains intact at initial stop $92.0.")
    
    # Live tick at $105.0 (+1.0x ATR): Breakeven Latch should trigger!
    ev2 = stop_mgr.evaluate_live_price("NVDA_PEAD", 105.0)
    assert ev2 is not None and ev2["type"] == "BREAKEVEN_LATCH", f"Expected BREAKEVEN_LATCH event, got {ev2}"
    assert stop_mgr.synthetic_stops["NVDA_PEAD"]["stop_price"] == 100.0, "Stop should be ratcheted to Breakeven $100.0"
    assert stop_mgr.synthetic_stops["NVDA_PEAD"]["breakeven_locked"] is True, "Breakeven lock flag should be True"
    print("[PASS] Price at $105.0 (+1.0x ATR): Breakeven Latch triggered! Stop ratcheted to entry price $100.0.")

    # ------------------------------------------------------------
    # TEST 3: Tiered Scale-Out (+2.0x ATR) & Runner Trail
    # ------------------------------------------------------------
    print("\n--- TEST 3: Tiered Scale-Out (+2.0x ATR Target) ---")
    # Live tick at $110.0 (+2.0x ATR): Should scale out 50% (5.0 shares), trail stop to $102.50 (+0.5x ATR locked)
    ev3 = stop_mgr.evaluate_live_price("NVDA_PEAD", 110.0)
    assert ev3 is not None and ev3["type"] == "SCALE_OUT", f"Expected SCALE_OUT event, got {ev3}"
    assert ev3["qty"] == 5.0, f"Expected 5.0 shares scaled out, got {ev3['qty']}"
    assert ev3["remaining_qty"] == 5.0, f"Expected 5.0 shares remaining, got {ev3['remaining_qty']}"
    assert ev3["new_stop"] == 102.50, f"Expected new stop at $102.50 (+0.5x ATR), got {ev3['new_stop']}"
    assert stop_mgr.synthetic_stops["NVDA_PEAD"]["qty"] == 5.0, "Internal stop qty should be halved"
    assert stop_mgr.synthetic_stops["NVDA_PEAD"]["stop_price"] == 102.50, "Internal stop price should be $102.50"
    print("[PASS] Price at $110.0 (+2.0x ATR): Scaled out 50% (5 shares @ $110.0). Stop trailed to locked profit $102.50.")

    # Live tick retraces to $102.00 (breaching $102.50 stop): Runner is stopped out with locked profit
    ev4 = stop_mgr.evaluate_live_price("NVDA_PEAD", 102.00)
    assert ev4 is not None and ev4["type"] == "STOP_LOSS", f"Expected STOP_LOSS event, got {ev4}"
    assert ev4["qty"] == 5.0, "Remaining 5 shares stopped out"
    assert "NVDA_PEAD" not in stop_mgr.synthetic_stops, "Stop should be removed after execution"
    print("[PASS] Price retraces to $102.0: Remaining 5 shares successfully stopped out with locked profit.")

    # ------------------------------------------------------------
    # TEST 4: IBKR Socket Auto-Reconnect & Error Code Handling
    # ------------------------------------------------------------
    print("\n--- TEST 4: IBKR Socket Auto-Reconnect & Connectivity Handlers ---")
    assert cm.auto_reconnect_enabled is True, "Auto-reconnect should be enabled by default"
    assert cm._reconnect_delay == 2.0, "Initial reconnect delay should be 2.0s"
    
    # Simulate IBKR error code 1100 (connection lost)
    cm.is_connected = True
    cm.error(reqId=-1, errorCode=1100, errorString="Connectivity between IB and Trader Workstation has been lost.")
    assert cm.is_connected is False, "Code 1100 should mark socket disconnected"
    print("[PASS] Code 1100: Socket offline state recognized.")
    
    # Simulate IBKR error code 1102 (connection restored)
    cm.error(reqId=-1, errorCode=1102, errorString="Connectivity restored - data maintained.")
    assert cm.is_connected is True, "Code 1102 should mark socket restored"
    assert cm._reconnect_delay == 2.0, "Code 1102 should reset backoff delay to 2.0s"
    print("[PASS] Code 1102: Socket restored and backoff delay reset to 2.0s.")

    print("\n============================================================")
    print("ALL PHASE 3 CORE QUANT & RISK TESTS PASSED WITH ZERO ERRORS!")
    print("============================================================")

if __name__ == "__main__":
    test_phase3_core()
