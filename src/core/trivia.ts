/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AICE: Concrete Syntax Tree (CST) Trivia Engine
 * Preserves non-semantic tokens (comments, whitespace, formatting) for lossless roundtrips.
 * Adheres to the formal specification in docs/CST_TRIVIA_SPEC.md.
 */

import type { Span } from "./span.js";

export type TriviaKind =
  | "LINE_COMMENT"
  | "BLOCK_COMMENT"
  | "DOCSTRING"
  | "LICENSE_HEADER"
  | "BLANK_LINES"
  | "INDENTATION";

export interface TriviaItem {
  kind: TriviaKind;
  content: string;
  span?: Span;
}

export interface NodeTrivia {
  nodeId: string;
  leading: TriviaItem[];
  trailing: TriviaItem[];
  indentation?: string;
  blankLinesBefore?: number;
  sourceSlice?: string;
  nodeSnapshot?: string;
  span?: Span;
}

export class CstTriviaTable {
  private entries = new Map<string, NodeTrivia>();
  private originalSource?: string;

  public setTrivia(nodeId: string, trivia: NodeTrivia): void {
    this.entries.set(nodeId, trivia);
  }

  public getTrivia(nodeId: string): NodeTrivia | undefined {
    return this.entries.get(nodeId);
  }

  public addLeadingTrivia(nodeId: string, item: TriviaItem): void {
    const existing = this.getOrCreate(nodeId);
    existing.leading.push(item);
  }

  public addTrailingTrivia(nodeId: string, item: TriviaItem): void {
    const existing = this.getOrCreate(nodeId);
    existing.trailing.push(item);
  }

  public setIndentation(nodeId: string, indent: string): void {
    const existing = this.getOrCreate(nodeId);
    existing.indentation = indent;
  }

  public setBlankLinesBefore(nodeId: string, count: number): void {
    const existing = this.getOrCreate(nodeId);
    existing.blankLinesBefore = count;
  }

  public getOrCreate(nodeId: string): NodeTrivia {
    let entry = this.entries.get(nodeId);
    if (!entry) {
      entry = {
        nodeId,
        leading: [],
        trailing: [],
      };
      this.entries.set(nodeId, entry);
    }
    return entry;
  }

  public getAllEntries(): [string, NodeTrivia][] {
    return Array.from(this.entries.entries());
  }

  public toJSON(): Record<string, NodeTrivia> {
    const result: Record<string, NodeTrivia> = {};
    for (const [key, value] of this.entries.entries()) {
      result[key] = value;
    }
    return result;
  }

  public static fromJSON(json: Record<string, NodeTrivia>): CstTriviaTable {
    const table = new CstTriviaTable();
    for (const [key, value] of Object.entries(json)) {
      table.setTrivia(key, value);
    }
    return table;
  }

  public size(): number {
    return this.entries.size;
  }

  public clear(): void {
    this.entries.clear();
  }

  public setOriginalSource(source: string): void {
    this.originalSource = source;
  }

  public getOriginalSource(): string | undefined {
    return this.originalSource;
  }

  public setSourceSlice(nodeId: string, slice: string, nodeSnapshot?: string, span?: Span): void {
    const existing = this.getOrCreate(nodeId);
    existing.sourceSlice = slice;
    if (nodeSnapshot !== undefined) {
      existing.nodeSnapshot = nodeSnapshot;
    }
    if (span !== undefined) {
      existing.span = span;
    }
  }

  public getSourceSlice(nodeId: string): string | undefined {
    return this.entries.get(nodeId)?.sourceSlice;
  }

  public hasSourceSlice(nodeId: string): boolean {
    return Boolean(this.entries.get(nodeId)?.sourceSlice);
  }

  public getNodeSnapshot(nodeId: string): string | undefined {
    return this.entries.get(nodeId)?.nodeSnapshot;
  }

  public setNodeSnapshot(nodeId: string, snapshot: string): void {
    const existing = this.getOrCreate(nodeId);
    existing.nodeSnapshot = snapshot;
  }
}

/**
 * Creates a structural JSON snapshot of an AST node, excluding non-semantic
 * source location spans to accurately detect structural mutations.
 */
export function createAstNodeSnapshot(node: unknown): string {
  return JSON.stringify(node, (key, value) => {
    if (
      key === "span" ||
      key === "file" ||
      key === "line" ||
      key === "column" ||
      key === "offset"
    ) {
      return undefined;
    }
    return value;
  });
}

/**
 * Derives the canonical CST trivia node ID for an AST node or ModuleItem.
 */
export function getNodeTriviaId(item: unknown): string {
  if (!item || typeof item !== "object" || !("kind" in item)) return "";
  const anyItem = item as { kind: string; name?: string; source?: string };
  switch (anyItem.kind) {
    case "ImportDecl":
      return anyItem.source ? `import:${anyItem.source}` : "";
    case "TypeDecl":
      return anyItem.name ? `type:${anyItem.name}` : "";
    case "ClassDecl":
      return anyItem.name ? `class:${anyItem.name}` : "";
    case "FunctionDecl":
      return anyItem.name ? `fn:${anyItem.name}` : "";
    case "ComponentDecl":
      return anyItem.name ? `component:${anyItem.name}` : "";
    case "ConstDecl":
      return anyItem.name ? `const:${anyItem.name}` : "";
    case "VarDecl":
      return anyItem.name ? `var:${anyItem.name}` : "";
    case "StyleDecl":
      return anyItem.name ? `style:${anyItem.name}` : "";
    default:
      return "";
  }
}
export interface DeclarationTriviaSlice {
  leadingDocComment?: string;
  leadingAttributes?: string[];
  indentation: string;
}

export function extractDeclarationTriviaLens(
  nativeSource: string,
  span: { fullStart: number; declStart: number; end: number },
  lang?: string,
): DeclarationTriviaSlice {
  const normLang = (lang ?? "").toLowerCase();
  const isPython = normLang === "python" || normLang === "py";

  // 1. Detect indentation from line start of declStart
  const beforeDecl = nativeSource.slice(0, span.declStart);
  const lastNl = beforeDecl.lastIndexOf("\n");
  const linePrefix = lastNl >= 0 ? beforeDecl.slice(lastNl + 1) : beforeDecl;
  const indentMatch = linePrefix.match(/^[ \t]*/);
  const indentation = indentMatch ? indentMatch[0] : "";

  // 2. Python docstrings live *inside* the function/class body immediately after the def/class header
  if (isPython) {
    const declBody = nativeSource.slice(span.declStart, span.end);
    const docMatch = declBody.match(
      /^[ \t]*(?:async\s+)?(?:def|class)\s+[^\n]+?:\s*(?:#[^\n]*)?(?:\r?\n[ \t]*)*(?:("""[\s\S]*?"""|'''[\s\S]*?'''))/,
    );
    if (docMatch && docMatch[1]) {
      return {
        leadingDocComment: docMatch[1],
        indentation,
      };
    }
  }

  // 3. For JS/TS, C++, C#, Rust, Go, PHP, etc., look in span.fullStart..span.declStart or immediately before span.declStart
  const leadingRegion = nativeSource.slice(span.fullStart, span.declStart);
  let leadingDocComment: string | undefined;

  const blockDocMatch = leadingRegion.match(/\/\*\*[\s\S]*?\*\//);
  if (blockDocMatch) {
    leadingDocComment = blockDocMatch[0];
  } else {
    const lineDocLines: string[] = [];
    const lines = leadingRegion.split(/\r?\n/);
    for (const l of lines) {
      const trimmed = l.trim();
      if (trimmed.startsWith("///") || trimmed.startsWith("//!")) {
        lineDocLines.push(trimmed);
      }
    }
    if (lineDocLines.length > 0) {
      leadingDocComment = lineDocLines.join("\n");
    }
  }

  if (!leadingDocComment && span.fullStart >= span.declStart) {
    const lookback = nativeSource.slice(Math.max(0, span.declStart - 1000), span.declStart);
    const precedingBlock = lookback.match(/\/\*\*[\s\S]*?\*\/\s*$/);
    if (precedingBlock) {
      leadingDocComment = precedingBlock[0].trim();
    } else {
      const precedingLines = lookback.split(/\r?\n/);
      const docLines: string[] = [];
      for (let i = precedingLines.length - 1; i >= 0; i--) {
        const line = precedingLines[i].trim();
        if (line.startsWith("///") || line.startsWith("//!")) {
          docLines.unshift(line);
        } else if (line.length === 0 && docLines.length === 0) {
        } else {
          break;
        }
      }
      if (docLines.length > 0) {
        leadingDocComment = docLines.join("\n");
      }
    }
  }

  return {
    leadingDocComment,
    indentation,
  };
}

export function applyTriviaLensToReplacement(
  trivia: DeclarationTriviaSlice,
  replacementSnippet: string,
  options?: { preserveDocs?: boolean; lang?: string },
): { mergedSnippet: string; preservedTriviaText: string } {
  if (options?.preserveDocs === false) {
    return { mergedSnippet: replacementSnippet, preservedTriviaText: "" };
  }
  if (replacementSnippet.includes("@replace-docs") || replacementSnippet.includes("@strip-docs")) {
    const cleaned = replacementSnippet
      .replace(/[ \t]*(?:\/\/|#)?\s*@(replace-docs|strip-docs)[ \t]*(?:\r?\n|$)/g, "")
      .trim();
    return { mergedSnippet: cleaned, preservedTriviaText: "" };
  }

  if (!trivia.leadingDocComment) {
    return { mergedSnippet: replacementSnippet, preservedTriviaText: "" };
  }

  const normLang = (options?.lang ?? "").toLowerCase();
  const isPython = normLang === "python" || normLang === "py";

  if (isPython) {
    const hasExistingDoc =
      /^[ \t]*(?:async\s+)?(?:def|class)\s+[^\n]+?:\s*(?:#[^\n]*)?(?:\r?\n[ \t]*)*(?:"""[\s\S]*?"""|'''[\s\S]*?''')/.test(
        replacementSnippet,
      );
    if (hasExistingDoc) {
      return { mergedSnippet: replacementSnippet, preservedTriviaText: "" };
    }
    const headerMatch = replacementSnippet.match(
      /^([ \t]*(?:async\s+)?(?:def|class)\s+[^\n]+?:\s*(?:#[^\n]*)?)([ \t]*(?:\r?\n|$))/,
    );
    if (headerMatch) {
      const bodyIndent = trivia.indentation + "    ";
      const docLines = trivia.leadingDocComment.split(/\r?\n/);
      let minIndent: number | undefined;
      for (let i = 1; i < docLines.length; i++) {
        const line = docLines[i];
        if (line.trim().length === 0) continue;
        const indentLen = line.match(/^[ \t]*/)?.[0].length ?? 0;
        if (minIndent === undefined || indentLen < minIndent) {
          minIndent = indentLen;
        }
      }
      const baseIndent = minIndent ?? 0;
      const docstringWithIndent = docLines
        .map((line, idx) => {
          if (line.trim().length === 0) return "";
          if (idx === 0) return `${bodyIndent}${line.trimStart()}`;
          const relIndent = line.slice(Math.min(line.length, baseIndent));
          return `${bodyIndent}${relIndent}`;
        })
        .join("\n");
      const beforeHeader = headerMatch[1];
      const afterHeader = replacementSnippet.slice(headerMatch[0].length);
      const mergedSnippet = `${beforeHeader}\n${docstringWithIndent}\n${afterHeader}`;
      return { mergedSnippet, preservedTriviaText: trivia.leadingDocComment };
    }
    return { mergedSnippet: replacementSnippet, preservedTriviaText: "" };
  }

  const trimmedSnippet = replacementSnippet.trimStart();
  const hasExistingDoc =
    trimmedSnippet.startsWith("/**") ||
    trimmedSnippet.startsWith("///") ||
    trimmedSnippet.startsWith("//!");
  if (hasExistingDoc) {
    return { mergedSnippet: replacementSnippet, preservedTriviaText: "" };
  }

  const docLines = trivia.leadingDocComment.split(/\r?\n/);
  const formattedDoc = docLines
    .map((line) => (trivia.indentation ? `${trivia.indentation}${line.trimStart()}` : line))
    .join("\n");
  const mergedSnippet = `${formattedDoc}\n${replacementSnippet}`;
  return { mergedSnippet, preservedTriviaText: trivia.leadingDocComment };
}
