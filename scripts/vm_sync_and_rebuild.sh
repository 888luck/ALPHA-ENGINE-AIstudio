#!/bin/bash
# ==============================================================================
#          ALPHA ENGINE - REMOTE EDGE VM SYNC & REBUILD PIPELINE
# ==============================================================================
# Executed on the Frankfurt Edge Node VM (/opt/alpha-engine) to synchronize
# commits, preserve active risk/basket state, compile the UI, and restart services.
# ==============================================================================

set -e

REPO_DIR="/opt/alpha-engine"
cd "$REPO_DIR"

echo "[VM 1/5] Preserving active live runtime state files..."
git config core.fileMode false || sudo git config core.fileMode false

for f in dynamic_baskets.json risk_limits.json backend/app/api/copilot_quota_state.json; do
  if [ -f "$f" ]; then
    cp "$f" "/tmp/$(basename "$f").live"
    git checkout -- "$f" 2>/dev/null || sudo git checkout -- "$f" 2>/dev/null || true
  fi
done

echo "[VM 2/5] Pulling latest release from origin main..."
sudo git fetch origin main
sudo git reset --hard origin/main
sudo chown -R $(id -un):$(id -gn) "$REPO_DIR"

echo "[VM 3/5] Restoring live runtime state files..."
for f in dynamic_baskets.json risk_limits.json backend/app/api/copilot_quota_state.json; do
  if [ -f "/tmp/$(basename "$f").live" ]; then
    cp "/tmp/$(basename "$f").live" "$f"
    rm -f "/tmp/$(basename "$f").live"
  fi
done

echo "[VM 4/5] Compiling frontend & Express server bundle..."
npm run build

echo "[VM 5/5] Restarting Alpha Engine services..."
sudo systemctl restart alpha-ui.service alpha-engine.service
sudo systemctl is-active alpha-ui alpha-engine ibgateway nginx

echo "[VM] Remote sync and rebuild completed successfully."
