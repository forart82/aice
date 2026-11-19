/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Block, statement, destructuring, and control-flow (if/match/for/while/try/return/throw/break/continue) parsing.
 */

import type {
  ArrayLiteralExpr,
  AssignOp,
  Block,
  BreakStmt,
  ContinueStmt,
  Expr,
  ForStmt,
  IfStmt,
  LetBinding,
  LiteralExpr,
  MatchCase,
  MatchStmt,
  Pattern,
  Statement,
  ThrowStmt,
  TryStmt,
  TypeExpr,
  WhileStmt,
} from "../ast.js";
import { createSpan, emptySpan, mergeSpans, type Span } from "../span.js";
import { ParserError, type ParserHost } from "./core.js";

// Block Parsing
export function parseBlock(p: ParserHost): Block {
  const startPos = p.current().span.start;
  const statements: Statement[] = [];

  if (p.check("INDENT")) {
    p.advance(); // consume INDENT
    p.consumeStatementSeparator();

    while (!p.check("DEDENT") && !p.check("EOF")) {
      const stmt = parseStatement(p);
      if (stmt) {
        statements.push(stmt);
      }
      p.consumeStatementSeparator();
    }

    const endSpan = p.consume("DEDENT").span;
    return {
      kind: "Block",
      statements,
      span: createSpan(p.file, startPos, endSpan.end),
    };
  }

  if (p.check("LBRACE")) {
    p.advance(); // consume '{'
    p.consumeStatementSeparator();

    while (!p.check("RBRACE") && !p.check("EOF")) {
      const stmt = parseStatement(p);
      if (stmt) {
        statements.push(stmt);
      }
      p.consumeStatementSeparator();
    }

    const endSpan = p.consume("RBRACE").span;
    return {
      kind: "Block",
      statements,
      span: createSpan(p.file, startPos, endSpan.end),
    };
  }

  // Single inline statement block
  const stmt = parseStatement(p);
  return {
    kind: "Block",
    statements: stmt ? [stmt] : [],
    span: stmt ? stmt.span : emptySpan(p.file),
  };
}

// Statement Parsing
export function parseStatement(p: ParserHost): Statement | null {
  p.consumeStatementSeparator();

  if (isDestructureAhead(p)) {
    return parseDestructureOrVectorAssign(p);
  }

  const isValKeywordDecl =
    p.check("VAL") &&
    (p.isIdentOrKeyword(p.peek(1)) || p.peek(1).kind === "STRING") &&
    p.peek(1).kind !== "COLON_EQUAL" &&
    p.peek(1).kind !== "COLON_COLON_EQUAL" &&
    p.peek(1).kind !== "EQUAL" &&
    p.peek(1).kind !== "DOT" &&
    p.peek(1).kind !== "QUESTION_DOT" &&
    p.peek(1).kind !== "LBRACKET" &&
    !(p.peek(1).kind === "COLON" && p.isTypedDeclarationAhead()) &&
    p.peek(1).kind !== "PLUS_EQUAL" &&
    p.peek(1).kind !== "MINUS_EQUAL" &&
    p.peek(1).kind !== "STAR_EQUAL" &&
    p.peek(1).kind !== "SLASH_EQUAL" &&
    p.peek(1).kind !== "PERCENT_EQUAL" &&
    p.peek(1).kind !== "PIPE_EQUAL" &&
    p.peek(1).kind !== "AMP_EQUAL" &&
    p.peek(1).kind !== "CARET_EQUAL" &&
    p.peek(1).kind !== "SHL_EQUAL" &&
    p.peek(1).kind !== "SHR_EQUAL" &&
    p.peek(1).kind !== "USHR_EQUAL" &&
    p.peek(1).kind !== "STAR_STAR_EQUAL";

  const isMutKeywordDecl =
    p.check("MUT") &&
    (p.isIdentOrKeyword(p.peek(1)) || p.peek(1).kind === "STRING") &&
    (p.peek(2).kind === "EQUAL" ||
      p.peek(2).kind === "COLON_EQUAL" ||
      p.peek(2).kind === "COLON_COLON_EQUAL" ||
      p.peek(2).kind === "COLON");

  if (
    p.check("LET") ||
    isValKeywordDecl ||
    isMutKeywordDecl ||
    p.check("CONST") ||
    p.check("COLON_EQUAL") ||
    p.check("COLON_COLON_EQUAL")
  ) {
    return parseLetBinding(p);
  }
  if (p.check("RET")) {
    return parseReturnStatement(p);
  }
  if (p.check("IF")) {
    return parseIfStatement(p);
  }
  if (p.check("MATCH")) {
    if (p.isMatchStatementAhead()) {
      return parseMatchStatement(p);
    }
  }
  if (p.check("FOR")) {
    return parseForStatement(p);
  }
  if (p.check("WHILE")) {
    return parseWhileStatement(p);
  }
  if (p.check("TRY")) {
    return parseTryStatement(p);
  }
  if (p.check("THROW")) {
    return parseThrowStatement(p);
  }
  if (p.check("BREAK")) {
    return parseBreakStatement(p);
  }
  if (p.check("CONTINUE")) {
    return parseContinueStatement(p);
  }
  if (
    ((p.check("IDENT") && p.current().value === "pass") || p.check("ELLIPSIS")) &&
    (p.peek(1).kind === "NEWLINE" ||
      p.peek(1).kind === "EOF" ||
      p.peek(1).kind === "DEDENT" ||
      p.peek(1).kind === "SEMICOLON")
  ) {
    p.advance();
    p.consumeStatementSeparator();
    return null;
  }

  if (p.isIdentOrKeyword(p.current())) {
    if (p.peek(1).kind === "COLON_EQUAL") {
      const startSpan = p.current().span;
      const name = p.advance().value;
      p.advance(); // consume ':='
      const init = p.parseExpr();
      p.consumeStatementSeparator();
      return {
        kind: "LetBinding",
        name,
        isMut: false,
        typeAnnotation: null,
        init,
        span: mergeSpans(startSpan, init.span),
      };
    }
    if (p.peek(1).kind === "COLON_COLON_EQUAL") {
      const startSpan = p.current().span;
      const name = p.advance().value;
      p.advance(); // consume '::='
      const init = p.parseExpr();
      p.consumeStatementSeparator();
      return {
        kind: "LetBinding",
        name,
        isMut: true,
        typeAnnotation: null,
        init,
        span: mergeSpans(startSpan, init.span),
      };
    }
    if (p.peek(1).kind === "COLON" && p.isTypedDeclarationAhead()) {
      const startSpan = p.current().span;
      const name = p.advance().value;
      p.advance(); // consume ':'
      const typeAnnotation = p.parseTypeExpr();
      let isMut = false;
      if (p.check("COLON_COLON_EQUAL")) {
        isMut = true;
        p.advance();
      } else if (p.check("COLON_EQUAL")) {
        isMut = false;
        p.advance();
      } else if (p.check("EQUAL")) {
        isMut = false;
        p.advance();
      } else {
        throw new ParserError(
          "Expected ':=', '::=', or '=' after type annotation in variable declaration",
          p.current().span,
        );
      }
      const init = p.parseExpr();
      p.consumeStatementSeparator();
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
  const expr = p.parseExpr();

  if (expr.kind === "AssignExpr") {
    p.consumeStatementSeparator();
    if (expr.value.kind === "ConditionalExpr") {
      const ternary = expr.value;
      return {
        kind: "IfStmt",
        condition: ternary.condition,
        thenBranch: {
          kind: "Block",
          statements: [
            {
              kind: "AssignStmt",
              target: expr.target,
              op: expr.op,
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
              kind: "AssignStmt",
              target: expr.target,
              op: expr.op,
              value: ternary.whenFalse,
              span: ternary.whenFalse.span,
            },
          ],
          span: ternary.whenFalse.span,
        },
        span: expr.span,
      };
    }
    return {
      kind: "AssignStmt",
      target: expr.target,
      op: expr.op,
      value: expr.value,
      span: expr.span,
    };
  }

  if (
    p.check("EQUAL") ||
    p.check("PLUS_EQUAL") ||
    p.check("MINUS_EQUAL") ||
    p.check("STAR_EQUAL") ||
    p.check("SLASH_EQUAL") ||
    p.check("PERCENT_EQUAL") ||
    p.check("PIPE_EQUAL") ||
    p.check("CARET_EQUAL") ||
    p.check("AMP_EQUAL") ||
    p.check("SHL_EQUAL") ||
    p.check("SHR_EQUAL") ||
    p.check("USHR_EQUAL") ||
    p.check("STAR_STAR_EQUAL")
  ) {
    const op = p.advance().value as AssignOp;
    const val = p.parseExpr();
    p.consumeStatementSeparator();
    return {
      kind: "AssignStmt",
      target: expr,
      op,
      value: val,
      span: mergeSpans(expr.span, val.span),
    };
  }

  p.consumeStatementSeparator();
  return {
    kind: "ExprStmt",
    expr,
    span: expr.span,
  };
}

function isDestructureAhead(p: ParserHost): boolean {
  let i = 0;
  if (p.peek(i).kind === "LET" || p.peek(i).kind === "VAL" || p.peek(i).kind === "CONST") {
    i++;
    if (p.peek(i).kind === "MUT") {
      i++;
    }
  }
  const openKind = p.peek(i).kind;
  if (openKind !== "LBRACKET" && openKind !== "LPAREN") return false;
  const closeKind = openKind === "LBRACKET" ? "RBRACKET" : "RPAREN";
  i++;

  let count = 0;
  let hasHole = false;
  while (true) {
    const tok = p.peek(i);
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
    if (tok.kind === "IDENT" || p.isIdentOrKeyword(tok)) {
      count++;
      i++;
      const next = p.peek(i);
      if (!next) return false;
      if (next.kind === "COMMA") {
        i++;
        const afterComma = p.peek(i);
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

  const after = p.peek(i);
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
      const t = p.peek(j);
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

function parseDestructureOrVectorAssign(p: ParserHost): Statement {
  const startSpan = p.current().span;
  let isMut = false;
  let hasLet = false;

  if (p.check("LET") || p.check("VAL") || p.check("CONST")) {
    hasLet = true;
    if (p.check("LET")) {
      p.advance();
      if (p.check("MUT") && p.peek(1).kind !== "EQUAL" && p.peek(1).kind !== "COLON") {
        p.advance();
        isMut = true;
      }
    } else {
      p.advance(); // VAL / CONST
      isMut = false;
    }
  }

  const openKind = p.advance().kind; // consume '[' or '('
  const closeKind = openKind === "LBRACKET" ? "RBRACKET" : "RPAREN";
  const names: { name: string; span: Span }[] = [];
  let hasHole = false;

  while (!p.check(closeKind) && !p.check("EOF")) {
    if (p.check("COMMA")) {
      names.push({ name: "", span: p.current().span });
      hasHole = true;
      p.advance();
      continue;
    }
    const identTok = p.advance();
    names.push({ name: identTok.value, span: identTok.span });
    if (p.check("COMMA")) {
      p.advance();
    } else {
      break;
    }
  }
  const closeSpan = p.consume(closeKind).span;

  let typeAnnotation: TypeExpr | null = null;
  if (p.check("COLON")) {
    p.advance();
    typeAnnotation = p.parseTypeExpr();
  }

  if (p.check("COLON_EQUAL")) {
    p.advance(); // consume ':='
    const init = p.parseExpr();
    p.consumeStatementSeparator();
    return {
      kind: "DestructureBinding",
      names: names.map((n) => n.name),
      isMut: false,
      typeAnnotation,
      init,
      span: mergeSpans(startSpan, init.span),
    };
  }

  if (p.check("COLON_COLON_EQUAL")) {
    p.advance(); // consume '::='
    const init = p.parseExpr();
    p.consumeStatementSeparator();
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
    p.check("EQUAL") ||
    p.check("PLUS_EQUAL") ||
    p.check("MINUS_EQUAL") ||
    p.check("STAR_EQUAL") ||
    p.check("SLASH_EQUAL") ||
    p.check("PERCENT_EQUAL") ||
    p.check("PIPE_EQUAL") ||
    p.check("CARET_EQUAL") ||
    p.check("AMP_EQUAL") ||
    p.check("SHL_EQUAL") ||
    p.check("SHR_EQUAL") ||
    p.check("USHR_EQUAL") ||
    p.check("STAR_STAR_EQUAL")
  ) {
    const op = p.advance().value as AssignOp;
    const val = p.parseExpr();
    p.consumeStatementSeparator();

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
    `Expected assignment or binding operator after vector destructure target, got '${p.current().kind}'`,
    p.current().span,
  );
}

function parseLetBinding(p: ParserHost): LetBinding {
  const startSpan = p.current().span;

  let isMut = false;
  if (p.check("COLON_EQUAL") || p.check("COLON_COLON_EQUAL")) {
    isMut = p.advance().kind === "COLON_COLON_EQUAL";
  } else if (p.check("VAL") || p.check("CONST")) {
    p.advance();
    isMut = false;
  } else if (p.check("MUT")) {
    p.advance();
    isMut = true;
  } else {
    p.consume("LET");
    if (p.check("MUT") && p.peek(1).kind !== "EQUAL" && p.peek(1).kind !== "COLON") {
      p.advance();
      isMut = true;
    }
  }

  const name = p.parseContextualIdentOrString("Expected variable name");
  let typeAnnotation: TypeExpr | null = null;

  if (p.check("COLON")) {
    p.advance();
    typeAnnotation = p.parseTypeExpr();
  }

  if (p.check("COLON_EQUAL") || p.check("COLON_COLON_EQUAL")) {
    if (p.check("COLON_COLON_EQUAL")) isMut = true;
    p.advance();
  } else {
    p.consume("EQUAL", "Expected '=' in variable declaration");
  }
  const init = p.parseExpr();
  p.consumeStatementSeparator();

  return {
    kind: "LetBinding",
    name,
    isMut,
    typeAnnotation,
    init,
    span: mergeSpans(startSpan, init.span),
  };
}

function parseReturnStatement(p: ParserHost): Statement {
  const startSpan = p.current().span;
  p.consume("RET");

  let value: Expr | null = null;
  if (
    !p.check("NEWLINE") &&
    !p.check("SEMICOLON") &&
    !p.check("DEDENT") &&
    !p.check("RBRACE") &&
    !p.check("EOF") &&
    p.current().span.start.line === startSpan.end.line
  ) {
    value = p.parseExpr();
  }

  p.consumeStatementSeparator();

  return {
    kind: "ReturnStmt",
    value,
    span: mergeSpans(startSpan, value ? value.span : startSpan),
  };
}

function parseIfStatement(p: ParserHost): IfStmt {
  const startSpan = p.current().span;
  p.consume("IF");

  const condition = p.parseExpr();
  if (p.check("COLON")) {
    p.advance();
    p.consumeStatementSeparator();
  } else if (!p.check("LBRACE")) {
    p.consume("COLON", "Expected ':' after if condition");
  }
  const thenBranch = parseBlock(p);

  const elifBranches: { condition: Expr; body: Block; span: Span }[] = [];

  p.consumeStatementSeparator();
  while (p.check("ELIF") || (p.check("ELSE") && p.peek(1).kind === "IF")) {
    const eSpan = p.advance().span;
    if (p.check("IF")) {
      p.advance();
    }
    const eCond = p.parseExpr();
    if (p.check("COLON")) {
      p.advance();
      p.consumeStatementSeparator();
    } else if (!p.check("LBRACE")) {
      p.consume("COLON", "Expected ':' after elif condition");
    }
    const eBody = parseBlock(p);
    elifBranches.push({
      condition: eCond,
      body: eBody,
      span: mergeSpans(eSpan, eBody.span),
    });
    p.consumeStatementSeparator();
  }

  let elseBranch: Block | null = null;
  if (p.check("ELSE")) {
    p.advance();
    if (p.check("COLON")) {
      p.advance();
      p.consumeStatementSeparator();
    } else if (!p.check("LBRACE")) {
      p.consume("COLON", "Expected ':' after else");
    }
    elseBranch = parseBlock(p);
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

function parseMatchStatement(p: ParserHost): MatchStmt {
  const startSpan = p.current().span;
  p.consume("MATCH");

  const target = p.parseExpr();
  p.consume("COLON", "Expected ':' after match target");
  p.consumeStatementSeparator();

  const cases: MatchCase[] = [];
  p.consume("INDENT", "Expected indented match cases");

  while (!p.check("DEDENT") && !p.check("EOF")) {
    p.consumeStatementSeparator();
    if (p.check("DEDENT") || p.check("EOF")) break;

    const cSpan = p.current().span;
    if (p.check("CASE")) {
      p.advance();
    }

    const pattern = parsePattern(p);
    let guard: Expr | undefined;

    if (p.check("IF")) {
      p.advance();
      guard = p.parseExpr();
    }

    if (p.check("FAT_ARROW") || p.check("COLON")) {
      p.advance();
    } else {
      throw new ParserError("Expected '=>' or ':' after match pattern", p.current().span);
    }

    let body: Block | Expr;
    if (p.check("NEWLINE")) {
      p.consumeStatementSeparator();
      if (p.check("INDENT") || p.check("LBRACE")) {
        body = parseBlock(p);
      } else if (
        p.check("RET") ||
        p.check("BREAK") ||
        p.check("CONTINUE") ||
        p.check("THROW") ||
        p.check("LET") ||
        p.check("VAL") ||
        p.check("CONST") ||
        p.check("IF") ||
        p.check("WHILE") ||
        p.check("FOR") ||
        p.check("TRY")
      ) {
        const stmt = parseStatement(p)!;
        body = {
          kind: "Block",
          statements: [stmt],
          span: stmt.span,
        };
      } else {
        body = p.parseExpr();
        p.consumeStatementSeparator();
      }
    } else if (p.check("LBRACE")) {
      body = parseBlock(p);
    } else if (
      p.check("RET") ||
      p.check("BREAK") ||
      p.check("CONTINUE") ||
      p.check("THROW") ||
      p.check("LET") ||
      p.check("VAL") ||
      p.check("CONST") ||
      p.check("IF") ||
      p.check("WHILE") ||
      p.check("FOR") ||
      p.check("TRY")
    ) {
      const stmt = parseStatement(p)!;
      body = {
        kind: "Block",
        statements: [stmt],
        span: stmt.span,
      };
    } else {
      body = p.parseExpr();
      p.consumeStatementSeparator();
    }

    cases.push({
      pattern,
      guard,
      body,
      span: mergeSpans(cSpan, body.span),
    });

    p.consumeStatementSeparator();
  }

  const endSpan = p.consume("DEDENT").span;

  return {
    kind: "MatchStmt",
    target,
    cases,
    span: mergeSpans(startSpan, endSpan),
  };
}

function parsePattern(p: ParserHost): Pattern {
  const tok = p.current();

  if (tok.kind === "IDENT" && tok.value === "_") {
    p.advance();
    return { kind: "WildcardPattern", span: tok.span };
  }

  if (
    tok.kind === "NUMBER" ||
    tok.kind === "STRING" ||
    tok.kind === "BOOLEAN" ||
    tok.kind === "NIL"
  ) {
    const lit = p.parsePrimary() as LiteralExpr;
    return { kind: "LiteralPattern", value: lit, span: lit.span };
  }

  if (tok.kind === "IDENT" || p.isContextualIdentifier(tok)) {
    p.advance();
    let name = tok.value;
    let lastSpan = tok.span;
    while (p.check("DOT")) {
      p.advance();
      const nextTok = p.advance();
      name += "." + nextTok.value;
      lastSpan = nextTok.span;
    }
    // Check for constructor pattern: Some(val) or Ok(res)
    if (p.check("LPAREN")) {
      p.advance();
      const subPatterns: Pattern[] = [];
      while (!p.check("RPAREN") && !p.check("EOF")) {
        subPatterns.push(parsePattern(p));
        if (p.check("COMMA")) p.advance();
      }
      const endSpan = p.consume("RPAREN").span;
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

function parseForStatement(p: ParserHost): ForStmt {
  const startSpan = p.current().span;
  p.consume("FOR");

  let variable: string;
  if (p.check("LBRACE")) {
    p.advance(); // consume '{'
    const elements: string[] = [];
    while (!p.check("RBRACE") && !p.check("EOF")) {
      const key = p.parseContextualIdentOrString("Expected property name");
      if (p.check("COLON")) {
        p.advance();
        const alias = p.parseContextualIdentOrString("Expected alias name");
        elements.push(`${key}: ${alias}`);
      } else {
        elements.push(key);
      }
      if (p.check("COMMA")) {
        p.advance();
      } else {
        break;
      }
    }
    p.consume("RBRACE");
    variable = `{ ${elements.join(", ")} }`;
  } else if (p.check("LBRACKET") || p.check("LPAREN")) {
    const isBracket = p.check("LBRACKET");
    const closeKind = isBracket ? "RBRACKET" : "RPAREN";
    p.advance(); // consume '[' or '('
    const elements: string[] = [];
    while (!p.check(closeKind) && !p.check("EOF")) {
      if (p.check("COMMA")) {
        elements.push("");
        p.advance();
        continue;
      }
      elements.push(p.parseContextualIdentOrString("Expected variable name"));
      if (p.check("COMMA")) {
        p.advance();
      } else {
        break;
      }
    }
    p.consume(closeKind);
    variable = isBracket ? `[${elements.join(", ")}]` : `(${elements.join(", ")})`;
  } else {
    variable = p.parseContextualIdentOrString("Expected loop variable name");
  }

  p.consume("IN", "Expected 'in' in for loop");
  const iterable = p.parseExpr();
  if (p.check("COLON")) {
    p.advance();
    p.consumeStatementSeparator();
  } else if (!p.check("LBRACE")) {
    p.consume("COLON", "Expected ':' after for loop iterable");
  }
  const body = parseBlock(p);

  return {
    kind: "ForStmt",
    variable,
    iterable,
    body,
    span: mergeSpans(startSpan, body.span),
  };
}

function parseWhileStatement(p: ParserHost): WhileStmt {
  const startSpan = p.current().span;
  p.consume("WHILE");

  const condition = p.parseExpr();
  if (p.check("COLON")) {
    p.advance();
    p.consumeStatementSeparator();
  } else if (!p.check("LBRACE")) {
    p.consume("COLON", "Expected ':' after while condition");
  }
  const body = parseBlock(p);

  return {
    kind: "WhileStmt",
    condition,
    body,
    span: mergeSpans(startSpan, body.span),
  };
}

function parseTryStatement(p: ParserHost): TryStmt {
  const startSpan = p.current().span;
  p.consume("TRY");
  if (p.check("COLON")) {
    p.advance();
  }
  p.consumeStatementSeparator();
  const tryBlock = parseBlock(p);

  let catchParam: string | undefined;
  let catchBlock: Block | undefined;
  let finallyBlock: Block | undefined;

  p.consumeStatementSeparator();
  if (p.check("CATCH")) {
    p.advance();
    if (p.check("LPAREN")) {
      p.advance();
      catchParam = p.parseContextualIdentOrString("Expected catch parameter");
      p.consume("RPAREN");
    } else if (
      (p.check("IDENT") || p.isContextualIdentifier(p.current())) &&
      !p.check("COLON") &&
      !p.check("LBRACE") &&
      !p.check("NEWLINE")
    ) {
      catchParam = p.advance().value;
    }
    if (p.check("COLON")) {
      p.advance();
    }
    p.consumeStatementSeparator();
    catchBlock = parseBlock(p);
  }

  p.consumeStatementSeparator();
  if (p.check("FINALLY")) {
    p.advance();
    if (p.check("COLON")) {
      p.advance();
    }
    p.consumeStatementSeparator();
    finallyBlock = parseBlock(p);
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

function parseThrowStatement(p: ParserHost): ThrowStmt {
  const startSpan = p.current().span;
  p.consume("THROW");
  const expr = p.parseExpr();
  p.consumeStatementSeparator();
  return {
    kind: "ThrowStmt",
    expr,
    span: mergeSpans(startSpan, expr.span),
  };
}

function parseBreakStatement(p: ParserHost): BreakStmt {
  const span = p.current().span;
  p.consume("BREAK");
  p.consumeStatementSeparator();
  return {
    kind: "BreakStmt",
    span,
  };
}

function parseContinueStatement(p: ParserHost): ContinueStmt {
  const span = p.current().span;
  p.consume("CONTINUE");
  p.consumeStatementSeparator();
  return {
    kind: "ContinueStmt",
    span,
  };
}
