/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for Companion Twin-Workspace Test Execution & Stack-Trace Reverse Mapping (Step 4.1 & 4.2).
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  compileTargetAilIfNeeded,
  discoverTestHarness,
  formatCleanTestOutput,
  formatSymbolAwareError,
  resolveToAilFile,
  runAilTests,
  scrubTargetFileReferences,
  translateTrace,
  translateTraceLine,
} from "../../src/runner/index.js";

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

describe("Companion Twin-Workspace Test Execution & Stack-Trace Reverse Mapping (Step 4.1 & 4.2)", () => {
  let tmpRoot: string;
  let targetDir: string;
  let companionDir: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ail-companion-test-"));
    targetDir = path.join(tmpRoot, "target-app");
    companionDir = path.join(tmpRoot, "companion-ws");

    // 1. Create target project structure
    fs.mkdirSync(path.join(targetDir, "src", "core"), { recursive: true });
    fs.mkdirSync(path.join(targetDir, "tests"), { recursive: true });

    fs.writeFileSync(
      path.join(targetDir, "package.json"),
      JSON.stringify(
        {
          name: "target-app",
          type: "module",
          scripts: {
            test: "bun test",
          },
        },
        null,
        2,
      ),
      "utf-8",
    );

    // 2. Create companion workspace structure
    fs.mkdirSync(path.join(companionDir, "src", "core"), { recursive: true });

    fs.writeFileSync(
      path.join(companionDir, "ail.config.json"),
      JSON.stringify(
        {
          mode: "companion",
          sourceDir: "src",
          outDir: "../target-app/src",
          targetProjectDir: "../target-app",
          targetLanguage: "typescript",
          test: {
            command: "bun test",
            cwd: "../target-app",
            scrubTraces: true,
          },
        },
        null,
        2,
      ),
      "utf-8",
    );

    // 3. Write companion .ail source file
    fs.writeFileSync(
      path.join(companionDir, "src", "core", "engine.ail"),
      `fn processFoodConsumption(food: int) -> int {
  return food + 10;
}
`,
      "utf-8",
    );
  });

  afterEach(() => {
    try {
      if (fs.existsSync(tmpRoot)) {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
      }
    } catch {
      // ignore tmp cleanup error
    }
  });

  describe("Harness Discovery in Companion Mode", () => {
    it("discovers test harness from testCwd (targetProjectDir) and honors configured test command", () => {
      const harness = discoverTestHarness(companionDir);
      expect(harness.command).toBe("bun");
      expect(harness.baseArgs).toEqual(["test"]);
      expect(harness.name).toContain("custom (bun test)");
    });

    it("falls back to target project package.json scripts.test when test.command is omitted", () => {
      // Overwrite config without test.command
      fs.writeFileSync(
        path.join(companionDir, "ail.config.json"),
        JSON.stringify(
          {
            mode: "companion",
            sourceDir: "src",
            outDir: "../target-app/src",
            targetProjectDir: "../target-app",
            targetLanguage: "typescript",
          },
          null,
          2,
        ),
        "utf-8",
      );

      const harness = discoverTestHarness(companionDir);
      expect(harness.command).toBe("bun");
      expect(harness.baseArgs).toEqual(["test"]);
    });
  });

  describe("Pre-Compilation Sync & Cross-Directory Test Execution", () => {
    it("compiles companion .ail to targetProject outDir before executing tests in target project", async () => {
      // Write target test that imports from freshly compiled file
      fs.writeFileSync(
        path.join(targetDir, "tests", "engine.test.ts"),
        `import { expect, test } from "bun:test";
import { processFoodConsumption } from "../src/core/engine.js";

test("computes food consumption", () => {
  expect(processFoodConsumption(5)).toBe(15);
});
`,
        "utf-8",
      );

      const compiledTarget = path.join(targetDir, "src", "core", "engine.ts");
      expect(fs.existsSync(compiledTarget)).toBe(false);

      // Run tests from companion workspace
      const result = await runAilTests(undefined, { cwd: companionDir });

      expect(fs.existsSync(compiledTarget)).toBe(true);
      expect(result.compiledFiles).toContain(compiledTarget);
      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.summary.passed).toBeGreaterThanOrEqual(1);
    });

    it("recompiles modified companion .ail before test execution when source changes", async () => {
      // 1. Initial compilation
      const compResult = compileTargetAilIfNeeded(undefined, { cwd: companionDir });
      const compiledTarget = path.join(targetDir, "src", "core", "engine.ts");
      expect(fs.existsSync(compiledTarget)).toBe(true);
      expect(compResult.compiledFiles).toContain(compiledTarget);

      // 2. Modify companion .ail source with new logic
      const ailFile = path.join(companionDir, "src", "core", "engine.ail");
      fs.writeFileSync(
        ailFile,
        `fn processFoodConsumption(food: int) -> int {
  return food + 50;
}
`,
        "utf-8",
      );

      // Artificially advance mtime of .ail
      const future = new Date(Date.now() + 5000);
      fs.utimesSync(ailFile, future, future);

      // 3. Write test asserting updated logic
      fs.writeFileSync(
        path.join(targetDir, "tests", "engine.test.ts"),
        `import { expect, test } from "bun:test";
import { processFoodConsumption } from "../src/core/engine.js";

test("computes updated food consumption", () => {
  expect(processFoodConsumption(10)).toBe(60);
});
`,
        "utf-8",
      );

      const result = await runAilTests(undefined, { cwd: companionDir });
      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);

      const targetContent = fs.readFileSync(compiledTarget, "utf-8");
      expect(targetContent).toContain("50");
    });
  });

  describe("Reverse-Mapping & Output Scrubbing", () => {
    it("resolves external target paths back to companion workspace .ail files", () => {
      // 1. Relative target path from companion root
      const rel1 = resolveToAilFile("../target-app/src/core/engine.ts", companionDir);
      expect(rel1.exists).toBe(true);
      expect(rel1.relAilPath).toBe("src/core/engine.ail");

      // 2. Target relative path inside target project
      const rel2 = resolveToAilFile("src/core/engine.ts", companionDir);
      expect(rel2.exists).toBe(true);
      expect(rel2.relAilPath).toBe("src/core/engine.ail");

      // 3. Simple basename
      const rel3 = resolveToAilFile("engine.ts", companionDir);
      expect(rel3.exists).toBe(true);
      expect(rel3.relAilPath).toBe("src/core/engine.ail");

      // 4. File with line and col
      const rel4 = resolveToAilFile("engine.ts:338:24", companionDir);
      expect(rel4.exists).toBe(true);
      expect(rel4.relAilPath).toBe("src/core/engine.ail");
    });

    it("scrubs all .ts, .js, and dist/ paths from output in companion mode", () => {
      const rawError = `
FAIL ../target-app/tests/engine.test.ts > computes food consumption
AssertionError: expected 15 to be 999
    at processFoodConsumption (../target-app/src/core/engine.ts:338:24)
    at tests/engine.test.ts:42:15
`;

      const formatted = formatSymbolAwareError(rawError, companionDir);

      // Emitted diagnostic must cite .ail and never .ts
      expect(formatted).toContain("src/core/engine.ail");
      expect(formatted).not.toContain("engine.ts");
      expect(formatted).not.toContain("../target-app");
      expect(formatted).not.toContain(".ts");
      expect(formatted).toContain("Scope: fn processFoodConsumption in src/core/engine.ail:1");
    });

    it("reverse-maps target lines to .ail AST symbol locations during test failure", async () => {
      // Update companion .ail to throw inside processFoodConsumption
      fs.writeFileSync(
        path.join(companionDir, "src", "core", "engine.ail"),
        `fn processFoodConsumption(food: int) -> int {
  if food == 5: throw "Food limit exceeded";
  return food + 10;
}
`,
        "utf-8",
      );

      // Precompile so target has panic logic
      compileTargetAilIfNeeded(undefined, { cwd: companionDir });

      // Failing test calling processFoodConsumption
      fs.writeFileSync(
        path.join(targetDir, "tests", "engine.test.ts"),
        `import { test } from "bun:test";
import { processFoodConsumption } from "../src/core/engine.js";

test("fails intentionally", () => {
  processFoodConsumption(5);
});
`,
        "utf-8",
      );

      const result = await runAilTests(undefined, { cwd: companionDir });
      expect(result.success).toBe(false);
      expect(result.exitCode).not.toBe(0);

      // Verify output has scrubbed .ts references and points to .ail
      expect(result.output).toContain("src/core/engine.ail");
      expect(result.output).not.toContain("engine.ts");
      expect(result.output).not.toContain("../target-app");
      expect(result.output).not.toContain(".ts");
      expect(result.output).toContain("Scope: fn processFoodConsumption in src/core/engine.ail:1");
    });
  });

  describe("ail trace CLI Command & API", () => {
    it("translates direct file:line reference (engine.ts:338) to companion .ail symbol and line", () => {
      // Compile first so target file exists
      compileTargetAilIfNeeded(undefined, { cwd: companionDir });

      const trace = translateTraceLine("engine.ts:338", companionDir);
      expect(trace).toBe("=> processFoodConsumption src/core/engine.ail:1:1");
    });

    it("translates V8 stack frame with function name to companion .ail", () => {
      const trace = translateTraceLine(
        "at processFoodConsumption (engine.ts:338:24)",
        companionDir,
      );
      expect(trace).toBe("=> processFoodConsumption src/core/engine.ail:1:1");
    });

    it("translates frame with target path (src/core/engine.ts:338:24) to companion .ail", () => {
      const trace = translateTraceLine(
        "at processFoodConsumption (src/core/engine.ts:338:24)",
        companionDir,
      );
      expect(trace).toBe("=> processFoodConsumption src/core/engine.ail:1:1");
    });

    it("translates multi-line stack trace string using translateTrace", () => {
      const multiLine = `
Error: Food consumption limit exceeded
    at processFoodConsumption (src/core/engine.ts:338:24)
    at runTick (src/core/ticker.ts:50:10)
`;
      const lines = translateTrace(multiLine, companionDir);
      expect(lines.length).toBeGreaterThanOrEqual(1);
      expect(lines[0]).toBe("=> processFoodConsumption src/core/engine.ail:1:1");
    });

    it("executes 'ail trace <trace...>' via CLI in companion workspace", () => {
      // 1. Single argument
      const cliRes1 = runCli(["trace", "engine.ts:338"], companionDir);
      expect(cliRes1.status).toBe(0);
      expect(cliRes1.stdout.trim()).toBe("=> processFoodConsumption src/core/engine.ail:1:1");

      // 2. Quoted stack frame
      const cliRes2 = runCli(
        ["trace", "at processFoodConsumption (engine.ts:338:24)"],
        companionDir,
      );
      expect(cliRes2.status).toBe(0);
      expect(cliRes2.stdout.trim()).toBe("=> processFoodConsumption src/core/engine.ail:1:1");

      // 3. Unquoted stack frame args
      const cliRes3 = runCli(
        ["trace", "at", "processFoodConsumption", "(src/core/engine.ts:338:24)"],
        companionDir,
      );
      expect(cliRes3.status).toBe(0);
      expect(cliRes3.stdout.trim()).toBe("=> processFoodConsumption src/core/engine.ail:1:1");
    });

    it("executes 'ail test' via CLI in companion workspace with 0 exit code on passing tests", () => {
      // Write passing test in target project
      fs.writeFileSync(
        path.join(targetDir, "tests", "engine.test.ts"),
        `import { expect, test } from "bun:test";
import { processFoodConsumption } from "../src/core/engine.js";

test("runs cleanly via ail test CLI", () => {
  expect(processFoodConsumption(10)).toBe(20);
});
`,
        "utf-8",
      );

      const cliRes = runCli(["test"], companionDir);
      expect(cliRes.status).toBe(0);
      expect(cliRes.stdout).toContain("Tests succeeded");
    });

    it("returns non-zero exit code when test process times out", async () => {
      fs.writeFileSync(
        path.join(targetDir, "tests", "hang.test.ts"),
        `import { test } from "bun:test";
test("hangs", async () => {
  await new Promise((r) => setTimeout(r, 2000));
});
`,
        "utf-8",
      );

      const result = await runAilTests("tests/hang.test.ts", {
        cwd: companionDir,
        timeoutMs: 100,
      });

      expect(result.success).toBe(false);
      expect(result.exitCode).not.toBe(0);
      expect(result.exitCode).toBe(124);
    });
  });
});
