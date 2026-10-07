/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AIL: Semantic Type Representations & Calculus Definitions
 */

export type BasePrimitiveType =
  | "!u" // Unsigned 32-bit int
  | "!i" // Signed 32-bit int
  | "!f" // IEEE 754 64-bit float
  | "!s" // UTF-8 string
  | "!b" // Boolean
  | "!void" // Unit / void
  | "!unknown" // Safe unknown
  | "!nil"; // Null / undefined

export type SemanticType =
  | { kind: "Primitive"; name: BasePrimitiveType }
  | { kind: "Array"; elementType: SemanticType }
  | { kind: "Record"; fields: Map<string, { type: SemanticType; optional?: boolean }> }
  | { kind: "Union"; types: SemanticType[] }
  | {
      kind: "Function";
      params: Array<{ name: string; type: SemanticType }>;
      returnType: SemanticType;
      effects: string[];
    }
  | { kind: "Result"; okType: SemanticType; errType: SemanticType }
  | { kind: "Option"; valueType: SemanticType }
  | { kind: "Typestate"; name: string; currentState: string; states: string[] }
  | { kind: "Refinement"; baseType: BasePrimitiveType; predicateDescription: string };

export function isSameType(a: SemanticType, b: SemanticType): boolean {
  if (a.kind !== b.kind) return false;

  if (a.kind === "Primitive" && b.kind === "Primitive") {
    return a.name === b.name;
  }

  if (a.kind === "Array" && b.kind === "Array") {
    return isSameType(a.elementType, b.elementType);
  }

  if (a.kind === "Result" && b.kind === "Result") {
    return isSameType(a.okType, b.okType) && isSameType(a.errType, b.errType);
  }

  if (a.kind === "Option" && b.kind === "Option") {
    return isSameType(a.valueType, b.valueType);
  }

  if (a.kind === "Record" && b.kind === "Record") {
    if (a.fields.size !== b.fields.size) return false;
    for (const [key, fieldA] of a.fields.entries()) {
      const fieldB = b.fields.get(key);
      if (!fieldB) return false;
      if (!isSameType(fieldA.type, fieldB.type)) return false;
    }
    return true;
  }

  if (a.kind === "Union" && b.kind === "Union") {
    if (a.types.length !== b.types.length) return false;
    return a.types.every((tA, i) => isSameType(tA, b.types[i]));
  }

  if (a.kind === "Typestate" && b.kind === "Typestate") {
    return a.name === b.name && a.currentState === b.currentState;
  }

  return false;
}

export function formatSemanticType(type: SemanticType): string {
  switch (type.kind) {
    case "Primitive":
      return type.name;
    case "Array":
      return `[${formatSemanticType(type.elementType)}]`;
    case "Result":
      return `Result[${formatSemanticType(type.okType)}, ${formatSemanticType(type.errType)}]`;
    case "Option":
      return `Option[${formatSemanticType(type.valueType)}]`;
    case "Record": {
      const fields = Array.from(type.fields.entries())
        .map(([k, v]) => `${k} ${formatSemanticType(v.type)}`)
        .join(" ");
      return `(% ${fields})`;
    }
    case "Union":
      return `(| ${type.types.map(formatSemanticType).join(" ")})`;
    case "Function": {
      const params = type.params.map((p) => `${p.name} ${formatSemanticType(p.type)}`).join(" ");
      return `(-> (${params}) ${formatSemanticType(type.returnType)})`;
    }
    case "Typestate":
      return `Typestate[${type.name}:${type.currentState}]`;
    case "Refinement":
      return `(?: ${type.baseType} ${type.predicateDescription})`;
  }
}
