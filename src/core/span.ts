/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AIL: Source Coordinates & Span Definitions
 */

export interface SourcePosition {
  line: number;
  col: number;
  offset: number;
}

export interface SourceSpan {
  start: SourcePosition;
  end: SourcePosition;
  file?: string;
}

export function createPosition(line: number, col: number, offset: number): SourcePosition {
  return { line, col, offset };
}

export function createSpan(start: SourcePosition, end: SourcePosition, file?: string): SourceSpan {
  return { start, end, file };
}

export function formatSpan(span?: SourceSpan): string {
  if (!span) return "<unknown>";
  const fileStr = span.file ? `${span.file}:` : "";
  return `${fileStr}${span.start.line}:${span.start.col}`;
}
