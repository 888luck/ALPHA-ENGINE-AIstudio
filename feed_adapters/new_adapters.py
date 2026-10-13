import os
import re
import time
import json
import hashlib
import logging
import urllib.request
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional

import feedparser
from universe_models import NewsEvent
from feed_adapters.base_adapter import BaseFeedAdapter

logger = logging.getLogger("AlphaEngine.NewAdapters")


class EuropeanIRRSSAdapter(BaseFeedAdapter):
    """
    Corporate Investor Relations RSS feed adapter for European blue-chips (e.g. SAP, Airbus, ASML).
    Polls verified corporate IR RSS channels with custom institutional User-Agent via feedparser.
    """
    def __init__(self, config: Dict[str, Any]):
        super().__init__(config)
        self.feeds: Dict[str, str] = config.get("corporate_feeds") or {
            "SAP": "https://news.sap.com/feed/",
            "AIR": "https://www.airbus.com/en/rss.xml",
            "ASML": config.get("endpoint") or "https://www.asml.com/en/rss",
        }

    def poll(self, symbols: List[str] = None) -> List[NewsEvent]:
        events: List[NewsEvent] = []
        target_feeds = self.feeds

        if symbols:
            syms_upper = [s.upper() for s in symbols]
            matched = {k: v for k, v in self.feeds.items() if k.upper() in syms_upper}
            if matched:
                target_feeds = matched
            else:
                return []

        for sym, url in target_feeds.items():
            parsed_feed = None
            try:
                req = urllib.request.Request(url, headers={"User-Agent": self.user_agent})
                with urllib.request.urlopen(req, timeout=6) as resp:
                    parsed_feed = feedparser.parse(resp.read())
            except Exception as e:
                logger.debug(f"[{self.name}] Direct fetch failed for {sym} ({url}): {e}. Retrying via feedparser agent.")
                try:
                    parsed_feed = feedparser.parse(url, agent=self.user_agent)
                except Exception as inner_e:
                    logger.warning(f"[{self.name}] Failed to parse RSS for {sym} ({url}): {inner_e}")
                    continue

            if not parsed_feed or not getattr(parsed_feed, "entries", None):
                continue

            for entry in parsed_feed.entries[:5]:
                headline = entry.get("title", f"{sym} Corporate Announcement").strip()
                raw_body = entry.get("summary", "") or entry.get("description", "") or headline
                body = re.sub(r"<[^>]+>", " ", raw_body).strip()[:1000]
                link = entry.get("link", "")

                ts = None
                if hasattr(entry, "published_parsed") and entry.published_parsed:
                    try:
                        ts = datetime.fromtimestamp(time.mktime(entry.published_parsed), tz=timezone.utc).isoformat()
                    except Exception:
                        pass
                if not ts:
                    ts = datetime.now(timezone.utc).isoformat()

                h = hashlib.md5(f"{headline}_{link}".encode("utf-8")).hexdigest()[:12]
                event_id = f"EU_IR_{sym}_{h}"

                lower_headline = headline.lower()
                high_keywords = [
                    "earnings", "guidance", "revenue", "acquisition", "dividend",
                    "q1", "q2", "q3", "q4", "merger", "halt", "profit", "ebit"
                ]
                urgency = "HIGH" if any(w in lower_headline for w in high_keywords) else "MEDIUM"
                event_type = "earnings" if any(w in lower_headline for w in ["earnings", "revenue", "financial", "results"]) else "corporate_ir"

                events.append(NewsEvent(
                    event_id=event_id,
                    timestamp=ts,
                    source="EUROPEAN_CORP_IR_RSS",
                    headline=f"[{sym} IR] {headline}",
                    body=body,
                    symbols_mentioned=[sym.upper()],
                    event_type=event_type,
                    urgency=urgency,
                    metadata={"link": link, "symbol": sym.upper(), "publisher": sym}
                ))

        return events


class EIAEnergyAdapter(BaseFeedAdapter):
    """
    U.S. Energy Information Administration (EIA) primary-source feed adapter.
    Polls official API v2 endpoints for petroleum/gas storage and spot price prints,
    and incorporates official EIA RSS news channels for real-time energy announcements.
    """
    def __init__(self, config: Dict[str, Any]):
        super().__init__(config)
        self.api_key = os.environ.get("EIA_API_KEY") or config.get("api_key") or "DEMO_KEY"
        self.base_api_url = (config.get("endpoint") or "https://api.eia.gov/v2/").rstrip("/")
        self.rss_endpoints = config.get("rss_endpoints") or [
            "https://www.eia.gov/rss/todayinenergy.xml",
            "https://www.eia.gov/rss/press_rss.xml"
        ]

    def poll(self, symbols: List[str] = None) -> List[NewsEvent]:
        # Macro energy reports primarily affect energy sector baskets (e.g. XLE)
        if symbols and not any(s.upper() in ["XLE", "USO", "UNG", "ENERGY", "CL", "NG", "CVX", "XOM"] for s in symbols):
            return []

        events: List[NewsEvent] = []

        # 1. EIA API v2 - Natural Gas Underground Storage Capacity / Levels
        try:
            url_ng = f"{self.base_api_url}/natural-gas/stor/cap/data/?api_key={self.api_key}&data[0]=value&sort[0][column]=period&sort[0][direction]=desc&length=4"
            req = urllib.request.Request(url_ng, headers={"User-Agent": self.user_agent})
            with urllib.request.urlopen(req, timeout=6) as resp:
                data = json.loads(resp.read().decode())
                records = data.get("response", {}).get("data", [])
                for r in records:
                    period = r.get("period", "")
                    series = r.get("series", "NG")
                    desc = r.get("series-description", "Natural Gas Storage Capacity")
                    val = r.get("value", "N/A")
                    units = r.get("value-units") or r.get("units") or "MMcf"
                    events.append(NewsEvent(
                        event_id=f"EIA_NG_{series}_{period}",
                        timestamp=datetime.now(timezone.utc).isoformat(),
                        source="EIA_ENERGY_OFFICIAL",
                        headline=f"U.S. EIA Natural Gas Storage Print: {desc} [{val} {units}]",
                        body=f"Official U.S. EIA Natural Gas Storage report for period {period}. Metric: {desc}. Reported: {val} {units}.",
                        symbols_mentioned=["XLE"],
                        event_type="macro_energy",
                        urgency="HIGH",
                        metadata={"period": period, "value": val, "units": units, "series": series}
                    ))
        except Exception as e:
            logger.debug(f"[{self.name}] API v2 Natural Gas query failed ({e}). Falling back / continuing.")

        # 2. EIA API v2 - Petroleum Spot Prices & Weekly Prints
        try:
            url_pet = f"{self.base_api_url}/petroleum/pri/spt/data/?api_key={self.api_key}&data[0]=value&sort[0][column]=period&sort[0][direction]=desc&length=4"
            req = urllib.request.Request(url_pet, headers={"User-Agent": self.user_agent})
            with urllib.request.urlopen(req, timeout=6) as resp:
                data = json.loads(resp.read().decode())
                records = data.get("response", {}).get("data", [])
                for r in records:
                    period = r.get("period", "")
                    series = r.get("series", "PET")
                    desc = r.get("series-description", "Petroleum Spot Price")
                    val = r.get("value", "N/A")
                    units = r.get("units") or "$/GAL"
                    prod = r.get("product-name", "Petroleum")
                    events.append(NewsEvent(
                        event_id=f"EIA_PET_{series}_{period}",
                        timestamp=datetime.now(timezone.utc).isoformat(),
                        source="EIA_ENERGY_OFFICIAL",
                        headline=f"U.S. EIA Petroleum Print: {desc} [{val} {units}]",
                        body=f"Official U.S. EIA petroleum print for period {period}. Product: {prod}. Series: {desc}. Price: {val} {units}.",
                        symbols_mentioned=["XLE"],
                        event_type="macro_energy",
                        urgency="MEDIUM",
                        metadata={"period": period, "value": val, "units": units, "product": prod}
                    ))
        except Exception as e:
            logger.debug(f"[{self.name}] API v2 Petroleum query failed ({e}). Falling back / continuing.")

        # 3. EIA Official Real-Time RSS Energy Feeds (Today in Energy & Press Releases)
        for rss_url in self.rss_endpoints:
            parsed_feed = None
            try:
                req = urllib.request.Request(rss_url, headers={"User-Agent": self.user_agent})
                with urllib.request.urlopen(req, timeout=5) as resp:
                    parsed_feed = feedparser.parse(resp.read())
            except Exception:
                try:
                    parsed_feed = feedparser.parse(rss_url, agent=self.user_agent)
                except Exception as inner_e:
                    logger.debug(f"[{self.name}] Failed to parse EIA RSS ({rss_url}): {inner_e}")
                    continue

            if not parsed_feed or not getattr(parsed_feed, "entries", None):
                continue

            for entry in parsed_feed.entries[:3]:
                headline = entry.get("title", "EIA Energy Report").strip()
                raw_body = entry.get("summary", "") or entry.get("description", "") or headline
                body = re.sub(r"<[^>]+>", " ", raw_body).strip()[:1000]
                link = entry.get("link", "")
                h = hashlib.md5(f"{headline}_{link}".encode("utf-8")).hexdigest()[:10]

                ts = None
                if hasattr(entry, "published_parsed") and entry.published_parsed:
                    try:
                        ts = datetime.fromtimestamp(time.mktime(entry.published_parsed), tz=timezone.utc).isoformat()
                    except Exception:
                        pass
                if not ts:
                    ts = datetime.now(timezone.utc).isoformat()

                events.append(NewsEvent(
                    event_id=f"EIA_RSS_{h}",
                    timestamp=ts,
                    source="EIA_ENERGY_OFFICIAL",
                    headline=f"U.S. EIA Energy Report: {headline}",
                    body=body,
                    symbols_mentioned=["XLE"],
                    event_type="macro_energy",
                    urgency="MEDIUM",
                    metadata={"link": link}
                ))

        return events


class ENTSOEElectricityAdapter(BaseFeedAdapter):
    def poll(self, symbols: List[str] = None) -> List[NewsEvent]:
        # EU electricity generation, load, flows
        return []


class USASpendingAdapter(BaseFeedAdapter):
    def poll(self, symbols: List[str] = None) -> List[NewsEvent]:
        # US federal defense contracts (RTX, NOC, ITA)
        return []


class FINRAShortInterestAdapter(BaseFeedAdapter):
    def poll(self, symbols: List[str] = None) -> List[NewsEvent]:
        # Bi-weekly short interest
        return []


class SIAWSTSAdapter(BaseFeedAdapter):
    def poll(self, symbols: List[str] = None) -> List[NewsEvent]:
        # Semiconductor book-to-bill, capacity, inventory cycle
        return []


class GDELTAdapter(BaseFeedAdapter):
    def poll(self, symbols: List[str] = None) -> List[NewsEvent]:
        # Global event sentiment heatmaps
        return []
