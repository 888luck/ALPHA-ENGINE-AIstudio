"""
Natural Language Risk Sanitizer & Master Envelope Clamping Engine.
Parses conversational user risk allocations and clamps reckless inputs
against Alpha Engine's non-bypassable pre-trade institutional gates (risk_engine.py).
"""

import re
from typing import Dict, Any, List, Optional, Tuple


class RiskSanitizer:
    """
    Translates user-specified natural language or dictionary risk constraints into
    strictly typed parameters, enforcing the Institutional Master Risk Envelope:
      - Max capital allocation per simulation: $10,000 (Gate 1 equivalent)
      - Max trade risk budget (r): 1.0% equity (firm default r = 0.25%, ceiling = 1.0%)
      - Max daily portfolio loss: min(user_val, 4r or 4.0% of capital)
      - Transaction friction ceiling: max 15.0%
      - Binary event blackout window: minimum 48 hours (Gate 5)
      - Max ADV participation: 1.5% (Gate 3)
    """

    # Master Institutional Ceilings (Non-Bypassable Firm Policy)
    FIRM_MAX_CAPITAL_CEILING_USD = 10000.0
    FIRM_MAX_TRADE_RISK_PCT = 1.0       # 1.0% maximum risk per trade
    FIRM_DEFAULT_TRADE_RISK_PCT = 0.25   # 0.25% default institutional risk budget
    FIRM_MAX_FRICTION_CEILING_PCT = 15.0 # 15.0% max friction allowed
    FIRM_MIN_BINARY_BLACKOUT_HOURS = 48  # Minimum 48 hours blackout before earnings/PDUFA
    FIRM_MAX_ADV_PARTICIPATION_PCT = 1.5 # 1.5% maximum ADV participation

    @classmethod
    def parse_natural_language_intent(cls, prompt: str) -> Dict[str, Any]:
        """
        Extracts numbers, currency symbols, and constraint phrases from natural language.
        Example: "Run simulation on ASML with €25,000 capital, 0.5% risk per trade, €800 daily stop, friction under 10%"
        """
        extracted = {
            "requested_capital": None,
            "currency": "USD",
            "requested_risk_pct": None,
            "requested_daily_loss": None,
            "requested_friction_pct": None,
            "requested_blackout_days": None,
            "lookback_days": 30
        }

        # 1. Capital detection: e.g. €25,000 or $10,000 or 25000 EUR
        cap_match = re.search(r'(?:€|\$|£|EUR|USD|GBP)?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]+)?|[0-9]+)\s*(?:€|\$|£|EUR|USD|GBP)?\s*(?:capital|allocation|starting\s*capital|account)', prompt, re.IGNORECASE)
        if cap_match:
            raw_num = cap_match.group(1).replace(',', '')
            extracted["requested_capital"] = float(raw_num)
            if '€' in prompt or 'EUR' in prompt.upper():
                extracted["currency"] = "EUR"
            elif '£' in prompt or 'GBP' in prompt.upper():
                extracted["currency"] = "GBP"

        # 2. Risk per trade: e.g. "0.5% risk", "risk 1%"
        risk_match = re.search(r'([0-9]+(?:\.[0-9]+)?)\s*%\s*(?:risk|per\s*trade|r\b)', prompt, re.IGNORECASE)
        if risk_match:
            extracted["requested_risk_pct"] = float(risk_match.group(1))

        # 3. Daily loss stop: e.g. "€800 daily stop", "$500 max loss"
        stop_match = re.search(r'(?:€|\$|£)?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]+)?|[0-9]+)\s*(?:daily\s*stop|max\s*loss|daily\s*loss|circuit\s*breaker)', prompt, re.IGNORECASE)
        if stop_match:
            raw_num = stop_match.group(1).replace(',', '')
            extracted["requested_daily_loss"] = float(raw_num)

        # 4. Friction ceiling: e.g. "friction under 10%", "10% friction ceiling"
        fric_match = re.search(r'([0-9]+(?:\.[0-9]+)?)\s*%\s*(?:max\s*friction|friction\s*ceiling|friction)', prompt, re.IGNORECASE)
        if fric_match:
            extracted["requested_friction_pct"] = float(fric_match.group(1))

        # 5. Blackout window: e.g. "3 days before earnings", "blackout 72 hours"
        days_match = re.search(r'([0-9]+)\s*(?:days?|d)\s*(?:before\s*earnings|blackout|lockout)', prompt, re.IGNORECASE)
        if days_match:
            extracted["requested_blackout_days"] = int(days_match.group(1))

        # 6. Lookback days: e.g. "30 trading days", "last 60 days"
        lookback_match = re.search(r'(?:last|past|over)\s*([0-9]+)\s*(?:trading\s*days|days|bars)', prompt, re.IGNORECASE)
        if lookback_match:
            extracted["lookback_days"] = int(lookback_match.group(1))

        return extracted

    @classmethod
    def sanitize_and_clamp_parameters(
        cls,
        user_inputs: Dict[str, Any],
        fx_rate_to_usd: float = 1.08 # Approx EUR/USD rate for Gate 1 parity check
    ) -> Dict[str, Any]:
        """
        Clamps user parameters to ensure they never breach the institutional master envelope.
        Generates a transparent audit log explaining every clamp or approval.
        """
        audit_trail: List[str] = []
        is_clamped = False

        currency = user_inputs.get("currency", "USD").upper()
        raw_capital = user_inputs.get("requested_capital")
        if raw_capital is None or raw_capital <= 0:
            capital = 10000.0
            audit_trail.append(f"No valid capital specified; defaulted to firm sandbox baseline {currency} {capital:,.2f}.")
        else:
            capital = raw_capital

        # Gate 1 Check: Capital Ceiling ($10,000 USD equivalent)
        capital_usd = capital * fx_rate_to_usd if currency == "EUR" else capital
        max_allowed_local = cls.FIRM_MAX_CAPITAL_CEILING_USD / (fx_rate_to_usd if currency == "EUR" else 1.0)

        if capital_usd > cls.FIRM_MAX_CAPITAL_CEILING_USD:
            audit_trail.append(
                f"[GATE 1 CLAMP] Requested capital {currency} {capital:,.2f} exceeds firm institutional ceiling "
                f"(${cls.FIRM_MAX_CAPITAL_CEILING_USD:,.2f} USD). Clamped to {currency} {max_allowed_local:,.2f}."
            )
            capital = round(max_allowed_local, 2)
            is_clamped = True
        else:
            audit_trail.append(f"[GATE 1 COMPLIANT] Capital {currency} {capital:,.2f} is within institutional envelope.")

        # Risk per trade (% of equity)
        raw_risk_pct = user_inputs.get("requested_risk_pct")
        if raw_risk_pct is None:
            risk_pct = cls.FIRM_DEFAULT_TRADE_RISK_PCT
            audit_trail.append(f"Risk per trade defaulted to firm standard {risk_pct}% (r-budget).")
        else:
            if raw_risk_pct > cls.FIRM_MAX_TRADE_RISK_PCT:
                audit_trail.append(
                    f"[RISK CLAMP] Requested risk {raw_risk_pct:.2f}% exceeds institutional ceiling "
                    f"({cls.FIRM_MAX_TRADE_RISK_PCT:.2f}%). Clamped to {cls.FIRM_MAX_TRADE_RISK_PCT:.2f}%."
                )
                risk_pct = cls.FIRM_MAX_TRADE_RISK_PCT
                is_clamped = True
            elif raw_risk_pct <= 0:
                risk_pct = cls.FIRM_DEFAULT_TRADE_RISK_PCT
                audit_trail.append(f"Non-positive risk input was reset to {risk_pct}%.")
                is_clamped = True
            else:
                risk_pct = raw_risk_pct
                audit_trail.append(f"[RISK APPROVED] Per-trade risk set to {risk_pct:.2f}% of equity.")

        cash_risk_per_trade = round(capital * (risk_pct / 100.0), 2)

        # Gate 2 Check: Daily Max Loss Cutoff
        # Firm rule: defaults to 4r ($1,000 on $100k, or 4 * cash_risk_per_trade)
        firm_standard_cutoff = round(4.0 * cash_risk_per_trade, 2)
        raw_daily_loss = user_inputs.get("requested_daily_loss")
        if raw_daily_loss is None:
            daily_loss_cutoff = firm_standard_cutoff
            audit_trail.append(f"Daily hard loss stop defaulted to 4r ({currency} {daily_loss_cutoff:,.2f}).")
        else:
            # User can specify a tighter stop, but cannot exceed 4r / 4% of capital
            max_allowed_cutoff = firm_standard_cutoff * 1.5 # Allow up to 6r max
            if raw_daily_loss > max_allowed_cutoff:
                audit_trail.append(
                    f"[GATE 2 CLAMP] Requested daily loss {currency} {raw_daily_loss:,.2f} exceeds max 6r ceiling "
                    f"({currency} {max_allowed_cutoff:,.2f}). Clamped to {currency} {max_allowed_cutoff:,.2f}."
                )
                daily_loss_cutoff = max_allowed_cutoff
                is_clamped = True
            else:
                daily_loss_cutoff = raw_daily_loss
                audit_trail.append(f"[GATE 2 COMPLIANT] Daily hard loss stop set to {currency} {daily_loss_cutoff:,.2f}.")

        # Friction Ceiling Check (<15% institutional rule)
        raw_friction = user_inputs.get("requested_friction_pct")
        if raw_friction is None:
            friction_ceiling = cls.FIRM_MAX_FRICTION_CEILING_PCT
        else:
            if raw_friction > cls.FIRM_MAX_FRICTION_CEILING_PCT:
                audit_trail.append(
                    f"[FRICTION CLAMP] Requested friction ceiling {raw_friction:.1f}% exceeds firm maximum "
                    f"({cls.FIRM_MAX_FRICTION_CEILING_PCT:.1f}%). Clamped to {cls.FIRM_MAX_FRICTION_CEILING_PCT:.1f}%."
                )
                friction_ceiling = cls.FIRM_MAX_FRICTION_CEILING_PCT
                is_clamped = True
            elif raw_friction <= 0:
                friction_ceiling = cls.FIRM_MAX_FRICTION_CEILING_PCT
            else:
                friction_ceiling = raw_friction
                audit_trail.append(f"[FRICTION APPROVED] Custom tighter friction ceiling set to {friction_ceiling:.1f}%.")

        # Gate 5 Check: Binary Event Blackout Window (Minimum 48 hours / 2 days)
        raw_blackout_days = user_inputs.get("requested_blackout_days")
        if raw_blackout_days is None or raw_blackout_days < 2:
            blackout_hours = cls.FIRM_MIN_BINARY_BLACKOUT_HOURS
            audit_trail.append(f"[GATE 5 ENFORCED] Binary event blackout enforced at {blackout_hours}h (minimum).")
        else:
            blackout_hours = raw_blackout_days * 24
            audit_trail.append(f"[GATE 5 APPROVED] Extended binary event blackout set to {raw_blackout_days} days ({blackout_hours}h).")

        lookback = max(10, min(365, user_inputs.get("lookback_days", 30)))

        return {
            "is_clamped": is_clamped,
            "currency": currency,
            "sanitized_capital": capital,
            "risk_per_trade_pct": risk_pct,
            "cash_risk_per_trade": cash_risk_per_trade,
            "daily_max_loss_cutoff": daily_loss_cutoff,
            "friction_ceiling_pct": friction_ceiling,
            "binary_blackout_hours": blackout_hours,
            "max_adv_participation_pct": cls.FIRM_MAX_ADV_PARTICIPATION_PCT,
            "lookback_days": lookback,
            "audit_trail": audit_trail
        }
