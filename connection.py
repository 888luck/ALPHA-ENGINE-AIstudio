import threading
import time
from typing import Dict, Any, Callable, List, Optional
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
    Supports multi-threaded heartbeats, environment isolation assertions (PAPER vs LIVE),
    account callbacks, Level 2 depth, short locate/borrow tracking, and direct order transmission.
    """
    def __init__(self, trading_mode: str = "PAPER"):
        EClient.__init__(self, wrapper=self)
        self.is_connected = False
        self.trading_mode = trading_mode.upper()  # "PAPER" | "LIVE" | "BACKTEST"
        self.account_summary: Dict[str, Any] = {}
        self.active_positions: Dict[str, Any] = {}
        self.level2_depth: Dict[str, Dict[int, Any]] = {}  # ticker -> level depth map
        self.pnl_updates: Dict[str, Any] = {"realized": 0.0, "unrealized": 0.0, "total": 0.0}
        
        # Institutional Data Caches
        self.short_availability_cache: Dict[str, Dict[str, Any]] = {} # symbol -> {shares_available, borrow_fee_pct}
        self.fundamental_data_cache: Dict[str, str] = {}              # symbol -> xml/json reports
        self.contract_details_cache: Dict[str, Dict[str, Any]] = {}
        self.whatif_order_cache: Dict[str, Dict[str, Any]] = {}
        self.historical_data_buffer: Dict[int, List[Dict[str, Any]]] = {}
        self.req_id_to_symbol: Dict[int, str] = {}
        self.accounts_list: List[str] = []
        
        # Event callbacks mapped to strategic risk router
        self.on_quote_callback: Optional[Callable] = None
        self.on_execution_callback: Optional[Callable] = None
        self.on_pnl_callback: Optional[Callable] = None
        self.on_historical_data_complete_callback: Optional[Callable] = None
        
        # Auto-reconnection with Exponential Backoff
        self.auto_reconnect_enabled: bool = True
        self._host: str = "127.0.0.1"
        self._port: int = 4002
        self._client_id: int = 10
        self._reconnect_delay: float = 2.0
        self._max_reconnect_delay: float = 60.0
        self._is_reconnecting: bool = False
        
    def connect_gateway(self, host: str, port: int, client_id: int):
        self._host = host
        self._port = port
        self._client_id = client_id
        print(f"[CONNECTION] Connecting to IBKR Gateway at {host}:{port} (Mode: {self.trading_mode})...")
        self.connect(host, port, client_id)
        self.is_connected = True
        self._reconnect_delay = 2.0
        
        # Start background API processing thread
        thread = threading.Thread(target=self.run, name="IBKR_API_Loop", daemon=True)
        thread.start()
        
        # Launch dedicated pulse monitor
        threading.Thread(target=self._heartbeat_pulse, daemon=True).start()
        print("[CONNECTION] Connected successfully. Background listener thread and heartbeat active.")

    def _heartbeat_pulse(self):
        """Continuously screens socket connectivity and latency parameters."""
        while self.is_connected:
            try:
                self.reqCurrentTime()
            except Exception as e:
                print(f"[HEARTBEAT] Connection health query failed: {e}")
            time.sleep(10)

    def connectionClosed(self):
        """Called by IB API when the TCP connection to TWS/Gateway drops."""
        print("[CONNECTION] Socket connection closed by remote IBKR gateway.")
        self.is_connected = False
        if self.auto_reconnect_enabled and not self._is_reconnecting:
            threading.Thread(target=self._reconnect_worker, name="IBKR_Reconnect_Thread", daemon=True).start()

    def _reconnect_worker(self):
        """
        Background worker executing exponential backoff reconnection.
        Guarantees that nightly TWS/Gateway resets (23:45 - 00:45 EST) or ISP hiccups
        do not crash the engine.
        """
        if self._is_reconnecting:
            return
        self._is_reconnecting = True
        print(f"[AUTO-RECONNECT] Initiating reconnect loop for {self._host}:{self._port}...")
        
        attempt = 1
        while self.auto_reconnect_enabled and not self.is_connected:
            delay = self._reconnect_delay
            print(f"[AUTO-RECONNECT] Attempt {attempt}: Retrying connection in {delay:.1f}s...")
            time.sleep(delay)
            
            try:
                try:
                    self.disconnect()
                except Exception:
                    pass
                
                self.connect(self._host, self._port, self._client_id)
                self.is_connected = True
                self._is_reconnecting = False
                self._reconnect_delay = 2.0 # Reset backoff
                print(f"[AUTO-RECONNECT] Reconnection successful on attempt {attempt}! Restarting API loop.")
                
                thread = threading.Thread(target=self.run, name="IBKR_API_Loop", daemon=True)
                thread.start()
                return
            except Exception as e:
                attempt += 1
                self._reconnect_delay = min(self._max_reconnect_delay, self._reconnect_delay * 2.0)
                print(f"[AUTO-RECONNECT] Attempt failed: {e}. Backing off to {self._reconnect_delay:.1f}s.")
                
        self._is_reconnecting = False

    def is_quote_stale(self, timestamp: float, max_latency_ms: float = 500.0) -> bool:
        """Stale quote watchdog: drops ticks arriving older than threshold during socket jitter."""
        latency_ms = (time.time() - timestamp) * 1000.0
        return latency_ms > max_latency_ms

    # --- EWrapper Overrides & Inbound Message Parsers ---
    def managedAccounts(self, accountsList: str):
        """
        Failsafe Environment Isolation Airbag:
        Asserts that Paper mode strictly connects to 'DU...' accounts.
        If a production 'U...' account is detected in Paper mode, aborts instantly.
        """
        self.accounts_list = [a.strip() for a in accountsList.split(",") if a.strip()]
        print(f"[IBKR ACCOUNTS] Assigned account IDs: {self.accounts_list}")
        
        for acc in self.accounts_list:
            if self.trading_mode == "PAPER" and not acc.startswith("DU") and "TEST" not in acc.upper():
                print(f"!!! [CRITICAL BROKER AIRBAG TRIGGERED] !!! Mode is PAPER but detected Live Account {acc}! Disconnecting immediately.")
                self.disconnect()
                self.is_connected = False
                return
            elif self.trading_mode == "LIVE" and acc.startswith("DU"):
                print(f"[WARNING] Mode is LIVE but detected Paper Account {acc}. Real capital is not deployed on DU accounts.")

    def currentTime(self, time_val: int):
        pass

    def error(self, reqId: int, errorCode: int, errorString: str, advancedOrderRejectJson: str = ""):
        print(f"[GATEWAY ERROR] ReqID: {reqId} | Code: {errorCode} | Message: {errorString}")
        
        # IBKR Connectivity Code Handling
        if errorCode == 1100: # Connectivity between IB and TWS lost
            print("[GATEWAY ALERT] IBKR Connectivity Lost (Code 1100). Socket marked offline.")
            self.is_connected = False
            if self.auto_reconnect_enabled and not self._is_reconnecting:
                threading.Thread(target=self._reconnect_worker, name="IBKR_Reconnect_Thread", daemon=True).start()
        elif errorCode in [1101, 1102]: # Connectivity restored
            print(f"[GATEWAY ALERT] IBKR Connectivity Restored (Code {errorCode}). Resetting backoff.")
            self.is_connected = True
            self._reconnect_delay = 2.0
        elif errorCode in [502, 504]: # Couldn't connect or Not connected
            print(f"[GATEWAY ALERT] Socket Not Connected (Code {errorCode}). Initiating backoff retry.")
            self.is_connected = False
            if self.auto_reconnect_enabled and not self._is_reconnecting:
                threading.Thread(target=self._reconnect_worker, name="IBKR_Reconnect_Thread", daemon=True).start()

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
        self.pnl_updates["realized"] = realizedPnL
        self.pnl_updates["unrealized"] = unrealizedPnL
        self.pnl_updates["total"] = unrealizedPnL + realizedPnL
        if self.on_pnl_callback:
            self.on_pnl_callback(self.pnl_updates)

    def execDetails(self, reqId: int, contract: Any, execution: Any):
        """Tracks detailed transaction fills."""
        print(f"[EXECUTION REPORT] Order Filled: {contract.symbol} Qty: {execution.shares} @ ${execution.price:.2f}")
        if self.on_execution_callback:
            self.on_execution_callback(contract.symbol, execution)

    def commissionReport(self, commissionReport: Any):
        """Calculates exact post-execution friction under IBKR pricing tiers."""
        print(f"[TRANSACTION FRICTION] Ref: {commissionReport.execId} Cost: {commissionReport.commission} {commissionReport.currency}")
        if hasattr(self, 'on_commission_callback') and self.on_commission_callback:
            self.on_commission_callback(commissionReport)

    # --- SHORT LOCATE & BORROW FEE RATE CALLBACKS (Ticks 236 & 232) ---
    def tickGeneric(self, reqId: int, tickType: int, value: float):
        """
        Captures institutional short availability and borrow rate dynamics:
          tickType 236 = Shortable shares available
          tickType 232 = Short borrow fee rate (%)
        """
        symbol = self.req_id_to_symbol.get(reqId, "UNKNOWN")
        if symbol not in self.short_availability_cache:
            self.short_availability_cache[symbol] = {"shares_available": 1000000, "borrow_fee_pct": 0.5}
            
        if tickType == 236: # Shortable Shares
            self.short_availability_cache[symbol]["shares_available"] = float(value)
            print(f"[BORROW MONITOR] {symbol} Shortable Shares Available: {int(value):,}")
        elif tickType == 232: # Borrow Fee Rate %
            self.short_availability_cache[symbol]["borrow_fee_pct"] = float(value)
            print(f"[BORROW MONITOR] {symbol} Borrow Fee Rate: {value:.2f}%")

    # --- FUNDAMENTAL CORPORATE & EARNINGS CALENDAR CALLBACKS ---
    def fundamentalData(self, reqId: int, data: str):
        """Ingests institutional Reuters corporate event/earnings calendar XML from IBKR."""
        symbol = self.req_id_to_symbol.get(reqId, "UNKNOWN")
        self.fundamental_data_cache[symbol] = data
        print(f"[EARNINGS/EVENT CALENDAR RECEIVED] {symbol}: Received {len(data)} bytes of structured event disclosures.")

    # --- NEWS & REGULATORY BULLETINS CALLBACKS ---
    def newsBulletin(self, msgId: int, msgType: int, message: str, origExchange: str):
        """Receives live broker news bulletins, regulatory notices, and exchange alerts."""
        print(f"[IBKR NEWS BULLETIN] ID:{msgId} Type:{msgType} Exch:{origExchange} Msg:{message[:80]}...")
        if hasattr(self, 'on_news_bulletin_callback') and self.on_news_bulletin_callback:
            self.on_news_bulletin_callback(msgId, msgType, message, origExchange)

    def newsProviders(self, newsProviders: Any):
        """Receives active news providers subscribed on the account."""
        providers = []
        try:
            for p in newsProviders:
                providers.append({"code": p.code, "name": p.name})
        except Exception:
            pass
        print(f"[IBKR NEWS PROVIDERS] Subscribed Feeds: {providers}")

    # --- CONTRACT DETAILS & LIQUID HOURS CALLBACKS ---
    def contractDetails(self, reqId: int, contractDetails: Any):
        """Processes full contract metadata including official liquidHours and primaryExchange."""
        c = contractDetails.contract
        self.contract_details_cache[c.symbol] = {
            "conId": c.conId,
            "symbol": c.symbol,
            "primaryExchange": getattr(contractDetails, 'primaryExchange', getattr(c, 'primaryExchange', '')),
            "currency": c.currency,
            "liquidHours": getattr(contractDetails, 'liquidHours', ''),
            "tradingHours": getattr(contractDetails, 'tradingHours', ''),
            "timeZoneId": getattr(contractDetails, 'timeZoneId', 'America/New_York'),
            "minTick": getattr(contractDetails, 'minTick', 0.01)
        }
        print(f"[CONTRACT RESOLVED] {c.symbol} (ConID: {c.conId}) LiquidHours: {getattr(contractDetails, 'liquidHours', 'N/A')[:40]}...")

    def contractDetailsEnd(self, reqId: int):
        pass

    # --- WHAT-IF ORDER COMMISSION AUDIT CALLBACK ---
    def openOrder(self, orderId: int, contract: Any, order: Any, orderState: Any):
        """Captures real-time commission and margin estimates from What-If orders."""
        if getattr(order, 'whatIf', False):
            comm = getattr(orderState, 'commission', 0.0)
            init_margin = getattr(orderState, 'initMarginChange', '0.0')
            self.whatif_order_cache[contract.symbol] = {
                "commission": comm,
                "currency": getattr(orderState, 'commissionCurrency', 'USD'),
                "initMarginChange": init_margin,
                "status": getattr(orderState, 'status', '')
            }

    # --- LEVEL 2 MARKET DEPTH CALLBACKS ---
    def updateMktDepth(self, reqId: int, position: int, operation: int, side: int, price: float, size: float):
        """Processes Level 2 order book depth line updates."""
        ticker = getattr(self, 'depth_req_map', {}).get(reqId, "UNKNOWN")
        if ticker not in self.level2_depth:
            self.level2_depth[ticker] = {"bids": {}, "asks": {}}
            
        book_side = "bids" if side == 1 else "asks"
        if operation == 2: # Delete
            self.level2_depth[ticker][book_side].pop(position, None)
        else: # Insert (0) or Update (1)
            self.level2_depth[ticker][book_side][position] = {"price": price, "size": size}

    # --- HISTORICAL DATA RESOLUTION WRAPPERS & CALLBACKS ---
    def historicalData(self, reqId: int, bar: Any):
        """Processes inbound historical candlestick bars from IBKR Gateway."""
        if reqId not in self.historical_data_buffer:
            self.historical_data_buffer[reqId] = []
            
        try:
            bar_date = bar.date
            bar_open = bar.open
            bar_high = bar.high
            bar_low = bar.low
            bar_close = bar.close
            bar_volume = bar.volume
        except AttributeError:
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
        print(f"[HISTORICAL END] ReqID: {reqId} | Completed download {start} to {end}")
        if self.on_historical_data_complete_callback:
            self.on_historical_data_complete_callback(reqId, self.historical_data_buffer.get(reqId, []))
