# 🚀 Alpha Engine — Institutional Multi-Strategy Trading Platform

Alpha Engine is an institutional-grade, **hybrid algorithmic trading framework** designed for quantitative intraday Order Flow Imbalance (OFI) scalp trading, Post-Earnings Announcement Drift (PEAD) catalyst execution, and automated Central Bank of Ireland (CBI) / MiFID II regulatory compliance on **Interactive Brokers Pro Ireland (IBIE)**.

The platform links an interactive React web dashboard with an asynchronous Python execution edge node co-located adjacent to the Interactive Brokers Europe Core Hub in **Frankfurt, Germany (`europe-west3`)**, coordinated securely using a direct Google Firestore real-time data tunnel.

---

## 🏛️ 1. Architecture Overview

```
                                    ┌────────────────────────────────────────────────────────┐
                                    │               PRIMARY SOURCE CATALYSTS                 │
                                    │  • SEC EDGAR Official Form 8-K Disclosures             │
                                    │  • ClinicalTrials.gov Protocol Registry v2             │
                                    │  • OpenFDA Drug Clearances & PDUFA Calendars           │
                                    │  • Federal Reserve & Macro Event Schedules             │
                                    └───────────────────────────┬────────────────────────────┘
                                                                │
                                                                ▼
┌─────────────────────────────────┐                 ┌────────────────────────────────────────┐
│     INTERACTIVE WEB DASHBOARD   │                 │      STRATEGY ENGINES & QUANT LAB      │
│  • LIVE COCKPIT (Risk & Blotter)│                 │  • PEAD Momentum Radar (Large/Mega >$5B│
│  • QUANT LAB (PEAD & Catalysts) │◄───────────────►│  • L2 Order Flow Imbalance (OFI) Engine│
│  • Auto-Flatten Toggle (15:45)  │    Firestore    │  • Gate 5 Binary Event Blackout        │
│  • Emergency Kill Switch        │    Realtime     │  • Watchlist Promotion API             │
└─────────────────────────────────┘      Tunnel     └───────────────────┬────────────────────┘
                                                                        │
                                                                        ▼
                                                    ┌────────────────────────────────────────┐
                                                    │       PRE-TRADE RISK & LIFECYCLE       │
                                                    │  • Daily Capital Ceiling ($10,000)     │
                                                    │  • Hard Loss Circuit Breaker ($250)    │
                                                    │  • ADV Participation Cap (1.5% 5m ADV) │
                                                    │  • Synthetic Fractional Stop Manager   │
                                                    │  • Breakeven Latch (+1.0x ATR)         │
                                                    │  • Tiered Scale-Out (+2.0x ATR, 50%)   │
                                                    │  • Intraday MOC Controller (15:45 EST) │
                                                    └───────────────────┬────────────────────┘
                                                                        │
                                                                        ▼
                                                    ┌────────────────────────────────────────┐
                                                    │         FRANKFURT EDGE NODE (VM)       │
                                                    │  • IBKR Gateway (Port 4002 / 4001)     │
                                                    │  • Broker Isolation Airbag (DU vs U)   │
                                                    │  • Auto-Reconnect (Exponential Backoff)│
                                                    │  • Live Audit Blotter with TCA (bps)   │
                                                    └────────────────────────────────────────┘
```

---

## ⚡ 2. Core Institutional Capabilities

### A. Pre-Trade Risk Gateway (SEC Rule 15c3-5 & MiFID II)
Every order must clear five non-bypassable pre-trade risk gates before transmission to the broker wire:
1. **Router Lock / Kill Switch Check**: Halts orders immediately if the emergency circuit breaker has been tripped.
2. **Daily Capital Ceiling**: Pre-trade gross capital cap (default `$10,000`). Orders pushing aggregate commitment beyond the limit are blocked before entering the wire.
3. **Daily Max Loss Cutoff**: Hard currency stop loss (default `$250`). Automatically liquidates positions and locks the execution router if session loss breaches threshold.
4. **ADV / Market Impact Participation Cap**: Order size cannot exceed **1.5%** of the 5-minute Average Daily Volume (ADV), ensuring minimal market impact.
5. **Short Locate & Borrow Fee Verification**: Validates shortable shares and rejects borrow rates exceeding **15%** annual fee.

### B. Post-Earnings Announcement Drift (PEAD) Strategy Engine
Exploits the classic, empirically verified capital markets anomaly where prices drift in the direction of unexpected earnings announcements:
- **Liquidity Floor**: Mega/large caps only ($> \$5\text{B}$ market cap), eliminating illiquid penny stocks.
- **Volume Surge**: Opening 15-minute volume must exceed $> 2.0\times$ 20-day ADV.
- **Spread Stabilization Window**: 15-minute post-market-open spread stabilization window (09:45 EST) ensures bid-ask spreads normalize below $5\%$ of ATR.
- **Microstructure OFI Confirmation**: Top-of-book dealer queue accumulation must exceed $+1.5\sigma$.
- **Gate 5 Binary Event Blackout**: Automatically blocks intraday entries 30 minutes prior to scheduled binary releases (earnings releases, FDA advisory panels, Phase 3 trial readouts) to eliminate unpriced overnight gap risk.

### C. Intraday Flattening Controller & Multi-Day Position Lifecycle
- **Zero Overnight Exposure**: By default, the engine enforces strict Market-on-Close (MOC) discipline, liquidating intraday positions at **15:45 EST** (US Equities) and **17:15 CET** (European Equities).
- **Opt-in Swing Preservation**: Multi-day catalyst swings (`is_swing=True`, e.g. qualified PEAD drifts) are safely held through the close while intraday scalps are flattened.
- **Breakeven Latch (+1.0x ATR)**: When unrealized profit reaches $+1.0\times\text{ATR}$, the synthetic stop automatically ratchets to entry price (`stop_price = entry_price`), mathematically eliminating downside risk on the trade.
- **Tiered Scale-Out (+2.0x ATR)**: At $+2.0\times\text{ATR}$ profit, the engine scales out $50\%$ of the position (`qty * 0.5`) to bank gains and trails the stop on the remaining runner to $+0.5\times\text{ATR}$ locked profit (`entry_price + 0.5 * atr`).

### D. IBKR Pro Ireland (IBIE) Compliance & Infrastructure
- **Synthetic Fractional Stop Manager**: IBKR natively rejects `STP` and `STP LMT` orders on decimal/fractional lots. All fractional stops run in-memory within Python and dispatch compliant `MKT` or `LMT DAY` exit orders the millisecond a price breach occurs.
- **Broker Isolation Airbag**: Enforces strict environment separation (`managedAccounts`). If Paper mode connects to a live production `U...` account, the connection is instantly aborted to prevent accidental real-capital exposure.
- **Socket Auto-Reconnect Worker**: Exponential backoff ($2\text{s} \to 60\text{s}$) tolerates nightly IBKR server maintenance resets (23:45–00:45 EST, error codes `1100`, `1101`, `1102`, `502`, `504`) without daemon crashes.
- **MiFIR Reporting shortcodes**: Automatically appends Central Bank of Ireland regulatory tags (`mifid2DecisionMaker`, `mifid2ExecutionTrader`, algorithm IDs) to all European orders.

---

## 🚀 3. Quick Start Guide

### Step 1: Install Dependencies
```bash
# Frontend & Backend Node dependencies
npm install

# Python dependencies
pip install -r requirements.txt
```

### Step 2: Build & Start the Production Server
```bash
# Compile TypeScript client and backend
npm run build

# Start production server on port 3000
node dist/server.cjs
```
Open **`http://localhost:3000`** in your browser.

### Step 3: Run the Automated Verification Test Suites
```bash
# 1. Test Core Quant, Intraday Flattening, Breakeven Latch & Socket Reconnect
py scratch/test_phase3_core.py

# 2. Test Live Backend Risk & Execution Blotter Endpoints
py scratch/test_phase3_endpoints.py

# 3. Test Phase 2 PEAD Anomaly & Promotion API
py scratch/test_phase2_endpoints.py
```

---

---

## 🛡️ 3. The 5 Dynamic Core Pillars (Deprecation-Free Architecture)

AlphaEngine enforces a zero-drift, zero-hardcoding design to permanently protect operations against external API deprecations:

1. **Dynamic Multi-Provider AI Model Catalog Auto-Discovery**:
   - Live endpoint negotiation (`ai.models.list()`, Groq `/v1/models`, NVIDIA NIM `/v1/models`) dynamically discovers supported models and eliminates deprecated ones (e.g. Gemini 1.5 sunset).
   - In-memory `SimpleQuotaGuard` enforces per-provider rolling-window rate limits.
2. **Authoritative Exchange Calendars (`exchange_calendars`) & Dual DST Alignment**:
   - Direct integration of `XNYS`, `XPAR`, and `XETR` official calendars resolves exchange holidays, early closes, and opening observation buffers dynamically.
   - Dual DST Desynchronization Monitor tracks the 2–3 week shift window between US and European clocks, anchoring all session schedules to UTC.
3. **Active Regulatory & Macro Feed Schema/Endpoint Auto-Adaptation**:
   - SEC EDGAR CIK mappings are dynamically resolved from the SEC's live `company_tickers.json` directory.
   - ClinicalTrials.gov and OpenFDA feeds utilize adaptive OpenAPI field traversal to self-heal across schema updates.
4. **Native IBKR `reqContractDetails()` Socket Resolution on Startup**:
   - Real minTick increments, liquid trading hours, and primary exchange routing are queried directly from the IB Gateway socket on startup and cached to `contract_spec_cache.json`.
5. **Dynamic Volatility Risk Scaling (ATR-14 & Microstructure Sizing)**:
   - Position sizing and stop-loss/take-profit brackets are calculated dynamically using 14-period Wilder ATR rather than arbitrary fixed percentages.
   - Enforces adaptive breakeven latches (+1.0x ATR) and tiered scale-outs (+2.0x ATR).

---

## 🖥️ 4. Navigation & Interface Overview

- **`LIVE COCKPIT`**:
  - Pre-Trade Risk Gateway: Daily Capital Ceiling, Hard Daily Loss Cutoff, Fractional Lots toggle.
  - Auto-Flatten Intraday Controller: MOC toggle, live NY/Paris clocks, and immediate **"FLATTEN INTRADAY NOW"** button.
  - PEAD & Intraday Lifecycle indicators: Breakeven Latch (+1.0x ATR) & Tiered Scale-Out (+2.0x ATR).
  - Emergency Circuit Breaker: Instant kill switch panic button & operator unlock command.
  - Live Execution Blotter: Audit trail of all fills, order types, slippage in bps, and transaction fees.
- **`QUANT LAB`**:
  - Primary Catalyst Feed: SEC 8-K filings, ClinicalTrials.gov study milestones, OpenFDA approvals.
  - PEAD Momentum Radar: Empirical metrics (EPS Surprise, Rev Surprise, Volume Multiple, L2 OFI Sigma) and one-click **"PROMOTE TO ENGINE WATCHLIST"** button.
- **`SYSTEM` / `LAUNCHPAD`**:
  - Multi-exchange live books, connection diagnostics, and telemetry logs.

---

## 📖 5. Documentation & Resources
- **Operational Runbook**: See [`docs/RUNBOOK.md`](docs/RUNBOOK.md) for full architecture specifications, VNC instructions, and emergency recovery procedures.
- **Phase 3 Walkthrough**: See [`walkthrough.md`](walkthrough.md) for mathematical proofs, test output logs, and regulatory compliance details.

