# Alpha Engine Coding & Architecture Rules

This file documents the engineering guidelines, architectural constraints, and development standards for the **Alpha Engine Hybrid Framework**. Adhere strictly to these rules code-wide to maintain system integrity, compile safety, and performance.

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
    *   Bridges real-time market risk, balances, and telemetry back into the system using a direct **Firestore Secure Tunnel**.

---

## 🔌 2. Port & Execution Pipeline Constraints

*   **Port 3000 Limit (Vite/Node):** Port `3000` is the ONLY externally mapped port. Never attempt to configure public exposure on other ports.
*   **Gateway Local Sockets:**
    *   **Port 4001 (LIVE Production):** Active connection endpoint for live execution.
    *   **Port 4002 (PAPER Simulation):** Active connection endpoint for simulation.
    *   The user must be able to click and toggle these execution lanes instantly from the dashboard. This updates the settings state on `server.ts` and pushes a structural update directly to the Firestore collection `system_risk_state/current_state`.

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

## 🐳 4. GCE Companion & Docker Orchestrator UI

The `GcpCompanion` component hosts the system control panels. Maintain 5 core tabs:
1.  **Direct-to-Git Sync Panel:** Bridges secure workspace synchronization to GitHub for easy Cloud Shell pulls.
2.  **Container Orchestration:** Automates Method B Headless Docker + IBC runtime setups in GCP, showing real-time console emulation.
3.  **Quant Backtester:** Select ticker, candle interval, and calendar triggers, run the backtester sub-process, and trace the Recharts equity line.
4.  **GCP Shell Script:** Details ready-to-run copyable terminal commands for provisioning GCE.
5.  **Topology Matrix:** Visualizes Frankfurt node network pathways and real latency targets.

---

## 📁 5. Folder Hierarchy & Modular Writing Rules

Keep code split modularly to prevent token-limit trashing or syntax corruption:
*   Do NOT dump all UI functions directly into `App.tsx`.
*   Maintain `src/components/GcpCompanion.tsx` for all cloud and backtesting control modules.
*   Maintain `src/components/Dashboard.tsx` for layout, regulatory telemetry, active trades ledger, and live indicators.
*   Run `lint_applet` and `compile_applet` to verify compilation health after edits.

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
2. **Full-Surface Reflection (No Artificial Capping)**:
   - Tool schemas must be extracted dynamically by reflecting the entire official Interactive Brokers API surface (`ibapi.client.EClient` / `ConnectionManager`) and data feed adapters using Python's `inspect` module.
   - Never restrict or hardcode tool exposure to an arbitrary subset (e.g. 5 or 15 methods). The full callable surface of inquiries, account data, contract specs, and order telemetry must be exposed.
3. **Official Built-in Docstrings**:
   - Schema descriptions and parameter definitions must be populated directly from official IBKR docstrings and type annotations to guarantee vendor-accurate semantics.
4. **24-Hour Persistence & Invalidation**:
   - The reflected catalog must be cached on disk with a 24-hour TTL to ensure microsecond lookup latency during agent turns.
   - The cache must support forced invalidation and on-demand refresh via the 4-Pillar Vault test probe.

