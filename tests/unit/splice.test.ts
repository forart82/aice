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
import { program as cliProgram } from "../../src/cli.js";
import { AICE_MCP_TOOLS, AICE_WRITE_TOOL, AiceMcpServer } from "../../src/mcp/server.js";
import type { FunctionDecl } from "../../src/core/ast.js";
import { parse } from "../../src/core/parser.js";
import { createFile } from "../../src/tools/create.js";
import { splice, spliceBatch, spliceSource } from "../../src/tools/splice.js";

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
        fs.writeFileSync(
          path.join(tmpDir, "aice.config.json"),
          JSON.stringify({ enabled: true }),
          "utf-8",
        );
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

  describe("Unified Mutation Engine & Write Alias", () => {
    it("creates target file and parent directories automatically when file does not exist", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aice_splice_autocreate_"));
      try {
        fs.writeFileSync(
          path.join(tmpDir, "aice.config.json"),
          JSON.stringify({ enabled: true }),
          "utf-8",
        );
        const deepFilePath = path.join(tmpDir, "nested", "sub", "created.ts");
        const code = "export const answer: number = 42;\n";

        const res = await splice(deepFilePath, {
          code,
          projectRoot: tmpDir,
        });

        expect(res.success).toBe(true);
        expect(fs.existsSync(deepFilePath)).toBe(true);
        expect(fs.readFileSync(deepFilePath, "utf-8")).toBe(code);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("performs full file overwrite when target file exists and no selector or hunk is provided", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aice_splice_overwrite_"));
      try {
        fs.writeFileSync(
          path.join(tmpDir, "aice.config.json"),
          JSON.stringify({ enabled: true }),
          "utf-8",
        );
        const filePath = path.join(tmpDir, "target.ts");
        fs.writeFileSync(
          filePath,
          "export const legacy1 = 1;\nexport const legacy2 = 2;\n",
          "utf-8",
        );

        const newContent = "export const rewritten = 999;\n";
        const res = await splice(filePath, {
          code: newContent,
          projectRoot: tmpDir,
        });

        expect(res.success).toBe(true);
        const onDisk = fs.readFileSync(filePath, "utf-8");
        expect(onDisk).toBe(newContent);
        expect(onDisk).not.toContain("legacy1");
        expect(onDisk).not.toContain("legacy2");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("registers 'write' command as an alias to 'splice' in Commander and exports via src/cli.ts", () => {
      const cmd = program.commands.find((c) => c.name() === "splice");
      expect(cmd).toBeDefined();
      expect(cmd?.aliases()).toContain("write");

      const cliCmd = cliProgram.commands.find((c) => c.name() === "splice");
      expect(cliCmd).toBeDefined();
      expect(cliCmd?.aliases()).toContain("write");
    });

    it("executes CLI 'write' command to create non-existent file with parent directories", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli_write_create_"));
      try {
        fs.writeFileSync(
          path.join(tmpDir, "aice.config.json"),
          JSON.stringify({ enabled: true }),
          "utf-8",
        );
        const deepFile = path.join(tmpDir, "nested", "folder", "created_by_cli.ts");
        const code = "export const cliGenerated = true;\n";

        const res = spawnSync("bun", ["./bin/aice.ts", "write", deepFile, "-c", code], {
          encoding: "utf-8",
        });

        expect(res.status).toBe(0);
        expect(fs.existsSync(deepFile)).toBe(true);
        expect(fs.readFileSync(deepFile, "utf-8")).toBe(code);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("executes CLI 'write' command to perform full file overwrite when no selector is given", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli_write_overwrite_"));
      try {
        fs.writeFileSync(
          path.join(tmpDir, "aice.config.json"),
          JSON.stringify({ enabled: true }),
          "utf-8",
        );
        const file = path.join(tmpDir, "full_overwrite.ts");
        fs.writeFileSync(file, "export const oldA = 1;\nexport const oldB = 2;\n", "utf-8");

        const newCode = "export const brandNew = 100;\n";
        const res = spawnSync("bun", ["./bin/aice.ts", "write", file, "-c", newCode], {
          encoding: "utf-8",
        });

        expect(res.status).toBe(0);
        const onDisk = fs.readFileSync(file, "utf-8");
        expect(onDisk).toBe(newCode);
        expect(onDisk).not.toContain("oldA");
        expect(onDisk).not.toContain("oldB");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("executes CLI 'write' command with symbol selector for surgical splice", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli_write_surgical_"));
      try {
        fs.writeFileSync(
          path.join(tmpDir, "aice.config.json"),
          JSON.stringify({ enabled: true }),
          "utf-8",
        );
        const file = path.join(tmpDir, "math.aice");
        fs.writeFileSync(file, "fn calc(a: int) -> int:\n  return a * 2\n", "utf-8");

        const res = spawnSync(
          "bun",
          ["./bin/aice.ts", "write", file, "-s", "calc", "-b", "return a * 50"],
          { encoding: "utf-8" },
        );

        expect(res.status).toBe(0);
        expect(res.stdout).toContain("✔ Spliced body of 'calc'");
        const content = fs.readFileSync(file, "utf-8");
        expect(content).toContain("return a * 50");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("MCP server exposes AICE_WRITE_TOOL and executes 'aice_write' identically to 'aice_splice'", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp_write_test_"));
      try {
        fs.writeFileSync(
          path.join(tmpDir, "aice.config.json"),
          JSON.stringify({ enabled: true }),
          "utf-8",
        );
        expect(AICE_WRITE_TOOL.name).toBe("aice_write");
        expect(AICE_WRITE_TOOL.inputSchema).toBeDefined();

        const server = new AiceMcpServer({ workspaceRoot: tmpDir });

        // 1. Create file with parent dirs via MCP aice_write
        const newFile = path.join(tmpDir, "dir1", "dir2", "created_by_mcp.ts");
        const createRes = (await server.handleRequest(101, "tools/call", {
          name: "aice_write",
          arguments: {
            filePath: newFile,
            code: "export const mcpCreated = 1;\n",
          },
        })) as any;

        expect(createRes.isError).toBeFalsy();
        expect(fs.existsSync(newFile)).toBe(true);
        expect(fs.readFileSync(newFile, "utf-8")).toBe("export const mcpCreated = 1;\n");

        // 2. Full overwrite via MCP aice_write
        const overwriteRes = (await server.handleRequest(102, "tools/call", {
          name: "aice_write",
          arguments: {
            filePath: newFile,
            code: "export const mcpOverwritten = 2;\n",
          },
        })) as any;

        expect(overwriteRes.isError).toBeFalsy();
        expect(fs.readFileSync(newFile, "utf-8")).toBe("export const mcpOverwritten = 2;\n");

        // 3. Surgical update via MCP aice_write
        const surgicalFile = path.join(tmpDir, "surgical_mcp.ts");
        fs.writeFileSync(
          surgicalFile,
          "export function f1(): number { return 1; }\nexport function f2(): number { return 2; }\n",
          "utf-8",
        );

        const surgicalRes = (await server.handleRequest(103, "tools/call", {
          name: "aice_write",
          arguments: {
            filePath: surgicalFile,
            symbol: "f1",
            code: "export function f1(): number { return 100; }",
          },
        })) as any;

        expect(surgicalRes.isError).toBeFalsy();
        const content = fs.readFileSync(surgicalFile, "utf-8");
        expect(content).toContain("return 100");
        expect(content).toContain("f2(): number { return 2; }");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe("Unified Write / Splice Hardening & Benchmark Regression Suite", () => {
    it("prevents data loss when splice/write is called on an existing file without payload or accidental empty payload", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "splice_dataloss_guard_"));
      try {
        const existing = path.join(tmpDir, "important.ts");
        const origContent = "export const SECRET_KEY = 42;\n";
        fs.writeFileSync(existing, origContent, "utf-8");

        // 1. Missing code/body/edits/delete must reject and keep file intact
        await expect(splice(existing, {})).rejects.toThrow(/Must provide replacement code/);
        expect(fs.readFileSync(existing, "utf-8")).toBe(origContent);

        // 2. Empty string on existing file without --overwrite / :overwrite must reject
        await expect(splice(existing, { code: "" })).rejects.toThrow(/Refusing to overwrite/);
        expect(fs.readFileSync(existing, "utf-8")).toBe(origContent);

        // 3. Explicit overwrite: true or ':overwrite' allows intentional truncation
        await splice(existing, { code: "", overwrite: true });
        expect(fs.readFileSync(existing, "utf-8")).toBe("");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("resolves config relative to external target paths even without local aice.config.json while cwd is disabled", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli_external_nocfg_"));
      try {
        // Note: NO aice.config.json inside tmpDir!
        const fileA = path.join(tmpDir, "alpha.ts");
        const fileB = path.join(tmpDir, "beta.ts");

        // 1. Multi-file --stdin stream mixing creation + surgical splice
        const stream = [
          `=== ${fileA} ===`,
          "export function alphaFn(): number { return 10; }",
          "export function keepFn(): number { return 99; }",
          `=== ${fileB} ===`,
          "export function betaFn(): number { return 20; }",
        ].join("\n");
        const createStreamRes = spawnSync("bun", ["./bin/aice.ts", "write", "--stdin"], {
          input: stream,
          encoding: "utf-8",
        });
        expect(createStreamRes.status).toBe(0);
        expect(fs.existsSync(fileA)).toBe(true);
        expect(fs.existsSync(fileB)).toBe(true);

        // 2. Multi-target `outline` tolerates a missing path alongside valid paths
        const missingFile = path.join(tmpDir, "ghost.ts");
        const outlineRes = spawnSync(
          "bun",
          ["./bin/aice.ts", "outline", fileA, missingFile],
          { encoding: "utf-8" },
        );
        expect(outlineRes.status).toBe(0);
        expect(outlineRes.stdout).toContain("alphaFn");
        expect(outlineRes.stdout).toContain("// not found:");

        // 3. Multi-target `context` resolves cross-file `-s "alphaFn,betaFn"` without aborting on file 1
        const ctxRes = spawnSync(
          "bun",
          ["./bin/aice.ts", "context", fileA, fileB, "-s", "alphaFn,betaFn"],
          { encoding: "utf-8" },
        );
        expect(ctxRes.status).toBe(0);
        expect(ctxRes.stdout).toContain("alphaFn");
        expect(ctxRes.stdout).toContain("betaFn");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("supports CLI --delete flag before <file>, inline file:symbol, leading-colon selectors, and positional code recovery", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli_ergonomics_"));
      try {
        const routerFile = path.join(tmpDir, "telemetry_router.ts");
        fs.writeFileSync(
          routerFile,
          [
            "export function activeFlush(): number { return 1; }",
            "export function legacySpanFlush(): number { return 0; }",
            "export function extraLegacy(): number { return -1; }",
          ].join("\n") + "\n",
          "utf-8",
        );

        // 1. RW-10 regression: `--delete` placed right before `<file>` (`-s sym --delete file.ts`)
        const delRes1 = spawnSync(
          "bun",
          ["./bin/aice.ts", "splice", "--no-idioms", "-s", "legacySpanFlush", "--delete", routerFile],
          { encoding: "utf-8" },
        );
        expect(delRes1.status).toBe(0);
        expect(fs.readFileSync(routerFile, "utf-8")).not.toContain("legacySpanFlush");
        expect(fs.readFileSync(routerFile, "utf-8")).toContain("activeFlush");

        // 2. `--delete file.ts:extraLegacy` inline selector form
        const delRes2 = spawnSync(
          "bun",
          ["./bin/aice.ts", "splice", "--delete", `${routerFile}:extraLegacy`],
          { encoding: "utf-8" },
        );
        expect(delRes2.status).toBe(0);
        expect(fs.readFileSync(routerFile, "utf-8")).not.toContain("extraLegacy");

        // 3. RW-06 regression: inline `file:symbol` positional target + leading `:eof`, `:imports`, `:L1-L1`
        const inlineSymRes = spawnSync(
          "bun",
          [
            "./bin/aice.ts",
            "splice",
            `${routerFile}:activeFlush`,
            "-c",
            "export function activeFlush(): number { return 777; }",
          ],
          { encoding: "utf-8" },
        );
        expect(inlineSymRes.status).toBe(0);
        expect(fs.readFileSync(routerFile, "utf-8")).toContain("777");

        const eofRes = spawnSync(
          "bun",
          ["./bin/aice.ts", "write", routerFile, "-s", ":eof", "-c", "export const TAIL = true;"],
          { encoding: "utf-8" },
        );
        expect(eofRes.status).toBe(0);
        expect(fs.readFileSync(routerFile, "utf-8")).toContain("export const TAIL = true;");

        const impRes = spawnSync(
          "bun",
          [
            "./bin/aice.ts",
            "write",
            routerFile,
            "-s",
            ":imports",
            "-c",
            "import * as path from 'node:path';",
          ],
          { encoding: "utf-8" },
        );
        expect(impRes.status).toBe(0);
        expect(fs.readFileSync(routerFile, "utf-8")).toContain("import * as path from 'node:path';");

        // 4. Positional code trap recovery: `aice write <file> "export const X = 5;"` (without -c)
        const posFile = path.join(tmpDir, "positional.ts");
        const posRes = spawnSync(
          "bun",
          [
            "./bin/aice.ts",
            "write",
            posFile,
            "export const POSITIONAL_OK = 55;",
            "--json",
          ],
          { encoding: "utf-8" },
        );
        expect(posRes.status).toBe(0);
        const parsedJson = JSON.parse(posRes.stdout);
        expect(parsedJson.success).toBe(true);
        expect(fs.readFileSync(posFile, "utf-8")).toContain("export const POSITIONAL_OK = 55;");

        // 5. `--stdin` JSON array mixing idiom registration + splice items (#23)
        const jsonBatchFile = path.join(tmpDir, "json_batch.ts");
        const stdinJsonRes = spawnSync(
          "bun",
          ["./bin/aice.ts", "write", "--stdin", "--idioms", "--json"],
          {
            input: JSON.stringify([
              { action: "idiom", name: "$addTen", params: ["$0"], body: "($0 + 10)" },
              {
                file: jsonBatchFile,
                content: "export function plusTen(v: number): number { return $addTen(v); }\n",
              },
            ]),
            encoding: "utf-8",
          },
        );
        expect(stdinJsonRes.status).toBe(0);
        expect(fs.readFileSync(jsonBatchFile, "utf-8")).toContain("(v + 10)");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("compiles Python classes without duplicate 'self' and promotes terminal return expressions (RW-02 regression)", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "py_class_parity_"));
      try {
        const pyFile = path.join(tmpDir, "limiter.py");
        const aicePyClass = [
          "pub class SlidingWindowLimiter:",
          "  fn __init__(self, limit: int):",
          "    self.limit = limit",
          "    self._buckets = {}",
          "",
          "  pub fn allow(self, tenant_id: str, cost: int = 1) -> bool:",
          "    used = self._buckets.get(tenant_id, 0)",
          "    if used + cost <= self.limit:",
          "      self._buckets[tenant_id] = used + cost",
          "      return True",
          "    False",
        ].join("\n");

        // 1. Greenfield via splice/write (create parity)
        const res = await splice(pyFile, { code: aicePyClass });
        expect(res.success).toBe(true);
        const pyOut = fs.readFileSync(pyFile, "utf-8");
        expect(pyOut).toContain("def __init__(self, limit: int):");
        expect(pyOut).not.toContain("self, self");
        expect(pyOut).toContain("def allow(self, tenant_id: str, cost: int = 1) -> bool:");
        expect(pyOut).toContain("return False");

        // 2. Surgical method splice with implicit return expression on existing Python class
        await splice(pyFile, {
          symbol: "SlidingWindowLimiter.allow",
          code: [
            "pub fn allow(self, tenant_id: str, cost: int = 1) -> bool:",
            "  if cost <= 0:",
            "    True",
            "  else:",
            "    cost <= self.limit",
          ].join("\n"),
        });
        const updatedPy = fs.readFileSync(pyFile, "utf-8");
        expect(updatedPy).not.toContain("self, self");
        expect(updatedPy).toContain("return True");
        expect(updatedPy).toContain("return cost <= self.limit");

        // 3. Native Python with duplicate `self` is caught by pre-write syntax validation
        await expect(
          createFile(path.join(tmpDir, "bad.py"), {
            code: "class Bad:\n    def broken(self, self, x: int) -> int:\n        return x\n",
          }),
        ).rejects.toThrow(/Duplicate parameter 'self'/);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("enforces pre-write syntax validation on overwrite and supports @idiom pre-headers & @replace-docs in spliceBatch streams", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "stream_parity_"));
      try {
        const existingTs = path.join(tmpDir, "service.ts");
        fs.writeFileSync(
          existingTs,
          "/** Old JSDoc that should be dropped */\nexport function calc(x: number): number {\n  return x;\n}\n",
          "utf-8",
        );

        const newCss = path.join(tmpDir, "theme.css");
        const stream = [
          "@idiom $clampPos($0) = Math.max(0, $0)",
          "",
          `=== ${newCss} ===`,
          ".panel { d: flex; fd: column; g: 12px; bg: #070810; }",
          `=== ${existingTs}:calc @replace-docs ===`,
          "export function calc(x: number): number {",
          "  return $clampPos(x) * 2;",
          "}",
        ].join("\n");

        const batchRes = await spliceBatch(stream, { idioms: true });
        expect(batchRes.success).toBe(true);
        const cssOut = fs.readFileSync(newCss, "utf-8");
        expect(cssOut).toContain("display: flex;");
        expect(cssOut).toContain("flex-direction: column;");

        const tsOut = fs.readFileSync(existingTs, "utf-8");
        expect(tsOut).toContain("Math.max(0, x) * 2");
        expect(tsOut).not.toContain("Old JSDoc that should be dropped");

        // Pre-write validation still rejects broken syntax on overwrite!
        await expect(
          splice(existingTs, {
            code: "export function broken(((: number { return ;;;",
            overwrite: true,
          }),
        ).rejects.toThrow(/syntax|compile/i);
        // Existing valid file remains untouched after rejected overwrite
        expect(fs.readFileSync(existingTs, "utf-8")).toContain("Math.max(0, x) * 2");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("keeps AICE_MCP_TOOLS at 7 tools while supporting content alias, inline filePath:symbol, and inlineIdioms in aice_write", async () => {
      expect(AICE_MCP_TOOLS).toHaveLength(7);
      const spliceSchema = AICE_MCP_TOOLS.find((t) => t.name === "aice_splice");
      expect(spliceSchema?.description).toContain("aice_write");
      expect(spliceSchema?.inputSchema.properties).toHaveProperty("content");
      expect(spliceSchema?.inputSchema.properties).toHaveProperty("overwrite");
      expect(spliceSchema?.inputSchema.properties).toHaveProperty("inlineIdioms");

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp_parity_"));
      try {
        // No aice.config.json in tmpDir!
        const server = new AiceMcpServer({ workspaceRoot: tmpDir });

        const createRes = (await server.handleRequest(201, "tools/call", {
          name: "aice_write",
          arguments: {
            path: "sub/math.ts",
            content:
              "export function doubleIt(n: number): number { return n * 2; }\nexport function keepMe(): number { return 1; }\n",
          },
        })) as any;
        expect(createRes.isError).toBeFalsy();

        const inlineRes = (await server.handleRequest(202, "tools/call", {
          name: "aice_write",
          arguments: {
            filePath: "sub/math.ts:doubleIt",
            inlineIdioms: ["$triple($0)=($0 * 3)"],
            idioms: true,
            content: "export function doubleIt(n: number): number { return $triple(n); }",
          },
        })) as any;
        expect(inlineRes.isError).toBeFalsy();
        const finalCode = fs.readFileSync(path.join(tmpDir, "sub", "math.ts"), "utf-8");
        expect(finalCode).toContain("n * 3");
        expect(finalCode).toContain("keepMe(): number { return 1; }");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("preserves PHP self::CONST static scope while rewriting explicit fn(self, ...) -> this.prop on TS class splices", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "receiver_parity_"));
      try {
        // 1. PHP class: `self.TAX_RATE` & `self.roundCents(...)` (no `self` param) must emit `self::`, NOT `$this->`
        const phpFile = path.join(tmpDir, "OrderCalculator.php");
        await createFile(phpFile, {
          code: [
            "pub class OrderCalculator:",
            "  subtotal: float = 0.0",
            "",
            "  static fn roundCents(v: float) -> float:",
            "    return v",
            "",
            "  pub fn totalWithTax() -> float:",
            "    return self.roundCents(this.subtotal * (1.0 + self.TAX_RATE))",
          ].join("\n"),
        });
        const phpCreated = fs.readFileSync(phpFile, "utf-8");
        expect(phpCreated).toContain("self::TAX_RATE");
        expect(phpCreated).toContain("self::roundCents(");
        expect(phpCreated).toContain("$this->subtotal");
        expect(phpCreated).not.toContain("$this->TAX_RATE");

        // Surgical splice on PHP method also preserves `self::`
        await splice(phpFile, {
          symbol: "OrderCalculator.totalWithTax",
          code: [
            "pub fn totalWithTax() -> float:",
            "  return self.roundCents(this.subtotal * self.TAX_RATE)",
          ].join("\n"),
        });
        const phpSpliced = fs.readFileSync(phpFile, "utf-8");
        expect(phpSpliced).toContain("self::TAX_RATE");
        expect(phpSpliced).toContain("self::roundCents(");
        expect(phpSpliced).not.toContain("$this->TAX_RATE");

        // 2. TS single-method splice: `fn addScore(self, delta: int)` strips `self` param and rewrites `self.total` -> `this.total`
        const tsFile = path.join(tmpDir, "ScoreBoard.ts");
        fs.writeFileSync(
          tsFile,
          "export class ScoreBoard {\n  public total = 0;\n  public addScore(delta: number): number {\n    return this.total;\n  }\n}\n",
          "utf-8",
        );
        await splice(tsFile, {
          symbol: "ScoreBoard.addScore",
          code: [
            "pub fn addScore(self, delta: int) -> int:",
            "  self.total = delta > 0 ? self.total + delta : self.total",
            "  return self.total",
          ].join("\n"),
        });
        const tsSpliced = fs.readFileSync(tsFile, "utf-8");
        expect(tsSpliced).toContain("addScore(delta: number): number");
        expect(tsSpliced).not.toContain("(self");
        expect(tsSpliced).toContain("this.total + delta");
        expect(tsSpliced).toContain("return this.total;");

        // When `self` is NOT params[0], local `self` identifier is untouched
        await splice(tsFile, {
          symbol: "ScoreBoard.addScore",
          code: [
            "pub fn addScore(delta: int) -> int:",
            "  let self = delta + 1",
            "  return this.total + self",
          ].join("\n"),
        });
        const tsLocalSelf = fs.readFileSync(tsFile, "utf-8");
        expect(tsLocalSelf).toContain("const self = delta + 1;");
        expect(tsLocalSelf).toContain("return this.total + self;");

        // Unshadowed canonical AICE `self.total` without `self` in params also rewrites to `this.total`
        await splice(tsFile, {
          symbol: "ScoreBoard.addScore",
          code: "pub fn addScore(delta: int) -> int = self.total + delta",
        });
        expect(fs.readFileSync(tsFile, "utf-8")).toContain("this.total + delta");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
