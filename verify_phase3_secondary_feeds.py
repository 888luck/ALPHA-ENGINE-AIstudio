"""
Verification Script for Phase 3 Secondary Feed Harmonization.
Validates:
1. feed_registry.json configures EuropeanIRRSSAdapter and EIAEnergyAdapter as enabled.
2. feed_registry.json disables unprovisioned stubs (USASpending, ENTSO-E, FINRA Short Interest, etc.) with explicit rationales.
3. EuropeanIRRSSAdapter live polls real European IR RSS feeds (SAP, Airbus) emitting valid NewsEvent objects.
4. EIAEnergyAdapter live polls official U.S. EIA petroleum/gas storage and prints emitting valid NewsEvent objects.
5. NewsIngestor end-to-end integration loads only enabled adapters and ingests live network events without synthetic mocks.
"""

import sys
import json
from datetime import datetime
from universe_models import NewsEvent
from news_ingestor import NewsIngestor
from feed_adapters.new_adapters import EuropeanIRRSSAdapter, EIAEnergyAdapter


def verify_phase3_secondary_feeds():
    print("======================================================================")
    print("PHASE 3 SECONDARY FEED HARMONIZATION: LIVE VERIFICATION")
    print("======================================================================")

    # 1. Registry Inspection
    with open("feed_registry.json", "r", encoding="utf-8") as f:
        registry = json.load(f)

    feeds_by_name = {f["name"]: f for f in registry.get("feeds", [])}
    assert "european_ir_rss" in feeds_by_name, "european_ir_rss missing from registry"
    assert "eia_energy" in feeds_by_name, "eia_energy missing from registry"

    assert feeds_by_name["european_ir_rss"]["enabled"] is True, "european_ir_rss should be enabled"
    assert feeds_by_name["eia_energy"]["enabled"] is True, "eia_energy should be enabled"

    disabled_stubs = ["entsoe_electricity", "usa_spending", "finra_short_interest"]
    for stub in disabled_stubs:
        assert stub in feeds_by_name, f"{stub} missing from registry"
        cfg = feeds_by_name[stub]
        assert cfg["enabled"] is False, f"Stub {stub} must be marked enabled=false"
        assert "rationale" in cfg and len(cfg["rationale"]) > 0, f"Stub {stub} must have a non-empty rationale"
        print(f"[REGISTRY AUDIT] Verified disabled stub '{stub}': {cfg['rationale']}")

    print("\n[STEP 1 PASS] feed_registry.json successfully harmonized.")

    # 2. Live Poll Verification: EuropeanIRRSSAdapter
    print("\n[STEP 2] Testing EuropeanIRRSSAdapter Live Network Poll...")
    eu_adapter = EuropeanIRRSSAdapter(feeds_by_name["european_ir_rss"])
    eu_events = eu_adapter.poll()

    assert len(eu_events) > 0, "EuropeanIRRSSAdapter returned 0 events from live corporate IR feeds"
    for ev in eu_events:
        assert isinstance(ev, NewsEvent), "Event is not an instance of NewsEvent"
        assert ev.source == "EUROPEAN_CORP_IR_RSS", f"Invalid source tag: {ev.source}"
        assert ev.event_id.startswith("EU_IR_"), f"Invalid event_id prefix: {ev.event_id}"
        # Validate timestamp parseability
        dt = datetime.fromisoformat(ev.timestamp)
        assert dt is not None, f"Invalid ISO timestamp: {ev.timestamp}"
        assert len(ev.symbols_mentioned) > 0, f"No symbols tagged in European IR event {ev.event_id}"
        assert ev.headline and len(ev.headline) > 5, "Headline empty or too short"

    print(f"[STEP 2 PASS] EuropeanIRRSSAdapter emitted {len(eu_events)} verified real corporate IR events.")
    sample_eu = eu_events[0]
    print(f"  • Sample Event ID : {sample_eu.event_id}")
    print(f"  • Source          : {sample_eu.source}")
    print(f"  • Timestamp (UTC) : {sample_eu.timestamp}")
    print(f"  • Symbols Tagged  : {sample_eu.symbols_mentioned}")
    print(f"  • Urgency         : {sample_eu.urgency}")
    print(f"  • Headline        : {sample_eu.headline}")

    # 3. Live Poll Verification: EIAEnergyAdapter
    print("\n[STEP 3] Testing EIAEnergyAdapter Live Network Poll...")
    eia_adapter = EIAEnergyAdapter(feeds_by_name["eia_energy"])
    eia_events = eia_adapter.poll()

    assert len(eia_events) > 0, "EIAEnergyAdapter returned 0 events from live U.S. EIA endpoints"
    for ev in eia_events:
        assert isinstance(ev, NewsEvent), "Event is not an instance of NewsEvent"
        assert ev.source == "EIA_ENERGY_OFFICIAL", f"Invalid source tag: {ev.source}"
        assert ev.event_id.startswith("EIA_"), f"Invalid event_id prefix: {ev.event_id}"
        dt = datetime.fromisoformat(ev.timestamp)
        assert dt is not None, f"Invalid ISO timestamp: {ev.timestamp}"
        assert "XLE" in ev.symbols_mentioned, "XLE should be tagged in macro energy events"
        assert ev.headline and len(ev.headline) > 5, "Headline empty or too short"

    print(f"[STEP 3 PASS] EIAEnergyAdapter emitted {len(eia_events)} verified real U.S. EIA energy events.")
    sample_eia = eia_events[0]
    print(f"  • Sample Event ID : {sample_eia.event_id}")
    print(f"  • Source          : {sample_eia.source}")
    print(f"  • Timestamp (UTC) : {sample_eia.timestamp}")
    print(f"  • Symbols Tagged  : {sample_eia.symbols_mentioned}")
    print(f"  • Urgency         : {sample_eia.urgency}")
    print(f"  • Headline        : {sample_eia.headline}")

    # 4. NewsIngestor End-to-End Integration
    print("\n[STEP 4] Testing NewsIngestor Plugin Registry & Multi-Feed Ingestion...")
    ingestor = NewsIngestor()
    adapter_names = [a.__class__.__name__ for a in ingestor.adapters]
    print(f"  • Loaded Ingestor Adapters: {adapter_names}")
    assert "EuropeanIRRSSAdapter" in adapter_names, "EuropeanIRRSSAdapter was not loaded by NewsIngestor"
    assert "EIAEnergyAdapter" in adapter_names, "EIAEnergyAdapter was not loaded by NewsIngestor"
    assert "ENTSOEElectricityAdapter" not in adapter_names, "Disabled stub ENTSOEElectricityAdapter should not be loaded"
    assert "USASpendingAdapter" not in adapter_names, "Disabled stub USASpendingAdapter should not be loaded"
    assert "FINRAShortInterestAdapter" not in adapter_names, "Disabled stub FINRAShortInterestAdapter should not be loaded"

    ingested_events = ingestor.poll_all_real_feeds()
    sources = set(e.source for e in ingested_events)
    print(f"  • Total Multi-Feed Events Ingested : {len(ingested_events)}")
    print(f"  • Distinct Active Network Sources : {sorted(list(sources))}")
    assert "EUROPEAN_CORP_IR_RSS" in sources, "EUROPEAN_CORP_IR_RSS missing from ingested events"
    assert "EIA_ENERGY_OFFICIAL" in sources, "EIA_ENERGY_OFFICIAL missing from ingested events"

    print("\n[STEP 4 PASS] NewsIngestor successfully integrated harmonized feeds with Zero Synthetic Mocks.")
    print("======================================================================")
    print("ALL PHASE 3 SECONDARY FEED VERIFICATIONS SUCCEEDED CLEANLY.")
    print("======================================================================")


if __name__ == "__main__":
    verify_phase3_secondary_feeds()
