/**
 * Two-Stage Decoupled Lexer for AIL 2.0.
 *
 * Stage 1: scanRawTokens (Stateless Scanner)
 *   Scans characters into physical tokens, strings, numbers, identifiers,
 *   leading line indentation, physical newlines, and comments.
 *
 * Stage 2: filterIndentation (Layout & Off-side Rule Engine)
 *   Maintains an indentation stack [0, 2, 4, ...] and bracket depth counter.
 *   - When bracket depth == 0: emits logical NEWLINE, INDENT, and DEDENT tokens.
 *   - When bracket depth > 0: suppresses indentation and newlines (implicit line continuation).
 */

import { createPosition, createSpan, type Position, type Span } from "./span.js";
import { KEYWORDS, type Token, type TokenKind } from "./tokens.js";

export class LexerError extends Error {
  readonly span: Span;
  readonly code: string;

  constructor(message: string, span: Span, code = "AIL_E1001_LEXER_ERROR") {
    super(`${message} at ${span.file}:${span.start.line}:${span.start.column}`);
    this.name = "LexerError";
    this.span = span;
    this.code = code;
  }
}

export interface CommentToken {
  value: string;
  span: Span;
  isBlock: boolean;
}

export type RawTokenKind = TokenKind | "PHYSICAL_NEWLINE" | "LEADING_INDENT";

export interface RawToken {
  kind: RawTokenKind;
  value: string;
  span: Span;
  indentWidth?: number; // only set for LEADING_INDENT
}

/**
 * Stage 1: Stateless scanner converting characters to raw tokens.
 */
export function scanRawTokens(
  source: string,
  file = "<anonymous>",
): { rawTokens: RawToken[]; comments: CommentToken[] } {
  const rawTokens: RawToken[] = [];
  const comments: CommentToken[] = [];

  let offset = 0;
  let line = 1;
  let column = 1;
  let atLineStart = true;

  function currentPos(): Position {
    return createPosition(line, column, offset);
  }

  function peek(ahead = 0): string {
    const idx = offset + ahead;
    return idx < source.length ? source[idx] : "\0";
  }

  function advance(): string {
    const ch = source[offset];
    offset++;
    column++;
    return ch;
  }

  function makeSpan(start: Position): Span {
    return createSpan(file, start, currentPos());
  }

  while (offset < source.length) {
    // 1. Process leading indentation at start of physical line
    if (atLineStart) {
      const indentStart = currentPos();
      let indentWidth = 0;

      while (offset < source.length) {
        const c = peek();
        if (c === " ") {
          indentWidth += 1;
          advance();
        } else if (c === "\t") {
          indentWidth += 2; // Treat 1 tab as 2 spaces
          advance();
        } else {
          break;
        }
      }

      // Check for empty line or newline immediately
      const nextChar = peek();
      if (nextChar === "\r" || nextChar === "\n") {
        if (nextChar === "\r" && peek(1) === "\n") {
          advance();
        }
        advance();
        line++;
        column = 1;
        atLineStart = true;
        continue;
      }

      rawTokens.push({
        kind: "LEADING_INDENT",
        value: source.slice(indentStart.offset, offset),
        span: makeSpan(indentStart),
        indentWidth,
      });

      atLineStart = false;
      continue;
    }

    const ch = peek();

    // 2. Skip inline whitespace (spaces and tabs not at line start)
    if (ch === " " || ch === "\t") {
      advance();
      continue;
    }

    // 3. Physical newlines
    if (ch === "\r" || ch === "\n") {
      const startPos = currentPos();
      if (ch === "\r" && peek(1) === "\n") {
        advance();
      }
      advance();
      const span = makeSpan(startPos);
      rawTokens.push({
        kind: "PHYSICAL_NEWLINE",
        value: "\n",
        span,
      });
      line++;
      column = 1;
      atLineStart = true;
      continue;
    }

    // 4. Hex Color Literals (#fff, #0f172a, #334155, etc.)
    if (ch === "#") {
      const hexMatch = source
        .slice(offset)
        .match(/^#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-zA-Z_-])/);
      if (hexMatch) {
        const startPos = currentPos();
        for (let i = 0; i < hexMatch[0].length; i++) {
          advance();
        }
        rawTokens.push({
          kind: "HEX_COLOR",
          value: hexMatch[0],
          span: makeSpan(startPos),
        });
        continue;
      }
    }

    // 5. Comments (# followed by whitespace, or // or /* ... */)
    const isHashComment =
      ch === "#" &&
      (peek(1) === " " ||
        peek(1) === "\t" ||
        peek(1) === "\r" ||
        peek(1) === "\n" ||
        peek(1) === "\0");
    const isSlashComment = ch === "/" && peek(1) === "/";
    if (isHashComment || isSlashComment) {
      const startPos = currentPos();
      advance(); // consume # or /
      if (ch === "/") {
        advance(); // consume second /
      }

      let commentText = "";
      while (offset < source.length && peek() !== "\n" && peek() !== "\r") {
        commentText += advance();
      }
      const span = makeSpan(startPos);
      const commentToken: CommentToken = {
        value: commentText.trim(),
        span,
        isBlock: false,
      };
      comments.push(commentToken);
      rawTokens.push({
        kind: "COMMENT",
        value: commentText,
        span,
      });
      continue;
    }

    if (ch === "/" && peek(1) === "*") {
      const startPos = currentPos();
      advance(); // consume /
      advance(); // consume *
      let commentText = "";

      while (offset < source.length) {
        if (peek() === "*" && peek(1) === "/") {
          advance();
          advance();
          break;
        }
        if (peek() === "\n") {
          line++;
          column = 0; // advance() will increment to 1
        }
        commentText += advance();
      }

      const span = makeSpan(startPos);
      const commentToken: CommentToken = {
        value: commentText.trim(),
        span,
        isBlock: true,
      };
      comments.push(commentToken);
      rawTokens.push({
        kind: "COMMENT",
        value: commentText,
        span,
      });
      continue;
    }

    // 5. String Literals
    if (ch === '"' || ch === "'") {
      const startPos = currentPos();
      const quoteChar = ch;
      advance();

      // Check for triple quotes (""")
      const isTriple = quoteChar === '"' && peek() === '"' && peek(1) === '"';
      if (isTriple) {
        advance();
        advance();
      }

      let stringVal = "";
      let closed = false;

      while (offset < source.length) {
        if (isTriple) {
          if (peek() === '"' && peek(1) === '"' && peek(2) === '"') {
            advance();
            advance();
            advance();
            closed = true;
            break;
          }
          if (peek() === "\n") {
            line++;
            column = 0;
          }
          stringVal += advance();
        } else {
          const c = peek();
          if (c === quoteChar) {
            advance();
            closed = true;
            break;
          }
          if (c === "\\") {
            advance();
            const esc = advance();
            switch (esc) {
              case "n":
                stringVal += "\n";
                break;
              case "t":
                stringVal += "\t";
                break;
              case "r":
                stringVal += "\r";
                break;
              case '"':
                stringVal += '"';
                break;
              case "'":
                stringVal += "'";
                break;
              case "\\":
                stringVal += "\\";
                break;
              case "0":
                stringVal += "\0";
                break;
              default:
                stringVal += esc;
            }
          } else if (c === "\n" || c === "\r") {
            throw new LexerError(
              "Unterminated string literal: single-line strings cannot cross newlines without triple quotes",
              makeSpan(startPos),
            );
          } else {
            stringVal += advance();
          }
        }
      }

      if (!closed) {
        throw new LexerError("Unclosed string literal", makeSpan(startPos));
      }

      rawTokens.push({
        kind: "STRING",
        value: stringVal,
        span: makeSpan(startPos),
      });
      continue;
    }

    // 6. Number Literals
    if (isDigit(ch) || (ch === "." && isDigit(peek(1)))) {
      const startPos = currentPos();
      let numStr = "";

      // Hex or Binary prefix
      if (ch === "0" && (peek(1) === "x" || peek(1) === "X")) {
        numStr += advance(); // '0'
        numStr += advance(); // 'x'
        while (isHexDigit(peek()) || peek() === "_") {
          const c = advance();
          if (c !== "_") numStr += c;
        }
      } else if (ch === "0" && (peek(1) === "b" || peek(1) === "B")) {
        numStr += advance(); // '0'
        numStr += advance(); // 'b'
        while (peek() === "0" || peek() === "1" || peek() === "_") {
          const c = advance();
          if (c !== "_") numStr += c;
        }
      } else {
        // Decimal int or float
        while (isDigit(peek()) || peek() === "_") {
          const c = advance();
          if (c !== "_") numStr += c;
        }
        if (peek() === "." && isDigit(peek(1))) {
          numStr += advance(); // '.'
          while (isDigit(peek()) || peek() === "_") {
            const c = advance();
            if (c !== "_") numStr += c;
          }
        }
        // Exponent
        if (peek() === "e" || peek() === "E") {
          numStr += advance();
          if (peek() === "+" || peek() === "-") {
            numStr += advance();
          }
          while (isDigit(peek())) {
            numStr += advance();
          }
        }
      }

      rawTokens.push({
        kind: "NUMBER",
        value: numStr,
        span: makeSpan(startPos),
      });
      continue;
    }

    // 7. Identifiers & Keywords
    if (isIdentStart(ch)) {
      const startPos = currentPos();
      let word = "";
      while (isIdentPart(peek())) {
        word += advance();
      }

      const keywordKind = Object.hasOwn(KEYWORDS, word) ? KEYWORDS[word] : undefined;
      rawTokens.push({
        kind: keywordKind ?? "IDENT",
        value: word,
        span: makeSpan(startPos),
      });
      continue;
    }

    // 8. Multi-character and Single-character Operators / Delimiters
    const startPos = currentPos();

    // 2-character operators
    if (ch === "=" && peek(1) === "=") {
      advance();
      advance();
      rawTokens.push({ kind: "EQ_EQ", value: "==", span: makeSpan(startPos) });
      continue;
    }
    if (ch === "!" && peek(1) === "=") {
      advance();
      advance();
      rawTokens.push({ kind: "NOT_EQ", value: "!=", span: makeSpan(startPos) });
      continue;
    }
    if (ch === "<" && peek(1) === "=") {
      advance();
      advance();
      rawTokens.push({ kind: "LT_EQ", value: "<=", span: makeSpan(startPos) });
      continue;
    }
    if (ch === ">" && peek(1) === "=") {
      advance();
      advance();
      rawTokens.push({ kind: "GT_EQ", value: ">=", span: makeSpan(startPos) });
      continue;
    }
    if (ch === "&" && peek(1) === "&") {
      advance();
      advance();
      rawTokens.push({ kind: "AMP_AMP", value: "&&", span: makeSpan(startPos) });
      continue;
    }
    if (ch === "|" && peek(1) === "|") {
      advance();
      advance();
      rawTokens.push({ kind: "PIPE_PIPE", value: "||", span: makeSpan(startPos) });
      continue;
    }
    if (ch === "?" && peek(1) === "?") {
      advance();
      advance();
      rawTokens.push({ kind: "QUESTION_QUESTION", value: "??", span: makeSpan(startPos) });
      continue;
    }
    if (ch === "?" && peek(1) === ".") {
      advance();
      advance();
      rawTokens.push({ kind: "QUESTION_DOT", value: "?.", span: makeSpan(startPos) });
      continue;
    }
    if (ch === "-" && peek(1) === ">") {
      advance();
      advance();
      rawTokens.push({ kind: "ARROW", value: "->", span: makeSpan(startPos) });
      continue;
    }
    if (ch === "=" && peek(1) === ">") {
      advance();
      advance();
      rawTokens.push({ kind: "FAT_ARROW", value: "=>", span: makeSpan(startPos) });
      continue;
    }
    if (ch === ":" && peek(1) === ":") {
      advance();
      advance();
      rawTokens.push({ kind: "COLON_COLON", value: "::", span: makeSpan(startPos) });
      continue;
    }
    if (ch === "." && peek(1) === "." && peek(2) === ".") {
      advance();
      advance();
      advance();
      rawTokens.push({ kind: "ELLIPSIS", value: "...", span: makeSpan(startPos) });
      continue;
    }

    // 1-character operators and delimiters
    advance(); // consume ch
    switch (ch) {
      case "+":
        rawTokens.push({ kind: "PLUS", value: "+", span: makeSpan(startPos) });
        break;
      case "-":
        rawTokens.push({ kind: "MINUS", value: "-", span: makeSpan(startPos) });
        break;
      case "*":
        rawTokens.push({ kind: "STAR", value: "*", span: makeSpan(startPos) });
        break;
      case "/":
        rawTokens.push({ kind: "SLASH", value: "/", span: makeSpan(startPos) });
        break;
      case "%":
        rawTokens.push({ kind: "PERCENT", value: "%", span: makeSpan(startPos) });
        break;
      case "<":
        rawTokens.push({ kind: "LT", value: "<", span: makeSpan(startPos) });
        break;
      case ">":
        rawTokens.push({ kind: "GT", value: ">", span: makeSpan(startPos) });
        break;
      case "=":
        rawTokens.push({ kind: "EQUAL", value: "=", span: makeSpan(startPos) });
        break;
      case "|":
        rawTokens.push({ kind: "PIPE", value: "|", span: makeSpan(startPos) });
        break;
      case "!":
        rawTokens.push({ kind: "BANG", value: "!", span: makeSpan(startPos) });
        break;
      case "?":
        rawTokens.push({ kind: "QUESTION", value: "?", span: makeSpan(startPos) });
        break;
      case ":":
        rawTokens.push({ kind: "COLON", value: ":", span: makeSpan(startPos) });
        break;
      case ",":
        rawTokens.push({ kind: "COMMA", value: ",", span: makeSpan(startPos) });
        break;
      case ".":
        rawTokens.push({ kind: "DOT", value: ".", span: makeSpan(startPos) });
        break;
      case "#":
        rawTokens.push({ kind: "HASH", value: "#", span: makeSpan(startPos) });
        break;
      case ";":
        rawTokens.push({ kind: "SEMICOLON", value: ";", span: makeSpan(startPos) });
        break;
      case "(":
        rawTokens.push({ kind: "LPAREN", value: "(", span: makeSpan(startPos) });
        break;
      case ")":
        rawTokens.push({ kind: "RPAREN", value: ")", span: makeSpan(startPos) });
        break;
      case "[":
        rawTokens.push({ kind: "LBRACKET", value: "[", span: makeSpan(startPos) });
        break;
      case "]":
        rawTokens.push({ kind: "RBRACKET", value: "]", span: makeSpan(startPos) });
        break;
      case "{":
        rawTokens.push({ kind: "LBRACE", value: "{", span: makeSpan(startPos) });
        break;
      case "}":
        rawTokens.push({ kind: "RBRACE", value: "}", span: makeSpan(startPos) });
        break;
      default:
        throw new LexerError(
          `Unexpected character '${ch}' (ASCII ${ch.charCodeAt(0)})`,
          makeSpan(startPos),
        );
    }
  }

  return { rawTokens, comments };
}

/**
 * Stage 2: Indentation Filter Generator.
 * Converts raw tokens into syntactically valid token stream with INDENT, DEDENT, and logical NEWLINEs.
 */
export function filterIndentation(
  rawTokens: RawToken[],
  file = "<anonymous>",
  options: { includeComments?: boolean } = {},
): Token[] {
  const tokens: Token[] = [];
  const indentStack: number[] = [0];
  let bracketDepth = 0;
  let pendingIndent: number | null = null;
  let lineHasTokens = false;
  let lastEmittedKind: TokenKind | null = null;
  let lastSpan: Span = {
    file,
    start: { line: 1, column: 1, offset: 0 },
    end: { line: 1, column: 1, offset: 0 },
  };

  function emitToken(token: Token) {
    tokens.push(token);
    lastEmittedKind = token.kind;
    lastSpan = token.span;
  }

  function emitSynthetic(kind: "NEWLINE" | "INDENT" | "DEDENT" | "EOF", span: Span) {
    emitToken({
      kind,
      value: kind === "NEWLINE" ? "\n" : "",
      span,
    });
  }

  for (const raw of rawTokens) {
    lastSpan = raw.span;

    // Handle leading indentation information
    if (raw.kind === "LEADING_INDENT") {
      pendingIndent = raw.indentWidth ?? 0;
      continue;
    }

    // Handle comments
    if (raw.kind === "COMMENT") {
      if (options.includeComments) {
        emitToken({
          kind: "COMMENT",
          value: raw.value,
          span: raw.span,
        });
      }
      continue;
    }

    // Handle physical newline
    if (raw.kind === "PHYSICAL_NEWLINE") {
      pendingIndent = null;
      if (lineHasTokens && bracketDepth === 0) {
        if (lastEmittedKind !== "NEWLINE" && lastEmittedKind !== "INDENT") {
          emitSynthetic("NEWLINE", raw.span);
        }
      }
      lineHasTokens = false;
      continue;
    }

    // Code token encountered
    if (pendingIndent !== null) {
      if (bracketDepth === 0) {
        const currentIndent = indentStack[indentStack.length - 1];

        if (pendingIndent > currentIndent) {
          indentStack.push(pendingIndent);
          emitSynthetic("INDENT", raw.span);
        } else if (pendingIndent < currentIndent) {
          while (pendingIndent < indentStack[indentStack.length - 1]) {
            indentStack.pop();
            emitSynthetic("DEDENT", raw.span);
          }

          if (indentStack[indentStack.length - 1] !== pendingIndent) {
            throw new LexerError(
              `Inconsistent indentation: unindent of ${pendingIndent} spaces does not match any outer indentation level in [${indentStack.join(", ")}]`,
              raw.span,
              "AIL_E1002_INCONSISTENT_INDENT",
            );
          }
        }
      }
      pendingIndent = null;
    }

    lineHasTokens = true;

    // Update bracket depth
    if (raw.kind === "LPAREN" || raw.kind === "LBRACKET" || raw.kind === "LBRACE") {
      bracketDepth++;
    } else if (raw.kind === "RPAREN" || raw.kind === "RBRACKET" || raw.kind === "RBRACE") {
      bracketDepth = Math.max(0, bracketDepth - 1);
    }

    emitToken({
      kind: raw.kind as TokenKind,
      value: raw.value,
      span: raw.span,
    });
  }

  // End of file handling
  if (lineHasTokens && bracketDepth === 0) {
    if (lastEmittedKind !== "NEWLINE" && lastEmittedKind !== "INDENT") {
      emitSynthetic("NEWLINE", lastSpan);
    }
  }

  while (indentStack.length > 1) {
    indentStack.pop();
    emitSynthetic("DEDENT", lastSpan);
  }

  emitSynthetic("EOF", lastSpan);

  return tokens;
}

/**
 * High-level tokenizer API: scans and filters tokens into clean stream.
 */
export function tokenize(source: string, file = "<anonymous>"): Token[] {
  const { rawTokens } = scanRawTokens(source, file);
  return filterIndentation(rawTokens, file);
}

/**
 * High-level tokenizer API with comments preserved for CST trivia.
 */
export function tokenizeWithTrivia(
  source: string,
  file = "<anonymous>",
): { tokens: Token[]; comments: CommentToken[] } {
  const { rawTokens, comments } = scanRawTokens(source, file);
  const tokens = filterIndentation(rawTokens, file, { includeComments: true });
  return { tokens, comments };
}

// Helpers
function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

function isHexDigit(ch: string): boolean {
  return isDigit(ch) || (ch >= "a" && ch <= "f") || (ch >= "A" && ch <= "F");
}

function isIdentStart(ch: string): boolean {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_";
}

function isIdentPart(ch: string): boolean {
  return isIdentStart(ch) || isDigit(ch);
}
