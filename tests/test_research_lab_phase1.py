"""
Unit Test Suite for Phase 1 Institutional Research Lab Modules:
  1. QuantDiscoveryEngine (Wald-Wolfowitz Runs Test, Hurst Exponent, Markov Transition Matrix, Friction Hurdle)
  2. RiskSanitizer (Natural Language Intent Parsing, Hard Gate Clamping & Audit Trail)
  3. ContractResolver (Company Name / Ticker Resolution & Multi-Venue Disambiguation)
"""

import math
import pytest
from quant_discovery import QuantDiscoveryEngine
from risk_sanitizer import RiskSanitizer
from contract_resolver import ContractResolver


class TestQuantDiscoveryEngine:

    def test_wald_wolfowitz_alternating_sequence(self):
        """Alternating sequence (+1, -1, +1, -1...) should produce high Z-stat and reject random walk."""
        # 30 alternating daily moves
        alternating_returns = [0.01, -0.01] * 15
        result = QuantDiscoveryEngine.wald_wolfowitz_runs_test(alternating_returns)

        assert result["valid"] is True
        assert result["sample_size"] == 30
        assert result["observed_runs"] == 30
        assert result["z_stat"] > 1.96
        assert result["pattern_type"] == "ALTERNATING_MEAN_REVERTING"
        assert result["is_significant_95"] is True

    def test_wald_wolfowitz_random_sequence(self):
        """Random returns should yield non-significant p-value (p > 0.05)."""
        # Pseudo-random balanced returns
        random_returns = [0.01, 0.02, -0.01, -0.02, 0.01, -0.01, -0.02, 0.03, 0.01, 0.02, -0.01, 0.01, -0.02, -0.01]
        result = QuantDiscoveryEngine.wald_wolfowitz_runs_test(random_returns)

        assert result["valid"] is True
        assert result["pattern_type"] == "RANDOM_WALK_INDEPENDENT"
        assert result["is_significant_95"] is False

    def test_hurst_exponent_trending_vs_mean_reverting(self):
        """Test Hurst calculation handles synthetic trending and mean-reverting price series."""
        # Strongly trending series (persistent)
        trending_prices = [100.0 * (1.01 ** i) for i in range(40)]
        trend_result = QuantDiscoveryEngine.calculate_hurst_exponent(trending_prices)
        assert trend_result["valid"] is True
        assert trend_result["hurst_exponent"] > 0.50

        # Mean-reverting oscillating series
        mean_rev_prices = [100.0 + 2.0 * math.sin(i * 0.8) for i in range(40)]
        rev_result = QuantDiscoveryEngine.calculate_hurst_exponent(mean_rev_prices)
        assert rev_result["valid"] is True
        assert rev_result["hurst_exponent"] <= 0.55

    def test_markov_transition_probabilities(self):
        """Verifies transition probabilities for alternating series."""
        returns = [0.01, -0.01] * 10 # 20 returns
        markov = QuantDiscoveryEngine.markov_transition_matrix(returns)

        assert markov["valid"] is True
        # After a down return (-0.01), next is always up (+0.01)
        assert markov["p_up_given_down"] == 1.0
        assert markov["is_alternating_bias"] is True

    def test_friction_hurdle_enforcement(self):
        """Verifies the <15% transaction friction hurdle ceiling."""
        # Case 1: High daily move (1.5%), tight spread (0.05%) -> Passes
        pass_res = QuantDiscoveryEngine.evaluate_friction_hurdle(
            median_daily_move_pct=1.5,
            bid_ask_spread_pct=0.05,
            price=500.0,
            is_european=True,
            quantity=50.0,
            friction_ceiling_pct=15.0
        )
        assert pass_res["passes_hurdle"] is True
        assert pass_res["institutional_verdict"] == "APPROVED_FRICTION"

        # Case 2: Tiny move (0.15%), wide spread (0.10%) -> Exceeds 15% friction ceiling -> Rejected
        fail_res = QuantDiscoveryEngine.evaluate_friction_hurdle(
            median_daily_move_pct=0.15,
            bid_ask_spread_pct=0.10,
            price=20.0,
            is_european=False,
            quantity=100.0,
            friction_ceiling_pct=15.0
        )
        assert fail_res["passes_hurdle"] is False
        assert fail_res["institutional_verdict"] == "REJECTED_EXCESSIVE_FRICTION"


class TestRiskSanitizer:

    def test_natural_language_intent_parsing(self):
        """Parses natural language prompt with capital, risk, daily stop, friction, and lookback."""
        prompt = "Run simulation on ASML with €25,000 capital, 0.5% risk per trade, €800 daily stop, 10% friction ceiling, 3 days before earnings over last 30 trading days"
        parsed = RiskSanitizer.parse_natural_language_intent(prompt)

        assert parsed["requested_capital"] == 25000.0
        assert parsed["currency"] == "EUR"
        assert parsed["requested_risk_pct"] == 0.5
        assert parsed["requested_daily_loss"] == 800.0
        assert parsed["requested_friction_pct"] == 10.0
        assert parsed["requested_blackout_days"] == 3
        assert parsed["lookback_days"] == 30

    def test_gate_1_capital_clamping(self):
        """Capital exceeding $10,000 USD ceiling must be clamped with an audit trail note."""
        raw_inputs = {
            "currency": "EUR",
            "requested_capital": 50000.0, # Exceeds $10k
            "requested_risk_pct": 0.5,
            "lookback_days": 30
        }
        sanitized = RiskSanitizer.sanitize_and_clamp_parameters(raw_inputs, fx_rate_to_usd=1.08)

        assert sanitized["is_clamped"] is True
        assert sanitized["sanitized_capital"] < 10000.0 # Clamped in EUR to equivalent of $10k USD
        assert any("[GATE 1 CLAMP]" in entry for entry in sanitized["audit_trail"])

    def test_risk_budget_clamping(self):
        """Per-trade risk exceeding 1.0% must be clamped to 1.0%."""
        raw_inputs = {
            "currency": "USD",
            "requested_capital": 5000.0,
            "requested_risk_pct": 5.0, # Excessive 5% risk
            "lookback_days": 30
        }
        sanitized = RiskSanitizer.sanitize_and_clamp_parameters(raw_inputs)

        assert sanitized["is_clamped"] is True
        assert sanitized["risk_per_trade_pct"] == 1.0
        assert any("[RISK CLAMP]" in entry for entry in sanitized["audit_trail"])

    def test_friction_and_blackout_tightening_allowed(self):
        """User can specify tighter constraints (e.g. 10% friction, 72h blackout) without being rejected."""
        raw_inputs = {
            "currency": "USD",
            "requested_capital": 8000.0,
            "requested_risk_pct": 0.25,
            "requested_friction_pct": 10.0, # Tighter than 15%
            "requested_blackout_days": 3     # 72 hours, stricter than 48h
        }
        sanitized = RiskSanitizer.sanitize_and_clamp_parameters(raw_inputs)

        assert sanitized["friction_ceiling_pct"] == 10.0
        assert sanitized["binary_blackout_hours"] == 72
        assert any("[FRICTION APPROVED]" in entry for entry in sanitized["audit_trail"])
        assert any("[GATE 5 APPROVED]" in entry for entry in sanitized["audit_trail"])


class TestContractResolver:

    def test_resolve_rheinmetall_disambiguation(self):
        """Resolving 'Rheinmetall' returns primary XETRA contract and candidate US ADR."""
        resolver = ContractResolver()
        res = resolver.resolve_instrument("Rheinmetall")

        assert res["status"] in ["AMBIGUOUS_MULTI_VENUE", "RESOLVED_EXACT"]
        primary = res["primary_contract"]
        assert primary["symbol"] == "RHM"
        assert primary["primary_exchange"] == "IBIS"
        assert primary["currency"] == "EUR"
        assert primary["conId"] == 10738
        assert any(c["symbol"] == "RNMBY" for c in res["candidates"])

    def test_resolve_exact_us_ticker(self):
        """Resolving exact ticker like 'NVDA' or 'SPY' identifies primary listing."""
        resolver = ContractResolver()
        res = resolver.resolve_instrument("NVDA")

        assert res["status"] == "RESOLVED_EXACT"
        primary = res["primary_contract"]
        assert primary["symbol"] == "NVDA"
        assert primary["currency"] == "USD"
        assert primary["conId"] == 4815747
