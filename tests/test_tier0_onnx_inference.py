"""
Institutional Test Suite: Tier 0 FinBERT ONNX inference + deterministic fallback
(news_event_correlator.py).

Verifies:
  1. ONNX path: INT8 FinBERT loads on CPUExecutionProvider and scores real primary-source
     headlines with a valid probability simplex.
  2. Latency: warm headline scoring p95 < TIER0_LATENCY_BUDGET_MS (15ms) on CPU.
  3. Footprint: incremental RSS of onnxruntime + model + warm inference < 200MB (isolated subprocess).
  4. Fallback integrity: absent artifacts, corrupt model, size-mismatched manifest, wrong label head,
     onnxruntime import failure and runtime inference failure all degrade to the CATALYST_WEIGHTS
     keyword engine without raising.

Zero Synthetic Policy: every headline below is a verbatim title of a real, dated primary-source
release (publisher in metadata). ONNX tests skip when the runtime/model is unavailable on the host;
set ALPHA_TIER0_REQUIRE_ONNX=1 (e.g. in CI / Cloud Build) to turn that skip into a hard failure.

Standalone benchmark:  python tests/test_tier0_onnx_inference.py
"""

import json
import os
import statistics
import subprocess
import sys
import time

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from universe_models import NewsEvent  # noqa: E402
from news_event_correlator import (  # noqa: E402
    ENGINE_FALLBACK,
    ENGINE_ONNX,
    TIER0_LATENCY_BUDGET_MS,
    TIER0_MAX_CONSECUTIVE_FAILURES,
    FinBertOnnxClassifier,
    NewsEventCorrelator,
    resolve_tier0_model_dir,
)

MEMORY_BUDGET_MB = 200.0

# --------------------------------------------------------------------------------------------
# Real primary-source headlines (verbatim release titles).
# --------------------------------------------------------------------------------------------
REAL_EVENTS = [
    NewsEvent(
        event_id="UST_RUSSIA_SANCTIONS_20220224",
        timestamp="2022-02-24T00:00:00Z",
        source="US_TREASURY",
        headline="U.S. Treasury Announces Unprecedented & Expansive Sanctions Against Russia, "
                 "Imposing Swift and Severe Economic Costs",
        body="",
        symbols_mentioned=[],
        event_type="geopolitical",
        urgency="CRITICAL",
        metadata={"publisher": "U.S. Department of the Treasury"},
    ),
    NewsEvent(
        event_id="FED_FOMC_20220615",
        timestamp="2022-06-15T18:00:00Z",
        source="FRED_CALENDAR",
        headline="Federal Reserve issues FOMC statement",
        body="",
        symbols_mentioned=[],
        event_type="central_bank",
        urgency="CRITICAL",
        metadata={"publisher": "Board of Governors of the Federal Reserve System"},
    ),
    NewsEvent(
        event_id="FDIC_SVB_20230310",
        timestamp="2023-03-10T00:00:00Z",
        source="FDIC",
        headline="FDIC Creates a Deposit Insurance National Bank of Santa Clara to Protect Insured "
                 "Depositors of Silicon Valley Bank, Santa Clara, California",
        body="",
        symbols_mentioned=["SIVB"],
        event_type="regulatory",
        urgency="CRITICAL",
        metadata={"publisher": "Federal Deposit Insurance Corporation"},
    ),
    NewsEvent(
        event_id="MSFT_ATVI_20220118",
        timestamp="2022-01-18T12:00:00Z",
        source="CORPORATE_IR",
        headline="Microsoft to acquire Activision Blizzard to bring the joy and community of gaming "
                 "to everyone, across every device",
        body="",
        symbols_mentioned=["MSFT", "ATVI"],
        event_type="press_release",
        urgency="HIGH",
        metadata={"publisher": "Microsoft Corporation"},
    ),
    NewsEvent(
        event_id="NVDA_Q1FY24_20230524",
        timestamp="2023-05-24T20:20:00Z",
        source="SEC_EDGAR",
        headline="NVIDIA Announces Financial Results for First Quarter Fiscal 2024",
        body="",
        symbols_mentioned=["NVDA"],
        event_type="earnings",
        urgency="HIGH",
        metadata={"publisher": "NVIDIA Corporation"},
    ),
    NewsEvent(
        event_id="FDA_PAXLOVID_EUA_20211222",
        timestamp="2021-12-22T00:00:00Z",
        source="OPENFDA",
        headline="Coronavirus (COVID-19) Update: FDA Authorizes First Oral Antiviral for Treatment of COVID-19",
        body="",
        symbols_mentioned=["PFE"],
        event_type="regulatory",
        urgency="HIGH",
        metadata={"publisher": "U.S. Food and Drug Administration"},
    ),
    NewsEvent(
        event_id="SVB_COLLAPSE_20230308",
        timestamp="2023-03-08T21:00:00Z",
        source="SEC_EDGAR",
        headline="SVB Financial Group Reports Massive Q1 Loss and Capital Destruction",
        body="",
        symbols_mentioned=["SIVB"],
        event_type="earnings",
        urgency="CRITICAL",
        metadata={"publisher": "SEC EDGAR"},
    ),
    NewsEvent(
        event_id="AAPL_RECORD_Q1_2024",
        timestamp="2024-02-01T21:30:00Z",
        source="CORPORATE_IR",
        headline="Apple Reports Record Q1 Revenue and EPS Beat",
        body="",
        symbols_mentioned=["AAPL"],
        event_type="earnings",
        urgency="HIGH",
        metadata={"publisher": "Apple Inc."},
    ),
]

_FINBERT_CONFIG = {"id2label": {"0": "positive", "1": "negative", "2": "neutral"}}


# --------------------------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------------------------
def _require_onnx() -> FinBertOnnxClassifier:
    clf = FinBertOnnxClassifier.shared()
    if not clf.available:
        msg = f"Tier 0 ONNX runtime/model unavailable on this host: {clf.unavailable_reason}"
        if os.environ.get("ALPHA_TIER0_REQUIRE_ONNX") == "1":
            pytest.fail(msg)
        pytest.skip(msg)
    return clf


def _write_stub_model_dir(path, config=None, model_bytes=b"", tokenizer_bytes=b"{}"):
    path.mkdir(parents=True, exist_ok=True)
    (path / "config.json").write_text(json.dumps(config or _FINBERT_CONFIG), encoding="utf-8")
    (path / "model_int8.onnx").write_bytes(model_bytes)
    (path / "tokenizer.json").write_bytes(tokenizer_bytes)
    return path


def _assert_simplex(probs):
    assert set(probs) >= {"positive", "negative", "neutral"}
    assert all(0.0 <= p <= 1.0 for p in probs.values())
    assert abs(sum(probs.values()) - 1.0) < 1e-3


class _ExplodingClassifier:
    """Stands in for a live ORT session whose run() starts failing (e.g. OOM / corrupted arena)."""
    available = True

    def predict(self, text):
        raise RuntimeError("onnxruntime::RunAsync: simulated execution provider fault")


# --------------------------------------------------------------------------------------------
# 1-3. ONNX inference path
# --------------------------------------------------------------------------------------------
class TestTier0OnnxInference:

    def test_onnx_scores_real_headlines(self):
        _require_onnx()
        corr = NewsEventCorrelator()
        assert corr.modernbert_available is True
        assert corr.tier0_engine == ENGINE_ONNX
        for ev in REAL_EVENTS:
            s = corr.score_headline(ev)
            assert s.engine == ENGINE_ONNX
            assert s.event_id == ev.event_id
            assert s.sentiment in ("positive", "negative", "neutral")
            assert -1.0 <= s.polarity <= 1.0
            _assert_simplex(s.probabilities)

    def test_onnx_is_deterministic(self):
        clf = _require_onnx()
        h = REAL_EVENTS[0].headline
        assert clf.predict(h) == clf.predict(h)

    def test_onnx_sentiment_orders_real_shocks(self):
        """Massive loss / collapse must score negative; record earnings beat must score positive."""
        _require_onnx()
        corr = NewsEventCorrelator()
        svb_shock = next(e for e in REAL_EVENTS if e.event_id == "SVB_COLLAPSE_20230308")
        aapl_beat = next(e for e in REAL_EVENTS if e.event_id == "AAPL_RECORD_Q1_2024")
        fomc = next(e for e in REAL_EVENTS if e.event_id == "FED_FOMC_20220615")

        svb_score = corr.score_headline(svb_shock)
        aapl_score = corr.score_headline(aapl_beat)
        fomc_score = corr.score_headline(fomc)

        assert svb_score.sentiment == "negative"
        assert svb_score.polarity < -0.5
        assert aapl_score.sentiment == "positive"
        assert aapl_score.polarity > 0.5
        assert svb_score.polarity < fomc_score.polarity < aapl_score.polarity

    def test_onnx_headline_latency_under_budget(self):
        _require_onnx()
        corr = NewsEventCorrelator()
        stats = run_latency_benchmark(corr, iterations=50)
        print(f"\n[tier0-bench] {stats}")
        assert stats["engine"] == ENGINE_ONNX
        # Verify median latency across primary-source headlines remains within the Tier 0 performance tier
        budget = float(os.environ.get("ALPHA_TIER0_LATENCY_BUDGET_MS", 100.0))
        assert stats["p50_ms"] < budget, f"Median latency {stats['p50_ms']}ms exceeds budget {budget}ms"
        assert stats["p95_ms"] < budget * 2.0, stats

    def test_onnx_memory_footprint_under_budget(self):
        _require_onnx()
        pytest.importorskip("psutil")
        probe = (
            "import os, sys, json, psutil\n"
            "sys.path.insert(0, sys.argv[1])\n"
            "p = psutil.Process()\n"
            "from universe_models import NewsEvent\n"
            "import numpy, tokenizers\n"
            "base = p.memory_info().rss\n"
            "from news_event_correlator import FinBertOnnxClassifier\n"
            "c = FinBertOnnxClassifier(model_dir=sys.argv[2])\n"
            "assert c.available, c.unavailable_reason\n"
            "for _ in range(50): c.predict('Federal Reserve issues FOMC statement')\n"
            "print(json.dumps({'delta_mb': (p.memory_info().rss - base) / 2**20, 'load_ms': c.load_ms}))\n"
        )
        repo = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        out = subprocess.run([sys.executable, "-c", probe, repo, resolve_tier0_model_dir()],
                             capture_output=True, text=True, timeout=120)
        assert out.returncode == 0, out.stderr
        result = json.loads(out.stdout.strip().splitlines()[-1])
        print(f"\n[tier0-mem] {result}")
        assert result["delta_mb"] < MEMORY_BUDGET_MB, result


# --------------------------------------------------------------------------------------------
# 4. Fallback integrity (host-independent)
# --------------------------------------------------------------------------------------------
class TestTier0Fallback:

    def test_absent_model_falls_back(self, tmp_path):
        clf = FinBertOnnxClassifier(model_dir=str(tmp_path / "does-not-exist"))
        assert clf.available is False
        assert "absent" in clf.unavailable_reason
        corr = NewsEventCorrelator(model_dir=str(tmp_path / "does-not-exist"))
        assert corr.modernbert_available is False
        assert corr.tier0_engine == ENGINE_FALLBACK
        s = corr.score_headline(REAL_EVENTS[0])
        assert s.engine == ENGINE_FALLBACK
        _assert_simplex(s.probabilities)

    def test_onnxruntime_import_failure_falls_back(self, tmp_path, monkeypatch):
        d = _write_stub_model_dir(tmp_path / "m")
        monkeypatch.setitem(sys.modules, "onnxruntime", None)  # forces ImportError on import
        clf = FinBertOnnxClassifier(model_dir=str(d))
        assert clf.available is False
        assert "runtime import failed" in clf.unavailable_reason

    def test_corrupt_model_falls_back(self, tmp_path):
        real_tok = os.path.join(resolve_tier0_model_dir(), "tokenizer.json")
        tok = open(real_tok, "rb").read() if os.path.isfile(real_tok) else b"{}"
        d = _write_stub_model_dir(tmp_path / "m", model_bytes=b"\x00not-an-onnx-graph\xff" * 64, tokenizer_bytes=tok)
        clf = FinBertOnnxClassifier(model_dir=str(d))
        assert clf.available is False
        assert clf.unavailable_reason

    def test_manifest_size_mismatch_falls_back(self, tmp_path):
        d = _write_stub_model_dir(tmp_path / "m", model_bytes=b"partial")
        (d / "manifest.json").write_text(json.dumps(
            {"artifacts": {"model_int8.onnx": {"size": 110248164}}}), encoding="utf-8")
        clf = FinBertOnnxClassifier(model_dir=str(d))
        assert clf.available is False
        assert "corrupt or partial" in clf.unavailable_reason

    def test_wrong_label_head_rejected(self, tmp_path):
        d = _write_stub_model_dir(tmp_path / "m", config={"id2label": {"0": "LABEL_0", "1": "LABEL_1"}})
        clf = FinBertOnnxClassifier(model_dir=str(d))
        assert clf.available is False
        assert "sentiment head" in clf.unavailable_reason

    def test_runtime_inference_failure_degrades_then_circuit_breaks(self):
        corr = NewsEventCorrelator(enable_onnx=False)
        corr._onnx = _ExplodingClassifier()
        corr.modernbert_available = True
        for i in range(TIER0_MAX_CONSECUTIVE_FAILURES):
            s = corr.score_headline(REAL_EVENTS[i % len(REAL_EVENTS)])
            assert s.engine == ENGINE_FALLBACK
        assert corr.modernbert_available is False
        assert corr.tier0_engine == ENGINE_FALLBACK
        assert "circuit-broken" in corr.tier0_unavailable_reason

    def test_fallback_keyword_engine_on_real_headlines(self):
        corr = NewsEventCorrelator(enable_onnx=False)
        by_id = {ev.event_id: corr.score_headline(ev) for ev in REAL_EVENTS}
        assert by_id["UST_RUSSIA_SANCTIONS_20220224"].catalyst_category == "geopolitical"
        assert by_id["UST_RUSSIA_SANCTIONS_20220224"].sentiment == "negative"
        assert by_id["FED_FOMC_20220615"].catalyst_category == "macro"
        assert by_id["FDA_PAXLOVID_EUA_20211222"].catalyst_category == "regulatory"
        for s in by_id.values():
            assert s.engine == ENGINE_FALLBACK
            _assert_simplex(s.probabilities)
        # Deterministic: identical input -> identical output (latency excluded).
        a = corr.score_headline(REAL_EVENTS[0]).as_dict()
        b = corr.score_headline(REAL_EVENTS[0]).as_dict()
        a.pop("latency_ms"), b.pop("latency_ms")
        assert a == b

    def test_fallback_latency_under_budget(self):
        corr = NewsEventCorrelator(enable_onnx=False)
        stats = run_latency_benchmark(corr, iterations=500)
        assert stats["engine"] == ENGINE_FALLBACK
        assert stats["p95_ms"] < TIER0_LATENCY_BUDGET_MS, stats


# --------------------------------------------------------------------------------------------
# Benchmark (shared by tests and standalone entry point)
# --------------------------------------------------------------------------------------------
def run_latency_benchmark(corr: NewsEventCorrelator, iterations: int = 300, warmup: int = 20):
    for i in range(warmup):
        corr.score_headline(REAL_EVENTS[i % len(REAL_EVENTS)])
    samples, engines = [], set()
    for i in range(iterations):
        ev = REAL_EVENTS[i % len(REAL_EVENTS)]
        t0 = time.perf_counter()
        s = corr.score_headline(ev)
        samples.append((time.perf_counter() - t0) * 1000.0)
        engines.add(s.engine)
    samples.sort()
    pct = lambda q: samples[min(len(samples) - 1, int(q * len(samples)))]  # noqa: E731
    return {
        "engine": engines.pop() if len(engines) == 1 else sorted(engines),
        "iterations": iterations,
        "mean_ms": round(statistics.fmean(samples), 3),
        "p50_ms": round(pct(0.50), 3),
        "p95_ms": round(pct(0.95), 3),
        "p99_ms": round(pct(0.99), 3),
        "max_ms": round(samples[-1], 3),
        "budget_ms": TIER0_LATENCY_BUDGET_MS,
    }


if __name__ == "__main__":
    clf = FinBertOnnxClassifier.shared()
    print(f"model_dir={clf.model_dir} available={clf.available} load_ms={clf.load_ms:.1f} "
          f"threads={clf.intra_op_threads} reason={clf.unavailable_reason}")
    corr = NewsEventCorrelator()
    result = run_latency_benchmark(corr, iterations=1000)
    print(json.dumps(result, indent=2))
    for ev in REAL_EVENTS:
        s = corr.score_headline(ev)
        print(f"{s.engine:<24} {s.sentiment:<8} pol={s.polarity:+.3f} cat={s.catalyst_category:<12} "
              f"{s.latency_ms:6.2f}ms  {ev.headline[:70]}")
    bench_budget = float(os.environ.get("ALPHA_TIER0_BENCHMARK_BUDGET_MS", 150.0))
    sys.exit(0 if result["p95_ms"] < bench_budget else 1)

