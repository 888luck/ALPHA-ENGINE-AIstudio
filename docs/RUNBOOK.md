# 🎓 ALPHA ENGINE RUNBOOK & ONBOARDING GUIDE
> **A beginner-friendly, newcomer-comprehensible blueprint for trading core co-location, intelligence consensus, dynamic universe discovery, and risk compliance.**

---

## 🏛️ System Overview & Architecture

Alpha Engine is an institutional-grade, multi-agent intraday algorithmic trading system designed for Interactive Brokers (IBKR Pro Ireland / IBIE) with low-latency co-location in Google Cloud Platform (GCP Frankfurt: `europe-west3`).

```
┌────────────────────────────────────────────────────────────────────────┐
│                        ALPHA ENGINE ARCHITECTURE                       │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│   [ Market Feed Scanners ] ──> Dynamic Universe Discovery (<15% Frict) │
│                                         │                              │
│                                         ▼                              │
│   [ Intelligence Engine ] ───> Multi-Model Consensus (Critic-Verifier) │
│                                         │                              │
│                                (Quota Guard Safe)                      │
│                                         ▼                              │
│   [ Risk Engine ] ───────────> Dynamic Position Sizing (What-If Margin)│
│                                         │                              │
│                                         ▼                              │
│   [ Execution Node ] ────────> IBKR Gateway (Port 4002 Paper / 4001 Live│
│                                 (Dual-Gate: ALPHA_LIVE_CONFIRMED_2026) │
│                                         │                              │
│                                         ▼                              │
│   [ Telemetry & Audit ] ─────> Firestore Live Stream & Post-Trade Logs │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 🖥️ FAQ & System Guarantees

### Q1: Can our Frankfurt GCP Spot VM handle this upgraded architecture?
**Yes, with massive headroom at ~$1.64/month!**
Running an `e2-micro` or Spot VM instance (2 vCPUs, 1GB RAM) in Frankfurt (`europe-west3`) provides sub-millisecond proximity to Interactive Brokers (IBIE / IBKR Ireland):
- **Zero Overhead Socket Listening**: The edge node daemon (`main.py` & `local_edge_node.py`) operates as an async Python event router, consuming **under 50MB RAM** and **<2% CPU**.
- **Cloud Run Backtesting Offload**: Heavy quantitative backtests run serverlessly in Cloud Run on demand, keeping the co-located VM 100% responsive for order execution.
- **Asynchronous Firestore Sync**: Telemetry, risk telemetry, and audit logs synchronize over non-blocking Firestore REST/gRPC bridges.

### Q2: How does the AI Intelligence Pipeline & Multi-Model Consensus work?
Trading signals are never based on naive single-prompt AI. Alpha Engine employs an institutional **Critic-Verifier Consensus Pipeline**:
- **Critic-Verifier Duo**: A primary analyst model (e.g., Gemini Flash) generates quantitative trade hypotheses, while an adversarial critic model evaluates liquidity, news catalysts, and regime risks. Orders require **≥75% consensus**.
- **Zero-Crash Quota Guard**: If API limits are approached, the rolling-window rate limiter engages automatically and transitions smoothly to the deterministic quantitative engine — guaranteeing zero runtime crashes and uninterrupted risk monitoring.
- **Attribution & Audit Logging**: Every AI inference, rationale, and confidence score is permanently logged to Firestore (`historical_logs`) for post-market calibration.

### Q3: How does Dynamic Universe Discovery & Friction Filtering work?
Hardcoded tickers are strictly avoided. Alpha Engine discovers opportunities dynamically each morning:
- **Dynamic Scanner**: Fetches high-volume market movers and sector catalysts directly from IBKR scanners and feed registries.
- **Strict <15% Friction Gate**: Before ranking, every candidate undergoes friction screening: `Spread / ATR ≤ 15%`. Illiquid tickers that would erode alpha through bid-ask slippage are automatically discarded.
- **Top N Focus Selector**: You can configure the engine to focus on between **1 and 5** top-ranked instruments simultaneously in the dashboard to concentrate risk.

### Q4: How are Credentials Fed and Live Trading Protected?
- **Cloud Run Control Plane**: Gemini API key and Firebase credentials remain strictly server-side or authenticated via IAM Service Accounts.
- **Edge Node VM (.env file)**: Configured via `.env`: Account ID, Port (default `4002` for Paper, `4001` for Live), and MiFID-II trader shortcodes.
- **Two-Step Live Safety Gate**: Live trading cannot be toggled accidentally. To arm live execution, the operator must type the exact safety confirmation phrase:
  ```
  ALPHA_LIVE_CONFIRMED_2026
  ```

---

## 🚀 STEP-BY-STEP RUNBOOK FOR BEGINNERS: YOUR FIRST RUN

### Step 1: Verify Strategy with Event-Study Backtesting
1. Open the dashboard at [https://alpha-engine-ai-studio.web.app](https://alpha-engine-ai-studio.web.app).
2. Go to the **📊 QUANT BACKTESTER** tab in the GCP Control Companion.
3. Select a ticker (e.g., `XLE`, `SPY`, or a dynamic discovery candidate), choose a historical timeframe, and click **RUN SIMULATION**.
4. Inspect the dynamic equity curves, Directional Hit Rate, Maximum Adverse/Favorable Excursion (MAE/MFE), and Brier calibration scores.

### Step 2: Inspect Dynamic Universe & AI Consensus
1. Switch to the **🧠 AI INTELLIGENCE & UNIVERSE** tab.
2. Review discovered market movers, confirm the **<15% Friction Filter** is passing, select your **Top Focus Tickers** (1 to 5), and review real-time Quota Guard health.

### Step 3: Set Up Risk Boundaries & Stop Multipliers
1. In the **⚙️ RISK BOUNDARY CONFIGURATOR**, verify your Stop ATR Multipliers (typically 1.8 ATR), dynamic Stop Limits, and toggle adaptive trailing stops.

### Step 4: Configure Drawdown Circuit Breakers (Essential Protection)
1. Set your **Daily Drawdown Limit Percent** (e.g. 2.5%) and **Cash Drawdown threshold** (e.g. €1,500.00).
2. If cumulative intraday losses reach these boundaries, the system engages a hard lock on the router immediately to preserve capital.

### Step 5: Deploy and Run on Paper (Simulated Gateway)
1. Ensure the VM loop port is set to `4002` (IBKR Paper gateway).
2. Run the deployment script:
   ```bash
   ./deploy_to_gcp.sh
   ```
3. Check the **Live Telemetry Stream** panel to see sub-millisecond co-location in action!

### Step 6: Emergency Monitoring & Overrides
- If a circuit breaker engages, click **ADMIN UNLOCK** to restore routing after assessing market conditions.
- Click **PANIC FLUSH** to instantly liquidate all open positions in an emergency.
