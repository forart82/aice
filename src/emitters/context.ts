/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AIL: Target Compilation Context & Options
 */

import type { CstTriviaTable } from "../core/trivia.ts";

export type TargetLanguage = "typescript" | "python" | "html" | "css";

export interface EmitOptions {
  stripTrivia?: boolean;
  indent?: string;
  targetVersion?: string;
  triviaTable?: CstTriviaTable;
}

export class EmitContext {
  public readonly target: TargetLanguage;
  public readonly stripTrivia: boolean;
  public readonly indentUnit: string;
  public readonly targetVersion: string;
  public readonly triviaTable?: CstTriviaTable;

  private indentLevel = 0;

  constructor(target: TargetLanguage, options?: EmitOptions) {
    this.target = target;
    this.stripTrivia = options?.stripTrivia ?? false;
    this.indentUnit = options?.indent ?? "  ";
    this.targetVersion = options?.targetVersion ?? (target === "python" ? "3.12" : "es2022");
    this.triviaTable = options?.triviaTable;
  }

  public get indent(): string {
    return this.indentUnit.repeat(this.indentLevel);
  }

  public indentLine(line: string): string {
    return line.length > 0 ? `${this.indent}${line}` : "";
  }

  public indentBlock(lines: string[]): string {
    return lines.map((l) => (l.length > 0 ? `${this.indent}${l}` : "")).join("\n");
  }

  public withIndent<T>(fn: () => T): T {
    this.indentLevel++;
    try {
      return fn();
    } finally {
      this.indentLevel--;
    }
  }

  public getLeadingComments(nodeId?: string): string[] {
    if (this.stripTrivia || !this.triviaTable || !nodeId) return [];
    const trivia = this.triviaTable.getTrivia(nodeId);
    if (!trivia) return [];

    const comments: string[] = [];
    for (const item of trivia.leading) {
      if (
        item.kind === "LINE_COMMENT" ||
        item.kind === "BLOCK_COMMENT" ||
        item.kind === "DOCSTRING"
      ) {
        comments.push(this.formatComment(item.content));
      }
    }
    return comments;
  }

  public formatComment(raw: string): string {
    const trimmed = raw.trim();
    if (this.target === "python") {
      if (trimmed.startsWith(";;") || trimmed.startsWith("//")) {
        return `# ${trimmed.replace(/^(;;|\/\/)\s*/, "")}`;
      }
      if (trimmed.startsWith("/*")) {
        return `"""\n${trimmed.replace(/^\/\*\s*/, "").replace(/\s*\*\/$/, "")}\n"""`;
      }
      return `# ${trimmed}`;
    }

    if (this.target === "html") {
      return `<!-- ${trimmed.replace(/^(;;|\/\/)\s*/, "")} -->`;
    }

    // Default for TS and CSS
    if (trimmed.startsWith(";;")) {
      return `// ${trimmed.replace(/^;;\s*/, "")}`;
    }
    return trimmed;
  }
}
