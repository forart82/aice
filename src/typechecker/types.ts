/**
 * Semantic Type System & Subtyping Lattice for AIL 2.0.
 * Conforms to Section 3 of docs/AIL_SPEC.md.
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

export interface RecordTypeRep {
  kind: "record";
  name?: string;
  fields: Map<string, Type>;
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
  params: { name: string; type: Type; optional?: boolean }[];
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
  params: { name: string; type: Type; optional?: boolean }[],
  returnType: Type,
): FunctionTypeRep {
  return { kind: "function", params, returnType };
}

/**
 * Checks if a source type is assignable to a target type according to the AIL subtyping lattice.
 */
export function isAssignable(target: Type, source: Type): boolean {
  if (target.kind === "unknown" || source.kind === "unknown") return true;
  if (source.kind === "never") return true;

  // Handle named unions (e.g. "int | (number) => void", "A | B")
  if (source.kind === "named" && source.name.includes("|")) {
    const parts = source.name.split("|").map((s) => s.trim());
    return parts.some((p) => {
      if (p === target.kind) return true;
      if (
        (target.kind === "int" || target.kind === "float" || target.kind === "num") &&
        (p === "int" || p === "float" || p === "num" || p === "number")
      ) {
        return true;
      }
      if (target.kind === "str" && (p === "str" || p === "string")) return true;
      if (target.kind === "bool" && (p === "bool" || p === "boolean")) return true;
      return isAssignable(target, { kind: "named", name: p });
    });
  }

  if (target.kind === "named" && target.name.includes("|")) {
    const parts = target.name.split("|").map((s) => s.trim());
    return parts.some((p) => {
      if (p === source.kind) return true;
      if (
        (source.kind === "int" || source.kind === "float" || source.kind === "num") &&
        (p === "int" || p === "float" || p === "num" || p === "number")
      ) {
        return true;
      }
      if (source.kind === "str" && (p === "str" || p === "string")) return true;
      if (source.kind === "bool" && (p === "bool" || p === "boolean")) return true;
      return isAssignable({ kind: "named", name: p }, source);
    });
  }

  if (target.kind === source.kind) {
    if (target.kind === "array" && source.kind === "array") {
      return isAssignable(target.elementType, source.elementType);
    }
    if (target.kind === "option" && source.kind === "option") {
      return isAssignable(target.innerType, source.innerType);
    }
    if (target.kind === "result" && source.kind === "result") {
      return (
        isAssignable(target.okType, source.okType) && isAssignable(target.errType, source.errType)
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
        if (!isAssignable(targetFieldType, sourceFieldType)) {
          return false;
        }
      }
      return true;
    }
    if (target.kind === "function" && source.kind === "function") {
      if (target.params.length !== source.params.length) return false;
      for (let i = 0; i < target.params.length; i++) {
        // Contravariant in parameter types
        if (!isAssignable(source.params[i].type, target.params[i].type)) {
          return false;
        }
      }
      // Covariant in return type
      return isAssignable(target.returnType, source.returnType);
    }
    if (target.kind === "named" && source.kind === "named") {
      if (target.name === source.name) return true;
      if (
        target.name === "any" ||
        target.name === "unknown" ||
        source.name === "any" ||
        source.name === "unknown"
      ) {
        return true;
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
            if (s.includes("=>") && t.includes("=>")) {
              return true;
            }
          }
        }
      }
      if (target.name.includes("=>") && source.name.includes("=>")) {
        return true;
      }
      return false;
    }
    return true;
  }

  // Structural subtyping for named interfaces and record literals
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
    (source.kind === "int" || source.kind === "float" || source.kind === "byte" || source.kind === "enum")
  ) {
    return true;
  }
  if (target.kind === "float" && (source.kind === "int" || source.kind === "byte" || source.kind === "num")) {
    return true;
  }
  if (
    target.kind === "int" &&
    (source.kind === "byte" || source.kind === "float" || source.kind === "num" || source.kind === "enum")
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
    return isAssignable(target.innerType, source);
  }

  // nil is assignable to named object references and unknown
  if (source.kind === "nil") {
    if (target.kind === "named" || (target as any).kind === "unknown") {
      return true;
    }
  }

  // Allow unwrapping Option[T] into T when target is compatible with T
  if (source.kind === "option" && isAssignable(target, source.innerType)) {
    return true;
  }

  // Refinement types: compatible with base type
  if (target.kind === "refinement") {
    return isAssignable(target.baseType, source.kind === "refinement" ? source.baseType : source);
  }
  if (source.kind === "refinement") {
    return isAssignable(target, source.baseType);
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
