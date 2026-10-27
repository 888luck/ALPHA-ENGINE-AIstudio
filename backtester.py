import os
import sys
import json
import random
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional

# Standard mock-ready classes matching connection.py structure
try:
    from connection import ConnectionManager
except ImportError:
    pass

try:
    from institutional_auditor import InstitutionalBacktestAuditor
except ImportError:
    InstitutionalBacktestAuditor = None

try:
    from config_loader import get_edge_endpoint
except ImportError:
    def get_edge_endpoint():
        return os.environ.get("EDGE_NODE_HOST") or os.environ.get("EDGE_NODE_IP") or "127.0.0.1", int(os.environ.get("EDGE_TCP_PORT", "4005"))

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
            
    def run_backtest(self, symbol: str, timeframe: str, start_date: str, end_date: str,
                     stop_atr: float = 1.8, partial_profit: bool = True, breakeven_lock: bool = True,
                     max_hold: int = 15, ofi_filter: bool = True, adaptive_stop: bool = True,
                     capital_override: float = None, risk_budget_pct: float = 0.01,
                     friction_ceiling_pct: float = 15.0, binary_blackout_hours: float = 0.0,
                     trials_tested: int = 1, bars: List[Dict[str, Any]] = None,
                     trailing_stop_atr: Optional[float] = None,
                     trailing_activation_r: float = 1.5,
                     trailing_step_atr: float = 0.25,
                     trailing_type: str = "CHANDELIER",
                     catalyst_polarity: Optional[float] = None) -> Dict[str, Any]:
        """
        Executes an algorithmic backtest over historical metrics with advanced institutional upgrades:
          - Adaptive Volatility ATR Stops: dynamic cushion to prevent premature stop-outs
          - Partial Profit Taking (Tranche scaling): Scale out 50% position at Target 1 (1.0x stop)
          - Breakeven locking: lock-in capital on target proximity
          - Dynamic Trailing Profit: Chandelier / ATR / Fixed R / Parabolic trailing stops
          - Time-based decay exit: clear dead positions at max_hold bars limit
          - OFI Order Flow Imbalance direction filter: reject breakouts with discordant Level 2 order flows
          - Sanitized DRM Overrides: custom capital, risk budget r, friction ceiling, blackout window
        """
        if bars is None:
            bars = self.generate_synthetic_history(symbol, timeframe, start_date, end_date)
        if len(bars) < 25:
            raise ValueError(f"Insufficient historical bars ({len(bars)} < 25 required) for {symbol} between {start_date} and {end_date}. Cannot compute 20-period indicators.")

        if capital_override is not None and capital_override > 0:
            self.starting_capital = float(capital_override)

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
        gate1_capital_clamped_count = 0
        gate2_friction_count = 0
        gate5_blackout_count = 0
        total_setups_evaluated = 0
        tranche_1_scaled_out_count = 0
        tranche_2_hit_count = 0
        trailing_stop_hits_count = 0
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
                pos["highest_high"] = max(pos.get("highest_high", bar["high"]), bar["high"])
                pos["lowest_low"] = min(pos.get("lowest_low", bar["low"]), bar["low"])

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
                            pos["breakeven_applied"] = True
                            tranche_1_scaled_out_count += 1
                            
                # B. Breakeven locking for standard/remaining position
                elif breakeven_lock and not pos.get("breakeven_applied", False):
                    if pips_in_favor >= stop_distance_val * 0.8:
                        pos["stop_price"] = pos["entry_price"]
                        pos["breakeven_applied"] = True

                # C. Dynamic Trailing Profit Ratchet
                has_trailing = trailing_stop_atr is not None and float(trailing_stop_atr) > 0
                if has_trailing:
                    activation_hurdle = float(trailing_activation_r) * stop_distance_val
                    if pips_in_favor >= activation_hurdle:
                        pos["trailing_active"] = True

                    if pos.get("trailing_active", False):
                        t_type = (trailing_type or "CHANDELIER").upper().strip()
                        k_trail = float(trailing_stop_atr)
                        pol = pos.get("catalyst_polarity")
                        if pol is not None:
                            if pol >= 0.60:
                                k_trail = k_trail * 1.25  # expand trailing cushion for confirmed catalyst
                            elif pol <= -0.60:
                                k_trail = k_trail * 0.75  # tighten trailing cushion to lock profits quickly
                        step_damper = max(0.01, float(trailing_step_atr) * current_atr)

                        if t_type == "PARABOLIC":
                            decay_ratio = min(1.0, pos["bars_held"] / max(1, max_hold))
                            k_eff = max(0.5, k_trail * (1.0 - (0.5 * decay_ratio)))
                        else:
                            k_eff = k_trail

                        if pos["direction"] == "BUY":
                            if t_type in ["CHANDELIER", "PARABOLIC"]:
                                cand_stop = round(pos["highest_high"] - (k_eff * current_atr), 2)
                            elif t_type == "ATR":
                                cand_stop = round(current_close - (k_eff * current_atr), 2)
                            elif t_type == "FIXED_R":
                                r_steps = int(pips_in_favor / max(0.01, stop_distance_val))
                                cand_stop = round(pos["entry_price"] + ((r_steps - 1) * stop_distance_val * (k_eff / 2.0)), 2)
                            else:
                                cand_stop = round(pos["highest_high"] - (k_eff * current_atr), 2)

                            if cand_stop >= (pos["stop_price"] + step_damper):
                                pos["stop_price"] = cand_stop
                                pos["is_trailing_stop"] = True

                        else: # SELL
                            if t_type in ["CHANDELIER", "PARABOLIC"]:
                                cand_stop = round(pos["lowest_low"] + (k_eff * current_atr), 2)
                            elif t_type == "ATR":
                                cand_stop = round(current_close + (k_eff * current_atr), 2)
                            elif t_type == "FIXED_R":
                                r_steps = int(pips_in_favor / max(0.01, stop_distance_val))
                                cand_stop = round(pos["entry_price"] - ((r_steps - 1) * stop_distance_val * (k_eff / 2.0)), 2)
                            else:
                                cand_stop = round(pos["lowest_low"] + (k_eff * current_atr), 2)

                            if cand_stop <= (pos["stop_price"] - step_damper):
                                pos["stop_price"] = cand_stop
                                pos["is_trailing_stop"] = True
                
                # Check target and stop price violations
                if pos["direction"] == "BUY":
                    if bar["low"] <= pos["stop_price"]:
                        exit_price = pos["stop_price"]
                        triggered_exit = True
                        if pos.get("is_trailing_stop", False):
                            exit_reason = "TRAILING STOP LOSS HIT"
                            trailing_stop_hits_count += 1
                        elif not pos.get("tranche_1_scaled_out", False) and not pos.get("breakeven_applied", False):
                            exit_reason = "STOP LOSS BREACH"
                        else:
                            exit_reason = "BREAKEVEN TRANCHE EXIT"
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
                        if pos.get("is_trailing_stop", False):
                            exit_reason = "TRAILING STOP LOSS HIT"
                            trailing_stop_hits_count += 1
                        elif not pos.get("tranche_1_scaled_out", False) and not pos.get("breakeven_applied", False):
                            exit_reason = "STOP LOSS BREACH"
                        else:
                            exit_reason = "BREAKEVEN TRANCHE EXIT"
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
                    total_setups_evaluated += 1

                    # Gate 5: Binary Macro Event Blackout
                    if binary_blackout_hours > 0 and (i % 35 == 0):
                        gate5_blackout_count += 1
                        rejected_trades_count += 1
                        continue

                    is_bullish = current_close > current_sma
                    direction = "BUY" if is_bullish else "SELL"

                    # Gate 5 NLP Dual Veto: Reject Long on strongly negative catalyst, Short on positive
                    if catalyst_polarity is not None:
                        if is_bullish and catalyst_polarity <= -0.60:
                            gate5_blackout_count += 1
                            rejected_trades_count += 1
                            continue
                        elif not is_bullish and catalyst_polarity >= 0.60:
                            gate5_blackout_count += 1
                            rejected_trades_count += 1
                            continue
                    
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
                    
                    # Calculate position size: dynamic risk budget r rule (e.g. 1% or custom r)
                    risk_capital = self.equity * risk_budget_pct
                    calculated_qty = int(risk_capital / stop_distance)
                    
                    if calculated_qty <= 0:
                        gate1_capital_clamped_count += 1
                        continue
                        
                    # Calculate friction efficiency ratio
                    expected_commission = self.calculate_ibie_commission(symbol, calculated_qty, entry_price)
                    half_spread = (entry_price * 0.0003) * calculated_qty # Est spread slippage
                    total_friction = half_spread + (expected_commission * 2)
                    projected_profit = (stop_distance * target_multiplier) * calculated_qty
                    
                    efficiency_ratio = round((total_friction / projected_profit) * 100, 1) if projected_profit > 0 else 100.0
                    
                    # Enforce Friction Efficiency Rule limit (default 15% or custom hurdle)
                    if efficiency_ratio > friction_ceiling_pct:
                        total_slippage_friction_saved += total_friction
                        rejected_trades_count += 1
                        gate2_friction_count += 1
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
                        "tranche_1_scaled_out": False,
                        "highest_high": bar["high"],
                        "lowest_low": bar["low"],
                        "trailing_active": False,
                        "is_trailing_stop": False,
                        "catalyst_polarity": catalyst_polarity
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

        # Compute Marcos López de Prado Deflated Sharpe Ratio (DSR) & Institutional Audit
        annualized_sharpe = 0.0
        daily_sharpe = 0.0
        deflated_sharpe = 0.0
        skewness_val = 0.0
        kurtosis_val = 3.0
        passes_dsr = False
        verdict = "INSUFFICIENT_DATA"
        institutional_audit_data = None

        if InstitutionalBacktestAuditor is not None:
            try:
                institutional_audit_data = InstitutionalBacktestAuditor.audit_backtest(
                    trades=self.trades_history,
                    balance_history=self.balance_history,
                    starting_capital=self.starting_capital,
                    trials_tested=max(1, trials_tested),
                    benchmark_sharpe=0.0
                )
                if institutional_audit_data.get("valid"):
                    annualized_sharpe = institutional_audit_data.get("annualized_sharpe", 0.0)
                    daily_sharpe = institutional_audit_data.get("daily_sharpe", 0.0)
                    deflated_sharpe = institutional_audit_data.get("deflated_sharpe_ratio", 0.0)
                    skewness_val = institutional_audit_data.get("skewness", 0.0)
                    kurtosis_val = institutional_audit_data.get("kurtosis", 3.0)
                    passes_dsr = institutional_audit_data.get("passes_dsr_hurdle", False)
                    verdict = institutional_audit_data.get("institutional_verdict", "AUDITED")
                else:
                    verdict = institutional_audit_data.get("institutional_verdict", "INSUFFICIENT_SAMPLE")
            except Exception as e:
                verdict = f"AUDIT_ERROR: {str(e)}"

        return {
            "symbol": symbol.upper(),
            "timeframe": timeframe,
            "startDate": start_date,
            "endDate": end_date,
            "startingCapital": self.starting_capital,
            "finalCapital": round(self.equity, 2),
            "totalPnL": pnl_cash,
            "netProfit": pnl_cash,
            "totalPnLPercent": pnl_percent,
            "totalTrades": total_trades,
            "winningTrades": len(winning_trades),
            "losingTrades": len(losing_trades),
            "winRate": win_rate,
            "profitFactor": profit_factor,
            "sharpeRatio": annualized_sharpe,
            "annualizedSharpe": annualized_sharpe,
            "dailySharpe": daily_sharpe,
            "deflatedSharpeRatio": deflated_sharpe,
            "skewness": skewness_val,
            "kurtosis": kurtosis_val,
            "passesDsrHurdle": passes_dsr,
            "institutionalVerdict": verdict,
            "trialsTested": trials_tested,
            "institutionalAudit": institutional_audit_data,
            "maxDrawdownPercent": round(max_drawdown, 2),
            "maxDrawdown": round(max_drawdown, 2),
            "totalCommissions": round(sum([t["commission"] for t in self.trades_history]), 2),
            "balanceHistory": self.balance_history,
            "priceHistory": bars,
            "tradesList": self.trades_history,
            "rejectedTradesCount": rejected_trades_count,
            "tranche1ScaledOutCount": tranche_1_scaled_out_count,
            "tranche2HitCount": tranche_2_hit_count,
            "trailingStopHitsCount": trailing_stop_hits_count,
            "slippageFrictionSaved": round(total_slippage_friction_saved, 2),
            "adaptiveStopApplied": adaptive_stop,
            "partialProfitApplied": partial_profit,
            "breakevenApplied": breakeven_lock,
            "trailingStopApplied": trailing_stop_atr is not None and float(trailing_stop_atr) > 0,
            "trailingStopAtr": float(trailing_stop_atr) if trailing_stop_atr and float(trailing_stop_atr) > 0 else None,
            "trailingActivationR": float(trailing_activation_r) if trailing_stop_atr and float(trailing_stop_atr) > 0 else None,
            "trailingStepAtr": float(trailing_step_atr) if trailing_stop_atr and float(trailing_step_atr) > 0 else None,
            "trailingType": trailing_type if trailing_stop_atr and float(trailing_stop_atr) > 0 else None,
            "maxHoldApplied": max_hold,
            "catalystPolarity": catalyst_polarity,
            "gateAttribution": {
                "gate1CapitalClamped": gate1_capital_clamped_count,
                "gate2FrictionRejected": gate2_friction_count,
                "gate3VolumeCapRejected": 0,
                "gate5BlackoutRejected": gate5_blackout_count,
                "totalSetupsEvaluated": total_setups_evaluated,
                "totalTradesTaken": total_trades
            }
        }

    def run_parameter_sweep(
        self,
        symbol: str,
        timeframe: str = "1h",
        start_date: str = "2026-05-01",
        end_date: str = "2026-06-16",
        capital_override: float = 100000.0,
        trials_count: int = 16
    ) -> Dict[str, Any]:
        """
        Executes a multi-dimensional systematic parameter exploration sweep
        testing combinations of ATR stops, hold bars, tranche scaling, breakeven ratchet,
        and OFI gates against verified historical bars.
        Marcos López de Prado's DSR strictly penalizes selection bias with N = total_trials.
        """
        # Master candidate permutations covering the quantitative search space
        master_candidates = [
            {"stop_atr": 1.2, "max_hold": 8, "partial_profit": True, "breakeven_lock": True, "ofi_filter": True, "adaptive_stop": True, "label": "Ultra-Tight Scalp (1.2x ATR / 8b hold)"},
            {"stop_atr": 1.2, "max_hold": 10, "partial_profit": False, "breakeven_lock": False, "ofi_filter": True, "adaptive_stop": True, "label": "Direct Scalp (1.2x ATR / No Breakeven)"},
            {"stop_atr": 1.4, "max_hold": 10, "partial_profit": True, "breakeven_lock": True, "ofi_filter": True, "adaptive_stop": True, "label": "Precision OFI Scalp (1.4x ATR / 10b hold)"},
            {"stop_atr": 1.5, "max_hold": 12, "partial_profit": True, "breakeven_lock": True, "ofi_filter": True, "adaptive_stop": True, "label": "Conservative Intraday (1.5x ATR / 12b hold)"},
            {"stop_atr": 1.5, "max_hold": 14, "partial_profit": False, "breakeven_lock": True, "ofi_filter": False, "adaptive_stop": True, "label": "Unfiltered Quick Swing (1.5x ATR / 14b hold)"},
            {"stop_atr": 1.6, "max_hold": 8, "partial_profit": True, "breakeven_lock": True, "ofi_filter": True, "adaptive_stop": True, "label": "Fast Time-Decay (1.6x ATR / 8b hold)"},
            {"stop_atr": 1.8, "max_hold": 15, "partial_profit": True, "breakeven_lock": True, "ofi_filter": True, "adaptive_stop": True, "label": "Institutional Balanced (1.8x ATR / 15b hold)"},
            {"stop_atr": 1.8, "max_hold": 16, "partial_profit": False, "breakeven_lock": False, "ofi_filter": False, "adaptive_stop": False, "label": "Unfiltered Baseline (1.8x ATR / 16b hold)"},
            {"stop_atr": 2.0, "max_hold": 16, "partial_profit": False, "breakeven_lock": True, "ofi_filter": True, "adaptive_stop": True, "label": "Intermediate Swing (2.0x ATR / Breakeven on)"},
            {"stop_atr": 2.0, "max_hold": 18, "partial_profit": True, "breakeven_lock": False, "ofi_filter": True, "adaptive_stop": True, "label": "Deep Swing (2.0x ATR / No Breakeven Ratchet)"},
            {"stop_atr": 2.2, "max_hold": 20, "partial_profit": True, "breakeven_lock": True, "ofi_filter": True, "adaptive_stop": True, "label": "Wide Momentum Runner (2.2x ATR / 20b hold)"},
            {"stop_atr": 2.2, "max_hold": 24, "partial_profit": False, "breakeven_lock": False, "ofi_filter": True, "adaptive_stop": True, "label": "Deep Trend Capture (2.2x ATR / 24b hold)"},
            {"stop_atr": 2.4, "max_hold": 26, "partial_profit": True, "breakeven_lock": False, "ofi_filter": True, "adaptive_stop": True, "label": "Extended Swing Runner (2.4x ATR / 26b hold)"},
            {"stop_atr": 2.6, "max_hold": 22, "partial_profit": False, "breakeven_lock": True, "ofi_filter": False, "adaptive_stop": True, "label": "Wide Volatility Drift (2.6x ATR / 22b hold)"},
            {"stop_atr": 2.6, "max_hold": 28, "partial_profit": True, "breakeven_lock": True, "ofi_filter": True, "adaptive_stop": True, "label": "Maximum Horizon Drift (2.6x ATR / 28b hold)"},
            {"stop_atr": 1.3, "max_hold": 9, "partial_profit": True, "breakeven_lock": False, "ofi_filter": True, "adaptive_stop": True, "label": "Tight Tranche Scaler (1.3x ATR / 9b hold)"}
        ]
        
        target_trials = min(len(master_candidates), max(4, trials_count))
        selected_candidates = master_candidates[:target_trials]
        
        # Load verified historical bars ONCE for all candidate permutations
        bars = self.generate_synthetic_history(symbol, timeframe, start_date, end_date)
        
        evaluated_candidates = []
        for idx, cand in enumerate(selected_candidates):
            c_engine = AlphaBacktestingEngine(starting_capital=capital_override if capital_override and capital_override > 0 else 100000.0)
            res = c_engine.run_backtest(
                symbol=symbol,
                timeframe=timeframe,
                start_date=start_date,
                end_date=end_date,
                stop_atr=cand["stop_atr"],
                partial_profit=cand["partial_profit"],
                breakeven_lock=cand["breakeven_lock"],
                max_hold=cand["max_hold"],
                ofi_filter=cand["ofi_filter"],
                adaptive_stop=cand["adaptive_stop"],
                capital_override=capital_override,
                trials_tested=target_trials,
                bars=bars
            )
            
            pnl = float(res.get("totalPnL", 0.0))
            dsr = float(res.get("deflatedSharpeRatio", 0.0))
            sharpe = float(res.get("annualizedSharpe", 0.0))
            dd = float(res.get("maxDrawdownPercent", 0.0))
            win_rate = float(res.get("winRate", 0.0))
            
            # Institutional composite ranking score (penalizes drawdown and negative PnL, rewards DSR and Sharpe)
            composite_score = round((dsr * 12.0) + (sharpe * 2.5) - (dd * 0.4) + (3.0 if pnl > 0 else -10.0), 3)
            
            evaluated_candidates.append({
                "candidate_id": f"CAND_{idx+1:02d}",
                "label": cand["label"],
                "score": composite_score,
                "parameters": {
                    "stopAtrMultiplier": cand["stop_atr"],
                    "stop_atr": cand["stop_atr"],
                    "maxHoldBars": cand["max_hold"],
                    "max_hold": cand["max_hold"],
                    "partialProfit": cand["partial_profit"],
                    "partial_profit": cand["partial_profit"],
                    "breakevenLock": cand["breakeven_lock"],
                    "breakeven_lock": cand["breakeven_lock"],
                    "ofiFilter": cand["ofi_filter"],
                    "ofi_filter": cand["ofi_filter"],
                    "adaptiveStop": cand["adaptive_stop"],
                    "adaptive_stop": cand["adaptive_stop"],
                    "capitalOverride": capital_override
                },
                "metrics": {
                    "totalPnL": pnl,
                    "totalPnLPercent": float(res.get("totalPnLPercent", 0.0)),
                    "winRate": win_rate,
                    "profitFactor": float(res.get("profitFactor", 1.0)),
                    "annualizedSharpe": sharpe,
                    "deflatedSharpeRatio": dsr,
                    "passesDsrHurdle": bool(res.get("passesDsrHurdle", False)),
                    "maxDrawdownPercent": dd,
                    "totalTrades": int(res.get("totalTrades", 0)),
                    "totalCommissions": float(res.get("totalCommissions", 0.0))
                },
                "totalPnL": pnl,
                "totalPnLPercent": float(res.get("totalPnLPercent", 0.0)),
                "winRate": win_rate,
                "profitFactor": float(res.get("profitFactor", 1.0)),
                "annualizedSharpe": sharpe,
                "deflatedSharpeRatio": dsr,
                "passesDsrHurdle": bool(res.get("passesDsrHurdle", False)),
                "maxDrawdownPercent": dd,
                "totalTrades": int(res.get("totalTrades", 0)),
                "totalCommissions": float(res.get("totalCommissions", 0.0)),
                "balanceHistory": res.get("balanceHistory", [])[::max(1, len(res.get("balanceHistory", [])) // 80)] if len(res.get("balanceHistory", [])) > 100 else res.get("balanceHistory", []),
                "tradesList": res.get("tradesList", [])
            })
            
        # Sort descending by composite score
        evaluated_candidates.sort(key=lambda x: x["score"], reverse=True)
        
        # Mark ranks and optimal candidate
        for rank, c in enumerate(evaluated_candidates):
            c["rank"] = rank + 1
            c["is_optimal"] = (rank == 0)
            
        optimal_config = evaluated_candidates[0] if evaluated_candidates else None
        
        # Filter Pareto frontier: non-dominated on (DSR, Sharpe, MaxDrawdown)
        frontier = []
        for c in evaluated_candidates:
            dominated = False
            for o in evaluated_candidates:
                if (o["metrics"]["deflatedSharpeRatio"] >= c["metrics"]["deflatedSharpeRatio"] and
                    o["metrics"]["annualizedSharpe"] >= c["metrics"]["annualizedSharpe"] and
                    o["metrics"]["maxDrawdownPercent"] <= c["metrics"]["maxDrawdownPercent"] and
                    (o["metrics"]["deflatedSharpeRatio"] > c["metrics"]["deflatedSharpeRatio"] or
                     o["metrics"]["annualizedSharpe"] > c["metrics"]["annualizedSharpe"] or
                     o["metrics"]["maxDrawdownPercent"] < c["metrics"]["maxDrawdownPercent"])):
                    dominated = True
                    break
            if not dominated:
                frontier.append(c)
                
        return {
            "status": "SUCCESS",
            "symbol": symbol.upper(),
            "timeframe": timeframe,
            "starting_capital": capital_override,
            "total_trials_tested": target_trials,
            "trials_tested": target_trials,
            "optimal_candidate": optimal_config,
            "best_candidate": optimal_config,
            "candidates": evaluated_candidates,
            "frontier_count": len(frontier),
            "frontier": frontier,
            "pareto_frontier": frontier
        }

    def generate_synthetic_history(self, symbol: str, timeframe: str, start_date_str: str, end_date_str: str) -> List[Dict[str, Any]]:
        '''
        Fetches REAL historical OHLCV data from the Interactive Brokers Pro Tape via Direct TCP Bridge (port 4005)
        or verified local historical cache.
        Institutional Invariant: Zero synthetic generation, zero retail consumer scraping.
        '''
        import socket, json
        
        start_date = datetime.fromisoformat(start_date_str.replace("Z", "+00:00"))
        end_date = datetime.fromisoformat(end_date_str.replace("Z", "+00:00"))
        days_diff = max(1, (end_date - start_date).days)

        # Map timeframe to IBKR barSizeSetting
        tf_lower = timeframe.lower()
        if "1m" in tf_lower:
            barsize = "1 min"
        elif "5m" in tf_lower:
            barsize = "5 mins"
        elif "15m" in tf_lower:
            barsize = "15 mins"
        elif "1h" in tf_lower:
            barsize = "1 hour"
        else:
            barsize = "1 day"

        # Ensure sufficient history for daily bars (minimum 180-250 bars required for 20-period SMA + multi-bar holding periods)
        if barsize == "1 day" and days_diff < 180:
            duration_str = "1 Y"
        elif barsize in ["5 mins", "15 mins"]:
            # IBKR max single-request lookback for 5m/15m is 1 M / 30 D
            duration_str = f"{min(days_diff, 30)} D"
        elif days_diff > 365:
            duration_str = f"{max(1, days_diff // 365)} Y"
        else:
            duration_str = f"{days_diff} D"
        
        bars = []
        
        # 1. Attempt query via Edge TCP Bridge to IBKR Pro Gateway
        edge_host, edge_port = get_edge_endpoint()
        auth_token = os.environ.get("EDGE_AUTH_TOKEN", "ALPHA_EDGE_SECRET_2026")
        adaptive_timeout = max(25.0, min(65.0, float(days_diff) * 0.15))
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(adaptive_timeout)
            sock.connect((edge_host, edge_port))
            cmd = {
                "action": "DISPATCH_IBKR",
                "method": "reqHistoricalData",
                "token": auth_token,
                "arguments": {
                    "contract": symbol,
                    "symbol": symbol,
                    "durationStr": duration_str,
                    "barSizeSetting": barsize,
                    "whatToShow": "TRADES",
                    "useRTH": 1,
                    "timeout": adaptive_timeout - 2.0
                }
            }
            sock.sendall((json.dumps(cmd) + "\n").encode("utf-8"))
            raw = b""
            while not raw.endswith(b"\n"):
                chunk = sock.recv(4096)
                if not chunk:
                    break
                raw += chunk
            sock.close()
            
            if raw:
                resp = json.loads(raw.decode("utf-8"))
                bars = resp.get("bars") or (resp.get("result", {}).get("bars") if isinstance(resp.get("result"), dict) else None)
                if bars and len(bars) > 0:
                    print(f"[BACKTESTER] Successfully retrieved {len(bars)} verified historical bars for {symbol} from IBKR Pro Tape via {edge_host}:{edge_port}.", file=sys.stderr)
                    try:
                        cache_save_path = os.path.join(os.path.dirname(__file__), f"historical_bars_{symbol.upper()}_{timeframe.lower()}.json")
                        with open(cache_save_path, "w", encoding="utf-8") as cf:
                            json.dump(bars, cf, indent=2)
                    except Exception:
                        pass
                    return bars
        except Exception as e:
            print(f"[BACKTESTER] TCP Bridge to IBKR Pro currently unreachable at {edge_host}:{edge_port} ({e}). Checking local verified cache...", file=sys.stderr)

        # 2. Check local verified historical cache if TCP bridge offline
        cache_filename = f"historical_bars_{symbol.upper()}_{timeframe.lower()}.json"
        cache_paths = [
            os.path.join(os.path.dirname(__file__), cache_filename),
            os.path.join(os.path.dirname(__file__), f"historical_bars_{symbol.upper()}.json"),
            os.path.join(os.path.dirname(__file__), "data", cache_filename)
        ]
        for cp in cache_paths:
            if os.path.exists(cp):
                try:
                    with open(cp, "r", encoding="utf-8") as f:
                        cached_data = json.load(f)
                    if isinstance(cached_data, list) and len(cached_data) > 0:
                        print(f"[BACKTESTER] Loaded {len(cached_data)} historical bars from verified local cache {cp}", file=sys.stderr)
                        return cached_data
                except Exception:
                    pass

        # 3. Institutional Policy: Never fabricate random walks or scrape retail portals
        raise RuntimeError(
            f"Zero Synthetic Policy Violation: Live Interactive Brokers Pro Gateway at {edge_host}:{edge_port} is offline and "
            f"no verified local market cache exists for {symbol} ({start_date_str} to {end_date_str}). "
            f"Random-walk fabrication and retail web scraping are strictly prohibited. "
            f"Connect IB Gateway or provide authentic broker historical bars."
        )

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
        if len(sys.argv) >= 12:
            try:
                capital_override = float(sys.argv[11])
            except (ValueError, TypeError):
                capital_override = None
        else:
            capital_override = None
        if len(sys.argv) >= 13:
            try:
                risk_budget_pct = float(sys.argv[12])
            except (ValueError, TypeError):
                risk_budget_pct = 0.01
        else:
            risk_budget_pct = 0.01
        if len(sys.argv) >= 14:
            try:
                friction_ceiling_pct = float(sys.argv[13])
            except (ValueError, TypeError):
                friction_ceiling_pct = 15.0
        else:
            friction_ceiling_pct = 15.0
        if len(sys.argv) >= 15:
            try:
                binary_blackout_hours = float(sys.argv[14])
            except (ValueError, TypeError):
                binary_blackout_hours = 0.0
        else:
            binary_blackout_hours = 0.0
        if len(sys.argv) >= 16:
            try:
                trials_tested = int(sys.argv[15])
            except (ValueError, TypeError):
                trials_tested = 1
        else:
            trials_tested = 1
        if len(sys.argv) >= 17:
            try:
                raw_trail = sys.argv[16].lower().strip()
                trailing_stop_atr = float(raw_trail) if raw_trail not in ["none", "null", "false", "0", "0.0"] else None
            except (ValueError, TypeError):
                trailing_stop_atr = None
        else:
            trailing_stop_atr = None
        if len(sys.argv) >= 18:
            try:
                trailing_activation_r = float(sys.argv[17])
            except (ValueError, TypeError):
                trailing_activation_r = 1.5
        else:
            trailing_activation_r = 1.5
        if len(sys.argv) >= 19:
            try:
                trailing_step_atr = float(sys.argv[18])
            except (ValueError, TypeError):
                trailing_step_atr = 0.25
        else:
            trailing_step_atr = 0.25
        if len(sys.argv) >= 20:
            trailing_type = sys.argv[19].upper().strip()
        else:
            trailing_type = "CHANDELIER"
    else:
        # Defaults
        ticker = "XLE"
        tf = "1h"
        start = "2026-05-01"
        end = "2026-06-16"
        capital_override = None
        risk_budget_pct = 0.01
        friction_ceiling_pct = 15.0
        binary_blackout_hours = 0.0
        trials_tested = 1
        trailing_stop_atr = None
        trailing_activation_r = 1.5
        trailing_step_atr = 0.25
        trailing_type = "CHANDELIER"
        
    engine = AlphaBacktestingEngine(starting_capital=capital_override if capital_override and capital_override > 0 else 100000.0)
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
        adaptive_stop=adaptive_stop,
        capital_override=capital_override,
        risk_budget_pct=risk_budget_pct,
        friction_ceiling_pct=friction_ceiling_pct,
        binary_blackout_hours=binary_blackout_hours,
        trials_tested=trials_tested,
        trailing_stop_atr=trailing_stop_atr,
        trailing_activation_r=trailing_activation_r,
        trailing_step_atr=trailing_step_atr,
        trailing_type=trailing_type
    )
    print(json.dumps(results))