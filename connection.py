import threading
import time
import inspect
import datetime
from datetime import timezone
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
    def __init__(self, trading_mode: Optional[str] = None):
        EClient.__init__(self, wrapper=self)
        self.is_connected = False
        import os
        resolved_mode = trading_mode or os.getenv("TRADING_MODE", "LIVE" if os.getenv("IBKR_PORT") == "4001" else "PAPER")
        self.trading_mode = resolved_mode.upper()  # "PAPER" | "LIVE" | "BACKTEST"
        self.account_summary: Dict[str, Any] = {}
        self.active_positions: Dict[str, Any] = {}
        self.level2_depth: Dict[str, Dict[int, Any]] = {}  # ticker -> level depth map
        self.pnl_updates: Dict[str, Any] = {"realized": 0.0, "unrealized": 0.0, "total": 0.0}
        
        # Order Management & ID Tracking
        self.next_order_id: int = 1
        
        # Institutional Data Caches
        self.short_availability_cache: Dict[str, Dict[str, Any]] = {} # symbol -> {shares_available, borrow_fee_pct}
        self.fundamental_data_cache: Dict[str, str] = {}              # symbol -> xml/json reports
        self.contract_details_cache: Dict[str, Dict[str, Any]] = {}
        self.whatif_order_cache: Dict[str, Dict[str, Any]] = {}
        self.historical_data_buffer: Dict[int, List[Dict[str, Any]]] = {}
        self.req_id_to_symbol: Dict[int, str] = {}
        self.accounts_list: List[str] = []
        
        # Synchronous Request-Response Handlers & Dynamic Dispatch Tracking
        self._request_events: Dict[int, threading.Event] = {}
        self._request_results: Dict[int, Any] = {}
        self._tick_data: Dict[int, Dict[str, Any]] = {}
        self.news_bulletins: List[Dict[str, Any]] = []
        self._contract_events: Dict[int, threading.Event] = {}
        
        # Event callbacks mapped to strategic risk router
        self.on_quote_callback: Optional[Callable] = None
        self.on_execution_callback: Optional[Callable] = None
        self.on_order_status_callback: Optional[Callable] = None
        self.on_pnl_callback: Optional[Callable] = None
        self.on_historical_data_complete_callback: Optional[Callable] = None
        
        # Auto-reconnection with Exponential Backoff
        self.auto_reconnect_enabled: bool = True
        self._host: str = os.getenv("IBKR_HOST", "127.0.0.1")
        self._port: int = 4001 if self.trading_mode == "LIVE" else int(os.getenv("IBKR_PORT", 4002))
        self._client_id: int = 10
        self._reconnect_delay: float = 2.0
        self._max_reconnect_delay: float = 60.0
        self._is_reconnecting: bool = False
        
    def connect_gateway(self, host: str, port: int, client_id: int):
        self._host = host
        self._port = port
        self._client_id = client_id
        if port == 4001:
            self.trading_mode = "LIVE"
        elif port == 4002:
            self.trading_mode = "PAPER"
        print(f"[CONNECTION] Connecting to IBKR Gateway at {host}:{port} (Mode: {self.trading_mode})...")
        
        self._handshake_time_received = False
        self.connect(host, port, client_id)
        
        # Start background API processing thread
        thread = threading.Thread(target=self.run, name="IBKR_API_Loop", daemon=True)
        thread.start()
        
        print("[CONNECTION] Initiating 3-point handshake...")
        # Request time to verify responsiveness
        try:
            self.reqCurrentTime()
        except Exception:
            pass
            
        # Wait up to 10s for the handshake criteria
        success = False
        for _ in range(100):
            sv = self.serverVersion() if hasattr(self, 'serverVersion') else None
            if sv is not None and sv > 0 and len(self.accounts_list) > 0 and self.next_order_id > 0 and self._handshake_time_received:
                success = True
                break
            time.sleep(0.1)
            
        if success:
            self.is_connected = True
            self._reconnect_delay = 2.0
            try:
                self.reqAccountSummary(9001, "All", "NetLiquidation,TotalCashValue,AvailableFunds,ExcessLiquidity,BuyingPower,MaintMarginReq")
            except Exception as e:
                print(f"[CONNECTION] Warning: reqAccountSummary query failed: {e}")
            # Launch dedicated pulse monitor
            threading.Thread(target=self._heartbeat_pulse, daemon=True).start()
            print("[CONNECTION] Handshake successful. Background listener thread, live account subscription, and heartbeat active.")
        else:
            print("[CONNECTION] 3-point handshake timeout (10s) - Gate 1 locked. Connection not fully established.")
            self.is_connected = False
            try:
                self.disconnect()
            except Exception:
                pass
            if self.auto_reconnect_enabled and not self._is_reconnecting:
                threading.Thread(target=self._reconnect_worker, name="IBKR_Reconnect_Thread", daemon=True).start()

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
        if self._is_reconnecting or self.is_connected:
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
                
                # Rotate client id on retries to bypass lingering broker socket locks (Code 326)
                if attempt > 1:
                    self._client_id = ((self._client_id + 1) % 90) + 10
                self.connect(self._host, self._port, self._client_id)
                
                # Handshake on reconnect
                self._handshake_time_received = False
                thread = threading.Thread(target=self.run, name="IBKR_API_Loop", daemon=True)
                thread.start()
                
                try:
                    self.reqCurrentTime()
                except Exception:
                    pass
                    
                success = False
                for _ in range(100):
                    sv = self.serverVersion() if hasattr(self, 'serverVersion') else None
                    if sv is not None and sv > 0 and len(self.accounts_list) > 0 and self.next_order_id > 0 and self._handshake_time_received:
                        success = True
                        break
                    time.sleep(0.1)
                
                if success:
                    self.is_connected = True
                    self._is_reconnecting = False
                    self._reconnect_delay = 2.0 # Reset backoff
                    try:
                        self.reqAccountSummary(9001, "All", "NetLiquidation,TotalCashValue,AvailableFunds,ExcessLiquidity,BuyingPower,MaintMarginReq")
                    except Exception as e:
                        print(f"[AUTO-RECONNECT] Warning: reqAccountSummary query failed: {e}")
                    print(f"[AUTO-RECONNECT] Reconnection & handshake successful on attempt {attempt}! Live account summary active.")
                    return
                else:
                    raise Exception("Handshake timeout during reconnect")
                    
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
            elif self.trading_mode == "LIVE":
                if acc.startswith("DU"):
                    print(f"[WARNING] Mode is LIVE but detected Paper Account {acc}. Real capital is not deployed on DU accounts.")
                else:
                    print(f"[IBKR ACCOUNTS] Verified Live DMA Account active: {acc}")

    def currentTime(self, time_val: int):
        self._handshake_time_received = True

    def error(self, reqId: int, errorCode: int, errorString: str, advancedOrderRejectJson: str = ""):
        print(f"[GATEWAY ERROR] ReqID: {reqId} | Code: {errorCode} | Message: {errorString}")
        
        # Signal any synchronous request waiting on this reqId
        if hasattr(self, '_request_events') and reqId in self._request_events:
            self._request_results[reqId] = {
                "status": "ERROR",
                "code": errorCode,
                "message": errorString
            }
            self._request_events[reqId].set()
        
        if hasattr(self, '_contract_events') and reqId in self._contract_events:
            self._contract_events[reqId].set()
        
        # IBKR Connectivity Code Handling
        if errorCode == 1100: # Connectivity between IB and TWS lost
            print("[GATEWAY ALERT] IBKR Connectivity Lost (Code 1100). Socket marked offline.")
            self.is_connected = False
        elif errorCode == 326: # Client ID already in use
            self._client_id = ((self._client_id + 1) % 90) + 10
            print(f"[GATEWAY ALERT] Client ID collision (Code 326). Rotated to client ID {self._client_id}.")
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

    def nextValidId(self, orderId: int):
        """Standard IBKR callback initializing the next valid order ID."""
        self.next_order_id = orderId
        print(f"[IBKR GATEWAY] Next valid order ID received from broker: {orderId}")

    def nextOrderId(self) -> int:
        """Atomically allocates and returns the next valid sequence order ID."""
        if not hasattr(self, 'next_order_id') or self.next_order_id is None:
            self.next_order_id = 1
        oid = self.next_order_id
        self.next_order_id += 1
        return oid

    def create_contract(self, symbol: str, sec_type: str = "STK", exchange: str = "SMART", currency: str = "USD") -> Any:
        """Constructs an institutional Contract specification."""
        contract = Contract()
        sym_clean = symbol.upper().strip()
        contract.symbol = sym_clean
        contract.secType = sec_type
        contract.exchange = exchange
        contract.currency = currency
        
        # European Venue Routing: Only enforce European exchanges when EUR is explicitly targeted or European exchange passed
        if currency == "EUR" or exchange in ["IBIS", "SBF", "AEB"]:
            if sym_clean in ["SAP", "RWE"]:
                contract.exchange = "IBIS"
                contract.currency = "EUR"
            elif sym_clean in ["ENGI", "SGO", "AIR", "TTE", "MC"]:
                contract.exchange = "SBF"
                contract.currency = "EUR"
            elif sym_clean in ["ASML"]:
                contract.exchange = "AEB"
                contract.currency = "EUR"
        elif currency == "USD":
            # Cross-listed US ADRs / major US equities: preserve SMART routing with primaryExchange anchor
            if sym_clean in ["TTE", "SAP", "ASML", "RWE", "CAT", "BA", "IBM", "DIS", "JPM", "GE", "XOM"]:
                contract.exchange = "SMART"
                contract.currency = "USD"
                contract.primaryExchange = "NYSE" if sym_clean in ["TTE", "SAP", "CAT", "BA", "IBM", "DIS", "JPM", "GE", "XOM"] else "NASDAQ"
            elif sym_clean in ["NVDA", "AAPL", "MSFT", "GOOG", "GOOGL", "AMZN", "META", "TSLA", "CUE", "ONWD"]:
                contract.exchange = "SMART"
                contract.currency = "USD"
                contract.primaryExchange = "NASDAQ"
        return contract

    def create_market_order(self, action: str, quantity: float) -> Any:
        """Constructs a compliant IBKR Market order (MKT DAY)."""
        order = Order()
        order.action = action.upper().strip()
        order.orderType = "MKT"
        order.totalQuantity = float(quantity)
        order.tif = "DAY"
        return order

    def orderStatus(self, orderId: int, status: str, filled: float, remaining: float, avgFillPrice: float, permId: int, parentId: int, lastFillPrice: float, clientId: int, whyHeld: str, mktCapPrice: float):
        """Tracks live broker order lifecycle state changes (Submitted, Filled, Cancelled)."""
        print(f"[ORDER STATUS] Order #{orderId}: {status} | Filled: {filled} | Remaining: {remaining} @ Avg ${avgFillPrice:.2f}")
        if self.on_order_status_callback:
            self.on_order_status_callback(orderId, status, filled, remaining, avgFillPrice)

    def accountSummary(self, reqId: int, account: str, tag: str, value: str, currency: str):
        """Processes account values (e.g. NetLiquidation, MaintMarginReq) needed for risk screening."""
        self.account_summary["account"] = account
        self.account_summary["currency"] = currency
        try:
            self.account_summary[tag] = float(value)
        except (ValueError, TypeError):
            self.account_summary[tag] = value
        
    def position(self, account: str, contract: Any, position: float, avgCost: float):
        """Tracks active positions across the intraday target catalog directly from broker truth."""
        symbol = contract.symbol
        if position == 0:
            self.active_positions.pop(symbol, None)
            print(f"[BROKER POSITION] {symbol} position is now FLAT (0 shares). Removed from active catalog.")
        else:
            self.active_positions[symbol] = {
                "qty": position,
                "avgCost": avgCost,
                "account": account
            }
            print(f"[BROKER POSITION] {symbol}: {position} shares @ avgCost ${avgCost:.2f} ({account})")

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
        Fail-Closed: Does NOT populate synthetic 1,000,000 shares. Remains strictly broker-provided.
        """
        symbol = self.req_id_to_symbol.get(reqId, "UNKNOWN")
        if symbol not in self.short_availability_cache:
            self.short_availability_cache[symbol] = {}
            
        if tickType == 236: # Shortable Shares
            self.short_availability_cache[symbol]["shares_available"] = float(value)
            print(f"[BORROW MONITOR] {symbol} Shortable Shares Available: {int(value):,}")
        elif tickType == 232: # Borrow Fee Rate %
            self.short_availability_cache[symbol]["borrow_fee_pct"] = float(value)
            print(f"[BORROW MONITOR] {symbol} Borrow Fee Rate: {value:.2f}%")

    # --- REAL-TIME MARKET QUOTE & TICK CALLBACKS ---
    def tickPrice(self, reqId: int, tickType: int, price: float, attrib: Any):
        """Processes real-time market data ticks from IBKR NBBO tape."""
        if reqId not in self._tick_data:
            self._tick_data[reqId] = {}
        type_names = {1: "bid", 2: "ask", 4: "last", 6: "high", 7: "low", 9: "close"}
        tname = type_names.get(tickType, f"tick_{tickType}")
        self._tick_data[reqId][tname] = float(price)
        if self.on_quote_callback:
            sym = self.req_id_to_symbol.get(reqId, "UNKNOWN")
            self.on_quote_callback(sym, tickType, price)

    def tickSize(self, reqId: int, tickType: int, size: Any):
        """Processes real-time market size ticks from IBKR."""
        if reqId not in self._tick_data:
            self._tick_data[reqId] = {}
        type_names = {0: "bid_size", 3: "ask_size", 5: "last_size", 8: "volume"}
        tname = type_names.get(tickType, f"size_{tickType}")
        try:
            self._tick_data[reqId][tname] = float(size)
        except (ValueError, TypeError):
            pass

    def tickSnapshotEnd(self, reqId: int):
        """Fires when snapshot market data collection is finalized."""
        if hasattr(self, '_request_events') and reqId in self._request_events:
            self._request_results[reqId] = self._tick_data.get(reqId, {})
            self._request_events[reqId].set()

    # --- FUNDAMENTAL CORPORATE & EARNINGS CALENDAR CALLBACKS ---
    def fundamentalData(self, reqId: int, data: str):
        """Ingests institutional Reuters corporate event/earnings calendar XML from IBKR."""
        symbol = self.req_id_to_symbol.get(reqId, "UNKNOWN")
        self.fundamental_data_cache[symbol] = data
        if hasattr(self, '_request_events') and reqId in self._request_events:
            self._request_results[reqId] = data
            self._request_events[reqId].set()
        print(f"[EARNINGS/EVENT CALENDAR RECEIVED] {symbol}: Received {len(data)} bytes of structured event disclosures.")

    # --- NEWS & REGULATORY BULLETINS CALLBACKS ---
    def newsBulletin(self, msgId: int, msgType: int, message: str, origExchange: str):
        """Receives live broker news bulletins, regulatory notices, and exchange alerts."""
        bulletin = {
            "msgId": msgId,
            "msgType": msgType,
            "message": message,
            "origExchange": origExchange,
            "timestamp": time.time()
        }
        self.news_bulletins.append(bulletin)
        if len(self.news_bulletins) > 100:
            self.news_bulletins = self.news_bulletins[-100:]
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
        """Signals completion of contract details resolution for reqId."""
        if hasattr(self, '_contract_events') and reqId in self._contract_events:
            self._contract_events[reqId].set()

    def resolve_contract_details_blocking(self, contract: Any, timeout: float = 4.0) -> Optional[Dict[str, Any]]:
        """
        Requests contract details via live socket and blocks until completed or timeout.
        Returns cached dictionary or None.
        """
        if not self.is_connected:
            return None

        if isinstance(contract, str):
            contract = self.create_contract(contract)
        elif isinstance(contract, dict):
            c = self.create_contract(
                symbol=contract.get("symbol", ""),
                sec_type=contract.get("secType", "STK"),
                exchange=contract.get("exchange", "SMART"),
                currency=contract.get("currency", "USD")
            )
            if contract.get("primaryExchange"):
                c.primaryExchange = contract["primaryExchange"]
            contract = c

        if not hasattr(self, '_contract_events'):
            self._contract_events = {}

        import random
        req_id = random.randint(10000, 99999)
        event = threading.Event()
        self._contract_events[req_id] = event

        try:
            self.reqContractDetails(req_id, contract)
            event.wait(timeout)
        except Exception as e:
            print(f"[CONTRACT DETAILS ERR] Failed requesting details for {getattr(contract, 'symbol', 'UNKNOWN')}: {e}")
        finally:
            self._contract_events.pop(req_id, None)

        return self.contract_details_cache.get(getattr(contract, 'symbol', ''))

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
        if hasattr(self, '_request_events') and reqId in self._request_events:
            self._request_results[reqId] = self.historical_data_buffer.get(reqId, [])
            self._request_events[reqId].set()
        if self.on_historical_data_complete_callback:
            self.on_historical_data_complete_callback(reqId, self.historical_data_buffer.get(reqId, []))

    def execute_synchronous_request(self, method_name: str, arguments: Dict[str, Any], timeout: float = 4.0) -> Dict[str, Any]:
        """
        Universal Synchronous Dispatcher for Interactive Brokers Pro API.
        Enables synchronous request/response across asynchronous EWrapper callbacks.
        Zero Synthetic Policy: strictly reports actual broker responses or clear offline status.
        """
        if not self.is_connected:
            return {
                "status": "GATEWAY_OFFLINE",
                "connected": False,
                "message": f"Interactive Brokers Gateway on port {self._port} is offline. Live market data and quotes are unavailable until gateway socket is connected.",
                "source": "Interactive Brokers Official API (ibapi.client.EClient)"
            }

        # Auto-allocate thread-safe unique reqId
        import random
        req_id = arguments.get("reqId") or arguments.get("tickerId") or random.randint(20000, 89999)
        arguments["reqId"] = req_id

        # Normalize symbol / contract
        symbol = arguments.get("symbol")
        contract = arguments.get("contract")
        if isinstance(contract, str):
            symbol = contract
            contract = self.create_contract(contract)
            arguments["contract"] = contract
        elif isinstance(contract, dict):
            symbol = contract.get("symbol", symbol)
            c = self.create_contract(
                symbol=symbol,
                sec_type=contract.get("secType", "STK"),
                exchange=contract.get("exchange", "SMART"),
                currency=contract.get("currency", "USD")
            )
            if contract.get("primaryExchange"):
                c.primaryExchange = contract["primaryExchange"]
            contract = c
            arguments["contract"] = contract
        elif not contract and symbol:
            contract = self.create_contract(symbol)
            arguments["contract"] = contract
        elif hasattr(contract, "symbol") and not symbol:
            symbol = contract.symbol

        if symbol:
            self.req_id_to_symbol[req_id] = symbol.upper().strip()

        event = threading.Event()
        self._request_events[req_id] = event
        self._request_results.pop(req_id, None)

        try:
            # 1. Historical Candlesticks / Official Closes
            if method_name in ["reqHistoricalData", "get_market_quote", "get_historical_bars"]:
                dur = arguments.get("durationStr", "5 D")
                barsize = arguments.get("barSizeSetting", "1 day")
                what = arguments.get("whatToShow", "TRADES")
                use_rth = int(arguments.get("useRTH", 1))
                fmt_date = int(arguments.get("formatDate", 1))
                keep_up = bool(arguments.get("keepUpToDate", False))
                chart_opts = arguments.get("chartOptions", [])

                # Adaptive timeout: 25s for historical bars, else default timeout
                req_timeout = float(arguments.get("timeout", 25.0 if method_name in ["reqHistoricalData", "get_historical_bars"] else timeout))

                self.historical_data_buffer[req_id] = []
                self.reqHistoricalData(req_id, contract, "", dur, barsize, what, use_rth, fmt_date, keep_up, chart_opts)
                event.wait(req_timeout)

                res = self._request_results.get(req_id)
                if isinstance(res, dict) and res.get("status") == "ERROR":
                    return res

                bars = self.historical_data_buffer.get(req_id, [])
                if bars:
                    latest = bars[-1]
                    prior = bars[-2] if len(bars) > 1 else latest
                    l_close = latest.get("close", 0.0)
                    p_close = prior.get("close", 0.0)
                    chg = round(l_close - p_close, 2)
                    chg_pct = round((chg / p_close) * 100, 2) if p_close else 0.0
                    return {
                        "status": "SUCCESS",
                        "symbol": symbol or getattr(contract, "symbol", "UNKNOWN"),
                        "latest_closing_price": l_close,
                        "previous_close": p_close,
                        "change": chg,
                        "change_percent": f"{chg_pct:+.2f}%",
                        "recent_5day_closes": [b.get("close") for b in bars[-5:]],
                        "bars": bars if method_name in ["reqHistoricalData", "get_historical_bars"] else bars[-5:],
                        "total_bars": len(bars),
                        "source": "Interactive Brokers Pro Official Tape",
                        "verified_at": datetime.datetime.now(timezone.utc).isoformat()
                    }
                else:
                    return {
                        "status": "NO_DATA",
                        "symbol": symbol,
                        "message": "IBKR returned empty historical bars for requested symbol/exchange.",
                        "source": "Interactive Brokers Pro Official Tape"
                    }

            # 2. Real-Time Snapshot Quotes (NBBO Tape)
            elif method_name in ["reqMktData", "get_quote_snapshot"]:
                self._tick_data[req_id] = {}
                self.reqMktData(req_id, contract, "", True, False, [])
                event.wait(timeout)
                ticks = self._tick_data.get(req_id, {})
                last_p = ticks.get("last") or ticks.get("close")
                return {
                    "status": "SUCCESS",
                    "symbol": symbol,
                    "ticks": ticks,
                    "last_price": last_p,
                    "bid": ticks.get("bid"),
                    "ask": ticks.get("ask"),
                    "source": "Interactive Brokers Pro Official NBBO Tape",
                    "verified_at": datetime.datetime.now(timezone.utc).isoformat()
                }

            # 3. Fundamental Corporate & Reuters Financial Disclosures
            elif method_name == "reqFundamentalData":
                report_type = arguments.get("reportType", "ReportSnapshot")
                self.reqFundamentalData(req_id, contract, report_type, [])
                event.wait(timeout)
                data = self._request_results.get(req_id)
                return {
                    "status": "SUCCESS" if data else "TIMEOUT",
                    "symbol": symbol,
                    "report_type": report_type,
                    "data": data or "",
                    "source": "Interactive Brokers Pro Reuters/FactSet Data"
                }

            # 4. News Bulletins
            elif method_name == "reqNewsBulletins":
                return {
                    "status": "SUCCESS",
                    "bulletins": self.news_bulletins,
                    "source": "Interactive Brokers Broker Bulletins"
                }

            # 5. Contract Resolution
            elif method_name == "reqContractDetails":
                details = self.resolve_contract_details_blocking(contract, timeout=timeout)
                return {
                    "status": "SUCCESS" if details else "NOT_FOUND",
                    "contract_details": details,
                    "source": "Interactive Brokers Contract Directory"
                }

            # 6. Positions & Account
            elif method_name in ["reqPositions", "get_positions"]:
                return {
                    "status": "SUCCESS",
                    "connected": True,
                    "positions_count": len(self.active_positions),
                    "positions": self.active_positions,
                    "source": "Interactive Brokers Live Portfolio"
                }

            elif method_name in ["reqAccountSummary", "get_account_summary"]:
                return {
                    "status": "SUCCESS",
                    "connected": True,
                    "account_summary": self.account_summary,
                    "accounts": self.accounts_list,
                    "source": "Interactive Brokers Account Registry"
                }

            # Generic method execution on EClient
            else:
                method = getattr(self, method_name, None)
                if not method or not callable(method):
                    return {
                        "status": "UNKNOWN_METHOD",
                        "message": f"Method {method_name} is not available on ConnectionManager or EClient."
                    }
                sig = inspect.signature(method)
                call_args = {}
                for p_name, param in sig.parameters.items():
                    if p_name in ("self", "args", "kwargs"):
                        continue
                    if p_name in arguments:
                        call_args[p_name] = arguments[p_name]
                    elif p_name in ["chartOptions", "mktDataOptions", "scannerSubscriptionFilterOptions"]:
                        call_args[p_name] = []
                    elif p_name == "contract" and "symbol" in arguments:
                        call_args["contract"] = self.create_contract(arguments["symbol"])
                res = method(**call_args)
                return {
                    "status": "SUCCESS",
                    "method": method_name,
                    "result": str(res) if res is not None else "Dispatched to IBKR EClient.",
                    "source": "Interactive Brokers Official API"
                }

        except Exception as e:
            return {
                "status": "EXECUTION_ERROR",
                "method": method_name,
                "error": str(e)
            }
        finally:
            self._request_events.pop(req_id, None)

    def dispatch_tool_call(self, tool_name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """
        Official Tool Execution Dispatcher:
        Directly executes reflected EClient methods or queries institutional caches.
        Zero Synthetic Policy: Never returns mock or simulated confirmations.
        """
        name = (tool_name or "").strip()
        name_lower = name.lower()

        # 1. State & Telemetry Inquiries (Read from authentic local in-memory portfolio buffers)
        if name_lower in ["reqpositions", "get_positions", "reqpositionsmulti"]:
            return {
                "status": "SUCCESS",
                "connected": self.is_connected,
                "positions_count": len(self.active_positions),
                "positions": self.active_positions,
                "trading_mode": getattr(self, "trading_mode", "PAPER")
            }

        elif name_lower in ["reqaccountsummary", "get_account_summary", "reqaccountupdates"]:
            if not self.is_connected:
                return {
                    "status": "GATEWAY_OFFLINE",
                    "code": 504,
                    "message": "IBKR Gateway connection inactive on socket 4001/4002.",
                    "account_summary": self.account_summary
                }
            return {
                "status": "SUCCESS",
                "connected": True,
                "account_summary": self.account_summary,
                "accounts": self.accounts_list
            }

        elif name_lower in ["reqpnl", "get_pnl"]:
            return {
                "status": "SUCCESS",
                "pnl": getattr(self, "pnl_updates", {}),
                "connected": self.is_connected
            }

        elif name_lower in ["reqopenorders", "reqallopenorders", "reqautoopenorders"]:
            return {
                "status": "SUCCESS",
                "connected": self.is_connected,
                "open_orders": getattr(self, "open_orders", {})
            }

        # 2. Synchronous & Network IBKR API Dispatch via EClient
        if hasattr(self, name) and callable(getattr(self, name)):
            if not self.is_connected:
                return {
                    "status": "GATEWAY_OFFLINE",
                    "code": 504,
                    "tool": name,
                    "error": f"Cannot execute {name}: IBKR Gateway is not connected."
                }
            return self.execute_synchronous_request(name, arguments)

        return {
            "status": "UNKNOWN_METHOD",
            "tool": name,
            "error": f"Method {name} is not recognized on ConnectionManager or EClient."
        }

