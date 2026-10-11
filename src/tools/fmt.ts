/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AIL 2.0 Deterministic Zero-Token Formatting Pre-Pass Engine (Step 21).
 * Formats AIL source code deterministically with canonical spacing, indentation,
 * punctuation normalization, blank line normalization, and CST token preservation.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { type RawToken, scanRawTokens } from "../core/lexer.js";
import { generateUnifiedDiff } from "./splice.js";

export { generateUnifiedDiff };

export interface FmtOptions {
  /** Verify formatting without writing to disk (default: false) */
  check?: boolean;
  /** Generate unified diff of changes (default: false) */
  diff?: boolean;
  /** Write formatted source to disk (default: true when check is false) */
  write?: boolean;
  /** Indentation space count (default: 2) */
  indent?: number;
  /** Project root directory */
  projectRoot?: string;
}

export interface FmtResult {
  filePath: string;
  isFormatted: boolean;
  formattedSource: string;
  originalSource: string;
  diff?: string;
}

const BINARY_OR_ASSIGN_OPS = new Set<string>([
  "PLUS",
  "MINUS",
  "STAR",
  "SLASH",
  "PERCENT",
  "STAR_STAR",
  "EQ_EQ",
  "NOT_EQ",
  "LT",
  "GT",
  "LT_EQ",
  "GT_EQ",
  "COLON_EQUAL",
  "COLON_COLON_EQUAL",
  "EQUAL",
  "PLUS_EQUAL",
  "MINUS_EQUAL",
  "STAR_EQUAL",
  "SLASH_EQUAL",
  "PERCENT_EQUAL",
  "STAR_STAR_EQUAL",
  "AMP_EQUAL",
  "PIPE_EQUAL",
  "CARET_EQUAL",
  "SHL_EQUAL",
  "SHR_EQUAL",
  "USHR_EQUAL",
  "AMP_AMP",
  "PIPE_PIPE",
  "PIPE",
  "AMPERSAND",
  "CARET",
  "SHL",
  "SHR",
  "USHR",
  "QUESTION_QUESTION",
  "ARROW",
  "FAT_ARROW",
  "AND",
  "OR",
  "IN",
  "INSTANCEOF",
]);

const CONTROL_KEYWORDS = new Set<string>([
  "IF",
  "ELIF",
  "WHILE",
  "FOR",
  "MATCH",
  "CASE",
  "RET",
  "THROW",
  "CATCH",
]);

function isUnaryOp(token: RawToken, prev?: RawToken): boolean {
  if (token.kind !== "PLUS" && token.kind !== "MINUS") return false;
  if (!prev) return true;
  if (BINARY_OR_ASSIGN_OPS.has(prev.kind)) return true;
  if (CONTROL_KEYWORDS.has(prev.kind)) return true;
  if (
    prev.kind === "LPAREN" ||
    prev.kind === "LBRACKET" ||
    prev.kind === "LBRACE" ||
    prev.kind === "COMMA" ||
    prev.kind === "COLON" ||
    prev.kind === "SEMICOLON"
  ) {
    return true;
  }
  return false;
}

function formatTokensOnLine(tokens: RawToken[], source: string): string {
  let out = "";
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const prev = i > 0 ? tokens[i - 1] : undefined;
    const text = source.slice(t.span.start.offset, t.span.end.offset);

    if (!prev) {
      out += text;
      continue;
    }

    let space = false;
    const currUnary = isUnaryOp(t, prev);

    if (t.kind === "COMMENT") {
      space = true;
    } else if (prev.kind === "COMMENT") {
      space = true;
    } else if (t.kind === "COMMA" || t.kind === "SEMICOLON") {
      space = false;
    } else if (t.kind === "COLON") {
      space = false;
    } else if (t.kind === "COLON_COLON" || prev.kind === "COLON_COLON") {
      space = false;
    } else if (
      t.kind === "DOT" ||
      prev.kind === "DOT" ||
      t.kind === "QUESTION_DOT" ||
      prev.kind === "QUESTION_DOT" ||
      t.kind === "ELLIPSIS" ||
      prev.kind === "ELLIPSIS"
    ) {
      space = false;
    } else if (t.kind === "QUESTION") {
      space = false;
    } else if (t.kind === "BANG") {
      space = !(prev.kind === "LPAREN" || prev.kind === "LBRACKET");
    } else if (prev.kind === "BANG") {
      space = false;
    } else if (prev.kind === "COMMA" || prev.kind === "SEMICOLON") {
      space = !(t.kind === "RPAREN" || t.kind === "RBRACKET" || t.kind === "RBRACE");
    } else if (prev.kind === "COLON") {
      space = true;
    } else if (currUnary) {
      space = !(prev.kind === "LPAREN" || prev.kind === "LBRACKET");
    } else if (prev && isUnaryOp(prev, i > 1 ? tokens[i - 2] : undefined)) {
      space = false;
    } else if (BINARY_OR_ASSIGN_OPS.has(t.kind) || BINARY_OR_ASSIGN_OPS.has(prev.kind)) {
      space = true;
    } else if (t.kind === "LPAREN") {
      if (CONTROL_KEYWORDS.has(prev.kind)) {
        space = true;
      } else if (
        prev.kind === "IDENT" ||
        prev.kind === "RPAREN" ||
        prev.kind === "RBRACKET" ||
        prev.kind === "TYPE_INT" ||
        prev.kind === "TYPE_STR" ||
        prev.kind === "TYPE_FLOAT" ||
        prev.kind === "TYPE_BOOL" ||
        prev.kind === "RESULT" ||
        prev.kind === "OPTION"
      ) {
        space = false;
      } else {
        space = true;
      }
    } else if (prev.kind === "LPAREN") {
      space = false;
    } else if (t.kind === "RPAREN") {
      space = false;
    } else if (t.kind === "LBRACKET") {
      if (
        prev.kind === "IDENT" ||
        prev.kind === "RPAREN" ||
        prev.kind === "RBRACKET" ||
        prev.kind === "TYPE_INT" ||
        prev.kind === "TYPE_STR" ||
        prev.kind === "TYPE_FLOAT" ||
        prev.kind === "TYPE_BOOL" ||
        prev.kind === "RESULT" ||
        prev.kind === "OPTION"
      ) {
        space = false;
      } else {
        space = (prev.kind as string) !== "LBRACKET";
      }
    } else if (prev.kind === "LBRACKET" || t.kind === "RBRACKET") {
      space = false;
    } else if (t.kind === "LBRACE") {
      space = (prev.kind as string) !== "LBRACKET";
    } else if (prev.kind === "LBRACE") {
      space = t.kind !== "RBRACE";
    } else if (t.kind === "RBRACE") {
      space = true;
    } else if (prev.kind === "TEMPLATE_HEAD" || prev.kind === "TEMPLATE_MIDDLE") {
      space = false;
    } else if (t.kind === "TEMPLATE_MIDDLE" || t.kind === "TEMPLATE_TAIL") {
      space = false;
    } else {
      space = true;
    }

    if (space) out += " ";
    out += text;
  }
  return out;
}

/**
 * Deterministically formats raw AIL source code according to canonical styling rules:
 * - 2-space indentation per nesting level
 * - Normalized operator spacing (1 space around binary and assignment operators)
 * - Normalized punctuation (no space before comma/colon, 1 space after)
 * - Trailing whitespace elimination
 * - Blank line normalization (max 1 inside blocks, max 2 between top-level declarations)
 * - Exact single trailing newline `\n` at EOF
 * - Preserves string literals, template literals, docstrings, and comments completely intact
 */
export function formatAilSource(source: string, options: FmtOptions = {}): string {
  const indentSize = options.indent ?? 2;
  const rawLines = source.split(/\r?\n/);
  const { rawTokens } = scanRawTokens(source);

  // Group non-layout tokens by start line
  const linesWithTokens: { lineNum: number; tokens: RawToken[] }[] = [];
  let curLine: RawToken[] = [];
  let curLineNum = -1;

  for (const t of rawTokens) {
    if (t.kind === "LEADING_INDENT" || t.kind === "PHYSICAL_NEWLINE") continue;
    if (curLineNum === -1 || t.span.start.line === curLineNum) {
      curLine.push(t);
      curLineNum = t.span.start.line;
    } else {
      linesWithTokens.push({ lineNum: curLineNum, tokens: curLine });
      curLine = [t];
      curLineNum = t.span.start.line;
    }
  }
  if (curLine.length > 0) {
    linesWithTokens.push({ lineNum: curLineNum, tokens: curLine });
  }

  if (linesWithTokens.length === 0) return "";

  const outLines: string[] = [];
  const indentStack: number[] = [0];
  const bracketStack: { kind: string; level: number }[] = [];
  let prevEndLine = 0;

  for (let idx = 0; idx < linesWithTokens.length; idx++) {
    const { lineNum, tokens } = linesWithTokens[idx];
    const originalLine = rawLines[lineNum - 1] ?? "";
    const rawLeadingMatch = originalLine.match(/^[ \t]*/);
    const rawLeading = rawLeadingMatch ? rawLeadingMatch[0].replace(/\t/g, "  ").length : 0;

    // Blank lines normalization between previous token and current line
    if (idx > 0) {
      const blankCount = lineNum - prevEndLine - 1;
      if (blankCount > 0) {
        const maxAllowed = rawLeading === 0 ? 2 : 1;
        const toAdd = Math.min(blankCount, maxAllowed);
        for (let b = 0; b < toAdd; b++) {
          outLines.push("");
        }
      }
    }

    // Check if line starts with closing delimiter
    const firstTok = tokens[0];
    let level: number;
    if (
      firstTok &&
      (firstTok.kind === "RPAREN" || firstTok.kind === "RBRACKET" || firstTok.kind === "RBRACE") &&
      bracketStack.length > 0
    ) {
      const top = bracketStack.pop()!;
      level = top.level;
      while (indentStack.length > 1 && indentStack[indentStack.length - 1] > rawLeading) {
        indentStack.pop();
      }
    } else {
      if (rawLeading > indentStack[indentStack.length - 1]) {
        indentStack.push(rawLeading);
      } else if (rawLeading < indentStack[indentStack.length - 1]) {
        while (indentStack.length > 1 && indentStack[indentStack.length - 1] > rawLeading) {
          indentStack.pop();
        }
      }
      level = indentStack.length - 1;
    }

    // Track open/close brackets on this line
    for (const t of tokens) {
      if (t.kind === "LPAREN" || t.kind === "LBRACKET" || t.kind === "LBRACE") {
        bracketStack.push({ kind: t.kind, level });
      } else if (t.kind === "RPAREN" || t.kind === "RBRACKET" || t.kind === "RBRACE") {
        if (bracketStack.length > 0 && bracketStack[bracketStack.length - 1].level >= level) {
          bracketStack.pop();
        }
      }
    }

    const formattedContent = formatTokensOnLine(tokens, source);
    const indentStr = " ".repeat(level * indentSize);

    // If formatted content has multiline strings, preserve their lines verbatim
    const contentLines = formattedContent.split("\n");
    outLines.push((indentStr + contentLines[0]).trimEnd());
    for (let c = 1; c < contentLines.length; c++) {
      outLines.push(contentLines[c]);
    }

    // Update prevEndLine to last token's span end line
    const lastTok = tokens[tokens.length - 1];
    prevEndLine = lastTok.span.end.line;
  }

  // Strip trailing blank lines
  while (outLines.length > 0 && outLines[outLines.length - 1] === "") {
    outLines.pop();
  }

  if (outLines.length === 0) return "";

  return `${outLines.join("\n")}\n`;
}

/**
 * Formats a single AIL file on disk.
 * If not already formatted and writing is permitted, writes atomically.
 */
export async function formatAilFile(
  filePath: string,
  options: FmtOptions = {},
): Promise<FmtResult> {
  const fullPath = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  const stat = await fs.promises.stat(fullPath);
  if (!stat.isFile()) {
    throw new Error(`Target is not a file: ${filePath}`);
  }

  const originalSource = await fs.promises.readFile(fullPath, "utf-8");
  const formattedSource = formatAilSource(originalSource, options);
  const isFormatted = originalSource === formattedSource;

  let diff: string | undefined;
  if (options.diff && !isFormatted) {
    diff = generateUnifiedDiff(filePath, originalSource, formattedSource);
  }

  const shouldWrite = options.write !== false && !options.check;
  if (!isFormatted && shouldWrite) {
    const dir = path.dirname(fullPath);
    const tmpFile = path.join(
      dir,
      `.${path.basename(fullPath)}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
    );
    await fs.promises.writeFile(tmpFile, formattedSource, "utf-8");
    await fs.promises.rename(tmpFile, fullPath);
  }

  return {
    filePath,
    isFormatted,
    formattedSource,
    originalSource,
    diff,
  };
}

/**
 * Formats a single file or traverses a directory recursively formatting all .ail files.
 */
export async function formatAilPath(
  targetPath: string,
  options: FmtOptions = {},
): Promise<FmtResult | FmtResult[]> {
  const fullPath = path.resolve(process.cwd(), targetPath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Path not found: ${targetPath}`);
  }

  const stat = await fs.promises.stat(fullPath);
  if (stat.isFile()) {
    return await formatAilFile(targetPath, options);
  }

  if (stat.isDirectory()) {
    const ailFiles: string[] = [];

    async function walk(dir: string) {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (
          entry.name.startsWith(".") ||
          entry.name === "node_modules" ||
          entry.name === "dist" ||
          entry.name === "build" ||
          entry.name === "coverage"
        ) {
          continue;
        }
        const entryPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(entryPath);
        } else if (entry.isFile() && entry.name.endsWith(".ail")) {
          ailFiles.push(entryPath);
        }
      }
    }

    await walk(fullPath);
    ailFiles.sort();

    const results: FmtResult[] = [];
    for (const file of ailFiles) {
      const relPath = path.relative(process.cwd(), file);
      results.push(await formatAilFile(relPath, options));
    }
    return results;
  }

  throw new Error(`Unsupported file type at ${targetPath}`);
}
