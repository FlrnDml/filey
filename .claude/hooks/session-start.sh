#!/bin/bash
# Installs Node dependencies so linters and tests work in cloud sessions.
set -euo pipefail

# Only run in remote (cloud) sessions
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}"

# Cloud sessions are headless: skip the Electron binary download (not needed for lint/unit tests).
export ELECTRON_SKIP_BINARY_DOWNLOAD=1

if [ -f package-lock.json ]; then
  npm ci
elif [ -f package.json ]; then
  npm install
fi
exit 0
