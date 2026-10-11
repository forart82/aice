/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for AIL 2.0 Test Runner Engine & CLI Command (Step 11).
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  compileAilFile,
  compileTargetAilIfNeeded,
  discoverTestHarness,
  filterTestErrorOutput,
  findAilFiles,
  isAilCompilationNeeded,
  parseTestSummary,
  resolveTargetFilePath,
  runAilTests,
} from "../../src/runner/index.js";
import { isTargetLocked, lockFile } from "../../src/shield/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cliPath = path.resolve(__dirname, "../../bin/ail.ts");

function runCli(
  args: string[],
  cwd?: string,
): { status: number; stdout: string; stderr: string } {
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

describe("AIL 2.0 Test Runner Engine (Step 11)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ail-test-runner-unit-"));
  });

  afterEach(() => {
    try {
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup error on tmpdir
    }
  });

  describe("Test Harness Discovery (discoverTestHarness)", () => {
    it("discovers vitest when package.json specifies 'vitest run' in scripts.test", () => {
      const pkgPath = path.join(tmpDir, "package.json");
      fs.writeFileSync(
        pkgPath,
        JSON.stringify({
          name: "vitest-project",
          scripts: { test: "vitest run" },
        }),
        "utf-8",
      );

      const harness = discoverTestHarness(tmpDir);
      expect(harness.type).toBe("vitest");
      expect(harness.name).toBe("vitest");
      const args = harness.buildArgs("test/unit.test.ts", {
        verbose: true,
      });
      expect(args).toContain("test/unit.test.ts");
      expect(args).toContain("--reporter=verbose");
    });

    it("discovers bun:test when package.json specifies 'bun test' in scripts.test", () => {
      const pkgPath = path.join(tmpDir, "package.json");
      fs.writeFileSync(
        pkgPath,
        JSON.stringify({
          name: "bun-project",
          scripts: { test: "bun test" },
        }),
        "utf-8",
      );

      const harness = discoverTestHarness(tmpDir);
      expect(harness.type).toBe("bun");
      expect(harness.command).toBe("bun");
      const args = harness.buildArgs("my.test.ts", { reporter: "dots" });
      expect(args).toContain("test");
      expect(args).toContain("--reporter=dots");
      expect(args).toContain("my.test.ts");
    });

    it("discovers node:test when package.json specifies 'node --test' in scripts.test", () => {
      const pkgPath = path.join(tmpDir, "package.json");
      fs.writeFileSync(
        pkgPath,
        JSON.stringify({
          name: "node-project",
          scripts: { test: "node --test" },
        }),
        "utf-8",
      );

      const harness = discoverTestHarness(tmpDir);
      expect(harness.type).toBe("node");
      const args = harness.buildArgs("suite.test.js", { reporter: "tap" });
      expect(args).toContain("--test");
      expect(args).toContain("--test-reporter=tap");
      expect(args).toContain("suite.test.js");
    });

    it("discovers npm runner when package.json contains custom test script", () => {
      const pkgPath = path.join(tmpDir, "package.json");
      fs.writeFileSync(
        pkgPath,
        JSON.stringify({
          name: "custom-project",
          scripts: { test: "custom-runner --all" },
        }),
        "utf-8",
      );

      const harness = discoverTestHarness(tmpDir);
      expect(harness.type).toBe("npm");
      const args = harness.buildArgs("foo.test.ts");
      expect(args).toContain("--");
      expect(args).toContain("foo.test.ts");
    });

    it("honors explicit harness option override", () => {
      const harness = discoverTestHarness(tmpDir, { harness: "node" });
      expect(harness.type).toBe("node");
      expect(harness.baseArgs).toContain("--test");

      const bunHarness = discoverTestHarness(tmpDir, { harness: "bun" });
      expect(bunHarness.type).toBe("bun");
      expect(bunHarness.command).toBe("bun");
    });

    it("falls back to node:test or bun:test when no package.json exists", () => {
      const emptyDir = path.join(tmpDir, "isolated-empty");
      fs.mkdirSync(emptyDir);
      const harness = discoverTestHarness(emptyDir);
      expect(["bun", "node", "vitest"]).toContain(harness.type);
    });
  });

  describe("Test Output Summary Parsing (parseTestSummary)", () => {
    it("parses vitest success summary format", () => {
      const raw = `
 RUN  v5.0.3 /home/forart/dev/ail
 ✓ tests/unit/foo.test.ts (14 tests) 258ms
 Test Files  1 passed (1)
      Tests  14 passed (14)
   Start at  08:23:15
`;
      const summary = parseTestSummary(raw, 0);
      expect(summary.total).toBe(14);
      expect(summary.passed).toBe(14);
      expect(summary.failed).toBe(0);
    });

    it("parses vitest mixed failure format", () => {
      const raw = `
 ❯ tests/unit/bar.test.ts (2 tests | 1 failed) 120ms
   × fails gracefully
 Test Files  1 failed (1)
      Tests  1 failed | 2 passed (3)
`;
      const summary = parseTestSummary(raw, 1);
      expect(summary.total).toBe(3);
      expect(summary.passed).toBe(2);
      expect(summary.failed).toBe(1);
    });

    it("parses bun test output format", () => {
      const raw = `
bun test v1.4.2 (744846f84)
tests/unit/concurrency-pool.test.ts:
✓ AIL 2.0 Async Concurrency Worker Pool > test [76.79ms]
 14 pass
 0 fail
 224 expect() calls
Ran 14 tests across 1 file. [249.00ms]
`;
      const summary = parseTestSummary(raw, 0);
      expect(summary.total).toBe(14);
      expect(summary.passed).toBe(14);
      expect(summary.failed).toBe(0);
    });

    it("parses bun test failure format", () => {
      const raw = `
 8 pass
 2 fail
Ran 10 tests across 1 file. [150.00ms]
`;
      const summary = parseTestSummary(raw, 1);
      expect(summary.total).toBe(10);
      expect(summary.passed).toBe(8);
      expect(summary.failed).toBe(2);
    });

    it("parses node:test TAP output format", () => {
      const raw = `
# Subtest: sample
ok 1 - sample
# tests 5
# pass 4
# fail 1
`;
      const summary = parseTestSummary(raw, 1);
      expect(summary.total).toBe(5);
      expect(summary.passed).toBe(4);
      expect(summary.failed).toBe(1);
    });

    it("parses jest / mocha style summary", () => {
      const raw = "Tests: 2 failed, 12 passed, 14 total";
      const summary = parseTestSummary(raw, 1);
      expect(summary.total).toBe(14);
      expect(summary.passed).toBe(12);
      expect(summary.failed).toBe(2);
    });

    it("falls back to exit code heuristics when runner output has no summary", () => {
      const passSummary = parseTestSummary("All ok!", 0);
      expect(passSummary.failed).toBe(0);
      expect(passSummary.passed).toBeGreaterThanOrEqual(1);

      const failSummary = parseTestSummary("Unknown crash", 1);
      expect(failSummary.failed).toBeGreaterThanOrEqual(1);
      expect(failSummary.total).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Error Output Filtering (filterTestErrorOutput)", () => {
    it("strips internal runner stack frames and leaves developer error intact", () => {
      const raw = `
FAIL tests/unit/calc.test.ts > adds numbers
AssertionError: expected 5 to be 4
  - Expected: 4
  + Received: 5
    at tests/unit/calc.test.ts:15:23
    at runTest (file:///home/forart/dev/ail/node_modules/vitest/dist/chunks/run.js:12:34)
    at async file:///home/forart/dev/ail/node_modules/@vitest/runner/dist/index.js:56:78
    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
`;
      const filtered = filterTestErrorOutput(raw);
      expect(filtered).toContain("FAIL tests/unit/calc.test.ts > adds numbers");
      expect(filtered).toContain("AssertionError: expected 5 to be 4");
      expect(filtered).toContain("at tests/unit/calc.test.ts:15:23");
      expect(filtered).not.toContain("node_modules/vitest/dist/chunks/run.js");
      expect(filtered).not.toContain("node_modules/@vitest/runner");
      expect(filtered).not.toContain("node:internal/process/task_queues");
    });
  });

  describe("Pre-Test Compilation & Staleness Detection", () => {
    it("derives target file path correctly", () => {
      expect(resolveTargetFilePath("/path/to/foo.ts.ail")).toBe(
        "/path/to/foo.ts",
      );
      expect(resolveTargetFilePath("/path/to/bar.test.ail")).toBe(
        "/path/to/bar.test.ts",
      );
      expect(resolveTargetFilePath("/path/to/baz.py.ail")).toBe(
        "/path/to/baz.py",
      );
    });

    it("detects compilation needed when target does not exist", () => {
      const ailFile = path.join(tmpDir, "calc.test.ts.ail");
      fs.writeFileSync(
        ailFile,
        `fn add(a:int, b:int) -> int = a + b\n`,
        "utf-8",
      );

      expect(isAilCompilationNeeded(ailFile)).toBe(true);
    });

    it("compiles .ail file and writes target file via safeWriteTargetFile", () => {
      const ailFile = path.join(tmpDir, "math.ts.ail");
      const targetFile = path.join(tmpDir, "math.ts");

      fs.writeFileSync(
        ailFile,
        `fn multiply(x:int, y:int) -> int = x * y\n`,
        "utf-8",
      );

      const res = compileAilFile(ailFile);
      expect(res.compiled).toBe(true);
      expect(res.targetPath).toBe(targetFile);
      expect(fs.existsSync(targetFile)).toBe(true);
      expect(fs.readFileSync(targetFile, "utf-8")).toContain("multiply");

      // Running compileAilFile again should skip compilation because target is up-to-date
      const secondRun = compileAilFile(ailFile);
      expect(secondRun.compiled).toBe(false);
    });

    it("recompiles target file if .ail source file is updated with newer timestamp", async () => {
      const ailFile = path.join(tmpDir, "greet.ts.ail");
      const targetFile = path.join(tmpDir, "greet.ts");

      fs.writeFileSync(
        ailFile,
        `fn greet() -> str = "v1"\n`,
        "utf-8",
      );
      compileAilFile(ailFile);
      expect(fs.readFileSync(targetFile, "utf-8")).toContain('"v1"');

      // Update .ail source with delay to guarantee newer mtime
      await new Promise((r) => setTimeout(r, 20));
      fs.writeFileSync(
        ailFile,
        `fn greet() -> str = "v2"\n`,
        "utf-8",
      );

      expect(isAilCompilationNeeded(ailFile)).toBe(true);
      const res = compileAilFile(ailFile);
      expect(res.compiled).toBe(true);
      expect(fs.readFileSync(targetFile, "utf-8")).toContain('"v2"');
    });

    it("transparently elevates chmod 444 locked targets during pre-test compilation", () => {
      const ailFile = path.join(tmpDir, "locked.ts.ail");
      const targetFile = path.join(tmpDir, "locked.ts");

      fs.writeFileSync(
        ailFile,
        `fn compute() -> int = 10\n`,
        "utf-8",
      );
      compileAilFile(ailFile);
      lockFile(targetFile);
      expect(isTargetLocked(targetFile)).toBe(true);

      // Now update ail source and recompile
      fs.writeFileSync(
        ailFile,
        `fn compute() -> int = 20\n`,
        "utf-8",
      );
      const now = new Date(Date.now() + 1000);
      fs.utimesSync(ailFile, now, now);

      expect(isAilCompilationNeeded(ailFile)).toBe(true);
      const res = compileAilFile(ailFile);
      expect(res.compiled).toBe(true);
      expect(fs.readFileSync(targetFile, "utf-8")).toContain("20");
      // Verify safeWriteTargetFile restored lock
      expect(isTargetLocked(targetFile)).toBe(true);
    });

    it("finds all .ail files in directory tree", () => {
      const subDir = path.join(tmpDir, "sub");
      fs.mkdirSync(subDir);
      fs.writeFileSync(path.join(tmpDir, "a.ail"), "fn a() -> int = 1\n", "utf-8");
      fs.writeFileSync(path.join(subDir, "b.ail"), "fn b() -> int = 2\n", "utf-8");
      fs.writeFileSync(path.join(subDir, "c.ts"), "export const c = 1;", "utf-8");

      const found = findAilFiles(tmpDir);
      expect(found.length).toBe(2);
    });

    it("compileTargetAilIfNeeded compiles all files in directory or specific target", () => {
      fs.writeFileSync(
        path.join(tmpDir, "one.ts.ail"),
        "fn one() -> int = 1\n",
        "utf-8",
      );
      fs.writeFileSync(
        path.join(tmpDir, "two.ts.ail"),
        "fn two() -> int = 2\n",
        "utf-8",
      );

      const res = compileTargetAilIfNeeded(undefined, { cwd: tmpDir });
      expect(res.compiledFiles.length).toBe(2);
      expect(fs.existsSync(path.join(tmpDir, "one.ts"))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, "two.ts"))).toBe(true);
    });
  });

  describe("runAilTests Execution Engine", () => {
    it("runs tests on an existing test suite and returns clean result", async () => {
      // Run against existing unit test file
      const target = "tests/unit/concurrency-pool.test.ts";
      const result = await runAilTests(target, { cwd: process.cwd() });

      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.summary.total).toBe(14);
      expect(result.summary.passed).toBe(14);
      expect(result.summary.failed).toBe(0);
      expect(result.output.length).toBeGreaterThan(0);
    });

    it("pre-compiles .ail test file and runs test suite on compiled target", async () => {
      // Create a test file in tmpDir
      const ailTestFile = path.join(tmpDir, "sample.test.ts.ail");
      fs.writeFileSync(
        ailTestFile,
        `fn getAnswer() -> int = 42\n`,
        "utf-8",
      );

      const pkgJson = path.join(tmpDir, "package.json");
      fs.writeFileSync(
        pkgJson,
        JSON.stringify({
          name: "sample-suite",
          scripts: { test: "node --test" },
        }),
        "utf-8",
      );

      // Create an actual runnable test in target
      const compRes = compileTargetAilIfNeeded(ailTestFile, { cwd: tmpDir });
      expect(compRes.compiledFiles.length).toBe(1);
      const compiledTarget = compRes.compiledFiles[0];
      expect(fs.existsSync(compiledTarget)).toBe(true);

      // Append node test runner assertions to the compiled target file
      fs.appendFileSync(
        compiledTarget,
        `\nimport test from "node:test";\nimport assert from "node:assert";\ntest("sample passes", () => { assert.strictEqual(getAnswer(), 42); });\n`,
        "utf-8",
      );

      // Run tests on compiled target with bun harness
      const result = await runAilTests(compiledTarget, {
        cwd: tmpDir,
        harness: "bun",
      });

      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.summary.passed).toBeGreaterThanOrEqual(1);
    });

    it("captures test failures and produces clean filtered error without crashing", async () => {
      const testFile = path.join(tmpDir, "failing.test.mjs");
      fs.writeFileSync(
        testFile,
        `import test from "node:test";\nimport assert from "node:assert";\ntest("intentionally fails", () => { assert.strictEqual(1, 2); });\n`,
        "utf-8",
      );

      const result = await runAilTests(testFile, {
        cwd: tmpDir,
        harness: "node",
      });

      expect(result.success).toBe(false);
      expect(result.exitCode).not.toBe(0);
      expect(result.summary.failed).toBeGreaterThanOrEqual(1);
      expect(result.output).toContain("intentionally fails");
    });

    it("catches syntactic/semantic AIL compiler errors prior to running tests", async () => {
      const brokenAil = path.join(tmpDir, "broken.test.ts.ail");
      fs.writeFileSync(
        brokenAil,
        `fn invalidSyntax( { return ; }\n`,
        "utf-8",
      );

      const result = await runAilTests(brokenAil, { cwd: tmpDir });
      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
      expect(result.summary.failed).toBe(1);
      expect(result.output).toContain("❌ AIL Compilation Error");
    });
  });

  describe("CLI Registration & ail test Command Execution", () => {
    it("exports program with test registered command", async () => {
      const { program } = await import("../../bin/ail.ts");
      expect(program).toBeDefined();

      const testCmd = program.commands.find((c) => c.name() === "test");
      expect(testCmd).toBeDefined();
      expect(testCmd?.description()).toContain("Execute tests");

      const options = testCmd?.options.map((o) => o.name());
      expect(options).toContain("reporter");
      expect(options).toContain("json");
      expect(options).toContain("verbose");
    });

    it("executes 'ail test' on a passing test via CLI and exits 0", () => {
      const res = runCli(["test", "tests/unit/concurrency-pool.test.ts"]);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("✔ Tests succeeded: 14/14 passed (0 failed).");
    });

    it("executes 'ail test --verbose' and displays detailed runner output", () => {
      const res = runCli([
        "test",
        "--verbose",
        "tests/unit/concurrency-pool.test.ts",
      ]);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("tests/unit/concurrency-pool.test.ts");
      expect(res.stdout).toContain("✔ Tests succeeded: 14/14 passed (0 failed).");
    });

    it("executes 'ail test --json' and outputs structured machine-readable JSON", () => {
      const res = runCli([
        "test",
        "--json",
        "tests/unit/concurrency-pool.test.ts",
      ]);
      expect(res.status).toBe(0);

      const parsed = JSON.parse(res.stdout);
      expect(parsed.success).toBe(true);
      expect(parsed.exitCode).toBe(0);
      expect(parsed.summary.total).toBe(14);
      expect(parsed.summary.passed).toBe(14);
      expect(parsed.summary.failed).toBe(0);
      expect(parsed.harness).toBe("vitest");
    });

    it("executes 'ail test' on a failing test via CLI and exits 1 with filtered error", () => {
      const failingTest = path.join(tmpDir, "cli_fail.test.mjs");
      fs.writeFileSync(
        failingTest,
        `import test from "node:test";\nimport assert from "node:assert";\ntest("cli failure test", () => { assert.fail("boom"); });\n`,
        "utf-8",
      );

      // Create package.json to route harness to node:test
      fs.writeFileSync(
        path.join(tmpDir, "package.json"),
        JSON.stringify({
          name: "failing-cli-project",
          scripts: { test: "node --test" },
        }),
        "utf-8",
      );

      const res = runCli(["test", failingTest], tmpDir);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain("cli failure test");
      expect(res.stderr).toContain("❌ Tests failed:");
    });
  });
});
