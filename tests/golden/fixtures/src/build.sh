#!/usr/bin/env bash
set -euo pipefail

run_check() {
  local mode="${1:-fast}"
  case "$mode" in
    fast) echo "running fast" ;;
    full) echo "running full" ;;
    *) echo "unknown" >&2; return 1 ;;
  esac
}

run_check "fast"
