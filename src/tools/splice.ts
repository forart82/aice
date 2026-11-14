/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AICE 2.0 AST Surgical Splice Engine (Step 19).
 * Enables surgical AST modifications achieving 90%+ output token reduction for AI contexts.
 */

import { didYouMeanSymbol } from "./suggest.js";
import * as fs from "node:fs";
import * as path from "node:path";
import postcss from "postcss";
import YAML from "yaml";
import ts from "../compat/typescript.js";
import {
  AICE_DISABLED_MESSAGE,
  isProjectAiceEnabled,
  isProjectIdiomsEnabled,
  KNOWN_TARGET_EXTENSIONS,
  loadProjectConfig,
  type ProjectIdiomDefinition,
  stripJsonComments,
} from "../config/index.js";
import type {
  Block,
  ClassDecl,
  EnumVariantDecl,
  FieldDecl,
  FunctionDecl,
  MethodDecl,
  Module,
  ModuleItem,
  PropertyDecl,
  Statement,
  TypeDecl,
} from "../core/ast.js";
import { astToValue } from "../core/data-converter.js";
import { parse, parseWithTrivia } from "../core/parser.js";
import { applyTriviaLensToReplacement, extractDeclarationTriviaLens } from "../core/trivia.js";
import { decompile } from "../decompiler/index.js";
import { detectTargetFromPath, emitTarget, type TargetLanguage } from "../emitters/index.js";
import { expandModuleIdioms } from "../idioms/index.js";
import { recordTelemetryEvent, withSuppressedTelemetry } from "../telemetry/index.js";
import { estimateTokens } from "../tokenomics/index.js";
import { TypeChecker } from "../typechecker/checker.js";
import { resolveFirstActionableSymbol } from "./context.js";
import {
  checkPythonDuplicateParams,
  createFile,
  extractInlineIdiomsFromSource,
  normalizeModuleForTarget,
  normalizePythonMethodReturn,
  parseOptionIdioms,
  resolveTargetProjectRoot,
  rewriteReceiverIdentifierInNode,
} from "./create.js";
import {
  isHybridOrNativeSource,
  maskSourceLexically,
  preprocessBareCssLossless,
  preprocessHybridAndIdiomsLossless,
} from "./preprocessor.js";
import { validateNativeSyntax } from "./syntax-validator.js";

export interface SymbolSpliceEdit {
  /** Identifier of target symbol (e.g., 'calculate', 'GameEngine.step', '.btn-primary') */
  symbol: string;
  /** Replacement AICE, hybrid, or native code snippet */
  code?: string;
  /** If set, replaces only the body/statements of the function/method */
  body?: string;
  /** If true, removes the symbol entirely */
  delete?: boolean;
  /** Inserts the new code directly after this symbol */
  insertAfter?: string;
  /** Inserts the new code directly before this symbol */
  insertBefore?: string;
  /** Clone source symbol */
  cloneFrom?: string;
  /** Whether to preserve original doc comments / JSDocs */
  preserveDocs?: boolean;
  /** Aliases for code in JSON payloads */
  aice?: string;
  template?: string;
  snippet?: string;
  content?: string;
  replacement?: string;
  insert_after?: string;
  insert_before?: string;
}

export interface SpliceOptions {
  symbol?: string;
  code?: string;
  body?: string;
  delete?: boolean;
  insertAfter?: string;
  insertBefore?: string;
  cloneFrom?: string;
  preserveDocs?: boolean;
  append?: boolean;
  edits?: SymbolSpliceEdit[];
  create?: boolean;
  overwrite?: boolean;
  force?: boolean;
  idioms?: boolean;
  inlineIdioms?: string | string[] | Record<string, string | ProjectIdiomDefinition>;
  idiom?: string | string[] | Record<string, string | ProjectIdiomDefinition>;
  inPlace?: boolean;
  dryRun?: boolean;
  diff?: boolean;
  compile?: boolean;
  projectRoot?: string;
  sourceOverride?: string;
  suppressTelemetry?: boolean;
}

export interface BatchSpliceItem extends SpliceOptions {
  filePath: string;
  file?: string;
  path?: string;
  aice?: string;
  template?: string;
  snippet?: string;
  content?: string;
  replacement?: string;
  insert_after?: string;
  insert_before?: string;
}

export interface BatchSpliceOptions {
  projectRoot?: string;
  dryRun?: boolean;
  compile?: boolean;
  idioms?: boolean;
  inlineIdioms?: string | string[] | Record<string, string | ProjectIdiomDefinition>;
  idiom?: string | string[] | Record<string, string | ProjectIdiomDefinition>;
  overwrite?: boolean;
  force?: boolean;
  preserveDocs?: boolean;
}

export interface BatchSpliceResult {
  success: boolean;
  results: SpliceResult[];
  modifiedFiles: string[];
  totalEdits: number;
}

export interface SpliceResult {
  success: boolean;
  filePath: string;
  symbol?: string;
  startLine?: number;
  endLine?: number;
  originalSnippet?: string;
  newSnippet?: string;
  diff?: string;
  modifiedCode: string;
  newFileContent?: string;
  newAiceSource: string;
  tokensSaved?: number;
  preservedTriviaTokens?: number;
  realisticTokensSaved?: number;
}

export interface TargetSymbolInfo {
  name: string;
  parent?: ClassDecl | TypeDecl;
  node: ModuleItem | MethodDecl | PropertyDecl | FieldDecl | EnumVariantDecl | Statement;
  kind:
    | "function"
    | "class"
    | "type"
    | "enum"
    | "const"
    | "var"
    | "component"
    | "style"
    | "method"
    | "property"
    | "field"
    | "variant"
    | "statement";
}

/**
 * Searches AST module for a target symbol identifier.
 * Supports top-level declarations and nested members via dot or double-colon syntax (Parent.child or Parent::child).
 */
export function findSpliceTargetSymbol(ast: Module, symbol: string): TargetSymbolInfo | undefined {
  // Check StyleDecl first (CSS selectors often start with '.')
  for (const item of ast.items) {
    if (
      item.kind === "StyleDecl" &&
      (item.name === symbol ||
        item.name.replace(/^[.#]/, "") === symbol.replace(/^[.#]/, "") ||
        item.name.replace(/^[.#]/, "").replace(/[_-]/g, "").toLowerCase() ===
          symbol.replace(/^[.#]/, "").replace(/[_-]/g, "").toLowerCase())
    ) {
      return { name: item.name, node: item, kind: "style" };
    }
  }

  const isNested = (symbol.includes(".") && !symbol.startsWith(".")) || symbol.includes("::");
  if (isNested) {
    const parts = symbol.split(/\.|::/);
    if (parts.length >= 2) {
      const parentName = parts[0];
      const memberName = parts.slice(1).join(".");

      // Search classes
      for (const item of ast.items) {
        if (item.kind === "ClassDecl" && item.name === parentName) {
          for (const m of item.methods) {
            if (m.name === memberName) {
              return { name: memberName, parent: item, node: m, kind: "method" };
            }
          }
          for (const p of item.properties) {
            if (p.name === memberName) {
              return { name: memberName, parent: item, node: p, kind: "property" };
            }
          }
        } else if (item.kind === "TypeDecl" && item.name === parentName) {
          if (item.fields) {
            for (const f of item.fields) {
              if (f.name === memberName) {
                return { name: memberName, parent: item, node: f, kind: "field" };
              }
            }
          }
          if (item.variants) {
            for (const v of item.variants) {
              if (v.name === memberName) {
                return { name: memberName, parent: item, node: v, kind: "variant" };
              }
            }
          }
        }
      }
      return undefined;
    }
  }

  // Top-level search
  for (const item of ast.items) {
    if (item.kind === "FunctionDecl" && item.name !== "__top_level__" && item.name === symbol) {
      return { name: symbol, node: item, kind: "function" };
    }
    if (item.kind === "ClassDecl" && item.name === symbol) {
      return { name: symbol, node: item, kind: "class" };
    }
    if (item.kind === "TypeDecl" && item.name === symbol) {
      return { name: symbol, node: item, kind: item.isEnum ? "enum" : "type" };
    }
    if (item.kind === "ConstDecl" && item.name === symbol) {
      return { name: symbol, node: item, kind: "const" };
    }
    if (item.kind === "VarDecl" && item.name === symbol) {
      return { name: symbol, node: item, kind: "var" };
    }
    if (item.kind === "ComponentDecl" && item.name === symbol) {
      return { name: symbol, node: item, kind: "component" };
    }
    if (item.kind === "StyleDecl" && item.name === symbol) {
      return { name: symbol, node: item, kind: "style" };
    }
    if (item.kind === "FunctionDecl" && item.name === "__top_level__") {
      const block = item.body as Block;
      if (block?.statements) {
        for (const s of block.statements) {
          if (s.kind === "LetBinding" && s.name === symbol) {
            return { name: symbol, node: s, kind: "statement" };
          }
        }
      }
    }
  }

  // Fallback: search unique class method / property or type field / variant
  const fallbackMatches: TargetSymbolInfo[] = [];
  const distinctParents = new Set<string>();
  for (const item of ast.items) {
    if (item.kind === "ClassDecl") {
      for (const m of item.methods) {
        if (m.name === symbol) {
          fallbackMatches.push({ name: symbol, parent: item, node: m, kind: "method" });
          distinctParents.add(item.name);
        }
      }
      for (const p of item.properties) {
        if (p.name === symbol) {
          fallbackMatches.push({ name: symbol, parent: item, node: p, kind: "property" });
          distinctParents.add(item.name);
        }
      }
    } else if (item.kind === "TypeDecl") {
      if (item.fields) {
        for (const f of item.fields) {
          if (f.name === symbol) {
            fallbackMatches.push({ name: symbol, parent: item, node: f, kind: "field" });
            distinctParents.add(item.name);
          }
        }
      }
      if (item.variants) {
        for (const v of item.variants) {
          if (v.name === symbol) {
            fallbackMatches.push({ name: symbol, parent: item, node: v, kind: "variant" });
            distinctParents.add(item.name);
          }
        }
      }
    }
  }

  if (distinctParents.size > 1) {
    throw new Error(
      `Ambiguous symbol '${symbol}' found in multiple containers (${Array.from(distinctParents).join(", ")}). Qualify as '<Class>.${symbol}'.`,
    );
  }
  return fallbackMatches[0];
}

/**
 * Finds the recursive character end offset of a statement.
 */
export function getStatementEndOffset(stmt: Statement, source: string): number {
  if (stmt.kind === "IfStmt") {
    if (stmt.elseBranch) {
      if (stmt.elseBranch.statements && stmt.elseBranch.statements.length > 0) {
        return getStatementEndOffset(
          stmt.elseBranch.statements[stmt.elseBranch.statements.length - 1],
          source,
        );
      }
      return stmt.elseBranch.span ? stmt.elseBranch.span.end.offset : stmt.span.end.offset;
    }
    if (stmt.elifBranches && stmt.elifBranches.length > 0) {
      const lastElif = stmt.elifBranches[stmt.elifBranches.length - 1];
      if (lastElif.body.statements && lastElif.body.statements.length > 0) {
        return getStatementEndOffset(
          lastElif.body.statements[lastElif.body.statements.length - 1],
          source,
        );
      }
      return lastElif.body.span ? lastElif.body.span.end.offset : lastElif.span.end.offset;
    }
    if (stmt.thenBranch) {
      if (stmt.thenBranch.statements && stmt.thenBranch.statements.length > 0) {
        return getStatementEndOffset(
          stmt.thenBranch.statements[stmt.thenBranch.statements.length - 1],
          source,
        );
      }
      return stmt.thenBranch.span ? stmt.thenBranch.span.end.offset : stmt.span.end.offset;
    }
  } else if (stmt.kind === "WhileStmt" || stmt.kind === "ForStmt") {
    if (stmt.body?.statements && stmt.body.statements.length > 0) {
      return getStatementEndOffset(stmt.body.statements[stmt.body.statements.length - 1], source);
    }
    return stmt.body?.span ? stmt.body.span.end.offset : stmt.span.end.offset;
  } else if (stmt.kind === "TryStmt") {
    if (stmt.finallyBlock) {
      if (stmt.finallyBlock.statements && stmt.finallyBlock.statements.length > 0) {
        return getStatementEndOffset(
          stmt.finallyBlock.statements[stmt.finallyBlock.statements.length - 1],
          source,
        );
      }
      return stmt.finallyBlock.span.end.offset;
    }
    if (stmt.catchBlock) {
      if (stmt.catchBlock.statements && stmt.catchBlock.statements.length > 0) {
        return getStatementEndOffset(
          stmt.catchBlock.statements[stmt.catchBlock.statements.length - 1],
          source,
        );
      }
      return stmt.catchBlock.span.end.offset;
    }
    if (stmt.tryBlock) {
      if (stmt.tryBlock.statements && stmt.tryBlock.statements.length > 0) {
        return getStatementEndOffset(
          stmt.tryBlock.statements[stmt.tryBlock.statements.length - 1],
          source,
        );
      }
      return stmt.tryBlock.span.end.offset;
    }
  } else if (stmt.kind === "MatchStmt") {
    if (stmt.cases && stmt.cases.length > 0) {
      const lastCase = stmt.cases[stmt.cases.length - 1];
      if (lastCase.body) {
        if (lastCase.body.kind === "Block" && lastCase.body.statements.length > 0) {
          return getStatementEndOffset(
            lastCase.body.statements[lastCase.body.statements.length - 1],
            source,
          );
        }
        return lastCase.body.span.end.offset;
      }
    }
  }
  return stmt.span.end.offset;
}

export type SpliceNode =
  | ModuleItem
  | MethodDecl
  | PropertyDecl
  | FieldDecl
  | EnumVariantDecl
  | Statement;

/**
 * Finds the accurate character end offset of an AST node.
 */
export function getNodeEndOffset(node: SpliceNode, source: string): number {
  const nodeKind = (node as { kind?: string }).kind;

  if (nodeKind === "FunctionDecl" || nodeKind === "MethodDecl") {
    const fnNode = node as FunctionDecl | MethodDecl;
    if (fnNode.isExpressionBodied && fnNode.body) {
      return fnNode.body.span.end.offset;
    }
    const block = fnNode.body as Block;
    if (block?.statements && block.statements.length > 0) {
      return getStatementEndOffset(block.statements[block.statements.length - 1], source);
    }
    if (block?.span) {
      // Empty block or 'pass' / '...'
      const passNewline = source.indexOf("\n", block.span.start.offset);
      return passNewline === -1 ? source.length : passNewline;
    }
    return node.span.end.offset;
  }

  if (nodeKind === "ClassDecl") {
    const clsNode = node as ClassDecl;
    const members: SpliceNode[] = [...(clsNode.properties || []), ...(clsNode.methods || [])];
    if (members.length > 0) {
      members.sort((a, b) => a.span.start.offset - b.span.start.offset);
      const last = members[members.length - 1];
      return getNodeEndOffset(last, source);
    }
    return node.span.end.offset;
  }

  if (nodeKind === "TypeDecl") {
    const typeNode = node as TypeDecl;
    if (typeNode.fields && typeNode.fields.length > 0) {
      return typeNode.fields[typeNode.fields.length - 1].span.end.offset;
    }
    if (typeNode.variants && typeNode.variants.length > 0) {
      return typeNode.variants[typeNode.variants.length - 1].span.end.offset;
    }
    if (typeNode.aliasType) {
      return typeNode.aliasType.span.end.offset;
    }
    return node.span.end.offset;
  }

  const valExpr = (node as { value?: { span?: { end: { offset: number } } } }).value;
  if (valExpr?.span) {
    return valExpr.span.end.offset;
  }

  return node.span.end.offset;
}

/**
 * Safely resolves the end of the line containing endOffset.
 */
export function getLineEnd(source: string, endOffset: number): number {
  if (endOffset >= source.length) return source.length;
  // If endOffset is after a newline (e.g. span included \n)
  if (endOffset > 0 && source[endOffset - 1] === "\n") {
    return source[endOffset - 2] === "\r" ? endOffset - 2 : endOffset - 1;
  }
  // If endOffset is currently at \r\n or \n
  if (source[endOffset] === "\r" && source[endOffset + 1] === "\n") {
    return endOffset;
  }
  if (source[endOffset] === "\n") {
    return endOffset;
  }
  // Otherwise find next newline on this line
  const idx = source.indexOf("\n", endOffset);
  if (idx === -1) return source.length;
  return source[idx - 1] === "\r" ? idx - 1 : idx;
}

/**
 * Dedents multi-line string by stripping common leading indentation.
 */
export function dedentCode(code: string): string {
  const lines = code.split(/\r?\n/);
  let minIndent = Infinity;
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    const match = line.match(/^[ \t]*/);
    const ind = match ? match[0].length : 0;
    if (ind < minIndent) minIndent = ind;
  }
  if (minIndent === Infinity || minIndent === 0) return code;
  return lines.map((line) => (line.trim().length === 0 ? "" : line.slice(minIndent))).join("\n");
}

/**
 * Formats a code snippet with the specified base indentation.
 */
export function indentCode(code: string, targetIndent: string): string {
  const dedented = dedentCode(code);
  const lines = dedented.split(/\r?\n/);
  return lines.map((line) => (line.trim().length === 0 ? "" : `${targetIndent}${line}`)).join("\n");
}

/**
 * Generates a unified diff between oldText and newText.
 */
export function generateUnifiedDiff(
  filePath: string,
  oldText: string,
  newText: string,
  context = 3,
): string {
  const oldLines = oldText.split(/\r?\n/);
  const newLines = newText.split(/\r?\n/);

  const m = oldLines.length;
  const n = newLines.length;
  const dp = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      if (oldLines[i] === newLines[j]) {
        dp[i + 1][j + 1] = dp[i][j] + 1;
      } else {
        dp[i + 1][j + 1] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const edits: { type: "common" | "add" | "del"; line: string; oldIdx: number; newIdx: number }[] =
    [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      edits.push({ type: "common", line: oldLines[i - 1], oldIdx: i, newIdx: j });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      edits.push({ type: "add", line: newLines[j - 1], oldIdx: i, newIdx: j });
      j--;
    } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
      edits.push({ type: "del", line: oldLines[i - 1], oldIdx: i, newIdx: j });
      i--;
    }
  }
  edits.reverse();

  if (edits.every((e) => e.type === "common")) return "";

  const changeIndices: number[] = [];
  for (let k = 0; k < edits.length; k++) {
    if (edits[k].type !== "common") changeIndices.push(k);
  }

  if (changeIndices.length === 0) return "";

  const diffHunks: (typeof edits)[] = [];
  let hunkStart = Math.max(0, changeIndices[0] - context);
  let hunkEnd = Math.min(edits.length, changeIndices[0] + context + 1);

  for (let c = 1; c < changeIndices.length; c++) {
    const idx = changeIndices[c];
    if (idx - context <= hunkEnd) {
      hunkEnd = Math.min(edits.length, idx + context + 1);
    } else {
      diffHunks.push(edits.slice(hunkStart, hunkEnd));
      hunkStart = Math.max(0, idx - context);
      hunkEnd = Math.min(edits.length, idx + context + 1);
    }
  }
  diffHunks.push(edits.slice(hunkStart, hunkEnd));

  const rel = filePath.replace(/\\/g, "/");
  const result: string[] = [`--- a/${rel}`, `+++ b/${rel}`];

  for (const hunk of diffHunks) {
    let oldStart = 0;
    let oldCount = 0;
    let newStart = 0;
    let newCount = 0;
    for (const e of hunk) {
      if (e.type === "common") {
        if (oldStart === 0) oldStart = e.oldIdx;
        if (newStart === 0) newStart = e.newIdx;
        oldCount++;
        newCount++;
      } else if (e.type === "del") {
        if (oldStart === 0) oldStart = e.oldIdx;
        oldCount++;
      } else if (e.type === "add") {
        if (newStart === 0) newStart = e.newIdx;
        newCount++;
      }
    }
    result.push(`@@ -${oldStart || 1},${oldCount} +${newStart || 1},${newCount} @@`);
    for (const e of hunk) {
      if (e.type === "common") result.push(` ${e.line}`);
      else if (e.type === "del") result.push(`-${e.line}`);
      else if (e.type === "add") result.push(`+${e.line}`);
    }
  }

  return result.join("\n");
}

/**
 * Pure in-memory AST surgical splice implementation.
 */
export function spliceSource(
  source: string,
  optionsOrSymbol: SpliceOptions | string,
  filePathOrCode: string = "source.aice",
  deleteFlag?: boolean,
  maybeFilePath?: string,
  maybeIdioms?: Record<string, ProjectIdiomDefinition>,
  extraOptions?: Partial<SpliceOptions> & { bodyOnly?: boolean },
): SpliceResult {
  let options: SpliceOptions;
  let filePath: string;
  const idioms: Record<string, ProjectIdiomDefinition> | undefined = maybeIdioms;

  if (typeof optionsOrSymbol === "string") {
    const codeStr = filePathOrCode;
    const isBodyOnly = Boolean(extraOptions?.bodyOnly);
    options = {
      ...extraOptions,
      symbol: optionsOrSymbol || extraOptions?.symbol,
      ...(isBodyOnly ? { body: codeStr } : { code: codeStr }),
      delete: Boolean(deleteFlag ?? extraOptions?.delete),
    };
    filePath = maybeFilePath || "source.aice";
  } else {
    options = optionsOrSymbol;
    filePath = filePathOrCode || "source.aice";
  }

  const ext = path.extname(filePath).toLowerCase();
  if (!filePath.endsWith(".aice") && KNOWN_TARGET_EXTENSIONS.has(ext)) {
    return spliceNativeSource(source, options, filePath, idioms);
  }

  if (options.edits && options.edits.length > 0) {
    let currentCode = source;
    const editedSymbols: string[] = [];
    for (const edit of options.edits) {
      const editCode =
        edit.code ?? edit.aice ?? edit.template ?? edit.snippet ?? edit.content ?? edit.replacement;
      const singleRes = spliceSource(
        currentCode,
        {
          ...options,
          edits: undefined,
          symbol: edit.symbol,
          code: editCode,
          body: edit.body,
          delete: edit.delete,
          insertAfter: edit.insertAfter ?? edit.insert_after,
          insertBefore: edit.insertBefore ?? edit.insert_before,
        },
        filePath,
        undefined,
        undefined,
        idioms,
      );
      currentCode = singleRes.modifiedCode;
      editedSymbols.push(edit.symbol);
    }
    const diff = options.diff ? generateUnifiedDiff(filePath, source, currentCode) : undefined;
    return {
      success: true,
      filePath,
      symbol: editedSymbols.join(", "),
      diff,
      modifiedCode: currentCode,
      newAiceSource: currentCode,
      tokensSaved: Math.max(
        0,
        estimateTokens(currentCode) - estimateTokens(JSON.stringify(options.edits)),
      ),
    };
  }

  const { ast } = parseWithTrivia(source, filePath);

  let modifiedCode = source;
  let originalSnippet: string | undefined;
  let newSnippet: string | undefined;
  const targetSymbol = options.symbol;

  // Case 1: Append to module or class
  if (options.append) {
    if (targetSymbol) {
      const symInfo = findSpliceTargetSymbol(ast, targetSymbol);
      if (!symInfo) {
        throw new Error(`Symbol '${targetSymbol}' not found for append target in ${filePath}`);
      }
      if (symInfo.kind !== "class" && symInfo.kind !== "type" && symInfo.kind !== "enum") {
        throw new Error(
          `Cannot append to symbol '${targetSymbol}' of kind '${symInfo.kind}' (expected class, type, or enum)`,
        );
      }
      const rawCode = options.code ?? options.body ?? "";
      const classIndent = "  ";
      const formattedSnippet = indentCode(rawCode, classIndent);
      newSnippet = formattedSnippet;

      // Find the insertion point at the end of class/type body
      const endOffset = getNodeEndOffset(symInfo.node, source);
      const lineEnd = getLineEnd(source, endOffset);

      let insertPos = lineEnd;
      if (source[insertPos] === "\r" && source[insertPos + 1] === "\n") insertPos += 2;
      else if (source[insertPos] === "\n") insertPos += 1;

      modifiedCode = `${source.slice(0, insertPos)}\n${formattedSnippet}\n${source.slice(insertPos)}`;
    } else {
      // Append to end of module
      const rawCode = options.code ?? options.body ?? "";
      const formattedSnippet = dedentCode(rawCode).trim();
      newSnippet = formattedSnippet;
      const trimmedSource = source.trimEnd();
      modifiedCode = `${trimmedSource}\n\n${formattedSnippet}\n`;
    }
  }
  // Case 2: Insert after a symbol
  else if (options.insertAfter) {
    const symInfo = findSpliceTargetSymbol(ast, options.insertAfter);
    if (!symInfo) {
      throw new Error(`Symbol '${options.insertAfter}' not found for insertAfter in ${filePath}`);
    }
    const endOffset = getNodeEndOffset(symInfo.node, source);
    const lineEnd = getLineEnd(source, endOffset);

    // Detect indentation of the target symbol line
    const targetLineStart = source.lastIndexOf("\n", symInfo.node.span.start.offset - 1) + 1;
    const targetIndent = source.slice(targetLineStart).match(/^[ \t]*/)?.[0] || "";

    const rawCode = options.code ?? options.body ?? "";
    const formattedSnippet = indentCode(rawCode, targetIndent);
    newSnippet = formattedSnippet;

    let insertPos = lineEnd;
    if (source[insertPos] === "\r" && source[insertPos + 1] === "\n") insertPos += 2;
    else if (source[insertPos] === "\n") insertPos += 1;

    // Check if there is already an empty line after the symbol
    let hasBlankLine = false;
    if (source.slice(insertPos).startsWith("\r\n")) {
      insertPos += 2;
      hasBlankLine = true;
    } else if (source.slice(insertPos).startsWith("\n")) {
      insertPos += 1;
      hasBlankLine = true;
    }

    const separator = symInfo.kind === "property" || symInfo.kind === "field" ? "\n" : "\n\n";
    if (hasBlankLine) {
      modifiedCode = `${source.slice(0, insertPos)}${formattedSnippet}\n\n${source.slice(insertPos)}`;
    } else {
      modifiedCode = `${source.slice(0, insertPos)}${formattedSnippet}${separator}${source.slice(insertPos)}`;
    }
  }
  // Case 3: Insert before a symbol
  else if (options.insertBefore) {
    const symInfo = findSpliceTargetSymbol(ast, options.insertBefore);
    if (!symInfo) {
      throw new Error(`Symbol '${options.insertBefore}' not found for insertBefore in ${filePath}`);
    }
    // Find lineStart of the symbol
    let lineStart = source.lastIndexOf("\n", symInfo.node.span.start.offset - 1) + 1;

    // Check if docstring immediately precedes
    let checkPos = lineStart - 1;
    while (checkPos > 0) {
      const prevLineStart = source.lastIndexOf("\n", checkPos - 1) + 1;
      const prevLine = source.slice(prevLineStart, checkPos).trim();
      if (prevLine.startsWith("///") || prevLine.startsWith("/*") || prevLine.startsWith("#")) {
        lineStart = prevLineStart;
        checkPos = prevLineStart - 1;
      } else {
        break;
      }
    }

    const targetIndent = source.slice(lineStart).match(/^[ \t]*/)?.[0] || "";
    const rawCode = options.code ?? options.body ?? "";
    const formattedSnippet = indentCode(rawCode, targetIndent);
    newSnippet = formattedSnippet;

    const separator = symInfo.kind === "property" || symInfo.kind === "field" ? "\n" : "\n\n";
    modifiedCode = `${source.slice(0, lineStart)}${formattedSnippet}${separator}${source.slice(lineStart)}`;
  }
  // Case 4: Delete target symbol
  else if (options.delete) {
    if (!targetSymbol) {
      throw new Error("Must specify target symbol with --symbol when deleting");
    }
    const symInfo = findSpliceTargetSymbol(ast, targetSymbol);
    if (!symInfo) {
      throw new Error(`Symbol '${targetSymbol}' not found in ${filePath}${didYouMeanSymbol(source, targetSymbol)}`);
    }

    // Determine declaration lineStart
    let lineStart = source.lastIndexOf("\n", symInfo.node.span.start.offset - 1) + 1;

    // Also include directly attached docstring if present
    let checkPos = lineStart - 1;
    while (checkPos > 0) {
      const prevLineStart = source.lastIndexOf("\n", checkPos - 1) + 1;
      const prevLine = source.slice(prevLineStart, checkPos).trim();
      if (prevLine.startsWith("///") || prevLine.startsWith("/*") || prevLine.startsWith("#")) {
        lineStart = prevLineStart;
        checkPos = prevLineStart - 1;
      } else {
        break;
      }
    }

    const endOffset = getNodeEndOffset(symInfo.node, source);
    const lineEnd = getLineEnd(source, endOffset);

    let delEnd = lineEnd;
    if (source[delEnd] === "\r" && source[delEnd + 1] === "\n") {
      delEnd += 2;
    } else if (source[delEnd] === "\n") {
      delEnd += 1;
    }

    // If there's an adjacent empty line, absorb one empty line
    if (source.slice(delEnd).startsWith("\r\n")) {
      delEnd += 2;
    } else if (source.slice(delEnd).startsWith("\n")) {
      delEnd += 1;
    }

    originalSnippet = source.slice(lineStart, lineEnd).trim();
    newSnippet = "";
    modifiedCode = `${source.slice(0, lineStart)}${source.slice(delEnd)}`;
  }
  // Case 5: Replace Body Only
  else if (options.body !== undefined) {
    if (!targetSymbol) {
      throw new Error("Must specify target symbol with --symbol when replacing body");
    }
    const symInfo = findSpliceTargetSymbol(ast, targetSymbol);
    if (!symInfo) {
      throw new Error(`Symbol '${targetSymbol}' not found in ${filePath}${didYouMeanSymbol(source, targetSymbol)}`);
    }
    if (symInfo.kind !== "function" && symInfo.kind !== "method") {
      throw new Error(
        `Cannot replace body of symbol '${targetSymbol}' of kind '${symInfo.kind}' (only function and method support --body)`,
      );
    }

    const fnNode = symInfo.node as FunctionDecl | MethodDecl;
    const declLineStart = source.lastIndexOf("\n", fnNode.span.start.offset - 1) + 1;
    const declIndent = source.slice(declLineStart).match(/^[ \t]*/)?.[0] || "";
    const bodyIndent = `${declIndent}  `;

    if (fnNode.isExpressionBodied && fnNode.body) {
      const bStart = fnNode.body.span.start.offset;
      const bEnd = fnNode.body.span.end.offset;
      originalSnippet = source.slice(bStart, bEnd);
      const formattedSnippet = options.body.trim();
      newSnippet = formattedSnippet;
      modifiedCode = `${source.slice(0, bStart)}${formattedSnippet}${source.slice(bEnd)}`;
    } else {
      // Block body: replace all statements while preserving signature line
      const colonOffset = source.indexOf(":", fnNode.span.start.offset);
      const afterColonNewline = source.indexOf("\n", colonOffset) + 1;

      const bodyEndOffset = getNodeEndOffset(fnNode, source);
      const bodyLineEnd = getLineEnd(source, bodyEndOffset);

      originalSnippet = source.slice(afterColonNewline, bodyLineEnd).trim();
      const formattedSnippet = indentCode(options.body, bodyIndent);
      newSnippet = formattedSnippet;

      modifiedCode = `${source.slice(0, afterColonNewline)}${formattedSnippet}${source.slice(bodyLineEnd)}`;
    }
  }
  // Case 6: Replace Entire Declaration with Code
  else if (options.code !== undefined) {
    if (!targetSymbol) {
      throw new Error("Must specify target symbol with --symbol when replacing code");
    }
    const symInfo = findSpliceTargetSymbol(ast, targetSymbol);
    if (!symInfo) {
      throw new Error(`Symbol '${targetSymbol}' not found in ${filePath}${didYouMeanSymbol(source, targetSymbol)}`);
    }

    // Determine declaration lineStart
    const lineStart = source.lastIndexOf("\n", symInfo.node.span.start.offset - 1) + 1;
    const declIndent = source.slice(lineStart).match(/^[ \t]*/)?.[0] || "";

    const endOffset = getNodeEndOffset(symInfo.node, source);
    const lineEnd = getLineEnd(source, endOffset);

    originalSnippet = source.slice(lineStart, lineEnd).trim();
    const formattedSnippet = indentCode(options.code, declIndent);
    newSnippet = formattedSnippet;

    modifiedCode = `${source.slice(0, lineStart)}${formattedSnippet}${source.slice(lineEnd)}`;
  } else {
    throw new Error(
      "No valid splice action specified: provide --code, --body, --delete, --insert-after, --insert-before, or --append",
    );
  }

  // Generate unified diff if requested
  let diff: string | undefined;
  if (options.diff) {
    diff = generateUnifiedDiff(filePath, source, modifiedCode);
  }

  // Calculate tokens saved
  const snippetTokens = estimateTokens(newSnippet || options.code || options.body || "");
  const modifiedTokens = estimateTokens(modifiedCode);
  const tokensSaved = Math.max(0, modifiedTokens - snippetTokens);

  return {
    success: true,
    filePath,
    symbol: targetSymbol,
    originalSnippet,
    newSnippet,
    diff,
    modifiedCode,
    newAiceSource: modifiedCode,
    tokensSaved,
  };
}

export interface NativeSpanInfo {
  declStart: number;
  fullDeclStart?: number;
  propsDeclStart?: number;
  propsFullDeclStart?: number;
  declEnd: number;
  startOffset?: number;
  endOffset?: number;
  startLine?: number;
  endLine?: number;
  tokenStart: number;
  declIndent: string;
  className?: string;
  memberName: string;
  visibility?: "public" | "private" | "protected";
  isExported?: boolean;
  isStatic?: boolean;
  isAsync?: boolean;
  accessor?: "get" | "set";
  goReceiver?: string;
  cppOutOfLine?: boolean;
  isClassContainer?: boolean;
  origHeader?: string;
}

function getTsMemberName(member: ts.Node, sf: ts.SourceFile): string | undefined {
  if (ts.isConstructorDeclaration(member)) {
    return "constructor";
  }
  const named = member as { name?: ts.PropertyName };
  if (!named.name) return undefined;
  if (
    ts.isIdentifier(named.name) ||
    ts.isStringLiteral(named.name) ||
    ts.isNumericLiteral(named.name)
  ) {
    return named.name.text;
  }
  return named.name.getText(sf);
}

function getPostDecoratorTokenStart(
  node: ts.Node,
  sf: ts.SourceFile,
  nativeSource: string,
): number {
  const rawStart = node.getStart(sf, false);
  const modifiers = (node as { modifiers?: ts.NodeArray<ts.ModifierLike> }).modifiers;
  if (!modifiers || modifiers.length === 0) return rawStart;

  const decorators = modifiers.filter((m) => ts.isDecorator(m));
  if (decorators.length === 0) return rawStart;

  const firstNonDecorator = modifiers.find((m) => !ts.isDecorator(m));
  if (firstNonDecorator) {
    return firstNonDecorator.getStart(sf, false);
  }

  const lastDecorator = decorators[decorators.length - 1];
  let pos = lastDecorator.getEnd();
  while (pos < nativeSource.length && /\s/.test(nativeSource[pos])) {
    pos++;
  }
  return pos;
}

function extractTsModifiersMeta(
  node: ts.Node,
  sf: ts.SourceFile,
  postDecoratorStart?: number,
): {
  visibility?: "public" | "private" | "protected";
  isExported?: boolean;
  isStatic?: boolean;
  isAsync?: boolean;
  accessor?: "get" | "set";
  isClassContainer?: boolean;
} {
  const start = postDecoratorStart ?? node.getStart(sf, false);
  const headerText = sf.text.slice(start, Math.min(node.getEnd(), start + 120));
  let visibility: "public" | "private" | "protected" | undefined;
  if (/^(?:export\s+)?public\b/.test(headerText)) visibility = "public";
  else if (/^(?:export\s+)?private\b/.test(headerText)) visibility = "private";
  else if (/^(?:export\s+)?protected\b/.test(headerText)) visibility = "protected";

  const isExported = /^export\b/.test(headerText);
  const isStatic = /\bstatic\b/.test(headerText);
  const isAsync = /\basync\b/.test(headerText);
  const accessor = ts.isGetAccessorDeclaration(node)
    ? "get"
    : ts.isSetAccessorDeclaration(node)
      ? "set"
      : undefined;
  const isClassContainer = ts.isClassDeclaration(node);
  return { visibility, isExported, isStatic, isAsync, accessor, isClassContainer };
}

function buildSpanInfoFromTsNode(
  targetNode: ts.Node,
  sf: ts.SourceFile,
  nativeSource: string,
  memberName: string,
  className?: string,
): NativeSpanInfo {
  const rawTokenStart = targetNode.getStart(sf, true);
  const rawLineStart = nativeSource.lastIndexOf("\n", rawTokenStart - 1) + 1;
  const rawLeading = nativeSource.slice(rawLineStart, rawTokenStart);
  const fullDeclStart = /^[ \t]*$/.test(rawLeading) ? rawLineStart : rawTokenStart;

  const tokenStart = getPostDecoratorTokenStart(targetNode, sf, nativeSource);
  const lineStart = nativeSource.lastIndexOf("\n", tokenStart - 1) + 1;
  const leadingSlice = nativeSource.slice(lineStart, tokenStart);
  const isOnlyWs = /^[ \t]*$/.test(leadingSlice);
  const declStart = isOnlyWs ? lineStart : tokenStart;
  const declIndent = isOnlyWs
    ? leadingSlice
    : (nativeSource.slice(lineStart).match(/^[ \t]*/)?.[0] ?? "");
  const declEnd = targetNode.getEnd();
  const meta = extractTsModifiersMeta(targetNode, sf, tokenStart);

  return {
    declStart,
    fullDeclStart,
    declEnd,
    tokenStart,
    declIndent,
    className,
    memberName,
    ...meta,
  };
}

function selectBestTsMember(
  matchingMembers: ts.ClassElement[],
  preferAccessor?: "get" | "set",
  preferredArity?: number,
): ts.ClassElement {
  if (preferAccessor === "get") {
    const getter = matchingMembers.find((m) => ts.isGetAccessorDeclaration(m));
    if (getter) return getter;
  } else if (preferAccessor === "set") {
    const setter = matchingMembers.find((m) => ts.isSetAccessorDeclaration(m));
    if (setter) return setter;
  }
  const withBody = matchingMembers.filter((m) => (m as { body?: unknown }).body !== undefined);
  const pool = withBody.length > 0 ? withBody : matchingMembers;
  if (preferredArity !== undefined && pool.length > 1) {
    const arityMatch = pool.find(
      (m) =>
        (ts.isMethodDeclaration(m) || ts.isConstructorDeclaration(m)) &&
        m.parameters.length === preferredArity,
    );
    if (arityMatch) return arityMatch;
  }
  return pool[0] ?? matchingMembers[matchingMembers.length - 1];
}

export interface NativeTestBlockInfo {
  runnerKind: "describe" | "test" | "it";
  outlineKind: "describe" | "test";
  title: string;
  startLine: number;
  endLine: number;
  startOffset: number;
  endOffset: number;
  indent: string;
  spanInfo: NativeSpanInfo;
}

function getTestRunnerRootKind(expr: ts.Expression): "describe" | "test" | "it" | undefined {
  let cur: ts.Expression = expr;
  while (
    ts.isCallExpression(cur) ||
    ts.isTaggedTemplateExpression(cur) ||
    ts.isPropertyAccessExpression(cur)
  ) {
    if (ts.isCallExpression(cur) || ts.isPropertyAccessExpression(cur)) {
      cur = cur.expression;
    } else {
      cur = cur.tag;
    }
  }
  if (ts.isIdentifier(cur)) {
    if (cur.text === "describe" || cur.text === "test" || cur.text === "it") {
      return cur.text;
    }
  }
  return undefined;
}

const TS_SOURCE_FILE_CACHE = new Map<string, ts.SourceFile>();

function getCachedTsSourceFile(nativeSource: string): ts.SourceFile {
  const cached = TS_SOURCE_FILE_CACHE.get(nativeSource);
  if (cached) {
    TS_SOURCE_FILE_CACHE.delete(nativeSource);
    TS_SOURCE_FILE_CACHE.set(nativeSource, cached);
    return cached;
  }
  const sf = ts.createSourceFile(
    "file.tsx",
    nativeSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  if (nativeSource.length <= 2_000_000) {
    if (TS_SOURCE_FILE_CACHE.size >= 8) {
      const oldestKey = TS_SOURCE_FILE_CACHE.keys().next().value;
      if (oldestKey !== undefined) {
        TS_SOURCE_FILE_CACHE.delete(oldestKey);
      }
    }
    TS_SOURCE_FILE_CACHE.set(nativeSource, sf);
  }
  return sf;
}

export function extractNativeTestBlocks(nativeSource: string): NativeTestBlockInfo[] {
  const results: NativeTestBlockInfo[] = [];
  let sf: ts.SourceFile;
  try {
    sf = getCachedTsSourceFile(nativeSource);
  } catch {
    return results;
  }

  const visit = (node: ts.Node): void => {
    if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)) {
      const callExpr = node.expression;
      const runnerKind = getTestRunnerRootKind(callExpr.expression);
      if (runnerKind && callExpr.arguments.length >= 1) {
        const arg0 = callExpr.arguments[0];
        let title: string | undefined;
        if (ts.isStringLiteral(arg0) || ts.isNoSubstitutionTemplateLiteral(arg0)) {
          title = arg0.text;
        } else if (ts.isTemplateExpression(arg0)) {
          const rawText = arg0.getText(sf);
          title = rawText.length >= 2 ? rawText.slice(1, -1) : rawText;
        }
        if (title !== undefined && title.trim().length > 0) {
          const rawSpan = buildSpanInfoFromTsNode(node, sf, nativeSource, title, undefined);
          const spanInfo = enrichSpanWithOffsetsAndLines(nativeSource, rawSpan);
          if (spanInfo && spanInfo.startLine !== undefined && spanInfo.endLine !== undefined) {
            results.push({
              runnerKind,
              outlineKind: runnerKind === "describe" ? "describe" : "test",
              title,
              startLine: spanInfo.startLine,
              endLine: spanInfo.endLine,
              startOffset: spanInfo.declStart,
              endOffset: spanInfo.declEnd,
              indent: spanInfo.declIndent,
              spanInfo,
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sf);
  return results;
}

export function matchNativeTestBlockSpan(
  nativeSource: string,
  rawSelector: string,
  strictForSplice = false,
): NativeSpanInfo | undefined {
  const rawTrimmed = rawSelector.trim();
  if (!rawTrimmed) return undefined;
  const rawUnquoted = rawTrimmed.replace(/^["'`]|["'`]$/g, "").trim();
  if (!rawUnquoted) return undefined;

  const blocks = extractNativeTestBlocks(nativeSource);
  if (blocks.length === 0) return undefined;

  const directExact =
    blocks.find((b) => b.title === rawUnquoted) ??
    blocks.find((b) => `${b.outlineKind} "${b.title}"` === rawTrimmed) ??
    blocks.find((b) => `${b.runnerKind} "${b.title}"` === rawTrimmed) ??
    blocks.find((b) => b.title.toLowerCase() === rawUnquoted.toLowerCase());
  if (directExact) return directExact.spanInfo;

  const hasExplicitRunnerPrefix = /^(?:describe|test|it)\s+/i.test(rawTrimmed);
  const q = rawTrimmed
    .replace(/^(?:describe|test|it)\s+/i, "")
    .trim()
    .replace(/^["'`]|["'`]$/g, "")
    .trim();
  if (!q) return undefined;

  const lowerQ = q.toLowerCase();
  const exact =
    blocks.find((b) => b.title === q) ?? blocks.find((b) => b.title.toLowerCase() === lowerQ);
  if (exact) return exact.spanInfo;

  const delimitedPrefixMatches = blocks.filter((b) => {
    if (!b.title.toLowerCase().startsWith(lowerQ)) return false;
    const nextChar = b.title[q.length];
    return nextChar === ":" || nextChar === " " || nextChar === "-" || nextChar === ".";
  });
  if (delimitedPrefixMatches.length > 0) {
    const exactCaseMatches = delimitedPrefixMatches.filter((b) => b.title.startsWith(q));
    const chosenPool = exactCaseMatches.length > 0 ? exactCaseMatches : delimitedPrefixMatches;
    if (chosenPool.length > 1 && strictForSplice) {
      throw new Error(
        `Ambiguous test selector '${rawSelector}' matches ${chosenPool.length} test blocks (${chosenPool
          .slice(0, 3)
          .map((b) => `"${b.title}"`)
          .join(", ")}). Provide a more specific test title.`,
      );
    }
    return chosenPool[0]?.spanInfo;
  }

  const startsWithMatches = blocks.filter((b) => b.title.toLowerCase().startsWith(lowerQ));
  if (q.length >= 4 || hasExplicitRunnerPrefix || /\s/.test(q)) {
    if (startsWithMatches.length > 1 && strictForSplice) {
      throw new Error(
        `Ambiguous test selector '${rawSelector}' matches ${startsWithMatches.length} test blocks (${startsWithMatches
          .slice(0, 3)
          .map((b) => `"${b.title}"`)
          .join(", ")}). Provide a more specific test title.`,
      );
    }
    if (startsWithMatches.length === 1) {
      return startsWithMatches[0].spanInfo;
    }
  }

  if (hasExplicitRunnerPrefix || /\s/.test(q) || /[-_:]/.test(q)) {
    const substrMatches = blocks.filter((b) => b.title.toLowerCase().includes(lowerQ));
    if (substrMatches.length > 1 && strictForSplice) {
      throw new Error(
        `Ambiguous test selector '${rawSelector}' matches ${substrMatches.length} test blocks (${substrMatches
          .slice(0, 3)
          .map((b) => `"${b.title}"`)
          .join(", ")}). Provide a more specific test title.`,
      );
    }
    if (substrMatches.length === 1) {
      return substrMatches[0].spanInfo;
    }
  }

  return undefined;
}

export interface ScriptOrMarkdownSymbolInfo {
  kind: "function" | "label" | "section";
  name: string;
  displaySignature: string;
  startLine: number;
  endLine: number;
  startOffset: number;
  endOffset: number;
  indent: string;
  headingLevel?: number;
  rawHeadingLine?: string;
}

export function extractScriptOrMarkdownSymbols(
  source: string,
  targetLang: TargetLanguage,
): ScriptOrMarkdownSymbolInfo[] {
  const lines = source.split(/\r?\n/);
  const lineStarts: number[] = [];
  const lineEnds: number[] = [];
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    lineStarts.push(offset);
    const len = lines[i].length;
    lineEnds.push(offset + len);
    offset += len;
    if (offset < source.length && source[offset] === "\r") offset++;
    if (offset < source.length && source[offset] === "\n") offset++;
  }

  const results: ScriptOrMarkdownSymbolInfo[] = [];

  if (targetLang === "markdown") {
    const rawHeadings: Array<{
      lineIdx: number;
      indent: string;
      level: number;
      hashes: string;
      title: string;
      rawLine: string;
    }> = [];
    let inFence = false;
    let fenceChar = "";
    let fenceLen = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!inFence) {
        const openMatch = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
        if (openMatch && !(openMatch[1][0] === "`" && openMatch[2].includes("`"))) {
          inFence = true;
          fenceChar = openMatch[1][0];
          fenceLen = openMatch[1].length;
          continue;
        }
      } else {
        const closeMatch = line.match(/^\s*(`{3,}|~{3,})\s*$/);
        if (closeMatch && closeMatch[1][0] === fenceChar && closeMatch[1].length >= fenceLen) {
          inFence = false;
          fenceChar = "";
          fenceLen = 0;
        }
        continue;
      }
      const m = line.match(/^(\s*)(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/);
      if (m) {
        rawHeadings.push({
          lineIdx: i,
          indent: m[1],
          level: m[2].length,
          hashes: m[2],
          title: m[3].trim(),
          rawLine: line,
        });
      }
    }
    for (let k = 0; k < rawHeadings.length; k++) {
      const cur = rawHeadings[k];
      let nextEqualOrHigher: (typeof rawHeadings)[number] | undefined;
      for (let j = k + 1; j < rawHeadings.length; j++) {
        if (rawHeadings[j].level <= cur.level) {
          nextEqualOrHigher = rawHeadings[j];
          break;
        }
      }
      const startLine = cur.lineIdx + 1;
      const endLine = nextEqualOrHigher
        ? Math.max(startLine, nextEqualOrHigher.lineIdx)
        : Math.max(startLine, lines.length);
      let lastContentIdx = endLine - 1;
      while (lastContentIdx > cur.lineIdx && lines[lastContentIdx].trim() === "") {
        lastContentIdx--;
      }
      let endOffset = lineEnds[lastContentIdx] ?? source.length;
      if (nextEqualOrHigher && lineStarts[nextEqualOrHigher.lineIdx] !== undefined) {
        endOffset = Math.min(endOffset, lineStarts[nextEqualOrHigher.lineIdx]);
      }
      results.push({
        kind: "section",
        name: cur.title,
        displaySignature: `${cur.hashes} ${cur.title}`,
        startLine,
        endLine,
        startOffset: lineStarts[cur.lineIdx] ?? 0,
        endOffset,
        indent: cur.indent,
        headingLevel: cur.level,
        rawHeadingLine: cur.rawLine,
      });
    }
    return results;
  }

  // Precompute heredoc line mask for shell scripts so inner heredoc lines aren't parsed as top-level symbols
  const heredocMask = new Array<boolean>(lines.length).fill(false);
  if (targetLang === "shell") {
    let activeHeredocDelim: string | null = null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (activeHeredocDelim !== null) {
        heredocMask[i] = true;
        if (line.trim() === activeHeredocDelim) {
          activeHeredocDelim = null;
        }
        continue;
      }
      if (/^\s*#/.test(line)) continue;
      const hdMatch = line.match(/<<-?\s*(?:['"]([^'"]+)['"]|\\?([A-Za-z_][A-Za-z0-9_]*))/);
      if (hdMatch && !line.includes("<<<")) {
        activeHeredocDelim = hdMatch[1] ?? hdMatch[2] ?? null;
      }
    }
  }

  // Extract section banner headers for shell, powershell, and batch (`# ── Section`, `REM ── Section`, `:: ── Section`)
  const rawSections: Array<{ lineIdx: number; indent: string; title: string; rawLine: string }> =
    [];
  for (let i = 0; i < lines.length; i++) {
    if (heredocMask[i]) continue;
    const line = lines[i];
    const secMatch =
      targetLang === "batch"
        ? line.match(
            /^([ \t]*)(?:REM|::)\s*(?:[─━═=-]{2,}\s+)([A-Za-z0-9_][^\r\n─━═=]*?)(?:\s*[─━═=-]+)?\s*$/i,
          )
        : line.match(
            /^([ \t]*)#\s*(?:[─━═=-]{2,}\s+)([A-Za-z0-9_][^\r\n─━═=]*?)(?:\s*[─━═=-]+)?\s*$/,
          );
    if (secMatch) {
      const title = secMatch[2].replace(/\s*[─━═=-]+\s*$/, "").trim();
      if (title && !/^[─━═=-]+$/.test(title)) {
        rawSections.push({
          lineIdx: i,
          indent: secMatch[1],
          title,
          rawLine: line,
        });
      }
    }
  }

  for (let k = 0; k < rawSections.length; k++) {
    const cur = rawSections[k];
    const nextSec = rawSections[k + 1];
    const startLine = cur.lineIdx + 1;
    const endLine = nextSec
      ? Math.max(startLine, nextSec.lineIdx)
      : Math.max(startLine, lines.length);
    let lastContentIdx = endLine - 1;
    while (lastContentIdx > cur.lineIdx && lines[lastContentIdx].trim() === "") {
      lastContentIdx--;
    }
    results.push({
      kind: "section",
      name: cur.title,
      displaySignature: `# ── ${cur.title}`,
      startLine,
      endLine,
      startOffset: lineStarts[cur.lineIdx] ?? 0,
      endOffset: lineEnds[lastContentIdx] ?? source.length,
      indent: cur.indent,
      rawHeadingLine: cur.rawLine,
    });
  }

  if (targetLang === "batch") {
    const rawLabels: Array<{ lineIdx: number; indent: string; name: string }> = [];
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^([ \t]*):([A-Za-z_][A-Za-z0-9_.-]*)\b/);
      if (m && m[2].toLowerCase() !== "eof") {
        rawLabels.push({ lineIdx: i, indent: m[1], name: m[2] });
      }
    }
    for (let k = 0; k < rawLabels.length; k++) {
      const cur = rawLabels[k];
      const nextLabel = rawLabels[k + 1];
      const limitIdx = nextLabel ? nextLabel.lineIdx - 1 : lines.length - 1;
      let endIdx = limitIdx;
      for (let j = cur.lineIdx + 1; j <= limitIdx; j++) {
        if (/^\s*(?:goto\s+:?eof|exit\s+\/b)\b/i.test(lines[j])) {
          endIdx = j;
          break;
        }
      }
      while (endIdx > cur.lineIdx && lines[endIdx].trim() === "") {
        endIdx--;
      }
      results.push({
        kind: "label",
        name: cur.name,
        displaySignature: `:${cur.name}`,
        startLine: cur.lineIdx + 1,
        endLine: endIdx + 1,
        startOffset: lineStarts[cur.lineIdx] ?? 0,
        endOffset: lineEnds[endIdx] ?? source.length,
        indent: cur.indent,
      });
    }
    return results.sort((a, b) => a.startLine - b.startLine);
  }

  // Shell & PowerShell functions
  const shellKeywords = new Set([
    "if",
    "for",
    "while",
    "until",
    "case",
    "select",
    "time",
    "function",
    "do",
    "done",
    "then",
    "else",
    "elif",
    "fi",
  ]);
  for (let i = 0; i < lines.length; i++) {
    if (heredocMask[i]) continue;
    const line = lines[i];
    let indent = "";
    let fnName = "";
    if (targetLang === "powershell") {
      const pm = line.match(
        /^([ \t]*)(?:function|filter)\s+(?:[A-Za-z]+:)?([A-Za-z_][A-Za-z0-9_-]*)\b/i,
      );
      if (pm) {
        indent = pm[1];
        fnName = pm[2];
      }
    } else {
      const sm = line.match(
        /^([ \t]*)(?:function\s+([A-Za-z_][A-Za-z0-9_-]*)\s*(?:\(\s*\))?|([A-Za-z_][A-Za-z0-9_-]*)\s*\(\s*\))\s*(?:\{|$|#)/,
      );
      if (sm) {
        indent = sm[1];
        fnName = sm[2] ?? sm[3] ?? "";
      }
    }
    if (!fnName || shellKeywords.has(fnName)) continue;

    let braceDepth = 0;
    let sawOpen = false;
    let endIdx = i;
    for (let j = i; j < lines.length; j++) {
      if (j > i && heredocMask[j]) continue;
      const scanLine = lines[j];
      let inSingle = false;
      let inDouble = false;
      for (let c = 0; c < scanLine.length; c++) {
        const ch = scanLine[c];
        if (
          (ch === "\\" && (inSingle || inDouble)) ||
          (targetLang === "powershell" && ch === "`" && inDouble)
        ) {
          c++;
          continue;
        }
        if (ch === "'" && !inDouble) {
          inSingle = !inSingle;
          continue;
        }
        if (ch === '"' && !inSingle) {
          inDouble = !inDouble;
          continue;
        }
        if (!inSingle && !inDouble) {
          if (ch === "#" && (c === 0 || /[\s;&|()]/.test(scanLine[c - 1]))) {
            break;
          }
          if (ch === "{") {
            braceDepth++;
            sawOpen = true;
          } else if (ch === "}") {
            braceDepth--;
            if (sawOpen && braceDepth <= 0) {
              endIdx = j;
              break;
            }
          }
        }
      }
      if (sawOpen && braceDepth <= 0) {
        endIdx = j;
        break;
      }
    }

    results.push({
      kind: "function",
      name: fnName,
      displaySignature: `fn ${fnName}()`,
      startLine: i + 1,
      endLine: endIdx + 1,
      startOffset: lineStarts[i] ?? 0,
      endOffset: lineEnds[endIdx] ?? source.length,
      indent,
    });
  }

  return results.sort((a, b) => a.startLine - b.startLine || a.startOffset - b.startOffset);
}

export function locateScriptOrMarkdownSpan(
  source: string,
  rawSelector: string,
  targetLang: TargetLanguage,
  strictForSplice = false,
): NativeSpanInfo | undefined {
  let q = rawSelector.trim();
  if (!q) return undefined;

  const symbols = extractScriptOrMarkdownSymbols(source, targetLang);
  if (symbols.length === 0) return undefined;

  const qClean = q
    .replace(/^#{1,6}\s+/, "")
    .replace(/^["'`]|["'`]$/g, "")
    .trim();
  const directMatch =
    symbols.find((s) => s.name === qClean || s.displaySignature === q) ??
    symbols.find((s) => s.name.toLowerCase() === qClean.toLowerCase());
  if (directMatch) {
    return {
      declStart: directMatch.startOffset,
      fullDeclStart: directMatch.startOffset,
      declEnd: directMatch.endOffset,
      tokenStart: directMatch.startOffset,
      declIndent: directMatch.indent,
      memberName: directMatch.name,
      origHeader: directMatch.rawHeadingLine,
      startLine: directMatch.startLine,
      endLine: directMatch.endLine,
    };
  }

  const levelMatch = q.match(/^(#{1,6})\s+/);
  const explicitLevel = levelMatch ? levelMatch[1].length : undefined;
  q = q
    .replace(/^(?:fn|function|filter|section)\s+/i, "")
    .replace(/\(\s*\)$/, "")
    .replace(/^:+/, "")
    .replace(/^#{1,6}\s+/, "")
    .replace(/^#\s*[─━═=-]+\s*/, "")
    .replace(/\s*[─━═=-]+\s*$/, "")
    .replace(/^["'`]|["'`]$/g, "")
    .trim();
  if (!q) {
    return undefined;
  }
  const lowerQ = q.toLowerCase();
  const levelFiltered = explicitLevel
    ? symbols.filter((s) => s.headingLevel === explicitLevel)
    : symbols;
  const pool = levelFiltered.length > 0 ? levelFiltered : symbols;

  let matched =
    pool.find((s) => s.name === q || s.displaySignature === rawSelector.trim()) ??
    pool.find((s) => s.name.toLowerCase() === lowerQ) ??
    symbols.find((s) => s.name === q || s.displaySignature === rawSelector.trim()) ??
    symbols.find((s) => s.name.toLowerCase() === lowerQ);

  if (!matched) {
    const prefixCandidates = pool.filter((s) => {
      if (strictForSplice && s.kind !== "section") return false;
      if (!s.name.toLowerCase().startsWith(lowerQ)) return false;
      const nextCh = s.name[q.length];
      return (
        nextCh === undefined ||
        nextCh === ":" ||
        nextCh === " " ||
        nextCh === "-" ||
        nextCh === "—" ||
        nextCh === "."
      );
    });
    if (prefixCandidates.length > 0) {
      const exactCase = prefixCandidates.filter((s) => s.name.startsWith(q));
      const candidatePool = exactCase.length > 0 ? exactCase : prefixCandidates;
      if (candidatePool.length > 1 && strictForSplice) {
        throw new Error(
          `Ambiguous section/symbol selector '${rawSelector}' matches ${candidatePool.length} targets (${candidatePool
            .slice(0, 3)
            .map((s) => `'${s.name}'`)
            .join(", ")}). Provide the full heading or symbol name.`,
        );
      }
      matched = candidatePool[0];
    }
  }

  if (!matched && !strictForSplice) {
    const nonH1 = pool.filter((s) => s.headingLevel !== 1);
    matched =
      nonH1.find((s) => s.name.toLowerCase().startsWith(lowerQ)) ??
      pool.find((s) => s.name.toLowerCase().startsWith(lowerQ)) ??
      nonH1.find((s) => s.name.toLowerCase().includes(lowerQ)) ??
      pool.find((s) => s.name.toLowerCase().includes(lowerQ));
  }

  if (!matched) return undefined;

  return {
    declStart: matched.startOffset,
    fullDeclStart: matched.startOffset,
    declEnd: matched.endOffset,
    tokenStart: matched.startOffset,
    declIndent: matched.indent,
    memberName: matched.name,
    origHeader: matched.rawHeadingLine,
    startLine: matched.startLine,
    endLine: matched.endLine,
  };
}

function locateTsDeclarationSpan(
  nativeSource: string,
  symbolSelector: string,
  explicitClassName?: string,
  preferAccessor?: "get" | "set",
  preferredArity?: number,
  strictForSplice = false,
): NativeSpanInfo | undefined {
  const sf = getCachedTsSourceFile(nativeSource);
  const qualMatch = symbolSelector.trim().match(/^([^(]+)\((.*)\)$/);
  const baseSelector = qualMatch ? qualMatch[1].trim() : symbolSelector.trim();
  const explicitArity = qualMatch
    ? qualMatch[2].trim() === ""
      ? 0
      : qualMatch[2].split(",").length
    : preferredArity;

  const parts = baseSelector.split(/\.|::/);
  const className = explicitClassName ?? (parts.length >= 2 ? parts[0] : undefined);
  let memberName = parts.length >= 2 ? parts.slice(1).join(".") : baseSelector;
  let inferredAccessor = preferAccessor;
  if (memberName.startsWith("get:")) {
    inferredAccessor = "get";
    memberName = memberName.slice(4);
  } else if (memberName.startsWith("set:")) {
    inferredAccessor = "set";
    memberName = memberName.slice(4);
  }

  const allStmts: ts.Statement[] = [];
  const collectStmts = (stmts: ts.NodeArray<ts.Statement> | ts.Statement[]) => {
    for (const s of stmts) {
      allStmts.push(s);
      if (ts.isModuleDeclaration(s)) {
        let curBody = s.body;
        while (curBody && ts.isModuleDeclaration(curBody)) {
          curBody = curBody.body;
        }
        if (curBody && ts.isModuleBlock(curBody)) {
          collectStmts(curBody.statements);
        }
      }
    }
  };
  collectStmts(sf.statements);

  if (className) {
    const normClassName = normIdForSpan(className);
    const normMemberName = normIdForSpan(memberName);
    for (const stmt of allStmts) {
      if (
        ts.isClassDeclaration(stmt) &&
        stmt.name?.text &&
        (stmt.name.text === className || normIdForSpan(stmt.name.text) === normClassName)
      ) {
        let matchingMembers = stmt.members.filter((m) => getTsMemberName(m, sf) === memberName);
        if (matchingMembers.length === 0) {
          matchingMembers = stmt.members.filter(
            (m) => normIdForSpan(getTsMemberName(m, sf) ?? "") === normMemberName,
          );
        }
        if (matchingMembers.length > 0) {
          const implMember = selectBestTsMember(matchingMembers, inferredAccessor, explicitArity);
          return buildSpanInfoFromTsNode(implMember, sf, nativeSource, memberName, stmt.name.text);
        }
      } else if (
        ts.isInterfaceDeclaration(stmt) &&
        (stmt.name.text === className || normIdForSpan(stmt.name.text) === normClassName)
      ) {
        const matchingProp =
          stmt.members.find((m) => getTsMemberName(m, sf) === memberName) ??
          stmt.members.find((m) => normIdForSpan(getTsMemberName(m, sf) ?? "") === normMemberName);
        if (matchingProp) {
          return buildSpanInfoFromTsNode(
            matchingProp,
            sf,
            nativeSource,
            memberName,
            stmt.name.text,
          );
        }
      } else if (
        ts.isTypeAliasDeclaration(stmt) &&
        (stmt.name.text === className || normIdForSpan(stmt.name.text) === normClassName) &&
        ts.isTypeLiteralNode(stmt.type)
      ) {
        const matchingProp =
          stmt.type.members.find((m) => getTsMemberName(m, sf) === memberName) ??
          stmt.type.members.find(
            (m) => normIdForSpan(getTsMemberName(m, sf) ?? "") === normMemberName,
          );
        if (matchingProp) {
          return buildSpanInfoFromTsNode(
            matchingProp,
            sf,
            nativeSource,
            memberName,
            stmt.name.text,
          );
        }
      }
    }
    if (explicitClassName) {
      return undefined;
    }
  }

  const matchingTopStmts = allStmts.filter(
    (
      stmt,
    ): stmt is
      | ts.FunctionDeclaration
      | ts.ClassDeclaration
      | ts.InterfaceDeclaration
      | ts.TypeAliasDeclaration
      | ts.EnumDeclaration =>
      (ts.isFunctionDeclaration(stmt) ||
        ts.isClassDeclaration(stmt) ||
        ts.isInterfaceDeclaration(stmt) ||
        ts.isTypeAliasDeclaration(stmt) ||
        ts.isEnumDeclaration(stmt)) &&
      stmt.name?.text === memberName,
  );
  if (matchingTopStmts.length > 0) {
    const implStmt =
      matchingTopStmts.find((s) => "body" in s && s.body !== undefined) ??
      matchingTopStmts[matchingTopStmts.length - 1];
    const spanInfo = buildSpanInfoFromTsNode(implStmt, sf, nativeSource, memberName, undefined);
    if (
      ts.isFunctionDeclaration(implStmt) &&
      implStmt.body &&
      /<[A-Za-z]/.test(implStmt.body.getText(sf))
    ) {
      const stmtIdx = allStmts.indexOf(implStmt);
      if (stmtIdx > 0) {
        const prevStmt = allStmts[stmtIdx - 1];
        if (ts.isInterfaceDeclaration(prevStmt) && prevStmt.name.text === `${memberName}Props`) {
          const prevSpan = buildSpanInfoFromTsNode(
            prevStmt,
            sf,
            nativeSource,
            prevStmt.name.text,
            undefined,
          );
          spanInfo.propsDeclStart = prevSpan.declStart;
          spanInfo.propsFullDeclStart = prevSpan.fullDeclStart;
        }
      }
    }
    return spanInfo;
  }

  for (const stmt of allStmts) {
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.name.text === memberName) {
          return buildSpanInfoFromTsNode(stmt, sf, nativeSource, memberName, undefined);
        }
      }
    }
  }

  if (!className) {
    const classMatches: Array<{ span: NativeSpanInfo; parentName: string }> = [];
    for (const stmt of allStmts) {
      if (ts.isClassDeclaration(stmt)) {
        const parentName = stmt.name?.text;
        const matchingMembers = stmt.members.filter((m) => getTsMemberName(m, sf) === memberName);
        if (matchingMembers.length > 0) {
          const implMember = selectBestTsMember(matchingMembers, inferredAccessor, explicitArity);
          classMatches.push({
            span: buildSpanInfoFromTsNode(implMember, sf, nativeSource, memberName, parentName),
            parentName: parentName ?? "<anonymous>",
          });
        }
      }
    }
    if (classMatches.length > 0) {
      const distinctClasses = new Set(classMatches.map((m) => m.parentName));
      if (distinctClasses.size > 1 && strictForSplice) {
        throw new Error(
          `Ambiguous symbol '${memberName}' found in multiple classes (${Array.from(distinctClasses).join(", ")}). Qualify as '<Class>.${memberName}'.`,
        );
      }
      return classMatches[0].span;
    }
  }

  return matchNativeTestBlockSpan(nativeSource, symbolSelector, strictForSplice);
}

function scanPythonLineState(
  line: string,
  state: { openDelims: number; inTripleQuote: '"""' | "'''" | null },
): void {
  let i = 0;
  const len = line.length;
  while (i < len) {
    if (state.inTripleQuote) {
      const closeIdx = line.indexOf(state.inTripleQuote, i);
      if (closeIdx >= 0) {
        i = closeIdx + 3;
        state.inTripleQuote = null;
        continue;
      }
      return;
    }
    const ch = line[i];
    if (ch === "#") return;
    if (
      (ch === '"' && line[i + 1] === '"' && line[i + 2] === '"') ||
      (ch === "'" && line[i + 1] === "'" && line[i + 2] === "'")
    ) {
      const delim = line.slice(i, i + 3) as '"""' | "'''";
      const closeIdx = line.indexOf(delim, i + 3);
      if (closeIdx >= 0) {
        i = closeIdx + 3;
        continue;
      }
      state.inTripleQuote = delim;
      return;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i++;
      while (i < len && line[i] !== quote) {
        if (line[i] === "\\") i += 2;
        else i++;
      }
      if (i < len) i++;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") {
      state.openDelims++;
    } else if (ch === ")" || ch === "]" || ch === "}") {
      state.openDelims = Math.max(0, state.openDelims - 1);
    }
    i++;
  }
}

function locatePythonDeclarationSpan(
  nativeSource: string,
  symbolSelector: string,
  explicitClassName?: string,
  strictForSplice = false,
): NativeSpanInfo | undefined {
  const parts = symbolSelector.split(/\.|::/);
  const className = explicitClassName ?? (parts.length >= 2 ? parts[0] : undefined);
  const memberName = parts.length >= 2 ? parts.slice(1).join(".") : symbolSelector;
  const escMember = memberName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const lines = nativeSource.split("\n");
  const lineOffsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    lineOffsets.push(offset);
    offset += line.length + 1;
  }

  let searchStartLine = 0;
  let searchEndLine = lines.length;
  let activeClassName = className;

  if (className) {
    const escClass = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const classRegex = new RegExp(`^([ \\t]*)class\\s+${escClass}\\b`);
    let foundClassLine = -1;
    let classIndentLen = 0;
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(classRegex);
      if (m) {
        foundClassLine = i;
        classIndentLen = m[1].length;
        break;
      }
    }
    if (foundClassLine < 0) return undefined;
    searchStartLine = foundClassLine + 1;
    const clsState: { openDelims: number; inTripleQuote: '"""' | "'''" | null } = {
      openDelims: 0,
      inTripleQuote: null,
    };
    scanPythonLineState(lines[foundClassLine], clsState);
    for (let i = searchStartLine; i < lines.length; i++) {
      const wasInside = clsState.openDelims > 0 || clsState.inTripleQuote !== null;
      scanPythonLineState(lines[i], clsState);
      if (wasInside) continue;
      const trimmed = lines[i].trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const ind = lines[i].match(/^[ \t]*/)?.[0].length ?? 0;
      if (ind <= classIndentLen) {
        searchEndLine = i;
        break;
      }
    }
  }

  const pyMemberPattern =
    memberName === "constructor" || memberName === "__init__"
      ? "(?:constructor|__init__)"
      : escMember;
  const defRegex = new RegExp(`^([ \\t]*)(async\\s+)?def\\s+${pyMemberPattern}\\s*\\(`);
  let targetLine = -1;
  let targetIndent = "";
  let isAsync = false;
  let isClassContainer = false;
  let isVarAssign = false;

  if (className) {
    for (let i = searchStartLine; i < searchEndLine; i++) {
      const m = lines[i].match(defRegex);
      if (m) {
        targetLine = i;
        targetIndent = m[1];
        isAsync = Boolean(m[2]);
        break;
      }
    }
  } else {
    const indentedDefMatches: Array<{
      line: number;
      indent: string;
      isAsync: boolean;
      cls?: string;
    }> = [];
    for (let i = searchStartLine; i < searchEndLine; i++) {
      const m = lines[i].match(defRegex);
      if (m) {
        if (m[1].length === 0) {
          targetLine = i;
          targetIndent = "";
          isAsync = Boolean(m[2]);
          activeClassName = undefined;
          break;
        }
        let enclosingCls: string | undefined;
        let nestedInsideDef = false;
        for (let k = i - 1; k >= 0; k--) {
          const prevDef = lines[k].match(/^([ \t]*)(?:async\s+)?def\s+[A-Za-z0-9_]+\s*\(/);
          if (prevDef && prevDef[1].length < m[1].length) {
            nestedInsideDef = true;
            break;
          }
          const cm = lines[k].match(/^([ \t]*)class\s+([A-Za-z0-9_]+)\b/);
          if (cm && cm[1].length < m[1].length) {
            enclosingCls = cm[2];
            break;
          }
        }
        if (!nestedInsideDef && enclosingCls) {
          indentedDefMatches.push({
            line: i,
            indent: m[1],
            isAsync: Boolean(m[2]),
            cls: enclosingCls,
          });
        }
      }
    }
    if (targetLine < 0 && indentedDefMatches.length > 0) {
      const distinctPyClasses = new Set(
        indentedDefMatches.map((m) => m.cls).filter((c): c is string => Boolean(c)),
      );
      if (distinctPyClasses.size > 1 && strictForSplice) {
        throw new Error(
          `Ambiguous symbol '${memberName}' found in multiple classes (${Array.from(distinctPyClasses).join(", ")}). Qualify as '<Class>.${memberName}'.`,
        );
      }
      targetLine = indentedDefMatches[0].line;
      targetIndent = indentedDefMatches[0].indent;
      isAsync = indentedDefMatches[0].isAsync;
      activeClassName = indentedDefMatches[0].cls;
    }
  }

  if (targetLine < 0 && !className) {
    const topClassRegex = new RegExp(`^([ \\t]*)class\\s+${escMember}\\b`);
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(topClassRegex);
      if (m) {
        targetLine = i;
        targetIndent = m[1];
        isClassContainer = true;
        break;
      }
    }
  }

  if (targetLine < 0) {
    const varRegex = new RegExp(`^([ \\t]*)${escMember}\\s*(?::[^\\n=]+(?:=[^\\n]*)?|=(?!=)|$)`);
    for (let i = searchStartLine; i < searchEndLine; i++) {
      const m = lines[i].match(varRegex);
      if (m && (className || m[1].length === 0)) {
        targetLine = i;
        targetIndent = m[1];
        isVarAssign = true;
        break;
      }
    }
  }

  if (targetLine < 0) return undefined;

  let firstDecoratorLine = targetLine;
  let isStatic = false;
  for (let k = targetLine - 1; k >= searchStartLine; k--) {
    const trimmed = lines[k].trim();
    if (trimmed.startsWith("@")) {
      firstDecoratorLine = k;
      if (/^@staticmethod\b/.test(trimmed)) {
        isStatic = true;
      }
    } else if (trimmed === "") {
    } else {
      break;
    }
  }

  let endLine = targetLine;
  const baseIndentLen = targetIndent.length;
  const scanState: { openDelims: number; inTripleQuote: '"""' | "'''" | null } = {
    openDelims: 0,
    inTripleQuote: null,
  };
  scanPythonLineState(lines[targetLine], scanState);

  if (isVarAssign) {
    for (let i = targetLine + 1; i < searchEndLine; i++) {
      if (scanState.openDelims === 0 && scanState.inTripleQuote === null) {
        break;
      }
      scanPythonLineState(lines[i], scanState);
      endLine = i;
    }
  } else {
    for (let i = targetLine + 1; i < searchEndLine; i++) {
      const wasInsideContinuation = scanState.openDelims > 0 || scanState.inTripleQuote !== null;
      scanPythonLineState(lines[i], scanState);
      if (wasInsideContinuation || scanState.inTripleQuote !== null) {
        endLine = i;
        continue;
      }
      const trimmed = lines[i].trim();
      if (!trimmed) continue;
      const ind = lines[i].match(/^[ \t]*/)?.[0].length ?? 0;
      if (ind <= baseIndentLen) {
        break;
      }
      if (!trimmed.startsWith("#")) {
        endLine = i;
      }
    }
  }

  const declStart = lineOffsets[targetLine];
  const fullDeclStart = lineOffsets[firstDecoratorLine];
  const tokenStart = declStart + targetIndent.length;
  const endLineStr = lines[endLine];
  const cleanEndLen = endLineStr.endsWith("\r") ? endLineStr.length - 1 : endLineStr.length;
  const declEnd = lineOffsets[endLine] + cleanEndLen;

  return {
    declStart,
    fullDeclStart,
    declEnd,
    tokenStart,
    declIndent: targetIndent,
    className: activeClassName,
    memberName,
    isAsync,
    isStatic,
    isClassContainer,
  };
}

function locateAiplDeclarationSpan(
  nativeSource: string,
  symbolSelector: string,
  explicitClassName?: string,
): NativeSpanInfo | undefined {
  const stripAiplComment = (raw: string): string => {
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

  const parts = symbolSelector.split(/\.|::/);
  const className = explicitClassName ?? (parts.length >= 2 ? parts[0] : undefined);
  const memberName = parts.length >= 2 ? parts.slice(1).join(".") : symbolSelector;
  const escMember = memberName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const lines = nativeSource.split("\n");
  const lineOffsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    lineOffsets.push(offset);
    offset += line.length + 1;
  }

  let searchStartLine = 0;
  let searchEndLine = lines.length;
  let activeClassName = className;

  if (className) {
    const escClass = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const structRegex = new RegExp(`^([ \\t]*)(?:pub\\s+)?(?:struct|enum)\\s+${escClass}\\b`);
    let foundClassLine = -1;
    let classIndentLen = 0;
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(structRegex);
      if (m) {
        foundClassLine = i;
        classIndentLen = m[1].length;
        break;
      }
    }
    if (foundClassLine < 0) return undefined;

    const cleanClassHeader = stripAiplComment(lines[foundClassLine]);
    const singleTupleFieldRe = new RegExp(`[(,]\\s*(?:pub\\s+)?(${escMember}\\s*:\\s*[^,)]+)`);
    if (singleTupleFieldRe.test(cleanClassHeader)) {
      const fldIndent = lines[foundClassLine].match(/^[ \t]*/)?.[0] ?? "";
      const fldStart = lineOffsets[foundClassLine];
      const endLineStr = lines[foundClassLine];
      const cleanEndLen = endLineStr.endsWith("\r") ? endLineStr.length - 1 : endLineStr.length;
      const fldEnd = fldStart + cleanEndLen;
      return {
        declStart: fldStart,
        fullDeclStart: fldStart,
        declEnd: fldEnd,
        tokenStart: fldStart + fldIndent.length,
        declIndent: fldIndent,
        className: activeClassName,
        memberName,
        isAsync: false,
        isStatic: false,
        isClassContainer: false,
      };
    }
    searchStartLine = foundClassLine + 1;
    for (let i = searchStartLine; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (!trimmed || trimmed.startsWith("//")) continue;
      const ind = lines[i].match(/^[ \t]*/)?.[0].length ?? 0;
      if (ind <= classIndentLen) {
        searchEndLine = i;
        break;
      }
    }
  }

  const fnRegex = new RegExp(`^([ \\t]*)(?:pub\\s+)?fn\\s+${escMember}\\b`);
  let targetLine = -1;
  let targetIndent = "";
  let isClassContainer = false;
  let isField = false;

  for (let i = searchStartLine; i < searchEndLine; i++) {
    const m = lines[i].match(fnRegex);
    if (m) {
      if (!className && m[1].length > 0) {
        for (let k = i - 1; k >= 0; k--) {
          const cm = lines[k].match(/^([ \\t]*)(?:pub\\s+)?(?:struct|enum)\\s+([A-Za-z0-9_]+)\b/);
          if (cm && cm[1].length < m[1].length) {
            activeClassName = cm[2];
            break;
          }
        }
      }
      targetLine = i;
      targetIndent = m[1];
      break;
    }
  }

  if (targetLine < 0 && !className) {
    const topStructRegex = new RegExp(`^([ \\t]*)(?:pub\\s+)?(?:struct|enum)\\s+${escMember}\\b`);
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(topStructRegex);
      if (m) {
        targetLine = i;
        targetIndent = m[1];
        isClassContainer = true;
        break;
      }
    }
  }

  if (targetLine < 0 && !className) {
    const typeOrConstRegex = new RegExp(
      `^([ \\t]*)(?:pub\\s+)?(?:type|const|let)\\s+${escMember}\\b`,
    );
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(typeOrConstRegex);
      if (m) {
        targetLine = i;
        targetIndent = m[1];
        if (/^(?:[ \t]*)(?:pub\s+)?(?:const|let)\b/.test(lines[i])) {
          isField = true;
        }
        break;
      }
    }
  }

  if (targetLine < 0 && !className) {
    const modRegex = new RegExp(`^([ \\t]*)module\\s+${escMember}\\b`);
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(modRegex);
      if (m) {
        targetLine = i;
        targetIndent = m[1];
        break;
      }
    }
  }

  if (targetLine < 0) {
    const fieldRegex = new RegExp(
      `^([ \\t]*)(?:pub\\s+|val\\s+|var\\s+|let\\s+)?${escMember}\\s*:[^\\n]*`,
    );
    const inlineFieldRegex = new RegExp(
      `(?:^|[,(\\s{])(?:pub\\s+|val\\s+|var\\s+|let\\s+)?${escMember}\\s*:[^\\n]*`,
    );
    for (let i = searchStartLine; i < searchEndLine; i++) {
      const m = lines[i].match(fieldRegex);
      if (m && (className || m[1].length === 0)) {
        targetLine = i;
        targetIndent = m[1];
        isField = true;
        break;
      }
      if (className && inlineFieldRegex.test(stripAiplComment(lines[i]))) {
        targetLine = i;
        targetIndent = lines[i].match(/^[ \t]*/)?.[0] ?? "";
        isField = true;
        break;
      }
    }
  }

  if (targetLine < 0) return undefined;

  let endLine = targetLine;
  const baseIndentLen = targetIndent.length;

  if (isField) {
    endLine = targetLine;
  } else {
    let headerEndLine = targetLine;
    let openParens = 0;
    while (headerEndLine < searchEndLine) {
      const hLine = stripAiplComment(lines[headerEndLine]);
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
      endLine = headerEndLine;
      if (openParens === 0) break;
      headerEndLine++;
    }
    for (let i = headerEndLine + 1; i < searchEndLine; i++) {
      const trimmed = lines[i].trim();
      if (!trimmed) continue;
      const ind = lines[i].match(/^[ \t]*/)?.[0].length ?? 0;
      if (ind <= baseIndentLen) {
        break;
      }
      if (!trimmed.startsWith("//")) {
        endLine = i;
      }
    }
  }
  const declStart = lineOffsets[targetLine];
  const fullDeclStart = declStart;
  const tokenStart = declStart + targetIndent.length;
  const endLineStr = lines[endLine];
  const cleanEndLen = endLineStr.endsWith("\r") ? endLineStr.length - 1 : endLineStr.length;
  const declEnd = lineOffsets[endLine] + cleanEndLen;

  return {
    declStart,
    fullDeclStart,
    declEnd,
    tokenStart,
    declIndent: targetIndent,
    className: activeClassName,
    memberName,
    isAsync: false,
    isStatic: false,
    isClassContainer,
  };
}

function findMatchingBraceEnd(
  source: string,
  openBracePos: number,
  targetLang?: TargetLanguage,
): number {
  let depth = 0;
  let i = openBracePos;
  const len = source.length;
  const ppStack: Array<{ startDepth: number; maxEndDepth: number }> = [];

  while (i < len) {
    const ch = source[i];
    const next = source[i + 1];

    // Preprocessor #if / #ifdef / #ifndef / #elif / #else / #endif at line start (C/C++/C#)
    if (
      (targetLang === "cpp" || targetLang === "csharp" || !targetLang) &&
      (i === 0 || source[i - 1] === "\n")
    ) {
      const ppMatch = /^[ \t]*#[ \t]*(ifdef|ifndef|if|elif|else|endif)\b/.exec(source.slice(i));
      if (ppMatch) {
        const dir = ppMatch[1];
        if (dir === "if" || dir === "ifdef" || dir === "ifndef") {
          ppStack.push({ startDepth: depth, maxEndDepth: depth });
        } else if ((dir === "elif" || dir === "else") && ppStack.length > 0) {
          const top = ppStack[ppStack.length - 1];
          top.maxEndDepth = Math.max(top.maxEndDepth, depth);
          depth = top.startDepth;
        } else if (dir === "endif" && ppStack.length > 0) {
          const top = ppStack.pop()!;
          depth = Math.max(top.maxEndDepth, depth);
        }
        while (i < len && source[i] !== "\n") i++;
        continue;
      }
    }

    // Line comment `//` or PHP `#` comment (not `#[` attribute)
    if ((ch === "/" && next === "/") || (targetLang === "php" && ch === "#" && next !== "[")) {
      i += 2;
      while (i < len && source[i] !== "\n") i++;
      continue;
    }
    // Block comment `/* ... */`
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < len && !(source[i] === "*" && source[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    // Rust raw string literal `r#*"..."#*` or `br#*"..."#*`
    if (
      (ch === "r" || (ch === "b" && next === "r")) &&
      (i === 0 || !/[A-Za-z0-9_]/.test(source[i - 1]))
    ) {
      const rStart = ch === "b" ? i + 2 : i + 1;
      let hashes = 0;
      while (rStart + hashes < len && source[rStart + hashes] === "#") hashes++;
      if (source[rStart + hashes] === '"') {
        i = rStart + hashes + 1;
        const closeSeq = `"${"#".repeat(hashes)}`;
        const closeIdx = source.indexOf(closeSeq, i);
        i = closeIdx >= 0 ? closeIdx + closeSeq.length : len;
        continue;
      }
    }
    // C++ raw string literal `R"delim(...)delim"`
    if (ch === "R" && next === '"' && (i === 0 || !/[A-Za-z0-9_]/.test(source[i - 1]))) {
      const openParen = source.indexOf("(", i + 2);
      if (openParen >= 0 && openParen - (i + 2) <= 16) {
        const delim = source.slice(i + 2, openParen);
        if (!/[\s)\\]/.test(delim)) {
          const closeSeq = `)${delim}"`;
          const closeIdx = source.indexOf(closeSeq, openParen + 1);
          i = closeIdx >= 0 ? closeIdx + closeSeq.length : len;
          continue;
        }
      }
    }
    // C# verbatim string `@"..."`
    if (ch === "@" && next === '"') {
      i += 2;
      while (i < len) {
        if (source[i] === '"') {
          if (source[i + 1] === '"') {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    // Triple-quoted string `"""..."""` (Kotlin, C#, Python)
    if (ch === '"' && next === '"' && source[i + 2] === '"') {
      const closeIdx = source.indexOf('"""', i + 3);
      i = closeIdx >= 0 ? closeIdx + 3 : len;
      continue;
    }
    // Single-quote `'` disambiguation: C++ digit separator (`1'000`) & Rust lifetime/label (`'a`, `'static`)
    if (ch === "'") {
      if (i > 0 && /[0-9a-fA-F]/.test(source[i - 1]) && /[0-9a-fA-F]/.test(next ?? "")) {
        i++;
        continue;
      }
      if (targetLang !== "php" && /^'[A-Za-z_][A-Za-z0-9_]*(?!')/.test(source.slice(i))) {
        i++;
        while (i < len && /[A-Za-z0-9_]/.test(source[i])) i++;
        continue;
      }
    }
    // Standard string or char literal
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      i++;
      while (i < len && source[i] !== quote) {
        if (source[i] === "\\" && quote !== "`") {
          i += 2;
        } else if (quote === "'" && targetLang !== "php" && source[i] === "\n") {
          break;
        } else {
          i++;
        }
      }
      if (i < len && source[i] === quote) i++;
      continue;
    }

    if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return i + 1;
      }
    }
    i++;
  }
  return len;
}

function normIdForSpan(s: string): string {
  return s.replace(/_/g, "").toLowerCase();
}

function countHeaderParams(headerSlice: string): number | undefined {
  const openParen = headerSlice.indexOf("(");
  if (openParen < 0) return undefined;
  let depth = 0;
  let closeParen = -1;
  for (let i = openParen; i < headerSlice.length; i++) {
    const ch = headerSlice[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) {
        closeParen = i;
        break;
      }
    }
  }
  if (closeParen < 0) return undefined;
  const inner = headerSlice.slice(openParen + 1, closeParen).trim();
  if (!inner || inner === "void") return 0;

  const params: string[] = [];
  let cur = "";
  let angleDepth = 0;
  let nestDepth = 0;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === "<") angleDepth++;
    else if (ch === ">" && inner[i - 1] !== "-") angleDepth = Math.max(0, angleDepth - 1);
    else if (ch === "(" || ch === "[" || ch === "{") nestDepth++;
    else if (ch === ")" || ch === "]" || ch === "}") nestDepth = Math.max(0, nestDepth - 1);
    else if (ch === "," && angleDepth === 0 && nestDepth === 0) {
      params.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) params.push(cur.trim());
  const nonReceiver = params.filter((p) => !/^(?:&\s*(?:mut\s+)?)?self$|^cls$/.test(p));
  return nonReceiver.length;
}

export function inferSnippetParamArity(rawSnippet: string): number | undefined {
  const { cleanedCode } = extractInlineIdiomsFromSource(rawSnippet);
  const lines = cleanedCode
    .trim()
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(
      (l) =>
        l &&
        !l.startsWith("//") &&
        !l.startsWith("#") &&
        !l.startsWith("@") &&
        !l.startsWith("template"),
    );
  if (lines.length === 0) return undefined;
  const headerText = lines.slice(0, 4).join(" ");
  return countHeaderParams(headerText);
}

function locateBraceLanguageDeclarationSpan(
  nativeSource: string,
  symbolSelector: string,
  targetLang: TargetLanguage,
  explicitClassName?: string,
  preferredArity?: number,
  strictForSplice = false,
): NativeSpanInfo | undefined {
  const qualMatch = symbolSelector.trim().match(/^([^(]+)\((.*)\)$/);
  const baseSelector = qualMatch ? qualMatch[1].trim() : symbolSelector.trim();
  const explicitArity = qualMatch
    ? qualMatch[2].trim() === ""
      ? 0
      : qualMatch[2].split(",").length
    : preferredArity;

  const parts = baseSelector.split(/\.|::/);
  const className = explicitClassName ?? (parts.length >= 2 ? parts[0] : undefined);
  const memberName = parts.length >= 2 ? parts.slice(1).join(".") : baseSelector;
  const normMember = normIdForSpan(memberName);
  const normClass = className ? normIdForSpan(className) : undefined;

  const lines = nativeSource.split("\n");
  const lineOffsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    lineOffsets.push(offset);
    offset += line.length + 1;
  }

  const lineBraceDepths = new Array<number>(lines.length).fill(0);
  const openBraceDepthByOffset = new Map<number, number>();
  {
    let curLine = 0;
    let depth = 0;
    let p = 0;
    const nLen = nativeSource.length;
    while (p < nLen) {
      const c = nativeSource[p];
      const nx = nativeSource[p + 1];
      if (c === "\n") {
        curLine++;
        if (curLine < lineBraceDepths.length) {
          lineBraceDepths[curLine] = depth;
        }
        p++;
        continue;
      }
      if (c === "/" && nx === "/") {
        p += 2;
        while (p < nLen && nativeSource[p] !== "\n") p++;
        continue;
      }
      if (c === "/" && nx === "*") {
        p += 2;
        while (p < nLen && !(nativeSource[p] === "*" && nativeSource[p + 1] === "/")) {
          if (nativeSource[p] === "\n") {
            curLine++;
            if (curLine < lineBraceDepths.length) {
              lineBraceDepths[curLine] = depth;
            }
          }
          p++;
        }
        if (p < nLen) p += 2;
        continue;
      }
      if (c === "#" && (targetLang === "php" || targetLang === "python")) {
        p++;
        while (p < nLen && nativeSource[p] !== "\n") p++;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") {
        if (
          c === "'" &&
          targetLang === "rust" &&
          /^'[A-Za-z_][A-Za-z0-9_]*(?!')/.test(nativeSource.slice(p))
        ) {
          p += 2;
          continue;
        }
        const quote = c;
        p++;
        while (p < nLen && nativeSource[p] !== quote) {
          if (nativeSource[p] === "\\") {
            if (nativeSource[p + 1] === "\n") {
              curLine++;
              if (curLine < lineBraceDepths.length) {
                lineBraceDepths[curLine] = depth;
              }
            }
            p += 2;
          } else {
            if (nativeSource[p] === "\n") {
              curLine++;
              if (curLine < lineBraceDepths.length) {
                lineBraceDepths[curLine] = depth;
              }
            }
            p++;
          }
        }
        if (p < nLen) p++;
        continue;
      }
      if (c === "{") {
        openBraceDepthByOffset.set(p, depth);
        depth++;
      } else if (c === "}") {
        depth = Math.max(0, depth - 1);
      }
      p++;
    }
  }

  const buildBraceSpanFromLine = (
    lineIdx: number,
    indent: string,
    actualMemberName: string,
    enclosingClass?: string,
    extra?: Partial<NativeSpanInfo>,
  ): NativeSpanInfo | undefined => {
    let firstAttrLine = lineIdx;
    for (let k = lineIdx - 1; k >= 0; k--) {
      const t = lines[k].trim();
      if (
        t.startsWith("#[") ||
        (t.startsWith("[") && t.endsWith("]")) ||
        t.startsWith("@") ||
        (targetLang === "cpp" && /^template\s*</.test(t))
      ) {
        firstAttrLine = k;
      } else {
        break;
      }
    }
    const declStart = lineOffsets[lineIdx];
    const fullDeclStart = lineOffsets[firstAttrLine];
    const tokenStart = declStart + indent.length;

    let openBraceIdx = -1;
    let declEnd = -1;
    let parenDepth = 0;
    let sawParamParen = false;
    let pos = tokenStart;
    const len = nativeSource.length;

    while (pos < len) {
      const ch = nativeSource[pos];
      const next = nativeSource[pos + 1];

      if (ch === "/" && next === "/") {
        pos += 2;
        while (pos < len && nativeSource[pos] !== "\n") pos++;
        continue;
      }
      if (ch === "/" && next === "*") {
        pos += 2;
        while (pos < len && !(nativeSource[pos] === "*" && nativeSource[pos + 1] === "/")) pos++;
        pos += 2;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") {
        if (
          ch === "'" &&
          targetLang === "rust" &&
          /^'[A-Za-z_][A-Za-z0-9_]*(?!')/.test(nativeSource.slice(pos))
        ) {
          pos += 2;
          continue;
        }
        const q = ch;
        pos++;
        while (pos < len && nativeSource[pos] !== q) {
          if (nativeSource[pos] === "\\") pos += 2;
          else pos++;
        }
        if (pos < len) pos++;
        continue;
      }

      if (ch === "(") {
        parenDepth++;
        sawParamParen = true;
      } else if (ch === ")") {
        parenDepth = Math.max(0, parenDepth - 1);
      } else if (parenDepth === 0) {
        if (ch === "{") {
          if (
            sawParamParen &&
            (targetLang === "typescript" || targetLang === "javascript" || targetLang === "tsx")
          ) {
            const candidateEnd = findMatchingBraceEnd(nativeSource, pos, targetLang);
            const afterTypeBrace = nativeSource.slice(
              candidateEnd,
              Math.min(len, candidateEnd + 160),
            );
            if (/^[ \t\r\n]*(?:[|&][^{;]+|\[\])*[ \t\r\n]*[;{]/.test(afterTypeBrace)) {
              pos = candidateEnd;
              continue;
            }
          }
          openBraceIdx = pos;
          break;
        }
        if (ch === ";" || (enclosingClass && ch === ",")) {
          declEnd = pos + 1;
          break;
        }
        if (ch === "\n") {
          const headerSoFar = nativeSource.slice(tokenStart, pos).trimEnd();
          const restAfterLine = nativeSource.slice(pos + 1);
          const nextNonEmpty = restAfterLine.match(/^[ \t]*(?:\r?\n[ \t]*)*([^\s])/)?.[1] ?? "";
          const isBracelessConstruct =
            (targetLang === "kotlin" &&
              (/^(?:public\s+|private\s+|internal\s+)?(?:data\s+|value\s+)class\b/.test(
                headerSoFar,
              ) ||
                /^(?:public\s+|private\s+|internal\s+)?(?:typealias|const\s+val|val|var)\b/.test(
                  headerSoFar,
                ) ||
                (/\bfun\b/.test(headerSoFar) && /\)\s*(?::\s*[^=]+)?=\s*\S/.test(headerSoFar)))) ||
            (targetLang === "go" &&
              /^(?:type|const|var)\s+[A-Za-z0-9_]+/.test(headerSoFar) &&
              !/\b(?:struct|interface)\s*$/.test(headerSoFar));
          if (isBracelessConstruct && nextNonEmpty !== "{") {
            declEnd = nativeSource[pos - 1] === "\r" ? pos - 1 : pos;
            break;
          }
        }
      }
      pos++;
    }

    if (openBraceIdx >= 0) {
      declEnd = findMatchingBraceEnd(nativeSource, openBraceIdx, targetLang);
      if (nativeSource[declEnd] === ";") {
        declEnd++;
      }
    } else if (declEnd < 0) {
      return undefined;
    }

    const headerEndPos = openBraceIdx >= 0 ? openBraceIdx : declEnd;
    const headerSlice = nativeSource.slice(tokenStart, headerEndPos);
    let visibility: "public" | "private" | "protected" | undefined;
    if (/\bpublic\b/.test(headerSlice)) visibility = "public";
    else if (/\bprivate\b/.test(headerSlice)) visibility = "private";
    else if (/\bprotected\b/.test(headerSlice)) visibility = "protected";

    const isExported =
      /\bpub\b/.test(headerSlice) ||
      visibility === "public" ||
      (targetLang === "go" && /^[A-Z]/.test(actualMemberName));
    const isStatic = /\bstatic\b/.test(headerSlice);
    const isAsync = /\b(?:async|suspend)\b/.test(headerSlice);

    return {
      declStart,
      fullDeclStart,
      declEnd,
      tokenStart,
      declIndent: indent,
      className: enclosingClass,
      memberName: actualMemberName,
      visibility,
      isExported,
      isStatic,
      isAsync,
      origHeader: headerSlice,
      ...extra,
    };
  };

  // 1. Go receiver method or top-level func/struct/type/const/var
  if (targetLang === "go") {
    for (let i = 0; i < lines.length; i++) {
      const recvMatch = lines[i].match(
        /^([ \t]*)func\s*\(\s*([A-Za-z0-9_]+\s+\*?([A-Za-z0-9_]+))\s*\)\s*([A-Za-z0-9_]+)\s*(?:\[[^\]]+\])?\s*\(/,
      );
      if (recvMatch) {
        const [, indent, recvSpec, recvType, fnName] = recvMatch;
        const classMatches = !normClass || normIdForSpan(recvType) === normClass;
        const nameMatches = fnName === memberName || normIdForSpan(fnName) === normMember;
        if (classMatches && nameMatches) {
          return buildBraceSpanFromLine(i, indent, fnName, recvType, {
            goReceiver: `(${recvSpec})`,
          });
        }
      }
      if (!className) {
        const fnMatch = lines[i].match(/^([ \t]*)func\s+([A-Za-z0-9_]+)\s*(?:\[[^\]]+\])?\s*\(/);
        if (fnMatch && (fnMatch[2] === memberName || normIdForSpan(fnMatch[2]) === normMember)) {
          return buildBraceSpanFromLine(i, fnMatch[1], fnMatch[2], undefined);
        }
        const structMatch = lines[i].match(/^([ \t]*)type\s+([A-Za-z0-9_]+)\b/);
        if (
          structMatch &&
          (structMatch[2] === memberName || normIdForSpan(structMatch[2]) === normMember)
        ) {
          return buildBraceSpanFromLine(i, structMatch[1], structMatch[2], undefined, {
            isClassContainer: /\b(?:struct|interface)\b/.test(lines[i]),
          });
        }
        const constVarMatch = lines[i].match(/^([ \t]*)(?:const|var)\s+([A-Za-z0-9_]+)\b/);
        if (
          constVarMatch &&
          (constVarMatch[2] === memberName || normIdForSpan(constVarMatch[2]) === normMember)
        ) {
          return buildBraceSpanFromLine(i, constVarMatch[1], constVarMatch[2], undefined);
        }
      }
    }
    return undefined;
  }

  // 2. C++ out-of-line method `RetType ClassName::methodName(...)`
  if (targetLang === "cpp") {
    const oolMatches: Array<{ cls: string; span: NativeSpanInfo }> = [];
    for (let i = 0; i < lines.length; i++) {
      const oolMatch = lines[i].match(
        /^([ \t]*)(?:[A-Za-z0-9_:<>*&]+\s+)+([A-Za-z0-9_]+)\s*::\s*([A-Za-z0-9_~]+)\s*\(/,
      );
      if (oolMatch) {
        const [, indent, cls, fnName] = oolMatch;
        const classMatches = !normClass || normIdForSpan(cls) === normClass;
        const nameMatches = fnName === memberName || normIdForSpan(fnName) === normMember;
        if (classMatches && nameMatches && lines[i].includes("{")) {
          const built = buildBraceSpanFromLine(i, indent, fnName, cls, { cppOutOfLine: true });
          if (built) {
            oolMatches.push({ cls, span: built });
          }
        }
      }
    }
    if (oolMatches.length > 0) {
      const distinctOol = new Set(oolMatches.map((m) => m.cls));
      if (!normClass && distinctOol.size > 1 && strictForSplice) {
        throw new Error(
          `Ambiguous symbol '${memberName}' found in multiple containers (${Array.from(distinctOol).join(", ")}). Qualify as '<Class>::${memberName}'.`,
        );
      }
      return oolMatches[0].span;
    }
  }

  // 3. Determine class/impl search windows for Rust, C++, C#, Kotlin, PHP
  const containerWindows: Array<{
    start: number;
    end: number;
    resolvedName: string;
    memberDepth: number;
  }> = [];
  let resolvedClassName = className;

  const allContainerWindows: Array<{
    start: number;
    end: number;
    resolvedName: string;
    memberDepth: number;
  }> = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isRustImpl =
      targetLang === "rust" &&
      /^\s*impl(?:\s*<[^>]*>)?\s+(?:[A-Za-z0-9_:<>,\s]+\s+for\s+)?([A-Za-z0-9_]+)\b/.exec(line);
    const isClassLine =
      /^\s*(?:export\s+|default\s+|declare\s+|pub\s+|public\s+|private\s+|protected\s+|internal\s+|static\s+|partial\s+|final\s+|abstract\s+|open\s+|data\s+|sealed\s+|readonly\s+)*(?:class|struct|interface|trait|object|record|enum)\s+([A-Za-z0-9_$]+)\b/.exec(
        line,
      );

    const m = isRustImpl || isClassLine;
    if (m) {
      const openBrace = nativeSource.indexOf("{", lineOffsets[i]);
      const semiBeforeBrace = nativeSource.indexOf(";", lineOffsets[i]);
      if (openBrace >= 0 && (semiBeforeBrace < 0 || openBrace < semiBeforeBrace)) {
        const outerDepth = openBraceDepthByOffset.get(openBrace) ?? lineBraceDepths[i] ?? 0;
        allContainerWindows.push({
          start: openBrace + 1,
          end: findMatchingBraceEnd(nativeSource, openBrace, targetLang),
          resolvedName: m[1],
          memberDepth: outerDepth + 1,
        });
      }
    }
  }

  if (className) {
    for (const w of allContainerWindows) {
      if (w.resolvedName === className || normIdForSpan(w.resolvedName) === normClass) {
        resolvedClassName = w.resolvedName;
        containerWindows.push(w);
      }
    }
    if (containerWindows.length === 0) return undefined;
  }

  // 4. Scan lines within matching container windows (or full file when top-level)
  const candidates: NativeSpanInfo[] = [];
  const collectOrReturn = (span: NativeSpanInfo | undefined): NativeSpanInfo | undefined => {
    if (!span) return undefined;
    if (explicitArity === undefined) return span;
    candidates.push(span);
    return undefined;
  };

  for (let i = 0; i < lines.length; i++) {
    const lineOff = lineOffsets[i];
    if (
      className &&
      !containerWindows.some(
        (w) => lineOff >= w.start && lineOff < w.end && lineBraceDepths[i] === w.memberDepth,
      )
    ) {
      continue;
    }
    const isInsideAnyContainer =
      !className && allContainerWindows.some((w) => lineOff >= w.start && lineOff < w.end);
    const line = lines[i];

    if (targetLang === "rust") {
      const fnMatch = !isInsideAnyContainer
        ? line.match(
            /^([ \t]*)(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:const\s+)?(?:unsafe\s+)?fn\s+([A-Za-z0-9_]+)\b/,
          )
        : null;
      if (fnMatch && (fnMatch[2] === memberName || normIdForSpan(fnMatch[2]) === normMember)) {
        const res = collectOrReturn(
          buildBraceSpanFromLine(i, fnMatch[1], fnMatch[2], resolvedClassName),
        );
        if (res) return res;
      }
      if (className) {
        const fieldMatch = line.match(
          /^([ \t]*)(?:pub(?:\([^)]*\))?\s+)?([A-Za-z0-9_]+)\s*:\s*[^,;]+[,;]?/,
        );
        if (
          fieldMatch &&
          (fieldMatch[2] === memberName || normIdForSpan(fieldMatch[2]) === normMember)
        ) {
          return buildBraceSpanFromLine(i, fieldMatch[1], fieldMatch[2], resolvedClassName);
        }
      }
      if (!className) {
        const structMatch = line.match(
          /^([ \t]*)(?:pub(?:\([^)]*\))?\s+)?(?:struct|enum|trait|impl|type|const|static)\s+([A-Za-z0-9_]+)\b/,
        );
        if (
          structMatch &&
          (structMatch[2] === memberName || normIdForSpan(structMatch[2]) === normMember)
        ) {
          return buildBraceSpanFromLine(i, structMatch[1], structMatch[2], undefined, {
            isClassContainer: /\b(?:struct|enum|trait|impl)\b/.test(line),
          });
        }
        const macroMatch = line.match(/^([ \t]*)macro_rules!\s+([A-Za-z0-9_]+)\b/);
        if (
          macroMatch &&
          (macroMatch[2] === memberName || normIdForSpan(macroMatch[2]) === normMember)
        ) {
          return buildBraceSpanFromLine(i, macroMatch[1], macroMatch[2], undefined);
        }
      }
    } else if (targetLang === "kotlin") {
      const funMatch = !isInsideAnyContainer
        ? line.match(
            /^([ \t]*)(?:public\s+|private\s+|protected\s+|internal\s+|override\s+|open\s+|suspend\s+|inline\s+|operator\s+)*fun\s+(?:<[^>]+>\s+)?(?:[A-Za-z0-9_<>?.*]+\.)?([A-Za-z0-9_]+)\s*\(/,
          )
        : null;
      if (funMatch && (funMatch[2] === memberName || normIdForSpan(funMatch[2]) === normMember)) {
        const res = collectOrReturn(
          buildBraceSpanFromLine(i, funMatch[1], funMatch[2], resolvedClassName),
        );
        if (res) return res;
      }
      if (className) {
        const propMatch = line.match(
          /^([ \t]*)(?:public\s+|private\s+|protected\s+|internal\s+|override\s+|open\s+|final\s+|lateinit\s+|const\s+)*(?:val|var)\s+([A-Za-z0-9_]+)\b/,
        );
        if (
          propMatch &&
          (propMatch[2] === memberName || normIdForSpan(propMatch[2]) === normMember)
        ) {
          return buildBraceSpanFromLine(i, propMatch[1], propMatch[2], resolvedClassName);
        }
      }
      if (!className) {
        const ktTopMatch = line.match(
          /^([ \t]*)(?:public\s+|private\s+|protected\s+|internal\s+|open\s+|abstract\s+|data\s+|sealed\s+|value\s+|enum\s+)*(?:class|interface|object|typealias|const\s+val|val)\s+([A-Za-z0-9_]+)\b/,
        );
        if (
          ktTopMatch &&
          (ktTopMatch[2] === memberName || normIdForSpan(ktTopMatch[2]) === normMember)
        ) {
          return buildBraceSpanFromLine(i, ktTopMatch[1], ktTopMatch[2], undefined, {
            isClassContainer: /\b(?:class|interface|object)\b/.test(line),
          });
        }
      }
    } else if (targetLang === "php") {
      const phpMatch = !isInsideAnyContainer
        ? line.match(
            /^([ \t]*)(?:public\s+|private\s+|protected\s+|static\s+|final\s+|abstract\s+)*function\s+&?([A-Za-z0-9_]+)\s*\(/,
          )
        : null;
      if (phpMatch && (phpMatch[2] === memberName || normIdForSpan(phpMatch[2]) === normMember)) {
        const res = collectOrReturn(
          buildBraceSpanFromLine(i, phpMatch[1], phpMatch[2], resolvedClassName),
        );
        if (res) return res;
      }
      if (className) {
        const phpPropMatch = line.match(
          /^([ \t]*)(?:public\s+|private\s+|protected\s+|static\s+|readonly\s+|var\s+)*(?:[A-Za-z0-9_\\|?]+\s+)*\$?([A-Za-z0-9_]+)\s*(?:=[^;]+)?;?/,
        );
        if (
          phpPropMatch &&
          (phpPropMatch[2] === memberName || normIdForSpan(phpPropMatch[2]) === normMember)
        ) {
          return buildBraceSpanFromLine(i, phpPropMatch[1], phpPropMatch[2], resolvedClassName);
        }
      }
      if (!className) {
        const phpTopMatch = line.match(
          /^([ \t]*)(?:final\s+|abstract\s+|readonly\s+)*(?:class|interface|trait|enum)\s+([A-Za-z0-9_]+)\b/,
        );
        if (
          phpTopMatch &&
          (phpTopMatch[2] === memberName || normIdForSpan(phpTopMatch[2]) === normMember)
        ) {
          return buildBraceSpanFromLine(i, phpTopMatch[1], phpTopMatch[2], undefined, {
            isClassContainer: true,
          });
        }
      }
    } else if (targetLang === "typescript" || targetLang === "javascript" || targetLang === "tsx") {
      const trimmed = line.trim();
      if (
        trimmed.startsWith("//") ||
        trimmed.startsWith("/*") ||
        trimmed.startsWith("*") ||
        /^(?:if|for|while|switch|catch|return|super|new|throw|typeof|delete|void)\b/.test(trimmed)
      ) {
        continue;
      }
      if (!className) {
        const tsFnMatch = line.match(
          /^([ \t]*)(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][A-Za-z0-9_$]*)\b/,
        );
        if (
          tsFnMatch &&
          (tsFnMatch[2] === memberName || normIdForSpan(tsFnMatch[2]) === normMember)
        ) {
          const span = buildBraceSpanFromLine(i, tsFnMatch[1], tsFnMatch[2], undefined);
          if (span) {
            const hasBraceBody = span.tokenStart + (span.origHeader?.length ?? 0) < span.declEnd;
            const isOverloadHeader = !hasBraceBody && !/\bdeclare\s+/.test(line);
            if (isOverloadHeader) {
              candidates.push(span);
            } else {
              const res = collectOrReturn(span);
              if (res) return res;
            }
          }
        }
        const tsVarOrTypeMatch = line.match(
          /^([ \t]*)(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:const|let|var|type)\s+([A-Za-z_$][A-Za-z0-9_$]*)\b/,
        );
        if (
          tsVarOrTypeMatch &&
          (tsVarOrTypeMatch[2] === memberName || normIdForSpan(tsVarOrTypeMatch[2]) === normMember)
        ) {
          const span = buildBraceSpanFromLine(
            i,
            tsVarOrTypeMatch[1],
            tsVarOrTypeMatch[2],
            undefined,
          );
          if (span) return span;
        }
      } else {
        const tsMethodMatch = line.match(
          /^([ \t]*)(?:public\s+|private\s+|protected\s+|readonly\s+|static\s+|override\s+|abstract\s+|async\s+)*(?:(get|set)\s+)?\*?\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:<[^>]*>)?\s*\(/,
        );
        if (
          tsMethodMatch &&
          (tsMethodMatch[3] === memberName || normIdForSpan(tsMethodMatch[3]) === normMember)
        ) {
          const span = buildBraceSpanFromLine(
            i,
            tsMethodMatch[1],
            tsMethodMatch[3],
            resolvedClassName,
            tsMethodMatch[2] ? { accessor: tsMethodMatch[2] as "get" | "set" } : undefined,
          );
          if (span) {
            const hasBraceBody = span.tokenStart + (span.origHeader?.length ?? 0) < span.declEnd;
            const isOverloadHeader = !hasBraceBody && !/\babstract\s+/.test(line);
            if (isOverloadHeader) {
              candidates.push(span);
            } else {
              const res = collectOrReturn(span);
              if (res) return res;
            }
          }
        }
        const tsPropMatch = line.match(
          /^([ \t]*)(?:public\s+|private\s+|protected\s+|readonly\s+|static\s+|override\s+|declare\s+)*([A-Za-z_$][A-Za-z0-9_$]*)\s*[?!]?\s*(?::[^=;]+)?\s*(?:=|;)/,
        );
        if (
          tsPropMatch &&
          (tsPropMatch[2] === memberName || normIdForSpan(tsPropMatch[2]) === normMember)
        ) {
          const span = buildBraceSpanFromLine(i, tsPropMatch[1], tsPropMatch[2], resolvedClassName);
          if (span) return span;
        }
      }
    } else if (targetLang === "csharp" || targetLang === "cpp") {
      const trimmed = line.trim();
      if (
        trimmed.startsWith("//") ||
        trimmed.startsWith("#") ||
        trimmed.startsWith("if ") ||
        trimmed.startsWith("if(") ||
        trimmed.startsWith("for ") ||
        trimmed.startsWith("for(") ||
        trimmed.startsWith("while ") ||
        trimmed.startsWith("while(") ||
        trimmed.startsWith("switch ") ||
        trimmed.startsWith("switch(") ||
        trimmed.startsWith("return ")
      ) {
        continue;
      }
      const cMethodMatch = !isInsideAnyContainer
        ? line.match(
            /^([ \t]*)(?:public\s+|private\s+|protected\s+|internal\s+|static\s+|virtual\s+|override\s+|async\s+|inline\s+|constexpr\s+|explicit\s+|friend\s+)*(?:[A-Za-z0-9_:<>*&[\]?,]+\s+)+([A-Za-z0-9_~]+)\s*(?:<[^>]+>)?\s*\(/,
          )
        : null;
      if (
        cMethodMatch &&
        (cMethodMatch[2] === memberName || normIdForSpan(cMethodMatch[2]) === normMember)
      ) {
        const res = collectOrReturn(
          buildBraceSpanFromLine(i, cMethodMatch[1], cMethodMatch[2], resolvedClassName),
        );
        if (res) return res;
      }
      if (className) {
        const cFieldMatch = line.match(
          /^([ \t]*)(?:public\s+|private\s+|protected\s+|internal\s+|static\s+|readonly\s+|volatile\s+|const\s+|constexpr\s+|inline\s+)*(?:[A-Za-z0-9_:<>*&[\]?,]+\s+)+([A-Za-z0-9_]+)\s*(?:=|;|\{|=>)/,
        );
        if (
          cFieldMatch &&
          (cFieldMatch[2] === memberName || normIdForSpan(cFieldMatch[2]) === normMember)
        ) {
          return buildBraceSpanFromLine(i, cFieldMatch[1], cFieldMatch[2], resolvedClassName);
        }
      }
    }

    if (!className) {
      const clsMatch = line.match(
        /^([ \t]*)(?:export\s+|default\s+|declare\s+|pub\s+|public\s+|private\s+|protected\s+|internal\s+|static\s+|partial\s+|final\s+|abstract\s+|open\s+|data\s+|sealed\s+|readonly\s+)*(?:class|struct|interface|enum(?:\s+class)?|record(?:\s+class|\s+struct)?)\s+([A-Za-z0-9_$]+)\b/,
      );
      if (clsMatch && (clsMatch[2] === memberName || normIdForSpan(clsMatch[2]) === normMember)) {
        return buildBraceSpanFromLine(i, clsMatch[1], clsMatch[2], undefined, {
          isClassContainer: true,
        });
      }
    }
  }

  if (candidates.length > 0) {
    const withBody = candidates.filter(
      (c) => c.tokenStart + (c.origHeader?.length ?? 0) < c.declEnd,
    );
    const pool = withBody.length > 0 ? withBody : candidates;
    if (explicitArity !== undefined) {
      const arityMatch = pool.find((c) => countHeaderParams(c.origHeader ?? "") === explicitArity);
      if (arityMatch) return arityMatch;
    }
    return pool[0];
  }

  // 5. Fallback: if !className, try finding enclosing class name for a unique method match
  if (!className) {
    const matchedSpans: Array<{ cls: string; span: NativeSpanInfo }> = [];
    const checkedClasses = new Set<string>();
    for (const w of allContainerWindows) {
      {
        const candidateCls = w.resolvedName;
        if (checkedClasses.has(candidateCls)) continue;
        checkedClasses.add(candidateCls);
        const found = locateBraceLanguageDeclarationSpan(
          nativeSource,
          `${candidateCls}.${memberName}`,
          targetLang,
          candidateCls,
          explicitArity,
          false,
        );
        if (found) {
          matchedSpans.push({ cls: candidateCls, span: found });
        }
      }
    }
    if (matchedSpans.length > 1 && strictForSplice) {
      throw new Error(
        `Ambiguous symbol '${memberName}' found in multiple containers (${matchedSpans.map((m) => m.cls).join(", ")}). Qualify as '<Class>.${memberName}'.`,
      );
    }
    if (matchedSpans.length > 0) {
      return matchedSpans[0].span;
    }
  }

  return undefined;
}

const KNOWN_TARGET_LANGS_SET = new Set<string>([
  "typescript",
  "javascript",
  "tsx",
  "python",
  "html",
  "css",
  "rust",
  "go",
  "cpp",
  "csharp",
  "json",
  "yaml",
  "twig",
  "php",
  "kotlin",
  "shell",
  "powershell",
  "batch",
  "markdown",
]);

function enrichSpanWithOffsetsAndLines(
  nativeSource: string,
  span: NativeSpanInfo | undefined,
): NativeSpanInfo | undefined {
  if (!span) return undefined;
  const startOffset = span.declStart;
  const endOffset = span.declEnd;
  const startLine = nativeSource.slice(0, startOffset).split(/\r?\n/).length;
  const endSlice = nativeSource.slice(0, Math.max(startOffset, endOffset)).replace(/\r?\n$/, "");
  const endLine = Math.max(startLine, endSlice.split(/\r?\n/).length);
  span.startOffset = startOffset;
  span.endOffset = endOffset;
  span.startLine = startLine;
  span.endLine = endLine;
  return span;
}

export function locateImportBlockSpan(
  nativeSource: string,
  targetLang: TargetLanguage,
): NativeSpanInfo | undefined {
  if (targetLang === "typescript" || targetLang === "javascript" || targetLang === "tsx") {
    const sf = getCachedTsSourceFile(nativeSource);
    let lastDirectiveEnd = -1;
    const importStmts: Array<ts.ImportDeclaration | ts.ImportEqualsDeclaration> = [];

    for (const stmt of sf.statements) {
      if (
        importStmts.length === 0 &&
        ts.isExpressionStatement(stmt) &&
        ts.isStringLiteral(stmt.expression)
      ) {
        lastDirectiveEnd = stmt.getEnd();
        continue;
      }
      if (ts.isImportDeclaration(stmt) || ts.isImportEqualsDeclaration(stmt)) {
        importStmts.push(stmt);
        continue;
      }
      break;
    }

    if (importStmts.length > 0) {
      const firstStmt = importStmts[0];
      const lastStmt = importStmts[importStmts.length - 1];
      const tokStart = firstStmt.getStart(sf, false);
      const lineStart = nativeSource.lastIndexOf("\n", tokStart - 1) + 1;
      const declStart = /^[ \t]*$/.test(nativeSource.slice(lineStart, tokStart))
        ? lineStart
        : tokStart;
      let declEnd = lastStmt.getEnd();
      while (declEnd < nativeSource.length && nativeSource[declEnd] !== "\n") {
        declEnd++;
      }
      if (declEnd < nativeSource.length && nativeSource[declEnd] === "\n") {
        declEnd++;
      }
      return {
        declStart,
        fullDeclStart: declStart,
        declEnd,
        tokenStart: declStart,
        declIndent: "",
        memberName: "imports",
      };
    }

    if (!/^\s*from\s+['"]/m.test(nativeSource)) {
      let insertPos = 0;
      if (lastDirectiveEnd >= 0) {
        insertPos = lastDirectiveEnd;
        while (insertPos < nativeSource.length && nativeSource[insertPos] !== "\n") {
          insertPos++;
        }
        if (insertPos < nativeSource.length && nativeSource[insertPos] === "\n") {
          insertPos++;
        }
      } else if (nativeSource.startsWith("#!")) {
        const nlIdx = nativeSource.indexOf("\n");
        insertPos = nlIdx >= 0 ? nlIdx + 1 : nativeSource.length;
      }
      return {
        declStart: insertPos,
        fullDeclStart: insertPos,
        declEnd: insertPos,
        tokenStart: insertPos,
        declIndent: "",
        memberName: "imports",
      };
    }
  }

  const lines = nativeSource.split("\n");
  const lineOffsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    lineOffsets.push(offset);
    offset += line.length + 1;
  }

  const stripLineCommentForImport = (line: string): string => {
    let cleaned = line.replace(/\/\*[\s\S]*?\*\//g, "");
    if (targetLang === "python") {
      cleaned = cleaned.replace(/#.*$/, "");
    } else {
      cleaned = cleaned.replace(/\/\/.*$/, "");
    }
    return cleaned;
  };

  const countGroupDelta = (line: string): number => {
    const codeOnly = stripLineCommentForImport(line);
    let delta = 0;
    let inStr: string | null = null;
    for (let k = 0; k < codeOnly.length; k++) {
      const ch = codeOnly[k];
      if (inStr) {
        if (ch === "\\") {
          k++;
          continue;
        }
        if (ch === inStr) inStr = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") {
        inStr = ch;
        continue;
      }
      if (ch === "(" || ch === "{") delta++;
      else if (ch === ")" || ch === "}") delta--;
    }
    return delta;
  };

  const isImportLine = (line: string): boolean => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    switch (targetLang) {
      case "typescript":
      case "javascript":
      case "tsx":
        return /^import\b|^from\b/.test(trimmed);
      case "python":
        return /^import\b|^from\b/.test(trimmed);
      case "cpp":
        return /^#\s*include\b/.test(trimmed);
      case "csharp":
        return /^using\b(?!\s*\()/.test(trimmed);
      case "rust":
        return /^(?:pub\s+)?use\b/.test(trimmed);
      case "go":
        return /^import\b/.test(trimmed);
      case "kotlin":
        return /^import\b/.test(trimmed);
      case "php":
        return /^use\b/.test(trimmed);
      default:
        return /^import\b|^use\b|^using\b|^#\s*include\b|^from\b/.test(trimmed);
    }
  };

  let firstImportLine = -1;
  let lastImportLine = -1;
  let groupDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (groupDepth > 0) {
      lastImportLine = i;
      groupDepth = Math.max(0, groupDepth + countGroupDelta(line));
      continue;
    }

    if (isImportLine(line)) {
      if (firstImportLine === -1) {
        firstImportLine = i;
      }
      lastImportLine = i;
      groupDepth = Math.max(0, countGroupDelta(line));
    } else if (firstImportLine !== -1) {
      if (
        trimmed === "" ||
        trimmed.startsWith("//") ||
        trimmed.startsWith("#") ||
        trimmed.startsWith("/*") ||
        trimmed.startsWith("*")
      ) {
        let hasMoreImports = false;
        for (let j = i + 1; j < Math.min(lines.length, i + 15); j++) {
          if (isImportLine(lines[j])) {
            hasMoreImports = true;
            break;
          }
          const t = lines[j].trim();
          if (
            t !== "" &&
            !t.startsWith("//") &&
            !t.startsWith("#") &&
            !t.startsWith("/*") &&
            !t.startsWith("*")
          ) {
            break;
          }
        }
        if (hasMoreImports) {
          continue;
        }
      }
      break;
    }
  }

  if (firstImportLine === -1) {
    let insertLine = 0;
    if (lines.length > 0 && lines[0].startsWith("#!")) {
      insertLine = 1;
    } else if (targetLang === "go") {
      for (let k = 0; k < lines.length; k++) {
        if (/^package\s+/.test(lines[k].trim())) {
          insertLine = k + 1;
          break;
        }
      }
    }
    const insertPos = insertLine < lineOffsets.length ? lineOffsets[insertLine] : 0;
    return {
      declStart: insertPos,
      fullDeclStart: insertPos,
      declEnd: insertPos,
      tokenStart: insertPos,
      declIndent: "",
      memberName: "imports",
    };
  }

  const declStart = lineOffsets[firstImportLine];
  let declEnd: number;
  if (lastImportLine + 1 < lineOffsets.length) {
    declEnd = lineOffsets[lastImportLine + 1];
  } else {
    declEnd = nativeSource.length;
  }

  return {
    declStart,
    fullDeclStart: declStart,
    declEnd,
    tokenStart: declStart,
    declIndent: "",
    memberName: "imports",
  };
}

export function locateNativeDeclarationSpan(
  nativeSource: string,
  symbolOrTargetLang: string,
  targetLangOrSymbol: TargetLanguage | string,
  explicitClassName?: string,
  preferAccessor?: "get" | "set",
  preferredArity?: number,
  strictForSplice = false,
): NativeSpanInfo | undefined {
  let symbolSelector: string;
  let targetLang: TargetLanguage;
  let classFilter = explicitClassName;

  if (
    KNOWN_TARGET_LANGS_SET.has(symbolOrTargetLang) &&
    !KNOWN_TARGET_LANGS_SET.has(targetLangOrSymbol)
  ) {
    targetLang = symbolOrTargetLang as TargetLanguage;
    symbolSelector = targetLangOrSymbol;
    if (
      classFilter &&
      (classFilter.includes("/") || classFilter.includes("\\") || classFilter.includes("."))
    ) {
      classFilter = undefined;
    }
  } else {
    symbolSelector = symbolOrTargetLang;
    targetLang = targetLangOrSymbol as TargetLanguage;
  }

  const normSelectorLower = symbolSelector.trim().replace(/^:/, "").toLowerCase();
  if (normSelectorLower === "imports" || normSelectorLower === "import") {
    const importSpan = locateImportBlockSpan(nativeSource, targetLang);
    if (importSpan) {
      return enrichSpanWithOffsetsAndLines(nativeSource, importSpan);
    }
  }

  let rawSpan: NativeSpanInfo | undefined;
  if (
    targetLang === "shell" ||
    targetLang === "powershell" ||
    targetLang === "batch" ||
    targetLang === "markdown"
  ) {
    rawSpan = locateScriptOrMarkdownSpan(nativeSource, symbolSelector, targetLang, strictForSplice);
  } else if (targetLang === "python") {
    const cleanPySel = symbolSelector.trim().replace(/\([^)]*\)$/, "");
    rawSpan = locatePythonDeclarationSpan(nativeSource, cleanPySel, classFilter, strictForSplice);
  } else if (targetLang === "aipl") {
    const cleanAiplSel = symbolSelector.trim().replace(/\([^)]*\)$/, "");
    rawSpan = locateAiplDeclarationSpan(nativeSource, cleanAiplSel, classFilter);
  } else if (targetLang === "typescript" || targetLang === "javascript" || targetLang === "tsx") {
    rawSpan = locateTsDeclarationSpan(
      nativeSource,
      symbolSelector,
      classFilter,
      preferAccessor,
      preferredArity,
      strictForSplice,
    );
  } else {
    rawSpan =
      locateBraceLanguageDeclarationSpan(
        nativeSource,
        symbolSelector,
        targetLang,
        classFilter,
        preferredArity,
        strictForSplice,
      ) ??
      locateTsDeclarationSpan(
        nativeSource,
        symbolSelector,
        classFilter,
        preferAccessor,
        preferredArity,
        strictForSplice,
      );
  }

  return enrichSpanWithOffsetsAndLines(nativeSource, rawSpan);
}

function normalizeSelfAndThisInDecl(
  decl: FunctionDecl | MethodDecl,
  targetLang: TargetLanguage,
  isClassMethod = false,
  isStaticMethod = false,
): void {
  if (!isClassMethod || isStaticMethod) {
    return;
  }
  const useThis =
    targetLang === "typescript" ||
    targetLang === "javascript" ||
    targetLang === "csharp" ||
    targetLang === "cpp" ||
    targetLang === "kotlin" ||
    targetLang === "php";
  const hadExplicitSelfParam = decl.params[0]?.name === "self";
  const nonReceiverParamNames = new Set(
    decl.params
      .filter((p, idx) => !(idx === 0 && (p.name === "self" || p.name === "this")))
      .map((p) => p.name),
  );
  if (!useThis) {
    rewriteReceiverIdentifierInNode(decl.body, "self", nonReceiverParamNames);
  } else if (targetLang !== "php" || hadExplicitSelfParam) {
    rewriteReceiverIdentifierInNode(decl.body, "this", nonReceiverParamNames);
  }
}

function isAdditiveKind(k: ts.SyntaxKind): boolean {
  return k === ts.SyntaxKind.PlusToken || k === ts.SyntaxKind.MinusToken;
}

function isMultiplicativeKind(k: ts.SyntaxKind): boolean {
  return (
    k === ts.SyntaxKind.AsteriskToken ||
    k === ts.SyntaxKind.SlashToken ||
    k === ts.SyntaxKind.PercentToken
  );
}

function isAssignmentKind(k: ts.SyntaxKind): boolean {
  return k >= ts.SyntaxKind.FirstAssignment && k <= ts.SyntaxKind.LastAssignment;
}

/**
 * Unwraps redundant parentheses generated by `BinaryExpr` in emitted TypeScript snippets.
 */
function unwrapRedundantTsParens(tsSnippet: string): string {
  let current = tsSnippet;
  for (let pass = 0; pass < 6; pass++) {
    const wrappedPrefix = "class _Wrap {\n";
    const wrappedSuffix = "\n}";
    const isTopLevelFn = /^\s*(?:export\s+)?(?:async\s+)?function\b/.test(current);
    const parseInput = isTopLevelFn ? current : `${wrappedPrefix}${current}${wrappedSuffix}`;
    const offsetDelta = isTopLevelFn ? 0 : wrappedPrefix.length;

    const sf = ts.createSourceFile(
      "snippet.ts",
      parseInput,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );

    const removals: number[] = [];

    const visit = (node: ts.Node) => {
      if (ts.isParenthesizedExpression(node)) {
        const parent = node.parent;
        const inner = node.expression;
        let shouldUnwrap = false;

        if (
          ts.isReturnStatement(parent) ||
          ts.isVariableDeclaration(parent) ||
          ts.isExpressionStatement(parent) ||
          ts.isIfStatement(parent) ||
          ts.isWhileStatement(parent)
        ) {
          shouldUnwrap = true;
        } else if (ts.isCallExpression(parent) && parent.arguments.includes(node)) {
          shouldUnwrap = true;
        } else if (ts.isBinaryExpression(parent)) {
          const parentOp = parent.operatorToken.kind;
          if (isAssignmentKind(parentOp) && parent.right === node) {
            shouldUnwrap = true;
          } else if (ts.isBinaryExpression(inner)) {
            const innerOp = inner.operatorToken.kind;
            if (isMultiplicativeKind(innerOp) && isAdditiveKind(parentOp)) {
              shouldUnwrap = true;
            } else if (
              parent.left === node &&
              ((isAdditiveKind(innerOp) && isAdditiveKind(parentOp)) ||
                (isMultiplicativeKind(innerOp) && isMultiplicativeKind(parentOp)))
            ) {
              shouldUnwrap = true;
            }
          }
        }

        if (shouldUnwrap) {
          const openPos = node.getStart(sf, false) - offsetDelta;
          const closePos = node.getEnd() - 1 - offsetDelta;
          if (
            openPos >= 0 &&
            closePos < current.length &&
            current[openPos] === "(" &&
            current[closePos] === ")"
          ) {
            removals.push(openPos, closePos);
            return;
          }
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(sf);
    if (removals.length === 0) break;

    const removeSet = new Set(removals);
    let next = "";
    for (let i = 0; i < current.length; i++) {
      if (!removeSet.has(i)) next += current[i];
    }
    current = next;
  }
  return current;
}

function stripOneIndentLevel(lines: string[], spaces = 2): string[] {
  const pad = " ".repeat(spaces);
  return lines.map((l) => {
    if (l.startsWith(pad)) return l.slice(spaces);
    if (l.startsWith("\t")) return l.slice(1);
    if (spaces === 4 && l.startsWith("  ")) return l.slice(2);
    return l;
  });
}

function stripTopLevelLanguagePreamble(emitted: string, targetLang: TargetLanguage): string {
  const lines = emitted.trim().split("\n");
  if (targetLang === "python") {
    const idx = lines.findIndex((l) => /^(?:async\s+)?(?:def|class)\s+/.test(l.trim()));
    const relevant = idx >= 0 ? lines.slice(idx) : lines;
    return relevant
      .map((l) =>
        l
          .replace(/^(\s*(?:if|elif|while)\s+)\((.+)\):$/, "$1$2:")
          .replace(/^(\s*[A-Za-z0-9_.]+\s*=\s*)\((.+)\)$/, "$1$2")
          .replace(/^(\s*return\s+)\((.+)\)$/, "$1$2"),
      )
      .join("\n")
      .trimEnd();
  }
  if (targetLang === "go") {
    const idx = lines.findIndex((l) => /^(?:func|type|var|const)\s+/.test(l.trim()));
    return (idx >= 0 ? lines.slice(idx) : lines).join("\n").trimEnd();
  }
  if (targetLang === "rust") {
    const idx = lines.findIndex((l) =>
      /^(?:#\[|pub\s+|async\s+|fn\s+|struct\s+|enum\s+|impl\s+|const\s+|type\s+)/.test(l.trim()),
    );
    return (idx >= 0 ? lines.slice(idx) : lines).join("\n").trimEnd();
  }
  if (targetLang === "cpp") {
    const idx = lines.findIndex(
      (l) =>
        l.trim().length > 0 &&
        !l.trim().startsWith("#pragma once") &&
        !l.trim().startsWith("#include") &&
        !l.trim().startsWith("using namespace"),
    );
    let cppLines = idx >= 0 ? lines.slice(idx) : lines;
    if (
      cppLines.length >= 2 &&
      /^namespace\s+[^\s{]+\s*\{/.test(cppLines[0].trim()) &&
      /^\}\s*(?:\/\/\s*namespace\b.*)?$/.test(cppLines[cppLines.length - 1].trim())
    ) {
      cppLines = stripOneIndentLevel(cppLines.slice(1, cppLines.length - 1), 4);
    }
    return cppLines.join("\n").trim();
  }
  if (targetLang === "csharp") {
    const staticModIdx = lines.findIndex((l) => /^public static class\s+/.test(l.trim()));
    if (staticModIdx >= 0) {
      let bodyStart = staticModIdx + 1;
      if (lines[bodyStart]?.trim() === "{") bodyStart++;
      const inner = stripOneIndentLevel(lines.slice(bodyStart, lines.length - 1), 4);
      return inner.join("\n").trimEnd();
    }
    const idx = lines.findIndex((l) => l.trim().length > 0 && !l.trim().startsWith("using "));
    return (idx >= 0 ? lines.slice(idx) : lines).join("\n").trimEnd();
  }
  if (targetLang === "kotlin") {
    const idx = lines.findIndex(
      (l) =>
        l.trim().length > 0 && !l.trim().startsWith("package ") && !l.trim().startsWith("import "),
    );
    return (idx >= 0 ? lines.slice(idx) : lines).join("\n").trimEnd();
  }
  if (targetLang === "php") {
    const idx = lines.findIndex(
      (l) =>
        l.trim().length > 0 &&
        !l.trim().startsWith("<?php") &&
        !l.trim().startsWith("declare(") &&
        !l.trim().startsWith("namespace ") &&
        !l.trim().startsWith("use "),
    );
    return (idx >= 0 ? lines.slice(idx) : lines).join("\n").trimEnd();
  }
  return targetLang === "typescript" || targetLang === "javascript"
    ? unwrapRedundantTsParens(emitted.trim())
    : emitted.trim();
}

function splitTopLevelParams(paramList: string): string[] {
  const parts: string[] = [];
  let depthAngle = 0;
  let depthParen = 0;
  let current = "";
  for (let i = 0; i < paramList.length; i++) {
    const ch = paramList[i];
    if (ch === "<") depthAngle++;
    else if (ch === ">" && depthAngle > 0) depthAngle--;
    else if (ch === "(") depthParen++;
    else if (ch === ")" && depthParen > 0) depthParen--;
    else if (ch === "," && depthAngle === 0 && depthParen === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim().length > 0) {
    parts.push(current);
  }
  return parts;
}

function restoreCppQualifiersAndScopes(
  emitted: string,
  origHeader?: string,
  referenceTexts?: (string | undefined)[],
): string {
  let result = emitted;

  // 1. Restore C++ scope resolution chains (e.g. a::b::c::fn or givemeabigstring::out)
  const scopeChains = new Set<string>();
  const namespacePrefixes = new Set<string>();
  for (const text of referenceTexts ?? []) {
    if (!text) continue;
    for (const m of text.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*(?:::[A-Za-z_][A-Za-z0-9_]*)+)\b/g)) {
      const chain = m[1];
      if (chain.startsWith("std::")) continue;
      scopeChains.add(chain);
      const segments = chain.split("::");
      if (segments.length >= 2) {
        namespacePrefixes.add(segments.slice(0, -1).join("::"));
      }
    }
  }

  for (const chain of scopeChains) {
    const dotted = chain.replace(/::/g, "\\.");
    result = result.replace(new RegExp(`\\b${dotted}\\b`, "g"), chain);
  }

  for (const nsPrefix of namespacePrefixes) {
    const dottedNs = nsPrefix.replace(/::/g, "\\.");
    result = result.replace(
      new RegExp(`\\b${dottedNs}\\.([A-Za-z_][A-Za-z0-9_]*)\\s*\\(`, "g"),
      `${nsPrefix}::$1(`,
    );
  }

  // 2. Restore C++ parameter qualifiers (const Type& param, Type& param, including template types)
  if (origHeader) {
    const openParen = origHeader.indexOf("(");
    const closeParen = origHeader.lastIndexOf(")");
    if (openParen >= 0 && closeParen > openParen) {
      const rawOrigParams = splitTopLevelParams(origHeader.slice(openParen + 1, closeParen));
      const qualByParamName = new Map<string, { fullDecl: string; normBaseType: string }>();
      for (const rawParam of rawOrigParams) {
        const trimmed = rawParam.trim();
        const pm = trimmed.match(/^(const\s+.+?&|.+?&)\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:=.*)?$/s);
        if (pm) {
          const qualType = pm[1].trim();
          const pName = pm[2];
          const normBaseType = qualType
            .replace(/^const\s+/, "")
            .replace(/\s*&\s*$/, "")
            .replace(/\s+/g, "");
          qualByParamName.set(pName, { fullDecl: `${qualType} ${pName}`, normBaseType });
        }
      }

      if (qualByParamName.size > 0) {
        const lines = result.split("\n");
        const firstLine = lines[0] ?? "";
        const emOpen = firstLine.indexOf("(");
        const emClose = firstLine.lastIndexOf(")");
        if (emOpen >= 0 && emClose > emOpen) {
          const emParams = splitTopLevelParams(firstLine.slice(emOpen + 1, emClose));
          const updatedParams = emParams.map((emParam) => {
            const trimmedEm = emParam.trim();
            const emMatch = trimmedEm.match(/^(.+?)\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:=.*)?$/s);
            if (!emMatch) return emParam;
            const emType = emMatch[1].trim();
            const emName = emMatch[2];
            const origInfo = qualByParamName.get(emName);
            if (!origInfo) return emParam;
            const normEmType = emType
              .replace(/^const\s+/, "")
              .replace(/\s*&\s*$/, "")
              .replace(/\s+/g, "");
            if (normEmType === origInfo.normBaseType) {
              const leadingWs = emParam.match(/^\s*/)?.[0] ?? "";
              return `${leadingWs}${origInfo.fullDecl}`;
            }
            return emParam;
          });
          lines[0] = `${firstLine.slice(0, emOpen + 1)}${updatedParams.join(",")}${firstLine.slice(emClose)}`;
          result = lines.join("\n");
        }
      }
    }
  }

  return result;
}

function emitExpandedDeclForTarget(
  expandedDecl: FunctionDecl | MethodDecl,
  targetLang: TargetLanguage,
  filePath: string,
  className?: string,
  origMeta?: {
    visibility?: "public" | "private" | "protected";
    isExported?: boolean;
    isStatic?: boolean;
    isAsync?: boolean;
    accessor?: "get" | "set";
    memberName?: string;
    goReceiver?: string;
    cppOutOfLine?: boolean;
    origHeader?: string;
    origSource?: string;
    rawSnippet?: string;
    idioms?: Record<string, ProjectIdiomDefinition>;
  },
): string {
  const cloned = structuredClone(expandedDecl);
  const isClassMethod = Boolean(className || cloned.kind === "MethodDecl");
  const resolvedIsStatic = Boolean(
    origMeta?.isStatic ?? ("isStatic" in cloned ? cloned.isStatic : false),
  );
  normalizeSelfAndThisInDecl(cloned, targetLang, isClassMethod, resolvedIsStatic);

  const dummySpan = cloned.span;

  if (isClassMethod) {
    let resolvedMethodName = origMeta?.memberName ?? cloned.name;
    if (resolvedMethodName === "__init__" && targetLang !== "python") {
      resolvedMethodName = "constructor";
    }
    const methodNode: MethodDecl = {
      kind: "MethodDecl",
      name: resolvedMethodName,
      typeParams: cloned.typeParams ?? [],
      params: resolvedIsStatic
        ? cloned.params
        : cloned.params.filter((p, idx) => !(idx === 0 && (p.name === "self" || p.name === "this"))),
      returnType: cloned.returnType,
      isAsync: Boolean(origMeta?.isAsync ?? cloned.isAsync),
      isStatic: resolvedIsStatic,
      accessor: origMeta?.accessor ?? ("accessor" in cloned ? cloned.accessor : undefined),
      isExpressionBodied: cloned.isExpressionBodied,
      body: cloned.body,
      span: dummySpan,
    };
    if (targetLang === "python") {
      normalizePythonMethodReturn(methodNode);
    }

    const tempClass: ClassDecl = {
      kind: "ClassDecl",
      name: className || "_TmpClass",
      isExported: false,
      typeParams: [],
      properties: [],
      methods: [methodNode],
      staticBlocks: [],
      span: dummySpan,
    };

    const tempMod: Module = {
      kind: "Module",
      path: path.basename(filePath),
      items: [tempClass],
      span: dummySpan,
    };

    const emittedClass = emitTarget(tempMod, targetLang, { watermark: false }).trim();
    const lines = emittedClass.split("\n");

    if (targetLang === "python") {
      const classLineIdx = lines.findIndex((l) => /^class\s+/.test(l.trim()));
      const startIdx = classLineIdx >= 0 ? classLineIdx + 1 : 1;
      const innerLines = lines
        .slice(startIdx)
        .map((l) => (l.startsWith("    ") ? l.slice(4) : l))
        .map((l) =>
          l
            .replace(/^(\s*(?:if|elif|while)\s+)\((.+)\):$/, "$1$2:")
            .replace(/^(\s*[A-Za-z0-9_.]+\s*=\s*)\((.+)\)$/, "$1$2")
            .replace(/^(\s*return\s+)\((.+)\)$/, "$1$2"),
        );
      if (origMeta?.isStatic && innerLines[0]?.trim() === "@staticmethod") {
        innerLines.shift();
      }
      return innerLines.join("\n").trimEnd();
    }

    if (targetLang === "go") {
      let recvFuncIdx = -1;
      for (let i = lines.length - 1; i >= 0; i--) {
        if (/^func\s+\(/.test(lines[i].trim())) {
          recvFuncIdx = i;
          break;
        }
      }
      if (recvFuncIdx >= 0) {
        const goLines = lines.slice(recvFuncIdx);
        if (origMeta?.goReceiver) {
          const targetMethodName = origMeta.memberName ?? methodNode.name;
          goLines[0] = goLines[0].replace(
            /^func\s+\([^)]+\)\s+[A-Za-z0-9_]+\s*\(/,
            `func ${origMeta.goReceiver} ${targetMethodName}(`,
          );
        }
        if (
          origMeta?.origHeader &&
          /\bint\b/.test(origMeta.origHeader) &&
          !/\bint64\b/.test(origMeta.origHeader)
        ) {
          goLines[0] = goLines[0].replace(/\bint64\b/g, "int");
        }
        return goLines.join("\n").trimEnd();
      }
    }

    if (targetLang === "rust") {
      const implIdx = lines.findIndex((l) => /^impl\b/.test(l.trim()));
      if (implIdx >= 0) {
        const inner = stripOneIndentLevel(lines.slice(implIdx + 1, lines.length - 1), 4);
        return inner.join("\n").trimEnd();
      }
    }

    if (targetLang === "cpp") {
      const clsIdx = lines.findIndex((l) => /^class\s+/.test(l.trim()));
      if (clsIdx >= 0) {
        let startIdx = clsIdx + 1;
        if (lines[startIdx]?.trim() === "public:") startIdx++;
        let endIdx = lines.length - 1;
        while (endIdx > startIdx && lines[endIdx].trim() === "") {
          endIdx--;
        }
        if (/^};?\s*$/.test(lines[endIdx]?.trim() ?? "")) {
          endIdx--;
        }
        const inner = stripOneIndentLevel(lines.slice(startIdx, endIdx + 1), 4);
        if (origMeta?.cppOutOfLine && className && inner.length > 0) {
          inner[0] = inner[0].replace(
            new RegExp(`\\b(${methodNode.name})\\s*\\(`),
            `${className}::$1(`,
          );
        }
        if (
          inner.length > 0 &&
          origMeta?.origHeader &&
          /\bdouble\b/.test(origMeta.origHeader) &&
          !/\bfloat\b/.test(origMeta.origHeader)
        ) {
          inner[0] = inner[0].replace(/\bfloat\b/g, "double");
        }
        const idiomTexts = origMeta?.idioms
          ? Object.values(origMeta.idioms).flatMap((id) => [id.templateAice, id.description])
          : [];
        return restoreCppQualifiersAndScopes(inner.join("\n").trimEnd(), origMeta?.origHeader, [
          origMeta?.origSource,
          origMeta?.rawSnippet,
          ...idiomTexts,
        ]);
      }
    }

    if (targetLang === "csharp") {
      const clsIdx = lines.findIndex((l) =>
        /^(?:public\s+|static\s+|partial\s+|internal\s+|sealed\s+|abstract\s+)*class\s+/.test(
          l.trim(),
        ),
      );
      if (clsIdx >= 0) {
        let startIdx = clsIdx + 1;
        if (lines[startIdx]?.trim() === "{") startIdx++;
        const inner = stripOneIndentLevel(lines.slice(startIdx, lines.length - 1), 4);
        if (inner.length > 0 && origMeta?.visibility) {
          inner[0] = inner[0].replace(/^(public|private|protected)\b/, origMeta.visibility);
        }
        return inner.join("\n").trimEnd();
      }
    }

    if (targetLang === "kotlin" || targetLang === "php") {
      const clsIdx = lines.findIndex((l) => /^(?:data\s+)?(?:class|interface)\s+/.test(l.trim()));
      if (clsIdx >= 0) {
        let endIdx = lines.length - 1;
        while (endIdx > clsIdx && lines[endIdx].trim() === "") endIdx--;
        if (lines[endIdx]?.trim() === "}") endIdx--;
        const inner = stripOneIndentLevel(lines.slice(clsIdx + 1, endIdx + 1), 4);
        if (inner.length > 0 && origMeta?.visibility) {
          const firstTrimmed = inner[0].trimStart();
          if (/^(?:public|private|protected)\s+/.test(firstTrimmed)) {
            inner[0] = inner[0].replace(/^(?:public|private|protected)\b/, origMeta.visibility);
          } else if (targetLang === "kotlin" && origMeta.visibility !== "public") {
            inner[0] = `${origMeta.visibility} ${firstTrimmed}`;
          }
        }
        return inner.join("\n").trimEnd();
      }
    }

    // TypeScript / JavaScript class wrapper: strip `class _TmpClass {` and closing `}`
    const innerLines = lines
      .slice(1, lines.length - 1)
      .map((l) => (l.startsWith("  ") ? l.slice(2) : l));

    if (
      innerLines.length > 0 &&
      origMeta?.visibility &&
      (targetLang === "typescript" || targetLang === "javascript")
    ) {
      const firstTrimmed = innerLines[0].trimStart();
      if (
        !firstTrimmed.startsWith("public ") &&
        !firstTrimmed.startsWith("private ") &&
        !firstTrimmed.startsWith("protected ")
      ) {
        innerLines[0] = `${origMeta.visibility} ${firstTrimmed}`;
      }
    }

    const joined = innerLines.join("\n").trimEnd();
    return targetLang === "typescript" || targetLang === "javascript"
      ? unwrapRedundantTsParens(joined)
      : joined;
  }

  const fnNode: FunctionDecl = {
    kind: "FunctionDecl",
    name: origMeta?.memberName ?? cloned.name,
    isExported: origMeta?.isExported ?? ("isExported" in cloned ? cloned.isExported : false),
    isAsync: Boolean(origMeta?.isAsync ?? cloned.isAsync),
    typeParams: cloned.typeParams ?? [],
    params: cloned.params,
    returnType: cloned.returnType,
    isExpressionBodied: cloned.isExpressionBodied,
    body: cloned.body,
    span: dummySpan,
  };

  const tempMod: Module = {
    kind: "Module",
    path: path.basename(filePath),
    items: [fnNode],
    span: dummySpan,
  };

  const emittedFn = emitTarget(tempMod, targetLang, { watermark: false }).trim();
  let strippedFn = stripTopLevelLanguagePreamble(emittedFn, targetLang);
  if (
    targetLang === "go" &&
    origMeta?.origHeader &&
    /\bint\b/.test(origMeta.origHeader) &&
    !/\bint64\b/.test(origMeta.origHeader)
  ) {
    const fnLines = strippedFn.split("\n");
    fnLines[0] = fnLines[0].replace(/\bint64\b/g, "int");
    strippedFn = fnLines.join("\n");
  } else if (targetLang === "cpp") {
    if (
      origMeta?.origHeader &&
      /\bdouble\b/.test(origMeta.origHeader) &&
      !/\bfloat\b/.test(origMeta.origHeader)
    ) {
      const fnLines = strippedFn.split("\n");
      fnLines[0] = fnLines[0].replace(/\bfloat\b/g, "double");
      strippedFn = fnLines.join("\n");
    }
    const idiomTexts = origMeta?.idioms
      ? Object.values(origMeta.idioms).flatMap((id) => [id.templateAice, id.description])
      : [];
    strippedFn = restoreCppQualifiersAndScopes(strippedFn, origMeta?.origHeader, [
      origMeta?.origSource,
      origMeta?.rawSnippet,
      ...idiomTexts,
    ]);
  }
  return targetLang === "typescript" || targetLang === "javascript"
    ? unwrapRedundantTsParens(strippedFn)
    : strippedFn;
}

/**
 * Surgically splices an already-expanded AICE FunctionDecl or MethodDecl into a native source string,
 * preserving 100% bit-identical bytes before and after the target declaration.
 */
export function spliceNativeSymbolFromExpandedAst(
  nativeSource: string,
  symbolSelector: string,
  expandedDecl: FunctionDecl | MethodDecl,
  filePath: string,
  targetLang: TargetLanguage,
  explicitClassName?: string,
): string {
  const spanInfo = locateNativeDeclarationSpan(
    nativeSource,
    symbolSelector,
    targetLang,
    explicitClassName,
    "accessor" in expandedDecl ? expandedDecl.accessor : undefined,
  );

  if (!spanInfo) {
    throw new Error(`Symbol '${symbolSelector}' not found in ${filePath}${didYouMeanSymbol(nativeSource, symbolSelector)}`);
  }

  const emittedUnindented = emitExpandedDeclForTarget(
    expandedDecl,
    targetLang,
    filePath,
    spanInfo.className ?? explicitClassName,
    {
      visibility: spanInfo.visibility,
      isExported: spanInfo.isExported,
      isStatic: spanInfo.isStatic,
      isAsync: spanInfo.isAsync,
      accessor: spanInfo.accessor,
      memberName: spanInfo.memberName,
      goReceiver: spanInfo.goReceiver,
      cppOutOfLine: spanInfo.cppOutOfLine,
      origHeader: spanInfo.origHeader,
      origSource: nativeSource.slice(spanInfo.declStart, spanInfo.declEnd),
    },
  );

  const indented = indentCode(emittedUnindented, spanInfo.declIndent);
  return `${nativeSource.slice(0, spanInfo.declStart)}${indented}${nativeSource.slice(spanInfo.declEnd)}`;
}

function normalizeFrankensteinSnippetToAice(snippet: string): {
  normalizedAice: string;
  explicitVisibility?: "public" | "private" | "protected";
  isExported?: boolean;
  explicitAccessor?: "get" | "set";
  leadingDecorators: string[];
} {
  const lines = snippet.trim().split("\n");
  const leadingDecorators: string[] = [];
  while (
    lines.length > 1 &&
    /^\s*(?:@[A-Za-z_][A-Za-z0-9_.]*(?:\([^)]*\))?|#\[[^\]]+\])\s*$/.test(lines[0])
  ) {
    leadingDecorators.push(lines.shift()!.trim());
  }

  let explicitVisibility: "public" | "private" | "protected" | undefined;
  let isExported: boolean | undefined;
  let explicitAccessor: "get" | "set" | undefined;

  if (lines.length > 0) {
    let header = lines[0];
    const visMatch = header.match(/^\s*(public|private|protected)\s+/);
    if (visMatch) {
      explicitVisibility = visMatch[1] as "public" | "private" | "protected";
      if (explicitVisibility === "public") isExported = true;
      header = header.replace(/^\s*(?:public|private|protected)\s+/, "pub ");
    } else if (/^\s*pub\s+/.test(header) || /^\s*export\s+/.test(header)) {
      isExported = true;
      header = header.replace(/^\s*export\s+(?:function\s+)?/, "pub fn ");
    } else if (/^\s*(?:async\s+)?def\s+/.test(header)) {
      header = header.replace(/^(\s*)(async\s+)?def\s+/, "$1$2fn ");
    } else if (/^\s*(?:async\s+)?function\s+/.test(header)) {
      header = header.replace(/^(\s*)(async\s+)?function\s+/, "$1$2fn ");
      header = header.replace(/\)\s*:\s*([^{:]+)\s*(:|\{)\s*$/, ") -> $1$2");
    } else if (/^\s*(?:suspend\s+)?fun\s+/.test(header)) {
      header = header.replace(/^(\s*)(?:suspend\s+)?fun\s+/, "$1fn ");
      header = header.replace(/\)\s*:\s*([^{:]+)\s*(:|\{)\s*$/, ") -> $1$2");
    }

    const accMatch = header.match(
      /^\s*(?:pub\s+)?(?:static\s+)?(get|set)\s+(?:fn\s+)?([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/,
    );
    if (accMatch) {
      explicitAccessor = accMatch[1] as "get" | "set";
      header = header.replace(/^(\s*(?:pub\s+)?(?:static\s+)?)(?:get|set)\s+(?:fn\s+)?/, "$1fn ");
      header = header.replace(/\)\s*:\s*([^{:]+)\s*(:|\{)\s*$/, ") -> $1$2");
    }

    // Also normalize TS-style header without `fn`: e.g. `pub computeMetric(x: number): number {` or `constructor(...)`
    if (
      !/^\s*(?:pub\s+)?(?:static\s+)?(?:async\s+)?(?:fn|class|type|rec|enum|const|val|mut|interface|component)\b/.test(
        header,
      ) &&
      /^\s*(?:pub\s+)?(?:static\s+)?(?:async\s+)?[A-Za-z_$][A-Za-z0-9_$]*\s*\(/.test(header)
    ) {
      header = header.replace(
        /^(\s*(?:pub\s+)?(?:static\s+)?(?:async\s+)?)([A-Za-z_$][A-Za-z0-9_$]*\s*\()/,
        "$1fn $2",
      );
      header = header.replace(/\)\s*:\s*([^{:]+)\s*(:|\{)\s*$/, ") -> $1$2");
    }

    lines[0] = header;
  }

  const normalizedLines = lines.map((line, idx) => {
    if (idx === 0) return line.replace(/\breturn\b/, "ret");
    return line.replace(/^(\s*)return\b/, "$1ret");
  });

  return {
    normalizedAice: normalizedLines.join("\n"),
    explicitVisibility,
    isExported,
    explicitAccessor,
    leadingDecorators,
  };
}

function convertFrankensteinToNativeForDecompile(
  snippet: string,
  targetLang: TargetLanguage,
  isBodyOnly = false,
  isClassMethod = false,
): string {
  const lines = snippet.trim().split("\n");
  if (targetLang === "python") {
    return lines
      .map((line, idx) => {
        let out = line.replace(/\$([A-Za-z_][A-Za-z0-9_]*)\s*\(/g, "__aice_idiom__$1(");
        if (idx === 0 && !isBodyOnly) {
          out = out.replace(/^(\s*)(?:pub\s+)?(async\s+)?fn\s+/, "$1$2def ");
        }
        out = out
          .replace(/^(\s*)::?=\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/, "$1$2 = $3")
          .replace(/^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:\s*[^=]+?\s*::?=\s*(.+)$/, "$1$2 = $3")
          .replace(/^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*::?=\s*(.+)$/, "$1$2 = $3")
          .replace(/^(\s*)(?:ret|<-)\b/, "$1return");
        return out;
      })
      .join("\n");
  }

  return lines
    .map((line, idx) => {
      let out = line.replace(/\$([A-Za-z_][A-Za-z0-9_]*)\s*\(/g, "__aice_idiom__$1(");
      if (idx === 0 && !isBodyOnly) {
        if (isClassMethod) {
          out = out
            .replace(/^(\s*)pub\s+async\s+fn\s+/, "$1public async ")
            .replace(/^(\s*)pub\s+fn\s+/, "$1public ")
            .replace(/^(\s*)async\s+fn\s+/, "$1async ")
            .replace(/^(\s*)fn\s+/, "$1")
            .replace(/\)\s*->\s*([^{:]+)\s*\{\s*$/, "): $1 {");
        } else {
          out = out
            .replace(/^(\s*)pub\s+async\s+fn\s+/, "$1export async function ")
            .replace(/^(\s*)pub\s+fn\s+/, "$1export function ")
            .replace(/^(\s*)async\s+fn\s+/, "$1async function ")
            .replace(/^(\s*)fn\s+/, "$1function ")
            .replace(/\)\s*->\s*([^{:]+)\s*\{\s*$/, "): $1 {");
        }
      }
      out = out
        .replace(/^(\s*)val\s+(?=[A-Za-z_$[{])/, "$1const ")
        .replace(/^(\s*)(?:let\s+)?mut\s+(?=[A-Za-z_$[{])/, "$1let ")
        .replace(/^(\s*):=\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(.+)$/, "$1const $2 = $3")
        .replace(/^(\s*)::=\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(.+)$/, "$1let $2 = $3")
        .replace(
          /^(\s*)([A-Za-z_$][A-Za-z0-9_$]*)\s*:\s*([^=]+?)\s*:=\s*(.+)$/,
          "$1const $2: $3 = $4",
        )
        .replace(/^(\s*)([A-Za-z_$][A-Za-z0-9_$]*)\s*:=\s*(.+)$/, "$1const $2 = $3")
        .replace(
          /^(\s*)([A-Za-z_$][A-Za-z0-9_$]*)\s*:\s*([^=]+?)\s*::=\s*(.+)$/,
          "$1let $2: $3 = $4",
        )
        .replace(/^(\s*)([A-Za-z_$][A-Za-z0-9_$]*)\s*::=\s*(.+)$/, "$1let $2 = $3")
        .replace(/^(\s*)(?:ret|<-)\b/, "$1return")
        .replace(/(\)\s+)(?:ret|<-)\b/g, "$1return")
        .replace(/(\{\s*)(?:ret|<-)\b/g, "$1return");
      return out;
    })
    .join("\n");
}

function restorePythonIdiomPlaceholders(aiceSource: string): string {
  return aiceSource.replace(/__aice_idiom__([A-Za-z_][A-Za-z0-9_]*)/g, "$$$1");
}

function tryEmitNonCallableAiceSnippet(
  rawSnippet: string,
  filePath: string,
  targetLang: TargetLanguage,
  className?: string,
  idioms?: Record<string, ProjectIdiomDefinition>,
  isClassContainerTarget?: boolean,
): string | undefined {
  const trimmed = rawSnippet.trim();
  const isNonCallableAice =
    /^(?:pub\s+)?(?:type|rec|enum|interface|class|const|val|mut|component|style)\b/.test(trimmed);
  if (!isNonCallableAice) return undefined;

  let normalizedNonCallable = trimmed;
  const braceTypeMatch = trimmed.match(
    /^((?:pub\s+)?)(?:type|rec|interface)\s+([A-Za-z_$][A-Za-z0-9_$]*(?:\s*\[[^\]]+\])?)\s*(?:=\s*)?\{([\s\S]*)\}\s*;?$/,
  );
  if (braceTypeMatch && !braceTypeMatch[3].includes("|")) {
    const [, pubPrefix, typeName, rawFields] = braceTypeMatch;
    const fieldLines = rawFields
      .split("\n")
      .map((l) => l.trim().replace(/[,;]\s*$/, ""))
      .filter((l) => l.length > 0)
      .map((l) => `  ${l}`);
    normalizedNonCallable = `${pubPrefix}type ${typeName}:\n${fieldLines.join("\n")}`;
  }

  try {
    const mod = parse(normalizedNonCallable, filePath);
    const expanded =
      idioms && Object.keys(idioms).length > 0 ? expandModuleIdioms(mod, idioms) : mod;
    for (const item of expanded.items) {
      if (
        item.kind === "TypeDecl" ||
        item.kind === "ConstDecl" ||
        item.kind === "VarDecl" ||
        item.kind === "ComponentDecl" ||
        item.kind === "StyleDecl" ||
        (item.kind === "ClassDecl" && (!className || isClassContainerTarget))
      ) {
        const singleMod: Module = normalizeModuleForTarget(
          {
            kind: "Module",
            path: path.basename(filePath),
            items: [item],
            span: mod.span,
          },
          targetLang,
        );
        const emitted = emitTarget(singleMod, targetLang, { watermark: false }).trim();
        return stripTopLevelLanguagePreamble(emitted, targetLang);
      }
    }
  } catch {
    // fall through
  }
  return undefined;
}

function parseSnippetToExpandedDecl(
  rawSnippet: string,
  filePath: string,
  targetLang: TargetLanguage,
  className?: string,
  idioms?: Record<string, ProjectIdiomDefinition>,
  originalSnippet?: string,
  isBodyOnly?: boolean,
): {
  decl: FunctionDecl | MethodDecl;
  explicitVisibility?: "public" | "private" | "protected";
  isExported?: boolean;
  explicitAccessor?: "get" | "set";
  leadingDecorators: string[];
} {
  const { normalizedAice, explicitVisibility, isExported, explicitAccessor, leadingDecorators } =
    normalizeFrankensteinSnippetToAice(rawSnippet);

  let parsedMod: Module | undefined;
  let lastErr: unknown;

  // Attempt 1: Try parsing as a full function/method declaration (even if passed via -b/--body)
  try {
    parsedMod = parse(normalizedAice, filePath);
  } catch (err) {
    lastErr = err;
  }

  const hasFnOrClassDecl = (mod?: Module): boolean =>
    Boolean(
      mod?.items.some(
        (it) =>
          (it.kind === "FunctionDecl" && it.name !== "__top_level__") ||
          (it.kind === "ClassDecl" && it.methods.length > 0),
      ),
    );

  // Attempt 2: If body-only or parsed only as __top_level__ statements, wrap statements inside the original declaration signature!
  if (!hasFnOrClassDecl(parsedMod) && originalSnippet) {
    let holderFn: FunctionDecl | undefined;
    try {
      const bodyLines = rawSnippet
        .trim()
        .split("\n")
        .map((line) => line.replace(/^(\s*)return\b/, "$1ret"));
      const wrappedBodyAice = `fn __body_holder__():\n${indentCode(bodyLines.join("\n"), "  ")}`;
      const bodyMod = parse(wrappedBodyAice, filePath);
      const expandedBodyMod =
        idioms && Object.keys(idioms).length > 0 ? expandModuleIdioms(bodyMod, idioms) : bodyMod;
      holderFn = expandedBodyMod.items.find(
        (it): it is FunctionDecl => it.kind === "FunctionDecl" && it.name === "__body_holder__",
      );
    } catch (bodyErr) {
      lastErr = lastErr ?? bodyErr;
      try {
        const decompLang = targetLang === "python" ? "python" : "typescript";
        const nativeBody = convertFrankensteinToNativeForDecompile(rawSnippet, decompLang, true);
        const wrappedNativeBody =
          decompLang === "python"
            ? `def __body_holder__():\n${indentCode(nativeBody, "    ")}\n`
            : `function __body_holder__() {\n${indentCode(nativeBody, "  ")}\n}\n`;
        const decompBody = decompile(wrappedNativeBody, decompLang, { filePath });
        const restoredAice = restorePythonIdiomPlaceholders(decompBody.aice);
        const bodyMod = parse(restoredAice, filePath);
        const expandedBodyMod =
          idioms && Object.keys(idioms).length > 0 ? expandModuleIdioms(bodyMod, idioms) : bodyMod;
        holderFn = expandedBodyMod.items.find(
          (it): it is FunctionDecl => it.kind === "FunctionDecl" && it.name === "__body_holder__",
        );
      } catch {
        // fall through
      }
    }

    if (holderFn) {
      try {
        let wrappedOrig = originalSnippet;
        if (className) {
          if (targetLang === "typescript" || targetLang === "javascript" || targetLang === "tsx") {
            wrappedOrig = `class ${className} {\n${originalSnippet}\n}`;
          } else if (targetLang === "rust") {
            wrappedOrig = `struct ${className} {}\nimpl ${className} {\n${originalSnippet}\n}`;
          } else if (targetLang === "go") {
            wrappedOrig = `package main\ntype ${className} struct {}\n${originalSnippet}`;
          } else if (targetLang === "csharp" || targetLang === "kotlin" || targetLang === "cpp") {
            wrappedOrig = `class ${className} {\n${originalSnippet}\n}`;
          } else if (targetLang === "php") {
            wrappedOrig = `<?php\nclass ${className} {\n${originalSnippet}\n}`;
          }
        } else if (targetLang === "go" && !originalSnippet.trimStart().startsWith("package ")) {
          wrappedOrig = `package main\n${originalSnippet}`;
        } else if (targetLang === "php" && !originalSnippet.trimStart().startsWith("<?php")) {
          wrappedOrig = `<?php\n${originalSnippet}`;
        }

        const origDecomp = decompile(wrappedOrig, targetLang, { filePath });
        const origMod = parse(origDecomp.aice, filePath);

        for (const item of origMod.items) {
          if (item.kind === "FunctionDecl" && item.name !== "__top_level__") {
            return {
              decl: {
                ...item,
                isExpressionBodied: false,
                body: holderFn.body,
              },
              explicitVisibility,
              isExported,
              explicitAccessor,
              leadingDecorators,
            };
          }
          if (item.kind === "ClassDecl" && item.methods.length > 0) {
            return {
              decl: {
                ...item.methods[0],
                isExpressionBodied: false,
                body: holderFn.body,
              },
              explicitVisibility,
              isExported,
              explicitAccessor,
              leadingDecorators,
            };
          }
        }
      } catch (origErr) {
        lastErr = lastErr ?? origErr;
      }
    }
  }

  // Attempt 3: Decompile native or hybrid Frankenstein snippet (e.g., raw TypeScript or Python function/method + $idioms / := / ret)
  if (!hasFnOrClassDecl(parsedMod)) {
    try {
      const decompLang = targetLang === "python" ? "python" : "typescript";
      const preparedNative = convertFrankensteinToNativeForDecompile(
        rawSnippet,
        decompLang,
        false,
        Boolean(className),
      );
      const wrappedNative =
        className && decompLang === "typescript"
          ? `class ${className} {\n${preparedNative}\n}`
          : preparedNative;
      const decomp = decompile(wrappedNative, decompLang, { filePath });
      const restoredAice = restorePythonIdiomPlaceholders(decomp.aice);
      parsedMod = parse(restoredAice, filePath);
    } catch (decompErr) {
      throw new Error(
        `Syntax error in splice snippet for ${filePath}: ${lastErr instanceof Error ? lastErr.message : String(decompErr)}`,
      );
    }
  }

  if (!parsedMod) {
    throw new Error(`Failed to parse splice snippet for ${filePath}`);
  }

  // Expand project idioms (always expand even if idiomsEnabled is false -> Stale AI Memory Grace!)
  const expandedMod =
    idioms && Object.keys(idioms).length > 0 ? expandModuleIdioms(parsedMod, idioms) : parsedMod;

  for (const item of expandedMod.items) {
    if (item.kind === "FunctionDecl" && item.name !== "__top_level__") {
      return { decl: item, explicitVisibility, isExported, explicitAccessor, leadingDecorators };
    }
    if (item.kind === "ClassDecl" && item.methods.length > 0) {
      return {
        decl: item.methods[0],
        explicitVisibility,
        isExported,
        explicitAccessor,
        leadingDecorators,
      };
    }
  }

  throw new Error(
    `No valid function or method declaration found in splice snippet for ${filePath}`,
  );
}

function dedentSnippet(snippet: string): string {
  const lines = snippet.replace(/\r\n/g, "\n").split("\n");
  while (lines.length > 0 && lines[0].trim() === "") lines.shift();
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
  if (lines.length <= 1) return lines.join("\n").trim();

  // If line 0 has no leading indent (common when template literals start at col 0)
  // only dedent lines that share a common indent across all non-empty lines.
  let minIndent = Number.POSITIVE_INFINITY;
  for (const line of lines) {
    if (!line.trim()) continue;
    const ind = line.match(/^[ \t]*/)?.[0].length ?? 0;
    if (ind < minIndent) minIndent = ind;
  }
  if (minIndent > 0 && Number.isFinite(minIndent)) {
    return lines.map((l) => (l.trim() ? l.slice(minIndent) : "")).join("\n");
  }
  return lines.join("\n");
}

function shouldUseLosslessPreprocessorForSnippet(
  cleanedSnippet: string,
  targetLang: TargetLanguage,
  isBodyOnly: boolean,
  forceLosslessPreprocess: boolean,
): boolean {
  if (forceLosslessPreprocess) return true;
  if (isBodyOnly) return false;
  const trimmed = cleanedSnippet.trim();
  if (!trimmed) return false;

  if (/^(?:(?:#[^\n]*|module\s+[^\n]+)\n+|\s)*(?:pub\s+)?(?:component|style)\b/m.test(trimmed)) {
    return false;
  }

  if (targetLang === "python") {
    return (
      /^\s*@(?!fn\b|cls\b|type\b|idiom\b)[A-Za-z_]/m.test(trimmed) ||
      /^\s*match\s+[^:\n]+:\s*$/m.test(trimmed) ||
      /\basync\s+for\b/.test(trimmed) ||
      trimmed.includes('"""') ||
      trimmed.includes("'''") ||
      /\b[A-Za-z0-9_[\]]+\s*\|\s*[A-Za-z0-9_[\]]+/.test(trimmed) ||
      /^\s*(?:@fn\b|\^fn\b|@cls\b|\^class\b)/.test(trimmed) ||
      (/^\s*(?:async\s+)?(?:def|class)\s+[A-Za-z_]/m.test(trimmed) &&
        (trimmed.includes("<-") ||
          /(?::(?!=)[ \t]*(?:#|\$|\?|_|\*|\[[ \t]*(?:#|\$|\?|_|\*)[ \t]*\])|->[ \t]*:?[ \t]*(?:#|\$|\?|_|\*))(?![A-Za-z0-9_])/.test(
            trimmed,
          ) ||
          (!trimmed.includes(":=") &&
            !/\bret\b/.test(trimmed) &&
            !/\$[A-Za-z_][A-Za-z0-9_]*\s*\(/.test(trimmed))))
    );
  }

  return isHybridOrNativeSource(trimmed, targetLang);
}

function losslessSpliceBodyIntoOriginal(
  cleanedBody: string,
  originalSnippet: string,
  targetLang: TargetLanguage,
  activeIdioms: Record<string, ProjectIdiomDefinition>,
  insideClass: boolean,
): string {
  const dedentedorig = dedentSnippet(originalSnippet);
  const preprocessedBody = preprocessHybridAndIdiomsLossless(
    dedentSnippet(cleanedBody),
    targetLang,
    activeIdioms,
    { insideClass },
  ).trim();

  if (targetLang === "python") {
    const colonNewlineIdx = dedentedorig.indexOf(":\n");
    const header = colonNewlineIdx >= 0 ? dedentedorig.slice(0, colonNewlineIdx + 1) : dedentedorig;
    return `${header}\n${indentCode(preprocessedBody, "    ")}`;
  }

  const openBraceIdx = dedentedorig.indexOf("{");
  const closeBraceIdx = dedentedorig.lastIndexOf("}");
  if (openBraceIdx >= 0 && closeBraceIdx > openBraceIdx) {
    const prefix = dedentedorig.slice(0, openBraceIdx + 1);
    const suffix = dedentedorig.slice(closeBraceIdx);
    return `${prefix}\n${indentCode(preprocessedBody, "  ")}\n${suffix}`;
  }
  return preprocessedBody;
}

function emitNativeSnippetForContext(
  rawSnippet: string,
  filePath: string,
  targetLang: TargetLanguage,
  spanInfo: NativeSpanInfo | undefined,
  idioms: Record<string, ProjectIdiomDefinition> | undefined,
  originalSnippet: string | undefined,
  isBodyOnly: boolean,
  effectiveClassName?: string,
  forceLosslessPreprocess = false,
): string {
  if (targetLang === "markdown") {
    const dedentedMd = dedentSnippet(rawSnippet).trim();
    if (spanInfo?.origHeader && !/^#{1,6}\s+/.test(dedentedMd)) {
      return `${spanInfo.origHeader}\n${dedentedMd}`;
    }
    return dedentedMd;
  }
  if (
    targetLang === "shell" ||
    targetLang === "powershell" ||
    targetLang === "batch" ||
    targetLang === "aipl"
  ) {
    return dedentSnippet(rawSnippet).trim();
  }

  const { cleanedCode, inlineIdioms } = extractInlineIdiomsFromSource(rawSnippet);
  const mergedIdioms: Record<string, ProjectIdiomDefinition> = {
    ...(idioms ?? {}),
    ...inlineIdioms,
  };
  const dedented = dedentSnippet(cleanedCode);
  const insideClass = Boolean(effectiveClassName && !spanInfo?.isClassContainer);

  if (
    shouldUseLosslessPreprocessorForSnippet(
      dedented,
      targetLang,
      isBodyOnly,
      forceLosslessPreprocess,
    )
  ) {
    if (isBodyOnly && originalSnippet) {
      return losslessSpliceBodyIntoOriginal(
        dedented,
        originalSnippet,
        targetLang,
        mergedIdioms,
        insideClass,
      );
    }
    const preprocessed = preprocessHybridAndIdiomsLossless(dedented, targetLang, mergedIdioms, {
      insideClass,
      goReceiver: spanInfo?.goReceiver,
    }).trim();
    if (!insideClass) {
      const preCheck = validateNativeSyntax(preprocessed, targetLang, filePath, mergedIdioms);
      if (
        !preCheck.valid &&
        validateNativeSyntax(dedented.trim(), targetLang, filePath, mergedIdioms).valid
      ) {
        return dedented.trim();
      }
    }
    return preprocessed;
  }

  if (
    !isBodyOnly ||
    /^\s*(?:pub\s+)?(?:type|struct|enum|class|interface|const|val|mut|component|style)\b/.test(
      dedented,
    )
  ) {
    const nonCallable = tryEmitNonCallableAiceSnippet(
      dedented,
      filePath,
      targetLang,
      effectiveClassName,
      mergedIdioms,
      spanInfo?.isClassContainer,
    );
    if (nonCallable !== undefined) {
      return nonCallable;
    }
  }

  try {
    const { decl, explicitVisibility, isExported, explicitAccessor, leadingDecorators } =
      parseSnippetToExpandedDecl(
        dedented,
        filePath,
        targetLang,
        effectiveClassName,
        mergedIdioms,
        originalSnippet,
        isBodyOnly,
      );
    const emitted = emitExpandedDeclForTarget(decl, targetLang, filePath, effectiveClassName, {
      visibility: spanInfo?.visibility ?? explicitVisibility,
      isExported: spanInfo?.isExported ?? isExported,
      isStatic: spanInfo?.isStatic,
      isAsync: spanInfo?.isAsync,
      accessor: explicitAccessor ?? spanInfo?.accessor,
      memberName: originalSnippet ? (spanInfo?.memberName ?? decl.name) : decl.name,
      goReceiver: spanInfo?.goReceiver,
      cppOutOfLine: spanInfo?.cppOutOfLine,
      origHeader: spanInfo?.origHeader,
      origSource: originalSnippet,
      rawSnippet: dedented,
      idioms: mergedIdioms,
    });
    if (leadingDecorators.length > 0) {
      return `${leadingDecorators.join("\n")}\n${emitted}`;
    }
    return emitted;
  } catch (err) {
    if (isBodyOnly && originalSnippet) {
      return losslessSpliceBodyIntoOriginal(
        dedented,
        originalSnippet,
        targetLang,
        mergedIdioms,
        insideClass,
      );
    }
    const preprocessed = preprocessHybridAndIdiomsLossless(dedented, targetLang, mergedIdioms, {
      insideClass,
      goReceiver: spanInfo?.goReceiver,
    }).trim();
    if (preprocessed) {
      return preprocessed;
    }
    throw err;
  }
}

function spliceDialectNativeSource(
  nativeSource: string,
  options: SpliceOptions,
  filePath: string,
  targetLang: TargetLanguage,
  idioms?: Record<string, ProjectIdiomDefinition>,
): SpliceResult | undefined {
  if (options.edits && options.edits.length > 0) {
    if (targetLang === "json" || targetLang === "yaml") {
      let currentSource = nativeSource;
      const editedSymbols: string[] = [];
      for (const edit of options.edits) {
        const editCode =
          edit.code ??
          edit.aice ??
          edit.template ??
          edit.snippet ??
          edit.content ??
          edit.replacement;
        const singleRes = spliceDialectNativeSource(
          currentSource,
          {
            ...options,
            edits: undefined,
            symbol: edit.symbol,
            code: editCode,
            body: edit.body,
            delete: edit.delete,
            insertAfter: edit.insertAfter ?? edit.insert_after,
            insertBefore: edit.insertBefore ?? edit.insert_before,
          },
          filePath,
          targetLang,
          idioms,
        );
        if (singleRes) {
          currentSource = singleRes.modifiedCode;
          editedSymbols.push(edit.symbol);
        }
      }
      return {
        success: true,
        filePath,
        symbol: editedSymbols.join(", "),
        diff: options.diff ? generateUnifiedDiff(filePath, nativeSource, currentSource) : undefined,
        modifiedCode: currentSource,
        newAiceSource: currentSource,
        tokensSaved: Math.max(
          0,
          estimateTokens(currentSource) - estimateTokens(JSON.stringify(options.edits)),
        ),
      };
    }

    // For CSS, HTML, and Twig: resolve each edit's exact byte span against `nativeSource`
    // and apply in reverse offset order (bottom-to-top).
    const resolvedDialectEdits: Array<{
      symbol: string;
      startOffset: number;
      endOffset: number;
      replacement: string;
    }> = [];

    for (const edit of options.edits) {
      const editCode =
        edit.code ?? edit.aice ?? edit.template ?? edit.snippet ?? edit.content ?? edit.replacement;
      const singleRes = spliceDialectNativeSource(
        nativeSource,
        {
          ...options,
          edits: undefined,
          diff: false,
          symbol: edit.symbol,
          code: editCode,
          body: edit.body,
          delete: edit.delete,
          insertAfter: edit.insertAfter ?? edit.insert_after,
          insertBefore: edit.insertBefore ?? edit.insert_before,
        },
        filePath,
        targetLang,
        idioms,
      );
      if (singleRes) {
        let prefixLen = 0;
        const minLen = Math.min(nativeSource.length, singleRes.modifiedCode.length);
        while (
          prefixLen < minLen &&
          nativeSource.charCodeAt(prefixLen) === singleRes.modifiedCode.charCodeAt(prefixLen)
        ) {
          prefixLen++;
        }
        let origSuffixIdx = nativeSource.length;
        let modSuffixIdx = singleRes.modifiedCode.length;
        while (
          origSuffixIdx > prefixLen &&
          modSuffixIdx > prefixLen &&
          nativeSource.charCodeAt(origSuffixIdx - 1) ===
            singleRes.modifiedCode.charCodeAt(modSuffixIdx - 1)
        ) {
          origSuffixIdx--;
          modSuffixIdx--;
        }
        resolvedDialectEdits.push({
          symbol: edit.symbol,
          startOffset: prefixLen,
          endOffset: origSuffixIdx,
          replacement: singleRes.modifiedCode.slice(prefixLen, modSuffixIdx),
        });
      }
    }

    const indexedDialectEdits = resolvedDialectEdits.map((edit, idx) => ({ edit, idx }));
    const sortedDialect = indexedDialectEdits
      .sort(
        (a, b) =>
          b.edit.startOffset - a.edit.startOffset ||
          b.edit.endOffset - a.edit.endOffset ||
          b.idx - a.idx,
      )
      .map((entry) => entry.edit);
    const hasDialectOverlap = sortedDialect.some(
      (e, idx) =>
        idx < sortedDialect.length - 1 && e.startOffset < sortedDialect[idx + 1].endOffset,
    );

    let modifiedCode = nativeSource;
    if (hasDialectOverlap) {
      for (const edit of options.edits) {
        const editCode =
          edit.code ??
          edit.aice ??
          edit.template ??
          edit.snippet ??
          edit.content ??
          edit.replacement;
        const stepRes = spliceDialectNativeSource(
          modifiedCode,
          {
            ...options,
            edits: undefined,
            diff: false,
            symbol: edit.symbol,
            code: editCode,
            body: edit.body,
            delete: edit.delete,
            insertAfter: edit.insertAfter ?? edit.insert_after,
            insertBefore: edit.insertBefore ?? edit.insert_before,
          },
          filePath,
          targetLang,
          idioms,
        );
        if (stepRes) {
          modifiedCode = stepRes.modifiedCode;
        }
      }
    } else {
      for (const item of sortedDialect) {
        modifiedCode = `${modifiedCode.slice(0, item.startOffset)}${item.replacement}${modifiedCode.slice(item.endOffset)}`;
      }
    }
    const editedSymbols = options.edits.map((e) => e.symbol);
    return {
      success: true,
      filePath,
      symbol: editedSymbols.join(", "),
      diff: options.diff ? generateUnifiedDiff(filePath, nativeSource, modifiedCode) : undefined,
      modifiedCode,
      newAiceSource: modifiedCode,
      tokensSaved: Math.max(
        0,
        estimateTokens(modifiedCode) - estimateTokens(JSON.stringify(options.edits)),
      ),
    };
  }

  const anchorSymbol = options.insertAfter ?? options.insertBefore ?? options.symbol;
  const rawSnippet = options.code ?? options.body ?? "";

  if (targetLang === "css") {
    const root = postcss.parse(nativeSource, { from: filePath });
    const emitCssSnippet = (selectorFallback: string): string => {
      const { cleanedCode, inlineIdioms } = extractInlineIdiomsFromSource(rawSnippet);
      const mergedIdioms: Record<string, ProjectIdiomDefinition> = {
        ...(idioms ?? {}),
        ...inlineIdioms,
      };
      const trimmed = cleanedCode.trim();
      if (!trimmed) return "";
      if (!trimmed.startsWith("style ") && trimmed.includes("{") && trimmed.endsWith("}")) {
        return preprocessBareCssLossless(trimmed, mergedIdioms).trim();
      }
      const aiceText = trimmed.startsWith("style ")
        ? trimmed
        : `style ${selectorFallback}:\n${indentCode(trimmed, "  ")}`;
      const mod = parse(aiceText, filePath);
      const expanded =
        Object.keys(mergedIdioms).length > 0 ? expandModuleIdioms(mod, mergedIdioms) : mod;
      return emitTarget(expanded, "css", { watermark: false }).trim();
    };

    if (
      (options.append && !anchorSymbol) ||
      (anchorSymbol && /^(?:eof|end|append)$/i.test(anchorSymbol.trim()))
    ) {
      const emitted = emitCssSnippet(".rule");
      const sep = nativeSource.endsWith("\n") ? "\n" : "\n\n";
      const modifiedCode = `${nativeSource}${sep}${emitted}\n`;
      return {
        success: true,
        filePath,
        symbol: anchorSymbol ?? "eof",
        newSnippet: emitted,
        modifiedCode,
        newAiceSource: modifiedCode,
        tokensSaved: Math.max(
          0,
          estimateTokens(modifiedCode) - estimateTokens(rawSnippet || emitted),
        ),
      };
    }

    if (!anchorSymbol) {
      throw new Error("Must specify target symbol with --symbol when splicing CSS file");
    }

    const cleanAnchor = anchorSymbol.trim().replace(/^[.#]/, "");
    let matchedRule: postcss.Rule | undefined;
    root.walkRules((rule) => {
      if (matchedRule) return;
      const sel = rule.selector.trim();
      const cleanSel = sel.replace(/^[.#]/, "");
      if (
        sel === anchorSymbol.trim() ||
        cleanSel === cleanAnchor ||
        cleanSel.replace(/[-_]/g, "").toLowerCase() ===
          cleanAnchor.replace(/[-_]/g, "").toLowerCase()
      ) {
        matchedRule = rule;
      }
    });

    if (!matchedRule || !matchedRule.source?.start || !matchedRule.source?.end) {
      if (!options.delete && !options.insertBefore && !options.insertAfter) {
        const emitted = emitCssSnippet(anchorSymbol.trim());
        const sep = nativeSource.endsWith("\n") ? "\n" : "\n\n";
        const modifiedCode = `${nativeSource}${sep}${emitted}\n`;
        return {
          success: true,
          filePath,
          symbol: anchorSymbol,
          newSnippet: emitted,
          modifiedCode,
          newAiceSource: modifiedCode,
          tokensSaved: Math.max(
            0,
            estimateTokens(modifiedCode) - estimateTokens(rawSnippet || emitted),
          ),
        };
      }
      throw new Error(`CSS selector '${anchorSymbol}' not found in ${filePath}`);
    }

    const startOffset = matchedRule.source.start.offset;
    const rawEnd = matchedRule.source.end.offset;
    const endOffset =
      !nativeSource.slice(startOffset, rawEnd).trimEnd().endsWith("}") &&
      nativeSource[rawEnd] === "}"
        ? rawEnd + 1
        : rawEnd;
    const originalSnippet = nativeSource.slice(startOffset, endOffset);
    let newSnippet = "";
    let modifiedCode = nativeSource;

    if (options.delete) {
      let delEnd = endOffset;
      while (
        delEnd < nativeSource.length &&
        (nativeSource[delEnd] === "\r" || nativeSource[delEnd] === "\n")
      ) {
        delEnd++;
      }
      modifiedCode = `${nativeSource.slice(0, startOffset)}${nativeSource.slice(delEnd)}`;
    } else if (options.insertBefore || options.insertAfter) {
      newSnippet = emitCssSnippet(matchedRule.selector.trim());
      if (options.insertBefore) {
        modifiedCode = `${nativeSource.slice(0, startOffset)}${newSnippet}\n\n${nativeSource.slice(startOffset)}`;
      } else {
        modifiedCode = `${nativeSource.slice(0, endOffset)}\n\n${newSnippet}${nativeSource.slice(endOffset)}`;
      }
    } else {
      newSnippet = emitCssSnippet(matchedRule.selector.trim());
      modifiedCode = `${nativeSource.slice(0, startOffset)}${newSnippet}${nativeSource.slice(endOffset)}`;
    }

    return {
      success: true,
      filePath,
      symbol: anchorSymbol,
      originalSnippet,
      newSnippet,
      diff: options.diff ? generateUnifiedDiff(filePath, nativeSource, modifiedCode) : undefined,
      modifiedCode,
      newAiceSource: modifiedCode,
      tokensSaved: Math.max(
        0,
        estimateTokens(modifiedCode) - estimateTokens(rawSnippet || newSnippet),
      ),
    };
  }

  if (targetLang === "json" || targetLang === "yaml") {
    const parseSnippetMeta = (): { declName?: string; value: any } => {
      const trimmed = rawSnippet
        .trim()
        .replace(
          /^(?:pub\s+)?(?:const|val|mut|let)?\s*(?:config\.)([A-Za-z_][A-Za-z0-9_]*)\s*(?::=|=)\s*/,
          "pub const $1 = ",
        );
      if (!trimmed) return { value: {} };
      const hasExplicitDecl = /^(?:pub\s+)?(?:const|val|mut)\s+/.test(trimmed);
      const candidates = [trimmed, hasExplicitDecl ? trimmed : `pub const __v = ${trimmed}`];
      for (const cand of candidates) {
        try {
          const mod = parse(cand, filePath);
          const expanded =
            idioms && Object.keys(idioms).length > 0 ? expandModuleIdioms(mod, idioms) : mod;
          const first = expanded.items[0];
          if (first && (first.kind === "ConstDecl" || first.kind === "VarDecl")) {
            return {
              declName: first.name !== "__v" ? first.name : undefined,
              value: astToValue(first.value),
            };
          }
          if (first && first.kind === "FunctionDecl" && "statements" in first.body) {
            const st = first.body.statements[0];
            if (st && st.kind === "LetBinding")
              return {
                declName: st.name !== "__v" ? st.name : undefined,
                value: astToValue(st.init),
              };
            if (st && st.kind === "AssignStmt") return { value: astToValue(st.value) };
            if (st && st.kind === "ExprStmt") return { value: astToValue(st.expr) };
          }
        } catch {
          // continue
        }
      }
      if (targetLang === "json") {
        return { value: JSON.parse(stripJsonComments(trimmed)) };
      }
      return { value: YAML.parse(trimmed) };
    };

    if (!anchorSymbol && !options.append) {
      throw new Error(
        `Must specify target key with --symbol when splicing ${targetLang.toUpperCase()} file`,
      );
    }

    if (targetLang === "yaml") {
      const doc = YAML.parseDocument(nativeSource);
      if (!doc.contents) {
        doc.contents = doc.createNode({}) as any;
      }

      if (
        (options.append && !anchorSymbol) ||
        (anchorSymbol && /^(?:eof|end|append)$/i.test(anchorSymbol.trim()))
      ) {
        const { declName, value: newVal } = parseSnippetMeta();
        if (declName && declName !== "config") {
          doc.setIn([declName], doc.createNode(newVal));
        } else if (typeof newVal === "object" && newVal !== null && !Array.isArray(newVal)) {
          for (const [k, v] of Object.entries(newVal)) {
            doc.setIn([k], doc.createNode(v));
          }
        } else {
          doc.setIn(["config"], doc.createNode(newVal));
        }
        const newSnippet = YAML.stringify(newVal).trimEnd();
        const modifiedCode = doc.toString();
        return {
          success: true,
          filePath,
          newSnippet,
          diff: options.diff
            ? generateUnifiedDiff(filePath, nativeSource, modifiedCode)
            : undefined,
          modifiedCode,
          newAiceSource: modifiedCode,
          tokensSaved: Math.max(
            0,
            estimateTokens(modifiedCode) - estimateTokens(rawSnippet || newSnippet),
          ),
        };
      }

      const keyParts = (anchorSymbol ?? "config").split(".").filter(Boolean);
      if (keyParts.length > 1 && keyParts[0] === "config" && !doc.hasIn(["config"])) {
        keyParts.shift();
      }

      const isRootConfig =
        keyParts.length === 1 && keyParts[0] === "config" && !doc.hasIn(["config"]);
      if (options.delete && !isRootConfig && !doc.hasIn(keyParts)) {
        throw new Error(`Key '${anchorSymbol}' not found in ${filePath}`);
      }

      const origNode = isRootConfig ? doc.contents : doc.getIn(keyParts, true);
      const origVal =
        origNode && typeof (origNode as { toJSON?: () => unknown }).toJSON === "function"
          ? (origNode as { toJSON: () => unknown }).toJSON()
          : origNode;
      const originalSnippet = origVal !== undefined ? YAML.stringify(origVal).trimEnd() : "";

      let newSnippet = "";
      if (options.delete) {
        const normKeys = keyParts.map((k) => (/^\d+$/.test(k) ? Number(k) : k));
        doc.deleteIn(normKeys);
      } else {
        const parsedMeta = parseSnippetMeta();
        const declName = parsedMeta.declName;
        const leaf = keyParts[keyParts.length - 1];
        let newVal = parsedMeta.value;
        if (
          typeof newVal === "object" &&
          newVal !== null &&
          !Array.isArray(newVal) &&
          Object.keys(newVal).length === 1 &&
          Object.keys(newVal)[0] === leaf &&
          (!origVal ||
            typeof origVal !== "object" ||
            !(leaf in (origVal as Record<string, unknown>)))
        ) {
          newVal = (newVal as Record<string, unknown>)[leaf];
        }
        if (
          (options.insertAfter || options.insertBefore) &&
          declName &&
          declName !== "config" &&
          declName !== leaf
        ) {
          const siblingKeys = [...keyParts.slice(0, -1), declName];
          doc.setIn(siblingKeys, doc.createNode(newVal));
        } else if (
          (options.insertAfter || options.insertBefore || options.append) &&
          Array.isArray(origVal)
        ) {
          const itemsToAdd = Array.isArray(newVal) ? newVal : [newVal];
          const nextArr = options.insertBefore
            ? [...itemsToAdd, ...origVal]
            : [...origVal, ...itemsToAdd];
          doc.setIn(keyParts, doc.createNode(nextArr));
        } else {
          const newNode = doc.createNode(newVal);
          if (YAML.isMap(origNode) && YAML.isMap(newNode)) {
            if (origNode.anchor) {
              newNode.anchor = origNode.anchor;
            }
            const mergePair = origNode.items.find(
              (p) => YAML.isScalar(p.key) && p.key.value === "<<",
            );
            if (mergePair && typeof newVal === "object" && newVal !== null && !("<<" in newVal)) {
              (newNode.items as unknown[]).unshift(mergePair);
            }
          }
          if (isRootConfig && typeof newVal === "object" && newVal !== null) {
            doc.contents = newNode as any;
          } else {
            doc.setIn(keyParts, newNode);
          }
        }
        newSnippet = YAML.stringify(newVal).trimEnd();
      }

      const modifiedCode = doc.toString();
      return {
        success: true,
        filePath,
        symbol: anchorSymbol,
        originalSnippet,
        newSnippet,
        diff: options.diff ? generateUnifiedDiff(filePath, nativeSource, modifiedCode) : undefined,
        modifiedCode,
        newAiceSource: modifiedCode,
        tokensSaved: Math.max(
          0,
          estimateTokens(modifiedCode) - estimateTokens(rawSnippet || newSnippet),
        ),
      };
    }

    // JSON handling
    let docObj: Record<string, any> = {};
    const trimmedJson = nativeSource.trim();
    if (trimmedJson) {
      try {
        docObj = JSON.parse(nativeSource);
      } catch {
        docObj = JSON.parse(stripJsonComments(nativeSource));
      }
    }

    if (
      (options.append && !anchorSymbol) ||
      (anchorSymbol && /^(?:eof|end|append)$/i.test(anchorSymbol.trim()))
    ) {
      const { declName, value: newVal } = parseSnippetMeta();
      if (declName && declName !== "config") {
        docObj[declName] = newVal;
      } else if (typeof newVal === "object" && newVal !== null && !Array.isArray(newVal)) {
        Object.assign(docObj, newVal);
      } else {
        docObj.config = newVal;
      }
      const newSnippet = JSON.stringify(newVal, null, 2);
      const modifiedCode = `${JSON.stringify(docObj, null, 2)}\n`;
      return {
        success: true,
        filePath,
        newSnippet,
        diff: options.diff ? generateUnifiedDiff(filePath, nativeSource, modifiedCode) : undefined,
        modifiedCode,
        newAiceSource: modifiedCode,
        tokensSaved: Math.max(
          0,
          estimateTokens(modifiedCode) - estimateTokens(rawSnippet || newSnippet),
        ),
      };
    }

    const keyParts = (anchorSymbol ?? "config").split(".").filter(Boolean);
    if (keyParts.length > 1 && keyParts[0] === "config" && !Object.hasOwn(docObj, "config")) {
      keyParts.shift();
    }

    let parent: any = docObj;
    for (let i = 0; i < keyParts.length - 1; i++) {
      const k = keyParts[i];
      if (parent[k] === undefined || typeof parent[k] !== "object" || parent[k] === null) {
        if (options.delete) {
          throw new Error(`Key '${anchorSymbol}' not found in ${filePath}`);
        }
        parent[k] = {};
      }
      parent = parent[k];
    }

    const leafKey = keyParts[keyParts.length - 1];
    if (
      options.delete &&
      !(leafKey in parent) &&
      !(keyParts.length === 1 && leafKey === "config")
    ) {
      throw new Error(`Key '${anchorSymbol}' not found in ${filePath}`);
    }

    const origVal = leafKey === "config" && !(leafKey in parent) ? docObj : parent[leafKey];
    const originalSnippet = origVal !== undefined ? JSON.stringify(origVal, null, 2) : "";

    let newSnippet = "";
    if (options.delete) {
      if (Array.isArray(parent) && /^\d+$/.test(leafKey)) {
        parent.splice(Number(leafKey), 1);
      } else {
        delete parent[leafKey];
      }
    } else {
      const parsedMeta = parseSnippetMeta();
      const declName = parsedMeta.declName;
      let newVal = parsedMeta.value;
      if (
        typeof newVal === "object" &&
        newVal !== null &&
        !Array.isArray(newVal) &&
        Object.keys(newVal).length === 1 &&
        Object.keys(newVal)[0] === leafKey &&
        (!origVal ||
          typeof origVal !== "object" ||
          !(leafKey in (origVal as Record<string, unknown>)))
      ) {
        newVal = (newVal as Record<string, unknown>)[leafKey];
      }
      if (
        (options.insertAfter || options.insertBefore) &&
        declName &&
        declName !== "config" &&
        declName !== leafKey &&
        !Array.isArray(parent)
      ) {
        parent[declName] = newVal;
      } else if (
        (options.insertAfter || options.insertBefore || options.append) &&
        Array.isArray(origVal)
      ) {
        const itemsToAdd = Array.isArray(newVal) ? newVal : [newVal];
        parent[leafKey] = options.insertBefore
          ? [...itemsToAdd, ...origVal]
          : [...origVal, ...itemsToAdd];
      } else if (
        leafKey === "config" &&
        !(leafKey in parent) &&
        typeof newVal === "object" &&
        newVal !== null
      ) {
        docObj = newVal;
      } else {
        parent[leafKey] = newVal;
      }
      newSnippet = JSON.stringify(newVal, null, 2);
    }

    const modifiedCode = `${JSON.stringify(docObj, null, 2)}\n`;

    return {
      success: true,
      filePath,
      symbol: anchorSymbol,
      originalSnippet,
      newSnippet,
      diff: options.diff ? generateUnifiedDiff(filePath, nativeSource, modifiedCode) : undefined,
      modifiedCode,
      newAiceSource: modifiedCode,
      tokensSaved: Math.max(
        0,
        estimateTokens(modifiedCode) - estimateTokens(rawSnippet || newSnippet),
      ),
    };
  }

  if (targetLang === "html" || targetLang === "twig") {
    const HTML_VOID_ELEMENTS = new Set([
      "area",
      "base",
      "br",
      "col",
      "embed",
      "hr",
      "img",
      "input",
      "link",
      "meta",
      "param",
      "source",
      "track",
      "wbr",
    ]);

    const emitTemplateFragment = (): string => {
      const { cleanedCode, inlineIdioms } = extractInlineIdiomsFromSource(rawSnippet);
      const mergedIdioms: Record<string, ProjectIdiomDefinition> = {
        ...(idioms ?? {}),
        ...inlineIdioms,
      };
      const trimmed = cleanedCode
        .trim()
        .replace(/^([ \t]*)block\s+["']([^"']+)["']\s*:/gm, '$1block(name: "$2"):');
      if (!trimmed) return "";
      if (trimmed.startsWith("<") || trimmed.startsWith("{%")) {
        return preprocessHybridAndIdiomsLossless(trimmed, targetLang, mergedIdioms).trim();
      }
      const hasTopLevelComponent = /^(?:(?:#[^\n]*|module\s+[^\n]+)\n+|\s)*component\s+/m.test(
        trimmed,
      );
      const aiceText = hasTopLevelComponent
        ? trimmed
        : `component __Frag():\n${indentCode(trimmed, "  ")}`;
      const mod = parse(aiceText, filePath);
      const expanded =
        Object.keys(mergedIdioms).length > 0 ? expandModuleIdioms(mod, mergedIdioms) : mod;
      let emitted = emitTarget(expanded, targetLang, { watermark: false }).trim();
      if (targetLang === "html") {
        emitted = emitted.replace(/^<!DOCTYPE html>\s*/i, "").trim();
      }
      return emitted;
    };

    if (
      (options.append && !anchorSymbol) ||
      (anchorSymbol && /^(?:eof|end|append)$/i.test(anchorSymbol.trim()))
    ) {
      const emitted = emitTemplateFragment();
      const modifiedCode = `${nativeSource.trimEnd()}\n${emitted}\n`;
      return {
        success: true,
        filePath,
        newSnippet: emitted,
        modifiedCode,
        newAiceSource: modifiedCode,
        tokensSaved: Math.max(
          0,
          estimateTokens(modifiedCode) - estimateTokens(rawSnippet || emitted),
        ),
      };
    }

    if (!anchorSymbol) {
      throw new Error(
        `Must specify target selector with --symbol when splicing ${targetLang.toUpperCase()} file`,
      );
    }

    let sel = anchorSymbol.trim();
    const isTopLevelCompSnippet = /^(?:(?:#[^\n]*|module\s+[^\n]+)\n+|\s)*component\s+/m.test(
      rawSnippet.trim(),
    );
    let spanStart = -1;
    let spanEnd = -1;

    if (
      !sel.startsWith("#") &&
      !sel.startsWith(".") &&
      !sel.startsWith("block:") &&
      /^[A-Z]/.test(sel)
    ) {
      if (
        isTopLevelCompSnippet &&
        !options.insertBefore &&
        !options.insertAfter &&
        !options.delete
      ) {
        const doctypeMatch = nativeSource.match(/^<!DOCTYPE html>\s*/i);
        spanStart = doctypeMatch ? doctypeMatch[0].length : 0;
        spanEnd = nativeSource.length;
      } else {
        const blkMatch = rawSnippet.match(/\bblock(?:\s*\(\s*name\s*[:=]\s*|\s+)["']([^"']+)["']/);
        const idMatch = rawSnippet.match(/\bid\s*[:=]\s*["']([^"']+)["']/);
        if (blkMatch) {
          sel = blkMatch[1];
        } else if (idMatch) {
          sel = `#${idMatch[1]}`;
        }
      }
    }
    const cleanSel = sel.replace(/^(?:[A-Za-z0-9_]+\.|#|\.|block(?::|\s+))/i, "");
    const escSel = cleanSel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // 1. Check Twig {% block <name> %}...{% endblock %} with balanced nesting support
    if (spanStart < 0 && targetLang === "twig") {
      const openBlockRe = new RegExp(`\\{%[-~]?\\s*block\\s+${escSel}\\b([^%]*)%\\}`);
      const openMatch = openBlockRe.exec(nativeSource);
      if (openMatch && openMatch.index !== undefined) {
        spanStart = openMatch.index;
        const afterName = (openMatch[1] ?? "").replace(/[-~]$/, "").trim();
        if (afterName.length > 0) {
          // Inline shorthand block: {% block name expr %}
          spanEnd = openMatch.index + openMatch[0].length;
        } else {
          const tokenRe = /\{%[-~]?\s*(block|endblock)\b([^%]*)%\}/g;
          tokenRe.lastIndex = openMatch.index + openMatch[0].length;
          let depth = 1;
          let tokMatch: RegExpExecArray | null = tokenRe.exec(nativeSource);
          while (depth > 0 && tokMatch !== null) {
            const kw = tokMatch[1];
            const rest = (tokMatch[2] ?? "").replace(/[-~]$/, "").trim();
            if (kw === "block") {
              // Only increment depth if not a single-tag inline block {% block foo bar %}
              if (/^[a-zA-Z0-9_-]+$/.test(rest)) {
                depth++;
              }
            } else if (kw === "endblock") {
              depth--;
              if (depth === 0) {
                spanEnd = tokMatch.index + tokMatch[0].length;
                break;
              }
            }
            tokMatch = tokenRe.exec(nativeSource);
          }
        }
      }
    }

    // 2. Check HTML/Twig element by id, class, or tag name (ignoring '>' inside quoted attributes)
    if (spanStart < 0) {
      const openTagRe = /<([a-zA-Z][a-zA-Z0-9-]*)((?:\s+(?:[^>"']|"[^"]*"|'[^']*')*)?)\s*(\/?)>/g;
      let match: RegExpExecArray | null = openTagRe.exec(nativeSource);
      while (match !== null) {
        const tag = match[1];
        const attrs = match[2] ?? "";
        const selfCloseSlash = match[3] ?? "";
        const isIdMatch = new RegExp(`\\bid=["']${escSel}["']`).test(attrs);
        const isClassMatch = new RegExp(`\\bclass=["'][^"']*\\b${escSel}\\b[^"']*["']`).test(attrs);
        const isTagMatch = tag.toLowerCase() === cleanSel.toLowerCase();

        if (
          (sel.startsWith("#") && isIdMatch) ||
          (sel.startsWith(".") && isClassMatch) ||
          (!sel.startsWith("#") &&
            !sel.startsWith(".") &&
            (isTagMatch || isIdMatch || isClassMatch))
        ) {
          spanStart = match.index;
          const lowerTag = tag.toLowerCase();
          if (selfCloseSlash === "/" || HTML_VOID_ELEMENTS.has(lowerTag)) {
            spanEnd = match.index + match[0].length;
          } else {
            const escTag = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const tagRe = new RegExp(`<(\\/?)${escTag}\\b((?:[^>"']|"[^"]*"|'[^']*')*)>`, "gi");
            tagRe.lastIndex = match.index + match[0].length;
            let depth = 1;
            let tMatch: RegExpExecArray | null = tagRe.exec(nativeSource);
            while (depth > 0 && tMatch !== null) {
              const isClosing = tMatch[1] === "/";
              const innerTail = (tMatch[2] ?? "").trimEnd();
              if (isClosing) {
                depth--;
                if (depth === 0) {
                  spanEnd = tMatch.index + tMatch[0].length;
                  break;
                }
              } else if (!innerTail.endsWith("/") && !HTML_VOID_ELEMENTS.has(lowerTag)) {
                depth++;
              }
              tMatch = tagRe.exec(nativeSource);
            }
          }
          break;
        }
        match = openTagRe.exec(nativeSource);
      }
    }

    if (spanStart < 0 || spanEnd < spanStart) {
      throw new Error(`Template element or block '${anchorSymbol}' not found in ${filePath}`);
    }

    const originalSnippet = nativeSource.slice(spanStart, spanEnd);
    let newSnippet = "";
    let modifiedCode = nativeSource;

    if (options.delete) {
      modifiedCode = `${nativeSource.slice(0, spanStart)}${nativeSource.slice(spanEnd)}`;
    } else if (options.insertBefore || options.insertAfter) {
      newSnippet = emitTemplateFragment();
      if (options.insertBefore) {
        modifiedCode = `${nativeSource.slice(0, spanStart)}${newSnippet}\n${nativeSource.slice(spanStart)}`;
      } else {
        modifiedCode = `${nativeSource.slice(0, spanEnd)}\n${newSnippet}${nativeSource.slice(spanEnd)}`;
      }
    } else {
      newSnippet = emitTemplateFragment();
      modifiedCode = `${nativeSource.slice(0, spanStart)}${newSnippet}${nativeSource.slice(spanEnd)}`;
    }

    return {
      success: true,
      filePath,
      symbol: anchorSymbol,
      originalSnippet,
      newSnippet,
      diff: options.diff ? generateUnifiedDiff(filePath, nativeSource, modifiedCode) : undefined,
      modifiedCode,
      newAiceSource: modifiedCode,
      tokensSaved: Math.max(
        0,
        estimateTokens(modifiedCode) - estimateTokens(rawSnippet || newSnippet),
      ),
    };
  }

  return undefined;
}

interface ResolvedNativeEdit {
  symbol: string;
  startOffset: number;
  endOffset: number;
  replacement: string;
  originalSnippet: string;
  newSnippet: string;
  isInsertion?: boolean;
  preservedTriviaText?: string;
}

export interface HunkBlock {
  search: string;
  replace: string;
}

export function stripNumberedGutterPrefixes(raw: string): string {
  if (!raw) return raw;
  const rawLines = raw.split(/\r?\n/);
  const lines = rawLines.filter(
    (l) => !/^\[Clamped L\d+-L\d+\s*->\s*L\d+-L\d+\s*\(EOF\)\]$/.test(l.trim()),
  );
  const nonEmpty = lines.filter((l) => l.trim().length > 0);
  if (nonEmpty.length === 0) return raw;

  const hasBoxGutter = nonEmpty.some((l) => /^\s*\d+│/.test(l));
  const hasColonGutter =
    nonEmpty.length >= 1 &&
    nonEmpty.every(
      (l) =>
        /^\s*(?:L?\d+:\s|\d+│)/.test(l) &&
        !/^\s*\d+:\s*(?:['"[{]|true\b|false\b|null\b|\d+\s*[,}])/.test(l),
    );

  if (!hasBoxGutter && !hasColonGutter) {
    return lines.length !== rawLines.length ? lines.join("\n") : raw;
  }

  return lines
    .map((line) => {
      if (/^\s*\d+│/.test(line)) {
        return line.replace(/^\s*\d+│ ?/, "");
      }
      if (hasColonGutter && /^\s*L?\d+:\s/.test(line)) {
        return line.replace(/^\s*L?\d+:\s?/, "");
      }
      return line;
    })
    .join("\n");
}

export function containsHunkMarkers(code: string | undefined): boolean {
  if (!code) return false;
  return /(?:^|\r?\n)[ \t]*<{3,}[ \t]*(?:\r?\n|$)/.test(code);
}

export function extractHunkBlocks(rawSnippet: string): HunkBlock[] {
  const lines = rawSnippet.split(/\r?\n/);
  const hunks: HunkBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const curLine = lines[i] ?? "";
    if (/^[ \t]*<{3,}[ \t]*$/.test(curLine)) {
      i++;
      const searchLines: string[] = [];
      while (i < lines.length && !/^[ \t]*={3,}[ \t]*$/.test(lines[i] ?? "")) {
        searchLines.push(lines[i] ?? "");
        i++;
      }
      if (i >= lines.length) {
        throw new Error(
          "Malformed hunk splice: found '<<<' without matching '===' separator and '>>>' terminator. Valid syntax:\n<<<\n<lines to find>\n===\n<replacement lines>\n>>>",
        );
      }
      i++; // skip '==='
      const replaceLines: string[] = [];
      while (i < lines.length && !/^[ \t]*>{3,}[ \t]*$/.test(lines[i] ?? "")) {
        replaceLines.push(lines[i] ?? "");
        i++;
      }
      if (i >= lines.length) {
        throw new Error(
          "Malformed hunk splice: found '<<<' and '===' without matching '>>>' terminator. Valid syntax:\n<<<\n<lines to find>\n===\n<replacement lines>\n>>>",
        );
      }
      i++; // skip '>>>'
      hunks.push({
        search: stripNumberedGutterPrefixes(searchLines.join("\n")),
        replace: stripNumberedGutterPrefixes(replaceLines.join("\n")),
      });
    } else {
      const stray = curLine.trim();
      if (
        stray.length > 0 &&
        !stray.startsWith("//") &&
        !stray.startsWith("#") &&
        !stray.startsWith("/*") &&
        !stray.startsWith("*") &&
        !stray.startsWith("<!--")
      ) {
        if (/^={3,}$/.test(stray) || /^>{3,}$/.test(stray)) {
          throw new Error(
            `Malformed hunk splice: unexpected '${stray}' outside '<<< ... >>>' hunk block. Valid syntax:\n<<<\n<lines to find>\n===\n<replacement lines>\n>>>`,
          );
        }
        throw new Error(
          `Malformed hunk splice: unexpected non-hunk content outside '<<< ... >>>' blocks: ${stray}`,
        );
      }
      i++;
    }
  }
  return hunks;
}

export function applyHunksToScope(
  scopeText: string,
  hunks: HunkBlock[],
  symbolLabel: string,
  filePath: string,
  targetLang?: TargetLanguage,
  idioms?: Record<string, ProjectIdiomDefinition>,
  idiomsEnabled = true,
  insideClass: boolean | "container" | "member" = false,
): string {
  const isCrLf = scopeText.includes("\r\n");
  const nl = isCrLf ? "\r\n" : "\n";
  let current = scopeText.replace(/\r\n/g, "\n");

  for (const hunk of hunks) {
    const searchNorm = hunk.search.replace(/\r\n/g, "\n");
    if (!searchNorm.trim()) {
      throw new Error(
        `Empty search block in <<< / === / >>> hunk for '${symbolLabel}' in ${filePath}. Provide at least 1 search line between '<<<' and '==='.`,
      );
    }
    let replaceNorm = hunk.replace.replace(/\r\n/g, "\n");
    if (idiomsEnabled && targetLang && replaceNorm.trim()) {
      const effectiveInsideClass =
        insideClass === "container" ||
        insideClass === true ||
        (insideClass === "member" &&
          /^\s*(?:#\[[^\]]+\]\s*)*(?:pub\s+|@fn\b|\^fn\b|async\s+|static\s+)*fn\b/.test(
            replaceNorm,
          ));
      replaceNorm = preprocessHybridAndIdiomsLossless(replaceNorm, targetLang, idioms, {
        insideClass: effectiveInsideClass,
      }).replace(/\r\n/g, "\n");
    }

    const scopeLines = current.split("\n");
    const searchLines = searchNorm.split("\n");
    while (searchLines.length > 0 && (searchLines[0] ?? "").trim() === "") {
      searchLines.shift();
    }
    while (searchLines.length > 0 && (searchLines[searchLines.length - 1] ?? "").trim() === "") {
      searchLines.pop();
    }

    let matchStart = -1;
    let matchEnd = -1;
    if (searchLines.length > 0 && searchLines.length <= scopeLines.length) {
      const exactLineMatches: number[] = [];
      for (let s = 0; s <= scopeLines.length - searchLines.length; s++) {
        let exactLineMatch = true;
        for (let k = 0; k < searchLines.length; k++) {
          if (scopeLines[s + k] !== searchLines[k]) {
            exactLineMatch = false;
            break;
          }
        }
        if (exactLineMatch) {
          exactLineMatches.push(s);
        }
      }
      if (exactLineMatches.length > 1) {
        throw new Error(
          `Ambiguous hunk within '${symbolLabel}' in ${filePath}: search block matches ${exactLineMatches.length} identical locations. Include surrounding context lines in <<< ... === to disambiguate.`,
        );
      }
      if (exactLineMatches.length === 1) {
        matchStart = exactLineMatches[0] ?? -1;
        matchEnd = matchStart + searchLines.length;
      }
    }

    if (matchStart < 0) {
      const validInlineIdxs: number[] = [];
      let searchFrom = 0;
      while (searchFrom <= current.length) {
        const idx = current.indexOf(searchNorm, searchFrom);
        if (idx < 0) break;
        const beforeChar = idx > 0 ? current[idx - 1] : "\n";
        const afterIdx = idx + searchNorm.length;
        const afterChar = afterIdx < current.length ? current[afterIdx] : "\n";
        const isPartialIndentMatch =
          (beforeChar === " " || beforeChar === "\t") && /^[ \t]/.test(searchNorm);
        if (!isPartialIndentMatch && (beforeChar === "\n" || afterChar !== "\n")) {
          validInlineIdxs.push(idx);
        }
        searchFrom = idx + Math.max(1, searchNorm.length);
      }
      if (validInlineIdxs.length > 1) {
        throw new Error(
          `Ambiguous hunk within '${symbolLabel}' in ${filePath}: search block matches ${validInlineIdxs.length} inline locations. Include surrounding context to disambiguate.`,
        );
      }
      if (validInlineIdxs.length === 1) {
        const exactIdx = validInlineIdxs[0] ?? 0;
        const afterIdx = exactIdx + searchNorm.length;
        current = `${current.slice(0, exactIdx)}${replaceNorm}${current.slice(afterIdx)}`;
        continue;
      }
    }

    if (matchStart < 0 && searchLines.length > 0 && searchLines.length <= scopeLines.length) {
      const trimmedMatches: number[] = [];
      for (let s = 0; s <= scopeLines.length - searchLines.length; s++) {
        let allMatch = true;
        for (let k = 0; k < searchLines.length; k++) {
          if ((scopeLines[s + k] ?? "").trim() !== (searchLines[k] ?? "").trim()) {
            allMatch = false;
            break;
          }
        }
        if (allMatch) {
          trimmedMatches.push(s);
        }
      }
      if (trimmedMatches.length > 1) {
        throw new Error(
          `Ambiguous hunk within '${symbolLabel}' in ${filePath}: search block matches ${trimmedMatches.length} locations (ignoring indentation). Include surrounding context lines or exact indentation to disambiguate.`,
        );
      }
      if (trimmedMatches.length === 1) {
        matchStart = trimmedMatches[0] ?? -1;
        matchEnd = matchStart + searchLines.length;
      }
    }

    if (matchStart < 0 && searchLines.length > 1) {
      const nonBlankSearch = searchLines.map((l) => l.trim()).filter(Boolean);
      const nonBlankMatches: Array<{ start: number; end: number }> = [];
      for (let s = 0; s < scopeLines.length; s++) {
        if ((scopeLines[s] ?? "").trim() !== nonBlankSearch[0]) continue;
        let curScopeIdx = s;
        let matchedAll = true;
        for (let k = 0; k < nonBlankSearch.length; k++) {
          while (curScopeIdx < scopeLines.length && (scopeLines[curScopeIdx] ?? "").trim() === "") {
            curScopeIdx++;
          }
          if (
            curScopeIdx >= scopeLines.length ||
            (scopeLines[curScopeIdx] ?? "").trim() !== nonBlankSearch[k]
          ) {
            matchedAll = false;
            break;
          }
          curScopeIdx++;
        }
        if (matchedAll) {
          nonBlankMatches.push({ start: s, end: curScopeIdx });
        }
      }
      if (nonBlankMatches.length > 1) {
        throw new Error(
          `Ambiguous hunk within '${symbolLabel}' in ${filePath}: search block matches ${nonBlankMatches.length} locations. Include surrounding context lines to disambiguate.`,
        );
      }
      if (nonBlankMatches.length === 1) {
        matchStart = nonBlankMatches[0]?.start ?? -1;
        matchEnd = nonBlankMatches[0]?.end ?? -1;
      }
    }

    if (matchStart < 0) {
      throw new Error(
        `Hunk search block not found within '${symbolLabel}' in ${filePath}:\n${hunk.search}`,
      );
    }

    const firstMatchedScopeLine = scopeLines[matchStart] ?? "";
    const scopeBaseIndent = firstMatchedScopeLine.match(/^[ \t]*/)?.[0] ?? "";
    const searchBaseIndent = searchLines[0]?.match(/^[ \t]*/)?.[0] ?? "";

    if (replaceNorm === "") {
      scopeLines.splice(matchStart, matchEnd - matchStart);
    } else {
      const rawRepLines = replaceNorm.split("\n");
      const adjustedRepLines = rawRepLines.map((rl) => {
        if (!rl.trim()) return "";
        if (searchBaseIndent.length > 0 && rl.startsWith(searchBaseIndent)) {
          return `${scopeBaseIndent}${rl.slice(searchBaseIndent.length)}`;
        }
        if (searchBaseIndent.length === 0 && !/^[ \t]/.test(rl)) {
          return `${scopeBaseIndent}${rl}`;
        }
        return rl;
      });
      scopeLines.splice(matchStart, matchEnd - matchStart, ...adjustedRepLines);
    }
    current = scopeLines.join("\n");
  }

  return isCrLf ? current.replace(/\n/g, nl) : current;
}

export function buildEmptySpliceBlockError(
  filePath: string,
  symbol?: string,
  action = "splicing native file",
): Error {
  const cleanSym = symbol && symbol !== ":create" ? symbol : "MyClass.myMethod";
  const headerDesc = symbol && symbol !== ":create" ? `${filePath}:${symbol}` : filePath;
  return new Error(
    `Empty or malformed splice block for '=== ${headerDesc} ===' — Must provide non-empty --code or --body when ${action}.\n` +
      `Valid heredoc / stream syntax:\n` +
      `  1) Full symbol replacement:\n` +
      `     === ${filePath}:${cleanSym} ===\n` +
      `     <replacement code>\n` +
      `  2) AST-scoped hunk splice (for 1-15 line edits inside a symbol):\n` +
      `     === ${filePath}:${cleanSym} ===\n` +
      `     <<<\n` +
      `     <lines to find>\n` +
      `     ===\n` +
      `     <replacement lines>\n` +
      `     >>>\n` +
      `  3) Line-range replacement:\n` +
      `     === ${filePath}:L10-L12 ===\n` +
      `     <replacement lines>`,
  );
}

function resolveSingleNativeEditAgainstSource(
  nativeSource: string,
  rawEditOptions: SpliceOptions,
  filePath: string,
  targetLang: TargetLanguage,
  idioms: Record<string, ProjectIdiomDefinition> | undefined,
  forceLosslessPreprocess: boolean,
): ResolvedNativeEdit {
  let options = rawEditOptions;
  let anchorSymbol = options.insertAfter ?? options.insertBefore ?? options.symbol;
  if (anchorSymbol) {
    if (/(?:\s+|^)@(?:replace|strip|drop)-docs\b/i.test(anchorSymbol)) {
      anchorSymbol = anchorSymbol.replace(/(?:\s+|^)@(?:replace|strip|drop)-docs\b/gi, "").trim();
      if (options.preserveDocs === undefined) {
        options = { ...options, preserveDocs: false };
      }
    }
    const inlineClone = anchorSymbol.match(
      /\s*(?:@clone|\(clone)\s*\(\s*([^()]+)\s*\)|\s*\(clone\s+([^()]+)\)|\s+@clone\s+([^\s()]+)/i,
    );
    if (inlineClone) {
      const extractedClone = (inlineClone[1] || inlineClone[2] || inlineClone[3] || "").trim();
      anchorSymbol = anchorSymbol.replace(inlineClone[0], "").trim();
      if (!options.cloneFrom && extractedClone) {
        options = { ...options, cloneFrom: extractedClone };
      }
    }
    anchorSymbol = anchorSymbol.replace(
      /^:(?=(?:eof|end|append|imports?|\s*\[?L?\d+(?:\s*(?:-|\.\.|:)\s*L?\d+)?\]?)$)/i,
      "",
    );
  }
  let rawSnippet = stripNumberedGutterPrefixes(options.code ?? options.body ?? "");

  if (
    (!anchorSymbol ||
      anchorSymbol === ":hunk" ||
      anchorSymbol === "hunk" ||
      isCreateOrOverwriteSymbol(anchorSymbol)) &&
    containsHunkMarkers(rawSnippet)
  ) {
    const hunks = extractHunkBlocks(rawSnippet);
    if (hunks.length > 0) {
      const updated = applyHunksToScope(
        nativeSource,
        hunks,
        filePath,
        filePath,
        targetLang,
        idioms,
        options.idioms !== false,
      );
      return {
        symbol: anchorSymbol || ":hunk",
        startOffset: 0,
        endOffset: nativeSource.length,
        replacement: updated,
        originalSnippet: hunks.map((h) => h.search).join("\n\n"),
        newSnippet: rawSnippet,
      };
    }
  }

  if (!anchorSymbol) {
    throw new Error("Must specify target symbol with --symbol when splicing native file");
  }

  if (options.cloneFrom) {
    const cloneSym = options.cloneFrom.trim();
    const cloneSpan = locateNativeDeclarationSpan(nativeSource, cloneSym, targetLang);
    let clonedSlice = "";
    let insertPos = -1;
    let isTest = false;

    if (!cloneSpan) {
      const testBlocks = extractNativeTestBlocks(nativeSource);
      const tb = testBlocks.find((t) => t.title === cloneSym || t.title.startsWith(cloneSym));
      if (tb) {
        clonedSlice = nativeSource.slice(tb.startOffset, tb.endOffset);
        insertPos = tb.endOffset;
        isTest = true;
      } else {
        throw new Error(`Symbol to clone '${cloneSym}' not found in ${filePath}`);
      }
    } else {
      const resolvedCloneSpan = cloneSpan;
      const testBlocks = extractNativeTestBlocks(nativeSource);
      const tb = testBlocks.find(
        (t) =>
          t.title === cloneSym ||
          t.title.startsWith(cloneSym) ||
          (t.startOffset === resolvedCloneSpan.declStart &&
            t.endOffset === resolvedCloneSpan.declEnd),
      );
      if (tb) {
        clonedSlice = nativeSource.slice(tb.startOffset, tb.endOffset);
        insertPos = tb.endOffset;
        isTest = true;
      } else {
        clonedSlice = nativeSource.slice(resolvedCloneSpan.declStart, resolvedCloneSpan.declEnd);
        insertPos = resolvedCloneSpan.declEnd;
      }
    }

    const ruleLines = rawSnippet.split(/\r?\n/);
    const rules: Array<{ from: string; to: string }> = [];
    for (const line of ruleLines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("#")) continue;
      const arrowMatch = trimmed.match(
        /^(?:"([^"]*)"|'([^']*)'|(.+?))\s*->\s*(?:"([^"]*)"|'([^']*)'|(.+))$/,
      );
      if (arrowMatch) {
        const from =
          arrowMatch[1] !== undefined
            ? arrowMatch[1]
            : arrowMatch[2] !== undefined
              ? arrowMatch[2]
              : (arrowMatch[3] ?? "").trim();
        const to =
          arrowMatch[4] !== undefined
            ? arrowMatch[4]
            : arrowMatch[5] !== undefined
              ? arrowMatch[5]
              : (arrowMatch[6] ?? "").trim();
        if (from.length > 0) {
          rules.push({ from, to });
        }
      }
    }

    if (rules.length > 0) {
      const sortedRules = [...rules].sort((a, b) => b.from.length - a.from.length);
      const pattern = sortedRules
        .map((r) => r.from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("|");
      const ruleMap = new Map(rules.map((r) => [r.from, r.to]));
      clonedSlice = clonedSlice.replace(new RegExp(pattern, "g"), (m) => ruleMap.get(m) ?? m);
    }

    const cloneNl = nativeSource.includes("\r\n") ? "\r\n" : "\n";
    const computeCloneSep = (pos: number): string => {
      const tail = nativeSource.slice(pos);
      if (/^(?:\r?\n){2}/.test(tail)) return "";
      if (/^\r?\n/.test(tail)) return cloneNl;
      return `${cloneNl}${cloneNl}`;
    };

    if (isTest) {
      if (!rules.some((r) => r.from === cloneSym) && clonedSlice.includes(cloneSym)) {
        clonedSlice = clonedSlice.replace(cloneSym, () => anchorSymbol);
      }
      const sep = computeCloneSep(insertPos);
      return {
        symbol: anchorSymbol,
        startOffset: insertPos,
        endOffset: insertPos,
        replacement: `${sep}${clonedSlice}`,
        originalSnippet: "",
        newSnippet: clonedSlice,
        isInsertion: true,
      };
    }

    const cloneShort = cloneSym.split(/[.:]/).pop()?.trim();
    const targetShort = anchorSymbol.split(/[.:]/).pop()?.trim();
    if (cloneShort && targetShort && cloneShort !== targetShort) {
      if (!rules.some((r) => r.from === cloneShort)) {
        const escaped = cloneShort.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        clonedSlice = clonedSlice.replace(new RegExp(`\\b${escaped}\\b`), () => targetShort);
      }
    }

    const targetSpan = locateNativeDeclarationSpan(nativeSource, anchorSymbol, targetLang);
    if (!targetSpan) {
      const sep = computeCloneSep(insertPos);
      return {
        symbol: anchorSymbol,
        startOffset: insertPos,
        endOffset: insertPos,
        replacement: `${sep}${clonedSlice}`,
        originalSnippet: "",
        newSnippet: clonedSlice,
        isInsertion: true,
      };
    }
    rawSnippet = clonedSlice;
  }

  if (/^(?:eof|end|append)$/i.test(anchorSymbol.trim())) {
    if (options.delete) {
      throw new Error(`Cannot delete '${anchorSymbol}'`);
    }
    if (!rawSnippet.trim()) {
      throw buildEmptySpliceBlockError(filePath, anchorSymbol, "appending to native file");
    }
    const emitted = emitNativeSnippetForContext(
      rawSnippet,
      filePath,
      targetLang,
      undefined,
      idioms,
      undefined,
      false,
      undefined,
      forceLosslessPreprocess,
    );
    const prefix = nativeSource.length === 0 || nativeSource.endsWith("\n") ? "" : "\n";
    return {
      symbol: anchorSymbol,
      startOffset: nativeSource.length,
      endOffset: nativeSource.length,
      replacement: `${prefix}${emitted}\n`,
      originalSnippet: "",
      newSnippet: emitted,
    };
  }

  const lineRangeMatch = anchorSymbol.trim().match(/^\[?L?(\d+)(?:-L?(\d+))?\]?$/i);
  if (lineRangeMatch) {
    const startLine = parseInt(lineRangeMatch[1], 10);
    let endLine = lineRangeMatch[2] ? parseInt(lineRangeMatch[2], 10) : startLine;

    const rawLines = nativeSource.split(/\r?\n/);
    const totalLines = rawLines.length;

    if (startLine > totalLines) {
      throw new Error(
        `Invalid line range L${startLine}-L${endLine}: file only has ${totalLines} line(s). To append to the end of the file, use ':eof' or ':append'.`,
      );
    }
    if (endLine > totalLines) {
      endLine = totalLines;
    }

    if (startLine < 1 || startLine > endLine) {
      throw new Error(
        `Invalid line range L${startLine}-L${endLine}: file has ${totalLines} line(s) (1-based inclusive)`,
      );
    }
    const lineStarts: number[] = [0];
    for (let i = 0; i < nativeSource.length; i++) {
      if (nativeSource[i] === "\n") {
        lineStarts.push(i + 1);
      }
    }

    const startOffset = lineStarts[startLine - 1];
    const endOffset = endLine < lineStarts.length ? lineStarts[endLine] : nativeSource.length;
    const originalSnippet = nativeSource.slice(startOffset, endOffset);

    if (options.delete) {
      let delStart = startOffset;
      const delEnd = endOffset;
      if (endLine >= lineStarts.length && startOffset > 0) {
        if (startOffset >= 2 && nativeSource[startOffset - 2] === "\r") {
          delStart = startOffset - 2;
        } else {
          delStart = startOffset - 1;
        }
      }
      return {
        symbol: anchorSymbol,
        startOffset: delStart,
        endOffset: delEnd,
        replacement: "",
        originalSnippet,
        newSnippet: "",
      };
    }

    if (containsHunkMarkers(rawSnippet)) {
      const hunks = extractHunkBlocks(rawSnippet);
      if (hunks.length > 0) {
        try {
          const updatedRange = applyHunksToScope(
            originalSnippet,
            hunks,
            anchorSymbol,
            filePath,
            targetLang,
            idioms,
            options.idioms !== false,
          );
          return {
            symbol: anchorSymbol,
            startOffset,
            endOffset,
            replacement: updatedRange,
            originalSnippet,
            newSnippet: updatedRange,
          };
        } catch {
          const winStartLine = Math.max(1, startLine - 40);
          const winEndLine = Math.min(totalLines, endLine + 40);
          const winStartOff = lineStarts[winStartLine - 1];
          const winEndOff =
            winEndLine < lineStarts.length ? lineStarts[winEndLine] : nativeSource.length;
          const winSlice = nativeSource.slice(winStartOff, winEndOff);
          const updatedWin = applyHunksToScope(
            winSlice,
            hunks,
            anchorSymbol,
            filePath,
            targetLang,
            idioms,
            options.idioms !== false,
          );
          return {
            symbol: anchorSymbol,
            startOffset: winStartOff,
            endOffset: winEndOff,
            replacement: updatedWin,
            originalSnippet: winSlice,
            newSnippet: updatedWin,
          };
        }
      }
    }

    if (!rawSnippet.trim()) {
      throw buildEmptySpliceBlockError(filePath, anchorSymbol, "splicing line range");
    }

    let processedCode =
      options.idioms === false
        ? rawSnippet
        : preprocessHybridAndIdiomsLossless(rawSnippet, targetLang, idioms);

    const origFirstLine = rawLines[startLine - 1] ?? "";
    const origIndent = origFirstLine.match(/^[ \t]*/)?.[0] ?? "";
    if (origIndent.length > 0) {
      const procLines = processedCode.split(/\r?\n/);
      if (procLines.length > 0 && procLines[0].length > 0 && !/^[ \t]/.test(procLines[0])) {
        processedCode = procLines
          .map((line) => (line.length > 0 && !/^[ \t]/.test(line) ? `${origIndent}${line}` : line))
          .join("\n");
      }
    }

    const isCrLf =
      (endOffset > 0 && nativeSource.slice(0, endOffset).endsWith("\r\n")) ||
      nativeSource.includes("\r\n");
    const nl = isCrLf ? "\r\n" : "\n";

    if (isCrLf) {
      processedCode = processedCode.replace(/\r?\n/g, "\r\n");
    }

    if (endLine < lineStarts.length) {
      if (!processedCode.endsWith("\n") && !processedCode.endsWith("\r\n")) {
        processedCode += nl;
      }
    }

    let finalStartOffset = startOffset;
    let finalEndOffset = endOffset;
    let finalOriginalSnippet = originalSnippet;

    const literalCandidate = `${nativeSource.slice(0, startOffset)}${processedCode}${nativeSource.slice(endOffset)}`;
    const literalCheck = validateNativeSyntax(literalCandidate, targetLang, filePath, idioms);
    const countNetDelims = (s: string): { braces: number; parens: number } => {
      let braces = 0;
      let parens = 0;
      for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (ch === "{") braces++;
        else if (ch === "}") braces--;
        else if (ch === "(") parens++;
        else if (ch === ")") parens--;
      }
      return { braces, parens };
    };
    const origDelims = countNetDelims(originalSnippet);
    const procDelims = countNetDelims(processedCode);
    const procLineList = processedCode.trim().split(/\r?\n/);
    const procFirstTrim = procLineList[0]?.trim() ?? "";
    const alreadyAnchoredAtStart =
      procFirstTrim.length >= 6 && rawLines[startLine - 1]?.trim() === procFirstTrim;
    const introducesUnbalancedDelims =
      (origDelims.braces === 0 && procDelims.braces !== 0) ||
      (origDelims.parens === 0 && procDelims.parens !== 0);
    const isExplicitNamedDeclHeader =
      /^(?:export\s+|default\s+|public\s+|private\s+|protected\s+|internal\s+|static\s+|async\s+|pub\s+|fn\s+|function\s+|def\s+|class\s+|struct\s+|interface\s+|type\s+|enum\s+|const\s+|let\s+|var\s+|impl\s+|func\s+)+[A-Za-z_$][A-Za-z0-9_$]*\b/.test(
        procFirstTrim,
      );
    const windowLines = rawLines.slice(
      Math.max(0, startLine - 41),
      Math.min(rawLines.length, startLine + 40),
    );
    const windowExactHeaderCount = isExplicitNamedDeclHeader
      ? windowLines.filter((l) => l.trim() === procFirstTrim).length
      : 0;
    const hasShiftedHeaderMatch =
      !alreadyAnchoredAtStart &&
      !introducesUnbalancedDelims &&
      isExplicitNamedDeclHeader &&
      procLineList.length >= 2 &&
      rawLines[startLine - 1]?.trim() !== procFirstTrim &&
      windowExactHeaderCount === 1;
    if (
      (!literalCheck.valid || hasShiftedHeaderMatch) &&
      !alreadyAnchoredAtStart &&
      !introducesUnbalancedDelims
    ) {
      const origSpanCount = Math.max(1, endLine - startLine + 1);
      const procLastTrim = procLineList[procLineList.length - 1]?.trim() ?? "";
      const procTokens = new Set(
        (processedCode.match(/[A-Za-z_$][A-Za-z0-9_$-]{2,}/g) ?? []).map((t) => t.toLowerCase()),
      );

      let bestScore = 0;
      let bestStart = -1;
      let bestEnd = -1;

      const minStart = Math.max(1, startLine - 40);
      const maxStart = Math.min(rawLines.length, startLine + 40);
      const spanLen = origSpanCount;

      for (let candStartLine = minStart; candStartLine <= maxStart; candStartLine++) {
        if (!isExplicitNamedDeclHeader) continue;
        if (rawLines[candStartLine - 1]?.trim() !== procFirstTrim) continue;
        {
          const candEndLine = Math.min(rawLines.length, candStartLine + spanLen - 1);
          if (candStartLine === startLine && candEndLine === endLine) continue;
          const cStartOff = lineStarts[candStartLine - 1];
          const cEndOff =
            candEndLine < lineStarts.length ? lineStarts[candEndLine] : nativeSource.length;
          const candSlice = nativeSource.slice(cStartOff, cEndOff);
          const candDelims = countNetDelims(candSlice);
          if (candDelims.braces !== procDelims.braces || candDelims.parens !== procDelims.parens) {
            continue;
          }
          const candTokens = (candSlice.match(/[A-Za-z_$][A-Za-z0-9_$-]{2,}/g) ?? []).map((t) =>
            t.toLowerCase(),
          );
          let overlap = 0;
          for (const tok of candTokens) {
            if (procTokens.has(tok)) overlap++;
          }
          if (procFirstTrim && rawLines[candStartLine - 1]?.trim() === procFirstTrim) {
            overlap += 20;
          }
          if (procLastTrim && rawLines[candEndLine - 1]?.trim() === procLastTrim) {
            overlap += 15;
          }
          if (overlap <= 0) continue;
          const distPenalty =
            Math.abs(candStartLine - startLine) * 0.5 + Math.abs(spanLen - origSpanCount) * 0.5;
          const score = overlap - distPenalty;
          if (score > bestScore) {
            const testModified = `${nativeSource.slice(0, cStartOff)}${processedCode}${nativeSource.slice(cEndOff)}`;
            if (validateNativeSyntax(testModified, targetLang, filePath, idioms).valid) {
              bestScore = score;
              bestStart = cStartOff;
              bestEnd = cEndOff;
            }
          }
        }
      }

      if (bestStart >= 0 && bestEnd >= bestStart) {
        finalStartOffset = bestStart;
        finalEndOffset = bestEnd;
        finalOriginalSnippet = nativeSource.slice(bestStart, bestEnd);
      } else if (validateNativeSyntax(nativeSource, targetLang, filePath, idioms).valid) {
        const diagMsg = literalCheck.diagnostics.slice(0, 3).join("; ");
        throw new Error(
          `Line-range splice (${anchorSymbol}) rejected in ${filePath}: replacement leaves unbalanced braces/parentheses or syntax errors (${diagMsg}). Use AST-scoped hunk splicing: === ${filePath}:<symbol> === with <<< / === / >>>.`,
        );
      }
    }

    return {
      symbol: anchorSymbol,
      startOffset: finalStartOffset,
      endOffset: finalEndOffset,
      replacement: processedCode,
      originalSnippet: finalOriginalSnippet,
      newSnippet: processedCode,
    };
  }

  const preferAccessor: "get" | "set" | undefined =
    /^\s*(?:pub\s+|public\s+|private\s+|protected\s+)?get\b/.test(rawSnippet)
      ? "get"
      : /^\s*(?:pub\s+|public\s+|private\s+|protected\s+)?set\b/.test(rawSnippet)
        ? "set"
        : undefined;

  const preferredArity =
    options.code && !options.insertAfter && !options.insertBefore && !options.append
      ? inferSnippetParamArity(options.code)
      : undefined;
  let spanInfo =
    (targetLang === "markdown" ||
      targetLang === "shell" ||
      targetLang === "powershell" ||
      targetLang === "batch") &&
    !options.insertBefore &&
    !options.insertAfter
      ? enrichSpanWithOffsetsAndLines(
          nativeSource,
          locateScriptOrMarkdownSpan(nativeSource, anchorSymbol, targetLang, true),
        )
      : locateNativeDeclarationSpan(
          nativeSource,
          anchorSymbol,
          targetLang,
          undefined,
          preferAccessor,
          preferredArity,
          true,
        );
  let autoAppendToClass = false;

  if (!spanInfo && !options.delete && !options.insertBefore && !options.insertAfter) {
    const trimmedAnchor = anchorSymbol.trim();
    if (targetLang === "markdown" && rawSnippet.trim()) {
      const headingPrefix = trimmedAnchor.startsWith("#") ? trimmedAnchor : `## ${trimmedAnchor}`;
      const bodyTrimmed = rawSnippet.trim();
      const emitted = /^#{1,6}\s+/.test(bodyTrimmed)
        ? bodyTrimmed
        : `${headingPrefix}\n${bodyTrimmed}`;
      const sep = nativeSource.endsWith("\n") ? "\n" : "\n\n";
      return {
        symbol: anchorSymbol,
        startOffset: nativeSource.length,
        endOffset: nativeSource.length,
        replacement: `${sep}${emitted}\n`,
        originalSnippet: "",
        newSnippet: emitted,
      };
    }
    if (
      (targetLang === "shell" || targetLang === "powershell" || targetLang === "batch") &&
      rawSnippet.trim() &&
      extractScriptOrMarkdownSymbols(rawSnippet, targetLang).length > 0
    ) {
      const emitted = rawSnippet.trim();
      const sep = nativeSource.endsWith("\n") ? "\n" : "\n\n";
      return {
        symbol: anchorSymbol,
        startOffset: nativeSource.length,
        endOffset: nativeSource.length,
        replacement: `${sep}${emitted}\n`,
        originalSnippet: "",
        newSnippet: emitted,
      };
    }
    const plusMatch = trimmedAnchor.match(/^([A-Za-z_$][A-Za-z0-9_$]*)\+$/);
    const dotIdx = trimmedAnchor.indexOf(".");
    const scopeIdx = trimmedAnchor.indexOf("::");
    const candidateClassName = plusMatch
      ? plusMatch[1]
      : dotIdx > 0
        ? trimmedAnchor.slice(0, dotIdx).trim()
        : scopeIdx > 0
          ? trimmedAnchor.slice(0, scopeIdx).trim()
          : undefined;
    if (candidateClassName) {
      const classSpan = locateNativeDeclarationSpan(nativeSource, candidateClassName, targetLang);
      if (classSpan && classSpan.isClassContainer) {
        spanInfo = classSpan;
        autoAppendToClass = true;
      } else if (targetLang === "cpp" && rawSnippet.trim()) {
        const escCls = candidateClassName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const hasCppRefInFile =
          new RegExp(`\\b${escCls}\\b`).test(nativeSource) || /#\s*include\b/.test(nativeSource);
        const emitted = emitNativeSnippetForContext(
          rawSnippet,
          filePath,
          targetLang,
          undefined,
          idioms,
          undefined,
          false,
          undefined,
          forceLosslessPreprocess,
        );
        if (hasCppRefInFile && new RegExp(`\\b${escCls}\\s*::`).test(emitted)) {
          const sep = nativeSource.endsWith("\n") ? "\n" : "\n\n";
          return {
            symbol: anchorSymbol,
            startOffset: nativeSource.length,
            endOffset: nativeSource.length,
            replacement: `${sep}${emitted}\n`,
            originalSnippet: "",
            newSnippet: emitted,
          };
        }
      }
    }
  }

  if (!spanInfo) {
    throw new Error(`Symbol '${anchorSymbol}' not found in ${filePath}`);
  }
  const originalSnippet = nativeSource.slice(spanInfo.declStart, spanInfo.declEnd);

  if (options.delete) {
    const delStart = spanInfo.fullDeclStart ?? spanInfo.declStart;
    const delEnd = spanInfo.declEnd;
    return {
      symbol: anchorSymbol,
      startOffset: delStart,
      endOffset: delEnd,
      replacement: "",
      originalSnippet,
      newSnippet: "",
    };
  }

  if (options.insertBefore || options.insertAfter) {
    if (!rawSnippet.trim()) {
      throw buildEmptySpliceBlockError(filePath, anchorSymbol, "inserting into native file");
    }
    const emittedUnindented = emitNativeSnippetForContext(
      rawSnippet,
      filePath,
      targetLang,
      { ...spanInfo, origHeader: undefined },
      idioms,
      undefined,
      false,
      spanInfo.className,
      forceLosslessPreprocess,
    );
    const newSnippet = indentCode(emittedUnindented, spanInfo.declIndent);
    if (options.insertBefore) {
      const insStart = spanInfo.fullDeclStart ?? spanInfo.declStart;
      return {
        symbol: anchorSymbol,
        startOffset: insStart,
        endOffset: insStart,
        replacement: `${newSnippet}\n\n`,
        originalSnippet,
        newSnippet,
      };
    }
    return {
      symbol: anchorSymbol,
      startOffset: spanInfo.declEnd,
      endOffset: spanInfo.declEnd,
      replacement: `\n\n${newSnippet}`,
      originalSnippet,
      newSnippet,
    };
  }

  if ((options.append || autoAppendToClass) && spanInfo.isClassContainer) {
    if (!rawSnippet.trim()) {
      throw buildEmptySpliceBlockError(filePath, anchorSymbol, "appending to class in native file");
    }
    if (targetLang === "go" && /^\s*(?:func|pub\s+fn|fn|@fn|\^fn)\b/m.test(rawSnippet)) {
      const clsName = spanInfo.memberName;
      const recvRe = new RegExp(
        `^\\s*func\\s*\\(\\s*([A-Za-z0-9_]+\\s+\\*?${clsName})\\s*\\)`,
        "m",
      );
      const recvMatch = recvRe.exec(nativeSource);
      const inferredRecv = recvMatch?.[1]
        ? `(${recvMatch[1]})`
        : `(${clsName[0].toLowerCase()} *${clsName})`;
      let emittedGo = emitNativeSnippetForContext(
        rawSnippet,
        filePath,
        targetLang,
        { ...spanInfo, goReceiver: inferredRecv },
        idioms,
        undefined,
        false,
        clsName,
        forceLosslessPreprocess,
      );
      if (/^\s*func\s+[A-Za-z0-9_]+\s*\(/.test(emittedGo)) {
        emittedGo = emittedGo.replace(/^(\s*func\s+)([A-Za-z0-9_]+\s*\()/, `$1${inferredRecv} $2`);
      }
      const sep = nativeSource.endsWith("\n") ? "\n" : "\n\n";
      return {
        symbol: anchorSymbol,
        startOffset: nativeSource.length,
        endOffset: nativeSource.length,
        replacement: `${sep}${emittedGo}\n`,
        originalSnippet,
        newSnippet: emittedGo,
      };
    }
    if (
      targetLang === "rust" &&
      /^\s*(?:#\[[^\]]+\]\s*)*(?:pub(?:\([^)]*\))?\s+|@fn\s+|\^fn\s+|async\s+|const\s+|unsafe\s+)*fn\b/m.test(
        rawSnippet,
      )
    ) {
      const clsName = spanInfo.memberName;
      const emittedUnindented = emitNativeSnippetForContext(
        rawSnippet,
        filePath,
        targetLang,
        undefined,
        idioms,
        undefined,
        false,
        clsName,
        forceLosslessPreprocess,
      );
      const lines = nativeSource.split("\n");
      let lineOff = 0;
      let implOpenBrace = -1;
      let implIndent = "";
      for (const l of lines) {
        const inherentMatch = new RegExp(
          `^([ \\t]*)impl(?:\\s*<[^>]*>)?\\s+${clsName}\\b(?![^{]*\\bfor\\b)`,
        ).exec(l);
        const traitMatch = new RegExp(
          `^([ \\t]*)impl(?:\\s*<[^>]*>)?\\s+[^{]+\\bfor\\s+${clsName}\\b`,
        ).exec(l);
        const m = inherentMatch || (implOpenBrace < 0 ? traitMatch : null);
        if (m) {
          const ob = nativeSource.indexOf("{", lineOff);
          if (ob >= 0) {
            implOpenBrace = ob;
            implIndent = m[1];
            if (inherentMatch) break;
          }
        }
        lineOff += l.length + 1;
      }
      if (implOpenBrace >= 0) {
        const implEnd = findMatchingBraceEnd(nativeSource, implOpenBrace, "rust");
        const memberIndent = `${implIndent}    `;
        const newSnippet = indentCode(emittedUnindented, memberIndent);
        const closeBracePos = nativeSource.lastIndexOf("}", implEnd);
        const lineStartBeforeClose = nativeSource.lastIndexOf("\n", closeBracePos);
        const insertPos =
          lineStartBeforeClose >= implOpenBrace ? lineStartBeforeClose + 1 : closeBracePos;
        return {
          symbol: anchorSymbol,
          startOffset: insertPos,
          endOffset: insertPos,
          replacement: `\n${newSnippet}\n`,
          originalSnippet: nativeSource.slice(implOpenBrace, implEnd),
          newSnippet,
        };
      }
      const memberIndent = `${spanInfo.declIndent}    `;
      const newSnippet = indentCode(emittedUnindented, memberIndent);
      const implBlock = `${spanInfo.declIndent}impl ${clsName} {\n${newSnippet}\n${spanInfo.declIndent}}`;
      return {
        symbol: anchorSymbol,
        startOffset: spanInfo.declEnd,
        endOffset: spanInfo.declEnd,
        replacement: `\n\n${implBlock}`,
        originalSnippet,
        newSnippet: implBlock,
      };
    }
    const memberIndent =
      targetLang === "python" ||
      targetLang === "rust" ||
      targetLang === "csharp" ||
      targetLang === "kotlin" ||
      targetLang === "php"
        ? `${spanInfo.declIndent}    `
        : `${spanInfo.declIndent}  `;
    const emittedUnindented = emitNativeSnippetForContext(
      rawSnippet,
      filePath,
      targetLang,
      undefined,
      idioms,
      undefined,
      false,
      spanInfo.memberName,
      forceLosslessPreprocess,
    );
    const newSnippet = indentCode(emittedUnindented, memberIndent);
    if (targetLang === "python") {
      return {
        symbol: anchorSymbol,
        startOffset: spanInfo.declEnd,
        endOffset: spanInfo.declEnd,
        replacement: `\n\n${newSnippet}`,
        originalSnippet,
        newSnippet,
      };
    }
    if (targetLang === "aipl") {
      const trimmedOrig = originalSnippet.trimStart();
      const origWithoutLastLineCmt = originalSnippet.replace(/\s*\/\/[^\n]*$/, "");
      if (
        /^(?:pub\s+)?struct\s+[A-Za-z0-9_]+\s*\(/.test(trimmedOrig) &&
        origWithoutLastLineCmt.trimEnd().endsWith(")")
      ) {
        const closeSearchEnd = spanInfo.declStart + origWithoutLastLineCmt.length;
        const closeParenPos = nativeSource.lastIndexOf(")", closeSearchEnd);
        if (!originalSnippet.includes("\n") && closeParenPos > spanInfo.declStart) {
          const openParenPos = nativeSource.indexOf("(", spanInfo.declStart);
          const inner =
            openParenPos >= 0 ? nativeSource.slice(openParenPos + 1, closeParenPos).trim() : "";
          const inlineField = emittedUnindented
            .trim()
            .replace(/^val\s+/, "")
            .replace(/,\s*$/, "");
          const sep = inner.length > 0 && !inner.endsWith(",") ? ", " : "";
          return {
            symbol: anchorSymbol,
            startOffset: closeParenPos,
            endOffset: closeParenPos,
            replacement: `${sep}${inlineField}`,
            originalSnippet,
            newSnippet: inlineField,
          };
        }
        const lineStartBeforeClose = nativeSource.lastIndexOf("\n", closeParenPos);
        if (lineStartBeforeClose >= spanInfo.declStart) {
          let prevEnd = lineStartBeforeClose;
          while (
            prevEnd > spanInfo.declStart &&
            (nativeSource[prevEnd - 1] === "\r" ||
              nativeSource[prevEnd - 1] === " " ||
              nativeSource[prevEnd - 1] === "\t")
          ) {
            prevEnd--;
          }
          const needsComma =
            prevEnd > spanInfo.declStart &&
            nativeSource[prevEnd - 1] !== "," &&
            nativeSource[prevEnd - 1] !== "(";
          return {
            symbol: anchorSymbol,
            startOffset: prevEnd,
            endOffset: lineStartBeforeClose,
            replacement: `${needsComma ? "," : ""}\n${newSnippet}`,
            originalSnippet,
            newSnippet,
          };
        }
      }
      return {
        symbol: anchorSymbol,
        startOffset: spanInfo.declEnd,
        endOffset: spanInfo.declEnd,
        replacement: `\n${newSnippet}`,
        originalSnippet,
        newSnippet,
      };
    }
    const closeBracePos = nativeSource.lastIndexOf("}", spanInfo.declEnd);
    if (closeBracePos < spanInfo.declStart) {
      let bodyStartPos = spanInfo.declEnd;
      while (
        bodyStartPos > spanInfo.declStart &&
        (nativeSource[bodyStartPos - 1] === "\n" ||
          nativeSource[bodyStartPos - 1] === "\r" ||
          nativeSource[bodyStartPos - 1] === " " ||
          nativeSource[bodyStartPos - 1] === "\t")
      ) {
        bodyStartPos--;
      }
      const trailingSemi =
        bodyStartPos > spanInfo.declStart && nativeSource[bodyStartPos - 1] === ";";
      const repStart = trailingSemi ? bodyStartPos - 1 : bodyStartPos;
      return {
        symbol: anchorSymbol,
        startOffset: repStart,
        endOffset: bodyStartPos,
        replacement: ` {\n${newSnippet}\n${spanInfo.declIndent}}${trailingSemi ? ";" : ""}`,
        originalSnippet,
        newSnippet,
      };
    }
    const lineStartBeforeClose = nativeSource.lastIndexOf("\n", closeBracePos);
    const insertPos =
      lineStartBeforeClose >= spanInfo.declStart ? lineStartBeforeClose + 1 : closeBracePos;
    return {
      symbol: anchorSymbol,
      startOffset: insertPos,
      endOffset: insertPos,
      replacement: `\n${newSnippet}\n`,
      originalSnippet,
      newSnippet,
    };
  }

  if (!rawSnippet.trim()) {
    throw buildEmptySpliceBlockError(filePath, anchorSymbol, "splicing native file");
  }

  if (containsHunkMarkers(rawSnippet)) {
    const hunks = extractHunkBlocks(rawSnippet);
    if (hunks.length > 0) {
      const updatedSymbolScope = applyHunksToScope(
        originalSnippet,
        hunks,
        anchorSymbol,
        filePath,
        targetLang,
        idioms,
        options.idioms !== false,
        spanInfo.isClassContainer ? "container" : spanInfo.className ? "member" : false,
      );
      return {
        symbol: anchorSymbol,
        startOffset: spanInfo.declStart,
        endOffset: spanInfo.declEnd,
        replacement: updatedSymbolScope,
        originalSnippet,
        newSnippet: updatedSymbolScope,
      };
    }
  }

  const { cleanedCode } = extractInlineIdiomsFromSource(rawSnippet);
  const trimmedClean = cleanedCode.trimStart();
  const isAiceComp = /^(?:(?:#[^\n]*|module\s+[^\n]+)\n+|\s)*(?:pub\s+)?component\b/m.test(
    trimmedClean,
  );
  const hasLeadingNativeAttr =
    /^(?:@(?!fn\b|cls\b|type\b|idiom\b)[A-Za-z_]|#\[|\[[A-Za-z_]|template\s*<)/.test(trimmedClean);

  const replaceStart = isAiceComp
    ? (spanInfo.propsDeclStart ?? spanInfo.declStart)
    : hasLeadingNativeAttr
      ? (spanInfo.fullDeclStart ?? spanInfo.declStart)
      : spanInfo.declStart;

  const isBodyOnly = options.body !== undefined && options.code === undefined;
  const emittedUnindented = emitNativeSnippetForContext(
    rawSnippet,
    filePath,
    targetLang,
    spanInfo,
    idioms,
    originalSnippet,
    isBodyOnly,
    spanInfo.className,
    forceLosslessPreprocess,
  );

  let newSnippet = indentCode(emittedUnindented, spanInfo.declIndent);
  if (spanInfo.memberName === "imports") {
    const fileNl = nativeSource.includes("\r\n") ? "\r\n" : "\n";
    const replaceAllImports = /@(?:replace|overwrite)-imports\b/.test(rawSnippet);
    if (spanInfo.declStart === spanInfo.declEnd) {
      const afterInsert = nativeSource.slice(spanInfo.declEnd);
      const sepAfter =
        afterInsert.length === 0
          ? fileNl
          : /^\r?\n/.test(afterInsert)
            ? fileNl
            : `${fileNl}${fileNl}`;
      newSnippet = `${newSnippet.trimEnd()}${sepAfter}`;
    } else if (
      !replaceAllImports &&
      (targetLang === "typescript" || targetLang === "javascript" || targetLang === "tsx")
    ) {
      interface TsImportEntry {
        leadingTrivia: string;
        codeText: string;
        text: string;
        spec?: string;
        isTypeOnly: boolean;
      }
      const parseTsImportEntries = (
        src: string,
      ): { entries: TsImportEntry[]; trailingAfterLast: string } => {
        const parsedSf = getCachedTsSourceFile(src);
        const importNodes = parsedSf.statements.filter(
          (st): st is ts.ImportDeclaration | ts.ImportEqualsDeclaration =>
            ts.isImportDeclaration(st) || ts.isImportEqualsDeclaration(st),
        );
        const entries: TsImportEntry[] = [];
        let cursor = 0;
        for (let idx = 0; idx < importNodes.length; idx++) {
          const st = importNodes[idx];
          const tokStart = st.getStart(parsedSf, false);
          const lineStart = src.lastIndexOf("\n", tokStart - 1) + 1;
          const stmtCodeStart =
            lineStart >= cursor && /^[ \t]*$/.test(src.slice(lineStart, tokStart))
              ? lineStart
              : tokStart;
          let rawLeading = src.slice(cursor, stmtCodeStart);
          if (idx === 0) {
            rawLeading = rawLeading.replace(/^(?:[ \t]*\r?\n)+/, "");
          }
          const leadingTrivia = rawLeading.replace(/\r?\n/g, fileNl);

          const nextNode = importNodes[idx + 1];
          const nextTokStart = nextNode ? nextNode.getStart(parsedSf, false) : src.length;
          let stmtEnd = st.getEnd();
          while (
            stmtEnd < nextTokStart &&
            stmtEnd < src.length &&
            src[stmtEnd] !== "\n" &&
            src[stmtEnd] !== "\r"
          ) {
            stmtEnd++;
          }
          const codeText = src.slice(stmtCodeStart, stmtEnd).trimEnd().replace(/\r?\n/g, fileNl);
          let nextCursor = stmtEnd;
          if (src[nextCursor] === "\r") nextCursor++;
          if (src[nextCursor] === "\n") nextCursor++;
          cursor = nextCursor;

          const spec = ts.isImportDeclaration(st)
            ? ts.isStringLiteral(st.moduleSpecifier)
              ? st.moduleSpecifier.text
              : undefined
            : st.name.text;
          const isTypeOnly = ts.isImportDeclaration(st)
            ? Boolean(st.importClause?.isTypeOnly)
            : st.isTypeOnly;
          entries.push({
            leadingTrivia,
            codeText,
            text: `${leadingTrivia}${codeText}`,
            spec,
            isTypeOnly,
          });
        }
        const rawRest = src.slice(cursor).replace(/(?:\r?\n)+$/, "");
        const trailingAfterLast = rawRest.trim()
          ? `${fileNl}${rawRest.replace(/\r?\n/g, fileNl)}`
          : "";
        return { entries, trailingAfterLast };
      };
      const { entries: origEntries, trailingAfterLast } = parseTsImportEntries(originalSnippet);
      const { entries: newEntries } = parseTsImportEntries(newSnippet);
      if (
        origEntries.length >= 1 &&
        newEntries.length >= 1 &&
        newEntries.every((e) => Boolean(e.spec))
      ) {
        const merged = [...origEntries];
        for (const ne of newEntries) {
          let existingIdx = merged.findIndex(
            (oe) => oe.spec === ne.spec && oe.isTypeOnly === ne.isTypeOnly,
          );
          if (existingIdx < 0) {
            const sameSpecIdxs = merged
              .map((oe, i) => (oe.spec === ne.spec ? i : -1))
              .filter((i) => i >= 0);
            if (
              sameSpecIdxs.length === 1 &&
              newEntries.filter((x) => x.spec === ne.spec).length === 1 &&
              !ne.isTypeOnly &&
              !merged[sameSpecIdxs[0]]?.isTypeOnly
            ) {
              existingIdx = sameSpecIdxs[0] ?? -1;
            }
          }
          if (existingIdx >= 0) {
            const prevEntry = merged[existingIdx];
            const preservedLeading =
              ne.leadingTrivia.trim().length > 0
                ? ne.leadingTrivia
                : (prevEntry?.leadingTrivia ?? "");
            merged[existingIdx] = {
              ...ne,
              leadingTrivia: preservedLeading,
              text: `${preservedLeading}${ne.codeText}`,
            };
          } else {
            merged.push(ne);
          }
        }
        const trailingNl = originalSnippet.endsWith("\r\n")
          ? "\r\n"
          : originalSnippet.endsWith("\n")
            ? "\n"
            : "";
        newSnippet = `${merged.map((m) => m.text).join(fileNl)}${trailingAfterLast}${trailingNl}`;
      }
    } else if (!replaceAllImports && originalSnippet.trim().length > 0) {
      const origImportLines = originalSnippet
        .split(/\r?\n/)
        .map((l) => l.trimEnd())
        .filter((l) => l.trim().length > 0);
      const newImportLines = newSnippet
        .split(/\r?\n/)
        .map((l) => l.trimEnd())
        .filter((l) => l.trim().length > 0);
      if (origImportLines.length >= 1 && newImportLines.length >= 1) {
        const mergedLines = [...origImportLines];
        for (const nl of newImportLines) {
          if (!mergedLines.some((ol) => ol.trim() === nl.trim())) {
            mergedLines.push(nl);
          }
        }
        const trailingNl = originalSnippet.endsWith("\r\n")
          ? "\r\n"
          : originalSnippet.endsWith("\n")
            ? "\n"
            : "";
        newSnippet = `${mergedLines.join(fileNl)}${trailingNl}`;
      }
    }
  }

  const trivia = extractDeclarationTriviaLens(
    nativeSource,
    {
      fullStart: spanInfo.fullDeclStart ?? spanInfo.declStart,
      declStart: spanInfo.declStart,
      end: spanInfo.declEnd,
    },
    targetLang,
  );

  let finalReplaceStart = replaceStart;
  let preservedTriviaText = "";

  const trimmedNew = newSnippet.trimStart();
  const hasNewDoc =
    trimmedNew.startsWith("/**") || trimmedNew.startsWith("///") || trimmedNew.startsWith("//!");
  const hasReplaceDocsDirective =
    options.preserveDocs === false ||
    /(?:^|\n)\s*(?:(?:\/\/|#)\s*)?@(?:replace|strip|drop)-docs\b/.test(rawSnippet) ||
    /(?:^|\n)\s*(?:(?:\/\/|#)\s*)?@(?:replace|strip|drop)-docs\b/.test(newSnippet);

  if (targetLang !== "python") {
    if (!hasNewDoc && !hasReplaceDocsDirective) {
      preservedTriviaText = trivia.leadingDocComment ?? "";
    } else if (hasNewDoc || trivia.leadingDocComment || hasReplaceDocsDirective) {
      let docStartPos: number | undefined;
      if (trivia.leadingDocComment) {
        const beforeDecl = nativeSource.slice(0, spanInfo.declStart);
        const oldDocIdx = beforeDecl.lastIndexOf(trivia.leadingDocComment);
        if (oldDocIdx >= 0) {
          const docLineStart = nativeSource.lastIndexOf("\n", oldDocIdx - 1) + 1;
          const leadingWs = nativeSource.slice(docLineStart, oldDocIdx);
          docStartPos = /^[ \t]*$/.test(leadingWs) ? docLineStart : oldDocIdx;
        }
      }
      if (
        docStartPos === undefined &&
        spanInfo.fullDeclStart !== undefined &&
        spanInfo.fullDeclStart < spanInfo.declStart
      ) {
        docStartPos = spanInfo.fullDeclStart;
      }
      if (docStartPos === undefined) {
        const prefixBefore = nativeSource.slice(0, spanInfo.declStart);
        const matchPrevDoc = prefixBefore.match(
          /(?:\/\*\*[\s\S]*?\*\/|(?:[ \t]*(?:\/\/\/|\/\/!)[^\n]*\r?\n)+)[ \t]*$/,
        );
        if (matchPrevDoc && matchPrevDoc.index !== undefined) {
          const docStart = matchPrevDoc.index;
          const docLineStart = nativeSource.lastIndexOf("\n", docStart - 1) + 1;
          const leadingWs = nativeSource.slice(docLineStart, docStart);
          docStartPos = /^[ \t]*$/.test(leadingWs) ? docLineStart : docStart;
        }
      }

      if (docStartPos !== undefined && docStartPos < finalReplaceStart) {
        if (trivia.leadingDocComment) {
          const oldDocIdx = nativeSource.indexOf(trivia.leadingDocComment, docStartPos);
          if (oldDocIdx >= 0) {
            const docEnd = oldDocIdx + trivia.leadingDocComment.length;
            const between = nativeSource.slice(docEnd, spanInfo.declStart);
            const hasDecoratorsBetween = /^[ \t\r\n]*@(?!fn\b|cls\b|type\b|idiom\b)[A-Za-z_]/.test(
              between,
            );
            if (hasDecoratorsBetween && !hasLeadingNativeAttr && !trimmedNew.startsWith("@")) {
              const decoratorsSlice = between.replace(/^\r?\n/, "");
              const newDocMatch = newSnippet.match(
                /^(?:[ \t]*\/\*\*[\s\S]*?\*\/\r?\n|[ \t]*(?:\/\/\/|\/\/!)[^\n]*\r?\n)+/,
              );
              if (newDocMatch) {
                const afterDoc = newSnippet.slice(newDocMatch[0].length);
                newSnippet = `${newDocMatch[0]}${decoratorsSlice}${afterDoc}`;
              } else {
                newSnippet = `${decoratorsSlice}${newSnippet}`;
              }
            }
          }
        }
        finalReplaceStart = docStartPos;
      }

      const applied = applyTriviaLensToReplacement(trivia, newSnippet, {
        preserveDocs: false,
        lang: targetLang,
      });
      newSnippet = applied.mergedSnippet;
      preservedTriviaText = "";
    }
  } else if (trivia.leadingDocComment || hasReplaceDocsDirective) {
    const applied = applyTriviaLensToReplacement(trivia, newSnippet, {
      preserveDocs: hasReplaceDocsDirective ? false : options.preserveDocs,
      lang: targetLang,
    });
    newSnippet = applied.mergedSnippet;
    preservedTriviaText = applied.preservedTriviaText;
  }
  return {
    symbol: anchorSymbol,
    startOffset: finalReplaceStart,
    endOffset: spanInfo.declEnd,
    replacement:
      targetLang === "aipl" &&
      !originalSnippet.includes("\n") &&
      originalSnippet.trimEnd().endsWith(",") &&
      !newSnippet.includes("\n") &&
      !newSnippet.trimEnd().endsWith(",")
        ? `${newSnippet.trimEnd()},`
        : newSnippet,
    originalSnippet,
    newSnippet,
    preservedTriviaText,
  };
}

export function spliceNativeSource(
  nativeSource: string,
  options: SpliceOptions,
  filePath: string,
  idioms?: Record<string, ProjectIdiomDefinition>,
  forceLosslessPreprocess = false,
): SpliceResult {
  const targetLang = detectTargetFromPath(filePath);
  if (
    options.symbol === "@first" ||
    options.symbol === "@1" ||
    options.insertAfter === "@first" ||
    options.insertAfter === "@1" ||
    options.insertBefore === "@first" ||
    options.insertBefore === "@1"
  ) {
    try {
      const decomp = decompile(nativeSource, targetLang, { filePath });
      const firstSym = resolveFirstActionableSymbol(decomp.aice, filePath);
      if (firstSym) {
        options = {
          ...options,
          symbol:
            options.symbol === "@first" || options.symbol === "@1" ? firstSym : options.symbol,
          insertAfter:
            options.insertAfter === "@first" || options.insertAfter === "@1"
              ? firstSym
              : options.insertAfter,
          insertBefore:
            options.insertBefore === "@first" || options.insertBefore === "@1"
              ? firstSym
              : options.insertBefore,
        };
      }
    } catch {
      // fall through
    }
  }
  const isLineRange =
    Boolean(options.symbol?.match(/^\[?L?(\d+)(?:-L?(\d+))?\]?$/i)) ||
    Boolean(options.insertAfter?.match(/^\[?L?(\d+)(?:-L?(\d+))?\]?$/i)) ||
    Boolean(options.insertBefore?.match(/^\[?L?(\d+)(?:-L?(\d+))?\]?$/i)) ||
    Boolean(options.edits?.some((e) => /^\[?L?(\d+)(?:-L?(\d+))?\]?$/i.test(e.symbol)));

  if (
    !isLineRange &&
    (targetLang === "css" ||
      targetLang === "json" ||
      targetLang === "yaml" ||
      targetLang === "html" ||
      targetLang === "twig")
  ) {
    const dialectRes = spliceDialectNativeSource(
      nativeSource,
      options,
      filePath,
      targetLang,
      idioms,
    );
    if (dialectRes) return dialectRes;
  }

  if (options.edits && options.edits.length > 0) {
    const resolvedEdits: ResolvedNativeEdit[] = [];
    for (const edit of options.edits) {
      const editCode =
        edit.code ?? edit.aice ?? edit.template ?? edit.snippet ?? edit.content ?? edit.replacement;
      const singleOpt: SpliceOptions = {
        ...options,
        edits: undefined,
        symbol: edit.symbol,
        code: editCode,
        body: edit.body,
        delete: edit.delete,
        cloneFrom: edit.cloneFrom,
        preserveDocs: edit.preserveDocs ?? options.preserveDocs,
        insertAfter: edit.insertAfter ?? edit.insert_after,
        insertBefore: edit.insertBefore ?? edit.insert_before,
      };
      resolvedEdits.push(
        resolveSingleNativeEditAgainstSource(
          nativeSource,
          singleOpt,
          filePath,
          targetLang,
          idioms,
          forceLosslessPreprocess,
        ),
      );
    }

    // Sort in reverse offset order (bottom-to-top) so earlier edits never shift later offsets;
    // when two zero-width insertions share the exact same offset, apply later stream items first
    // so the final file preserves top-to-bottom stream order.
    const indexedEdits = resolvedEdits.map((edit, idx) => ({ edit, idx }));
    const sortedReverse = indexedEdits
      .sort(
        (a, b) =>
          b.edit.startOffset - a.edit.startOffset ||
          b.edit.endOffset - a.edit.endOffset ||
          b.idx - a.idx,
      )
      .map((entry) => entry.edit);

    const hasOverlap = sortedReverse.some(
      (e, i) => i < sortedReverse.length - 1 && e.startOffset < sortedReverse[i + 1].endOffset,
    );

    let modifiedCode = nativeSource;
    if (hasOverlap) {
      const sequentialResolved: ResolvedNativeEdit[] = [];
      for (const edit of options.edits) {
        const editCode =
          edit.code ??
          edit.aice ??
          edit.template ??
          edit.snippet ??
          edit.content ??
          edit.replacement;
        const singleOpt: SpliceOptions = {
          ...options,
          edits: undefined,
          symbol: edit.symbol,
          code: editCode,
          body: edit.body,
          delete: edit.delete,
          cloneFrom: edit.cloneFrom,
          preserveDocs: edit.preserveDocs ?? options.preserveDocs,
          insertAfter: edit.insertAfter ?? edit.insert_after,
          insertBefore: edit.insertBefore ?? edit.insert_before,
        };
        const stepEdit = resolveSingleNativeEditAgainstSource(
          modifiedCode,
          singleOpt,
          filePath,
          targetLang,
          idioms,
          forceLosslessPreprocess,
        );
        sequentialResolved.push(stepEdit);
        modifiedCode = `${modifiedCode.slice(0, stepEdit.startOffset)}${stepEdit.replacement}${modifiedCode.slice(stepEdit.endOffset)}`;
      }
      resolvedEdits.splice(0, resolvedEdits.length, ...sequentialResolved);
    } else {
      for (const item of sortedReverse) {
        modifiedCode = `${modifiedCode.slice(0, item.startOffset)}${item.replacement}${modifiedCode.slice(item.endOffset)}`;
      }
    }

    if (!forceLosslessPreprocess) {
      const checkRes = validateNativeSyntax(modifiedCode, targetLang, filePath, idioms);
      if (!checkRes.valid) {
        return spliceNativeSource(nativeSource, options, filePath, idioms, true);
      }
    }

    const diff = options.diff
      ? generateUnifiedDiff(filePath, nativeSource, modifiedCode)
      : undefined;
    const editedSymbols = options.edits.map((e) => e.symbol).join(", ");
    const combinedNewSnippets = resolvedEdits.map((e) => e.newSnippet).join("\n\n");
    const snippetTokens = estimateTokens(combinedNewSnippets || JSON.stringify(options.edits));
    const modifiedTokens = estimateTokens(modifiedCode);
    const totalPreservedTriviaTokens = resolvedEdits.reduce(
      (sum, e) => sum + (e.preservedTriviaText ? estimateTokens(e.preservedTriviaText) : 0),
      0,
    );
    const realisticNativePayload = JSON.stringify(
      resolvedEdits.map((e) => ({
        path: filePath,
        old_string: e.originalSnippet ?? "",
        new_string: e.newSnippet ?? "",
      })),
    );
    const realisticTokensSaved = Math.max(
      0,
      estimateTokens(realisticNativePayload) - snippetTokens,
    );

    return {
      success: true,
      filePath,
      symbol: editedSymbols,
      originalSnippet: resolvedEdits.map((e) => e.originalSnippet).join("\n\n"),
      newSnippet: combinedNewSnippets,
      diff,
      modifiedCode,
      newAiceSource: modifiedCode,
      tokensSaved: Math.max(0, modifiedTokens - snippetTokens),
      preservedTriviaTokens: totalPreservedTriviaTokens,
      realisticTokensSaved,
    };
  }

  const anchorSymbol = options.insertAfter ?? options.insertBefore ?? options.symbol;
  const rawSnippet = options.code ?? options.body ?? "";

  // Module-level append without --symbol
  if (options.append && !anchorSymbol) {
    if (!rawSnippet.trim()) {
      throw buildEmptySpliceBlockError(filePath, anchorSymbol, "appending to native file");
    }
    const emitted = emitNativeSnippetForContext(
      rawSnippet,
      filePath,
      targetLang,
      undefined,
      idioms,
      undefined,
      false,
      undefined,
      forceLosslessPreprocess,
    );
    const sep = nativeSource.endsWith("\n") ? "\n" : "\n\n";
    const modifiedCode = `${nativeSource}${sep}${emitted}\n`;
    if (!forceLosslessPreprocess) {
      const checkRes = validateNativeSyntax(modifiedCode, targetLang, filePath, idioms);
      if (!checkRes.valid) {
        return spliceNativeSource(nativeSource, options, filePath, idioms, true);
      }
    }
    const diff = options.diff
      ? generateUnifiedDiff(filePath, nativeSource, modifiedCode)
      : undefined;
    const snippetTokens = estimateTokens(emitted);
    const modifiedTokens = estimateTokens(modifiedCode);
    const realisticNativePayload = JSON.stringify({
      path: filePath,
      old_string: "",
      new_string: emitted,
    });
    const realisticTokensSaved = Math.max(
      0,
      estimateTokens(realisticNativePayload) - snippetTokens,
    );
    return {
      success: true,
      filePath,
      newSnippet: emitted,
      diff,
      modifiedCode,
      newAiceSource: modifiedCode,
      tokensSaved: Math.max(0, modifiedTokens - snippetTokens),
      preservedTriviaTokens: 0,
      realisticTokensSaved,
    };
  }
  const resolved = resolveSingleNativeEditAgainstSource(
    nativeSource,
    options,
    filePath,
    targetLang,
    idioms,
    forceLosslessPreprocess,
  );
  const modifiedCode = `${nativeSource.slice(0, resolved.startOffset)}${resolved.replacement}${nativeSource.slice(resolved.endOffset)}`;

  if (!forceLosslessPreprocess) {
    const checkRes = validateNativeSyntax(modifiedCode, targetLang, filePath, idioms);
    if (!checkRes.valid) {
      return spliceNativeSource(nativeSource, options, filePath, idioms, true);
    }
  }

  let diff: string | undefined;
  if (options.diff) {
    diff = generateUnifiedDiff(filePath, nativeSource, modifiedCode);
  }

  const snippetTokens = estimateTokens(resolved.newSnippet || options.code || options.body || "");
  const modifiedTokens =
    modifiedCode.length > 50_000
      ? Math.ceil(modifiedCode.length / 3.8)
      : estimateTokens(modifiedCode);
  const tokensSaved = Math.max(0, modifiedTokens - snippetTokens);
  const preservedTriviaTokens = resolved.preservedTriviaText
    ? estimateTokens(resolved.preservedTriviaText)
    : 0;
  const realisticNativePayload = options.delete
    ? JSON.stringify({ path: filePath, old_string: resolved.originalSnippet ?? "", new_string: "" })
    : resolved.originalSnippet
      ? JSON.stringify({
          path: filePath,
          old_string: resolved.originalSnippet,
          new_string: resolved.newSnippet ?? rawSnippet,
        })
      : JSON.stringify({ path: filePath, old_string: "", new_string: rawSnippet });
  const realisticTokensSaved = Math.max(0, estimateTokens(realisticNativePayload) - snippetTokens);

  const startLine = modifiedCode.slice(0, resolved.startOffset).split("\n").length;
  const endLine = startLine + Math.max(0, resolved.replacement.split("\n").length - 1);

  return {
    success: true,
    filePath,
    symbol: resolved.symbol,
    startLine,
    endLine,
    originalSnippet: resolved.originalSnippet,
    newSnippet: resolved.newSnippet,
    diff,
    modifiedCode,
    newAiceSource: modifiedCode,
    tokensSaved,
    preservedTriviaTokens,
    realisticTokensSaved,
  };
}
export async function splice(
  rawFilePath: string,
  rawOptions: SpliceOptions = {},
): Promise<SpliceResult> {
  let options = rawOptions;
  const baseDir = options.projectRoot ? path.resolve(options.projectRoot) : process.cwd();
  const trimmedRawPath = rawFilePath.trim();
  if (
    !options.symbol &&
    /:+$/.test(trimmedRawPath) &&
    isSpliceTargetFileCandidate(trimmedRawPath.replace(/\s*:+$/, "").trim())
  ) {
    throw new Error(
      `Malformed target '${trimmedRawPath}': missing <symbol>, L<start>-L<end>, :overwrite, or :eof after ':'`,
    );
  }
  const splitTarget = splitInlineFileSelector(rawFilePath, baseDir);
  const filePath = splitTarget.filePath;
  if (splitTarget.inlineSelector && !options.symbol) {
    options = { ...options, symbol: splitTarget.inlineSelector };
  }

  if (!options.symbol && (!options.edits || options.edits.length === 0) && options.code) {
    const parsedMulti = parseMultiBlockSpliceStream(options.code, filePath);
    if (parsedMulti?.singleFileEdits && parsedMulti.singleFileEdits.length > 0) {
      options = {
        ...options,
        edits: parsedMulti.singleFileEdits,
        code: undefined,
      };
    }
  }
  const fullPath = path.isAbsolute(filePath) ? filePath : path.resolve(baseDir, filePath);

  const root = resolveTargetProjectRoot(fullPath, options.projectRoot);
  const config = loadProjectConfig(root);
  if (!isProjectAiceEnabled(config)) {
    throw new Error(AICE_DISABLED_MESSAGE);
  }

  const diskFileExists = fs.existsSync(fullPath);
  const fileExists = options.sourceOverride !== undefined || diskFileExists;
  const hasBatchEdits = Boolean(options.edits && options.edits.length > 0);
  const hasExplicitPayload =
    options.code !== undefined || options.body !== undefined || hasBatchEdits;

  if (!options.delete && !options.cloneFrom && !hasExplicitPayload) {
    throw new Error(
      "Must provide replacement code (--code, --body, or --stdin), --edits, or --delete.",
    );
  }

  const hasHunkPayload = fileExists && containsHunkMarkers(options.code ?? options.body ?? "");

  const isFullOverwrite =
    fileExists &&
    !hasBatchEdits &&
    !hasHunkPayload &&
    !options.append &&
    !options.insertAfter &&
    !options.insertBefore &&
    !options.delete &&
    (!options.symbol || isCreateOrOverwriteSymbol(options.symbol));

  const isCreateRoute =
    !options.delete &&
    (!fileExists || options.create || isFullOverwrite);

  if (isCreateRoute) {
    const prevSource =
      options.sourceOverride ?? (diskFileExists ? fs.readFileSync(fullPath, "utf-8") : "");
    const codePayload =
      options.code ??
      options.body ??
      (hasBatchEdits
        ? options.edits!
            .filter((e) => !e.delete)
            .map((e) => e.code ?? e.body ?? "")
            .filter(Boolean)
            .join("\n\n")
        : "");
    const explicitOverwriteSym = Boolean(
      options.symbol && /^:?(?:overwrite|create)$/i.test(options.symbol.trim()),
    );
    if (
      fileExists &&
      codePayload === "" &&
      !options.overwrite &&
      !options.force &&
      !options.create &&
      !explicitOverwriteSym
    ) {
      throw new Error(
        `Refusing to overwrite existing file '${filePath}' with empty content without --overwrite or ':overwrite'.`,
      );
    }
    const created = await createFile(fullPath, {
      code: codePayload,
      overwrite: Boolean(fileExists || options.overwrite || options.force || explicitOverwriteSym),
      idioms: options.idioms,
      inlineIdioms: options.inlineIdioms,
      idiom: options.idiom,
      dryRun: options.dryRun,
      projectRoot: root,
      suppressTelemetry: options.suppressTelemetry,
    });
    return {
      success: true,
      filePath: created.filePath,
      symbol: options.symbol ?? "*",
      startLine: 1,
      endLine: created.nativeCode.split(/\r?\n/).length,
      originalSnippet: fileExists ? prevSource : undefined,
      newSnippet: created.nativeCode,
      diff: options.diff
        ? generateUnifiedDiff(filePath, prevSource, created.nativeCode)
        : undefined,
      modifiedCode: created.nativeCode,
      newFileContent: created.nativeCode,
      newAiceSource: created.nativeCode,
      tokensSaved: Math.max(0, created.tokensSaved),
    };
  }

  if (!fileExists) {
    throw new Error(`Source file not found: ${filePath}`);
  }

  const cliOptionIdioms = parseOptionIdioms(options.inlineIdioms ?? options.idiom);
  const activeIdioms =
    options.idioms === false
      ? {}
      : { ...(config.idioms ?? {}), ...cliOptionIdioms };
  const snippetInput =
    options.code ??
    options.body ??
    (hasBatchEdits ? options.edits!.map((e) => e.code ?? e.body ?? "").join("\n") : "");
  const idiomsUsedInSnippet = Boolean(
    activeIdioms &&
      Object.keys(activeIdioms).some((k) => {
        const norm = k.startsWith("$") ? k : `$${k}`;
        return snippetInput.includes(norm);
      }),
  );

  if (!fullPath.endsWith(".aice")) {
    const originalNative =
      options.sourceOverride ?? (await fs.promises.readFile(fullPath, "utf-8"));
    const targetLang = detectTargetFromPath(fullPath);

    const result = withSuppressedTelemetry(() =>
      spliceNativeSource(originalNative, options, fullPath, activeIdioms),
    );
    const isLineRangeOrHunkSplice =
      containsHunkMarkers(snippetInput) ||
      Boolean(
        options.symbol &&
          /^(?::?L?\d+\s*(?:-|\.\.|:)\s*L?\d+|:?hunk)$/i.test(options.symbol.trim()),
      ) ||
      Boolean(
        hasBatchEdits &&
          (options.edits ?? []).every(
            (e) =>
              containsHunkMarkers(e.code ?? e.body ?? "") ||
              /^(?::?L?\d+\s*(?:-|\.\.|:)\s*L?\d+|:?hunk)$/i.test((e.symbol ?? "").trim()),
          ),
      );

    if (targetLang === "typescript" || targetLang === "tsx" || targetLang === "javascript") {
      const maskedSnippet = maskSourceLexically(
        result.newSnippet ?? snippetInput,
        targetLang,
      ).maskedCode;
      const snippetIdents = new Set(
        maskedSnippet.match(/(?<![A-Za-z0-9_$])[A-Za-z_$][A-Za-z0-9_$]*(?![A-Za-z0-9_$])/g) ?? [],
      );
      const candidateIdents = Array.from(snippetIdents).filter((id) =>
        isLineRangeOrHunkSplice
          ? /^[A-Z][A-Za-z0-9]*$/.test(id)
          : /^[A-Z$]/.test(id) || id.includes("_"),
      );
      if (candidateIdents.length > 0) {
        const maskedOriginal = maskSourceLexically(originalNative, targetLang).maskedCode;
        const modSf = getCachedTsSourceFile(result.modifiedCode);
        const existingLocalOrImported = new Set<string>();
        const recordBindingNames = (nameNode: ts.BindingName): void => {
          if (ts.isIdentifier(nameNode)) {
            existingLocalOrImported.add(nameNode.text);
          } else {
            for (const elem of nameNode.elements) {
              if (ts.isBindingElement(elem)) {
                recordBindingNames(elem.name);
              }
            }
          }
        };
        for (const st of modSf.statements) {
          if (ts.isImportDeclaration(st) && st.importClause) {
            if (st.importClause.name) {
              existingLocalOrImported.add(st.importClause.name.text);
            }
            const nb = st.importClause.namedBindings;
            if (nb) {
              if (ts.isNamespaceImport(nb)) {
                existingLocalOrImported.add(nb.name.text);
              } else if (ts.isNamedImports(nb)) {
                for (const el of nb.elements) {
                  existingLocalOrImported.add(el.name.text);
                }
              }
            }
          } else if (
            (ts.isFunctionDeclaration(st) ||
              ts.isClassDeclaration(st) ||
              ts.isInterfaceDeclaration(st) ||
              ts.isTypeAliasDeclaration(st) ||
              ts.isEnumDeclaration(st)) &&
            st.name
          ) {
            existingLocalOrImported.add(st.name.text);
          } else if (ts.isVariableStatement(st)) {
            for (const decl of st.declarationList.declarations) {
              recordBindingNames(decl.name);
            }
          }
        }

        const missingIdents = candidateIdents.filter(
          (id) =>
            !existingLocalOrImported.has(id) &&
            !new RegExp(
              `(?<![A-Za-z0-9_$])${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9_$])`,
            ).test(maskedOriginal),
        );
        if (missingIdents.length > 0) {
          const importRe = /^(import\s*\{([^}]+)\}\s*from\s*['"](\.[^'"]+)['"]\s*;?)/gm;
          const siblingImports: Array<{
            fullImp: string;
            specList: string[];
            maskedSibContent: string;
          }> = [];
          let match: RegExpExecArray | null = importRe.exec(result.modifiedCode);
          while (match !== null) {
            const fullImp = match[1];
            const specList = match[2]
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);
            const relMod = match[3];
            const baseModPath = path.resolve(path.dirname(fullPath), relMod);
            const candidates = [
              baseModPath,
              `${baseModPath}.ts`,
              `${baseModPath}.tsx`,
              `${baseModPath}.js`,
              `${baseModPath.replace(/\.[cm]?js$/, "")}.ts`,
              `${baseModPath.replace(/\.[cm]?js$/, "")}.tsx`,
            ];
            const resolvedSibling = candidates.find(
              (c) => fs.existsSync(c) && fs.statSync(c).isFile(),
            );
            if (resolvedSibling) {
              try {
                const sibContent = fs.readFileSync(resolvedSibling, "utf-8");
                const maskedSibContent = maskSourceLexically(sibContent, targetLang).maskedCode;
                siblingImports.push({ fullImp, specList, maskedSibContent });
              } catch {
                // ignore unreadable sibling
              }
            }
            match = importRe.exec(result.modifiedCode);
          }

          if (siblingImports.length > 0) {
            const exportOwners = new Map<string, number[]>();
            for (const id of missingIdents) {
              const escId = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
              const exportRe = new RegExp(
                `\\bexport\\s+(?:type|interface|const|let|var|class|enum|function)\\s+${escId}(?![A-Za-z0-9_$])`,
              );
              const owners: number[] = [];
              for (let sIdx = 0; sIdx < siblingImports.length; sIdx++) {
                if (exportRe.test(siblingImports[sIdx].maskedSibContent)) {
                  owners.push(sIdx);
                }
              }
              exportOwners.set(id, owners);
            }

            let updatedCode = result.modifiedCode;
            for (let sIdx = 0; sIdx < siblingImports.length; sIdx++) {
              const { fullImp, specList } = siblingImports[sIdx];
              const addedSpecs: string[] = [];
              for (const id of missingIdents) {
                if (specList.some((s) => s.replace(/^type\s+/, "").trim() === id)) continue;
                const owners = exportOwners.get(id) ?? [];
                if (owners.length === 1 && owners[0] === sIdx) {
                  addedSpecs.push(id);
                }
              }
              if (addedSpecs.length > 0) {
                const mergedSpecText = `{ ${[...specList, ...addedSpecs].join(", ")} }`;
                const newImp = fullImp.replace(/\{[^}]+\}/, () => mergedSpecText);
                updatedCode = updatedCode.replace(fullImp, () => newImp);
              }
            }
            result.modifiedCode = updatedCode;
            result.newAiceSource = updatedCode;
          }
        }
      }
    }

    const postValidation = validateNativeSyntax(
      result.modifiedCode,
      targetLang,
      fullPath,
      activeIdioms,
    );
    const pyDupDiag =
      targetLang === "python" ? checkPythonDuplicateParams(result.modifiedCode) : null;
    if (!postValidation.valid || pyDupDiag) {
      const origValidation = validateNativeSyntax(originalNative, targetLang, fullPath);
      const origPyDup =
        targetLang === "python" ? checkPythonDuplicateParams(originalNative) : null;
      if (origValidation.valid && !origPyDup && !options.force) {
        const diagSummary = [
          ...postValidation.diagnostics,
          ...(pyDupDiag ? [pyDupDiag] : []),
        ].join("; ");
        throw new Error(
          `Pre-write syntax validation failed for ${filePath} (${targetLang}): ${diagSummary}`,
        );
      }
    }

    if (!options.dryRun) {
      const dir = path.dirname(fullPath);
      await fs.promises.mkdir(dir, { recursive: true });
      const origMode = fs.existsSync(fullPath)
        ? (await fs.promises.stat(fullPath)).mode
        : undefined;
      const tmpFile = path.join(
        dir,
        `.${path.basename(fullPath)}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
      );
      try {
        await fs.promises.writeFile(
          tmpFile,
          result.modifiedCode,
          origMode !== undefined ? { encoding: "utf-8", mode: origMode } : "utf-8",
        );
        await fs.promises.rename(tmpFile, fullPath);
      } catch (err) {
        try {
          if (fs.existsSync(tmpFile)) {
            fs.unlinkSync(tmpFile);
          }
        } catch {
          // ignore cleanup error
        }
        throw err;
      }
    }

    if (!options.suppressTelemetry && !options.dryRun) {
      const responseMsg = `✔ Spliced symbol '${result.symbol ?? options.symbol ?? ""}' in ${filePath} (${result.tokensSaved ?? 0} tokens saved)`;
      const realisticNativePayload = options.delete
        ? JSON.stringify({
            path: fullPath,
            old_string: result.originalSnippet ?? "",
            new_string: "",
          })
        : result.originalSnippet
          ? JSON.stringify({
              path: fullPath,
              old_string: result.originalSnippet,
              new_string: result.newSnippet ?? snippetInput,
            })
          : JSON.stringify({ path: fullPath, old_string: "", new_string: snippetInput });
      recordTelemetryEvent({
        targetPath: fullPath,
        projectRoot: root,
        operation: "splice",
        surface: "cli",
        idiomsUsed: idiomsUsedInSnippet,
        nativeText: result.modifiedCode,
        realisticNativeText: realisticNativePayload,
        preservedTriviaTokens: result.preservedTriviaTokens ?? 0,
        aiceText: snippetInput ? `${snippetInput}\n${responseMsg}` : responseMsg,
      });
    }
    return result;
  }

  const originalSource = options.sourceOverride ?? (await fs.promises.readFile(fullPath, "utf-8"));
  const result = withSuppressedTelemetry(() => spliceSource(originalSource, options, fullPath));

  // Write atomically to disk unless dryRun
  if (!options.dryRun) {
    const dir = path.dirname(fullPath);
    await fs.promises.mkdir(dir, { recursive: true });
    const origMode = fs.existsSync(fullPath)
      ? (await fs.promises.stat(fullPath)).mode
      : undefined;
    const tmpFile = path.join(
      dir,
      `.${path.basename(fullPath)}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
    );
    try {
      await fs.promises.writeFile(
        tmpFile,
        result.modifiedCode,
        origMode !== undefined ? { encoding: "utf-8", mode: origMode } : "utf-8",
      );
      await fs.promises.rename(tmpFile, fullPath);
    } catch (err) {
      try {
        if (fs.existsSync(tmpFile)) {
          fs.unlinkSync(tmpFile);
        }
      } catch {
        // ignore cleanup error
      }
      throw err;
    }
  }

  if (options.compile) {
    const { ast: mod, trivia } = parseWithTrivia(result.modifiedCode, fullPath);
    const shouldExpand = isProjectIdiomsEnabled(config, options.idioms);
    const expandedMod =
      shouldExpand && config?.idioms ? expandModuleIdioms(mod, config.idioms) : mod;
    const checker = new TypeChecker();
    checker.checkModule(expandedMod);

    let targetLang: TargetLanguage;
    const base = path.basename(fullPath);
    const withoutAice = base.endsWith(".aice") ? base.slice(0, -5) : base;
    const innerExt = path.extname(withoutAice).toLowerCase();
    if (innerExt && KNOWN_TARGET_EXTENSIONS.has(innerExt)) {
      targetLang = detectTargetFromPath(fullPath);
    } else {
      targetLang = config.targetLanguage ?? detectTargetFromPath(fullPath);
    }

    const emitted = emitTarget(expandedMod, targetLang, {
      trivia,
      watermark: config.watermark,
      idioms: shouldExpand ? config.idioms : undefined,
    });

    if (!options.dryRun) {
      const outPath = fullPath.replace(/\.aice$/, innerExt ? "" : ".ts");
      const outDir = path.dirname(outPath);
      await fs.promises.mkdir(outDir, { recursive: true });
      const outMode = fs.existsSync(outPath) ? (await fs.promises.stat(outPath)).mode : undefined;
      const outTmp = path.join(
        outDir,
        `.${path.basename(outPath)}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
      );
      try {
        await fs.promises.writeFile(outTmp, emitted, {
          encoding: "utf-8",
          ...(outMode !== undefined ? { mode: outMode } : {}),
        });
        await fs.promises.rename(outTmp, outPath);
      } catch (err) {
        try {
          if (fs.existsSync(outTmp)) {
            fs.unlinkSync(outTmp);
          }
        } catch {
          // ignore cleanup error
        }
        throw err;
      }
    }
  }

  if (!options.suppressTelemetry && !options.dryRun) {
    const responseMsg = `✔ Spliced symbol '${result.symbol ?? options.symbol ?? ""}' in ${filePath} (${result.tokensSaved ?? 0} tokens saved)`;
    const realisticNativePayload = options.delete
      ? JSON.stringify({
          path: fullPath,
          old_string: result.originalSnippet ?? "",
          new_string: "",
        })
      : result.originalSnippet
        ? JSON.stringify({
            path: fullPath,
            old_string: result.originalSnippet,
            new_string: result.newSnippet ?? snippetInput,
          })
        : JSON.stringify({ path: fullPath, old_string: "", new_string: snippetInput });
    recordTelemetryEvent({
      targetPath: fullPath,
      projectRoot: root,
      operation: "splice",
      surface: "cli",
      idiomsUsed: idiomsUsedInSnippet,
      nativeText: result.modifiedCode,
      realisticNativeText: realisticNativePayload,
      preservedTriviaTokens: result.preservedTriviaTokens ?? 0,
      aiceText: snippetInput ? `${snippetInput}\n${responseMsg}` : responseMsg,
    });
  }

  return result;
}

export interface ParsedMultiBlockSpliceStream {
  singleFileEdits?: SymbolSpliceEdit[];
  batchItems?: BatchSpliceItem[];
}

export function isCreateOrOverwriteSymbol(sym: string | undefined): boolean {
  if (!sym) return true;
  const norm = sym.trim().toLowerCase();
  return (
    norm === "" ||
    norm === "*" ||
    norm === "create" ||
    norm === ":create" ||
    norm === "overwrite" ||
    norm === ":overwrite"
  );
}

const SPLICE_PASSTHROUGH_FILENAMES = new Set([
  "Cargo.toml",
  "Cargo.lock",
  "go.mod",
  "go.sum",
  "CMakeLists.txt",
  "Makefile",
  "Dockerfile",
  ".gitignore",
  ".dockerignore",
  ".editorconfig",
  ".env",
]);

const SPLICE_PASSTHROUGH_EXTENSIONS = new Set([
  ".toml",
  ".mod",
  ".sum",
  ".csproj",
  ".sln",
  ".props",
  ".targets",
  ".xml",
  ".gradle",
  ".properties",
  ".cmake",
  ".mk",
  ".ini",
  ".cfg",
  ".conf",
  ".env",
  ".sql",
  ".txt",
  ".lock",
]);

function isSpliceTargetFileCandidate(cand: string): boolean {
  const clean = cand
    .trim()
    .replace(/^['"`]|['"`]$/g, "")
    .replace(/\\/g, "/");
  if (!clean || /\s/.test(clean)) return false;
  const base = path.posix.basename(clean);
  if (SPLICE_PASSTHROUGH_FILENAMES.has(base)) return true;
  const ext = path.posix.extname(clean).toLowerCase();
  if (!ext) return false;
  return (
    KNOWN_TARGET_EXTENSIONS.has(ext) || SPLICE_PASSTHROUGH_EXTENSIONS.has(ext) || ext === ".aice"
  );
}

function isBareSpliceStreamFileHeader(spec: string, defaultFilePath?: string): boolean {
  if (!isSpliceTargetFileCandidate(spec)) return false;
  if (!defaultFilePath) return true;
  if (spec.includes("/") || spec.includes("\\")) return true;
  const normSpec = spec.replace(/\\/g, "/");
  const normDefault = defaultFilePath.replace(/\\/g, "/");
  if (
    path.resolve(spec) === path.resolve(defaultFilePath) ||
    path.posix.basename(normSpec) === path.posix.basename(normDefault)
  ) {
    return true;
  }
  return !/^[A-Z][A-Za-z0-9_]*\.[a-zA-Z0-9_]+$/i.test(spec);
}

export function splitInlineFileSelector(
  rawFilePath: string,
  baseDir = process.cwd(),
): { filePath: string; inlineSelector?: string } {
  const trimmed = rawFilePath.trim();
  if (!trimmed) return { filePath: rawFilePath };
  const fullRaw = path.isAbsolute(trimmed) ? trimmed : path.resolve(baseDir, trimmed);
  if (fs.existsSync(fullRaw)) {
    return { filePath: trimmed };
  }
  const driveOffset = /^[A-Za-z]:[\\/]/.test(trimmed) ? 2 : 0;
  const restAfterDrive = trimmed.slice(driveOffset);
  const sepRe = /:+|#/g;
  let sepMatch: RegExpExecArray | null = sepRe.exec(restAfterDrive);
  while (sepMatch !== null) {
    const splitIdx = driveOffset + sepMatch.index;
    const candFile = trimmed.slice(0, splitIdx).trim();
    const candSym = trimmed.slice(splitIdx + sepMatch[0].length).trim();
    if (
      candFile &&
      candSym &&
      !candSym.startsWith("/") &&
      !candSym.startsWith("\\") &&
      isSpliceTargetFileCandidate(candFile)
    ) {
      return { filePath: candFile, inlineSelector: candSym };
    }
    sepMatch = sepRe.exec(restAfterDrive);
  }
  return { filePath: trimmed };
}

/**
 * Parses a multi-block splice heredoc/stream delimited by `=== <symbol> ===`,
 * `=== <filePath> ===`, `=== <filePath>:<symbol> ===`, `--- <symbol> ---`, or `// SYMBOL: <symbol>`.
 */
export function parseMultiBlockSpliceStream(
  rawStream: string,
  defaultFilePath?: string,
): ParsedMultiBlockSpliceStream | null {
  if (!rawStream || !rawStream.trim()) return null;
  const lines = rawStream.split(/\r?\n/);
  const headerRe = /^\s*={3,}\s*([^=\r\n]+?)\s*={3,}\s*$/;
  const hasUnindentedHeader = lines.some((l) => !/^\s/.test(l) && headerRe.test(l));

  const preHeaderLines: string[] = [];
  const sections: Array<{
    filePath?: string;
    symbol: string;
    cloneFrom?: string;
    preserveDocs?: boolean;
    isDelete: boolean;
    lines: string[];
  }> = [];

  let inMdFence = false;
  let mdFenceChar = "";
  let mdFenceLen = 0;
  let inHunkBlock = false;

  for (const line of lines) {
    const activeFp =
      sections.length > 0
        ? (sections[sections.length - 1].filePath ?? defaultFilePath)
        : defaultFilePath;
    const isMdSection = Boolean(activeFp && /\.(?:md|markdown)$/i.test(activeFp));
    if (isMdSection && sections.length > 0) {
      if (!inMdFence) {
        const openMatch = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
        if (openMatch && !(openMatch[1][0] === "`" && openMatch[2].includes("`"))) {
          inMdFence = true;
          mdFenceChar = openMatch[1][0];
          mdFenceLen = openMatch[1].length;
          sections[sections.length - 1].lines.push(line);
          continue;
        }
      } else {
        const closeMatch = line.match(/^\s*(`{3,}|~{3,})\s*$/);
        if (closeMatch && closeMatch[1][0] === mdFenceChar && closeMatch[1].length >= mdFenceLen) {
          inMdFence = false;
          mdFenceChar = "";
          mdFenceLen = 0;
        }
        sections[sections.length - 1].lines.push(line);
        continue;
      }
    }

    if (sections.length > 0 && !inMdFence) {
      if (!inHunkBlock && /^\s*<{3,}\s*$/.test(line)) {
        inHunkBlock = true;
        sections[sections.length - 1].lines.push(line);
        continue;
      }
      if (inHunkBlock) {
        if (/^\s*>{3,}\s*$/.test(line)) {
          inHunkBlock = false;
        }
        sections[sections.length - 1].lines.push(line);
        continue;
      }
    }

    const m = hasUnindentedHeader && /^\s/.test(line) ? null : line.match(headerRe);
    if (m) {
      let spec = (m[1] || "").trim().replace(/^['"`]|['"`]$/g, "");
      if (/:+$/.test(spec)) {
        const emptySymFile = spec.replace(/\s*:+$/, "").trim();
        if (emptySymFile && isSpliceTargetFileCandidate(emptySymFile)) {
          throw buildEmptySpliceBlockError(
            emptySymFile,
            undefined,
            `parsing malformed stream header '=== ${spec} ===' (missing <symbol>, L<start>-L<end>, or :eof after colon)`,
          );
        }
      }
      let isDelete = false;
      if (/\s+(?:--delete|-d|\(delete\))\s*$/i.test(spec)) {
        isDelete = true;
        spec = spec.replace(/\s+(?:--delete|-d|\(delete\))\s*$/i, "").trim();
      }
      let preserveDocs: boolean | undefined;
      if (/(?:\s+|^)@(?:replace|strip|drop)-docs\b/i.test(spec)) {
        preserveDocs = false;
        spec = spec.replace(/(?:\s+|^)@(?:replace|strip|drop)-docs\b/gi, "").trim();
      }
      let cloneFrom: string | undefined;
      const cloneMatch = spec.match(
        /\s*(?:@clone|\(clone)\s*\(\s*([^()]+)\s*\)|\s*\(clone\s+([^()]+)\)|\s+@clone\s+([^\s()]+)/i,
      );
      if (cloneMatch) {
        cloneFrom = (cloneMatch[1] || cloneMatch[2] || cloneMatch[3]).trim();
        spec = spec.replace(cloneMatch[0], "").trim();
      }
      let blockFilePath: string | undefined;
      let blockSymbol = spec;
      const driveOffset = /^[A-Za-z]:[\\/]/.test(spec) ? 2 : 0;
      const restAfterDrive = spec.slice(driveOffset);
      const sepRe = /\s*(?::+|#)\s*|\s+/g;
      let sepMatch: RegExpExecArray | null = sepRe.exec(restAfterDrive);
      while (sepMatch !== null) {
        const splitIdx = driveOffset + sepMatch.index;
        const candFile = spec.slice(0, splitIdx).trim();
        const candSym = spec.slice(splitIdx + sepMatch[0].length).trim();
        if (candFile && candSym && isSpliceTargetFileCandidate(candFile)) {
          blockFilePath = candFile;
          blockSymbol = candSym;
          break;
        }
        sepMatch = sepRe.exec(restAfterDrive);
      }
      if (!blockFilePath && !isDelete && isBareSpliceStreamFileHeader(spec, defaultFilePath)) {
        blockFilePath = spec;
        blockSymbol = ":create";
      }
      const isValidSymbol =
        Boolean(blockSymbol) &&
        (Boolean(blockFilePath) ||
          !/\s/.test(blockSymbol) ||
          /^[.#@]/.test(blockSymbol) ||
          (Boolean(defaultFilePath) && !/[{};=]/.test(blockSymbol)));
      if (isValidSymbol) {
        inMdFence = false;
        mdFenceChar = "";
        mdFenceLen = 0;
        inHunkBlock = false;
        sections.push({
          filePath: blockFilePath,
          symbol: blockSymbol,
          cloneFrom,
          preserveDocs,
          isDelete,
          lines: [],
        });
        continue;
      }
    }
    if (sections.length === 0) {
      preHeaderLines.push(line);
    } else {
      sections[sections.length - 1].lines.push(line);
    }
  }

  if (sections.length === 0) return null;

  const meaningfulPre = preHeaderLines.filter(
    (l) => l.trim().length > 0 && !/^\s*(?:\/\/|#)/.test(l),
  );
  const preIdiomPrefix = meaningfulPre.every((l) => /^\s*@idiom\b/.test(l) || /^\s+/.test(l))
    ? preHeaderLines.join("\n").trim()
    : null;
  if (preIdiomPrefix === null && meaningfulPre.length > 0) {
    return null;
  }

  let lastExplicitFilePath: string | undefined;
  const resolvedBlocks = sections.map((sec) => {
    const rawBody = sec.lines
      .join("\n")
      .replace(/^\n+|\n+$/g, "")
      .replace(/\nEOF\s*(?:&&|;|\|\|)[^\n]*$/i, "");
    const del = sec.isDelete || /^(?:--delete|DELETE)$/i.test(rawBody.trim());
    if (sec.filePath) {
      lastExplicitFilePath = sec.filePath;
    }
    const targetFp = sec.filePath ?? defaultFilePath ?? lastExplicitFilePath;
    const ext = targetFp ? path.extname(targetFp).toLowerCase() : "";
    const base = targetFp ? path.basename(targetFp) : "";
    const canHaveIdioms =
      ext !== ".json" &&
      ext !== ".yaml" &&
      ext !== ".yml" &&
      ext !== ".md" &&
      ext !== ".markdown" &&
      !SPLICE_PASSTHROUGH_EXTENSIONS.has(ext) &&
      !SPLICE_PASSTHROUGH_FILENAMES.has(base);
    const effectiveSymbol =
      sec.symbol === ":create" && containsHunkMarkers(rawBody) ? ":hunk" : sec.symbol;
    if (!del && !sec.cloneFrom && !isCreateOrOverwriteSymbol(effectiveSymbol) && !rawBody.trim()) {
      throw buildEmptySpliceBlockError(
        targetFp ?? "<file>",
        effectiveSymbol,
        "parsing --stdin heredoc block",
      );
    }
    const body =
      !del && preIdiomPrefix && canHaveIdioms && !containsHunkMarkers(rawBody)
        ? `${preIdiomPrefix}\n${rawBody}`
        : rawBody;
    return {
      filePath: targetFp,
      explicitFilePath: sec.filePath ?? lastExplicitFilePath,
      symbol: effectiveSymbol,
      cloneFrom: sec.cloneFrom,
      preserveDocs: sec.preserveDocs,
      code: del ? undefined : body,
      delete: del || undefined,
    };
  });

  if (resolvedBlocks.some((b) => !b.filePath)) {
    if (defaultFilePath === "") {
      return {
        singleFileEdits: resolvedBlocks.map((b) => ({
          symbol: b.symbol,
          cloneFrom: b.cloneFrom,
          preserveDocs: b.preserveDocs,
          code: b.code,
          delete: b.delete,
        })),
      };
    }
    return null;
  }

  const hasCreateOrOverwriteBlock = resolvedBlocks.some((b) => isCreateOrOverwriteSymbol(b.symbol));

  const allSameDefault =
    !hasCreateOrOverwriteBlock &&
    Boolean(defaultFilePath) &&
    resolvedBlocks.every(
      (b) =>
        !b.explicitFilePath || path.resolve(b.explicitFilePath) === path.resolve(defaultFilePath!),
    );

  if (allSameDefault) {
    return {
      singleFileEdits: resolvedBlocks.map((b) => ({
        symbol: b.symbol,
        cloneFrom: b.cloneFrom,
        preserveDocs: b.preserveDocs,
        code: b.code,
        delete: b.delete,
      })),
    };
  }

  const batchItems: BatchSpliceItem[] = [];
  if (!hasCreateOrOverwriteBlock) {
    const groupedByFile = new Map<string, SymbolSpliceEdit[]>();
    for (const b of resolvedBlocks) {
      const fp = b.filePath!;
      const list = groupedByFile.get(fp) ?? [];
      list.push({
        symbol: b.symbol,
        cloneFrom: b.cloneFrom,
        preserveDocs: b.preserveDocs,
        code: b.code,
        delete: b.delete,
      });
      groupedByFile.set(fp, list);
    }

    for (const [fp, edits] of groupedByFile.entries()) {
      if (edits.length === 1) {
        batchItems.push({
          filePath: fp,
          symbol: edits[0].symbol,
          cloneFrom: edits[0].cloneFrom,
          preserveDocs: edits[0].preserveDocs,
          code: edits[0].code,
          delete: edits[0].delete,
        });
      } else {
        batchItems.push({
          filePath: fp,
          edits,
        });
      }
    }
  } else {
    let idx = 0;
    while (idx < resolvedBlocks.length) {
      const b = resolvedBlocks[idx]!;
      const fp = b.filePath!;
      if (isCreateOrOverwriteSymbol(b.symbol)) {
        batchItems.push({
          filePath: fp,
          symbol: b.symbol,
          code: b.code,
          create: true,
        });
        idx++;
        continue;
      }
      const edits: SymbolSpliceEdit[] = [];
      while (
        idx < resolvedBlocks.length &&
        resolvedBlocks[idx]!.filePath === fp &&
        !isCreateOrOverwriteSymbol(resolvedBlocks[idx]!.symbol)
      ) {
        const cur = resolvedBlocks[idx]!;
        edits.push({
          symbol: cur.symbol,
          cloneFrom: cur.cloneFrom,
          preserveDocs: cur.preserveDocs,
          code: cur.code,
          delete: cur.delete,
        });
        idx++;
      }
      if (edits.length === 1) {
        batchItems.push({
          filePath: fp,
          symbol: edits[0].symbol,
          cloneFrom: edits[0].cloneFrom,
          preserveDocs: edits[0].preserveDocs,
          code: edits[0].code,
          delete: edits[0].delete,
        });
      } else {
        batchItems.push({
          filePath: fp,
          edits,
        });
      }
    }
  }

  return { batchItems };
}

/**
 * Executes a batch of splices and/or file creations across one or more files atomically.
 * If any item in the batch fails, all created and modified files are rolled back to their exact original state.
 */
export async function spliceBatch(
  itemsOrStream: BatchSpliceItem[] | string,
  optionsOrProjectRoot: BatchSpliceOptions | string = {},
): Promise<BatchSpliceResult> {
  const options: BatchSpliceOptions =
    typeof optionsOrProjectRoot === "string"
      ? { projectRoot: optionsOrProjectRoot }
      : optionsOrProjectRoot;
  const items: BatchSpliceItem[] =
    typeof itemsOrStream === "string"
      ? (parseMultiBlockSpliceStream(itemsOrStream)?.batchItems ?? [])
      : itemsOrStream;
  const baseDir = options.projectRoot ? path.resolve(options.projectRoot) : process.cwd();
  const backups = new Map<string, string>();
  const virtualFs = new Map<string, string>();
  const configSnapshots = new Map<string, string | null>();

  if (options.projectRoot) {
    const explicitRoot = path.resolve(options.projectRoot);
    for (const cfgFile of [
      path.join(explicitRoot, "aice.config.json"),
      path.join(explicitRoot, ".aice-idioms.json"),
      path.join(explicitRoot, ".aice-cache", "idioms.json"),
    ]) {
      configSnapshots.set(
        cfgFile,
        fs.existsSync(cfgFile) ? fs.readFileSync(cfgFile, "utf-8") : null,
      );
    }
  }

  for (const item of items) {
    const rawFp = item.filePath || item.file || item.path || "";
    const splitFp = splitInlineFileSelector(rawFp, baseDir).filePath;
    const fullPath = path.isAbsolute(splitFp) ? splitFp : path.resolve(baseDir, splitFp);
    if (fs.existsSync(fullPath) && !backups.has(fullPath)) {
      backups.set(fullPath, fs.readFileSync(fullPath, "utf-8"));
    }
  }

  const results: SpliceResult[] = [];
  const modifiedSet = new Set<string>();
  const newlyCreatedFiles: string[] = [];
  const pendingTelemetry: Array<Parameters<typeof recordTelemetryEvent>[0]> = [];

  try {
    for (const item of items) {
      const rawFp = item.filePath || item.file || item.path || "";
      const splitTarget = splitInlineFileSelector(rawFp, baseDir);
      const effectiveSymbol = item.symbol ?? splitTarget.inlineSelector;
      const fullPath = path.isAbsolute(splitTarget.filePath)
        ? splitTarget.filePath
        : path.resolve(baseDir, splitTarget.filePath);
      const itemDryRun = Boolean(item.dryRun ?? options.dryRun);
      const itemProjectRoot = item.projectRoot ?? options.projectRoot;
      const rootForItem = resolveTargetProjectRoot(fullPath, itemProjectRoot);
      for (const cfgFile of [
        path.join(rootForItem, "aice.config.json"),
        path.join(rootForItem, ".aice-idioms.json"),
        path.join(rootForItem, ".aice-cache", "idioms.json"),
      ]) {
        if (!configSnapshots.has(cfgFile)) {
          configSnapshots.set(
            cfgFile,
            fs.existsSync(cfgFile) ? fs.readFileSync(cfgFile, "utf-8") : null,
          );
        }
      }

      const existedBeforeBatch = backups.has(fullPath);
      const fileExistsNow = virtualFs.has(fullPath) || fs.existsSync(fullPath);
      const resolvedCode =
        item.code ?? item.aice ?? item.template ?? item.snippet ?? item.content ?? item.replacement;
      const hasItemPayload =
        resolvedCode !== undefined ||
        item.body !== undefined ||
        Boolean(item.edits && item.edits.length > 0);

      if (!item.delete && !item.cloneFrom && !hasItemPayload) {
        throw new Error(
          `Must provide replacement code, edits, or delete for batch target '${rawFp}'.`,
        );
      }

      const isCreateRoute =
        !item.delete &&
        !(fileExistsNow && containsHunkMarkers(resolvedCode ?? "")) &&
        (!fileExistsNow ||
          (!item.append &&
            !item.insertAfter &&
            !item.insert_after &&
            !item.insertBefore &&
            !item.insert_before &&
            (!item.edits || item.edits.length === 0) &&
            isCreateOrOverwriteSymbol(effectiveSymbol)));

      if (isCreateRoute) {
        const createPayload =
          resolvedCode ??
          item.body ??
          (item.edits
            ? item.edits
                .filter((e) => !e.delete)
                .map((e) => e.code ?? e.body ?? "")
                .filter(Boolean)
                .join("\n\n")
            : "");
        const explicitOverwriteSym = Boolean(
          effectiveSymbol && /^:?(?:overwrite|create)$/i.test(effectiveSymbol.trim()),
        );
        if (
          fileExistsNow &&
          createPayload === "" &&
          !item.overwrite &&
          !options.overwrite &&
          !item.force &&
          !options.force &&
          !item.create &&
          !explicitOverwriteSym
        ) {
          throw new Error(
            `Refusing to overwrite existing file '${splitTarget.filePath}' with empty content without --overwrite or ':overwrite'.`,
          );
        }
        const createRes = await createFile(fullPath, {
          code: createPayload,
          overwrite: Boolean(
            fileExistsNow ||
              item.overwrite ||
              options.overwrite ||
              item.force ||
              options.force ||
              explicitOverwriteSym,
          ),
          dryRun: itemDryRun,
          idioms: item.idioms ?? options.idioms,
          inlineIdioms: item.inlineIdioms ?? options.inlineIdioms,
          idiom: item.idiom ?? options.idiom,
          projectRoot: rootForItem,
          suppressTelemetry: true,
        });
        if (itemDryRun) {
          virtualFs.set(fullPath, createRes.nativeCode);
        } else {
          if (!existedBeforeBatch && !newlyCreatedFiles.includes(fullPath)) {
            newlyCreatedFiles.push(fullPath);
          }
          pendingTelemetry.push({
            targetPath: fullPath,
            projectRoot: rootForItem,
            operation: "create",
            surface: "cli",
            idiomsUsed: createRes.idiomsUsed,
            nativeText: createRes.nativeCode,
            realisticNativeText: JSON.stringify({
              path: fullPath,
              content: createRes.nativeCode,
            }),
            aiceText: createPayload,
          });
        }
        results.push({
          success: true,
          filePath: createRes.filePath,
          symbol: effectiveSymbol || ":create",
          modifiedCode: createRes.nativeCode,
          newFileContent: createRes.nativeCode,
          newAiceSource: createRes.aiceInput,
          tokensSaved: createRes.tokensSaved,
        });
        modifiedSet.add(createRes.filePath);
        continue;
      }

      const res = await splice(fullPath, {
        ...item,
        symbol: effectiveSymbol,
        code: resolvedCode,
        insertAfter: item.insertAfter ?? item.insert_after,
        insertBefore: item.insertBefore ?? item.insert_before,
        projectRoot: rootForItem,
        dryRun: itemDryRun,
        compile: item.compile ?? options.compile,
        idioms: item.idioms ?? options.idioms,
        inlineIdioms: item.inlineIdioms ?? options.inlineIdioms,
        idiom: item.idiom ?? options.idiom,
        overwrite: item.overwrite ?? options.overwrite,
        force: item.force ?? options.force,
        preserveDocs: item.preserveDocs ?? options.preserveDocs,
        sourceOverride: itemDryRun ? virtualFs.get(fullPath) : undefined,
        suppressTelemetry: true,
      });
      if (itemDryRun) {
        virtualFs.set(fullPath, res.modifiedCode);
      } else {
        if (!existedBeforeBatch && !newlyCreatedFiles.includes(fullPath)) {
          newlyCreatedFiles.push(fullPath);
        }
        const snippetInput =
          resolvedCode ??
          item.body ??
          (item.edits ? item.edits.map((e) => e.code ?? e.body ?? "").join("\n") : "");
        const responseMsg = `✔ Spliced symbol '${res.symbol ?? item.symbol ?? ""}' in ${rawFp} (${res.tokensSaved ?? 0} tokens saved)`;
        const realisticNativePayload = item.delete
          ? JSON.stringify({
              path: fullPath,
              old_string: res.originalSnippet ?? "",
              new_string: "",
            })
          : res.originalSnippet
            ? JSON.stringify({
                path: fullPath,
                old_string: res.originalSnippet,
                new_string: res.newSnippet ?? snippetInput,
              })
            : JSON.stringify({ path: fullPath, old_string: "", new_string: snippetInput });
        pendingTelemetry.push({
          targetPath: fullPath,
          projectRoot: rootForItem,
          operation: "splice",
          surface: "cli",
          idiomsUsed: false,
          nativeText: res.modifiedCode,
          realisticNativeText: realisticNativePayload,
          preservedTriviaTokens: res.preservedTriviaTokens ?? 0,
          aiceText: snippetInput ? `${snippetInput}\n${responseMsg}` : responseMsg,
        });
      }
      results.push(res);
      modifiedSet.add(res.filePath);
    }
  } catch (err) {
    for (const createdFp of newlyCreatedFiles) {
      try {
        if (fs.existsSync(createdFp)) {
          fs.unlinkSync(createdFp);
        }
      } catch {
        // ignore
      }
    }
    for (const [fp, origContent] of backups.entries()) {
      try {
        fs.writeFileSync(fp, origContent, "utf-8");
      } catch {
        // ignore
      }
    }
    for (const [cfgFp, prevContent] of configSnapshots.entries()) {
      try {
        if (prevContent === null) {
          if (fs.existsSync(cfgFp)) {
            fs.unlinkSync(cfgFp);
            const parentDir = path.dirname(cfgFp);
            if (
              path.basename(parentDir) === ".aice-cache" &&
              fs.existsSync(parentDir) &&
              fs.readdirSync(parentDir).length === 0
            ) {
              fs.rmdirSync(parentDir);
            }
          }
        } else {
          fs.mkdirSync(path.dirname(cfgFp), { recursive: true });
          fs.writeFileSync(cfgFp, prevContent, "utf-8");
        }
      } catch {
        // ignore
      }
    }
    throw err;
  }

  if (!options.dryRun) {
    for (const ev of pendingTelemetry) {
      recordTelemetryEvent(ev);
    }
  }

  return {
    success: true,
    results,
    modifiedFiles: Array.from(modifiedSet),
    totalEdits: results.length,
  };
}
