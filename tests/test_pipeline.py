"""
Comprehensive Unit & Integration Test Suite for Alpha Engine Pipeline
Validates:
1. NewsIngestor event normalization and deduplication.
2. LLMEnsemble Critic-Verifier consensus and schema adherence.
3. UniverseBuilder contract resolution, 15% friction filter, and Top N ranking toggle.
4. ReasoningAuditor post-session attribution and lessons learned memory bank.
"""

import os
import unittest
from datetime import datetime, timezone

from universe_models import NewsEvent, RankedCandidate, DynamicBasket
from news_ingestor import NewsIngestor
from llm_ensemble import MultiModelEnsemble, SimpleQuotaGuard
from universe_builder import UniverseBuilder
from reasoning_auditor import ReasoningAuditor
from risk_engine import DRMMiddleware
from event_backtester import EventStudyBacktester


class TestAlphaEnginePipeline(unittest.TestCase):

    def setUp(self):
        self.news_ingestor = NewsIngestor()
        self.ensemble = MultiModelEnsemble()
        self.universe_builder = UniverseBuilder()
        self.auditor = ReasoningAuditor(memory_bank_path="test_lessons_learned.json", performance_path="test_performance.json")

    def tearDown(self):
        # Cleanup temporary test files
        for f in ["test_lessons_learned.json", "test_performance.json"]:
            if os.path.exists(f):
                try:
                    os.remove(f)
                except Exception:
                    pass

    def test_news_ingestion_and_deduplication(self):
        """Validates that duplicate headlines are ignored and events normalized."""
        ev1 = self.news_ingestor.ingest_ibkr_bulletin(101, 1, "Crude oil reserves hit multi-year lows", "NYSE")
        self.assertIsNotNone(ev1)
        self.assertEqual(ev1.urgency, "MEDIUM")

        # Duplicate should be dropped
        ev2 = self.news_ingestor.ingest_ibkr_bulletin(101, 1, "Crude oil reserves hit multi-year lows", "NYSE")
        self.assertIsNone(ev2)

        # Critical exchange alert
        ev3 = self.news_ingestor.ingest_ibkr_bulletin(102, 2, "Euronext connectivity halt on segment SBF", "SBF")
        self.assertIsNotNone(ev3)
        self.assertEqual(ev3.urgency, "HIGH")
        self.assertEqual(ev3.event_type, "regulatory")

    def test_ensemble_evaluation(self):
        """Validates that ensemble evaluation returns a complete EnsembleResult."""
        event = NewsEvent(
            event_id="TEST_001",
            timestamp=datetime.now(timezone.utc).isoformat(),
            source="TEST_SOURCE",
            headline="OPEC+ Agrees to Deep Production Cuts To Stabilize Markets",
            body="Delegates agreed to reduce output by 1.5 million barrels per day. Oil rallied 3%.",
            symbols_mentioned=["XLE", "VLO"]
        )
        result = self.ensemble.evaluate_event(event)
        self.assertIsNotNone(result)
        self.assertIsNotNone(result.classification)
        self.assertTrue(result.accepted)
        self.assertGreater(result.final_confidence, 0.50)
        self.assertTrue(len(result.classification.sector_impacts) > 0)
        impact = result.classification.sector_impacts[0]
        self.assertIn(impact.direction, ["BULLISH", "BEARISH"])

    def test_universe_builder_friction_and_ranking(self):
        """Validates contract resolution, 15% friction filter, and Top N toggle."""
        event = NewsEvent(
            event_id="TEST_002",
            timestamp=datetime.now(timezone.utc).isoformat(),
            source="TEST_SOURCE",
            headline="Energy demand accelerates globally",
            body="Crude and refined oil products gain as supply tightens.",
            symbols_mentioned=["XLE", "COP", "VLO"]
        )
        res = self.ensemble.evaluate_event(event)

        # Test with Max Active Instruments = 1
        basket_1 = self.universe_builder.build_ranked_universe([res], max_instruments=1)
        self.assertEqual(len(basket_1.candidates), 1)
        self.assertEqual(basket_1.maxActiveInstruments, 1)

        # Test with Max Active Instruments = 3
        basket_3 = self.universe_builder.build_ranked_universe([res], max_instruments=3)
        self.assertTrue(len(basket_3.candidates) <= 3)
        for cand in basket_3.candidates:
            self.assertTrue(cand.estimatedFrictionPct <= 15.0, f"Friction {cand.estimatedFrictionPct}% exceeds 15% ceiling")
            self.assertIn(cand.direction, ["BUY", "SELL"])

    def test_reasoning_auditor_attribution(self):
        """Validates that the auditor records lessons learned and updates memory bank."""
        self.auditor.record_attribution_lesson(
            event_catalyst="Middle East geopolitical escalation",
            symbol="XLE",
            predicted_direction="BUY",
            outcome_loss=120.50
        )
        lessons = self.auditor.get_recent_lessons(limit=1)
        self.assertEqual(len(lessons), 1)
        self.assertIn("XLE", lessons[0])

    def test_quota_guard_rate_limiting(self):
        """Validates that SimpleQuotaGuard enforces rolling-window limits and tracks usage."""
        guard = SimpleQuotaGuard(limits={"groq": {"daily": 3, "per_minute": 2}})
        self.assertTrue(guard.allow("groq"))
        guard.record("groq")
        self.assertTrue(guard.allow("groq"))
        guard.record("groq")
        # Per-minute limit reached (2 calls allowed in 60s)
        self.assertFalse(guard.allow("groq"))

        # Unknown provider should pass through without error
        self.assertTrue(guard.allow("unknown_provider"))

    def test_whatif_commission_query(self):
        """Validates What-If pre-trade commission simulation for US and EU instruments."""
        class DummyCM:
            is_connected = False
            account_summary = {"NetLiquidation": 100000.0}
            active_positions = {}
        drm = DRMMiddleware(DummyCM(), "DU1234567")
        
        # US Equity test
        us_est = drm.query_whatif_commission("SPY", quantity=100, action="BUY", price=500.0, is_european=False)
        self.assertEqual(us_est["currency"], "USD")
        self.assertGreaterEqual(us_est["commission"], 1.00)
        self.assertGreater(us_est["initMarginChange"], 0.0)

        # European Equity test
        eu_est = drm.query_whatif_commission("SAP", quantity=50, action="BUY", price=180.0, is_european=True)
        self.assertEqual(eu_est["currency"], "EUR")
        self.assertGreaterEqual(eu_est["commission"], 3.00)

    def test_event_study_backtester(self):
        """Validates Tier A Event Study Backtester calculations across synthetic events."""
        backtester = EventStudyBacktester()
        samples = backtester.generate_synthetic_study_sample()
        self.assertGreater(len(samples), 0)
        
        metrics = backtester.evaluate_study(samples)
        self.assertEqual(metrics.total_events, len(samples))
        self.assertGreaterEqual(metrics.directional_hit_rate, 0.0)
        self.assertLessEqual(metrics.directional_hit_rate, 100.0)
        self.assertGreaterEqual(metrics.brier_score, 0.0)
        self.assertIn("macro", metrics.by_category)
        self.assertIn("geopolitical", metrics.by_category)

    def test_market_hours_resolver(self):
        """Validates dynamic parsing of IBKR liquidHours and opening observation buffers."""
        from market_hours_resolver import MarketHoursResolver, MarketSessionPhase
        from datetime import date
        
        resolver = MarketHoursResolver(default_observation_buffer_mins=15)
        
        # Test standard open string
        today = date(2026, 9, 28)
        lh_str = "20260928:0900-1730;20260929:0900-1730"
        session = resolver.parse_liquid_hours_string(lh_str, "Europe/Paris", target_date=today)
        self.assertIsNotNone(session)
        self.assertTrue(session["is_open"])
        self.assertEqual(session["open_time_str"], "09:00")
        self.assertEqual(session["close_time_str"], "17:30")
        
        # Test closed/holiday string
        closed_str = "20260928:CLOSED;20260929:0900-1730"
        closed_session = resolver.parse_liquid_hours_string(closed_str, "Europe/Paris", target_date=today)
        self.assertIsNotNone(closed_session)
        self.assertFalse(closed_session["is_open"])
        self.assertEqual(closed_session["status"], MarketSessionPhase.CLOSED_HOLIDAY)

    def test_opening_reality_verifier(self):
        """Validates OpeningRealityVerifier challenges against spread blowouts and gap-and-fade traps."""
        # 1. Valid setup
        valid_snap = {
            "realized_spread": 0.02,
            "stock_price": 100.0,
            "price_change_from_open_pct": 0.45,
            "opening_volume_ratio": 1.5,
            "ofi_ratio": 0.35
        }
        res_valid = self.ensemble.challenge_opening_thesis("XLE", "BUY", "Oil supply cuts", 2.0, valid_snap)
        self.assertTrue(res_valid["thesis_valid"])
        self.assertEqual(res_valid["action"], "EXECUTE")
        self.assertLessEqual(res_valid["realized_friction_pct"], 15.0)

        # 2. Spread blowout (>15% friction)
        blowout_snap = {
            "realized_spread": 0.35, # Wide spread
            "stock_price": 50.0,
            "price_change_from_open_pct": 0.1,
            "opening_volume_ratio": 0.5,
            "ofi_ratio": 0.0
        }
        res_blowout = self.ensemble.challenge_opening_thesis("XLE", "BUY", "Oil supply cuts", 1.5, blowout_snap)
        self.assertFalse(res_blowout["thesis_valid"])
        self.assertEqual(res_blowout["action"], "RECURSIVE_REPLACE")
        self.assertGreater(res_blowout["realized_friction_pct"], 15.0)

        # 3. Gap-and-fade trap
        fade_snap = {
            "realized_spread": 0.03,
            "stock_price": 100.0,
            "price_change_from_open_pct": -1.2, # Slipped -1.2%
            "opening_volume_ratio": 2.2,
            "ofi_ratio": -0.45 # Heavy sell flow
        }
        res_fade = self.ensemble.challenge_opening_thesis("XLE", "BUY", "Oil supply cuts", 2.0, fade_snap)
        self.assertFalse(res_fade["thesis_valid"])
        self.assertEqual(res_fade["action"], "RECURSIVE_REPLACE")

    def test_recursive_candidate_replacement(self):
        """Validates that UniverseBuilder drops invalidated candidate and slots in verified substitute."""
        event = NewsEvent(
            event_id="TEST_REC_01",
            timestamp=datetime.now(timezone.utc).isoformat(),
            source="TEST",
            headline="Energy sector active",
            body="Oil rally continuing.",
            symbols_mentioned=["XLE"]
        )
        res = self.ensemble.evaluate_event(event)
        basket = self.universe_builder.build_ranked_universe([res], max_instruments=1)
        self.assertEqual(len(basket.candidates), 1)
        initial_sym = basket.candidates[0].symbol

        # Trigger recursive replacement
        updated_basket, replacement = self.universe_builder.recursive_replace_candidate(
            basket=basket,
            rejected_symbol=initial_sym,
            invalidation_reason="Opening spread exceeded 15% friction ceiling"
        )
        self.assertIsNotNone(replacement)
        self.assertNotEqual(replacement.symbol, initial_sym)
        self.assertTrue(replacement.isRecursiveSwap)
        self.assertIn("friction", replacement.invalidationReason.lower())
        self.assertEqual(len(updated_basket.candidates), 1)
        self.assertEqual(updated_basket.candidates[0].symbol, replacement.symbol)


if __name__ == "__main__":
    unittest.main()

