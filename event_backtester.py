"""
Event Study Backtester (Tier A Reasoning Backtester) for Alpha Engine.
Evaluates AI catalyst predictions against historical price excursion metrics:
- Directional Hit Rate (whether actual move matched predicted BUY/SELL bias)
- Maximum Favorable Excursion (MFE) and Maximum Adverse Excursion (MAE)
- Brier Calibration Score: measures probability calibration of ensemble confidence
- Category Attribution: groups accuracy by event type (macro, earnings, central bank, geopolitical)
- Friction Drag: compares gross move vs IBIE execution costs
"""

import math
import json
import logging
from typing import List, Dict, Any, Optional, Tuple
from dataclasses import dataclass, field
from datetime import datetime

from universe_models import NewsEvent, ClassifiedEvent, SectorImpact, RankedCandidate

logger = logging.getLogger("AlphaEngine.EventBacktester")
if not logger.handlers:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")


@dataclass
class EventStudyObservation:
    """Represents a single historical event-prediction-outcome pair."""
    event_id: str
    event_type: str
    headline: str
    symbol: str
    predicted_direction: str  # 'BUY' or 'SELL'
    predicted_confidence: float  # 0.0 to 1.0
    entry_price: float
    mfe_price: float          # Max Favorable Excursion price in window
    mae_price: float          # Max Adverse Excursion price in window
    exit_price: float         # Price at evaluation horizon
    holding_hours: float
    commission_cost: float = 1.50
    is_european: bool = False


@dataclass
class EventBacktestMetrics:
    total_events: int
    directional_hit_rate: float     # Percentage (0-100)
    brier_score: float              # 0.0 (perfect) to 1.0 (poor)
    avg_mfe_pct: float              # Average Maximum Favorable Excursion %
    avg_mae_pct: float              # Average Maximum Adverse Excursion %
    profit_factor: float            # Gross Wins / Gross Losses
    total_net_pnl: float
    by_category: Dict[str, Dict[str, Any]] = field(default_factory=dict)


class EventStudyBacktester:
    """
    Tier A Reasoning Backtester.
    Quantifies predictive edge and calibration of the multi-model intelligence pipeline.
    """

    def __init__(self, friction_threshold_pct: float = 15.0):
        self.friction_threshold_pct = friction_threshold_pct

    def evaluate_study(self, observations: List[EventStudyObservation]) -> EventBacktestMetrics:
        """
        Calculates institutional attribution metrics across all historical observations.
        """
        if not observations:
            return EventBacktestMetrics(
                total_events=0,
                directional_hit_rate=0.0,
                brier_score=0.0,
                avg_mfe_pct=0.0,
                avg_mae_pct=0.0,
                profit_factor=0.0,
                total_net_pnl=0.0
            )

        correct_hits = 0
        brier_sum = 0.0
        mfe_pct_sum = 0.0
        mae_pct_sum = 0.0
        gross_wins = 0.0
        gross_losses = 0.0
        total_net_pnl = 0.0

        categories: Dict[str, Dict[str, Any]] = {}

        for obs in observations:
            cat = obs.event_type
            if cat not in categories:
                categories[cat] = {
                    "count": 0,
                    "hits": 0,
                    "brier_sum": 0.0,
                    "gross_pnl": 0.0
                }
            categories[cat]["count"] += 1

            # Determine directional success
            is_buy = obs.predicted_direction.upper() == "BUY"
            pct_return = ((obs.exit_price - obs.entry_price) / obs.entry_price) if is_buy else ((obs.entry_price - obs.exit_price) / obs.entry_price)
            
            # Hit if directional return is positive
            is_hit = pct_return > 0
            if is_hit:
                correct_hits += 1
                categories[cat]["hits"] += 1

            # Brier Score: (predicted_probability - outcome)^2
            # For BUY: outcome is 1 if positive, 0 if negative
            outcome = 1.0 if is_hit else 0.0
            brier_diff = (obs.predicted_confidence - outcome) ** 2
            brier_sum += brier_diff
            categories[cat]["brier_sum"] += brier_diff

            # MFE and MAE calculations
            if is_buy:
                mfe_pct = max(0.0, (obs.mfe_price - obs.entry_price) / obs.entry_price) * 100.0
                mae_pct = max(0.0, (obs.entry_price - obs.mae_price) / obs.entry_price) * 100.0
            else:
                mfe_pct = max(0.0, (obs.entry_price - obs.mfe_price) / obs.entry_price) * 100.0
                mae_pct = max(0.0, (obs.mae_price - obs.entry_price) / obs.entry_price) * 100.0

            mfe_pct_sum += mfe_pct
            mae_pct_sum += mae_pct

            # Normalized PnL ($10,000 risk unit per position)
            position_size = 100.0
            dollar_move = (obs.exit_price - obs.entry_price) if is_buy else (obs.entry_price - obs.exit_price)
            gross_pnl = dollar_move * position_size
            net_pnl = gross_pnl - obs.commission_cost
            total_net_pnl += net_pnl
            categories[cat]["gross_pnl"] += net_pnl

            if net_pnl > 0:
                gross_wins += net_pnl
            else:
                gross_losses += abs(net_pnl)

        n = len(observations)
        hit_rate = (correct_hits / n) * 100.0
        avg_brier = brier_sum / n
        avg_mfe = mfe_pct_sum / n
        avg_mae = mae_pct_sum / n
        profit_factor = (gross_wins / gross_losses) if gross_losses > 0 else (99.0 if gross_wins > 0 else 0.0)

        # Build category breakdown
        by_category = {}
        for cat, data in categories.items():
            cnt = data["count"]
            by_category[cat] = {
                "events": cnt,
                "hit_rate_pct": round((data["hits"] / cnt) * 100.0, 1) if cnt > 0 else 0.0,
                "brier_score": round(data["brier_sum"] / cnt, 4) if cnt > 0 else 0.0,
                "net_pnl": round(data["gross_pnl"], 2)
            }

        return EventBacktestMetrics(
            total_events=n,
            directional_hit_rate=round(hit_rate, 2),
            brier_score=round(avg_brier, 4),
            avg_mfe_pct=round(avg_mfe, 2),
            avg_mae_pct=round(avg_mae, 2),
            profit_factor=round(profit_factor, 2),
            total_net_pnl=round(total_net_pnl, 2),
            by_category=by_category
        )

    def generate_synthetic_study_sample(self) -> List[EventStudyObservation]:
        """
        Generates realistic representative event observations covering US and European markets.
        Used for verification and benchmarking when historical IBKR tick database is offline.
        """
        return [
            EventStudyObservation(
                event_id="EVT_MACRO_001",
                event_type="macro",
                headline="US Core CPI rises 0.1% below expectations; yields drop",
                symbol="TLT",
                predicted_direction="BUY",
                predicted_confidence=0.75,
                entry_price=92.50,
                mfe_price=94.10,
                mae_price=92.20,
                exit_price=93.80,
                holding_hours=6.5,
                commission_cost=1.00,
                is_european=False
            ),
            EventStudyObservation(
                event_id="EVT_ENERGY_002",
                event_type="geopolitical",
                headline="OPEC+ announces surprise supply restriction of 1M bpd",
                symbol="XLE",
                predicted_direction="BUY",
                predicted_confidence=0.82,
                entry_price=88.40,
                mfe_price=90.60,
                mae_price=88.10,
                exit_price=90.25,
                holding_hours=6.5,
                commission_cost=1.00,
                is_european=False
            ),
            EventStudyObservation(
                event_id="EVT_TECH_003",
                event_type="earnings",
                headline="NVIDIA delivers record data center revenue and raises guidance",
                symbol="NVDA",
                predicted_direction="BUY",
                predicted_confidence=0.88,
                entry_price=124.00,
                mfe_price=129.50,
                mae_price=123.40,
                exit_price=128.20,
                holding_hours=6.5,
                commission_cost=1.00,
                is_european=False
            ),
            EventStudyObservation(
                event_id="EVT_EU_004",
                event_type="central_bank",
                headline="ECB cuts deposit facility rate by 25bps as eurozone disinflation continues",
                symbol="SAP",
                predicted_direction="BUY",
                predicted_confidence=0.70,
                entry_price=182.00,
                mfe_price=185.40,
                mae_price=181.20,
                exit_price=184.50,
                holding_hours=8.0,
                commission_cost=3.00,
                is_european=True
            ),
            EventStudyObservation(
                event_id="EVT_SEMIS_005",
                event_type="press_release",
                headline="ASML reports high NA EUV shipments ahead of schedule",
                symbol="ASML",
                predicted_direction="BUY",
                predicted_confidence=0.78,
                entry_price=740.00,
                mfe_price=758.00,
                mae_price=736.00,
                exit_price=752.00,
                holding_hours=8.0,
                commission_cost=3.00,
                is_european=True
            ),
            EventStudyObservation(
                event_id="EVT_DEFENSE_006",
                event_type="geopolitical",
                headline="NATO members pledge expanded multi-year air defense contracts",
                symbol="AIR",
                predicted_direction="BUY",
                predicted_confidence=0.72,
                entry_price=145.00,
                mfe_price=148.50,
                mae_price=144.30,
                exit_price=147.80,
                holding_hours=8.0,
                commission_cost=3.00,
                is_european=True
            ),
            EventStudyObservation(
                event_id="EVT_RATES_007",
                event_type="macro",
                headline="Hawkish comments from Fed officials dampen rate cut probabilities",
                symbol="SPY",
                predicted_direction="SELL",
                predicted_confidence=0.65,
                entry_price=560.00,
                mfe_price=555.20,
                mae_price=561.30,
                exit_price=556.80,
                holding_hours=6.5,
                commission_cost=1.00,
                is_european=False
            )
        ]
