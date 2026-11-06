/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AIL 2.0 Code Generator
 * Serializes an AIL Module AST and optional CstTriviaTable into clean, token-dense .ail code.
 */

import type {
  BinaryExpr,
  BinaryOp,
  Block,
  ClassDecl,
  ComponentDecl,
  ConstDecl,
  Expr,
  FunctionDecl,
  ImportDecl,
  LayoutNode,
  MatchCase,
  Module,
  ModuleItem,
  Pattern,
  Statement,
  StyleDecl,
  TypeDecl,
  TypeExpr,
  VarDecl,
} from "../core/ast.js";
import { Precedence } from "../core/parser.js";
import type { CstTriviaTable } from "../core/trivia.js";

export function getBinaryOpPrecedence(op: BinaryOp): number {
  switch (op) {
    case "**":
      return Precedence.EXPONENT; // 14
    case "*":
    case "/":
    case "%":
      return Precedence.PRODUCT; // 13
    case "+":
    case "-":
      return Precedence.SUM; // 12
    case "<<":
    case ">>":
    case ">>>":
      return Precedence.SHIFT; // 11
    case "<":
    case "<=":
    case ">":
    case ">=":
    case "in":
    case "instanceof":
      return Precedence.LESSGREATER; // 10
    case "==":
    case "!=":
      return Precedence.EQUALS; // 9
    case "&":
      return Precedence.BIT_AND; // 8
    case "^":
      return Precedence.BIT_XOR; // 7
    case "|":
      return Precedence.BIT_OR; // 6
    case "??":
      return Precedence.COALESCE; // 5
    case "and":
    case "&&":
      return Precedence.AND; // 4
    case "or":
    case "||":
      return Precedence.OR; // 3
    default:
      return Precedence.LOWEST;
  }
}

export function getExprPrecedence(expr: Expr): number {
  switch (expr.kind) {
    case "LiteralExpr":
    case "TemplateLiteralExpr":
    case "IdentifierExpr":
    case "ArrayLiteralExpr":
    case "RecordLiteralExpr":
      return 99; // Primary / atomic
    case "PostfixTryExpr":
    case "CallExpr":
    case "MemberAccessExpr":
    case "IndexExpr":
      return Precedence.POSTFIX; // 16
    case "UnaryExpr":
      return Precedence.PREFIX; // 15
    case "BinaryExpr":
      return getBinaryOpPrecedence(expr.operator);
    case "AssignExpr":
      return Precedence.ASSIGN; // 2
    case "ClosureExpr":
      return Precedence.LOWEST; // 1
    default:
      return Precedence.LOWEST;
  }
}

export function isRightAssociative(op: BinaryOp): boolean {
  return op === "**";
}

export function isLogicalOp(op: BinaryOp): boolean {
  return op === "and" || op === "&&" || op === "or" || op === "||";
}

export function normalizeLogicalOp(op: BinaryOp): "and" | "or" {
  return op === "and" || op === "&&" ? "and" : "or";
}

export function needsBinaryParentheses(
  parentOp: BinaryOp,
  child: Expr,
  isRightChild: boolean,
): boolean {
  const childPrec = getExprPrecedence(child);
  const parentPrec = getBinaryOpPrecedence(parentOp);

  // Rule 1: childPrecedence < parentPrecedence
  if (childPrec < parentPrec) {
    return true;
  }

  if (child.kind === "BinaryExpr") {
    const childOp = child.operator;

    // Rule 2: Right-hand child of left-associative operators (e.g. -, /, %, <<, >>, >>>)
    // has childPrecedence === parentPrecedence (e.g., a - (b - c), a / (b / c)).
    if (isRightChild && !isRightAssociative(parentOp) && childPrec === parentPrec) {
      return true;
    }

    // Rule 3: Left-hand child of right-associative operators (**)
    // has childPrecedence === parentPrecedence (e.g., (a ** b) ** c).
    if (!isRightChild && isRightAssociative(parentOp) && childPrec === parentPrec) {
      return true;
    }

    // Rule 4: Logical operators mixing and and or (e.g. (a or b) and c, a and (b or c)).
    if (isLogicalOp(parentOp) && isLogicalOp(childOp)) {
      if (normalizeLogicalOp(parentOp) !== normalizeLogicalOp(childOp)) {
        return true;
      }
    }
  }

  return false;
}

export interface AilGeneratorOptions {
  indent?: string;
  trivia?: CstTriviaTable;
}

export class AilGenerator {
  private indentStr: string;
  private currentIndent = 0;
  private buffer: string[] = [];
  private trivia?: CstTriviaTable;
  private inCurlyBlock = false;

  constructor(options: AilGeneratorOptions = {}) {
    this.indentStr = options.indent ?? "  ";
    this.trivia = options.trivia;
  }

  static generate(mod: Module, options?: AilGeneratorOptions): string {
    return new AilGenerator(options).generate(mod);
  }

  generate(mod: Module): string {
    this.buffer = [];
    this.currentIndent = 0;

    // Emit module declaration
    this.emitLeadingTrivia("module");
    this.writeLine(`module ${mod.path}`);
    this.writeLine();

    // Group items: imports first, then non-imports
    const imports = mod.items.filter((i) => i.kind === "ImportDecl") as ImportDecl[];
    const nonImports = mod.items.filter((i) => i.kind !== "ImportDecl");

    for (const imp of imports) {
      this.emitImport(imp);
    }

    if (imports.length > 0 && nonImports.length > 0) {
      this.writeLine();
    }

    for (let i = 0; i < nonImports.length; i++) {
      this.emitModuleItem(nonImports[i]);
      if (i < nonImports.length - 1) {
        this.writeLine();
      }
    }

    return this.buffer.join("");
  }

  private indent(): void {
    this.currentIndent++;
  }

  private dedent(): void {
    this.currentIndent = Math.max(0, this.currentIndent - 1);
  }

  private getIndent(): string {
    return this.indentStr.repeat(this.currentIndent);
  }

  private writeLine(text = "", nodeId?: string): void {
    if (text.length > 0) {
      let trailing = "";
      if (nodeId && this.trivia) {
        const entry = this.trivia.getTrivia(nodeId);
        if (entry && entry.trailing.length > 0) {
          for (const item of entry.trailing) {
            let clean = item.content.trim();
            if (clean.startsWith("//")) {
              clean = clean.slice(2).trim();
            } else if (clean.startsWith("/*")) {
              clean = clean
                .replace(/^\/\*+/, "")
                .replace(/\*+\/$/, "")
                .trim()
                .replace(/^\*\s?/, "")
                .trim();
            } else if (clean.startsWith("#")) {
              clean = clean.slice(1).trim();
            }
            if (clean.length > 0) {
              trailing += `  # ${clean}`;
            }
          }
        }
      }
      this.buffer.push(`${this.getIndent()}${text}${trailing}\n`);
    } else {
      this.buffer.push("\n");
    }
  }

  private emitLeadingTrivia(nodeId: string): void {
    if (!this.trivia) return;
    const entry = this.trivia.getTrivia(nodeId);
    if (!entry) return;

    if (entry.blankLinesBefore && entry.blankLinesBefore > 0) {
      for (let i = 0; i < entry.blankLinesBefore; i++) {
        this.writeLine();
      }
    }

    for (const item of entry.leading) {
      const rawLines = item.content.split("\n");
      const isBlock =
        item.kind === "DOCSTRING" ||
        item.kind === "BLOCK_COMMENT" ||
        item.content.trim().startsWith("/*");

      if (isBlock) {
        for (let i = 0; i < rawLines.length; i++) {
          let line = rawLines[i].trim();
          // Strip leading /* or /** on first line
          if (i === 0) {
            line = line.replace(/^\/\*+/, "").trim();
          }
          // Strip trailing */ on last line
          if (i === rawLines.length - 1) {
            line = line.replace(/\*+\/$/, "").trim();
          }
          // Strip leading * or * followed by space (standard JSDoc / block comment styling)
          line = line.replace(/^\*\s?/, "").trim();

          // If the very first or very last line became completely empty after stripping delimiters, skip it
          if ((i === 0 || i === rawLines.length - 1) && !line) {
            continue;
          }

          if (line.length > 0) {
            this.writeLine(`# ${line}`);
          } else {
            this.writeLine("#");
          }
        }
      } else {
        // Line comments (// or #)
        for (const line of rawLines) {
          const trimmed = line.trim();
          if (trimmed.startsWith("//")) {
            const clean = trimmed.slice(2).trim();
            if (clean.length > 0) {
              this.writeLine(`# ${clean}`);
            } else {
              this.writeLine("#");
            }
          } else if (trimmed.startsWith("#")) {
            this.writeLine(trimmed);
          } else if (trimmed.length > 0) {
            this.writeLine(`# ${trimmed}`);
          } else {
            this.writeLine("#");
          }
        }
      }
    }
  }

  private emitImport(imp: ImportDecl): void {
    const nodeId = `import:${imp.source}`;
    this.emitLeadingTrivia(nodeId);
    const pub = imp.isExported ? "pub " : "";

    if (imp.specifiers.length === 0) {
      this.writeLine(`${pub}import "${imp.source}"`);
      return;
    }

    if (imp.specifiers.length === 1 && imp.specifiers[0].isWildcard) {
      if (imp.specifiers[0].alias) {
        this.writeLine(`${pub}from "${imp.source}" import * as ${imp.specifiers[0].alias}`);
      } else {
        this.writeLine(`${pub}from "${imp.source}" import *`);
      }
      return;
    }

    const specs = imp.specifiers.map((s) => (s.alias ? `${s.name} as ${s.alias}` : s.name));
    this.writeLine(`${pub}from "${imp.source}" import ${specs.join(", ")}`);
  }

  private emitModuleItem(item: ModuleItem): void {
    switch (item.kind) {
      case "TypeDecl":
        this.emitTypeDecl(item);
        break;
      case "FunctionDecl":
        this.emitFunctionDecl(item);
        break;
      case "ComponentDecl":
        this.emitComponentDecl(item);
        break;
      case "StyleDecl":
        this.emitStyleDecl(item);
        break;
      case "ClassDecl":
        this.emitClassDecl(item);
        break;
      case "ConstDecl":
        this.emitConstDecl(item);
        break;
      case "VarDecl":
        this.emitVarDecl(item);
        break;
    }
  }

  private emitTypeDecl(t: TypeDecl): void {
    const nodeId = `type:${t.name}`;
    this.emitLeadingTrivia(nodeId);

    if (t.aliasType) {
      this.writeLine(`type ${t.name} = ${this.formatTypeExpr(t.aliasType)}`);
      return;
    }

    if (t.isEnum && t.variants) {
      this.writeLine(`enum ${t.name}:`);
      this.indent();
      for (const v of t.variants) {
        if (v.payloadTypes && v.payloadTypes.length > 0) {
          const payloads = v.payloadTypes.map((pt) => this.formatTypeExpr(pt)).join(", ");
          this.writeLine(`${v.name}(${payloads})`);
        } else {
          this.writeLine(v.name);
        }
      }
      this.dedent();
      return;
    }

    if (t.fields) {
      const typeParams = t.typeParams.length > 0 ? `[${t.typeParams.join(", ")}]` : "";
      this.writeLine(`type ${t.name}${typeParams}:`);
      this.indent();
      if (t.fields.length === 0) {
        this.writeLine("pass");
      } else {
        for (const f of t.fields) {
          const fieldNodeId = `field:${t.name}.${f.name}`;
          this.emitLeadingTrivia(fieldNodeId);
          this.writeLine(`${f.name}:${this.formatTypeExpr(f.typeAnnotation)}`);
        }
      }
      this.dedent();
    }
  }

  private emitClassDecl(c: ClassDecl): void {
    const nodeId = `class:${c.name}`;
    this.emitLeadingTrivia(nodeId);

    const pub = c.isExported ? "pub " : "";
    const typeParams = c.typeParams.length > 0 ? `[${c.typeParams.join(", ")}]` : "";
    const primaryCtor =
      c.primaryConstructor && c.primaryConstructor.length > 0
        ? `(${c.primaryConstructor
            .map((p) => {
              const pPub = p.isPub ? "pub " : "";
              const pRo = p.isReadonly ? "readonly " : "";
              const pMut = p.isMut ? "mut " : "";
              const opt = p.isOptional ? "?" : "";
              const def = p.defaultValue ? ` = ${this.formatExpr(p.defaultValue)}` : "";
              const typePart = p.typeAnnotation ? `:${this.formatTypeExpr(p.typeAnnotation)}` : "";
              const rest = p.isRest ? "..." : "";
              return `${pPub}${pRo}${pMut}${rest}${p.name}${opt}${typePart}${def}`;
            })
            .join(", ")})`
        : "";
    const ext = c.extends ? ` extends ${c.extends}` : "";
    const impl =
      c.implements && c.implements.length > 0 ? ` implements ${c.implements.join(", ")}` : "";

    this.writeLine(`${pub}class ${c.name}${typeParams}${primaryCtor}${ext}${impl}:`, nodeId);
    this.indent();

    if (c.properties.length === 0 && c.methods.length === 0) {
      this.writeLine("pass");
    } else {
      for (const p of c.properties) {
        const pNodeId = `field:${c.name}.${p.name}`;
        this.emitLeadingTrivia(pNodeId);
        const st = p.isStatic ? "static " : "";
        const ro = p.isReadonly ? "readonly " : "";
        const aliases = p.aliases && p.aliases.length > 0 ? p.aliases : p.alias ? [p.alias] : [];
        const aliasStr = aliases.length > 0 ? `, ${aliases.join(", ")}` : "";
        const propKw = aliases.length > 0 ? "prop " : "";
        const typeAnn = p.typeAnnotation ? `: ${this.formatTypeExpr(p.typeAnnotation)}` : "";
        const init = p.initialValue ? ` = ${this.formatExpr(p.initialValue)}` : "";
        this.writeLine(`${propKw}${st}${ro}${p.name}${aliasStr}${typeAnn}${init}`, pNodeId);
      }

      for (const m of c.methods) {
        const mNodeId = `method:${c.name}.${m.name}`;
        this.emitLeadingTrivia(mNodeId);
        const st = m.isStatic ? "static " : "";
        const as = m.isAsync ? "async " : "";
        const params = m.params
          .map((p) => {
            const opt = p.isOptional ? "?" : "";
            const def = p.defaultValue ? ` = ${this.formatExpr(p.defaultValue)}` : "";
            const typePart = p.typeAnnotation ? `:${this.formatTypeExpr(p.typeAnnotation)}` : "";
            const rest = p.isRest ? "..." : "";
            return `${rest}${p.name}${opt}${typePart}${def}`;
          })
          .join(", ");
        const ret = m.returnType ? ` -> ${this.formatTypeExpr(m.returnType)}` : "";

        if (m.isExpressionBodied) {
          const bodyExpr = m.body as Expr;
          const bodyStr =
            bodyExpr.kind === "AssignExpr"
              ? `(${this.formatExpr(bodyExpr)})`
              : this.formatExpr(bodyExpr);
          if (m.accessor === "get") {
            this.writeLine(`${st}get ${m.name}()${ret} = ${bodyStr}`, mNodeId);
          } else if (m.accessor === "set") {
            this.writeLine(`${st}set ${m.name}(${params}) = ${bodyStr}`, mNodeId);
          } else {
            this.writeLine(`${st}${as}fn ${m.name}(${params})${ret} = ${bodyStr}`, mNodeId);
          }
        } else {
          if (m.accessor === "get") {
            this.writeLine(`${st}get ${m.name}()${ret}:`, mNodeId);
          } else if (m.accessor === "set") {
            this.writeLine(`${st}set ${m.name}(${params}):`, mNodeId);
          } else {
            this.writeLine(`${st}${as}fn ${m.name}(${params})${ret}:`, mNodeId);
          }
          this.indent();
          if (m.body.kind === "Block") {
            if (m.body.statements.length === 0) {
              this.writeLine("nil");
            } else {
              this.emitBlock(m.body, true);
            }
          } else {
            this.writeLine(this.formatExpr(m.body));
          }
          this.dedent();
        }
      }

      if (c.staticBlocks && c.staticBlocks.length > 0) {
        for (const sb of c.staticBlocks) {
          this.writeLine("static:");
          this.indent();
          this.emitBlock(sb, true);
          this.dedent();
        }
      }
    }

    this.dedent();
  }

  private emitConstDecl(c: ConstDecl): void {
    const nodeId = `const:${c.name}`;
    this.emitLeadingTrivia(nodeId);
    if (c.name === "_") {
      this.writeLine(`_ := ${this.formatExpr(c.value)}`, nodeId);
      return;
    }
    const pub = c.isExported ? "pub " : "";
    const typeAnn = c.typeAnnotation ? `: ${this.formatTypeExpr(c.typeAnnotation)}` : "";
    this.writeLine(`${pub}const ${c.name}${typeAnn} = ${this.formatExpr(c.value)}`, nodeId);
  }

  private emitVarDecl(v: VarDecl): void {
    const nodeId = `var:${v.name}`;
    this.emitLeadingTrivia(nodeId);
    const pub = v.isExported ? "pub " : "";
    const op = v.isMut ? "::=" : ":=";
    const typeAnn = v.typeAnnotation ? `: ${this.formatTypeExpr(v.typeAnnotation)} ` : " ";
    this.writeLine(`${pub}${v.name}${typeAnn}${op} ${this.formatExpr(v.value)}`, nodeId);
  }

  private emitFunctionDecl(fn: FunctionDecl): void {
    const nodeId = `fn:${fn.name}`;
    this.emitLeadingTrivia(nodeId);

    const params = fn.params
      .map((p) => {
        const opt = p.isOptional ? "?" : "";
        const def = p.defaultValue ? ` = ${this.formatExpr(p.defaultValue)}` : "";
        const typePart = p.typeAnnotation ? `:${this.formatTypeExpr(p.typeAnnotation)}` : "";
        const rest = p.isRest ? "..." : "";
        return `${rest}${p.name}${opt}${typePart}${def}`;
      })
      .join(", ");

    const as = fn.isAsync ? "async " : "";
    if (fn.isExpressionBodied && !Array.isArray((fn.body as Block).statements)) {
      const retType = fn.returnType ? ` -> ${this.formatTypeExpr(fn.returnType)}` : "";
      const bodyExpr = fn.body as Expr;
      const bodyStr =
        bodyExpr.kind === "AssignExpr"
          ? `(${this.formatExpr(bodyExpr)})`
          : this.formatExpr(bodyExpr);
      this.writeLine(`${as}fn ${fn.name}(${params})${retType} = ${bodyStr}`);
      return;
    }

    const retType = fn.returnType ? ` -> ${this.formatTypeExpr(fn.returnType)}` : "";
    this.writeLine(`${as}fn ${fn.name}(${params})${retType}:`);
    this.indent();
    this.emitBlock(fn.body as Block, true);
    this.dedent();
  }

  private emitBlock(block: Block, isTail = false): void {
    if (block.statements.length === 0) {
      this.writeLine("nil");
      return;
    }

    const len = block.statements.length;
    for (let i = 0; i < len; i++) {
      const isLast = i === len - 1;
      this.emitStatement(block.statements[i], isTail && isLast);
    }
  }

  public formatStatement(stmt: Statement, indent = ""): string {
    switch (stmt.kind) {
      case "LetBinding": {
        const op = stmt.isMut ? "::=" : ":=";
        const typeAnn = stmt.typeAnnotation
          ? `: ${this.formatTypeExpr(stmt.typeAnnotation)} `
          : " ";
        return `${indent}${stmt.name}${typeAnn}${op} ${this.formatExpr(stmt.init)}`;
      }
      case "DestructureBinding": {
        const op = stmt.isMut ? "::=" : ":=";
        const names = stmt.names.join(", ");
        return `${indent}[${names}] ${op} ${this.formatExpr(stmt.init)}`;
      }
      case "AssignStmt": {
        const op = stmt.op ?? "=";
        return `${indent}${this.formatExpr(stmt.target)} ${op} ${this.formatExpr(stmt.value)}`;
      }
      case "ReturnStmt": {
        if (stmt.value) {
          return `${indent}ret ${this.formatExpr(stmt.value)}`;
        }
        return `${indent}ret`;
      }
      case "ExprStmt": {
        return `${indent}${this.formatExpr(stmt.expr)}`;
      }
      case "IfStmt": {
        const condStr =
          stmt.condition.kind === "AssignExpr"
            ? `(${this.formatExpr(stmt.condition)})`
            : this.formatExpr(stmt.condition);
        if (this.inCurlyBlock) {
          let s = `${indent}if ${condStr}: {\n`;
          this.indent();
          s += this.formatBlock(stmt.thenBranch);
          this.dedent();
          s += `\n${indent}}`;

          for (const elif of stmt.elifBranches) {
            const elifCondStr =
              elif.condition.kind === "AssignExpr"
                ? `(${this.formatExpr(elif.condition)})`
                : this.formatExpr(elif.condition);
            s += ` elif ${elifCondStr}: {\n`;
            this.indent();
            s += this.formatBlock(elif.body);
            this.dedent();
            s += `\n${indent}}`;
          }

          if (stmt.elseBranch) {
            s += ` else: {\n`;
            this.indent();
            s += this.formatBlock(stmt.elseBranch);
            this.dedent();
            s += `\n${indent}}`;
          }
          return s;
        }

        let s = `${indent}if ${condStr}:\n`;
        this.indent();
        s += this.formatBlock(stmt.thenBranch);
        this.dedent();

        for (const elif of stmt.elifBranches) {
          const elifCondStr =
            elif.condition.kind === "AssignExpr"
              ? `(${this.formatExpr(elif.condition)})`
              : this.formatExpr(elif.condition);
          s += `\n${indent}elif ${elifCondStr}:\n`;
          this.indent();
          s += this.formatBlock(elif.body);
          this.dedent();
        }

        if (stmt.elseBranch) {
          s += `\n${indent}else:\n`;
          this.indent();
          s += this.formatBlock(stmt.elseBranch);
          this.dedent();
        }
        return s;
      }
      case "MatchStmt": {
        const s = `${indent}match ${this.formatExpr(stmt.target)}:\n`;
        this.indent();
        const cases =
          stmt.cases && stmt.cases.length > 0
            ? stmt.cases.map((mc) => this.formatMatchCase(mc)).join("\n")
            : `${this.getIndent()}case _ => nil`;
        this.dedent();
        return s + cases;
      }
      case "ForStmt": {
        if (this.inCurlyBlock) {
          let s = `${indent}for ${stmt.variable} in ${this.formatExpr(stmt.iterable)}: {\n`;
          this.indent();
          s += this.formatBlock(stmt.body);
          this.dedent();
          s += `\n${indent}}`;
          return s;
        }
        let s = `${indent}for ${stmt.variable} in ${this.formatExpr(stmt.iterable)}:\n`;
        this.indent();
        s += this.formatBlock(stmt.body);
        this.dedent();
        return s;
      }
      case "WhileStmt": {
        const condStr =
          stmt.condition.kind === "AssignExpr"
            ? `(${this.formatExpr(stmt.condition)})`
            : this.formatExpr(stmt.condition);
        if (this.inCurlyBlock) {
          let s = `${indent}while ${condStr}: {\n`;
          this.indent();
          s += this.formatBlock(stmt.body);
          this.dedent();
          s += `\n${indent}}`;
          return s;
        }
        let s = `${indent}while ${condStr}:\n`;
        this.indent();
        s += this.formatBlock(stmt.body);
        this.dedent();
        return s;
      }
      case "BreakStmt": {
        return `${indent}break`;
      }
      case "ContinueStmt": {
        return `${indent}continue`;
      }
      case "ThrowStmt": {
        return `${indent}throw ${this.formatExpr(stmt.expr)}`;
      }
      case "TryStmt": {
        if (this.inCurlyBlock) {
          let s = `${indent}try: {\n`;
          this.indent();
          s += this.formatBlock(stmt.tryBlock);
          this.dedent();
          s += `\n${indent}}`;

          const hasCatch = Boolean(stmt.catchBlock);
          const hasFinally = Boolean(stmt.finallyBlock);

          if (hasCatch) {
            const param = stmt.catchParam
              ? stmt.catchParam.startsWith("(")
                ? ` ${stmt.catchParam}`
                : ` ${stmt.catchParam}`
              : " (err)";
            s += ` catch${param}: {\n`;
            this.indent();
            s += this.formatBlock(stmt.catchBlock!);
            this.dedent();
            s += `\n${indent}}`;
          }

          if (hasFinally) {
            s += ` finally: {\n`;
            this.indent();
            s += this.formatBlock(stmt.finallyBlock!);
            this.dedent();
            s += `\n${indent}}`;
          }

          if (!hasCatch && !hasFinally) {
            s += ` catch (err): {\n`;
            this.indent();
            s += `${this.getIndent()}nil\n`;
            this.dedent();
            s += `${indent}}`;
          }
          return s;
        }

        let s = `${indent}try:\n`;
        this.indent();
        s += this.formatBlock(stmt.tryBlock);
        this.dedent();

        const hasCatch = Boolean(stmt.catchBlock);
        const hasFinally = Boolean(stmt.finallyBlock);

        if (hasCatch) {
          const param = stmt.catchParam
            ? stmt.catchParam.startsWith("(")
              ? ` ${stmt.catchParam}`
              : ` ${stmt.catchParam}`
            : " (err)";
          s += `\n${indent}catch${param}:\n`;
          this.indent();
          s += this.formatBlock(stmt.catchBlock!);
          this.dedent();
        }

        if (hasFinally) {
          s += `\n${indent}finally:\n`;
          this.indent();
          s += this.formatBlock(stmt.finallyBlock!);
          this.dedent();
        }

        if (!hasCatch && !hasFinally) {
          s += `\n${indent}catch (err):\n`;
          this.indent();
          s += `${this.getIndent()}nil`;
          this.dedent();
        }
        return s;
      }
    }
  }

  public formatBlock(block: Block): string {
    if (!block || !block.statements || block.statements.length === 0) {
      return `${this.getIndent()}nil`;
    }
    const lines = block.statements.map((s) => {
      const formatted = this.formatStatement(s, this.getIndent());
      if (this.inCurlyBlock && !formatted.trimEnd().endsWith("}")) {
        return formatted + ";";
      }
      return formatted;
    });
    return lines.join("\n");
  }

  public formatMatchCase(mc: MatchCase): string {
    const patternStr = this.formatPattern(mc.pattern);
    const guardStr = mc.guard ? ` if ${this.formatExpr(mc.guard)}` : "";
    const indent = this.getIndent();
    if ("statements" in mc.body) {
      if (mc.body.statements.length === 0) {
        return `${indent}case ${patternStr}${guardStr} => nil`;
      }
      let s = `${indent}case ${patternStr}${guardStr} =>\n`;
      this.indent();
      s += this.formatBlock(mc.body);
      this.dedent();
      return s;
    } else {
      const bodyStr =
        mc.body.kind === "AssignExpr" ? `(${this.formatExpr(mc.body)})` : this.formatExpr(mc.body);
      return `${indent}case ${patternStr}${guardStr} => ${bodyStr}`;
    }
  }

  private emitStatement(stmt: Statement, isTail = false): void {
    if (stmt.kind === "ReturnStmt" && stmt.value && isTail) {
      this.writeLine(this.formatExpr(stmt.value));
      return;
    }
    const str = this.formatStatement(stmt, this.getIndent());
    const lines = str.split("\n");
    for (const line of lines) {
      this.buffer.push(`${line}\n`);
    }
  }

  private emitMatchCase(mc: MatchCase): void {
    const patternStr = this.formatPattern(mc.pattern);
    const guardStr = mc.guard ? ` if ${this.formatExpr(mc.guard)}` : "";
    if ("statements" in mc.body) {
      if (mc.body.statements.length === 0) {
        this.writeLine(`case ${patternStr}${guardStr} => nil`);
        return;
      }
      this.writeLine(`case ${patternStr}${guardStr} =>`);
      this.indent();
      this.emitBlock(mc.body);
      this.dedent();
    } else {
      const bodyStr =
        mc.body.kind === "AssignExpr" ? `(${this.formatExpr(mc.body)})` : this.formatExpr(mc.body);
      this.writeLine(`case ${patternStr}${guardStr} => ${bodyStr}`);
    }
  }

  private formatPattern(p: Pattern): string {
    switch (p.kind) {
      case "LiteralPattern":
        return this.formatExpr(p.value);
      case "IdentifierPattern":
        return p.name;
      case "ConstructorPattern": {
        const sub = p.subPatterns.map((sp) => this.formatPattern(sp)).join(", ");
        return `${p.name}(${sub})`;
      }
      case "WildcardPattern":
        return "_";
    }
  }

  private emitComponentDecl(comp: ComponentDecl): void {
    const nodeId = `component:${comp.name}`;
    this.emitLeadingTrivia(nodeId);

    const params = comp.params
      .map((p) => {
        const opt = p.isOptional ? "?" : "";
        const typePart = p.typeAnnotation ? `:${this.formatTypeExpr(p.typeAnnotation)}` : "";
        return `${p.name}${opt}${typePart}`;
      })
      .join(", ");

    this.writeLine(`component ${comp.name}(${params}):`);
    this.indent();
    for (const node of comp.layout) {
      this.emitLayoutNode(node);
    }
    this.dedent();
  }

  private emitLayoutNode(node: LayoutNode): void {
    const isPositionalIdiom =
      node.tag.startsWith("$") &&
      node.attributes.every((a) => /^\$\d+$/.test(a.name));
    const attrs = isPositionalIdiom
      ? node.attributes.map((a) => this.formatExpr(a.value)).join(", ")
      : node.attributes.map((a) => `${a.name}: ${this.formatExpr(a.value)}`).join(", ");
    const attrStr = attrs.length > 0 || isPositionalIdiom ? `(${attrs})` : "";

    const hasChildren = node.children.length > 0;
    const hasText = node.textLiteral !== null;
    const hasChildExpr = node.childExpr != null;

    if (!hasChildren && !hasText && !hasChildExpr) {
      this.writeLine(`${node.tag}${attrStr}`);
      return;
    }

    if (!hasChildren && hasText && !hasChildExpr) {
      this.writeLine(`${node.tag}${attrStr}: "${node.textLiteral}"`);
      return;
    }

    if (!hasChildren && node.childExpr) {
      this.writeLine(
        `${node.tag}${attrStr}: ${JSON.stringify(`{${this.formatExpr(node.childExpr)}}`)}`,
      );
      return;
    }

    this.writeLine(`${node.tag}${attrStr}:`);
    this.indent();
    if (hasText) {
      this.writeLine(`"${node.textLiteral}"`);
    }
    if (node.childExpr) {
      this.writeLine(JSON.stringify(`{${this.formatExpr(node.childExpr)}}`));
    }
    for (const child of node.children) {
      this.emitLayoutNode(child);
    }
    this.dedent();
  }

  private emitStyleDecl(s: StyleDecl): void {
    const nodeId = `style:${s.name}`;
    this.emitLeadingTrivia(nodeId);

    const sanitizedName = s.name.replace(/\r?\n\s*/g, " ").trim();
    const nameStr = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(sanitizedName)
      ? sanitizedName
      : JSON.stringify(sanitizedName);
    this.writeLine(`style ${nameStr}:`);
    this.indent();

    let i = 0;
    while (i < s.properties.length) {
      const p = s.properties[i];

      // Check for token sheets grouping on custom properties: --ns-key: <num><unit>
      const tokenMatch = p.property.match(/^--([a-zA-Z0-9_]+)-([a-zA-Z0-9_]+)$/);
      const valMatch = p.value ? p.value.match(/^([0-9.]+)([a-zA-Z%]+)$/) : null;

      if (tokenMatch && valMatch) {
        const ns = tokenMatch[1];
        const unit = valMatch[2];
        const group: { key: string; valNum: string }[] = [
          { key: tokenMatch[2], valNum: valMatch[1] },
        ];
        let j = i + 1;
        while (j < s.properties.length) {
          const nextP = s.properties[j];
          const nextTMatch = nextP.property.match(/^--([a-zA-Z0-9_]+)-([a-zA-Z0-9_]+)$/);
          const nextVMatch = nextP.value ? nextP.value.match(/^([0-9.]+)([a-zA-Z%]+)$/) : null;
          if (nextTMatch && nextVMatch && nextTMatch[1] === ns && nextVMatch[2] === unit) {
            group.push({ key: nextTMatch[2], valNum: nextVMatch[1] });
            j++;
          } else {
            break;
          }
        }

        if (group.length >= 2) {
          const entries = group.map((g) => `${g.key}: ${g.valNum}`).join(", ");
          this.writeLine(`tokens ${ns}[${unit}]: ${entries}`);
          i = j;
          continue;
        }
      }

      if (!p.value) {
        this.writeLine(p.property);
      } else {
        const normalizedVal = p.value.replace(/\r?\n\s*/g, " ").trim();
        this.writeLine(`${p.property}: ${normalizedVal}`);
      }
      i++;
    }
    this.dedent();
  }

  public formatExpr(expr: Expr): string {
    switch (expr.kind) {
      case "LiteralExpr": {
        if (expr.literalKind === "string") {
          if (
            typeof expr.value === "string" &&
            expr.value.includes("\n") &&
            !expr.value.includes("`") &&
            !expr.value.includes('"""')
          ) {
            return `"""\n${expr.value}\n"""`;
          }
          return JSON.stringify(expr.value);
        }
        if (expr.literalKind === "nil") {
          return "nil";
        }
        if (expr.literalKind === "number" && expr.rawValue !== undefined && expr.rawValue !== "") {
          return expr.rawValue;
        }
        return String(expr.value);
      }
      case "TemplateLiteralExpr": {
        const escapeQuasi = (q: string) => q.replace(/(?<!\\)`/g, "\\`");
        let result = "`" + escapeQuasi(expr.quasis[0] ?? "");
        for (let i = 0; i < expr.expressions.length; i++) {
          result +=
            "${" +
            this.formatExpr(expr.expressions[i]) +
            "}" +
            escapeQuasi(expr.quasis[i + 1] ?? "");
        }
        result += "`";
        return result;
      }
      case "IdentifierExpr":
        return expr.name;
      case "BinaryExpr": {
        const op = expr.operator === "&&" ? "and" : expr.operator === "||" ? "or" : expr.operator;
        const leftStr = needsBinaryParentheses(expr.operator, expr.left, false)
          ? `(${this.formatExpr(expr.left)})`
          : this.formatExpr(expr.left);
        const rightStr = needsBinaryParentheses(expr.operator, expr.right, true)
          ? `(${this.formatExpr(expr.right)})`
          : this.formatExpr(expr.right);
        return `${leftStr} ${op} ${rightStr}`;
      }
      case "UnaryExpr": {
        if (expr.operator === "...") {
          return `...${this.formatExpr(expr.operand)}`;
        }
        const op =
          expr.operator === "!" ? "not " : expr.operator === "not" ? "not " : expr.operator;
        const operand = this.formatExpr(expr.operand);
        if (
          expr.operand.kind === "BinaryExpr" ||
          expr.operand.kind === "AssignExpr" ||
          expr.operand.kind === "ClosureExpr" ||
          (expr.operator === "-" &&
            expr.operand.kind === "UnaryExpr" &&
            expr.operand.operator === "-")
        ) {
          return `${op}(${operand})`;
        }
        return `${op}${operand}`;
      }
      case "PostfixTryExpr": {
        const operandStr = this.formatExpr(expr.operand);
        const needsParen =
          expr.operand.kind === "AssignExpr" ||
          expr.operand.kind === "BinaryExpr" ||
          expr.operand.kind === "ClosureExpr";
        return needsParen ? `(${operandStr})?` : `${operandStr}?`;
      }
      case "CallExpr": {
        const args = expr.args
          .map((a) => {
            if (a.kind === "AssignExpr") {
              return `(${this.formatExpr(a)})`;
            }
            return this.formatExpr(a);
          })
          .join(", ");
        const needsParen =
          expr.callee.kind !== "IdentifierExpr" &&
          expr.callee.kind !== "MemberAccessExpr" &&
          expr.callee.kind !== "CallExpr" &&
          expr.callee.kind !== "IndexExpr";
        const calleeStr = needsParen
          ? `(${this.formatExpr(expr.callee)})`
          : this.formatExpr(expr.callee);
        const opt = expr.isOptional ? "?." : "";
        return `${calleeStr}${opt}(${args})`;
      }
      case "MemberAccessExpr": {
        const dot = expr.isSafeNav ? "?." : ".";
        const needsParen =
          expr.object.kind === "BinaryExpr" ||
          expr.object.kind === "UnaryExpr" ||
          expr.object.kind === "AssignExpr" ||
          expr.object.kind === "ClosureExpr";
        const objStr = needsParen
          ? `(${this.formatExpr(expr.object)})`
          : this.formatExpr(expr.object);
        return `${objStr}${dot}${expr.property}`;
      }
      case "IndexExpr": {
        const needsParen =
          expr.object.kind === "BinaryExpr" ||
          expr.object.kind === "UnaryExpr" ||
          expr.object.kind === "AssignExpr" ||
          expr.object.kind === "ClosureExpr";
        const objStr = needsParen
          ? `(${this.formatExpr(expr.object)})`
          : this.formatExpr(expr.object);
        return `${objStr}[${this.formatExpr(expr.index)}]`;
      }
      case "ArrayLiteralExpr": {
        const items = expr.elements
          .map((e) => {
            if (e.kind === "AssignExpr") {
              return `(${this.formatExpr(e)})`;
            }
            return this.formatExpr(e);
          })
          .join(", ");
        return `[${items}]`;
      }
      case "RecordLiteralExpr": {
        if (expr.properties.length === 0) {
          return "{}";
        }
        const props = expr.properties
          .map((p) => {
            if (p.isSpread) {
              return `...${this.formatExpr(p.value)}`;
            }
            if (p.value.kind === "IdentifierExpr" && p.value.name === p.key) {
              return p.key; // Shorthand
            }
            const valStr =
              p.value.kind === "AssignExpr"
                ? `(${this.formatExpr(p.value)})`
                : this.formatExpr(p.value);
            return `${this.formatRecordKey(p.key)}: ${valStr}`;
          })
          .join(", ");
        return `{ ${props} }`;
      }
      case "ClosureExpr": {
        const fnKw = expr.isAsync ? "async fn" : "fn";
        const params = expr.params
          .map((p) => {
            const opt = p.isOptional ? "?" : "";
            const def = p.defaultValue ? ` = ${this.formatExpr(p.defaultValue)}` : "";
            const rest = p.isRest ? "..." : "";
            return p.typeAnnotation
              ? `${rest}${p.name}${opt}:${this.formatTypeExpr(p.typeAnnotation)}${def}`
              : `${rest}${p.name}${opt}${def}`;
          })
          .join(", ");
        const retStr = expr.returnType ? ` -> ${this.formatTypeExpr(expr.returnType)}` : "";

        if ("kind" in expr.body && expr.body.kind !== "Block") {
          if (
            (expr.body as any).kind === "LetBinding" ||
            (expr.body as any).kind === "DestructureBinding" ||
            (expr.body as any).kind === "VarDecl" ||
            (expr.body as any).kind === "IfStmt" ||
            (expr.body as any).kind === "WhileStmt" ||
            (expr.body as any).kind === "ForStmt" ||
            (expr.body as any).kind === "TryStmt" ||
            (expr.body as any).kind === "MatchStmt"
          ) {
            const prevCurly = this.inCurlyBlock;
            this.inCurlyBlock = true;
            try {
              const outerIndent = this.getIndent();
              this.indent();
              const stmtStr = this.formatStatement(
                expr.body as unknown as Statement,
                this.getIndent(),
              );
              this.dedent();
              return `${fnKw}(${params})${retStr} {\n${stmtStr}\n${outerIndent}}`;
            } finally {
              this.inCurlyBlock = prevCurly;
            }
          }
          const bodyExpr = expr.body as Expr;
          const bodyStr = this.formatExpr(bodyExpr);
          if (bodyExpr.kind === "AssignExpr") {
            return `${fnKw}(${params})${retStr} = (${bodyStr})`;
          }
          return `${fnKw}(${params})${retStr} = ${bodyStr}`;
        }

        if (expr.body.kind === "Block") {
          const stmts = expr.body.statements;
          if (stmts.length === 0) {
            return `${fnKw}(${params})${retStr} = nil`;
          }
          if (stmts.length === 1) {
            const stmt = stmts[0];
            if (stmt.kind === "ReturnStmt") {
              if (stmt.value) {
                const valStr = this.formatExpr(stmt.value);
                if (stmt.value.kind === "AssignExpr") {
                  return `${fnKw}(${params})${retStr} = (${valStr})`;
                }
                return `${fnKw}(${params})${retStr} = ${valStr}`;
              }
              return `${fnKw}(${params})${retStr} = nil`;
            }
            if (stmt.kind === "ExprStmt") {
              const bodyStr = this.formatExpr(stmt.expr);
              if (stmt.expr.kind === "AssignExpr") {
                return `${fnKw}(${params})${retStr} = (${bodyStr})`;
              }
              return `${fnKw}(${params})${retStr} = ${bodyStr}`;
            }
            if (stmt.kind === "AssignStmt") {
              const op = stmt.op ?? "=";
              return `${fnKw}(${params})${retStr} = (${this.formatExpr(stmt.target)} ${op} ${this.formatExpr(stmt.value)})`;
            }
          }

          const prevCurly = this.inCurlyBlock;
          this.inCurlyBlock = true;
          try {
            const outerIndent = this.getIndent();
            this.indent();
            const blockBody = this.formatBlock(expr.body);
            this.dedent();
            return `${fnKw}(${params})${retStr} {\n${blockBody}\n${outerIndent}}`;
          } finally {
            this.inCurlyBlock = prevCurly;
          }
        }

        return `${fnKw}(${params})${retStr} = nil`;
      }
      case "AssignExpr": {
        const op = expr.op ?? "=";
        return `${this.formatExpr(expr.target)} ${op} ${this.formatExpr(expr.value)}`;
      }
      case "AwaitExpr": {
        const operandStr = this.formatExpr(expr.operand);
        const needsParen =
          expr.operand.kind === "AssignExpr" ||
          expr.operand.kind === "BinaryExpr" ||
          expr.operand.kind === "ClosureExpr";
        return needsParen ? `await (${operandStr})` : `await ${operandStr}`;
      }
      case "MatchExpr" as any: {
        const targetStr = this.formatExpr((expr as any).target);
        this.indent();
        const cases =
          (expr as any).cases && (expr as any).cases.length > 0
            ? (expr as any).cases.map((mc: any) => this.formatMatchCase(mc)).join("\n")
            : `${this.getIndent()}case _ => nil`;
        this.dedent();
        return `match ${targetStr}:\n${cases}`;
      }
    }
    return "";
  }

  public formatTypeExpr(t: TypeExpr | null | undefined): string {
    if (!t) return "";
    switch (t.kind) {
      case "PrimitiveType":
        return t.primitive;
      case "ArrayType":
        return `[${this.formatTypeExpr(t.elementType)}]`;
      case "TupleType": {
        const elements = t.elementTypes.map((e) => this.formatTypeExpr(e)).join(", ");
        return t.elementTypes.length === 1 ? `[${elements},]` : `[${elements}]`;
      }
      case "RecordType": {
        const fields = t.fields.map((f) => `${f.name}:${this.formatTypeExpr(f.type)}`).join(", ");
        return `{ ${fields} }`;
      }
      case "ResultType":
        return `Result[${this.formatTypeExpr(t.okType)}, ${this.formatTypeExpr(t.errType)}]`;
      case "OptionType": {
        const inner = this.formatTypeExpr(t.innerType);
        if (
          t.innerType.kind === "PrimitiveType" ||
          (t.innerType.kind === "NamedType" &&
            !t.innerType.name.includes(" ") &&
            !t.innerType.name.includes("(") &&
            !t.innerType.name.includes("=>") &&
            !t.innerType.typeArgs) ||
          t.innerType.kind === "ArrayType" ||
          t.innerType.kind === "TupleType"
        ) {
          return `${inner}?`;
        }
        return `Option[${inner}]`;
      }
      case "RefinementType":
        return `{ ${t.param}:${t.baseType.primitive} | ${this.formatExpr(t.predicate)} }`;
      case "NamedType": {
        if (t.typeArgs && t.typeArgs.length > 0) {
          const args = t.typeArgs.map((ta) => this.formatTypeExpr(ta)).join(", ");
          return `${t.name}[${args}]`;
        }
        if (t.name === "null" || t.name === "undefined") {
          return "nil";
        }
        if (t.name.includes("|")) {
          const rawParts = t.name.split("|").map((p) => p.trim());
          const hasNullOrUndefined = rawParts.some(
            (p) => p === "null" || p === "undefined" || p === "nil",
          );
          if (hasNullOrUndefined) {
            const nonNullParts = rawParts.filter(
              (p) => p !== "null" && p !== "undefined" && p !== "nil",
            );
            if (nonNullParts.length === 1) {
              const single = nonNullParts[0];
              if (
                !single.includes(" ") &&
                !single.includes("(") &&
                !single.includes("=>") &&
                !single.includes("[")
              ) {
                return `${single}?`;
              }
              return `${single} | nil`;
            } else if (nonNullParts.length > 1) {
              return `${nonNullParts.join(" | ")} | nil`;
            } else {
              return "nil";
            }
          }
        }
        return t.name;
      }
    }
  }

  public formatRecordKey(key?: string): string {
    if (key === undefined) return "";
    if (key === "") return '""';
    // If it is already quoted or computed [expr], emit as is
    if (
      (key.startsWith('"') && key.endsWith('"')) ||
      (key.startsWith("'") && key.endsWith("'")) ||
      (key.startsWith("[") && key.endsWith("]"))
    ) {
      return key;
    }
    // If it is numeric (e.g. 1, 2, 42, 3.14, -5), emit as is
    if (/^-?\d+(?:\.\d+)?$/.test(key)) {
      return key;
    }
    // If it is a valid identifier (e.g. multiplier, bonus), emit as is
    if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
      return key;
    }
    // Otherwise (e.g. special characters, hyphens, spaces), quote it cleanly
    return JSON.stringify(key);
  }
}
