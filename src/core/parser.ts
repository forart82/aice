/**
 * Pratt Parser & Universal AST Generator for AIL 2.0.
 *
 * Implements Top-Down Operator Precedence (Pratt) parsing for expressions
 * and Recursive Descent for module declarations, types, functions, and control flow.
 */

import type {
  ArrayLiteralExpr,
  AssignOp,
  AwaitExpr,
  BinaryOp,
  Block,
  BreakStmt,
  ClassDecl,
  ClosureExpr,
  ComponentDecl,
  ConstDecl,
  ContinueStmt,
  DestructureBinding,
  EnumVariantDecl,
  Expr,
  FieldDecl,
  ForStmt,
  FunctionDecl,
  IfStmt,
  ImportDecl,
  ImportSpecifier,
  LayoutNode,
  LetBinding,
  LiteralExpr,
  MatchCase,
  MatchStmt,
  MethodDecl,
  Module,
  ModuleItem,
  ParamDecl,
  Pattern,
  PrimitiveType,
  PropertyDecl,
  RecordProperty,
  ReturnStmt,
  Statement,
  StyleDecl,
  StyleProperty,
  TemplateLiteralExpr,
  ThrowStmt,
  TryStmt,
  TupleType,
  TypeDecl,
  TypeExpr,
  VarDecl,
  WhileStmt,
} from "./ast.js";
import { filterIndentation, scanRawTokens, tokenize } from "./lexer.js";
import { createSpan, emptySpan, mergeSpans, type Span } from "./span.js";
import { KEYWORDS, type Token, type TokenKind } from "./tokens.js";
import { CstTriviaTable, type TriviaItem, type TriviaKind } from "./trivia.js";

export class ParserError extends Error {
  readonly span: Span;
  readonly code: string;

  constructor(message: string, span: Span, code = "AIL_E1003_PARSER_ERROR") {
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

const PRECEDENCES: Partial<Record<TokenKind, Precedence>> = {
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
  LPAREN: Precedence.POSTFIX,
  DOT: Precedence.POSTFIX,
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

export class Parser {
  private readonly tokens: Token[];
  private readonly file: string;
  private readonly source?: string;
  private cursor = 0;

  constructor(tokens: Token[], file = "<anonymous>", source?: string) {
    this.tokens = tokens;
    this.file = file;
    this.source = source;
  }

  static fromSource(source: string, file = "<anonymous>"): Parser {
    const tokens = tokenize(source, file);
    return new Parser(tokens, file, source);
  }

  static parse(source: string, file = "<anonymous>"): Module {
    return Parser.fromSource(source, file).parse();
  }

  parse(): Module {
    return this.parseModule();
  }

  // Token Navigation Helpers
  private current(): Token {
    return (
      this.tokens[this.cursor] ?? {
        kind: "EOF",
        value: "",
        span: emptySpan(this.file),
      }
    );
  }

  private peek(ahead = 1): Token {
    return (
      this.tokens[this.cursor + ahead] ?? {
        kind: "EOF",
        value: "",
        span: emptySpan(this.file),
      }
    );
  }

  private previous(): Token {
    return this.tokens[this.cursor - 1] ?? this.current();
  }

  private check(kind: TokenKind): boolean {
    return this.current().kind === kind;
  }

  private advance(): Token {
    const tok = this.current();
    if (!this.check("EOF")) {
      this.cursor++;
    }
    return tok;
  }

  private consume(kind: TokenKind, msg?: string): Token {
    if (this.check(kind)) {
      return this.advance();
    }
    throw new ParserError(
      msg ?? `Expected token '${kind}', got '${this.current().kind}' (${this.current().value})`,
      this.current().span,
    );
  }

  private isContextualIdentifier(tok: Token): boolean {
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

  private isIdentOrKeyword(tok: Token): boolean {
    return (
      tok.kind === "IDENT" ||
      this.isContextualIdentifier(tok) ||
      (Boolean(tok.value) && /^[a-zA-Z_$][a-zA-Z0-9_$-]*$/.test(tok.value))
    );
  }

  private isTypedDeclarationAhead(): boolean {
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
        (depth === 0 &&
          (k === "NEWLINE" || k === "SEMICOLON" || k === "DEDENT" || k === "RBRACE"))
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

  private isClosureAhead(): boolean {
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

  private isMatchStatementAhead(): boolean {
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

  private parseContextualIdentToken(msg = "Expected identifier"): Token {
    const tok = this.current();
    if (this.isIdentOrKeyword(tok)) {
      return this.advance();
    }
    throw new ParserError(msg ?? `Expected identifier, got '${tok.kind}' (${tok.value})`, tok.span);
  }

  private parseContextualIdent(msg = "Expected identifier"): string {
    return this.parseContextualIdentToken(msg).value;
  }

  private parseContextualIdentOrString(msg = "Expected identifier or property key"): string {
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

  private parsePropertyKey(msg = "Expected property key in record literal"): string {
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

  private consumeStatementSeparator(): void {
    while (this.check("NEWLINE") || this.check("SEMICOLON")) {
      this.advance();
    }
  }

  // Top-Level Module Parsing
  private parseModule(): Module {
    const startSpan = this.current().span;
    let modulePath = "main";

    this.consumeStatementSeparator();

    if (this.check("MODULE")) {
      this.advance(); // consume 'module'
      modulePath = this.parseModulePath();
      this.consumeStatementSeparator();
    }

    const items: ModuleItem[] = [];

    while (!this.check("EOF")) {
      this.consumeStatementSeparator();
      if (this.check("EOF")) break;

      const item = this.parseModuleItem();
      if (item) {
        items.push(item);
      }
      this.consumeStatementSeparator();
    }

    const endSpan = this.current().span;

    return {
      kind: "Module",
      path: modulePath,
      items,
      span: createSpan(this.file, startSpan.start, endSpan.end),
    };
  }

  private parseModulePath(): string {
    let path = this.isIdentOrKeyword(this.current())
      ? this.advance().value
      : this.consume("IDENT", "Expected module identifier").value;
    while (
      this.check("SLASH") ||
      this.check("DOT") ||
      this.check("MINUS") ||
      this.check("COLON_COLON") ||
      this.isIdentOrKeyword(this.current())
    ) {
      if (this.check("SLASH")) {
        this.advance();
        const seg = this.isIdentOrKeyword(this.current()) ? this.advance().value : "";
        path += `/${seg}`;
      } else if (this.check("DOT")) {
        this.advance();
        const seg = this.isIdentOrKeyword(this.current()) ? this.advance().value : "";
        path += `.${seg}`;
      } else if (this.check("COLON_COLON")) {
        this.advance();
        const seg = this.isIdentOrKeyword(this.current()) ? this.advance().value : "";
        path += `::${seg}`;
      } else if (this.check("MINUS")) {
        this.advance();
        const seg = this.isIdentOrKeyword(this.current()) ? this.advance().value : "";
        path += `-${seg}`;
      } else {
        path += this.advance().value;
      }
    }
    return path;
  }

  private parseModuleItem(): ModuleItem | null {
    let isExported = false;
    if (
      this.check("PUB") &&
      this.peek(1).kind !== "COLON_EQUAL" &&
      this.peek(1).kind !== "COLON_COLON_EQUAL" &&
      this.peek(1).kind !== "EQUAL" &&
      this.peek(1).kind !== "DOT" &&
      this.peek(1).kind !== "QUESTION_DOT" &&
      !(this.peek(1).kind === "COLON" && this.isTypedDeclarationAhead())
    ) {
      isExported = true;
      this.advance();
    }

    if (this.check("FROM") || this.check("IMPORT")) {
      return this.parseImportDecl(isExported);
    }
    if (this.check("TYPE")) {
      if (
        this.peek(1).kind === "COLON_EQUAL" ||
        this.peek(1).kind === "COLON_COLON_EQUAL" ||
        this.peek(1).kind === "EQUAL" ||
        (this.peek(1).kind === "COLON" && this.isTypedDeclarationAhead())
      ) {
        return this.parseVarDecl(isExported);
      }
      return this.parseTypeDecl(false);
    }
    if (this.check("ENUM")) {
      return this.parseTypeDecl(true);
    }
    if (this.check("CLASS")) {
      return this.parseClassDecl(isExported);
    }
    if (this.check("CONST")) {
      return this.parseConstDecl(isExported);
    }
    const isValDecl =
      this.check("VAL") &&
      this.peek(1).kind !== "COLON_EQUAL" &&
      this.peek(1).kind !== "COLON_COLON_EQUAL" &&
      this.peek(1).kind !== "EQUAL" &&
      this.peek(1).kind !== "DOT" &&
      this.peek(1).kind !== "QUESTION_DOT" &&
      !(this.peek(1).kind === "COLON" && this.isTypedDeclarationAhead());

    if (isExported && (this.check("LET") || isValDecl)) {
      return this.parseVarDecl(isExported);
    }
    if (isValDecl) {
      return this.parseVarDecl(isExported);
    }
    if (
      this.isIdentOrKeyword(this.current()) &&
      (this.peek(1).kind === "COLON_EQUAL" ||
        this.peek(1).kind === "COLON_COLON_EQUAL" ||
        (this.peek(1).kind === "COLON" && this.isTypedDeclarationAhead()))
    ) {
      return this.parseVarDecl(isExported);
    }
    if (this.check("FN") || (this.check("ASYNC") && this.peek(1).kind === "FN")) {
      return this.parseFunctionDecl(isExported);
    }
    if (this.check("COMPONENT")) {
      if (
        this.peek(1).kind === "COLON_EQUAL" ||
        this.peek(1).kind === "COLON_COLON_EQUAL" ||
        this.peek(1).kind === "EQUAL" ||
        (this.peek(1).kind === "COLON" && this.isTypedDeclarationAhead())
      ) {
        return this.parseVarDecl(isExported);
      }
      return this.parseComponentDecl();
    }
    if (this.check("STYLE")) {
      if (
        this.peek(1).kind === "COLON_EQUAL" ||
        this.peek(1).kind === "COLON_COLON_EQUAL" ||
        this.peek(1).kind === "EQUAL" ||
        (this.peek(1).kind === "COLON" && this.isTypedDeclarationAhead())
      ) {
        return this.parseVarDecl(isExported);
      }
      return this.parseStyleDecl();
    }
    if (this.check("TOKENS")) {
      if (
        this.peek(1).kind === "COLON_EQUAL" ||
        this.peek(1).kind === "COLON_COLON_EQUAL" ||
        this.peek(1).kind === "EQUAL" ||
        (this.peek(1).kind === "COLON" && this.isTypedDeclarationAhead())
      ) {
        return this.parseVarDecl(isExported);
      }
      return this.parseTokensDecl();
    }

    // Top-level statements allowed for script execution
    const stmt = this.parseStatement();
    if (stmt) {
      return {
        kind: "FunctionDecl",
        name: "__top_level__",
        params: [],
        returnType: null,
        body: {
          kind: "Block",
          statements: [stmt],
          span: stmt.span,
        },
        isExpressionBodied: false,
        span: stmt.span,
      };
    }

    throw new ParserError(
      `Unexpected token '${this.current().kind}' (${this.current().value}) at top level`,
      this.current().span,
    );
  }

  // Import Declarations: from "source" import a, b as c, *
  // or: import { style, tokens, match, type } from "..."
  // or: import * as name from "..."
  // or: import "source"
  private parseImportDecl(isExported = false): ImportDecl {
    const startSpan = this.current().span;
    let source = "";

    if (this.check("FROM")) {
      this.advance();
      source = this.consume("STRING", "Expected import source string").value;
      this.consume("IMPORT", "Expected 'import' keyword after from-source");

      const specifiers: ImportSpecifier[] = [];

      if (this.check("STAR")) {
        const starToken = this.advance();
        let alias: string | undefined;
        if (this.check("IDENT") && this.current().value === "as") {
          this.advance();
          alias = this.parseContextualIdent("Expected alias identifier after 'as'");
        }
        specifiers.push({
          name: "*",
          alias,
          isWildcard: true,
          span: starToken.span,
        });
      } else {
        const hasBraces = this.check("LBRACE");
        if (hasBraces) this.advance();

        while (!this.check("NEWLINE") && !this.check("EOF") && !this.check("SEMICOLON")) {
          if (hasBraces && this.check("RBRACE")) break;
          const idToken = this.parseContextualIdentToken("Expected import identifier");
          let alias: string | undefined;

          if (this.check("IDENT") && this.current().value === "as") {
            this.advance();
            alias = this.parseContextualIdent("Expected alias identifier after 'as'");
          }

          specifiers.push({
            name: idToken.value,
            alias,
            span: idToken.span,
          });

          if (this.check("COMMA")) {
            this.advance();
          } else {
            break;
          }
        }
        if (hasBraces) {
          this.consume("RBRACE", "Expected '}' in import declaration");
        }
      }

      const endSpan = this.current().span;
      this.consumeStatementSeparator();

      return {
        kind: "ImportDecl",
        source,
        specifiers,
        isExported: isExported || undefined,
        span: mergeSpans(startSpan, endSpan),
      };
    } else {
      this.consume("IMPORT");
      if (this.check("STRING")) {
        source = this.advance().value;
        const endSpan = this.current().span;
        this.consumeStatementSeparator();
        return {
          kind: "ImportDecl",
          source,
          specifiers: [],
          isExported: isExported || undefined,
          span: mergeSpans(startSpan, endSpan),
        };
      }

      const specifiers: ImportSpecifier[] = [];

      if (this.check("STAR")) {
        const starToken = this.advance();
        let alias: string | undefined;
        if (this.check("IDENT") && this.current().value === "as") {
          this.advance();
          alias = this.parseContextualIdent("Expected alias identifier after 'as'");
        }
        specifiers.push({
          name: "*",
          alias,
          isWildcard: true,
          span: starToken.span,
        });
      } else {
        const hasBraces = this.check("LBRACE");
        if (hasBraces) {
          this.advance();
          while (
            !this.check("RBRACE") &&
            !this.check("NEWLINE") &&
            !this.check("EOF") &&
            !this.check("SEMICOLON")
          ) {
            const idToken = this.parseContextualIdentToken("Expected import identifier");
            let alias: string | undefined;

            if (this.check("IDENT") && this.current().value === "as") {
              this.advance();
              alias = this.parseContextualIdent("Expected alias identifier after 'as'");
            }

            specifiers.push({
              name: idToken.value,
              alias,
              span: idToken.span,
            });

            if (this.check("COMMA")) {
              this.advance();
            } else {
              break;
            }
          }
          this.consume("RBRACE", "Expected '}' in import declaration");
        } else {
          while (
            !this.check("FROM") &&
            !this.check("NEWLINE") &&
            !this.check("EOF") &&
            !this.check("SEMICOLON")
          ) {
            const idToken = this.parseContextualIdentToken("Expected import identifier");
            let alias: string | undefined;

            if (this.check("IDENT") && this.current().value === "as") {
              this.advance();
              alias = this.parseContextualIdent("Expected alias identifier after 'as'");
            }

            specifiers.push({
              name: idToken.value,
              alias,
              span: idToken.span,
            });

            if (this.check("COMMA")) {
              this.advance();
            } else {
              break;
            }
          }
        }
      }

      this.consume("FROM", "Expected 'from' after import specifiers");
      source = this.consume("STRING", "Expected import source string").value;
      const endSpan = this.current().span;
      this.consumeStatementSeparator();

      return {
        kind: "ImportDecl",
        source,
        specifiers,
        isExported: isExported || undefined,
        span: mergeSpans(startSpan, endSpan),
      };
    }
  }

  // Type & Enum Declarations
  private parseTypeDecl(isEnum: boolean): TypeDecl {
    const startSpan = this.current().span;
    this.advance(); // consume 'type' or 'enum'

    const name = this.parseContextualIdentOrString("Expected type name");
    const typeParams: string[] = [];

    if (this.check("LBRACKET")) {
      this.advance();
      while (!this.check("RBRACKET") && !this.check("EOF")) {
        typeParams.push(this.parseContextualIdentOrString("Expected type parameter"));
        if (this.check("COMMA")) this.advance();
      }
      this.consume("RBRACKET");
    }

    // Type Alias (e.g. type Port = { p:int | p >= 1 and p <= 65535 })
    if (this.check("EQUAL")) {
      this.advance();
      const aliasType = this.parseTypeExpr();
      this.consumeStatementSeparator();
      return {
        kind: "TypeDecl",
        isEnum: false,
        name,
        typeParams,
        aliasType,
        span: mergeSpans(startSpan, aliasType.span),
      };
    }

    // Block-bodied struct or enum
    this.consume("COLON", "Expected ':' before type body");
    this.consumeStatementSeparator();

    if (isEnum) {
      const variants: EnumVariantDecl[] = [];
      const hasIndent = this.check("INDENT");
      if (hasIndent) {
        this.advance(); // consume INDENT
      }

      while (!this.check("EOF")) {
        this.consumeStatementSeparator();
        if (hasIndent && (this.check("DEDENT") || this.check("EOF"))) {
          break;
        }
        if (!hasIndent && (this.check("NEWLINE") || this.check("EOF"))) {
          break;
        }

        if ((this.check("IDENT") && this.current().value === "pass") || this.check("ELLIPSIS")) {
          this.advance();
          this.consumeStatementSeparator();
          continue;
        }

        while (!this.check("EOF")) {
          const vSpan = this.current().span;
          const vName = this.parseContextualIdentOrString("Expected variant name");
          let payloadTypes: TypeExpr[] | undefined;

          if (this.check("LPAREN")) {
            this.advance();
            payloadTypes = [];
            while (!this.check("RPAREN") && !this.check("EOF")) {
              payloadTypes.push(this.parseTypeExpr());
              if (this.check("COMMA")) this.advance();
            }
            this.consume("RPAREN");
          }

          variants.push({
            name: vName,
            payloadTypes,
            span: mergeSpans(vSpan, this.current().span),
          });

          if (this.check("COMMA")) {
            this.advance();
          } else {
            break;
          }
        }

        this.consumeStatementSeparator();
        if (!hasIndent) {
          break;
        }
      }

      let endSpan = this.current().span;
      if (hasIndent && this.check("DEDENT")) {
        endSpan = this.consume("DEDENT").span;
      }
      return {
        kind: "TypeDecl",
        isEnum: true,
        name,
        typeParams,
        variants,
        span: mergeSpans(startSpan, endSpan),
      };
    }

    // Struct field list (supports single-line, comma-separated fields, default values)
    const fields: FieldDecl[] = [];
    const hasIndent = this.check("INDENT");
    if (hasIndent) {
      this.advance(); // consume INDENT
    } else {
      if (this.check("NEWLINE") || this.check("EOF")) {
        this.consumeStatementSeparator();
        return {
          kind: "TypeDecl",
          isEnum: false,
          name,
          typeParams,
          fields: [],
          span: mergeSpans(startSpan, this.previous().span),
        };
      }
    }

    while (!this.check("EOF")) {
      this.consumeStatementSeparator();
      if (hasIndent && (this.check("DEDENT") || this.check("EOF"))) {
        break;
      }
      if (!hasIndent && (this.check("NEWLINE") || this.check("EOF"))) {
        break;
      }

      if ((this.check("IDENT") && this.current().value === "pass") || this.check("ELLIPSIS")) {
        this.advance();
        this.consumeStatementSeparator();
        continue;
      }

      while (!this.check("EOF")) {
        const fSpan = this.current().span;
        const fName = this.parseContextualIdentOrString("Expected field name");
        let isOptional = false;
        if (this.check("QUESTION")) {
          this.advance();
          isOptional = true;
        }
        this.consume("COLON", "Expected ':' after field name");
        const fType = this.parseTypeExpr();

        let defaultValue: Expr | undefined;
        if (this.check("EQUAL")) {
          this.advance(); // consume '='
          defaultValue = this.parseExpr();
        }

        fields.push({
          name: fName,
          typeAnnotation: fType,
          defaultValue,
          isOptional: isOptional ? true : undefined,
          span: mergeSpans(fSpan, defaultValue ? defaultValue.span : fType.span),
        });

        if (this.check("COMMA")) {
          this.advance();
        } else {
          break;
        }
      }

      this.consumeStatementSeparator();
      if (!hasIndent) {
        break;
      }
    }

    let endSpan = this.current().span;
    if (hasIndent && this.check("DEDENT")) {
      endSpan = this.consume("DEDENT").span;
    }

    return {
      kind: "TypeDecl",
      isEnum: false,
      name,
      typeParams,
      fields,
      span: mergeSpans(startSpan, endSpan),
    };
  }

  private typeExprToString(t: TypeExpr): string {
    switch (t.kind) {
      case "PrimitiveType":
        return t.primitive;
      case "NamedType":
        if (t.typeArgs && t.typeArgs.length > 0) {
          return `${t.name}[${t.typeArgs.map((a) => this.typeExprToString(a)).join(", ")}]`;
        }
        return t.name;
      case "ArrayType":
        return `[${this.typeExprToString(t.elementType)}]`;
      case "TupleType":
        return `[${t.elementTypes.map((e) => this.typeExprToString(e)).join(", ")}]`;
      case "OptionType":
        return `${this.typeExprToString(t.innerType)}?`;
      case "ResultType":
        return `Result[${this.typeExprToString(t.okType)}, ${this.typeExprToString(t.errType)}]`;
      case "RecordType": {
        const fields = t.fields.map((f) => `${f.name}: ${this.typeExprToString(f.type)}`).join(", ");
        return `{ ${fields} }`;
      }
      default:
        return "any";
    }
  }

  // Type Expressions
  private parseTypeExpr(): TypeExpr {
    let type = this.parseBaseTypeExpr();
    if (this.check("QUESTION")) {
      const qSpan = this.advance().span;
      type = {
        kind: "OptionType",
        innerType: type,
        span: mergeSpans(type.span, qSpan),
      };
    }

    while (this.check("PIPE")) {
      this.advance(); // consume '|'
      const right = this.parseBaseTypeExpr();
      const leftName = this.typeExprToString(type);
      const rightName = this.typeExprToString(right);
      type = {
        kind: "NamedType",
        name: `${leftName} | ${rightName}`,
        span: mergeSpans(type.span, right.span),
      };
    }

    return type;
  }

  private parseBaseTypeExpr(): TypeExpr {
    const tok = this.current();

    if (tok.kind === "READONLY") {
      this.advance();
      return this.parseBaseTypeExpr();
    }

    if (tok.kind === "BOOLEAN") {
      this.advance();
      return {
        kind: "NamedType",
        name: tok.value,
        span: tok.span,
      };
    }

    if (tok.kind === "STRING") {
      this.advance();
      return {
        kind: "NamedType",
        name: `"${tok.value}"`,
        span: tok.span,
      };
    }

    if (tok.kind === "NUMBER") {
      this.advance();
      return {
        kind: "NamedType",
        name: tok.value,
        span: tok.span,
      };
    }

    if (tok.kind === "MINUS") {
      this.advance();
      const numTok = this.consume("NUMBER", "Expected number literal after '-' in type expression");
      return {
        kind: "NamedType",
        name: `-${numTok.value}`,
        span: mergeSpans(tok.span, numTok.span),
      };
    }

    if (tok.kind === "PLUS") {
      this.advance();
      const numTok = this.consume("NUMBER", "Expected number literal after '+' in type expression");
      return {
        kind: "NamedType",
        name: numTok.value,
        span: mergeSpans(tok.span, numTok.span),
      };
    }

    // 0. Primitive type sigils (!s, !i, !b, !f, !n, !v, !c, !y)
    if (tok.kind === "BANG") {
      this.advance(); // consume '!'
      const nextTok = this.current();
      const sigilMap: Record<string, PrimitiveType["primitive"]> = {
        s: "str",
        str: "str",
        i: "int",
        int: "int",
        b: "bool",
        bool: "bool",
        f: "float",
        flt: "float",
        float: "float",
        n: "num",
        num: "num",
        v: "void",
        void: "void",
        c: "char",
        char: "char",
        y: "byte",
        byte: "byte",
      };
      const prim = sigilMap[nextTok.value];
      if (prim) {
        const endSpan = this.advance().span;
        return {
          kind: "PrimitiveType",
          primitive: prim,
          span: mergeSpans(tok.span, endSpan),
        };
      }
      throw new ParserError(`Unknown type sigil '!${nextTok.value}'`, tok.span);
    }

    // 1. Primitive types (1-token BPE dictionary words)
    if (
      tok.kind === "TYPE_INT" ||
      tok.kind === "TYPE_STR" ||
      tok.kind === "TYPE_FLOAT" ||
      tok.kind === "TYPE_BOOL" ||
      tok.kind === "TYPE_NUM" ||
      tok.kind === "TYPE_BYTE" ||
      tok.kind === "TYPE_CHAR" ||
      tok.kind === "TYPE_VOID" ||
      tok.kind === "TYPE_NIL" ||
      tok.kind === "NIL"
    ) {
      this.advance();
      const primMap: Record<string, PrimitiveType["primitive"]> = {
        TYPE_INT: "int",
        TYPE_STR: "str",
        TYPE_FLOAT: "float",
        TYPE_BOOL: "bool",
        TYPE_NUM: "num",
        TYPE_BYTE: "byte",
        TYPE_CHAR: "char",
        TYPE_VOID: "void",
        TYPE_NIL: "nil",
        NIL: "nil",
      };
      return {
        kind: "PrimitiveType",
        primitive: primMap[tok.kind] ?? "nil",
        span: tok.span,
      };
    }

    // 2. Result[T, E]
    if (tok.kind === "RESULT") {
      this.advance();
      this.consume("LBRACKET", "Expected '[' after Result");
      const okType = this.parseTypeExpr();
      this.consume("COMMA", "Expected ',' between Result types");
      const errType = this.parseTypeExpr();
      const endSpan = this.consume("RBRACKET").span;
      return {
        kind: "ResultType",
        okType,
        errType,
        span: mergeSpans(tok.span, endSpan),
      };
    }

    // 3. Option[T]
    if (tok.kind === "OPTION") {
      this.advance();
      this.consume("LBRACKET", "Expected '[' after Option");
      const innerType = this.parseTypeExpr();
      const endSpan = this.consume("RBRACKET").span;
      return {
        kind: "OptionType",
        innerType,
        span: mergeSpans(tok.span, endSpan),
      };
    }

    // 4. Array Type: [TypeExpr] or Tuple Type: [T1, T2, ...]
    if (tok.kind === "LBRACKET") {
      this.advance();
      if (this.check("RBRACKET")) {
        const endSpan = this.advance().span;
        return {
          kind: "TupleType",
          elementTypes: [],
          span: mergeSpans(tok.span, endSpan),
        };
      }
      const firstType = this.parseTypeExpr();
      if (this.check("COMMA")) {
        const elementTypes: TypeExpr[] = [firstType];
        while (this.check("COMMA")) {
          this.advance(); // consume ','
          if (this.check("RBRACKET")) {
            break; // trailing comma, e.g. [int,] or [int, str,]
          }
          elementTypes.push(this.parseTypeExpr());
        }
        const endSpan = this.consume("RBRACKET", "Expected ']' after tuple type elements").span;
        return {
          kind: "TupleType",
          elementTypes,
          span: mergeSpans(tok.span, endSpan),
        };
      }
      const endSpan = this.consume("RBRACKET", "Expected ']' after array type").span;
      return {
        kind: "ArrayType",
        elementType: firstType,
        span: mergeSpans(tok.span, endSpan),
      };
    }

    // 5. Refinement Type or Record Type: { ... }
    if (tok.kind === "LBRACE") {
      this.advance();
      // Check if it's a refinement type { v:int | v >= 0 }
      if (
        this.isIdentOrKeyword(this.current()) &&
        (this.peek().kind === "COLON" ||
          (this.peek().kind === "QUESTION" && this.peek(2).kind === "COLON"))
      ) {
        const idToken = this.advance();
        let isFirstOptional = false;
        if (this.check("QUESTION")) {
          this.advance();
          isFirstOptional = true;
        }
        this.advance(); // consume ':'
        const base = this.parseBaseTypeExpr();

        if (this.check("PIPE")) {
          if (base.kind === "PrimitiveType") {
            this.advance(); // consume '|'
            const predicate = this.parseExpr();
            const endSpan = this.consume("RBRACE").span;
            return {
              kind: "RefinementType",
              param: idToken.value,
              baseType: base,
              predicate,
              span: mergeSpans(tok.span, endSpan),
            };
          }
          let unionType: TypeExpr = base;
          while (this.check("PIPE")) {
            this.advance(); // consume '|'
            const right = this.parseBaseTypeExpr();
            const getTypeName = (t: TypeExpr): string => {
              if (t.kind === "NamedType") return t.name;
              if (t.kind === "PrimitiveType") return t.primitive;
              return "any";
            };
            const leftName = getTypeName(unionType);
            const rightName = getTypeName(right);
            unionType = {
              kind: "NamedType",
              name: `${leftName} | ${rightName}`,
              span: mergeSpans(unionType.span, right.span),
            };
          }
          const fields: { name: string; type: TypeExpr; isOptional?: boolean; span: Span }[] = [
            {
              name: idToken.value,
              type: unionType,
              isOptional: isFirstOptional ? true : undefined,
              span: mergeSpans(idToken.span, unionType.span),
            },
          ];
          while (this.check("COMMA")) {
            this.advance();
            if (this.check("RBRACE")) break;
            const fName = this.parseContextualIdentOrString("Expected field name");
            let isOptional = false;
            if (this.check("QUESTION")) {
              this.advance();
              isOptional = true;
            }
            this.consume("COLON");
            const fType = this.parseTypeExpr();
            fields.push({
              name: fName,
              type: fType,
              isOptional: isOptional ? true : undefined,
              span: mergeSpans(tok.span, fType.span),
            });
          }
          const endSpan = this.consume("RBRACE").span;
          return {
            kind: "RecordType",
            fields,
            span: mergeSpans(tok.span, endSpan),
          };
        }

        // It was a single field record: { id: int }
        const fields: { name: string; type: TypeExpr; isOptional?: boolean; span: Span }[] = [
          {
            name: idToken.value,
            type: base,
            isOptional: isFirstOptional ? true : undefined,
            span: mergeSpans(idToken.span, base.span),
          },
        ];

        while (this.check("COMMA")) {
          this.advance();
          if (this.check("RBRACE")) break;
          const fName = this.parseContextualIdentOrString("Expected field name");
          let isOptional = false;
          if (this.check("QUESTION")) {
            this.advance();
            isOptional = true;
          }
          this.consume("COLON");
          const fType = this.parseTypeExpr();
          fields.push({
            name: fName,
            type: fType,
            isOptional: isOptional ? true : undefined,
            span: mergeSpans(tok.span, fType.span),
          });
        }

        const endSpan = this.consume("RBRACE").span;
        return {
          kind: "RecordType",
          fields,
          span: mergeSpans(tok.span, endSpan),
        };
      }

      // Empty record {}
      const endSpan = this.consume("RBRACE").span;
      return {
        kind: "RecordType",
        fields: [],
        span: mergeSpans(tok.span, endSpan),
      };
    }

    // 6. Function Type: (a:int, b:str) => void or () => void or (...args: number[]) => number
    if (tok.kind === "LPAREN") {
      this.advance(); // consume '('
      const paramTypes: string[] = [];
      while (!this.check("RPAREN") && !this.check("EOF")) {
        let isRest = false;
        if (this.check("ELLIPSIS")) {
          this.advance();
          isRest = true;
        }

        let pName: string | undefined;
        if (
          (this.check("IDENT") || this.isContextualIdentifier(this.current())) &&
          (this.peek().kind === "COLON" || this.peek().kind === "QUESTION")
        ) {
          pName = this.advance().value;
          if (this.check("QUESTION")) {
            this.advance();
            pName += "?";
          }
          if (this.check("COLON")) this.advance();
        }

        const pt = this.parseTypeExpr();
        const ptName = this.typeExprToString(pt);
        if (isRest) {
          paramTypes.push(pName ? `...${pName}: ${ptName}` : `...${ptName}`);
        } else {
          paramTypes.push(pName ? `${pName}: ${ptName}` : ptName);
        }
        if (this.check("COMMA")) this.advance();
      }
      this.consume("RPAREN");
      if (this.check("FAT_ARROW") || this.check("ARROW")) {
        this.advance();
        const retType = this.parseTypeExpr();
        const retName = this.typeExprToString(retType);
        return {
          kind: "NamedType",
          name: `(${paramTypes.join(", ")}) => ${retName}`,
          span: mergeSpans(tok.span, retType.span),
        };
      }
      return {
        kind: "NamedType",
        name: `(${paramTypes.join(", ")})`,
        span: mergeSpans(tok.span, this.previous().span),
      };
    }

    // 7. Named Type: e.g. User, Map[str, int], or THREE.MeshBasicMaterial
    if (tok.kind === "IDENT" || this.isContextualIdentifier(tok)) {
      this.advance();
      let name = tok.value;
      let endSpan = tok.span;

      while (this.check("DOT")) {
        this.advance(); // consume '.'
        const nextTok = this.current();
        if (nextTok.kind === "IDENT" || this.isIdentOrKeyword(nextTok)) {
          this.advance();
          name += `.${nextTok.value}`;
          endSpan = nextTok.span;
        } else {
          throw new ParserError(
            `Expected identifier after '.' in type expression, got '${nextTok.kind}'`,
            nextTok.span,
          );
        }
      }

      const typeArgs: TypeExpr[] = [];
      if (this.check("LBRACKET")) {
        this.advance();
        while (!this.check("RBRACKET") && !this.check("EOF")) {
          typeArgs.push(this.parseTypeExpr());
          if (this.check("COMMA")) this.advance();
        }
        endSpan = this.consume("RBRACKET", "Expected ']' after type arguments").span;
      } else if (this.check("LT")) {
        this.advance();
        while (!this.check("GT") && !this.check("EOF")) {
          typeArgs.push(this.parseTypeExpr());
          if (this.check("COMMA")) this.advance();
        }
        endSpan = this.consume("GT", "Expected '>' after type arguments").span;
      }

      while (this.check("LBRACKET")) {
        this.advance();
        const indexType = this.parseTypeExpr();
        const endB = this.consume("RBRACKET", "Expected ']' after index type").span;
        endSpan = mergeSpans(endSpan, endB);
        name += `[${this.typeExprToString(indexType)}]`;
      }

      return {
        kind: "NamedType",
        name,
        typeArgs: typeArgs.length > 0 ? typeArgs : undefined,
        span: mergeSpans(tok.span, endSpan),
      };
    }

    throw new ParserError(`Unexpected token '${tok.kind}' in type expression`, tok.span);
  }

  private parseParamDecl(isClosure = false, allowUntyped = false): ParamDecl {
    const pSpan = this.current().span;
    let isRest = false;
    if (this.check("ELLIPSIS")) {
      this.advance();
      isRest = true;
    }
    let pName: string;

    if (this.check("LBRACKET")) {
      this.advance(); // consume '['
      const elements: string[] = [];
      while (!this.check("RBRACKET") && !this.check("EOF")) {
        if (this.check("COMMA")) {
          elements.push("");
          this.advance();
          continue;
        }
        const ident = this.parseContextualIdentOrString(
          "Expected parameter name in destructuring pattern",
        );
        let entry = ident;
        if (this.check("EQUAL")) {
          this.advance();
          const defExpr = this.parseExpr();
          const defStr = this.source
            ? this.source.slice(defExpr.span.start.offset, defExpr.span.end.offset)
            : "";
          entry += ` = ${defStr}`;
        }
        elements.push(entry);
        if (this.check("COMMA")) {
          this.advance();
        } else {
          break;
        }
      }
      this.consume("RBRACKET");
      pName = `[${elements.join(", ")}]`;
    } else if (this.check("LBRACE")) {
      this.advance(); // consume '{'
      const elements: string[] = [];
      while (!this.check("RBRACE") && !this.check("EOF")) {
        const field = this.parseContextualIdentOrString(
          "Expected property name in destructuring pattern",
        );
        let entry = field;
        if (this.check("COLON")) {
          this.advance();
          const alias = this.parseContextualIdentOrString("Expected alias name");
          entry = `${field}: ${alias}`;
        }
        if (this.check("EQUAL")) {
          this.advance();
          const defExpr = this.parseExpr();
          const defStr = this.source
            ? this.source.slice(defExpr.span.start.offset, defExpr.span.end.offset)
            : "";
          entry += ` = ${defStr}`;
        }
        elements.push(entry);
        if (this.check("COMMA")) {
          this.advance();
        } else {
          break;
        }
      }
      this.consume("RBRACE");
      pName = `{ ${elements.join(", ")} }`;
    } else {
      pName = this.parseContextualIdentOrString("Expected parameter name");
    }

    let isOptional = false;
    if (this.check("QUESTION")) {
      this.advance();
      isOptional = true;
    }

    let pType: TypeExpr | null = null;
    if (this.check("COLON")) {
      this.advance();
      pType = this.parseTypeExpr();
    } else if (
      isClosure ||
      allowUntyped ||
      pName === "self" ||
      pName === "cls" ||
      pName === "this" ||
      pName.startsWith("[") ||
      pName.startsWith("{")
    ) {
      if (
        allowUntyped ||
        (!isClosure && (pName === "self" || pName === "cls" || pName === "this"))
      ) {
        pType = {
          kind: "NamedType",
          name: "any",
          span: pSpan,
        };
      }
    } else {
      this.consume("COLON", "Expected ':' after parameter name");
      pType = this.parseTypeExpr();
    }

    let defaultValue: Expr | undefined;
    if (this.check("EQUAL")) {
      this.advance();
      defaultValue = this.parseExpr();
    }

    return {
      name: pName,
      typeAnnotation: pType,
      defaultValue,
      isOptional: isOptional ? true : undefined,
      isRest: isRest ? true : undefined,
      span: mergeSpans(
        pSpan,
        defaultValue ? defaultValue.span : pType ? pType.span : this.previous().span,
      ),
    };
  }

  // Function Declarations
  private parseFunctionDecl(isExported = false): FunctionDecl {
    const startSpan = this.current().span;
    let isAsync = false;
    if (this.check("ASYNC")) {
      isAsync = true;
      this.advance();
    }
    this.consume("FN");

    const name = this.parseContextualIdentOrString("Expected function name");
    this.consume("LPAREN", "Expected '(' after function name");

    const params: ParamDecl[] = [];
    while (!this.check("RPAREN") && !this.check("EOF")) {
      params.push(this.parseParamDecl(false));
      if (this.check("COMMA")) {
        this.advance();
      } else {
        break;
      }
    }
    this.consume("RPAREN");

    // Optional return type: -> ReturnType
    let returnType: TypeExpr | null = null;
    if (this.check("ARROW")) {
      this.advance();
      returnType = this.parseTypeExpr();
    }

    // Expression-bodied function: fn add(a:int, b:int) -> int = a + b or fn add(a:int, b:int) => a + b
    if (this.check("EQUAL") || this.check("FAT_ARROW")) {
      this.advance();
      let hasIndent = false;
      this.consumeStatementSeparator();
      if (this.check("INDENT")) {
        this.advance();
        hasIndent = true;
      }
      this.consumeStatementSeparator();
      const body = this.parseExpr();
      this.consumeStatementSeparator();
      if (hasIndent && this.check("DEDENT")) {
        this.advance();
      }
      return {
        kind: "FunctionDecl",
        name,
        isExported: isExported || undefined,
        isAsync: isAsync || undefined,
        params,
        returnType,
        body,
        isExpressionBodied: true,
        span: mergeSpans(startSpan, body.span),
      };
    }

    // Block-bodied function
    if (this.check("COLON")) {
      this.advance();
      this.consumeStatementSeparator();
    } else if (!this.check("LBRACE")) {
      throw new ParserError("Expected ':', '=', or '{' before function body", this.current().span);
    }
    const body = this.parseBlock();

    return {
      kind: "FunctionDecl",
      name,
      isExported: isExported || undefined,
      isAsync: isAsync || undefined,
      params,
      returnType,
      body,
      isExpressionBodied: false,
      span: mergeSpans(startSpan, body.span),
    };
  }

  // Class Declarations
  private parseClassDecl(isExported = false): ClassDecl {
    const startSpan = this.current().span;
    this.consume("CLASS", "Expected 'class' keyword");

    const name = this.parseContextualIdentOrString("Expected class name");
    const typeParams: string[] = [];
    if (this.check("LBRACKET")) {
      this.advance();
      while (!this.check("RBRACKET") && !this.check("EOF")) {
        typeParams.push(this.parseContextualIdentOrString("Expected type parameter"));
        if (this.check("COMMA")) this.advance();
        else break;
      }
      this.consume("RBRACKET", "Expected ']' after type parameters");
    }

    let primaryConstructor: ParamDecl[] | undefined;
    if (this.check("LPAREN")) {
      this.advance();
      primaryConstructor = [];
      while (!this.check("RPAREN") && !this.check("EOF")) {
        const pSpan = this.current().span;
        let isPub = false;
        let isReadonly = false;
        let isMut = false;
        if (this.check("PUB")) {
          isPub = true;
          this.advance();
        }
        if (this.check("READONLY")) {
          isReadonly = true;
          this.advance();
        } else if (this.check("MUT")) {
          isMut = true;
          this.advance();
        }
        let isRest = false;
        if (this.check("ELLIPSIS")) {
          this.advance();
          isRest = true;
        }
        const pName = this.parseContextualIdentOrString("Expected parameter name");
        let isOptional = false;
        if (this.check("QUESTION")) {
          this.advance();
          isOptional = true;
        }
        let pType: TypeExpr | null = null;
        if (this.check("COLON")) {
          this.advance();
          pType = this.parseTypeExpr();
        } else if (!this.check("EQUAL")) {
          this.consume("COLON", "Expected ':' after parameter name");
          pType = this.parseTypeExpr();
        }

        let defaultValue: Expr | undefined;
        if (this.check("EQUAL")) {
          this.advance();
          defaultValue = this.parseExpr();
        }

        primaryConstructor.push({
          name: pName,
          typeAnnotation: pType ?? { kind: "NamedType", name: "any", span: pSpan },
          defaultValue,
          isOptional: isOptional ? true : undefined,
          ...(isRest ? { isRest: true } : {}),
          isPub,
          isReadonly,
          isMut,
          span: mergeSpans(
            pSpan,
            defaultValue ? defaultValue.span : pType ? pType.span : this.previous().span,
          ),
        });

        if (this.check("COMMA")) {
          this.advance();
        } else {
          break;
        }
      }
      this.consume("RPAREN", "Expected ')' after primary constructor parameters");
    }

    let extendsName: string | undefined;
    if (this.check("EXTENDS")) {
      this.advance();
      extendsName = this.parseContextualIdentOrString("Expected base class name after 'extends'");
    }

    const implementsList: string[] = [];
    if (this.check("IMPLEMENTS")) {
      this.advance();
      while (!this.check("COLON") && !this.check("EOF") && !this.check("NEWLINE")) {
        implementsList.push(this.parseContextualIdentOrString("Expected interface name"));
        if (this.check("COMMA")) this.advance();
        else break;
      }
    }

    let hasBody = false;
    if (this.check("COLON")) {
      this.advance();
      this.consumeStatementSeparator();
      hasBody = true;
    } else if (this.check("LBRACE")) {
      hasBody = true;
    } else if (!primaryConstructor) {
      throw new ParserError("Expected ':' or '{' after class header", this.current().span);
    }

    const properties: PropertyDecl[] = [];
    const methods: MethodDecl[] = [];
    const staticBlocks: Block[] = [];

    if (hasBody) {
      const hasIndent = this.check("INDENT");
      const hasBrace = this.check("LBRACE");
      if (hasIndent) {
        this.advance();
      } else if (hasBrace) {
        this.advance();
      }

      while (!this.check("EOF")) {
        this.consumeStatementSeparator();
        if (hasIndent && (this.check("DEDENT") || this.check("EOF"))) break;
        if (hasBrace && (this.check("RBRACE") || this.check("EOF"))) break;
        if (!hasIndent && !hasBrace && (this.check("NEWLINE") || this.check("EOF"))) break;

        if ((this.check("IDENT") && this.current().value === "pass") || this.check("ELLIPSIS")) {
          this.advance();
          this.consumeStatementSeparator();
          continue;
        }

        let isStatic = false;
        let isReadonly = false;
        let isAsync = false;
        let hasPropKeyword = false;

        while (
          this.check("STATIC") ||
          this.check("READONLY") ||
          this.check("ASYNC") ||
          this.check("PROP")
        ) {
          if (this.check("STATIC")) {
            isStatic = true;
            this.advance();
          } else if (this.check("READONLY")) {
            isReadonly = true;
            this.advance();
          } else if (this.check("ASYNC")) {
            isAsync = true;
            this.advance();
          } else if (this.check("PROP")) {
            hasPropKeyword = true;
            this.advance();
          }
        }

        if (
          isStatic &&
          !isReadonly &&
          !isAsync &&
          !hasPropKeyword &&
          (this.check("COLON") || this.check("LBRACE"))
        ) {
          if (this.check("COLON")) this.advance();
          this.consumeStatementSeparator();
          const block = this.parseBlock();
          staticBlocks.push(block);
          this.consumeStatementSeparator();
          continue;
        }

        const isAccessor =
          this.check("IDENT") &&
          (this.current().value === "get" || this.current().value === "set") &&
          (this.isIdentOrKeyword(this.peek()) || this.peek().kind === "STRING");

        const isMethodWithoutFn =
          (isAsync || isStatic) &&
          this.isIdentOrKeyword(this.current()) &&
          this.peek().kind === "LPAREN";

        if (this.check("FN") || isAccessor || isMethodWithoutFn) {
          const accessor = isAccessor ? (this.current().value as "get" | "set") : undefined;
          const method = this.parseMethodDecl(isStatic, isAsync, accessor);
          methods.push(method);
        } else if (
          hasPropKeyword ||
          this.isIdentOrKeyword(this.current()) ||
          this.check("STRING")
        ) {
          const prop = this.parsePropertyDecl(isStatic, isReadonly, hasPropKeyword);
          properties.push(prop);
          while (this.check("COMMA")) {
            this.advance();
            const nextProp = this.parsePropertyDecl(isStatic, isReadonly, hasPropKeyword);
            properties.push(nextProp);
          }
        } else {
          throw new ParserError(
            `Unexpected token '${this.current().kind}' (${this.current().value}) in class body`,
            this.current().span,
          );
        }
        this.consumeStatementSeparator();
      }

      if (hasIndent && this.check("DEDENT")) {
        this.advance();
      } else if (hasBrace && this.check("RBRACE")) {
        this.advance();
      }
    }

    const endSpan = this.current().span;
    return {
      kind: "ClassDecl",
      name,
      isExported,
      typeParams,
      primaryConstructor,
      extends: extendsName,
      implements: implementsList.length > 0 ? implementsList : undefined,
      properties,
      methods,
      staticBlocks: staticBlocks.length > 0 ? staticBlocks : undefined,
      span: createSpan(this.file, startSpan.start, endSpan.end),
    };
  }

  private parsePropertyDecl(
    isStatic: boolean,
    isReadonly: boolean,
    hasPropKeyword: boolean = false,
  ): PropertyDecl {
    const startSpan = this.current().span;
    let lastSpan: Span = startSpan;
    const name = this.parseContextualIdentOrString("Expected property name");
    let aliases: string[] | undefined;
    let typeAnnotation: TypeExpr | undefined;
    let initialValue: Expr | undefined;

    // Check for alias: prop X, x: type = init or X, x: type = init
    if (
      this.check("COMMA") &&
      (hasPropKeyword ||
        (this.isIdentOrKeyword(this.peek()) &&
          (this.peek(2).kind === "COLON" ||
            this.peek(2).kind === "EQUAL" ||
            this.peek(2).kind === "COMMA")))
    ) {
      this.advance();
      const aliasName = this.parseContextualIdentOrString("Expected property alias");
      lastSpan = this.previous().span;
      if (!aliases) aliases = [];
      aliases.push(aliasName);
      while (
        this.check("COMMA") &&
        (hasPropKeyword ||
          (this.isIdentOrKeyword(this.peek()) &&
            (this.peek(2).kind === "COLON" ||
              this.peek(2).kind === "EQUAL" ||
              this.peek(2).kind === "COMMA")))
      ) {
        this.advance();
        const nextAlias = this.parseContextualIdentOrString("Expected property alias");
        lastSpan = this.previous().span;
        if (!aliases) aliases = [];
        aliases.push(nextAlias);
      }
    }

    let isOptional = false;
    if (this.check("QUESTION")) {
      this.advance();
      isOptional = true;
    }

    if (this.check("COLON")) {
      this.advance();
      typeAnnotation = this.parseTypeExpr();
      lastSpan = typeAnnotation.span;
    }

    // Also support: prop X: type, x
    if (hasPropKeyword && !aliases && this.check("COMMA")) {
      this.advance();
      const aliasName = this.parseContextualIdentOrString("Expected property alias");
      lastSpan = this.previous().span;
      if (!aliases) aliases = [];
      aliases.push(aliasName);
      while (this.check("COMMA")) {
        this.advance();
        const nextAlias = this.parseContextualIdentOrString("Expected property alias");
        lastSpan = this.previous().span;
        if (!aliases) aliases = [];
        aliases.push(nextAlias);
      }
    }

    if (this.check("EQUAL")) {
      this.advance();
      initialValue = this.parseExpr();
      lastSpan = initialValue.span;
    }

    const endSpan = initialValue
      ? initialValue.span
      : typeAnnotation
        ? typeAnnotation.span
        : lastSpan;
    return {
      kind: "PropertyDecl",
      name,
      alias: aliases && aliases.length > 0 ? aliases[0] : undefined,
      aliases: aliases && aliases.length > 0 ? aliases : undefined,
      isStatic,
      isReadonly,
      isOptional: isOptional ? true : undefined,
      typeAnnotation,
      initialValue,
      span: mergeSpans(startSpan, endSpan),
    };
  }

  private parseMethodDecl(
    isStatic: boolean,
    isAsync: boolean,
    accessor?: "get" | "set",
  ): MethodDecl {
    const startSpan = this.current().span;
    if (accessor) {
      this.advance(); // consume 'get' or 'set'
    } else if (this.check("FN")) {
      this.consume("FN");
    }

    let name: string;
    if (this.check("LBRACKET")) {
      this.advance();
      let inner = "";
      while (!this.check("RBRACKET") && !this.check("EOF")) {
        inner += this.advance().value;
      }
      this.consume("RBRACKET");
      name = `[${inner}]`;
    } else {
      name = this.parseContextualIdentOrString("Expected method or accessor name");
    }

    const params: ParamDecl[] = [];
    if (this.check("LPAREN")) {
      this.advance(); // consume '('
      while (!this.check("RPAREN") && !this.check("EOF")) {
        params.push(this.parseParamDecl(false, true));
        if (this.check("COMMA")) {
          this.advance();
        } else {
          break;
        }
      }
      this.consume("RPAREN");
    }

    let returnType: TypeExpr | null = null;
    if (this.check("ARROW")) {
      this.advance();
      returnType = this.parseTypeExpr();
    }

    if (this.check("EQUAL") || this.check("FAT_ARROW")) {
      this.advance();
      let hasIndent = false;
      this.consumeStatementSeparator();
      if (this.check("INDENT")) {
        this.advance();
        hasIndent = true;
      }
      this.consumeStatementSeparator();
      const body = this.parseExpr();
      this.consumeStatementSeparator();
      if (hasIndent && this.check("DEDENT")) {
        this.advance();
      }
      return {
        kind: "MethodDecl",
        name,
        isStatic,
        isAsync,
        accessor,
        params,
        returnType,
        body,
        isExpressionBodied: true,
        span: mergeSpans(startSpan, body.span),
      };
    }

    if (this.check("COLON")) {
      this.advance();
      this.consumeStatementSeparator();
    } else if (!this.check("LBRACE")) {
      throw new ParserError("Expected ':', '=', or '{' before method body", this.current().span);
    }
    const body = this.parseBlock();

    return {
      kind: "MethodDecl",
      name,
      isStatic,
      isAsync,
      accessor,
      params,
      returnType,
      body,
      isExpressionBodied: false,
      span: mergeSpans(startSpan, body.span),
    };
  }

  private parseConstDecl(isExported = false): ConstDecl {
    const startSpan = this.current().span;
    this.consume("CONST");
    const name = this.parseContextualIdentOrString("Expected constant identifier");

    let typeAnnotation: TypeExpr | undefined;
    if (this.check("COLON")) {
      this.advance();
      typeAnnotation = this.parseTypeExpr();
    }

    this.consume("EQUAL", "Expected '=' in const declaration");
    const value = this.parseExpr();

    return {
      kind: "ConstDecl",
      name,
      isExported,
      typeAnnotation,
      value,
      span: mergeSpans(startSpan, value.span),
    };
  }

  private parseVarDecl(isExported = false): VarDecl {
    const startSpan = this.current().span;
    let isMut = false;
    let name: string;
    let typeAnnotation: TypeExpr | undefined;

    if (this.check("LET")) {
      this.advance();
      if (this.check("MUT") && this.peek(1).kind !== "EQUAL" && this.peek(1).kind !== "COLON") {
        this.advance();
        isMut = true;
      }
      name = this.parseContextualIdentOrString("Expected variable identifier");
      if (this.check("COLON")) {
        this.advance();
        typeAnnotation = this.parseTypeExpr();
      }
      this.consume("EQUAL", "Expected '=' in variable declaration");
    } else if (
      this.check("VAL") &&
      this.peek(1).kind !== "COLON_EQUAL" &&
      this.peek(1).kind !== "COLON_COLON_EQUAL" &&
      !(this.peek(1).kind === "COLON" && this.isTypedDeclarationAhead())
    ) {
      this.advance();
      isMut = false;
      name = this.parseContextualIdentOrString("Expected variable identifier");
      if (this.check("COLON")) {
        this.advance();
        typeAnnotation = this.parseTypeExpr();
      }
      this.consume("EQUAL", "Expected '=' in variable declaration");
    } else {
      name = this.parseContextualIdentOrString("Expected variable identifier");
      if (this.check("COLON_EQUAL")) {
        this.advance();
        isMut = false;
      } else if (this.check("COLON_COLON_EQUAL")) {
        this.advance();
        isMut = true;
      } else if (this.check("COLON")) {
        this.advance();
        typeAnnotation = this.parseTypeExpr();
        if (this.check("COLON_COLON_EQUAL")) {
          this.advance();
          isMut = true;
        } else if (this.check("COLON_EQUAL")) {
          this.advance();
          isMut = false;
        } else if (this.check("EQUAL")) {
          this.advance();
          isMut = false;
        } else {
          throw new ParserError(
            "Expected ':=', '::=', or '=' after type annotation in variable declaration",
            this.current().span,
          );
        }
      } else {
        throw new ParserError(
          "Expected ':=', '::=', or ':' in variable declaration",
          this.current().span,
        );
      }
    }

    const value = this.parseExpr();
    this.consumeStatementSeparator();

    return {
      kind: "VarDecl",
      name,
      isExported,
      isMut,
      typeAnnotation,
      value,
      span: mergeSpans(startSpan, value.span),
    };
  }

  // Block Parsing
  private parseBlock(): Block {
    const startPos = this.current().span.start;
    const statements: Statement[] = [];

    if (this.check("INDENT")) {
      this.advance(); // consume INDENT
      this.consumeStatementSeparator();

      while (!this.check("DEDENT") && !this.check("EOF")) {
        const stmt = this.parseStatement();
        if (stmt) {
          statements.push(stmt);
        }
        this.consumeStatementSeparator();
      }

      const endSpan = this.consume("DEDENT").span;
      return {
        kind: "Block",
        statements,
        span: createSpan(this.file, startPos, endSpan.end),
      };
    }

    if (this.check("LBRACE")) {
      this.advance(); // consume '{'
      this.consumeStatementSeparator();

      while (!this.check("RBRACE") && !this.check("EOF")) {
        const stmt = this.parseStatement();
        if (stmt) {
          statements.push(stmt);
        }
        this.consumeStatementSeparator();
      }

      const endSpan = this.consume("RBRACE").span;
      return {
        kind: "Block",
        statements,
        span: createSpan(this.file, startPos, endSpan.end),
      };
    }

    // Single inline statement block
    const stmt = this.parseStatement();
    return {
      kind: "Block",
      statements: stmt ? [stmt] : [],
      span: stmt ? stmt.span : emptySpan(this.file),
    };
  }

  // Statement Parsing
  private parseStatement(): Statement | null {
    this.consumeStatementSeparator();

    if (this.isDestructureAhead()) {
      return this.parseDestructureOrVectorAssign();
    }

    const isValKeywordDecl =
      this.check("VAL") &&
      (this.isIdentOrKeyword(this.peek(1)) || this.peek(1).kind === "STRING") &&
      this.peek(1).kind !== "COLON_EQUAL" &&
      this.peek(1).kind !== "COLON_COLON_EQUAL" &&
      this.peek(1).kind !== "EQUAL" &&
      this.peek(1).kind !== "DOT" &&
      this.peek(1).kind !== "QUESTION_DOT" &&
      this.peek(1).kind !== "LBRACKET" &&
      !(this.peek(1).kind === "COLON" && this.isTypedDeclarationAhead()) &&
      this.peek(1).kind !== "PLUS_EQUAL" &&
      this.peek(1).kind !== "MINUS_EQUAL" &&
      this.peek(1).kind !== "STAR_EQUAL" &&
      this.peek(1).kind !== "SLASH_EQUAL" &&
      this.peek(1).kind !== "PERCENT_EQUAL" &&
      this.peek(1).kind !== "PIPE_EQUAL" &&
      this.peek(1).kind !== "AMP_EQUAL" &&
      this.peek(1).kind !== "CARET_EQUAL" &&
      this.peek(1).kind !== "SHL_EQUAL" &&
      this.peek(1).kind !== "SHR_EQUAL" &&
      this.peek(1).kind !== "USHR_EQUAL" &&
      this.peek(1).kind !== "STAR_STAR_EQUAL";

    if (this.check("LET") || isValKeywordDecl || this.check("CONST")) {
      return this.parseLetBinding();
    }
    if (this.check("RET")) {
      return this.parseReturnStatement();
    }
    if (this.check("IF")) {
      return this.parseIfStatement();
    }
    if (this.check("MATCH")) {
      if (this.isMatchStatementAhead()) {
        return this.parseMatchStatement();
      }
    }
    if (this.check("FOR")) {
      return this.parseForStatement();
    }
    if (this.check("WHILE")) {
      return this.parseWhileStatement();
    }
    if (this.check("TRY")) {
      return this.parseTryStatement();
    }
    if (this.check("THROW")) {
      return this.parseThrowStatement();
    }
    if (this.check("BREAK")) {
      return this.parseBreakStatement();
    }
    if (this.check("CONTINUE")) {
      return this.parseContinueStatement();
    }
    if (
      ((this.check("IDENT") && this.current().value === "pass") ||
        this.check("ELLIPSIS")) &&
      (this.peek(1).kind === "NEWLINE" ||
        this.peek(1).kind === "EOF" ||
        this.peek(1).kind === "DEDENT" ||
        this.peek(1).kind === "SEMICOLON")
    ) {
      this.advance();
      this.consumeStatementSeparator();
      return null;
    }

    if (this.isIdentOrKeyword(this.current())) {
      if (this.peek(1).kind === "COLON_EQUAL") {
        const startSpan = this.current().span;
        const name = this.advance().value;
        this.advance(); // consume ':='
        const init = this.parseExpr();
        this.consumeStatementSeparator();
        return {
          kind: "LetBinding",
          name,
          isMut: false,
          typeAnnotation: null,
          init,
          span: mergeSpans(startSpan, init.span),
        };
      }
      if (this.peek(1).kind === "COLON_COLON_EQUAL") {
        const startSpan = this.current().span;
        const name = this.advance().value;
        this.advance(); // consume '::='
        const init = this.parseExpr();
        this.consumeStatementSeparator();
        return {
          kind: "LetBinding",
          name,
          isMut: true,
          typeAnnotation: null,
          init,
          span: mergeSpans(startSpan, init.span),
        };
      }
      if (this.peek(1).kind === "COLON" && this.isTypedDeclarationAhead()) {
        const startSpan = this.current().span;
        const name = this.advance().value;
        this.advance(); // consume ':'
        const typeAnnotation = this.parseTypeExpr();
        let isMut = false;
        if (this.check("COLON_COLON_EQUAL")) {
          isMut = true;
          this.advance();
        } else if (this.check("COLON_EQUAL")) {
          isMut = false;
          this.advance();
        } else if (this.check("EQUAL")) {
          isMut = false;
          this.advance();
        } else {
          throw new ParserError(
            "Expected ':=', '::=', or '=' after type annotation in variable declaration",
            this.current().span,
          );
        }
        const init = this.parseExpr();
        this.consumeStatementSeparator();
        return {
          kind: "LetBinding",
          name,
          isMut,
          typeAnnotation,
          init,
          span: mergeSpans(startSpan, init.span),
        };
      }
    }

    // Expression statement or Assignment statement
    const expr = this.parseExpr();

    if (expr.kind === "AssignExpr") {
      this.consumeStatementSeparator();
      return {
        kind: "AssignStmt",
        target: expr.target,
        op: expr.op,
        value: expr.value,
        span: expr.span,
      };
    }

    if (
      this.check("EQUAL") ||
      this.check("PLUS_EQUAL") ||
      this.check("MINUS_EQUAL") ||
      this.check("STAR_EQUAL") ||
      this.check("SLASH_EQUAL") ||
      this.check("PERCENT_EQUAL") ||
      this.check("PIPE_EQUAL") ||
      this.check("CARET_EQUAL") ||
      this.check("AMP_EQUAL") ||
      this.check("SHL_EQUAL") ||
      this.check("SHR_EQUAL") ||
      this.check("USHR_EQUAL") ||
      this.check("STAR_STAR_EQUAL")
    ) {
      const op = this.advance().value as AssignOp;
      const val = this.parseExpr();
      this.consumeStatementSeparator();
      return {
        kind: "AssignStmt",
        target: expr,
        op,
        value: val,
        span: mergeSpans(expr.span, val.span),
      };
    }

    this.consumeStatementSeparator();
    return {
      kind: "ExprStmt",
      expr,
      span: expr.span,
    };
  }

  private isDestructureAhead(): boolean {
    let i = 0;
    if (
      this.peek(i).kind === "LET" ||
      this.peek(i).kind === "VAL" ||
      this.peek(i).kind === "CONST"
    ) {
      i++;
      if (this.peek(i).kind === "MUT") {
        i++;
      }
    }
    const openKind = this.peek(i).kind;
    if (openKind !== "LBRACKET" && openKind !== "LPAREN") return false;
    const closeKind = openKind === "LBRACKET" ? "RBRACKET" : "RPAREN";
    i++;

    let count = 0;
    let hasHole = false;
    while (true) {
      const tok = this.peek(i);
      if (!tok || tok.kind === "EOF" || tok.kind === "NEWLINE") return false;
      if (tok.kind === closeKind) {
        i++;
        break;
      }
      if (tok.kind === "COMMA") {
        hasHole = true;
        i++;
        continue;
      }
      if (tok.kind === "IDENT" || this.isIdentOrKeyword(tok)) {
        count++;
        i++;
        const next = this.peek(i);
        if (!next) return false;
        if (next.kind === "COMMA") {
          i++;
          const afterComma = this.peek(i);
          if (afterComma && afterComma.kind === closeKind) {
            i++;
            break;
          }
          continue;
        }
        if (next.kind === closeKind) {
          i++;
          break;
        }
        return false;
      }
      return false;
    }
    if (count < 1 && !hasHole) return false;

    const after = this.peek(i);
    if (!after) return false;
    if (
      after.kind === "COLON_EQUAL" ||
      after.kind === "COLON_COLON_EQUAL" ||
      after.kind === "EQUAL" ||
      after.kind === "PLUS_EQUAL" ||
      after.kind === "MINUS_EQUAL" ||
      after.kind === "STAR_EQUAL" ||
      after.kind === "SLASH_EQUAL" ||
      after.kind === "PERCENT_EQUAL" ||
      after.kind === "PIPE_EQUAL" ||
      after.kind === "CARET_EQUAL" ||
      after.kind === "AMP_EQUAL" ||
      after.kind === "SHL_EQUAL" ||
      after.kind === "SHR_EQUAL" ||
      after.kind === "USHR_EQUAL" ||
      after.kind === "STAR_STAR_EQUAL"
    ) {
      return true;
    }
    if (after.kind === "COLON") {
      let j = i + 1;
      let depth = 0;
      while (true) {
        const t = this.peek(j);
        if (!t || t.kind === "EOF" || t.kind === "NEWLINE") return false;
        if (t.kind === "LBRACKET" || t.kind === "LPAREN") depth++;
        if (t.kind === "RBRACKET" || t.kind === "RPAREN") depth--;
        if (depth === 0) {
          if (t.kind === "COLON_EQUAL" || t.kind === "COLON_COLON_EQUAL" || t.kind === "EQUAL") {
            return true;
          }
        }
        j++;
      }
    }
    return false;
  }

  private parseDestructureOrVectorAssign(): Statement {
    const startSpan = this.current().span;
    let isMut = false;
    let hasLet = false;

    if (this.check("LET") || this.check("VAL") || this.check("CONST")) {
      hasLet = true;
      if (this.check("LET")) {
        this.advance();
        if (this.check("MUT") && this.peek(1).kind !== "EQUAL" && this.peek(1).kind !== "COLON") {
          this.advance();
          isMut = true;
        }
      } else {
        this.advance(); // VAL / CONST
        isMut = false;
      }
    }

    const openKind = this.advance().kind; // consume '[' or '('
    const closeKind = openKind === "LBRACKET" ? "RBRACKET" : "RPAREN";
    const names: { name: string; span: Span }[] = [];
    let hasHole = false;

    while (!this.check(closeKind) && !this.check("EOF")) {
      if (this.check("COMMA")) {
        names.push({ name: "", span: this.current().span });
        hasHole = true;
        this.advance();
        continue;
      }
      const identTok = this.advance();
      names.push({ name: identTok.value, span: identTok.span });
      if (this.check("COMMA")) {
        this.advance();
      } else {
        break;
      }
    }
    const closeSpan = this.consume(closeKind).span;

    let typeAnnotation: TypeExpr | null = null;
    if (this.check("COLON")) {
      this.advance();
      typeAnnotation = this.parseTypeExpr();
    }

    if (this.check("COLON_EQUAL")) {
      this.advance(); // consume ':='
      const init = this.parseExpr();
      this.consumeStatementSeparator();
      return {
        kind: "DestructureBinding",
        names: names.map((n) => n.name),
        isMut: false,
        typeAnnotation,
        init,
        span: mergeSpans(startSpan, init.span),
      };
    }

    if (this.check("COLON_COLON_EQUAL")) {
      this.advance(); // consume '::='
      const init = this.parseExpr();
      this.consumeStatementSeparator();
      return {
        kind: "DestructureBinding",
        names: names.map((n) => n.name),
        isMut: true,
        typeAnnotation,
        init,
        span: mergeSpans(startSpan, init.span),
      };
    }

    if (
      this.check("EQUAL") ||
      this.check("PLUS_EQUAL") ||
      this.check("MINUS_EQUAL") ||
      this.check("STAR_EQUAL") ||
      this.check("SLASH_EQUAL") ||
      this.check("PERCENT_EQUAL") ||
      this.check("PIPE_EQUAL") ||
      this.check("CARET_EQUAL") ||
      this.check("AMP_EQUAL") ||
      this.check("SHL_EQUAL") ||
      this.check("SHR_EQUAL") ||
      this.check("USHR_EQUAL") ||
      this.check("STAR_STAR_EQUAL")
    ) {
      const op = this.advance().value as AssignOp;
      const val = this.parseExpr();
      this.consumeStatementSeparator();

      if (hasLet || (op === "=" && hasHole)) {
        return {
          kind: "DestructureBinding",
          names: names.map((n) => n.name),
          isMut,
          typeAnnotation,
          init: val,
          span: mergeSpans(startSpan, val.span),
        };
      }

      const targetSpan = mergeSpans(startSpan, closeSpan);
      const target: ArrayLiteralExpr = {
        kind: "ArrayLiteralExpr",
        elements: names.map((n) => ({
          kind: "IdentifierExpr",
          name: n.name,
          span: n.span,
        })),
        span: targetSpan,
      };
      return {
        kind: "AssignStmt",
        target,
        op,
        value: val,
        span: mergeSpans(startSpan, val.span),
      };
    }

    throw new ParserError(
      `Expected assignment or binding operator after vector destructure target, got '${this.current().kind}'`,
      this.current().span,
    );
  }

  private parseLetBinding(): LetBinding {
    const startSpan = this.current().span;

    let isMut = false;
    if (this.check("VAL") || this.check("CONST")) {
      this.advance();
      isMut = false;
    } else {
      this.consume("LET");
      if (this.check("MUT") && this.peek(1).kind !== "EQUAL" && this.peek(1).kind !== "COLON") {
        this.advance();
        isMut = true;
      }
    }

    const name = this.parseContextualIdentOrString("Expected variable name");
    let typeAnnotation: TypeExpr | null = null;

    if (this.check("COLON")) {
      this.advance();
      typeAnnotation = this.parseTypeExpr();
    }

    this.consume("EQUAL", "Expected '=' in variable declaration");
    const init = this.parseExpr();
    this.consumeStatementSeparator();

    return {
      kind: "LetBinding",
      name,
      isMut,
      typeAnnotation,
      init,
      span: mergeSpans(startSpan, init.span),
    };
  }

  private parseReturnStatement(): Statement {
    const startSpan = this.current().span;
    this.consume("RET");

    let value: Expr | null = null;
    if (
      !this.check("NEWLINE") &&
      !this.check("SEMICOLON") &&
      !this.check("DEDENT") &&
      !this.check("RBRACE") &&
      !this.check("EOF")
    ) {
      value = this.parseExpr();
    }

    this.consumeStatementSeparator();

    const ternary = value ? (value as Expr & { _ternary?: { cond: Expr; whenTrue: Expr; whenFalse: Expr } })._ternary : undefined;
    if (ternary && value) {
      return {
        kind: "IfStmt",
        condition: ternary.cond,
        thenBranch: {
          kind: "Block",
          statements: [
            {
              kind: "ReturnStmt",
              value: ternary.whenTrue,
              span: ternary.whenTrue.span,
            },
          ],
          span: ternary.whenTrue.span,
        },
        elifBranches: [],
        elseBranch: {
          kind: "Block",
          statements: [
            {
              kind: "ReturnStmt",
              value: ternary.whenFalse,
              span: ternary.whenFalse.span,
            },
          ],
          span: ternary.whenFalse.span,
        },
        span: mergeSpans(startSpan, value.span),
      };
    }

    return {
      kind: "ReturnStmt",
      value,
      span: mergeSpans(startSpan, value ? value.span : startSpan),
    };
  }

  private parseIfStatement(): IfStmt {
    const startSpan = this.current().span;
    this.consume("IF");

    const condition = this.parseExpr();
    this.consume("COLON", "Expected ':' after if condition");
    this.consumeStatementSeparator();
    const thenBranch = this.parseBlock();

    const elifBranches: { condition: Expr; body: Block; span: Span }[] = [];

    this.consumeStatementSeparator();
    while (this.check("ELIF")) {
      const eSpan = this.advance().span;
      const eCond = this.parseExpr();
      this.consume("COLON", "Expected ':' after elif condition");
      this.consumeStatementSeparator();
      const eBody = this.parseBlock();
      elifBranches.push({
        condition: eCond,
        body: eBody,
        span: mergeSpans(eSpan, eBody.span),
      });
      this.consumeStatementSeparator();
    }

    let elseBranch: Block | null = null;
    if (this.check("ELSE")) {
      this.advance();
      this.consume("COLON", "Expected ':' after else");
      this.consumeStatementSeparator();
      elseBranch = this.parseBlock();
    }

    const lastSpan = elseBranch
      ? elseBranch.span
      : elifBranches.length > 0
        ? elifBranches[elifBranches.length - 1].span
        : thenBranch.span;

    return {
      kind: "IfStmt",
      condition,
      thenBranch,
      elifBranches,
      elseBranch,
      span: mergeSpans(startSpan, lastSpan),
    };
  }

  private parseMatchStatement(): MatchStmt {
    const startSpan = this.current().span;
    this.consume("MATCH");

    const target = this.parseExpr();
    this.consume("COLON", "Expected ':' after match target");
    this.consumeStatementSeparator();

    const cases: MatchCase[] = [];
    this.consume("INDENT", "Expected indented match cases");

    while (!this.check("DEDENT") && !this.check("EOF")) {
      this.consumeStatementSeparator();
      if (this.check("DEDENT") || this.check("EOF")) break;

      const cSpan = this.current().span;
      if (this.check("CASE")) {
        this.advance();
      }

      const pattern = this.parsePattern();
      let guard: Expr | undefined;

      if (this.check("IF")) {
        this.advance();
        guard = this.parseExpr();
      }

      if (this.check("FAT_ARROW") || this.check("COLON")) {
        this.advance();
      } else {
        throw new ParserError("Expected '=>' or ':' after match pattern", this.current().span);
      }

      let body: Block | Expr;
      if (this.check("NEWLINE")) {
        this.consumeStatementSeparator();
        if (this.check("INDENT") || this.check("LBRACE")) {
          body = this.parseBlock();
        } else if (
          this.check("RET") ||
          this.check("BREAK") ||
          this.check("CONTINUE") ||
          this.check("THROW") ||
          this.check("LET") ||
          this.check("VAL") ||
          this.check("CONST") ||
          this.check("IF") ||
          this.check("WHILE") ||
          this.check("FOR") ||
          this.check("TRY")
        ) {
          const stmt = this.parseStatement()!;
          body = {
            kind: "Block",
            statements: [stmt],
            span: stmt.span,
          };
        } else {
          body = this.parseExpr();
          this.consumeStatementSeparator();
        }
      } else if (this.check("LBRACE")) {
        body = this.parseBlock();
      } else if (
        this.check("RET") ||
        this.check("BREAK") ||
        this.check("CONTINUE") ||
        this.check("THROW") ||
        this.check("LET") ||
        this.check("VAL") ||
        this.check("CONST") ||
        this.check("IF") ||
        this.check("WHILE") ||
        this.check("FOR") ||
        this.check("TRY")
      ) {
        const stmt = this.parseStatement()!;
        body = {
          kind: "Block",
          statements: [stmt],
          span: stmt.span,
        };
      } else {
        body = this.parseExpr();
        this.consumeStatementSeparator();
      }

      cases.push({
        pattern,
        guard,
        body,
        span: mergeSpans(cSpan, body.span),
      });

      this.consumeStatementSeparator();
    }

    const endSpan = this.consume("DEDENT").span;

    return {
      kind: "MatchStmt",
      target,
      cases,
      span: mergeSpans(startSpan, endSpan),
    };
  }

  private parsePattern(): Pattern {
    const tok = this.current();

    if (tok.kind === "IDENT" && tok.value === "_") {
      this.advance();
      return { kind: "WildcardPattern", span: tok.span };
    }

    if (
      tok.kind === "NUMBER" ||
      tok.kind === "STRING" ||
      tok.kind === "BOOLEAN" ||
      tok.kind === "NIL"
    ) {
      const lit = this.parsePrimary() as LiteralExpr;
      return { kind: "LiteralPattern", value: lit, span: lit.span };
    }

    if (tok.kind === "IDENT" || this.isContextualIdentifier(tok)) {
      this.advance();
      let name = tok.value;
      let lastSpan = tok.span;
      while (this.check("DOT")) {
        this.advance();
        const nextTok = this.advance();
        name += "." + nextTok.value;
        lastSpan = nextTok.span;
      }
      // Check for constructor pattern: Some(val) or Ok(res)
      if (this.check("LPAREN")) {
        this.advance();
        const subPatterns: Pattern[] = [];
        while (!this.check("RPAREN") && !this.check("EOF")) {
          subPatterns.push(this.parsePattern());
          if (this.check("COMMA")) this.advance();
        }
        const endSpan = this.consume("RPAREN").span;
        return {
          kind: "ConstructorPattern",
          name,
          subPatterns,
          span: mergeSpans(tok.span, endSpan),
        };
      }

      return { kind: "IdentifierPattern", name, span: mergeSpans(tok.span, lastSpan) };
    }

    throw new ParserError(`Unexpected pattern token '${tok.kind}'`, tok.span);
  }

  private parseForStatement(): ForStmt {
    const startSpan = this.current().span;
    this.consume("FOR");

    let variable: string;
    if (this.check("LBRACE")) {
      this.advance(); // consume '{'
      const elements: string[] = [];
      while (!this.check("RBRACE") && !this.check("EOF")) {
        const key = this.parseContextualIdentOrString("Expected property name");
        if (this.check("COLON")) {
          this.advance();
          const alias = this.parseContextualIdentOrString("Expected alias name");
          elements.push(`${key}: ${alias}`);
        } else {
          elements.push(key);
        }
        if (this.check("COMMA")) {
          this.advance();
        } else {
          break;
        }
      }
      this.consume("RBRACE");
      variable = `{ ${elements.join(", ")} }`;
    } else if (this.check("LBRACKET") || this.check("LPAREN")) {
      const isBracket = this.check("LBRACKET");
      const closeKind = isBracket ? "RBRACKET" : "RPAREN";
      this.advance(); // consume '[' or '('
      const elements: string[] = [];
      while (!this.check(closeKind) && !this.check("EOF")) {
        if (this.check("COMMA")) {
          elements.push("");
          this.advance();
          continue;
        }
        elements.push(this.parseContextualIdentOrString("Expected variable name"));
        if (this.check("COMMA")) {
          this.advance();
        } else {
          break;
        }
      }
      this.consume(closeKind);
      variable = isBracket ? `[${elements.join(", ")}]` : `(${elements.join(", ")})`;
    } else {
      variable = this.parseContextualIdentOrString("Expected loop variable name");
    }

    this.consume("IN", "Expected 'in' in for loop");
    const iterable = this.parseExpr();
    this.consume("COLON", "Expected ':' after for loop iterable");
    this.consumeStatementSeparator();
    const body = this.parseBlock();

    return {
      kind: "ForStmt",
      variable,
      iterable,
      body,
      span: mergeSpans(startSpan, body.span),
    };
  }

  private parseWhileStatement(): WhileStmt {
    const startSpan = this.current().span;
    this.consume("WHILE");

    const condition = this.parseExpr();
    this.consume("COLON", "Expected ':' after while condition");
    this.consumeStatementSeparator();
    const body = this.parseBlock();

    return {
      kind: "WhileStmt",
      condition,
      body,
      span: mergeSpans(startSpan, body.span),
    };
  }

  private parseTryStatement(): TryStmt {
    const startSpan = this.current().span;
    this.consume("TRY");
    if (this.check("COLON")) {
      this.advance();
    }
    this.consumeStatementSeparator();
    const tryBlock = this.parseBlock();

    let catchParam: string | undefined;
    let catchBlock: Block | undefined;
    let finallyBlock: Block | undefined;

    this.consumeStatementSeparator();
    if (this.check("CATCH")) {
      this.advance();
      if (this.check("LPAREN")) {
        this.advance();
        catchParam = this.parseContextualIdentOrString("Expected catch parameter");
        this.consume("RPAREN");
      } else if (
        (this.check("IDENT") || this.isContextualIdentifier(this.current())) &&
        !this.check("COLON") &&
        !this.check("LBRACE") &&
        !this.check("NEWLINE")
      ) {
        catchParam = this.advance().value;
      }
      if (this.check("COLON")) {
        this.advance();
      }
      this.consumeStatementSeparator();
      catchBlock = this.parseBlock();
    }

    this.consumeStatementSeparator();
    if (this.check("FINALLY")) {
      this.advance();
      if (this.check("COLON")) {
        this.advance();
      }
      this.consumeStatementSeparator();
      finallyBlock = this.parseBlock();
    }

    if (!catchBlock && !finallyBlock) {
      throw new ParserError("Expected 'catch' or 'finally' after 'try' block", startSpan);
    }

    const endSpan = (finallyBlock ?? catchBlock ?? tryBlock).span;
    return {
      kind: "TryStmt",
      tryBlock,
      catchParam,
      catchBlock,
      finallyBlock,
      span: mergeSpans(startSpan, endSpan),
    };
  }

  private parseThrowStatement(): ThrowStmt {
    const startSpan = this.current().span;
    this.consume("THROW");
    const expr = this.parseExpr();
    this.consumeStatementSeparator();
    return {
      kind: "ThrowStmt",
      expr,
      span: mergeSpans(startSpan, expr.span),
    };
  }

  private parseBreakStatement(): BreakStmt {
    const span = this.current().span;
    this.consume("BREAK");
    this.consumeStatementSeparator();
    return {
      kind: "BreakStmt",
      span,
    };
  }

  private parseContinueStatement(): ContinueStmt {
    const span = this.current().span;
    this.consume("CONTINUE");
    this.consumeStatementSeparator();
    return {
      kind: "ContinueStmt",
      span,
    };
  }

  // Pratt Expression Parsing
  parseExpr(precedence = Precedence.LOWEST): Expr {
    let left = this.parsePrefix();

    while (precedence < this.currentPrecedence()) {
      left = this.parseInfix(left);
    }

    return left;
  }

  private currentPrecedence(): Precedence {
    if (this.current().kind === "QUESTION" && this.isTernaryQuestion()) {
      return Precedence.TERNARY;
    }
    return PRECEDENCES[this.current().kind] ?? Precedence.LOWEST;
  }

  private isTernaryQuestion(): boolean {
    if (this.current().kind !== "QUESTION") return false;
    const firstAfter = this.peek(1).kind;
    if (
      firstAfter === "COLON" ||
      firstAfter === "NEWLINE" ||
      firstAfter === "SEMICOLON" ||
      firstAfter === "DEDENT" ||
      firstAfter === "EOF" ||
      firstAfter === "RPAREN" ||
      firstAfter === "RBRACKET" ||
      firstAfter === "RBRACE" ||
      firstAfter === "COMMA" ||
      firstAfter === "DOT" ||
      firstAfter === "QUESTION_DOT" ||
      firstAfter === "EQ_EQ" ||
      firstAfter === "NOT_EQ" ||
      firstAfter === "LT_EQ" ||
      firstAfter === "GT_EQ" ||
      firstAfter === "AMP_AMP" ||
      firstAfter === "PIPE_PIPE" ||
      firstAfter === "QUESTION_QUESTION" ||
      firstAfter === "EQUAL" ||
      firstAfter === "COLON_EQUAL" ||
      firstAfter === "COLON_COLON_EQUAL"
    ) {
      return false;
    }

    let depth = 0;
    for (let i = this.cursor + 1; i < this.tokens.length; i++) {
      const k = this.tokens[i].kind;
      if (k === "LPAREN" || k === "LBRACKET" || k === "LBRACE") {
        depth++;
      } else if (k === "RPAREN" || k === "RBRACKET" || k === "RBRACE") {
        if (depth === 0) return false;
        depth--;
      } else if (depth === 0) {
        if (k === "NEWLINE" || k === "SEMICOLON" || k === "DEDENT" || k === "EOF" || k === "COMMA") {
          return false;
        }
        if (k === "COLON") {
          const afterColon = this.tokens[i + 1]?.kind ?? "EOF";
          return (
            afterColon !== "NEWLINE" &&
            afterColon !== "INDENT" &&
            afterColon !== "SEMICOLON" &&
            afterColon !== "EOF"
          );
        }
      }
    }
    return false;
  }

  private parsePrefix(): Expr {
    const tok = this.current();

    // 1. Literal Expressions
    if (tok.kind === "NUMBER") {
      this.advance();
      const val =
        tok.value.startsWith("0x") || tok.value.startsWith("0X")
          ? Number.parseInt(tok.value, 16)
          : tok.value.startsWith("0b") || tok.value.startsWith("0B")
            ? Number.parseInt(tok.value.slice(2), 2)
            : tok.value.includes(".")
              ? Number.parseFloat(tok.value)
              : Number(tok.value);
      return {
        kind: "LiteralExpr",
        literalKind: "number",
        value: Number.isNaN(val) ? tok.value : val,
        rawValue: tok.value,
        span: tok.span,
      };
    }

    if (tok.kind === "STRING" || tok.kind === "HEX_COLOR") {
      this.advance();
      return {
        kind: "LiteralExpr",
        literalKind: "string",
        value: tok.value,
        rawValue: tok.kind === "HEX_COLOR" ? `"${tok.value}"` : `"${tok.value}"`,
        span: tok.span,
      };
    }

    if (tok.kind === "BOOLEAN") {
      this.advance();
      return {
        kind: "LiteralExpr",
        literalKind: "boolean",
        value: tok.value === "true",
        rawValue: tok.value,
        span: tok.span,
      };
    }

    if (tok.kind === "NIL") {
      this.advance();
      return {
        kind: "LiteralExpr",
        literalKind: "nil",
        value: null,
        rawValue: "nil",
        span: tok.span,
      };
    }

    // Template Literals (backticks)
    if (tok.kind === "TEMPLATE_NO_SUBST") {
      this.advance();
      return {
        kind: "TemplateLiteralExpr",
        quasis: [tok.value],
        expressions: [],
        span: tok.span,
      };
    }

    if (tok.kind === "TEMPLATE_HEAD") {
      const startSpan = tok.span;
      this.advance();
      const quasis: string[] = [tok.value];
      const expressions: Expr[] = [];

      expressions.push(this.parseExpr());

      while (this.check("TEMPLATE_MIDDLE")) {
        const mid = this.advance();
        quasis.push(mid.value);
        expressions.push(this.parseExpr());
      }

      const tail = this.consume("TEMPLATE_TAIL", "Expected closing '`' for template literal");
      quasis.push(tail.value);

      return {
        kind: "TemplateLiteralExpr",
        quasis,
        expressions,
        span: mergeSpans(startSpan, tail.span),
      };
    }

    // 2. Await Expression
    if (tok.kind === "AWAIT" || (tok.kind === "IDENT" && tok.value === "await")) {
      this.advance();
      const operand = this.parseExpr(Precedence.PREFIX);
      return {
        kind: "AwaitExpr",
        operand,
        span: mergeSpans(tok.span, operand.span),
      };
    }

    // 2b. Async Function / Closure Expression: async fn(...)
    if (
      (tok.kind === "ASYNC" || (tok.kind === "IDENT" && tok.value === "async")) &&
      this.peek().kind === "FN"
    ) {
      this.advance(); // consume async
      return this.parseClosureExpr(tok.span, true);
    }

    // Arrow function: x => expr
    if (
      (tok.kind === "IDENT" || this.isContextualIdentifier(tok)) &&
      this.peek().kind === "FAT_ARROW"
    ) {
      this.advance();
      const paramName = tok.value;
      const paramSpan = tok.span;
      this.consume("FAT_ARROW");
      let hasIndent = false;
      this.consumeStatementSeparator();
      if (this.check("INDENT")) {
        this.advance();
        hasIndent = true;
      }
      this.consumeStatementSeparator();
      const body = this.parseExpr();
      this.consumeStatementSeparator();
      if (hasIndent && this.check("DEDENT")) {
        this.advance();
      }
      return {
        kind: "ClosureExpr",
        params: [{ name: paramName, typeAnnotation: null, span: paramSpan }],
        returnType: null,
        body,
        span: mergeSpans(paramSpan, body.span),
      };
    }

    if (tok.kind === "IDENT" || tok.kind === "IMPORT" || this.isContextualIdentifier(tok)) {
      this.advance();
      return {
        kind: "IdentifierExpr",
        name: tok.value,
        span: tok.span,
      };
    }

    // 3. Unary Operators (-, not, !, ...)
    if (
      tok.kind === "MINUS" ||
      tok.kind === "NOT" ||
      tok.kind === "BANG" ||
      tok.kind === "ELLIPSIS"
    ) {
      if (
        tok.kind === "ELLIPSIS" &&
        (this.peek(1).kind === "NEWLINE" ||
          this.peek(1).kind === "SEMICOLON" ||
          this.peek(1).kind === "EOF" ||
          this.peek(1).kind === "DEDENT" ||
          this.peek(1).kind === "RPAREN" ||
          this.peek(1).kind === "RBRACE" ||
          this.peek(1).kind === "RBRACKET" ||
          this.peek(1).kind === "COMMA")
      ) {
        this.advance();
        return {
          kind: "LiteralExpr",
          literalKind: "string",
          value: "...",
          rawValue: '"..."',
          span: tok.span,
        };
      }
      this.advance();
      const op =
        tok.kind === "MINUS"
          ? "-"
          : tok.kind === "BANG"
            ? "!"
            : tok.kind === "ELLIPSIS"
              ? "..."
              : "not";
      const operand = this.parseExpr(Precedence.PREFIX);
      return {
        kind: "UnaryExpr",
        operator: op,
        operand,
        span: mergeSpans(tok.span, operand.span),
      };
    }

    // 4. Grouped Expression or Arrow Function: ( expr ) or ( a, b ) => expr
    if (tok.kind === "LPAREN") {
      if (this.isArrowFunction()) {
        this.advance(); // consume LPAREN
        const params: ParamDecl[] = [];
        while (!this.check("RPAREN") && !this.check("EOF")) {
          params.push(this.parseParamDecl(true));
          if (this.check("COMMA")) {
            this.advance();
          } else {
            break;
          }
        }
        this.consume("RPAREN");

        let returnType: TypeExpr | null = null;
        if (this.check("ARROW")) {
          this.advance();
          returnType = this.parseTypeExpr();
        }

        this.consume("FAT_ARROW");

        let hasIndent = false;
        this.consumeStatementSeparator();
        if (this.check("INDENT")) {
          this.advance();
          hasIndent = true;
        }
        this.consumeStatementSeparator();
        let body: Expr | Block;
        if (this.check("COLON") || this.check("LBRACE")) {
          if (this.check("COLON")) this.advance();
          body = this.parseBlock();
        } else {
          body = this.parseExpr();
        }
        this.consumeStatementSeparator();
        if (hasIndent && this.check("DEDENT")) {
          this.advance();
        }

        return {
          kind: "ClosureExpr",
          params,
          returnType,
          body,
          span: mergeSpans(tok.span, body.span),
        };
      }

      this.advance();
      const expr = this.parseExpr();
      const endSpan = this.consume("RPAREN").span;
      return {
        ...expr,
        span: mergeSpans(tok.span, endSpan),
      };
    }

    // 5. Array Literal: [ item1, item2, ...spread ]
    if (tok.kind === "LBRACKET") {
      this.advance();
      const elements: Expr[] = [];
      while (!this.check("RBRACKET") && !this.check("EOF")) {
        elements.push(this.parseExpr());
        if (this.check("COMMA")) this.advance();
      }
      const endSpan = this.consume("RBRACKET").span;
      return {
        kind: "ArrayLiteralExpr",
        elements,
        span: mergeSpans(tok.span, endSpan),
      };
    }

    // 6. Record Literal: { key: value, ... } or shorthand { key, ... } or spread { ...expr, ... }
    if (tok.kind === "LBRACE") {
      this.advance();
      const properties: RecordProperty[] = [];
      while (!this.check("RBRACE") && !this.check("EOF")) {
        if (this.check("ELLIPSIS")) {
          const spreadTok = this.advance();
          const target = this.parseExpr();
          properties.push({
            isSpread: true,
            value: target,
            span: mergeSpans(spreadTok.span, target.span),
          });
          if (this.check("COMMA") || this.check("SEMICOLON") || this.check("NEWLINE")) this.advance();
          continue;
        }

        const kSpan = this.current().span;
        const key = this.parsePropertyKey("Expected property key in record literal");
        let val: Expr;
        let pSpan = kSpan;
        if (this.check("COLON")) {
          this.advance();
          val = this.parseExpr();
          pSpan = mergeSpans(kSpan, val.span);
        } else {
          // Property shorthand: { cents, currency } => { cents: cents, currency: currency }
          val = { kind: "IdentifierExpr", name: key, span: kSpan };
        }
        properties.push({
          key,
          value: val,
          span: pSpan,
        });
        if (this.check("COMMA") || this.check("SEMICOLON") || this.check("NEWLINE")) this.advance();
      }
      const endSpan = this.consume("RBRACE").span;
      return {
        kind: "RecordLiteralExpr",
        properties,
        span: mergeSpans(tok.span, endSpan),
      };
    }

    // 7. Anonymous Function / Closure: fn(params) -> Type = expr
    if (tok.kind === "FN") {
      if (this.isClosureAhead()) {
        return this.parseClosureExpr(tok.span, false);
      }
      this.advance();
      return {
        kind: "IdentifierExpr",
        name: tok.value,
        span: tok.span,
      };
    }

    throw new ParserError(`Unexpected expression token '${tok.kind}' (${tok.value})`, tok.span);
  }

  private parseInfix(left: Expr): Expr {
    const tok = this.current();

    // 1. C-style ternary (cond ? thenExpr : elseExpr) or Postfix ? operator (Try unwrap Result/Option)
    if (tok.kind === "QUESTION") {
      if (this.isTernaryQuestion()) {
        this.advance(); // consume '?'
        const whenTrue = this.parseExpr(Precedence.LOWEST);
        this.consume("COLON", "Expected ':' in ternary expression");
        const whenFalse = this.parseExpr(Precedence.TERNARY - 1);
        const span = mergeSpans(left.span, whenFalse.span);
        const binExpr: Expr & { _ternary?: { cond: Expr; whenTrue: Expr; whenFalse: Expr } } = {
          kind: "BinaryExpr",
          operator: "or",
          left: {
            kind: "BinaryExpr",
            operator: "and",
            left,
            right: whenTrue,
            span: mergeSpans(left.span, whenTrue.span),
          },
          right: whenFalse,
          span,
          _ternary: { cond: left, whenTrue, whenFalse },
        };
        return binExpr;
      }
      this.advance();
      return {
        kind: "PostfixTryExpr",
        operand: left,
        span: mergeSpans(left.span, tok.span),
      };
    }

    // 2. Optional Function Call: expr?.(arg1, arg2)
    if (tok.kind === "QUESTION_DOT" && this.peek(1).kind === "LPAREN") {
      this.advance(); // consume '?.'
      this.advance(); // consume '('
      const args: Expr[] = [];
      while (!this.check("RPAREN") && !this.check("EOF")) {
        args.push(this.parseExpr());
        if (this.check("COMMA")) this.advance();
      }
      const endSpan = this.consume("RPAREN").span;
      return {
        kind: "CallExpr",
        callee: left,
        args,
        isOptional: true,
        span: mergeSpans(left.span, endSpan),
      };
    }

    // 2b. Function Call: expr(arg1, arg2)
    if (tok.kind === "LPAREN") {
      this.advance();
      const args: Expr[] = [];
      while (!this.check("RPAREN") && !this.check("EOF")) {
        args.push(this.parseExpr());
        if (this.check("COMMA")) this.advance();
      }
      const endSpan = this.consume("RPAREN").span;
      return {
        kind: "CallExpr",
        callee: left,
        args,
        span: mergeSpans(left.span, endSpan),
      };
    }

    // 3. Member Access: expr.prop or expr?.prop
    if (tok.kind === "DOT" || tok.kind === "QUESTION_DOT") {
      const isSafeNav = tok.kind === "QUESTION_DOT";
      this.advance();
      const propName = this.parseContextualIdentOrString("Expected property identifier after '.'");
      return {
        kind: "MemberAccessExpr",
        object: left,
        property: propName,
        isSafeNav,
        span: mergeSpans(left.span, this.previous().span),
      };
    }

    // 4. Indexing: expr[index]
    if (tok.kind === "LBRACKET") {
      this.advance();
      const index = this.parseExpr();
      const endSpan = this.consume("RBRACKET").span;
      return {
        kind: "IndexExpr",
        object: left,
        index,
        span: mergeSpans(left.span, endSpan),
      };
    }

    // 5. Assignment Expression: target = value / target += value etc.
    if (
      tok.kind === "EQUAL" ||
      tok.kind === "PLUS_EQUAL" ||
      tok.kind === "MINUS_EQUAL" ||
      tok.kind === "STAR_EQUAL" ||
      tok.kind === "SLASH_EQUAL" ||
      tok.kind === "PERCENT_EQUAL" ||
      tok.kind === "PIPE_EQUAL" ||
      tok.kind === "CARET_EQUAL" ||
      tok.kind === "AMP_EQUAL" ||
      tok.kind === "SHL_EQUAL" ||
      tok.kind === "SHR_EQUAL" ||
      tok.kind === "USHR_EQUAL" ||
      tok.kind === "STAR_STAR_EQUAL"
    ) {
      const op = this.advance().value as AssignOp;
      const value = this.parseExpr(Precedence.ASSIGN - 1);
      return {
        kind: "AssignExpr",
        target: left,
        op,
        value,
        span: mergeSpans(left.span, value.span),
      };
    }

    // 6. Binary Operations: +, -, *, /, %, **, &, |, ^, <<, >>, >>>, ==, !=, and, or, ??
    const prec = this.currentPrecedence();
    this.advance();

    const opMap: Partial<Record<TokenKind, BinaryOp>> = {
      PLUS: "+",
      MINUS: "-",
      STAR: "*",
      SLASH: "/",
      PERCENT: "%",
      STAR_STAR: "**",
      AMPERSAND: "&",
      PIPE: "|",
      CARET: "^",
      SHL: "<<",
      SHR: ">>",
      USHR: ">>>",
      EQ_EQ: "==",
      NOT_EQ: "!=",
      LT: "<",
      LT_EQ: "<=",
      GT: ">",
      GT_EQ: ">=",
      IN: "in",
      INSTANCEOF: "instanceof",
      AND: "and",
      AMP_AMP: "&&",
      OR: "or",
      PIPE_PIPE: "||",
      QUESTION_QUESTION: "??",
    };

    const op = opMap[tok.kind];
    if (!op) {
      throw new ParserError(`Unknown binary operator '${tok.kind}'`, tok.span);
    }

    const right = tok.kind === "STAR_STAR" ? this.parseExpr(prec - 1) : this.parseExpr(prec);
    return {
      kind: "BinaryExpr",
      operator: op,
      left,
      right,
      span: mergeSpans(left.span, right.span),
    };
  }

  private parsePrimary(): Expr {
    return this.parsePrefix();
  }

  private parseClosureExpr(startSpan: Span, isAsync = false): ClosureExpr {
    this.consume("FN");
    this.consume("LPAREN");
    const params: ParamDecl[] = [];
    while (!this.check("RPAREN") && !this.check("EOF")) {
      params.push(this.parseParamDecl(true));
      if (this.check("COMMA")) {
        this.advance();
      } else {
        break;
      }
    }
    this.consume("RPAREN");

    let returnType: TypeExpr | null = null;
    if (this.check("ARROW")) {
      this.advance();
      returnType = this.parseTypeExpr();
    }

    if (this.check("EQUAL") || this.check("FAT_ARROW")) {
      this.advance();
      let hasIndent = false;
      this.consumeStatementSeparator();
      if (this.check("INDENT")) {
        this.advance();
        hasIndent = true;
      }
      this.consumeStatementSeparator();
      const body = this.parseExpr();
      this.consumeStatementSeparator();
      if (hasIndent && this.check("DEDENT")) {
        this.advance();
      }
      return {
        kind: "ClosureExpr",
        isAsync: isAsync || undefined,
        params,
        returnType,
        body,
        span: mergeSpans(startSpan, body.span),
      };
    }

    if (!this.check("COLON") && !this.check("LBRACE")) {
      return {
        kind: "ClosureExpr",
        isAsync: isAsync || undefined,
        params,
        returnType,
        body: {
          kind: "Block",
          statements: [],
          span: startSpan,
        },
        span: mergeSpans(startSpan, this.previous().span),
      };
    }

    if (this.check("COLON")) {
      this.advance();
      this.consumeStatementSeparator();
    }
    const body = this.parseBlock();
    return {
      kind: "ClosureExpr",
      isAsync: isAsync || undefined,
      params,
      returnType,
      body,
      span: mergeSpans(startSpan, body.span),
    };
  }

  private isArrowFunction(): boolean {
    if (!this.check("LPAREN")) return false;
    let parenDepth = 0;
    let i = this.cursor;
    while (i < this.tokens.length) {
      const t = this.tokens[i];
      if (t.kind === "LPAREN") {
        parenDepth++;
      } else if (t.kind === "RPAREN") {
        parenDepth--;
        if (parenDepth === 0) {
          const next = this.tokens[i + 1];
          if (!next) return false;
          if (next.kind === "FAT_ARROW") {
            return true;
          }
          if (next.kind === "ARROW") {
            let j = i + 2;
            let typeParen = 0;
            let typeBracket = 0;
            while (j < this.tokens.length) {
              const tt = this.tokens[j];
              if (tt.kind === "LPAREN") typeParen++;
              else if (tt.kind === "RPAREN") typeParen--;
              else if (tt.kind === "LBRACKET") typeBracket++;
              else if (tt.kind === "RBRACKET") typeBracket--;
              else if (typeParen === 0 && typeBracket === 0) {
                if (tt.kind === "FAT_ARROW" || tt.kind === "EQUAL") return true;
                if (tt.kind === "COLON" || tt.kind === "NEWLINE" || tt.kind === "EOF") break;
              }
              j++;
            }
          }
          return false;
        }
      }
      i++;
    }
    return false;
  }

  // Declarative UI Component DSL Parsing
  private parseComponentDecl(): ComponentDecl {
    const startSpan = this.current().span;
    this.consume("COMPONENT");

    const name = this.parseContextualIdentOrString("Expected component name");
    const params: ParamDecl[] = [];

    if (this.check("LPAREN")) {
      this.advance();
      while (!this.check("RPAREN") && !this.check("EOF")) {
        const pSpan = this.current().span;
        const pName = this.parseContextualIdentOrString("Expected parameter name");
        let isOptional = false;
        if (this.check("QUESTION")) {
          this.advance();
          isOptional = true;
        }
        this.consume("COLON");
        const pType = this.parseTypeExpr();

        let defaultValue: Expr | undefined;
        if (this.check("EQUAL")) {
          this.advance();
          defaultValue = this.parseExpr();
        }

        params.push({
          name: pName,
          typeAnnotation: pType,
          defaultValue,
          isOptional: isOptional ? true : undefined,
          span: mergeSpans(pSpan, defaultValue ? defaultValue.span : pType.span),
        });

        if (this.check("COMMA")) this.advance();
      }
      this.consume("RPAREN");
    }

    this.consume("COLON", "Expected ':' before component layout");
    this.consumeStatementSeparator();

    const layout: LayoutNode[] = [];
    this.consume("INDENT", "Expected indented component layout tree");

    while (!this.check("DEDENT") && !this.check("EOF")) {
      this.consumeStatementSeparator();
      if (this.check("DEDENT") || this.check("EOF")) break;

      layout.push(this.parseLayoutNode());
      this.consumeStatementSeparator();
    }

    const endSpan = this.consume("DEDENT").span;

    return {
      kind: "ComponentDecl",
      name,
      params,
      layout,
      span: mergeSpans(startSpan, endSpan),
    };
  }

  private parseLayoutNode(parentTag?: string): LayoutNode {
    const startSpan = this.current().span;

    let tag: string | null = null;
    const classes: string[] = [];
    let id: string | null = null;

    // 1. Selector shorthand (.class, #id) or explicit tag name / inline modifier (_)
    if (this.check("DOT")) {
      this.advance(); // consume '.'
      classes.push(this.parseCssKebabIdent());
    } else if (this.check("HASH")) {
      this.advance(); // consume '#'
      id = this.parseCssKebabIdent();
    } else if (this.check("HEX_COLOR")) {
      id = this.advance().value.slice(1);
    } else {
      const ident = this.parseContextualIdentOrString("Expected UI layout tag name");
      if (ident === "_") {
        tag = "span";
      } else {
        tag = ident;
      }
    }

    // 2. Chained classes and/or ID: e.g. button.btn.btn-icon#btn-theme-toggle
    while (!this.check("EOF")) {
      if (this.check("DOT")) {
        this.advance(); // consume '.'
        classes.push(this.parseCssKebabIdent());
      } else if (this.check("HASH")) {
        this.advance(); // consume '#'
        id = this.parseCssKebabIdent();
      } else if (this.check("HEX_COLOR")) {
        id = this.advance().value.slice(1);
      } else {
        break;
      }
    }

    // 3. Infer tag if omitted from parent context
    if (!tag) {
      if (parentTag) {
        const lowerParent = parentTag.toLowerCase();
        if (lowerParent === "ul" || lowerParent === "ol") {
          tag = "li";
        } else if (
          lowerParent === "table" ||
          lowerParent === "tbody" ||
          lowerParent === "thead" ||
          lowerParent === "tfoot"
        ) {
          tag = "tr";
        } else if (lowerParent === "tr") {
          tag = "td";
        } else if (lowerParent === "select") {
          tag = "option";
        } else if (lowerParent === "dl") {
          tag = "dt";
        } else if (
          lowerParent === "button" ||
          lowerParent === "p" ||
          lowerParent === "label" ||
          lowerParent === "a" ||
          lowerParent === "span" ||
          /^h[1-6]$/.test(lowerParent) ||
          lowerParent === "b" ||
          lowerParent === "i" ||
          lowerParent === "strong" ||
          lowerParent === "em"
        ) {
          tag = "span";
        } else {
          tag = "div";
        }
      } else {
        tag = "div";
      }
    }

    const attributes: { name: string; value: Expr; span: Span }[] = [];

    // Optional attributes: Tag(prop: val, onClick: handle)
    if (this.check("LPAREN")) {
      this.advance();
      while (!this.check("RPAREN") && !this.check("EOF")) {
        const aSpan = this.current().span;
        const aName = this.check("STRING")
          ? this.advance().value
          : this.parseCssKebabIdent();
        this.consume("COLON");
        const aVal = this.parseExpr();

        attributes.push({
          name: aName,
          value: aVal,
          span: mergeSpans(aSpan, aVal.span),
        });

        if (this.check("COMMA")) this.advance();
      }
      this.consume("RPAREN");
    }

    // Merge selector classes into attributes
    if (classes.length > 0) {
      const existingClassAttr = attributes.find(
        (a) => a.name === "class" || a.name === "className",
      );
      if (existingClassAttr) {
        if (
          existingClassAttr.value.kind === "LiteralExpr" &&
          existingClassAttr.value.literalKind === "string"
        ) {
          const merged = `${classes.join(" ")} ${existingClassAttr.value.value}`;
          existingClassAttr.value = {
            ...existingClassAttr.value,
            value: merged,
            rawValue: JSON.stringify(merged),
          };
        }
      } else {
        const classVal = classes.join(" ");
        attributes.unshift({
          name: "class",
          value: {
            kind: "LiteralExpr",
            literalKind: "string",
            value: classVal,
            rawValue: JSON.stringify(classVal),
            span: startSpan,
          },
          span: startSpan,
        });
      }
    }

    // Merge selector ID into attributes
    if (id !== null) {
      const existingIdAttr = attributes.find((a) => a.name === "id");
      if (!existingIdAttr) {
        attributes.push({
          name: "id",
          value: {
            kind: "LiteralExpr",
            literalKind: "string",
            value: id,
            rawValue: JSON.stringify(id),
            span: startSpan,
          },
          span: startSpan,
        });
      }
    }

    let textLiteral: string | null = null;
    let childExpr: Expr | null = null;
    const children: LayoutNode[] = [];

    // Direct text literal child without colon: .brand-icon "⚡"
    if (this.check("STRING")) {
      const strTok = this.advance();
      textLiteral = strTok.value;
      this.consumeStatementSeparator();
      return {
        kind: "LayoutNode",
        tag,
        attributes,
        textLiteral,
        children,
        span: mergeSpans(startSpan, strTok.span),
      };
    }

    // Tag body / children with ':'
    if (this.check("COLON")) {
      this.advance(); // consume ':'

      // Direct text literal child: Button: "Submit"
      if (this.check("STRING")) {
        const strTok = this.advance();
        textLiteral = strTok.value;
        this.consumeStatementSeparator();
        return {
          kind: "LayoutNode",
          tag,
          attributes,
          textLiteral,
          children,
          span: mergeSpans(startSpan, strTok.span),
        };
      }

      // Direct child expression on same line: p: message or h2.title: title
      if (!this.check("NEWLINE") && !this.check("EOF") && !this.check("INDENT")) {
        childExpr = this.parseExpr();
        this.consumeStatementSeparator();
        return {
          kind: "LayoutNode",
          tag,
          attributes,
          textLiteral: null,
          childExpr,
          children,
          span: mergeSpans(startSpan, childExpr.span),
        };
      }

      // Nested indented children
      this.consumeStatementSeparator();
      if (this.check("INDENT")) {
        this.advance();
        while (!this.check("DEDENT") && !this.check("EOF")) {
          this.consumeStatementSeparator();
          if (this.check("DEDENT") || this.check("EOF")) break;

          children.push(this.parseLayoutNode(tag ?? undefined));
          this.consumeStatementSeparator();
        }
        this.consume("DEDENT");
      }
    }

    this.consumeStatementSeparator();

    return {
      kind: "LayoutNode",
      tag,
      attributes,
      textLiteral,
      children,
      span: mergeSpans(startSpan, this.current().span),
    };
  }

  // Style Declarations
  private parseStyleSelector(): string {
    const tok = this.current();
    if (tok.kind === "STRING") {
      this.advance();
      return tok.value;
    }

    const tokens: Token[] = [];
    while (
      !this.check("COLON") &&
      !this.check("NEWLINE") &&
      !this.check("DEDENT") &&
      !this.check("EOF")
    ) {
      tokens.push(this.advance());
    }

    if (tokens.length === 0) {
      throw new ParserError("Expected style name or selector", this.current().span);
    }

    if (this.source) {
      const startOffset = tokens[0].span.start.offset;
      const endOffset = tokens[tokens.length - 1].span.end.offset;
      return this.source.slice(startOffset, endOffset).trim();
    }

    return tokens.map((t) => t.value).join("");
  }

  private parseStyleDecl(): StyleDecl {
    const startSpan = this.current().span;
    this.consume("STYLE");

    const name = this.parseStyleSelector();
    this.consume("COLON", "Expected ':' before style block");
    this.consumeStatementSeparator();

    const properties: StyleProperty[] = [];
    const hasIndent = this.check("INDENT");
    if (hasIndent) {
      this.advance(); // consume INDENT
    }

    while (!this.check("EOF")) {
      if (hasIndent) {
        this.consumeStatementSeparator();
        if (this.check("DEDENT") || this.check("EOF")) {
          break;
        }
      } else {
        if (this.check("NEWLINE") || this.check("EOF")) {
          break;
        }
      }

      // Check for nested tokens block: tokens <ns>:
      if (this.check("TOKENS")) {
        this.parseTokensIntoProperties(properties);
        if (hasIndent) this.consumeStatementSeparator();
        continue;
      }

      const pSpan = this.current().span;
      const prop = this.parseCssPropertyName();

      const normalizedProp = prop
        .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
        .replace(/_/g, "-")
        .toLowerCase();
      const isMacro =
        normalizedProp === "fl-row" ||
        normalizedProp === "fl-col" ||
        normalizedProp === "fl-center";

      let val = "";
      if (this.check("COLON")) {
        this.advance();
        if (
          !this.check("SEMICOLON") &&
          !this.check("NEWLINE") &&
          !this.check("DEDENT") &&
          !this.check("EOF")
        ) {
          val = this.parseCssPropertyValue();
        }
      } else if (!isMacro) {
        this.consume("COLON", "Expected ':' after CSS property name");
      }

      properties.push({
        property: prop,
        value: val,
        span: mergeSpans(pSpan, this.current().span),
      });

      if (this.check("SEMICOLON")) {
        this.advance();
      }
      if (!hasIndent) {
        if (this.check("NEWLINE") || this.check("EOF")) {
          break;
        }
        if (
          !this.check("IDENT") &&
          !this.check("STRING") &&
          !this.check("MINUS") &&
          !this.check("TOKENS") &&
          !this.isIdentOrKeyword(this.current())
        ) {
          break;
        }
      } else {
        this.consumeStatementSeparator();
      }
    }

    let endSpan = this.current().span;
    if (hasIndent && this.check("DEDENT")) {
      endSpan = this.consume("DEDENT").span;
    }
    this.consumeStatementSeparator();

    return {
      kind: "StyleDecl",
      name,
      properties,
      span: mergeSpans(startSpan, endSpan),
    };
  }

  private parseTokensDecl(): StyleDecl {
    const startSpan = this.current().span;
    const properties: StyleProperty[] = [];
    let target = ":root";

    this.parseTokensIntoProperties(properties, (parsedTarget) => {
      if (parsedTarget) target = parsedTarget;
    });

    return {
      kind: "StyleDecl",
      name: target,
      properties,
      span: mergeSpans(startSpan, this.current().span),
    };
  }

  private parseTokensIntoProperties(
    properties: StyleProperty[],
    onTarget?: (target: string) => void,
  ): void {
    const startSpan = this.current().span;
    this.consume("TOKENS");

    // Parse namespace: e.g. color.slate, spacing, radius, z
    const nsTokens: Token[] = [];
    while (
      !this.check("COLON") &&
      !this.check("IN") &&
      !this.check("LBRACKET") &&
      !this.check("EOF") &&
      (this.isIdentOrKeyword(this.current()) || this.check("DOT") || this.check("MINUS"))
    ) {
      nsTokens.push(this.advance());
    }

    if (nsTokens.length === 0) {
      throw new ParserError("Expected token namespace", this.current().span);
    }

    const nsRaw = nsTokens.map((t) => t.value).join("");
    const nsKebab = nsRaw.replace(/\./g, "-").replace(/_/g, "-").toLowerCase();

    // Optional unit annotation on namespace: [unit] (e.g. [rem], [px])
    let defaultUnit = "";
    if (this.check("LBRACKET")) {
      this.advance(); // consume '['
      const unitTokens: Token[] = [];
      while (!this.check("RBRACKET") && !this.check("EOF")) {
        unitTokens.push(this.advance());
      }
      this.consume("RBRACKET", "Expected ']' after token unit annotation");
      defaultUnit = unitTokens.map((t) => t.value).join("");
    }

    // Optional: in <target>
    if (this.check("IN")) {
      this.advance(); // consume 'in'
      const targetName = this.parseStyleSelector();
      if (onTarget) onTarget(targetName);
    }

    if (!defaultUnit && this.check("LBRACKET")) {
      this.advance(); // consume '['
      const unitTokens: Token[] = [];
      while (!this.check("RBRACKET") && !this.check("EOF")) {
        unitTokens.push(this.advance());
      }
      this.consume("RBRACKET", "Expected ']' after token unit annotation");
      defaultUnit = unitTokens.map((t) => t.value).join("");
    }

    this.consume("COLON", "Expected ':' after token namespace");

    // Scale syntax: [0, 4, 8, 12, 16]px
    if (this.check("LBRACKET")) {
      this.advance(); // consume '['
      const values: string[] = [];
      while (!this.check("RBRACKET") && !this.check("EOF")) {
        values.push(this.advance().value);
        if (this.check("COMMA")) this.advance();
      }
      this.consume("RBRACKET", "Expected ']' after token scale");

      let unit = defaultUnit;
      if (this.check("IDENT") || this.check("PERCENT")) {
        unit = this.advance().value;
      }

      for (const val of values) {
        let finalVal = val;
        if (unit && /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(val.trim())) {
          finalVal = `${val.trim()}${unit}`;
        }
        properties.push({
          property: `--${nsKebab}-${val}`,
          value: finalVal,
          span: startSpan,
        });
      }
      this.consumeStatementSeparator();
      return;
    }

    // Key-value pairs
    this.consumeStatementSeparator();
    const hasIndent = this.check("INDENT");
    if (hasIndent) {
      this.advance(); // consume INDENT
    }

    while (!this.check("EOF")) {
      this.consumeStatementSeparator();
      if (hasIndent && this.check("DEDENT")) {
        this.advance(); // consume DEDENT
        break;
      }
      if (!hasIndent && (this.check("NEWLINE") || this.check("EOF"))) {
        break;
      }

      const kSpan = this.current().span;
      const key = this.parseCssKebabIdent();
      this.consume("COLON", "Expected ':' after token key");

      let val = this.parseTokenValue();
      if (defaultUnit && /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(val.trim())) {
        val = `${val.trim()}${defaultUnit}`;
      }

      properties.push({
        property: `--${nsKebab}-${key}`,
        value: val,
        span: mergeSpans(kSpan, this.current().span),
      });

      if (this.check("COMMA") || this.check("SEMICOLON")) {
        this.advance();
      } else if (!hasIndent) {
        break;
      }
      this.consumeStatementSeparator();
    }
  }

  private parseTokenValue(): string {
    const tokens: Token[] = [];
    let parenDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;

    while (!this.check("EOF")) {
      const tok = this.current();

      // At top-level, stop on comma, semicolon, newline, dedent, comment
      if (parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
        if (
          this.check("COMMA") ||
          this.check("SEMICOLON") ||
          this.check("NEWLINE") ||
          this.check("DEDENT") ||
          this.check("COMMENT")
        ) {
          break;
        }
      }

      if (tok.kind === "LPAREN") parenDepth++;
      else if (tok.kind === "RPAREN") parenDepth = Math.max(0, parenDepth - 1);
      else if (tok.kind === "LBRACKET") bracketDepth++;
      else if (tok.kind === "RBRACKET") bracketDepth = Math.max(0, bracketDepth - 1);
      else if (tok.kind === "LBRACE") braceDepth++;
      else if (tok.kind === "RBRACE") braceDepth = Math.max(0, braceDepth - 1);

      tokens.push(this.advance());
    }

    if (tokens.length === 0) {
      throw new ParserError("Expected token value", this.current().span);
    }

    // Single STRING literal: unquote for CSS custom property value
    if (tokens.length === 1 && tokens[0].kind === "STRING") {
      return tokens[0].value;
    }

    if (this.source) {
      const startOffset = tokens[0].span.start.offset;
      const endOffset = tokens[tokens.length - 1].span.end.offset;
      return this.source.slice(startOffset, endOffset).trim();
    }

    return tokens
      .map((t) => t.value)
      .join(" ")
      .trim();
  }

  private parseCssKebabIdent(): string {
    const startTok = this.current();
    const startOffset = startTok.span.start.offset;
    let endOffset = startTok.span.end.offset;

    if (
      !this.isIdentOrKeyword(startTok) &&
      startTok.kind !== "NUMBER" &&
      startTok.kind !== "MINUS"
    ) {
      throw new ParserError("Expected identifier or class/id name", startTok.span);
    }

    this.advance();

    while (!this.check("EOF")) {
      const nextTok = this.current();
      // Must be immediately adjacent with no whitespace
      if (nextTok.span.start.offset !== endOffset) {
        break;
      }
      if (this.isIdentOrKeyword(nextTok) || nextTok.kind === "NUMBER" || nextTok.kind === "MINUS") {
        endOffset = nextTok.span.end.offset;
        this.advance();
      } else {
        break;
      }
    }

    if (this.source) {
      return this.source.slice(startOffset, endOffset);
    }
    return startTok.value;
  }

  private parseCssPropertyName(): string {
    const tok = this.current();
    if (tok.kind === "STRING") {
      this.advance();
      return tok.value;
    }

    // Unquoted CSS property name (e.g. margin, box_sizing, --color-slate-900, -webkit-font-smoothing)
    const tokens: Token[] = [];
    while (
      !this.check("COLON") &&
      !this.check("SEMICOLON") &&
      !this.check("NEWLINE") &&
      !this.check("DEDENT") &&
      !this.check("EOF")
    ) {
      tokens.push(this.advance());
    }

    if (tokens.length === 0) {
      throw new ParserError("Expected CSS property name", this.current().span);
    }

    if (this.source) {
      const startOffset = tokens[0].span.start.offset;
      const endOffset = tokens[tokens.length - 1].span.end.offset;
      return this.source.slice(startOffset, endOffset).trim();
    }

    return tokens.map((t) => t.value).join("");
  }

  private parseCssPropertyValue(): string {
    const tokens: Token[] = [];
    let parenDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;

    while (!this.check("EOF")) {
      const tok = this.current();

      // At top-level, stop on statement delimiters
      if (parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
        if (this.check("NEWLINE")) {
          // If the last token was a comma, this is a multi-line CSS value continuation
          if (tokens.length > 0 && tokens[tokens.length - 1].kind === "COMMA") {
            this.advance(); // consume NEWLINE
            if (this.check("INDENT")) {
              this.advance();
            }
            continue;
          }
          break;
        }
        if (
          this.check("SEMICOLON") ||
          this.check("DEDENT") ||
          this.check("COMMENT")
        ) {
          break;
        }
      }

      if (tok.kind === "LPAREN") parenDepth++;
      else if (tok.kind === "RPAREN") parenDepth = Math.max(0, parenDepth - 1);
      else if (tok.kind === "LBRACKET") bracketDepth++;
      else if (tok.kind === "RBRACKET") bracketDepth = Math.max(0, bracketDepth - 1);
      else if (tok.kind === "LBRACE") braceDepth++;
      else if (tok.kind === "RBRACE") braceDepth = Math.max(0, braceDepth - 1);

      tokens.push(this.advance());
    }

    if (tokens.length === 0) {
      throw new ParserError("Expected CSS property value", this.current().span);
    }

    // Single STRING literal: preserve inner unquoted string value for compatibility
    if (tokens.length === 1 && tokens[0].kind === "STRING") {
      return tokens[0].value;
    }

    if (this.source) {
      const startOffset = tokens[0].span.start.offset;
      const endOffset = tokens[tokens.length - 1].span.end.offset;
      return this.source.slice(startOffset, endOffset).trim();
    }

    let reconstructed = "";
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (i > 0 && t.span.start.offset > tokens[i - 1].span.end.offset) {
        reconstructed += " ";
      }
      reconstructed += t.value;
    }
    return reconstructed.trim();
  }
}

/**
 * High-level parser entrypoint.
 */
export function parse(source: string, file = "<anonymous>"): Module {
  return Parser.fromSource(source, file).parse();
}

interface ProcessedComment {
  raw: string;
  item: TriviaItem;
  span: Span;
  startOffset: number;
  endOffset: number;
  startLine: number;
  endLine: number;
  isBlock: boolean;
}

interface TargetDecl {
  nodeId: string;
  span: Span;
  isMember?: boolean;
}

function convertCommentToTriviaItem(raw: string, isBlock: boolean, span: Span): TriviaItem {
  if (isBlock) {
    const isDoc = raw.startsWith("/**");
    return {
      kind: isDoc ? "DOCSTRING" : "BLOCK_COMMENT",
      content: raw,
      span,
    };
  }

  // Single-line comment (# or //)
  let content: string;
  if (raw.startsWith("//")) {
    content = raw;
  } else if (raw.startsWith("# ")) {
    content = "// " + raw.slice(2);
  } else if (raw === "#") {
    content = "//";
  } else if (raw.startsWith("#")) {
    content = "// " + raw.slice(1).trimStart();
  } else {
    content = "// " + raw;
  }

  const isLicense =
    content.includes("SPDX-License-Identifier") ||
    content.toLowerCase().includes("@license") ||
    content.toLowerCase().includes("copyright");

  return {
    kind: isLicense ? "LICENSE_HEADER" : "LINE_COMMENT",
    content,
    span,
  };
}

function isModuleHeaderComment(
  comment: ProcessedComment,
  allCommentsBeforeFirstDecl: ProcessedComment[],
  firstDecl?: TargetDecl,
): boolean {
  const text = comment.raw.trim();
  // 1. Explicit keyword match
  if (
    /^(#|\/\/|\/\*+)\s*(module|file|@file|@module|@license|spdx|copyright)\b/i.test(text) ||
    comment.item.kind === "LICENSE_HEADER"
  ) {
    return true;
  }

  // 2. If there are no declarations, all comments are module comments
  if (!firstDecl) {
    return true;
  }

  // 3. Find index of this comment in allCommentsBeforeFirstDecl
  const idx = allCommentsBeforeFirstDecl.indexOf(comment);
  if (idx === -1) return false;

  // Check if there is a blank line between this comment and a subsequent comment before firstDecl
  let hasBlankLineAfterThisBlock = false;
  for (let i = idx; i < allCommentsBeforeFirstDecl.length - 1; i++) {
    if (allCommentsBeforeFirstDecl[i + 1].startLine - allCommentsBeforeFirstDecl[i].endLine > 1) {
      hasBlankLineAfterThisBlock = true;
      break;
    }
  }

  if (hasBlankLineAfterThisBlock) {
    return true;
  }

  // If this comment is in the last comment block before firstDecl,
  // check if there is a blank line between the last comment and firstDecl
  const lastComment = allCommentsBeforeFirstDecl[allCommentsBeforeFirstDecl.length - 1];
  const hasBlankLineBeforeFirstDecl = firstDecl.span.start.line - lastComment.endLine > 1;

  if (hasBlankLineBeforeFirstDecl) {
    return true;
  }

  return false;
}

/**
 * High-level parser entrypoint with lossless CST trivia retention.
 */
export function parseWithTrivia(
  source: string,
  file = "<anonymous>",
): { ast: Module; trivia: CstTriviaTable } {
  const { rawTokens, comments } = scanRawTokens(source, file);
  const tokens = filterIndentation(rawTokens, file);
  const parser = new Parser(tokens, file, source);
  const ast = parser.parse();

  const trivia = new CstTriviaTable();
  if (comments.length === 0) {
    return { ast, trivia };
  }

  const processedComments: ProcessedComment[] = comments.map((c) => {
    const raw = source.slice(c.span.start.offset, c.span.end.offset);
    return {
      raw,
      item: convertCommentToTriviaItem(raw, c.isBlock, c.span),
      span: c.span,
      startOffset: c.span.start.offset,
      endOffset: c.span.end.offset,
      startLine: c.span.start.line,
      endLine: c.span.end.line,
      isBlock: c.isBlock,
    };
  });

  const topDecls: TargetDecl[] = [];
  const classMembers = new Map<string, TargetDecl[]>();
  const typeFields = new Map<string, TargetDecl[]>();

  for (const item of ast.items) {
    switch (item.kind) {
      case "ImportDecl":
        topDecls.push({ nodeId: `import:${item.source}`, span: item.span });
        break;
      case "TypeDecl": {
        topDecls.push({ nodeId: `type:${item.name}`, span: item.span });
        if (item.fields) {
          const fields: TargetDecl[] = [];
          for (const f of item.fields) {
            fields.push({
              nodeId: `field:${item.name}.${f.name}`,
              span: f.span,
              isMember: true,
            });
          }
          fields.sort((a, b) => a.span.start.offset - b.span.start.offset);
          typeFields.set(item.name, fields);
        }
        break;
      }
      case "FunctionDecl":
        if (item.name !== "__top_level__") {
          topDecls.push({ nodeId: `fn:${item.name}`, span: item.span });
        }
        break;
      case "ClassDecl": {
        topDecls.push({ nodeId: `class:${item.name}`, span: item.span });
        const members: TargetDecl[] = [];
        for (const p of item.properties) {
          members.push({
            nodeId: `field:${item.name}.${p.name}`,
            span: p.span,
            isMember: true,
          });
        }
        for (const m of item.methods) {
          members.push({
            nodeId: `method:${item.name}.${m.name}`,
            span: m.span,
            isMember: true,
          });
        }
        members.sort((a, b) => a.span.start.offset - b.span.start.offset);
        classMembers.set(item.name, members);
        break;
      }
      case "ConstDecl":
        topDecls.push({ nodeId: `const:${item.name}`, span: item.span });
        break;
      case "VarDecl":
        topDecls.push({ nodeId: `var:${item.name}`, span: item.span });
        break;
      case "ComponentDecl":
        topDecls.push({ nodeId: `component:${item.name}`, span: item.span });
        break;
    }
  }

  topDecls.sort((a, b) => a.span.start.offset - b.span.start.offset);

  const allDecls: TargetDecl[] = [...topDecls];
  for (const members of classMembers.values()) {
    allDecls.push(...members);
  }
  for (const fields of typeFields.values()) {
    allDecls.push(...fields);
  }

  for (const c of processedComments) {
    // 1. Check if trailing comment on any declaration
    let trailingTarget: TargetDecl | undefined;
    for (const d of allDecls) {
      if (c.startLine === d.span.end.line && c.startOffset >= d.span.end.offset) {
        if (!trailingTarget || d.span.end.offset > trailingTarget.span.end.offset) {
          trailingTarget = d;
        }
      }
    }

    if (trailingTarget) {
      trivia.addTrailingTrivia(trailingTarget.nodeId, c.item);
      continue;
    }

    // 2. Check if inside a ClassDecl
    let insideClass: (ClassDecl & { span: Span }) | undefined;
    for (const item of ast.items) {
      if (
        item.kind === "ClassDecl" &&
        c.startOffset > item.span.start.offset &&
        c.endOffset <= item.span.end.offset
      ) {
        insideClass = item;
        break;
      }
    }

    if (insideClass) {
      const members = classMembers.get(insideClass.name) ?? [];
      const nextMember = members.find((m) => m.span.start.offset > c.startOffset);
      if (nextMember) {
        trivia.addLeadingTrivia(nextMember.nodeId, c.item);
      } else {
        trivia.addTrailingTrivia(`class:${insideClass.name}`, c.item);
      }
      continue;
    }

    // 3. Check if inside a TypeDecl
    let insideType: (TypeDecl & { span: Span }) | undefined;
    for (const item of ast.items) {
      if (
        item.kind === "TypeDecl" &&
        item.fields &&
        item.fields.length > 0 &&
        c.startOffset > item.span.start.offset &&
        c.endOffset <= item.span.end.offset
      ) {
        insideType = item;
        break;
      }
    }

    if (insideType) {
      const fields = typeFields.get(insideType.name) ?? [];
      const nextField = fields.find((f) => f.span.start.offset > c.startOffset);
      if (nextField) {
        trivia.addLeadingTrivia(nextField.nodeId, c.item);
      } else {
        trivia.addTrailingTrivia(`type:${insideType.name}`, c.item);
      }
      continue;
    }

    // 4. Module-level (topDecls)
    const nextTopDecl = topDecls.find((d) => d.span.start.offset > c.startOffset);
    if (!nextTopDecl) {
      trivia.addLeadingTrivia("module", c.item);
      continue;
    }

    if (nextTopDecl === topDecls[0]) {
      const commentsBeforeFirst = processedComments.filter(
        (pc) => pc.startOffset < topDecls[0].span.start.offset,
      );
      if (isModuleHeaderComment(c, commentsBeforeFirst, topDecls[0])) {
        trivia.addLeadingTrivia("module", c.item);
      } else {
        trivia.addLeadingTrivia(topDecls[0].nodeId, c.item);
      }
      continue;
    }

    trivia.addLeadingTrivia(nextTopDecl.nodeId, c.item);
  }

  return { ast, trivia };
}
