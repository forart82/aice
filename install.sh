#!/usr/bin/env bash
# ==============================================================================
# AICE Universal Linux Installer & In-Place Updater (install.sh)
# Idempotent setup & update for AICE CLI, MCP Server, CLI Agents, & Workspaces
# ==============================================================================
set -euo pipefail

AUTO_YES=0
FORCE_UPDATE=0
NO_CHEATSHEET=0
NO_AGENTS=0
NO_UPDATE=0
DRY_RUN=0

print_help() {
  cat <<'HELP_EOF'
Usage: ./install.sh [options]

Options:
  -y, --yes             Auto-confirm dependency installation, git update, and Zsh cheatsheet
  -u, --update          Force in-place update check against origin/main and refresh all rules/schemas
      --no-update       Skip checking the remote git repository for newer versions
      --no-cheatsheet   Skip the Zsh startup cheatsheet prompt/injection
      --no-agents       Skip automatic CLI coding agent configuration (aice agents setup)
      --dry-run         Print actions that would be performed without mutating the system
  -h, --help            Display this help message
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
command -v git >/dev/null 2>&1 || MISSING_PKGS+=(git)
command -v curl >/dev/null 2>&1 || MISSING_PKGS+=(curl)

NODE_MAJOR="$(get_node_major)"
NEED_NODE=0
if [[ "$NODE_MAJOR" -lt 20 ]] || ! command -v npm >/dev/null 2>&1; then
  NEED_NODE=1
fi

if [[ ${#MISSING_PKGS[@]} -gt 0 ]] || [[ "$NEED_NODE" -eq 1 ]]; then
  log_warn "Missing or outdated prerequisites (git/curl/node>=20/npm)."
  if [[ "$AUTO_YES" -eq 0 ]] && [[ "$DRY_RUN" -eq 0 ]] && [[ -t 0 ]]; then
    printf 'Install missing system prerequisites now? [Y/n] '
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

  if [[ "$NEED_NODE" -eq 1 ]]; then
    log_info "Installing Node.js >= 20 and npm..."
    if [[ "$DRY_RUN" -eq 1 ]]; then
      printf '  [dry-run] install nodejs >= 20 and npm via %s or NodeSource/nvm\n' "$PKG_MGR"
    else
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

# ── Substep 2.2b: Detect Installed / Local / Remote Versions & In-Place Update ─
LOCAL_BIN="${HOME}/.local/bin"
AICE_BIN="${LOCAL_BIN}/aice"
INSTALLED_VER="none"
if [[ -x "$AICE_BIN" ]]; then
  INSTALLED_VER="$("$AICE_BIN" --version 2>/dev/null | head -n1 | tr -d '[:space:]' || echo "none")"
elif command -v aice >/dev/null 2>&1; then
  INSTALLED_VER="$(aice --version 2>/dev/null | head -n1 | tr -d '[:space:]' || echo "none")"
fi

LOCAL_VER="$(node -e 'try{console.log(require(process.argv[1]).version)}catch{console.log("unknown")}' "${SCRIPT_DIR}/package.json" 2>/dev/null || echo "unknown")"
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
    REMOTE_VER="$(git -C "$SCRIPT_DIR" show origin/main:package.json 2>/dev/null | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{try{console.log(JSON.parse(d).version)}catch{console.log("latest")}})' 2>/dev/null || echo "$LOCAL_VER")"
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
          LOCAL_VER="$(node -e 'try{console.log(require(process.argv[1]).version)}catch{console.log("unknown")}' "${SCRIPT_DIR}/package.json" 2>/dev/null || echo "$REMOTE_VER")"
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

# ── Substep 2.3: Build & Global Symlink Registration (Always Executed) ────────
log_info "Installing npm dependencies in ${SCRIPT_DIR} (v${LOCAL_VER})..."
run_cmd npm install --no-fund --no-audit

log_info "Setting executable permissions on bin/aice.mjs..."
run_cmd chmod +x "$(pwd)/bin/aice.mjs"

run_cmd mkdir -p "$LOCAL_BIN"
run_cmd ln -sf "$(pwd)/bin/aice.mjs" "${LOCAL_BIN}/aice"
log_ok "Linked global binary: ${LOCAL_BIN}/aice -> $(pwd)/bin/aice.mjs (v${LOCAL_VER})"

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
  if grep -Fq "# >>> aice-cheatsheet >>>" "$zshrc" 2>/dev/null; then
    node -e '
      const fs = require("fs");
      const p = process.argv[1];
      let c = fs.readFileSync(p, "utf-8");
      c = c.replace(/\n?# >>> aice-cheatsheet >>>[\s\S]*?# <<< aice-cheatsheet <<<\n?/g, "\n");
      fs.writeFileSync(p, c, "utf-8");
    ' "$zshrc"
  fi

  cat <<'CHEATSHEET_EOF' >> "$zshrc"

# >>> aice-cheatsheet >>>
aice_cheatsheet() {
  local C_RESET="\033[0m"
  local C_CYAN="\033[1;36m"
  local C_GREEN="\033[1;32m"
  local C_YELLOW="\033[1;33m"
  local C_MAGENTA="\033[1;35m"
  local C_BOLD="\033[1m"
  local C_GRAY="\033[0;90m"
  printf "\n${C_CYAN}${C_BOLD}╭──────────────────────────────────────────────────────────────────────────────╮${C_RESET}\n"
  printf "${C_CYAN}${C_BOLD}│${C_RESET} ${C_BOLD}AICE v0.9.22 — ON-THE-FLY AI CONTEXT ENGINE & AST CHEATSHEET (@forart82)${C_RESET}     ${C_CYAN}${C_BOLD}│${C_RESET}\n"
  printf "${C_CYAN}${C_BOLD}├───────────────────────────────────────┬──────────────────────────────────────┤${C_RESET}\n"
  printf "${C_CYAN}${C_BOLD}│${C_RESET} ${C_YELLOW}${C_BOLD}[1] AI CONTEXT & SURGICAL AST TOOLS${C_RESET}   ${C_CYAN}${C_BOLD}│${C_RESET} ${C_MAGENTA}${C_BOLD}[2] SELECTORS, AGENTS & TELEMETRY${C_RESET}    ${C_CYAN}${C_BOLD}│${C_RESET}\n"
  printf "${C_CYAN}${C_BOLD}│${C_RESET} ${C_GREEN}aice create <file>${C_RESET}   ${C_GRAY}New file/--stdin${C_RESET} ${C_CYAN}${C_BOLD}│${C_RESET} ${C_GREEN}aice gain [project]${C_RESET}  ${C_GRAY}Token savings${C_RESET}   ${C_CYAN}${C_BOLD}│${C_RESET}\n"
  printf "${C_CYAN}${C_BOLD}│${C_RESET} ${C_GREEN}aice outline <path>${C_RESET}  ${C_GRAY}src tests / 85%%${C_RESET}  ${C_CYAN}${C_BOLD}│${C_RESET} ${C_GREEN}aice analyze [dir]${C_RESET}   ${C_GRAY}Session audit${C_RESET}   ${C_CYAN}${C_BOLD}│${C_RESET}\n"
  printf "${C_CYAN}${C_BOLD}│${C_RESET} ${C_GREEN}aice context <file>${C_RESET}  ${C_GRAY}-s sym/TC/L/pat${C_RESET}  ${C_CYAN}${C_BOLD}│${C_RESET} ${C_GREEN}aice agents setup${C_RESET}    ${C_GRAY}Wire CLI agents${C_RESET} ${C_CYAN}${C_BOLD}│${C_RESET}\n"
  printf "${C_CYAN}${C_BOLD}│${C_RESET} ${C_GREEN}aice splice <file>${C_RESET}   ${C_GRAY}:m/:TC/:L/:eof${C_RESET}   ${C_CYAN}${C_BOLD}│${C_RESET} ${C_GREEN}aice agents status${C_RESET}   ${C_GRAY}Inspect v0.9.22${C_RESET} ${C_CYAN}${C_BOLD}│${C_RESET}\n"
  printf "${C_CYAN}${C_BOLD}│${C_RESET} ${C_GREEN}aice idioms <cmd>${C_RESET}    ${C_GRAY}33 exts + .aipl${C_RESET}  ${C_CYAN}${C_BOLD}│${C_RESET} ${C_GREEN}aice enable|disable${C_RESET}  ${C_GRAY}Toggle project${C_RESET}  ${C_CYAN}${C_BOLD}│${C_RESET}\n"
  printf "${C_CYAN}${C_BOLD}├───────────────────────────────────────┴──────────────────────────────────────┤${C_RESET}\n"
  printf "${C_CYAN}${C_BOLD}│${C_RESET} ${C_GRAY}GitHub: https://github.com/forart82/aice •  Alias: aice-cheat  •  Apache-2.0${C_RESET} ${C_CYAN}${C_BOLD}│${C_RESET}\n"
  printf "${C_CYAN}${C_BOLD}╰──────────────────────────────────────────────────────────────────────────────╯${C_RESET}\n"
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

# ── Substep 2.5: Global Agent Wiring, MCP Schemas & Workspace Rule Refresh ───
if [[ "$DRY_RUN" -eq 1 ]]; then
  if [[ "$NO_AGENTS" -eq 0 ]]; then
    printf '  [dry-run] %s agents setup\n' "$AICE_BIN"
    printf '  [dry-run] regenerate MCP schemas in ~/.gemini/antigravity-cli/mcp/aice/\n'
    printf '  [dry-run] refresh AICE rule blocks across ~/dev/* AICE-enabled projects\n'
  fi
  printf '  [dry-run] %s --version\n' "$AICE_BIN"
  printf '  [dry-run] %s agents status\n' "$AICE_BIN"
else
  if [[ "$NO_AGENTS" -eq 0 ]]; then
    log_info "Configuring global CLI coding agents (aice agents setup)..."
    "$AICE_BIN" agents setup

    log_info "Regenerating MCP tool schemas and refreshing AICE-enabled workspaces in ~/dev/*..."
    npx tsx -e '
      import * as fs from "node:fs";
      import * as os from "node:os";
      import * as path from "node:path";
      import { AICE_MCP_TOOLS, AICE_VERSION } from "./src/mcp/server.ts";
      import { loadProjectConfig, isProjectAiceEnabled, syncProjectWorkspaceRules } from "./src/config/project-config.ts";

      const homeDir = process.env.AICE_AGENT_HOME ? path.resolve(process.env.AICE_AGENT_HOME) : os.homedir();
      const mcpSchemaDir = path.join(homeDir, ".gemini", "antigravity-cli", "mcp", "aice");
      fs.mkdirSync(mcpSchemaDir, { recursive: true });
      for (const tool of AICE_MCP_TOOLS) {
        fs.writeFileSync(
          path.join(mcpSchemaDir, `${tool.name}.json`),
          JSON.stringify({ ...tool, version: AICE_VERSION }, null, 2) + "\n",
          "utf-8",
        );
      }
      fs.writeFileSync(
        path.join(mcpSchemaDir, "tools.json"),
        JSON.stringify({ server: "aice", version: AICE_VERSION, tools: AICE_MCP_TOOLS }, null, 2) + "\n",
        "utf-8",
      );

      const devDir = process.env.AICE_PROJECTS_DIR
        ? path.resolve(process.env.AICE_PROJECTS_DIR)
        : path.join(homeDir, "dev");
      let refreshedCount = 0;
      if (fs.existsSync(devDir) && fs.statSync(devDir).isDirectory()) {
        for (const entry of fs.readdirSync(devDir, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          const projPath = path.join(devDir, entry.name);
          const cfgPath = path.join(projPath, "aice.config.json");
          if (fs.existsSync(cfgPath)) {
            const cfg = loadProjectConfig(projPath);
            if (isProjectAiceEnabled(cfg)) {
              syncProjectWorkspaceRules(projPath, true);
              refreshedCount++;
            }
          }
        }
      }
      console.log(`[✔] Regenerated ${AICE_MCP_TOOLS.length} MCP schema(s) (v${AICE_VERSION}) in ${mcpSchemaDir} and refreshed ${refreshedCount} workspace(s) in ${devDir}`);
    '
  fi
  log_info "Running post-install smoke checks..."
  VER="$("$AICE_BIN" --version)"
  log_ok "aice --version -> ${VER}"
  "$AICE_BIN" agents status
fi

log_ok "AICE installation complete! (v${LOCAL_VER}) Created by @forart82 (https://github.com/forart82/aice)"