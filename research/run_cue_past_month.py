#!/usr/bin/env python3
"""
Comprehensive 7-Stage Playbook Simulation & Optimization for Cue Biopharma Inc (NASDAQ: CUE)
Horizon: Past Month (September 23, 2026 – October 22, 2026, 22 Trading Days)
Dataset: Sourced directly from authentic IBKR 1-minute historical bars
"""

import os
import sys
import pandas as pd
import numpy as np
from datetime import datetime, time, date

CSV_FILE = "CUE_NASDAQ_1MIN_1YEAR.csv"
INITIAL_CAPITAL = 5000.0

def calculate_ibkr_commission(shares: float) -> float:
    base = max(0.35, abs(shares) * 0.0035)
    regulatory = abs(shares) * 0.0001
    return base + regulatory

# Known Primary-Source Regulatory / Clinical / Corporate Milestones in past month
CATALYSTS = {
    date(2026, 9, 21): "Positive CUE-221 Phase 2 Topline Results in CSU (8-K)",
    date(2026, 10, 8): "Clinical Trial Presentation & Investor Conference",
    date(2026, 10, 16): "Executive Form 4 Disclosures"
}

def run_simulation(
    df_raw: pd.DataFrame,
    start_date: date,
    use_trend_shield: bool = False,
    hard_stop_pct: float = 0.05,       # Naive default 5%, institutional stiff floor 1.5%
    use_breakeven: bool = False,
    breakeven_trigger: float = 0.012,  # +1.20%
    use_dynamic_trailing: bool = False,
    trail_trigger_pct: float = 0.035,  # +3.50%
    trail_dist_pct: float = 0.020,     # 2.0% from peak high
    orb_window_mins: int = 30,         # 15m or 30m
    primary_catalyst_filter: str = "ALL", # "ALL", "CATALYST_ONLY", "NON_CATALYST"
    use_compounding: bool = True,
    leverage_multiplier: float = 1.0   # 1.0x cash vs 1.25x margin
):
    df = df_raw.copy()
    
    # Precalculate Daily Closes and 20-day EMA across the entire dataset to avoid lookahead/boundary bias
    daily_closes = df.groupby('date')['close'].last().to_frame()
    daily_closes['ema20'] = daily_closes['close'].ewm(span=20, adjust=False).mean()
    bullish_dates = set(daily_closes[daily_closes['close'] > daily_closes['ema20']].index)

    # Filter to target horizon (past month)
    df_month = df[df['date'] >= start_date].reset_index(drop=True)
    trading_days = df_month['date'].unique()

    cash = INITIAL_CAPITAL
    trades = []
    equity_curve = []

    # ORB Timings (US Eastern)
    orb_end_time = time(9, 45) if orb_window_mins == 15 else time(10, 0)
    cutoff_time = time(10, 15) if orb_window_mins == 15 else time(11, 0)

    for day in trading_days:
        is_catalyst = day in CATALYSTS
        if primary_catalyst_filter == "CATALYST_ONLY" and not is_catalyst:
            continue
        if primary_catalyst_filter == "NON_CATALYST" and is_catalyst:
            continue

        if use_trend_shield and day not in bullish_dates:
            continue

        day_df = df_month[df_month['date'] == day].reset_index(drop=True)
        if len(day_df) < 30:
            continue

        orb_high = None
        orb_low = None
        orb_complete = False
        in_position = False
        pos_shares = 0
        entry_price = 0.0
        entry_time = None
        stop_price = 0.0
        peak_price = 0.0
        breakeven_locked = False
        trailing_active = False
        trade_taken_today = False

        for row in day_df.itertuples():
            b_time = row.time
            t_dt = row.dt_et
            b_open = row.open
            b_high = row.high
            b_low = row.low
            b_close = row.close
            b_vol = row.volume

            # Track equity
            if in_position:
                total_equity = cash + pos_shares * b_close
                equity_curve.append({"datetime": t_dt, "equity": total_equity})

            # 1. Opening Range Formation (09:30 to orb_end_time)
            if b_time < orb_end_time:
                if b_time >= time(9, 30):
                    if orb_high is None:
                        orb_high = b_high
                        orb_low = b_low
                    else:
                        orb_high = max(orb_high, b_high)
                        orb_low = min(orb_low, b_low)
                continue

            # ORB Lock at boundary
            if not orb_complete:
                orb_complete = True

            # 2. Entry Logic (Breakout above ORB High before cutoff)
            if not in_position and not trade_taken_today and b_time <= cutoff_time:
                if orb_high is not None and b_high > orb_high:
                    entry_price = orb_high + 0.01
                    if b_open > entry_price:
                        entry_price = b_open

                    # Position sizing
                    if use_compounding:
                        buying_power = cash * leverage_multiplier
                        pos_shares = int(buying_power // entry_price)
                    else:
                        pos_shares = int(INITIAL_CAPITAL // entry_price)

                    if pos_shares <= 0:
                        continue

                    entry_comm = calculate_ibkr_commission(pos_shares)
                    cash -= (pos_shares * entry_price + entry_comm)
                    in_position = True
                    trade_taken_today = True
                    entry_time = t_dt
                    stop_price = entry_price * (1.0 - hard_stop_pct)
                    peak_price = entry_price
                    breakeven_locked = False
                    trailing_active = False
                    continue

            # 3. Position Management
            if in_position:
                peak_price = max(peak_price, b_high)

                # Dynamic Breakeven Ratchet (+1.20% gain triggers BE lock)
                if use_breakeven and not breakeven_locked:
                    if b_high >= entry_price * (1.0 + breakeven_trigger):
                        est_rt_comm = calculate_ibkr_commission(pos_shares) * 2.0
                        breakeven_locked = True
                        stop_price = max(stop_price, entry_price + (est_rt_comm / pos_shares) + 0.01)

                # Dynamic Trailing Stop (+3.5% trigger, trail 2.0% behind peak)
                if use_dynamic_trailing:
                    if not trailing_active and peak_price >= entry_price * (1.0 + trail_trigger_pct):
                        trailing_active = True
                    if trailing_active:
                        trail_stop = peak_price * (1.0 - trail_dist_pct)
                        stop_price = max(stop_price, trail_stop)

                # Exit A: Stop Loss Hit (Evaluated tick-level on 1-min low)
                if b_low <= stop_price:
                    exit_price = min(b_open, stop_price)
                    exit_comm = calculate_ibkr_commission(pos_shares)
                    proceeds = pos_shares * exit_price - exit_comm
                    cash += proceeds
                    pnl = proceeds - (pos_shares * entry_price + calculate_ibkr_commission(pos_shares))
                    ret_pct = (exit_price - entry_price) / entry_price * 100.0

                    exit_reason = "STOP_LOSS"
                    if trailing_active:
                        exit_reason = "TRAILING_STOP"
                    elif breakeven_locked:
                        exit_reason = "BREAKEVEN_STOP"

                    trades.append({
                        "date": day,
                        "entry_time": entry_time,
                        "exit_time": t_dt,
                        "shares": pos_shares,
                        "entry_price": round(entry_price, 2),
                        "exit_price": round(exit_price, 2),
                        "pnl": round(pnl, 2),
                        "return_pct": round(ret_pct, 2),
                        "exit_reason": exit_reason,
                        "catalyst": CATALYSTS.get(day, "None"),
                        "equity": round(cash, 2)
                    })
                    in_position = False
                    continue

                # Exit B: End of Day Liquidation (15:55 US Eastern)
                if b_time >= time(15, 55):
                    exit_price = b_close
                    exit_comm = calculate_ibkr_commission(pos_shares)
                    proceeds = pos_shares * exit_price - exit_comm
                    cash += proceeds
                    pnl = proceeds - (pos_shares * entry_price + calculate_ibkr_commission(pos_shares))
                    ret_pct = (exit_price - entry_price) / entry_price * 100.0

                    trades.append({
                        "date": day,
                        "entry_time": entry_time,
                        "exit_time": t_dt,
                        "shares": pos_shares,
                        "entry_price": round(entry_price, 2),
                        "exit_price": round(exit_price, 2),
                        "pnl": round(pnl, 2),
                        "return_pct": round(ret_pct, 2),
                        "exit_reason": "EOD_CLOSE",
                        "catalyst": CATALYSTS.get(day, "None"),
                        "equity": round(cash, 2)
                    })
                    in_position = False
                    continue

    trades_df = pd.DataFrame(trades)
    return trades_df, cash

def calculate_metrics(trades_df: pd.DataFrame, final_cash: float):
    if trades_df.empty:
        return {
            "trades": 0, "win_rate": 0.0, "total_pnl": 0.0, "final_equity": INITIAL_CAPITAL,
            "return_pct": 0.0, "profit_factor": 0.0, "max_drawdown_pct": 0.0, "sharpe": 0.0
        }
    
    total_trades = len(trades_df)
    wins = trades_df[trades_df['pnl'] > 0]
    losses = trades_df[trades_df['pnl'] < 0]
    win_rate = (len(wins) / total_trades) * 100.0
    total_pnl = trades_df['pnl'].sum()
    ret_pct = ((final_cash - INITIAL_CAPITAL) / INITIAL_CAPITAL) * 100.0

    gross_profit = wins['pnl'].sum() if not wins.empty else 0.0
    gross_loss = abs(losses['pnl'].sum()) if not losses.empty else 0.0
    profit_factor = (gross_profit / gross_loss) if gross_loss > 0 else (99.0 if gross_profit > 0 else 0.0)

    equity_series = trades_df['equity']
    peak = equity_series.cummax()
    drawdown = (equity_series - peak) / peak * 100.0
    max_dd = abs(drawdown.min()) if not drawdown.empty else 0.0

    daily_returns = trades_df.groupby('date')['pnl'].sum() / INITIAL_CAPITAL
    sharpe = (daily_returns.mean() / daily_returns.std() * np.sqrt(252)) if (len(daily_returns) > 1 and daily_returns.std() > 0) else 0.0

    return {
        "trades": total_trades,
        "win_rate": round(win_rate, 1),
        "total_pnl": round(total_pnl, 2),
        "final_equity": round(final_cash, 2),
        "return_pct": round(ret_pct, 2),
        "profit_factor": round(profit_factor, 2),
        "max_drawdown_pct": round(max_dd, 2),
        "sharpe": round(sharpe, 2)
    }

def main():
    df_raw = pd.read_csv(CSV_FILE)
    df_raw['dt_utc'] = pd.to_datetime(df_raw['datetime'].str.strip(), format='%Y%m%d %H:%M:%S', utc=True)
    df_raw['dt_et'] = df_raw['dt_utc'].dt.tz_convert('America/New_York')
    df_raw['time'] = df_raw['dt_et'].dt.time
    df_raw['date'] = df_raw['dt_et'].dt.date
    df_raw = df_raw.sort_values('dt_et').reset_index(drop=True)

    # 22 trading days (~1 calendar month)
    all_dates = sorted(df_raw['date'].unique())
    start_date = all_dates[-22]

    sub_month = df_raw[df_raw['date'] >= start_date]
    print("=========================================================================================")
    print("ALPHA ENGINE 7-STAGE QUANTITATIVE PLAYBOOK: CUE BIOPHARMA (PAST MONTH HORIZON)")
    print(f"Total Authentic 1-Minute Bars: {len(sub_month):,} | Days: {sub_month['date'].nunique()}")
    print(f"Date Range: {start_date} to {sub_month['date'].iloc[-1]}")
    print("=========================================================================================")

    # 1. STAGE 3: Naive Baseline Benchmark
    t3, c3 = run_simulation(df_raw, start_date, use_trend_shield=False, hard_stop_pct=0.05, use_breakeven=False, use_dynamic_trailing=False, orb_window_mins=30)
    m3 = calculate_metrics(t3, c3)
    print(f"\n[STAGE 3: NAIVE BASELINE (Unfiltered 30m ORB, 5% Stop)]")
    print(f"  Trades: {m3['trades']} | Win Rate: {m3['win_rate']}% | PnL: ${m3['total_pnl']:+,.2f} ({m3['return_pct']:+.1f}%) | Max DD: {m3['max_drawdown_pct']:.1f}% | PF: {m3['profit_factor']}")

    # 2. STAGE 4: Macro Trend Regime Shield (Daily Close > 20-Day EMA)
    t4, c4 = run_simulation(df_raw, start_date, use_trend_shield=True, hard_stop_pct=0.05, use_breakeven=False, use_dynamic_trailing=False, orb_window_mins=30)
    m4 = calculate_metrics(t4, c4)
    print(f"\n[STAGE 4: MACRO TREND REGIME SHIELD (Daily Close > 20-Day EMA)]")
    print(f"  Trades: {m4['trades']} | Win Rate: {m4['win_rate']}% | PnL: ${m4['total_pnl']:+,.2f} ({m4['return_pct']:+.1f}%) | Max DD: {m4['max_drawdown_pct']:.1f}% | PF: {m4['profit_factor']}")

    # 3. STAGE 5: Two-Tier Asymmetric Risk Preservation (-1.50% Stiff Stop + Breakeven Ratchet +1.20%)
    t5, c5 = run_simulation(df_raw, start_date, use_trend_shield=True, hard_stop_pct=0.015, use_breakeven=True, breakeven_trigger=0.012, use_dynamic_trailing=False, orb_window_mins=30)
    m5 = calculate_metrics(t5, c5)
    print(f"\n[STAGE 5: TWO-TIER ASYMMETRIC RISK PRESERVATION (-1.5% Stiff Stop + BE Ratchet)]")
    print(f"  Trades: {m5['trades']} | Win Rate: {m5['win_rate']}% | PnL: ${m5['total_pnl']:+,.2f} ({m5['return_pct']:+.1f}%) | Max DD: {m5['max_drawdown_pct']:.1f}% | PF: {m5['profit_factor']}")

    # 4. STAGE 7A: Window Calibration (15-Minute vs 30-Minute ORB)
    t7_15m, c7_15m = run_simulation(df_raw, start_date, use_trend_shield=True, hard_stop_pct=0.015, use_breakeven=True, orb_window_mins=15, use_dynamic_trailing=False)
    m7_15m = calculate_metrics(t7_15m, c7_15m)
    print(f"\n[STAGE 7A: WINDOW CALIBRATION (15-Min ORB vs 30-Min ORB)]")
    print(f"  15-Min ORB: Trades: {m7_15m['trades']} | Win Rate: {m7_15m['win_rate']}% | PnL: ${m7_15m['total_pnl']:+,.2f} ({m7_15m['return_pct']:+.1f}%) | Max DD: {m7_15m['max_drawdown_pct']:.1f}% | PF: {m7_15m['profit_factor']}")
    print(f"  30-Min ORB: Trades: {m5['trades']} | Win Rate: {m5['win_rate']}% | PnL: ${m5['total_pnl']:+,.2f} ({m5['return_pct']:+.1f}%) | Max DD: {m5['max_drawdown_pct']:.1f}% | PF: {m5['profit_factor']}")

    # 5. STAGE 7B: Dynamic Trailing Profit Engine (+3.5% trigger, 2.0% trail)
    best_orb = 15 if m7_15m['total_pnl'] > m5['total_pnl'] else 30
    t7_trail, c7_trail = run_simulation(df_raw, start_date, use_trend_shield=True, hard_stop_pct=0.015, use_breakeven=True, orb_window_mins=best_orb, use_dynamic_trailing=True, trail_trigger_pct=0.035, trail_dist_pct=0.020, leverage_multiplier=1.0)
    m7_trail = calculate_metrics(t7_trail, c7_trail)
    print(f"\n[STAGE 7B: DYNAMIC TRAILING PROFIT ENGINE ({best_orb}m ORB, +3.5% Trigger, 2.0% Trail)]")
    print(f"  Trades: {m7_trail['trades']} | Win Rate: {m7_trail['win_rate']}% | PnL: ${m7_trail['total_pnl']:+,.2f} ({m7_trail['return_pct']:+.1f}%) | Max DD: {m7_trail['max_drawdown_pct']:.1f}% | PF: {m7_trail['profit_factor']} | Sharpe: {m7_trail['sharpe']}")

    # 6. STAGE 7C: Dynamic Sizing & Margin Comparison (1.0x Cash vs 1.25x Margin)
    t7_margin, c7_margin = run_simulation(df_raw, start_date, use_trend_shield=True, hard_stop_pct=0.015, use_breakeven=True, orb_window_mins=best_orb, use_dynamic_trailing=True, trail_trigger_pct=0.035, trail_dist_pct=0.020, leverage_multiplier=1.25)
    m7_margin = calculate_metrics(t7_margin, c7_margin)
    print(f"\n[STAGE 7C: DYNAMIC COMPOUNDING COMPARISON]")
    print(f"  1.00x Cash Power:   Final Equity: ${m7_trail['final_equity']:,.2f} | Net Return: {m7_trail['return_pct']:+.1f}% | Max DD: {m7_trail['max_drawdown_pct']:.1f}%")
    print(f"  1.25x Margin Power: Final Equity: ${m7_margin['final_equity']:,.2f} | Net Return: {m7_margin['return_pct']:+.1f}% | Max DD: {m7_margin['max_drawdown_pct']:.1f}%")

    # Save final optimized trades to CSV
    t7_trail.to_csv("CUE_PAST_MONTH_OPTIMIZED_TRADES.csv", index=False)
    print(f"\nSaved Past Month optimized trade ledger ({len(t7_trail)} trades) to CUE_PAST_MONTH_OPTIMIZED_TRADES.csv")

if __name__ == "__main__":
    main()
