"""
AlphaEngine Cross-Container Tool Catalog & Full API Reflection Engine.
Reflects the unconstrained official Interactive Brokers API surface (ibapi.client.EClient / ConnectionManager)
and institutional data feed adapters using Python's inspect module.
Outputs standardized JSON Schemas with official vendor docstrings into tools_registry.json with 24h TTL.
"""

import os
import sys
import time
import json
import inspect
from datetime import datetime, timezone
from typing import Dict, List, Any, Optional

# Ensure AlphaEngine roots are on sys.path
BASE_DIR = os.path.abspath(os.path.dirname(__file__))
STUDIO_DIR = os.path.join(BASE_DIR, "ALPHA-ENGINE-AIstudio")
if os.path.exists(STUDIO_DIR) and STUDIO_DIR not in sys.path:
    sys.path.insert(0, STUDIO_DIR)
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

REGISTRY_PATH_ROOT = os.path.join(BASE_DIR, "tools_registry.json")
REGISTRY_PATH_STUDIO = os.path.join(STUDIO_DIR, "tools_registry.json")

# Core IBKR EClient inquiry & operational methods to reflect
IBKR_CALLABLE_METHODS = [
    # Account & Portfolio Inquiries
    "reqAccountSummary",
    "cancelAccountSummary",
    "reqAccountUpdates",
    "reqPositions",
    "cancelPositions",
    "reqPositionsMulti",
    "cancelPositionsMulti",
    "reqPnL",
    "cancelPnL",
    "reqPnLSingle",
    "cancelPnLSingle",
    "reqManagedAccts",
    
    # Contract Resolution & Specs
    "reqContractDetails",
    "reqMatchingSymbols",
    "reqSecDefOptParams",
    
    # Market Data & Depth
    "reqMktData",
    "cancelMktData",
    "reqMarketDataType",
    "reqMktDepth",
    "cancelMktDepth",
    "reqHistogramData",
    "cancelHistogramData",
    "reqHistoricalData",
    "cancelHistoricalData",
    "reqHeadTimeStamp",
    "cancelHeadTimeStamp",
    "calculateImpliedVolatility",
    "calculateOptionPrice",
    "cancelCalculateImpliedVolatility",
    "cancelCalculateOptionPrice",
    
    # Orders, Trades & Executions
    "reqOpenOrders",
    "reqAllOpenOrders",
    "reqAutoOpenOrders",
    "placeOrder",
    "cancelOrder",
    "reqGlobalCancel",
    "reqIds",
    "reqExecutions",
    
    # News, Bulletins & Fundamentals
    "reqNewsBulletins",
    "cancelNewsBulletins",
    "reqNewsProviders",
    "reqHistoricalNews",
    "reqNewsArticle",
    "reqFundamentalData",
    "cancelFundamentalData",
    "reqCurrentTime",
    
    # Market Scanners
    "reqScannerParameters",
    "reqScannerSubscription",
    "cancelScannerSubscription"
]

def map_python_type_to_json_schema(annotation: Any, param_name: str) -> Dict[str, Any]:
    """Map python type annotations or name conventions to JSON schema types."""
    name_lower = param_name.lower()
    
    # Name-based heuristic fallbacks if annotation is empty
    if annotation == inspect.Parameter.empty or annotation is None:
        if any(k in name_lower for k in ["id", "num", "rows", "time", "date_format", "rth", "snapshot"]):
            return {"type": "integer"}
        elif any(k in name_lower for k in ["price", "size", "volatility", "pnl", "cost"]):
            return {"type": "number"}
        elif any(k in name_lower for k in ["flag", "keep", "bind", "active", "is_"]):
            return {"type": "boolean"}
        elif any(k in name_lower for k in ["list", "tags", "options", "array"]):
            return {"type": "array", "items": {"type": "string"}}
        elif any(k in name_lower for k in ["contract", "order", "filter", "subscription"]):
            return {"type": "object"}
        return {"type": "string"}
        
    if annotation in (int,):
        return {"type": "integer"}
    elif annotation in (float,):
        return {"type": "number"}
    elif annotation in (bool,):
        return {"type": "boolean"}
    elif annotation in (str,):
        return {"type": "string"}
    elif annotation in (list, List):
        return {"type": "array", "items": {"type": "string"}}
    elif annotation in (dict, Dict):
        return {"type": "object"}
    return {"type": "string"}

def extract_method_schema(cls_obj: Any, method_name: str, category: str, default_desc: str = "") -> Optional[Dict[str, Any]]:
    """Reflect method signature, official docstring, and argument schemas."""
    if not hasattr(cls_obj, method_name):
        return None
        
    method = getattr(cls_obj, method_name)
    doc = inspect.getdoc(method) or default_desc or f"Interactive Brokers API method: {method_name}"
    
    properties = {}
    required = []
    
    try:
        sig = inspect.signature(method)
        for name, param in sig.parameters.items():
            if name in ("self", "args", "kwargs"):
                continue
                
            p_schema = map_python_type_to_json_schema(param.annotation, name)
            
            # Extract param description if detailed in docstring
            param_desc = f"Parameter {name} for {method_name}"
            if doc and f"{name}:" in doc:
                lines = doc.split("\n")
                for line in lines:
                    if line.strip().startswith(f"{name}:"):
                        param_desc = line.strip().split(":", 1)[1].strip()
                        break
            p_schema["description"] = param_desc
            
            if param.default is inspect.Parameter.empty:
                required.append(name)
            else:
                p_schema["default"] = str(param.default) if not isinstance(param.default, (int, float, bool)) else param.default
                
            properties[name] = p_schema
    except Exception as e:
        properties = {"args": {"type": "object", "description": f"Dynamic arguments for {method_name}"}}
        
    return {
        "type": "function",
        "function": {
            "name": method_name,
            "description": doc.strip(),
            "parameters": {
                "type": "object",
                "properties": properties,
                "required": required
            }
        },
        "category": category,
        "source": "Interactive Brokers Official API (ibapi.client.EClient)"
    }

def reflect_institutional_feed_tools() -> List[Dict[str, Any]]:
    """Reflect verified institutional data feed adapters."""
    feed_tools = [
        {
            "type": "function",
            "function": {
                "name": "get_sec_filings",
                "description": "Queries real SEC EDGAR primary filings (10-K, 10-Q, 8-K, Form 4) for any ticker symbol via official data.sec.gov primary sources. Returns accession numbers, filing dates, and direct links.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "ticker": {
                            "type": "string",
                            "description": "Stock ticker symbol (e.g. NVDA, AAPL, MSFT, TSLA, COP)"
                        },
                        "form_type": {
                            "type": "string",
                            "description": "Optional form filter: '8-K' (material events), '10-Q' (quarterly report), '10-K' (annual report), '4' (insider transactions). If omitted, returns all recent filings."
                        }
                    },
                    "required": ["ticker"]
                }
            },
            "category": "regulatory_sec",
            "source": "U.S. Securities and Exchange Commission (SEC EDGAR)"
        },
        {
            "type": "function",
            "function": {
                "name": "get_clinical_trials",
                "description": "Queries real-time clinical protocol readouts from ClinicalTrials.gov API v2. Returns protocol phases, study titles, and overall status (COMPLETED, RECRUITING, TERMINATED).",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "condition_or_intervention": {
                            "type": "string",
                            "description": "Medical condition, disease, or drug molecule (e.g. Oncology, Pain, Epilepsy)"
                        },
                        "status": {
                            "type": "string",
                            "description": "Optional status filter: 'COMPLETED', 'RECRUITING', 'ACTIVE_NOT_RECRUITING'"
                        }
                    },
                    "required": []
                }
            },
            "category": "biomedical_regulatory",
            "source": "U.S. National Library of Medicine (ClinicalTrials.gov API v2)"
        },
        {
            "type": "function",
            "function": {
                "name": "get_fda_safety_reports",
                "description": "Queries official FDA adverse drug reaction and safety reports from api.fda.gov.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "drug_name": {
                            "type": "string",
                            "description": "Target medicinal product or active pharmaceutical ingredient"
                        },
                        "limit": {
                            "type": "integer",
                            "description": "Maximum number of reports to retrieve (default: 5)"
                        }
                    },
                    "required": []
                }
            },
            "category": "biomedical_regulatory",
            "source": "U.S. Food and Drug Administration (OpenFDA)"
        },
        {
            "type": "function",
            "function": {
                "name": "get_energy_telemetry",
                "description": "Queries official EIA (Energy Information Administration) v2 telemetry for weekly natural gas underground storage, petroleum status, and inventory shifts.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "commodity": {
                            "type": "string",
                            "description": "Energy commodity report: 'natural_gas', 'petroleum', 'crude_oil'"
                        }
                    },
                    "required": []
                }
            },
            "category": "commodity_energy",
            "source": "U.S. Energy Information Administration (EIA v2)"
        }
    ]
    return feed_tools

def build_full_tools_catalog() -> Dict[str, Any]:
    """Inspects EClient, ConnectionManager, and adapters to build the unified catalog."""
    tools: List[Dict[str, Any]] = []
    
    # 1. Reflect official IBKR EClient surface
    try:
        from ibapi.client import EClient
        eclient_cls = EClient
    except ImportError:
        eclient_cls = None
        
    if eclient_cls:
        for m_name in IBKR_CALLABLE_METHODS:
            cat = "broker_account"
            if "Mkt" in m_name or "Historical" in m_name or "Histogram" in m_name or "Volatility" in m_name:
                cat = "broker_market_data"
            elif "Order" in m_name or "Executions" in m_name:
                cat = "broker_orders"
            elif "News" in m_name or "Fundamental" in m_name:
                cat = "broker_news"
            elif "Contract" in m_name or "SecDef" in m_name or "Matching" in m_name:
                cat = "broker_contract"
            elif "Scanner" in m_name:
                cat = "broker_scanner"
                
            schema = extract_method_schema(eclient_cls, m_name, cat)
            if schema:
                tools.append(schema)
                
    # 2. Reflect ConnectionManager helper methods
    try:
        from connection import ConnectionManager
        conn_cls = ConnectionManager
    except ImportError:
        conn_cls = None
        
    if conn_cls:
        helpers = [
            ("resolve_contract_details_blocking", "broker_contract", "Resolves contract details synchronously over the socket with a blocking wait."),
            ("create_contract", "broker_contract", "Constructs a compliant IBKR Contract specification for European or US venues."),
            ("create_market_order", "broker_orders", "Constructs a compliant IBKR Market order (MKT DAY)."),
            ("is_quote_stale", "broker_market_data", "Watchdog testing if quote tick latency exceeds max allowable threshold.")
        ]
        for h_name, h_cat, h_desc in helpers:
            schema = extract_method_schema(conn_cls, h_name, h_cat, h_desc)
            if schema:
                tools.append(schema)
                
    # 3. Add Institutional Feed Tools
    feed_tools = reflect_institutional_feed_tools()
    tools.extend(feed_tools)
    
    categories = list(set(t.get("category", "general") for t in tools))
    
    catalog = {
        "version": "1.0.0",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "ttl_seconds": 86400,
        "total_tools": len(tools),
        "categories": sorted(categories),
        "tools": tools
    }
    return catalog

def save_tools_registry(force_refresh: bool = False) -> Dict[str, Any]:
    """Generates and writes tools_registry.json to root and studio directories."""
    # Check if cache is still valid
    if not force_refresh and os.path.exists(REGISTRY_PATH_ROOT):
        try:
            with open(REGISTRY_PATH_ROOT, "r", encoding="utf-8") as f:
                data = json.load(f)
            gen_time = datetime.fromisoformat(data.get("generated_at", "2000-01-01T00:00:00+00:00"))
            age_seconds = (datetime.now(timezone.utc) - gen_time).total_seconds()
            if age_seconds < data.get("ttl_seconds", 86400):
                return data
        except Exception:
            pass
            
    # Regenerate fresh catalog
    catalog = build_full_tools_catalog()
    
    # Save to Root
    with open(REGISTRY_PATH_ROOT, "w", encoding="utf-8") as f:
        json.dump(catalog, f, indent=2)
        
    # Save to Studio directory if it exists
    if os.path.exists(STUDIO_DIR):
        with open(REGISTRY_PATH_STUDIO, "w", encoding="utf-8") as f:
            json.dump(catalog, f, indent=2)
            
    print(f"[TOOLS REFLECTOR] Generated {catalog['total_tools']} tools across {len(catalog['categories'])} categories. Cached with 24h TTL.")
    return catalog

if __name__ == "__main__":
    force = "--force" in sys.argv
    res = save_tools_registry(force_refresh=force)
    print(f"Registry ready at: {REGISTRY_PATH_ROOT} ({res['total_tools']} tools)")
