/**
 * TypeScript ES2022 & React 19 JSX Forward Emitter for AICE 2.0.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type {
  Block,
  ClassDecl,
  ComponentDecl,
  ConstDecl,
  Expr,
  FunctionDecl,
  ImportDecl,
  LayoutNode,
  MethodDecl,
  Module,
  ModuleItem,
  Statement,
  StyleDecl,
  TypeDecl,
  TypeExpr,
  VarDecl,
} from "../core/ast.js";
import { createAstNodeSnapshot, getNodeTriviaId } from "../core/trivia.js";
import { EmitterContext, type EmitterOptions } from "./context.js";
import { toCssProperty } from "./css-emitter.js";
import { lowerConstructor, lowerMethodCall, lowerPropertyAccess } from "./rewriter.js";

export class TypeScriptEmitter {
  private ctx: EmitterContext;
  private options: EmitterOptions;
  private pureInterfaces: boolean;
  private structTypes: Map<string, string[]> = new Map();
  private enumVariants: Map<
    string,
    { parentEnum: string; payloadCount: number; payloadTypes?: TypeExpr[]; isUnitEnum?: boolean }
  > = new Map();
  private varTypes: Map<string, string> = new Map();
  private classNames: Set<string> = new Set();
  private currentClassProperties: Set<string> | null = null;
  private currentClassMethods: Set<string> | null = null;
  private currentClassFunctionProperties: Set<string> | null = null;
  private localScopeVars: Set<string>[] = [];
  private reassignedBlockVars: Set<string>[] = [];
  private isCurrentMethodStatic = false;
  private emittedTypeDecls: Set<string> = new Set();
  private topLevelNames: Set<string> = new Set();

  private isLocal(name: string): boolean {
    for (let i = this.localScopeVars.length - 1; i >= 0; i--) {
      if (this.localScopeVars[i].has(name)) return true;
    }
    return false;
  }

  private isFunctionTypeExpr(typeExpr?: TypeExpr | null): boolean {
    if (!typeExpr) return false;
    if (typeExpr.kind === "NamedType") {
      return (
        typeExpr.name.includes("->") || typeExpr.name.includes("=>") || typeExpr.name === "Function"
      );
    }
    return false;
  }

  private isNullableOrOptionalType(t: TypeExpr): boolean {
    if (t.kind === "OptionType") return true;
    if (t.kind === "NamedType") {
      const parts = t.name.split("|").map((p) => p.trim());
      return parts.some((p) => p === "nil" || p === "null" || p === "undefined");
    }
    return false;
  }

  private static readonly BUILTIN_CONSTRUCTORS = new Set([
    "Int32Array",
    "Float32Array",
    "Uint8Array",
    "Uint16Array",
    "Uint32Array",
    "Int8Array",
    "Int16Array",
    "Float64Array",
    "ArrayBuffer",
    "Map",
    "Set",
    "WeakMap",
    "WeakSet",
    "Date",
    "RegExp",
    "Error",
    "AudioContext",
  ]);

  private static readonly MATH_BUILTINS = new Set([
    "min",
    "max",
    "floor",
    "ceil",
    "round",
    "abs",
    "sqrt",
    "sin",
    "cos",
    "tan",
    "atan2",
    "asin",
    "acos",
    "hypot",
    "sign",
    "pow",
    "clamp",
    "exp",
  ]);

  private static readonly GLOBAL_BUILTIN_FUNCTIONS = new Set(["print", "len", "log"]);

  private static readonly KNOWN_BUILTINS = new Set([
    "min",
    "max",
    "floor",
    "ceil",
    "round",
    "abs",
    "sqrt",
    "sin",
    "cos",
    "tan",
    "atan2",
    "asin",
    "acos",
    "hypot",
    "sign",
    "pow",
    "clamp",
    "exp",
    "print",
    "len",
    "log",
  ]);

  constructor(options: EmitterOptions & { withFactories?: boolean } = {}) {
    this.options = options;
    this.pureInterfaces = Boolean(options.pureInterfaces) && !(options as any).withFactories;
    this.ctx = new EmitterContext(options.target ?? "typescript", options);
  }

  static emit(mod: Module, options?: EmitterOptions): string {
    return new TypeScriptEmitter(options).emit(mod);
  }

  emit(mod: Module): string {
    if (this.ctx.trivia && this.isModuleUnmutated(mod) && this.options.watermark !== true) {
      const original = this.ctx.trivia.getOriginalSource();
      if (original !== undefined) {
        return original;
      }
    }
    return this.emitModule(mod);
  }

  private canReplaySourceSlice(item: ModuleItem, nodeId: string): boolean {
    if (!this.ctx.trivia) return false;
    const candidateIds = this.getCandidateTriviaIds(item, nodeId);
    let matchedEntry: { sourceSlice?: string; nodeSnapshot?: string } | undefined;
    for (const id of candidateIds) {
      const entry = this.ctx.trivia.getTrivia(id);
      if (entry?.sourceSlice) {
        matchedEntry = entry;
        break;
      }
    }
    if (!matchedEntry || !matchedEntry.sourceSlice) return false;

    // For ClassDecl, if it was compacted into prop macros (properties have aliases), do not replay raw slice
    if (item.kind === "ClassDecl") {
      const hasCompactedAliases = item.properties.some((p) => p.aliases && p.aliases.length > 0);
      if (hasCompactedAliases) return false;
    }

    if (matchedEntry.nodeSnapshot) {
      const currentSnapshot = createAstNodeSnapshot(item);
      if (currentSnapshot !== matchedEntry.nodeSnapshot) {
        return false;
      }
    }
    return true;
  }

  private getSourceSlice(item: ModuleItem, nodeId: string): string | undefined {
    if (!this.ctx.trivia) return undefined;
    const candidateIds = this.getCandidateTriviaIds(item, nodeId);
    for (const id of candidateIds) {
      const slice = this.ctx.trivia.getSourceSlice(id);
      if (slice) return slice;
    }
    return undefined;
  }

  private getCandidateTriviaIds(item: ModuleItem, primaryId: string): string[] {
    const ids = [primaryId];
    if (item.kind === "ComponentDecl") {
      ids.push(`fn:${item.name}`);
    } else if (item.kind === "FunctionDecl") {
      ids.push(`component:${item.name}`);
    } else if (item.kind === "ConstDecl") {
      ids.push(`var:${item.name}`);
    } else if (item.kind === "VarDecl") {
      ids.push(`const:${item.name}`);
    }
    return ids;
  }

  private isModuleUnmutated(mod: Module): boolean {
    if (!this.ctx.trivia) return false;
    if (!mod || !mod.items || mod.items.length === 0) return false;
    for (const item of mod.items) {
      const nodeId = getNodeTriviaId(item);
      if (!nodeId || !this.canReplaySourceSlice(item, nodeId)) {
        return false;
      }
    }
    return true;
  }

  private hasExistingWatermark(mod: Module): boolean {
    if (!this.ctx.trivia) return false;
    const isWatermarkComment = (text: string) =>
      text.includes("@generated") ||
      text.includes("DO NOT EDIT DIRECTLY") ||
      text.includes("Authoritative Source of Truth");

    const moduleTrivia = this.ctx.trivia.getTrivia("module");
    if (moduleTrivia && moduleTrivia.leading.some((t) => isWatermarkComment(t.content))) {
      return true;
    }
    if (mod.items && mod.items.length > 0) {
      const firstNodeId = getNodeTriviaId(mod.items[0]);
      if (firstNodeId) {
        const firstTrivia = this.ctx.trivia.getTrivia(firstNodeId);
        if (firstTrivia && firstTrivia.leading.some((t) => isWatermarkComment(t.content))) {
          return true;
        }
      }
    }
    return false;
  }

  private shouldEmitWatermark(mod: Module): boolean {
    if (this.options.watermark === false) {
      return false;
    }
    if (this.options.watermark === true) {
      return !this.hasExistingWatermark(mod);
    }
    if (this.isModuleUnmutated(mod)) {
      return false;
    }
    if (this.ctx.trivia?.getOriginalSource() !== undefined) {
      return false;
    }
    if (this.hasExistingWatermark(mod)) {
      return false;
    }
    return true;
  }

  private emitWatermark(mod: Module): void {
    let sourcePath = this.options.sourcePath;
    if (!sourcePath) {
      const candidatePath =
        (mod.span?.file && mod.span.file !== "<anonymous>" && mod.span.file) ||
        (mod.path && mod.path !== "main" && mod.path !== "<anonymous>" && mod.path);

      if (candidatePath) {
        sourcePath = candidatePath.endsWith(".aice") ? candidatePath : `${candidatePath}.aice`;
      } else {
        sourcePath = ".aice";
      }
    }
    this.ctx.writeLine("// @generated by AICE (AI Context Engine) - DO NOT EDIT DIRECTLY");
    this.ctx.writeLine(`// Authoritative Source of Truth: ${sourcePath}`);
    this.ctx.writeLine();
  }

  emitModule(mod: Module): string {
    this.structTypes.clear();
    this.enumVariants.clear();
    this.varTypes.clear();
    this.classNames.clear();
    this.currentClassProperties = null;
    this.currentClassMethods = null;
    this.currentClassFunctionProperties = null;
    this.localScopeVars = [];
    this.reassignedBlockVars = [];
    this.isCurrentMethodStatic = false;
    this.emittedTypeDecls.clear();
    this.topLevelNames.clear();
    for (const item of mod.items) {
      if (item.kind === "ClassDecl") {
        this.classNames.add(item.name);
        this.topLevelNames.add(item.name);
      } else if (item.kind === "FunctionDecl" || item.kind === "ConstDecl" || item.kind === "VarDecl") {
        this.topLevelNames.add(item.name);
      } else if (item.kind === "ImportDecl") {
        for (const s of item.specifiers) {
          this.topLevelNames.add(s.alias ?? s.name);
        }
      } else if (item.kind === "TypeDecl") {
        this.topLevelNames.add(item.name);
        if (item.fields) {
          this.structTypes.set(
            item.name,
            item.fields.map((f) => f.name),
          );
        } else if (item.isEnum && item.variants) {
          const allUnit = item.variants.every((v) => !v.payloadTypes || v.payloadTypes.length === 0);
          for (const v of item.variants) {
            this.enumVariants.set(v.name, {
              parentEnum: item.name,
              payloadCount: v.payloadTypes?.length ?? 0,
              payloadTypes: v.payloadTypes,
              isUnitEnum: allUnit,
            });
          }
        }
      }
    }

    // Scan imported modules for struct definitions to support cross-module positional constructors & spreads
    const baseDir =
      mod.span?.file && mod.span.file !== "<anonymous>" && fs.existsSync(path.dirname(mod.span.file))
        ? path.dirname(path.resolve(mod.span.file))
        : process.cwd();
    for (const item of mod.items) {
      if (item.kind === "ImportDecl") {
        const importSrc = item.source;
        const candidateNames = [
          importSrc.replace(/\.[a-zA-Z]+$/, ".aice"),
          importSrc,
        ];
        for (const cand of candidateNames) {
          const resolved = path.resolve(baseDir, cand);
          if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
            try {
              const content = fs.readFileSync(resolved, "utf-8");
              const lines = content.split("\n");
              for (const line of lines) {
                const match = line.match(/^type\s+([A-Za-z0-9_]+)\s*:\s*(.+)$/);
                if (match) {
                  const sName = match[1];
                  const fieldDefs = match[2].split(",").map((f) => f.trim().split(":")[0].trim());
                  if (!this.structTypes.has(sName)) {
                    this.structTypes.set(sName, fieldDefs);
                  }
                }
              }
            } catch {}
            break;
          }
        }
      }
    }

    // Emit watermark header if fresh target code
    if (this.shouldEmitWatermark(mod)) {
      this.emitWatermark(mod);
    }

    // Emit module header trivia
    this.ctx.emitLeadingTrivia("module");
    const moduleTrivia = this.ctx.trivia?.getTrivia("module");
    if (moduleTrivia && moduleTrivia.leading.length > 0 && mod.items.length > 0) {
      this.ctx.writeLine();
    }

    // Collect all imports first
    const imports = mod.items.filter((i) => i.kind === "ImportDecl") as ImportDecl[];
    const nonImports = mod.items.filter((i) => i.kind !== "ImportDecl");

    for (const imp of imports) {
      this.emitImport(imp);
    }

    if (imports.length > 0 && nonImports.length > 0) {
      this.ctx.writeLine();
    }

    for (let i = 0; i < nonImports.length; i++) {
      this.emitModuleItem(nonImports[i]);
      if (i < nonImports.length - 1) {
        this.ctx.writeLine();
      }
    }

    this.ctx.emitTrailingTrivia("module");

    return this.ctx.getOutput();
  }

  private emitImport(imp: ImportDecl): void {
    const nodeId = `import:${imp.source}`;
    if (this.canReplaySourceSlice(imp, nodeId)) {
      const slice = this.getSourceSlice(imp, nodeId)!;
      this.ctx.writeLine(slice.trimEnd());
      return;
    }
    this.ctx.emitLeadingTrivia(nodeId);

    if (imp.specifiers.length === 0) {
      this.ctx.writeLine(`import "${imp.source}";`);
      this.ctx.emitTrailingTrivia(nodeId);
      return;
    }

    if (imp.specifiers.length === 1 && imp.specifiers[0].isWildcard) {
      if (imp.isExported) {
        if (imp.specifiers[0].alias && imp.specifiers[0].alias !== "mod") {
          this.ctx.writeLine(`export * as ${imp.specifiers[0].alias} from "${imp.source}";`);
        } else {
          this.ctx.writeLine(`export * from "${imp.source}";`);
        }
      } else {
        const alias = imp.specifiers[0].alias ?? this.sanitizeModulePath(imp.source);
        this.ctx.writeLine(`import * as ${alias} from "${imp.source}";`);
      }
      this.ctx.emitTrailingTrivia(nodeId);
      return;
    }

    const defaultSpec =
      imp.specifiers.find((s) => s.isDefault) ||
      (imp.source === "node:assert" && imp.specifiers.length === 1 ? imp.specifiers[0] : undefined);
    const namedSpecs = imp.specifiers.filter((s) => s !== defaultSpec);
    const parts: string[] = [];
    if (defaultSpec) {
      parts.push(defaultSpec.alias ? `${defaultSpec.name} as ${defaultSpec.alias}` : defaultSpec.name);
    }
    if (namedSpecs.length > 0) {
      const specs = namedSpecs.map((s) => (s.alias ? `${s.name} as ${s.alias}` : s.name));
      parts.push(`{ ${specs.join(", ")} }`);
    }
    if (imp.isExported) {
      this.ctx.writeLine(`export ${parts.join(", ")} from "${imp.source}";`);
    } else {
      this.ctx.writeLine(`import ${parts.join(", ")} from "${imp.source}";`);
    }
    this.ctx.emitTrailingTrivia(nodeId);
  }

  private emitModuleItem(item: ModuleItem): void {
    const nodeId = getNodeTriviaId(item);
    if (nodeId && this.canReplaySourceSlice(item, nodeId)) {
      const slice = this.getSourceSlice(item, nodeId)!;
      this.ctx.writeLine(slice.trimEnd());
      return;
    }
    switch (item.kind) {
      case "TypeDecl":
        if (this.ctx.target === "javascript") {
          const isUnitEnum =
            item.isEnum &&
            item.variants &&
            item.variants.length > 0 &&
            item.variants.every(
              (v) =>
                (!v.payloadTypes || v.payloadTypes.length === 0) &&
                (!(v as any).fields || (v as any).fields.length === 0),
            );
          if (!isUnitEnum) {
            break;
          }
        }
        this.emitTypeDecl(item);
        break;
      case "FunctionDecl":
        this.emitFunctionDecl(item);
        break;
      case "ComponentDecl":
        this.emitComponentDecl(item);
        break;
      case "StyleDecl":
        this.emitStyleDecl(item);
        break;
      case "ClassDecl":
        this.emitClassDecl(item);
        break;
      case "ConstDecl":
        this.emitConstDecl(item);
        break;
      case "VarDecl":
        this.emitVarDecl(item);
        break;
    }
  }

  private emitTypeDecl(t: TypeDecl): void {
    const nodeId = `type:${t.name}`;
    if (this.canReplaySourceSlice(t, nodeId)) {
      const slice = this.getSourceSlice(t, nodeId)!;
      this.ctx.writeLine(slice.trimEnd());
      return;
    }
    this.ctx.emitLeadingTrivia(nodeId);

    if (t.aliasType) {
      const typeStr = this.emitTypeExpr(t.aliasType);
      this.ctx.writeLine(`export type ${t.name} = ${typeStr};`);
      this.ctx.emitTrailingTrivia(nodeId);
      return;
    }

    if (t.isEnum && t.variants) {
      const allUnit = t.variants.every(
        (v) =>
          (!v.payloadTypes || v.payloadTypes.length === 0) &&
          (!(v as any).fields || (v as any).fields.length === 0),
      );
      if (this.ctx.target === "javascript") {
        if (allUnit) {
          this.ctx.writeLine(
            `export const ${t.name} = { ${t.variants.map((v, idx) => `${v.name}: ${idx}`).join(", ")} };`,
          );
        }
        this.ctx.emitTrailingTrivia(nodeId);
        return;
      }
      if (allUnit) {
        this.ctx.writeLine(`export enum ${t.name} {`);
        this.ctx.indent();
        for (const v of t.variants) {
          this.ctx.writeLine(`${v.name},`);
        }
        this.ctx.dedent();
        this.ctx.writeLine(`}`);
      } else {
        const variantTypes = t.variants.map((v) => {
          if (!v.payloadTypes || v.payloadTypes.length === 0) {
            return `{ kind: "${v.name}" }`;
          }
          const payloads = v.payloadTypes.map((pt, idx) => `item${idx}: ${this.emitTypeExpr(pt)}`);
          return `{ kind: "${v.name}"; ${payloads.join("; ")} }`;
        });
        this.ctx.writeLine(`export type ${t.name} = \n  | ${variantTypes.join("\n  | ")};`);
      }
      this.ctx.emitTrailingTrivia(nodeId);
      return;
    }

    if (t.fields) {
      this.emittedTypeDecls.add(t.name);
      this.ctx.writeLine(`export interface ${t.name} {`);
      this.ctx.indent();
      for (const f of t.fields) {
        const fieldNodeId = `field:${t.name}.${f.name}`;
        this.ctx.emitLeadingTrivia(fieldNodeId);
        const isOpt =
          f.isOptional ||
          !!f.defaultValue ||
          this.isNullableOrOptionalType(f.typeAnnotation);
        const optMark = isOpt ? "?" : "";
        const typeStr =
          optMark && f.typeAnnotation.kind === "OptionType"
            ? this.emitTypeExpr(f.typeAnnotation.innerType)
            : this.emitTypeExpr(f.typeAnnotation);
        this.ctx.writeLine(`${f.name}${optMark}: ${typeStr};`);
        this.ctx.emitTrailingTrivia(fieldNodeId);
      }
      this.ctx.dedent();
      this.ctx.writeLine("}");

      if (!this.pureInterfaces && !t.name.endsWith("Props")) {
        this.ctx.writeLine();
        const params = t.fields
          .map((f) => {
            const isOpt = f.isOptional || this.isNullableOrOptionalType(f.typeAnnotation);
            const optMark = isOpt && !f.defaultValue ? "?" : "";
            const typeStr =
              optMark && f.typeAnnotation.kind === "OptionType"
                ? this.emitTypeExpr(f.typeAnnotation.innerType)
                : this.emitTypeExpr(f.typeAnnotation);
            const defStr = f.defaultValue ? ` = ${this.emitExpr(f.defaultValue)}` : "";
            return `${f.name}${optMark}: ${typeStr}${defStr}`;
          })
          .join(", ");
        const props = t.fields.map((f) => f.name).join(", ");
        this.ctx.writeLine(`export function ${t.name}(${params}): ${t.name} {`);
        this.ctx.indent();
        this.ctx.writeLine(props.length === 0 ? "return {};" : `return { ${props} };`);
        this.ctx.dedent();
        this.ctx.writeLine("}");
      }
      this.ctx.emitTrailingTrivia(nodeId);
    }
  }

  private emitClassDecl(c: ClassDecl): void {
    const prevProperties = this.currentClassProperties;
    const prevMethods = this.currentClassMethods;
    const prevFunctionProperties = this.currentClassFunctionProperties;
    this.currentClassProperties = new Set();
    this.currentClassMethods = new Set();
    this.currentClassFunctionProperties = new Set();
    if (c.primaryConstructor) {
      for (const p of c.primaryConstructor) {
        this.currentClassProperties.add(p.name);
        if (this.isFunctionTypeExpr(p.typeAnnotation)) {
          this.currentClassFunctionProperties.add(p.name);
        }
      }
    }
    for (const p of c.properties) {
      this.currentClassProperties.add(p.name);
      if (
        this.isFunctionTypeExpr(p.typeAnnotation) ||
        (p.initialValue && p.initialValue.kind === "ClosureExpr")
      ) {
        this.currentClassFunctionProperties.add(p.name);
      }
      if (p.alias) {
        this.currentClassProperties.add(p.alias);
        if (this.isFunctionTypeExpr(p.typeAnnotation)) {
          this.currentClassFunctionProperties.add(p.alias);
        }
      }
      if (p.aliases) {
        for (const a of p.aliases) {
          this.currentClassProperties.add(a);
          if (this.isFunctionTypeExpr(p.typeAnnotation)) {
            this.currentClassFunctionProperties.add(a);
          }
        }
      }
    }
    for (const m of c.methods) {
      this.currentClassMethods.add(m.name);
    }

    const nodeId = `class:${c.name}`;
    if (this.canReplaySourceSlice(c, nodeId)) {
      const slice = this.getSourceSlice(c, nodeId)!;
      this.ctx.writeLine(slice.trimEnd());
      this.currentClassProperties = prevProperties;
      this.currentClassMethods = prevMethods;
      this.currentClassFunctionProperties = prevFunctionProperties;
      return;
    }
    this.ctx.emitLeadingTrivia(nodeId);

    const isJs = this.ctx.target === "javascript";
    const exp = c.isExported ? "export " : "";
    const typeParams = !isJs && c.typeParams.length > 0 ? `<${c.typeParams.join(", ")}>` : "";
    const ext = c.extends ? ` extends ${c.extends}` : "";
    const impl =
      !isJs && c.implements && c.implements.length > 0 ? ` implements ${c.implements.join(", ")}` : "";

    this.ctx.writeLine(`${exp}class ${c.name}${typeParams}${ext}${impl} {`);
    this.ctx.indent();

    if (c.primaryConstructor && c.primaryConstructor.length > 0) {
      const hasCtor = c.methods.some((m) => m.name === "constructor");
      if (!hasCtor) {
        const ctorParams = c.primaryConstructor
          .map((p) => {
            const ro = !isJs && p.isReadonly ? "readonly " : "";
            const pub = !isJs ? (p.isPub !== false ? "public " : "private ") : "";
            const optMark = !isJs && p.isOptional && !p.defaultValue ? "?" : "";
            const typeAnn = !isJs && p.typeAnnotation ? `: ${this.emitTypeExpr(p.typeAnnotation)}` : "";
            const def = p.defaultValue ? ` = ${this.emitExpr(p.defaultValue)}` : "";
            const rest = p.isRest ? "..." : "";
            return `${pub}${ro}${rest}${p.name}${optMark}${typeAnn}${def}`;
          })
          .join(", ");
        if (isJs) {
          this.ctx.writeLine(`constructor(${ctorParams}) {`);
          this.ctx.indent();
          for (const p of c.primaryConstructor) {
            this.ctx.writeLine(`this.${p.name} = ${p.name};`);
          }
          this.ctx.dedent();
          this.ctx.writeLine("}");
        } else {
          this.ctx.writeLine(`constructor(${ctorParams}) {}`);
        }
      }
    }

    for (const p of c.properties) {
      const pNodeId = `field:${c.name}.${p.name}`;
      this.ctx.emitLeadingTrivia(pNodeId);
      const st = p.isStatic ? "static " : "";
      const ro = !isJs && p.isReadonly ? "readonly " : "";
      const opt = !isJs && p.isOptional ? "?" : "";
      const hasAliases = !!p.alias || (p.aliases !== undefined && p.aliases.length > 0);
      const defAssign =
        !isJs && !p.initialValue && !p.isOptional && !p.isStatic && p.typeAnnotation && !hasAliases ? "!" : "";
      const typeAnn = !isJs && p.typeAnnotation ? `: ${this.emitTypeExpr(p.typeAnnotation)}` : "";
      const init = p.initialValue ? ` = ${this.emitExpr(p.initialValue)}` : "";
      this.ctx.writeLine(`${st}${ro}${p.name}${opt}${defAssign}${typeAnn}${init};`);
      this.ctx.emitTrailingTrivia(pNodeId);

      const aliases = p.aliases && p.aliases.length > 0 ? p.aliases : p.alias ? [p.alias] : [];
      for (const alias of aliases) {
        const hasExplicitGetter = c.methods.some(
          (m) => m.name === alias && (m.accessor === "get" || !m.accessor),
        );
        const hasExplicitSetter = c.methods.some(
          (m) => m.name === alias && (m.accessor === "set" || !m.accessor),
        );
        const target = p.isStatic ? `${c.name}.${p.name}` : `this.${p.name}`;
        const typeStr = p.typeAnnotation ? this.emitTypeExpr(p.typeAnnotation) : "any";
        if (!hasExplicitGetter) {
          this.ctx.writeLine(`${st}get ${alias}() { return ${target}; }`);
        }
        if (!p.isReadonly && !hasExplicitSetter) {
          const setterType = isJs ? "" : `: ${typeStr}`;
          this.ctx.writeLine(`${st}set ${alias}(v${setterType}) { ${target} = v; }`);
        }
      }
    }

    for (const m of c.methods) {
      const mNodeId = `method:${c.name}.${m.name}`;
      this.ctx.emitLeadingTrivia(mNodeId);
      const st = m.isStatic ? "static " : "";
      const as = m.isAsync ? "async " : "";
      const params = m.params
        .map((p) => {
          const optMark = !isJs && p.isOptional && !p.defaultValue ? "?" : "";
          const typeAnn = !isJs && p.typeAnnotation ? `: ${this.emitTypeExpr(p.typeAnnotation)}` : "";
          const def = p.defaultValue ? ` = ${this.emitExpr(p.defaultValue)}` : "";
          const rest = p.isRest ? "..." : "";
          return `${rest}${p.name}${optMark}${typeAnn}${def}`;
        })
        .join(", ");
      const ret = !isJs && m.returnType ? `: ${this.emitTypeExpr(m.returnType)}` : "";

      if (m.accessor === "get") {
        this.ctx.writeLine(`${st}get ${m.name}()${ret} {`);
      } else if (m.accessor === "set") {
        this.ctx.writeLine(`${st}set ${m.name}(${params}) {`);
      } else {
        this.ctx.writeLine(`${st}${as}${m.name}(${params})${ret} {`);
      }
      this.ctx.indent();

      const prevStatic = this.isCurrentMethodStatic;
      this.isCurrentMethodStatic = !!m.isStatic;
      const methodScope = new Set<string>();
      for (const p of m.params) {
        methodScope.add(p.name);
      }
      this.localScopeVars = [methodScope];

      if (m.body.kind === "Block") {
        const isReturning = this.isReturningMethod(m);
        this.emitBlock(m.body, isReturning);
      } else {
        if (m.body.kind === "AssignExpr") {
          this.ctx.writeLine(
            `${this.emitExpr(m.body.target)} ${m.body.op ?? "="} ${this.emitExpr(m.body.value)};`,
          );
        } else if (
          m.accessor === "set" ||
          (m.returnType &&
            m.returnType.kind === "PrimitiveType" &&
            m.returnType.primitive === "void")
        ) {
          this.ctx.writeLine(`${this.emitExpr(m.body)};`);
        } else {
          this.ctx.writeLine(`return ${this.emitExpr(m.body)};`);
        }
      }

      this.localScopeVars = [];
      this.isCurrentMethodStatic = prevStatic;

      this.ctx.dedent();
      this.ctx.writeLine("}");
      this.ctx.emitTrailingTrivia(mNodeId);
    }

    if (c.staticBlocks && c.staticBlocks.length > 0) {
      for (const sb of c.staticBlocks) {
        this.ctx.writeLine("static {");
        this.ctx.indent();
        this.emitBlock(sb);
        this.ctx.dedent();
        this.ctx.writeLine("}");
      }
    }

    this.ctx.dedent();
    this.ctx.writeLine("}");
    this.ctx.emitTrailingTrivia(nodeId);

    this.currentClassProperties = prevProperties;
    this.currentClassMethods = prevMethods;
    this.currentClassFunctionProperties = prevFunctionProperties;
  }

  private emitConstDecl(c: ConstDecl): void {
    const nodeId = `const:${c.name}`;
    if (this.canReplaySourceSlice(c, nodeId)) {
      const slice = this.getSourceSlice(c, nodeId)!;
      this.ctx.writeLine(slice.trimEnd());
      return;
    }
    this.ctx.emitLeadingTrivia(nodeId);
    if (c.name === "_") {
      this.ctx.writeLine(`${this.emitExpr(c.value)};`);
      this.ctx.emitTrailingTrivia(nodeId);
      return;
    }
    const isJs = this.ctx.target === "javascript";
    const exp = c.isExported ? "export " : "";
    const typeAnn = !isJs && c.typeAnnotation ? `: ${this.emitTypeExpr(c.typeAnnotation)}` : "";
    this.ctx.writeLine(`${exp}const ${c.name}${typeAnn} = ${this.emitExpr(c.value)};`);
    this.ctx.emitTrailingTrivia(nodeId);
  }

  private emitVarDecl(v: VarDecl): void {
    const nodeId = `var:${v.name}`;
    if (this.canReplaySourceSlice(v, nodeId)) {
      const slice = this.getSourceSlice(v, nodeId)!;
      this.ctx.writeLine(slice.trimEnd());
      return;
    }
    this.ctx.emitLeadingTrivia(nodeId);
    if (v.name === "_") {
      this.ctx.writeLine(`${this.emitExpr(v.value)};`);
      this.ctx.emitTrailingTrivia(nodeId);
      return;
    }
    const isJs = this.ctx.target === "javascript";
    const exp = v.isExported ? "export " : "";
    const kw = v.isMut ? "let" : "const";
    const typeAnn = !isJs && v.typeAnnotation ? `: ${this.emitTypeExpr(v.typeAnnotation)}` : "";
    this.ctx.writeLine(`${exp}${kw} ${v.name}${typeAnn} = ${this.emitExpr(v.value)};`);
    this.ctx.emitTrailingTrivia(nodeId);
  }

  private extractDestructureIdentifiers(pattern: string): string[] {
    const raw = pattern.replace(/^[[{]\s*/, "").replace(/\s*[\]}]$/, "");
    const parts = raw.split(",");
    const result: string[] = [];
    for (const part of parts) {
      let trimmed = part.trim();
      if (!trimmed || trimmed === "_") continue;
      trimmed = trimmed.split("=")[0].trim();
      if (!trimmed || trimmed === "_") continue;
      if (trimmed.includes(":")) {
        const alias = trimmed.split(":")[1]?.trim().split("=")[0].trim();
        if (alias && alias !== "_") result.push(alias);
      } else {
        result.push(trimmed);
      }
    }
    return result;
  }

  private emitFunctionDecl(fn: FunctionDecl): void {
    const nodeId = `fn:${fn.name}`;
    if (this.canReplaySourceSlice(fn, nodeId)) {
      const slice = this.getSourceSlice(fn, nodeId)!;
      this.ctx.writeLine(slice.trimEnd());
      return;
    }
    this.varTypes.clear();
    const prevProperties = this.currentClassProperties;
    const prevMethods = this.currentClassMethods;
    const prevFunctionProperties = this.currentClassFunctionProperties;
    const prevStatic = this.isCurrentMethodStatic;
    this.currentClassProperties = null;
    this.currentClassMethods = null;
    this.currentClassFunctionProperties = null;
    this.isCurrentMethodStatic = false;

    const fnScope = new Set<string>();
    for (const p of fn.params) {
      if (p.name.startsWith("[") || p.name.startsWith("{")) {
        for (const id of this.extractDestructureIdentifiers(p.name)) {
          fnScope.add(id);
        }
      } else {
        fnScope.add(p.name);
      }
      if (p.typeAnnotation && p.typeAnnotation.kind === "NamedType") {
        this.varTypes.set(p.name, p.typeAnnotation.name);
      }
    }
    this.localScopeVars = [fnScope];

    this.ctx.emitLeadingTrivia(nodeId);
    const isExported = fn.name !== "__top_level__";
    const exportPrefix = isExported ? "export " : "";
    const asyncPrefix = fn.isAsync ? "async " : "";
    const isJs = this.ctx.target === "javascript";
    const paramsStr = fn.params
      .map((p) => {
        const optMark = !isJs && p.isOptional && !p.defaultValue ? "?" : "";
        const typeStr = !isJs && p.typeAnnotation ? `: ${this.emitTypeExpr(p.typeAnnotation)}` : "";
        const defStr = p.defaultValue ? ` = ${this.emitExpr(p.defaultValue)}` : "";
        const rest = p.isRest ? "..." : "";
        return `${rest}${p.name}${optMark}${typeStr}${defStr}`;
      })
      .join(", ");

    const retStr = !isJs && fn.returnType ? `: ${this.emitTypeExpr(fn.returnType)}` : "";

    if (fn.isExpressionBodied) {
      this.ctx.writeLine(
        `${exportPrefix}${asyncPrefix}function ${fn.name}(${paramsStr})${retStr} {`,
      );
      this.ctx.indent();
      this.ctx.writeLine(`return ${this.emitExpr(fn.body as Expr)};`);
      this.ctx.dedent();
      this.ctx.writeLine("}");
      this.ctx.emitTrailingTrivia(nodeId);
      this.localScopeVars = [];
      this.currentClassProperties = prevProperties;
      this.currentClassMethods = prevMethods;
      this.currentClassFunctionProperties = prevFunctionProperties;
      this.isCurrentMethodStatic = prevStatic;
      return;
    }

    this.ctx.writeLine(`${exportPrefix}${asyncPrefix}function ${fn.name}(${paramsStr})${retStr} {`);
    this.ctx.indent();
    const isReturning = this.isReturningFunction(fn);
    this.emitBlock(fn.body as Block, isReturning);
    this.ctx.dedent();
    this.ctx.writeLine("}");
    this.ctx.emitTrailingTrivia(nodeId);
    this.localScopeVars = [];
    this.currentClassProperties = prevProperties;
    this.currentClassMethods = prevMethods;
    this.currentClassFunctionProperties = prevFunctionProperties;
    this.isCurrentMethodStatic = prevStatic;
  }

  private isReturningFunction(fn: FunctionDecl): boolean {
    if (fn.name === "__top_level__") return false;
    if (fn.returnType) {
      return !(
        fn.returnType.kind === "PrimitiveType" &&
        (fn.returnType.primitive === "void" || fn.returnType.primitive === "nil")
      );
    }
    if (fn.body.kind === "Block") {
      const stmts = fn.body.statements;
      if (stmts.length > 0) {
        const last = stmts[stmts.length - 1];
        if (last.kind === "ReturnStmt") return true;
        if (last.kind === "ExprStmt") {
          return !this.isVoidExpr(last.expr);
        }
        if (last.kind === "IfStmt" && last.elseBranch) {
          return true;
        }
        if (last.kind === "MatchStmt") {
          return true;
        }
      }
    }
    return false;
  }

  private isReturningMethod(m: MethodDecl): boolean {
    if (m.name === "constructor" || m.accessor === "set") return false;
    if (m.returnType) {
      return !(
        m.returnType.kind === "PrimitiveType" &&
        (m.returnType.primitive === "void" || m.returnType.primitive === "nil")
      );
    }
    if (m.body.kind === "Block") {
      const stmts = m.body.statements;
      if (stmts.length > 0) {
        const last = stmts[stmts.length - 1];
        if (last.kind === "ReturnStmt") return true;
        if (last.kind === "ExprStmt") {
          return !this.isVoidExpr(last.expr);
        }
        if (last.kind === "IfStmt" && last.elseBranch) {
          return true;
        }
        if (last.kind === "MatchStmt") {
          return true;
        }
      }
    }
    return false;
  }

  private isVoidExpr(expr: Expr): boolean {
    if (expr.kind === "CallExpr" && expr.callee.kind === "IdentifierExpr") {
      return expr.callee.name === "print" || expr.callee.name === "super";
    }
    return false;
  }

  private collectReassignments(stmt: Statement, out: Set<string>): void {
    if (stmt.kind === "AssignStmt") {
      if (stmt.target.kind === "IdentifierExpr") {
        out.add(stmt.target.name);
      }
    } else if (
      stmt.kind === "ExprStmt" &&
      stmt.expr.kind === "AssignExpr" &&
      stmt.expr.target.kind === "IdentifierExpr"
    ) {
      out.add(stmt.expr.target.name);
    } else if (stmt.kind === "IfStmt") {
      for (const s of stmt.thenBranch.statements) this.collectReassignments(s, out);
      for (const elif of stmt.elifBranches) {
        for (const s of elif.body.statements) this.collectReassignments(s, out);
      }
      if (stmt.elseBranch) {
        for (const s of stmt.elseBranch.statements) this.collectReassignments(s, out);
      }
    } else if (stmt.kind === "WhileStmt") {
      for (const s of stmt.body.statements) this.collectReassignments(s, out);
    } else if (stmt.kind === "ForStmt") {
      for (const s of stmt.body.statements) this.collectReassignments(s, out);
    } else if (stmt.kind === "TryStmt") {
      for (const s of stmt.tryBlock.statements) this.collectReassignments(s, out);
      if (stmt.catchBlock) {
        for (const s of stmt.catchBlock.statements) this.collectReassignments(s, out);
      }
      if (stmt.finallyBlock) {
        for (const s of stmt.finallyBlock.statements) this.collectReassignments(s, out);
      }
    } else if (stmt.kind === "MatchStmt") {
      for (const c of stmt.cases) {
        if (c.body.kind === "Block") {
          for (const s of c.body.statements) this.collectReassignments(s, out);
        }
      }
    }
  }

  private emitBlock(block: Block, isReturning = false): void {
    const blockScope = new Set<string>();
    this.localScopeVars.push(blockScope);

    const reassignedVars = new Set<string>();
    const letCounts = new Map<string, number>();
    for (const s of block.statements) {
      if (s.kind === "LetBinding") {
        letCounts.set(s.name, (letCounts.get(s.name) ?? 0) + 1);
      }
      this.collectReassignments(s, reassignedVars);
    }
    for (const [name, count] of letCounts.entries()) {
      if (count > 1) {
        reassignedVars.add(name);
      }
    }
    this.reassignedBlockVars.push(reassignedVars);

    const len = block.statements.length;
    for (let i = 0; i < len; i++) {
      const stmt = block.statements[i];
      const isLast = i === len - 1;
      this.emitStatement(stmt, isReturning && isLast);
    }
    this.reassignedBlockVars.pop();
    this.localScopeVars.pop();
  }

  private emitStatement(stmt: Statement, isTrailingReturn = false): void {
    switch (stmt.kind) {
      case "LetBinding": {
        const currentScope =
          this.localScopeVars.length > 0
            ? this.localScopeVars[this.localScopeVars.length - 1]
            : null;
        const inEnclosingParamScope =
          this.localScopeVars.length === 2 && this.localScopeVars[0].has(stmt.name);
        const alreadyDeclared = (currentScope?.has(stmt.name) ?? false) || inEnclosingParamScope;
        if (currentScope) {
          currentScope.add(stmt.name);
        }
        if (stmt.typeAnnotation && stmt.typeAnnotation.kind === "NamedType") {
          this.varTypes.set(stmt.name, stmt.typeAnnotation.name);
        } else if (stmt.init.kind === "CallExpr" && stmt.init.callee.kind === "IdentifierExpr") {
          this.varTypes.set(stmt.name, stmt.init.callee.name);
        } else if (stmt.init.kind === "IdentifierExpr") {
          const existing = this.varTypes.get(stmt.init.name);
          if (existing) this.varTypes.set(stmt.name, existing);
        }
        if (alreadyDeclared) {
          this.ctx.writeLine(`${stmt.name} = ${this.emitExpr(stmt.init)};`);
          break;
        }
        const currentReassigned =
          this.reassignedBlockVars.length > 0
            ? this.reassignedBlockVars[this.reassignedBlockVars.length - 1]
            : null;
        const needsLet = stmt.isMut || (currentReassigned?.has(stmt.name) ?? false);
        const keyword = needsLet ? "let" : "const";
        const isInitUndefined =
          stmt.init.kind === "IdentifierExpr" && stmt.init.name === "undefined";
        let typeAnnotation = "";
        if (stmt.typeAnnotation && this.ctx.target !== "javascript") {
          if (isInitUndefined && stmt.typeAnnotation.kind === "OptionType") {
            typeAnnotation = `: ${this.emitTypeExpr(stmt.typeAnnotation.innerType)} | undefined`;
          } else {
            typeAnnotation = `: ${this.emitTypeExpr(stmt.typeAnnotation)}`;
          }
        }
        const isUninitNil =
          stmt.isMut &&
          stmt.typeAnnotation &&
          stmt.init.kind === "LiteralExpr" &&
          stmt.init.literalKind === "nil" &&
          stmt.typeAnnotation.kind !== "OptionType";
        const initCode = isUninitNil ? "" : ` = ${this.emitExpr(stmt.init)}`;
        this.ctx.writeLine(`${keyword} ${stmt.name}${typeAnnotation}${initCode};`);
        break;
      }
      case "DestructureBinding": {
        if (this.localScopeVars.length > 0) {
          const scope = this.localScopeVars[this.localScopeVars.length - 1];
          for (const name of stmt.names) {
            if (name && name.trim() !== "" && name !== "_") {
              scope.add(name);
            }
          }
        }
        const keyword = stmt.isMut ? "let" : "const";
        const names = stmt.names.join(", ");
        this.ctx.writeLine(`${keyword} [${names}] = ${this.emitExpr(stmt.init)};`);
        break;
      }
      case "AssignStmt": {
        if (
          stmt.target.kind === "ArrayLiteralExpr" &&
          stmt.op &&
          stmt.op !== "=" &&
          stmt.value.kind === "ArrayLiteralExpr" &&
          stmt.value.elements.length === stmt.target.elements.length
        ) {
          for (let i = 0; i < stmt.target.elements.length; i++) {
            const targetStr = this.emitExpr(stmt.target.elements[i]);
            const valStr = this.emitExpr(stmt.value.elements[i]);
            this.ctx.writeLine(`${targetStr} ${stmt.op} ${valStr};`);
          }
        } else {
          const targetStr = this.emitExpr(stmt.target);
          const valStr = this.emitExpr(stmt.value);
          this.ctx.writeLine(`${targetStr} ${stmt.op ?? "="} ${valStr};`);
        }
        break;
      }
      case "ReturnStmt": {
        if (stmt.value) {
          this.ctx.writeLine(`return ${this.emitExpr(stmt.value)};`);
        } else {
          this.ctx.writeLine("return;");
        }
        break;
      }
      case "IfStmt": {
        this.ctx.writeLine(`if (${this.emitExpr(stmt.condition)}) {`);
        this.ctx.indent();
        this.emitBlock(stmt.thenBranch, isTrailingReturn);
        this.ctx.dedent();

        for (const elif of stmt.elifBranches) {
          this.ctx.writeLine(`} else if (${this.emitExpr(elif.condition)}) {`);
          this.ctx.indent();
          this.emitBlock(elif.body, isTrailingReturn);
          this.ctx.dedent();
        }

        if (stmt.elseBranch) {
          this.ctx.writeLine("} else {");
          this.ctx.indent();
          this.emitBlock(stmt.elseBranch, isTrailingReturn);
          this.ctx.dedent();
        }
        this.ctx.writeLine("}");
        break;
      }
      case "ForStmt": {
        this.ctx.writeLine(`for (const ${stmt.variable} of ${this.emitExpr(stmt.iterable)}) {`);
        this.ctx.indent();
        const forScope = new Set<string>();
        if (stmt.variable.startsWith("[") || stmt.variable.startsWith("{")) {
          for (const id of this.extractDestructureIdentifiers(stmt.variable)) {
            forScope.add(id);
          }
        } else {
          forScope.add(stmt.variable);
        }
        this.localScopeVars.push(forScope);
        this.emitBlock(stmt.body);
        this.localScopeVars.pop();
        this.ctx.dedent();
        this.ctx.writeLine("}");
        break;
      }
      case "WhileStmt": {
        this.ctx.writeLine(`while (${this.emitExpr(stmt.condition)}) {`);
        this.ctx.indent();
        this.emitBlock(stmt.body);
        this.ctx.dedent();
        this.ctx.writeLine("}");
        break;
      }
      case "MatchStmt": {
        const targetStr = this.emitExpr(stmt.target);
        const canUseSwitch =
          stmt.cases.length > 0 &&
          stmt.cases.every((c, idx) => {
            if (c.guard) return false;
            if (c.pattern.kind === "LiteralPattern") return true;
            if (c.pattern.kind === "WildcardPattern" && idx === stmt.cases.length - 1) return true;
            return false;
          });

        if (canUseSwitch) {
          this.ctx.writeLine(`switch (${targetStr}) {`);
          for (const c of stmt.cases) {
            if (c.pattern.kind === "WildcardPattern") {
              this.ctx.writeLine("default: {");
            } else if (c.pattern.kind === "LiteralPattern") {
              this.ctx.writeLine(`case ${this.emitExpr(c.pattern.value)}: {`);
            }
            this.ctx.indent();
            if (c.body.kind === "Block") {
              this.emitBlock(c.body, isTrailingReturn);
              const lastStmt =
                c.body.statements.length > 0
                  ? c.body.statements[c.body.statements.length - 1]
                  : null;
              const endsWithReturn =
                isTrailingReturn ||
                (lastStmt &&
                  (lastStmt.kind === "ReturnStmt" ||
                    lastStmt.kind === "BreakStmt" ||
                    (lastStmt.kind === "ExprStmt" && isTrailingReturn)));
              if (!endsWithReturn) {
                this.ctx.writeLine("break;");
              }
            } else if (isTrailingReturn) {
              this.ctx.writeLine(`return ${this.emitExpr(c.body)};`);
            } else {
              this.ctx.writeLine(`${this.emitExpr(c.body)};`);
              this.ctx.writeLine("break;");
            }
            this.ctx.dedent();
            this.ctx.writeLine("}");
          }
          this.ctx.writeLine("}");
          break;
        }

        // Lower complex match/case into if-else cascade in TypeScript
        for (let i = 0; i < stmt.cases.length; i++) {
          const c = stmt.cases[i];
          const isFirst = i === 0;
          const prefix = isFirst ? "if" : "} else if";

          if (c.pattern.kind === "WildcardPattern") {
            this.ctx.writeLine("} else {");
          } else {
            let cond: string;
            if (c.pattern.kind === "LiteralPattern") {
              cond = `${targetStr} === ${this.emitExpr(c.pattern.value)}`;
            } else if (c.pattern.kind === "IdentifierPattern") {
              const enumVar = this.enumVariants.get(c.pattern.name);
              if (enumVar) {
                if (enumVar.isUnitEnum) {
                  cond = `${targetStr} === ${enumVar.parentEnum}.${c.pattern.name}`;
                } else {
                  cond = `${targetStr}.kind === "${c.pattern.name}"`;
                }
              } else {
                cond = `true /* ${c.pattern.name} */`;
              }
            } else if (c.pattern.kind === "ConstructorPattern") {
              cond = `${targetStr}.kind === "${c.pattern.name}"`;
            } else {
              cond = "true";
            }
            if (c.guard) {
              cond += ` && (${this.emitExpr(c.guard)})`;
            }
            this.ctx.writeLine(`${prefix} (${cond}) {`);
          }

          this.ctx.indent();
          if (c.body.kind === "Block") {
            this.emitBlock(c.body, isTrailingReturn);
          } else {
            this.ctx.writeLine(`return ${this.emitExpr(c.body)};`);
          }
          this.ctx.dedent();
        }
        this.ctx.writeLine("}");
        break;
      }
      case "ExprStmt": {
        if (isTrailingReturn && !this.isVoidExpr(stmt.expr)) {
          this.ctx.writeLine(`return ${this.emitExpr(stmt.expr)};`);
        } else {
          this.ctx.writeLine(`${this.emitExpr(stmt.expr)};`);
        }
        break;
      }
      case "BreakStmt": {
        this.ctx.writeLine("break;");
        break;
      }
      case "ContinueStmt": {
        this.ctx.writeLine("continue;");
        break;
      }
      case "ThrowStmt": {
        this.ctx.writeLine(`throw ${this.emitExpr(stmt.expr)};`);
        break;
      }
      case "TryStmt": {
        this.ctx.writeLine("try {");
        this.ctx.indent();
        this.emitBlock(stmt.tryBlock);
        this.ctx.dedent();

        if (stmt.catchBlock) {
          const param = stmt.catchParam ? ` (${stmt.catchParam})` : "";
          this.ctx.writeLine(`} catch${param} {`);
          this.ctx.indent();
          if (stmt.catchParam) {
            const catchScope = new Set<string>([stmt.catchParam]);
            this.localScopeVars.push(catchScope);
            this.emitBlock(stmt.catchBlock);
            this.localScopeVars.pop();
          } else {
            this.emitBlock(stmt.catchBlock);
          }
          this.ctx.dedent();
        }

        if (stmt.finallyBlock) {
          this.ctx.writeLine("} finally {");
          this.ctx.indent();
          this.emitBlock(stmt.finallyBlock);
          this.ctx.dedent();
        }

        this.ctx.writeLine("}");
        break;
      }
    }
  }

  emitExpr(expr: Expr, isCallee = false): string {
    switch (expr.kind) {
      case "LiteralExpr":
        if (expr.literalKind === "string") return JSON.stringify(expr.value);
        if (expr.literalKind === "nil") return "null";
        if (
          expr.rawValue &&
          (expr.rawValue.startsWith("0x") ||
            expr.rawValue.startsWith("0X") ||
            expr.rawValue.startsWith("0b") ||
            expr.rawValue.startsWith("0B"))
        ) {
          return expr.rawValue;
        }
        return String(expr.value);

      case "TemplateLiteralExpr": {
        let result = "`" + this.escapeTsTemplateQuasi(expr.quasis[0] ?? "");
        for (let i = 0; i < expr.expressions.length; i++) {
          result +=
            "${" +
            this.emitExpr(expr.expressions[i]) +
            "}" +
            this.escapeTsTemplateQuasi(expr.quasis[i + 1] ?? "");
        }
        result += "`";
        return result;
      }

      case "IdentifierExpr": {
        if (!this.isLocal(expr.name) && this.enumVariants.has(expr.name)) {
          const enumVar = this.enumVariants.get(expr.name);
          if (enumVar?.isUnitEnum) {
            return `${enumVar.parentEnum}.${expr.name}`;
          }
        }
        if (
          expr.name !== "this" &&
          expr.name !== "super" &&
          !this.isLocal(expr.name) &&
          !this.topLevelNames.has(expr.name) &&
          !this.isCurrentMethodStatic &&
          this.currentClassProperties?.has(expr.name)
        ) {
          if (isCallee && TypeScriptEmitter.KNOWN_BUILTINS.has(expr.name)) {
            const isMethod = this.currentClassMethods?.has(expr.name) ?? false;
            const isFunctionProp = this.currentClassFunctionProperties?.has(expr.name) ?? false;
            if (!isMethod && !isFunctionProp) {
              return expr.name;
            }
          }
          return `this.${expr.name}`;
        }
        return expr.name;
      }

      case "AwaitExpr":
        return `await ${this.emitExpr(expr.operand)}`;

      case "AssignExpr":
        return `(${this.emitExpr(expr.target)} ${expr.op ?? "="} ${this.emitExpr(expr.value)})`;

      case "BinaryExpr": {
        const left = this.emitExpr(expr.left);
        const right = this.emitExpr(expr.right);
        let op: string = expr.operator;
        if (op === "==") op = "===";
        if (op === "!=") op = "!==";
        if (op === "and") op = "&&";
        if (op === "or") op = "||";
        return `(${left} ${op} ${right})`;
      }

      case "UnaryExpr": {
        const operand = this.emitExpr(expr.operand);
        if (expr.operator === "...") {
          return `...${operand}`;
        }
        const op = expr.operator === "not" ? "!" : expr.operator;
        return `${op}(${operand})`;
      }

      case "CallExpr": {
        const argCodes = expr.args.map((a) => this.emitExpr(a));

        // Method lowering
        if (expr.callee.kind === "MemberAccessExpr") {
          const objCode = this.emitExpr(expr.callee.object);
          if (!expr.callee.isSafeNav && !expr.isOptional) {
            const lowered = lowerMethodCall(objCode, expr.callee.property, argCodes, "typescript");
            if (lowered.isLowered) {
              return lowered.code;
            }
          }
          const dot = expr.callee.isSafeNav ? "?." : ".";
          const opt = expr.isOptional ? "?." : "";
          return `${objCode}${dot}${expr.callee.property}${opt}(${argCodes.join(", ")})`;
        }

        // Positional Struct / Record Constructor Lowering
        if (expr.callee.kind === "IdentifierExpr") {
          const typeName = expr.callee.name;
          const fields = this.structTypes.get(typeName);
          if (fields && fields.length === expr.args.length) {
            const props = fields
              .map((fName, idx) => {
                const argExpr = expr.args[idx];
                if (argExpr.kind === "IdentifierExpr" && argExpr.name === fName) {
                  return fName;
                }
                return `${fName}: ${this.emitExpr(argExpr)}`;
              })
              .join(", ");
            return `{ ${props} }`;
          }

          const enumVar = this.enumVariants.get(typeName);
          if (enumVar && enumVar.payloadCount === expr.args.length) {
            if (enumVar.payloadCount === 0) {
              return `{ kind: "${typeName}" }`;
            }
            const payloads = expr.args
              .map((a, idx) => `item${idx}: ${this.emitExpr(a)}`)
              .join(", ");
            return `{ kind: "${typeName}", ${payloads} }`;
          }

          const lowered = lowerConstructor(expr.callee.name, argCodes, "typescript");
          if (lowered.isLowered) {
            return lowered.code;
          }

          if (expr.callee.name === "typeof" && expr.args.length === 1) {
            return `typeof (${argCodes[0]})`;
          }

          if (
            this.classNames.has(expr.callee.name) ||
            TypeScriptEmitter.BUILTIN_CONSTRUCTORS.has(expr.callee.name) ||
            (/^[A-Z][a-zA-Z0-9_]*$/.test(expr.callee.name) &&
              !this.enumVariants.has(expr.callee.name) &&
              !this.structTypes.has(expr.callee.name) &&
              expr.callee.name !== "String" &&
              expr.callee.name !== "Number" &&
              expr.callee.name !== "Boolean" &&
              expr.callee.name !== "BigInt" &&
              expr.callee.name !== "Symbol" &&
              expr.callee.name !== "Object")
          ) {
            return `new ${expr.callee.name}(${argCodes.join(", ")})`;
          }

          if (TypeScriptEmitter.MATH_BUILTINS.has(expr.callee.name)) {
            const isLocalShadowed = this.localScopeVars.some((scope) => scope.has(typeName));
            const isTopLevel = this.topLevelNames.has(typeName);
            const isMethod = this.currentClassMethods?.has(typeName) ?? false;
            const isFunctionProp = this.currentClassFunctionProperties?.has(typeName) ?? false;
            if (!isLocalShadowed && !isTopLevel && !isMethod && !isFunctionProp) {
              if (typeName === "clamp") {
                return `Math.max(${argCodes[1]}, Math.min(${argCodes[2]}, ${argCodes[0]}))`;
              }
              return `Math.${typeName}(${argCodes.join(", ")})`;
            }
          }

          if (TypeScriptEmitter.GLOBAL_BUILTIN_FUNCTIONS.has(expr.callee.name)) {
            const isLocalShadowed = this.localScopeVars.some((scope) => scope.has(typeName));
            const isMethod = this.currentClassMethods?.has(typeName) ?? false;
            const isFunctionProp = this.currentClassFunctionProperties?.has(typeName) ?? false;
            if (!isLocalShadowed && !isMethod && !isFunctionProp) {
              return `${typeName}(${argCodes.join(", ")})`;
            }
          }
        }

        let callee = this.emitExpr(expr.callee, true);
        if (expr.callee.kind === "ClosureExpr") {
          callee = `(${callee})`;
        }
        const opt = expr.isOptional ? "?." : "";
        return `${callee}${opt}(${argCodes.join(", ")})`;
      }

      case "MemberAccessExpr": {
        const obj = this.emitExpr(expr.object);
        if (!expr.isSafeNav) {
          const lowered = lowerPropertyAccess(obj, expr.property, "typescript");
          if (lowered.isLowered) {
            return lowered.code;
          }
        }
        const op = expr.isSafeNav ? "?." : ".";
        return `${obj}${op}${expr.property}`;
      }

      case "IndexExpr": {
        const obj = this.emitExpr(expr.object);
        const idx = this.emitExpr(expr.index);
        return `${obj}[${idx}]`;
      }

      case "ArrayLiteralExpr": {
        const elements = expr.elements.map((e) => this.emitExpr(e)).join(", ");
        return `[${elements}]`;
      }

      case "RecordLiteralExpr": {
        if (expr.properties.length === 0) return "{}";

        const spreadProp = expr.properties.find((p) => p.isSpread);
        if (spreadProp && spreadProp.value.kind === "IdentifierExpr") {
          const targetName = spreadProp.value.name;
          const typeName = this.varTypes.get(targetName);
          const structFields = typeName ? this.structTypes.get(typeName) : undefined;
          if (structFields) {
            const overrideMap = new Map<string, Expr>();
            for (const p of expr.properties) {
              if (!p.isSpread && p.key) {
                overrideMap.set(p.key, p.value);
              }
            }
            const props = structFields.map((fName) => {
              const val = overrideMap.get(fName);
              if (val) {
                if (val.kind === "IdentifierExpr" && val.name === fName) {
                  return fName;
                }
                return `${fName}: ${this.emitExpr(val)}`;
              }
              return `${fName}: ${targetName}.${fName}`;
            });
            return `{ ${props.join(", ")} }`;
          }
        }

        const props = expr.properties
          .map((p) => {
            if (p.isSpread) {
              return `...${this.emitExpr(p.value)}`;
            }
            if (p.value.kind === "IdentifierExpr" && p.value.name === p.key) {
              return p.key;
            }
            return `${p.key}: ${this.emitExpr(p.value)}`;
          })
          .join(", ");
        return `{ ${props} }`;
      }

      case "PostfixTryExpr": {
        // Desugar expr? into an unwrapped expression
        const operand = this.emitExpr(expr.operand);
        if (this.ctx.target === "javascript") {
          return operand;
        }
        return `(${operand} as any).value`;
      }

      case "ClosureExpr": {
        const closureScope = new Set<string>();
        for (const p of expr.params) {
          if (p.name.startsWith("[") || p.name.startsWith("{")) {
            for (const id of this.extractDestructureIdentifiers(p.name)) {
              closureScope.add(id);
            }
          } else {
            closureScope.add(p.name);
          }
        }
        this.localScopeVars.push(closureScope);
        const isJs = this.ctx.target === "javascript";
        const paramsStr = expr.params
          .map((p) => {
            const optMark = !isJs && p.isOptional && !p.defaultValue ? "?" : "";
            const typeStr = !isJs && p.typeAnnotation ? `: ${this.emitTypeExpr(p.typeAnnotation)}` : "";
            const defStr = p.defaultValue ? ` = ${this.emitExpr(p.defaultValue)}` : "";
            const rest = p.isRest ? "..." : "";
            return `${rest}${p.name}${optMark}${typeStr}${defStr}`;
          })
          .join(", ");
        const retStr = !isJs && expr.returnType ? `: ${this.emitTypeExpr(expr.returnType)}` : "";
        const asyncPrefix = expr.isAsync ? "async " : "";
        let result: string;
        if (expr.body.kind === "Block") {
          if (expr.body.statements.length === 0) {
            result = `${asyncPrefix}(${paramsStr})${retStr} => {}`;
          } else {
            const isReturning = !(
              expr.returnType &&
              expr.returnType.kind === "PrimitiveType" &&
              expr.returnType.primitive === "void"
            );
            const savedBuffer = (this.ctx as any).buffer;
            (this.ctx as any).buffer = [];
            this.ctx.indent();
            this.emitBlock(expr.body, isReturning);
            this.ctx.dedent();
            const blockContent = (this.ctx as any).buffer.join("");
            (this.ctx as any).buffer = savedBuffer;
            result = `${asyncPrefix}(${paramsStr})${retStr} => {\n${blockContent}${this.ctx.getIndent()}}`;
          }
        } else {
          const isVoidNil =
            expr.body.kind === "LiteralExpr" &&
            expr.body.literalKind === "nil" &&
            ((expr.returnType?.kind === "NamedType" && expr.returnType.name === "void") ||
              (expr.returnType?.kind === "PrimitiveType" &&
                (expr.returnType as any).primitive === "void"));
          if (isVoidNil) {
            result = `${asyncPrefix}(${paramsStr})${retStr} => {}`;
          } else {
            const bodyStr = this.emitExpr(expr.body);
            if (
              expr.body.kind === "RecordLiteralExpr" ||
              (bodyStr.startsWith("{") && bodyStr.endsWith("}"))
            ) {
              result = `${asyncPrefix}(${paramsStr})${retStr} => (${bodyStr})`;
            } else {
              result = `${asyncPrefix}(${paramsStr})${retStr} => ${bodyStr}`;
            }
          }
        }
        this.localScopeVars.pop();
        return result;
      }
    }
  }

  private splitTopLevelCommas(str: string): string[] {
    const parts: string[] = [];
    let depthParen = 0;
    let depthBrack = 0;
    let depthBrace = 0;
    let depthAngle = 0;
    let inString: false | '"' | "'" = false;
    let current = "";

    for (let i = 0; i < str.length; i++) {
      const char = str[i];
      if (inString) {
        current += char;
        if (char === "\\" && i + 1 < str.length) {
          current += str[++i];
        } else if (char === inString) {
          inString = false;
        }
        continue;
      }

      if (char === '"' || char === "'") {
        inString = char;
        current += char;
      } else if (char === "(") {
        depthParen++;
        current += char;
      } else if (char === ")") {
        if (depthParen > 0) depthParen--;
        current += char;
      } else if (char === "[") {
        depthBrack++;
        current += char;
      } else if (char === "]") {
        if (depthBrack > 0) depthBrack--;
        current += char;
      } else if (char === "{") {
        depthBrace++;
        current += char;
      } else if (char === "}") {
        if (depthBrace > 0) depthBrace--;
        current += char;
      } else if (char === "<") {
        depthAngle++;
        current += char;
      } else if (char === ">") {
        if (depthAngle > 0) depthAngle--;
        current += char;
      } else if (
        char === "," &&
        depthParen === 0 &&
        depthBrack === 0 &&
        depthBrace === 0 &&
        depthAngle === 0
      ) {
        parts.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    if (current.trim() || parts.length > 0) {
      parts.push(current.trim());
    }
    return parts;
  }

  private hasTopLevelColon(param: string): boolean {
    let depthParen = 0;
    let depthBrack = 0;
    let depthBrace = 0;
    let depthAngle = 0;
    let inString: false | '"' | "'" = false;

    for (let i = 0; i < param.length; i++) {
      const char = param[i];
      if (inString) {
        if (char === "\\" && i + 1 < param.length) i++;
        else if (char === inString) inString = false;
        continue;
      }
      if (char === '"' || char === "'") inString = char;
      else if (char === "(") depthParen++;
      else if (char === ")") {
        if (depthParen > 0) depthParen--;
      } else if (char === "[") depthBrack++;
      else if (char === "]") {
        if (depthBrack > 0) depthBrack--;
      } else if (char === "{") depthBrace++;
      else if (char === "}") {
        if (depthBrace > 0) depthBrace--;
      } else if (char === "<") depthAngle++;
      else if (char === ">") {
        if (depthAngle > 0) depthAngle--;
      } else if (
        char === ":" &&
        depthParen === 0 &&
        depthBrack === 0 &&
        depthBrace === 0 &&
        depthAngle === 0
      ) {
        return true;
      }
    }
    return false;
  }

  private normalizeArrowTypes(str: string): string {
    const stringLitRegex = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g;
    const stringRanges: [number, number][] = [];
    let m: RegExpExecArray | null;
    while ((m = stringLitRegex.exec(str)) !== null) {
      stringRanges.push([m.index, m.index + m[0].length]);
    }
    const isInsideString = (idx: number) =>
      stringRanges.some(([start, end]) => idx >= start && idx < end);

    const arrowIndices: number[] = [];
    let searchIdx = 0;
    while ((searchIdx = str.indexOf("=>", searchIdx)) !== -1) {
      if (!isInsideString(searchIdx)) {
        arrowIndices.push(searchIdx);
      }
      searchIdx += 2;
    }

    for (let k = arrowIndices.length - 1; k >= 0; k--) {
      const arrowIdx = arrowIndices[k];
      let closeParenIdx = -1;
      for (let i = arrowIdx - 1; i >= 0; i--) {
        if (/\s/.test(str[i])) continue;
        if (str[i] === ")" && !isInsideString(i)) {
          closeParenIdx = i;
        }
        break;
      }
      if (closeParenIdx === -1) continue;

      let depth = 0;
      let openParenIdx = -1;
      for (let i = closeParenIdx; i >= 0; i--) {
        if (isInsideString(i)) continue;
        if (str[i] === ")") depth++;
        else if (str[i] === "(") {
          depth--;
          if (depth === 0) {
            openParenIdx = i;
            break;
          }
        }
      }
      if (openParenIdx === -1) continue;

      const paramsStr = str.slice(openParenIdx + 1, closeParenIdx);
      let replacement: string;
      if (!paramsStr.trim()) {
        replacement = "()";
      } else {
        const rawParams = this.splitTopLevelCommas(paramsStr);
        const fixedParams = rawParams.map((p, idx) => {
          if (this.hasTopLevelColon(p)) return p;
          if (p.startsWith("...")) {
            return `..._rest: ${p.slice(3).trim()}`;
          }
          return `_arg${idx}: ${p}`;
        });
        replacement = `(${fixedParams.join(", ")})`;
      }
      str = str.slice(0, openParenIdx) + replacement + str.slice(closeParenIdx + 1);
    }
    return str;
  }

  private rewriteTypePrimitivesAndArrows(name: string): string {
    const stringLitRegex = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g;
    let lastIdx = 0;
    let match: RegExpExecArray | null;
    let result = "";

    const primitiveMap: Record<string, string> = {
      int: "number",
      float: "number",
      num: "number",
      byte: "number",
      str: "string",
      char: "string",
      bool: "boolean",
      nil: "null",
    };

    while ((match = stringLitRegex.exec(name)) !== null) {
      const nonString = name.slice(lastIdx, match.index);
      const replaced = nonString
        .replace(/->/g, "=>")
        .replace(
          /\b(int|float|num|byte|str|char|bool|nil)\b(?!\s*\??:)/g,
          (m) => primitiveMap[m] ?? m,
        );
      result += replaced + match[0];
      lastIdx = match.index + match[0].length;
    }

    const tail = name.slice(lastIdx);
    result += tail
      .replace(/->/g, "=>")
      .replace(
        /\b(int|float|num|byte|str|char|bool|nil)\b(?!\s*\??:)/g,
        (m) => primitiveMap[m] ?? m,
      );

    if (result.includes("=>")) {
      result = this.normalizeArrowTypes(result);
    }

    return result;
  }

  emitTypeExpr(t?: TypeExpr | null): string {
    if (!t) return "any";
    switch (t.kind) {
      case "PrimitiveType":
        if (
          t.primitive === "int" ||
          t.primitive === "float" ||
          t.primitive === "num" ||
          t.primitive === "byte"
        ) {
          return "number";
        }
        if (t.primitive === "str" || t.primitive === "char") return "string";
        if (t.primitive === "bool") return "boolean";
        if (t.primitive === "void") return "void";
        if (t.primitive === "nil") return "null";
        return "unknown";

      case "ArrayType": {
        const elem = this.emitTypeExpr(t.elementType);
        if (elem.includes("=>") || elem.includes("|") || elem.includes("&")) {
          return `Array<${elem}>`;
        }
        return `${elem}[]`;
      }

      case "TupleType": {
        const elements = t.elementTypes.map((e) => this.emitTypeExpr(e)).join(", ");
        return `[${elements}]`;
      }

      case "OptionType":
        return `${this.emitTypeExpr(t.innerType)} | null`;

      case "ResultType":
        return `{ ok: true; value: ${this.emitTypeExpr(t.okType)} } | { ok: false; error: ${this.emitTypeExpr(t.errType)} }`;

      case "RecordType": {
        const fields = t.fields
          .map((f) => `${f.name}${f.isOptional ? "?" : ""}: ${this.emitTypeExpr(f.type)};`)
          .join(" ");
        return `{ ${fields} }`;
      }

      case "RefinementType":
        return `${this.emitTypeExpr(t.baseType)} /* Refined: ${t.param} */`;

      case "NamedType": {
        if (t.typeArgs && t.typeArgs.length > 0) {
          const args = t.typeArgs.map((ta) => this.emitTypeExpr(ta)).join(", ");
          return `${t.name}<${args}>`;
        }
        let name = t.name;
        if (name.includes("{") || name.includes("|") || name.includes("=>") || name.includes("->")) {
          return this.rewriteTypePrimitivesAndArrows(name);
        }
        if (t.name === "int" || t.name === "float" || t.name === "num" || t.name === "byte") {
          return "number";
        }
        if (t.name === "str" || t.name === "char") return "string";
        if (t.name === "bool") return "boolean";
        if (t.name === "nil") return "null";
        return t.name;
      }
    }
  }

  // React 19 TSX Declarative Component Emitter
  private emitComponentDecl(comp: ComponentDecl): void {
    const nodeId = `component:${comp.name}`;
    if (this.canReplaySourceSlice(comp, nodeId)) {
      const slice = this.getSourceSlice(comp, nodeId)!;
      this.ctx.writeLine(slice.trimEnd());
      return;
    }
    this.ctx.emitLeadingTrivia(nodeId);

    if (comp.params.length > 0) {
      const propsInterface = `${comp.name}Props`;
      if (!this.emittedTypeDecls.has(propsInterface)) {
        this.ctx.writeLine(`export interface ${propsInterface} {`);
        this.ctx.indent();
        for (const p of comp.params) {
          const optMark = p.isOptional && !p.defaultValue ? "?" : "";
          this.ctx.writeLine(`${p.name}${optMark}: ${this.emitTypeExpr(p.typeAnnotation)};`);
        }
        this.ctx.dedent();
        this.ctx.writeLine("}");
        this.ctx.writeLine();
      }

      this.ctx.writeLine(
        `export function ${comp.name}({ ${comp.params.map((p) => p.name).join(", ")} }: ${propsInterface}) {`,
      );
    } else {
      this.ctx.writeLine(`export function ${comp.name}() {`);
    }
    this.ctx.indent();
    this.ctx.writeLine("return (");
    this.ctx.indent();

    for (const node of comp.layout) {
      this.emitLayoutNode(node);
    }

    this.ctx.dedent();
    this.ctx.writeLine(");");
    this.ctx.dedent();
    this.ctx.writeLine("}");
    this.ctx.emitTrailingTrivia(nodeId);
  }

  private emitLayoutNode(node: LayoutNode): void {
    const attrs = node.attributes
      .map((a) => {
        const name = a.name === "class" ? "className" : a.name;
        if (a.value.kind === "LiteralExpr" && a.value.literalKind === "string") {
          return `${name}=${JSON.stringify(a.value.value)}`;
        }
        return `${name}={${this.emitExpr(a.value)}}`;
      })
      .join(" ");

    const attrStr = attrs.length > 0 ? ` ${attrs}` : "";

    if (node.textLiteral !== null && node.children.length === 0) {
      this.ctx.writeLine(`<${node.tag}${attrStr}>${node.textLiteral}</${node.tag}>`);
      return;
    }

    if (node.childExpr && node.children.length === 0) {
      this.ctx.writeLine(`<${node.tag}${attrStr}>{${this.emitExpr(node.childExpr)}}</${node.tag}>`);
      return;
    }

    if (node.children.length === 0) {
      this.ctx.writeLine(`<${node.tag}${attrStr} />`);
      return;
    }

    this.ctx.writeLine(`<${node.tag}${attrStr}>`);
    this.ctx.indent();
    for (const child of node.children) {
      this.emitLayoutNode(child);
    }
    this.ctx.dedent();
    this.ctx.writeLine(`</${node.tag}>`);
  }

  private emitStyleDecl(s: StyleDecl): void {
    const nodeId = `style:${s.name}`;
    if (this.canReplaySourceSlice(s, nodeId)) {
      const slice = this.getSourceSlice(s, nodeId)!;
      this.ctx.writeLine(slice.trimEnd());
      return;
    }
    this.ctx.writeLine(`export const ${s.name} = {`);
    this.ctx.indent();
    for (const p of s.properties) {
      const prop = toCssProperty(p.property);
      this.ctx.writeLine(`${JSON.stringify(prop)}: ${JSON.stringify(p.value)},`);
    }
    this.ctx.dedent();
    const asConst = this.ctx.target === "javascript" ? "" : " as const";
    this.ctx.writeLine(`}${asConst};`);
  }

  private sanitizeModulePath(p: string): string {
    return p.replace(/[^a-zA-Z0-9_]/g, "_");
  }

  private escapeTsTemplateQuasi(s: string): string {
    return s.replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
  }
}

/**
 * High-level TypeScript emitter entrypoint.
 */
export function emitTypeScript(mod: Module, options: EmitterOptions = {}): string {
  const emitter = new TypeScriptEmitter(options);
  return emitter.emit(mod);
}
