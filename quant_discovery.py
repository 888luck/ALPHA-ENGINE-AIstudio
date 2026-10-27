"""
Quantitative Discovery & Statistical Null-Hypothesis Engine for Alpha Engine.
Strictly deterministic implementation of mathematical finance tests:
  1. Wald-Wolfowitz Runs Test (tests independence of price move directions)
  2. Hurst Exponent via Rescaled Range (R/S analysis: mean-reversion vs random walk vs trending)
  3. Markov Chain State Transition Matrix with Wilson 95% Confidence Intervals
  4. Institutional Transaction Cost Hurdle Test (<15% friction ceiling)
"""

import math
from typing import List, Dict, Any, Tuple, Optional


class QuantDiscoveryEngine:
    """
    Evaluates historical daily/intraday price series to determine if an alleged pattern
    is statistically distinguishable from a random walk (Geometric Brownian Motion)
    and economically viable after IBKR Europe (IBIE) transaction costs.
    """

    @staticmethod
    def wald_wolfowitz_runs_test(returns: List[float]) -> Dict[str, Any]:
        """
        Executes the Wald-Wolfowitz Runs Test on the signs of returns (+1 for positive/flat, -1 for negative).
        Null Hypothesis (H0): The sequence of return directions is independent (random walk).
        Alternative Hypothesis (H1): Sequence exhibits non-random clustering or alternating patterns.
        """
        # Filter out zero returns or treat zero as positive direction
        signs = [1 if r >= 0 else -1 for r in returns]
        n = len(signs)
        if n < 10:
            return {
                "valid": False,
                "reason": f"Insufficient sample size (N={n} < 10). Minimum 10 observations required.",
                "p_value": 1.0,
                "z_stat": 0.0,
                "runs": 0,
                "is_significant": False
            }

        n1 = sum(1 for s in signs if s == 1)   # Count of positive runs elements
        n2 = sum(1 for s in signs if s == -1)  # Count of negative runs elements

        if n1 == 0 or n2 == 0:
            return {
                "valid": True,
                "reason": "All returns have identical sign. Trivial non-random sequence.",
                "p_value": 0.0,
                "z_stat": float("-inf") if n1 == 0 else float("inf"),
                "runs": 1,
                "is_significant": True,
                "pattern_type": "MONOTONIC"
            }

        # Count total runs (contiguous sequences of identical sign)
        runs = 1
        for i in range(1, n):
            if signs[i] != signs[i - 1]:
                runs += 1

        # Expected runs under H0
        mu_r = ((2.0 * n1 * n2) / n) + 1.0
        
        # Variance of runs under H0
        var_r = (2.0 * n1 * n2 * (2.0 * n1 * n2 - n)) / ((n ** 2) * (n - 1.0))

        if var_r <= 0:
            std_r = 0.0001
        else:
            std_r = math.sqrt(var_r)

        # Continuity-corrected Z-statistic
        if runs > mu_r:
            z_stat = (runs - mu_r - 0.5) / std_r
        elif runs < mu_r:
            z_stat = (runs - mu_r + 0.5) / std_r
        else:
            z_stat = 0.0

        # Two-tailed p-value using standard normal approximation
        # Approximation of complementary error function erfc
        p_value = 2.0 * (1.0 - QuantDiscoveryEngine._norm_cdf(abs(z_stat)))
        p_value = max(0.0, min(1.0, p_value))

        # Interpretation:
        # z_stat > 1.96: Significantly MORE runs than expected -> Alternating / Mean-Reverting
        # z_stat < -1.96: Significantly FEWER runs than expected -> Clustering / Trending
        if z_stat > 1.96:
            pattern_type = "ALTERNATING_MEAN_REVERTING"
        elif z_stat < -1.96:
            pattern_type = "PERSISTENT_TRENDING"
        else:
            pattern_type = "RANDOM_WALK_INDEPENDENT"

        return {
            "valid": True,
            "sample_size": n,
            "positive_count": n1,
            "negative_count": n2,
            "observed_runs": runs,
            "expected_runs": round(mu_r, 2),
            "z_stat": round(z_stat, 4),
            "p_value": round(p_value, 5),
            "is_significant_95": bool(p_value < 0.05),
            "is_significant_99": bool(p_value < 0.01),
            "pattern_type": pattern_type
        }

    @staticmethod
    def calculate_hurst_exponent(prices: List[float], max_lags: int = 20) -> Dict[str, Any]:
        """
        Calculates the Hurst Exponent (H) via diffusion variance scaling across lags tau:
          Var(price_t - price_{t-tau}) ~ tau^(2H)
          log(std_tau) ~ H * log(tau)
        H < 0.45: Mean-Reverting series (anti-persistent)
        0.45 <= H <= 0.55: Geometric Brownian Motion (Random Walk)
        H > 0.55: Trending series (persistent)
        """
        n = len(prices)
        if n < 20:
            return {
                "valid": False,
                "reason": f"Sample size (N={n}) too small for Hurst exponent. Need >= 20 observations.",
                "hurst_exponent": 0.50,
                "regime": "INSUFFICIENT_DATA"
            }

        # Calculate standard deviations of differences across multiple lags
        lags = range(2, min(max_lags, n // 2))
        tau = []
        lagvec = []

        for lag in lags:
            diffs = [prices[i] - prices[i - lag] for i in range(lag, n)]
            if len(diffs) > 1:
                mean_d = sum(diffs) / len(diffs)
                var_d = sum((d - mean_d) ** 2 for d in diffs) / (len(diffs) - 1)
                std_d = math.sqrt(var_d)
                if std_d > 1e-8:
                    tau.append(math.log(std_d))
                    lagvec.append(math.log(lag))

        if len(lagvec) < 3:
            return {
                "valid": False,
                "reason": "Could not compute sufficient variance lag horizons.",
                "hurst_exponent": 0.50,
                "regime": "RANDOM_WALK"
            }

        # Linear regression slope: log(std) vs log(lag) = H
        h_slope = QuantDiscoveryEngine._linear_regression_slope(lagvec, tau)
        h_clamped = max(0.01, min(0.99, h_slope))

        if h_clamped < 0.45:
            regime = "MEAN_REVERTING"
        elif h_clamped > 0.55:
            regime = "TRENDING_PERSISTENT"
        else:
            regime = "GEOMETRIC_BROWNIAN_MOTION"

        return {
            "valid": True,
            "hurst_exponent": round(h_clamped, 3),
            "regime": regime,
            "is_mean_reverting": bool(h_clamped < 0.45),
            "is_trending": bool(h_clamped > 0.55)
        }

    @staticmethod
    def markov_transition_matrix(returns: List[float]) -> Dict[str, Any]:
        """
        Calculates empirical Markov transition probabilities:
        P(Up_t | Up_t-1), P(Down_t | Up_t-1), P(Up_t | Down_t-1), P(Down_t | Down_t-1).
        Computes 95% Wilson Score confidence intervals to prevent small-sample misinterpretation.
        """
        signs = [1 if r >= 0 else 0 for r in returns] # 1 = UP/FLAT, 0 = DOWN
        n = len(signs)
        if n < 5:
            return {"valid": False, "reason": "Insufficient samples"}

        counts = {
            (1, 1): 0, # Up -> Up
            (1, 0): 0, # Up -> Down
            (0, 1): 0, # Down -> Up
            (0, 0): 0  # Down -> Down
        }

        for i in range(1, n):
            prev = signs[i - 1]
            curr = signs[i]
            counts[(prev, curr)] += 1

        total_after_up = counts[(1, 1)] + counts[(1, 0)]
        total_after_down = counts[(0, 1)] + counts[(0, 0)]

        p_up_given_down = (counts[(0, 1)] / total_after_down) if total_after_down > 0 else 0.5
        p_down_given_down = (counts[(0, 0)] / total_after_down) if total_after_down > 0 else 0.5
        p_up_given_up = (counts[(1, 1)] / total_after_up) if total_after_up > 0 else 0.5
        p_down_given_up = (counts[(1, 0)] / total_after_up) if total_after_up > 0 else 0.5

        # Wilson score confidence interval for P(Up | Down)
        ci_low, ci_high = QuantDiscoveryEngine._wilson_score_interval(
            counts[(0, 1)], total_after_down, confidence=0.95
        )

        return {
            "valid": True,
            "total_transitions": n - 1,
            "transitions_after_down": total_after_down,
            "transitions_after_up": total_after_up,
            "p_up_given_down": round(p_up_given_down, 4),
            "p_down_given_down": round(p_down_given_down, 4),
            "p_up_given_up": round(p_up_given_up, 4),
            "p_down_given_up": round(p_down_given_up, 4),
            "p_up_given_down_95_ci": [round(ci_low, 4), round(ci_high, 4)],
            "is_alternating_bias": bool(p_up_given_down > 0.55 and ci_low > 0.45)
        }

    @staticmethod
    def evaluate_friction_hurdle(
        median_daily_move_pct: float,
        bid_ask_spread_pct: float,
        price: float,
        is_european: bool = True,
        quantity: float = 100.0,
        friction_ceiling_pct: float = 15.0
    ) -> Dict[str, Any]:
        """
        Enforces Alpha Engine Institutional Friction Ceiling (<15.0%).
        Friction Ratio = Total Round-Trip Friction / Expected Move.
        Total Friction = Half-Spread + 2x IBIE Commission + Estimated Slippage.
        """
        if median_daily_move_pct <= 0:
            return {
                "valid": False,
                "reason": "Expected daily move is zero or negative.",
                "friction_ratio_pct": 100.0,
                "passes_hurdle": False
            }

        trade_value = price * quantity
        # IBIE Commission Structure
        if is_european:
            # European: 0.05% of trade value, min €1.25
            single_comm = max(1.25, trade_value * 0.0005)
        else:
            # US: $0.005 per share, min $1.00
            single_comm = max(1.00, quantity * 0.005)

        round_trip_comm_pct = (2.0 * single_comm / trade_value) * 100.0 if trade_value > 0 else 0.0
        half_spread_pct = (bid_ask_spread_pct / 2.0)
        # Conservative institutional slippage allowance: 0.02%
        est_slippage_pct = 0.02

        total_friction_pct = half_spread_pct + round_trip_comm_pct + est_slippage_pct
        friction_ratio = (total_friction_pct / median_daily_move_pct) * 100.0

        passes = friction_ratio <= friction_ceiling_pct

        return {
            "valid": True,
            "median_daily_move_pct": round(median_daily_move_pct, 3),
            "bid_ask_spread_pct": round(bid_ask_spread_pct, 4),
            "round_trip_commission_pct": round(round_trip_comm_pct, 4),
            "round_trip_commission_cash": round(2.0 * single_comm, 2),
            "total_friction_pct": round(total_friction_pct, 4),
            "friction_ratio_pct": round(friction_ratio, 2),
            "friction_ceiling_pct": round(friction_ceiling_pct, 2),
            "passes_hurdle": passes,
            "institutional_verdict": "APPROVED_FRICTION" if passes else "REJECTED_EXCESSIVE_FRICTION"
        }

    @staticmethod
    def compute_information_coefficient(sentiment_scores: List[float], forward_returns: List[float]) -> Dict[str, Any]:
        """
        Calculates the Spearman Rank Information Coefficient (IC) between NLP catalyst polarity
        and forward price returns according to institutional factor research standards (Grinold & Kahn).
        Tests whether the sentiment signal exhibits statistically significant predictive rank power.
        Null Hypothesis (H0): IC = 0 (rank of sentiment has no correlation with forward return ranks).
        Alternative Hypothesis (H1): IC != 0 (systematic predictive alpha).
        """
        if len(sentiment_scores) != len(forward_returns):
            return {
                "valid": False,
                "reason": f"Mismatched array lengths: {len(sentiment_scores)} sentiment scores vs {len(forward_returns)} returns.",
                "sample_size": 0,
                "ic": 0.0,
                "t_stat": 0.0,
                "p_value": 1.0,
                "is_significant": False,
                "signal_strength": "INVALID_INPUT",
                "institutional_verdict": "REJECT_MISMATCHED_DIMENSIONS"
            }

        n = len(sentiment_scores)
        if n < 5:
            return {
                "valid": False,
                "reason": f"Insufficient sample size (N={n} < 5) to compute statistical Information Coefficient.",
                "sample_size": n,
                "ic": 0.0,
                "t_stat": 0.0,
                "p_value": 1.0,
                "is_significant": False,
                "signal_strength": "INSUFFICIENT_SAMPLE",
                "institutional_verdict": "REJECT_INSUFFICIENT_DATA"
            }

        def rank_array(arr: List[float]) -> List[float]:
            indexed = sorted(enumerate(arr), key=lambda x: x[1])
            ranks = [0.0] * len(arr)
            i = 0
            while i < len(indexed):
                j = i
                while j < len(indexed) - 1 and indexed[j + 1][1] == indexed[j][1]:
                    j += 1
                avg_rank = (i + j + 2.0) / 2.0
                for k in range(i, j + 1):
                    ranks[indexed[k][0]] = avg_rank
                i = j + 1
            return ranks

        rx = rank_array(sentiment_scores)
        ry = rank_array(forward_returns)

        mean_rx = sum(rx) / n
        mean_ry = sum(ry) / n

        cov_xy = sum((rx[i] - mean_rx) * (ry[i] - mean_ry) for i in range(n))
        var_x = sum((rx[i] - mean_rx) ** 2 for i in range(n))
        var_y = sum((ry[i] - mean_ry) ** 2 for i in range(n))

        denom = math.sqrt(var_x * var_y)
        if denom <= 1e-12:
            return {
                "valid": True,
                "sample_size": n,
                "ic": 0.0,
                "t_stat": 0.0,
                "p_value": 1.0,
                "is_significant": False,
                "signal_strength": "ZERO_VARIANCE",
                "institutional_verdict": "NO_VARIANCE_IN_RANKS"
            }

        ic = max(-1.0, min(1.0, cov_xy / denom))

        # Student's t-statistic for rank correlation with degrees of freedom df = n - 2
        df = n - 2
        if abs(ic) >= 0.999999:
            t_stat = 999.0 if ic > 0 else -999.0
            p_value = 0.0
        else:
            t_stat = ic * math.sqrt(df / max(1e-12, 1.0 - (ic ** 2)))
            p_value = 2.0 * (1.0 - QuantDiscoveryEngine._norm_cdf(abs(t_stat)))
            p_value = max(0.0, min(1.0, p_value))

        is_sig = (p_value < 0.05)
        abs_ic = abs(ic)
        if abs_ic >= 0.15 and is_sig:
            signal_strength = "STRONG_ALPHA_SIGNAL"
        elif abs_ic >= 0.05 and is_sig:
            signal_strength = "MODERATE_ALPHA_SIGNAL"
        elif is_sig:
            signal_strength = "WEAK_SIGNIFICANT_SIGNAL"
        else:
            signal_strength = "NOISE_OR_SPURIOUS"

        if is_sig and ic > 0:
            verdict = "CONFIRMED_PREDICTIVE_CATALYST"
        elif is_sig and ic < 0:
            verdict = "CONFIRMED_CONTRARIAN_CATALYST"
        else:
            verdict = "REJECT_UNPROVEN_CORRELATION"

        return {
            "valid": True,
            "sample_size": n,
            "ic": round(ic, 4),
            "t_stat": round(t_stat, 3),
            "p_value": round(p_value, 4),
            "degrees_of_freedom": df,
            "is_significant": is_sig,
            "signal_strength": signal_strength,
            "institutional_verdict": verdict
        }

    @staticmethod
    def _norm_cdf(x: float) -> float:
        """Approximation of the cumulative standard normal distribution function."""
        # Hastings approximation
        b1 = 0.319381530
        b2 = -0.356563782
        b3 = 1.781477937
        b4 = -1.821255978
        b5 = 1.330274429
        p = 0.2316419
        c = 0.39894228

        if x >= 0.0:
            t = 1.0 / (1.0 + p * x)
            return 1.0 - c * math.exp(-x * x / 2.0) * t * (t * (t * (t * (t * b5 + b4) + b3) + b2) + b1)
        else:
            t = 1.0 / (1.0 - p * x)
            return c * math.exp(-x * x / 2.0) * t * (t * (t * (t * (t * b5 + b4) + b3) + b2) + b1)

    @staticmethod
    def _linear_regression_slope(x: List[float], y: List[float]) -> float:
        """Calculates slope of ordinary least squares linear regression."""
        n = len(x)
        if n < 2: return 0.5
        mean_x = sum(x) / n
        mean_y = sum(y) / n
        num = sum((x[i] - mean_x) * (y[i] - mean_y) for i in range(n))
        den = sum((x[i] - mean_x) ** 2 for i in range(n))
        if den == 0: return 0.5
        return num / den

    @staticmethod
    def _wilson_score_interval(successes: int, trials: int, confidence: float = 0.95) -> Tuple[float, float]:
        """Computes Wilson score confidence interval for a binomial proportion."""
        if trials == 0: return (0.0, 1.0)
        z = 1.95996 # 95% confidence
        p = successes / trials
        denominator = 1.0 + (z ** 2) / trials
        center = (p + (z ** 2) / (2.0 * trials)) / denominator
        spread = (z * math.sqrt((p * (1.0 - p) / trials) + ((z ** 2) / (4.0 * (trials ** 2))))) / denominator
        return (max(0.0, center - spread), min(1.0, center + spread))
