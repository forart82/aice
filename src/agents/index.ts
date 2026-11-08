/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AICE 2.0 Global CLI Agent Integration Engine (`aice agents`).
 * Manages idempotent registration, status inspection, and clean removal of
 * AICE MCP server entries and `<!-- AICE:START -->...<!-- AICE:END -->` system
 * directives across Claude Code, Antigravity/Gemini CLI, OpenAI Codex CLI,
 * OpenCode, Aider, Goose, and Cursor.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import YAML from "yaml";
import { KNOWN_TARGET_EXTENSIONS } from "../config/index.js";

export type SupportedAgentId =
  | "claude"
  | "agy"
  | "gemini"
  | "codex"
  | "opencode"
  | "aider"
  | "goose"
  | "cursor";

export const AICE_DIRECTIVE_START = "<!-- AICE:START -->";
export const AICE_DIRECTIVE_END = "<!-- AICE:END -->";

export const SUPPORTED_EXTENSIONS_LIST = Array.from(KNOWN_TARGET_EXTENSIONS).join(", ");

export const CANONICAL_AICE_AGENT_DIRECTIVE = `${AICE_DIRECTIVE_START}
## AICE 2.0 — Automatic Token-Efficient AST Context & Mutation Rules
For all 24 supported file extensions (${SUPPORTED_EXTENSIONS_LIST}):
1. **Project Opt-Out Check**: Before using AICE on a repository, respect \`aice.config.json\`:
   - If \`"enabled": false\`, bypass AICE completely and use native file tools.
   - If \`"idiomsEnabled": false\` (or \`"idioms": false\`), do not collapse or expand \`$idiom\` macros.
2. **Explore & Read (85-90% Token Savings)**:
   - Prefer MCP \`aice_outline\` (or CLI \`aice outline <path>\`) to inspect file/directory AST structure before reading raw files.
   - Prefer MCP \`aice_context\` (or CLI \`aice context <file> -s <symbol>\`) for 1-turn symbol-scoped code + dependency contracts + callers.
3. **Surgical Edits (90%+ Output Token Savings)**:
   - Prefer MCP \`aice_splice\` (or CLI \`aice splice <file> -s <symbol> -c "<code>"\`) for symbol-targeted AST replacements, insertions, or deletions.
   - Prefer MCP \`aice_idioms\` (or CLI \`aice idioms list|read|update\`) for recurring multi-file AST patterns.
${AICE_DIRECTIVE_END}`;

export interface AgentStatusEntry {
  id: SupportedAgentId;
  displayName: string;
  binaryDetected: boolean;
  binaryPath?: string;
  mcpConfigured: boolean;
  mcpConfigPath: string;
  promptConfigured: boolean;
  promptPath?: string;
}

export interface AgentSetupOptions {
  homeDir?: string;
  all?: boolean;
  agent?: string;
}

export interface AgentActionResult {
  homeDir: string;
  agents: AgentStatusEntry[];
}

function resolveHomeDir(homeDir?: string): string {
  if (homeDir) return path.resolve(homeDir);
  if (process.env.AICE_AGENT_HOME) return path.resolve(process.env.AICE_AGENT_HOME);
  return os.homedir();
}

function detectBinary(binNames: string[]): { found: boolean; path?: string } {
  for (const name of binNames) {
    try {
      const res = spawnSync("which", [name], { encoding: "utf-8", timeout: 1500 });
      if (res.status === 0 && res.stdout && res.stdout.trim()) {
        return { found: true, path: res.stdout.trim().split("\n")[0] };
      }
    } catch {
      // ignore
    }
  }
  return { found: false };
}

/**
 * Idempotently upserts the `<!-- AICE:START -->...<!-- AICE:END -->` block into a Markdown file.
 */
export function upsertMarkdownDirective(
  filePath: string,
  directiveBlock: string = CANONICAL_AICE_AGENT_DIRECTIVE,
): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  let existing = "";
  if (fs.existsSync(filePath)) {
    existing = fs.readFileSync(filePath, "utf-8");
  }

  const startIdx = existing.indexOf(AICE_DIRECTIVE_START);
  const endIdx = existing.indexOf(AICE_DIRECTIVE_END);

  if (startIdx !== -1 && endIdx !== -1 && endIdx >= startIdx) {
    const before = existing.slice(0, startIdx);
    const after = existing.slice(endIdx + AICE_DIRECTIVE_END.length);
    const updated = `${before}${directiveBlock}${after}`;
    fs.writeFileSync(filePath, updated, "utf-8");
    return;
  }

  const trimmed = existing.trimEnd();
  const updated = trimmed ? `${trimmed}\n\n${directiveBlock}\n` : `${directiveBlock}\n`;
  fs.writeFileSync(filePath, updated, "utf-8");
}

/**
 * Cleanly removes the `<!-- AICE:START -->...<!-- AICE:END -->` block from a Markdown file.
 */
export function removeMarkdownDirective(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  const existing = fs.readFileSync(filePath, "utf-8");
  const startIdx = existing.indexOf(AICE_DIRECTIVE_START);
  const endIdx = existing.indexOf(AICE_DIRECTIVE_END);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    return false;
  }
  const before = existing.slice(0, startIdx).replace(/\n+$/, "");
  const after = existing.slice(endIdx + AICE_DIRECTIVE_END.length).replace(/^\n+/, "");
  const combined = [before, after].filter(Boolean).join("\n\n");
  fs.writeFileSync(filePath, combined ? `${combined}\n` : "", "utf-8");
  return true;
}

export function hasMarkdownDirective(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return content.includes(AICE_DIRECTIVE_START) && content.includes(AICE_DIRECTIVE_END);
  } catch {
    return false;
  }
}

/**
 * Safely merges `"mcpServers": { "aice": { "command": "aice", "args": ["mcp"] } }` into a JSON file.
 */
export function upsertJsonMcpServer(filePath: string, alsoSetMcpKey = false): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  let data: Record<string, unknown> = {};
  if (fs.existsSync(filePath)) {
    try {
      const raw = fs.readFileSync(filePath, "utf-8").trim();
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          data = parsed as Record<string, unknown>;
        }
      }
    } catch {
      // If existing JSON is invalid, do not clobber; throw descriptive error
      throw new Error(`Cannot merge AICE MCP config into malformed JSON file: ${filePath}`);
    }
  }

  const mcpServers =
    data.mcpServers && typeof data.mcpServers === "object" && !Array.isArray(data.mcpServers)
      ? { ...(data.mcpServers as Record<string, unknown>) }
      : {};
  mcpServers.aice = {
    command: "aice",
    args: ["mcp"],
  };
  data.mcpServers = mcpServers;

  if (alsoSetMcpKey) {
    const mcp =
      data.mcp && typeof data.mcp === "object" && !Array.isArray(data.mcp)
        ? { ...(data.mcp as Record<string, unknown>) }
        : {};
    mcp.aice = {
      type: "local",
      command: ["aice", "mcp"],
      enabled: true,
    };
    data.mcp = mcp;
  }

  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
}

export function removeJsonMcpServer(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  try {
    const raw = fs.readFileSync(filePath, "utf-8").trim();
    if (!raw) return false;
    const data = JSON.parse(raw) as Record<string, unknown>;
    let modified = false;

    if (data.mcpServers && typeof data.mcpServers === "object" && !Array.isArray(data.mcpServers)) {
      const servers = data.mcpServers as Record<string, unknown>;
      if ("aice" in servers) {
        delete servers.aice;
        modified = true;
      }
    }
    if (data.mcp && typeof data.mcp === "object" && !Array.isArray(data.mcp)) {
      const mcp = data.mcp as Record<string, unknown>;
      if ("aice" in mcp) {
        delete mcp.aice;
        modified = true;
      }
    }

    if (modified) {
      fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
    }
    return modified;
  } catch {
    return false;
  }
}

export function hasJsonMcpServer(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>;
    const servers = data.mcpServers as Record<string, unknown> | undefined;
    const mcp = data.mcp as Record<string, unknown> | undefined;
    return Boolean(
      (servers && typeof servers === "object" && servers.aice) ||
        (mcp && typeof mcp === "object" && mcp.aice),
    );
  } catch {
    return false;
  }
}

/**
 * Safely upserts `[mcp_servers.aice]` in `~/.codex/config.toml` without clobbering other TOML sections.
 */
export function upsertCodexToml(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  let existing = "";
  if (fs.existsSync(filePath)) {
    existing = fs.readFileSync(filePath, "utf-8");
  }

  const sectionBlock = `[mcp_servers.aice]\ncommand = "aice"\nargs = ["mcp"]`;
  const sectionRegex = /^\[mcp_servers\.aice\]\s*\n(?:[^[]*)/m;

  if (sectionRegex.test(existing)) {
    const updated = existing.replace(sectionRegex, `${sectionBlock}\n\n`);
    fs.writeFileSync(filePath, `${updated.trimEnd()}\n`, "utf-8");
    return;
  }

  const trimmed = existing.trimEnd();
  const updated = trimmed ? `${trimmed}\n\n${sectionBlock}\n` : `${sectionBlock}\n`;
  fs.writeFileSync(filePath, updated, "utf-8");
}

export function removeCodexToml(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  const existing = fs.readFileSync(filePath, "utf-8");
  const sectionRegex = /\n*^\[mcp_servers\.aice\]\s*\n(?:[^[]*)/m;
  if (!sectionRegex.test(existing)) return false;
  const updated = existing.replace(sectionRegex, "\n").trim();
  fs.writeFileSync(filePath, updated ? `${updated}\n` : "", "utf-8");
  return true;
}

export function hasCodexToml(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return /^\[mcp_servers\.aice\]/m.test(content);
  } catch {
    return false;
  }
}

/**
 * Safely upserts `~/.aider/CONVENTIONS.md` into `read:` list in `~/.aider.conf.yml`.
 */
export function upsertAiderConfigYaml(confPath: string, conventionsPath: string): void {
  fs.mkdirSync(path.dirname(confPath), { recursive: true });
  let parsed: Record<string, unknown> = {};
  if (fs.existsSync(confPath)) {
    try {
      const raw = fs.readFileSync(confPath, "utf-8");
      const doc = YAML.parse(raw);
      if (doc && typeof doc === "object" && !Array.isArray(doc)) {
        parsed = doc as Record<string, unknown>;
      }
    } catch {
      parsed = {};
    }
  }

  const currentRead = parsed.read;
  if (Array.isArray(currentRead)) {
    if (!currentRead.includes(conventionsPath)) {
      parsed.read = [...currentRead, conventionsPath];
    }
  } else if (typeof currentRead === "string" && currentRead.trim()) {
    if (currentRead !== conventionsPath) {
      parsed.read = [currentRead, conventionsPath];
    }
  } else {
    parsed.read = [conventionsPath];
  }

  fs.writeFileSync(confPath, YAML.stringify(parsed), "utf-8");
}

export function removeAiderConfigYaml(confPath: string, conventionsPath: string): boolean {
  if (!fs.existsSync(confPath)) return false;
  try {
    const raw = fs.readFileSync(confPath, "utf-8");
    const parsed = YAML.parse(raw) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== "object") return false;

    let modified = false;
    if (Array.isArray(parsed.read)) {
      const filtered = parsed.read.filter((item) => item !== conventionsPath);
      if (filtered.length !== parsed.read.length) {
        modified = true;
        if (filtered.length > 0) {
          parsed.read = filtered;
        } else {
          delete parsed.read;
        }
      }
    } else if (parsed.read === conventionsPath) {
      delete parsed.read;
      modified = true;
    }

    if (modified) {
      const keys = Object.keys(parsed);
      fs.writeFileSync(confPath, keys.length > 0 ? YAML.stringify(parsed) : "", "utf-8");
    }
    return modified;
  } catch {
    return false;
  }
}

export function hasAiderConfigYaml(confPath: string, conventionsPath: string): boolean {
  if (!fs.existsSync(confPath)) return false;
  try {
    const parsed = YAML.parse(fs.readFileSync(confPath, "utf-8")) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== "object") return false;
    if (Array.isArray(parsed.read)) {
      return parsed.read.includes(conventionsPath);
    }
    return parsed.read === conventionsPath;
  } catch {
    return false;
  }
}

/**
 * Safely upserts `aice` MCP extension in `~/.config/goose/config.yaml`.
 */
export function upsertGooseConfigYaml(configPath: string): void {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  let parsed: Record<string, unknown> = {};
  if (fs.existsSync(configPath)) {
    try {
      const doc = YAML.parse(fs.readFileSync(configPath, "utf-8"));
      if (doc && typeof doc === "object" && !Array.isArray(doc)) {
        parsed = doc as Record<string, unknown>;
      }
    } catch {
      parsed = {};
    }
  }

  const extensions =
    parsed.extensions && typeof parsed.extensions === "object" && !Array.isArray(parsed.extensions)
      ? { ...(parsed.extensions as Record<string, unknown>) }
      : {};
  extensions.aice = {
    name: "aice",
    cmd: "aice",
    args: ["mcp"],
    enabled: true,
    type: "stdio",
  };
  parsed.extensions = extensions;

  fs.writeFileSync(configPath, YAML.stringify(parsed), "utf-8");
}

export function removeGooseConfigYaml(configPath: string): boolean {
  if (!fs.existsSync(configPath)) return false;
  try {
    const parsed = YAML.parse(fs.readFileSync(configPath, "utf-8")) as Record<
      string,
      unknown
    > | null;
    if (!parsed || typeof parsed !== "object") return false;
    const extensions = parsed.extensions as Record<string, unknown> | undefined;
    if (extensions && typeof extensions === "object" && "aice" in extensions) {
      delete extensions.aice;
      fs.writeFileSync(configPath, YAML.stringify(parsed), "utf-8");
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function hasGooseConfigYaml(configPath: string): boolean {
  if (!fs.existsSync(configPath)) return false;
  try {
    const parsed = YAML.parse(fs.readFileSync(configPath, "utf-8")) as Record<
      string,
      unknown
    > | null;
    const extensions = parsed?.extensions as Record<string, unknown> | undefined;
    return Boolean(extensions && typeof extensions === "object" && extensions.aice);
  } catch {
    return false;
  }
}

/**
 * Inspects current status of all supported CLI coding agents.
 */
export function getAgentsStatus(
  options: { homeDir?: string; agent?: string } = {},
): AgentActionResult {
  const home = resolveHomeDir(options.homeDir);
  const requested = options.agent?.toLowerCase().trim();

  const claudeJson = path.join(home, ".claude.json");
  const claudeMd = path.join(home, ".claude", "CLAUDE.md");
  const claudeBin = detectBinary(["claude"]);

  const geminiSettings = path.join(home, ".gemini", "settings.json");
  const geminiMd = path.join(home, ".gemini", "GEMINI.md");
  const agyBin = detectBinary(["agy", "gemini"]);

  const codexToml = path.join(home, ".codex", "config.toml");
  const codexAgentsMd = path.join(home, ".codex", "AGENTS.md");
  const codexBin = detectBinary(["codex"]);

  const opencodeJson = path.join(home, ".config", "opencode", "opencode.json");
  const opencodeAgentsMd = path.join(home, ".config", "opencode", "AGENTS.md");
  const opencodeBin = detectBinary(["opencode"]);

  const aiderConf = path.join(home, ".aider.conf.yml");
  const aiderConventions = path.join(home, ".aider", "CONVENTIONS.md");
  const aiderBin = detectBinary(["aider"]);

  const gooseYaml = path.join(home, ".config", "goose", "config.yaml");
  const gooseBin = detectBinary(["goose"]);

  const cursorMcp = path.join(home, ".cursor", "mcp.json");
  const cursorBin = detectBinary(["cursor"]);

  const agents: AgentStatusEntry[] = [
    {
      id: "claude",
      displayName: "Claude Code (claude)",
      binaryDetected: claudeBin.found,
      binaryPath: claudeBin.path,
      mcpConfigured: hasJsonMcpServer(claudeJson),
      mcpConfigPath: claudeJson,
      promptConfigured: hasMarkdownDirective(claudeMd),
      promptPath: claudeMd,
    },
    {
      id: "agy",
      displayName: "Antigravity / Gemini CLI (agy/gemini)",
      binaryDetected: agyBin.found,
      binaryPath: agyBin.path,
      mcpConfigured: hasJsonMcpServer(geminiSettings),
      mcpConfigPath: geminiSettings,
      promptConfigured: hasMarkdownDirective(geminiMd),
      promptPath: geminiMd,
    },
    {
      id: "codex",
      displayName: "OpenAI Codex CLI (codex)",
      binaryDetected: codexBin.found,
      binaryPath: codexBin.path,
      mcpConfigured: hasCodexToml(codexToml),
      mcpConfigPath: codexToml,
      promptConfigured: hasMarkdownDirective(codexAgentsMd),
      promptPath: codexAgentsMd,
    },
    {
      id: "opencode",
      displayName: "OpenCode (opencode)",
      binaryDetected: opencodeBin.found,
      binaryPath: opencodeBin.path,
      mcpConfigured: hasJsonMcpServer(opencodeJson),
      mcpConfigPath: opencodeJson,
      promptConfigured: hasMarkdownDirective(opencodeAgentsMd),
      promptPath: opencodeAgentsMd,
    },
    {
      id: "aider",
      displayName: "Aider (aider)",
      binaryDetected: aiderBin.found,
      binaryPath: aiderBin.path,
      mcpConfigured: hasAiderConfigYaml(aiderConf, aiderConventions),
      mcpConfigPath: aiderConf,
      promptConfigured: hasMarkdownDirective(aiderConventions),
      promptPath: aiderConventions,
    },
    {
      id: "goose",
      displayName: "Goose CLI (goose)",
      binaryDetected: gooseBin.found,
      binaryPath: gooseBin.path,
      mcpConfigured: hasGooseConfigYaml(gooseYaml),
      mcpConfigPath: gooseYaml,
      promptConfigured: false,
    },
    {
      id: "cursor",
      displayName: "Cursor Agent (cursor)",
      binaryDetected: cursorBin.found,
      binaryPath: cursorBin.path,
      mcpConfigured: hasJsonMcpServer(cursorMcp),
      mcpConfigPath: cursorMcp,
      promptConfigured: false,
    },
  ];

  const filtered = requested
    ? agents.filter((a) => (requested === "gemini" && a.id === "agy") || a.id === requested)
    : agents;

  return { homeDir: home, agents: filtered };
}

/**
 * Configures global MCP and instruction blocks across CLI coding agents idempotently.
 */
export function setupAgents(options: AgentSetupOptions = {}): AgentActionResult {
  const home = resolveHomeDir(options.homeDir);
  const requested = options.agent?.toLowerCase().trim();
  const configureAll = Boolean(options.all);

  const shouldSetup = (id: SupportedAgentId, checkPaths: string[], binNames: string[]): boolean => {
    if (requested) {
      if (requested === "gemini" && id === "agy") return true;
      return requested === id;
    }
    if (configureAll) return true;
    // For primary 5 CLI agents, always set up their user config files so they work out of the box
    if (id === "claude" || id === "agy" || id === "codex" || id === "opencode" || id === "aider") {
      return true;
    }
    // For goose & cursor, set up if config dir exists or binary is installed
    for (const p of checkPaths) {
      if (fs.existsSync(p)) return true;
    }
    return detectBinary(binNames).found;
  };

  // 1. Claude Code
  if (
    shouldSetup("claude", [path.join(home, ".claude"), path.join(home, ".claude.json")], ["claude"])
  ) {
    upsertJsonMcpServer(path.join(home, ".claude.json"));
    const claudeSettings = path.join(home, ".claude", "settings.json");
    if (fs.existsSync(claudeSettings)) {
      upsertJsonMcpServer(claudeSettings);
    }
    upsertMarkdownDirective(path.join(home, ".claude", "CLAUDE.md"));
  }

  // 2. Google Antigravity / Gemini CLI
  if (shouldSetup("agy", [path.join(home, ".gemini")], ["agy", "gemini"])) {
    upsertJsonMcpServer(path.join(home, ".gemini", "settings.json"));
    upsertMarkdownDirective(path.join(home, ".gemini", "GEMINI.md"));
  }

  // 3. OpenAI Codex CLI
  if (shouldSetup("codex", [path.join(home, ".codex")], ["codex"])) {
    upsertCodexToml(path.join(home, ".codex", "config.toml"));
    upsertMarkdownDirective(path.join(home, ".codex", "AGENTS.md"));
    const codexInstr = path.join(home, ".codex", "instructions.md");
    if (fs.existsSync(codexInstr)) {
      upsertMarkdownDirective(codexInstr);
    }
  }

  // 4. OpenCode
  if (shouldSetup("opencode", [path.join(home, ".config", "opencode")], ["opencode"])) {
    upsertJsonMcpServer(path.join(home, ".config", "opencode", "opencode.json"), true);
    upsertMarkdownDirective(path.join(home, ".config", "opencode", "AGENTS.md"));
  }

  // 5. Aider
  if (
    shouldSetup("aider", [path.join(home, ".aider"), path.join(home, ".aider.conf.yml")], ["aider"])
  ) {
    const conventionsPath = path.join(home, ".aider", "CONVENTIONS.md");
    upsertMarkdownDirective(conventionsPath);
    upsertAiderConfigYaml(path.join(home, ".aider.conf.yml"), conventionsPath);
  }

  // 6. Goose
  if (shouldSetup("goose", [path.join(home, ".config", "goose")], ["goose"])) {
    upsertGooseConfigYaml(path.join(home, ".config", "goose", "config.yaml"));
  }

  // 7. Cursor
  if (shouldSetup("cursor", [path.join(home, ".cursor")], ["cursor"])) {
    upsertJsonMcpServer(path.join(home, ".cursor", "mcp.json"));
  }

  return getAgentsStatus({ homeDir: home });
}

/**
 * Cleanly strips AICE directive blocks and MCP entries from all agent configs without losing user settings.
 */
export function removeAgents(
  options: { homeDir?: string; agent?: string } = {},
): AgentActionResult {
  const home = resolveHomeDir(options.homeDir);
  const requested = options.agent?.toLowerCase().trim();

  const matches = (id: SupportedAgentId): boolean => {
    if (!requested) return true;
    if (requested === "gemini" && id === "agy") return true;
    return requested === id;
  };

  if (matches("claude")) {
    removeJsonMcpServer(path.join(home, ".claude.json"));
    removeJsonMcpServer(path.join(home, ".claude", "settings.json"));
    removeMarkdownDirective(path.join(home, ".claude", "CLAUDE.md"));
  }

  if (matches("agy")) {
    removeJsonMcpServer(path.join(home, ".gemini", "settings.json"));
    removeMarkdownDirective(path.join(home, ".gemini", "GEMINI.md"));
  }

  if (matches("codex")) {
    removeCodexToml(path.join(home, ".codex", "config.toml"));
    removeMarkdownDirective(path.join(home, ".codex", "AGENTS.md"));
    removeMarkdownDirective(path.join(home, ".codex", "instructions.md"));
  }

  if (matches("opencode")) {
    removeJsonMcpServer(path.join(home, ".config", "opencode", "opencode.json"));
    removeMarkdownDirective(path.join(home, ".config", "opencode", "AGENTS.md"));
  }

  if (matches("aider")) {
    const conventionsPath = path.join(home, ".aider", "CONVENTIONS.md");
    removeMarkdownDirective(conventionsPath);
    removeAiderConfigYaml(path.join(home, ".aider.conf.yml"), conventionsPath);
  }

  if (matches("goose")) {
    removeGooseConfigYaml(path.join(home, ".config", "goose", "config.yaml"));
  }

  if (matches("cursor")) {
    removeJsonMcpServer(path.join(home, ".cursor", "mcp.json"));
  }

  return getAgentsStatus({ homeDir: home });
}

/**
 * Formats the `aice agents status` terminal table.
 */
export function formatAgentsStatusTable(result: AgentActionResult): string {
  const lines: string[] = [];
  lines.push("================================================================================");
  lines.push(`AICE GLOBAL CLI AGENT INTEGRATION STATUS (Home: ${result.homeDir})`);
  lines.push("================================================================================");
  lines.push(
    `  ${"Agent".padEnd(36)} ${"Binary".padEnd(10)} ${"MCP Config".padEnd(14)} ${"System Prompt".padEnd(14)}`,
  );
  lines.push("--------------------------------------------------------------------------------");
  for (const a of result.agents) {
    const binStr = a.binaryDetected ? "FOUND" : "not in PATH";
    const mcpStr = a.mcpConfigured ? "CONFIGURED" : "not set";
    const promptStr = a.promptPath ? (a.promptConfigured ? "CONFIGURED" : "not set") : "N/A (MCP)";
    lines.push(
      `  ${a.displayName.padEnd(36)} ${binStr.padEnd(10)} ${mcpStr.padEnd(14)} ${promptStr.padEnd(14)}`,
    );
  }
  lines.push("--------------------------------------------------------------------------------");
  lines.push("Commands: `aice agents setup [--all]` | `aice agents status` | `aice agents remove`");
  return lines.join("\n");
}
