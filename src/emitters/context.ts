/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Emitter Context & State Management for Multi-Language Forward Transpilation.
 */

import type { CstTriviaTable } from "../core/trivia.js";

export type TargetLanguage =
  | "typescript"
  | "javascript"
  | "tsx"
  | "python"
  | "html"
  | "css"
  | "rust"
  | "go"
  | "cpp"
  | "csharp"
  | "json"
  | "yaml"
  | "twig"
  | "php"
  | "kotlin"
  | "shell"
  | "powershell"
  | "batch"
  | "markdown"
  | "aipl";
export interface EmitterOptions {
  target?: TargetLanguage;
  indent?: string;
  includeComments?: boolean;
  trivia?: CstTriviaTable;
  pureInterfaces?: boolean;
  watermark?: boolean;
  sourcePath?: string;
}

export class EmitterContext {
  readonly target: TargetLanguage;
  readonly indentStr: string;
  readonly trivia?: CstTriviaTable;
  readonly pureInterfaces?: boolean;
  readonly watermark?: boolean;
  readonly sourcePath?: string;
  private currentIndent = 0;
  private buffer: string[] = [];
  private neededHelpers = new Set<string>();

  constructor(target: TargetLanguage, options: EmitterOptions = {}) {
    this.target = target;
    this.indentStr = options.indent ?? "  ";
    this.trivia = options.trivia;
    this.pureInterfaces = options.pureInterfaces;
    this.watermark = options.watermark;
    this.sourcePath = options.sourcePath;
  }

  indent(): void {
    this.currentIndent++;
  }

  dedent(): void {
    this.currentIndent = Math.max(0, this.currentIndent - 1);
  }

  getIndent(): string {
    return this.indentStr.repeat(this.currentIndent);
  }

  write(text: string): void {
    this.buffer.push(text);
  }

  writeLine(text = ""): void {
    if (text.length > 0) {
      this.buffer.push(`${this.getIndent()}${text}\n`);
    } else {
      this.buffer.push("\n");
    }
  }

  addHelper(helperName: string): void {
    this.neededHelpers.add(helperName);
  }

  hasHelper(helperName: string): boolean {
    return this.neededHelpers.has(helperName);
  }

  getHelpers(): string[] {
    return Array.from(this.neededHelpers);
  }

  emitLeadingTrivia(nodeId: string): void {
    if (!this.trivia) return;
    const entry = this.trivia.getTrivia(nodeId);
    if (!entry) return;

    if (entry.blankLinesBefore && entry.blankLinesBefore > 0) {
      for (let i = 0; i < entry.blankLinesBefore; i++) {
        this.writeLine();
      }
    }

    for (const item of entry.leading) {
      const lines = item.content.split("\n");
      for (const line of lines) {
        const trimmed = line.trimStart();
        if (trimmed.startsWith("*")) {
          this.writeLine(" " + trimmed);
        } else {
          this.writeLine(trimmed);
        }
      }
    }
  }

  emitTrailingTrivia(nodeId: string): void {
    if (!this.trivia) return;
    const entry = this.trivia.getTrivia(nodeId);
    if (!entry || entry.trailing.length === 0) return;

    for (const item of entry.trailing) {
      if (this.buffer.length > 0 && this.buffer[this.buffer.length - 1].endsWith("\n")) {
        const last = this.buffer[this.buffer.length - 1];
        this.buffer[this.buffer.length - 1] = last.slice(0, -1) + ` ${item.content}\n`;
      } else {
        this.write(` ${item.content}`);
      }
    }
  }

  getSourceSlice(nodeId: string): string | undefined {
    return this.trivia?.getSourceSlice(nodeId);
  }

  hasSourceSlice(nodeId: string): boolean {
    return Boolean(this.trivia?.getSourceSlice(nodeId));
  }

  getOutput(): string {
    return this.buffer.join("");
  }
}

/**
 * Detects target language from an AICE file path (e.g. foo.ts.aice -> typescript).
 */
export function detectTargetFromPath(filePath: string): TargetLanguage {
  const lower = filePath.toLowerCase().replace(/\.aice$/, "");
  if (lower.endsWith(".tsx") || lower.endsWith(".jsx")) return "tsx";
  if (lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".cjs"))
    return "javascript";
  if (lower.endsWith(".py") || lower.endsWith(".pyi")) return "python";
  if (lower.endsWith(".rs")) return "rust";
  if (lower.endsWith(".go")) return "go";
  if (
    lower.endsWith(".cpp") ||
    lower.endsWith(".cc") ||
    lower.endsWith(".cxx") ||
    lower.endsWith(".hpp") ||
    lower.endsWith(".h")
  )
    return "cpp";
  if (lower.endsWith(".cs")) return "csharp";
  if (lower.endsWith(".kt") || lower.endsWith(".kts")) return "kotlin";
  if (lower.endsWith(".php")) return "php";
  if (lower.endsWith(".twig") || lower.endsWith(".html.twig")) return "twig";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
  if (lower.endsWith(".css")) return "css";
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) return "yaml";
  if (lower.endsWith(".sh") || lower.endsWith(".bash") || lower.endsWith(".zsh")) return "shell";
  if (lower.endsWith(".ps1")) return "powershell";
  if (lower.endsWith(".cmd") || lower.endsWith(".bat")) return "batch";
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "markdown";
  if (lower.endsWith(".aipl")) return "aipl";
  return "typescript";
}

/**
 * Derives the output target file path from an AICE file path (e.g. src/App.tsx.aice -> src/App.tsx).
 */
export function getTargetOutputPath(filePath: string): string {
  if (filePath.endsWith(".aice")) {
    return filePath.slice(0, -5);
  }
  return filePath;
}
