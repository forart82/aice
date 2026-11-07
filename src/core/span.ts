/**
 * Source position and span tracking for AICE tokens and AST nodes.
 */

export interface Position {
  line: number; // 1-based line number
  column: number; // 1-based column number
  offset: number; // 0-based character offset
}

export interface Span {
  file: string;
  start: Position;
  end: Position;
}

export function createPosition(line: number, column: number, offset: number): Position {
  return { line, column, offset };
}

export function createSpan(file: string, start: Position, end: Position): Span {
  return { file, start, end };
}

export function mergeSpans(first: Span, last: Span): Span {
  return {
    file: first.file,
    start: first.start,
    end: last.end,
  };
}

export function emptySpan(file = "<anonymous>"): Span {
  const pos: Position = { line: 1, column: 1, offset: 0 };
  return { file, start: pos, end: pos };
}

export function formatSpan(span: Span): string {
  return `${span.file}:${span.start.line}:${span.start.column}`;
}
