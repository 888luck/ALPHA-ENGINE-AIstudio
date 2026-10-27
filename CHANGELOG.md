# Alpha Engine: Institutional Changelog & Evolution History

All notable changes, architectural evolutions, and institutional fixes to the Alpha Engine Hybrid Platform are documented in this file.

---

## [v2.7.0] - 2026-10-27: Single-Command Primary Edge Deployment & Standby Cloud Run Architecture

### 🌟 Major Evolutions & Enhancements

#### 1. High-Speed Edge VM Deployment Pipeline (`scripts/deploy_edge.cjs`, `scripts/vm_sync_and_rebuild.sh`)
- **Direct Edge VM Targeting**:
  - Re-architected deployment to prioritize the Frankfurt Edge Node VM (`https://misha-vm-gcp.duckdns.org`, `europe-west3-a`) as the primary execution and control plane, reducing deployment latency from ~4 minutes to ~33 seconds.
- **Dynamic Runtime Risk State Preservation**:
  - Automatically snapshots active live state (`dynamic_baskets.json`, `risk_limits.json`, `copilot_quota_state.json`) to `/tmp/` before Git operations, preventing active trader limits or discovered candidate pools from being wiped out or reverted to repository defaults during updates.
- **Dynamic POSIX Ownership Reconciliation**:
  - Embedded `sudo chown -R $(id -un):$(id -gn) /opt/alpha-engine` directly into the rebuild cycle, eliminating permission conflicts between Git resets and non-root execution daemons (`alpha-ui.service`, `alpha-engine.service`).
- **Cross-Platform Argument Protection**:
  - Resolved Windows CMD concatenation and shell escaping quirks using explicit double-quote preservation for `gcloud compute ssh --command`.
- **Automated Health Telemetry**:
  - Automatically executes end-to-end HTTP health probes against Lens 1 Information Coefficient (`/api/events/information-coefficient`) and Catalyst Radar (`/api/events/catalysts`) upon service restarts.

#### 2. Standby Mirror Architecture & Dual Deployment Workflow (`scripts/deploy_cloudrun.cjs`)
- **Optional Standby Mirroring**:
  - De-coupled Google Cloud Run (`alpha-engine-aistudio-138990607360.europe-west3.run.app`) from daily development friction, maintaining it strictly as a scale-to-zero standby mirror ($0 standby cost) runnable on demand via `npm run deploy:standby`.
- **Unified Dual Deployment**:
  - Added `npm run deploy:all` to deploy to the primary Frankfurt Edge VM first, followed by Cloud Run standby rollout.

#### 3. Repository & Workspace Hygiene
- **Surgical Stumps Purge**:
  - Purged all legacy `.bak` files, orphaned `dist.bak/`, and backup dumps on both host and Frankfurt Edge VM.
  - Hardened `.gitignore` to prevent cached bar dumps (`historical_bars_*.json`), backups, and build artifacts from cluttering working trees.

---

## [v2.6.0] - 2026-10-27: Tier 0 Frontier Dual-Head Encoder Architecture & Information Coefficient Factor Engine

### 🌟 Major Evolutions & Enhancements

#### 1. Tier 0 Frontier Dual-Head Architecture (`news_event_correlator.py`)
- **Canonical Model Directory & Surgical Decommissioning**:
  - Migrated and unified model storage under `models/tier0-encoder/` (purging deprecated `models/finbert-int8/`).
  - Standardized model identification across frontend UI, Express routing, and Python Copilot to `local/tier0-encoder` ($0 cost Tier 0 offline model).
- **Dual-Head Execution Pipelines**:
  - `score_wire(text: str) -> HeadlineScore`: Low-latency (<10ms) 3-class sequence classification ($[P_{pos}, P_{neg}, P_{neu}]$, polarity $P_{pos} - P_{neg}$) on CPU with probability simplex enforcement ($\sum P_i = 1.0 \pm 10^{-5}$).
  - `embed_document(text: str, max_length: int = 8192) -> List[float]`: 8,192-token document vectorization for SEC 8-K Items and 10-Q MD&A sections, generating 768-dimensional $L_2$-normalized unit vectors with pure-Python deterministic fallback.
- **Resilience & Backward Compatibility**:
  - Maintained backward-compatible aliases `FinBertOnnxClassifier = Tier0OnnxClassifier`, `score_headline = score_wire`, and `modernbert_available = tier0_available`.
  - 3-strike circuit breaker automatically trips to the deterministic Loughran-McDonald lexicon / IDF keyword engine without throwing exceptions.

#### 2. Statistical Information Coefficient (IC) Factor Engine (`quant_discovery.py`, `research_controller.py`)
- **Spearman Rank Correlation ($\text{IC}$)**:
  - Added `QuantDiscoveryEngine.compute_information_coefficient(sentiment_scores, forward_returns)` adhering to institutional factor modeling standards (Grinold & Kahn).
  - Calculates Spearman's $\text{IC}$, Student's $t$-statistic, and two-tailed $p$-value; classifies signals into `STRONG_ALPHA_SIGNAL`, `MODERATE_ALPHA_SIGNAL`, or `NOISE_OR_SPURIOUS`.
  - Attaches IC validation directly to `handle_analyze` in the Quantitative Research Lab.

#### 3. Polarity-Aware Dynamic Trailing & Gate 5 NLP Dual Veto (`backtester.py`, `alpha_strategy.py`)
- **Gate 5 NLP Dual Veto**:
  - Rejects Long breakout setups when primary catalyst polarity is strongly negative ($\le -0.60$) and Short setups when polarity is strongly positive ($\ge +0.60$).
- **Catalyst-Modulated Trailing Stops**:
  - Dynamically modulates the runner trailing distance: expands trailing cushion ($k_{trail} \times 1.25$) when trade is driven by a confirmed catalyst ($\ge +0.60$) to capture post-earnings announcement drift (PEAD); tightens cushion ($k_{trail} \times 0.75$) when negative ($\le -0.60$) to protect capital.

---

## [v2.5.0] - 2026-10-26: Dynamic Trailing Profit Engine, Chandelier Ratchet & 83-Tool Reflection Evolution

### 🌟 Major Evolutions & Enhancements

#### 1. Dynamic Trailing Profit Engine (`backtester.py`)
- **Extreme Watermark Tracking**:
  - Implemented continuous high/low watermark tracking (`highest_high`, `lowest_low`) throughout active trade lifecycles.
- **Dynamic Ratchet Methodologies**:
  - `CHANDELIER`: Volatility-adjusted trail ratcheted to highest high minus $k_{trail} \times \text{ATR}$ (or lowest low plus $k_{trail} \times \text{ATR}$ for short trades).
  - `ATR`: Dynamic volatility trail adjusting off running bar closes.
  - `FIXED_R`: Fixed R-multiple trail locking cumulative accrued profits.
  - `PARABOLIC`: Accelerating parabolic ratchet tightening stop distance as trade duration matures.
- **Activation Hurdle & Churn Damper**:
  - `trailing_activation_r`: Profit threshold hurdle (in R-multiples or ATR) required before the trailing stop activates, eliminating premature exits on minor entry noise.
  - `trailing_step_atr`: Minimum ATR increment damper before stops ratchet upward, preventing micro-adjustments and order churn.
- **Coordinated Multi-Tranche Scaling**:
  - Coordinated with Target 1 partial profit: Tranche 1 scales out 50% at Target 1 and ratchets initial stop to breakeven; remaining runner tranches transition to the dynamic trailing ratchet to ride extended trends.
- **Backward Compatibility & Baseline Invariance**:
  - Positional CLI and function arguments default to `None`, preserving 100% backward compatibility with prior static stop-loss and sweep pipelines.

#### 2. Strategy Studio Tactile Trailing Controls (`StrategyStudioPage.tsx`)
- **Dual-Control Quant Sliders & Inputs**:
  - Added dedicated tactile "⚡ Dynamic Trailing Stop" panel with instant toggle switch.
  - Interactive dual sliders and precise numeric steppers for `Trailing Stop Distance (1.0–3.0 ATR)`, `Activation Hurdle (0.5–3.0 R)`, and `Ratchet Step (0.1–1.0 ATR)`.
  - Method selector dropdown for `CHANDELIER`, `ATR`, `FIXED_R`, and `PARABOLIC`.
- **Trade Blotter Visual Badges**:
  - Amber badge styling for `TRAILING STOP LOSS HIT` distinctly separates dynamic trailing exits from classical initial stop-outs (`STOP LOSS HIT`).
- **Experiment Vault Persistence**:
  - Trailing parameters are serialized into `StrategyStudioExperiment` and stored locally in the Experiment Vault.

#### 3. Autonomous Copilot Tool Dispatcher & REST API (`copilot.py`, `backtest.ts`)
- **JSON Tool Schema Extension**:
  - Extended `run_strategy_backtest` schema with full type definitions and descriptions for `trailing_stop_atr`, `trailing_activation_r`, `trailing_step_atr`, and `trailing_type`.
  - Added execution routing in `execute_tool_call` and `CopilotTools`.
- **Express Route & AI Quant Audit**:
  - Updated `POST /api/backtest` Express route to forward trailing parameters to `backtester.py`.
  - Integrated trailing stop parameters into the AI Quant Audit analysis prompt (`POST /api/backtest-audit`).

#### 4. Unified Tool Reflector Engine (`tools_reflector.py` & `tools_registry.json`)
- **Quant Tool Schema Auto-Reflection**:
  - Added `reflect_quant_strategy_tools()` directly into `tools_reflector.py` to prevent quantitative tools from dropping when `--force` reflection is triggered.
- **Expanded Reflected Catalog**:
  - Catalog expanded to **83 callable tools across 11 institutional categories**, including official Interactive Brokers client API surface (`ibapi.client.EClient`), institutional feeds, and quant backtesting/sweeps.

---

## [v2.4.0] - 2026-10-25: Quantitative Strategy Studio, Multi-Model Resilience & Dynamic Lookback Engine

### 🌟 Major Evolutions & Enhancements

#### 1. Dynamic Lookback Horizons & User Time Brackets
- **Schema Parameter Exposure**:
  - Added `days: int`, `start_date: str`, and `end_date: str` parameters to the core quantitative discovery and backtesting schemas (`run_quant_discovery`, `run_strategy_sweep`, `run_strategy_backtest` in `backend/app/api/copilot.py`).
  - Enables user-defined time horizons (e.g. 30 days, 90 days, 180 days, 365 days / 1 year) without arbitrary bar truncations.
- **System Prompt Lookback Horizon Invariant**:
  - Embedded the *Lookback Horizon & User Time Brackets Invariant* into the Strategy Optimizer Agent system prompt.
  - Instructs LLMs to map natural language time requests (e.g., "last 6 months" $\rightarrow$ `days=180`, "last 1 year" $\rightarrow$ `days=365`) and strictly forbids asserting that the engine is hardcapped at ~210 bars.
- **Adaptive Duration Formatting & Dynamic Socket Timeouts (`backtester.py`)**:
  - Implemented dynamic duration formatting for IBKR `reqHistoricalData`: maps to `{days_diff} D` up to 365 days for 1-hour bars, `1 Y` for daily bars, and `min(days_diff, 30) D` for sub-hourly bars.
  - Replaced static 20-second socket timeouts with dynamic pacing-aware timeouts: `adaptive_timeout = max(25.0, min(65.0, days_diff * 0.15))`.
- **Primary Exchange Disambiguation (`connection.py`)**:
  - Added primary exchange resolution (`primaryExchange = "NYSE"` for symbols such as `CAT`, `BA`, `IBM`, `DIS`, `JPM`, `GE`, `XOM`, and `NASDAQ` for tech equities) to prevent IBKR SMART-routing contract ambiguity rejections.

#### 2. Strategy Optimizer Agent & Multi-Model Resilience
- **OpenRouter Reasoning Model Parser (`backend/app/api/copilot.py`)**:
  - Added multi-key payload extraction for thinking/reasoning models (such as `deepseek/deepseek-r1`, `nvidia/nemotron-3.5-super-vl-120b-a12b`, etc.).
  - Extracts thought tokens across `message.get("reasoning")`, `message.get("reasoning_content")`, and `message.get("reasoning_details")`, eliminating false `Empty message content` exceptions.
- **Dynamic Groq TPM Headroom & Token Clamping (`backend/app/api/copilot.py`)**:
  - Live probe confirmed Groq's on-demand free tier enforces an 8,000 Tokens-Per-Minute (`x-ratelimit-limit-tokens: 8000`) ceiling.
  - Added prompt token estimation and dynamic headroom calculation:
    `effective_max_tokens = min(request.max_tokens or 1500, max(400, min(1500, 7500 - prompt_est)))`
    guaranteeing prompt + completion tokens never breach the 8,000 TPM limit and eliminating `HTTP 413` errors.
- **Sliding Context Window Token Compaction (`backend/app/api/copilot.py`)**:
  - Added intelligent token budgeting for multi-turn conversations: compacts prior messages (>1200 characters) to 1000 characters while preserving the active user query intact.
- **4-Tier Automated Provider Failover (`backend/app/api/copilot.py`)**:
  - Upgraded failover attempts to 4 across verified active providers:
    $$\text{NVIDIA NIM} \longrightarrow \text{OpenRouter} \longrightarrow \text{Groq Cloud} \longrightarrow \text{Google GenAI}$$
  - Maintains stateful `attempted_providers` tracking to guarantee every available provider in the 4-Pillar Vault is evaluated before failing.
- **Local Quantitative Sizing Engine Fallback (`backend/app/api/copilot.py`)**:
  - Replaced generic FinBERT news sentiment fallback with a deterministic quantitative capital sizing engine when queries mention equity or capital (e.g. "$5K equity", "account size").
  - Calculates 1% capital risk constraint, ATR-based dollar risk, position sizing, IBKR fractional share feasibility, and transaction friction ratios directly on CPU ($0 cost).

#### 3. IBKR Gateway Concurrency & Reconnection Guards
- **Startup Connection Race Elimination (`main.py`)**:
  - Reconciled settings and connected the IB Gateway before premarket calibration, preventing duplicate connection collisions (IBKR Code 326 / Code 504).
- **Duplicate Reconnect Guard (`connection.py`)**:
  - Added atomic lock guard `if self._is_reconnecting or self.is_connected: return` in `_reconnect_worker`, preventing runaway reconnect loops.

---

## [v2.3.0] - 2026-10-18: 12-Factor Decoupled Vault, Zero Cloud DB & Dynamic LLM Discovery

- **12-Factor POSIX Secrets Hierarchy**: Purged proprietary cloud secret SDKs; credentials resolve via `/etc/alpha-engine/secrets.env` (`chmod 600`), `process.env`, `.env`, and local settings.
- **Zero Firebase / Firestore Invariant**: Purged all cloud database tunnels; replaced with Direct TCP Socket streaming over port 4005 and local atomic persistence (`.tmp` write followed by `os.replace`).
- **Dynamic LLM Discovery**: Eradicated hardcoded model names; models are dynamically discovered via live `/models` probes to active providers in the 4-Pillar Vault.
- **MiFID-II RTS 22 Compliance**: Automated transaction reporting, algorithmic decision maker/execution trader shortcodes, and arrival-price TCA audits.
