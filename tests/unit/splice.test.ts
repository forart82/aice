/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for AICE 2.0 AST Surgical Splice Engine (Step 19).
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { program } from "../../bin/aice.js";
import type { FunctionDecl } from "../../src/core/ast.js";
import { parse } from "../../src/core/parser.js";
import { splice, spliceSource } from "../../src/tools/splice.js";

describe("AICE 2.0 AST Surgical Splice Engine (Step 19)", () => {
  describe("Splicing Top-Level Functions", () => {
    it("splices entire function declaration (signature + body)", () => {
      const src = `
fn calculate(a: int) -> int:
  return a * 2

fn other():
  return 10
`.trim();

      const res = spliceSource(src, {
        symbol: "calculate",
        code: "fn calculate(a: int, b: int) -> int:\n  return a + b",
      });

      expect(res.success).toBe(true);
      expect(res.modifiedCode).toContain("fn calculate(a: int, b: int) -> int:\n  return a + b");
      expect(res.modifiedCode).toContain("fn other():\n  return 10");
      expect(res.originalSnippet).toBe("fn calculate(a: int) -> int:\n  return a * 2");
      expect(res.newSnippet).toBe("fn calculate(a: int, b: int) -> int:\n  return a + b");

      // Verify AST still parses cleanly
      const ast = parse(res.modifiedCode);
      expect(ast.items).toHaveLength(2);
    });

    it("splices only function body while preserving declaration signature and docstring", () => {
      const src = `
/// Calculates double value
pub fn calculate(a: int) -> int:
  return a * 2

fn sibling():
  return 42
`.trim();

      const res = spliceSource(src, {
        symbol: "calculate",
        body: "let doubled = a * 2\nreturn doubled + 1",
      });

      expect(res.success).toBe(true);
      expect(res.modifiedCode).toContain("/// Calculates double value");
      expect(res.modifiedCode).toContain("pub fn calculate(a: int) -> int:");
      expect(res.modifiedCode).toContain("  let doubled = a * 2\n  return doubled + 1");
      expect(res.modifiedCode).toContain("fn sibling():\n  return 42");

      const ast = parse(res.modifiedCode);
      expect(ast.items).toHaveLength(2);
    });

    it("splices expression-bodied function body", () => {
      const src = `fn double(x: int) -> int = x * 2\n`;
      const res = spliceSource(src, {
        symbol: "double",
        body: "x * 10",
      });

      expect(res.success).toBe(true);
      expect(res.modifiedCode).toBe("fn double(x: int) -> int = x * 10\n");
    });
  });

  describe("Splicing Class Methods", () => {
    it("splices class method declaration with dot syntax (ClassName.methodName)", () => {
      const src = `
class GameEngine:
  time: float

  fn step(dt: float) -> void:
    self.time += dt

  fn render() -> void:
    pass
`.trim();

      const res = spliceSource(src, {
        symbol: "GameEngine.step",
        code: "fn step(dt: float, maxDt: float) -> void:\n  self.time += dt\n  self.tick()",
      });

      expect(res.success).toBe(true);
      expect(res.modifiedCode).toContain("  fn step(dt: float, maxDt: float) -> void:");
      expect(res.modifiedCode).toContain("    self.time += dt\n    self.tick()");
      expect(res.modifiedCode).toContain("  fn render() -> void:");

      const ast = parse(res.modifiedCode);
      expect(ast.items).toHaveLength(1);
    });

    it("splices class method declaration with double-colon syntax (ClassName::methodName)", () => {
      const src = `
class Service:
  fn run():
    return 1
`.trim();

      const res = spliceSource(src, {
        symbol: "Service::run",
        body: "return 999",
      });

      expect(res.success).toBe(true);
      expect(res.modifiedCode).toContain("  fn run():\n    return 999");
    });

    it("splices class method body only, preserving method signature and indentation", () => {
      const src = `
class MathEngine:
  # Computes square
  static fn square(x: int) -> int:
    return x * x

  fn reset():
    pass
`.trim();

      const res = spliceSource(src, {
        symbol: "MathEngine.square",
        body: "let res = x * x\nreturn res",
      });

      expect(res.success).toBe(true);
      expect(res.modifiedCode).toContain("  # Computes square");
      expect(res.modifiedCode).toContain("  static fn square(x: int) -> int:");
      expect(res.modifiedCode).toContain("    let res = x * x\n    return res");
      expect(res.modifiedCode).toContain("  fn reset():");

      const ast = parse(res.modifiedCode);
      expect(ast.items).toHaveLength(1);
    });
  });

  describe("Splicing Class Properties, Types, and Interfaces", () => {
    it("splices class property", () => {
      const src = `
class User:
  id: int
  name: str
`.trim();

      const res = spliceSource(src, {
        symbol: "User.id",
        code: 'id: str = "uuid-1"',
      });

      expect(res.success).toBe(true);
      expect(res.modifiedCode).toContain('  id: str = "uuid-1"');
      expect(res.modifiedCode).toContain("  name: str");
    });

    it("splices struct / interface type field", () => {
      const src = `
type Config:
  port: int
  host: str
`.trim();

      const res = spliceSource(src, {
        symbol: "Config.port",
        code: "port: int = 8080",
      });

      expect(res.success).toBe(true);
      expect(res.modifiedCode).toContain("  port: int = 8080");
      expect(res.modifiedCode).toContain("  host: str");
    });

    it("splices enum variant", () => {
      const src = `
enum Status:
  Pending
  Active
`.trim();

      const res = spliceSource(src, {
        symbol: "Status.Pending",
        code: "Pending(int)",
      });

      expect(res.success).toBe(true);
      expect(res.modifiedCode).toContain("  Pending(int)");
      expect(res.modifiedCode).toContain("  Active");
    });

    it("appends new method to class via --append", () => {
      const src = `
class Math:
  fn add(a: int, b: int) -> int:
    return a + b
`.trim();

      const res = spliceSource(src, {
        symbol: "Math",
        append: true,
        code: "fn sub(a: int, b: int) -> int:\n  return a - b",
      });

      expect(res.success).toBe(true);
      expect(res.modifiedCode).toContain("class Math:");
      expect(res.modifiedCode).toContain("  fn add(a: int, b: int) -> int:");
      expect(res.modifiedCode).toContain("  fn sub(a: int, b: int) -> int:");
      expect(res.modifiedCode).toContain("    return a - b");

      const ast = parse(res.modifiedCode);
      expect(ast.items).toHaveLength(1);
    });

    it("appends new declaration to module via --append without symbol", () => {
      const src = `fn foo(): return 1\n`;
      const res = spliceSource(src, {
        append: true,
        code: "fn bar(): return 2",
      });

      expect(res.success).toBe(true);
      expect(res.modifiedCode).toContain("fn foo(): return 1");
      expect(res.modifiedCode).toContain("fn bar(): return 2");
    });
  });

  describe("Deleting Symbols (--delete)", () => {
    it("deletes a top-level function cleanly", () => {
      const src = `
fn first():
  return 1

fn toRemove():
  return 999

fn second():
  return 2
`.trim();

      const res = spliceSource(src, {
        symbol: "toRemove",
        delete: true,
      });

      expect(res.success).toBe(true);
      expect(res.modifiedCode).not.toContain("toRemove");
      expect(res.modifiedCode).toContain("fn first():\n  return 1");
      expect(res.modifiedCode).toContain("fn second():\n  return 2");

      const ast = parse(res.modifiedCode);
      expect(ast.items).toHaveLength(2);
    });

    it("deletes a class method cleanly", () => {
      const src = `
class Engine:
  fn start():
    pass

  fn obsolete():
    pass

  fn stop():
    pass
`.trim();

      const res = spliceSource(src, {
        symbol: "Engine.obsolete",
        delete: true,
      });

      expect(res.success).toBe(true);
      expect(res.modifiedCode).not.toContain("obsolete");
      expect(res.modifiedCode).toContain("  fn start():");
      expect(res.modifiedCode).toContain("  fn stop():");

      const ast = parse(res.modifiedCode);
      expect(ast.items).toHaveLength(1);
    });
  });

  describe("Inserting Symbols (--insert-after, --insert-before)", () => {
    it("inserts new declaration after target symbol", () => {
      const src = `
fn stepA():
  return 1

fn stepC():
  return 3
`.trim();

      const res = spliceSource(src, {
        insertAfter: "stepA",
        code: "fn stepB():\n  return 2",
      });

      expect(res.success).toBe(true);
      expect(res.modifiedCode).toContain("fn stepA():\n  return 1");
      expect(res.modifiedCode).toContain("fn stepB():\n  return 2");
      expect(res.modifiedCode).toContain("fn stepC():\n  return 3");

      const ast = parse(res.modifiedCode);
      expect(ast.items).toHaveLength(3);
      expect((ast.items as FunctionDecl[]).map((i) => i.name)).toEqual(["stepA", "stepB", "stepC"]);
    });

    it("inserts new declaration before target symbol", () => {
      const src = `
fn stepB():
  return 2
`.trim();

      const res = spliceSource(src, {
        insertBefore: "stepB",
        code: "fn stepA():\n  return 1",
      });

      expect(res.success).toBe(true);
      expect(res.modifiedCode).toContain("fn stepA():\n  return 1");
      expect(res.modifiedCode).toContain("fn stepB():\n  return 2");

      const ast = parse(res.modifiedCode);
      expect(ast.items).toHaveLength(2);
      expect((ast.items as FunctionDecl[]).map((i) => i.name)).toEqual(["stepA", "stepB"]);
    });

    it("inserts method inside class after existing method with correct indentation", () => {
      const src = `
class Runner:
  fn run():
    pass

  fn finish():
    pass
`.trim();

      const res = spliceSource(src, {
        insertAfter: "Runner.run",
        code: "fn pause():\n  pass",
      });

      expect(res.success).toBe(true);
      expect(res.modifiedCode).toContain("  fn pause():\n    pass");
      expect(res.modifiedCode).toContain("  fn finish():");

      const ast = parse(res.modifiedCode);
      expect(ast.items).toHaveLength(1);
    });
  });

  describe("Unified Diff Generation & Token Savings", () => {
    it("generates standard unified diff when diff: true is specified", () => {
      const oldCode = "fn calc(a: int) -> int:\n  return a * 2\n";
      const res = spliceSource(oldCode, {
        symbol: "calc",
        body: "return a * 10",
        diff: true,
      });

      expect(res.diff).toBeDefined();
      expect(res.diff).toContain("--- a/source.aice");
      expect(res.diff).toContain("+++ b/source.aice");
      expect(res.diff).toContain("-  return a * 2");
      expect(res.diff).toContain("+  return a * 10");
    });

    it("calculates accurate token savings metrics", () => {
      const src = `
// Long file header
fn funcA(): return 1
fn funcB(): return 2
fn funcC(): return 3
fn funcD(): return 4
fn target():
  return "old"
fn funcE(): return 5
fn funcF(): return 6
`.trim();

      const res = spliceSource(src, {
        symbol: "target",
        body: 'return "new"',
      });

      expect(res.tokensSaved).toBeGreaterThan(0);
    });
  });

  describe("File Operations, Dry Run & --compile Emitter Update", () => {
    it("respects dryRun: true and does not modify disk", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aice_splice_dry_"));
      try {
        const filePath = path.join(tmpDir, "test.aice");
        const originalContent = 'fn hello(): return "world"\n';
        fs.writeFileSync(filePath, originalContent, "utf-8");

        const res = await splice(filePath, {
          symbol: "hello",
          body: 'return "modified"',
          dryRun: true,
        });

        expect(res.success).toBe(true);
        expect(res.modifiedCode).toContain('return "modified"');
        // File on disk must remain unchanged!
        const onDisk = fs.readFileSync(filePath, "utf-8");
        expect(onDisk).toBe(originalContent);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("writes to disk atomically and updates target file when compile: true", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aice_splice_compile_"));
      try {
        const configPath = path.join(tmpDir, "aice.config.json");
        fs.writeFileSync(
          configPath,
          JSON.stringify(
            { mode: "side-by-side", targetLanguage: "typescript", watermark: false },
            null,
            2,
          ),
          "utf-8",
        );

        const aiceFile = path.join(tmpDir, "math.aice");
        fs.writeFileSync(aiceFile, "pub fn add(a: int, b: int) -> int:\n  return a + b\n", "utf-8");

        const res = await splice(aiceFile, {
          symbol: "add",
          body: "return a * b",
          compile: true,
          projectRoot: tmpDir,
        });

        expect(res.success).toBe(true);

        // Verify .aice file updated
        const updatedAice = fs.readFileSync(aiceFile, "utf-8");
        expect(updatedAice).toContain("return a * b");

        // Verify target .ts file was compiled!
        const targetTs = path.join(tmpDir, "math.ts");
        expect(fs.existsSync(targetTs)).toBe(true);
        const compiledTs = fs.readFileSync(targetTs, "utf-8");
        expect(compiledTs).toContain("a * b");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("preserves executable POSIX file mode (0o755) when splicing shell scripts", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aice_splice_mode_"));
      try {
        fs.writeFileSync(
          path.join(tmpDir, "aice.config.json"),
          JSON.stringify({ enabled: true }, null, 2),
          "utf-8",
        );
        const scriptFile = path.join(tmpDir, "run.sh");
        fs.writeFileSync(scriptFile, "#!/usr/bin/env bash\ngreet() {\n  echo old\n}\ngreet\n", {
          encoding: "utf-8",
          mode: 0o755,
        });
        fs.chmodSync(scriptFile, 0o755);

        const res = await splice(scriptFile, {
          symbol: "greet",
          code: "greet() {\n  echo new\n}",
          projectRoot: tmpDir,
        });
        expect(res.success).toBe(true);
        expect(fs.readFileSync(scriptFile, "utf-8")).toContain("echo new");
        const modeAfter = fs.statSync(scriptFile).mode & 0o777;
        expect(modeAfter & 0o111).toBe(0o111);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe("CLI Command Registration & Options", () => {
    it("has 'splice' command registered with all required options in Commander", () => {
      const cmd = program.commands.find((c) => c.name() === "splice");
      expect(cmd).toBeDefined();

      const optionNames = cmd?.options.map((o) => o.name());
      expect(optionNames).toContain("symbol");
      expect(optionNames).toContain("code");
      expect(optionNames).toContain("body");
      expect(optionNames).toContain("delete");
      expect(optionNames).toContain("insert-after");
      expect(optionNames).toContain("insert-before");
      expect(optionNames).toContain("dry-run");
      expect(optionNames).toContain("diff");
      expect(optionNames).toContain("compile");
    });

    it("executes CLI splice with --body modifying target file", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli_splice_body_"));
      try {
        const file = path.join(tmpDir, "math.aice");
        fs.writeFileSync(file, "fn calc(a: int) -> int:\n  return a * 2\n", "utf-8");

        const res = spawnSync(
          "bun",
          ["./bin/aice.ts", "splice", file, "-s", "calc", "-b", "return a * 10"],
          {
            encoding: "utf-8",
          },
        );

        expect(res.status).toBe(0);
        expect(res.stdout).toContain("✔ Spliced body of 'calc'");
        const content = fs.readFileSync(file, "utf-8");
        expect(content).toContain("return a * 10");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("executes CLI splice reading replacement code from stdin", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli_splice_stdin_"));
      try {
        const file = path.join(tmpDir, "math.aice");
        fs.writeFileSync(file, "fn calc(a: int) -> int:\n  return a * 2\n", "utf-8");

        const res = spawnSync("bun", ["./bin/aice.ts", "splice", file, "-s", "calc"], {
          input: "fn calc(a: int, b: int) -> int:\n  return a + b",
          encoding: "utf-8",
        });

        expect(res.status).toBe(0);
        expect(res.stdout).toContain("✔ Spliced symbol 'calc'");
        const content = fs.readFileSync(file, "utf-8");
        expect(content).toContain("fn calc(a: int, b: int) -> int:\n  return a + b");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("executes CLI splice with --diff flag and --dry-run without modifying disk", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli_splice_diff_"));
      try {
        const file = path.join(tmpDir, "math.aice");
        const original = "fn calc(a: int) -> int:\n  return a * 2\n";
        fs.writeFileSync(file, original, "utf-8");

        const res = spawnSync(
          "bun",
          [
            "./bin/aice.ts",
            "splice",
            file,
            "-s",
            "calc",
            "-b",
            "return a * 100",
            "--diff",
            "--dry-run",
          ],
          { encoding: "utf-8" },
        );

        expect(res.status).toBe(0);
        expect(res.stdout).toContain("--- a/");
        expect(res.stdout).toContain("+++ b/");
        expect(res.stdout).toContain("-  return a * 2");
        expect(res.stdout).toContain("+  return a * 100");
        expect(res.stdout).toContain("[Dry Run]");

        const onDisk = fs.readFileSync(file, "utf-8");
        expect(onDisk).toBe(original);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("executes CLI splice with --delete", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli_splice_del_"));
      try {
        const file = path.join(tmpDir, "math.aice");
        fs.writeFileSync(file, "fn a(): return 1\nfn b(): return 2\n", "utf-8");

        const res = spawnSync("bun", ["./bin/aice.ts", "splice", file, "-s", "b", "--delete"], {
          encoding: "utf-8",
        });

        expect(res.status).toBe(0);
        expect(res.stdout).toContain("✔ Deleted symbol 'b'");
        const content = fs.readFileSync(file, "utf-8");
        expect(content).not.toContain("fn b");
        expect(content).toContain("fn a");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
