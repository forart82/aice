/**
 * Pratt Parser & Universal AST Generator for AIL 2.0.
 *
 * Implements Top-Down Operator Precedence (Pratt) parsing for expressions
 * and Recursive Descent for module declarations, types, functions, and control flow.
 */

import type {
  ArrayLiteralExpr,
  AssignOp,
  BinaryOp,
  Block,
  ClassDecl,
  ComponentDecl,
  ConstDecl,
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
  TypeDecl,
  TypeExpr,
  VarDecl,
  WhileStmt,
} from "./ast.js";
import { tokenize } from "./lexer.js";
import { createSpan, emptySpan, mergeSpans, type Span } from "./span.js";
import type { Token, TokenKind } from "./tokens.js";

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

enum Precedence {
  LOWEST = 1,
  ASSIGN = 2, // =
  OR = 3, // or, ||
  AND = 4, // and, &&
  COALESCE = 5, // ??
  EQUALS = 6, // ==, !=
  LESSGREATER = 7, // <, >, <=, >=
  SUM = 8, // +, -
  PRODUCT = 9, // *, /, %
  PREFIX = 10, // not, -, !
  POSTFIX = 11, // ?, (, ., ?., [
}

const PRECEDENCES: Partial<Record<TokenKind, Precedence>> = {
  OR: Precedence.OR,
  PIPE_PIPE: Precedence.OR,
  AND: Precedence.AND,
  AMP_AMP: Precedence.AND,
  QUESTION_QUESTION: Precedence.COALESCE,
  EQ_EQ: Precedence.EQUALS,
  NOT_EQ: Precedence.EQUALS,
  LT: Precedence.LESSGREATER,
  LT_EQ: Precedence.LESSGREATER,
  GT: Precedence.LESSGREATER,
  GT_EQ: Precedence.LESSGREATER,
  PLUS: Precedence.SUM,
  MINUS: Precedence.SUM,
  STAR: Precedence.PRODUCT,
  SLASH: Precedence.PRODUCT,
  PERCENT: Precedence.PRODUCT,
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

  private isIdentOrKeyword(tok: Token): boolean {
    return (
      tok.kind === "IDENT" || (Boolean(tok.value) && /^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(tok.value))
    );
  }

  private isTypedDeclarationAhead(): boolean {
    if (!this.isIdentOrKeyword(this.current()) || this.peek(1).kind !== "COLON") {
      return false;
    }
    let depth = 0;
    let i = this.cursor + 2;
    while (i < this.tokens.length) {
      const k = this.tokens[i].kind;
      if (k === "EOF" || (depth === 0 && (k === "NEWLINE" || k === "SEMICOLON"))) {
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

  private parseContextualIdentOrString(msg = "Expected identifier or property key"): string {
    const tok = this.current();
    if (tok.kind === "STRING") {
      this.advance();
      return tok.value;
    }
    if (this.isIdentOrKeyword(tok)) {
      this.advance();
      return tok.value;
    }
    throw new ParserError(msg ?? `Expected identifier, got '${tok.kind}' (${tok.value})`, tok.span);
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
    if (this.check("PUB")) {
      isExported = true;
      this.advance();
    }

    if (this.check("FROM") || this.check("IMPORT")) {
      return this.parseImportDecl();
    }
    if (this.check("TYPE")) {
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
    if (isExported && (this.check("LET") || this.check("VAL"))) {
      return this.parseVarDecl(isExported);
    }
    if (this.check("VAL")) {
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
    if (this.check("FN")) {
      return this.parseFunctionDecl();
    }
    if (this.check("COMPONENT")) {
      return this.parseComponentDecl();
    }
    if (this.check("STYLE")) {
      return this.parseStyleDecl();
    }
    if (this.check("TOKENS")) {
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
  private parseImportDecl(): ImportDecl {
    const startSpan = this.current().span;
    let source = "";

    if (this.check("FROM")) {
      this.advance();
      source = this.consume("STRING", "Expected import source string").value;
      this.consume("IMPORT", "Expected 'import' keyword after from-source");
    } else {
      this.consume("IMPORT");
      source = this.consume("STRING", "Expected import source string").value;
    }

    const specifiers: ImportSpecifier[] = [];

    if (this.check("STAR")) {
      const starToken = this.advance();
      specifiers.push({
        name: "*",
        isWildcard: true,
        span: starToken.span,
      });
    } else {
      while (!this.check("NEWLINE") && !this.check("EOF") && !this.check("SEMICOLON")) {
        const idToken = this.consume("IDENT", "Expected import identifier");
        let alias: string | undefined;

        if (this.check("IDENT") && this.current().value === "as") {
          this.advance();
          alias = this.consume("IDENT", "Expected alias identifier after 'as'").value;
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

    const endSpan = this.current().span;
    this.consumeStatementSeparator();

    return {
      kind: "ImportDecl",
      source,
      specifiers,
      span: mergeSpans(startSpan, endSpan),
    };
  }

  // Type & Enum Declarations
  private parseTypeDecl(isEnum: boolean): TypeDecl {
    const startSpan = this.current().span;
    this.advance(); // consume 'type' or 'enum'

    const name = this.consume("IDENT", "Expected type name").value;
    const typeParams: string[] = [];

    if (this.check("LBRACKET")) {
      this.advance();
      while (!this.check("RBRACKET") && !this.check("EOF")) {
        typeParams.push(this.consume("IDENT", "Expected type parameter").value);
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

        while (!this.check("EOF")) {
          const vSpan = this.current().span;
          const vName = this.consume("IDENT", "Expected variant name").value;
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

      if (this.check("IDENT") && this.current().value === "pass") {
        this.advance();
        this.consumeStatementSeparator();
        continue;
      }

      while (!this.check("EOF")) {
        const fSpan = this.current().span;
        const fName = this.parseContextualIdentOrString("Expected field name");
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
      if (
        (right.kind === "NamedType" &&
          (right.name === "null" || right.name === "nil" || right.name === "undefined")) ||
        (right.kind === "PrimitiveType" && right.primitive === "nil")
      ) {
        type = {
          kind: "OptionType",
          innerType: type,
          span: mergeSpans(type.span, right.span),
        };
      } else {
        const leftName =
          type.kind === "NamedType"
            ? type.name
            : type.kind === "PrimitiveType"
              ? type.primitive
              : "any";
        const rightName =
          right.kind === "NamedType"
            ? right.name
            : right.kind === "PrimitiveType"
              ? right.primitive
              : "any";
        type = {
          kind: "NamedType",
          name: `${leftName} | ${rightName}`,
          span: mergeSpans(type.span, right.span),
        };
      }
    }

    return type;
  }

  private parseBaseTypeExpr(): TypeExpr {
    const tok = this.current();

    if (tok.kind === "READONLY") {
      this.advance();
      return this.parseBaseTypeExpr();
    }

    if (tok.kind === "STRING") {
      this.advance();
      return {
        kind: "NamedType",
        name: `"${tok.value}"`,
        span: tok.span,
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
      tok.kind === "TYPE_VOID"
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
      };
      return {
        kind: "PrimitiveType",
        primitive: primMap[tok.kind] ?? "int",
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

    // 4. Array Type: [TypeExpr]
    if (tok.kind === "LBRACKET") {
      this.advance();
      const elementType = this.parseTypeExpr();
      const endSpan = this.consume("RBRACKET").span;
      return {
        kind: "ArrayType",
        elementType,
        span: mergeSpans(tok.span, endSpan),
      };
    }

    // 5. Refinement Type or Record Type: { ... }
    if (tok.kind === "LBRACE") {
      this.advance();
      // Check if it's a refinement type { v:int | v >= 0 }
      if (this.check("IDENT") && this.peek().kind === "COLON") {
        const idToken = this.advance();
        this.advance(); // consume ':'
        const base = this.parseBaseTypeExpr();

        if (this.check("PIPE")) {
          this.advance(); // consume '|'
          const predicate = this.parseExpr();
          const endSpan = this.consume("RBRACE").span;
          if (base.kind !== "PrimitiveType") {
            throw new ParserError("Refinement base type must be a primitive", base.span);
          }
          return {
            kind: "RefinementType",
            param: idToken.value,
            baseType: base,
            predicate,
            span: mergeSpans(tok.span, endSpan),
          };
        }

        // It was a single field record: { id: int }
        const fields: { name: string; type: TypeExpr; span: Span }[] = [
          {
            name: idToken.value,
            type: base,
            span: mergeSpans(idToken.span, base.span),
          },
        ];

        while (this.check("COMMA")) {
          this.advance();
          if (this.check("RBRACE")) break;
          const fName = this.consume("IDENT").value;
          this.consume("COLON");
          const fType = this.parseTypeExpr();
          fields.push({
            name: fName,
            type: fType,
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

    // 6. Function Type: (a:int, b:str) => void or () => void
    if (tok.kind === "LPAREN") {
      this.advance(); // consume '('
      const paramTypes: string[] = [];
      while (!this.check("RPAREN") && !this.check("EOF")) {
        if (this.peek().kind === "COLON") {
          this.advance(); // consume name
          this.advance(); // consume ':'
        } else if (this.peek().kind === "QUESTION") {
          this.advance(); // consume name
          this.advance(); // consume '?'
          if (this.check("COLON")) this.advance(); // consume ':'
        }
        const pt = this.parseTypeExpr();
        const ptName =
          pt.kind === "NamedType" ? pt.name : pt.kind === "PrimitiveType" ? pt.primitive : "any";
        paramTypes.push(ptName);
        if (this.check("COMMA")) this.advance();
      }
      this.consume("RPAREN");
      if (this.check("FAT_ARROW") || this.check("ARROW")) {
        this.advance();
        const retType = this.parseTypeExpr();
        const retName =
          retType.kind === "NamedType"
            ? retType.name
            : retType.kind === "PrimitiveType"
              ? retType.primitive
              : "void";
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

    // 7. Named Type: e.g. User or Map[str, int]
    if (tok.kind === "IDENT") {
      this.advance();
      const typeArgs: TypeExpr[] = [];
      if (this.check("LBRACKET")) {
        this.advance();
        while (!this.check("RBRACKET") && !this.check("EOF")) {
          typeArgs.push(this.parseTypeExpr());
          if (this.check("COMMA")) this.advance();
        }
        this.consume("RBRACKET");
      }

      return {
        kind: "NamedType",
        name: tok.value,
        typeArgs: typeArgs.length > 0 ? typeArgs : undefined,
        span: tok.span,
      };
    }

    throw new ParserError(`Unexpected token '${tok.kind}' in type expression`, tok.span);
  }

  // Function Declarations
  private parseFunctionDecl(): FunctionDecl {
    const startSpan = this.current().span;
    this.consume("FN");

    const name = this.consume("IDENT", "Expected function name").value;
    this.consume("LPAREN", "Expected '(' after function name");

    const params: ParamDecl[] = [];
    while (!this.check("RPAREN") && !this.check("EOF")) {
      const pSpan = this.current().span;
      const pName = this.parseContextualIdentOrString("Expected parameter name");
      this.consume("COLON", "Expected ':' after parameter name");
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
        span: mergeSpans(pSpan, defaultValue ? defaultValue.span : pType.span),
      });

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

    const name = this.consume("IDENT", "Expected class name").value;
    const typeParams: string[] = [];
    if (this.check("LBRACKET")) {
      this.advance();
      while (!this.check("RBRACKET") && !this.check("EOF")) {
        typeParams.push(this.consume("IDENT", "Expected type parameter").value);
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
        const pName = this.parseContextualIdentOrString("Expected parameter name");
        this.consume("COLON", "Expected ':' after parameter name");
        const pType = this.parseTypeExpr();

        let defaultValue: Expr | undefined;
        if (this.check("EQUAL")) {
          this.advance();
          defaultValue = this.parseExpr();
        }

        primaryConstructor.push({
          name: pName,
          typeAnnotation: pType,
          defaultValue,
          isPub,
          isReadonly,
          isMut,
          span: mergeSpans(pSpan, defaultValue ? defaultValue.span : pType.span),
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
      extendsName = this.consume("IDENT", "Expected base class name after 'extends'").value;
    }

    const implementsList: string[] = [];
    if (this.check("IMPLEMENTS")) {
      this.advance();
      while (!this.check("COLON") && !this.check("EOF") && !this.check("NEWLINE")) {
        implementsList.push(this.consume("IDENT", "Expected interface name").value);
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

        if (this.check("IDENT") && this.current().value === "pass") {
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

        const isAccessor =
          this.check("IDENT") &&
          (this.current().value === "get" || this.current().value === "set") &&
          (this.isIdentOrKeyword(this.peek()) || this.peek().kind === "STRING");

        if (this.check("FN") || isAccessor) {
          const accessor = isAccessor ? (this.current().value as "get" | "set") : undefined;
          const method = this.parseMethodDecl(isStatic, isAsync, accessor);
          methods.push(method);
        } else if (
          hasPropKeyword ||
          this.check("IDENT") ||
          this.check("STRING") ||
          this.check("STATE") ||
          this.check("TYPE") ||
          this.check("VAL") ||
          this.check("MUT") ||
          this.check("FROM")
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
      (aliases ??= []).push(aliasName);
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
        (aliases ??= []).push(nextAlias);
      }
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
      (aliases ??= []).push(aliasName);
      while (this.check("COMMA")) {
        this.advance();
        const nextAlias = this.parseContextualIdentOrString("Expected property alias");
        lastSpan = this.previous().span;
        (aliases ??= []).push(nextAlias);
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
    } else {
      this.consume("FN");
    }

    const name = this.parseContextualIdentOrString("Expected method or accessor name");

    const params: ParamDecl[] = [];
    if (this.check("LPAREN")) {
      this.advance(); // consume '('
      while (!this.check("RPAREN") && !this.check("EOF")) {
        const pSpan = this.current().span;
        const pName = this.parseContextualIdentOrString("Expected parameter name");
        let pType: TypeExpr = {
          kind: "NamedType",
          name: "any",
          span: pSpan,
        };
        if (this.check("COLON")) {
          this.advance();
          pType = this.parseTypeExpr();
        }

        let defaultValue: Expr | undefined;
        if (this.check("EQUAL")) {
          this.advance();
          defaultValue = this.parseExpr();
        }

        params.push({
          name: pName,
          typeAnnotation: pType,
          defaultValue,
          span: mergeSpans(pSpan, defaultValue ? defaultValue.span : pType.span),
        });

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
      if (this.check("MUT")) {
        this.advance();
        isMut = true;
      }
      name = this.parseContextualIdentOrString("Expected variable identifier");
      if (this.check("COLON")) {
        this.advance();
        typeAnnotation = this.parseTypeExpr();
      }
      this.consume("EQUAL", "Expected '=' in variable declaration");
    } else if (this.check("VAL")) {
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

    if (this.check("LET")) {
      return this.parseLetBinding();
    }
    if (this.check("RET")) {
      return this.parseReturnStatement();
    }
    if (this.check("IF")) {
      return this.parseIfStatement();
    }
    if (this.check("MATCH")) {
      return this.parseMatchStatement();
    }
    if (this.check("FOR")) {
      return this.parseForStatement();
    }
    if (this.check("WHILE")) {
      return this.parseWhileStatement();
    }
    if (this.check("IDENT") && this.current().value === "pass") {
      this.advance();
      this.consumeStatementSeparator();
      return null;
    }

    if (this.isDestructureAhead()) {
      return this.parseDestructureOrVectorAssign();
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
      this.check("PERCENT_EQUAL")
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
    const openKind = this.current().kind;
    if (openKind !== "LBRACKET" && openKind !== "LPAREN") return false;
    const closeKind = openKind === "LBRACKET" ? "RBRACKET" : "RPAREN";

    let i = 1;
    let count = 0;
    while (true) {
      const tok = this.peek(i);
      if (!tok || tok.kind === "EOF" || tok.kind === "NEWLINE") return false;
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
    if (count < 1) return false;

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
      after.kind === "PERCENT_EQUAL"
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
    const openKind = this.advance().kind; // consume '[' or '('
    const closeKind = openKind === "LBRACKET" ? "RBRACKET" : "RPAREN";
    const names: { name: string; span: Span }[] = [];

    while (!this.check(closeKind) && !this.check("EOF")) {
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
      this.check("PERCENT_EQUAL")
    ) {
      const op = this.advance().value as AssignOp;
      const val = this.parseExpr();
      this.consumeStatementSeparator();
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
    this.consume("LET");

    let isMut = false;
    if (this.check("MUT")) {
      this.advance();
      isMut = true;
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

  private parseReturnStatement(): ReturnStmt {
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

      this.consume("FAT_ARROW", "Expected '=>' after match pattern");

      let body: Block | Expr;
      if (this.check("NEWLINE")) {
        this.consumeStatementSeparator();
        body = this.parseBlock();
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

    if (tok.kind === "IDENT") {
      this.advance();
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
          name: tok.value,
          subPatterns,
          span: mergeSpans(tok.span, endSpan),
        };
      }

      return { kind: "IdentifierPattern", name: tok.value, span: tok.span };
    }

    throw new ParserError(`Unexpected pattern token '${tok.kind}'`, tok.span);
  }

  private parseForStatement(): ForStmt {
    const startSpan = this.current().span;
    this.consume("FOR");

    let variable: string;
    if (this.check("LBRACKET")) {
      this.advance(); // consume '['
      const elements: string[] = [];
      while (!this.check("RBRACKET") && !this.check("EOF")) {
        elements.push(this.parseContextualIdentOrString("Expected variable name"));
        if (this.check("COMMA")) this.advance();
      }
      this.consume("RBRACKET");
      variable = `[${elements.join(", ")}]`;
    } else {
      variable = this.consume("IDENT", "Expected loop variable name").value;
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

  // Pratt Expression Parsing
  parseExpr(precedence = Precedence.LOWEST): Expr {
    let left = this.parsePrefix();

    while (precedence < this.currentPrecedence()) {
      left = this.parseInfix(left);
    }

    return left;
  }

  private currentPrecedence(): Precedence {
    return PRECEDENCES[this.current().kind] ?? Precedence.LOWEST;
  }

  private parsePrefix(): Expr {
    const tok = this.current();

    // 1. Literal Expressions
    if (tok.kind === "NUMBER") {
      this.advance();
      const val = tok.value.includes(".")
        ? Number.parseFloat(tok.value)
        : Number.parseInt(tok.value, 10);
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

    if (
      tok.kind === "IDENT" ||
      tok.kind === "TYPE" ||
      tok.kind === "FROM" ||
      tok.kind === "STATE" ||
      tok.kind === "MUT" ||
      tok.kind === "VAL" ||
      tok.kind === "TYPE_INT" ||
      tok.kind === "TYPE_STR" ||
      tok.kind === "TYPE_FLOAT" ||
      tok.kind === "TYPE_BOOL" ||
      tok.kind === "TYPE_NUM" ||
      tok.kind === "TYPE_BYTE" ||
      tok.kind === "TYPE_CHAR" ||
      tok.kind === "TYPE_VOID"
    ) {
      this.advance();
      return {
        kind: "IdentifierExpr",
        name: tok.value,
        span: tok.span,
      };
    }

    // 3. Unary Operators (-, not, !)
    if (tok.kind === "MINUS" || tok.kind === "NOT" || tok.kind === "BANG") {
      this.advance();
      const op = tok.kind === "MINUS" ? "-" : tok.kind === "BANG" ? "!" : "not";
      const operand = this.parseExpr(Precedence.PREFIX);
      return {
        kind: "UnaryExpr",
        operator: op,
        operand,
        span: mergeSpans(tok.span, operand.span),
      };
    }

    // 4. Grouped Expression: ( expr )
    if (tok.kind === "LPAREN") {
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
        if (this.check("ELLIPSIS")) {
          const spreadTok = this.advance();
          const target = this.parseExpr();
          elements.push({
            kind: "UnaryExpr",
            operator: "...",
            operand: target,
            span: mergeSpans(spreadTok.span, target.span),
          });
        } else {
          elements.push(this.parseExpr());
        }
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
          if (this.check("COMMA")) this.advance();
          continue;
        }

        const kSpan = this.current().span;
        const key = this.parseContextualIdentOrString("Expected property key in record literal");
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
        if (this.check("COMMA")) this.advance();
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
      this.advance();
      this.consume("LPAREN");
      const params: ParamDecl[] = [];
      while (!this.check("RPAREN") && !this.check("EOF")) {
        const pSpan = this.current().span;
        const pName = this.parseContextualIdentOrString("Expected parameter name");
        this.consume("COLON");
        const pType = this.parseTypeExpr();
        params.push({
          name: pName,
          typeAnnotation: pType,
          span: mergeSpans(pSpan, pType.span),
        });
        if (this.check("COMMA")) this.advance();
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
          params,
          returnType,
          body,
          span: mergeSpans(tok.span, body.span),
        };
      }

      if (!this.check("COLON") && !this.check("LBRACE")) {
        return {
          kind: "ClosureExpr",
          params,
          returnType,
          body: {
            kind: "Block",
            statements: [],
            span: tok.span,
          },
          span: mergeSpans(tok.span, this.previous().span),
        };
      }

      if (this.check("COLON")) {
        this.advance();
        this.consumeStatementSeparator();
      }
      const body = this.parseBlock();
      return {
        kind: "ClosureExpr",
        params,
        returnType,
        body,
        span: mergeSpans(tok.span, body.span),
      };
    }

    throw new ParserError(`Unexpected expression token '${tok.kind}' (${tok.value})`, tok.span);
  }

  private parseInfix(left: Expr): Expr {
    const tok = this.current();

    // 1. Postfix ? operator (Try unwrap Result/Option)
    if (tok.kind === "QUESTION") {
      this.advance();
      return {
        kind: "PostfixTryExpr",
        operand: left,
        span: mergeSpans(left.span, tok.span),
      };
    }

    // 2. Function Call: expr(arg1, arg2)
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
      tok.kind === "PERCENT_EQUAL"
    ) {
      const op = this.advance().value as AssignOp;
      const value = this.parseExpr(Precedence.ASSIGN);
      return {
        kind: "AssignExpr",
        target: left,
        op,
        value,
        span: mergeSpans(left.span, value.span),
      };
    }

    // 6. Binary Operations: +, -, *, /, ==, !=, and, or, ??
    const prec = this.currentPrecedence();
    this.advance();

    const opMap: Partial<Record<TokenKind, BinaryOp>> = {
      PLUS: "+",
      MINUS: "-",
      STAR: "*",
      SLASH: "/",
      PERCENT: "%",
      EQ_EQ: "==",
      NOT_EQ: "!=",
      LT: "<",
      LT_EQ: "<=",
      GT: ">",
      GT_EQ: ">=",
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

    const right = this.parseExpr(prec);
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

  // Declarative UI Component DSL Parsing
  private parseComponentDecl(): ComponentDecl {
    const startSpan = this.current().span;
    this.consume("COMPONENT");

    const name = this.consume("IDENT", "Expected component name").value;
    const params: ParamDecl[] = [];

    if (this.check("LPAREN")) {
      this.advance();
      while (!this.check("RPAREN") && !this.check("EOF")) {
        const pSpan = this.current().span;
        const pName = this.parseContextualIdentOrString("Expected parameter name");
        this.consume("COLON");
        const pType = this.parseTypeExpr();

        params.push({
          name: pName,
          typeAnnotation: pType,
          span: mergeSpans(pSpan, pType.span),
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
        const aName = this.parseContextualIdentOrString("Expected attribute name");
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
        if (
          this.check("NEWLINE") ||
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
