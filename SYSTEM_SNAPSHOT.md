# Alpha Engine: Master System Snapshot & Architectural Blueprint

This document is the authoritative institutional blueprint of the Alpha Engine Hybrid Platform. It details verified system states, communication protocols, AI provider matrices, and execution pipelines.

---

## 🌐 1. System Topology & Network Map

```
+-----------------------------------------------------------------------------------+
|                        TIER 1: WEB CONTROL PLANE & API                            |
|                 Google Cloud Run (Frankfurt europe-west3)                         |
|                                                                                   |
|  - Dashboard, Quant Lab, Copilot & REST API: Port 3000                            |
|  - Modular Express + Vite Bundle (dist/server.cjs)                                |
|  - Live Endpoint: https://alpha-engine-aistudio-138990607360.europe-west3.run.app |
+-----------------------------------------------------------------------------------+
                                        |
           Direct TCP Socket Streaming (<5ms latency, token-authenticated)
                                        v
+-----------------------------------------------------------------------------------+
|                     TIER 2: EDGE EXECUTION DAEMON (VM)                            |
|             GCP Compute Engine e2-medium (Frankfurt europe-west3)                 |
|                                                                                   |
|  - Direct TCP Bridge Server: Port 4005 (edge_bridge.py)                           |
|  - Continuous Python Pipeline: main.py + local_edge_node.py                       |
|  - Dynamic Risk Guard & Order Router: dynamic_risk_manager.py                     |
|  - Alpha Strategy & Candlestick Engine: alpha_strategy.py                         |
|  - Custom Strategy Hot-Reload Engine: custom_strategy_loader.py                    |
|  - Offline NLP Encoders: INT8 ONNX FinBERT & ModernBERT (CPU $0 cost)             |
|  - Local Atomic Persistence: ha_leader_lock.json, tca_executions.json             |
+-----------------------------------------------------------------------------------+
                                        |
                    Loopback IPC (Microsecond Socket Memory)
                                        v
+-----------------------------------------------------------------------------------+
|                       INTERACTIVE BROKERS GATEWAY (IBC)                           |
|                                                                                   |
|  - Port 4001: LIVE Production Gateway                                             |
|  - Port 4002: PAPER Simulation Gateway                                            |
|  - Connects to Funded IBKR Pro European Data Tape & SMART Router                  |
+-----------------------------------------------------------------------------------+
```

---

## 🔐 2. The 4-Pillar API Connection & Feed Vault

The 4-Pillar Vault (`ApiVaultModal.tsx`, `/api/vault/credentials`, `vault.ts`, and `config_loader.py`) governs all system connectivity. Credentials adhere strictly to the 12-Factor decoupled architecture: stored in standard POSIX format at `/etc/alpha-engine/secrets.env` (`chmod 600 root:root`), with in-memory sync across `process.env` and `os.environ` without proprietary cloud SDK lock-in:

### Pillar 1: Broker & Execution Infrastructure
* **Target:** Interactive Brokers Gateway / TWS via `connection.py` and `edge_bridge.py`.
* **Configured Fields:**
  - `ibkrAccountNumber`: Funded IBKR Account ID (e.g. `DUE263010` / `DU1234567`).
  - `ibkrHost`: Edge private IP (Frankfurt VPC `10.156.0.2` or loopback `127.0.0.1`).
  - `ibkrPort`: `4001` (Live Production) or `4002` (Paper Simulation).
  - `ibkrClientId`: Socket client identifier (default `10`).
  - `ibkrPaperUsername` & `ibkrPaperPassword`: Automated credentials for 24/7 autonomous paper simulation.
  - `ibkrLiveUsername` & `ibkrLivePassword`: Credentials for live DMA execution (triggers IB Key phone 2FA push).
  - `mifid2DecisionMaker` & `mifid2ExecutionTrader`: Regulatory algorithm shortcodes (e.g. `ALGO_DEC_992` / `ALGO_EXE_554`).
* **Wiring & Mechanics:** Toggling execution lanes updates `server.ts` state and pushes an atomic payload across Direct TCP Bridge port `4005` to synchronize `main.py` and trigger `switch_gateway_mode.py`.

### Pillar 2: Cloud & Edge Infrastructure (12-Factor Decoupled Vault & Zero Cloud DB)
* **Target:** Frankfurt Compute Engine VM (`alpha-edge-node` in `europe-west3-a`) + Cloud Run control plane.
* **Mechanics:**
  - **12-Factor Decoupled Vault (`vault.ts`, `config_loader.py`):** Multi-cloud secrets management using standard POSIX files (`/etc/alpha-engine/secrets.env` locked to `chmod 600`) with zero proprietary cloud SDK lock-in. Full portability across GCP, Hetzner, AWS, or Bare Metal.
  - **Dynamic Edge Endpoint Resolution:** Eliminates hardcoded `127.0.0.1` references; `get_edge_endpoint()` resolves the active edge daemon dynamically from `EDGE_NODE_HOST` / `EDGE_NODE_IP` and `EDGE_TCP_PORT`.
  - **Zero Firebase / Firestore Invariant:** Completely purged. All synchronization is direct TCP socket streaming over port `4005` (<5ms latency).
  - **Local Atomic Persistence:** Failover leases (`ha_leader_lock.json`), transaction audits (`tca_executions.json`), attribution lessons (`audit_history.json`), and risk limits (`system_risk_state.json`) use atomic file write-and-replace (`.tmp` write followed by `os.replace`).

### Pillar 3: AI Model Providers & Execution Runtimes
* **Supported External Cloud Providers:**
  1. **Google (Google GenAI / Gemini):** Deep macro synthesis and multi-modal market reasoning.
  2. **NVIDIA NIM:** GPU-accelerated low-latency enterprise models.
  3. **Groq Cloud:** Ultra-fast LPU inference (<300ms time-to-first-token) for real-time order-flow decisions.
  4. **OpenRouter:** Universal gateway accessing Claude, GPT, Llama, DeepSeek, and Mistral via a single unified key.
* **Custom & Local Inference Endpoints:**
  5. **Custom Cloud Endpoint:** User-specified Base URL + API Key for private or self-hosted OpenAI-compatible LLMs.
  6. **Custom Local Endpoint:** Direct connection to local inference runtimes (`http://localhost:11434` for Ollama, `http://localhost:8080` for llama.cpp, vLLM, LM Studio) for 100% private execution.
* **Interactive Live Probing & Two-Way UI Reflection:**
  - In `ApiVaultModal.tsx`, every provider card includes a built-in **Live Test Probe** button (`probe_connection`).
  - Probing verifies the API key against the provider's official `/models` endpoint in real time.
  - On success, the response immediately renders the discovered models as active badges under that provider's card (e.g. `Discovered Models: [model-1, model-2]`).
  - Simultaneously, the Copilot catalog cache is invalidated, and the new models instantly populate the Copilot header dropdown without requiring page reloads or container redeployments.
* **Embedded Local NLP & Sentiment Tier ($0 Cost, CPU/ONNX):**
  - **INT8 ONNX FinBERT (CPU Offline):** Embedded in container; evaluates news bulletins and headlines into `Positive`, `Negative`, or `Neutral` sentiment in sub-10ms with zero network egress.
  - **ModernBERT & Financial Variants:** 8,192-token long-context local encoder used for deep semantic extraction and SEC filing analysis directly on CPU.

### Pillar 4: Institutional Domain Data Feeds
Orthogonal, non-market feeds permitted strictly for domain-specific data not provided by IBKR:
1. **U.S. SEC EDGAR (`data.sec.gov` via `get_sec_filings`):** Primary filings (**8-K** material events, **10-Q** quarterly reports, **10-K** annual statements, **Form 4** insider trades) queried with compliant `secUserAgent` headers.
2. **ClinicalTrials.gov API v2 (`get_clinical_trials`):** NIH/NLM protocol database tracking Phase I/II/III clinical trials, study recruitment, and primary completion dates.
3. **U.S. FDA OpenFDA (`api.fda.gov` via `get_fda_safety_reports`):** Adverse Event Reporting System (FAERS), black-box warnings, and drug recalls.
4. **U.S. Energy Information Administration (`api.eia.gov/v2` via `get_energy_telemetry`):** Weekly natural gas storage (WNGS), crude oil inventories, and refinery utilization metrics.
5. **Macro & IP Infrastructure:** Federal Reserve Economic Data (FRED API for yields, SOFR, CPI) and USPTO PatentsView API (patent velocity and litigation risk).

---

## 🤖 3. Autonomous Copilot Architecture

The Copilot (`CopilotPage.tsx`, `src/server/routes/copilot.ts`, `backend/app/api/copilot.py`) serves as the autonomous institutional trading assistant:

* **Conversational Reasoning & Streaming:** Multi-turn streaming chat grounded in live portfolio telemetry, market phase (Pre-market, Execution, Post-market), and MiFID-II compliance.
* **Cost & Quota Governance:** Built-in circuit breakers, daily spending caps, latency telemetry, and token tracking per provider.
* **Direct Function Calling via 78-Tool Registry:** The Copilot directly executes tools reflected in `tools_registry.json`:
  - `reqMktData` / `get_market_quote`: Pulls real-time NBBO quotes from IBKR Pro.
  - `reqHistoricalData`: Pulls OHLCV candlesticks across any timeframe.
  - `reqPositions` / `reqAccountSummary`: Inspects live exposure and margin headroom.
  - `get_sec_filings`, `get_clinical_trials`, `get_fda_safety_reports`, `get_energy_telemetry`: Fetches orthogonal regulatory filings and clinical readouts.
  - `submit_order`: Dispatches validated bracket orders across Direct TCP Bridge port 4005.
* **Multi-Model Resilience & Provider Governance:**
  - **OpenRouter Reasoning Token Extraction:** Dynamically extracts reasoning tokens from `message.reasoning`, `message.reasoning_content`, and `message.reasoning_details` for reasoning LLMs (Nemotron, DeepSeek R1, etc.).
  - **Dynamic Groq TPM Headroom Clamping:** Automatically calculates prompt token sizes and restricts Groq completions to strictly fit under the 8,000 TPM (`x-ratelimit-limit-tokens: 8000`) quota, completely eliminating `HTTP 413` errors.
  - **Sliding Context Window Compaction:** Compacts previous multi-turn messages exceeding 1200 characters down to 1000 characters while preserving the active query intact.
  - **4-Tier Provider Failover Pipeline:** NVIDIA NIM $\rightarrow$ OpenRouter $\rightarrow$ Groq Cloud $\rightarrow$ Google GenAI with stateful provider exhaustion before falling back.
  - **Deterministic Local Quantitative Sizing Fallback ($0 CPU):** Automatically computes exact 1% capital risk constraint, ATR-based dollar risk, position sizing, IBKR fractional share feasibility, and friction metrics when equity queries are received.

---

## 🧪 4. Quant Lab, Strategy Studio & GCE Companion

The Quant Lab & Strategy Studio (`StrategyStudioPage.tsx`, `GcpCompanion.tsx`, `src/server/routes/backtest.ts`, `backtester.py`) provides the quantitative research, regime discovery, and backtesting environment:

1. **AI Intelligence & LLM Critic-Verifier Consensus:** Multi-model consensus voting on event catalysts and sector impacts.
2. **Dynamic Lookback Horizons & User Time Brackets:**
   - Exposes `days`, `start_date`, and `end_date` parameters across `run_quant_discovery`, `run_strategy_sweep`, and `run_strategy_backtest`.
   - Supports natural language time ranges (e.g. 30 days, 90 days, 180 days, 1 year) without artificial ~210-bar caps.
   - Pacing-compliant IBKR historical duration formatting (`{days} D`, `1 Y`) with adaptive socket timeouts: `max(25.0, min(65.0, days_diff * 0.15))`.
   - Primary Exchange Disambiguation (`NYSE` for NYSE symbols like `CAT`, `BA`, `IBM`, `DIS`, `JPM`, `GE`, `XOM`, and `NASDAQ` for tech equities) preventing SMART router ambiguities.
3. **Deflated Sharpe Ratio (DSR) 16-Trial Parameter Sweep:**
   - Performs multi-parameter sweeps (ATR stop multipliers, hold durations, OFI filters, tranche scaling) with Bailey & López de Prado DSR auditing to penalize selection bias and data-mining overfit.
4. **Universe Manager & Audit Dashboard:**
   - Dynamic candidate basket generation (`dynamic_baskets.json`) filtering high-momentum, volume-expanding stocks.
   - Evaluates strategies against authentic historical bars pulled from IBKR Pro Tape or verified local caches (zero synthetic random-walk fabrication).
   - Generates Recharts equity curves, Profit Factor, Sharpe Ratio, Maximum Favorable Excursion (MFE), and gate rejection attribution (Gate 1 Capital, Gate 2 Friction, Gate 5 Blackout).
5. **Custom Strategy Framework (User & LLM Co-Authoring):**
   - Pluggable strategy loader (`custom_strategy_loader.py`) allowing the user and Copilot to design, code, and hot-reload custom strategies (e.g. Mean Reversion, Statistical Arbitrage, Pairs Trading, News Sentiment Momentum).
   - Mandatory DRM risk clamping: All custom strategies strictly adhere to the 1.8 ATR stop-loss, 15% friction filter, and capital ceilings before reaching the broker router.
6. **GCE Operations & Topology Matrix:** Real-time console emulation for Method B Headless Docker + IBC runtime setups and Frankfurt latency matrix monitoring.

---

## 📁 5. Production File Manifest

| File Path | Role & Operational Responsibility |
| :--- | :--- |
| **`main.py`** | Edge node root entrypoint; initializes daemons, risk gates, premarket calibration, and registers the synchronous `ibkr_dispatcher` callback on the TCP Bridge. |
| **`connection.py`** | IBKR `EClient`/`EWrapper` manager; features `execute_synchronous_request`, primary exchange routing, and atomic reconnect loop guards. |
| **`edge_bridge.py`** | Direct TCP Bridge server on port `4005`; handles remote order routing, quote retrieval, and generic `DISPATCH_IBKR` execution. |
| **`alpha_strategy.py`** | Quantitative breakout strategy (SMA-20 trend congruence, OFI order flow imbalance, 1.8 ATR stop, 15% friction filter). |
| **`backtester.py`** | Historical backtester; queries real historical bars via Direct TCP Bridge (port `4005`), formats dynamic lookback durations, and applies adaptive timeouts. |
| **`ha_manager.py`** | High-Availability failover coordinator; uses atomic local file lease (`ha_leader_lock.json`) and OS PID validation. |
| **`tca_engine.py`** | Transaction Cost Analysis engine; benchmarks arrival prices, slippage, and MiFID-II efficiency into `tca_executions.json`. |
| **`reasoning_auditor.py`** | Attribution engine; evaluates prediction hit rates and MFE, persisting daily lessons learned into `audit_history.json`. |
| **`tools_reflector.py`** | Dynamic reflection engine; inspects `ibapi.client.EClient` to build `tools_registry.json` with normalized parameters. |
| **`tools_registry.json`** | Unified catalog containing 78 callable tools across 10 categories cached with a 24-hour TTL. |
| **`server.ts`** | Production Express + Vite server on port `3000`; mounts modular routers (`/api/diagnostics`, `/api/copilot`, `/api/v1/tools/registry`, etc.). |
| **`src/pages/CopilotPage.tsx`** | Copilot frontend with multi-model dropdown, tool telemetry, token budgeting, and interactive chat. |
| **`src/pages/StrategyStudioPage.tsx`** | Quantitative Strategy Studio; hosts discovery runs, 16-trial DSR sweeps, equity curves, and experiment vault persistence. |
| **`src/components/GcpCompanion.tsx`** | Quant Lab UI; hosts AI intelligence consensus, universe manager, and backtesting dashboard. |
| **`src/components/ApiVaultModal.tsx`** | 4-Pillar Vault modal with live test probes, badge reflection, and credential synchronization. |
| **`CHANGELOG.md`** | Authoritative institutional evolution and version history ledger. |
| **`deploy_to_gcp.sh`** | Clean GCP deployment automation for Frankfurt Compute Engine VM (Zero Firebase / Zero Firestore). |
| **`AGENTS.md`** | Immutable institutional rules and architecture guidelines for AI agents and developers. |

