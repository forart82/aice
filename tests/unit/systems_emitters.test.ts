/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for Native Systems Emitters (Rust 2021 & Go 1.22+) - Phase 2.4.
 */

import { describe, expect, it } from "vitest";
import { parse } from "../../src/core/parser.js";
import {
  detectTargetFromPath,
  emitTarget,
  GoEmitter,
  getTargetOutputPath,
  lowerConstructor,
  lowerMethodCall,
  lowerPropertyAccess,
  RustEmitter,
} from "../../src/emitters/index.js";
import { TypeChecker } from "../../src/typechecker/checker.js";

describe("Phase 2.4: Native Systems Emitters (Rust & Go)", () => {
  describe("Systems Target & Path Detection", () => {
    it("detects rust and go targets from file extensions", () => {
      expect(detectTargetFromPath("order_engine.rs.aice")).toBe("rust");
      expect(detectTargetFromPath("gateway.go.aice")).toBe("go");
      expect(detectTargetFromPath("src/backend/engine.rs")).toBe("rust");
      expect(detectTargetFromPath("src/backend/service.go")).toBe("go");
    });

    it("derives target output paths by stripping .aice", () => {
      expect(getTargetOutputPath("src/order_engine.rs.aice")).toBe("src/order_engine.rs");
      expect(getTargetOutputPath("services/gateway.go.aice")).toBe("services/gateway.go");
    });
  });

  describe("Canonical Standard Library (CSL) Rewriter for Rust & Go", () => {
    it("lowers property access (.len / .length) for Rust and Go", () => {
      expect(lowerPropertyAccess("items", "len", "rust").code).toBe("items.len()");
      expect(lowerPropertyAccess("items", "length", "rust").code).toBe("items.len()");
      expect(lowerPropertyAccess("items", "len", "go").code).toBe("len(items)");
      expect(lowerPropertyAccess("items", "length", "go").code).toBe("len(items)");
    });

    it("lowers string and collection methods for Rust", () => {
      expect(lowerMethodCall("str", "trim", [], "rust").code).toBe("str.trim().to_string()");
      expect(lowerMethodCall("str", "isEmpty", [], "rust").code).toBe("str.is_empty()");
      expect(lowerMethodCall("str", "contains", ['"foo"'], "rust").code).toBe(
        'str.contains("foo")',
      );
      expect(lowerMethodCall("str", "slice", ["0", "5"], "rust").code).toBe("str[0..5].to_vec()");
      expect(lowerMethodCall("res", "isOk", [], "rust").code).toBe("res.is_ok()");
      expect(lowerMethodCall("res", "isErr", [], "rust").code).toBe("res.is_err()");
    });

    it("lowers string and collection methods for Go", () => {
      expect(lowerMethodCall("str", "trim", [], "go").code).toBe("strings.TrimSpace(str)");
      expect(lowerMethodCall("str", "isEmpty", [], "go").code).toBe("len(str) == 0");
      expect(lowerMethodCall("str", "contains", ['"foo"'], "go").code).toBe(
        'strings.Contains(str, "foo")',
      );
      expect(lowerMethodCall("str", "startsWith", ['"prefix"'], "go").code).toBe(
        'strings.HasPrefix(str, "prefix")',
      );
      expect(lowerMethodCall("str", "slice", ["0", "5"], "go").code).toBe("str[0:5]");
      expect(lowerMethodCall("list", "append", ["item"], "go").code).toBe("append(list, item)");
    });

    it("lowers algebraic constructors for Rust and Go", () => {
      expect(lowerConstructor("Ok", ["42"], "rust").code).toBe("Ok(42)");
      expect(lowerConstructor("Err", ['"Bad"'], "rust").code).toBe('Err("Bad")');
      expect(lowerConstructor("Some", ["item"], "rust").code).toBe("Some(item)");
      expect(lowerConstructor("None", [], "rust").code).toBe("None");

      expect(lowerConstructor("Ok", ["42"], "go").code).toBe("42, nil");
      expect(lowerConstructor("Err", ['"Bad"'], "go").code).toBe('fmt.Errorf("%v", "Bad")');
      expect(lowerConstructor("None", [], "go").code).toBe("nil");
    });
  });

  describe("Rust 2021 Forward Transpiler (RustEmitter)", () => {
    it("emits idiomatic structs with derives, visibility, and constructor helper", () => {
      const source = `
type User:
  id: str
  age: int
  active: bool
`;
      const mod = parse(source, "user.rs.aice");
      const emitter = new RustEmitter();
      const code = emitter.emit(mod);

      expect(code).toContain("#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]");
      expect(code).toContain("pub struct User {");
      expect(code).toContain("pub id: String,");
      expect(code).toContain("pub age: i64,");
      expect(code).toContain("pub active: bool,");
      expect(code).toContain("impl User {");
      expect(code).toContain("pub fn new(id: String, age: i64, active: bool) -> Self");
    });

    it("emits enums with unit variants and payload variants", () => {
      const source = `
enum Action:
  Open
  Close(str)
`;
      const mod = parse(source, "action.rs.aice");
      const emitter = new RustEmitter();
      const code = emitter.emit(mod);

      expect(code).toContain("pub enum Action {");
      expect(code).toContain("Open,");
      expect(code).toContain("Close(String),");
    });

    it("emits typed functions, Result types, and postfix ? error unwrapping", () => {
      const source = `
fn parseValue(raw: str) -> Result[int, str]:
  ret Ok(42)

fn execute(raw: str) -> Result[int, str]:
  let parsed: int = parseValue(raw)?
  ret Ok(parsed)
`;
      const mod = parse(source, "calc.rs.aice");
      const tc = new TypeChecker();
      tc.checkModule(mod);

      const code = emitTarget(mod, "rust");
      expect(code).toContain("pub fn parse_value(raw: String) -> Result<i64, String> {");
      expect(code).toContain("return Ok(42);");
      expect(code).toContain("let parsed: i64 = parse_value(raw)?;");
    });

    it("emits match expressions correctly in Rust", () => {
      const source = `
enum State:
  Init
  Ready(str)

fn check(s: State) -> int:
  match s:
    Init => 0
    Ready(msg) => 1
    _ => -1
`;
      const mod = parse(source, "match.rs.aice");
      const code = emitTarget(mod, "rust");

      expect(code).toContain("match s {");
      expect(code).toContain("State::Init => 0,");
      expect(code).toContain("State::Ready(msg) => 1,");
      expect(code).toContain("_ => -1,");
    });
  });

  describe("Go 1.22+ Forward Transpiler (GoEmitter)", () => {
    it("emits clean package header, imports, and struct with json tags", () => {
      const source = `
type Route:
  path: str
  weight: int
  enabled: bool
`;
      const mod = parse(source, "route.go.aice");
      const emitter = new GoEmitter();
      const code = emitter.emit(mod);

      expect(code).toContain("package main");
      expect(code).toContain("type Route struct {");
      expect(code).toContain('Path string `json:"path"`');
      expect(code).toContain('Weight int64 `json:"weight"`');
      expect(code).toContain('Enabled bool `json:"enabled"`');
      expect(code).toContain("func NewRoute(path string, weight int64, enabled bool) Route {");
    });

    it("emits string enums and const block in Go", () => {
      const source = `
enum Priority:
  Low
  Medium
  High
`;
      const mod = parse(source, "priority.go.aice");
      const code = emitTarget(mod, "go");

      expect(code).toContain("type Priority string");
      expect(code).toContain("const (");
      expect(code).toContain('PriorityLow Priority = "Low"');
      expect(code).toContain('PriorityHigh Priority = "High"');
    });

    it("emits multiple return values (T, error) and error unwrapping in Go", () => {
      const source = `
fn lookup(key: str) -> Result[str, str]:
  if key.isEmpty():
    ret Err("empty key")
  ret Ok(key)

fn process(key: str) -> Result[str, str]:
  let found: str = lookup(key)?
  ret Ok(found)
`;
      const mod = parse(source, "proc.go.aice");
      const tc = new TypeChecker();
      tc.checkModule(mod);

      const code = emitTarget(mod, "go");
      expect(code).toContain('import (\n\t"fmt"\n)');
      expect(code).toContain("func Lookup(key string) (string, error) {");
      expect(code).toContain('return "", fmt.Errorf("%v", "empty key")');
      expect(code).toContain("return key, nil");
      expect(code).toContain("found, err := Lookup(key)");
      expect(code).toContain("if err != nil {");
      expect(code).toContain('return "", err');
    });

    it("emits switch statements in Go for match constructs", () => {
      const source = `
enum Mode:
  Dev
  Prod

fn getEnv(m: Mode) -> str:
  match m:
    Dev => "development"
    Prod => "production"
    _ => "unknown"
`;
      const mod = parse(source, "mode.go.aice");
      const code = emitTarget(mod, "go");

      expect(code).toContain("switch m {");
      expect(code).toContain("case ModeDev:");
      expect(code).toContain('return "development"');
      expect(code).toContain("case ModeProd:");
      expect(code).toContain('return "production"');
      expect(code).toContain("default:");
      expect(code).toContain('return "unknown"');
    });
  });
});
