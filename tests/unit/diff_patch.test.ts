/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for AIL 2.0 Semantic AST Diff & Patch Engine (Step 22).
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { program } from "../../bin/ail.js";
import { parse } from "../../src/core/parser.js";
import {
  applyPatch,
  computeSemanticDiff,
  diffFiles,
  generateSemanticPatch,
  patchFile,
  type SemanticDiffResult,
} from "../../src/tools/diff-patch.js";

describe("AIL 2.0 Semantic AST Diff & Patch Engine (Step 22)", () => {
  describe("computeSemanticDiff: AST Structural Difference Detection", () => {
    it("detects added, removed, and modified functions and class methods", () => {
      const oldSource = `
fn calculate(a: int) -> int:
  return a * 2

fn oldHelper():
  return 10

class GameEngine:
  fn step():
    return 0
`.trim();

      const newSource = `
fn calculate(a: int) -> int:
  return a * 2

class GameEngine:
  fn step():
    return 1
  fn fastMode():
    return true
`.trim();

      const result = computeSemanticDiff(oldSource, newSource);

      expect(result.changes).toBeDefined();

      // Find specific symbols
      const stepChange = result.changes.find((c) => c.name === "GameEngine.step");
      expect(stepChange).toBeDefined();
      expect(stepChange?.kind).toBe("method");
      expect(stepChange?.change).toBe("modified");

      const fastModeChange = result.changes.find((c) => c.name === "GameEngine.fastMode");
      expect(fastModeChange).toBeDefined();
      expect(fastModeChange?.kind).toBe("method");
      expect(fastModeChange?.change).toBe("added");

      const oldHelperChange = result.changes.find((c) => c.name === "oldHelper");
      expect(oldHelperChange).toBeDefined();
      expect(oldHelperChange?.kind).toBe("function");
      expect(oldHelperChange?.change).toBe("removed");

      // Verify concise semantic summary text format
      expect(result.semanticSummary).toContain("[~] method GameEngine.step (modified)");
      expect(result.semanticSummary).toContain("[+] method GameEngine.fastMode (added)");
      expect(result.semanticSummary).toContain("[-] function oldHelper (removed)");
    });

    it("preserves unchanged symbols with change: 'unchanged'", () => {
      const oldSource = `
fn calculate(a: int) -> int:
  return a * 2

class GameEngine:
  fn step():
    return 0
`.trim();

      const newSource = `
fn calculate(a: int) -> int:
  return a * 2

class GameEngine:
  fn step():
    return 1
`.trim();

      const result = computeSemanticDiff(oldSource, newSource);

      const calcSym = result.changes.find((c) => c.name === "calculate");
      expect(calcSym).toBeDefined();
      expect(calcSym?.change).toBe("unchanged");
      expect(calcSym?.oldSnippet).toBe("fn calculate(a: int) -> int:\n  return a * 2");
      expect(calcSym?.newSnippet).toBe("fn calculate(a: int) -> int:\n  return a * 2");

      const gameEngineClass = result.changes.find((c) => c.name === "GameEngine");
      expect(gameEngineClass).toBeDefined();
      expect(gameEngineClass?.kind).toBe("class");
      expect(gameEngineClass?.change).toBe("unchanged");

      // Unchanged symbols should NOT appear in semantic summary
      expect(result.semanticSummary).not.toContain("calculate");
      expect(result.semanticSummary).not.toContain("[ ]");
    });

    it("generates valid unified text diff", () => {
      const oldSource = "fn foo() -> int:\n  return 1\n";
      const newSource = "fn foo() -> int:\n  return 2\n";

      const result = computeSemanticDiff(oldSource, newSource, { oldPath: "test.ail" });

      expect(result.unifiedDiff).toContain("--- a/test.ail");
      expect(result.unifiedDiff).toContain("+++ b/test.ail");
      expect(result.unifiedDiff).toContain("-  return 1");
      expect(result.unifiedDiff).toContain("+  return 2");
    });

    it("generates structured JSON payload in result.json", () => {
      const oldSource = "fn foo():\n  pass\n";
      const newSource = "fn bar():\n  pass\n";

      const result = computeSemanticDiff(oldSource, newSource, {
        oldPath: "old.ail",
        newPath: "new.ail",
      });

      expect(result.json).toBeDefined();
      expect(result.json.oldPath).toBe("old.ail");
      expect(result.json.newPath).toBe("new.ail");
      expect(result.json.hasChanges).toBe(true);
      expect(Array.isArray(result.json.changes)).toBe(true);
    });

    it("handles identical sources with zero changes", () => {
      const src = "fn foo(x: int) -> int:\n  return x * 10\n";
      const result = computeSemanticDiff(src, src);

      expect(result.semanticSummary).toBe("");
      expect(result.unifiedDiff).toBe("");
      expect(result.changes.every((c) => c.change === "unchanged")).toBe(true);
    });
  });

  describe("applyPatch: Unified Diff Applications", () => {
    it("applies standard unified diff correctly to target source", () => {
      const targetSource = `
fn calculate(a: int) -> int:
  return a * 2

fn other():
  return 10
`.trim();

      const patch = `
--- a/math.ail
+++ b/math.ail
@@ -1,3 +1,3 @@
 fn calculate(a: int) -> int:
-  return a * 2
+  return a * 10
`.trim();

      const res = applyPatch(targetSource, patch);

      expect(res.success).toBe(true);
      expect(res.appliedHunks).toBe(1);
      expect(res.totalHunks).toBe(1);
      expect(res.modifiedSource).toContain("return a * 10");
      expect(res.modifiedSource).toContain("fn other():\n  return 10");

      // Verify AST parses cleanly
      const ast = parse(res.modifiedSource);
      expect(ast.items).toHaveLength(2);
    });

    it("rolls back changes when --reverse is specified", () => {
      const originalSource = `
fn calculate(a: int) -> int:
  return a * 2
`.trim();

      const patch = `
--- a/math.ail
+++ b/math.ail
@@ -1,2 +1,2 @@
 fn calculate(a: int) -> int:
-  return a * 2
+  return a * 100
`.trim();

      // Forward apply
      const forwardRes = applyPatch(originalSource, patch);
      expect(forwardRes.success).toBe(true);
      expect(forwardRes.modifiedSource).toContain("return a * 100");

      // Reverse rollback
      const reverseRes = applyPatch(forwardRes.modifiedSource, patch, { reverse: true });
      expect(reverseRes.success).toBe(true);
      expect(reverseRes.modifiedSource).toBe(originalSource);
    });

    it("handles multi-hunk unified diff", () => {
      const source = `
fn first():
  return 1

fn middle():
  return 2

fn last():
  return 3
`.trim();

      const patch = `
--- a/file.ail
+++ b/file.ail
@@ -1,2 +1,2 @@
 fn first():
-  return 1
+  return 10
@@ -7,2 +7,2 @@
 fn last():
-  return 3
+  return 30
`.trim();

      const res = applyPatch(source, patch);
      expect(res.success).toBe(true);
      expect(res.appliedHunks).toBe(2);
      expect(res.totalHunks).toBe(2);
      expect(res.modifiedSource).toContain("return 10");
      expect(res.modifiedSource).toContain("return 2");
      expect(res.modifiedSource).toContain("return 30");
    });
  });

  describe("applyPatch: Semantic Symbol Patches", () => {
    it("applies semantic symbol patch to modify an existing function", () => {
      const source = `
fn calculate(a: int) -> int:
  return a * 2

fn other():
  return 10
`.trim();

      const patch = `
--- Symbol: function calculate
- fn calculate(a: int) -> int:
-   return a * 2
+ fn calculate(a: int, b: int) -> int:
+   return a + b
`.trim();

      const res = applyPatch(source, patch);

      expect(res.success).toBe(true);
      expect(res.appliedHunks).toBe(1);
      expect(res.modifiedSource).toContain("fn calculate(a: int, b: int) -> int:\n  return a + b");
      expect(res.modifiedSource).toContain("fn other():\n  return 10");

      const ast = parse(res.modifiedSource);
      expect(ast.items).toHaveLength(2);
    });

    it("applies semantic symbol patch to modify a class method", () => {
      const source = `
class GameEngine:
  fn step():
    return 0
`.trim();

      const patch = `
--- Symbol: method GameEngine.step
- fn step():
-   return 0
+ fn step():
+   return 42
`.trim();

      const res = applyPatch(source, patch);

      expect(res.success).toBe(true);
      expect(res.appliedHunks).toBe(1);
      expect(res.modifiedSource).toContain("return 42");

      const ast = parse(res.modifiedSource);
      expect(ast.items).toHaveLength(1);
    });

    it("applies semantic symbol patch to add a new method to a class", () => {
      const source = `
class GameEngine:
  fn step():
    return 0
`.trim();

      const patch = `
--- Symbol: method GameEngine.fastMode
+ fn fastMode():
+   return true
`.trim();

      const res = applyPatch(source, patch);

      expect(res.success).toBe(true);
      expect(res.appliedHunks).toBe(1);
      expect(res.modifiedSource).toContain("fastMode():");
      expect(res.modifiedSource).toContain("step():");

      const ast = parse(res.modifiedSource);
      expect(ast.items).toHaveLength(1);
    });

    it("applies semantic symbol patch to delete a removed symbol", () => {
      const source = `
fn calculate(a: int) -> int:
  return a * 2

fn oldHelper():
  return 10
`.trim();

      const patch = `
--- Symbol: function oldHelper (delete)
- fn oldHelper():
-   return 10
`.trim();

      const res = applyPatch(source, patch);

      expect(res.success).toBe(true);
      expect(res.appliedHunks).toBe(1);
      expect(res.modifiedSource).not.toContain("oldHelper");
      expect(res.modifiedSource).toContain("calculate");

      const ast = parse(res.modifiedSource);
      expect(ast.items).toHaveLength(1);
    });

    it("rolls back semantic symbol patches with --reverse", () => {
      const original = `
fn calculate(a: int) -> int:
  return a * 2

class GameEngine:
  fn step():
    return 0
`.trim();

      const patch = `
--- Symbol: method GameEngine.step
- fn step():
-   return 0
+ fn step():
+   return 999
`.trim();

      const forwardRes = applyPatch(original, patch);
      expect(forwardRes.success).toBe(true);
      expect(forwardRes.modifiedSource).toContain("return 999");

      const reverseRes = applyPatch(forwardRes.modifiedSource, patch, { reverse: true });
      expect(reverseRes.success).toBe(true);
      expect(reverseRes.modifiedSource).toContain("return 0");
    });

    it("roundtrips with generateSemanticPatch", () => {
      const oldSource = `
fn calculate(a: int) -> int:
  return a * 2

class GameEngine:
  fn step():
    return 0
`.trim();

      const newSource = `
fn calculate(a: int) -> int:
  return a * 2

class GameEngine:
  fn step():
    return 100
  fn fast():
    return true
`.trim();

      const diff = computeSemanticDiff(oldSource, newSource);
      const patchText = generateSemanticPatch(diff);

      expect(patchText).toContain("--- Symbol: method GameEngine.step");
      expect(patchText).toContain("--- Symbol: method GameEngine.fast");

      const applyRes = applyPatch(oldSource, patchText);
      expect(applyRes.success).toBe(true);
      expect(applyRes.modifiedSource).toContain("return 100");
      expect(applyRes.modifiedSource).toContain("fast():");

      // Reverse it back
      const rollbackRes = applyPatch(applyRes.modifiedSource, patchText, { reverse: true });
      expect(rollbackRes.success).toBe(true);
      expect(rollbackRes.modifiedSource).toContain("return 0");
    });
  });

  describe("Zero-Corruption Guarantee & Error Rejection", () => {
    it("rejects malformed unified diff without corrupting source", () => {
      const source = "fn foo() -> int:\n  return 1\n";
      const malformedPatch = `
--- a/foo.ail
+++ b/foo.ail
@@ -50,5 +50,5 @@
-non_existent_line_completely_random
+other_random_line
`.trim();

      const res = applyPatch(source, malformedPatch);

      expect(res.success).toBe(false);
      expect(res.modifiedSource).toBe(source);
    });

    it("rejects patch that would corrupt syntax and guarantees clean rollback", () => {
      const source = "fn foo() -> int:\n  return 1\n";
      const corruptPatch = `
--- a/foo.ail
+++ b/foo.ail
@@ -1,2 +1,2 @@
-fn foo() -> int:
+fn foo(::: invalid syntax @@!#
`.trim();

      const res = applyPatch(source, corruptPatch);

      expect(res.success).toBe(false);
      expect(res.modifiedSource).toBe(source);
    });

    it("handles empty or whitespace-only patch gracefully", () => {
      const source = "fn foo():\n  pass\n";
      const res = applyPatch(source, "");

      expect(res.success).toBe(true);
      expect(res.modifiedSource).toBe(source);
      expect(res.appliedHunks).toBe(0);
    });
  });

  describe("diffFiles and patchFile: File System Operations", () => {
    it("computes diff between two files on disk via diffFiles", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "diff_files_test_"));
      try {
        const fileA = path.join(tmpDir, "v1.ail");
        const fileB = path.join(tmpDir, "v2.ail");
        fs.writeFileSync(fileA, "fn calc():\n  return 1\n", "utf-8");
        fs.writeFileSync(fileB, "fn calc():\n  return 2\n", "utf-8");

        const result = await diffFiles(fileA, fileB);

        expect(result.changes).toHaveLength(1);
        expect(result.changes[0].name).toBe("calc");
        expect(result.changes[0].change).toBe("modified");
        expect(result.semanticSummary).toContain("[~] function calc (modified)");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("applies patch to file on disk atomically with patchFile", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "patch_file_test_"));
      try {
        const target = path.join(tmpDir, "code.ail");
        fs.writeFileSync(target, "fn foo():\n  return 1\n", "utf-8");

        const patch = `
--- a/code.ail
+++ b/code.ail
@@ -1,2 +1,2 @@
 fn foo():
-  return 1
+  return 42
`.trim();

        const res = await patchFile(target, patch);

        expect(res.success).toBe(true);
        expect(res.appliedHunks).toBe(1);

        const onDisk = fs.readFileSync(target, "utf-8");
        expect(onDisk).toContain("return 42");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("dry-run validates patch without modifying file on disk", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "patch_dry_run_"));
      try {
        const target = path.join(tmpDir, "code.ail");
        const originalCode = "fn foo():\n  return 1\n";
        fs.writeFileSync(target, originalCode, "utf-8");

        const patch = `
--- a/code.ail
+++ b/code.ail
@@ -1,2 +1,2 @@
 fn foo():
-  return 1
+  return 999
`.trim();

        const res = await patchFile(target, patch, { dryRun: true });

        expect(res.success).toBe(true);
        expect(res.modifiedSource).toContain("return 999");

        // Verify disk content was NOT altered
        const onDisk = fs.readFileSync(target, "utf-8");
        expect(onDisk).toBe(originalCode);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("rejects invalid patch on disk without corrupting file", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "patch_reject_test_"));
      try {
        const target = path.join(tmpDir, "code.ail");
        const original = "fn foo():\n  return 1\n";
        fs.writeFileSync(target, original, "utf-8");

        const badPatch = "completely bogus patch text @@!#";
        const res = await patchFile(target, badPatch);

        expect(res.success).toBe(false);

        const onDisk = fs.readFileSync(target, "utf-8");
        expect(onDisk).toBe(original);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("automatically recompiles target with --compile flag", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "patch_compile_test_"));
      try {
        const configFile = path.join(tmpDir, "ail.config.json");
        fs.writeFileSync(
          configFile,
          JSON.stringify({ targetLanguage: "typescript", outDir: "." }),
          "utf-8",
        );

        const ailFile = path.join(tmpDir, "math.ail");
        fs.writeFileSync(ailFile, "fn sum(a: int, b: int) -> int:\n  return a + b\n", "utf-8");

        const patch = `
--- a/math.ail
+++ b/math.ail
@@ -1,2 +1,2 @@
 fn sum(a: int, b: int) -> int:
-  return a + b
+  return a * b
`.trim();

        const res = await patchFile(ailFile, patch, { compile: true, projectRoot: tmpDir });
        expect(res.success).toBe(true);

        const tsFile = path.join(tmpDir, "math.ts");
        expect(fs.existsSync(tsFile)).toBe(true);
        const tsContent = fs.readFileSync(tsFile, "utf-8");
        expect(tsContent).toContain("a * b");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe("CLI Command Execution (diff and patch)", () => {
    it("has 'diff' and 'patch' commands registered with required options in Commander", () => {
      const diffCmd = program.commands.find((c) => c.name() === "diff");
      expect(diffCmd).toBeDefined();
      const diffOptions = diffCmd?.options.map((o) => o.name());
      expect(diffOptions).toContain("ast");
      expect(diffOptions).toContain("unified");
      expect(diffOptions).toContain("json");

      const patchCmd = program.commands.find((c) => c.name() === "patch");
      expect(patchCmd).toBeDefined();
      const patchOptions = patchCmd?.options.map((o) => o.name());
      expect(patchOptions).toContain("dry-run");
      expect(patchOptions).toContain("reverse");
      expect(patchOptions).toContain("compile");
    });

    it("executes CLI 'ail diff' with two files and --ast flag", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli_diff_test_"));
      try {
        const fileA = path.join(tmpDir, "a.ail");
        const fileB = path.join(tmpDir, "b.ail");
        fs.writeFileSync(fileA, "fn calc():\n  return 1\n", "utf-8");
        fs.writeFileSync(fileB, "fn calc():\n  return 2\n", "utf-8");

        const res = spawnSync("bun", ["./bin/ail.ts", "diff", fileA, fileB, "--ast"], {
          encoding: "utf-8",
        });

        expect(res.status).toBe(0);
        expect(res.stdout).toContain("[~] function calc (modified)");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("executes CLI 'ail diff' with --unified flag", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli_diff_uni_"));
      try {
        const fileA = path.join(tmpDir, "a.ail");
        const fileB = path.join(tmpDir, "b.ail");
        fs.writeFileSync(fileA, "fn calc():\n  return 1\n", "utf-8");
        fs.writeFileSync(fileB, "fn calc():\n  return 2\n", "utf-8");

        const res = spawnSync("bun", ["./bin/ail.ts", "diff", fileA, fileB, "--unified"], {
          encoding: "utf-8",
        });

        expect(res.status).toBe(0);
        expect(res.stdout).toContain("-  return 1");
        expect(res.stdout).toContain("+  return 2");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("executes CLI 'ail diff' with --json flag", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli_diff_json_"));
      try {
        const fileA = path.join(tmpDir, "a.ail");
        const fileB = path.join(tmpDir, "b.ail");
        fs.writeFileSync(fileA, "fn calc():\n  return 1\n", "utf-8");
        fs.writeFileSync(fileB, "fn calc():\n  return 2\n", "utf-8");

        const res = spawnSync("bun", ["./bin/ail.ts", "diff", fileA, fileB, "--json"], {
          encoding: "utf-8",
        });

        expect(res.status).toBe(0);
        const parsed = JSON.parse(res.stdout);
        expect(parsed.changes).toBeDefined();
        expect(parsed.hasChanges).toBe(true);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("executes CLI 'ail patch' with patch file", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli_patch_file_"));
      try {
        const target = path.join(tmpDir, "math.ail");
        const patchFile = path.join(tmpDir, "math.patch");
        fs.writeFileSync(target, "fn foo():\n  return 1\n", "utf-8");
        fs.writeFileSync(
          patchFile,
          "--- a/math.ail\n+++ b/math.ail\n@@ -1,2 +1,2 @@\n fn foo():\n-  return 1\n+  return 777\n",
          "utf-8",
        );

        const res = spawnSync("bun", ["./bin/ail.ts", "patch", target, patchFile], {
          encoding: "utf-8",
        });

        expect(res.status).toBe(0);
        expect(res.stdout).toContain("✔ Successfully applied patch for");
        const content = fs.readFileSync(target, "utf-8");
        expect(content).toContain("return 777");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("executes CLI 'ail patch' via stdin input", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli_patch_stdin_"));
      try {
        const target = path.join(tmpDir, "math.ail");
        fs.writeFileSync(target, "fn foo():\n  return 1\n", "utf-8");

        const patch =
          "--- a/math.ail\n+++ b/math.ail\n@@ -1,2 +1,2 @@\n fn foo():\n-  return 1\n+  return 888\n";

        const res = spawnSync("bun", ["./bin/ail.ts", "patch", target, "-"], {
          input: patch,
          encoding: "utf-8",
        });

        expect(res.status).toBe(0);
        expect(res.stdout).toContain("✔ Successfully applied patch for");
        const content = fs.readFileSync(target, "utf-8");
        expect(content).toContain("return 888");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("executes CLI 'ail patch --dry-run' previewing changes without touching disk", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli_patch_dry_"));
      try {
        const target = path.join(tmpDir, "math.ail");
        const original = "fn foo():\n  return 1\n";
        fs.writeFileSync(target, original, "utf-8");

        const patch =
          "--- a/math.ail\n+++ b/math.ail\n@@ -1,2 +1,2 @@\n fn foo():\n-  return 1\n+  return 999\n";

        const res = spawnSync("bun", ["./bin/ail.ts", "patch", target, "-", "--dry-run"], {
          input: patch,
          encoding: "utf-8",
        });

        expect(res.status).toBe(0);
        expect(res.stdout).toContain("[Dry Run]");
        const content = fs.readFileSync(target, "utf-8");
        expect(content).toBe(original);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("executes CLI 'ail patch --reverse' rolling back changes", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli_patch_rev_"));
      try {
        const target = path.join(tmpDir, "math.ail");
        fs.writeFileSync(target, "fn foo():\n  return 1\n", "utf-8");

        const patch =
          "--- a/math.ail\n+++ b/math.ail\n@@ -1,2 +1,2 @@\n fn foo():\n-  return 1\n+  return 555\n";

        // Forward
        spawnSync("bun", ["./bin/ail.ts", "patch", target, "-"], {
          input: patch,
          encoding: "utf-8",
        });
        expect(fs.readFileSync(target, "utf-8")).toContain("return 555");

        // Reverse
        const res = spawnSync("bun", ["./bin/ail.ts", "patch", target, "-", "--reverse"], {
          input: patch,
          encoding: "utf-8",
        });

        expect(res.status).toBe(0);
        expect(res.stdout).toContain("✔ Successfully rolled back (reversed) patch for");
        expect(fs.readFileSync(target, "utf-8")).toContain("return 1");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
