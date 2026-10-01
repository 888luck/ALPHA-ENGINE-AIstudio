# ALPHA ENGINE RUNBOOK & ONBOARDING GUIDE
*Institutional-Grade Autonomous Intraday Momentum & Quantitative Execution Platform*

---

## 🏛️ System Overview & Core Philosophy

AlphaEngine is an institutional algorithmic trading platform architected for cross-market intraday momentum strategies across North American (NYSE, NASDAQ) and European (Euronext Paris, Deutsche Börse Xetra) equity markets.

The engine operates on a zero-hallucination, zero-drift, 100% dynamic architecture. Every component—from multi-agent AI verification to exchange trading calendars, regulatory feeds, contract specifications, and risk bracket calculations—is dynamically queried, verified, and calibrated against authoritative primary sources.

```
       [Primary Feeds: SEC EDGAR, OpenFDA, ECB, LSE RNS, Euronext, Macro]
                                  │
                                  ▼
                    [Multi-Model Ensemble Layer]
          Generator (NVIDIA NIM) ➔ Verifier 1 (Groq Llama)
                                  ➔ Verifier 2 (Gemini Flash)
                                  ➔ Judge (Gemini Pro)
                                  │
                                  ▼
           [Universe Builder & Dynamic Friction Screening]
                                  │
                                  ▼
             [Interactive Brokers Ireland (IBIE) Gateway]
                   Port 4002 Socket (Frankfurt VM)
                                  │
                                  ▼
       [DRM Middleware: ATR(14) Volatility Bands & SEC 15c3-5 Gates]
```

---

## 🛡️ The 5 Dynamic Core Pillars

### Pillar 1: Dynamic Multi-Provider AI Model Catalog Auto-Discovery
- **Problem Solved**: Hardcoded model names (e.g. `gemini-1.5-flash-002`, `llama-3-70b`) get retired by model providers, causing unexpected 404 errors and execution halts.
- **Dynamic Solution**:
  - The control plane exposes `GET /api/models/live-catalog` which directly interrogates provider catalog endpoints (`ai.models.list()`, Groq `/v1/models`, NVIDIA NIM `/v1/models`).
  - Deprecated and sunset model versions (e.g. `1.0`, `1.5`) are automatically filtered out.
  - The highest active versioned model is dynamically mapped to its quantitative role:
    - **Generator**: NVIDIA NIM (`nemotron-3-ultra` / `meta/llama-3.1-70b-instruct`)
    - **Verifier 1 (Critic)**: Groq Cloud (`llama-3.3-70b-versatile` / `llama-3.1-70b-versatile`)
    - **Verifier 2 (Reality)**: Google AI Studio (`gemini-2.5-flash`)
    - **Judge (Synthesis)**: Google AI Studio (`gemini-2.5-pro`)
  - In `llm_ensemble.py`, `_auto_discover_models()` runs on engine initialization and daily pre-market calibration, binding live models with rolling-window `SimpleQuotaGuard` protection.

---

### Pillar 2: Authoritative Exchange Calendars & Dual DST Alignment
- **Problem Solved**: Hardcoded clock checks (e.g. `"15:50" <= current_ny_time < "16:00"`) break on market holidays (Memorial Day, Thanksgiving, Good Friday), fail to detect early closes (13:00 on Black Friday / Christmas Eve), and desynchronize during the 2–3 week Daylight Saving Time (DST) shift gap between the US and Europe.
- **Dynamic Solution**:
  - `market_hours_resolver.py` directly integrates Python `exchange_calendars` (`XNYS` for NYSE/NASDAQ, `XPAR` for Euronext Paris, `XETR` for Deutsche Börse).
  - Queries exact official opening/closing timestamps and half-day schedules for any target year.
  - **Dual DST Monitor**: Resolves the exact UTC offset between `America/New_York` and `Europe/Paris`. In March (when the US switches 2–3 weeks earlier) and October/November (when Europe switches 1 week earlier), the engine automatically detects the 5-hour time difference (vs. normal 6-hour difference) and anchors all execution windows strictly to UTC.
  - Positions are liquidated during `MarketSessionPhase.CLOSING_FLATTEN` derived from the real exchange closing bell.

---

### Pillar 3: Active Regulatory & Macro Feed Schema/Endpoint Auto-Adaptation
- **Problem Solved**: Static CIK dictionaries fail when new tickers enter the universe; rigid JSON parsing breaks when government APIs update their OpenAPI schema; and lazy fallbacks hide broken feeds.
- **Dynamic Solution**:
  - **SEC EDGAR Direct Submissions**: `NewsIngestor.resolve_cik()` dynamically resolves any ticker against the SEC's live master directory (`https://www.sec.gov/files/company_tickers.json`) with persistent disk caching (`sec_cik_cache.json`).
  - **ClinicalTrials.gov REST API v2**: Employs adaptive OpenAPI field navigation (`_adaptive_get_nested()`) that gracefully traverses `protocolSection.statusModule.overallStatus` across schema minor updates.
  - **OpenFDA Regulatory Filings**: Actively probes `/drug/event.json` and `/drug/label.json` for serious adverse events and labeling changes.
  - **Binary Event Blackout Gate**: Automatically freezes discretionary entries 48 hours prior to scheduled FDA PDUFA decisions, Phase 3 readouts, or quarterly earnings releases to protect against unhedgeable overnight gap risk.

---

### Pillar 4: Native IBKR `reqContractDetails()` Socket Resolution on Startup
- **Problem Solved**: Static contract specifications lack official exchange minTick sizes, liquid hours, and primary exchange routing rules.
- **Dynamic Solution**:
  - `ConnectionManager.contractDetails()` captures official broker metadata directly from the live socket (`127.0.0.1:4002`):
    - `conId`: Contract identifier
    - `primaryExchange`: Official routing destination (e.g. `NASDAQ`, `SBF`, `IBIS`)
    - `minTick`: Precise tick increment (e.g. `0.01`, `0.005`)
    - `liquidHours` & `tradingHours`: Official session strings
    - `timeZoneId`: Exchange native timezone (`America/New_York`, `Europe/Paris`)
  - `UniverseBuilder.resolve_contract()` queries the live socket on startup and persists verified specs to `contract_spec_cache.json` for resilient offline operation.

---

### Pillar 5: Dynamic Volatility Risk Scaling (ATR-14 & Microstructure Sizing)
- **Problem Solved**: Hardcoded fixed point stops (e.g. 1.8% or 1.2%) over-risk during volatile regimes and get prematurely stopped out during normal market noise.
- **Dynamic Solution**:
  - `DRMMiddleware.calculate_atr14()` calculates the 14-period Wilder Average True Range (ATR) from live candlestick bars.
  - `DRMMiddleware.calculate_dynamic_brackets()` computes adaptive brackets aligned to `minTick`:
    - **Adaptive Stop-Loss**: `Entry ± (1.5 × ATR)`
    - **Breakeven Latch**: Ratchets stop to Entry once unrealized profit hits `+1.0 × ATR`
    - **Tiered Scale-Out**: Liquidates 50% of position size at `+2.0 × ATR` and trails remaining stop to lock in `+0.5 × ATR`
    - **Profit Target**: Final exit at `+3.0 × ATR`
  - **Capital Sizing**: Position size is strictly calculated as `Risk Capital / (k_stop × ATR × Point Value)`, maintaining invariant 1% risk per trade regardless of market volatility.

---

## 🖥️ Operational Architecture & Production Access

### 1. Cloud Infrastructure
| Resource | Specification | Details |
|---|---|---|
| **Edge Compute Node** | GCP Compute Engine `alpha-edge-node` | `europe-west3-a` (Frankfurt, Germany) |
| **Machine Type** | `e2-medium` (2 vCPUs, 4 GB RAM) | Resized for low-latency European execution |
| **External IP** | `34.107.87.48` | Public Frankfurt gateway IP |
| **Cloud Scopes** | `https://www.googleapis.com/auth/cloud-platform` | Native Firestore & Cloud Logging access |
| **Control Plane** | Firebase Hosting + Cloud Run | `https://alpha-engine-ai-studio.web.app` |

### 2. Standalone IB Gateway 10.50 & Web VNC
Interactive Brokers Gateway 10.50 runs headlessly inside a virtual X11 frame buffer on the Frankfurt VM:
- **API Socket Port**: `127.0.0.1:4002` (Verified active and listening)
- **Direct HTTPS Web VNC**: `https://34.107.87.48:8443/vnc.html`
- **Reverse Proxy Authentication**:
  - **Username**: `admin`
  - **Password**: `Alpha2026Engine!`
- **Firewall Rule**: `allow-ibgateway-web` open on `0.0.0.0/0:8443`.

---

## 🚀 Daemon Commands & Lifecycle Management

### SSH into the Frankfurt Edge Node
```bash
gcloud compute ssh alpha-edge-node --zone=europe-west3-a
```

### Inspect Edge Node Services
```bash
# AlphaEngine Trading Daemon status & logs
sudo systemctl status alpha-engine
sudo journalctl -u alpha-engine -f -n 50

# IB Gateway & Web VNC service status
sudo systemctl status ibgateway
sudo journalctl -u ibgateway -f -n 50
```

### Restart Daemons
```bash
sudo systemctl restart alpha-engine
sudo systemctl restart ibgateway
```

### Emergency Kill Switch & Manual Flattening
If an anomalous market dislocation occurs, the system can be halted immediately:
1. **Via Cloud Dashboard**: Click the prominent **EMERGENCY KILL SWITCH** button in the System Control Center.
2. **Via REST API**:
   ```bash
   curl -X POST https://alpha-engine-ai-studio.web.app/api/risk/emergency-kill \
     -H "Content-Type: application/json"
   ```
3. **Via Local Server**:
   ```bash
   curl -X POST http://localhost:3000/api/risk/emergency-kill
   ```
This immediately transmits a global order cancellation (`reqGlobalCancel()`), liquidates all open intraday positions at market, and places the execution router under hard software lock.

---

## 📋 Pre-Flight Checklist Before Live Trading Session

- [ ] **IB Gateway Authenticated**: Access `https://34.107.87.48:8443/vnc.html` and verify the green "Connected" status with port `4002` open.
- [ ] **API Vault Handshake**: Verify in the control center that Google Gemini, Groq, and Cloud Firestore endpoints return green latency badges (<300ms).
- [ ] **Market Hours Synchronized**: Confirm the active session countdown displays correctly for Euronext (`XPAR`), Xetra (`XETR`), and NYSE (`XNYS`).
- [ ] **Friction Filter Active**: Confirm maximum friction ratio ceiling is enforced at 15.0% of expected gross move.
- [ ] **Binary Event Gate Screened**: Verify zero candidate symbols are within 48h of an earnings or FDA trial blackout window.
