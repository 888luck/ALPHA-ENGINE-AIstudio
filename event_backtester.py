import json
import os
import math
import logging
from typing import List, Dict, Any, Optional
from datetime import datetime, timezone
import numpy as np

from universe_models import NewsEvent, EnsembleResult
from llm_ensemble import MultiModelEnsemble

logger = logging.getLogger("AlphaEngine.Backtester")

class EventStudyBacktester:
    """
    Tier A Event-Study Backtester
    Measures the true alpha generation capability of the LLM Critic-Verifier ensemble 
    against historical catalyst events.
    """
    def __init__(self, ensemble: MultiModelEnsemble, friction_bps: float = 5.0):
        self.ensemble = ensemble
        self.friction_bps = friction_bps
        self.results = []
        
    def calculate_brier_score(self, forecasts: List[float], outcomes: List[int]) -> float:
        """
        Calculates the Brier score for confidence calibration.
        forecasts: Array of predicted probabilities (0.0 to 1.0)
        outcomes: Array of actual binary outcomes (1 for hit, 0 for miss)
        """
        if not forecasts or len(forecasts) != len(outcomes):
            return 0.0
        
        forecasts_np = np.array(forecasts)
        outcomes_np = np.array(outcomes)
        
        brier_score = np.mean((forecasts_np - outcomes_np) ** 2)
        return brier_score

    def calculate_excursions(self, entry_price: float, price_series: List[float], direction: str) -> Dict[str, float]:
        """
        Calculates Maximum Favorable Excursion (MFE) and Maximum Adverse Excursion (MAE).
        price_series: The sequence of price points (e.g., minute-by-minute) after execution.
        """
        if not price_series:
            return {"mfe_pct": 0.0, "mae_pct": 0.0, "final_pct": 0.0}
            
        prices = np.array(price_series)
        
        if direction == "BULLISH":
            max_price = np.max(prices)
            min_price = np.min(prices)
            final_price = prices[-1]
            
            mfe_pct = (max_price - entry_price) / entry_price
            mae_pct = (min_price - entry_price) / entry_price
            final_pct = (final_price - entry_price) / entry_price
        else:
            # Bearish / Short
            min_price = np.min(prices)
            max_price = np.max(prices)
            final_price = prices[-1]
            
            mfe_pct = (entry_price - min_price) / entry_price
            mae_pct = (entry_price - max_price) / entry_price
            final_pct = (entry_price - final_price) / entry_price
            
        return {
            "mfe_pct": mfe_pct * 100,
            "mae_pct": mae_pct * 100,
            "final_pct": final_pct * 100
        }

    def run_backtest(self, historical_events: List[Dict[str, Any]]):
        """
        Executes the backtest across a dataset of historical events.
        Dataset Format:
        [
            {
                "event": NewsEvent,
                "target_symbol": "NVDA",
                "entry_price": 100.0,
                "price_series": [100.5, 101.2, 102.5, 99.8, 103.0] # Subsequent 15-min or 2-hour prices
            }, ...
        ]
        """
        forecasts = []
        outcomes = []
        hits = 0
        total_valid = 0
        
        logger.info(f"[BACKTESTER] Starting Tier A Backtest on {len(historical_events)} historical events...")
        
        for record in historical_events:
            event_obj = record["event"]
            target_symbol = record["target_symbol"]
            entry_price = record["entry_price"]
            price_series = record["price_series"]
            
            # 1. Run LLM Prediction
            result: EnsembleResult = self.ensemble.evaluate_event(event_obj)
            
            if not result or not result.accepted or not result.classification:
                logger.info(f"[BACKTESTER] Event {event_obj.event_id} rejected by ensemble.")
                continue
                
            # Extract direction for the target symbol (or overall if sector impact matches)
            direction = None
            for impact in result.classification.sector_impacts:
                if impact.direction in ["BULLISH", "BEARISH"]:
                    direction = impact.direction
                    break
                    
            if not direction:
                continue
                
            total_valid += 1
            confidence = result.final_confidence
            
            # 2. Calculate MFE / MAE & Friction
            excursions = self.calculate_excursions(entry_price, price_series, direction)
            
            # Friction adjustment
            net_final_pct = excursions["final_pct"] - (self.friction_bps / 100.0)
            
            # 3. Determine if Hit or Miss (Net profitability)
            is_hit = 1 if net_final_pct > 0 else 0
            hits += is_hit
            
            forecasts.append(confidence)
            outcomes.append(is_hit)
            
            self.results.append({
                "event_id": event_obj.event_id,
                "symbol": target_symbol,
                "predicted_direction": direction,
                "confidence": confidence,
                "mfe_pct": excursions["mfe_pct"],
                "mae_pct": excursions["mae_pct"],
                "net_final_pct": net_final_pct,
                "is_hit": is_hit
            })
            
            logger.info(f"[BACKTESTER] {target_symbol} | Pred: {direction} ({confidence*100:.1f}%) | MFE: {excursions['mfe_pct']:.2f}% | MAE: {excursions['mae_pct']:.2f}% | Net: {net_final_pct:.2f}%")
            
        # 4. Final Aggregation
        hit_rate = (hits / total_valid) * 100 if total_valid > 0 else 0.0
        brier = self.calculate_brier_score(forecasts, outcomes)
        
        avg_mfe = np.mean([r["mfe_pct"] for r in self.results]) if self.results else 0.0
        avg_mae = np.mean([r["mae_pct"] for r in self.results]) if self.results else 0.0
        avg_net = np.mean([r["net_final_pct"] for r in self.results]) if self.results else 0.0
        
        print("\n==============================================================")
        print("          TIER A EVENT-STUDY BACKTEST RESULTS                 ")
        print("==============================================================")
        print(f"Total Events Evaluated: {len(historical_events)}")
        print(f"Total Valid Triggers:   {total_valid}")
        print(f"Directional Hit Rate:   {hit_rate:.2f}%")
        print(f"Brier Score (Calib):    {brier:.4f} (Closer to 0 is better)")
        print(f"Average MFE:            +{avg_mfe:.2f}%")
        print(f"Average MAE:            {avg_mae:.2f}%")
        print(f"Average Net (w/ Frict): {avg_net:.2f}%")
        print("==============================================================\n")
        
        return {
            "hit_rate": hit_rate,
            "brier_score": brier,
            "avg_mfe": avg_mfe,
            "avg_mae": avg_mae,
            "avg_net": avg_net
        }
