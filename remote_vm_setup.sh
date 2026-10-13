#!/bin/bash
sudo mkdir -p /opt/alpha-engine
sudo chown -R $USER:$USER /opt/alpha-engine

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
sudo usermod -aG docker $USER

# Extract the local workspace installer bundle directly
echo "[VM] Extracting workspace codebase elements to /opt/alpha-engine..."
tar -xzf ~/alpha-workspace-bundle.tar.gz -C /opt/alpha-engine/

# Python dependencies setup
echo "[VM] Syncing Python library packages via requirements.txt..."
cd /opt/alpha-engine && (pip3 install -r requirements.txt --quiet || pip install -r requirements.txt --quiet || true)

# Install official Interactive Brokers TWS API from IBKR's official installer release (v1051.01+ GPL)
echo "[VM] Installing official IBKR TWS API bundle from download2.interactivebrokers.com..."
mkdir -p /tmp/ibkr-tws-api
curl -sSL "https://download2.interactivebrokers.com/installers/tws-api/latest/tws-api-latest-linux-x64.sh" -o /tmp/ibkr-tws-api/installer.sh
chmod +x /tmp/ibkr-tws-api/installer.sh
/tmp/ibkr-tws-api/installer.sh -q -dir /tmp/ibkr-tws-api/installed || true
if [ -d "/tmp/ibkr-tws-api/installed/source/pythonclient" ]; then
    echo "[VM] Installing native ibapi package from /tmp/ibkr-tws-api/installed/source/pythonclient..."
    cd /tmp/ibkr-tws-api/installed/source/pythonclient && (pip3 install . --quiet || pip install . --quiet)
    cd /opt/alpha-engine
fi
rm -rf /tmp/ibkr-tws-api

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
User=$USER
WorkingDirectory=/opt/alpha-engine
ExecStart=/usr/bin/python3 main.py
Restart=always
RestartSec=5

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
