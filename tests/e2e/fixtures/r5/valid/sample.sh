#!/usr/bin/env bash
set -euo pipefail

summarize_logs() {
  local target_dir="${1:-.}"
  if [[ -d "$target_dir" ]]; then
    printf 'scanning:%s\n' "$target_dir"
  fi
}

summarize_logs "./logs"
