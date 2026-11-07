/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Modern Python 3.10+ Decompiler (Reverse Transpiler) for AICE 2.0.
 * Dedicated zero-dependency streaming indentation-aware lexer (PythonLexer)
 * and recursive-descent / Pratt parser (PythonDecompiler):
 *   - Tracks indentation stack to emit INDENT and DEDENT tokens.
 *   - Parses @dataclass classes into AICE records or classes with typed fields.
 *   - Parses standard classes, methods, constructors (def __init__(self, ...)).
 *   - Parses def and async def functions with typed parameters and return types.
 *   - Parses expressions (await, binary, unary, call, member access, list/dict/set literals).
 *   - Parses control flow (if, elif, else, while, for x in xs, try/except/finally, return, raise).
 *   - Parses Python 3.10+ match / case into AICE MatchStmt with patterns and guards.
 *   - Extracts docstrings ("""...""") and # comments into CstTriviaTable.
 *   - Lowers into canonical AICE AST Module.
 *   - Exports decompilePython(source: string, filePath?: string): DecompileResult.
 */

import type {
  ArrayLiteralExpr,
  AssignOp,
  AssignStmt,
  AwaitExpr,
  BinaryExpr,
  BinaryOp,
  Block,
  BreakStmt,
  CallExpr,
  ClassDecl,
  ConstDecl,
  ContinueStmt,
  Expr,
  ExprStmt,
  ForStmt,
  FunctionDecl,
  IdentifierExpr,
  IfStmt,
  ImportDecl,
  IndexExpr,
  LetBinding,
  LiteralExpr,
  MatchCase,
  MatchStmt,
  MemberAccessExpr,
  MethodDecl,
  Module,
  ModuleItem,
  ParamDecl,
  Pattern,
  PropertyDecl,
  RecordLiteralExpr,
  ReturnStmt,
  Statement,
  TemplateLiteralExpr,
  ThrowStmt,
  TryStmt,
  TypeDecl,
  TypeExpr,
  UnaryExpr,
  VarDecl,
  WhileStmt,
} from "../core/ast.js";
import { emptySpan, type Span } from "../core/span.js";
import { CstTriviaTable, getNodeTriviaId, type TriviaItem } from "../core/trivia.js";
import { AiceGenerator, type AiceGeneratorOptions } from "./aice-generator.js";

function makeSpan(
  file: string,
  startLine: number,
  startCol: number,
  startOffset: number,
  endLine: number,
  endCol: number,
  endOffset: number,
): Span {
  return {
    file,
    start: { line: startLine, column: startCol, offset: startOffset },
    end: { line: endLine, column: endCol, offset: endOffset },
  };
}

// =============================================================================
// TOKEN DEFINITIONS & LEXER
// =============================================================================

export type PythonTokenKind =
  | "NEWLINE"
  | "INDENT"
  | "DEDENT"
  | "EOF"
  | "DEF"
  | "ASYNC"
  | "AWAIT"
  | "CLASS"
  | "RETURN"
  | "IF"
  | "ELIF"
  | "ELSE"
  | "WHILE"
  | "FOR"
  | "IN"
  | "TRY"
  | "EXCEPT"
  | "FINALLY"
  | "RAISE"
  | "PASS"
  | "BREAK"
  | "CONTINUE"
  | "IMPORT"
  | "FROM"
  | "AS"
  | "AND"
  | "OR"
  | "NOT"
  | "IS"
  | "LAMBDA"
  | "MATCH"
  | "CASE"
  | "TRUE"
  | "FALSE"
  | "NONE"
  | "IDENTIFIER"
  | "NUMBER"
  | "STRING"
  | "FSTRING"
  | "AT"
  | "ARROW"
  | "WALRUS"
  | "COLON"
  | "COMMA"
  | "DOT"
  | "SEMICOLON"
  | "LPAREN"
  | "RPAREN"
  | "LBRACKET"
  | "RBRACKET"
  | "LBRACE"
  | "RBRACE"
  | "EQUAL"
  | "EQ_EQUAL"
  | "NOT_EQUAL"
  | "LESS"
  | "LESS_EQUAL"
  | "GREATER"
  | "GREATER_EQUAL"
  | "PLUS"
  | "MINUS"
  | "STAR"
  | "STAR_STAR"
  | "SLASH"
  | "SLASH_SLASH"
  | "PERCENT"
  | "AMPERSAND"
  | "PIPE"
  | "CARET"
  | "TILDE"
  | "LSHIFT"
  | "RSHIFT"
  | "PLUS_EQUAL"
  | "MINUS_EQUAL"
  | "STAR_EQUAL"
  | "SLASH_EQUAL"
  | "SLASH_SLASH_EQUAL"
  | "PERCENT_EQUAL"
  | "STAR_STAR_EQUAL"
  | "AMPERSAND_EQUAL"
  | "PIPE_EQUAL"
  | "CARET_EQUAL"
  | "LSHIFT_EQUAL"
  | "RSHIFT_EQUAL"
  | "COMMENT";

export interface PythonToken {
  kind: PythonTokenKind;
  value: string;
  span: Span;
  isFString?: boolean;
}

const PYTHON_KEYWORDS: Record<string, PythonTokenKind> = {
  def: "DEF",
  async: "ASYNC",
  await: "AWAIT",
  class: "CLASS",
  return: "RETURN",
  if: "IF",
  elif: "ELIF",
  else: "ELSE",
  while: "WHILE",
  for: "FOR",
  in: "IN",
  try: "TRY",
  except: "EXCEPT",
  finally: "FINALLY",
  raise: "RAISE",
  pass: "PASS",
  break: "BREAK",
  continue: "CONTINUE",
  import: "IMPORT",
  from: "FROM",
  as: "AS",
  and: "AND",
  or: "OR",
  not: "NOT",
  is: "IS",
  lambda: "LAMBDA",
  match: "MATCH",
  case: "CASE",
  True: "TRUE",
  False: "FALSE",
  None: "NONE",
};

export class PythonLexer {
  private source: string;
  private filePath: string;
  private pos = 0;
  private line = 1;
  private column = 1;
  private indentStack: number[] = [0];
  private bracketDepth = 0;
  private atLineStart = true;

  constructor(source: string, filePath = "source.py") {
    this.source = source;
    this.filePath = filePath;
  }

  tokenize(): PythonToken[] {
    const tokens: PythonToken[] = [];

    while (this.pos < this.source.length) {
      if (this.atLineStart) {
        if (this.bracketDepth > 0) {
          this.atLineStart = false;
        } else {
          let spaces = 0;
          let p = this.pos;
          while (p < this.source.length) {
            const ch = this.source[p];
            if (ch === " ") {
              spaces += 1;
              p++;
            } else if (ch === "\t") {
              spaces += 4;
              p++;
            } else {
              break;
            }
          }

          if (p >= this.source.length) {
            this.pos = p;
            break;
          }

          const nextCh = this.source[p];
          if (nextCh === "\r" || nextCh === "\n") {
            // Empty line
            this.pos = p;
            if (this.source[this.pos] === "\r" && this.source[this.pos + 1] === "\n") {
              this.pos += 2;
            } else {
              this.pos += 1;
            }
            this.line++;
            this.column = 1;
            continue;
          }

          if (nextCh === "#") {
            // Comment-only line: scan comment, do not alter indent stack
            const startLine = this.line;
            const startCol = this.column + spaces;
            const startOffset = p;
            let endP = p;
            while (endP < this.source.length && this.source[endP] !== "\n" && this.source[endP] !== "\r") {
              endP++;
            }
            const commentText = this.source.slice(p, endP);
            const commentSpan = makeSpan(
              this.filePath,
              startLine,
              startCol,
              startOffset,
              this.line,
              startCol + commentText.length,
              endP,
            );
            tokens.push({
              kind: "COMMENT",
              value: commentText,
              span: commentSpan,
            });

            this.pos = endP;
            if (this.pos < this.source.length) {
              if (this.source[this.pos] === "\r" && this.source[this.pos + 1] === "\n") {
                this.pos += 2;
              } else {
                this.pos += 1;
              }
              this.line++;
              this.column = 1;
            }
            continue;
          }

          // Non-empty line with code: process indentation
          this.pos = p;
          this.column += spaces;
          const currentIndent = spaces;
          const prevIndent = this.indentStack[this.indentStack.length - 1];

          if (currentIndent > prevIndent) {
            this.indentStack.push(currentIndent);
            tokens.push({
              kind: "INDENT",
              value: "",
              span: makeSpan(this.filePath, this.line, 1, this.pos - spaces, this.line, this.column, this.pos),
            });
          } else if (currentIndent < prevIndent) {
            while (
              this.indentStack.length > 1 &&
              this.indentStack[this.indentStack.length - 1] > currentIndent
            ) {
              this.indentStack.pop();
              tokens.push({
                kind: "DEDENT",
                value: "",
                span: makeSpan(this.filePath, this.line, 1, this.pos - spaces, this.line, this.column, this.pos),
              });
            }
          }
          this.atLineStart = false;
        }
      }

      // Skip intra-line whitespace
      if (this.pos >= this.source.length) break;
      const ch = this.source[this.pos];

      if (ch === " " || ch === "\t") {
        this.pos++;
        this.column++;
        continue;
      }

      // Explicit line continuation backslash
      if (ch === "\\") {
        if (
          this.source[this.pos + 1] === "\n" ||
          (this.source[this.pos + 1] === "\r" && this.source[this.pos + 2] === "\n")
        ) {
          const skip = this.source[this.pos + 1] === "\r" ? 3 : 2;
          this.pos += skip;
          this.line++;
          this.column = 1;
          continue;
        }
      }

      // Newline
      if (ch === "\r" || ch === "\n") {
        const isCrlf = ch === "\r" && this.source[this.pos + 1] === "\n";
        const len = isCrlf ? 2 : 1;
        const span = makeSpan(this.filePath, this.line, this.column, this.pos, this.line, this.column + len, this.pos + len);
        this.pos += len;
        this.line++;
        this.column = 1;

        if (this.bracketDepth === 0) {
          if (tokens.length > 0) {
            const last = tokens[tokens.length - 1].kind;
            if (last !== "NEWLINE" && last !== "INDENT") {
              tokens.push({ kind: "NEWLINE", value: "\n", span });
            }
          }
          this.atLineStart = true;
        }
        continue;
      }

      // Comments
      if (ch === "#") {
        const startLine = this.line;
        const startCol = this.column;
        const startOffset = this.pos;
        let endP = this.pos;
        while (endP < this.source.length && this.source[endP] !== "\n" && this.source[endP] !== "\r") {
          endP++;
        }
        const comment = this.source.slice(this.pos, endP);
        this.column += comment.length;
        this.pos = endP;
        tokens.push({
          kind: "COMMENT",
          value: comment,
          span: makeSpan(this.filePath, startLine, startCol, startOffset, this.line, this.column, this.pos),
        });
        continue;
      }

      // Brackets
      if (ch === "(" || ch === "[" || ch === "{") {
        this.bracketDepth++;
        const kind: PythonTokenKind = ch === "(" ? "LPAREN" : ch === "[" ? "LBRACKET" : "LBRACE";
        tokens.push({
          kind,
          value: ch,
          span: makeSpan(this.filePath, this.line, this.column, this.pos, this.line, this.column + 1, this.pos + 1),
        });
        this.pos++;
        this.column++;
        continue;
      }

      if (ch === ")" || ch === "]" || ch === "}") {
        this.bracketDepth = Math.max(0, this.bracketDepth - 1);
        const kind: PythonTokenKind = ch === ")" ? "RPAREN" : ch === "]" ? "RBRACKET" : "RBRACE";
        tokens.push({
          kind,
          value: ch,
          span: makeSpan(this.filePath, this.line, this.column, this.pos, this.line, this.column + 1, this.pos + 1),
        });
        this.pos++;
        this.column++;
        continue;
      }

      // String literals (regular, f-strings, triple-quoted)
      const strToken = this.tryLexString();
      if (strToken) {
        tokens.push(strToken);
        continue;
      }

      // Numbers
      if (this.isDigit(ch) || (ch === "." && this.isDigit(this.source[this.pos + 1]))) {
        tokens.push(this.lexNumber());
        continue;
      }

      // Operators and punctuation
      const opToken = this.lexOperatorOrPunctuation();
      if (opToken) {
        tokens.push(opToken);
        continue;
      }

      // Identifiers and Keywords
      if (this.isIdentStart(ch)) {
        tokens.push(this.lexIdentifierOrKeyword());
        continue;
      }

      // Unknown character, skip
      this.pos++;
      this.column++;
    }

    if (tokens.length > 0 && tokens[tokens.length - 1].kind !== "NEWLINE") {
      tokens.push({
        kind: "NEWLINE",
        value: "\n",
        span: makeSpan(this.filePath, this.line, this.column, this.pos, this.line, this.column, this.pos),
      });
    }

    while (this.indentStack.length > 1) {
      this.indentStack.pop();
      tokens.push({
        kind: "DEDENT",
        value: "",
        span: makeSpan(this.filePath, this.line, this.column, this.pos, this.line, this.column, this.pos),
      });
    }

    tokens.push({
      kind: "EOF",
      value: "",
      span: makeSpan(this.filePath, this.line, this.column, this.pos, this.line, this.column, this.pos),
    });

    return tokens;
  }

  private tryLexString(): PythonToken | null {
    let p = this.pos;
    let isFString = false;

    // Check for string prefixes: r, u, f, b, rf, fr, etc.
    let prefix = "";
    while (p < this.source.length && /[rRuUfFbB]/.test(this.source[p])) {
      prefix += this.source[p].toLowerCase();
      p++;
    }

    if (p >= this.source.length) return null;
    const quote = this.source[p];
    if (quote !== '"' && quote !== "'") return null;

    if (prefix.includes("f")) {
      isFString = true;
    }

    const startLine = this.line;
    const startCol = this.column;
    const startOffset = this.pos;

    // Check for triple quotes
    const isTriple =
      p + 2 < this.source.length &&
      this.source[p + 1] === quote &&
      this.source[p + 2] === quote;

    if (isTriple) {
      p += 3;
      let content = "";
      while (p < this.source.length) {
        if (
          this.source[p] === quote &&
          this.source[p + 1] === quote &&
          this.source[p + 2] === quote
        ) {
          p += 3;
          break;
        }
        if (this.source[p] === "\\") {
          content += this.source[p];
          p++;
          if (p < this.source.length) {
            content += this.source[p];
            p++;
          }
          continue;
        }
        if (this.source[p] === "\n") {
          this.line++;
          this.column = 1;
        } else {
          this.column++;
        }
        content += this.source[p];
        p++;
      }

      this.pos = p;
      return {
        kind: isFString ? "FSTRING" : "STRING",
        value: content,
        isFString,
        span: makeSpan(this.filePath, startLine, startCol, startOffset, this.line, this.column, this.pos),
      };
    }

    // Single quoted string
    p++;
    let content = "";
    while (p < this.source.length) {
      const ch = this.source[p];
      if (ch === quote) {
        p++;
        break;
      }
      if (ch === "\n" || ch === "\r") {
        break; // Unterminated single line string
      }
      if (ch === "\\") {
        content += ch;
        p++;
        if (p < this.source.length) {
          content += this.source[p];
          p++;
        }
        continue;
      }
      content += ch;
      p++;
    }

    const len = p - this.pos;
    this.column += len;
    this.pos = p;

    return {
      kind: isFString ? "FSTRING" : "STRING",
      value: content,
      isFString,
      span: makeSpan(this.filePath, startLine, startCol, startOffset, this.line, this.column, this.pos),
    };
  }

  private isDigit(ch?: string): boolean {
    return !!ch && ch >= "0" && ch <= "9";
  }

  private isIdentStart(ch?: string): boolean {
    return !!ch && ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_");
  }

  private isIdentPart(ch?: string): boolean {
    return this.isIdentStart(ch) || this.isDigit(ch);
  }

  private lexNumber(): PythonToken {
    const startLine = this.line;
    const startCol = this.column;
    const startOffset = this.pos;

    let p = this.pos;
    if (this.source[p] === "0" && /[xXbBoO]/.test(this.source[p + 1])) {
      p += 2;
      while (p < this.source.length && /[0-9a-fA-F_]/.test(this.source[p])) {
        p++;
      }
    } else {
      while (p < this.source.length && (this.isDigit(this.source[p]) || this.source[p] === "_")) {
        p++;
      }
      if (this.source[p] === "." && this.isDigit(this.source[p + 1])) {
        p++;
        while (p < this.source.length && (this.isDigit(this.source[p]) || this.source[p] === "_")) {
          p++;
        }
      }
      if (/[eE]/.test(this.source[p])) {
        p++;
        if (this.source[p] === "+" || this.source[p] === "-") p++;
        while (p < this.source.length && (this.isDigit(this.source[p]) || this.source[p] === "_")) {
          p++;
        }
      }
    }

    const numStr = this.source.slice(this.pos, p);
    this.column += numStr.length;
    this.pos = p;

    return {
      kind: "NUMBER",
      value: numStr.replace(/_/g, ""),
      span: makeSpan(this.filePath, startLine, startCol, startOffset, this.line, this.column, this.pos),
    };
  }

  private lexIdentifierOrKeyword(): PythonToken {
    const startLine = this.line;
    const startCol = this.column;
    const startOffset = this.pos;

    let p = this.pos;
    while (p < this.source.length && this.isIdentPart(this.source[p])) {
      p++;
    }

    const word = this.source.slice(this.pos, p);
    this.column += word.length;
    this.pos = p;

    const kw = PYTHON_KEYWORDS[word];
    return {
      kind: kw ?? "IDENTIFIER",
      value: word,
      span: makeSpan(this.filePath, startLine, startCol, startOffset, this.line, this.column, this.pos),
    };
  }

  private lexOperatorOrPunctuation(): PythonToken | null {
    const two = this.source.slice(this.pos, this.pos + 2);
    const three = this.source.slice(this.pos, this.pos + 3);
    const startLine = this.line;
    const startCol = this.column;
    const startOffset = this.pos;

    if (three === "//=") return this.makeOp("SLASH_SLASH_EQUAL", 3, startLine, startCol, startOffset);
    if (three === "**=") return this.makeOp("STAR_STAR_EQUAL", 3, startLine, startCol, startOffset);
    if (three === "<<=") return this.makeOp("LSHIFT_EQUAL", 3, startLine, startCol, startOffset);
    if (three === ">>=") return this.makeOp("RSHIFT_EQUAL", 3, startLine, startCol, startOffset);

    if (two === "->") return this.makeOp("ARROW", 2, startLine, startCol, startOffset);
    if (two === ":=") return this.makeOp("WALRUS", 2, startLine, startCol, startOffset);
    if (two === "==") return this.makeOp("EQ_EQUAL", 2, startLine, startCol, startOffset);
    if (two === "!=") return this.makeOp("NOT_EQUAL", 2, startLine, startCol, startOffset);
    if (two === "<=") return this.makeOp("LESS_EQUAL", 2, startLine, startCol, startOffset);
    if (two === ">=") return this.makeOp("GREATER_EQUAL", 2, startLine, startCol, startOffset);
    if (two === "//") return this.makeOp("SLASH_SLASH", 2, startLine, startCol, startOffset);
    if (two === "**") return this.makeOp("STAR_STAR", 2, startLine, startCol, startOffset);
    if (two === "<<") return this.makeOp("LSHIFT", 2, startLine, startCol, startOffset);
    if (two === ">>") return this.makeOp("RSHIFT", 2, startLine, startCol, startOffset);
    if (two === "+=") return this.makeOp("PLUS_EQUAL", 2, startLine, startCol, startOffset);
    if (two === "-=") return this.makeOp("MINUS_EQUAL", 2, startLine, startCol, startOffset);
    if (two === "*=") return this.makeOp("STAR_EQUAL", 2, startLine, startCol, startOffset);
    if (two === "/=") return this.makeOp("SLASH_EQUAL", 2, startLine, startCol, startOffset);
    if (two === "%=") return this.makeOp("PERCENT_EQUAL", 2, startLine, startCol, startOffset);
    if (two === "&=") return this.makeOp("AMPERSAND_EQUAL", 2, startLine, startCol, startOffset);
    if (two === "|=") return this.makeOp("PIPE_EQUAL", 2, startLine, startCol, startOffset);
    if (two === "^=") return this.makeOp("CARET_EQUAL", 2, startLine, startCol, startOffset);

    const one = this.source[this.pos];
    const opMap: Record<string, PythonTokenKind> = {
      "@": "AT",
      ":": "COLON",
      ",": "COMMA",
      ".": "DOT",
      ";": "SEMICOLON",
      "=": "EQUAL",
      "+": "PLUS",
      "-": "MINUS",
      "*": "STAR",
      "/": "SLASH",
      "%": "PERCENT",
      "&": "AMPERSAND",
      "|": "PIPE",
      "^": "CARET",
      "~": "TILDE",
      "<": "LESS",
      ">": "GREATER",
    };

    if (opMap[one]) {
      return this.makeOp(opMap[one], 1, startLine, startCol, startOffset);
    }

    return null;
  }

  private makeOp(kind: PythonTokenKind, len: number, sLine: number, sCol: number, sOffset: number): PythonToken {
    const val = this.source.slice(this.pos, this.pos + len);
    this.pos += len;
    this.column += len;
    return {
      kind,
      value: val,
      span: makeSpan(this.filePath, sLine, sCol, sOffset, this.line, this.column, this.pos),
    };
  }
}

// =============================================================================
// PARSER & DECOMPILER
// =============================================================================

export interface PythonDecompilerOptions {
  preserveSourceSlices?: boolean;
}

interface Decorator {
  name: string;
  args?: Expr[];
  span: Span;
}

export class PythonDecompiler {
  private source: string;
  private filePath: string;
  private tokens: PythonToken[] = [];
  private pos = 0;
  private trivia: CstTriviaTable = new CstTriviaTable();
  private pendingTrivia: TriviaItem[] = [];
  private currentScope: Set<string> = new Set();

  constructor(source: string, filePath = "source.py") {
    this.source = source;
    this.filePath = filePath;
    this.trivia.setOriginalSource(source);
  }

  decompile(): { ast: Module; trivia: CstTriviaTable } {
    const lexer = new PythonLexer(this.source, this.filePath);
    this.tokens = lexer.tokenize();
    this.pos = 0;
    this.pendingTrivia = [];

    const items: ModuleItem[] = [];
    let isFirstItem = true;

    while (!this.check("EOF")) {
      this.skipNewlines();
      if (this.check("EOF")) break;

      // Module-level docstring check
      if (isFirstItem && this.check("STRING")) {
        const docTok = this.advance();
        this.trivia.addLeadingTrivia("module", {
          kind: "DOCSTRING",
          content: docTok.value,
        });
        isFirstItem = false;
        this.skipNewlines();
        continue;
      }
      isFirstItem = false;

      const item = this.parseTopLevelItem();
      if (item) {
        items.push(item);
        const nodeId = getNodeTriviaId(item);
        if (nodeId && item.span) {
          const slice = this.source.slice(item.span.start.offset, item.span.end.offset);
          this.trivia.setSourceSlice(nodeId, slice, undefined, item.span);
        }
      }
      this.skipNewlines();
    }

    const baseName =
      this.filePath
        .split(/[/\\]/)
        .pop()
        ?.replace(/\.(py|aice)$/i, "")
        .replace(/[^a-zA-Z0-9_]/g, "_") || "main";

    const ast: Module = {
      kind: "Module",
      path: baseName,
      items,
      span: emptySpan(this.filePath),
    };

    return { ast, trivia: this.trivia };
  }

  private current(): PythonToken {
    return this.tokens[this.pos] ?? { kind: "EOF", value: "", span: emptySpan(this.filePath) };
  }

  private peek(n = 1): PythonToken {
    return this.tokens[this.pos + n] ?? { kind: "EOF", value: "", span: emptySpan(this.filePath) };
  }

  private check(kind: PythonTokenKind): boolean {
    return this.current().kind === kind;
  }

  private advance(): PythonToken {
    const tok = this.current();
    if (tok.kind !== "EOF") {
      this.pos++;
    }
    return tok;
  }

  private consume(kind: PythonTokenKind, msg = `Expected ${kind}`): PythonToken {
    if (this.check(kind)) {
      return this.advance();
    }
    throw new Error(`${msg}, found ${this.current().kind} ('${this.current().value}') at line ${this.current().span.start.line}`);
  }

  private skipNewlines(): void {
    while (this.check("NEWLINE") || this.check("COMMENT")) {
      if (this.check("COMMENT")) {
        const cTok = this.advance();
        this.pendingTrivia.push({
          kind: "LINE_COMMENT",
          content: cTok.value,
          span: cTok.span,
        });
      } else {
        this.advance();
      }
    }
  }

  private attachTrivia(nodeId: string): void {
    if (this.pendingTrivia.length > 0) {
      this.trivia.setTrivia(nodeId, {
        nodeId,
        leading: [...this.pendingTrivia],
        trailing: [],
      });
      this.pendingTrivia = [];
    }
  }

  private parseTopLevelItem(): ModuleItem | null {
    // Collect decorators
    const decorators: Decorator[] = [];
    while (this.check("AT")) {
      const atTok = this.advance();
      const decName = this.parseDottedName();
      let decArgs: Expr[] | undefined;
      if (this.check("LPAREN")) {
        this.advance();
        decArgs = this.parseArgList();
        this.consume("RPAREN");
      }
      decorators.push({ name: decName, args: decArgs, span: atTok.span });
      this.skipNewlines();
    }

    if (this.check("IMPORT") || this.check("FROM")) {
      return this.parseImportDecl();
    }

    if (this.check("CLASS")) {
      return this.parseClassDecl(decorators);
    }

    if (this.check("DEF") || (this.check("ASYNC") && this.peek().kind === "DEF")) {
      return this.parseFunctionDecl(decorators);
    }

    // Top-level variable assignment
    if (this.check("IDENTIFIER")) {
      const startSpan = this.current().span;
      const identName = this.advance().value;

      let typeAnnotation: TypeExpr | undefined;
      if (this.check("COLON")) {
        this.advance();
        typeAnnotation = this.parseTypeExpr();
      }

      if (this.check("EQUAL")) {
        this.advance();
        const value = this.parseExpr();
        this.attachTrivia(`var:${identName}`);
        return {
          kind: "VarDecl",
          name: identName,
          isExported: true,
          isMut: true,
          typeAnnotation,
          value,
          span: makeSpan(this.filePath, startSpan.start.line, startSpan.start.column, startSpan.start.offset, value.span.end.line, value.span.end.column, value.span.end.offset),
        };
      }
    }

    // Skip unhandled token to avoid infinite loop
    this.advance();
    return null;
  }

  private parseDottedName(): string {
    let name = this.consume("IDENTIFIER").value;
    while (this.check("DOT")) {
      this.advance();
      name += "." + this.consume("IDENTIFIER").value;
    }
    return name;
  }

  private parseImportDecl(): ImportDecl {
    const startSpan = this.current().span;

    if (this.check("FROM")) {
      this.advance(); // consume from
      let source = "";
      while (this.check("DOT")) {
        source += ".";
        this.advance();
      }
      if (this.check("IDENTIFIER")) {
        source += this.parseDottedName();
      }
      this.consume("IMPORT");

      const specifiers: { name: string; alias?: string; isWildcard?: boolean; span: Span }[] = [];

      if (this.check("STAR")) {
        this.advance();
        specifiers.push({ name: "*", isWildcard: true, span: startSpan });
      } else {
        const hasParens = this.check("LPAREN");
        if (hasParens) this.advance();

        while (!this.check("NEWLINE") && !this.check("EOF") && (!hasParens || !this.check("RPAREN"))) {
          this.skipNewlines();
          if (this.check("IDENTIFIER")) {
            const sName = this.advance().value;
            let sAlias: string | undefined;
            if (this.check("AS")) {
              this.advance();
              sAlias = this.consume("IDENTIFIER").value;
            }
            specifiers.push({ name: sName, alias: sAlias, span: startSpan });
          }
          if (this.check("COMMA")) {
            this.advance();
          } else {
            break;
          }
        }

        if (hasParens) {
          this.consume("RPAREN");
        }
      }

      const endToken = this.tokens[this.pos - 1] ?? this.current();
      const fullSpan = makeSpan(
        this.filePath,
        startSpan.start.line,
        startSpan.start.column,
        startSpan.start.offset,
        endToken.span.end.line,
        endToken.span.end.column,
        endToken.span.end.offset,
      );

      this.attachTrivia(`import:${source}`);
      return {
        kind: "ImportDecl",
        source,
        specifiers,
        span: fullSpan,
      };
    } else {
      this.consume("IMPORT");
      const source = this.parseDottedName();
      let alias: string | undefined;
      if (this.check("AS")) {
        this.advance();
        alias = this.consume("IDENTIFIER").value;
      }
      const endToken = this.tokens[this.pos - 1] ?? this.current();
      const fullSpan = makeSpan(
        this.filePath,
        startSpan.start.line,
        startSpan.start.column,
        startSpan.start.offset,
        endToken.span.end.line,
        endToken.span.end.column,
        endToken.span.end.offset,
      );
      this.attachTrivia(`import:${source}`);
      return {
        kind: "ImportDecl",
        source,
        specifiers: alias ? [{ name: source, alias, span: fullSpan }] : [],
        span: fullSpan,
      };
    }
  }

  private parseClassDecl(decorators: Decorator[]): ClassDecl {
    const startSpan = decorators.length > 0 ? decorators[0].span : this.current().span;
    const isDataclass = decorators.some((d) => d.name === "dataclass");

    this.consume("CLASS");
    const name = this.consume("IDENTIFIER").value;

    let extendsName: string | undefined;
    if (this.check("LPAREN")) {
      this.advance();
      if (!this.check("RPAREN")) {
        extendsName = this.parseDottedName();
        while (!this.check("RPAREN") && !this.check("EOF")) {
          this.advance();
        }
      }
      this.consume("RPAREN");
    }

    this.consume("COLON");
    this.skipNewlines();

    const properties: PropertyDecl[] = [];
    const methods: MethodDecl[] = [];

    this.consume("INDENT");

    let isFirst = true;
    while (!this.check("DEDENT") && !this.check("EOF")) {
      this.skipNewlines();
      if (this.check("DEDENT") || this.check("EOF")) break;

      // Class docstring
      if (isFirst && this.check("STRING")) {
        const docTok = this.advance();
        this.trivia.addLeadingTrivia(`class:${name}`, {
          kind: "DOCSTRING",
          content: docTok.value,
        });
        isFirst = false;
        this.skipNewlines();
        continue;
      }
      isFirst = false;

      if (this.check("PASS")) {
        this.advance();
        this.skipNewlines();
        continue;
      }

      // Method decorators
      const methodDecorators: Decorator[] = [];
      while (this.check("AT")) {
        const mAt = this.advance();
        const mName = this.parseDottedName();
        if (this.check("LPAREN")) {
          this.advance();
          while (!this.check("RPAREN") && !this.check("EOF")) this.advance();
          this.consume("RPAREN");
        }
        methodDecorators.push({ name: mName, span: mAt.span });
        this.skipNewlines();
      }

      // Method declaration: def or async def
      if (this.check("DEF") || (this.check("ASYNC") && this.peek().kind === "DEF")) {
        const method = this.parseMethodDecl(methodDecorators, name);
        methods.push(method);
        this.skipNewlines();
        continue;
      }

      // Class property: prop: type = default
      if (this.check("IDENTIFIER")) {
        const pSpan = this.current().span;
        const propName = this.advance().value;
        let typeAnnotation: TypeExpr | undefined;
        if (this.check("COLON")) {
          this.advance();
          typeAnnotation = this.parseTypeExpr();
        }
        let initialValue: Expr | undefined;
        if (this.check("EQUAL")) {
          this.advance();
          initialValue = this.parseExpr();
        }
        const pNodeId = `field:${name}.${propName}`;
        this.attachTrivia(pNodeId);
        properties.push({
          kind: "PropertyDecl",
          name: propName,
          typeAnnotation,
          initialValue,
          isStatic: false,
          isReadonly: false,
          span: pSpan,
        });
        this.skipNewlines();
        continue;
      }

      this.advance();
    }

    this.consume("DEDENT");

    const endPos =
      methods.length > 0
        ? methods[methods.length - 1].span.end
        : properties.length > 0
          ? properties[properties.length - 1].span.end
          : (this.tokens[this.pos - 2]?.span.end ?? startSpan.end);

    const fullSpan = makeSpan(
      this.filePath,
      startSpan.start.line,
      startSpan.start.column,
      startSpan.start.offset,
      endPos.line,
      endPos.column,
      endPos.offset,
    );

    const classNodeId = `class:${name}`;
    this.attachTrivia(classNodeId);
    if (isDataclass) {
      this.trivia.setTrivia(`is_dataclass:${name}`, {
        nodeId: `is_dataclass:${name}`,
        leading: [{ kind: "LINE_COMMENT", content: "@dataclass" }],
        trailing: [],
      });
    }

    return {
      kind: "ClassDecl",
      name,
      extends: extendsName,
      typeParams: [],
      properties,
      methods,
      isExported: true,
      span: fullSpan,
    };
  }

  private parseMethodDecl(decorators: Decorator[], className: string): MethodDecl {
    const startSpan = decorators.length > 0 ? decorators[0].span : this.current().span;
    const isAsync = this.check("ASYNC");
    if (isAsync) this.advance();
    this.consume("DEF");

    const origName = this.consume("IDENTIFIER").value;
    const isInit = origName === "__init__";
    const methodName = isInit ? "constructor" : origName;

    const isStatic = decorators.some((d) => d.name === "staticmethod");

    this.consume("LPAREN");
    const rawParams = this.parseParamList();
    this.consume("RPAREN");

    // Filter out self/cls if not static
    const effectiveParams =
      !isStatic && rawParams.length > 0 && (rawParams[0].name === "self" || rawParams[0].name === "cls")
        ? rawParams.slice(1)
        : rawParams;

    let returnType: TypeExpr | null = null;
    if (this.check("ARROW")) {
      this.advance();
      returnType = this.parseTypeExpr();
    }

    this.consume("COLON");
    this.skipNewlines();

    const mNodeId = `method:${className}.${methodName}`;
    const prevScope = new Set(this.currentScope);
    this.currentScope = new Set(effectiveParams.map((p) => p.name));
    this.currentScope.add("this");
    let body: Block;
    try {
      body = this.parseBlock(mNodeId);
    } finally {
      this.currentScope = prevScope;
    }

    this.attachTrivia(mNodeId);

    return {
      kind: "MethodDecl",
      name: methodName,
      isStatic,
      isAsync,
      params: effectiveParams,
      returnType,
      body,
      isExpressionBodied: false,
      span: makeSpan(
        this.filePath,
        startSpan.start.line,
        startSpan.start.column,
        startSpan.start.offset,
        body.span.end.line,
        body.span.end.column,
        body.span.end.offset,
      ),
    };
  }

  private parseFunctionDecl(decorators: Decorator[]): FunctionDecl {
    const startSpan = decorators.length > 0 ? decorators[0].span : this.current().span;
    const isAsync = this.check("ASYNC");
    if (isAsync) this.advance();
    this.consume("DEF");

    const name = this.consume("IDENTIFIER").value;

    this.consume("LPAREN");
    const params = this.parseParamList();
    this.consume("RPAREN");

    let returnType: TypeExpr | null = null;
    if (this.check("ARROW")) {
      this.advance();
      returnType = this.parseTypeExpr();
    }

    this.consume("COLON");
    this.skipNewlines();

    const fnNodeId = `fn:${name}`;
    const prevScope = new Set(this.currentScope);
    this.currentScope = new Set(params.map((p) => p.name));
    let body: Block;
    try {
      body = this.parseBlock(fnNodeId);
    } finally {
      this.currentScope = prevScope;
    }

    this.attachTrivia(fnNodeId);

    return {
      kind: "FunctionDecl",
      name,
      isAsync,
      params,
      returnType,
      body,
      isExpressionBodied: false,
      span: makeSpan(
        this.filePath,
        startSpan.start.line,
        startSpan.start.column,
        startSpan.start.offset,
        body.span.end.line,
        body.span.end.column,
        body.span.end.offset,
      ),
    };
  }

  private parseParamList(): ParamDecl[] {
    const params: ParamDecl[] = [];
    while (!this.check("RPAREN") && !this.check("EOF")) {
      this.skipNewlines();
      if (this.check("RPAREN") || this.check("EOF")) break;

      const pSpan = this.current().span;
      let pName = "";
      if (this.check("STAR")) {
        this.advance();
        pName = "*" + (this.check("IDENTIFIER") ? this.advance().value : "");
      } else if (this.check("STAR_STAR")) {
        this.advance();
        pName = "**" + (this.check("IDENTIFIER") ? this.advance().value : "");
      } else {
        pName = this.consume("IDENTIFIER").value;
      }

      let typeAnnotation: TypeExpr | null = null;
      if (this.check("COLON")) {
        this.advance();
        typeAnnotation = this.parseTypeExpr();
      }

      let defaultValue: Expr | undefined;
      if (this.check("EQUAL")) {
        this.advance();
        defaultValue = this.parseExpr();
      }

      params.push({
        name: pName,
        typeAnnotation,
        defaultValue,
        span: pSpan,
      });

      if (this.check("COMMA")) {
        this.advance();
      } else {
        break;
      }
    }
    return params;
  }

  private parseBlock(nodeId?: string): Block {
    const stmts: Statement[] = [];
    const startSpan = this.current().span;

    if (this.check("INDENT")) {
      this.advance();
      let isFirst = true;
      while (!this.check("DEDENT") && !this.check("EOF")) {
        this.skipNewlines();
        if (this.check("DEDENT") || this.check("EOF")) break;

        // Docstring inside function/method/class
        if (isFirst && this.check("STRING") && nodeId) {
          const docTok = this.advance();
          this.trivia.addLeadingTrivia(nodeId, {
            kind: "DOCSTRING",
            content: docTok.value,
          });
          isFirst = false;
          this.skipNewlines();
          continue;
        }
        isFirst = false;

        if (this.check("PASS")) {
          this.advance();
          this.skipNewlines();
          continue;
        }

        const stmt = this.parseStatement();
        if (stmt) {
          stmts.push(stmt);
        }
        this.skipNewlines();
      }
      this.consume("DEDENT");
    } else {
      if (this.check("PASS")) {
        this.advance();
      } else {
        const stmt = this.parseStatement();
        if (stmt) stmts.push(stmt);
      }
      this.skipNewlines();
    }

    const endPos =
      stmts.length > 0
        ? stmts[stmts.length - 1].span.end
        : (this.tokens[this.pos - 2]?.span.end ?? startSpan.end);

    return {
      kind: "Block",
      statements: stmts,
      span: makeSpan(
        this.filePath,
        startSpan.start.line,
        startSpan.start.column,
        startSpan.start.offset,
        endPos.line,
        endPos.column,
        endPos.offset,
      ),
    };
  }

  private parseStatement(): Statement | null {
    if (this.check("RETURN")) {
      const retSpan = this.advance().span;
      let val: Expr | null = null;
      if (!this.check("NEWLINE") && !this.check("DEDENT") && !this.check("EOF")) {
        val = this.parseExpr();
      }
      return {
        kind: "ReturnStmt",
        value: val,
        span: val ? makeSpan(this.filePath, retSpan.start.line, retSpan.start.column, retSpan.start.offset, val.span.end.line, val.span.end.column, val.span.end.offset) : retSpan,
      };
    }

    if (this.check("RAISE")) {
      const raiseSpan = this.advance().span;
      const expr = this.parseExpr();
      return {
        kind: "ThrowStmt",
        expr,
        span: makeSpan(this.filePath, raiseSpan.start.line, raiseSpan.start.column, raiseSpan.start.offset, expr.span.end.line, expr.span.end.column, expr.span.end.offset),
      };
    }

    if (this.check("BREAK")) {
      return { kind: "BreakStmt", span: this.advance().span };
    }

    if (this.check("CONTINUE")) {
      return { kind: "ContinueStmt", span: this.advance().span };
    }

    if (this.check("IF")) {
      return this.parseIfStmt();
    }

    if (this.check("WHILE")) {
      const startSpan = this.advance().span;
      const condition = this.parseExpr();
      this.consume("COLON");
      this.skipNewlines();
      const body = this.parseBlock();
      return {
        kind: "WhileStmt",
        condition,
        body,
        span: makeSpan(this.filePath, startSpan.start.line, startSpan.start.column, startSpan.start.offset, body.span.end.line, body.span.end.column, body.span.end.offset),
      };
    }

    if (this.check("FOR")) {
      const startSpan = this.advance().span;
      const variable = this.parseForVariable();
      if (variable.startsWith("[") && variable.endsWith("]")) {
        const parts = variable.slice(1, -1).split(",").map((s) => s.trim());
        for (const p of parts) if (p) this.currentScope.add(p);
      } else {
        this.currentScope.add(variable);
      }
      this.consume("IN");
      const iterable = this.parseExpr();
      this.consume("COLON");
      this.skipNewlines();
      const body = this.parseBlock();
      return {
        kind: "ForStmt",
        variable,
        iterable,
        body,
        span: makeSpan(this.filePath, startSpan.start.line, startSpan.start.column, startSpan.start.offset, body.span.end.line, body.span.end.column, body.span.end.offset),
      };
    }

    if (this.check("TRY")) {
      return this.parseTryStmt();
    }

    if (this.check("MATCH")) {
      return this.parseMatchStmt();
    }

    // Assignment or expression statement
    const expr = this.parseExpr();

    let typeAnnotation: TypeExpr | null = null;
    if (this.check("COLON")) {
      this.advance();
      typeAnnotation = this.parseTypeExpr();
    }

    if (this.isAssignOp(this.current().kind)) {
      const opTok = this.advance();
      const op = this.toAssignOp(opTok.kind);
      const value = this.parseExpr();

      if (
        op === "=" &&
        expr.kind === "IdentifierExpr" &&
        !this.currentScope.has(expr.name) &&
        expr.name !== "this"
      ) {
        this.currentScope.add(expr.name);
        return {
          kind: "LetBinding",
          name: expr.name,
          isMut: true,
          typeAnnotation,
          init: value,
          span: makeSpan(this.filePath, expr.span.start.line, expr.span.start.column, expr.span.start.offset, value.span.end.line, value.span.end.column, value.span.end.offset),
        };
      }

      return {
        kind: "AssignStmt",
        target: expr,
        op,
        value,
        span: makeSpan(this.filePath, expr.span.start.line, expr.span.start.column, expr.span.start.offset, value.span.end.line, value.span.end.column, value.span.end.offset),
      };
    }

    if (typeAnnotation !== null && expr.kind === "IdentifierExpr") {
      this.currentScope.add(expr.name);
      return {
        kind: "LetBinding",
        name: expr.name,
        isMut: true,
        typeAnnotation,
        init: {
          kind: "LiteralExpr",
          literalKind: "nil",
          value: null,
          rawValue: "None",
          span: expr.span,
        },
        span: expr.span,
      };
    }

    return {
      kind: "ExprStmt",
      expr,
      span: expr.span,
    };
  }

  private parseForVariable(): string {
    if (this.check("LPAREN") || this.check("LBRACKET")) {
      const isParen = this.check("LPAREN");
      this.advance();
      const parts: string[] = [];
      while (!this.check(isParen ? "RPAREN" : "RBRACKET") && !this.check("EOF")) {
        if (this.check("IDENTIFIER")) parts.push(this.advance().value);
        if (this.check("COMMA")) this.advance();
        else break;
      }
      this.consume(isParen ? "RPAREN" : "RBRACKET");
      return `[${parts.join(", ")}]`;
    }
    const first = this.consume("IDENTIFIER").value;
    if (this.check("COMMA")) {
      const parts: string[] = [first];
      while (this.check("COMMA")) {
        this.advance();
        if (this.check("IDENTIFIER")) {
          parts.push(this.advance().value);
        } else {
          break;
        }
      }
      return `[${parts.join(", ")}]`;
    }
    return first;
  }

  private parseIfStmt(): IfStmt {
    const startSpan = this.advance().span; // consume if
    const condition = this.parseExpr();
    this.consume("COLON");
    this.skipNewlines();
    const thenBranch = this.parseBlock();

    const elifBranches: { condition: Expr; body: Block; span: Span }[] = [];
    while (this.check("ELIF")) {
      const elifSpan = this.advance().span;
      const eCond = this.parseExpr();
      this.consume("COLON");
      this.skipNewlines();
      const eBody = this.parseBlock();
      elifBranches.push({
        condition: eCond,
        body: eBody,
        span: makeSpan(this.filePath, elifSpan.start.line, elifSpan.start.column, elifSpan.start.offset, eBody.span.end.line, eBody.span.end.column, eBody.span.end.offset),
      });
    }

    let elseBranch: Block | null = null;
    if (this.check("ELSE")) {
      this.advance();
      this.consume("COLON");
      this.skipNewlines();
      elseBranch = this.parseBlock();
    }

    const endSpan = elseBranch?.span ?? (elifBranches.length > 0 ? elifBranches[elifBranches.length - 1].body.span : thenBranch.span);

    return {
      kind: "IfStmt",
      condition,
      thenBranch,
      elifBranches,
      elseBranch,
      span: makeSpan(this.filePath, startSpan.start.line, startSpan.start.column, startSpan.start.offset, endSpan.end.line, endSpan.end.column, endSpan.end.offset),
    };
  }

  private parseTryStmt(): TryStmt {
    const startSpan = this.advance().span; // consume try
    this.consume("COLON");
    this.skipNewlines();
    const tryBlock = this.parseBlock();

    let catchParam: string | undefined;
    let catchBlock: Block | undefined;
    let finallyBlock: Block | undefined;

    if (this.check("EXCEPT")) {
      this.advance();
      if (!this.check("COLON")) {
        this.parseExpr(); // Exception class
        if (this.check("AS")) {
          this.advance();
          catchParam = this.consume("IDENTIFIER").value;
        }
      }
      this.consume("COLON");
      this.skipNewlines();
      catchBlock = this.parseBlock();
    }

    if (this.check("FINALLY")) {
      this.advance();
      this.consume("COLON");
      this.skipNewlines();
      finallyBlock = this.parseBlock();
    }

    const endSpan = finallyBlock?.span ?? catchBlock?.span ?? tryBlock.span;

    return {
      kind: "TryStmt",
      tryBlock,
      catchParam,
      catchBlock,
      finallyBlock,
      span: makeSpan(this.filePath, startSpan.start.line, startSpan.start.column, startSpan.start.offset, endSpan.end.line, endSpan.end.column, endSpan.end.offset),
    };
  }

  private parseMatchStmt(): MatchStmt {
    const startSpan = this.advance().span; // consume match
    const target = this.parseExpr();
    this.consume("COLON");
    this.skipNewlines();
    this.consume("INDENT");

    const cases: MatchCase[] = [];
    while (!this.check("DEDENT") && !this.check("EOF")) {
      this.skipNewlines();
      if (this.check("DEDENT") || this.check("EOF")) break;

      const caseSpan = this.consume("CASE").span;
      const pattern = this.parsePattern();

      let guard: Expr | undefined;
      if (this.check("IF")) {
        this.advance();
        guard = this.parseExpr();
      }

      this.consume("COLON");
      this.skipNewlines();
      const body = this.parseBlock();

      cases.push({
        pattern,
        guard,
        body,
        span: makeSpan(this.filePath, caseSpan.start.line, caseSpan.start.column, caseSpan.start.offset, body.span.end.line, body.span.end.column, body.span.end.offset),
      });
      this.skipNewlines();
    }

    this.consume("DEDENT");

    const endPos =
      cases.length > 0
        ? cases[cases.length - 1].body.span.end
        : (this.tokens[this.pos - 2]?.span.end ?? startSpan.end);

    return {
      kind: "MatchStmt",
      target,
      cases,
      span: makeSpan(
        this.filePath,
        startSpan.start.line,
        startSpan.start.column,
        startSpan.start.offset,
        endPos.line,
        endPos.column,
        endPos.offset,
      ),
    };
  }

  private parsePattern(): Pattern {
    if (this.check("IDENTIFIER") && this.current().value === "_") {
      this.advance();
      return { kind: "WildcardPattern", span: emptySpan(this.filePath) };
    }

    if (
      this.check("NUMBER") ||
      this.check("STRING") ||
      this.check("TRUE") ||
      this.check("FALSE") ||
      this.check("NONE")
    ) {
      const val = this.parseLiteralExpr();
      return { kind: "LiteralPattern", value: val, span: val.span };
    }

    if (this.check("IDENTIFIER")) {
      const name = this.advance().value;
      if (this.check("LPAREN")) {
        this.advance();
        const subPatterns: Pattern[] = [];
        while (!this.check("RPAREN") && !this.check("EOF")) {
          subPatterns.push(this.parsePattern());
          if (this.check("COMMA")) this.advance();
          else break;
        }
        this.consume("RPAREN");
        return { kind: "ConstructorPattern", name, subPatterns, span: emptySpan(this.filePath) };
      }
      return { kind: "IdentifierPattern", name, span: emptySpan(this.filePath) };
    }

    this.advance();
    return { kind: "WildcardPattern", span: emptySpan(this.filePath) };
  }

  // Expressions & Precedence Climbing
  private parseExpr(): Expr {
    let left = this.parseBinaryExpr(0);
    if (this.check("IF")) {
      this.advance();
      const condition = this.parseBinaryExpr(0);
      if (this.check("ELSE")) {
        this.advance();
        const alternate = this.parseExpr();
        return {
          kind: "BinaryExpr",
          operator: "or",
          left: {
            kind: "BinaryExpr",
            operator: "and",
            left: condition,
            right: left,
            span: makeSpan(
              this.filePath,
              left.span.start.line,
              left.span.start.column,
              left.span.start.offset,
              condition.span.end.line,
              condition.span.end.column,
              condition.span.end.offset,
            ),
          },
          right: alternate,
          span: makeSpan(
            this.filePath,
            left.span.start.line,
            left.span.start.column,
            left.span.start.offset,
            alternate.span.end.line,
            alternate.span.end.column,
            alternate.span.end.offset,
          ),
        };
      }
    }
    return left;
  }

  private getPrecedence(kind: PythonTokenKind): number {
    switch (kind) {
      case "OR":
        return 1;
      case "AND":
        return 2;
      case "PIPE":
        return 3;
      case "CARET":
        return 4;
      case "AMPERSAND":
        return 5;
      case "EQ_EQUAL":
      case "NOT_EQUAL":
      case "LESS":
      case "LESS_EQUAL":
      case "GREATER":
      case "GREATER_EQUAL":
      case "IS":
      case "IN":
        return 6;
      case "LSHIFT":
      case "RSHIFT":
        return 7;
      case "PLUS":
      case "MINUS":
        return 8;
      case "STAR":
      case "SLASH":
      case "SLASH_SLASH":
      case "PERCENT":
        return 9;
      case "STAR_STAR":
        return 11;
      default:
        return 0;
    }
  }

  private parseBinaryExpr(minPrec: number): Expr {
    let left = this.parseUnaryExpr();

    while (true) {
      const kind = this.current().kind;
      const prec = this.getPrecedence(kind);
      if (prec <= minPrec) break;

      const opTok = this.advance();
      let op: BinaryOp = "+";

      switch (opTok.kind) {
        case "OR":
          op = "||";
          break;
        case "AND":
          op = "&&";
          break;
        case "PIPE":
          op = "|";
          break;
        case "CARET":
          op = "^";
          break;
        case "AMPERSAND":
          op = "&";
          break;
        case "EQ_EQUAL":
          op = "==";
          break;
        case "NOT_EQUAL":
          op = "!=";
          break;
        case "LESS":
          op = "<";
          break;
        case "LESS_EQUAL":
          op = "<=";
          break;
        case "GREATER":
          op = ">";
          break;
        case "GREATER_EQUAL":
          op = ">=";
          break;
        case "IS":
          if (this.check("NOT")) {
            this.advance();
            op = "!=";
          } else {
            op = "==";
          }
          break;
        case "IN":
          op = "in";
          break;
        case "LSHIFT":
          op = "<<";
          break;
        case "RSHIFT":
          op = ">>";
          break;
        case "PLUS":
          op = "+";
          break;
        case "MINUS":
          op = "-";
          break;
        case "STAR":
          op = "*";
          break;
        case "SLASH":
        case "SLASH_SLASH":
          op = "/";
          break;
        case "PERCENT":
          op = "%";
          break;
        case "STAR_STAR":
          op = "**";
          break;
      }

      const nextMinPrec = opTok.kind === "STAR_STAR" ? prec - 1 : prec;
      const right = this.parseBinaryExpr(nextMinPrec);

      left = {
        kind: "BinaryExpr",
        operator: op,
        left,
        right,
        span: makeSpan(this.filePath, left.span.start.line, left.span.start.column, left.span.start.offset, right.span.end.line, right.span.end.column, right.span.end.offset),
      };
    }

    return left;
  }

  private parseUnaryExpr(): Expr {
    if (this.check("AWAIT")) {
      const startSpan = this.advance().span;
      const operand = this.parseUnaryExpr();
      return {
        kind: "AwaitExpr",
        operand,
        span: makeSpan(this.filePath, startSpan.start.line, startSpan.start.column, startSpan.start.offset, operand.span.end.line, operand.span.end.column, operand.span.end.offset),
      };
    }

    if (this.check("NOT")) {
      const startSpan = this.advance().span;
      const operand = this.parseUnaryExpr();
      return {
        kind: "UnaryExpr",
        operator: "!",
        operand,
        span: makeSpan(this.filePath, startSpan.start.line, startSpan.start.column, startSpan.start.offset, operand.span.end.line, operand.span.end.column, operand.span.end.offset),
      };
    }

    if (this.check("MINUS") || this.check("PLUS") || this.check("TILDE")) {
      const opTok = this.advance();
      const operand = this.parseUnaryExpr();
      return {
        kind: "UnaryExpr",
        operator: (opTok.kind === "MINUS" ? "-" : opTok.kind === "PLUS" ? "+" : "~") as any,
        operand,
        span: makeSpan(this.filePath, opTok.span.start.line, opTok.span.start.column, opTok.span.start.offset, operand.span.end.line, operand.span.end.column, operand.span.end.offset),
      };
    }

    return this.parsePostfixExpr();
  }

  private parsePostfixExpr(): Expr {
    let expr = this.parsePrimaryExpr();

    while (true) {
      if (this.check("DOT")) {
        this.advance();
        const propTok = this.consume("IDENTIFIER");
        expr = {
          kind: "MemberAccessExpr",
          object: expr,
          property: propTok.value,
          isSafeNav: false,
          span: makeSpan(this.filePath, expr.span.start.line, expr.span.start.column, expr.span.start.offset, propTok.span.end.line, propTok.span.end.column, propTok.span.end.offset),
        };
        continue;
      }

      if (this.check("LPAREN")) {
        this.advance();
        const args = this.parseArgList();
        const rParen = this.consume("RPAREN");
        expr = {
          kind: "CallExpr",
          callee: expr,
          args,
          span: makeSpan(this.filePath, expr.span.start.line, expr.span.start.column, expr.span.start.offset, rParen.span.end.line, rParen.span.end.column, rParen.span.end.offset),
        };
        continue;
      }

      if (this.check("LBRACKET")) {
        this.advance();
        let startIndex: Expr | undefined;
        if (!this.check("COLON")) {
          startIndex = this.parseExpr();
        }
        if (this.check("COLON")) {
          this.advance();
          let endIndex: Expr | undefined;
          if (!this.check("RBRACKET")) {
            endIndex = this.parseExpr();
          }
          const rBracket = this.consume("RBRACKET");
          const args: Expr[] = [];
          if (startIndex) {
            args.push(startIndex);
          } else {
            args.push({ kind: "LiteralExpr", literalKind: "number", value: 0, rawValue: "0", span: emptySpan(this.filePath) });
          }
          if (endIndex) {
            args.push(endIndex);
          }
          expr = {
            kind: "CallExpr",
            callee: {
              kind: "MemberAccessExpr",
              object: expr,
              property: "slice",
              isSafeNav: false,
              span: makeSpan(this.filePath, expr.span.start.line, expr.span.start.column, expr.span.start.offset, rBracket.span.end.line, rBracket.span.end.column, rBracket.span.end.offset),
            },
            args,
            span: makeSpan(this.filePath, expr.span.start.line, expr.span.start.column, expr.span.start.offset, rBracket.span.end.line, rBracket.span.end.column, rBracket.span.end.offset),
          };
          continue;
        }
        const indices: Expr[] = startIndex ? [startIndex] : [];
        while (this.check("COMMA")) {
          this.advance();
          if (!this.check("RBRACKET")) {
            indices.push(this.parseExpr());
          }
        }
        const rBracket = this.consume("RBRACKET");
        const finalIndex: Expr = indices.length === 1 ? indices[0] : {
          kind: "ArrayLiteralExpr",
          elements: indices,
          span: makeSpan(this.filePath, expr.span.start.line, expr.span.start.column, expr.span.start.offset, rBracket.span.end.line, rBracket.span.end.column, rBracket.span.end.offset),
        };
        expr = {
          kind: "IndexExpr",
          object: expr,
          index: finalIndex,
          span: makeSpan(this.filePath, expr.span.start.line, expr.span.start.column, expr.span.start.offset, rBracket.span.end.line, rBracket.span.end.column, rBracket.span.end.offset),
        };
        continue;
      }

      break;
    }

    return expr;
  }

  private parsePrimaryExpr(): Expr {
    if (this.check("TRUE") || this.check("FALSE") || this.check("NONE") || this.check("NUMBER") || this.check("STRING")) {
      return this.parseLiteralExpr();
    }

    if (this.check("FSTRING")) {
      return this.parseFStringExpr();
    }

    if (this.check("IDENTIFIER")) {
      const tok = this.advance();
      const name = tok.value === "self" ? "this" : tok.value;

      // Walrus assignment: (x := val)
      if (this.check("WALRUS")) {
        this.advance();
        const val = this.parseExpr();
        return {
          kind: "AssignExpr",
          target: { kind: "IdentifierExpr", name, span: tok.span },
          op: "=",
          value: val,
          span: makeSpan(this.filePath, tok.span.start.line, tok.span.start.column, tok.span.start.offset, val.span.end.line, val.span.end.column, val.span.end.offset),
        };
      }

      return {
        kind: "IdentifierExpr",
        name,
        span: tok.span,
      };
    }

    // List literal: [1, 2, 3] or list comprehension: [expr for x in iterable]
    if (this.check("LBRACKET")) {
      const startSpan = this.advance().span;
      const elements: Expr[] = [];
      if (!this.check("RBRACKET") && !this.check("EOF")) {
        const firstExpr = this.parseExpr();
        if (this.check("FOR")) {
          this.advance();
          const varName = this.parseForVariable();
          this.consume("IN");
          const iterableExpr = this.parseExpr();
          let mappedIterable: Expr = iterableExpr;
          if (this.check("IF")) {
            this.advance();
            const filterCond = this.parseExpr();
            mappedIterable = {
              kind: "CallExpr",
              callee: { kind: "IdentifierExpr", name: "filter", span: startSpan },
              args: [
                {
                  kind: "ClosureExpr",
                  params: [{ name: varName, typeAnnotation: null, span: startSpan }],
                  returnType: null,
                  body: filterCond,
                  span: startSpan,
                },
                iterableExpr,
              ],
              span: startSpan,
            };
          }
          const endSpan = this.consume("RBRACKET").span;
          const fullSpan = makeSpan(
            this.filePath,
            startSpan.start.line,
            startSpan.start.column,
            startSpan.start.offset,
            endSpan.end.line,
            endSpan.end.column,
            endSpan.end.offset,
          );
          return {
            kind: "CallExpr",
            callee: { kind: "IdentifierExpr", name: "list", span: fullSpan },
            args: [
              {
                kind: "CallExpr",
                callee: { kind: "IdentifierExpr", name: "map", span: fullSpan },
                args: [
                  {
                    kind: "ClosureExpr",
                    params: [{ name: varName, typeAnnotation: null, span: fullSpan }],
                    returnType: null,
                    body: firstExpr,
                    span: fullSpan,
                  },
                  mappedIterable,
                ],
                span: fullSpan,
              },
            ],
            span: fullSpan,
          };
        }
        elements.push(firstExpr);
        if (this.check("COMMA")) {
          this.advance();
          while (!this.check("RBRACKET") && !this.check("EOF")) {
            elements.push(this.parseExpr());
            if (this.check("COMMA")) this.advance();
            else break;
          }
        }
      }
      const endSpan = this.consume("RBRACKET").span;
      return {
        kind: "ArrayLiteralExpr",
        elements,
        span: makeSpan(this.filePath, startSpan.start.line, startSpan.start.column, startSpan.start.offset, endSpan.end.line, endSpan.end.column, endSpan.end.offset),
      };
    }

    // Dict literal: {"key": value}
    if (this.check("LBRACE")) {
      const startSpan = this.advance().span;
      const properties: { key?: string; value: Expr; isSpread?: boolean; span: Span }[] = [];
      while (!this.check("RBRACE") && !this.check("EOF")) {
        if (this.check("STAR_STAR")) {
          this.advance();
          const spreadVal = this.parseExpr();
          properties.push({
            value: spreadVal,
            isSpread: true,
            span: spreadVal.span,
          });
        } else {
          const keyExpr = this.parseExpr();
          this.consume("COLON");
          const valExpr = this.parseExpr();
          let keyStr: string;
          if (keyExpr.kind === "LiteralExpr" && typeof keyExpr.value === "string") {
            keyStr = keyExpr.value;
          } else if (keyExpr.kind === "LiteralExpr" && typeof keyExpr.value === "number") {
            keyStr = String(keyExpr.value);
            if (!keyStr.includes(".")) keyStr += ".0";
          } else if (keyExpr.kind === "IdentifierExpr") {
            keyStr = keyExpr.name;
          } else {
            keyStr = "key";
          }
          properties.push({
            key: keyStr,
            value: valExpr,
            span: makeSpan(this.filePath, keyExpr.span.start.line, keyExpr.span.start.column, keyExpr.span.start.offset, valExpr.span.end.line, valExpr.span.end.column, valExpr.span.end.offset),
          });
        }
        if (this.check("COMMA")) this.advance();
        else break;
      }
      const endSpan = this.consume("RBRACE").span;
      return {
        kind: "RecordLiteralExpr",
        properties,
        span: makeSpan(this.filePath, startSpan.start.line, startSpan.start.column, startSpan.start.offset, endSpan.end.line, endSpan.end.column, endSpan.end.offset),
      };
    }

    // Parenthesized expression: (expr) or tuple (a, b, c) or ()
    if (this.check("LPAREN")) {
      const lParenSpan = this.advance().span;
      if (this.check("RPAREN")) {
        const rParenSpan = this.advance().span;
        return {
          kind: "ArrayLiteralExpr",
          elements: [],
          span: makeSpan(this.filePath, lParenSpan.start.line, lParenSpan.start.column, lParenSpan.start.offset, rParenSpan.end.line, rParenSpan.end.column, rParenSpan.end.offset),
        };
      }
      const first = this.parseExpr();
      if (this.check("COMMA")) {
        const elements = [first];
        while (this.check("COMMA")) {
          this.advance();
          if (this.check("RPAREN")) break;
          elements.push(this.parseExpr());
        }
        const rParenSpan = this.consume("RPAREN").span;
        return {
          kind: "ArrayLiteralExpr",
          elements,
          span: makeSpan(this.filePath, lParenSpan.start.line, lParenSpan.start.column, lParenSpan.start.offset, rParenSpan.end.line, rParenSpan.end.column, rParenSpan.end.offset),
        };
      }
      const rParenSpan = this.consume("RPAREN").span;
      first.span = makeSpan(
        this.filePath,
        lParenSpan.start.line,
        lParenSpan.start.column,
        lParenSpan.start.offset,
        rParenSpan.end.line,
        rParenSpan.end.column,
        rParenSpan.end.offset,
      );
      return first;
    }

    // Fallback
    const fallbackTok = this.advance();
    return {
      kind: "LiteralExpr",
      literalKind: "nil",
      value: null,
      rawValue: "nil",
      span: fallbackTok.span,
    };
  }

  private parseLiteralExpr(): LiteralExpr {
    const tok = this.advance();
    if (tok.kind === "TRUE") {
      return { kind: "LiteralExpr", literalKind: "boolean", value: true, rawValue: "True", span: tok.span };
    }
    if (tok.kind === "FALSE") {
      return { kind: "LiteralExpr", literalKind: "boolean", value: false, rawValue: "False", span: tok.span };
    }
    if (tok.kind === "NONE") {
      return { kind: "LiteralExpr", literalKind: "nil", value: null, rawValue: "None", span: tok.span };
    }
    if (tok.kind === "NUMBER") {
      const numVal = tok.value.includes(".") ? parseFloat(tok.value) : parseInt(tok.value, 10);
      return { kind: "LiteralExpr", literalKind: "number", value: numVal, rawValue: tok.value, span: tok.span };
    }
    return { kind: "LiteralExpr", literalKind: "string", value: tok.value, rawValue: JSON.stringify(tok.value), span: tok.span };
  }

  private parseFStringExpr(): TemplateLiteralExpr {
    const tok = this.advance();
    const raw = tok.value;

    const quasis: string[] = [];
    const expressions: Expr[] = [];

    let current = "";
    let i = 0;
    while (i < raw.length) {
      if (raw[i] === "{" && raw[i + 1] === "{") {
        current += "{";
        i += 2;
        continue;
      }
      if (raw[i] === "}" && raw[i + 1] === "}") {
        current += "}";
        i += 2;
        continue;
      }
      if (raw[i] === "{") {
        quasis.push(current);
        current = "";
        i++;
        let exprStr = "";
        while (i < raw.length && raw[i] !== "}") {
          exprStr += raw[i];
          i++;
        }
        if (i < raw.length && raw[i] === "}") i++;
        expressions.push({
          kind: "IdentifierExpr",
          name: exprStr.trim(),
          span: tok.span,
        });
        continue;
      }
      current += raw[i];
      i++;
    }
    quasis.push(current);

    return {
      kind: "TemplateLiteralExpr",
      quasis,
      expressions,
      span: tok.span,
    };
  }

  private parseArgList(): Expr[] {
    const args: Expr[] = [];
    while (!this.check("RPAREN") && !this.check("EOF")) {
      if (this.check("IDENTIFIER") && this.peek().kind === "EQUAL") {
        // Keyword argument: name=value -> value
        this.advance(); // name
        this.advance(); // =
      }
      args.push(this.parseExpr());
      if (this.check("COMMA")) {
        this.advance();
      } else {
        break;
      }
    }
    return args;
  }

  private parseTypeExpr(): TypeExpr {
    let typeExpr = this.parsePrimaryTypeExpr();

    // Python 3.10+ Union: T | None or T | U
    while (this.check("PIPE")) {
      this.advance();
      const nextType = this.parsePrimaryTypeExpr();
      if (
        (nextType.kind === "PrimitiveType" && (nextType.primitive === "nil" || nextType.primitive === "void")) ||
        (typeExpr.kind === "PrimitiveType" && (typeExpr.primitive === "nil" || typeExpr.primitive === "void"))
      ) {
        const inner =
          nextType.kind === "PrimitiveType" && (nextType.primitive === "nil" || nextType.primitive === "void")
            ? typeExpr
            : nextType;
        typeExpr = { kind: "OptionType", innerType: inner, span: emptySpan(this.filePath) };
      }
    }

    return typeExpr;
  }

  private parsePrimaryTypeExpr(): TypeExpr {
    if (this.check("NONE")) {
      this.advance();
      return { kind: "PrimitiveType", primitive: "void", span: emptySpan(this.filePath) };
    }

    if (this.check("STRING")) {
      const strTok = this.advance();
      const rawName = strTok.value.replace(/^['"]|['"]$/g, "").trim();
      return { kind: "NamedType", name: rawName, span: strTok.span };
    }

    const tok = this.consume("IDENTIFIER");
    const name = tok.value;

    if (name === "int") return { kind: "PrimitiveType", primitive: "int", span: tok.span };
    if (name === "float") return { kind: "PrimitiveType", primitive: "float", span: tok.span };
    if (name === "str") return { kind: "PrimitiveType", primitive: "str", span: tok.span };
    if (name === "bool") return { kind: "PrimitiveType", primitive: "bool", span: tok.span };
    if (name === "None") return { kind: "PrimitiveType", primitive: "void", span: tok.span };
    if (name === "Any" || name === "object") return { kind: "NamedType", name: "any", span: tok.span };

    if (name === "list" || name === "List") {
      if (this.check("LBRACKET")) {
        this.advance();
        const elem = this.parseTypeExpr();
        this.consume("RBRACKET");
        return { kind: "ArrayType", elementType: elem, span: tok.span };
      }
      return { kind: "ArrayType", elementType: { kind: "NamedType", name: "any", span: tok.span }, span: tok.span };
    }

    if (name === "dict" || name === "Dict") {
      if (this.check("LBRACKET")) {
        this.advance();
        const kType = this.parseTypeExpr();
        this.consume("COMMA");
        const vType = this.parseTypeExpr();
        this.consume("RBRACKET");
        return { kind: "NamedType", name: "dict", typeArgs: [kType, vType], span: tok.span };
      }
      return { kind: "NamedType", name: "dict", span: tok.span };
    }

    if (name === "tuple" || name === "Tuple") {
      if (this.check("LBRACKET")) {
        this.advance();
        const elementTypes: TypeExpr[] = [];
        while (!this.check("RBRACKET") && !this.check("EOF")) {
          elementTypes.push(this.parseTypeExpr());
          if (this.check("COMMA")) this.advance();
          else break;
        }
        this.consume("RBRACKET");
        return { kind: "TupleType", elementTypes, span: tok.span };
      }
      return { kind: "TupleType", elementTypes: [], span: tok.span };
    }

    if (name === "Optional") {
      this.consume("LBRACKET");
      const inner = this.parseTypeExpr();
      this.consume("RBRACKET");
      return { kind: "OptionType", innerType: inner, span: tok.span };
    }

    let typeArgs: TypeExpr[] | undefined;
    if (this.check("LBRACKET")) {
      this.advance();
      typeArgs = [];
      while (!this.check("RBRACKET") && !this.check("EOF")) {
        typeArgs.push(this.parseTypeExpr());
        if (this.check("COMMA")) this.advance();
        else break;
      }
      this.consume("RBRACKET");
    }

    return { kind: "NamedType", name, typeArgs, span: tok.span };
  }

  private isAssignOp(kind: PythonTokenKind): boolean {
    return (
      kind === "EQUAL" ||
      kind === "PLUS_EQUAL" ||
      kind === "MINUS_EQUAL" ||
      kind === "STAR_EQUAL" ||
      kind === "SLASH_EQUAL" ||
      kind === "SLASH_SLASH_EQUAL" ||
      kind === "PERCENT_EQUAL" ||
      kind === "STAR_STAR_EQUAL" ||
      kind === "AMPERSAND_EQUAL" ||
      kind === "PIPE_EQUAL" ||
      kind === "CARET_EQUAL" ||
      kind === "LSHIFT_EQUAL" ||
      kind === "RSHIFT_EQUAL"
    );
  }

  private toAssignOp(kind: PythonTokenKind): AssignOp {
    switch (kind) {
      case "PLUS_EQUAL":
        return "+=";
      case "MINUS_EQUAL":
        return "-=";
      case "STAR_EQUAL":
        return "*=";
      case "SLASH_EQUAL":
      case "SLASH_SLASH_EQUAL":
        return "/=";
      case "PERCENT_EQUAL":
        return "%=";
      case "STAR_STAR_EQUAL":
        return "**=";
      case "AMPERSAND_EQUAL":
        return "&=";
      case "PIPE_EQUAL":
        return "|=";
      case "CARET_EQUAL":
        return "^=";
      case "LSHIFT_EQUAL":
        return "<<=";
      case "RSHIFT_EQUAL":
        return ">>=";
      case "EQUAL":
      default:
        return "=";
    }
  }
}

export function decompilePython(
  source: string,
  filePath = "source.py",
  options: AiceGeneratorOptions = {},
): { ast: Module; aice: string; trivia: CstTriviaTable } {
  const decompiler = new PythonDecompiler(source, filePath);
  const result = decompiler.decompile();
  const generator = new AiceGenerator({ ...options, trivia: result.trivia });
  const aice = generator.generate(result.ast);
  return { ast: result.ast, aice, trivia: result.trivia };
}
