import os
try:
    from dotenv import load_dotenv
except ImportError:
    def load_dotenv():
        """Fallback placeholder when python-dotenv is not installed."""
        pass

def load_config():
    """
    Loads environment variables for the Alpha Engine IBKR Pro Irland system.
    Parses account, connection, and MiFIR compliance configurations.
    """
    # Load .env file if present
    load_dotenv()
    
    config = {
        "IBKR_ACCOUNT_NUMBER": os.getenv("IBKR_ACCOUNT_NUMBER", ""),
        "IBKR_HOST": os.getenv("IBKR_HOST", "127.0.0.1"),
        "IBKR_PORT": int(os.getenv("IBKR_PORT", "4002")),  # 4001, 4002 (IB Gateway), 7496, 7497 (TWS)
        "IBKR_CLIENT_ID": int(os.getenv("IBKR_CLIENT_ID", "10")),
        
        # MiFIR Transaction Reporting Shortcodes for IBIE compliance (CBI Mandates)
        "MIFID2_DECISION_MAKER_ID": os.getenv("MIFID2_DECISION_MAKER_ID", "ALGO_DEC_992"),
        "MIFID2_EXECUTION_TRADER_ID": os.getenv("MIFID2_EXECUTION_TRADER_ID", "ALGO_EXE_554"),
        
        # FireStore Database Credentials when run in hybrid/prod mode
        "FIREBASE_PROJECT_ID": os.getenv("FIREBASE_PROJECT_ID", ""),
        
        # Dynamic Multi-Agent & Instrument Focus Pool Controls
        "MAX_ACTIVE_INSTRUMENTS": int(os.getenv("MAX_ACTIVE_INSTRUMENTS", "3")),
        "ALLOW_LIVE_TRADING": os.getenv("ALLOW_LIVE_TRADING", "false").lower() in ["true", "1", "yes"],
        
        # Multi-Model API Keys
        "NVIDIA_API_KEY": os.getenv("NVIDIA_API_KEY", ""),
        "GROQ_API_KEY": os.getenv("GROQ_API_KEY", ""),
        "GEMINI_API_KEY": os.getenv("GEMINI_API_KEY", ""),
    }
    
    # Fallback to normalized paper account if empty
    if not config["IBKR_ACCOUNT_NUMBER"]:
        config["IBKR_ACCOUNT_NUMBER"] = "DU1234567"  # Default Paper Simulator Account
        
    print("--------------------------------------------------")
    print("ALPHA ENGINE ARCHITECTURE - CONFIGURATION LOADED")
    print(f"Account: {config['IBKR_ACCOUNT_NUMBER']}")
    print(f"Connection Target: {config['IBKR_HOST']}:{config['IBKR_PORT']} | ID: {config['IBKR_CLIENT_ID']}")
    print(f"Active Basket Focus Limit: {config['MAX_ACTIVE_INSTRUMENTS']} instruments")
    print(f"Live Trading Allowed: {config['ALLOW_LIVE_TRADING']} (Default: PORT 4002 Paper)")
    print(f"MiFIR Compliance: DecisionMaker={config['MIFID2_DECISION_MAKER_ID']} ExecutionTrader={config['MIFID2_EXECUTION_TRADER_ID']}")
    print("--------------------------------------------------")
    
    return config
