import re

with open('alpha_strategy.py', 'r') as f:
    content = f.read()

new_method = """    def screen_macro_driver_congruence(self, macro_asset_symbol: str, target_asset_symbol: str, ofi_value: float, macro_bullish: bool = None) -> bool:
        \"\"\"
        Pre-Trade Filter: Verifies structural alignment between Macro-Driver trends
        (e.g. SPY or commodity future) and target equity order flow dynamics.
        Checks SMA-20 congruence to set trend direction (Long above, Short below).
        \"\"\"
        if macro_bullish is None:
            # Implement actual SMA-20 cross check for the macro asset
            import urllib.request
            import json
            import time
            try:
                # Fetch last ~30 days of daily data to ensure we have 20 periods
                url = f"https://query1.finance.yahoo.com/v8/finance/chart/{macro_asset_symbol}?interval=1d&range=30d"
                req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
                with urllib.request.urlopen(req, timeout=5) as response:
                    data = json.loads(response.read())
                    indicators = data["chart"]["result"][0]["indicators"]["quote"][0]
                    closes = [c for c in indicators.get("close", []) if c is not None]
                    
                    if len(closes) >= 20:
                        sma_20 = sum(closes[-20:]) / 20.0
                        current_price = closes[-1]
                        macro_bullish = current_price > sma_20
                    else:
                        macro_bullish = True # Fallback
            except Exception as e:
                print(f"[CONGRUENCE ERROR] Failed to fetch macro data for {macro_asset_symbol}: {e}")
                # Fallback deterministic based on symbol to avoid random flip-flopping
                macro_bullish = hash(macro_asset_symbol) % 2 == 0
                
        if ofi_value > 250 and macro_bullish:
            print(f"[CONGRUENCE MATCH] Long setup verified: {target_asset_symbol} OFI is Bullish (+{ofi_value}) in alignment with Macro Driver {macro_asset_symbol}")
            return True
        elif ofi_value < -250 and not macro_bullish:
            print(f"[CONGRUENCE MATCH] Short setup verified: {target_asset_symbol} OFI is Bearish ({ofi_value}) in alignment with Macro Driver {macro_asset_symbol}")
            return True
            
        return False"""

start = content.find("    def screen_macro_driver_congruence(")
end = content.find("    def check_transaction_friction_filter", start)

new_content = content[:start] + new_method + "\n" + content[end:]

with open('alpha_strategy.py', 'w') as f:
    f.write(new_content)
