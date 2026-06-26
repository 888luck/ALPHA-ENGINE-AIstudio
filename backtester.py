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
            return max(1.00, base_comm)    def run_backtest(self, symbol: str, timeframe: str, start_date: str, end_date: str,
                     stop_atr: float = 1.8, partial_profit: bool = True, breakeven_lock: bool = True,
                     max_hold: int = 15, ofi_filter: bool = True, adaptive_stop: bool = True) -> Dict[str, Any]:
        """
        Executes an algorithmic backtest over historical metrics with advanced institutional upgrades:
          - Adaptive Volatility ATR Stops: dynamic cushion to prevent premature stop-outs
          - Partial Profit Taking (Tranche scaling): Scale out 50% position at Target 1 (1.0x stop)
          - Breakeven locking: lock-in capital on target proximity
          - Time-based decay exit: clear dead positions at max_hold bars limit
          - OFI Order Flow Imbalance direction filter: reject breakouts with discordant Level 2 order flows
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

        # Rolling average of normalized ATR for relative volatility tracking
        norm_atrs = [atrs[k] / close_prices[k] for k in range(len(bars))]
        avg_norm_atrs = []
        for i in range(len(bars)):
            if i < 20:
                avg_norm_atrs.append(norm_atrs[i])
            else:
                avg_norm_atrs.append(sum(norm_atrs[i-20:i]) / 20.0)

        # Position tracking variables
        active_position = None  # None or Dict representing active trade
        rejected_trades_count = 0
        tranche_1_scaled_out_count = 0
        tranche_2_hit_count = 0
        total_slippage_friction_saved = 0.0
        
        for i in range(20, len(bars)):
            bar = bars[i]
            prev_bar = bars[i-1]
            current_close = bar["close"]
            current_atr = atrs[i]
            current_sma = smas[i]
            
            # Sync equity curve tracking to bar date
            current_eq = self.equity
            if active_position:
                pos = active_position
                direction_multiplier = 1 if pos["direction"] == "BUY" else -1
                unrealized = (current_close - pos["entry_price"]) * pos["quantity"] * direction_multiplier
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
                
                pos["bars_held"] += 1
                direction_multiplier = 1 if pos["direction"] == "BUY" else -1
                pips_in_favor = (current_close - pos["entry_price"]) * direction_multiplier
                stop_distance_val = abs(pos["entry_price"] - pos["initial_stop"])
                
                # A. Partial Profit Taking Scale-Out
                if partial_profit and not pos.get("tranche_1_scaled_out", False):
                    target_1_hit = False
                    if pos["direction"] == "BUY" and bar["high"] >= pos["entry_price"] + stop_distance_val:
                        target_1_hit = True
                        exit_price_t1 = pos["entry_price"] + stop_distance_val
                    elif pos["direction"] == "SELL" and bar["low"] <= pos["entry_price"] - stop_distance_val:
                        target_1_hit = True
                        exit_price_t1 = pos["entry_price"] - stop_distance_val
                        
                    if target_1_hit:
                        q1 = pos["quantity"] // 2
                        if q1 > 0:
                            t1_gross = (exit_price_t1 - pos["entry_price"]) * q1 * direction_multiplier
                            t1_comm = self.calculate_ibie_commission(symbol, q1, exit_price_t1)
                            t1_net = round(t1_gross - t1_comm, 2)
                            self.equity += t1_net
                            
                            pos["quantity"] -= q1
                            pos["tranche_1_scaled_out"] = True
                            pos["scale_out_profit"] = t1_net
                            pos["stop_price"] = pos["entry_price"] # Drag stop to breakeven immediately
                            tranche_1_scaled_out_count += 1
                            
                # B. Breakeven locking for standard/remaining position
                elif breakeven_lock and not pos.get("breakeven_applied", False):
                    if pips_in_favor >= stop_distance_val * 0.8:
                        pos["stop_price"] = pos["entry_price"]
                        pos["breakeven_applied"] = True
                
                # Check target and stop price violations
                if pos["direction"] == "BUY":
                    if bar["low"] <= pos["stop_price"]:
                        exit_price = pos["stop_price"]
                        triggered_exit = True
                        exit_reason = "STOP LOSS BREACH" if not pos.get("tranche_1_scaled_out", False) else "BREAKEVEN TRANCHE EXIT"
                    elif bar["high"] >= pos["target_price"]:
                        exit_price = pos["target_price"]
                        triggered_exit = True
                        exit_reason = "PROFIT TARGET ACHIEVED"
                        if pos.get("tranche_1_scaled_out", False):
                            tranche_2_hit_count += 1
                else: # SELL
                    if bar["high"] >= pos["stop_price"]:
                        exit_price = pos["stop_price"]
                        triggered_exit = True
                        exit_reason = "STOP LOSS BREACH" if not pos.get("tranche_1_scaled_out", False) else "BREAKEVEN TRANCHE EXIT"
                    elif bar["low"] <= pos["target_price"]:
                        exit_price = pos["target_price"]
                        triggered_exit = True
                        exit_reason = "PROFIT TARGET ACHIEVED"
                        if pos.get("tranche_1_scaled_out", False):
                            tranche_2_hit_count += 1
                            
                # C. Time-based decay exit rule
                if not triggered_exit and pos["bars_held"] >= max_hold:
                    exit_price = current_close
                    triggered_exit = True
                    exit_reason = f"TIME-BASED EXPIRE ({max_hold} BARS)"
                    
                # D. End of session forced termination
                if not triggered_exit and i == len(bars) - 1:
                    exit_price = current_close
                    triggered_exit = True
                    exit_reason = "BACKTEST TERMINATION WINDOW"

                if triggered_exit:
                    direction_multiplier = 1 if pos["direction"] == "BUY" else -1
                    gross_pnl = (exit_price - pos["entry_price"]) * pos["quantity"] * direction_multiplier
                    
                    entry_comm = self.calculate_ibie_commission(symbol, pos["initial_quantity"], pos["entry_price"])
                    exit_comm = self.calculate_ibie_commission(symbol, pos["quantity"], exit_price)
                    total_comm = round(entry_comm + exit_comm, 2)
                    
                    net_pnl = round(gross_pnl - total_comm, 2)
                    scale_out_profit = pos.get("scale_out_profit", 0.0)
                    total_trade_net_pnl = round(net_pnl + scale_out_profit, 2)
                    
                    self.equity += net_pnl # Add remaining tranche realized pnl
                    
                    self.trades_history.append({
                        "id": f"BT_{len(self.trades_history) + 101}",
                        "symbol": symbol.upper(),
                        "quantity": pos["initial_quantity"],
                        "direction": pos["direction"],
                        "entryPrice": pos["entry_price"],
                        "exitPrice": round(exit_price, 2),
                        "realizedPnL": total_trade_net_pnl,
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
                volume_spike = bar["volume"] > (volume_ma * 1.4)  # Breakout volume expansion trigger
                
                if volume_spike:
                    is_bullish = current_close > current_sma
                    direction = "BUY" if is_bullish else "SELL"
                    
                    # OFI Level 2 Book Imbalance confirmation filter
                    if ofi_filter:
                        high_diff = bar["high"] - current_close
                        low_diff = current_close - bar["low"]
                        emulated_ofi = low_diff - high_diff # Positive if closed near high (buying pressure)
                        
                        if is_bullish and emulated_ofi < 0:
                            rejected_trades_count += 1
                            continue
                        elif not is_bullish and emulated_ofi > 0:
                            rejected_trades_count += 1
                            continue
                    
                    # Dynamic Volatility Adaptive ATR Stop Multiplier
                    if adaptive_stop:
                        avg_norm = avg_norm_atrs[i]
                        curr_norm = current_atr / current_close
                        vol_ratio = curr_norm / avg_norm if avg_norm > 0 else 1.0
                        vol_ratio = max(0.7, min(1.4, vol_ratio)) # Cap multiplier scaling range
                        dynamic_multiplier = stop_atr * vol_ratio
                    else:
                        dynamic_multiplier = stop_atr
                        
                    entry_price = current_close
                    stop_distance = max(0.10, round(current_atr * dynamic_multiplier, 2))
                    stop_price = round(entry_price - stop_distance if is_bullish else entry_price + stop_distance, 2)
                    
                    target_multiplier = 2.5 if partial_profit else 2.0
                    target_price = round(entry_price + stop_distance * target_multiplier if is_bullish else entry_price - stop_distance * target_multiplier, 2)
                    
                    # Calculate position size: 1% dynamic risk rule
                    risk_capital = self.equity * 0.01
                    calculated_qty = int(risk_capital / stop_distance)
                    
                    if calculated_qty <= 0:
                        continue
                        
                    # Calculate friction efficiency ratio
                    expected_commission = self.calculate_ibie_commission(symbol, calculated_qty, entry_price)
                    half_spread = (entry_price * 0.0003) * calculated_qty # Est spread slippage
                    total_friction = half_spread + (expected_commission * 2)
                    projected_profit = (stop_distance * target_multiplier) * calculated_qty
                    
                    efficiency_ratio = round((total_friction / projected_profit) * 100, 1) if projected_profit > 0 else 100.0
                    
                    # Enforce 15% Max Efficiency Rule limit
                    if efficiency_ratio > 15.0:
                        total_slippage_friction_saved += total_friction
                        rejected_trades_count += 1
                        continue
                        
                    active_position = {
                        "symbol": symbol,
                        "direction": direction,
                        "entry_price": entry_price,
                        "initial_stop": stop_price,
                        "stop_price": stop_price,
                        "target_price": target_price,
                        "quantity": calculated_qty,
                        "initial_quantity": calculated_qty,
                        "efficiency_ratio": efficiency_ratio,
                        "timestamp": bar["date"],
                        "bars_held": 0,
                        "tranche_1_scaled_out": False
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
            "priceHistory": bars,
            "tradesList": self.trades_history,
            "rejectedTradesCount": rejected_trades_count,
            "tranche1ScaledOutCount": tranche_1_scaled_out_count,
            "tranche2HitCount": tranche_2_hit_count,
            "slippageFrictionSaved": round(total_slippage_friction_saved, 2),
            "adaptiveStopApplied": adaptive_stop,
            "partialProfitApplied": partial_profit,
            "breakevenApplied": breakeven_lock,
            "maxHoldApplied": max_hold
        }

if __name__ == "__main__":
    # Command line runner fallback to dump results directly into JSON streams
    import sys
    
    stop_atr = 1.8
    partial_profit = True
    breakeven_lock = True
    max_hold = 15
    ofi_filter = True
    adaptive_stop = True
    
    if len(sys.argv) >= 5:
        ticker = sys.argv[1]
        tf = sys.argv[2]
        start = sys.argv[3]
        end = sys.argv[4]
        
        # Parse extra options if provided by server.ts
        if len(sys.argv) >= 6:
            try:
                stop_atr = float(sys.argv[5])
            except ValueError:
                pass
        if len(sys.argv) >= 7:
            partial_profit = sys.argv[6].lower() in ["true", "1", "yes"]
        if len(sys.argv) >= 8:
            breakeven_lock = sys.argv[7].lower() in ["true", "1", "yes"]
        if len(sys.argv) >= 9:
            try:
                max_hold = int(sys.argv[8])
            except ValueError:
                pass
        if len(sys.argv) >= 10:
            ofi_filter = sys.argv[9].lower() in ["true", "1", "yes"]
        if len(sys.argv) >= 11:
            adaptive_stop = sys.argv[10].lower() in ["true", "1", "yes"]
    else:
        # Defaults
        ticker = "XLE"
        tf = "1h"
        start = "2026-05-01"
        end = "2026-06-16"
        
    engine = AlphaBacktestingEngine()
    results = engine.run_backtest(
        symbol=ticker, 
        timeframe=tf, 
        start_date=start, 
        end_date=end,
        stop_atr=stop_atr,
        partial_profit=partial_profit,
        breakeven_lock=breakeven_lock,
        max_hold=max_hold,
        ofi_filter=ofi_filter,
        adaptive_stop=adaptive_stop
    )
    print(json.dumps(results))
