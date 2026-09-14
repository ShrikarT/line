#!/usr/bin/env bash
# Install Compact developer tools and pin toolchain 0.34.0 (language 0.26).
set -euo pipefail
VERSION="${COMPACT_VERSION:-0.34.0}"
if ! command -v compact >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -LsSf \
    https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh
  export PATH="${HOME}/.local/bin:${HOME}/.compact/bin:${PATH}"
fi
compact update "${VERSION}"
echo "Compact toolchain $(compact compile --version 2>/dev/null || compact --version)"
echo "language $(compact compile --language-version)"
echo "runtime $(compact compile --runtime-version)"
echo "ledger $(compact compile --ledger-version)"
