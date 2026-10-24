import sys
import time
import threading
from ibapi.client import EClient
from ibapi.wrapper import EWrapper
from ibapi.contract import Contract

class CUEProbe(EWrapper, EClient):
    def __init__(self):
        EClient.__init__(self, self)
        self.connected_event = threading.Event()
        self.contract_event = threading.Event()
        self.contracts = []

    def nextValidId(self, orderId: int):
        print(f"[PROBE] Connected to Gateway. NextValidId: {orderId}")
        self.connected_event.set()

    def error(self, reqId: int, errorCode: int, errorString: str, advancedOrderRejectJson=""):
        if errorCode in [2104, 2106, 2107, 2158]:
            return
        print(f"[PROBE ERROR] ReqId: {reqId}, Code: {errorCode}, Msg: {errorString}")

    def contractDetails(self, reqId: int, contractDetails):
        c = contractDetails.contract
        print(f"[CONTRACT MATCH] conId={c.conId}, symbol={c.symbol}, secType={c.secType}, "
              f"exch={c.exchange}, primExch={c.primaryExchange}, curr={c.currency}, "
              f"longName={contractDetails.longName}")
        self.contracts.append((c, contractDetails))

    def contractDetailsEnd(self, reqId: int):
        print(f"[CONTRACT END] Total matches found: {len(self.contracts)}")
        self.contract_event.set()

def main():
    print("[PROBE] Connecting to 127.0.0.1:4001 with clientId=976...")
    client = CUEProbe()
    client.connect("127.0.0.1", 4001, clientId=976)
    
    t = threading.Thread(target=client.run, daemon=True)
    t.start()

    if not client.connected_event.wait(timeout=10):
        print("[ERROR] Connection timeout!")
        sys.exit(1)

    print("\n--- Testing reqContractDetails for CUE (NASDAQ / USD) ---")
    c = Contract()
    c.symbol = "CUE"
    c.secType = "STK"
    c.exchange = "SMART"
    c.currency = "USD"
    client.reqContractDetails(1001, c)
    client.contract_event.wait(timeout=10)

    time.sleep(1)
    client.disconnect()

if __name__ == "__main__":
    main()
