#!/usr/bin/env bash
# Keep credentials in the environment, never command-line arguments.
set +x
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec node scripts/test-fresh-db.mjs
