#!/usr/bin/env bash
# ==============================================================================
# AICE Universal Linux Installer & In-Place Updater (install.sh)
# Pure-Rust native release build, MCP schemas, CLI agents, & workspace sync
# ==============================================================================
set -euo pipefail

AUTO_YES=0
FORCE_UPDATE=0
NO_CHEATSHEET=0
NO_AGENTS=0
NO_UPDATE=0
DRY_RUN=0
SYNC_PROJECTS=0
SYNC_PROJECTS_DIR=""

print_help() {
  cat <<'HELP_EOF'
Usage: ./install.sh [options]

Options:
  -y, --yes                   Auto-confirm dependency installation, git update, and Zsh cheatsheet
  -u, --update                Force in-place update check against origin/main and refresh schemas
      --no-update             Skip checking the remote git repository for newer versions
      --no-cheatsheet         Skip the Zsh startup cheatsheet prompt/injection
      --no-agents             Skip automatic CLI coding agent configuration (aice agents setup)
      --sync-projects [dir]   Explicitly refresh existing aice.config.json projects under dir (opt-in)
      --dry-run               Print actions that would be performed without mutating the system
  -h, --help                  Display this help message
HELP_EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -y|--yes)
      AUTO_YES=1
      shift
      ;;
    -u|--update)
      FORCE_UPDATE=1
      shift
      ;;
    --no-update)
      NO_UPDATE=1
      shift
      ;;
    --no-cheatsheet|--skip-cheatsheet)
      NO_CHEATSHEET=1
      shift
      ;;
    --no-agents|--skip-agents)
      NO_AGENTS=1
      shift
      ;;
    --sync-projects)
      SYNC_PROJECTS=1
      if [[ $# -ge 2 ]] && [[ "$2" != -* ]]; then
        SYNC_PROJECTS_DIR="$2"
        shift 2
      else
        shift
      fi
      ;;
    --sync-projects=*)
      SYNC_PROJECTS=1
      SYNC_PROJECTS_DIR="${1#*=}"
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
STANDALONE_TMP_DIR=""
cleanup_tmp() {
  if [[ -n "${STANDALONE_TMP_DIR:-}" ]] && [[ -d "$STANDALONE_TMP_DIR" ]]; then
    rm -rf "$STANDALONE_TMP_DIR"
  fi
}
trap cleanup_tmp EXIT

if [[ -n "$SCRIPT_SOURCE" ]] && [[ -e "$SCRIPT_SOURCE" ]]; then
  SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_SOURCE")" && pwd)"
else
  STANDALONE_TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/aice-install.XXXXXX")"
  SCRIPT_DIR="$STANDALONE_TMP_DIR"
fi
cd "$SCRIPT_DIR"

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

extract_cargo_version() {
  awk '
    /^\[/ { in_pkg = ($0 ~ /^\[(workspace\.)?package\]/) ? 1 : 0; next }
    in_pkg && /^[[:space:]]*version[[:space:]]*=[[:space:]]*"/ {
      sub(/^[^"]*"/, "")
      sub(/".*$/, "")
      print
      exit
    }
  '
}

# ── Substep 2.1: Detect Linux Distro & Package Manager ────────────────────────
DISTRO_ID="unknown"
DISTRO_NAME="Linux"
if [[ -f /etc/os-release ]]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  DISTRO_ID="${ID:-unknown}"
  DISTRO_NAME="${PRETTY_NAME:-${NAME:-Linux}}"
fi

PKG_MGR="unknown"
if command -v apt-get >/dev/null 2>&1; then
  PKG_MGR="apt-get"
elif command -v dnf >/dev/null 2>&1; then
  PKG_MGR="dnf"
elif command -v yum >/dev/null 2>&1; then
  PKG_MGR="yum"
elif command -v pacman >/dev/null 2>&1; then
  PKG_MGR="pacman"
elif command -v zypper >/dev/null 2>&1; then
  PKG_MGR="zypper"
elif command -v apk >/dev/null 2>&1; then
  PKG_MGR="apk"
fi

log_info "Detected OS: ${DISTRO_NAME} (id=${DISTRO_ID}, pkg=${PKG_MGR})"

SUDO_CMD=()
if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  if command -v sudo >/dev/null 2>&1; then
    SUDO_CMD=(sudo)
  fi
fi

install_sys_packages() {
  local pkgs=("$@")
  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf '  [dry-run] install system packages via %s: %s\n' "$PKG_MGR" "${pkgs[*]}"
    return 0
  fi

  if [[ "${EUID:-$(id -u)}" -ne 0 ]] && [[ ${#SUDO_CMD[@]} -eq 0 ]]; then
    log_err "Root privileges or sudo required to install system packages: ${pkgs[*]}"
    exit 1
  fi

  case "$PKG_MGR" in
    apt-get)
      "${SUDO_CMD[@]}" apt-get update -y
      "${SUDO_CMD[@]}" apt-get install -y "${pkgs[@]}"
      ;;
    dnf)
      "${SUDO_CMD[@]}" dnf install -y "${pkgs[@]}"
      ;;
    yum)
      "${SUDO_CMD[@]}" yum install -y "${pkgs[@]}"
      ;;
    pacman)
      "${SUDO_CMD[@]}" pacman -Sy --noconfirm "${pkgs[@]}"
      ;;
    zypper)
      "${SUDO_CMD[@]}" zypper --non-interactive install "${pkgs[@]}"
      ;;
    apk)
      "${SUDO_CMD[@]}" apk add --no-cache "${pkgs[@]}"
      ;;
    *)
      log_err "Unsupported package manager (${PKG_MGR}). Please install manually: ${pkgs[*]}"
      exit 1
      ;;
  esac
}

CARGO_ENV_FILE="${CARGO_HOME:-${HOME}/.cargo}/env"
if [[ -s "$CARGO_ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  . "$CARGO_ENV_FILE"
fi

LOCAL_REPO=0
if [[ -f "${SCRIPT_DIR}/Cargo.toml" && -f "${SCRIPT_DIR}/crates/aice-cli/src/main.rs" ]]; then
  LOCAL_REPO=1
fi

MISSING_PKGS=()
command -v git >/dev/null 2>&1 || MISSING_PKGS+=(git)
command -v curl >/dev/null 2>&1 || MISSING_PKGS+=(curl)

if [[ "$LOCAL_REPO" -eq 1 ]]; then
  if ! command -v cc >/dev/null 2>&1 && ! command -v gcc >/dev/null 2>&1 && ! command -v clang >/dev/null 2>&1; then
    case "$PKG_MGR" in
      apt-get) MISSING_PKGS+=(build-essential) ;;
      pacman)  MISSING_PKGS+=(base-devel) ;;
      *)       MISSING_PKGS+=(gcc) ;;
    esac
  fi
fi

NEED_RUST=0
if [[ "$LOCAL_REPO" -eq 1 ]]; then
  if ! command -v cargo >/dev/null 2>&1 || ! command -v rustc >/dev/null 2>&1; then
    NEED_RUST=1
  fi
fi

if [[ ${#MISSING_PKGS[@]} -gt 0 ]] || [[ "$NEED_RUST" -eq 1 ]]; then
  log_warn "Missing prerequisites (missing_pkgs=${MISSING_PKGS[*]:-none}, need_rust=${NEED_RUST})."
  if [[ "$AUTO_YES" -eq 0 ]] && [[ "$DRY_RUN" -eq 0 ]] && [[ -t 0 ]]; then
    printf 'Install missing prerequisites now? [Y/n] '
    read -r confirm || confirm="y"
    case "$confirm" in
      [nN]|[nN][oO])
        log_err "Installation aborted by user."
        exit 1
        ;;
    esac
  fi

  if [[ ${#MISSING_PKGS[@]} -gt 0 ]]; then
    install_sys_packages "${MISSING_PKGS[@]}"
  fi

  if [[ "$NEED_RUST" -eq 1 ]]; then
    log_info "Installing Rust toolchain via rustup..."
    if [[ "$DRY_RUN" -eq 1 ]]; then
      printf '  [dry-run] curl --proto =https --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y\n'
    else
      curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
      if [[ -s "$CARGO_ENV_FILE" ]]; then
        # shellcheck disable=SC1090
        . "$CARGO_ENV_FILE"
      fi
    fi
  fi
fi

if [[ "$LOCAL_REPO" -eq 1 ]]; then
  log_ok "Prerequisites verified: git ($(git --version 2>/dev/null | head -n1 || echo ok)), curl, cargo ($(cargo --version 2>/dev/null || echo 'ok')), rustc ($(rustc --version 2>/dev/null || echo 'ok'))"
else
  log_ok "Prerequisites verified: git ($(git --version 2>/dev/null | head -n1 || echo ok)), curl"
fi

# ── Substep 2.2b: Detect Installed / Local / Remote Versions & In-Place Update ─
LOCAL_BIN="${HOME}/.local/bin"
AICE_BIN="${LOCAL_BIN}/aice"
INSTALLED_VER="none"
if [[ -x "$AICE_BIN" ]]; then
  INSTALLED_VER="$("$AICE_BIN" --version 2>/dev/null | head -n1 | tr -d '[:space:]' || echo "none")"
elif command -v aice >/dev/null 2>&1; then
  INSTALLED_VER="$(aice --version 2>/dev/null | head -n1 | tr -d '[:space:]' || echo "none")"
fi

LOCAL_VER="unknown"
if [[ -f "${SCRIPT_DIR}/Cargo.toml" ]]; then
  LOCAL_VER="$(extract_cargo_version < "${SCRIPT_DIR}/Cargo.toml" 2>/dev/null || true)"
  [[ -z "$LOCAL_VER" ]] && LOCAL_VER="unknown"
fi
REMOTE_VER="$LOCAL_VER"

if [[ "$INSTALLED_VER" != "none" ]]; then
  log_info "Detected existing AICE installation: installed=v${INSTALLED_VER}, working-tree=v${LOCAL_VER} (in-place update/refresh mode)"
else
  log_info "Detected fresh AICE installation: working-tree=v${LOCAL_VER}"
fi

if [[ "$NO_UPDATE" -eq 0 ]] && [[ -e "${SCRIPT_DIR}/.git" ]] && command -v git >/dev/null 2>&1; then
  log_info "Checking git repository (origin/main) for newer AICE commits/versions..."
  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf '  [dry-run] git fetch --quiet origin main --tags\n'
  else
    git -C "$SCRIPT_DIR" fetch --quiet origin main --tags 2>/dev/null || true
    BEHIND_COUNT="$(git -C "$SCRIPT_DIR" rev-list HEAD..origin/main --count 2>/dev/null || echo 0)"
    REMOTE_VER="$(git -C "$SCRIPT_DIR" show origin/main:Cargo.toml 2>/dev/null | extract_cargo_version 2>/dev/null || true)"
    [[ -z "$REMOTE_VER" ]] && REMOTE_VER="$LOCAL_VER"
    if [[ "$BEHIND_COUNT" =~ ^[0-9]+$ ]] && { [[ "$BEHIND_COUNT" -gt 0 ]] || [[ "$FORCE_UPDATE" -eq 1 ]]; }; then
      if [[ "$BEHIND_COUNT" -gt 0 ]]; then
        log_warn "Remote git repository (origin/main) is ahead by ${BEHIND_COUNT} commit(s) (installed: v${INSTALLED_VER}, local: v${LOCAL_VER} -> remote: v${REMOTE_VER})."
      else
        log_info "Force update (--update) requested (installed: v${INSTALLED_VER}, local: v${LOCAL_VER}, remote: v${REMOTE_VER})."
      fi
      DO_UPDATE=0
      if [[ "$AUTO_YES" -eq 1 ]] || [[ "$FORCE_UPDATE" -eq 1 ]]; then
        if [[ "$BEHIND_COUNT" -gt 0 ]]; then
          printf 'A newer version of AICE is available in the git repository. Do you want to update to the newest version? [Y/n] y\n'
        fi
        DO_UPDATE=1
      else
        printf 'A newer version of AICE is available in the git repository. Do you want to update to the newest version? [Y/n] '
        READ_TIMEOUT=1
        [[ -t 0 ]] && READ_TIMEOUT=30
        if IFS= read -t "$READ_TIMEOUT" -r ans; then
          case "$ans" in
            ""|[Yy]|[Yy][Ee][Ss]) DO_UPDATE=1 ;;
            *) DO_UPDATE=0 ;;
          esac
        else
          printf '\n'
          log_info "Non-interactive session without --yes; skipping git update."
        fi
      fi

      if [[ "$DO_UPDATE" -eq 1 ]] && [[ "$BEHIND_COUNT" -gt 0 ]]; then
        log_info "Fast-forward pulling origin/main (preserving local state safely)..."
        STASHED=0
        if ! git -C "$SCRIPT_DIR" diff --quiet 2>/dev/null || ! git -C "$SCRIPT_DIR" diff --cached --quiet 2>/dev/null; then
          if git -C "$SCRIPT_DIR" stash push -m "aice-install-auto-stash" >/dev/null 2>&1; then
            STASHED=1
          fi
        fi
        if git -C "$SCRIPT_DIR" pull --ff-only origin main; then
          LOCAL_VER="$(extract_cargo_version < "${SCRIPT_DIR}/Cargo.toml" 2>/dev/null || true)"
          [[ -z "$LOCAL_VER" ]] && LOCAL_VER="$REMOTE_VER"
          log_ok "Updated AICE git repository to newest version (v${LOCAL_VER})."
        else
          log_warn "Could not fast-forward pull from origin/main; continuing with current working tree (v${LOCAL_VER})."
        fi
        if [[ "$STASHED" -eq 1 ]]; then
          git -C "$SCRIPT_DIR" stash pop >/dev/null 2>&1 || true
        fi
      elif [[ "$DO_UPDATE" -eq 1 ]]; then
        log_ok "Git working tree is already at latest commit on origin/main (v${LOCAL_VER})."
      else
        log_info "Skipping git repository update; continuing with local version (v${LOCAL_VER})."
      fi
    else
      log_ok "Git repository is up to date with origin/main (v${LOCAL_VER})."
    fi
  fi
fi

# ── Substep 2.3: Build & Install Native Rust Release Binary ───────────────────
if [[ "$LOCAL_REPO" -eq 1 ]]; then
  log_info "Building native Rust release binary (v${LOCAL_VER})..."
  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf '  [dry-run] cargo build --release --manifest-path %s/Cargo.toml --offline\n' "$SCRIPT_DIR"
  else
    if ! cargo build --release --manifest-path "${SCRIPT_DIR}/Cargo.toml" --offline; then
      cargo build --release --manifest-path "${SCRIPT_DIR}/Cargo.toml"
    fi
  fi

  run_cmd mkdir -p "$LOCAL_BIN"
  run_cmd rm -f "${LOCAL_BIN}/aice"
  run_cmd install -m 755 "${SCRIPT_DIR}/target/release/aice" "${LOCAL_BIN}/aice"
  log_ok "Installed native Rust binary: ${LOCAL_BIN}/aice (v${LOCAL_VER})"
else
  ARCH="$(uname -m)"
  RELEASE_URL="https://github.com/forart82/aice/releases/latest/download/aice-linux-${ARCH}"
  run_cmd mkdir -p "$LOCAL_BIN"
  run_cmd rm -f "${LOCAL_BIN}/aice"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf '  [dry-run] curl -fsSL %s -o %s/aice (fallback: git clone + cargo build --release)\n' "$RELEASE_URL" "$LOCAL_BIN"
  else
    log_info "Downloading standalone AICE binary from ${RELEASE_URL}..."
    if curl -fsSL "$RELEASE_URL" -o "${LOCAL_BIN}/aice" 2>/dev/null; then
      chmod 755 "${LOCAL_BIN}/aice"
    else
      log_warn "Prebuilt release asset unavailable for ${ARCH}; cloning and building from source..."
      [[ -z "$STANDALONE_TMP_DIR" ]] && STANDALONE_TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/aice-install.XXXXXX")"
      if ! command -v cc >/dev/null 2>&1 && ! command -v gcc >/dev/null 2>&1 && ! command -v clang >/dev/null 2>&1; then
        case "$PKG_MGR" in
          apt-get) install_sys_packages build-essential ;;
          pacman)  install_sys_packages base-devel ;;
          *)       install_sys_packages gcc ;;
        esac
      fi
      if ! command -v cargo >/dev/null 2>&1 || ! command -v rustc >/dev/null 2>&1; then
        curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
        [[ -s "$CARGO_ENV_FILE" ]] && . "$CARGO_ENV_FILE"
      fi
      git clone --depth 1 https://github.com/forart82/aice.git "${STANDALONE_TMP_DIR}/aice"
      cargo build --release --manifest-path "${STANDALONE_TMP_DIR}/aice/Cargo.toml"
      install -m 755 "${STANDALONE_TMP_DIR}/aice/target/release/aice" "${LOCAL_BIN}/aice"
    fi
    LOCAL_VER="$("${LOCAL_BIN}/aice" --version 2>/dev/null | head -n1 | tr -d '[:space:]' || true)"
    LOCAL_VER="${LOCAL_VER#v}"
    [[ -z "$LOCAL_VER" ]] && LOCAL_VER="latest"
  fi
  log_ok "Installed standalone binary: ${LOCAL_BIN}/aice (v${LOCAL_VER})"
fi

# Ensure $HOME/.local/bin is in PATH
if [[ ":${PATH}:" != *":${LOCAL_BIN}:"* ]]; then
  export PATH="${LOCAL_BIN}:${PATH}"
  ACTIVE_RC="${HOME}/.profile"
  if [[ "${SHELL:-}" == */zsh ]]; then
    ACTIVE_RC="${HOME}/.zshrc"
  elif [[ "${SHELL:-}" == */bash ]]; then
    ACTIVE_RC="${HOME}/.bashrc"
  fi
  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf '  [dry-run] append export PATH="$HOME/.local/bin:$PATH" to %s\n' "$ACTIVE_RC"
  else
    touch "$ACTIVE_RC"
    if ! grep -Fq '.local/bin' "$ACTIVE_RC" 2>/dev/null; then
      printf '\nexport PATH="$HOME/.local/bin:$PATH"\n' >> "$ACTIVE_RC"
      log_ok "Added \$HOME/.local/bin to PATH in ${ACTIVE_RC}"
    fi
  fi
fi

# ── Substep 2.4: Active Zsh Detection & Interactive Startup Cheatsheet ───────
IS_ZSH=0
if [[ "${SHELL:-}" == */zsh ]] || [[ -n "${ZSH_VERSION:-}" ]]; then
  IS_ZSH=1
fi

strip_cheatsheet_block() {
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

inject_zsh_cheatsheet() {
  local zshrc="${HOME}/.zshrc"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf '  [dry-run] inject # >>> aice-cheatsheet >>> block into %s\n' "$zshrc"
    return 0
  fi

  touch "$zshrc"
  if grep -Fq "# >>> aice-cheatsheet >>>" "$zshrc" 2>/dev/null; then
    strip_cheatsheet_block "$zshrc"
  fi

  local ver="${LOCAL_VER}"
  if [[ -z "$ver" || "$ver" == "unknown" ]]; then
    ver="$("$AICE_BIN" --version 2>/dev/null | head -n1 | tr -d '[:space:]' || echo "0.9.53")"
  fi
  ver="${ver#v}"
  [[ -z "$ver" ]] && ver="0.9.53"

  local title_pad_len=$(( 77 - 66 - ${#ver} ))
  (( title_pad_len < 1 )) && title_pad_len=1
  local title_pad
  title_pad="$(printf '%*s' "$title_pad_len" '')"

  local inspect_pad_len=$(( 7 - ${#ver} ))
  (( inspect_pad_len < 0 )) && inspect_pad_len=0
  local inspect_pad
  inspect_pad="$(printf '%*s' "$inspect_pad_len" '')"

  cat >> "$zshrc" <<CHEATSHEET_EOF

# >>> aice-cheatsheet >>>
aice_cheatsheet() {
  local C_RESET="\033[0m"
  local C_CYAN="\033[1;36m"
  local C_GREEN="\033[1;32m"
  local C_YELLOW="\033[1;33m"
  local C_MAGENTA="\033[1;35m"
  local C_BOLD="\033[1m"
  local C_GRAY="\033[0;90m"
  printf "\n\${C_CYAN}\${C_BOLD}╭──────────────────────────────────────────────────────────────────────────────╮\${C_RESET}\n"
  printf "\${C_CYAN}\${C_BOLD}│\${C_RESET} \${C_BOLD}AICE v${ver} — ON-THE-FLY AI CONTEXT ENGINE & AST CHEATSHEET (@forart82)\${C_RESET}${title_pad}\${C_CYAN}\${C_BOLD}│\${C_RESET}\n"
  printf "\${C_CYAN}\${C_BOLD}├───────────────────────────────────────┬──────────────────────────────────────┤\${C_RESET}\n"
  printf "\${C_CYAN}\${C_BOLD}│\${C_RESET} \${C_YELLOW}\${C_BOLD}[1] UNIFIED READ/SEARCH/FIND/SPLICE\${C_RESET}   \${C_CYAN}\${C_BOLD}│\${C_RESET} \${C_MAGENTA}\${C_BOLD}[2] SELECTORS, AGENTS & TELEMETRY\${C_RESET}    \${C_CYAN}\${C_BOLD}│\${C_RESET}\n"
  printf "\${C_CYAN}\${C_BOLD}│\${C_RESET} \${C_GREEN}aice read <target>\${C_RESET}  \${C_GRAY}AICE IR / :sym\${C_RESET}    \${C_CYAN}\${C_BOLD}│\${C_RESET} \${C_GREEN}aice gain [project]\${C_RESET}  \${C_GRAY}BPE savings\${C_RESET}     \${C_CYAN}\${C_BOLD}│\${C_RESET}\n"
  printf "\${C_CYAN}\${C_BOLD}│\${C_RESET} \${C_GREEN}aice find | search\${C_RESET}  \${C_GRAY}<pat> [dir]\${C_RESET}       \${C_CYAN}\${C_BOLD}│\${C_RESET} \${C_GREEN}aice analyze [dir]\${C_RESET}   \${C_GRAY}Session audit\${C_RESET}   \${C_CYAN}\${C_BOLD}│\${C_RESET}\n"
  printf "\${C_CYAN}\${C_BOLD}│\${C_RESET} \${C_GREEN}aice splice <file>\${C_RESET}  \${C_GRAY}create, :sym, #\${C_RESET}   \${C_CYAN}\${C_BOLD}│\${C_RESET} \${C_GREEN}aice agents setup\${C_RESET}    \${C_GRAY}Wire CLI agents\${C_RESET} \${C_CYAN}\${C_BOLD}│\${C_RESET}\n"
  printf "\${C_CYAN}\${C_BOLD}│\${C_RESET} \${C_GREEN}aice write <file>\${C_RESET}   \${C_GRAY}<<< === >>>/stdin\${C_RESET} \${C_CYAN}\${C_BOLD}│\${C_RESET} \${C_GREEN}aice agents status\${C_RESET}   \${C_GRAY}Inspect v${ver}${inspect_pad}\${C_RESET}\${C_CYAN}\${C_BOLD}│\${C_RESET}\n"
  printf "\${C_CYAN}\${C_BOLD}│\${C_RESET} \${C_GREEN}aice read src tests\${C_RESET} \${C_GRAY}Auto-outline dir\${C_RESET}  \${C_CYAN}\${C_BOLD}│\${C_RESET} \${C_GREEN}aice enable|disable\${C_RESET}  \${C_GRAY}Toggle project\${C_RESET}  \${C_CYAN}\${C_BOLD}│\${C_RESET}\n"
  printf "\${C_CYAN}\${C_BOLD}├───────────────────────────────────────┴──────────────────────────────────────┤\${C_RESET}\n"
  printf "\${C_CYAN}\${C_BOLD}│\${C_RESET} \${C_GRAY}GitHub: https://github.com/forart82/aice •  Alias: aice-cheat  •  Apache-2.0\${C_RESET} \${C_CYAN}\${C_BOLD}│\${C_RESET}\n"
  printf "\${C_CYAN}\${C_BOLD}╰──────────────────────────────────────────────────────────────────────────────╯\${C_RESET}\n"
}
alias aice-cheat="aice_cheatsheet"
if [[ -o interactive ]]; then
  aice_cheatsheet
fi
# <<< aice-cheatsheet <<<
CHEATSHEET_EOF
  log_ok "Installed aice_cheatsheet block into ${zshrc}"
}

if [[ "$IS_ZSH" -eq 1 ]] && [[ "$NO_CHEATSHEET" -eq 0 ]]; then
  INSTALL_CHEAT=0
  if [[ "$AUTO_YES" -eq 1 ]]; then
    INSTALL_CHEAT=1
  elif [[ "$DRY_RUN" -eq 1 ]]; then
    printf '  [dry-run] prompt: Do you want the AICE cheatsheet to appear on Zsh shell startup? [y/N]\n'
  elif [[ -t 0 ]]; then
    printf 'Do you want the AICE cheatsheet to appear on Zsh shell startup? [y/N] '
    read -r ans || ans="n"
    case "$ans" in
      [yY]|[yY][eE][sS]) INSTALL_CHEAT=1 ;;
      *) INSTALL_CHEAT=0 ;;
    esac
  fi
  if [[ "$INSTALL_CHEAT" -eq 1 ]]; then
    inject_zsh_cheatsheet
  else
    log_info "Skipping Zsh startup cheatsheet injection."
  fi
else
  log_info "Skipping Zsh startup cheatsheet (zsh=${IS_ZSH}, no_cheatsheet=${NO_CHEATSHEET})."
  if [[ "$DRY_RUN" -eq 0 ]] && [[ -f "${HOME}/.zshrc" ]] && grep -Fq "# >>> aice-cheatsheet >>>" "${HOME}/.zshrc" 2>/dev/null; then
    log_info "Refreshing existing # >>> aice-cheatsheet >>> block in ${HOME}/.zshrc..."
    inject_zsh_cheatsheet
  fi
fi

# ── Substep 2.5: Global Agent Wiring, MCP Schemas & Opt-In Workspace Refresh ──
sync_opted_projects() {
  local raw_dir="$1"
  local base_home="${AICE_AGENT_HOME:-${HOME}}"
  local dev_dir="${raw_dir:-${base_home}/dev}"
  local refreshed_count=0
  local disabled_cleaned_count=0

  if [[ -d "$dev_dir" ]]; then
    dev_dir="$(cd "$dev_dir" && pwd)"
    for proj_path in "${dev_dir}"/*/; do
      [[ -d "$proj_path" ]] || continue
      proj_path="${proj_path%/}"
      local name
      name="$(basename "$proj_path")"
      [[ "$name" == .* ]] && continue
      case "$name" in
        node_modules|android-env|zshrc) continue ;;
      esac
      local lower_name
      lower_name="$(printf '%s' "$name" | tr '[:upper:]' '[:lower:]')"
      if [[ "$lower_name" == *_noaice || "$lower_name" == *_nonaice ]]; then
        continue
      fi
      if [[ -f "${proj_path}/Cargo.toml" && -f "${proj_path}/crates/aice-cli/src/main.rs" ]]; then
        continue
      fi
      [[ -f "${proj_path}/aice.config.json" ]] || continue

      local cfg_json=""
      if ! cfg_json="$("$AICE_BIN" config --json "$proj_path" 2>/dev/null)"; then
        continue
      fi
      if printf '%s' "$cfg_json" | grep -Eq '"enabled"[[:space:]]*:[[:space:]]*false'; then
        (cd "$proj_path" && "$AICE_BIN" disable >/dev/null 2>&1 || true)
        disabled_cleaned_count=$((disabled_cleaned_count + 1))
      else
        (cd "$proj_path" && "$AICE_BIN" enable >/dev/null 2>&1 || true)
        refreshed_count=$((refreshed_count + 1))
      fi
    done
  fi
  log_ok "Synchronized explicit aice.config.json projects in ${dev_dir} (${refreshed_count} enabled refreshed, ${disabled_cleaned_count} disabled cleaned)"
}

if [[ "$DRY_RUN" -eq 1 ]]; then
  if [[ "$NO_AGENTS" -eq 0 ]]; then
    printf '  [dry-run] %s agents setup\n' "$AICE_BIN"
    printf '  [dry-run] %s mcp --generate-schemas %s/.gemini/antigravity-cli/mcp/aice\n' "$AICE_BIN" "${AICE_AGENT_HOME:-${HOME}}"
    if [[ "$SYNC_PROJECTS" -eq 1 ]] || [[ -n "${AICE_PROJECTS_DIR:-}" ]]; then
      printf '  [dry-run] refresh explicit aice.config.json projects in %s\n' "${SYNC_PROJECTS_DIR:-${AICE_PROJECTS_DIR:-~/dev}}"
    fi
  fi
  printf '  [dry-run] %s --version\n' "$AICE_BIN"
  printf '  [dry-run] %s agents status\n' "$AICE_BIN"
else
  if [[ "$NO_AGENTS" -eq 0 ]]; then
    log_info "Configuring global CLI coding agents (aice agents setup)..."
    "$AICE_BIN" agents setup

    MCP_SCHEMA_DIR="${AICE_AGENT_HOME:-${HOME}}/.gemini/antigravity-cli/mcp/aice"
    log_info "Regenerating MCP tool schemas in ${MCP_SCHEMA_DIR}..."
    "$AICE_BIN" mcp --generate-schemas "$MCP_SCHEMA_DIR"

    if [[ "$SYNC_PROJECTS" -eq 1 ]] || [[ -n "${AICE_PROJECTS_DIR:-}" ]]; then
      TARGET_PROJECTS_DIR="${SYNC_PROJECTS_DIR:-${AICE_PROJECTS_DIR:-}}"
      log_info "Refreshing opted-in AICE workspaces in ${TARGET_PROJECTS_DIR:-~/dev}..."
      sync_opted_projects "$TARGET_PROJECTS_DIR"
    fi
  fi
  log_info "Running post-install smoke checks..."
  VER="$("$AICE_BIN" --version)"
  log_ok "aice --version -> ${VER}"
  "$AICE_BIN" agents status
fi

log_ok "AICE installation complete! (v${LOCAL_VER}) Created by @forart82 (https://github.com/forart82/aice)"
