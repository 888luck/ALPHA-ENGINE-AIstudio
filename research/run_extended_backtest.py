import os
import math
import pandas as pd
import numpy as np
from datetime import datetime, time

CSV_FILE = "ONWD_EURONEXT_1MIN_1YEAR.csv"
INITIAL_CAPITAL = 5000.0

def calculate_ibkr_commission(shares: float, price: float) -> float:
    trade_value = abs(shares * price)
    base = max(1.25, trade_value * 0.0005)
    return base + 0.50

def run_simulation(df, trading_days, 
                   long_only=True, 
                   min_breakout_vol=1000, 
                   entry_cutoff_hour=10, 
                   entry_cutoff_min=30,
                   tp_pct=0.025, 
                   atr_mult=1.2, 
                   breakeven_trigger_pct=0.012,
                   min_orb_range_pct=0.008):
    
    cash = INITIAL_CAPITAL
    trades = []
    equity_curve = []
    fifteen_min_bars = []
    
    def compute_15m_atr():
        if len(fifteen_min_bars) < 15:
            return 0.0
        return float(np.mean([b['tr'] for b in fifteen_min_bars[-14:]]))

    cutoff_time = time(entry_cutoff_hour, entry_cutoff_min)

    for day in trading_days:
        day_df = df[df['date'] == day].reset_index(drop=True)
        if len(day_df) < 30:
            continue

        orb_high = None
        orb_low = None
        orb_complete = False
        trade_taken_today = False

        in_position = False
        pos_direction = 0
        pos_shares = 0
        entry_price = 0.0
        entry_time = None
        take_profit_price = 0.0
        stop_price = 0.0
        trailing_anchor_close = 0.0
        breakeven_activated = False

        current_15m = None

        for row in day_df.itertuples():
            bar_time = row.dt_cet.time()
            t_dt = row.dt_cet
            b_open = row.open
            b_high = row.high
            b_low = row.low
            b_close = row.close
            b_vol = row.volume

            # Record mark-to-market equity
            if in_position:
                unrealized = pos_shares * (b_close - entry_price) if pos_direction == 1 else pos_shares * (entry_price - b_close)
                current_equity = cash + unrealized
            else:
                current_equity = cash
            equity_curve.append({"datetime": t_dt, "equity": current_equity})

            # Update 15m candle
            minute_bucket = (t_dt.minute // 15) * 15
            bucket_time = t_dt.replace(minute=minute_bucket, second=0, microsecond=0)

            fifteen_min_closed = False
            if current_15m is None:
                current_15m = {"bucket": bucket_time, "open": b_open, "high": b_high, "low": b_low, "close": b_close}
            elif current_15m["bucket"] == bucket_time:
                current_15m["high"] = max(current_15m["high"], b_high)
                current_15m["low"] = min(current_15m["low"], b_low)
                current_15m["close"] = b_close
            else:
                prev_close = fifteen_min_bars[-1]["close"] if len(fifteen_min_bars) > 0 else current_15m["open"]
                hl = current_15m["high"] - current_15m["low"]
                hc = abs(current_15m["high"] - prev_close)
                lc = abs(current_15m["low"] - prev_close)
                current_15m["tr"] = max(hl, hc, lc)
                fifteen_min_bars.append(current_15m)
                fifteen_min_closed = True
                completed_15m_bar = current_15m
                current_15m = {"bucket": bucket_time, "open": b_open, "high": b_high, "low": b_low, "close": b_close}

            # 1. Opening Range Formation (09:00 - 09:30 CET)
            if time(9, 0) <= bar_time < time(9, 30):
                if orb_high is None or b_high > orb_high:
                    orb_high = b_high
                if orb_low is None or b_low < orb_low:
                    orb_low = b_low
                continue

            if bar_time >= time(9, 30) and not orb_complete:
                if orb_high is not None and orb_low is not None:
                    range_pct = (orb_high - orb_low) / orb_low
                    if range_pct >= min_orb_range_pct:
                        orb_complete = True
                    else:
                        break
                else:
                    break

            # 2. Check Exits
            if in_position:
                exit_triggered = False
                exit_reason = ""
                exit_price = 0.0

                # Check Breakeven trigger (+1.2% profit reached)
                if not breakeven_activated:
                    if pos_direction == 1 and (b_high - entry_price) / entry_price >= breakeven_trigger_pct:
                        breakeven_activated = True
                        stop_price = entry_price + 0.005 # locks small gain covering friction
                    elif pos_direction == -1 and (entry_price - b_low) / entry_price >= breakeven_trigger_pct:
                        breakeven_activated = True
                        stop_price = entry_price - 0.005

                # A. Take Profit Limit Order Check
                if pos_direction == 1 and b_high >= take_profit_price:
                    exit_triggered = True
                    exit_price = take_profit_price
                    exit_reason = f"Take Profit (+{tp_pct*100:.1f}%)"
                elif pos_direction == -1 and b_low <= take_profit_price:
                    exit_triggered = True
                    exit_price = take_profit_price
                    exit_reason = f"Take Profit (+{tp_pct*100:.1f}%)"

                # B. Breakeven Stop Check
                if not exit_triggered and breakeven_activated:
                    if pos_direction == 1 and b_low <= stop_price:
                        exit_triggered = True
                        exit_price = stop_price
                        exit_reason = "Breakeven Lock"
                    elif pos_direction == -1 and b_high >= stop_price:
                        exit_triggered = True
                        exit_price = stop_price
                        exit_reason = "Breakeven Lock"

                # C. Discrete 15-Minute Bar Close Trailing Stop Check
                if not exit_triggered and fifteen_min_closed:
                    current_atr = compute_15m_atr()
                    if current_atr > 0:
                        stop_dist = atr_mult * current_atr
                        if pos_direction == 1:
                            if completed_15m_bar["close"] > trailing_anchor_close:
                                trailing_anchor_close = completed_15m_bar["close"]
                            trail_stop = trailing_anchor_close - stop_dist
                            if completed_15m_bar["close"] < trail_stop:
                                exit_triggered = True
                                exit_price = b_close
                                exit_reason = f"15m ATR Stop (€{trail_stop:.3f})"
                        elif pos_direction == -1:
                            if completed_15m_bar["close"] < trailing_anchor_close:
                                trailing_anchor_close = completed_15m_bar["close"]
                            trail_stop = trailing_anchor_close + stop_dist
                            if completed_15m_bar["close"] > trail_stop:
                                exit_triggered = True
                                exit_price = b_close
                                exit_reason = f"15m ATR Stop (€{trail_stop:.3f})"

                # D. 17:15 CET EOD Flatten
                if not exit_triggered and bar_time >= time(17, 15):
                    exit_triggered = True
                    exit_price = b_close
                    exit_reason = "17:15 EOD Flatten"

                if exit_triggered:
                    exit_comm = calculate_ibkr_commission(pos_shares, exit_price)
                    cash -= exit_comm
                    gross_pnl = pos_shares * (exit_price - entry_price) if pos_direction == 1 else pos_shares * (entry_price - exit_price)
                    net_pnl = gross_pnl - entry_comm - exit_comm
                    cash = cash_pre_entry + net_pnl
                    trades.append({
                        "date": str(day),
                        "entry_time": str(entry_time),
                        "exit_time": str(t_dt),
                        "direction": "LONG" if pos_direction == 1 else "SHORT",
                        "shares": pos_shares,
                        "entry_price": entry_price,
                        "exit_price": exit_price,
                        "gross_pnl": gross_pnl,
                        "commission": entry_comm + exit_comm,
                        "net_pnl": net_pnl,
                        "return_pct": (net_pnl / cash_pre_entry) * 100,
                        "exit_reason": exit_reason,
                        "balance_after": cash
                    })
                    in_position = False
                    continue

            # 3. Check Entries (09:30 to cutoff_time)
            if not in_position and not trade_taken_today and orb_complete and bar_time <= cutoff_time:
                if b_vol >= min_breakout_vol:
                    current_atr = compute_15m_atr()
                    if current_atr > 0:
                        # Long Breakout
                        if b_close > orb_high:
                            entry_price = round(b_close, 3)
                            cash_pre_entry = cash
                            pos_shares = int(cash // entry_price)
                            if pos_shares > 0:
                                entry_comm = calculate_ibkr_commission(pos_shares, entry_price)
                                cash -= entry_comm
                                in_position = True
                                pos_direction = 1
                                entry_time = t_dt
                                trade_taken_today = True
                                take_profit_price = round(entry_price * (1.0 + tp_pct), 3)
                                stop_price = round(entry_price - (atr_mult * current_atr), 3)
                                trailing_anchor_close = entry_price
                                breakeven_activated = False

                        # Short Breakdown (if enabled)
                        elif not long_only and b_close < orb_low:
                            entry_price = round(b_close, 3)
                            cash_pre_entry = cash
                            pos_shares = int(cash // entry_price)
                            if pos_shares > 0:
                                entry_comm = calculate_ibkr_commission(pos_shares, entry_price)
                                cash -= entry_comm
                                in_position = True
                                pos_direction = -1
                                entry_time = t_dt
                                trade_taken_today = True
                                take_profit_price = round(entry_price * (1.0 - tp_pct), 3)
                                stop_price = round(entry_price + (atr_mult * current_atr), 3)
                                trailing_anchor_close = entry_price
                                breakeven_activated = False

    t_df = pd.DataFrame(trades)
    eq_df = pd.DataFrame(equity_curve)

    if len(t_df) == 0:
        return {"trades": 0, "pnl": 0.0, "return_pct": 0.0, "win_rate": 0.0, "profit_factor": 0.0, "max_dd": 0.0, "trades_list": []}

    final_equity = cash
    net_pnl = final_equity - INITIAL_CAPITAL
    win_rate = (t_df['net_pnl'] > 0).mean() * 100.0
    wins = t_df[t_df['net_pnl'] > 0]['net_pnl'].sum()
    losses = abs(t_df[t_df['net_pnl'] <= 0]['net_pnl'].sum())
    pf = (wins / losses) if losses > 0 else 99.9

    eq_df['peak'] = eq_df['equity'].cummax()
    max_dd = ((eq_df['equity'] - eq_df['peak']) / eq_df['peak']).min() * 100.0

    return {
        "trades": len(t_df),
        "final_cash": final_equity,
        "pnl": net_pnl,
        "return_pct": (net_pnl / INITIAL_CAPITAL) * 100.0,
        "win_rate": win_rate,
        "profit_factor": pf,
        "max_dd": max_dd,
        "trades_list": trades
    }

def main():
    print(f"Loading {CSV_FILE}...")
    df = pd.read_csv(CSV_FILE)
    df['dt_utc'] = pd.to_datetime(df['datetime'].str.strip(), format='%Y%m%d %H:%M:%S', utc=True)
    df['dt_cet'] = df['dt_utc'].dt.tz_convert('Europe/Brussels')
    df = df.sort_values('dt_cet').reset_index(drop=True)
    df['date'] = df['dt_cet'].dt.date

    print(f"Dataset spans: {df['dt_cet'].min()} to {df['dt_cet'].max()} ({len(df):,} bars, {df['date'].nunique()} trading days)\n")

    # Define test horizons
    horizons = [
        ("3 Months (Aug 1, 2026 - Oct 22, 2026)", "2026-08-01", "2026-10-22 23:59:59"),
        ("6 Months (Apr 22, 2026 - Oct 22, 2026)", "2026-04-22", "2026-10-22 23:59:59"),
        ("1 Full Year (Oct 23, 2025 - Oct 22, 2026)", "2025-10-23", "2026-10-22 23:59:59"),
    ]

    print("="*105)
    print(" HIGH-QUALITY OPTIMIZED ORB STRATEGY: MULTI-HORIZON PERFORMANCE (INITIAL CAPITAL: €5,000)")
    print("="*105)
    print(f"{'Horizon':<42} | {'Days':<5} | {'Trades':<6} | {'Final Cash':<11} | {'Net PnL':<10} | {'Win Rate':<8} | {'PF':<5} | {'Max DD':<7}")
    print("-"*105)

    all_results = {}
    for label, start_str, end_str in horizons:
        sub_df = df[(df['dt_cet'] >= pd.Timestamp(start_str, tz='Europe/Brussels')) & 
                    (df['dt_cet'] <= pd.Timestamp(end_str, tz='Europe/Brussels'))].reset_index(drop=True)
        days = sub_df['date'].unique()
        res = run_simulation(sub_df, days)
        all_results[label] = res
        print(f"{label:<42} | {len(days):<5} | {res['trades']:<6} | €{res['final_cash']:<10.2f} | €{res['pnl']:+<9.2f} | {res['win_rate']:<7.1f}% | {res['profit_factor']:<5.2f} | {res['max_dd']:<6.2f}%")

    print("-"*105)
    
    # Also print the 1-Year trade details summary
    yr_res = all_results["1 Full Year (Oct 23, 2025 - Oct 22, 2026)"]
    print(f"\n1-YEAR TRADE LOG BREAKDOWN ({yr_res['trades']} Trades Total):")
    print(f"{'Date':<12} | {'Action':<24} | {'Exit Reason':<25} | {'Net PnL':<10} | {'Balance':<10}")
    print("-"*85)
    for t in yr_res['trades_list']:
        print(f"{t['date']:<12} | {t['direction']} {t['shares']} @ €{t['entry_price']:.3f} | {t['exit_reason']:<25} | €{t['net_pnl']:+<9.2f} | €{t['balance_after']:<10.2f}")

if __name__ == "__main__":
    main()
