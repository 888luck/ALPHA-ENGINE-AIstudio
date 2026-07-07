import re

with open('backtester.py', 'r') as f:
    content = f.read()

# Find where 'if __name__ == "__main__":' starts
main_idx = content.find('if __name__ == "__main__":')

# Extract everything before main
before_main = content[:main_idx]

# Extract the main block (until '    def _generate_synthetic_data')
bad_def_idx = content.find('    def _generate_synthetic_data', main_idx)

main_block = content[main_idx:bad_def_idx]

# Now, we need to add back 'generate_synthetic_history' into the AlphaBacktestingEngine class.
# The class ends right before 'if __name__ == "__main__":'
# So we can insert the new real data fetching function at the end of the class

real_data_func = """    def generate_synthetic_history(self, symbol: str, timeframe: str, start_date_str: str, end_date_str: str) -> List[Dict[str, Any]]:
        '''
        Fetches REAL historical OHLCV data from Yahoo Finance instead of generating synthetic data.
        If Yahoo Finance fails, falls back to basic deterministic generation.
        '''
        import urllib.request, json
        
        start_date = datetime.fromisoformat(start_date_str.replace("Z", "+00:00"))
        end_date = datetime.fromisoformat(end_date_str.replace("Z", "+00:00"))

        # Determine interval for YF
        interval = "1d"
        tf_lower = timeframe.lower()
        if "1m" in tf_lower:
            interval = "1m"
        elif "5m" in tf_lower:
            interval = "5m"
        elif "15m" in tf_lower:
            interval = "15m"
        elif "1h" in tf_lower:
            interval = "60m"
            
        start_ts = int(start_date.timestamp())
        end_ts = int(end_date.timestamp())
        
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?interval={interval}&period1={start_ts}&period2={end_ts}"
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        
        bars = []
        try:
            with urllib.request.urlopen(req, timeout=5) as response:
                data = json.loads(response.read())
                result = data.get("chart", {}).get("result", [])
                if result:
                    timestamps = result[0].get("timestamp", [])
                    indicators = result[0].get("indicators", {}).get("quote", [{}])[0]
                    opens = indicators.get("open", [])
                    highs = indicators.get("high", [])
                    lows = indicators.get("low", [])
                    closes = indicators.get("close", [])
                    volumes = indicators.get("volume", [])
                    
                    for i in range(len(timestamps)):
                        if opens[i] is None:
                            continue
                        bars.append({
                            "date": datetime.fromtimestamp(timestamps[i]).isoformat() + "Z",
                            "open": round(float(opens[i]), 2),
                            "high": round(float(highs[i]), 2),
                            "low": round(float(lows[i]), 2),
                            "close": round(float(closes[i]), 2),
                            "volume": int(volumes[i])
                        })
            
            if len(bars) > 0:
                print(f"[BACKTESTER] Fetched {len(bars)} real historical bars for {symbol} from Yahoo Finance.")
                return bars
        except Exception as e:
            import sys
            print(f"[BACKTESTER] Failed to fetch real data from Yahoo Finance: {e}. Falling back to synthetic generation.", file=sys.stderr)
            pass
            
        # Fallback basic generation if real data fails
        current_time = start_date
        current_price = 100.0
        delta_minutes = 60 if interval != "1d" else 1440
        random.seed(hash(symbol))
        
        while current_time <= end_date:
            if current_time.weekday() < 5:
                chg = current_price * random.normalvariate(0.0002, 0.015)
                op = current_price
                cl = op + chg
                bars.append({
                    "date": current_time.isoformat() + "Z",
                    "open": round(op, 2),
                    "high": round(max(op, cl) * 1.01, 2),
                    "low": round(min(op, cl) * 0.99, 2),
                    "close": round(cl, 2),
                    "volume": int(1000000 * random.uniform(0.5, 1.5))
                })
                current_price = cl
            current_time += timedelta(minutes=delta_minutes)
        return bars
"""

new_content = before_main + real_data_func + "\n" + main_block

with open('backtester.py', 'w') as f:
    f.write(new_content)
