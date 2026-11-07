/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Step 6: Multi-Target Code Emitters Harmonization Unit Tests.
 * Verifies that all emitters correctly handle:
 *  - Relational operators: 'in' and 'instanceof'
 *  - Assignment expressions in expression positions: AssignExpr
 *  - Compound assignment statements: AssignStmt with all AssignOp variants
 */

import { describe, expect, it } from "vitest";
import { parse } from "../../src/core/parser.js";
import {
  CppEmitter,
  CSharpEmitter,
  emitTarget,
  GoEmitter,
  PythonEmitter,
  RustEmitter,
  TypeScriptEmitter,
} from "../../src/emitters/index.js";

describe("Step 6: Multi-Target Code Emitters Harmonization", () => {
  describe("TypeScript Emitter (ts-emitter.ts)", () => {
    it("emits 'in' binary operator cleanly", () => {
      const src = `
fn hasProperty(key: str, obj: any) -> bool:
  ret key in obj
`;
      const mod = parse(src, "hasProp.ts.aice");
      const out = emitTarget(mod, "typescript");
      expect(out).toContain("return (key in obj);");
    });

    it("emits 'instanceof' binary operator cleanly", () => {
      const src = `
fn isError(err: any) -> bool:
  ret err instanceof Error
`;
      const mod = parse(src, "isError.ts.aice");
      const out = emitTarget(mod, "typescript");
      expect(out).toContain("return (err instanceof Error);");
    });

    it("emits AssignExpr parenthesized in expression context", () => {
      const src = `
fn testExprs():
  let mut f = (item) => (item.count += 1)
  let mut g = (mask) => (flags |= mask)
  let mut h = (x) => (x = 42)
`;
      const mod = parse(src, "assignExpr.ts.aice");
      const out = emitTarget(mod, "typescript");
      expect(out).toContain("(item.count += 1)");
      expect(out).toContain("(flags |= mask)");
      expect(out).toContain("(x = 42)");
    });

    it("emits AssignExpr in while condition context", () => {
      const src = `
fn matchAll(regex: any, s: str):
  while ((pMatch = regex.exec(s)) != nil):
    print(pMatch)
`;
      const mod = parse(src, "whileCond.ts.aice");
      const out = emitTarget(mod, "typescript");
      expect(out).toContain("while (((pMatch = regex.exec(s)) !== null)) {");
    });

    it("emits all 12 compound assignment operators in AssignStmt", () => {
      const src = `
fn runAssignments():
  let mut x = 10
  x += 1
  x -= 2
  x *= 3
  x /= 4
  x %= 5
  x |= 6
  x ^= 7
  x &= 8
  x <<= 1
  x >>= 2
  x >>>= 3
  x **= 4
`;
      const mod = parse(src, "compound.ts.aice");
      const out = emitTarget(mod, "typescript");
      expect(out).toContain("x += 1;");
      expect(out).toContain("x -= 2;");
      expect(out).toContain("x *= 3;");
      expect(out).toContain("x /= 4;");
      expect(out).toContain("x %= 5;");
      expect(out).toContain("x |= 6;");
      expect(out).toContain("x ^= 7;");
      expect(out).toContain("x &= 8;");
      expect(out).toContain("x <<= 1;");
      expect(out).toContain("x >>= 2;");
      expect(out).toContain("x >>>= 3;");
      expect(out).toContain("x **= 4;");
    });

    it("emits array element-wise compound assignments in AssignStmt", () => {
      const src = `
fn runArrayCompound():
  let mut [a, b] = [1, 2]
  [a, b] += [10, 20]
`;
      const mod = parse(src, "arrayCompound.ts.aice");
      const out = emitTarget(mod, "typescript");
      expect(out).toContain("a += 10;");
      expect(out).toContain("b += 20;");
    });

    it("emits method with AssignExpr body as statement in TypeScript", () => {
      const src = `
class Counter:
  count: int = 0
  fn reset() = (this.count = 0)
`;
      const mod = parse(src, "counter.ts.aice");
      const out = emitTarget(mod, "typescript");
      expect(out).toContain("this.count = 0;");
      expect(out).not.toContain("return this.count = 0;");
    });
  });

  describe("Python Emitter (py-emitter.ts)", () => {
    it("emits 'in' binary operator cleanly", () => {
      const src = `
fn hasProperty(key: str, obj: any) -> bool:
  ret key in obj
`;
      const mod = parse(src, "hasProp.py.aice");
      const out = emitTarget(mod, "python");
      expect(out).toContain("return (key in obj)");
    });

    it("emits 'instanceof' lowered to Python isinstance()", () => {
      const src = `
fn isError(err: any) -> bool:
  ret err instanceof Error
`;
      const mod = parse(src, "isError.py.aice");
      const out = emitTarget(mod, "python");
      expect(out).toContain("return isinstance(err, Error)");
    });

    it("emits AssignExpr in Python using walrus := for simple assignment and parenthesized compound", () => {
      const src = `
fn testExprs():
  let mut f = (item) => (item.count += 1)
  let mut g = (mask) => (flags |= mask)
  let mut h = (x) => (x = 42)
`;
      const mod = parse(src, "assignExpr.py.aice");
      const out = emitTarget(mod, "python");
      expect(out).toContain("(item.count += 1)");
      expect(out).toContain("(flags |= mask)");
      expect(out).toContain("(x := 42)");
    });

    it("emits walrus := in while condition for AssignExpr", () => {
      const src = `
fn matchAll(regex: any, s: str):
  while ((pMatch = regex.exec(s)) != nil):
    print(pMatch)
`;
      const mod = parse(src, "whileCond.py.aice");
      const out = emitTarget(mod, "python");
      expect(out).toContain("while ((pMatch := regex.exec(s)) != None):");
    });

    it("emits compound assignment operators and lowers >>>= in AssignStmt", () => {
      const src = `
fn runAssignments():
  let mut x = 10
  x += 1
  x -= 2
  x *= 3
  x /= 4
  x %= 5
  x |= 6
  x ^= 7
  x &= 8
  x <<= 1
  x >>= 2
  x >>>= 3
  x **= 4
`;
      const mod = parse(src, "compound.py.aice");
      const out = emitTarget(mod, "python");
      expect(out).toContain("x += 1");
      expect(out).toContain("x -= 2");
      expect(out).toContain("x *= 3");
      expect(out).toContain("x /= 4");
      expect(out).toContain("x %= 5");
      expect(out).toContain("x |= 6");
      expect(out).toContain("x ^= 7");
      expect(out).toContain("x &= 8");
      expect(out).toContain("x <<= 1");
      expect(out).toContain("x >>= 2");
      expect(out).toContain("x = ((x % 0x100000000) >> 3)");
      expect(out).toContain("x **= 4");
    });

    it("emits method with AssignExpr body as statement in Python", () => {
      const src = `
class Counter:
  count: int = 0
  fn reset() = (this.count = 0)
`;
      const mod = parse(src, "counter.py.aice");
      const out = emitTarget(mod, "python");
      expect(out).toContain("self.count = 0");
      expect(out).not.toContain("return self.count = 0");
    });
  });

  describe("Rust Emitter (rust-emitter.ts)", () => {
    it("emits 'in' as contains(&...) and 'instanceof' as is::<...>()", () => {
      const src = `
fn check(k: str, coll: any, err: any) -> bool:
  if k in coll:
    ret true
  ret err instanceof Error
`;
      const mod = parse(src, "check.rs.aice");
      const emitter = new RustEmitter();
      const out = emitter.emit(mod);
      expect(out).toContain("coll.contains(&k)");
      expect(out).toContain("/* instanceof */ (err.is::<Error>())");
    });

    it("emits AssignExpr parenthesized", () => {
      const src = `
fn testExpr():
  let mut f = (x) => (x += 1)
`;
      const mod = parse(src, "test.rs.aice");
      const emitter = new RustEmitter();
      const out = emitter.emit(mod);
      expect(out).toContain("(x += 1)");
    });

    it("emits compound assignments and lowers **= and >>>=", () => {
      const src = `
fn run():
  let mut x = 10
  x += 1
  x *= 2
  x **= 3
  x >>>= 4
`;
      const mod = parse(src, "run.rs.aice");
      const emitter = new RustEmitter();
      const out = emitter.emit(mod);
      expect(out).toContain("x += 1;");
      expect(out).toContain("x *= 2;");
      expect(out).toContain("x = x.pow(3);");
      expect(out).toContain("x = ((x as u64) >> 4) as _;");
    });
  });

  describe("Go Emitter (go-emitter.ts)", () => {
    it("emits 'in' as contains() and 'instanceof' as type assertion lambda", () => {
      const src = `
fn check(k: str, coll: any, err: any) -> bool:
  if k in coll:
    ret true
  ret err instanceof Error
`;
      const mod = parse(src, "check.go.aice");
      const emitter = new GoEmitter();
      const out = emitter.emit(mod);
      expect(out).toContain("contains(coll, k)");
      expect(out).toContain("func() bool { _, ok := any(err).(Error); return ok }()");
    });

    it("emits AssignExpr parenthesized", () => {
      const src = `
fn testExpr():
  let mut f = (x) => (x += 1)
`;
      const mod = parse(src, "test.go.aice");
      const emitter = new GoEmitter();
      const out = emitter.emit(mod);
      expect(out).toContain("(x += 1)");
    });

    it("emits compound assignments and lowers **= and >>>=", () => {
      const src = `
fn run():
  let mut x = 10
  x += 1
  x *= 2
  x **= 3
  x >>>= 4
`;
      const mod = parse(src, "run.go.aice");
      const emitter = new GoEmitter();
      const out = emitter.emit(mod);
      expect(out).toContain("x += 1");
      expect(out).toContain("x *= 2");
      expect(out).toContain("x = math.Pow(x, 3)");
      expect(out).toContain("x = x >> 4");
    });
  });

  describe("C++ Emitter (cpp-emitter.ts)", () => {
    it("emits 'in' as .contains() and 'instanceof' as dynamic_cast", () => {
      const src = `
fn check(k: str, coll: any, err: any) -> bool:
  if k in coll:
    ret true
  ret err instanceof Error
`;
      const mod = parse(src, "check.cpp.aice");
      const emitter = new CppEmitter();
      const out = emitter.emit(mod);
      expect(out).toContain("(coll.contains(k))");
      expect(out).toContain("(dynamic_cast<const Error*>(&err) != nullptr)");
    });

    it("emits AssignExpr parenthesized", () => {
      const src = `
fn testExpr():
  let mut x = 10
  let mut y = (x += 1)
`;
      const mod = parse(src, "test.cpp.aice");
      const emitter = new CppEmitter();
      const out = emitter.emit(mod);
      expect(out).toContain("(x += 1)");
    });

    it("emits compound assignments and lowers **= and >>>=", () => {
      const src = `
fn run():
  let mut x = 10
  x += 1
  x *= 2
  x **= 3
  x >>>= 4
`;
      const mod = parse(src, "run.cpp.aice");
      const emitter = new CppEmitter();
      const out = emitter.emit(mod);
      expect(out).toContain("x += 1;");
      expect(out).toContain("x *= 2;");
      expect(out).toContain("x = std::pow(x, 3);");
      expect(out).toContain("x = (static_cast<uint64_t>(x) >> 4);");
    });
  });

  describe("C# Emitter (csharp-emitter.ts)", () => {
    it("emits 'in' as .Contains() and 'instanceof' as 'is'", () => {
      const src = `
fn check(k: str, coll: any, err: any) -> bool:
  if k in coll:
    ret true
  ret err instanceof Error
`;
      const mod = parse(src, "check.cs.aice");
      const emitter = new CSharpEmitter();
      const out = emitter.emit(mod);
      expect(out).toContain("(coll.Contains(k))");
      expect(out).toContain("(err is Error)");
    });

    it("emits AssignExpr parenthesized", () => {
      const src = `
fn testExpr():
  let mut x = 10
  let mut y = (x += 1)
`;
      const mod = parse(src, "test.cs.aice");
      const emitter = new CSharpEmitter();
      const out = emitter.emit(mod);
      expect(out).toContain("(x += 1)");
    });

    it("emits compound assignments and lowers **=", () => {
      const src = `
fn run():
  let mut x = 10
  x += 1
  x *= 2
  x **= 3
  x >>>= 4
`;
      const mod = parse(src, "run.cs.aice");
      const emitter = new CSharpEmitter();
      const out = emitter.emit(mod);
      expect(out).toContain("x += 1;");
      expect(out).toContain("x *= 2;");
      expect(out).toContain("x = Math.Pow(x, 3);");
      expect(out).toContain("x >>>= 4;");
    });
  });
});
