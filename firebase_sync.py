import json
import os
import urllib.request
import urllib.error
from typing import Dict, Any, List

class FirebaseSyncTunnel:
    """
    Lightweight, dependency-free Firebase Firestore Synchronization Client.
    Communicates directly with Google Firestore using the REST API.
    Does not require any heavy third-party PIP dependencies, ensuring compatibility 
    on any local VPS or edge node environment.
    """
    def __init__(self, config_path: str = "firebase-applet-config.json"):
        self.enabled = False
        self.project_id = ""
        self.api_key = ""
        self.database_id = ""
        self.id_token = None
        
        # 1. Attempt to load credentials from the config file
        try:
            if os.path.exists(config_path):
                with open(config_path, 'r') as f:
                    config = json.load(f)
                    self.project_id = config.get("projectId", "")
                    self.api_key = config.get("apiKey", "")
                    # Fetch database ID - default to specific workspace database
                    self.database_id = config.get("firestoreDatabaseId", "(default)")
            
            # Allow environment overrides
            self.project_id = os.getenv("FIREBASE_PROJECT_ID", self.project_id)
            self.api_key = os.getenv("FIREBASE_API_KEY", self.api_key)
            self.database_id = os.getenv("FIREBASE_DATABASE_ID", self.database_id)
            
            # 2. Keyless discovery: if still missing project ID, check GCE Metadata Server
            if not self.project_id:
                self.project_id = self._get_gce_project_id()

            if not self.database_id:
                self.database_id = "(default)"

            # Check if running on GCE with metadata permissions to do keyless auth
            has_gce_metadata = False
            try:
                req = urllib.request.Request("http://metadata.google.internal/computeMetadata/v1/instance", headers={"Metadata-Flavor": "Google"})
                with urllib.request.urlopen(req, timeout=1.0) as response:
                    has_gce_metadata = True
            except Exception:
                pass
            
            if self.project_id and (self.api_key or has_gce_metadata):
                self.enabled = True
                print("--------------------------------------------------")
                print("[FIREBASE TUNNEL] Sync Tunnel Initialized Successfully.")
                print(f"Project ID: {self.project_id}")
                print(f"Database: {self.database_id}")
                print(f"Authentication Mode: {'Secure Keyless GCE Metadata' if has_gce_metadata else 'Standard Web API Key API'}")
                print("--------------------------------------------------")
            else:
                print("[FIREBASE TUNNEL] Missing credentials. Operating in virtual offline/in-memory mode.")
        except Exception as e:
            print(f"[FIREBASE TUNNEL] Initialization warning: {e}. Defaulting to offline simulation mode.")

    def _get_gce_project_id(self) -> str:
        """Attempts to retrieve the project ID from the local GCE Metadata Server."""
        url = "http://metadata.google.internal/computeMetadata/v1/project/project-id"
        req = urllib.request.Request(url, headers={"Metadata-Flavor": "Google"})
        try:
            with urllib.request.urlopen(req, timeout=1.5) as response:
                return response.read().decode("utf-8").strip()
        except Exception:
            return ""

    def _get_gce_metadata_token(self) -> str:
        """Attempts to retrieve an OAuth2 token from the local GCE Metadata Server."""
        url = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token"
        req = urllib.request.Request(url, headers={"Metadata-Flavor": "Google"})
        try:
            with urllib.request.urlopen(req, timeout=2) as response:
                data = json.loads(response.read().decode("utf-8"))
                token = data.get("access_token")
                if token:
                    print("[FIREBASE TUNNEL] Dynamic GCE Metadata Token Obtained. Authenticating as Cloud VM Instance Service Account.")
                    return token
        except Exception:
            # Silent fallback if not on GCE
            pass
        return None

    def _authenticate(self):
        print("[FIREBASE TUNNEL] Anonymous authentication disabled. Only GCE Service Account metadata tokens are permitted for Edge Node security.")
        return None
    def _dict_to_firestore_fields(self, d: Dict[str, Any]) -> Dict[str, Any]:
        """Converts standard Python dictionary to Firestore Document REST payload format."""
        fields = {}
        for k, v in d.items():
            if isinstance(v, bool):
                fields[k] = {"booleanValue": v}
            elif isinstance(v, (int, float)):
                # Firestore expects doubleValue for numbers to handle fractional sizes
                fields[k] = {"doubleValue": float(v)}
            elif isinstance(v, str):
                fields[k] = {"stringValue": v}
            elif v is None:
                fields[k] = {"nullValue": None}
        return {"fields": fields}

    def _firestore_fields_to_dict(self, fields: Dict[str, Any]) -> Dict[str, Any]:
        """Converts Firestore Document REST payload format back to a standard Python dict."""
        res = {}
        for k, v in fields.items():
            if "stringValue" in v:
                res[k] = v["stringValue"]
            elif "doubleValue" in v:
                res[k] = float(v["doubleValue"])
            elif "integerValue" in v:
                res[k] = int(v["integerValue"])
            elif "booleanValue" in v:
                res[k] = bool(v["booleanValue"])
            elif "nullValue" in v:
                res[k] = None
        return res

    def _request(self, method: str, path: str, body: Dict[str, Any] = None, is_retry: bool = False) -> Dict[str, Any]:
        """Executes a secure REST API request to Google Firestore."""
        if not self.enabled:
            return {}

        if not self.id_token:
            # Check GCE VM identity first for zero-config GCP permission matching
            gce_token = self._get_gce_metadata_token()
            if gce_token:
                self.id_token = gce_token
            else:
                pass # Only GCE token allowed

        url = f"https://firestore.googleapis.com/v1/projects/{self.project_id}/databases/{self.database_id}/documents/{path}?key={self.api_key}"
        
        headers = {
            "Content-Type": "application/json",
            "User-Agent": "AlphaEngine-EdgeNode-Daemon"
        }
        if self.id_token:
            headers["Authorization"] = f"Bearer {self.id_token}"
        
        data_bytes = None
        if body is not None:
            data_bytes = json.dumps(body).encode("utf-8")

        req = urllib.request.Request(url, data=data_bytes, headers=headers, method=method)
        
        try:
            with urllib.request.urlopen(req, timeout=8) as response:
                res_data = response.read().decode("utf-8")
                if res_data:
                    return json.loads(res_data)
                return {}
        except urllib.error.HTTPError as e:
            if (e.code == 401 or e.code == 403) and not is_retry:
                print("[FIREBASE TUNNEL] Token/Auth expired or denied. Re-authenticating...")
                self._authenticate()
                return self._request(method, path, body, is_retry=True)
            err_msg = e.read().decode("utf-8")
            print(f"[FIREBASE TUNNEL API ERROR] {method} {path} failed: {e.code} - {err_msg}")
            raise Exception(f"Firestore API Error: {e.code} - {err_msg}")
        except Exception as e:
            print(f"[FIREBASE TUNNEL CONN ERROR] Connection failed: {e}")
            raise e

    def push_active_trade(self, trade_id: str, trade_data: Dict[str, Any]):
        """Pushes an active session holding to Firestore (/active_trades/{tradeId})."""
        if not self.enabled:
            return
        body = self._dict_to_firestore_fields(trade_data)
        path = f"active_trades/{trade_id}"
        # Use PATCH with updateMask so it writes cleanly or updates existing documents
        self._request("PATCH", path, body)
        print(f"[FIREBASE TUNNEL] Synchronized active trade {trade_id} ({trade_data['symbol']}) to cloud.")

    def delete_active_trade(self, trade_id: str):
        """Removes an active session holding from Firestore."""
        if not self.enabled:
            return
        path = f"active_trades/{trade_id}"
        self._request("DELETE", path)
        print(f"[FIREBASE TUNNEL] Purged active trade {trade_id} from cloud (flattened/MOC close).")

    def push_historical_log(self, log_id: str, log_data: Dict[str, Any]):
        """Pushes a completed MiFIR compliant trade log transaction to Firestore."""
        if not self.enabled:
            return
        body = self._dict_to_firestore_fields(log_data)
        path = f"historical_logs/{log_id}"
        self._request("PATCH", path, body)
        print(f"[FIREBASE TUNNEL] Archived regulatory trade log {log_id} ({log_data['symbol']}) dynamically.")

    def push_system_risk_state(self, net_liq: float, maint_margin: float, realized_pnl: float, unrealized_pnl: float, router_locked: bool):
        """Pushes system pool equity, risk metrics, and circuit breaker status to Firestore."""
        if not self.enabled:
            return
        import datetime
        state_data = {
            "netLiquidation": net_liq,
            "maintenanceMargin": maint_margin,
            "dailyRealizedPnL": realized_pnl,
            "dailyUnrealizedPnL": unrealized_pnl,
            "routerLocked": router_locked,
            "lastUpdated": datetime.datetime.utcnow().isoformat() + "Z"
        }
        body = self._dict_to_firestore_fields(state_data)
        path = "system_risk_state/current_state"
        self._request("PATCH", path, body)
        print(f"[FIREBASE TUNNEL] Sync'd system risk state: NetLiq={net_liq:.2f}, RouterLocked={router_locked}")

    def get_system_risk_state(self) -> Dict[str, Any]:
        """Pulls settings and lock toggles from Firestore to override local parameters."""
        if not self.enabled:
            return {}
        
        path = "system_risk_state/current_state"
        res = self._request("GET", path)
        if res and "fields" in res:
            parsed = self._firestore_fields_to_dict(res["fields"])
            print(f"[FIREBASE TUNNEL] Pulled risk state overrides: RouterLocked={parsed.get('routerLocked', 'N/A')}")
            return parsed
        return {}
