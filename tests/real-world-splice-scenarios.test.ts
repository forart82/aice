import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { estimateTokens } from "../src/tokenomics/index.js";
import { createBatch, createFile, parseMultiFileCreateStream } from "../src/tools/create.js";
import { maskSourceLexically } from "../src/tools/preprocessor.js";
import {
  parseMultiBlockSpliceStream,
  splice,
  spliceBatch,
  spliceNativeSource,
  spliceSource,
} from "../src/tools/splice.js";
import {
  formatNativeSyntaxDiagnosticsMarkdown,
  validateNativeSyntax,
} from "../src/tools/syntax-validator.js";

const CLI_ENTRY = path.resolve(process.cwd(), "bin/aice.ts");
const TSX_BIN = path.resolve(process.cwd(), "node_modules/.bin/tsx");

function runCli(args: string[], cwd: string, stdinInput?: string) {
  return spawnSync(TSX_BIN, [CLI_ENTRY, ...args], {
    cwd,
    input: stdinInput,
    encoding: "utf-8",
    timeout: 20000,
  });
}

describe("Real-World Splice Scenarios & v0.9.50 Re-Audit Regression Suite (S1–S7 + BPE Token Proof)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aice-realworld-splice-"));
    fs.writeFileSync(
      path.join(tmpDir, "aice.config.json"),
      JSON.stringify({ enabled: true, idiomsEnabled: false }, null, 2),
      "utf-8",
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("S1: Line-Range & Markdown / Dialect / Code False-Rejection Elimination", () => {
    it("masks Markdown lexically without C-style comment bleed or apostrophe string false positives", () => {
      const md = [
        "# ORACLE Specification",
        "- Don't break Fitts's Law (hitbox >= 48dp) or [0, 1) half-open bounds.",
        "- Globs like `src/*` and URLs https://example.com/a/*b must not open block comments.",
        "- Unpaired prose parens: 1) First step 2) Second step {placeholder",
      ].join("\n");

      const maskRes = maskSourceLexically(md, "markdown");
      expect(maskRes.unterminatedDiagnostics).toEqual([]);

      const valRes = validateNativeSyntax(md, "markdown", "ORACLE.md");
      expect(valRes.valid).toBe(true);
    });

    it("splices ORACLE.md, GEMINI.md, SAVE_SCHEMA.md, YAML, JSON, CJS, and HTML via :Lstart-Lend with zero delimiter rejections", async () => {
      const oraclePath = path.join(tmpDir, "ORACLE.md");
      fs.writeFileSync(
        oraclePath,
        [
          "# Domain Oracle",
          "## 1. Ergonomics",
          "1) User's thumb deadzone in [0, 0.15) prevents drift.",
          "2) See https://example.org/spec/* for details.",
          "## 2. Balance",
          "| Tier | Multiplier |",
          "|------|------------|",
          "| Base | 1.0x       |",
          "",
        ].join("\n"),
        "utf-8",
      );

      const mdRes = await splice(oraclePath, {
        symbol: "L3-L4",
        code: [
          "1) Player's thumb radial deadzone in [0, 0.12) prevents stick drift (Fitts's Law).",
          "2) Updated glob src/** and URL https://example.org/v2/* (verified).",
          "3) Extra item with unpaired paren ) and brace { in prose.",
        ].join("\n"),
        projectRoot: tmpDir,
      });
      expect(mdRes.success).toBe(true);
      expect(fs.readFileSync(oraclePath, "utf-8")).toContain("Player's thumb radial deadzone");

      const wfPath = path.join(tmpDir, ".github", "workflows", "release.yml");
      fs.mkdirSync(path.dirname(wfPath), { recursive: true });
      fs.writeFileSync(
        wfPath,
        [
          "name: Release",
          "on:",
          "  push:",
          "    tags: ['v*']",
          "jobs:",
          "  build:",
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - uses: actions/checkout@v4",
          "      - run: npm test",
          "",
        ].join("\n"),
        "utf-8",
      );

      const ymlRes = await splice(wfPath, {
        symbol: "L9-L10",
        code: [
          "      - uses: actions/checkout@v4",
          "      - run: npm ci && npm test",
          "      - run: 'echo \"Build (step 1) done: ${{ github.sha }}\"'",
        ].join("\n"),
        projectRoot: tmpDir,
      });
      expect(ymlRes.success).toBe(true);
      const cjsPath = path.join(tmpDir, ".dependency-cruiser.cjs");
      fs.writeFileSync(
        cjsPath,
        [
          "module.exports = {",
          "  forbidden: [",
          "    {",
          '      name: "no-circular",',
          '      severity: "error",',
          "      from: {},",
          "      to: { circular: true },",
          "    },",
          "  ],",
          "};",
          "",
        ].join("\n"),
        "utf-8",
      );
      const cjsRes = await splice(cjsPath, {
        symbol: "L4-L5",
        code: '      name: "no-circular-deps",\n      severity: "warn",',
        projectRoot: tmpDir,
      });
      expect(cjsRes.success).toBe(true);

      const htmlPath = path.join(tmpDir, "index.html");
      fs.writeFileSync(
        htmlPath,
        [
          "<!DOCTYPE html>",
          "<html>",
          "<body>",
          '  <div id="hud">Score: 0 (Best: 0)</div>',
          "</body>",
          "</html>",
          "",
        ].join("\n"),
        "utf-8",
      );
      const htmlRes = await splice(htmlPath, {
        symbol: "L4-L4",
        code: '  <div id="hud">Score: 0 — Tier 1) Ready</div>',
        projectRoot: tmpDir,
      });
      expect(htmlRes.success).toBe(true);
    });

    it("does not reject valid AST code :Lstart-Lend splices on span-local delimiter artifacts or intentional 4-assignment shrinks", async () => {
      // Span crosses a multiline block comment containing `{` so isolated slice countNetDelims != 0,
      // while full post-edit TypeScript AST is 100% valid!
      const tsPath = path.join(tmpDir, "SettingsScreen.ts");
      fs.writeFileSync(
        tsPath,
        [
          "export class SettingsScreen {",
          "  /* Legacy note with unbalanced {",
          "     continued on L3 */",
          "  public volume = 0.8;",
          "  public muted = false;",
          "}",
          "",
        ].join("\n"),
        "utf-8",
      );

      const tsRes = await splice(tsPath, {
        symbol: "L3-L4",
        code: ["     continued cleanly */", "  public volume = 0.95;"].join("\n"),
        projectRoot: tmpDir,
      });
      expect(tsRes.success).toBe(true);
      expect(fs.readFileSync(tsPath, "utf-8")).toContain("public volume = 0.95;");

      // Intentional removal of an unused 4th assignment on a 4-line assignment block
      const pyPath = path.join(tmpDir, "init_project.py");
      fs.writeFileSync(
        pyPath,
        [
          "def configure() -> int:",
          "    alpha = 1",
          "    beta = 2",
          "    gamma = 3",
          "    unused_delta = 4",
          "    return alpha + beta + gamma",
          "",
        ].join("\n"),
        "utf-8",
      );
      const pyRes = await splice(pyPath, {
        symbol: "L2-L5",
        code: ["    alpha = 10", "    beta = 20", "    gamma = 30"].join("\n"),
        projectRoot: tmpDir,
      });
      expect(pyRes.success).toBe(true);
      expect(fs.readFileSync(pyPath, "utf-8")).not.toContain("unused_delta");
    });
  });

  describe("S2: JSON, Webmanifest, YAML, CSS, HTML & Twig <<< / === / >>> Hunk Splicing", () => {
    it("applies <<< / === / >>> hunks to JSON, YAML, CSS, HTML, Twig, and .webmanifest before syntax validation", async () => {
      const schemaJson = path.join(tmpDir, ".agents", "session_state.schema.json");
      fs.mkdirSync(path.dirname(schemaJson), { recursive: true });
      fs.writeFileSync(
        schemaJson,
        JSON.stringify(
          {
            $schema: "http://json-schema.org/draft-07/schema#",
            title: "SessionState",
            required: ["version", "step"],
          },
          null,
          2,
        ) + "\n",
        "utf-8",
      );

      const yamlFile = path.join(tmpDir, "config.yaml");
      fs.writeFileSync(
        yamlFile,
        [
          "# Important header comment that must survive hunk splice",
          "server:",
          "  port: 3000",
          "  host: localhost",
          "",
        ].join("\n"),
        "utf-8",
      );

      const cssFile = path.join(tmpDir, "styles.css");
      fs.writeFileSync(
        cssFile,
        [".btn {", "  color: red;", "  padding: 8px;", "}", ""].join("\n"),
        "utf-8",
      );

      const htmlFile = path.join(tmpDir, "view.html");
      fs.writeFileSync(
        htmlFile,
        ['<div id="app">', "  <span>Old Title</span>", "</div>", ""].join("\n"),
        "utf-8",
      );

      const twigFile = path.join(tmpDir, "card.html.twig");
      fs.writeFileSync(
        twigFile,
        ["<section>", "  {{ user.name }}", "</section>", ""].join("\n"),
        "utf-8",
      );

      const manifestFile = path.join(tmpDir, "manifest.webmanifest");
      fs.writeFileSync(
        manifestFile,
        '{\n  "name": "Breathe",\n  "display": "browser"\n}\n',
        "utf-8",
      );

      const stream = [
        `=== ${schemaJson} ===`,
        "<<<",
        '  "required": [',
        '    "version",',
        '    "step"',
        "  ]",
        "===",
        '  "required": [',
        '    "version",',
        '    "step",',
        '    "updatedAt"',
        "  ]",
        ">>>",
        `=== ${yamlFile} ===`,
        "<<<",
        "  port: 3000",
        "===",
        "  port: 8080",
        ">>>",
        `=== ${cssFile}:.btn ===`,
        "<<<",
        "  color: red;",
        "===",
        "  color: #00ffcc;",
        ">>>",
        `=== ${htmlFile} ===`,
        "<<<",
        "  <span>Old Title</span>",
        "===",
        "  <span>New Title</span>",
        ">>>",
        `=== ${twigFile} ===`,
        "<<<",
        "  {{ user.name }}",
        "===",
        "  {{ user.displayName }}",
        ">>>",
        `=== ${manifestFile} ===`,
        "<<<",
        '  "display": "browser"',
        "===",
        '  "display": "standalone"',
        ">>>",
      ].join("\n");

      const batchRes = await spliceBatch(stream, { projectRoot: tmpDir });
      expect(batchRes.success).toBe(true);
      expect(JSON.parse(fs.readFileSync(schemaJson, "utf-8")).required).toContain("updatedAt");
      const updatedYaml = fs.readFileSync(yamlFile, "utf-8");
      expect(updatedYaml).toContain("# Important header comment");
      expect(updatedYaml).toContain("port: 8080");
      expect(fs.readFileSync(cssFile, "utf-8")).toContain("color: #00ffcc;");
      expect(fs.readFileSync(htmlFile, "utf-8")).toContain("<span>New Title</span>");
      expect(fs.readFileSync(twigFile, "utf-8")).toContain("{{ user.displayName }}");
      expect(JSON.parse(fs.readFileSync(manifestFile, "utf-8")).display).toBe("standalone");

      // Post-hunk syntax validation must still reject broken JSON
      await expect(
        splice(schemaJson, {
          code: '<<<\n  "title": "SessionState",\n===\n  "title": "Broken"\n>>>',
          projectRoot: tmpDir,
        }),
      ).rejects.toThrow(/JSON|syntax validation/i);
    });
  });

  describe("S3, S4, S5: Multi-Block Stream Hardening, Extensionless/Java/ProGuard & --delete Variants", () => {
    it("supports .java, .pro, .webmanifest, .example, .gradle, .kts, .properties, .xml, and extensionless verify/new-project without header hijacking", async () => {
      const ktsPath = path.join(tmpDir, "android", "app", "build.gradle.kts");
      fs.mkdirSync(path.dirname(ktsPath), { recursive: true });
      fs.writeFileSync(ktsPath, 'plugins {\n    id("com.android.application")\n}\n', "utf-8");

      const javaPath = path.join(
        tmpDir,
        "android",
        "app",
        "src",
        "main",
        "java",
        "com",
        "app",
        "MainActivity.java",
      );
      fs.mkdirSync(path.dirname(javaPath), { recursive: true });
      fs.writeFileSync(
        javaPath,
        [
          "package com.app;",
          "",
          "public class MainActivity {",
          "    public void onCreate() {",
          '        System.out.println("init");',
          "    }",
          "}",
          "",
        ].join("\n"),
        "utf-8",
      );

      const verifyPath = path.join(tmpDir, "verify");
      fs.writeFileSync(
        verifyPath,
        ["#!/usr/bin/env bash", "set -euo pipefail", 'echo "old check"', ""].join("\n"),
        "utf-8",
      );

      const proPath = path.join(tmpDir, "android", "app", "proguard-rules.pro");
      const examplePath = path.join(tmpDir, "keystore.properties.example");
      const xmlPath = path.join(
        tmpDir,
        "android",
        "app",
        "src",
        "main",
        "res",
        "values",
        "styles.xml",
      );
      const newProjPath = path.join(tmpDir, "new-project");

      // Multi-file stream mixing existing .kts, new .pro, existing .java:L, new .example, new .xml, existing verify:L, and new extensionless new-project
      const stream = [
        `=== ${ktsPath}:L2-L2 ===`,
        '    id("com.android.application") version "8.2.0"',
        `=== ${proPath} ===`,
        "-keep class com.app.** { *; }",
        `=== ${javaPath}:L4-L6 ===`,
        "    public void onCreate() {",
        '        System.out.println("ready");',
        "    }",
        `=== ${examplePath} ===`,
        "storeFile=release.keystore",
        "storePassword=changeme",
        `=== ${xmlPath} ===`,
        '<?xml version="1.0" encoding="utf-8"?>',
        "<resources></resources>",
        `=== ${verifyPath}:L3-L3 ===`,
        'echo "verified check"',
        `=== ${newProjPath} ===`,
        "#!/usr/bin/env python3",
        "def main() -> int:",
        "    return 0",
      ].join("\n");

      const parsed = parseMultiBlockSpliceStream(stream);
      expect(parsed?.batchItems).toHaveLength(7);

      const res = await spliceBatch(stream, { projectRoot: tmpDir });
      expect(res.success).toBe(true);
      expect(fs.readFileSync(proPath, "utf-8")).toContain("-keep class com.app.**");
      expect(fs.readFileSync(javaPath, "utf-8")).toContain('System.out.println("ready");');
      expect(fs.readFileSync(examplePath, "utf-8")).toContain("storeFile=release.keystore");
      expect(fs.readFileSync(xmlPath, "utf-8")).toContain("<resources></resources>");
      expect(fs.readFileSync(verifyPath, "utf-8")).toContain('echo "verified check"');
      expect(fs.readFileSync(newProjPath, "utf-8")).toContain("def main() -> int:");

      // Also verify direct createFile, createBatch & spliceSource on .java, .pro, and extensionless scripts
      const pluginJava = path.join(tmpDir, "HeartRateNativePlugin.java");
      const crJava = await createFile(pluginJava, {
        code: "package com.app;\npublic class HeartRateNativePlugin {\n  public int status() { return 1; }\n}\n",
        projectRoot: tmpDir,
      });
      expect(crJava.success).toBe(true);

      const srcJavaRes = spliceSource(
        fs.readFileSync(pluginJava, "utf-8"),
        { symbol: "L3-L3", code: "  public int status() { return 2; }" },
        pluginJava,
      );
      expect(srcJavaRes.modifiedCode).toContain("return 2;");

      const createStream =
        `=== ${path.join(tmpDir, "verify-ci")} ===\n#!/usr/bin/env bash\necho ok\n` +
        `=== ${path.join(tmpDir, "app", "rules.pro")} ===\n-dontwarn **\n`;
      expect(parseMultiFileCreateStream(createStream)).toHaveLength(2);
      const batchCreated = await createBatch(createStream, { projectRoot: tmpDir });
      expect(batchCreated.totalFiles).toBe(2);
    });

    it("ignores 78-char pure '=' divider lines and '=== ... ===' inside Python/Kotlin triple-quoted strings", async () => {
      const synthPy = path.join(tmpDir, "synth_assets.py");
      const divider78 = "=".repeat(78);
      const stream = [
        `=== ${synthPy} ===`,
        '"""',
        divider78,
        "Audio Synthesis Pipeline",
        "=== Fake Header Inside Docstring ===",
        divider78,
        '"""',
        "",
        `# ${divider78}`,
        "def generate_tone() -> int:",
        '    raw = """',
        "=== Another Docstring Banner ===",
        "==========",
        '"""',
        "    return 440",
      ].join("\n");

      const parsed = parseMultiBlockSpliceStream(stream);
      expect(parsed?.batchItems).toHaveLength(1);

      const res = await spliceBatch(stream, { projectRoot: tmpDir });
      expect(res.success).toBe(true);
      expect(fs.readFileSync(synthPy, "utf-8")).toContain("=== Fake Header Inside Docstring ===");
      expect(fs.readFileSync(synthPy, "utf-8")).toContain(divider78);
    });

    it("supports both '=== file:sym --delete ===' and '=== file:sym === --delete' with empty body", async () => {
      const testTs = path.join(tmpDir, "AuditRenderFixes.test.ts");
      fs.writeFileSync(
        testTs,
        [
          "export const KEEP_TOP = 1;",
          "export const DROP_LINE_A = 2;",
          "export const DROP_LINE_B = 3;",
          "export function dropFn(): void {}",
          "export const KEEP_BOTTOM = 4;",
          "",
        ].join("\n"),
        "utf-8",
      );

      const delStream = [
        `=== ${testTs}:L2-L3 === --delete`,
        `=== ${testTs}:dropFn --delete ===`,
      ].join("\n");

      const parsed = parseMultiBlockSpliceStream(delStream);
      expect(parsed?.batchItems).toHaveLength(1);

      const res = await spliceBatch(delStream, { projectRoot: tmpDir });
      expect(res.success).toBe(true);
      const finalContent = fs.readFileSync(testTs, "utf-8");
      expect(finalContent).toContain("KEEP_TOP");
      expect(finalContent).toContain("KEEP_BOTTOM");
      expect(finalContent).not.toContain("DROP_LINE_A");
      expect(finalContent).not.toContain("dropFn");
    });
  });

  describe('S6 & S7: Pre-Write Silent Corruption Guards (Python AST, Markdown <<< === >>>, Kotlin """", Lossless Validation)', () => {
    it("rejects Python IndentationError and SyntaxError with line numbers BEFORE writing to disk", async () => {
      const pyFile = path.join(tmpDir, "init-project.py");
      const origPy = [
        "def build_config(name: str) -> dict:",
        "    cfg = {'name': name}",
        "    if not name:",
        "        return {}",
        "    return cfg",
        "",
      ].join("\n");
      fs.writeFileSync(pyFile, origPy, "utf-8");

      await expect(
        splice(pyFile, {
          symbol: "L2-L4",
          code: [
            "    cfg = {'name': name}",
            "    if not name:",
            "    return {}", // IndentationError: expected an indented block!
          ].join("\n"),
          projectRoot: tmpDir,
        }),
      ).rejects.toThrow(/IndentationError|expected an indented block|syntax validation/i);

      // Disk file must remain 100% untouched!
      expect(fs.readFileSync(pyFile, "utf-8")).toBe(origPy);
    });

    it("rejects unparsed single-line '<<< ... === ... >>>' in Markdown/text writes while allowing backticked/fenced examples", async () => {
      const pdrMd = path.join(tmpDir, "TEMPLATE.pdr.md");
      const origMd = ["# PDR Template", "## Goals", "Old goal description.", ""].join("\n");
      fs.writeFileSync(pdrMd, origMd, "utf-8");

      // 1. Single-line <<< old === new >>> outside fences/backticks MUST be rejected pre-write!
      await expect(
        splice(pdrMd, {
          symbol: "L3-L3",
          code: "<<< Old goal description. === New goal description. >>>",
          projectRoot: tmpDir,
        }),
      ).rejects.toThrow(/<<<|hunk|syntax validation/i);
      expect(fs.readFileSync(pdrMd, "utf-8")).toBe(origMd);

      // 2. Full Markdown write containing bare single-line <<< === >>> outside backticks MUST also fail!
      const badDoc = path.join(tmpDir, "CORRUPTED.md");
      await expect(
        createFile(badDoc, {
          code: "# Bad Doc\n<<< === >>>\n",
          projectRoot: tmpDir,
        }),
      ).rejects.toThrow(/<<<|hunk|syntax validation/i);
      expect(fs.existsSync(badDoc)).toBe(false);

      // 3. Documentation mentioning `<<< === >>>` inside inline backticks or fenced code blocks MUST succeed!
      const rulesMd = path.join(tmpDir, "RULES_DOC.md");
      const okCreate = await createFile(rulesMd, {
        code: [
          "# Splice Guide",
          "Never write single-line `<<< old === new >>>`; put markers on separate lines:",
          "```text",
          "<<<",
          "old",
          "===",
          "new",
          ">>>",
          "```",
          "",
        ].join("\n"),
        projectRoot: tmpDir,
      });
      expect(okCreate.success).toBe(true);
    });

    it('lexes Kotlin 4-quote raw strings (\'"""...""""\') cleanly with zero false syntax diagnostics', async () => {
      const ktFile = path.join(tmpDir, "MixStateSerializerTest.kt");
      const ktCode = [
        "package com.app.audio",
        "",
        "class MixStateSerializerTest {",
        "    fun parsesJsonRawString() {",
        '        val payload = """{"version":1,"preset":"rain"}"""',
        '        val endingWithQuote = """hello "world""""',
        "        assert(payload.isNotEmpty() && endingWithQuote.isNotEmpty())",
        "    }",
        "}",
        "",
      ].join("\n");
      fs.writeFileSync(ktFile, ktCode, "utf-8");

      expect(validateNativeSyntax(ktCode, "kotlin", ktFile).valid).toBe(true);
      expect(formatNativeSyntaxDiagnosticsMarkdown(ktFile, ktCode)).toBeUndefined();

      const res = await splice(ktFile, {
        symbol: "L6-L6",
        code: '        val endingWithQuote = """updated "rain""""',
        projectRoot: tmpDir,
      });
      expect(res.success).toBe(true);
    });

    it("never bypasses final syntax validation when forceLosslessPreprocess is true", () => {
      const validTs = "export function calc(x: number): number {\n  return x + 1;\n}\n";
      expect(() =>
        spliceNativeSource(
          validTs,
          { symbol: "calc", code: "export function calc(x: number): number {\n  return x + ;\n}" },
          "calc.ts",
          undefined,
          true,
        ),
      ).toThrow(/syntax validation/i);
    });

    it("rolls back multi-block spliceBatch atomically when block 4 fails Python IndentationError and never hijacks path headers via lastExplicitFilePath", async () => {
      // 1. S7: 4-block Python batch where block 4 introduces an IndentationError -> blocks 1..3 MUST roll back!
      const pyMonolith = path.join(tmpDir, "init-project-atomic.py");
      const origPy = [
        "ALPHA = 1",
        "BETA = 2",
        "GAMMA = 3",
        "def run_step(flag: bool) -> int:",
        "    if flag:",
        "        return ALPHA + BETA + GAMMA",
        "    return 0",
        "",
      ].join("\n");
      fs.writeFileSync(pyMonolith, origPy, "utf-8");

      const fourBlockStream = [
        `=== ${pyMonolith}:L1-L1 ===`,
        "ALPHA = 10",
        `=== ${pyMonolith}:L2-L2 ===`,
        "BETA = 20",
        `=== ${pyMonolith}:L3-L3 ===`,
        "GAMMA = 30",
        `=== ${pyMonolith}:L5-L6 ===`,
        "    if flag:",
        "    return ALPHA + BETA + GAMMA",
      ].join("\n");

      await expect(spliceBatch(fourBlockStream, { projectRoot: tmpDir })).rejects.toThrow(
        /IndentationError|expected an indented block|syntax validation/i,
      );
      expect(fs.readFileSync(pyMonolith, "utf-8")).toBe(origPy);

      // 2. S3 Anti-hijack: non-existent path header with unknown extension after .kts MUST NOT hijack .kts as a symbol!
      const ktsFile = path.join(tmpDir, "build.gradle.kts");
      const origKts = 'plugins {\n  id("java")\n}\n';
      fs.writeFileSync(ktsFile, origKts, "utf-8");

      const hijackProbeStream = [
        `=== ${ktsFile}:L2-L2 ===`,
        '  id("kotlin")',
        "=== app/nonexistent.unknownext:L1-L2 ===",
        "foo = 1",
      ].join("\n");
      let hijackErr = "";
      try {
        await spliceBatch(hijackProbeStream, { projectRoot: tmpDir });
      } catch (err) {
        hijackErr = err instanceof Error ? err.message : String(err);
      }
      expect(hijackErr).toMatch(/Source file not found|Unsupported target extension/i);
      expect(hijackErr).not.toContain("build.gradle.kts");
      expect(fs.readFileSync(ktsFile, "utf-8")).toBe(origKts);

      // 3. Relative ./verify:L, .gitignore:eof, .gradle, .properties, GEMINI.md, SAVE_SCHEMA.md, Kotlin :L
      const gitignoreFp = path.join(tmpDir, ".gitignore");
      fs.writeFileSync(gitignoreFp, "node_modules/\ndist/\n", "utf-8");
      const gradleFp = path.join(tmpDir, "settings.gradle");
      fs.writeFileSync(gradleFp, "rootProject.name = 'demo'\n", "utf-8");
      const propsFp = path.join(tmpDir, "gradle.properties");
      fs.writeFileSync(propsFp, "org.gradle.jvmargs=-Xmx2g\n", "utf-8");
      const geminiMd = path.join(tmpDir, "GEMINI.md");
      fs.writeFileSync(geminiMd, "# Agent Guide\nDon't skip tests (see [0, 1) bounds).\n", "utf-8");
      const saveSchemaMd = path.join(tmpDir, "SAVE_SCHEMA.md");
      fs.writeFileSync(
        saveSchemaMd,
        "# Save Schema v1\n1) Header {version}\n2) Checksum\n",
        "utf-8",
      );
      const ktPool = path.join(tmpDir, "ExoAudioPlayerPool.kt");
      fs.writeFileSync(
        ktPool,
        [
          "class ExoAudioPlayerPool {",
          "    /* Track pool {",
          "       active players */",
          "    var maxPlayers: Int = 4",
          "}",
          "",
        ].join("\n"),
        "utf-8",
      );
      const relVerify = path.join(tmpDir, "verify");
      fs.writeFileSync(relVerify, "#!/usr/bin/env bash\necho step1\necho step2\n", "utf-8");

      const cliRelRes = runCli(
        ["splice", "--stdin"],
        tmpDir,
        [
          "=== ./verify:L2-L3 ===",
          "echo step1_ok",
          "echo step2_ok",
          "=== .gitignore:eof ===",
          ".coverage/",
          "=== settings.gradle:L1-L1 ===",
          "rootProject.name = 'demo-v2'",
          "=== gradle.properties:L1-L1 ===",
          "org.gradle.jvmargs=-Xmx4g",
          "=== GEMINI.md:L2-L2 ===",
          "Don't skip pre-write validation; enforce user's [0, 1) bounds.",
          "=== SAVE_SCHEMA.md:L2-L3 ===",
          "1) Header {version, migratedAt}\n2) CRC32 Checksum )",
          "=== ExoAudioPlayerPool.kt:L3-L4 ===",
          "       active player slots */\n    var maxPlayers: Int = 8",
        ].join("\n") + "\n",
      );
      expect(cliRelRes.status).toBe(0);
      expect(fs.readFileSync(relVerify, "utf-8")).toContain("echo step2_ok");
      expect(fs.readFileSync(gitignoreFp, "utf-8")).toContain(".coverage/");
      expect(fs.readFileSync(gradleFp, "utf-8")).toContain("demo-v2");
      expect(fs.readFileSync(propsFp, "utf-8")).toContain("-Xmx4g");
      expect(fs.readFileSync(geminiMd, "utf-8")).toContain("enforce user's [0, 1) bounds");
      expect(fs.readFileSync(saveSchemaMd, "utf-8")).toContain("CRC32 Checksum");
      expect(fs.readFileSync(ktPool, "utf-8")).toContain("var maxPlayers: Int = 8");
    });
  });

  describe("B: Empirical cl100k_base BPE Token-Reduction Proof vs Native edit_file / write_file", () => {
    it("proves :Lstart-Lend, :symbol, and multi-file --stdin batch splices use strictly fewer cl100k_base tokens than native tools", () => {
      // 1. :Lstart-Lend surgical splice vs native edit_file (no old_string duplication!)
      const tsLines = ["export class SimulationEngine {"];
      for (let i = 1; i <= 150; i++) {
        tsLines.push(`  public metric_${i}: number = ${i} * 1.25;`);
      }
      tsLines.push(
        "  public stepSimulation(dt: number): number {",
        "    const clampedDt = Math.min(Math.max(dt, 0.001), 0.05);",
        "    const decay = Math.exp(-clampedDt * 4.5);",
        "    const energy = this.metric_1 * decay + this.metric_2 * (1 - decay);",
        "    const damping = energy > 100 ? 0.85 : 0.98;",
        "    return energy * damping;",
        "  }",
        "}",
        "",
      );
      const tsPath = path.join(tmpDir, "SimulationEngine.ts");
      fs.writeFileSync(tsPath, tsLines.join("\n"), "utf-8");

      const oldBlock = tsLines.slice(151, 158).join("\n");
      const newBlock = [
        "  public stepSimulation(dt: number): number {",
        "    const clampedDt = Math.min(Math.max(dt, 0.0005), 0.033);",
        "    const decay = Math.exp(-clampedDt * 6.0);",
        "    const energy = this.metric_1 * decay + this.metric_3 * (1 - decay);",
        "    return energy * (energy > 120 ? 0.8 : 0.99);",
        "  }",
      ].join("\n");

      const aiceLineStdin = `=== SimulationEngine.ts:L152-L158 ===\n${newBlock}\n`;
      const cliLineRes = runCli(["splice", "--stdin"], tmpDir, aiceLineStdin);
      expect(cliLineRes.status).toBe(0);
      expect(cliLineRes.stdout.trim().split("\n")).toHaveLength(1);

      const aiceLineTotalTok =
        estimateTokens(`aice splice --stdin << 'EOF'\n${aiceLineStdin}EOF`, "cl100k_base") +
        estimateTokens(cliLineRes.stdout.trim(), "cl100k_base");
      const nativeEditPayload = JSON.stringify({
        Path: tsPath,
        Target: oldBlock,
        Replacement: newBlock,
      });
      const nativeEditResp = `Successfully edited ${tsPath}`;
      const nativeLineTotalTok =
        estimateTokens(nativeEditPayload, "cl100k_base") +
        estimateTokens(nativeEditResp, "cl100k_base");

      expect(aiceLineTotalTok).toBeLessThan(nativeLineTotalTok);

      // 2. :symbol surgical splice vs native edit_file
      const symNewBlock = [
        "  public stepSimulation(dt: number): number {",
        "    const safeDt = Math.min(Math.max(dt, 0.001), 0.025);",
        "    return (this.metric_1 + this.metric_2) * safeDt;",
        "  }",
      ].join("\n");
      const aiceSymStdin = `=== SimulationEngine.ts:SimulationEngine.stepSimulation ===\n${symNewBlock}\n`;
      const cliSymRes = runCli(["splice", "--stdin"], tmpDir, aiceSymStdin);
      expect(cliSymRes.status).toBe(0);

      const aiceSymTotalTok =
        estimateTokens(`aice splice --stdin << 'EOF'\n${aiceSymStdin}EOF`, "cl100k_base") +
        estimateTokens(cliSymRes.stdout.trim(), "cl100k_base");
      const nativeSymPayload = JSON.stringify({
        Path: tsPath,
        Target: newBlock,
        Replacement: symNewBlock,
      });
      const nativeSymTotalTok =
        estimateTokens(nativeSymPayload, "cl100k_base") +
        estimateTokens(nativeEditResp, "cl100k_base");

      expect(aiceSymTotalTok).toBeLessThan(nativeSymTotalTok);

      // 3. Multi-file --stdin batch splice across TS + MD + JSON + YAML + Py + Java + verify vs native edit_file/write_file
      const mdPath = path.join(tmpDir, "SPEC.md");
      const jsonPath = path.join(tmpDir, "app.json");
      const ymlPath = path.join(tmpDir, "ci.yml");
      const pyPath = path.join(tmpDir, "worker.py");
      const javaPath = path.join(tmpDir, "Bridge.java");
      const verifyPath = path.join(tmpDir, "verify");

      const origFiles: Array<{
        fp: string;
        rel: string;
        orig: string;
        oldSpan: string;
        newSpan: string;
        sel: string;
      }> = [
        {
          fp: mdPath,
          rel: "SPEC.md",
          orig: "# Spec\n## Rules\nRule 1: Keep latency < 50ms across all mobile frames.\nRule 2: Zero silent drops.\n",
          oldSpan:
            "Rule 1: Keep latency < 50ms across all mobile frames.\nRule 2: Zero silent drops.",
          newSpan:
            "Rule 1: Keep p99 latency < 16ms across all 60fps mobile frames.\nRule 2: Zero silent drops or corruptions.",
          sel: "L3-L4",
        },
        {
          fp: jsonPath,
          rel: "app.json",
          orig: '{\n  "name": "demo",\n  "timeoutMs": 3000,\n  "retries": 2\n}\n',
          oldSpan: '  "timeoutMs": 3000,\n  "retries": 2',
          newSpan: '  "timeoutMs": 5000,\n  "retries": 3',
          sel: "L3-L4",
        },
        {
          fp: ymlPath,
          rel: "ci.yml",
          orig: "name: CI\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n",
          oldSpan: "    runs-on: ubuntu-latest\n    steps:\n      - run: npm test",
          newSpan: "    runs-on: ubuntu-latest\n    steps:\n      - run: npm run check && npm test",
          sel: "L4-L6",
        },
        {
          fp: pyPath,
          rel: "worker.py",
          orig: "def process(items: list[int]) -> int:\n    total = sum(items)\n    return total * 2\n",
          oldSpan: "    total = sum(items)\n    return total * 2",
          newSpan: "    total = sum(x for x in items if x > 0)\n    return total * 3",
          sel: "L2-L3",
        },
        {
          fp: javaPath,
          rel: "Bridge.java",
          orig: "package com.demo;\npublic class Bridge {\n    public int version() {\n        return 1;\n    }\n}\n",
          oldSpan: "    public int version() {\n        return 1;\n    }",
          newSpan: "    public int version() {\n        return 2;\n    }",
          sel: "L3-L5",
        },
        {
          fp: verifyPath,
          rel: "verify",
          orig: "#!/usr/bin/env bash\nset -euo pipefail\nnpm test\n",
          oldSpan: "set -euo pipefail\nnpm test",
          newSpan: "set -euo pipefail\nnpm run check && npm test",
          sel: "L2-L3",
        },
      ];

      for (const f of origFiles) {
        fs.writeFileSync(f.fp, f.orig, "utf-8");
      }

      const batchStream =
        origFiles.map((f) => `=== ${f.rel}:${f.sel} ===\n${f.newSpan}`).join("\n") + "\n";
      const batchCliRes = runCli(["splice", "--stdin"], tmpDir, batchStream);
      expect(batchCliRes.status).toBe(0);
      expect(batchCliRes.stdout.trim().split("\n")).toHaveLength(1);

      const aiceBatchTok =
        estimateTokens(`aice splice --stdin << 'EOF'\n${batchStream}EOF`, "cl100k_base") +
        estimateTokens(batchCliRes.stdout.trim(), "cl100k_base");

      const nativeBatchTok = origFiles.reduce((sum, f) => {
        const callJson = JSON.stringify({
          Path: f.fp,
          Target: f.oldSpan,
          Replacement: f.newSpan,
        });
        const respText = `Successfully edited ${f.fp}`;
        return (
          sum + estimateTokens(callJson, "cl100k_base") + estimateTokens(respText, "cl100k_base")
        );
      }, 0);

      expect(aiceBatchTok).toBeLessThan(nativeBatchTok);
    });
  });
});
