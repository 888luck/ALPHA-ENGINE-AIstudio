# 🚀 Alpha Engine — Hybrid Quantitative Trading Framework

Alpha Engine is an institutional-grade, **two-tier hybrid trading platform** designed for quantitative intraday market analysis, real-time Order Flow Imbalance (OFI) tracking, and automated multi-layer risk controls. 

The system couples a visual, real-time React web control dashboard with a co-located Python execution runner situated adjacent to the Interactive Brokers (IBKR) Europe Core Hub in Frankfurt, Germany. The two tiers coordinate securely using a direct, bi-directional NoSQL data tunnel.

---

## 📈 1. High-Level Architecture (Simplified)

For a beginner, here is how the data flows in real-time without exposing your credentials:

```
+-------------------------------------------------------------+
|               1. GOOGLE CLOUD RUN (Web UI Dashboard)        |
|  - Visually configures risk boundaries & parameters         |
|  - Runs on-demand heavy simulations & backtests in the cloud|
|  - Keeps your Gemini API Key safely hidden in the backend   |
+------------------------------+------------------------------+
                               |
                   ⚡ Secure REST & WebSockets
                               |
                               v
+------------------------------+------------------------------+
|            2. GOOGLE FIRESTORE (Secure DB Cloud Tunnel)     |
|  - Acts as a real-time, zero-latency sync bridge             |
|  - Securely passes risk states & toggles to the edge node   |
+------------------------------+------------------------------+
                               |
                    📡 Firestore Event Listener
                               |
                               v
+------------------------------+------------------------------+
|              3. EDGE EXECUTION NODE (Frankfurt GCE VM)      |
|  - Co-located physically next to the IBKR Europe Exchange    |
|  - Processes real-time market data ticks under 2ms latency   |
|  - Handles orders, stops, and emergency circuit breakers    |
+-------------------------------------------------------------+
```

---

## ⭐️ 2. The 5-Minute Onboarding Guide (Perfect for Beginners)

If you are new to the Alpha Engine, here is a simple conceptual translation of how the system operates and how you can run it securely.

### Conceptual Translation
- **The Dashboard (Web UI)**: Think of this as your spacecraft's mission control panel. You use it to set boundaries (like how much money you're willing to lose in a day) and monitor trades.
- **The Edge Node (Python script)**: This is the pilot inside the spacecraft. It is placed as close to the target destination (Frankfurt) as possible so that it can receive signals instantly and execute trades in milliseconds.
- **The Circuit Breaker**: This is the emergency parachute. If the market behaves wildly and your daily loss crosses your preset threshold (e.g., 2.5% of your account or €1,500.00 cash), the engine **hard locks the router**, stops trading, and allows you to initiate a **Panic Flush** to exit all risk.

---

## ⏱️ 3. Step-by-Step Setup Runbook

Follow these sequential steps to launch the system.

### Step 1: Fire Up the Local Dashboard
Before pushing anything to the cloud, run the control panel on your computer to verify the layout:
1. Ensure Node.js is installed on your machine.
2. In your terminal, install dependencies:
   ```bash
   npm install
   ```
3. Start the local server:
   ```bash
   npm run dev
   ```
4. Open your web browser and go to `http://localhost:3000`. You will see the beautiful dark dashboard interface!

### Step 2: Configure Your Environment Credentials
To feed your settings securely to the system, set up your credentials:
1. Rename `.env.example` in the root folder to `.env`.
2. Open the file and enter your values:
   * **`GEMINI_API_KEY`**: Your Google AI Studio key to handle geopolitical calibrations and market commentary.
   * **`IBKR_ACCOUNT_NUMBER`**: Your Interactive Brokers Account ID (e.g., `U1234567`).
3. For the local GCE node, the configuration file resides on the virtual machine and connects securely to Firestore using:
   * **`FIREBASE_PROJECT_ID`**: Your Google Cloud project ID.
   * **`FIREBASE_API_KEY`**: Your Web API token used to secure database operations.

### Step 3: Run a Backtest to Validate Strategy
Never deploy a strategy without validating performance first:
1. In your dashboard, navigate to the **📊 QUANT BACKTESTER** tab inside the GCP Companion panel.
2. Pick an asset (e.g., `XLE` or `SPY`), select a timeframe, and hit **RUN SIMULATION**.
3. Recharts will instantly plot the dynamic equity curve, win-rate metrics, and transaction costs.
4. If you prefer using terminal commands, you can run:
   ```bash
   python3 backtester.py XLE 1h 2026-05-01 2026-06-16
   ```

### Step 4: Provision Your Frankfurt VM (Edge Node)
To achieve co-location next to IBKR Europe with ultra-low latency (< 2ms):
1. Push your local files to your GitHub repository by using the **🦊 GIT DIRECT SYNC** panel on your dashboard.
2. Open your GCP Cloud Shell and clone your repository:
   ```bash
   git clone https://github.com/your-username/alpha-engine.git
   cd alpha-engine
   ```
3. Run the automated setup script:
   ```bash
   chmod +x deploy_to_gcp.sh
   ./deploy_to_gcp.sh
   ```
4. This script automatically provisions a lightweight, budget-friendly GCE `e2-micro` VM, sets up system dependencies, secures credentials keylessly via service accounts, and boots up your continuous trading loop as a background service.

### Step 5: Activate Headless IBKR Gateway
To route orders to the exchange without running heavy desktop software on the VM, spin up the lightweight headless Docker container on the node:
```bash
docker run -d --name ibkr-ibc-gateway \
  -e IB_USER="your_ibkr_username" \
  -e IB_PASSWORD="your_ibkr_password" \
  -p 4001:4001 -p 4002:4002 \
  888luck/ibkr-headless-gateway:latest
```
* **Port 4002 (PAPER Simulation)**: Active connection endpoint for fake money simulations. (Always start here to test your setup safely!)
* **Port 4001 (LIVE Production)**: Active connection endpoint for real capital trading.

---

## 🛡️ 4. Risk Engineering & Compliance Standard

The Alpha Engine complies with strict risk limits. The dashboard offers premium interactive dials for managing capital exposure:

1. **SMA-20 Congruence**: Restricts signals to trade only in direction of the simple moving average trend (Long above, Short below).
2. **OFI Breakout Signal**: Breakout triggered only when order book imbalance volume expansion exceeds $1.4\times$ the 10-period volume MA.
3. **1% Capital Risk Limit**: The position size must be dynamically scaled so that the distance to your Stop-Loss represents at most **1%** of your total cumulative capital.
4. **ATR-Based Stop-Loss (1.8 ATR)**: Stops are automatically calculated at $1.8\times$ ATR from entry price, with targets configured at $2\times$ that distance.
5. **15% Transaction Friction Filter**: Protects capital under IBKR regulatory commission structures:
   $$\text{Efficiency Ratio} = \frac{\text{Projected Friction (Spread Slippage + } 2\times\text{ Commission)}}{\text{Projected Max Profit (2.0 } \times \text{ Stop Distance)}} \times 100$$
   If the Efficiency Ratio exceeds **15%**, the trade is automatically rejected.
6. **Daily Drawdown Circuit Breakers**:
   * **Percentage Limit**: Locks the router if account drawdown exceeds your custom limit (e.g., `2.5%`).
   * **Cash Limit (EUR)**: Locks the router if absolute cash losses exceed your custom limit (e.g., `€1,500.00`).
   * **Admin Overrides**: If the router locks, administrators can click the **ADMIN UNLOCK** button on the dashboard to override the circuit breaker and restore the router online once market risks have been assessed.
   * **Panic Flush Button**: Liquidates all open positions instantly in an emergency.

---

## 🔌 5. Cloud Environment Variables

### A. Web Server Environment (`.env` in Root Directory)
| Variable Name | Description | Example Target Value |
| :--- | :--- | :--- |
| `GEMINI_API_KEY` | Required to process AI geopolitical calibrations and macro commentary. | `AIzaSyD-xxxxxxxxxxxxxx` |
| `APP_URL` | The current deployment endpoint URL, used for GitHub workspace syncing. | `https://your-cloud-run.a.run.app` |
| `NODE_ENV` | Mode switch (production vs development). | `production` |

### B. Python Edge VM Environment (`.env` on Local VM Node)
| Variable Name | Description | Default / Example Value |
| :--- | :--- | :--- |
| `IBKR_ACCOUNT_NUMBER` | Target Interactive Brokers Account ID. | `U8129384` |
| `IBKR_HOST` | Loopback socket address hosting the local headless IBKR Gateway. | `127.0.0.1` |
| `IBKR_PORT` | `4002` for simulated paper trading; `4001` for live production. | `4002` |
| `FIREBASE_PROJECT_ID` | Target GCP project identifier supporting the direct Firestore sync link. | `your-firebase-id` |
| `FIREBASE_API_KEY` | Public authorization token for Firestore REST interactions. | `AIzaSyA-xxxxxxxxxxxxxx` |

---

## 📁 6. Codebase Directory Map

```
├── .env.example              # Example environment keys template
├── AGENTS.md                 # System-wide framework and build rules
├── backtester.py             # Quantitative backtester python model
├── config_loader.py          # Environment key loaders for the Edge Node
├── connection.py             # IBKR execution callbacks wrapper
├── deploy_to_gcp.sh          # Frankfurt e2-micro Spot deployer shell script
├── deploy_to_hetzner.sh      # Hetzner Cloud VM provisioner script
├── MULTI_CLOUD_SETUP_GUIDE.md# Multi-cloud setup guide (Hetzner vs. GCP)
├── firebase_sync.py          # Direct REST Firestore secure tunnel client
├── local_edge_node.py        # Co-located daemon loop coordinator
├── main.py                   # Python entry point runner
├── package.json              # Front-end build tools & dependencies
├── server.ts                 # Express control plane & API router
└── src
    ├── App.tsx               # Main layout root context & Help runbook
    └── components
        ├── Dashboard.tsx     # Performance analytics UI & Circuit Breaker visualization
        └── GcpCompanion.tsx  # Cloud control & backtester panels
```
