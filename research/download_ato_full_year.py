#!/usr/bin/env python3
"""
Institutional 1-Year Historical 1-Minute Bar Downloader for Atos Group SE (ATO - Euronext Paris / SBF)
Queries IBKR Gateway on Edge VM in 1-Week chunks with strict pacing compliance.
Outputs to: ATO_EURONEXT_1MIN_1YEAR.csv
"""

import sys
import time
import threading
import pandas as pd
from datetime import datetime, timedelta
from typing import List, Dict, Any
from ibapi.client import EClient
from ibapi.wrapper import EWrapper
from ibapi.contract import Contract

class FullYearExporter(EWrapper, EClient):
    def __init__(self):
        EClient.__init__(self, self)
        self.connected_event = threading.Event()
        self.req_event = threading.Event()
        self.current_bars: List[Dict[str, Any]] = []
        self.all_bars: List[Dict[str, Any]] = []
        self.current_req_id = 1000

    def nextValidId(self, orderId: int):
        print(f"[IBKR API] Connected to Gateway 4001. Starting 1-Year extraction for ATO...")
        self.connected_event.set()

    def error(self, reqId: int, errorCode: int, errorString: str, advancedOrderRejectJson=""):
        if errorCode in [2104, 2106, 2107, 2158, 2174]:
            return
        print(f"[IBKR MSG] ReqId: {reqId} | Code {errorCode}: {errorString}")
        if errorCode in [162, 502, 504]:
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
        self.all_bars.extend(self.current_bars)
        print(f"  -> Retrieved {len(self.current_bars)} bars [{start} to {end}] | Total: {len(self.all_bars):,}")
        self.req_event.set()

def create_contract() -> Contract:
    c = Contract()
    c.conId = 767901404
    c.symbol = "ATO"
    c.secType = "STK"
    c.exchange = "SMART"
    c.primaryExchange = "SBF"
    c.currency = "EUR"
    return c

def main():
    weeks_to_pull = int(sys.argv[1]) if len(sys.argv) > 1 else 52 # 52 weeks = 1 full year
    output_file = sys.argv[2] if len(sys.argv) > 2 else "ATO_EURONEXT_1MIN_1YEAR.csv"

    app = FullYearExporter()
    app.connect('127.0.0.1', 4001, clientId=967)
    t = threading.Thread(target=app.run, daemon=True)
    t.start()

    if not app.connected_event.wait(timeout=10.0):
        print("[FATAL] Could not connect to IB Gateway on 127.0.0.1:4001")
        sys.exit(1)

    contract = create_contract()
    current_end = datetime(2026, 10, 22, 18, 0, 0)

    print(f"Downloading {weeks_to_pull} weeks (~{weeks_to_pull/4:.1f} months) of authentic 1-minute bars for ATO...")

    for w in range(weeks_to_pull):
        end_str = current_end.strftime("%Y%m%d %H:%M:%S")
        app.current_bars = []
        app.req_event.clear()
        app.current_req_id += 1

        print(f"[{w+1}/{weeks_to_pull}] Requesting 1-week window ending {end_str}...")
        app.reqHistoricalData(
            reqId=app.current_req_id,
            contract=contract,
            endDateTime=end_str,
            durationStr="1 W",
            barSizeSetting="1 min",
            whatToShow="TRADES",
            useRTH=1,
            formatDate=1,
            keepUpToDate=False,
            chartOptions=[]
        )

        app.req_event.wait(timeout=15.0)
        # Shift back 7 days for the next chunk
        current_end -= timedelta(days=7)
        # Sleep 1.6s to strictly prevent IBKR pacing violations
        time.sleep(1.6)

    app.disconnect()

    if not app.all_bars:
        print("[ERROR] No bars were collected.")
        sys.exit(1)

    df = pd.DataFrame(app.all_bars)
    df = df.drop_duplicates(subset=['datetime']).sort_values('datetime').reset_index(drop=True)
    df.to_csv(output_file, index=False)
    print(f"\n[DONE] Saved {len(df):,} unique 1-minute bars to {output_file}")

if __name__ == "__main__":
    main()
