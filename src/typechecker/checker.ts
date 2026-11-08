/**
 * Sound Type Checker & Refinement Solver for AICE 2.0.
 * Conforms to Section 3 of docs/AICE_SPEC.md and Pillar 4 of docs/RESEARCH_SYNTHESIS.md.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { computeSourceHash, parseCached } from "../cache/index.js";
import {
  findProjectRoot,
  loadProjectConfig,
  type ProjectIdiomDefinition,
} from "../config/project-config.js";
import type {
  ArrayLiteralExpr,
  AssignOp,
  Block,
  ComponentDecl,
  Expr,
  FunctionDecl,
  IfStmt,
  MethodDecl,
  Module,
  ModuleItem,
  Statement,
  TypeExpr,
  UnaryExpr,
} from "../core/ast.js";
import type { Span } from "../core/span.js";
import { expandModuleIdioms } from "../idioms/index.js";
import { GLOBAL_SYMBOLS, getMethodType, getPropertyType } from "./primitives.js";
import {
  clearTypeAliases,
  type EnumTypeRep,
  formatType,
  isAssignable,
  isOpaqueNamedType,
  isStringLiteralType,
  isStringLiteralUnion,
  lookupTypeAlias,
  makeArrayType,
  makeFunctionType,
  makeNamedType,
  makeOptionType,
  makeRecordType,
  makeResultType,
  makeTupleType,
  type NamedTypeRep,
  type RecordTypeRep,
  type RefinementTypeRep,
  registerTypeAlias,
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
  unquoteStringLiteral,
} from "./types.js";

export function isPromiseType(t: Type | null | undefined): t is NamedTypeRep {
  return (
    t !== null &&
    t !== undefined &&
    t.kind === "named" &&
    t.name === "Promise" &&
    t.typeArgs !== undefined &&
    t.typeArgs.length > 0
  );
}

export function unwrapPromiseType(t: Type): Type {
  if (isPromiseType(t)) {
    return t.typeArgs![0];
  }
  return t;
}

export class TypeCheckError extends Error {
  readonly span: Span;
  readonly code: string;
  readonly expected?: Type;
  readonly actual?: Type;

  constructor(
    message: string,
    span: Span,
    code = "AICE_E2000_TYPE_ERROR",
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

const BUILTIN_TYPE_NAMES = new Set([
  "Promise",
  "Set",
  "Map",
  "WeakMap",
  "WeakSet",
  "Uint8Array",
  "Uint8ClampedArray",
  "Uint16Array",
  "Uint32Array",
  "Int8Array",
  "Int16Array",
  "Int32Array",
  "Float32Array",
  "Float64Array",
  "BigInt64Array",
  "BigUint64Array",
  "DataView",
  "ArrayBuffer",
  "Buffer",
  "Array",
  "Date",
  "Error",
  "RegExp",
  "Record",
  "Option",
  "Result",
  "TextEncoder",
  "TextDecoder",
  "AudioContext",
  "AudioNode",
  "AudioBuffer",
  "Symbol",
  "Function",
]);

export class TypeEnv {
  private bindings = new Map<string, { type: Type; isMut: boolean }>();
  private types = new Map<string, Type>();
  readonly parent: TypeEnv | null;
  readonly isFunctionBoundary: boolean;
  currentFunctionReturnType: Type | null;
  inferredReturnType?: Type;
  isClassScope = false;
  isAsync = false;

  constructor(
    parent: TypeEnv | null = null,
    currentFunctionReturnType: Type | null = null,
    isFunctionBoundary = false,
    isAsync = false,
    isClassScope = false,
  ) {
    this.parent = parent;
    this.isFunctionBoundary = isFunctionBoundary;
    this.currentFunctionReturnType =
      currentFunctionReturnType ?? parent?.currentFunctionReturnType ?? null;
    this.isAsync = isFunctionBoundary ? isAsync : isAsync || parent?.isAsync || false;
    this.isClassScope = isClassScope;
  }

  getFunctionEnv(): TypeEnv | null {
    let cur: TypeEnv | null = this;
    while (cur) {
      if (cur.isFunctionBoundary) return cur;
      cur = cur.parent;
    }
    return null;
  }

  extend(returnType: Type | null = null, isAsync?: boolean, isClassScope = false): TypeEnv {
    return new TypeEnv(
      this,
      returnType ?? this.currentFunctionReturnType,
      false,
      isAsync ?? this.isAsync,
      isClassScope,
    );
  }

  define(name: string, type: Type, isMut = false): void {
    this.bindings.set(name, { type, isMut });
  }

  defineType(name: string, type: Type): void {
    this.types.set(name, type);
    registerTypeAlias(name, type);
  }

  lookup(name: string): { type: Type; isMut: boolean } | null {
    const val = this.bindings.get(name);
    if (val) return val;
    if (this.parent) return this.parent.lookup(name);
    const globalType = GLOBAL_SYMBOLS[name];
    if (globalType) return { type: globalType, isMut: false };
    return null;
  }

  lookupGlobal(name: string): { type: Type; isMut: boolean } | null {
    if (this.parent) return this.parent.lookupGlobal(name);
    const val = this.bindings.get(name);
    if (val) return val;
    const globalType = GLOBAL_SYMBOLS[name];
    if (globalType) return { type: globalType, isMut: false };
    return null;
  }

  lookupType(name: string): Type | null {
    const val = this.types.get(name);
    if (val) return val;
    if (this.parent) return this.parent.lookupType(name);
    if (BUILTIN_TYPE_NAMES.has(name)) {
      return { kind: "named", name };
    }
    return null;
  }

  lookupLocal(name: string): { type: Type; isMut: boolean } | null {
    return this.bindings.get(name) ?? null;
  }

  lookupLocalType(name: string): Type | null {
    return this.types.get(name) ?? null;
  }

  getLocalTypes(): IterableIterator<[string, Type]> {
    return this.types.entries();
  }

  getLocalBindings(): IterableIterator<[string, { type: Type; isMut: boolean }]> {
    return this.bindings.entries();
  }
}

export class TypeChecker {
  private globalEnv: TypeEnv;
  private currentFilePath?: string;
  private currentBaseDir?: string;
  private currentIdioms?: Record<string, ProjectIdiomDefinition>;
  private moduleEnvCache = new Map<string, TypeEnv>();
  private resolvingModules = new Set<string>();
  private currentCycleFallbackOccurred = false;

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
      "navigator",
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
      "Buffer",
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
      "crypto",
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "fetch",
      "btoa",
      "atob",
      "super",
      "TextEncoder",
      "TextDecoder",
      "HTMLElement",
      "HTMLCanvasElement",
      "Element",
      "Node",
      "Document",
      "Window",
      "URLSearchParams",
      "encodeURIComponent",
      "decodeURIComponent",
      "Event",
      "MouseEvent",
      "TouchEvent",
      "KeyboardEvent",
      "WebGLRenderingContext",
      "WebGL2RenderingContext",
      "CanvasRenderingContext2D",
      "set",
      "dict",
      "list",
      "len",
      "range",
      "min",
      "max",
      "round",
      "int",
      "float",
      "str",
      "bool",
      "enumerate",
      "any",
      "all",
      "abs",
      "sum",
      "zip",
      "print",
    ];
    for (const name of intrinsics) {
      const globalSym = GLOBAL_SYMBOLS[name];
      this.globalEnv.define(name, globalSym ?? TYPE_UNKNOWN);
      this.globalEnv.defineType(name, { kind: "named", name });
    }
    for (const [name, sym] of Object.entries(GLOBAL_SYMBOLS)) {
      if (!this.globalEnv.lookup(name)) {
        this.globalEnv.define(name, sym);
      }
    }
  }

  static check(
    mod: Module,
    options?: { idioms?: Record<string, ProjectIdiomDefinition>; baseDir?: string },
  ): void {
    const checker = new TypeChecker();
    checker.checkModule(mod, options);
  }

  check(
    mod: Module,
    options?: { idioms?: Record<string, ProjectIdiomDefinition>; baseDir?: string },
  ): void {
    this.checkModule(mod, options);
  }

  setIdioms(idioms?: Record<string, ProjectIdiomDefinition>): void {
    this.currentIdioms = idioms;
  }

  checkModule(
    mod: Module,
    options?: { idioms?: Record<string, ProjectIdiomDefinition>; baseDir?: string },
  ): void {
    let idioms = options?.idioms;
    this.currentIdioms = idioms;
    const filePath = mod.span?.file;
    let baseDir: string | undefined;
    if (options?.baseDir) {
      baseDir = path.resolve(options.baseDir);
    } else if (
      filePath &&
      !filePath.startsWith("<") &&
      (filePath.includes("/") || filePath.includes("\\"))
    ) {
      try {
        if (fs.existsSync(filePath)) {
          baseDir = path.dirname(path.resolve(filePath));
        }
      } catch {
        // Ignore fs error
      }
    }
    this.currentFilePath = filePath;
    this.currentBaseDir = baseDir;

    let isRootTracking = false;
    let resolvedMainPath: string | null = null;
    if (
      filePath &&
      !filePath.startsWith("<") &&
      (filePath.includes("/") || filePath.includes("\\"))
    ) {
      try {
        const abs = path.resolve(filePath);
        if (fs.existsSync(abs)) {
          resolvedMainPath = abs;
          this.resolvingModules.add(abs);
          isRootTracking = true;
        }
      } catch {
        // Ignore fs error
      }
    }

    try {
      if (
        !idioms &&
        filePath &&
        !filePath.startsWith("<") &&
        (filePath.includes("/") || filePath.includes("\\"))
      ) {
        if (astContainsDollarIdentifier(mod)) {
          try {
            const root = findProjectRoot(filePath);
            const config = loadProjectConfig(root);
            if (config.idioms && Object.keys(config.idioms).length > 0) {
              idioms = config.idioms;
              this.currentIdioms = idioms;
            }
          } catch {
            // Ignore config loading error in checkModule
          }
        }
      }

      if (idioms && Object.keys(idioms).length > 0) {
        mod = expandModuleIdioms(mod, idioms);
      }

      clearTypeAliases();
      const env = new TypeEnv(this.globalEnv);

      // Pass 1: Declare all types and function signatures
      for (const item of mod.items) {
        this.declareItem(item, env);
      }

      // Pass 2: Typecheck bodies
      for (const item of mod.items) {
        this.checkItem(item, env);
      }
    } finally {
      if (isRootTracking && resolvedMainPath) {
        this.resolvingModules.delete(resolvedMainPath);
      }
    }
  }

  private resolveImportedAiceModule(importSource: string, fromDir: string): string | null {
    if (!importSource.startsWith("./") && !importSource.startsWith("../")) {
      return null;
    }

    const cleanRel = importSource
      .replace(/(\.(ts|tsx|js|jsx|py))?\.aice$/i, "")
      .replace(/\.(ts|tsx|js|jsx|py)$/i, "");

    const candidates: string[] = [];
    if (importSource.endsWith(".aice")) {
      candidates.push(path.resolve(fromDir, importSource));
    }
    candidates.push(
      path.resolve(fromDir, `${importSource}.aice`),
      path.resolve(fromDir, `${cleanRel}.aice`),
      path.resolve(fromDir, `${cleanRel}.ts.aice`),
      path.resolve(fromDir, `${cleanRel}.tsx.aice`),
      path.resolve(fromDir, `${cleanRel}.js.aice`),
      path.resolve(fromDir, `${cleanRel}.py.aice`),
      path.resolve(fromDir, cleanRel, "index.aice"),
      path.resolve(fromDir, cleanRel, "index.ts.aice"),
    );

    for (const candidate of candidates) {
      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          return candidate;
        }
      } catch {
        // ignore fs errors
      }
    }
    return null;
  }

  public clearModuleEnvCache(): void {
    this.moduleEnvCache.clear();
  }

  private loadModuleExportsEnv(resolvedAicePath: string): TypeEnv | null {
    if (this.resolvingModules.has(resolvedAicePath)) {
      return null; // cycle protection — caller falls back to TYPE_UNKNOWN
    }

    let source: string;
    try {
      source = fs.readFileSync(resolvedAicePath, "utf-8");
    } catch {
      return null;
    }

    const sourceHash = computeSourceHash(source);
    const cacheKey = `${resolvedAicePath}::${sourceHash}`;

    if (this.moduleEnvCache.has(cacheKey)) {
      const cachedEnv = this.moduleEnvCache.get(cacheKey)!;
      for (const [name, type] of cachedEnv.getLocalTypes()) {
        registerTypeAlias(name, type);
      }
      return cachedEnv;
    }

    this.resolvingModules.add(resolvedAicePath);
    const prevCycleFallback = this.currentCycleFallbackOccurred;
    this.currentCycleFallbackOccurred = false;
    const prevFilePath = this.currentFilePath;
    const prevBaseDir = this.currentBaseDir;

    try {
      let subMod: Module;
      try {
        subMod = parseCached(source, resolvedAicePath);
      } catch {
        return null;
      }

      let idioms = this.currentIdioms;
      if (!idioms && astContainsDollarIdentifier(subMod)) {
        try {
          const root = findProjectRoot(resolvedAicePath);
          const config = loadProjectConfig(root);
          if (config.idioms && Object.keys(config.idioms).length > 0) {
            idioms = config.idioms;
          }
        } catch {
          // Ignore config loading error
        }
      }

      if (idioms && Object.keys(idioms).length > 0) {
        subMod = expandModuleIdioms(subMod, idioms);
      }

      const exportedEnv = new TypeEnv(this.globalEnv);

      this.currentFilePath = resolvedAicePath;
      this.currentBaseDir = path.dirname(resolvedAicePath);

      // Pass 1: Declare all items
      for (const subItem of subMod.items) {
        this.declareItem(subItem, exportedEnv);
      }

      // Function return type inference if not annotated
      for (const subItem of subMod.items) {
        if (subItem.kind === "FunctionDecl") {
          const existing = exportedEnv.lookupLocal(subItem.name);
          if (
            existing &&
            existing.type.kind === "function" &&
            existing.type.returnType.kind === "unknown"
          ) {
            if (subItem.isExpressionBodied || subItem.body.kind === "Block") {
              try {
                this.checkFunctionDecl(subItem, exportedEnv);
              } catch {
                // Keep FunctionType with its declared parameter types
              }
            }
          }
        } else if (subItem.kind === "ConstDecl" || subItem.kind === "VarDecl") {
          if (!subItem.typeAnnotation && subItem.value) {
            try {
              if (subItem.value.kind === "RecordLiteralExpr") {
                const recFields = new Map<string, Type>();
                for (const prop of subItem.value.properties) {
                  if (prop.key) {
                    recFields.set(prop.key, TYPE_UNKNOWN);
                  }
                }
                exportedEnv.define(
                  subItem.name,
                  makeRecordType(recFields),
                  subItem.kind === "VarDecl" ? subItem.isMut : false,
                );
              } else {
                const valType = this.checkExpr(subItem.value, exportedEnv);
                exportedEnv.define(
                  subItem.name,
                  valType,
                  subItem.kind === "VarDecl" ? subItem.isMut : false,
                );
              }
            } catch {
              // Keep TYPE_UNKNOWN
            }
          }
        } else if (subItem.kind === "ClassDecl") {
          const clsType = exportedEnv.lookupLocalType(subItem.name);
          if (clsType && clsType.kind === "record") {
            const classEnv = exportedEnv.extend(null, undefined, true);
            classEnv.define("this", { kind: "named", name: subItem.name });
            for (const m of subItem.methods) {
              const methodType = clsType.fields.get(m.name);
              if (
                methodType &&
                methodType.kind === "function" &&
                methodType.returnType.kind === "unknown"
              ) {
                try {
                  this.checkMethodDecl(m, classEnv, subItem.name);
                } catch {
                  // Keep FunctionType with its declared parameter types
                }
              }
            }
          }
        }
      }

      if (this.moduleEnvCache.size >= 500) {
        const oldestKey = this.moduleEnvCache.keys().next().value;
        if (oldestKey !== undefined) {
          this.moduleEnvCache.delete(oldestKey);
        }
      }
      this.moduleEnvCache.set(cacheKey, exportedEnv);
      return exportedEnv;
    } finally {
      this.resolvingModules.delete(resolvedAicePath);
      this.currentCycleFallbackOccurred = prevCycleFallback;
      this.currentFilePath = prevFilePath;
      this.currentBaseDir = prevBaseDir;
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
        }
        const enumTypeRep: EnumTypeRep = {
          kind: "enum",
          name: item.name,
          variants,
        };
        for (const v of item.variants) {
          const payloads = variants.get(v.name);
          if (payloads && payloads.length > 0) {
            const params = payloads.map((p, idx) => ({ name: `item${idx}`, type: p }));
            env.define(v.name, makeFunctionType(params, enumTypeRep));
          } else {
            env.define(v.name, enumTypeRep);
          }
        }
        const enumRecordFields = new Map<string, Type>();
        for (const v of item.variants) {
          enumRecordFields.set(v.name, enumTypeRep);
        }
        env.define(item.name, makeRecordType(enumRecordFields, item.name));
        env.defineType(item.name, enumTypeRep);
      } else if (item.fields) {
        const fields = new Map<string, Type>();
        const constructorParams: { name: string; type: Type; optional?: boolean }[] = [];
        for (const f of item.fields) {
          const fType = this.resolveTypeExpr(f.typeAnnotation, env);
          fields.set(f.name, fType);
          constructorParams.push({
            name: f.name,
            type: fType,
            optional: Boolean(
              f.defaultValue !== undefined || f.typeAnnotation?.kind === "OptionType",
            ),
          });
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
        optional: Boolean(
          p.defaultValue !== undefined || p.isOptional || p.typeAnnotation?.kind === "OptionType",
        ),
        rest: Boolean(p.isRest),
      }));
      const returnType = item.returnType
        ? this.resolveTypeExpr(item.returnType, env)
        : item.isExpressionBodied ||
            this.hasTrailingExpr(item) ||
            item.isAsync ||
            this.hasReturnStmt(item)
          ? TYPE_UNKNOWN
          : TYPE_VOID;
      env.define(item.name, makeFunctionType(params, returnType));
    }

    if (item.kind === "ComponentDecl") {
      const params = item.params.map((p) => ({
        name: p.name,
        type: this.resolveTypeExpr(p.typeAnnotation, env),
        optional: Boolean(
          p.defaultValue !== undefined || p.isOptional || p.typeAnnotation?.kind === "OptionType",
        ),
        rest: Boolean(p.isRest),
      }));
      env.define(item.name, makeFunctionType(params, TYPE_VOID));
    }

    if (item.kind === "ImportDecl") {
      const resolvedPath = this.currentBaseDir
        ? this.resolveImportedAiceModule(item.source, this.currentBaseDir)
        : null;
      if (resolvedPath && this.resolvingModules.has(resolvedPath)) {
        this.currentCycleFallbackOccurred = true;
      }
      const targetEnv = resolvedPath ? this.loadModuleExportsEnv(resolvedPath) : null;

      for (const spec of item.specifiers) {
        if (spec.isWildcard) {
          if (spec.alias) {
            if (targetEnv) {
              const recordFields = new Map<string, Type>();
              for (const [name, binding] of targetEnv.getLocalBindings()) {
                recordFields.set(name, binding.type);
              }
              const recType = makeRecordType(recordFields, spec.alias);
              env.define(spec.alias, recType);
              env.defineType(spec.alias, recType);
            } else {
              env.define(spec.alias, TYPE_UNKNOWN);
              env.defineType(spec.alias, { kind: "named", name: spec.alias });
            }
          }
        } else {
          const symName = spec.alias ?? spec.name;
          const origName = spec.name;

          let valBinding: { type: Type; isMut: boolean } | null = null;
          let typeBinding: Type | null = null;

          if (targetEnv) {
            valBinding =
              targetEnv.lookupLocal(origName) ??
              (targetEnv.lookup(origName)?.type && !GLOBAL_SYMBOLS[origName]
                ? targetEnv.lookup(origName)
                : null);
            typeBinding =
              targetEnv.lookupLocalType(origName) ??
              (targetEnv.lookupType(origName) && !BUILTIN_TYPE_NAMES.has(origName)
                ? targetEnv.lookupType(origName)
                : null);
          }

          if (valBinding || typeBinding) {
            if (valBinding) {
              env.define(symName, valBinding.type, valBinding.isMut);
            } else {
              env.define(symName, TYPE_UNKNOWN);
            }

            if (typeBinding) {
              env.defineType(symName, typeBinding);
              if (typeBinding.kind === "enum") {
                for (const vName of typeBinding.variants.keys()) {
                  const vBinding = targetEnv?.lookupLocal(vName);
                  if (vBinding && !env.lookupLocal(vName)) {
                    env.define(vName, vBinding.type, vBinding.isMut);
                  }
                }
              }
            } else {
              env.defineType(symName, { kind: "named", name: symName });
            }
          } else {
            env.define(symName, TYPE_UNKNOWN);
            env.defineType(symName, { kind: "named", name: symName });
          }
        }
      }
    }

    if (item.kind === "ClassDecl") {
      const fields = new Map<string, Type>();
      if (item.extends) {
        const superType = env.lookupType(item.extends);
        if (superType && superType.kind === "record") {
          for (const [k, v] of superType.fields.entries()) {
            fields.set(k, v);
          }
        } else {
          fields.set("__has_unresolved_super__", TYPE_UNKNOWN);
        }
      }
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
          optional: Boolean(
            p.defaultValue !== undefined || p.isOptional || p.typeAnnotation?.kind === "OptionType",
          ),
          rest: Boolean(p.isRest),
        }));
        const mRet = m.returnType
          ? this.resolveTypeExpr(m.returnType, env)
          : m.isExpressionBodied || m.accessor === "get" || m.isAsync || this.hasReturnStmt(m)
            ? TYPE_UNKNOWN
            : TYPE_VOID;
        if (!m.accessor) {
          fields.set(m.name, makeFunctionType(mParams, mRet));
        } else if (m.accessor === "get") {
          fields.set(m.name, mRet);
          fields.set(`get_${m.name}`, makeFunctionType([], mRet));
        } else if (m.accessor === "set") {
          fields.set(`set_${m.name}`, makeFunctionType(mParams, TYPE_VOID));
          if (!fields.has(m.name)) {
            fields.set(m.name, mParams[0]?.type ?? TYPE_UNKNOWN);
          }
        }

        const scanThisProps = (node: Statement | Expr | Block | null | undefined) => {
          if (!node) return;
          if ("statements" in node) {
            for (const s of node.statements) scanThisProps(s);
            return;
          }
          if ("kind" in node) {
            if (node.kind === "AssignStmt" || node.kind === "AssignExpr") {
              const target = node.target;
              if (
                target.kind === "MemberAccessExpr" &&
                target.object.kind === "IdentifierExpr" &&
                target.object.name === "this"
              ) {
                if (!fields.has(target.property)) {
                  fields.set(target.property, TYPE_UNKNOWN);
                }
              } else if (
                target.kind === "IdentifierExpr" &&
                m.name === "constructor" &&
                !fields.has(target.name) &&
                !m.params.some((p) => p.name === target.name)
              ) {
                fields.set(target.name, TYPE_UNKNOWN);
              }
            }
            switch (node.kind) {
              case "ExprStmt":
                scanThisProps(node.expr);
                break;
              case "IfStmt":
                for (const s of node.thenBranch.statements) scanThisProps(s);
                for (const el of node.elifBranches) {
                  for (const s of el.body.statements) scanThisProps(s);
                }
                if (node.elseBranch) {
                  for (const s of node.elseBranch.statements) scanThisProps(s);
                }
                break;
              case "WhileStmt":
              case "ForStmt":
                for (const s of node.body.statements) scanThisProps(s);
                break;
              case "TryStmt":
                for (const s of node.tryBlock.statements) scanThisProps(s);
                if (node.catchBlock) for (const s of node.catchBlock.statements) scanThisProps(s);
                if (node.finallyBlock)
                  for (const s of node.finallyBlock.statements) scanThisProps(s);
                break;
            }
          }
        };
        scanThisProps(m.body);
      }
      const clsType = makeRecordType(fields, item.name);
      clsType.isClass = true;
      env.defineType(item.name, clsType);

      // Define constructor function in value environment
      const ctorMethod = item.methods.find((m) => m.name === "constructor");
      if (ctorMethod) {
        const ctorParams = ctorMethod.params.map((p) => ({
          name: p.name,
          type: this.resolveTypeExpr(p.typeAnnotation, env),
          optional: Boolean(
            p.defaultValue !== undefined || p.isOptional || p.typeAnnotation?.kind === "OptionType",
          ),
          rest: Boolean(p.isRest),
        }));
        env.define(item.name, makeFunctionType(ctorParams, clsType));
      } else if (item.primaryConstructor && item.primaryConstructor.length > 0) {
        const ctorParams = item.primaryConstructor.map((p) => ({
          name: p.name,
          type: this.resolveTypeExpr(p.typeAnnotation, env),
          optional: Boolean(
            p.defaultValue !== undefined || p.isOptional || p.typeAnnotation?.kind === "OptionType",
          ),
          rest: Boolean(p.isRest),
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

  private hasTrailingExpr(fn: FunctionDecl | MethodDecl): boolean {
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

  private hasReturnStmt(fn: FunctionDecl | MethodDecl): boolean {
    if (fn.body.kind !== "Block") return false;
    const checkStatements = (stmts: Statement[]): boolean => {
      for (const s of stmts) {
        if (s.kind === "ReturnStmt" && s.value) return true;
        if (s.kind === "IfStmt") {
          if (checkStatements(s.thenBranch.statements)) return true;
          for (const elif of s.elifBranches) {
            if (checkStatements(elif.body.statements)) return true;
          }
          if (s.elseBranch && checkStatements(s.elseBranch.statements)) return true;
        }
        if (s.kind === "WhileStmt" && checkStatements(s.body.statements)) return true;
        if (s.kind === "ForStmt" && checkStatements(s.body.statements)) return true;
        if (s.kind === "TryStmt") {
          if (checkStatements(s.tryBlock.statements)) return true;
          if (s.catchBlock && checkStatements(s.catchBlock.statements)) return true;
          if (s.finallyBlock && checkStatements(s.finallyBlock.statements)) return true;
        }
      }
      return false;
    };
    return checkStatements(fn.body.statements);
  }

  private checkItem(item: ModuleItem, env: TypeEnv): void {
    if (item.kind === "FunctionDecl") {
      this.checkFunctionDecl(item, env);
    } else if (item.kind === "ComponentDecl") {
      this.checkComponentDecl(item, env);
    } else if (item.kind === "ClassDecl") {
      const classEnv = env.extend(null, undefined, true);
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
        this.checkMethodDecl(m, classEnv, item.name);
      }
      if (item.staticBlocks) {
        for (const sb of item.staticBlocks) {
          this.checkBlock(sb, classEnv);
        }
      }
    } else if (item.kind === "ConstDecl" || item.kind === "VarDecl") {
      let valType: Type;
      if (item.typeAnnotation) {
        const declType = this.resolveTypeExpr(item.typeAnnotation, env);
        if (declType.kind === "tuple" && item.value.kind === "ArrayLiteralExpr") {
          valType = makeTupleType(item.value.elements.map((el) => this.checkExpr(el, env)));
        } else {
          valType = this.checkExpr(item.value, env, declType);
        }
        if (!isAssignable(declType, valType)) {
          throw new TypeCheckError(
            `Cannot assign value of type '${formatType(valType)}' to variable '${item.name}' of type '${formatType(declType)}'`,
            item.span,
            "AICE_E2002_TYPE_MISMATCH",
            declType,
            valType,
          );
        }
      } else {
        valType = this.checkExpr(item.value, env);
        if (
          item.kind === "VarDecl" &&
          item.isMut &&
          valType.kind === "named" &&
          (valType.name === "true" || valType.name === "false")
        ) {
          valType = TYPE_BOOL;
        } else if (
          item.kind === "VarDecl" &&
          item.isMut &&
          valType.kind === "named" &&
          isStringLiteralType(valType.name)
        ) {
          valType = TYPE_STR;
        }
      }
    }
  }

  private checkMethodDecl(m: MethodDecl, classEnv: TypeEnv, className?: string): void {
    let retType = m.returnType
      ? this.resolveTypeExpr(m.returnType, classEnv)
      : m.isExpressionBodied ||
          m.accessor === "get" ||
          m.isAsync ||
          this.hasTrailingExpr(m) ||
          this.hasReturnStmt(m)
        ? TYPE_UNKNOWN
        : TYPE_VOID;

    const isAsyncOrPromise = !!m.isAsync || isPromiseType(retType);
    const targetCheckType = isAsyncOrPromise ? unwrapPromiseType(retType) : retType;

    const methodEnv = new TypeEnv(classEnv, retType, true, m.isAsync);

    for (const p of m.params) {
      const pType = this.resolveTypeExpr(p.typeAnnotation, classEnv);
      if (p.defaultValue) {
        const defType = this.checkExpr(p.defaultValue, methodEnv, pType);
        if (!isAssignable(pType, defType)) {
          throw new TypeCheckError(
            `Default parameter value of type '${formatType(defType)}' is not assignable to parameter '${p.name}' of type '${formatType(pType)}'`,
            p.defaultValue.span,
            "AICE_E2002_TYPE_MISMATCH",
            pType,
            defType,
          );
        }
      }
      this.bindParameter(p.name, pType, methodEnv, true);
    }

    if (m.body.kind === "Block") {
      const trailingType = this.checkBlock(m.body, methodEnv);
      const stmts = m.body.statements;
      if (stmts.length > 0) {
        const last = stmts[stmts.length - 1];
        if (last.kind === "ExprStmt") {
          if (m.returnType) {
            if (retType.kind !== "void" && m.accessor !== "set") {
              const matches =
                isAssignable(retType, trailingType) ||
                (isAsyncOrPromise && isAssignable(targetCheckType, trailingType));
              if (!matches) {
                throw new TypeCheckError(
                  `Trailing expression evaluates to '${formatType(trailingType)}', but method '${m.name}' declares return type '${formatType(retType)}'`,
                  last.expr.span,
                  "AICE_E2007_RETURN_TYPE_MISMATCH",
                  retType,
                  trailingType,
                );
              }
            }
          } else if (trailingType.kind !== "void") {
            let inferred = trailingType;
            if (m.isAsync) {
              inferred = isPromiseType(inferred) ? inferred : makeNamedType("Promise", [inferred]);
            }
            retType = inferred;
          }
        } else if (last.kind === "IfStmt" && last.elseBranch) {
          if (m.returnType) {
            if (retType.kind !== "void" && m.accessor !== "set") {
              const matches =
                isAssignable(retType, trailingType) ||
                (isAsyncOrPromise && isAssignable(targetCheckType, trailingType));
              if (!matches) {
                throw new TypeCheckError(
                  `Trailing expression in conditional branch evaluates to '${formatType(trailingType)}', but method '${m.name}' declares return type '${formatType(retType)}'`,
                  last.span,
                  "AICE_E2007_RETURN_TYPE_MISMATCH",
                  retType,
                  trailingType,
                );
              }
            }
          } else if (trailingType.kind !== "void") {
            let inferred = trailingType;
            if (m.isAsync) {
              inferred = isPromiseType(inferred) ? inferred : makeNamedType("Promise", [inferred]);
            }
            retType = inferred;
          }
        }
      }

      if (
        !m.returnType &&
        methodEnv.inferredReturnType &&
        methodEnv.inferredReturnType.kind !== "void"
      ) {
        let inferred = methodEnv.inferredReturnType;
        if (m.isAsync) {
          inferred = isPromiseType(inferred) ? inferred : makeNamedType("Promise", [inferred]);
        }
        retType = inferred;
      } else if (!m.returnType && m.isAsync && retType.kind === "unknown") {
        retType = makeNamedType("Promise", [TYPE_VOID]);
      }
    } else {
      const bodyType = this.checkExpr(m.body, methodEnv, targetCheckType);
      if (m.returnType) {
        if (retType.kind !== "void" && m.accessor !== "set" && m.body.kind !== "AssignExpr") {
          const matches =
            isAssignable(retType, bodyType) ||
            (isAsyncOrPromise && isAssignable(targetCheckType, bodyType));
          if (!matches) {
            throw new TypeCheckError(
              `Method '${m.name}' returns '${formatType(bodyType)}', but declared '${formatType(retType)}'`,
              m.body.span,
              "AICE_E2007_RETURN_TYPE_MISMATCH",
              retType,
              bodyType,
            );
          }
        }
      } else {
        let inferred = bodyType;
        if (m.isAsync) {
          inferred = isPromiseType(inferred) ? inferred : makeNamedType("Promise", [inferred]);
        }
        retType = inferred;
      }
    }

    if (!m.returnType && className) {
      const clsType = classEnv.lookupType(className);
      if (clsType && clsType.kind === "record") {
        const mParams = m.params.map((p) => ({
          name: p.name,
          type: this.resolveTypeExpr(p.typeAnnotation, classEnv),
          optional: Boolean(
            p.defaultValue !== undefined || p.isOptional || p.typeAnnotation?.kind === "OptionType",
          ),
          rest: Boolean(p.isRest),
        }));
        if (!m.accessor) {
          clsType.fields.set(m.name, makeFunctionType(mParams, retType));
        } else if (m.accessor === "get") {
          clsType.fields.set(m.name, retType);
          clsType.fields.set(`get_${m.name}`, makeFunctionType([], retType));
        } else if (m.accessor === "set") {
          clsType.fields.set(`set_${m.name}`, makeFunctionType(mParams, TYPE_VOID));
          if (!clsType.fields.has(m.name)) {
            clsType.fields.set(m.name, mParams[0]?.type ?? TYPE_UNKNOWN);
          }
        }
      }
    }
  }

  private bindParameter(
    paramName: string,
    paramType: Type,
    targetEnv: TypeEnv,
    isMut = true,
  ): void {
    if (paramName.startsWith("[") && paramName.endsWith("]")) {
      const raw = paramName.slice(1, -1);
      const parts = raw.split(",").map((s) => s.trim());
      for (let i = 0; i < parts.length; i++) {
        let id = parts[i];
        if (id.includes("=")) {
          id = id.split("=")[0].trim();
        }
        if (!id || id === "" || id === "_") continue;
        let subType: Type = TYPE_UNKNOWN;
        if (paramType.kind === "tuple") {
          subType = i < paramType.elementTypes.length ? paramType.elementTypes[i] : TYPE_UNKNOWN;
        } else if (paramType.kind === "array") {
          subType = paramType.elementType;
        }
        targetEnv.define(id, subType, isMut);
      }
      return;
    }

    if (paramName.startsWith("{") && paramName.endsWith("}")) {
      const raw = paramName.slice(1, -1);
      const parts = raw.split(",").map((s) => s.trim());
      for (const entry of parts) {
        if (!entry || entry === "" || entry === "_") continue;
        let propName = entry;
        let bindingName = entry;
        if (entry.includes(":")) {
          const split = entry.split(":");
          propName = split[0].trim();
          bindingName = split[1].trim();
        }
        if (propName.includes("=")) {
          propName = propName.split("=")[0].trim();
        }
        if (bindingName.includes("=")) {
          bindingName = bindingName.split("=")[0].trim();
        }
        if (!bindingName || bindingName === "_") continue;

        let subType: Type = TYPE_UNKNOWN;
        if (paramType.kind === "record") {
          subType = paramType.fields.get(propName) ?? TYPE_UNKNOWN;
        } else if (paramType.kind === "named") {
          const resolved = targetEnv.lookupType(paramType.name);
          if (resolved && resolved.kind === "record") {
            subType = resolved.fields.get(propName) ?? TYPE_UNKNOWN;
          }
        }
        targetEnv.define(bindingName, subType, isMut);
      }
      return;
    }

    targetEnv.define(paramName, paramType, isMut);
  }

  private checkFunctionDecl(fn: FunctionDecl, parentEnv: TypeEnv): void {
    let returnType = fn.returnType
      ? this.resolveTypeExpr(fn.returnType, parentEnv)
      : fn.isExpressionBodied || this.hasTrailingExpr(fn) || this.hasReturnStmt(fn) || fn.isAsync
        ? TYPE_UNKNOWN
        : TYPE_VOID;

    const isAsyncOrPromise = !!fn.isAsync || isPromiseType(returnType);
    const targetCheckType = isAsyncOrPromise ? unwrapPromiseType(returnType) : returnType;

    const fnEnv = new TypeEnv(parentEnv, returnType, true, fn.isAsync);

    for (const p of fn.params) {
      const pType = p.typeAnnotation
        ? this.resolveTypeExpr(p.typeAnnotation, parentEnv)
        : TYPE_UNKNOWN;
      if (p.defaultValue) {
        const defType = this.checkExpr(p.defaultValue, parentEnv, pType);
        if (!isAssignable(pType, defType)) {
          throw new TypeCheckError(
            `Default parameter value of type '${formatType(defType)}' is not assignable to parameter '${p.name}' of type '${formatType(pType)}'`,
            p.defaultValue.span,
            "AICE_E2002_TYPE_MISMATCH",
            pType,
            defType,
          );
        }
      }
      this.bindParameter(p.name, pType, fnEnv, true);
    }

    if (fn.isExpressionBodied) {
      let bodyType: Type;
      if (
        fn.returnType &&
        targetCheckType.kind === "tuple" &&
        (fn.body as Expr).kind === "ArrayLiteralExpr"
      ) {
        const arr = fn.body as ArrayLiteralExpr;
        bodyType = makeTupleType(arr.elements.map((el) => this.checkExpr(el, fnEnv)));
      } else {
        bodyType = this.checkExpr(fn.body as Expr, fnEnv, targetCheckType);
      }
      if (fn.returnType) {
        if (returnType.kind !== "void" && (fn.body as Expr).kind !== "AssignExpr") {
          const matches =
            isAssignable(returnType, bodyType) ||
            (isAsyncOrPromise && isAssignable(targetCheckType, bodyType));
          if (!matches) {
            throw new TypeCheckError(
              `Expression body evaluates to '${formatType(bodyType)}', but function '${fn.name}' declares return type '${formatType(returnType)}'`,
              (fn.body as Expr).span,
              "AICE_E2007_RETURN_TYPE_MISMATCH",
              returnType,
              bodyType,
            );
          }
        }
      } else {
        // Infer return type and update signature in parentEnv
        let inferred = bodyType;
        if (fn.isAsync) {
          inferred = isPromiseType(inferred) ? inferred : makeNamedType("Promise", [inferred]);
        }
        returnType = inferred;
        const existing = parentEnv.lookup(fn.name);
        if (existing && existing.type.kind === "function") {
          existing.type.returnType = inferred;
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
            if (returnType.kind !== "void") {
              const matches =
                isAssignable(returnType, trailingType) ||
                (isAsyncOrPromise && isAssignable(targetCheckType, trailingType));
              if (!matches) {
                throw new TypeCheckError(
                  `Trailing expression evaluates to '${formatType(trailingType)}', but function '${fn.name}' declares return type '${formatType(returnType)}'`,
                  last.expr.span,
                  "AICE_E2007_RETURN_TYPE_MISMATCH",
                  returnType,
                  trailingType,
                );
              }
            }
          } else if (fn.name !== "__top_level__" && trailingType.kind !== "void") {
            let inferred = trailingType;
            if (fn.isAsync) {
              inferred = isPromiseType(inferred) ? inferred : makeNamedType("Promise", [inferred]);
            }
            returnType = inferred;
            const existing = parentEnv.lookup(fn.name);
            if (existing && existing.type.kind === "function") {
              existing.type.returnType = inferred;
            }
          }
        } else if (last.kind === "IfStmt" && last.elseBranch) {
          if (fn.returnType) {
            if (returnType.kind !== "void") {
              const matches =
                isAssignable(returnType, trailingType) ||
                (isAsyncOrPromise && isAssignable(targetCheckType, trailingType));
              if (!matches) {
                throw new TypeCheckError(
                  `Trailing expression in conditional branch evaluates to '${formatType(trailingType)}', but function '${fn.name}' declares return type '${formatType(returnType)}'`,
                  last.span,
                  "AICE_E2007_RETURN_TYPE_MISMATCH",
                  returnType,
                  trailingType,
                );
              }
            }
          } else if (fn.name !== "__top_level__" && trailingType.kind !== "void") {
            let inferred = trailingType;
            if (fn.isAsync) {
              inferred = isPromiseType(inferred) ? inferred : makeNamedType("Promise", [inferred]);
            }
            returnType = inferred;
            const existing = parentEnv.lookup(fn.name);
            if (existing && existing.type.kind === "function") {
              existing.type.returnType = inferred;
            }
          }
        }
      }

      if (!fn.returnType && fnEnv.inferredReturnType && fnEnv.inferredReturnType.kind !== "void") {
        let inferred = fnEnv.inferredReturnType;
        if (fn.isAsync) {
          inferred = isPromiseType(inferred) ? inferred : makeNamedType("Promise", [inferred]);
        }
        returnType = inferred;
        const existing = parentEnv.lookup(fn.name);
        if (existing && existing.type.kind === "function") {
          existing.type.returnType = inferred;
        }
      } else if (!fn.returnType && fn.name !== "__top_level__" && fn.isAsync) {
        const existing = parentEnv.lookup(fn.name);
        if (
          existing &&
          existing.type.kind === "function" &&
          existing.type.returnType.kind === "unknown"
        ) {
          existing.type.returnType = makeNamedType("Promise", [TYPE_VOID]);
        }
      }
    }
  }

  private checkComponentDecl(comp: ComponentDecl, parentEnv: TypeEnv): void {
    const compEnv = new TypeEnv(parentEnv, TYPE_VOID, true);
    for (const p of comp.params) {
      const pType = p.typeAnnotation
        ? this.resolveTypeExpr(p.typeAnnotation, parentEnv)
        : TYPE_UNKNOWN;
      this.bindParameter(p.name, pType, compEnv, false);
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
      if (
        stmt.kind === "IfStmt" &&
        this.blockAlwaysExits(stmt.thenBranch) &&
        !stmt.elseBranch &&
        stmt.elifBranches.length === 0
      ) {
        const exitNarrowings = this.extractNarrowings(stmt.condition, false, blockEnv);
        for (const [name, narrowedType] of exitNarrowings) {
          const existing = blockEnv.lookup(name);
          blockEnv.define(name, narrowedType, existing?.isMut ?? false);
        }
      }
    }
    return trailingType;
  }

  private blockAlwaysExits(block: Block): boolean {
    for (const stmt of block.statements) {
      if (stmt.kind === "ReturnStmt" || stmt.kind === "ThrowStmt") {
        return true;
      }
      if (stmt.kind === "IfStmt" && stmt.elseBranch) {
        if (
          this.blockAlwaysExits(stmt.thenBranch) &&
          this.blockAlwaysExits(stmt.elseBranch) &&
          stmt.elifBranches.every((el) => this.blockAlwaysExits(el.body))
        ) {
          return true;
        }
      }
    }
    return false;
  }

  private extractNarrowings(cond: Expr, isPositive: boolean, env: TypeEnv): Map<string, Type> {
    const narrowings = new Map<string, Type>();

    if (cond.kind === "IdentifierExpr") {
      if (isPositive) {
        const binding = env.lookup(cond.name);
        if (binding) {
          let t = binding.type;
          if (t.kind === "named") {
            const resolved = env.lookupType(t.name);
            if (resolved) t = resolved;
          }
          if (t.kind === "option") {
            narrowings.set(cond.name, t.innerType);
          }
        }
      }
      return narrowings;
    }

    if (cond.kind === "UnaryExpr" && (cond.operator === "not" || cond.operator === "!")) {
      return this.extractNarrowings(cond.operand, !isPositive, env);
    }

    if (cond.kind === "BinaryExpr") {
      const op = cond.operator;
      if (op === "and" || op === "&&") {
        if (isPositive) {
          const leftMap = this.extractNarrowings(cond.left, true, env);
          const rightMap = this.extractNarrowings(cond.right, true, env);
          const merged = new Map<string, Type>(leftMap);
          for (const [k, v] of rightMap) {
            merged.set(k, v);
          }
          return merged;
        }
        return narrowings;
      }

      if (op === "or" || op === "||") {
        if (!isPositive) {
          const leftMap = this.extractNarrowings(cond.left, false, env);
          const rightMap = this.extractNarrowings(cond.right, false, env);
          const merged = new Map<string, Type>(leftMap);
          for (const [k, v] of rightMap) {
            merged.set(k, v);
          }
          return merged;
        }
        return narrowings;
      }

      const isNilOrNull = (e: Expr): boolean => {
        if (e.kind === "LiteralExpr") {
          return (
            e.literalKind === "nil" ||
            e.value === null ||
            e.rawValue === "nil" ||
            e.rawValue === "null"
          );
        }
        if (e.kind === "IdentifierExpr") {
          return e.name === "nil" || e.name === "null";
        }
        return false;
      };

      // Not null check: x != nil or nil != x or x != null or null != x
      if (op === "!=") {
        if (isPositive) {
          let targetName: string | null = null;
          if (cond.left.kind === "IdentifierExpr" && isNilOrNull(cond.right)) {
            targetName = cond.left.name;
          } else if (isNilOrNull(cond.left) && cond.right.kind === "IdentifierExpr") {
            targetName = cond.right.name;
          }
          if (targetName) {
            const binding = env.lookup(targetName);
            if (binding) {
              let t = binding.type;
              if (t.kind === "named") {
                const resolved = env.lookupType(t.name);
                if (resolved) t = resolved;
              }
              if (t.kind === "option") {
                narrowings.set(targetName, t.innerType);
              }
            }
          }
        }
        return narrowings;
      }

      // Null check: x == nil or nil == x or x == null or null == x
      if (op === "==") {
        if (!isPositive) {
          let targetName: string | null = null;
          if (cond.left.kind === "IdentifierExpr" && isNilOrNull(cond.right)) {
            targetName = cond.left.name;
          } else if (isNilOrNull(cond.left) && cond.right.kind === "IdentifierExpr") {
            targetName = cond.right.name;
          }
          if (targetName) {
            const binding = env.lookup(targetName);
            if (binding) {
              let t = binding.type;
              if (t.kind === "named") {
                const resolved = env.lookupType(t.name);
                if (resolved) t = resolved;
              }
              if (t.kind === "option") {
                narrowings.set(targetName, t.innerType);
              }
            }
          }
        }
        return narrowings;
      }

      // instanceof check: x instanceof MyClass
      if (op === "instanceof") {
        if (isPositive && cond.left.kind === "IdentifierExpr") {
          const targetName = cond.left.name;
          if (cond.right.kind === "IdentifierExpr") {
            const className = cond.right.name;
            const classType = env.lookupType(className);
            narrowings.set(targetName, classType ?? makeNamedType(className));
          }
        }
        return narrowings;
      }
    }

    return narrowings;
  }

  private checkIfStmt(stmt: IfStmt, env: TypeEnv): Type {
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
        "AICE_E2001_NON_BOOLEAN_CONDITION",
        TYPE_BOOL,
        condType,
      );
    }

    const thenEnv = new TypeEnv(env);
    const posNarrowings = this.extractNarrowings(stmt.condition, true, env);
    for (const [name, narrowedType] of posNarrowings) {
      const existing = env.lookup(name);
      thenEnv.define(name, narrowedType, existing?.isMut ?? false);
    }
    const thenType = this.checkBlock(stmt.thenBranch, thenEnv);

    const elseEnv = new TypeEnv(env);
    const negNarrowings = this.extractNarrowings(stmt.condition, false, env);
    for (const [name, narrowedType] of negNarrowings) {
      const existing = env.lookup(name);
      elseEnv.define(name, narrowedType, existing?.isMut ?? false);
    }

    for (const elif of stmt.elifBranches) {
      const elifCondType = this.checkExpr(elif.condition, elseEnv);
      if (
        !isAssignable(TYPE_BOOL, elifCondType) &&
        elifCondType.kind !== "option" &&
        elifCondType.kind !== "named" &&
        elifCondType.kind !== "record"
      ) {
        throw new TypeCheckError(
          `Condition in 'elif' statement must evaluate strictly to 'bool', got '${formatType(elifCondType)}'. Zero implicit coercion allowed.`,
          elif.condition.span,
          "AICE_E2001_NON_BOOLEAN_CONDITION",
          TYPE_BOOL,
          elifCondType,
        );
      }
      const elifEnv = new TypeEnv(elseEnv);
      const elifPosNarrowings = this.extractNarrowings(elif.condition, true, elseEnv);
      for (const [name, narrowedType] of elifPosNarrowings) {
        const existing = elseEnv.lookup(name);
        elifEnv.define(name, narrowedType, existing?.isMut ?? false);
      }
      this.checkBlock(elif.body, elifEnv);

      const elifNegNarrowings = this.extractNarrowings(elif.condition, false, elseEnv);
      for (const [name, narrowedType] of elifNegNarrowings) {
        const existing = elseEnv.lookup(name);
        elseEnv.define(name, narrowedType, existing?.isMut ?? false);
      }
    }

    if (stmt.elseBranch) {
      const elseType = this.checkBlock(stmt.elseBranch, elseEnv);
      if (stmt.elifBranches.length === 0 && isAssignable(thenType, elseType)) {
        return thenType;
      }
    }
    return thenType;
  }

  public checkStmt(stmt: Statement, env: TypeEnv): Type {
    return this.checkStatement(stmt, env);
  }

  public checkStatement(stmt: Statement, env: TypeEnv): Type {
    switch (stmt.kind) {
      case "LetBinding": {
        let declaredType: Type | undefined;
        let initType: Type;

        if (stmt.typeAnnotation) {
          declaredType = this.resolveTypeExpr(stmt.typeAnnotation, env);
          if (declaredType.kind === "tuple" && stmt.init.kind === "ArrayLiteralExpr") {
            const arr = stmt.init as ArrayLiteralExpr;
            initType = makeTupleType(arr.elements.map((el) => this.checkExpr(el, env)));
          } else {
            initType = this.checkExpr(stmt.init, env, declaredType);
          }
          if (!isAssignable(declaredType, initType)) {
            throw new TypeCheckError(
              `Cannot assign value of type '${formatType(initType)}' to variable '${stmt.name}' of type '${formatType(declaredType)}'`,
              stmt.span,
              "AICE_E2002_TYPE_MISMATCH",
              declaredType,
              initType,
            );
          }
        } else {
          initType = this.checkExpr(stmt.init, env);
          declaredType =
            stmt.isMut &&
            initType.kind === "named" &&
            (initType.name === "true" || initType.name === "false")
              ? TYPE_BOOL
              : stmt.isMut && initType.kind === "named" && isStringLiteralType(initType.name)
                ? TYPE_STR
                : initType;
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
        if (initType.kind === "tuple") {
          for (let i = 0; i < stmt.names.length; i++) {
            const name = stmt.names[i];
            if (!name || name.trim() === "" || name === "_") continue;
            const t = i < initType.elementTypes.length ? initType.elementTypes[i] : TYPE_UNKNOWN;
            env.define(name, t, stmt.isMut);
          }
          return TYPE_VOID;
        }
        let elemType: Type = TYPE_UNKNOWN;
        if (initType.kind === "array") {
          elemType = initType.elementType;
        }
        if (stmt.init.kind === "ArrayLiteralExpr") {
          for (let i = 0; i < stmt.names.length; i++) {
            const name = stmt.names[i];
            if (!name || name.trim() === "" || name === "_") continue;
            const elemExpr = stmt.init.elements[i];
            const t = elemExpr ? this.checkExpr(elemExpr, env) : elemType;
            env.define(name, t, stmt.isMut);
          }
        } else {
          for (const name of stmt.names) {
            if (!name || name.trim() === "" || name === "_") continue;
            env.define(name, elemType, stmt.isMut);
          }
        }
        return TYPE_VOID;
      }

      case "AssignStmt": {
        this.checkAssign(stmt.target, stmt.value, stmt.span, env, stmt.op);
        return TYPE_VOID;
      }

      case "ReturnStmt": {
        const fnEnv = env.getFunctionEnv();
        const expected =
          fnEnv?.currentFunctionReturnType ?? env.currentFunctionReturnType ?? TYPE_VOID;
        const isAsyncOrPromise = (fnEnv?.isAsync ?? false) || isPromiseType(expected);
        const unwrapped = isAsyncOrPromise ? unwrapPromiseType(expected) : expected;

        let actual: Type = TYPE_VOID;
        if (stmt.value) {
          if (expected.kind === "tuple" && stmt.value.kind === "ArrayLiteralExpr") {
            const arr = stmt.value as ArrayLiteralExpr;
            actual = makeTupleType(arr.elements.map((el) => this.checkExpr(el, env)));
          } else {
            actual = this.checkExpr(stmt.value, env, unwrapped);
          }
        }

        if (expected.kind !== "unknown") {
          const matches =
            isAssignable(expected, actual) ||
            (expected.kind === "void" && (actual.kind === "nil" || actual.kind === "void")) ||
            (isAsyncOrPromise && isAssignable(unwrapped, actual));
          if (!matches) {
            throw new TypeCheckError(
              `Return expression of type '${formatType(actual)}' does not match function return type '${formatType(expected)}'`,
              stmt.span,
              "AICE_E2007_RETURN_TYPE_MISMATCH",
              expected,
              actual,
            );
          }
        }

        // Record inferred return type on the innermost enclosing function/closure env
        if (fnEnv) {
          const isBoolType = (t: Type) =>
            t.kind === "bool" || (t.kind === "named" && (t.name === "true" || t.name === "false"));
          const normActual = isBoolType(actual) ? TYPE_BOOL : actual;

          if (!fnEnv.inferredReturnType || fnEnv.inferredReturnType.kind === "void") {
            fnEnv.inferredReturnType = normActual;
          } else {
            const normInferred = isBoolType(fnEnv.inferredReturnType)
              ? TYPE_BOOL
              : fnEnv.inferredReturnType;
            if (normInferred.kind === "bool" && normActual.kind === "bool") {
              fnEnv.inferredReturnType = TYPE_BOOL;
            } else if (
              fnEnv.currentFunctionReturnType?.kind === "unknown" &&
              !isAssignable(normInferred, normActual)
            ) {
              throw new TypeCheckError(
                `Return expression of type '${formatType(actual)}' does not match previously inferred return type '${formatType(fnEnv.inferredReturnType)}'`,
                stmt.span,
                "AICE_E2007_RETURN_TYPE_MISMATCH",
                fnEnv.inferredReturnType,
                actual,
              );
            }
          }
        }

        return actual;
      }

      case "IfStmt": {
        return this.checkIfStmt(stmt, env);
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
                "AICE_E2001_NON_BOOLEAN_CONDITION",
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
        const elemType = iterType.kind === "array" ? iterType.elementType : TYPE_UNKNOWN;

        if (stmt.variable.startsWith("[") && stmt.variable.endsWith("]")) {
          this.bindParameter(stmt.variable, elemType, loopEnv, false);
        } else {
          loopEnv.define(stmt.variable, elemType, false);
        }

        if (iterType.kind !== "unknown" && iterType.kind !== "array") {
          throw new TypeCheckError(
            `Cannot iterate over non-array type '${formatType(iterType)}'`,
            stmt.iterable.span,
            "AICE_E2009_NON_ITERABLE_TYPE",
          );
        }

        this.checkBlock(stmt.body, loopEnv);
        return TYPE_VOID;
      }

      case "WhileStmt": {
        const condType = this.checkExpr(stmt.condition, env);
        if (
          !isAssignable(TYPE_BOOL, condType) &&
          condType.kind !== "option" &&
          condType.kind !== "named" &&
          condType.kind !== "record"
        ) {
          throw new TypeCheckError(
            `Condition in 'while' statement must evaluate strictly to 'bool', got '${formatType(condType)}'. Zero implicit coercion allowed.`,
            stmt.condition.span,
            "AICE_E2001_NON_BOOLEAN_CONDITION",
            TYPE_BOOL,
            condType,
          );
        }
        const whileEnv = new TypeEnv(env);
        const posNarrowings = this.extractNarrowings(stmt.condition, true, env);
        for (const [name, narrowedType] of posNarrowings) {
          const existing = env.lookup(name);
          whileEnv.define(name, narrowedType, existing?.isMut ?? false);
        }
        this.checkBlock(stmt.body, whileEnv);
        return TYPE_VOID;
      }

      case "ExprStmt": {
        return this.checkExpr(stmt.expr, env);
      }

      case "TryStmt": {
        const tryType = this.checkBlock(stmt.tryBlock, env);
        if (stmt.catchBlock) {
          const catchEnv = env.extend();
          if (stmt.catchParam) {
            catchEnv.define(stmt.catchParam, TYPE_UNKNOWN, false);
          }
          this.checkBlock(stmt.catchBlock, catchEnv);
        }
        if (stmt.finallyBlock) {
          this.checkBlock(stmt.finallyBlock, env);
        }
        return tryType;
      }

      case "ThrowStmt": {
        this.checkExpr(stmt.expr, env);
        return TYPE_VOID;
      }

      case "BreakStmt": {
        return TYPE_VOID;
      }

      case "ContinueStmt": {
        return TYPE_VOID;
      }
    }
  }

  checkExpr(expr: Expr, env: TypeEnv, expectedType?: Type): Type {
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
        if (expr.literalKind === "string") {
          if (expectedType) {
            const targetType =
              expectedType.kind === "option" ? expectedType.innerType : expectedType;
            if (this.isMatchingStringContext(expr.value, targetType, env)) {
              return { kind: "named", name: JSON.stringify(expr.value) };
            }
            if (targetType.kind === "named" && isOpaqueNamedType(targetType.name)) {
              let alias = lookupTypeAlias(targetType.name);
              if (alias && alias.kind === "named" && alias.name === targetType.name) {
                alias = undefined;
              }
              if (alias && this.isMatchingStringContext(expr.value, alias, env)) {
                return { kind: "named", name: JSON.stringify(expr.value) };
              }
              const resolved = env.lookupType(targetType.name);
              if (
                !alias &&
                (!resolved || (resolved.kind === "named" && resolved.name === targetType.name))
              ) {
                return targetType;
              }
            }
          }
          return TYPE_STR;
        }
        if (expr.literalKind === "boolean") {
          return { kind: "named", name: expr.value ? "true" : "false" };
        }
        if (expr.literalKind === "nil") return TYPE_NIL;
        return TYPE_UNKNOWN;
      }

      case "StringLiteralExpr" as any: {
        const strVal = (expr as any).value;
        if (expectedType) {
          const targetType = expectedType.kind === "option" ? expectedType.innerType : expectedType;
          if (this.isMatchingStringContext(strVal, targetType, env)) {
            return { kind: "named", name: JSON.stringify(strVal) };
          }
          if (targetType.kind === "named" && isOpaqueNamedType(targetType.name)) {
            let alias = lookupTypeAlias(targetType.name);
            if (alias && alias.kind === "named" && alias.name === targetType.name) {
              alias = undefined;
            }
            if (alias && this.isMatchingStringContext(strVal, alias, env)) {
              return { kind: "named", name: JSON.stringify(strVal) };
            }
            const resolved = env.lookupType(targetType.name);
            if (
              !alias &&
              (!resolved || (resolved.kind === "named" && resolved.name === targetType.name))
            ) {
              return targetType;
            }
          }
        }
        return TYPE_STR;
      }

      case "TemplateLiteralExpr": {
        for (const subExpr of expr.expressions) {
          this.checkExpr(subExpr, env);
        }
        return TYPE_STR;
      }

      case "IdentifierExpr": {
        const binding = env.lookup(expr.name);
        if (!binding) {
          throw new TypeCheckError(
            `Undeclared identifier '${expr.name}'`,
            expr.span,
            "AICE_E2008_UNDECLARED_VARIABLE",
          );
        }
        return binding.type;
      }

      case "BinaryExpr": {
        if ((expr.operator as any) === "=") {
          return this.checkAssign(expr.left, expr.right, expr.span, env, "=");
        }
        if (
          ["+=", "-=", "*=", "/=", "%=", "**=", "&=", "|=", "^=", "<<=", ">>=", ">>>="].includes(
            expr.operator as any,
          )
        ) {
          return this.checkAssign(expr.left, expr.right, expr.span, env, expr.operator as any);
        }

        const leftType = this.checkExpr(expr.left, env);
        const rightExpected =
          expr.operator === "==" || expr.operator === "!=" ? leftType : undefined;
        const rightType = this.checkExpr(expr.right, env, rightExpected);

        // Zero Implicit Coercion Checks
        switch (expr.operator) {
          case "+":
            if (leftType.kind === "unknown" || rightType.kind === "unknown") {
              return TYPE_UNKNOWN;
            }
            if (isStringType(leftType) && isStringType(rightType)) {
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
              "AICE_E2002_TYPE_MISMATCH",
            );

          case "-":
          case "*":
          case "%":
          case "**":
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
              "AICE_E2002_TYPE_MISMATCH",
            );

          case "&":
          case "|":
          case "^":
          case "<<":
          case ">>":
          case ">>>":
            if (leftType.kind === "unknown" || rightType.kind === "unknown") {
              return TYPE_UNKNOWN;
            }
            if (isNumeric(leftType) && isNumeric(rightType)) {
              return TYPE_INT;
            }
            throw new TypeCheckError(
              `Operator '${expr.operator}' requires numeric operands, got '${formatType(leftType)}' and '${formatType(rightType)}'`,
              expr.span,
              "AICE_E2002_TYPE_MISMATCH",
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
                "AICE_E2003_DIVISION_BY_ZERO",
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
              "AICE_E2002_TYPE_MISMATCH",
            );

          case "==":
          case "!=":
            return TYPE_BOOL;

          case "in": {
            if (leftType.kind === "unknown" || rightType.kind === "unknown") {
              return TYPE_BOOL;
            }
            if (!isValidInKeyType(leftType, env)) {
              throw new TypeCheckError(
                `Left operand of 'in' must be a key (string, number, or any), got '${formatType(leftType)}'`,
                expr.left.span,
                "AICE_E2002_TYPE_MISMATCH",
                TYPE_STR,
                leftType,
              );
            }
            if (!isValidInTargetType(rightType, env)) {
              throw new TypeCheckError(
                `Right operand of 'in' must be an object, record, map, or array, got '${formatType(rightType)}'`,
                expr.right.span,
                "AICE_E2002_TYPE_MISMATCH",
              );
            }
            return TYPE_BOOL;
          }

          case "instanceof": {
            if (leftType.kind === "unknown" || rightType.kind === "unknown") {
              return TYPE_BOOL;
            }
            if (!isValidInstanceofTargetType(leftType, env)) {
              throw new TypeCheckError(
                `Left operand of 'instanceof' must be an object, instance, or any, got '${formatType(leftType)}'`,
                expr.left.span,
                "AICE_E2002_TYPE_MISMATCH",
              );
            }
            if (!isValidInstanceofClassType(rightType, env)) {
              throw new TypeCheckError(
                `Right operand of 'instanceof' must be a class, constructor, or any, got '${formatType(rightType)}'`,
                expr.right.span,
                "AICE_E2002_TYPE_MISMATCH",
              );
            }
            return TYPE_BOOL;
          }

          case "<":
          case "<=":
          case ">":
          case ">=": {
            const l = leftType.kind === "option" ? leftType.innerType : leftType;
            const r = rightType.kind === "option" ? rightType.innerType : rightType;
            if (l.kind === "unknown" || r.kind === "unknown") {
              return TYPE_BOOL;
            }
            if ((isNumeric(l) && isNumeric(r)) || (isStringType(l) && isStringType(r))) {
              return TYPE_BOOL;
            }
            throw new TypeCheckError(
              `Comparison '${expr.operator}' cannot compare '${formatType(leftType)}' with '${formatType(rightType)}'`,
              expr.span,
              "AICE_E2002_TYPE_MISMATCH",
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
        if (expr.operator === "...") {
          if (opType.kind === "array") {
            return opType.elementType;
          }
          if (opType.kind === "tuple" && opType.elementTypes.length > 0) {
            const first = opType.elementTypes[0];
            if (
              opType.elementTypes.every((t) => isAssignable(first, t) && isAssignable(t, first))
            ) {
              return first;
            }
          }
          return opType;
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
          "AICE_E2002_TYPE_MISMATCH",
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

        let calleeType: Type;
        if (expr.callee.kind === "IdentifierExpr") {
          const name = expr.callee.name;
          const resolved = env.lookup(name);
          if (resolved && resolved.type.kind !== "function" && resolved.type.kind !== "unknown") {
            const globalFn = GLOBAL_SYMBOLS[name] ?? env.lookupGlobal(name)?.type;
            if (globalFn && globalFn.kind === "function") {
              calleeType = globalFn;
            } else {
              calleeType = resolved.type;
            }
          } else {
            calleeType = this.checkExpr(expr.callee, env);
          }
        } else {
          calleeType = this.checkExpr(expr.callee, env);
        }
        if (calleeType.kind === "option") {
          calleeType = calleeType.innerType;
        }
        if (calleeType.kind === "unknown") {
          for (const arg of expr.args) {
            this.checkExpr(arg, env);
          }
          return TYPE_UNKNOWN;
        }
        if (calleeType.kind === "named") {
          if (
            calleeType.name.includes("=>") ||
            calleeType.name.includes("->") ||
            calleeType.name === "Function"
          ) {
            for (const arg of expr.args) {
              this.checkExpr(arg, env);
            }
            return TYPE_UNKNOWN;
          }
        }
        if (
          calleeType.kind === "record" &&
          (calleeType.name === "Date" ||
            calleeType.name === "Buffer" ||
            calleeType.name === "Array" ||
            calleeType.name === "Promise")
        ) {
          for (const arg of expr.args) {
            this.checkExpr(arg, env);
          }
          if (calleeType.name === "Date") return makeNamedType("Date");
          if (calleeType.name === "Buffer") return makeNamedType("Buffer");
          if (calleeType.name === "Array") return makeArrayType(TYPE_UNKNOWN);
          if (calleeType.name === "Promise") return makeNamedType("Promise", [TYPE_UNKNOWN]);
        }
        if (calleeType.kind !== "function") {
          throw new TypeCheckError(
            `Cannot call non-function of type '${formatType(calleeType)}'`,
            expr.callee.span,
            "AICE_E2010_NOT_CALLABLE",
          );
        }

        return this.typecheckInvocation(calleeType, expr.args, expr.span, env);
      }

      case "MemberAccessExpr": {
        const objType = this.checkExpr(expr.object, env);
        if (objType.kind === "unknown" || objType.kind === "nil") {
          return TYPE_UNKNOWN;
        }
        const effectiveType = objType.kind === "option" ? objType.innerType : objType;
        if (effectiveType.kind === "unknown" || effectiveType.kind === "nil") {
          return TYPE_UNKNOWN;
        }
        if (effectiveType.kind === "named") {
          const resolved = env.lookupType(effectiveType.name);
          if (resolved && resolved.kind === "record") {
            const memberType = resolved.fields.get(expr.property);
            if (memberType && memberType.kind !== "function") {
              return expr.isSafeNav || objType.kind === "option"
                ? makeOptionType(memberType)
                : memberType;
            }
          }
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
        if (effectiveType.kind === "record" && effectiveType.isClass) {
          return TYPE_UNKNOWN;
        }
        throw new TypeCheckError(
          `Property '${expr.property}' does not exist on type '${formatType(objType)}'`,
          expr.span,
          "AICE_E2011_UNKNOWN_PROPERTY",
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
            isStringType(idxType) &&
            expr.index.kind === "LiteralExpr" &&
            typeof expr.index.value === "string"
          ) {
            return objType.fields.get(expr.index.value) ?? TYPE_UNKNOWN;
          }
          return TYPE_UNKNOWN;
        }

        const targetObj = objType.kind === "option" ? objType.innerType : objType;

        if (targetObj.kind === "unknown") {
          return TYPE_UNKNOWN;
        }

        if (targetObj.kind === "tuple") {
          if (!isAssignable(TYPE_INT, idxType) && idxType.kind !== "unknown") {
            throw new TypeCheckError(
              `Tuple index must be of type 'int', got '${formatType(idxType)}'`,
              expr.index.span,
              "AICE_E2002_TYPE_MISMATCH",
              TYPE_INT,
              idxType,
            );
          }
          if (expr.index.kind === "LiteralExpr" && typeof expr.index.value === "number") {
            const idx = expr.index.value;
            if (idx < 0 || idx >= targetObj.elementTypes.length) {
              throw new TypeCheckError(
                `Tuple index ${idx} out of bounds for tuple type '${formatType(targetObj)}'`,
                expr.index.span,
                "AICE_E2002_TYPE_MISMATCH",
              );
            }
            return targetObj.elementTypes[idx];
          }
          return TYPE_UNKNOWN;
        }

        if (targetObj.kind === "array") {
          if (!isAssignable(TYPE_INT, idxType) && idxType.kind !== "unknown") {
            throw new TypeCheckError(
              `Array index must be of type 'int', got '${formatType(idxType)}'`,
              expr.index.span,
              "AICE_E2002_TYPE_MISMATCH",
              TYPE_INT,
              idxType,
            );
          }
          return targetObj.elementType;
        }

        throw new TypeCheckError(
          `Cannot index non-array type '${formatType(objType)}'`,
          expr.object.span,
          "AICE_E2012_NOT_INDEXABLE",
        );
      }

      case "ArrayLiteralExpr": {
        const expectedElemType =
          expectedType && expectedType.kind === "array" ? expectedType.elementType : undefined;

        if (expr.elements.length === 0) {
          return expectedElemType ? makeArrayType(expectedElemType) : makeArrayType(TYPE_UNKNOWN);
        }
        const elementTypes = expr.elements.map((el) => this.checkExpr(el, env, expectedElemType));
        if (expectedElemType && elementTypes.every((t) => isAssignable(expectedElemType, t))) {
          return makeArrayType(expectedElemType);
        }
        const firstType = elementTypes[0];
        const allMatch = elementTypes.every(
          (t) => isAssignable(firstType, t) && isAssignable(t, firstType),
        );
        if (!allMatch) {
          if (
            elementTypes.every(
              (t) =>
                isAssignable(TYPE_BOOL, t) ||
                (t.kind === "named" && (t.name === "true" || t.name === "false")),
            )
          ) {
            return makeArrayType(TYPE_BOOL);
          }
          if (elementTypes.every((t) => isAssignable(TYPE_STR, t))) {
            return makeArrayType(TYPE_STR);
          }
          return makeTupleType(elementTypes);
        }
        return makeArrayType(firstType);
      }

      case "RecordLiteralExpr": {
        const fields = new Map<string, Type>();
        const expectedRecordFields =
          expectedType && expectedType.kind === "record"
            ? expectedType.fields
            : expectedType && expectedType.kind === "named"
              ? (env.lookupType(expectedType.name) as RecordTypeRep | undefined)?.fields
              : undefined;

        let genericRecordValType: Type | undefined;
        if (
          expectedType &&
          expectedType.kind === "named" &&
          expectedType.name === "Record" &&
          expectedType.typeArgs &&
          expectedType.typeArgs.length === 2
        ) {
          genericRecordValType = expectedType.typeArgs[1];
        } else if (expectedType && expectedType.kind === "named") {
          const found = env.lookupType(expectedType.name) ?? lookupTypeAlias(expectedType.name);
          if (
            found &&
            found.kind === "named" &&
            found.name === "Record" &&
            found.typeArgs &&
            found.typeArgs.length === 2
          ) {
            genericRecordValType = found.typeArgs[1];
          }
        }

        for (const prop of expr.properties) {
          const expectedPropType =
            prop.key && expectedRecordFields
              ? expectedRecordFields.get(prop.key)
              : genericRecordValType;
          const valType = this.checkExpr(prop.value, env, expectedPropType);
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

      case "AwaitExpr": {
        const operandType = this.checkExpr(expr.operand, env);
        if (
          operandType.kind === "named" &&
          operandType.name === "Promise" &&
          operandType.typeArgs &&
          operandType.typeArgs.length > 0
        ) {
          return operandType.typeArgs[0];
        }
        return operandType;
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
              "AICE_E2004_CANNOT_UNWRAP_RESULT",
            );
          }

          if (!isAssignable(currentFnRet.errType, operandType.errType)) {
            throw new TypeCheckError(
              `Error type '${formatType(operandType.errType)}' in '?' unwrap cannot be returned by function expecting error type '${formatType(currentFnRet.errType)}'`,
              expr.span,
              "AICE_E2004_CANNOT_UNWRAP_RESULT",
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
            "AICE_E2004_CANNOT_UNWRAP_RESULT",
          );
        }

        throw new TypeCheckError(
          `Postfix '?' unwrap can only be applied to 'Result' or 'Option' types, got '${formatType(operandType)}'`,
          expr.span,
          "AICE_E2004_CANNOT_UNWRAP_RESULT",
        );
      }

      case "ClosureExpr": {
        let expectedRetType: Type | undefined;
        let expectedParamTypes: Type[] | undefined;
        if (expectedType && expectedType.kind === "function") {
          expectedRetType = expectedType.returnType;
          expectedParamTypes = expectedType.params.map((p) => p.type);
        }

        const params = expr.params.map((p, idx) => ({
          name: p.name,
          type: p.typeAnnotation
            ? this.resolveTypeExpr(p.typeAnnotation, env)
            : expectedParamTypes && idx < expectedParamTypes.length
              ? expectedParamTypes[idx]
              : TYPE_UNKNOWN,
          optional: Boolean(
            p.defaultValue !== undefined || p.isOptional || p.typeAnnotation?.kind === "OptionType",
          ),
          rest: Boolean(p.isRest),
        }));
        let returnType = expr.returnType
          ? this.resolveTypeExpr(expr.returnType, env)
          : expectedRetType;

        const isAsyncClosure = !!expr.isAsync;
        const isAsyncOrPromise = isAsyncClosure || isPromiseType(returnType);
        const targetCheckType =
          isAsyncOrPromise && returnType ? unwrapPromiseType(returnType) : returnType;

        const closureEnv = new TypeEnv(env, returnType ?? TYPE_UNKNOWN, true, isAsyncClosure);
        for (const p of params) {
          this.bindParameter(p.name, p.type, closureEnv, true);
        }

        if (expr.body.kind === "Block") {
          const bodyType = this.checkBlock(expr.body, closureEnv);
          const effectiveReturnType =
            closureEnv.inferredReturnType && closureEnv.inferredReturnType.kind !== "void"
              ? closureEnv.inferredReturnType
              : bodyType;
          if (returnType) {
            if (returnType.kind !== "void") {
              const matches =
                isAssignable(returnType, effectiveReturnType) ||
                (isAsyncOrPromise &&
                  targetCheckType &&
                  isAssignable(targetCheckType, effectiveReturnType));
              if (!matches) {
                throw new TypeCheckError(
                  `Closure body evaluates to '${formatType(effectiveReturnType)}', but returns '${formatType(returnType)}'`,
                  expr.body.span,
                  "AICE_E2007_RETURN_TYPE_MISMATCH",
                  returnType,
                  effectiveReturnType,
                );
              }
            }
          } else {
            let inferred = effectiveReturnType;
            if (isAsyncClosure) {
              inferred = isPromiseType(inferred) ? inferred : makeNamedType("Promise", [inferred]);
            }
            returnType = inferred;
          }
        } else {
          const bodyType = this.checkExpr(expr.body, closureEnv, targetCheckType ?? undefined);
          if (returnType) {
            const matches =
              isAssignable(returnType, bodyType) ||
              (isAsyncOrPromise && targetCheckType && isAssignable(targetCheckType, bodyType));
            if (!matches) {
              throw new TypeCheckError(
                `Closure body evaluates to '${formatType(bodyType)}', but returns '${formatType(returnType)}'`,
                expr.body.span,
                "AICE_E2007_RETURN_TYPE_MISMATCH",
                returnType,
                bodyType,
              );
            }
          } else {
            let inferred = bodyType;
            if (isAsyncClosure) {
              inferred = isPromiseType(inferred) ? inferred : makeNamedType("Promise", [inferred]);
            }
            returnType = inferred;
          }
        }

        return makeFunctionType(
          params,
          returnType ?? (isAsyncClosure ? makeNamedType("Promise", [TYPE_VOID]) : TYPE_VOID),
        );
      }

      case "AssignExpr": {
        return this.checkAssign(expr.target, expr.value, expr.span, env, expr.op);
      }
    }

    throw new Error(`Unhandled expression kind: ${(expr as any).kind}`);
  }

  private checkAssign(target: Expr, value: Expr, span: Span, env: TypeEnv, op?: AssignOp): Type {
    if (target.kind === "IdentifierExpr") {
      const binding = env.lookup(target.name);
      if (!binding) {
        throw new TypeCheckError(
          `Cannot assign to undeclared identifier '${target.name}'`,
          target.span,
          "AICE_E2008_UNDECLARED_VARIABLE",
        );
      }
      if (!binding.isMut) {
        throw new TypeCheckError(
          `Cannot assign to immutable variable '${target.name}'. Declare with 'let mut ${target.name}' to allow mutation.`,
          span,
          "AICE_E2005_IMMUTABLE_ASSIGNMENT",
        );
      }
      let valType: Type;
      if (
        (!op || op === "=") &&
        binding.type.kind === "tuple" &&
        value.kind === "ArrayLiteralExpr"
      ) {
        const arr = value as ArrayLiteralExpr;
        valType = makeTupleType(arr.elements.map((el) => this.checkExpr(el, env)));
      } else {
        valType = this.checkExpr(value, env, binding.type);
      }
      return this.checkCompoundOrSimpleAssign(
        op,
        binding.type,
        valType,
        span,
        `variable '${target.name}'`,
        value,
      );
    } else if (target.kind === "ArrayLiteralExpr") {
      const valType = this.checkExpr(value, env);
      if (value.kind === "ArrayLiteralExpr") {
        for (let i = 0; i < target.elements.length; i++) {
          const tElem = target.elements[i];
          const vElem = value.elements[i];
          if (tElem && vElem) {
            this.checkAssign(tElem, vElem, span, env, op);
          }
        }
      } else {
        if (op && op !== "=") {
          throw new TypeCheckError(
            `Compound assignment operator '${op}' cannot be used with non-array value in vector assignment`,
            span,
            "AICE_E2002_TYPE_MISMATCH",
          );
        }
        for (const tElem of target.elements) {
          if (tElem.kind === "IdentifierExpr") {
            const binding = env.lookup(tElem.name);
            if (!binding) {
              throw new TypeCheckError(
                `Cannot assign to undeclared identifier '${tElem.name}'`,
                tElem.span,
                "AICE_E2008_UNDECLARED_VARIABLE",
              );
            }
            if (!binding.isMut) {
              throw new TypeCheckError(
                `Cannot assign to immutable variable '${tElem.name}'. Declare with 'let mut ${tElem.name}' or '::=' to allow mutation.`,
                span,
                "AICE_E2005_IMMUTABLE_ASSIGNMENT",
              );
            }
          }
        }
      }
      return valType;
    } else if (target.kind === "MemberAccessExpr") {
      const objType = this.checkExpr(target.object, env);
      let effectiveType = objType.kind === "option" ? objType.innerType : objType;
      if (effectiveType.kind === "named") {
        const resolved = env.lookupType(effectiveType.name);
        if (resolved) {
          effectiveType = resolved;
        }
      }

      if (effectiveType.kind === "record") {
        const setterName = `set_${target.property}`;
        const getterName = `get_${target.property}`;
        const hasSetter = effectiveType.fields.has(setterName);
        const hasGetter = effectiveType.fields.has(getterName);

        if (hasSetter) {
          const setterType = effectiveType.fields.get(setterName)!;
          let expectedType: Type = TYPE_UNKNOWN;
          if (setterType.kind === "function" && setterType.params.length > 0) {
            expectedType = setterType.params[0].type;
          }
          const valType = this.checkExpr(value, env, expectedType);
          return this.checkCompoundOrSimpleAssign(
            op,
            expectedType,
            valType,
            span,
            `property '${target.property}'`,
            value,
          );
        } else if (hasGetter) {
          throw new TypeCheckError(
            `Cannot assign to getter-only property '${target.property}'`,
            span,
            "AICE_E2005_IMMUTABLE_ASSIGNMENT",
          );
        }
      }

      const targetType = this.checkExpr(target, env);
      const valType = this.checkExpr(value, env, targetType);
      return this.checkCompoundOrSimpleAssign(
        op,
        targetType,
        valType,
        span,
        `property '${target.property}'`,
        value,
      );
    } else {
      const targetType = this.checkExpr(target, env);
      const valType = this.checkExpr(value, env, targetType);
      return this.checkCompoundOrSimpleAssign(op, targetType, valType, span, "target", value);
    }
  }

  private checkCompoundOrSimpleAssign(
    op: AssignOp | undefined,
    targetType: Type,
    valType: Type,
    span: Span,
    targetDesc: string,
    value?: Expr,
  ): Type {
    if (!op || op === "=") {
      if (!isAssignable(targetType, valType)) {
        throw new TypeCheckError(
          `Cannot assign '${formatType(valType)}' to ${targetDesc} of type '${formatType(targetType)}'`,
          span,
          "AICE_E2002_TYPE_MISMATCH",
          targetType,
          valType,
        );
      }
      return valType;
    }

    switch (op) {
      case "|=":
      case "^=":
      case "&=":
      case "<<=":
      case ">>=":
      case ">>>=": {
        if (
          (targetType.kind !== "unknown" && !isNumeric(targetType)) ||
          (valType.kind !== "unknown" && !isNumeric(valType))
        ) {
          throw new TypeCheckError(
            `Operator '${op}' requires numeric operands, got '${formatType(targetType)}' and '${formatType(valType)}'`,
            span,
            "AICE_E2002_TYPE_MISMATCH",
          );
        }
        const resType = TYPE_INT;
        if (!isAssignable(targetType, resType)) {
          throw new TypeCheckError(
            `Cannot assign result of '${op}' ('${formatType(resType)}') to ${targetDesc} of type '${formatType(targetType)}'`,
            span,
            "AICE_E2002_TYPE_MISMATCH",
            targetType,
            resType,
          );
        }
        return resType;
      }

      case "-=":
      case "*=":
      case "%=":
      case "**=": {
        if (
          (targetType.kind !== "unknown" && !isNumeric(targetType)) ||
          (valType.kind !== "unknown" && !isNumeric(valType))
        ) {
          throw new TypeCheckError(
            `Operator '${op}' requires numeric operands, got '${formatType(targetType)}' and '${formatType(valType)}'`,
            span,
            "AICE_E2002_TYPE_MISMATCH",
          );
        }
        if (targetType.kind === "unknown" || valType.kind === "unknown") {
          return targetType.kind !== "unknown" ? targetType : valType;
        }
        const resType =
          targetType.kind === "float" || valType.kind === "float" ? TYPE_FLOAT : TYPE_INT;
        if (!isAssignable(targetType, resType)) {
          throw new TypeCheckError(
            `Cannot assign result of '${op}' ('${formatType(resType)}') to ${targetDesc} of type '${formatType(targetType)}'`,
            span,
            "AICE_E2002_TYPE_MISMATCH",
            targetType,
            resType,
          );
        }
        return resType;
      }

      case "/=": {
        if (value && value.kind === "LiteralExpr" && (value.value === 0 || value.value === "0")) {
          throw new TypeCheckError(
            "Division by zero detected at compile time",
            value.span,
            "AICE_E2003_DIVISION_BY_ZERO",
          );
        }
        if (
          (targetType.kind !== "unknown" && !isNumeric(targetType)) ||
          (valType.kind !== "unknown" && !isNumeric(valType))
        ) {
          throw new TypeCheckError(
            `Division requires numeric operands, got '${formatType(targetType)}' and '${formatType(valType)}'`,
            span,
            "AICE_E2002_TYPE_MISMATCH",
          );
        }
        if (targetType.kind === "unknown" || valType.kind === "unknown") {
          return targetType.kind !== "unknown" ? targetType : TYPE_FLOAT;
        }
        const resType = TYPE_FLOAT;
        if (!isAssignable(targetType, resType)) {
          throw new TypeCheckError(
            `Cannot assign result of '/=' ('${formatType(resType)}') to ${targetDesc} of type '${formatType(targetType)}'`,
            span,
            "AICE_E2002_TYPE_MISMATCH",
            targetType,
            resType,
          );
        }
        return resType;
      }

      case "+=": {
        if (
          (isStringType(targetType) || targetType.kind === "unknown") &&
          (isStringType(valType) || valType.kind === "unknown") &&
          (isStringType(targetType) || isStringType(valType))
        ) {
          const resType = TYPE_STR;
          if (!isAssignable(targetType, resType)) {
            throw new TypeCheckError(
              `Cannot assign '${formatType(resType)}' to ${targetDesc} of type '${formatType(targetType)}'`,
              span,
              "AICE_E2002_TYPE_MISMATCH",
              targetType,
              resType,
            );
          }
          return resType;
        }
        if (
          (isNumeric(targetType) || targetType.kind === "unknown") &&
          (isNumeric(valType) || valType.kind === "unknown")
        ) {
          const resType =
            targetType.kind === "float" || valType.kind === "float" ? TYPE_FLOAT : TYPE_INT;
          if (!isAssignable(targetType, resType)) {
            throw new TypeCheckError(
              `Cannot assign result of '+=' ('${formatType(resType)}') to ${targetDesc} of type '${formatType(targetType)}'`,
              span,
              "AICE_E2002_TYPE_MISMATCH",
              targetType,
              resType,
            );
          }
          return resType;
        }
        throw new TypeCheckError(
          `Operator '+=' cannot be applied to disparate types '${formatType(targetType)}' and '${formatType(valType)}'. Explicit conversion required.`,
          span,
          "AICE_E2002_TYPE_MISMATCH",
        );
      }
    }
  }

  private typecheckInvocation(
    fnType: {
      params: { name: string; type: Type; optional?: boolean; rest?: boolean }[];
      returnType: Type;
    },
    args: Expr[],
    span: Span,
    env: TypeEnv,
  ): Type {
    const hasSpread = args.some(
      (arg) => arg.kind === "UnaryExpr" && (arg as UnaryExpr).operator === "...",
    );
    const lastParam =
      fnType.params.length > 0 ? fnType.params[fnType.params.length - 1] : undefined;
    const hasRest = Boolean(lastParam?.rest);
    const minParams = fnType.params.filter((p) => !p.optional && !p.rest).length;
    if (
      !hasSpread &&
      (args.length < minParams || (!hasRest && args.length > fnType.params.length))
    ) {
      throw new TypeCheckError(
        `Function expects between ${minParams} and ${fnType.params.length} arguments, got ${args.length}`,
        span,
        "AICE_E2013_ARGUMENT_COUNT_MISMATCH",
      );
    }

    if (!hasSpread) {
      for (let i = 0; i < args.length; i++) {
        if (hasRest && lastParam && i >= fnType.params.length - 1) {
          const restParamType = lastParam.type;
          const elementType =
            restParamType.kind === "array" ? restParamType.elementType : restParamType;
          let argType: Type;
          if (elementType.kind === "tuple" && args[i].kind === "ArrayLiteralExpr") {
            const arr = args[i] as ArrayLiteralExpr;
            argType = makeTupleType(arr.elements.map((el) => this.checkExpr(el, env)));
          } else {
            argType = this.checkExpr(args[i], env, elementType);
          }
          const isDirectArray =
            i === fnType.params.length - 1 &&
            args.length === fnType.params.length &&
            isAssignable(restParamType, argType);
          const isOptionalParam = Boolean(lastParam.optional);
          const acceptsNil = isOptionalParam && argType.kind === "nil";
          if (!isDirectArray && !isAssignable(elementType, argType) && !acceptsNil) {
            throw new TypeCheckError(
              `Argument ${i + 1} of type '${formatType(argType)}' is not assignable to expected type '${formatType(elementType)}'`,
              args[i].span,
              "AICE_E2002_TYPE_MISMATCH",
              elementType,
              argType,
            );
          }
        } else {
          const expectedType = fnType.params[i].type;
          let argType: Type;
          if (expectedType.kind === "tuple" && args[i].kind === "ArrayLiteralExpr") {
            const arr = args[i] as ArrayLiteralExpr;
            argType = makeTupleType(arr.elements.map((el) => this.checkExpr(el, env)));
          } else {
            argType = this.checkExpr(args[i], env, expectedType);
          }
          const isOptionalParam = Boolean(fnType.params[i].optional);
          const acceptsNil =
            (isOptionalParam || isStringType(expectedType)) && argType.kind === "nil";
          if (!isAssignable(expectedType, argType) && !acceptsNil) {
            throw new TypeCheckError(
              `Argument ${i + 1} of type '${formatType(argType)}' is not assignable to expected type '${formatType(expectedType)}'`,
              args[i].span,
              "AICE_E2002_TYPE_MISMATCH",
              expectedType,
              argType,
            );
          }
        }
      }
    } else {
      let paramIdx = 0;
      for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg.kind === "UnaryExpr" && (arg as UnaryExpr).operator === "...") {
          const spreadOperandType = this.checkExpr((arg as UnaryExpr).operand, env);
          if (spreadOperandType.kind === "tuple") {
            for (const elemType of spreadOperandType.elementTypes) {
              if (paramIdx < fnType.params.length) {
                const expectedType = fnType.params[paramIdx].type;
                const isOptionalParam = Boolean(fnType.params[paramIdx].optional);
                const acceptsNil = isOptionalParam && elemType.kind === "nil";
                if (!isAssignable(expectedType, elemType) && !acceptsNil) {
                  throw new TypeCheckError(
                    `Argument spread element of type '${formatType(elemType)}' is not assignable to expected type '${formatType(expectedType)}'`,
                    arg.span,
                    "AICE_E2002_TYPE_MISMATCH",
                    expectedType,
                    elemType,
                  );
                }
                paramIdx++;
              }
            }
          } else if (spreadOperandType.kind === "array") {
            const elemType = spreadOperandType.elementType;
            const remainingNonSpread = args
              .slice(i + 1)
              .filter(
                (a) => !(a.kind === "UnaryExpr" && (a as UnaryExpr).operator === "..."),
              ).length;
            const targetParamEnd = Math.max(paramIdx, fnType.params.length - remainingNonSpread);
            if (paramIdx >= targetParamEnd && paramIdx < fnType.params.length) {
              const expectedType = fnType.params[paramIdx].type;
              if (!isAssignable(expectedType, elemType)) {
                throw new TypeCheckError(
                  `Argument spread of element type '${formatType(elemType)}' is not assignable to expected type '${formatType(expectedType)}'`,
                  arg.span,
                  "AICE_E2002_TYPE_MISMATCH",
                  expectedType,
                  elemType,
                );
              }
              paramIdx++;
            } else {
              while (paramIdx < targetParamEnd) {
                const expectedType = fnType.params[paramIdx].type;
                if (!isAssignable(expectedType, elemType)) {
                  throw new TypeCheckError(
                    `Argument spread of element type '${formatType(elemType)}' is not assignable to expected type '${formatType(expectedType)}'`,
                    arg.span,
                    "AICE_E2002_TYPE_MISMATCH",
                    expectedType,
                    elemType,
                  );
                }
                paramIdx++;
              }
            }
          } else {
            if (paramIdx < fnType.params.length) {
              const expectedType = fnType.params[paramIdx].type;
              if (!isAssignable(expectedType, spreadOperandType)) {
                throw new TypeCheckError(
                  `Argument spread of type '${formatType(spreadOperandType)}' is not assignable to expected type '${formatType(expectedType)}'`,
                  arg.span,
                  "AICE_E2002_TYPE_MISMATCH",
                  expectedType,
                  spreadOperandType,
                );
              }
              paramIdx++;
            }
          }
        } else {
          if (paramIdx < fnType.params.length) {
            const expectedType = fnType.params[paramIdx].type;
            let argType: Type;
            if (expectedType.kind === "tuple" && arg.kind === "ArrayLiteralExpr") {
              const arr = arg as ArrayLiteralExpr;
              argType = makeTupleType(arr.elements.map((el) => this.checkExpr(el, env)));
            } else {
              argType = this.checkExpr(arg, env, expectedType);
            }
            const isOptionalParam = Boolean(fnType.params[paramIdx].optional);
            const acceptsNil = isOptionalParam && argType.kind === "nil";
            if (!isAssignable(expectedType, argType) && !acceptsNil) {
              throw new TypeCheckError(
                `Argument ${i + 1} of type '${formatType(argType)}' is not assignable to expected type '${formatType(expectedType)}'`,
                arg.span,
                "AICE_E2002_TYPE_MISMATCH",
                expectedType,
                argType,
              );
            }
            paramIdx++;
          } else {
            this.checkExpr(arg, env);
          }
        }
      }
    }

    return fnType.returnType;
  }

  private resolveTypeExpr(typeExpr: TypeExpr | null | undefined, env: TypeEnv): Type {
    if (!typeExpr) return TYPE_UNKNOWN;
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
      case "TupleType":
        return makeTupleType(typeExpr.elementTypes.map((et) => this.resolveTypeExpr(et, env)));
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
        if (resolved) {
          if (typeExpr.typeArgs && typeExpr.typeArgs.length > 0 && resolved.kind === "named") {
            return {
              ...resolved,
              typeArgs: typeExpr.typeArgs.map((ta) => this.resolveTypeExpr(ta, env)),
            };
          }
          return resolved;
        }
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
          "AICE_E2006_REFINEMENT_VIOLATION",
        );
      }
      if (maxBound !== undefined && val > maxBound) {
        throw new TypeCheckError(
          `Value ${val} violates refinement constraint: must be <= ${maxBound}`,
          span,
          "AICE_E2006_REFINEMENT_VIOLATION",
        );
      }
    }
  }

  private isMatchingStringContext(value: any, target: Type, env: TypeEnv): boolean {
    if (target.kind === "option") {
      return this.isMatchingStringContext(value, target.innerType, env);
    }
    const valStr = String(value);
    if (target.kind === "enum") {
      return (
        target.variants.has(valStr) ||
        Array.from(target.variants.keys()).some((v) => unquoteStringLiteral(v) === valStr)
      );
    }
    if (target.kind === "named") {
      if (isStringLiteralType(target.name)) {
        return unquoteStringLiteral(target.name) === valStr;
      }
      if (isStringLiteralUnion(target.name) || target.name.includes("|")) {
        const parts = target.name.split("|").map((p) => unquoteStringLiteral(p.trim()));
        if (parts.includes(valStr)) {
          return true;
        }
      }
      const resolved = env.lookupType(target.name) ?? lookupTypeAlias(target.name);
      if (resolved && resolved !== target) {
        return this.isMatchingStringContext(value, resolved, env);
      }
    }
    return false;
  }
}

function isNumeric(type: Type): boolean {
  if (!type) return false;
  if (type.kind === "option") {
    return isNumeric(type.innerType);
  }
  if (
    type.kind === "int" ||
    type.kind === "float" ||
    type.kind === "num" ||
    type.kind === "byte" ||
    type.kind === "enum"
  ) {
    return true;
  }
  if (type.kind === "named") {
    return (
      type.name === "int" ||
      type.name === "float" ||
      type.name === "num" ||
      type.name === "number" ||
      type.name === "byte"
    );
  }
  return false;
}

function isStringType(type: Type): boolean {
  if (type.kind === "str") return true;
  if (type.kind === "named") {
    if (type.name === "str" || type.name === "string") return true;
    if (isStringLiteralType(type.name) || isStringLiteralUnion(type.name)) return true;
  }
  return false;
}

function isPrimitiveTypeName(name: string): boolean {
  const n = name.trim();
  return (
    n === "int" ||
    n === "float" ||
    n === "num" ||
    n === "number" ||
    n === "byte" ||
    n === "char" ||
    n === "bool" ||
    n === "boolean" ||
    n === "str" ||
    n === "string" ||
    n === "void" ||
    n === "nil" ||
    n === "never" ||
    isStringLiteralType(n) ||
    isStringLiteralUnion(n)
  );
}

function isValidInKeyType(type: Type, env: TypeEnv): boolean {
  if (type.kind === "unknown") return true;
  if (isStringType(type) || isNumeric(type)) return true;
  if (type.kind === "named") {
    if (type.name === "any" || type.name === "unknown") return true;
    if (isPrimitiveTypeName(type.name)) {
      return (
        type.name === "str" ||
        type.name === "string" ||
        type.name === "int" ||
        type.name === "float" ||
        type.name === "num" ||
        type.name === "number" ||
        type.name === "byte" ||
        type.name === "char"
      );
    }
    const resolved = env.lookupType(type.name);
    if (resolved) {
      return isValidInKeyType(resolved, env);
    }
    return true;
  }
  return false;
}

function isValidInTargetType(type: Type, env: TypeEnv): boolean {
  if (type.kind === "unknown") return true;
  if (type.kind === "record" || type.kind === "array" || type.kind === "tuple") return true;
  if (type.kind === "option") return isValidInTargetType(type.innerType, env);
  if (type.kind === "named") {
    if (
      type.name === "any" ||
      type.name === "unknown" ||
      type.name === "object" ||
      type.name === "Object"
    ) {
      return true;
    }
    if (isPrimitiveTypeName(type.name)) return false;
    const resolved = env.lookupType(type.name);
    if (resolved) {
      return isValidInTargetType(resolved, env);
    }
    return true;
  }
  return false;
}

function isValidInstanceofTargetType(type: Type, env: TypeEnv): boolean {
  if (type.kind === "unknown") return true;
  if (
    type.kind === "record" ||
    type.kind === "array" ||
    type.kind === "tuple" ||
    type.kind === "function"
  ) {
    return true;
  }
  if (type.kind === "option") return isValidInstanceofTargetType(type.innerType, env);
  if (type.kind === "named") {
    if (
      type.name === "any" ||
      type.name === "unknown" ||
      type.name === "object" ||
      type.name === "Object"
    ) {
      return true;
    }
    if (isPrimitiveTypeName(type.name)) return false;
    const resolved = env.lookupType(type.name);
    if (resolved) {
      return isValidInstanceofTargetType(resolved, env);
    }
    return true;
  }
  return false;
}

function isValidInstanceofClassType(type: Type, env: TypeEnv): boolean {
  if (type.kind === "unknown") return true;
  if (type.kind === "function" || type.kind === "record") return true;
  if (type.kind === "named") {
    if (type.name === "any" || type.name === "unknown" || type.name === "Function") return true;
    if (isPrimitiveTypeName(type.name)) return false;
    const resolved = env.lookupType(type.name);
    if (resolved) {
      return (
        resolved.kind === "record" || resolved.kind === "function" || resolved.kind === "named"
      );
    }
    return true;
  }
  return false;
}

function exprContainsDollar(e: Expr | null | undefined): boolean {
  if (!e) return false;
  if (e.kind === "IdentifierExpr" && e.name.startsWith("$")) return true;
  if (e.kind === "CallExpr") {
    if (exprContainsDollar(e.callee)) return true;
    for (const a of e.args) {
      if (exprContainsDollar(a)) return true;
    }
  } else if (e.kind === "MemberAccessExpr") {
    return exprContainsDollar(e.object);
  } else if (e.kind === "IndexExpr") {
    return exprContainsDollar(e.object) || exprContainsDollar(e.index);
  } else if (e.kind === "BinaryExpr") {
    return exprContainsDollar(e.left) || exprContainsDollar(e.right);
  } else if (e.kind === "UnaryExpr" || e.kind === "PostfixTryExpr" || e.kind === "AwaitExpr") {
    return exprContainsDollar(e.operand);
  } else if (e.kind === "TemplateLiteralExpr") {
    for (const ex of e.expressions) {
      if (exprContainsDollar(ex)) return true;
    }
  } else if (e.kind === "ArrayLiteralExpr") {
    for (const el of e.elements) {
      if (exprContainsDollar(el)) return true;
    }
  } else if (e.kind === "RecordLiteralExpr") {
    for (const p of e.properties) {
      if (exprContainsDollar(p.value)) return true;
    }
  } else if (e.kind === "ClosureExpr") {
    if ("statements" in e.body) {
      for (const s of e.body.statements) {
        if (stmtContainsDollar(s)) return true;
      }
    } else {
      return exprContainsDollar(e.body);
    }
  } else if (e.kind === "AssignExpr") {
    return exprContainsDollar(e.target) || exprContainsDollar(e.value);
  }
  return false;
}

function stmtContainsDollar(s: Statement | null | undefined): boolean {
  if (!s) return false;
  switch (s.kind) {
    case "ExprStmt":
      return exprContainsDollar(s.expr);
    case "ReturnStmt":
      return s.value ? exprContainsDollar(s.value) : false;
    case "LetBinding":
      return s.name.startsWith("$") || exprContainsDollar(s.init);
    case "DestructureBinding":
      return s.names.some((n) => n.startsWith("$")) || exprContainsDollar(s.init);
    case "AssignStmt":
      return exprContainsDollar(s.target) || exprContainsDollar(s.value);
    case "ThrowStmt":
      return exprContainsDollar(s.expr);
    case "MatchStmt":
      if (exprContainsDollar(s.target)) return true;
      for (const c of s.cases) {
        if (c.guard && exprContainsDollar(c.guard)) return true;
        if ("statements" in c.body) {
          for (const st of c.body.statements) {
            if (stmtContainsDollar(st)) return true;
          }
        } else if (exprContainsDollar(c.body)) {
          return true;
        }
      }
      return false;
    case "IfStmt":
      if (exprContainsDollar(s.condition)) return true;
      for (const st of s.thenBranch.statements) {
        if (stmtContainsDollar(st)) return true;
      }
      for (const el of s.elifBranches) {
        if (exprContainsDollar(el.condition)) return true;
        for (const st of el.body.statements) {
          if (stmtContainsDollar(st)) return true;
        }
      }
      if (s.elseBranch) {
        for (const st of s.elseBranch.statements) {
          if (stmtContainsDollar(st)) return true;
        }
      }
      return false;
    case "WhileStmt":
      if (exprContainsDollar(s.condition)) return true;
      for (const st of s.body.statements) {
        if (stmtContainsDollar(st)) return true;
      }
      return false;
    case "ForStmt":
      if (s.variable.startsWith("$")) return true;
      if (exprContainsDollar(s.iterable)) return true;
      for (const st of s.body.statements) {
        if (stmtContainsDollar(st)) return true;
      }
      return false;
    case "TryStmt":
      for (const st of s.tryBlock.statements) {
        if (stmtContainsDollar(st)) return true;
      }
      if (s.catchBlock) {
        for (const st of s.catchBlock.statements) {
          if (stmtContainsDollar(st)) return true;
        }
      }
      if (s.finallyBlock) {
        for (const st of s.finallyBlock.statements) {
          if (stmtContainsDollar(st)) return true;
        }
      }
      return false;
  }
  return false;
}

function astContainsDollarIdentifier(mod: Module): boolean {
  for (const item of mod.items) {
    if (item.kind === "FunctionDecl") {
      if (item.name.startsWith("$")) return true;
      if ("statements" in item.body) {
        for (const s of item.body.statements) {
          if (stmtContainsDollar(s)) return true;
        }
      } else if (exprContainsDollar(item.body)) {
        return true;
      }
    } else if (item.kind === "ClassDecl") {
      if (item.name.startsWith("$")) return true;
      for (const m of item.methods) {
        if ("statements" in m.body) {
          for (const s of m.body.statements) {
            if (stmtContainsDollar(s)) return true;
          }
        } else if (exprContainsDollar(m.body)) {
          return true;
        }
      }
      if (item.properties) {
        for (const p of item.properties) {
          if (p.initialValue && exprContainsDollar(p.initialValue)) return true;
        }
      }
      if (item.staticBlocks) {
        for (const sb of item.staticBlocks) {
          for (const s of sb.statements) {
            if (stmtContainsDollar(s)) return true;
          }
        }
      }
    } else if (item.kind === "ConstDecl" || item.kind === "VarDecl") {
      if (item.name.startsWith("$")) return true;
      if (item.value && exprContainsDollar(item.value)) return true;
    }
  }
  return false;
}

/**
 * High-level typechecking entrypoint.
 */
export function check(
  mod: Module,
  options?: { idioms?: Record<string, ProjectIdiomDefinition>; baseDir?: string },
): void {
  const checker = new TypeChecker();
  checker.checkModule(mod, options);
}
