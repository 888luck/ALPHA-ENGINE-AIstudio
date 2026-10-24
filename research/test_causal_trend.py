import pandas as pd
import numpy as np
from datetime import time

CSV_FILE = "ONWD_EURONEXT_1MIN_1YEAR.csv"
INITIAL_CAPITAL = 5000.0

def calculate_ibkr_commission(shares: float, price: float) -> float:
    trade_value = abs(shares * price)
    base = max(1.25, trade_value * 0.0005)
    return base + 0.50

def run_causal_test(day_groups, trading_days, tp_pct=0.030, atr_mult=1.2, min_vol=1000, trend_mode="price_above_ema20"):
    cash = INITIAL_CAPITAL
    trades = []
    equity_curve = []
    fifteen_min_bars = []

    def compute_15m_atr():
        if len(fifteen_min_bars) < 15:
            return 0.0
        return float(np.mean([b['tr'] for b in fifteen_min_bars[-14:]]))

    cutoff_time = time(10, 30)

    for day in trading_days:
        day_df = day_groups[day]
        if len(day_df) < 30:
            continue

        orb_high = None
        orb_low = None
        orb_complete = False
        trade_taken_today = False
        in_pos = False
        pos_shares = 0
        entry_price = 0.0
        entry_time = None
        tp_price = 0.0
        stop_price = 0.0
        trailing_anchor = 0.0
        breakeven_active = False
        current_15m = None

        for row in day_df.itertuples():
            bar_time = row.dt_cet.time()
            t_dt = row.dt_cet
            b_open = row.open
            b_high = row.high
            b_low = row.low
            b_close = row.close
            b_vol = row.volume

            if in_pos:
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
                completed_15m = current_15m
                current_15m = {"bucket": bucket_time, "open": b_open, "high": b_high, "low": b_low, "close": b_close}

            # Phase 1: ORB (09:00 - 09:30 CET)
            if time(9, 0) <= bar_time < time(9, 30):
                if orb_high is None or b_high > orb_high:
                    orb_high = b_high
                if orb_low is None or b_low < orb_low:
                    orb_low = b_low
                continue

            if bar_time >= time(9, 30) and not orb_complete:
                if orb_high is not None and orb_low is not None:
                    if (orb_high - orb_low) / orb_low >= 0.008:
                        orb_complete = True
                    else:
                        break
                else:
                    break

            # Phase 2: Exits
            if in_pos:
                exit_now = False
                exit_px = 0.0
                exit_reason = ""

                # Breakeven lock (+1.2%)
                if not breakeven_active and (b_high - entry_price) / entry_price >= 0.012:
                    breakeven_active = True
                    stop_price = entry_price + 0.005

                # TP check
                if b_high >= tp_price:
                    exit_now = True
                    exit_px = tp_price
                    exit_reason = f"Take Profit (+{tp_pct*100:.1f}%)"

                # Breakeven stop check
                if not exit_now and breakeven_active and b_low <= stop_price:
                    exit_now = True
                    exit_px = stop_price
                    exit_reason = "Breakeven Lock"

                # 15m ATR stop check
                if not exit_now and fifteen_min_closed:
                    cur_atr = compute_15m_atr()
                    if cur_atr > 0:
                        stop_dist = atr_mult * cur_atr
                        if completed_15m["close"] > trailing_anchor:
                            trailing_anchor = completed_15m["close"]
                        trail_stop = trailing_anchor - stop_dist
                        if completed_15m["close"] < trail_stop:
                            exit_now = True
                            exit_px = b_close
                            exit_reason = f"15m ATR Stop"

                # EOD flatten
                if not exit_now and bar_time >= time(17, 15):
                    exit_now = True
                    exit_px = b_close
                    exit_reason = "17:15 EOD Flatten"

                if exit_now:
                    exit_comm = calculate_ibkr_commission(pos_shares, exit_px)
                    cash -= exit_comm
                    gross = pos_shares * (exit_px - entry_price)
                    net = gross - entry_comm - exit_comm
                    cash = cash_pre + net
                    trades.append({
                        "trade_id": len(trades) + 1,
                        "date": str(day),
                        "shares": pos_shares,
                        "entry_price": entry_price,
                        "exit_price": exit_px,
                        "net_pnl": net,
                        "return_pct": (net / cash_pre) * 100,
                        "exit_reason": exit_reason,
                        "account_balance": cash
                    })
                    in_pos = False
                    continue

            # Phase 3: Entry
            if not in_pos and not trade_taken_today and orb_complete and bar_time <= cutoff_time:
                # Causal Trend Check
                trend_ok = True
                if trend_mode == "price_above_ema20":
                    trend_ok = (row.prev_ema20 is not None) and (not np.isnan(row.prev_ema20)) and (b_close > row.prev_ema20)
                elif trend_mode == "prev_close_above_sma20":
                    trend_ok = (row.prev_sma20 is not None) and (not np.isnan(row.prev_sma20)) and (row.prev_close > row.prev_sma20)
                elif trend_mode == "none":
                    trend_ok = True

                if trend_ok and b_vol >= min_vol:
                    cur_atr = compute_15m_atr()
                    if cur_atr > 0 and b_close > orb_high:
                        entry_price = round(b_close, 3)
                        cash_pre = cash
                        pos_shares = int(cash // entry_price)
                        if pos_shares > 0:
                            entry_comm = calculate_ibkr_commission(pos_shares, entry_price)
                            cash -= entry_comm
                            in_pos = True
                            trade_taken_today = True
                            tp_price = round(entry_price * (1.0 + tp_pct), 3)
                            stop_price = round(entry_price - (atr_mult * cur_atr), 3)
                            trailing_anchor = entry_price
                            breakeven_active = False

    t_df = pd.DataFrame(trades)
    eq_df = pd.DataFrame(equity_curve)
    if len(t_df) == 0:
        return {"trades": 0, "final_cash": cash, "net_pnl": 0.0, "win_rate": 0.0, "pf": 0.0, "max_dd": 0.0, "trades_list": []}

    net_pnl = cash - INITIAL_CAPITAL
    win_rate = (t_df['net_pnl'] > 0).mean() * 100.0
    wins = t_df[t_df['net_pnl'] > 0]['net_pnl'].sum()
    losses = abs(t_df[t_df['net_pnl'] <= 0]['net_pnl'].sum())
    pf = (wins / losses) if losses > 0 else 99.9

    eq_df['peak'] = eq_df['equity'].cummax()
    max_dd = ((eq_df['equity'] - eq_df['peak']) / eq_df['peak']).min() * 100.0

    return {
        "trades": len(t_df),
        "final_cash": cash,
        "net_pnl": net_pnl,
        "win_rate": win_rate,
        "pf": pf,
        "max_dd": max_dd,
        "trades_list": trades
    }

if __name__ == "__main__":
    print("Precomputing indicators on authentic 1-year dataset...")
    df = pd.read_csv(CSV_FILE)
    df['dt_utc'] = pd.to_datetime(df['datetime'].str.strip(), format='%Y%m%d %H:%M:%S', utc=True)
    df['dt_cet'] = df['dt_utc'].dt.tz_convert('Europe/Brussels')
    df = df.sort_values('dt_cet').reset_index(drop=True)
    df['date'] = df['dt_cet'].dt.date

    daily = df.groupby('date')['close'].last().to_frame()
    daily['sma20'] = daily['close'].rolling(20).mean()
    daily['ema20'] = daily['close'].ewm(span=20, adjust=False).mean()
    daily['sma50'] = daily['close'].rolling(50).mean()
    daily['prev_sma20'] = daily['sma20'].shift(1)
    daily['prev_ema20'] = daily['ema20'].shift(1)
    daily['prev_close'] = daily['close'].shift(1)
    daily['prev_sma50'] = daily['sma50'].shift(1)

    df = df.merge(daily[['prev_sma20', 'prev_ema20', 'prev_close', 'prev_sma50']], on='date', how='left')
    trading_days = df['date'].unique()
    day_groups = {d: g.reset_index(drop=True) for d, g in df.groupby('date')}

    for mode in ["none", "price_above_ema20", "prev_close_above_sma20"]:
        for tp in [0.025, 0.030, 0.035]:
            for atr in [1.0, 1.2]:
                r = run_causal_test(day_groups, trading_days, tp_pct=tp, atr_mult=atr, min_vol=1000, trend_mode=mode)
                print(f"Mode={mode:<22} | TP={tp*100:.1f}% | ATR={atr:.1f}x | Trades={r['trades']:<2} | Cash=€{r['final_cash']:<8.2f} | PnL=€{r['net_pnl']:+<7.2f} | WR={r['win_rate']:<4.1f}% | PF={r['pf']:<4.2f} | DD={r['max_dd']:<5.1f}%")
