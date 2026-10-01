"""
Event & News Ingestion Engine for Alpha Engine.
Grounds all events in authoritative, primary-source, machine-readable APIs.
Refactored for Phase 4.1 to use the 12-Adapter Pluggable Plugin Registry.
"""

import os
import json
import time
import hashlib
import logging
import importlib
from typing import List, Dict, Any, Optional, Set
from datetime import datetime, timezone

from universe_models import NewsEvent

logger = logging.getLogger("AlphaEngine.NewsIngestor")
if not logger.handlers:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")

class NewsIngestor:
    """
    Primary-source event ingestion and binary catalyst risk-gating engine.
    Now refactored to use a 12-Adapter Pluggable Plugin Registry (Phase 4.1).
    """
    def __init__(self, feed_registry_path: str = "feed_registry.json", connection_manager=None, cik_cache_path: str = "sec_cik_cache.json"):
        self.feed_registry_path = feed_registry_path
        self.cm = connection_manager
        self.seen_event_hashes: Set[str] = set()
        self.event_queue: List[NewsEvent] = []
        self.adapters = []
        self._load_registry()

    def _load_registry(self):
        try:
            with open(self.feed_registry_path, "r", encoding="utf-8") as f:
                registry = json.load(f)
        except Exception as e:
            logger.error(f"Could not load feed registry: {e}")
            return

        try:
            core = importlib.import_module("feed_adapters.core_adapters")
            new_ad = importlib.import_module("feed_adapters.new_adapters")
        except ImportError as e:
            logger.error(f"Failed to load adapter modules: {e}")
            return

        for feed_config in registry.get("feeds", []):
            if not feed_config.get("enabled", False):
                continue
                
            cls_name = feed_config.get("class")
            adapter_class = None
            if hasattr(core, cls_name):
                adapter_class = getattr(core, cls_name)
            elif hasattr(new_ad, cls_name):
                adapter_class = getattr(new_ad, cls_name)
                
            if adapter_class:
                self.adapters.append(adapter_class(feed_config))
                logger.info(f"[PLUGIN REGISTRY] Loaded {cls_name} (Tier {feed_config.get('tier', 'Unknown')})")

    def _generate_event_hash(self, headline: str, source: str) -> str:
        raw = f"{headline}_{source}".encode("utf-8")
        return hashlib.md5(raw).hexdigest()

    def ingest_ibkr_bulletin(self, msg_id: int, msg_type: int, message: str, orig_exchange: str) -> Optional[NewsEvent]:
        h = f"{msg_id}_{msg_type}"
        if h in self.seen_event_hashes: return None
        self.seen_event_hashes.add(h)
        ev = NewsEvent(
            event_id=f"IBKR_{msg_id}",
            timestamp=datetime.now(timezone.utc).isoformat(),
            source="IBKR_BROADTAPE",
            headline=f"Exchange Bulletin: {orig_exchange}",
            body=message,
            symbols_mentioned=[],
            event_type="exchange_bulletin",
            urgency="HIGH" if msg_type in [1, 2] else "MEDIUM"
        )
        self.event_queue.append(ev)
        return ev

    def poll_all_real_feeds(self, symbols: List[str] = None) -> List[NewsEvent]:
        ingested = []
        for adapter in self.adapters:
            # Skip IBKRBulletinsAdapter as it's push-based
            if adapter.__class__.__name__ == "IBKRBulletinsAdapter":
                continue
            try:
                events = adapter.poll(symbols)
                if events:
                    ingested.extend(events)
            except Exception as e:
                logger.warning(f"[FEED ERROR] {adapter.name} failed: {e}")
                
        for ev in ingested:
            if ev.event_id not in self.seen_event_hashes:
                self.seen_event_hashes.add(ev.event_id)
                self.event_queue.append(ev)
                
        return ingested
        
    def check_binary_event_risk_gate(self, symbol: str, lookahead_hours: int = 48) -> Dict[str, Any]:
        for ev in self.event_queue:
            if symbol in ev.symbols_mentioned:
                if ev.event_type in ["clinical_trial", "regulatory", "earnings"] and ev.urgency in ["HIGH", "CRITICAL"]:
                    return {
                        "is_gated": True,
                        "reason": f"Imminent high-impact catalyst detected: {ev.headline}",
                        "event_id": ev.event_id,
                        "source": ev.source
                    }
        return {"is_gated": False, "reason": "No imminent binary event conflict"}

    def parse_ibkr_earnings_calendar(self, symbol: str, xml_data: str) -> Optional[NewsEvent]:
        if not xml_data or "<CalendarReport" not in xml_data:
            return None
        sym = symbol.upper().strip()
        import re
        date_match = re.search(r'date="([^"]+)"', xml_data)
        time_match = re.search(r'time="([^"]+)"', xml_data)
        event_date = date_match.group(1) if date_match else datetime.now(timezone.utc).strftime("%Y-%m-%d")
        event_time_str = time_match.group(1) if time_match else "After Market Close"
        headline = f"Official Earnings Release Date: {sym} ({event_date} - {event_time_str})"
        h = self._generate_event_hash(f"{sym}_{event_date}_EARNINGS", "IBKR_REUTERS_CALENDAR")
        if h not in self.seen_event_hashes:
            self.seen_event_hashes.add(h)
            if self.cm:
                if not hasattr(self.cm, 'binary_event_schedule'):
                    self.cm.binary_event_schedule = {}
                self.cm.binary_event_schedule[sym] = {
                    "title": f"{sym} Earnings Announcement",
                    "date": event_date,
                    "time_str": event_time_str,
                    "is_today_after_hours": event_date == datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                    "timestamp": time.time() + 3600 * 4
                }
            ev = NewsEvent(
                event_id=f"EARN_{sym}_{event_date.replace('-', '')}",
                timestamp=f"{event_date}T00:00:00Z",
                source="IBKR_REUTERS_CALENDAR_OFFICIAL",
                headline=headline,
                body=f"Corporate earnings date confirmed via IBKR Reuters Calendar for {sym}. Scheduled timing: {event_time_str}.",
                symbols_mentioned=[sym],
                event_type="earnings",
                urgency="CRITICAL",
                metadata={"earningsDate": event_date, "timing": event_time_str}
            )
            self.event_queue.append(ev)
            logger.info(f"[EARNINGS CALENDAR RESOLVED] {sym}: {headline}")
            return ev
        return None

    def get_pending_events(self) -> List[NewsEvent]:
        events = list(self.event_queue)
        self.event_queue.clear()
        return events
