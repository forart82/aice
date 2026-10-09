/**
 * Sound Type Checker & Refinement Solver for AIL 2.0.
 * Conforms to Section 3 of docs/AIL_SPEC.md and Pillar 4 of docs/RESEARCH_SYNTHESIS.md.
 */

import type {
  Block,
  ComponentDecl,
  Expr,
  FunctionDecl,
  Module,
  ModuleItem,
  Statement,
  TypeExpr,
} from "../core/ast.js";
import type { Span } from "../core/span.js";
import { GLOBAL_SYMBOLS, getMethodType, getPropertyType } from "./primitives.js";
import {
  formatType,
  isAssignable,
  makeArrayType,
  makeFunctionType,
  makeOptionType,
  makeRecordType,
  makeResultType,
  type RefinementTypeRep,
  TYPE_BOOL,
  TYPE_BYTE,
  TYPE_CHAR,
  TYPE_FLOAT,
  TYPE_INT,
  TYPE_NEVER,
  TYPE_NIL,
  TYPE_NUM,
  TYPE_STR,
  TYPE_UNKNOWN,
  TYPE_VOID,
  type Type,
} from "./types.js";

export class TypeCheckError extends Error {
  readonly span: Span;
  readonly code: string;
  readonly expected?: Type;
  readonly actual?: Type;

  constructor(
    message: string,
    span: Span,
    code = "AIL_E2000_TYPE_ERROR",
    expected?: Type,
    actual?: Type,
  ) {
    super(`${message} at ${span.file}:${span.start.line}:${span.start.column}`);
    this.name = "TypeCheckError";
    this.span = span;
    this.code = code;
    this.expected = expected;
    this.actual = actual;
  }
}

export class TypeEnv {
  private bindings = new Map<string, { type: Type; isMut: boolean }>();
  private types = new Map<string, Type>();
  readonly parent: TypeEnv | null;
  currentFunctionReturnType: Type | null;

  constructor(parent: TypeEnv | null = null, currentFunctionReturnType: Type | null = null) {
    this.parent = parent;
    this.currentFunctionReturnType =
      currentFunctionReturnType ?? parent?.currentFunctionReturnType ?? null;
  }

  extend(returnType: Type | null = null): TypeEnv {
    return new TypeEnv(this, returnType ?? this.currentFunctionReturnType);
  }

  define(name: string, type: Type, isMut = false): void {
    this.bindings.set(name, { type, isMut });
  }

  defineType(name: string, type: Type): void {
    this.types.set(name, type);
  }

  lookup(name: string): { type: Type; isMut: boolean } | null {
    const val = this.bindings.get(name);
    if (val) return val;
    if (this.parent) return this.parent.lookup(name);
    const globalType = GLOBAL_SYMBOLS[name];
    if (globalType) return { type: globalType, isMut: false };
    return null;
  }

  lookupType(name: string): Type | null {
    const val = this.types.get(name);
    if (val) return val;
    if (this.parent) return this.parent.lookupType(name);
    return null;
  }
}

export class TypeChecker {
  private globalEnv: TypeEnv;

  constructor() {
    this.globalEnv = new TypeEnv();
    const intrinsics = [
      "Math",
      "Number",
      "String",
      "Boolean",
      "Array",
      "Object",
      "Promise",
      "console",
      "JSON",
      "Map",
      "Set",
      "window",
      "document",
      "globalThis",
      "AudioContext",
      "AudioNode",
      "AudioBuffer",
      "Float32Array",
      "Float64Array",
      "Uint8Array",
      "Uint8ClampedArray",
      "Uint16Array",
      "Uint32Array",
      "Int8Array",
      "Int16Array",
      "Int32Array",
      "BigInt64Array",
      "BigUint64Array",
      "DataView",
      "ArrayBuffer",
      "typeof",
      "undefined",
      "NaN",
      "Infinity",
      "Date",
      "RegExp",
      "Error",
      "Symbol",
      "WeakMap",
      "WeakSet",
      "performance",
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
    ];
    for (const name of intrinsics) {
      this.globalEnv.define(name, TYPE_UNKNOWN);
      this.globalEnv.defineType(name, { kind: "named", name });
    }
  }

  checkModule(mod: Module): void {
    const env = new TypeEnv(this.globalEnv);

    // Pass 1: Declare all types and function signatures
    for (const item of mod.items) {
      this.declareItem(item, env);
    }

    // Pass 2: Typecheck bodies
    for (const item of mod.items) {
      this.checkItem(item, env);
    }
  }

  private declareItem(item: ModuleItem, env: TypeEnv): void {
    if (item.kind === "TypeDecl") {
      if (item.aliasType) {
        const resolved = this.resolveTypeExpr(item.aliasType, env);
        env.defineType(item.name, resolved);
      } else if (item.isEnum && item.variants) {
        const variants = new Map<string, Type[] | undefined>();
        for (const v of item.variants) {
          const payloads = v.payloadTypes?.map((pt) => this.resolveTypeExpr(pt, env));
          variants.set(v.name, payloads);
          if (payloads && payloads.length > 0) {
            const params = payloads.map((p, idx) => ({ name: `item${idx}`, type: p }));
            env.define(v.name, makeFunctionType(params, { kind: "named", name: item.name }));
          } else {
            env.define(v.name, { kind: "named", name: item.name });
          }
        }
        const enumRecordFields = new Map<string, Type>();
        for (const v of item.variants) {
          enumRecordFields.set(v.name, TYPE_INT);
        }
        env.define(item.name, makeRecordType(enumRecordFields, item.name));
        env.defineType(item.name, {
          kind: "enum",
          name: item.name,
          variants,
        });
      } else if (item.fields) {
        const fields = new Map<string, Type>();
        const constructorParams: { name: string; type: Type }[] = [];
        for (const f of item.fields) {
          const fType = this.resolveTypeExpr(f.typeAnnotation, env);
          fields.set(f.name, fType);
          constructorParams.push({ name: f.name, type: fType });
        }
        const recordType = makeRecordType(fields, item.name);
        env.defineType(item.name, recordType);
        // Register positional constructor in the value environment: TypeName(f1, f2, ...) -> recordType
        env.define(item.name, makeFunctionType(constructorParams, recordType));
      }
    }

    if (item.kind === "FunctionDecl") {
      const params = item.params.map((p) => ({
        name: p.name,
        type: this.resolveTypeExpr(p.typeAnnotation, env),
      }));
      const returnType = item.returnType
        ? this.resolveTypeExpr(item.returnType, env)
        : item.isExpressionBodied || this.hasTrailingExpr(item)
          ? TYPE_UNKNOWN
          : TYPE_VOID;
      env.define(item.name, makeFunctionType(params, returnType));
    }

    if (item.kind === "ComponentDecl") {
      const params = item.params.map((p) => ({
        name: p.name,
        type: this.resolveTypeExpr(p.typeAnnotation, env),
      }));
      env.define(item.name, makeFunctionType(params, TYPE_VOID));
    }

    if (item.kind === "ImportDecl") {
      for (const spec of item.specifiers) {
        if (!spec.isWildcard) {
          const symName = spec.alias ?? spec.name;
          env.define(symName, TYPE_UNKNOWN);
          env.defineType(symName, { kind: "named", name: symName });
        }
      }
    }

    if (item.kind === "ClassDecl") {
      const fields = new Map<string, Type>();
      if (item.primaryConstructor) {
        for (const p of item.primaryConstructor) {
          fields.set(p.name, this.resolveTypeExpr(p.typeAnnotation, env));
        }
      }
      for (const p of item.properties) {
        const pType = p.typeAnnotation ? this.resolveTypeExpr(p.typeAnnotation, env) : TYPE_UNKNOWN;
        fields.set(p.name, pType);
        if (p.alias) {
          fields.set(p.alias, pType);
        }
        if (p.aliases) {
          for (const a of p.aliases) {
            fields.set(a, pType);
          }
        }
      }
      for (const m of item.methods) {
        const mParams = m.params.map((p) => ({
          name: p.name,
          type: this.resolveTypeExpr(p.typeAnnotation, env),
        }));
        const mRet = m.returnType
          ? this.resolveTypeExpr(m.returnType, env)
          : m.isExpressionBodied || m.accessor === "get"
            ? TYPE_UNKNOWN
            : TYPE_VOID;
        fields.set(m.name, makeFunctionType(mParams, mRet));
        if (m.accessor === "get") {
          fields.set(`get_${m.name}`, makeFunctionType([], mRet));
          fields.set(m.name, mRet);
        } else if (m.accessor === "set") {
          fields.set(`set_${m.name}`, makeFunctionType(mParams, TYPE_VOID));
        }
      }
      const clsType = makeRecordType(fields, item.name);
      env.defineType(item.name, clsType);

      // Define constructor function in value environment
      const ctorMethod = item.methods.find((m) => m.name === "constructor");
      if (ctorMethod) {
        const ctorParams = ctorMethod.params.map((p) => ({
          name: p.name,
          type: this.resolveTypeExpr(p.typeAnnotation, env),
        }));
        env.define(item.name, makeFunctionType(ctorParams, clsType));
      } else if (item.primaryConstructor && item.primaryConstructor.length > 0) {
        const ctorParams = item.primaryConstructor.map((p) => ({
          name: p.name,
          type: this.resolveTypeExpr(p.typeAnnotation, env),
        }));
        env.define(item.name, makeFunctionType(ctorParams, clsType));
      } else {
        env.define(item.name, makeFunctionType([], clsType));
      }
    }

    if (item.kind === "ConstDecl" || item.kind === "VarDecl") {
      const type = item.typeAnnotation
        ? this.resolveTypeExpr(item.typeAnnotation, env)
        : TYPE_UNKNOWN;
      env.define(item.name, type, item.kind === "VarDecl" ? item.isMut : false);
    }
  }

  private hasTrailingExpr(fn: FunctionDecl): boolean {
    if (fn.name === "__top_level__") return false;
    if (fn.isExpressionBodied) return true;
    if (fn.body.kind === "Block") {
      const stmts = fn.body.statements;
      if (stmts.length === 0) return false;
      const last = stmts[stmts.length - 1];
      if (last.kind === "ExprStmt") return true;
      if (last.kind === "IfStmt" && last.elseBranch) {
        const thenLast = last.thenBranch.statements[last.thenBranch.statements.length - 1];
        return thenLast?.kind === "ExprStmt";
      }
    }
    return false;
  }

  private checkItem(item: ModuleItem, env: TypeEnv): void {
    if (item.kind === "FunctionDecl") {
      this.checkFunctionDecl(item, env);
    } else if (item.kind === "ComponentDecl") {
      this.checkComponentDecl(item, env);
    } else if (item.kind === "ClassDecl") {
      const classEnv = env.extend();
      classEnv.define("this", { kind: "named", name: item.name });
      if (item.primaryConstructor) {
        for (const p of item.primaryConstructor) {
          const pType = this.resolveTypeExpr(p.typeAnnotation, classEnv);
          classEnv.define(p.name, pType, true);
        }
      }
      for (const p of item.properties) {
        const pType = p.typeAnnotation
          ? this.resolveTypeExpr(p.typeAnnotation, classEnv)
          : TYPE_UNKNOWN;
        classEnv.define(p.name, pType, !p.isReadonly);
        if (p.alias) {
          classEnv.define(p.alias, pType, !p.isReadonly);
        }
        if (p.aliases) {
          for (const a of p.aliases) {
            classEnv.define(a, pType, !p.isReadonly);
          }
        }
      }
      for (const m of item.methods) {
        const retType = m.returnType
          ? this.resolveTypeExpr(m.returnType, classEnv)
          : m.isExpressionBodied || m.accessor === "get"
            ? TYPE_UNKNOWN
            : TYPE_VOID;
        const methodEnv = classEnv.extend(retType);
        for (const p of m.params) {
          methodEnv.define(p.name, this.resolveTypeExpr(p.typeAnnotation, classEnv), true);
        }
        if (m.body.kind === "Block") {
          const trailingType = this.checkBlock(m.body, methodEnv);
          const stmts = m.body.statements;
          if (stmts.length > 0) {
            const last = stmts[stmts.length - 1];
            if (last.kind === "ExprStmt") {
              if (m.returnType) {
                if (
                  retType.kind !== "void" &&
                  m.accessor !== "set" &&
                  !isAssignable(retType, trailingType)
                ) {
                  throw new TypeCheckError(
                    `Trailing expression evaluates to '${formatType(trailingType)}', but method '${m.name}' declares return type '${formatType(retType)}'`,
                    last.expr.span,
                    "AIL_E2007_RETURN_TYPE_MISMATCH",
                    retType,
                    trailingType,
                  );
                }
              }
            } else if (last.kind === "IfStmt" && last.elseBranch) {
              if (m.returnType) {
                if (
                  retType.kind !== "void" &&
                  m.accessor !== "set" &&
                  !isAssignable(retType, trailingType)
                ) {
                  throw new TypeCheckError(
                    `Trailing expression in conditional branch evaluates to '${formatType(trailingType)}', but method '${m.name}' declares return type '${formatType(retType)}'`,
                    last.span,
                    "AIL_E2007_RETURN_TYPE_MISMATCH",
                    retType,
                    trailingType,
                  );
                }
              }
            }
          }
        } else {
          const bodyType = this.checkExpr(m.body, methodEnv);
          if (retType.kind !== "void" && m.accessor !== "set" && m.body.kind !== "AssignExpr") {
            if (!isAssignable(retType, bodyType)) {
              throw new TypeCheckError(
                `Method '${m.name}' returns '${formatType(bodyType)}', but declared '${formatType(retType)}'`,
                m.body.span,
                "AIL_E2007_RETURN_TYPE_MISMATCH",
                retType,
                bodyType,
              );
            }
          }
        }
      }
    } else if (item.kind === "ConstDecl" || item.kind === "VarDecl") {
      const valType = this.checkExpr(item.value, env);
      if (item.typeAnnotation) {
        const declType = this.resolveTypeExpr(item.typeAnnotation, env);
        if (!isAssignable(declType, valType)) {
          throw new TypeCheckError(
            `Cannot assign value of type '${formatType(valType)}' to variable '${item.name}' of type '${formatType(declType)}'`,
            item.span,
            "AIL_E2002_TYPE_MISMATCH",
            declType,
            valType,
          );
        }
      }
    }
  }

  private checkFunctionDecl(fn: FunctionDecl, parentEnv: TypeEnv): void {
    let returnType = fn.returnType
      ? this.resolveTypeExpr(fn.returnType, parentEnv)
      : fn.isExpressionBodied || this.hasTrailingExpr(fn)
        ? TYPE_UNKNOWN
        : TYPE_VOID;

    const fnEnv = new TypeEnv(parentEnv, returnType);

    for (const p of fn.params) {
      const pType = this.resolveTypeExpr(p.typeAnnotation, parentEnv);
      if (p.defaultValue) {
        const defType = this.checkExpr(p.defaultValue, parentEnv);
        if (!isAssignable(pType, defType)) {
          throw new TypeCheckError(
            `Default parameter value of type '${formatType(defType)}' is not assignable to parameter '${p.name}' of type '${formatType(pType)}'`,
            p.defaultValue.span,
            "AIL_E2002_TYPE_MISMATCH",
            pType,
            defType,
          );
        }
      }
      fnEnv.define(p.name, pType, true);
    }

    if (fn.isExpressionBodied) {
      const bodyType = this.checkExpr(fn.body as Expr, fnEnv);
      if (fn.returnType) {
        if (
          returnType.kind !== "void" &&
          (fn.body as Expr).kind !== "AssignExpr" &&
          !isAssignable(returnType, bodyType)
        ) {
          throw new TypeCheckError(
            `Expression body evaluates to '${formatType(bodyType)}', but function '${fn.name}' declares return type '${formatType(returnType)}'`,
            (fn.body as Expr).span,
            "AIL_E2007_RETURN_TYPE_MISMATCH",
            returnType,
            bodyType,
          );
        }
      } else {
        // Infer return type and update signature in parentEnv
        returnType = bodyType;
        const existing = parentEnv.lookup(fn.name);
        if (existing && existing.type.kind === "function") {
          existing.type.returnType = bodyType;
        }
      }
    } else {
      const trailingType = this.checkBlock(fn.body as Block, fnEnv);

      // Trailing return inference / verification for block bodies
      const stmts = (fn.body as Block).statements;
      if (stmts.length > 0) {
        const last = stmts[stmts.length - 1];
        if (last.kind === "ExprStmt") {
          if (fn.returnType) {
            if (returnType.kind !== "void" && !isAssignable(returnType, trailingType)) {
              throw new TypeCheckError(
                `Trailing expression evaluates to '${formatType(trailingType)}', but function '${fn.name}' declares return type '${formatType(returnType)}'`,
                last.expr.span,
                "AIL_E2007_RETURN_TYPE_MISMATCH",
                returnType,
                trailingType,
              );
            }
          } else if (fn.name !== "__top_level__" && trailingType.kind !== "void") {
            returnType = trailingType;
            const existing = parentEnv.lookup(fn.name);
            if (existing && existing.type.kind === "function") {
              existing.type.returnType = trailingType;
            }
          }
        } else if (last.kind === "IfStmt" && last.elseBranch) {
          if (fn.returnType) {
            if (returnType.kind !== "void" && !isAssignable(returnType, trailingType)) {
              throw new TypeCheckError(
                `Trailing expression in conditional branch evaluates to '${formatType(trailingType)}', but function '${fn.name}' declares return type '${formatType(returnType)}'`,
                last.span,
                "AIL_E2007_RETURN_TYPE_MISMATCH",
                returnType,
                trailingType,
              );
            }
          } else if (fn.name !== "__top_level__" && trailingType.kind !== "void") {
            returnType = trailingType;
            const existing = parentEnv.lookup(fn.name);
            if (existing && existing.type.kind === "function") {
              existing.type.returnType = trailingType;
            }
          }
        }
      }
    }
  }

  private checkComponentDecl(comp: ComponentDecl, parentEnv: TypeEnv): void {
    const compEnv = new TypeEnv(parentEnv, TYPE_VOID);
    for (const p of comp.params) {
      const pType = this.resolveTypeExpr(p.typeAnnotation, parentEnv);
      compEnv.define(p.name, pType, false);
    }

    for (const node of comp.layout) {
      for (const attr of node.attributes) {
        this.checkExpr(attr.value, compEnv);
      }
    }
  }

  private checkBlock(block: Block, env: TypeEnv): Type {
    const blockEnv = new TypeEnv(env);
    let trailingType: Type = TYPE_VOID;
    for (const stmt of block.statements) {
      trailingType = this.checkStatement(stmt, blockEnv);
    }
    return trailingType;
  }

  private checkStatement(stmt: Statement, env: TypeEnv): Type {
    switch (stmt.kind) {
      case "LetBinding": {
        const initType = this.checkExpr(stmt.init, env);
        let declaredType = initType;

        if (stmt.typeAnnotation) {
          declaredType = this.resolveTypeExpr(stmt.typeAnnotation, env);
          if (!isAssignable(declaredType, initType)) {
            throw new TypeCheckError(
              `Cannot assign value of type '${formatType(initType)}' to variable '${stmt.name}' of type '${formatType(declaredType)}'`,
              stmt.span,
              "AIL_E2002_TYPE_MISMATCH",
              declaredType,
              initType,
            );
          }
        }

        // Refinement checking for numeric literal bounds
        if (
          declaredType.kind === "refinement" &&
          stmt.init.kind === "LiteralExpr" &&
          typeof stmt.init.value === "number"
        ) {
          this.checkRefinementBounds(declaredType, stmt.init.value, stmt.span);
        }

        env.define(stmt.name, declaredType, stmt.isMut);
        return TYPE_VOID;
      }

      case "DestructureBinding": {
        const initType = this.checkExpr(stmt.init, env);
        let elemType: Type = TYPE_UNKNOWN;
        if (initType.kind === "array") {
          elemType = initType.elementType;
        }
        if (stmt.init.kind === "ArrayLiteralExpr") {
          for (let i = 0; i < stmt.names.length; i++) {
            const name = stmt.names[i];
            const elemExpr = stmt.init.elements[i];
            const t = elemExpr ? this.checkExpr(elemExpr, env) : elemType;
            env.define(name, t, stmt.isMut);
          }
        } else {
          for (const name of stmt.names) {
            env.define(name, elemType, stmt.isMut);
          }
        }
        return TYPE_VOID;
      }

      case "AssignStmt": {
        this.checkAssign(stmt.target, stmt.value, stmt.span, env);
        return TYPE_VOID;
      }

      case "ReturnStmt": {
        const expected = env.currentFunctionReturnType ?? TYPE_VOID;
        const actual = stmt.value ? this.checkExpr(stmt.value, env) : TYPE_VOID;

        if (!isAssignable(expected, actual)) {
          throw new TypeCheckError(
            `Return expression of type '${formatType(actual)}' does not match function return type '${formatType(expected)}'`,
            stmt.span,
            "AIL_E2007_RETURN_TYPE_MISMATCH",
            expected,
            actual,
          );
        }
        return actual;
      }

      case "IfStmt": {
        // Strict Boolean Condition Invariant
        const condType = this.checkExpr(stmt.condition, env);
        if (
          !isAssignable(TYPE_BOOL, condType) &&
          condType.kind !== "option" &&
          condType.kind !== "named" &&
          condType.kind !== "record"
        ) {
          throw new TypeCheckError(
            `Condition in 'if' statement must evaluate strictly to 'bool', got '${formatType(condType)}'. Zero implicit coercion allowed.`,
            stmt.condition.span,
            "AIL_E2001_NON_BOOLEAN_CONDITION",
            TYPE_BOOL,
            condType,
          );
        }

        const thenType = this.checkBlock(stmt.thenBranch, env);

        for (const elif of stmt.elifBranches) {
          const elifCondType = this.checkExpr(elif.condition, env);
          if (
            !isAssignable(TYPE_BOOL, elifCondType) &&
            elifCondType.kind !== "option" &&
            elifCondType.kind !== "named" &&
            elifCondType.kind !== "record"
          ) {
            throw new TypeCheckError(
              `Condition in 'elif' statement must evaluate strictly to 'bool', got '${formatType(elifCondType)}'. Zero implicit coercion allowed.`,
              elif.condition.span,
              "AIL_E2001_NON_BOOLEAN_CONDITION",
              TYPE_BOOL,
              elifCondType,
            );
          }
          this.checkBlock(elif.body, env);
        }

        if (stmt.elseBranch) {
          const elseType = this.checkBlock(stmt.elseBranch, env);
          if (stmt.elifBranches.length === 0 && isAssignable(thenType, elseType)) {
            return thenType;
          }
        }
        return thenType;
      }

      case "MatchStmt": {
        const targetType = this.checkExpr(stmt.target, env);
        let matchResultType: Type = TYPE_VOID;
        for (const c of stmt.cases) {
          const caseEnv = new TypeEnv(env);
          if (c.pattern.kind === "IdentifierPattern" && c.pattern.name !== "_") {
            caseEnv.define(c.pattern.name, targetType);
          }
          if (c.guard) {
            const guardType = this.checkExpr(c.guard, caseEnv);
            if (!isAssignable(TYPE_BOOL, guardType)) {
              throw new TypeCheckError(
                `Match guard must evaluate to 'bool', got '${formatType(guardType)}'`,
                c.guard.span,
                "AIL_E2001_NON_BOOLEAN_CONDITION",
              );
            }
          }
          if (c.body.kind === "Block") {
            matchResultType = this.checkBlock(c.body, caseEnv);
          } else {
            matchResultType = this.checkExpr(c.body, caseEnv);
          }
        }
        return matchResultType;
      }

      case "ForStmt": {
        const iterType = this.checkExpr(stmt.iterable, env);
        const loopEnv = new TypeEnv(env);

        if (stmt.variable.startsWith("[") && stmt.variable.endsWith("]")) {
          const names = stmt.variable
            .slice(1, -1)
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
          for (const n of names) {
            loopEnv.define(n, TYPE_UNKNOWN, false);
          }
        } else {
          const elemType = iterType.kind === "array" ? iterType.elementType : TYPE_UNKNOWN;
          loopEnv.define(stmt.variable, elemType, false);
        }

        if (iterType.kind !== "unknown" && iterType.kind !== "array") {
          throw new TypeCheckError(
            `Cannot iterate over non-array type '${formatType(iterType)}'`,
            stmt.iterable.span,
            "AIL_E2009_NON_ITERABLE_TYPE",
          );
        }

        this.checkBlock(stmt.body, loopEnv);
        return TYPE_VOID;
      }

      case "WhileStmt": {
        const condType = this.checkExpr(stmt.condition, env);
        if (!isAssignable(TYPE_BOOL, condType)) {
          throw new TypeCheckError(
            `Condition in 'while' statement must evaluate strictly to 'bool', got '${formatType(condType)}'. Zero implicit coercion allowed.`,
            stmt.condition.span,
            "AIL_E2001_NON_BOOLEAN_CONDITION",
            TYPE_BOOL,
            condType,
          );
        }
        this.checkBlock(stmt.body, env);
        return TYPE_VOID;
      }

      case "ExprStmt": {
        return this.checkExpr(stmt.expr, env);
      }
    }
  }

  checkExpr(expr: Expr, env: TypeEnv): Type {
    switch (expr.kind) {
      case "LiteralExpr": {
        if (expr.literalKind === "number") {
          if (
            expr.rawValue &&
            (expr.rawValue.includes(".") ||
              expr.rawValue.includes("e") ||
              expr.rawValue.includes("E"))
          ) {
            return TYPE_FLOAT;
          }
          return typeof expr.value === "number" && Number.isInteger(expr.value)
            ? TYPE_INT
            : TYPE_FLOAT;
        }
        if (expr.literalKind === "string") return TYPE_STR;
        if (expr.literalKind === "boolean") return TYPE_BOOL;
        if (expr.literalKind === "nil") return TYPE_NIL;
        return TYPE_UNKNOWN;
      }

      case "IdentifierExpr": {
        const binding = env.lookup(expr.name);
        if (!binding) {
          throw new TypeCheckError(
            `Undeclared identifier '${expr.name}'`,
            expr.span,
            "AIL_E2008_UNDECLARED_VARIABLE",
          );
        }
        return binding.type;
      }

      case "BinaryExpr": {
        const leftType = this.checkExpr(expr.left, env);
        const rightType = this.checkExpr(expr.right, env);

        // Zero Implicit Coercion Checks
        switch (expr.operator) {
          case "+":
            if (leftType.kind === "unknown" || rightType.kind === "unknown") {
              return TYPE_UNKNOWN;
            }
            if (leftType.kind === "str" && rightType.kind === "str") {
              return TYPE_STR;
            }
            if (isNumeric(leftType) && isNumeric(rightType)) {
              return leftType.kind === "float" || rightType.kind === "float"
                ? TYPE_FLOAT
                : TYPE_INT;
            }
            throw new TypeCheckError(
              `Operator '+' cannot be applied to disparate types '${formatType(leftType)}' and '${formatType(rightType)}'. Explicit conversion required.`,
              expr.span,
              "AIL_E2002_TYPE_MISMATCH",
            );

          case "-":
          case "*":
          case "%":
            if (leftType.kind === "unknown" || rightType.kind === "unknown") {
              return TYPE_UNKNOWN;
            }
            if (isNumeric(leftType) && isNumeric(rightType)) {
              return leftType.kind === "float" || rightType.kind === "float"
                ? TYPE_FLOAT
                : TYPE_INT;
            }
            throw new TypeCheckError(
              `Operator '${expr.operator}' requires numeric operands, got '${formatType(leftType)}' and '${formatType(rightType)}'`,
              expr.span,
              "AIL_E2002_TYPE_MISMATCH",
            );

          case "/":
            // Compile-time literal zero division check
            if (
              expr.right.kind === "LiteralExpr" &&
              (expr.right.value === 0 || expr.right.value === "0")
            ) {
              throw new TypeCheckError(
                "Division by zero detected at compile time",
                expr.right.span,
                "AIL_E2003_DIVISION_BY_ZERO",
              );
            }
            if (leftType.kind === "unknown" || rightType.kind === "unknown") {
              return TYPE_UNKNOWN;
            }
            if (isNumeric(leftType) && isNumeric(rightType)) {
              return TYPE_FLOAT;
            }
            throw new TypeCheckError(
              `Division requires numeric operands, got '${formatType(leftType)}' and '${formatType(rightType)}'`,
              expr.span,
              "AIL_E2002_TYPE_MISMATCH",
            );

          case "==":
          case "!=":
            return TYPE_BOOL;

          case "<":
          case "<=":
          case ">":
          case ">=": {
            const l = leftType.kind === "option" ? leftType.innerType : leftType;
            const r = rightType.kind === "option" ? rightType.innerType : rightType;
            if (l.kind === "unknown" || r.kind === "unknown") {
              return TYPE_BOOL;
            }
            if ((isNumeric(l) && isNumeric(r)) || (l.kind === "str" && r.kind === "str")) {
              return TYPE_BOOL;
            }
            throw new TypeCheckError(
              `Comparison '${expr.operator}' cannot compare '${formatType(leftType)}' with '${formatType(rightType)}'`,
              expr.span,
              "AIL_E2002_TYPE_MISMATCH",
            );
          }

          case "and":
          case "&&": {
            if (leftType.kind === "unknown" || rightType.kind === "unknown") {
              return TYPE_UNKNOWN;
            }
            const leftConditionOk =
              isAssignable(TYPE_BOOL, leftType) ||
              leftType.kind === "option" ||
              leftType.kind === "named" ||
              leftType.kind === "record" ||
              leftType.kind === "array";

            if (leftConditionOk) {
              if (isAssignable(TYPE_BOOL, rightType) || rightType.kind === "option") {
                return TYPE_BOOL;
              }
              // Short-circuit: cond and value (returns type of right operand)
              return rightType;
            }
            return TYPE_BOOL;
          }

          case "or":
          case "||": {
            if (leftType.kind === "unknown" || rightType.kind === "unknown") {
              return TYPE_UNKNOWN;
            }
            if (leftType.kind === "nil") {
              return makeOptionType(rightType);
            }
            if (rightType.kind === "nil") {
              return makeOptionType(leftType);
            }
            if (isAssignable(leftType, rightType)) {
              return leftType;
            }
            if (isAssignable(rightType, leftType)) {
              return rightType;
            }
            if (isNumeric(rightType)) {
              return rightType;
            }
            if (isNumeric(leftType)) {
              return leftType;
            }
            return rightType;
          }

          case "??":
            // Null coalescing: left: Option[T], right: T -> T
            if (leftType.kind === "option") {
              if (isAssignable(leftType.innerType, rightType)) {
                return leftType.innerType;
              }
            }
            return leftType;
        }
        break;
      }

      case "UnaryExpr": {
        const opType = this.checkExpr(expr.operand, env);
        if (opType.kind === "unknown") {
          return TYPE_UNKNOWN;
        }
        if (expr.operator === "-" && isNumeric(opType)) {
          return opType;
        }
        if (expr.operator === "not" || expr.operator === "!") {
          if (
            isAssignable(TYPE_BOOL, opType) ||
            opType.kind === "option" ||
            opType.kind === "named" ||
            opType.kind === "array" ||
            opType.kind === "record" ||
            (opType as any).kind === "unknown"
          ) {
            return TYPE_BOOL;
          }
        }
        throw new TypeCheckError(
          `Unary '${expr.operator}' cannot be applied to type '${formatType(opType)}'`,
          expr.span,
          "AIL_E2002_TYPE_MISMATCH",
        );
      }

      case "CallExpr": {
        // Special case for method calls: obj.method(args)
        if (expr.callee.kind === "MemberAccessExpr") {
          const receiverType = this.checkExpr(expr.callee.object, env);
          const methodType = getMethodType(receiverType, expr.callee.property);
          if (methodType && methodType.kind === "function") {
            return this.typecheckInvocation(methodType, expr.args, expr.span, env);
          }
        }

        // Generic algebraic constructors: Ok, Err, Some
        if (
          expr.callee.kind === "IdentifierExpr" &&
          expr.callee.name === "Ok" &&
          expr.args.length === 1
        ) {
          const valType = this.checkExpr(expr.args[0], env);
          return makeResultType(valType, TYPE_NEVER);
        }
        if (
          expr.callee.kind === "IdentifierExpr" &&
          expr.callee.name === "Err" &&
          expr.args.length === 1
        ) {
          const errType = this.checkExpr(expr.args[0], env);
          return makeResultType(TYPE_NEVER, errType);
        }
        if (
          expr.callee.kind === "IdentifierExpr" &&
          expr.callee.name === "Some" &&
          expr.args.length === 1
        ) {
          const valType = this.checkExpr(expr.args[0], env);
          return makeOptionType(valType);
        }

        const calleeType = this.checkExpr(expr.callee, env);
        if (calleeType.kind === "unknown") {
          return TYPE_UNKNOWN;
        }
        if (calleeType.kind === "option") {
          if (calleeType.innerType.kind === "unknown") {
            return TYPE_UNKNOWN;
          }
          if (calleeType.innerType.kind === "function") {
            return this.typecheckInvocation(calleeType.innerType, expr.args, expr.span, env);
          }
        }
        if (calleeType.kind === "named") {
          if (
            calleeType.name.includes("=>") ||
            calleeType.name.includes("->") ||
            calleeType.name === "Function"
          ) {
            return TYPE_UNKNOWN;
          }
        }
        if (calleeType.kind !== "function") {
          throw new TypeCheckError(
            `Cannot call non-function of type '${formatType(calleeType)}'`,
            expr.callee.span,
            "AIL_E2010_NOT_CALLABLE",
          );
        }

        return this.typecheckInvocation(calleeType, expr.args, expr.span, env);
      }

      case "MemberAccessExpr": {
        const objType = this.checkExpr(expr.object, env);
        if (objType.kind === "unknown") {
          return TYPE_UNKNOWN;
        }
        const effectiveType = objType.kind === "option" ? objType.innerType : objType;
        if (effectiveType.kind === "unknown") {
          return TYPE_UNKNOWN;
        }
        const propType = getPropertyType(effectiveType, expr.property);
        if (propType) {
          return expr.isSafeNav || objType.kind === "option" ? makeOptionType(propType) : propType;
        }
        const methodType = getMethodType(effectiveType, expr.property);
        if (methodType) {
          return methodType;
        }
        if (effectiveType.kind === "named") {
          return TYPE_UNKNOWN;
        }
        throw new TypeCheckError(
          `Property '${expr.property}' does not exist on type '${formatType(objType)}'`,
          expr.span,
          "AIL_E2011_UNKNOWN_PROPERTY",
        );
      }

      case "IndexExpr": {
        const objType = this.checkExpr(expr.object, env);
        const idxType = this.checkExpr(expr.index, env);

        if (objType.kind === "unknown") {
          return TYPE_UNKNOWN;
        }

        if (objType.kind === "named") {
          return TYPE_UNKNOWN;
        }

        if (objType.kind === "record") {
          if (
            idxType.kind === "str" &&
            expr.index.kind === "LiteralExpr" &&
            typeof expr.index.value === "string"
          ) {
            return objType.fields.get(expr.index.value) ?? TYPE_UNKNOWN;
          }
          return TYPE_UNKNOWN;
        }

        if (objType.kind === "array") {
          if (!isAssignable(TYPE_INT, idxType) && idxType.kind !== "unknown") {
            throw new TypeCheckError(
              `Array index must be of type 'int', got '${formatType(idxType)}'`,
              expr.index.span,
              "AIL_E2002_TYPE_MISMATCH",
              TYPE_INT,
              idxType,
            );
          }
          return objType.elementType;
        }

        throw new TypeCheckError(
          `Cannot index non-array type '${formatType(objType)}'`,
          expr.object.span,
          "AIL_E2012_NOT_INDEXABLE",
        );
      }

      case "ArrayLiteralExpr": {
        if (expr.elements.length === 0) {
          return makeArrayType(TYPE_UNKNOWN);
        }
        const firstType = this.checkExpr(expr.elements[0], env);
        for (let i = 1; i < expr.elements.length; i++) {
          const nextType = this.checkExpr(expr.elements[i], env);
          if (!isAssignable(firstType, nextType)) {
            throw new TypeCheckError(
              `Array element at index ${i} has type '${formatType(nextType)}', inconsistent with element type '${formatType(firstType)}'`,
              expr.elements[i].span,
              "AIL_E2002_TYPE_MISMATCH",
              firstType,
              nextType,
            );
          }
        }
        return makeArrayType(firstType);
      }

      case "RecordLiteralExpr": {
        const fields = new Map<string, Type>();
        for (const prop of expr.properties) {
          const valType = this.checkExpr(prop.value, env);
          if (prop.isSpread) {
            if (valType.kind === "record") {
              for (const [k, v] of valType.fields) {
                fields.set(k, v);
              }
            } else if (valType.kind === "named") {
              const resolved = env.lookupType(valType.name);
              if (resolved?.kind === "record") {
                for (const [k, v] of resolved.fields) {
                  fields.set(k, v);
                }
              }
            }
          } else if (prop.key) {
            fields.set(prop.key, valType);
          }
        }
        return makeRecordType(fields);
      }

      case "PostfixTryExpr": {
        // Postfix ? Try unwrap operator
        const operandType = this.checkExpr(expr.operand, env);

        if (operandType.kind === "result") {
          const currentFnRet = env.currentFunctionReturnType;
          if (currentFnRet?.kind !== "result") {
            throw new TypeCheckError(
              `Cannot use '?' unwrap on Result[T, E] inside a function that returns '${formatType(currentFnRet ?? TYPE_VOID)}'. Function must return a compatible Result[T, ${formatType(operandType.errType)}].`,
              expr.span,
              "AIL_E2004_CANNOT_UNWRAP_RESULT",
            );
          }

          if (!isAssignable(currentFnRet.errType, operandType.errType)) {
            throw new TypeCheckError(
              `Error type '${formatType(operandType.errType)}' in '?' unwrap cannot be returned by function expecting error type '${formatType(currentFnRet.errType)}'`,
              expr.span,
              "AIL_E2004_CANNOT_UNWRAP_RESULT",
              currentFnRet.errType,
              operandType.errType,
            );
          }

          return operandType.okType;
        }

        if (operandType.kind === "option") {
          return operandType.innerType;
        }

        if (operandType.kind === "unknown") {
          const currentFnRet = env.currentFunctionReturnType;
          if (currentFnRet?.kind === "result") {
            return currentFnRet.okType;
          }
          if (currentFnRet?.kind === "option") {
            return currentFnRet.innerType;
          }
          throw new TypeCheckError(
            `Cannot use '?' unwrap on Result[T, E] inside a function that returns '${formatType(currentFnRet ?? TYPE_VOID)}'. Function must return a compatible Result[T, E].`,
            expr.span,
            "AIL_E2004_CANNOT_UNWRAP_RESULT",
          );
        }

        throw new TypeCheckError(
          `Postfix '?' unwrap can only be applied to 'Result' or 'Option' types, got '${formatType(operandType)}'`,
          expr.span,
          "AIL_E2004_CANNOT_UNWRAP_RESULT",
        );
      }

      case "ClosureExpr": {
        const params = expr.params.map((p) => ({
          name: p.name,
          type: this.resolveTypeExpr(p.typeAnnotation, env),
        }));
        let returnType = expr.returnType ? this.resolveTypeExpr(expr.returnType, env) : undefined;

        const closureEnv = new TypeEnv(env, returnType ?? TYPE_VOID);
        for (const p of params) {
          closureEnv.define(p.name, p.type, true);
        }

        if (expr.body.kind === "Block") {
          this.checkBlock(expr.body, closureEnv);
        } else {
          const bodyType = this.checkExpr(expr.body, closureEnv);
          if (returnType) {
            if (!isAssignable(returnType, bodyType)) {
              throw new TypeCheckError(
                `Closure body evaluates to '${formatType(bodyType)}', but returns '${formatType(returnType)}'`,
                expr.body.span,
                "AIL_E2007_RETURN_TYPE_MISMATCH",
                returnType,
                bodyType,
              );
            }
          } else {
            returnType = bodyType;
          }
        }

        return makeFunctionType(params, returnType ?? TYPE_VOID);
      }

      case "AssignExpr": {
        return this.checkAssign(expr.target, expr.value, expr.span, env);
      }
    }
  }

  private checkAssign(target: Expr, value: Expr, span: Span, env: TypeEnv): Type {
    if (target.kind === "IdentifierExpr") {
      const binding = env.lookup(target.name);
      if (!binding) {
        throw new TypeCheckError(
          `Cannot assign to undeclared identifier '${target.name}'`,
          target.span,
          "AIL_E2008_UNDECLARED_VARIABLE",
        );
      }
      if (!binding.isMut) {
        throw new TypeCheckError(
          `Cannot assign to immutable variable '${target.name}'. Declare with 'let mut ${target.name}' to allow mutation.`,
          span,
          "AIL_E2005_IMMUTABLE_ASSIGNMENT",
        );
      }
      const valType = this.checkExpr(value, env);
      if (!isAssignable(binding.type, valType)) {
        throw new TypeCheckError(
          `Cannot assign '${formatType(valType)}' to variable '${target.name}' of type '${formatType(binding.type)}'`,
          span,
          "AIL_E2002_TYPE_MISMATCH",
          binding.type,
          valType,
        );
      }
      return valType;
    } else if (target.kind === "ArrayLiteralExpr") {
      const valType = this.checkExpr(value, env);
      if (value.kind === "ArrayLiteralExpr") {
        for (let i = 0; i < target.elements.length; i++) {
          const tElem = target.elements[i];
          const vElem = value.elements[i];
          if (tElem && vElem) {
            this.checkAssign(tElem, vElem, span, env);
          }
        }
      } else {
        for (const tElem of target.elements) {
          if (tElem.kind === "IdentifierExpr") {
            const binding = env.lookup(tElem.name);
            if (!binding) {
              throw new TypeCheckError(
                `Cannot assign to undeclared identifier '${tElem.name}'`,
                tElem.span,
                "AIL_E2008_UNDECLARED_VARIABLE",
              );
            }
            if (!binding.isMut) {
              throw new TypeCheckError(
                `Cannot assign to immutable variable '${tElem.name}'. Declare with 'let mut ${tElem.name}' or '::=' to allow mutation.`,
                span,
                "AIL_E2005_IMMUTABLE_ASSIGNMENT",
              );
            }
          }
        }
      }
      return valType;
    } else {
      const targetType = this.checkExpr(target, env);
      const valType = this.checkExpr(value, env);
      if (!isAssignable(targetType, valType)) {
        throw new TypeCheckError(
          `Cannot assign '${formatType(valType)}' to target of type '${formatType(targetType)}'`,
          span,
          "AIL_E2002_TYPE_MISMATCH",
          targetType,
          valType,
        );
      }
      return valType;
    }
  }

  private typecheckInvocation(
    fnType: { params: { name: string; type: Type; optional?: boolean }[]; returnType: Type },
    args: Expr[],
    span: Span,
    env: TypeEnv,
  ): Type {
    const minParams = fnType.params.filter((p) => !p.optional).length;
    if (args.length < minParams || args.length > fnType.params.length) {
      throw new TypeCheckError(
        `Function expects between ${minParams} and ${fnType.params.length} arguments, got ${args.length}`,
        span,
        "AIL_E2013_ARGUMENT_COUNT_MISMATCH",
      );
    }

    for (let i = 0; i < args.length; i++) {
      const argType = this.checkExpr(args[i], env);
      const expectedType = fnType.params[i].type;
      if (!isAssignable(expectedType, argType)) {
        throw new TypeCheckError(
          `Argument ${i + 1} of type '${formatType(argType)}' is not assignable to expected type '${formatType(expectedType)}'`,
          args[i].span,
          "AIL_E2002_TYPE_MISMATCH",
          expectedType,
          argType,
        );
      }
    }

    return fnType.returnType;
  }

  private resolveTypeExpr(typeExpr: TypeExpr, env: TypeEnv): Type {
    switch (typeExpr.kind) {
      case "PrimitiveType": {
        const map: Record<string, Type> = {
          int: TYPE_INT,
          str: TYPE_STR,
          float: TYPE_FLOAT,
          bool: TYPE_BOOL,
          num: TYPE_NUM,
          byte: TYPE_BYTE,
          char: TYPE_CHAR,
          void: TYPE_VOID,
          nil: TYPE_NIL,
        };
        return map[typeExpr.primitive] ?? TYPE_UNKNOWN;
      }
      case "ArrayType":
        return makeArrayType(this.resolveTypeExpr(typeExpr.elementType, env));
      case "OptionType":
        return makeOptionType(this.resolveTypeExpr(typeExpr.innerType, env));
      case "ResultType":
        return makeResultType(
          this.resolveTypeExpr(typeExpr.okType, env),
          this.resolveTypeExpr(typeExpr.errType, env),
        );
      case "RecordType": {
        const fields = new Map<string, Type>();
        for (const f of typeExpr.fields) {
          fields.set(f.name, this.resolveTypeExpr(f.type, env));
        }
        return makeRecordType(fields);
      }
      case "RefinementType":
        return {
          kind: "refinement",
          param: typeExpr.param,
          baseType: this.resolveTypeExpr(typeExpr.baseType, env),
          predicateExpr: typeExpr.predicate,
        };
      case "NamedType": {
        if (typeExpr.name === "unknown" || typeExpr.name === "any") {
          return TYPE_UNKNOWN;
        }
        const resolved = env.lookupType(typeExpr.name);
        if (resolved) return resolved;
        return {
          kind: "named",
          name: typeExpr.name,
          typeArgs: typeExpr.typeArgs?.map((ta) => this.resolveTypeExpr(ta, env)),
        };
      }
    }
  }

  private checkRefinementBounds(refType: RefinementTypeRep, val: number, span: Span): void {
    // Lightweight linear bounds solver over predicate (e.g. p >= 1 and p <= 65535)
    // Extract min/max bounds if available
    const pred = refType.predicateExpr;
    if (pred && pred.kind === "BinaryExpr" && pred.operator === "and") {
      const left = pred.left;
      const right = pred.right;

      let minBound: number | undefined;
      let maxBound: number | undefined;

      if (
        left.kind === "BinaryExpr" &&
        left.operator === ">=" &&
        left.right.kind === "LiteralExpr"
      ) {
        minBound = Number(left.right.value);
      }
      if (
        right.kind === "BinaryExpr" &&
        right.operator === "<=" &&
        right.right.kind === "LiteralExpr"
      ) {
        maxBound = Number(right.right.value);
      }

      if (minBound !== undefined && val < minBound) {
        throw new TypeCheckError(
          `Value ${val} violates refinement constraint: must be >= ${minBound}`,
          span,
          "AIL_E2006_REFINEMENT_VIOLATION",
        );
      }
      if (maxBound !== undefined && val > maxBound) {
        throw new TypeCheckError(
          `Value ${val} violates refinement constraint: must be <= ${maxBound}`,
          span,
          "AIL_E2006_REFINEMENT_VIOLATION",
        );
      }
    }
  }
}

function isNumeric(type: Type): boolean {
  return (
    type.kind === "int" ||
    type.kind === "float" ||
    type.kind === "num" ||
    type.kind === "byte" ||
    type.kind === "enum"
  );
}

/**
 * High-level typechecking entrypoint.
 */
export function check(mod: Module): void {
  const checker = new TypeChecker();
  checker.checkModule(mod);
}
