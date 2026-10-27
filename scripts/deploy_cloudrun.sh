#!/bin/bash
# Bash wrapper for Alpha Engine Cloud Run Standby Deployer
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
node "$DIR/deploy_cloudrun.js" "$@"
