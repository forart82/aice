/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AICE Semantic AST Skeleton Outline Engine (Step 18).
 * Provides semantic skeletonization achieving 85–90%+ token reduction for AI contexts.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import postcss from "postcss";
import { getCachedTsSymbolIndex, type TsFileSymbolIndex } from "../compat/typescript.js";
import {
  AICE_DISABLED_MESSAGE,
  findProjectRoot,
  isProjectAiceEnabled,
  isProjectIdiomsEnabled,
  KNOWN_TARGET_EXTENSIONS,
  loadProjectConfig,
  type ProjectIdiomDefinition,
} from "../config/index.js";
import type { Module, ParamDecl, TypeExpr } from "../core/ast.js";
import { parseWithTrivia } from "../core/parser.js";
import { CstTriviaTable } from "../core/trivia.js";
import { decompile } from "../decompiler/index.js";
import { detectTargetFromPathOrContent, type TargetLanguage } from "../emitters/index.js";
import { collapseModuleIdioms } from "../idioms/idiom-transform.js";
import { recordTelemetryEvent, withSuppressedTelemetry } from "../telemetry/index.js";
import { estimateTokens } from "../tokenomics/index.js";
import { maskSourceLexically } from "./preprocessor.js";
import {
  extractNativeTestBlocks,
  extractScriptOrMarkdownSymbols,
  locateNativeDeclarationSpan,
} from "./splice.js";
import { formatNativeSyntaxDiagnosticsMarkdown } from "./syntax-validator.js";

export interface OutlineOptions {
  depth?: number;
  includeTypes?: boolean;
  idioms?: boolean;
  json?: boolean;
  stats?: boolean;
  lineRanges?: boolean;
  compact?: boolean;
  projectRoot?: string;
  filePath?: string;
  preReadSource?: string;
  skipTokenStats?: boolean;
  preloadedConfigChecked?: boolean;
  preloadedIdiomsActive?: boolean;
  preloadedIdiomsConfig?: Record<string, ProjectIdiomDefinition>;
}
export interface OutlineSymbol {
  name: string;
  kind: string;
  line: number;
  endLine?: number;
  lineRange?: string;
  signature: string;
  children?: OutlineSymbol[];
  docstring?: string;
}

export interface OutlineStats {
  originalTokens: number;
  outlineTokens: number;
  savingsTokens: number;
  savingsPct: number;
  originalChars: number;
  outlineChars: number;
  charSavingsPct: number;
}

export interface OutlineResult {
  file: string;
  text: string;
  symbols: OutlineSymbol[];
  referencedIdioms?: string[];
  json?: {
    file: string;
    symbols: OutlineSymbol[];
    referencedIdioms?: string[];
    stats?: OutlineStats;
  };
  stats?: OutlineStats;
}

export function formatTypeExpr(t?: TypeExpr | null): string {
  if (!t) return "";
  switch (t.kind) {
    case "PrimitiveType":
      return t.primitive;
    case "ArrayType":
      return `[${formatTypeExpr(t.elementType)}]`;
    case "TupleType": {
      const elements = t.elementTypes.map((e) => formatTypeExpr(e)).join(", ");
      return t.elementTypes.length === 1 ? `[${elements},]` : `[${elements}]`;
    }
    case "RecordType": {
      const fields = t.fields.map((f) => `${f.name}:${formatTypeExpr(f.type)}`).join(", ");
      return `{ ${fields} }`;
    }
    case "ResultType":
      return `Result[${formatTypeExpr(t.okType)}, ${formatTypeExpr(t.errType)}]`;
    case "OptionType": {
      const inner = formatTypeExpr(t.innerType);
      return `${inner}?`;
    }
    case "RefinementType":
      return `{ ${t.param}:${t.baseType.primitive} | ... }`;
    case "NamedType": {
      if (t.name === "null" || t.name === "undefined") {
        return "nil";
      }
      if (t.typeArgs && t.typeArgs.length > 0) {
        const args = t.typeArgs.map((ta) => formatTypeExpr(ta)).join(", ");
        return `${t.name}[${args}]`;
      }
      return t.name;
    }
    default:
      return "";
  }
}

function formatParam(p: ParamDecl, includeTypes: boolean): string {
  const pub = p.isPub ? "pub " : "";
  const ro = p.isReadonly ? "readonly " : "";
  const mut = p.isMut ? "mut " : "";
  const opt = p.isOptional ? "?" : "";
  if (!includeTypes) {
    return `${pub}${ro}${mut}${p.name}${opt}`;
  }
  const typeStr = p.typeAnnotation ? `: ${formatTypeExpr(p.typeAnnotation)}` : "";
  const def = p.defaultValue ? " = ..." : "";
  return `${pub}${ro}${mut}${p.name}${opt}${typeStr}${def}`;
}

function getLeadingTriviaDoc(trivia: CstTriviaTable, nodeId: string): string | undefined {
  const entry = trivia.getTrivia(nodeId);
  if (!entry || entry.leading.length === 0) return undefined;
  const comments = entry.leading
    .filter(
      (item) =>
        item.kind === "LINE_COMMENT" || item.kind === "BLOCK_COMMENT" || item.kind === "DOCSTRING",
    )
    .map((item) => item.content.trimEnd());
  return comments.length > 0 ? comments.join("\n") : undefined;
}

export function generateOutline(
  sourceOrMod: string | Module,
  filePathOrOptions: string | OutlineOptions = {},
  maybeOptions: OutlineOptions = {},
): OutlineResult {
  const options: OutlineOptions =
    typeof filePathOrOptions === "string" ? maybeOptions : filePathOrOptions;
  const explicitFilePath =
    options.filePath ?? (typeof filePathOrOptions === "string" ? filePathOrOptions : undefined);

  const includeTypes = options.includeTypes !== false;
  const maxDepth = options.depth !== undefined ? options.depth : Infinity;
  const isJson = options.json === true;

  let filePath = explicitFilePath || "<anonymous>";
  let originalSource = "";
  let ast: Module;
  let trivia = new CstTriviaTable();

  const symbolAstEndLines = new WeakMap<OutlineSymbol, number>();

  let idiomsResolved = Boolean(options.preloadedConfigChecked);
  let idiomsConfig: Record<string, ProjectIdiomDefinition> | undefined =
    options.preloadedIdiomsConfig;
  let idiomsActive = options.preloadedConfigChecked
    ? (options.preloadedIdiomsActive ?? false)
    : true;

  let resolvedProjectRoot: string | undefined = options.projectRoot
    ? path.resolve(options.projectRoot)
    : undefined;

  const ensureIdiomsResolved = (targetPath: string, isRealDiskFile = false) => {
    if (idiomsResolved) return;
    idiomsResolved = true;
    try {
      const diskTargetExists =
        targetPath !== "<anonymous>" &&
        (isRealDiskFile || path.isAbsolute(targetPath)) &&
        fs.existsSync(targetPath);
      const hasScopedTarget = Boolean(resolvedProjectRoot) || diskTargetExists;
      const root = (() => {
        if (resolvedProjectRoot) return resolvedProjectRoot;
        if (diskTargetExists) {
          const resolvedTarget = path.resolve(targetPath);
          const st = fs.statSync(resolvedTarget);
          const targetDir = st.isDirectory() ? resolvedTarget : path.dirname(resolvedTarget);
          const cwdResolved = path.resolve(process.cwd());
          const fallbackDir =
            targetDir === cwdResolved || targetDir.startsWith(`${cwdResolved}${path.sep}`)
              ? cwdResolved
              : targetDir;
          return findProjectRoot(targetDir, fallbackDir);
        }
        return findProjectRoot(process.cwd());
      })();
      if (hasScopedTarget) {
        resolvedProjectRoot = root;
      }
      const cfg = loadProjectConfig(root);
      if (hasScopedTarget && !isProjectAiceEnabled(cfg)) {
        throw new Error(AICE_DISABLED_MESSAGE);
      }
      idiomsActive = isProjectIdiomsEnabled(cfg, options.idioms);
      if (idiomsActive) {
        idiomsConfig = cfg.idioms;
      }
    } catch (err) {
      if (err instanceof Error && err.message === AICE_DISABLED_MESSAGE) {
        throw err;
      }
    }
  };

  const hasActiveIdiomsForOutline = () =>
    idiomsActive && Boolean(idiomsConfig && Object.keys(idiomsConfig).length > 0);

  if (typeof sourceOrMod === "object" && sourceOrMod !== null && sourceOrMod.kind === "Module") {
    ast = sourceOrMod;
    filePath = explicitFilePath || ast.path || "<anonymous>";
    const isRealDisk =
      filePath !== "<anonymous>" && fs.existsSync(filePath) && fs.statSync(filePath).isFile();
    ensureIdiomsResolved(filePath, isRealDisk);
    if (options.preReadSource !== undefined) {
      originalSource = options.preReadSource;
    } else if (isRealDisk) {
      try {
        originalSource = fs.readFileSync(filePath, "utf-8");
      } catch {
        // ignore
      }
    }
  } else if (typeof sourceOrMod === "string") {
    const candidateFilePath =
      !sourceOrMod.includes("\n") &&
      resolvedProjectRoot &&
      !path.isAbsolute(sourceOrMod) &&
      fs.existsSync(path.resolve(resolvedProjectRoot, sourceOrMod))
        ? path.resolve(resolvedProjectRoot, sourceOrMod)
        : sourceOrMod;
    const isFile =
      !sourceOrMod.includes("\n") &&
      fs.existsSync(candidateFilePath) &&
      fs.statSync(candidateFilePath).isFile();
    if (isFile) {
      filePath = candidateFilePath;
      ensureIdiomsResolved(filePath, true);
      originalSource = options.preReadSource ?? fs.readFileSync(filePath, "utf-8");
      if (filePath.endsWith(".aice")) {
        const parsed = parseWithTrivia(originalSource, filePath);
        ast = parsed.ast;
        trivia = parsed.trivia;
      } else {
        const detected = detectTargetFromPathOrContent(filePath, originalSource);
        if (detected === "passthrough") {
          ast = {
            kind: "Module",
            path: filePath,
            items: [],
            span: {
              file: filePath,
              start: { line: 1, column: 1, offset: 0 },
              end: {
                line: originalSource.split(/\r?\n/).length,
                column: 1,
                offset: originalSource.length,
              },
            },
          };
          trivia = new CstTriviaTable();
        } else {
          const targetLang = detected;
          try {
            const decompResult = withSuppressedTelemetry(() =>
              decompile(originalSource, targetLang, {
                filePath,
                projectRoot: resolvedProjectRoot,
                skipCodeGen: true,
                skeletonOnly: !hasActiveIdiomsForOutline(),
              }),
            );
            ast = decompResult.ast;
            trivia = decompResult.trivia;
          } catch (err) {
            if (err instanceof Error && err.message === AICE_DISABLED_MESSAGE) {
              throw err;
            }
            ast = {
              kind: "Module",
              path: filePath,
              items: [],
              span: {
                file: filePath,
                start: { line: 1, column: 1, offset: 0 },
                end: { line: 1, column: 1, offset: 0 },
              },
            };
            trivia = new CstTriviaTable();
          }
        }
      }
    } else {
      filePath = explicitFilePath || "<anonymous>";
      ensureIdiomsResolved(filePath, false);
      originalSource = sourceOrMod;
      const detected = explicitFilePath
        ? detectTargetFromPathOrContent(explicitFilePath, originalSource)
        : "passthrough";
      if (detected !== "passthrough" && explicitFilePath && !explicitFilePath.endsWith(".aice")) {
        const targetLang = detected;
        try {
          const decompResult = withSuppressedTelemetry(() =>
            decompile(originalSource, targetLang, {
              filePath: explicitFilePath,
              projectRoot: resolvedProjectRoot,
              skipCodeGen: true,
              skeletonOnly: !hasActiveIdiomsForOutline(),
            }),
          );
          ast = decompResult.ast;
          trivia = decompResult.trivia;
        } catch (err) {
          if (err instanceof Error && err.message === AICE_DISABLED_MESSAGE) {
            throw err;
          }
          ast = {
            kind: "Module",
            path: explicitFilePath,
            items: [],
            span: {
              file: explicitFilePath,
              start: { line: 1, column: 1, offset: 0 },
              end: { line: 1, column: 1, offset: 0 },
            },
          };
          trivia = new CstTriviaTable();
        }
      } else {
        try {
          const parsed = parseWithTrivia(originalSource, filePath);
          ast = parsed.ast;
          trivia = parsed.trivia;
        } catch (err) {
          if (detected !== "passthrough") {
            try {
              const targetLang = detected;
              const decompResult = withSuppressedTelemetry(() =>
                decompile(originalSource, targetLang, {
                  filePath,
                  projectRoot: resolvedProjectRoot,
                  skipCodeGen: true,
                  skeletonOnly: !hasActiveIdiomsForOutline(),
                }),
              );
              ast = decompResult.ast;
              trivia = decompResult.trivia;
            } catch {
              throw err;
            }
          } else {
            ast = {
              kind: "Module",
              path: filePath,
              items: [],
              span: {
                file: filePath,
                start: { line: 1, column: 1, offset: 0 },
                end: { line: 1, column: 1, offset: 0 },
              },
            };
            trivia = new CstTriviaTable();
          }
        }
      }
    }
  } else {
    throw new Error("Invalid sourceOrMod argument provided to generateOutline");
  }

  const symbols: OutlineSymbol[] = [];
  const pushTrackedSymbol = (
    targetList: OutlineSymbol[],
    sym: OutlineSymbol,
    spanEndLine?: number,
  ) => {
    if (spanEndLine !== undefined && spanEndLine >= sym.line) {
      symbolAstEndLines.set(sym, spanEndLine);
    }
    targetList.push(sym);
  };

  if (maxDepth >= 1) {
    for (const item of ast.items) {
      switch (item.kind) {
        case "ImportDecl": {
          const line = item.span?.start?.line || 1;
          const sig =
            item.specifiers.length === 0
              ? `import "${item.source}"`
              : `from "${item.source}" import { ${item.specifiers.map((s) => (s.alias ? `${s.name} as ${s.alias}` : s.name)).join(", ")} }`;
          pushTrackedSymbol(
            symbols,
            {
              name: item.source,
              kind: "import",
              line,
              signature: sig,
              children: [],
            },
            item.span?.end?.line,
          );
          break;
        }
        case "FunctionDecl": {
          if (item.name === "__top_level__") break;
          const line = item.span?.start?.line || 1;
          const pub = item.isExported ? "pub " : "";
          const asy = item.isAsync ? "async " : "";
          const typeParams =
            item.typeParams && item.typeParams.length > 0 ? `[${item.typeParams.join(", ")}]` : "";
          const paramsStr = item.params.map((p) => formatParam(p, includeTypes)).join(", ");
          const retStr =
            includeTypes && item.returnType ? ` -> ${formatTypeExpr(item.returnType)}` : "";
          const fnKeyword = "fn";
          const sig = `${pub}${asy}${fnKeyword} ${item.name}${typeParams}(${paramsStr})${retStr}: ...`;
          const docstring = getLeadingTriviaDoc(trivia, `fn:${item.name}`);
          pushTrackedSymbol(
            symbols,
            {
              name: item.name,
              kind: "function",
              line,
              signature: sig,
              children: [],
              docstring,
            },
            item.span?.end?.line,
          );
          break;
        }
        case "ClassDecl": {
          const line = item.span?.start?.line || 1;
          const pub = item.isExported ? "pub " : "";
          const typeParams =
            item.typeParams && item.typeParams.length > 0 ? `[${item.typeParams.join(", ")}]` : "";
          const ctorStr =
            item.primaryConstructor && item.primaryConstructor.length > 0
              ? `(${item.primaryConstructor.map((p) => formatParam(p, includeTypes)).join(", ")})`
              : "";
          const ext = item.extends ? ` extends ${item.extends}` : "";
          const impl =
            item.implements && item.implements.length > 0
              ? ` implements ${item.implements.join(", ")}`
              : "";
          const sig = `${pub}class ${item.name}${typeParams}${ctorStr}${ext}${impl}: ...`;
          const docstring = getLeadingTriviaDoc(trivia, `class:${item.name}`);

          const children: OutlineSymbol[] = [];
          if (maxDepth >= 2) {
            for (const p of item.properties) {
              const pLine = p.span?.start?.line || line;
              const st = p.isStatic ? "static " : "";
              const ro = p.isReadonly ? "val " : "";
              const opt = p.isOptional ? "?" : "";
              const typeAnn =
                includeTypes && p.typeAnnotation ? `: ${formatTypeExpr(p.typeAnnotation)}` : "";
              const propSig = `${st}${ro}${p.name}${opt}${typeAnn}`;
              const propDoc = getLeadingTriviaDoc(trivia, `field:${item.name}.${p.name}`);
              pushTrackedSymbol(
                children,
                {
                  name: p.name,
                  kind: "property",
                  line: pLine,
                  signature: propSig,
                  children: [],
                  docstring: propDoc,
                },
                p.span?.end?.line,
              );
            }

            for (const m of item.methods) {
              const mLine = m.span?.start?.line || line;
              const st = m.isStatic ? "static " : "";
              const asy = m.isAsync ? "async " : "";
              const acc = m.accessor ? `${m.accessor} ` : "";
              const mTypeParams =
                m.typeParams && m.typeParams.length > 0 ? `[${m.typeParams.join(", ")}]` : "";
              const paramsStr = m.params.map((p) => formatParam(p, includeTypes)).join(", ");
              const retStr =
                includeTypes && m.returnType ? ` -> ${formatTypeExpr(m.returnType)}` : "";
              const fnKeyword = "fn";
              const methSig = `${st}${asy}${acc}${fnKeyword} ${m.name}${mTypeParams}(${paramsStr})${retStr}: ...`;
              const methDoc = getLeadingTriviaDoc(trivia, `method:${item.name}.${m.name}`);
              pushTrackedSymbol(
                children,
                {
                  name: m.name,
                  kind: "method",
                  line: mLine,
                  signature: methSig,
                  children: [],
                  docstring: methDoc,
                },
                m.span?.end?.line,
              );
            }
          }

          pushTrackedSymbol(
            symbols,
            {
              name: item.name,
              kind: "class",
              line,
              signature: sig,
              children,
              docstring,
            },
            item.span?.end?.line,
          );
          break;
        }
        case "TypeDecl": {
          const line = item.span?.start?.line || 1;
          const docstring = getLeadingTriviaDoc(trivia, `type:${item.name}`);

          if (item.isEnum) {
            const sig = `enum ${item.name}: ...`;
            const children: OutlineSymbol[] = [];
            if (maxDepth >= 2 && item.variants) {
              for (const v of item.variants) {
                const vLine = v.span?.start?.line || line;
                const vPayload =
                  includeTypes && v.payloadTypes && v.payloadTypes.length > 0
                    ? `(${v.payloadTypes.map((pt) => formatTypeExpr(pt)).join(", ")})`
                    : "";
                pushTrackedSymbol(
                  children,
                  {
                    name: v.name,
                    kind: "variant",
                    line: vLine,
                    signature: `${v.name}${vPayload}`,
                    children: [],
                  },
                  v.span?.end?.line,
                );
              }
            }
            pushTrackedSymbol(
              symbols,
              {
                name: item.name,
                kind: "enum",
                line,
                signature: sig,
                children,
                docstring,
              },
              item.span?.end?.line,
            );
          } else if (item.aliasType) {
            const typeParams =
              item.typeParams && item.typeParams.length > 0
                ? `[${item.typeParams.join(", ")}]`
                : "";
            const aliasStr = includeTypes ? ` = ${formatTypeExpr(item.aliasType)}` : "";
            const sig = `type ${item.name}${typeParams}${aliasStr}`;
            pushTrackedSymbol(
              symbols,
              {
                name: item.name,
                kind: "type",
                line,
                signature: sig,
                children: [],
                docstring,
              },
              item.span?.end?.line,
            );
          } else {
            const typeParams =
              item.typeParams && item.typeParams.length > 0
                ? `[${item.typeParams.join(", ")}]`
                : "";
            let kind = "interface";
            const lower = item.name.toLowerCase();
            if (lower.includes("record") || lower.endsWith("rec")) {
              kind = "record";
            }
            const sig = `type ${item.name}${typeParams}: ...`;
            const children: OutlineSymbol[] = [];

            if (maxDepth >= 2 && item.fields) {
              for (const f of item.fields) {
                const fLine = f.span?.start?.line || line;
                const opt = f.isOptional ? "?" : "";
                const typeAnn =
                  includeTypes && f.typeAnnotation ? `: ${formatTypeExpr(f.typeAnnotation)}` : "";
                const fDoc = getLeadingTriviaDoc(trivia, `field:${item.name}.${f.name}`);
                pushTrackedSymbol(
                  children,
                  {
                    name: f.name,
                    kind: "field",
                    line: fLine,
                    signature: `${f.name}${opt}${typeAnn}`,
                    children: [],
                    docstring: fDoc,
                  },
                  f.span?.end?.line,
                );
              }
            }

            pushTrackedSymbol(
              symbols,
              {
                name: item.name,
                kind,
                line,
                signature: sig,
                children,
                docstring,
              },
              item.span?.end?.line,
            );
          }
          break;
        }
        case "ConstDecl": {
          if (item.name === "_") break;
          const line = item.span?.start?.line || 1;
          const pub = item.isExported ? "pub " : "";
          const typeAnn =
            includeTypes && item.typeAnnotation ? `: ${formatTypeExpr(item.typeAnnotation)}` : "";
          const sig = `${pub}const ${item.name}${typeAnn}`;
          const docstring = getLeadingTriviaDoc(trivia, `const:${item.name}`);
          const children: OutlineSymbol[] = [];
          if (maxDepth >= 2 && item.value?.kind === "RecordLiteralExpr") {
            for (const prop of item.value.properties) {
              if (!prop.key) continue;
              const pLine = prop.span?.start?.line || line;
              const valDesc =
                prop.value.kind === "RecordLiteralExpr"
                  ? "{ ... }"
                  : prop.value.kind === "ArrayLiteralExpr"
                    ? "[...]"
                    : prop.value.kind === "LiteralExpr"
                      ? prop.value.literalKind
                      : "...";
              pushTrackedSymbol(
                children,
                {
                  name: prop.key,
                  kind: "field",
                  line: pLine,
                  signature: `${prop.key}: ${valDesc}`,
                  children: [],
                },
                prop.span?.end?.line,
              );
            }
          }
          pushTrackedSymbol(
            symbols,
            {
              name: item.name,
              kind: "const",
              line,
              signature: sig,
              children,
              docstring,
            },
            item.span?.end?.line,
          );
          break;
        }
        case "VarDecl": {
          if (item.name === "_") break;
          const line = item.span?.start?.line || 1;
          const pub = item.isExported ? "pub " : "";
          const kw = item.isMut ? "mut " : "val ";
          const typeAnn =
            includeTypes && item.typeAnnotation ? `: ${formatTypeExpr(item.typeAnnotation)}` : "";
          const sig = `${pub}${kw}${item.name}${typeAnn}`;
          const docstring = getLeadingTriviaDoc(trivia, `var:${item.name}`);
          pushTrackedSymbol(
            symbols,
            {
              name: item.name,
              kind: "var",
              line,
              signature: sig,
              children: [],
              docstring,
            },
            item.span?.end?.line,
          );
          break;
        }
        case "ComponentDecl": {
          const line = item.span?.start?.line || 1;
          const paramsStr = item.params
            .map((p) => {
              const opt = p.isOptional ? "?" : "";
              const typeStr =
                includeTypes && p.typeAnnotation ? `: ${formatTypeExpr(p.typeAnnotation)}` : "";
              return `${p.name}${opt}${typeStr}`;
            })
            .join(", ");
          const sig = `component ${item.name}(${paramsStr}): ...`;
          const docstring = getLeadingTriviaDoc(trivia, `component:${item.name}`);
          const children: OutlineSymbol[] = [];
          if (maxDepth >= 2 && item.layout) {
            for (const c of item.layout) {
              const cLine = c.span?.start?.line || line;
              const cId = c.attributes.find((a) => a.name === "id");
              const cClass = c.attributes.find((a) => a.name === "class");
              const cIdPart =
                cId?.value.kind === "LiteralExpr" && typeof cId.value.value === "string"
                  ? `#${cId.value.value}`
                  : "";
              const cClassPart =
                cClass?.value.kind === "LiteralExpr" && typeof cClass.value.value === "string"
                  ? `.${cClass.value.value.trim().split(/\s+/)[0]}`
                  : "";
              pushTrackedSymbol(
                children,
                {
                  name: `${c.tag}${cIdPart}${cClassPart}`,
                  kind: "layout",
                  line: cLine,
                  signature: `${c.tag}${cIdPart}${cClassPart}: ...`,
                  children: [],
                },
                c.span?.end?.line,
              );
            }
          }
          pushTrackedSymbol(
            symbols,
            {
              name: item.name,
              kind: "component",
              line,
              signature: sig,
              children,
              docstring,
            },
            item.span?.end?.line,
          );
          break;
        }
        case "StyleDecl": {
          const line = item.span?.start?.line || 1;
          const sig = `style ${item.name}: ...`;
          const docstring = getLeadingTriviaDoc(trivia, `style:${item.name}`);
          pushTrackedSymbol(
            symbols,
            {
              name: item.name,
              kind: "style",
              line,
              signature: sig,
              children: [],
              docstring,
            },
            item.span?.end?.line,
          );
          break;
        }
      }
    }
  }

  enrichAndResolveSymbolLineRanges(symbols, symbolAstEndLines, originalSource, filePath, maxDepth);

  // Generate Skeleton Outline Text
  const isRealFile =
    filePath !== "<anonymous>" && filePath !== "<stdin>" && fs.existsSync(filePath);
  const includeLineRanges = options.lineRanges !== undefined ? options.lineRanges : isRealFile;
  const baseOutlineLines: string[] = [];
  const annotatedOutlineLines: string[] = [];
  for (let i = 0; i < symbols.length; i++) {
    const sym = symbols[i];
    const symRangeSuffix = sym.lineRange ? ` # ${sym.lineRange}` : "";
    if (
      i > 0 &&
      (sym.kind === "class" ||
        sym.kind === "function" ||
        sym.kind === "enum" ||
        sym.kind === "interface" ||
        sym.kind === "record" ||
        sym.kind === "component")
    ) {
      baseOutlineLines.push("");
      annotatedOutlineLines.push("");
    }

    if (sym.docstring) {
      baseOutlineLines.push(sym.docstring);
      annotatedOutlineLines.push(sym.docstring);
    }

    if (sym.kind === "class") {
      if (sym.children && sym.children.length > 0) {
        // Strip trailing ' ...' into ':' for multiline outline
        const header = sym.signature.endsWith(": ...") ? sym.signature.slice(0, -4) : sym.signature;
        baseOutlineLines.push(header);
        annotatedOutlineLines.push(`${header}${symRangeSuffix}`);
        for (const child of sym.children) {
          const childSuffix = child.lineRange ? ` # ${child.lineRange}` : "";
          if (child.docstring) {
            for (const dLine of child.docstring.split("\n")) {
              baseOutlineLines.push(`  ${dLine}`);
              annotatedOutlineLines.push(`  ${dLine}`);
            }
          }
          baseOutlineLines.push(`  ${child.signature}`);
          annotatedOutlineLines.push(`  ${child.signature}${childSuffix}`);
          if (shouldExtractInternalLandmarks(child, originalSource, maxDepth)) {
            const childLandmarks = extractInternalLandmarks(
              child,
              originalSource,
              filePath,
              "    ",
            );
            for (const lm of childLandmarks) {
              annotatedOutlineLines.push(lm);
            }
          }
        }
      } else {
        baseOutlineLines.push(sym.signature);
        annotatedOutlineLines.push(`${sym.signature}${symRangeSuffix}`);
      }
    } else if (sym.kind === "enum") {
      if (sym.children && sym.children.length > 0) {
        baseOutlineLines.push(`enum ${sym.name}:`);
        annotatedOutlineLines.push(`enum ${sym.name}:${symRangeSuffix}`);
        for (const child of sym.children) {
          const childSuffix = child.lineRange ? ` # ${child.lineRange}` : "";
          baseOutlineLines.push(`  ${child.signature}`);
          annotatedOutlineLines.push(`  ${child.signature}${childSuffix}`);
        }
      } else {
        baseOutlineLines.push(sym.signature);
        annotatedOutlineLines.push(`${sym.signature}${symRangeSuffix}`);
      }
    } else if (sym.kind === "interface" || sym.kind === "record") {
      if (sym.children && sym.children.length > 0) {
        const header = sym.signature.endsWith(": ...") ? sym.signature.slice(0, -4) : sym.signature;
        baseOutlineLines.push(header);
        annotatedOutlineLines.push(`${header}${symRangeSuffix}`);
        for (const child of sym.children) {
          const childSuffix = child.lineRange ? ` # ${child.lineRange}` : "";
          if (child.docstring) {
            for (const dLine of child.docstring.split("\n")) {
              baseOutlineLines.push(`  ${dLine}`);
              annotatedOutlineLines.push(`  ${dLine}`);
            }
          }
          baseOutlineLines.push(`  ${child.signature}`);
          annotatedOutlineLines.push(`  ${child.signature}${childSuffix}`);
        }
      } else {
        baseOutlineLines.push(sym.signature);
        annotatedOutlineLines.push(`${sym.signature}${symRangeSuffix}`);
      }
    } else if (
      sym.kind === "test" ||
      sym.kind === "describe" ||
      sym.kind === "section" ||
      sym.kind === "label"
    ) {
      baseOutlineLines.push(
        options.lineRanges === false ? sym.signature : `${sym.signature}${symRangeSuffix}`,
      );
      annotatedOutlineLines.push(`${sym.signature}${symRangeSuffix}`);
    } else {
      baseOutlineLines.push(sym.signature);
      annotatedOutlineLines.push(`${sym.signature}${symRangeSuffix}`);
      if (shouldExtractInternalLandmarks(sym, originalSource, maxDepth)) {
        const fnLandmarks = extractInternalLandmarks(sym, originalSource, filePath, "  ");
        for (const lm of fnLandmarks) {
          annotatedOutlineLines.push(lm);
        }
      }
    }
  }

  if (originalSource) {
    const importLandmark = detectTopOfFileImports(originalSource, symbols);
    if (importLandmark) {
      const landmarkAnnotated = `imports (${importLandmark.spanLines} lines) # [L${importLandmark.startLine}-L${importLandmark.endLine}]`;
      const landmarkBase = `imports (${importLandmark.spanLines} lines)`;

      let insertIdx = 0;
      if (annotatedOutlineLines.length > 0 && annotatedOutlineLines[0].startsWith("module ")) {
        insertIdx = 1;
        if (annotatedOutlineLines.length > 1 && annotatedOutlineLines[1] === "") {
          insertIdx = 1;
        }
      }
      annotatedOutlineLines.splice(insertIdx, 0, landmarkAnnotated);
      baseOutlineLines.splice(insertIdx, 0, landmarkBase);
    }
  }

  ensureIdiomsResolved(filePath);

  const referencedSet = new Set<string>();
  if (idiomsActive && idiomsConfig && Object.keys(idiomsConfig).length > 0) {
    if (originalSource) {
      for (const idiomName of Object.keys(idiomsConfig)) {
        const cleanName = idiomName.startsWith("$") ? idiomName.slice(1) : idiomName;
        if (originalSource.includes(`$${cleanName}`)) {
          referencedSet.add(`$${cleanName}`);
        }
      }
    }
    try {
      collapseModuleIdioms(ast, idiomsConfig, (idiomName) => {
        const cleanName = idiomName.startsWith("$") ? idiomName.slice(1) : idiomName;
        referencedSet.add(`$${cleanName}`);
      });
    } catch {
      // ignore
    }
  }

  const referencedIdioms = Array.from(referencedSet);
  if (referencedIdioms.length > 0) {
    const idiomHeader = `// idioms: ${referencedIdioms.join(", ")}`;
    baseOutlineLines.unshift(idiomHeader);
    annotatedOutlineLines.unshift(idiomHeader);
  }

  if (baseOutlineLines.length === 0 && originalSource) {
    const isPassthroughOutline =
      filePath !== "<anonymous>" && !filePath.endsWith(".aice")
        ? detectTargetFromPathOrContent(filePath, originalSource) === "passthrough"
        : false;
    if (isPassthroughOutline) {
      const rawLines = originalSource.split(/\r?\n/);
      const previewCount = Math.min(rawLines.length, 20);
      const previewLines = rawLines.slice(0, previewCount);
      if (rawLines.length > previewCount) {
        previewLines.push(`// ... (+${rawLines.length - previewCount}L)`);
      }
      const previewText = previewLines.join("\n");
      baseOutlineLines.push(previewText);
      annotatedOutlineLines.push(previewText);
    }
  }

  const baseOutlineText = baseOutlineLines.join("\n");
  const outlineText = (includeLineRanges ? annotatedOutlineLines : baseOutlineLines).join("\n");

  // Tokenomics Statistics (measured against base semantic skeleton)
  const origForTokens = originalSource || baseOutlineText;
  const originalTokens = options.skipTokenStats
    ? Math.ceil(origForTokens.length / 4)
    : estimateTokens(origForTokens);
  const outlineTokens = options.skipTokenStats
    ? Math.ceil(baseOutlineText.length / 4)
    : estimateTokens(baseOutlineText);
  const savingsTokens = Math.max(0, originalTokens - outlineTokens);
  const savingsPct =
    originalTokens > 0 ? Number(((savingsTokens / originalTokens) * 100).toFixed(1)) : 0;
  const originalChars = origForTokens.length;
  const outlineChars = baseOutlineText.length;
  const charSavingsPct =
    originalChars > 0
      ? Number((((originalChars - outlineChars) / originalChars) * 100).toFixed(1))
      : 0;

  const stats: OutlineStats = {
    originalTokens,
    outlineTokens,
    savingsTokens,
    savingsPct,
    originalChars,
    outlineChars,
    charSavingsPct,
  };

  const jsonPayload = {
    file: filePath,
    ...(referencedIdioms.length > 0 ? { referencedIdioms } : {}),
    symbols,
    ...(options.stats ? { stats } : {}),
  };

  return {
    file: filePath,
    text: isJson ? JSON.stringify(jsonPayload, null, 2) : outlineText,
    symbols,
    referencedIdioms,
    json: jsonPayload,
    stats,
  };
}

function escapeRegexForOutline(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface ImportLandmark {
  startLine: number;
  endLine: number;
  spanLines: number;
}

function detectTopOfFileImports(
  source: string,
  symbols: OutlineSymbol[],
): ImportLandmark | undefined {
  if (!source) return undefined;
  const lines = source.split(/\r?\n/);
  let importStartLine = -1;
  let importEndLine = -1;
  let inMultiLineImport = false;
  let braceDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    // Skip empty lines, pure comments, or top-level module/package headers before imports
    if (!inMultiLineImport && importStartLine === -1) {
      if (
        !trimmed ||
        trimmed.startsWith("//") ||
        trimmed.startsWith("#") ||
        trimmed.startsWith("/*") ||
        trimmed.startsWith("*")
      ) {
        continue;
      }
      if (/^\s*(?:module|package)\b/.test(trimmed)) {
        continue;
      }
    }

    // Check if currently inside a multi-line import
    if (inMultiLineImport) {
      importEndLine = lineNum;
      for (const ch of trimmed) {
        if (ch === "{" || ch === "(") braceDepth++;
        else if (ch === "}" || ch === ")") braceDepth--;
      }
      if (braceDepth <= 0) {
        inMultiLineImport = false;
        braceDepth = 0;
      }
      continue;
    }

    // Check if this line starts an import statement
    const isImportLine =
      /^\s*import\b/.test(trimmed) ||
      /^\s*from\b\s+.*\bimport\b/.test(trimmed) ||
      /^\s*#\s*include\b/.test(trimmed) ||
      /^\s*use\b\s+[A-Za-z0-9_:]+/.test(trimmed) ||
      /^\s*(?:(?:const|let|var)\s+.*=\s*)?require\s*\(/.test(trimmed);

    if (isImportLine) {
      if (importStartLine === -1) {
        importStartLine = lineNum;
      }
      importEndLine = lineNum;

      let openBraces = 0;
      for (const ch of trimmed) {
        if (ch === "{" || ch === "(") openBraces++;
        else if (ch === "}" || ch === ")") openBraces--;
      }
      if (openBraces > 0) {
        inMultiLineImport = true;
        braceDepth = openBraces;
      }
    } else {
      if (importStartLine !== -1) {
        if (
          !trimmed ||
          trimmed.startsWith("//") ||
          trimmed.startsWith("#") ||
          trimmed.startsWith("/*") ||
          trimmed.startsWith("*")
        ) {
          // Lookahead: does another import follow within 5 lines?
          let hasSubsequentImport = false;
          for (let k = i + 1; k < Math.min(lines.length, i + 6); k++) {
            const nextTrim = lines[k].trim();
            if (
              !nextTrim ||
              nextTrim.startsWith("//") ||
              nextTrim.startsWith("#") ||
              nextTrim.startsWith("/*") ||
              nextTrim.startsWith("*")
            ) {
              continue;
            }
            if (
              /^\s*import\b/.test(nextTrim) ||
              /^\s*from\b\s+.*\bimport\b/.test(nextTrim) ||
              /^\s*#\s*include\b/.test(nextTrim) ||
              /^\s*use\b\s+[A-Za-z0-9_:]+/.test(nextTrim) ||
              /^\s*(?:(?:const|let|var)\s+.*=\s*)?require\s*\(/.test(nextTrim)
            ) {
              hasSubsequentImport = true;
            }
            break;
          }
          if (hasSubsequentImport) {
            continue;
          }
        }
        break;
      }
    }
  }

  if (importStartLine !== -1 && importEndLine >= importStartLine) {
    const spanLines = importEndLine - importStartLine + 1;
    if (spanLines >= 10) {
      const alreadyCovered = symbols.some(
        (s) =>
          s.line <= importStartLine &&
          (s.endLine ?? s.line) >= importEndLine &&
          (s.kind === "import" || s.name === "imports" || s.name === "import"),
      );
      if (!alreadyCovered) {
        return { startLine: importStartLine, endLine: importEndLine, spanLines };
      }
    }
  }
  return undefined;
}

function isFunctionOrMethodSymbol(sym: OutlineSymbol): boolean {
  if (
    sym.kind === "class" ||
    sym.kind === "struct" ||
    sym.kind === "enum" ||
    sym.kind === "interface" ||
    sym.kind === "record" ||
    sym.kind === "module" ||
    sym.kind === "import"
  ) {
    return false;
  }
  if (sym.kind === "function" || sym.kind === "method") {
    return true;
  }
  return /^(?:(?:pub|async|static|export|default)\s+)*(?:fn|def|func|function)\b/.test(
    sym.signature,
  );
}

function shouldExtractInternalLandmarks(
  sym: OutlineSymbol,
  originalSource: string,
  maxDepth: number,
): boolean {
  if (maxDepth === 0 || !originalSource) return false;
  if (!isFunctionOrMethodSymbol(sym)) return false;
  if (sym.line === undefined || sym.endLine === undefined) return false;
  const span = sym.endLine - sym.line + 1;
  return span > 120;
}

interface FunctionLandmarkItem {
  type: "setup" | "section" | "block" | "call";
  startLine: number;
  endLine: number;
  text: string;
  depth: number;
  span: number;
  priority: number;
}

function extractInternalLandmarks(
  sym: OutlineSymbol,
  originalSource: string,
  filePath: string,
  indentPrefix = "  ",
): string[] {
  if (!originalSource || sym.line === undefined || sym.endLine === undefined) {
    return [];
  }
  const rawLines = originalSource.split(/\r?\n/);
  const startLine = sym.line;
  const endLine = sym.endLine;
  if (endLine <= startLine) return [];

  const fnLines = rawLines.slice(startLine - 1, endLine);
  if (fnLines.length <= 1) return [];

  const isIndentBased =
    /\.(?:aipl|py|pyi|yaml|yml)$/i.test(filePath) ||
    (!filePath.includes(".") && originalSource.includes("fn main():"));

  const landmarks: FunctionLandmarkItem[] = [];

  // 1. Initial Local Setup Cluster (within first ~40 lines, before main loop/branch/section)
  let setupStartLine = -1;
  let setupEndLine = -1;
  const setupVarNames: string[] = [];
  let consecutiveNonVar = 0;

  for (let k = 1; k < Math.min(fnLines.length, 40); k++) {
    const diskLine = startLine + k;
    const trimmed = fnLines[k].trim();
    if (!trimmed) continue;

    if (trimmed.startsWith("//") || trimmed.startsWith("#") || trimmed.startsWith("/*")) {
      if (
        /^(\/\/|#|\/\*)\s*[-=_~*#]{2,}/.test(trimmed) ||
        /^(\/\/|#)\s*(?:---|===)/.test(trimmed)
      ) {
        break;
      }
      continue;
    }
    if (/^(?:while|for|loop|switch|match|if)\b/.test(trimmed)) {
      break;
    }

    const varMatch =
      trimmed.match(/^(?:let|mut|val|var|const)\s+(?:mut\s+)?([A-Za-z0-9_$]+)/) ||
      trimmed.match(/^([A-Za-z0-9_$]+)\s*:=/) ||
      trimmed.match(
        /^(?:int|float|double|bool|auto|char|size_t|uint\w*|int\w*)\s+([A-Za-z0-9_$]+)\s*=/,
      ) ||
      (isIndentBased && trimmed.match(/^([A-Za-z0-9_]+)\s*=[^=]/));

    if (varMatch) {
      const vName = varMatch[1];
      if (!setupVarNames.includes(vName)) {
        setupVarNames.push(vName);
      }
      if (setupStartLine === -1) setupStartLine = diskLine;
      setupEndLine = diskLine;
      consecutiveNonVar = 0;
    } else {
      consecutiveNonVar++;
      if (consecutiveNonVar > 2) break;
    }
  }

  if (setupVarNames.length >= 2 && setupEndLine >= setupStartLine) {
    const varListStr = setupVarNames.slice(0, 5).join(", ");
    const dots = setupVarNames.length > 5 ? ", ..." : "";
    landmarks.push({
      type: "setup",
      startLine: setupStartLine,
      endLine: setupEndLine,
      text: `setup: ${varListStr}${dots}`,
      depth: 1,
      span: setupEndLine - setupStartLine + 1,
      priority: 3,
    });
  }

  // 2. Section Banner Comments
  for (let k = 1; k < fnLines.length; k++) {
    const diskLine = startLine + k;
    const trimmed = fnLines[k].trim();
    if (!trimmed.startsWith("//") && !trimmed.startsWith("#") && !trimmed.startsWith("/*")) {
      continue;
    }

    const isPureDivider = /^(\/\/|#|\/\*)\s*[-=_~*#]{3,}\s*(\*\/)?$/.test(trimmed);
    if (isPureDivider) {
      if (k + 1 < fnLines.length) {
        const nextTrim = fnLines[k + 1].trim();
        if (
          (nextTrim.startsWith("//") || nextTrim.startsWith("#") || nextTrim.startsWith("/*")) &&
          /[a-zA-Z0-9]/.test(nextTrim)
        ) {
          const cleanTitle = nextTrim.replace(/^(\/\/|#|\/\*)\s*|\s*\*\/$/g, "").trim();
          landmarks.push({
            type: "section",
            startLine: startLine + k + 1,
            endLine: startLine + k + 1,
            text:
              cleanTitle.startsWith("//") || cleanTitle.startsWith("#")
                ? cleanTitle
                : `// ${cleanTitle}`,
            depth: 1,
            span: 1,
            priority: 1,
          });
          k++;
          continue;
        }
      }
      continue;
    }

    const bannerMatch = trimmed.match(
      /^(\/\/|#|\/\*)\s*([-=_~*]{2,})\s*([a-zA-Z0-9].*?)\s*\2?\s*(\*\/)?$/,
    );
    if (bannerMatch && /[a-zA-Z0-9]/.test(bannerMatch[3])) {
      landmarks.push({
        type: "section",
        startLine: diskLine,
        endLine: diskLine,
        text: trimmed.replace(/\s*\*\/$/, ""),
        depth: 1,
        span: 1,
        priority: 1,
      });
      continue;
    }

    const bannerMatch2 = trimmed.match(/^(\/\/|#)\s*([-=_~*]{2,})\s*([a-zA-Z0-9].*)$/);
    if (bannerMatch2) {
      landmarks.push({
        type: "section",
        startLine: diskLine,
        endLine: diskLine,
        text: trimmed,
        depth: 1,
        span: 1,
        priority: 1,
      });
    }
  }

  // 3. Major Control-Flow & Stage Blocks (spanning >= 8 lines)
  const openBraceLineToCloseLine = new Map<number, number>();
  const caseEndLineMap = new Map<number, number>();

  if (!isIndentBased) {
    const braceStack: Array<{ openLine: number; caseLines: number[] }> = [];
    let inBlockComment = false;
    let inTemplateString = false;

    for (let i = 0; i < fnLines.length; i++) {
      const curLine = fnLines[i];
      const diskLine = startLine + i;
      let inStr: string | null = null;
      let escaped = false;
      let hasRecordedCase = false;
      const trimmed = curLine.trim();
      const isCaseOrDefault = /^(?:case\b|default\s*:)/.test(trimmed);

      for (let c = 0; c < curLine.length; c++) {
        const ch = curLine[c];
        const nextCh = c + 1 < curLine.length ? curLine[c + 1] : "";

        if (inBlockComment) {
          if (ch === "*" && nextCh === "/") {
            inBlockComment = false;
            c++;
          }
          continue;
        }

        if (inTemplateString) {
          if (escaped) {
            escaped = false;
            continue;
          }
          if (ch === "\\") {
            escaped = true;
            continue;
          }
          if (ch === "`") {
            inTemplateString = false;
          }
          continue;
        }

        if (inStr) {
          if (escaped) {
            escaped = false;
            continue;
          }
          if (ch === "\\") {
            escaped = true;
            continue;
          }
          if (ch === inStr) {
            inStr = null;
          }
          continue;
        }

        if (ch === "/" && nextCh === "*") {
          inBlockComment = true;
          c++;
          continue;
        }
        if (ch === "/" && nextCh === "/") {
          break;
        }

        if (ch === '"' || ch === "'") {
          inStr = ch;
          continue;
        }
        if (ch === "`") {
          inTemplateString = true;
          continue;
        }

        if (isCaseOrDefault && !hasRecordedCase && braceStack.length > 0) {
          braceStack[braceStack.length - 1].caseLines.push(diskLine);
          hasRecordedCase = true;
        }

        if (ch === "{") {
          braceStack.push({ openLine: diskLine, caseLines: [] });
        } else if (ch === "}") {
          if (braceStack.length > 0) {
            const top = braceStack.pop()!;
            openBraceLineToCloseLine.set(top.openLine, diskLine);
            for (let idx = 0; idx < top.caseLines.length; idx++) {
              const cLine = top.caseLines[idx];
              const nextCaseLine =
                idx + 1 < top.caseLines.length ? top.caseLines[idx + 1] : undefined;
              const caseEnd =
                nextCaseLine !== undefined ? nextCaseLine - 1 : Math.max(cLine, diskLine - 1);
              caseEndLineMap.set(cLine, caseEnd);
            }
          }
        }
      }
    }
  }

  for (let k = 1; k < fnLines.length; k++) {
    const diskLine = startLine + k;
    const line = fnLines[k];
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("#") || trimmed.startsWith("/*")) {
      continue;
    }

    const ctrlMatch = trimmed.match(
      /^(while|for|loop|switch|match|if|elif|else\s+if|case|default)\b/,
    );
    if (!ctrlMatch) continue;

    let blockEndLine = diskLine;
    if (isIndentBased) {
      const baseIndent = line.match(/^[ \t]*/)?.[0].length ?? 0;
      let lastIdx = k;
      for (let j = k + 1; j < fnLines.length; j++) {
        const nextTrim = fnLines[j].trim();
        if (!nextTrim || nextTrim.startsWith("//") || nextTrim.startsWith("#")) {
          continue;
        }
        const nextIndent = fnLines[j].match(/^[ \t]*/)?.[0].length ?? 0;
        if (nextIndent <= baseIndent) break;
        lastIdx = j;
      }
      blockEndLine = startLine + lastIdx;
    } else {
      const isCaseArm = ctrlMatch[1] === "case" || ctrlMatch[1] === "default";
      if (isCaseArm) {
        const lineKHasBrace = openBraceLineToCloseLine.has(diskLine);
        const nextKLine = k + 1 < fnLines.length ? startLine + k + 1 : undefined;
        const lineKPlus1HasBrace =
          nextKLine !== undefined &&
          fnLines[k + 1].trim().startsWith("{") &&
          openBraceLineToCloseLine.has(nextKLine);

        if (lineKHasBrace) {
          blockEndLine = openBraceLineToCloseLine.get(diskLine)!;
        } else if (lineKPlus1HasBrace && nextKLine !== undefined) {
          blockEndLine = openBraceLineToCloseLine.get(nextKLine)!;
        } else {
          blockEndLine = caseEndLineMap.get(diskLine) ?? diskLine;
        }
      } else {
        let parenDepth = 0;
        let foundBrace = false;
        let terminatedBySemicolon = false;
        const maxHeaderLines = Math.min(fnLines.length, k + 8);

        for (let h = k; h < maxHeaderLines; h++) {
          const hLine = startLine + h;
          const curLine = fnLines[h];
          let inStr: string | null = null;
          let escaped = false;

          for (let c = 0; c < curLine.length; c++) {
            const ch = curLine[c];
            if (escaped) {
              escaped = false;
              continue;
            }
            if (ch === "\\") {
              escaped = true;
              continue;
            }
            if (inStr) {
              if (ch === inStr) inStr = null;
              continue;
            }
            if (ch === '"' || ch === "'" || ch === "`") {
              inStr = ch;
              continue;
            }
            if (ch === "/" && curLine[c + 1] === "/") break;

            if (ch === "(") {
              parenDepth++;
            } else if (ch === ")") {
              if (parenDepth > 0) parenDepth--;
            } else if (ch === "{") {
              foundBrace = true;
              blockEndLine = openBraceLineToCloseLine.get(hLine) ?? diskLine;
              break;
            } else if (ch === ";" && parenDepth <= 0 && !foundBrace) {
              terminatedBySemicolon = true;
              break;
            }
          }

          if (terminatedBySemicolon || foundBrace) {
            break;
          }
        }

        if (terminatedBySemicolon) {
          blockEndLine = diskLine;
        } else if (!foundBrace) {
          blockEndLine = diskLine;
        }
      }
    }

    const span = blockEndLine - diskLine + 1;
    if (span >= 8) {
      let cleanSig = trimmed
        .replace(/\s*\{?\s*$/, "")
        .replace(/\s*:?\s*$/, "")
        .replace(/\s*;\s*$/, "")
        .trim();
      if (cleanSig.length > 50) {
        cleanSig = `${cleanSig.slice(0, 47)}...`;
      }
      landmarks.push({
        type: "block",
        startLine: diskLine,
        endLine: blockEndLine,
        text: cleanSig,
        depth: 1,
        span,
        priority: span > 30 ? 2 : 4,
      });
    }
  }

  // Deduplicate landmarks that share the same startLine
  const uniqueLandmarks: FunctionLandmarkItem[] = [];
  const seenStartLines = new Set<number>();
  landmarks.sort((a, b) => a.startLine - b.startLine);
  for (const lm of landmarks) {
    if (!seenStartLines.has(lm.startLine)) {
      uniqueLandmarks.push(lm);
      seenStartLines.add(lm.startLine);
    }
  }

  // Assign nesting depth (depth 2 if strictly inside an outer block)
  const blockLandmarks = uniqueLandmarks.filter((l) => l.type === "block");
  for (const lm of uniqueLandmarks) {
    const parentBlock = blockLandmarks.find(
      (b) => b !== lm && b.startLine < lm.startLine && lm.endLine <= b.endLine,
    );
    if (parentBlock) {
      lm.depth = 2;
    }
  }

  // 4. Major Subsystem Call Clusters (> 60 lines gap without section or block)
  const sortedStarts = [...uniqueLandmarks].sort((a, b) => a.startLine - b.startLine);
  let prevCoveredEnd = startLine;
  for (let s = 0; s <= sortedStarts.length; s++) {
    const gapStart = prevCoveredEnd + 1;
    const gapEnd = s < sortedStarts.length ? sortedStarts[s].startLine - 1 : endLine;
    if (gapEnd - gapStart + 1 > 60) {
      const calls: string[] = [];
      let firstCallLine = -1;
      let lastCallLine = -1;
      for (let j = gapStart - startLine; j <= gapEnd - startLine && j < fnLines.length; j++) {
        const diskL = startLine + j;
        const line = fnLines[j];
        const callMatches = Array.from(line.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g));
        for (const cm of callMatches) {
          const fnName = cm[1];
          if (
            !/^(?:if|while|for|switch|match|return|catch|require|expect|console|typeof|sizeof|assert|print|push|pop|shift|slice|map|filter)$/.test(
              fnName,
            ) &&
            !calls.includes(fnName)
          ) {
            calls.push(fnName);
            if (firstCallLine === -1) firstCallLine = diskL;
            lastCallLine = diskL;
            if (calls.length >= 2) break;
          }
        }
        if (calls.length >= 2) break;
      }
      if (calls.length > 0 && firstCallLine !== -1 && lastCallLine !== -1) {
        uniqueLandmarks.push({
          type: "call",
          startLine: firstCallLine,
          endLine: Math.max(firstCallLine, lastCallLine),
          text: calls.join(" / "),
          depth: 1,
          span: lastCallLine - firstCallLine + 1,
          priority: 5,
        });
      }
    }
    if (s < sortedStarts.length) {
      prevCoveredEnd = Math.max(prevCoveredEnd, sortedStarts[s].endLine);
    }
  }

  // 5. Cap to <= 25 lines
  let finalLandmarks = uniqueLandmarks;
  if (finalLandmarks.length > 25) {
    finalLandmarks.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return b.span - a.span;
    });
    finalLandmarks = finalLandmarks.slice(0, 25);
  }
  finalLandmarks.sort((a, b) => a.startLine - b.startLine);

  // Tree formatting
  const resultLines: string[] = [];
  for (let idx = 0; idx < finalLandmarks.length; idx++) {
    const lm = finalLandmarks[idx];
    const isDepth1 = lm.depth === 1;
    const lineSuffix =
      lm.startLine === lm.endLine ? `# [L${lm.startLine}]` : `# [L${lm.startLine}-L${lm.endLine}]`;

    if (isDepth1) {
      const hasNextDepth1 = finalLandmarks.slice(idx + 1).some((m) => m.depth === 1);
      const marker = hasNextDepth1 ? "├─" : "└─";
      resultLines.push(`${indentPrefix}${marker} ${lm.text} ${lineSuffix}`);
    } else {
      const hasNextChild = idx + 1 < finalLandmarks.length && finalLandmarks[idx + 1]!.depth === 2;
      const marker = hasNextChild ? "├─" : "└─";
      resultLines.push(`${indentPrefix}  ${marker} ${lm.text} ${lineSuffix}`);
    }
  }

  return resultLines;
}

function enrichAndResolveSymbolLineRanges(
  symbols: OutlineSymbol[],
  symbolAstEndLines: WeakMap<OutlineSymbol, number>,
  originalSource: string,
  filePath: string,
  maxDepth: number,
): void {
  if (maxDepth < 1) return;

  for (let i = symbols.length - 1; i >= 0; i--) {
    if ((symbols[i].kind === "var" || symbols[i].kind === "const") && symbols[i].name === "_") {
      symbols.splice(i, 1);
    }
  }

  for (let i = 0; i < symbols.length; i++) {
    const sym = symbols[i];
    const trackedEnd = symbolAstEndLines.get(sym);
    sym.endLine = trackedEnd !== undefined ? Math.max(sym.line, trackedEnd) : sym.line;
    if (sym.children) {
      for (const child of sym.children) {
        const childTrackedEnd = symbolAstEndLines.get(child);
        child.endLine =
          child.endLine ??
          (childTrackedEnd !== undefined ? Math.max(child.line, childTrackedEnd) : child.line);
      }
    }
  }

  const detectedTarget =
    filePath !== "<anonymous>" && !filePath.endsWith(".aice")
      ? detectTargetFromPathOrContent(filePath, originalSource)
      : undefined;
  const isPassthrough = detectedTarget === "passthrough";
  const targetLang: TargetLanguage | undefined =
    detectedTarget && detectedTarget !== "passthrough" ? detectedTarget : undefined;
  const isNativeFile = Boolean(targetLang);
  const rawLines = originalSource !== "" ? originalSource.split(/\r?\n/) : [];
  const totalLines = Math.max(1, rawLines.length);

  const isTsLike =
    targetLang === "typescript" || targetLang === "javascript" || targetLang === "tsx";
  const tsIndex: TsFileSymbolIndex | undefined =
    isTsLike && originalSource !== ""
      ? getCachedTsSymbolIndex(originalSource, filePath)
      : undefined;

  let cssRoot: postcss.Root | undefined;
  if (targetLang === "css" && originalSource !== "") {
    try {
      cssRoot = postcss.parse(originalSource);
    } catch {
      // ignore CSS parse errors
    }
  }

  if (isNativeFile && originalSource !== "" && targetLang) {
    supplementNativeSymbolsFromSource(
      symbols,
      originalSource,
      targetLang,
      totalLines,
      tsIndex,
      cssRoot,
    );
  } else if (isPassthrough && originalSource !== "") {
    const extracted = extractPassthroughStructuralSymbols(originalSource, filePath, maxDepth);
    for (const sym of extracted) {
      symbols.push(sym);
    }
  } else if (
    !isNativeFile &&
    originalSource !== "" &&
    /\b(?:describe|test|it)\s*(?:\.[A-Za-z0-9_]+)*\s*\(/.test(originalSource)
  ) {
    supplementNativeSymbolsFromSource(
      symbols,
      originalSource,
      "typescript",
      totalLines,
      getCachedTsSymbolIndex(originalSource, "inline.test.ts"),
    );
  }

  for (let i = 0; i < symbols.length; i++) {
    const sym = symbols[i];
    if (isNativeFile && originalSource !== "" && targetLang) {
      const resolved = resolveSingleSymbolSpanInNative(
        sym,
        originalSource,
        rawLines,
        targetLang,
        filePath,
        tsIndex,
        cssRoot,
      );
      if (resolved) {
        sym.line = resolved.startLine;
        sym.endLine = Math.max(resolved.startLine, resolved.endLine);
      }
    }
    sym.endLine = Math.min(totalLines, Math.max(sym.line, sym.endLine ?? sym.line));
    sym.lineRange = `[L${sym.line}-L${sym.endLine}]`;

    if (sym.children && sym.children.length > 0) {
      for (const child of sym.children) {
        if (isNativeFile && originalSource !== "" && targetLang) {
          const childResolved = resolveChildSymbolSpanInNative(
            sym,
            child,
            originalSource,
            rawLines,
            targetLang,
            filePath,
            tsIndex,
          );
          if (childResolved) {
            child.line = childResolved.startLine;
            child.endLine = Math.max(childResolved.startLine, childResolved.endLine);
          }
        }
        child.endLine = Math.min(totalLines, Math.max(child.line, child.endLine ?? child.line));
        child.lineRange = `[L${child.line}-L${child.endLine}]`;
      }
    }
  }

  if (symbols.length === 0 && isNativeFile && originalSource.trim().length > 0) {
    const ext = filePath !== "<anonymous>" ? path.extname(filePath).toLowerCase() : "";
    const baseName = path.basename(filePath, ext) || "module";
    symbols.push({
      name: baseName,
      kind: "module",
      line: 1,
      endLine: totalLines,
      lineRange: `[L1-L${totalLines}]`,
      signature: `module ${baseName}: ...`,
      children: [],
    });
  }
}

function extractAiplSymbols(source: string, _totalLines: number): OutlineSymbol[] {
  const stripComment = (raw: string): string => {
    let inQuote: string | null = null;
    for (let k = 0; k < raw.length; k++) {
      const ch = raw[k];
      if (inQuote) {
        if (ch === "\\" && k + 1 < raw.length) {
          k++;
          continue;
        }
        if (ch === inQuote) inQuote = null;
        continue;
      }
      if (ch === '"' || ch === "'") {
        inQuote = ch;
        continue;
      }
      if (ch === "/" && raw[k + 1] === "/") {
        return raw.slice(0, k);
      }
    }
    return raw;
  };

  const lines = source.split(/\r?\n/);
  const symbols: OutlineSymbol[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//")) {
      i++;
      continue;
    }

    const cleanLine = stripComment(line);

    const modMatch = cleanLine.match(/^(\s*)module\s+([A-Za-z_][A-Za-z0-9_]*)/);
    if (modMatch) {
      const name = modMatch[2];
      symbols.push({
        name,
        kind: "module",
        line: i + 1,
        endLine: i + 1,
        lineRange: `[L${i + 1}-L${i + 1}]`,
        signature: `module ${name}`,
        children: [],
      });
      i++;
      continue;
    }

    const structMatch = cleanLine.match(/^(\s*)(?:pub\s+)?struct\s+([A-Za-z_][A-Za-z0-9_]*)/);
    if (structMatch) {
      const indentLen = structMatch[1].length;
      const name = structMatch[2];
      let endLine = i + 1;
      const children: OutlineSymbol[] = [];
      const singleTupleMatch = cleanLine.match(
        /^(\s*)(?:pub\s+)?struct\s+([A-Za-z_][A-Za-z0-9_]*)\s*\((.*)\)\s*$/,
      );
      if (singleTupleMatch) {
        const rawFields = singleTupleMatch[3]
          .split(",")
          .map((f) => f.trim())
          .filter(Boolean);
        for (const rf of rawFields) {
          const fm = rf.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+)$/);
          if (fm) {
            children.push({
              name: fm[1],
              kind: "field",
              line: i + 1,
              endLine: i + 1,
              lineRange: `[L${i + 1}-L${i + 1}]`,
              signature: `val ${fm[1]}: ${fm[2].trim()}`,
              children: [],
            });
          }
        }
        symbols.push({
          name,
          kind: "class",
          line: i + 1,
          endLine: i + 1,
          lineRange: `[L${i + 1}-L${i + 1}]`,
          signature: `struct ${name}: ...`,
          children,
        });
        i++;
        continue;
      }

      let j = i + 1;
      while (j < lines.length) {
        const subTrimmed = lines[j].trim();
        if (!subTrimmed || subTrimmed.startsWith("//")) {
          j++;
          continue;
        }
        const subIndent = lines[j].match(/^[ \t]*/)?.[0].length ?? 0;
        if (subIndent <= indentLen) {
          if (
            subIndent === indentLen &&
            (subTrimmed.startsWith(")") || subTrimmed.startsWith("}"))
          ) {
            endLine = j + 1;
            j++;
          }
          break;
        }
        endLine = j + 1;
        const cleanSubLine = stripComment(lines[j]);
        const fieldMatches = Array.from(
          cleanSubLine.matchAll(
            /(?:^|[,(\s{])(?:pub\s+|val\s+|var\s+|let\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([^,)\n}]+)/g,
          ),
        );
        for (const fm of fieldMatches) {
          const cleanFieldType = fm[2]
            .trim()
            .replace(/[)}]\s*$/, "")
            .replace(/,\s*$/, "")
            .trim();
          if (cleanFieldType) {
            children.push({
              name: fm[1],
              kind: "field",
              line: j + 1,
              endLine: j + 1,
              lineRange: `[L${j + 1}-L${j + 1}]`,
              signature: `val ${fm[1]}: ${cleanFieldType}`,
              children: [],
            });
          }
        }
        j++;
      }
      symbols.push({
        name,
        kind: "class",
        line: i + 1,
        endLine,
        lineRange: `[L${i + 1}-L${endLine}]`,
        signature: `struct ${name}: ...`,
        children,
      });
      i = endLine;
      continue;
    }

    const enumMatch = cleanLine.match(/^(\s*)(?:pub\s+)?enum\s+([A-Za-z_][A-Za-z0-9_]*)/);
    if (enumMatch) {
      const indentLen = enumMatch[1].length;
      const name = enumMatch[2];
      let endLine = i + 1;
      const children: OutlineSymbol[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const subTrimmed = lines[j].trim();
        if (!subTrimmed || subTrimmed.startsWith("//")) {
          j++;
          continue;
        }
        const subIndent = lines[j].match(/^[ \t]*/)?.[0].length ?? 0;
        if (subIndent <= indentLen) {
          break;
        }
        endLine = j + 1;
        const variantMatch = stripComment(subTrimmed)
          .trim()
          .match(/^([A-Za-z_][A-Za-z0-9_]*)/);
        if (variantMatch) {
          children.push({
            name: variantMatch[1],
            kind: "variant",
            line: j + 1,
            endLine: j + 1,
            lineRange: `[L${j + 1}-L${j + 1}]`,
            signature: variantMatch[1],
            children: [],
          });
        }
        j++;
      }
      symbols.push({
        name,
        kind: "enum",
        line: i + 1,
        endLine,
        lineRange: `[L${i + 1}-L${endLine}]`,
        signature: `enum ${name}: ...`,
        children,
      });
      i = endLine;
      continue;
    }

    const fnOpenMatch = cleanLine.match(/^(\s*)(?:pub\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
    if (fnOpenMatch) {
      const indentLen = fnOpenMatch[1].length;
      const name = fnOpenMatch[2];
      let headerEndIdx = i;
      let openParens = 0;
      const headerPieces: string[] = [];
      while (headerEndIdx < lines.length) {
        const hLine = stripComment(lines[headerEndIdx]).trim();
        if (hLine) headerPieces.push(hLine);
        let inQuote: string | null = null;
        for (let c = 0; c < hLine.length; c++) {
          const ch = hLine[c];
          if (inQuote) {
            if (ch === "\\" && c + 1 < hLine.length) {
              c++;
              continue;
            }
            if (ch === inQuote) inQuote = null;
            continue;
          }
          if (ch === '"' || ch === "'") {
            inQuote = ch;
            continue;
          }
          if (ch === "(") openParens++;
          else if (ch === ")") openParens = Math.max(0, openParens - 1);
        }
        if (openParens === 0) break;
        headerEndIdx++;
      }
      const joinedHeader = headerPieces.join(" ");
      const openParenPos = joinedHeader.indexOf("(");
      let closeParenPos = -1;
      if (openParenPos >= 0) {
        let depth = 0;
        let inQuote: string | null = null;
        for (let c = openParenPos; c < joinedHeader.length; c++) {
          const ch = joinedHeader[c];
          if (inQuote) {
            if (ch === "\\" && c + 1 < joinedHeader.length) {
              c++;
              continue;
            }
            if (ch === inQuote) inQuote = null;
            continue;
          }
          if (ch === '"' || ch === "'") {
            inQuote = ch;
            continue;
          }
          if (ch === "(") depth++;
          else if (ch === ")") {
            depth--;
            if (depth === 0) {
              closeParenPos = c;
              break;
            }
          }
        }
      }
      const rawParams =
        openParenPos >= 0 && closeParenPos > openParenPos
          ? joinedHeader.slice(openParenPos + 1, closeParenPos)
          : "";
      const params = rawParams
        .replace(/\s+/g, " ")
        .replace(/\s*,\s*/g, ", ")
        .trim();
      const afterParens = closeParenPos >= 0 ? joinedHeader.slice(closeParenPos + 1).trim() : "";
      const retMatch = afterParens.match(/^(?::|->)\s*([A-Za-z0-9_<>?.*[\]\s]+?)\s*:?\s*$/);
      const rawRet = retMatch?.[1]?.trim().replace(/:$/, "").trim();
      const retType = rawRet || "void";
      let endLine = Math.min(lines.length, headerEndIdx + 1);
      let j = headerEndIdx + 1;
      while (j < lines.length) {
        const subTrimmed = lines[j].trim();
        if (!subTrimmed || subTrimmed.startsWith("//")) {
          j++;
          continue;
        }
        const subIndent = lines[j].match(/^[ \t]*/)?.[0].length ?? 0;
        if (subIndent <= indentLen) {
          break;
        }
        endLine = j + 1;
        j++;
      }
      symbols.push({
        name,
        kind: "function",
        line: i + 1,
        endLine,
        lineRange: `[L${i + 1}-L${endLine}]`,
        signature: `fn ${name}(${params}): ${retType}`,
        children: [],
      });
      i = endLine;
      continue;
    }

    const typeMatch = cleanLine.match(/^(\s*)(?:pub\s+)?type\s+([A-Za-z_][A-Za-z0-9_]*)/);
    if (typeMatch) {
      const indentLen = typeMatch[1].length;
      const name = typeMatch[2];
      let endLine = i + 1;
      let j = i + 1;
      while (j < lines.length) {
        const subTrimmed = lines[j].trim();
        if (!subTrimmed || subTrimmed.startsWith("//")) {
          j++;
          continue;
        }
        const subIndent = lines[j].match(/^[ \t]*/)?.[0].length ?? 0;
        if (subIndent <= indentLen) {
          break;
        }
        endLine = j + 1;
        j++;
      }
      symbols.push({
        name,
        kind: "type",
        line: i + 1,
        endLine,
        lineRange: `[L${i + 1}-L${endLine}]`,
        signature: `type ${name}: ...`,
        children: [],
      });
      i = endLine;
      continue;
    }

    i++;
  }

  return symbols;
}

function supplementNativeSymbolsFromSource(
  symbols: OutlineSymbol[],
  source: string,
  targetLang: TargetLanguage,
  totalLines: number,
  tsIndex?: TsFileSymbolIndex,
  preParsedCssRoot?: postcss.Root,
): void {
  const existingNames = new Set<string>();
  for (const s of symbols) {
    existingNames.add(s.name);
    existingNames.add(`${s.kind}:${s.name}:${s.line}`);
    if (s.children) {
      for (const c of s.children) {
        existingNames.add(c.name);
        existingNames.add(`${s.name}.${c.name}`);
        existingNames.add(`${c.kind}:${c.name}:${c.line}`);
      }
    }
  }

  if (targetLang === "aipl") {
    const aiplSyms = extractAiplSymbols(source, totalLines);
    for (const s of aiplSyms) {
      const key = `${s.kind}:${s.name}:${s.line}`;
      if (!existingNames.has(key)) {
        symbols.push(s);
        existingNames.add(key);
        existingNames.add(s.name);
        if (s.children) {
          for (const c of s.children) {
            existingNames.add(c.name);
            existingNames.add(`${s.name}.${c.name}`);
          }
        }
      }
    }
    return;
  }
  if (
    targetLang === "shell" ||
    targetLang === "powershell" ||
    targetLang === "batch" ||
    targetLang === "markdown"
  ) {
    const scriptSyms = extractScriptOrMarkdownSymbols(source, targetLang);
    for (const s of scriptSyms) {
      const key = `${s.kind}:${s.name}:${s.startLine}`;
      if (!existingNames.has(key)) {
        symbols.push({
          name: s.name,
          kind: s.kind,
          line: s.startLine,
          endLine: s.endLine,
          lineRange: `[L${s.startLine}-L${s.endLine}]`,
          signature: s.displaySignature,
          children: [],
        });
        existingNames.add(key);
      }
    }
    return;
  }

  if (targetLang === "css") {
    try {
      const root = preParsedCssRoot ?? postcss.parse(source);
      root.each((node) => {
        if (node.type === "rule") {
          const sel = node.selector.replace(/\s+/g, " ").trim();
          const sanitized = sel.replace(/^[.#]/, "").replace(/[^A-Za-z0-9_]/g, "_");
          if (!existingNames.has(sel) && !existingNames.has(sanitized)) {
            const sLine = node.source?.start?.line ?? 1;
            const eLine = node.source?.end?.line ?? sLine;
            symbols.push({
              name: sel,
              kind: "style",
              line: sLine,
              endLine: eLine,
              lineRange: `[L${sLine}-L${eLine}]`,
              signature: `style ${sel}: ...`,
              children: [],
            });
            existingNames.add(sel);
          }
        } else if (node.type === "atrule") {
          const atName = `@${node.name}${node.params ? ` ${node.params.replace(/\s+/g, " ").trim()}` : ""}`;
          if (!existingNames.has(atName)) {
            const sLine = node.source?.start?.line ?? 1;
            const eLine = node.source?.end?.line ?? sLine;
            symbols.push({
              name: atName,
              kind: "style",
              line: sLine,
              endLine: eLine,
              lineRange: `[L${sLine}-L${eLine}]`,
              signature: `style ${atName}: ...`,
              children: [],
            });
            existingNames.add(atName);
          }
        }
      });
    } catch {
      // ignore CSS parse errors
    }
    return;
  }

  if (targetLang === "twig") {
    const lines = source.split(/\r?\n/);
    const blockStack: Array<{ name: string; startLine: number }> = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const extMatch = line.match(/\{%-?\s*extends\s+(['"][^'"]+['"])\s*-?%\}/);
      if (extMatch && !existingNames.has(extMatch[1])) {
        const lNum = i + 1;
        symbols.push({
          name: extMatch[1],
          kind: "import",
          line: lNum,
          endLine: lNum,
          lineRange: `[L${lNum}-L${lNum}]`,
          signature: `extends ${extMatch[1]}`,
          children: [],
        });
        existingNames.add(extMatch[1]);
      }
      const blkMatch = line.match(/\{%-?\s*block\s+([A-Za-z_][A-Za-z0-9_]*)\b/);
      if (blkMatch) {
        blockStack.push({ name: blkMatch[1], startLine: i + 1 });
      }
      if (/\{%-?\s*endblock\b/.test(line) && blockStack.length > 0) {
        const blk = blockStack.pop()!;
        if (!existingNames.has(blk.name) && !existingNames.has(`block_${blk.name}`)) {
          const eLine = i + 1;
          symbols.push({
            name: blk.name,
            kind: "component",
            line: blk.startLine,
            endLine: eLine,
            lineRange: `[L${blk.startLine}-L${eLine}]`,
            signature: `block ${blk.name}: ...`,
            children: [],
          });
          existingNames.add(blk.name);
        }
      }
    }
    return;
  }

  if (targetLang === "typescript" || targetLang === "javascript" || targetLang === "tsx") {
    if (/\b(?:describe|test|it)\b/.test(source)) {
      if (tsIndex) {
        for (const tb of tsIndex.testBlocks) {
          const sig = `${tb.kind} "${tb.title.replace(/"/g, '\\"')}"`;
          const key = `${tb.kind}:${tb.title}:${tb.startLine}`;
          if (!existingNames.has(key)) {
            symbols.push({
              name: tb.title,
              kind: tb.kind,
              line: tb.startLine,
              endLine: tb.endLine,
              lineRange: `[L${tb.startLine}-L${tb.endLine}]`,
              signature: sig,
              children: [],
            });
            existingNames.add(key);
            existingNames.add(tb.title);
          }
        }
      } else {
        const testBlocks = extractNativeTestBlocks(source);
        for (const tb of testBlocks) {
          const sig = `${tb.outlineKind} "${tb.title.replace(/"/g, '\\"')}"`;
          const key = `${tb.outlineKind}:${tb.title}:${tb.startLine}`;
          if (!existingNames.has(key)) {
            symbols.push({
              name: tb.title,
              kind: tb.outlineKind,
              line: tb.startLine,
              endLine: tb.endLine,
              lineRange: `[L${tb.startLine}-L${tb.endLine}]`,
              signature: sig,
              children: [],
            });
            existingNames.add(key);
            existingNames.add(tb.title);
          }
        }
      }
    }
    return;
  }

  const maskedCode = maskSourceLexically(source, targetLang).maskedCode;
  const lines = maskedCode.split(/\r?\n/);
  const fnPrefix = "fn ";
  const allDeclPatterns: Array<{
    langs?: TargetLanguage[];
    re: RegExp;
    kind: string;
    sigPrefix: string;
  }> = [
    {
      langs: ["rust"],
      re: /^\s*(?:pub\s+)?macro_rules!\s+([A-Za-z_][A-Za-z0-9_]*)/,
      kind: "function",
      sigPrefix: fnPrefix,
    },
    {
      langs: ["rust"],
      re: /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)/,
      kind: "function",
      sigPrefix: fnPrefix,
    },
    {
      langs: ["rust"],
      re: /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:struct|trait|enum)\s+([A-Za-z_][A-Za-z0-9_]*)/,
      kind: "class",
      sigPrefix: "class ",
    },
    {
      langs: ["go"],
      re: /^\s*func\s+(?:\([^)]+\)\s*)?([A-Za-z_][A-Za-z0-9_]*)\s*\(/,
      kind: "function",
      sigPrefix: fnPrefix,
    },
    {
      langs: ["go"],
      re: /^\s*type\s+([A-Za-z_][A-Za-z0-9_]*)\s+(?:struct|interface)\b/,
      kind: "interface",
      sigPrefix: "type ",
    },
    {
      langs: ["kotlin"],
      re: /^\s*(?:public\s+|internal\s+|private\s+)?(?:sealed\s+interface|sealed\s+class|data\s+class|class|interface|object)\s+([A-Za-z_][A-Za-z0-9_]*)/,
      kind: "class",
      sigPrefix: "class ",
    },
    {
      langs: ["kotlin"],
      re: /^\s*(?:public\s+|internal\s+|private\s+|override\s+)*(?:suspend\s+|inline\s+)*fun\s+(?:<[^>]+>\s*)?(?:[A-Za-z_][A-Za-z0-9_<>?.*]*\.)?([A-Za-z_][A-Za-z0-9_]*)\s*\(/,
      kind: "function",
      sigPrefix: fnPrefix,
    },
    {
      langs: ["python"],
      re: /^\s*class\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(|:)/,
      kind: "class",
      sigPrefix: "class ",
    },
    {
      langs: ["python"],
      re: /^\s*(?:async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/,
      kind: "function",
      sigPrefix: fnPrefix,
    },
    {
      langs: ["cpp", "csharp", "php"],
      re: /^\s*(?:public|private|protected|internal|sealed|abstract|partial|static|\s)*\b(?:record|class|struct|interface|trait)\s+([A-Za-z_][A-Za-z0-9_]*)/,
      kind: "class",
      sigPrefix: "class ",
    },
    {
      langs: ["php"],
      re: /^\s*(?:public|protected|private|static|abstract|final|\s)*function\s+&?([A-Za-z_][A-Za-z0-9_]*)\s*\(/,
      kind: "function",
      sigPrefix: fnPrefix,
    },
  ];
  const declPatterns = allDeclPatterns.filter((p) => !p.langs || p.langs.includes(targetLang));

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    for (const pat of declPatterns) {
      const m = line.match(pat.re);
      if (m && m[1]) {
        const name = m[1];
        if (
          name === "if" ||
          name === "for" ||
          name === "while" ||
          name === "switch" ||
          name === "catch" ||
          name === "match" ||
          existingNames.has(name)
        ) {
          continue;
        }
        const span = locateNativeDeclarationSpan(source, name, targetLang);
        const sLine = span?.startLine ?? i + 1;
        const eLine = span?.endLine ?? Math.min(totalLines, sLine);
        symbols.push({
          name,
          kind: pat.kind,
          line: sLine,
          endLine: eLine,
          lineRange: `[L${sLine}-L${eLine}]`,
          signature:
            pat.kind === "function"
              ? `${pat.sigPrefix}${name}(...): ...`
              : `${pat.sigPrefix}${name}: ...`,
          children: [],
        });
        existingNames.add(name);
        break;
      }
    }
  }
}

function resolveSingleSymbolSpanInNative(
  sym: OutlineSymbol,
  originalSource: string,
  rawLines: string[],
  targetLang: TargetLanguage,
  _filePath: string,
  tsIndex?: TsFileSymbolIndex,
  preParsedCssRoot?: postcss.Root,
): { startLine: number; endLine: number } | undefined {
  if (
    (targetLang === "aipl" ||
      sym.kind === "test" ||
      sym.kind === "describe" ||
      sym.kind === "section" ||
      sym.kind === "label") &&
    sym.line &&
    sym.endLine
  ) {
    return { startLine: sym.line, endLine: Math.max(sym.line, sym.endLine) };
  }
  if (tsIndex) {
    if (sym.kind === "import") {
      const impHit = tsIndex.imports.find((im) => im.source === sym.name);
      if (impHit) {
        return {
          startLine: impHit.startLine,
          endLine: Math.max(impHit.startLine, impHit.endLine),
        };
      }
    } else {
      const declHit = tsIndex.topLevelByName.get(sym.name)?.[0];
      if (declHit) {
        return {
          startLine: declHit.startLine,
          endLine: Math.max(declHit.startLine, declHit.endLine),
        };
      }
    }
  }
  if (targetLang === "css" && sym.kind === "style") {
    try {
      const root = preParsedCssRoot ?? postcss.parse(originalSource);
      let matched: { startLine: number; endLine: number } | undefined;
      const cleanTarget = sym.name.replace(/^[.#]/, "").replace(/[^A-Za-z0-9_]/g, "_");
      root.walkRules((rule) => {
        if (matched) return;
        const sel = rule.selector.replace(/\s+/g, " ").trim();
        const selClean = sel.replace(/^[.#]/, "").replace(/[^A-Za-z0-9_]/g, "_");
        if (sel === sym.name || selClean === cleanTarget || sel.includes(sym.name)) {
          const s = rule.source?.start?.line ?? 1;
          const e = rule.source?.end?.line ?? s;
          matched = { startLine: s, endLine: e };
        }
      });
      if (matched) return matched;
    } catch {
      // ignore
    }
  }

  if (sym.kind !== "import" && !tsIndex) {
    const span = locateNativeDeclarationSpan(originalSource, sym.name, targetLang);
    if (span) {
      const sLine = span.startLine ?? 1;
      const eLine = span.endLine ?? sLine;
      return { startLine: sLine, endLine: Math.max(sLine, eLine) };
    }
  }

  const escaped = escapeRegexForOutline(sym.name);
  const wordRe = sym.kind === "import" ? new RegExp(escaped) : new RegExp(`\\b${escaped}\\b`);
  for (let i = 0; i < rawLines.length; i++) {
    if (wordRe.test(rawLines[i])) {
      if (sym.kind === "import") {
        let s = i;
        while (s > 0 && !/^\s*(?:import|from|#include|use|require)\b/.test(rawLines[s])) {
          s--;
        }
        return { startLine: s + 1, endLine: Math.max(s + 1, i + 1) };
      }
      return { startLine: i + 1, endLine: i + 1 };
    }
  }

  return undefined;
}

function resolveChildSymbolSpanInNative(
  parentSym: OutlineSymbol,
  childSym: OutlineSymbol,
  originalSource: string,
  rawLines: string[],
  targetLang: TargetLanguage,
  _filePath: string,
  tsIndex?: TsFileSymbolIndex,
): { startLine: number; endLine: number } | undefined {
  if (
    childSym.kind === "method" ||
    childSym.kind === "property" ||
    childSym.kind === "field" ||
    childSym.kind === "variant"
  ) {
    const dotted = `${parentSym.name}.${childSym.name}`;
    if (tsIndex) {
      const childHit = tsIndex.membersByQualifiedName.get(dotted)?.[0];
      if (childHit) {
        return {
          startLine: childHit.startLine,
          endLine: Math.max(childHit.startLine, childHit.endLine),
        };
      }
    } else {
      const span = locateNativeDeclarationSpan(originalSource, dotted, targetLang, parentSym.name);
      if (span) {
        const sLine = span.startLine ?? 1;
        const eLine = span.endLine ?? sLine;
        return { startLine: sLine, endLine: Math.max(sLine, eLine) };
      }
    }
  }
  const minLine = Math.max(1, parentSym.line);
  const maxLine = Math.min(rawLines.length, parentSym.endLine ?? rawLines.length);
  const escaped = escapeRegexForOutline(childSym.name);
  const wordRe = new RegExp(`(?:\\b|["'])${escaped}(?:\\b|["'])`);
  for (let i = minLine - 1; i < maxLine; i++) {
    if (wordRe.test(rawLines[i]!)) {
      let endIdx = i;
      let braceDepth = 0;
      let parenDepth = 0;
      for (let k = i; k < maxLine; k++) {
        const ln = rawLines[k]!;
        for (let c = 0; c < ln.length; c++) {
          const ch = ln[c];
          if (ch === "{") braceDepth++;
          else if (ch === "}") braceDepth = Math.max(0, braceDepth - 1);
          else if (ch === "(") parenDepth++;
          else if (ch === ")") parenDepth = Math.max(0, parenDepth - 1);
        }
        endIdx = k;
        if (braceDepth === 0 && parenDepth === 0) {
          break;
        }
      }
      return { startLine: i + 1, endLine: Math.max(i + 1, endIdx + 1) };
    }
  }
  return undefined;
}

export function collectNativeSyntaxDiagnostics(
  filePath: string,
  source: string,
): string | undefined {
  if (filePath.endsWith(".aice")) {
    return undefined;
  }
  const detected = detectTargetFromPathOrContent(filePath, source);
  if (detected === "passthrough") {
    return undefined;
  }
  return formatNativeSyntaxDiagnosticsMarkdown(filePath, source);
}

export const EXTENDED_READ_EXTENSIONS: ReadonlySet<string> = new Set([
  ...KNOWN_TARGET_EXTENSIONS,
  ".java",
  ".pro",
  ".kts",
  ".gradle",
  ".xml",
  ".properties",
  ".webmanifest",
  ".example",
  ".cjs",
  ".mjs",
  ".cts",
  ".mts",
  ".ini",
  ".toml",
  ".cfg",
  ".conf",
  ".sql",
  ".graphql",
  ".gql",
  ".proto",
  ".vue",
  ".svelte",
  ".astro",
  ".scss",
  ".sass",
  ".less",
  ".txt",
]);

export const EXTENDED_READ_FILENAMES: ReadonlySet<string> = new Set([
  "Makefile",
  "GNUmakefile",
  "makefile",
  "Dockerfile",
  "Containerfile",
  "CMakeLists.txt",
  "Jenkinsfile",
  "Vagrantfile",
  "Procfile",
  "Rakefile",
  "Justfile",
  "justfile",
  "Podfile",
  "Fastfile",
  "Appfile",
  "Gemfile",
  "Brewfile",
  "verify",
  "new-project",
  "gradlew",
  "mvnw",
  ".gitignore",
  ".gitattributes",
  ".dockerignore",
  ".npmignore",
  ".eslintignore",
  ".prettierignore",
  ".editorconfig",
  ".env",
  ".env.example",
  ".env.local",
  ".npmrc",
  ".nvmrc",
  "LICENSE",
  "NOTICE",
]);

export const BINARY_SKIP_EXTENSIONS: ReadonlySet<string> = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".avif",
  ".ico",
  ".bmp",
  ".tiff",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".otf",
  ".pdf",
  ".zip",
  ".tar",
  ".gz",
  ".tgz",
  ".bz2",
  ".xz",
  ".7z",
  ".wasm",
  ".pyc",
  ".class",
  ".jar",
  ".apk",
  ".aab",
  ".dex",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".o",
  ".a",
  ".mp3",
  ".mp4",
  ".wav",
  ".ogg",
  ".webm",
  ".sqlite",
  ".db",
  ".lockb",
]);

export const LOCKFILE_SKIP_NAMES: ReadonlySet<string> = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "Cargo.lock",
  "composer.lock",
  "Gemfile.lock",
  "poetry.lock",
]);

export function isNonBinaryExtensionlessDiskFile(absPath: string): boolean {
  let fd: number | undefined;
  try {
    const st = fs.statSync(absPath);
    if (!st.isFile() || st.size > 2 * 1024 * 1024) return false;
    if (st.size === 0) return true;
    const probeLen = Math.min(st.size, 512);
    const buf = Buffer.allocUnsafe(probeLen);
    fd = fs.openSync(absPath, "r");
    const readBytes = fs.readSync(fd, buf, 0, probeLen, 0);
    for (let i = 0; i < readBytes; i++) {
      if (buf[i] === 0) return false;
    }
    return true;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {}
    }
  }
}

export function isSupportedReadDiskFile(
  absPath: string,
  opts?: { allowDotfiles?: boolean; allowLockfiles?: boolean; allowRootAgentDocs?: boolean },
): boolean {
  const baseName = path.basename(absPath);
  if (
    baseName === ".git" ||
    baseName.endsWith(".trivia.json") ||
    baseName === "aice.config.json" ||
    baseName === ".aice-idioms.json"
  ) {
    return false;
  }
  if (!opts?.allowLockfiles && LOCKFILE_SKIP_NAMES.has(baseName)) {
    return false;
  }
  if (
    !opts?.allowRootAgentDocs &&
    (baseName === "AGENTS.md" ||
      baseName === "CLAUDE.md" ||
      baseName === "GEMINI.md" ||
      baseName === ".GEMINI.md")
  ) {
    return false;
  }
  if (baseName.endsWith(".aice")) return true;
  if (EXTENDED_READ_FILENAMES.has(baseName) || baseName.startsWith(".env.")) return true;

  const lowerName = baseName.toLowerCase();
  const ext = path.extname(lowerName);
  if (ext) {
    if (BINARY_SKIP_EXTENSIONS.has(ext)) return false;
    if (EXTENDED_READ_EXTENSIONS.has(ext)) return true;
    for (const knownExt of EXTENDED_READ_EXTENSIONS) {
      if (lowerName.endsWith(knownExt)) return true;
    }
    return false;
  }

  if (baseName.startsWith(".") && !opts?.allowDotfiles) {
    return false;
  }
  return isNonBinaryExtensionlessDiskFile(absPath);
}

function findMatchingBraceEndLine(lines: string[], startIdx: number): number {
  let depth = 0;
  let sawOpen = false;
  let inBlockComment = false;
  for (let i = startIdx; i < lines.length; i++) {
    const ln = lines[i] ?? "";
    let inStr: string | null = null;
    for (let c = 0; c < ln.length; c++) {
      const ch = ln[c]!;
      const next = ln[c + 1];
      if (inBlockComment) {
        if (ch === "*" && next === "/") {
          inBlockComment = false;
          c++;
        }
        continue;
      }
      if (inStr) {
        if (ch === "\\") {
          c++;
          continue;
        }
        if (ch === inStr) inStr = null;
        continue;
      }
      if (ch === "/" && next === "/") break;
      if (ch === "/" && next === "*") {
        inBlockComment = true;
        c++;
        continue;
      }
      if (ch === '"' || ch === "'") {
        inStr = ch;
        continue;
      }
      if (ch === "{") {
        depth++;
        sawOpen = true;
      } else if (ch === "}") {
        depth--;
        if (sawOpen && depth <= 0) {
          return i + 1;
        }
      }
    }
    if (!sawOpen && ln.includes(";")) {
      return i + 1;
    }
  }
  return startIdx + 1;
}

export function extractPassthroughStructuralSymbols(
  originalSource: string,
  filePath: string,
  maxDepth = 2,
): OutlineSymbol[] {
  const out: OutlineSymbol[] = [];
  const lines = originalSource.split(/\r?\n/);
  const lowerPath = filePath.toLowerCase();
  const ext = path.extname(lowerPath);

  if (ext === ".java") {
    let firstImp = 0;
    let lastImp = 0;
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i]!.trim();
      if (t.startsWith("import ")) {
        if (firstImp === 0) firstImp = i + 1;
        lastImp = i + 1;
      } else if (firstImp > 0 && t !== "" && !t.startsWith("//")) {
        break;
      }
    }
    if (firstImp > 0 && lastImp >= firstImp) {
      const count = lastImp - firstImp + 1;
      out.push({
        name: "imports",
        kind: "import",
        line: firstImp,
        endLine: lastImp,
        lineRange: `[L${firstImp}-L${lastImp}]`,
        signature: `imports (${count} lines)`,
        children: [],
      });
    }

    const typeRe =
      /^\s*(?:@[A-Za-z0-9_$.]+(?:\([^)]*\))?\s+)*(?:(?:public|protected|private|abstract|final|static|sealed|non-sealed)\s+)*(class|interface|enum|record)\s+([A-Za-z_$][A-Za-z0-9_$]*)/;
    const methodRe =
      /^\s*(?:@[A-Za-z0-9_$.]+(?:\([^)]*\))?\s+)*(?:(?:public|protected|private|static|final|synchronized|abstract|default|native)\s+)+(?:<[^>]+>\s+)?(?:[A-Za-z_$][A-Za-z0-9_$.<>[\],?\s]*\s+)?([A-Za-z_$][A-Za-z0-9_$]*)\s*\(([^)]*)\)/;
    const javaControlKeywords = new Set([
      "if",
      "for",
      "while",
      "switch",
      "catch",
      "synchronized",
      "return",
      "new",
      "super",
      "this",
    ]);

    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i]!;
      const tm = ln.match(typeRe);
      if (!tm?.[1] || !tm[2]) continue;
      const kw = tm[1];
      const typeName = tm[2];
      const sLine = i + 1;
      const eLine = findMatchingBraceEndLine(lines, i);
      const children: OutlineSymbol[] = [];

      if (maxDepth >= 2 && eLine > sLine) {
        for (let j = i + 1; j < eLine - 1; j++) {
          const mln = lines[j]!;
          const mm = mln.match(methodRe);
          if (!mm?.[1]) continue;
          const mName = mm[1];
          if (javaControlKeywords.has(mName)) continue;
          const mStart = j + 1;
          const mEnd = findMatchingBraceEndLine(lines, j);
          children.push({
            name: mName,
            kind: mName === typeName ? "constructor" : "method",
            line: mStart,
            endLine: mEnd,
            lineRange: `[L${mStart}-L${mEnd}]`,
            signature: `${mName}(${(mm[2] ?? "").trim()}): ...`,
            children: [],
          });
          if (mEnd > j + 1) {
            j = mEnd - 1;
          }
        }
      }

      out.push({
        name: typeName,
        kind: kw === "interface" ? "interface" : kw === "enum" ? "enum" : "class",
        line: sLine,
        endLine: eLine,
        lineRange: `[L${sLine}-L${eLine}]`,
        signature: `${kw} ${typeName}: ...`,
        children,
      });
      if (eLine > i + 1) {
        i = eLine - 1;
      }
    }
    return out;
  }

  if (ext === ".gradle" || lowerPath.endsWith(".gradle.kts")) {
    const blockRe = /^([A-Za-z_][A-Za-z0-9_.-]*)\s*\{/;
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i]!.match(blockRe);
      if (!m?.[1]) continue;
      const name = m[1];
      const sLine = i + 1;
      const eLine = findMatchingBraceEndLine(lines, i);
      out.push({
        name,
        kind: "section",
        line: sLine,
        endLine: eLine,
        lineRange: `[L${sLine}-L${eLine}]`,
        signature: `${name} { ... }`,
        children: [],
      });
      if (eLine > i + 1) i = eLine - 1;
    }
    return out;
  }

  if (ext === ".xml") {
    const tagRe = /^\s*<([A-Za-z_][A-Za-z0-9_:.-]*)([^>]*?)(\/?)>/;
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i]!;
      if (
        ln.trim().startsWith("<?") ||
        ln.trim().startsWith("<!--") ||
        ln.trim().startsWith("</")
      ) {
        continue;
      }
      const m = ln.match(tagRe);
      if (!m?.[1]) continue;
      const tag = m[1];
      const attrs = m[2] ?? "";
      const selfClosed = m[3] === "/" || ln.includes(`</${tag}>`);
      const nameAttr = attrs.match(/(?:android:name|name|id)=["']([^"']+)["']/)?.[1];
      const label = nameAttr ? `${tag}(${nameAttr})` : tag;
      let eLine = i + 1;
      if (!selfClosed) {
        const closeRe = new RegExp(`</${tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}>`);
        for (let j = i + 1; j < lines.length; j++) {
          if (closeRe.test(lines[j]!)) {
            eLine = j + 1;
            break;
          }
        }
      }
      out.push({
        name: nameAttr ?? tag,
        kind: "section",
        line: i + 1,
        endLine: eLine,
        lineRange: `[L${i + 1}-L${eLine}]`,
        signature: `<${label}>`,
        children: [],
      });
      if (out.length >= 25) break;
    }
    return out;
  }

  if (ext === ".pro") {
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i]!.trim();
      if (t.startsWith("-keep") || t.startsWith("-dontwarn")) {
        let eLine = i + 1;
        if (t.includes("{") && !t.includes("}")) {
          eLine = findMatchingBraceEndLine(lines, i);
        }
        const shortSig = t.length > 72 ? `${t.slice(0, 69)}...` : t;
        out.push({
          name: shortSig.split(/\s+/).slice(0, 3).join(" "),
          kind: "section",
          line: i + 1,
          endLine: eLine,
          lineRange: `[L${i + 1}-L${eLine}]`,
          signature: shortSig,
          children: [],
        });
        if (eLine > i + 1) i = eLine - 1;
      }
    }
    return out;
  }

  const existingSectionNames = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const tomlMatch = line.match(/^\s*\[([A-Za-z0-9_.-]+)\]\s*$/);
    const mdMatch = line.match(/^\s*(#{1,6})\s+(.+)$/);
    const shFnMatch = line.match(/^\s*(?:function\s+)?([A-Za-z_][A-Za-z0-9_-]*)\s*\(\)\s*\{/);
    const pyDefMatch = line.match(/^(\s*)(?:async\s+)?(?:def|class)\s+([A-Za-z_][A-Za-z0-9_]*)\b/);
    if (tomlMatch?.[1]) {
      const secName = tomlMatch[1];
      if (!existingSectionNames.has(secName)) {
        let eLine = lines.length;
        for (let j = i + 1; j < lines.length; j++) {
          if (/^\s*\[[A-Za-z0-9_.-]+\]\s*$/.test(lines[j]!)) {
            eLine = j;
            break;
          }
        }
        out.push({
          name: secName,
          kind: "section",
          line: i + 1,
          endLine: eLine,
          lineRange: `[L${i + 1}-L${eLine}]`,
          signature: `[${secName}]`,
          children: [],
        });
        existingSectionNames.add(secName);
      }
    } else if (mdMatch?.[1] && mdMatch[2]) {
      const title = mdMatch[2].trim();
      if (!existingSectionNames.has(title)) {
        out.push({
          name: title,
          kind: "section",
          line: i + 1,
          endLine: i + 1,
          lineRange: `[L${i + 1}-L${i + 1}]`,
          signature: `${mdMatch[1]} ${title}`,
          children: [],
        });
        existingSectionNames.add(title);
      }
    } else if (shFnMatch?.[1]) {
      const fnName = shFnMatch[1];
      if (!existingSectionNames.has(fnName)) {
        const eLine = findMatchingBraceEndLine(lines, i);
        out.push({
          name: fnName,
          kind: "function",
          line: i + 1,
          endLine: eLine,
          lineRange: `[L${i + 1}-L${eLine}]`,
          signature: `fn ${fnName}(): ...`,
          children: [],
        });
        existingSectionNames.add(fnName);
      }
    } else if (pyDefMatch?.[2]) {
      const symName = pyDefMatch[2];
      const baseIndent = (pyDefMatch[1] ?? "").length;
      if (baseIndent === 0 && !existingSectionNames.has(symName)) {
        let eLine = i + 1;
        for (let j = i + 1; j < lines.length; j++) {
          const jln = lines[j]!;
          if (jln.trim() === "" || jln.trim().startsWith("#")) continue;
          const ind = jln.length - jln.trimStart().length;
          if (ind <= baseIndent) break;
          eLine = j + 1;
        }
        out.push({
          name: symName,
          kind: line.trimStart().startsWith("class ") ? "class" : "function",
          line: i + 1,
          endLine: eLine,
          lineRange: `[L${i + 1}-L${eLine}]`,
          signature: line.trim().replace(/:$/, ": ..."),
          children: [],
        });
        existingSectionNames.add(symName);
      }
    }
  }
  return out;
}

const OUTLINE_IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".aice-build",
  ".aice-cache",
  "coverage",
  "target",
  "vendor",
  ".next",
  ".turbo",
  "out",
  "benchmarks",
  "__pycache__",
]);

export async function outlinePath(
  targetPath: string | string[],
  options: OutlineOptions = {},
): Promise<OutlineResult | Map<string, OutlineResult>> {
  const inputPaths = Array.isArray(targetPath)
    ? targetPath.filter((p) => Boolean(p?.trim()))
    : [targetPath];
  if (inputPaths.length === 0) {
    throw new Error("No target path provided to outlinePath");
  }
  const baseResolveDir = options.projectRoot ? path.resolve(options.projectRoot) : process.cwd();
  const resolveInputPath = (rawP: string): string => {
    if (path.isAbsolute(rawP)) return path.resolve(rawP);
    const fromBase = path.resolve(baseResolveDir, rawP);
    if (fs.existsSync(fromBase) || !options.projectRoot) return fromBase;
    const fromCwd = path.resolve(process.cwd(), rawP);
    return fs.existsSync(fromCwd) ? fromCwd : fromBase;
  };

  const resolvedEntries = inputPaths.map((rawP) => {
    const fullP = resolveInputPath(rawP);
    return { rawP, fullP, exists: fs.existsSync(fullP) };
  });
  const existingEntries = resolvedEntries.filter((e) => e.exists);
  if (existingEntries.length === 0) {
    throw new Error(`File or directory not found: ${inputPaths[0]}`);
  }

  const firstFullPath = existingEntries[0]!.fullP;
  const firstStat = fs.statSync(firstFullPath);
  const firstDir = firstStat.isDirectory() ? firstFullPath : path.dirname(firstFullPath);
  const cwdResolved = path.resolve(process.cwd());
  const fallbackDir =
    firstDir === cwdResolved || firstDir.startsWith(`${cwdResolved}${path.sep}`)
      ? cwdResolved
      : firstDir;
  const projectRoot = options.projectRoot
    ? path.resolve(options.projectRoot)
    : findProjectRoot(firstDir, fallbackDir);
  const cfg = loadProjectConfig(projectRoot);
  if (!isProjectAiceEnabled(cfg)) {
    throw new Error(AICE_DISABLED_MESSAGE);
  }

  if (!Array.isArray(targetPath) && firstStat.isFile()) {
    const nativeText = fs.readFileSync(firstFullPath, "utf-8");
    const res = withSuppressedTelemetry(() =>
      generateOutline(firstFullPath, { ...options, preReadSource: nativeText, projectRoot }),
    );
    const nativeDiags = collectNativeSyntaxDiagnostics(firstFullPath, nativeText);
    if (nativeDiags && !options.json) {
      res.text = res.text ? `${res.text}\n\n${nativeDiags}` : nativeDiags;
    }
    const nativeCl100k = estimateTokens(nativeText, "cl100k_base");
    const aiceCl100k = estimateTokens(res.text, "cl100k_base");
    const structuralCompressionPct =
      nativeCl100k > 0 ? Math.round(((nativeCl100k - aiceCl100k) / nativeCl100k) * 100) : 0;
    recordTelemetryEvent({
      targetPath: firstFullPath,
      projectRoot,
      operation: "outline",
      surface: "cli",
      idiomsUsed: (res.referencedIdioms?.length ?? 0) > 0,
      nativeText,
      nativeCl100k,
      aiceCl100k,
      realisticNativeText: nativeText,
      realisticNativeCl100k: nativeCl100k,
      structuralCompressionPct,
      aiceText: res.text,
    });
    return res;
  }

  const resultMap = new Map<string, OutlineResult>();
  const targetCandidatesSet = new Set<string>();
  const visitedDirs = new Set<string>();

  const walk = (
    dir: string,
    explicitRootInNodeModules: boolean,
    explicitAllowedNames: Set<string>,
  ) => {
    let realDir: string;
    try {
      realDir = fs.realpathSync(dir);
    } catch {
      return;
    }
    if (visitedDirs.has(realDir)) return;
    visitedDirs.add(realDir);

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === ".git") continue;
        if (entry.name === "node_modules" && !explicitAllowedNames.has("node_modules")) continue;
        if (entry.name.startsWith(".") && !explicitAllowedNames.has(entry.name)) continue;
        if (
          OUTLINE_IGNORED_DIRS.has(entry.name) &&
          !explicitAllowedNames.has(entry.name) &&
          !(
            explicitRootInNodeModules &&
            (entry.name === "dist" || entry.name === "build" || entry.name === "out")
          )
        ) {
          continue;
        }
        walk(p, explicitRootInNodeModules, explicitAllowedNames);
      } else if (entry.isFile()) {
        if (entry.name.endsWith(".aice")) {
          targetCandidatesSet.add(p);
        } else if (!fs.existsSync(`${p}.aice`) && isSupportedReadDiskFile(p)) {
          targetCandidatesSet.add(p);
        }
      }
    }
  };

  const missingEntries: string[] = [];
  for (const entry of resolvedEntries) {
    if (!entry.exists) {
      missingEntries.push(entry.rawP);
      continue;
    }
    const st = fs.statSync(entry.fullP);
    if (st.isDirectory()) {
      const segs = entry.fullP.split(path.sep).filter(Boolean);
      const inNodeModules = segs.includes("node_modules");
      const allowed = new Set<string>();
      for (const s of entry.rawP.replace(/\\/g, "/").split("/").filter(Boolean)) {
        if (OUTLINE_IGNORED_DIRS.has(s) || s.startsWith(".")) allowed.add(s);
      }
      walk(entry.fullP, inNodeModules, allowed);
    } else if (st.isFile()) {
      targetCandidatesSet.add(entry.fullP);
    }
  }

  const targetCandidates = Array.from(targetCandidatesSet).sort();
  const isCompactMode =
    options.compact === true || (options.compact !== false && targetCandidates.length >= 40);

  const aiceParts: string[] = [];
  let anyIdioms = false;
  const dirBaselineLines: string[] = [];

  let preloadedConfigChecked = false;
  let preloadedIdiomsActive = false;
  let preloadedIdiomsConfig: Record<string, ProjectIdiomDefinition> | undefined;
  if (targetCandidates.length > 10) {
    try {
      const loadedCfg = loadProjectConfig(projectRoot);
      if (isProjectAiceEnabled(loadedCfg)) {
        preloadedConfigChecked = true;
        preloadedIdiomsActive = isProjectIdiomsEnabled(loadedCfg, options.idioms);
        if (preloadedIdiomsActive) {
          preloadedIdiomsConfig = loadedCfg.idioms;
        }
      }
    } catch {
      // fallback to per-file config resolution
    }
  }

  let totalRawChars = 0;
  let totalRawTokens = 0;
  for (const targetFile of targetCandidates) {
    let relKey = path.relative(process.cwd(), targetFile).replace(/\\/g, "/");
    if (relKey.startsWith("..") && options.projectRoot) {
      relKey = path.relative(projectRoot, targetFile).replace(/\\/g, "/");
    }
    let rawText = "";
    try {
      rawText = fs.readFileSync(targetFile, "utf-8");
    } catch {
      continue;
    }
    totalRawChars += rawText.length;
    totalRawTokens += estimateTokens(rawText, "cl100k_base");
    const r = withSuppressedTelemetry(() =>
      generateOutline(targetFile, {
        ...options,
        preReadSource: rawText,
        skipTokenStats: !options.stats,
        preloadedConfigChecked,
        preloadedIdiomsActive,
        preloadedIdiomsConfig,
        depth: isCompactMode && options.depth === undefined ? 1 : options.depth,
        projectRoot,
      }),
    );
    if (dirBaselineLines.length < 40) {
      const previewSlice = rawText.split(/\r?\n/).slice(0, 30).join("\n");
      dirBaselineLines.push(`// ${relKey}\n${previewSlice}`);
    }

    if (targetCandidates.length === 1 && !options.json) {
      const nativeDiags = collectNativeSyntaxDiagnostics(targetFile, rawText);
      if (nativeDiags) {
        r.text = r.text ? `${r.text}\n\n${nativeDiags}` : nativeDiags;
      }
    }
    if (isCompactMode && !options.json && r.text) {
      const nonImportLines = r.text
        .split(/\r?\n/)
        .filter(
          (l) => l.trim().length > 0 && !/^\s*(?:from\s+["']|import\s+["']|extends\s+["'])/.test(l),
        );
      if (nonImportLines.length > 20) {
        r.text = `${nonImportLines.slice(0, 20).join("\n")}\n// ... (+${nonImportLines.length - 20} more symbols)`;
      } else if (nonImportLines.length > 0) {
        r.text = nonImportLines.join("\n");
      }
    }
    resultMap.set(relKey, r);
    aiceParts.push(`// ${relKey}\n${r.text}`);
    if ((r.referencedIdioms?.length ?? 0) > 0) {
      anyIdioms = true;
    }
  }

  for (const missingRaw of missingEntries) {
    const cleanMissing = missingRaw.replace(/\\/g, "/");
    const msg = `// not found: ${cleanMissing}`;
    resultMap.set(cleanMissing, {
      file: cleanMissing,
      symbols: [],
      text: msg,
      ...(options.json ? { json: { file: cleanMissing, symbols: [] } } : {}),
    });
    aiceParts.push(`// ${cleanMissing}\n${msg}`);
  }

  if (targetCandidates.length > 0) {
    const aiceTextPayload = options.json
      ? JSON.stringify(
          Array.from(resultMap.values()).map((r) => r.json ?? { file: r.file, symbols: r.symbols }),
          null,
          2,
        )
      : aiceParts.join("\n\n");
    const aiceCl100k = estimateTokens(aiceTextPayload, "cl100k_base");
    const fdListing = Array.from(resultMap.keys()).join("\n");
    const honestDirRealisticText = [fdListing, ...dirBaselineLines].filter(Boolean).join("\n");
    const honestRealisticCl100k = estimateTokens(honestDirRealisticText, "cl100k_base");
    const rawTotalCl100k = Math.max(honestRealisticCl100k, totalRawTokens);
    const rawTotalO200k = Math.max(
      estimateTokens(honestDirRealisticText, "o200k_base"),
      rawTotalCl100k,
    );
    const structuralCompressionPct =
      rawTotalCl100k > 0 ? Math.round(((rawTotalCl100k - aiceCl100k) / rawTotalCl100k) * 100) : 0;
    recordTelemetryEvent({
      targetPath: firstFullPath,
      projectRoot,
      filePath: "<directory>",
      operation: "outline",
      surface: "cli",
      idiomsUsed: anyIdioms,
      nativeText: "",
      nativeChars: Math.max(honestDirRealisticText.length, totalRawChars),
      nativeCl100k: rawTotalCl100k,
      nativeO200k: rawTotalO200k,
      realisticNativeText: honestDirRealisticText,
      realisticNativeCl100k: Math.min(rawTotalCl100k, honestRealisticCl100k),
      structuralCompressionPct,
      aiceText: aiceTextPayload,
      aiceCl100k,
    });
  }
  return resultMap;
}
