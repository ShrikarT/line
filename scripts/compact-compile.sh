#!/usr/bin/env bash
# Compile contracts/line.compact with the pinned Compact toolchain.
# --skip-zk skips proving-key generation (not committed). ZKIR is still emitted.
set -euo pipefail
if ! command -v compact >/dev/null 2>&1; then
  echo "compact not on PATH. Run: bash scripts/install-compact.sh" >&2
  exit 1
fi
compact compile --skip-zk contracts/line.compact contracts/managed/line
