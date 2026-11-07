/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Data & Config AST Bi-directional Converter Engine for AICE 2.0 (Step 24).
 * Handles bi-directional lossless lowering between JavaScript data values
 * and AICE AST Expressions / Module items for JSON & YAML dialects.
 */

import type {
  ArrayLiteralExpr,
  ConstDecl,
  Expr,
  LiteralExpr,
  Module,
  RecordLiteralExpr,
  VarDecl,
} from "./ast.js";
import { emptySpan } from "./span.js";

/**
 * Converts a JavaScript value (primitive, array, object) into an AICE AST Expr.
 */
export function valueToAst(val: any, filePath = "<anonymous>"): Expr {
  if (val === null || val === undefined) {
    return {
      kind: "LiteralExpr",
      literalKind: "nil",
      value: null,
      rawValue: "nil",
      span: emptySpan(filePath),
    };
  }

  if (typeof val === "boolean") {
    return {
      kind: "LiteralExpr",
      literalKind: "boolean",
      value: val,
      rawValue: val ? "true" : "false",
      span: emptySpan(filePath),
    };
  }

  if (typeof val === "number") {
    return {
      kind: "LiteralExpr",
      literalKind: "number",
      value: val,
      rawValue: String(val),
      span: emptySpan(filePath),
    };
  }

  if (typeof val === "bigint") {
    return {
      kind: "LiteralExpr",
      literalKind: "number",
      value: Number(val),
      rawValue: val.toString(),
      span: emptySpan(filePath),
    };
  }

  if (typeof val === "string") {
    return {
      kind: "LiteralExpr",
      literalKind: "string",
      value: val,
      rawValue: JSON.stringify(val),
      span: emptySpan(filePath),
    };
  }

  if (Array.isArray(val)) {
    return {
      kind: "ArrayLiteralExpr",
      elements: val.map((elem) => valueToAst(elem, filePath)),
      span: emptySpan(filePath),
    };
  }

  if (typeof val === "object") {
    return {
      kind: "RecordLiteralExpr",
      properties: Object.entries(val).map(([key, propVal]) => ({
        key,
        value: valueToAst(propVal, filePath),
        span: emptySpan(filePath),
      })),
      span: emptySpan(filePath),
    };
  }

  return {
    kind: "LiteralExpr",
    literalKind: "nil",
    value: null,
    rawValue: "nil",
    span: emptySpan(filePath),
  };
}

/**
 * Converts an AICE AST Expr back into a native JavaScript data value.
 */
export function astToValue(expr: Expr): any {
  switch (expr.kind) {
    case "LiteralExpr": {
      if (expr.literalKind === "nil") return null;
      if (expr.literalKind === "boolean") return Boolean(expr.value);
      if (expr.literalKind === "number") {
        return typeof expr.value === "number" ? expr.value : Number(expr.value);
      }
      if (expr.literalKind === "string") return String(expr.value);
      return expr.value;
    }
    case "UnaryExpr": {
      const operandVal = astToValue(expr.operand);
      if (expr.operator === "-") {
        return typeof operandVal === "number" ? -operandVal : operandVal;
      }
      if (expr.operator === "!" || expr.operator === "not") {
        return !operandVal;
      }
      return operandVal;
    }
    case "ArrayLiteralExpr": {
      return expr.elements.map((el) => astToValue(el));
    }
    case "RecordLiteralExpr": {
      const result: Record<string, any> = {};
      for (const prop of expr.properties) {
        if (prop.isSpread) {
          const spreadVal = astToValue(prop.value);
          if (spreadVal && typeof spreadVal === "object" && !Array.isArray(spreadVal)) {
            Object.assign(result, spreadVal);
          }
        } else if (prop.key !== undefined) {
          let cleanKey = prop.key;
          if (
            (cleanKey.startsWith('"') && cleanKey.endsWith('"')) ||
            (cleanKey.startsWith("'") && cleanKey.endsWith("'"))
          ) {
            cleanKey = cleanKey.slice(1, -1);
          }
          result[cleanKey] = astToValue(prop.value);
        }
      }
      return result;
    }
    case "IdentifierExpr": {
      if (expr.name === "true") return true;
      if (expr.name === "false") return false;
      if (expr.name === "nil" || expr.name === "null") return null;
      if (expr.name === "undefined") return undefined;
      return expr.name;
    }
    case "TemplateLiteralExpr": {
      if (expr.expressions.length === 0) {
        return expr.quasis[0] ?? "";
      }
      let res = expr.quasis[0] ?? "";
      for (let i = 0; i < expr.expressions.length; i++) {
        res += String(astToValue(expr.expressions[i]));
        res += expr.quasis[i + 1] ?? "";
      }
      return res;
    }
    default:
      return null;
  }
}

/**
 * Extracts data representation from an AICE Module AST containing data/config declarations.
 */
export function extractValueFromModule(mod: Module): any {
  if (!mod || !mod.items || mod.items.length === 0) {
    return {};
  }

  // Prefer standard data/config declaration names
  const configItem = mod.items.find(
    (i) =>
      (i.kind === "ConstDecl" || i.kind === "VarDecl") &&
      (i.name === "config" || i.name === "data" || i.name === "default"),
  ) as ConstDecl | VarDecl | undefined;

  if (configItem) {
    return astToValue(configItem.value);
  }

  const decls = mod.items.filter((i) => i.kind === "ConstDecl" || i.kind === "VarDecl") as (
    | ConstDecl
    | VarDecl
  )[];

  if (decls.length === 1) {
    return astToValue(decls[0].value);
  }

  if (decls.length > 1) {
    const obj: Record<string, any> = {};
    for (const d of decls) {
      obj[d.name] = astToValue(d.value);
    }
    return obj;
  }

  return {};
}
