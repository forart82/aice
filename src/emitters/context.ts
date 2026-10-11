/**
 * Emitter Context & State Management for Multi-Language Forward Transpilation.
 */

import type { CstTriviaTable } from "../core/trivia.js";

export type TargetLanguage =
  | "typescript"
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
  | "php";

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
        this.writeLine(line);
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
 * Detects target language from an AIL file path (e.g. foo.ts.ail -> typescript).
 */
export function detectTargetFromPath(filePath: string): TargetLanguage {
  const clean = filePath.replace(/\.ail$/, "");
  if (clean.endsWith(".tsx")) return "tsx";
  if (clean.endsWith(".ts")) return "typescript";
  if (clean.endsWith(".py")) return "python";
  if (clean.endsWith(".html")) return "html";
  if (clean.endsWith(".css")) return "css";
  if (clean.endsWith(".rs")) return "rust";
  if (clean.endsWith(".go")) return "go";
  if (
    clean.endsWith(".cpp") ||
    clean.endsWith(".hpp") ||
    clean.endsWith(".cc") ||
    clean.endsWith(".cxx") ||
    clean.endsWith(".h")
  )
    return "cpp";
  if (clean.endsWith(".cs")) return "csharp";
  if (clean.endsWith(".json")) return "json";
  if (clean.endsWith(".yaml") || clean.endsWith(".yml")) return "yaml";
  if (clean.endsWith(".twig")) return "twig";
  if (clean.endsWith(".php")) return "php";
  return "typescript";
}

/**
 * Derives the output target file path from an AIL file path (e.g. src/App.tsx.ail -> src/App.tsx).
 */
export function getTargetOutputPath(filePath: string): string {
  if (filePath.endsWith(".ail")) {
    return filePath.slice(0, -4);
  }
  return filePath;
}
