/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AIL 2.0 Semantic AST Skeleton Outline Engine (Step 18).
 * Provides semantic skeletonization achieving 85–90%+ token reduction for AI contexts.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { KNOWN_TARGET_EXTENSIONS } from "../config/index.js";
import type {
  ClassDecl,
  ConstDecl,
  EnumVariantDecl,
  FieldDecl,
  FunctionDecl,
  ImportDecl,
  MethodDecl,
  Module,
  ModuleItem,
  ParamDecl,
  PropertyDecl,
  TypeDecl,
  TypeExpr,
  VarDecl,
} from "../core/ast.js";
import { parseWithTrivia } from "../core/parser.js";
import { CstTriviaTable } from "../core/trivia.js";
import { decompile } from "../decompiler/index.js";
import { detectTargetFromPath, type TargetLanguage } from "../emitters/index.js";
import { estimateTokens } from "../tokenomics/index.js";

export interface OutlineOptions {
  depth?: number;
  includeTypes?: boolean;
  json?: boolean;
  stats?: boolean;
  projectRoot?: string;
}

export interface OutlineSymbol {
  name: string;
  kind: string;
  line: number;
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
  json?: {
    file: string;
    symbols: OutlineSymbol[];
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
        item.kind === "LINE_COMMENT" ||
        item.kind === "BLOCK_COMMENT" ||
        item.kind === "DOCSTRING",
    )
    .map((item) => item.content.trimEnd());
  return comments.length > 0 ? comments.join("\n") : undefined;
}

export function generateOutline(
  sourceOrMod: string | Module,
  options: OutlineOptions = {},
): OutlineResult {
  const includeTypes = options.includeTypes !== false;
  const maxDepth = options.depth !== undefined ? options.depth : Infinity;
  const isJson = options.json === true;

  let filePath = "<anonymous>";
  let originalSource = "";
  let ast: Module;
  let trivia = new CstTriviaTable();

  if (typeof sourceOrMod === "object" && sourceOrMod !== null && sourceOrMod.kind === "Module") {
    ast = sourceOrMod;
    filePath = ast.path || "<anonymous>";
  } else if (typeof sourceOrMod === "string") {
    const isFile = fs.existsSync(sourceOrMod) && fs.statSync(sourceOrMod).isFile();
    if (isFile) {
      filePath = sourceOrMod;
      originalSource = fs.readFileSync(filePath, "utf-8");
      if (filePath.endsWith(".ail")) {
        const parsed = parseWithTrivia(originalSource, filePath);
        ast = parsed.ast;
        trivia = parsed.trivia;
      } else {
        const companionAil = `${filePath}.ail`;
        if (fs.existsSync(companionAil)) {
          const ailSource = fs.readFileSync(companionAil, "utf-8");
          const parsed = parseWithTrivia(ailSource, companionAil);
          ast = parsed.ast;
          trivia = parsed.trivia;
        } else {
          const targetLang = detectTargetFromPath(filePath);
          const decompResult = decompile(originalSource, targetLang, { filePath });
          const parsed = parseWithTrivia(decompResult.ail, filePath);
          ast = parsed.ast;
          trivia = parsed.trivia;
        }
      }
    } else {
      filePath = "<anonymous>";
      originalSource = sourceOrMod;
      try {
        const parsed = parseWithTrivia(originalSource, filePath);
        ast = parsed.ast;
        trivia = parsed.trivia;
      } catch (err) {
        try {
          const decompResult = decompile(originalSource, "typescript", { filePath });
          const parsed = parseWithTrivia(decompResult.ail, filePath);
          ast = parsed.ast;
          trivia = parsed.trivia;
        } catch {
          throw err;
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
          symbols.push({
            name: item.name,
            kind: "const",
            line,
            signature: sig,
            children: [],
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
      }
    }
  }

  // Generate Skeleton Outline Text
  const outlineLines: string[] = [];
  for (let i = 0; i < symbols.length; i++) {
    const sym = symbols[i];
    if (i > 0 && (sym.kind === "class" || sym.kind === "function" || sym.kind === "enum" || sym.kind === "interface" || sym.kind === "record")) {
      outlineLines.push("");
    }

    if (sym.docstring) {
      outlineLines.push(sym.docstring);
    }

    if (sym.kind === "class") {
      if (sym.children && sym.children.length > 0) {
        // Strip trailing ' ...' into ':' for multiline outline
        const header = sym.signature.endsWith(": ...")
          ? sym.signature.slice(0, -4)
          : sym.signature;
        outlineLines.push(header);
        for (const child of sym.children) {
          if (child.docstring) {
            for (const dLine of child.docstring.split("\n")) {
              outlineLines.push(`  ${dLine}`);
            }
          }
          outlineLines.push(`  ${child.signature}`);
        }
      } else {
        outlineLines.push(sym.signature);
      }
    } else if (sym.kind === "enum") {
      if (sym.children && sym.children.length > 0) {
        outlineLines.push(`enum ${sym.name}:`);
        for (const child of sym.children) {
          outlineLines.push(`  ${child.signature}`);
        }
      } else {
        outlineLines.push(sym.signature);
      }
    } else if (sym.kind === "interface" || sym.kind === "record") {
      if (sym.children && sym.children.length > 0) {
        const header = sym.signature.endsWith(": ...")
          ? sym.signature.slice(0, -4)
          : sym.signature;
        outlineLines.push(header);
        for (const child of sym.children) {
          if (child.docstring) {
            for (const dLine of child.docstring.split("\n")) {
              outlineLines.push(`  ${dLine}`);
            }
          }
          outlineLines.push(`  ${child.signature}`);
        }
      } else {
        outlineLines.push(sym.signature);
      }
    } else {
      outlineLines.push(sym.signature);
    }
  }

  const outlineText = outlineLines.join("\n");

  // Tokenomics Statistics
  const origForTokens = originalSource || outlineText;
  const originalTokens = estimateTokens(origForTokens);
  const outlineTokens = estimateTokens(outlineText);
  const savingsTokens = Math.max(0, originalTokens - outlineTokens);
  const savingsPct =
    originalTokens > 0 ? Number(((savingsTokens / originalTokens) * 100).toFixed(1)) : 0;
  const originalChars = origForTokens.length;
  const outlineChars = outlineText.length;
  const charSavingsPct =
    originalChars > 0 ? Number((((originalChars - outlineChars) / originalChars) * 100).toFixed(1)) : 0;

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
    symbols,
    ...(options.stats ? { stats } : {}),
  };

  return {
    file: filePath,
    text: isJson ? JSON.stringify(jsonPayload, null, 2) : outlineText,
    symbols,
    json: jsonPayload,
    stats,
  };
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
  if (stat.isFile()) {
    return generateOutline(fullPath, options);
  }

  const resultMap = new Map<string, OutlineResult>();
  const ailFiles: string[] = [];
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
        if (entry.name.endsWith(".ail.trivia.json")) continue;
        if (entry.name.endsWith(".ail")) {
          ailFiles.push(entryPath);
        } else {
          const ext = path.extname(entry.name).toLowerCase();
          if (KNOWN_TARGET_EXTENSIONS.has(ext)) {
            targetCandidates.push(entryPath);
          }
        }
      }
    }
  }

  walk(fullPath);

  const processedBases = new Set<string>();
  for (const ailFile of ailFiles) {
    const baseTarget = ailFile.replace(/\.ail$/, "");
    processedBases.add(baseTarget);
    const relKey = path.relative(process.cwd(), ailFile);
    resultMap.set(relKey, generateOutline(ailFile, options));
  }

  for (const targetFile of targetCandidates) {
    if (!processedBases.has(targetFile)) {
      const relKey = path.relative(process.cwd(), targetFile);
      resultMap.set(relKey, generateOutline(targetFile, options));
    }
  }

  return resultMap;
}
