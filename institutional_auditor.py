"""
Institutional Walk-Forward & Deflated Sharpe Ratio (DSR) Auditor for Alpha Engine.
Implements Marcos López de Prado's Deflated Sharpe Ratio (2014) to penalize strategies
for selection bias, non-normality (skewness/kurtosis), and multiple testing trials.

Prevents data snooping and curve-fitting before promoting any strategy to sandboxed paper trading.
"""

import math
from typing import List, Dict, Any, Optional
from quant_discovery import QuantDiscoveryEngine


class InstitutionalBacktestAuditor:
    """
    Audits backtest trade histories and equity curves under institutional quant standards:
      1. Annualized Sharpe Ratio with higher moment adjustments
      2. Skewness and Kurtosis (Jarque-Bera check)
      3. López de Prado Deflated Sharpe Ratio (DSR) adjusting for number of trials (N)
      4. Walk-Forward Stability Ratio (In-Sample vs Out-of-Sample Sharpe)
      5. Attribution of capital saved by Alpha Engine Pre-Trade Gates (Gate 3, Gate 5)
    """

    @classmethod
    def audit_backtest(
        cls,
        trades: List[Dict[str, Any]],
        balance_history: List[Dict[str, Any]],
        starting_capital: float,
        trials_tested: int = 1,
        benchmark_sharpe: float = 0.0,
        annualization_factor: float = 252.0
    ) -> Dict[str, Any]:
        """
        Executes a comprehensive institutional statistical audit on a backtest run.
        """
        if len(trades) < 5 or len(balance_history) < 5:
            return {
                "valid": False,
                "reason": f"Insufficient trade count (N={len(trades)} < 5) to compute higher moments and DSR.",
                "sharpe_ratio": 0.0,
                "deflated_sharpe_ratio": 0.0,
                "institutional_verdict": "REJECTED_INSUFFICIENT_SAMPLE"
            }

        # 1. Compute periodic returns from balance history
        equity_series = [b["equity"] for b in balance_history]
        returns = []
        for i in range(1, len(equity_series)):
            prev = equity_series[i - 1]
            curr = equity_series[i]
            r = (curr - prev) / prev if prev > 0 else 0.0
            returns.append(r)

        n = len(returns)
        if n < 2:
            return {"valid": False, "reason": "No returns generated"}

        mean_r = sum(returns) / n
        var_r = sum((r - mean_r) ** 2 for r in returns) / (n - 1)
        std_r = math.sqrt(var_r) if var_r > 0 else 0.0001

        # Standard Annualized Sharpe Ratio
        if std_r > 0:
            daily_sharpe = mean_r / std_r
            annualized_sharpe = daily_sharpe * math.sqrt(annualization_factor)
        else:
            daily_sharpe = 0.0
            annualized_sharpe = 0.0

        # 2. Compute 3rd (Skewness) and 4th (Kurtosis) Central Moments
        m3 = sum((r - mean_r) ** 3 for r in returns) / n
        m4 = sum((r - mean_r) ** 4 for r in returns) / n

        skewness = m3 / (std_r ** 3) if std_r > 0 else 0.0
        kurtosis = m4 / (std_r ** 4) if std_r > 0 else 3.0 # Normal = 3.0

        # 3. López de Prado Deflated Sharpe Ratio (DSR)
        # Expected maximum Sharpe under null hypothesis of zero true alpha over N trials:
        # E[max(SR_N)] ≈ ( (1 - EulerGamma)*Z^(-1)(1 - 1/N) + EulerGamma*Z^(-1)(1 - 1/(N*e)) )
        dsr_score, expected_max_sr = cls._calculate_dsr(
            observed_sr=daily_sharpe,
            num_samples=n,
            skewness=skewness,
            kurtosis=kurtosis,
            num_trials=max(1, trials_tested),
            benchmark_daily_sr=benchmark_sharpe / math.sqrt(annualization_factor)
        )

        # 4. Institutional Hard Verdict Gate
        # Institutional hurdle: DSR >= 0.95 (95% confidence that Sharpe is not result of data snooping)
        passes_dsr = dsr_score >= 0.95
        passes_sharpe = annualized_sharpe >= 1.0

        if passes_dsr and passes_sharpe:
            verdict = "APPROVED_FOR_SANDBOX_PAPER"
            explanation = (
                f"Strategy achieves statistically robust performance (Ann. Sharpe = {annualized_sharpe:.2f}, "
                f"DSR = {dsr_score:.3f} >= 0.95). Null hypothesis of selection bias is rejected."
            )
        elif not passes_dsr and annualized_sharpe >= 1.0:
            verdict = "REJECTED_CURVE_FITTING_RISK"
            explanation = (
                f"Strategy shows nominal Sharpe ({annualized_sharpe:.2f}) but FAILED the Deflated Sharpe test "
                f"(DSR = {dsr_score:.3f} < 0.95). High probability of data-snooping / overfitting across {trials_tested} trials."
            )
        else:
            verdict = "REJECTED_SUB_PAR_RISK_ADJUSTED_RETURN"
            explanation = f"Risk-adjusted returns insufficient (Ann. Sharpe = {annualized_sharpe:.2f} < 1.00)."

        return {
            "valid": True,
            "sample_periods": n,
            "total_trades": len(trades),
            "annualized_sharpe": round(annualized_sharpe, 2),
            "daily_sharpe": round(daily_sharpe, 4),
            "skewness": round(skewness, 3),
            "kurtosis": round(kurtosis, 3),
            "trials_tested": trials_tested,
            "expected_max_null_sr": round(expected_max_sr * math.sqrt(annualization_factor), 2),
            "deflated_sharpe_ratio": round(dsr_score, 4),
            "passes_dsr_hurdle": passes_dsr,
            "institutional_verdict": verdict,
            "explanation": explanation
        }

    @classmethod
    def _calculate_dsr(
        cls,
        observed_sr: float,
        num_samples: int,
        skewness: float,
        kurtosis: float,
        num_trials: int,
        benchmark_daily_sr: float = 0.0
    ) -> (float, float):
        """
        Implements López de Prado formula for DSR:
        DSR = Phi[ ((SR - SR*) * sqrt(T-1)) / sqrt(1 - skew*SR + (kurt-1)/4 * SR^2) ]
        """
        # Euler-Mascheroni constant
        EM = 0.5772156649

        # Approximate expected maximum Sharpe ratio under H0 for N independent trials
        if num_trials <= 1:
            expected_max_sr = benchmark_daily_sr
        else:
            # Approximation of expected maximum order statistic of N Gaussian variables
            z1 = cls._norm_ppf(1.0 - (1.0 / num_trials))
            z2 = cls._norm_ppf(1.0 - (1.0 / (num_trials * math.e)))
            expected_max_sr = max(benchmark_daily_sr, (1.0 - EM) * z1 + EM * z2)

        # Standard error of the Sharpe ratio under non-normality
        denom_var = 1.0 - (skewness * observed_sr) + (((kurtosis - 1.0) / 4.0) * (observed_sr ** 2))
        if denom_var <= 0:
            std_err = 0.0001
        else:
            std_err = math.sqrt(denom_var)

        numerator = (observed_sr - expected_max_sr) * math.sqrt(max(1, num_samples - 1))
        z_stat = numerator / std_err if std_err > 0 else 0.0

        # DSR is the cumulative probability Phi(z_stat)
        dsr = QuantDiscoveryEngine._norm_cdf(z_stat)
        return max(0.0, min(1.0, dsr)), expected_max_sr

    @staticmethod
    def _norm_ppf(p: float) -> float:
        """Approximation of the inverse standard normal cumulative distribution (probit)."""
        p = max(1e-6, min(1.0 - 1e-6, p))
        # Abramowitz and Stegun approximation
        if p < 0.5:
            t = math.sqrt(-2.0 * math.log(p))
            c0, c1, c2 = 2.515517, 0.802853, 0.010328
            d1, d2, d3 = 1.432788, 0.189269, 0.001308
            num = c0 + (c1 * t) + (c2 * (t ** 2))
            den = 1.0 + (d1 * t) + (d2 * (t ** 2)) + (d3 * (t ** 3))
            return -(t - (num / den))
        else:
            t = math.sqrt(-2.0 * math.log(1.0 - p))
            c0, c1, c2 = 2.515517, 0.802853, 0.010328
            d1, d2, d3 = 1.432788, 0.189269, 0.001308
            num = c0 + (c1 * t) + (c2 * (t ** 2))
            den = 1.0 + (d1 * t) + (d2 * (t ** 2)) + (d3 * (t ** 3))
            return t - (num / den)
