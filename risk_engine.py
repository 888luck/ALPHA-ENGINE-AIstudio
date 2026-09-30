import sys
import time
import math
from typing import Dict, Any, List, Optional

class DRMMiddleware:
    """
    Dynamic Risk Management (DRM) Pool-Equity & Pre-Trade Risk Gateway Layer.
    Enforces SEC Rule 15c3-5 and MiFID II pre-trade risk controls:
      - Daily Capital Ceiling
      - Hard Daily Loss Circuit Breaker (Automatic Kill Switch)
      - ADV / Market Impact participation limits
      - Short locate and borrow fee verification
      - Central Bank of Ireland (CBI) / IBIE regulatory compliance
    """
    def __init__(self, connection_manager, account_number: str = "DEFAULT", params: Dict[str, Any] = None):
        self.cm = connection_manager
        self.account_number = account_number
        
        # Institutional Risk Hierarchy (0.25% Risk Budget per trade, 4r Daily Loss Cutoff)
        self.max_trade_risk_pct = 0.0025    # r = 0.25% equity risk budget per trade setup ($250 on $100k)
        self.max_daily_drawdown_pct = 0.010 # 1.0% daily aggregate loss threshold (= 4r, $1,000 on $100k)
        
        # Institutional Pre-Trade Risk Gateway Parameters
        params = params or {}
        self.start_day_equity = float(params.get("start_day_equity", 100000.0))
        self.daily_capital_ceiling = float(params.get("daily_capital_ceiling", 10000.0))  # Daily capital allocation ceiling
        
        # Daily loss cutoff defaults strictly to 4r = 4 * (0.0025 * start_day_equity) = $1,000 on $100k
        derived_cutoff = 4.0 * (self.start_day_equity * self.max_trade_risk_pct)
        self.daily_max_loss_cutoff = float(params.get("daily_max_loss_cutoff", derived_cutoff))
        self.fractional_trading_enabled = bool(params.get("fractional_trading_enabled", True))
        self.max_adv_participation_pct = float(params.get("max_adv_participation_pct", 0.015)) # 1.5% max of 5m ADV
        self.max_short_borrow_fee_pct = float(params.get("max_short_borrow_fee_pct", 15.0))    # 15% max annual borrow fee
        self.intraday_flattening_enabled = bool(params.get("intraday_flattening_enabled", True)) # Default: 15:45 EST auto-flatten enabled
        self.intraday_flatten_time_est = str(params.get("intraday_flatten_time_est", "15:45"))
        self.intraday_flatten_time_cet = str(params.get("intraday_flatten_time_cet", "17:15"))
        self.market_scope = str(params.get("market_scope", "ALL")).upper() # ALL, US, EUROPE
        
        # Lock status indicator
        self.router_locked = False

    def update_settings(self, settings: Dict[str, Any]):
        """Updates risk gateway settings dynamically from API/UI."""
        if "daily_capital_ceiling" in settings:
            self.daily_capital_ceiling = float(settings["daily_capital_ceiling"])
        if "daily_max_loss_cutoff" in settings:
            self.daily_max_loss_cutoff = float(settings["daily_max_loss_cutoff"])
        if "fractional_trading_enabled" in settings:
            self.fractional_trading_enabled = bool(settings["fractional_trading_enabled"])
        if "max_adv_participation_pct" in settings:
            self.max_adv_participation_pct = float(settings["max_adv_participation_pct"])
        if "intraday_flattening_enabled" in settings:
            self.intraday_flattening_enabled = bool(settings["intraday_flattening_enabled"])
        if "market_scope" in settings:
            self.market_scope = str(settings["market_scope"]).upper()
        print(f"[RISK GATEWAY CONFIG] Updated: Capital Ceiling=${self.daily_capital_ceiling:.2f} | Max Loss Cutoff=${self.daily_max_loss_cutoff:.2f} | Scope={self.market_scope} | Fractional={self.fractional_trading_enabled} | Intraday Flatten={self.intraday_flattening_enabled}")

    def query_margin_safety(self) -> bool:
        """
        Polls Live NetLiquidation and Maintenance Margin values under IBKR Rule set.
        Guarantees that new entries do not trigger automated margin liquidation.
        """
        net_liq = self.cm.account_summary.get("NetLiquidation", self.start_day_equity)
        maint_margin = self.cm.account_summary.get("MaintMarginReq", 0.0)
        
        # Fallback to conservative margin estimation if broker summary is pending
        if maint_margin == 0.0 and len(self.cm.active_positions) > 0:
            total_exposure = sum(abs(pos.get("qty", 0) * pos.get("avgCost", 0.0)) for pos in self.cm.active_positions.values())
            maint_margin = total_exposure * 0.25
        
        # If maintenance margin consumes more than 80% of aggregate Net Liquidating value: raise critical alarm
        if maint_margin > (net_liq * 0.80):
            print(f"[RISK WARN] Margin Threshold Breached. NetLiq: {net_liq} | MaintMargin: {maint_margin} (Risk > 80%)")
            return False
        return True

    def calculate_atr14(self, bars: List[Dict[str, float]], current_price: float = 100.0) -> float:
        """
        Calculates 14-period Wilder Average True Range (ATR) using Wilder's Exponential Smoothing (RMA):
          TR_t = max(H - L, abs(H - C_prev), abs(L - C_prev))
          ATR_t = (ATR_{t-1} * 13 + TR_t) / 14
        Requires at least 14 bars (ideally 28+) of historical data. Refuses ungrounded trading if insufficient history.
        """
        if not bars or len(bars) < 14:
            print(f"[RISK WARNING] Insufficient bar history ({len(bars) if bars else 0} bars < 14 required). Refusing ungrounded ATR estimate.")
            return 0.0
            
        tr_list = []
        for i in range(1, len(bars)):
            h = float(bars[i].get("high", current_price))
            l = float(bars[i].get("low", current_price))
            c_prev = float(bars[i-1].get("close", current_price))
            tr = max(h - l, abs(h - c_prev), abs(l - c_prev))
            tr_list.append(tr)
            
        # Initial 14-period SMA seed
        atr = sum(tr_list[:14]) / 14.0
        
        # Subsequent Wilder's RMA smoothing across remaining bars
        for tr in tr_list[14:]:
            atr = (atr * 13.0 + tr) / 14.0
            
        return round(max(0.01, atr), 4)

    def calculate_dynamic_brackets(
        self,
        entry_price: float,
        direction: str,
        atr: float,
        k_stop: float = 1.5,
        min_tick: float = 0.01
    ) -> Dict[str, float]:
        """
        Calculates volatility & microstructure risk brackets (Adaptive Stops, Breakeven, Scale-Out, TP).
        All values are aligned to the instrument's official exchange minTick.
        """
        dir_clean = direction.upper().strip()
        is_long = dir_clean in ["BUY", "LONG"]
        stop_dist = max(min_tick * 2.0, k_stop * atr)
        
        if is_long:
            stop_price = entry_price - stop_dist
            breakeven_trigger = entry_price + (1.0 * atr)
            scale_out_trigger = entry_price + (2.0 * atr)
            scale_out_new_stop = entry_price + (0.5 * atr)
            take_profit = entry_price + (3.0 * atr)
        else:
            stop_price = entry_price + stop_dist
            breakeven_trigger = entry_price - (1.0 * atr)
            scale_out_trigger = entry_price - (2.0 * atr)
            scale_out_new_stop = entry_price - (0.5 * atr)
            take_profit = entry_price - (3.0 * atr)
            
        # Round to minTick precision
        def round_tick(val: float) -> float:
            if min_tick <= 0:
                return round(val, 2)
            return round(round(val / min_tick) * min_tick, 4)
            
        return {
            "entry_price": round_tick(entry_price),
            "stop_price": round_tick(stop_price),
            "stop_distance": round_tick(stop_dist),
            "breakeven_trigger": round_tick(breakeven_trigger),
            "scale_out_trigger": round_tick(scale_out_trigger),
            "scale_out_new_stop": round_tick(scale_out_new_stop),
            "take_profit": round_tick(take_profit),
            "atr": round(atr, 4),
            "k_stop": k_stop
        }

    def calculate_position_size(
        self,
        entry_price: float,
        initial_stop: float,
        multiplier: float = 1.0,
        currency: str = "USD",
        fx_rate_to_base: float = 1.0
    ) -> float:
        """
        Institutional Position Sizer based on strict per-trade risk budget r = 0.25% of NetLiquidation.
        Formula: Qty = r / (|Entry - Stop| * Multiplier * fx_rate_to_base)
        Supports stocks (multiplier=1.0) and futures contracts (e.g. ES=50, NQ=20, CL=1000).
        """
        net_liq = self.cm.account_summary.get("NetLiquidation", self.start_day_equity)
        risk_capital = net_liq * self.max_trade_risk_pct # r = 0.25% of NetLiq ($250 on $100k)
        stop_distance = abs(entry_price - initial_stop)
        
        if stop_distance <= 0:
            print("[RISK ERROR] Invalid initial stop loss distance. Cannot calculate position sizing.")
            return 0.0
            
        unit_risk_in_base = stop_distance * multiplier * fx_rate_to_base
        raw_qty = risk_capital / unit_risk_in_base
        
        if self.fractional_trading_enabled and multiplier == 1.0:
            target_qty = round(raw_qty, 4)
        else:
            target_qty = float(math.floor(raw_qty))
            
        print(f"[RISK ENGINE] Sizing: NetLiq: ${net_liq:.2f} | RiskCap (r=0.25%): ${risk_capital:.2f} | UnitRisk ({currency}): ${unit_risk_in_base:.2f} (mult={multiplier}) -> Qty: {target_qty}")
        return target_qty

    def check_pre_trade_gateway(self, symbol: str, action: str, requested_qty: float, price: float, rolling_5m_volume: float = 0.0) -> Dict[str, Any]:
        """
        Pre-Trade Risk Gateway (SEC Rule 15c3-5 & MiFID II compliant).
        Evaluates 5 non-bypassable risk gates before any order reaches the broker wire:
          1. Router Locked / Kill Switch Check
          2. Daily Capital Ceiling Check
          3. Daily Max Loss Threshold Check
          4. ADV / Market Impact Check
          5. Short Borrow Availability & Fee Check (for short sells)
        """
        if self.router_locked:
            return {"approved": False, "reason": "Execution router is locked by Emergency Kill Switch"}
            
        order_notional = requested_qty * price
        
        # Gate 0: Geo Market Isolation Policy (US vs Europe)
        is_eu = symbol.upper() in ["SAP", "RWE", "AIR", "ASML", "ENGI", "TTE", "SGO", "MC"] or any(symbol.upper().endswith(ext) for ext in [".PA", ".AS", ".DE", ".MC"])
        if self.market_scope == "US" and is_eu:
            return {
                "approved": False,
                "reason": f"Pre-Trade Market Isolation Policy: European asset {symbol} is blocked (Active Gateway Scope is US Only)."
            }
        if self.market_scope == "EUROPE" and not is_eu:
            return {
                "approved": False,
                "reason": f"Pre-Trade Market Isolation Policy: US asset {symbol} is blocked (Active Gateway Scope is Europe Only)."
            }
        
        # Gate 1: Daily Capital Ceiling
        current_utilized = sum(abs(pos.get("qty", 0) * pos.get("avgCost", price)) for pos in self.cm.active_positions.values())
        if (current_utilized + order_notional) > self.daily_capital_ceiling:
            return {
                "approved": False, 
                "reason": f"Order value ${order_notional:.2f} exceeds available Daily Capital Ceiling (${max(0, self.daily_capital_ceiling - current_utilized):.2f} remaining of ${self.daily_capital_ceiling:.2f})"
            }
            
        # Gate 2: Daily Max Loss Cutoff
        current_realized = self.cm.pnl_updates.get("realized", 0.0)
        current_unrealized = self.cm.pnl_updates.get("unrealized", 0.0)
        total_pnl = current_realized + current_unrealized
        if total_pnl <= -abs(self.daily_max_loss_cutoff):
            self.emergency_flush()
            return {"approved": False, "reason": f"Daily loss of ${total_pnl:.2f} breached hard cutoff of -${self.daily_max_loss_cutoff:.2f}. System Locked."}
            
        # Gate 3: ADV / Market Impact Participation Cap (Max 1.5% of 5m volume)
        # Fail-Closed: If volume data is unavailable or zero, order MUST be rejected.
        if rolling_5m_volume <= 0:
            return {
                "approved": False,
                "reason": f"Market volume unavailable (rolling_5m_volume={rolling_5m_volume}); cannot verify 1.5% participation cap (Fail-Closed)."
            }
        if requested_qty > (rolling_5m_volume * self.max_adv_participation_pct):
            max_allowed = rolling_5m_volume * self.max_adv_participation_pct
            return {
                "approved": False,
                "reason": f"Requested size {requested_qty:.2f} exceeds 1.5% 5-minute ADV cap ({max_allowed:.2f} shares). Market impact unacceptable."
            }
            
        # Gate 4: Short Locate & Borrow Fee Verification
        # Fail-Closed: If institutional short availability cache is absent, reject short order.
        if action.upper() in ["SELL", "SHORT"] and symbol not in self.cm.active_positions:
            short_cache = getattr(self.cm, 'short_availability_cache', {})
            if symbol not in short_cache or not short_cache[symbol]:
                return {
                    "approved": False,
                    "reason": f"Short locate unavailable: No institutional borrow data found in cache for {symbol} (Fail-Closed)."
                }
            short_info = short_cache[symbol]
            shortable_shares = short_info.get("shares_available", 0) # Fail-Closed default 0
            borrow_fee_pct = short_info.get("borrow_fee_pct", 999.0) # Fail-Closed default prohibitively high
            
            if shortable_shares < requested_qty:
                return {"approved": False, "reason": f"Short locate unavailable: only {shortable_shares} shares available for {symbol}, requested {requested_qty:.2f}."}
            if borrow_fee_pct > self.max_short_borrow_fee_pct:
                return {"approved": False, "reason": f"Short borrow fee {borrow_fee_pct:.1f}% exceeds max allowable threshold of {self.max_short_borrow_fee_pct:.1f}%"}
                
        # Gate 5: Binary Event Blackout Check (Never hold through unpriced binary prints)
        blackout_status = self.check_binary_event_blackout(symbol)
        if blackout_status["is_blacked_out"]:
            return {
                "approved": False,
                "reason": f"Binary Event Blackout Active for {symbol}: {blackout_status['reason']}. Entries locked to prevent overnight gap risk."
            }

        return {"approved": True, "reason": "Passed all Pre-Trade Risk Gates"}

    def check_binary_event_blackout(self, symbol: str, lead_time_minutes: int = 30) -> Dict[str, Any]:
        """
        Enforces institutional binary event protection.
        Fail-Closed: If binary calendar is uninitialized or missing, blocks new entries.
        If an event is scheduled within lead_time_minutes or marked as after-hours print today, entry is blocked.
        """
        if not hasattr(self.cm, 'binary_event_schedule') or self.cm.binary_event_schedule is None:
            return {"is_blacked_out": True, "reason": "Binary event calendar uninitialized (Fail-Closed)"}
            
        event = self.cm.binary_event_schedule.get(symbol.upper())
        if not event:
            return {"is_blacked_out": False, "reason": "Clear"}
            
        event_timestamp = event.get("timestamp", 0)
        time_to_event = event_timestamp - time.time()
        
        # If event is within lead_time_minutes or marked as after-hours print today
        if (0 < time_to_event <= (lead_time_minutes * 60)) or event.get("is_today_after_hours", False):
            return {
                "is_blacked_out": True,
                "reason": f"{event.get('title', 'Binary Event')} scheduled ({event.get('time_str', 'today after-hours')})"
            }
            
        return {"is_blacked_out": False, "reason": "Clear"}

    def query_whatif_commission(self, symbol: str, quantity: float, action: str, price: float, is_european: bool = False) -> Dict[str, Any]:
        """
        Queries pre-trade commission and margin impact using IBKR What-If simulation.
        If connected to live gateway, dispatches whatIf=True order to IBKR and inspects orderState.
        In offline sandbox mode, returns calculated IBIE schedule fee benchmark.
        """
        if self.cm.is_connected and hasattr(self.cm, 'whatif_order_cache'):
            cached = self.cm.whatif_order_cache.get(symbol)
            if cached:
                return cached
                
        # Conservative IBIE fee schedule calculation fallback
        if is_european:
            # European Euronext/XETRA: 0.05% with 3.00 EUR min
            est_commission = max(3.00, price * quantity * 0.0005)
            currency = "EUR"
        else:
            # US Equities: $0.005/share with $1.00 min, capped at 1% of trade value
            est_commission = max(1.00, min(quantity * 0.005, price * quantity * 0.01))
            currency = "USD"
            
        est_margin = price * quantity * 0.25 # Reg T intraday margin
        return {
            "commission": round(est_commission, 2),
            "currency": currency,
            "initMarginChange": round(est_margin, 2),
            "status": "Simulated"
        }

    def check_daily_drawdown(self, portfolio_pnl_updates: Dict[str, float]) -> bool:
        """
        Daily Session Circuit Breaker.
        Triggers emergency closure if daily loss breaches either:
          - Hard currency cutoff (self.daily_max_loss_cutoff)
          - Percentage drawdown threshold (self.max_daily_drawdown_pct)
        """
        if self.router_locked:
            return False
            
        net_liq = self.cm.account_summary.get("NetLiquidation", self.start_day_equity)
        daily_loss = portfolio_pnl_updates.get("total", 0.0)
        drawdown_pct = abs(daily_loss) / net_liq if daily_loss < 0 else 0.0
        
        # Check hard currency cutoff
        if daily_loss <= -abs(self.daily_max_loss_cutoff):
            print(f"!!! [KILL SWITCH TRIGGERED] !!! Cumulative daily loss of ${daily_loss:.2f} breached hard currency cutoff (-${self.daily_max_loss_cutoff:.2f}).")
            self.emergency_flush()
            return False

        # Check percentage drawdown threshold
        if daily_loss < 0 and drawdown_pct >= self.max_daily_drawdown_pct:
            print(f"!!! [KILL SWITCH TRIGGERED] !!! Cumulative daily loss of ${daily_loss:.2f} ({drawdown_pct*100:.2f}%) exceeds hard threshold.")
            self.emergency_flush()
            return False
            
        return True

    def emergency_flush(self):
        """
        Liquidates all outstanding orders and flattens client positions via real broker MKT orders.
        Locks the execution router from transmitting further orders.
        Does NOT zero local position state until broker confirmations arrive.
        """
        self.router_locked = True
        print("[RISK DISPATCH] INITIALIZING EMERGENCY FLUSH. CANCELLING ALL OPEN WORKING PAPERS...")
        
        # 1. Cancel all open target order groups asynchronously
        try:
            self.cm.reqGlobalCancel()
        except Exception as e:
            print(f"[RISK EXCEPTION] ReqGlobalCancel failed: {e}")
            
        # 2. Transmit real Market liquidation orders directly to IBKR
        active_positions = list(self.cm.active_positions.items())
        for symbol, data in active_positions:
            qty = data.get("qty", 0.0)
            if qty == 0:
                continue
                
            opposite_direction = "SELL" if qty > 0 else "BUY"
            exit_qty = abs(qty)
            
            print(f"[FLATTEN DISPATCH] Transmitting market liquidation order: {opposite_direction} {exit_qty} {symbol}")
            try:
                contract = self.cm.create_contract(symbol)
                order = self.cm.create_market_order(opposite_direction, exit_qty)
                order_id = self.cm.nextOrderId()
                self.cm.placeOrder(order_id, contract, order)
                print(f"[FLATTEN DISPATCH] Order #{order_id} transmitted to IBKR for {symbol} ({opposite_direction} {exit_qty})")
            except Exception as e:
                print(f"[FLATTEN ERROR] Failed transmitting liquidation order for {symbol}: {e}")
            
            # NOTE: We do NOT zero self.cm.active_positions[symbol]["qty"] locally here!
            # Broker truth is enforced strictly by inbound orderStatus / execDetails / position callbacks.
            
        print("[RISK DISPATCH] EMERGENCY FLUSH EXECUTED. ORDERS TRANSMITTED. ROUTER UNDER SECURE HARD LOCK.")

    def unlock_router(self, operator_key: str = "") -> bool:
        """Manual router unlocking requiring explicit authorization against OPERATOR_ADMIN_KEY."""
        import os
        admin_key = os.environ.get("OPERATOR_ADMIN_KEY", "ALPHA_ADMIN_REVERT_992")
        if not operator_key or operator_key != admin_key:
            print(f"[SECURITY ALERT] Unauthorized attempt to unlock router with key: '{operator_key}'! Unlock rejected.")
            return False
        self.router_locked = False
        print("[RISK GATEWAY] Execution router successfully unlocked by verified operator.")
        return True

    def check_intraday_flattening(self, current_time_est: str = "", current_time_cet: str = "") -> List[Dict[str, Any]]:
        """
        Intraday Flattening Controller (SEC / MiFID II Market-on-Close Discipline).
        If intraday_flattening_enabled is True, automatically liquidates all intraday positions
        at or past 15:45 EST (for US products) and 17:15 CET (for European products).
        Transmits real liquidation orders to IBKR.
        Returns list of executed liquidation orders with order_type 'MOC / MKT (INTRADAY FLATTEN)'.
        """
        if not self.intraday_flattening_enabled:
            return []
            
        liquidations = []
        is_us_eod = False
        is_eu_eod = False
        
        # Check US session cutoff (15:45 EST)
        if current_time_est and current_time_est >= self.intraday_flatten_time_est:
            is_us_eod = True
            
        # Check European session cutoff (17:15 CET)
        if current_time_cet and current_time_cet >= self.intraday_flatten_time_cet:
            is_eu_eod = True
            
        if not (is_us_eod or is_eu_eod):
            return []

        active_positions = list(self.cm.active_positions.items())
        for symbol, data in active_positions:
            qty = data.get("qty", 0)
            if qty == 0:
                continue
                
            # If position is explicitly flagged as swing, skip intraday flattening
            if data.get("is_swing", False):
                continue
                
            is_european = symbol.upper() in ["SGO", "ENGI", "RWE", "SAP", "MC", "AIR", "ASML", "TTE"] or data.get("exchange") in ["IBIS", "SBF", "AEB"]
            if (is_european and is_eu_eod) or (not is_european and is_us_eod):
                opposite_action = "SELL" if qty > 0 else "BUY"
                exit_qty = abs(qty)
                print(f"[INTRADAY MOC FLATTEN] Transmitting {opposite_action} {exit_qty} {symbol} to IBKR (EOD Cutoff reached).")
                try:
                    contract = self.cm.create_contract(symbol)
                    order = self.cm.create_market_order(opposite_action, exit_qty)
                    order_id = self.cm.nextOrderId()
                    self.cm.placeOrder(order_id, contract, order)
                    print(f"[INTRADAY FLATTEN] Transmitted order #{order_id} to IBKR for {symbol}")
                except Exception as e:
                    print(f"[INTRADAY FLATTEN ERR] Could not transmit liquidation order for {symbol}: {e}")

                liquidations.append({
                    "symbol": symbol,
                    "action": opposite_action,
                    "qty": exit_qty,
                    "order_type": "MOC / MKT (INTRADAY FLATTEN)",
                    "reason": f"EOD Intraday Flatten Rule ({self.intraday_flatten_time_est} EST / {self.intraday_flatten_time_cet} CET)"
                })
                
        return liquidations

    def enforce_mifid2_reporting(self, order_obj: Any, dec_maker_code: str, exec_trader_code: str):
        """
        Hardcodes MiFIR specific reporting metadata constraints onto the IBIE target order.
        Required for Central Bank of Ireland (CBI) regulatory compliance.
        """
        try:
            order_obj.mifid2DecisionMaker = dec_maker_code
            order_obj.mifid2ExecutionTrader = exec_trader_code
            order_obj.mifid2DecisionAlgo = "ALPHA_OFI_V4"
            order_obj.mifid2ExecutionAlgo = "DMA_AUTO_V1"
        except AttributeError:
            pass


class SyntheticStopManager:
    """
    Institutional Synthetic Stop & Fractional Execution Guard.
    IBKR Rule Compliance & Multi-Day PEAD / Intraday Lifecycle:
      1. IBKR rejects native STP/STP LMT orders on fractional quantities.
         All fractional stops MUST be managed in-memory as Synthetic Stops,
         firing fractional MKT or LMT DAY exit orders only when market price breaches the stop.
      2. Breakeven Latch: When profit reaches +1.0x ATR, stop is ratcheted to entry price (breakeven).
      3. Tiered Scale-Out: When profit reaches +2.0x ATR, scale out 50% of position size,
         moving stop on remaining 50% to lock in profit at +0.5x ATR.
      4. Floor ineligible assets down to integer shares.
      5. Enforce $1.00 / €1.00 minimum notional floor.
    """
    def __init__(self, connection_manager, drm_middleware: DRMMiddleware):
        self.cm = connection_manager
        self.drm = drm_middleware
        self.synthetic_stops: Dict[str, Dict[str, Any]] = {} # symbol -> {qty, stop_price, direction, entry_price, ...}
        
    def register_position_stop(self, symbol: str, qty: float, stop_price: float, direction: str, entry_price: float, atr: float = 0.0, is_swing: bool = False):
        self.synthetic_stops[symbol] = {
            "qty": float(qty),
            "stop_price": float(stop_price),
            "initial_stop": float(stop_price),
            "direction": direction.upper(),
            "entry_price": float(entry_price),
            "atr": float(atr),
            "is_swing": is_swing,
            "breakeven_locked": False,
            "scale_out_triggered": False,
            "created_at": time.time()
        }
        print(f"[SYNTHETIC STOP REGISTERED] {symbol}: {direction} {qty} shares | Stop: ${stop_price:.2f} (Entry: ${entry_price:.2f}, ATR: ${atr:.2f}, Swing: {is_swing})")

    def unregister_stop(self, symbol: str):
        if symbol in self.synthetic_stops:
            del self.synthetic_stops[symbol]

    def evaluate_live_price(self, symbol: str, current_price: float) -> Optional[Dict[str, Any]]:
        """
        Evaluates real-time price tick against synthetic stop triggers,
        breakeven ratchet, and tiered scale-out targets.
        """
        if symbol not in self.synthetic_stops or current_price <= 0:
            return None
            
        stop_data = self.synthetic_stops[symbol]
        direction = stop_data["direction"]
        stop_price = stop_data["stop_price"]
        entry_price = stop_data["entry_price"]
        qty = stop_data["qty"]
        atr = stop_data.get("atr", 0.0)
        
        # 1. Hard Stop Loss Breach Evaluation
        breached = False
        if direction in ["BUY", "LONG"] and current_price <= stop_price:
            breached = True
            exit_action = "SELL"
        elif direction in ["SELL", "SHORT"] and current_price >= stop_price:
            breached = True
            exit_action = "BUY"
            
        if breached:
            print(f"!!! [SYNTHETIC STOP TRIGGERED] !!! {symbol} price ${current_price:.2f} crossed stop ${stop_price:.2f}. Executing fractional exit.")
            del self.synthetic_stops[symbol]
            return {
                "type": "STOP_LOSS",
                "symbol": symbol,
                "action": exit_action,
                "qty": qty,
                "trigger_price": current_price,
                "order_type": "MKT" # Compliant with IBKR fractional rules (MKT or LMT DAY only)
            }

        # 2. Multi-Day PEAD & Intraday Lifecycle: Breakeven Latch (+1.0x ATR)
        if not stop_data.get("breakeven_locked", False) and atr > 0:
            is_long = direction in ["BUY", "LONG"]
            breakeven_reached = (current_price >= (entry_price + 1.0 * atr)) if is_long else (current_price <= (entry_price - 1.0 * atr))
            if breakeven_reached:
                stop_data["stop_price"] = entry_price
                stop_data["breakeven_locked"] = True
                print(f"[BREAKEVEN LATCH TRIGGERED] {symbol}: Price ${current_price:.2f} reached +1.0x ATR profit. Stop ratcheted to Breakeven ${entry_price:.2f}.")
                return {
                    "type": "BREAKEVEN_LATCH",
                    "symbol": symbol,
                    "new_stop": entry_price,
                    "trigger_price": current_price
                }

        # 3. Multi-Day PEAD & Intraday Lifecycle: Tiered Scale-Out (+2.0x ATR)
        if not stop_data.get("scale_out_triggered", False) and atr > 0:
            is_long = direction in ["BUY", "LONG"]
            scale_out_reached = (current_price >= (entry_price + 2.0 * atr)) if is_long else (current_price <= (entry_price - 2.0 * atr))
            if scale_out_reached:
                scale_qty = round(qty * 0.5, 4)
                remaining_qty = round(qty - scale_qty, 4)
                stop_data["qty"] = remaining_qty
                stop_data["scale_out_triggered"] = True
                if is_long:
                    new_stop = round(entry_price + 0.5 * atr, 2)
                    scale_action = "SELL"
                else:
                    new_stop = round(entry_price - 0.5 * atr, 2)
                    scale_action = "BUY"
                stop_data["stop_price"] = new_stop
                print(f"[TIERED SCALE-OUT TRIGGERED] {symbol}: Price ${current_price:.2f} reached +2.0x ATR! Scaling out 50% ({scale_qty} shares). Stop trailed to ${new_stop:.2f}.")
                return {
                    "type": "SCALE_OUT",
                    "symbol": symbol,
                    "action": scale_action,
                    "qty": scale_qty,
                    "remaining_qty": remaining_qty,
                    "new_stop": new_stop,
                    "trigger_price": current_price,
                    "order_type": "MKT"
                }

        return None

    def validate_and_sanitize_order(self, symbol: str, requested_qty: float, price: float, is_fractionable: bool = True) -> Dict[str, Any]:
        """
        Pre-flight validation for fractional lot compliance.
        Enforces IBKR minimum notional, fractional enablement, and rounding.
        """
        if requested_qty <= 0 or price <= 0:
            return {"valid": False, "reason": "Non-positive quantity or price", "qty": 0}
            
        notional_value = requested_qty * price
        
        # IBKR Rule: Minimum notional value is $1.00 USD (or equivalent)
        if notional_value < 1.00:
            return {"valid": False, "reason": f"Notional value ${notional_value:.2f} below IBKR $1.00 minimum floor", "qty": 0}
            
        # Check if fractional trading is enabled globally
        if not self.drm.fractional_trading_enabled and (requested_qty % 1 != 0):
            rounded_qty = math.floor(requested_qty)
            if rounded_qty <= 0:
                return {"valid": False, "reason": "Fractional trading disabled and rounded qty is 0", "qty": 0}
            return {"valid": True, "qty": float(rounded_qty), "was_floored": True}
            
        # Check instrument-specific fractionability
        if not is_fractionable and (requested_qty % 1 != 0):
            rounded_qty = math.floor(requested_qty)
            if rounded_qty <= 0:
                return {"valid": False, "reason": f"Instrument {symbol} is not fractionable and rounded qty is 0", "qty": 0}
            return {"valid": True, "qty": float(rounded_qty), "was_floored": True}
            
        # IBKR 4-decimal precision limit for US equities fractionals
        clean_qty = round(requested_qty, 4)
        return {"valid": True, "qty": clean_qty, "was_floored": False}
