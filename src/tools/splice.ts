/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AIL 2.0 AST Surgical Splice Engine (Step 19).
 * Enables surgical AST modifications achieving 90%+ output token reduction for AI contexts.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import ts from "../compat/typescript.js";
import {
  findProjectRoot,
  KNOWN_TARGET_EXTENSIONS,
  loadProjectConfig,
  resolveTargetOutputPathForConfig,
  type ProjectIdiomDefinition,
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
import { parse, parseWithTrivia } from "../core/parser.js";
import { decompile } from "../decompiler/index.js";
import { detectTargetFromPath, emitTarget, type TargetLanguage } from "../emitters/index.js";
import { expandModuleIdioms } from "../idioms/index.js";
import { safeWriteTargetFile } from "../shield/index.js";
import { estimateTokens } from "../tokenomics/index.js";
import { TypeChecker } from "../typechecker/checker.js";

export interface SpliceOptions {
  /** Identifier of target symbol (e.g., 'calculate', 'GameEngine.step', 'User.id') */
  symbol?: string;
  /** Replacement AIL code snippet */
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
}

export interface BatchSpliceOptions {
  projectRoot?: string;
  dryRun?: boolean;
  compile?: boolean;
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
  originalSnippet?: string;
  newSnippet?: string;
  diff?: string;
  modifiedCode: string;
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
  const isNested = symbol.includes(".") || symbol.includes("::");
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
  options: SpliceOptions,
  filePath = "source.ail",
): SpliceResult {
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
    tokensSaved,
  };
}

interface NativeSpanInfo {
  declStart: number;
  fullDeclStart?: number;
  declEnd: number;
  tokenStart: number;
  declIndent: string;
  className?: string;
  memberName: string;
  visibility?: "public" | "private" | "protected";
  isExported?: boolean;
  isStatic?: boolean;
  isAsync?: boolean;
}

function getTsMemberName(member: ts.Node, sf: ts.SourceFile): string | undefined {
  if (ts.isConstructorDeclaration(member)) {
    return "constructor";
  }
  const named = member as { name?: ts.PropertyName };
  if (!named.name) return undefined;
  if (ts.isIdentifier(named.name) || ts.isStringLiteral(named.name) || ts.isNumericLiteral(named.name)) {
    return named.name.text;
  }
  return named.name.getText(sf);
}

function getPostDecoratorTokenStart(node: ts.Node, sf: ts.SourceFile, nativeSource: string): number {
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
  return { visibility, isExported, isStatic, isAsync };
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

function locateTsDeclarationSpan(
  nativeSource: string,
  symbolSelector: string,
  explicitClassName?: string,
): NativeSpanInfo | undefined {
  const sf = ts.createSourceFile(
    "file.tsx",
    nativeSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const parts = symbolSelector.split(/\.|::/);
  const className = explicitClassName ?? (parts.length >= 2 ? parts[0] : undefined);
  const memberName = parts.length >= 2 ? parts.slice(1).join(".") : symbolSelector;

  if (className) {
    for (const stmt of sf.statements) {
      if (ts.isClassDeclaration(stmt) && stmt.name?.text === className) {
        const matchingMembers = stmt.members.filter((m) => getTsMemberName(m, sf) === memberName);
        if (matchingMembers.length > 0) {
          const implMember =
            matchingMembers.find((m) => (m as { body?: unknown }).body !== undefined) ??
            matchingMembers[matchingMembers.length - 1];
          return buildSpanInfoFromTsNode(implMember, sf, nativeSource, memberName, className);
        }
      }
    }
    return undefined;
  }

  // 1. Top-level declaration search (prefer implementation with .body over overload signature headers)
  const matchingTopStmts = sf.statements.filter(
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
    return buildSpanInfoFromTsNode(implStmt, sf, nativeSource, memberName, undefined);
  }

  for (const stmt of sf.statements) {
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.name.text === memberName) {
          return buildSpanInfoFromTsNode(stmt, sf, nativeSource, memberName, undefined);
        }
      }
    }
  }

  // 2. Fallback: unique class member search
  for (const stmt of sf.statements) {
    if (ts.isClassDeclaration(stmt)) {
      const parentName = stmt.name?.text;
      const matchingMembers = stmt.members.filter((m) => getTsMemberName(m, sf) === memberName);
      if (matchingMembers.length > 0) {
        const implMember =
          matchingMembers.find((m) => (m as { body?: unknown }).body !== undefined) ??
          matchingMembers[matchingMembers.length - 1];
        return buildSpanInfoFromTsNode(implMember, sf, nativeSource, memberName, parentName);
      }
    }
  }

  return undefined;
}

function locatePythonDeclarationSpan(
  nativeSource: string,
  symbolSelector: string,
  explicitClassName?: string,
): NativeSpanInfo | undefined {
  const parts = symbolSelector.split(/\.|::/);
  const className = explicitClassName ?? (parts.length >= 2 ? parts[0] : undefined);
  const memberName = parts.length >= 2 ? parts.slice(1).join(".") : symbolSelector;

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
    const classRegex = new RegExp(`^([ \\t]*)class\\s+${className}\\b`);
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
    for (let i = searchStartLine; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const ind = lines[i].match(/^[ \t]*/)?.[0].length ?? 0;
      if (ind <= classIndentLen) {
        searchEndLine = i;
        break;
      }
    }
  }

  const defRegex = new RegExp(`^([ \\t]*)(?:async\\s+)?def\\s+${memberName}\\s*\\(`);
  let targetLine = -1;
  let targetIndent = "";
  for (let i = searchStartLine; i < searchEndLine; i++) {
    const m = lines[i].match(defRegex);
    if (m) {
      if (!className && m[1].length > 0) {
        // Also detect enclosing class if any
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
      break;
    }
  }

  if (targetLine < 0) return undefined;

  let endLine = targetLine;
  const baseIndentLen = targetIndent.length;
  for (let i = targetLine + 1; i < searchEndLine; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;
    const ind = lines[i].match(/^[ \t]*/)?.[0].length ?? 0;
    if (ind <= baseIndentLen) {
      break;
    }
    endLine = i;
  }

  const declStart = lineOffsets[targetLine];
  const tokenStart = declStart + targetIndent.length;
  const endLineStr = lines[endLine];
  const cleanEndLen = endLineStr.endsWith("\r") ? endLineStr.length - 1 : endLineStr.length;
  const declEnd = lineOffsets[endLine] + cleanEndLen;

  return {
    declStart,
    declEnd,
    tokenStart,
    declIndent: targetIndent,
    className: activeClassName,
    memberName,
  };
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
  }
}

function normalizeSelfAndThisInBlock(block: Block, useThis: boolean): void {
  for (const s of block.statements) {
    normalizeSelfAndThisInStmt(s, useThis);
  }
}

function normalizeSelfAndThisInDecl(decl: FunctionDecl | MethodDecl, targetLang: TargetLanguage): void {
  const useThis =
    targetLang === "typescript" ||
    targetLang === "javascript" ||
    targetLang === "csharp" ||
    targetLang === "cpp" ||
    targetLang === "kotlin";
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
  },
): string {
  const cloned = structuredClone(expandedDecl);
  normalizeSelfAndThisInDecl(cloned, targetLang);

  const dummySpan = cloned.span;

  if (className || cloned.kind === "MethodDecl") {
    const methodNode: MethodDecl = {
      kind: "MethodDecl",
      name: cloned.name,
      typeParams: cloned.typeParams ?? [],
      params: cloned.params.filter((p) => p.name !== "self" && p.name !== "this"),
      returnType: cloned.returnType,
      isAsync: Boolean(origMeta?.isAsync ?? cloned.isAsync),
      isStatic: Boolean(origMeta?.isStatic ?? ("isStatic" in cloned ? cloned.isStatic : false)),
      accessor: "accessor" in cloned ? cloned.accessor : undefined,
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
      path: filePath,
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
      return innerLines.join("\n").trimEnd();
    }

    // TypeScript / JavaScript / C-like class wrapper: strip `class _TmpClass {` and closing `}`
    const innerLines = lines
      .slice(1, lines.length - 1)
      .map((l) => (l.startsWith("  ") ? l.slice(2) : l));

    if (innerLines.length > 0 && origMeta?.visibility && (targetLang === "typescript" || targetLang === "csharp")) {
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
    name: cloned.name,
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
    path: filePath,
    items: [fnNode],
    span: dummySpan,
  };

  const emittedFn = emitTarget(tempMod, targetLang, { watermark: false }).trim();
  if (targetLang === "python") {
    const fnLines = emittedFn.split("\n");
    const defIdx = fnLines.findIndex((l) => /^(?:async\s+)?def\s+/.test(l.trim()));
    const relevantLines = (defIdx >= 0 ? fnLines.slice(defIdx) : fnLines).map((l) =>
      l
        .replace(/^(\s*(?:if|elif|while)\s+)\((.+)\):$/, "$1$2:")
        .replace(/^(\s*[A-Za-z0-9_.]+\s*=\s*)\((.+)\)$/, "$1$2")
        .replace(/^(\s*return\s+)\((.+)\)$/, "$1$2"),
    );
    return relevantLines.join("\n").trimEnd();
  }
  return targetLang === "typescript" || targetLang === "javascript"
    ? unwrapRedundantTsParens(emittedFn)
    : emittedFn;
}

/**
 * Surgically splices an already-expanded AIL FunctionDecl or MethodDecl into a native source string,
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
  const spanInfo =
    targetLang === "python"
      ? locatePythonDeclarationSpan(nativeSource, symbolSelector, explicitClassName)
      : locateTsDeclarationSpan(nativeSource, symbolSelector, explicitClassName);

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
    },
  );

  const indented = indentCode(emittedUnindented, spanInfo.declIndent);
  return `${nativeSource.slice(0, spanInfo.declStart)}${indented}${nativeSource.slice(spanInfo.declEnd)}`;
}

function isPureNativeTsSnippetWithoutIdioms(
  snippet: string,
  className?: string,
): boolean {
  const trimmed = snippet.trim();
  if (trimmed.includes("$") || trimmed.includes(":=") || /\bret\b/.test(trimmed)) {
    return false;
  }
  if (/^(?:pub\s+|public\s+|private\s+|protected\s+|static\s+|async\s+)*fn\b/.test(trimmed)) {
    return false;
  }
  if (!trimmed.includes("{") || !trimmed.endsWith("}")) {
    return false;
  }
  const wrapped = className ? `class ${className} {\n${trimmed}\n}` : trimmed;
  const sf = ts.createSourceFile(
    "check.ts",
    wrapped,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const diags = (sf as unknown as { parseDiagnostics?: unknown[] }).parseDiagnostics;
  return !diags || diags.length === 0;
}

function normalizeFrankensteinSnippetToAil(
  snippet: string,
): { normalizedAil: string; explicitVisibility?: "public" | "private" | "protected"; isExported?: boolean } {
  const lines = snippet.trim().split("\n");
  let explicitVisibility: "public" | "private" | "protected" | undefined;
  let isExported: boolean | undefined;

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
    }

    // Also normalize TS-style header without `fn`: e.g. `pub computeMetric(x: number): number {`
    if (
      !/^\s*(?:pub\s+)?(?:static\s+)?(?:async\s+)?fn\b/.test(header) &&
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
    normalizedAil: normalizedLines.join("\n"),
    explicitVisibility,
    isExported,
  };
}

function convertFrankensteinToNativeForDecompile(
  snippet: string,
  targetLang: TargetLanguage,
  isBodyOnly = false,
): string {
  const lines = snippet.trim().split("\n");
  if (targetLang === "python") {
    return lines
      .map((line, idx) => {
        let out = line.replace(/\$([A-Za-z_][A-Za-z0-9_]*)\s*\(/g, "__ail_idiom__$1(");
        if (idx === 0 && !isBodyOnly) {
          out = out.replace(/^(\s*)(?:pub\s+)?(async\s+)?fn\s+/, "$1$2def ");
        }
        out = out
          .replace(/^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:\s*[^=]+?\s*::?=\s*(.+)$/, "$1$2 = $3")
          .replace(/^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*::?=\s*(.+)$/, "$1$2 = $3")
          .replace(/^(\s*)ret\b/, "$1return");
        return out;
      })
      .join("\n");
  }

  return lines
    .map((line, idx) => {
      let out = line;
      if (idx === 0 && !isBodyOnly) {
        out = out
          .replace(/^(\s*)pub\s+fn\s+/, "$1public ")
          .replace(/^(\s*)fn\s+/, "$1function ")
          .replace(/\)\s*->\s*([^{:]+)\s*\{\s*$/, "): $1 {");
      }
      out = out
        .replace(/^(\s*)([A-Za-z_$][A-Za-z0-9_$]*)\s*:\s*([^=]+?)\s*:=\s*(.+)$/, "$1const $2: $3 = $4")
        .replace(/^(\s*)([A-Za-z_$][A-Za-z0-9_$]*)\s*:=\s*(.+)$/, "$1const $2 = $3")
        .replace(/^(\s*)([A-Za-z_$][A-Za-z0-9_$]*)\s*:\s*([^=]+?)\s*::=\s*(.+)$/, "$1let $2: $3 = $4")
        .replace(/^(\s*)([A-Za-z_$][A-Za-z0-9_$]*)\s*::=\s*(.+)$/, "$1let $2 = $3")
        .replace(/^(\s*)ret\b/, "$1return");
      return out;
    })
    .join("\n");
}

function restorePythonIdiomPlaceholders(ailSource: string): string {
  return ailSource.replace(/__ail_idiom__([A-Za-z_][A-Za-z0-9_]*)/g, "$$$1");
}

function parseSnippetToExpandedDecl(
  rawSnippet: string,
  filePath: string,
  targetLang: TargetLanguage,
  className?: string,
  idioms?: Record<string, ProjectIdiomDefinition>,
  originalSnippet?: string,
  isBodyOnly?: boolean,
): { decl: FunctionDecl | MethodDecl; explicitVisibility?: "public" | "private" | "protected"; isExported?: boolean } {
  const { normalizedAil, explicitVisibility, isExported } =
    normalizeFrankensteinSnippetToAil(rawSnippet);

  let parsedMod: Module | undefined;
  let lastErr: unknown;

  // Attempt 1: If not explicitly body-only, try parsing as a full function/method declaration
  if (!isBodyOnly) {
    try {
      parsedMod = parse(normalizedAil, filePath);
    } catch (err) {
      lastErr = err;
    }
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
      const wrappedBodyAil = `fn __body_holder__():\n${indentCode(bodyLines.join("\n"), "  ")}`;
      const bodyMod = parse(wrappedBodyAil, filePath);
      const expandedBodyMod =
        idioms && Object.keys(idioms).length > 0
          ? expandModuleIdioms(bodyMod, idioms)
          : bodyMod;
      holderFn = expandedBodyMod.items.find(
        (it): it is FunctionDecl => it.kind === "FunctionDecl" && it.name === "__body_holder__",
      );
    } catch (bodyErr) {
      lastErr = lastErr ?? bodyErr;
      try {
        const nativeBody = convertFrankensteinToNativeForDecompile(rawSnippet, targetLang, true);
        const wrappedNativeBody =
          targetLang === "python"
            ? `def __body_holder__():\n${indentCode(nativeBody, "    ")}\n`
            : `function __body_holder__() {\n${indentCode(nativeBody, "  ")}\n}\n`;
        const decompBody = decompile(wrappedNativeBody, targetLang, { filePath });
        const restoredAil = restorePythonIdiomPlaceholders(decompBody.ail);
        const bodyMod = parse(restoredAil, filePath);
        const expandedBodyMod =
          idioms && Object.keys(idioms).length > 0
            ? expandModuleIdioms(bodyMod, idioms)
            : bodyMod;
        holderFn = expandedBodyMod.items.find(
          (it): it is FunctionDecl => it.kind === "FunctionDecl" && it.name === "__body_holder__",
        );
      } catch {
        // fall through
      }
    }

    if (holderFn) {
      try {
        const wrappedOrig =
          className && (targetLang === "typescript" || targetLang === "javascript")
            ? `class ${className} {\n${originalSnippet}\n}`
            : originalSnippet;
        const origDecomp = decompile(wrappedOrig, targetLang, { filePath });
        const origMod = parse(origDecomp.ail, filePath);

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
      const preparedNative = convertFrankensteinToNativeForDecompile(
        rawSnippet,
        targetLang,
        false,
      );
      const wrappedNative =
        className && (targetLang === "typescript" || targetLang === "javascript")
          ? `class ${className} {\n${preparedNative}\n}`
          : preparedNative;
      const decomp = decompile(wrappedNative, targetLang, { filePath });
      const restoredAil = restorePythonIdiomPlaceholders(decomp.ail);
      parsedMod = parse(restoredAil, filePath);
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
    idioms && Object.keys(idioms).length > 0
      ? expandModuleIdioms(parsedMod, idioms)
      : parsedMod;

  for (const item of expandedMod.items) {
    if (item.kind === "FunctionDecl" && item.name !== "__top_level__") {
      return { decl: item, explicitVisibility, isExported };
    }
    if (item.kind === "ClassDecl" && item.methods.length > 0) {
      return { decl: item.methods[0], explicitVisibility, isExported };
    }
  }

  throw new Error(`No valid function or method declaration found in splice snippet for ${filePath}`);
}

function spliceNativeSource(
  nativeSource: string,
  options: SpliceOptions,
  filePath: string,
  idioms?: Record<string, ProjectIdiomDefinition>,
): SpliceResult {
  const targetLang = detectTargetFromPath(filePath);
  const targetSymbol = options.symbol;

  if (!targetSymbol) {
    throw new Error("Must specify target symbol with --symbol when splicing native file");
  }

  const spanInfo =
    targetLang === "python"
      ? locatePythonDeclarationSpan(nativeSource, targetSymbol)
      : locateTsDeclarationSpan(nativeSource, targetSymbol);

  if (!spanInfo) {
    throw new Error(`Symbol '${targetSymbol}' not found in ${filePath}`);
  }

  const originalSnippet = nativeSource.slice(spanInfo.declStart, spanInfo.declEnd);
  let newSnippet = "";
  let modifiedCode = nativeSource;

  if (options.delete) {
    const delStart = spanInfo.fullDeclStart ?? spanInfo.declStart;
    let delEnd = spanInfo.declEnd;
    if (nativeSource[delEnd] === "\r" && nativeSource[delEnd + 1] === "\n") delEnd += 2;
    else if (nativeSource[delEnd] === "\n") delEnd += 1;
    modifiedCode = `${nativeSource.slice(0, delStart)}${nativeSource.slice(delEnd)}`;
  } else {
    const rawSnippet = options.code ?? options.body ?? "";
    if (!rawSnippet.trim()) {
      throw new Error("Must provide non-empty --code or --body when splicing native file");
    }

    const replaceStart = rawSnippet.trimStart().startsWith("@")
      ? (spanInfo.fullDeclStart ?? spanInfo.declStart)
      : spanInfo.declStart;

    if (
      options.code !== undefined &&
      (targetLang === "typescript" || targetLang === "javascript") &&
      isPureNativeTsSnippetWithoutIdioms(rawSnippet, spanInfo.className)
    ) {
      newSnippet = indentCode(rawSnippet.trim(), spanInfo.declIndent);
      modifiedCode = `${nativeSource.slice(0, replaceStart)}${newSnippet}${nativeSource.slice(spanInfo.declEnd)}`;
    } else {
      const { decl, explicitVisibility, isExported } = parseSnippetToExpandedDecl(
        rawSnippet,
        filePath,
        targetLang,
        spanInfo.className,
        idioms,
        originalSnippet,
        options.body !== undefined && options.code === undefined,
      );

      const emittedUnindented = emitExpandedDeclForTarget(
        decl,
        targetLang,
        filePath,
        spanInfo.className,
        {
          visibility: spanInfo.visibility ?? explicitVisibility,
          isExported: spanInfo.isExported ?? isExported,
          isStatic: spanInfo.isStatic,
          isAsync: spanInfo.isAsync,
        },
      );

      newSnippet = indentCode(emittedUnindented, spanInfo.declIndent);
      modifiedCode = `${nativeSource.slice(0, replaceStart)}${newSnippet}${nativeSource.slice(spanInfo.declEnd)}`;
    }
  }

  let diff: string | undefined;
  if (options.diff) {
    diff = generateUnifiedDiff(filePath, nativeSource, modifiedCode);
  }

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
    tokensSaved,
  };
}

/**
 * Executes AST surgical splice on a file with optional atomic disk write and re-compilation.
 * Supports both `.ail` files and Twinless Direct-to-Native files (`.ts`, `.py`, etc. with zero `.ail` files on disk).
 */
export async function splice(filePath: string, options: SpliceOptions = {}): Promise<SpliceResult> {
  const baseDir = options.projectRoot ? path.resolve(options.projectRoot) : process.cwd();
  const fullPath = path.isAbsolute(filePath) ? filePath : path.resolve(baseDir, filePath);
  let targetAilPath = fullPath;
  let isTwinlessNative = false;

  if (!fs.existsSync(fullPath)) {
    throw new Error(`Source file not found: ${filePath}`);
  }

  // If path is a non-.ail target file, check for companion .ail file
  if (!fullPath.endsWith(".ail")) {
    const companion = `${fullPath}.ail`;
    const shortCompanion = fullPath.replace(/\.[^.]+$/, ".ail");
    if (fs.existsSync(companion)) {
      targetAilPath = companion;
    } else if (fs.existsSync(shortCompanion)) {
      targetAilPath = shortCompanion;
    } else {
      isTwinlessNative = true;
    }
  }

  const root = options.projectRoot || findProjectRoot(path.dirname(fullPath), process.cwd());
  const config = loadProjectConfig(root);

  if (isTwinlessNative) {
    const originalNative = await fs.promises.readFile(fullPath, "utf-8");
    const result = spliceNativeSource(originalNative, options, fullPath, config.idioms);

    if (!options.dryRun) {
      const dir = path.dirname(fullPath);
      const tmpFile = path.join(
        dir,
        `.${path.basename(fullPath)}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
      );
      await fs.promises.writeFile(tmpFile, result.modifiedCode, "utf-8");
      await fs.promises.rename(tmpFile, fullPath);
    }

    return result;
  }

  const originalSource = await fs.promises.readFile(targetAilPath, "utf-8");
  const result = spliceSource(originalSource, options, targetAilPath);

  // Write atomically to disk unless dryRun
  if (!options.dryRun) {
    const dir = path.dirname(targetAilPath);
    const tmpFile = path.join(
      dir,
      `.${path.basename(targetAilPath)}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
    );
    await fs.promises.writeFile(tmpFile, result.modifiedCode, "utf-8");
    await fs.promises.rename(tmpFile, targetAilPath);
  }

  // Automatically trigger compilation if requested
  if (options.compile) {
    const resolvedTarget = resolveTargetOutputPathForConfig(targetAilPath, config, root);
    const outPath = path.isAbsolute(resolvedTarget)
      ? resolvedTarget
      : path.resolve(root, resolvedTarget);

    const { ast: mod, trivia } = parseWithTrivia(result.modifiedCode, targetAilPath);
    const expandedMod = config?.idioms ? expandModuleIdioms(mod, config.idioms) : mod;
    const checker = new TypeChecker();
    checker.checkModule(expandedMod);

    let targetLang: TargetLanguage;
    const base = path.basename(targetAilPath);
    const withoutAil = base.endsWith(".ail") ? base.slice(0, -4) : base;
    const innerExt = path.extname(withoutAil).toLowerCase();
    if (innerExt && KNOWN_TARGET_EXTENSIONS.has(innerExt)) {
      targetLang = detectTargetFromPath(targetAilPath);
    } else {
      targetLang = config.targetLanguage ?? detectTargetFromPath(targetAilPath);
    }

    const emitted = emitTarget(expandedMod, targetLang, {
      trivia,
      watermark: config.watermark,
      idioms: config.idioms,
    });

    safeWriteTargetFile(outPath, emitted);
  }

  return result;
}

/**
 * Executes a batch of splices across one or more files atomically.
 * If any splice item in the batch fails, all modified files are rolled back to their exact original bytes.
 */
export async function spliceBatch(
  items: BatchSpliceItem[],
  options: BatchSpliceOptions = {},
): Promise<BatchSpliceResult> {
  const baseDir = options.projectRoot ? path.resolve(options.projectRoot) : process.cwd();
  const backups = new Map<string, string>();

  // Snapshot original contents of all existing target files before applying any changes
  for (const item of items) {
    const fullPath = path.isAbsolute(item.filePath)
      ? item.filePath
      : path.resolve(baseDir, item.filePath);
    if (fs.existsSync(fullPath) && !backups.has(fullPath)) {
      backups.set(fullPath, fs.readFileSync(fullPath, "utf-8"));
    }
    const companion = `${fullPath}.ail`;
    if (fs.existsSync(companion) && !backups.has(companion)) {
      backups.set(companion, fs.readFileSync(companion, "utf-8"));
    }
  }

  const results: SpliceResult[] = [];
  const modifiedSet = new Set<string>();

  try {
    for (const item of items) {
      const res = await splice(item.filePath, {
        ...item,
        projectRoot: item.projectRoot ?? options.projectRoot,
        dryRun: item.dryRun ?? options.dryRun,
        compile: item.compile ?? options.compile,
      });
      results.push(res);
      modifiedSet.add(res.filePath);
    }
  } catch (err) {
    // Atomic rollback of all touched files!
    if (!options.dryRun) {
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
