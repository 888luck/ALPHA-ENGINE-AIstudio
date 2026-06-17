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

## 🛠️ 2. Core Prerequisite & Infrastructure Requirements

Before deploying and launching the Alpha Engine, ensure that all required cloud accounts, APIs, credentials, and broker access levels are fully provisioned and active.

### A. Infrastructure & Cloud Architecture Prerequisites
1. **Google Cloud Project (GCP):**
   - Active billing enabled (supporting serverless Cloud Run and GCE preemptible instances).
   - Installed `gcloud` CLI tool configured on your local development workspace or Cloud Shell.
2. **Firestore (NoSQL Database):**
   - A Firestore instance initialized in **Native Mode**.
   - Read/write permissions are handled keylessly via GCE Instance Service Accounts—no manual private JSON credential files or custom configurations are needed.

### B. Broker Access & Data Feed Prerequisites
1. **Interactive Brokers (IBKR) Pro account:**
   - Active subscription supporting trading and socket automation.
   - Subscribed real-time market data packages (e.g., *NASDAQ (Level 2/TotalView)*, *NYSE (OpenBook)*, or *OPRA options*) to enable dynamic, high-frequency Level 2 Order Flow Imbalance (OFI) calculations.
2. **Headless Gateway License / Subscriptions:**
   - Interactive Brokers Client Portal or TWS configuration enabling "ActiveX and Socket Clients" with trusted loopback binding.
   - Credentials configured inside your local `.env` or injected during container execution (Method B).

---

## ⚡ 3. Mid-Term Production Standard: Vertex AI & API Lifecycles

While initial prototyping or sandboxed development utilizes the **Google AI Studio Developer Key** for frictionless setup, enterprise-level production requires transitioning to **Google Cloud Vertex AI**.

### A. Why Vertex AI is the Production Standard?
- **IAM-Based Authentication (Keyless Security):** Bypasses the danger of insecure API key text exposures in databases or codebases. The Cloud Run service and GCE Edge VM authenticate seamlessly using automatic **GCP Metadata Service Account credentials** (ADC).
- **Resource SLA & High-Throughput Quotas:** Provides guaranteed throughput quotas, lower rate-limit barriers, and isolated execution paths in specific geographic regions.
- **Enterprise-Grade Compliance:** Private data processing guarantees, assuring proprietary prompt vectors and market heuristics are never cached or used for public foundation model tuning.

### B. Vertex AI SDK Configuration (`server.ts` transition)
To adapt the Express backend from the default standard SDK (`@google/genai`) to Vertex AI, initialize using the native GCP authorization structures in production:
```ts
// server.ts - Mid-Term Production Vertex AI Implementation pattern
import { GoogleGenAI } from "@google/genai";

const projectId = process.env.GOOGLE_CLOUD_PROJECT || "your-production-project-id";
const region = "europe-west3"; // Adjacent to the edge GCE VM

// Authenticates instantly via GCP metadata inside Cloud Run
const ai = new GoogleGenAI({
  vertex: {
    projectId,
    location: region
  }
});
```

### C. Critical Gemini Model Lifecycles (Sunset & Migration Targets)
Model deprecations happen fast. To design a future-proof, stable trading daemon, you must migrate accordingly:
- **Legacy Sandboxes:** Gemini 1.5 Flash (legacy API) is entering structured retirement. Gemini 2.0 Flash is fully deprecated and sunset on June 1, 2026.
- **Production Standard Support:** Upgrade and hardcode dependencies strictly to the **Gemini 2.5 and 3.x families** (specifically, `gemini-2.1-flash` and `gemini-3.5-flash` or newer versions), which are stable, carry extended lifecycles, and exhibit higher pricing efficiencies (typically $0.075 / million input tokens, with high context window limits of up to 2M).

---

## 📊 4. Automated Geopolitical & Macro Sector AI Calibrator

The Geopolitical Calibrator dynamically shifts the OFI asset baskets from static, brittle presets into high-relevance economic portfolios based on real-time news streams.

### A. Professional Data Feeds & Sourcing Automation
To achieve institutional calibration accuracy, the system leverages a multi-feed ingester pipeline:
1. **Financial Wire Headlines Feed:**
   - Automates background polling of Bloomberg Financial RSS feeds, Reuters Business wires, or Wall Street Journal markets RSS via a modular Python worker running `feedparser` every 5 minutes inside a background thread pool.
2. **Interactive Brokers News API:**
   - Hooks into native gateway execution callbacks (`reqHistNewsHeadlines`) to receive streaming real-time Dow Jones News Headlines, filtering on major tickers or global policy indices.
3. **Macroeconomic Calendar API:**
   - Integrates with free or premium calendar feeds (e.g., TradingEconomics or DailyFX) to ingest real-time indicator events (CPI, FOMC, ECB Decisions, Non-Farm Payrolls).

### B. High-Frequency Edge Sentiment & Basket Analysis
Raw headline text is processed through a fast, co-located multi-stage pipeline:
```
[Streaming Headlines] --> [spaCy Entity Recognition] --> [FinBERT Sentiment scoring] --> [Vertex AI Gemini Macro Scoring] --> [dynamic_baskets.json]
```
1. **Named-Entity Recognition (NER):** Runs a lightweight local `spaCy` task to extract key geopolitical players, countries (e.g., "Iran", "Suez Canal", "Taiwan"), or commodities.
2. **FinBERT Local Sentiment Inference:** Applies a fast transformer model on the VM's local CPU to output a continuous sentiment score $[-1.0, 1.0]$ for specific sectors in under 150ms per headline.
3. **Vertex AI Gemini Calibration Engine:** Once sentiment spikes cross a standard deviation threshold, a structured JSON prompt is dispatched to `gemini-3.5-flash` to map the macroeconomic news event to exact liquid ETF/equity tickers and recalibrate order flow coefficients.
4. **Economic Blockades & Circuit Overrides:** If a high-impact macroeconomic event (like NFP or FOMC) is detected within the 15-minute window, the pipeline automatically forces a trading signal "Blanking State." This temporarily suspends edge matching routines to shield capital from sudden liquidity gaps and spread spikes.

---

## 🔑 5. Required Environment Variables

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

## 🏝️ 6. How to Deploy & Update the Edge Node (Continuous Sync Runbook)

Alpha Engine features a unidirectional **Push-Then-Pull** staging pipeline to securely update VM logic and strategy variables. Follow these operational steps to build, sync, and deploy.

### Operational Step 1: Push Local Modifications to GitHub
1. Create your own repository on GitHub (e.g. `your_org/ALPHA-ENGINE-AIstudio`).
2. Navigate to the **🦊 GIT DIRECT SYNC** tab in the running App dashboard.
3. Input your repository path and your GitHub Personal Access Token (PAT).
4. Click **TRANSMIT FILES**. This executes a secure server-side push, committing your exact local workspace state directly to your branch.

### Operational Step 2: Access Cloud Shell & Pull Latest Code
1. Open the Google Cloud Console ([console.cloud.google.com](https://console.cloud.google.com)) and activate **Cloud Shell**.
2. If this is your first time deploying, clone the newly populated repository:
   ```bash
   git clone https://github.com/your_org/ALPHA-ENGINE-AIstudio.git
   cd ALPHA-ENGINE-AIstudio
   ```
3. If the VM is already running, navigate to your folder and pull the latest changes pushed from the dashboard:
   ```bash
   cd ALPHA-ENGINE-AIstudio
   git pull origin main
   ```

### Operational Step 3: Run the Automated GCP Deployer Script
1. Trigger the automated companion deployer:
   ```bash
   chmod +x deploy_to_gcp.sh
   ./deploy_to_gcp.sh
   ```
2. The script auto-detects your active GCP Project, enables required APIs (Firestore && Vertex AI), provisions or verifies the VM spot instance in **Frankfurt (`europe-west3-a`)**, attaches secure IAM scopes keylessly, installs system dependencies, and launches the trading node.

### Operational Step 4: Daemon Management & Telemetry Verification
To manage and inspect the trading node daemon inside the GCE Linux system, SSH into the VM (via gcloud or the GCP console panel) and execute:

* **View live service status:**
  ```bash
  sudo systemctl status alpha-engine.service
  ```
* **Follow live trading execution output logs:**
  ```bash
  sudo journalctl -u alpha-engine.service -f --no-tail
  ```
* **Restart the execution loop after changes:**
  ```bash
  sudo systemctl restart alpha-engine.service
  ```
* **Manually trigger manual edge client boot for debugging:**
  ```bash
  cd /opt/alpha-engine && python3 main.py
  ```

---

## 🐳 7. Interactive Brokers Gateway Headless Setup (Method B)

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

## 📊 8. Quantitative Strategy Specifications

The **Alpha Intraday Strategy** executes based on clear, math-bound constraints:

* **SMA-20 Congruence:** Checks simple moving averages on daily or intraday frequencies to set trend direction (Long above, Short below).
* **OFI Breakout Signal:** Volume expansion spike exceeding $1.4\times$ the 10-period volume MA acts as a breakout trigger.
* **1% Capital Risk Constraint:** The position size must be dynamically sized so that the distance to the stop price risks at most **1%** of total cumulative capital.
* **ATR-Based Stop-Loss (1.8 ATR):** Stops are placed at $1.8\times$ ATR from entry price, with targets configured at $2\times$ that distance.
* **15% Transaction Friction Filter:** To protect capital under IBKR Europe (IBIE) regulatory commissions structures:
  $$\text{Efficiency Ratio} = \frac{\text{Projected Friction (Spread Slippage + } 2\times\text{ Commission)}}{\text{Projected Max Profit (2.0 } \times \text{ Stop Distance)}} \times 100$$
  If the Efficiency Ratio exceeds **15%**, the trade MUST be rejected at the router.

---

## 🧑‍💻 9. Local Quickstart (Development Mode)

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

## 📁 10. Codebase Directory Structure

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
