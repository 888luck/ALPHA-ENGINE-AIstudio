import os
import pytest
from connection import ConnectionManager
from risk_engine import DRMMiddleware, SyntheticStopManager

class MockBroker(ConnectionManager):
    """Mock connection manager for offline regression testing of risk gates."""
    def __init__(self):
        super().__init__(trading_mode="PAPER")
        self.orders_placed = []
        self.cancels_called = 0
        self.next_order_id = 101

    def placeOrder(self, orderId, contract, order):
        self.orders_placed.append({
            "orderId": orderId,
            "symbol": contract.symbol,
            "action": order.action,
            "qty": order.totalQuantity,
            "orderType": order.orderType
        })

    def reqGlobalCancel(self):
        self.cancels_called += 1

def test_risk_hierarchy_math():
    """Validates that per-trade risk is 0.25% and daily max loss is strictly 4r ($1,000 on $100k)."""
    broker = MockBroker()
    broker.account_summary["NetLiquidation"] = 100000.0
    drm = DRMMiddleware(broker, params={"start_day_equity": 100000.0})
    
    assert drm.max_trade_risk_pct == 0.0025
    assert drm.daily_max_loss_cutoff == 1000.0 # 4 * ($100,000 * 0.0025)
    
    # Position sizing test: $100 entry, $98 stop -> $2 stop distance.
    # Risk capital r = $250. Qty = 250 / 2 = 125 shares.
    qty = drm.calculate_position_size(entry_price=100.0, initial_stop=98.0)
    assert qty == 125.0
    
    # Futures multiplier test (e.g., NQ multiplier = 20):
    # Stop distance = 10 points. Risk = 10 * 20 = $200 per contract.
    # r = $250 -> floor(250 / 200) = 1 contract.
    futures_qty = drm.calculate_position_size(entry_price=18000.0, initial_stop=17990.0, multiplier=20.0)
    assert futures_qty == 1.0

def test_emergency_flush_real_orders_and_no_local_zeroing():
    """Validates that emergency_flush() sends real MKT liquidation orders to IBKR and does NOT zero local state."""
    broker = MockBroker()
    broker.active_positions["AAPL"] = {"qty": 100.0, "avgCost": 150.0}
    broker.active_positions["MSFT"] = {"qty": -50.0, "avgCost": 300.0}
    
    drm = DRMMiddleware(broker)
    drm.emergency_flush()
    
    # Verify global cancel was invoked
    assert broker.cancels_called == 1
    
    # Verify real orders were placed
    assert len(broker.orders_placed) == 2
    aapl_order = next(o for o in broker.orders_placed if o["symbol"] == "AAPL")
    msft_order = next(o for o in broker.orders_placed if o["symbol"] == "MSFT")
    
    assert aapl_order["action"] == "SELL"
    assert aapl_order["qty"] == 100.0
    assert aapl_order["orderType"] == "MKT"
    
    assert msft_order["action"] == "BUY"
    assert msft_order["qty"] == 50.0
    assert msft_order["orderType"] == "MKT"
    
    # Verify active_positions was NOT zeroed locally (must await broker callbacks)
    assert broker.active_positions["AAPL"]["qty"] == 100.0
    assert broker.active_positions["MSFT"]["qty"] == -50.0
    assert drm.router_locked is True

def test_unlock_router_authorization():
    """Validates that unlock_router() rejects unauthorized calls and requires OPERATOR_ADMIN_KEY."""
    broker = MockBroker()
    drm = DRMMiddleware(broker)
    drm.router_locked = True
    
    os.environ["OPERATOR_ADMIN_KEY"] = "SECURE_INSTITUTIONAL_KEY_774"
    
    # 1. Empty key fails
    assert drm.unlock_router("") is False
    assert drm.router_locked is True
    
    # 2. Wrong key fails
    assert drm.unlock_router("WRONG_KEY") is False
    assert drm.router_locked is True
    
    # 3. Correct key succeeds
    assert drm.unlock_router("SECURE_INSTITUTIONAL_KEY_774") is True
    assert drm.router_locked is False

def test_gate_3_volume_cap_fail_closed():
    """Gate 3 must reject orders when 5m rolling volume is unavailable or zero (Fail-Closed)."""
    broker = MockBroker()
    drm = DRMMiddleware(broker)
    
    # Volume is 0.0 -> REJECT
    result_zero = drm.check_pre_trade_gateway("AAPL", "BUY", requested_qty=10, price=150.0, rolling_5m_volume=0.0)
    assert result_zero["approved"] is False
    assert "Fail-Closed" in result_zero["reason"]
    
    # Volume is negative -> REJECT
    result_neg = drm.check_pre_trade_gateway("AAPL", "BUY", requested_qty=10, price=150.0, rolling_5m_volume=-100.0)
    assert result_neg["approved"] is False
    
    # Adequate volume -> PASSES Gate 3 (10 shares is well below 1.5% of 100,000 = 1500)
    # Initialize binary calendar so Gate 5 doesn't block
    broker.binary_event_schedule = {}
    result_valid = drm.check_pre_trade_gateway("AAPL", "BUY", requested_qty=10, price=150.0, rolling_5m_volume=100000.0)
    assert result_valid["approved"] is True

def test_gate_4_short_locate_fail_closed():
    """Gate 4 must reject short orders if borrow cache is absent or inadequate (Fail-Closed)."""
    broker = MockBroker()
    broker.binary_event_schedule = {}
    drm = DRMMiddleware(broker)
    
    # Short locate not in cache -> REJECT
    result_no_cache = drm.check_pre_trade_gateway("TSLA", "SHORT", requested_qty=50, price=200.0, rolling_5m_volume=50000.0)
    assert result_no_cache["approved"] is False
    assert "Fail-Closed" in result_no_cache["reason"]
    
    # Short locate has only 20 shares available when 50 requested -> REJECT
    broker.short_availability_cache["TSLA"] = {"shares_available": 20, "borrow_fee_pct": 1.5}
    result_insufficient = drm.check_pre_trade_gateway("TSLA", "SHORT", requested_qty=50, price=200.0, rolling_5m_volume=50000.0)
    assert result_insufficient["approved"] is False
    assert "only 20 shares available" in result_insufficient["reason"]
    
    # Short locate has borrow fee 25% > 15% max threshold -> REJECT
    broker.short_availability_cache["TSLA"] = {"shares_available": 1000, "borrow_fee_pct": 25.0}
    result_high_fee = drm.check_pre_trade_gateway("TSLA", "SHORT", requested_qty=50, price=200.0, rolling_5m_volume=50000.0)
    assert result_high_fee["approved"] is False
    assert "exceeds max allowable threshold" in result_high_fee["reason"]

def test_gate_5_binary_event_blackout_fail_closed():
    """Gate 5 must reject orders if binary schedule is uninitialized (Fail-Closed)."""
    broker = MockBroker()
    # broker.binary_event_schedule is not set
    drm = DRMMiddleware(broker)
    
    result = drm.check_pre_trade_gateway("NVDA", "BUY", requested_qty=10, price=120.0, rolling_5m_volume=100000.0)
    assert result["approved"] is False
    assert "Fail-Closed" in result["reason"]

def test_wilder_atr_rma():
    """Wilder's ATR RMA requires >= 14 bars and computes exponential smoothing correctly."""
    broker = MockBroker()
    drm = DRMMiddleware(broker)
    
    # Fewer than 14 bars returns 0.0 (refusal)
    short_bars = [{"high": 102.0, "low": 98.0, "close": 100.0} for _ in range(5)]
    assert drm.calculate_atr14(short_bars, current_price=100.0) == 0.0
    
    # 20 bars with constant H=102, L=98, C=100 -> TR is always 4.0 -> ATR = 4.0
    valid_bars = [{"high": 102.0, "low": 98.0, "close": 100.0} for _ in range(20)]
    atr = drm.calculate_atr14(valid_bars, current_price=100.0)
    assert atr == 4.0

if __name__ == "__main__":
    pytest.main(["-v", __file__])
