# 🗄️ Alpha Engine — Complete System Snapshot & Handover Manifest

This document serves as the absolute source of truth (the "Gold Standard" state blueprint) for the **Alpha Engine Hybrid Trading Framework**. It provides a comprehensive, self-contained overview of the architecture, database models, compliance algorithms, directory maps, and operational states. 

If you need to transition to another AI assistant, developer, or platform, **copy-paste this entire markdown file as the initial prompt**. This will instantly align the new agent with the exact system state, architectural rules, and operational boundaries without losing a single drop of context.

---

## 🏗️ 1. Core Architecture Blueprint

The Alpha Engine operates as a **two-tier hybrid trading platform** designed for institutional-grade quantitative execution with ultra-low latency co-location and zero capital exposure leakage.

```
+-------------------------------------------------------------+
|               1. FRONTEND / WEB CONTROL PLANE               |
|  - Framework: React 18+ (Vite) + Express (Custom Server)    |
|  - Role: Dashboard Visualizer, Risk State Manager, API      |
|          and Quantitative Backtesting Subprocess Runner.    |
|  - Ingress: Port 3000 (Exposed via GCR / Local Proxy)       |
|  - Host Platform: Google Cloud Run (Autoscaling scale-to-0) |
+------------------------------+------------------------------+
                               |
                  ⚡ Secure REST & WebSockets
                               |
                               v
+------------------------------+------------------------------+
|            2. FIRESTORE REAL-TIME SYNC ENGINE                |
|  - Database: Google Firestore (Serverless NoSQL)             |
|  - Role: Microsecond-level state synchronization between     |
|          Web Dashboard and Edge Execution VM.               |
|  - Core Collection: `system_risk_state/current_state`        |
+------------------------------+------------------------------+
                               |
                    📡 Firestore Event Listener
                               |
                               v
+------------------------------+------------------------------+
|              3. EDGE EXECUTION NODE (Frankfurt)             |
|  - Framework: Python 3.11+ Continuous TCP loop              |
|  - Daemon Services: `main.py` + `local_edge_node.py`         |
|  - Role: Direct co-located connection to Interactive Brokers |
|          Europe Gateway (IBIE) with sub-2ms ping latency.    |
|  - Host Platform: GCP Compute Engine (GCE) e2-micro (Spot)   |
+-------------------------------------------------------------+
```

---

## 📊 2. Algorithmic Trading Rules & Risk Safeguards

The Alpha Engine executes a custom quantitative trend breakout and order flow strategy strictly constrained by institutional risk controls. Any code modification must respect these 6 parameters:

1. **SMA-20 Trend Alignment**: Checks Simple Moving Average (20-period) on the daily or intraday candle. Buys are strictly locked to when prices trade above the SMA-20; Shorts are locked to prices trading below it.
2. **OFI Volume Imbalance Expansion**: Breakthrough signal triggers exclusively when the Order Flow Imbalance volume spike exceeds **$1.4\times$** the 10-period volume moving average.
3. **1% Total Capital Risk Rule**: Dynamically sizes active market entries so that the absolute distance from entry price to the Stop-Loss risks a maximum of **1%** of the cumulative portfolio capital.
4. **1.8 ATR Stop-Loss Bracket**: Automatically positions the stop boundary at **$1.8\times$** the Average True Range (ATR) from entry. Take-Profit limits are automatically placed at **$2.0\times$** the Stop-Loss distance.
5. **15% MiFID-II Commission & Friction Filter**: Protects funds by calculating trade profitability before routing. If projected slippage + two-way broker commissions exceeds **15%** of maximum potential profit, the trade is rejected:
   $$\text{Efficiency Ratio} = \frac{\text{Projected Friction (Slippage + } 2\times\text{ Commission)}}{\text{Projected Max Profit (Take-Profit Distance)}} \times 100 \le 15\%$$
6. **Drawdown Circuit Breakers**:
   * **Percentage-Based Lock**: Automatically locks the order router when daily account drawdown exceeds a custom percentage (e.g., `2.5%`).
   * **Absolute Cash Lock**: Locks the router when total daily losses exceed a custom cash cap (e.g., `€1,500.00`).
   * **Admin Clear Overrides**: Includes an **ADMIN UNLOCK** panel for manually releasing the router lock after risk reviews, alongside a high-priority **PANIC FLUSH** emergency button to instantly market-close all active risk.

---

## 📁 3. Workspace Directory Map

Below is a complete index of all functional files currently active in the workspace:

```
├── .env.example              # Example environment keys template for developers
├── AGENTS.md                 # System-wide framework and compilation constraints
├── backtester.py             # Quantitative backtester python model for historical simulation
├── config_loader.py          # VM config parser for secure database/gateway keys
├── connection.py             # Native Interactive Brokers execution callbacks wrapper
├── deploy_to_gcp.sh          # Automated deployment script for GCP Compute Engine
├── deploy_to_hetzner.sh      # Automated deployment script for Hetzner Cloud VM
├── MULTI_CLOUD_SETUP_GUIDE.md# Comparative manual for cloud execution options
├── firebase_sync.py          # Secure Firestore tunnel REST communications bridge
├── local_edge_node.py        # Co-located daemon pipeline loop coordinator
├── main.py                   # Python entry point runner executing continuous loops
├── metadata.json             # AI Studio applet name, capabilities, and iframe permissions
├── package.json              # Front-end build tools, scripts, and npm dependencies
├── server.ts                 # Full-stack Express server proxy and static asset server
├── SYSTEM_SNAPSHOT.md        # This document (Handover & Alignment Blueprint)
└── src
    ├── App.tsx               # Main layout container & integrated Runbook modal state
    ├── index.css             # Global CSS and Tailwind theme configurations
    ├── main.tsx              # Front-end React compiler entry point
    └── components
        ├── Dashboard.tsx     # Performance trackers, active trades ledger, and risk controls
        └── GcpCompanion.tsx  # Dynamic 5-tab VM Provisioning, Backtester, and Git Sync Panel
```

---

## 📡 4. Cloud Environment & Secrets Configuration

### Tier A: Express Web Server Environment (`.env` in Root Folder)
* `GEMINI_API_KEY`: Server-side API key for processing AI geopolitical calibrations and macro narrative sentiment.
* `APP_URL`: The deployment address of your web panel (used for synchronizing workspace states to GitHub).
* `NODE_ENV`: Mode switch (`production` or `development`).

### Tier B: Edge Node VM Environment (`.env` inside VM `~/ALPHA-ENGINE-AIstudio`)
* `IBKR_ACCOUNT_NUMBER`: Your target Interactive Brokers account ID (e.g. `U9876543`).
* `IBKR_PORT`: Port `4002` for paper (simulated), `4001` for live production.
* `IBKR_HOST`: Loopback network address hosting the headless gateway container (`127.0.0.1`).
* `FIREBASE_PROJECT_ID`: Your Google Cloud project ID enabling direct firestore syncing.
* `FIREBASE_API_KEY`: The authorization token securing direct Firestore API communication.

---

## 🤖 5. Copy-Paste Handover Prompt (For New AI Agents)

*Copy the text inside the block below and paste it directly into your chat with a new AI assistant to instantly align its capabilities:*

```text
Hello! You are now the leading Systems and Quant Coding Engineer for the Alpha Engine. 

Our application is a two-tier hybrid trading platform combining a full-stack React + Express dashboard on Google Cloud Run (Port 3000) with a co-located Python execution daemon on a GCP Compute Engine (GCE) e2-micro Spot VM located in Frankfurt. The two tiers synchronize state in real-time using Google Firestore.

Your core directives:
1. Always maintain strict type-safety. Ensure React components are modular and built using React 18+ and Tailwind CSS.
2. Maintain port 3000 as the sole external port for the Web Dashboard. Keep the Python socket ports (4001/4002) secured to local loopbacks.
3. Protect credentials! Never generate public UI elements (inputs or dialogs) requesting secret API keys. Keep the Gemini API Key strictly server-side inside our Express 'server.ts' proxy.
4. Adhere to our exact risk management rules:
   - SMA-20 Congruence (buy only when above SMA-20, short below).
   - OFI Breakout Signal (volume imbalance expansion threshold of 1.4x).
   - 1% Max Capital Risk sizing constraint.
   - 1.8 ATR Stop-loss bracket and 2.0x Take-Profit target.
   - 15% Max Transaction Friction Filter.
   - Drawdown Circuit Breakers (Daily Percentage Drawdown & Daily Cash Drawdown thresholds with Manual Admin Overrides and Panic Flush buttons).
5. Always consult '/SYSTEM_SNAPSHOT.md' and '/AGENTS.md' as your system guidelines.
6. Before delivering code, run compilation tools to verify compile health.

Let's begin analyzing our workspace files. Please read '/AGENTS.md' and '/src/App.tsx' to understand the current configuration.
```

---

## 📊 6. Current Deployment Status & Verified Specs

* **Linter Checks**: Passed and verified compilation clean.
* **Applet Build**: Compiled successfully into production static assets.
* **Co-location Integration**: Verified for Frankfurt network route latency optimizations.
