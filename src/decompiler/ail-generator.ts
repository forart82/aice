/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AIL 2.0 Code Generator
 * Serializes an AIL Module AST and optional CstTriviaTable into clean, token-dense .ail code.
 */

import type {
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
import type { CstTriviaTable } from "../core/trivia.js";

export interface AilGeneratorOptions {
  indent?: string;
  trivia?: CstTriviaTable;
}

export class AilGenerator {
  private indentStr: string;
  private currentIndent = 0;
  private buffer: string[] = [];
  private trivia?: CstTriviaTable;

  constructor(options: AilGeneratorOptions = {}) {
    this.indentStr = options.indent ?? "  ";
    this.trivia = options.trivia;
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
            const clean = item.content
              .trim()
              .replace(/^\/\//, "#")
              .replace(/^\/\*+/, "#")
              .replace(/\*\/$/, "");
            trailing += `  ${clean}`;
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
      const lines = item.content.split("\n");
      for (const line of lines) {
        // Normalize comments to # for AIL
        const trimmed = line.trim();
        if (trimmed.startsWith("//")) {
          this.writeLine(`# ${trimmed.slice(2).trim()}`);
        } else if (trimmed.startsWith("/*") || trimmed.startsWith("/**")) {
          const clean = trimmed
            .replace(/^\/\*\*?/, "")
            .replace(/\*\/$/, "")
            .trim();
          if (clean) this.writeLine(`# ${clean}`);
        } else if (trimmed.startsWith("#")) {
          this.writeLine(trimmed);
        } else if (trimmed) {
          this.writeLine(`# ${trimmed}`);
        }
      }
    }
  }

  private emitImport(imp: ImportDecl): void {
    const nodeId = `import:${imp.source}`;
    this.emitLeadingTrivia(nodeId);

    if (imp.specifiers.length === 1 && imp.specifiers[0].isWildcard) {
      this.writeLine(`from "${imp.source}" import * as ${imp.specifiers[0].alias ?? "mod"}`);
      return;
    }

    const specs = imp.specifiers.map((s) => (s.alias ? `${s.name} as ${s.alias}` : s.name));
    this.writeLine(`from "${imp.source}" import ${specs.join(", ")}`);
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
    const primaryCtor = c.primaryConstructor && c.primaryConstructor.length > 0
      ? `(${c.primaryConstructor.map((p) => {
          const pPub = p.isPub ? "pub " : "";
          const pRo = p.isReadonly ? "readonly " : "";
          const pMut = p.isMut ? "mut " : "";
          const def = p.defaultValue ? ` = ${this.formatExpr(p.defaultValue)}` : "";
          return `${pPub}${pRo}${pMut}${p.name}:${this.formatTypeExpr(p.typeAnnotation)}${def}`;
        }).join(", ")})`
      : "";
    const ext = c.extends ? ` extends ${c.extends}` : "";
    const impl = c.implements && c.implements.length > 0 ? ` implements ${c.implements.join(", ")}` : "";

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
        const aliases = p.aliases && p.aliases.length > 0 ? p.aliases : (p.alias ? [p.alias] : []);
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
            const def = p.defaultValue ? ` = ${this.formatExpr(p.defaultValue)}` : "";
            return `${p.name}:${this.formatTypeExpr(p.typeAnnotation)}${def}`;
          })
          .join(", ");
        const ret = m.returnType ? ` -> ${this.formatTypeExpr(m.returnType)}` : "";

        if (m.isExpressionBodied) {
          if (m.accessor === "get") {
            this.writeLine(
              `${st}get ${m.name}()${ret} = ${this.formatExpr(m.body as Expr)}`,
              mNodeId,
            );
          } else if (m.accessor === "set") {
            this.writeLine(
              `${st}set ${m.name}(${params}) = ${this.formatExpr(m.body as Expr)}`,
              mNodeId,
            );
          } else {
            this.writeLine(
              `${st}${as}fn ${m.name}(${params})${ret} = ${this.formatExpr(m.body as Expr)}`,
              mNodeId,
            );
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
              this.writeLine("pass");
            } else {
              this.emitBlock(m.body, true);
            }
          } else {
            this.writeLine(this.formatExpr(m.body));
          }
          this.dedent();
        }
      }
    }

    this.dedent();
  }

  private emitConstDecl(c: ConstDecl): void {
    const nodeId = `const:${c.name}`;
    this.emitLeadingTrivia(nodeId);
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
        const def = p.defaultValue ? ` = ${this.formatExpr(p.defaultValue)}` : "";
        return `${p.name}:${this.formatTypeExpr(p.typeAnnotation)}${def}`;
      })
      .join(", ");

    if (fn.isExpressionBodied && !Array.isArray((fn.body as Block).statements)) {
      const retType = fn.returnType ? ` -> ${this.formatTypeExpr(fn.returnType)}` : "";
      this.writeLine(`fn ${fn.name}(${params})${retType} = ${this.formatExpr(fn.body as Expr)}`);
      return;
    }

    const retType = fn.returnType ? ` -> ${this.formatTypeExpr(fn.returnType)}` : "";
    this.writeLine(`fn ${fn.name}(${params})${retType}:`);
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

  private emitStatement(stmt: Statement, isTail = false): void {
    switch (stmt.kind) {
      case "LetBinding": {
        const op = stmt.isMut ? "::=" : ":=";
        const typeAnn = stmt.typeAnnotation ? `: ${this.formatTypeExpr(stmt.typeAnnotation)} ` : " ";
        this.writeLine(`${stmt.name}${typeAnn}${op} ${this.formatExpr(stmt.init)}`);
        break;
      }
      case "DestructureBinding": {
        const op = stmt.isMut ? "::=" : ":=";
        const names = stmt.names.join(", ");
        this.writeLine(`[${names}] ${op} ${this.formatExpr(stmt.init)}`);
        break;
      }
      case "AssignStmt": {
        this.writeLine(`${this.formatExpr(stmt.target)} ${stmt.op ?? "="} ${this.formatExpr(stmt.value)}`);
        break;
      }
      case "ReturnStmt": {
        if (stmt.value) {
          if (isTail) {
            this.writeLine(this.formatExpr(stmt.value));
          } else {
            this.writeLine(`ret ${this.formatExpr(stmt.value)}`);
          }
        } else {
          this.writeLine("ret");
        }
        break;
      }
      case "ExprStmt": {
        this.writeLine(this.formatExpr(stmt.expr));
        break;
      }
      case "IfStmt": {
        this.writeLine(`if ${this.formatExpr(stmt.condition)}:`);
        this.indent();
        this.emitBlock(stmt.thenBranch, isTail);
        this.dedent();

        for (const elif of stmt.elifBranches) {
          this.writeLine(`elif ${this.formatExpr(elif.condition)}:`);
          this.indent();
          this.emitBlock(elif.body, isTail);
          this.dedent();
        }

        if (stmt.elseBranch) {
          this.writeLine("else:");
          this.indent();
          this.emitBlock(stmt.elseBranch, isTail);
          this.dedent();
        }
        break;
      }
      case "MatchStmt": {
        this.writeLine(`match ${this.formatExpr(stmt.target)}:`);
        this.indent();
        for (const mc of stmt.cases) {
          this.emitMatchCase(mc);
        }
        this.dedent();
        break;
      }
      case "ForStmt": {
        this.writeLine(`for ${stmt.variable} in ${this.formatExpr(stmt.iterable)}:`);
        this.indent();
        this.emitBlock(stmt.body);
        this.dedent();
        break;
      }
      case "WhileStmt": {
        this.writeLine(`while ${this.formatExpr(stmt.condition)}:`);
        this.indent();
        this.emitBlock(stmt.body);
        this.dedent();
        break;
      }
    }
  }

  private emitMatchCase(mc: MatchCase): void {
    const patternStr = this.formatPattern(mc.pattern);
    const guardStr = mc.guard ? ` if ${this.formatExpr(mc.guard)}` : "";
    if ("statements" in mc.body) {
      this.writeLine(`case ${patternStr}${guardStr} =>`);
      this.indent();
      this.emitBlock(mc.body);
      this.dedent();
    } else {
      this.writeLine(`case ${patternStr}${guardStr} => ${this.formatExpr(mc.body)}`);
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
      .map((p) => `${p.name}:${this.formatTypeExpr(p.typeAnnotation)}`)
      .join(", ");

    this.writeLine(`component ${comp.name}(${params}):`);
    this.indent();
    for (const node of comp.layout) {
      this.emitLayoutNode(node);
    }
    this.dedent();
  }

  private emitLayoutNode(node: LayoutNode): void {
    const attrs = node.attributes.map((a) => `${a.name}: ${this.formatExpr(a.value)}`).join(", ");
    const attrStr = attrs.length > 0 ? `(${attrs})` : "";

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
      this.writeLine(`${node.tag}${attrStr}: "{${this.formatExpr(node.childExpr)}}"`);
      return;
    }

    this.writeLine(`${node.tag}${attrStr}:`);
    this.indent();
    if (hasText) {
      this.writeLine(`"${node.textLiteral}"`);
    }
    if (node.childExpr) {
      this.writeLine(`"{${this.formatExpr(node.childExpr)}}"`);
    }
    for (const child of node.children) {
      this.emitLayoutNode(child);
    }
    this.dedent();
  }

  private emitStyleDecl(s: StyleDecl): void {
    const nodeId = `style:${s.name}`;
    this.emitLeadingTrivia(nodeId);

    const nameStr = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s.name) ? s.name : `"${s.name}"`;
    this.writeLine(`style ${nameStr}:`);
    this.indent();
    for (const p of s.properties) {
      this.writeLine(`${p.property}: ${p.value}`);
    }
    this.dedent();
  }

  public formatExpr(expr: Expr): string {
    switch (expr.kind) {
      case "LiteralExpr": {
        if (expr.literalKind === "string") {
          return JSON.stringify(expr.value);
        }
        if (expr.literalKind === "nil") {
          return "nil";
        }
        return String(expr.value);
      }
      case "IdentifierExpr":
        return expr.name;
      case "BinaryExpr": {
        const op = expr.operator === "&&" ? "and" : expr.operator === "||" ? "or" : expr.operator;
        return `${this.formatExpr(expr.left)} ${op} ${this.formatExpr(expr.right)}`;
      }
      case "UnaryExpr": {
        const op =
          expr.operator === "!" ? "not " : expr.operator === "not" ? "not " : expr.operator;
        const operand = this.formatExpr(expr.operand);
        if (expr.operand.kind === "BinaryExpr") {
          return `${op}(${operand})`;
        }
        return `${op}${operand}`;
      }
      case "PostfixTryExpr":
        return `${this.formatExpr(expr.operand)}?`;
      case "CallExpr": {
        const args = expr.args.map((a) => this.formatExpr(a)).join(", ");
        return `${this.formatExpr(expr.callee)}(${args})`;
      }
      case "MemberAccessExpr": {
        const dot = expr.isSafeNav ? "?." : ".";
        return `${this.formatExpr(expr.object)}${dot}${expr.property}`;
      }
      case "IndexExpr":
        return `${this.formatExpr(expr.object)}[${this.formatExpr(expr.index)}]`;
      case "ArrayLiteralExpr": {
        const items = expr.elements.map((e) => this.formatExpr(e)).join(", ");
        return `[${items}]`;
      }
      case "RecordLiteralExpr": {
        const props = expr.properties
          .map((p) => {
            if (p.isSpread) {
              return `...${this.formatExpr(p.value)}`;
            }
            if (p.value.kind === "IdentifierExpr" && p.value.name === p.key) {
              return p.key; // Shorthand
            }
            return `${p.key}: ${this.formatExpr(p.value)}`;
          })
          .join(", ");
        return `{ ${props} }`;
      }
      case "ClosureExpr": {
        const params = expr.params
          .map((p) => `${p.name}:${this.formatTypeExpr(p.typeAnnotation)}`)
          .join(", ");
        if ("kind" in expr.body && expr.body.kind !== "Block") {
          return `fn(${params}) = ${this.formatExpr(expr.body as Expr)}`;
        }
        if (expr.body.kind === "Block") {
          if (
            expr.body.statements.length === 1 &&
            expr.body.statements[0].kind === "ReturnStmt" &&
            expr.body.statements[0].value
          ) {
            return `fn(${params}) = ${this.formatExpr(expr.body.statements[0].value)}`;
          }
          if (expr.body.statements.length === 0) {
            return `fn(${params}) = nil`;
          }
        }
        return `fn(${params}) = nil`;
      }
      case "AssignExpr":
        return `${this.formatExpr(expr.target)} ${expr.op ?? "="} ${this.formatExpr(expr.value)}`;
    }
  }

  public formatTypeExpr(t: TypeExpr): string {
    switch (t.kind) {
      case "PrimitiveType":
        return t.primitive;
      case "ArrayType":
        return `[${this.formatTypeExpr(t.elementType)}]`;
      case "RecordType": {
        const fields = t.fields.map((f) => `${f.name}:${this.formatTypeExpr(f.type)}`).join(", ");
        return `{ ${fields} }`;
      }
      case "ResultType":
        return `Result[${this.formatTypeExpr(t.okType)}, ${this.formatTypeExpr(t.errType)}]`;
      case "OptionType":
        return `Option[${this.formatTypeExpr(t.innerType)}]`;
      case "RefinementType":
        return `{ ${t.param}:${t.baseType.primitive} | ${this.formatExpr(t.predicate)} }`;
      case "NamedType": {
        if (t.typeArgs && t.typeArgs.length > 0) {
          const args = t.typeArgs.map((ta) => this.formatTypeExpr(ta)).join(", ");
          return `${t.name}[${args}]`;
        }
        return t.name;
      }
    }
  }
}
