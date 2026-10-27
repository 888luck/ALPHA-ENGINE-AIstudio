# Alpha Engine: Master System Snapshot & Architectural Blueprint

This document is the authoritative institutional blueprint of the Alpha Engine Hybrid Platform. It details verified system states, communication protocols, AI provider matrices, risk architectures, and execution pipelines.

---

## 🌐 1. System Topology & Network Map

```
+-----------------------------------------------------------------------------------+
|                        TIER 1: WEB CONTROL PLANE & API                            |
|             Google Cloud Run (Frankfurt europe-west3) | Port 3000                |
|                                                                                   |
|  - 7 Institutional Control Tabs (Vite + React SPA)                                |
|  - Modular Express API Server (dist/server.cjs)                                   |
|  - Dynamic 12-Factor Vault Engine (/api/vault)                                    |
|  - Live Endpoint: https://alpha-engine-aistudio-138990607360.europe-west3.run.app |
+-----------------------------------------------------------------------------------+
                                        |
       Encrypted Low-Latency TCP Socket Streaming (<5ms, token-authenticated)
                                        v
+-----------------------------------------------------------------------------------+
|                     TIER 2: EDGE EXECUTION DAEMON (VM)                            |
|        GCP Compute Engine e2-medium (Frankfurt europe-west3-a: 10.156.0.2)        |
|                                                                                   |
|  - Direct TCP Bridge Server: Port 4005 (edge_bridge.py)                           |
|  - Continuous Python Pipeline: main.py + local_edge_node.py                       |
|  - SEC Rule 15c3-5 Pre-Trade Risk Engine: dynamic_risk_manager.py                 |
|  - Alpha Strategy & Order Flow Imbalance (OFI) Engine: alpha_strategy.py          |
|  - Pluggable Strategy Hot-Reload Engine: custom_strategy_loader.py                |
|  - Offline Tier 0 Encoders: Dual-Head INT8 ONNX & 8,192-token embedder at models/tier0-encoder/ (CPU $0 cost) |
|  - Local Atomic Persistence: ha_leader_lock.json, tca_executions.json             |
+-----------------------------------------------------------------------------------+
                                        |
                     Loopback IPC (Microsecond Socket Memory)
                                        v
+-----------------------------------------------------------------------------------+
|                       INTERACTIVE BROKERS GATEWAY (IBC)                           |
|                                                                                   |
|  - Port 4001: LIVE Production Gateway (IB Key Mobile 2FA Biometric Push)          |
|  - Port 4002: PAPER Simulation Gateway (Autonomous 24/7 Execution)                |
|  - Direct DMA to Funded IBKR Pro European Data Tape & SMART Router                |
+-----------------------------------------------------------------------------------+
```

---

## 🖥️ 2. The 7 Institutional Control Planes (Tabs)

The platform exposes 7 dedicated operational views accessible via instant SPA hotkeys (`Alt+1` through `Alt+7`) and a Spotlight Command Palette (`Cmd+K` / `Ctrl+K`):

1. **`CONTROL` (`Alt+1`, [`LiveCockpit.tsx`](./src/components/LiveCockpit.tsx))**:
   - Consolidated Executive KPI Ribbon: Net Liquidation, Maintenance Margin, Margin Utilization %, Day Realized/Unrealized P&L, Open Risk Pool.
   - Level 2 Order Book Depth & Order Flow Imbalance (OFI) Accumulation Tape.
   - Frankfurt Edge Node Telemetry (Socket latency, packet rate, uptime).
   - Market Clock Resolver (Pre-Market, Continuous Trading, Post-Market, Weekend).
2. **`BLOTTER` (`Alt+2`, [`ActiveHoldingsTable.tsx`](./src/components/ActiveHoldingsTable.tsx) & [`TcaAuditTable.tsx`](./src/components/TcaAuditTable.tsx))**:
   - Real-time Active Open Positions Ledger: Mark-to-market valuations, trailing stop distances, unrealized P&L, and MiFID II RTS-22 shortcodes (`ALGO_DEC_992` / `ALGO_EXE_554`).
   - Transaction Cost Analysis (TCA) Audit Ledger: Basis point slippage vs. arrival midpoint and transaction friction ratios recorded in `tca_executions.json`.
3. **`RISK` (`Alt+3`, [`LiveCockpit.tsx`](./src/components/LiveCockpit.tsx))**:
   - 6 SEC Rule 15c3-5 Pre-Trade Risk Gates: Capital at Risk (1% constraint), Max Position Size, Daily Loss Circuit Breaker, Transaction Friction Filter, Liquidity / OFI Floor, and MOC Blackout Flattening.
   - Real-time margin utilization progress bar and two-stage emergency kill switch.
4. **`QUANT LAB` (`Alt+4`, [`QuantResearchLab.tsx`](./src/components/QuantResearchLab.tsx))**:
   - 3 Focused Quantitative Lenses:
     - **Catalyst Radar**: SEC 8-K/10-Q primary filings, ClinicalTrials.gov updates, OpenFDA safety alerts.
     - **PEAD Momentum Radar**: Post-Earnings Announcement Drift tracking and earnings surprise momentum.
     - **Microstructure Screener**: Order flow imbalance spikes and bid-ask spread efficiency.
   - Seamless 1-click bridge to Strategy Studio.
5. **`STRATEGY STUDIO` (`Alt+5`, [`StrategyStudioPage.tsx`](./src/pages/StrategyStudioPage.tsx))**:
   - Quant simulation and 16-trial Deflated Sharpe Ratio (DSR) sweeps (Bailey & López de Prado).
   - **Dual-Control Quant Gates**: Tactile sliders + exact numeric input for Transaction Friction Ceiling ($5\text{--}30\%$) and DSR Confidence Hurdle ($50\text{--}99.9\%$).
   - Pre-Flight Execution Gate Modal (`[⚡ Snap Ceiling to X%]`).
   - Authentic historical broker bars (zero synthetic random-walk fabrication).
   - `[DEPLOY TO EXECUTION POOL]` candidate basket publishing (`dynamic_baskets.json`) over TCP port 4005.
6. **`VAULT` (`Alt+6`, [`VaultConsole.tsx`](./src/components/VaultConsole.tsx))**:
   - Full-Screen 4-Pillar Vault Console with Executive Vault Ribbon:
     - `[RESTORE BROWSER KEYS]`: Restores cached keys from browser storage.
     - `[PROBE ACTIVE SERVICES]`: Probes all configured providers in parallel.
     - `[COPY SECRETS.ENV]`: Exports sanitized 12-Factor POSIX configuration.
   - Live credential probing (`probe_connection`) against official provider `/models` endpoints.
   - Dynamic UI badge reflection of discovered models.
7. **`COPILOT` (`Alt+7`, [`CopilotPage.tsx`](./src/pages/CopilotPage.tsx))**:
   - Executive telemetry ribbon layout with model selector and quota monitors.
   - Contextual action deep links (`[OPEN STRATEGY STUDIO]`, `[OPEN LIVE BLOTTER]`, `[INSPECT RISK GATES]`).
   - Quantitative prompt presets (Hurst regime analysis, PEAD drift scans).
   - Dynamic Groq 8,000 TPM headroom clamping (zero HTTP 413 errors).
   - Direct function calling into 78 tools in `tools_registry.json`.

---

## 🔐 3. The 4-Pillar API Connection & Feed Vault

The 4-Pillar Vault governs all system credentials. Adhering to the 12-Factor decoupled architecture, credentials are stored in `/etc/alpha-engine/secrets.env` (`chmod 600 root:root`) with in-memory synchronization across `process.env` and `os.environ`:

### Pillar 1: Broker & Execution Infrastructure
* **Target:** Interactive Brokers Gateway / TWS via `connection.py` and `edge_bridge.py`.
* **Configured Fields:**
  - `ibkrAccountNumber`: Funded IBKR Account ID (e.g. `U16151462`).
  - `ibkrHost`: Edge private IP (Frankfurt VPC `10.156.0.2` or loopback `127.0.0.1`).
  - `ibkrPort`: `4001` (Live Production) or `4002` (Paper Simulation).
  - `ibkrClientId`: Socket client identifier (default `10`).
  - `ibkrPaperUsername` & `ibkrPaperPassword`: Credentials for 24/7 autonomous paper simulation.
  - `ibkrLiveUsername` & `ibkrLivePassword`: Credentials for live DMA execution.
  - `mifid2DecisionMaker` & `mifid2ExecutionTrader`: Regulatory algorithm shortcodes (`ALGO_DEC_992` / `ALGO_EXE_554`).
* **Wiring & Mechanics:** Toggling execution lanes updates `server.ts` state and pushes an atomic payload across Direct TCP Bridge port `4005` to synchronize `main.py` and execute `switch_gateway_mode.py`. Live mode triggers the IB Key mobile push for one-tap biometric approval.

### Pillar 2: Cloud & Edge Infrastructure (12-Factor Decoupled Vault & Zero Cloud DB)
* **Target:** Frankfurt Compute Engine VM (`alpha-edge-node` in `europe-west3-a`) + Cloud Run control plane.
* **Mechanics:**
  - **12-Factor Decoupled Vault (`vault.ts`, `config_loader.py`):** Multi-cloud secrets management using standard POSIX files (`/etc/alpha-engine/secrets.env`, mode `600`) with zero cloud SDK lock-in.
  - **Dynamic Edge Endpoint Resolution:** Eliminates hardcoded `127.0.0.1` references; `get_edge_endpoint()` resolves the active edge daemon dynamically from `EDGE_NODE_HOST` / `EDGE_NODE_IP` and `EDGE_TCP_PORT`.
  - **Zero Firebase / Firestore Invariant:** Completely eliminated. All synchronization is direct TCP socket streaming over port `4005` ($<5\text{ms}$ latency).
  - **Local Atomic Persistence:** Failover leases (`ha_leader_lock.json`), transaction audits (`tca_executions.json`), and risk limits persist via atomic file write-and-replace (`.tmp` write followed by `os.replace` / `fs.renameSync`).

### Pillar 3: AI Model Providers & Execution Runtimes
* **Supported External Cloud Providers:**
  1. **Google (Google GenAI / Gemini):** Macro synthesis and multi-modal market reasoning.
  2. **NVIDIA NIM:** GPU-accelerated enterprise models.
  3. **Groq Cloud:** Ultra-fast LPU inference ($<300\text{ms}$ TTFT) for real-time order-flow decisions.
  4. **OpenRouter:** Universal gateway accessing Claude, GPT, Llama, DeepSeek, and Mistral via a single unified key.
* **Interactive Live Probing & Two-Way UI Reflection:**
  - Probing verifies the API key against the provider's official `/models` endpoint in real time.
  - Discovered models immediately render as active badges under that provider's card.
  - The Copilot catalog cache is invalidated, and discovered models appear instantly in the header dropdown.
* **Embedded Local NLP & Sentiment Tier ($0 Cost, CPU/ONNX):**
  - **INT8 ONNX FinBERT:** Evaluates news bulletins and headlines into `Positive`, `Negative`, or `Neutral` sentiment in sub-10ms with zero network egress.
  - **ModernBERT:** 8,192-token long-context local encoder used for deep semantic extraction directly on CPU.

### Pillar 4: Institutional Domain Data Feeds
Orthogonal feeds strictly for domain data not provided by IBKR:
1. **U.S. SEC EDGAR (`data.sec.gov`):** Primary filings (**8-K** material events, **10-Q** quarterly reports, **10-K** annual statements, **Form 4** insider trades) with compliant `secUserAgent` headers.
2. **ClinicalTrials.gov API v2:** NIH protocol database tracking Phase I/II/III clinical trials and completion dates.
3. **U.S. FDA OpenFDA (`api.fda.gov`):** Adverse Event Reporting System (FAERS), black-box warnings, and drug recalls.
4. **U.S. Energy Information Administration (`api.eia.gov/v2`):** Weekly natural gas storage (WNGS), crude oil inventories, and refinery utilization metrics.

---

## 🤖 4. Autonomous Copilot Architecture

The Copilot (`CopilotPage.tsx`, `src/server/routes/copilot.ts`, `backend/app/api/copilot.py`) provides:
* **Conversational Reasoning & Streaming:** Multi-turn streaming chat grounded in live portfolio telemetry, market phase, and MiFID II compliance.
* **Cost & Quota Governance:** Built-in circuit breakers, daily spending caps, latency telemetry, and token tracking per provider.
* **Direct Function Calling via 78-Tool Registry:** Reflected directly in `tools_registry.json` (`reqMktData`, `reqHistoricalData`, `reqPositions`, `submit_order`, `get_sec_filings`, etc.).
* **Dynamic Groq TPM Headroom Clamping:** Restricts Groq completions to strictly fit under the 8,000 TPM limit, completely eliminating `HTTP 413` errors.
* **OpenRouter Reasoning Token Extraction:** Dynamically extracts reasoning tokens from `message.reasoning` and `message.reasoning_content` for reasoning LLMs.

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
| **`tca_engine.py`** | Transaction Cost Analysis engine; benchmarks arrival prices, slippage, and MiFID II efficiency into `tca_executions.json`. |
| **`switch_gateway_mode.py`** | Orchestrates paper/live gateway switching, updates `jts.ini`, and triggers `ibgateway.service` restarts. |
| **`tools_reflector.py`** | Dynamic reflection engine; inspects `ibapi.client.EClient` to build `tools_registry.json` with normalized parameters. |
| **`tools_registry.json`** | Unified catalog containing 78 callable tools across 10 categories cached with a 24-hour TTL. |
| **`server.ts`** | Production Express + Vite server on port `3000`; mounts modular routers (`/api/diagnostics`, `/api/copilot`, `/api/universe`, etc.). |
| **`src/components/LiveCockpit.tsx`** | Executive control plane (`CONTROL` & `RISK` tabs); hosts KPI ribbon, L2 order depth, OFI accumulation, node telemetry, and SEC 15c3-5 risk gates. |
| **`src/components/ActiveHoldingsTable.tsx`** | Blotter active holdings ledger; real-time marks, trailing stops, unrealized P&L, and MiFID II shortcodes. |
| **`src/components/TcaAuditTable.tsx`** | Blotter TCA ledger; basis point slippage vs. arrival midpoint and transaction friction ratios. |
| **`src/components/QuantResearchLab.tsx`** | Quant research lab (`QUANT LAB` tab); 3 lenses (Catalyst Radar, PEAD Momentum Radar, Microstructure Screener). |
| **`src/pages/StrategyStudioPage.tsx`** | Quant Strategy Studio (`STRATEGY STUDIO` tab); dual-control quant gates, 16-trial DSR sweeps, pre-flight gate modal, and candidate pool deployment. |
| **`src/components/VaultConsole.tsx`** | Full-screen 4-Pillar Vault Console (`VAULT` tab); executive ribbon, live provider probing, badge reflection, and POSIX secrets export. |
| **`src/components/ApiVaultModal.tsx`** | Backwards-compatible modal wrapper around `VaultConsole`. |
| **`src/pages/CopilotPage.tsx`** | Autonomous Copilot frontend (`COPILOT` tab); executive ribbon layout, prompt presets, contextual deep links, and multi-model chat. |
| **`src/components/InstitutionalModelSelector.tsx`** | Model selector with live provider probing and discovered badge display. |
| **`src/components/InstitutionalCandleChart.tsx`** | Candlestick visualizer for historical bars, tranches, and trade overlays. |
| **`src/components/CommandPalette.tsx`** | Spotlight command palette (`Cmd+K`) and global hotkey dispatcher (`Alt+1..7`). |
| **`RUNBOOK.md`** | Master operational runbook for engineers and traders. |
| **`README.md`** | Authoritative institutional platform overview and quickstart guide. |
| **`AGENTS.md`** | Institutional coding constraints, risk formulas, and platform invariants. |
| **`CHANGELOG.md`** | Authoritative institutional evolution and version history ledger. |
