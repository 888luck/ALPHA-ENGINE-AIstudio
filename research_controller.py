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
from backtester import AlphaBacktestingEngine


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


def handle_schedule(args) -> Dict[str, Any]:
    from market_hours_resolver import MarketHoursResolver
    from datetime import datetime, timezone
    from zoneinfo import ZoneInfo

    resolver = MarketHoursResolver(flatten_buffer_mins=15)
    us_session = resolver.resolve_session(is_european=False, exchange_code="XNYS")
    eu_session = resolver.resolve_session(is_european=True, exchange_code="XPAR")

    us_phase, us_countdown = resolver.determine_phase(us_session)
    eu_phase, eu_countdown = resolver.determine_phase(eu_session)
    dst_info = resolver.resolve_dst_desync()

    now_utc = datetime.now(timezone.utc)
    ny_now = now_utc.astimezone(ZoneInfo("America/New_York"))
    cet_now = now_utc.astimezone(ZoneInfo("Europe/Paris"))

    us_flatten = us_session.get("flatten_start")
    eu_flatten = eu_session.get("flatten_start")

    return {
        "status": "success",
        "timestamp_utc": now_utc.isoformat(),
        "ny_time_est": ny_now.strftime("%H:%M"),
        "cet_time_cet": cet_now.strftime("%H:%M"),
        "us": {
            "exchange": us_session.get("exchange", "XNYS"),
            "is_open": us_session.get("is_open", False),
            "phase": us_phase,
            "countdown": us_countdown,
            "open_time": us_session.get("open_time_str", "09:30"),
            "close_time": us_session.get("close_time_str", "16:00"),
            "moc_flatten_cutoff": us_flatten.strftime("%H:%M") if us_flatten else "15:45",
            "is_early_close": us_session.get("close_time_str", "16:00") != "16:00",
            "source": us_session.get("source", "UNKNOWN")
        },
        "eu": {
            "exchange": eu_session.get("exchange", "XPAR"),
            "is_open": eu_session.get("is_open", False),
            "phase": eu_phase,
            "countdown": eu_countdown,
            "open_time": eu_session.get("open_time_str", "09:00"),
            "close_time": eu_session.get("close_time_str", "17:30"),
            "moc_flatten_cutoff": eu_flatten.strftime("%H:%M") if eu_flatten else "17:15",
            "is_early_close": eu_session.get("close_time_str", "17:30") != "17:30",
            "source": eu_session.get("source", "UNKNOWN")
        },
        "dst_desync": dst_info
    }


def handle_discovery(args) -> Dict[str, Any]:
    symbol = args.symbol.upper()
    timeframe = getattr(args, "timeframe", "1h") or "1h"
    start_date = getattr(args, "start_date", "2026-05-01") or "2026-05-01"
    end_date = getattr(args, "end_date", "2026-06-16") or "2026-06-16"

    engine = AlphaBacktestingEngine()
    try:
        bars = engine.generate_synthetic_history(symbol, timeframe, start_date, end_date)
    except Exception as e:
        return {"status": "ERROR", "error": str(e)}

    prices = [b["close"] for b in bars]
    returns = [(prices[i] - prices[i - 1]) / prices[i - 1] for i in range(1, len(prices))] if len(prices) > 1 else []

    runs_test = QuantDiscoveryEngine.wald_wolfowitz_runs_test(returns)
    hurst = QuantDiscoveryEngine.calculate_hurst_exponent(prices)
    markov = QuantDiscoveryEngine.markov_transition_matrix(returns)

    # Determine regime recommendation
    h_val = hurst.get("hurst_exponent", 0.50)
    is_trending = h_val > 0.55
    is_mean_rev = h_val < 0.45

    if is_trending:
        verdict = "PERSISTENT_TRENDING"
        guidance = "Asset exhibits momentum persistence (Hurst > 0.55). Favour trend breakouts, wider trailing ATR stops (2.0x-2.6x), and extended hold bars."
    elif is_mean_rev:
        verdict = "MEAN_REVERTING"
        guidance = "Asset exhibits alternating mean-reversion (Hurst < 0.45). Favour tight stop ATR (1.2x-1.5x), fast tranche scaling, and breakeven lock."
    else:
        verdict = "RANDOM_WALK"
        guidance = "Asset return sequence is statistically indistinguishable from Geometric Brownian Motion (0.45 <= Hurst <= 0.55). Require strict OFI volume gate."

    return {
        "status": "SUCCESS",
        "symbol": symbol,
        "timeframe": timeframe,
        "total_bars": len(bars),
        "regime": verdict,
        "guidance": guidance,
        "quant_discovery": {
            "hurst_exponent": hurst,
            "runs_test": runs_test,
            "markov_transitions": markov
        }
    }


def handle_sweep(args) -> Dict[str, Any]:
    symbol = args.symbol.upper()
    timeframe = getattr(args, "timeframe", "1h") or "1h"
    capital = float(getattr(args, "capital", 100000.0) or 100000.0)
    trials = int(getattr(args, "trials", 16) or 16)
    start_date = getattr(args, "start_date", "2026-05-01") or "2026-05-01"
    end_date = getattr(args, "end_date", "2026-06-16") or "2026-06-16"

    engine = AlphaBacktestingEngine(starting_capital=capital)
    return engine.run_parameter_sweep(
        symbol=symbol,
        timeframe=timeframe,
        start_date=start_date,
        end_date=end_date,
        capital_override=capital,
        trials_count=trials
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

    # schedule
    subparsers.add_parser("schedule", help="Resolve authoritative exchange schedules and MOC cutoffs")

    # discovery
    p_disc = subparsers.add_parser("discovery", help="Run Wald-Wolfowitz, Hurst exponent, and Markov transitions on symbol")
    p_disc.add_argument("--symbol", required=True, help="Ticker symbol")
    p_disc.add_argument("--timeframe", default="1h", help="Timeframe (e.g. 1h, 15m)")
    p_disc.add_argument("--start-date", default="2026-05-01")
    p_disc.add_argument("--end-date", default="2026-06-16")

    # sweep
    p_swp = subparsers.add_parser("sweep", help="Run multi-parameter optimization sweep with DSR audit")
    p_swp.add_argument("--symbol", required=True, help="Ticker symbol")
    p_swp.add_argument("--timeframe", default="1h", help="Timeframe (e.g. 1h, 15m)")
    p_swp.add_argument("--capital", type=float, default=100000.0, help="Starting capital")
    p_swp.add_argument("--trials", type=int, default=16, help="Permutation count (default 16)")
    p_swp.add_argument("--start-date", default="2026-05-01")
    p_swp.add_argument("--end-date", default="2026-06-16")

    args = parser.parse_args()

    if args.command == "resolve":
        out = handle_resolve(args)
    elif args.command == "sanitize":
        out = handle_sanitize(args)
    elif args.command == "analyze":
        out = handle_analyze(args)
    elif args.command == "audit":
        out = handle_audit(args)
    elif args.command == "schedule":
        out = handle_schedule(args)
    elif args.command == "discovery":
        out = handle_discovery(args)
    elif args.command == "sweep":
        out = handle_sweep(args)
    else:
        out = {"error": f"Unknown or missing command: {args.command}"}

    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
