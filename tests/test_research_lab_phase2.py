"""
Unit Test Suite for Phase 2 News & Catalyst Correlation Engine (news_event_correlator.py).
Verifies:
  1. Anomaly detection thresholding (|Return| > 1.5 * sigma).
  2. News event attribution (matches SEC 8-K, FDA, and macro events to anomalous days).
  3. Distinction between endogenous microstructure regimes and news-dominated regimes.
  4. Generation of institutional recommendations (e.g. REQUIRE_GATE_5_CONDITIONING).
"""

import pytest
from datetime import datetime, timedelta
from universe_models import NewsEvent
from news_event_correlator import NewsEventCorrelator


class TestNewsEventCorrelator:

    def _generate_synthetic_bars_with_anomalies(self):
        """Generates 30 synthetic bars with 3 designated outlier swing days."""
        base_date = datetime(2026, 9, 1)
        bars = []
        price = 500.0

        for i in range(30):
            d_str = (base_date + timedelta(days=i)).strftime("%Y-%m-%d")
            # Baseline small moves: ~0.3%
            daily_pct = 0.003 if i % 2 == 0 else -0.003
            
            # Day 8: Big positive jump (+4.5%)
            if i == 8:
                daily_pct = 0.045
            # Day 15: Big negative drop (-3.8%)
            elif i == 15:
                daily_pct = -0.038
            # Day 22: Big positive jump (+3.9%)
            elif i == 22:
                daily_pct = 0.039

            price = price * (1.0 + daily_pct)
            bars.append({
                "date": d_str,
                "open": price * 0.998,
                "high": price * 1.005,
                "low": price * 0.995,
                "close": price,
                "volume": 250000
            })

        return bars

    def test_news_dominated_regime_detection(self):
        """When anomalous days correspond to major SEC/NATO events, system detects exogenous regime."""
        correlator = NewsEventCorrelator()
        bars = self._generate_synthetic_bars_with_anomalies()

        # Day 8 date = 2026-09-09
        # Day 15 date = 2026-09-16
        events = [
            NewsEvent(
                event_id="USASPEND_101",
                timestamp="2026-09-09T08:30:00Z",
                source="USASPENDING",
                headline="Department of Defense awards €450M ammunition contract to Rheinmetall",
                body="Full contract execution scheduled for Q4 2026",
                symbols_mentioned=["RHM"],
                event_type="press_release",
                urgency="HIGH"
            ),
            NewsEvent(
                event_id="GDELT_202",
                timestamp="2026-09-16T09:15:00Z",
                source="GDELT_PROJECT",
                headline="European defense export restrictions announced in Brussels",
                body="New regulatory constraints on NATO export approvals",
                symbols_mentioned=["RHM"],
                event_type="geopolitical",
                urgency="CRITICAL"
            )
        ]

        result = correlator.correlate_anomalies_with_events(
            symbol="RHM",
            daily_bars=bars,
            news_events=events,
            sigma_threshold=1.5
        )

        assert result["valid"] is True
        assert result["total_anomalies_detected"] == 3
        assert result["exogenous_catalyst_count"] == 2
        assert result["endogenous_microstructure_count"] == 1
        assert result["exogenous_ratio_pct"] > 50.0
        assert result["regime"] == "NEWS_DOMINATED_REGIME"
        assert result["institutional_verdict"] == "REQUIRE_GATE_5_CONDITIONING"
        assert "Gate 5 Binary Event Blackouts" in result["explanation"]

    def test_pure_endogenous_microstructure_regime(self):
        """When no primary news events exist, regime is classified as pure microstructure."""
        correlator = NewsEventCorrelator()
        bars = self._generate_synthetic_bars_with_anomalies()
        events = [] # Zero exogenous news events

        result = correlator.correlate_anomalies_with_events(
            symbol="ASML",
            daily_bars=bars,
            news_events=events,
            sigma_threshold=1.5
        )

        assert result["valid"] is True
        assert result["exogenous_catalyst_count"] == 0
        assert result["endogenous_microstructure_count"] == 3
        assert result["regime"] == "MICROSTRUCTURE_DRIVEN_REGIME"
        assert result["institutional_verdict"] == "STATISTICALLY_VIABLE_FOR_TECHNICALS"
