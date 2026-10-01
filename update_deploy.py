import re

with open("deploy_to_gcp.sh", "r", encoding="utf-8") as f:
    text = f.read()

# Normalize line endings
text = text.replace("\r\n", "\n")

# 1. Enable Secret Manager
text = re.sub(r'firestore\.googleapis\.com aiplatform\.googleapis\.com', 
              'firestore.googleapis.com aiplatform.googleapis.com secretmanager.googleapis.com', text)

# 2. Modify VM creation (Frankfurt)
text = re.sub(r'--machine-type="e2-micro" \\\n\s+--preemptible \\', '--machine-type="e2-medium" \\', text)
text = text.replace('e2-micro Spot Instance', 'e2-medium Standard Instance')
text = text.replace('a Spot VM lowers your GCE cost by 75% to ~$1.64/mo!', 'a Standard VM avoids preemption (unmanaged positions) for ~$30/mo!')
text = text.replace('1GB e2-micro instance', '4GB e2-medium instance')
text = text.replace('1GB e2-micro VM', '4GB e2-medium VM')

# 3. Create Secret in Secret Manager
secret_logic = """# 3. Initialize GCP Secret Manager for .env Secrets
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

# 4. Setup systemd service setup command sequence"""
text = re.sub(r'# 3\. Setup systemd service setup command sequence', secret_logic, text)

# 4. Modify remote_vm_setup.sh to pull from Secret Manager
env_seeding = r'''# Dynamic env seeding
cat <<ENV > /opt/alpha-engine/\.env
.*?ENV'''
new_env_seeding = """# Pull secrets from GCP Secret Manager dynamically to avoid plaintext disk artifacts
echo "[VM] Pulling production secrets from Secret Manager into memory-backed /dev/shm..."
gcloud secrets versions access latest --secret="alpha-engine-env" > /dev/shm/alpha-engine.env
chmod 400 /dev/shm/alpha-engine.env
ln -sf /dev/shm/alpha-engine.env /opt/alpha-engine/.env"""
text = re.sub(env_seeding, new_env_seeding, text, flags=re.DOTALL)

# 5. Add Belgium Warm Standby deployment
belgium_logic = """# 5. Deploy Belgium Warm Standby (europe-west1-b)
STANDBY_ZONE="europe-west1-b"
STANDBY_VM="alpha-edge-standby"

echo "[GCLOUD] Provisioning Warm Standby e2-medium in zone: $STANDBY_ZONE (Belgium)..."
if gcloud compute instances describe "$STANDBY_VM" --zone="$STANDBY_ZONE" >/dev/null 2>&1; then
    echo "[WARN] VM instance '$STANDBY_VM' already exists."
else
    gcloud compute instances create "$STANDBY_VM" \\
        --zone="$STANDBY_ZONE" \\
        --machine-type="e2-medium" \\
        --image-family="debian-11" \\
        --image-project="debian-cloud" \\
        --metadata=startup-script="sudo apt-get update && sudo apt-get install -y python3 python3-pip git && pip3 install python-dotenv urllib3" \\
        --scopes="https://www.googleapis.com/auth/cloud-platform" \\
        --tags="ib-gateway-standby" \\
        --description="Alpha Engine Warm Standby node in europe-west1 (Belgium)"
fi

echo "[SSH] Deploying to Warm Standby..."
gcloud compute scp /tmp/alpha-workspace-bundle.tar.gz "$STANDBY_VM":~/alpha-workspace-bundle.tar.gz --zone="$STANDBY_ZONE" --quiet
gcloud compute scp remote_vm_setup.sh "$STANDBY_VM":~/remote_vm_setup.sh --zone="$STANDBY_ZONE" --quiet
gcloud compute ssh "$STANDBY_VM" --zone="$STANDBY_ZONE" --command="chmod +x ~/remote_vm_setup.sh && ~/remote_vm_setup.sh" --quiet

# Teardown local temporary deployments"""
text = text.replace('# Teardown local temporary deployments', belgium_logic)

# Replace top descriptions
text = text.replace('e2-micro Spot instance', 'Standard e2-medium instance')
text = text.replace('~$1.64/month (Spot VM instance)', '~$30/month (Standard VM)')

with open("deploy_to_gcp.sh", "w", newline='\n', encoding="utf-8") as f:
    f.write(text)

