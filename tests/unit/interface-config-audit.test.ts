/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Comprehensive regression suite for CLI, MCP, Project Config, Markdown Directives & Mandatory Rules fixes:
 * - `bin/aice.mjs` exit code & signal code propagation
 * - `bin/aice.ts` lazy startup & non-hanging `readStdin` on open idle pipes
 * - `aice create <file>` preserving `=== Banner ===` without multi-file stream hijacking
 * - Multi-target `aice outline a b --json` & `--stats`
 * - Single-pass `aice splice -s sym1 -c ... --delete sym2` (`--dry-run` & `--diff`)
 * - `aice idioms` (`scan` vs `scan --save`, `expand --dry-run` + cache unlink, `update --batch` `newTemplate`, 4th `[dir]`)
 * - `saveProjectConfig` malformed JSON guard, `removeMarkdownDirective` `removeIfEmpty`, fenced `AICE:START` immunity
 * - `MANDATORY_AGENT_RULES_MARKDOWN` Section 1 heading & `@clone` / `@replace-docs` directives
 */

import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  hasMarkdownDirective,
  removeMarkdownDirective,
  saveProjectConfig,
  upsertMarkdownDirective,
} from "../../src/config/project-config.js";
import { MANDATORY_AGENT_RULES_MARKDOWN } from "../../src/rules/mandatory-rules.js";

const CLI_TS = path.resolve(process.cwd(), "bin/aice.ts");
const CLI_MJS = path.resolve(process.cwd(), "bin/aice.mjs");
const TSX_BIN = path.resolve(process.cwd(), "node_modules/.bin/tsx");

function runCli(args: string[], cwd: string, input?: string) {
  return spawnSync(TSX_BIN, [CLI_TS, ...args], {
    cwd,
    input,
    encoding: "utf-8",
    timeout: 60000,
  });
}

describe("CLI, Config, Rules & Stdin Interface Audit Regressions", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aice-interface-audit-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("propagates non-zero exit codes accurately through bin/aice.mjs wrapper", () => {
    const okRes = spawnSync(process.execPath, [CLI_MJS, "--version"], {
      cwd: process.cwd(),
      encoding: "utf-8",
      timeout: 60000,
    });
    expect(okRes.status).toBe(0);
    expect(okRes.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);

    const errRes = spawnSync(process.execPath, [CLI_MJS, "outline", "non_existent_path_xyz.ts"], {
      cwd: tmpDir,
      encoding: "utf-8",
      timeout: 60000,
    });
    expect(errRes.status).toBe(1);
  }, 60000);

  it("does not hang on an open idle non-TTY stdin pipe when --stdin is not passed", async () => {
    const result = await new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
      const child = spawn(TSX_BIN, [CLI_TS, "create"], {
        cwd: tmpDir,
        stdio: ["pipe", "pipe", "pipe"],
      });
      // Intentionally keep child.stdin OPEN without writing or calling end()!
      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString("utf-8");
      });
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("CLI hung on open idle stdin pipe!"));
      }, 15000);
      child.on("close", (code) => {
        clearTimeout(timer);
        child.stdin.destroy();
        resolve({ code, stderr });
      });
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Must provide <filePath>");
  }, 60000);

  it("preserves '=== Section ===' and '// === Banner ===' inside explicit single-file 'aice create <file>'", () => {
    const bannerTs = path.join(tmpDir, "banner.ts");
    const content = [
      "// === Engine Constants ===",
      "export const TICK_HZ = 60;",
      "/* === End Banner === */",
    ].join("\n");
    const res = runCli(["create", bannerTs, "-c", content], tmpDir);
    expect(res.status).toBe(0);
    expect(fs.existsSync(bannerTs)).toBe(true);
    const written = fs.readFileSync(bannerTs, "utf-8");
    expect(written).toContain("// === Engine Constants ===");
    expect(written).toContain("export const TICK_HZ = 60;");

    const notesMd = path.join(tmpDir, "NOTES.md");
    const mdRes = runCli(["create", notesMd, "-c", "=== Part A ===\nHello world\n"], tmpDir);
    expect(mdRes.status).toBe(0);
    expect(fs.readFileSync(notesMd, "utf-8")).toContain("=== Part A ===");
  }, 60000);

  it("emits JSON array and Aggregate Token Reduction Metrics on multi-target 'aice outline f1 f2 --json/--stats'", () => {
    const f1 = path.join(tmpDir, "one.ts");
    const f2 = path.join(tmpDir, "two.ts");
    fs.writeFileSync(
      f1,
      "export function calcOne(x: number): number {\n  const y = x * 2 + 1;\n  return y;\n}\n",
      "utf-8",
    );
    fs.writeFileSync(
      f2,
      "export function calcTwo(a: number): number {\n  const b = a * 3 + 2;\n  return b;\n}\n",
      "utf-8",
    );

    const jsonRes = runCli(["outline", "one.ts", "two.ts", "--json"], tmpDir);
    expect(jsonRes.status).toBe(0);
    const parsed = JSON.parse(jsonRes.stdout) as Array<{ file: string }>;
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);

    const statsRes = runCli(["outline", "one.ts", "two.ts", "--stats"], tmpDir);
    expect(statsRes.status).toBe(0);
    expect(statsRes.stdout).toContain("Aggregate Token Reduction Metrics (2 files)");
  }, 60000);

  it("executes primary symbol replacement + --delete <otherSym> in a single atomic pass (--dry-run, --diff, and live)", () => {
    const target = path.join(tmpDir, "atomic.ts");
    const original = [
      "export function keepAndUpdate(): number {",
      "  return 1;",
      "}",
      "",
      "export function obsoleteHelper(): number {",
      "  return 999;",
      "}",
      "",
    ].join("\n");
    fs.writeFileSync(target, original, "utf-8");

    // 1. --dry-run previews BOTH edits and leaves disk untouched
    const dryRes = runCli(
      [
        "splice",
        target,
        "-s",
        "keepAndUpdate",
        "-c",
        "export function keepAndUpdate(): number {\n  return 42;\n}",
        "--delete",
        "obsoleteHelper",
        "--dry-run",
        "--diff",
      ],
      tmpDir,
    );
    expect(dryRes.status).toBe(0);
    expect(dryRes.stdout).toContain("-export function obsoleteHelper");
    const previewBody = dryRes.stdout.split("[Dry Run]")[1] ?? "";
    expect(previewBody).toContain("return 42;");
    expect(previewBody).not.toContain("export function obsoleteHelper");
    expect(fs.readFileSync(target, "utf-8")).toBe(original);

    // 2. Live execution applies both in a single atomic splice
    const liveRes = runCli(
      [
        "splice",
        target,
        "-s",
        "keepAndUpdate",
        "-c",
        "export function keepAndUpdate(): number {\n  return 42;\n}",
        "--delete",
        "obsoleteHelper",
      ],
      tmpDir,
    );
    expect(liveRes.status).toBe(0);
    const updated = fs.readFileSync(target, "utf-8");
    expect(updated).toContain("return 42;");
    expect(updated).not.toContain("obsoleteHelper");
  }, 60000);

  it("enforces read-only 'idioms scan' vs '--save', 'expand --dry-run' + cache unlink, and 'update --batch' newTemplate & 4th [dir]", () => {
    const subDir = path.join(tmpDir, "pkg");
    const srcDir = path.join(subDir, "src");
    fs.mkdirSync(srcDir, { recursive: true });

    const repeatedBody = [
      "export function drawA(ctx: any, x: number, y: number) { ctx.beginPath(); ctx.arc(x, y, 5, 0, 6.28); ctx.fill(); }",
      "export function drawB(ctx: any, x: number, y: number) { ctx.beginPath(); ctx.arc(x, y, 5, 0, 6.28); ctx.fill(); }",
      "export function drawC(ctx: any, x: number, y: number) { ctx.beginPath(); ctx.arc(x, y, 5, 0, 6.28); ctx.fill(); }",
      "export function drawD(ctx: any, x: number, y: number) { ctx.beginPath(); ctx.arc(x, y, 5, 0, 6.28); ctx.fill(); }",
    ].join("\n");
    fs.writeFileSync(path.join(srcDir, "render.ts"), `${repeatedBody}\n`, "utf-8");

    // 1. Default `aice idioms scan` is read-only (does not write aice.config.json or .aice-cache/idioms.json)
    const scanReadOnly = runCli(["idioms", "scan", subDir, "--min-savings", "1"], tmpDir);
    expect(scanReadOnly.status).toBe(0);
    expect(fs.existsSync(path.join(subDir, "aice.config.json"))).toBe(false);
    expect(fs.existsSync(path.join(subDir, ".aice-cache", "idioms.json"))).toBe(false);

    // 2. `aice idioms scan --save` persists to aice.config.json and .aice-cache/idioms.json
    const scanSave = runCli(["idioms", "scan", subDir, "--min-savings", "1", "--save"], tmpDir);
    expect(scanSave.status).toBe(0);
    expect(fs.existsSync(path.join(subDir, "aice.config.json"))).toBe(true);
    expect(fs.existsSync(path.join(subDir, ".aice-cache", "idioms.json"))).toBe(true);

    // Seed a deterministic named idiom & .aice caller in subDir to test 4th [dir], --batch newTemplate, and expand
    fs.writeFileSync(
      path.join(subDir, "aice.config.json"),
      JSON.stringify(
        {
          enabled: true,
          idiomsEnabled: true,
          idioms: {
            $scale: {
              name: "$scale",
              kind: "expr",
              params: [{ name: "$0" }],
              templateAice: "$0 * 2",
              occurrences: 1,
              tokensPerOccurrenceSaved: 2,
              netTokenSavings: 2,
            },
          },
        },
        null,
        2,
      ),
      "utf-8",
    );
    const sampleAice = path.join(srcDir, "math.aice");
    fs.writeFileSync(sampleAice, "pub fn calc(v: int) -> int:\n  ret $scale(v)\n", "utf-8");

    // 3. 4th positional [dir] in `aice idioms update '$scale' '$0 * 3' <subDir>`
    const updPositional = runCli(["idioms", "update", "$scale", "$0 * 3", subDir], tmpDir);
    expect(updPositional.status).toBe(0);
    expect(
      JSON.parse(fs.readFileSync(path.join(subDir, "aice.config.json"), "utf-8")).idioms.$scale
        .templateAice,
    ).toContain("* 3");

    // 4. `aice idioms update --batch` honoring `newTemplate`
    const updBatch = runCli(
      [
        "idioms",
        "update",
        subDir,
        "--batch",
        JSON.stringify([{ name: "$scale", newTemplate: "$0 * 4" }]),
      ],
      tmpDir,
    );
    expect(updBatch.status).toBe(0);
    expect(
      JSON.parse(fs.readFileSync(path.join(subDir, "aice.config.json"), "utf-8")).idioms.$scale
        .templateAice,
    ).toContain("* 4");

    // 5. `aice idioms expand --dry-run` previews without mutating .aice, config, or cache
    const expandDry = runCli(["idioms", "expand", subDir, "--dry-run", "--json"], tmpDir);
    expect(expandDry.status).toBe(0);
    expect(JSON.parse(expandDry.stdout).dryRun).toBe(true);
    expect(fs.readFileSync(sampleAice, "utf-8")).toContain("$scale(v)");
    expect(fs.existsSync(path.join(subDir, ".aice-cache", "idioms.json"))).toBe(true);

    // 6. Live `aice idioms expand` inlines .aice, clears config idioms, and unlinks .aice-cache/idioms.json
    const expandLive = runCli(["idioms", "expand", subDir], tmpDir);
    expect(expandLive.status).toBe(0);
    expect(fs.readFileSync(sampleAice, "utf-8")).not.toContain("$scale");
    expect(
      JSON.parse(fs.readFileSync(path.join(subDir, "aice.config.json"), "utf-8")).idioms,
    ).toBeUndefined();
    expect(fs.existsSync(path.join(subDir, ".aice-cache", "idioms.json"))).toBe(false);
  }, 60000);

  it("guards malformed aice.config.json in saveProjectConfig, honors removeIfEmpty, and ignores fenced AICE:START blocks", () => {
    // 1. Malformed existing JSON throws descriptive error instead of resetting to {}
    const cfgPath = path.join(tmpDir, "aice.config.json");
    fs.writeFileSync(cfgPath, "{ broken_json: true ", "utf-8");
    expect(() => saveProjectConfig(tmpDir, { enabled: true })).toThrow(/malformed AICE config/i);
    expect(fs.readFileSync(cfgPath, "utf-8")).toBe("{ broken_json: true ");
    fs.unlinkSync(cfgPath);

    // 2. Fenced `<!-- AICE:START -->` inside ```markdown code block is ignored by has/upsert/removeMarkdownDirective
    const docMd = path.join(tmpDir, "AGENTS.md");
    const fencedDoc = [
      "# Developer Guide",
      "",
      "Example directive block:",
      "```markdown",
      "<!-- AICE:START -->",
      "Fake example inside code fence",
      "<!-- AICE:END -->",
      "```",
      "",
    ].join("\n");
    fs.writeFileSync(docMd, fencedDoc, "utf-8");

    expect(hasMarkdownDirective(docMd)).toBe(false);
    upsertMarkdownDirective(docMd, "<!-- AICE:START -->\nReal active directive\n<!-- AICE:END -->");
    expect(hasMarkdownDirective(docMd)).toBe(true);
    const withReal = fs.readFileSync(docMd, "utf-8");
    expect(withReal).toContain("Fake example inside code fence");
    expect(withReal).toContain("Real active directive");

    removeMarkdownDirective(docMd, { removeIfEmpty: false });
    const afterRemove = fs.readFileSync(docMd, "utf-8");
    expect(afterRemove).toContain("Fake example inside code fence");
    expect(afterRemove).not.toContain("Real active directive");

    // 3. removeIfEmpty: false keeps an empty file on disk, while removeIfEmpty: true deletes it
    const onlyDirectiveMd = path.join(tmpDir, "ONLY.md");
    fs.writeFileSync(
      onlyDirectiveMd,
      "<!-- AICE:START -->\nOnly directive\n<!-- AICE:END -->\n",
      "utf-8",
    );
    removeMarkdownDirective(onlyDirectiveMd, { removeIfEmpty: false });
    expect(fs.existsSync(onlyDirectiveMd)).toBe(true);
    expect(fs.readFileSync(onlyDirectiveMd, "utf-8")).toBe("");

    fs.writeFileSync(
      onlyDirectiveMd,
      "<!-- AICE:START -->\nOnly directive\n<!-- AICE:END -->\n",
      "utf-8",
    );
    removeMarkdownDirective(onlyDirectiveMd, { removeIfEmpty: true });
    expect(fs.existsSync(onlyDirectiveMd)).toBe(false);
  });

  it("includes Section 1 heading, @clone(SourceSym), and @replace-docs in MANDATORY_AGENT_RULES_MARKDOWN", () => {
    expect(MANDATORY_AGENT_RULES_MARKDOWN).toContain(
      "### 1. Opt-In Activation Gate & Non-AICE Bypass",
    );
    expect(MANDATORY_AGENT_RULES_MARKDOWN).toContain("@clone(SourceSym)");
    expect(MANDATORY_AGENT_RULES_MARKDOWN).toContain("@replace-docs");
  });
});
