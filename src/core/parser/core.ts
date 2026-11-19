/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Core parser error type, Pratt operator precedence tables, `ParserBase`
 * token cursor/lookahead primitives, and the `ParserHost` cross-module contract.
 */

import type {
  Block,
  ComponentDecl,
  Expr,
  ParamDecl,
  Statement,
  StyleDecl,
  TypeExpr,
} from "../ast.js";
import { emptySpan, type Span } from "../span.js";
import { KEYWORDS, type Token, type TokenKind } from "../tokens.js";

export class ParserError extends Error {
  readonly span: Span;
  readonly code: string;

  constructor(message: string, span: Span, code = "AICE_E1003_PARSER_ERROR") {
    super(`${message} at ${span.file}:${span.start.line}:${span.start.column}`);
    this.name = "ParserError";
    this.span = span;
    this.code = code;
  }
}

export enum Precedence {
  LOWEST = 1,
  ASSIGN = 2, // =
  TERNARY = 3, // cond ? thenExpr : elseExpr
  OR = 4, // or, ||
  AND = 5, // and, &&
  COALESCE = 6, // ??
  BIT_OR = 7, // |
  BIT_XOR = 8, // ^
  BIT_AND = 9, // &
  EQUALS = 10, // ==, !=
  LESSGREATER = 11, // <, >, <=, >=, in, instanceof
  SHIFT = 12, // <<, >>, >>>
  SUM = 13, // +, -
  PRODUCT = 14, // *, /, %
  EXPONENT = 15, // **
  PREFIX = 16, // not, -, !
  POSTFIX = 17, // ?, (, ., ?., [
}

export const PRECEDENCES: Partial<Record<TokenKind, Precedence>> = {
  OR: Precedence.OR,
  PIPE_PIPE: Precedence.OR,
  AND: Precedence.AND,
  AMP_AMP: Precedence.AND,
  QUESTION_QUESTION: Precedence.COALESCE,
  PIPE: Precedence.BIT_OR,
  CARET: Precedence.BIT_XOR,
  AMPERSAND: Precedence.BIT_AND,
  EQ_EQ: Precedence.EQUALS,
  NOT_EQ: Precedence.EQUALS,
  LT: Precedence.LESSGREATER,
  LT_EQ: Precedence.LESSGREATER,
  GT: Precedence.LESSGREATER,
  GT_EQ: Precedence.LESSGREATER,
  IN: Precedence.LESSGREATER,
  INSTANCEOF: Precedence.LESSGREATER,
  SHL: Precedence.SHIFT,
  SHR: Precedence.SHIFT,
  USHR: Precedence.SHIFT,
  PLUS: Precedence.SUM,
  MINUS: Precedence.SUM,
  STAR: Precedence.PRODUCT,
  SLASH: Precedence.PRODUCT,
  PERCENT: Precedence.PRODUCT,
  STAR_STAR: Precedence.EXPONENT,
  QUESTION: Precedence.POSTFIX,
  PLUS_PLUS: Precedence.POSTFIX,
  MINUS_MINUS: Precedence.POSTFIX,
  LPAREN: Precedence.POSTFIX,
  DOT: Precedence.POSTFIX,
  COLON_COLON: Precedence.POSTFIX,
  QUESTION_DOT: Precedence.POSTFIX,
  LBRACKET: Precedence.POSTFIX,
  EQUAL: Precedence.ASSIGN,
  PLUS_EQUAL: Precedence.ASSIGN,
  MINUS_EQUAL: Precedence.ASSIGN,
  STAR_EQUAL: Precedence.ASSIGN,
  SLASH_EQUAL: Precedence.ASSIGN,
  PERCENT_EQUAL: Precedence.ASSIGN,
  PIPE_EQUAL: Precedence.ASSIGN,
  CARET_EQUAL: Precedence.ASSIGN,
  AMP_EQUAL: Precedence.ASSIGN,
  SHL_EQUAL: Precedence.ASSIGN,
  SHR_EQUAL: Precedence.ASSIGN,
  USHR_EQUAL: Precedence.ASSIGN,
  STAR_STAR_EQUAL: Precedence.ASSIGN,
};

export class ParserBase {
  /** @internal */
  readonly tokens: Token[];
  /** @internal */
  readonly file: string;
  /** @internal */
  readonly source?: string;
  /** @internal */
  cursor = 0;

  constructor(tokens: Token[], file = "<anonymous>", source?: string) {
    this.tokens = tokens;
    this.file = file;
    this.source = source;
  }

  // Token Navigation Helpers
  /** @internal */
  current(): Token {
    return (
      this.tokens[this.cursor] ?? {
        kind: "EOF",
        value: "",
        span: emptySpan(this.file),
      }
    );
  }

  /** @internal */
  peek(ahead = 1): Token {
    return (
      this.tokens[this.cursor + ahead] ?? {
        kind: "EOF",
        value: "",
        span: emptySpan(this.file),
      }
    );
  }

  /** @internal */
  previous(): Token {
    return this.tokens[this.cursor - 1] ?? this.current();
  }

  /** @internal */
  check(kind: TokenKind): boolean {
    return this.current().kind === kind;
  }

  /** @internal */
  advance(): Token {
    const tok = this.current();
    if (!this.check("EOF")) {
      this.cursor++;
    }
    return tok;
  }

  /** @internal */
  consume(kind: TokenKind, msg?: string): Token {
    if (this.check(kind)) {
      return this.advance();
    }
    throw new ParserError(
      msg ?? `Expected token '${kind}', got '${this.current().kind}' (${this.current().value})`,
      this.current().span,
    );
  }

  /** @internal */
  isContextualIdentifier(tok: Token): boolean {
    if (tok.kind === "IDENT") return true;
    switch (tok.kind) {
      case "PUB":
      case "NIL":
      case "TYPE_NIL":
      case "STYLE":
      case "TOKENS":
      case "MATCH":
      case "PROP":
      case "TYPE":
      case "VAL":
      case "MUT":
      case "STATE":
      case "FROM":
      case "MODULE":
      case "COMPONENT":
      case "CLASS":
      case "CONST":
      case "STATIC":
      case "READONLY":
      case "ASYNC":
      case "AWAIT":
      case "ENUM":
      case "TYPE_INT":
      case "TYPE_STR":
      case "TYPE_FLOAT":
      case "TYPE_BOOL":
      case "TYPE_NUM":
      case "TYPE_BYTE":
      case "TYPE_CHAR":
      case "TYPE_VOID":
      case "RESULT":
      case "OPTION":
      case "TRY":
      case "CATCH":
      case "FINALLY":
      case "THROW":
      case "BREAK":
      case "CONTINUE":
        return true;
      default:
        return false;
    }
  }

  /** @internal */
  isIdentOrKeyword(tok: Token): boolean {
    return (
      tok.kind === "IDENT" ||
      this.isContextualIdentifier(tok) ||
      (Boolean(tok.value) && /^[a-zA-Z_$][a-zA-Z0-9_$-]*$/.test(tok.value))
    );
  }

  /** @internal */
  isTypedDeclarationAhead(): boolean {
    if (
      this.check("ELSE") ||
      this.check("IF") ||
      this.check("ELIF") ||
      this.check("TRY") ||
      this.check("CATCH") ||
      this.check("FINALLY") ||
      this.check("FOR") ||
      this.check("WHILE") ||
      this.check("RET") ||
      this.check("FN") ||
      this.check("CLASS") ||
      this.check("CASE") ||
      this.check("IMPORT")
    ) {
      return false;
    }
    if (!this.isIdentOrKeyword(this.current()) || this.peek(1).kind !== "COLON") {
      return false;
    }
    let depth = 0;
    let i = this.cursor + 2;
    while (i < this.tokens.length) {
      const k = this.tokens[i].kind;
      if (
        k === "EOF" ||
        (depth === 0 && (k === "NEWLINE" || k === "SEMICOLON" || k === "DEDENT" || k === "RBRACE"))
      ) {
        break;
      }
      if (k === "LPAREN" || k === "LBRACKET" || k === "LBRACE") {
        depth++;
      } else if (k === "RPAREN" || k === "RBRACKET" || k === "RBRACE") {
        depth--;
      } else if (depth === 0) {
        if (k === "COLON_EQUAL" || k === "COLON_COLON_EQUAL" || k === "EQUAL") {
          return true;
        }
      }
      i++;
    }
    return false;
  }

  /** @internal */
  isClosureAhead(): boolean {
    if (this.current().kind !== "FN") return false;
    if (this.peek(1).kind !== "LPAREN") return false;
    let depth = 0;
    let i = this.cursor + 1;
    while (i < this.tokens.length) {
      const k = this.tokens[i].kind;
      if (k === "LPAREN") {
        depth++;
      } else if (k === "RPAREN") {
        depth--;
        if (depth === 0) {
          const next = this.tokens[i + 1]?.kind;
          return (
            next === "ARROW" ||
            next === "FAT_ARROW" ||
            next === "EQUAL" ||
            next === "COLON" ||
            next === "LBRACE"
          );
        }
      } else if (depth === 0) {
        break;
      }
      i++;
    }
    return false;
  }

  /** @internal */
  isMatchStatementAhead(): boolean {
    if (!this.check("MATCH")) return false;
    const next = this.peek(1);
    if (!next) return false;
    if (
      next.kind === "COLON_EQUAL" ||
      next.kind === "COLON_COLON_EQUAL" ||
      next.kind === "EQUAL" ||
      next.kind === "PLUS_EQUAL" ||
      next.kind === "MINUS_EQUAL" ||
      next.kind === "STAR_EQUAL" ||
      next.kind === "SLASH_EQUAL" ||
      next.kind === "PERCENT_EQUAL" ||
      next.kind === "PIPE_EQUAL" ||
      next.kind === "CARET_EQUAL" ||
      next.kind === "AMP_EQUAL" ||
      next.kind === "SHL_EQUAL" ||
      next.kind === "SHR_EQUAL" ||
      next.kind === "USHR_EQUAL" ||
      next.kind === "STAR_STAR_EQUAL"
    ) {
      return false;
    }
    if (next.kind === "COLON") {
      return false;
    }
    let depth = 0;
    let i = this.cursor + 1;
    let foundColonAtDepthZero = false;
    while (i < this.tokens.length) {
      const k = this.tokens[i].kind;
      if (k === "EOF") break;
      if (depth === 0 && (k === "NEWLINE" || k === "SEMICOLON")) {
        break;
      }
      if (k === "LPAREN" || k === "LBRACKET" || k === "LBRACE") {
        depth++;
      } else if (k === "RPAREN" || k === "RBRACKET" || k === "RBRACE") {
        depth--;
      } else if (depth === 0 && k === "COLON") {
        const afterColon = this.tokens[i + 1];
        if (
          afterColon &&
          (afterColon.kind === "NEWLINE" ||
            afterColon.kind === "INDENT" ||
            afterColon.kind === "EOF")
        ) {
          foundColonAtDepthZero = true;
        }
        break;
      }
      i++;
    }
    return foundColonAtDepthZero;
  }

  /** @internal */
  parseContextualIdentToken(msg = "Expected identifier"): Token {
    const tok = this.current();
    if (this.isIdentOrKeyword(tok)) {
      return this.advance();
    }
    throw new ParserError(msg ?? `Expected identifier, got '${tok.kind}' (${tok.value})`, tok.span);
  }

  /** @internal */
  parseContextualIdent(msg = "Expected identifier"): string {
    return this.parseContextualIdentToken(msg).value;
  }

  /** @internal */
  parseContextualIdentOrString(msg = "Expected identifier or property key"): string {
    const tok = this.current();
    if (tok.kind === "STRING" || tok.kind === "NUMBER") {
      return this.advance().value;
    }
    if (
      this.isIdentOrKeyword(tok) ||
      (Boolean(tok.value) && /^[a-zA-Z_$][a-zA-Z0-9_$-]*$/.test(tok.value)) ||
      (tok.value && KEYWORDS[tok.value])
    ) {
      return this.advance().value;
    }
    throw new ParserError(msg ?? `Expected identifier, got '${tok.kind}' (${tok.value})`, tok.span);
  }

  /** @internal */
  parsePropertyKey(msg = "Expected property key in record literal"): string {
    const tok = this.current();
    if (tok.kind === "STRING" || tok.kind === "NUMBER") {
      return this.advance().value;
    }
    if (tok.kind === "LBRACKET") {
      this.advance();
      let inner = "";
      let depth = 1;
      while (depth > 0 && !this.check("EOF")) {
        if (this.check("LBRACKET")) depth++;
        else if (this.check("RBRACKET")) {
          depth--;
          if (depth === 0) break;
        }
        inner += this.advance().value;
      }
      this.consume("RBRACKET");
      return `[${inner}]`;
    }
    if (
      this.isIdentOrKeyword(tok) ||
      (Boolean(tok.value) && /^[a-zA-Z_$][a-zA-Z0-9_$-]*$/.test(tok.value)) ||
      (tok.value && KEYWORDS[tok.value])
    ) {
      return this.advance().value;
    }
    throw new ParserError(msg, tok.span);
  }

  /** @internal */
  consumeStatementSeparator(): void {
    while (this.check("NEWLINE") || this.check("SEMICOLON")) {
      this.advance();
    }
  }
}

/**
 * Cross-module parser contract implemented by `Parser` and consumed by
 * declaration, statement, expression, and UI/style submodules.
 */
export interface ParserHost extends ParserBase {
  parseTypeExpr(): TypeExpr;
  parseParamDecl(isClosure?: boolean, allowUntyped?: boolean): ParamDecl;
  parseBlock(): Block;
  parseStatement(): Statement | null;
  parseExpr(precedence?: Precedence): Expr;
  parsePrimary(): Expr;
  parseComponentDecl(): ComponentDecl;
  parseStyleDecl(consumeStyleKeyword?: boolean): StyleDecl;
  parseTokensDecl(): StyleDecl;
}
