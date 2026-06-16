# 🚀 Alpha Engine - Hybrid Trading Core & Cloud Orchestrator

Alpha Engine is a high-performance **two-tier hybrid trading platform** designed for quantitative intraday market analysis, real-time Order Flow Imbalance (OFI) tracking, and automated pool-equity risk controls. 

The system couples a modern React state dashboard with an edge execution runner co-located dynamically adjacent to the Interactive Brokers (IBKR) Europe Core Hub in Frankfurt, secured via direct synchronizing Firestore tunnels.

---

## 📈 1. System Architecture Blueprint

```
                     +---------------------------------------+
                     |         Google Cloud Run              |
                     |  (Frontend & Control Plane Dashboard) |
                     +-------------------+-------------------+
                                         |
                       Secure WebSockets | REST API JSON Payload
                                         v
                     +-------------------+-------------------+
                     |       Google Cloud Firestore          |
                     |  (Real-Time Database Secure Tunnel)   |
                     +-------------------+-------------------+
                                         |
                     Automated Syncer    | Native Python HTTP REST Calls
                     (Bi-directional)    v
+----------------------------------------+-----------------------------------------+
|                                  GCP linux VM Node                               |
|                            (europe-west3-a Frankfurt, Germany)                    |
|                                                                                  |
|  +----------------------------------+     +-----------------------------------+  |
|  |     Headless Docker Container    |     |      Alpha Edge Execution Node     |  |
|  |     (IBKR Gateway via IBC Loop)  |     |   (main.py + local_edge_node.py)  |  |
|  +-----------------+----------------+     +-----------------+-----------------+  |
|                    |                                        |                    |
|                    +------------------ TCP 4001/4002 -------+                    |
+----------------------------------------------------------------------------------+
```

1. **Vite + Express Web Dashboard (Frontend Hub):**
   * Serves as the centralized command monitor, quantitative backtesting terminal, and live risk-state controller.
   * Runs as a fully optimized Docker container on **Google Cloud Run** to capture serverless scale-to-zero efficiency (yielding $0 maintenance overhead during exchange market holidays).
   * Binds dynamically to external requests on port `3000`.

2. **Edge Execution Node (Python Daemon VM):**
   * Deployed on a high-availability preemptible/Spot **Google Compute Engine (GCE) e2-micro** instance.
   * Region-locked specifically to **Frankfurt, Germany (`europe-west3-a`)** to establish ultra-low fiber loop latency (typically ~1.12ms) co-located near the Equinix FR2 IBKR Hub.
   * Translates active trading state, pool balances, and circuit breaker lockdowns smoothly via fire-and-forget REST calls directly to Cloud Firestore.

---

## 🔑 2. Required Environment Variables

To operate the entire system correctly, separate settings are required for the web server level and the Python edge trading node level.

### A. Web API Server (`.env` inside Root Directory)

Create a `.env` file in the root workspace to power the Express backend and Vite hot-reloading context:

| Variable Name | Description | Example Target Value |
| :--- | :--- | :--- |
| `GEMINI_API_KEY` | Required to process text extracts, systemic risk analysis, and macro commentary. | `AIzaSyD-xxxxxxxxxxxxxx` |
| `APP_URL` | The current deployment endpoint URL, used for GitHub workspace syncing. | `https://your-cloud-run.a.run.app` |
| `NODE_ENV` | Production vs. development runtime toggle mode. | `production` |

### B. Python Edge Trading Node (`.env` inside Edge VM or Local Folder)

The Python daemon imports execution parameters dynamically at module load time via `config_loader.py`:

| Variable Name | Description | Default / Example Value |
| :--- | :--- | :--- |
| `IBKR_ACCOUNT_NUMBER` | Target Interactive Brokers Account ID (Regulated under CBI / European laws). | `U8129384` |
| `IBKR_HOST` | Loopback socket address hosting the local headless IBKR Gateway engine. | `127.0.0.1` |
| `IBKR_PORT` | Port socket used. Paper simulations execute on `4002`; live execution utilizes `4001`. | `4002` |
| `IBKR_CLIENT_ID` | Socket ID assigned, ensuring concurrent access doesn't override session locks. | `10` |
| `MIFID2_DECISION_MAKER_ID` | Regulatory identifier designating the algorithm decision controller. | `ALGO_DEC_992` |
| `MIFID2_EXECUTION_TRADER_ID` | Regulatory identifier designating compliance execution reporting shortcodes. | `ALGO_EXE_554` |
| `FIREBASE_PROJECT_ID` | Target GCP project identifier supporting the direct FireStore database link. | `your-firebase-project-id` |
| `FIREBASE_API_KEY` | Public authorization token for Firestore REST actions (copied from configuration file). | `AIzaSyA-xxxxxxxxxxxxxx` |
| `FIREBASE_DATABASE_ID` | Custom database target instance (leave blank or use `(default)`). | `(default)` |

---

## 🏝️ 3. How to Deploy the Edge Node Node on GCP (Frankfurt)

Follow one of the two methods below to spin up the low-latency edge node in Frankfurt for under **$1.80/month**.

### Method A: No-Git / Direct Workspace ZIP Upload (Easiest & Fastest 🌟)

You do not need a GitHub repository for this to work. Our deployment script compiles and moves your exact workspace files directly to the GCP VM.

1. **Download Workspace ZIP:** In your AI Studio project interface, open the settings menu (or project options) and click **Export to ZIP** to download the static codebase.
2. **Access Cloud Shell:** Open the Google Cloud Console ([console.cloud.google.com](https://console.cloud.google.com)) and click the **Activate Cloud Shell** button (terminal icon) in the top-right toolbar.
3. **Upload ZIP File:** Click the `More` menu icon (three dots) in the Cloud Shell toolbar and click **Upload File**. Select your exported ZIP file.
4. **Extract and Run Deployer:** Run the following commands in Cloud Shell to extract your files and deploy them directly:
   ```bash
   mkdir alpha-engine
   unzip *.zip -d alpha-engine
   cd alpha-engine
   chmod +x deploy_to_gcp.sh
   ./deploy_to_gcp.sh
   ```

---

### Method B: Deploying via your Own GitHub Repository

If you prefer using your GitHub repository, you **must create the repository on GitHub first** before cloning or syncing.

1. **Create Repository:** Go to [GitHub](https://github.com) and create a **new** repository named `ALPHA-ENGINE-AIstudio` (public or private).
2. **Push Code to Repository:** Open the **🦊 GIT DIRECT SYNC** tab in the dashboard of your running App, fill in your repository path (`888luck/ALPHA-ENGINE-AIstudio`), input your GitHub Personal Access Token (PAT), and click **TRANSMIT FILES**. This pushes your workspace code directly to your new repository.
3. **Run from Cloud Shell:** Once the repository is populated, open your Google Cloud Shell:
   ```bash
   git clone https://<your_username>:<your_token>@github.com/888luck/ALPHA-ENGINE-AIstudio.git
   cd ALPHA-ENGINE-AIstudio
   chmod +x deploy_to_gcp.sh
   ./deploy_to_gcp.sh
   ```

---

### What this Automated Script Executes:
1. **Credentials Extraction:** Reads your workspace `firebase-applet-config.json` to configure the Python-to-Firestore Secure Tunnel.
2. **GCLOUD VM Provisioning:** Creates an `e2-micro` Spot Instance in `europe-west3-a` (Frankfurt, Germany) with auto-installation of Python, Git, and Pip.
3. **Workspace Syncing:** Pulls the codebase to `/opt/alpha-engine` inside the VM.
4. **Environment Generation:** Securely writes environment variables into `/opt/alpha-engine/.env` to link system state directly to Firestore.
5. **Systemd Daemon Establishment:** Sets up an `alpha-engine.service` system background process that starts the daemon immediately on VM boot and restarts it automatically in case of execution errors.

### Step 3: Monitor Linux Service Execution Logs
To verify that the service is active, execute the standard systemd monitoring output command inside your new GCE Virtual Machine:

```bash
sudo systemctl status alpha-engine.service
sudo journalctl -u alpha-engine.service -f --no-tail
```

---

## 🐳 4. Interactive Brokers Gateway Headless Setup (Method B)

To run the system without a native desktop UI window, configure the headless Docker gateway wrapper inside your cloud virtual machine instance.

```bash
# Pull and execute the custom IBC-wrapped headless virtual framebuffer
docker run -d --name ibkr-ibc-gateway \
  -e IB_USER="your_ibkr_username" \
  -e IB_PASSWORD="your_ibkr_password" \
  -p 4001:4001 -p 4002:4002 \
  888luck/ibkr-headless-gateway:latest
```

Once running, the Edge Node communicates with this container on `127.0.0.1:4001` (Live) or `127.0.0.1:4002` (Paper Simulation), sending orders and listening for execution and account summaries dynamically.

---

## 📊 5. Quantitative Strategy Specifications

The **Alpha Intraday Strategy** executes based on clear, math-bound constraints:

* **SMA-20 Congruence:** Checks simple moving averages on daily or intraday frequencies to set trend direction (Long above, Short below).
* **OFI Breakout Signal:** Volume expansion spike exceeding $1.4\times$ the 10-period volume MA acts as a breakout trigger.
* **1% Capital Risk Constraint:** The position size must be dynamically sized so that the distance to the stop price risks at most **1%** of total cumulative capital.
* **ATR-Based Stop-Loss (1.8 ATR):** Stops are placed at $1.8\times$ ATR from entry price, with targets configured at $2\times$ that distance.
* **15% Transaction Friction Filter:** To protect capital under IBKR Europe (IBIE) regulatory commissions structures:
  $$\text{Efficiency Ratio} = \frac{\text{Projected Friction (Spread Slippage + } 2\times\text{ Commission)}}{\text{Projected Max Profit (2.0 } \times \text{ Stop Distance)}} \times 100$$
  If the Efficiency Ratio exceeds **15%**, the trade MUST be rejected at the router.

---

## 🧑‍💻 6. Local Quickstart (Development Mode)

### 1. Install Dependencies
```bash
npm install
```

### 2. Launch Local Control Panel (Vite + Express Fullstack Server)
```bash
npm run dev
```
Operates the Node control interface instantly on `http://localhost:3000`.

### 3. Run Strategy Backtester Script (Python Simulation Engine)
```bash
python3 backtester.py [TICKER] [TIMEFRAME] [START_DATE] [END_DATE]
# Example:
python3 backtester.py XLE 1h 2026-05-01 2026-06-16
```
This generates a mock JSON output detailing equity curves, win rates, and final commissions.

---

## 📁 7. Codebase Directory Structure

```
├── .env.example              # Example environment keys template
├── AGENTS.md                 # System-wide framework and build rules
├── backtester.py             # Quantitative backtester python model
├── config_loader.py          # Environment key loaders for the Edge Node
├── connection.py             # IBKR execution callbacks wrapper
├── deploy_to_gcp.sh          # Frankfurt e2-micro Spot deployer shell script
├── firebase_sync.py          # Direct REST Firestore secure tunnel client
├── local_edge_node.py        # Co-located daemon loop coordinator
├── main.py                   # Python entry point runner
├── package.json              # Front-end build tools & dependencies
├── server.ts                 # Express control plane & API router
└── src
    ├── App.tsx               # Main layout root context
    └── components
        ├── Dashboard.tsx     # Performance analytics UI
        └── GcpCompanion.tsx  # Cloud control & backtester panels
```
