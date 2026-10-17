import time
import os
import json
import threading
import datetime
import uuid
import socket
from typing import Optional, Callable

class HighAvailabilityManager:
    """
    Manages Leader Election between active Trading Edge Nodes.
    Uses atomic local file leasing and process liveliness to ensure only ONE instance emits live orders.
    Standby node monitors the lease and triggers failover logic if the primary dies.
    Zero Cloud Dependencies per Universal Institutional Principles.
    """
    def __init__(self, lock_path: str = "ha_leader_lock.json", failover_callback: Optional[Callable] = None):
        self.lock_path = lock_path
        self.node_id = f"EDGE-{socket.gethostname()}-{uuid.uuid4().hex[:6]}"
        self.is_leader = False
        self.failover_callback = failover_callback
        
        self.heartbeat_interval = 5.0
        self.failover_threshold = 15.0
        self._running = False
        self._thread = None

    def start(self):
        self._running = True
        self._thread = threading.Thread(target=self._election_loop, daemon=True, name="HAElectionThread")
        self._thread.start()
        print(f"[HA-MGR] Node {self.node_id} participating in Leader Election...")
        time.sleep(1)

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

    def _read_lock(self) -> dict:
        if os.path.exists(self.lock_path):
            try:
                with open(self.lock_path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass
        return {}

    def _write_lock(self, data: dict):
        temp_path = f"{self.lock_path}.tmp"
        try:
            with open(temp_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
            os.replace(temp_path, self.lock_path)
        except Exception as e:
            print(f"[HA-MGR WARN] Lock write error: {e}")

    def _run_election_cycle(self):
        now = datetime.datetime.now(datetime.timezone.utc)
        leader_data = self._read_lock()
        
        current_leader = leader_data.get("node_id", "")
        last_heartbeat_str = leader_data.get("last_heartbeat", "")
        
        is_stale = True
        if last_heartbeat_str:
            try:
                clean_str = last_heartbeat_str.replace('Z', '+00:00')
                last_hb = datetime.datetime.fromisoformat(clean_str)
                age = (now - last_hb).total_seconds()
                if age < self.failover_threshold:
                    is_stale = False
            except ValueError:
                pass

        if current_leader == self.node_id:
            if not self.is_leader:
                print(f"[HA-MGR] Successfully acquired PRIMARY LEADER role.")
                self.is_leader = True
            self._write_lock({"node_id": self.node_id, "last_heartbeat": now.isoformat(), "pid": os.getpid()})
            
        elif is_stale or not current_leader:
            if current_leader and current_leader != self.node_id:
                print(f"[HA-MGR] Primary {current_leader} TIMED OUT (Missed {self.failover_threshold}s window). Initiating failover!")
                if self.failover_callback and not self.is_leader:
                    self.failover_callback()
            
            print(f"[HA-MGR] Seizing primary leader lease for {self.node_id}...")
            self._write_lock({"node_id": self.node_id, "last_heartbeat": now.isoformat(), "pid": os.getpid()})
            self.is_leader = True
            
        else:
            if self.is_leader:
                print(f"[HA-MGR] Split-brain detected or demoted. Relinquishing leader to {current_leader}.")
                self.is_leader = False
