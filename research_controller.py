"""
Integrated Python CLI & Controller for the Quantitative Research Lab.
Acts as the single deterministic bridge called by backend endpoints (server.ts / FastAPI).

Subcommands:
  - resolve: Maps query to IBKR contracts
  - sanitize: Parses natural language risk and clamps to master envelope
  - analyze: Ingests market + event data, runs runs-test, Hurst, friction, and event correlation
  - audit: Evaluates backtest results under López de Prado Deflated Sharpe Ratio
"""

import sys
import json
import argparse
from typing import Dict, Any

from contract_resolver import ContractResolver
from risk_sanitizer import RiskSanitizer
from quant_discovery import QuantDiscoveryEngine
from news_event_correlator import NewsEventCorrelator
from institutional_auditor import InstitutionalBacktestAuditor
from universe_models import NewsEvent


def handle_resolve(args) -> Dict[str, Any]:
    resolver = ContractResolver()
    return resolver.resolve_instrument(args.query)


def handle_sanitize(args) -> Dict[str, Any]:
    raw = RiskSanitizer.parse_natural_language_intent(args.prompt)
    sanitized = RiskSanitizer.sanitize_and_clamp_parameters(raw)
    return {
        "raw_parsed": raw,
        "sanitized_parameters": sanitized
    }


def handle_analyze(args) -> Dict[str, Any]:
    with open(args.input_json, "r", encoding="utf-8") as f:
        payload = json.load(f)

    symbol = payload.get("symbol", "ASML")
    bars = payload.get("bars", [])
    events_raw = payload.get("news_events", [])
    friction_ceiling = payload.get("friction_ceiling_pct", 15.0)
    is_european = payload.get("is_european", True)

    events = [
        NewsEvent(
            event_id=e.get("event_id", f"EV_{i}"),
            timestamp=e.get("timestamp", ""),
            source=e.get("source", "UNKNOWN"),
            headline=e.get("headline", ""),
            body=e.get("body", ""),
            symbols_mentioned=e.get("symbols_mentioned", [symbol]),
            event_type=e.get("event_type", "general"),
            urgency=e.get("urgency", "MEDIUM")
        )
        for i, e in enumerate(events_raw)
    ]

    # Calculate returns and price moves
    returns = []
    prices = [b["close"] for b in bars]
    for i in range(1, len(bars)):
        p0 = bars[i - 1]["close"]
        p1 = bars[i]["close"]
        returns.append((p1 - p0) / p0 if p0 > 0 else 0.0)

    # 1. Wald-Wolfowitz Runs Test
    runs_test = QuantDiscoveryEngine.wald_wolfowitz_runs_test(returns)

    # 2. Hurst Exponent
    hurst = QuantDiscoveryEngine.calculate_hurst_exponent(prices)

    # 3. Markov State Transitions
    markov = QuantDiscoveryEngine.markov_transition_matrix(returns)

    # 4. Friction Hurdle
    abs_moves = [abs(r) * 100.0 for r in returns]
    median_move = sorted(abs_moves)[len(abs_moves) // 2] if abs_moves else 1.0
    latest_price = prices[-1] if prices else 100.0

    friction = QuantDiscoveryEngine.evaluate_friction_hurdle(
        median_daily_move_pct=median_move,
        bid_ask_spread_pct=payload.get("bid_ask_spread_pct", 0.05),
        price=latest_price,
        is_european=is_european,
        quantity=payload.get("quantity", 50.0),
        friction_ceiling_pct=friction_ceiling
    )

    # 5. News Event Correlation
    correlator = NewsEventCorrelator()
    news_correlation = correlator.correlate_anomalies_with_events(
        symbol=symbol,
        daily_bars=bars,
        news_events=events,
        sigma_threshold=1.5
    )

    return {
        "symbol": symbol.upper(),
        "quant_discovery": {
            "runs_test": runs_test,
            "hurst_exponent": hurst,
            "markov_transitions": markov,
            "friction_hurdle": friction
        },
        "news_event_correlation": news_correlation
    }


def handle_audit(args) -> Dict[str, Any]:
    with open(args.input_json, "r", encoding="utf-8") as f:
        payload = json.load(f)

    trades = payload.get("trades", [])
    balance_history = payload.get("balance_history", [])
    starting_capital = payload.get("starting_capital", 100000.0)
    trials_tested = payload.get("trials_tested", 1)

    return InstitutionalBacktestAuditor.audit_backtest(
        trades=trades,
        balance_history=balance_history,
        starting_capital=starting_capital,
        trials_tested=trials_tested
    )


def main():
    parser = argparse.ArgumentParser(description="Alpha Engine Quantitative Research Lab Controller")
    subparsers = parser.add_subparsers(dest="command")

    # resolve
    p_res = subparsers.add_parser("resolve")
    p_res.add_argument("--query", required=True, help="Company name or ticker")

    # sanitize
    p_san = subparsers.add_parser("sanitize")
    p_san.add_argument("--prompt", required=True, help="Natural language risk instruction")

    # analyze
    p_ana = subparsers.add_parser("analyze")
    p_ana.add_argument("--input-json", required=True, help="Path to JSON with bars and news events")

    # audit
    p_aud = subparsers.add_parser("audit")
    p_aud.add_argument("--input-json", required=True, help="Path to JSON with trades and balance history")

    args = parser.parse_args()

    if args.command == "resolve":
        out = handle_resolve(args)
    elif args.command == "sanitize":
        out = handle_sanitize(args)
    elif args.command == "analyze":
        out = handle_analyze(args)
    elif args.command == "audit":
        out = handle_audit(args)
    else:
        out = {"error": f"Unknown or missing command: {args.command}"}

    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
