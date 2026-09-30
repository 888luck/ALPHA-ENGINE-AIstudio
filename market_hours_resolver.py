"""
Market Hours & Dynamic Session Resolver for Alpha Engine
Authoritative exchange session clock resolver integrating:
1. Interactive Brokers liquidHours and tradingHours native socket metadata.
2. Direct exchange_calendars engine (XNYS, XPAR, XFRA / XETR) for official
   exchange holiday schedules, early closes (e.g. 13:00 on Black Friday / Christmas Eve),
   and exact opening/closing timestamps.
3. Dual US / European Daylight Saving Time (DST) desynchronization resolution
   (handling the 2-3 week shift gap between US and European clocks in March and October/November).
"""

import re
import logging
from typing import Dict, Any, Optional, Tuple
from datetime import datetime, date, time, timedelta, timezone

try:
    from zoneinfo import ZoneInfo
except ImportError:
    from backports.zoneinfo import ZoneInfo

# Attempt exchange_calendars import for institutional calendar grounding
try:
    import exchange_calendars as xcals
    HAS_EXCHANGE_CALENDARS = True
except ImportError:
    HAS_EXCHANGE_CALENDARS = False

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
    Dynamically resolves exchange session clocks from IBKR ContractDetails
    and authoritative Python exchange_calendars (XNYS, XPAR, XFRA).
    Eliminates hardcoded clock strings, holiday drifts, and DST desync.
    """

    # Default fallback schedule if IBKR and exchange_calendars are both uninitialized
    DEFAULT_SCHEDULES = {
        "EUROPE": {
            "tz": "Europe/Paris",
            "open": "09:00",
            "close": "17:30",
            "default_cal": "XPAR"
        },
        "US": {
            "tz": "America/New_York",
            "open": "09:30",
            "close": "16:00",
            "default_cal": "XNYS"
        }
    }

    def __init__(self, default_observation_buffer_mins: int = 15, flatten_buffer_mins: int = 5):
        self.observation_buffer_mins = default_observation_buffer_mins
        self.flatten_buffer_mins = flatten_buffer_mins
        self._parsed_cache: Dict[str, Dict[str, Any]] = {}
        self._calendar_cache: Dict[str, Any] = {}

    def _get_calendar(self, exchange_code: str) -> Optional[Any]:
        """Lazy loader and cache for exchange_calendars instances."""
        if not HAS_EXCHANGE_CALENDARS:
            return None
        clean_code = exchange_code.upper().strip()
        # Aliases
        if clean_code in ["NYSE", "NASDAQ", "ARCA", "BATS", "SMART"]:
            clean_code = "XNYS"
        elif clean_code in ["EURONEXT", "SBF", "PA", "PARIS"]:
            clean_code = "XPAR"
        elif clean_code in ["XETRA", "IBIS", "GERMANY", "FRANKFURT"]:
            clean_code = "XETR"
        elif clean_code in ["FRA"]:
            clean_code = "XFRA"

        if clean_code not in self._calendar_cache:
            try:
                cal = xcals.get_calendar(clean_code)
                self._calendar_cache[clean_code] = cal
                logger.info(f"[EXCHANGE CALENDAR] Initialized official calendar for {clean_code}")
            except Exception as e:
                logger.debug(f"[EXCHANGE CALENDAR] Could not load calendar for {clean_code}: {e}")
                return None
        return self._calendar_cache.get(clean_code)

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
                        "tz": timezone_id,
                        "source": "IBKR_LIQUID_HOURS"
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
                        "close_time_str": f"{close_h:02d}:{close_m:02d}",
                        "source": "IBKR_LIQUID_HOURS"
                    }
                    self._parsed_cache[cache_key] = res
                    return res

        return None

    def get_exchange_calendar_session(
        self,
        exchange_code: str,
        target_date: Optional[date] = None
    ) -> Optional[Dict[str, Any]]:
        """
        Dynamically queries Python exchange_calendars for official exchange sessions,
        half-days, early closes, and holidays.
        """
        cal = self._get_calendar(exchange_code)
        if not cal:
            return None

        # Determine target date
        tz_name = cal.tz.zone if hasattr(cal.tz, "zone") else str(cal.tz)
        local_tz = ZoneInfo(tz_name)
        today_local = target_date or datetime.now(local_tz).date()
        date_str = today_local.strftime("%Y-%m-%d")

        try:
            is_session = cal.is_session(date_str)
            if not is_session:
                return {
                    "date": today_local,
                    "is_open": False,
                    "status": MarketSessionPhase.CLOSED_HOLIDAY,
                    "tz": tz_name,
                    "exchange": cal.name,
                    "source": "EXCHANGE_CALENDARS_HOLIDAY"
                }

            # Extract exact official session open & close timestamps in UTC
            open_utc_ts = cal.session_open(date_str)
            close_utc_ts = cal.session_close(date_str)

            # Convert to python timezone-aware datetimes
            session_open_utc = open_utc_ts.to_pydatetime()
            session_close_utc = close_utc_ts.to_pydatetime()

            session_open = session_open_utc.astimezone(local_tz)
            session_close = session_close_utc.astimezone(local_tz)

            observation_end_utc = session_open_utc + timedelta(minutes=self.observation_buffer_mins)
            flatten_start_utc = session_close_utc - timedelta(minutes=self.flatten_buffer_mins)

            observation_end = observation_end_utc.astimezone(local_tz)
            flatten_start = flatten_start_utc.astimezone(local_tz)

            return {
                "date": today_local,
                "is_open": True,
                "session_open": session_open,
                "session_close": session_close,
                "observation_end": observation_end,
                "flatten_start": flatten_start,
                "session_open_utc": session_open_utc,
                "session_close_utc": session_close_utc,
                "observation_end_utc": observation_end_utc,
                "flatten_start_utc": flatten_start_utc,
                "tz": tz_name,
                "open_time_str": session_open.strftime("%H:%M"),
                "close_time_str": session_close.strftime("%H:%M"),
                "exchange": cal.name,
                "source": "EXCHANGE_CALENDARS_OFFICIAL"
            }
        except Exception as e:
            logger.debug(f"[EXCHANGE CALENDAR ERR] Failed resolving session for {exchange_code} on {date_str}: {e}")
            return None

    def get_fallback_session(self, is_european: bool, target_date: Optional[date] = None) -> Dict[str, Any]:
        """Provides default exchange hours when IBKR contractDetails and exchange_calendars are uninitialized."""
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
                "tz": cfg["tz"],
                "source": "WEEKEND_FALLBACK"
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
            "close_time_str": cfg["close"],
            "source": "STATIC_SCHEDULE_FALLBACK"
        }

    def resolve_session(
        self,
        liquid_hours_str: Optional[str] = None,
        timezone_id: Optional[str] = None,
        is_european: bool = False,
        exchange_code: Optional[str] = None,
        target_date: Optional[date] = None
    ) -> Dict[str, Any]:
        """
        Multi-tier dynamic session resolver:
        Tier 1: IBKR official liquidHours string (from socket).
        Tier 2: Python exchange_calendars (XNYS, XPAR, XETR) for official holidays/early closes.
        Tier 3: Timezone-aware fallback.
        """
        # Tier 1: IBKR liquid hours string
        if liquid_hours_str and timezone_id:
            parsed = self.parse_liquid_hours_string(liquid_hours_str, timezone_id, target_date=target_date)
            if parsed:
                return parsed

        # Tier 2: Authoritative exchange_calendars
        cal_code = exchange_code or ("XPAR" if is_european else "XNYS")
        cal_session = self.get_exchange_calendar_session(cal_code, target_date=target_date)
        if cal_session:
            return cal_session

        # Tier 3: Timezone fallback
        return self.get_fallback_session(is_european, target_date=target_date)

    def resolve_dst_desync(self, target_date: Optional[date] = None) -> Dict[str, Any]:
        """
        Dual US vs European Daylight Saving Time (DST) Desynchronization Monitor.
        US shifts clocks on 2nd Sunday of March & 1st Sunday of November.
        Europe shifts clocks on last Sunday of March & last Sunday of October.
        Returns the exact offset hour difference (normally 6 hours, 5 hours during desync).
        """
        check_date = target_date or datetime.now(timezone.utc).date()
        noon = time(12, 0)
        dt_ny = datetime.combine(check_date, noon, tzinfo=ZoneInfo("America/New_York"))
        dt_par = datetime.combine(check_date, noon, tzinfo=ZoneInfo("Europe/Paris"))

        ny_offset = dt_ny.utcoffset().total_seconds() / 3600.0  # -4 (EDT) or -5 (EST)
        par_offset = dt_par.utcoffset().total_seconds() / 3600.0 # +2 (CEST) or +1 (CET)

        diff_hours = par_offset - ny_offset
        is_desynced = (diff_hours != 6.0)

        return {
            "date": check_date.isoformat(),
            "ny_tz": "EDT" if ny_offset == -4.0 else "EST",
            "par_tz": "CEST" if par_offset == 2.0 else "CET",
            "hour_difference": diff_hours,
            "is_dst_desynced": is_desynced,
            "note": "DST Desynchronization Active (5h difference between NY and Paris)" if is_desynced else "Normal DST Alignment (6h difference)"
        }

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
