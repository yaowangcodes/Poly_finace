#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
# Reuse an installed Node when this terminal has not added it to PATH.
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  for node_bin in /opt/homebrew/bin /usr/local/bin /private/tmp/alphaforge-node/node-v24.*-darwin-arm64/bin; do
    if [[ -x "$node_bin/node" && -x "$node_bin/npm" ]]; then
      export PATH="$node_bin:$PATH"
      echo "Using Node.js from $node_bin"
      break
    fi
  done
fi
# Do not enable shell tracing: AWS/Docker authentication must never be logged.
exec python3 infra/web-deploy/deploy.py "$@"
