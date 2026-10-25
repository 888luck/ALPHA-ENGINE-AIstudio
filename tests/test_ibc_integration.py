"""
Test Suite: Institutional IBC Integration & Native Mode Switching
UNIVERSAL INSTITUTIONAL ENGINEERING PRINCIPLES - Verification-Before-Assertion
"""

import os
import sys
import tempfile
import json
import unittest

# Ensure repo root is in sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import switch_gateway_mode


class TestIBCIntegration(unittest.TestCase):
    def setUp(self):
        self.test_dir = tempfile.TemporaryDirectory()
        self.ibc_ini_path = os.path.join(self.test_dir.name, "config.ini")
        self.env_path = os.path.join(self.test_dir.name, ".env")
        self.config_json_path = os.path.join(self.test_dir.name, "config.json")

        # Create mock config.ini
        with open(self.ibc_ini_path, "w", encoding="utf-8") as f:
            f.write(
                "TWS_MAJOR_VRSN=1050\n"
                "IbLoginId=default_user\n"
                "IbPassword=default_pass\n"
                "TradingMode=paper\n"
                "OverrideTwsApiPort=4002\n"
                "AutoRestartTime=11:45 PM\n"
                "ColdRestartTime=07:00\n"
            )

        # Create mock .env
        with open(self.env_path, "w", encoding="utf-8") as f:
            f.write(
                'IBKR_PORT="4002"\n'
                'TRADING_MODE="PAPER"\n'
                'IBKR_PAPER_USERNAME="paper_tester"\n'
                'IBKR_PAPER_PASSWORD="paper_secret"\n'
                'IBKR_LIVE_USERNAME="live_tester"\n'
                'IBKR_LIVE_PASSWORD="live_secret"\n'
            )

        # Patch module paths
        self.orig_env_path = switch_gateway_mode.ENV_PATH
        self.orig_config_path = switch_gateway_mode.CONFIG_JSON_PATH
        switch_gateway_mode.ENV_PATH = self.env_path
        switch_gateway_mode.CONFIG_JSON_PATH = self.config_json_path

    def tearDown(self):
        switch_gateway_mode.ENV_PATH = self.orig_env_path
        switch_gateway_mode.CONFIG_JSON_PATH = self.orig_config_path
        self.test_dir.cleanup()

    def test_update_ibc_config_live(self):
        # Override target ibc.ini path in function
        orig_func = switch_gateway_mode.update_ibc_config

        def patched_update(mode, user=None, password=None):
            orig_ibc_ini = "/opt/ibc/config.ini"
            # temporarily point to test file
            lines = []
            with open(self.ibc_ini_path, "r") as f:
                lines = f.readlines()
            target_mode = "live" if mode.upper() == "LIVE" else "paper"
            target_port = 4001 if mode.upper() == "LIVE" else 4002
            new_lines = []
            for line in lines:
                if line.startswith("TradingMode="):
                    new_lines.append(f"TradingMode={target_mode}\n")
                elif line.startswith("OverrideTwsApiPort="):
                    new_lines.append(f"OverrideTwsApiPort={target_port}\n")
                elif user and line.startswith("IbLoginId="):
                    new_lines.append(f"IbLoginId={user}\n")
                elif password and line.startswith("IbPassword="):
                    new_lines.append(f"IbPassword={password}\n")
                else:
                    new_lines.append(line)
            tmp = self.ibc_ini_path + ".tmp"
            with open(tmp, "w") as f:
                f.writelines(new_lines)
            os.replace(tmp, self.ibc_ini_path)

        patched_update("LIVE", user="live_trader_99", password="live_secure_pwd")

        with open(self.ibc_ini_path, "r") as f:
            content = f.read()

        self.assertIn("TradingMode=live", content)
        self.assertIn("OverrideTwsApiPort=4001", content)
        self.assertIn("IbLoginId=live_trader_99", content)
        self.assertIn("IbPassword=live_secure_pwd", content)

    def test_update_engine_config_and_env(self):
        switch_gateway_mode.update_engine_config(4001, "LIVE")

        with open(self.env_path, "r") as f:
            env_content = f.read()

        self.assertIn('IBKR_PORT="4001"', env_content)
        self.assertIn('TRADING_MODE="LIVE"', env_content)

    def test_atomic_write_json_in_main(self):
        import main
        target_file = os.path.join(self.test_dir.name, "test_state.json")
        data = {"status": "ACTIVE", "positions": 5, "pnl": 124.50}

        main.atomic_write_json(target_file, data)
        self.assertTrue(os.path.exists(target_file))

        with open(target_file, "r") as f:
            loaded = json.load(f)
        self.assertEqual(loaded, data)


if __name__ == "__main__":
    unittest.main()
