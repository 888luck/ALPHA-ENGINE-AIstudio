#!/usr/bin/env python3
"""
Institutional IBKR Data Exporter: Euronext ONWD 1-Minute Historical Bars (Past 3 Months)
Exports to: ONWD_EURONEXT_1MIN_3MONTHS.csv

Contract Specifications (Verified via IBKR API on ENEXT.BE):
  - conId: 522269891
  - symbol: ONWD
  - secType: STK
  - exchange: SMART
  - primaryExchange: ENEXT.BE (Euronext Brussels)
  - currency: EUR
"""

import os
import sys
import time
import argparse
import threading
from datetime import datetime, timedelta, timezone
from typing import List, Dict, Any, Optional

try:
    from ibapi.client import EClient
    from ibapi.wrapper import EWrapper
    from ibapi.contract import Contract
except ImportError:
    print("Error: ibapi is not installed. Run 'pip install ibapi'.")
    sys.exit(1)


class IBKRExporter(EWrapper, EClient):
    def __init__(self):
        EClient.__init__(self, self)
        self.connected_event = threading.Event()
        self.req_event = threading.Event()
        self.current_req_id = 0
        self.current_bars: List[Dict[str, Any]] = []
        self.error_code: Optional[int] = None
        self.error_msg: Optional[str] = None
        self.competing_session_detected = False

    def nextValidId(self, orderId: int):
        print(f"[IBKR API] Connected successfully. Session Ready. NextValidId: {orderId}")
        self.connected_event.set()

    def error(self, reqId: int, errorCode: int, errorString: str, advancedOrderRejectJson=""):
        # Informational codes to ignore
        if errorCode in [2104, 2106, 2107, 2158]:
            return
        
        self.error_code = errorCode
        self.error_msg = errorString
        print(f"[IBKR MSG] ReqId: {reqId} | Code {errorCode}: {errorString}")

        if errorCode == 162:
            if "connected from a different IP address" in errorString.lower():
                self.competing_session_detected = True
            # Release lock so caller can handle pacing or session error
            self.req_event.set()
        elif errorCode in [502, 504, 1100]:
            print(f"[IBKR CONNECTION ERROR] Code {errorCode}: {errorString}")
            self.req_event.set()

    def historicalData(self, reqId: int, bar):
        wap_val = getattr(bar, 'wap', getattr(bar, 'average', getattr(bar, 'WAP', 0.0)))
        count_val = getattr(bar, 'barCount', getattr(bar, 'count', 0))
        vol_val = getattr(bar, 'volume', 0.0)
        self.current_bars.append({
            "datetime": str(bar.date),
            "open": float(bar.open),
            "high": float(bar.high),
            "low": float(bar.low),
            "close": float(bar.close),
            "volume": float(vol_val),
            "wap": float(wap_val),
            "count": int(count_val)
        })

    def historicalDataEnd(self, reqId: int, start: str, end: str):
        self.req_event.set()


def create_onwd_contract() -> Contract:
    contract = Contract()
    contract.conId = 522269891
    contract.symbol = "ONWD"
    contract.secType = "STK"
    contract.exchange = "SMART"
    contract.primaryExchange = "ENEXT.BE"
    contract.currency = "EUR"
    return contract


def fetch_day_bars(app: IBKRExporter, contract: Contract, end_dt_str: str, what_to_show: str = "TRADES") -> List[Dict[str, Any]]:
    """Requests 1 day of 1-minute bars ending at end_dt_str."""
    app.current_bars = []
    app.error_code = None
    app.error_msg = None
    app.competing_session_detected = False
    app.req_event.clear()

    app.current_req_id += 1
    req_id = app.current_req_id

    app.reqHistoricalData(
        reqId=req_id,
        contract=contract,
        endDateTime=end_dt_str,
        durationStr="1 D",
        barSizeSetting="1 min",
        whatToShow=what_to_show,
        useRTH=1,          # Regular trading hours (Euronext 09:00 - 17:30 CET)
        formatDate=1,       # YYYYMMDD HH:MM:SS
        keepUpToDate=False,
        chartOptions=[]
    )

    # Wait up to 12s for response
    finished = app.req_event.wait(timeout=12.0)
    if not finished:
        print(f"  [TIMEOUT] ReqId {req_id} timed out waiting for broker response.")
        return []

    return app.current_bars


def main():
    parser = argparse.ArgumentParser(description="Export Euronext ONWD 1-Minute Bars for past 3 months.")
    parser.add_argument("--host", default="127.0.0.1", help="IB Gateway/TWS host")
    parser.add_argument("--port", type=int, default=4002, help="IB Gateway port (4002 Paper, 4001 Live, 7497 TWS Paper, 7496 TWS Live)")
    parser.add_argument("--client-id", type=int, default=955, help="Client ID for socket connection")
    parser.add_argument("--days", type=int, default=90, help="Days of lookback (default: 90 days / 3 months)")
    parser.add_argument("--output", default="ONWD_EURONEXT_1MIN_3MONTHS.csv", help="Output CSV path")
    parser.add_argument("--what-to-show", default="TRADES", choices=["TRADES", "MIDPOINT", "BID_ASK"], help="Bar price type")
    args = parser.parse_args()

    print(f"============================================================")
    print(f" IBKR EURONEXT 1-MINUTE DATA EXPORTER: ONWD (EUR)")
    print(f" Target: {args.host}:{args.port} | Lookback: {args.days} days")
    print(f" Output: {args.output} | Bar Type: {args.what_to_show}")
    print(f"============================================================")

    app = IBKRExporter()
    app.connect(args.host, args.port, clientId=args.client_id)

    loop_thread = threading.Thread(target=app.run, daemon=True)
    loop_thread.start()

    if not app.connected_event.wait(timeout=10.0):
        print(f"[FATAL] Failed to connect to IBKR at {args.host}:{args.port}.")
        sys.exit(1)

    contract = create_onwd_contract()

    # Build target dates (iterating backwards day by day from today)
    today = datetime.now()
    all_bars_map: Dict[str, Dict[str, Any]] = {}  # datetime -> bar dict (deduplicates)

    print(f"\n[INFO] Starting batch historical data retrieval ({args.days} days)...")
    consecutive_errors = 0

    for day_offset in range(args.days):
        target_date = today - timedelta(days=day_offset)
        # Skip weekends (Saturday=5, Sunday=6)
        if target_date.weekday() >= 5:
            continue

        # End of Euronext trading day (17:35 CET = 15:35 UTC) in IBKR-supported UTC format
        end_str = target_date.strftime("%Y%m%d 15:35:00 UTC")
        day_label = target_date.strftime("%Y-%m-%d")

        print(f"Fetching {day_label} (day {day_offset + 1}/{args.days})...", end="", flush=True)

        bars = fetch_day_bars(app, contract, end_str, what_to_show=args.what_to_show)

        if app.competing_session_detected:
            print("\n" + "=" * 60)
            print(" [ALERT] IBKR HMDS Error 162: Trading session connected from another IP!")
            print(" Please close any competing IBKR session (Client Portal browser or Mobile app).")
            print(" Waiting 15 seconds before retry...")
            print("=" * 60)
            time.sleep(15.0)
            # Retry once
            bars = fetch_day_bars(app, contract, end_str, what_to_show=args.what_to_show)

        if bars:
            print(f" OK: {len(bars)} bars")
            consecutive_errors = 0
            for b in bars:
                all_bars_map[b["datetime"]] = b
        else:
            if app.error_code:
                print(f" Empty/Error ({app.error_code})")
            else:
                print(f" 0 bars (market closed/holiday)")

        # IBKR Pacing Compliance: sleep 1.1s between calls to avoid Error 162 rate limit
        time.sleep(1.1)

    app.disconnect()
    print("\n[INFO] Disconnected from IBKR.")

    total_bars = len(all_bars_map)
    print(f"[INFO] Total unique bars retrieved: {total_bars}")

    if total_bars == 0:
        print("[WARNING] No bars retrieved. Verify market data permissions or resolve competing session.")
        return

    # Sort chronological
    sorted_bars = sorted(all_bars_map.values(), key=lambda x: x["datetime"])

    # Write to CSV
    import csv
    with open(args.output, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["datetime", "open", "high", "low", "close", "volume", "wap", "count"])
        for b in sorted_bars:
            writer.writerow([
                b["datetime"],
                b["open"],
                b["high"],
                b["low"],
                b["close"],
                b["volume"],
                b["wap"],
                b["count"]
            ])

    print(f"\n[SUCCESS] Successfully written {total_bars} bars to: {os.path.abspath(args.output)}")
    print(f"Date Range: {sorted_bars[0]['datetime']}  -->  {sorted_bars[-1]['datetime']}")


if __name__ == "__main__":
    main()
