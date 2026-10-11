/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit Test Suite for Dual-Mode Execution in `ail compile` and `ail watch` (Step 16).
 * Verifies:
 * 1. Single-file and directory compilation in isolated mode (`src/math.ail` -> `.ail-build/math.ts`).
 * 2. Watch daemon and `recompileSingleFile` updating `.ail-build/` on file change when in isolated mode (< 5ms).
 * 3. Preserving side-by-side behavior when in side-by-side mode.
 * 4. Priority of explicit CLI flags (`--out`, `--out-dir`).
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadProjectConfig, saveProjectConfig } from "../../src/config/index.js";
import { isTargetLocked } from "../../src/shield/index.js";
import {
  AilWatcher,
  recompileSingleFile,
  watchProject,
} from "../../src/watcher/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cliPath = path.resolve(__dirname, "../../bin/ail.ts");

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

async function waitFor(predicate: () => boolean, timeoutMs = 2500, intervalMs = 15): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timeout waiting for condition after ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

function makeWritable(dir: string): void {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    try {
      fs.chmodSync(fullPath, 0o777);
    } catch {
      // ignore
    }
    if (entry.isDirectory()) {
      makeWritable(fullPath);
    }
  }
}

describe("Step 16: Dual-Mode Execution in ail compile and ail watch", () => {
  let tmpDir: string;
  let activeWatcher: AilWatcher | null = null;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ail-dual-mode-test-"));
    activeWatcher = null;
  });

  afterEach(async () => {
    if (activeWatcher?.isWatching()) {
      await activeWatcher.stop();
      activeWatcher = null;
    }

    try {
      if (fs.existsSync(tmpDir)) {
        makeWritable(tmpDir);
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    } catch {
      // ignore cleanup errors
    }
  });

  describe("Isolated Mode Compilation", () => {
    beforeEach(() => {
      saveProjectConfig(tmpDir, {
        mode: "isolated",
        sourceDir: "src",
        outDir: ".ail-build",
        targetLanguage: "typescript",
        isolated: true,
      });
    });

    it("compiles a single file in isolated mode to .ail-build/math.ts via CLI", () => {
      const srcDir = path.join(tmpDir, "src");
      fs.mkdirSync(srcDir, { recursive: true });
      const ailFile = path.join(srcDir, "math.ail");
      fs.writeFileSync(
        ailFile,
        `fn add(a: int, b: int) -> int:
  ret a + b
`,
        "utf-8",
      );

      const res = runCli(["compile", "src/math.ail"], tmpDir);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain(".ail-build/math.ts");

      // Verify emitted output in .ail-build/
      const expectedTarget = path.join(tmpDir, ".ail-build", "math.ts");
      expect(fs.existsSync(expectedTarget)).toBe(true);

      const content = fs.readFileSync(expectedTarget, "utf-8");
      expect(content).toContain("export function add(a: number, b: number): number");
      expect(content).toContain("return (a + b);");

      // Verify source directory is NOT polluted with sibling target
      const siblingTarget = path.join(srcDir, "math.ts");
      expect(fs.existsSync(siblingTarget)).toBe(false);
    });

    it("recompiles single file via recompileSingleFile in isolated mode in < 5ms", async () => {
      const srcDir = path.join(tmpDir, "src");
      fs.mkdirSync(srcDir, { recursive: true });
      const ailFile = path.join(srcDir, "math.ail");
      fs.writeFileSync(
        ailFile,
        `fn multiply(a: int, b: int) -> int:
  ret a * b
`,
        "utf-8",
      );

      // Warm up module caches to ensure measurement isolates incremental compile speed
      await recompileSingleFile(ailFile, { projectRoot: tmpDir });

      const expectedTarget = path.join(tmpDir, ".ail-build", "math.ts");
      const result = await recompileSingleFile(ailFile, { projectRoot: tmpDir });

      expect(result.success).toBe(true);
      expect(result.targetFile).toBe(expectedTarget);
      expect(result.durationMs).toBeLessThan(5);
      expect(fs.existsSync(expectedTarget)).toBe(true);

      const content = fs.readFileSync(expectedTarget, "utf-8");
      expect(content).toContain("export function multiply(a: number, b: number): number");
      expect(isTargetLocked(expectedTarget)).toBe(true);
    });

    it("compiles all files in isolated mode to .ail-build/... via compile-all", () => {
      const srcDir = path.join(tmpDir, "src");
      const utilsDir = path.join(srcDir, "utils");
      fs.mkdirSync(utilsDir, { recursive: true });

      fs.writeFileSync(
        path.join(srcDir, "math.ail"),
        `fn add(a: int, b: int) -> int:
  ret a + b
`,
        "utf-8",
      );

      fs.writeFileSync(
        path.join(utilsDir, "calc.ail"),
        `fn square(n: int) -> int:
  ret n * n
`,
        "utf-8",
      );

      const res = runCli(["compile-all"], tmpDir);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain(".ail-build/math.ts");
      expect(res.stdout).toContain(".ail-build/utils/calc.ts");

      // Emitted targets exist in .ail-build/
      const targetMath = path.join(tmpDir, ".ail-build", "math.ts");
      const targetCalc = path.join(tmpDir, ".ail-build", "utils", "calc.ts");
      expect(fs.existsSync(targetMath)).toBe(true);
      expect(fs.existsSync(targetCalc)).toBe(true);

      // No sibling targets in src/
      expect(fs.existsSync(path.join(srcDir, "math.ts"))).toBe(false);
      expect(fs.existsSync(path.join(utilsDir, "calc.ts"))).toBe(false);
    });

    it("respects CLI flag --out to override default .ail-build target in isolated mode", () => {
      const srcDir = path.join(tmpDir, "src");
      fs.mkdirSync(srcDir, { recursive: true });
      const ailFile = path.join(srcDir, "math.ail");
      fs.writeFileSync(
        ailFile,
        `fn doubleVal(n: int) -> int:
  ret n * 2
`,
        "utf-8",
      );

      const customOut = path.join(tmpDir, "custom", "custom-math.ts");
      const res = runCli(["compile", "src/math.ail", "--out", "custom/custom-math.ts"], tmpDir);
      expect(res.status).toBe(0);

      expect(fs.existsSync(customOut)).toBe(true);
      expect(fs.readFileSync(customOut, "utf-8")).toContain("doubleVal");

      // Default .ail-build was not used because CLI flag has highest priority
      expect(fs.existsSync(path.join(tmpDir, ".ail-build", "math.ts"))).toBe(false);
    });

    it("respects CLI flag --out-dir to override default .ail-build in compile-all", () => {
      const srcDir = path.join(tmpDir, "src");
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(
        path.join(srcDir, "math.ail"),
        `fn getOne() -> int:\n  ret 1\n`,
        "utf-8",
      );

      const res = runCli(["compile-all", "--out-dir", "dist-out"], tmpDir);
      expect(res.status).toBe(0);

      const customOut = path.join(tmpDir, "dist-out", "math.ts");
      expect(fs.existsSync(customOut)).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, ".ail-build", "math.ts"))).toBe(false);
    });
  });

  describe("Watch Daemon in Isolated Mode", () => {
    beforeEach(() => {
      saveProjectConfig(tmpDir, {
        mode: "isolated",
        sourceDir: "src",
        outDir: ".ail-build",
        targetLanguage: "typescript",
        isolated: true,
      });
    });

    it("automatically recompiles to .ail-build/ on file change in < 5ms", async () => {
      const srcDir = path.join(tmpDir, "src");
      fs.mkdirSync(srcDir, { recursive: true });
      const ailFile = path.join(srcDir, "math.ail");
      const targetFile = path.join(tmpDir, ".ail-build", "math.ts");

      fs.writeFileSync(
        ailFile,
        `fn getScore() -> int:
  ret 10
`,
        "utf-8",
      );

      let successCount = 0;
      let lastTarget = "";
      let lastDurationMs = 0;

      activeWatcher = await watchProject(tmpDir, {
        debounceMs: 20,
        onCompileSuccess: (_ail, target, duration) => {
          successCount++;
          lastTarget = target;
          lastDurationMs = duration;
        },
      });

      await new Promise((r) => setTimeout(r, 40));

      // Modify the .ail source file
      fs.writeFileSync(
        ailFile,
        `fn getScore() -> int:
  ret 42
`,
        "utf-8",
      );

      await waitFor(() => successCount >= 1 && fs.existsSync(targetFile));

      expect(lastTarget).toBe(targetFile);
      expect(lastDurationMs).toBeLessThan(5);

      const updated = fs.readFileSync(targetFile, "utf-8");
      expect(updated).toContain("42");
      expect(isTargetLocked(targetFile)).toBe(true);

      // Verify no sibling file was created
      expect(fs.existsSync(path.join(srcDir, "math.ts"))).toBe(false);
    });

    it("notifies deletion with .ail-build target path when .ail file is deleted", async () => {
      const srcDir = path.join(tmpDir, "src");
      fs.mkdirSync(srcDir, { recursive: true });
      const ailFile = path.join(srcDir, "temp.ail");
      const targetFile = path.join(tmpDir, ".ail-build", "temp.ts");

      fs.writeFileSync(ailFile, `fn temp():\n  ret\n`, "utf-8");

      let deletedAil = "";
      let deletedTarget = "";

      activeWatcher = await watchProject(tmpDir, {
        debounceMs: 20,
        onFileDeleted: (ail, target) => {
          deletedAil = ail;
          deletedTarget = target;
        },
      });

      await new Promise((r) => setTimeout(r, 40));

      fs.unlinkSync(ailFile);

      await waitFor(() => deletedAil !== "");
      expect(deletedAil).toBe(path.resolve(ailFile));
      expect(deletedTarget).toBe(targetFile);
    });
  });

  describe("Preserving Side-by-Side Mode Behavior", () => {
    beforeEach(() => {
      saveProjectConfig(tmpDir, {
        mode: "side-by-side",
        sourceDir: "src",
        outDir: ".ail-build",
        targetLanguage: "typescript",
        isolated: false,
      });
    });

    it("compiles single file to sibling target in-place via CLI", () => {
      const srcDir = path.join(tmpDir, "src");
      fs.mkdirSync(srcDir, { recursive: true });
      const ailFile = path.join(srcDir, "math.ts.ail");
      fs.writeFileSync(
        ailFile,
        `fn add(a: int, b: int) -> int:
  ret a + b
`,
        "utf-8",
      );

      const res = runCli(["compile", "src/math.ts.ail"], tmpDir);
      expect(res.status).toBe(0);

      // In side-by-side mode, target is in-place sibling
      const siblingTarget = path.join(srcDir, "math.ts");
      expect(fs.existsSync(siblingTarget)).toBe(true);
      expect(fs.readFileSync(siblingTarget, "utf-8")).toContain("export function add");

      // .ail-build directory should NOT be created
      expect(fs.existsSync(path.join(tmpDir, ".ail-build"))).toBe(false);
    });

    it("recompiles single file to sibling target via recompileSingleFile", async () => {
      const srcDir = path.join(tmpDir, "src");
      fs.mkdirSync(srcDir, { recursive: true });
      const ailFile = path.join(srcDir, "calc.ts.ail");
      fs.writeFileSync(
        ailFile,
        `fn getPi() -> int:
  ret 3
`,
        "utf-8",
      );

      const siblingTarget = path.join(srcDir, "calc.ts");
      const result = await recompileSingleFile(ailFile, { projectRoot: tmpDir });

      expect(result.success).toBe(true);
      expect(result.targetFile).toBe(siblingTarget);
      expect(result.durationMs).toBeLessThan(5);
      expect(fs.existsSync(siblingTarget)).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, ".ail-build"))).toBe(false);
    });

    it("compiles directory to sibling targets in-place via compile-all", () => {
      const srcDir = path.join(tmpDir, "src");
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(
        path.join(srcDir, "math.ts.ail"),
        `fn f1() -> int:\n  ret 1\n`,
        "utf-8",
      );
      fs.writeFileSync(
        path.join(srcDir, "helper.ail"),
        `fn f2() -> int:\n  ret 2\n`,
        "utf-8",
      );

      const res = runCli(["compile-all"], tmpDir);
      expect(res.status).toBe(0);

      expect(fs.existsSync(path.join(srcDir, "math.ts"))).toBe(true);
      expect(fs.existsSync(path.join(srcDir, "helper.ts"))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, ".ail-build"))).toBe(false);
    });

    it("watch daemon emits to sibling target in-place when in side-by-side mode", async () => {
      const srcDir = path.join(tmpDir, "src");
      fs.mkdirSync(srcDir, { recursive: true });
      const ailFile = path.join(srcDir, "counter.ts.ail");
      const siblingTarget = path.join(srcDir, "counter.ts");

      fs.writeFileSync(
        ailFile,
        `fn getCount() -> int:
  ret 100
`,
        "utf-8",
      );

      let successCount = 0;
      let lastTarget = "";

      activeWatcher = await watchProject(tmpDir, {
        debounceMs: 20,
        onCompileSuccess: (_ail, target) => {
          successCount++;
          lastTarget = target;
        },
      });

      await new Promise((r) => setTimeout(r, 40));

      fs.writeFileSync(
        ailFile,
        `fn getCount() -> int:
  ret 200
`,
        "utf-8",
      );

      await waitFor(() => successCount >= 1 && fs.existsSync(siblingTarget));

      expect(lastTarget).toBe(siblingTarget);
      expect(fs.readFileSync(siblingTarget, "utf-8")).toContain("200");
      expect(fs.existsSync(path.join(tmpDir, ".ail-build"))).toBe(false);
    });

    it("respects CLI flag --out in side-by-side mode overriding sibling target", () => {
      const srcDir = path.join(tmpDir, "src");
      fs.mkdirSync(srcDir, { recursive: true });
      const ailFile = path.join(srcDir, "calc.ts.ail");
      fs.writeFileSync(
        ailFile,
        `fn calc():\n  ret\n`,
        "utf-8",
      );

      const customOut = path.join(tmpDir, "custom-out.ts");
      const res = runCli(["compile", "src/calc.ts.ail", "--out", "custom-out.ts"], tmpDir);
      expect(res.status).toBe(0);

      expect(fs.existsSync(customOut)).toBe(true);
      expect(fs.existsSync(path.join(srcDir, "calc.ts"))).toBe(false);
    });
  });

  describe("Auto-Detection & Multi-Language Dual Mode", () => {
    it("mirrors dual-extension tsx files to .ail-build in isolated mode", () => {
      saveProjectConfig(tmpDir, {
        mode: "isolated",
        sourceDir: "src",
        outDir: ".ail-build",
        targetLanguage: "typescript",
        isolated: true,
      });

      const srcDir = path.join(tmpDir, "src", "components");
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(
        path.join(srcDir, "Button.tsx.ail"),
        `fn Button() -> str:\n  ret "btn"\n`,
        "utf-8",
      );

      const res = runCli(["compile", "src/components/Button.tsx.ail"], tmpDir);
      expect(res.status).toBe(0);

      const expectedTarget = path.join(tmpDir, ".ail-build", "components", "Button.tsx");
      expect(fs.existsSync(expectedTarget)).toBe(true);
      expect(fs.existsSync(path.join(srcDir, "Button.tsx"))).toBe(false);
    });

    it("auto-detects isolated mode when .ail-build folder exists without config", async () => {
      // Create .ail-build folder to trigger auto-detection of isolated mode
      fs.mkdirSync(path.join(tmpDir, ".ail-build"), { recursive: true });
      const srcDir = path.join(tmpDir, "src");
      fs.mkdirSync(srcDir, { recursive: true });
      const ailFile = path.join(srcDir, "math.ail");
      fs.writeFileSync(
        ailFile,
        `fn add(a: int, b: int) -> int:\n  ret a + b\n`,
        "utf-8",
      );

      const result = await recompileSingleFile(ailFile, { projectRoot: tmpDir });
      expect(result.success).toBe(true);
      expect(result.targetFile).toBe(path.join(tmpDir, ".ail-build", "math.ts"));
      expect(fs.existsSync(path.join(tmpDir, ".ail-build", "math.ts"))).toBe(true);
      expect(fs.existsSync(path.join(srcDir, "math.ts"))).toBe(false);
    });
  });
});
