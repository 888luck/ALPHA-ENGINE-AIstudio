import pandas as pd
import numpy as np
from datetime import time, timedelta

CSV_FILE = "ONWD_EURONEXT_1MIN_1YEAR.csv"
INITIAL_CAPITAL = 5000.0

def calculate_ibkr_commission(shares: float, price: float) -> float:
    trade_value = abs(shares * price)
    base = max(1.25, trade_value * 0.0005)
    return base + 0.50

def run_advanced_simulation(
    hard_stop_pct=0.018,          # Stiff loss preservation: hard max loss tick cap (-1.8%)
    dynamic_tp_mode="atr_scaled", # "fixed", "atr_scaled", or "two_tier"
    fixed_tp_pct=0.030,
    atr_tp_multiplier=2.0,        # Dynamic profit intelligence: target = Entry + max(2.5%, ATR * mult)
    trail_atr_mult=1.0,           # Trailing distance once profit begins
    breakeven_lock_trigger=0.012, # Ratchet stop to entry + friction once +1.2% reached
    profit_lock_trigger=0.022,    # Dynamic profit intelligence: lock in +1.5% once +2.2% reached
    profit_lock_level=0.015,
    max_trade_duration_mins=120,  # Stale trade time-stop (cut dead chops after 2 hours)
    min_vol=1000,
    min_orb_range=0.008
):
    df = pd.read_csv(CSV_FILE)
    df['dt_utc'] = pd.to_datetime(df['datetime'].str.strip(), format='%Y%m%d %H:%M:%S', utc=True)
    df['dt_cet'] = df['dt_utc'].dt.tz_convert('Europe/Brussels')
    df = df.sort_values('dt_cet').reset_index(drop=True)
    df['date'] = df['dt_cet'].dt.date

    # Daily EMA-20
    daily = df.groupby('date')['close'].last().to_frame()
    daily['ema20'] = daily['close'].ewm(span=20, adjust=False).mean()
    bullish_dates = set(daily[daily['close'] > daily['ema20']].index)

    day_groups = {d: g.reset_index(drop=True) for d, g in df.groupby('date')}
    trading_days = df['date'].unique()

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
        if day not in bullish_dates:
            continue

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
        target_price = 0.0
        hard_stop_price = 0.0
        trailing_stop_price = 0.0
        trailing_anchor = 0.0
        breakeven_active = False
        profit_lock_active = False
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

            # Update 15m bar
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

            # Phase 1: ORB formation
            if time(9, 0) <= bar_time < time(9, 30):
                if orb_high is None or b_high > orb_high:
                    orb_high = b_high
                if orb_low is None or b_low < orb_low:
                    orb_low = b_low
                continue

            if bar_time >= time(9, 30) and not orb_complete:
                if orb_high is not None and orb_low is not None:
                    if (orb_high - orb_low) / orb_low >= min_orb_range:
                        orb_complete = True
                    else:
                        break
                else:
                    break

            # Phase 2: Exits with Stiff Loss Preservation & Dynamic Profit Intelligence
            if in_pos:
                exit_now = False
                exit_px = 0.0
                exit_reason = ""
                mins_in_trade = (t_dt - entry_time).total_seconds() / 60.0

                # 1. Stiff Loss Preservation: Hard Max Loss Cap (instant tick check)
                if b_low <= hard_stop_price:
                    exit_now = True
                    exit_px = hard_stop_price
                    exit_reason = f"Stiff Loss Stop (-{hard_stop_pct*100:.1f}%)"

                # 2. Dynamic Profit Target check
                if not exit_now and b_high >= target_price:
                    exit_now = True
                    exit_px = target_price
                    exit_reason = f"Dynamic Profit Target (€{target_price:.3f})"

                # 3. Dynamic Profit Intelligence: Tier 2 Profit Lock
                # If price reached +2.2%, ratchet the hard floor up to lock in +1.5% profit!
                if not exit_now:
                    if not profit_lock_active and (b_high - entry_price) / entry_price >= profit_lock_trigger:
                        profit_lock_active = True
                        profit_lock_px = round(entry_price * (1.0 + profit_lock_level), 3)
                        trailing_stop_price = max(trailing_stop_price, profit_lock_px)

                    # Tier 1 Breakeven Lock at +1.2%
                    elif not breakeven_active and (b_high - entry_price) / entry_price >= breakeven_lock_trigger:
                        breakeven_active = True
                        be_px = entry_price + 0.005 # covers IBKR round-trip commissions
                        trailing_stop_price = max(trailing_stop_price, be_px)

                    # Check if price violated the secured profit lock or breakeven floor
                    if (profit_lock_active or breakeven_active) and b_low <= trailing_stop_price:
                        exit_now = True
                        exit_px = trailing_stop_price
                        exit_reason = "Dynamic Profit Lock" if profit_lock_active else "Breakeven Lock"

                # 4. Discrete 15m ATR Chandelier Trailing Stop
                if not exit_now and fifteen_min_closed:
                    cur_atr = compute_15m_atr()
                    if cur_atr > 0:
                        if completed_15m["close"] > trailing_anchor:
                            trailing_anchor = completed_15m["close"]
                        new_trail = trailing_anchor - (trail_atr_mult * cur_atr)
                        trailing_stop_price = max(trailing_stop_price, new_trail)
                        if completed_15m["close"] < trailing_stop_price:
                            exit_now = True
                            exit_px = b_close
                            exit_reason = f"15m ATR Trail (€{trailing_stop_price:.3f})"

                # 5. Stale Trade / Momentum Decay Time-Stop (cut idle chop after max duration)
                if not exit_now and mins_in_trade >= max_trade_duration_mins:
                    gain_pct = (b_close - entry_price) / entry_price
                    if gain_pct < 0.008: # If not moving after 2 hours, cut at market
                        exit_now = True
                        exit_px = b_close
                        exit_reason = f"Stale Trade Exit ({int(mins_in_trade)}m)"

                # 6. EOD Forced Flatten at 17:15 CET
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
                        "balance": cash
                    })
                    in_pos = False
                    continue

            # Phase 3: Entry
            if not in_pos and not trade_taken_today and orb_complete and bar_time <= cutoff_time:
                if b_vol >= min_vol:
                    cur_atr = compute_15m_atr()
                    if cur_atr > 0 and b_close > orb_high:
                        entry_price = round(b_close, 3)
                        cash_pre = cash
                        pos_shares = int(cash // entry_price)
                        if pos_shares > 0:
                            entry_comm = calculate_ibkr_commission(pos_shares, entry_price)
                            cash -= entry_comm
                            in_pos = True
                            entry_time = t_dt
                            trade_taken_today = True

                            # Dynamic Profit Intelligence: Scale Target to Volatility
                            if dynamic_tp_mode == "atr_scaled":
                                # Dynamic expansion: 2.0x ATR target, minimum 2.5%, maximum 4.5%
                                dynamic_tp_dist = max(0.025 * entry_price, cur_atr * atr_tp_multiplier)
                                target_price = round(entry_price + min(0.045 * entry_price, dynamic_tp_dist), 3)
                            else:
                                target_price = round(entry_price * (1.0 + fixed_tp_pct), 3)

                            # Stiff Loss Preservation: Hard Max Loss Stop
                            hard_stop_price = round(entry_price * (1.0 - hard_stop_pct), 3)
                            trailing_stop_price = round(entry_price - (trail_atr_mult * cur_atr), 3)
                            trailing_anchor = entry_price
                            breakeven_active = False
                            profit_lock_active = False

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

def main():
    experiments = [
        ("Current (Fixed 3.0% TP, No Hard Stop, No Profit Lock)", 
         {"hard_stop_pct": 0.10, "dynamic_tp_mode": "fixed", "fixed_tp_pct": 0.030, "profit_lock_trigger": 99.0, "max_trade_duration_mins": 999}),

        ("+ Stiff Loss Preservation (1.8% Hard Stop Floor)", 
         {"hard_stop_pct": 0.018, "dynamic_tp_mode": "fixed", "fixed_tp_pct": 0.030, "profit_lock_trigger": 99.0, "max_trade_duration_mins": 999}),

        ("+ Dynamic Profit Lock (Lock +1.5% at +2.2% reach)", 
         {"hard_stop_pct": 0.018, "dynamic_tp_mode": "fixed", "fixed_tp_pct": 0.030, "profit_lock_trigger": 0.022, "profit_lock_level": 0.015, "max_trade_duration_mins": 999}),

        ("+ Dynamic ATR-Scaled Profit Target (2.0x ATR)", 
         {"hard_stop_pct": 0.018, "dynamic_tp_mode": "atr_scaled", "atr_tp_multiplier": 2.0, "profit_lock_trigger": 0.022, "profit_lock_level": 0.015, "max_trade_duration_mins": 999}),

        ("+ Momentum Decay Time-Stop (Cut flat trades > 90m)", 
         {"hard_stop_pct": 0.018, "dynamic_tp_mode": "atr_scaled", "atr_tp_multiplier": 2.0, "profit_lock_trigger": 0.022, "profit_lock_level": 0.015, "max_trade_duration_mins": 90}),

        ("+ High Conviction Stiff Preservation (1.5% Hard Stop)", 
         {"hard_stop_pct": 0.015, "dynamic_tp_mode": "atr_scaled", "atr_tp_multiplier": 2.2, "profit_lock_trigger": 0.020, "profit_lock_level": 0.014, "max_trade_duration_mins": 90}),
    ]

    print("="*105)
    print(" ADVANCED INTRADAY PROFIT INTELLIGENCE & STIFF LOSS PRESERVATION GRID (1 YEAR)")
    print("="*105)
    print(f"{'Configuration':<52} | {'Trades':<6} | {'Final Cash':<11} | {'Net PnL':<10} | {'Win Rate':<8} | {'PF':<5} | {'Max DD':<7}")
    print("-"*105)

    for label, params in experiments:
        res = run_advanced_simulation(**params)
        print(f"{label:<52} | {res['trades']:<6} | €{res['final_cash']:<10.2f} | €{res['net_pnl']:+<9.2f} | {res['win_rate']:<7.1f}% | {res['pf']:<5.2f} | {res['max_dd']:<6.2f}%")

if __name__ == "__main__":
    main()
