import { describe, expect, it } from "vitest";
import { parse } from "../../src/core/parser.js";
import { check, TypeCheckError } from "../../src/typechecker/checker.js";

function checkSource(source: string): void {
  const mod = parse(source, "test.ail");
  check(mod);
}

describe("AIL 2.0 Sound Type Calculus & Refinement Solver", () => {
  describe("Valid Programs", () => {
    it("passes typechecking for valid arithmetic, functions, and let bindings", () => {
      const src = `fn add(a:int, b:int) -> int:
  let sum = a + b
  ret sum`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("passes typechecking for immutable records and member access", () => {
      const src = `type User:
  id:str
  age:int

fn getAge(u:User) -> int:
  ret u.age`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("passes typechecking for expression-bodied functions", () => {
      const src = `fn square(x:int) -> int = x * x`;
      expect(() => checkSource(src)).not.toThrow();
    });
  });

  describe("Strict Boolean Conditionals (Pillar 4)", () => {
    it("rejects non-boolean numbers in if conditions (prevents truthiness bugs)", () => {
      const src = `fn test():
  if 42:
    ret 1`;
      expect(() => checkSource(src)).toThrowError(TypeCheckError);
      expect(() => checkSource(src)).toThrowError(
        /Condition in 'if' statement must evaluate strictly to 'bool'/,
      );
    });

    it("rejects non-boolean strings in if conditions", () => {
      const src = `fn test():
  if "yes":
    ret 1`;
      expect(() => checkSource(src)).toThrowError(TypeCheckError);
    });

    it("rejects non-boolean arrays in while conditions", () => {
      const src = `fn test(items:[int]):
  while items:
    ret 0`;
      expect(() => checkSource(src)).toThrowError(TypeCheckError);
    });

    it("accepts strict boolean expressions in if conditions", () => {
      const src = `fn test(score:int) -> str:
  if score >= 50:
    ret "Pass"
  else:
    ret "Fail"`;
      expect(() => checkSource(src)).not.toThrow();
    });
  });

  describe("Zero Implicit Coercion (Pillar 1 & 4)", () => {
    it("rejects string + number concatenation without explicit conversion", () => {
      const src = `fn test():
  let x = "count: " + 42`;
      expect(() => checkSource(src)).toThrowError(TypeCheckError);
      expect(() => checkSource(src)).toThrowError(
        /Operator '\+' cannot be applied to disparate types 'str' and 'int'/,
      );
    });

    it("rejects boolean arithmetic", () => {
      const src = `fn test():
  let x = true + 1`;
      expect(() => checkSource(src)).toThrowError(TypeCheckError);
    });

    it("catches division by literal zero at compile time", () => {
      const src = `fn test():
  let x = 100 / 0`;
      expect(() => checkSource(src)).toThrowError(TypeCheckError);
      expect(() => checkSource(src)).toThrowError(/Division by zero detected at compile time/);
    });
  });

  describe("Step 8: Complete Binary Operator Typechecking (** & | ^ << >> >>>)", () => {
    it("passes typechecking for valid bitwise and shift operations returning int", () => {
      const src = `fn testBitwise(a:int, b:int) -> int:
  let r1:int = a & b
  let r2:int = a | b
  let r3:int = a ^ b
  let r4:int = a << b
  let r5:int = a >> b
  let r6:int = a >>> b
  ret r1 + r2 + r3 + r4 + r5 + r6`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("passes typechecking for exponentiation operator (**)", () => {
      const srcInt = `fn testPowInt(a:int, b:int) -> int:
  ret a ** b`;
      expect(() => checkSource(srcInt)).not.toThrow();

      const srcFloat = `fn testPowFloat(a:float, b:int) -> float:
  ret a ** b`;
      expect(() => checkSource(srcFloat)).not.toThrow();
    });

    it("rejects bitwise operations on non-numeric operands", () => {
      const ops = ["&", "|", "^", "<<", ">>", ">>>"];
      for (const op of ops) {
        const src = `fn test():
  let x = "str" ${op} 42`;
        expect(() => checkSource(src)).toThrowError(TypeCheckError);
        expect(() => checkSource(src)).toThrowError(/requires numeric operands/);
      }
    });

    it("rejects power operation on non-numeric operands", () => {
      const src = `fn test():
  let x = true ** 2`;
      expect(() => checkSource(src)).toThrowError(TypeCheckError);
      expect(() => checkSource(src)).toThrowError(/requires numeric operands/);
    });
  });

  describe("Canonical Standard Library (CSL) Primitives", () => {
    it("typechecks canonical string methods (slice, len, toInt, startsWith)", () => {
      const src = `fn test(raw:str) -> int:
  let length = raw.len
  let part = raw.slice(0, 5)
  let isHello = raw.startsWith("hello")
  ret length`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("typechecks canonical array operations (len, get, isEmpty, append)", () => {
      const src = `fn test(xs:[int]) -> [int]:
  let count = xs.len
  let empty = xs.isEmpty()
  let added = xs.append(99)
  ret added`;
      expect(() => checkSource(src)).not.toThrow();
    });
  });

  describe("Postfix ? Try Unwrap Operator", () => {
    it("allows ? unwrap on Result when enclosing function returns compatible Result", () => {
      const src = `from "./api" import fetchUser

fn loadProfile(id:str) -> Result[str, str]:
  let user = fetchUser(id)?
  ret Ok(user)`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("rejects ? unwrap on Result inside a function that returns void or non-Result", () => {
      const src = `from "./api" import fetchUser

fn load(id:str) -> int:
  let user = fetchUser(id)?
  ret 0`;
      expect(() => checkSource(src)).toThrowError(TypeCheckError);
      expect(() => checkSource(src)).toThrowError(
        /Cannot use '\?' unwrap on Result\[T, E\] inside a function that returns 'int'/,
      );
    });

    it("unwraps Option[T] to T", () => {
      const src = `fn test(opt:int?):
  let item = opt?
  ret`;
      expect(() => checkSource(src)).not.toThrow();
    });
  });

  describe("Variable Mutability & Scoping", () => {
    it("rejects reassigning to immutable let bindings", () => {
      const src = `fn test():
  let x = 1
  x = 2`;
      expect(() => checkSource(src)).toThrowError(TypeCheckError);
      expect(() => checkSource(src)).toThrowError(/Cannot assign to immutable variable 'x'/);
    });

    it("permits reassigning to mutable let mut bindings", () => {
      const src = `fn test() -> int:
  let mut x = 1
  x = 2
  ret x`;
      expect(() => checkSource(src)).not.toThrow();
    });
  });

  describe("Refinement Types & Bounds Checking", () => {
    it("validates literal bounds for refinement types at compile time", () => {
      const src = `type Port = { p:int | p >= 1 and p <= 65535 }

fn test():
  let valid:Port = 8080`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("rejects values violating refinement constraints at compile time", () => {
      const src = `type Port = { p:int | p >= 1 and p <= 65535 }

fn test():
  let invalid:Port = 70000`;
      expect(() => checkSource(src)).toThrowError(TypeCheckError);
      expect(() => checkSource(src)).toThrowError(
        /Value 70000 violates refinement constraint: must be <= 65535/,
      );
    });
  });

  describe("Return Type Safety", () => {
    it("rejects return value incompatible with declared function return type", () => {
      const src = `fn getName() -> str:
  ret 42`;
      expect(() => checkSource(src)).toThrowError(TypeCheckError);
      expect(() => checkSource(src)).toThrowError(
        /Return expression of type 'int' does not match function return type 'str'/,
      );
    });
  });

  describe("Step 7: Positional Record / Struct Constructors", () => {
    it("typechecks positional struct constructors with correct arity and types", () => {
      const src = `type Money:
  amountInCents: int
  currencyCode: str

fn makeMoney(amt: int, cur: str) -> Money:
  ret Money(amt, cur)`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("rejects positional constructor when arity is wrong", () => {
      const src = `type Money:
  amountInCents: int
  currencyCode: str

fn makeMoney(amt: int) -> Money:
  ret Money(amt)`;
      expect(() => checkSource(src)).toThrowError(TypeCheckError);
      expect(() => checkSource(src)).toThrowError(
        /Function expects between 2 and 2 arguments, got 1/,
      );
    });

    it("rejects positional constructor when argument type is wrong", () => {
      const src = `type Money:
  amountInCents: int
  currencyCode: str

fn makeMoney() -> Money:
  ret Money("one hundred", "USD")`;
      expect(() => checkSource(src)).toThrowError(TypeCheckError);
      expect(() => checkSource(src)).toThrowError(
        /Argument 1 of type 'str' is not assignable to expected type 'int'/,
      );
    });
  });

  describe("Step 8: Universal Single-Expression Function Bodies", () => {
    it("infers return type correctly for single-expression functions", () => {
      const src = `fn double(x: int) = x * 2

fn test():
  let y: int = double(10)`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("rejects mismatched type when using inferred return type", () => {
      const src = `fn double(x: int) = x * 2

fn test():
  let y: str = double(10)`;
      expect(() => checkSource(src)).toThrowError(TypeCheckError);
      expect(() => checkSource(src)).toThrowError(
        /Cannot assign value of type 'int' to variable 'y' of type 'str'/,
      );
    });

    it("typechecks closures with inferred return types", () => {
      const src = `fn getMultiplier() = fn(x: int) = x * 3`;
      expect(() => checkSource(src)).not.toThrow();
    });
  });

  describe("Step 10: Automatic Block-Body Trailing Return Inference", () => {
    it("infers return type from trailing block expression when omitted", () => {
      const src = `fn add(a: int, b: int):
  let c = a + b
  c

fn test():
  let result: int = add(5, 10)`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("validates trailing block expression matches declared return type", () => {
      const src = `fn add(a: int, b: int) -> int:
  let c = a + b
  c`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("rejects when trailing block expression does not match declared return type", () => {
      const src = `fn add(a: int, b: int) -> str:
  let c = a + b
  c`;
      expect(() => checkSource(src)).toThrowError(TypeCheckError);
      expect(() => checkSource(src)).toThrowError(
        /Trailing expression evaluates to 'int', but function 'add' declares return type 'str'/,
      );
    });

    it("validates conditional branches with trailing expressions", () => {
      const src = `fn abs(x: int) -> int:
  if x < 0:
    -x
  else:
    x`;
      expect(() => checkSource(src)).not.toThrow();
    });
  });

  describe("Step 2: Tuple Types & Assignability", () => {
    it("passes typechecking for valid tuple assignments and initialization", () => {
      const src = `fn test():
  let pair: [str, int] = ["Alice", 42]
  let coord: [float, float] = [1.5, 2.5]
  let nested: [int, [str, bool]] = [1, ["ok", true]]`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("accepts pairwise subtyping in tuples (e.g. int assignable to num)", () => {
      const src = `fn test():
  let t1: [int, str] = [10, "data"]
  let t2: [num, str] = t1`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("rejects tuple assignment with mismatched element types", () => {
      const src = `fn test():
  let pair: [str, int] = [42, "Alice"]`;
      expect(() => checkSource(src)).toThrowError(TypeCheckError);
      expect(() => checkSource(src)).toThrowError(
        /Cannot assign value of type '\[int, str\]' to variable 'pair' of type '\[str, int\]'/,
      );
    });

    it("rejects tuple assignment with mismatched tuple lengths", () => {
      const src = `fn test():
  let pair: [int, int] = [1, 2, 3]`;
      expect(() => checkSource(src)).toThrowError(TypeCheckError);
      expect(() => checkSource(src)).toThrowError(
        /Cannot assign value of type '.*' to variable 'pair' of type '\[int, int\]'/,
      );
    });

    it("typechecks tuple index access with exact element types", () => {
      const src = `fn getInfo(p: [str, int]) -> str:
  let name: str = p[0]
  let age: int = p[1]
  ret name`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("rejects out-of-bounds tuple indexing", () => {
      const src = `fn test(p: [str, int]):
  let val = p[2]`;
      expect(() => checkSource(src)).toThrowError(TypeCheckError);
      expect(() => checkSource(src)).toThrowError(
        /Tuple index 2 out of bounds for tuple type '\[str, int\]'/,
      );
    });

    it("rejects non-integer tuple indexing", () => {
      const src = `fn test(p: [str, int]):
  let val = p["0"]`;
      expect(() => checkSource(src)).toThrowError(TypeCheckError);
      expect(() => checkSource(src)).toThrowError(/Tuple index must be of type 'int'/);
    });

    it("typechecks function returning tuple and argument passing", () => {
      const src = `fn makePair(s: str, n: int) -> [str, int]:
  ret [s, n]

fn check():
  let p = makePair("hello", 100)
  let s: str = p[0]
  let n: int = p[1]`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("rejects returning mismatched tuple types from function", () => {
      const src = `fn makePair() -> [str, int]:
  ret [100, "hello"]`;
      expect(() => checkSource(src)).toThrowError(TypeCheckError);
      expect(() => checkSource(src)).toThrowError(
        /Return expression of type '\[int, str\]' does not match function return type '\[str, int\]'/,
      );
    });

    it("typechecks destructuring from a tuple", () => {
      const src = `fn test():
  let pair: [str, int] = ["test", 99]
  [a, b] := pair
  let s: str = a
  let n: int = b`;
      expect(() => checkSource(src)).not.toThrow();
    });
  });

  describe("Step 3: Call-Site Argument Spread Operator (...) & Dynamic Arity", () => {
    it("passes typechecking for function call with spread array", () => {
      const src = `fn sum(a: int, b: int) -> int:
  ret a + b

fn run(nums: [int]) -> int:
  ret sum(...nums)`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("passes typechecking for mixed positional and spread array arguments", () => {
      const src = `fn calculate(x: int, y: int, extra: int) -> int:
  ret x + y + extra

fn run(extra: [int]) -> int:
  ret calculate(10, 20, ...extra)`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("passes typechecking for function call with spread tuple", () => {
      const src = `fn add(a: int, b: int) -> int:
  ret a + b

fn run(pair: [int, int]) -> int:
  ret add(...pair)`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("passes typechecking for Math.max and intrinsic calls with spread array", () => {
      const src = `fn findMax(nums: [int]):
  let m = Math.max(...nums)`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("passes typechecking for array literal with spread elements", () => {
      const src = `fn merge(a: [int], b: [int]) -> [int]:
  let combined: [int] = [...a, ...b]
  ret combined`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("rejects spread arguments with mismatched element types", () => {
      const src = `fn add(a: int, b: int) -> int:
  ret a + b

fn run(words: [str]) -> int:
  ret add(...words)`;
      expect(() => checkSource(src)).toThrowError(TypeCheckError);
      expect(() => checkSource(src)).toThrowError(/not assignable to expected type 'int'/);
    });

    it("rejects spread tuple with incompatible element types", () => {
      const src = `fn add(a: int, b: int) -> int:
  ret a + b

fn run(pair: [int, str]) -> int:
  ret add(...pair)`;
      expect(() => checkSource(src)).toThrowError(TypeCheckError);
      expect(() => checkSource(src)).toThrowError(/not assignable to expected type 'int'/);
    });
  });

  describe("Step 4: Negative Numeric Literals in Type Unions", () => {
    it("passes typechecking for variables initialized with negative numeric literal unions", () => {
      const src = `val dir: 1 | -1 = -1
val dir2: 1 | -1 = 1
val state: -1 | 0 | 1 = 0`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("passes typechecking for type aliases with negative numeric literals", () => {
      const src = `type Direction = 1 | -1
val d: Direction = -1`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("passes typechecking for functions returning negative numeric literal union types", () => {
      const src = `fn getDirection() -> 1 | -1:
  ret -1

fn getPositive() -> 1 | -1:
  ret 1`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("passes typechecking for function parameters with negative numeric literal unions", () => {
      const src = `fn step(dir: 1 | -1) -> 1 | -1:
  ret dir

fn run():
  let a = step(-1)
  let b = step(1)`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("allows assigning negative numeric literal union values to numeric variables", () => {
      const src = `val dir: 1 | -1 = -1
val x: int = dir
val numVal: num = dir`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("rejects assigning non-numeric values to negative numeric literal union variables", () => {
      const src = `val dir: 1 | -1 = "invalid"`;
      expect(() => checkSource(src)).toThrowError(TypeCheckError);
      expect(() => checkSource(src)).toThrowError(
        /Cannot assign value of type 'str' to variable 'dir' of type '1 | -1'/,
      );
    });

    it("rejects incompatible return types for negative numeric literal unions", () => {
      const src = `fn getDir() -> 1 | -1:
  ret "north"`;
      expect(() => checkSource(src)).toThrowError(TypeCheckError);
      expect(() => checkSource(src)).toThrowError(
        /Function 'getDir' returns 'str', but declared '1 | -1'/,
      );
    });
  });

  describe("Step 5: Boolean Literal Types (: true, : false, true | false)", () => {
    it("passes typechecking for variables declared with boolean literal types", () => {
      const src = `val ok: true = true
val notOk: false = false`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("rejects assigning false to true and true to false", () => {
      const src1 = `val ok: true = false`;
      expect(() => checkSource(src1)).toThrowError(TypeCheckError);
      expect(() => checkSource(src1)).toThrowError(
        /Cannot assign value of type 'false' to variable 'ok' of type 'true'/,
      );

      const src2 = `val notOk: false = true`;
      expect(() => checkSource(src2)).toThrowError(TypeCheckError);
      expect(() => checkSource(src2)).toThrowError(
        /Cannot assign value of type 'true' to variable 'notOk' of type 'false'/,
      );
    });

    it("allows assigning boolean literal values to bool variables", () => {
      const src = `val ok: true = true
val b1: bool = ok
val notOk: false = false
val b2: bool = notOk
val b3: bool = true
val b4: bool = false`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("rejects assigning general bool variables to boolean literal variables", () => {
      const src = `val b: bool = true
val ok: true = b`;
      expect(() => checkSource(src)).toThrowError(TypeCheckError);
      expect(() => checkSource(src)).toThrowError(
        /Cannot assign value of type 'bool' to variable 'ok' of type 'true'/,
      );

      const srcLocal = `fn test(b: bool):
  let ok: true = b`;
      expect(() => checkSource(srcLocal)).toThrowError(TypeCheckError);
      expect(() => checkSource(srcLocal)).toThrowError(
        /Cannot assign value of type 'bool' to variable 'ok' of type 'true'/,
      );
    });

    it("passes typechecking for boolean union types (true | false)", () => {
      const src = `type Flag = true | false
val f1: Flag = true
val f2: Flag = false`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("allows bi-directional assignment between bool and true | false unions", () => {
      const src = `type Flag = true | false
val b: bool = true
val f: Flag = b
val b2: bool = f`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("rejects assigning non-boolean values to true | false unions", () => {
      const src1 = `val f: true | false = "invalid"`;
      expect(() => checkSource(src1)).toThrowError(TypeCheckError);
      expect(() => checkSource(src1)).toThrowError(
        /Cannot assign value of type 'str' to variable 'f' of type 'true \| false'/,
      );

      const src2 = `val f: true | false = 1`;
      expect(() => checkSource(src2)).toThrowError(TypeCheckError);
      expect(() => checkSource(src2)).toThrowError(
        /Cannot assign value of type 'int' to variable 'f' of type 'true \| false'/,
      );
    });

    it("rejects assigning true | false union to single boolean literal variable", () => {
      const src = `type Flag = true | false
val f: Flag = false
val ok: true = f`;
      expect(() => checkSource(src)).toThrowError(TypeCheckError);
      expect(() => checkSource(src)).toThrowError(
        /Cannot assign value of type 'true \| false' to variable 'ok' of type 'true'/,
      );

      const srcLocal = `type Flag = true | false
fn test(f: Flag):
  let ok: true = f`;
      expect(() => checkSource(srcLocal)).toThrowError(TypeCheckError);
      expect(() => checkSource(srcLocal)).toThrowError(
        /Cannot assign value of type 'true \| false' to variable 'ok' of type 'true'/,
      );
    });

    it("passes typechecking for functions returning and accepting boolean literal types", () => {
      const src = `fn isReady() -> true:
  ret true

fn isOff() -> false:
  ret false

fn toggle(f: true | false) -> true | false:
  ret f

fn checkStrict(ok: true) -> bool:
  ret ok

fn run():
  let r = isReady()
  let c = checkStrict(true)`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("rejects invalid return types for functions declared with boolean literal return types", () => {
      const src1 = `fn isReady() -> true:
  ret false`;
      expect(() => checkSource(src1)).toThrowError(TypeCheckError);
      expect(() => checkSource(src1)).toThrowError(
        /Return expression of type 'false' does not match function return type 'true'/,
      );

      const src2 = `fn isOff() -> false:
  ret true`;
      expect(() => checkSource(src2)).toThrowError(TypeCheckError);
      expect(() => checkSource(src2)).toThrowError(
        /Return expression of type 'true' does not match function return type 'false'/,
      );
    });

    it("passes typechecking for record types with boolean literal fields", () => {
      const src = `type Response = { success: true, code: int }
val res: Response = { success: true, code: 200 }`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("rejects invalid field values for record types with boolean literal fields", () => {
      const src = `type Response = { success: true, code: int }
val res: Response = { success: false, code: 200 }`;
      expect(() => checkSource(src)).toThrowError(TypeCheckError);
      expect(() => checkSource(src)).toThrowError(
        /Cannot assign value of type '{ success:false, code:int }' to variable 'res' of type '{ success:true, code:int }'/,
      );
    });
  });

  describe("Step 6: Contextual Keyword Identifiers in Typechecker", () => {
    it("typechecks functions and parameters named with contextual keywords", () => {
      const src = `fn style(tokens: int, match: bool, type: str, val: float) -> int:
  if match:
    ret tokens
  ret 0

fn test():
  let res = style(10, true, "main", 1.5)`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("typechecks struct types and record types with contextual keyword fields", () => {
      const src = `type Theme:
  style: str
  tokens: int
  match: bool

fn getTheme() -> Theme:
  ret { style: "dark", tokens: 100, match: true }

fn test():
  let t = getTheme()
  let s: str = t.style
  let tok: int = t.tokens
  let m: bool = t.match`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("typechecks variables named with contextual keywords", () => {
      const src = `fn test() -> int:
  let style: str = "bold"
  val tokens: int = 5
  const match: bool = false
  let state = "idle"
  let mut = 1
  ret tokens + mut`;
      expect(() => checkSource(src)).not.toThrow();
    });
  });

  describe("Step 7: Closure Parameter Pattern Destructuring & Elisions in Typechecker", () => {
    it("typechecks functions with destructured tuple parameters", () => {
      const src = `fn addPairs([a, b]: [int, int]) -> int:
  ret a + b

fn test() -> int:
  ret addPairs([10, 20])`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("typechecks functions with destructured record parameters", () => {
      const src = `type State:
  effect: str
  target: int

fn handle({ effect, target }: State) -> str:
  ret effect`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("typechecks closures with destructured tuple parameters", () => {
      const src = `fn test() -> int:
  let add = fn([a, b]: [int, int]) -> int = a + b
  ret add([1, 2])`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("typechecks unannotated closures with pattern destructuring", () => {
      const src = `fn test():
  let f = fn([a, b]) = a
  let g = fn({ effect }) = effect
  let h = fn(x) = x`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("typechecks for-in loops with destructuring elisions", () => {
      const src = `fn test(pairs: [[int, str]]):
  for [, s] in pairs:
    let x: str = s`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("typechecks let destructuring bindings with elisions", () => {
      const src = `fn test(pair: [int, str]):
  let [, s] = pair
  let x: str = s`;
      expect(() => checkSource(src)).not.toThrow();
    });
  });

  describe("Step 10: Lowering and Typechecking of await Expression", () => {
    it("unwraps Promise[int] to int on await", () => {
      const src = `fn resolve(p: Promise[int]) -> int:
  let val = await p
  ret val`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("verifies type mismatch if awaited Promise[int] is assigned to incompatible type", () => {
      const src = `fn resolve(p: Promise[int]) -> str:
  let val: str = await p
  ret val`;
      expect(() => checkSource(src)).toThrowError(TypeCheckError);
    });

    it("returns operand type directly when awaiting non-Promise", () => {
      const src = `fn compute(x: int) -> int:
  let val = await x
  ret val`;
      expect(() => checkSource(src)).not.toThrow();
    });
  });

  describe("Step 11: String Literal Unions vs Enums Assignability", () => {
    it("allows assigning string literals to variables with string literal union type", () => {
      const src = `type HttpMethod = "GET" | "POST" | "PUT" | "DELETE"
fn test():
  let a: HttpMethod = "GET"
  let b: HttpMethod = "POST"
  let c: HttpMethod = "PUT"
  let d: HttpMethod = "DELETE"`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("rejects assigning string literals outside the union", () => {
      const src = `type HttpMethod = "GET" | "POST"
fn test():
  let a: HttpMethod = "PATCH"`;
      expect(() => checkSource(src)).toThrowError(TypeCheckError);
    });

    it("allows assigning string literal union values to str (subtyping)", () => {
      const src = `type HttpMethod = "GET" | "POST"
fn test():
  let a: HttpMethod = "GET"
  let s: str = a`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("rejects assigning general str to string literal union (soundness)", () => {
      const src = `type HttpMethod = "GET" | "POST"
fn test(s: str):
  let m: HttpMethod = s`;
      expect(() => checkSource(src)).toThrowError(TypeCheckError);
    });

    it("verifies bidirectional subtype assignability between unions", () => {
      const validSrc = `type SmallMethod = "GET" | "POST"
type BigMethod = "GET" | "POST" | "DELETE"
fn test(s: SmallMethod):
  let assignedToBig: BigMethod = s`;
      expect(() => checkSource(validSrc)).not.toThrow();

      const invalidSrc = `type SmallMethod = "GET" | "POST"
type BigMethod = "GET" | "POST" | "DELETE"
fn test(b: BigMethod):
  let assignedToSmall: SmallMethod = b`;
      expect(() => checkSource(invalidSrc)).toThrowError(TypeCheckError);
    });

    it("verifies string literal union parameter and return type checking", () => {
      const validSrc = `type HttpMethod = "GET" | "POST"
fn handle(m: HttpMethod) -> HttpMethod:
  ret m
fn test():
  let res = handle("GET")`;
      expect(() => checkSource(validSrc)).not.toThrow();

      const invalidSrc = `type HttpMethod = "GET" | "POST"
fn handle(m: HttpMethod) -> HttpMethod:
  ret m
fn test():
  let res = handle("UNKNOWN")`;
      expect(() => checkSource(invalidSrc)).toThrowError(TypeCheckError);
    });

    it("supports bidirectional assignability between string-backed enums and string literal unions", () => {
      const validSrc = `enum HttpMethod: GET, POST
type MethodUnion = "GET" | "POST"
fn test():
  let e: HttpMethod = HttpMethod.GET
  let u: MethodUnion = e
  let s: str = e
  let fromStrLit: HttpMethod = "POST"`;
      expect(() => checkSource(validSrc)).not.toThrow();

      const invalidSrc = `enum HttpMethod: GET, POST
fn test():
  let badEnum: HttpMethod = "DELETE"`;
      expect(() => checkSource(invalidSrc)).toThrowError(TypeCheckError);
    });

    it("supports string operations like concatenation and equality on string literal types", () => {
      const src = `fn test():
  let prefix: "hello" = "hello"
  let full: str = prefix + " world"
  let isHello: bool = prefix == "hello"`;
      expect(() => checkSource(src)).not.toThrow();
    });
  });

  describe("Step 12: Multiline Block Closures Typechecking", () => {
    it("typechecks multiline block closure with local variable declarations and returns", () => {
      const src = `fn test() -> int:
  let f = fn(x: int) -> int {
    let y = x * 2
    ret y
  }
  ret f(10)`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("infers return type of unannotated multiline block closure from ret statement", () => {
      const src = `fn test() -> int:
  let f = fn(x: int) {
    let y = x * 2
    ret y
  }
  ret f(5)`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("typechecks multiline block closure capturing outer scope variables", () => {
      const src = `fn test(outer: int) -> int:
  let f = fn(x: int) -> int {
    let step = outer + 1
    ret x + step
  }
  ret f(5)`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("rejects multiline block closure when return type does not match declared return type", () => {
      const src = `fn test():
  let f = fn(x: int) -> str {
    let y = x + 1
    ret y
  }`;
      expect(() => checkSource(src)).toThrowError(TypeCheckError);
      try {
        checkSource(src);
        expect(true).toBe(false);
      } catch (err: any) {
        expect(err.code).toBe("AIL_E2007_RETURN_TYPE_MISMATCH");
      }
    });

    it("rejects unannotated multiline block closure with inconsistent return types across branches", () => {
      const src = `fn test(cond: bool):
  let f = fn(x: int) {
    if cond:
      ret "string_value"
    else:
      ret 42
  }`;
      expect(() => checkSource(src)).toThrowError(TypeCheckError);
      try {
        checkSource(src);
        expect(true).toBe(false);
      } catch (err: any) {
        expect(err.code).toBe("AIL_E2007_RETURN_TYPE_MISMATCH");
      }
    });

    it("typechecks void multiline block closure with local variables", () => {
      const src = `fn test():
  let f = fn(x: int) {
    let y = x + 1
  }
  f(10)`;
      expect(() => checkSource(src)).not.toThrow();
    });
  });

  describe("Step 13: Statement Visitors Typechecking (try/catch/finally, throw, break, continue, static blocks)", () => {
    it("typechecks try/catch with bound catch parameter", () => {
      const src = `fn test():
  try:
    let x = 1 + 2
  catch err:
    let msg = err
`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("typechecks try/finally without catch block", () => {
      const src = `fn test():
  try:
    let x = 10
  finally:
    let y = 20
`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("typechecks full try/catch/finally", () => {
      const src = `fn test() -> int:
  let mut res = 0
  try:
    res = 1
  catch e:
    res = -1
  finally:
    let cleanup = true
  ret res
`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("typechecks throw statement with expression", () => {
      const src = `fn fail(msg: str):
  throw msg
`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("typechecks break and continue inside loops", () => {
      const src = `fn loop():
  let mut i = 0
  while i < 10:
    if i == 5:
      break
    elif i == 2:
      continue
    i = i + 1
`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("typechecks class with static block", () => {
      const src = `class Config:
  pub static version: int = 1
  static:
    let initVal = 42
`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("rejects undeclared variables accessed inside catch block", () => {
      const src = `fn test():
  try:
    let a = 1
  catch err:
    let b = undefinedVar
`;
      expect(() => checkSource(src)).toThrowError(TypeCheckError);
    });
  });

  describe("Step 14: Async Function & Promise[T] Return Unwrapping", () => {
    it("allows async function returning T when return type is Promise[T] via ret statement", () => {
      const src = `async fn getData() -> Promise[str]:
  ret "ok"
`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("allows async function returning T when return type is Promise[T] via trailing expression", () => {
      const src = `async fn getData() -> Promise[str]:
  "ok"
`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("allows async function returning Promise[T] directly when return type is Promise[T]", () => {
      const src = `async fn getInner() -> Promise[str]:
  ret "inner"

async fn getData() -> Promise[str]:
  ret getInner()
`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("allows expression-bodied async function returning T for Promise[T]", () => {
      const src = `async fn getData() -> Promise[str] = "ok"`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("allows async methods in classes returning T with Promise[T] return type", () => {
      const src = `class DataService:
  async fetchData() -> Promise[int]:
    ret 42

  async fetchStr() -> Promise[str]:
    "hello"
`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("infers Promise[T] return type for unannotated async functions", () => {
      const src = `async fn compute():
  ret 100

async fn run():
  let res: Promise[int] = compute()
`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("infers Promise[T] for unannotated async functions with trailing expression", () => {
      const src = `async fn compute():
  100

async fn run():
  let res: Promise[int] = compute()
`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("rejects incompatible return types inside async functions", () => {
      const src = `async fn getData() -> Promise[str]:
  ret 123
`;
      expect(() => checkSource(src)).toThrowError(TypeCheckError);
    });

    it("rejects incompatible trailing expressions inside async functions", () => {
      const src = `async fn getData() -> Promise[str]:
  123
`;
      expect(() => checkSource(src)).toThrowError(TypeCheckError);
    });

    it("rejects incompatible return types inside async class methods", () => {
      const src = `class Service:
  async fetch() -> Promise[str]:
    ret true
`;
      expect(() => checkSource(src)).toThrowError(TypeCheckError);
    });
  });

  describe("Step 15: Class Accessor Field Map Overwrite Fix (getters vs setters)", () => {
    it("returns property type (int), NOT function (int) => void, when accessing obj.prop on class with both getter and setter", () => {
      const src = `class Counter:
  get val() -> int:
    ret 42
  set val(v: int):
    pass

fn test():
  let c = Counter()
  let x: int = c.val
`;
      expect(() => checkSource(src)).not.toThrow();

      // Accessing c.val should NOT be a function
      const srcFunc = `class Counter:
  get val() -> int:
    ret 42
  set val(v: int):
    pass

fn test():
  let c = Counter()
  let f: (int) -> void = c.val
`;
      expect(() => checkSource(srcFunc)).toThrowError(TypeCheckError);
    });

    it("preserves getter return type when setter is defined before getter", () => {
      const src = `class Gauge:
  set level(v: int):
    pass
  get level() -> int = 100

fn test():
  let g = Gauge()
  let x: int = g.level
`;
      expect(() => checkSource(src)).not.toThrow();

      const srcMismatch = `class Gauge:
  set level(v: int):
    pass
  get level() -> int = 100

fn test():
  let g = Gauge()
  let s: str = g.level
`;
      expect(() => checkSource(srcMismatch)).toThrowError(TypeCheckError);
    });

    it("succeeds when assigning matching type to setter-only property, and errors on type mismatch", () => {
      const srcValid = `class WriteBuffer:
  set data(d: int):
    pass

fn test():
  let wb = WriteBuffer()
  wb.data = 123
`;
      expect(() => checkSource(srcValid)).not.toThrow();

      const srcInvalid = `class WriteBuffer:
  set data(d: int):
    pass

fn test():
  let wb = WriteBuffer()
  wb.data = "invalid string"
`;
      expect(() => checkSource(srcInvalid)).toThrowError(TypeCheckError);
      expect(() => checkSource(srcInvalid)).toThrowError(
        /Cannot assign 'str' to property 'data' of type 'int'/,
      );
    });

    it("rejects assignment to getter-only property", () => {
      const src = `class ConstantHolder:
  get apiKey() -> str = "secret-key"

fn test():
  let h = ConstantHolder()
  h.apiKey = "new-key"
`;
      expect(() => checkSource(src)).toThrowError(TypeCheckError);
      expect(() => checkSource(src)).toThrowError(/Cannot assign to getter-only property 'apiKey'/);
    });

    it("rejects assignment to getter-only property within class methods via this", () => {
      const src = `class ReadOnlyView:
  get title() -> str = "Untitled"

  fn tryMutate():
    this.title = "New Title"
`;
      expect(() => checkSource(src)).toThrowError(TypeCheckError);
      expect(() => checkSource(src)).toThrowError(/Cannot assign to getter-only property 'title'/);
    });

    it("supports assigning to property with both getter and setter via this and externally", () => {
      const src = `class Temperature:
  _celsius: int = 0

  get celsius() -> int = this._celsius
  set celsius(c: int):
    this._celsius = c

  fn reset():
    this.celsius = 0

fn test():
  let t = Temperature()
  t.celsius = 25
  let current: int = t.celsius
`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("preserves inferred getter return types across both ordering combinations", () => {
      const srcGetterFirst = `class A:
  get item() = 42
  set item(v: int):
    pass

fn testA():
  let a = A()
  let x: int = a.item
`;
      expect(() => checkSource(srcGetterFirst)).not.toThrow();

      const srcSetterFirst = `class B:
  set item(v: int):
    pass
  get item() = 42

fn testB():
  let b = B()
  let x: int = b.item
`;
      expect(() => checkSource(srcSetterFirst)).not.toThrow();
    });
  });

  describe("Step 16: Class Scope Builtin Function Shadowing Guard", () => {
    it("allows class with floor: int property to call builtin floor(1.5) in a method", () => {
      const src = `class MathHelper:
  floor: int = 0
  fn compute(x: float) -> int:
    ret floor(x)

fn test():
  let m = MathHelper()
  let res: int = m.compute(1.5)
`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("allows class with min: int and max: int properties to call builtin min(a, b) and max(a, b)", () => {
      const src = `class RangeHelper:
  min: int = 0
  max: int = 100
  fn clampVal(a: num, b: num) -> num:
    let low: num = min(a, b)
    let high: num = max(a, b)
    ret high
`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("allows class with abs: float property to call builtin abs(-5.0)", () => {
      const src = `class Normalizer:
  abs: float = 1.0
  fn getMagnitude(v: num) -> num:
    ret abs(v)
`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("verifies property access this.floor still returns int", () => {
      const src = `class MathHelper:
  floor: int = 42
  fn getProp() -> int:
    let f: int = this.floor
    ret f
`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("allows class with print: str and len: int properties to call builtin print() and len()", () => {
      const src = `class Logger:
  print: str = "prefix"
  len: int = 10
  fn logData(msg: str, items: [int]):
    print(msg)
    let n: int = len(items)
`;
      expect(() => checkSource(src)).not.toThrow();
    });
  });

  describe("Step 17: Function Parameter Optionality & Arity Checks", () => {
    it("allows function with default params to be called with fewer arguments", () => {
      const src = `fn add(a: int, b: int = 10, c: int = 20) -> int:
  ret a + b + c

fn main():
  let r1: int = add(5)
  let r2: int = add(5, 15)
  let r3: int = add(5, 15, 25)
`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("allows function with '?' optional params to be called without optional arguments", () => {
      const src = `fn greet(name: str, prefix?: str) -> str:
  ret name

fn main():
  let g1: str = greet("Alice")
  let g2: str = greet("Bob", "Hello")
  let g3: str = greet("Charlie", nil)
`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("allows class constructor with default params called with 0 arguments Class()", () => {
      const src = `class Server(pub host: str = "localhost", pub port: int = 8080):
  pass

fn main():
  let s1 = Server()
  let s2 = Server("0.0.0.0")
  let s3 = Server("0.0.0.0", 3000)
`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("rejects calls with fewer than minParams arguments", () => {
      const src = `fn configure(id: int, host: str, port: int = 8080, secure?: bool):
  ret id

fn main():
  configure(1)
`;
      expect(() => checkSource(src)).toThrowError(TypeCheckError);
      expect(() => checkSource(src)).toThrowError(
        /Function expects between 2 and 4 arguments, got 1/,
      );
    });

    it("rejects calls with more than maxParams arguments", () => {
      const src = `fn calc(a: int, b: int = 5) -> int:
  ret a + b

fn main():
  calc(1, 2, 3)
`;
      expect(() => checkSource(src)).toThrowError(TypeCheckError);
      expect(() => checkSource(src)).toThrowError(
        /Function expects between 1 and 2 arguments, got 3/,
      );
    });

    it("allows option type parameters to be optional and accept nil", () => {
      const src = `fn search(query: str, tag: Option[str]):
  ret query

fn main():
  search("ail")
  search("ail", "compiler")
  search("ail", nil)
`;
      expect(() => checkSource(src)).not.toThrow();
    });
  });

  describe("Step 18: Missing Intrinsics, Array Methods & Built-in Types", () => {
    it("typechecks array reduce with accumulator and item closure", () => {
      const src = `fn main():
  let nums = [1, 2, 3]
  let sum = nums.reduce((acc, x) => acc + x, 0)
`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("typechecks array reduce without initial value and reduceRight", () => {
      const src = `fn main():
  let nums = [1, 2, 3]
  let r1 = nums.reduce((acc, x) => acc + x)
  let r2 = nums.reduceRight((acc, x) => acc + x, 0)
`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("typechecks array at() returning Option and sort()", () => {
      const src = `fn main():
  let nums = [1, 2, 3]
  let firstOpt = nums.at(0)
  let sorted = nums.sort()
`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("typechecks modern array methods (flat, flatMap, findLast, fill, toLocaleString)", () => {
      const src = `fn main():
  let nums = [1, 2, 3]
  let fl = nums.flat()
  let fm = nums.flatMap(fn(x: int) = [x, x])
  let last = nums.findLast(fn(x: int) = x > 1)
  let lastIdx = nums.findLastIndex(fn(x: int) = x > 1)
  let filled = nums.fill(0)
  let s: str = nums.toLocaleString()
  let s2: str = nums.toString()
`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("typechecks numeric toLocaleString(), toFixed(), toPrecision(), toExponential()", () => {
      const src = `fn main():
  let n: num = 42.5
  let s1: str = n.toLocaleString()
  let s2: str = n.toFixed(2)
  let s3: str = n.toPrecision(4)
  let s4: str = n.toExponential(2)
`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("typechecks int and float toLocaleString() and toFixed()", () => {
      const src = `fn main():
  let i: int = 100
  let f: float = 3.14159
  let s1: str = i.toLocaleString()
  let s2: str = f.toFixed(2)
`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("typechecks string padStart(), charCodeAt(), and modern string methods", () => {
      const src = `fn main():
  let text = "hello"
  let padded: str = text.padStart(5, "0")
  let code: int = text.charCodeAt(0)
  let ch: str = text.charAt(0)
  let idx: int = text.indexOf("l")
  let rep: str = text.repeat(3)
  let sub: str = text.substring(1, 3)
  let replaced: str = text.replaceAll("l", "w")
  let loc: str = text.toLocaleString()
`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("typechecks Math intrinsics, JSON, and console methods", () => {
      const src = `fn main():
  let f1: int = Math.floor(3.14)
  let f0: int = Math.floor()
  let r: float = Math.random()
  let jsonStr: str = JSON.stringify("data")
  let parsed = JSON.parse(jsonStr)
  console.log("value:", f1, r)
  console.error("error occurred")
  console.warn("warning")
`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("typechecks TextEncoder(), Uint8Array(), Date.now(), navigator, and Buffer.from()", () => {
      const src = `fn main():
  let enc = TextEncoder()
  let encoded = enc.encode("hello")
  let u8 = Uint8Array(10)
  let now: int = Date.now()
  let d = Date()
  let nav = navigator
  let buf = Buffer.from("test")
  let allocBuf = Buffer.alloc(16)
`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("resolves named and generic built-in types in type annotations without errors", () => {
      const src = `fn process(
  p: Promise[str],
  s: Set[int],
  m: Map[str, int],
  u: Uint8Array,
  b: Buffer,
  a: Array[float],
  d: Date,
  e: Error,
  r: RegExp
):
  ret nil
`;
      expect(() => checkSource(src)).not.toThrow();
    });
  });

  describe("Step 19: Flow-Sensitive Null/Option Narrowing", () => {
    it("narrows Option[T] to T inside if x != nil then-branch when accessing properties", () => {
      const src = `type User:
  name: str
  age: int

fn getName(x: User?) -> str:
  if x != nil:
    ret x.name
  ret "default"
`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("narrows Option[T] to T via truthiness check if x", () => {
      const src = `type User:
  name: str
  age: int

fn getAge(x: User?) -> int:
  if x:
    ret x.age
  ret 0
`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("narrows x to T for the rest of the function via early-exit guard clause if not x: ret nil", () => {
      const src = `type User:
  name: str
  age: int

fn getUpper(x: User?) -> str:
  if not x:
    ret ""
  ret x.name
`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("narrows x to T in else branch of if x == nil", () => {
      const src = `type User:
  name: str
  age: int

fn getAgeElse(x: User?) -> int:
  if x == nil:
    ret 0
  else:
    ret x.age
`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("narrows x to T inside while x != nil loop body", () => {
      const src = `type Node:
  value: int

fn getNodeVal(x: Node?) -> int:
  while x != nil:
    ret x.value
  ret 0
`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("narrows compound conditions with and (x != nil and y != nil) and nested conditionals", () => {
      const src = `type User:
  name: str
  age: int

fn combineUsers(x: User?, y: User?) -> str:
  if x != nil and y != nil:
    ret x.name + y.name
  ret "none"

fn nestedUsers(x: User?, y: User?) -> str:
  if x != nil:
    if y != nil:
      ret x.name + y.name
  ret "none"
`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("narrows guard clause with x == nil early exit", () => {
      const src = `type User:
  name: str
  age: int

fn checkNullExit(x: User?) -> str:
  if x == nil:
    ret "empty"
  ret x.name
`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("narrows guard clause with throw exit", () => {
      const src = `type User:
  name: str
  age: int

fn checkThrowExit(x: User?) -> str:
  if not x:
    throw Error("missing user")
  ret x.name
`;
      expect(() => checkSource(src)).not.toThrow();
    });
  });

  describe("Step 23: TemplateLiteralExpr Typechecking", () => {
    it("typechecks TemplateLiteralExpr returning str", () => {
      const src = `
fn greet(name: str, count: int) -> str:
  ret \`Hello \${name}, count: \${count}\`
`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("typechecks interpolated expressions for undeclared identifiers", () => {
      const src = `
fn greet(name: str) -> str:
  ret \`Hello \${unknownVar}\`
`;
      expect(() => checkSource(src)).toThrow(/Undeclared identifier 'unknownVar'/);
    });
  });
});
