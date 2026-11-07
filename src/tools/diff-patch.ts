/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AICE 2.0 Semantic AST Diff & Patch Engine (Step 22).
 * Provides structural AST diffs, concise semantic summaries, unified diffs,
 * and deterministic, reversible patch application with zero corruption guarantee.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  findProjectRoot,
  KNOWN_TARGET_EXTENSIONS,
  loadProjectConfig,
} from "../config/index.js";
import type { Block, Module } from "../core/ast.js";
import { parse, parseWithTrivia } from "../core/parser.js";
import { type Span } from "../core/span.js";
import { detectTargetFromPath, emitTarget, type TargetLanguage } from "../emitters/index.js";
import { TypeChecker } from "../typechecker/checker.js";
import {
  findSpliceTargetSymbol,
  generateUnifiedDiff,
  getLineEnd,
  getNodeEndOffset,
  getStatementEndOffset,
  spliceSource,
} from "./splice.js";

export type SymbolChangeType = "added" | "removed" | "modified" | "unchanged";

export interface SymbolDiffEntry {
  name: string;
  kind: string;
  change: SymbolChangeType;
  oldSpan?: Span;
  newSpan?: Span;
  oldSnippet?: string;
  newSnippet?: string;
}

export interface DiffOptions {
  oldPath?: string;
  newPath?: string;
  unified?: boolean;
  ast?: boolean;
  json?: boolean;
  projectRoot?: string;
  context?: number;
}

export interface SemanticDiffResult {
  oldPath?: string;
  newPath?: string;
  changes: SymbolDiffEntry[];
  unifiedDiff: string;
  semanticSummary: string;
  json?: any;
}

export interface PatchOptions {
  dryRun?: boolean;
  reverse?: boolean;
  compile?: boolean;
  projectRoot?: string;
}

export interface PatchResult {
  success: boolean;
  filePath: string;
  modifiedSource: string;
  appliedHunks: number;
  totalHunks: number;
  diff?: string;
}

interface ExtractedSymbol {
  name: string;
  kind: string;
  span?: Span;
  snippet: string;
  headerSnippet?: string;
  parent?: string;
}

/**
 * Extracts all declaration symbols from an AST Module with corresponding text snippets.
 */
function extractModuleSymbols(ast: Module, source: string): ExtractedSymbol[] {
  const symbols: ExtractedSymbol[] = [];

  for (const item of ast.items) {
    switch (item.kind) {
      case "FunctionDecl": {
        if (item.name === "__top_level__") {
          const block = item.body as Block;
          if (block?.statements) {
            for (const stmt of block.statements) {
              if (stmt.kind === "LetBinding") {
                const start = stmt.span?.start?.offset ?? 0;
                const end = getStatementEndOffset(stmt, source);
                const snippet = source.slice(start, getLineEnd(source, end)).trim();
                symbols.push({
                  name: stmt.name,
                  kind: "statement",
                  span: stmt.span,
                  snippet,
                });
              }
            }
          }
          break;
        }

        const start = item.span?.start?.offset ?? 0;
        const end = getNodeEndOffset(item, source);
        const snippet = source.slice(start, getLineEnd(source, end)).trim();
        symbols.push({
          name: item.name,
          kind: "function",
          span: item.span,
          snippet,
        });
        break;
      }

      case "ClassDecl": {
        const start = item.span?.start?.offset ?? 0;
        const end = getNodeEndOffset(item, source);
        const snippet = source.slice(start, getLineEnd(source, end)).trim();

        // Extract class header without methods/properties
        const colonIdx = source.indexOf(":", start);
        const headerSnippet =
          colonIdx !== -1 && colonIdx < start + 300
            ? source.slice(start, colonIdx + 1).trim()
            : `class ${item.name}:`;

        symbols.push({
          name: item.name,
          kind: "class",
          span: item.span,
          snippet,
          headerSnippet,
        });

        // Class properties
        for (const p of item.properties || []) {
          const pStart = p.span?.start?.offset ?? start;
          const pEnd = getNodeEndOffset(p, source);
          const pSnippet = source.slice(pStart, getLineEnd(source, pEnd)).trim();
          symbols.push({
            name: `${item.name}.${p.name}`,
            kind: "property",
            span: p.span,
            snippet: pSnippet,
            parent: item.name,
          });
        }

        // Class methods
        for (const m of item.methods || []) {
          const mStart = m.span?.start?.offset ?? start;
          const mEnd = getNodeEndOffset(m, source);
          const mSnippet = source.slice(mStart, getLineEnd(source, mEnd)).trim();
          symbols.push({
            name: `${item.name}.${m.name}`,
            kind: "method",
            span: m.span,
            snippet: mSnippet,
            parent: item.name,
          });
        }
        break;
      }

      case "TypeDecl": {
        const start = item.span?.start?.offset ?? 0;
        const end = getNodeEndOffset(item, source);
        const snippet = source.slice(start, getLineEnd(source, end)).trim();

        if (item.isEnum) {
          const colonIdx = source.indexOf(":", start);
          const headerSnippet =
            colonIdx !== -1 && colonIdx < start + 300
              ? source.slice(start, colonIdx + 1).trim()
              : `enum ${item.name}:`;

          symbols.push({
            name: item.name,
            kind: "enum",
            span: item.span,
            snippet,
            headerSnippet,
          });

          for (const v of item.variants || []) {
            const vStart = v.span?.start?.offset ?? start;
            const vEnd = v.span?.end?.offset ?? end;
            const vSnippet = source.slice(vStart, getLineEnd(source, vEnd)).trim();
            symbols.push({
              name: `${item.name}.${v.name}`,
              kind: "variant",
              span: v.span,
              snippet: vSnippet,
              parent: item.name,
            });
          }
        } else {
          if (item.aliasType) {
            symbols.push({
              name: item.name,
              kind: "type",
              span: item.span,
              snippet,
              headerSnippet: snippet,
            });
          } else {
            const colonIdx = source.indexOf(":", start);
            const headerSnippet =
              colonIdx !== -1 && colonIdx < start + 300
                ? source.slice(start, colonIdx + 1).trim()
                : `type ${item.name}:`;

            symbols.push({
              name: item.name,
              kind: "type",
              span: item.span,
              snippet,
              headerSnippet,
            });

            for (const f of item.fields || []) {
              const fStart = f.span?.start?.offset ?? start;
              const fEnd = f.span?.end?.offset ?? end;
              const fSnippet = source.slice(fStart, getLineEnd(source, fEnd)).trim();
              symbols.push({
                name: `${item.name}.${f.name}`,
                kind: "field",
                span: f.span,
                snippet: fSnippet,
                parent: item.name,
              });
            }
          }
        }
        break;
      }

      case "ConstDecl": {
        const start = item.span?.start?.offset ?? 0;
        const end = getNodeEndOffset(item, source);
        const snippet = source.slice(start, getLineEnd(source, end)).trim();
        symbols.push({
          name: item.name,
          kind: "const",
          span: item.span,
          snippet,
        });
        break;
      }

      case "VarDecl": {
        const start = item.span?.start?.offset ?? 0;
        const end = getNodeEndOffset(item, source);
        const snippet = source.slice(start, getLineEnd(source, end)).trim();
        symbols.push({
          name: item.name,
          kind: "var",
          span: item.span,
          snippet,
        });
        break;
      }
    }
  }

  return symbols;
}

/**
 * Computes semantic structural AST differences between oldSource and newSource.
 */
export function computeSemanticDiff(
  oldSource: string,
  newSource: string,
  options: DiffOptions = {},
): SemanticDiffResult {
  const filePath = options.newPath || options.oldPath || "source.aice";
  const unifiedDiff = generateUnifiedDiff(filePath, oldSource, newSource, options.context ?? 3);

  let oldAst: Module | undefined;
  let newAst: Module | undefined;

  try {
    oldAst = parse(oldSource);
  } catch {
    // oldSource syntax not parseable
  }

  try {
    newAst = parse(newSource);
  } catch {
    // newSource syntax not parseable
  }

  const changes: SymbolDiffEntry[] = [];

  if (oldAst && newAst) {
    const oldSymbols = extractModuleSymbols(oldAst, oldSource);
    const newSymbols = extractModuleSymbols(newAst, newSource);

    const oldSymbolsMap = new Map<string, ExtractedSymbol>();
    for (const s of oldSymbols) {
      oldSymbolsMap.set(s.name, s);
    }

    const visitedOldNames = new Set<string>();

    for (const newSym of newSymbols) {
      const oldSym = oldSymbolsMap.get(newSym.name);
      if (oldSym) {
        visitedOldNames.add(oldSym.name);

        const isContainer =
          newSym.kind === "class" || (newSym.kind === "type" && Boolean(newSym.headerSnippet));
        const oldCompare = (isContainer ? oldSym.headerSnippet : oldSym.snippet) ?? oldSym.snippet;
        const newCompare = (isContainer ? newSym.headerSnippet : newSym.snippet) ?? newSym.snippet;
        const isUnchanged = oldCompare.trim() === newCompare.trim();

        changes.push({
          name: newSym.name,
          kind: newSym.kind,
          change: isUnchanged ? "unchanged" : "modified",
          oldSpan: oldSym.span,
          newSpan: newSym.span,
          oldSnippet: oldSym.snippet,
          newSnippet: newSym.snippet,
        });
      } else {
        // Added symbol
        changes.push({
          name: newSym.name,
          kind: newSym.kind,
          change: "added",
          newSpan: newSym.span,
          newSnippet: newSym.snippet,
        });
      }
    }

    // Check for removed symbols
    for (const oldSym of oldSymbols) {
      if (!visitedOldNames.has(oldSym.name)) {
        changes.push({
          name: oldSym.name,
          kind: oldSym.kind,
          change: "removed",
          oldSpan: oldSym.span,
          oldSnippet: oldSym.snippet,
        });
      }
    }
  }

  // Generate concise semantic summary text
  const summaryLines: string[] = [];
  for (const entry of changes) {
    if (entry.change === "modified") {
      summaryLines.push(`[~] ${entry.kind} ${entry.name} (modified)`);
    } else if (entry.change === "added") {
      summaryLines.push(`[+] ${entry.kind} ${entry.name} (added)`);
    } else if (entry.change === "removed") {
      summaryLines.push(`[-] ${entry.kind} ${entry.name} (removed)`);
    }
  }

  const semanticSummary = summaryLines.join("\n");

  const json = {
    oldPath: options.oldPath,
    newPath: options.newPath,
    changes,
    semanticSummary,
    hasChanges: changes.some((c) => c.change !== "unchanged"),
  };

  return {
    oldPath: options.oldPath,
    newPath: options.newPath,
    changes,
    unifiedDiff,
    semanticSummary,
    json,
  };
}

/**
 * Extracts a clean symbol identifier name from a semantic patch block header.
 * E.g., '--- Symbol: method GameEngine.step (modified)' -> 'GameEngine.step'
 */
function extractSymbolName(header: string): string {
  let s = header.replace(/^---\s+Symbol:\s*/i, "").trim();
  s = s.replace(
    /^(?:pub\s+|async\s+)*(?:method|function|fn|class|type|enum|const|var|property|field|variant|statement)\s+/i,
    "",
  );
  s = s.replace(/\s*\([^)]*\)$/, "").trim();
  return s;
}

/**
 * Generates an executable semantic symbol patch from a SemanticDiffResult.
 */
export function generateSemanticPatch(diff: SemanticDiffResult): string {
  const blocks: string[] = [];

  for (const entry of diff.changes) {
    if (entry.change === "unchanged") continue;

    if (entry.change === "modified") {
      const lines: string[] = [`--- Symbol: ${entry.kind} ${entry.name}`];
      if (entry.oldSnippet) {
        for (const l of entry.oldSnippet.split(/\r?\n/)) {
          lines.push(`-${l}`);
        }
      }
      if (entry.newSnippet) {
        for (const l of entry.newSnippet.split(/\r?\n/)) {
          lines.push(`+${l}`);
        }
      }
      blocks.push(lines.join("\n"));
    } else if (entry.change === "added") {
      const lines: string[] = [`--- Symbol: ${entry.kind} ${entry.name}`];
      if (entry.newSnippet) {
        for (const l of entry.newSnippet.split(/\r?\n/)) {
          lines.push(`+${l}`);
        }
      }
      blocks.push(lines.join("\n"));
    } else if (entry.change === "removed") {
      const lines: string[] = [`--- Symbol: ${entry.kind} ${entry.name}`];
      if (entry.oldSnippet) {
        for (const l of entry.oldSnippet.split(/\r?\n/)) {
          lines.push(`-${l}`);
        }
      }
      blocks.push(lines.join("\n"));
    }
  }

  return blocks.join("\n\n");
}

/**
 * Applies semantic symbol patch blocks to a target source string.
 */
function applySemanticPatch(
  targetSource: string,
  patchText: string,
  options: PatchOptions = {},
): PatchResult {
  const filePath = options.projectRoot ?? "<memory>";
  const rawBlocks = patchText.split(/(?:^|\r?\n)(?=---\s+Symbol:\s*)/i);
  const blocks = rawBlocks.filter((b) => /---\s+Symbol:\s*/i.test(b));

  if (blocks.length === 0) {
    return {
      success: false,
      filePath,
      modifiedSource: targetSource,
      appliedHunks: 0,
      totalHunks: 0,
      diff: "",
    };
  }

  let currentSource = targetSource;
  let appliedHunks = 0;
  const totalHunks = blocks.length;

  for (const block of blocks) {
    const headerMatch = block.match(/^---\s+Symbol:\s*([^\r\n]+)/i);
    if (!headerMatch) continue;

    const rawHeader = headerMatch[1].trim();
    const isDeleteHeader = /\(delete\)/i.test(rawHeader);
    const symbolName = extractSymbolName(rawHeader);

    const blockLines = block.split(/\r?\n/);
    const contentLines = blockLines.slice(1).filter((l) => !/^\+\+\+\s+Symbol:\s*/i.test(l));

    let action: "modify" | "add" | "delete" = "modify";
    let replacementCode = "";

    const hasDiffPrefixes = contentLines.some((l) => l.startsWith("+") || l.startsWith("-"));

    if (hasDiffPrefixes) {
      const plusLines = contentLines
        .filter((l) => l.startsWith("+"))
        .map((l) => l.slice(1));
      const minusLines = contentLines
        .filter((l) => l.startsWith("-"))
        .map((l) => l.slice(1));

      if (options.reverse) {
        if (minusLines.length > 0 && plusLines.length > 0) {
          action = "modify";
          replacementCode = minusLines.join("\n");
        } else if (plusLines.length > 0 && minusLines.length === 0) {
          action = "delete";
        } else if (minusLines.length > 0 && plusLines.length === 0) {
          action = "add";
          replacementCode = minusLines.join("\n");
        } else {
          action = "modify";
          replacementCode = minusLines.join("\n");
        }
      } else {
        if (isDeleteHeader || (minusLines.length > 0 && plusLines.length === 0)) {
          action = "delete";
        } else if (plusLines.length > 0 && minusLines.length === 0) {
          action = "add";
          replacementCode = plusLines.join("\n");
        } else {
          action = "modify";
          replacementCode = plusLines.join("\n");
        }
      }
    } else {
      // Raw code block
      replacementCode = contentLines.join("\n").trim();
      action = isDeleteHeader ? "delete" : "modify";
    }

    try {
      const ast = parse(currentSource);
      const symInfo = findSpliceTargetSymbol(ast, symbolName);

      if (action === "delete") {
        if (symInfo) {
          const res = spliceSource(currentSource, { symbol: symbolName, delete: true }, filePath);
          currentSource = res.modifiedCode;
        }
        appliedHunks++;
      } else if (action === "add") {
        if (symInfo) {
          const res = spliceSource(
            currentSource,
            { symbol: symbolName, code: replacementCode },
            filePath,
          );
          currentSource = res.modifiedCode;
          appliedHunks++;
        } else {
          if (symbolName.includes(".") || symbolName.includes("::")) {
            const parentName = symbolName.split(/\.|::/)[0];
            const parentSym = findSpliceTargetSymbol(ast, parentName);
            if (
              parentSym &&
              (parentSym.kind === "class" || parentSym.kind === "type" || parentSym.kind === "enum")
            ) {
              const res = spliceSource(
                currentSource,
                { symbol: parentName, append: true, code: replacementCode },
                filePath,
              );
              currentSource = res.modifiedCode;
              appliedHunks++;
            } else {
              const res = spliceSource(
                currentSource,
                { append: true, code: replacementCode },
                filePath,
              );
              currentSource = res.modifiedCode;
              appliedHunks++;
            }
          } else {
            const res = spliceSource(
              currentSource,
              { append: true, code: replacementCode },
              filePath,
            );
            currentSource = res.modifiedCode;
            appliedHunks++;
          }
        }
      } else {
        // modify
        if (symInfo) {
          const res = spliceSource(
            currentSource,
            { symbol: symbolName, code: replacementCode },
            filePath,
          );
          currentSource = res.modifiedCode;
          appliedHunks++;
        } else {
          if (symbolName.includes(".") || symbolName.includes("::")) {
            const parentName = symbolName.split(/\.|::/)[0];
            const parentSym = findSpliceTargetSymbol(ast, parentName);
            if (
              parentSym &&
              (parentSym.kind === "class" || parentSym.kind === "type" || parentSym.kind === "enum")
            ) {
              const res = spliceSource(
                currentSource,
                { symbol: parentName, append: true, code: replacementCode },
                filePath,
              );
              currentSource = res.modifiedCode;
              appliedHunks++;
            } else {
              const res = spliceSource(
                currentSource,
                { append: true, code: replacementCode },
                filePath,
              );
              currentSource = res.modifiedCode;
              appliedHunks++;
            }
          } else {
            const res = spliceSource(
              currentSource,
              { append: true, code: replacementCode },
              filePath,
            );
            currentSource = res.modifiedCode;
            appliedHunks++;
          }
        }
      }
    } catch {
      // Hunk application failed
    }
  }

  // Zero-corruption guarantee: validate syntax of resulting code
  try {
    parse(currentSource);
    const success = appliedHunks === totalHunks && appliedHunks > 0;
    return {
      success,
      filePath,
      modifiedSource: success ? currentSource : targetSource,
      appliedHunks,
      totalHunks,
      diff: generateUnifiedDiff(filePath, targetSource, currentSource),
    };
  } catch {
    return {
      success: false,
      filePath,
      modifiedSource: targetSource, // revert to original
      appliedHunks: 0,
      totalHunks,
      diff: "",
    };
  }
}

/**
 * Applies standard unified diff hunks to a target source string.
 */
function applyUnifiedDiff(
  targetSource: string,
  patchText: string,
  options: PatchOptions = {},
): PatchResult {
  const filePath = options.projectRoot ?? "<memory>";
  const patchLines = patchText.split(/\r?\n/);
  const lineEnding = targetSource.includes("\r\n") ? "\r\n" : "\n";
  const sourceLines = targetSource.split(/\r?\n/);

  const hunkRegex = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

  interface Hunk {
    oldStart: number;
    oldCount: number;
    newStart: number;
    newCount: number;
    lines: string[];
  }

  const hunks: Hunk[] = [];
  let currentHunk: Hunk | null = null;

  for (const line of patchLines) {
    const match = line.match(hunkRegex);
    if (match) {
      if (currentHunk) hunks.push(currentHunk);
      currentHunk = {
        oldStart: Number.parseInt(match[1], 10),
        oldCount: match[2] !== undefined ? Number.parseInt(match[2], 10) : 1,
        newStart: Number.parseInt(match[3], 10),
        newCount: match[4] !== undefined ? Number.parseInt(match[4], 10) : 1,
        lines: [],
      };
    } else if (
      currentHunk &&
      (line.startsWith("-") || line.startsWith("+") || line.startsWith(" ") || line === "")
    ) {
      currentHunk.lines.push(line === "" ? " " : line);
    }
  }
  if (currentHunk) hunks.push(currentHunk);

  if (hunks.length === 0) {
    return {
      success: false,
      filePath,
      modifiedSource: targetSource,
      appliedHunks: 0,
      totalHunks: 0,
      diff: "",
    };
  }

  // If reverse: swap old and new parameters and invert line prefixes
  const normalizedHunks = hunks.map((h) => {
    if (!options.reverse) return h;
    const invLines = h.lines.map((l) => {
      if (l.startsWith("+")) return `-${l.slice(1)}`;
      if (l.startsWith("-")) return `+${l.slice(1)}`;
      return l;
    });
    return {
      oldStart: h.newStart,
      oldCount: h.newCount,
      newStart: h.oldStart,
      newCount: h.oldCount,
      lines: invLines,
    };
  });

  // Sort hunks by starting line descending (bottom to top)
  normalizedHunks.sort((a, b) => b.oldStart - a.oldStart);

  let appliedHunks = 0;
  const totalHunks = normalizedHunks.length;

  for (const hunk of normalizedHunks) {
    const expectedOldLines: string[] = [];
    const replacementLines: string[] = [];

    for (const hl of hunk.lines) {
      if (hl.startsWith("-")) {
        expectedOldLines.push(hl.slice(1));
      } else if (hl.startsWith("+")) {
        replacementLines.push(hl.slice(1));
      } else if (hl.startsWith(" ")) {
        expectedOldLines.push(hl.slice(1));
        replacementLines.push(hl.slice(1));
      }
    }

    const idealIdx = Math.max(0, hunk.oldStart - 1);
    let targetIdx = -1;

    if (expectedOldLines.length === 0) {
      targetIdx = idealIdx;
    } else {
      // Check exact position
      let matches = true;
      for (let k = 0; k < expectedOldLines.length; k++) {
        if (sourceLines[idealIdx + k] !== expectedOldLines[k]) {
          matches = false;
          break;
        }
      }

      if (matches) {
        targetIdx = idealIdx;
      } else {
        // Fuzzy search window [-15, +15]
        const minIdx = Math.max(0, idealIdx - 15);
        const maxIdx = Math.min(sourceLines.length - expectedOldLines.length, idealIdx + 15);

        for (let candidate = minIdx; candidate <= maxIdx; candidate++) {
          let candMatches = true;
          for (let k = 0; k < expectedOldLines.length; k++) {
            if (sourceLines[candidate + k] !== expectedOldLines[k]) {
              candMatches = false;
              break;
            }
          }
          if (candMatches) {
            targetIdx = candidate;
            break;
          }
        }
      }
    }

    if (targetIdx !== -1) {
      const deleteCount = expectedOldLines.length;
      sourceLines.splice(targetIdx, deleteCount, ...replacementLines);
      appliedHunks++;
    }
  }

  if (appliedHunks !== totalHunks || appliedHunks === 0) {
    return {
      success: false,
      filePath,
      modifiedSource: targetSource,
      appliedHunks,
      totalHunks,
      diff: "",
    };
  }

  const modified = sourceLines.join(lineEnding);

  // Validate AST
  try {
    parse(modified);
    return {
      success: true,
      filePath,
      modifiedSource: modified,
      appliedHunks,
      totalHunks,
      diff: generateUnifiedDiff(filePath, targetSource, modified),
    };
  } catch {
    return {
      success: false,
      filePath,
      modifiedSource: targetSource, // revert
      appliedHunks: 0,
      totalHunks,
      diff: "",
    };
  }
}

/**
 * Applies a unified diff or semantic AST symbol patch to a target source string.
 */
export function applyPatch(
  targetSource: string,
  patchText: string,
  options: PatchOptions = {},
): PatchResult {
  const filePath = options.projectRoot ?? "<memory>";
  if (!patchText || patchText.trim().length === 0) {
    return {
      success: true,
      filePath,
      modifiedSource: targetSource,
      appliedHunks: 0,
      totalHunks: 0,
      diff: "",
    };
  }

  const isSemantic = /(?:^|\r?\n)---\s+Symbol:\s*[^\r\n]+/i.test(patchText);

  if (isSemantic) {
    return applySemanticPatch(targetSource, patchText, options);
  }
  return applyUnifiedDiff(targetSource, patchText, options);
}

/**
 * Computes semantic AST diff between two files on disk, or against git HEAD if newPath is omitted.
 */
export async function diffFiles(
  oldPath: string,
  newPath?: string,
  options: DiffOptions = {},
): Promise<SemanticDiffResult> {
  const resolvedOldPath = path.resolve(process.cwd(), oldPath);
  let oldSource = "";
  let newSource = "";
  let actualOldPath = oldPath;
  let actualNewPath = newPath ?? oldPath;

  if (newPath) {
    const resolvedNewPath = path.resolve(process.cwd(), newPath);
    if (!fs.existsSync(resolvedOldPath)) {
      throw new Error(`File not found: ${oldPath}`);
    }
    if (!fs.existsSync(resolvedNewPath)) {
      throw new Error(`File not found: ${newPath}`);
    }
    oldSource = await fs.promises.readFile(resolvedOldPath, "utf-8");
    newSource = await fs.promises.readFile(resolvedNewPath, "utf-8");
  } else {
    if (!fs.existsSync(resolvedOldPath)) {
      throw new Error(`File not found: ${oldPath}`);
    }
    newSource = await fs.promises.readFile(resolvedOldPath, "utf-8");

    try {
      const gitRoot =
        options.projectRoot || findProjectRoot(path.dirname(resolvedOldPath), process.cwd());
      const relPath = path.relative(gitRoot, resolvedOldPath).replace(/\\/g, "/");
      const gitRes = spawnSync("git", ["show", `HEAD:${relPath}`], {
        cwd: gitRoot,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      if (gitRes.status === 0 && typeof gitRes.stdout === "string") {
        oldSource = gitRes.stdout;
        actualOldPath = `HEAD:${relPath}`;
      } else {
        const bakFile = `${resolvedOldPath}.bak`;
        const origFile = `${resolvedOldPath}.orig`;
        if (fs.existsSync(bakFile)) {
          oldSource = await fs.promises.readFile(bakFile, "utf-8");
          actualOldPath = `${oldPath}.bak`;
        } else if (fs.existsSync(origFile)) {
          oldSource = await fs.promises.readFile(origFile, "utf-8");
          actualOldPath = `${oldPath}.orig`;
        } else {
          oldSource = newSource;
        }
      }
    } catch {
      oldSource = newSource;
    }
  }

  return computeSemanticDiff(oldSource, newSource, {
    ...options,
    oldPath: actualOldPath,
    newPath: actualNewPath,
  });
}

/**
 * Applies a unified diff or semantic AST symbol patch to a file on disk.
 * Atomically writes to disk unless dryRun is set, and re-compiles target if compile is requested.
 */
export async function patchFile(
  targetPath: string,
  patchText: string,
  options: PatchOptions = {},
): Promise<PatchResult> {
  const fullPath = path.resolve(process.cwd(), targetPath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Target file not found: ${targetPath}`);
  }

  const originalSource = await fs.promises.readFile(fullPath, "utf-8");
  const result = applyPatch(originalSource, patchText, {
    ...options,
    projectRoot: fullPath,
  });

  result.filePath = fullPath;

  if (result.success && !options.dryRun) {
    const dir = path.dirname(fullPath);
    const tmpFile = path.join(
      dir,
      `.${path.basename(fullPath)}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
    );
    await fs.promises.writeFile(tmpFile, result.modifiedSource, "utf-8");
    await fs.promises.rename(tmpFile, fullPath);

    if (options.compile && fullPath.endsWith(".aice")) {
      const root =
        options.projectRoot || findProjectRoot(path.dirname(fullPath), process.cwd());
      const config = loadProjectConfig(root);

      const { ast: mod, trivia } = parseWithTrivia(result.modifiedSource, fullPath);
      const checker = new TypeChecker();
      checker.checkModule(mod);

      let targetLang: TargetLanguage;
      const base = path.basename(fullPath);
      const withoutAice = base.endsWith(".aice") ? base.slice(0, -5) : base;
      const innerExt = path.extname(withoutAice).toLowerCase();
      if (innerExt && KNOWN_TARGET_EXTENSIONS.has(innerExt)) {
        targetLang = detectTargetFromPath(fullPath);
      } else {
        targetLang = config.targetLanguage ?? detectTargetFromPath(fullPath);
      }

      const emitted = emitTarget(mod, targetLang, {
        trivia,
        watermark: config.watermark,
      });

      const outPath = fullPath.replace(/\.aice$/, innerExt ? "" : ".ts");
      await fs.promises.writeFile(outPath, emitted, "utf-8");
    }
  }

  return result;
}
