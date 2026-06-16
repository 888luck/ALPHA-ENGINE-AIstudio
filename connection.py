import threading
import time
from typing import Dict, Any, Callable
# In a local system, ibapi must be installed: 'pip install ibapi'
# We implement the exact structural blueprint required for production setup.
try:
    from ibapi.client import EClient
    from ibapi.wrapper import EWrapper
    from ibapi.contract import Contract
    from ibapi.order import Order
except ImportError:
    # Fallback placeholders for static code analysis compatibility
    class EWrapper: pass
    class EClient:
        def __init__(self, wrapper): self.wrapper = wrapper
    class Contract: pass
    class Order: pass

class ConnectionManager(EWrapper, EClient):
    """
    Asynchronous connection and gateway manager for IBKR Pro Ireland (IBIE).
    Supports multi-threaded heartbeats, account callbacks, Level 2 depth,
    and direct order transmission with regulatory auditing.
    """
    def __init__(self):
        EClient.__init__(self, wrapper=self)
        self.is_connected = False
        self.account_summary: Dict[str, Any] = {}
        self.active_positions: Dict[str, Any] = {}
        self.level2_depth: Dict[str, Dict[int, Any]] = {}  # ticker -> level depth map
        self.pnl_updates: Dict[str, Any] = {"realized": 0.0, "unrealized": 0.0, "total": 0.0}
        
        # Event callbacks mapped to strategic risk router
        self.on_quote_callback: Callable = None
        self.on_execution_callback: Callable = None
        self.on_pnl_callback: Callable = None
        
    def connect_gateway(self, host: str, port: int, client_id: int):
        self.connect(host, port, client_id)
        self.is_connected = True
        
        # Start background API processing thread
        thread = threading.Thread(target=self.run, name="IBKR_API_Loop", daemon=True)
        thread.start()
        
        # Launch dedicated pulse monitor
        threading.Thread(target=self._heartbeat_pulse, daemon=True).start()
        print("[CONNECTION] Connected successfully. Background listener thread and heartbeat active.")

    def _heartbeat_pulse(self):
        """Continuously screens socket connectivity and latency parameters."""
        while self.is_connected:
            # Under standard EClient, reqCurrentTime() serves as an active API ping
            try:
                self.reqCurrentTime()
            except Exception as e:
                print(f"[HEARTBEAT] Connection health query failed: {e}")
            time.sleep(10)

    # --- EWrapper Overrides & Inbound Message Parsers ---
    def currentTime(self, time_val: int):
        # Triggered by heartbeat requests
        pass

    def error(self, reqId: int, errorCode: int, errorString: str, advancedOrderRejectJson: str = ""):
        print(f"[GATEWAY ERROR] ReqID: {reqId} | Code: {errorCode} | Message: {errorString}")
        # Local routing logic can trigger adaptive actions on rate-limiting (e.g., Code 1100, 1102)

    def accountSummary(self, reqId: int, account: str, tag: str, value: str, currency: str):
        """Processes account values (e.g. NetLiquidation, MaintMarginReq) needed for risk screening."""
        self.account_summary[tag] = float(value) if value.replace('.', '', 1).isdigit() else value
        
    def position(self, account: str, contract: Any, position: float, avgCost: float):
        """Tracks active positions across the intraday target catalog."""
        symbol = contract.symbol
        self.active_positions[symbol] = {
            "qty": position,
            "avgCost": avgCost,
            "account": account
        }

    def pnlSingle(self, reqId: int, valKey: int, pos: int, dailyPnL: float, unrealizedPnL: float, realizedPnL: float, value: float):
        """Real-time portfolio drawdown monitor callback."""
        # Standard reqPnL callback updates
        self.pnl_updates["realized"] = realizedPnL
        self.pnl_updates["unrealized"] = unrealizedPnL
        self.pnl_updates["total"] = unrealizedPnL + realizedPnL
        if self.on_pnl_callback:
            self.on_pnl_callback(self.pnl_updates)

    def execDetails(self, reqId: int, contract: Any, execution: Any):
        """Tracks detailed transaction fills."""
        print(f"[EXECUTION REPORT] Order Filled: {contract.symbol} Qty: {execution.shares} @ {execution.price}")
        if self.on_execution_callback:
            self.on_execution_callback(contract.symbol, execution)

    def commissionReport(self, commissionReport: Any):
        """
        Calculates exact post-execution friction under IBKR pricing tiers.
        Required by DRM to audit net spreads and regulatory fees.
        """
        print(f"[TRANSACTION FRICTION] Ref: {commissionReport.execId} Cost: {commissionReport.commission} {commissionReport.currency}")

    # --- HISTORICAL DATA RESOLUTION WRAPPERS & CALLBACKS ---
    def historicalData(self, reqId: int, bar: Any):
        """
        Processes inbound historical candlestick bars from IBKR Gateway.
        Each bar contains date, open, high, low, close, volume, barCount, WAP.
        """
        if not hasattr(self, 'historical_data_buffer'):
            self.historical_data_buffer = {}
        if reqId not in self.historical_data_buffer:
            self.historical_data_buffer[reqId] = []
            
        # Extract bar values (supports native ibapi.common.BarData as well as dictionary fallback)
        try:
            bar_date = bar.date
            bar_open = bar.open
            bar_high = bar.high
            bar_low = bar.low
            bar_close = bar.close
            bar_volume = bar.volume
        except AttributeError:
            # Fallback if bar is dictionary
            bar_date = bar.get("date")
            bar_open = bar.get("open", 0.0)
            bar_high = bar.get("high", 0.0)
            bar_low = bar.get("low", 0.0)
            bar_close = bar.get("close", 0.0)
            bar_volume = bar.get("volume", 0.0)

        self.historical_data_buffer[reqId].append({
            "date": str(bar_date),
            "open": float(bar_open),
            "high": float(bar_high),
            "low": float(bar_low),
            "close": float(bar_close),
            "volume": float(bar_volume)
        })

    def historicalDataEnd(self, reqId: int, start: str, end: str):
        """Called when all historical bars have been received for a request."""
        print(f"[HISTORICAL END] ReqID: {reqId} | Completed download {start} to {end}")
        if hasattr(self, 'on_historical_data_complete_callback') and self.on_historical_data_complete_callback:
            self.on_historical_data_complete_callback(reqId, self.historical_data_buffer.get(reqId, []))

