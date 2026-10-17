# Google Cloud Platform (GCP) Low-Latency Infrastructure Setup Guide

This guide details the deployment of the **Alpha Engine Hybrid Framework** onto Google Cloud, prioritizing two critical targets:
1. **Ultra-Low Latency (<1.2ms):** Deploying the Python Edge Node in Frankfurt (`europe-west3`) directly adjacent to the IBKR European execution backbone (Equinix FR2).
2. **Minimal Operational Budget (<$2/month):** Utilizing a Google Cloud Run server (scaling to 0 when idle) and a preemptible/Spot Google Compute Engine (GCE) micro-instance.

---

## 🏗️ Two-Tier Hybrid Architecture

```
                    ┌──────────────────────────────────────┐
                    │       Google Cloud Run (Web Server)  │
                    │       - Hosts Dashboard UI && APIs   │
                    │       - Automatically scales to Zero │
                    │       - Cost: $0.00/mo (Free Tier)   │
                    └──────────────────┬───────────────────┘
                                       │ Real-time Bi-directional Event Stream
                                       ▼ (Via Secure Firestore Tunnel)
┌───────────────────────────────────────────────────────────────────────────────────┐
│        GCP Compute Engine e2-micro Spot Instance (Frankfurt europe-west3)         │
│        - Runs 'local_edge_node.py' continuous execution daemon                     │
│        - Connects to IB Gateway or TWS workstation over low-latency socket         │
│        - Direct fiber link to IBIE Trading Router                                  │
│        - Cost: ~$1.64/mo (Preemptible/Spot) | Log-rotated systemd service           │
└──────────────────────────────────────┬────────────────────────────────────────────┘
                                       │ Native Socket / REST
                                       ▼ (<1ms Latency)
                    ┌──────────────────────────────────────┐
                    │      IBKR Pro Ireland (IBIE) API     │
                    └──────────────────────────────────────┘
```

---

## 🛠️ Step-by-Step Deployment Pipeline

### Step 1: Initialize Cloud Command Console
Open your desktop browser, navigate to the **Google Cloud Console** ([console.cloud.google.com](https://console.cloud.google.com)), select your project, and click the terminal icon in the top right to start the **GCP Cloud Shell** (which is 100% free).

### Step 2: Auto-Provision Cloud Infrastructure (The Automated Way)
To make configuration completely flawless, we have created an automated deployment script `deploy_to_gcp.sh` directly in your workspace. You can run it right inside your Cloud Shell with a single command:

```bash
# Clone your private synced repository
git clone https://github.com/YOUR_GITHUB_ORGANIZATION/alpha-engine.git
cd alpha-engine

# Make script executable & deploy both tiers in 60 seconds
chmod +x deploy_to_gcp.sh
./deploy_to_gcp.sh
```

---

## 🎛️ Manual Construction Steps (For Reference)

If you prefer to command-line construct your instances step-by-step, use these standard optimized presets:

### 1. Provisioning the Low-Cost Compute Instance (Frankfurt `europe-west3`)
Run the following `gcloud` command to spin up an `e2-micro` Preemptible/Spot instance. Using Spot pricing reduces Compute bills by **75%**, bringing costs down to just **$1.64/month**.

```bash
gcloud compute instances create alpha-edge-node \
    --zone=europe-west3-a \
    --machine-type=e2-micro \
    --preemptible \
    --image-family=debian-11 \
    --image-project=debian-cloud \
    --metadata=startup-script="sudo apt-get update && sudo apt-get install -y python3 python3-pip git && pip3 install python-dotenv urllib3" \
    --description="Alpha Engine High Frequency Execution node in ultra-low latency proximity to IBKR Ireland"
```

### 2. Configure Node Daemon as a `systemd` Service
To prevent VM terminations or process crashes from disrupting live trading logs, configure python node execution as a self-healing background system service.

Create `/etc/systemd/system/alpha-edge.service`:
```ini
[Unit]
Description=Alpha Engine Edge Client Daemon
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/alpha-engine
ExecStart=/usr/bin/python3 main.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```
Activate and launch daemon:
```bash
sudo systemctl daemon-reload
sudo systemctl enable alpha-edge
sudo systemctl start alpha-edge
```

---

## 🏦 Monthly GCP Financial Breakdown (Under €2.00)

| GCP Component | Profile | Operational Cost Model | Monthly Bill |
| :--- | :--- | :--- | :--- |
| **Cloud Run Webplane** | Auto-scaling to `min-instances: 0` | Paused during market close | **$0.00** |
| **Compute Engine Edge** | `e2-micro` Spot VM in `europe-west3-a` | Preemptible instance pricing | **$1.64** |
| **Firestore Database** | Cloud storage configuration | 50,000 daily read limits free | **$0.00** |
| **Total Cloud Overhead** | **Full-Stack Proximity Setup** | Maximum Efficiency Ratio | **~$1.64 / month** |
