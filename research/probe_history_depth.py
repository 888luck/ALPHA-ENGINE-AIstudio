#!/usr/bin/env python3
import time
import threading
import sys
from datetime import datetime
from ibapi.client import EClient
from ibapi.wrapper import EWrapper
from ibapi.contract import Contract

class TestHistory(EWrapper, EClient):
    def __init__(self, end_str, duration="1 W"):
        EClient.__init__(self, self)
        self.ev = threading.Event()
        self.count = 0
        self.end_str = end_str
        self.duration = duration
        self.start_str = ""
        self.end_received = ""
        self.err = None

    def nextValidId(self, orderId):
        c = Contract()
        c.conId = 522269891
        c.symbol = 'ONWD'
        c.secType = 'STK'
        c.exchange = 'SMART'
        c.primaryExchange = 'ENEXT.BE'
        c.currency = 'EUR'
        print(f"[PROBE] Requesting ONWD historical bars: duration={self.duration}, end={self.end_str}...")
        self.reqHistoricalData(101, c, self.end_str, self.duration, '1 min', 'TRADES', 1, 1, False, [])

    def historicalData(self, reqId, bar):
        self.count += 1

    def historicalDataEnd(self, reqId, start, end):
        self.start_str = start
        self.end_received = end
        print(f"[SUCCESS] Received {self.count} 1-min bars: range [{start} -> {end}]")
        self.ev.set()

    def error(self, reqId, code, msg, adv=''):
        if code not in [2104, 2106, 2107, 2158]:
            print(f"[IB MSG] Code {code}: {msg}")
            if code in [162, 502, 504]:
                self.err = msg
                self.ev.set()

def probe(end_str, duration="1 W"):
    app = TestHistory(end_str, duration)
    app.connect('127.0.0.1', 4001, clientId=881)
    t = threading.Thread(target=app.run, daemon=True)
    t.start()
    app.ev.wait(timeout=12.0)
    app.disconnect()
    return app.count, app.start_str, app.end_received, app.err

if __name__ == '__main__':
    # Test 6 months ago (April 2026)
    target = sys.argv[1] if len(sys.argv) > 1 else '20260422 18:00:00 CET'
    dur = sys.argv[2] if len(sys.argv) > 2 else '1 W'
    count, s, e, err = probe(target, dur)
    print(f"Final Result: count={count}, err={err}")
