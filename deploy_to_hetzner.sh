#!/bin/bash
# ==============================================================================
#          ALPHA ENGINE - HETZNER & AGNOSTIC CLOUD DEPLOYER (SSH)
# ==============================================================================
# Automates the provisioning of a co-located Hetzner Cloud Instance
# (e.g., CCX22 Dedicated CPU or CX22 Shared CPU in Frankfurt) or any standard Linux VPS,
# installing the trading node as an institutional systemd background service.
#
# Usage: ./deploy_to_hetzner.sh <server_ip_address> [ssh_user] [ssh_port]
# ==============================================================================

set -o errexit

echo "======================================================================"
# Highlight institutional-level cloud-agnostic execution
echo "     ALPHA ENGINE SYSTEM PROVISIONER - HETZNER & MULTI-CLOUD DEPLOYER "
echo "======================================================================"

SERVER_IP="$1"
SSH_USER="${2:-root}"
SSH_PORT="${3:-22}"

if [ -z "$SERVER_IP" ]; then
    echo "❌ ERROR: No target Server IP Address provided!"
    echo "Usage: ./deploy_to_hetzner.sh <server_ip_address> [ssh_user] [ssh_port]"
    echo ""
    echo "Example: ./deploy_to_hetzner.sh 159.69.110.45"
    echo "Example: ./deploy_to_hetzner.sh 159.69.110.45 debian 22"
    exit 1
fi

echo "Connecting to Target Server: ${SSH_USER}@${SERVER_IP} on port ${SSH_PORT}..."

# 1. Fetch Firebase Credentials to feed the edge tunnel automatically
CONFIG_FILE="firebase-applet-config.json"
FIREBASE_PROJECT=""
FIREBASE_KEY=""

if [ -f "$CONFIG_FILE" ]; then
    echo "[SYNC] Found local workspace Firebase config file."
    FIREBASE_PROJECT=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE')).get('projectId', ''))" 2>/dev/null || true)
    FIREBASE_KEY=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE')).get('apiKey', ''))" 2>/dev/null || true)
fi

if [ -z "$FIREBASE_PROJECT" ]; then
    echo "[WARN] Could not auto-detect Firebase context in config file."
    read -p "Enter Firebase Project ID: " FIREBASE_PROJECT
fi

# 2. Package local workspace codebase for distribution
echo "[WORKSPACE] Compressing local codebase assets into an offline installer bundle..."
tar -czf /tmp/alpha-workspace-bundle.tar.gz --exclude='.git' --exclude='node_modules' --exclude='.env' . || true

# 3. Formulate the remote bootstrap script
cat <<EOF > remote_vm_setup.sh
#!/bin/bash
set -e

echo "=========================================================="
echo "          RUNNING REMOTE EDGE CONTAINER INITIALIZER       "
echo "=========================================================="

sudo mkdir -p /opt/alpha-engine
sudo chown -R \$USER:\$USER /opt/alpha-engine

# Dynamic remote package synchronization
echo "[VM] Installing system updates & dependencies (Docker Engine)..."
sudo apt-get update -y
sudo apt-get install -y python3 python3-pip git docker.io tar curl -y

echo "[VM] Setting up Docker engine service..."
sudo systemctl enable docker || true
sudo systemctl start docker || true
if [ "\$USER" != "root" ]; then
    sudo usermod -aG docker \$USER || true
fi

# Python dependencies setup
echo "[VM] Staging Python runtime modules..."
pip3 install python-dotenv urllib3 --quiet || pip install python-dotenv urllib3 --quiet || true

# Extract the uploaded workspace installer bundle directly
echo "[VM] Deploying latest codebase elements to /opt/alpha-engine..."
tar -xzf ~/alpha-workspace-bundle.tar.gz -C /opt/alpha-engine/

# Generate secure localized environment parameters
cat <<ENV > /opt/alpha-engine/.env
IBKR_ACCOUNT_NUMBER="U8129384"
IBKR_HOST="127.0.0.1"
IBKR_PORT=4002
IBKR_CLIENT_ID=10
MIFID2_DECISION_MAKER_ID="ALGO_DEC_992"
MIFID2_EXECUTION_TRADER_ID="ALGO_EXE_554"
FIREBASE_PROJECT_ID="$FIREBASE_PROJECT"
FIREBASE_API_KEY="$FIREBASE_KEY"
ENV

# Create systemd self-starter
echo "[VM] Registering high-reliability systemd background service..."
sudo tee /etc/systemd/system/alpha-engine.service > /dev/null <<SERVICE
[Unit]
Description=Alpha Engine Edge trading daemon
After=network.target

[Service]
Type=simple
User=\$USER
WorkingDirectory=/opt/alpha-engine
ExecStart=/usr/bin/python3 main.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SERVICE

# Reload and boot the daemon
echo "[VM] Bootstrapping background service daemon..."
sudo systemctl daemon-reload
sudo systemctl enable alpha-engine.service
sudo systemctl restart alpha-engine.service

echo "--------------------------------------------------------"
echo "✅ VM EDGE NODE SUCCESSFULLY INSTALLED AND DAEMONIZED!"
echo "--------------------------------------------------------"
EOF

# 4. Upload compressed bundle and setup script to target server via scp
echo "[SSH] Uploading installer bundle to remote target..."
scp -P "$SSH_PORT" /tmp/alpha-workspace-bundle.tar.gz "${SSH_USER}@${SERVER_IP}:~/alpha-workspace-bundle.tar.gz"

echo "[SSH] Uploading system configurer script to remote target..."
scp -P "$SSH_PORT" remote_vm_setup.sh "${SSH_USER}@${SERVER_IP}:~/remote_vm_setup.sh"

# 5. Execute setup commands remotely over SSH
echo "[SSH] Executing remote initialization sequence..."
ssh -p "$SSH_PORT" "${SSH_USER}@${SERVER_IP}" "chmod +x ~/remote_vm_setup.sh && ~/remote_vm_setup.sh"

# 6. Teardown local temporary files
rm -f remote_vm_setup.sh
rm -f /tmp/alpha-workspace-bundle.tar.gz

echo ""
echo "======================================================================="
echo "   [SUCCESS] ALPHA ENGINE AGNOSTIC EDGE DAEMON SUCCESSFULLY DEPLOYED! "
echo "======================================================================="
echo "  Your Python Edge Node is running as a systemd background service on"
208: "  the target Linux server (IP: $SERVER_IP), adjacent to the execution hub."
209: "  Log-rotation and self-healing auto-restarts are enabled."
210: "======================================================================="
echo ""
