# Alpha Engine: Institutional Algorithmic Trading Platform

Alpha Engine is an institutional two-tier algorithmic execution, quantitative research, and AI copilot platform. The execution pipeline is co-located adjacent to the **Interactive Brokers (IBKR) Europe Hub in Frankfurt (`europe-west3`)**, controlled via a high-availability web control plane deployed on Google Cloud Run.

---

## 🏛️ Executive Architectural Blueprint

```
+-----------------------------------------------------------------------------------+
|                        TIER 1: WEB CONTROL PLANE & SPA                            |
|             Google Cloud Run (Frankfurt europe-west3) | Port 3000                |
|                                                                                   |
|  - 7 Institutional Control Tabs (Vite + React SPA)                                |
|  - High-Throughput Node.js API Gateway (dist/server.cjs)                          |
|  - Master 12-Factor Decoupled Vault Engine (/api/vault)                           |
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
|  - Offline NLP Encoders: INT8 ONNX FinBERT & ModernBERT (CPU $0 cost)             |
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
|  - Direct DMA to Funded IBKR Pro Tape & SMART Order Router                        |
+-----------------------------------------------------------------------------------+
```

---

## 🖥️ The 7 Institutional Control Planes (Tabs)

The web control plane provides 7 specialized operational tabs with dedicated global hotkeys (`Alt+1` through `Alt+7`) and a Spotlight Command Palette (`Cmd+K` / `Ctrl+K`):

| Tab | Hotkey | Component | Core Operational Responsibility |
| :--- | :---: | :--- | :--- |
| **`CONTROL`** | `Alt+1` | [`LiveCockpit.tsx`](./src/components/LiveCockpit.tsx) | **Executive KPI Ribbon**: Net Liquidation, Maintenance Margin, Margin Utilization %, Day Realized/Unrealized P&L, Open Risk Pool. Real-time L2 order book depth, OFI accumulation tape, Frankfurt node latency telemetry, and market phase resolver (Pre-Market, Continuous, Post-Market, Weekend). |
| **`BLOTTER`** | `Alt+2` | [`ActiveHoldingsTable.tsx`](./src/components/ActiveHoldingsTable.tsx)<br>[`TcaAuditTable.tsx`](./src/components/TcaAuditTable.tsx) | **Active Holdings Ledger**: Real marks, trailing stops, unrealized P&L, and MiFID II RTS-22 algorithm shortcodes (`ALGO_DEC_992` / `ALGO_EXE_554`).<br>**TCA Audit Ledger**: Transaction Cost Analysis recording basis point slippage vs. arrival midpoint and transaction friction ratios. |
| **`RISK`** | `Alt+3` | [`LiveCockpit.tsx`](./src/components/LiveCockpit.tsx) | **SEC Rule 15c3-5 Pre-Trade Risk Gates**: Capital at Risk (1% constraint), Max Position Size, Daily Loss Ceilings, Transaction Friction Filter, Liquidity / OFI Floor, and MOC Blackout Flattening. Two-stage emergency kill switch. |
| **`QUANT LAB`** | `Alt+4` | [`QuantResearchLab.tsx`](./src/components/QuantResearchLab.tsx) | **3 Focused Quantitative Lenses**: Catalyst Radar (SEC 8-K/10-Q primary filings, ClinicalTrials.gov, OpenFDA alerts), PEAD Momentum Radar (Post-Earnings Announcement Drift), and Microstructure Screener (OFI & spread efficiency). Seamless 1-click bridge to Strategy Studio. |
| **`STRATEGY STUDIO`** | `Alt+5` | [`StrategyStudioPage.tsx`](./src/pages/StrategyStudioPage.tsx) | **Quant Simulation & Parameter Sweeps**: Dynamic Trailing Profit Engine (Chandelier, ATR, Fixed R, Parabolic) with tactile dual-sliders, numeric inputs, and simulation blotter badges (`TRAILING STOP LOSS HIT`). Dual-control quant gates (5–30% friction ceiling and 50–99.9% DSR confidence hurdle), Bailey & López de Prado Deflated Sharpe Ratio (DSR) 16-trial sweeps, authentic historical broker bars, and candidate pool deployment (`dynamic_baskets.json`) over TCP port 4005. |
| **`VAULT`** | `Alt+6` | [`VaultConsole.tsx`](./src/components/VaultConsole.tsx) | **Full-Screen 4-Pillar Vault Console**: Executive Vault Ribbon (`[RESTORE BROWSER KEYS]`, `[PROBE ACTIVE SERVICES]`, `[COPY SECRETS.ENV]`), interactive live credential probing (`probe_connection`), runtime `/models` discovery (zero hardcoded model names), and 12-Factor POSIX export (`/etc/alpha-engine/secrets.env`, `chmod 600`). |
| **`COPILOT`** | `Alt+7` | [`CopilotPage.tsx`](./src/pages/CopilotPage.tsx) | **Autonomous Trading Copilot**: Multi-turn streaming reasoning, contextual action deep links (`[OPEN STRATEGY STUDIO]`, `[OPEN LIVE BLOTTER]`, `[INSPECT RISK GATES]`), quantitative prompt presets, dynamic Groq 8,000 TPM headroom clamping, OpenRouter reasoning tokens extraction, and direct function calling into 83 reflected tools in `tools_registry.json`. |

---

## 🔒 Institutional Engineering Invariants

Adhere strictly to the institutional engineering invariants codified in [`AGENTS.md`](./AGENTS.md):

1. **Rule 1: Verification-Before-Assertion (Ground Truth over Speculation)**
   - Never announce, reference, or assume a file, service, port, or process state exists until verified via direct tool execution.
2. **Rule 6: Dynamic LLM Model Discovery (Zero Hardcoding)**
   - Model strings are never hardcoded. All available models are discovered at runtime by querying each active provider's official `/models` API endpoint via the 4-Pillar Vault.
3. **Rule 8: Funded IBKR Pro Single Source of Truth**
   - The primary and definitive market data source is the funded **Interactive Brokers Pro account (`ibapi`)** over Direct TCP Bridge port 4005. Retail web scraping (Yahoo Finance, Google Finance) and synthetic price fabrication are strictly banned.
4. **Rule 9: Zero Cloud Database / Zero Firebase Invariant**
   - Zero Firebase/Firestore dependencies. High-Availability leader elections (`ha_leader_lock.json`), transaction audits (`tca_executions.json`), and risk state persist via deterministic local atomic `.tmp` write-and-replace (`fs.renameSync` / `os.replace`).
5. **Rule 10: 12-Factor Decoupled Vault & Zero Hardcoded Endpoints**
   - Credentials resolve via the strict 12-factor priority hierarchy:
     1. `/etc/alpha-engine/secrets.env` (Hardened POSIX file, `chmod 600 root:root`)
     2. `process.env` / `os.environ` (Host / container injection)
     3. `.env` (Local development fallback)
     4. `system_settings.json` (Local disk persistence)
   - Edge connections dynamically resolve via `get_edge_endpoint()` from `EDGE_NODE_HOST` / `EDGE_NODE_IP` and `EDGE_TCP_PORT`.

---

## 🚀 Quickstart & Service Runbook

For comprehensive operational protocols, consult the dedicated [`RUNBOOK.md`](./RUNBOOK.md).

### 1. Web Control Plane (Port 3000)
```bash
# Compile SPA & Express bundle
npm run build

# Start production web control plane
node dist/server.cjs
```
- Local URL: `http://localhost:3000`
- Production Cloud Run Endpoint: `https://alpha-engine-aistudio-138990607360.europe-west3.run.app`

### 2. Edge Execution Daemon on Frankfurt VM (Port 4005)
```bash
# Start edge trading daemon and Direct TCP Bridge
python3 main.py
```
- Direct TCP Bridge Server: Port `4005`.
- Connects to IBKR Gateway: Port `4001` (Live) or `4002` (Paper).

### 3. Frankfurt VM Service Management (systemd)
```bash
# Inspect all Alpha Engine services
sudo systemctl status alpha-engine.service alpha-ui.service ibgateway.service

# Restart services after code sync
sudo systemctl restart alpha-engine.service alpha-ui.service
```

### 4. Dynamic Tool Catalog Invalidation
```bash
python3 tools_reflector.py --force
```
- Dynamically reflects `ibapi.client.EClient`, quant strategy tools, and institutional feeds into `tools_registry.json` (**83 callable tools across 11 categories**, 24h TTL).

---

## 🧪 Testing & Verification Suite

Verify platform compilation and algorithmic integrity prior to deployment:

```bash
# 1. TypeScript & Vite compilation verification
npm run lint
npm run build

# 2. 12-Factor Vault & dynamic endpoint tests
py -3.12 -m pytest tests/test_12factor_vault.py -v

# 3. Direct TCP Bridge protocol & lifecycle tests
py -3.12 -m pytest tests/test_direct_tcp_bridge.py -v

# 4. Trailing stop-loss & risk simulation tests
py -3.12 test_stage4_trailing.py

# 5. Dynamic Trailing Profit backtester verification (ASML.AS)
py -3.12 backtester.py ASML.AS 1.8 2.0 1.4 20 10 15.0 5 0 20000 0.0008 1.5 5 1h 60 None 1.5 1.2 0.5 CHANDELIER
```

---

## 📚 Master Documentation Index

- [`RUNBOOK.md`](./RUNBOOK.md): Complete operational procedures, 2FA workflows, and disaster recovery.
- [`SYSTEM_SNAPSHOT.md`](./SYSTEM_SNAPSHOT.md): Detailed system topology, network map, and production file manifest.
- [`AGENTS.md`](./AGENTS.md): Institutional coding constraints, risk formulas, and platform invariants.
- [`CHANGELOG.md`](./CHANGELOG.md): Audit trail of versioned releases and feature deployments.
