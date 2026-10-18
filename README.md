# Alpha Engine: Institutional Algorithmic Trading Platform

Alpha Engine is an institutional two-tier algorithmic execution, quantitative research, and AI copilot platform. The execution pipeline is co-located adjacent to the **Interactive Brokers (IBKR) Europe Hub in Frankfurt (`europe-west3`)**, controlled via a Google Cloud Run web control plane.

---

## 🚀 Quickstart Runbook

### 1. Launch Web Control Plane & Dashboard (Port 3000)
```bash
npm run build
node dist/server.cjs
```
- Local URL: `http://localhost:3000`
- Production Cloud Run Endpoint: `https://alpha-engine-aistudio-138990607360.europe-west3.run.app`

### 2. Launch Edge Execution Daemon (Port 4005)
```bash
python main.py
```
- Starts the **Direct TCP Bridge Server (`edge_bridge.py` on port 4005)**.
- Connects to IBKR Gateway on port `4001` (Live) or `4002` (Paper Simulation).
- Enforces local High-Availability (`ha_manager.py`), Dynamic Risk Management (`dynamic_risk_manager.py`), and atomic audit logging.

### 3. Dynamic Tool Reflection & Catalog Invalidation
```bash
python tools_reflector.py --force
```
- Inspects `ibapi.client.EClient` and institutional adapters to dynamically refresh `tools_registry.json` (78 callable tools across 10 categories, 24h TTL).

---

---

## 🏛️ System Core Modules at a Glance

1. **Market Data Single Source of Truth:** Funded **Interactive Brokers Pro (`ibapi`)** tape over Direct TCP Bridge (`port 4005`). Retail scraping (Yahoo Finance, etc.) is permanently banned.
2. **12-Factor Decoupled Vault Engine (`vault.ts`, `config_loader.py`):**
   - **Multi-Cloud Portability & Zero Vendor Lock-in:** Code never depends on proprietary cloud SDKs. All 31 configuration keys across the 4 pillars are managed via standard POSIX environment injection (`/etc/alpha-engine/secrets.env` locked to `chmod 600 root:root`).
   - **Deterministic Priority Hierarchy:**
     1. `/etc/alpha-engine/secrets.env` (Hardened production file)
     2. `process.env` / `os.environ` (Host / container injection)
     3. `.env` (Local development fallback)
     4. `system_settings.json` (Disk persistence)
   - **Atomic In-Memory & Disk Persistence:** Updates from the dashboard (`ApiVaultModal`) atomically update runtime RAM and write via `.tmp` file replacement (`fs.renameSync` / `os.replace`), keeping Cloud Run and the Frankfurt Edge VM synchronized over TCP port 4005.
3. **Dynamic Edge Endpoint Resolution (Zero Hardcoded IPs):**
   - Eliminates hardcoded `127.0.0.1` references across the backtester, copilot, and test harnesses.
   - Centralized resolver `get_edge_endpoint()` resolves the active edge daemon dynamically from `EDGE_NODE_HOST` / `EDGE_NODE_IP` (e.g. Frankfurt VM `34.141.105.241:4005`) with graceful fallbacks.
4. **Automated Dual-Mode Authentication Pipeline:**
   - **Paper Mode (Port 4002):** 100% autonomous 24/7 simulation. `gateway_autologin.py` automatically injects paper credentials and dismisses modal disclaimers without requiring 2FA.
   - **Live Mode (Port 4001):** Real capital execution. `switch_gateway_mode.py` orchestrates the lane change, restarts services, injects live credentials, and dispatches an **IB Key push notification** to the trader's smartphone for one-tap biometric approval.
5. **Autonomous Copilot (`CopilotPage.tsx`):**
   - Multi-turn conversational trader with streaming reasoning and token cost budgeting.
   - Direct function calling into 78 tools in `tools_registry.json`.
6. **Quant Lab & GCE Companion (`GcpCompanion.tsx`, `backtester.py`):**
   - Historical backtester running against authentic broker bars (zero synthetic random-walk fabrication).
   - Dynamic Universe Builder, LLM Critic-Verifier consensus, and Custom Strategy Hot-Reloading.

---

## 🧪 Testing & Verification

Run the comprehensive unit and integration test suite:
```bash
# 1. Verify 12-factor vault, dynamic endpoint resolution, and TCP bridge synchronization
py -3.12 -m pytest tests/test_12factor_vault.py -v

# 2. Verify low-latency TCP bridge lifecycle and protocol commands
py -3.12 -m pytest tests/test_direct_tcp_bridge.py -v
```

For complete architectural specifications, consult [`SYSTEM_SNAPSHOT.md`](./SYSTEM_SNAPSHOT.md) and [`AGENTS.md`](./AGENTS.md).

