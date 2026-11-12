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
import {
  AICE_DIRECTIVE_END,
  AICE_DIRECTIVE_START,
  AICE_SYSTEM_DIRECTIVE,
  ALWAYS_ON_AICE_RULE_FILE,
  CANONICAL_AICE_AGENT_DIRECTIVE,
  findDirectiveSpanOutsideFences,
  hasMarkdownDirective,
  removeAlwaysOnRuleFile,
  removeMarkdownDirective,
  SUPPORTED_EXTENSIONS_LIST,
  stripJsonComments,
  syncProjectWorkspaceRules,
  upsertAlwaysOnRuleFile,
  upsertMarkdownDirective,
  writeFileAtomic,
} from "../config/index.js";

export {
  AICE_DIRECTIVE_END,
  AICE_DIRECTIVE_START,
  AICE_SYSTEM_DIRECTIVE,
  ALWAYS_ON_AICE_RULE_FILE,
  CANONICAL_AICE_AGENT_DIRECTIVE,
  hasMarkdownDirective,
  removeAlwaysOnRuleFile,
  removeMarkdownDirective,
  SUPPORTED_EXTENSIONS_LIST,
  syncProjectWorkspaceRules,
  upsertAlwaysOnRuleFile,
  upsertMarkdownDirective,
};

import { AICE_VERSION, VERSION } from "../version.js";

export { VERSION };

export function extractMarkdownDirectiveVersion(filePath: string): string | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  try {
    const text = fs.readFileSync(filePath, "utf-8");
    const span = findDirectiveSpanOutsideFences(text);
    const activeSlice = span ? text.slice(span.startIdx, span.endOffset) : "";
    if (!activeSlice) return undefined;
    const verMatch = activeSlice.match(/<!--\s*AICE:START\s+v([0-9A-Za-z._-]+)\s*-->/);
    if (verMatch?.[1]) return verMatch[1];
    const headingMatch = activeSlice.match(/##\s+AICE\s+2\.0\s+\(v([0-9A-Za-z._-]+)\)/);
    if (headingMatch?.[1]) return headingMatch[1];
    if (activeSlice.includes(AICE_DIRECTIVE_START)) return "legacy";
    return undefined;
  } catch {
    return undefined;
  }
}

export type SupportedAgentId =
  | "claude"
  | "agy"
  | "gemini"
  | "codex"
  | "opencode"
  | "aider"
  | "goose"
  | "cursor";

export interface AgentStatusEntry {
  id: SupportedAgentId;
  displayName: string;
  binaryDetected: boolean;
  binaryPath?: string;
  mcpConfigured: boolean;
  mcpConfigPath: string;
  promptConfigured: boolean;
  promptPath?: string;
  rulesVersion?: string;
  rulesUpToDate?: boolean;
  error?: string;
}

export interface AgentSetupOptions {
  homeDir?: string;
  all?: boolean;
  agent?: string;
  globalRules?: boolean;
}

export interface AgentActionResult {
  homeDir: string;
  version: string;
  allRulesUpToDate: boolean;
  updateRecommendation?: string;
  agents: AgentStatusEntry[];
}

function resolveHomeDir(homeDir?: string): string {
  if (homeDir) return path.resolve(homeDir);
  if (process.env.AICE_AGENT_HOME) return path.resolve(process.env.AICE_AGENT_HOME);
  return os.homedir();
}

function detectBinary(binNames: string[]): { found: boolean; path?: string } {
  const lookupCmd = process.platform === "win32" ? "where" : "which";
  for (const name of binNames) {
    try {
      const res = spawnSync(lookupCmd, [name], { encoding: "utf-8", timeout: 1500 });
      if (res.status === 0 && res.stdout && res.stdout.trim()) {
        return { found: true, path: res.stdout.trim().split(/\r?\n/)[0]?.trim() };
      }
    } catch {
      // ignore
    }
  }
  return { found: false };
}

/**
 * Safely merges `"mcpServers": { "aice": { "command": "aice", "args": ["mcp"] } }` into a JSON file.
 */
export function upsertJsonMcpServer(filePath: string, alsoSetMcpKey = false): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  let data: Record<string, unknown> = {};
  if (fs.existsSync(filePath)) {
    try {
      const raw = stripJsonComments(fs.readFileSync(filePath, "utf-8")).trim();
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          data = parsed as Record<string, unknown>;
        } else {
          throw new Error("Root JSON value is not an object");
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

  writeFileAtomic(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

export function removeJsonMcpServer(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  try {
    const raw = stripJsonComments(fs.readFileSync(filePath, "utf-8")).trim();
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
      writeFileAtomic(filePath, `${JSON.stringify(data, null, 2)}\n`);
    }
    return modified;
  } catch {
    return false;
  }
}

export function hasJsonMcpServer(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  try {
    const raw = stripJsonComments(fs.readFileSync(filePath, "utf-8")).trim();
    if (!raw) return false;
    const data = JSON.parse(raw) as Record<string, unknown>;
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

function isTomlTableHeader(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed === '["mcp"]') return false;
  return /^\[[^[\]]+\](?:\s*#.*)?$/.test(trimmed) || /^\[\[[^[\]]+\]\](?:\s*#.*)?$/.test(trimmed);
}

function isAiceTomlTableHeader(line: string): boolean {
  return /^\[mcp_servers\.aice\](?:\s*#.*)?$/.test(line.trim());
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

  const sectionLines = ["[mcp_servers.aice]", 'command = "aice"', 'args = ["mcp"]'];
  const lines = existing.split(/\r?\n/);
  const out: string[] = [];
  let inAiceSection = false;
  let replaced = false;

  for (const line of lines) {
    if (isAiceTomlTableHeader(line)) {
      inAiceSection = true;
      if (!replaced) {
        out.push(...sectionLines);
        replaced = true;
      }
      continue;
    }
    if (inAiceSection) {
      if (isTomlTableHeader(line)) {
        inAiceSection = false;
        if (out.length > 0 && out[out.length - 1] !== "") {
          out.push("");
        }
        out.push(line);
      }
      continue;
    }
    out.push(line);
  }

  if (replaced) {
    writeFileAtomic(filePath, `${out.join("\n").trimEnd()}\n`);
    return;
  }

  const trimmed = existing.trimEnd();
  const sectionBlock = sectionLines.join("\n");
  const updated = trimmed ? `${trimmed}\n\n${sectionBlock}\n` : `${sectionBlock}\n`;
  writeFileAtomic(filePath, updated);
}

export function removeCodexToml(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  const existing = fs.readFileSync(filePath, "utf-8");
  const lines = existing.split(/\r?\n/);
  const out: string[] = [];
  let inAiceSection = false;
  let found = false;

  for (const line of lines) {
    if (isAiceTomlTableHeader(line)) {
      inAiceSection = true;
      found = true;
      continue;
    }
    if (inAiceSection) {
      if (isTomlTableHeader(line)) {
        inAiceSection = false;
        out.push(line);
      }
      continue;
    }
    out.push(line);
  }

  if (!found) return false;
  const updated = out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  writeFileAtomic(filePath, updated ? `${updated}\n` : "");
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
    const raw = fs.readFileSync(confPath, "utf-8");
    if (raw.trim().length > 0) {
      let doc: unknown;
      try {
        doc = YAML.parse(raw);
      } catch (err) {
        throw new Error(
          `Cannot merge AICE conventions into malformed YAML file ${confPath}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      if (doc !== null && doc !== undefined) {
        if (typeof doc !== "object" || Array.isArray(doc)) {
          throw new Error(
            `Cannot merge AICE conventions into malformed YAML file ${confPath}: root YAML value must be a mapping`,
          );
        }
        parsed = doc as Record<string, unknown>;
      }
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

  writeFileAtomic(confPath, YAML.stringify(parsed));
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
      writeFileAtomic(confPath, keys.length > 0 ? YAML.stringify(parsed) : "");
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
    const raw = fs.readFileSync(configPath, "utf-8");
    if (raw.trim().length > 0) {
      let doc: unknown;
      try {
        doc = YAML.parse(raw);
      } catch (err) {
        throw new Error(
          `Cannot merge AICE MCP extension into malformed YAML file ${configPath}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      if (doc !== null && doc !== undefined) {
        if (typeof doc !== "object" || Array.isArray(doc)) {
          throw new Error(
            `Cannot merge AICE MCP extension into malformed YAML file ${configPath}: root YAML value must be a mapping`,
          );
        }
        parsed = doc as Record<string, unknown>;
      }
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

  writeFileAtomic(configPath, YAML.stringify(parsed));
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
      writeFileAtomic(configPath, YAML.stringify(parsed));
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
  const agyMcpConfig = path.join(home, ".gemini", "config", "mcp_config.json");
  const agyRuleMd = path.join(home, ".gemini", "config", "rules", "aice.md");
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

  const buildPromptMeta = (pPath: string, configured: boolean) => {
    if (!configured) return {};
    const rulesVersion = extractMarkdownDirectiveVersion(pPath);
    return {
      rulesVersion,
      rulesUpToDate: rulesVersion === AICE_VERSION,
    };
  };

  const claudePromptOk = hasMarkdownDirective(claudeMd);
  const agyPromptOk = hasMarkdownDirective(geminiMd) && hasMarkdownDirective(agyRuleMd);
  const codexPromptOk = hasMarkdownDirective(codexAgentsMd);
  const opencodePromptOk = hasMarkdownDirective(opencodeAgentsMd);
  const aiderPromptOk = hasMarkdownDirective(aiderConventions);

  const agents: AgentStatusEntry[] = [
    {
      id: "claude",
      displayName: "Claude Code (claude)",
      binaryDetected: claudeBin.found,
      binaryPath: claudeBin.path,
      mcpConfigured: hasJsonMcpServer(claudeJson),
      mcpConfigPath: claudeJson,
      promptConfigured: claudePromptOk,
      promptPath: claudeMd,
      ...buildPromptMeta(claudeMd, claudePromptOk),
    },
    {
      id: "agy",
      displayName: "Antigravity / Gemini CLI (agy/gemini)",
      binaryDetected: agyBin.found,
      binaryPath: agyBin.path,
      mcpConfigured: hasJsonMcpServer(geminiSettings) && hasJsonMcpServer(agyMcpConfig),
      mcpConfigPath: agyMcpConfig,
      promptConfigured: agyPromptOk,
      promptPath: geminiMd,
      ...buildPromptMeta(geminiMd, agyPromptOk),
    },
    {
      id: "codex",
      displayName: "OpenAI Codex CLI (codex)",
      binaryDetected: codexBin.found,
      binaryPath: codexBin.path,
      mcpConfigured: hasCodexToml(codexToml),
      mcpConfigPath: codexToml,
      promptConfigured: codexPromptOk,
      promptPath: codexAgentsMd,
      ...buildPromptMeta(codexAgentsMd, codexPromptOk),
    },
    {
      id: "opencode",
      displayName: "OpenCode (opencode)",
      binaryDetected: opencodeBin.found,
      binaryPath: opencodeBin.path,
      mcpConfigured: hasJsonMcpServer(opencodeJson),
      mcpConfigPath: opencodeJson,
      promptConfigured: opencodePromptOk,
      promptPath: opencodeAgentsMd,
      ...buildPromptMeta(opencodeAgentsMd, opencodePromptOk),
    },
    {
      id: "aider",
      displayName: "Aider (aider)",
      binaryDetected: aiderBin.found,
      binaryPath: aiderBin.path,
      mcpConfigured: hasAiderConfigYaml(aiderConf, aiderConventions),
      mcpConfigPath: aiderConf,
      promptConfigured: aiderPromptOk,
      promptPath: aiderConventions,
      ...buildPromptMeta(aiderConventions, aiderPromptOk),
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

  const configuredPrompts = filtered.filter((a) => a.promptPath && a.promptConfigured);
  const anyPromptOutdated = configuredPrompts.some((a) => a.rulesUpToDate === false);
  const allRulesUpToDate = !anyPromptOutdated;

  return {
    homeDir: home,
    version: AICE_VERSION,
    allRulesUpToDate,
    ...(allRulesUpToDate
      ? {}
      : {
          updateRecommendation: `Run './install.sh -y' or 'aice agents setup' to refresh agent rules to v${AICE_VERSION}`,
        }),
    agents: filtered,
  };
}

/**
 * Configures global MCP and instruction blocks across CLI coding agents idempotently.
 */
export function setupAgents(options: AgentSetupOptions = {}): AgentActionResult {
  const home = resolveHomeDir(options.homeDir);
  const requested = options.agent?.toLowerCase().trim();
  const configureAll = Boolean(options.all);
  const writeGlobalRules = Boolean(options.globalRules);

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

  const errors = new Map<SupportedAgentId, string>();
  const runSafe = (id: SupportedAgentId, fn: () => void) => {
    try {
      fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const prev = errors.get(id);
      errors.set(id, prev ? `${prev}; ${msg}` : msg);
    }
  };

  // 1. Claude Code
  if (
    shouldSetup("claude", [path.join(home, ".claude"), path.join(home, ".claude.json")], ["claude"])
  ) {
    runSafe("claude", () => upsertJsonMcpServer(path.join(home, ".claude.json")));
    const claudeSettings = path.join(home, ".claude", "settings.json");
    if (fs.existsSync(claudeSettings)) {
      runSafe("claude", () => upsertJsonMcpServer(claudeSettings));
    }
    if (writeGlobalRules) {
      runSafe("claude", () => upsertMarkdownDirective(path.join(home, ".claude", "CLAUDE.md")));
    }
  }

  // 2. Google Antigravity / Gemini CLI
  if (
    shouldSetup(
      "agy",
      [path.join(home, ".gemini"), path.join(home, ".gemini", "config", "mcp_config.json")],
      ["agy", "gemini"],
    )
  ) {
    runSafe("agy", () => upsertJsonMcpServer(path.join(home, ".gemini", "settings.json")));
    runSafe("agy", () =>
      upsertJsonMcpServer(path.join(home, ".gemini", "config", "mcp_config.json")),
    );
    if (writeGlobalRules) {
      runSafe("agy", () => upsertMarkdownDirective(path.join(home, ".gemini", "GEMINI.md")));
      runSafe("agy", () =>
        upsertAlwaysOnRuleFile(path.join(home, ".gemini", "config", "rules", "aice.md")),
      );
    }
  }

  // 3. OpenAI Codex CLI
  if (shouldSetup("codex", [path.join(home, ".codex")], ["codex"])) {
    runSafe("codex", () => upsertCodexToml(path.join(home, ".codex", "config.toml")));
    if (writeGlobalRules) {
      runSafe("codex", () => upsertMarkdownDirective(path.join(home, ".codex", "AGENTS.md")));
      const codexInstr = path.join(home, ".codex", "instructions.md");
      if (fs.existsSync(codexInstr)) {
        runSafe("codex", () => upsertMarkdownDirective(codexInstr));
      }
    }
  }

  // 4. OpenCode
  if (shouldSetup("opencode", [path.join(home, ".config", "opencode")], ["opencode"])) {
    runSafe("opencode", () =>
      upsertJsonMcpServer(path.join(home, ".config", "opencode", "opencode.json"), true),
    );
    if (writeGlobalRules) {
      runSafe("opencode", () =>
        upsertMarkdownDirective(path.join(home, ".config", "opencode", "AGENTS.md")),
      );
    }
  }

  // 5. Aider
  if (
    shouldSetup("aider", [path.join(home, ".aider"), path.join(home, ".aider.conf.yml")], ["aider"])
  ) {
    const conventionsPath = path.join(home, ".aider", "CONVENTIONS.md");
    if (writeGlobalRules) {
      runSafe("aider", () => upsertMarkdownDirective(conventionsPath));
    }
    runSafe("aider", () =>
      upsertAiderConfigYaml(path.join(home, ".aider.conf.yml"), conventionsPath),
    );
  }

  // 6. Goose
  if (shouldSetup("goose", [path.join(home, ".config", "goose")], ["goose"])) {
    runSafe("goose", () => {
      upsertGooseConfigYaml(path.join(home, ".config", "goose", "config.yaml"));
    });
  }

  // 7. Cursor
  if (shouldSetup("cursor", [path.join(home, ".cursor")], ["cursor"])) {
    runSafe("cursor", () => {
      upsertJsonMcpServer(path.join(home, ".cursor", "mcp.json"));
    });
  }

  const res = getAgentsStatus({ homeDir: home, agent: options.agent });
  for (const entry of res.agents) {
    const err = errors.get(entry.id);
    if (err) {
      entry.error = err;
    }
  }
  return res;
}

/**
 * Cleanly strips AICE directive blocks and MCP entries from all agent configs without losing user settings.
 */
export function removeAgents(
  options: { homeDir?: string; agent?: string } = {},
): AgentActionResult {
  const home = resolveHomeDir(options.homeDir);
  const requested = options.agent?.toLowerCase().trim();
  const errors = new Map<SupportedAgentId, string>();

  const matches = (id: SupportedAgentId): boolean => {
    if (!requested) return true;
    if (requested === "gemini" && id === "agy") return true;
    return requested === id;
  };

  const runSafe = (id: SupportedAgentId, fn: () => void) => {
    try {
      fn();
    } catch (err) {
      errors.set(id, err instanceof Error ? err.message : String(err));
    }
  };

  if (matches("claude")) {
    runSafe("claude", () => {
      removeJsonMcpServer(path.join(home, ".claude.json"));
      removeJsonMcpServer(path.join(home, ".claude", "settings.json"));
      removeMarkdownDirective(path.join(home, ".claude", "CLAUDE.md"));
    });
  }

  if (matches("agy")) {
    runSafe("agy", () => {
      removeJsonMcpServer(path.join(home, ".gemini", "settings.json"));
      removeJsonMcpServer(path.join(home, ".gemini", "config", "mcp_config.json"));
      removeMarkdownDirective(path.join(home, ".gemini", "GEMINI.md"));
      removeAlwaysOnRuleFile(path.join(home, ".gemini", "config", "rules", "aice.md"));
    });
  }

  if (matches("codex")) {
    runSafe("codex", () => {
      removeCodexToml(path.join(home, ".codex", "config.toml"));
      removeMarkdownDirective(path.join(home, ".codex", "AGENTS.md"));
      removeMarkdownDirective(path.join(home, ".codex", "instructions.md"));
    });
  }

  if (matches("opencode")) {
    runSafe("opencode", () => {
      removeJsonMcpServer(path.join(home, ".config", "opencode", "opencode.json"));
      removeMarkdownDirective(path.join(home, ".config", "opencode", "AGENTS.md"));
    });
  }

  if (matches("aider")) {
    runSafe("aider", () => {
      const conventionsPath = path.join(home, ".aider", "CONVENTIONS.md");
      removeMarkdownDirective(conventionsPath);
      removeAiderConfigYaml(path.join(home, ".aider.conf.yml"), conventionsPath);
    });
  }

  if (matches("goose")) {
    runSafe("goose", () => {
      removeGooseConfigYaml(path.join(home, ".config", "goose", "config.yaml"));
    });
  }

  if (matches("cursor")) {
    runSafe("cursor", () => {
      removeJsonMcpServer(path.join(home, ".cursor", "mcp.json"));
    });
  }

  const res = getAgentsStatus({ homeDir: home, agent: options.agent });
  for (const entry of res.agents) {
    const err = errors.get(entry.id);
    if (err) {
      entry.error = err;
    }
  }
  return res;
}

/**
 * Formats the `aice agents status` terminal table.
 */
export function formatAgentsStatusTable(result: AgentActionResult): string {
  const lines: string[] = [];
  const ver = result.version ?? AICE_VERSION;
  lines.push("================================================================================");
  lines.push(`AICE v${ver} GLOBAL CLI AGENT INTEGRATION STATUS (Home: ${result.homeDir})`);
  lines.push("================================================================================");
  lines.push(
    `  ${"Agent".padEnd(36)} ${"Binary".padEnd(10)} ${"MCP Config".padEnd(14)} ${"System Prompt"}`,
  );
  lines.push("--------------------------------------------------------------------------------");
  for (const a of result.agents) {
    const binStr = a.binaryDetected ? "FOUND" : "not in PATH";
    const mcpStr = a.mcpConfigured ? "CONFIGURED" : "not set";
    const promptStr = a.promptPath
      ? a.promptConfigured
        ? a.rulesUpToDate === false
          ? `OUTDATED (v${a.rulesVersion ?? "old"} -> v${ver})`
          : `CONFIGURED (v${a.rulesVersion ?? ver})`
        : "not set (project-scoped)"
      : "N/A (MCP)";
    lines.push(
      `  ${a.displayName.padEnd(36)} ${binStr.padEnd(10)} ${mcpStr.padEnd(14)} ${promptStr}`,
    );
    if (a.error) {
      lines.push(`    ! Warning: ${a.error}`);
    }
  }
  lines.push("--------------------------------------------------------------------------------");
  if (result.allRulesUpToDate) {
    if (result.agents.some((a) => a.promptConfigured)) {
      lines.push(`Rules Status: UP TO DATE (v${ver})`);
    } else {
      lines.push(`Rules Status: PROJECT-SCOPED (active in workspaces with aice.config.json)`);
    }
  } else if (result.updateRecommendation) {
    lines.push(`Rules Status: UPDATE AVAILABLE -> ${result.updateRecommendation}`);
  }
  lines.push(
    "Commands: `aice agents setup [--all] [--global-rules]` | `aice agents status` | `aice agents remove` | `./install.sh -y`",
  );
  return lines.join("\n");
}
