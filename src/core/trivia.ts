/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AIL: Concrete Syntax Tree (CST) Trivia Engine
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
}

export class CstTriviaTable {
  private entries = new Map<string, NodeTrivia>();

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
}
