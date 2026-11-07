/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Idiomatic Rust 2021 Decompiler (Reverse Transpiler) for AICE 2.0.
 * Conforms to Pillar 2 & 4 of AICE 2.0 Universal Bidirectional Parity.
 */

import type {
  ArrayLiteralExpr,
  AssignOp,
  AssignStmt,
  BinaryExpr,
  BinaryOp,
  Block,
  CallExpr,
  ClassDecl,
  ConstDecl,
  Expr,
  ExprStmt,
  FieldDecl,
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
  PostfixTryExpr,
  PropertyDecl,
  RecordLiteralExpr,
  ReturnStmt,
  Statement,
  TemplateLiteralExpr,
  TypeDecl,
  TypeExpr,
  UnaryExpr,
  VarDecl,
  WhileStmt,
} from "../core/ast.js";
import { emptySpan, type Span } from "../core/span.js";
import { CstTriviaTable, type TriviaItem } from "../core/trivia.js";
import { AiceGenerator, type AiceGeneratorOptions } from "./aice-generator.js";

export type RustTokenKind =
  | "EOF"
  | "IDENTIFIER"
  | "NUMBER"
  | "STRING"
  | "COMMENT"
  | "PUB"
  | "FN"
  | "STRUCT"
  | "ENUM"
  | "IMPL"
  | "TYPE"
  | "LET"
  | "MUT"
  | "CONST"
  | "STATIC"
  | "IF"
  | "ELSE"
  | "MATCH"
  | "FOR"
  | "IN"
  | "WHILE"
  | "LOOP"
  | "RETURN"
  | "BREAK"
  | "CONTINUE"
  | "USE"
  | "AS"
  | "ASYNC"
  | "LPAREN"
  | "RPAREN"
  | "LBRACE"
  | "RBRACE"
  | "LBRACKET"
  | "RBRACKET"
  | "COMMA"
  | "COLON"
  | "DOUBLE_COLON" // ::
  | "SEMICOLON"
  | "DOT"
  | "DOT_DOT" // ..
  | "ARROW" // ->
  | "FAT_ARROW" // =>
  | "ASSIGN" // =
  | "PLUS_ASSIGN"
  | "MINUS_ASSIGN"
  | "STAR_ASSIGN"
  | "SLASH_ASSIGN"
  | "EQ"
  | "NEQ"
  | "LT"
  | "LTE"
  | "GT"
  | "GTE"
  | "AND"
  | "OR"
  | "PLUS"
  | "MINUS"
  | "STAR"
  | "SLASH"
  | "PERCENT"
  | "AMP"
  | "PIPE"
  | "CARET"
  | "BANG"
  | "QUESTION"
  | "UNDERSCORE"
  | "HASH"; // #

export interface RustToken {
  kind: RustTokenKind;
  value: string;
  line: number;
  col: number;
}

export class RustLexer {
  private src: string;
  private pos = 0;
  private line = 1;
  private col = 1;

  constructor(source: string) {
    this.src = source;
  }

  tokenize(): RustToken[] {
    const tokens: RustToken[] = [];
    while (this.pos < this.src.length) {
      const ch = this.src[this.pos];

      // Whitespace
      if (ch === " " || ch === "\t" || ch === "\r") {
        this.advance();
        continue;
      }

      if (ch === "\n") {
        this.advance();
        continue;
      }

      // Comments
      if (ch === "/" && this.peek(1) === "/") {
        const startLine = this.line;
        const startCol = this.col;
        let comment = "";
        while (this.pos < this.src.length && this.src[this.pos] !== "\n") {
          comment += this.advance();
        }
        tokens.push({ kind: "COMMENT", value: comment, line: startLine, col: startCol });
        continue;
      }

      if (ch === "/" && this.peek(1) === "*") {
        const startLine = this.line;
        const startCol = this.col;
        let comment = this.advance() + this.advance();
        while (this.pos < this.src.length) {
          if (this.src[this.pos] === "*" && this.peek(1) === "/") {
            comment += this.advance() + this.advance();
            break;
          }
          comment += this.advance();
        }
        tokens.push({ kind: "COMMENT", value: comment, line: startLine, col: startCol });
        continue;
      }

      // Raw identifier: r#ident
      if (ch === "r" && this.peek(1) === "#" && /[a-zA-Z_]/.test(this.peek(2))) {
        const startLine = this.line;
        const startCol = this.col;
        this.advance(); // consume r
        this.advance(); // consume #
        let id = "";
        while (this.pos < this.src.length && /[a-zA-Z0-9_]/.test(this.src[this.pos])) {
          id += this.advance();
        }
        tokens.push({ kind: "IDENTIFIER", value: id, line: startLine, col: startCol });
        continue;
      }

      // Strings (standard or raw r#"..."#)
      let isRawString = false;
      if (ch === "r") {
        let k = 1;
        while (this.peek(k) === "#") k++;
        if (this.peek(k) === '"') isRawString = true;
      }
      if (ch === '"' || isRawString) {
        const startLine = this.line;
        const startCol = this.col;
        let isRaw = false;
        let hashes = 0;
        if (ch === "r") {
          this.advance(); // consume r
          isRaw = true;
          while (this.pos < this.src.length && this.src[this.pos] === "#") {
            hashes++;
            this.advance();
          }
        }
        if (this.pos < this.src.length && this.src[this.pos] === '"') {
          this.advance(); // consume "
        }

        let str = "";
        if (isRaw) {
          const closing = '"' + "#".repeat(hashes);
          while (this.pos < this.src.length) {
            if (this.src.startsWith(closing, this.pos)) {
              for (let i = 0; i < closing.length; i++) this.advance();
              break;
            }
            str += this.advance();
          }
        } else {
          while (this.pos < this.src.length && this.src[this.pos] !== '"') {
            if (this.src[this.pos] === "\\" && this.pos + 1 < this.src.length) {
              this.advance();
              const esc = this.advance();
              if (esc === "n") str += "\n";
              else if (esc === "t") str += "\t";
              else if (esc === "r") str += "\r";
              else if (esc === '"') str += '"';
              else if (esc === "\\") str += "\\";
              else str += esc;
            } else {
              str += this.advance();
            }
          }
          if (this.pos < this.src.length && this.src[this.pos] === '"') {
            this.advance();
          }
        }
        tokens.push({ kind: "STRING", value: str, line: startLine, col: startCol });
        continue;
      }

      // Char literal
      if (ch === "'" && this.peek(2) === "'") {
        const startLine = this.line;
        const startCol = this.col;
        this.advance();
        const c = this.advance();
        this.advance();
        tokens.push({ kind: "STRING", value: c, line: startLine, col: startCol });
        continue;
      }

      // Numbers
      if (/[0-9]/.test(ch)) {
        const startLine = this.line;
        const startCol = this.col;
        let num = "";
        const isHex = ch === "0" && (this.peek(1) === "x" || this.peek(1) === "X");
        let hasDot = false;
        while (this.pos < this.src.length) {
          const curr = this.src[this.pos];
          const prev = num.length > 0 ? num[num.length - 1] : "";
          if (curr === "_") {
            num += this.advance();
            continue;
          }
          if (curr === ".") {
            if (!hasDot && !isHex && /[0-9]/.test(this.peek(1))) {
              hasDot = true;
              num += this.advance();
              continue;
            }
            break;
          }
          if (curr === "+" || curr === "-") {
            if (!isHex && (prev === "e" || prev === "E")) {
              num += this.advance();
              continue;
            }
            break;
          }
          if (isHex) {
            if (num.length === 1 && (curr === "x" || curr === "X")) {
              num += this.advance();
              continue;
            }
            if (/[0-9a-fA-F]/.test(curr)) {
              num += this.advance();
              continue;
            }
            break;
          }
          if (/[0-9]/.test(curr)) {
            num += this.advance();
            continue;
          }
          if ((curr === "e" || curr === "E") && (/[0-9]/.test(prev) || prev === ".")) {
            num += this.advance();
            continue;
          }
          if (num.length === 1 && (curr === "o" || curr === "O" || curr === "b" || curr === "B")) {
            num += this.advance();
            continue;
          }
          break;
        }

        // Check and strip valid Rust numeric type suffix from input stream
        const suffixMatch = this.src.slice(this.pos).match(/^(?:i8|i16|i32|i64|i128|isize|u8|u16|u32|u64|u128|usize|f32|f64)(?![a-zA-Z0-9_])/);
        if (suffixMatch) {
          for (let s = 0; s < suffixMatch[0].length; s++) {
            this.advance();
          }
        }
        num = num.replace(/(?:i8|i16|i32|i64|i128|isize|u8|u16|u32|u64|u128|usize|f32|f64)$/, "");

        tokens.push({ kind: "NUMBER", value: num, line: startLine, col: startCol });
        continue;
      }

      // Identifiers and Keywords
      if (/[a-zA-Z_]/.test(ch)) {
        const startLine = this.line;
        const startCol = this.col;
        let id = "";
        while (this.pos < this.src.length && /[a-zA-Z0-9_]/.test(this.src[this.pos])) {
          id += this.advance();
        }
        if (id === "_") {
          tokens.push({ kind: "UNDERSCORE", value: "_", line: startLine, col: startCol });
        } else {
          const kwKind = this.keywordKind(id);
          tokens.push({ kind: kwKind, value: id, line: startLine, col: startCol });
        }
        continue;
      }

      // Operators and Delimiters
      const startLine = this.line;
      const startCol = this.col;
      const two = this.src.slice(this.pos, this.pos + 2);

      if (two === "::") {
        this.advance();
        this.advance();
        tokens.push({ kind: "DOUBLE_COLON", value: "::", line: startLine, col: startCol });
        continue;
      }
      if (two === "->") {
        this.advance();
        this.advance();
        tokens.push({ kind: "ARROW", value: "->", line: startLine, col: startCol });
        continue;
      }
      if (two === "=>") {
        this.advance();
        this.advance();
        tokens.push({ kind: "FAT_ARROW", value: "=>", line: startLine, col: startCol });
        continue;
      }
      if (two === "..") {
        this.advance();
        this.advance();
        tokens.push({ kind: "DOT_DOT", value: "..", line: startLine, col: startCol });
        continue;
      }
      if (two === "==") {
        this.advance();
        this.advance();
        tokens.push({ kind: "EQ", value: "==", line: startLine, col: startCol });
        continue;
      }
      if (two === "!=") {
        this.advance();
        this.advance();
        tokens.push({ kind: "NEQ", value: "!=", line: startLine, col: startCol });
        continue;
      }
      if (two === "<=") {
        this.advance();
        this.advance();
        tokens.push({ kind: "LTE", value: "<=", line: startLine, col: startCol });
        continue;
      }
      if (two === ">=") {
        this.advance();
        this.advance();
        tokens.push({ kind: "GTE", value: ">=", line: startLine, col: startCol });
        continue;
      }
      if (two === "&&") {
        this.advance();
        this.advance();
        tokens.push({ kind: "AND", value: "&&", line: startLine, col: startCol });
        continue;
      }
      if (two === "||") {
        this.advance();
        this.advance();
        tokens.push({ kind: "OR", value: "||", line: startLine, col: startCol });
        continue;
      }
      if (two === "+=") {
        this.advance();
        this.advance();
        tokens.push({ kind: "PLUS_ASSIGN", value: "+=", line: startLine, col: startCol });
        continue;
      }
      if (two === "-=") {
        this.advance();
        this.advance();
        tokens.push({ kind: "MINUS_ASSIGN", value: "-=", line: startLine, col: startCol });
        continue;
      }
      if (two === "*=") {
        this.advance();
        this.advance();
        tokens.push({ kind: "STAR_ASSIGN", value: "*=", line: startLine, col: startCol });
        continue;
      }
      if (two === "/=") {
        this.advance();
        this.advance();
        tokens.push({ kind: "SLASH_ASSIGN", value: "/=", line: startLine, col: startCol });
        continue;
      }

      this.advance();
      switch (ch) {
        case "(":
          tokens.push({ kind: "LPAREN", value: "(", line: startLine, col: startCol });
          break;
        case ")":
          tokens.push({ kind: "RPAREN", value: ")", line: startLine, col: startCol });
          break;
        case "{":
          tokens.push({ kind: "LBRACE", value: "{", line: startLine, col: startCol });
          break;
        case "}":
          tokens.push({ kind: "RBRACE", value: "}", line: startLine, col: startCol });
          break;
        case "[":
          tokens.push({ kind: "LBRACKET", value: "[", line: startLine, col: startCol });
          break;
        case "]":
          tokens.push({ kind: "RBRACKET", value: "]", line: startLine, col: startCol });
          break;
        case ",":
          tokens.push({ kind: "COMMA", value: ",", line: startLine, col: startCol });
          break;
        case ":":
          tokens.push({ kind: "COLON", value: ":", line: startLine, col: startCol });
          break;
        case ";":
          tokens.push({ kind: "SEMICOLON", value: ";", line: startLine, col: startCol });
          break;
        case ".":
          tokens.push({ kind: "DOT", value: ".", line: startLine, col: startCol });
          break;
        case "=":
          tokens.push({ kind: "ASSIGN", value: "=", line: startLine, col: startCol });
          break;
        case "+":
          tokens.push({ kind: "PLUS", value: "+", line: startLine, col: startCol });
          break;
        case "-":
          tokens.push({ kind: "MINUS", value: "-", line: startLine, col: startCol });
          break;
        case "*":
          tokens.push({ kind: "STAR", value: "*", line: startLine, col: startCol });
          break;
        case "/":
          tokens.push({ kind: "SLASH", value: "/", line: startLine, col: startCol });
          break;
        case "%":
          tokens.push({ kind: "PERCENT", value: "%", line: startLine, col: startCol });
          break;
        case "&":
          tokens.push({ kind: "AMP", value: "&", line: startLine, col: startCol });
          break;
        case "|":
          tokens.push({ kind: "PIPE", value: "|", line: startLine, col: startCol });
          break;
        case "^":
          tokens.push({ kind: "CARET", value: "^", line: startLine, col: startCol });
          break;
        case "!":
          tokens.push({ kind: "BANG", value: "!", line: startLine, col: startCol });
          break;
        case "?":
          tokens.push({ kind: "QUESTION", value: "?", line: startLine, col: startCol });
          break;
        case "<":
          tokens.push({ kind: "LT", value: "<", line: startLine, col: startCol });
          break;
        case ">":
          tokens.push({ kind: "GT", value: ">", line: startLine, col: startCol });
          break;
        case "#":
          tokens.push({ kind: "HASH", value: "#", line: startLine, col: startCol });
          break;
        default:
          break;
      }
    }

    tokens.push({ kind: "EOF", value: "", line: this.line, col: this.col });
    return tokens;
  }

  private advance(): string {
    const ch = this.src[this.pos++];
    if (ch === "\n") {
      this.line++;
      this.col = 1;
    } else {
      this.col++;
    }
    return ch;
  }

  private peek(offset = 0): string {
    const idx = this.pos + offset;
    return idx < this.src.length ? this.src[idx] : "";
  }

  private keywordKind(id: string): RustTokenKind {
    switch (id) {
      case "pub":
        return "PUB";
      case "fn":
        return "FN";
      case "struct":
        return "STRUCT";
      case "enum":
        return "ENUM";
      case "impl":
        return "IMPL";
      case "type":
        return "TYPE";
      case "let":
        return "LET";
      case "mut":
        return "MUT";
      case "const":
        return "CONST";
      case "static":
        return "STATIC";
      case "if":
        return "IF";
      case "else":
        return "ELSE";
      case "match":
        return "MATCH";
      case "for":
        return "FOR";
      case "in":
        return "IN";
      case "while":
        return "WHILE";
      case "loop":
        return "LOOP";
      case "return":
        return "RETURN";
      case "break":
        return "BREAK";
      case "continue":
        return "CONTINUE";
      case "use":
        return "USE";
      case "as":
        return "AS";
      case "async":
        return "ASYNC";
      default:
        return "IDENTIFIER";
    }
  }
}

export class RustDecompiler {
  private source: string;
  private filePath: string;
  private tokens: RustToken[] = [];
  private cur = 0;
  private trivia: CstTriviaTable;
  private pendingTrivia: TriviaItem[] = [];
  private inControlHeader = false;

  constructor(source: string, filePath = "source.rs") {
    this.source = source;
    this.filePath = filePath;
    this.trivia = new CstTriviaTable();
  }

  decompile(): { ast: Module; trivia: CstTriviaTable } {
    const lexer = new RustLexer(this.source);
    this.tokens = lexer.tokenize();
    this.cur = 0;
    this.pendingTrivia = [];

    const items: ModuleItem[] = [];

    // Structs and their impl methods
    const structs = new Map<
      string,
      {
        name: string;
        fields: FieldDecl[];
        isExported: boolean;
        trivia: TriviaItem[];
      }
    >();
    const implMethods = new Map<string, MethodDecl[]>();
    const implCtors = new Map<string, ParamDecl[]>();

    while (!this.isAtEnd()) {
      this.collectLeadingTrivia();

      // Skip inner/outer attributes: #![allow(...)] or #[derive(...)]
      if (this.check("HASH")) {
        this.skipAttribute();
        continue;
      }

      // Visibility modifier 'pub'
      let isExported = false;
      if (this.check("PUB")) {
        this.advance();
        isExported = true;
        // pub(crate) etc.
        if (this.check("LPAREN")) {
          this.advance();
          while (!this.check("RPAREN") && !this.isAtEnd()) this.advance();
          this.match("RPAREN");
        }
      }

      if (this.check("USE")) {
        this.parseUse(items);
        continue;
      }

      if (this.check("TYPE")) {
        this.parseTypeAlias(items, isExported);
        continue;
      }

      if (this.check("ENUM")) {
        this.parseEnum(items, isExported);
        continue;
      }

      if (this.check("STRUCT")) {
        this.parseStruct(structs, isExported);
        continue;
      }

      if (this.check("IMPL")) {
        this.parseImpl(implMethods, implCtors);
        continue;
      }

      if (this.check("CONST") || this.check("STATIC")) {
        this.parseConstOrStatic(items, isExported);
        continue;
      }

      if (this.check("ASYNC") || this.check("FN")) {
        this.parseFn(items, isExported);
        continue;
      }

      // Unrecognized top-level token, skip
      this.advance();
    }

    // Assemble structs into ClassDecl (if receiver methods exist) or TypeDecl (if plain record/DTO)
    for (const [name, structInfo] of structs) {
      const methods = implMethods.get(name) ?? [];
      const ctorParams = implCtors.get(name);

      if (methods.length > 0) {
        // Struct has methods -> ClassDecl
        const primaryConstructor =
          ctorParams ??
          structInfo.fields.map((f) => ({
            name: f.name,
            typeAnnotation: f.typeAnnotation,
            span: emptySpan(),
          }));

        const classDecl: ClassDecl = {
          kind: "ClassDecl",
          name,
          isExported: structInfo.isExported,
          typeParams: [],
          primaryConstructor,
          properties: structInfo.fields.map((f) => ({
            kind: "PropertyDecl",
            name: f.name,
            isStatic: false,
            isReadonly: false,
            typeAnnotation: f.typeAnnotation,
            span: emptySpan(),
          })),
          methods,
          span: emptySpan(),
        };

        const nodeId = `class:${name}`;
        for (const t of structInfo.trivia) {
          this.trivia.addLeadingTrivia(nodeId, t);
        }
        items.push(classDecl);
      } else {
        // Plain struct -> TypeDecl
        const typeDecl: TypeDecl = {
          kind: "TypeDecl",
          isEnum: false,
          name,
          typeParams: [],
          fields: structInfo.fields,
          span: emptySpan(),
        };

        const nodeId = `type:${name}`;
        for (const t of structInfo.trivia) {
          this.trivia.addLeadingTrivia(nodeId, t);
        }
        items.push(typeDecl);
      }
    }

    const baseName =
      this.filePath
        .split(/[/\\]/)
        .pop()
        ?.replace(/\.rs(\.aice)?$/, "")
        .replace(/\.aice$/, "") || "main";

    const ast: Module = {
      kind: "Module",
      items,
      path: baseName,
      span: emptySpan(),
    };

    return { ast, trivia: this.trivia };
  }

  private collectLeadingTrivia(): TriviaItem[] {
    const list: TriviaItem[] = [];
    while (this.check("COMMENT")) {
      const t = this.advance();
      if (t.value.includes("generated by AICE")) continue;
      const isBlock = t.value.startsWith("/*");
      list.push({
        kind: isBlock ? "BLOCK_COMMENT" : "LINE_COMMENT",
        content: t.value,
      });
    }
    this.pendingTrivia.push(...list);
    return list;
  }

  private skipAttribute(): void {
    this.advance(); // consume #
    if (this.match("BANG")) {
      // inner attribute #![...]
    }
    if (this.check("LBRACKET")) {
      this.advance();
      let depth = 1;
      while (depth > 0 && !this.isAtEnd()) {
        if (this.check("LBRACKET")) depth++;
        else if (this.check("RBRACKET")) depth--;
        this.advance();
      }
    }
  }

  private parseUse(items: ModuleItem[]): void {
    this.advance(); // consume 'use'
    let path = "";
    while (!this.check("SEMICOLON") && !this.isAtEnd()) {
      path += this.advance().value;
    }
    this.match("SEMICOLON");

    // Skip standard library / serde boilerplate
    if (
      path.includes("std::collections::HashMap") ||
      path.includes("serde::") ||
      path.includes("std::cmp")
    ) {
      return;
    }

    const imp: ImportDecl = {
      kind: "ImportDecl",
      source: path.replace(/::/g, "/"),
      specifiers: [
        {
          name: path.split("::").pop() ?? path,
          isWildcard: path.endsWith("*"),
          isDefault: true,
          span: emptySpan(),
        },
      ],
      span: emptySpan(),
    };
    items.push(imp);
  }

  private parseTypeAlias(items: ModuleItem[], isExported: boolean): void {
    const trivia = [...this.pendingTrivia];
    this.pendingTrivia = [];
    this.advance(); // consume 'type'

    const name = this.consume("IDENTIFIER", "Expected type alias name").value;
    this.consume("ASSIGN", "Expected '=' in type alias");
    const aliasType = this.parseTypeExpr();
    this.consume("SEMICOLON", "Expected ';' after type alias");

    const decl: TypeDecl = {
      kind: "TypeDecl",
      isEnum: false,
      name,
      typeParams: [],
      aliasType,
      span: emptySpan(),
    };
    const nodeId = `type:${name}`;
    for (const t of trivia) this.trivia.addLeadingTrivia(nodeId, t);
    items.push(decl);
  }

  private parseEnum(items: ModuleItem[], isExported: boolean): void {
    const trivia = [...this.pendingTrivia];
    this.pendingTrivia = [];
    this.advance(); // consume 'enum'

    const name = this.consume("IDENTIFIER", "Expected enum name").value;
    this.consume("LBRACE", "Expected '{' to start enum variants");
    const variants: { name: string; payloadTypes?: TypeExpr[]; span: Span }[] = [];

    while (!this.check("RBRACE") && !this.isAtEnd()) {
      this.collectLeadingTrivia();
      if (this.check("RBRACE")) break;

      const vName = this.consume("IDENTIFIER", "Expected enum variant name").value;
      let payloadTypes: TypeExpr[] | undefined;

      // Tuple variant: Variant(Type1, Type2)
      if (this.check("LPAREN")) {
        this.advance();
        payloadTypes = [];
        while (!this.check("RPAREN") && !this.isAtEnd()) {
          payloadTypes.push(this.parseTypeExpr());
          if (!this.match("COMMA")) break;
        }
        this.consume("RPAREN", "Expected ')' closing variant payloads");
      }

      variants.push({ name: vName, payloadTypes, span: emptySpan() });
      this.match("COMMA");
    }

    this.consume("RBRACE", "Expected '}' closing enum");

    const decl: TypeDecl = {
      kind: "TypeDecl",
      isEnum: true,
      name,
      typeParams: [],
      variants,
      span: emptySpan(),
    };
    const nodeId = `type:${name}`;
    for (const t of trivia) this.trivia.addLeadingTrivia(nodeId, t);
    items.push(decl);
  }

  private parseStruct(
    structs: Map<
      string,
      {
        name: string;
        fields: FieldDecl[];
        isExported: boolean;
        trivia: TriviaItem[];
      }
    >,
    isExported: boolean,
  ): void {
    const trivia = [...this.pendingTrivia];
    this.pendingTrivia = [];
    this.advance(); // consume 'struct'

    const name = this.consume("IDENTIFIER", "Expected struct name").value;
    this.consume("LBRACE", "Expected '{' after struct name");
    const fields: FieldDecl[] = [];

    while (!this.check("RBRACE") && !this.isAtEnd()) {
      this.collectLeadingTrivia();
      if (this.check("RBRACE")) break;

      if (this.match("PUB")) {
        // field visibility
      }

      const fieldName = this.consume("IDENTIFIER", "Expected field name").value;
      this.consume("COLON", "Expected ':' after field name");
      const fieldType = this.parseTypeExpr();

      fields.push({
        name: this.toAiceFieldName(fieldName),
        typeAnnotation: fieldType,
        span: emptySpan(),
      });
      this.match("COMMA");
    }

    this.consume("RBRACE", "Expected '}' closing struct");
    structs.set(name, { name, fields, isExported, trivia });
  }

  private parseImpl(
    implMethods: Map<string, MethodDecl[]>,
    implCtors: Map<string, ParamDecl[]>,
  ): void {
    this.advance(); // consume 'impl'
    const structName = this.consume("IDENTIFIER", "Expected struct name for impl").value;
    this.consume("LBRACE", "Expected '{' to start impl block");

    while (!this.check("RBRACE") && !this.isAtEnd()) {
      this.collectLeadingTrivia();
      if (this.check("RBRACE")) break;

      if (this.match("PUB")) {
        // method visibility
      }

      if (this.check("FN")) {
        this.advance(); // consume 'fn'
        const fnName = this.consume("IDENTIFIER", "Expected function name").value;

        this.consume("LPAREN", "Expected '(' for method parameters");
        let isStatic = true;
        const params: ParamDecl[] = [];

        while (!this.check("RPAREN") && !this.isAtEnd()) {
          // Check for self, &self, &mut self
          if (this.check("AMP")) {
            this.advance();
            if (this.match("MUT")) {
              // &mut self
            }
            if (this.check("IDENTIFIER") && this.peek().value === "self") {
              this.advance();
              isStatic = false;
              if (this.match("COMMA")) continue;
              break;
            }
          } else if (this.check("IDENTIFIER") && this.peek().value === "self") {
            this.advance();
            isStatic = false;
            if (this.match("COMMA")) continue;
            break;
          }

          if (this.match("MUT")) {
            // mut param
          }

          const pName = this.consume("IDENTIFIER", "Expected parameter name").value;
          this.consume("COLON", "Expected ':' after parameter name");
          const pType = this.parseTypeExpr();
          params.push({
            name: this.toAiceFieldName(pName),
            typeAnnotation: pType,
            span: emptySpan(),
          });
          if (!this.match("COMMA")) break;
        }
        this.consume("RPAREN", "Expected ')' closing parameters");

        let returnType: TypeExpr | null = null;
        if (this.match("ARROW")) {
          returnType = this.parseTypeExpr();
        }

        const body = this.parseBlock();

        if (fnName === "new") {
          implCtors.set(structName, params);
        } else {
          let list = implMethods.get(structName);
          if (!list) {
            list = [];
            implMethods.set(structName, list);
          }
          list.push({
            kind: "MethodDecl",
            name: this.toAiceMethodName(fnName),
            isStatic,
            isAsync: false,
            params,
            returnType,
            body,
            isExpressionBodied: false,
            span: emptySpan(),
          });
        }
      } else {
        this.advance();
      }
    }

    this.consume("RBRACE", "Expected '}' closing impl block");
  }

  private parseConstOrStatic(items: ModuleItem[], isExported: boolean): void {
    const trivia = [...this.pendingTrivia];
    this.pendingTrivia = [];
    const isMut = this.check("STATIC") && this.peek(1).kind === "MUT";
    this.advance(); // consume const or static
    if (isMut) this.advance(); // consume mut

    const name = this.consume("IDENTIFIER", "Expected const/static name").value;
    this.consume("COLON", "Expected ':' after name");
    const typeAnnotation = this.parseTypeExpr();
    this.consume("ASSIGN", "Expected '=' after type");
    const value = this.parseExpr();
    this.consume("SEMICOLON", "Expected ';' after const value");

    if (isMut) {
      const decl: VarDecl = {
        kind: "VarDecl",
        name,
        isExported,
        isMut: true,
        typeAnnotation,
        value,
        span: emptySpan(),
      };
      const nodeId = `var:${name}`;
      for (const t of trivia) this.trivia.addLeadingTrivia(nodeId, t);
      items.push(decl);
    } else {
      const decl: ConstDecl = {
        kind: "ConstDecl",
        name,
        isExported,
        typeAnnotation,
        value,
        span: emptySpan(),
      };
      const nodeId = `const:${name}`;
      for (const t of trivia) this.trivia.addLeadingTrivia(nodeId, t);
      items.push(decl);
    }
  }

  private parseFn(items: ModuleItem[], isExported: boolean): void {
    const trivia = [...this.pendingTrivia];
    this.pendingTrivia = [];
    const isAsync = this.match("ASYNC");
    this.consume("FN", "Expected 'fn'");

    const fnName = this.consume("IDENTIFIER", "Expected function name").value;

    this.consume("LPAREN", "Expected '(' for parameters");
    const params: ParamDecl[] = [];
    while (!this.check("RPAREN") && !this.isAtEnd()) {
      if (this.match("MUT")) {
        // mut param
      }
      const pName = this.consume("IDENTIFIER", "Expected parameter name").value;
      this.consume("COLON", "Expected ':' after parameter name");
      const pType = this.parseTypeExpr();
      params.push({
        name: this.toAiceFieldName(pName),
        typeAnnotation: pType,
        span: emptySpan(),
      });
      if (!this.match("COMMA")) break;
    }
    this.consume("RPAREN", "Expected ')' closing parameters");

    let returnType: TypeExpr | null = null;
    if (this.match("ARROW")) {
      returnType = this.parseTypeExpr();
    }

    const body = this.parseBlock();

    const decl: FunctionDecl = {
      kind: "FunctionDecl",
      name: fnName === "main" ? "__top_level__" : this.toAiceMethodName(fnName),
      isExported,
      isAsync,
      typeParams: [],
      params,
      returnType,
      body,
      isExpressionBodied: false,
      span: emptySpan(),
    };
    const nodeId = `fn:${decl.name}`;
    for (const t of trivia) this.trivia.addLeadingTrivia(nodeId, t);
    items.push(decl);
  }

  private parseBlock(): Block {
    this.consume("LBRACE", "Expected '{' to start block");
    const statements: Statement[] = [];

    while (!this.check("RBRACE") && !this.isAtEnd()) {
      this.collectLeadingTrivia();
      if (this.check("RBRACE")) break;
      const stmt = this.parseStatement();
      if (stmt) {
        statements.push(stmt);
      }
      this.match("SEMICOLON");
    }

    this.consume("RBRACE", "Expected '}' closing block");
    return { kind: "Block", statements, span: emptySpan() };
  }

  private parseStatement(): Statement | null {
    // Return statement: return expr;
    if (this.check("RETURN")) {
      this.advance();
      if (this.check("SEMICOLON") || this.check("RBRACE")) {
        this.match("SEMICOLON");
        return { kind: "ReturnStmt", value: null, span: emptySpan() };
      }
      const val = this.parseExpr();
      this.match("SEMICOLON");
      return { kind: "ReturnStmt", value: val, span: emptySpan() };
    }

    // Let binding: let mut x: Type = expr; OR let x = expr;
    if (this.check("LET")) {
      this.advance();
      const isMut = this.match("MUT");
      const name = this.consume("IDENTIFIER", "Expected variable name").value;

      let typeAnnotation: TypeExpr | undefined;
      if (this.match("COLON")) {
        typeAnnotation = this.parseTypeExpr();
      }

      let val: Expr = {
        kind: "LiteralExpr",
        literalKind: "nil",
        value: null,
        rawValue: "None",
        span: emptySpan(),
      };
      if (this.match("ASSIGN")) {
        val = this.parseExpr();
      }
      this.match("SEMICOLON");

      return {
        kind: "LetBinding",
        name: this.toAiceFieldName(name),
        isMut,
        typeAnnotation: typeAnnotation ?? null,
        init: val,
        span: emptySpan(),
      };
    }

    // If statement: if cond { ... } else if ... else { ... }
    if (this.check("IF")) {
      this.advance();
      let cond: Expr;
      this.inControlHeader = true;
      try {
        cond = this.parseExpr();
      } finally {
        this.inControlHeader = false;
      }
      const thenBranch = this.parseBlock();
      const elifBranches: { condition: Expr; body: Block; span: Span }[] = [];
      let elseBranch: Block | null = null;

      while (this.match("ELSE")) {
        if (this.check("IF")) {
          this.advance();
          let elifCond: Expr;
          this.inControlHeader = true;
          try {
            elifCond = this.parseExpr();
          } finally {
            this.inControlHeader = false;
          }
          const elifBody = this.parseBlock();
          elifBranches.push({ condition: elifCond, body: elifBody, span: emptySpan() });
        } else {
          elseBranch = this.parseBlock();
          break;
        }
      }
      return { kind: "IfStmt", condition: cond, thenBranch, elifBranches, elseBranch, span: emptySpan() };
    }

    // Match statement: match expr { ... }
    if (this.check("MATCH")) {
      this.advance();
      let target: Expr;
      this.inControlHeader = true;
      try {
        target = this.parseExpr();
      } finally {
        this.inControlHeader = false;
      }
      this.consume("LBRACE", "Expected '{' after match");
      const cases: MatchCase[] = [];

      while (!this.check("RBRACE") && !this.isAtEnd()) {
        this.collectLeadingTrivia();
        if (this.check("RBRACE")) break;

        const pattern = this.parsePattern();
        let guard: Expr | undefined;
        if (this.match("IF")) {
          guard = this.parseExpr();
        }
        this.consume("FAT_ARROW", "Expected '=>' after pattern");

        let body: Block | Expr;
        if (this.check("LBRACE")) {
          body = this.parseBlock();
        } else {
          body = this.parseExpr();
        }
        this.match("COMMA");

        cases.push({ pattern, guard, body, span: emptySpan() });
      }

      this.consume("RBRACE", "Expected '}' closing match");
      return { kind: "MatchStmt", target, cases, span: emptySpan() };
    }

    // For statement: for item in iter { ... }
    if (this.check("FOR")) {
      this.advance();
      const item = this.consume("IDENTIFIER", "Expected loop variable name").value;
      this.consume("IN", "Expected 'in' after loop variable");
      let iter: Expr;
      this.inControlHeader = true;
      try {
        iter = this.parseExpr();
      } finally {
        this.inControlHeader = false;
      }
      const body = this.parseBlock();
      return {
        kind: "ForStmt",
        variable: this.toAiceFieldName(item),
        iterable: iter,
        body,
        span: emptySpan(),
      };
    }

    // While statement: while cond { ... }
    if (this.check("WHILE")) {
      this.advance();
      let cond: Expr;
      this.inControlHeader = true;
      try {
        cond = this.parseExpr();
      } finally {
        this.inControlHeader = false;
      }
      const body = this.parseBlock();
      return { kind: "WhileStmt", condition: cond, body, span: emptySpan() };
    }

    // Loop statement: loop { ... }
    if (this.check("LOOP")) {
      this.advance();
      const body = this.parseBlock();
      return {
        kind: "WhileStmt",
        condition: {
          kind: "LiteralExpr",
          literalKind: "boolean",
          value: true,
          rawValue: "true",
          span: emptySpan(),
        },
        body,
        span: emptySpan(),
      };
    }

    // Expression statement or assignment or trailing return
    const expr = this.parseExpr();

    // Assignment: target = value;
    if (
      this.check("ASSIGN") ||
      this.check("PLUS_ASSIGN") ||
      this.check("MINUS_ASSIGN") ||
      this.check("STAR_ASSIGN") ||
      this.check("SLASH_ASSIGN")
    ) {
      const opTok = this.advance();
      const val = this.parseExpr();
      this.match("SEMICOLON");
      return {
        kind: "AssignStmt",
        target: expr,
        op: opTok.value as AssignOp,
        value: val,
        span: emptySpan(),
      };
    }

    // If followed by semicolon, standard ExprStmt
    if (this.match("SEMICOLON")) {
      return { kind: "ExprStmt", expr, span: emptySpan() };
    }

    // Trailing expression at end of block without semicolon (Rust implicit return)
    if (this.check("RBRACE")) {
      return { kind: "ReturnStmt", value: expr, span: emptySpan() };
    }

    return { kind: "ExprStmt", expr, span: emptySpan() };
  }

  private parsePattern(): Pattern {
    if (this.match("UNDERSCORE")) {
      return { kind: "WildcardPattern", span: emptySpan() };
    }

    if (this.check("NUMBER") || this.check("STRING")) {
      const expr = this.parseExpr() as LiteralExpr;
      return { kind: "LiteralPattern", value: expr, span: emptySpan() };
    }

    const id = this.consume("IDENTIFIER", "Expected pattern identifier").value;

    // Check for Enum::Variant or Variant(arg)
    let variantName = id;
    if (this.match("DOUBLE_COLON")) {
      const v = this.consume("IDENTIFIER", "Expected variant name").value;
      variantName = v;
    }

    if (this.check("LPAREN")) {
      this.advance();
      const subPatterns: Pattern[] = [];
      while (!this.check("RPAREN") && !this.isAtEnd()) {
        subPatterns.push(this.parsePattern());
        if (!this.match("COMMA")) break;
      }
      this.consume("RPAREN", "Expected ')' closing variant pattern");
      return {
        kind: "ConstructorPattern",
        name: variantName,
        subPatterns,
        span: emptySpan(),
      };
    }

    return { kind: "IdentifierPattern", name: variantName, span: emptySpan() };
  }

  // Pratt / Precedence Climbing Expression Parser
  private parseExpr(minPrec = 0): Expr {
    let left = this.parsePrefix();

    while (!this.isAtEnd()) {
      const prec = this.getInfixPrecedence();
      if (prec < minPrec) break;

      left = this.parseInfix(left, prec);
    }

    return left;
  }

  private parsePrefix(): Expr {
    // Unary operators
    if (this.match("BANG")) {
      const operand = this.parseExpr(7);
      return { kind: "UnaryExpr", operator: "not", operand, span: emptySpan() };
    }
    if (this.match("MINUS")) {
      const operand = this.parseExpr(7);
      return { kind: "UnaryExpr", operator: "-", operand, span: emptySpan() };
    }
    if (this.match("AMP")) {
      // borrow &expr or &mut expr -> unwrap
      if (this.match("MUT")) {
        // &mut
      }
      return this.parseExpr(7);
    }
    if (this.match("STAR")) {
      // dereference *expr
      return this.parseExpr(7);
    }

    // Grouping
    if (this.match("LPAREN")) {
      const expr = this.parseExpr();
      this.consume("RPAREN", "Expected ')' closing expression");
      // Check for cast: (expr as Type)
      if (this.match("AS")) {
        this.parseTypeExpr();
      }
      return expr;
    }

    // Literals
    if (this.check("NUMBER")) {
      const tok = this.advance();
      return {
        kind: "LiteralExpr",
        literalKind: "number",
        value: Number(tok.value),
        rawValue: tok.value,
        span: emptySpan(),
      };
    }

    if (this.check("STRING")) {
      const tok = this.advance();
      return {
        kind: "LiteralExpr",
        literalKind: "string",
        value: tok.value,
        rawValue: JSON.stringify(tok.value),
        span: emptySpan(),
      };
    }

    if (this.check("IDENTIFIER")) {
      const tok = this.advance();
      if (tok.value === "true") {
        return {
          kind: "LiteralExpr",
          literalKind: "boolean",
          value: true,
          rawValue: "true",
          span: emptySpan(),
        };
      }
      if (tok.value === "false") {
        return {
          kind: "LiteralExpr",
          literalKind: "boolean",
          value: false,
          rawValue: "false",
          span: emptySpan(),
        };
      }
      if (tok.value === "None") {
        return {
          kind: "LiteralExpr",
          literalKind: "nil",
          value: null,
          rawValue: "None",
          span: emptySpan(),
        };
      }
      if (tok.value === "self") {
        return { kind: "IdentifierExpr", name: "self", span: emptySpan() };
      }

      // Check for macro: println!(...) or format!(...) or vec![...]
      if (this.match("BANG")) {
        if (tok.value === "vec") {
          // vec![...]
          this.consume("LBRACKET", "Expected '[' in vec!");
          const elements: Expr[] = [];
          while (!this.check("RBRACKET") && !this.isAtEnd()) {
            elements.push(this.parseExpr());
            if (!this.match("COMMA")) break;
          }
          this.consume("RBRACKET", "Expected ']' closing vec!");
          return { kind: "ArrayLiteralExpr", elements, span: emptySpan() };
        }

        if (tok.value === "println" || tok.value === "print") {
          this.consume("LPAREN", "Expected '(' in println!");
          const args: Expr[] = [];
          while (!this.check("RPAREN") && !this.isAtEnd()) {
            args.push(this.parseExpr());
            if (!this.match("COMMA")) break;
          }
          this.consume("RPAREN", "Expected ')' closing println!");
          return {
            kind: "CallExpr",
            callee: { kind: "IdentifierExpr", name: "print", span: emptySpan() },
            args,
            span: emptySpan(),
          };
        }

        if (tok.value === "format") {
          this.consume("LPAREN", "Expected '(' in format!");
          const args: Expr[] = [];
          while (!this.check("RPAREN") && !this.isAtEnd()) {
            args.push(this.parseExpr());
            if (!this.match("COMMA")) break;
          }
          this.consume("RPAREN", "Expected ')' closing format!");
          if (args.length > 0 && args[0].kind === "LiteralExpr") {
            const raw = String(args[0].value);
            const quasis = raw.split("{}");
            return {
              kind: "TemplateLiteralExpr",
              quasis,
              expressions: args.slice(1),
              span: emptySpan(),
            };
          }
          return {
            kind: "CallExpr",
            callee: { kind: "IdentifierExpr", name: "format", span: emptySpan() },
            args,
            span: emptySpan(),
          };
        }
      }

      // Check for path qualifier: Enum::Variant or Struct::new or std::cmp::min
      if (this.match("DOUBLE_COLON")) {
        const segments: string[] = [tok.value];
        segments.push(this.consume("IDENTIFIER", "Expected member name after ::").value);
        while (this.match("DOUBLE_COLON")) {
          segments.push(this.consume("IDENTIFIER", "Expected member name after ::").value);
        }
        const fullPath = segments.join("::");
        const last = segments[segments.length - 1];
        if (fullPath === "std::cmp::min" || last === "min") {
          return { kind: "IdentifierExpr", name: "min", span: emptySpan() };
        }
        if (fullPath === "std::cmp::max" || last === "max") {
          return { kind: "IdentifierExpr", name: "max", span: emptySpan() };
        }
        if (last === "new") {
          // Struct::new(...) -> constructor call
          return {
            kind: "IdentifierExpr",
            name: segments[segments.length - 2] ?? tok.value,
            span: emptySpan(),
          };
        }
        return {
          kind: "IdentifierExpr",
          name: last,
          span: emptySpan(),
        };
      }

      // Struct literal: StructName { field: val, ... }
      if (!this.inControlHeader && this.check("LBRACE") && /^[A-Z]/.test(tok.value)) {
        this.advance(); // consume '{'
        const props: { key?: string; value: Expr; isSpread?: boolean }[] = [];
        while (!this.check("RBRACE") && !this.isAtEnd()) {
          this.collectLeadingTrivia();
          if (this.check("RBRACE")) break;
          if (this.match("DOT_DOT")) {
            // ..spread
            const sp = this.parseExpr();
            props.push({ value: sp, isSpread: true });
            if (!this.match("COMMA")) break;
            continue;
          }
          const k = this.consume("IDENTIFIER", "Expected struct field name").value;
          let v: Expr;
          if (this.match("COLON")) {
            v = this.parseExpr();
          } else {
            // shorthand { field }
            v = {
              kind: "IdentifierExpr",
              name: this.toAiceFieldName(k),
              span: emptySpan(),
            };
          }
          props.push({ key: this.toAiceFieldName(k), value: v });
          if (!this.match("COMMA")) break;
        }
        this.consume("RBRACE", "Expected '}' closing struct literal");
        return {
          kind: "CallExpr",
          callee: { kind: "IdentifierExpr", name: tok.value, span: emptySpan() },
          args: props.filter((p) => !p.isSpread).map((p) => p.value),
          span: emptySpan(),
        };
      }

      return { kind: "IdentifierExpr", name: this.toAiceFieldName(tok.value), span: emptySpan() };
    }

    throw new Error(
      `Unexpected token in Rust expression: ${this.peek().kind} (${this.peek().value})`,
    );
  }

  private getInfixPrecedence(): number {
    const k = this.peek().kind;
    switch (k) {
      case "OR":
        return 1;
      case "AND":
        return 2;
      case "EQ":
      case "NEQ":
      case "LT":
      case "LTE":
      case "GT":
      case "GTE":
        return 3;
      case "PLUS":
      case "MINUS":
      case "PIPE":
      case "CARET":
        return 4;
      case "STAR":
      case "SLASH":
      case "PERCENT":
      case "AMP":
        return 5;
      case "AS":
        return 6;
      case "QUESTION":
      case "DOT":
      case "LPAREN":
      case "LBRACKET":
        return 8;
      default:
        return -1;
    }
  }

  private parseInfix(left: Expr, prec: number): Expr {
    // Cast: expr as Type
    if (this.check("AS")) {
      this.advance();
      this.parseTypeExpr();
      return left;
    }

    // Postfix ? operator
    if (this.match("QUESTION")) {
      return { kind: "PostfixTryExpr", operand: left, span: emptySpan() };
    }

    const tok = this.advance();

    // Call expression: left(args)
    if (tok.kind === "LPAREN") {
      const args: Expr[] = [];
      while (!this.check("RPAREN") && !this.isAtEnd()) {
        args.push(this.parseExpr());
        if (!this.match("COMMA")) break;
      }
      this.consume("RPAREN", "Expected ')' closing call");

      // Clean unwrap of .to_string(), .clone(), .to_owned(), .as_str()
      if (left.kind === "MemberAccessExpr") {
        if (
          left.property === "to_string" ||
          left.property === "toString" ||
          left.property === "clone" ||
          left.property === "to_owned" ||
          left.property === "toOwned" ||
          left.property === "as_str" ||
          left.property === "asStr"
        ) {
          return left.object;
        }
        if (left.property === "is_ok") {
          return {
            kind: "CallExpr",
            callee: {
              kind: "MemberAccessExpr",
              object: left.object,
              property: "isOk",
              isSafeNav: false,
              span: emptySpan(),
            },
            args: [],
            span: emptySpan(),
          };
        }
        if (left.property === "is_err") {
          return {
            kind: "CallExpr",
            callee: {
              kind: "MemberAccessExpr",
              object: left.object,
              property: "isErr",
              isSafeNav: false,
              span: emptySpan(),
            },
            args: [],
            span: emptySpan(),
          };
        }
        if (left.property === "len") {
          return {
            kind: "MemberAccessExpr",
            object: left.object,
            property: "len",
            isSafeNav: false,
            span: emptySpan(),
          };
        }
      }

      return { kind: "CallExpr", callee: left, args, span: emptySpan() };
    }

    // Member access: left.property
    if (tok.kind === "DOT") {
      const propTok = this.consume("IDENTIFIER", "Expected member property name");
      const prop = propTok.value;

      // Handle .len() property shorthand
      if (prop === "len" && this.check("LPAREN")) {
        this.advance();
        this.consume("RPAREN", "Expected ')' after len");
        return {
          kind: "MemberAccessExpr",
          object: left,
          property: "len",
          isSafeNav: false,
          span: emptySpan(),
        };
      }

      return {
        kind: "MemberAccessExpr",
        object: left,
        property: this.toAiceFieldName(prop),
        isSafeNav: false,
        span: emptySpan(),
      };
    }

    // Index access: left[idx]
    if (tok.kind === "LBRACKET") {
      const idx = this.parseExpr();
      this.consume("RBRACKET", "Expected ']' closing index");
      return { kind: "IndexExpr", object: left, index: idx, span: emptySpan() };
    }

    // Binary operations
    const op = this.toBinaryOp(tok.kind);
    const right = this.parseExpr(prec + 1);
    return { kind: "BinaryExpr", left, operator: op, right, span: emptySpan() };
  }

  private toBinaryOp(kind: RustTokenKind): BinaryOp {
    switch (kind) {
      case "AND":
        return "and";
      case "OR":
        return "or";
      case "EQ":
        return "==";
      case "NEQ":
        return "!=";
      case "LT":
        return "<";
      case "LTE":
        return "<=";
      case "GT":
        return ">";
      case "GTE":
        return ">=";
      case "PLUS":
        return "+";
      case "MINUS":
        return "-";
      case "STAR":
        return "*";
      case "SLASH":
        return "/";
      case "PERCENT":
        return "%";
      case "AMP":
        return "&";
      case "PIPE":
        return "|";
      case "CARET":
        return "^";
      default:
        return "==";
    }
  }

  private parseTypeExpr(): TypeExpr {
    // Borrow &T or &str or &mut T
    if (this.match("AMP")) {
      if (this.match("MUT")) {
        // &mut
      }
      if (this.check("LBRACKET")) {
        // &[T] slice
        this.advance();
        const elem = this.parseTypeExpr();
        this.consume("RBRACKET", "Expected ']' in slice type");
        return { kind: "ArrayType", elementType: elem, span: emptySpan() };
      }
      return this.parseTypeExpr();
    }

    // Unit type ()
    if (this.check("LPAREN")) {
      this.advance();
      if (this.check("RPAREN")) {
        this.advance();
        return { kind: "PrimitiveType", primitive: "void", span: emptySpan() };
      }
      const inner = this.parseTypeExpr();
      this.consume("RPAREN", "Expected ')' closing type");
      return inner;
    }

    if (this.match("UNDERSCORE")) {
      return { kind: "NamedType", name: "_", span: emptySpan() };
    }

    const id = this.consume("IDENTIFIER", "Expected type name").value;

    // Generic type args: Type<A, B>
    let typeArgs: TypeExpr[] | undefined;
    if (this.match("LT")) {
      typeArgs = [];
      while (!this.check("GT") && !this.isAtEnd()) {
        typeArgs.push(this.parseTypeExpr());
        if (!this.match("COMMA")) break;
      }
      this.consume("GT", "Expected '>' closing generic type arguments");
    }

    if (id === "Vec" && typeArgs && typeArgs.length > 0) {
      return { kind: "ArrayType", elementType: typeArgs[0], span: emptySpan() };
    }
    if (id === "HashMap" && typeArgs && typeArgs.length >= 2) {
      return { kind: "NamedType", name: "Map", typeArgs, span: emptySpan() };
    }
    if (id === "Option" && typeArgs && typeArgs.length > 0) {
      return { kind: "OptionType", innerType: typeArgs[0], span: emptySpan() };
    }
    if (id === "Result" && typeArgs && typeArgs.length >= 2) {
      return { kind: "ResultType", okType: typeArgs[0], errType: typeArgs[1], span: emptySpan() };
    }

    switch (id) {
      case "i64":
      case "i32":
      case "i16":
      case "i8":
      case "u64":
      case "u32":
      case "u16":
      case "u8":
      case "usize":
      case "isize":
        return { kind: "PrimitiveType", primitive: "int", span: emptySpan() };
      case "f64":
      case "f32":
        return { kind: "PrimitiveType", primitive: "float", span: emptySpan() };
      case "String":
      case "str":
        return { kind: "PrimitiveType", primitive: "str", span: emptySpan() };
      case "bool":
        return { kind: "PrimitiveType", primitive: "bool", span: emptySpan() };
      default:
        return { kind: "NamedType", name: id, typeArgs, span: emptySpan() };
    }
  }

  private toAiceFieldName(str: string): string {
    return str.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  }

  private toAiceMethodName(str: string): string {
    return str.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  }

  // Token helper methods
  private check(kind: RustTokenKind): boolean {
    if (this.isAtEnd()) return kind === "EOF";
    return this.peek().kind === kind;
  }

  private match(kind: RustTokenKind): boolean {
    if (this.check(kind)) {
      this.advance();
      return true;
    }
    return false;
  }

  private consume(kind: RustTokenKind, message: string): RustToken {
    if (this.check(kind)) return this.advance();
    throw new Error(
      `RustDecompiler syntax error at line ${this.peek().line}, col ${this.peek().col}: ${message}. Found: ${this.peek().kind} (${this.peek().value})`,
    );
  }

  private advance(): RustToken {
    if (!this.isAtEnd()) this.cur++;
    return this.previous();
  }

  private isAtEnd(): boolean {
    return this.cur >= this.tokens.length || this.tokens[this.cur].kind === "EOF";
  }

  private peek(offset = 0): RustToken {
    const idx = this.cur + offset;
    return idx < this.tokens.length
      ? this.tokens[idx]
      : { kind: "EOF", value: "", line: 0, col: 0 };
  }

  private previous(): RustToken {
    return this.tokens[this.cur - 1];
  }
}

export function decompileRust(
  source: string,
  filePath = "source.rs",
  options: AiceGeneratorOptions = {},
): { ast: Module; aice: string; trivia: CstTriviaTable } {
  const decompiler = new RustDecompiler(source, filePath);
  const { ast, trivia } = decompiler.decompile();
  trivia.setOriginalSource(source);

  const generator = new AiceGenerator({ ...options, trivia });
  const aice = generator.generate(ast);

  return { ast, aice, trivia };
}
