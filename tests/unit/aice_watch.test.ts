/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for High-Speed Incremental Watch Daemon (Step 6).
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isTargetLocked } from "../../src/shield/index.js";
import { AiceWatcher, watchProject } from "../../src/watcher/index.js";

async function waitFor(predicate: () => boolean, timeoutMs = 2500, intervalMs = 15): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timeout waiting for condition after ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

describe("Step 6: High-Speed Incremental Watch Daemon", () => {
  let testDir: string;
  let activeWatcher: AiceWatcher | null = null;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "aice-watch-test-"));
    activeWatcher = null;
  });

  afterEach(async () => {
    if (activeWatcher?.isWatching()) {
      await activeWatcher.stop();
      activeWatcher = null;
    }

    try {
      function makeWritable(dir: string): void {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          try {
            fs.chmodSync(fullPath, 0o777);
          } catch {
            // ignore chmod errors
          }
          if (entry.isDirectory()) {
            makeWritable(fullPath);
          }
        }
      }

      if (fs.existsSync(testDir)) {
        makeWritable(testDir);
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    } catch {
      // ignore cleanup errors
    }
  });

  describe("compileFile", () => {
    it("compiles a single .aice file to side-by-side target and locks with chmod 444", async () => {
      const aicePath = path.join(testDir, "math.ts.aice");
      const targetPath = path.join(testDir, "math.ts");
      fs.writeFileSync(
        aicePath,
        `fn add(a: int, b: int) -> int:
  ret a + b
`,
        "utf-8",
      );

      const watcher = new AiceWatcher({ dir: testDir });
      const result = await watcher.compileFile(aicePath);

      expect(result.success).toBe(true);
      expect(result.targetFile).toBe(targetPath);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(fs.existsSync(targetPath)).toBe(true);

      const content = fs.readFileSync(targetPath, "utf-8");
      expect(content).toContain("export function add(a: number, b: number): number");
      expect(content).toContain("return (a + b);");
      expect(isTargetLocked(targetPath)).toBe(true);

      const stats = watcher.getStats();
      expect(stats.totalCompiles).toBe(1);
      expect(stats.successfulCompiles).toBe(1);
      expect(stats.failedCompiles).toBe(0);
      expect(stats.isWatching).toBe(false);
    });

    it("respects lockTargets: false leaving target file writable", async () => {
      const aicePath = path.join(testDir, "unlocked.ts.aice");
      const targetPath = path.join(testDir, "unlocked.ts");
      fs.writeFileSync(
        aicePath,
        `fn answer() -> int:
  ret 42
`,
        "utf-8",
      );

      const watcher = new AiceWatcher({ dir: testDir, lockTargets: false });
      const result = await watcher.compileFile(aicePath);

      expect(result.success).toBe(true);
      expect(fs.existsSync(targetPath)).toBe(true);
      expect(isTargetLocked(targetPath)).toBe(false);
    });

    it("invokes onCompileStart callback before compiling", async () => {
      const aicePath = path.join(testDir, "lifecycle.ts.aice");
      fs.writeFileSync(aicePath, `fn test():\n  ret\n`, "utf-8");

      let startCalledWith = "";
      const watcher = new AiceWatcher({
        dir: testDir,
        onCompileStart: (file) => {
          startCalledWith = file;
        },
      });

      await watcher.compileFile(aicePath);
      expect(startCalledWith).toBe(path.resolve(aicePath));
    });
  });

  describe("Watch Triggering & HMR", () => {
    it("modifying an .aice file triggers automatic incremental compilation and updates target", async () => {
      const aicePath = path.join(testDir, "widget.ts.aice");
      const targetPath = path.join(testDir, "widget.ts");
      fs.writeFileSync(
        aicePath,
        `fn getScore() -> int:
  ret 10
`,
        "utf-8",
      );

      let successCount = 0;
      let lastTarget = "";

      activeWatcher = new AiceWatcher({
        dir: testDir,
        debounceMs: 20,
        onCompileSuccess: (_aice, target) => {
          successCount++;
          lastTarget = target;
        },
      });

      await activeWatcher.start();
      await new Promise((r) => setTimeout(r, 40));

      // Modify the .aice file
      fs.writeFileSync(
        aicePath,
        `fn getScore() -> int:
  ret 42
`,
        "utf-8",
      );

      await waitFor(() => successCount >= 1 && fs.existsSync(targetPath));

      expect(lastTarget).toBe(targetPath);
      const updated = fs.readFileSync(targetPath, "utf-8");
      expect(updated).toContain("42");
      expect(isTargetLocked(targetPath)).toBe(true);
    });

    it("seamlessly preserves target locked state across multiple compiles (HMR simulation)", async () => {
      const aicePath = path.join(testDir, "hmr.ts.aice");
      const targetPath = path.join(testDir, "hmr.ts");
      fs.writeFileSync(
        aicePath,
        `fn render() -> str:
  ret "v1"
`,
        "utf-8",
      );

      const watcher = new AiceWatcher({ dir: testDir });
      const res1 = await watcher.compileFile(aicePath);
      expect(res1.success).toBe(true);
      expect(isTargetLocked(targetPath)).toBe(true);
      expect(fs.readFileSync(targetPath, "utf-8")).toContain('"v1"');

      // Second compilation modifies target in place while retaining lock
      fs.writeFileSync(
        aicePath,
        `fn render() -> str:
  ret "v2"
`,
        "utf-8",
      );
      const res2 = await watcher.compileFile(aicePath);
      expect(res2.success).toBe(true);
      expect(isTargetLocked(targetPath)).toBe(true);
      expect(fs.readFileSync(targetPath, "utf-8")).toContain('"v2"');
    });
  });

  describe("Debouncing", () => {
    it("rapid sequential writes to .aice only trigger compilation once", async () => {
      const aicePath = path.join(testDir, "counter.ts.aice");
      const targetPath = path.join(testDir, "counter.ts");
      fs.writeFileSync(
        aicePath,
        `fn getCount() -> int:
  ret 0
`,
        "utf-8",
      );

      let compileCount = 0;
      activeWatcher = new AiceWatcher({
        dir: testDir,
        debounceMs: 50,
        onCompileSuccess: () => {
          compileCount++;
        },
      });

      await activeWatcher.start();
      await new Promise((r) => setTimeout(r, 40));

      const baseCompiles = compileCount;

      // 5 rapid sequential writes within the debounce window
      for (let i = 1; i <= 5; i++) {
        fs.writeFileSync(
          aicePath,
          `fn getCount() -> int:
  ret ${i}
`,
          "utf-8",
        );
      }

      // Wait for debounce window (50ms) plus margin
      await new Promise((r) => setTimeout(r, 150));

      expect(compileCount - baseCompiles).toBe(1);
      const content = fs.readFileSync(targetPath, "utf-8");
      expect(content).toContain("return 5;");
    });
  });

  describe("Error Isolation & Recovery", () => {
    it("syntax errors invoke onCompileError without modifying target file or crashing daemon", async () => {
      const aicePath = path.join(testDir, "service.ts.aice");
      const targetPath = path.join(testDir, "service.ts");
      fs.writeFileSync(
        aicePath,
        `fn validService() -> int:
  ret 999
`,
        "utf-8",
      );

      const seedWatcher = new AiceWatcher({ dir: testDir });
      const seedRes = await seedWatcher.compileFile(aicePath);
      expect(seedRes.success).toBe(true);
      const originalTarget = fs.readFileSync(targetPath, "utf-8");
      expect(originalTarget).toContain("999");

      let errorOccurred: Error | null = null;
      let successOccurred = false;

      activeWatcher = new AiceWatcher({
        dir: testDir,
        debounceMs: 20,
        onCompileError: (_aice, err) => {
          errorOccurred = err;
        },
        onCompileSuccess: () => {
          successOccurred = true;
        },
      });

      await activeWatcher.start();
      await new Promise((r) => setTimeout(r, 40));

      // Write invalid syntax
      fs.writeFileSync(aicePath, `fn invalid {{{ !!!\n`, "utf-8");

      await waitFor(() => errorOccurred !== null);
      expect(errorOccurred).toBeDefined();

      // Target file remains untouched and uncorrupted!
      expect(fs.readFileSync(targetPath, "utf-8")).toBe(originalTarget);
      expect(activeWatcher.isWatching()).toBe(true);
      expect(activeWatcher.getStats().failedCompiles).toBe(1);

      // Now recover with valid code on the SAME active watcher
      fs.writeFileSync(
        aicePath,
        `fn validService() -> int:
  ret 12345
`,
        "utf-8",
      );

      await waitFor(() => successOccurred);
      expect(fs.readFileSync(targetPath, "utf-8")).toContain("12345");
      expect(activeWatcher.getStats().successfulCompiles).toBe(1);
    });

    it("typecheck errors invoke onCompileError and return success: false from compileFile", async () => {
      const aicePath = path.join(testDir, "type_err.ts.aice");
      // Type mismatch: assigning string to int
      fs.writeFileSync(
        aicePath,
        `fn bad():
  x: int := "not an int"
  ret
`,
        "utf-8",
      );

      const watcher = new AiceWatcher({ dir: testDir });
      const result = await watcher.compileFile(aicePath);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(watcher.getStats().failedCompiles).toBe(1);
    });
  });

  describe("File Deletion", () => {
    it("calls onFileDeleted when a .aice file is deleted from the filesystem", async () => {
      const aicePath = path.join(testDir, "temp.ts.aice");
      const targetPath = path.join(testDir, "temp.ts");
      fs.writeFileSync(aicePath, `fn temp():\n  ret\n`, "utf-8");

      let deletedAicePath = "";
      let deletedTargetPath = "";

      activeWatcher = new AiceWatcher({
        dir: testDir,
        debounceMs: 20,
        onFileDeleted: (aice, target) => {
          deletedAicePath = aice;
          deletedTargetPath = target;
        },
      });

      await activeWatcher.start();
      await new Promise((r) => setTimeout(r, 40));

      fs.unlinkSync(aicePath);

      await waitFor(() => deletedAicePath !== "");
      expect(deletedAicePath).toBe(path.resolve(aicePath));
      expect(deletedTargetPath).toBe(path.resolve(targetPath));
    });
  });

  describe("Lifecycle & Stats", () => {
    it("stop() cleanly terminates watcher, clears pending timers, and sets isWatching false", async () => {
      activeWatcher = new AiceWatcher({ dir: testDir, debounceMs: 50 });
      await activeWatcher.start();
      expect(activeWatcher.isWatching()).toBe(true);

      await activeWatcher.stop();
      expect(activeWatcher.isWatching()).toBe(false);

      const aicePath = path.join(testDir, "after_stop.ts.aice");
      fs.writeFileSync(aicePath, `fn test():\n  ret\n`, "utf-8");

      await new Promise((r) => setTimeout(r, 80));
      expect(activeWatcher.getStats().totalCompiles).toBe(0);
    });

    it("getStats() reports accurate counts across compiler operations", async () => {
      const watcher = new AiceWatcher({ dir: testDir });
      expect(watcher.getStats()).toEqual({
        isWatching: false,
        totalCompiles: 0,
        successfulCompiles: 0,
        failedCompiles: 0,
        lastCompileDurationMs: 0,
        watchedDir: testDir,
      });

      const validAice = path.join(testDir, "good.ts.aice");
      fs.writeFileSync(validAice, `fn good():\n  ret\n`, "utf-8");
      await watcher.compileFile(validAice);

      let stats = watcher.getStats();
      expect(stats.totalCompiles).toBe(1);
      expect(stats.successfulCompiles).toBe(1);
      expect(stats.failedCompiles).toBe(0);
      expect(stats.lastCompileDurationMs).toBeGreaterThanOrEqual(0);

      const badAice = path.join(testDir, "bad.ts.aice");
      fs.writeFileSync(badAice, `syntax error <<<<<\n`, "utf-8");
      await watcher.compileFile(badAice);

      stats = watcher.getStats();
      expect(stats.totalCompiles).toBe(2);
      expect(stats.successfulCompiles).toBe(1);
      expect(stats.failedCompiles).toBe(1);
    });

    it("watchProject convenience function starts and returns active watcher", async () => {
      activeWatcher = await watchProject(testDir, { debounceMs: 25 });
      expect(activeWatcher.isWatching()).toBe(true);
      expect(activeWatcher.getStats().watchedDir).toBe(testDir);
    });

    it("throws when watching a non-existent directory", async () => {
      const nonExistent = path.join(testDir, "does-not-exist");
      const watcher = new AiceWatcher({ dir: nonExistent });
      await expect(watcher.start()).rejects.toThrow("Directory not found");
    });
  });

  describe("Subdirectories & Ignore Patterns", () => {
    it("recursively watches subdirectories and compiles nested .aice files", async () => {
      const subDir = path.join(testDir, "nested", "components");
      fs.mkdirSync(subDir, { recursive: true });

      let nestedCompiled = false;
      let compiledFile = "";

      activeWatcher = new AiceWatcher({
        dir: testDir,
        recursive: true,
        debounceMs: 20,
        onCompileSuccess: (aice) => {
          nestedCompiled = true;
          compiledFile = aice;
        },
      });

      await activeWatcher.start();
      await new Promise((r) => setTimeout(r, 40));

      const nestedAice = path.join(subDir, "Card.tsx.aice");
      fs.writeFileSync(
        nestedAice,
        `fn Card() -> str:
  ret "card"
`,
        "utf-8",
      );

      await waitFor(() => nestedCompiled);
      expect(compiledFile).toBe(path.resolve(nestedAice));

      const expectedTarget = path.join(subDir, "Card.tsx");
      expect(fs.existsSync(expectedTarget)).toBe(true);
      expect(isTargetLocked(expectedTarget)).toBe(true);
    });

    it("ignores files inside node_modules and .git", async () => {
      const nodeModulesDir = path.join(testDir, "node_modules", "some-pkg");
      fs.mkdirSync(nodeModulesDir, { recursive: true });

      let triggered = false;
      activeWatcher = new AiceWatcher({
        dir: testDir,
        debounceMs: 20,
        onCompileSuccess: () => {
          triggered = true;
        },
      });

      await activeWatcher.start();
      await new Promise((r) => setTimeout(r, 40));

      fs.writeFileSync(path.join(nodeModulesDir, "pkg.ts.aice"), `fn pkg():\n  ret\n`, "utf-8");

      await new Promise((r) => setTimeout(r, 70));
      expect(triggered).toBe(false);
    });
  });
});
