/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for AIL 2.0 Deterministic Zero-Token Formatting Pre-Pass Engine (Step 21).
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { program } from "../../bin/ail.js";
import {
  formatAilFile,
  formatAilPath,
  formatAilSource,
  generateUnifiedDiff,
} from "../../src/tools/fmt.js";

describe("AIL 2.0 Deterministic Zero-Token Formatting Pre-Pass Engine (Step 21)", () => {
  describe("Indentation Normalization", () => {
    it("normalizes inconsistent 4-space indentation to 2 spaces", () => {
      const src = `
fn calculate(a: int) -> int:
    x := a * 2
    if x > 10:
        ret x + 1
    ret x
`.trim();

      const formatted = formatAilSource(src);
      const expected = `
fn calculate(a: int) -> int:
  x := a * 2
  if x > 10:
    ret x + 1
  ret x
`.trim() + "\n";

      expect(formatted).toBe(expected);
    });

    it("normalizes inconsistent 3-space indentation to 2 spaces", () => {
      const src = `
type User:
   id: str
   name: str
   age: int
`.trim();

      const formatted = formatAilSource(src);
      const expected = `
type User:
  id: str
  name: str
  age: int
`.trim() + "\n";

      expect(formatted).toBe(expected);
    });

    it("handles deeply nested blocks (classes, methods, loops, conditionals)", () => {
      const src = `
class Service:
    pub fn process(items: [int]) -> int:
        sum := 0
        for item in items:
            if item > 0:
                sum += item
        ret sum
`.trim();

      const formatted = formatAilSource(src);
      const expected = `
class Service:
  pub fn process(items: [int]) -> int:
    sum := 0
    for item in items:
      if item > 0:
        sum += item
    ret sum
`.trim() + "\n";

      expect(formatted).toBe(expected);
    });

    it("supports custom indentation space count via options.indent", () => {
      const src = `
fn test():
  x := 1
  ret x
`.trim();

      const formatted = formatAilSource(src, { indent: 4 });
      const expected = `
fn test():
    x := 1
    ret x
`.trim() + "\n";

      expect(formatted).toBe(expected);
    });

    it("aligns closing delimiters with opening statements", () => {
      const src = `
let arr = [
    1,
    2,
    3
]
`.trim();

      const formatted = formatAilSource(src);
      const expected = `
let arr = [
  1,
  2,
  3
]
`.trim() + "\n";

      expect(formatted).toBe(expected);
    });
  });

  describe("Operator Spacing Normalization", () => {
    it("normalizes spacing around binary arithmetic and assignment operators", () => {
      const src = `
x:=1+2*3/4%5
x+=10
x-=2
x*=3
x/=4
`.trim();

      const formatted = formatAilSource(src);
      const expected = `
x := 1 + 2 * 3 / 4 % 5
x += 10
x -= 2
x *= 3
x /= 4
`.trim() + "\n";

      expect(formatted).toBe(expected);
    });

    it("normalizes spacing around equality and relational comparison operators", () => {
      const src = `
if a==b&&c!=d||e<=f&&g>=h||i<j&&k>l:
  ret true
`.trim();

      const formatted = formatAilSource(src);
      const expected = `
if a == b && c != d || e <= f && g >= h || i < j && k > l:
  ret true
`.trim() + "\n";

      expect(formatted).toBe(expected);
    });

    it("normalizes spacing around bitwise and logical word operators", () => {
      const src = `
mask:=a|b&c^d
flag:=x and y or not z
isMember:=item in collection
isErr:=e instanceof Error
`.trim();

      const formatted = formatAilSource(src);
      const expected = `
mask := a | b & c ^ d
flag := x and y or not z
isMember := item in collection
isErr := e instanceof Error
`.trim() + "\n";

      expect(formatted).toBe(expected);
    });

    it("normalizes function return arrow -> and match fat arrow =>", () => {
      const src = `
fn test(a: int)->bool:
  match a:
    1=>true
    _=>false
`.trim();

      const formatted = formatAilSource(src);
      const expected = `
fn test(a: int) -> bool:
  match a:
    1 => true
    _ => false
`.trim() + "\n";

      expect(formatted).toBe(expected);
    });

    it("distinguishes unary minus/plus from binary operators", () => {
      const src = `
x := -5
y := +10
z := a - -b
res := f(-1, -2)
arr := [-1, -2, -3]
ret -x
`.trim();

      const formatted = formatAilSource(src);
      const expected = `
x := -5
y := +10
z := a - -b
res := f(-1, -2)
arr := [-1, -2, -3]
ret -x
`.trim() + "\n";

      expect(formatted).toBe(expected);
    });

    it("normalizes unary prefix ! and postfix unwrap ?", () => {
      const src = `
if !isValid:
  ret Err("Invalid")
val := parse()?
`.trim();

      const formatted = formatAilSource(src);
      const expected = `
if !isValid:
  ret Err("Invalid")
val := parse()?
`.trim() + "\n";

      expect(formatted).toBe(expected);
    });
  });

  describe("Colon and Comma Spacing", () => {
    it("normalizes punctuation: no space before comma/colon, 1 space after", () => {
      const src = `
fn test( a:int , b:str , c:[int] )->bool:
  ret true
`.trim();

      const formatted = formatAilSource(src);
      const expected = `
fn test(a: int, b: str, c: [int]) -> bool:
  ret true
`.trim() + "\n";

      expect(formatted).toBe(expected);
    });

    it("normalizes list and array literals [a, b, c]", () => {
      const src = "let items = [ a , b , c ]";
      const formatted = formatAilSource(src);
      expect(formatted).toBe("let items = [a, b, c]\n");
    });

    it("normalizes dictionary and record literals { a: 1, b: 2 }", () => {
      const src = "let obj = {a:1,b:2}";
      const formatted = formatAilSource(src);
      expect(formatted).toBe("let obj = { a: 1, b: 2 }\n");
    });

    it("preserves empty objects {} and arrays []", () => {
      const src = "let a = {}\nlet b = []";
      const formatted = formatAilSource(src);
      expect(formatted).toBe("let a = {}\nlet b = []\n");
    });

    it("preserves double colon :: without adding spaces", () => {
      const src = "val := RoadMask::North";
      const formatted = formatAilSource(src);
      expect(formatted).toBe("val := RoadMask::North\n");
    });
  });

  describe("Removal of Trailing Whitespace and Excess Blank Lines", () => {
    it("eliminates trailing whitespace on all lines", () => {
      const src = "fn test():   \n  x := 1   \n  ret x   \n";
      const formatted = formatAilSource(src);
      expect(formatted).toBe("fn test():\n  x := 1\n  ret x\n");
    });

    it("normalizes empty lines: max 1 empty line inside blocks", () => {
      const src = `
fn test():
  x := 1



  y := 2
`.trim();

      const formatted = formatAilSource(src);
      const expected = `
fn test():
  x := 1

  y := 2
`.trim() + "\n";

      expect(formatted).toBe(expected);
    });

    it("normalizes empty lines: max 2 empty lines between top-level declarations", () => {
      const src = `
fn a():
  ret 1





fn b():
  ret 2
`.trim();

      const formatted = formatAilSource(src);
      const expected = `
fn a():
  ret 1


fn b():
  ret 2
`.trim() + "\n";

      expect(formatted).toBe(expected);
    });

    it("ensures exact single trailing newline \\n at end of file", () => {
      const src1 = "fn test():\n  ret 1";
      expect(formatAilSource(src1)).toBe("fn test():\n  ret 1\n");

      const src2 = "fn test():\n  ret 1\n\n\n\n";
      expect(formatAilSource(src2)).toBe("fn test():\n  ret 1\n");
    });

    it("returns empty string for empty or whitespace-only source", () => {
      expect(formatAilSource("")).toBe("");
      expect(formatAilSource("   \n\n\t  \n")).toBe("");
    });
  });

  describe("Preserving String Literals, Template Literals, and Comments", () => {
    it("preserves string contents containing operators and punctuation completely intact", () => {
      const src = 'let msg = "Hello, world! 1 + 2 = 3: test"';
      const formatted = formatAilSource(src);
      expect(formatted).toBe('let msg = "Hello, world! 1 + 2 = 3: test"\n');
    });

    it("preserves multiline triple-quoted strings completely intact without altering internal indent", () => {
      const src = `
let doc = """
First line
    indented line inside doc
Third line
"""
`.trim();

      const formatted = formatAilSource(src);
      expect(formatted).toBe(src + "\n");
    });

    it("formats template literal expressions while keeping template text intact", () => {
      const src = "let t = `User: ${ user.name }, Total: ${ a+b }`";
      const formatted = formatAilSource(src);
      expect(formatted).toBe("let t = `User: ${user.name}, Total: ${a + b}`\n");
    });

    it("preserves line comments and inline comments intact", () => {
      const src = `
// Top level header comment
fn calculate():
  // Inside comment
  x := 1 // Inline comment
  ret x
`.trim();

      const formatted = formatAilSource(src);
      const expected = `
// Top level header comment
fn calculate():
  // Inside comment
  x := 1 // Inline comment
  ret x
`.trim() + "\n";

      expect(formatted).toBe(expected);
    });

    it("preserves triple slash /// docstrings intact", () => {
      const src = `
/// Service calculate documentation
/// Performs addition
pub fn add(a: int, b: int) -> int:
  ret a + b
`.trim();

      const formatted = formatAilSource(src);
      expect(formatted).toBe(src + "\n");
    });

    it("preserves block comments /* ... */ intact", () => {
      const src = `
/*
 * Block comment
 */
fn test():
  /* inline block */
  ret 1
`.trim();

      const formatted = formatAilSource(src);
      expect(formatted).toBe(src + "\n");
    });
  });

  describe("Idempotence: format(format(x)) === format(x)", () => {
    it("guarantees format(format(x)) === format(x) across comprehensive syntax forms", () => {
      const snippets = [
        `
module example

import { User, Session } from "./auth.js"

enum Status:
  Active
  Inactive(str)

type Order:
  id: str
  amount: flt
  tags: [str]

pub fn processOrder(order: Order, rate: flt) -> Result[flt, str]:
  if rate < 0.0:
    ret Err("Negative rate")
  total: flt := order.amount * (1.0 + rate)
  match order.tags:
    ["vip"] => ret Ok(total * 0.9)
    _ => ret Ok(total)
`,
        `
class Calculator:
  val base: int

  pub fn calc(x: int) -> int:
    ret this.base + x * 2
`,
        `
fn test():
  x := -1 + 2 * (3 - 4)
  y := { a: 1, b: "two" }
  z := [1, 2, 3]
  ret x
`,
      ];

      for (const snippet of snippets) {
        const round1 = formatAilSource(snippet.trim());
        const round2 = formatAilSource(round1);
        expect(round2).toBe(round1);
      }
    });
  });

  describe("formatAilFile and --check Mode", () => {
    it("reports formatted status without modifying disk in check mode", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fmt_check_"));
      try {
        const file = path.join(tmpDir, "test.ail");
        const unformatted = "fn test( a:int ,b:str )->bool: ret 1+2\n";
        fs.writeFileSync(file, unformatted, "utf-8");

        const result = await formatAilFile(file, { check: true });
        expect(result.isFormatted).toBe(false);
        expect(result.originalSource).toBe(unformatted);
        expect(result.formattedSource).toBe("fn test(a: int, b: str) -> bool: ret 1 + 2\n");

        // Verify disk was NOT modified
        const diskContent = fs.readFileSync(file, "utf-8");
        expect(diskContent).toBe(unformatted);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("writes formatted file atomically when write is permitted and check is false", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fmt_write_"));
      try {
        const file = path.join(tmpDir, "test.ail");
        const unformatted = "fn test( a:int )->int: ret a*2\n";
        fs.writeFileSync(file, unformatted, "utf-8");

        const result = await formatAilFile(file, { check: false, write: true });
        expect(result.isFormatted).toBe(false);

        // Verify disk WAS modified
        const diskContent = fs.readFileSync(file, "utf-8");
        expect(diskContent).toBe("fn test(a: int) -> int: ret a * 2\n");

        // Running format again should report already formatted
        const secondRun = await formatAilFile(file);
        expect(secondRun.isFormatted).toBe(true);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("generates unified diff when diff option is enabled", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fmt_diff_"));
      try {
        const file = path.join(tmpDir, "test.ail");
        const unformatted = "x:=1+2\n";
        fs.writeFileSync(file, unformatted, "utf-8");

        const result = await formatAilFile(file, { diff: true, check: true });
        expect(result.isFormatted).toBe(false);
        expect(result.diff).toBeDefined();
        expect(result.diff).toContain("--- a/");
        expect(result.diff).toContain("+++ b/");
        expect(result.diff).toContain("-x:=1+2");
        expect(result.diff).toContain("+x := 1 + 2");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe("Directory Traversal", () => {
    it("formats all .ail files recursively in a directory", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fmt_dir_"));
      try {
        const subDir = path.join(tmpDir, "sub");
        fs.mkdirSync(subDir);

        const file1 = path.join(tmpDir, "a.ail");
        const file2 = path.join(subDir, "b.ail");
        const file3 = path.join(tmpDir, "ignore.txt");

        fs.writeFileSync(file1, "fn a( x:int ): ret x\n", "utf-8");
        fs.writeFileSync(file2, "fn b( y:str ): ret y\n", "utf-8");
        fs.writeFileSync(file3, "do not touch", "utf-8");

        const results = await formatAilPath(tmpDir, { check: false, write: true });
        expect(Array.isArray(results)).toBe(true);
        if (Array.isArray(results)) {
          expect(results.length).toBe(2);
          expect(results.every((r) => !r.isFormatted)).toBe(true);
        }

        expect(fs.readFileSync(file1, "utf-8")).toBe("fn a(x: int): ret x\n");
        expect(fs.readFileSync(file2, "utf-8")).toBe("fn b(y: str): ret y\n");
        expect(fs.readFileSync(file3, "utf-8")).toBe("do not touch");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe("CLI Command Execution", () => {
    it("formats from stdin with --stdin flag to stdout", () => {
      const input = "fn test( a:int ,b:str )->bool: ret 1+2*3\n";
      const res = spawnSync("bun", ["./bin/ail.ts", "fmt", "--stdin"], {
        input,
        encoding: "utf-8",
      });

      expect(res.status).toBe(0);
      expect(res.stdout).toBe("fn test(a: int, b: str) -> bool: ret 1 + 2 * 3\n");
    });

    it("exits 0 with --stdin --check on already formatted code", () => {
      const input = "fn test(a: int, b: str) -> bool: ret 1 + 2 * 3\n";
      const res = spawnSync("bun", ["./bin/ail.ts", "fmt", "--stdin", "--check"], {
        input,
        encoding: "utf-8",
      });

      expect(res.status).toBe(0);
    });

    it("exits 1 with --stdin --check on unformatted code", () => {
      const input = "fn test( a:int )->int: ret a*2\n";
      const res = spawnSync("bun", ["./bin/ail.ts", "fmt", "--stdin", "--check"], {
        input,
        encoding: "utf-8",
      });

      expect(res.status).toBe(1);
    });

    it("outputs unified diff with --stdin --diff", () => {
      const input = "x:=1+2\n";
      const res = spawnSync("bun", ["./bin/ail.ts", "fmt", "--stdin", "--diff"], {
        input,
        encoding: "utf-8",
      });

      expect(res.status).toBe(0);
      expect(res.stdout).toContain("--- a/<stdin>");
      expect(res.stdout).toContain("+++ b/<stdin>");
      expect(res.stdout).toContain("-x:=1+2");
      expect(res.stdout).toContain("+x := 1 + 2");
    });

    it("executes CLI fmt on file modifying disk by default", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli_fmt_file_"));
      try {
        const file = path.join(tmpDir, "calc.ail");
        fs.writeFileSync(file, "fn calc( a:int )->int:\n    ret a*2\n", "utf-8");

        const res = spawnSync("bun", ["./bin/ail.ts", "fmt", file], {
          encoding: "utf-8",
        });

        expect(res.status).toBe(0);
        expect(res.stdout).toContain("Formatted");

        const content = fs.readFileSync(file, "utf-8");
        expect(content).toBe("fn calc(a: int) -> int:\n  ret a * 2\n");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("executes CLI fmt with --check exiting 1 on unformatted file", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli_fmt_chk_"));
      try {
        const file = path.join(tmpDir, "unformatted.ail");
        fs.writeFileSync(file, "x:=1+2\n", "utf-8");

        const res = spawnSync("bun", ["./bin/ail.ts", "fmt", file, "--check"], {
          encoding: "utf-8",
        });

        expect(res.status).toBe(1);
        expect(res.stderr).toContain("Needs formatting");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("executes CLI fmt with --diff printing unified diff", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli_fmt_diff_"));
      try {
        const file = path.join(tmpDir, "diff.ail");
        fs.writeFileSync(file, "x:=1+2\n", "utf-8");

        const res = spawnSync("bun", ["./bin/ail.ts", "fmt", file, "--diff", "--check"], {
          encoding: "utf-8",
        });

        expect(res.status).toBe(1);
        expect(res.stdout).toContain("--- a/");
        expect(res.stdout).toContain("+++ b/");
        expect(res.stdout).toContain("-x:=1+2");
        expect(res.stdout).toContain("+x := 1 + 2");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
