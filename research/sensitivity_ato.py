import pandas as pd
from run_ato_7stage_playbook import run_simulation

df = pd.read_csv('ATO_EURONEXT_1MIN_1YEAR.csv')
df['dt_utc'] = pd.to_datetime(df['datetime'].str.strip(), format='%Y%m%d %H:%M:%S', utc=True)
df['dt_cet'] = df['dt_utc'].dt.tz_convert('Europe/Paris')
df['date'] = df['dt_cet'].dt.date
daily_closes = df.groupby('date')['close'].last().to_frame()
daily_closes['ema20'] = daily_closes['close'].ewm(span=20, adjust=False).mean()
bullish_dates = set(daily_closes[daily_closes['close'] > daily_closes['ema20']].index)

print(f"Total Trading Days: {len(daily_closes)}")
print(f"Bullish Days (Close > EMA-20): {len(bullish_dates)} ({len(bullish_dates)/len(daily_closes)*100:.1f}%)")

# Let's inspect stop-loss distances on ATO
for stop in [0.015, 0.020, 0.025, 0.030, 0.040, 0.050]:
    for win_mins in [15, 30]:
        res = run_simulation(
            use_trend_shield=True,
            hard_stop_pct=stop,
            use_breakeven=True,
            breakeven_trigger=0.012,
            use_dynamic_trailing=True,
            trail_trigger_pct=0.035,
            trail_dist_pct=0.018,
            orb_window_mins=win_mins,
            min_volume_threshold=500.0
        )
        print(f"Stop: {stop*100:.1f}% | {win_mins}m ORB | Trades: {res['total_trades']} | WinRate: {res['win_rate']:.1f}% | Net PnL: €{res['net_pnl']:+,.2f} ({res['return_pct']:+.2f}%) | PF: {res['profit_factor']:.2f} | Max DD: {res['max_dd']:.2f}%")
