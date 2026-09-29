# 🎓 ALPHA ENGINE RUNBOOK & OPERATIONAL GUIDE
> **The Official Institutional Trading Blueprint for Interactive Brokers (IBKR Ireland / IBIE), Pre-Trade Risk Gateways, Post-Earnings Announcement Drift (PEAD), Intraday OFI Execution, and Regulatory Compliance.**

---

## 🏛️ 1. System Overview & Architecture

Alpha Engine is an institutional-grade, multi-strategy algorithmic trading platform designed for **Interactive Brokers Pro Ireland (IBIE)** under Central Bank of Ireland (CBI) and MiFID II regulatory oversight.

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                  ALPHA ENGINE ARCHITECTURE                              │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                         │
│  [ Primary Data Feeds ]                                                                 │
│  • Reuters Corporate Events & IBKR Earnings XML                                         │
│  • Primary Catalysts: SEC EDGAR 8-K, ClinicalTrials.gov, OpenFDA, Federal Reserve       │
│                                           │                                             │
│                                           ▼                                             │
│  [ Strategy Engines ]                                                                   │
│  • Intraday L2 Order Flow Imbalance (OFI) Scalp Engine (Default Intraday)               │
│  • Post-Earnings Announcement Drift (PEAD) Anomaly Engine (Mega/Large-Cap >$5B)         │
│                                           │                                             │
│                                           ▼                                             │
│  [ Pre-Trade Risk Gateway (SEC Rule 15c3-5 & MiFID II) ]                                │
│  • Gate 1: Daily Capital Ceiling ($10,000 max gross exposure)                           │
│  • Gate 2: Hard Daily Loss Circuit Breaker ($250 session cutoff)                        │
│  • Gate 3: ADV / Market Impact Cap (Max 1.5% of rolling 5m volume)                      │
│  • Gate 4: Short Locate & Borrow Fee Verification (<15% annual fee)                     │
│  • Gate 5: Binary Event Blackout (Blocks entry before unpriced prints)                  │
│                                           │                                             │
│                                           ▼                                             │
│  [ Position Lifecycle & Execution Controller ]                                          │
│  • Breakeven Latch (+1.0x ATR): Automatically moves stop to entry price                 │
│  • Tiered Scale-Out (+2.0x ATR): Scales out 50% shares, trails runner stop (+0.5x ATR)  │
│  • Intraday MOC Controller: Liquidates intraday trades at 15:45 EST / 17:15 CET         │
│  • Synthetic Stop Manager: Python-managed fractional stops bypass broker rejections     │
│                                           │                                             │
│                                           ▼                                             │
│  [ Broker Interface & Hardware Co-Location ]                                            │
│  • IBKR TWS / Gateway API (Port 4002 Paper / Port 4001 Live)                            │
│  • Environment Isolation Airbag: Aborts if live 'U...' account detected in Paper mode   │
│  • Auto-Reconnect Worker: Exponential backoff (2s → 60s) survives nightly resets        │
│  • Real-Time Execution Blotter: Audit trail with Transaction Cost Analysis (TCA)        │
│                                                                                         │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 🛡️ 2. The 3 Institutional Roadmap Phases

Alpha Engine is structured across three institutional phases, each mathematically verified and battle-tested:

### Phase 1: Pre-Trade Risk Gateway & Capital Protection
- **Pre-Trade Risk Gateway (`DRMMiddleware`)**: Enforces 5 non-bypassable pre-flight risk checks before any order reaches the broker wire.
- **Hard Daily Loss Cutoff**: Circuit breaker that immediately flattens all active positions and hard-locks the execution router if session loss exceeds the configured threshold (default `$250`).
- **Python Synthetic Fractional Stops (`SyntheticStopManager`)**: IBKR natively rejects `STP` and `STP LMT` orders on fractional quantities. Alpha Engine holds all fractional stops in-memory within Python and dispatches compliant `MKT` or `LMT DAY` exit orders the millisecond a price breach occurs.
- **Environment Isolation Airbag**: Detects broker account IDs on startup (`managedAccounts`). If Paper mode connects to a production `U...` account, the connection is instantly severed to prevent accidental capital loss.

### Phase 2: Binary Event Blackout & PEAD Anomaly Strategy
- **Gate 5 Binary Event Blackout**: Never holds intraday positions through unpriced binary events (earnings announcements, FDA advisory readouts, Phase 3 trial releases). Intraday entries are locked 30 minutes before any scheduled binary release.
- **Post-Earnings Announcement Drift (PEAD) Engine (`pead_engine.py`)**: Exploits the classic, empirically proven capital markets anomaly where stock prices drift in the direction of earnings surprises over 1 to 60 trading days:
  - **Market Cap Floor**: Mega/large caps only ($> \$5\text{B}$), eliminating micro-cap liquidity traps.
  - **Volume Multiple**: First 15-minute volume must exceed $> 2.0\times$ 20-day Average Daily Volume (ADV).
  - **Spread Stabilization**: 15-minute post-market-open spread stabilization window (09:45 EST) ensures bid-ask spreads normalize below $5\%$ of ATR.
  - **Level 2 OFI Confirmation**: Top-of-book dealer queue accumulation must exceed $+1.5\sigma$.
  - **Stop Protection**: Initial synthetic stop loss set at $1.8\times\text{ATR}$.
- **PEAD Momentum Radar (`QuantResearchLab.tsx`)**: Real-time research lab ranking qualified PEAD candidates and providing an instantaneous **"PROMOTE TO ENGINE WATCHLIST"** button.

### Phase 3: Intraday Flattening Controller & Socket Resilience
- **Intraday Flattening Controller (Market-on-Close Discipline)**: 
  - Automatically liquidates intraday OFI positions at **15:45 EST** (US Equities) and **17:15 CET** (European Euronext/Xetra assets) to guarantee **zero overnight gap risk**.
  - Qualified PEAD multi-day swing positions (`is_swing=True`) are preserved.
  - Toggleable via the UI (**"AUTO-FLATTEN INTRADAY"**).
- **Multi-Day PEAD Position Lifecycle**:
  - **Breakeven Latch**: Once unrealized profit reaches $+1.0\times\text{ATR}$, the synthetic stop is automatically ratcheted to the entry price (`stop_price = entry_price`), locking in breakeven.
  - **Tiered Scale-Out**: At $+2.0\times\text{ATR}$ profit, the engine scales out $50\%$ of the position (`qty * 0.5`) and trails the stop on the remaining runner to $+0.5\times\text{ATR}$ locked profit (`entry_price + 0.5 * atr`).
- **IBKR Socket Auto-Reconnect**:
  - Implements an exponential backoff loop ($2\text{s} \to 4\text{s} \to 8\text{s} \to 16\text{s} \to 32\text{s} \to 60\text{s}$).
  - Catches disconnect error codes (`1100`, `1101`, `1102`, `502`, `504`) so the engine survives IBKR's nightly server resets (23:45–00:45 EST) without crashing.
- **Execution Blotter & TCA**: Real-time audit trail tracking arrival price, fill price, slippage in basis points (bps), and IBIE exchange commissions.

---

## 🖥️ 3. Navigation & Dashboard Controls

The UI is cleanly decoupled into two primary operational hubs via the top navigation bar:

```
[ LIVE COCKPIT ]   [ QUANT LAB ]   [ SYSTEM ]   [ LAUNCHPAD ]
```

### 1. LIVE COCKPIT (Default View)
The institutional risk and execution dashboard:
- **Telemetry Bar**: Displays active trading mode (`PAPER` or `LIVE`), Gateway connection status, broker account ID, active positions count, and live session P&L.
- **Pre-Trade Risk Gateway Cards**:
  1. **Daily Capital Ceiling**: Configure the hard capital cap (e.g. `$10,000`). Displays real-time utilized capital and percentage progress bar.
  2. **Hard Daily Loss Cutoff**: Set the hard loss circuit breaker (e.g. `$250`). Shows distance in USD until auto-lock triggers.
  3. **Fractional Execution (Synthetic Stops)**: Toggle decimal lots on/off. Confirms synthetic stop protection is active.
  4. **Auto-Flatten Intraday (15:45 EST MOC)**:
     - Toggle: Choose between strict MOC auto-flattening or multi-day swing mode.
     - Live Clocks: Shows synchronized NY (EST) and Paris (CET) server times.
     - Quick Action: **"FLATTEN INTRADAY NOW"** executes immediate Market-on-Close liquidations.
- **PEAD & Intraday Lifecycle Banner**: Confirms active Breakeven Latch (`+1.0x ATR`) and Tiered Scale-Out (`+2.0x ATR`).
- **Emergency Circuit Breaker (Panic Button)**:
  - Big red button: **"FLATTEN ALL & ABORT (KILL SWITCH)"** sends global cancel and market liquidations.
  - Amber button: **"AUTHORIZE ROUTER UNLOCK"** restores order transmission after safety assessment.
- **Live Execution Blotter & TCA**: Real-time table of all executions with arrival price, fill price, slippage (bps), commission fees, and order types (`MOC / MKT (INTRADAY FLATTEN)`, `MKT (Synthetic Stop)`, `LMT (DAY)`).

### 2. QUANT RESEARCH LAB
The institutional analytics and asset qualification sandbox:
- **Verified Catalyst Radar**: Ingests primary-source regulatory and corporate disclosures from SEC EDGAR (Form 8-K), ClinicalTrials.gov (Phase 3 trials), OpenFDA (approvals/PDUFA), and the Federal Reserve calendar. Gated events display a red blackout warning.
- **PEAD Momentum Radar**:
  - Displays qualified post-earnings drift candidates.
  - Metrics: **EPS Surprise %**, **Revenue Surprise %**, **Volume Surge Multiple (x ADV)**, and **Level 2 OFI Sigma (+z-score)**.
  - Multi-Factor Institutional Conviction Score (0–100).
  - **"PROMOTE TO ENGINE WATCHLIST"**: Click to immediately promote a qualified candidate into `dynamic_baskets.json`, arming the live engine to trade it.

---

## 🚀 4. Step-by-Step Operator Runbook: Daily Workflow

### Phase A: Pre-Market Preparation (08:30–09:15 EST / 14:30–15:15 CET)
1. **Launch the Engine**:
   ```bash
   node dist/server.cjs
   ```
   Verify server starts on `http://localhost:3000`.
2. **Verify IBKR Gateway / TWS**:
   - Ensure IBKR Gateway or TWS is running on port `4002` (Paper) or `4001` (Live).
   - In TWS API settings: check *"Enable ActiveX and Socket Clients"*, uncheck *"Read-Only API"*, and ensure Port matches.
3. **Open Live Cockpit**:
   - Open `http://localhost:3000` in your browser.
   - Verify connection badge shows `GATEWAY ARMED` and account ID starts with `DU` (Paper) or `U` (Live).
4. **Configure Session Risk Limits**:
   - In Live Cockpit, verify Daily Capital Ceiling (e.g. `$10,000`) and Hard Daily Loss Cutoff (e.g. `$250`).
   - Click **"APPLY RISK GATES"** to sync settings with the backend.

### Phase B: Catalyst Promotion in Quant Lab (09:15–09:30 EST)
1. Navigate to **QUANT LAB**.
2. Click **"REFRESH DRIFT RADAR"** to inspect overnight and morning earnings releases.
3. Review candidates: ensure **Volume Surge $\ge 2.0\times$ ADV**, **EPS Surprise $> 0$**, and **L2 OFI Sigma $\ge +1.5\sigma$**.
4. Click **"PROMOTE TO ENGINE WATCHLIST"** on qualified assets (e.g. `NVDA`, `SAP`).
5. Verify candidate badge switches to `PROMOTED TO ACTIVE ENGINE WATCHLIST`.

### Phase C: Opening Bell & Execution (09:30–15:45 EST)
1. **09:30–09:45 EST**: The 15-minute spread stabilization window activates. The engine monitors book depth but delays aggressive entries until spreads contract to $\le 5\%$ of ATR.
2. **09:45–15:45 EST**: Active trading window:
   - Primary intraday engine trades Level 2 Order Flow Imbalance (OFI).
   - Positions automatically benefit from the **Breakeven Latch** at $+1.0\times\text{ATR}$ and **Tiered Scale-Out** at $+2.0\times\text{ATR}$.
   - Every order fill appears instantaneously in the **Live Execution Blotter**.

### Phase D: End-of-Day Flattening (15:45 EST / 17:15 CET)
1. At **15:45 EST** (US Equities) and **17:15 CET** (European Euronext/Xetra Equities), the **Intraday Flattening Controller** automatically liquidates all non-swing positions with `MOC / MKT (INTRADAY FLATTEN)` orders.
2. Verify in Live Cockpit that open positions stand at `0` (or only designated PEAD swing holdings remain).
3. If needed, click **"FLATTEN INTRADAY NOW"** to force immediate manual closure.

### Phase E: Nightly Maintenance (23:45–00:45 EST)
- IBKR servers perform routine daily resets during this window (codes `1100`, `1102`).
- The **Auto-Reconnect Worker** automatically reconnects with exponential backoff. No operator intervention is required.

---

## ⚠️ 5. Emergency Procedures & Troubleshooting

### Emergency Kill Switch (Panic Flush)
If unexpected volatility or external news breaks:
1. In **LIVE COCKPIT**, click **"FLATTEN ALL & ABORT (KILL SWITCH)"**.
2. Click **"YES, FLATTEN NOW"** in the confirmation prompt.
3. The engine immediately:
   - Dispatches `reqGlobalCancel` to cancel all open working orders.
   - Dispatches market liquidation orders for all active positions.
   - Hard-locks the execution router.

### Unlocking the System
After assessing the market:
1. In **LIVE COCKPIT**, click **"AUTHORIZE ROUTER UNLOCK"**.
2. The router is disarmed and restored to normal monitoring.

### Frequently Asked Questions

**Q: Can I trade both intraday OFI scalps and multi-day PEAD swings simultaneously?**
> **A:** Yes! Intraday scalping is the engine's default operational mode (flattening at 15:45 EST). PEAD candidates promoted in the Quant Lab can be held as multi-day swings, protected by Gate 5 Binary Event Blackout.

**Q: Why does the engine use synthetic stops instead of broker native stop orders?**
> **A:** Interactive Brokers rejects native `STP` and `STP LMT` orders on fractional shares. Python-managed Synthetic Stops monitor live ticks in memory and execute fractional `MKT` orders instantly upon stop breach.

**Q: How do I know if an account is safe from live trading risks?**
> **A:** The Broker Isolation Airbag prevents any live trading when in `PAPER` mode: if an account starting with `U...` is detected, the socket is immediately terminated. Real capital is never deployed unless explicitly configured.
