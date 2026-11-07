import { describe, expect, it } from "vitest";
import { parse } from "../../src/core/parser.js";
import { check, TypeCheckError } from "../../src/typechecker/checker.js";

function checkSource(source: string): void {
  const mod = parse(source, "test.aice");
  check(mod);
}

describe("Step 0.5: Contextual Typing for String Literal Unions and Enums on Assignment", () => {
  describe("String Literal Unions", () => {
    it("allows variable declaration with matching string literal", () => {
      const src = `type FoodType = "NORMAL" | "GOLDEN"
fn test():
  let f: FoodType = "NORMAL"
  let g: FoodType = "GOLDEN"
`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("allows assignment with matching string literal", () => {
      const src = `type FoodType = "NORMAL" | "GOLDEN"
fn test():
  let mut f: FoodType = "NORMAL"
  f = "GOLDEN"
`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("rejects declaration with invalid string literal", () => {
      const src = `type FoodType = "NORMAL" | "GOLDEN"
fn test():
  let f: FoodType = "INVALID"
`;
      expect(() => checkSource(src)).toThrowError(TypeCheckError);
      expect(() => checkSource(src)).toThrowError(/Cannot assign/);
    });

    it("rejects reassignment with invalid string literal", () => {
      const src = `type FoodType = "NORMAL" | "GOLDEN"
fn test():
  let mut f: FoodType = "NORMAL"
  f = "POISON"
`;
      expect(() => checkSource(src)).toThrowError(TypeCheckError);
      expect(() => checkSource(src)).toThrowError(/Cannot assign/);
    });

    it("allows module-level val with string union literal", () => {
      const src = `type FoodType = "NORMAL" | "GOLDEN"
val DEFAULT_FOOD: FoodType = "NORMAL"
`;
      expect(() => checkSource(src)).not.toThrow();
    });
  });

  describe("String-backed Enums", () => {
    it("allows enum declaration with matching string literal", () => {
      const src = `enum Direction:
  UP
  DOWN
  LEFT
  RIGHT

fn test():
  let d: Direction = "UP"
`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("allows enum reassignment with matching string literal", () => {
      const src = `enum Direction:
  UP
  DOWN
  LEFT
  RIGHT

fn test():
  let mut d: Direction = "UP"
  d = "DOWN"
  d = "LEFT"
  d = "RIGHT"
`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("rejects enum assignment with non-variant string", () => {
      const src = `enum Direction:
  UP
  DOWN

fn test():
  let mut d: Direction = "UP"
  d = "FORWARD"
`;
      expect(() => checkSource(src)).toThrowError(TypeCheckError);
      expect(() => checkSource(src)).toThrowError(/Cannot assign/);
    });
  });

  describe("Option Types of String Literal Unions and Enums", () => {
    it("allows assigning string literal or nil to Option[FoodType]", () => {
      const src = `type FoodType = "NORMAL" | "GOLDEN"
fn test():
  let mut optF: Option[FoodType] = "NORMAL"
  optF = "GOLDEN"
  optF = nil
`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("rejects assigning invalid string literal to Option[FoodType]", () => {
      const src = `type FoodType = "NORMAL" | "GOLDEN"
fn test():
  let mut optF: Option[FoodType] = "NORMAL"
  optF = "INVALID"
`;
      expect(() => checkSource(src)).toThrowError(TypeCheckError);
    });

    it("allows assigning string literal or nil to Option[Direction]", () => {
      const src = `enum Direction:
  UP
  DOWN

fn test():
  let mut optD: Option[Direction] = "UP"
  optD = "DOWN"
  optD = nil
`;
      expect(() => checkSource(src)).not.toThrow();
    });
  });

  describe("Record Literals with Record[K, V]", () => {
    it("contextually types values in Record[Direction, Direction]", () => {
      const src = `enum Direction:
  UP
  DOWN
  LEFT
  RIGHT

fn test():
  val OPPOSITES: Record[Direction, Direction] = {
    UP: "DOWN",
    DOWN: "UP",
    LEFT: "RIGHT",
    RIGHT: "LEFT"
  }
`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("rejects invalid value in Record[Direction, Direction]", () => {
      const src = `enum Direction:
  UP
  DOWN
  LEFT
  RIGHT

fn test():
  val OPPOSITES: Record[Direction, Direction] = {
    UP: "INVALID_DIRECTION"
  }
`;
      expect(() => checkSource(src)).toThrowError(TypeCheckError);
    });
  });

  describe("Comparison Expressions with String Literals", () => {
    it("allows equality comparison between union variable and string literal", () => {
      const src = `type FoodType = "NORMAL" | "GOLDEN"
fn test(f: FoodType) -> bool:
  ret f == "NORMAL" or f == "GOLDEN"
`;
      expect(() => checkSource(src)).not.toThrow();
    });

    it("allows equality comparison between enum variable and string literal", () => {
      const src = `enum Status:
  ACTIVE
  INACTIVE

fn test(s: Status) -> bool:
  ret s == "ACTIVE" or s != "INACTIVE"
`;
      expect(() => checkSource(src)).not.toThrow();
    });
  });

  describe("Opaque Named Types", () => {
    it("allows string literal assignment to unknown/external opaque named type", () => {
      const src = `fn test():
  let x: ExternalFoodType = "GOLDEN"
`;
      expect(() => checkSource(src)).not.toThrow();
    });
  });
});
