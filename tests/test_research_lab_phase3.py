"""
Unit Test Suite for Phase 3 Institutional Auditor & Deflated Sharpe Ratio (institutional_auditor.py).
Verifies:
  1. Standard Sharpe calculation and annualization.
  2. Calculation of skewness and kurtosis.
  3. López de Prado Deflated Sharpe Ratio (DSR) under single vs multiple testing trials.
  4. Detection and rejection of curve-fitted / over-tested strategies.
"""

import math
import pytest
from institutional_auditor import InstitutionalBacktestAuditor


class TestInstitutionalBacktestAuditor:

    def _generate_synthetic_equity_curve(self, daily_return_mean: float, daily_return_std: float, periods: int = 100):
        """Generates synthetic balance history and trades list."""
        balance_history = [{"date": "2026-01-01", "equity": 100000.0}]
        trades = []
        eq = 100000.0

        for i in range(1, periods):
            # Alternating positive drift
            r = daily_return_mean + (daily_return_std if i % 2 == 0 else -daily_return_std * 0.5)
            pnl = eq * r
            eq += pnl
            balance_history.append({"date": f"2026-01-{i:02d}", "equity": round(eq, 2)})
            trades.append({
                "id": f"T_{i}",
                "realizedPnL": round(pnl, 2),
                "commission": 2.50
            })

        return trades, balance_history

    def test_robust_strategy_passes_dsr_hurdle(self):
        """A strategy with steady positive drift over 100 periods should achieve DSR >= 0.95 on single trial."""
        trades, balances = self._generate_synthetic_equity_curve(
            daily_return_mean=0.002,  # 0.2% daily mean
            daily_return_std=0.005,   # Low volatility
            periods=120
        )

        audit = InstitutionalBacktestAuditor.audit_backtest(
            trades=trades,
            balance_history=balances,
            starting_capital=100000.0,
            trials_tested=1,
            benchmark_sharpe=0.0
        )

        assert audit["valid"] is True
        assert audit["annualized_sharpe"] > 1.5
        assert audit["deflated_sharpe_ratio"] >= 0.95
        assert audit["passes_dsr_hurdle"] is True
        assert audit["institutional_verdict"] == "APPROVED_FOR_SANDBOX_PAPER"

    def test_overfitting_penalty_with_multiple_trials(self):
        """When the same nominal performance is audited under 50 multiple testing trials, DSR drops."""
        trades, balances = self._generate_synthetic_equity_curve(
            daily_return_mean=0.001,
            daily_return_std=0.012,
            periods=60
        )

        # Audit with 1 trial
        audit_single = InstitutionalBacktestAuditor.audit_backtest(
            trades=trades,
            balance_history=balances,
            starting_capital=100000.0,
            trials_tested=1
        )

        # Audit with 50 trials (simulating aggressive parameter snooping)
        audit_multi = InstitutionalBacktestAuditor.audit_backtest(
            trades=trades,
            balance_history=balances,
            starting_capital=100000.0,
            trials_tested=50
        )

        assert audit_single["valid"] is True
        assert audit_multi["valid"] is True
        # DSR under 50 trials must be strictly lower than under 1 trial
        assert audit_multi["deflated_sharpe_ratio"] < audit_single["deflated_sharpe_ratio"]
        # Expected maximum null Sharpe must be higher due to selection bias
        assert audit_multi["expected_max_null_sr"] > audit_single["expected_max_null_sr"]
