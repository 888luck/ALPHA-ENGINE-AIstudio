"""
Universe Models & Data Schemas for Alpha Engine
Defines strict data structures for event ingestion, sector impacts,
IBKR contract specifications, dynamic candidate baskets, and model configurations.
"""

from typing import List, Dict, Any, Optional, Literal
from dataclasses import dataclass, field
from datetime import datetime

# =============================================================================
# EVENT & NEWS SCHEMAS
# =============================================================================

@dataclass
class NewsEvent:
    event_id: str
    timestamp: str  # ISO-8601 UTC
    source: str     # e.g., 'IBKR_BROADTAPE', 'FRED_CALENDAR', 'SEC_EDGAR'
    headline: str
    body: str
    symbols_mentioned: List[str] = field(default_factory=list)
    event_type: str = "general" # 'earnings', 'central_bank', 'geopolitical', 'macro', 'press_release'
    urgency: Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"] = "MEDIUM"
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class SectorImpact:
    sector: str
    subsector: str
    direction: Literal["BULLISH", "BEARISH", "NEUTRAL", "MIXED"]
    confidence: float  # 0.0 to 1.0
    catalyst_summary: str
    affected_tickers: List[str]
    expiry_hours: int = 24


@dataclass
class ClassifiedEvent:
    event_id: str
    headline: str
    event_type: str
    summary: str
    sector_impacts: List[SectorImpact]
    key_entities: List[str]
    market_implication: str
    urgency: Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]
    model_used: str
    timestamp: str


@dataclass
class VerificationResult:
    verifier_model: str
    verified: bool
    confidence: float
    issues: List[str] = field(default_factory=list)
    corrections: List[str] = field(default_factory=list)
    missing_sectors: List[str] = field(default_factory=list)
    hallucinated_tickers: List[str] = field(default_factory=list)


@dataclass
class EnsembleResult:
    event: NewsEvent
    classification: Optional[ClassifiedEvent]
    verifications: List[VerificationResult]
    final_confidence: float
    accepted: bool
    requires_human_review: bool


# =============================================================================
# CONTRACT SPECIFICATIONS & INSTRUMENT SCHEMAS
# =============================================================================

@dataclass
class ContractSpec:
    symbol: str
    secType: str = "STK"
    exchange: str = "SMART"
    primaryExchange: str = ""
    currency: str = "USD"
    conId: int = 0
    minTick: float = 0.01
    liquidHours: str = ""
    timeZoneId: str = "America/New_York"
    isEuropean: bool = False


@dataclass
class RankedCandidate:
    rank: int
    symbol: str
    sector: str
    subsector: str
    direction: Literal["BUY", "SELL"]
    catalyst: str
    confidence: float
    projectedWinRate: float
    profitFactor: float
    expectedMovePct: float
    averageSpread: float
    estimatedFrictionPct: float
    conId: int = 0
    primaryExchange: str = "SMART"
    currency: str = "USD"
    isEuropean: bool = False
    expiryHours: int = 24


@dataclass
class DynamicBasket:
    generatedAt: str  # ISO-8601 UTC
    maxActiveInstruments: int
    candidates: List[RankedCandidate]
    macroContext: str = ""
    sourceEvents: List[str] = field(default_factory=list)


# =============================================================================
# MODEL REGISTRY CONFIGURATION
# =============================================================================

@dataclass
class ModelEndpointConfig:
    role: str # 'generator', 'verifier_1', 'verifier_2', 'judge'
    active_model: str
    provider: str # 'nvidia_nim', 'groq', 'google_genai', 'openrouter', 'ollama'
    fallback_model: str
    fallback_provider: str
    temperature: float = 0.0
    max_tokens: int = 2048
    timeout_sec: float = 30.0
