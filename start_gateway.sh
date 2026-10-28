#!/bin/bash
set -e

echo "[IBGATEWAY-DAEMON] Initializing headless display stack on :1..."
pkill -f "Xvfb :1" || true
pkill -f "x11vnc.*:1" || true
pkill -f "websockify.*6080" || true

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

# Sync IBC config credentials and mode dynamically from /etc/alpha-engine/secrets.env or /opt/alpha-engine/.env
echo "[IBGATEWAY-DAEMON] Syncing IBC credentials & lane from 12-factor vault..."
TARGET_MODE=$(python3 -c "
import os, json

env_vars = {}
for env_path in ['/etc/alpha-engine/secrets.env', '/opt/alpha-engine/.env']:
    if os.path.exists(env_path):
        try:
            with open(env_path, 'r') as f:
                for line in f:
                    line = line.strip()
                    if '=' in line and not line.startswith('#'):
                        k, v = line.split('=', 1)
                        k_clean = k.strip()
                        v_clean = v.strip().strip('\"').strip(\"'\")
                        if v_clean:
                            env_vars[k_clean] = v_clean
                            env_vars[k_clean.upper()] = v_clean
                            env_vars[k_clean.lower()] = v_clean
        except Exception as e:
            print(f'[IBGATEWAY-DAEMON] Notice reading {env_path}: {e}', file=sys.stderr)

settings_path = '/opt/alpha-engine/system_settings.json'
if os.path.exists(settings_path):
    try:
        with open(settings_path, 'r') as f:
            d = json.load(f)
            if 'tradingMode' in d and 'TRADING_MODE' not in env_vars:
                env_vars['TRADING_MODE'] = str(d['tradingMode']).upper()
    except Exception:
        pass

def get_val(*keys):
    for k in keys:
        if k in env_vars and env_vars[k]:
            return env_vars[k]
    return None

trading_mode = (get_val('TRADING_MODE', 'tradingMode') or 'PAPER').upper()
is_live = (trading_mode == 'LIVE')

if is_live:
    user = get_val('IBKR_LIVE_USERNAME', 'ibkrLiveUsername', 'IBKR_USERNAME', 'ibkrUsername', 'IBKR_PAPER_USERNAME', 'ibkrPaperUsername') or 'mstouff17'
    passwd = get_val('IBKR_LIVE_PASSWORD', 'ibkrLivePassword', 'IBKR_PASSWORD', 'ibkrPassword', 'IBKR_PAPER_PASSWORD', 'ibkrPaperPassword') or ''
    target_mode = 'live'
    target_port = 4001
else:
    user = get_val('IBKR_PAPER_USERNAME', 'ibkrPaperUsername', 'IBKR_USERNAME', 'ibkrUsername', 'IBKR_LIVE_USERNAME', 'ibkrLiveUsername') or 'mstouff17'
    passwd = get_val('IBKR_PAPER_PASSWORD', 'ibkrPaperPassword', 'IBKR_PASSWORD', 'ibkrPassword', 'IBKR_LIVE_PASSWORD', 'ibkrLivePassword') or ''
    target_mode = 'paper'
    target_port = 4002

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
    except Exception as e:
        pass

print(target_mode)
")

echo "[IBGATEWAY-DAEMON] Launching official IB Gateway via IBC standard (mode: ${TARGET_MODE})..."
export DISPLAY=:1
exec /opt/ibc/scripts/ibcstart.sh 1050 --gateway \
  --tws-path=/root/Jts \
  --tws-settings-path=/root/Jts \
  --ibc-path=/opt/ibc \
  --ibc-ini=/opt/ibc/config.ini \
  --java-path=/opt/ibgateway/jre/bin \
  --mode="${TARGET_MODE}"

