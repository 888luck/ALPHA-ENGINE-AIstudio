import sys
import time
import threading
from ibapi.client import EClient
from ibapi.wrapper import EWrapper
from ibapi.contract import Contract

class IBProbe(EWrapper, EClient):
    def __init__(self):
        EClient.__init__(self, self)
        self.connected_event = threading.Event()
        self.contract_event = threading.Event()
        self.symbol_event = threading.Event()
        self.contracts = []
        self.descriptions = []
        self.errors = []

    def nextValidId(self, orderId: int):
        print(f"[PROBE] Connected. NextValidId: {orderId}")
        self.connected_event.set()

    def error(self, reqId: int, errorCode: int, errorString: str, advancedOrderRejectJson=""):
        print(f"[PROBE ERROR] ReqId: {reqId}, Code: {errorCode}, Msg: {errorString}")
        self.errors.append((reqId, errorCode, errorString))

    def contractDetails(self, reqId: int, contractDetails):
        c = contractDetails.contract
        print(f"[CONTRACT] conId={c.conId}, symbol={c.symbol}, secType={c.secType}, "
              f"exch={c.exchange}, primExch={c.primaryExchange}, curr={c.currency}, "
              f"longName={contractDetails.longName}")
        self.contracts.append((c, contractDetails))

    def contractDetailsEnd(self, reqId: int):
        print(f"[CONTRACT END] ReqId: {reqId}")
        self.contract_event.set()

    def symbolSamples(self, reqId: int, contractDescriptions):
        print(f"[SYMBOLS] ReqId: {reqId}, count={len(contractDescriptions)}")
        for cd in contractDescriptions:
            c = cd.contract
            print(f"  Sample: conId={c.conId}, symbol={c.symbol}, secType={c.secType}, "
                  f"primaryExch={c.primaryExchange}, currency={c.currency}")
            self.descriptions.append(cd)
        self.symbol_event.set()

def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 4002
    print(f"[PROBE] Connecting to 127.0.0.1:{port}...")
    client = IBProbe()
    client.connect("127.0.0.1", port, clientId=778)
    
    t = threading.Thread(target=client.run, daemon=True)
    t.start()

    if not client.connected_event.wait(timeout=10):
        print("[PROBE] Connection timeout!")
        sys.exit(1)

    print("\n--- 1. Testing reqContractDetails for ONWD SMART EUR ---")
    c1 = Contract()
    c1.symbol = "ONWD"
    c1.secType = "STK"
    c1.exchange = "SMART"
    c1.currency = "EUR"
    client.reqContractDetails(1001, c1)
    client.contract_event.wait(timeout=5)

    print("\n--- 2. Testing reqMatchingSymbols for ONWD ---")
    client.reqMatchingSymbols(1002, "ONWD")
    client.symbol_event.wait(timeout=5)

    time.sleep(2)
    client.disconnect()
    print("[PROBE] Finished.")

if __name__ == "__main__":
    main()
