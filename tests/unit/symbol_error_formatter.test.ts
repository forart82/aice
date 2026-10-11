/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for Step 12: Symbol-Aware AST Error Formatter.
 * Verifies that runtime errors across test runners (vitest, bun, node:test, jest)
 * are mapped directly to .ail source AST declarations without sourcemap files on disk,
 * and that all runtime/target references (.ts, .js, dist/, node:internal) are scrubbed.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "../../src/core/parser.js";
import {
  findSymbolInAst,
  formatSymbolAwareError,
  parseStackFrames,
  resolveToAilFile,
  scrubTargetFileReferences,
  stripAnsi,
} from "../../src/runner/symbol-error-formatter.js";
import {
  formatCleanTestOutput,
  runAilTests,
} from "../../src/runner/test-runner.js";

describe("Step 12: Symbol-Aware AST Error Formatter", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ail-symbol-error-test-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignored
    }
  });

  describe("AST Symbol Lookup (findSymbolInAst)", () => {
    it("locates method declarations inside ClassDecl with exact line numbers", () => {
      const code = `class GameEngine:
  multiplier: int = 2

  fn processFoodConsumption(food: int) -> int:
    ret food * this.multiplier

  static fn createDefault() -> GameEngine:
    ret GameEngine()
`;
      const mod = parse(code, "engine.ts.ail");

      // Qualified method lookup
      const qualified = findSymbolInAst(mod, "GameEngine.processFoodConsumption");
      expect(qualified).toBeDefined();
      expect(qualified?.kind).toBe("method");
      expect(qualified?.line).toBe(4);

      // Unqualified method lookup
      const unqualified = findSymbolInAst(mod, "processFoodConsumption");
      expect(unqualified).toBeDefined();
      expect(unqualified?.kind).toBe("method");
      expect(unqualified?.line).toBe(4);

      // Static method lookup
      const staticMethod = findSymbolInAst(mod, "GameEngine.createDefault");
      expect(staticMethod).toBeDefined();
      expect(staticMethod?.kind).toBe("method");
      expect(staticMethod?.line).toBe(7);
    });

    it("locates top-level FunctionDecl with exact line numbers", () => {
      const code = `
# Utility module
fn calculateScore(points: int, bonus: int) -> int:
  ret points * 10 + bonus
`;
      const mod = parse(code, "score.ts.ail");

      const match = findSymbolInAst(mod, "calculateScore");
      expect(match).toBeDefined();
      expect(match?.kind).toBe("function");
      expect(match?.line).toBe(3);
    });

    it("locates ComponentDecl with exact line numbers", () => {
      const code = `
component ScoreBoard(score: int):
  div:
    text: "Score"
`;
      const mod = parse(code, "scoreboard.tsx.ail");

      const match = findSymbolInAst(mod, "ScoreBoard");
      expect(match).toBeDefined();
      expect(match?.kind).toBe("component");
      expect(match?.line).toBe(2);
    });

    it("handles class constructor and prototype member lookups", () => {
      const code = `class Player:
  name: str

  fn new(name: str):
    this.name = name
`;
      const mod = parse(code, "player.ts.ail");

      const ctor = findSymbolInAst(mod, "Player.new");
      expect(ctor).toBeDefined();
      expect(ctor?.line).toBe(4);

      const proto = findSymbolInAst(mod, "Player.prototype.new");
      expect(proto).toBeDefined();
      expect(proto?.line).toBe(4);
    });

    it("returns undefined when symbol does not exist in AST", () => {
      const code = `fn exists() -> int = 42\n`;
      const mod = parse(code, "mod.ail");

      const missing = findSymbolInAst(mod, "doesNotExist");
      expect(missing).toBeUndefined();
    });
  });

  describe("File Resolution to .ail Source (resolveToAilFile)", () => {
    it("resolves target .ts path to existing .ts.ail file", () => {
      const ailFile = path.join(tmpDir, "src", "engine.ts.ail");
      fs.mkdirSync(path.dirname(ailFile), { recursive: true });
      fs.writeFileSync(ailFile, "fn run() -> void {}\n", "utf-8");

      const res = resolveToAilFile("src/engine.ts", tmpDir);
      expect(res.exists).toBe(true);
      expect(res.relAilPath).toBe("src/engine.ts.ail");
    });

    it("strips dist/ or build/ prefix when resolving target file", () => {
      const ailFile = path.join(tmpDir, "src", "engine.ts.ail");
      fs.mkdirSync(path.dirname(ailFile), { recursive: true });
      fs.writeFileSync(ailFile, "fn run() -> void {}\n", "utf-8");

      const res = resolveToAilFile("dist/src/engine.js", tmpDir);
      expect(res.exists).toBe(true);
      expect(res.relAilPath).toBe("src/engine.ts.ail");
    });

    it("falls back cleanly to candidate .ail name when file is not on disk", () => {
      const res = resolveToAilFile("src/core/engine.ts", tmpDir);
      expect(res.exists).toBe(false);
      expect(res.relAilPath).toBe("src/core/engine.ts.ail");
    });
  });

  describe("Stack Frame Parsing (parseStackFrames)", () => {
    it("parses V8 stack frames with function names, files, and lines", () => {
      const raw = `TypeError: boom
    at GameEngine.processFoodConsumption (/home/user/src/core/engine.ts:42:15)
    at tests/unit/game.test.ts:18:22
    at runTest (file:///home/user/node_modules/vitest/dist/run.js:10:5)
    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
`;
      const frames = parseStackFrames(raw);
      expect(frames.length).toBe(2);
      expect(frames[0].functionName).toBe("GameEngine.processFoodConsumption");
      expect(frames[0].filePath).toBe("/home/user/src/core/engine.ts");
      expect(frames[0].line).toBe(42);
      expect(frames[0].column).toBe(15);
      expect(frames[1].functionName).toBeUndefined();
      expect(frames[1].filePath).toBe("tests/unit/game.test.ts");
      expect(frames[1].line).toBe(18);
    });

    it("parses Vitest chevron stack frames", () => {
      const raw = `
 ❯ GameEngine.processFoodConsumption src/core/engine.ts:42:15
 ❯ tests/unit/game.test.ts:18:22
 ❯ node_modules/vitest/dist/run.js:10:5
`;
      const frames = parseStackFrames(raw);
      expect(frames.length).toBe(2);
      expect(frames[0].functionName).toBe("GameEngine.processFoodConsumption");
      expect(frames[0].filePath).toBe("src/core/engine.ts");
      expect(frames[0].line).toBe(42);
    });
  });

  describe("Target Reference Scrubbing (scrubTargetFileReferences)", () => {
    it("completely scrubs node:internal, dist/, and bare target extensions (.ts, .js)", () => {
      const text = `❌ FAIL: tests/unit/calc.test.ts [adds numbers]
   Error: Failed in dist/src/math.js: boom
   at runTest (node:internal/process/task_queues:105:5)
   Scope: fn add in src/math.ts:10`;

      const scrubbed = scrubTargetFileReferences(text);
      expect(scrubbed).not.toContain("node:internal");
      expect(scrubbed).not.toContain("dist/");
      expect(scrubbed).not.toContain("at runTest");
      expect(scrubbed).toContain("tests/unit/calc.test.ts.ail");
      expect(scrubbed).toContain("src/math.ts.ail:10");
    });

    it("preserves legitimate .ail and .ts.ail extensions", () => {
      const text = `Scope: fn process in src/core/engine.ts.ail:4`;
      const scrubbed = scrubTargetFileReferences(text);
      expect(scrubbed).toBe("Scope: fn process in src/core/engine.ts.ail:4");
    });
  });

  describe("formatSymbolAwareError Output across Test Runners", () => {
    it("formats Vitest runtime error into concise 3-line report with exact AST line", () => {
      // Create .ail source file in tmpDir
      const engineAil = path.join(tmpDir, "src", "core", "engine.ts.ail");
      fs.mkdirSync(path.dirname(engineAil), { recursive: true });
      fs.writeFileSync(
        engineAil,
        `class GameEngine:
  multiplier: int = 1

  fn processFoodConsumption(food: int) -> int:
    ret food * this.multiplier
`,
        "utf-8",
      );

      const vitestOutput = `
FAIL  tests/unit/game.test.ts > AI Bot plays 100+ steps...
TypeError: Cannot read properties of undefined (reading 'multiplier')
 ❯ GameEngine.processFoodConsumption src/core/engine.ts:42:15
 ❯ tests/unit/game.test.ts:18:22
 ❯ runTest node_modules/vitest/dist/run.js:10:5
`;

      const formatted = formatSymbolAwareError(vitestOutput, tmpDir);

      expect(formatted).toBe(
        `❌ FAIL: tests/unit/game.test.ts.ail [AI Bot plays 100+ steps...]
   Error: TypeError: Cannot read properties of undefined (reading 'multiplier')
   Scope: fn GameEngine.processFoodConsumption in src/core/engine.ts.ail:4`,
      );

      // Verify no target runtime paths leaked
      expect(formatted).not.toContain(".js");
      expect(formatted).not.toContain("node_modules");
      expect(formatted).not.toContain("engine.ts:42");
    });

    it("formats Bun test runner output with unqualified method and AST line", () => {
      const engineAil = path.join(tmpDir, "src", "core", "engine.ts.ail");
      fs.mkdirSync(path.dirname(engineAil), { recursive: true });
      fs.writeFileSync(
        engineAil,
        `class GameEngine:
  fn processFoodConsumption(food: int) -> int:
    ret food * 2
`,
        "utf-8",
      );

      const bunOutput = `(fail) tests/unit/game.test.ts:
✗ AI Bot plays 100+ steps... [0.50ms]
TypeError: Cannot read properties of undefined (reading 'multiplier')
    at processFoodConsumption (src/core/engine.ts:42:15)
    at tests/unit/game.test.ts:18:22
`;

      const formatted = formatSymbolAwareError(bunOutput, tmpDir);

      expect(formatted).toBe(
        `❌ FAIL: tests/unit/game.test.ts.ail [AI Bot plays 100+ steps...]
   Error: TypeError: Cannot read properties of undefined (reading 'multiplier')
   Scope: fn processFoodConsumption in src/core/engine.ts.ail:2`,
      );
    });

    it("formats Node.js --test TAP output with AST symbol resolution", () => {
      const mathAil = path.join(tmpDir, "src", "math.ts.ail");
      fs.mkdirSync(path.dirname(mathAil), { recursive: true });
      fs.writeFileSync(
        mathAil,
        `# Math library
fn calculateSum(a: int, b: int) -> int:
  ret a + b
`,
        "utf-8",
      );

      const nodeTap = `# Subtest: adds two numbers correctly
not ok 1 - adds two numbers correctly
  ---
  duration_ms: 0.8
  failureType: 'testCodeFailure'
  error: 'Cannot read properties of undefined (reading \'val\')'
  code: 'ERR_TEST_FAILURE'
  stack: |-
    TypeError: Cannot read properties of undefined (reading 'val')
        at calculateSum (src/math.ts:35:10)
        at tests/unit/math.test.ts:12:4
  ...
`;

      const formatted = formatSymbolAwareError(nodeTap, tmpDir);

      expect(formatted).toBe(
        `❌ FAIL: tests/unit/math.test.ts.ail [adds two numbers correctly]
   Error: Cannot read properties of undefined (reading 'val')
   Scope: fn calculateSum in src/math.ts.ail:2`,
      );
    });

    it("formats ComponentDecl failures in JSX/TSX layout code", () => {
      const compAil = path.join(tmpDir, "src", "ui", "view.tsx.ail");
      fs.mkdirSync(path.dirname(compAil), { recursive: true });
      fs.writeFileSync(
        compAil,
        `
component PlayerCard(name: str):
  div:
    text: name
`,
        "utf-8",
      );

      const errorText = `
FAIL tests/ui/view.test.tsx > renders player card
Error: Render failed
    at PlayerCard (src/ui/view.tsx:50:2)
    at tests/ui/view.test.tsx:10:5
`;

      const formatted = formatSymbolAwareError(errorText, tmpDir);

      expect(formatted).toBe(
        `❌ FAIL: tests/ui/view.test.tsx.ail [renders player card]
   Error: Render failed
   Scope: fn PlayerCard in src/ui/view.tsx.ail:2`,
      );
    });

    it("formats multiple failing tests separated by blank lines", () => {
      const output = `
FAIL tests/unit/one.test.ts > first test
TypeError: Cannot read properties of undefined
 ❯ funcOne src/one.ts:10:5

FAIL tests/unit/two.test.ts > second test
AssertionError: expected 1 to be 2
 ❯ funcTwo src/two.ts:20:5
`;

      const formatted = formatSymbolAwareError(output, tmpDir);

      const parts = formatted.split("\n\n");
      expect(parts.length).toBe(2);

      expect(parts[0]).toContain("❌ FAIL: tests/unit/one.test.ts.ail [first test]");
      expect(parts[0]).toContain("Error: TypeError: Cannot read properties of undefined");
      expect(parts[0]).toContain("Scope: fn funcOne in src/one.ts.ail:10");

      expect(parts[1]).toContain("❌ FAIL: tests/unit/two.test.ts.ail [second test]");
      expect(parts[1]).toContain("Error: AssertionError: expected 1 to be 2");
      expect(parts[1]).toContain("Scope: fn funcTwo in src/two.ts.ail:20");
    });

    it("guarantees zero *.map files are written to disk during symbol resolution", () => {
      const engineAil = path.join(tmpDir, "src", "core", "engine.ts.ail");
      fs.mkdirSync(path.dirname(engineAil), { recursive: true });
      fs.writeFileSync(
        engineAil,
        `class GameEngine:
  fn run():
    ret nil
`,
        "utf-8",
      );

      const raw = `
FAIL tests/unit/game.test.ts > runs game
Error: failure
 ❯ GameEngine.run src/core/engine.ts:10:5
`;

      formatSymbolAwareError(raw, tmpDir);

      // Verify no .map files were created anywhere in tmpDir
      function checkNoMapFiles(dir: string) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            checkNoMapFiles(full);
          } else {
            expect(entry.name.endsWith(".map")).toBe(false);
          }
        }
      }

      checkNoMapFiles(tmpDir);
    });

    it("returns empty string when output is empty or whitespace", () => {
      expect(formatSymbolAwareError("", tmpDir)).toBe("");
      expect(formatSymbolAwareError("   \n   ", tmpDir)).toBe("");
    });
  });

  describe("Integration with test-runner (formatCleanTestOutput & runAilTests)", () => {
    it("formatCleanTestOutput formats failing test output via symbol-aware error formatter", () => {
      const engineAil = path.join(tmpDir, "src", "core", "engine.ts.ail");
      fs.mkdirSync(path.dirname(engineAil), { recursive: true });
      fs.writeFileSync(
        engineAil,
        `class GameEngine:
  fn tick():
    ret nil
`,
        "utf-8",
      );

      const rawStderr = `
FAIL tests/unit/game.test.ts > game loop tick
TypeError: state is null
 ❯ GameEngine.tick src/core/engine.ts:15:3
 ❯ tests/unit/game.test.ts:10:2
`;

      const output = formatCleanTestOutput(
        "",
        rawStderr,
        1,
        { total: 1, passed: 0, failed: 1 },
        tmpDir,
      );

      expect(output).toContain("❌ FAIL: tests/unit/game.test.ts.ail [game loop tick]");
      expect(output).toContain("Error: TypeError: state is null");
      expect(output).toContain("Scope: fn GameEngine.tick in src/core/engine.ts.ail:2");
      expect(output).not.toContain("node:internal");
      expect(output).not.toContain(".js");
    });

    it("runAilTests returns symbol-aware formatted error on test failure", async () => {
      const testFile = path.join(tmpDir, "runner_fail.test.mjs");
      fs.writeFileSync(
        testFile,
        `import test from "node:test";\nimport assert from "node:assert";\ntest("runner fails cleanly", () => { assert.fail("expected failure"); });\n`,
        "utf-8",
      );

      const result = await runAilTests(testFile, {
        cwd: tmpDir,
        harness: "node",
      });

      expect(result.success).toBe(false);
      expect(result.exitCode).not.toBe(0);
      expect(result.summary.failed).toBeGreaterThanOrEqual(1);
      expect(result.output).toContain("❌ FAIL: runner_fail.test.mjs.ail [runner fails cleanly]");
      expect(result.output).toContain("expected failure");
      expect(result.output).not.toContain("node:internal");
    });
  });
});
