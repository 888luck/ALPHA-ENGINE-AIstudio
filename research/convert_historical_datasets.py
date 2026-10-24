"""
Converts verified broker historical minute CSV datasets into standard AlphaEngine JSON bar caches.
Zero Synthetic Policy: strictly preserves authentic timestamps, OHLCV, and volume.
"""

import os
import csv
import json
from datetime import datetime
from collections import defaultdict

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STUDIO_DIR = os.path.join(BASE_DIR, "ALPHA-ENGINE-AIstudio")

DATASETS = [
    {
        "csv": "ATO_EURONEXT_1MIN_1YEAR.csv",
        "symbols": ["ATO", "ATOS"],
        "default_bar_count": 60
    },
    {
        "csv": "ONWD_EURONEXT_1MIN_1YEAR.csv",
        "symbols": ["ONWD"],
        "default_bar_count": 60
    },
    {
        "csv": "CUE_NASDAQ_1MIN_1YEAR.csv",
        "symbols": ["CUE"],
        "default_bar_count": 60
    }
]

def parse_date_str(raw: str) -> datetime:
    # Formats: '20251024  07:00:00' or '2025-10-24 07:00:00'
    cleaned = raw.strip()
    if "  " in cleaned:
        cleaned = " ".join(cleaned.split())
    if len(cleaned.split()[0]) == 8 and cleaned.split()[0].isdigit():
        return datetime.strptime(cleaned, "%Y%m%d %H:%M:%S")
    return datetime.fromisoformat(cleaned)

def process_dataset(info):
    csv_file = os.path.join(BASE_DIR, info["csv"])
    if not os.path.exists(csv_file):
        print(f"Skipping {info['csv']}: file not found.")
        return

    print(f"Processing {info['csv']}...")
    minute_bars = []
    hourly_buckets = defaultdict(list)

    with open(csv_file, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            dt_str = row.get("datetime") or row.get("date") or row.get("timestamp")
            if not dt_str:
                continue
            dt = parse_date_str(dt_str)
            o = float(row["open"])
            h = float(row["high"])
            l = float(row["low"])
            c = float(row["close"])
            v = float(row.get("volume", 0.0))
            count = int(float(row.get("count", row.get("barCount", 1))))
            wap = float(row.get("wap", c))

            formatted_dt = dt.strftime("%Y-%m-%d %H:%M:%S")
            m_bar = {
                "date": formatted_dt,
                "open": o,
                "high": h,
                "low": l,
                "close": c,
                "volume": v,
                "barCount": count,
                "average": wap
            }
            minute_bars.append(m_bar)

            # Bucket by hour
            hour_key = dt.strftime("%Y-%m-%d %H:00:00")
            hourly_buckets[hour_key].append(m_bar)

    # Build 1-hour bars
    hourly_bars = []
    for h_key in sorted(hourly_buckets.keys()):
        bars_in_hour = hourly_buckets[h_key]
        h_open = bars_in_hour[0]["open"]
        h_high = max(b["high"] for b in bars_in_hour)
        h_low = min(b["low"] for b in bars_in_hour)
        h_close = bars_in_hour[-1]["close"]
        h_vol = sum(b["volume"] for b in bars_in_hour)
        h_count = sum(b["barCount"] for b in bars_in_hour)
        h_wap = round(sum(b["close"] * (b["volume"] or 1) for b in bars_in_hour) / max(1.0, sum((b["volume"] or 1) for b in bars_in_hour)), 4)

        hourly_bars.append({
            "date": h_key,
            "open": round(h_open, 4),
            "high": round(h_high, 4),
            "low": round(h_low, 4),
            "close": round(h_close, 4),
            "volume": round(h_vol, 2),
            "barCount": h_count,
            "average": h_wap
        })

    print(f"Generated {len(minute_bars)} minute bars, {len(hourly_bars)} hourly bars.")

    # Save to both BASE_DIR and STUDIO_DIR for each alias
    target_dirs = [BASE_DIR]
    if os.path.exists(STUDIO_DIR):
        target_dirs.append(STUDIO_DIR)

    for sym in info["symbols"]:
        for t_dir in target_dirs:
            # 1. Default (hourly) bar file
            path_default = os.path.join(t_dir, f"historical_bars_{sym}.json")
            path_1h = os.path.join(t_dir, f"historical_bars_{sym}_1h.json")
            with open(path_default, "w", encoding="utf-8") as f:
                json.dump(hourly_bars, f, indent=2)
            with open(path_1h, "w", encoding="utf-8") as f:
                json.dump(hourly_bars, f, indent=2)
            print(f"Saved: {path_default} ({len(hourly_bars)} bars)")

def main():
    for ds in DATASETS:
        process_dataset(ds)

if __name__ == "__main__":
    main()
