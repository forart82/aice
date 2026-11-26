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
      KEEP_TELEMETRY=1
      shift
      ;;
    --keep-telemetry)
      KEEP_TELEMETRY=1
      shift
      ;;
    --purge-telemetry)
      KEEP_TELEMETRY=0
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

SCRIPT_SOURCE="${BASH_SOURCE[0]:-}"
if [[ -n "$SCRIPT_SOURCE" ]] && [[ -e "$SCRIPT_SOURCE" ]]; then
  SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_SOURCE")" && pwd)"
else
  SCRIPT_DIR="/nonexistent-aice-script-dir"
fi

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

# Pure POSIX mawk-compatible fence-aware markdown directive stripper.
# Returns 0 if file was modified/deleted, 1 if unchanged.
strip_aice_markdown_file() {
  local mdfile="$1"
  local clean_empty_dirs="${2:-0}"
  [[ -f "$mdfile" ]] || return 1

  local tmp_file
  tmp_file="$(mktemp "${mdfile}.tmp.XXXXXX")"

  local changed=0
  if awk '
    function ltrim(s) { sub(/^[ \t]+/, "", s); return s }
    function rtrim(s) { sub(/[ \t\r]+$/, "", s); return s }
    function trim(s)  { return rtrim(ltrim(s)) }
    function count_lead(s, ch,    n) {
      n = 0
      while (substr(s, n + 1, 1) == ch) n++
      return n
    }
    function parse_fence(raw,    indent, trimmed, ch, cnt, rest) {
      trimmed = raw
      sub(/^[ \t]+/, "", trimmed)
      indent = length(raw) - length(trimmed)
      if (indent > 3) return 0
      ch = substr(trimmed, 1, 1)
      if (ch != "`" && ch != "~") return 0
      cnt = count_lead(trimmed, ch)
      if (cnt < 3) return 0
      rest = substr(trimmed, cnt + 1)
      f_ch = ch; f_cnt = cnt; f_rest = rest
      return 1
    }
    function is_aice_start(s,    t, low) {
      t = trim(s)
      if (t ~ /^<!--[ \t]*AICE:START([ \t]+v[0-9A-Za-z._-]+)?[ \t]*-->$/) return 1
      low = tolower(t)
      if (low ~ /^##[ \t]+aice/ && (index(low, "- mandatory") > 0 || index(low, "cheat-card") > 0)) return 1
      return 0
    }
    function is_aice_end(s,    t) {
      t = trim(s)
      return (t ~ /^<!--[ \t]*AICE:END[ \t]*-->$/) ? 1 : 0
    }
    function is_non_aice_heading(s,    t, low) {
      t = ltrim(s)
      if (!(t ~ /^(#|##)[ \t]+/)) return 0
      low = tolower(t)
      if (low ~ /^##[ \t]+aice($|[ \t(:-])/) return 0
      return 1
    }
    BEGIN {
      fence_ch = ""; fence_len = 0; active = 0; had_dir = 0; n_out = 0; prev_blank = 1
    }
    {
      raw = $0
      sub(/\r$/, "", raw)
      if (parse_fence(raw)) {
        if (fence_ch == "") {
          if (f_ch == "~" || index(f_rest, "`") == 0) {
            fence_ch = f_ch; fence_len = f_cnt
          }
        } else if (f_ch == fence_ch && f_cnt >= fence_len && f_rest ~ /^[ \t]*$/) {
          fence_ch = ""; fence_len = 0
        }
        if (!active) { out[++n_out] = raw; prev_blank = 0 }
        next
      }
      if (fence_ch == "") {
        if (!active) {
          if (is_aice_start(raw)) { active = 1; had_dir = 1; next }
        } else {
          if (is_aice_end(raw)) { active = 0; next }
          if (is_non_aice_heading(raw)) {
            active = 0
            if (n_out > 0 && out[n_out] != "") out[++n_out] = ""
            out[++n_out] = raw
            prev_blank = 0
            next
          }
          next
        }
      }
      if (raw ~ /^[ \t]*$/) {
        if (n_out > 0 && !prev_blank) { out[++n_out] = ""; prev_blank = 1 }
      } else {
        out[++n_out] = raw; prev_blank = 0
      }
    }
    END {
      while (n_out > 0 && out[n_out] == "") n_out--
      if (!had_dir && n_out > 0) exit 2
      for (i = 1; i <= n_out; i++) print out[i]
    }
  ' "$mdfile" > "$tmp_file"; then
    changed=1
  else
    rc=$?
    rm -f "$tmp_file"
    if [[ "$rc" -eq 2 ]]; then
      return 1
    fi
    return "$rc"
  fi

  if [[ "$changed" -eq 1 ]]; then
    if [[ ! -s "$tmp_file" ]] || [[ -z "$(tr -d '[:space:]' < "$tmp_file")" ]]; then
      rm -f "$tmp_file" "$mdfile"
      if [[ "$clean_empty_dirs" -eq 1 ]]; then
        local rdir rbase
        rdir="$(dirname "$mdfile")"
        rbase="$(basename "$rdir")"
        case "$rbase" in
          .claude|.codex|.agents|.gemini|rules)
            rmdir "$rdir" 2>/dev/null || true
            ;;
        esac
      fi
    else
      mv "$tmp_file" "$mdfile"
    fi
    return 0
  fi
  rm -f "$tmp_file"
  return 1
}

strip_zshrc_cheatsheet() {
  local rc_file="$1"
  local tmp_file
  tmp_file="$(mktemp "${rc_file}.tmp.XXXXXX")"
  awk '
    BEGIN { in_blk = 0; blank_pending = 0 }
    /^# >>> aice-cheatsheet >>>[[:space:]]*$/ { in_blk = 1; next }
    in_blk && /^# <<< aice-cheatsheet <<<[[:space:]]*$/ { in_blk = 0; blank_pending = 1; next }
    in_blk { next }
    blank_pending && /^[[:space:]]*$/ { blank_pending = 0; next }
    { blank_pending = 0; print }
  ' "$rc_file" > "$tmp_file"
  mv "$tmp_file" "$rc_file"
}

is_in_aice_repo() {
  local d="$1"
  if [[ -d "$d" ]]; then
    d="$(cd -- "$d" 2>/dev/null && pwd -P)" || return 1
  fi
  while [[ -n "$d" && "$d" != "/" && "$d" != "." ]]; do
    if [[ -f "${d}/Cargo.toml" && -f "${d}/crates/aice-cli/src/main.rs" ]]; then
      return 0
    fi
    d="$(dirname -- "$d")"
  done
  return 1
}

log_info "Starting AICE uninstallation (dry_run=${DRY_RUN}, auto_yes=${AUTO_YES})..."

# ── Step 1: Unwire CLI Coding Agents (aice agents remove) ─────────────────────
if [[ "$KEEP_AGENTS" -eq 0 ]]; then
  AICE_RUNNER=""
  if [[ -x "${HOME}/.local/bin/aice" ]]; then
    AICE_RUNNER="${HOME}/.local/bin/aice"
  elif command -v aice >/dev/null 2>&1; then
    AICE_RUNNER="$(command -v aice)"
  elif [[ -x "${SCRIPT_DIR}/target/release/aice" ]]; then
    AICE_RUNNER="${SCRIPT_DIR}/target/release/aice"
  fi

  if [[ -n "$AICE_RUNNER" ]]; then
    log_info "Removing AICE MCP & system prompt configurations from CLI coding agents..."
    if [[ "$DRY_RUN" -eq 1 ]]; then
      printf '  [dry-run] %s agents remove\n' "$AICE_RUNNER"
    else
      "$AICE_RUNNER" agents remove || log_warn "aice agents remove returned non-zero status"
      log_ok "Removed AICE CLI coding agent integrations"
    fi
  else
    log_info "No aice runner found for 'aice agents remove'; skipping agent unwiring."
  fi

  GLOBAL_MD_TARGETS=(
    "${HOME}/.claude/CLAUDE.md"
    "${HOME}/.gemini/GEMINI.md"
    "${HOME}/.gemini/config/GEMINI.md"
    "${HOME}/.gemini/antigravity-cli/GEMINI.md"
    "${HOME}/.codex/AGENTS.md"
    "${HOME}/.codex/CODEX.md"
    "${HOME}/.codex/instructions.md"
    "${HOME}/.config/opencode/AGENTS.md"
    "${HOME}/.aider/CONVENTIONS.md"
  )
  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf '  [dry-run] strip global agent AICE directives and orphan markdown files\n'
  else
    for gmd in "${GLOBAL_MD_TARGETS[@]}"; do
      strip_aice_markdown_file "$gmd" 0 || true
    done
  fi

  if [[ -f "${HOME}/.gemini/config/rules/aice.md" ]]; then
    run_cmd rm -f "${HOME}/.gemini/config/rules/aice.md"
    log_ok "Removed global Antigravity rule: ${HOME}/.gemini/config/rules/aice.md"
  fi
  if [[ -f "${HOME}/.gemini/rules/aice.md" ]]; then
    run_cmd rm -f "${HOME}/.gemini/rules/aice.md"
    log_ok "Removed global Gemini rule: ${HOME}/.gemini/rules/aice.md"
  fi
  if [[ -d "${HOME}/.gemini/antigravity-cli/mcp/aice" ]]; then
    run_cmd rm -rf "${HOME}/.gemini/antigravity-cli/mcp/aice"
    log_ok "Removed stale Antigravity MCP directory: ${HOME}/.gemini/antigravity-cli/mcp/aice"
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
    else
      strip_zshrc_cheatsheet "$ZSHRC_FILE"
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
          -path "$SCRIPT_DIR" -o \
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
          -path "${HOME}/.claude" -o \
          -path "${HOME}/.gemini" -o \
          -path "${HOME}/.codex" -o \
          -path "${HOME}/.config" -o \
          -name ".mozilla" -o \
          -name ".steam" -o \
          -name "Trash" \
        \) -prune -o \
        -type f \( -name "aice.config.json" -o -name ".aicerc" -o -name ".aicerc.json" -o -name ".aice-idioms.json" \) \
        -print 2>/dev/null || true
    )

    if [[ ${#CONFIG_FILES[@]} -gt 0 ]]; then
      REMOVED_CFGS=0
      for cfg in "${CONFIG_FILES[@]}"; do
        [[ -z "$cfg" ]] && continue
        if is_in_aice_repo "$(dirname -- "$cfg")"; then
          continue
        fi
        run_cmd rm -f "$cfg"
        log_ok "Removed project config: ${cfg}"
        REMOVED_CFGS=$((REMOVED_CFGS + 1))
      done
      log_ok "Removed ${REMOVED_CFGS} project configuration file(s) under ${PROJECTS_DIR}"
    else
      log_info "No aice.config.json files found under ${PROJECTS_DIR}."
    fi

    # Also clean any .aice-cache directories in projects
    mapfile -t CACHE_DIRS < <(
      find "$PROJECTS_DIR" \
        \( \
          -path "$SCRIPT_DIR" -o \
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
        if is_in_aice_repo "$(dirname -- "$cdir")"; then
          continue
        fi
        run_cmd rm -rf "$cdir"
        log_ok "Removed project cache: ${cdir}"
      done
    fi

    # Also remove project-level .agents/rules/aice.md, .gemini/rules/aice.md, and .claude/rules/aice.md files
    mapfile -t PROJECT_RULE_FILES < <(
      find "$PROJECTS_DIR" \
        \( \
          -path "$SCRIPT_DIR" -o \
          -path "${HOME}/.claude" -o \
          -path "${HOME}/.gemini" -o \
          -path "${HOME}/.codex" -o \
          -path "${HOME}/.config" -o \
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
        -type f \( -path "*/.agents/rules/aice.md" -o -path "*/.gemini/rules/aice.md" -o -path "*/.claude/rules/aice.md" \) \
        -print 2>/dev/null || true
    )
    if [[ ${#PROJECT_RULE_FILES[@]} -gt 0 ]]; then
      for rfile in "${PROJECT_RULE_FILES[@]}"; do
        [[ -z "$rfile" ]] && continue
        if is_in_aice_repo "$(dirname -- "$rfile")"; then
          continue
        fi
        run_cmd rm -f "$rfile"
        if [[ "$DRY_RUN" -eq 0 ]]; then
          rdir="$(dirname "$rfile")"
          rmdir "$rdir" 2>/dev/null || true
          rmdir "$(dirname "$rdir")" 2>/dev/null || true
        fi
        log_ok "Removed project rule file: ${rfile}"
      done
    fi

    # Strip <!-- AICE:START --> ... <!-- AICE:END --> from project AGENTS.md, CLAUDE.md, GEMINI.md, CODEX.md, etc.
    mapfile -t PROJECT_MD_FILES < <(
      find "$PROJECTS_DIR" \
        \( \
          -path "$SCRIPT_DIR" -o \
          -path "${HOME}/.claude" -o \
          -path "${HOME}/.gemini" -o \
          -path "${HOME}/.codex" -o \
          -path "${HOME}/.config" -o \
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
        -type f \( \
          -name "AGENTS.md" -o \
          -name "CLAUDE.md" -o \
          -name "GEMINI.md" -o \
          -name ".GEMINI.md" -o \
          -name "CODEX.md" -o \
          -name ".CODEX.md" -o \
          -path "*/.codex/instructions.md" \
        \) \
        -print 2>/dev/null || true
    )
    if [[ ${#PROJECT_MD_FILES[@]} -gt 0 ]]; then
      for mdfile in "${PROJECT_MD_FILES[@]}"; do
        [[ -z "$mdfile" ]] && continue
        if is_in_aice_repo "$(dirname -- "$mdfile")"; then
          continue
        fi
        if grep -Eq "<!--[[:space:]]*AICE:START|##[[:space:]]+AICE" "$mdfile" 2>/dev/null; then
          if [[ "$DRY_RUN" -eq 1 ]]; then
            printf '  [dry-run] strip AICE directive / clean orphan markdown from %s\n' "$mdfile"
          elif strip_aice_markdown_file "$mdfile" 1; then
            log_ok "Cleaned AICE directive from project file: ${mdfile}"
          fi
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
