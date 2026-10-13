"""
Primary-Source News & Catalyst Correlation Engine for Alpha Engine Research Lab.
Eliminates the 'naked quant' trap by attributing price anomalies to primary-source events.

Integrates Alpha Engine's 12-feed registry:
  1. IBKR Exchange Bulletins (IBKR_BROADTAPE)
  2. SEC EDGAR 8-K / 10-Q Submissions
  3. ClinicalTrials.gov Protocol Registry
  4. OpenFDA Drug Adverse Reaction & Clearances
  5. FRED Macroeconomic Calendar (Central Banks, CPI, Rates)
  6. European Corporate IR Feeds (ASML, SAP, Airbus, TotalEnergies, RWE)
  7. U.S. EIA Energy Reports
  8. ENTSO-E Electricity Market Disclosures
  9. USASpending Federal & Defense Awards
 10. FINRA Reg SHO Short Interest
 11. SIA Semiconductor Billings
 12. GDELT Global Geopolitical & Event Database

Architecture:
  - Tier 0 Local ModernBERT / TF-IDF Vectorizer pipeline (<15ms per inference)
      * Primary:  INT8-quantized FinBERT (ProsusAI/finbert) on onnxruntime CPUExecutionProvider
                  (provisioned by provision_tier0_model.py; ~110MB on disk).
      * Fallback: deterministic CATALYST_WEIGHTS keyword-weight engine (pure Python, <1ms).
      The fallback engages automatically when onnxruntime cannot be imported (e.g. Windows CRT
      DLL mismatch), when model artifacts are absent/corrupt, or when inference raises at runtime.
  - Anomaly Detector: Identifies trading days where |Return| > 1.5 * sigma
  - Attribution Classifier: Classifies moves as ENDOGENOUS_MICROSTRUCTURE vs EXOGENOUS_CATALYST
"""

import json
import logging
import math
import os
import re
import threading
import time
from dataclasses import dataclass, asdict
from typing import List, Dict, Any, Optional, Tuple, Union
from datetime import datetime
from universe_models import NewsEvent

logger = logging.getLogger("alpha_engine.tier0")

# ---------------------------------------------------------------------------
# Tier 0 configuration
# ---------------------------------------------------------------------------
TIER0_LATENCY_BUDGET_MS = 15.0
ENGINE_ONNX = "FINBERT_ONNX_INT8"
ENGINE_FALLBACK = "KEYWORD_WEIGHT_FALLBACK"

DEFAULT_TIER0_MODEL_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models", "finbert-int8")
TIER0_MODEL_FILE = "model_int8.onnx"
TIER0_TOKENIZER_FILE = "tokenizer.json"
TIER0_CONFIG_FILE = "config.json"
TIER0_MANIFEST_FILE = "manifest.json"
REQUIRED_SENTIMENT_LABELS = ("positive", "negative", "neutral")

# Headlines are short; 64 word-pieces covers >99% of wire headlines and bounds latency.
TIER0_MAX_SEQ_LEN = 64
# Consecutive runtime inference failures before the ONNX path is circuit-broken to fallback.
TIER0_MAX_CONSECUTIVE_FAILURES = 3


def resolve_tier0_model_dir(model_dir: Optional[str] = None) -> str:
    """Resolution order: explicit argument > ALPHA_TIER0_MODEL_DIR env var > ./models/finbert-int8."""
    return os.path.abspath(model_dir or os.environ.get("ALPHA_TIER0_MODEL_DIR") or DEFAULT_TIER0_MODEL_DIR)


def _default_thread_count() -> int:
    env = os.environ.get("ALPHA_TIER0_ORT_THREADS")
    if env and env.isdigit() and int(env) > 0:
        return int(env)
    return max(1, min(4, os.cpu_count() or 1))


@dataclass(frozen=True)
class HeadlineScore:
    """Tier 0 deterministic score for a single headline."""
    engine: str                          # ENGINE_ONNX or ENGINE_FALLBACK
    sentiment: str                       # 'positive' | 'negative' | 'neutral'
    polarity: float                      # P(positive) - P(negative), in [-1, 1]
    confidence: float                    # max class probability
    probabilities: Dict[str, float]
    catalyst_category: str               # CATALYST_WEIGHTS key or 'general'
    catalyst_scores: Dict[str, float]
    latency_ms: float
    event_id: Optional[str] = None

    def as_dict(self) -> Dict[str, Any]:
        return asdict(self)


class FinBertOnnxClassifier:
    """
    INT8 FinBERT sequence classifier on onnxruntime (CPU).

    Construction never raises: on any failure `available` is False and `unavailable_reason`
    carries the root cause (logged at WARNING with traceback). `predict()` DOES raise on
    runtime failure so callers can account for it explicitly (see NewsEventCorrelator).
    """

    _shared_cache: Dict[Tuple[str, int, int], "FinBertOnnxClassifier"] = {}
    _shared_lock = threading.Lock()

    def __init__(self, model_dir: Optional[str] = None, max_seq_len: int = TIER0_MAX_SEQ_LEN,
                 intra_op_threads: Optional[int] = None, warmup: bool = True):
        self.model_dir = resolve_tier0_model_dir(model_dir)
        self.max_seq_len = max_seq_len
        self.intra_op_threads = intra_op_threads or _default_thread_count()
        self.available = False
        self.unavailable_reason: Optional[str] = None
        self.load_ms: float = 0.0
        self.labels: List[str] = []
        self._session = None
        self._tokenizer = None
        self._np = None
        self._input_names: List[str] = []

        t0 = time.perf_counter()
        try:
            self._load(warmup)
            self.available = True
        except _Tier0Unavailable as exc:
            self.unavailable_reason = str(exc)
            logger.warning("Tier 0 ONNX classifier unavailable (%s); using %s.", exc, ENGINE_FALLBACK)
        except Exception as exc:  # noqa: BLE001 - surfaced via unavailable_reason + traceback log
            self.unavailable_reason = f"{type(exc).__name__}: {exc}"
            logger.warning("Tier 0 ONNX classifier failed to initialise; using %s.", ENGINE_FALLBACK, exc_info=True)
        finally:
            self.load_ms = (time.perf_counter() - t0) * 1000.0

    # -- loading ------------------------------------------------------------
    def _load(self, warmup: bool) -> None:
        model_path = os.path.join(self.model_dir, TIER0_MODEL_FILE)
        tok_path = os.path.join(self.model_dir, TIER0_TOKENIZER_FILE)
        cfg_path = os.path.join(self.model_dir, TIER0_CONFIG_FILE)
        missing = [p for p in (model_path, tok_path, cfg_path) if not os.path.isfile(p)]
        if missing:
            raise _Tier0Unavailable(f"model artifacts absent: {', '.join(os.path.basename(m) for m in missing)} in {self.model_dir}")

        self._verify_manifest_sizes()

        with open(cfg_path, "r", encoding="utf-8") as fh:
            id2label = json.load(fh).get("id2label", {})
        self.labels = [str(id2label[k]).lower() for k in sorted(id2label, key=lambda x: int(x))]
        if not all(lbl in self.labels for lbl in REQUIRED_SENTIMENT_LABELS):
            raise _Tier0Unavailable(f"config.json id2label {self.labels} is not a financial sentiment head")

        try:
            import numpy as np
            import onnxruntime as ort
            from tokenizers import Tokenizer
        except (ImportError, OSError) as exc:
            # On Windows this is typically 'DLL load failed ... initialization routine failed',
            # caused by a stale System32 msvcp140.dll older than the MSVC runtime ORT was built with.
            raise _Tier0Unavailable(f"runtime import failed: {type(exc).__name__}: {exc}") from exc

        tokenizer = Tokenizer.from_file(tok_path)
        tokenizer.enable_truncation(max_length=self.max_seq_len)
        tokenizer.no_padding()

        opts = ort.SessionOptions()
        opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        opts.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        opts.intra_op_num_threads = self.intra_op_threads
        opts.inter_op_num_threads = 1
        opts.log_severity_level = 3
        session = ort.InferenceSession(model_path, sess_options=opts, providers=["CPUExecutionProvider"])

        self._np = np
        self._tokenizer = tokenizer
        self._session = session
        self._input_names = [i.name for i in session.get_inputs()]
        if "input_ids" not in self._input_names:
            raise _Tier0Unavailable(f"unexpected ONNX graph inputs: {self._input_names}")
        if warmup:
            self.predict("Federal Reserve issues FOMC statement")  # pages weights in; first-call latency

    def _verify_manifest_sizes(self) -> None:
        """Cheap O(1) integrity check against the provisioner manifest (full digests verified at provision time)."""
        manifest_path = os.path.join(self.model_dir, TIER0_MANIFEST_FILE)
        if not os.path.isfile(manifest_path):
            return
        with open(manifest_path, "r", encoding="utf-8") as fh:
            artifacts = json.load(fh).get("artifacts", {})
        for name, meta in artifacts.items():
            path = os.path.join(self.model_dir, name)
            if os.path.isfile(path) and "size" in meta and os.path.getsize(path) != meta["size"]:
                raise _Tier0Unavailable(f"{name} size {os.path.getsize(path)} != manifest {meta['size']} (corrupt or partial)")

    # -- inference ----------------------------------------------------------
    def predict(self, text: str) -> Dict[str, float]:
        """Returns softmax probabilities keyed by label. Raises on runtime failure."""
        if self._session is None:
            raise RuntimeError(f"Tier 0 ONNX classifier not loaded: {self.unavailable_reason}")
        np = self._np
        enc = self._tokenizer.encode(text or "")
        feeds = {"input_ids": np.asarray([enc.ids], dtype=np.int64)}
        if "attention_mask" in self._input_names:
            feeds["attention_mask"] = np.asarray([enc.attention_mask], dtype=np.int64)
        if "token_type_ids" in self._input_names:
            feeds["token_type_ids"] = np.asarray([enc.type_ids], dtype=np.int64)
        logits = self._session.run(None, feeds)[0][0].astype(np.float64)
        exp = np.exp(logits - logits.max())
        probs = exp / exp.sum()
        return {lbl: float(p) for lbl, p in zip(self.labels, probs)}

    # -- process-wide cache -------------------------------------------------
    @classmethod
    def shared(cls, model_dir: Optional[str] = None) -> "FinBertOnnxClassifier":
        """One session per (model_dir, seq_len, threads) per process; ORT sessions are thread-safe for run()."""
        key = (resolve_tier0_model_dir(model_dir), TIER0_MAX_SEQ_LEN, _default_thread_count())
        with cls._shared_lock:
            inst = cls._shared_cache.get(key)
            if inst is None:
                inst = cls(model_dir=key[0], max_seq_len=key[1], intra_op_threads=key[2])
                cls._shared_cache[key] = inst
            return inst

    @classmethod
    def clear_shared_cache(cls) -> None:
        with cls._shared_lock:
            cls._shared_cache.clear()


class _Tier0Unavailable(Exception):
    """Expected, diagnosable reasons the ONNX path cannot be used."""


class NewsEventCorrelator:
    """
    Correlates price action series with verified primary-source news events.
    Prevents false pattern formation by identifying exogenous headline shocks.
    """

    # Keyword semantic weights for fast local classification fallback
    CATALYST_WEIGHTS = {
        "earnings": ["earnings", "revenue", "guidance", "q1", "q2", "q3", "q4", "eps", "profit warning"],
        "geopolitical": ["sanction", "war", "military", "tariff", "trade dispute", "embargo", "defense", "nato"],
        "regulatory": ["fda", "pdufa", "clinical trial", "crl", "complete response", "subpoena", "investigation", "doj", "sec"],
        "macro": ["interest rate", "inflation", "cpi", "ecb", "federal reserve", "yield", "rate hike", "rate cut", "central bank"],
        "corporate_action": ["merger", "acquisition", "restructuring", "spinoff", "buyback", "tender offer", "ceo resignation"]
    }

    # Deterministic polarity lexicon for the fallback sentiment path (Loughran-McDonald-style finance terms).
    POLARITY_LEXICON = {
        "positive": ["beat", "beats", "surge", "surges", "record", "raises guidance", "upgrade", "approval",
                     "approves", "approved", "growth", "outperform", "exceeds", "above estimates", "strong", "rally"],
        "negative": ["miss", "misses", "plunge", "plunges", "profit warning", "downgrade", "lawsuit", "subpoena",
                     "investigation", "sanction", "sanctions", "default", "bankruptcy", "recall", "below estimates",
                     "cuts guidance", "complete response", "crl", "halt", "fraud", "weak", "decline"]
    }

    def __init__(self, feed_registry_path: str = "feed_registry.json",
                 model_dir: Optional[str] = None, enable_onnx: bool = True):
        self.feed_registry_path = feed_registry_path
        self._model_dir = model_dir
        self._enable_onnx = enable_onnx
        self._compile_keyword_engine()
        self._init_embedder()

    def _init_embedder(self):
        """
        Initializes the Tier 0 headline scorer.
        Primary: INT8 FinBERT on onnxruntime CPU (shared per process). Fallback: the deterministic
        CATALYST_WEIGHTS keyword-weight engine, which avoids unstable binary DLL hooks on Windows
        environments. `modernbert_available` is retained for backward compatibility and reports
        whether the transformer (ONNX) path is live.
        """
        self._onnx: Optional[FinBertOnnxClassifier] = None
        self._onnx_consecutive_failures = 0
        self.tier0_unavailable_reason: Optional[str] = None
        if self._enable_onnx:
            clf = FinBertOnnxClassifier.shared(self._model_dir)
            if clf.available:
                self._onnx = clf
            else:
                self.tier0_unavailable_reason = clf.unavailable_reason
        else:
            self.tier0_unavailable_reason = "disabled by configuration (enable_onnx=False)"
        self.modernbert_available = self._onnx is not None

    @property
    def tier0_engine(self) -> str:
        return ENGINE_ONNX if self._onnx is not None else ENGINE_FALLBACK

    def _compile_keyword_engine(self) -> None:
        """
        Precompiles word-boundary patterns. Term weight = IDF across categories x phrase length,
        so specific multi-word phrases ('complete response') outweigh generic tokens ('sec').
        """
        n_cats = len(self.CATALYST_WEIGHTS)
        df: Dict[str, int] = {}
        for terms in self.CATALYST_WEIGHTS.values():
            for t in set(terms):
                df[t] = df.get(t, 0) + 1
        self._catalyst_patterns: Dict[str, List[Tuple["re.Pattern", float]]] = {}
        for cat, terms in self.CATALYST_WEIGHTS.items():
            compiled = []
            for t in terms:
                idf = math.log(1.0 + n_cats / df[t])
                compiled.append((re.compile(r"\b" + re.escape(t) + r"(?:s|es)?\b"), idf * len(t.split())))
            self._catalyst_patterns[cat] = compiled
        self._polarity_patterns = {
            pol: [re.compile(r"\b" + re.escape(t) + r"\b") for t in terms]
            for pol, terms in self.POLARITY_LEXICON.items()
        }

    def _keyword_catalyst(self, text_lc: str) -> Tuple[str, Dict[str, float]]:
        raw = {cat: sum(w for pat, w in pats if pat.search(text_lc)) for cat, pats in self._catalyst_patterns.items()}
        total = sum(raw.values())
        if total <= 0:
            return "general", {cat: 0.0 for cat in raw}
        scores = {cat: round(v / total, 4) for cat, v in raw.items()}
        # Deterministic tie-break: dict insertion order of CATALYST_WEIGHTS.
        best = max(scores, key=lambda c: scores[c])
        return best, scores

    def _keyword_sentiment(self, text_lc: str) -> Dict[str, float]:
        pos = sum(1 for p in self._polarity_patterns["positive"] if p.search(text_lc))
        neg = sum(1 for p in self._polarity_patterns["negative"] if p.search(text_lc))
        denom = float(pos + neg + 1)
        return {"positive": pos / denom, "negative": neg / denom, "neutral": 1.0 / denom}

    def score_headline(self, item: Union[NewsEvent, str]) -> HeadlineScore:
        """
        Tier 0 headline scoring. Never raises for model/runtime faults: an ONNX failure degrades
        to the keyword engine for that call, and TIER0_MAX_CONSECUTIVE_FAILURES consecutive
        failures circuit-break the ONNX path for the lifetime of this correlator.
        """
        t0 = time.perf_counter()
        event_id = item.event_id if isinstance(item, NewsEvent) else None
        text = item.headline if isinstance(item, NewsEvent) else str(item)
        text_lc = text.lower()

        probs: Optional[Dict[str, float]] = None
        engine = ENGINE_FALLBACK
        if self._onnx is not None:
            try:
                probs = self._onnx.predict(text)
                engine = ENGINE_ONNX
                self._onnx_consecutive_failures = 0
            except Exception as exc:  # noqa: BLE001 - logged and counted; never silent
                self._onnx_consecutive_failures += 1
                logger.warning("Tier 0 ONNX inference failed (%d/%d) for %r: %s",
                               self._onnx_consecutive_failures, TIER0_MAX_CONSECUTIVE_FAILURES,
                               event_id or text[:60], exc, exc_info=True)
                if self._onnx_consecutive_failures >= TIER0_MAX_CONSECUTIVE_FAILURES:
                    self.tier0_unavailable_reason = f"circuit-broken after repeated inference failures: {exc}"
                    self._onnx = None
                    self.modernbert_available = False
        if probs is None:
            probs = self._keyword_sentiment(text_lc)

        category, cat_scores = self._keyword_catalyst(text_lc)
        sentiment = max(REQUIRED_SENTIMENT_LABELS, key=lambda k: probs.get(k, 0.0))
        return HeadlineScore(
            engine=engine,
            sentiment=sentiment,
            polarity=round(probs.get("positive", 0.0) - probs.get("negative", 0.0), 4),
            confidence=round(max(probs.values()), 4),
            probabilities={k: round(v, 4) for k, v in probs.items()},
            catalyst_category=category,
            catalyst_scores=cat_scores,
            latency_ms=round((time.perf_counter() - t0) * 1000.0, 3),
            event_id=event_id,
        )

    def correlate_anomalies_with_events(
        self,
        symbol: str,
        daily_bars: List[Dict[str, Any]],
        news_events: List[NewsEvent],
        sigma_threshold: float = 1.5
    ) -> Dict[str, Any]:
        """
        Analyzes historical daily bars and overlays news events on anomalous trading days.
        Returns:
          - total_days: Count of analyzed days
          - anomalous_days: Count of days exceeding sigma_threshold
          - attributed_catalysts: Breakdown of events matching anomalous days
          - endogenous_count: Moves without major news (pure order flow / technicals)
          - exogenous_count: Moves caused by primary news shocks
          - recommendation: Can this pattern be safely traded, or does it require Gate 5 conditioning?
        """
        if len(daily_bars) < 5:
            return {
                "valid": False,
                "reason": "Insufficient daily bars (< 5) to compute return standard deviation."
            }

        # 1. Compute daily returns and standard deviation
        returns = []
        for i in range(1, len(daily_bars)):
            p_prev = daily_bars[i - 1]["close"]
            p_curr = daily_bars[i]["close"]
            r = (p_curr - p_prev) / p_prev if p_prev > 0 else 0.0
            returns.append((daily_bars[i]["date"], r, daily_bars[i]))

        if not returns:
            return {"valid": False, "reason": "No return series could be calculated."}

        mean_ret = sum(r[1] for r in returns) / len(returns)
        var_ret = sum((r[1] - mean_ret) ** 2 for r in returns) / (len(returns) - 1 if len(returns) > 1 else 1)
        sigma_ret = math.sqrt(var_ret) if var_ret > 0 else 0.01

        # 2. Identify anomalous trading days (|Return| > sigma_threshold * sigma)
        sym_upper = symbol.upper()
        anomalies = []
        for date_str, ret_val, bar in returns:
            z_score = abs(ret_val - mean_ret) / sigma_ret
            if z_score >= sigma_threshold:
                anomalies.append({
                    "date": date_str,
                    "return_pct": round(ret_val * 100.0, 2),
                    "z_score": round(z_score, 2),
                    "close": bar["close"],
                    "volume": bar.get("volume", 0)
                })

        # 3. Match events to dates and calculate semantic attribution
        attributed_days = []
        exogenous_days_count = 0
        endogenous_days_count = 0

        for anom in anomalies:
            a_date = anom["date"][:10]
            # Match news events occurring on or 1 day prior to this trading session
            matched_events = []
            for ev in news_events:
                ev_date = ev.timestamp[:10]
                # Check symbol relevance
                sym_match = (not ev.symbols_mentioned) or (sym_upper in [s.upper() for s in ev.symbols_mentioned])
                if sym_match and (ev_date == a_date or self._is_prior_day(ev_date, a_date)):
                    matched_events.append(ev)

            if matched_events:
                # Classify the most salient event
                primary_ev = self._select_primary_event(matched_events, sym_upper)
                anom["classification"] = "EXOGENOUS_CATALYST"
                anom["event_id"] = primary_ev.event_id
                anom["headline"] = primary_ev.headline
                anom["source"] = primary_ev.source
                anom["event_type"] = primary_ev.event_type
                anom["tier0_score"] = self.score_headline(primary_ev).as_dict()
                exogenous_days_count += 1
            else:
                anom["classification"] = "ENDOGENOUS_MICROSTRUCTURE"
                anom["headline"] = "No primary-source regulatory or macro filing detected (Order flow / Technical)"
                anom["source"] = "MICROSTRUCTURE"
                anom["event_type"] = "order_flow"
                endogenous_days_count += 1

            attributed_days.append(anom)

        # 4. Synthesize institutional recommendation
        total_anomalies = len(anomalies)
        if total_anomalies > 0:
            exogenous_ratio = exogenous_days_count / total_anomalies
        else:
            exogenous_ratio = 0.0

        if exogenous_ratio >= 0.50:
            regime = "NEWS_DOMINATED_REGIME"
            verdict = "REQUIRE_GATE_5_CONDITIONING"
            explanation = (
                f"{exogenous_days_count} of {total_anomalies} large moves ({exogenous_ratio*100:.1f}%) were driven by "
                f"primary regulatory, earnings, or macro news shocks. A pure technical pattern will suffer severe drawdown "
                f"without Gate 5 Binary Event Blackouts."
            )
        elif exogenous_ratio > 0.20:
            regime = "MIXED_CATALYST_REGIME"
            verdict = "CAUTION_APPLY_FILTER"
            explanation = (
                f"Moves exhibit partial event correlation ({exogenous_days_count} news shocks). "
                f"Mean-reversion is conditionally viable when no filings or bulletins are pending."
            )
        else:
            regime = "MICROSTRUCTURE_DRIVEN_REGIME"
            verdict = "STATISTICALLY_VIABLE_FOR_TECHNICALS"
            explanation = (
                f"Less than 20% of anomalous moves were caused by news releases. "
                f"Price swings are predominantly endogenous order flow imbalances, suitable for quantitative modeling."
            )

        return {
            "valid": True,
            "symbol": sym_upper,
            "total_bars_evaluated": len(daily_bars),
            "return_sigma_pct": round(sigma_ret * 100.0, 2),
            "total_anomalies_detected": total_anomalies,
            "exogenous_catalyst_count": exogenous_days_count,
            "endogenous_microstructure_count": endogenous_days_count,
            "exogenous_ratio_pct": round(exogenous_ratio * 100.0, 1),
            "regime": regime,
            "institutional_verdict": verdict,
            "explanation": explanation,
            "anomaly_event_timeline": attributed_days,
            "tier0_engine": self.tier0_engine,
            "tier0_unavailable_reason": self.tier0_unavailable_reason
        }

    def _select_primary_event(self, events: List[NewsEvent], symbol: str) -> NewsEvent:
        """Selects the highest-priority primary-source event for a given day."""
        urgency_order = {"CRITICAL": 4, "HIGH": 3, "MEDIUM": 2, "LOW": 1}
        # Sort by urgency first, then specific symbol mentions
        def event_rank(e: NewsEvent):
            score = urgency_order.get(e.urgency, 1) * 10
            if symbol in [s.upper() for s in e.symbols_mentioned]:
                score += 5
            return score

        return sorted(events, key=event_rank, reverse=True)[0]

    def _is_prior_day(self, ev_date: str, bar_date: str) -> bool:
        """Checks if event date is within 24h prior to the bar date."""
        try:
            d1 = datetime.strptime(ev_date[:10], "%Y-%m-%d")
            d2 = datetime.strptime(bar_date[:10], "%Y-%m-%d")
            diff = (d2 - d1).days
            return diff == 1
        except Exception:
            return False
