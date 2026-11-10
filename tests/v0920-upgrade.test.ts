import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  formatAgentsStatusTable,
  getAgentsStatus,
  setupAgents,
  VERSION,
} from "../src/agents/index.js";
import { KNOWN_TARGET_EXTENSIONS } from "../src/config/path-resolver.js";
import { detectTargetFromPath } from "../src/emitters/index.js";
import { AICE_VERSION } from "../src/mcp/server.js";
import { MANDATORY_AGENT_RULES_MARKDOWN } from "../src/rules/mandatory-rules.js";
import {
  createBatch,
  generateContext,
  generateOutline,
  generateWorkspaceContext,
  outlinePath,
  PREPROCESSORS_BY_LANG,
  splice,
  spliceBatch,
} from "../src/tools/index.js";

describe("AICE v0.9.20 Real-World Readiness, Script/Markdown Dialect & Auto-Update Upgrade", () => {
  describe("Step 1: Named test / it / describe AST Symbols (outline, context, splice)", () => {
    const sampleTestSource = [
      'import { describe, expect, it, test } from "vitest";',
      "",
      'describe("Menu & Swarm Suite", () => {',
      '  test("TC-MENU-001: GameApp initializes at 60Hz with deterministic seed", () => {',
      "    const fps = 60;",
      "    expect(fps).toBe(60);",
      "  });",
      "",
      '  it("TC-SWARM-009: handles empty swarm without NaN velocity", () => {',
      "    const velocity = 0;",
      "    expect(Number.isNaN(velocity)).toBe(false);",
      "  });",
      "});",
      "",
    ].join("\n");

    it("emits human-readable describe and test titles with exact [Lstart-Lend] ranges instead of val _", () => {
      const res = generateOutline(sampleTestSource, "typescript", {
        filePath: "tests/entrypoint-and-start-menu.test.ts",
      });
      expect(res.text).not.toContain("val _");
      expect(res.text).toContain('describe "Menu & Swarm Suite" # [L3-L13]');
      expect(res.text).toContain(
        'test "TC-MENU-001: GameApp initializes at 60Hz with deterministic seed" # [L4-L7]',
      );
      expect(res.text).toContain(
        'test "TC-SWARM-009: handles empty swarm without NaN velocity" # [L9-L12]',
      );
    });

    it("extracts and splices exact test blocks by test ID prefix (-s 'TC-MENU-001') or full title", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aice-v0920-step1-"));
      try {
        const testFile = path.join(tmpDir, "menu.test.ts");
        fs.writeFileSync(testFile, sampleTestSource, "utf-8");

        const ctx = await generateContext(testFile, {
          symbol: "TC-MENU-001",
          includeCallers: false,
        });
        expect(ctx.formattedBundle).toContain("TC-MENU-001: GameApp initializes at 60Hz");
        expect(ctx.formattedBundle).not.toContain("TC-SWARM-009");

        const spliceRes = await splice(testFile, {
          symbol: "TC-SWARM-009",
          code: [
            '  it("TC-SWARM-009: handles empty swarm without NaN velocity", () => {',
            "    const velocity = 120;",
            "    expect(velocity).toBe(120);",
            "  });",
          ].join("\n"),
          inPlace: true,
        });
        expect(spliceRes.modifiedCode).toContain("const velocity = 120;");
        expect(spliceRes.modifiedCode).toContain("TC-MENU-001: GameApp initializes at 60Hz");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe("Step 2: Symbol Call-Site Line Numbers in Downstream Callers & /<searchPattern>/ Context Search", () => {
    it("records exact 1-based call-site line numbers in Downstream Callers and supports /pattern/ search", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aice-v0920-step2-"));
      try {
        const srcDir = path.join(tmpDir, "src");
        const testsDir = path.join(tmpDir, "tests");
        fs.mkdirSync(srcDir, { recursive: true });
        fs.mkdirSync(testsDir, { recursive: true });

        const appFile = path.join(srcDir, "app.ts");
        fs.writeFileSync(
          appFile,
          [
            "export class GameApp {",
            "  public getCoreConstants(): number {",
            "    return 60;",
            "  }",
            "}",
            "",
            "export class OracleIncoherenceAuditor {",
            "  public verifyCoherence(): boolean {",
            "    return true;",
            "  }",
            "}",
            "",
          ].join("\n"),
          "utf-8",
        );

        const callerFile = path.join(testsDir, "entrypoint-and-start-menu.test.ts");
        fs.writeFileSync(
          callerFile,
          [
            'import { describe, expect, test } from "vitest";',
            'import { GameApp } from "../src/app.js";',
            "",
            'describe("Start Menu", () => {',
            "  // line 5",
            "  // line 6",
            "  // line 7",
            "  // line 8",
            "  // line 9",
            "  // line 10",
            "  // line 11",
            '  test("TC-MENU-001: checks core constants", () => {',
            "    const app = new GameApp();",
            "    const hz = app.getCoreConstants();",
            "    expect(hz).toBe(60);",
            "  });",
            "});",
            "",
          ].join("\n"),
          "utf-8",
        );

        const ctx = await generateContext(appFile, {
          symbol: "GameApp.getCoreConstants",
          includeCallers: true,
        });
        expect(ctx.formattedBundle).toContain(
          "- tests/entrypoint-and-start-menu.test.ts imports: GameApp (uses getCoreConstants at [L14])",
        );

        // Regex /<searchPattern>/ search on single file and directory
        const fileSearch = await generateContext(appFile, {
          symbol: "/OracleIncoherenceAuditor/",
          includeCallers: false,
        });
        expect(fileSearch.formattedBundle).toContain("OracleIncoherenceAuditor");
        expect(fileSearch.formattedBundle).toContain("[L7]");

        const dirSearch = await generateWorkspaceContext(tmpDir, {
          symbol: "/getCoreConstants/",
        });
        expect(dirSearch.formattedBundle).toContain("getCoreConstants");
        expect(dirSearch.formattedBundle).toContain("src/app.ts");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe("Step 3 & Addition: .sh, .bash, .zsh, .ps1, .cmd, .bat, .md, .markdown Support (32 Extensions)", () => {
    it("registers all 32 extensions and maps script and markdown extensions with pure passthrough preprocessing", () => {
      for (const ext of [".sh", ".bash", ".zsh", ".ps1", ".cmd", ".bat", ".md", ".markdown"]) {
        expect(KNOWN_TARGET_EXTENSIONS.has(ext)).toBe(true);
      }
      expect(KNOWN_TARGET_EXTENSIONS.size).toBeGreaterThanOrEqual(32);

      expect(detectTargetFromPath("install.sh")).toBe("shell");
      expect(detectTargetFromPath("env.bash")).toBe("shell");
      expect(detectTargetFromPath("rc.zsh")).toBe("shell");
      expect(detectTargetFromPath("build.ps1")).toBe("powershell");
      expect(detectTargetFromPath("run.cmd")).toBe("batch");
      expect(detectTargetFromPath("setup.bat")).toBe("batch");
      expect(detectTargetFromPath("README.md")).toBe("markdown");
      expect(detectTargetFromPath("GUIDE.markdown")).toBe("markdown");

      const mdWithFence = "# Title\n```ts\npub fn x() -> int => 1\n```\n";
      expect(PREPROCESSORS_BY_LANG.markdown(mdWithFence, false)).toBe(mdWithFence);
      expect(PREPROCESSORS_BY_LANG.shell("#!/usr/bin/env bash\necho 1\n", false)).toBe(
        "#!/usr/bin/env bash\necho 1\n",
      );
    });

    it("supports create, outline, context, and splice for .sh, .ps1, .cmd, and .md files", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aice-v0920-step3-"));
      try {
        const shPath = path.join(tmpDir, "deploy.sh");
        const ps1Path = path.join(tmpDir, "deploy.ps1");
        const cmdPath = path.join(tmpDir, "deploy.cmd");
        const mdPath = path.join(tmpDir, "DOCS.md");

        await createBatch([
          {
            filePath: shPath,
            code: [
              "#!/usr/bin/env bash",
              "# ── Substep 1: System Packages ──",
              "install_sys_packages() {",
              '  echo "installing packages"',
              "}",
              "",
              "get_node_major() {",
              '  echo "24"',
              "}",
              "",
            ].join("\n"),
          },
          {
            filePath: ps1Path,
            code: [
              "# ── Build Helpers ──",
              "function Invoke-Build {",
              '  Write-Host "Building..."',
              "}",
              "",
            ].join("\n"),
          },
          {
            filePath: cmdPath,
            code: [
              "@echo off",
              "REM ── Main Routine ──",
              ":install_deps",
              "echo Installing deps",
              "exit /b 0",
              "",
            ].join("\n"),
          },
          {
            filePath: mdPath,
            code: [
              "# Project Guide",
              "Intro paragraph.",
              "",
              "## Quick Start",
              "Run `./install.sh -y`.",
              "```bash",
              "# Not a markdown heading inside fence",
              "echo hello",
              "```",
              "",
              "## Architecture",
              "Modular AST pipeline.",
              "",
            ].join("\n"),
          },
        ]);

        // 1. Outline verification
        const shOutline = generateOutline(fs.readFileSync(shPath, "utf-8"), "shell", {
          filePath: shPath,
        });
        expect(shOutline.text).toContain("fn install_sys_packages() # [L3-L5]");
        expect(shOutline.text).toContain("fn get_node_major() # [L7-L9]");

        const ps1Outline = generateOutline(fs.readFileSync(ps1Path, "utf-8"), "powershell", {
          filePath: ps1Path,
        });
        expect(ps1Outline.text).toContain("fn Invoke-Build() # [L2-L4]");

        const cmdOutline = generateOutline(fs.readFileSync(cmdPath, "utf-8"), "batch", {
          filePath: cmdPath,
        });
        expect(cmdOutline.text).toContain(":install_deps # [L3-L5]");

        const mdOutline = generateOutline(fs.readFileSync(mdPath, "utf-8"), "markdown", {
          filePath: mdPath,
        });
        expect(mdOutline.text).toContain("# Project Guide # [L1-L13]");
        expect(mdOutline.text).toContain("## Quick Start # [L4-L10]");
        expect(mdOutline.text).toContain("## Architecture # [L11-L13]");
        expect(mdOutline.text).not.toContain("Not a markdown heading");

        // 2. Context verification
        const shCtx = await generateContext(shPath, {
          symbol: "install_sys_packages",
          includeCallers: false,
        });
        expect(shCtx.formattedBundle).toContain('echo "installing packages"');
        expect(shCtx.formattedBundle).not.toContain("get_node_major");

        const mdCtx = await generateContext(mdPath, {
          symbol: "Quick Start",
          includeCallers: false,
        });
        expect(mdCtx.formattedBundle).toContain("## Quick Start");
        expect(mdCtx.formattedBundle).toContain("Run `./install.sh -y`.");
        expect(mdCtx.formattedBundle).not.toContain("## Architecture");

        // 3. Splice verification (replace + auto-append)
        await spliceBatch([
          {
            filePath: shPath,
            symbol: "install_sys_packages",
            code: 'install_sys_packages() {\n  echo "updated packages"\n}',
          },
          {
            filePath: mdPath,
            symbol: "Quick Start",
            code: "## Quick Start\nRun `./install.sh --update`.\n",
          },
          {
            filePath: mdPath,
            symbol: "Troubleshooting",
            code: "## Troubleshooting\nRun `aice agents status`.",
          },
        ]);

        const updatedSh = fs.readFileSync(shPath, "utf-8");
        expect(updatedSh).toContain('echo "updated packages"');
        expect(updatedSh).toContain("get_node_major()");

        const updatedMd = fs.readFileSync(mdPath, "utf-8");
        expect(updatedMd).toContain("Run `./install.sh --update`.");
        expect(updatedMd).toContain("## Architecture");
        expect(updatedMd).toContain("## Troubleshooting\nRun `aice agents status`.");

        // 4. bash -n syntax validation rejects invalid bash syntax on .sh
        await expect(
          splice(shPath, {
            symbol: "get_node_major",
            code: "get_node_major() {\n  if [[ 1 -eq 1 ]]; then\n    echo broken\n}",
            inPlace: true,
          }),
        ).rejects.toThrow(/Pre-write syntax validation failed/);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe("Step 4: Multi-Directory outlinePath, Compact Mode & Mandatory Agent Rules", () => {
    it("supports multi-directory outlinePath(['src', 'tests']) and compact mode", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aice-v0920-step4-"));
      try {
        const srcDir = path.join(tmpDir, "src");
        const testsDir = path.join(tmpDir, "tests");
        fs.mkdirSync(srcDir, { recursive: true });
        fs.mkdirSync(testsDir, { recursive: true });

        fs.writeFileSync(
          path.join(srcDir, "engine.ts"),
          "export class Engine {\n  public step(): number {\n    return 1;\n  }\n}\n",
          "utf-8",
        );
        fs.writeFileSync(
          path.join(testsDir, "engine.test.ts"),
          'import { test, expect } from "vitest";\ntest("TC-ENG-001: steps engine", () => {\n  expect(1).toBe(1);\n});\n',
          "utf-8",
        );

        const multiMap = await outlinePath([srcDir, testsDir], {
          projectRoot: tmpDir,
          compact: true,
        });
        expect(multiMap instanceof Map).toBe(true);
        if (multiMap instanceof Map) {
          expect(multiMap.has("src/engine.ts")).toBe(true);
          expect(multiMap.has("tests/engine.test.ts")).toBe(true);
          expect(multiMap.get("tests/engine.test.ts")?.text).toContain("TC-ENG-001");
        }
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("enforces sed/ls/grep ban and documents 33 extensions and v0.9.21 header in MANDATORY_AGENT_RULES_MARKDOWN", () => {
      expect(MANDATORY_AGENT_RULES_MARKDOWN).toContain("<!-- AICE:START v0.9.21 -->");
      expect(MANDATORY_AGENT_RULES_MARKDOWN).toContain("33 supported file extensions");
      expect(MANDATORY_AGENT_RULES_MARKDOWN).toContain(".sh, .bash, .zsh, .ps1, .cmd, .bat, .md, .markdown, .aipl");
      expect(MANDATORY_AGENT_RULES_MARKDOWN).toContain("sed -n");
      expect(MANDATORY_AGENT_RULES_MARKDOWN).toContain("grep -rn");
      expect(MANDATORY_AGENT_RULES_MARKDOWN).toContain("aice outline src tests");
      expect(MANDATORY_AGENT_RULES_MARKDOWN).toContain('aice context <file> -s "L180-L240"');
    });
  });

  describe("Step 5: Version Detection, Agent Rule Sync Status & install.sh Workspace Refresh", () => {
    it("embeds current version in VERSION/AICE_VERSION, detects outdated agent rules, and refreshes workspaces in install.sh", () => {
      expect(AICE_VERSION).toBe("0.9.21");
      expect(VERSION).toBe("0.9.21");

      const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "aice-v0920-step5-"));
      try {
        // 1. Setup agents and verify rulesVersion === 0.9.21 and allRulesUpToDate === true
        const setupRes = setupAgents({ homeDir: tmpHome, all: true });
        expect(setupRes.version).toBe("0.9.21");
        expect(setupRes.allRulesUpToDate).toBe(true);
        // 2. Simulate an older v0.9.10 rule block in ~/.claude/CLAUDE.md and verify mismatch detection
        const claudeMdPath = path.join(tmpHome, ".claude", "CLAUDE.md");
        fs.writeFileSync(
          claudeMdPath,
          "<!-- AICE:START -->\n<!-- AICE:START v0.9.10 -->\nOld rules\n<!-- AICE:END -->\n",
          "utf-8",
        );
        const statusRes = getAgentsStatus({ homeDir: tmpHome });
        expect(statusRes.allRulesUpToDate).toBe(false);
        expect(statusRes.updateRecommendation).toContain("./install.sh -y");
        const table = formatAgentsStatusTable(statusRes);

        expect(table).toContain("v0.9.10 -> v0.9.21");
        const sampleProj = path.join(tmpHome, "dev", "sample_game");
        fs.mkdirSync(sampleProj, { recursive: true });
        fs.writeFileSync(
          path.join(sampleProj, "aice.config.json"),
          JSON.stringify({ enabled: true, idiomsEnabled: true }, null, 2),
          "utf-8",
        );
        fs.writeFileSync(
          path.join(sampleProj, ".GEMINI.md"),
          "<!-- AICE:START -->\nOld directive\n<!-- AICE:END -->\n",
          "utf-8",
        );

        const installScript = path.resolve(process.cwd(), "install.sh");
        const runRes = spawnSync(
          installScript,
          ["--no-update", "--no-cheatsheet", "-y"],
          {
            cwd: process.cwd(),
            env: {
              ...process.env,
              HOME: tmpHome,
              AICE_AGENT_HOME: tmpHome,
              AICE_PROJECTS_DIR: path.join(tmpHome, "dev"),
            },
            encoding: "utf-8",
          },
        );
        expect(runRes.status).toBe(0);

        // Verify MCP schema regeneration in ~/.gemini/antigravity-cli/mcp/aice/tools.json
        const toolsSchemaPath = path.join(
          tmpHome,
          ".gemini",
          "antigravity-cli",
          "mcp",
          "aice",
          "tools.json",
        );
        expect(fs.existsSync(toolsSchemaPath)).toBe(true);
        const toolsSchema = JSON.parse(fs.readFileSync(toolsSchemaPath, "utf-8"));
        expect(toolsSchema.version).toBe("0.9.21");
        const refreshedDotGemini = fs.readFileSync(path.join(sampleProj, ".GEMINI.md"), "utf-8");
        expect(refreshedDotGemini).toContain("<!-- AICE:START v0.9.21 -->");
        const refreshedAgentsMd = fs.readFileSync(path.join(sampleProj, "AGENTS.md"), "utf-8");
        expect(refreshedAgentsMd).toContain("<!-- AICE:START v0.9.21 -->");
      } finally {
        fs.rmSync(tmpHome, { recursive: true, force: true });
      }
    }, 30000);

    it("handles install.sh ${#arr[@]} brace spans, heredoc masking, 4-backtick nested markdown fences, test.each blocks, non-destructive auto-append, and multi-line import exclusion in Downstream Callers", async () => {
      // 1. Real install.sh outline & context span for install_sys_packages (contains ${#SUDO_CMD[@]}) and Substep 2.2b
      const installShPath = path.resolve(process.cwd(), "install.sh");
      const installOutline = generateOutline(installShPath);
      expect(installOutline.text).toContain("fn install_sys_packages()");
      expect(installOutline.text).not.toContain("fn install_sys_packages() # [L118-L118]");
      expect(installOutline.text).toContain("Substep 2.2b: Detect Installed / Local / Remote Versions & In-Place Update");
      expect(installOutline.text).not.toContain("fn aice_cheatsheet()");

      const sysPkgCtx = await generateContext(installShPath, {
        symbol: "install_sys_packages",
        includeCallers: false,
      });
      expect(sysPkgCtx.targetContent.split("\n").length).toBeGreaterThan(25);
      expect(sysPkgCtx.targetContent).toContain("SUDO_CMD");

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aice-v0920-edge-"));
      try {
        // 2. test.each / describe.each / tagged template test.each`...` blocks
        const paramTestFile = path.join(tmpDir, "param.test.ts");
        fs.writeFileSync(
          paramTestFile,
          [
            'import { describe, expect, test } from "vitest";',
            'describe.each([[1, 2]])("Suite %i", (a, b) => {',
            '  test.each([[1, 1], [2, 2]])("TC-EACH-001: compares %i and %i", (x, y) => {',
            "    expect(x).toBe(y);",
            "  });",
            "  test.each`",
            "    val  | expected",
            "    ${1} | ${1}",
            '  `("TC-TAG-002: tagged template test, with comma", ({ val, expected }) => {',
            "    expect(val).toBe(expected);",
            "  });",
            "});",
            "",
          ].join("\n"),
          "utf-8",
        );
        const paramOutline = generateOutline(paramTestFile);
        expect(paramOutline.text).toContain('describe "Suite %i" # [L2-L12]');
        expect(paramOutline.text).toContain('test "TC-EACH-001: compares %i and %i" # [L3-L5]');
        expect(paramOutline.text).toContain('test "TC-TAG-002: tagged template test, with comma" # [L6-L11]');

        const taggedCtx = await generateContext(paramTestFile, {
          symbol: "TC-TAG-002: tagged template test, with comma",
          includeCallers: false,
        });
        expect(taggedCtx.targetContent).toContain("TC-TAG-002");

        // 3. 4-backtick outer fence wrapping 3-backtick inner fence & non-destructive auto-append on .md
        const mdFile = path.join(tmpDir, "GUIDE.md");
        fs.writeFileSync(
          mdFile,
          [
            "# Project Setup Guide",
            "Intro paragraph.",
            "",
            "````markdown",
            "```bash",
            "# Inside nested code block - NOT a heading!",
            "=== fake/header.ts ===",
            "```",
            "````",
            "",
            "## Commands",
            "Run build.",
            "",
          ].join("\n"),
          "utf-8",
        );
        const mdOutline = generateOutline(mdFile);
        expect(mdOutline.text).not.toContain("Inside nested code block");
        expect(mdOutline.text).toContain("# Project Setup Guide # [L1-L13]");
        expect(mdOutline.text).toContain("## Commands # [L11-L13]");

        // Auto-appending '## Setup' must NOT overwrite '# Project Setup Guide'
        await splice(mdFile, {
          symbol: "Setup",
          code: "## Setup\nRun npm install.",
          projectRoot: tmpDir,
        });
        const updatedMd = fs.readFileSync(mdFile, "utf-8");
        expect(updatedMd).toContain("# Project Setup Guide");
        expect(updatedMd).toContain("## Commands");
        expect(updatedMd).toContain("## Setup\nRun npm install.");

        // 4. Multi-line import exclusion in Downstream Callers & /pattern:with:colon/ workspace search
        const modFile = path.join(tmpDir, "engine.ts");
        fs.writeFileSync(
          modFile,
          "export function runEngineStep(): number {\n  return 42;\n}\n",
          "utf-8",
        );
        const callerMulti = path.join(tmpDir, "caller.ts");
        fs.writeFileSync(
          callerMulti,
          [
            "import {",
            "  runEngineStep,",
            '} from "./engine.js";',
            "",
            "export function execute(): number {",
            "  return runEngineStep();",
            "}",
            "",
          ].join("\n"),
          "utf-8",
        );
        const engineCtx = await generateContext(modFile, {
          symbol: "runEngineStep",
          includeCallers: true,
          projectRoot: tmpDir,
        });
        // Line 2 is inside multi-line import; only Line 6 is the actual call site!
        expect(engineCtx.formattedBundle).toContain("(uses runEngineStep at [L6])");
        expect(engineCtx.formattedBundle).not.toContain("[L2");

        const colonSearch = await generateWorkspaceContext(tmpDir, {
          symbol: "/execute\\(\\): number/",
          projectRoot: tmpDir,
        });
        expect(colonSearch.formattedBundle).toContain("caller.ts");
        expect(colonSearch.formattedBundle).toContain("[L5]");
        expect(colonSearch.formattedBundle).not.toContain("GUIDE.md");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
