"""
Evolutive Multi-Model LLM Ensemble for Alpha Engine
Implements the Critic-Verifier multi-agent consensus architecture across:
- NVIDIA NIM (Nemotron)
- Groq (Llama 3.1 / 3.3)
- Google AI Studio / Vertex (Gemini 2.5 Flash / Pro)

Reads model roles dynamically from model_registry.json with automated fallbacks.
Includes SimpleQuotaGuard: a rolling-window per-provider rate limiter that
gracefully downgrades to fallback or deterministic engine when quotas are exhausted.
"""

import os
import json
import logging
import time
import urllib.request
import urllib.error
from collections import deque
from typing import Dict, Deque, List, Any, Optional, Tuple
from datetime import datetime

from universe_models import (
    NewsEvent, SectorImpact, ClassifiedEvent,
    VerificationResult, EnsembleResult
)

logger = logging.getLogger("AlphaEngine.LLMEnsemble")
if not logger.handlers:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")


# =============================================================================
# ROLLING-WINDOW QUOTA GUARD
# =============================================================================

# Default daily request budgets per provider (conservative free-tier safe values).
# These are loaded from model_registry.json["quota_limits"] if present so they
# can be updated without code changes as providers evolve their free tiers.
_DEFAULT_QUOTA_LIMITS: Dict[str, Dict[str, int]] = {
    "nvidia": {"daily": 500,  "per_minute": 5},
    "groq":   {"daily": 5000, "per_minute": 30},
    "gemini":  {"daily": 1400, "per_minute": 15},
}


class SimpleQuotaGuard:
    """
    Rolling-window per-provider request rate limiter.

    Tracks call timestamps in a deque and enforces:
    - ``daily``      : maximum calls in any 24-hour sliding window.
    - ``per_minute`` : maximum calls in any 60-second sliding window.

    Limits are loaded from ``model_registry.json["quota_limits"]`` so they
    update dynamically as providers change their tiers — no code changes needed.

    Usage:
        guard = SimpleQuotaGuard()
        if guard.allow("groq"):
            # make API call
            guard.record("groq")
        else:
            # use fallback
    """

    _WINDOW_DAY = 86_400   # 24 h in seconds
    _WINDOW_MIN = 60        # 1 min in seconds

    def __init__(self, limits: Optional[Dict[str, Dict[str, int]]] = None):
        # limits: {"provider_key": {"daily": N, "per_minute": M}, ...}
        self._limits: Dict[str, Dict[str, int]] = limits or dict(_DEFAULT_QUOTA_LIMITS)
        # Each provider stores a deque of UTC timestamps (float) of past calls
        self._history: Dict[str, Deque[float]] = {p: deque() for p in self._limits}

    def _purge_old(self, provider: str, now: float):
        """Remove timestamps outside the 24-hour window (oldest first)."""
        hist = self._history.setdefault(provider, deque())
        cutoff = now - self._WINDOW_DAY
        while hist and hist[0] < cutoff:
            hist.popleft()

    def allow(self, provider: str) -> bool:
        """
        Returns True if the provider is within its rolling quota limits.
        provider: one of 'nvidia', 'groq', 'gemini' (must match quota_limits keys).
        """
        if provider not in self._limits:
            return True  # Unknown provider — allow and let the API decide

        now = time.monotonic() + time.time() - time.monotonic()  # wall-clock float
        now = time.time()
        self._purge_old(provider, now)

        hist = self._history[provider]
        lim = self._limits[provider]

        # Daily window check
        daily_count = len(hist)
        if daily_count >= lim.get("daily", 9_999):
            logger.warning(
                f"[QUOTA GUARD] {provider.upper()} daily limit ({lim['daily']}) reached. "
                f"Routing to fallback or deterministic engine."
            )
            return False

        # Per-minute window check
        min_cutoff = now - self._WINDOW_MIN
        per_min_count = sum(1 for t in hist if t >= min_cutoff)
        if per_min_count >= lim.get("per_minute", 999):
            logger.warning(
                f"[QUOTA GUARD] {provider.upper()} per-minute limit ({lim['per_minute']}) reached. "
                f"Pausing; routing to deterministic engine for this event."
            )
            return False

        return True

    def record(self, provider: str):
        """Records a successful API call timestamp for the given provider."""
        self._history.setdefault(provider, deque()).append(time.time())

    def status(self) -> Dict[str, Dict[str, int]]:
        """Returns current call counts per provider (daily and last minute)."""
        now = time.time()
        result = {}
        for provider in self._limits:
            self._purge_old(provider, now)
            hist = self._history.get(provider, deque())
            min_cutoff = now - self._WINDOW_MIN
            result[provider] = {
                "daily_calls": len(hist),
                "daily_limit": self._limits[provider].get("daily", 0),
                "per_min_calls": sum(1 for t in hist if t >= min_cutoff),
                "per_min_limit": self._limits[provider].get("per_minute", 0),
            }
        return result


# =============================================================================
# JSON SCHEMAS FOR STRUCTURED EXTRACTION
# =============================================================================


CLASSIFICATION_JSON_SCHEMA = {
    "type": "object",
    "properties": {
        "event_id": {"type": "string"},
        "event_type": {
            "type": "string",
            "enum": ["earnings", "central_bank", "geopolitical", "macro", "press_release", "regulatory", "general"]
        },
        "headline": {"type": "string"},
        "summary": {"type": "string"},
        "sector_impacts": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "sector": {"type": "string"},
                    "subsector": {"type": "string"},
                    "direction": {"type": "string", "enum": ["BULLISH", "BEARISH", "NEUTRAL", "MIXED"]},
                    "confidence": {"type": "number"},
                    "catalyst_summary": {"type": "string"},
                    "affected_tickers": {"type": "array", "items": {"type": "string"}},
                    "expiry_hours": {"type": "integer"}
                },
                "required": ["sector", "subsector", "direction", "confidence", "catalyst_summary", "affected_tickers", "expiry_hours"]
            }
        },
        "key_entities": {"type": "array", "items": {"type": "string"}},
        "market_implication": {"type": "string"},
        "urgency": {"type": "string", "enum": ["LOW", "MEDIUM", "HIGH", "CRITICAL"]}
    },
    "required": ["event_id", "event_type", "headline", "summary", "sector_impacts", "key_entities", "market_implication", "urgency"]
}

VERIFICATION_JSON_SCHEMA = {
    "type": "object",
    "properties": {
        "verified": {"type": "boolean"},
        "confidence": {"type": "number"},
        "issues": {"type": "array", "items": {"type": "string"}},
        "corrections": {"type": "array", "items": {"type": "string"}},
        "missing_sectors": {"type": "array", "items": {"type": "string"}},
        "hallucinated_tickers": {"type": "array", "items": {"type": "string"}}
    },
    "required": ["verified", "confidence", "issues", "corrections", "missing_sectors", "hallucinated_tickers"]
}

OPENING_REALITY_CHALLENGE_SCHEMA = {
    "type": "object",
    "properties": {
        "symbol": {"type": "string"},
        "thesis_valid": {"type": "boolean"},
        "confidence": {"type": "number"},
        "action": {"type": "string", "enum": ["EXECUTE", "STAND_DOWN", "RECURSIVE_REPLACE"]},
        "realized_friction_pct": {"type": "number"},
        "invalidation_reason": {"type": "string"},
        "challenges": {"type": "array", "items": {"type": "string"}},
        "order_flow_assessment": {"type": "string"}
    },
    "required": ["symbol", "thesis_valid", "confidence", "action", "realized_friction_pct", "challenges"]
}


# =============================================================================
# STANDARDIZED API CLIENT
# =============================================================================

class OpenAICompatibleClient:
    """Universal lightweight HTTP client for OpenAI-compatible endpoints."""
    
    def __init__(self, base_url: str, api_key: str, model_name: str, timeout: float = 30.0):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model_name = model_name
        self.timeout = timeout
        
    def complete(self, prompt: str, schema: Optional[Dict[str, Any]] = None, temperature: float = 0.0, max_tokens: int = 2048) -> Dict[str, Any]:
        """Synchronous HTTP POST to /chat/completions with JSON response parsing."""
        endpoint = f"{self.base_url}/chat/completions"
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}"
        }
        
        payload: Dict[str, Any] = {
            "model": self.model_name,
            "messages": [
                {"role": "system", "content": "You are an institutional quantitative trading analyst. Always respond in valid, strict JSON matching the provided schema."},
                {"role": "user", "content": prompt}
            ],
            "temperature": temperature,
            "max_tokens": max_tokens
        }
        
        # Enforce json response format where supported
        if schema:
            payload["response_format"] = {"type": "json_object"}
            
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(endpoint, data=data, headers=headers, method="POST")
        
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                result = json.loads(resp.read().decode("utf-8"))
                content = result["choices"][0]["message"]["content"]
                # Parse raw string content as JSON
                # Clean any markdown code fences if present
                clean_content = content.strip()
                if clean_content.startswith("```json"):
                    clean_content = clean_content[7:]
                if clean_content.startswith("```"):
                    clean_content = clean_content[3:]
                if clean_content.endswith("```"):
                    clean_content = clean_content[:-3]
                return json.loads(clean_content.strip())
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8", errors="replace")
            logger.error(f"[HTTP {e.code}] Model call failed for {self.model_name}: {err_body}")
            raise
        except Exception as e:
            logger.error(f"Error calling {self.model_name}: {e}")
            raise


# =============================================================================
# ENSEMBLE ORCHESTRATOR
# =============================================================================

class MultiModelEnsemble:
    """
    Evolutive Multi-Model Critic-Verifier Orchestrator.
    Loads dynamic model configurations, dispatches requests, and handles fallbacks.
    Integrates SimpleQuotaGuard to enforce per-provider rolling-window request limits.
    """
    
    def __init__(self, registry_path: str = "model_registry.json"):
        self.registry_path = registry_path
        self.registry = self._load_registry()
        # Initialise quota guard — limits come from registry or _DEFAULT_QUOTA_LIMITS
        quota_limits = self.registry.get("quota_limits", None)
        self.quota_guard = SimpleQuotaGuard(limits=quota_limits)
        # Dynamically discover active non-deprecated models from live API catalogs
        self._auto_discover_models()

    def _auto_discover_models(self):
        """
        Dynamically probes provider model catalog endpoints to discover active models
        and eradicate hardcoded or retired model strings (e.g. Gemini 1.5 sunset).
        """
        endpoints = self.registry.get("endpoints", {})
        
        # 1. Google Gemini Dynamic Discovery
        gemini_key = os.getenv("GEMINI_API_KEY", "")
        if gemini_key and gemini_key != "MY_GEMINI_API_KEY":
            try:
                url = f"https://generativelanguage.googleapis.com/v1beta/models?key={gemini_key}"
                req = urllib.request.Request(url, headers={"Accept": "application/json"})
                with urllib.request.urlopen(req, timeout=5) as resp:
                    if resp.status == 200:
                        data = json.loads(resp.read().decode("utf-8"))
                        raw_models = data.get("models", [])
                        valid_models = []
                        for m in raw_models:
                            name = m.get("name", "").replace("models/", "")
                            methods = m.get("supportedGenerationMethods", [])
                            # Exclude deprecated / sunset models (e.g. 1.0, 1.5)
                            if "generateContent" in methods and not any(v in name for v in ["1.0", "1.5", "legacy"]):
                                valid_models.append(name)
                        
                        # Find highest flash and pro models
                        flash_candidates = [m for m in valid_models if "flash" in m or "lite" in m]
                        pro_candidates = [m for m in valid_models if "pro" in m or "ultra" in m]
                        
                        best_flash = sorted(flash_candidates, reverse=True)[0] if flash_candidates else "gemini-2.5-flash"
                        best_pro = sorted(pro_candidates, reverse=True)[0] if pro_candidates else "gemini-2.5-pro"
                        
                        if "verifier_2" in endpoints:
                            endpoints["verifier_2"]["active_model"] = best_flash
                        if "judge" in endpoints:
                            endpoints["judge"]["active_model"] = best_pro
                            
                        logger.info(f"[DYNAMIC MODEL CATALOG] Auto-discovered Google models: Flash={best_flash} | Pro={best_pro}")
            except Exception as e:
                logger.debug(f"[DYNAMIC MODEL CATALOG] Gemini probe skipped: {e}")

        # 2. Groq Dynamic Discovery
        groq_key = os.getenv("GROQ_API_KEY", "")
        if groq_key:
            try:
                url = "https://api.groq.com/openai/v1/models"
                req = urllib.request.Request(url, headers={"Authorization": f"Bearer {groq_key}", "Accept": "application/json"})
                with urllib.request.urlopen(req, timeout=5) as resp:
                    if resp.status == 200:
                        data = json.loads(resp.read().decode("utf-8"))
                        groq_models = [m.get("id", "") for m in data.get("data", []) if m.get("active", True)]
                        # Look for latest llama versatile models
                        versatile = [m for m in groq_models if "versatile" in m or "70b" in m]
                        if versatile and "verifier_1" in endpoints:
                            best_groq = sorted(versatile, reverse=True)[0]
                            endpoints["verifier_1"]["active_model"] = best_groq
                            logger.info(f"[DYNAMIC MODEL CATALOG] Auto-discovered Groq model: {best_groq}")
            except Exception as e:
                logger.debug(f"[DYNAMIC MODEL CATALOG] Groq probe skipped: {e}")

        # 3. NVIDIA NIM Dynamic Discovery
        nvidia_key = os.getenv("NVIDIA_API_KEY", "")
        if nvidia_key:
            try:
                url = "https://integrate.api.nvidia.com/v1/models"
                req = urllib.request.Request(url, headers={"Authorization": f"Bearer {nvidia_key}", "Accept": "application/json"})
                with urllib.request.urlopen(req, timeout=5) as resp:
                    if resp.status == 200:
                        data = json.loads(resp.read().decode("utf-8"))
                        nim_models = [m.get("id", "") for m in data.get("data", [])]
                        nemotrons = [m for m in nim_models if "nemotron" in m]
                        if nemotrons and "generator" in endpoints:
                            best_nim = nemotrons[0]
                            endpoints["generator"]["active_model"] = best_nim
                            logger.info(f"[DYNAMIC MODEL CATALOG] Auto-discovered NVIDIA NIM model: {best_nim}")
            except Exception as e:
                logger.debug(f"[DYNAMIC MODEL CATALOG] NVIDIA probe skipped: {e}")

    def _load_registry(self) -> Dict[str, Any]:
        """Loads or falls back to default model registry."""
        if os.path.exists(self.registry_path):
            try:
                with open(self.registry_path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception as e:
                logger.warning(f"Could not load {self.registry_path}, using default mapping: {e}")
        return {
            "endpoints": {
                "generator": {
                    "active_model": "nvidia/nemotron-3-ultra",
                    "base_url": "https://integrate.api.nvidia.com/v1",
                    "api_key_env": "NVIDIA_API_KEY",
                    "fallback_model": "llama-3.1-70b-versatile",
                    "fallback_base_url": "https://api.groq.com/openai/v1",
                    "fallback_key_env": "GROQ_API_KEY"
                },
                "verifier_1": {
                    "active_model": "llama-3.1-70b-versatile",
                    "base_url": "https://api.groq.com/openai/v1",
                    "api_key_env": "GROQ_API_KEY",
                    "fallback_model": "gemini-2.5-flash",
                    "fallback_base_url": "https://generativelanguage.googleapis.com/v1beta/openai/",
                    "fallback_key_env": "GEMINI_API_KEY"
                },
                "verifier_2": {
                    "active_model": "gemini-2.5-flash",
                    "base_url": "https://generativelanguage.googleapis.com/v1beta/openai/",
                    "api_key_env": "GEMINI_API_KEY",
                    "fallback_model": "llama-3.1-70b-versatile",
                    "fallback_base_url": "https://api.groq.com/openai/v1",
                    "fallback_key_env": "GROQ_API_KEY"
                },
                "judge": {
                    "active_model": "gemini-2.5-pro",
                    "base_url": "https://generativelanguage.googleapis.com/v1beta/openai/",
                    "api_key_env": "GEMINI_API_KEY",
                    "fallback_model": "llama-3.1-70b-versatile",
                    "fallback_base_url": "https://api.groq.com/openai/v1",
                    "fallback_key_env": "GROQ_API_KEY"
                }
            }
        }
        
    def _resolve_provider_key(self, role: str, is_fallback: bool = False) -> str:
        """Determines the quota provider identifier (nvidia, groq, gemini)."""
        conf = self.registry.get("endpoints", {}).get(role, {})
        provider = conf.get("fallback_provider" if is_fallback else "provider", "").lower()
        if "nvidia" in provider:
            return "nvidia"
        if "groq" in provider:
            return "groq"
        if "google" in provider or "gemini" in provider:
            return "gemini"
        
        # Infer from key env name or url
        key_env = conf.get("fallback_key_env" if is_fallback else "api_key_env", "").lower()
        if "nvidia" in key_env:
            return "nvidia"
        if "groq" in key_env:
            return "groq"
        if "gemini" in key_env:
            return "gemini"
        return "default"

    def _create_client(self, role: str) -> Optional[Tuple[OpenAICompatibleClient, str]]:
        """
        Creates client for given role with dynamic fallback and quota guard protection.
        Returns a tuple of (OpenAICompatibleClient, provider_key) or None if unavailable.
        """
        conf = self.registry.get("endpoints", {}).get(role, {})
        if not conf:
            return None
            
        primary_key = os.getenv(conf.get("api_key_env", ""), "")
        primary_provider = self._resolve_provider_key(role, is_fallback=False)
        base_url = conf.get("base_url", "")
        model_name = conf.get("active_model", "")
        
        # Check primary key and quota
        if primary_key and self.quota_guard.allow(primary_provider):
            client = OpenAICompatibleClient(
                base_url=base_url,
                api_key=primary_key,
                model_name=model_name,
                timeout=conf.get("timeout_sec", 30.0)
            )
            return client, primary_provider

        # Check fallback if primary key missing or primary quota exhausted
        fallback_key = os.getenv(conf.get("fallback_key_env", ""), "")
        fallback_provider = self._resolve_provider_key(role, is_fallback=True)
        if fallback_key and self.quota_guard.allow(fallback_provider):
            logger.info(f"[{role}] Primary unavailable or quota reached. Using fallback model {conf.get('fallback_model')}")
            client = OpenAICompatibleClient(
                base_url=conf.get("fallback_base_url", base_url),
                api_key=fallback_key,
                model_name=conf.get("fallback_model", model_name),
                timeout=conf.get("timeout_sec", 30.0)
            )
            return client, fallback_provider

        return None

    def evaluate_event(self, event: NewsEvent) -> EnsembleResult:
        """
        Executes the Critic-Verifier Consensus pipeline on a single NewsEvent:
        1. Generator proposes initial classification.
        2. Verifier 1 & Verifier 2 critique proposal in parallel or sequence.
        3. Aggregator evaluates consensus; synthesizes via Judge if conflicts exist.
        4. Degrades gracefully to rule-based parser if API keys are absent.
        """
        gen_res = self._create_client("generator")
        v1_res = self._create_client("verifier_1")
        v2_res = self._create_client("verifier_2")
        judge_res = self._create_client("judge")
        
        # If no LLM keys or quota available, use deterministic quantitative baseline
        if not gen_res:
            logger.warning("[ENSEMBLE OFFLINE] No LLM API keys or quota found. Executing deterministic rule-based event analysis.")
            return self._deterministic_fallback_evaluation(event)
            
        gen_client, gen_provider = gen_res
        v1_client, v1_provider = v1_res if v1_res else (None, None)
        v2_client, v2_provider = v2_res if v2_res else (None, None)
        judge_client, judge_provider = judge_res if judge_res else (None, None)

        # Step 1: Generator
        gen_prompt = self._build_generation_prompt(event)
        try:
            raw_gen = gen_client.complete(gen_prompt, schema=CLASSIFICATION_JSON_SCHEMA)
            self.quota_guard.record(gen_provider)
            classification = self._parse_classified_event(raw_gen, gen_client.model_name)
        except Exception as e:
            logger.error(f"[GENERATOR ERROR] Failed: {e}. Falling back to baseline.")
            return self._deterministic_fallback_evaluation(event)
            
        # Step 2: Verification
        verifications: List[VerificationResult] = []
        for name, v_client, v_prov in [("verifier_1", v1_client, v1_provider), ("verifier_2", v2_client, v2_provider)]:
            if not v_client:
                continue
            v_prompt = self._build_verification_prompt(event, raw_gen)
            try:
                raw_v = v_client.complete(v_prompt, schema=VERIFICATION_JSON_SCHEMA)
                if v_prov:
                    self.quota_guard.record(v_prov)
                verifications.append(VerificationResult(
                    verifier_model=v_client.model_name,
                    verified=bool(raw_v.get("verified", False)),
                    confidence=float(raw_v.get("confidence", 0.5)),
                    issues=list(raw_v.get("issues", [])),
                    corrections=list(raw_v.get("corrections", [])),
                    missing_sectors=list(raw_v.get("missing_sectors", [])),
                    hallucinated_tickers=list(raw_v.get("hallucinated_tickers", []))
                ))
            except Exception as e:
                logger.warning(f"[{name}] Verification error: {e}")
                
        # Step 3: Aggregation & Synthesis
        final_confidence, accepted, requires_review = self._aggregate_consensus(verifications, classification)
        
        # If disputed and judge available, run synthesis
        if not accepted and not requires_review and judge_client and verifications:
            try:
                synth_prompt = self._build_synthesis_prompt(event, raw_gen, verifications)
                raw_synth = judge_client.complete(synth_prompt, schema=CLASSIFICATION_JSON_SCHEMA)
                if judge_provider:
                    self.quota_guard.record(judge_provider)
                classification = self._parse_classified_event(raw_synth, f"{judge_client.model_name}_synthesized")
                final_confidence = 0.80
                accepted = True
                logger.info(f"[JUDGE SYNTHESIS] Harmonized classification accepted with confidence {final_confidence}")
            except Exception as e:
                logger.warning(f"[JUDGE ERROR] Synthesis failed: {e}")
                
        return EnsembleResult(
            event=event,
            classification=classification,
            verifications=verifications,
            final_confidence=final_confidence,
            accepted=accepted,
            requires_human_review=requires_review
        )
        
    def _aggregate_consensus(self, verifications: List[VerificationResult], classification: ClassifiedEvent) -> Tuple[float, bool, bool]:
        """Calculates consensus scores and checks for hallucination flags."""
        if not verifications:
            # Single-model confidence without verifiers
            conf = classification.sector_impacts[0].confidence if classification.sector_impacts else 0.5
            return conf, conf >= 0.70, False
            
        avg_conf = sum(v.confidence for v in verifications) / len(verifications)
        all_verified = all(v.verified for v in verifications)
        any_hallucination = any(len(v.hallucinated_tickers) > 0 for v in verifications)
        
        if any_hallucination:
            logger.warning("[ENSEMBLE ALERT] Hallucinated tickers detected by verifiers. Flagging for review.")
            return avg_conf, False, True
            
        if all_verified and avg_conf >= 0.75:
            return avg_conf, True, False
            
        if avg_conf >= 0.50:
            return avg_conf, False, False  # Requires judge synthesis
            
        return avg_conf, False, True

    def _parse_classified_event(self, data: Dict[str, Any], model_name: str) -> ClassifiedEvent:
        """Parses dictionary into ClassifiedEvent dataclass."""
        impacts: List[SectorImpact] = []
        for item in data.get("sector_impacts", []):
            impacts.append(SectorImpact(
                sector=str(item.get("sector", "General")),
                subsector=str(item.get("subsector", "Equities")),
                direction=item.get("direction", "NEUTRAL"),
                confidence=float(item.get("confidence", 0.5)),
                catalyst_summary=str(item.get("catalyst_summary", "")),
                affected_tickers=list(item.get("affected_tickers", [])),
                expiry_hours=int(item.get("expiry_hours", 24))
            ))
            
        return ClassifiedEvent(
            event_id=str(data.get("event_id", "")),
            headline=str(data.get("headline", "")),
            event_type=str(data.get("event_type", "general")),
            summary=str(data.get("summary", "")),
            sector_impacts=impacts,
            key_entities=list(data.get("key_entities", [])),
            market_implication=str(data.get("market_implication", "")),
            urgency=data.get("urgency", "MEDIUM"),
            model_used=model_name,
            timestamp=datetime.utcnow().isoformat() + "Z"
        )

    def _build_generation_prompt(self, event: NewsEvent) -> str:
        return f"""Analyze this financial event for quantitative intraday trading impact:

EVENT ID: {event.event_id}
TIMESTAMP: {event.timestamp}
SOURCE: {event.source}
HEADLINE: {event.headline}
BODY: {event.body[:2500]}
MENTIONED SYMBOLS: {', '.join(event.symbols_mentioned) if event.symbols_mentioned else 'None'}

INSTRUCTIONS:
1. Identify the primary event type ('earnings', 'central_bank', 'geopolitical', 'macro', 'press_release').
2. Map to affected GICS sectors and subsectors.
3. For each sector, determine direction ('BULLISH', 'BEARISH', 'NEUTRAL', 'MIXED') and confidence (0.0 to 1.0).
4. List tradeable liquid symbols (US and European blue-chips) logically impacted by this event.
5. Provide a concise catalyst rationale and estimated event horizon (expiry_hours).
6. Output strict JSON matching the schema."""

    def _build_verification_prompt(self, event: NewsEvent, proposal: Dict[str, Any]) -> str:
        return f"""You are a skeptical risk auditor verifying a quantitative analyst's proposal:

ORIGINAL EVENT:
Headline: {event.headline}
Body: {event.body[:1500]}

PROPOSAL TO AUDIT:
{json.dumps(proposal, indent=2)}

AUDIT CRITERIA:
1. Are there hallucinated or invalid ticker symbols not supported by the event?
2. Does the directional bias (BULLISH/BEARISH) logically follow from the event economics?
3. Is the confidence score realistic or inflated?
4. Are key affected sectors missing?

Return strict JSON: verified (true/false), confidence (0-1), issues list, corrections list, missing_sectors, hallucinated_tickers."""

    def _build_synthesis_prompt(self, event: NewsEvent, proposal: Dict[str, Any], verifications: List[VerificationResult]) -> str:
        ver_summary = "\n".join([f"- {v.verifier_model}: Verified={v.verified}, Conf={v.confidence}, Issues={v.issues}, Hallucinated={v.hallucinated_tickers}" for v in verifications])
        return f"""Synthesize a definitive institutional classification resolving the disagreements:

ORIGINAL EVENT:
{event.headline}
{event.body[:1500]}

INITIAL PROPOSAL:
{json.dumps(proposal, indent=2)}

VERIFIER AUDITS:
{ver_summary}

TASK:
Produce a corrected, validated JSON classification. Strip out any hallucinated tickers. Adjust directional bias and confidence to reflect consensus truth."""

    def _deterministic_fallback_evaluation(self, event: NewsEvent) -> EnsembleResult:
        """Deterministic keyword-based analysis when no LLM API keys are active."""
        text = f"{event.headline} {event.body}".lower()
        
        sector = "Broad Market"
        subsector = "Equities"
        direction = "NEUTRAL"
        confidence = 0.55
        tickers = ["SPY"]
        catalyst = "General market event"
        
        if any(w in text for w in ["crude", "oil", "opec", "energy", "petroleum", "gas"]):
            sector = "Energy"
            subsector = "Oil & Gas"
            direction = "BULLISH" if any(w in text for w in ["cut", "soar", "gain", "surge", "shortage", "attack"]) else "BEARISH"
            confidence = 0.70
            tickers = ["XLE", "VLO", "COP"]
            catalyst = "Energy supply/demand dynamics"
        elif any(w in text for w in ["fed", "fomc", "rate", "inflation", "cpi", "powell", "ecb"]):
            sector = "Financials"
            subsector = "Macro / Rates"
            direction = "BEARISH" if any(w in text for w in ["hike", "high", "sticky", "hot", "surge"]) else "BULLISH"
            confidence = 0.65
            tickers = ["XLF", "TLT", "SPY"]
            catalyst = "Central bank rate expectations"
        elif any(w in text for w in ["defense", "military", "war", "missile", "nato"]):
            sector = "Industrials"
            subsector = "Aerospace & Defense"
            direction = "BULLISH"
            confidence = 0.72
            tickers = ["ITA", "NOC", "RTX"]
            catalyst = "Geopolitical defense expenditures"
        elif any(w in text for w in ["nvidia", "ai", "semiconductor", "chip", "tech", "earnings"]):
            sector = "Technology"
            subsector = "Semiconductors"
            direction = "BULLISH" if any(w in text for w in ["beat", "record", "growth", "jump"]) else "BEARISH"
            confidence = 0.68
            tickers = ["NVDA", "SMH", "AMD"]
            catalyst = "Tech earnings & AI demand profile"
            
        impact = SectorImpact(
            sector=sector,
            subsector=subsector,
            direction=direction,
            confidence=confidence,
            catalyst_summary=catalyst,
            affected_tickers=tickers,
            expiry_hours=24
        )
        
        from datetime import timezone
        classified = ClassifiedEvent(
            event_id=event.event_id,
            headline=event.headline,
            event_type="macro",
            summary=event.headline,
            sector_impacts=[impact],
            key_entities=tickers,
            market_implication=catalyst,
            urgency="MEDIUM",
            model_used="deterministic_rules_engine",
            timestamp=datetime.now(timezone.utc).isoformat()
        )
        
        return EnsembleResult(
            event=event,
            classification=classified,
            verifications=[],
            final_confidence=confidence,
            accepted=True,
            requires_human_review=False
        )

    def challenge_opening_thesis(
        self,
        candidate_symbol: str,
        direction: str,
        pre_market_catalyst: str,
        expected_move_pct: float,
        opening_snapshot: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Agentic Opening Reality Verifier:
        Challenges the pre-market trading hypothesis against live opening price action,
        realized bid-ask spread, opening volume imbalance, and gap behavior.
        Returns challenge dict indicating whether thesis is intact or requires recursive replacement.
        """
        realized_spread = float(opening_snapshot.get("realized_spread", 0.04))
        stock_price = float(opening_snapshot.get("stock_price", 100.0))
        price_change_pct = float(opening_snapshot.get("price_change_from_open_pct", 0.0))
        volume_ratio = float(opening_snapshot.get("opening_volume_ratio", 1.0))
        ofi_ratio = float(opening_snapshot.get("ofi_ratio", 0.0))

        # 1. Check Realized Friction
        profit_target = max(0.20, stock_price * (expected_move_pct / 100.0))
        half_spread = realized_spread / 2.0
        comm_est = max(0.01, stock_price * 0.0005) * 2.0
        realized_friction_pct = round(((half_spread + comm_est) / profit_target) * 100.0, 2)

        # 2. Check if Critic Model is available and Quota Guard permits
        critic_pair = self._create_client("verifier_1") or self._create_client("judge")
        if critic_pair and self.quota_guard.allow(critic_pair[1]):
            critic_client, critic_provider = critic_pair
            prompt = f"""You are the Institutional Reality Verifier for Alpha Engine.
Challenge this pre-market trading thesis against actual market opening prints:

SYMBOL: {candidate_symbol}
PROPOSED DIRECTION: {direction}
PRE-MARKET CATALYST: {pre_market_catalyst}
EXPECTED MOVE: +{expected_move_pct}%

OPENING MARKET REALITY (15m BUFFER):
- Current Stock Price: ${stock_price:.2f}
- Realized Bid-Ask Spread: ${realized_spread:.3f}
- Calculated Realized Friction: {realized_friction_pct}% (Max allowable ceiling is 15.0%)
- Opening Price Action Change: {price_change_pct:+.2f}%
- Opening Volume vs 20-Day Average: {volume_ratio:.2f}x
- Order Flow Imbalance (OFI): {ofi_ratio:+.2f} (-1.0 heavy sell pressure, +1.0 heavy buy pressure)

INSTRUCTIONS:
1. Is the pre-market thesis validated or refuted by actual opening prints?
2. If Realized Friction > 15.0%, you MUST refute and set action to 'RECURSIVE_REPLACE'.
3. If direction is BUY but price is dropping with negative OFI (gap-and-fade trap), set action to 'RECURSIVE_REPLACE'.
4. If direction is SELL but price is surging with positive OFI (short squeeze), set action to 'RECURSIVE_REPLACE'.
5. If thesis is sound, liquidity is tight, and volume confirms, set action to 'EXECUTE'.
"""
            try:
                raw_challenge = critic_client.complete(prompt, schema=OPENING_REALITY_CHALLENGE_SCHEMA)
                self.quota_guard.record(critic_provider)
                return {
                    "symbol": candidate_symbol,
                    "thesis_valid": bool(raw_challenge.get("thesis_valid", False)),
                    "confidence": float(raw_challenge.get("confidence", 0.75)),
                    "action": str(raw_challenge.get("action", "EXECUTE")),
                    "realized_friction_pct": realized_friction_pct,
                    "invalidation_reason": str(raw_challenge.get("invalidation_reason", "")),
                    "challenges": list(raw_challenge.get("challenges", [])),
                    "order_flow_assessment": str(raw_challenge.get("order_flow_assessment", "Opening auction verified."))
                }
            except Exception as e:
                logger.warning(f"[REALITY VERIFIER ERROR] Critic failed: {e}. Running deterministic challenge.")

        # 3. Deterministic Quantitative Reality Challenge (Quota Guard Safe Fallback)
        challenges = []
        is_valid = True
        inval_reason = ""
        action = "EXECUTE"

        if realized_friction_pct > 15.0:
            is_valid = False
            action = "RECURSIVE_REPLACE"
            inval_reason = f"Opening bid-ask spread (${realized_spread:.3f}) blew out friction to {realized_friction_pct}%, exceeding 15% ceiling."
            challenges.append("EXCESSIVE_FRICTION_SPREAD_BLOWOUT")

        if direction == "BUY" and (price_change_pct < -0.8 or ofi_ratio < -0.3):
            is_valid = False
            action = "RECURSIVE_REPLACE"
            inval_reason = f"Bullish catalyst rejected at open: price slipped {price_change_pct:.2f}% under negative order flow (OFI {ofi_ratio:.2f})."
            challenges.append("GAP_AND_FADE_BEARISH_PRESSURE")
        elif direction == "SELL" and (price_change_pct > 0.8 or ofi_ratio > 0.3):
            is_valid = False
            action = "RECURSIVE_REPLACE"
            inval_reason = f"Bearish catalyst rejected at open: price surged {price_change_pct:.2f}% under positive order flow (OFI {ofi_ratio:.2f})."
            challenges.append("SHORT_SQUEEZE_BULLISH_PRESSURE")

        if is_valid:
            challenges.append("OPENING_LIQUIDITY_TIGHT")
            challenges.append("ORDER_FLOW_CONFIRMS_DIRECTION")

        return {
            "symbol": candidate_symbol,
            "thesis_valid": is_valid,
            "confidence": 0.80 if is_valid else 0.40,
            "action": action,
            "realized_friction_pct": realized_friction_pct,
            "invalidation_reason": inval_reason,
            "challenges": challenges,
            "order_flow_assessment": "Deterministic quantitative order flow analysis."
        }
