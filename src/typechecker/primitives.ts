/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AIL: Canonical Intent Primitive Registry (Pillars 1 & 3)
 * Eliminates API redundancy & implicit type coercion by defining orthogonal semantic operations.
 */

import type { SemanticType } from "./types.ts";

export interface PrimitiveSignature {
  name: string;
  domain: "string" | "array" | "map" | "math" | "logic" | "system";
  params: SemanticType[];
  returnType: SemanticType;
  description: string;
  isPure: boolean;
}

const T_INT: SemanticType = { kind: "Primitive", name: "!i" };
const T_FLOAT: SemanticType = { kind: "Primitive", name: "!f" };
const T_STRING: SemanticType = { kind: "Primitive", name: "!s" };
const T_BOOL: SemanticType = { kind: "Primitive", name: "!b" };
const _T_VOID: SemanticType = { kind: "Primitive", name: "!void" };
const T_UNKNOWN: SemanticType = { kind: "Primitive", name: "!unknown" };

export const CANONICAL_PRIMITIVES: Record<string, PrimitiveSignature> = {
  // --- String Canonical Operations (Pillar 1) ---
  "str:slice": {
    name: "str:slice",
    domain: "string",
    params: [T_STRING, T_INT, T_INT],
    returnType: T_STRING,
    description: "Extracts substring within strictly bounded range [from, to). Pure value return.",
    isPure: true,
  },
  "str:at": {
    name: "str:at",
    domain: "string",
    params: [T_STRING, T_INT],
    returnType: T_STRING,
    description: "Returns character at 0-based index. Supports negative indexing from end.",
    isPure: true,
  },
  "str:len": {
    name: "str:len",
    domain: "string",
    params: [T_STRING],
    returnType: T_INT,
    description: "Returns UTF-8 character length of string.",
    isPure: true,
  },
  "str:concat": {
    name: "str:concat",
    domain: "string",
    params: [T_STRING, T_STRING],
    returnType: T_STRING,
    description: "Concatenates two strings without implicit coercion.",
    isPure: true,
  },
  "str:parse-int": {
    name: "str:parse-int",
    domain: "string",
    params: [T_STRING],
    returnType: { kind: "Result", okType: T_INT, errType: T_STRING },
    description: "Parses integer from string. Returns fallible Result.",
    isPure: true,
  },

  // --- Collection Primitives (Pillar 3: Pure Immutability by Default) ---
  "arr:len": {
    name: "arr:len",
    domain: "array",
    params: [{ kind: "Array", elementType: T_UNKNOWN }],
    returnType: T_INT,
    description: "Returns length of array.",
    isPure: true,
  },
  "arr:get": {
    name: "arr:get",
    domain: "array",
    params: [{ kind: "Array", elementType: T_UNKNOWN }, T_INT],
    returnType: { kind: "Option", valueType: T_UNKNOWN },
    description: "Safely returns element at index wrapped in Option[T].",
    isPure: true,
  },
  "arr:slice": {
    name: "arr:slice",
    domain: "array",
    params: [{ kind: "Array", elementType: T_UNKNOWN }, T_INT, T_INT],
    returnType: { kind: "Array", elementType: T_UNKNOWN },
    description: "Returns pure immutable slice of array.",
    isPure: true,
  },
  "arr:append": {
    name: "arr:append",
    domain: "array",
    params: [{ kind: "Array", elementType: T_UNKNOWN }, T_UNKNOWN],
    returnType: { kind: "Array", elementType: T_UNKNOWN },
    description: "Returns new array with element appended (immutable pure transformation).",
    isPure: true,
  },

  // --- Strict Math Operations (Pillar 3: Zero Implicit Coercion) ---
  "+": {
    name: "+",
    domain: "math",
    params: [T_FLOAT, T_FLOAT], // Also handles T_INT via polymorphism
    returnType: T_FLOAT,
    description: "Strict arithmetic addition. Rejects string concatenation.",
    isPure: true,
  },
  "-": {
    name: "-",
    domain: "math",
    params: [T_FLOAT, T_FLOAT],
    returnType: T_FLOAT,
    description: "Strict arithmetic subtraction.",
    isPure: true,
  },
  "*": {
    name: "*",
    domain: "math",
    params: [T_FLOAT, T_FLOAT],
    returnType: T_FLOAT,
    description: "Strict arithmetic multiplication.",
    isPure: true,
  },
  "/": {
    name: "/",
    domain: "math",
    params: [T_FLOAT, T_FLOAT],
    returnType: T_FLOAT,
    description: "Strict arithmetic division.",
    isPure: true,
  },
  "%": {
    name: "%",
    domain: "math",
    params: [T_INT, T_INT],
    returnType: T_INT,
    description: "Modulo operation on integers.",
    isPure: true,
  },

  // --- Logical & Comparison Operations ---
  "==": {
    name: "==",
    domain: "logic",
    params: [T_UNKNOWN, T_UNKNOWN],
    returnType: T_BOOL,
    description: "Deep structural equality check.",
    isPure: true,
  },
  "!=": {
    name: "!=",
    domain: "logic",
    params: [T_UNKNOWN, T_UNKNOWN],
    returnType: T_BOOL,
    description: "Structural inequality check.",
    isPure: true,
  },
  "<": {
    name: "<",
    domain: "logic",
    params: [T_FLOAT, T_FLOAT],
    returnType: T_BOOL,
    description: "Less than comparison.",
    isPure: true,
  },
  ">": {
    name: ">",
    domain: "logic",
    params: [T_FLOAT, T_FLOAT],
    returnType: T_BOOL,
    description: "Greater than comparison.",
    isPure: true,
  },
  "<=": {
    name: "<=",
    domain: "logic",
    params: [T_FLOAT, T_FLOAT],
    returnType: T_BOOL,
    description: "Less than or equal comparison.",
    isPure: true,
  },
  ">=": {
    name: ">=",
    domain: "logic",
    params: [T_FLOAT, T_FLOAT],
    returnType: T_BOOL,
    description: "Greater than or equal comparison.",
    isPure: true,
  },
  and: {
    name: "and",
    domain: "logic",
    params: [T_BOOL, T_BOOL],
    returnType: T_BOOL,
    description: "Short-circuit boolean AND.",
    isPure: true,
  },
  or: {
    name: "or",
    domain: "logic",
    params: [T_BOOL, T_BOOL],
    returnType: T_BOOL,
    description: "Short-circuit boolean OR.",
    isPure: true,
  },
  not: {
    name: "not",
    domain: "logic",
    params: [T_BOOL],
    returnType: T_BOOL,
    description: "Boolean negation.",
    isPure: true,
  },
};
