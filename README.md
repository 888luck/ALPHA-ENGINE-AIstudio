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

## 🏛️ System Core Modules at a Glance

1. **Market Data Single Source of Truth:** Funded **Interactive Brokers Pro (`ibapi`)** tape over Direct TCP Bridge (`port 4005`). Retail scraping (Yahoo Finance, etc.) is permanently banned.
2. **4-Pillar API Connection & Feed Vault (`ApiVaultModal.tsx`):**
   - **Pillar 1 (Broker):** IBKR Account, Host IP, Live/Paper ports (4001/4002), Client ID, MiFID-II shortcodes.
   - **Pillar 2 (Infrastructure):** Frankfurt GCE VM, zero-database atomic JSON persistence, Secret Manager.
   - **Pillar 3 (AI Providers):** Google GenAI, NVIDIA NIM, Groq, OpenRouter, Custom Cloud Endpoints, Custom Local Endpoints (Ollama/llama.cpp/vLLM), and offline INT8 ONNX FinBERT / ModernBERT.
   - **Pillar 4 (Institutional Feeds):** SEC EDGAR, ClinicalTrials.gov v2, OpenFDA, EIA v2, FRED, PatentsView.
3. **Autonomous Copilot (`CopilotPage.tsx`):**
   - Multi-turn conversational trader with streaming reasoning and token cost budgeting.
   - Direct function calling into 78 tools in `tools_registry.json`.
4. **Quant Lab & GCE Companion (`GcpCompanion.tsx`, `backtester.py`):**
   - Historical backtester running against authentic broker bars (zero synthetic random-walk fabrication).
   - Dynamic Universe Builder, LLM Critic-Verifier consensus, and Custom Strategy Hot-Reloading.

For complete architectural specifications, consult [`SYSTEM_SNAPSHOT.md`](./SYSTEM_SNAPSHOT.md) and [`AGENTS.md`](./AGENTS.md).
