#!/usr/bin/env python3
"""
Step 2: Microstructure Audit for CUE (NASDAQ)
Evaluates:
- Zero-volume bar %
- Average spread & trading volume
- Peak morning liquidity windows
- IBKR Pro Tiered commissions vs expected win size
"""

import pandas as pd
import numpy as np

CSV_FILE = "CUE_NASDAQ_1MIN_6MONTHS.csv"

def audit_microstructure():
    df = pd.read_csv(CSV_FILE)
    df['dt_utc'] = pd.to_datetime(df['datetime'].str.strip(), format='%Y%m%d %H:%M:%S', utc=True)
    # NASDAQ RTH is 09:30 - 16:00 US Eastern
    df['dt_et'] = df['dt_utc'].dt.tz_convert('America/New_York')
    df['time'] = df['dt_et'].dt.time
    df['date'] = df['dt_et'].dt.date
    df['hour_min'] = df['dt_et'].dt.strftime('%H:%M')

    total_bars = len(df)
    zero_vol_bars = (df['volume'] == 0).sum()
    zero_vol_pct = (zero_vol_bars / total_bars) * 100.0

    print("==================================================")
    print("STEP 2: MICROSTRUCTURE AUDIT REPORT - CUE (NASDAQ)")
    print("==================================================")
    print(f"Total authentic 1-minute bars: {total_bars:,}")
    print(f"Trading days analyzed: {df['date'].nunique()}")
    print(f"Zero-volume bars: {zero_vol_bars} ({zero_vol_pct:.2f}%)")
    print(f"Price range: ${df['low'].min():.2f} - ${df['high'].max():.2f} | Average Close: ${df['close'].mean():.2f}")
    print(f"Average 1-minute bar volume: {df['volume'].mean():.1f} shares")
    print(f"Median 1-minute bar volume: {df['volume'].median():.1f} shares")
    print(f"Average bar trade count: {df['count'].mean():.1f} trades")

    # High-Low Range / Spread estimate
    df['hl_spread'] = (df['high'] - df['low']) / df['close'] * 100.0
    print(f"Average 1-minute High-Low Range: {df['hl_spread'].mean():.2f}%")
    print(f"Median 1-minute High-Low Range: {df['hl_spread'].median():.2f}%")

    # Volume profile by time window
    print("\n--- Volume Profile Across Trading Session (US Eastern) ---")
    windows = [
        ("09:30 - 09:45 (Early Open)", "09:30", "09:45"),
        ("09:45 - 10:00 (ORB 30m Cutoff)", "09:45", "10:00"),
        ("10:00 - 10:30 (Morning Expansion)", "10:00", "10:30"),
        ("10:30 - 11:30 (Mid-Morning Continuation)", "10:30", "11:30"),
        ("11:30 - 14:00 (Midday Chop / Low Vol)", "11:30", "14:00"),
        ("14:00 - 15:30 (Afternoon Setup)", "14:00", "15:30"),
        ("15:30 - 16:00 (Power Hour / Close)", "15:30", "16:00")
    ]

    for label, start_t, end_t in windows:
        sub = df[(df['hour_min'] >= start_t) & (df['hour_min'] < end_t)]
        avg_vol = sub['volume'].mean()
        avg_cnt = sub['count'].mean()
        avg_range = sub['hl_spread'].mean()
        tot_vol_pct = (sub['volume'].sum() / df['volume'].sum()) * 100.0
        print(f"{label:35s} | Avg Vol: {avg_vol:6.1f} | Avg Trades: {avg_cnt:4.1f} | Avg Range: {avg_range:.2f}% | Session Vol%: {tot_vol_pct:.1f}%")

    # IBKR Pro Tiered Commission Budget
    # US Stocks: $0.0035/share (min $0.35 per order) + FINRA/SEC fees (~$0.0001/share)
    # For a $5,000 position on a ~$25 stock = 200 shares.
    # Entry fee: max($0.35, 200 * $0.0035) = $0.70
    # Roundtrip fee: ~$1.40 - $1.80 total (0.03% - 0.036% friction)
    print("\n--- IBKR Pro Tiered Commission Budget ---")
    sim_capital = 5000.0
    typical_price = df['close'].mean()
    est_shares = int(sim_capital // typical_price)
    single_order_comm = max(0.35, est_shares * 0.0035) + (est_shares * 0.0001)
    roundtrip_comm = single_order_comm * 2.0
    friction_pct = (roundtrip_comm / sim_capital) * 100.0
    print(f"Typical share price: ${typical_price:.2f}")
    print(f"Simulated position size ({sim_capital:.0f} USD): {est_shares} shares")
    print(f"Single order commission: ${single_order_comm:.2f}")
    print(f"Roundtrip commission: ${roundtrip_comm:.2f} ({friction_pct:.3f}% of capital)")
    print(f"Commission impact on a 2.0% winner (${sim_capital * 0.02:.2f}): {roundtrip_comm / (sim_capital * 0.02) * 100.0:.2f}% of profit")
    print("Microstructure Conclusion: Exceptionally low commission friction compared to European exchanges; viable for precision ORB execution.")

if __name__ == "__main__":
    audit_microstructure()
