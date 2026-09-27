# 🚀 Alpha Engine — Institutional Multi-Agent Trading Platform

Alpha Engine is an institutional-grade, **hybrid algorithmic trading framework** designed for quantitative intraday market analysis, real-time Order Flow Imbalance (OFI) tracking, multi-exchange dynamic universe discovery, and automated MiFID II / CBI regulatory compliance.

The platform links an interactive React web dashboard with a co-located Python execution runner situated adjacent to the Interactive Brokers (IBKR) Europe Core Hub in **Frankfurt, Germany (`europe-west3`)**, coordinated securely using a direct Google Firestore real-time data tunnel.

---

## 🏗️ 1. Architecture Overview

```
                                    ┌────────────────────────────────────────────────────────┐
                                    │               MULTI-AGENT INTELLIGENCE                │
                                    │  • News Ingestor (IBKR Bulletins + Macro Calendars)    │
                                    │  • Generator: NVIDIA NIM (Nemotron 3 Ultra)            │
                                    │  • Verifier 1: Groq (LLaMA 3.1 70B)                    │
                                    │  • Verifier 2: Google Gemini 1.5 Flash                 │
                                    │  • Synthesis Judge: Google Gemini 1.5 Pro              │
                                    │  • Quota Guard: Rolling-window Rate Limiter            │
                                    └───────────────────────────┬────────────────────────────┘
                                                                │
                                                                ▼
┌─────────────────────────────────┐                 ┌────────────────────────────────────────┐
│     INTERACTIVE WEB DASHBOARD   │                 │        DYNAMIC UNIVERSE BUILDER        │
│  • Top N Basket Toggle (1–5)    │                 │  • IBKR Scanner Discovery (5 Profiles) │
│  • Live/Paper Trading Gate      │◄───────────────►│  • 15% Max Friction Screening          │
│  • Multi-Model Quota Monitor    │    Firestore    │  • Conviction Scoring & Ranking        │
│  • AI Strategy Forge & Backtest │    Realtime     │  • Generates dynamic_baskets.json      │
└─────────────────────────────────┘      Tunnel     └───────────────────┬────────────────────┘
                                                                        │
                                                                        ▼
                                                    ┌────────────────────────────────────────┐
                                                    │         FRANKFURT EDGE NODE (VM)       │
                                                    │  • Co-located in europe-west3 (<1ms)   │
                                                    │  • IBKR Pro Ireland (IBIE) TWS / DMA   │
                                                    │  • Order Flow Imbalance (OFI) Engine   │
                                                    │  • Dynamic Risk Manager (1% Max Loss)  │
                                                    │  • What-If Live Commission Audit       │
                                                    │  • EOD Post-Session Reasoning Auditor  │
                                                    └────────────────────────────────────────┘
```

---

## ⚡ 2. Core Capabilities & Multi-Agent Pipeline

### A. Dynamic Universe Discovery & Friction Filtering
- **No Hardcoded Tickers**: Discovers tradeable instruments dynamically every morning at **04:00 NY / 10:00 CET** using IBKR native `ScannerSubscription` across 5 profiles:
  - US Major Equities (`STK.US.MAJOR`, `HOT_BY_VOLUME`)
  - Euronext Paris (`STK.EU.SBF`, `HOT_BY_VOLUME`)
  - Euronext Amsterdam (`STK.EU.AEB`, `HOT_BY_VOLUME`)
  - Euronext Brussels (`STK.EU.SB`, `HOT_BY_VOLUME`)
  - DAX / XETRA (`STK.EU.IBIS`, `TOP_PERC_GAIN`)
- **15% Friction Ceiling**: Every candidate's estimated transaction costs (IBIE commissions, exchange fees, and half-spread) must consume **< 15%** of the projected intraday price excursion. High-friction candidates are automatically eliminated.
- **Configurable Focus Basket (1–5 Instruments)**: Toggle how many instruments the system actively trades to respect IBKR basic Level 2 market depth limits (~3 simultaneous streams).

### B. Evolutive Multi-Model LLM Ensemble & Quota Guard
- **Critic-Verifier Architecture**:
  - **Generator** (`nvidia/nemotron-3-ultra`): Extracts events, maps GICS sectors, identifies liquid tradeable tickers.
  - **Verifier 1** (`groq/llama-3.1-70b`): Anti-hallucination screening, economic validity check.
  - **Verifier 2** (`google/gemini-1.5-flash`): Cross-validation of catalyst duration and directional bias.
  - **Judge** (`google/gemini-1.5-pro`): Resolves conflicts and synthesizes final conviction.
- **Rolling-Window Quota Guard (`SimpleQuotaGuard`)**:
  - Enforces daily and per-minute sliding window limits declared in `model_registry.json`.
  - Automatically falls back to secondary models or the zero-latency deterministic rules engine when quotas are reached, preventing any execution downtime.

### C. Regulatory Compliance & Risk Architecture
- **MiFIR / CBI Compliance**: Automatically appends Central Bank of Ireland regulatory tags (`mifid2DecisionMaker`, `mifid2ExecutionTrader`, algorithm IDs) to all European orders.
- **Pre-Trade What-If Commission Query**: Checks real-time broker commission and initial margin changes using IBKR `whatIf=True` orders before entering trades.
- **Multi-Currency FX Risk Parity**: Normalizes EUR and USD instrument volatility and stop distances into base account risk capital units.
- **Circuit Breakers**: Hard-locks order execution if daily cumulative drawdown reaches **2.5%** of reference equity, triggering an automated emergency flush.
- **Live Trading Safety Gate**: Live real-capital trading is locked by default (Port `4002` Paper). Requires administrator token confirmation (`ALPHA_LIVE_CONFIRMED_2026`) to unlock live DMA execution (Port `4001`).

### D. Tier A Event Study Reasoning Backtester
- Located in `event_backtester.py`.
- Evaluates AI catalyst predictions against historical price excursion metrics:
  - **Directional Hit Rate** (predicted BUY/SELL bias vs. realized return)
  - **Maximum Favorable Excursion (MFE)** and **Maximum Adverse Excursion (MAE)**
  - **Brier Calibration Score** (measuring probability calibration of confidence scores)
  - Category attribution (macro, central bank, geopolitical, earnings)

---

## 🚀 3. Quick Start Guide

### Step 1: Run the Interactive Dashboard Locally
```bash
# 1. Install dependencies
npm install

# 2. Start the local dashboard server
npm run dev

# 3. Open in your browser:
# http://localhost:3000
```
Navigate to the **🧠 AI INTELLIGENCE & UNIVERSE** tab to see the live dynamic universe, focus basket toggle (1–5), live trading gate, and quota guard monitors.

### Step 2: Run the Multi-Agent Intelligence Pipeline in Python
```bash
# Run pre-market event ingestion, ensemble analysis, and universe construction
python main.py --calibration-only

# Override active focus universe size (e.g. Top 2 instruments)
python main.py --calibration-only --basket-size 2
```

### Step 3: Run the Event Study Backtester
```bash
python -c "from event_backtester import EventStudyBacktester; bt = EventStudyBacktester(); res = bt.evaluate_study(bt.generate_synthetic_study_sample()); print(f'Hit Rate: {res.directional_hit_rate}% | Brier Score: {res.brier_score} | Profit Factor: {res.profit_factor}'); print('Categories:', res.by_category)"
```

### Step 4: Run the Complete Test Suite
```bash
python -m unittest discover -s tests -v
```
Validates:
1. Event ingestion and MD5 deduplication
2. Critic-Verifier ensemble evaluation and fallback
3. SimpleQuotaGuard rate-limiting
4. UniverseBuilder contract resolution, 15% friction screening, and Top N toggle
5. Pre-trade What-If commission calculation (US & European tiers)
6. EventStudyBacktester directional attribution and Brier scoring
7. ReasoningAuditor post-session lessons learned memory bank

---

## ☁️ 4. Google Cloud Deployment

The repository includes automated CI/CD deployment configurations for Google Cloud:

### Automated Deployment via Google Cloud Build (`cloudbuild.yaml`)
Whenever commits are pushed to the `main` branch, Google Cloud Build automatically:
1. Runs the unit and integration test suite (`tests/test_pipeline.py`).
2. Executes the pre-market intelligence dry-run (`main.py --calibration-only`).
3. Provisions or updates the `alpha-edge-node` **Spot VM in Frankfurt (`europe-west3-a`)** with a 2GB swapfile for ~$1.64/month.
4. Builds and deploys the production dashboard to **Firebase Hosting** (`alpha-engine-ai-studio.web.app`).

### Manual Deployment via Google Cloud Shell
1. Open [console.cloud.google.com](https://console.cloud.google.com) and activate Cloud Shell (`>_`).
2. Run the proximity deployer script:
```bash
git clone https://github.com/888luck/ALPHA-ENGINE-AIstudio.git
cd ALPHA-ENGINE-AIstudio
chmod +x deploy_to_gcp.sh
./deploy_to_gcp.sh
```

---

## ⚙️ 5. Configuration & Environment Variables

Create a `.env` file in the root directory:

```env
# Interactive Brokers Gateway Configuration
IBKR_ACCOUNT_NUMBER="DU1234567"     # Paper default
IBKR_HOST="127.0.0.1"
IBKR_PORT=4002                      # 4002 = Paper, 4001 = Live
IBKR_CLIENT_ID=10
MAX_ACTIVE_INSTRUMENTS=3            # Active universe limit (1-5)
ALLOW_LIVE_TRADING=false            # Safety lock (true requires live token)

# MiFID II / CBI Regulatory Identifiers
MIFID2_DECISION_MAKER_ID="ALGO_DEC_992"
MIFID2_EXECUTION_TRADER_ID="ALGO_EXE_554"

# Multi-Model LLM API Keys (Optional - deterministic rules fallback active if absent)
NVIDIA_API_KEY=""                   # Generator: Nemotron 3 Ultra
GROQ_API_KEY=""                     # Verifier 1: LLaMA 3.1 70B
GEMINI_API_KEY=""                   # Verifier 2 & Judge: Gemini 1.5 Flash/Pro

# Google Firebase / Firestore Tunnel
FIREBASE_PROJECT_ID="alpha-engine-ai-studio"
FIREBASE_API_KEY="AIzaSyCq4or4zJ70JUEe2CxukxwafGW_CVHSU_Q"
```

---

## 📂 6. Repository File Structure

```
├── .firebaserc                     # Firebase active project alias bindings
├── cloudbuild.yaml                 # Google Cloud Build automated CI/CD pipeline
├── deploy_to_gcp.sh                # Frankfurt europe-west3 Spot VM deployer script
├── deploy_to_hetzner.sh            # Hetzner Cloud VM provisioner script
├── dynamic_baskets.json            # Calibrated daily Top N focus universe output
├── event_backtester.py             # Tier A Event Study Reasoning Backtester
├── fee_schedule.json               # Cached IBIE European & US fee matrices
├── feed_registry.json              # Pluggable feed adapter registry (IBKR, FRED, ECB)
├── firebase.json                   # Firestore database & Firebase Hosting configuration
├── firebase_sync.py                # Zero-dependency Google Firestore REST client
├── firestore.rules                 # Hardened Firestore security rules (role-based)
├── llm_ensemble.py                 # Multi-model Critic-Verifier ensemble & Quota Guard
├── local_edge_node.py              # Multi-exchange IBKR Scanner & Level 2 OFI collector
├── main.py                         # Master execution daemon & pre-market calibration
├── model_registry.json             # Dynamic LLM endpoints, fallbacks & quota limits
├── news_ingestor.py                # Bulletin ingestion, RSS calendar polling & deduplication
├── package.json                    # Dashboard React, Vite, and Express dependencies
├── reasoning_auditor.py            # Post-session attribution & lessons learned memory bank
├── risk_engine.py                  # Dynamic Risk Management (DRM) & What-If commission query
├── server.ts                       # Express backend proxy & Vite development server
├── universe_builder.py             # Contract resolution, 15% friction filter & ranking
├── universe_models.py              # Strict dataclass schemas for events & universe
├── src/
│   ├── App.tsx                     # Main dashboard container & live navigation
│   └── components/
│       ├── Dashboard.tsx           # Execution metrics, order flow & circuit breaker UI
│       └── GcpCompanion.tsx        # AI Intelligence Tab, Universe Manager & Cloud panel
└── tests/
    ├── __init__.py
    └── test_pipeline.py            # Complete 7-part unit and integration test suite
```

---

## ⚖️ License & Disclaimers

Alpha Engine is built for quantitative algorithmic research and compliance-first execution. 
**Trading financial instruments involves significant risk of loss.** Live execution requires explicit administrator confirmation and adherence to broker margin and MiFID II requirements.
