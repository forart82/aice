/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AICE 2.0 Semantic AST Skeleton Outline Engine (Step 18).
 * Provides semantic skeletonization achieving 85–90%+ token reduction for AI contexts.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import postcss from "postcss";
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
import { detectTargetFromPath, type TargetLanguage } from "../emitters/index.js";
import { collapseModuleIdioms } from "../idioms/idiom-transform.js";
import { recordTelemetryEvent, withSuppressedTelemetry } from "../telemetry/index.js";
import { estimateTokens } from "../tokenomics/index.js";
import { locateNativeDeclarationSpan } from "./splice.js";
import { formatNativeSyntaxDiagnosticsMarkdown } from "./syntax-validator.js";

export interface OutlineOptions {
  depth?: number;
  includeTypes?: boolean;
  json?: boolean;
  stats?: boolean;
  projectRoot?: string;
  idioms?: boolean;
  lineRanges?: boolean;
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
  const explicitFilePath = typeof filePathOrOptions === "string" ? filePathOrOptions : undefined;
  const options: OutlineOptions =
    typeof filePathOrOptions === "string" ? maybeOptions : filePathOrOptions;

  const includeTypes = options.includeTypes !== false;
  const maxDepth = options.depth !== undefined ? options.depth : Infinity;
  const isJson = options.json === true;

  let filePath = explicitFilePath || "<anonymous>";
  let originalSource = "";
  let ast: Module;
  let trivia = new CstTriviaTable();

  if (typeof sourceOrMod === "object" && sourceOrMod !== null && sourceOrMod.kind === "Module") {
    ast = sourceOrMod;
    filePath = ast.path || explicitFilePath || "<anonymous>";
    if (filePath !== "<anonymous>" && fs.existsSync(filePath)) {
      try {
        originalSource = fs.readFileSync(filePath, "utf-8");
      } catch {
        // ignore
      }
    }
  } else if (typeof sourceOrMod === "string") {
    const isFile =
      !sourceOrMod.includes("\n") &&
      fs.existsSync(sourceOrMod) &&
      fs.statSync(sourceOrMod).isFile();
    if (isFile) {
      filePath = sourceOrMod;
      originalSource = fs.readFileSync(filePath, "utf-8");
      if (filePath.endsWith(".aice")) {
        const parsed = parseWithTrivia(originalSource, filePath);
        ast = parsed.ast;
        trivia = parsed.trivia;
      } else {
        const targetLang = detectTargetFromPath(filePath);
        try {
          const decompResult = withSuppressedTelemetry(() =>
            decompile(originalSource, targetLang, { filePath }),
          );
          try {
            const parsed = parseWithTrivia(decompResult.aice, filePath);
            ast = parsed.ast;
            trivia = parsed.trivia;
          } catch {
            ast = decompResult.ast;
            trivia = decompResult.trivia;
          }
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
    } else {
      filePath = explicitFilePath || "<anonymous>";
      originalSource = sourceOrMod;
      const hasKnownTargetExt =
        explicitFilePath !== undefined &&
        !explicitFilePath.endsWith(".aice") &&
        KNOWN_TARGET_EXTENSIONS.has(path.extname(explicitFilePath).toLowerCase());

      if (hasKnownTargetExt && explicitFilePath) {
        const targetLang = detectTargetFromPath(explicitFilePath);
        try {
          const decompResult = withSuppressedTelemetry(() =>
            decompile(originalSource, targetLang, {
              filePath: explicitFilePath,
            }),
          );
          try {
            const parsed = parseWithTrivia(decompResult.aice, explicitFilePath);
            ast = parsed.ast;
            trivia = parsed.trivia;
          } catch {
            ast = decompResult.ast;
            trivia = decompResult.trivia;
          }
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
          try {
            const targetLang =
              explicitFilePath && !explicitFilePath.endsWith(".aice")
                ? detectTargetFromPath(explicitFilePath)
                : "typescript";
            const decompResult = withSuppressedTelemetry(() =>
              decompile(originalSource, targetLang, { filePath }),
            );
            try {
              const parsed = parseWithTrivia(decompResult.aice, filePath);
              ast = parsed.ast;
              trivia = parsed.trivia;
            } catch {
              ast = decompResult.ast;
              trivia = decompResult.trivia;
            }
          } catch {
            throw err;
          }
        }
      }
    }
  } else {
    throw new Error("Invalid sourceOrMod argument provided to generateOutline");
  }

  const symbols: OutlineSymbol[] = [];

  if (maxDepth >= 1) {
    for (const item of ast.items) {
      switch (item.kind) {
        case "ImportDecl": {
          const line = item.span?.start?.line || 1;
          const sig =
            item.specifiers.length === 0
              ? `import "${item.source}"`
              : `from "${item.source}" import { ${item.specifiers.map((s) => (s.alias ? `${s.name} as ${s.alias}` : s.name)).join(", ")} }`;
          symbols.push({
            name: item.source,
            kind: "import",
            line,
            signature: sig,
            children: [],
          });
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
          const sig = `${pub}${asy}fn ${item.name}${typeParams}(${paramsStr})${retStr}: ...`;
          const docstring = getLeadingTriviaDoc(trivia, `fn:${item.name}`);
          symbols.push({
            name: item.name,
            kind: "function",
            line,
            signature: sig,
            children: [],
            docstring,
          });
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
              children.push({
                name: p.name,
                kind: "property",
                line: pLine,
                signature: propSig,
                children: [],
                docstring: propDoc,
              });
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
              const methSig = `${st}${asy}${acc}fn ${m.name}${mTypeParams}(${paramsStr})${retStr}: ...`;
              const methDoc = getLeadingTriviaDoc(trivia, `method:${item.name}.${m.name}`);
              children.push({
                name: m.name,
                kind: "method",
                line: mLine,
                signature: methSig,
                children: [],
                docstring: methDoc,
              });
            }
          }

          symbols.push({
            name: item.name,
            kind: "class",
            line,
            signature: sig,
            children,
            docstring,
          });
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
                children.push({
                  name: v.name,
                  kind: "variant",
                  line: vLine,
                  signature: `${v.name}${vPayload}`,
                  children: [],
                });
              }
            }
            symbols.push({
              name: item.name,
              kind: "enum",
              line,
              signature: sig,
              children,
              docstring,
            });
          } else if (item.aliasType) {
            const typeParams =
              item.typeParams && item.typeParams.length > 0
                ? `[${item.typeParams.join(", ")}]`
                : "";
            const aliasStr = includeTypes ? ` = ${formatTypeExpr(item.aliasType)}` : "";
            const sig = `type ${item.name}${typeParams}${aliasStr}`;
            symbols.push({
              name: item.name,
              kind: "type",
              line,
              signature: sig,
              children: [],
              docstring,
            });
          } else {
            // Struct / Interface / Record
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
                children.push({
                  name: f.name,
                  kind: "field",
                  line: fLine,
                  signature: `${f.name}${opt}${typeAnn}`,
                  children: [],
                  docstring: fDoc,
                });
              }
            }

            symbols.push({
              name: item.name,
              kind,
              line,
              signature: sig,
              children,
              docstring,
            });
          }
          break;
        }
        case "ConstDecl": {
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
              children.push({
                name: prop.key,
                kind: "field",
                line: pLine,
                signature: `${prop.key}: ${valDesc}`,
                children: [],
              });
            }
          }
          symbols.push({
            name: item.name,
            kind: "const",
            line,
            signature: sig,
            children,
            docstring,
          });
          break;
        }
        case "VarDecl": {
          const line = item.span?.start?.line || 1;
          const pub = item.isExported ? "pub " : "";
          const kw = item.isMut ? "mut " : "val ";
          const typeAnn =
            includeTypes && item.typeAnnotation ? `: ${formatTypeExpr(item.typeAnnotation)}` : "";
          const sig = `${pub}${kw}${item.name}${typeAnn}`;
          const docstring = getLeadingTriviaDoc(trivia, `var:${item.name}`);
          symbols.push({
            name: item.name,
            kind: "var",
            line,
            signature: sig,
            children: [],
            docstring,
          });
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
              children.push({
                name: `${c.tag}${cIdPart}${cClassPart}`,
                kind: "layout",
                line: cLine,
                signature: `${c.tag}${cIdPart}${cClassPart}: ...`,
                children: [],
              });
            }
          }
          symbols.push({
            name: item.name,
            kind: "component",
            line,
            signature: sig,
            children,
            docstring,
          });
          break;
        }
        case "StyleDecl": {
          const line = item.span?.start?.line || 1;
          const sig = `style ${item.name}: ...`;
          const docstring = getLeadingTriviaDoc(trivia, `style:${item.name}`);
          symbols.push({
            name: item.name,
            kind: "style",
            line,
            signature: sig,
            children: [],
            docstring,
          });
          break;
        }
      }
    }
  }

  enrichAndResolveSymbolLineRanges(symbols, ast, originalSource, filePath, maxDepth);

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
    } else {
      baseOutlineLines.push(sym.signature);
      annotatedOutlineLines.push(`${sym.signature}${symRangeSuffix}`);
    }
  }

  let idiomsConfig: Record<string, ProjectIdiomDefinition> | undefined;
  let idiomsActive = true;
  try {
    const hasScopedTarget =
      Boolean(options.projectRoot) || (filePath !== "<anonymous>" && fs.existsSync(filePath));
    const root =
      options.projectRoot ??
      (filePath !== "<anonymous>" && fs.existsSync(filePath)
        ? findProjectRoot(path.dirname(path.resolve(filePath)))
        : findProjectRoot(process.cwd()));
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

  const referencedSet = new Set<string>();
  if (idiomsActive && idiomsConfig) {
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

  const baseOutlineText = baseOutlineLines.join("\n");
  const outlineText = (includeLineRanges ? annotatedOutlineLines : baseOutlineLines).join("\n");

  // Tokenomics Statistics (measured against base semantic skeleton)
  const origForTokens = originalSource || baseOutlineText;
  const originalTokens = estimateTokens(origForTokens);
  const outlineTokens = estimateTokens(baseOutlineText);
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

function enrichAndResolveSymbolLineRanges(
  symbols: OutlineSymbol[],
  ast: Module,
  originalSource: string,
  filePath: string,
  maxDepth: number,
): void {
  if (maxDepth < 1) return;

  // Populate initial endLine from AST spans
  const actionableAstItems = ast.items.filter(
    (it) => !(it.kind === "FunctionDecl" && it.name === "__top_level__"),
  );
  for (let i = 0; i < symbols.length; i++) {
    const sym = symbols[i];
    const astItem = actionableAstItems[i];
    if (astItem?.span?.end?.line) {
      sym.endLine = Math.max(sym.line, astItem.span.end.line);
    } else {
      sym.endLine = sym.line;
    }
    if (sym.children) {
      for (const child of sym.children) {
        child.endLine = child.endLine ?? child.line;
      }
    }
  }

  const ext = filePath !== "<anonymous>" ? path.extname(filePath).toLowerCase() : "";
  const isNativeFile =
    filePath !== "<anonymous>" && !filePath.endsWith(".aice") && KNOWN_TARGET_EXTENSIONS.has(ext);
  const targetLang: TargetLanguage | undefined = isNativeFile
    ? detectTargetFromPath(filePath)
    : undefined;
  const rawLines = originalSource ? originalSource.split(/\r?\n/) : [];
  const totalLines = Math.max(1, rawLines.length);

  if (isNativeFile && originalSource && targetLang) {
    supplementNativeSymbolsFromSource(symbols, originalSource, targetLang, totalLines);
  }

  // Resolve accurate line & endLine in originalSource
  for (let i = 0; i < symbols.length; i++) {
    const sym = symbols[i];
    if (isNativeFile && originalSource && targetLang) {
      const resolved = resolveSingleSymbolSpanInNative(
        sym,
        originalSource,
        rawLines,
        targetLang,
        filePath,
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
        if (isNativeFile && originalSource && targetLang) {
          const childResolved = resolveChildSymbolSpanInNative(
            sym,
            child,
            originalSource,
            rawLines,
            targetLang,
            filePath,
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

function supplementNativeSymbolsFromSource(
  symbols: OutlineSymbol[],
  source: string,
  targetLang: TargetLanguage,
  totalLines: number,
): void {
  const existingNames = new Set<string>();
  for (const s of symbols) {
    existingNames.add(s.name);
    if (s.children) {
      for (const c of s.children) {
        existingNames.add(c.name);
        existingNames.add(`${s.name}.${c.name}`);
      }
    }
  }

  if (targetLang === "css") {
    try {
      const root = postcss.parse(source);
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
      // ignore invalid CSS parse in supplement
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

  const lines = source.split(/\r?\n/);
  const declPatterns: Array<{ re: RegExp; kind: string; sigPrefix: string }> = [
    // Rust macro_rules!, struct, enum, trait, fn
    {
      re: /^\s*(?:pub\s+)?macro_rules!\s+([A-Za-z_][A-Za-z0-9_]*)/,
      kind: "function",
      sigPrefix: "fn ",
    },
    {
      re: /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)/,
      kind: "function",
      sigPrefix: "fn ",
    },
    {
      re: /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:struct|trait)\s+([A-Za-z_][A-Za-z0-9_]*)/,
      kind: "class",
      sigPrefix: "class ",
    },
    // Go func (r *Recv) Name(...) or func Name(...) or type Name struct/interface
    {
      re: /^\s*func\s+(?:\([^)]+\)\s*)?([A-Za-z_][A-Za-z0-9_]*)\s*\(/,
      kind: "function",
      sigPrefix: "fn ",
    },
    {
      re: /^\s*type\s+([A-Za-z_][A-Za-z0-9_]*)\s+(?:struct|interface)\b/,
      kind: "interface",
      sigPrefix: "type ",
    },
    // Kotlin sealed interface, data class, suspend fun, fun
    {
      re: /^\s*(?:public\s+|internal\s+|private\s+)?(?:sealed\s+interface|sealed\s+class|data\s+class|class|interface|object)\s+([A-Za-z_][A-Za-z0-9_]*)/,
      kind: "class",
      sigPrefix: "class ",
    },
    {
      re: /^\s*(?:public\s+|internal\s+|private\s+|override\s+)*(?:suspend\s+|inline\s+)*fun\s+(?:<[^>]+>\s*)?(?:[A-Za-z_][A-Za-z0-9_<>?.*]*\.)?([A-Za-z_][A-Za-z0-9_]*)\s*\(/,
      kind: "function",
      sigPrefix: "fn ",
    },
    // C# record / class / interface
    {
      re: /^\s*(?:public|private|protected|internal|sealed|abstract|partial|static|\s)*\b(?:record|class|struct|interface)\s+([A-Za-z_][A-Za-z0-9_]*)/,
      kind: "class",
      sigPrefix: "class ",
    },
    // Python async def / def / class
    {
      re: /^\s*(?:async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/,
      kind: "function",
      sigPrefix: "fn ",
    },
    // PHP function / class
    {
      re: /^\s*(?:public|protected|private|static|abstract|final|\s)*function\s+&?([A-Za-z_][A-Za-z0-9_]*)\s*\(/,
      kind: "function",
      sigPrefix: "fn ",
    },
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
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
): { startLine: number; endLine: number } | null {
  if (targetLang === "css" && sym.kind === "style") {
    try {
      const root = postcss.parse(originalSource);
      let matched: { startLine: number; endLine: number } | null = null;
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
      // fallback to line search
    }
  }

  if (sym.kind !== "import") {
    const span = locateNativeDeclarationSpan(originalSource, sym.name, targetLang);
    if (span) {
      const sLine = span.startLine ?? 1;
      const eLine = span.endLine ?? sLine;
      return { startLine: sLine, endLine: Math.max(sLine, eLine) };
    }
  }

  // Fallback line search in originalSource
  const escaped = escapeRegexForOutline(sym.name);
  const wordRe = sym.kind === "import" ? new RegExp(escaped) : new RegExp(`\\b${escaped}\\b`);
  for (let i = 0; i < rawLines.length; i++) {
    if (wordRe.test(rawLines[i])) {
      return { startLine: i + 1, endLine: i + 1 };
    }
  }
  return null;
}

function resolveChildSymbolSpanInNative(
  parentSym: OutlineSymbol,
  childSym: OutlineSymbol,
  originalSource: string,
  rawLines: string[],
  targetLang: TargetLanguage,
  _filePath: string,
): { startLine: number; endLine: number } | null {
  if (childSym.kind === "method") {
    const dotted = `${parentSym.name}.${childSym.name}`;
    const span = locateNativeDeclarationSpan(originalSource, dotted, targetLang, parentSym.name);
    if (span) {
      const sLine = span.startLine ?? 1;
      const eLine = span.endLine ?? sLine;
      return { startLine: sLine, endLine: Math.max(sLine, eLine) };
    }
  }

  const minLine = Math.max(1, parentSym.line);
  const maxLine = Math.min(rawLines.length, parentSym.endLine ?? rawLines.length);
  const escaped = escapeRegexForOutline(childSym.name);
  const wordRe = new RegExp(`(?:\\b|["'])${escaped}(?:\\b|["'])`);
  for (let i = minLine - 1; i < maxLine; i++) {
    if (wordRe.test(rawLines[i])) {
      return { startLine: i + 1, endLine: i + 1 };
    }
  }
  return null;
}

export function collectNativeSyntaxDiagnostics(
  filePath: string,
  source: string,
): string | undefined {
  if (filePath.endsWith(".aice")) {
    return undefined;
  }
  const ext = path.extname(filePath).toLowerCase();
  if (!KNOWN_TARGET_EXTENSIONS.has(ext)) {
    return undefined;
  }
  return formatNativeSyntaxDiagnosticsMarkdown(filePath, source);
}

export async function outlinePath(
  targetPath: string,
  options: OutlineOptions = {},
): Promise<OutlineResult | Map<string, OutlineResult>> {
  const fullPath = path.resolve(process.cwd(), targetPath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`File or directory not found: ${targetPath}`);
  }

  const stat = fs.statSync(fullPath);
  const projectRoot =
    options.projectRoot ?? findProjectRoot(stat.isDirectory() ? fullPath : path.dirname(fullPath));
  const cfg = loadProjectConfig(projectRoot);
  if (!isProjectAiceEnabled(cfg)) {
    throw new Error(AICE_DISABLED_MESSAGE);
  }

  if (stat.isFile()) {
    const res = withSuppressedTelemetry(() =>
      generateOutline(fullPath, { ...options, projectRoot }),
    );
    const nativeText = fs.readFileSync(fullPath, "utf-8");
    const nativeDiags = collectNativeSyntaxDiagnostics(fullPath, nativeText);
    if (nativeDiags && !options.json) {
      res.text = res.text ? `${res.text}\n\n${nativeDiags}` : nativeDiags;
    }
    recordTelemetryEvent({
      targetPath: fullPath,
      projectRoot,
      operation: "outline",
      surface: "cli",
      idiomsUsed: (res.referencedIdioms?.length ?? 0) > 0,
      nativeText,
      aiceText: res.text,
    });
    return res;
  }

  const resultMap = new Map<string, OutlineResult>();
  const targetCandidates: string[] = [];

  function walk(currentDir: string): void {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (
        entry.name === "node_modules" ||
        entry.name === ".git" ||
        entry.name === "dist" ||
        entry.name === "build" ||
        entry.name === ".next" ||
        entry.name === ".turbo" ||
        entry.name.startsWith(".")
      ) {
        continue;
      }
      const entryPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(entryPath);
      } else if (entry.isFile()) {
        if (
          entry.name.endsWith(".trivia.json") ||
          entry.name === "aice.config.json" ||
          entry.name === "package-lock.json" ||
          entry.name === "tsconfig.json" ||
          entry.name === "jsconfig.json" ||
          entry.name === "biome.json" ||
          entry.name === "rome.json"
        ) {
          continue;
        }
        const ext = path.extname(entry.name).toLowerCase();
        if (KNOWN_TARGET_EXTENSIONS.has(ext) || entry.name.endsWith(".aice")) {
          targetCandidates.push(entryPath);
        }
      }
    }
  }

  walk(fullPath);

  const nativeParts: string[] = [];
  const aiceParts: string[] = [];
  let anyIdioms = false;

  for (const targetFile of targetCandidates.sort()) {
    const relKey = path.relative(process.cwd(), targetFile);
    const r = withSuppressedTelemetry(() =>
      generateOutline(targetFile, { ...options, projectRoot }),
    );
    try {
      const rawText = fs.readFileSync(targetFile, "utf-8");
      nativeParts.push(rawText);
      const nativeDiags = collectNativeSyntaxDiagnostics(targetFile, rawText);
      if (nativeDiags && !options.json) {
        r.text = r.text ? `${r.text}\n\n${nativeDiags}` : nativeDiags;
      }
    } catch {
      // ignore
    }
    resultMap.set(relKey, r);
    aiceParts.push(`// === ${relKey} ===\n\n${r.text}`);
    if ((r.referencedIdioms?.length ?? 0) > 0) {
      anyIdioms = true;
    }
  }

  if (targetCandidates.length > 0) {
    recordTelemetryEvent({
      targetPath: fullPath,
      projectRoot,
      filePath: "<directory>",
      operation: "outline",
      surface: "cli",
      idiomsUsed: anyIdioms,
      nativeText: nativeParts.join("\n"),
      aiceText: options.json
        ? JSON.stringify(
            Array.from(resultMap.values()).map(
              (r) => r.json ?? { file: r.file, symbols: r.symbols },
            ),
            null,
            2,
          )
        : aiceParts.join("\n\n"),
    });
  }

  return resultMap;
}
