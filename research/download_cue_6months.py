#!/usr/bin/env python3
"""
Institutional 6-Month Historical 1-Minute Bar Downloader for CUE (NASDAQ)
Target: Cue Biopharma Inc (NASDAQ: CUE, conId: 876422571, currency: USD)
Pacing Safe Extraction: 1-Week chunks, synchronous req_event.wait(15.0), 1.8s delay.
Zero Error 162 enforcement.
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

class CUEMinuteExporter(EWrapper, EClient):
    def __init__(self):
        EClient.__init__(self, self)
        self.connected_event = threading.Event()
        self.req_event = threading.Event()
        self.current_bars: List[Dict[str, Any]] = []
        self.all_bars: List[Dict[str, Any]] = []
        self.current_req_id = 3000

    def nextValidId(self, orderId: int):
        print(f"[IBKR API] Connected to Gateway. Starting CUE 6-Month extraction...")
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
        print(f"  -> Retrieved {len(self.current_bars)} bars [{start} to {end}] | Total cumulative: {len(self.all_bars)}")
        self.req_event.set()

def create_cue_contract() -> Contract:
    c = Contract()
    c.conId = 876422571
    c.symbol = "CUE"
    c.secType = "STK"
    c.exchange = "SMART"
    c.primaryExchange = "NASDAQ"
    c.currency = "USD"
    return c

def main():
    weeks_to_pull = int(sys.argv[1]) if len(sys.argv) > 1 else 26  # 26 weeks = 6 full months
    output_file = sys.argv[2] if len(sys.argv) > 2 else "CUE_NASDAQ_1MIN_6MONTHS.csv"

    app = CUEMinuteExporter()
    app.connect('127.0.0.1', 4001, clientId=977)
    t = threading.Thread(target=app.run, daemon=True)
    t.start()

    if not app.connected_event.wait(timeout=10.0):
        print("[FATAL] Could not connect to IB Gateway on 127.0.0.1:4001")
        sys.exit(1)

    contract = create_cue_contract()
    # Starting anchor: 2026-10-22 20:00:00 US Eastern (Market close of yesterday)
    current_end = datetime(2026, 10, 22, 20, 0, 0)

    print(f"Downloading {weeks_to_pull} weeks (~{weeks_to_pull/4.33:.1f} months) of 1-minute bars for CUE NASDAQ...")

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
        # Strictly sleep 1.8s to prevent IBKR pacing violations (<= 60 req / 10 min)
        time.sleep(1.8)

    app.disconnect()

    if not app.all_bars:
        print("[ERROR] No bars were collected.")
        sys.exit(1)

    df = pd.DataFrame(app.all_bars)
    df = df.drop_duplicates(subset=['datetime']).sort_values('datetime').reset_index(drop=True)
    df.to_csv(output_file, index=False)
    print(f"\n[DONE] Saved {len(df):,} unique 1-minute bars to {output_file}")
    print(f"Date range: {df['datetime'].iloc[0]} -> {df['datetime'].iloc[-1]}")

if __name__ == "__main__":
    main()
