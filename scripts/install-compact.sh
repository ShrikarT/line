#!/usr/bin/env bash
# Install the project-pinned Compact toolchain without changing the user's default.
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
VERSION="$(node -p "JSON.parse(require('node:fs').readFileSync(process.argv[1], 'utf8')).compact.compiler" "${SCRIPT_DIR}/../package.json")"
if ! command -v compact >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -LsSf \
    https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh
  export PATH="${HOME}/.local/bin:${HOME}/.compact/bin:${PATH}"
fi
compact update --no-set-default "${VERSION}"
echo "Compact toolchain $(compact compile +"${VERSION}" --version)"
echo "language $(compact compile +"${VERSION}" --language-version)"
echo "runtime $(compact compile +"${VERSION}" --runtime-version)"
echo "ledger $(compact compile +"${VERSION}" --ledger-version)"
