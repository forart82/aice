/**
 * Machine-Readable Diagnostic Engine & Autonomous Self-Repair Telemetry for AIL 2.0.
 *
 * Implements the single-root diagnostic payload, visual caret slices, and unified diff
 * candidate repair generator designed to maximize LLM 1-shot self-healing (SWE-bench / Reflexion).
 * Conforms to Pillar 4 of docs/RESEARCH_SYNTHESIS.md and docs/AI_SYSTEM_PROMPT.md.
 */

import { LexerError } from "../core/lexer.js";
import { ParserError } from "../core/parser.js";
import { emptySpan, type Span } from "../core/span.js";
import { TypeCheckError } from "./checker.js";
import { formatType } from "./types.js";

export type DiagnosticPhase = "LEXING" | "PARSING" | "TYPECHECKING" | "VERIFICATION";

export interface CandidateRepair {
  description: string;
  patch: string;
}

export interface ViolationDetail {
  code: string;
  message: string;
  expected?: string;
  actual?: string;
}

export interface AilDiagnostic {
  status: "REJECTED";
  error_phase: DiagnosticPhase;
  file: string;
  span: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
  violation: ViolationDetail;
  caret_slice: string;
  candidate_repair?: CandidateRepair;
}

export interface DiagnosticReport {
  status: "SUCCESS" | "FAILURE";
  file: string;
  diagnostics: AilDiagnostic[];
  primary_diagnostic?: AilDiagnostic;
}

/**
 * Generates a visual context slice around an AST span with line numbers and a caret indicator.
 */
export function generateCaretSlice(source: string, span: Span, contextLines = 2): string {
  const lines = source.split(/\r?\n/);
  if (lines.length === 0) return "";

  const targetLineIdx = Math.max(0, Math.min(lines.length - 1, span.start.line - 1));
  const startLineIdx = Math.max(0, targetLineIdx - contextLines);
  const endLineIdx = Math.min(lines.length - 1, targetLineIdx + contextLines);

  const padWidth = String(endLineIdx + 1).length;
  const result: string[] = [];

  for (let i = startLineIdx; i <= endLineIdx; i++) {
    const lineNum = String(i + 1).padStart(padWidth, " ");
    const lineContent = lines[i] ?? "";

    if (i === targetLineIdx) {
      result.push(`> ${lineNum} | ${lineContent}`);

      // Compute underline length
      const colStart = Math.max(1, span.start.column);
      const colEnd =
        span.end.line === span.start.line && span.end.column > span.start.column
          ? span.end.column
          : colStart + 1;
      const underlineLen = Math.max(1, colEnd - colStart);

      const gutterSpace = " ".repeat(padWidth + 4);
      const indentSpace = " ".repeat(colStart - 1);
      const carets = "^".repeat(underlineLen);

      result.push(`${gutterSpace}| ${indentSpace}${carets}`);
    } else {
      result.push(`  ${lineNum} | ${lineContent}`);
    }
  }

  return result.join("\n");
}

/**
 * Synthesizes a unified diff candidate patch for autonomous 1-shot self-repair.
 */
export function generateCandidateRepair(
  code: string,
  message: string,
  span: Span,
  source: string,
  file: string,
): CandidateRepair | undefined {
  const lines = source.split(/\r?\n/);
  const lineIdx = span.start.line - 1;
  const originalLine = lines[lineIdx];
  if (originalLine === undefined) return undefined;

  // 1. Immutable variable assignment: let x = -> let mut x =
  if (code === "AIL_E2005_IMMUTABLE_ASSIGNMENT") {
    const varNameMatch = message.match(/'([^']+)'/);
    const varName = varNameMatch ? varNameMatch[1] : undefined;
    if (varName) {
      for (let i = lineIdx - 1; i >= 0; i--) {
        const declLine = lines[i];
        const letPattern = new RegExp(`(\\b)let\\s+${varName}\\b`);
        if (letPattern.test(declLine)) {
          const patchedLine = declLine.replace(letPattern, `$1let mut ${varName}`);
          const patch = `--- ${file}\n+++ ${file}\n@@ -${i + 1},1 +${i + 1},1 @@\n-${declLine}\n+${patchedLine}`;
          return {
            description: `Change declaration of '${varName}' to mutable with 'let mut'`,
            patch,
          };
        }
      }
    }
  }

  // 2. Division by zero: replace 0 with safe fallback
  if (code === "AIL_E2003_DIVISION_BY_ZERO") {
    const patchedLine = originalLine.replace(/\/\s*0\b/, "/ 1 /* divisor must be non-zero */");
    const patch = `--- ${file}\n+++ ${file}\n@@ -${span.start.line},1 +${span.start.line},1 @@\n-${originalLine}\n+${patchedLine}`;
    return {
      description: "Replace division by literal zero with non-zero divisor",
      patch,
    };
  }

  // 3. Postfix ? missing or unhandled Result
  if (
    code === "AIL_E1004_UNHANDLED_RESULT" ||
    (message.includes("Result") && message.includes("unpacked"))
  ) {
    const patchedLine = `${originalLine.trimEnd()}?`;
    const patch = `--- ${file}\n+++ ${file}\n@@ -${span.start.line},1 +${span.start.line},1 @@\n-${originalLine}\n+${patchedLine}`;
    return {
      description: "Unpack fallible Result with postfix '?' operator",
      patch,
    };
  }

  // 4. Non-boolean conditional: if items: -> if not items.isEmpty():
  if (code === "AIL_E2001_NON_BOOLEAN_CONDITION") {
    const condMatch = originalLine.match(/if\s+([^:]+):/);
    if (condMatch) {
      const cond = condMatch[1].trim();
      const patchedLine = originalLine.replace(condMatch[0], `if not ${cond}.isEmpty():`);
      const patch = `--- ${file}\n+++ ${file}\n@@ -${span.start.line},1 +${span.start.line},1 @@\n-${originalLine}\n+${patchedLine}`;
      return {
        description: "Replace implicit truthiness check with strict boolean predicate",
        patch,
      };
    }
  }

  return undefined;
}

/**
 * Builds a structured diagnostic report from any compiler error.
 */
export function buildReportFromError(
  err: unknown,
  source: string,
  file = "<anonymous>",
): DiagnosticReport {
  let error_phase: DiagnosticPhase = "VERIFICATION";
  let code = "AIL_E0000_UNKNOWN_ERROR";
  let message = "Unknown error during compilation";
  let span: Span = emptySpan(file);
  let expected: string | undefined;
  let actual: string | undefined;

  if (err instanceof LexerError) {
    error_phase = "LEXING";
    code = err.code;
    message = err.message;
    span = err.span;
  } else if (err instanceof ParserError) {
    error_phase = "PARSING";
    code = err.code;
    message = err.message;
    span = err.span;
  } else if (err instanceof TypeCheckError) {
    error_phase = "TYPECHECKING";
    code = err.code;
    message = err.message;
    span = err.span;
    if (err.expected) expected = formatType(err.expected);
    if (err.actual) actual = formatType(err.actual);
  } else if (err instanceof Error) {
    message = err.message;
  }

  const caret_slice = generateCaretSlice(source, span);
  const candidate_repair = generateCandidateRepair(code, message, span, source, file);

  const diagnostic: AilDiagnostic = {
    status: "REJECTED",
    error_phase,
    file,
    span: {
      start: { line: span.start.line, column: span.start.column },
      end: { line: span.end.line, column: span.end.column },
    },
    violation: {
      code,
      message,
      expected,
      actual,
    },
    caret_slice,
    candidate_repair,
  };

  return {
    status: "FAILURE",
    file,
    diagnostics: [diagnostic],
    primary_diagnostic: diagnostic,
  };
}

/**
 * Formats diagnostic report into formatted human console text.
 */
export function formatDiagnosticText(report: DiagnosticReport): string {
  if (report.status === "SUCCESS") {
    return `✓ Verification successful: ${report.file} passed all checks.`;
  }

  const diag = report.primary_diagnostic;
  if (!diag) return "Compilation failed with unknown diagnostics.";

  const header = `❌ [${diag.error_phase}] ${diag.violation.code}: ${diag.violation.message}`;
  const location = `  --> ${diag.file}:${diag.span.start.line}:${diag.span.start.column}`;

  let out = `${header}\n${location}\n\n${diag.caret_slice}\n`;

  if (diag.candidate_repair) {
    out += `\n💡 Suggested Autonomous Repair:\n${diag.candidate_repair.description}\n\n${diag.candidate_repair.patch}\n`;
  }

  return out;
}

/**
 * Formats diagnostic report into clean, machine-readable JSON for LLM agents.
 */
export function formatDiagnosticJson(report: DiagnosticReport): string {
  return JSON.stringify(report, null, 2);
}
