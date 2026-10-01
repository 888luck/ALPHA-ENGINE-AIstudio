import json
import logging
import urllib.request
import hashlib
from abc import ABC, abstractmethod
from typing import List, Dict, Any, Optional
from universe_models import NewsEvent

logger = logging.getLogger("AlphaEngine.BaseFeedAdapter")

class BaseFeedAdapter(ABC):
    """
    Abstract Base Class for all Alpha Engine primary-source data feeds.
    Enforces a strict standardized interface for fetching events.
    """
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.name = config.get("name", self.__class__.__name__)
        self.endpoint = config.get("endpoint", "")
        self.user_agent = "AlphaEngineQuantitativeSystem/2.0 (InstitutionalResearch; contact@alphaengine.internal)"

    def _http_get_json(self, url: str, timeout: int = 8) -> Optional[Dict[str, Any]]:
        req = urllib.request.Request(url, headers={"User-Agent": self.user_agent})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as response:
                return json.loads(response.read().decode())
        except Exception as e:
            logger.debug(f"[{self.name}] HTTP Error on {url}: {e}")
            return None

    def _generate_event_hash(self, headline: str, source: str) -> str:
        raw = f"{headline}_{source}".encode("utf-8")
        return hashlib.md5(raw).hexdigest()

    @abstractmethod
    def poll(self, symbols: List[str] = None) -> List[NewsEvent]:
        """Polls the endpoint and returns a list of normalized NewsEvent objects."""
        pass
