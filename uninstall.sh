#!/usr/bin/env bash
# ==============================================================================
# AICE Universal Linux Uninstaller (uninstall.sh)
# Cleanly removes AICE global binary, CLI agent MCP/prompt wiring, Zsh startup
# cheatsheet, telemetry state (~/.aice), and all project aice.config.json files.
# ==============================================================================
set -euo pipefail

AUTO_YES=0
KEEP_PROJECT_CONFIGS=0
KEEP_TELEMETRY=0
KEEP_AGENTS=0
DRY_RUN=0
PROJECTS_DIR="${AICE_PROJECTS_DIR:-${HOME}}"

print_help() {
  cat <<'EOF'
Usage: ./uninstall.sh [options]

Options:
  -y, --yes                    Auto-confirm all removal steps
      --projects-dir <dir>     Root directory to scan and remove project aice.config.json files (default: $HOME)
      --keep-project-configs   Do not delete aice.config.json files across projects
      --keep-telemetry         Keep ~/.aice telemetry data (gains.jsonl)
      --keep-agents            Skip removing AICE MCP & system prompt entries from CLI agents
      --dry-run                Print actions that would be performed without mutating disk
  -h, --help                   Display this help message
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -y|--yes)
      AUTO_YES=1
      shift
      ;;
    --projects-dir)
      if [[ $# -lt 2 ]]; then
        printf 'Error: --projects-dir requires a directory argument\n' >&2
        exit 1
      fi
      PROJECTS_DIR="$2"
      shift 2
      ;;
    --projects-dir=*)
      PROJECTS_DIR="${1#*=}"
      shift
      ;;
    --keep-project-configs)
      KEEP_PROJECT_CONFIGS=1
      shift
      ;;
    --keep-telemetry)
      KEEP_TELEMETRY=1
      shift
      ;;
    --keep-agents)
      KEEP_AGENTS=1
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h|--help)
      print_help
      exit 0
      ;;
    *)
      printf 'Error: Unknown option "%s"\n' "$1" >&2
      print_help >&2
      exit 1
      ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log_info()  { printf '\033[1;36m[AICE]\033[0m %s\n' "$*"; }
log_ok()    { printf '\033[1;32m[✔]\033[0m %s\n' "$*"; }
log_warn()  { printf '\033[1;33m[!]\033[0m %s\n' "$*"; }
log_err()   { printf '\033[1;31m[✘]\033[0m %s\n' "$*" >&2; }

run_cmd() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf '  [dry-run] %s\n' "$*"
    return 0
  fi
  "$@"
}

log_info "Starting AICE uninstallation (dry_run=${DRY_RUN}, auto_yes=${AUTO_YES})..."

# ── Step 1: Unwire CLI Coding Agents (aice agents remove) ─────────────────────
if [[ "$KEEP_AGENTS" -eq 0 ]]; then
  AICE_RUNNER=""
  if [[ -x "${HOME}/.local/bin/aice" ]]; then
    AICE_RUNNER="${HOME}/.local/bin/aice"
  elif command -v aice >/dev/null 2>&1; then
    AICE_RUNNER="$(command -v aice)"
  elif [[ -f "${SCRIPT_DIR}/bin/aice.mjs" ]] && command -v node >/dev/null 2>&1; then
    AICE_RUNNER="${SCRIPT_DIR}/bin/aice.mjs"
  fi

  if [[ -n "$AICE_RUNNER" ]]; then
    log_info "Removing AICE MCP & system prompt configurations from CLI coding agents..."
    if [[ "$DRY_RUN" -eq 1 ]]; then
      printf '  [dry-run] %s agents remove\n' "$AICE_RUNNER"
    else
      if [[ "$AICE_RUNNER" == *.mjs ]]; then
        node "$AICE_RUNNER" agents remove || log_warn "aice agents remove returned non-zero status"
      else
        "$AICE_RUNNER" agents remove || log_warn "aice agents remove returned non-zero status"
      fi
      log_ok "Removed AICE CLI coding agent integrations"
    fi
  else
    log_info "No aice runner found for 'aice agents remove'; skipping agent unwiring."
  fi
  if [[ -f "${HOME}/.gemini/config/rules/aice.md" ]]; then
    run_cmd rm -f "${HOME}/.gemini/config/rules/aice.md"
    log_ok "Removed global Antigravity rule: ${HOME}/.gemini/config/rules/aice.md"
  fi
else
  log_info "Skipping CLI coding agent unwiring (--keep-agents)."
fi

# ── Step 2: Remove Zsh Startup Cheatsheet (~/.zshrc) ──────────────────────────
ZSHRC_FILE="${HOME}/.zshrc"
if [[ -f "$ZSHRC_FILE" ]]; then
  if grep -Fq "# >>> aice-cheatsheet >>>" "$ZSHRC_FILE" 2>/dev/null || grep -Fq "aice_cheatsheet" "$ZSHRC_FILE" 2>/dev/null || grep -Fq "ail_cheatsheet" "$ZSHRC_FILE" 2>/dev/null; then
    log_info "Removing AICE Zsh startup cheatsheet from ${ZSHRC_FILE}..."
    if [[ "$DRY_RUN" -eq 1 ]]; then
      printf '  [dry-run] strip # >>> aice-cheatsheet >>> block from %s\n' "$ZSHRC_FILE"
    elif command -v node >/dev/null 2>&1; then
      node -e '
        const fs = require("fs");
        const file = process.argv[1];
        let content = fs.readFileSync(file, "utf8");
        content = content.replace(/\n?# >>> aice-cheatsheet >>>[\s\S]*?# <<< aice-cheatsheet <<<\n?/g, "\n");
        fs.writeFileSync(file, content, "utf8");
      ' "$ZSHRC_FILE"
      log_ok "Removed aice_cheatsheet block from ${ZSHRC_FILE}"
    else
      sed -i '/# >>> aice-cheatsheet >>>/,/# <<< aice-cheatsheet <<</d' "$ZSHRC_FILE"
      log_ok "Removed aice_cheatsheet block from ${ZSHRC_FILE}"
    fi
  else
    log_info "No AICE cheatsheet block found in ${ZSHRC_FILE}."
  fi
fi

# ── Step 3: Remove All aice.config.json Files Across Projects ─────────────────
if [[ "$KEEP_PROJECT_CONFIGS" -eq 0 ]]; then
  if [[ -d "$PROJECTS_DIR" ]]; then
    log_info "Scanning for project aice.config.json (and .aicerc / .aice-idioms.json) files under ${PROJECTS_DIR}..."
    mapfile -t CONFIG_FILES < <(
      find "$PROJECTS_DIR" \
        \( \
          -name "node_modules" -o \
          -name ".git" -o \
          -name ".cache" -o \
          -name ".local" -o \
          -name ".npm" -o \
          -name ".pnpm-store" -o \
          -name ".cargo" -o \
          -name ".rustup" -o \
          -name ".nvm" -o \
          -name ".bun" -o \
          -name ".venv" -o \
          -name "venv" -o \
          -name ".vscode" -o \
          -name ".cursor" -o \
          -name ".claude" -o \
          -name ".gemini" -o \
          -name ".codex" -o \
          -name ".mozilla" -o \
          -name ".steam" -o \
          -name "Trash" \
        \) -prune -o \
        -type f \( -name "aice.config.json" -o -name ".aicerc" -o -name ".aicerc.json" -o -name ".aice-idioms.json" \) \
        -print 2>/dev/null || true
    )

    if [[ ${#CONFIG_FILES[@]} -gt 0 ]]; then
      for cfg in "${CONFIG_FILES[@]}"; do
        [[ -z "$cfg" ]] && continue
        run_cmd rm -f "$cfg"
        log_ok "Removed project config: ${cfg}"
      done
      log_ok "Removed ${#CONFIG_FILES[@]} project configuration file(s) under ${PROJECTS_DIR}"
    else
      log_info "No aice.config.json files found under ${PROJECTS_DIR}."
    fi

    # Also clean any .aice-cache directories in projects
    mapfile -t CACHE_DIRS < <(
      find "$PROJECTS_DIR" \
        \( \
          -name "node_modules" -o \
          -name ".git" -o \
          -name ".cache" -o \
          -name ".local" -o \
          -name ".npm" -o \
          -name ".cargo" -o \
          -name ".rustup" -o \
          -name ".nvm" -o \
          -name ".bun" -o \
          -name ".venv" -o \
          -name "venv" \
        \) -prune -o \
        -type d -name ".aice-cache" \
        -print 2>/dev/null || true
    )
    if [[ ${#CACHE_DIRS[@]} -gt 0 ]]; then
      for cdir in "${CACHE_DIRS[@]}"; do
        [[ -z "$cdir" ]] && continue
        run_cmd rm -rf "$cdir"
        log_ok "Removed project idiom cache: ${cdir}"
      done
    fi

    # Also remove project-level .agents/rules/aice.md files (and empty .agents/rules & .agents dirs)
    mapfile -t PROJECT_RULE_FILES < <(
      find "$PROJECTS_DIR" \
        \( \
          -name "node_modules" -o \
          -name ".git" -o \
          -name ".cache" -o \
          -name ".local" -o \
          -name ".npm" -o \
          -name ".cargo" -o \
          -name ".rustup" -o \
          -name ".nvm" -o \
          -name ".bun" -o \
          -name ".venv" -o \
          -name "venv" \
        \) -prune -o \
        -type f -path "*/.agents/rules/aice.md" \
        -print 2>/dev/null || true
    )
    if [[ ${#PROJECT_RULE_FILES[@]} -gt 0 ]]; then
      for rfile in "${PROJECT_RULE_FILES[@]}"; do
        [[ -z "$rfile" ]] && continue
        run_cmd rm -f "$rfile"
        if [[ "$DRY_RUN" -eq 0 ]]; then
          rdir="$(dirname "$rfile")"
          rmdir "$rdir" 2>/dev/null || true
          rmdir "$(dirname "$rdir")" 2>/dev/null || true
        fi
        log_ok "Removed project rule file: ${rfile}"
      done
    fi

    # Strip <!-- AICE:START --> ... <!-- AICE:END --> from project AGENTS.md, CLAUDE.md, and GEMINI.md
    mapfile -t PROJECT_MD_FILES < <(
      find "$PROJECTS_DIR" \
        \( \
          -name "node_modules" -o \
          -name ".git" -o \
          -name ".cache" -o \
          -name ".local" -o \
          -name ".npm" -o \
          -name ".cargo" -o \
          -name ".rustup" -o \
          -name ".nvm" -o \
          -name ".bun" -o \
          -name ".venv" -o \
          -name "venv" -o \
          -name ".claude" -o \
          -name ".gemini" -o \
          -name ".codex" \
        \) -prune -o \
        -type f \( -name "AGENTS.md" -o -name "CLAUDE.md" -o -name "GEMINI.md" \) \
        -print 2>/dev/null || true
    )
    if [[ ${#PROJECT_MD_FILES[@]} -gt 0 ]]; then
      for mdfile in "${PROJECT_MD_FILES[@]}"; do
        [[ -z "$mdfile" ]] && continue
        if grep -Fq "<!-- AICE:START -->" "$mdfile" 2>/dev/null; then
          if [[ "$DRY_RUN" -eq 1 ]]; then
            printf '  [dry-run] strip <!-- AICE:START --> block from %s\n' "$mdfile"
          elif command -v node >/dev/null 2>&1; then
            node -e '
              const fs = require("fs");
              const path = require("path");
              const file = process.argv[1];
              let content = fs.readFileSync(file, "utf8");
              const startIdx = content.indexOf("<!-- AICE:START -->");
              const endIdx = content.indexOf("<!-- AICE:END -->");
              if (startIdx !== -1 && endIdx !== -1) {
                const before = content.slice(0, startIdx).trimEnd();
                const after = content.slice(endIdx + "<!-- AICE:END -->".length).trimStart();
                const next = [before, after].filter(Boolean).join("\n\n");
                if (!next.trim() && path.basename(file) === "AGENTS.md") {
                  fs.unlinkSync(file);
                } else {
                  fs.writeFileSync(file, next ? next + "\n" : "", "utf8");
                }
              }
            ' "$mdfile"
          else
            sed -i '/<!-- AICE:START -->/,/<!-- AICE:END -->/d' "$mdfile"
            if [[ "$(basename "$mdfile")" == "AGENTS.md" ]] && [[ -z "$(tr -d '[:space:]' < "$mdfile")" ]]; then
              rm -f "$mdfile"
            fi
          fi
          log_ok "Cleaned AICE directive from project file: ${mdfile}"
        fi
      done
    fi
  else
    log_warn "Projects directory ${PROJECTS_DIR} does not exist; skipping project config scan."
  fi
else
  log_info "Skipping project aice.config.json removal (--keep-project-configs)."
fi

# ── Step 4: Remove Global Telemetry & State (~/.aice) ─────────────────────────
AICE_HOME_DIR="${HOME}/.aice"
if [[ "$KEEP_TELEMETRY" -eq 0 ]]; then
  if [[ -d "$AICE_HOME_DIR" ]]; then
    log_info "Removing global AICE state & telemetry directory (${AICE_HOME_DIR})..."
    run_cmd rm -rf "$AICE_HOME_DIR"
    log_ok "Removed ${AICE_HOME_DIR}"
  else
    log_info "No ${AICE_HOME_DIR} directory found."
  fi
else
  log_info "Keeping ${AICE_HOME_DIR} telemetry directory (--keep-telemetry)."
fi

# ── Step 5: Remove Global aice / ail Binaries & Symlinks ──────────────────────
CANDIDATE_BINS=(
  "${HOME}/.local/bin/aice"
  "${HOME}/.local/bin/ail"
  "${HOME}/.cargo/bin/aice"
  "${HOME}/.cargo/bin/ail"
  "${HOME}/.bun/bin/aice"
  "${HOME}/.bun/bin/ail"
  "/usr/local/bin/aice"
  "/usr/local/bin/ail"
)

REMOVED_BINS=0
for bin_path in "${CANDIDATE_BINS[@]}"; do
  if [[ -e "$bin_path" || -L "$bin_path" ]]; then
    if [[ -w "$(dirname "$bin_path")" ]]; then
      run_cmd rm -f "$bin_path"
      log_ok "Removed binary/symlink: ${bin_path}"
      REMOVED_BINS=$((REMOVED_BINS + 1))
    else
      log_warn "Skipping ${bin_path} (directory not writable by current user)"
    fi
  fi
done

if [[ "$REMOVED_BINS" -eq 0 ]]; then
  log_info "No global aice/ail binaries or symlinks found to remove."
fi

log_ok "AICE uninstallation complete!"
