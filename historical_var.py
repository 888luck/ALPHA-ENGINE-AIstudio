import numpy as np
import logging
from typing import Dict, Any, List

logger = logging.getLogger("AlphaEngine.VAR")

class HistoricalVAR:
    """
    Historical Value at Risk (VaR) Engine.
    Uses 250-day lookback of asset returns to estimate the maximum expected loss 
    at a 99% confidence interval.
    """
    def __init__(self, confidence_interval: float = 0.99, lookback_days: int = 250):
        self.confidence_interval = confidence_interval
        self.lookback_days = lookback_days

    def calculate_var(self, positions: Dict[str, Dict[str, Any]], price_history: Dict[str, List[float]]) -> float:
        """
        Calculates Portfolio VaR using historical simulation.
        positions: dict of symbol -> {"qty": float, "avgCost": float}
        price_history: dict of symbol -> list of historical prices (ideally last 250 days)
        """
        total_var = 0.0
        
        for sym, pos in positions.items():
            qty = abs(float(pos.get("qty", 0.0)))
            if qty == 0:
                continue
                
            prices = price_history.get(sym, [])
            if len(prices) < 2:
                # Fallback to rough estimate if history is insufficient
                notional = qty * float(pos.get("avgCost", 0.0))
                estimated_var = notional * 0.05 # 5% fallback VaR
                total_var += estimated_var
                logger.warning(f"[VAR ENGINE] Insufficient price history for {sym}. Using 5% fallback VaR: ${estimated_var:.2f}")
                continue
                
            # Convert list of prices to numpy array
            price_arr = np.array(prices)
            
            # Calculate daily returns: (P_t / P_t-1) - 1
            returns = (price_arr[1:] / price_arr[:-1]) - 1
            
            # Find the percentile for the confidence interval (e.g., 1st percentile for 99% VaR)
            percentile = (1 - self.confidence_interval) * 100
            
            # The historical simulated worst return
            worst_expected_return = np.percentile(returns, percentile)
            
            # VaR = Position Notional * |worst_expected_return|
            current_price = price_arr[-1]
            notional = qty * current_price
            
            var = notional * abs(worst_expected_return)
            total_var += var
            
            logger.info(f"[VAR ENGINE] {sym} | Notional: ${notional:.2f} | 99% worst return: {worst_expected_return*100:.2f}% | Component VaR: ${var:.2f}")
            
        logger.info(f"[VAR ENGINE] Total Portfolio Historical 99% VaR: ${total_var:.2f}")
        return total_var
