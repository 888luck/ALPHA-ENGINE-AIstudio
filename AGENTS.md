# Alpha Engine Coding & Architecture Rules

This file documents the engineering guidelines, architectural constraints, and institutional development standards for the **Alpha Engine Hybrid Framework**. Adhere strictly to these rules code-wide to maintain system integrity, compile safety, low-latency execution, and regulatory compliance.

---

## 🏗️ 1. Core Architecture Blueprint

The Alpha Engine operates as a **two-tier hybrid trading platform**:

1.  **Frontend / Web API Service (Vite + Express):**
    *   Acts as the central control plane, dashboard visualizer, and backtester API runner.
    *   Deployed on **Google Cloud Run** to access auto-scaling capabilities (scale-to-zero during market close) for $0 overhead.
    *   Exposes all dashboard operations via port `3000`.
2.  **Edge Execution Daemon (Python Edge Node):**
    *   Deployed on a preemptible/Spot **GCP Compute Engine e2-micro** in Frankfurt `europe-west3` (co-located adjacent to the IBKR Europe Hub).
    *   Runs the continuous TCP execution pipeline (`main.py` + `local_edge_node.py`).
    *   Bridges real-time market risk, balances, order telemetry, and market data back into the system using a direct **Direct TCP Bridge (`edge_bridge.py` on port 4005)** with sub-5ms socket latency.

---

## 🔌 2. Port & Execution Pipeline Constraints

*   **Port 3000 Limit (Vite/Node):** Port `3000` is the ONLY externally mapped HTTP/WebSocket port. Never attempt to configure public exposure on other ports.
*   **Gateway Local Sockets:**
    *   **Port 4001 (LIVE Production):** Active connection endpoint for live execution.
    *   **Port 4002 (PAPER Simulation):** Active connection endpoint for simulation.
    *   **Port 4005 (Edge TCP Bridge):** Low-latency binary/JSON socket bridge connecting the Cloud Run web plane and edge daemons.
    *   The user must be able to click and toggle execution lanes instantly from the dashboard. This updates the settings state on `server.ts` and pushes a synchronized atomic update to local risk state storage.

---

## 📊 3. Quantitative Backtesting & Strategy Rules

To test strategy changes prior to live/paper routing, developers must use the integrated Python Simulation Engine (`backtester.py`) via the REST endpoints.

### Strategy Implementation Standard (The Alpha Strategy):
*   **SMA-20 Congruence:** Checks simple moving averages on daily or intraday frequencies to set trend direction (Long above, Short below).
*   **OFI Breakout Signal:** Volume expansion spike exceeding $1.4\times$ the 10-period volume MA acts as a breakout trigger.
*   **1% Capital Risk Constraint:** The position size must be dynamically sized so that the distance to the stop price risks at most **1%** of total cumulative capital.
*   **ATR-Based Stop-Loss (1.8 ATR):** Stops are placed at $1.8\times$ ATR from entry price, with targets configured at $2\times$ that distance.
*   **15% Transaction Friction Filter:** To protect capital under IBKR Europe (IBIE) regulatory commissions structures:
    $$\text{Efficiency Ratio} = \frac{\text{Projected Friction (Spread Slippage + } 2\times\text{ Commission)}}{\text{Projected Max Profit (2.0 } \times \text{ Stop Distance)}} \times 100$$
    If the Efficiency Ratio exceeds **15%**, the trade MUST be rejected at the router.

---

## 🔬 4. Quant Research Lab & Strategy Studio Architecture

Quant research, parameter sweeps, and execution pool deployment are divided across two institutional modules:
1.  **Quant Research Lab (`QuantResearchLab.tsx` / `Alt+4`):** Hosts 3 real-time market lenses:
    *   *Catalyst Radar:* SEC 8-K/10-Q primary filings, clinical trial readouts, and FDA alerts.
    *   *PEAD Momentum Radar:* Post-Earnings Announcement Drift tracking and earnings surprise momentum.
    *   *Microstructure Screener:* Order flow imbalance spikes and bid-ask spread efficiency.
2.  **Strategy Studio (`StrategyStudioPage.tsx` / `Alt+5`):** Hosts 16-trial Deflated Sharpe Ratio (DSR) sweeps (Bailey & López de Prado), authentic historical broker bars, dual-control quant gates (tactile sliders + exact numeric input for 5–30% friction ceiling and 50–99.9% DSR hurdle), and 1-click candidate pool deployment (`dynamic_baskets.json`) over TCP port 4005.

---

## 📁 5. The 7 Institutional Tabs & Modular Component Hierarchy

Maintain code cleanly split across the 7 modular operational components to ensure compile safety and token efficiency:
*   Do NOT dump monolithic logic into `App.tsx`.
*   Maintain `src/components/LiveCockpit.tsx` for executive KPI ribbon, L2 order depth & OFI tape, and SEC Rule 15c3-5 risk gates.
*   Maintain `src/components/ActiveHoldingsTable.tsx` for active positions and MiFID II RTS-22 shortcodes.
*   Maintain `src/components/TcaAuditTable.tsx` for post-trade transaction cost analysis (TCA).
*   Maintain `src/components/QuantResearchLab.tsx` for the 3 market lenses.
*   Maintain `src/pages/StrategyStudioPage.tsx` for quant parameter sweeps and dual-control gates.
*   Maintain `src/components/VaultConsole.tsx` for the full-screen 4-Pillar Vault and 12-factor POSIX secrets.
*   Maintain `src/pages/CopilotPage.tsx` for conversational trading reasoning and dynamic model discovery.
*   Verify compilation health with `npm run lint` (`tsc --noEmit`) and `npm run build` after edits.

---

## 🤖 6. Dynamic LLM Model Discovery & Zero-Hardcoding Invariant

To ensure platform resilience against rapid LLM release and retirement cycles:

1. **Zero Hardcoded Model Names**:
   - Never hardcode model strings, versions, or tiers (e.g. `gemini-2.0`, `llama-3.3`, etc.) in frontend components, backend routers, configuration defaults, or documentation.
   - Any prior list from training cutoffs is strictly prohibited.
2. **Runtime Provider Discovery via 4-Pillar Vault**:
   - All available LLM models must be retrieved dynamically at runtime by querying each active provider's official `/models` API endpoint (Google GenAI, Groq, NVIDIA NIM, OpenAI, Anthropic, etc.).
   - Credentials must be sourced directly from the existing **4-Pillar API Connection & Feed Vault**.
   - Only models verified active and supporting chat/function-calling for the user's specific credentials may be exposed in the UI.
3. **Automatic Lifecycle Handling**:
   - Deprecated or sunset models must drop off automatically without code modification.
   - Newly released upstream models must appear immediately upon provider catalog refresh.
   - If a provider has no active key or fails the Vault live probe, the system must report this transparently, prevent execution with stale mocks, and guide the user through the configuration flow.
4. **4-Pillar Vault Configuration & Provisioning Workflow**:
   - When an unconfigured or unauthenticated provider is selected, the Copilot must not dead-end; it must execute the standard Vault workflow:
     a. **Status Detection**: The UI flags the provider status as `UNCONFIGURED` or `PROBE_FAILED`.
     b. **Direct Vault Action**: The Copilot provides a one-click action to open the 4-Pillar Vault modal (`ApiVaultModal`) with the direct acquisition guide and input fields for that provider.
     c. **Interactive Live Test Probe**: The user inputs the key and runs the Vault's built-in live probe (`probe_connection`) to verify credentials against the provider API.
     d. **Two-Way Vault UI Reflection**: When a key passes the test probe or is saved, the probe response returns the live discovered models, and the 4-Pillar Vault modal immediately renders these active models as verified badges under that provider's card (e.g. `Discovered Models: [model-1, model-2]`).
     e. **Dynamic Invalidation & Instant Copilot Sync**: Upon a successful probe, the credentials and discovered models are persisted to Vault storage, the Copilot catalog cache is invalidated, and the new models instantly appear in the Copilot header dropdown without requiring page reloads or container redeployments.

---

## 🛠️ 7. Cross-Container Tool Catalog & Full API Reflection Standard

To support autonomous, high-depth conversational reasoning across current and future services:

1. **Root-Level Shared Catalog (`tools_registry.json`)**:
   - The tool schema registry must be stored at the root level (`tools_registry.json`) and mounted/copied into `/app/` across all container images so all current and future modules (Copilot, Trading Engine, Risk Guard, Daemons) share a unified source of truth.
   - Containers may also query `GET /api/v1/tools/registry` on the edge/control plane for cross-pod discovery.
2. **Full-Surface Dynamic Reflection (No Static Capping)**:
   - Tool schemas must be extracted dynamically by reflecting the entire official Interactive Brokers API surface (`ibapi.client.EClient` / `ConnectionManager`) and data feed adapters using Python's `inspect` module.
   - Never restrict or hardcode tool exposure to an arbitrary subset. The full callable surface of inquiries, account data, contract specs, and order telemetry must be exposed.
3. **Official Vendor Docstrings & Parameter Normalization**:
   - Schema descriptions and parameter definitions must be populated directly from official IBKR docstrings and type annotations to guarantee vendor-accurate semantics.
   - Parameters must be normalized to prevent schema validation crashes on LLM runtimes (e.g., options lists default to `[]`, symbol strings map to `Contract`, `reqId` is auto-assigned).
4. **24-Hour Persistence & Invalidation**:
   - The reflected catalog must be cached on disk with a 24-hour TTL to ensure microsecond lookup latency during agent turns.
   - The cache must support forced invalidation and on-demand refresh via `python tools_reflector.py --force` or the 4-Pillar Vault test probe.

---

## 🏛️ 8. Institutional Market Data Invariant (Single Source of Truth)

1. **Strictly Funded IBKR Pro Single Source of Truth**:
   - The primary and definitive market data source for all quotes, historical bars, order book depth, news bulletins, and fundamental ratios is the funded **Interactive Brokers Pro account (`ibapi`)** accessed via the Direct TCP Bridge (`edge_bridge.py` on port 4005).
2. **Total Ban on Retail Scrapers & Consumer APIs**:
   - Web scraping of retail/consumer finance portals (including Yahoo Finance, Google Finance scrapers, unofficial html scraping) is strictly prohibited across all services.
   - External institutional data feeds are permitted only for domain-specific orthogonal data not provided by IBKR (e.g. SEC EDGAR primary filings, ClinicalTrials.gov API v2, OpenFDA, and EIA energy telemetry).
3. **Zero Synthetic / Real-State Policy**:
   - If the Interactive Brokers Gateway or edge node is disconnected or offline, the platform MUST report the official disconnected status transparently to the user and LLM.
   - It is strictly forbidden to invent synthetic prices, simulate fake executions, or silently fallback to consumer scrapers when live broker connectivity is interrupted.

---

## 🚫 9. Zero Cloud Database / Zero Firebase Invariant

1. **Complete Elimination of Firebase / Firestore / Datastore**:
   - No Firebase dependencies (`firebase`, `firebase-admin`, `firebase-tools`), configuration files (`firebase.json`, `.firebaserc`, `firestore.rules`), or remote database tunnels may exist anywhere in the codebase.
2. **Deterministic Local Atomic Persistence**:
   - High-Availability leader elections use atomic local file locks (`ha_leader_lock.json`) and OS PID liveliness checks.
   - Execution transaction analysis (TCA) records into atomic local audit logs (`tca_executions.json`).
   - Risk management parameters and open trade state persist to local atomic JSON files with direct atomic write-and-replace patterns (`.tmp` write followed by `os.replace`), eliminating race conditions, network lock contention, and cloud database billing overhead.
3. **Direct TCP Socket Telemetry**:
   - High-frequency communication between Cloud Run and the Frankfurt Edge VM uses direct, encrypted TCP streaming (`edge_bridge.py` port 4005) with microsecond serialization and zero cloud database middleware.

---

## 🔒 10. 12-Factor Decoupled Vault & Zero Hardcoded Endpoints Invariant

1. **Strict 12-Factor POSIX Secrets Hierarchy**:
   - Secrets and API keys must NEVER be hardcoded in repository files, committed to git, or bound to proprietary cloud SDKs (e.g. `google-cloud-secretmanager`).
   - All credentials across the 4 pillars (Brokerage, Infrastructure, AI Providers, Feeds) must resolve via the standard 12-factor priority hierarchy:
     1. `/etc/alpha-engine/secrets.env` (Hardened POSIX environment file, `chmod 600 root:root`)
     2. `process.env` / `os.environ` (Host / container injection)
     3. `.env` (Local development fallback)
     4. `system_settings.json` (Local disk persistence)
2. **Zero Hardcoded Host/Socket Endpoints**:
   - Callers (backtester, copilot, integration tests, CLI tools) must NEVER hardcode `127.0.0.1` or socket ports.
   - All connections to the edge execution node must resolve dynamically via `get_edge_endpoint()` from `EDGE_NODE_HOST` / `EDGE_NODE_IP` and `EDGE_TCP_PORT`.
3. **Atomic In-Memory & Disk Synchronization**:
   - Whenever credentials or configurations are updated via the dashboard (`ApiVaultModal` / `/api/vault/credentials`), changes must:
     a. Update running process memory (`process.env` / `os.environ`) instantly without requiring service restarts.
     b. Write atomically to the secrets file using atomic write-and-replace (`.tmp` write followed by `fs.renameSync` / `os.replace`) with strict `0o600` permissions.
     c. Push the updated settings payload across the Direct TCP Bridge (`port 4005`) to synchronize the Frankfurt Edge VM in real time.

