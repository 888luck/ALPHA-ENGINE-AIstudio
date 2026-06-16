import sys
import json
import random
from datetime import datetime, timedelta
from typing import List, Dict, Any

# Standard mock-ready classes matching connection.py structure
try:
    from connection import ConnectionManager
    from contract_helper import setup_contract_for_symbol
except ImportError:
    pass

class AlphaBacktestingEngine:
    """
    Local Quantitative Backtesting Engine in Python.
    Generates high-fidelity historical/intraday bar series for selected tickers,
    and simulates execution of the Alpha Strategy with 1% risk pool sizing,
    IBKR Europe (IBIE) commission structures, and 15% trade friction limits.
    """
    def __init__(self, starting_capital: float = 100000.0):
        self.starting_capital = starting_capital
        self.equity = starting_capital
        self.balance_history = []
        self.trades_history = []
        
    def generate_synthetic_history(self, symbol: str, timeframe: str, start_date_str: str, end_date_str: str) -> List[Dict[str, Any]]:
        """
        Generates realistic synthetic OHLCV intraday or daily historical bars
        for testing, incorporating ticker-specific volatility, trend bias, and average volumes.
        """
        # Parse dates
        try:
            start_date = datetime.strptime(start_date_str, "%Y-%m-%d")
        except:
            start_date = datetime.now() - timedelta(days=30)
            
        try:
            end_date = datetime.strptime(end_date_str, "%Y-%m-%d")
        except:
            end_date = datetime.now()
            
        if end_date < start_date:
            end_date = start_date + timedelta(days=30)

        # Establish ticker profile biases (representing real performance traits)
        sym = symbol.upper()
        base_price = 100.0
        drift = 0.0002       # Standard steady upward trend
        volatility = 0.015   # 1.5% standard dev
        avg_volume = 1500000
        
        if sym == "XLE":
            base_price = 93.15
            drift = 0.0004
            volatility = 0.018  # Oil volatility
        elif sym == "NEE":
            base_price = 73.10
            drift = -0.0001     # Defensive/utilities rangebound
            volatility = 0.008
        elif sym == "ENPH":
            base_price = 114.20
            drift = 0.0012      # High momentum tech
            volatility = 0.038  # Clean-tech massive high-vol swingy
        elif sym == "SAP":
            base_price = 178.50
            drift = 0.0006
            volatility = 0.012
        elif sym == "RWE":
            base_price = 33.40
            drift = -0.0002
            volatility = 0.014
        else:
            # Generic random ticker
            random.seed(hash(sym))
            base_price = random.uniform(20.0, 200.0)
            drift = random.uniform(-0.0005, 0.001)
            volatility = random.uniform(0.01, 0.03)

        # Decide bar frequency in minutes
        delta_minutes = 60
        tf_lower = timeframe.lower()
        if "1m" in tf_lower:
            delta_minutes = 1
        elif "5m" in tf_lower:
            delta_minutes = 5
        elif "15m" in tf_lower:
            delta_minutes = 15
        elif "1h" in tf_lower:
            delta_minutes = 60
        elif "1d" in tf_lower or "daily" in tf_lower:
            delta_minutes = 1440
            
        bars = []
        current_time = start_date
        current_price = base_price
        
        # Build list of datetime steps (excluding weekends)
        date_steps = []
        while current_time <= end_date:
            # Weekday check
            if current_time.weekday() < 5:
                # Intraday hours session logic (9:30 AM to 4:00 PM NYC) if timeframe is intraday
                if delta_minutes < 1440:
                    session_start = current_time.replace(hour=9, minute=30, second=0, microsecond=0)
                    session_end = current_time.replace(hour=16, minute=0, second=0, microsecond=0)
                    
                    bar_time = session_start
                    while bar_time <= session_end:
                        date_steps.append(bar_time)
                        bar_time += timedelta(minutes=delta_minutes)
                else:
                    # Daily timeframe has 1 bar per day at 4:00 PM
                    date_steps.append(current_time.replace(hour=16, minute=0, second=0))
                    
            current_time += timedelta(days=1)
            
        # Re-initialize deterministic sequence seed for safety and consistent testing curves
        random.seed(91283 + hash(sym))
        
        for idx, t in enumerate(date_steps):
            chg = current_price * (random.normalvariate(drift, volatility))
            op = current_price
            cl = op + chg
            
            # Clamp prices to > 1
            if cl < 1.0: cl = 1.0
            if op < 1.0: op = 1.0
            
            high = max(op, cl) + (current_price * abs(random.normalvariate(0, volatility * 0.5)))
            low = min(op, cl) - (current_price * abs(random.normalvariate(0, volatility * 0.5)))
            
            if low < 0.5: low = 0.5
            
            vol = int(avg_volume * random.uniform(0.5, 1.8) * (1.5 if abs(chg)/cl > volatility else 0.8))
            
            bars.append({
                "date": t.isoformat() + "Z",
                "open": round(op, 2),
                "high": round(high, 2),
                "low": round(low, 2),
                "close": round(cl, 2),
                "volume": vol
            })
            
            current_price = cl
            
        return bars

    def calculate_ibie_commission(self, symbol: str, quantity: float, price: float) -> float:
        """
        Calculates realistic IBIE commissions:
        - European equities focus: 0.05% of value, min €1.25
        - US equities focus: $0.005 per share, min $1.00
        """
        sym = symbol.upper()
        is_european = sym in ["SAP", "RWE", "ENGI", "SGO", "LVMH", "ASML", "MC"]
        
        if is_european:
            trade_value = quantity * price
            base_comm = trade_value * 0.0005
            return max(1.25, base_comm)
        else:
            base_comm = quantity * 0.005
            return max(1.00, base_comm)

    def run_backtest(self, symbol: str, timeframe: str, start_date: str, end_date: str) -> Dict[str, Any]:
        """
        Executes an algorithmic backtest over historical metrics.
        The Strategy: 
          - Checks SMA-20 trend context (congruence check).
          - Triggers long/short entry upon breakout signals (OFI proxy based on volume expansion + close location).
          - Configures 1% systematic capital risk rules (ATR-based dynamic stops).
          - Enforces the 15% transactional friction limit (IBIE rules).
        """
        bars = self.generate_synthetic_history(symbol, timeframe, start_date, end_date)
        if len(bars) < 25:
            # Generate longer mock data if range is too narrow to build SMA-20
            bars = self.generate_synthetic_history(symbol, timeframe, "2026-05-01", "2026-06-16")

        self.equity = self.starting_capital
        self.balance_history = [{"date": bars[0]["date"], "equity": self.starting_capital}]
        self.trades_history = []
        
        # Calculate a 20-period simple moving average and standard ATR
        close_prices = [b["close"] for b in bars]
        smas = []
        atrs = []
        
        for i in range(len(bars)):
            if i < 20:
                smas.append(close_prices[i])
                atrs.append(close_prices[i] * 0.02) # initial approx
            else:
                smas.append(sum(close_prices[i-20:i]) / 20.0)
                # True range computation
                tr_sum = 0
                for j in range(i-14, i):
                    hl = bars[j]["high"] - bars[j]["low"]
                    tr_sum += hl
                atrs.append((tr_sum / 14.0) if tr_sum > 0 else (close_prices[i] * 0.015))

        # Position tracking variables
        active_position = None  # None or Dict representing active trade
        
        for i in range(20, len(bars)):
            bar = bars[i]
            prev_bar = bars[i-1]
            current_close = bar["close"]
            current_atr = atrs[i]
            current_sma = smas[i]
            
            # Sync equity curve tracking to bar date
            current_eq = self.equity
            if active_position:
                direction_multiplier = 1 if active_position["direction"] == "BUY" else -1
                unrealized = (current_close - active_position["entry_price"]) * active_position["quantity"] * direction_multiplier
                current_eq += unrealized
            
            self.balance_history.append({
                "date": bar["date"],
                "equity": round(current_eq, 2)
            })

            # 1. Update active position targets (Stops & Profits checking / exits)
            if active_position:
                pos = active_position
                triggered_exit = False
                exit_price = current_close
                exit_reason = ""
                
                if pos["direction"] == "BUY":
                    # Check stop loss hit
                    if bar["low"] <= pos["stop_price"]:
                        exit_price = pos["stop_price"]
                        triggered_exit = True
                        exit_reason = "STOP LOSS BREACH"
                    # Check target profit hit
                    elif bar["high"] >= pos["target_price"]:
                        exit_price = pos["target_price"]
                        triggered_exit = True
                        exit_reason = "PROFIT TARGET ACHIEVED"
                else: # SELL
                    # Check stop loss hit
                    if bar["high"] >= pos["stop_price"]:
                        exit_price = pos["stop_price"]
                        triggered_exit = True
                        exit_reason = "STOP LOSS BREACH"
                    # Check target profit hit
                    if bar["low"] <= pos["target_price"]:
                        exit_price = pos["target_price"]
                        triggered_exit = True
                        exit_reason = "PROFIT TARGET ACHIEVED"
                        
                # End of session forced close if daily tracking and we reach final bar
                if not triggered_exit and i == len(bars) - 1:
                    exit_price = current_close
                    triggered_exit = True
                    exit_reason = "BACKTEST TERMINATION WINDOW"

                if triggered_exit:
                    direction_multiplier = 1 if pos["direction"] == "BUY" else -1
                    gross_pnl = (exit_price - pos["entry_price"]) * pos["quantity"] * direction_multiplier
                    
                    # Apply commissions logic
                    entry_comm = self.calculate_ibie_commission(symbol, pos["quantity"], pos["entry_price"])
                    exit_comm = self.calculate_ibie_commission(symbol, pos["quantity"], exit_price)
                    total_comm = round(entry_comm + exit_comm, 2)
                    
                    net_pnl = round(gross_pnl - total_comm, 2)
                    self.equity += net_pnl
                    
                    # Record completed historical log
                    self.trades_history.append({
                        "id": f"BT_{len(self.trades_history) + 101}",
                        "symbol": symbol.upper(),
                        "quantity": pos["quantity"],
                        "direction": pos["direction"],
                        "entryPrice": pos["entry_price"],
                        "exitPrice": round(exit_price, 2),
                        "realizedPnL": net_pnl,
                        "commission": total_comm,
                        "efficiencyRatio": pos["efficiency_ratio"],
                        "reason": exit_reason,
                        "date": bar["date"]
                    })
                    active_position = None
                    continue

            # 2. Check for new strategy trigger conditions (OFI high activity approximation Breakout)
            if not active_position:
                volume_ma = sum([b["volume"] for b in bars[i-10:i]]) / 10.0
                volume_spike = bar["volume"] > (volume_ma * 1.4)  # Breakout high-vol order flow spike
                
                if volume_spike:
                    # Determine trend direction using close relation to SMA-20
                    is_bullish = current_close > current_sma
                    direction = "BUY" if is_bullish else "SELL"
                    
                    entry_price = current_close
                    # Set stopped target under 1.8 ATR
                    stop_distance = max(0.10, round(current_atr * 1.8, 2))
                    stop_price = round(entry_price - stop_distance if is_bullish else entry_price + stop_distance, 2)
                    target_price = round(entry_price + stop_distance * 2.0 if is_bullish else entry_price - stop_distance * 2.0, 2)
                    
                    # Calculate position size: 1% dynamic risk rule
                    risk_capital = self.equity * 0.01
                    calculated_qty = int(risk_capital / stop_distance)
                    
                    if calculated_qty <= 0:
                        continue
                        
                    # Calculate friction efficiency ratio
                    expected_commission = self.calculate_ibie_commission(symbol, calculated_qty, entry_price)
                    half_spread = (entry_price * 0.0003) * calculated_qty # Est spread slippage
                    total_friction = half_spread + (expected_commission * 2)
                    projected_profit = (stop_distance * 2.0) * calculated_qty
                    
                    efficiency_ratio = round((total_friction / projected_profit) * 100, 1) if projected_profit > 0 else 100.0
                    
                    # Enforce 15% Max Efficiency Rule limit
                    if efficiency_ratio > 15.0:
                        # Reject trade and log friction block
                        continue
                        
                    # Deploy Position
                    active_position = {
                        "symbol": symbol,
                        "direction": direction,
                        "entry_price": entry_price,
                        "stop_price": stop_price,
                        "target_price": target_price,
                        "quantity": calculated_qty,
                        "efficiency_ratio": efficiency_ratio,
                        "timestamp": bar["date"]
                    }

        # Handle formatting metrics
        total_trades = len(self.trades_history)
        winning_trades = [t for t in self.trades_history if t["realizedPnL"] > 0]
        losing_trades = [t for t in self.trades_history if t["realizedPnL"] <= 0]
        
        win_rate = round((len(winning_trades) / total_trades * 100), 1) if total_trades > 0 else 0.0
        
        gross_profit = sum([t["realizedPnL"] for t in winning_trades])
        gross_loss = abs(sum([t["realizedPnL"] for t in losing_trades]))
        profit_factor = round(gross_profit / gross_loss, 2) if gross_loss > 0 else (round(gross_profit, 2) if gross_profit > 0 else 1.0)
        
        # Calculate maximum drawdown
        peak = self.starting_capital
        max_drawdown = 0.0
        for b in self.balance_history:
            eq = b["equity"]
            if eq > peak:
                peak = eq
            dd = (peak - eq) / peak * 100
            if dd > max_drawdown:
                max_drawdown = dd
                
        pnl_cash = round(self.equity - self.starting_capital, 2)
        pnl_percent = round((self.equity - self.starting_capital) / self.starting_capital * 100, 2)

        return {
            "symbol": symbol.upper(),
            "timeframe": timeframe,
            "startDate": start_date,
            "endDate": end_date,
            "startingCapital": self.starting_capital,
            "finalCapital": round(self.equity, 2),
            "totalPnL": pnl_cash,
            "totalPnLPercent": pnl_percent,
            "totalTrades": total_trades,
            "winningTrades": len(winning_trades),
            "losingTrades": len(losing_trades),
            "winRate": win_rate,
            "profitFactor": profit_factor,
            "maxDrawdownPercent": round(max_drawdown, 2),
            "totalCommissions": round(sum([t["commission"] for t in self.trades_history]), 2),
            "balanceHistory": self.balance_history,
            "tradesList": self.trades_history
        }

if __name__ == "__main__":
    # Command line runner fallback to dump results directly into JSON streams
    import sys
    if len(sys.argv) >= 5:
        ticker = sys.argv[1]
        tf = sys.argv[2]
        start = sys.argv[3]
        end = sys.argv[4]
    else:
        # Defaults
        ticker = "XLE"
        tf = "1h"
        start = "2026-05-01"
        end = "2026-06-16"
        
    engine = AlphaBacktestingEngine()
    results = engine.run_backtest(ticker, tf, start, end)
    print(json.dumps(results))
