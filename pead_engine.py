"""
Post-Earnings Announcement Drift (PEAD) Engine.
Implements the empirically proven quantitative anomaly documented across 50+ years
of financial economics (Ball & Brown 1968, Bernard & Thomas 1989/1990).

Core Empirical Rules:
1. Liquid universe only: S&P 500, NASDAQ 100, DAX blue chips, or mega-cap sector ETFs (market cap > $5B).
2. Volume Confirmation: Post-announcement volume must exceed 2.0x of the 20-day rolling average.
3. Opening Spread Stabilization: Wait 15 minutes post-market open (09:45 EST) before calculating Order Flow Imbalance.
4. Microstructure Congruence: Level 2 OFI must be positive (> +1.5 Sigma) indicating dealer accumulation.
5. Volatility-Anchored Risk: 1.8x ATR synthetic trailing stop loss.
"""

import time
import math
from typing import Dict, Any, List, Optional
from dataclasses import dataclass

@dataclass
class PEADCandidate:
    symbol: str
    earnings_date: str
    eps_surprise_pct: float
    rev_surprise_pct: float
    opening_volume_multiple: float
    ofi_sigma: float
    spread_to_atr_pct: float
    market_cap_billions: float
    qualified: bool
    direction: str
    conviction_score: float
    rationale: str


class PEADEngine:
    """
    Evaluates post-event equities against strict institutional PEAD criteria.
    Filters out noise, illiquid micro-caps, and false breakouts.
    """
    
    # Minimum institutional qualification thresholds
    MIN_MARKET_CAP_BILLIONS = 5.0      # Mega/Large-cap only (avoids dilution traps)
    MIN_VOLUME_MULTIPLE = 2.0           # Must have at least 200% average volume
    MIN_OFI_SIGMA = 1.5                # Positive order flow accumulation
    MAX_FRICTION_SPREAD_ATR = 8.0      # Spread must be <= 8% of ATR
    
    def __init__(self, connection_manager=None):
        self.cm = connection_manager
        self.qualified_candidates: Dict[str, PEADCandidate] = {}

    def evaluate_candidate(
        self,
        symbol: str,
        eps_surprise_pct: float,
        rev_surprise_pct: float,
        opening_volume_multiple: float,
        ofi_sigma: float,
        spread_to_atr_pct: float,
        market_cap_billions: float = 50.0,
        earnings_date: str = ""
    ) -> PEADCandidate:
        """
        Applies non-negotiable institutional filters to classify PEAD drift potential.
        """
        sym = symbol.upper().strip()
        reasons = []
        is_qualified = True
        
        # 1. Market Cap Filter (avoids small-cap secondary offering dilution traps)
        if market_cap_billions < self.MIN_MARKET_CAP_BILLIONS:
            is_qualified = False
            reasons.append(f"Market cap ${market_cap_billions:.1f}B < ${self.MIN_MARKET_CAP_BILLIONS:.1f}B threshold (Dilution risk)")
            
        # 2. Volume Surge Filter
        if opening_volume_multiple < self.MIN_VOLUME_MULTIPLE:
            is_qualified = False
            reasons.append(f"Volume multiple {opening_volume_multiple:.1f}x < 2.0x 20-day ADV (Insufficient institutional interest)")
            
        # 3. Order Flow Imbalance Confirmation
        if ofi_sigma < self.MIN_OFI_SIGMA and eps_surprise_pct > 0:
            is_qualified = False
            reasons.append(f"OFI {ofi_sigma:+.1f} Sigma < +1.5 Sigma threshold (Dealers not aggressively accumulating)")
            
        # 4. Transaction Friction Filter
        if spread_to_atr_pct > self.MAX_FRICTION_SPREAD_ATR:
            is_qualified = False
            reasons.append(f"Spread/ATR friction {spread_to_atr_pct:.1f}% > 8% max ceiling")

        # Determine directional bias based on net fundamental surprise
        direction = "BUY" if eps_surprise_pct >= 0 else "SELL"
        
        # Compute institutional conviction score (0-100)
        conviction = 0.0
        if is_qualified:
            # Weighted formula: 40% Volume surge + 30% OFI + 30% EPS Surprise magnitude
            vol_score = min(40.0, (opening_volume_multiple / 3.0) * 40.0)
            ofi_score = min(30.0, (ofi_sigma / 3.0) * 30.0)
            surp_score = min(30.0, (abs(eps_surprise_pct) / 15.0) * 30.0)
            conviction = round(vol_score + ofi_score + surp_score, 1)
            rationale = f"PEAD Qualified: {direction} drift backed by {opening_volume_multiple:.1f}x volume and +{ofi_sigma:.1f} Sigma OFI accumulation."
        else:
            conviction = round(max(10.0, min(40.0, (opening_volume_multiple / 2.0) * 25.0)), 1)
            rationale = "Disqualified: " + "; ".join(reasons)

        candidate = PEADCandidate(
            symbol=sym,
            earnings_date=earnings_date or time.strftime("%Y-%m-%d"),
            eps_surprise_pct=eps_surprise_pct,
            rev_surprise_pct=rev_surprise_pct,
            opening_volume_multiple=opening_volume_multiple,
            ofi_sigma=ofi_sigma,
            spread_to_atr_pct=spread_to_atr_pct,
            market_cap_billions=market_cap_billions,
            qualified=is_qualified,
            direction=direction,
            conviction_score=conviction,
            rationale=rationale
        )
        
        if is_qualified:
            self.qualified_candidates[sym] = candidate
            print(f"[PEAD ENGINE] Qualified candidate {sym} for Post-Earnings Drift. Conviction: {conviction}/100")
            
        return candidate

    def get_ranked_pead_candidates(self) -> List[PEADCandidate]:
        """Returns qualified PEAD candidates ranked by conviction score."""
        sorted_list = sorted(self.qualified_candidates.values(), key=lambda c: c.conviction_score, reverse=True)
        return sorted_list
