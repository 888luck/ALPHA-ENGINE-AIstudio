import pytest
from alpha_strategy import AlphaStrategy

class DummyConnection:
    pass

def test_ofi_cont_kukanov_stoikov():
    """Validates the Cont-Kukanov-Stoikov (2014) OFI formulation against hand-calculated cases."""
    strat = AlphaStrategy(DummyConnection(), dec_maker="DM", exec_trader="ET")
    
    # Initial quote tick for AAPL: Bid 100.00 x 10 | Ask 100.10 x 20 -> returns 0.0 on initialization
    ofi_init = strat.calculate_ofi("AAPL", bid_price=100.00, bid_size=10, ask_price=100.10, ask_size=20)
    assert ofi_init == 0.0
    
    # Case 1: Bid price improves to 100.05 x 15 (Ask unchanged at 100.10 x 20)
    # e_b = 15 (price improved)
    # e_a = 20 - 20 = 0 (same ask price & size)
    # OFI = 15 - 0 = +15 (Bullish)
    ofi_1 = strat.calculate_ofi("AAPL", bid_price=100.05, bid_size=15, ask_price=100.10, ask_size=20)
    assert ofi_1 == 15.0
    
    # Case 2: Ask lifted/rises from 100.10 to 100.15 (prev ask size was 20)
    # e_a = -20 (ask price rose, old queue absorbed)
    # Bid unchanged at 100.05 x 15 -> e_b = 0
    # OFI = 0 - (-20) = +20 (Bullish)
    ofi_2 = strat.calculate_ofi("AAPL", bid_price=100.05, bid_size=15, ask_price=100.15, ask_size=25)
    assert ofi_2 == 20.0
    
    # Case 3: Ask drops from 100.15 to 100.10 with size 30 (new lower ask pressing down)
    # e_a = 30 (ask price dropped)
    # Bid unchanged -> e_b = 0
    # OFI = 0 - 30 = -30 (Bearish)
    ofi_3 = strat.calculate_ofi("AAPL", bid_price=100.05, bid_size=15, ask_price=100.10, ask_size=30)
    assert ofi_3 == -30.0

    # Case 4: Ask queue increases at same price (100.10) from 30 to 50
    # e_a = 50 - 30 = 20
    # Bid unchanged -> e_b = 0
    # OFI = 0 - 20 = -20 (Bearish)
    ofi_4 = strat.calculate_ofi("AAPL", bid_price=100.05, bid_size=15, ask_price=100.10, ask_size=50)
    assert ofi_4 == -20.0

def test_ofi_multi_symbol_isolation():
    """Validates that quotes from symbol A do not contaminate symbol B."""
    strat = AlphaStrategy(DummyConnection(), dec_maker="DM", exec_trader="ET")
    
    # AAPL baseline
    strat.calculate_ofi("AAPL", bid_price=150.0, bid_size=100, ask_price=150.10, ask_size=100)
    
    # MSFT baseline
    strat.calculate_ofi("MSFT", bid_price=400.0, bid_size=50, ask_price=400.20, ask_size=50)
    
    # AAPL tick: Bid unchanged, ask lifted to 150.20 x 80 -> OFI = +100
    ofi_aapl = strat.calculate_ofi("AAPL", bid_price=150.0, bid_size=100, ask_price=150.20, ask_size=80)
    assert ofi_aapl == 100.0
    
    # MSFT tick: Bid drops to 399.80 x 40 -> e_b = -50, ask unchanged -> OFI = -50
    ofi_msft = strat.calculate_ofi("MSFT", bid_price=399.80, bid_size=40, ask_price=400.20, ask_size=50)
    assert ofi_msft == -50.0

if __name__ == "__main__":
    pytest.main(["-v", __file__])
