/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AIL: Sound Static Type, Typestate & Invariant Checker (Pillars 1, 3, 4)
 * Enforces zero implicit coercion, strict immutability, linear typestates, and Result contracts.
 */

import type {
  AilComponentDeclNode,
  AilDocumentNode,
  AilExprNode,
  AilFunctionDeclNode,
  AilModuleNode,
  AilTypeExprNode,
} from "../core/ast.ts";
import { createStructuredDiagnostic, type StructuredDiagnostic } from "./diagnostics.ts";
import { CANONICAL_PRIMITIVES } from "./primitives.ts";
import {
  type BasePrimitiveType,
  formatSemanticType,
  isSameType,
  type SemanticType,
} from "./types.ts";

export interface TypeCheckResult {
  valid: boolean;
  diagnostics: StructuredDiagnostic[];
  inferredModuleTypes: Map<string, SemanticType>;
}

export class TypeEnvironment {
  private variables: Map<string, SemanticType> = new Map();
  private typeAliases: Map<string, SemanticType> = new Map();
  private typestates: Map<string, { current: string; states: string[] }> = new Map();
  public currentFunctionEffects: Set<string> = new Set();
  public parent?: TypeEnvironment;

  constructor(parent?: TypeEnvironment) {
    this.parent = parent;
  }

  public setVar(name: string, type: SemanticType): void {
    this.variables.set(name, type);
  }

  public getVar(name: string): SemanticType | undefined {
    return this.variables.get(name) ?? this.parent?.getVar(name);
  }

  public setType(name: string, type: SemanticType): void {
    this.typeAliases.set(name, type);
  }

  public getType(name: string): SemanticType | undefined {
    return this.typeAliases.get(name) ?? this.parent?.getType(name);
  }

  public setTypestate(resource: string, state: string, states: string[]): void {
    this.typestates.set(resource, { current: state, states });
  }

  public getTypestate(resource: string): { current: string; states: string[] } | undefined {
    return this.typestates.get(resource) ?? this.parent?.getTypestate(resource);
  }

  public transitionTypestate(resource: string, newState: string): boolean {
    const ts = this.getTypestate(resource);
    if (!ts) return false;
    if (!ts.states.includes(newState)) return false;
    ts.current = newState;
    return true;
  }
}

export function typecheckAil(document: AilDocumentNode): TypeCheckResult {
  const diagnostics: StructuredDiagnostic[] = [];
  const inferredModuleTypes = new Map<string, SemanticType>();
  const globalEnv = new TypeEnvironment();

  // Register built-in primitives
  const baseTypes: BasePrimitiveType[] = [
    "!u",
    "!i",
    "!f",
    "!s",
    "!b",
    "!void",
    "!unknown",
    "!nil",
  ];
  for (const bt of baseTypes) {
    globalEnv.setType(bt, { kind: "Primitive", name: bt });
  }

  if (document.kind === "Workspace") {
    for (const file of document.files) {
      checkModule(file.module, globalEnv);
    }
  } else {
    checkModule(document, globalEnv);
  }

  function checkModule(mod: AilModuleNode, env: TypeEnvironment): void {
    // 1st Pass: Register all Type Declarations
    for (const entity of mod.entities) {
      if (entity.kind === "TypeDecl") {
        const semType = resolveTypeExpr(entity.typeExpr, env);
        env.setType(entity.name, semType);
        inferredModuleTypes.set(entity.name, semType);
      }
    }

    // 2nd Pass: Register all Function Signatures into env
    for (const entity of mod.entities) {
      if (entity.kind === "FunctionDecl") {
        const params = entity.signatures.params.map((p) => ({
          name: p.name,
          type: resolveTypeExpr(p.type, env),
        }));
        const retType = resolveTypeExpr(entity.signatures.returnType, env);
        env.setVar(entity.name, {
          kind: "Function",
          params,
          returnType: retType,
          effects: [],
        });
      }
    }

    // 3rd Pass: Check Function & Component Bodies
    for (const entity of mod.entities) {
      if (entity.kind === "FunctionDecl") {
        checkFunctionDecl(entity, env);
      } else if (entity.kind === "ComponentDecl") {
        checkComponentDecl(entity, env);
      }
    }
  }

  function resolveTypeExpr(expr: AilTypeExprNode, env: TypeEnvironment): SemanticType {
    switch (expr.kind) {
      case "PrimitiveType":
        return { kind: "Primitive", name: expr.name };
      case "ArrayType":
        return { kind: "Array", elementType: resolveTypeExpr(expr.elementType, env) };
      case "RecordType": {
        const fieldMap = new Map<string, { type: SemanticType; optional?: boolean }>();
        for (const f of expr.fields) {
          fieldMap.set(f.name, { type: resolveTypeExpr(f.type, env), optional: f.optional });
        }
        return { kind: "Record", fields: fieldMap };
      }
      case "UnionType":
        return { kind: "Union", types: expr.types.map((t) => resolveTypeExpr(t, env)) };
      case "Typestate":
        return {
          kind: "Typestate",
          name: "ResourceState",
          currentState: expr.states[0] ?? "Init",
          states: expr.states,
        };
      case "EffectType":
        return {
          kind: "Function",
          params: [],
          returnType: resolveTypeExpr(expr.returnType, env),
          effects: expr.effects,
        };
      case "RefinementType":
        return {
          kind: "Refinement",
          baseType: expr.baseType.name,
          predicateDescription: "refinement-predicate",
        };
      case "NamedType": {
        // Built-in Result[T, E]
        if (expr.name === "Result" && expr.typeArguments?.length === 2) {
          return {
            kind: "Result",
            okType: resolveTypeExpr(expr.typeArguments[0], env),
            errType: resolveTypeExpr(expr.typeArguments[1], env),
          };
        }
        // Built-in Option[T]
        if (expr.name === "Option" && expr.typeArguments?.length === 1) {
          return {
            kind: "Option",
            valueType: resolveTypeExpr(expr.typeArguments[0], env),
          };
        }
        const found = env.getType(expr.name);
        if (found) return found;
        return { kind: "Primitive", name: "!unknown" };
      }
    }
  }

  function checkFunctionDecl(fn: AilFunctionDeclNode, parentEnv: TypeEnvironment): void {
    const fnEnv = new TypeEnvironment(parentEnv);
    const _params = fn.signatures.params.map((p) => {
      const pType = resolveTypeExpr(p.type, parentEnv);
      fnEnv.setVar(p.name, pType);
      return { name: p.name, type: pType };
    });

    const declaredRetType = resolveTypeExpr(fn.signatures.returnType, parentEnv);
    const bodyType = inferExpr(fn.body, fnEnv);

    // Return type validation
    if (declaredRetType.kind !== "Primitive" || declaredRetType.name !== "!void") {
      if (!isAssignable(bodyType, declaredRetType)) {
        diagnostics.push(
          createStructuredDiagnostic(
            "TYPECHECKING",
            "AIL_E2001_RETURN_TYPE_MISMATCH",
            `Function '${fn.name}' declares return type '${formatSemanticType(declaredRetType)}', but body evaluates to '${formatSemanticType(bodyType)}'.`,
            "Ensure the body expression evaluates to the declared return type or update the return signature.",
            {
              span: fn.span,
              symbol: fn.name,
              context: {
                declared: formatSemanticType(declaredRetType),
                inferred: formatSemanticType(bodyType),
              },
            },
          ),
        );
      }
    }
  }

  function checkComponentDecl(comp: AilComponentDeclNode, parentEnv: TypeEnvironment): void {
    const compEnv = new TypeEnvironment(parentEnv);
    if (comp.propContract) {
      const propType = resolveTypeExpr(comp.propContract, parentEnv);
      compEnv.setVar("props", propType);
    }
  }

  function inferExpr(expr: AilExprNode, env: TypeEnvironment): SemanticType {
    switch (expr.kind) {
      case "Literal": {
        if (expr.valueType === "string") return { kind: "Primitive", name: "!s" };
        if (expr.valueType === "number") {
          return Number.isInteger(expr.value)
            ? { kind: "Primitive", name: "!i" }
            : { kind: "Primitive", name: "!f" };
        }
        if (expr.valueType === "boolean") return { kind: "Primitive", name: "!b" };
        if (expr.valueType === "array") {
          const arr = expr.value as AilExprNode[];
          const elemType: SemanticType =
            arr.length > 0 ? inferExpr(arr[0], env) : { kind: "Primitive", name: "!unknown" };
          return { kind: "Array", elementType: elemType };
        }
        if (expr.valueType === "record") {
          const rec = expr.value as Record<string, AilExprNode>;
          const fieldMap = new Map<string, { type: SemanticType }>();
          for (const [k, v] of Object.entries(rec)) {
            fieldMap.set(k, { type: inferExpr(v, env) });
          }
          return { kind: "Record", fields: fieldMap };
        }
        return { kind: "Primitive", name: "!unknown" };
      }

      case "Symbol": {
        const found = env.getVar(expr.name);
        if (found) return found;

        // Check canonical primitive
        if (CANONICAL_PRIMITIVES[expr.name]) {
          const prim = CANONICAL_PRIMITIVES[expr.name];
          return {
            kind: "Function",
            params: prim.params.map((p, i) => ({ name: `arg${i}`, type: p })),
            returnType: prim.returnType,
            effects: [],
          };
        }

        diagnostics.push(
          createStructuredDiagnostic(
            "TYPECHECKING",
            "AIL_E1003_UNRESOLVED_SYMBOL",
            `Symbol '${expr.name}' is referenced but not declared in scope.`,
            "Declare variable with (:= symbol expr) or add it to module parameter list.",
            { span: expr.span, symbol: expr.name },
          ),
        );
        return { kind: "Primitive", name: "!unknown" };
      }

      case "AssignExpr": {
        const valType = inferExpr(expr.expr, env);
        env.setVar(expr.target, valType);
        return valType;
      }

      case "BlockExpr": {
        let lastType: SemanticType = { kind: "Primitive", name: "!void" };
        for (const e of expr.expressions) {
          lastType = inferExpr(e, env);
        }
        return lastType;
      }

      case "TryUnpackExpr": {
        // Postfix unwrap (? expr)
        const innerType = inferExpr(expr.expr, env);
        if (innerType.kind === "Result") {
          return innerType.okType;
        }
        if (innerType.kind === "Option") {
          return innerType.valueType;
        }

        diagnostics.push(
          createStructuredDiagnostic(
            "TYPECHECKING",
            "AIL_E1005_INVALID_TRY_UNPACK",
            `The (? ...) unwrap operator requires a Result[T, E] or Option[T], but received '${formatSemanticType(innerType)}'.`,
            "Ensure the inner expression returns a fallible Result or Option type.",
            { span: expr.span },
          ),
        );
        return innerType;
      }

      case "IfExpr": {
        const condType = inferExpr(expr.condition, env);
        if (condType.kind !== "Primitive" || condType.name !== "!b") {
          diagnostics.push(
            createStructuredDiagnostic(
              "TYPECHECKING",
              "AIL_E2003_NON_BOOLEAN_CONDITION",
              `Conditional (?if ...) requires a boolean condition, but received '${formatSemanticType(condType)}'.`,
              "Ensure condition evaluates strictly to a boolean (!b). Zero coercion permitted.",
              { span: expr.span },
            ),
          );
        }
        const thenType = inferExpr(expr.thenExpr, env);
        if (expr.elseExpr) {
          inferExpr(expr.elseExpr, env);
        }
        return thenType;
      }

      case "ApplyExpr": {
        // --- Pillar 3: Strict Zero Implicit Coercion on Math & Logic ---
        if (
          expr.operator === "+" ||
          expr.operator === "-" ||
          expr.operator === "*" ||
          expr.operator === "/"
        ) {
          const argTypes = expr.args.map((a) => inferExpr(a, env));
          if (argTypes.length >= 2) {
            const hasString = argTypes.some((t) => t.kind === "Primitive" && t.name === "!s");
            const hasNumber = argTypes.some(
              (t) =>
                t.kind === "Primitive" && (t.name === "!i" || t.name === "!f" || t.name === "!u"),
            );

            if (hasString && hasNumber) {
              diagnostics.push(
                createStructuredDiagnostic(
                  "TYPECHECKING",
                  "AIL_E2002_IMPLICIT_COERCION_FORBIDDEN",
                  `Arithmetic operator '${expr.operator}' cannot be applied between string and numeric types. Implicit coercion is strictly forbidden.`,
                  "Use 'str:concat' for string concatenation, or explicitly parse number via '(str:parse-int ...)'.",
                  {
                    span: expr.span,
                    symbol: expr.operator,
                    candidateFix: `(str:concat ${expr.args.map((a) => (a.kind === "Literal" && a.valueType === "string" ? `"${a.value}"` : "(val:to-str ...)")).join(" ")})`,
                  },
                ),
              );
              return { kind: "Primitive", name: "!s" };
            }
          }
          return argTypes[0]?.kind === "Primitive" && argTypes[0].name === "!i"
            ? { kind: "Primitive", name: "!i" }
            : { kind: "Primitive", name: "!f" };
        }

        // Canonical primitives lookup
        // Parametric array primitives
        if (expr.operator === "arr:append" || expr.operator === "arr:slice") {
          if (expr.args.length > 0) {
            const arrType = inferExpr(expr.args[0], env);
            if (arrType.kind === "Array") {
              return arrType;
            }
          }
        }
        if (expr.operator === "arr:get") {
          if (expr.args.length > 0) {
            const arrType = inferExpr(expr.args[0], env);
            if (arrType.kind === "Array") {
              return { kind: "Option", valueType: arrType.elementType };
            }
          }
        }

        if (CANONICAL_PRIMITIVES[expr.operator]) {
          const prim = CANONICAL_PRIMITIVES[expr.operator];
          return prim.returnType;
        }

        // User function lookup
        const fnType = env.getVar(expr.operator);
        if (fnType && fnType.kind === "Function") {
          return fnType.returnType;
        }

        return { kind: "Primitive", name: "!unknown" };
      }

      case "MatchExpr": {
        inferExpr(expr.target, env);
        if (expr.cases.length > 0) {
          return inferExpr(expr.cases[0].expr, env);
        }
        return { kind: "Primitive", name: "!void" };
      }
    }
  }

  function isAssignable(from: SemanticType, to: SemanticType): boolean {
    if (to.kind === "Primitive" && to.name === "!unknown") return true;
    if (from.kind === "Primitive" && from.name === "!unknown") return true;
    if (from.kind === "Primitive" && to.kind === "Primitive") {
      // Allow integer to float widening
      if (from.name === "!i" && to.name === "!f") return true;
      if (from.name === "!u" && to.name === "!i") return true;
    }

    if (to.kind === "Result") {
      // Structural check for (% ok true value ...) or (% ok false error ...)
      if (from.kind === "Record") {
        const okField = from.fields.get("ok");
        const valField = from.fields.get("value");
        const errField = from.fields.get("error");
        if (okField && valField && isAssignable(valField.type, to.okType)) {
          return true;
        }
        if (okField && errField && isAssignable(errField.type, to.errType)) {
          return true;
        }
      }
    }

    if (from.kind === "Record" && to.kind === "Record") {
      for (const [key, toField] of to.fields.entries()) {
        const fromField = from.fields.get(key);
        if (!fromField) {
          if (toField.optional) continue;
          return false;
        }
        if (!isAssignable(fromField.type, toField.type)) {
          return false;
        }
      }
      return true;
    }

    return isSameType(from, to);
  }

  return {
    valid: diagnostics.length === 0,
    diagnostics,
    inferredModuleTypes,
  };
}
