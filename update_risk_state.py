import sys
import os
from firebase_sync import FirebaseSyncTunnel

def main():
    ft = FirebaseSyncTunnel()
    print(f"Connecting to Firestore: project={ft.project_id}")
    ft.push_system_risk_state(
        net_liq=1023930.83,
        maint_margin=11901.58,
        realized_pnl=0.0,
        unrealized_pnl=0.0,
        router_locked=False,
        model_accuracy=0.88,
        extra_metrics={
            "gatewayConnectionActive": True,
            "routerLocked": False,
            "accountNumber": "DUE263010",
            "tradingMode": "PAPER",
            "marketScope": "ALL"
        }
    )
    print("Successfully updated system_risk_state/current_state with routerLocked=False, gatewayConnectionActive=True")

if __name__ == "__main__":
    main()
