import time
import math
import logging
from typing import Dict, Any, Optional
from datetime import datetime, timezone
from universe_models import NewsEvent

logger = logging.getLogger("AlphaEngine.TCA")

class TCAEngine:
    """
    Transaction Cost Analysis (TCA) Engine.
    Calculates Implementation Shortfall (Slippage in bps) between the arrival price 
    (mid-point when decision was made) and actual execution fill price.
    """
    def __init__(self, firebase_tunnel=None):
        self.firebase = firebase_tunnel
        self.arrival_prices: Dict[str, float] = {}

    def snapshot_arrival(self, symbol: str, current_price: float):
        """Records the arrival price exactly when the algo decides to trade."""
        self.arrival_prices[symbol] = current_price
        logger.info(f"[TCA] Arrival snapshot for {symbol} @ ${current_price:.2f}")

    def calculate_implementation_shortfall(self, symbol: str, fill_price: float, side: str) -> float:
        arrival = self.arrival_prices.get(symbol)
        if not arrival:
            return 0.0

        if side.upper() == "BUY":
            slippage_bps = ((fill_price - arrival) / arrival) * 10000
        else:
            slippage_bps = ((arrival - fill_price) / arrival) * 10000
            
        return slippage_bps

    def on_fill(self, symbol: str, execution: Any):
        """Callback bound to IBKR execDetails."""
        side = execution.side
        fill_price = execution.price
        qty = execution.shares
        
        slippage_bps = self.calculate_implementation_shortfall(symbol, fill_price, side)
        
        logger.info(f"[TCA] {symbol} {side} {qty} @ ${fill_price:.2f} | Slippage: {slippage_bps:.1f} bps")
        
        # Log to Firestore for UI Blotter
        if self.firebase:
            trade_data = {
                "symbol": symbol,
                "side": side,
                "qty": qty,
                "fill_price": fill_price,
                "arrival_price": self.arrival_prices.get(symbol, fill_price),
                "slippage_bps": slippage_bps,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "execId": execution.execId
            }
            self.firebase.push_historical_log(f"TCA_{execution.execId}", {"event": "TRADE_EXECUTION", "tca": trade_data})
