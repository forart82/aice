/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AIL 2.0 AST Surgical Splice Engine (Step 19).
 * Enables surgical AST modifications achieving 90%+ output token reduction for AI contexts.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  findProjectRoot,
  KNOWN_TARGET_EXTENSIONS,
  loadProjectConfig,
  resolveTargetOutputPathForConfig,
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
import { parseWithTrivia } from "../core/parser.js";
import { detectTargetFromPath, emitTarget, type TargetLanguage } from "../emitters/index.js";
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
function getStatementEndOffset(stmt: Statement, source: string): number {
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
function getNodeEndOffset(node: SpliceNode, source: string): number {
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

/**
 * Executes AST surgical splice on a file with optional atomic disk write and re-compilation.
 */
export async function splice(filePath: string, options: SpliceOptions = {}): Promise<SpliceResult> {
  const fullPath = path.resolve(process.cwd(), filePath);
  let targetAilPath = fullPath;

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
    }
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
    const root = options.projectRoot || findProjectRoot(path.dirname(targetAilPath), process.cwd());
    const config = loadProjectConfig(root);
    const resolvedTarget = resolveTargetOutputPathForConfig(targetAilPath, config, root);
    const outPath = path.isAbsolute(resolvedTarget)
      ? resolvedTarget
      : path.resolve(root, resolvedTarget);

    const { ast: mod, trivia } = parseWithTrivia(result.modifiedCode, targetAilPath);
    const checker = new TypeChecker();
    checker.checkModule(mod);

    let targetLang: TargetLanguage;
    const base = path.basename(targetAilPath);
    const withoutAil = base.endsWith(".ail") ? base.slice(0, -4) : base;
    const innerExt = path.extname(withoutAil).toLowerCase();
    if (innerExt && KNOWN_TARGET_EXTENSIONS.has(innerExt)) {
      targetLang = detectTargetFromPath(targetAilPath);
    } else {
      targetLang = config.targetLanguage ?? detectTargetFromPath(targetAilPath);
    }

    const emitted = emitTarget(mod, targetLang, {
      trivia,
      watermark: config.watermark,
    });

    safeWriteTargetFile(outPath, emitted);
  }

  return result;
}
