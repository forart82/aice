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
});
