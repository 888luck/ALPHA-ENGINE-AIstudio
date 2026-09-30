import os
import sqlite3
import json
import urllib.request
import urllib.error

def check():
    db_path = os.path.expandvars(r"%APPDATA%\gcloud\access_tokens.db")
    print("Checking db_path:", db_path)
    if os.path.exists(db_path):
        conn = sqlite3.connect(db_path)
        cur = conn.cursor()
        try:
            cur.execute("SELECT account_id, access_token, token_expiry FROM access_tokens")
            rows = cur.fetchall()
            print("Found accounts:", len(rows))
            for acc, token, expiry in rows:
                print(f"Account: {acc}, Expiry: {expiry}")
                url = "https://compute.googleapis.com/compute/v1/projects/alpha-engine-ai-studio/zones/europe-west3-a/instances"
                req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
                try:
                    with urllib.request.urlopen(req) as resp:
                        data = json.loads(resp.read().decode())
                        items = data.get("items", [])
                        print(f"GCE Success! Found {len(items)} instances:")
                        for inst in items:
                            print(f"  - Name: {inst.get('name')}")
                            print(f"    ID: {inst.get('id')}")
                            print(f"    Status: {inst.get('status')}")
                            print(f"    MachineType: {inst.get('machineType', '').split('/')[-1]}")
                            for ni in inst.get("networkInterfaces", []):
                                print(f"    Internal IP: {ni.get('networkIP')}")
                                for ac in ni.get("accessConfigs", []):
                                    print(f"    External IP: {ac.get('natIP')}")
                except urllib.error.HTTPError as e:
                    print(f"HTTPError {e.code}: {e.read().decode()[:200]}")
                except Exception as e:
                    print("Error:", e)
        except Exception as e:
            print("DB error:", e)
    else:
        print("No access_tokens.db found")

if __name__ == "__main__":
    check()
