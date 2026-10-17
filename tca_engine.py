import time
import os
import json
import logging
from typing import Dict, Any, Optional, List
from datetime import datetime, timezone

logger = logging.getLogger("AlphaEngine.TCA")

class TCAEngine:
    """
    Transaction Cost Analysis (TCA) Engine.
    Calculates Implementation Shortfall (Slippage in bps) between the arrival price 
    (mid-point when decision was made) and actual execution fill price.
    Persists audit telemetry locally with zero cloud dependencies.
    """
    def __init__(self, log_path: str = "tca_executions.json"):
        self.log_path = log_path
        self.arrival_prices: Dict[str, float] = {}
        self.execution_history: List[Dict[str, Any]] = []

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
        side = getattr(execution, "side", "BOT")
        fill_price = getattr(execution, "price", 0.0)
        qty = getattr(execution, "shares", 0.0)
        exec_id = getattr(execution, "execId", str(time.time()))
        
        slippage_bps = self.calculate_implementation_shortfall(symbol, fill_price, side)
        logger.info(f"[TCA] {symbol} {side} {qty} @ ${fill_price:.2f} | Slippage: {slippage_bps:.1f} bps")
        
        trade_data = {
            "symbol": symbol,
            "side": side,
            "qty": qty,
            "fill_price": fill_price,
            "arrival_price": self.arrival_prices.get(symbol, fill_price),
            "slippage_bps": round(slippage_bps, 2),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "execId": exec_id
        }
        self.execution_history.append(trade_data)
        self._append_to_disk(trade_data)

    def _append_to_disk(self, record: Dict[str, Any]):
        try:
            records = []
            if os.path.exists(self.log_path):
                with open(self.log_path, "r", encoding="utf-8") as f:
                    records = json.load(f)
            records.append(record)
            if len(records) > 200:
                records = records[-200:]
            with open(self.log_path, "w", encoding="utf-8") as f:
                json.dump(records, f, indent=2)
        except Exception as e:
            logger.warning(f"Could not persist TCA record: {e}")
