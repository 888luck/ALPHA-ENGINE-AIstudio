# Alpha Engine: Master Operations & Execution Runbook

This document is the authoritative institutional operational runbook for the **Alpha Engine Hybrid Algorithmic Trading Platform**. It defines runtime procedures, daily market clock protocols, authentication workflows, Frankfurt VM maintenance, risk management, and emergency response.

---

## 🗺️ 1. Architecture & Service Topology Reference

The platform operates across two synchronized tiers:

| Tier | Component / Service | Host / Environment | Internal IP / Port | Public / Interface |
| :--- | :--- | :--- | :--- | :--- |
| **Tier 1** | `alpha-ui.service` (Node.js) | Cloud Run / Frankfurt VM | `127.0.0.1:3000` | Port `3000` / HTTPS |
| **Tier 2** | `alpha-engine.service` (Python) | GCP GCE `alpha-edge-node` | `10.156.0.2:4005` | Direct TCP Socket |
| **Broker** | `ibgateway.service` (IBC) | GCP GCE `alpha-edge-node` | `127.0.0.1:4001` (Live)<br>`127.0.0.1:4002` (Paper) | Loopback IPC |
| **Proxy** | `nginx.service` | GCP GCE `alpha-edge-node` | `127.0.0.1:80/443` | Reverse Proxy |

- **Frankfurt Edge Node VM**: `alpha-edge-node` (`europe-west3-a`, e2-medium, Debian 11 Cloud).
  - External IP: `34.141.105.241`
  - Internal VPC IP: `10.156.0.2`
  - Working Directory: `/opt/alpha-engine/`
  - Secrets File: `/etc/alpha-engine/secrets.env` (`chmod 600 root:root`)

---

## ⏰ 2. Daily Market Clock & Execution Protocols

Alpha Engine operates an automated multi-session clock across European (Euronext, Xetra, LSE) and U.S. (NYSE, NASDAQ) exchanges:

```
08:30 CET           09:00 CET                      15:00 CET          15:30 CET                 17:15 CET          21:45 CET       22:00 CET
    |                   |                              |                  |                         |                  |               |
    v                   v                              v                  v                         v                  v               v
[EU Pre-Market]    [EU Open]                     [US Pre-Market]     [US Open]                 [EU MOC Flat]      [US MOC Flat]    [Session Close]
OFI Calibration    Continuous Trading            Catalyst Radar      Continuous Trading        Flatten EU Stk     Flatten US Stk   Audit & TCA
```

### Daily Operational Checklist:

1. **08:30 CET (02:30 EST) — European Pre-Market Calibration**:
   - Inspect IBKR Gateway connection: `systemctl status ibgateway.service`.
   - Verify `CONTROL` tab (`Alt+1`) shows active Frankfurt node latency ($<5\text{ms}$) and session status `EU PRE-MARKET`.
   - Run volatility & OFI baselines for European universe (`TTE.PA`, `AIR.PA`, `MC.PA`, `ASML.AS`).

2. **09:00 CET — European Continuous Trading Open**:
   - Automated breakout trading activates for European tickers passing the 15% transaction friction filter.

3. **15:00 CET (09:00 EST) — U.S. Pre-Market & Catalyst Review**:
   - In `QUANT LAB` (`Alt+4`), inspect **Catalyst Radar** for overnight SEC 8-K/10-Q filings, clinical trial updates, and FDA alerts.
   - In `STRATEGY STUDIO` (`Alt+5`), verify candidate baskets in `dynamic_baskets.json`.

4. **15:30 CET (09:30 EST) — U.S. Market Open**:
   - Continuous U.S. trading opens. Monitor executive KPI ribbon in `CONTROL` tab (`Alt+1`) for real-time margin utilization and Day P&L.

5. **17:15 CET — European MOC (Market-On-Close) Flattening**:
   - In accordance with MiFID II and institutional overnight risk policy, all intraday European equity tranches are automatically flattened.

6. **21:45 CET (15:45 EST) — U.S. MOC Flattening**:
   - Risk engine enters pre-close blackout. All intraday U.S. positions are flattened via automated MOC limit/market orders. No new entries permitted.

7. **22:00 CET (16:00 EST) — Session Close & Post-Trade TCA Audit**:
   - Review `BLOTTER` (`Alt+2`) **TCA Audit Ledger** ([`TcaAuditTable.tsx`](./src/components/TcaAuditTable.tsx)).
   - Verify basis point slippage vs. arrival midpoint and audit trail in `tca_executions.json`.

---

## 🔐 3. Authentication & Lane Switching (Paper vs. Live)

Alpha Engine supports instant toggling between paper simulation and live capital DMA execution:

### A. Paper Simulation Lane (Port 4002)
- **Use Case**: 24/7 autonomous backtesting, paper execution, and signal verification.
- **Port**: `4002`.
- **Authentication**: Fully autonomous. IB Gateway connects using stored paper credentials (`ibkrPaperUsername`, `ibkrPaperPassword`). No two-factor prompt is required.
- **Activation**: Toggle switch in dashboard top header to **PAPER**, or run:
  ```bash
  python3 switch_gateway_mode.py paper
  ```

### B. Live Capital DMA Lane (Port 4001)
- **Use Case**: Real capital execution via Interactive Brokers Europe (IBIE).
- **Port**: `4001`.
- **Authentication**: Requires **IB Key Two-Factor Authentication (2FA)**.
- **Step-by-Step Live Transition Workflow**:
  1. In the dashboard top banner, click the lane switch to select **LIVE DMA**.
  2. The system executes `switch_gateway_mode.py live`, updates `jts.ini` to Port 4001, and restarts `ibgateway.service`.
  3. The top banner displays the amber badge: `[⚠️ AUTHORIZE 2FA / IB KEY]`.
  4. Clicking this button sends an authenticated signal to the Gateway, which dispatches an **IB Key push notification** to the trader's registered smartphone.
  5. The trader opens the IBKR mobile app and approves the biometric prompt (FaceID/Fingerprint).
  6. The Gateway establishes an authenticated session, port `4001` opens, and `main.py` begins streaming live quotes and order telemetry.

---

## 🛠️ 4. Frankfurt VM Maintenance & Deployment Runbook

### Connecting to the Frankfurt Edge VM
```bash
# Connect via Google Cloud SDK
gcloud compute ssh alpha-edge-node --zone=europe-west3-a
```

### Checking Service Health
```bash
# Inspect status of all Alpha Engine daemons
sudo systemctl status alpha-engine.service alpha-ui.service ibgateway.service

# Stream live edge execution logs
sudo journalctl -u alpha-engine.service -f -n 100

# Stream web control plane logs
sudo journalctl -u alpha-ui.service -f -n 100

# Stream IBKR Gateway IBC logs
sudo journalctl -u ibgateway.service -f -n 100
```

### Code Deployment & Synchronization
When updates are committed and pushed to GitHub:
```bash
# 1. Navigate to production root
cd /opt/alpha-engine

# 2. Fetch and pull latest commits
git fetch origin main
git pull origin main

# 3. Build frontend bundle and server
npm run build

# 4. Restart services with zero data loss
sudo systemctl restart alpha-ui.service
sudo systemctl restart alpha-engine.service

# 5. Verify active listening ports
sudo ss -tulpn | grep -E '3000|4001|4002|4005'
```

---

## 🛡️ 5. Pre-Trade Risk Controls & SEC Rule 15c3-5 Gates

The risk engine (`dynamic_risk_manager.py`) evaluates 6 deterministic gates before any order reaches the broker router:

| Gate | Rule | Formula / Limit | Router Action on Breach |
| :---: | :--- | :--- | :--- |
| **Gate 1** | **Capital at Risk** | $\text{Distance to Stop} \times \text{Tranche Size} \le 1.0\% \times \text{Net Liq}$ | Order rejected; size clamped |
| **Gate 2** | **Max Position Size** | Position gross value $\le \text{Max Position Limit}$ (Vault-configured) | Order rejected |
| **Gate 3** | **Daily Loss Circuit Breaker** | Realized + Unrealized Day Loss $\le \text{Daily Loss Limit}$ (e.g. 3.0%) | Trading halted for remainder of day |
| **Gate 4** | **15% Friction Filter** | $\frac{\text{Projected Friction}}{\text{Projected Max Profit}} \times 100 \le 15.0\%$ | Order rejected at router |
| **Gate 5** | **Liquidity & OFI Floor** | Spread $\le 0.08\%$ and Volume Spike $\ge 1.4\times$ 10-period SMA | Signal rejected; order withheld |
| **Gate 6** | **MOC Session Blackout** | No new orders within 15 min of European (17:15 CET) or US (15:45 EST) close | Order blocked |

### ⚡ Dynamic Trailing Profit & Runner Ratchet Protocol
When running backtests or deploying candidate baskets from `STRATEGY STUDIO` (`Alt+5`), the dynamic trailing profit engine protects open profits without exposing runners to retracements back into negative territory:

1. **Parameter Calibration**:
   - `trailing_stop_atr` ($k_{trail}$): Trailing distance below highest high (default: `1.5` ATR).
   - `trailing_activation_r`: Profit threshold before activation (default: `1.2` R / ATR), preventing premature stop-outs during noise-sized entry moves.
   - `trailing_step_atr`: Ratchet damper (default: `0.5` ATR), requiring price to make a meaningful advance before lifting the stop order.
   - `trailing_type`: Ratchet methodology (`CHANDELIER`, `ATR`, `FIXED_R`, `PARABOLIC`).

2. **Multi-Tranche Execution Flow**:
   - **Target 1**: 50% partial profit scale-out triggers; remaining tranche moves initial stop to Breakeven ($P_{entry}$).
   - **Trend Extension**: Once profit exceeds `trailing_activation_r`, the runner tranche stop is dynamically ratcheted upward to $\text{Highest High} - (k_{trail} \times \text{ATR})$.
   - **Audit Blotter**: The simulation blotter tags trailing exits with amber badge `TRAILING STOP LOSS HIT` for transaction analysis.

---

## 🚨 6. Emergency Protocols & Disaster Recovery

### Emergency Kill Switch (Immediate Portfolio Flatten)
If market dislocation, broker disconnections, or algorithmic runaway occurs:

1. **UI Execution (Fastest)**:
   - Navigate to `CONTROL` (`Alt+1`) or `RISK` (`Alt+3`).
   - Click the red **[EMERGENCY KILL SWITCH]** button.
   - Click the confirmation dialog: **[CONFIRM IMMEDIATE FLATTEN & HALT]**.
   - Result: All pending bracket/limit orders are cancelled, market orders are submitted to flatten all positions, and trading daemons are halted.

2. **Terminal Execution (Fallback)**:
   ```bash
   # Execute immediate kill switch on Frankfurt VM
   cd /opt/alpha-engine
   python3 -c "from risk_engine import RiskEngine; RiskEngine().trigger_kill_switch()"
   ```

### Port Conflict & Stale Socket Triage
If port `4005` or `3000` is locked by an orphaned process:
```bash
# Free port 4005
sudo fuser -k 4005/tcp
sudo systemctl restart alpha-engine.service

# Free port 3000
sudo fuser -k 3000/tcp
sudo systemctl restart alpha-ui.service
```

### IBKR Gateway Session Reset
If the broker connection drops or encounters API error 502/504:
```bash
# Gracefully restart the Gateway
sudo systemctl restart ibgateway.service

# Wait 15 seconds, then verify socket is listening
sleep 15
nc -zv 127.0.0.1 4001 || nc -zv 127.0.0.1 4002
```

---

## 🔒 7. 12-Factor POSIX Secrets Maintenance

All credentials across the 4 pillars (Brokerage, Infrastructure, AI Providers, Feeds) are stored securely in `/etc/alpha-engine/secrets.env` with POSIX file mode `600`:

```bash
# Inspect secrets configuration (root only)
sudo cat /etc/alpha-engine/secrets.env

# Secure file permissions
sudo chown root:root /etc/alpha-engine/secrets.env
sudo chmod 600 /etc/alpha-engine/secrets.env
```

To update credentials:
- Use the **VAULT** tab (`Alt+6`) in the dashboard with built-in live probing and atomic disk synchronization.
- Or edit `/etc/alpha-engine/secrets.env` directly and restart `alpha-ui.service`.
