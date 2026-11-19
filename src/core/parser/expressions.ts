/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pratt expression parser (prefix, infix, postfix, ternary, closures, and arrow-function lookahead).
 */

import type {
  AssignOp,
  BinaryOp,
  Block,
  ClosureExpr,
  ConditionalExpr,
  Expr,
  ParamDecl,
  RecordProperty,
  TypeExpr,
} from "../ast.js";
import { mergeSpans, type Span } from "../span.js";
import type { TokenKind } from "../tokens.js";
import { ParserError, type ParserHost, PRECEDENCES, Precedence } from "./core.js";

// Pratt Expression Parsing
export function parseExpr(p: ParserHost, precedence = Precedence.LOWEST): Expr {
  let left = parsePrefix(p);

  while (precedence < currentPrecedence(p)) {
    left = parseInfix(p, left);
  }

  return left;
}

function currentPrecedence(p: ParserHost): Precedence {
  const cur = p.current();
  if (cur.kind === "QUESTION" && isTernaryQuestion(p)) {
    return Precedence.TERNARY;
  }
  if (cur.kind === "PLUS_PLUS" || cur.kind === "MINUS_MINUS") {
    if (p.cursor > 0 && cur.span.start.line === p.previous().span.end.line) {
      return Precedence.POSTFIX;
    }
    return Precedence.LOWEST;
  }
  if (cur.kind === "TEMPLATE_NO_SUBST" || cur.kind === "TEMPLATE_HEAD") {
    if (p.cursor > 0 && cur.span.start.line === p.previous().span.end.line) {
      return Precedence.POSTFIX;
    }
    return Precedence.LOWEST;
  }
  return PRECEDENCES[cur.kind] ?? Precedence.LOWEST;
}

function isTernaryQuestion(p: ParserHost): boolean {
  if (p.current().kind !== "QUESTION") return false;
  const firstAfter = p.peek(1).kind;
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
    firstAfter === "COLON_COLON" ||
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
  for (let i = p.cursor + 1; i < p.tokens.length; i++) {
    const k = p.tokens[i].kind;
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
        const afterColon = p.tokens[i + 1]?.kind ?? "EOF";
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

function parsePrefix(p: ParserHost): Expr {
  const tok = p.current();

  // 1. Literal Expressions
  if (tok.kind === "NUMBER") {
    p.advance();
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
    p.advance();
    return {
      kind: "LiteralExpr",
      literalKind: "string",
      value: tok.value,
      rawValue: tok.kind === "HEX_COLOR" ? `"${tok.value}"` : `"${tok.value}"`,
      span: tok.span,
    };
  }

  if (tok.kind === "BOOLEAN") {
    p.advance();
    return {
      kind: "LiteralExpr",
      literalKind: "boolean",
      value: tok.value === "true",
      rawValue: tok.value,
      span: tok.span,
    };
  }

  if (tok.kind === "NIL") {
    p.advance();
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
    p.advance();
    return {
      kind: "TemplateLiteralExpr",
      quasis: [tok.value],
      expressions: [],
      span: tok.span,
    };
  }

  if (tok.kind === "TEMPLATE_HEAD") {
    const startSpan = tok.span;
    p.advance();
    const quasis: string[] = [tok.value];
    const expressions: Expr[] = [];

    expressions.push(parseExpr(p));

    while (p.check("TEMPLATE_MIDDLE")) {
      const mid = p.advance();
      quasis.push(mid.value);
      expressions.push(parseExpr(p));
    }

    const tail = p.consume("TEMPLATE_TAIL", "Expected closing '`' for template literal");
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
    p.advance();
    const operand = parseExpr(p, Precedence.PREFIX);
    return {
      kind: "AwaitExpr",
      operand,
      span: mergeSpans(tok.span, operand.span),
    };
  }

  // 2b. Async Function / Closure Expression: async fn(...)
  if (
    (tok.kind === "ASYNC" || (tok.kind === "IDENT" && tok.value === "async")) &&
    p.peek().kind === "FN"
  ) {
    p.advance(); // consume async
    return parseClosureExpr(p, tok.span, true);
  }

  // Arrow function: x => expr
  if ((tok.kind === "IDENT" || p.isContextualIdentifier(tok)) && p.peek().kind === "FAT_ARROW") {
    p.advance();
    const paramName = tok.value;
    const paramSpan = tok.span;
    p.consume("FAT_ARROW");
    let hasIndent = false;
    p.consumeStatementSeparator();
    if (p.check("INDENT")) {
      p.advance();
      hasIndent = true;
    }
    p.consumeStatementSeparator();
    const body = parseExpr(p);
    p.consumeStatementSeparator();
    if (hasIndent && p.check("DEDENT")) {
      p.advance();
    }
    return {
      kind: "ClosureExpr",
      params: [{ name: paramName, typeAnnotation: null, span: paramSpan }],
      returnType: null,
      body,
      span: mergeSpans(paramSpan, body.span),
    };
  }

  if (
    tok.kind === "IDENT" ||
    tok.kind === "IMPORT" ||
    tok.kind === "TYPE_VOID" ||
    p.isContextualIdentifier(tok)
  ) {
    p.advance();
    return {
      kind: "IdentifierExpr",
      name: tok.value,
      span: tok.span,
    };
  }

  // 3. Unary Operators (-, +, ~, ++, --, not, !, ...)
  if (
    tok.kind === "MINUS" ||
    tok.kind === "PLUS" ||
    tok.kind === "TILDE" ||
    tok.kind === "PLUS_PLUS" ||
    tok.kind === "MINUS_MINUS" ||
    tok.kind === "NOT" ||
    tok.kind === "BANG" ||
    tok.kind === "ELLIPSIS"
  ) {
    if (
      tok.kind === "ELLIPSIS" &&
      (p.peek(1).kind === "NEWLINE" ||
        p.peek(1).kind === "SEMICOLON" ||
        p.peek(1).kind === "EOF" ||
        p.peek(1).kind === "DEDENT" ||
        p.peek(1).kind === "RPAREN" ||
        p.peek(1).kind === "RBRACE" ||
        p.peek(1).kind === "RBRACKET" ||
        p.peek(1).kind === "COMMA")
    ) {
      p.advance();
      return {
        kind: "LiteralExpr",
        literalKind: "string",
        value: "...",
        rawValue: '"..."',
        span: tok.span,
      };
    }
    p.advance();
    const op =
      tok.kind === "MINUS"
        ? "-"
        : tok.kind === "PLUS"
          ? "+"
          : tok.kind === "TILDE"
            ? "~"
            : tok.kind === "PLUS_PLUS"
              ? "++"
              : tok.kind === "MINUS_MINUS"
                ? "--"
                : tok.kind === "BANG"
                  ? "!"
                  : tok.kind === "ELLIPSIS"
                    ? "..."
                    : "not";
    const operand = parseExpr(p, Precedence.PREFIX);
    return {
      kind: "UnaryExpr",
      operator: op,
      operand,
      span: mergeSpans(tok.span, operand.span),
    };
  }

  // 4. Grouped Expression or Arrow Function: ( expr ) or ( a, b ) => expr
  if (tok.kind === "LPAREN") {
    if (isArrowFunction(p)) {
      p.advance(); // consume LPAREN
      const params: ParamDecl[] = [];
      while (!p.check("RPAREN") && !p.check("EOF")) {
        params.push(p.parseParamDecl(true));
        if (p.check("COMMA")) {
          p.advance();
        } else {
          break;
        }
      }
      p.consume("RPAREN");

      let returnType: TypeExpr | null = null;
      if (p.check("ARROW")) {
        p.advance();
        returnType = p.parseTypeExpr();
      }

      p.consume("FAT_ARROW");

      let hasIndent = false;
      p.consumeStatementSeparator();
      if (p.check("INDENT")) {
        p.advance();
        hasIndent = true;
      }
      p.consumeStatementSeparator();
      let body: Expr | Block;
      if (p.check("COLON") || p.check("LBRACE")) {
        if (p.check("COLON")) p.advance();
        body = p.parseBlock();
      } else {
        body = parseExpr(p);
      }
      p.consumeStatementSeparator();
      if (hasIndent && p.check("DEDENT")) {
        p.advance();
      }

      return {
        kind: "ClosureExpr",
        params,
        returnType,
        body,
        span: mergeSpans(tok.span, body.span),
      };
    }

    p.advance();
    const expr = parseExpr(p);
    const endSpan = p.consume("RPAREN").span;
    return {
      ...expr,
      span: mergeSpans(tok.span, endSpan),
    };
  }

  // 5. Array Literal: [ item1, item2, ...spread ]
  if (tok.kind === "LBRACKET") {
    p.advance();
    const elements: Expr[] = [];
    while (!p.check("RBRACKET") && !p.check("EOF")) {
      elements.push(parseExpr(p));
      if (p.check("COMMA")) p.advance();
    }
    const endSpan = p.consume("RBRACKET").span;
    return {
      kind: "ArrayLiteralExpr",
      elements,
      span: mergeSpans(tok.span, endSpan),
    };
  }

  // 6. Record Literal: { key: value, ... } or shorthand { key, ... } or spread { ...expr, ... }
  if (tok.kind === "LBRACE") {
    p.advance();
    const properties: RecordProperty[] = [];
    while (!p.check("RBRACE") && !p.check("EOF")) {
      if (p.check("ELLIPSIS")) {
        const spreadTok = p.advance();
        const target = parseExpr(p);
        properties.push({
          isSpread: true,
          value: target,
          span: mergeSpans(spreadTok.span, target.span),
        });
        if (p.check("COMMA") || p.check("SEMICOLON") || p.check("NEWLINE")) p.advance();
        continue;
      }

      const kSpan = p.current().span;
      const key = p.parsePropertyKey("Expected property key in record literal");
      let val: Expr;
      let pSpan = kSpan;
      if (p.check("COLON")) {
        p.advance();
        val = parseExpr(p);
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
      if (p.check("COMMA") || p.check("SEMICOLON") || p.check("NEWLINE")) p.advance();
    }
    const endSpan = p.consume("RBRACE").span;
    return {
      kind: "RecordLiteralExpr",
      properties,
      span: mergeSpans(tok.span, endSpan),
    };
  }

  // 7. Anonymous Function / Closure: fn(params) -> Type = expr
  if (tok.kind === "FN") {
    if (p.isClosureAhead()) {
      return parseClosureExpr(p, tok.span, false);
    }
    p.advance();
    return {
      kind: "IdentifierExpr",
      name: tok.value,
      span: tok.span,
    };
  }

  throw new ParserError(`Unexpected expression token '${tok.kind}' (${tok.value})`, tok.span);
}

function parseInfix(p: ParserHost, left: Expr): Expr {
  const tok = p.current();

  // 1. C-style ternary (cond ? thenExpr : elseExpr) or Postfix ? operator (Try unwrap Result/Option)
  if (tok.kind === "QUESTION") {
    if (isTernaryQuestion(p)) {
      p.advance(); // consume '?'
      const whenTrue = parseExpr(p, Precedence.LOWEST);
      p.consume("COLON", "Expected ':' in ternary expression");
      const whenFalse = parseExpr(p, Precedence.TERNARY - 1);
      const condExpr: ConditionalExpr = {
        kind: "ConditionalExpr",
        condition: left,
        whenTrue,
        whenFalse,
        span: mergeSpans(left.span, whenFalse.span),
      };
      return condExpr;
    }
    p.advance();
    return {
      kind: "PostfixTryExpr",
      operand: left,
      span: mergeSpans(left.span, tok.span),
    };
  }

  // 1b. Postfix ++ / --
  if (tok.kind === "PLUS_PLUS" || tok.kind === "MINUS_MINUS") {
    p.advance();
    return {
      kind: "UnaryExpr",
      operator: tok.kind === "PLUS_PLUS" ? "++" : "--",
      isPostfix: true,
      operand: left,
      span: mergeSpans(left.span, tok.span),
    };
  }

  // 1c. Tagged Template Literal: tag`...`
  if (tok.kind === "TEMPLATE_NO_SUBST" || tok.kind === "TEMPLATE_HEAD") {
    const tplExpr = parsePrefix(p);
    return {
      kind: "CallExpr",
      callee: left,
      args: [tplExpr],
      isTaggedTemplate: true,
      span: mergeSpans(left.span, tplExpr.span),
    };
  }

  // 2. Optional Function Call: expr?.(arg1, arg2)
  if (tok.kind === "QUESTION_DOT" && p.peek(1).kind === "LPAREN") {
    p.advance(); // consume '?.'
    p.advance(); // consume '('
    const args: Expr[] = [];
    while (!p.check("RPAREN") && !p.check("EOF")) {
      args.push(parseExpr(p));
      if (p.check("COMMA")) p.advance();
    }
    const endSpan = p.consume("RPAREN").span;
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
    p.advance();
    const args: Expr[] = [];
    while (!p.check("RPAREN") && !p.check("EOF")) {
      args.push(parseExpr(p));
      if (p.check("COMMA")) p.advance();
    }
    const endSpan = p.consume("RPAREN").span;
    return {
      kind: "CallExpr",
      callee: left,
      args,
      span: mergeSpans(left.span, endSpan),
    };
  }

  // 3. Member Access: expr.prop, expr::prop, or expr?.prop
  if (tok.kind === "DOT" || tok.kind === "COLON_COLON" || tok.kind === "QUESTION_DOT") {
    const isSafeNav = tok.kind === "QUESTION_DOT";
    const isScopeAccess = tok.kind === "COLON_COLON";
    p.advance();
    const propName = p.parseContextualIdentOrString("Expected property identifier after '.'");
    return {
      kind: "MemberAccessExpr",
      object: left,
      property: propName,
      isSafeNav,
      ...(isScopeAccess ? { isScopeAccess: true } : {}),
      span: mergeSpans(left.span, p.previous().span),
    };
  }

  // 4. Indexing: expr[index]
  if (tok.kind === "LBRACKET") {
    p.advance();
    const index = parseExpr(p);
    const endSpan = p.consume("RBRACKET").span;
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
    const op = p.advance().value as AssignOp;
    const value = parseExpr(p, Precedence.ASSIGN - 1);
    return {
      kind: "AssignExpr",
      target: left,
      op,
      value,
      span: mergeSpans(left.span, value.span),
    };
  }

  // 6. Binary Operations: +, -, *, /, %, **, &, |, ^, <<, >>, >>>, ==, !=, and, or, ??
  const prec = currentPrecedence(p);
  p.advance();

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

  const right = tok.kind === "STAR_STAR" ? parseExpr(p, prec - 1) : parseExpr(p, prec);
  return {
    kind: "BinaryExpr",
    operator: op,
    left,
    right,
    span: mergeSpans(left.span, right.span),
  };
}

export function parsePrimary(p: ParserHost): Expr {
  return parsePrefix(p);
}

function parseClosureExpr(p: ParserHost, startSpan: Span, isAsync = false): ClosureExpr {
  p.consume("FN");
  p.consume("LPAREN");
  const params: ParamDecl[] = [];
  while (!p.check("RPAREN") && !p.check("EOF")) {
    params.push(p.parseParamDecl(true));
    if (p.check("COMMA")) {
      p.advance();
    } else {
      break;
    }
  }
  p.consume("RPAREN");

  let returnType: TypeExpr | null = null;
  if (p.check("ARROW")) {
    p.advance();
    returnType = p.parseTypeExpr();
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
    const body = parseExpr(p);
    p.consumeStatementSeparator();
    if (hasIndent && p.check("DEDENT")) {
      p.advance();
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

  if (!p.check("COLON") && !p.check("LBRACE")) {
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
      span: mergeSpans(startSpan, p.previous().span),
    };
  }

  if (p.check("COLON")) {
    p.advance();
    p.consumeStatementSeparator();
  }
  const body = p.parseBlock();
  return {
    kind: "ClosureExpr",
    isAsync: isAsync || undefined,
    params,
    returnType,
    body,
    span: mergeSpans(startSpan, body.span),
  };
}

function isArrowFunction(p: ParserHost): boolean {
  if (!p.check("LPAREN")) return false;
  let parenDepth = 0;
  let i = p.cursor;
  while (i < p.tokens.length) {
    const t = p.tokens[i];
    if (t.kind === "LPAREN") {
      parenDepth++;
    } else if (t.kind === "RPAREN") {
      parenDepth--;
      if (parenDepth === 0) {
        const next = p.tokens[i + 1];
        if (!next) return false;
        if (next.kind === "FAT_ARROW") {
          return true;
        }
        if (next.kind === "ARROW") {
          let j = i + 2;
          let typeParen = 0;
          let typeBracket = 0;
          while (j < p.tokens.length) {
            const tt = p.tokens[j];
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
