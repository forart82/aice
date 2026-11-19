/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Module, import, type/enum, parameter, function, class, property, method, const, and var declarations.
 */

import type {
  Block,
  ClassDecl,
  ConstDecl,
  EnumVariantDecl,
  Expr,
  FieldDecl,
  FunctionDecl,
  ImportDecl,
  ImportSpecifier,
  MethodDecl,
  Module,
  ModuleItem,
  ParamDecl,
  PrimitiveType,
  PropertyDecl,
  TypeDecl,
  TypeExpr,
  VarDecl,
} from "../ast.js";
import { createSpan, mergeSpans, type Span } from "../span.js";
import { ParserError, type ParserHost } from "./core.js";

// Top-Level Module Parsing
export function parseModule(p: ParserHost): Module {
  const startSpan = p.current().span;
  let modulePath = "main";

  p.consumeStatementSeparator();

  if (p.check("MODULE")) {
    p.advance(); // consume 'module'
    modulePath = parseModulePath(p);
    p.consumeStatementSeparator();
  }

  const items: ModuleItem[] = [];

  while (!p.check("EOF")) {
    p.consumeStatementSeparator();
    if (p.check("EOF")) break;

    const item = parseModuleItem(p);
    if (item) {
      items.push(item);
    }
    p.consumeStatementSeparator();
  }

  const endSpan = p.current().span;

  return {
    kind: "Module",
    path: modulePath,
    items,
    span: createSpan(p.file, startSpan.start, endSpan.end),
  };
}

function parseModulePath(p: ParserHost): string {
  let path = "";
  if (p.check("SLASH")) {
    p.advance();
    path = "/";
  }
  if (p.isIdentOrKeyword(p.current()) || p.check("NUMBER")) {
    path += p.advance().value;
  } else if (!path) {
    path = p.consume("IDENT", "Expected module identifier").value;
  }
  while (
    p.check("SLASH") ||
    p.check("DOT") ||
    p.check("MINUS") ||
    p.check("COLON_COLON") ||
    p.check("NUMBER") ||
    p.isIdentOrKeyword(p.current())
  ) {
    if (p.check("SLASH")) {
      p.advance();
      const seg = p.isIdentOrKeyword(p.current()) || p.check("NUMBER") ? p.advance().value : "";
      path += `/${seg}`;
    } else if (p.check("DOT")) {
      p.advance();
      const seg = p.isIdentOrKeyword(p.current()) || p.check("NUMBER") ? p.advance().value : "";
      path += `.${seg}`;
    } else if (p.check("COLON_COLON")) {
      p.advance();
      const seg = p.isIdentOrKeyword(p.current()) || p.check("NUMBER") ? p.advance().value : "";
      path += `::${seg}`;
    } else if (p.check("MINUS")) {
      p.advance();
      const seg = p.isIdentOrKeyword(p.current()) || p.check("NUMBER") ? p.advance().value : "";
      path += `-${seg}`;
    } else {
      path += p.advance().value;
    }
  }
  return path;
}

function parseModuleItem(p: ParserHost): ModuleItem | null {
  let isExported = false;
  if (
    p.check("PUB") &&
    p.peek(1).kind !== "COLON_EQUAL" &&
    p.peek(1).kind !== "COLON_COLON_EQUAL" &&
    p.peek(1).kind !== "EQUAL" &&
    p.peek(1).kind !== "DOT" &&
    p.peek(1).kind !== "COLON_COLON" &&
    p.peek(1).kind !== "QUESTION_DOT" &&
    !(p.peek(1).kind === "COLON" && p.isTypedDeclarationAhead())
  ) {
    isExported = true;
    p.advance();
  }

  if (p.check("FROM") || p.check("IMPORT")) {
    return parseImportDecl(p, isExported);
  }
  if (
    p.check("IDENT") &&
    p.current().value === "use" &&
    (p.peek(1).kind === "DOT" ||
      p.peek(1).kind === "SLASH" ||
      p.peek(1).kind === "STRING" ||
      (p.isIdentOrKeyword(p.peek(1)) &&
        p.peek(1).kind !== "COLON_EQUAL" &&
        p.peek(1).kind !== "EQUAL"))
  ) {
    return parseUseImportDecl(p, isExported);
  }
  if (p.check("TYPE")) {
    if (
      p.peek(1).kind === "COLON_EQUAL" ||
      p.peek(1).kind === "COLON_COLON_EQUAL" ||
      p.peek(1).kind === "EQUAL" ||
      (p.peek(1).kind === "COLON" && p.isTypedDeclarationAhead())
    ) {
      return parseVarDecl(p, isExported);
    }
    return parseTypeDecl(p, false);
  }
  if (p.check("ENUM")) {
    return parseTypeDecl(p, true);
  }
  if (p.check("CLASS")) {
    return parseClassDecl(p, isExported);
  }
  if (p.check("CONST")) {
    return parseConstDecl(p, isExported);
  }
  const isValDecl =
    p.check("VAL") &&
    p.peek(1).kind !== "COLON_EQUAL" &&
    p.peek(1).kind !== "COLON_COLON_EQUAL" &&
    p.peek(1).kind !== "EQUAL" &&
    p.peek(1).kind !== "DOT" &&
    p.peek(1).kind !== "COLON_COLON" &&
    p.peek(1).kind !== "QUESTION_DOT" &&
    !(p.peek(1).kind === "COLON" && p.isTypedDeclarationAhead());

  const isMutDecl =
    p.check("MUT") &&
    p.peek(1).kind !== "COLON_EQUAL" &&
    p.peek(1).kind !== "COLON_COLON_EQUAL" &&
    p.peek(1).kind !== "EQUAL" &&
    p.peek(1).kind !== "DOT" &&
    p.peek(1).kind !== "COLON_COLON" &&
    p.peek(1).kind !== "QUESTION_DOT" &&
    !(p.peek(1).kind === "COLON" && p.isTypedDeclarationAhead());

  if (
    isExported &&
    (p.check("LET") ||
      isValDecl ||
      isMutDecl ||
      p.check("COLON_EQUAL") ||
      p.check("COLON_COLON_EQUAL"))
  ) {
    return parseVarDecl(p, isExported);
  }
  if (isValDecl || isMutDecl || p.check("COLON_EQUAL") || p.check("COLON_COLON_EQUAL")) {
    return parseVarDecl(p, isExported);
  }
  if (
    p.isIdentOrKeyword(p.current()) &&
    (p.peek(1).kind === "COLON_EQUAL" ||
      p.peek(1).kind === "COLON_COLON_EQUAL" ||
      (p.peek(1).kind === "COLON" && p.isTypedDeclarationAhead()))
  ) {
    return parseVarDecl(p, isExported);
  }
  if (p.check("FN") || (p.check("ASYNC") && p.peek(1).kind === "FN")) {
    return parseFunctionDecl(p, isExported);
  }
  if (p.check("COMPONENT")) {
    if (
      p.peek(1).kind === "COLON_EQUAL" ||
      p.peek(1).kind === "COLON_COLON_EQUAL" ||
      p.peek(1).kind === "EQUAL" ||
      (p.peek(1).kind === "COLON" && p.isTypedDeclarationAhead())
    ) {
      return parseVarDecl(p, isExported);
    }
    return p.parseComponentDecl();
  }
  if (p.check("STYLE")) {
    if (
      p.peek(1).kind === "COLON_EQUAL" ||
      p.peek(1).kind === "COLON_COLON_EQUAL" ||
      p.peek(1).kind === "EQUAL" ||
      (p.peek(1).kind === "COLON" && p.isTypedDeclarationAhead())
    ) {
      return parseVarDecl(p, isExported);
    }
    return p.parseStyleDecl();
  }
  if (p.check("TOKENS")) {
    if (
      p.peek(1).kind === "COLON_EQUAL" ||
      p.peek(1).kind === "COLON_COLON_EQUAL" ||
      p.peek(1).kind === "EQUAL" ||
      (p.peek(1).kind === "COLON" && p.isTypedDeclarationAhead())
    ) {
      return parseVarDecl(p, isExported);
    }
    return p.parseTokensDecl();
  }

  // Top-level statements allowed for script execution
  const stmt = p.parseStatement();
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
    `Unexpected token '${p.current().kind}' (${p.current().value}) at top level`,
    p.current().span,
  );
}

function parseUseImportDecl(p: ParserHost, isExported = false): ImportDecl {
  const startSpan = p.current().span;
  p.advance(); // consume 'use'
  let source = "";
  const specifiers: ImportSpecifier[] = [];

  if (p.check("STRING")) {
    source = p.advance().value;
  } else {
    while (!p.check("NEWLINE") && !p.check("EOF") && !p.check("SEMICOLON")) {
      if (p.check("DOT") && (p.peek(1).kind === "LBRACE" || p.peek(1).kind === "STAR")) {
        p.advance(); // consume '.' before '{' or '*'
        break;
      }
      if (p.check("LBRACE")) {
        break;
      }
      if (p.check("DOT")) {
        p.advance();
        source += ".";
      } else if (p.check("SLASH")) {
        p.advance();
        source += "/";
      } else if (p.check("MINUS")) {
        p.advance();
        source += "-";
      } else if (p.isIdentOrKeyword(p.current()) || p.check("NUMBER")) {
        source += p.advance().value;
      } else {
        break;
      }
    }
  }

  if (p.check("DOT") && (p.peek(1).kind === "LBRACE" || p.peek(1).kind === "STAR")) {
    p.advance();
  }

  if (p.check("STAR")) {
    const starToken = p.advance();
    let alias: string | undefined;
    if (p.check("IDENT") && p.current().value === "as") {
      p.advance();
      alias = p.parseContextualIdent("Expected alias identifier after 'as'");
    }
    specifiers.push({
      name: "*",
      alias,
      isWildcard: true,
      span: starToken.span,
    });
  } else if (p.check("LBRACE")) {
    p.advance();
    while (!p.check("RBRACE") && !p.check("NEWLINE") && !p.check("EOF") && !p.check("SEMICOLON")) {
      const idToken = p.parseContextualIdentToken("Expected import identifier");
      let alias: string | undefined;
      if (p.check("IDENT") && p.current().value === "as") {
        p.advance();
        alias = p.parseContextualIdent("Expected alias identifier after 'as'");
      }
      specifiers.push({
        name: idToken.value,
        alias,
        span: idToken.span,
      });
      if (p.check("COMMA")) {
        p.advance();
      } else {
        break;
      }
    }
    if (p.check("RBRACE")) {
      p.advance();
    }
  }

  const endSpan = p.current().span;
  p.consumeStatementSeparator();

  return {
    kind: "ImportDecl",
    source,
    specifiers,
    isExported: isExported || undefined,
    span: mergeSpans(startSpan, endSpan),
  };
}

// Import Declarations: from "source" import a, b as c, *
// or: import { style, tokens, match, type } from "..."
// or: import * as name from "..."
// or: import "source"
function parseImportDecl(p: ParserHost, isExported = false): ImportDecl {
  const startSpan = p.current().span;
  let source = "";

  if (p.check("FROM")) {
    p.advance();
    source = p.consume("STRING", "Expected import source string").value;
    p.consume("IMPORT", "Expected 'import' keyword after from-source");

    const specifiers: ImportSpecifier[] = [];

    if (p.check("STAR")) {
      const starToken = p.advance();
      let alias: string | undefined;
      if (p.check("IDENT") && p.current().value === "as") {
        p.advance();
        alias = p.parseContextualIdent("Expected alias identifier after 'as'");
      }
      specifiers.push({
        name: "*",
        alias,
        isWildcard: true,
        span: starToken.span,
      });
    } else {
      const hasBraces = p.check("LBRACE");
      if (hasBraces) p.advance();

      while (!p.check("NEWLINE") && !p.check("EOF") && !p.check("SEMICOLON")) {
        if (hasBraces && p.check("RBRACE")) break;
        const idToken = p.parseContextualIdentToken("Expected import identifier");
        let alias: string | undefined;

        if (p.check("IDENT") && p.current().value === "as") {
          p.advance();
          alias = p.parseContextualIdent("Expected alias identifier after 'as'");
        }

        specifiers.push({
          name: idToken.value,
          alias,
          span: idToken.span,
        });

        if (p.check("COMMA")) {
          p.advance();
        } else {
          break;
        }
      }
      if (hasBraces) {
        p.consume("RBRACE", "Expected '}' in import declaration");
      }
    }

    const endSpan = p.current().span;
    p.consumeStatementSeparator();

    return {
      kind: "ImportDecl",
      source,
      specifiers,
      isExported: isExported || undefined,
      span: mergeSpans(startSpan, endSpan),
    };
  } else {
    p.consume("IMPORT");
    if (p.check("STRING")) {
      source = p.advance().value;
      const endSpan = p.current().span;
      p.consumeStatementSeparator();
      return {
        kind: "ImportDecl",
        source,
        specifiers: [],
        isExported: isExported || undefined,
        span: mergeSpans(startSpan, endSpan),
      };
    }

    const specifiers: ImportSpecifier[] = [];

    if (p.check("STAR")) {
      const starToken = p.advance();
      let alias: string | undefined;
      if (p.check("IDENT") && p.current().value === "as") {
        p.advance();
        alias = p.parseContextualIdent("Expected alias identifier after 'as'");
      }
      specifiers.push({
        name: "*",
        alias,
        isWildcard: true,
        span: starToken.span,
      });
    } else {
      const hasBraces = p.check("LBRACE");
      if (hasBraces) {
        p.advance();
        while (
          !p.check("RBRACE") &&
          !p.check("NEWLINE") &&
          !p.check("EOF") &&
          !p.check("SEMICOLON")
        ) {
          const idToken = p.parseContextualIdentToken("Expected import identifier");
          let alias: string | undefined;

          if (p.check("IDENT") && p.current().value === "as") {
            p.advance();
            alias = p.parseContextualIdent("Expected alias identifier after 'as'");
          }

          specifiers.push({
            name: idToken.value,
            alias,
            span: idToken.span,
          });

          if (p.check("COMMA")) {
            p.advance();
          } else {
            break;
          }
        }
        p.consume("RBRACE", "Expected '}' in import declaration");
      } else {
        while (
          !p.check("FROM") &&
          !p.check("NEWLINE") &&
          !p.check("EOF") &&
          !p.check("SEMICOLON")
        ) {
          const idToken = p.parseContextualIdentToken("Expected import identifier");
          let alias: string | undefined;

          if (p.check("IDENT") && p.current().value === "as") {
            p.advance();
            alias = p.parseContextualIdent("Expected alias identifier after 'as'");
          }

          specifiers.push({
            name: idToken.value,
            alias,
            span: idToken.span,
          });

          if (p.check("COMMA")) {
            p.advance();
          } else {
            break;
          }
        }
      }
    }

    p.consume("FROM", "Expected 'from' after import specifiers");
    source = p.consume("STRING", "Expected import source string").value;
    const endSpan = p.current().span;
    p.consumeStatementSeparator();

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
function parseTypeDecl(p: ParserHost, isEnum: boolean): TypeDecl {
  const startSpan = p.current().span;
  p.advance(); // consume 'type' or 'enum'

  const name = p.parseContextualIdentOrString("Expected type name");
  const typeParams: string[] = [];

  if (p.check("LBRACKET")) {
    p.advance();
    while (!p.check("RBRACKET") && !p.check("EOF")) {
      typeParams.push(p.parseContextualIdentOrString("Expected type parameter"));
      if (p.check("COMMA")) p.advance();
    }
    p.consume("RBRACKET");
  }

  // Type Alias (e.g. type Port = { p:int | p >= 1 and p <= 65535 })
  if (p.check("EQUAL")) {
    p.advance();
    const aliasType = parseTypeExpr(p);
    p.consumeStatementSeparator();
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
  p.consume("COLON", "Expected ':' before type body");
  p.consumeStatementSeparator();

  if (isEnum) {
    const variants: EnumVariantDecl[] = [];
    const hasIndent = p.check("INDENT");
    if (hasIndent) {
      p.advance(); // consume INDENT
    }

    while (!p.check("EOF")) {
      p.consumeStatementSeparator();
      if (hasIndent && (p.check("DEDENT") || p.check("EOF"))) {
        break;
      }
      if (!hasIndent && (p.check("NEWLINE") || p.check("EOF"))) {
        break;
      }

      if ((p.check("IDENT") && p.current().value === "pass") || p.check("ELLIPSIS")) {
        p.advance();
        p.consumeStatementSeparator();
        continue;
      }

      while (!p.check("EOF")) {
        const vSpan = p.current().span;
        const vName = p.parseContextualIdentOrString("Expected variant name");
        let payloadTypes: TypeExpr[] | undefined;

        if (p.check("LPAREN")) {
          p.advance();
          payloadTypes = [];
          while (!p.check("RPAREN") && !p.check("EOF")) {
            payloadTypes.push(parseTypeExpr(p));
            if (p.check("COMMA")) p.advance();
          }
          p.consume("RPAREN");
        }

        variants.push({
          name: vName,
          payloadTypes,
          span: mergeSpans(vSpan, p.current().span),
        });

        if (p.check("COMMA")) {
          p.advance();
        } else {
          break;
        }
      }

      p.consumeStatementSeparator();
      if (!hasIndent) {
        break;
      }
    }

    let endSpan = p.current().span;
    if (hasIndent && p.check("DEDENT")) {
      endSpan = p.consume("DEDENT").span;
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
  const hasIndent = p.check("INDENT");
  if (hasIndent) {
    p.advance(); // consume INDENT
  } else {
    if (p.check("NEWLINE") || p.check("EOF")) {
      p.consumeStatementSeparator();
      return {
        kind: "TypeDecl",
        isEnum: false,
        name,
        typeParams,
        fields: [],
        span: mergeSpans(startSpan, p.previous().span),
      };
    }
  }

  while (!p.check("EOF")) {
    p.consumeStatementSeparator();
    if (hasIndent && (p.check("DEDENT") || p.check("EOF"))) {
      break;
    }
    if (!hasIndent && (p.check("NEWLINE") || p.check("EOF"))) {
      break;
    }

    if ((p.check("IDENT") && p.current().value === "pass") || p.check("ELLIPSIS")) {
      p.advance();
      p.consumeStatementSeparator();
      continue;
    }

    while (!p.check("EOF")) {
      const fSpan = p.current().span;
      const fName = p.parseContextualIdentOrString("Expected field name");
      let isOptional = false;
      if (p.check("QUESTION")) {
        p.advance();
        isOptional = true;
      }
      p.consume("COLON", "Expected ':' after field name");
      const fType = parseTypeExpr(p);

      let defaultValue: Expr | undefined;
      if (p.check("EQUAL")) {
        p.advance(); // consume '='
        defaultValue = p.parseExpr();
      }

      fields.push({
        name: fName,
        typeAnnotation: fType,
        defaultValue,
        isOptional: isOptional ? true : undefined,
        span: mergeSpans(fSpan, defaultValue ? defaultValue.span : fType.span),
      });

      if (p.check("COMMA")) {
        p.advance();
      } else {
        break;
      }
    }

    p.consumeStatementSeparator();
    if (!hasIndent) {
      break;
    }
  }

  let endSpan = p.current().span;
  if (hasIndent && p.check("DEDENT")) {
    endSpan = p.consume("DEDENT").span;
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

function typeExprToString(t: TypeExpr): string {
  switch (t.kind) {
    case "PrimitiveType":
      return t.primitive;
    case "NamedType":
      if (t.typeArgs && t.typeArgs.length > 0) {
        return `${t.name}[${t.typeArgs.map((a) => typeExprToString(a)).join(", ")}]`;
      }
      return t.name;
    case "ArrayType":
      return `[${typeExprToString(t.elementType)}]`;
    case "TupleType":
      return `[${t.elementTypes.map((e) => typeExprToString(e)).join(", ")}]`;
    case "OptionType":
      return `${typeExprToString(t.innerType)}?`;
    case "ResultType":
      return `Result[${typeExprToString(t.okType)}, ${typeExprToString(t.errType)}]`;
    case "RecordType": {
      const fields = t.fields.map((f) => `${f.name}: ${typeExprToString(f.type)}`).join(", ");
      return `{ ${fields} }`;
    }
    default:
      return "any";
  }
}

// Type Expressions
export function parseTypeExpr(p: ParserHost): TypeExpr {
  let type = parseBaseTypeExpr(p);
  if (p.check("QUESTION")) {
    const qSpan = p.advance().span;
    type = {
      kind: "OptionType",
      innerType: type,
      span: mergeSpans(type.span, qSpan),
    };
  }

  while (p.check("PIPE")) {
    p.advance(); // consume '|'
    const right = parseBaseTypeExpr(p);
    const leftName = typeExprToString(type);
    const rightName = typeExprToString(right);
    type = {
      kind: "NamedType",
      name: `${leftName} | ${rightName}`,
      span: mergeSpans(type.span, right.span),
    };
  }

  return type;
}

function parseBaseTypeExpr(p: ParserHost): TypeExpr {
  const tok = p.current();

  if (tok.kind === "ELLIPSIS") {
    p.advance();
    return {
      kind: "NamedType",
      name: "...",
      span: tok.span,
    };
  }

  if (tok.kind === "READONLY") {
    p.advance();
    return parseBaseTypeExpr(p);
  }
  if (tok.kind === "BOOLEAN") {
    p.advance();
    return {
      kind: "NamedType",
      name: tok.value,
      span: tok.span,
    };
  }

  if (tok.kind === "STRING") {
    p.advance();
    return {
      kind: "NamedType",
      name: `"${tok.value}"`,
      span: tok.span,
    };
  }

  if (tok.kind === "NUMBER") {
    p.advance();
    return {
      kind: "NamedType",
      name: tok.value,
      span: tok.span,
    };
  }

  if (tok.kind === "MINUS") {
    p.advance();
    const numTok = p.consume("NUMBER", "Expected number literal after '-' in type expression");
    return {
      kind: "NamedType",
      name: `-${numTok.value}`,
      span: mergeSpans(tok.span, numTok.span),
    };
  }

  if (tok.kind === "PLUS") {
    p.advance();
    const numTok = p.consume("NUMBER", "Expected number literal after '+' in type expression");
    return {
      kind: "NamedType",
      name: numTok.value,
      span: mergeSpans(tok.span, numTok.span),
    };
  }

  // 0. Primitive type sigils (!s, !i, !b, !f, !n, !v, !c, !y)
  if (tok.kind === "BANG") {
    p.advance(); // consume '!'
    const nextTok = p.current();
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
      const endSpan = p.advance().span;
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
    p.advance();
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
    p.advance();
    p.consume("LBRACKET", "Expected '[' after Result");
    const okType = parseTypeExpr(p);
    p.consume("COMMA", "Expected ',' between Result types");
    const errType = parseTypeExpr(p);
    const endSpan = p.consume("RBRACKET").span;
    return {
      kind: "ResultType",
      okType,
      errType,
      span: mergeSpans(tok.span, endSpan),
    };
  }

  // 3. Option[T]
  if (tok.kind === "OPTION") {
    p.advance();
    p.consume("LBRACKET", "Expected '[' after Option");
    const innerType = parseTypeExpr(p);
    const endSpan = p.consume("RBRACKET").span;
    return {
      kind: "OptionType",
      innerType,
      span: mergeSpans(tok.span, endSpan),
    };
  }

  // 4. Array Type: [TypeExpr] or Tuple Type: [T1, T2, ...]
  if (tok.kind === "LBRACKET") {
    p.advance();
    if (p.check("RBRACKET")) {
      const endSpan = p.advance().span;
      return {
        kind: "TupleType",
        elementTypes: [],
        span: mergeSpans(tok.span, endSpan),
      };
    }
    const firstType = parseTypeExpr(p);
    if (p.check("COMMA")) {
      const elementTypes: TypeExpr[] = [firstType];
      while (p.check("COMMA")) {
        p.advance(); // consume ','
        if (p.check("RBRACKET")) {
          break; // trailing comma, e.g. [int,] or [int, str,]
        }
        elementTypes.push(parseTypeExpr(p));
      }
      const endSpan = p.consume("RBRACKET", "Expected ']' after tuple type elements").span;
      return {
        kind: "TupleType",
        elementTypes,
        span: mergeSpans(tok.span, endSpan),
      };
    }
    const endSpan = p.consume("RBRACKET", "Expected ']' after array type").span;
    return {
      kind: "ArrayType",
      elementType: firstType,
      span: mergeSpans(tok.span, endSpan),
    };
  }

  // 5. Refinement Type or Record Type: { ... }
  if (tok.kind === "LBRACE") {
    p.advance();
    // Check if it's a refinement type { v:int | v >= 0 }
    if (
      p.isIdentOrKeyword(p.current()) &&
      (p.peek().kind === "COLON" || (p.peek().kind === "QUESTION" && p.peek(2).kind === "COLON"))
    ) {
      const idToken = p.advance();
      let isFirstOptional = false;
      if (p.check("QUESTION")) {
        p.advance();
        isFirstOptional = true;
      }
      p.advance(); // consume ':'
      const base = parseBaseTypeExpr(p);

      if (p.check("PIPE")) {
        if (base.kind === "PrimitiveType") {
          p.advance(); // consume '|'
          const predicate = p.parseExpr();
          const endSpan = p.consume("RBRACE").span;
          return {
            kind: "RefinementType",
            param: idToken.value,
            baseType: base,
            predicate,
            span: mergeSpans(tok.span, endSpan),
          };
        }
        let unionType: TypeExpr = base;
        while (p.check("PIPE")) {
          p.advance(); // consume '|'
          const right = parseBaseTypeExpr(p);
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
        while (p.check("COMMA")) {
          p.advance();
          if (p.check("RBRACE")) break;
          const fName = p.parseContextualIdentOrString("Expected field name");
          let isOptional = false;
          if (p.check("QUESTION")) {
            p.advance();
            isOptional = true;
          }
          p.consume("COLON");
          const fType = parseTypeExpr(p);
          fields.push({
            name: fName,
            type: fType,
            isOptional: isOptional ? true : undefined,
            span: mergeSpans(tok.span, fType.span),
          });
        }
        const endSpan = p.consume("RBRACE").span;
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

      while (p.check("COMMA")) {
        p.advance();
        if (p.check("RBRACE")) break;
        const fName = p.parseContextualIdentOrString("Expected field name");
        let isOptional = false;
        if (p.check("QUESTION")) {
          p.advance();
          isOptional = true;
        }
        p.consume("COLON");
        const fType = parseTypeExpr(p);
        fields.push({
          name: fName,
          type: fType,
          isOptional: isOptional ? true : undefined,
          span: mergeSpans(tok.span, fType.span),
        });
      }

      const endSpan = p.consume("RBRACE").span;
      return {
        kind: "RecordType",
        fields,
        span: mergeSpans(tok.span, endSpan),
      };
    }

    // Empty record {}
    const endSpan = p.consume("RBRACE").span;
    return {
      kind: "RecordType",
      fields: [],
      span: mergeSpans(tok.span, endSpan),
    };
  }

  // 6. Function Type: (a:int, b:str) => void or () => void or (...args: number[]) => number
  if (tok.kind === "LPAREN") {
    p.advance(); // consume '('
    const paramTypes: string[] = [];
    while (!p.check("RPAREN") && !p.check("EOF")) {
      let isRest = false;
      if (p.check("ELLIPSIS")) {
        p.advance();
        isRest = true;
      }

      let pName: string | undefined;
      if (
        (p.check("IDENT") || p.isContextualIdentifier(p.current())) &&
        (p.peek().kind === "COLON" || p.peek().kind === "QUESTION")
      ) {
        pName = p.advance().value;
        if (p.check("QUESTION")) {
          p.advance();
          pName += "?";
        }
        if (p.check("COLON")) p.advance();
      }

      const pt = parseTypeExpr(p);
      const ptName = typeExprToString(pt);
      if (isRest) {
        paramTypes.push(pName ? `...${pName}: ${ptName}` : `...${ptName}`);
      } else {
        paramTypes.push(pName ? `${pName}: ${ptName}` : ptName);
      }
      if (p.check("COMMA")) p.advance();
    }
    p.consume("RPAREN");
    if (p.check("FAT_ARROW") || p.check("ARROW")) {
      p.advance();
      const retType = parseTypeExpr(p);
      const retName = typeExprToString(retType);
      return {
        kind: "NamedType",
        name: `(${paramTypes.join(", ")}) => ${retName}`,
        span: mergeSpans(tok.span, retType.span),
      };
    }
    return {
      kind: "NamedType",
      name: `(${paramTypes.join(", ")})`,
      span: mergeSpans(tok.span, p.previous().span),
    };
  }

  // 7. Named Type: e.g. User, Map[str, int], or THREE.MeshBasicMaterial
  if (tok.kind === "IDENT" || p.isContextualIdentifier(tok)) {
    p.advance();
    let name = tok.value;
    let endSpan = tok.span;
    while (p.check("DOT") || p.check("COLON_COLON")) {
      const sep = p.check("COLON_COLON") ? "::" : ".";
      p.advance(); // consume '.' or '::'
      const nextTok = p.current();
      if (nextTok.kind === "IDENT" || p.isIdentOrKeyword(nextTok)) {
        p.advance();
        name += `${sep}${nextTok.value}`;
        endSpan = nextTok.span;
      } else {
        throw new ParserError(
          `Expected identifier after '${sep}' in type expression, got '${nextTok.kind}'`,
          nextTok.span,
        );
      }
    }
    const typeArgs: TypeExpr[] = [];
    if (p.check("LBRACKET")) {
      p.advance();
      while (!p.check("RBRACKET") && !p.check("EOF")) {
        typeArgs.push(parseTypeExpr(p));
        if (p.check("COMMA")) p.advance();
      }
      endSpan = p.consume("RBRACKET", "Expected ']' after type arguments").span;
    } else if (p.check("LT")) {
      p.advance();
      while (!p.check("GT") && !p.check("EOF")) {
        typeArgs.push(parseTypeExpr(p));
        if (p.check("COMMA")) p.advance();
      }
      endSpan = p.consume("GT", "Expected '>' after type arguments").span;
    }

    while (p.check("LBRACKET")) {
      p.advance();
      const indexType = parseTypeExpr(p);
      const endB = p.consume("RBRACKET", "Expected ']' after index type").span;
      endSpan = mergeSpans(endSpan, endB);
      name += `[${typeExprToString(indexType)}]`;
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

export function parseParamDecl(p: ParserHost, isClosure = false, allowUntyped = false): ParamDecl {
  const pSpan = p.current().span;
  let isRest = false;
  if (p.check("ELLIPSIS")) {
    p.advance();
    isRest = true;
  }
  let pName: string;

  if (p.check("LBRACKET")) {
    p.advance(); // consume '['
    const elements: string[] = [];
    while (!p.check("RBRACKET") && !p.check("EOF")) {
      if (p.check("COMMA")) {
        elements.push("");
        p.advance();
        continue;
      }
      const ident = p.parseContextualIdentOrString(
        "Expected parameter name in destructuring pattern",
      );
      let entry = ident;
      if (p.check("EQUAL")) {
        p.advance();
        const defExpr = p.parseExpr();
        const defStr = p.source
          ? p.source.slice(defExpr.span.start.offset, defExpr.span.end.offset)
          : "";
        entry += ` = ${defStr}`;
      }
      elements.push(entry);
      if (p.check("COMMA")) {
        p.advance();
      } else {
        break;
      }
    }
    p.consume("RBRACKET");
    pName = `[${elements.join(", ")}]`;
  } else if (p.check("LBRACE")) {
    p.advance(); // consume '{'
    const elements: string[] = [];
    while (!p.check("RBRACE") && !p.check("EOF")) {
      const field = p.parseContextualIdentOrString(
        "Expected property name in destructuring pattern",
      );
      let entry = field;
      if (p.check("COLON")) {
        p.advance();
        const alias = p.parseContextualIdentOrString("Expected alias name");
        entry = `${field}: ${alias}`;
      }
      if (p.check("EQUAL")) {
        p.advance();
        const defExpr = p.parseExpr();
        const defStr = p.source
          ? p.source.slice(defExpr.span.start.offset, defExpr.span.end.offset)
          : "";
        entry += ` = ${defStr}`;
      }
      elements.push(entry);
      if (p.check("COMMA")) {
        p.advance();
      } else {
        break;
      }
    }
    p.consume("RBRACE");
    pName = `{ ${elements.join(", ")} }`;
  } else {
    pName = p.parseContextualIdentOrString("Expected parameter name");
  }

  let isOptional = false;
  if (p.check("QUESTION")) {
    p.advance();
    isOptional = true;
  }

  let pType: TypeExpr | null = null;
  if (p.check("COLON")) {
    p.advance();
    pType = parseTypeExpr(p);
  } else if (
    isClosure ||
    allowUntyped ||
    pName === "self" ||
    pName === "cls" ||
    pName === "this" ||
    pName.startsWith("[") ||
    pName.startsWith("{")
  ) {
    if (allowUntyped || (!isClosure && (pName === "self" || pName === "cls" || pName === "this"))) {
      pType = {
        kind: "NamedType",
        name: "any",
        span: pSpan,
      };
    }
  } else {
    p.consume("COLON", "Expected ':' after parameter name");
    pType = parseTypeExpr(p);
  }

  let defaultValue: Expr | undefined;
  if (p.check("EQUAL")) {
    p.advance();
    defaultValue = p.parseExpr();
  }

  return {
    name: pName,
    typeAnnotation: pType,
    defaultValue,
    isOptional: isOptional ? true : undefined,
    isRest: isRest ? true : undefined,
    span: mergeSpans(
      pSpan,
      defaultValue ? defaultValue.span : pType ? pType.span : p.previous().span,
    ),
  };
}

// Function Declarations
function parseFunctionDecl(p: ParserHost, isExported = false): FunctionDecl {
  const startSpan = p.current().span;
  let isAsync = false;
  if (p.check("ASYNC")) {
    isAsync = true;
    p.advance();
  }
  p.consume("FN");

  const name = p.parseContextualIdentOrString("Expected function name");
  p.consume("LPAREN", "Expected '(' after function name");

  const params: ParamDecl[] = [];
  while (!p.check("RPAREN") && !p.check("EOF")) {
    params.push(parseParamDecl(p, false, true));
    if (p.check("COMMA")) {
      p.advance();
    } else {
      break;
    }
  }
  p.consume("RPAREN");

  // Optional return type: -> ReturnType
  let returnType: TypeExpr | null = null;
  if (p.check("ARROW")) {
    p.advance();
    returnType = parseTypeExpr(p);
  }

  // Expression-bodied function: fn add(a:int, b:int) -> int = a + b or fn add(a:int, b:int) => a + b
  if (p.check("EQUAL") || p.check("FAT_ARROW")) {
    p.advance();
    let hasIndent = false;
    p.consumeStatementSeparator();
    if (p.check("INDENT")) {
      p.advance();
      hasIndent = true;
    }
    p.consumeStatementSeparator();
    const body = p.parseExpr();
    p.consumeStatementSeparator();
    if (hasIndent && p.check("DEDENT")) {
      p.advance();
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
  if (p.check("COLON")) {
    p.advance();
    p.consumeStatementSeparator();
  } else if (!p.check("LBRACE")) {
    throw new ParserError("Expected ':', '=', or '{' before function body", p.current().span);
  }
  const body = p.parseBlock();

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
function parseClassDecl(p: ParserHost, isExported = false): ClassDecl {
  const startSpan = p.current().span;
  p.consume("CLASS", "Expected 'class' keyword");

  const name = p.parseContextualIdentOrString("Expected class name");
  const typeParams: string[] = [];
  if (p.check("LBRACKET")) {
    p.advance();
    while (!p.check("RBRACKET") && !p.check("EOF")) {
      typeParams.push(p.parseContextualIdentOrString("Expected type parameter"));
      if (p.check("COMMA")) p.advance();
      else break;
    }
    p.consume("RBRACKET", "Expected ']' after type parameters");
  }

  let primaryConstructor: ParamDecl[] | undefined;
  if (p.check("LPAREN")) {
    p.advance();
    primaryConstructor = [];
    while (!p.check("RPAREN") && !p.check("EOF")) {
      const pSpan = p.current().span;
      let isPub = false;
      let isReadonly = false;
      let isMut = false;
      if (p.check("PUB")) {
        isPub = true;
        p.advance();
      }
      if (p.check("READONLY")) {
        isReadonly = true;
        p.advance();
      } else if (p.check("MUT")) {
        isMut = true;
        p.advance();
      }
      let isRest = false;
      if (p.check("ELLIPSIS")) {
        p.advance();
        isRest = true;
      }
      const pName = p.parseContextualIdentOrString("Expected parameter name");
      let isOptional = false;
      if (p.check("QUESTION")) {
        p.advance();
        isOptional = true;
      }
      let pType: TypeExpr | null = null;
      if (p.check("COLON")) {
        p.advance();
        pType = parseTypeExpr(p);
      } else if (!p.check("EQUAL")) {
        p.consume("COLON", "Expected ':' after parameter name");
        pType = parseTypeExpr(p);
      }

      let defaultValue: Expr | undefined;
      if (p.check("EQUAL")) {
        p.advance();
        defaultValue = p.parseExpr();
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
          defaultValue ? defaultValue.span : pType ? pType.span : p.previous().span,
        ),
      });

      if (p.check("COMMA")) {
        p.advance();
      } else {
        break;
      }
    }
    p.consume("RPAREN", "Expected ')' after primary constructor parameters");
  }

  let extendsName: string | undefined;
  if (p.check("EXTENDS")) {
    p.advance();
    extendsName = p.parseContextualIdentOrString("Expected base class name after 'extends'");
    while (p.check("DOT") || p.check("COLON_COLON")) {
      const sep = p.check("COLON_COLON") ? "::" : ".";
      p.advance();
      extendsName += `${sep}${p.parseContextualIdentOrString(`Expected identifier after '${sep}' in extends clause`)}`;
    }
  }
  const implementsList: string[] = [];
  if (p.check("IMPLEMENTS")) {
    p.advance();
    while (!p.check("COLON") && !p.check("EOF") && !p.check("NEWLINE")) {
      implementsList.push(p.parseContextualIdentOrString("Expected interface name"));
      if (p.check("COMMA")) p.advance();
      else break;
    }
  }

  let hasBody = false;
  if (p.check("COLON")) {
    p.advance();
    p.consumeStatementSeparator();
    hasBody = true;
  } else if (p.check("LBRACE")) {
    hasBody = true;
  } else if (!primaryConstructor) {
    throw new ParserError("Expected ':' or '{' after class header", p.current().span);
  }

  const properties: PropertyDecl[] = [];
  const methods: MethodDecl[] = [];
  const staticBlocks: Block[] = [];

  if (hasBody) {
    const hasIndent = p.check("INDENT");
    const hasBrace = p.check("LBRACE");
    if (hasIndent) {
      p.advance();
    } else if (hasBrace) {
      p.advance();
    }

    while (!p.check("EOF")) {
      p.consumeStatementSeparator();
      if (hasIndent && (p.check("DEDENT") || p.check("EOF"))) break;
      if (hasBrace && (p.check("RBRACE") || p.check("EOF"))) break;
      if (!hasIndent && !hasBrace && (p.check("NEWLINE") || p.check("EOF"))) break;

      if ((p.check("IDENT") && p.current().value === "pass") || p.check("ELLIPSIS")) {
        p.advance();
        p.consumeStatementSeparator();
        continue;
      }

      let isStatic = false;
      let isReadonly = false;
      let isAsync = false;
      let hasPropKeyword = false;

      while (
        p.check("PUB") ||
        p.check("STATIC") ||
        p.check("READONLY") ||
        p.check("ASYNC") ||
        p.check("PROP") ||
        (p.check("IDENT") &&
          (p.current().value === "prv" ||
            p.current().value === "private" ||
            p.current().value === "public" ||
            p.current().value === "protected") &&
          p.peek(1).kind !== "COLON" &&
          p.peek(1).kind !== "EQUAL" &&
          p.peek(1).kind !== "LPAREN")
      ) {
        if (p.check("PUB")) {
          p.advance();
        } else if (p.check("STATIC")) {
          isStatic = true;
          p.advance();
        } else if (p.check("READONLY")) {
          isReadonly = true;
          p.advance();
        } else if (p.check("ASYNC")) {
          isAsync = true;
          p.advance();
        } else if (p.check("PROP")) {
          hasPropKeyword = true;
          p.advance();
        } else {
          p.advance();
        }
      }

      if (
        isStatic &&
        !isReadonly &&
        !isAsync &&
        !hasPropKeyword &&
        (p.check("COLON") || p.check("LBRACE"))
      ) {
        if (p.check("COLON")) p.advance();
        p.consumeStatementSeparator();
        const block = p.parseBlock();
        staticBlocks.push(block);
        p.consumeStatementSeparator();
        continue;
      }

      const isAccessor =
        p.check("IDENT") &&
        (p.current().value === "get" || p.current().value === "set") &&
        (p.isIdentOrKeyword(p.peek()) || p.peek().kind === "STRING");

      const isMethodWithoutFn =
        (isAsync || isStatic) && p.isIdentOrKeyword(p.current()) && p.peek().kind === "LPAREN";

      if (p.check("FN") || isAccessor || isMethodWithoutFn) {
        const accessor = isAccessor ? (p.current().value as "get" | "set") : undefined;
        const method = parseMethodDecl(p, isStatic, isAsync, accessor);
        methods.push(method);
      } else if (hasPropKeyword || p.isIdentOrKeyword(p.current()) || p.check("STRING")) {
        const prop = parsePropertyDecl(p, isStatic, isReadonly, hasPropKeyword);
        properties.push(prop);
        while (p.check("COMMA")) {
          p.advance();
          const nextProp = parsePropertyDecl(p, isStatic, isReadonly, hasPropKeyword);
          properties.push(nextProp);
        }
      } else {
        throw new ParserError(
          `Unexpected token '${p.current().kind}' (${p.current().value}) in class body`,
          p.current().span,
        );
      }
      p.consumeStatementSeparator();
    }

    if (hasIndent && p.check("DEDENT")) {
      p.advance();
    } else if (hasBrace && p.check("RBRACE")) {
      p.advance();
    }
  }

  const endSpan = p.current().span;
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
    span: createSpan(p.file, startSpan.start, endSpan.end),
  };
}

function parsePropertyDecl(
  p: ParserHost,
  isStatic: boolean,
  isReadonly: boolean,
  hasPropKeyword: boolean = false,
): PropertyDecl {
  const startSpan = p.current().span;
  let lastSpan: Span = startSpan;
  const name = p.parseContextualIdentOrString("Expected property name");
  let aliases: string[] | undefined;
  let typeAnnotation: TypeExpr | undefined;
  let initialValue: Expr | undefined;

  // Check for alias: prop X, x: type = init or X, x: type = init
  if (
    p.check("COMMA") &&
    (hasPropKeyword ||
      (p.isIdentOrKeyword(p.peek()) &&
        (p.peek(2).kind === "COLON" || p.peek(2).kind === "EQUAL" || p.peek(2).kind === "COMMA")))
  ) {
    p.advance();
    const aliasName = p.parseContextualIdentOrString("Expected property alias");
    lastSpan = p.previous().span;
    if (!aliases) aliases = [];
    aliases.push(aliasName);
    while (
      p.check("COMMA") &&
      (hasPropKeyword ||
        (p.isIdentOrKeyword(p.peek()) &&
          (p.peek(2).kind === "COLON" || p.peek(2).kind === "EQUAL" || p.peek(2).kind === "COMMA")))
    ) {
      p.advance();
      const nextAlias = p.parseContextualIdentOrString("Expected property alias");
      lastSpan = p.previous().span;
      if (!aliases) aliases = [];
      aliases.push(nextAlias);
    }
  }

  let isOptional = false;
  if (p.check("QUESTION")) {
    p.advance();
    isOptional = true;
  }

  if (p.check("COLON")) {
    p.advance();
    typeAnnotation = parseTypeExpr(p);
    lastSpan = typeAnnotation.span;
  }

  // Also support: prop X: type, x
  if (hasPropKeyword && !aliases && p.check("COMMA")) {
    p.advance();
    const aliasName = p.parseContextualIdentOrString("Expected property alias");
    lastSpan = p.previous().span;
    if (!aliases) aliases = [];
    aliases.push(aliasName);
    while (p.check("COMMA")) {
      p.advance();
      const nextAlias = p.parseContextualIdentOrString("Expected property alias");
      lastSpan = p.previous().span;
      if (!aliases) aliases = [];
      aliases.push(nextAlias);
    }
  }

  if (p.check("EQUAL")) {
    p.advance();
    initialValue = p.parseExpr();
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

function parseMethodDecl(
  p: ParserHost,
  isStatic: boolean,
  isAsync: boolean,
  accessor?: "get" | "set",
): MethodDecl {
  const startSpan = p.current().span;
  if (accessor) {
    p.advance(); // consume 'get' or 'set'
  } else if (p.check("FN")) {
    p.consume("FN");
  }

  let name: string;
  if (p.check("LBRACKET")) {
    p.advance();
    let inner = "";
    while (!p.check("RBRACKET") && !p.check("EOF")) {
      inner += p.advance().value;
    }
    p.consume("RBRACKET");
    name = `[${inner}]`;
  } else {
    name = p.parseContextualIdentOrString("Expected method or accessor name");
  }

  const params: ParamDecl[] = [];
  if (p.check("LPAREN")) {
    p.advance(); // consume '('
    while (!p.check("RPAREN") && !p.check("EOF")) {
      params.push(parseParamDecl(p, false, true));
      if (p.check("COMMA")) {
        p.advance();
      } else {
        break;
      }
    }
    p.consume("RPAREN");
  }

  let returnType: TypeExpr | null = null;
  if (p.check("ARROW")) {
    p.advance();
    returnType = parseTypeExpr(p);
  }

  if (p.check("EQUAL") || p.check("FAT_ARROW")) {
    p.advance();
    let hasIndent = false;
    p.consumeStatementSeparator();
    if (p.check("INDENT")) {
      p.advance();
      hasIndent = true;
    }
    p.consumeStatementSeparator();
    const body = p.parseExpr();
    p.consumeStatementSeparator();
    if (hasIndent && p.check("DEDENT")) {
      p.advance();
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

  if (p.check("COLON")) {
    p.advance();
    p.consumeStatementSeparator();
  } else if (!p.check("LBRACE")) {
    throw new ParserError("Expected ':', '=', or '{' before method body", p.current().span);
  }
  const body = p.parseBlock();

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

function parseConstDecl(p: ParserHost, isExported = false): ConstDecl {
  const startSpan = p.current().span;
  p.consume("CONST");
  const name = p.parseContextualIdentOrString("Expected constant identifier");

  let typeAnnotation: TypeExpr | undefined;
  if (p.check("COLON")) {
    p.advance();
    typeAnnotation = parseTypeExpr(p);
  }

  p.consume("EQUAL", "Expected '=' in const declaration");
  const value = p.parseExpr();

  return {
    kind: "ConstDecl",
    name,
    isExported,
    typeAnnotation,
    value,
    span: mergeSpans(startSpan, value.span),
  };
}

function parseVarDecl(p: ParserHost, isExported = false): VarDecl {
  const startSpan = p.current().span;
  let isMut = false;
  let name: string;
  let typeAnnotation: TypeExpr | undefined;

  if (p.check("COLON_EQUAL") || p.check("COLON_COLON_EQUAL")) {
    isMut = p.advance().kind === "COLON_COLON_EQUAL";
    name = p.parseContextualIdentOrString("Expected variable identifier");
    if (p.check("COLON")) {
      p.advance();
      typeAnnotation = parseTypeExpr(p);
    }
    if (p.check("COLON_EQUAL") || p.check("COLON_COLON_EQUAL")) {
      p.advance();
    } else {
      p.consume("EQUAL", "Expected '=' in variable declaration");
    }
  } else if (p.check("LET")) {
    p.advance();
    if (p.check("MUT") && p.peek(1).kind !== "EQUAL" && p.peek(1).kind !== "COLON") {
      p.advance();
      isMut = true;
    }
    name = p.parseContextualIdentOrString("Expected variable identifier");
    if (p.check("COLON")) {
      p.advance();
      typeAnnotation = parseTypeExpr(p);
    }
    p.consume("EQUAL", "Expected '=' in variable declaration");
  } else if (
    p.check("VAL") &&
    p.peek(1).kind !== "COLON_EQUAL" &&
    p.peek(1).kind !== "COLON_COLON_EQUAL" &&
    !(p.peek(1).kind === "COLON" && p.isTypedDeclarationAhead())
  ) {
    p.advance();
    isMut = false;
    name = p.parseContextualIdentOrString("Expected variable identifier");
    if (p.check("COLON")) {
      p.advance();
      typeAnnotation = parseTypeExpr(p);
    }
    p.consume("EQUAL", "Expected '=' in variable declaration");
  } else if (
    p.check("MUT") &&
    p.peek(1).kind !== "COLON_EQUAL" &&
    p.peek(1).kind !== "COLON_COLON_EQUAL" &&
    p.peek(1).kind !== "EQUAL" &&
    !(p.peek(1).kind === "COLON" && p.isTypedDeclarationAhead())
  ) {
    p.advance();
    isMut = true;
    name = p.parseContextualIdentOrString("Expected variable identifier");
    if (p.check("COLON")) {
      p.advance();
      typeAnnotation = parseTypeExpr(p);
    }
    if (p.check("COLON_EQUAL") || p.check("COLON_COLON_EQUAL")) {
      p.advance();
    } else {
      p.consume("EQUAL", "Expected '=' in variable declaration");
    }
  } else {
    name = p.parseContextualIdentOrString("Expected variable identifier");
    if (p.check("COLON_EQUAL")) {
      p.advance();
      isMut = false;
    } else if (p.check("COLON_COLON_EQUAL")) {
      p.advance();
      isMut = true;
    } else if (p.check("COLON")) {
      p.advance();
      typeAnnotation = parseTypeExpr(p);
      if (p.check("COLON_COLON_EQUAL")) {
        p.advance();
        isMut = true;
      } else if (p.check("COLON_EQUAL")) {
        p.advance();
        isMut = false;
      } else if (p.check("EQUAL")) {
        p.advance();
        isMut = false;
      } else {
        throw new ParserError(
          "Expected ':=', '::=', or '=' after type annotation in variable declaration",
          p.current().span,
        );
      }
    } else {
      throw new ParserError(
        "Expected ':=', '::=', or ':' in variable declaration",
        p.current().span,
      );
    }
  }

  const value = p.parseExpr();
  p.consumeStatementSeparator();

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
