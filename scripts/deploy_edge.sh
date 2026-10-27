#!/bin/bash
# Bash wrapper for Alpha Engine Edge Deployer
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
node "$DIR/deploy_edge.cjs" "$@"
