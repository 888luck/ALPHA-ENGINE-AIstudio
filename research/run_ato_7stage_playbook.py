#!/usr/bin/env python3
"""
Comprehensive 7-Stage Playbook Simulation & Optimization for Atos Group SE (ATO - Euronext Paris)
Evaluates:
  Stage 3: Naive Baseline (Unfiltered ORB, no trend shield, no stiff floor)
  Stage 4: Trend Shield (Daily Close > EMA-20)
  Stage 5: Two-Tier Risk Guard (-1.5% Stiff Tick Floor + Breakeven Lock)
  Stage 6: Primary Filings & Earnings Window Correlation
  Stage 7: Window Calibration (15m vs 30m ORB) & Dynamic Trailing Profit (+3.5% trigger, trailing stop)
"""

import os
import sys
import pandas as pd
import numpy as np
from datetime import datetime, time, timedelta

CSV_FILE = "ATO_EURONEXT_1MIN_1YEAR.csv"
INITIAL_CAPITAL = 5000.0

# IBKR Europe (IBIE/SBF) Institutional Commission Model
COMMISSION_PCT = 0.0005   # 0.05%
MIN_COMMISSION = 1.25     # €1.25 min
CLEARING_FEE = 0.50       # €0.50 clearing fee per order

def calculate_ibkr_commission(shares: float, price: float) -> float:
    trade_value = abs(shares * price)
    base = max(MIN_COMMISSION, trade_value * COMMISSION_PCT)
    return base + CLEARING_FEE

def run_simulation(
    use_trend_shield: bool = False,
    hard_stop_pct: float = 0.05,       # Naive default 5%, institutional stiff floor 1.5%
    use_breakeven: bool = False,
    breakeven_trigger: float = 0.012,  # +1.20%
    use_dynamic_trailing: bool = False,
    trail_trigger_pct: float = 0.035,  # +3.5%
    trail_dist_pct: float = 0.018,     # 1.8% from peak
    orb_window_mins: int = 30,         # 15m or 30m
    min_volume_threshold: float = 500.0,
    take_profit_pct: float = 0.030,
    primary_catalyst_only: bool = False,
    catalyst_dates: set = None
):
    df = pd.read_csv(CSV_FILE)
    df['dt_utc'] = pd.to_datetime(df['datetime'].str.strip(), format='%Y%m%d %H:%M:%S', utc=True)
    df['dt_cet'] = df['dt_utc'].dt.tz_convert('Europe/Paris')
    df = df.sort_values('dt_cet').reset_index(drop=True)
    df['date'] = df['dt_cet'].dt.date

    trading_days = df['date'].unique()

    # Precalculate Daily Closes and 20-day EMA
    daily_closes = df.groupby('date')['close'].last().to_frame()
    daily_closes['ema20'] = daily_closes['close'].ewm(span=20, adjust=False).mean()
    bullish_dates = set(daily_closes[daily_closes['close'] > daily_closes['ema20']].index)

    cash = INITIAL_CAPITAL
    trades = []
    equity_curve = []

    orb_end_time = time(9, 15) if orb_window_mins == 15 else time(9, 30)
    cutoff_time = time(9, 45) if orb_window_mins == 15 else time(10, 30)

    for day in trading_days:
        if use_trend_shield and day not in bullish_dates:
            continue

        if primary_catalyst_only and catalyst_dates is not None and day not in catalyst_dates:
            continue

        day_df = df[df['date'] == day].reset_index(drop=True)
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
        trade_taken_today = False

        for row in day_df.itertuples():
            b_time = row.dt_cet.time()
            t_dt = row.dt_cet
            b_open = row.open
            b_high = row.high
            b_low = row.low
            b_close = row.close
            b_vol = row.volume

            # Track equity
            if in_position:
                total_equity = cash + pos_shares * b_close
                equity_curve.append({"datetime": t_dt, "equity": total_equity})
            else:
                equity_curve.append({"datetime": t_dt, "equity": cash})

            # Phase 1: Opening Range formation
            if time(9, 0) <= b_time < orb_end_time:
                if orb_high is None or b_high > orb_high:
                    orb_high = b_high
                if orb_low is None or b_low < orb_low:
                    orb_low = b_low
                continue

            if b_time >= orb_end_time and not orb_complete:
                if orb_high is not None and orb_low is not None:
                    orb_complete = True

            if not orb_complete:
                continue

            # Phase 2: In position management
            if in_position:
                peak_price = max(peak_price, b_high)

                # Check Dynamic Trailing Profit
                if use_dynamic_trailing:
                    gain_from_entry = (peak_price - entry_price) / entry_price
                    if gain_from_entry >= trail_trigger_pct:
                        trail_stop = peak_price * (1.0 - trail_dist_pct)
                        stop_price = max(stop_price, trail_stop)

                # Check Breakeven Lock
                if use_breakeven and not breakeven_locked:
                    gain_from_entry = (b_high - entry_price) / entry_price
                    if gain_from_entry >= breakeven_trigger:
                        # Move stop to entry + friction
                        comm = calculate_ibkr_commission(pos_shares, entry_price) * 2
                        friction_per_share = comm / pos_shares
                        stop_price = max(stop_price, entry_price + friction_per_share)
                        breakeven_locked = True

                # Check Take Profit (if dynamic trailing is disabled or as upper cap)
                if not use_dynamic_trailing and b_high >= entry_price * (1.0 + take_profit_pct):
                    exit_px = entry_price * (1.0 + take_profit_pct)
                    comm_out = calculate_ibkr_commission(pos_shares, exit_px)
                    pnl = pos_shares * (exit_px - entry_price) - (entry_comm + comm_out)
                    cash += pos_shares * exit_px - comm_out
                    trades.append({
                        "entry_time": entry_time, "exit_time": t_dt,
                        "entry_price": entry_price, "exit_price": exit_px,
                        "shares": pos_shares, "pnl": pnl, "pnl_pct": (exit_px/entry_price - 1)*100,
                        "reason": "TAKE_PROFIT", "capital": cash
                    })
                    in_position = False
                    continue

                # Check Stop Loss / Trailing Stop
                if b_low <= stop_price:
                    exit_px = stop_price
                    comm_out = calculate_ibkr_commission(pos_shares, exit_px)
                    pnl = pos_shares * (exit_px - entry_price) - (entry_comm + comm_out)
                    cash += pos_shares * exit_px - comm_out
                    reason = "TRAIL_STOP" if (use_dynamic_trailing and stop_price > entry_price) else ("BREAKEVEN" if breakeven_locked and stop_price >= entry_price else "STOP_LOSS")
                    trades.append({
                        "entry_time": entry_time, "exit_time": t_dt,
                        "entry_price": entry_price, "exit_price": exit_px,
                        "shares": pos_shares, "pnl": pnl, "pnl_pct": (exit_px/entry_price - 1)*100,
                        "reason": reason, "capital": cash
                    })
                    in_position = False
                    continue

                # End of Day Flatten at 17:25 CET
                if b_time >= time(17, 25):
                    exit_px = b_close
                    comm_out = calculate_ibkr_commission(pos_shares, exit_px)
                    pnl = pos_shares * (exit_px - entry_price) - (entry_comm + comm_out)
                    cash += pos_shares * exit_px - comm_out
                    trades.append({
                        "entry_time": entry_time, "exit_time": t_dt,
                        "entry_price": entry_price, "exit_price": exit_px,
                        "shares": pos_shares, "pnl": pnl, "pnl_pct": (exit_px/entry_price - 1)*100,
                        "reason": "EOD_FLATTEN", "capital": cash
                    })
                    in_position = False
                    continue

            # Phase 3: Entry Scanning
            if not in_position and not trade_taken_today:
                if b_time > cutoff_time:
                    continue

                # Breakout signal: Close > ORB High with volume check
                if b_close > orb_high and b_vol >= min_volume_threshold:
                    entry_price = b_close
                    pos_shares = int(cash // entry_price)
                    if pos_shares <= 0:
                        continue

                    entry_comm = calculate_ibkr_commission(pos_shares, entry_price)
                    cost = pos_shares * entry_price + entry_comm
                    if cost > cash:
                        pos_shares -= 1
                        if pos_shares <= 0:
                            continue
                        entry_comm = calculate_ibkr_commission(pos_shares, entry_price)

                    cash -= (pos_shares * entry_price + entry_comm)
                    entry_time = t_dt
                    stop_price = entry_price * (1.0 - hard_stop_pct)
                    peak_price = entry_price
                    breakeven_locked = False
                    in_position = True
                    trade_taken_today = True

    # Compile performance
    tr_df = pd.DataFrame(trades)
    total_trades = len(tr_df)
    if total_trades == 0:
        return {"total_trades": 0, "net_pnl": 0.0, "return_pct": 0.0, "win_rate": 0.0, "profit_factor": 0.0, "max_dd": 0.0}

    wins = tr_df[tr_df['pnl'] > 0]
    losses = tr_df[tr_df['pnl'] < 0]
    win_rate = len(wins) / total_trades * 100
    gross_profits = wins['pnl'].sum() if len(wins) > 0 else 0.0
    gross_losses = abs(losses['pnl'].sum()) if len(losses) > 0 else 0.0
    profit_factor = (gross_profits / gross_losses) if gross_losses > 0 else 999.0
    net_pnl = tr_df['pnl'].sum()
    ret_pct = (net_pnl / INITIAL_CAPITAL) * 100

    eq_df = pd.DataFrame(equity_curve)
    if not eq_df.empty:
        eq_df['peak'] = eq_df['equity'].cummax()
        eq_df['dd'] = (eq_df['equity'] - eq_df['peak']) / eq_df['peak'] * 100
        max_dd = eq_df['dd'].min()
    else:
        max_dd = 0.0

    return {
        "total_trades": total_trades,
        "wins": len(wins),
        "losses": len(losses),
        "win_rate": win_rate,
        "gross_profits": gross_profits,
        "gross_losses": gross_losses,
        "profit_factor": profit_factor,
        "net_pnl": net_pnl,
        "ending_capital": INITIAL_CAPITAL + net_pnl,
        "return_pct": ret_pct,
        "max_dd": max_dd,
        "trades_df": tr_df
    }

if __name__ == "__main__":
    print("="*80)
    print("STAGE 3: NAIVE BASELINE (30m ORB, No Trend Shield, 5% Stop, Fixed 3% Target)")
    print("="*80)
    res_s3 = run_simulation(
        use_trend_shield=False,
        hard_stop_pct=0.05,
        use_breakeven=False,
        use_dynamic_trailing=False,
        orb_window_mins=30,
        min_volume_threshold=100.0,
        take_profit_pct=0.03
    )
    print(f"Trades: {res_s3['total_trades']} | Win Rate: {res_s3['win_rate']:.1f}% | Net PnL: €{res_s3['net_pnl']:,.2f} ({res_s3['return_pct']:.2f}%) | Profit Factor: {res_s3['profit_factor']:.2f} | Max DD: {res_s3['max_dd']:.2f}%")

    print("\n" + "="*80)
    print("STAGE 4: MACRO TREND SHIELD (Daily Close > EMA-20 Filter)")
    print("="*80)
    res_s4 = run_simulation(
        use_trend_shield=True,
        hard_stop_pct=0.05,
        use_breakeven=False,
        use_dynamic_trailing=False,
        orb_window_mins=30,
        min_volume_threshold=100.0,
        take_profit_pct=0.03
    )
    print(f"Trades: {res_s4['total_trades']} | Win Rate: {res_s4['win_rate']:.1f}% | Net PnL: €{res_s4['net_pnl']:,.2f} ({res_s4['return_pct']:.2f}%) | Profit Factor: {res_s4['profit_factor']:.2f} | Max DD: {res_s4['max_dd']:.2f}%")

    print("\n" + "="*80)
    print("STAGE 5: TWO-TIER RISK GUARD (-1.5% Stiff Tick Floor + Breakeven Lock at +1.2%)")
    print("="*80)
    res_s5 = run_simulation(
        use_trend_shield=True,
        hard_stop_pct=0.015,
        use_breakeven=True,
        breakeven_trigger=0.012,
        use_dynamic_trailing=False,
        orb_window_mins=30,
        min_volume_threshold=500.0,
        take_profit_pct=0.03
    )
    print(f"Trades: {res_s5['total_trades']} | Win Rate: {res_s5['win_rate']:.1f}% | Net PnL: €{res_s5['net_pnl']:,.2f} ({res_s5['return_pct']:.2f}%) | Profit Factor: {res_s5['profit_factor']:.2f} | Max DD: {res_s5['max_dd']:.2f}%")

    print("\n" + "="*80)
    print("STAGE 6: PRIMARY CATALYST & FILINGS CORRELATION")
    print("="*80)
    # Catalyst events window: +/- 3 days around primary releases
    # 2025: Oct 20 (Q3 update), Jan 21 2026 (Prelim), Mar 6 2026 (FY2025 results), Apr 20 2026 (Q1), Jul 30 2026 (H1), Oct 21 2026 (Q3)
    catalyst_dates_list = [
        datetime(2025, 10, 20).date(), datetime(2026, 1, 21).date(),
        datetime(2026, 3, 6).date(), datetime(2026, 4, 20).date(),
        datetime(2026, 7, 30).date(), datetime(2026, 10, 21).date()
    ]
    catalyst_window = set()
    for cd in catalyst_dates_list:
        for offset in range(-2, 4):
            catalyst_window.add(cd + timedelta(days=offset))

    res_s6 = run_simulation(
        use_trend_shield=True,
        hard_stop_pct=0.015,
        use_breakeven=True,
        breakeven_trigger=0.012,
        use_dynamic_trailing=False,
        orb_window_mins=30,
        min_volume_threshold=500.0,
        take_profit_pct=0.03,
        primary_catalyst_only=True,
        catalyst_dates=catalyst_window
    )
    print(f"Trades: {res_s6['total_trades']} | Win Rate: {res_s6['win_rate']:.1f}% | Net PnL: €{res_s6['net_pnl']:,.2f} ({res_s6['return_pct']:.2f}%) | Profit Factor: {res_s6['profit_factor']:.2f} | Max DD: {res_s6['max_dd']:.2f}%")

    print("\n" + "="*80)
    print("STAGE 7: WINDOW OPTIMIZATION (15m vs 30m) & DYNAMIC TRAILING PROFIT")
    print("="*80)
    for win_mins in [15, 30]:
        for trail_trig in [0.025, 0.035, 0.045]:
            for trail_dist in [0.015, 0.018, 0.020]:
                res_opt = run_simulation(
                    use_trend_shield=True,
                    hard_stop_pct=0.015,
                    use_breakeven=True,
                    breakeven_trigger=0.012,
                    use_dynamic_trailing=True,
                    trail_trigger_pct=trail_trig,
                    trail_dist_pct=trail_dist,
                    orb_window_mins=win_mins,
                    min_volume_threshold=500.0
                )
                print(f"[{win_mins}m ORB | TrailTrig={trail_trig*100:.1f}% | TrailDist={trail_dist*100:.1f}%] -> "
                      f"Trades: {res_opt['total_trades']:2d} | WinRate: {res_opt['win_rate']:5.1f}% | "
                      f"Net PnL: €{res_opt['net_pnl']:+8.2f} ({res_opt['return_pct']:+6.2f}%) | "
                      f"PF: {res_opt['profit_factor']:5.2f} | Max DD: {res_opt['max_dd']:5.2f}%")
