/**
 * Canonical Standard Library (CSL) primitive types and signature registry.
 * Conforms to Section 2 of docs/AIL_SPEC.md.
 */

import {
  makeArrayType,
  makeFunctionType,
  makeOptionType,
  makeResultType,
  TYPE_BOOL,
  TYPE_FLOAT,
  TYPE_INT,
  TYPE_NEVER,
  TYPE_NUM,
  TYPE_STR,
  TYPE_UNKNOWN,
  TYPE_VOID,
  type Type,
} from "./types.js";

/**
 * Returns the member property type (e.g. str.len -> int, list.len -> int).
 */
export function getPropertyType(receiver: Type, prop: string): Type | null {
  if (receiver.kind === "str") {
    if (prop === "len" || prop === "length") return TYPE_INT;
  }

  if (receiver.kind === "array") {
    if (prop === "len" || prop === "length") return TYPE_INT;
    const m = getMethodType(receiver, prop);
    if (m) return m;
  }

  if (receiver.kind === "record") {
    const direct = receiver.fields.get(prop);
    if (direct) return direct;
    const getter = receiver.fields.get(`get_${prop}`);
    if (getter && getter.kind === "function") {
      return getter.returnType;
    }
    return null;
  }

  if (
    receiver.kind === "named" ||
    receiver.kind === "unknown" ||
    receiver.kind === "function"
  ) {
    return TYPE_UNKNOWN;
  }

  return null;
}

/**
 * Returns the canonical method type for a receiver and method name.
 */
export function getMethodType(receiver: Type, method: string): Type | null {
  // String Canonical Methods
  if (receiver.kind === "str") {
    switch (method) {
      case "slice":
        return makeFunctionType(
          [
            { name: "start", type: TYPE_INT },
            { name: "end", type: TYPE_INT, optional: true },
          ],
          TYPE_STR,
        );
      case "at":
        return makeFunctionType([{ name: "index", type: TYPE_INT }], makeOptionType(TYPE_STR));
      case "concat":
        return makeFunctionType([{ name: "other", type: TYPE_STR }], TYPE_STR);
      case "toInt":
        return makeFunctionType([], makeResultType(TYPE_INT, TYPE_STR));
      case "trim":
        return makeFunctionType([], TYPE_STR);
      case "split":
        return makeFunctionType([{ name: "delim", type: TYPE_STR }], makeArrayType(TYPE_STR));
      case "startsWith":
        return makeFunctionType([{ name: "prefix", type: TYPE_STR }], TYPE_BOOL);
      case "endsWith":
        return makeFunctionType([{ name: "suffix", type: TYPE_STR }], TYPE_BOOL);
      case "includes":
      case "contains":
        return makeFunctionType([{ name: "substr", type: TYPE_STR }], TYPE_BOOL);
      case "isEmpty":
        return makeFunctionType([], TYPE_BOOL);
      case "toLowerCase":
      case "toUpperCase":
        return makeFunctionType([], TYPE_STR);
      case "replace":
        return makeFunctionType(
          [
            { name: "target", type: TYPE_STR },
            { name: "replacement", type: TYPE_STR },
          ],
          TYPE_STR,
        );
      default:
        return null;
    }
  }

  // Array / List Canonical Methods
  if (receiver.kind === "array") {
    const elemType = receiver.elementType;
    switch (method) {
      case "get":
        return makeFunctionType([{ name: "index", type: TYPE_INT }], makeOptionType(elemType));
      case "slice":
        return makeFunctionType(
          [
            { name: "start", type: TYPE_INT },
            { name: "end", type: TYPE_INT, optional: true },
          ],
          receiver,
        );
      case "append":
        return makeFunctionType([{ name: "item", type: elemType }], receiver);
      case "push":
        return makeFunctionType([{ name: "item", type: elemType }], TYPE_INT);
      case "pop":
        return makeFunctionType([], makeOptionType(elemType));
      case "shift":
        return makeFunctionType([], makeOptionType(elemType));
      case "unshift":
        return makeFunctionType([{ name: "item", type: elemType }], TYPE_INT);
      case "clear":
        return makeFunctionType([], TYPE_VOID);
      case "indexOf":
        return makeFunctionType([{ name: "item", type: elemType }], TYPE_INT);
      case "includes":
      case "contains":
        return makeFunctionType([{ name: "item", type: elemType }], TYPE_BOOL);
      case "filter":
        return makeFunctionType([{ name: "predicate", type: TYPE_UNKNOWN }], receiver);
      case "map":
        return makeFunctionType([{ name: "transform", type: TYPE_UNKNOWN }], makeArrayType(TYPE_UNKNOWN));
      case "forEach":
        return makeFunctionType([{ name: "callback", type: TYPE_UNKNOWN }], TYPE_VOID);
      case "some":
        return makeFunctionType([{ name: "predicate", type: TYPE_UNKNOWN }], TYPE_BOOL);
      case "every":
        return makeFunctionType([{ name: "predicate", type: TYPE_UNKNOWN }], TYPE_BOOL);
      case "find":
        return makeFunctionType([{ name: "predicate", type: TYPE_UNKNOWN }], makeOptionType(elemType));
      case "findIndex":
        return makeFunctionType([{ name: "predicate", type: TYPE_UNKNOWN }], TYPE_INT);
      case "splice":
        return makeFunctionType(
          [
            { name: "start", type: TYPE_INT },
            { name: "deleteCount", type: TYPE_INT, optional: true },
            { name: "item1", type: elemType, optional: true },
            { name: "item2", type: elemType, optional: true },
            { name: "item3", type: elemType, optional: true },
            { name: "item4", type: elemType, optional: true },
          ],
          receiver,
        );
      case "concat":
        return makeFunctionType([{ name: "other", type: receiver }], receiver);
      case "reverse":
        return makeFunctionType([], receiver);
      case "sort":
        return makeFunctionType([{ name: "compareFn", type: TYPE_UNKNOWN, optional: true }], receiver);
      case "isEmpty":
        return makeFunctionType([], TYPE_BOOL);
      case "first":
        return makeFunctionType([], makeOptionType(elemType));
      case "last":
        return makeFunctionType([], makeOptionType(elemType));
      case "join":
        return makeFunctionType([{ name: "sep", type: TYPE_STR }], TYPE_STR);
      default:
        return null;
    }
  }

  // Primitive Types Canonical Methods (int, float, num, bool)
  if (
    receiver.kind === "int" ||
    receiver.kind === "float" ||
    receiver.kind === "num" ||
    receiver.kind === "bool"
  ) {
    if (method === "toString") {
      return makeFunctionType([], TYPE_STR);
    }
  }

  if (receiver.kind === "int" || receiver.kind === "float" || receiver.kind === "num") {
    if (method === "toInt" || method === "round" || method === "floor" || method === "ceil") {
      return makeFunctionType([], TYPE_INT);
    }
    if (method === "toFloat") {
      return makeFunctionType([], TYPE_FLOAT);
    }
  }

  return null;
}

/**
 * Built-in global symbols and constructors (Ok, Err, Some, log, etc.).
 */
export const GLOBAL_SYMBOLS: Readonly<Record<string, Type>> = {
  print: makeFunctionType([{ name: "val", type: TYPE_UNKNOWN }], TYPE_VOID),
  log: makeFunctionType([{ name: "val", type: TYPE_UNKNOWN }], TYPE_VOID),
  abs: makeFunctionType([{ name: "n", type: TYPE_NUM }], TYPE_NUM),
  min: makeFunctionType(
    [
      { name: "a", type: TYPE_NUM },
      { name: "b", type: TYPE_NUM },
      { name: "c", type: TYPE_NUM, optional: true },
      { name: "d", type: TYPE_NUM, optional: true },
      { name: "e", type: TYPE_NUM, optional: true },
      { name: "f", type: TYPE_NUM, optional: true },
    ],
    TYPE_NUM,
  ),
  max: makeFunctionType(
    [
      { name: "a", type: TYPE_NUM },
      { name: "b", type: TYPE_NUM },
      { name: "c", type: TYPE_NUM, optional: true },
      { name: "d", type: TYPE_NUM, optional: true },
      { name: "e", type: TYPE_NUM, optional: true },
      { name: "f", type: TYPE_NUM, optional: true },
    ],
    TYPE_NUM,
  ),
  clamp: makeFunctionType(
    [
      { name: "val", type: TYPE_NUM },
      { name: "min", type: TYPE_NUM },
      { name: "max", type: TYPE_NUM },
    ],
    TYPE_NUM,
  ),
  sqrt: makeFunctionType([{ name: "n", type: TYPE_NUM }], TYPE_FLOAT),
  pow: makeFunctionType(
    [
      { name: "base", type: TYPE_NUM },
      { name: "exp", type: TYPE_NUM },
    ],
    TYPE_FLOAT,
  ),
  floor: makeFunctionType([{ name: "n", type: TYPE_NUM }], TYPE_INT),
  ceil: makeFunctionType([{ name: "n", type: TYPE_NUM }], TYPE_INT),
  round: makeFunctionType([{ name: "n", type: TYPE_NUM }], TYPE_INT),
  sin: makeFunctionType([{ name: "rad", type: TYPE_NUM }], TYPE_FLOAT),
  cos: makeFunctionType([{ name: "rad", type: TYPE_NUM }], TYPE_FLOAT),
  tan: makeFunctionType([{ name: "rad", type: TYPE_NUM }], TYPE_FLOAT),
  atan2: makeFunctionType(
    [
      { name: "y", type: TYPE_NUM },
      { name: "x", type: TYPE_NUM },
    ],
    TYPE_FLOAT,
  ),
  asin: makeFunctionType([{ name: "n", type: TYPE_NUM }], TYPE_FLOAT),
  acos: makeFunctionType([{ name: "n", type: TYPE_NUM }], TYPE_FLOAT),
  hypot: makeFunctionType(
    [
      { name: "a", type: TYPE_NUM },
      { name: "b", type: TYPE_NUM },
      { name: "c", type: TYPE_NUM, optional: true },
      { name: "d", type: TYPE_NUM, optional: true },
    ],
    TYPE_FLOAT,
  ),
  sign: makeFunctionType([{ name: "n", type: TYPE_NUM }], TYPE_NUM),
  Ok: makeFunctionType(
    [{ name: "value", type: TYPE_UNKNOWN }],
    makeResultType(TYPE_UNKNOWN, TYPE_NEVER),
  ),
  Err: makeFunctionType(
    [{ name: "error", type: TYPE_UNKNOWN }],
    makeResultType(TYPE_NEVER, TYPE_UNKNOWN),
  ),
  Some: makeFunctionType([{ name: "value", type: TYPE_UNKNOWN }], makeOptionType(TYPE_UNKNOWN)),
};
