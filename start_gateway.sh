#!/bin/bash
set -e

echo "[IBGATEWAY-DAEMON] Initializing headless display stack on :1..."
pkill -f "Xvfb :1" || true
pkill -f "x11vnc.*:1" || true
pkill -f "websockify.*6080" || true
pkill -f "gateway_autologin.py" || true

Xvfb :1 -screen 0 1280x800x24 &
sleep 2

echo "[IBGATEWAY-DAEMON] Starting loopback x11vnc on :1..."
x11vnc -display :1 -nopw -listen 127.0.0.1 -forever -shared -bg

echo "[IBGATEWAY-DAEMON] Starting websockify bridge on port 6080..."
websockify -D --web /usr/share/novnc 127.0.0.1:6080 127.0.0.1:5900

echo "[IBGATEWAY-DAEMON] Verifying environment & Jts paths..."
mkdir -p /root/Jts /home/mstouff/Jts /root/Jts/ibgateway
if [ ! -f /root/Jts/jts.ini ]; then
  cp /opt/ibgateway/jts.ini /root/Jts/jts.ini
fi
cp /root/Jts/jts.ini /home/mstouff/Jts/jts.ini
chown -R mstouff:mstouff /home/mstouff/Jts

# Ensure Gateway 1050 symlinks exist for IBC path discovery
ln -sfn /opt/ibgateway /root/Jts/ibgateway/1050
ln -sfn /opt/ibgateway /root/Jts/1050
echo "/opt/ibgateway/jre" > /opt/ibgateway/.install4j/pref_jre.cfg

# Sync IBC config credentials and mode dynamically from /opt/alpha-engine/.env if present
TARGET_MODE="paper"
if [ -f /opt/alpha-engine/.env ]; then
  echo "[IBGATEWAY-DAEMON] Syncing IBC credentials & lane from /opt/alpha-engine/.env..."
  python3 -c "
import os
env_vars = {}
try:
    with open('/opt/alpha-engine/.env', 'r') as f:
        for line in f:
            line = line.strip()
            if '=' in line and not line.startswith('#'):
                k, v = line.split('=', 1)
                env_vars[k.strip()] = v.strip().strip('\"').strip(\"'\")
except Exception as e:
    print(f'[IBGATEWAY-DAEMON] Warning reading .env: {e}')

trading_mode = env_vars.get('TRADING_MODE', 'PAPER').upper()
is_live = (trading_mode == 'LIVE')

target_mode = 'live' if is_live else 'paper'
target_port = 4001 if is_live else 4002

if is_live:
    user = env_vars.get('IBKR_LIVE_USERNAME') or env_vars.get('IBKR_USERNAME', '')
    passwd = env_vars.get('IBKR_LIVE_PASSWORD') or env_vars.get('IBKR_PASSWORD', '')
else:
    user = env_vars.get('IBKR_PAPER_USERNAME') or env_vars.get('IBKR_USERNAME', 'mstouff17')
    passwd = env_vars.get('IBKR_PAPER_PASSWORD') or env_vars.get('IBKR_PASSWORD', '')

ibc_ini = '/opt/ibc/config.ini'
if os.path.exists(ibc_ini):
    try:
        with open(ibc_ini, 'r') as f:
            content = f.read()
        new_lines = []
        for line in content.splitlines():
            if line.startswith('IbLoginId='):
                new_lines.append(f'IbLoginId={user}' if user else line)
            elif line.startswith('IbPassword='):
                new_lines.append(f'IbPassword={passwd}' if passwd else line)
            elif line.startswith('TradingMode='):
                new_lines.append(f'TradingMode={target_mode}')
            elif line.startswith('OverrideTwsApiPort='):
                new_lines.append(f'OverrideTwsApiPort={target_port}')
            else:
                new_lines.append(line)
        tmp_ini = ibc_ini + '.tmp'
        with open(tmp_ini, 'w') as f:
            f.write('\n'.join(new_lines) + '\n')
        os.replace(tmp_ini, ibc_ini)
        os.chmod(ibc_ini, 0o600)
        print(f'[IBGATEWAY-DAEMON] IBC config updated: mode={target_mode}, port={target_port}, user={user}')
    except Exception as e:
        print(f'[IBGATEWAY-DAEMON] Warning updating IBC config: {e}')
"
  if grep -qi '^TRADING_MODE=["'"'"']*LIVE' /opt/alpha-engine/.env; then
    TARGET_MODE="live"
  fi
fi

echo "[IBGATEWAY-DAEMON] Launching official IB Gateway via IBC standard (mode: ${TARGET_MODE})..."
export DISPLAY=:1
exec /opt/ibc/scripts/ibcstart.sh 1050 --gateway \
  --tws-path=/root/Jts \
  --tws-settings-path=/root/Jts \
  --ibc-path=/opt/ibc \
  --ibc-ini=/opt/ibc/config.ini \
  --java-path=/opt/ibgateway/jre/bin \
  --mode="${TARGET_MODE}"
