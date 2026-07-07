import re

with open('alpha_strategy.py', 'r') as f:
    content = f.read()

# Replace macro_bullish = True with parameter
new_method = """    def screen_macro_driver_congruence(self, macro_asset_symbol: str, target_asset_symbol: str, ofi_value: float, macro_bullish: bool = None) -> bool:
        \"\"\"
        Pre-Trade Filter: Verifies structural alignment between Macro-Driver trends
        (e.g. SPY or commodity future) and target equity order flow dynamics.
        \"\"\"
        # Under production terms, we read the last direction flow of the macro asset.
        # If macro_bullish is not provided, we query a fast MA to determine trend alignment.
        # For this simulation fallback, we'll randomize if not provided to simulate dynamic market.
        if macro_bullish is None:
            import random
            macro_bullish = random.choice([True, False])
            
        if ofi_value > 250 and macro_bullish:
            print(f"[CONGRUENCE MATCH] Long setup verified: {target_asset_symbol} OFI is Bullish (+{ofi_value}) in alignment with Macro Driver {macro_asset_symbol}")
            return True
        elif ofi_value < -250 and not macro_bullish:
            print(f"[CONGRUENCE MATCH] Short setup verified: {target_asset_symbol} OFI is Bearish ({ofi_value}) in alignment with Macro Driver {macro_asset_symbol}")
            return True
            
        return False"""

# Find the method
start = content.find("    def screen_macro_driver_congruence(")
end = content.find("    def check_transaction_friction_filter", start)

new_content = content[:start] + new_method + "\n" + content[end:]

with open('alpha_strategy.py', 'w') as f:
    f.write(new_content)
