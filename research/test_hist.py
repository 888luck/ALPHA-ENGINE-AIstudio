import sys
import time
import threading
from ibapi.client import EClient
from ibapi.wrapper import EWrapper
from ibapi.contract import Contract

class HistProbe(EWrapper, EClient):
    def __init__(self):
        EClient.__init__(self, self)
        self.connected_event = threading.Event()
        self.hist_event = threading.Event()
        self.bars = []
        self.error_msg = None

    def nextValidId(self, orderId: int):
        print(f"[HIST] Connected. NextValidId: {orderId}")
        self.connected_event.set()

    def error(self, reqId: int, errorCode: int, errorString: str, advancedOrderRejectJson=""):
        print(f"[HIST ERROR] ReqId: {reqId}, Code: {errorCode}, Msg: {errorString}")
        if errorCode not in [2104, 2106, 2107, 2158]:
            self.error_msg = f"{errorCode}: {errorString}"

    def historicalData(self, reqId: int, bar):
        self.bars.append({
            "date": bar.date,
            "open": bar.open,
            "high": bar.high,
            "low": bar.low,
            "close": bar.close,
            "volume": bar.volume,
            "barCount": bar.barCount,
            "wap": bar.wap
        })

    def historicalDataEnd(self, reqId: int, start: str, end: str):
        print(f"[HIST END] ReqId: {reqId}, total bars: {len(self.bars)}, start: {start}, end: {end}")
        self.hist_event.set()

def main():
    client = HistProbe()
    client.connect("127.0.0.1", 4002, clientId=779)
    threading.Thread(target=client.run, daemon=True).start()

    if not client.connected_event.wait(timeout=10):
        print("[HIST] Connect timeout!")
        sys.exit(1)

    c = Contract()
    c.conId = 522269891
    c.symbol = "ONWD"
    c.secType = "STK"
    c.exchange = "SMART"
    c.primaryExchange = "ENEXT.BE"
    c.currency = "EUR"

    print("\n--- Testing 1 day of 1 min TRADES ---")
    # endDateTime="" means current time
    client.reqHistoricalData(
        reqId=2001,
        contract=c,
        endDateTime="",
        durationStr="1 D",
        barSizeSetting="1 min",
        whatToShow="TRADES",
        useRTH=1,
        formatDate=1,
        keepUpToDate=False,
        chartOptions=[]
    )

    client.hist_event.wait(timeout=15)
    print(f"Bars received: {len(client.bars)}")
    if client.bars:
        print("First bar:", client.bars[0])
        print("Last bar:", client.bars[-1])

    time.sleep(1)
    client.disconnect()

if __name__ == "__main__":
    main()
