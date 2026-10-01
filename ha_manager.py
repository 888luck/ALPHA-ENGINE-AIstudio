import time
import threading
import datetime
import uuid
import socket
from typing import Optional, Callable
from firebase_sync import FirebaseSyncTunnel

class HighAvailabilityManager:
    """
    Manages Leader Election between active Trading Edge Nodes.
    Uses Firestore document locking to ensure only ONE instance can emit live orders.
    Standby node monitors the lock and triggers failover logic if the primary dies.
    """
    def __init__(self, firebase_tunnel: FirebaseSyncTunnel, failover_callback: Optional[Callable] = None):
        self.firebase = firebase_tunnel
        self.node_id = f"EDGE-{socket.gethostname()}-{uuid.uuid4().hex[:6]}"
        self.is_leader = False
        self.failover_callback = failover_callback
        
        self.heartbeat_interval = 5.0
        self.failover_threshold = 15.0
        self._running = False
        self._thread = None

    def start(self):
        self._running = True
        self._thread = threading.Thread(target=self._election_loop, daemon=True)
        self._thread.start()
        print(f"[HA-MGR] Node {self.node_id} participating in Leader Election...")
        # Give it a second to determine initial state
        time.sleep(2)

    def stop(self):
        self._running = False
        if self._thread:
            self._thread.join(timeout=2.0)

    def _election_loop(self):
        while self._running:
            try:
                self._run_election_cycle()
            except Exception as e:
                print(f"[HA-MGR] Election cycle error: {e}")
            time.sleep(self.heartbeat_interval)

    def _run_election_cycle(self):
        now = datetime.datetime.now(datetime.timezone.utc)
        
        # 1. Fetch current leader state
        leader_data = self.firebase.get_leader_heartbeat()
        
        current_leader = leader_data.get("node_id", "")
        last_heartbeat_str = leader_data.get("last_heartbeat", "")
        
        is_stale = True
        if last_heartbeat_str:
            try:
                # Firestore ISO strings usually end with 'Z'
                clean_str = last_heartbeat_str.replace('Z', '+00:00')
                last_hb = datetime.datetime.fromisoformat(clean_str)
                age = (now - last_hb).total_seconds()
                if age < self.failover_threshold:
                    is_stale = False
            except ValueError:
                pass # Parse error treats it as stale

        # 2. State Machine
        if current_leader == self.node_id:
            # We are the leader, renew lock
            if not self.is_leader:
                print(f"[HA-MGR] Successfully acquired PRIMARY LEADER role.")
                self.is_leader = True
            self.firebase.push_leader_heartbeat(self.node_id, now.isoformat())
            
        elif is_stale or not current_leader:
            # Leader died or is absent, attempt takeover
            if current_leader and current_leader != self.node_id:
                print(f"[HA-MGR] Primary {current_leader} TIMED OUT (Missed 15s window). Initiating failover!")
                if self.failover_callback and not self.is_leader:
                    self.failover_callback()
            
            print(f"[HA-MGR] Attempting to seize leader lock...")
            self.firebase.push_leader_heartbeat(self.node_id, now.isoformat())
            self.is_leader = True
            
        else:
            # Another healthy node is the leader. We are Standby.
            if self.is_leader:
                print(f"[HA-MGR] Split-brain detected or demoted. Relinquishing leader to {current_leader}.")
                self.is_leader = False
            # Standby mode, wait...
