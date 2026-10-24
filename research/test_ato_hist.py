import sys
import time
import threading
from ibapi.client import EClient
from ibapi.wrapper import EWrapper
from ibapi.contract import Contract

class Probe1(EWrapper, EClient):
    def __init__(self):
        EClient.__init__(self, self)
        self.ev = threading.Event()
        self.bars = []
    def nextValidId(self, orderId):
        self.ev.set()
    def historicalData(self, reqId, bar):
        self.bars.append(bar)
    def historicalDataEnd(self, reqId, start, end):
        print(f"Retrieved {len(self.bars)} bars from {start} to {end}")
        if self.bars:
            print(f"Sample bar: dt={self.bars[0].date} c={self.bars[0].close} v={self.bars[0].volume}")
        self.ev.set()
    def error(self, reqId, code, msg, *args):
        if code in [2104, 2106, 2107, 2158]: return
        print(f"[ERR {code}] {msg}")

p = Probe1()
p.connect('127.0.0.1', 4001, clientId=890)
threading.Thread(target=p.run, daemon=True).start()
p.ev.wait(5)
p.ev.clear()

c = Contract()
c.conId = 767901404
c.symbol = "ATO"
c.secType = "STK"
c.exchange = "SMART"
c.primaryExchange = "SBF"
c.currency = "EUR"

print("Testing 1 day of 1-minute bars...")
p.reqHistoricalData(
    reqId=201,
    contract=c,
    endDateTime="20261022 18:00:00",
    durationStr="1 D",
    barSizeSetting="1 min",
    whatToShow="TRADES",
    useRTH=1,
    formatDate=1,
    keepUpToDate=False,
    chartOptions=[]
)
p.ev.wait(10)
p.disconnect()
