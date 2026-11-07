/**
 * Machine-Readable Diagnostic Engine & Autonomous Self-Repair Telemetry for AICE 2.0.
 *
 * Implements the single-root diagnostic payload, visual caret slices, and unified diff
 * candidate repair generator designed to maximize LLM 1-shot self-healing (SWE-bench / Reflexion).
 * Conforms to Pillar 4 of docs/RESEARCH_SYNTHESIS.md and docs/AI_SYSTEM_PROMPT.md.
 */

import { LexerError } from "../core/lexer.js";
import { ParserError, parse } from "../core/parser.js";
import { emptySpan, type Span } from "../core/span.js";
import { TypeCheckError, TypeChecker } from "./checker.js";
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

export interface AiceDiagnostic {
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
  diagnostics: AiceDiagnostic[];
  primary_diagnostic?: AiceDiagnostic;
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

  // 0. JS/Python hallucinations: === or !== or null
  if (originalLine.includes("===")) {
    const patchedLine = originalLine.replace(/===/g, "==");
    const patch = `--- ${file}\n+++ ${file}\n@@ -${span.start.line},1 +${span.start.line},1 @@\n-${originalLine}\n+${patchedLine}`;
    return {
      description: "Replace JS strict equality '===' with AICE equality '=='",
      patch,
    };
  }
  if (originalLine.includes("!==")) {
    const patchedLine = originalLine.replace(/!==/g, "!=");
    const patch = `--- ${file}\n+++ ${file}\n@@ -${span.start.line},1 +${span.start.line},1 @@\n-${originalLine}\n+${patchedLine}`;
    return {
      description: "Replace JS strict inequality '!==' with AICE inequality '!='",
      patch,
    };
  }
  if (
    (code === "AICE_E2008_UNDECLARED_VARIABLE" && message.includes("'null'")) ||
    (/\bnull\b/.test(originalLine) && (code === "AICE_E2008_UNDECLARED_VARIABLE" || code.startsWith("AICE_E1")))
  ) {
    const patchedLine = originalLine.replace(/\bnull\b/g, "nil");
    const patch = `--- ${file}\n+++ ${file}\n@@ -${span.start.line},1 +${span.start.line},1 @@\n-${originalLine}\n+${patchedLine}`;
    return {
      description: "Replace 'null' with canonical AICE 'nil'",
      patch,
    };
  }

  // 1. Immutable variable assignment: let x = -> let mut x = (also handles const and :=)
  if (code === "AICE_E2005_IMMUTABLE_ASSIGNMENT") {
    const varNameMatch = message.match(/'([^']+)'/);
    const varName = varNameMatch ? varNameMatch[1] : undefined;
    if (varName) {
      for (let i = lineIdx; i >= 0; i--) {
        const declLine = lines[i];
        const escapedVar = varName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const letPattern = new RegExp(`(^|[^a-zA-Z0-9_$])let\\s+${escapedVar}(?![a-zA-Z0-9_$])`);
        const constPattern = new RegExp(`(^|[^a-zA-Z0-9_$])const\\s+${escapedVar}(?![a-zA-Z0-9_$])`);
        const walrusPattern = new RegExp(`(^|[^a-zA-Z0-9_$])${escapedVar}\\s*:=`);
        if (letPattern.test(declLine)) {
          const patchedLine = declLine.replace(letPattern, (_, prefix) => `${prefix}let mut ${varName}`);
          const patch = `--- ${file}\n+++ ${file}\n@@ -${i + 1},1 +${i + 1},1 @@\n-${declLine}\n+${patchedLine}`;
          return {
            description: `Change declaration of '${varName}' to mutable with 'let mut'`,
            patch,
          };
        }
        if (constPattern.test(declLine)) {
          const patchedLine = declLine.replace(constPattern, (_, prefix) => `${prefix}let mut ${varName}`);
          const patch = `--- ${file}\n+++ ${file}\n@@ -${i + 1},1 +${i + 1},1 @@\n-${declLine}\n+${patchedLine}`;
          return {
            description: `Change declaration of '${varName}' to mutable with 'let mut'`,
            patch,
          };
        }
        if (walrusPattern.test(declLine)) {
          const patchedLine = declLine.replace(walrusPattern, (_, prefix) => `${prefix}let mut ${varName} =`);
          const patch = `--- ${file}\n+++ ${file}\n@@ -${i + 1},1 +${i + 1},1 @@\n-${declLine}\n+${patchedLine}`;
          return {
            description: `Change short assignment of '${varName}' to mutable with 'let mut'`,
            patch,
          };
        }
      }
    }
  }

  // 2. Division by zero: replace 0 with safe fallback
  if (code === "AICE_E2003_DIVISION_BY_ZERO") {
    const patchedLine = originalLine.replace(/\/\s*0\b/, "/ 1 /* divisor must be non-zero */");
    const patch = `--- ${file}\n+++ ${file}\n@@ -${span.start.line},1 +${span.start.line},1 @@\n-${originalLine}\n+${patchedLine}`;
    return {
      description: "Replace division by literal zero with non-zero divisor",
      patch,
    };
  }

  // 3. Postfix ? missing or unhandled Result
  if (
    code === "AICE_E1004_UNHANDLED_RESULT" ||
    (message.includes("Result") && (code === "AICE_E2002_TYPE_MISMATCH" || message.includes("unpacked")))
  ) {
    let patchedLine: string;
    if (originalLine.trimEnd().endsWith(";")) {
      patchedLine = originalLine.replace(/;\s*$/, "?;");
    } else {
      patchedLine = `${originalLine.trimEnd()}?`;
    }
    const patch = `--- ${file}\n+++ ${file}\n@@ -${span.start.line},1 +${span.start.line},1 @@\n-${originalLine}\n+${patchedLine}`;
    return {
      description: "Unpack fallible Result with postfix '?' operator",
      patch,
    };
  }

  // 4. Non-boolean conditional: if items: -> if not items.isEmpty(): or if count != 0:
  if (code === "AICE_E2001_NON_BOOLEAN_CONDITION") {
    let condMatch = originalLine.match(/if\s+([^:]+):/);
    let withBrace = false;
    if (!condMatch) {
      condMatch = originalLine.match(/if\s+([^{:]+)\s*\{/);
      withBrace = Boolean(condMatch);
    }
    if (condMatch) {
      const cond = condMatch[1].trim();
      let replacementCond: string;
      if (/\bgot\s+['"](int|float|number)['"]/.test(message)) {
        replacementCond = `${cond} != 0`;
      } else {
        replacementCond = `not ${cond}.isEmpty()`;
      }
      const replHeader = withBrace ? `if ${replacementCond}: {` : `if ${replacementCond}:`;
      const patchedLine = originalLine.replace(condMatch[0], replHeader);
      const patch = `--- ${file}\n+++ ${file}\n@@ -${span.start.line},1 +${span.start.line},1 @@\n-${originalLine}\n+${patchedLine}`;
      return {
        description: "Replace implicit truthiness check with strict boolean predicate",
        patch,
      };
    }
  }

  // 5. Missing ':' at block or header definition
  if (message.includes("Expected ':'")) {
    const lineToFix = Math.max(0, span.start.line - (span.start.column === 1 ? 2 : 1));
    const targetLine = lines[lineToFix];
    if (targetLine && !targetLine.trimEnd().endsWith(":")) {
      const patchedLine = `${targetLine.trimEnd()}:`;
      const patch = `--- ${file}\n+++ ${file}\n@@ -${lineToFix + 1},1 +${lineToFix + 1},1 @@\n-${targetLine}\n+${patchedLine}`;
      return {
        description: "Append missing colon ':' to block header",
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
  let code = "AICE_E0000_UNKNOWN_ERROR";
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

  const diagnostic: AiceDiagnostic = {
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

/**
 * Applies a unified diff patch to a source string deterministically.
 */
export function applyUnifiedDiffPatch(source: string, patch: string): string {
  const patchLines = patch.split(/\r?\n/);
  const sourceLines = source.split(/\r?\n/);

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
      (line.startsWith("-") || line.startsWith("+") || line.startsWith(" "))
    ) {
      currentHunk.lines.push(line);
    }
  }
  if (currentHunk) hunks.push(currentHunk);

  if (hunks.length === 0) return source;

  // Apply hunks in reverse order (bottom to top) to preserve line indices
  hunks.sort((a, b) => b.oldStart - a.oldStart);

  for (const hunk of hunks) {
    const startIdx = hunk.oldStart - 1;
    const toRemove = hunk.oldCount;
    const replacementLines: string[] = [];
    for (const hl of hunk.lines) {
      if (hl.startsWith("+")) {
        replacementLines.push(hl.slice(1));
      } else if (hl.startsWith(" ")) {
        replacementLines.push(hl.slice(1));
      }
      // '-' lines are dropped
    }
    sourceLines.splice(startIdx, toRemove, ...replacementLines);
  }

  return sourceLines.join("\n");
}

export interface SelfRepairResult {
  fixed: boolean;
  modified: boolean;
  iterations: number;
  finalSource: string;
  repairs: CandidateRepair[];
  error?: DiagnosticReport;
}

/**
 * Autonomously repairs an .aice source string using synthesized candidate diagnostic patches.
 * Evaluates parse & typecheck in a loop until the source compiles cleanly or maxIterations is reached.
 */
export function attemptSelfRepair(
  source: string,
  file = "<anonymous>",
  maxIterations = 5,
): SelfRepairResult {
  let currentSource = source;
  const appliedRepairs: CandidateRepair[] = [];

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    try {
      const mod = parse(currentSource, file);
      const tc = new TypeChecker();
      tc.checkModule(mod);

      return {
        fixed: true,
        modified: appliedRepairs.length > 0,
        iterations: iteration,
        finalSource: currentSource,
        repairs: appliedRepairs,
      };
    } catch (err) {
      const report = buildReportFromError(err, currentSource, file);
      const repair = report.primary_diagnostic?.candidate_repair;

      if (!repair) {
        return {
          fixed: false,
          modified: appliedRepairs.length > 0,
          iterations: iteration,
          finalSource: currentSource,
          repairs: appliedRepairs,
          error: report,
        };
      }

      const patched = applyUnifiedDiffPatch(currentSource, repair.patch);
      if (patched === currentSource) {
        return {
          fixed: false,
          modified: appliedRepairs.length > 0,
          iterations: iteration,
          finalSource: currentSource,
          repairs: appliedRepairs,
          error: report,
        };
      }

      appliedRepairs.push(repair);
      currentSource = patched;
    }
  }

  // Final validation after loop
  try {
    const mod = parse(currentSource, file);
    const tc = new TypeChecker();
    tc.checkModule(mod);
    return {
      fixed: true,
      modified: true,
      iterations: maxIterations,
      finalSource: currentSource,
      repairs: appliedRepairs,
    };
  } catch (err) {
    const report = buildReportFromError(err, currentSource, file);
    return {
      fixed: false,
      modified: appliedRepairs.length > 0,
      iterations: maxIterations,
      finalSource: currentSource,
      repairs: appliedRepairs,
      error: report,
    };
  }
}
