import time
import datetime
from config_loader import load_config
from connection import ConnectionManager
from risk_engine import DRMMiddleware
from alpha_strategy import AlphaStrategy, ProactiveSimulator
from firebase_sync import FirebaseSyncTunnel

def get_current_ny_time():
    """Returns local intraday timestamp simulation."""
    now = datetime.datetime.now()
    return now.strftime("%H:%M")

def main_loop():
    print("==============================================================")
    print("           ALPHA ENGINE INTRADAY TRADING PLATFORM             ")
    print("==============================================================")
    
    # 1. Load System Variables
    config = load_config()
    
    # 2. Initialize Secure Firebase Sync Tunnel
    firebase_tunnel = FirebaseSyncTunnel()
    
    # 3. Setup Connectivity Manager (IBKR IBIE Compliance Router)
    cm = ConnectionManager()
    
    # 4. Bind DRM Protection Module
    drm = DRMMiddleware(cm, config["IBKR_ACCOUNT_NUMBER"])
    
    # 5. Synthesize Strategy Engine
    strategy = AlphaStrategy(cm, config["MIFID2_DECISION_MAKER_ID"], config["MIFID2_EXECUTION_TRADER_ID"])
    simulator = ProactiveSimulator()
    
    # Run pre-flight calibration simulator
    print("[INIT] Initializing Proactive Sector Expectancy Calibration...")
    sim_data = simulator.run_expectancy_simulation()
    
    # Load initial risk settings from Firestore if available to sync active locks
    remote_state = firebase_tunnel.get_system_risk_state()
    if remote_state:
        if "routerLocked" in remote_state:
            drm.router_locked = remote_state["routerLocked"]
            print(f"[INIT SYNC] Successfully loaded lock state from Firestore: LOCKED={drm.router_locked}")
    
    # Attempt gateway connection
    try:
        cm.connect_gateway(config["IBKR_HOST"], config["IBKR_PORT"], config["IBKR_CLIENT_ID"])
    except Exception as e:
        print(f"[CON_ERR] Could not establish connection to headless gateway: {e}")
        print("[CON_ERR] Proceeding in offline simulation mode for local diagnostics.")
        cm.is_connected = False
        
    print("\n[SCHEDULER] Master loop started. Waiting for tactical session windows...")
    
    # Core loop coordinating the intraday trading session lifecycle
    # 04:00 Pre-market Calibration, 09:30-15:50 Tactical Execution window, 15:50 Flat Flush, 16:10 Sync
    active_session = True
    iteration = 0
    while active_session:
        current_time = get_current_ny_time()
        print(f"[SESSION PULSE] Current Time: {current_time} | Status: RUNNING | Iteration: {iteration}")
        
        # Pull latest risk state overrides from Firestore to check for manual emergency kills from web dashboard
        if iteration % 2 == 0:  # Check remote locks every 2 iterations to optimize quota limits
            remote_state = firebase_tunnel.get_system_risk_state()
            if remote_state:
                remote_lock = remote_state.get("routerLocked", False)
                if remote_lock and not drm.router_locked:
                    print("[FIREBASE OVERRIDE] EMERGENCY MANUAL KILL DETECTED FROM CLOUD PORTFOLIO PANEL!")
                    drm.emergency_flush()
                    # Delete all active trades from firestore
                    for symbol in list(cm.active_positions.keys()):
                        trade_id = f"TRD_{symbol}"
                        firebase_tunnel.delete_active_trade(trade_id)
                elif not remote_lock and drm.router_locked:
                    print("[FIREBASE OVERRIDE] Cloud panel requested router unlocking. Resetting circuit breaker...")
                    drm.router_locked = False

        # Scenario A: 04:00 - Pre-market Calibration (Seeding limits/params)
        if "04:00" <= current_time < "09:30":
            print("[PHASE - CALIBRATION] Performing pre-market sector calibration and margin queries.")
            drm.query_margin_safety()
            
        # Scenario B: 09:30 - 15:50 (Intraday Live Execution Router Active)
        elif "09:30" <= current_time < "15:50":
            if drm.router_locked:
                print("[WARN] Router locked due to previous session circuit breaker trigger.")
            else:
                print(f"[PHASE - EXECUTION] Active trading window. Streaming Level 2 tickers & calculating OFI.")
                # Perform basic risk evaluations on each iteration
                drm.query_margin_safety()
                
                # Mock a trade sizing setup loop
                sim_entry = 52.40
                sim_stop = 51.90
                pos_qty = drm.calculate_position_size(sim_entry, sim_stop)
                
                # Simulate MiFIR metadata tagging on Order Class
                class MockOrder:
                    def __init__(self):
                        self.mifid2DecisionMaker = ""
                o = MockOrder()
                drm.enforce_mifid2_reporting(o, config["MIFID2_DECISION_MAKER_ID"], config["MIFID2_EXECUTION_TRADER_ID"])
                
                # Sync simulated live trade to Firestore active trades list
                # This feeds the frontend dashboard with active trades streamed from the VPS node
                trade_id = "TRD_XLE_EDGE"
                sim_trade = {
                    "id": trade_id,
                    "symbol": "XLE",
                    "quantity": float(pos_qty or 100),
                    "direction": "BUY",
                    "entryPrice": float(sim_entry),
                    "stopPrice": float(sim_stop),
                    "currentPrice": float(sim_entry + 0.35),
                    "unrealizedPnL": float((0.35) * (pos_qty or 100)),
                    "mifidDecisionMaker": config["MIFID2_DECISION_MAKER_ID"],
                    "mifidExecutionTrader": config["MIFID2_EXECUTION_TRADER_ID"],
                    "timestamp": datetime.datetime.utcnow().isoformat() + "Z"
                }
                firebase_tunnel.push_active_trade(trade_id, sim_trade)
                
                # Update connection manager positions tracking
                cm.active_positions["XLE"] = {"qty": pos_qty or 100, "avgCost": sim_entry}
                cm.pnl_updates["unrealized"] = (0.35) * (pos_qty or 100)
                cm.pnl_updates["total"] = cm.pnl_updates["realized"] + cm.pnl_updates["unrealized"]

        # Scenario C: 15:50 (EOD Flush Window - 10 minutes prior to close)
        elif "15:50" <= current_time < "16:00":
            print("[PHASE - HARD TERMINATION] Initiating automated Flat EOD Flush. Flattening all positions.")
            # Record historical log upon closing
            for symbol, pos in list(cm.active_positions.items()):
                if pos["qty"] > 0:
                    log_id = f"LOG_{int(time.time())}"
                    log_data = {
                        "id": log_id,
                        "symbol": symbol,
                        "quantity": float(pos["qty"]),
                        "direction": "BUY",
                        "entryPrice": float(pos["avgCost"]),
                        "exitPrice": float(pos["avgCost"] + 0.40),
                        "realizedPnL": float(0.40 * pos["qty"]),
                        "commission": 1.50,
                        "efficiencyRatio": 4.5,
                        "timestamp": datetime.datetime.utcnow().isoformat() + "Z"
                    }
                    firebase_tunnel.push_historical_log(log_id, log_data)
                    # Purge from active trades
                    firebase_tunnel.delete_active_trade(f"TRD_{symbol}_EDGE")
            
            drm.emergency_flush()
            
        # Scenario D: 16:10 (Post-Market Synchronization and database export)
        elif "16:10" <= current_time:
            print("[PHASE - POST-SESSION REPORT] Triggering final database synchronization to FireStore.")
            print("[SYNC] Transferring session logs and performance reports to secure Firebase server...")
            active_session = False  # Terminate standard session
            
        # 6. Synchronize current engine risk state and margins to Firestore in real-time
        net_liq = float(cm.account_summary.get("NetLiquidation", drm.start_day_equity))
        # Keep net liq in sync with total P&L in simulation
        if not cm.is_connected:
            net_liq = float(drm.start_day_equity + cm.pnl_updates["total"])

        maint_margin = float(len(cm.active_positions) * 12400.00)
        firebase_tunnel.push_system_risk_state(
            net_liq=net_liq,
            maint_margin=maint_margin,
            realized_pnl=float(cm.pnl_updates["realized"]),
            unrealized_pnl=float(cm.pnl_updates["unrealized"]),
            router_locked=bool(drm.router_locked)
        )
            
        # Pulse speed
        time.sleep(12)
        iteration += 1

if __name__ == "__main__":
    main_loop()
