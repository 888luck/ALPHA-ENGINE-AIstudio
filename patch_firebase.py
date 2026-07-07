import re

with open('firebase_sync.py', 'r') as f:
    content = f.read()

# Replace _authenticate with a method that does nothing or raises error
new_auth = """    def _authenticate(self):
        print("[FIREBASE TUNNEL] Anonymous authentication disabled. Only GCE Service Account metadata tokens are permitted for Edge Node security.")
        return None"""

# Find _authenticate def
auth_start = content.find("    def _authenticate(self):")
auth_end = content.find("    def _dict_to_firestore_fields", auth_start)

new_content = content[:auth_start] + new_auth + "\n" + content[auth_end:]

# In _request, remove the fallback to _authenticate
req_start = new_content.find("            else:")
req_end = new_content.find("        url = f", req_start)
# We just replace the fallback logic
new_content = new_content.replace("            else:\n                self._authenticate()", "            else:\n                pass # Only GCE token allowed")

with open('firebase_sync.py', 'w') as f:
    f.write(new_content)

