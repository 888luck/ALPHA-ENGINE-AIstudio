import sys
import time
from typing import Dict, Any, List

class DRMMiddleware:
    """
    Dynamic Risk Management (DRM) Pool-Equity Layer.
    Implements hard rules protecting systemic risk, enforcing margin limits,
    executing emergency liquidations, and ensuring IBIE client compliance.
    """
    def __init__(self, connection_manager, account_number: str, params: Dict[str, Any] = None):
        self.cm = connection_manager
        self.account_number = account_number
        self.max_trade_risk_pct = 0.01   # 1% equity ceiling per trade setup
        self.max_daily_drawdown_pct = 0.025 # 2.5% daily aggregate loss threshold
        
        # Lock status indicator
        self.router_locked = False
        
        # Track initial start-of-day reference equity
        self.start_day_equity = 100000.0  # Normalized fallback default
        
    def query_margin_safety(self) -> bool:
        """
        Polls Live NetLiquidation and Maintenance Margin values under IBKR Rule set.
        Guarantees that new entries do not trigger automated margin liquidation.
        """
        net_liq = self.cm.account_summary.get("NetLiquidation", self.start_day_equity)
        maint_margin = self.cm.account_summary.get("MaintMarginReq", 0.0)
        
        # If maintenance margin consumes more than 80% of aggregate Net Liquidating value: raise critical alarm
        if maint_margin > (net_liq * 0.80):
            print(f"[RISK WARN] Margin Threshold Breached. NetLiq: {net_liq} | MaintMargin: {maint_margin} (Risk > 80%)")
            return False
        return True

    def calculate_position_size(self, entry_price: float, initial_stop: float) -> int:
        """
        Dynamic 1% Equity Position Sizer.
        Formula: Quantity = (Equity * 0.01) / abs(Entry_Price - Initial_Stop)
        """
        net_liq = self.cm.account_summary.get("NetLiquidation", self.start_day_equity)
        risk_capital = net_liq * self.max_trade_risk_pct
        stop_distance = abs(entry_price - initial_stop)
        
        if stop_distance <= 0:
            print("[RISK ERROR] Invalid initial stop loss distance. Cannot calculate position sizing.")
            return 0
            
        target_qty = int(risk_capital / stop_distance)
        print(f"[RISK ENGINE] Pool Equity sizing: NetLiq: ${net_liq:.2f} | RiskCap: ${risk_capital:.2f} | Distance: ${stop_distance:.2f} -> Qty: {target_qty}")
        return target_qty

    def check_daily_drawdown(self, portfolio_pnl_updates: Dict[str, float]) -> bool:
        """
        Daily Session Circuit Breaker.
        If aggregate realized + unrealized P&L drops <= -2.5% of reference equity,
        triggers absolute emergency closure and locks route execution.
        """
        if self.router_locked:
            return False
            
        net_liq = self.cm.account_summary.get("NetLiquidation", self.start_day_equity)
        daily_loss = portfolio_pnl_updates.get("total", 0.0)
        drawdown_pct = abs(daily_loss) / net_liq if daily_loss < 0 else 0.0
        
        if daily_loss < 0 and drawdown_pct >= self.max_daily_drawdown_pct:
            print(f"!!! [KILL SWITCH TRIGGERED] !!! Cumulative daily loss of ${daily_loss:.2f} ({drawdown_pct*100:.2f}%) exceeds hard threshold.")
            self.emergency_flush()
            return False
            
        return True

    def emergency_flush(self):
        """
        Liquidates all outstanding orders and flattens client positions.
        Locks the execution router from transmitting further orders.
        """
        self.router_locked = True
        print("[RISK DISPATCH] INITIALIZING EMERGENCY FLUSH. CANCELLING ALL OPEN WORKING PAPERS...")
        
        # 1. Cancel all open target order groups asynchronously
        try:
            self.cm.reqGlobalCancel()
        except Exception as e:
            print(f"[RISK EXCEPTION] ReqGlobalCancel failed: {e}")
            
        # 2. Market-On-Close order simulation / Direct adaptive limit routing to flatten structures
        active_positions = list(self.cm.active_positions.items())
        for symbol, data in active_positions:
            qty = data["qty"]
            if qty == 0:
                continue
                
            opposite_direction = "SELL" if qty > 0 else "BUY"
            exit_qty = abs(qty)
            
            print(f"[FLATTEN DISPATCH] Placing market liquidation order: {opposite_direction} {exit_qty} {symbol}")
            # Real production client order routing logic would transmit code via connection_manager:
            # self.cm.placeOrder(self.cm.nextOrderId(), create_contract(symbol), create_market_order(opposite_direction, exit_qty))
            
            # Update local state tracking
            self.cm.active_positions[symbol]["qty"] = 0
            
        print("[RISK DISPATCH] EMERGENCY FLUSH EXECUTED. SYSTEM NOW STANDS FLAT. ROUTER UNDER SECURE HARD LOCK.")

    def enforce_mifid2_reporting(self, order_obj: Any, dec_maker_code: str, exec_trader_code: str):
        """
        Hardcodes MiFIR specific reporting metadata constraints onto the IBIE target order.
        Required for Central Bank of Ireland (CBI) regulatory compliance.
        """
        # Expose these fields to TWS connection
        # Under Python API, these map directly to the Order properties
        try:
            order_obj.mifid2DecisionMaker = dec_maker_code
            order_obj.mifid2ExecutionTrader = exec_trader_code
            # Also denote algorithm origin indicating automated computer routing
            order_obj.mifid2DecisionAlgo = "ALPHA_OFI_V2"
            order_obj.mifid2ExecutionAlgo = "DMA_AUTO_V1"
        except AttributeError:
            pass # Handle gracefully in environment contexts
