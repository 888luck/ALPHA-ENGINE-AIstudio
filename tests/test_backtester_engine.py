"""
Test Suite: Quantitative Backtesting Engine & Event-Study Auditor
Universal Institutional Engineering Principles - Empirical Math & Backtesting Rules
"""

import pytest
import numpy as np
from backtester import AlphaBacktestingEngine
from event_backtester import EventStudyBacktester
from llm_ensemble import MultiModelEnsemble

def test_backtester_ibie_commissions():
    engine = AlphaBacktestingEngine(starting_capital=100000.0)
    
    # 1. European Equities (e.g., SAP, ASML) - 0.05% of value, min €1.25
    eu_comm_small = engine.calculate_ibie_commission("SAP", quantity=10, price=100.0) # 1000 * 0.0005 = 0.50 -> Min 1.25
    assert eu_comm_small == 1.25, f"Expected min €1.25, got {eu_comm_small}"
    
    eu_comm_large = engine.calculate_ibie_commission("ASML", quantity=50, price=800.0) # 40000 * 0.0005 = 20.00
    assert eu_comm_large == 20.0, f"Expected €20.00, got {eu_comm_large}"

    # 2. US Equities (e.g., NVDA, AAPL) - $0.005 per share, min $1.00
    us_comm_small = engine.calculate_ibie_commission("NVDA", quantity=10, price=120.0) # 10 * 0.005 = 0.05 -> Min 1.00
    assert us_comm_small == 1.00, f"Expected min $1.00, got {us_comm_small}"
    
    us_comm_large = engine.calculate_ibie_commission("NVDA", quantity=500, price=120.0) # 500 * 0.005 = 2.50
    assert us_comm_large == 2.50, f"Expected $2.50, got {us_comm_large}"

def test_backtester_algorithmic_execution(monkeypatch):
    engine = AlphaBacktestingEngine(starting_capital=100000.0)
    
    # Provide 50 real-structured historical price bars for deterministic execution verification
    base_bars = [
        {
            "date": f"2026-01-{i+1:02d}T09:30:00Z" if i < 28 else f"2026-02-{i-27:02d}T09:30:00Z",
            "open": round(120.0 + i * 0.25, 2),
            "high": round(121.5 + i * 0.25, 2),
            "low": round(119.5 + i * 0.25, 2),
            "close": round(121.0 + i * 0.25, 2),
            "volume": int(1500000 + (i % 5) * 100000)
        }
        for i in range(50)
    ]
    # Inject breakout bar at bar 25 to verify algorithmic entry, 1.8 ATR sizing, and friction check
    base_bars[25]["close"] = 132.0
    base_bars[25]["high"] = 133.0
    base_bars[25]["volume"] = 3500000  # OFI volume expansion trigger (> 1.4x 10-period MA)

    monkeypatch.setattr(engine, "generate_synthetic_history", lambda *args, **kwargs: base_bars)
    
    # Run backtest with 15% friction ceiling and 1.8 ATR stop
    results = engine.run_backtest(
        symbol="NVDA",
        timeframe="5m",
        start_date="2026-01-01",
        end_date="2026-02-20",
        stop_atr=1.8,
        friction_ceiling_pct=15.0,
        risk_budget_pct=0.01
    )
    
    assert "finalCapital" in results
    assert "totalTrades" in results
    assert "totalPnL" in results
    assert "winRate" in results
    assert "profitFactor" in results
    assert "balanceHistory" in results
    assert "gateAttribution" in results
    assert results["startingCapital"] == 100000.0
    assert len(results["priceHistory"]) == 50
    print(f"\n[BACKTEST VERIFIED] Trades: {results['totalTrades']} | Final Capital: ${results['finalCapital']:.2f} | Gate Attribution: {results['gateAttribution']}")

def test_event_backtester_brier_score():
    ensemble = MultiModelEnsemble()
    backtester = EventStudyBacktester(ensemble=ensemble)
    
    # Forecasts: [0.9, 0.8, 0.2, 0.1]
    # Outcomes:  [1,   1,   0,   0]
    # Brier score: ((0.9-1)^2 + (0.8-1)^2 + (0.2-0)^2 + (0.1-0)^2) / 4
    #             = (0.01 + 0.04 + 0.04 + 0.01) / 4 = 0.10 / 4 = 0.025
    forecasts = [0.9, 0.8, 0.2, 0.1]
    outcomes = [1, 1, 0, 0]
    brier = backtester.calculate_brier_score(forecasts, outcomes)
    assert np.isclose(brier, 0.025, atol=1e-5), f"Unexpected Brier score: {brier}"

def test_event_backtester_excursions():
    ensemble = MultiModelEnsemble()
    backtester = EventStudyBacktester(ensemble=ensemble)
    
    # Bullish entry @ 100, price series: [102, 105, 98, 103]
    # MFE = (105 - 100) / 100 * 100 = +5.0%
    # MAE = (98 - 100) / 100 * 100 = -2.0%
    price_series = [102.0, 105.0, 98.0, 103.0]
    excursions = backtester.calculate_excursions(100.0, price_series, "BULLISH")
    
    assert np.isclose(excursions["mfe_pct"], 5.0, atol=1e-4)
    assert np.isclose(excursions["mae_pct"], -2.0, atol=1e-4)
    assert np.isclose(excursions["final_pct"], 3.0, atol=1e-4)
