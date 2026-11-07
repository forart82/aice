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
