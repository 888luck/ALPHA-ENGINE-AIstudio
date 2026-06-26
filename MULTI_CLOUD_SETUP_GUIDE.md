# Institutional Multi-Cloud Low-Latency Setup & Deployment Guide

This guide details the deployment of the **Alpha Engine Hybrid Framework** onto institutional cloud infrastructure. It prioritizes two critical parameters:
1. **Ultra-Low Execution Latency (<1.2ms):** Placing the Python Edge Node in Frankfurt co-located or physically adjacent to the IBKR European execution backbone (Equinix FR2).
2. **Zero-Jitter Dedicated Compute:** Eliminating hyperthread scheduling latency for precision order book integration.

---

## 🏗️ Two-Tier Hybrid Architecture

The Alpha Engine operates as a high-frequency, two-tier hybrid setup:

```
                      ┌──────────────────────────────────────┐
                      │       Dynamic Web Control Interface  │
                      │       - Cloud Run or Web Host (UI)   │
                      │       - Automatically scales to Zero │
                      │       - Cost: $0.00/mo (Free Tier)   │
                      └──────────────────┬───────────────────┘
                                         │ Real-time Bi-directional Event Stream
                                         ▼ (Via Secure Firestore Tunnel)
 ┌───────────────────────────────────────────────────────────────────────────────────┐
 │       Frankfurt Co-Located Compute Instance (Hetzner / GCP / AWS / SSH)           │
 │       - Runs 'local_edge_node.py' continuous execution daemon                     │
 │       - Connects to IB Gateway or TWS workstation over low-latency socket         │
 │       - Direct fiber link to IBIE Trading Router                                  │
 │       - Cost: €3.79 - €19.90/mo (Spot VM / Dedicated Core options)                │
 └──────────────────────────────────────┬────────────────────────────────────────────┘
                                        │ Native Socket / REST
                                        ▼ (<1ms Latency)
                      ┌──────────────────────────────────────┐
                      │      IBKR Pro Ireland (IBIE) API     │
                      └──────────────────────────────────────┘
```

---

## 🌩️ Cloud Provider Comparison & Strategic Selection

### 1. Hetzner Cloud (Frankfurt FSN1) — *Recommended for Professional & Institutional Execution*
*   **Infrastructure Advantage:** Hetzner operates a premier green datacenter hub in Falkenstein/Frankfurt with direct high-speed multi-gigabit peerings to DE-CIX and Equinix FR2. 
*   **Agnostic Jitter Elimination:** Unlike public hyperscalers that share physical hardware threads (leading to execution noise or "noisy neighbor" scheduling jitter), Hetzner's **Dedicated CPU (CCX)** line guarantees physical vCPU pins.
*   **Cost Efficiency:** 
    *   **Shared Core (`CX22` / `CPX21`):** €3.79 - €5.30/mo (Outstanding starting profile).
    *   **Dedicated Core (`CCX22`):** €19.90/mo (Absolute zero scheduling latency, highest execution level).

### 2. Google Cloud Platform (Frankfurt `europe-west3`) — *Best for Zero-Cost Starter Sandbox*
*   **Infrastructure Advantage:** Highly integrated into Google's global private fiber network.
*   **Cost Profile:** ~$1.64/mo when deploying an `e2-micro` Spot/Preemptible instance.
*   **Trade-off:** Spot instances can be terminated arbitrarily by GCP with a 30-second warning, and shared `e2-micro` cores experience significant CPU cycle throttling under heavy Order Flow Imbalance (OFI) calculations.

### 3. Amazon Web Services (Frankfurt `eu-central-1`) — *Standard Corporate Integration*
*   **Infrastructure Advantage:** Excellent security compliance.
*   **Cost Profile:** ~$3.20/mo for a shared `t4g.micro` On-Demand instance.

---

## 🛠️ Automated Deployment Pipelines

### Option A: Hetzner Cloud / Universal Linux (Zero-Touch SSH Deployment)
To deploy the Python Edge daemon onto a newly created Debian or Ubuntu server in Hetzner Cloud, run the unified SSH deployer from your local terminal or workspace:

```bash
# Make the deployment script executable
chmod +x deploy_to_hetzner.sh

# Deploy directly via SSH to your server IP
./deploy_to_hetzner.sh <YOUR_SERVER_IP>
```
*The script automatically packages your workspace files, pushes them to the server, installs Docker, creates an isolated environment, and registers the self-healing systemd service.*

---

### Option B: Google Cloud Platform (Google Cloud Shell Deployment)
To deploy using Google's Cloud Shell platform (which is 100% free), run the preconfigured `deploy_to_gcp.sh` script:

```bash
# Make the script executable
chmod +x deploy_to_gcp.sh

# Run the automated deployment sequence
./deploy_to_gcp.sh
```
*The script configures Firebase credentials, enables Cloud platform APIs (`aiplatform` & `firestore`), spins up a low-cost Spot VM, and configures the `alpha-engine.service` systemd daemon.*

---

## 🎛️ Controlling the Remote Daemon Processes

Once deployed to your VM (regardless of the chosen cloud provider), the Python execution daemon runs as a standard self-healing service. SSH into your VM and run:

```bash
# Check running status and active OFI signals logs
sudo systemctl status alpha-engine.service -n 50

# Restart the service (loads latest config or code pull)
sudo systemctl restart alpha-engine.service

# Follow real-time market stream & routing outputs in the terminal
journalctl -u alpha-engine.service -f
```

---

## 🏛️ Financial Budget Matrix

| Cloud Provider | Instance Class | CPU Configuration | Monthly Budget | Execution Grade |
| :--- | :--- | :--- | :--- | :--- |
| **Hetzner Cloud** | `CX22` Shared | 2 AMD EPYC (Shared) | **~€3.79** | **Professional** |
| **Hetzner Cloud** | `CCX22` Dedicated | 2 Dedicated vCPUs | **~€19.90** | **Institutional (Zero Jitter)** |
| **Google Cloud** | `e2-micro` Spot | Shared (Throttlable) | **~$1.64** | **Sandbox / Dev** |
| **AWS EC2** | `t4g.micro` Spot | Burstable Shared | **~$1.20** | **Sandbox / Dev** |
