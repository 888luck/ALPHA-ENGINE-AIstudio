import pandas as pd
import numpy as np

df = pd.read_csv('ATO_EURONEXT_1MIN_1YEAR.csv')
df['dt_utc'] = pd.to_datetime(df['datetime'].str.strip(), format='%Y%m%d %H:%M:%S', utc=True)
df['dt_cet'] = df['dt_utc'].dt.tz_convert('Europe/Paris')
df['time'] = df['dt_cet'].dt.time
df['date'] = df['dt_cet'].dt.date

trading_days = df['date'].unique()
print(f"Total Trading Days: {len(trading_days)}")
print(f"Total 1-min bars: {len(df):,}")
print(f"Date range: {df['date'].min()} to {df['date'].max()}")

# Zero volume bars
zero_vol = df[df['volume'] == 0]
print(f"Zero-volume bars: {len(zero_vol):,} ({len(zero_vol)/len(df)*100:.2f}%)")

# Average daily volume & value
daily_vol = df.groupby('date')['volume'].sum()
daily_val = df.groupby('date').apply(lambda d: (d['volume'] * d['wap']).sum())
print(f"Avg Daily Volume: {daily_vol.mean():,.0f} shares")
print(f"Avg Daily Traded Value: €{daily_val.mean():,.0f}")
print(f"Median Daily Traded Value: €{daily_val.median():,.0f}")

# Intraday volume distribution by hour
df['hour'] = df['dt_cet'].dt.hour
hourly_vol = df.groupby('hour')['volume'].sum()
total_vol = df['volume'].sum()
print("\nHourly Volume Distribution (% of total):")
for h, v in hourly_vol.items():
    print(f"  {h:02d}:00 CET: {v/total_vol*100:.2f}% ({v:,.0f} shares)")

# Intraday spread friction proxy: High - Low per bar
df['spread_proxy_pct'] = (df['high'] - df['low']) / df['close'] * 100
print(f"\nAverage 1-min High-Low Range: {df['spread_proxy_pct'].mean():.3f}%")
print(f"Median 1-min High-Low Range: {df['spread_proxy_pct'].median():.3f}%")

# Price Range over the year
print(f"\nPrice Range: Min=€{df['low'].min():.2f}, Max=€{df['high'].max():.2f}")
print(f"Latest Close: €{df['close'].iloc[-1]:.2f}")
