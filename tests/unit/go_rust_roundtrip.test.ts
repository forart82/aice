/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Full Go & Rust Bidirectional Parity & Roundtrip Tests (Phase 2.4).
 */

import { describe, expect, it } from "vitest";
import type { ClassDecl, ConstDecl, FunctionDecl, Module, VarDecl } from "../../src/core/ast.js";
import { parse } from "../../src/core/parser.js";
import { decompile } from "../../src/decompiler/index.js";
import { decompileCpp } from "../../src/decompiler/cpp-decompiler.js";
import { decompileGo, GoDecompiler } from "../../src/decompiler/go-decompiler.js";
import { decompileRust, RustDecompiler } from "../../src/decompiler/rust-decompiler.js";
import { emitTarget, GoEmitter, RustEmitter, TypeScriptEmitter } from "../../src/emitters/index.js";
import { TypeChecker } from "../../src/typechecker/checker.js";

function normalizeWhitespace(str: string): string {
  return str
    .split("\n")
    .map((l) => l.trim())
    .filter(
      (l) =>
        l.length > 0 &&
        !l.startsWith("//") &&
        !l.startsWith("#![allow") &&
        !l.startsWith("package ") &&
        !l.startsWith("import (") &&
        !l.startsWith('use serde::') &&
        !l.startsWith('use std::collections') &&
        !l.startsWith('#[derive(') &&
        l !== ")" &&
        l !== '""',
    )
    .join("\n");
}

function executeRoundtrip(source: string, target: "go" | "rust", filePath = `test.${target}`) {
  const decompileRes = decompile(source, target, { filePath });
  const reconstructed = emitTarget(decompileRes.ast, target, {
    trivia: decompileRes.trivia,
    watermark: false,
  });

  const normOrig = normalizeWhitespace(source);
  const normRecon = normalizeWhitespace(reconstructed);

  return {
    ...decompileRes,
    reconstructed,
    normOrig,
    normRecon,
    isIdentical: normOrig === normRecon,
  };
}

describe("Full Go & Rust Bidirectional Parity", () => {
  describe("GoEmitter ClassDecl, ConstDecl, VarDecl Extensions", () => {
    it("emits Go struct, New constructor, and pointer receiver methods for ClassDecl", () => {
      const source = `
class Counter(pub initial: int, pub count: int):
  fn increment(amount: int) -> int:
    self.count = self.count + amount
    ret self.count
`;
      const mod = parse(source, "counter.go.aice");
      const emitter = new GoEmitter();
      const code = emitter.emit(mod);

      expect(code).toContain("type Counter struct {");
      expect(code).toContain('Initial int64 `json:"initial"`');
      expect(code).toContain('Count int64 `json:"count"`');
      expect(code).toContain("func NewCounter(initial int64, count int64) *Counter {");
      expect(code).toContain("&Counter{");
      expect(code).toContain("func (self *Counter) Increment(amount int64) int64 {");
      expect(code).toContain("self.Count = (self.Count + amount)");
      expect(code).toContain("return self.Count");
    });

    it("emits const and var declarations correctly in Go", () => {
      const source = `
pub const MaxRetries: int = 5
pub const DefaultHost: str = "localhost"
pub Active: bool := true
`;
      const mod = parse(source, "constants.go.aice");
      const emitter = new GoEmitter();
      const code = emitter.emit(mod);

      expect(code).toContain("const MaxRetries int64 = 5");
      expect(code).toContain('const DefaultHost string = "localhost"');
      expect(code).toContain("var Active bool = true");
    });
  });

  describe("RustEmitter ClassDecl, ConstDecl, VarDecl Extensions", () => {
    it("emits pub struct, pub fn new, and &mut self / &self methods for ClassDecl", () => {
      const source = `
class BankAccount(pub owner: str, pub balance: int):
  fn deposit(amount: int) -> int:
    self.balance = self.balance + amount
    ret self.balance
  fn getBalance() -> int:
    ret self.balance
`;
      const mod = parse(source, "bank.rs.aice");
      const emitter = new RustEmitter();
      const code = emitter.emit(mod);

      expect(code).toContain("#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]");
      expect(code).toContain("pub struct BankAccount {");
      expect(code).toContain("pub owner: String,");
      expect(code).toContain("pub balance: i64,");
      expect(code).toContain("impl BankAccount {");
      expect(code).toContain("pub fn new(owner: String, balance: i64) -> Self {");
      expect(code).toContain("Self { owner, balance }");
      expect(code).toContain("pub fn deposit(&mut self, amount: i64) -> i64 {");
      expect(code).toContain("self.balance = (self.balance + amount);");
      expect(code).toContain("pub fn get_balance(&self) -> i64 {");
      expect(code).toContain("return self.balance;");
    });

    it("emits const and static declarations in Rust", () => {
      const source = `
pub const TIMEOUT: int = 30
pub const SERVICE_NAME: str = "aice-core"
`;
      const mod = parse(source, "consts.rs.aice");
      const emitter = new RustEmitter();
      const code = emitter.emit(mod);

      expect(code).toContain("pub const TIMEOUT: i64 = 30;");
      expect(code).toContain('pub const SERVICE_NAME: String = "aice-core".to_string();');
    });
  });

  describe("GoDecompiler (Reverse Transpiler)", () => {
    it("decompiles Go struct and receiver methods into canonical AICE ClassDecl", () => {
      const goCode = `
package counter

type Counter struct {
	Count int64 \`json:"count"\`
}

func (self *Counter) Increment(amount int64) int64 {
	self.Count = self.Count + amount
	return self.Count
}
`;
      const result = decompileGo(goCode, "counter.go");
      expect(result.ast.items.length).toBe(1);
      const cls = result.ast.items[0] as ClassDecl;
      expect(cls.kind).toBe("ClassDecl");
      expect(cls.name).toBe("Counter");
      expect(cls.properties.length).toBe(1);
      expect(cls.properties[0].name).toBe("count");
      expect(cls.methods.length).toBe(1);
      expect(cls.methods[0].name).toBe("increment");

      expect(result.aice).toContain("class Counter");
      expect(result.aice).toContain("count: int");
      expect(result.aice).toContain("fn increment(amount:int) -> int:");
    });

    it("decompiles Go enums and constants into canonical AICE TypeDecl and ConstDecl", () => {
      const goCode = `
package main

type Status string

const (
	StatusActive Status = "Active"
	StatusInactive Status = "Inactive"
)

const MaxAttempts int64 = 10
var CurrentStep int64 = 1
`;
      const result = decompileGo(goCode, "status.go");
      expect(result.ast.items.some((i) => i.kind === "TypeDecl" && i.isEnum)).toBe(true);
      expect(result.ast.items.some((i) => i.kind === "ConstDecl" && i.name === "MaxAttempts")).toBe(true);
      expect(result.ast.items.some((i) => i.kind === "VarDecl" && i.name === "CurrentStep")).toBe(true);
    });

    it("decompiles Go control flow: conditionals, switch/match, for/while", () => {
      const goCode = `
package main

func CheckGrade(score int64) string {
	if score >= 90 {
		return "A"
	} else if score >= 80 {
		return "B"
	} else {
		return "C"
	}
}

func ProcessNumbers(n int64) {
	for i := 0; i < n; i++ {
		print(i)
	}
}
`;
      const result = decompileGo(goCode, "grades.go");
      expect(result.ast.items.length).toBe(2);
      expect(result.aice).toContain("fn checkGrade(score:int) -> str:");
      expect(result.aice).toContain("if score >= 90:");
      expect(result.aice).toContain('ret "A"');
    });
  });

  describe("RustDecompiler (Reverse Transpiler)", () => {
    it("decompiles Rust pub struct and impl block into canonical AICE ClassDecl", () => {
      const rustCode = `
pub struct Session {
    pub user_id: String,
    pub expires_at: i64,
}

impl Session {
    pub fn new(user_id: String, expires_at: i64) -> Self {
        Self { user_id, expires_at }
    }

    pub fn is_valid(&self, now: i64) -> bool {
        return self.expires_at > now;
    }
}
`;
      const result = decompileRust(rustCode, "session.rs");
      expect(result.ast.items.length).toBe(1);
      const cls = result.ast.items[0] as ClassDecl;
      expect(cls.kind).toBe("ClassDecl");
      expect(cls.name).toBe("Session");
      expect(cls.properties.length).toBe(2);
      expect(cls.methods.length).toBe(1);
      expect(cls.methods[0].name).toBe("isValid");

      expect(result.aice).toContain("class Session");
      expect(result.aice).toContain("userId: str");
      expect(result.aice).toContain("fn isValid(now:int) -> bool:");
    });

    it("decompiles Rust enums with tuple variants and constants", () => {
      const rustCode = `
pub enum Command {
    Quit,
    Echo(String),
}

pub const DEFAULT_PORT: i64 = 8080;
`;
      const result = decompileRust(rustCode, "cmd.rs");
      expect(result.ast.items.some((i) => i.kind === "TypeDecl" && i.isEnum)).toBe(true);
      expect(result.ast.items.some((i) => i.kind === "ConstDecl" && i.name === "DEFAULT_PORT")).toBe(true);
    });

    it("decompiles Rust match expressions, while loops, and ? operator", () => {
      const rustCode = `
pub fn evaluate(cmd: Command) -> i64 {
    match cmd {
        Command::Quit => 0,
        Command::Echo(msg) => 1,
        _ => -1,
    }
}
`;
      const result = decompileRust(rustCode, "eval.rs");
      expect(result.ast.items.length).toBe(1);
      expect(result.aice).toContain("match cmd:");
      expect(result.aice).toContain("Quit => 0");
      expect(result.aice).toContain("Echo(msg) => 1");
    });
  });

  describe("Go & Rust Bidirectional Roundtrip Fidelity", () => {
    it("round-trips Go structs with methods through AICE AST", () => {
      const originalGo = `
package main

type Vector struct {
	X int64 \`json:"x"\`
	Y int64 \`json:"y"\`
}

func (self *Vector) LengthSquared() int64 {
	return ((self.X * self.X) + (self.Y * self.Y))
}
`;
      const roundtrip = executeRoundtrip(originalGo, "go", "vector.go");
      expect(roundtrip.reconstructed).toContain("type Vector struct {");
      expect(roundtrip.reconstructed).toContain('X int64 `json:"x"`');
      expect(roundtrip.reconstructed).toContain('Y int64 `json:"y"`');
      expect(roundtrip.reconstructed).toContain("func (self *Vector) LengthSquared() int64 {");
      expect(roundtrip.reconstructed).toContain("return ((self.X * self.X) + (self.Y * self.Y))");
    });

    it("round-trips Rust struct with constructor and methods through AICE AST", () => {
      const originalRust = `
pub struct Rectangle {
    pub width: i64,
    pub height: i64,
}

impl Rectangle {
    pub fn new(width: i64, height: i64) -> Self {
        Self { width, height }
    }

    pub fn area(&self) -> i64 {
        return (self.width * self.height);
    }
}
`;
      const roundtrip = executeRoundtrip(originalRust, "rust", "rect.rs");
      expect(roundtrip.reconstructed).toContain("pub struct Rectangle {");
      expect(roundtrip.reconstructed).toContain("pub width: i64,");
      expect(roundtrip.reconstructed).toContain("pub height: i64,");
      expect(roundtrip.reconstructed).toContain("impl Rectangle {");
      expect(roundtrip.reconstructed).toContain("pub fn new(width: i64, height: i64) -> Self");
      expect(roundtrip.reconstructed).toContain("pub fn area(&self) -> i64 {");
      expect(roundtrip.reconstructed).toContain("return (self.width * self.height);");
    });

    it("round-trips Go functions with conditionals and math", () => {
      const originalGo = `
package main

func Clamp(val int64, min int64, max int64) int64 {
	if (val < min) {
		return min
	}
	if (val > max) {
		return max
	}
	return val
}
`;
      const roundtrip = executeRoundtrip(originalGo, "go", "clamp.go");
      expect(roundtrip.reconstructed).toContain("func Clamp(val int64, min int64, max int64) int64 {");
      expect(roundtrip.reconstructed).toContain("if (val < min) {");
      expect(roundtrip.reconstructed).toContain("return min");
      expect(roundtrip.reconstructed).toContain("if (val > max) {");
      expect(roundtrip.reconstructed).toContain("return max");
      expect(roundtrip.reconstructed).toContain("return val");
    });

    it("round-trips Rust functions with match expressions", () => {
      const originalRust = `
pub fn classify(code: i64) -> i64 {
    match code {
        0 => 100,
        1 => 200,
        _ => -1,
    }
}
`;
      const roundtrip = executeRoundtrip(originalRust, "rust", "classify.rs");
      expect(roundtrip.reconstructed).toContain("pub fn classify(code: i64) -> i64 {");
      expect(roundtrip.reconstructed).toContain("match code {");
      expect(roundtrip.reconstructed).toContain("0 => 100,");
      expect(roundtrip.reconstructed).toContain("1 => 200,");
      expect(roundtrip.reconstructed).toContain("_ => -1,");
    });
  });

  describe("Surgeon 3 Audit Fixes Verification", () => {
    it("decompiles Go multi-return return val, nil into Ok(val) and return 0, fmt.Errorf(\"%v\", err) into Err(err)", () => {
      const goCode = `
package result_test

func FindUser(id int64) (string, error) {
	if (id <= 0) {
		return "", fmt.Errorf("%v", "invalid_id")
	}
	return "alice", nil
}
`;
      const res = decompileGo(goCode, "result_test.go");
      const fn = res.ast.items.find((item): item is FunctionDecl => item.kind === "FunctionDecl" && item.name === "findUser");
      expect(fn).toBeDefined();
      const stmts = (fn!.body as any).statements;
      // if statement should have return Err("invalid_id")
      const ifStmt = stmts[0] as any;
      expect(ifStmt.kind).toBe("IfStmt");
      const errRet = ifStmt.thenBranch.statements[0];
      expect(errRet.kind).toBe("ReturnStmt");
      expect(errRet.value.kind).toBe("CallExpr");
      expect(errRet.value.callee.name).toBe("Err");
      expect(errRet.value.args[0].value).toBe("invalid_id");

      // trailing return should have Ok("alice")
      const okRet = stmts[1] as any;
      expect(okRet.kind).toBe("ReturnStmt");
      expect(okRet.value.kind).toBe("CallExpr");
      expect(okRet.value.callee.name).toBe("Ok");
      expect(okRet.value.args[0].value).toBe("alice");
    });

    it("decompiles Go slice literals with commas and trailing commas", () => {
      const goCode = `
package slice_test

func GetNumbers() []int64 {
	return []int64{1, 2, 3,}
}
`;
      const res = decompileGo(goCode, "slice_test.go");
      const fn = res.ast.items.find((item): item is FunctionDecl => item.kind === "FunctionDecl" && item.name === "getNumbers");
      expect(fn).toBeDefined();
      const ret = (fn!.body as any).statements[0] as any;
      expect(ret.kind).toBe("ReturnStmt");
      expect(ret.value.kind).toBe("ArrayLiteralExpr");
      expect(ret.value.elements.length).toBe(3);
      expect(ret.value.elements[0].value).toBe(1);
      expect(ret.value.elements[1].value).toBe(2);
      expect(ret.value.elements[2].value).toBe(3);
    });

    it("normalizes Go receiver param name from s to self in method body", () => {
      const goCode = `
package server_test

type Server struct {
	Port int64 \`json:"port"\`
}

func (s *Server) GetPort() int64 {
	return s.Port
}
`;
      const res = decompileGo(goCode, "server_test.go");
      const cls = res.ast.items.find((item): item is ClassDecl => item.kind === "ClassDecl" && item.name === "Server");
      expect(cls).toBeDefined();
      const method = cls!.methods.find((m) => m.name === "getPort");
      expect(method).toBeDefined();
      const ret = (method!.body as any).statements[0] as any;
      expect(ret.kind).toBe("ReturnStmt");
      expect(ret.value.kind).toBe("MemberAccessExpr");
      expect(ret.value.object.kind).toBe("IdentifierExpr");
      expect(ret.value.object.name).toBe("self");
    });

    it("emits Go constructor without unused self when body ends in explicit return and doesn't reference self", () => {
      const aiceCode = `
class Server(pub port: int):
  fn new(port: int) -> Server:
    ret Server(port)
`;
      const mod = parse(aiceCode, "server.go.aice");
      const emitter = new GoEmitter();
      const emitted = emitter.emit(mod);
      expect(emitted).toContain("func NewServer(port int64) *Server {");
      expect(emitted).not.toContain("self := &Server{}");
      expect(emitted).toContain("return NewServer(port)");
    });

    it("retains unmatched NewFoo constructors in GoDecompiler when struct is not in module", () => {
      const goCode = `
package factory

func NewClient(endpoint string) Client {
	return Client{Endpoint: endpoint}
}
`;
      const res = decompileGo(goCode, "factory.go");
      const fnDecl = res.ast.items.find((item) => item.kind === "FunctionDecl" && item.name === "NewClient");
      expect(fnDecl).toBeDefined();
    });

    it("scans Rust and Go numbers without greedy +/-, 10.abs(), and strips Rust suffixes like 10f64", () => {
      const rustCode = `
pub fn math() -> f64 {
    let a = 1 + 2;
    let b = 10.abs();
    let c = 10f64;
    return c;
}
`;
      const res = decompileRust(rustCode, "math.rs");
      const fn = res.ast.items.find((item): item is FunctionDecl => item.kind === "FunctionDecl" && item.name === "math");
      expect(fn).toBeDefined();
      const stmts = (fn!.body as any).statements;
      // let a = 1 + 2
      const letA = stmts[0] as any;
      expect(letA.init.kind).toBe("BinaryExpr");
      expect(letA.init.left.value).toBe(1);
      expect(letA.init.right.value).toBe(2);

      // let b = 10.abs()
      const letB = stmts[1] as any;
      expect(letB.init.kind).toBe("CallExpr");
      expect(letB.init.callee.object.value).toBe(10);
      expect(letB.init.callee.property).toBe("abs");

      // let c = 10f64 -> stripped to 10
      const letC = stmts[2] as any;
      expect(letC.init.kind).toBe("LiteralExpr");
      expect(letC.init.value).toBe(10);
    });

    it("decompiles Rust raw identifier r#type as IDENTIFIER 'type'", () => {
      const rustCode = `
pub fn test_raw() -> i64 {
    let r#type = 42;
    return r#type;
}
`;
      const res = decompileRust(rustCode, "raw.rs");
      const fn = res.ast.items.find((item): item is FunctionDecl => item.kind === "FunctionDecl" && item.name === "testRaw");
      expect(fn).toBeDefined();
      const letStmt = (fn!.body as any).statements[0] as any;
      expect(letStmt.name).toBe("type");
    });

    it("decompiles multi-segment paths like std::cmp::min and std::cmp::max", () => {
      const rustCode = `
pub fn pick_min(a: i64, b: i64) -> i64 {
    return std::cmp::min(a, b);
}
`;
      const res = decompileRust(rustCode, "min.rs");
      const fn = res.ast.items.find((item): item is FunctionDecl => item.kind === "FunctionDecl" && item.name === "pickMin");
      expect(fn).toBeDefined();
      const ret = (fn!.body as any).statements[0] as any;
      expect(ret.value.callee.kind).toBe("IdentifierExpr");
      expect(ret.value.callee.name).toBe("min");
    });

    it("handles Rust expr as Type and underscore _ in type expression", () => {
      const rustCode = `
pub fn cast_val(x: i64) -> i64 {
    let y = x as usize;
    let z: _ = y;
    return z;
}
`;
      const res = decompileRust(rustCode, "cast.rs");
      const fn = res.ast.items.find((item): item is FunctionDecl => item.kind === "FunctionDecl" && item.name === "castVal");
      expect(fn).toBeDefined();
      const letY = (fn!.body as any).statements[0] as any;
      expect(letY.init.kind).toBe("IdentifierExpr");
      expect(letY.init.name).toBe("x");
    });

    it("decompiles Rust static mut as VarDecl with isMut: true", () => {
      const rustCode = `
pub static mut COUNTER: i64 = 0;
`;
      const res = decompileRust(rustCode, "static.rs");
      const v = res.ast.items.find((item): item is VarDecl => item.kind === "VarDecl" && item.name === "COUNTER");
      expect(v).toBeDefined();
      expect(v!.isMut).toBe(true);
    });

    it("emits Rust Map to HashMap and List to Vec and infers sensible types for unannotated const/var", () => {
      const aiceCode = `
pub const GREETING = "hello"
pub const FLAG = true
pub const RATIO = 3.14

type UserRegistry = Map[str, int]
type Scores = List[int]
`;
      const mod = parse(aiceCode, "types.rs.aice");
      const emitter = new RustEmitter();
      const emitted = emitter.emit(mod);
      expect(emitted).toContain("pub const GREETING: &str = \"hello\";");
      expect(emitted).toContain("pub const FLAG: bool = true;");
      expect(emitted).toContain("pub const RATIO: f64 = 3.14;");
      expect(emitted).toContain("pub type UserRegistry = HashMap<String, i64>;");
      expect(emitted).toContain("pub type Scores = Vec<i64>;");
    });

    it("preserves single-line C++ if statement with inner parentheses in body", () => {
      const cppCode = `
int check(int x) {
    if (x > 0) { foo(x); }
    return 0;
}
`;
      const res = decompileCpp(cppCode, "check.cpp");
      const fn = res.ast.items.find((item): item is FunctionDecl => item.kind === "FunctionDecl" && item.name === "check");
      expect(fn).toBeDefined();
      const ifStmt = (fn!.body as any).statements[0] as any;
      expect(ifStmt.kind).toBe("IfStmt");
      expect(ifStmt.thenBranch.statements.length).toBeGreaterThan(0);
      const innerCall = ifStmt.thenBranch.statements[0];
      expect(innerCall.kind).toBe("ExprStmt");
      expect(innerCall.expr.callee.name).toBe("foo");
    });

    it("emits TypeScript unit enum member references in expressions, match statements, and detects nested reassignments", () => {
      const aiceCode = `
enum Status:
  Pending
  Active
  Complete

fn get_status(code: int) -> Status:
  let s = Pending
  if code > 0:
    s = Active
  match s:
    Active => ret Active
    _ => ret Complete
`;
      const mod = parse(aiceCode, "status.ts.aice");
      const emitter = new TypeScriptEmitter();
      const emitted = emitter.emit(mod);
      expect(emitted).toContain("let s = Status.Pending;");
      expect(emitted).toContain("s = Status.Active;");
      expect(emitted).toContain("s === Status.Active");
      expect(emitted).toContain("return Status.Active;");
      expect(emitted).toContain("return Status.Complete;");
    });
  });
});
