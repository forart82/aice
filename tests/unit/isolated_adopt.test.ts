/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit & Integration Test Suite for `aice adopt --isolate` (Step 15).
 * Verifies clean `src/*.aice` workspace adoption, `.aice-build/` target cache relocation,
 * `aice.config.json` creation with mode: "isolated", and automated ignore file updates.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadProjectConfig,
  resolveTargetOutputPathForConfig,
} from "../../src/config/project-config.js";
import {
  ingestProjectSideBySide,
  updateIgnoreFilesForIsolatedMode,
  ISOLATED_MODE_IGNORE_FILES,
} from "../../src/transpiler/parallel-ingest.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cliPath = path.resolve(__dirname, "../../bin/aice.ts");

function runCli(args: string[], cwd?: string): { status: number; stdout: string; stderr: string } {
  const result = spawnSync("bun", [cliPath, ...args], {
    cwd: cwd ?? process.cwd(),
    encoding: "utf-8",
    env: { ...process.env },
  });
  return {
    status: result.status ?? 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function getAllFiles(dir: string): string[] {
  const results: string[] = [];
  function scan(current: string) {
    if (!fs.existsSync(current)) return;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        scan(full);
      } else if (entry.isFile()) {
        results.push(full);
      }
    }
  }
  scan(dir);
  return results;
}

describe("Step 15: aice adopt --isolate (Clean src/*.aice + .aice-build/ cache)", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "aice-isolate-test-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it("adopts sample project with --isolate via CLI into clean src/*.aice and .aice-build/", () => {
    // 1. Setup sample project with TypeScript source files in src/
    const srcDir = path.join(testDir, "src");
    const mathDir = path.join(srcDir, "math");
    fs.mkdirSync(mathDir, { recursive: true });

    const indexTsContent = `export function greet(name: string): string {\n  return "Hello, " + name;\n}\n`;
    const calcTsContent = `export function add(a: number, b: number): number {\n  return a + b;\n}\n`;

    fs.writeFileSync(path.join(srcDir, "index.ts"), indexTsContent, "utf-8");
    fs.writeFileSync(path.join(mathDir, "calculator.ts"), calcTsContent, "utf-8");

    // Add pre-existing .gitignore with user rules
    const gitignorePath = path.join(testDir, ".gitignore");
    fs.writeFileSync(gitignorePath, "node_modules/\ndist/\n", "utf-8");

    // 2. Execute `aice adopt <dir> --isolate`
    const res = runCli(["adopt", testDir, "--isolate"]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("=== AICE Isolated Adoption Summary ===");
    expect(res.stdout).toContain("Mode:                isolated");
    expect(res.stdout).toContain("Build Out Dir:       .aice-build");
    expect(res.stdout).toContain("2 ingested");

    // 3. Verification that src/ contains ONLY .aice files and 0 .ts files
    const srcFiles = getAllFiles(srcDir);
    expect(srcFiles.length).toBeGreaterThan(0);
    const tsFiles = srcFiles.filter((f) => f.endsWith(".ts"));
    const nonAiceFiles = srcFiles.filter((f) => !f.endsWith(".aice"));

    expect(tsFiles).toHaveLength(0);
    expect(nonAiceFiles).toHaveLength(0);
    expect(srcFiles.every((f) => f.endsWith(".aice"))).toBe(true);

    // Verify expected .aice file locations
    expect(fs.existsSync(path.join(srcDir, "index.aice"))).toBe(true);
    expect(fs.existsSync(path.join(mathDir, "calculator.aice"))).toBe(true);

    // 4. Verification that .aice-build/ contains the target files
    const outDir = path.join(testDir, ".aice-build");
    const outIndexTs = path.join(outDir, "index.ts");
    const outCalcTs = path.join(outDir, "math", "calculator.ts");

    expect(fs.existsSync(outIndexTs)).toBe(true);
    expect(fs.existsSync(outCalcTs)).toBe(true);
    expect(fs.readFileSync(outIndexTs, "utf-8")).toBe(indexTsContent);
    expect(fs.readFileSync(outCalcTs, "utf-8")).toBe(calcTsContent);

    // 5. Verification that aice.config.json was created with mode: "isolated"
    const configPath = path.join(testDir, "aice.config.json");
    expect(fs.existsSync(configPath)).toBe(true);
    const rawConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    expect(rawConfig.mode).toBe("isolated");
    expect(rawConfig.isolated).toBe(true);
    expect(rawConfig.sourceDir).toBe("src");
    expect(rawConfig.outDir).toBe(".aice-build");

    const loaded = loadProjectConfig(testDir);
    expect(loaded.mode).toBe("isolated");
    expect(loaded.isolated).toBe(true);

    // 6. Verification that .aice-build was added to all ignore files
    for (const ignoreFile of ISOLATED_MODE_IGNORE_FILES) {
      const p = path.join(testDir, ignoreFile);
      expect(fs.existsSync(p)).toBe(true);
      const content = fs.readFileSync(p, "utf-8");
      expect(content).toContain(".aice-build");
    }

    // Verify pre-existing .gitignore rules preserved
    const gitignoreContent = fs.readFileSync(gitignorePath, "utf-8");
    expect(gitignoreContent).toContain("node_modules/");
    expect(gitignoreContent).toContain("dist/");
    expect(gitignoreContent).toContain(".aice-build");
  });

  it("supports programmatic ingestProjectSideBySide with isolate: true", async () => {
    const srcDir = path.join(testDir, "src");
    fs.mkdirSync(srcDir, { recursive: true });

    fs.writeFileSync(
      path.join(srcDir, "utils.ts"),
      `export function double(n: number): number {\n  return n * 2;\n}\n`,
      "utf-8",
    );

    const summary = await ingestProjectSideBySide({
      dir: testDir,
      isolate: true,
    });

    expect(summary.totalIngested).toBe(1);
    expect(summary.totalFailed).toBe(0);
    expect(summary.results[0].success).toBe(true);
    expect(summary.results[0].aicePath).toBe(path.join(srcDir, "utils.aice"));
    expect(summary.results[0].relocatedPath).toBe(
      path.join(testDir, ".aice-build", "utils.ts"),
    );

    // Verify src has only .aice
    const srcFiles = getAllFiles(srcDir);
    expect(srcFiles).toHaveLength(1);
    expect(srcFiles[0].endsWith("utils.aice")).toBe(true);
    expect(fs.existsSync(path.join(srcDir, "utils.ts"))).toBe(false);

    // Verify .aice-build has utils.ts
    expect(fs.existsSync(path.join(testDir, ".aice-build", "utils.ts"))).toBe(true);

    // Verify aice.config.json
    const config = loadProjectConfig(testDir);
    expect(config.mode).toBe("isolated");
    expect(config.isolated).toBe(true);

    // Verify path resolution works symmetrically
    const resolvedTarget = resolveTargetOutputPathForConfig(
      path.join(srcDir, "utils.aice"),
      config,
      testDir,
    );
    expect(resolvedTarget).toBe(path.join(testDir, ".aice-build", "utils.ts"));
  });

  it("supports custom --source-dir and --out-dir options", () => {
    const customSrc = path.join(testDir, "app");
    fs.mkdirSync(customSrc, { recursive: true });

    fs.writeFileSync(
      path.join(customSrc, "main.ts"),
      `export const version = "1.0.0";\n`,
      "utf-8",
    );

    const res = runCli([
      "adopt",
      testDir,
      "--isolate",
      "--source-dir",
      "app",
      "--out-dir",
      ".custom-artifacts",
    ]);

    expect(res.status).toBe(0);
    expect(res.stdout).toContain("Source Dir:          app");
    expect(res.stdout).toContain("Build Out Dir:       .custom-artifacts");

    // Verify app contains only main.aice
    const appFiles = getAllFiles(customSrc);
    expect(appFiles).toHaveLength(1);
    expect(appFiles[0].endsWith("main.aice")).toBe(true);
    expect(fs.existsSync(path.join(customSrc, "main.ts"))).toBe(false);

    // Verify .custom-artifacts contains main.ts
    expect(
      fs.existsSync(path.join(testDir, ".custom-artifacts", "main.ts")),
    ).toBe(true);

    // Verify aice.config.json
    const config = loadProjectConfig(testDir);
    expect(config.mode).toBe("isolated");
    expect(config.sourceDir).toBe("app");
    expect(config.outDir).toBe(".custom-artifacts");

    // Verify custom outDir added to ignore files
    for (const ignoreFile of ISOLATED_MODE_IGNORE_FILES) {
      const p = path.join(testDir, ignoreFile);
      expect(fs.existsSync(p)).toBe(true);
      const content = fs.readFileSync(p, "utf-8");
      expect(content).toContain(".custom-artifacts");
    }
  });

  it("respects --dry-run without mutating filesystem in isolated mode", () => {
    const srcDir = path.join(testDir, "src");
    fs.mkdirSync(srcDir, { recursive: true });
    const tsPath = path.join(srcDir, "service.ts");
    fs.writeFileSync(tsPath, `export const serviceName = "auth";\n`, "utf-8");

    const res = runCli(["adopt", testDir, "--isolate", "--dry-run"]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("[DRY-RUN] No changes were written to disk");

    // Original file must still be in src/
    expect(fs.existsSync(tsPath)).toBe(true);
    // .aice file must NOT exist
    expect(fs.existsSync(path.join(srcDir, "service.aice"))).toBe(false);
    // .aice-build must NOT exist
    expect(fs.existsSync(path.join(testDir, ".aice-build"))).toBe(false);
    // aice.config.json must NOT exist
    expect(fs.existsSync(path.join(testDir, "aice.config.json"))).toBe(false);
  });

  it("is idempotent when running adoption twice and does not duplicate ignore rules", () => {
    const srcDir = path.join(testDir, "src");
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(
      path.join(srcDir, "app.ts"),
      `export function run() { return true; }\n`,
      "utf-8",
    );

    // Run 1
    const res1 = runCli(["adopt", testDir, "--isolate"]);
    expect(res1.status).toBe(0);

    // Run 2
    const res2 = runCli(["adopt", testDir, "--isolate"]);
    expect(res2.status).toBe(0);

    // Check .gitignore does not have duplicate .aice-build entries
    const gitignoreContent = fs.readFileSync(path.join(testDir, ".gitignore"), "utf-8");
    const countAiceBuild = (gitignoreContent.match(/\.aice-build\//g) || []).length;
    expect(countAiceBuild).toBe(1);
  });

  it("updateIgnoreFilesForIsolatedMode creates missing files and appends to existing without duplicates", () => {
    // 1. Initial invocation creates all 4 ignore files
    const updated1 = updateIgnoreFilesForIsolatedMode(testDir, ".aice-build");
    expect(updated1).toHaveLength(4);

    for (const ignoreFile of ISOLATED_MODE_IGNORE_FILES) {
      const p = path.join(testDir, ignoreFile);
      expect(fs.existsSync(p)).toBe(true);
      expect(fs.readFileSync(p, "utf-8")).toContain(".aice-build");
    }

    // 2. Second invocation on same dir is a no-op (no duplicates)
    const updated2 = updateIgnoreFilesForIsolatedMode(testDir, ".aice-build");
    expect(updated2).toHaveLength(0);
  });
});
