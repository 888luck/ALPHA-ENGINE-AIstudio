import sys
import time
import threading
from ibapi.client import EClient
from ibapi.wrapper import EWrapper
from ibapi.contract import Contract

class Probe(EWrapper, EClient):
    def __init__(self):
        EClient.__init__(self, self)
        self.ev = threading.Event()
        self.contracts = []
    def nextValidId(self, orderId):
        print(f"[PROBE] Connected to IBKR Gateway 4001, orderId={orderId}")
        self.ev.set()
    def symbolSamples(self, reqId, cds):
        print(f"[PROBE] Received {len(cds)} symbol matches for ATO:")
        for cd in cds:
            c = cd.contract
            print(f"  conId={c.conId} sym={c.symbol} sec={c.secType} primExch={c.primaryExchange} curr={c.currency} derivSecTypes={cd.derivativeSecTypes}")
        self.ev.set()
    def contractDetails(self, reqId, cd):
        c = cd.contract
        print(f"[CONTRACT DETAILS] conId={c.conId} sym={c.symbol} exch={c.exchange} primExch={c.primaryExchange} curr={c.currency} longName={cd.longName}")
        self.contracts.append(cd)
    def contractDetailsEnd(self, reqId):
        print("[CONTRACT DETAILS END]")
        self.ev.set()
    def error(self, reqId, code, msg, *args):
        if code in [2104, 2106, 2107, 2158]: return
        print(f"[IBKR ERROR] ReqId {reqId} Code {code}: {msg}")

p = Probe()
p.connect('127.0.0.1', 4001, clientId=889)
threading.Thread(target=p.run, daemon=True).start()

if not p.ev.wait(6):
    print("Failed to connect.")
    sys.exit(1)

p.ev.clear()
print("\n--- 1. Searching Matching Symbols for 'ATO' ---")
p.reqMatchingSymbols(101, 'ATO')
p.ev.wait(6)

p.ev.clear()
print("\n--- 2. Requesting Contract Details for ATO on SMART EUR (primary SBF/ENEXT.BE/PA) ---")
c = Contract()
c.symbol = "ATO"
c.secType = "STK"
c.currency = "EUR"
c.exchange = "SMART"
p.reqContractDetails(102, c)
p.ev.wait(6)

time.sleep(1)
p.disconnect()
