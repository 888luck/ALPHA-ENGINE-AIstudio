#!/bin/bash
set -e

echo "[IBGATEWAY-DAEMON] Starting virtual framebuffer on :1..."
pkill -f "Xvfb :1" || true
pkill -f "x11vnc.*:1" || true
pkill -f "websockify.*6080" || true

Xvfb :1 -screen 0 1280x800x24 &
sleep 2

echo "[IBGATEWAY-DAEMON] Starting x11vnc on :1..."
x11vnc -display :1 -nopw -listen 127.0.0.1 -forever -shared -bg

echo "[IBGATEWAY-DAEMON] Starting noVNC websockify bridge on port 6080..."
websockify -D --web /usr/share/novnc 6080 127.0.0.1:5900

echo "[IBGATEWAY-DAEMON] Verifying jts.ini..."
mkdir -p /root/Jts /home/mstouff/Jts
if [ ! -f /root/Jts/jts.ini ]; then
  cp /opt/ibgateway/jts.ini /root/Jts/jts.ini
fi
cp /root/Jts/jts.ini /home/mstouff/Jts/jts.ini
chown -R mstouff:mstouff /home/mstouff/Jts

echo "[IBGATEWAY-DAEMON] Spawning native headless autologin watcher..."
(
  sleep 4
  MODE="PAPER"
  if grep -qi "tradingMode=l" /root/Jts/jts.ini; then
    MODE="LIVE"
  fi
  python3 /opt/alpha-engine/gateway_autologin.py --mode="$MODE" >> /var/log/gateway_autologin.log 2>&1
) &

echo "[IBGATEWAY-DAEMON] Launching official IB Gateway standalone..."
export DISPLAY=:1
exec /opt/ibgateway/ibgateway
