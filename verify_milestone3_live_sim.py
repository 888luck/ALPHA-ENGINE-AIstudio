"""
Milestone 3: End-to-End Live Simulation Verification Script
Tests Gate 5 NLP Dual Veto, Trailing Stop modulation, and port 4002 IBKR Gateway liveliness.
"""

import socket
import sys
import time
from connection import ConnectionManager
from alpha_strategy import AlphaStrategy
from backtester import AlphaBacktestingEngine

def check_socket_port(host: str, port: int, timeout: float = 2.0) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except (socket.timeout, ConnectionRefusedError, OSError):
        return False

def run_verification():
    print("=====================================================================")
    print("      MILESTONE 3: END-TO-END LIVE SIMULATION VERIFICATION          ")
    print("=====================================================================")

    # 1. Check Port 4002 Liveliness
    p4002_live = check_socket_port("127.0.0.1", 4002)
    print(f"[CHECK 1] IBKR Gateway Port 4002 Socket Liveliness: {'ONLINE (LISTEN)' if p4002_live else 'OFFLINE'}")

    # 2. Check Port 4005 (Edge TCP Bridge)
    p4005_live = check_socket_port("127.0.0.1", 4005)
    print(f"[CHECK 2] Edge TCP Bridge Port 4005 Socket Liveliness: {'ONLINE (LISTEN)' if p4005_live else 'OFFLINE'}")

    # 3. Test Gate 5 NLP Dual Veto in AlphaStrategy
    cm = ConnectionManager(trading_mode="PAPER")
    strat = AlphaStrategy(cm, "ALGO_DEC_992", "ALGO_EXE_554")

    # Long setup with negative polarity (-0.82) -> Must be rejected by Gate 5
    veto_long = not strat.screen_macro_driver_congruence("SPY", "NVDA", 450.0, macro_bullish=True, catalyst_polarity=-0.82)
    print(f"[CHECK 3] Gate 5 Adverse Veto on Long (+450 OFI with -0.82 Polarity): {'PASS (VETOED)' if veto_long else 'FAIL'}")

    # Long setup with positive PEAD polarity (+0.78) -> Must be approved by Gate 5
    approve_long = strat.screen_macro_driver_congruence("SPY", "NVDA", 450.0, macro_bullish=True, catalyst_polarity=0.78)
    print(f"[CHECK 4] Gate 5 Approval on Long (+450 OFI with +0.78 Polarity): {'PASS (APPROVED)' if approve_long else 'FAIL'}")

    # Short setup with positive polarity (+0.75) -> Must be rejected by Gate 5
    veto_short = not strat.screen_macro_driver_congruence("SPY", "NVDA", -450.0, macro_bullish=False, catalyst_polarity=0.75)
    print(f"[CHECK 5] Gate 5 Adverse Veto on Short (-450 OFI with +0.75 Polarity): {'PASS (VETOED)' if veto_short else 'FAIL'}")

    # Short setup with negative polarity (-0.75) -> Must be approved by Gate 5
    approve_short = strat.screen_macro_driver_congruence("SPY", "NVDA", -450.0, macro_bullish=False, catalyst_polarity=-0.75)
    print(f"[CHECK 6] Gate 5 Approval on Short (-450 OFI with -0.75 Polarity): {'PASS (APPROVED)' if approve_short else 'FAIL'}")

    # 4. Test Trailing Modulation in Backtester
    bt_engine = AlphaBacktestingEngine()
    bars = [
        {"timestamp": "2026-01-01 09:30:00", "open": 100, "high": 102, "low": 99, "close": 101, "volume": 1000},
        {"timestamp": "2026-01-01 09:31:00", "open": 101, "high": 104, "low": 100, "close": 103, "volume": 1500},
        {"timestamp": "2026-01-01 09:32:00", "open": 103, "high": 106, "low": 102, "close": 105, "volume": 1800},
        {"timestamp": "2026-01-01 09:33:00", "open": 105, "high": 108, "low": 104, "close": 107, "volume": 2000},
    ]

    # Baseline trailing
    baseline_trail = bt_engine._modulate_trailing_for_catalyst(1.5, catalyst_polarity=None)
    # PEAD expansion (1.25x)
    pead_trail = bt_engine._modulate_trailing_for_catalyst(1.5, catalyst_polarity=0.80)
    # Adverse tightening (0.75x)
    adverse_trail = bt_engine._modulate_trailing_for_catalyst(1.5, catalyst_polarity=-0.80)

    trail_pass = (baseline_trail == 1.5) and (pead_trail == 1.5 * 1.25) and (adverse_trail == 1.5 * 0.75)
    print(f"[CHECK 7] Catalyst Trailing Modulation (1.5 -> PEAD {pead_trail} ATR, Adverse {adverse_trail} ATR): {'PASS' if trail_pass else 'FAIL'}")

    all_passed = p4002_live and p4005_live and veto_long and approve_long and veto_short and approve_short and trail_pass
    print("=====================================================================")
    if all_passed:
        print(">>> MILESTONE 3 VERIFICATION COMPLETE: ALL 7 AUDITS PASSED 100% <<<")
    else:
        print(">>> MILESTONE 3 VERIFICATION ENCOUNTERED AN UNEXPECTED STATUS <<<")
    print("=====================================================================")
    sys.exit(0 if all_passed else 1)

if __name__ == "__main__":
    run_verification()
