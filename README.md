# 🚀 Alpha Engine — Institutional Multi-Strategy Trading Platform

Alpha Engine is an institutional-grade, **hybrid algorithmic trading framework** designed for quantitative intraday Order Flow Imbalance (OFI) scalp trading, Post-Earnings Announcement Drift (PEAD) catalyst execution, and automated Central Bank of Ireland (CBI) / MiFID II regulatory compliance on **Interactive Brokers Pro Ireland (IBIE)**.

The platform links an interactive React web dashboard with an asynchronous Python execution edge node co-located adjacent to the Interactive Brokers Europe Core Hub in **Frankfurt, Germany (`europe-west3`)**, coordinated securely using a direct Google Firestore real-time data tunnel.

---

## 🏛️ 1. Architecture Overview

```
                                    ┌────────────────────────────────────────────────────────┐
                                    │               PRIMARY SOURCE CATALYSTS                 │
                                    │  • Verified Broker Bulletins & Institutional RSS       │
                                    │  • SEC EDGAR Official Form 8-K Disclosures             │
                                    │  • OpenFDA & ClinicalTrials.gov Registry               │
                                    │  • Federal Reserve & Macro Event Schedules             │
                                    │  • European Central Bank (ECB) & ESMA Announcements    │
                                    │  • London Stock Exchange RNS & Euronext Market Feeds   │
                                    └───────────────────────────┬────────────────────────────┘
                                                                │
                                                                ▼
                                    ┌────────────────────────────────────────────────────────┐
                                    │        MULTI-MODEL LLM ENSEMBLE (CRITIC-VERIFIER)      │
                                    │  • Directional Confidence Scoring (BULLISH/BEARISH)    │
                                    │  • Zero-Synthetic Policy (Strict Extractive Logic)     │
                                    │  • Brier Score Calibration & Sector Impact Analysis    │
                                    └───────────────────────────┬────────────────────────────┘
                                                                │
                                                                ▼
┌─────────────────────────────────┐                 ┌────────────────────────────────────────┐
│     INTERACTIVE WEB DASHBOARD   │                 │      STRATEGY ENGINES & QUANT LAB      │
│  • AI Intelligence Tab (LLMs)   │                 │  • PEAD Momentum Radar & Watchlist API │
│  • Universe Manager (Size Slider│◄───────────────►│  • Tier A Event-Study Backtester (MFE) │
│  • LIVE COCKPIT (Risk & Blotter)│    Firestore    │  • L2 Order Flow Imbalance (OFI) Engine│
│  • Two-Step Live Routing Gate   │    Realtime     │  • Real-Time Portfolio Margin & VaR    │
│  • Emergency Kill Switch        │    Tunnel       │  • Gate 5 Binary Event Blackout        │
└─────────────────────────────────┘                 └───────────────────┬────────────────────┘
                                                                        │
                                                                        ▼
                                                    ┌────────────────────────────────────────┐
                                                    │       PRE-TRADE RISK & LIFECYCLE       │
                                                    │  • Daily Capital Ceiling ($10,000)     │
                                                    │  • Hard Loss Circuit Breaker ($250)    │
                                                    │  • 1-Day 99% VaR & SPY Beta Hedging    │
                                                    │  • Synthetic Fractional Stop Manager   │
                                                    │  • Breakeven Latch & Tiered Scale-Out  │
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
# Run the 12/12 institutional safety, signal & control plane test suite
py -3 -m pytest test_day1_safety.py test_day2_signals.py test_day3_control_plane.py -v
```
All tests run against pure deterministic mathematics, verifying:
- SEC Rule 15c3-5 Pre-Trade Risk gates and hard loss thresholds
- Emergency flush order generation and router authorization
- Level 2 Order Flow Imbalance (OFI) queue calculation across multiple symbols
- Zero-synthetic mock trade eradication across all server endpoints
- Clean repository hygiene and dependency pinning

---

## 🏛️ 4. Modular Backend Architecture (`server.ts` & Routers)

[`server.ts`](server.ts) is partitioned into dedicated TypeScript routers under `src/server/`:

| Router / Module | Path | Description |
|---|---|---|
| **Risk Router** | [`src/server/routes/risk.ts`](src/server/routes/risk.ts) | Pre-trade risk gates, loss circuit breakers, intraday auto-flatten, and operator unlock |
| **Orders Router** | [`src/server/routes/orders.ts`](src/server/routes/orders.ts) | Real-money DMA order dispatching to Frankfurt Edge Node and global panic abort |
| **AI Intelligence Router** | [`src/server/routes/ai.ts`](src/server/routes/ai.ts) | Multi-model consensus generation, rate-limited Quota Guard, model discovery |
| **Events & PEAD Router** | [`src/server/routes/events.ts`](src/server/routes/events.ts) | SEC 8-K filings, ClinicalTrials.gov milestones, OpenFDA feeds, and PEAD anomaly radar |
| **Backtest Router** | [`src/server/routes/backtest.ts`](src/server/routes/backtest.ts) | Event-study replay execution on audited historical market bars |
| **System Router** | [`src/server/routes/system.ts`](src/server/routes/system.ts) | Diagnostic probes, socket connectivity status, settings persistence |
| **Auth Middleware** | [`src/server/middleware/auth.ts`](src/server/middleware/auth.ts) | Enforces `x-admin-key` / `Authorization: Bearer <key>` on privileged actions |

---

## 🧭 5. Is the GUI Self-Explanatory? (Interface Guided Tour)

The Alpha Engine interface is designed so that **any operator, trader, or newcomer can understand system state immediately with zero guesswork**:

### 1. Truth-in-Labeling Watermark Banner (Top Header)
- Always visible across all screens.
- Displays unambiguous color-coded mode:
  - `🔴 LIVE PRODUCTION — BROKER DMA ROUTING (ACCOUNT: U8129384)`: Real capital is engaged.
  - `🟡 PAPER TRADING — IBKR EDGE NODE (ACCOUNT: DU8129384)`: Simulation gateway active.
- Shows real-time network latency to the Frankfurt Co-Located Node (e.g. `14.2ms`) and an explicit `ZERO SYNTHETIC POLICY ENFORCED` guarantee.
- Contains the `🔑 OPERATOR KEY` configuration button for administrative authentication.

### 2. Live Cockpit (`/cockpit`) — Execution & Risk
- **Global Clocks & Status**: Live pulsing badges showing whether European (`🇪🇺 EURONEXT/XETRA`) or US (`🇺🇸 NYSE/NASDAQ`) exchanges are open, with real CET and EST clocks.
- **Pre-Trade Risk Gateway Cards**:
  - `Daily Capital Ceiling`: Explains gross exposure cap with interactive presets (`$200` to `$10,000`).
  - `Hard Daily Loss Cutoff`: Displays remaining buffer in dollars until automatic system lockout.
  - `Fractional Execution`: Clearly indicates synthetic stop protection for decimal shares.
  - `Auto-Flatten Intraday`: Toggle for 15:45 EST MOC rule plus an instant `FLATTEN INTRADAY NOW` button with live time indicators.
- **Circuit Breaker Panic Button**:
  - Features two-step confirmation (`CONFIRM EMERGENCY FLUSH?`) to prevent accidental liquidations.
- **Live Execution Blotter & TCA**:
  - Real-time audit trail displaying Symbol, Side, Quantity, Order Type, Arrival Price, Fill Price, Slippage in basis points (`+X bps`), Broker Commission, and Status.

### 3. Quant Research Lab (`/lab`) — Catalysts & Backtesting
- **Verified Catalyst Radar**: Displays real SEC 8-K filings, FDA dates, and clinical trial milestones with urgency badges (`CRITICAL`, `MEDIUM`) and direct links to official source URLs.
- **PEAD Drift Radar**: Explains the 50-year Post-Earnings Announcement Drift anomaly with interactive metrics (`EPS Surprise`, `Rev Surprise`, `Volume Surge`, `L2 OFI Sigma`) and tooltips (`ⓘ`) on every card.
- **Historical Replay Engine**:
  - Displays the prominent badge **`[DATA PROVENANCE: VERIFIED HISTORICAL BARS (AUDITED)]`** so users know backtests use genuine historical price action rather than synthetic test fixtures.

### 4. Interactive Beginner Runbook (`RUNBOOK` Button)
- Clicking `RUNBOOK` in the top navigation bar opens a comprehensive 6-step guided walkthrough explaining:
  1. How to run an event-study backtest.
  2. How to inspect AI consensus and the <15% friction filter.
  3. How to configure ATR stop multipliers.
  4. How drawdown circuit breakers operate.
  5. How to deploy and verify the Paper simulated gateway.
  6. Emergency panic flush and admin unlock procedures.

### 5. Institutional Typography Standard
- All microscopic font sizes have been eradicated ($\ge 12\text{px}$ throughout).
- High-contrast, legible typography ensures numbers, prices, and error banners are easily readable on laptops, desktops, and multi-monitor trading desks.

---

## 📖 6. Documentation & Resources
- **Operational Runbook**: See [`docs/RUNBOOK.md`](docs/RUNBOOK.md) for full architecture specifications, VNC instructions, and emergency recovery procedures.
- **Institutional Walkthrough**: See [`walkthrough.md`](walkthrough.md) for mathematical proofs, test output logs, and regulatory compliance details.


## ✨ Latest Features: Phase 4 Additions
- **Tier A Event-Study Backtester (vent_backtester.py)**: A native execution simulator that loops historical NewsEvent datasets against our MultiModelEnsemble, calculating Directional Hit Rates, Brier Scores for confidence calibration, and Maximum Favorable/Adverse Excursion (MFE/MAE) benchmarks.
- **AI Intelligence Tab & Universe Manager**: A live React dashboard (GcpCompanion.tsx) module streaming real-time LLM Critic-Verifier consensus decisions and managing basket execution sizes directly via a frontend slider.
- **Two-Step Live Gate (Security)**: A hardcoded ADMIN_LIVE_CONFIRMATION_TOKEN pre-flight check in the Risk API. The router strictly rejects 'PAPER' -> 'LIVE' mode mutations without explicit password validation to prevent accidental live execution.
- **Real-Time Portfolio Margin & VaR (historical_var.py)**: Advanced risk bounds utilizing 1-Day 99% Value-at-Risk modeling and SPY Beta hedging to ensure position limits respect dynamically allocated capital caps.

