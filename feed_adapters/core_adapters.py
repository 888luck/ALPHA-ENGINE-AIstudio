import time
import hashlib
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional

from universe_models import NewsEvent
from feed_adapters.base_adapter import BaseFeedAdapter
import logging

logger = logging.getLogger("AlphaEngine.CoreAdapters")

class IBKRBulletinsAdapter(BaseFeedAdapter):
    def poll(self, symbols: List[str] = None) -> List[NewsEvent]:
        # Handled asynchronously by connection_manager callback
        return []

class SECEdgarAdapter(BaseFeedAdapter):
    def __init__(self, config: Dict[str, Any]):
        super().__init__(config)
        self.cik_cache = {}
        self._init_cik_map()

    def _init_cik_map(self):
        # Known institutional CIKs for core universe
        self.cik_cache = {
            "NVDA": "0001045810",
            "AAPL": "0000320193",
            "MSFT": "0000789019",
            "TSLA": "0001318605",
            "AMZN": "0001018724",
            "XLE": "0001064642"
        }

    def poll(self, symbols: List[str] = None) -> List[NewsEvent]:
        events = []
        target_syms = symbols if symbols else list(self.cik_cache.keys())
        for sym in target_syms:
            cik = self.cik_cache.get(sym.upper())
            if not cik:
                continue
            url = f"https://data.sec.gov/submissions/CIK{cik}.json"
            data = self._http_get_json(url, timeout=5)
            if not data or "filings" not in data or "recent" not in data["filings"]:
                continue
            recent = data["filings"]["recent"]
            forms = recent.get("form", [])
            dates = recent.get("filingDate", [])
            doc_descriptions = recent.get("primaryDocDescription", [])
            accession_numbers = recent.get("accessionNumber", [])
            
            # Scan latest 5 filings
            for i in range(min(5, len(forms))):
                form_type = forms[i]
                if form_type in ["8-K", "10-Q", "10-K", "4"]:
                    acc_num = accession_numbers[i] if i < len(accession_numbers) else str(time.time())
                    ev = NewsEvent(
                        event_id=f"SEC_{sym}_{acc_num}",
                        timestamp=datetime.now(timezone.utc).isoformat(),
                        source="SEC_EDGAR_OFFICIAL",
                        headline=f"SEC Form {form_type} Filing: {sym}",
                        body=f"Official regulatory disclosure {form_type} filed by {sym} on {dates[i] if i < len(dates) else 'recent'}. Doc: {doc_descriptions[i] if i < len(doc_descriptions) else 'N/A'}",
                        symbols_mentioned=[sym],
                        event_type="regulatory_filing" if form_type != "8-K" else "material_event",
                        urgency="HIGH" if form_type == "8-K" else "MEDIUM"
                    )
                    events.append(ev)
        return events

class ClinicalTrialsAdapter(BaseFeedAdapter):
    def poll(self, symbols: List[str] = None) -> List[NewsEvent]:
        # Primary-source API v2 query for completed or interventional phase readouts
        url = "https://clinicaltrials.gov/api/v2/studies?pageSize=5&sort=LastUpdatePostDate:desc"
        data = self._http_get_json(url, timeout=5)
        events = []
        if not data or "studies" not in data:
            return events

        for study in data.get("studies", []):
            protocol = study.get("protocolSection", {})
            ident = protocol.get("identificationModule", {})
            status = protocol.get("statusModule", {})
            nct_id = ident.get("nctId", "NCT_UNKNOWN")
            brief_title = ident.get("briefTitle", "Clinical Study Update")
            overall_status = status.get("overallStatus", "UNKNOWN")

            ev = NewsEvent(
                event_id=f"CT_{nct_id}",
                timestamp=datetime.now(timezone.utc).isoformat(),
                source="CLINICALTRIALS_GOV_V2",
                headline=f"Biopharma Clinical Readout: {nct_id} [{overall_status}]",
                body=f"{brief_title} - Overall status: {overall_status}",
                symbols_mentioned=[],
                event_type="clinical_readout",
                urgency="HIGH" if overall_status in ["COMPLETED", "TERMINATED"] else "LOW"
            )
            events.append(ev)
        return events

class OpenFDAAdapter(BaseFeedAdapter):
    def poll(self, symbols: List[str] = None) -> List[NewsEvent]:
        # Primary-source query for recent FDA drug regulatory actions & adverse reports
        url = "https://api.fda.gov/drug/event.json?limit=5"
        data = self._http_get_json(url, timeout=5)
        events = []
        if not data or "results" not in data:
            return events

        for res in data.get("results", []):
            safety_id = res.get("safetyreportid", str(time.time()))
            medicinal_products = []
            patient = res.get("patient", {})
            for drug in patient.get("drug", []):
                prod = drug.get("medicinalproduct")
                if prod: medicinal_products.append(prod)
            
            ev = NewsEvent(
                event_id=f"FDA_{safety_id}",
                timestamp=datetime.now(timezone.utc).isoformat(),
                source="OPENFDA_REGULATORY",
                headline=f"FDA Safety Adverse Event Report {safety_id}",
                body=f"Target products: {', '.join(medicinal_products[:3]) if medicinal_products else 'Undisclosed'}",
                symbols_mentioned=[],
                event_type="fda_regulatory",
                urgency="MEDIUM"
            )
            events.append(ev)
        return events
