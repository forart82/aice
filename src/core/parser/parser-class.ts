/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unified `Parser` class composing `ParserBase` with declaration, statement,
 * expression, and UI/style submodules via the `ParserHost` interface.
 */

import type {
  Block,
  ComponentDecl,
  Expr,
  Module,
  ParamDecl,
  Statement,
  StyleDecl,
  TypeExpr,
} from "../ast.js";
import { tokenize } from "../lexer.js";
import type { Token } from "../tokens.js";
import { ParserBase, type ParserHost, Precedence } from "./core.js";
import { parseModule, parseParamDecl, parseTypeExpr } from "./declarations.js";
import { parseExpr, parsePrimary } from "./expressions.js";
import { parseBlock, parseStatement } from "./statements.js";
import { parseComponentDecl, parseStyleDecl, parseTokensDecl } from "./ui-and-styles.js";

export class Parser extends ParserBase implements ParserHost {
  constructor(tokens: Token[], file = "<anonymous>", source?: string) {
    super(tokens, file, source);
  }

  static fromSource(source: string, file = "<anonymous>"): Parser {
    const tokens = tokenize(source, file);
    return new Parser(tokens, file, source);
  }

  static parse(source: string, file = "<anonymous>"): Module {
    return Parser.fromSource(source, file).parse();
  }

  parse(): Module {
    return parseModule(this);
  }

  /** @internal */
  parseTypeExpr(): TypeExpr {
    return parseTypeExpr(this);
  }

  /** @internal */
  parseParamDecl(isClosure = false, allowUntyped = false): ParamDecl {
    return parseParamDecl(this, isClosure, allowUntyped);
  }

  /** @internal */
  parseBlock(): Block {
    return parseBlock(this);
  }

  /** @internal */
  parseStatement(): Statement | null {
    return parseStatement(this);
  }

  /** @internal */
  parseExpr(precedence: Precedence = Precedence.LOWEST): Expr {
    return parseExpr(this, precedence);
  }

  /** @internal */
  parsePrimary(): Expr {
    return parsePrimary(this);
  }

  /** @internal */
  parseComponentDecl(): ComponentDecl {
    return parseComponentDecl(this);
  }

  /** @internal */
  parseStyleDecl(consumeStyleKeyword = true): StyleDecl {
    return parseStyleDecl(this, consumeStyleKeyword);
  }

  /** @internal */
  parseTokensDecl(): StyleDecl {
    return parseTokensDecl(this);
  }
}
