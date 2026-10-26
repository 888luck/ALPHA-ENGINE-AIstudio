# Alpha Engine: Institutional Changelog & Evolution History

All notable changes, architectural evolutions, and institutional fixes to the Alpha Engine Hybrid Platform are documented in this file.

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
