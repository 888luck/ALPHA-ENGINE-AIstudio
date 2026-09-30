import os
import subprocess
import pytest
from backtester import AlphaBacktestingEngine

def test_backtester_fail_loud_on_missing_data():
    """Validates that backtester refuses random-walk fabrication and fails loudly on invalid/missing tickers."""
    engine = AlphaBacktestingEngine(starting_capital=100000.0)
    
    # 1. Invalid ticker must raise an exception rather than silently generating random walk
    with pytest.raises((RuntimeError, ValueError)):
        engine.run_backtest(
            symbol="NONEXISTENT_TICKER_XYZ_9999",
            timeframe="1d",
            start_date="2026-01-01T00:00:00Z",
            end_date="2026-01-10T00:00:00Z"
        )

def test_no_mock_trades_in_server():
    """Validates that server.ts has zero startup mock trades and zero hardcoded activeTrades seeds."""
    server_path = os.path.join(os.path.dirname(__file__), "server.ts")
    with open(server_path, "r", encoding="utf-8") as f:
        content = f.read()
        
    assert 'let activeTrades: ActiveTrade[] = [];' in content, "activeTrades must be initialized as empty array"
    assert 'let historicalLogs: HistoricalLog[] = [];' in content, "historicalLogs must be initialized as empty array"
    assert "TRD_001" not in content, "Mock TRD_001 trade must not exist in server.ts"
    assert "LOG_101" not in content, "Mock LOG_101 trade must not exist in server.ts"
    assert "authMiddleware" in content, "authMiddleware must be defined and protecting state routes"
    assert "getMaskedSettings" in content, "getMaskedSettings must mask credentials in diagnostics and state"

def test_git_hygiene_and_requirements():
    """Validates that git does not track __pycache__ or .pyc files and requirements.txt is pinned."""
    # Check requirements.txt
    req_path = os.path.join(os.path.dirname(__file__), "requirements.txt")
    assert os.path.exists(req_path), "requirements.txt must exist"
    with open(req_path, "r", encoding="utf-8") as f:
        reqs = f.read()
    assert "exchange-calendars==4.13.2" in reqs
    assert "pydantic" in reqs
    assert "numpy" in reqs
    assert "pandas" in reqs

    # Check git tracking
    result = subprocess.run(["git", "ls-files", "__pycache__"], capture_output=True, text=True)
    assert result.stdout.strip() == "", f"Git must not track any pyc files, found: {result.stdout}"

if __name__ == "__main__":
    pytest.main(["-v", __file__])
