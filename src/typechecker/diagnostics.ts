/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AIL: Machine-Readable Diagnostic Telemetry (Pillar 4)
 * Generates structured JSON diagnostic payloads for 1-step autonomous AI self-repair.
 */

import type { SourceSpan } from "../core/span.ts";

export type ErrorPhase =
  | "SYNTACTIC"
  | "TYPECHECKING"
  | "CONTRACT_VERIFICATION"
  | "TYPESTATE_VERIFICATION"
  | "EFFECT_ANALYSIS";

export interface DiagnosticViolation {
  code: string;
  message: string;
  context?: Record<string, string | number | boolean>;
}

export interface StructuredDiagnostic {
  status: "REJECTED";
  error_phase: ErrorPhase;
  file?: string;
  span?: {
    line: number;
    col: number;
    offset: number;
    symbol?: string;
  };
  violation: DiagnosticViolation;
  invariant_correction_rule: string;
  candidate_fix?: string;
}

export function createStructuredDiagnostic(
  phase: ErrorPhase,
  code: string,
  message: string,
  rule: string,
  options: {
    span?: SourceSpan;
    symbol?: string;
    candidateFix?: string;
    context?: Record<string, string | number | boolean>;
  } = {},
): StructuredDiagnostic {
  return {
    status: "REJECTED",
    error_phase: phase,
    file: options.span?.file,
    span: options.span
      ? {
          line: options.span.start.line,
          col: options.span.start.col,
          offset: options.span.start.offset,
          symbol: options.symbol,
        }
      : undefined,
    violation: {
      code,
      message,
      context: options.context,
    },
    invariant_correction_rule: rule,
    candidate_fix: options.candidateFix,
  };
}
