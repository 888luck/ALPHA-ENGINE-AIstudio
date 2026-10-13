#!/bin/bash
sudo mkdir -p /opt/alpha-engine
sudo chown -R root:root /opt/alpha-engine

echo "[VM] Ensuring required system packages & Docker are installed..."
sudo apt-get update
sudo apt-get install -y python3 python3-pip python3-venv git docker.io

if ! swapon --show | grep -q "/swapfile"; then
    echo "[VM] Establishing 2GB swapfile..."
    if [ ! -f /swapfile ]; then
        sudo fallocate -l 2G /swapfile || sudo dd if=/dev/zero of=/swapfile bs=1M count=2048
        sudo chmod 600 /swapfile
        sudo mkswap /swapfile
    fi
    sudo swapon /swapfile || true
fi

sudo systemctl enable docker
sudo systemctl start docker

echo "[VM] Cloning repository..."
cd /opt
if [ -d "alpha-engine/.git" ]; then
    cd alpha-engine
    sudo git reset --hard
    sudo git pull origin main
else
    sudo rm -rf alpha-engine
    sudo git clone https://github.com/888luck/ALPHA-ENGINE-AIstudio alpha-engine
fi

cd /opt/alpha-engine
echo "[VM] Syncing Python library packages via requirements.txt..."
sudo pip3 install -r requirements.txt --quiet --break-system-packages || sudo pip3 install -r requirements.txt --quiet

echo "[VM] Pulling production secrets from Secret Manager into memory-backed /dev/shm..."
sudo gcloud secrets versions access latest --secret="alpha-engine-env" > /tmp/alpha-engine.env
sudo mv /tmp/alpha-engine.env /dev/shm/alpha-engine.env
sudo chmod 400 /dev/shm/alpha-engine.env
sudo ln -sf /dev/shm/alpha-engine.env /opt/alpha-engine/.env

echo "[VM] Creating systemd service..."
sudo tee /etc/systemd/system/alpha-engine.service > /dev/null <<SERVICE
[Unit]
Description=Alpha Engine Edge trading daemon
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/alpha-engine
ExecStart=/usr/bin/python3 main.py
Restart=always
RestartSec=5
WatchdogSec=30

[Install]
WantedBy=multi-user.target
SERVICE

sudo systemctl daemon-reload
sudo systemctl enable alpha-engine.service
sudo systemctl restart alpha-engine.service

echo "[VM] Deployment complete!"
