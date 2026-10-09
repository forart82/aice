#!/usr/bin/env bash
# Link Claude Code's per-project memory dir to the repo-tracked copy.
#
# Claude Code stores durable memory at:
#   ~/.claude/projects/<key>/memory
# where <key> is the absolute repo path with every "/" replaced by "-".
# That location is OUTSIDE the repo, so a plain `git clone` on another PC
# does not bring the memory along.
#
# This repo keeps the authoritative memory under .claude/memory/ (tracked in
# git). Run this script once after cloning on a new machine: it points the
# per-project memory location at the repo copy via a symlink, so the history
# and MEMORY.md travel with the clone and future writes land back in git.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_MEMORY="$REPO_ROOT/.claude/memory"

# Derive the project key from the absolute repo path: "/" -> "-".
KEY="$(printf '%s' "$REPO_ROOT" | sed 's#/#-#g')"
PROJECT_DIR="$HOME/.claude/projects/$KEY"
LIVE_MEMORY="$PROJECT_DIR/memory"

if [ ! -d "$REPO_MEMORY" ]; then
  echo "error: $REPO_MEMORY not found (is the repo memory tracked?)" >&2
  exit 1
fi

mkdir -p "$PROJECT_DIR"

# If a real (non-symlink) memory dir already exists, fold its files into the
# repo copy before replacing it, so nothing is lost.
if [ -d "$LIVE_MEMORY" ] && [ ! -L "$LIVE_MEMORY" ]; then
  echo "merging existing live memory into repo copy..."
  cp -an "$LIVE_MEMORY/." "$REPO_MEMORY/" 2>/dev/null || true
  rm -rf "$LIVE_MEMORY"
fi

ln -sfn "$REPO_MEMORY" "$LIVE_MEMORY"
echo "linked: $LIVE_MEMORY -> $REPO_MEMORY"
echo "done. Claude Code memory for this project now lives in the repo."
