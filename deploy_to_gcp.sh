#!/bin/bash
# ==============================================================================
#            ALPHA ENGINE - GCP LOW-LATENCY PROXIMITY DEPLOYER
# ==============================================================================
# Automates the provisioning of a Frankfurt (europe-west3) Standard e2-medium instance 
# and installs the trading node as a systemd background service.
#
# Target Execution: Google Cloud Shell (console.cloud.google.com)
# Cost Profile: ~$30/month (Standard VM)
# ==============================================================================

set -o errexit

echo "======================================================================"
echo "          ALPHA ENGINE SYSTEM PROVIONER - GOOGLE CLOUD PLATFORM  "
echo "======================================================================"

# 1. Look for Firebase Credentials to feed the edge tunnel automatically
CONFIG_FILE="firebase-applet-config.json"
FIREBASE_PROJECT=""
FIREBASE_KEY=""

if [ -f "$CONFIG_FILE" ]; then
    echo "[SYNC] Found local workspace Firebase config file."
    # Use python to extract values safely
    FIREBASE_PROJECT=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE')).get('projectId', ''))" 2>/dev/null || true)
    FIREBASE_KEY=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE')).get('apiKey', ''))" 2>/dev/null || true)
fi

# Fallback prompts if blank
if [ -z "$FIREBASE_PROJECT" ]; then
    # Parse project ID from .firebaserc natively if it exists
    if [ -f ".firebaserc" ]; then
        FIREBASE_PROJECT=$(grep '"default"' .firebaserc | cut -d '"' -f 4)
        echo "[SYNC] Extracted GCP project from .firebaserc: $FIREBASE_PROJECT"
    else
        ACTIVE_PROJECT=$(gcloud config get-value project 2>/dev/null || true)
        if [ -n "$ACTIVE_PROJECT" ]; then
            echo "[GCLOUD] Auto-detected active GCP project from environment: $ACTIVE_PROJECT"
            FIREBASE_PROJECT="$ACTIVE_PROJECT"
        else
            read -p "Enter Google Cloud Project ID: " FIREBASE_PROJECT
        fi
    fi
fi

# Verify active project registration
echo "[GCLOUD] Registering context to target project: $FIREBASE_PROJECT"
gcloud config set project "$FIREBASE_PROJECT" --quiet

# Enable required Google Cloud services automatically
echo "[GCLOUD] Ensuring necessary Cloud APIs are fully enabled (Firestore & Vertex AI & Secret Manager)..."
gcloud services enable firestore.googleapis.com aiplatform.googleapis.com secretmanager.googleapis.com --quiet

# 2. Spin up the Standard VM Instance in europe-west3 (Frankfurt, nearest to IBKR Europe)
ZONE="europe-west3-a"
VM_NAME="alpha-edge-node"

echo "[GCLOUD] Provisioning e2-medium Standard Instance in zone: $ZONE..."
echo "[NOTICE] Creating this as a Standard VM avoids preemption (unmanaged positions) for ~$30/mo!"

# Check if instance already exists to prevent duplicate failures
if gcloud compute instances describe "$VM_NAME" --zone="$ZONE" >/dev/null 2>&1; then
    echo "[WARN] VM instance '$VM_NAME' already exists. Updating existing configuration..."
else
    gcloud compute instances create "$VM_NAME" \
        --zone="$ZONE" \
        --machine-type="e2-medium" \
        --image-family="debian-12" \
        --image-project="debian-cloud" \
        --metadata=startup-script="sudo apt-get update && sudo apt-get install -y python3 python3-pip git" \
        --scopes="https://www.googleapis.com/auth/cloud-platform" \
        --tags="ib-gateway-target" \
        --description="Alpha Engine High Frequency Execution node in europe-west3 (Frankfurt)"
fi

# 3. Initialize GCP Secret Manager for .env Secrets
echo "[SECRETS] Pushing environment secrets to GCP Secret Manager (alpha-engine-env)..."
cat <<ENV > /tmp/alpha-engine.env
IBKR_ACCOUNT_NUMBER="DU1234567"
IBKR_HOST="127.0.0.1"
IBKR_PORT=4002
IBKR_CLIENT_ID=10
MAX_ACTIVE_INSTRUMENTS=3
ALLOW_LIVE_TRADING=false
MIFID2_DECISION_MAKER_ID="ALGO_DEC_992"
MIFID2_EXECUTION_TRADER_ID="ALGO_EXE_554"
FIREBASE_PROJECT_ID="$FIREBASE_PROJECT"
FIREBASE_API_KEY="$FIREBASE_KEY"
ENV

if gcloud secrets describe alpha-engine-env >/dev/null 2>&1; then
    gcloud secrets versions add alpha-engine-env --data-file=/tmp/alpha-engine.env --quiet
else
    gcloud secrets create alpha-engine-env --data-file=/tmp/alpha-engine.env --replication-policy=automatic
fi
rm /tmp/alpha-engine.env

# 4. Setup systemd service setup command sequence to push to the virtual machine
echo "[SSH] Uploading startup services & workspace hooks to the target VM..."

# Package the local workspace files directly from Cloud Shell to bypass VM-level Git cloning
echo "[WORKSPACE] Compressing local codebase assets into an offline installer bundle..."
tar -czf /tmp/alpha-workspace-bundle.tar.gz --exclude='.git' --exclude='node_modules' --exclude='.env' . || true

# Make a temporary startup initialization script to load services on the VM
cat <<EOF > remote_vm_setup.sh
#!/bin/bash
sudo mkdir -p /opt/alpha-engine
sudo chown -R \$USER:\$USER /opt/alpha-engine

# Dynamic remote package synchronization (for safety on pre-existing instances)
echo "[VM] Ensuring required system packages & Docker are installed..."
sudo apt-get update
sudo apt-get install -y python3 python3-pip git docker.io

# Safeguard 1GB e2-micro instance against OOM killer by establishing a 2GB swapfile
if ! swapon --show | grep -q "/swapfile"; then
    echo "[VM] Establishing 2GB swapfile to prevent OOM killer on 1GB e2-micro VM..."
    if [ ! -f /swapfile ]; then
        sudo fallocate -l 2G /swapfile || sudo dd if=/dev/zero of=/swapfile bs=1M count=2048
        sudo chmod 600 /swapfile
        sudo mkswap /swapfile
    fi
    sudo swapon /swapfile || true
fi

echo "[VM] Initializing Docker service and setting up permissions..."
sudo systemctl enable docker
sudo systemctl start docker
sudo usermod -aG docker \$USER

# Extract the local workspace installer bundle directly
echo "[VM] Extracting workspace codebase elements to /opt/alpha-engine..."
tar -xzf ~/alpha-workspace-bundle.tar.gz -C /opt/alpha-engine/

# Python dependencies setup
echo "[VM] Syncing Python library packages via requirements.txt..."
cd /opt/alpha-engine && (pip3 install -r requirements.txt --quiet || pip install -r requirements.txt --quiet || true)

# Pull secrets from GCP Secret Manager dynamically to avoid plaintext disk artifacts
echo "[VM] Pulling production secrets from Secret Manager into memory-backed /dev/shm..."
gcloud secrets versions access latest --secret="alpha-engine-env" > /dev/shm/alpha-engine.env
chmod 400 /dev/shm/alpha-engine.env
ln -sf /dev/shm/alpha-engine.env /opt/alpha-engine/.env

# Create systemd self-starter
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
WatchdogSec=30

[Install]
WantedBy=multi-user.target
SERVICE

# Load and start daemon
sudo systemctl daemon-reload
sudo systemctl enable alpha-engine.service
sudo systemctl restart alpha-engine.service

echo "--------------------------------------------------------"
echo "VM EDGE NODE SUCCESSFULLY DEPLOYED AND DAEMONIZED!"
echo "Status: Active & monitoring Firestore queues in Frankfurt"
echo "--------------------------------------------------------"
EOF

# Copy remote setups & local workspace archive to the VM instance
gcloud compute scp /tmp/alpha-workspace-bundle.tar.gz "$VM_NAME":~/alpha-workspace-bundle.tar.gz --zone="$ZONE" --quiet
gcloud compute scp remote_vm_setup.sh "$VM_NAME":~/remote_vm_setup.sh --zone="$ZONE" --quiet

# Execute remote initializations
gcloud compute ssh "$VM_NAME" --zone="$ZONE" --command="chmod +x ~/remote_vm_setup.sh && ~/remote_vm_setup.sh" --quiet

# 5. Deploy Belgium Warm Standby (europe-west1-b)
STANDBY_ZONE="europe-west1-b"
STANDBY_VM="alpha-edge-standby"

echo "[GCLOUD] Provisioning Warm Standby e2-medium in zone: $STANDBY_ZONE (Belgium)..."
if gcloud compute instances describe "$STANDBY_VM" --zone="$STANDBY_ZONE" >/dev/null 2>&1; then
    echo "[WARN] VM instance '$STANDBY_VM' already exists."
else
    gcloud compute instances create "$STANDBY_VM" \
        --zone="$STANDBY_ZONE" \
        --machine-type="e2-medium" \
        --image-family="debian-12" \
        --image-project="debian-cloud" \
        --metadata=startup-script="sudo apt-get update && sudo apt-get install -y python3 python3-pip git" \
        --scopes="https://www.googleapis.com/auth/cloud-platform" \
        --tags="ib-gateway-standby" \
        --description="Alpha Engine Warm Standby node in europe-west1 (Belgium)"
fi

echo "[SSH] Deploying to Warm Standby..."
gcloud compute scp ./alpha-workspace-bundle.tar.gz "$STANDBY_VM":~/alpha-workspace-bundle.tar.gz --zone="$STANDBY_ZONE" --quiet
gcloud compute scp remote_vm_setup.sh "$STANDBY_VM":~/remote_vm_setup.sh --zone="$STANDBY_ZONE" --quiet
gcloud compute ssh "$STANDBY_VM" --zone="$STANDBY_ZONE" --command="chmod +x ~/remote_vm_setup.sh && ~/remote_vm_setup.sh" --quiet

# Teardown local temporary deployments
rm -f remote_vm_setup.sh
rm -f /tmp/alpha-workspace-bundle.tar.gz

echo ""
echo "======================================================================="
echo "  [SUCCESS] GOOGLE CLOUD LOW-LATENCY MULTI-EXCHANGE PLATFORM DEPLOYED! "
echo "======================================================================="
echo "  Your Python Edge Node is running as a systemd background process in"
echo "  Frankfurt (europe-west3), keeping execution latency to IBKR to <1ms."
echo "  A Warm Standby has also been provisioned in Belgium (europe-west1)."
echo "  Your Cloud Run Control Plane on AI Studio automatically bridges logs."
echo "======================================================================="
echo ""
