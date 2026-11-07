/**
 * Semantic Type System & Subtyping Lattice for AICE 2.0.
 * Conforms to Section 3 of docs/AICE_SPEC.md.
 */

import type { Expr } from "../core/ast.js";

export type TypeKind =
  | "int"
  | "str"
  | "float"
  | "bool"
  | "num"
  | "byte"
  | "char"
  | "void"
  | "nil"
  | "unknown"
  | "never"
  | "array"
  | "tuple"
  | "record"
  | "result"
  | "option"
  | "function"
  | "refinement"
  | "enum"
  | "named";

export interface PrimitiveTypeRep {
  kind:
    | "int"
    | "str"
    | "float"
    | "bool"
    | "num"
    | "byte"
    | "char"
    | "void"
    | "nil"
    | "unknown"
    | "never";
}

export interface ArrayTypeRep {
  kind: "array";
  elementType: Type;
}

export interface TupleTypeRep {
  kind: "tuple";
  elementTypes: Type[];
}

export interface RecordTypeRep {
  kind: "record";
  name?: string;
  fields: Map<string, Type>;
  isClass?: boolean;
}

export interface ResultTypeRep {
  kind: "result";
  okType: Type;
  errType: Type;
}

export interface OptionTypeRep {
  kind: "option";
  innerType: Type;
}

export interface FunctionTypeRep {
  kind: "function";
  params: { name: string; type: Type; optional?: boolean; rest?: boolean }[];
  returnType: Type;
}

export interface RefinementTypeRep {
  kind: "refinement";
  param: string;
  baseType: Type;
  predicateExpr?: Expr;
  bounds?: { min?: number; max?: number };
}

export interface EnumTypeRep {
  kind: "enum";
  name: string;
  variants: Map<string, Type[] | undefined>;
}

export interface NamedTypeRep {
  kind: "named";
  name: string;
  typeArgs?: Type[];
}

export type Type =
  | PrimitiveTypeRep
  | ArrayTypeRep
  | TupleTypeRep
  | RecordTypeRep
  | ResultTypeRep
  | OptionTypeRep
  | FunctionTypeRep
  | RefinementTypeRep
  | EnumTypeRep
  | NamedTypeRep;

// Canonical Type Singletons
export const TYPE_INT: PrimitiveTypeRep = { kind: "int" };
export const TYPE_STR: PrimitiveTypeRep = { kind: "str" };
export const TYPE_FLOAT: PrimitiveTypeRep = { kind: "float" };
export const TYPE_BOOL: PrimitiveTypeRep = { kind: "bool" };
export const TYPE_NUM: PrimitiveTypeRep = { kind: "num" };
export const TYPE_BYTE: PrimitiveTypeRep = { kind: "byte" };
export const TYPE_CHAR: PrimitiveTypeRep = { kind: "char" };
export const TYPE_VOID: PrimitiveTypeRep = { kind: "void" };
export const TYPE_NIL: PrimitiveTypeRep = { kind: "nil" };
export const TYPE_UNKNOWN: PrimitiveTypeRep = { kind: "unknown" };
export const TYPE_NEVER: PrimitiveTypeRep = { kind: "never" };

export function makeArrayType(elementType: Type): ArrayTypeRep {
  return { kind: "array", elementType };
}

export function makeTupleType(elementTypes: Type[]): TupleTypeRep {
  return { kind: "tuple", elementTypes };
}

export function makeOptionType(innerType: Type): OptionTypeRep {
  return { kind: "option", innerType };
}

export function makeResultType(okType: Type, errType: Type): ResultTypeRep {
  return { kind: "result", okType, errType };
}

export function makeRecordType(
  fields: Record<string, Type> | Map<string, Type>,
  name?: string,
): RecordTypeRep {
  const map = fields instanceof Map ? fields : new Map(Object.entries(fields));
  return { kind: "record", name, fields: map };
}

export function makeFunctionType(
  params: { name: string; type: Type; optional?: boolean; rest?: boolean }[],
  returnType: Type,
): FunctionTypeRep {
  return { kind: "function", params, returnType };
}

export function makeNamedType(name: string, typeArgs?: Type[]): NamedTypeRep {
  return { kind: "named", name, typeArgs };
}

export function isStringType(type: Type): boolean {
  if (type.kind === "str") return true;
  if (type.kind === "named" && (type.name === "str" || type.name === "string")) return true;
  return false;
}

export function isStringLiteralType(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed.includes("|")) return false;
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    try {
      JSON.parse(trimmed);
      return true;
    } catch {
      return false;
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2) {
    return !trimmed.slice(1, -1).includes("'");
  }
  return false;
}

export function unquoteStringLiteral(name: string): string {
  const trimmed = name.trim();
  if (isStringLiteralType(trimmed)) {
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
      try {
        return JSON.parse(trimmed);
      } catch {
        return trimmed.slice(1, -1);
      }
    }
    if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

export function isStringLiteralUnion(name: string): boolean {
  if (!name.includes("|")) return false;
  const parts = name.split("|").map((p) => p.trim());
  return parts.length > 0 && parts.every((p) => isStringLiteralType(p));
}

export const TYPE_ALIAS_REGISTRY = new Map<string, Type>();

export function registerTypeAlias(name: string, type: Type): void {
  TYPE_ALIAS_REGISTRY.set(name, type);
}

export function lookupTypeAlias(name: string): Type | undefined {
  return TYPE_ALIAS_REGISTRY.get(name);
}

export function clearTypeAliases(): void {
  TYPE_ALIAS_REGISTRY.clear();
}

const NON_OPAQUE_TYPE_NAMES = new Set([
  "int",
  "str",
  "float",
  "bool",
  "num",
  "byte",
  "char",
  "void",
  "nil",
  "unknown",
  "never",
  "any",
  "string",
  "number",
  "boolean",
  "Object",
  "Array",
  "Map",
  "Set",
  "Promise",
  "WeakMap",
  "WeakSet",
  "Date",
  "RegExp",
  "Error",
  "Symbol",
  "Function",
]);

export function isOpaqueNamedType(name: string): boolean {
  const trimmed = name.trim();
  if (
    trimmed === "" ||
    NON_OPAQUE_TYPE_NAMES.has(trimmed) ||
    trimmed.includes("|") ||
    trimmed.includes("&") ||
    trimmed.includes("=>") ||
    trimmed.includes("[") ||
    trimmed.includes("{") ||
    !isNaN(Number(trimmed))
  ) {
    return false;
  }
  return true;
}

export function isStringLiteralOrUnionType(type: Type): boolean {
  if (type.kind === "option") {
    return isStringLiteralOrUnionType(type.innerType);
  }
  if (type.kind === "named") {
    if (isStringLiteralType(type.name) || isStringLiteralUnion(type.name)) return true;
    const resolved = TYPE_ALIAS_REGISTRY.get(type.name);
    if (resolved && resolved !== type) {
      return isStringLiteralOrUnionType(resolved);
    }
  }
  if (type.kind === "enum") return true;
  return false;
}

/**
 * Checks if a source type is assignable to a target type according to the AICE subtyping lattice.
 */
export function isAssignable(
  target: Type,
  source: Type,
  visited: Set<string> = new Set(),
): boolean {
  if (target === source) return true;
  if (target.kind === "unknown" || source.kind === "unknown") return true;
  if (source.kind === "never") return true;

  // Coinductive cycle detection for recursive types
  const cycleKey =
    target.kind === "named" && source.kind === "named"
      ? `${target.name}<:${source.name}`
      : target.kind === "named"
        ? `${target.name}<:${source.kind}`
        : source.kind === "named"
          ? `${target.kind}<:${source.name}`
          : null;

  if (cycleKey) {
    if (visited.has(cycleKey)) return true;
    visited = new Set(visited);
    visited.add(cycleKey);
  }

  // 1. Exact match when both source and target are boolean literal named types ("true", "false")
  if (
    target.kind === "named" &&
    source.kind === "named" &&
    (target.name === "true" || target.name === "false") &&
    (source.name === "true" || source.name === "false")
  ) {
    return target.name === source.name;
  }

  // 2. Allow boolean literal named types ("true", "false") to be assignable to bool / TYPE_BOOL
  if (
    (target.kind === "bool" ||
      (target.kind === "named" && (target.name === "bool" || target.name === "boolean"))) &&
    source.kind === "named" &&
    (source.name === "true" || source.name === "false")
  ) {
    return true;
  }

  // 3. Reject assigning a union to a single boolean literal type unless all union parts match target
  if (
    target.kind === "named" &&
    (target.name === "true" || target.name === "false") &&
    source.kind === "named" &&
    source.name.includes("|")
  ) {
    const parts = source.name.split("|").map((s) => s.trim());
    return parts.every((p) => isAssignable(target, { kind: "named", name: p }));
  }

  // 4. Allow bool / TYPE_BOOL to be assignable to/from "true | false" unions
  if (
    (source.kind === "bool" ||
      (source.kind === "named" && (source.name === "bool" || source.name === "boolean"))) &&
    target.kind === "named" &&
    target.name.includes("|")
  ) {
    const parts = target.name.split("|").map((s) => s.trim());
    if (parts.includes("true") && parts.includes("false")) {
      return true;
    }
  }

  if (
    (target.kind === "bool" ||
      (target.kind === "named" && (target.name === "bool" || target.name === "boolean"))) &&
    source.kind === "named" &&
    source.name.includes("|")
  ) {
    const parts = source.name.split("|").map((s) => s.trim());
    if (
      parts.every(
        (p) =>
          p === "true" ||
          p === "false" ||
          p === "bool" ||
          p === "boolean" ||
          isAssignable(target, { kind: "named", name: p }),
      )
    ) {
      return true;
    }
  }

  // 5. String literal types & string literal unions assignability
  const targetIsStrLit = target.kind === "named" && isStringLiteralType(target.name);
  const targetIsStrUnion = target.kind === "named" && isStringLiteralUnion(target.name);
  const sourceIsStrLit = source.kind === "named" && isStringLiteralType(source.name);
  const sourceIsStrUnion = source.kind === "named" && isStringLiteralUnion(source.name);
  const targetIsStr =
    target.kind === "str" ||
    (target.kind === "named" && (target.name === "str" || target.name === "string"));
  const sourceIsStr =
    source.kind === "str" ||
    (source.kind === "named" && (source.name === "str" || source.name === "string"));

  // Exact match when both source and target are string literal named types
  if (targetIsStrLit && sourceIsStrLit) {
    return unquoteStringLiteral(target.name) === unquoteStringLiteral(source.name);
  }

  // Reject assigning a string literal union to a single string literal type unless all union parts match target
  if (targetIsStrLit && sourceIsStrUnion) {
    const parts = (source as NamedTypeRep).name.split("|").map((s) => unquoteStringLiteral(s));
    const targetVal = unquoteStringLiteral((target as NamedTypeRep).name);
    return parts.every((p) => p === targetVal);
  }

  // Allow assigning a single string literal to a string literal union if the union contains the literal
  if (targetIsStrUnion && sourceIsStrLit) {
    const parts = (target as NamedTypeRep).name.split("|").map((s) => unquoteStringLiteral(s));
    const sourceVal = unquoteStringLiteral((source as NamedTypeRep).name);
    return parts.includes(sourceVal);
  }

  // String literal union to string literal union: target must cover all source variants
  if (targetIsStrUnion && sourceIsStrUnion) {
    const targetParts = (target as NamedTypeRep).name
      .split("|")
      .map((s) => unquoteStringLiteral(s));
    const sourceParts = (source as NamedTypeRep).name
      .split("|")
      .map((s) => unquoteStringLiteral(s));
    return sourceParts.every((s) => targetParts.includes(s));
  }

  // Allow string literal named types and string literal unions to be assignable to str / TYPE_STR
  if (targetIsStr && (sourceIsStrLit || sourceIsStrUnion)) {
    return true;
  }

  // Disallow general str / TYPE_STR from being assigned to string literal or string literal union (soundness)
  if (sourceIsStr && (targetIsStrLit || targetIsStrUnion)) {
    return false;
  }

  // String-backed enum assignability with string literals & unions
  if (target.kind === "enum") {
    if (sourceIsStrLit) {
      const sourceVal = unquoteStringLiteral(source.name);
      return (
        target.variants.has(sourceVal) ||
        Array.from(target.variants.keys()).some((v) => unquoteStringLiteral(v) === sourceVal)
      );
    }
    if (sourceIsStrUnion) {
      const parts = source.name.split("|").map((s) => unquoteStringLiteral(s));
      return parts.every(
        (p) =>
          target.variants.has(p) ||
          Array.from(target.variants.keys()).some((v) => unquoteStringLiteral(v) === p),
      );
    }
    if (source.kind === "named" && target.name === source.name) {
      return true;
    }
  }

  if (source.kind === "enum") {
    if (targetIsStrLit) {
      const targetVal = unquoteStringLiteral(target.name);
      return Array.from(source.variants.keys()).some((v) => unquoteStringLiteral(v) === targetVal);
    }
    if (targetIsStrUnion) {
      const parts = target.name.split("|").map((s) => unquoteStringLiteral(s));
      return Array.from(source.variants.keys()).every((v) =>
        parts.includes(unquoteStringLiteral(v)),
      );
    }
    if (targetIsStr) {
      return true;
    }
    if (target.kind === "named" && target.name === source.name) {
      return true;
    }
  }

  if (target.kind === "enum" && source.kind === "enum") {
    return target.name === source.name;
  }

  // String literal compatibility with string literal union aliases and enums in TYPE_ALIAS_REGISTRY
  if (target.kind === "named") {
    const resolvedTarget = TYPE_ALIAS_REGISTRY.get(target.name);
    if (resolvedTarget && resolvedTarget !== target) {
      if (isAssignable(resolvedTarget, source, visited)) {
        return true;
      }
    } else if (sourceIsStrLit && isOpaqueNamedType(target.name)) {
      return true;
    }
  }

  if (source.kind === "named") {
    const resolvedSource = TYPE_ALIAS_REGISTRY.get(source.name);
    if (resolvedSource && resolvedSource !== source) {
      if (isAssignable(target, resolvedSource, visited)) {
        return true;
      }
    }
  }

  // Handle named unions (e.g. "int | (number) => void", "A | B")
  if (source.kind === "named" && source.name.includes("|")) {
    const parts = source.name.split("|").map((s) => s.trim());
    return parts.some((p) => {
      if (p === target.kind) return true;
      if (
        (target.kind === "int" || target.kind === "float" || target.kind === "num") &&
        (p === "int" ||
          p === "float" ||
          p === "num" ||
          p === "number" ||
          (!isNaN(Number(p)) && p.trim() !== ""))
      ) {
        return true;
      }
      if (target.kind === "str" && (p === "str" || p === "string")) return true;
      if (target.kind === "bool" && (p === "bool" || p === "boolean")) return true;
      return isAssignable(target, { kind: "named", name: p }, visited);
    });
  }

  if (target.kind === "named" && target.name.includes("|")) {
    const parts = target.name.split("|").map((s) => s.trim());
    return parts.some((p) => {
      if (p === source.kind) return true;
      if (
        (source.kind === "int" || source.kind === "float" || source.kind === "num") &&
        (p === "int" ||
          p === "float" ||
          p === "num" ||
          p === "number" ||
          (!isNaN(Number(p)) && p.trim() !== ""))
      ) {
        return true;
      }
      if (source.kind === "str" && (p === "str" || p === "string")) return true;
      if (source.kind === "bool" && (p === "bool" || p === "boolean")) return true;
      return isAssignable({ kind: "named", name: p }, source, visited);
    });
  }

  if (target.kind === source.kind) {
    if (target.kind === "array" && source.kind === "array") {
      return isAssignable(target.elementType, source.elementType, visited);
    }
    if (target.kind === "tuple" && source.kind === "tuple") {
      if (target.elementTypes.length !== source.elementTypes.length) return false;
      for (let i = 0; i < target.elementTypes.length; i++) {
        if (!isAssignable(target.elementTypes[i], source.elementTypes[i], visited)) {
          return false;
        }
      }
      return true;
    }
    if (target.kind === "option" && source.kind === "option") {
      return isAssignable(target.innerType, source.innerType, visited);
    }
    if (target.kind === "result" && source.kind === "result") {
      return (
        isAssignable(target.okType, source.okType, visited) &&
        isAssignable(target.errType, source.errType, visited)
      );
    }
    if (target.kind === "record" && source.kind === "record") {
      for (const [key, targetFieldType] of target.fields) {
        const sourceFieldType = source.fields.get(key);
        if (!sourceFieldType) {
          if (targetFieldType.kind === "option") {
            continue;
          }
          return false;
        }
        if (!isAssignable(targetFieldType, sourceFieldType, visited)) {
          return false;
        }
      }
      return true;
    }
    if (target.kind === "function" && source.kind === "function") {
      if (source.params.length > target.params.length) {
        for (let i = target.params.length; i < source.params.length; i++) {
          if (!source.params[i].optional) return false;
        }
      }
      for (let i = 0; i < Math.min(target.params.length, source.params.length); i++) {
        // Contravariant in parameter types
        if (!isAssignable(source.params[i].type, target.params[i].type, visited)) {
          return false;
        }
      }
      // Covariant in return type
      return isAssignable(target.returnType, source.returnType, visited);
    }
    if (target.kind === "named" && source.kind === "named") {
      if (target.name === source.name) {
        if (
          target.typeArgs &&
          target.typeArgs.length > 0 &&
          source.typeArgs &&
          source.typeArgs.length > 0
        ) {
          if (target.typeArgs.length !== source.typeArgs.length) return false;
          for (let i = 0; i < target.typeArgs.length; i++) {
            if (!isAssignable(target.typeArgs[i], source.typeArgs[i], visited)) {
              return false;
            }
          }
          return true;
        }
        if (
          (!target.typeArgs || target.typeArgs.length === 0) &&
          (!source.typeArgs || source.typeArgs.length === 0)
        ) {
          return true;
        }
        if (!target.typeArgs || target.typeArgs.length === 0) {
          return true;
        }
        return false;
      }
      if (
        target.name === "any" ||
        target.name === "unknown" ||
        source.name === "any" ||
        source.name === "unknown"
      ) {
        return true;
      }
      if (
        target.name.trim() !== "" &&
        source.name.trim() !== "" &&
        !isNaN(Number(target.name)) &&
        !isNaN(Number(source.name))
      ) {
        return Number(target.name) === Number(source.name);
      }
      if (source.name.includes("|") || target.name.includes("|")) {
        const sourceParts = source.name.includes("|")
          ? source.name.split("|").map((s) => s.trim())
          : [source.name];
        const targetParts = target.name.includes("|")
          ? target.name.split("|").map((s) => s.trim())
          : [target.name];

        for (const s of sourceParts) {
          for (const t of targetParts) {
            if (s === t || s === "any" || t === "any" || s === "unknown" || t === "unknown") {
              return true;
            }
            if (
              s.trim() !== "" &&
              t.trim() !== "" &&
              !isNaN(Number(s)) &&
              !isNaN(Number(t)) &&
              Number(s) === Number(t)
            ) {
              return true;
            }
            if (s.includes("=>") && t.includes("=>")) {
              return true;
            }
          }
        }
      }
      if (target.name.includes("=>") && source.name.includes("=>")) {
        return true;
      }
      const resolvedTarget = TYPE_ALIAS_REGISTRY.get(target.name);
      if (resolvedTarget && resolvedTarget !== target) {
        if (isAssignable(resolvedTarget, source, visited)) return true;
      }
      const resolvedSource = TYPE_ALIAS_REGISTRY.get(source.name);
      if (resolvedSource && resolvedSource !== source) {
        if (isAssignable(target, resolvedSource, visited)) return true;
      }
      return false;
    }
    return true;
  }

  // Numeric literal named types (e.g. "-1", "0", "1")
  if (
    target.kind === "named" &&
    target.name.trim() !== "" &&
    !isNaN(Number(target.name)) &&
    (source.kind === "int" || source.kind === "float" || source.kind === "num")
  ) {
    return true;
  }

  if (
    source.kind === "named" &&
    source.name.trim() !== "" &&
    !isNaN(Number(source.name)) &&
    (target.kind === "int" || target.kind === "float" || target.kind === "num")
  ) {
    return true;
  }

  // Structural subtyping for named interfaces and record literals
  if (
    target.kind === "named" &&
    target.name === "Record" &&
    target.typeArgs &&
    target.typeArgs.length === 2 &&
    source.kind === "record"
  ) {
    const keyType = target.typeArgs[0];
    const valType = target.typeArgs[1];
    for (const [key, sourceFieldType] of source.fields) {
      if (keyType.kind === "enum" || (keyType.kind === "named" && !isStringType(keyType))) {
        const keyAsLit: Type = { kind: "named", name: JSON.stringify(key) };
        if (!isAssignable(keyType, keyAsLit, visited)) {
          return false;
        }
      }
      if (!isAssignable(valType, sourceFieldType, visited)) {
        return false;
      }
    }
    return true;
  }

  if (
    (target.kind === "named" && source.kind === "record") ||
    (target.kind === "record" && source.kind === "named")
  ) {
    return true;
  }

  // Subtyping between function types and named function signature types (e.g. "() => void")
  if (
    (target.kind === "named" && target.name.includes("=>") && source.kind === "function") ||
    (source.kind === "named" && source.name.includes("=>") && target.kind === "function")
  ) {
    return true;
  }

  // Numeric hierarchy: num accepts int and float; int accepts byte; float accepts int and byte
  if (
    target.kind === "num" &&
    (source.kind === "int" ||
      source.kind === "float" ||
      source.kind === "byte" ||
      source.kind === "enum")
  ) {
    return true;
  }
  if (
    target.kind === "float" &&
    (source.kind === "int" || source.kind === "byte" || source.kind === "num")
  ) {
    return true;
  }
  if (
    target.kind === "int" &&
    (source.kind === "byte" ||
      source.kind === "float" ||
      source.kind === "num" ||
      source.kind === "enum")
  ) {
    return true;
  }
  if (
    target.kind === "enum" &&
    (source.kind === "int" || source.kind === "num" || source.kind === "byte")
  ) {
    return true;
  }

  // Option[T] accepts nil or T
  if (target.kind === "option") {
    if (source.kind === "nil") return true;
    return isAssignable(target.innerType, source, visited);
  }

  // nil is assignable to named object references, class instances, and unknown
  if (source.kind === "nil") {
    if (
      target.kind === "named" ||
      (target as any).kind === "unknown" ||
      (target.kind === "record" && target.isClass)
    ) {
      return true;
    }
  }

  // Allow unwrapping Option[T] into T when target is compatible with T
  if (source.kind === "option" && isAssignable(target, source.innerType, visited)) {
    return true;
  }

  // Refinement types: compatible with base type
  if (target.kind === "refinement") {
    return isAssignable(
      target.baseType,
      source.kind === "refinement" ? source.baseType : source,
      visited,
    );
  }
  if (source.kind === "refinement") {
    return isAssignable(target, source.baseType, visited);
  }

  return false;
}

/**
 * Formats a semantic type into a readable human / diagnostic string.
 */
export function formatType(type: Type): string {
  switch (type.kind) {
    case "int":
    case "str":
    case "float":
    case "bool":
    case "num":
    case "byte":
    case "char":
    case "void":
    case "nil":
    case "unknown":
    case "never":
      return type.kind;
    case "array":
      return `[${formatType(type.elementType)}]`;
    case "tuple":
      return `[${type.elementTypes.map(formatType).join(", ")}]`;
    case "option":
      return `${formatType(type.innerType)}?`;
    case "result":
      return `Result[${formatType(type.okType)}, ${formatType(type.errType)}]`;
    case "record": {
      if (type.name) return type.name;
      const entries = Array.from(type.fields.entries()).map(([k, v]) => `${k}:${formatType(v)}`);
      return `{ ${entries.join(", ")} }`;
    }
    case "function": {
      const p = type.params.map((param) => `${param.name}:${formatType(param.type)}`).join(", ");
      return `(${p}) -> ${formatType(type.returnType)}`;
    }
    case "refinement":
      return `{ ${type.param}:${formatType(type.baseType)} | ... }`;
    case "enum":
      return `enum ${type.name}`;
    case "named":
      if (type.typeArgs && type.typeArgs.length > 0) {
        return `${type.name}[${type.typeArgs.map(formatType).join(", ")}]`;
      }
      return type.name;
    default:
      return "unknown";
  }
}
