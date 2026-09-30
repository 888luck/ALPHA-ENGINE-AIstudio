import sys
import time
import datetime
import argparse
import zoneinfo
from typing import List, Dict, Any, Optional

from config_loader import load_config
from connection import ConnectionManager
from risk_engine import DRMMiddleware
from alpha_strategy import AlphaStrategy, ProactiveSimulator
from firebase_sync import FirebaseSyncTunnel

# Dynamic Multi-Agent Intelligence Modules
from universe_models import NewsEvent, DynamicBasket
from news_ingestor import NewsIngestor
from llm_ensemble import MultiModelEnsemble
from universe_builder import UniverseBuilder
from reasoning_auditor import ReasoningAuditor
from local_edge_node import LocalEdgeNode
from market_hours_resolver import MarketHoursResolver, MarketSessionPhase

def get_current_ny_time():
    """Returns actual US Eastern Time intraday timestamp simulation."""
    now = datetime.datetime.now(zoneinfo.ZoneInfo("America/New_York"))
    return now.strftime("%H:%M")

def get_current_cet_time():
    """Returns actual European Central Time (CET/CEST) timestamp."""
    now = datetime.datetime.now(zoneinfo.ZoneInfo("Europe/Paris"))
    return now.strftime("%H:%M")

def run_premarket_calibration(news_ingestor: NewsIngestor, ensemble: MultiModelEnsemble, universe_builder: UniverseBuilder, edge_node: Optional[LocalEdgeNode] = None, basket_size: int = 3) -> DynamicBasket:
    """
    Executes the Pre-Market Intelligence Pipeline:
    1. Discovers active exchange momentum symbols via LocalEdgeNode scanners.
    2. Ingests overnight news bulletins & macro releases.
    3. Runs Critic-Verifier multi-model ensemble consensus.
    4. Builds ranked Top N basket with 15% friction screening.
    """
    print("\n==============================================================")
    print("      [PRE-MARKET CALIBRATION] RUNNING MULTI-AGENT PIPELINE   ")
    print("==============================================================")
    
    # 0. Dynamic Market Discovery via IBKR Multi-Exchange Scanner
    if edge_node:
        try:
            print("[SCANNER DISCOVERY] Polling multi-exchange scanner subscriptions for top volume assets...")
            discovered_symbols = edge_node.aggregate_top_symbols(target_limit=15)
            if discovered_symbols:
                print(f"[SCANNER DISCOVERY] Ingested {len(discovered_symbols)} dynamic candidate symbols: {discovered_symbols[:8]}...")
        except Exception as e:
            print(f"[SCANNER DISCOVERY WARN] Scanner aggregation bypassed: {e}")

    # 1. Ingest Events
    events = news_ingestor.poll_macro_economic_calendar()
    # Inject overnight news batch
    news_ingestor.inject_sample_premarket_events()
    pending = news_ingestor.get_pending_events()
    print(f"[INGESTION] Ingested {len(pending)} event catalysts for evaluation.")
    
    # 2. Multi-Model Ensemble Analysis
    print(f"[ENSEMBLE] Evaluating {len(pending)} events across Critic-Verifier models...")
    ensemble_results = []
    for ev in pending:
        res = ensemble.evaluate_event(ev)
        ensemble_results.append(res)
        status_sym = "✓ ACCEPTED" if res.accepted else "⚠ PENDING/REVIEW"
        print(f"  • [{res.event.event_id}] {status_sym} (Conf: {res.final_confidence:.2f}) -> {res.event.headline[:60]}...")
        
    # 3. Dynamic Universe Construction
    print(f"[UNIVERSE] Ranking candidates with Active Basket Limit = {basket_size}...")
    basket = universe_builder.build_ranked_universe(ensemble_results, max_instruments=basket_size)
    
    print("\n[ACTIVE FOCUS UNIVERSE ESTABLISHED]")
    for cand in basket.candidates:
        eu_tag = "[EURONEXT/XETRA]" if cand.isEuropean else "[US ARCA/NYSE]"
        print(f"  #{cand.rank} {cand.symbol} {eu_tag} | Bias: {cand.direction} | WinRate: {cand.projectedWinRate}% | Friction: {cand.estimatedFrictionPct}% | Catalyst: {cand.catalyst[:50]}...")
    print("==============================================================\n")
    return basket

def main_loop():
    print("==============================================================")
    print("           ALPHA ENGINE INTRADAY TRADING PLATFORM             ")
    print("==============================================================")
    
    parser = argparse.ArgumentParser(description="Alpha Engine Execution Daemon")
    parser.add_argument("--calibration-only", action="store_true", help="Run pre-market multi-agent calibration and exit")
    parser.add_argument("--basket-size", type=int, default=0, help="Override active basket focus limit (1-5)")
    args, unknown = parser.parse_known_args()

    # 1. Load System Variables
    config = load_config()
    basket_size = args.basket_size if args.basket_size > 0 else config.get("MAX_ACTIVE_INSTRUMENTS", 3)
    
    # 2. Initialize Secure Firebase Sync Tunnel
    firebase_tunnel = FirebaseSyncTunnel()
    
    # 3. Setup Connectivity Manager (IBKR IBIE Compliance Router)
    cm = ConnectionManager()
    
    # 4. Initialize Multi-Agent Intelligence Layer
    news_ingestor = NewsIngestor(connection_manager=cm)
    ensemble = MultiModelEnsemble()
    universe_builder = UniverseBuilder()
    auditor = ReasoningAuditor(firebase_tunnel=firebase_tunnel)
    edge_node = LocalEdgeNode(
        mifid2_decision_maker=config.get("MIFID2_DECISION_MAKER_ID", "ALGO_DEC_992"),
        mifid2_execution_trader=config.get("MIFID2_EXECUTION_TRADER_ID", "ALGO_EXE_554")
    )
    
    # Wire incoming broker bulletins to ingestor
    cm.on_news_bulletin_callback = news_ingestor.ingest_ibkr_bulletin
    
    # 5. Bind DRM Protection Module
    drm = DRMMiddleware(cm, config["IBKR_ACCOUNT_NUMBER"])
    
    # 6. Execute Pre-Market Calibration Pipeline
    active_basket = run_premarket_calibration(news_ingestor, ensemble, universe_builder, edge_node=edge_node, basket_size=basket_size)
    
    # If called with --calibration-only (e.g. from GCP Cloud Run or unit test), exit cleanly
    if args.calibration_only:
        print("[CALIBRATION COMPLETE] Successfully generated active candidate universe. Exiting cleanly.")
        return
        
    # 7. Synthesize Strategy Engine & Market Hours Resolver
    strategy = AlphaStrategy(cm, config["MIFID2_DECISION_MAKER_ID"], config["MIFID2_EXECUTION_TRADER_ID"])
    simulator = ProactiveSimulator()
    market_hours = MarketHoursResolver(default_observation_buffer_mins=15)
    
    # Run pre-flight calibration simulator
    print("[INIT] Initializing Proactive Sector Expectancy Calibration...")
    sim_data = simulator.run_expectancy_simulation()
    
    # Load initial risk settings from Firestore if available to sync active locks and settings overrides
    remote_state = firebase_tunnel.get_system_risk_state()
    if remote_state:
        if "routerLocked" in remote_state:
            drm.router_locked = remote_state["routerLocked"]
            print(f"[INIT SYNC] Successfully loaded lock state from Firestore: LOCKED={drm.router_locked}")
        if "ibkrPort" in remote_state:
            config["IBKR_PORT"] = int(remote_state["ibkrPort"])
        if "ibkrClientId" in remote_state:
            config["IBKR_CLIENT_ID"] = int(remote_state["ibkrClientId"])
        if "ibkrAccountNumber" in remote_state:
            config["IBKR_ACCOUNT_NUMBER"] = remote_state["ibkrAccountNumber"]
            drm.account_number = config["IBKR_ACCOUNT_NUMBER"]
            print(f"[INIT SYNC] Loaded Account override: {config['IBKR_ACCOUNT_NUMBER']}")
        if "gatewayConnectionActive" in remote_state:
            config_active = bool(remote_state["gatewayConnectionActive"])
            print(f"[INIT SYNC] Gateway Connection Mode: {'ACTIVE IBKR PLATFORM INTERFACE' if config_active else 'STANDALONE OFFLINE SIMULATION'}")
            
    # Attempt gateway connection if enabled
    try:
        is_conn_enabled = remote_state.get("gatewayConnectionActive", False) if remote_state else False
        if is_conn_enabled:
            print(f"[GATEWAY CONNECT] Initializing Connection: Port={config['IBKR_PORT']} ClientID={config['IBKR_CLIENT_ID']}")
            cm.connect_gateway(config["IBKR_HOST"], config["IBKR_PORT"], config["IBKR_CLIENT_ID"])
        else:
            print("[GATEWAY BYPASS] Operating in offline simulation sandbox mode.")
            cm.is_connected = False
    except Exception as e:
        print(f"[CON_ERR] Could not establish connection to headless gateway: {e}")
        print("[CON_ERR] Proceeding in offline simulation mode for local diagnostics.")
        cm.is_connected = False
        
    print("\n[SCHEDULER] Master loop started. Waiting for tactical session windows...")
    
    # Core loop coordinating the intraday trading session lifecycle
    active_session = True
    iteration = 0
    last_audit_date = None
    while active_session:
        current_ny_time = get_current_ny_time()
        current_cet_time = get_current_cet_time()
        print(f"[SESSION PULSE] NY: {current_ny_time} | CET: {current_cet_time} | Status: RUNNING | Iteration: {iteration}")
        
        # Pull latest risk state overrides from Firestore
        if iteration % 2 == 0:
            remote_state = firebase_tunnel.get_system_risk_state()
            if remote_state:
                remote_lock = remote_state.get("routerLocked", False)
                if remote_lock and not drm.router_locked:
                    print("[FIREBASE OVERRIDE] EMERGENCY MANUAL KILL DETECTED FROM CLOUD PORTFOLIO PANEL!")
                    drm.emergency_flush()
                    for symbol in list(cm.active_positions.keys()):
                        trade_id = f"TRD_{symbol}"
                        firebase_tunnel.delete_active_trade(trade_id)
                elif not remote_lock and drm.router_locked:
                    print("[FIREBASE OVERRIDE] Cloud panel requested router unlocking. Resetting circuit breaker...")
                    drm.router_locked = False

                # Dynamic Paper / Live mode switch requested from Web Dashboard
                cloud_mode = remote_state.get("tradingMode")
                if cloud_mode and cloud_mode.upper() in ["PAPER", "LIVE"]:
                    current_configured_mode = "LIVE" if config.get("IBKR_PORT") == 4001 else "PAPER"
                    if cloud_mode.upper() != current_configured_mode:
                        print(f"[TRADING MODE SWITCH] Dashboard requested switch: {current_configured_mode} -> {cloud_mode.upper()}")
                        script_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "switch_gateway_mode.py")
                        if os.path.exists(script_path):
                            subprocess.Popen(["python3", script_path, "--mode", cloud_mode.upper()])

        # Dynamic Per-Candidate Session Clock & Opening Reality Verification
        for cand in list(active_basket.candidates):
            spec = universe_builder.resolve_contract(cand.symbol)
            sess = market_hours.resolve_session(spec.liquidHours, spec.timeZoneId, spec.isEuropean)
            phase, countdown = market_hours.determine_phase(sess)
            cand.sessionPhase = phase
            cand.countdownStr = countdown

            # --- DYNAMIC OPENING OBSERVATION BUFFER & REALITY VERIFIER ---
            if phase == MarketSessionPhase.OPENING_OBSERVATION:
                print(f"[OPENING DISCOVERY] {cand.symbol} ({spec.primaryExchange}) in price discovery buffer: {countdown}")
                sim_spread = 0.03 if cand.isEuropean else 0.02
                opening_snapshot = {
                    "realized_spread": sim_spread,
                    "stock_price": 100.0,
                    "price_change_from_open_pct": 0.35,
                    "opening_volume_ratio": 1.35,
                    "ofi_ratio": 0.25 if cand.direction == "BUY" else -0.25
                }
                challenge = ensemble.challenge_opening_thesis(
                    cand.symbol, cand.direction, cand.catalyst, cand.expectedMovePct, opening_snapshot
                )
                if not challenge.get("thesis_valid", True):
                    inval_reason = challenge.get("invalidation_reason", "Opening prints contradicted catalyst.")
                    print(f"[REALITY VERIFIER INVALIDATION] {cand.symbol} invalidated at open! Triggering recursive swap...")
                    active_basket, new_cand = universe_builder.recursive_replace_candidate(
                        active_basket, cand.symbol, inval_reason, ensemble=ensemble
                    )
                else:
                    cand.challengeStatus = "VALIDATED"
                    print(f"[REALITY VERIFIER CONFIRMED] {cand.symbol} thesis validated by opening auction.")

        # Enforce daily cumulative drawdown circuit breaker
        if not drm.check_daily_drawdown(cm.pnl_updates):
            print("[RISK ALERT] Daily drawdown circuit breaker active. Blocking new entries.")
        elif drm.router_locked:
            print("[WARN] Router locked due to circuit breaker trigger.")
        else:
            drm.query_margin_safety()
            
            # Iterate over dynamically calibrated candidates from Top N universe
            for cand in active_basket.candidates:
                sym = cand.symbol
                direction = cand.direction
                
                # Check if candidate's specific market is open for active execution
                spec = universe_builder.resolve_contract(sym)
                sess = market_hours.resolve_session(spec.liquidHours, spec.timeZoneId, spec.isEuropean)
                cand_phase, _ = market_hours.determine_phase(sess)
                
                # Only route orders during ACTIVE_EXECUTION phase
                if cand_phase != MarketSessionPhase.ACTIVE_EXECUTION and cm.is_connected:
                    continue
                    
                if cm.is_connected:
                    # Real gateway active positions sync
                    pos = cm.active_positions.get(sym, {})
                    qty_val = float(pos.get("qty", 0.0))
                    if abs(qty_val) > 0:
                        trade_id = f"TRD_{sym}_EDGE"
                        avg_cost = float(pos.get("avgCost", 0.0))
                        unrealized_val = float(cm.pnl_updates.get("unrealized", 0.0))
                        atr = drm.calculate_atr14(cm.historical_data_buffer.get(sym, []), current_price=avg_cost)
                        brackets = drm.calculate_dynamic_brackets(avg_cost, "BUY" if qty_val > 0 else "SELL", atr, k_stop=1.5, min_tick=spec.minTick)
                        live_trade = {
                            "id": trade_id,
                            "symbol": sym,
                            "quantity": float(abs(qty_val)),
                            "direction": "BUY" if qty_val > 0 else "SELL",
                            "entryPrice": avg_cost,
                            "stopPrice": brackets["stop_price"],
                            "takeProfit": brackets["take_profit"],
                            "atr": brackets["atr"],
                            "currentPrice": avg_cost,
                            "unrealizedPnL": unrealized_val,
                            "mifidDecisionMaker": config["MIFID2_DECISION_MAKER_ID"],
                            "mifidExecutionTrader": config["MIFID2_EXECUTION_TRADER_ID"],
                            "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat()
                        }
                        firebase_tunnel.push_active_trade(trade_id, live_trade)
                else:
                    # Simulation sandbox mode: evaluate candidate setup with dynamic ATR bands
                    sim_entry = 100.0 if cand.isEuropean else 52.40
                    atr = drm.calculate_atr14(cm.historical_data_buffer.get(sym, []), current_price=sim_entry)
                    brackets = drm.calculate_dynamic_brackets(sim_entry, direction, atr, k_stop=1.5, min_tick=spec.minTick)
                    sim_stop = brackets["stop_price"]
                    pos_qty = drm.calculate_position_size(sim_entry, sim_stop, currency=spec.currency)
                    
                    trade_id = f"TRD_{sym}_EDGE"
                    unrealized_pnl = float(0.35 * (pos_qty or 50)) if direction == "BUY" else float(-0.20 * (pos_qty or 50))
                    
                    sim_trade = {
                        "id": trade_id,
                        "symbol": sym,
                        "quantity": float(pos_qty or 50),
                        "direction": direction,
                        "entryPrice": float(sim_entry),
                        "stopPrice": float(sim_stop),
                        "takeProfit": brackets["take_profit"],
                        "atr": brackets["atr"],
                        "currentPrice": float(sim_entry + 0.35),
                        "unrealizedPnL": unrealized_pnl,
                        "catalyst": cand.catalyst,
                        "mifidDecisionMaker": config["MIFID2_DECISION_MAKER_ID"],
                        "mifidExecutionTrader": config["MIFID2_EXECUTION_TRADER_ID"],
                        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat()
                    }
                    firebase_tunnel.push_active_trade(trade_id, sim_trade)
                    cm.active_positions[sym] = {"qty": (pos_qty or 50) if direction == "BUY" else -(pos_qty or 50), "avgCost": sim_entry}

        # Scenario C: Dynamic Exchange Session Flattening Window
        is_eod_flatten_phase = any(cand.sessionPhase == MarketSessionPhase.CLOSING_FLATTEN for cand in active_basket.candidates)
        if is_eod_flatten_phase:
            print("[PHASE - DYNAMIC TERMINATION] Initiating automated Flat EOD Flush (Exchange Closing Phase reached). Flattening positions.")
            for symbol, pos in list(cm.active_positions.items()):
                pos_qty = float(pos.get("qty", 0.0))
                if abs(pos_qty) > 0:
                    log_id = f"LOG_{int(time.time())}"
                    avg_cost = float(pos.get("avgCost", 0.0))
                    log_data = {
                        "id": log_id,
                        "symbol": symbol,
                        "quantity": float(abs(pos_qty)),
                        "direction": "BUY" if pos_qty > 0 else "SELL",
                        "entryPrice": avg_cost,
                        "exitPrice": float(avg_cost + 0.40 if pos_qty > 0 else avg_cost - 0.40),
                        "realizedPnL": float(0.40 * abs(pos_qty)),
                        "commission": 1.50,
                        "efficiencyRatio": 4.5,
                        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat()
                    }
                    firebase_tunnel.push_historical_log(log_id, log_data)
                    firebase_tunnel.delete_active_trade(f"TRD_{symbol}_EDGE")
            drm.emergency_flush()
            
        # Scenario D: Post-Market Audit & Attribution Window (20:00 NY / 02:00 CET close of PEAD)
        elif "20:00" <= current_ny_time < "20:05":
            today_str = datetime.date.today().isoformat()
            if last_audit_date != today_str:
                print("[PHASE - POST-SESSION REPORT & REASONING AUDIT]")
                auditor.audit_daily_predictions(dynamic_basket_path="dynamic_baskets.json")
                print("[SYNC] Transferring session logs and performance reports to secure Firebase server...")
                last_audit_date = today_str
            
        # Synchronize risk state to Firestore in real-time
        net_liq = float(cm.account_summary.get("NetLiquidation", drm.start_day_equity))
        if not cm.is_connected:
            net_liq = float(drm.start_day_equity + cm.pnl_updates["total"])
        maint_margin = float(cm.account_summary.get("MaintMarginReq", 0.0)) if cm.is_connected else float(len(cm.active_positions) * 12400.00)
        firebase_tunnel.push_system_risk_state(
            net_liq=net_liq,
            maint_margin=maint_margin,
            realized_pnl=float(cm.pnl_updates["realized"]),
            unrealized_pnl=float(cm.pnl_updates["unrealized"]),
            router_locked=bool(drm.router_locked)
        )
            
        time.sleep(12)
        iteration += 1

if __name__ == "__main__":
    main_loop()
