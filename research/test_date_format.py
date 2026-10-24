import sys
import time
import threading
from ibapi.client import EClient
from ibapi.wrapper import EWrapper
from ibapi.contract import Contract

class DateTest(EWrapper, EClient):
    def __init__(self):
        EClient.__init__(self, self)
        self.ev = threading.Event()
        self.bars = []
        self.err = None

    def nextValidId(self, orderId):
        self.ev.set()

    def error(self, reqId, code, msg, adv=""):
        if code not in [2104, 2106, 2107, 2158]:
            print(f"ERR reqId={reqId} code={code}: {msg}")
            self.err = (code, msg)

    def historicalData(self, reqId, bar):
        self.bars.append(bar)

    def historicalDataEnd(self, reqId, s, e):
        print(f"SUCCESS reqId={reqId} bars={len(self.bars)} start={s} end={e}")

app = DateTest()
app.connect("127.0.0.1", 4002, clientId=889)
threading.Thread(target=app.run, daemon=True).start()
app.ev.wait(5)

c = Contract()
c.conId = 522269891
c.symbol = "ONWD"
c.secType = "STK"
c.exchange = "SMART"
c.primaryExchange = "ENEXT.BE"
c.currency = "EUR"

formats = [
    ("20261021-15:35:00", "UTC dash format"),
    ("20261021 15:35:00 GMT", "GMT format"),
    ("20261021 15:35:00 UTC", "UTC format"),
    ("20261021 17:35:00 MET", "MET format"),
    ("20261021 17:35:00 CET", "CET format"),
    ("20261021 23:59:59", "plain date time"),
    ("", "empty current time")
]

for idx, (fmt, desc) in enumerate(formats, start=100):
    print(f"\n--- Testing [{desc}]: '{fmt}' ---")
    app.bars = []
    app.err = None
    app.reqHistoricalData(idx, c, fmt, "1 D", "1 min", "TRADES", 1, 1, False, [])
    time.sleep(2)

time.sleep(1)
app.disconnect()
