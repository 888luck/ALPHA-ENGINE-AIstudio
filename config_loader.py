import os
from dotenv import load_dotenv

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
    }
    
    # Validation Rule checks
    if not config["IBKR_ACCOUNT_NUMBER"]:
        raise ValueError("CRITICAL CONFIG ERROR: IBKR_ACCOUNT_NUMBER must be defined in workspace environment.")
        
    print("--------------------------------------------------")
    print("ALPHA ENGINE ARCHITECTURE - CONFIGURATION LOADED")
    print(f"Account: {config['IBKR_ACCOUNT_NUMBER']}")
    print(f"Connection Target: {config['IBKR_HOST']}:{config['IBKR_PORT']} | ID: {config['IBKR_CLIENT_ID']}")
    print(f"MiFIR Compliance: DecisionMaker={config['MIFID2_DECISION_MAKER_ID']} ExecutionTrader={config['MIFID2_EXECUTION_TRADER_ID']}")
    print("--------------------------------------------------")
    
    return config
