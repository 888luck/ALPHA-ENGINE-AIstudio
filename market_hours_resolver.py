"""
Market Hours & Dynamic Session Resolver for Alpha Engine
Parses official Interactive Brokers liquidHours and tradingHours strings,
computes dynamic opening observation buffers, auto-flatten thresholds,
and detects holidays/weekend market closures without hardcoding.
"""

import re
import logging
from typing import Dict, Any, Optional, Tuple
from datetime import datetime, date, time, timedelta, timezone

try:
    from zoneinfo import ZoneInfo
except ImportError:
    from backports.zoneinfo import ZoneInfo

logger = logging.getLogger("AlphaEngine.MarketHours")
if not logger.handlers:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")


class MarketSessionPhase:
    PRE_MARKET = "PRE_MARKET"
    OPENING_OBSERVATION = "OPENING_OBSERVATION"
    ACTIVE_EXECUTION = "ACTIVE_EXECUTION"
    CLOSING_FLATTEN = "CLOSING_FLATTEN"
    POST_MARKET = "POST_MARKET"
    CLOSED_HOLIDAY = "CLOSED_HOLIDAY"


class MarketHoursResolver:
    """
    Dynamically resolves exchange session clocks from IBKR ContractDetails.
    Supports European Euronext/XETRA and US NYSE/NASDAQ liquidHours formats.
    """

    # Default fallback schedule if IBKR market metadata is not yet populated
    DEFAULT_SCHEDULES = {
        "EUROPE": {
            "tz": "Europe/Paris",
            "open": "09:00",
            "close": "17:30"
        },
        "US": {
            "tz": "America/New_York",
            "open": "09:30",
            "close": "16:00"
        }
    }

    def __init__(self, default_observation_buffer_mins: int = 15, flatten_buffer_mins: int = 5):
        self.observation_buffer_mins = default_observation_buffer_mins
        self.flatten_buffer_mins = flatten_buffer_mins
        self._parsed_cache: Dict[str, Dict[str, Any]] = {}

    def parse_liquid_hours_string(
        self,
        liquid_hours_str: str,
        timezone_id: str,
        target_date: Optional[date] = None
    ) -> Optional[Dict[str, Any]]:
        """
        Parses IBKR liquidHours string.
        Format: "YYYYMMDD:HHMM-HHMM,HHMM-HHMM;YYYYMMDD:CLOSED;..."
        Returns dict with session start/end datetimes in both local TZ and UTC.
        """
        if not liquid_hours_str or not timezone_id:
            return None

        try:
            tz = ZoneInfo(timezone_id)
        except Exception:
            tz = ZoneInfo("UTC")

        today_local = target_date or datetime.now(tz).date()
        date_prefix = today_local.strftime("%Y%m%d")

        # Check cache
        cache_key = f"{liquid_hours_str[:40]}_{date_prefix}_{timezone_id}"
        if cache_key in self._parsed_cache:
            return self._parsed_cache[cache_key]

        # Scan segments separated by semicolon
        segments = liquid_hours_str.split(";")
        for seg in segments:
            seg = seg.strip()
            if not seg:
                continue

            if seg.startswith(date_prefix):
                parts = seg.split(":")
                if len(parts) < 2:
                    continue

                hours_part = parts[1].strip()
                if "CLOSED" in hours_part.upper():
                    res = {
                        "date": today_local,
                        "is_open": False,
                        "status": MarketSessionPhase.CLOSED_HOLIDAY,
                        "tz": timezone_id
                    }
                    self._parsed_cache[cache_key] = res
                    return res

                # Look for first regular trading session: HHMM-HHMM
                match = re.search(r"(\d{4})-(\d{4})", hours_part)
                if match:
                    open_str, close_str = match.groups()
                    open_h, open_m = int(open_str[:2]), int(open_str[2:])
                    close_h, close_m = int(close_str[:2]), int(close_str[2:])

                    session_open = datetime.combine(today_local, time(open_h, open_m), tzinfo=tz)
                    session_close = datetime.combine(today_local, time(close_h, close_m), tzinfo=tz)

                    observation_end = session_open + timedelta(minutes=self.observation_buffer_mins)
                    flatten_start = session_close - timedelta(minutes=self.flatten_buffer_mins)

                    res = {
                        "date": today_local,
                        "is_open": True,
                        "session_open": session_open,
                        "session_close": session_close,
                        "observation_end": observation_end,
                        "flatten_start": flatten_start,
                        "session_open_utc": session_open.astimezone(timezone.utc),
                        "session_close_utc": session_close.astimezone(timezone.utc),
                        "observation_end_utc": observation_end.astimezone(timezone.utc),
                        "flatten_start_utc": flatten_start.astimezone(timezone.utc),
                        "tz": timezone_id,
                        "open_time_str": f"{open_h:02d}:{open_m:02d}",
                        "close_time_str": f"{close_h:02d}:{close_m:02d}"
                    }
                    self._parsed_cache[cache_key] = res
                    return res

        return None

    def get_fallback_session(self, is_european: bool, target_date: Optional[date] = None) -> Dict[str, Any]:
        """Provides default exchange hours when IBKR contractDetails is still loading."""
        cfg = self.DEFAULT_SCHEDULES["EUROPE"] if is_european else self.DEFAULT_SCHEDULES["US"]
        tz = ZoneInfo(cfg["tz"])
        today_local = target_date or datetime.now(tz).date()

        open_h, open_m = map(int, cfg["open"].split(":"))
        close_h, close_m = map(int, cfg["close"].split(":"))

        session_open = datetime.combine(today_local, time(open_h, open_m), tzinfo=tz)
        session_close = datetime.combine(today_local, time(close_h, close_m), tzinfo=tz)
        observation_end = session_open + timedelta(minutes=self.observation_buffer_mins)
        flatten_start = session_close - timedelta(minutes=self.flatten_buffer_mins)

        # Weekend check
        if today_local.weekday() >= 5:
            return {
                "date": today_local,
                "is_open": False,
                "status": MarketSessionPhase.CLOSED_HOLIDAY,
                "tz": cfg["tz"]
            }

        return {
            "date": today_local,
            "is_open": True,
            "session_open": session_open,
            "session_close": session_close,
            "observation_end": observation_end,
            "flatten_start": flatten_start,
            "session_open_utc": session_open.astimezone(timezone.utc),
            "session_close_utc": session_close.astimezone(timezone.utc),
            "observation_end_utc": observation_end.astimezone(timezone.utc),
            "flatten_start_utc": flatten_start.astimezone(timezone.utc),
            "tz": cfg["tz"],
            "open_time_str": cfg["open"],
            "close_time_str": cfg["close"]
        }

    def resolve_session(
        self,
        liquid_hours_str: Optional[str] = None,
        timezone_id: Optional[str] = None,
        is_european: bool = False
    ) -> Dict[str, Any]:
        """Resolves active session with fallback support."""
        if liquid_hours_str and timezone_id:
            parsed = self.parse_liquid_hours_string(liquid_hours_str, timezone_id)
            if parsed:
                return parsed
        return self.get_fallback_session(is_european)

    def determine_phase(
        self,
        session_info: Dict[str, Any],
        current_time_utc: Optional[datetime] = None
    ) -> Tuple[str, str]:
        """
        Determines current MarketSessionPhase and human-readable remaining time.
        Returns: (phase_enum, countdown_str)
        """
        now_utc = current_time_utc or datetime.now(timezone.utc)

        if not session_info.get("is_open", False):
            return MarketSessionPhase.CLOSED_HOLIDAY, "Market Closed (Weekend / Holiday)"

        open_utc = session_info["session_open_utc"]
        obs_end_utc = session_info["observation_end_utc"]
        flatten_utc = session_info["flatten_start_utc"]
        close_utc = session_info["session_close_utc"]

        if now_utc < open_utc:
            delta = open_utc - now_utc
            mins = int(delta.total_seconds() // 60)
            hrs = mins // 60
            m = mins % 60
            countdown = f"Opens in {hrs}h {m}m" if hrs > 0 else f"Opens in {m}m"
            return MarketSessionPhase.PRE_MARKET, countdown

        if open_utc <= now_utc < obs_end_utc:
            delta = obs_end_utc - now_utc
            mins = int(delta.total_seconds() // 60)
            return MarketSessionPhase.OPENING_OBSERVATION, f"Discovery Window ({mins}m remaining)"

        if obs_end_utc <= now_utc < flatten_utc:
            delta = flatten_utc - now_utc
            mins = int(delta.total_seconds() // 60)
            hrs = mins // 60
            m = mins % 60
            countdown = f"Closes in {hrs}h {m}m" if hrs > 0 else f"Closes in {m}m"
            return MarketSessionPhase.ACTIVE_EXECUTION, countdown

        if flatten_utc <= now_utc < close_utc:
            delta = close_utc - now_utc
            mins = int(delta.total_seconds() // 60)
            return MarketSessionPhase.CLOSING_FLATTEN, f"Auto-Flatten Armed ({mins}m to close)"

        return MarketSessionPhase.POST_MARKET, "Market Closed (Post-Session)"
