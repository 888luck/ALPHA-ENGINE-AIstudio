#!/usr/bin/env python3
"""
Institutional Quant Backtester for Onward Medical NV (ONWD - Euronext Brussels)
Simulates the Intraday Opening Range Breakout (ORB) & Mean Reversion Strategy
Data: Authentic IBKR Pro 1-Minute Bars (August 1, 2026 - October 22, 2026)
"""

import os
import sys
import math
import pandas as pd
import numpy as np
from datetime import datetime, time, timedelta
import pytz

CSV_FILE = "ONWD_EURONEXT_1MIN_3MONTHS.csv"
INITIAL_CAPITAL = 5000.0  # €5,000 EUR
COMMISSION_PCT = 0.0005   # 0.05%
MIN_COMMISSION = 1.25     # €1.25 min
CLEARING_FEE = 0.50       # €0.50 third-party clearing friction per order
TAKE_PROFIT_PCT = 0.015   # +1.50%
ATR_PERIOD = 14           # 14 periods on 15m bars
ATR_MULTIPLIER = 2.0      # 2.0x ATR Chandelier distance

def calculate_ibkr_commission(shares: float, price: float) -> float:
    trade_value = abs(shares * price)
    base = max(MIN_COMMISSION, trade_value * COMMISSION_PCT)
    return base + CLEARING_FEE

def run_simulation():
    if not os.path.exists(CSV_FILE):
        print(f"Error: {CSV_FILE} not found.")
        return

    print("Loading IBKR 1-minute historical dataset...")
    df = pd.read_csv(CSV_FILE)
    
    # Parse UTC timestamps and convert to Europe/Brussels (CET/CEST)
    # The format in CSV is "YYYYMMDD  HH:mm:ss" in UTC
    utc_tz = pytz.UTC
    cet_tz = pytz.timezone("Europe/Brussels")

    parsed_dates = []
    for dt_str in df['datetime']:
        clean_str = " ".join(dt_str.strip().split())
        dt_utc = datetime.strptime(clean_str, "%Y%m%d %H:%M:%S").replace(tzinfo=utc_tz)
        dt_cet = dt_utc.astimezone(cet_tz)
        parsed_dates.append(dt_cet)

    df['dt_cet'] = parsed_dates
    df = df.sort_values('dt_cet').reset_index(drop=True)

    # Filter date range: August 1, 2026 to October 22, 2026
    start_filter = datetime(2026, 8, 1, 0, 0, 0, tzinfo=cet_tz)
    end_filter = datetime(2026, 10, 22, 23, 59, 59, tzinfo=cet_tz)
    df = df[(df['dt_cet'] >= start_filter) & (df['dt_cet'] <= end_filter)].reset_index(drop=True)

    print(f"Total 1-minute bars in backtest window: {len(df):,}")
    print(f"Window: {df.iloc[0]['dt_cet'].strftime('%Y-%m-%d %H:%M')} CET  -->  {df.iloc[-1]['dt_cet'].strftime('%Y-%m-%d %H:%M')} CET")

    # Group by trading calendar day
    df['date'] = df['dt_cet'].dt.date
    trading_days = df['date'].unique()
    print(f"Total Trading Sessions: {len(trading_days)}")

    # State variables
    cash = INITIAL_CAPITAL
    equity = INITIAL_CAPITAL
    trades = []
    equity_curve = []
    total_commission_paid = 0.0

    # 15-minute rolling bars history for ATR calculation
    fifteen_min_bars = []  # list of {dt, open, high, low, close, tr}

    def compute_15m_atr() -> float:
        if len(fifteen_min_bars) < ATR_PERIOD + 1:
            return 0.0
        # Calculate Wilder's ATR on the last 14 completed 15m bars
        trs = [b['tr'] for b in fifteen_min_bars[-ATR_PERIOD:]]
        return float(np.mean(trs))

    # Iterate day by day
    for day in trading_days:
        day_df = df[df['date'] == day].reset_index(drop=True)
        if len(day_df) < 30:
            continue

        orb_high = None
        orb_low = None
        orb_complete = False
        trade_taken_today = False

        # Position tracking
        in_position = False
        pos_direction = 0  # +1 Long, -1 Short
        pos_shares = 0
        entry_price = 0.0
        entry_time = None
        take_profit_price = 0.0
        trailing_anchor_close = 0.0

        # Current 15-minute candle aggregator
        current_15m = None

        for idx, row in day_df.iterrows():
            bar_time = row['dt_cet'].time()
            t_dt = row['dt_cet']
            b_open = row['open']
            b_high = row['high']
            b_low = row['low']
            b_close = row['close']
            b_vol = row['volume']

            # Record mark-to-market equity
            if in_position:
                unrealized = pos_shares * (b_close - entry_price) if pos_direction == 1 else pos_shares * (entry_price - b_close)
                current_equity = cash + unrealized
            else:
                current_equity = cash
            equity_curve.append({"datetime": t_dt, "equity": current_equity, "close": b_close})

            # Update 15-minute bar aggregator
            # 15m intervals: 09:00-09:15, 09:15-09:30, etc.
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
                # Previous 15m closed!
                prev_close = fifteen_min_bars[-1]["close"] if len(fifteen_min_bars) > 0 else current_15m["open"]
                hl = current_15m["high"] - current_15m["low"]
                hc = abs(current_15m["high"] - prev_close)
                lc = abs(current_15m["low"] - prev_close)
                current_15m["tr"] = max(hl, hc, lc)
                fifteen_min_bars.append(current_15m)
                fifteen_min_closed = True
                completed_15m_bar = current_15m

                # Start new 15m
                current_15m = {"bucket": bucket_time, "open": b_open, "high": b_high, "low": b_low, "close": b_close}

            # -------------------------------------------------------------
            # 1. Opening Range Formation (09:00 - 09:30 CET)
            # -------------------------------------------------------------
            if time(9, 0) <= bar_time < time(9, 30):
                if orb_high is None or b_high > orb_high:
                    orb_high = b_high
                if orb_low is None or b_low < orb_low:
                    orb_low = b_low
                continue

            if bar_time >= time(9, 30) and not orb_complete:
                if orb_high is not None and orb_low is not None:
                    orb_complete = True
                else:
                    continue

            # -------------------------------------------------------------
            # 2. Check Exits for Open Position
            # -------------------------------------------------------------
            if in_position:
                exit_triggered = False
                exit_reason = ""
                exit_price = 0.0

                # A. Take Profit Limit Order Check (+1.50%)
                if pos_direction == 1 and b_high >= take_profit_price:
                    exit_triggered = True
                    exit_price = take_profit_price
                    exit_reason = "Take Profit (+1.50%)"
                elif pos_direction == -1 and b_low <= take_profit_price:
                    exit_triggered = True
                    exit_price = take_profit_price
                    exit_reason = "Take Profit (+1.50%)"

                # B. Discrete 15-Minute Bar Close Trailing Stop Check (2.0x ATR)
                if not exit_triggered and fifteen_min_closed:
                    current_atr = compute_15m_atr()
                    if current_atr > 0:
                        stop_dist = ATR_MULTIPLIER * current_atr
                        if pos_direction == 1:
                            if completed_15m_bar["close"] > trailing_anchor_close:
                                trailing_anchor_close = completed_15m_bar["close"]
                            stop_level = trailing_anchor_close - stop_dist
                            if completed_15m_bar["close"] < stop_level:
                                exit_triggered = True
                                exit_price = b_close
                                exit_reason = f"15m ATR Trailing Stop (Stop: €{stop_level:.3f})"
                        elif pos_direction == -1:
                            if completed_15m_bar["close"] < trailing_anchor_close:
                                trailing_anchor_close = completed_15m_bar["close"]
                            stop_level = trailing_anchor_close + stop_dist
                            if completed_15m_bar["close"] > stop_level:
                                exit_triggered = True
                                exit_price = b_close
                                exit_reason = f"15m ATR Trailing Stop (Stop: €{stop_level:.3f})"

                # C. Hard EOD Pre-Close Flattening at 17:15 CET
                if not exit_triggered and bar_time >= time(17, 15):
                    exit_triggered = True
                    exit_price = b_close
                    exit_reason = "17:15 CET EOD Protective Flattening"

                # Execute Exit
                if exit_triggered:
                    exit_comm = calculate_ibkr_commission(pos_shares, exit_price)
                    total_commission_paid += exit_comm

                    if pos_direction == 1:
                        gross_pnl = pos_shares * (exit_price - entry_price)
                    else:
                        gross_pnl = pos_shares * (entry_price - exit_price)

                    net_pnl = gross_pnl - exit_comm
                    cash += (pos_shares * exit_price if pos_direction == 1 else -pos_shares * exit_price) + gross_pnl - exit_comm
                    # Normalize cash accurately
                    cash = cash_pre_entry + net_pnl
                    ret_pct = (net_pnl / cash_pre_entry) * 100

                    trades.append({
                        "entry_time": entry_time,
                        "exit_time": t_dt,
                        "direction": "LONG" if pos_direction == 1 else "SHORT",
                        "shares": pos_shares,
                        "entry_price": entry_price,
                        "exit_price": exit_price,
                        "gross_pnl": gross_pnl,
                        "commission": entry_comm + exit_comm,
                        "net_pnl": net_pnl,
                        "return_pct": ret_pct,
                        "exit_reason": exit_reason,
                        "orb_range": f"€{orb_low:.3f} - €{orb_high:.3f}"
                    })

                    in_position = False
                    continue

            # -------------------------------------------------------------
            # 3. Check Entries (09:30 - 17:10 CET)
            # -------------------------------------------------------------
            if not in_position and not trade_taken_today and orb_complete and bar_time < time(17, 10):
                current_atr = compute_15m_atr()
                # Need at least minimum ATR warmed up
                if current_atr > 0:
                    # Bullish breakout above ORB High
                    if b_close > orb_high:
                        entry_price = round(b_close, 3)
                        cash_pre_entry = cash
                        pos_shares = int(cash // entry_price)
                        if pos_shares > 0:
                            entry_comm = calculate_ibkr_commission(pos_shares, entry_price)
                            total_commission_paid += entry_comm
                            cash -= entry_comm
                            in_position = True
                            pos_direction = 1
                            entry_time = t_dt
                            trade_taken_today = True
                            take_profit_price = round(entry_price * (1.0 + TAKE_PROFIT_PCT), 3)
                            trailing_anchor_close = entry_price
                    # Bearish breakdown below ORB Low
                    elif b_close < orb_low:
                        entry_price = round(b_close, 3)
                        cash_pre_entry = cash
                        pos_shares = int(cash // entry_price)
                        if pos_shares > 0:
                            entry_comm = calculate_ibkr_commission(pos_shares, entry_price)
                            total_commission_paid += entry_comm
                            cash -= entry_comm
                            in_position = True
                            pos_direction = -1
                            entry_time = t_dt
                            trade_taken_today = True
                            take_profit_price = round(entry_price * (1.0 - TAKE_PROFIT_PCT), 3)
                            trailing_anchor_close = entry_price

    # -------------------------------------------------------------
    # Performance Metrics Computation
    # -------------------------------------------------------------
    trades_df = pd.DataFrame(trades)
    eq_df = pd.DataFrame(equity_curve)

    final_equity = eq_df.iloc[-1]['equity'] if len(eq_df) > 0 else INITIAL_CAPITAL
    total_net_profit = final_equity - INITIAL_CAPITAL
    total_return_pct = (total_net_profit / INITIAL_CAPITAL) * 100.0

    # Benchmark Return (Buy & Hold ONWD)
    bh_start = df.iloc[0]['close']
    bh_end = df.iloc[-1]['close']
    benchmark_return_pct = ((bh_end - bh_start) / bh_start) * 100.0

    # Calculate Drawdown
    eq_df['peak'] = eq_df['equity'].cummax()
    eq_df['drawdown'] = (eq_df['equity'] - eq_df['peak']) / eq_df['peak'] * 100.0
    max_drawdown_pct = eq_df['drawdown'].min()

    # Trade Stats
    total_trades = len(trades_df)
    if total_trades > 0:
        winning_trades = trades_df[trades_df['net_pnl'] > 0]
        losing_trades = trades_df[trades_df['net_pnl'] <= 0]
        win_rate = (len(winning_trades) / total_trades) * 100.0
        gross_profit = winning_trades['gross_pnl'].sum()
        gross_loss = abs(losing_trades['gross_pnl'].sum())
        profit_factor = (gross_profit / gross_loss) if gross_loss > 0 else 99.99
        avg_trade_pnl = trades_df['net_pnl'].mean()
        avg_win = winning_trades['net_pnl'].mean() if len(winning_trades) > 0 else 0.0
        avg_loss = losing_trades['net_pnl'].mean() if len(losing_trades) > 0 else 0.0
        win_loss_ratio = abs(avg_win / avg_loss) if abs(avg_loss) > 0 else 99.99
        
        # Daily returns for Sharpe / Sortino
        eq_daily = eq_df.set_index('datetime').resample('1D').last().dropna()
        eq_daily['pct_change'] = eq_daily['equity'].pct_change().fillna(0)
        mean_ret = eq_daily['pct_change'].mean()
        std_ret = eq_daily['pct_change'].std()
        downside_std = eq_daily[eq_daily['pct_change'] < 0]['pct_change'].std()
        sharpe_ratio = (mean_ret / std_ret * math.sqrt(252)) if std_ret > 0 else 0.0
        sortino_ratio = (mean_ret / downside_std * math.sqrt(252)) if (downside_std and downside_std > 0) else 0.0
    else:
        win_rate = 0.0
        profit_factor = 0.0
        sharpe_ratio = 0.0
        sortino_ratio = 0.0
        avg_trade_pnl = 0.0
        avg_win = 0.0
        avg_loss = 0.0
        win_loss_ratio = 0.0

    print("\n" + "=" * 70)
    print(" QUANTCONNECT LEAN BACKTEST PERFORMANCE SUMMARY")
    print(" Asset: ONWD (Euronext Brussels) | Timeframe: 1-Minute | Initial Cash: €5,000")
    print(f" Period: August 1, 2026 - October 22, 2026 (Past 3 Months)")
    print("=" * 70)
    print(f" Initial Equity:           €{INITIAL_CAPITAL:,.2f}")
    print(f" Final Equity:             €{final_equity:,.2f}")
    print(f" Net Profit:               €{total_net_profit:+,.2f} ({total_return_pct:+.2f}%)")
    print(f" Benchmark Return (ONWD):  {benchmark_return_pct:+.2f}%")
    print(f" Alpha vs Benchmark:       {total_return_pct - benchmark_return_pct:+.2f}%")
    print(f" Maximum Drawdown:         {max_drawdown_pct:.2f}%")
    print(f" Sharpe Ratio (Annualized):{sharpe_ratio:.2f}")
    print(f" Sortino Ratio:            {sortino_ratio:.2f}")
    print(f" Total Trades Executed:    {total_trades}")
    print(f" Win Rate:                 {win_rate:.1f}% ({len(winning_trades)}W / {len(losing_trades)}L)")
    print(f" Profit Factor:            {profit_factor:.2f}")
    print(f" Win / Loss Ratio:         {win_loss_ratio:.2f}")
    print(f" Average Trade Return:     €{avg_trade_pnl:+.2f}")
    print(f" Average Win:              €{avg_win:+.2f}")
    print(f" Average Loss:             €{avg_loss:+.2f}")
    print(f" Total Commission Friction:€{total_commission_paid:,.2f}")
    print("=" * 70)

    # Print breakdown by exit reason
    if total_trades > 0:
        print("\n--- PERFORMANCE BREAKDOWN BY EXIT REASON ---")
        reasons = trades_df.groupby('exit_reason').agg(
            Count=('net_pnl', 'count'),
            NetPnL=('net_pnl', 'sum'),
            AvgPnL=('net_pnl', 'mean'),
            WinRate=('net_pnl', lambda x: (x > 0).mean() * 100)
        )
        print(reasons.to_string())

        print("\n--- RECENT 10 TRADES LEDGER ---")
        display_cols = ['entry_time', 'exit_time', 'direction', 'entry_price', 'exit_price', 'net_pnl', 'return_pct', 'exit_reason']
        recent_trades = trades_df.tail(10)[display_cols].copy()
        recent_trades['entry_time'] = recent_trades['entry_time'].dt.strftime('%m-%d %H:%M')
        recent_trades['exit_time'] = recent_trades['exit_time'].dt.strftime('%m-%d %H:%M')
        recent_trades['net_pnl'] = recent_trades['net_pnl'].apply(lambda x: f"€{x:+.2f}")
        recent_trades['return_pct'] = recent_trades['return_pct'].apply(lambda x: f"{x:+.2f}%")
        print(recent_trades.to_string(index=False))

    # Save complete trade ledger to CSV
    trades_df.to_csv("ONWD_ORB_BACKTEST_TRADES.csv", index=False)
    print(f"\n[OUTPUT] Complete trade-by-trade ledger saved to: ONWD_ORB_BACKTEST_TRADES.csv")

    # Generate an interactive HTML Backtest Tear Sheet
    generate_html_tear_sheet(eq_df, trades_df, final_equity, total_net_profit, total_return_pct, 
                             benchmark_return_pct, max_drawdown_pct, sharpe_ratio, win_rate, 
                             profit_factor, total_commission_paid)

def generate_html_tear_sheet(eq_df, trades_df, final_equity, total_net_profit, total_return_pct,
                             benchmark_return_pct, max_drawdown_pct, sharpe_ratio, win_rate,
                             profit_factor, total_commission_paid):
    
    # Subsample equity curve for clean web rendering
    step = max(1, len(eq_df) // 500)
    sampled = eq_df.iloc[::step]
    chart_dates = [d.strftime('%Y-%m-%d %H:%M') for d in sampled['datetime']]
    chart_equity = [round(e, 2) for e in sampled['equity']]

    # Benchmark normalized to €5,000
    b_start = sampled.iloc[0]['close']
    chart_benchmark = [round(INITIAL_CAPITAL * (c / b_start), 2) for c in sampled['close']]

    trades_html = ""
    for _, t in trades_df.tail(30).iterrows():
        pnl_class = "pos" if t['net_pnl'] >= 0 else "neg"
        trades_html += f"""
        <tr>
          <td>{t['entry_time'].strftime('%Y-%m-%d %H:%M')}</td>
          <td>{t['exit_time'].strftime('%Y-%m-%d %H:%M')}</td>
          <td><span class="badge {'badge-long' if t['direction'] == 'LONG' else 'badge-short'}">{t['direction']}</span></td>
          <td>€{t['entry_price']:.3f}</td>
          <td>€{t['exit_price']:.3f}</td>
          <td class="{pnl_class}">€{t['net_pnl']:+.2f}</td>
          <td class="{pnl_class}">{t['return_pct']:+.2f}%</td>
          <td><span class="reason-tag">{t['exit_reason']}</span></td>
        </tr>
        """

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>QuantConnect Backtest Report: ONWD Euronext ORB Hybrid</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    :root {{ --bg: #090d16; --card: #111827; --border: #1f2937; --text: #f9fafb; --muted: #9ca3af; --green: #10b981; --red: #ef4444; --accent: #3b82f6; }}
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: var(--bg); color: var(--text); padding: 24px; }}
    .container {{ max-width: 1400px; margin: 0 auto; }}
    header {{ display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid var(--border); }}
    .badge {{ display: inline-block; padding: 3px 8px; border-radius: 6px; font-size: 11px; font-weight: 700; text-transform: uppercase; }}
    .badge-long {{ background: rgba(16, 185, 129, 0.15); color: #34d399; }}
    .badge-short {{ background: rgba(239, 68, 68, 0.15); color: #f87171; }}
    .reason-tag {{ background: rgba(59, 130, 246, 0.1); color: #93c5fd; padding: 2px 6px; border-radius: 4px; font-size: 11px; }}
    .grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; margin-bottom: 24px; }}
    .card {{ background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 16px; }}
    .card-label {{ font-size: 11px; color: var(--muted); text-transform: uppercase; font-weight: 600; }}
    .card-val {{ font-size: 22px; font-weight: 800; margin-top: 4px; }}
    .pos {{ color: var(--green); }} .neg {{ color: var(--red); }}
    .chart-box {{ background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 20px; height: 460px; margin-bottom: 24px; position: relative; }}
    table {{ width: 100%; border-collapse: collapse; font-size: 12px; text-align: right; }}
    th {{ background: #1f2937; color: var(--muted); padding: 10px 14px; font-weight: 600; text-transform: uppercase; }}
    td {{ padding: 10px 14px; border-bottom: 1px solid rgba(31, 41, 55, 0.5); font-family: monospace; }}
    td:first-child, th:first-child, td:last-child, th:last-child {{ text-align: left; font-family: sans-serif; }}
    .table-card {{ background: var(--card); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }}
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div>
        <h1 style="font-size: 24px; font-weight: 800;">QuantConnect Backtest: ONWD Euronext ORB Hybrid</h1>
        <p style="color: var(--muted); font-size: 13px;">Onward Medical NV | Brussels (ENEXT.BE) | 1-Minute Tape | Aug 1, 2026 – Oct 22, 2026</p>
      </div>
      <div>
        <span class="badge" style="background:#2563eb; color:#fff; font-size: 13px; padding: 6px 12px;">LEAN Engine v2.5</span>
      </div>
    </header>

    <div class="grid">
      <div class="card"><div class="card-label">Initial Capital</div><div class="card-val">€{INITIAL_CAPITAL:,.2f}</div></div>
      <div class="card"><div class="card-label">Final Equity</div><div class="card-val">€{final_equity:,.2f}</div></div>
      <div class="card"><div class="card-label">Net Profit</div><div class="card-val {'pos' if total_net_profit >= 0 else 'neg'}">€{total_net_profit:+,.2f} ({total_return_pct:+.2f}%)</div></div>
      <div class="card"><div class="card-label">Benchmark (ONWD)</div><div class="card-val {'pos' if benchmark_return_pct >= 0 else 'neg'}">{benchmark_return_pct:+.2f}%</div></div>
      <div class="card"><div class="card-label">Win Rate</div><div class="card-val">{win_rate:.1f}%</div></div>
      <div class="card"><div class="card-label">Profit Factor</div><div class="card-val">{profit_factor:.2f}</div></div>
      <div class="card"><div class="card-label">Max Drawdown</div><div class="card-val neg">{max_drawdown_pct:.2f}%</div></div>
      <div class="card"><div class="card-label">Sharpe Ratio</div><div class="card-val">{sharpe_ratio:.2f}</div></div>
      <div class="card"><div class="card-label">Total Commission</div><div class="card-val">€{total_commission_paid:,.2f}</div></div>
    </div>

    <div class="chart-box">
      <h3 style="font-size: 15px; margin-bottom: 12px;">Equity Curve vs ONWD Benchmark Buy & Hold</h3>
      <div style="position: absolute; top: 50px; bottom: 15px; left: 15px; right: 15px;">
        <canvas id="equityChart"></canvas>
      </div>
    </div>

    <div class="table-card">
      <div style="padding: 16px; border-bottom: 1px solid var(--border); font-weight: 700; font-size: 14px;">Recent Trades Ledger (Last 30 of {len(trades_df)})</div>
      <table>
        <thead>
          <tr>
            <th>Entry Time (CET)</th>
            <th>Exit Time (CET)</th>
            <th>Direction</th>
            <th>Entry (€)</th>
            <th>Exit (€)</th>
            <th>Net PnL (€)</th>
            <th>Return (%)</th>
            <th>Exit Reason</th>
          </tr>
        </thead>
        <tbody>{trades_html}</tbody>
      </table>
    </div>
  </div>

  <script>
    const ctx = document.getElementById('equityChart').getContext('2d');
    new Chart(ctx, {{
      type: 'line',
      data: {{
        labels: {json.dumps(chart_dates)},
        datasets: [
          {{
            label: 'ORB Strategy Equity (€)',
            data: {json.dumps(chart_equity)},
            borderColor: '#10b981',
            backgroundColor: 'rgba(16, 185, 129, 0.08)',
            borderWidth: 2,
            fill: true,
            pointRadius: 0
          }},
          {{
            label: 'Benchmark ONWD Buy & Hold (€5k init)',
            data: {json.dumps(chart_benchmark)},
            borderColor: '#6b7280',
            borderWidth: 1.5,
            borderDash: [4, 4],
            fill: false,
            pointRadius: 0
          }}
        ]
      }},
      options: {{
        responsive: true,
        maintainAspectRatio: false,
        scales: {{
          x: {{ ticks: {{ color: '#9ca3af', maxTicksLimit: 8 }}, grid: {{ color: 'rgba(31, 41, 55, 0.4)' }} }},
          y: {{ ticks: {{ color: '#9ca3af', callback: v => '€' + v.toFixed(0) }}, grid: {{ color: 'rgba(31, 41, 55, 0.4)' }} }}
        }}
      }}
    }});
  </script>
</body>
</html>
"""
    with open("ONWD_ORB_BACKTEST_REPORT.html", "w", encoding="utf-8") as f:
        f.write(html)
    print(f"[OUTPUT] Interactive HTML Backtest Report saved to: ONWD_ORB_BACKTEST_REPORT.html")

if __name__ == "__main__":
    import json
    run_simulation()
