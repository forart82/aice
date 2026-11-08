#!/usr/bin/env bash
# ==============================================================================
# AICE Universal Linux Installer (install.sh)
# Idempotent setup for AICE CLI, MCP Server, CLI Agents, & Optional Zsh Cheatsheet
# ==============================================================================
set -euo pipefail

AUTO_YES=0
NO_CHEATSHEET=0
NO_AGENTS=0
DRY_RUN=0

print_help() {
  cat <<'EOF'
Usage: ./install.sh [options]

Options:
  -y, --yes             Auto-confirm dependency installation and Zsh cheatsheet
      --no-cheatsheet   Skip the Zsh startup cheatsheet prompt/injection
      --no-agents       Skip automatic CLI coding agent configuration (aice agents setup)
      --dry-run         Print actions that would be performed without mutating the system
  -h, --help            Display this help message
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -y|--yes)
      AUTO_YES=1
      shift
      ;;
    --no-cheatsheet)
      NO_CHEATSHEET=1
      shift
      ;;
    --no-agents)
      NO_AGENTS=1
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

# ── Substep 2.1: Detect Linux Distro & Package Manager ────────────────────────
DISTRO_ID="unknown"
DISTRO_NAME="Linux"
if [[ -f /etc/os-release ]]; then
  # Parse key-value safely without arbitrary code execution
  while IFS='=' read -r k v; do
    v="${v%\"}"
    v="${v#\"}"
    case "$k" in
      ID) DISTRO_ID="$v" ;;
      PRETTY_NAME) DISTRO_NAME="$v" ;;
    esac
  done < /etc/os-release
fi

PKG_MGR="none"
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

log_info "Detected OS: ${DISTRO_NAME} (id=${DISTRO_ID}, pkg_manager=${PKG_MGR})"

SUDO_CMD=()
if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  if command -v sudo >/dev/null 2>&1; then
    SUDO_CMD=(sudo)
  fi
fi

install_sys_packages() {
  local pkgs=("$@")
  if [[ ${#pkgs[@]} -eq 0 ]]; then
    return 0
  fi
  log_info "Installing missing system packages (${pkgs[*]}) via ${PKG_MGR}..."
  case "$PKG_MGR" in
    apt-get)
      run_cmd "${SUDO_CMD[@]}" apt-get update -y
      run_cmd "${SUDO_CMD[@]}" apt-get install -y "${pkgs[@]}"
      ;;
    dnf)
      run_cmd "${SUDO_CMD[@]}" dnf install -y "${pkgs[@]}"
      ;;
    yum)
      run_cmd "${SUDO_CMD[@]}" yum install -y "${pkgs[@]}"
      ;;
    pacman)
      run_cmd "${SUDO_CMD[@]}" pacman -Sy --noconfirm "${pkgs[@]}"
      ;;
    zypper)
      run_cmd "${SUDO_CMD[@]}" zypper --non-interactive install "${pkgs[@]}"
      ;;
    apk)
      run_cmd "${SUDO_CMD[@]}" apk add --no-cache "${pkgs[@]}"
      ;;
    *)
      log_err "No supported Linux package manager found to install: ${pkgs[*]}"
      exit 1
      ;;
  esac
}

# ── Substep 2.2: Verify & Auto-Install git, curl, node (>= 20), and npm ──────
get_node_major() {
  if ! command -v node >/dev/null 2>&1; then
    echo 0
    return
  fi
  local ver
  ver="$(node -v 2>/dev/null || echo "v0.0.0")"
  ver="${ver#v}"
  echo "${ver%%.*}"
}

MISSING_PKGS=()
command -v git >/dev/null 2>&1  || MISSING_PKGS+=(git)
command -v curl >/dev/null 2>&1 || MISSING_PKGS+=(curl)

NODE_MAJOR="$(get_node_major)"
NEED_NODE=0
if [[ "$NODE_MAJOR" -lt 20 ]] || ! command -v npm >/dev/null 2>&1; then
  NEED_NODE=1
fi

if [[ ${#MISSING_PKGS[@]} -gt 0 ]]; then
  install_sys_packages "${MISSING_PKGS[@]}"
fi

if [[ "$NEED_NODE" -eq 1 ]]; then
  log_warn "Node.js >= 20 and npm are required (found node major=${NODE_MAJOR}). Installing..."
  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf '  [dry-run] install nodejs >= 20 and npm via %s / NodeSource / nvm\n' "$PKG_MGR"
  else
    install_sys_packages nodejs npm || true
    NODE_MAJOR="$(get_node_major)"
    if [[ "$NODE_MAJOR" -lt 20 ]]; then
      log_info "Distro Node.js is < 20 (v${NODE_MAJOR}); attempting NodeSource / NVM fallback..."
      if [[ "$PKG_MGR" == "apt-get" ]] && [[ ${#SUDO_CMD[@]} -gt 0 || "${EUID:-$(id -u)}" -eq 0 ]]; then
        curl -fsSL https://deb.nodesource.com/setup_20.x | "${SUDO_CMD[@]}" -E bash -
        "${SUDO_CMD[@]}" apt-get install -y nodejs
      elif [[ "$PKG_MGR" == "dnf" || "$PKG_MGR" == "yum" ]] && [[ ${#SUDO_CMD[@]} -gt 0 || "${EUID:-$(id -u)}" -eq 0 ]]; then
        curl -fsSL https://rpm.nodesource.com/setup_20.x | "${SUDO_CMD[@]}" bash -
        "${SUDO_CMD[@]}" "$PKG_MGR" install -y nodejs
      else
        export NVM_DIR="${HOME}/.nvm"
        mkdir -p "$NVM_DIR"
        curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
        # shellcheck disable=SC1091
        [[ -s "$NVM_DIR/nvm.sh" ]] && . "$NVM_DIR/nvm.sh"
        nvm install 20
        nvm use 20
      fi
    fi
  fi
fi

log_ok "Prerequisites verified: git ($(git --version 2>/dev/null | head -n1 || echo ok)), curl, node ($(node -v 2>/dev/null || echo '>=20')), npm ($(npm -v 2>/dev/null || echo 'ok'))"

# ── Substep 2.3: Build & Global Symlink Registration ─────────────────────────
log_info "Installing npm dependencies in ${SCRIPT_DIR}..."
run_cmd npm install --no-fund --no-audit

log_info "Setting executable permissions on bin/aice.mjs..."
run_cmd chmod +x "$(pwd)/bin/aice.mjs"

LOCAL_BIN="${HOME}/.local/bin"
run_cmd mkdir -p "$LOCAL_BIN"
run_cmd ln -sf "$(pwd)/bin/aice.mjs" "${LOCAL_BIN}/aice"
log_ok "Linked global binary: ${LOCAL_BIN}/aice -> $(pwd)/bin/aice.mjs"

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

inject_zsh_cheatsheet() {
  local zshrc="${HOME}/.zshrc"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf '  [dry-run] inject # >>> aice-cheatsheet >>> block into %s\n' "$zshrc"
    return 0
  fi
  touch "$zshrc"
  # Strip any prior # >>> aice-cheatsheet >>> ... # <<< aice-cheatsheet <<< block
  if grep -Fq "# >>> aice-cheatsheet >>>" "$zshrc" 2>/dev/null; then
    node -e '
      const fs = require("fs");
      const file = process.argv[1];
      let content = fs.readFileSync(file, "utf8");
      content = content.replace(/\n?# >>> aice-cheatsheet >>>[\s\S]*?# <<< aice-cheatsheet <<<\n?/g, "\n");
      fs.writeFileSync(file, content, "utf8");
    ' "$zshrc"
  fi

  cat >> "$zshrc" <<'CHEATSHEET_EOF'

# >>> aice-cheatsheet >>>
aice_cheatsheet() {
  emulate -L zsh
  setopt localoptions no_sh_word_split

  local cols="${1:-${COLUMNS:-100}}"
  local C_RESET=$'\033[0m'
  local C_BOLD=$'\033[1m'
  local C_CYAN=$'\033[38;5;51m'
  local C_GREEN=$'\033[38;5;84m'
  local C_YELLOW=$'\033[38;5;220m'
  local C_MAGENTA=$'\033[38;5;213m'
  local C_GRAY=$'\033[38;5;245m'

  printf "${C_CYAN}${C_BOLD}╭──────────────────────────────────────────────────────────────────────────────╮${C_RESET}\n"
  printf "${C_CYAN}${C_BOLD}│${C_RESET} ${C_BOLD}AICE 2.0 — ON-THE-FLY AI CONTEXT ENGINE & TELEMETRY CHEATSHEET (aice-cheat)${C_RESET}  ${C_CYAN}${C_BOLD}│${C_RESET}\n"
  printf "${C_CYAN}${C_BOLD}├───────────────────────────────────────┬──────────────────────────────────────┤${C_RESET}\n"
  printf "${C_CYAN}${C_BOLD}│${C_RESET} ${C_YELLOW}${C_BOLD}[1] AI CONTEXT & SURGICAL AST TOOLS${C_RESET}   ${C_CYAN}${C_BOLD}│${C_RESET} ${C_MAGENTA}${C_BOLD}[2] TELEMETRY, AGENTS & CONFIG${C_RESET}       ${C_CYAN}${C_BOLD}│${C_RESET}\n"
  printf "${C_CYAN}${C_BOLD}│${C_RESET} ${C_GREEN}aice outline <path>${C_RESET}  ${C_GRAY}85%% AST skeleton${C_RESET} ${C_CYAN}${C_BOLD}│${C_RESET} ${C_GREEN}aice gain [project]${C_RESET}  ${C_GRAY}Token savings${C_RESET}   ${C_CYAN}${C_BOLD}│${C_RESET}\n"
  printf "${C_CYAN}${C_BOLD}│${C_RESET} ${C_GREEN}aice context <file>${C_RESET}  ${C_GRAY}1-turn symbol${C_RESET}    ${C_CYAN}${C_BOLD}│${C_RESET} ${C_GREEN}aice agents setup${C_RESET}    ${C_GRAY}Wire CLI agents${C_RESET} ${C_CYAN}${C_BOLD}│${C_RESET}\n"
  printf "${C_CYAN}${C_BOLD}│${C_RESET} ${C_GREEN}aice splice <file>${C_RESET}   ${C_GRAY}Surgical edit${C_RESET}    ${C_CYAN}${C_BOLD}│${C_RESET} ${C_GREEN}aice agents status${C_RESET}   ${C_GRAY}Inspect agents${C_RESET}  ${C_CYAN}${C_BOLD}│${C_RESET}\n"
  printf "${C_CYAN}${C_BOLD}│${C_RESET} ${C_GREEN}aice idioms <cmd>${C_RESET}    ${C_GRAY}Project \$idioms${C_RESET}  ${C_CYAN}${C_BOLD}│${C_RESET} ${C_GREEN}aice enable|disable${C_RESET}  ${C_GRAY}Toggle project${C_RESET}  ${C_CYAN}${C_BOLD}│${C_RESET}\n"
  printf "${C_CYAN}${C_BOLD}╰───────────────────────────────────────┴──────────────────────────────────────╯${C_RESET}\n"
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
fi

# ── Substep 2.5: Post-Install Global Agent Wiring & Smoke Check ──────────────
AICE_BIN="${LOCAL_BIN}/aice"
if [[ "$DRY_RUN" -eq 1 ]]; then
  if [[ "$NO_AGENTS" -eq 0 ]]; then
    printf '  [dry-run] %s agents setup\n' "$AICE_BIN"
  fi
  printf '  [dry-run] %s --version\n' "$AICE_BIN"
  printf '  [dry-run] %s agents status\n' "$AICE_BIN"
else
  if [[ "$NO_AGENTS" -eq 0 ]]; then
    log_info "Configuring global CLI coding agents (aice agents setup)..."
    "$AICE_BIN" agents setup
  fi
  log_info "Running post-install smoke checks..."
  VER="$("$AICE_BIN" --version)"
  log_ok "aice --version -> ${VER}"
  "$AICE_BIN" agents status
fi

log_ok "AICE installation complete!"
