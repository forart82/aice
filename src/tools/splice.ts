/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AICE 2.0 AST Surgical Splice Engine (Step 19).
 * Enables surgical AST modifications achieving 90%+ output token reduction for AI contexts.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import postcss from "postcss";
import YAML from "yaml";
import ts from "../compat/typescript.js";
import {
  AICE_DISABLED_MESSAGE,
  findProjectRoot,
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
  Expr,
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
import { decompile } from "../decompiler/index.js";
import { detectTargetFromPath, emitTarget, type TargetLanguage } from "../emitters/index.js";
import { expandModuleIdioms } from "../idioms/index.js";
import { recordTelemetryEvent, withSuppressedTelemetry } from "../telemetry/index.js";
import { estimateTokens } from "../tokenomics/index.js";
import { TypeChecker } from "../typechecker/checker.js";
import { resolveFirstActionableSymbol } from "./context.js";
import { createFile, extractInlineIdiomsFromSource } from "./create.js";
import {
  isHybridOrNativeSource,
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
  /** Identifier of target symbol (e.g., 'calculate', 'GameEngine.step', 'User.id') */
  symbol?: string;
  /** Replacement AICE code snippet */
  code?: string;
  /** If set, replaces only the body/statements of the function/method rather than the entire declaration signature */
  body?: string;
  /** If true, removes the symbol entirely */
  delete?: boolean;
  /** Inserts the new code directly after this symbol */
  insertAfter?: string;
  /** Inserts the new code directly before this symbol */
  insertBefore?: string;
  /** Appends declaration to end of module or class */
  append?: boolean;
  /** Multi-symbol batch edits for a single file applied in reverse offset order (bottom-to-top) */
  edits?: SymbolSpliceEdit[];
  /** If true, creates the file from scratch via createFile() */
  create?: boolean;
  /** Does not write file to disk */
  dryRun?: boolean;
  /** Generates unified diff */
  diff?: boolean;
  /** Automatically triggers compilation of target after splicing */
  compile?: boolean;
  /** Project root directory */
  projectRoot?: string;
  /** Optional idioms toggle override */
  idioms?: boolean;
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
}

export interface BatchSpliceResult {
  success: boolean;
  results: SpliceResult[];
  modifiedFiles: string[];
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
  for (const item of ast.items) {
    if (item.kind === "ClassDecl") {
      for (const m of item.methods) {
        if (m.name === symbol) {
          return { name: symbol, parent: item, node: m, kind: "method" };
        }
      }
      for (const p of item.properties) {
        if (p.name === symbol) {
          return { name: symbol, parent: item, node: p, kind: "property" };
        }
      }
    } else if (item.kind === "TypeDecl") {
      if (item.fields) {
        for (const f of item.fields) {
          if (f.name === symbol) {
            return { name: symbol, parent: item, node: f, kind: "field" };
          }
        }
      }
      if (item.variants) {
        for (const v of item.variants) {
          if (v.name === symbol) {
            return { name: symbol, parent: item, node: v, kind: "variant" };
          }
        }
      }
    }
  }

  return undefined;
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
      throw new Error(`Symbol '${targetSymbol}' not found in ${filePath}`);
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
      throw new Error(`Symbol '${targetSymbol}' not found in ${filePath}`);
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
      throw new Error(`Symbol '${targetSymbol}' not found in ${filePath}`);
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
  const rawTokenStart = targetNode.getStart(sf, false);
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

function locateTsDeclarationSpan(
  nativeSource: string,
  symbolSelector: string,
  explicitClassName?: string,
  preferAccessor?: "get" | "set",
  preferredArity?: number,
): NativeSpanInfo | undefined {
  const sf = ts.createSourceFile(
    "file.tsx",
    nativeSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
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
  const collectStmts = (stmts: readonly ts.Statement[]) => {
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
    for (const stmt of allStmts) {
      if (ts.isClassDeclaration(stmt) && stmt.name?.text === className) {
        const matchingMembers = stmt.members.filter((m) => getTsMemberName(m, sf) === memberName);
        if (matchingMembers.length > 0) {
          const implMember = selectBestTsMember(matchingMembers, inferredAccessor, explicitArity);
          return buildSpanInfoFromTsNode(implMember, sf, nativeSource, memberName, className);
        }
      }
    }
    return undefined;
  }

  // 1. Top-level declaration search (prefer implementation with .body over overload signature headers)
  const matchingTopStmts = allStmts.filter(
    (stmt) =>
      (ts.isFunctionDeclaration(stmt) ||
        ts.isClassDeclaration(stmt) ||
        ts.isInterfaceDeclaration(stmt) ||
        ts.isTypeAliasDeclaration(stmt) ||
        ts.isEnumDeclaration(stmt)) &&
      stmt.name?.text === memberName,
  );
  if (matchingTopStmts.length > 0) {
    const implStmt =
      matchingTopStmts.find((s) => (s as { body?: unknown }).body !== undefined) ??
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

  // 2. Fallback: unique class member search
  for (const stmt of allStmts) {
    if (ts.isClassDeclaration(stmt)) {
      const parentName = stmt.name?.text;
      const matchingMembers = stmt.members.filter((m) => getTsMemberName(m, sf) === memberName);
      if (matchingMembers.length > 0) {
        const implMember = selectBestTsMember(matchingMembers, inferredAccessor, explicitArity);
        return buildSpanInfoFromTsNode(implMember, sf, nativeSource, memberName, parentName);
      }
    }
  }

  return undefined;
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

  for (let i = searchStartLine; i < searchEndLine; i++) {
    const m = lines[i].match(defRegex);
    if (m) {
      if (!className && m[1].length > 0) {
        for (let k = i - 1; k >= 0; k--) {
          const cm = lines[k].match(/^([ \t]*)class\s+([A-Za-z0-9_]+)\b/);
          if (cm && cm[1].length < m[1].length) {
            activeClassName = cm[2];
            break;
          }
        }
      }
      targetLine = i;
      targetIndent = m[1];
      isAsync = Boolean(m[2]);
      break;
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
      } else if (ch === ")") {
        parenDepth = Math.max(0, parenDepth - 1);
      } else if (parenDepth === 0) {
        if (ch === "{") {
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
    for (let i = 0; i < lines.length; i++) {
      const oolMatch = lines[i].match(
        /^([ \t]*)(?:[A-Za-z0-9_:<>*&]+\s+)+([A-Za-z0-9_]+)\s*::\s*([A-Za-z0-9_~]+)\s*\(/,
      );
      if (oolMatch) {
        const [, indent, cls, fnName] = oolMatch;
        const classMatches = !normClass || normIdForSpan(cls) === normClass;
        const nameMatches = fnName === memberName || normIdForSpan(fnName) === normMember;
        if (classMatches && nameMatches && lines[i].includes("{")) {
          return buildBraceSpanFromLine(i, indent, fnName, cls, { cppOutOfLine: true });
        }
      }
    }
  }

  // 3. Determine class/impl search windows for Rust, C++, C#, Kotlin, PHP
  const containerWindows: Array<{ start: number; end: number; resolvedName: string }> = [];
  let resolvedClassName = className;

  if (className) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const isRustImpl =
        targetLang === "rust" &&
        /^\s*impl(?:\s*<[^>]*>)?\s+(?:[A-Za-z0-9_:<>,\s]+\s+for\s+)?([A-Za-z0-9_]+)\b/.exec(line);
      const isClassLine =
        /^\s*(?:pub\s+|public\s+|private\s+|protected\s+|internal\s+|static\s+|partial\s+|final\s+|abstract\s+|open\s+|data\s+|sealed\s+|readonly\s+)*(?:class|struct|interface|trait|object|record|enum)\s+([A-Za-z0-9_]+)\b/.exec(
          line,
        );

      const m = isRustImpl || isClassLine;
      if (m && (m[1] === className || normIdForSpan(m[1]) === normClass)) {
        const openBrace = nativeSource.indexOf("{", lineOffsets[i]);
        if (openBrace >= 0) {
          resolvedClassName = m[1];
          containerWindows.push({
            start: openBrace + 1,
            end: findMatchingBraceEnd(nativeSource, openBrace, targetLang),
            resolvedName: m[1],
          });
        }
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
    if (className && !containerWindows.some((w) => lineOff >= w.start && lineOff < w.end)) {
      continue;
    }
    const line = lines[i];

    if (targetLang === "rust") {
      const fnMatch = line.match(
        /^([ \t]*)(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:const\s+)?(?:unsafe\s+)?fn\s+([A-Za-z0-9_]+)\b/,
      );
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
      const funMatch = line.match(
        /^([ \t]*)(?:public\s+|private\s+|protected\s+|internal\s+|override\s+|open\s+|suspend\s+|inline\s+|operator\s+)*fun\s+(?:<[^>]+>\s+)?(?:[A-Za-z0-9_<>?.*]+\.)?([A-Za-z0-9_]+)\s*\(/,
      );
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
      const phpMatch = line.match(
        /^([ \t]*)(?:public\s+|private\s+|protected\s+|static\s+|final\s+|abstract\s+)*function\s+&?([A-Za-z0-9_]+)\s*\(/,
      );
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
      const cMethodMatch = line.match(
        /^([ \t]*)(?:public\s+|private\s+|protected\s+|internal\s+|static\s+|virtual\s+|override\s+|async\s+|inline\s+|constexpr\s+|explicit\s+|friend\s+)*(?:[A-Za-z0-9_:<>*&[\]?,]+\s+)+([A-Za-z0-9_~]+)\s*(?:<[^>]+>)?\s*\(/,
      );
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
        /^([ \t]*)(?:pub\s+|public\s+|private\s+|protected\s+|internal\s+|static\s+|partial\s+|final\s+|abstract\s+|open\s+|data\s+|sealed\s+|readonly\s+)*(?:class|struct|interface|enum(?:\s+class)?|record(?:\s+class|\s+struct)?)\s+([A-Za-z0-9_]+)\b/,
      );
      if (clsMatch && (clsMatch[2] === memberName || normIdForSpan(clsMatch[2]) === normMember)) {
        return buildBraceSpanFromLine(i, clsMatch[1], clsMatch[2], undefined, {
          isClassContainer: true,
        });
      }
    }
  }

  if (candidates.length > 0) {
    if (explicitArity !== undefined) {
      const arityMatch = candidates.find(
        (c) => countHeaderParams(c.origHeader ?? "") === explicitArity,
      );
      if (arityMatch) return arityMatch;
    }
    return candidates[0];
  }

  // 5. Fallback: if !className, try finding enclosing class name for a unique method match
  if (!className) {
    for (let i = 0; i < lines.length; i++) {
      const clsMatch = lines[i].match(
        /^\s*(?:pub\s+|public\s+|private\s+|protected\s+|internal\s+|static\s+|partial\s+|final\s+|abstract\s+|open\s+|data\s+|sealed\s+|impl\s+)*(?:class|struct|impl)\s+([A-Za-z0-9_]+)\b/,
      );
      if (clsMatch) {
        const candidateCls = clsMatch[1];
        const found = locateBraceLanguageDeclarationSpan(
          nativeSource,
          `${candidateCls}.${memberName}`,
          targetLang,
          candidateCls,
          explicitArity,
        );
        if (found) return found;
      }
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
  const lines = nativeSource.split("\n");
  const lineOffsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    lineOffsets.push(offset);
    offset += line.length + 1;
  }

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
  let inParenGroup = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (inParenGroup) {
      lastImportLine = i;
      if (trimmed.includes(")") || trimmed.includes("};")) {
        inParenGroup = false;
      }
      continue;
    }

    if (isImportLine(line)) {
      if (firstImportLine === -1) {
        firstImportLine = i;
      }
      lastImportLine = i;
      if (
        trimmed.startsWith("import (") ||
        trimmed === "import (" ||
        (trimmed.includes("{") && !trimmed.includes("}")) ||
        (trimmed.includes("(") && !trimmed.includes(")"))
      ) {
        inParenGroup = true;
      }
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

  if (symbolSelector.toLowerCase() === "imports" || symbolSelector.toLowerCase() === "import") {
    const importSpan = locateImportBlockSpan(nativeSource, targetLang);
    if (importSpan) {
      return enrichSpanWithOffsetsAndLines(nativeSource, importSpan);
    }
  }

  let rawSpan: NativeSpanInfo | undefined;
  if (targetLang === "python") {
    const cleanPySel = symbolSelector.trim().replace(/\([^)]*\)$/, "");
    rawSpan = locatePythonDeclarationSpan(nativeSource, cleanPySel, classFilter);
  } else if (targetLang === "typescript" || targetLang === "javascript" || targetLang === "tsx") {
    rawSpan = locateTsDeclarationSpan(
      nativeSource,
      symbolSelector,
      classFilter,
      preferAccessor,
      preferredArity,
    );
  } else {
    rawSpan =
      locateBraceLanguageDeclarationSpan(
        nativeSource,
        symbolSelector,
        targetLang,
        classFilter,
        preferredArity,
      ) ??
      locateTsDeclarationSpan(
        nativeSource,
        symbolSelector,
        classFilter,
        preferAccessor,
        preferredArity,
      );
  }

  return enrichSpanWithOffsetsAndLines(nativeSource, rawSpan);
}

function normalizeSelfAndThisInExpr(expr: Expr, useThis: boolean): void {
  switch (expr.kind) {
    case "IdentifierExpr":
      if (useThis && expr.name === "self") {
        expr.name = "this";
      } else if (!useThis && expr.name === "this") {
        expr.name = "self";
      }
      break;
    case "BinaryExpr":
      normalizeSelfAndThisInExpr(expr.left, useThis);
      normalizeSelfAndThisInExpr(expr.right, useThis);
      break;
    case "UnaryExpr":
    case "AwaitExpr":
    case "PostfixTryExpr":
      normalizeSelfAndThisInExpr(expr.operand, useThis);
      break;
    case "AssignExpr":
      normalizeSelfAndThisInExpr(expr.target, useThis);
      normalizeSelfAndThisInExpr(expr.value, useThis);
      break;
    case "CallExpr":
      normalizeSelfAndThisInExpr(expr.callee, useThis);
      for (const a of expr.args) normalizeSelfAndThisInExpr(a, useThis);
      break;
    case "MemberAccessExpr":
      normalizeSelfAndThisInExpr(expr.object, useThis);
      break;
    case "IndexExpr":
      normalizeSelfAndThisInExpr(expr.object, useThis);
      normalizeSelfAndThisInExpr(expr.index, useThis);
      break;
    case "ArrayLiteralExpr":
      for (const el of expr.elements) normalizeSelfAndThisInExpr(el, useThis);
      break;
    case "RecordLiteralExpr":
      for (const p of expr.properties) normalizeSelfAndThisInExpr(p.value, useThis);
      break;
    case "TemplateLiteralExpr":
      for (const e of expr.expressions) normalizeSelfAndThisInExpr(e, useThis);
      break;
    case "ClosureExpr":
      if (expr.body.kind === "Block") {
        normalizeSelfAndThisInBlock(expr.body, useThis);
      } else {
        normalizeSelfAndThisInExpr(expr.body, useThis);
      }
      break;
  }
}

function normalizeSelfAndThisInStmt(stmt: Statement, useThis: boolean): void {
  switch (stmt.kind) {
    case "LetBinding":
    case "DestructureBinding":
      normalizeSelfAndThisInExpr(stmt.init, useThis);
      break;
    case "AssignStmt":
      normalizeSelfAndThisInExpr(stmt.target, useThis);
      normalizeSelfAndThisInExpr(stmt.value, useThis);
      break;
    case "ExprStmt":
    case "ThrowStmt":
      normalizeSelfAndThisInExpr(stmt.expr, useThis);
      break;
    case "ReturnStmt":
      if (stmt.value) normalizeSelfAndThisInExpr(stmt.value, useThis);
      break;
    case "IfStmt":
      normalizeSelfAndThisInExpr(stmt.condition, useThis);
      normalizeSelfAndThisInBlock(stmt.thenBranch, useThis);
      for (const el of stmt.elifBranches) {
        normalizeSelfAndThisInExpr(el.condition, useThis);
        normalizeSelfAndThisInBlock(el.body, useThis);
      }
      if (stmt.elseBranch) normalizeSelfAndThisInBlock(stmt.elseBranch, useThis);
      break;
    case "WhileStmt":
      normalizeSelfAndThisInExpr(stmt.condition, useThis);
      normalizeSelfAndThisInBlock(stmt.body, useThis);
      break;
    case "ForStmt":
      normalizeSelfAndThisInExpr(stmt.iterable, useThis);
      normalizeSelfAndThisInBlock(stmt.body, useThis);
      break;
    case "MatchStmt":
      normalizeSelfAndThisInExpr(stmt.target, useThis);
      for (const c of stmt.cases) {
        if (c.guard) normalizeSelfAndThisInExpr(c.guard, useThis);
        if (c.body.kind === "Block") normalizeSelfAndThisInBlock(c.body, useThis);
        else normalizeSelfAndThisInExpr(c.body, useThis);
      }
      break;
    case "TryStmt":
      normalizeSelfAndThisInBlock(stmt.tryBlock, useThis);
      if (stmt.catchBlock) normalizeSelfAndThisInBlock(stmt.catchBlock, useThis);
      if (stmt.finallyBlock) normalizeSelfAndThisInBlock(stmt.finallyBlock, useThis);
      break;
  }
}

function normalizeSelfAndThisInBlock(block: Block, useThis: boolean): void {
  for (const s of block.statements) {
    normalizeSelfAndThisInStmt(s, useThis);
  }
}

function normalizeSelfAndThisInDecl(
  decl: FunctionDecl | MethodDecl,
  targetLang: TargetLanguage,
): void {
  const useThis =
    targetLang === "typescript" ||
    targetLang === "javascript" ||
    targetLang === "csharp" ||
    targetLang === "cpp" ||
    targetLang === "kotlin" ||
    targetLang === "php";
  if ("statements" in decl.body) {
    normalizeSelfAndThisInBlock(decl.body, useThis);
  } else {
    normalizeSelfAndThisInExpr(decl.body, useThis);
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
  normalizeSelfAndThisInDecl(cloned, targetLang);

  const dummySpan = cloned.span;

  if (className || cloned.kind === "MethodDecl") {
    const methodNode: MethodDecl = {
      kind: "MethodDecl",
      name: origMeta?.memberName ?? cloned.name,
      typeParams: cloned.typeParams ?? [],
      params: cloned.params.filter((p) => p.name !== "self" && p.name !== "this"),
      returnType: cloned.returnType,
      isAsync: Boolean(origMeta?.isAsync ?? cloned.isAsync),
      isStatic: Boolean(origMeta?.isStatic ?? ("isStatic" in cloned ? cloned.isStatic : false)),
      accessor: origMeta?.accessor ?? ("accessor" in cloned ? cloned.accessor : undefined),
      isExpressionBodied: cloned.isExpressionBodied,
      body: cloned.body,
      span: dummySpan,
    };

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
    throw new Error(`Symbol '${symbolSelector}' not found in ${filePath}`);
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

function isPureNativeSnippetWithoutIdioms(
  snippet: string,
  targetLang: TargetLanguage,
  className?: string,
): boolean {
  const trimmed = snippet.trim();
  if (
    /\$[A-Za-z_][A-Za-z0-9_]*\s*\(/.test(trimmed) ||
    /\bret\b/.test(trimmed) ||
    /(?:^|\s)(?:@fn|@cls|@type|\^fn|\^class|\^type|\^const|\^val|\^mut|\^let|\^async|\^static)\b/.test(
      trimmed,
    ) ||
    /(?::(?!=)[ \t]*(?:#|\$|\?|_|\*|\[[ \t]*(?:#|\$|\?|_|\*)[ \t]*\])|->[ \t]*:?[ \t]*(?:#|\$|\?|_|\*|\[[ \t]*(?:#|\$|\?|_|\*)[ \t]*\]))(?![A-Za-z0-9_])/.test(
      trimmed,
    )
  ) {
    return false;
  }
  if (
    targetLang !== "go" &&
    (trimmed.includes(":=") || trimmed.includes("::=") || trimmed.includes("<-"))
  ) {
    return false;
  }

  if (targetLang === "typescript" || targetLang === "javascript" || targetLang === "tsx") {
    if (
      /^(?:pub\s+|priv\s+|ro\s+|public\s+|private\s+|protected\s+|static\s+|async\s+)*fn\b/.test(
        trimmed,
      ) ||
      /^(?:pub\s+|priv\s+|ro\s+|val\s+|mut\s+)/.test(trimmed) ||
      /^(?:pub\s+)?(?:rec|enum|type|class|component)\b/.test(trimmed)
    ) {
      return false;
    }
    const isTopLevelConstruct =
      /^(?:export\s+)?(?:interface|type|enum|class|function|const|let|var)\b/.test(trimmed);
    if (
      !isTopLevelConstruct &&
      !trimmed.includes("{") &&
      !trimmed.includes("=>") &&
      !trimmed.endsWith(";")
    ) {
      return false;
    }
    const wrapped =
      className && !isTopLevelConstruct ? `class ${className} {\n${trimmed}\n}` : trimmed;
    const sf = ts.createSourceFile(
      "check.tsx",
      wrapped,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const diags = (sf as unknown as { parseDiagnostics?: unknown[] }).parseDiagnostics;
    return !diags || diags.length === 0;
  }

  if (targetLang === "go") {
    return /^func\b/.test(trimmed) && trimmed.endsWith("}");
  }
  if (targetLang === "rust") {
    return (
      /^(?:#\[[^\]]+\]\s*)*(?:pub\s+)?(?:async\s+)?fn\b/.test(trimmed) &&
      trimmed.includes("{") &&
      trimmed.endsWith("}") &&
      !/:\s*\n/.test(trimmed)
    );
  }
  if (targetLang === "kotlin") {
    return (
      /^(?:@[A-Za-z0-9_]+(?:\([^)]*\))?\s*)*(?:public\s+|private\s+|protected\s+|override\s+|suspend\s+|inline\s+)*fun\b/.test(
        trimmed,
      ) &&
      trimmed.includes("{") &&
      trimmed.endsWith("}")
    );
  }
  if (targetLang === "php") {
    return (
      /^(?:public\s+|private\s+|protected\s+|static\s+)*function\b/.test(trimmed) &&
      trimmed.includes("{") &&
      trimmed.endsWith("}")
    );
  }
  if (targetLang === "csharp" || targetLang === "cpp") {
    return (
      !/^(?:pub\s+|async\s+|static\s+)*fn\b/.test(trimmed) &&
      trimmed.includes("(") &&
      trimmed.includes("{") &&
      (trimmed.endsWith("}") || trimmed.endsWith("};"))
    );
  }
  if (targetLang === "python") {
    return (
      /^(?:@[A-Za-z0-9_.]+\s*\n\s*)*(?:async\s+)?def\s+[A-Za-z0-9_]+\s*\(/.test(trimmed) &&
      !trimmed.includes(":=") &&
      !/\bret\b/.test(trimmed)
    );
  }

  return false;
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
        const singleMod: Module = {
          kind: "Module",
          path: path.basename(filePath),
          items: [item],
          span: mod.span,
        };
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

  // Pure AICE component or style blocks must use the AICE parser/emitter
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
          )))
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
  const { cleanedCode, inlineIdioms } = extractInlineIdiomsFromSource(rawSnippet);
  const mergedIdioms: Record<string, ProjectIdiomDefinition> = {
    ...(idioms ?? {}),
    ...inlineIdioms,
  };
  const dedented = dedentSnippet(cleanedCode);
  const insideClass = Boolean(effectiveClassName && !spanInfo?.isClassContainer);

  if (
    !isBodyOnly &&
    !forceLosslessPreprocess &&
    Object.keys(inlineIdioms).length === 0 &&
    isPureNativeSnippetWithoutIdioms(dedented, targetLang, effectiveClassName)
  ) {
    return dedented.trim();
  }

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
    return preprocessHybridAndIdiomsLossless(dedented, targetLang, mergedIdioms, {
      insideClass,
      goReceiver: spanInfo?.goReceiver,
    }).trim();
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
      memberName: originalSnippet ? spanInfo?.memberName : decl.name,
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

    resolvedDialectEdits.sort((a, b) => b.startOffset - a.startOffset || b.endOffset - a.endOffset);
    let modifiedCode = nativeSource;
    for (const item of resolvedDialectEdits) {
      modifiedCode = `${modifiedCode.slice(0, item.startOffset)}${item.replacement}${modifiedCode.slice(item.endOffset)}`;
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
      throw new Error(`CSS selector '${anchorSymbol}' not found in ${filePath}`);
    }

    const startOffset = matchedRule.source.start.offset;
    const endOffset = matchedRule.source.end.offset;
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

      if (options.append && !anchorSymbol) {
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
      if (
        !options.append &&
        !options.insertAfter &&
        !options.insertBefore &&
        !isRootConfig &&
        !doc.hasIn(keyParts)
      ) {
        throw new Error(`Key '${anchorSymbol}' not found in ${filePath}`);
      }

      const origNode = isRootConfig ? doc.contents : doc.getIn(keyParts, true);
      const origVal =
        origNode && typeof (origNode as { toJSON?: () => unknown }).toJSON === "function"
          ? (origNode as { toJSON: () => unknown }).toJSON()
          : origNode;
      const originalSnippet = YAML.stringify(origVal).trimEnd();

      let newSnippet = "";
      if (options.delete) {
        const normKeys = keyParts.map((k) => (/^\d+$/.test(k) ? Number(k) : k));
        doc.deleteIn(normKeys);
      } else {
        const { declName, value: newVal } = parseSnippetMeta();
        const leaf = keyParts[keyParts.length - 1];
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

    if (options.append && !anchorSymbol) {
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
      !options.append &&
      !options.insertAfter &&
      !options.insertBefore &&
      !(leafKey in parent) &&
      !(keyParts.length === 1 && leafKey === "config")
    ) {
      throw new Error(`Key '${anchorSymbol}' not found in ${filePath}`);
    }

    const origVal = leafKey === "config" && !(leafKey in parent) ? docObj : parent[leafKey];
    const originalSnippet = JSON.stringify(origVal, null, 2);

    let newSnippet = "";
    if (options.delete) {
      if (Array.isArray(parent) && /^\d+$/.test(leafKey)) {
        parent.splice(Number(leafKey), 1);
      } else {
        delete parent[leafKey];
      }
    } else {
      const { declName, value: newVal } = parseSnippetMeta();
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

    if (options.append && !anchorSymbol) {
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
    const cleanSel = sel.replace(/^(?:[A-Za-z0-9_]+\.|#|\.|block:)/, "");
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
}

function resolveSingleNativeEditAgainstSource(
  nativeSource: string,
  options: SpliceOptions,
  filePath: string,
  targetLang: TargetLanguage,
  idioms: Record<string, ProjectIdiomDefinition> | undefined,
  forceLosslessPreprocess: boolean,
): ResolvedNativeEdit {
  const anchorSymbol = options.insertAfter ?? options.insertBefore ?? options.symbol;
  const rawSnippet = options.code ?? options.body ?? "";
  if (!anchorSymbol) {
    throw new Error("Must specify target symbol with --symbol when splicing native file");
  }

  if (/^(?:eof|end|append)$/i.test(anchorSymbol.trim())) {
    if (options.delete) {
      throw new Error(`Cannot delete '${anchorSymbol}'`);
    }
    if (!rawSnippet.trim()) {
      throw new Error("Must provide non-empty --code when appending to native file");
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
    const endLine = lineRangeMatch[2] ? parseInt(lineRangeMatch[2], 10) : startLine;

    const rawLines = nativeSource.split(/\r?\n/);
    const totalLines = rawLines.length;

    if (startLine < 1 || endLine > totalLines || startLine > endLine) {
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

    let processedCode = preprocessHybridAndIdiomsLossless(rawSnippet, targetLang, idioms);

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

    return {
      symbol: anchorSymbol,
      startOffset,
      endOffset,
      replacement: processedCode,
      originalSnippet,
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

  let spanInfo = locateNativeDeclarationSpan(
    nativeSource,
    anchorSymbol,
    targetLang,
    undefined,
    preferAccessor,
    preferredArity,
  );
  let autoAppendToClass = false;

  if (!spanInfo && !options.delete && !options.insertBefore && !options.insertAfter) {
    const trimmedAnchor = anchorSymbol.trim();
    const plusMatch = trimmedAnchor.match(/^([A-Za-z_$][A-Za-z0-9_$]*)\+$/);
    const dotIdx = trimmedAnchor.indexOf(".");
    const candidateClassName = plusMatch
      ? plusMatch[1]
      : dotIdx > 0
        ? trimmedAnchor.slice(0, dotIdx).trim()
        : undefined;
    if (candidateClassName) {
      const classSpan = locateNativeDeclarationSpan(nativeSource, candidateClassName, targetLang);
      if (classSpan && classSpan.isClassContainer) {
        spanInfo = classSpan;
        autoAppendToClass = true;
      }
    }
  }

  if (!spanInfo) {
    throw new Error(`Symbol '${anchorSymbol}' not found in ${filePath}`);
  }
  const originalSnippet = nativeSource.slice(spanInfo.declStart, spanInfo.declEnd);

  if (options.delete) {
    const delStart = spanInfo.fullDeclStart ?? spanInfo.declStart;
    let delEnd = spanInfo.declEnd;
    while (
      delEnd < nativeSource.length &&
      (nativeSource[delEnd] === " " || nativeSource[delEnd] === "\t")
    ) {
      delEnd++;
    }
    if (nativeSource[delEnd] === "\r" && nativeSource[delEnd + 1] === "\n") delEnd += 2;
    else if (nativeSource[delEnd] === "\n") delEnd += 1;
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
      throw new Error("Must provide non-empty --code when inserting into native file");
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
      throw new Error("Must provide non-empty --code when appending to class in native file");
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
    const closeBracePos = nativeSource.lastIndexOf("}", spanInfo.declEnd);
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
    throw new Error("Must provide non-empty --code or --body when splicing native file");
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
  if (
    spanInfo.memberName === "imports" &&
    (targetLang === "typescript" || targetLang === "javascript" || targetLang === "tsx")
  ) {
    const origLines = originalSnippet
      .trim()
      .split(/\r?\n/)
      .filter((l) => l.trim().length > 0);
    const newLines = newSnippet
      .trim()
      .split(/\r?\n/)
      .filter((l) => l.trim().length > 0);
    const extractModSpec = (line: string): string | undefined => {
      const m = line.match(/\bfrom\s+['"]([^'"]+)['"]/);
      return m ? m[1] : undefined;
    };
    if (
      origLines.length >= 2 &&
      newLines.length >= 1 &&
      newLines.length < origLines.length &&
      newLines.every((l) => Boolean(extractModSpec(l)))
    ) {
      const merged = [...origLines];
      for (const nl of newLines) {
        const spec = extractModSpec(nl);
        const existingIdx = merged.findIndex((ol) => extractModSpec(ol) === spec);
        if (existingIdx >= 0) {
          merged[existingIdx] = nl;
        } else {
          merged.push(nl);
        }
      }
      const trailingNl = originalSnippet.endsWith("\r\n")
        ? "\r\n"
        : originalSnippet.endsWith("\n")
          ? "\n"
          : "";
      newSnippet = `${merged.join("\n")}${trailingNl}`;
    }
  }
  return {
    symbol: anchorSymbol,
    startOffset: replaceStart,
    endOffset: spanInfo.declEnd,
    replacement: newSnippet,
    originalSnippet,
    newSnippet,
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

    // Check for overlapping spans
    for (let i = 0; i < sortedReverse.length - 1; i++) {
      const lowerInFile = sortedReverse[i];
      const higherInFile = sortedReverse[i + 1];
      if (lowerInFile.startOffset < higherInFile.endOffset) {
        throw new Error(
          `Overlapping splice edits in ${filePath}: '${higherInFile.symbol}' [${higherInFile.startOffset}..${higherInFile.endOffset}] overlaps with '${lowerInFile.symbol}' [${lowerInFile.startOffset}..${lowerInFile.endOffset}]`,
        );
      }
    }

    let modifiedCode = nativeSource;
    for (const item of sortedReverse) {
      modifiedCode = `${modifiedCode.slice(0, item.startOffset)}${item.replacement}${modifiedCode.slice(item.endOffset)}`;
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
    };
  }

  const anchorSymbol = options.insertAfter ?? options.insertBefore ?? options.symbol;
  const rawSnippet = options.code ?? options.body ?? "";

  // Module-level append without --symbol
  if (options.append && !anchorSymbol) {
    if (!rawSnippet.trim()) {
      throw new Error("Must provide non-empty --code when appending to native file");
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
    return {
      success: true,
      filePath,
      newSnippet: emitted,
      diff,
      modifiedCode,
      newAiceSource: modifiedCode,
      tokensSaved: Math.max(0, modifiedTokens - snippetTokens),
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
  const modifiedTokens = estimateTokens(modifiedCode);
  const tokensSaved = Math.max(0, modifiedTokens - snippetTokens);

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
  };
}

/**
 * Executes AST surgical splice on a file with optional atomic disk write.
 * Directly splices native files (`.ts`, `.py`, `.rs`, `.go`, `.cpp`, `.cs`, `.kt`, `.php`, `.json`, `.yaml`, `.html`, `.twig`, `.css`)
 * as well as standalone `.aice` files in memory.
 */
export async function splice(
  filePath: string,
  rawOptions: SpliceOptions = {},
): Promise<SpliceResult> {
  let options = rawOptions;
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
  const baseDir = options.projectRoot ? path.resolve(options.projectRoot) : process.cwd();
  const fullPath = path.isAbsolute(filePath) ? filePath : path.resolve(baseDir, filePath);

  const root = options.projectRoot || findProjectRoot(path.dirname(fullPath), process.cwd());
  const config = loadProjectConfig(root);
  if (!isProjectAiceEnabled(config)) {
    throw new Error(AICE_DISABLED_MESSAGE);
  }

  const fileExists = fs.existsSync(fullPath);
  const hasBatchEdits = Boolean(options.edits && options.edits.length > 0);
  if (
    !hasBatchEdits &&
    ((!fileExists && !options.delete) || options.create || options.symbol === "*")
  ) {
    const prevSource = fileExists ? fs.readFileSync(fullPath, "utf-8") : "";
    const created = await createFile(fullPath, {
      code: options.code ?? options.body ?? "",
      idioms: options.idioms,
      dryRun: options.dryRun,
      projectRoot: root,
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

  const activeIdioms = options.idioms === false ? {} : config.idioms;
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
    const originalNative = await fs.promises.readFile(fullPath, "utf-8");
    const targetLang = detectTargetFromPath(fullPath);
    const origValidation = validateNativeSyntax(originalNative, targetLang, fullPath);

    const result = withSuppressedTelemetry(() =>
      spliceNativeSource(originalNative, options, fullPath, activeIdioms),
    );

    const postValidation = validateNativeSyntax(
      result.modifiedCode,
      targetLang,
      fullPath,
      activeIdioms,
    );
    if (!postValidation.valid && origValidation.valid) {
      const diagSummary = postValidation.diagnostics.join("; ");
      throw new Error(
        `Pre-write syntax validation failed for ${filePath} (${targetLang}): ${diagSummary}`,
      );
    }

    if (!options.dryRun) {
      const dir = path.dirname(fullPath);
      const tmpFile = path.join(
        dir,
        `.${path.basename(fullPath)}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
      );
      await fs.promises.writeFile(tmpFile, result.modifiedCode, "utf-8");
      await fs.promises.rename(tmpFile, fullPath);
    }

    const responseMsg = `✔ Spliced symbol '${result.symbol ?? options.symbol ?? ""}' in ${filePath} (${result.tokensSaved ?? 0} tokens saved)`;
    recordTelemetryEvent({
      targetPath: fullPath,
      projectRoot: root,
      operation: "splice",
      surface: "cli",
      idiomsUsed: idiomsUsedInSnippet,
      nativeText: result.modifiedCode,
      aiceText: snippetInput ? `${snippetInput}\n${responseMsg}` : responseMsg,
    });

    return result;
  }

  const originalSource = await fs.promises.readFile(fullPath, "utf-8");
  const result = withSuppressedTelemetry(() => spliceSource(originalSource, options, fullPath));

  // Write atomically to disk unless dryRun
  if (!options.dryRun) {
    const dir = path.dirname(fullPath);
    const tmpFile = path.join(
      dir,
      `.${path.basename(fullPath)}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
    );
    await fs.promises.writeFile(tmpFile, result.modifiedCode, "utf-8");
    await fs.promises.rename(tmpFile, fullPath);
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

    const outPath = fullPath.replace(/\.aice$/, innerExt ? "" : ".ts");
    await fs.promises.writeFile(outPath, emitted, "utf-8");
  }

  const responseMsg = `✔ Spliced symbol '${result.symbol ?? options.symbol ?? ""}' in ${filePath} (${result.tokensSaved ?? 0} tokens saved)`;
  recordTelemetryEvent({
    targetPath: fullPath,
    projectRoot: root,
    operation: "splice",
    surface: "cli",
    idiomsUsed: idiomsUsedInSnippet,
    nativeText: result.modifiedCode,
    aiceText: snippetInput ? `${snippetInput}\n${responseMsg}` : responseMsg,
  });

  return result;
}

export interface ParsedMultiBlockSpliceStream {
  singleFileEdits?: SymbolSpliceEdit[];
  batchItems?: BatchSpliceItem[];
}

/**
 * Parses a multi-block splice heredoc/stream delimited by `=== <symbol> ===`,
 * `=== <filePath>:<symbol> ===`, `--- <symbol> ---`, or `// SYMBOL: <symbol>`.
 */
export function parseMultiBlockSpliceStream(
  rawStream: string,
  defaultFilePath?: string,
): ParsedMultiBlockSpliceStream | null {
  if (!rawStream || !rawStream.trim()) return null;
  const lines = rawStream.split(/\r?\n/);
  const headerRe =
    /^\s*(?:(?:\/\/|#)\s*)?(?:={3,}\s*([^=\r\n]+?)\s*={3,}|-{3,}\s*([^-\r\n]+?)\s*-{3,}|(?:\/\/|#)\s*(?:FILE|SYMBOL|EDIT):\s*([^\r\n]+?))\s*$/i;

  const preHeaderLines: string[] = [];
  const sections: Array<{
    filePath?: string;
    symbol: string;
    isDelete: boolean;
    lines: string[];
  }> = [];

  for (const line of lines) {
    const m = line.match(headerRe);
    if (m) {
      let spec = (m[1] || m[2] || m[3] || "").trim().replace(/^['"`]|['"`]$/g, "");
      let isDelete = false;
      if (/\s+(?:--delete|-d|\(delete\))\s*$/i.test(spec)) {
        isDelete = true;
        spec = spec.replace(/\s+(?:--delete|-d|\(delete\))\s*$/i, "").trim();
      }
      let blockFilePath: string | undefined;
      let blockSymbol = spec;
      const fileSymMatch = spec.match(/^([^\s:#]+\.[a-zA-Z0-9]{1,10})(?:\s*(?::+|#)\s*|\s+)(.+)$/);
      if (fileSymMatch) {
        const candFile = fileSymMatch[1].trim();
        const ext = path.extname(candFile).toLowerCase();
        if (KNOWN_TARGET_EXTENSIONS.has(ext) || ext === ".aice") {
          blockFilePath = candFile;
          blockSymbol = fileSymMatch[2].trim();
        }
      }
      const isValidSymbol =
        Boolean(blockSymbol) && (!/\s/.test(blockSymbol) || /^[.#@]/.test(blockSymbol));
      if (isValidSymbol) {
        sections.push({
          filePath: blockFilePath,
          symbol: blockSymbol,
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
  if (meaningfulPre.length > 0) return null;

  let lastExplicitFilePath: string | undefined;
  const resolvedBlocks = sections.map((sec) => {
    const body = sec.lines.join("\n").replace(/^\n+|\n+$/g, "");
    const del = sec.isDelete || /^(?:--delete|DELETE)$/i.test(body.trim());
    if (sec.filePath) {
      lastExplicitFilePath = sec.filePath;
    }
    return {
      filePath: sec.filePath ?? defaultFilePath ?? lastExplicitFilePath,
      explicitFilePath: sec.filePath ?? lastExplicitFilePath,
      symbol: sec.symbol,
      code: del ? undefined : body,
      delete: del || undefined,
    };
  });

  if (resolvedBlocks.some((b) => !b.filePath)) {
    if (!defaultFilePath) {
      return {
        singleFileEdits: resolvedBlocks.map((b) => ({
          symbol: b.symbol,
          code: b.code,
          delete: b.delete,
        })),
      };
    }
  }

  const allSameDefault =
    Boolean(defaultFilePath) &&
    resolvedBlocks.every(
      (b) =>
        !b.explicitFilePath || path.resolve(b.explicitFilePath) === path.resolve(defaultFilePath!),
    );

  if (allSameDefault) {
    return {
      singleFileEdits: resolvedBlocks.map((b) => ({
        symbol: b.symbol,
        code: b.code,
        delete: b.delete,
      })),
    };
  }

  const groupedByFile = new Map<string, SymbolSpliceEdit[]>();
  for (const b of resolvedBlocks) {
    const fp = b.filePath!;
    const list = groupedByFile.get(fp) ?? [];
    list.push({
      symbol: b.symbol,
      code: b.code,
      delete: b.delete,
    });
    groupedByFile.set(fp, list);
  }

  const batchItems: BatchSpliceItem[] = [];
  for (const [fp, edits] of groupedByFile.entries()) {
    if (edits.length === 1) {
      batchItems.push({
        filePath: fp,
        symbol: edits[0].symbol,
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

  return { batchItems };
}

/**
 * Executes a batch of splices across one or more files atomically.
 * If any splice item in the batch fails, all modified files are rolled back to their exact original bytes.
 */
export async function spliceBatch(
  itemsOrStream: BatchSpliceItem[] | string,
  options: BatchSpliceOptions = {},
): Promise<BatchSpliceResult> {
  const items: BatchSpliceItem[] =
    typeof itemsOrStream === "string"
      ? (parseMultiBlockSpliceStream(itemsOrStream)?.batchItems ?? [])
      : itemsOrStream;
  const baseDir = options.projectRoot ? path.resolve(options.projectRoot) : process.cwd();
  const backups = new Map<string, string>();

  // Snapshot original contents of all existing target files before applying any changes
  for (const item of items) {
    const rawFp = item.filePath || item.file || item.path || "";
    const fullPath = path.isAbsolute(rawFp) ? rawFp : path.resolve(baseDir, rawFp);
    if (fs.existsSync(fullPath) && !backups.has(fullPath)) {
      backups.set(fullPath, fs.readFileSync(fullPath, "utf-8"));
    }
  }

  const results: SpliceResult[] = [];
  const modifiedSet = new Set<string>();
  const newlyCreatedFiles: string[] = [];

  try {
    for (const item of items) {
      const rawFp = item.filePath || item.file || item.path || "";
      const fullPath = path.isAbsolute(rawFp) ? rawFp : path.resolve(baseDir, rawFp);
      const existedBefore = backups.has(fullPath) || fs.existsSync(fullPath);
      const resolvedCode =
        item.code ?? item.aice ?? item.template ?? item.snippet ?? item.content ?? item.replacement;
      const res = await splice(rawFp, {
        ...item,
        code: resolvedCode,
        insertAfter: item.insertAfter ?? item.insert_after,
        insertBefore: item.insertBefore ?? item.insert_before,
        projectRoot: item.projectRoot ?? options.projectRoot,
        dryRun: item.dryRun ?? options.dryRun,
        compile: item.compile ?? options.compile,
        idioms: item.idioms ?? options.idioms,
      });
      if (!existedBefore && !(item.dryRun ?? options.dryRun)) {
        newlyCreatedFiles.push(fullPath);
      }
      results.push(res);
      modifiedSet.add(res.filePath);
    }
  } catch (err) {
    // Atomic rollback of all touched files!
    if (!options.dryRun) {
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
    }
    throw err;
  }

  return {
    success: true,
    results,
    modifiedFiles: Array.from(modifiedSet),
  };
}
