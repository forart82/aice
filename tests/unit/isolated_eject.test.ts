/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit & Integration Test Suite for `aice eject --from-build` (Step 17).
 * Verifies restoring target files from .aice-build back to sourceDir,
 * deletion of .aice files (or preservation with --keep-aice), removal of .aice-build
 * and aice.config.json, and cleaning of ignore files and AI shields.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadProjectConfig } from "../../src/config/project-config.js";
import { checkAiShieldStatus } from "../../src/shield/index.js";
import {
  cleanIgnoreFilesForIsolatedMode,
  ejectProject,
  ingestProjectSideBySide,
  ISOLATED_MODE_IGNORE_FILES,
  updateIgnoreFilesForIsolatedMode,
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

describe("Step 17: aice eject --from-build (Isolated Mode Restoration)", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "aice-isolate-eject-test-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it("executes full lifecycle: adopt --isolate -> eject --from-build, restoring files and cleaning workspace", async () => {
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

    // 2. Adopt in isolated mode
    const adoptRes = runCli(["adopt", testDir, "--isolate"]);
    expect(adoptRes.status).toBe(0);
    expect(adoptRes.stdout).toContain("=== AICE Isolated Adoption Summary ===");

    // Verify workspace is in isolated state
    expect(fs.existsSync(path.join(testDir, ".aice-build"))).toBe(true);
    expect(fs.existsSync(path.join(testDir, "aice.config.json"))).toBe(true);
    expect(fs.existsSync(path.join(srcDir, "index.aice"))).toBe(true);
    expect(fs.existsSync(path.join(mathDir, "calculator.aice"))).toBe(true);
    expect(fs.existsSync(path.join(srcDir, "index.ts"))).toBe(false);
    expect(fs.existsSync(path.join(mathDir, "calculator.ts"))).toBe(false);

    // 3. Execute `aice eject <dir> --from-build`
    const ejectRes = runCli(["eject", testDir, "--from-build"]);
    expect(ejectRes.status).toBe(0);
    expect(ejectRes.stdout).toContain("=== AICE Eject Complete ===");
    expect(ejectRes.stdout).toContain("Mode:                isolated (--from-build)");
    expect(ejectRes.stdout).toContain("Restored Targets:    2 file(s) restored to source directory");
    expect(ejectRes.stdout).toContain("Deleted 2 .aice files");
    expect(ejectRes.stdout).toContain("Project successfully restored to standard toolchain state.");

    // 4. Verify target files are restored in src/ with original content
    const restoredIndexTs = path.join(srcDir, "index.ts");
    const restoredCalcTs = path.join(mathDir, "calculator.ts");
    expect(fs.existsSync(restoredIndexTs)).toBe(true);
    expect(fs.existsSync(restoredCalcTs)).toBe(true);
    expect(fs.readFileSync(restoredIndexTs, "utf-8")).toBe(indexTsContent);
    expect(fs.readFileSync(restoredCalcTs, "utf-8")).toBe(calcTsContent);

    // Restored files must be writable (chmod 644)
    fs.writeFileSync(restoredIndexTs, `${indexTsContent}\n// direct write succeeds`, "utf-8");
    expect(fs.readFileSync(restoredIndexTs, "utf-8")).toContain("// direct write succeeds");

    // 5. Verify .aice files are deleted
    expect(fs.existsSync(path.join(srcDir, "index.aice"))).toBe(false);
    expect(fs.existsSync(path.join(mathDir, "calculator.aice"))).toBe(false);

    // 6. Verify .aice-build/ and aice.config.json are deleted
    expect(fs.existsSync(path.join(testDir, ".aice-build"))).toBe(false);
    expect(fs.existsSync(path.join(testDir, "aice.config.json"))).toBe(false);
    expect(fs.existsSync(path.join(testDir, ".aicerc"))).toBe(false);

    // 7. Verify ignore files: pre-existing rules in .gitignore preserved, .aice-build removed
    expect(fs.existsSync(gitignorePath)).toBe(true);
    const gitignoreContent = fs.readFileSync(gitignorePath, "utf-8");
    expect(gitignoreContent).toContain("node_modules/");
    expect(gitignoreContent).toContain("dist/");
    expect(gitignoreContent).not.toContain(".aice-build");

    // Ignore files created exclusively for .aice-build should be unlinked or cleaned
    for (const ignoreFile of [".agentignore", ".cursorignore", ".geminiignore"]) {
      const p = path.join(testDir, ignoreFile);
      if (fs.existsSync(p)) {
        const content = fs.readFileSync(p, "utf-8");
        expect(content).not.toContain(".aice-build");
      }
    }

    // 8. Verify AI shields are inactive
    const shieldStatus = await checkAiShieldStatus(testDir);
    expect(shieldStatus.isActive).toBe(false);
  });

  it("verifies --keep-aice option preserves .aice source files while restoring target files", () => {
    const srcDir = path.join(testDir, "src");
    const mathDir = path.join(srcDir, "math");
    fs.mkdirSync(mathDir, { recursive: true });

    const indexTsContent = `export const msg = "Keep .aice test";\n`;
    const calcTsContent = `export const pi = 3.14159;\n`;

    fs.writeFileSync(path.join(srcDir, "index.ts"), indexTsContent, "utf-8");
    fs.writeFileSync(path.join(mathDir, "calculator.ts"), calcTsContent, "utf-8");

    // Adopt into isolated mode
    const adoptRes = runCli(["adopt", testDir, "--isolate"]);
    expect(adoptRes.status).toBe(0);

    // Eject with --from-build and --keep-aice
    const ejectRes = runCli(["eject", testDir, "--from-build", "--keep-aice"]);
    expect(ejectRes.status).toBe(0);
    expect(ejectRes.stdout).toContain("Restored Targets:    2 file(s) restored to source directory");
    expect(ejectRes.stdout).toContain("AICE Source Files:    Preserved on disk");

    // Verify targets are restored
    expect(fs.existsSync(path.join(srcDir, "index.ts"))).toBe(true);
    expect(fs.existsSync(path.join(mathDir, "calculator.ts"))).toBe(true);

    // Verify .aice files are PRESERVED
    expect(fs.existsSync(path.join(srcDir, "index.aice"))).toBe(true);
    expect(fs.existsSync(path.join(mathDir, "calculator.aice"))).toBe(true);

    // Verify .aice-build and aice.config.json are deleted
    expect(fs.existsSync(path.join(testDir, ".aice-build"))).toBe(false);
    expect(fs.existsSync(path.join(testDir, "aice.config.json"))).toBe(false);
  });

  it("auto-detects isolated mode when eject is invoked without --from-build flag", () => {
    const srcDir = path.join(testDir, "src");
    fs.mkdirSync(srcDir, { recursive: true });

    const serverCode = `export const port = 3000;\nexport function start() { return port; }\n`;
    fs.writeFileSync(path.join(srcDir, "server.ts"), serverCode, "utf-8");

    // Adopt into isolated mode
    const adoptRes = runCli(["adopt", testDir, "--isolate"]);
    expect(adoptRes.status).toBe(0);

    // Run eject WITHOUT --from-build flag: auto-detect should handle it
    const ejectRes = runCli(["eject", testDir]);
    expect(ejectRes.status).toBe(0);
    expect(ejectRes.stdout).toContain("Mode:                isolated (--from-build)");
    expect(ejectRes.stdout).toContain("Restored Targets:    1 file(s) restored to source directory");

    // Targets restored to src/
    expect(fs.existsSync(path.join(srcDir, "server.ts"))).toBe(true);
    expect(fs.readFileSync(path.join(srcDir, "server.ts"), "utf-8")).toBe(serverCode);

    // .aice files deleted by default in isolated mode
    expect(fs.existsSync(path.join(srcDir, "server.aice"))).toBe(false);

    // Build directory deleted
    expect(fs.existsSync(path.join(testDir, ".aice-build"))).toBe(false);
    expect(fs.existsSync(path.join(testDir, "aice.config.json"))).toBe(false);
  });

  it("supports programmatic ejectProject API with custom dirs and options", async () => {
    const appDir = path.join(testDir, "app");
    fs.mkdirSync(appDir, { recursive: true });

    const helperCode = `export function helper(): boolean { return true; }\n`;
    fs.writeFileSync(path.join(appDir, "helper.ts"), helperCode, "utf-8");

    // Adopt programmatically with custom outDir and sourceDir
    await ingestProjectSideBySide({
      dir: testDir,
      isolate: true,
      sourceDir: "app",
      outDir: ".custom-build",
    });

    expect(fs.existsSync(path.join(testDir, ".custom-build", "helper.ts"))).toBe(true);
    expect(fs.existsSync(path.join(appDir, "helper.aice"))).toBe(true);

    // Eject programmatically
    const result = await ejectProject({
      dir: testDir,
      fromBuild: true,
      sourceDir: "app",
      outDir: ".custom-build",
    });

    expect(result.mode).toBe("isolated");
    expect(result.restoredFiles).toHaveLength(1);
    expect(result.restoredFiles[0]).toBe(path.join(appDir, "helper.ts"));
    expect(result.removedAiceFiles).toHaveLength(1);
    expect(result.removedAiceFiles[0]).toBe(path.join(appDir, "helper.aice"));
    expect(result.removedBuildDir).toBe(path.join(testDir, ".custom-build"));

    // Verify disk state
    expect(fs.existsSync(path.join(appDir, "helper.ts"))).toBe(true);
    expect(fs.existsSync(path.join(appDir, "helper.aice"))).toBe(false);
    expect(fs.existsSync(path.join(testDir, ".custom-build"))).toBe(false);
    expect(fs.existsSync(path.join(testDir, "aice.config.json"))).toBe(false);
  });

  it("cleanIgnoreFilesForIsolatedMode removes isolated rules and unlinks files that become empty", () => {
    // 1. File with other rules
    const gitignorePath = path.join(testDir, ".gitignore");
    fs.writeFileSync(
      gitignorePath,
      `node_modules/\ndist/\n# AICE isolated build artifact cache\n.aice-build/\n.aice-build\n`,
      "utf-8",
    );

    // 2. File with only isolated rules
    const cursorignorePath = path.join(testDir, ".cursorignore");
    fs.writeFileSync(
      cursorignorePath,
      `# AICE isolated build artifact cache\n.aice-build/\n.aice-build\n`,
      "utf-8",
    );

    const cleaned = cleanIgnoreFilesForIsolatedMode(testDir, ".aice-build");
    expect(cleaned).toContain(gitignorePath);
    expect(cleaned).toContain(cursorignorePath);

    // .gitignore preserved with other rules
    expect(fs.existsSync(gitignorePath)).toBe(true);
    const gitignoreContent = fs.readFileSync(gitignorePath, "utf-8");
    expect(gitignoreContent).toContain("node_modules/");
    expect(gitignoreContent).toContain("dist/");
    expect(gitignoreContent).not.toContain(".aice-build");

    // .cursorignore unlinked because it became empty
    expect(fs.existsSync(cursorignorePath)).toBe(false);
  });

  it("ejectProject cleanly handles side-by-side mode projects when called programmatically", async () => {
    const srcDir = path.join(testDir, "src");
    fs.mkdirSync(srcDir, { recursive: true });

    const code = `export const value = 42;\n`;
    fs.writeFileSync(path.join(srcDir, "val.ts"), code, "utf-8");

    // Side-by-side ingest
    await ingestProjectSideBySide({
      dir: testDir,
      isolate: false,
    });

    expect(fs.existsSync(path.join(srcDir, "val.ts"))).toBe(true);
    expect(fs.existsSync(path.join(srcDir, "val.ts.aice"))).toBe(true);

    // Eject side-by-side with removeAice: true
    const result = await ejectProject({
      dir: testDir,
      fromBuild: false,
      removeAice: true,
    });

    expect(result.mode).toBe("side-by-side");
    expect(result.restoredFiles).toHaveLength(0);
    expect(result.removedAiceFiles).toHaveLength(1);
    expect(fs.existsSync(path.join(srcDir, "val.ts.aice"))).toBe(false);
    expect(fs.existsSync(path.join(srcDir, "val.ts"))).toBe(true);
  });
});
