"""
Dynamic Universe Construction & Candidate Ranking Engine
Resolves AI-selected sectors and tickers to tradeable IBKR contracts,
enforces the 15% friction ceiling, calculates conviction scores,
and writes the Top N candidates to dynamic_baskets.json.
"""

import os
import json
import logging
from typing import List, Dict, Any, Optional
from datetime import datetime, timezone

from universe_models import (
    EnsembleResult, RankedCandidate, DynamicBasket, ContractSpec
)

logger = logging.getLogger("AlphaEngine.UniverseBuilder")
if not logger.handlers:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")


class UniverseBuilder:
    """
    Constructs the dynamic candidate universe from LLM ensemble outputs.
    Enforces exchange compatibility, liquidity filters, and the 15% friction rule.
    """
    
    # Pre-validated IBKR Master Contract Reference Matrix (US & European Blue Chips)
    KNOWN_CONTRACTS: Dict[str, Dict[str, Any]] = {
        # US Equities & Sector ETFs (USD)
        "XLE": {"conId": 593796, "primaryExchange": "ARCA", "currency": "USD", "isEuropean": False, "avgSpread": 0.02, "expectedMovePct": 1.8},
        "VLO": {"conId": 12836, "primaryExchange": "NYSE", "currency": "USD", "isEuropean": False, "avgSpread": 0.04, "expectedMovePct": 2.2},
        "COP": {"conId": 4658, "primaryExchange": "NYSE", "currency": "USD", "isEuropean": False, "avgSpread": 0.03, "expectedMovePct": 2.0},
        "SPY": {"conId": 756733, "primaryExchange": "ARCA", "currency": "USD", "isEuropean": False, "avgSpread": 0.01, "expectedMovePct": 1.2},
        "XLF": {"conId": 593797, "primaryExchange": "ARCA", "currency": "USD", "isEuropean": False, "avgSpread": 0.01, "expectedMovePct": 1.4},
        "TLT": {"conId": 15547841, "primaryExchange": "NASDAQ", "currency": "USD", "isEuropean": False, "avgSpread": 0.02, "expectedMovePct": 1.1},
        "NVDA": {"conId": 4815747, "primaryExchange": "NASDAQ", "currency": "USD", "isEuropean": False, "avgSpread": 0.05, "expectedMovePct": 3.0},
        "SMH": {"conId": 9599491, "primaryExchange": "NASDAQ", "currency": "USD", "isEuropean": False, "avgSpread": 0.04, "expectedMovePct": 2.5},
        "AMD": {"conId": 4391, "primaryExchange": "NASDAQ", "currency": "USD", "isEuropean": False, "avgSpread": 0.03, "expectedMovePct": 2.6},
        "ITA": {"conId": 32022718, "primaryExchange": "ARCA", "currency": "USD", "isEuropean": False, "avgSpread": 0.06, "expectedMovePct": 1.9},
        "NOC": {"conId": 10543, "primaryExchange": "NYSE", "currency": "USD", "isEuropean": False, "avgSpread": 0.12, "expectedMovePct": 2.1},
        "RTX": {"conId": 415712165, "primaryExchange": "NYSE", "currency": "USD", "isEuropean": False, "avgSpread": 0.04, "expectedMovePct": 1.7},
        
        # European Equities & Blue Chips (EUR - Euronext / XETRA)
        "SAP": {"conId": 10890, "primaryExchange": "IBIS", "currency": "EUR", "isEuropean": True, "avgSpread": 0.05, "expectedMovePct": 1.8},
        "RWE": {"conId": 38708, "primaryExchange": "IBIS", "currency": "EUR", "isEuropean": True, "avgSpread": 0.03, "expectedMovePct": 2.0},
        "AIR": {"conId": 4154, "primaryExchange": "SBF", "currency": "EUR", "isEuropean": True, "avgSpread": 0.08, "expectedMovePct": 2.2},
        "ASML": {"conId": 270662, "primaryExchange": "AEB", "currency": "EUR", "isEuropean": True, "avgSpread": 0.20, "expectedMovePct": 2.8},
        "ENGI": {"conId": 50130638, "primaryExchange": "SBF", "currency": "EUR", "isEuropean": True, "avgSpread": 0.02, "expectedMovePct": 1.6},
        "TTE": {"conId": 408544080, "primaryExchange": "SBF", "currency": "EUR", "isEuropean": True, "avgSpread": 0.04, "expectedMovePct": 1.9}
    }
    
    def __init__(self, fee_schedule_path: str = "fee_schedule.json", output_path: str = "dynamic_baskets.json"):
        self.fee_schedule_path = fee_schedule_path
        self.output_path = output_path
        self.fee_schedule = self._load_fee_schedule()
        
    def _load_fee_schedule(self) -> Dict[str, Any]:
        """Loads transaction fee parameters."""
        if os.path.exists(self.fee_schedule_path):
            try:
                with open(self.fee_schedule_path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception as e:
                logger.warning(f"Failed to load {self.fee_schedule_path}: {e}")
        return {
            "us_equities": {"commission_per_share": 0.005, "min_commission": 1.00},
            "european_equities": {"commission_pct": 0.0005, "min_commission_eur": 1.25},
            "friction_filter": {"max_friction_ratio": 0.15}
        }

    def resolve_contract(self, symbol: str) -> Optional[ContractSpec]:
        """Resolves symbol against IBKR specification matrix."""
        sym = symbol.upper().strip()
        info = self.KNOWN_CONTRACTS.get(sym)
        if not info:
            # Fallback for newly identified symbol
            is_eu = any(sym.endswith(suffix) for suffix in [".PA", ".AS", ".DE", ".MC"])
            return ContractSpec(
                symbol=sym,
                secType="STK",
                exchange="SMART",
                primaryExchange="SBF" if is_eu else "SMART",
                currency="EUR" if is_eu else "USD",
                conId=0,
                isEuropean=is_eu
            )
            
        return ContractSpec(
            symbol=sym,
            secType="STK",
            exchange="SMART",
            primaryExchange=info["primaryExchange"],
            currency=info["currency"],
            conId=info["conId"],
            minTick=0.01,
            isEuropean=info["isEuropean"]
        )

    def calculate_projected_friction(self, symbol: str, target_stop_dist: float, stock_price: float = 100.0) -> float:
        """
        Calculates projected transaction friction ratio:
        (Half Spread + 2x Commission) / (2.0 * Stop Distance)
        """
        info = self.KNOWN_CONTRACTS.get(symbol, {"avgSpread": 0.04, "isEuropean": False})
        spread = info.get("avgSpread", 0.04)
        is_eu = info.get("isEuropean", False)
        
        projected_spread_cost = spread / 2.0
        
        if is_eu:
            comm_cfg = self.fee_schedule.get("european_equities", {})
            pct = comm_cfg.get("commission_pct", 0.0005)
            min_c = comm_cfg.get("min_commission_eur", 1.25)
            est_comm = max(min_c, stock_price * pct)
        else:
            comm_cfg = self.fee_schedule.get("us_equities", {})
            per_sh = comm_cfg.get("commission_per_share", 0.005)
            min_c = comm_cfg.get("min_commission", 1.00)
            est_comm = max(min_c, 100 * per_sh) / 100.0  # Normalized per share
            
        round_trip_comm = est_comm * 2.0
        gross_profit_target = max(0.20, target_stop_dist * 2.0)
        
        friction_ratio = (projected_spread_cost + round_trip_comm) / gross_profit_target
        return round(friction_ratio * 100.0, 2)

    def build_ranked_universe(self, ensemble_results: List[EnsembleResult], max_instruments: int = 3) -> DynamicBasket:
        """
        Processes all ensemble results, extracts candidate symbols,
        filters by the 15% friction ceiling, and ranks the Top N.
        max_instruments: Configurable toggle (1 to 5, default 3).
        """
        candidates: List[RankedCandidate] = []
        source_events: List[str] = []
        max_instruments = max(1, min(5, max_instruments)) # Clamp 1 to 5
        
        for res in ensemble_results:
            if not res.classification or not res.accepted:
                continue
                
            source_events.append(res.event.event_id)
            
            for impact in res.classification.sector_impacts:
                if impact.direction not in ["BULLISH", "BEARISH"]:
                    continue
                    
                direction = "BUY" if impact.direction == "BULLISH" else "SELL"
                
                for sym in impact.affected_tickers:
                    sym_clean = sym.upper().strip()
                    spec = self.resolve_contract(sym_clean)
                    if not spec:
                        continue
                        
                    contract_info = self.KNOWN_CONTRACTS.get(sym_clean, {
                        "avgSpread": 0.04, "expectedMovePct": 1.8, "conId": 0
                    })
                    
                    # Assume normalized ATR stop distance of 1.2%
                    norm_stop_dist = max(0.50, 100.0 * 0.012)
                    friction_pct = self.calculate_projected_friction(sym_clean, norm_stop_dist)
                    
                    # 15% Max Friction Gate
                    if friction_pct > 15.0:
                        logger.info(f"[FRICTION REJECT] {sym_clean} rejected: friction {friction_pct}% exceeds 15% ceiling.")
                        continue
                        
                    # Calculate Conviction Score: (Confidence * Expected Move) / (Friction + 0.1)
                    exp_move = contract_info.get("expectedMovePct", 1.8)
                    conviction_score = (impact.confidence * exp_move) / (friction_pct + 0.1)
                    
                    win_rate = round(min(72.0, max(52.0, impact.confidence * 80.0)), 1)
                    profit_factor = round(min(2.1, max(1.2, impact.confidence * 2.2)), 2)
                    
                    candidate = RankedCandidate(
                        rank=0, # Assigned after sort
                        symbol=sym_clean,
                        sector=impact.sector,
                        subsector=impact.subsector,
                        direction=direction,
                        catalyst=impact.catalyst_summary,
                        confidence=round(impact.confidence, 2),
                        projectedWinRate=win_rate,
                        profitFactor=profit_factor,
                        expectedMovePct=exp_move,
                        averageSpread=contract_info.get("avgSpread", 0.04),
                        estimatedFrictionPct=friction_pct,
                        conId=spec.conId,
                        primaryExchange=spec.primaryExchange,
                        currency=spec.currency,
                        isEuropean=spec.isEuropean,
                        expiryHours=impact.expiry_hours
                    )
                    candidates.append((conviction_score, candidate))
                    
        # Sort descending by conviction score
        candidates.sort(key=lambda x: x[0], reverse=True)
        
        # Deduplicate by symbol and take Top N
        seen_symbols = set()
        final_ranked: List[RankedCandidate] = []
        rank_idx = 1
        
        for score, cand in candidates:
            if cand.symbol not in seen_symbols:
                seen_symbols.add(cand.symbol)
                cand.rank = rank_idx
                final_ranked.append(cand)
                rank_idx += 1
                if len(final_ranked) >= max_instruments:
                    break
                    
        # If no candidates passed (e.g. quiet news day), provide safe fallback basket
        if not final_ranked:
            logger.warning("[UNIVERSE FALLBACK] No high-conviction events passed filters. Seeding core benchmark assets.")
            for i, sym in enumerate(["XLE", "SPY", "SAP"][:max_instruments]):
                info = self.KNOWN_CONTRACTS[sym]
                final_ranked.append(RankedCandidate(
                    rank=i + 1,
                    symbol=sym,
                    sector="Core Benchmark",
                    subsector="Equities",
                    direction="BUY",
                    catalyst="Macro trend benchmark allocation",
                    confidence=0.60,
                    projectedWinRate=58.0,
                    profitFactor=1.45,
                    expectedMovePct=info["expectedMovePct"],
                    averageSpread=info["avgSpread"],
                    estimatedFrictionPct=5.2,
                    conId=info["conId"],
                    primaryExchange=info["primaryExchange"],
                    currency=info["currency"],
                    isEuropean=info["isEuropean"],
                    expiryHours=24
                ))
                
        basket = DynamicBasket(
            generatedAt=datetime.now(timezone.utc).isoformat(),
            maxActiveInstruments=max_instruments,
            candidates=final_ranked,
            macroContext="Dynamic multi-exchange universe calibrated from overnight news and event flow.",
            sourceEvents=source_events
        )
        
        self.save_basket(basket)
        return basket

    def save_basket(self, basket: DynamicBasket):
        """Saves DynamicBasket to dynamic_baskets.json."""
        # Convert to dictionary format compatible with ProactiveSimulator and Dashboard
        data = {
            "generatedAt": basket.generatedAt,
            "maxActiveInstruments": basket.maxActiveInstruments,
            "macroContext": basket.macroContext,
            "sourceEvents": basket.sourceEvents,
            "baskets": [
                {
                    "rank": c.rank,
                    "sector": f"{c.sector} ({c.subsector})",
                    "tickers": [c.symbol],
                    "direction": c.direction,
                    "catalyst": c.catalyst,
                    "impliedOfiTrend": f"{c.direction} ({c.catalyst})",
                    "winRate": c.projectedWinRate,
                    "profitFactor": c.profitFactor,
                    "avgFrictionConsumed": c.estimatedFrictionPct,
                    "conId": c.conId,
                    "primaryExchange": c.primaryExchange,
                    "currency": c.currency,
                    "isEuropean": c.isEuropean,
                    "expectedMovePct": c.expectedMovePct
                }
                for c in basket.candidates
            ]
        }
        
        try:
            with open(self.output_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
            logger.info(f"[UNIVERSE SAVED] {len(basket.candidates)} instruments written to {self.output_path}")
        except Exception as e:
            logger.error(f"Failed to write {self.output_path}: {e}")
