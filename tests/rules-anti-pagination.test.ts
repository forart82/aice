import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stripAllMarkdownDirectives } from "../src/config/project-config.js";
import {
  AICE_DIRECTIVE_END,
  AICE_DIRECTIVE_START,
  MANDATORY_AGENT_RULES_MARKDOWN,
} from "../src/rules/mandatory-rules.js";
import { estimateTokens, TiktokenTokenizer } from "../src/tokenomics/index.js";
import { AICE_VERSION } from "../src/version.js";

const REPO_ROOT = process.cwd();
const CLI_DIST = path.resolve(REPO_ROOT, "dist", "aice.mjs");
const CLI_TS = path.resolve(REPO_ROOT, "bin", "aice.ts");
const TSX_BIN = path.resolve(
  REPO_ROOT,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "tsx.cmd" : "tsx",
);

const V0950_BLOCK = [
  "<!-- AICE:START -->",
  "<!-- AICE:START v0.9.50 -->",
  "## AICE (v0.9.50) — 2-Tool AST Cheat-Card",
  "**MANDATORY OVERRIDE**: Active across all 33 supported file extensions (code, .sh, .bash, .zsh, .ps1, .cmd, .bat, .md, .markdown, .aipl): use ONLY `aice read`/`search`/`find` (MCP `aice_read`) & `aice splice`/`aice write` (MCP `aice_splice`), never native file tools.",
  "### 1. Opt-In Activation Gate & Non-AICE Bypass",
  '- Gate: Active ONLY when `aice.config.json` has `"enabled": true`; skip if missing/false. `$idioms` OFF (`--idioms` opt-in).',
  "- Bypass: Board-only swarm monitors/coordinators & non-file Q&A have zero overhead.",
  "- Fallback: Crash/blocker -> `aice disable` -> native tools -> `aice enable`.",
  "### 2. Batch Read & Splice (No Shell Workarounds)",
  "- Ban: No shell writes (`python3 with open`, `cat << 'EOF' >`, `echo >`); NEVER run `sed -n` or grep/awk/head/tail/cat/ls/find on supported files.",
  "- Read (`<=9KB` / `~145L`/call on CLI & MCP): Prefer 1-turn numbered native `aice read src tests`, `aice read f1:sym f2:L1-L50` (Adaptive Sibling Outlining), `aice search <pat> [dir]`.",
  "- Splice: Prefer 1-call `aice splice --stdin << 'EOF'` with `=== <file> ===`, `:symbol`, `:Lstart-Lend`, `<<< === >>>`, `:eof`, `:imports`.",
  "### 3. Subagent Propagation",
  '- Coding subagents/`swarm add` briefs MUST state: `"Use AICE (aice read / aice splice) for all file exploration and edits."`',
  "<!-- AICE:END -->",
].join("\n");

const V0951_BLOCK = [
  "<!-- AICE:START v0.9.51 -->",
  "## AICE (v0.9.51)",
  '- Gate: ONLY if `aice.config.json` has `"enabled": true` (code/config/md + passthrough/extensionless). Blocker: `aice disable`/`aice enable`.',
  "### 2. Batch Read & Splice (No Shell Workarounds)",
  "- ONLY `aice read`/`search`/`find` (`aice_read`) & `aice splice`/`aice write` (`aice_splice`); no shell writes or `sed`/`grep`/`cat`/`find`.",
  "- Read: `aice read f1:sym f2:L1-L50`, quote `'f:/a|b/'` (no bash `exit 127`), `aice search <pat> [dir]`, `aice find -d 2`.",
  "- Splice: `aice splice --stdin << 'EOF'` `=== f:sym ===`, `=== f:L1-L20 ===` (`--delete`, `=== f ===`), multi-line `<<<`/`===`/`>>>` (no 1L `<<< === >>>`).",
  '- Briefs: `"Use AICE (aice read / aice splice) for all file exploration and edits."`',
  "<!-- AICE:END -->",
].join("\n");

interface RealProjectLayoutSpec {
  name: "skeleton" | "ovh" | "ts_3d_world";
  livePath: string;
  requiredPreservedSnippets: string[];
  fallbackDoc: string;
}

const REAL_PROJECT_LAYOUTS: RealProjectLayoutSpec[] = [
  {
    name: "skeleton",
    livePath: "/home/forart/dev/skeleton/AGENTS.md",
    requiredPreservedSnippets: [
      "# Autonomous AI Agent Protocol 5.0: {{PROJECT_NAME}}",
      "## 1. Executive Summary & Core Directive",
      "## 2. The 36 Golden Architectural & Operational Rules",
    ],
    fallbackDoc: [
      "# Autonomous AI Agent Protocol 5.0: {{PROJECT_NAME}}",
      "",
      V0950_BLOCK,
      "",
      "> **Protocol Version:** 5.0 — Enterprise Autonomous Agent Governance & AI-First Language Standard",
      "",
      "## 1. Executive Summary & Core Directive",
      "Binding standard for autonomous AI agents and engineers.",
      "",
      "## 2. The 36 Golden Architectural & Operational Rules",
      "### Rule 1: The Zero-Code Without Test Policy",
      "",
    ].join("\n"),
  },
  {
    name: "ovh",
    livePath: "/home/forart/dev/ovh/AGENTS.md",
    requiredPreservedSnippets: [
      "# Agent Governance & Global Guardrails",
      "## Critical Inviolable Financial Safeguards",
      "NEVER Search for Paid Solutions",
      "## Role Reference",
    ],
    fallbackDoc: [
      "# Agent Governance & Global Guardrails",
      "",
      V0950_BLOCK,
      "",
      "## Critical Inviolable Financial Safeguards",
      "> [!CAUTION]",
      "> 1. **NEVER Search for Paid Solutions:**",
      "> 2. **NEVER Validate or Process Payments:**",
      "",
      "## Role Reference",
      "See GEMINI.md for full operational scope.",
      "",
    ].join("\n"),
  },
  {
    name: "ts_3d_world",
    livePath: "/home/forart/dev/ts_3d_world/AGENTS.md",
    requiredPreservedSnippets: [
      "# Autonomous AI Agent Protocol 5.0: Ts 3D World",
      "## 1. Executive Summary & Core Directive",
    ],
    fallbackDoc: [
      "# Autonomous AI Agent Protocol 5.0: Ts 3D World",
      "",
      V0950_BLOCK,
      "",
      "> **Protocol Version:** 5.0 — Enterprise Autonomous Agent Governance & AI-First Language Standard",
      "",
      "## 1. Executive Summary & Core Directive",
      "Binding standard for autonomous AI agents in Ts 3D World.",
      "",
    ].join("\n"),
  },
];

function runAiceCli(args: string[], cwd: string, telemetryDir: string) {
  const useDist = fs.existsSync(CLI_DIST);
  const cmd = useDist ? process.execPath : TSX_BIN;
  const fullArgs = useDist ? [CLI_DIST, ...args] : [CLI_TS, ...args];
  return spawnSync(cmd, fullArgs, {
    cwd,
    encoding: "utf-8",
    timeout: 30000,
    env: {
      ...process.env,
      AICE_TELEMETRY_DIR: telemetryDir,
    },
  });
}

function loadLayoutWithBlock(spec: RealProjectLayoutSpec, injectedBlock: string): string {
  const rawSource = fs.existsSync(spec.livePath)
    ? fs.readFileSync(spec.livePath, "utf-8")
    : spec.fallbackDoc;
  const { stripped } = stripAllMarkdownDirectives(rawSource);
  const headingMatch = stripped.match(/^(\s*#[ \t]+[^\r\n]+)/);
  if (headingMatch) {
    const heading = headingMatch[0].trim();
    const rest = stripped.slice(headingMatch[0].length).trim();
    return `${heading}\n\n${injectedBlock}\n\n${rest}\n`;
  }
  return `${injectedBlock}\n\n${stripped}\n`;
}

function extractAiceBlock(markdown: string): string {
  const startIdx = markdown.indexOf(AICE_DIRECTIVE_START);
  const endIdx = markdown.indexOf(AICE_DIRECTIVE_END);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    return "";
  }
  return markdown.slice(startIdx, endIdx + AICE_DIRECTIVE_END.length);
}

describe("v0.9.52 Anti-Pagination Mandatory Rules, Real-World AGENTS.md Upgrades & Docs", () => {
  let tmpRoot: string;
  let telemetryDir: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aice-rules-antipaging-"));
    telemetryDir = path.join(tmpRoot, "telemetry");
    fs.mkdirSync(telemetryDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("enforces >= v0.9.52 marker, workspace AGENTS.md parity, anti-pagination directive, and <= 300 cl100k/o200k token budget", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf-8")) as {
      version: string;
    };
    expect(AICE_VERSION).toBe(pkg.version);

    const [major, minor, patch] = AICE_VERSION.split(".").map(Number);
    expect(major * 10000 + minor * 100 + patch).toBeGreaterThanOrEqual(952);
    expect(AICE_DIRECTIVE_START).toBe(`<!-- AICE:START v${AICE_VERSION} -->`);

    const startMarkers = MANDATORY_AGENT_RULES_MARKDOWN.match(/<!--\s*AICE:START[^>]*-->/g) ?? [];
    expect(startMarkers).toEqual([`<!-- AICE:START v${AICE_VERSION} -->`]);
    expect(MANDATORY_AGENT_RULES_MARKDOWN.endsWith(AICE_DIRECTIVE_END)).toBe(true);

    // Explicit 1-line anti-pagination rule invariants
    expect(MANDATORY_AGENT_RULES_MARKDOWN).toContain("NEVER walk `:L1-L150` -> `:L151-L300`");
    expect(MANDATORY_AGENT_RULES_MARKDOWN).toContain("batch `f:sym1 f:sym2`");
    expect(MANDATORY_AGENT_RULES_MARKDOWN).toContain("1 `aice read`");
    expect(MANDATORY_AGENT_RULES_MARKDOWN).toContain("`aice search <pat> f`");

    const noPagingLines = MANDATORY_AGENT_RULES_MARKDOWN.split("\n").filter((l) =>
      l.startsWith("- No paging:"),
    );
    expect(noPagingLines).toHaveLength(1);

    // Compact byte & BPE token ceiling so ruleReplayTax stays minimal
    const byteCount = Buffer.byteLength(MANDATORY_AGENT_RULES_MARKDOWN, "utf-8");
    const cl100k = TiktokenTokenizer.count(MANDATORY_AGENT_RULES_MARKDOWN, "cl100k_base");
    const o200k = TiktokenTokenizer.count(MANDATORY_AGENT_RULES_MARKDOWN, "o200k_base");
    expect(byteCount).toBeLessThanOrEqual(900);
    expect(cl100k).toBeLessThanOrEqual(300);
    expect(o200k).toBeLessThanOrEqual(300);
    expect(estimateTokens(MANDATORY_AGENT_RULES_MARKDOWN, "cl100k_base")).toBeLessThanOrEqual(300);
    expect(estimateTokens(MANDATORY_AGENT_RULES_MARKDOWN, "o200k_base")).toBeLessThanOrEqual(300);

    // Workspace AGENTS.md must match exact generator output
    const repoAgentsMd = fs.readFileSync(path.join(REPO_ROOT, "AGENTS.md"), "utf-8");
    expect(repoAgentsMd).toBe(`${MANDATORY_AGENT_RULES_MARKDOWN}\n`);
  });

  it.each(REAL_PROJECT_LAYOUTS)(
    "idempotently upgrades $name AGENTS.md from both v0.9.50 and v0.9.51 via `aice enable` in /tmp without losing user content",
    (spec) => {
      for (const [legacyLabel, legacyBlock] of [
        ["v0.9.50", V0950_BLOCK],
        ["v0.9.51", V0951_BLOCK],
      ] as const) {
        const sandboxDir = path.join(tmpRoot, `${spec.name}-${legacyLabel}`);
        fs.mkdirSync(sandboxDir, { recursive: true });
        const agentsMdPath = path.join(sandboxDir, "AGENTS.md");

        const seededContent = loadLayoutWithBlock(spec, legacyBlock);
        fs.writeFileSync(agentsMdPath, seededContent, "utf-8");
        const baselineStripped = stripAllMarkdownDirectives(seededContent).stripped;

        // First `aice enable`: upgrades v0.9.50 / v0.9.51 -> v0.9.52+
        const enable1 = runAiceCli(["enable", sandboxDir], sandboxDir, telemetryDir);
        expect(
          enable1.status,
          `${spec.name} (${legacyLabel}) enable #1 stderr: ${enable1.stderr}`,
        ).toBe(0);

        const after1 = fs.readFileSync(agentsMdPath, "utf-8");
        const startMarkers = after1.match(/<!--\s*AICE:START[^>]*-->/g) ?? [];
        const endMarkers = after1.match(/<!--\s*AICE:END\s*-->/g) ?? [];
        expect(startMarkers).toEqual([`<!-- AICE:START v${AICE_VERSION} -->`]);
        expect(endMarkers).toHaveLength(1);
        expect(after1).not.toContain("v0.9.50");
        expect(after1).not.toContain("v0.9.51");

        const extractedBlock = extractAiceBlock(after1);
        expect(extractedBlock).toBe(MANDATORY_AGENT_RULES_MARKDOWN);
        expect(TiktokenTokenizer.count(extractedBlock, "cl100k_base")).toBeLessThanOrEqual(300);

        // Non-AICE project sections must be preserved intact
        for (const snippet of spec.requiredPreservedSnippets) {
          expect(after1).toContain(snippet);
        }
        expect(stripAllMarkdownDirectives(after1).stripped).toBe(baselineStripped);

        // Second & third `aice enable`: strict byte-for-byte idempotency
        const enable2 = runAiceCli(["enable", sandboxDir], sandboxDir, telemetryDir);
        expect(enable2.status).toBe(0);
        const after2 = fs.readFileSync(agentsMdPath, "utf-8");
        expect(after2).toBe(after1);

        const enable3 = runAiceCli(["enable", sandboxDir], sandboxDir, telemetryDir);
        expect(enable3.status).toBe(0);
        const after3 = fs.readFileSync(agentsMdPath, "utf-8");
        expect(after3).toBe(after1);
      }
    },
  );

  it("documents v0.9.52 anti-pagination symbol/search hints, 1-turn batch packing, and <= 300-token AGENTS.md rule in README.md", () => {
    const readme = fs.readFileSync(path.join(REPO_ROOT, "README.md"), "utf-8");
    expect(readme).toContain(`Version: ${AICE_VERSION}`);
    expect(readme).toContain(
      "batch symbols: aice read <file>:<sym1> <file>:<sym2> or aice search <pat> <file>",
    );
    expect(readme).toContain("aice read f1:sym f2 f3");
    expect(readme).toContain(":L1-L150");
    expect(readme).toContain(":L151-L300");
    expect(readme).toContain("<= 300");
  });
});
