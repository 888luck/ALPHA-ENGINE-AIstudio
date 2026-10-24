import pandas as pd
import numpy as np
from datetime import time

CSV_FILE = "ONWD_EURONEXT_1MIN_1YEAR.csv"
INITIAL_CAPITAL = 5000.0

def calculate_ibkr_commission(shares: float, price: float) -> float:
    trade_value = abs(shares * price)
    base = max(1.25, trade_value * 0.0005)
    return base + 0.50

def run_test(df, trading_days, trend_filter_type=None, 
             tp_pct=0.025, atr_mult=1.2, min_vol=1000, 
             min_range_pct=0.008, cutoff_min=30, breakeven_pct=0.012):
    cash = INITIAL_CAPITAL
    trades = []
    equity_curve = []
    fifteen_min_bars = []
    
    def compute_15m_atr():
        if len(fifteen_min_bars) < 15:
            return 0.0
        return float(np.mean([b['tr'] for b in fifteen_min_bars[-14:]]))

    cutoff_time = time(10, cutoff_min)

    # Trend pre-computation
    daily_closes = df.groupby('date')['close'].last().to_frame()
    daily_closes['sma10'] = daily_closes['close'].rolling(10).mean()
    daily_closes['sma20'] = daily_closes['close'].rolling(20).mean()
    daily_closes['sma50'] = daily_closes['close'].rolling(50).mean()
    daily_closes['ema20'] = daily_closes['close'].ewm(span=20, adjust=False).mean()

    valid_trend_dates = set(trading_days)
    if trend_filter_type == "sma10":
        valid_trend_dates = set(daily_closes[daily_closes['close'] > daily_closes['sma10']].index)
    elif trend_filter_type == "sma20":
        valid_trend_dates = set(daily_closes[daily_closes['close'] > daily_closes['sma20']].index)
    elif trend_filter_type == "sma50":
        valid_trend_dates = set(daily_closes[daily_closes['close'] > daily_closes['sma50']].index)
    elif trend_filter_type == "ema20":
        valid_trend_dates = set(daily_closes[daily_closes['close'] > daily_closes['ema20']].index)

    for day in trading_days:
        if trend_filter_type and day not in valid_trend_dates:
            continue

        day_df = df[df['date'] == day].reset_index(drop=True)
        if len(day_df) < 30:
            continue

        orb_high = None
        orb_low = None
        orb_complete = False
        trade_taken_today = False
        in_position = False
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

            if in_position:
                unrealized = pos_shares * (b_close - entry_price)
                current_equity = cash + unrealized
            else:
                current_equity = cash
            equity_curve.append({"datetime": t_dt, "equity": current_equity})

            # 15m candle update
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

            # ORB formation
            if time(9, 0) <= bar_time < time(9, 30):
                if orb_high is None or b_high > orb_high:
                    orb_high = b_high
                if orb_low is None or b_low < orb_low:
                    orb_low = b_low
                continue

            if bar_time >= time(9, 30) and not orb_complete:
                if orb_high is not None and orb_low is not None:
                    range_pct = (orb_high - orb_low) / orb_low
                    if range_pct >= min_range_pct:
                        orb_complete = True
                    else:
                        break
                else:
                    break

            # Exit logic
            if in_position:
                exit_triggered = False
                exit_price = 0.0
                exit_reason = ""

                # Breakeven trigger
                if not breakeven_activated and (b_high - entry_price) / entry_price >= breakeven_pct:
                    breakeven_activated = True
                    stop_price = entry_price + 0.005

                # TP check
                if b_high >= take_profit_price:
                    exit_triggered = True
                    exit_price = take_profit_price
                    exit_reason = "Take Profit"

                # Breakeven stop check
                if not exit_triggered and breakeven_activated and b_low <= stop_price:
                    exit_triggered = True
                    exit_price = stop_price
                    exit_reason = "Breakeven Lock"

                # 15m ATR stop check
                if not exit_triggered and fifteen_min_closed:
                    cur_atr = compute_15m_atr()
                    if cur_atr > 0:
                        stop_dist = atr_mult * cur_atr
                        if completed_15m_bar["close"] > trailing_anchor_close:
                            trailing_anchor_close = completed_15m_bar["close"]
                        trail_stop = trailing_anchor_close - stop_dist
                        if completed_15m_bar["close"] < trail_stop:
                            exit_triggered = True
                            exit_price = b_close
                            exit_reason = "15m ATR Stop"

                # EOD flatten
                if not exit_triggered and bar_time >= time(17, 15):
                    exit_triggered = True
                    exit_price = b_close
                    exit_reason = "17:15 Flatten"

                if exit_triggered:
                    exit_comm = calculate_ibkr_commission(pos_shares, exit_price)
                    cash -= exit_comm
                    gross_pnl = pos_shares * (exit_price - entry_price)
                    net_pnl = gross_pnl - entry_comm - exit_comm
                    cash = cash_pre_entry + net_pnl
                    trades.append({"date": day, "net_pnl": net_pnl, "exit_reason": exit_reason})
                    in_position = False
                    continue

            # Entry logic
            if not in_position and not trade_taken_today and orb_complete and bar_time <= cutoff_time:
                if b_vol >= min_vol:
                    cur_atr = compute_15m_atr()
                    if cur_atr > 0 and b_close > orb_high:
                        entry_price = round(b_close, 3)
                        cash_pre_entry = cash
                        pos_shares = int(cash // entry_price)
                        if pos_shares > 0:
                            entry_comm = calculate_ibkr_commission(pos_shares, entry_price)
                            cash -= entry_comm
                            in_position = True
                            entry_time = t_dt
                            trade_taken_today = True
                            take_profit_price = round(entry_price * (1.0 + tp_pct), 3)
                            stop_price = round(entry_price - (atr_mult * cur_atr), 3)
                            trailing_anchor_close = entry_price
                            breakeven_activated = False

    t_df = pd.DataFrame(trades)
    eq_df = pd.DataFrame(equity_curve)

    if len(t_df) == 0:
        return {"trades": 0, "final_cash": cash, "pnl": 0.0, "return_pct": 0.0, "win_rate": 0.0, "profit_factor": 0.0, "max_dd": 0.0}

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
        "max_dd": max_dd
    }

def main():
    df = pd.read_csv(CSV_FILE)
    df['dt_utc'] = pd.to_datetime(df['datetime'].str.strip(), format='%Y%m%d %H:%M:%S', utc=True)
    df['dt_cet'] = df['dt_utc'].dt.tz_convert('Europe/Brussels')
    df = df.sort_values('dt_cet').reset_index(drop=True)
    df['date'] = df['dt_cet'].dt.date
    trading_days = df['date'].unique()

    print("="*105)
    print(" SYSTEMATIC 1-YEAR PARAMETER OPTIMIZATION GRID (OCT 2025 - OCT 2026, 249 DAYS)")
    print("="*105)
    print(f"{'Experiment':<45} | {'Trades':<6} | {'Final Cash':<11} | {'Net PnL':<10} | {'Win Rate':<8} | {'PF':<5} | {'Max DD':<7}")
    print("-"*105)

    experiments = [
        ("1. Baseline 1-Year (No Trend Filter)", {}),
        ("2. Trend Gate: Daily Close > SMA-20", {"trend_filter_type": "sma20"}),
        ("3. Trend Gate: Daily Close > EMA-20", {"trend_filter_type": "ema20"}),
        ("4. Trend Gate: Daily Close > SMA-50", {"trend_filter_type": "sma50"}),
        ("5. SMA-20 + Tighter Cutoff (10:15 CET)", {"trend_filter_type": "sma20", "cutoff_min": 15}),
        ("6. SMA-20 + Expanded Target (+3.0% TP)", {"trend_filter_type": "sma20", "tp_pct": 0.030}),
        ("7. SMA-20 + Expanded Target (+3.5% TP)", {"trend_filter_type": "sma20", "tp_pct": 0.035}),
        ("8. SMA-20 + Dynamic 1.0x ATR Stop", {"trend_filter_type": "sma20", "atr_mult": 1.0}),
        ("9. SMA-20 + Higher Volume Filter (>=1500 shs)", {"trend_filter_type": "sma20", "min_vol": 1500}),
        ("10. Combined Institutional Optimum (SMA20, 10:15 cut, +3% TP)", 
         {"trend_filter_type": "sma20", "cutoff_min": 15, "tp_pct": 0.030, "atr_mult": 1.0}),
        ("11. High Vol + Trend Optimum (SMA20, Vol>=1500, +3% TP)", 
         {"trend_filter_type": "sma20", "min_vol": 1500, "tp_pct": 0.030, "atr_mult": 1.0}),
    ]

    for label, params in experiments:
        res = run_test(df, trading_days, **params)
        print(f"{label:<45} | {res['trades']:<6} | €{res['final_cash']:<10.2f} | €{res['pnl']:+<9.2f} | {res['win_rate']:<7.1f}% | {res['profit_factor']:<5.2f} | {res['max_dd']:<6.2f}%")

if __name__ == "__main__":
    main()
