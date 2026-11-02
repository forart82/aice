import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "../../src/core/parser.js";
import { check, TypeChecker, TypeCheckError } from "../../src/typechecker/checker.js";
import { generateCandidateRepair } from "../../src/typechecker/diagnostics.js";
import { createPosition, createSpan } from "../../src/core/span.js";

describe("Cross-File Module Symbol Resolution in TypeChecker", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ail-cross-file-test-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  describe("Requirement 1: Typed Function Imports", () => {
    it("passes typechecking for valid function call imported from ./tax", () => {
      const taxAil = `
pub fn calculateTax(amount: float, rate: float) -> float:
  return amount * rate
`;
      fs.writeFileSync(path.join(tempDir, "tax.ail"), taxAil, "utf-8");

      const checkoutSrc = `
from "./tax" import { calculateTax }

fn processOrder():
  let t: float = calculateTax(100.0, 0.2)
`;
      const checkoutFile = path.join(tempDir, "checkout.ail");
      fs.writeFileSync(checkoutFile, checkoutSrc, "utf-8");

      const mod = parse(checkoutSrc, checkoutFile);
      const tc = new TypeChecker();
      expect(() => tc.checkModule(mod)).not.toThrow();
    });

    it("rejects wrong argument types for imported functions with AIL_E2002_TYPE_MISMATCH", () => {
      const taxAil = `
pub fn calculateTax(amount: float, rate: float) -> float:
  return amount * rate
`;
      fs.writeFileSync(path.join(tempDir, "tax.ail"), taxAil, "utf-8");

      const checkoutSrc = `
from "./tax" import { calculateTax }

fn processOrder():
  calculateTax("wrong", 0.2)
`;
      const checkoutFile = path.join(tempDir, "checkout.ail");
      fs.writeFileSync(checkoutFile, checkoutSrc, "utf-8");

      const mod = parse(checkoutSrc, checkoutFile);
      const tc = new TypeChecker();
      expect(() => tc.checkModule(mod)).toThrowError(TypeCheckError);
      try {
        tc.checkModule(mod);
      } catch (e: any) {
        expect(e).toBeInstanceOf(TypeCheckError);
        expect(e.code).toBe("AIL_E2002_TYPE_MISMATCH");
      }
    });

    it("rejects wrong argument counts for imported functions with AIL_E2013_ARGUMENT_COUNT_MISMATCH", () => {
      const taxAil = `
pub fn calculateTax(amount: float, rate: float) -> float:
  return amount * rate
`;
      fs.writeFileSync(path.join(tempDir, "tax.ail"), taxAil, "utf-8");

      const checkoutSrc = `
from "./tax" import { calculateTax }

fn processOrder():
  calculateTax(100.0)
`;
      const checkoutFile = path.join(tempDir, "checkout.ail");
      fs.writeFileSync(checkoutFile, checkoutSrc, "utf-8");

      const mod = parse(checkoutSrc, checkoutFile);
      const tc = new TypeChecker();
      expect(() => tc.checkModule(mod)).toThrowError(TypeCheckError);
      try {
        tc.checkModule(mod);
      } catch (e: any) {
        expect(e).toBeInstanceOf(TypeCheckError);
        expect(e.code).toBe("AIL_E2013_ARGUMENT_COUNT_MISMATCH");
      }
    });

    it("propagates return types and rejects incompatible assignments with AIL_E2002_TYPE_MISMATCH", () => {
      const taxAil = `
pub fn calculateTax(amount: float, rate: float) -> float:
  return amount * rate
`;
      fs.writeFileSync(path.join(tempDir, "tax.ail"), taxAil, "utf-8");

      const checkoutSrc = `
from "./tax" import { calculateTax }

fn processOrder():
  let label: str = calculateTax(100.0, 0.2)
`;
      const checkoutFile = path.join(tempDir, "checkout.ail");
      fs.writeFileSync(checkoutFile, checkoutSrc, "utf-8");

      const mod = parse(checkoutSrc, checkoutFile);
      const tc = new TypeChecker();
      expect(() => tc.checkModule(mod)).toThrowError(TypeCheckError);
      try {
        tc.checkModule(mod);
      } catch (e: any) {
        expect(e).toBeInstanceOf(TypeCheckError);
        expect(e.code).toBe("AIL_E2002_TYPE_MISMATCH");
      }
    });
  });

  describe("Requirement 2: Record and Class Imports", () => {
    it("imports type User and class OrderService across files with valid field and method access", () => {
      const modelsAil = `
type User:
  name: str
  age: int

class OrderService:
  prefix: str
  fn constructor(prefix: str):
    this.prefix = prefix
  fn getOrder(id: int) -> str:
    return this.prefix + str(id)
`;
      fs.writeFileSync(path.join(tempDir, "models.ts.ail"), modelsAil, "utf-8");

      const mainSrc = `
from "./models.ts" import { User, OrderService }

fn main():
  let u = User("Alice", 30)
  let n: str = u.name
  let a: int = u.age
  let svc = OrderService("ORD-")
  let pfx: str = svc.prefix
  let ord: str = svc.getOrder(101)
`;
      const mainFile = path.join(tempDir, "main.ail");
      fs.writeFileSync(mainFile, mainSrc, "utf-8");

      const mod = parse(mainSrc, mainFile);
      const tc = new TypeChecker();
      expect(() => tc.checkModule(mod)).not.toThrow();
    });

    it("verifies constructor argument typechecking for imported classes", () => {
      const modelsAil = `
class OrderService:
  prefix: str
  fn constructor(prefix: str):
    this.prefix = prefix
`;
      fs.writeFileSync(path.join(tempDir, "models.ail"), modelsAil, "utf-8");

      const mainSrc = `
from "./models" import { OrderService }

fn main():
  let svc = OrderService(12345)
`;
      const mainFile = path.join(tempDir, "main.ail");
      fs.writeFileSync(mainFile, mainSrc, "utf-8");

      const mod = parse(mainSrc, mainFile);
      const tc = new TypeChecker();
      expect(() => tc.checkModule(mod)).toThrowError(TypeCheckError);
      try {
        tc.checkModule(mod);
      } catch (e: any) {
        expect(e).toBeInstanceOf(TypeCheckError);
        expect(e.code).toBe("AIL_E2002_TYPE_MISMATCH");
      }
    });

    it("verifies constructor argument count checking for imported types", () => {
      const modelsAil = `
type User:
  name: str
  age: int
`;
      fs.writeFileSync(path.join(tempDir, "models.ail"), modelsAil, "utf-8");

      const mainSrc = `
from "./models" import { User }

fn main():
  let u = User("Alice")
`;
      const mainFile = path.join(tempDir, "main.ail");
      fs.writeFileSync(mainFile, mainSrc, "utf-8");

      const mod = parse(mainSrc, mainFile);
      const tc = new TypeChecker();
      expect(() => tc.checkModule(mod)).toThrowError(TypeCheckError);
      try {
        tc.checkModule(mod);
      } catch (e: any) {
        expect(e).toBeInstanceOf(TypeCheckError);
        expect(e.code).toBe("AIL_E2013_ARGUMENT_COUNT_MISMATCH");
      }
    });

    it("rejects invalid field access types on imported record instances", () => {
      const modelsAil = `
type User:
  name: str
  age: int
`;
      fs.writeFileSync(path.join(tempDir, "models.ail"), modelsAil, "utf-8");

      const mainSrc = `
from "./models" import { User }

fn main():
  let u = User("Alice", 30)
  let wrong: str = u.age
`;
      const mainFile = path.join(tempDir, "main.ail");
      fs.writeFileSync(mainFile, mainSrc, "utf-8");

      const mod = parse(mainSrc, mainFile);
      const tc = new TypeChecker();
      expect(() => tc.checkModule(mod)).toThrowError(TypeCheckError);
      try {
        tc.checkModule(mod);
      } catch (e: any) {
        expect(e).toBeInstanceOf(TypeCheckError);
        expect(e.code).toBe("AIL_E2002_TYPE_MISMATCH");
      }
    });

    it("rejects unknown property access on imported record instances", () => {
      const modelsAil = `
type User:
  name: str
  age: int
`;
      fs.writeFileSync(path.join(tempDir, "models.ail"), modelsAil, "utf-8");

      const mainSrc = `
from "./models" import { User }

fn main():
  let u = User("Alice", 30)
  let x = u.unknownProperty
`;
      const mainFile = path.join(tempDir, "main.ail");
      fs.writeFileSync(mainFile, mainSrc, "utf-8");

      const mod = parse(mainSrc, mainFile);
      const tc = new TypeChecker();
      expect(() => tc.checkModule(mod)).toThrowError(TypeCheckError);
      try {
        tc.checkModule(mod);
      } catch (e: any) {
        expect(e).toBeInstanceOf(TypeCheckError);
        expect(e.code).toBe("AIL_E2011_UNKNOWN_PROPERTY");
      }
    });

    it("verifies method argument typechecking on imported class instances", () => {
      const modelsAil = `
class OrderService:
  prefix: str
  fn constructor(prefix: str):
    this.prefix = prefix
  fn getOrder(id: int) -> str:
    return this.prefix + str(id)
`;
      fs.writeFileSync(path.join(tempDir, "models.ail"), modelsAil, "utf-8");

      const mainSrc = `
from "./models" import { OrderService }

fn main():
  let svc = OrderService("ORD-")
  let code = svc.getOrder("not-an-int")
`;
      const mainFile = path.join(tempDir, "main.ail");
      fs.writeFileSync(mainFile, mainSrc, "utf-8");

      const mod = parse(mainSrc, mainFile);
      const tc = new TypeChecker();
      expect(() => tc.checkModule(mod)).toThrowError(TypeCheckError);
      try {
        tc.checkModule(mod);
      } catch (e: any) {
        expect(e).toBeInstanceOf(TypeCheckError);
        expect(e.code).toBe("AIL_E2002_TYPE_MISMATCH");
      }
    });
  });

  describe("Requirement 3: Aliased Imports and Cyclic Imports", () => {
    it("correctly binds aliased imports and keeps original name undeclared", () => {
      const mathAil = `
pub fn add(a: int, b: int) -> int:
  return a + b
`;
      fs.writeFileSync(path.join(tempDir, "math.ail"), mathAil, "utf-8");

      const validSrc = `
from "./math" import { add as sumValues }

fn calculate():
  let total: int = sumValues(10, 20)
`;
      const validFile = path.join(tempDir, "valid.ail");
      fs.writeFileSync(validFile, validSrc, "utf-8");

      const mod = parse(validSrc, validFile);
      const tc = new TypeChecker();
      expect(() => tc.checkModule(mod)).not.toThrow();

      // Original name should not be declared
      const invalidSrc = `
from "./math" import { add as sumValues }

fn calculate():
  add(10, 20)
`;
      const invalidFile = path.join(tempDir, "invalid.ail");
      fs.writeFileSync(invalidFile, invalidSrc, "utf-8");

      const invMod = parse(invalidSrc, invalidFile);
      expect(() => new TypeChecker().checkModule(invMod)).toThrowError(TypeCheckError);
      try {
        new TypeChecker().checkModule(invMod);
      } catch (e: any) {
        expect(e).toBeInstanceOf(TypeCheckError);
        expect(e.code).toBe("AIL_E2008_UNDECLARED_VARIABLE");
      }
    });

    it("terminates cleanly without infinite recursion for cyclic imports", () => {
      const aSrc = `
from "./b" import { bFn }

pub fn aFn() -> int:
  return 1
`;
      const bSrc = `
from "./a" import { aFn }

pub fn bFn() -> int:
  return 2
`;
      fs.writeFileSync(path.join(tempDir, "a.ail"), aSrc, "utf-8");
      fs.writeFileSync(path.join(tempDir, "b.ail"), bSrc, "utf-8");

      const aFile = path.join(tempDir, "a.ail");
      const mod = parse(aSrc, aFile);
      const tc = new TypeChecker();
      expect(() => tc.checkModule(mod)).not.toThrow();
    });
  });

  describe("Requirement 4: Non-Existent Imports Fallback", () => {
    it("falls back gracefully to TYPE_UNKNOWN for missing files without throwing", () => {
      const src = `
from "./nonexistent" import { anything, anotherThing }

fn test():
  anything(1, 2, "three")
  let x = anotherThing.foo.bar
`;
      const filePath = path.join(tempDir, "test.ail");
      fs.writeFileSync(filePath, src, "utf-8");

      const mod = parse(src, filePath);
      const tc = new TypeChecker();
      expect(() => tc.checkModule(mod)).not.toThrow();
    });

    it("falls back to TYPE_UNKNOWN for unexported symbols from an existing file", () => {
      const existingAil = `
pub fn existingFn() -> int:
  return 42
`;
      fs.writeFileSync(path.join(tempDir, "existing.ail"), existingAil, "utf-8");

      const src = `
from "./existing" import { missingSymbol }

fn test():
  missingSymbol("call", 123)
`;
      const filePath = path.join(tempDir, "test.ail");
      fs.writeFileSync(filePath, src, "utf-8");

      const mod = parse(src, filePath);
      const tc = new TypeChecker();
      expect(() => tc.checkModule(mod)).not.toThrow();
    });
  });

  describe("Requirement 5: Explicit baseDir option", () => {
    it("resolves imports when baseDir option is explicitly passed to checkModule", () => {
      const utilsDir = path.join(tempDir, "nested", "utils");
      fs.mkdirSync(utilsDir, { recursive: true });

      const mathAil = `
pub fn double(x: int) -> int:
  return x * 2
`;
      fs.writeFileSync(path.join(utilsDir, "math.ail"), mathAil, "utf-8");

      const src = `
from "./math" import { double }

fn run():
  let res: int = double(21)
`;
      // In-memory module without real file path
      const mod = parse(src, "<in-memory>");
      const tc = new TypeChecker();
      expect(() => tc.checkModule(mod, { baseDir: utilsDir })).not.toThrow();

      // Calling with invalid type should fail using baseDir resolution
      const badSrc = `
from "./math" import { double }

fn run():
  double("wrong")
`;
      const badMod = parse(badSrc, "<in-memory>");
      expect(() => new TypeChecker().checkModule(badMod, { baseDir: utilsDir })).toThrowError(TypeCheckError);
    });
  });

  describe("Requirement 6: Extension Probing and Transitive Resolution", () => {
    it("probes index.ail inside subdirectories", () => {
      const subDir = path.join(tempDir, "components");
      fs.mkdirSync(subDir, { recursive: true });

      const indexAil = `
pub fn renderButton(label: str) -> str:
  return "<btn>" + label + "</btn>"
`;
      fs.writeFileSync(path.join(subDir, "index.ail"), indexAil, "utf-8");

      const mainSrc = `
from "./components" import { renderButton }

fn run():
  let btn: str = renderButton("Submit")
`;
      const mainFile = path.join(tempDir, "app.ail");
      fs.writeFileSync(mainFile, mainSrc, "utf-8");

      const mod = parse(mainSrc, mainFile);
      const tc = new TypeChecker();
      expect(() => tc.checkModule(mod)).not.toThrow();
    });

    it("infers return type across files for unannotated functions", () => {
      const helperAil = `
pub fn multiply(a: int, b: int):
  return a * b
`;
      fs.writeFileSync(path.join(tempDir, "helpers.ail"), helperAil, "utf-8");

      const validSrc = `
from "./helpers" import { multiply }

fn run():
  let r: int = multiply(3, 4)
`;
      const validFile = path.join(tempDir, "valid.ail");
      fs.writeFileSync(validFile, validSrc, "utf-8");

      const mod = parse(validSrc, validFile);
      const tc = new TypeChecker();
      expect(() => tc.checkModule(mod)).not.toThrow();

      const invalidSrc = `
from "./helpers" import { multiply }

fn run():
  let wrong: str = multiply(3, 4)
`;
      const invalidFile = path.join(tempDir, "invalid.ail");
      fs.writeFileSync(invalidFile, invalidSrc, "utf-8");

      const invMod = parse(invalidSrc, invalidFile);
      expect(() => new TypeChecker().checkModule(invMod)).toThrowError(TypeCheckError);
    });

    it("resolves transitive cross-file imports (A -> B -> C)", () => {
      const coreAil = `
type Ident:
  val: int
`;
      fs.writeFileSync(path.join(tempDir, "core.ail"), coreAil, "utf-8");

      const repoAil = `
from "./core" import { Ident }

pub fn createIdent(v: int) -> Ident:
  return Ident(v)
`;
      fs.writeFileSync(path.join(tempDir, "repo.ail"), repoAil, "utf-8");

      const serviceAil = `
from "./repo" import { createIdent }

fn test():
  let id = createIdent(100)
  let v: int = id.val
`;
      const serviceFile = path.join(tempDir, "service.ail");
      fs.writeFileSync(serviceFile, serviceAil, "utf-8");

      const mod = parse(serviceAil, serviceFile);
      const tc = new TypeChecker();
      expect(() => tc.checkModule(mod)).not.toThrow();
    });

    it("infers float type for unannotated pub const TAX_RATE across files", () => {
      const taxAil = `
pub const TAX_RATE = 0.2
`;
      fs.writeFileSync(path.join(tempDir, "constants.ail"), taxAil, "utf-8");

      const mainSrc = `
from "./constants" import { TAX_RATE }

fn calculate(subtotal: float) -> float:
  let rate: float = TAX_RATE
  return subtotal * rate
`;
      const mainFile = path.join(tempDir, "calc.ail");
      fs.writeFileSync(mainFile, mainSrc, "utf-8");

      const mod = parse(mainSrc, mainFile);
      const tc = new TypeChecker();
      expect(() => tc.checkModule(mod)).not.toThrow();

      const badSrc = `
from "./constants" import { TAX_RATE }

fn bad():
  let rate: str = TAX_RATE
`;
      const badFile = path.join(tempDir, "bad.ail");
      fs.writeFileSync(badFile, badSrc, "utf-8");
      const badMod = parse(badSrc, badFile);
      expect(() => new TypeChecker().checkModule(badMod)).toThrowError(TypeCheckError);
    });

    it("supports wildcard imports (* as ns) and validates namespace member access", () => {
      const utilsAil = `
pub const VERSION = "2.0.0"
pub fn add(a: int, b: int) -> int:
  return a + b
`;
      fs.writeFileSync(path.join(tempDir, "utils.ail"), utilsAil, "utf-8");

      const mainSrc = `
from "./utils" import * as utils

fn run():
  let ver: str = utils.VERSION
  let sum: int = utils.add(10, 20)
`;
      const mainFile = path.join(tempDir, "app.ail");
      fs.writeFileSync(mainFile, mainSrc, "utf-8");

      const mod = parse(mainSrc, mainFile);
      const tc = new TypeChecker();
      expect(() => tc.checkModule(mod)).not.toThrow();

      const badSrc = `
from "./utils" import * as utils

fn run():
  utils.add("bad", 20)
`;
      const badFile = path.join(tempDir, "bad_app.ail");
      fs.writeFileSync(badFile, badSrc, "utf-8");
      const badMod = parse(badSrc, badFile);
      expect(() => new TypeChecker().checkModule(badMod)).toThrowError(TypeCheckError);
    });

    it("rejects passing nil to a non-optional int parameter with AIL_E2002_TYPE_MISMATCH", () => {
      const mathAil = `
pub fn increment(val: int) -> int:
  return val + 1
`;
      fs.writeFileSync(path.join(tempDir, "math_non_optional.ail"), mathAil, "utf-8");

      const mainSrc = `
from "./math_non_optional" import { increment }

fn run():
  increment(nil)
`;
      const mainFile = path.join(tempDir, "call_nil.ail");
      fs.writeFileSync(mainFile, mainSrc, "utf-8");

      const mod = parse(mainSrc, mainFile);
      const tc = new TypeChecker();
      expect(() => tc.checkModule(mod)).toThrowError(TypeCheckError);
      try {
        tc.checkModule(mod);
      } catch (e: any) {
        expect(e).toBeInstanceOf(TypeCheckError);
        expect(e.code).toBe("AIL_E2002_TYPE_MISMATCH");
      }
    });

    it("generates candidate repair for immutable assignment to $dollar variables", () => {
      const src = `fn run():
  let $count = 1
  $count = 2
  ret $count`;

      const span = createSpan("test.ail", createPosition(3, 3, 29), createPosition(3, 9, 35));
      const repair = generateCandidateRepair(
        "AIL_E2005_IMMUTABLE_ASSIGNMENT",
        "Cannot assign to immutable variable '$count'",
        span,
        src,
        "test.ail",
      );

      expect(repair).toBeDefined();
      expect(repair?.patch).toContain("-  let $count = 1");
      expect(repair?.patch).toContain("+  let mut $count = 1");
    });
  });
});
