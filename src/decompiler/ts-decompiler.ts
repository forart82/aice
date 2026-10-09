/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * TypeScript & TSX Decompiler (Reverse Transpiler) for AIL 2.0.
 * Parses TypeScript/TSX code using the TypeScript Compiler API,
 * extracts CST trivia (comments, JSDoc) into CstTriviaTable,
 * and lowers the AST into an AIL Module AST.
 */

import ts from "typescript";
import type {
  BinaryOp,
  Block,
  ClassDecl,
  ComponentDecl,
  ConstDecl,
  Expr,
  FieldDecl,
  FunctionDecl,
  IfStmt,
  ImportDecl,
  ImportSpecifier,
  LayoutNode,
  LiteralExpr,
  MethodDecl,
  Module,
  ModuleItem,
  ParamDecl,
  PrimitiveType,
  PropertyDecl,
  RecordProperty,
  Statement,
  TypeDecl,
  TypeExpr,
  VarDecl,
} from "../core/ast.js";
import { createPosition, createSpan, emptySpan, mergeSpans, type Span } from "../core/span.js";
import { CstTriviaTable, type TriviaItem, type TriviaKind } from "../core/trivia.js";

export interface TsDecompilerOptions {
  modulePath?: string;
  isTsx?: boolean;
}

export class TsDecompiler {
  private source: string;
  private filePath: string;
  private isTsx: boolean;
  private sourceFile!: ts.SourceFile;
  private trivia = new CstTriviaTable();
  private knownTypeNames = new Set<string>();

  constructor(source: string, filePath = "source.ts", options: TsDecompilerOptions = {}) {
    this.source = source;
    this.filePath = filePath;
    this.isTsx = options.isTsx ?? (filePath.endsWith(".tsx") || source.includes("<"));
  }

  decompile(): { ast: Module; trivia: CstTriviaTable } {
    this.knownTypeNames.clear();
    const scriptKind = this.isTsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    this.sourceFile = ts.createSourceFile(
      this.filePath,
      this.source,
      ts.ScriptTarget.ES2022,
      true,
      scriptKind,
    );

    const items: ModuleItem[] = [];

    // Derive module path from file name
    const cleanModPath = this.filePath
      .replace(/^(\.\/|\/)/, "")
      .replace(/\.(tsx?|jsx?)$/, "")
      .replace(/\.ail$/, "");

    for (const stmt of this.sourceFile.statements) {
      const item = this.convertTopLevelStatement(stmt);
      if (item) {
        if (Array.isArray(item)) {
          items.push(...item);
        } else {
          items.push(item);
        }
      }
    }

    const ast: Module = {
      kind: "Module",
      path: cleanModPath || "main",
      items,
      span: this.getSpan(this.sourceFile),
    };

    return { ast, trivia: this.trivia };
  }

  private extractComments(node: ts.Node, nodeId: string): void {
    const leading = ts.getLeadingCommentRanges(this.source, node.pos) ?? [];
    for (const comment of leading) {
      const text = this.source.slice(comment.pos, comment.end);
      const kind: TriviaKind =
        comment.kind === ts.SyntaxKind.SingleLineCommentTrivia
          ? "LINE_COMMENT"
          : text.startsWith("/**")
            ? "DOCSTRING"
            : "BLOCK_COMMENT";

      const item: TriviaItem = {
        kind,
        content: text,
      };
      this.trivia.addLeadingTrivia(nodeId, item);
    }

    const trailing = ts.getTrailingCommentRanges(this.source, node.end) ?? [];
    for (const comment of trailing) {
      const text = this.source.slice(comment.pos, comment.end);
      const kind: TriviaKind =
        comment.kind === ts.SyntaxKind.SingleLineCommentTrivia ? "LINE_COMMENT" : "BLOCK_COMMENT";

      const item: TriviaItem = {
        kind,
        content: text,
      };
      this.trivia.addTrailingTrivia(nodeId, item);
    }
  }

  private getSpan(node: ts.Node): Span {
    const startPos = this.sourceFile.getLineAndCharacterOfPosition(node.getStart(this.sourceFile));
    const endPos = this.sourceFile.getLineAndCharacterOfPosition(node.getEnd());
    return createSpan(
      this.filePath,
      createPosition(startPos.line + 1, startPos.character + 1, node.getStart(this.sourceFile)),
      createPosition(endPos.line + 1, endPos.character + 1, node.getEnd()),
    );
  }

  private convertTopLevelStatement(stmt: ts.Statement): ModuleItem | ModuleItem[] | null {
    if (ts.isImportDeclaration(stmt)) {
      return this.convertImportDeclaration(stmt);
    }

    if (ts.isInterfaceDeclaration(stmt)) {
      return this.convertInterfaceDeclaration(stmt);
    }

    if (ts.isTypeAliasDeclaration(stmt)) {
      return this.convertTypeAliasDeclaration(stmt);
    }

    if (ts.isFunctionDeclaration(stmt)) {
      return this.convertFunctionDeclaration(stmt);
    }

    if (ts.isClassDeclaration(stmt)) {
      return this.convertClassDeclaration(stmt);
    }

    if (ts.isVariableStatement(stmt)) {
      return this.convertVariableStatement(stmt);
    }

    if (ts.isEnumDeclaration(stmt)) {
      return this.convertEnumDeclaration(stmt);
    }

    return null;
  }

  private convertImportDeclaration(stmt: ts.ImportDeclaration): ImportDecl | null {
    const moduleSpecifier = stmt.moduleSpecifier;
    if (!ts.isStringLiteral(moduleSpecifier)) return null;

    const source = moduleSpecifier.text;
    const nodeId = `import:${source}`;
    this.extractComments(stmt, nodeId);

    const specifiers: ImportSpecifier[] = [];

    if (stmt.importClause) {
      // Default import: import foo from 'bar'
      if (stmt.importClause.name) {
        specifiers.push({
          name: stmt.importClause.name.text,
          span: this.getSpan(stmt.importClause.name),
        });
      }

      // Named imports: import { a, b as c } from 'bar'
      if (stmt.importClause.namedBindings) {
        if (ts.isNamedImports(stmt.importClause.namedBindings)) {
          for (const el of stmt.importClause.namedBindings.elements) {
            specifiers.push({
              name: (el.propertyName ?? el.name).text,
              alias: el.propertyName ? el.name.text : undefined,
              span: this.getSpan(el),
            });
          }
        } else if (ts.isNamespaceImport(stmt.importClause.namedBindings)) {
          specifiers.push({
            name: "*",
            alias: stmt.importClause.namedBindings.name.text,
            isWildcard: true,
            span: this.getSpan(stmt.importClause.namedBindings),
          });
        }
      }
    }

    return {
      kind: "ImportDecl",
      source,
      specifiers,
      span: this.getSpan(stmt),
    };
  }

  private convertInterfaceDeclaration(stmt: ts.InterfaceDeclaration): TypeDecl {
    const name = stmt.name.text;
    this.knownTypeNames.add(name);
    const nodeId = `type:${name}`;
    this.extractComments(stmt, nodeId);

    const fields: FieldDecl[] = [];
    for (const member of stmt.members) {
      if (ts.isPropertySignature(member) && member.name && ts.isIdentifier(member.name)) {
        const fieldName = member.name.text;
        const fieldNodeId = `field:${name}.${fieldName}`;
        this.extractComments(member, fieldNodeId);

        let typeAnn = member.type ? this.convertTypeNode(member.type) : this.makePrimitive("any");
        if (member.questionToken) {
          typeAnn = {
            kind: "OptionType",
            innerType: typeAnn,
            span: this.getSpan(member),
          };
        }

        fields.push({
          name: fieldName,
          typeAnnotation: typeAnn,
          span: this.getSpan(member),
        });
      }
    }

    return {
      kind: "TypeDecl",
      name,
      isEnum: false,
      typeParams: stmt.typeParameters?.map((p) => p.name.text) ?? [],
      fields,
      span: this.getSpan(stmt),
    };
  }

  private convertTypeAliasDeclaration(stmt: ts.TypeAliasDeclaration): TypeDecl {
    const name = stmt.name.text;
    this.knownTypeNames.add(name);
    const nodeId = `type:${name}`;
    this.extractComments(stmt, nodeId);

    // Check if it's a string literal union -> Enum
    if (ts.isUnionTypeNode(stmt.type)) {
      const allStringLiterals = stmt.type.types.every(
        (t) => ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal),
      );
      if (allStringLiterals) {
        const variants = stmt.type.types.map((t) => {
          const lit = (t as ts.LiteralTypeNode).literal as ts.StringLiteral;
          return {
            name: lit.text,
            span: this.getSpan(t),
          };
        });

        return {
          kind: "TypeDecl",
          name,
          isEnum: true,
          typeParams: [],
          variants,
          span: this.getSpan(stmt),
        };
      }
    }

    // Otherwise, standard type alias
    return {
      kind: "TypeDecl",
      name,
      isEnum: false,
      typeParams: stmt.typeParameters?.map((p) => p.name.text) ?? [],
      aliasType: this.convertTypeNode(stmt.type),
      span: this.getSpan(stmt),
    };
  }

  private convertFunctionDeclaration(
    stmt: ts.FunctionDeclaration,
  ): FunctionDecl | ComponentDecl | null {
    const name = stmt.name?.text ?? "anonymous";
    if (this.knownTypeNames.has(name)) {
      return null;
    }
    const nodeId = `fn:${name}`;
    this.extractComments(stmt, nodeId);

    const params: ParamDecl[] = [];
    if (stmt.parameters) {
      for (const p of stmt.parameters) {
        if (ts.isIdentifier(p.name)) {
          params.push({
            name: p.name.text,
            typeAnnotation: p.type ? this.convertTypeNode(p.type) : this.makePrimitive("any"),
            defaultValue: p.initializer ? this.convertExpression(p.initializer) : undefined,
            span: this.getSpan(p),
          });
        } else if (ts.isObjectBindingPattern(p.name)) {
          // Destructured parameter e.g. { title, badge }: Props
          for (const el of p.name.elements) {
            if (ts.isIdentifier(el.name)) {
              params.push({
                name: el.name.text,
                typeAnnotation: this.makePrimitive("str"), // Fallback default
                span: this.getSpan(el),
              });
            }
          }
        }
      }
    }

    // Check if function returns JSX -> ComponentDecl
    if (this.isTsx && stmt.body) {
      const jsxReturn = this.findJsxReturn(stmt.body);
      if (jsxReturn) {
        const layout = this.convertJsxToLayout(jsxReturn);
        return {
          kind: "ComponentDecl",
          name,
          params,
          layout: [layout],
          span: this.getSpan(stmt),
        };
      }
    }

    // Normal function declaration
    const returnType = stmt.type ? this.convertTypeNode(stmt.type) : null;
    const body = stmt.body
      ? this.convertBlock(stmt.body)
      : { kind: "Block" as const, statements: [], span: emptySpan() };

    // Detect if single return expression
    if (
      body.statements.length === 1 &&
      body.statements[0].kind === "ReturnStmt" &&
      body.statements[0].value
    ) {
      return {
        kind: "FunctionDecl",
        name,
        params,
        returnType,
        body: body.statements[0].value,
        isExpressionBodied: true,
        span: this.getSpan(stmt),
      };
    }

    return {
      kind: "FunctionDecl",
      name,
      params,
      returnType,
      body,
      isExpressionBodied: false,
      span: this.getSpan(stmt),
    };
  }

  private convertClassDeclaration(stmt: ts.ClassDeclaration): ClassDecl {
    const name = stmt.name?.text ?? "Anonymous";
    this.knownTypeNames.add(name);
    const nodeId = `class:${name}`;
    this.extractComments(stmt, nodeId);

    const isExported = stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
    const typeParams = stmt.typeParameters?.map((p) => p.name.text) ?? [];

    let extendsName: string | undefined;
    const implementsList: string[] = [];

    if (stmt.heritageClauses) {
      for (const hc of stmt.heritageClauses) {
        if (hc.token === ts.SyntaxKind.ExtendsKeyword) {
          extendsName = hc.types[0]?.expression.getText(this.sourceFile);
        } else if (hc.token === ts.SyntaxKind.ImplementsKeyword) {
          for (const t of hc.types) {
            implementsList.push(t.expression.getText(this.sourceFile));
          }
        }
      }
    }

    const properties: PropertyDecl[] = [];
    const methods: MethodDecl[] = [];

    for (const member of stmt.members) {
      if (ts.isPropertyDeclaration(member)) {
        const propName = ts.isIdentifier(member.name)
          ? member.name.text
          : member.name.getText(this.sourceFile);
        const pNodeId = `field:${name}.${propName}`;
        this.extractComments(member, pNodeId);

        const isStatic = member.modifiers?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword) ?? false;
        const isReadonly = member.modifiers?.some((m) => m.kind === ts.SyntaxKind.ReadonlyKeyword) ?? false;
        let typeAnn = member.type ? this.convertTypeNode(member.type) : undefined;
        if (member.questionToken && typeAnn) {
          typeAnn = {
            kind: "OptionType",
            innerType: typeAnn,
            span: this.getSpan(member),
          };
        }
        const initialValue = member.initializer ? this.convertExpression(member.initializer) : undefined;

        properties.push({
          kind: "PropertyDecl",
          name: propName,
          isStatic,
          isReadonly,
          typeAnnotation: typeAnn,
          initialValue,
          span: this.getSpan(member),
        });
      } else if (ts.isConstructorDeclaration(member)) {
        const mNodeId = `method:${name}.constructor`;
        this.extractComments(member, mNodeId);

        const params: ParamDecl[] = member.parameters.map((p) => {
          const pName = ts.isIdentifier(p.name) ? p.name.text : p.name.getText(this.sourceFile);
          return {
            name: pName,
            typeAnnotation: p.type ? this.convertTypeNode(p.type) : this.makePrimitive("any"),
            defaultValue: p.initializer ? this.convertExpression(p.initializer) : undefined,
            span: this.getSpan(p),
          };
        });

        const body: Block = member.body
          ? this.convertBlock(member.body)
          : { kind: "Block" as const, statements: [], span: this.getSpan(member) };

        methods.push({
          kind: "MethodDecl",
          name: "constructor",
          isStatic: false,
          isAsync: false,
          params,
          returnType: null,
          body,
          isExpressionBodied: false,
          span: this.getSpan(member),
        });
      } else if (ts.isMethodDeclaration(member)) {
        const methodName = ts.isIdentifier(member.name)
          ? member.name.text
          : member.name.getText(this.sourceFile);
        const mNodeId = `method:${name}.${methodName}`;
        this.extractComments(member, mNodeId);

        const isStatic = member.modifiers?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword) ?? false;
        const isAsync = member.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ?? false;
        const params: ParamDecl[] = member.parameters.map((p) => {
          const pName = ts.isIdentifier(p.name) ? p.name.text : p.name.getText(this.sourceFile);
          return {
            name: pName,
            typeAnnotation: p.type ? this.convertTypeNode(p.type) : this.makePrimitive("any"),
            defaultValue: p.initializer ? this.convertExpression(p.initializer) : undefined,
            span: this.getSpan(p),
          };
        });

        const returnType = member.type ? this.convertTypeNode(member.type) : null;
        let isExpressionBodied = false;
        let body: Block | Expr;

        if (member.body && member.body.statements.length === 1) {
          const singleStmt = member.body.statements[0];
          if (ts.isReturnStatement(singleStmt) && singleStmt.expression) {
            isExpressionBodied = true;
            body = this.convertExpression(singleStmt.expression);
          } else if (
            ts.isExpressionStatement(singleStmt) &&
            ts.isBinaryExpression(singleStmt.expression) &&
            singleStmt.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken
          ) {
            isExpressionBodied = true;
            body = {
              kind: "AssignExpr",
              target: this.convertExpression(singleStmt.expression.left),
              value: this.convertExpression(singleStmt.expression.right),
              span: this.getSpan(singleStmt),
            };
          } else {
            body = this.convertBlock(member.body);
          }
        } else {
          body = member.body
            ? this.convertBlock(member.body)
            : { kind: "Block" as const, statements: [], span: this.getSpan(member) };
        }

        methods.push({
          kind: "MethodDecl",
          name: methodName,
          isStatic,
          isAsync,
          params,
          returnType,
          body,
          isExpressionBodied,
          span: this.getSpan(member),
        });
      } else if (ts.isGetAccessor(member)) {
        const propName = ts.isIdentifier(member.name)
          ? member.name.text
          : member.name.getText(this.sourceFile);
        const mNodeId = `get:${name}.${propName}`;
        this.extractComments(member, mNodeId);
        const returnType = member.type ? this.convertTypeNode(member.type) : null;
        let isExpressionBodied = false;
        let body: Block | Expr;

        if (member.body && member.body.statements.length === 1) {
          const singleStmt = member.body.statements[0];
          if (ts.isReturnStatement(singleStmt) && singleStmt.expression) {
            isExpressionBodied = true;
            body = this.convertExpression(singleStmt.expression);
          } else {
            body = this.convertBlock(member.body);
          }
        } else {
          body = member.body
            ? this.convertBlock(member.body)
            : { kind: "Block" as const, statements: [], span: this.getSpan(member) };
        }

        methods.push({
          kind: "MethodDecl",
          name: propName,
          accessor: "get",
          isStatic: false,
          isAsync: false,
          params: [],
          returnType,
          body,
          isExpressionBodied,
          span: this.getSpan(member),
        });
      } else if (ts.isSetAccessor(member)) {
        const propName = ts.isIdentifier(member.name)
          ? member.name.text
          : member.name.getText(this.sourceFile);
        const mNodeId = `set:${name}.${propName}`;
        this.extractComments(member, mNodeId);
        const params: ParamDecl[] = member.parameters.map((p) => ({
          name: ts.isIdentifier(p.name) ? p.name.text : p.name.getText(this.sourceFile),
          typeAnnotation: p.type ? this.convertTypeNode(p.type) : this.makePrimitive("any"),
          defaultValue: p.initializer ? this.convertExpression(p.initializer) : undefined,
          span: this.getSpan(p),
        }));
        let isExpressionBodied = false;
        let body: Block | Expr;

        if (member.body && member.body.statements.length === 1) {
          const singleStmt = member.body.statements[0];
          if (
            ts.isExpressionStatement(singleStmt) &&
            ts.isBinaryExpression(singleStmt.expression) &&
            singleStmt.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken
          ) {
            isExpressionBodied = true;
            body = {
              kind: "AssignExpr",
              target: this.convertExpression(singleStmt.expression.left),
              value: this.convertExpression(singleStmt.expression.right),
              span: this.getSpan(singleStmt),
            };
          } else {
            body = this.convertBlock(member.body);
          }
        } else {
          body = member.body
            ? this.convertBlock(member.body)
            : { kind: "Block" as const, statements: [], span: this.getSpan(member) };
        }

        methods.push({
          kind: "MethodDecl",
          name: propName,
          accessor: "set",
          isStatic: false,
          isAsync: false,
          params,
          returnType: this.makePrimitive("void"),
          body,
          isExpressionBodied,
          span: this.getSpan(member),
        });
      }
    }

    return {
      kind: "ClassDecl",
      name,
      isExported,
      typeParams,
      extends: extendsName,
      implements: implementsList.length > 0 ? implementsList : undefined,
      properties,
      methods,
      span: this.getSpan(stmt),
    };
  }

  private convertVariableStatement(stmt: ts.VariableStatement): ModuleItem[] {
    const isExported = stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
    const isConst = (stmt.declarationList.flags & ts.NodeFlags.Const) !== 0;
    const items: ModuleItem[] = [];

    for (const decl of stmt.declarationList.declarations) {
      const name = ts.isIdentifier(decl.name) ? decl.name.text : decl.name.getText(this.sourceFile);
      const nodeId = `${isConst ? "const" : "var"}:${name}`;
      this.extractComments(stmt, nodeId);

      const typeAnn = decl.type ? this.convertTypeNode(decl.type) : undefined;
      const value: Expr = decl.initializer
        ? this.convertExpression(decl.initializer)
        : { kind: "LiteralExpr", literalKind: "nil", value: null, rawValue: "nil", span: this.getSpan(decl) };

      if (isConst) {
        items.push({
          kind: "ConstDecl",
          name,
          isExported,
          typeAnnotation: typeAnn,
          value,
          span: this.getSpan(decl),
        });
      } else {
        items.push({
          kind: "VarDecl",
          name,
          isExported,
          isMut: true,
          typeAnnotation: typeAnn,
          value,
          span: this.getSpan(decl),
        });
      }
    }

    return items;
  }

  private convertEnumDeclaration(stmt: ts.EnumDeclaration): TypeDecl {
    const name = stmt.name.text;
    this.knownTypeNames.add(name);
    const nodeId = `type:${name}`;
    this.extractComments(stmt, nodeId);

    const variants = stmt.members.map((m) => ({
      name: ts.isIdentifier(m.name) ? m.name.text : m.name.getText(this.sourceFile),
      span: this.getSpan(m),
    }));

    return {
      kind: "TypeDecl",
      name,
      isEnum: true,
      typeParams: [],
      variants,
      span: this.getSpan(stmt),
    };
  }

  private findJsxReturn(block: ts.Block): ts.JsxElement | ts.JsxSelfClosingElement | null {
    for (const stmt of block.statements) {
      if (ts.isReturnStatement(stmt) && stmt.expression) {
        let expr = stmt.expression;
        if (ts.isParenthesizedExpression(expr)) {
          expr = expr.expression;
        }
        if (ts.isJsxElement(expr) || ts.isJsxSelfClosingElement(expr)) {
          return expr;
        }
      }
    }
    return null;
  }

  private convertJsxToLayout(jsx: ts.JsxElement | ts.JsxSelfClosingElement): LayoutNode {
    const opening = ts.isJsxElement(jsx) ? jsx.openingElement : jsx;
    const tagName = opening.tagName.getText(this.sourceFile);

    const attributes: { name: string; value: Expr; span: Span }[] = [];
    for (const prop of opening.attributes.properties) {
      if (ts.isJsxAttribute(prop) && prop.name) {
        let attrName = ts.isIdentifier(prop.name) ? prop.name.text : prop.name.name.text;
        if (attrName === "className") attrName = "class";

        let valExpr: Expr = {
          kind: "LiteralExpr",
          literalKind: "boolean",
          value: true,
          rawValue: "true",
          span: this.getSpan(prop),
        };

        if (prop.initializer) {
          if (ts.isStringLiteral(prop.initializer)) {
            valExpr = {
              kind: "LiteralExpr",
              literalKind: "string",
              value: prop.initializer.text,
              rawValue: JSON.stringify(prop.initializer.text),
              span: this.getSpan(prop.initializer),
            };
          } else if (ts.isJsxExpression(prop.initializer) && prop.initializer.expression) {
            valExpr = this.convertExpression(prop.initializer.expression);
          }
        }

        attributes.push({
          name: attrName,
          value: valExpr,
          span: this.getSpan(prop),
        });
      }
    }

    const children: LayoutNode[] = [];
    let textLiteral: string | null = null;
    let childExpr: Expr | null = null;

    if (ts.isJsxElement(jsx)) {
      for (const child of jsx.children) {
        if (ts.isJsxText(child)) {
          const text = child.getText(this.sourceFile).trim();
          if (text) {
            textLiteral = text;
          }
        } else if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) {
          children.push(this.convertJsxToLayout(child));
        } else if (ts.isJsxExpression(child) && child.expression) {
          childExpr = this.convertExpression(child.expression);
        }
      }
    }

    return {
      kind: "LayoutNode",
      tag: tagName,
      attributes,
      textLiteral,
      childExpr,
      children,
      span: this.getSpan(jsx),
    };
  }

  private convertBlock(block: ts.Block): Block {
    const statements: Statement[] = [];
    for (const stmt of block.statements) {
      if (ts.isVariableStatement(stmt) && stmt.declarationList.declarations.length > 1) {
        for (const decl of stmt.declarationList.declarations) {
          if (ts.isIdentifier(decl.name)) {
            const isMut = (stmt.declarationList.flags & ts.NodeFlags.Const) === 0;
            let init: Expr;
            if (decl.initializer) {
              init = this.convertExpression(decl.initializer);
            } else if (decl.type && decl.type.kind === ts.SyntaxKind.NumberKeyword) {
              init = { kind: "LiteralExpr", literalKind: "number", value: 0, rawValue: "0", span: this.getSpan(decl) };
            } else if (decl.type && decl.type.kind === ts.SyntaxKind.BooleanKeyword) {
              init = { kind: "LiteralExpr", literalKind: "boolean", value: false, rawValue: "false", span: this.getSpan(decl) };
            } else if (decl.type && decl.type.kind === ts.SyntaxKind.StringKeyword) {
              init = { kind: "LiteralExpr", literalKind: "string", value: "", rawValue: '""', span: this.getSpan(decl) };
            } else {
              init = { kind: "LiteralExpr", literalKind: "nil", value: null, rawValue: "nil", span: this.getSpan(decl) };
            }
            statements.push({
              kind: "LetBinding",
              name: decl.name.text,
              isMut: isMut || !decl.initializer,
              typeAnnotation: decl.type ? this.convertTypeNode(decl.type) : null,
              init,
              span: this.getSpan(decl),
            });
          }
        }
        continue;
      }
      const s = this.convertStatement(stmt);
      if (s) {
        statements.push(s);
      }
    }
    return {
      kind: "Block",
      statements,
      span: this.getSpan(block),
    };
  }

  private convertStatement(stmt: ts.Statement): Statement | null {
    if (ts.isVariableStatement(stmt)) {
      const decl = stmt.declarationList.declarations[0];
      if (decl && ts.isIdentifier(decl.name)) {
        const isMut = (stmt.declarationList.flags & ts.NodeFlags.Const) === 0;
        let init: Expr;
        if (decl.initializer) {
          init = this.convertExpression(decl.initializer);
        } else if (decl.type && decl.type.kind === ts.SyntaxKind.NumberKeyword) {
          init = { kind: "LiteralExpr", literalKind: "number", value: 0, rawValue: "0", span: this.getSpan(decl) };
        } else if (decl.type && decl.type.kind === ts.SyntaxKind.BooleanKeyword) {
          init = { kind: "LiteralExpr", literalKind: "boolean", value: false, rawValue: "false", span: this.getSpan(decl) };
        } else if (decl.type && decl.type.kind === ts.SyntaxKind.StringKeyword) {
          init = { kind: "LiteralExpr", literalKind: "string", value: "", rawValue: '""', span: this.getSpan(decl) };
        } else {
          init = { kind: "LiteralExpr", literalKind: "nil", value: null, rawValue: "nil", span: this.getSpan(decl) };
        }
        return {
          kind: "LetBinding",
          name: decl.name.text,
          isMut: isMut || !decl.initializer,
          typeAnnotation: decl.type ? this.convertTypeNode(decl.type) : null,
          init,
          span: this.getSpan(stmt),
        };
      }
    }

    if (ts.isReturnStatement(stmt)) {
      if (stmt.expression && ts.isConditionalExpression(stmt.expression)) {
        return this.convertConditionalReturn(stmt.expression, this.getSpan(stmt));
      }
      return {
        kind: "ReturnStmt",
        value: stmt.expression ? this.convertExpression(stmt.expression) : null,
        span: this.getSpan(stmt),
      };
    }

    if (ts.isIfStatement(stmt)) {
      const condition = this.ensureBooleanCondition(this.convertExpression(stmt.expression));
      let thenBranch: Block;
      if (ts.isBlock(stmt.thenStatement)) {
        thenBranch = this.convertBlock(stmt.thenStatement);
      } else {
        const single = this.convertStatement(stmt.thenStatement);
        thenBranch = {
          kind: "Block" as const,
          statements: single ? [single] : [],
          span: this.getSpan(stmt.thenStatement),
        };
      }

      let elseBranch: Block | null = null;
      const elifBranches: { condition: Expr; body: Block; span: Span }[] = [];

      if (stmt.elseStatement) {
        if (ts.isIfStatement(stmt.elseStatement)) {
          let elifBody: Block;
          if (ts.isBlock(stmt.elseStatement.thenStatement)) {
            elifBody = this.convertBlock(stmt.elseStatement.thenStatement);
          } else {
            const single = this.convertStatement(stmt.elseStatement.thenStatement);
            elifBody = {
              kind: "Block" as const,
              statements: single ? [single] : [],
              span: this.getSpan(stmt.elseStatement.thenStatement),
            };
          }
          const elifCond = this.ensureBooleanCondition(
            this.convertExpression(stmt.elseStatement.expression),
          );
          elifBranches.push({
            condition: elifCond,
            body: elifBody,
            span: this.getSpan(stmt.elseStatement),
          });
        } else if (ts.isBlock(stmt.elseStatement)) {
          elseBranch = this.convertBlock(stmt.elseStatement);
        } else {
          const single = this.convertStatement(stmt.elseStatement);
          elseBranch = {
            kind: "Block" as const,
            statements: single ? [single] : [],
            span: this.getSpan(stmt.elseStatement),
          };
        }
      }

      return {
        kind: "IfStmt",
        condition,
        thenBranch,
        elifBranches,
        elseBranch,
        span: this.getSpan(stmt),
      };
    }

    if (ts.isForOfStatement(stmt) && ts.isVariableDeclarationList(stmt.initializer)) {
      const varName = stmt.initializer.declarations[0]?.name.getText(this.sourceFile) ?? "item";
      return {
        kind: "ForStmt",
        variable: varName,
        iterable: this.convertExpression(stmt.expression),
        body: ts.isBlock(stmt.statement)
          ? this.convertBlock(stmt.statement)
          : { kind: "Block" as const, statements: [], span: emptySpan() },
        span: this.getSpan(stmt),
      };
    }

    if (ts.isWhileStatement(stmt)) {
      return {
        kind: "WhileStmt",
        condition: this.ensureBooleanCondition(this.convertExpression(stmt.expression)),
        body: ts.isBlock(stmt.statement)
          ? this.convertBlock(stmt.statement)
          : { kind: "Block" as const, statements: [], span: emptySpan() },
        span: this.getSpan(stmt),
      };
    }

    if (ts.isExpressionStatement(stmt)) {
      // Check for assignment: target = value or compound assignment target += value
      if (ts.isBinaryExpression(stmt.expression)) {
        const opKind = stmt.expression.operatorToken.kind;
        if (opKind === ts.SyntaxKind.EqualsToken) {
          const target = this.convertExpression(stmt.expression.left);
          if (ts.isConditionalExpression(stmt.expression.right)) {
            return this.convertConditionalAssign(
              target,
              stmt.expression.right,
              this.getSpan(stmt),
            );
          }
          return {
            kind: "AssignStmt",
            target,
            value: this.convertExpression(stmt.expression.right),
            span: this.getSpan(stmt),
          };
        }
        let binaryOp: BinaryOp | null = null;
        if (opKind === ts.SyntaxKind.PlusEqualsToken) binaryOp = "+";
        else if (opKind === ts.SyntaxKind.MinusEqualsToken) binaryOp = "-";
        else if (opKind === ts.SyntaxKind.AsteriskEqualsToken) binaryOp = "*";
        else if (opKind === ts.SyntaxKind.SlashEqualsToken) binaryOp = "/";

        if (binaryOp) {
          const target = this.convertExpression(stmt.expression.left);
          const operand = this.convertExpression(stmt.expression.right);
          return {
            kind: "AssignStmt",
            target,
            value: {
              kind: "BinaryExpr",
              operator: binaryOp,
              left: target,
              right: operand,
              span: this.getSpan(stmt.expression),
            },
            span: this.getSpan(stmt),
          };
        }
      }

      // Check for increment / decrement: i++ or i--
      if (
        (ts.isPostfixUnaryExpression(stmt.expression) || ts.isPrefixUnaryExpression(stmt.expression)) &&
        (stmt.expression.operator === ts.SyntaxKind.PlusPlusToken ||
          stmt.expression.operator === ts.SyntaxKind.MinusMinusToken)
      ) {
        const target = this.convertExpression(stmt.expression.operand);
        const op: BinaryOp =
          stmt.expression.operator === ts.SyntaxKind.PlusPlusToken ? "+" : "-";
        return {
          kind: "AssignStmt",
          target,
          value: {
            kind: "BinaryExpr",
            operator: op,
            left: target,
            right: {
              kind: "LiteralExpr",
              literalKind: "number",
              value: 1,
              rawValue: "1",
              span: this.getSpan(stmt),
            },
            span: this.getSpan(stmt),
          },
          span: this.getSpan(stmt),
        };
      }

      return {
        kind: "ExprStmt",
        expr: this.convertExpression(stmt.expression),
        span: this.getSpan(stmt),
      };
    }

    return null;
  }

  private ensureBooleanCondition(cond: Expr): Expr {
    if (cond.kind === "IdentifierExpr" || cond.kind === "MemberAccessExpr") {
      return {
        kind: "BinaryExpr",
        operator: "!=",
        left: cond,
        right: {
          kind: "LiteralExpr",
          literalKind: "nil",
          value: null,
          rawValue: "nil",
          span: cond.span,
        },
        span: cond.span,
      };
    }
    return cond;
  }

  private convertConditionalReturn(expr: ts.ConditionalExpression, span: Span): IfStmt {
    const condition = this.ensureBooleanCondition(this.convertExpression(expr.condition));
    const thenBranch: Block = {
      kind: "Block",
      statements: [
        {
          kind: "ReturnStmt",
          value: this.convertExpression(expr.whenTrue),
          span: this.getSpan(expr.whenTrue),
        },
      ],
      span: this.getSpan(expr.whenTrue),
    };

    const elifBranches: { condition: Expr; body: Block; span: Span }[] = [];
    let elseBranch: Block | null = null;

    let currentElse: ts.Expression = expr.whenFalse;
    while (ts.isConditionalExpression(currentElse)) {
      elifBranches.push({
        condition: this.ensureBooleanCondition(this.convertExpression(currentElse.condition)),
        body: {
          kind: "Block",
          statements: [
            {
              kind: "ReturnStmt",
              value: this.convertExpression(currentElse.whenTrue),
              span: this.getSpan(currentElse.whenTrue),
            },
          ],
          span: this.getSpan(currentElse.whenTrue),
        },
        span: this.getSpan(currentElse),
      });
      currentElse = currentElse.whenFalse;
    }

    elseBranch = {
      kind: "Block",
      statements: [
        {
          kind: "ReturnStmt",
          value: this.convertExpression(currentElse),
          span: this.getSpan(currentElse),
        },
      ],
      span: this.getSpan(currentElse),
    };

    return {
      kind: "IfStmt",
      condition,
      thenBranch,
      elifBranches,
      elseBranch,
      span,
    };
  }

  private convertConditionalAssign(
    target: Expr,
    expr: ts.ConditionalExpression,
    span: Span,
  ): IfStmt {
    const condition = this.ensureBooleanCondition(this.convertExpression(expr.condition));
    const thenBranch: Block = {
      kind: "Block",
      statements: [
        {
          kind: "AssignStmt",
          target,
          value: this.convertExpression(expr.whenTrue),
          span: this.getSpan(expr.whenTrue),
        },
      ],
      span: this.getSpan(expr.whenTrue),
    };

    const elifBranches: { condition: Expr; body: Block; span: Span }[] = [];
    let elseBranch: Block | null = null;

    let currentElse: ts.Expression = expr.whenFalse;
    while (ts.isConditionalExpression(currentElse)) {
      elifBranches.push({
        condition: this.ensureBooleanCondition(this.convertExpression(currentElse.condition)),
        body: {
          kind: "Block",
          statements: [
            {
              kind: "AssignStmt",
              target,
              value: this.convertExpression(currentElse.whenTrue),
              span: this.getSpan(currentElse.whenTrue),
            },
          ],
          span: this.getSpan(currentElse.whenTrue),
        },
        span: this.getSpan(currentElse),
      });
      currentElse = currentElse.whenFalse;
    }

    elseBranch = {
      kind: "Block",
      statements: [
        {
          kind: "AssignStmt",
          target,
          value: this.convertExpression(currentElse),
          span: this.getSpan(currentElse),
        },
      ],
      span: this.getSpan(currentElse),
    };

    return {
      kind: "IfStmt",
      condition,
      thenBranch,
      elifBranches,
      elseBranch,
      span,
    };
  }

  private convertExpression(expr: ts.Expression): Expr {
    // Parenthesized & Type Assertions
    if (ts.isParenthesizedExpression(expr)) {
      return this.convertExpression(expr.expression);
    }

    if (
      ts.isAsExpression(expr) ||
      ts.isTypeAssertionExpression(expr) ||
      ts.isNonNullExpression(expr)
    ) {
      return this.convertExpression(expr.expression);
    }

    // Literals
    if (ts.isStringLiteral(expr)) {
      return {
        kind: "LiteralExpr",
        literalKind: "string",
        value: expr.text,
        rawValue: JSON.stringify(expr.text),
        span: this.getSpan(expr),
      };
    }

    if (ts.isNoSubstitutionTemplateLiteral(expr)) {
      return {
        kind: "LiteralExpr",
        literalKind: "string",
        value: expr.text,
        rawValue: JSON.stringify(expr.text),
        span: this.getSpan(expr),
      };
    }

    if (ts.isTemplateExpression(expr)) {
      let result: Expr = {
        kind: "LiteralExpr",
        literalKind: "string",
        value: expr.head.text,
        rawValue: JSON.stringify(expr.head.text),
        span: this.getSpan(expr.head),
      };

      for (const span of expr.templateSpans) {
        const exprNode = this.convertExpression(span.expression);
        const strNode: Expr = {
          kind: "CallExpr",
          callee: { kind: "IdentifierExpr", name: "String", span: exprNode.span },
          args: [exprNode],
          span: exprNode.span,
        };
        result = {
          kind: "BinaryExpr",
          operator: "+",
          left: result,
          right: strNode,
          span: mergeSpans(result.span, strNode.span),
        };
        if (span.literal.text.length > 0) {
          const litNode: Expr = {
            kind: "LiteralExpr",
            literalKind: "string",
            value: span.literal.text,
            rawValue: JSON.stringify(span.literal.text),
            span: this.getSpan(span.literal),
          };
          result = {
            kind: "BinaryExpr",
            operator: "+",
            left: result,
            right: litNode,
            span: mergeSpans(result.span, litNode.span),
          };
        }
      }
      return result;
    }

    if (ts.isNumericLiteral(expr)) {
      return {
        kind: "LiteralExpr",
        literalKind: "number",
        value: Number(expr.text),
        rawValue: expr.text,
        span: this.getSpan(expr),
      };
    }

    if (expr.kind === ts.SyntaxKind.TrueKeyword) {
      return {
        kind: "LiteralExpr",
        literalKind: "boolean",
        value: true,
        rawValue: "true",
        span: this.getSpan(expr),
      };
    }

    if (expr.kind === ts.SyntaxKind.FalseKeyword) {
      return {
        kind: "LiteralExpr",
        literalKind: "boolean",
        value: false,
        rawValue: "false",
        span: this.getSpan(expr),
      };
    }

    if (expr.kind === ts.SyntaxKind.NullKeyword || expr.kind === ts.SyntaxKind.UndefinedKeyword) {
      return {
        kind: "LiteralExpr",
        literalKind: "nil",
        value: null,
        rawValue: "nil",
        span: this.getSpan(expr),
      };
    }

    // Identifiers & This
    if (expr.kind === ts.SyntaxKind.ThisKeyword) {
      return {
        kind: "IdentifierExpr",
        name: "this",
        span: this.getSpan(expr),
      };
    }

    if (ts.isIdentifier(expr)) {
      return {
        kind: "IdentifierExpr",
        name: expr.text,
        span: this.getSpan(expr),
      };
    }

    // TypeOf Expressions
    if (ts.isTypeOfExpression(expr)) {
      return {
        kind: "CallExpr",
        callee: {
          kind: "IdentifierExpr",
          name: "typeof",
          span: this.getSpan(expr),
        },
        args: [this.convertExpression(expr.expression)],
        span: this.getSpan(expr),
      };
    }

    // Conditional Expressions (Ternary)
    if (ts.isConditionalExpression(expr)) {
      const cond = this.convertExpression(expr.condition);
      const whenTrue = this.convertExpression(expr.whenTrue);
      const whenFalse = this.convertExpression(expr.whenFalse);
      return {
        kind: "BinaryExpr",
        operator: "or",
        left: {
          kind: "BinaryExpr",
          operator: "and",
          left: cond,
          right: whenTrue,
          span: this.getSpan(expr),
        },
        right: whenFalse,
        span: this.getSpan(expr),
      };
    }

    // Binary Expressions
    if (ts.isBinaryExpression(expr)) {
      if (expr.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
        let leftExpr = this.convertExpression(expr.left);
        if (leftExpr.kind === "IdentifierExpr" || leftExpr.kind === "MemberAccessExpr") {
          leftExpr = {
            kind: "BinaryExpr",
            operator: "!=",
            left: leftExpr,
            right: {
              kind: "LiteralExpr",
              literalKind: "nil",
              value: null,
              rawValue: "nil",
              span: leftExpr.span,
            },
            span: leftExpr.span,
          };
        }
        return {
          kind: "BinaryExpr",
          operator: "and",
          left: leftExpr,
          right: this.convertExpression(expr.right),
          span: this.getSpan(expr),
        };
      }
      const op = this.convertBinaryOp(expr.operatorToken.kind);
      return {
        kind: "BinaryExpr",
        operator: op,
        left: this.convertExpression(expr.left),
        right: this.convertExpression(expr.right),
        span: this.getSpan(expr),
      };
    }

    // Unary Expressions
    if (ts.isPostfixUnaryExpression(expr)) {
      return this.convertExpression(expr.operand);
    }

    if (ts.isPrefixUnaryExpression(expr)) {
      if (
        expr.operator === ts.SyntaxKind.PlusPlusToken ||
        expr.operator === ts.SyntaxKind.MinusMinusToken
      ) {
        return this.convertExpression(expr.operand);
      }
      const op = expr.operator === ts.SyntaxKind.ExclamationToken ? "not" : "-";
      return {
        kind: "UnaryExpr",
        operator: op,
        operand: this.convertExpression(expr.operand),
        span: this.getSpan(expr),
      };
    }

    // Call Expressions
    if (ts.isCallExpression(expr)) {
      return {
        kind: "CallExpr",
        callee: this.convertExpression(expr.expression),
        args: expr.arguments.map((a) => this.convertExpression(a)),
        span: this.getSpan(expr),
      };
    }

    // New Expressions (e.g. new Int32Array(cap) -> Int32Array(cap))
    if (ts.isNewExpression(expr)) {
      const args = expr.arguments ? expr.arguments.map((a) => this.convertExpression(a)) : [];
      return {
        kind: "CallExpr",
        callee: this.convertExpression(expr.expression),
        args,
        span: this.getSpan(expr),
      };
    }

    // Property Access (obj.prop or obj?.prop)
    if (ts.isPropertyAccessExpression(expr)) {
      return {
        kind: "MemberAccessExpr",
        object: this.convertExpression(expr.expression),
        property: expr.name.text,
        isSafeNav: expr.questionDotToken !== undefined,
        span: this.getSpan(expr),
      };
    }

    // Element Access (obj[index])
    if (ts.isElementAccessExpression(expr)) {
      return {
        kind: "IndexExpr",
        object: this.convertExpression(expr.expression),
        index: this.convertExpression(expr.argumentExpression),
        span: this.getSpan(expr),
      };
    }

    // Array Literal
    if (ts.isArrayLiteralExpression(expr)) {
      return {
        kind: "ArrayLiteralExpr",
        elements: expr.elements.map((e) => this.convertExpression(e)),
        span: this.getSpan(expr),
      };
    }

    // Object Literal
    if (ts.isObjectLiteralExpression(expr)) {
      const properties: RecordProperty[] = [];
      for (const p of expr.properties) {
        if (ts.isPropertyAssignment(p) && p.name && ts.isIdentifier(p.name)) {
          properties.push({
            key: p.name.text,
            value: this.convertExpression(p.initializer),
            span: this.getSpan(p),
          });
        } else if (ts.isShorthandPropertyAssignment(p)) {
          properties.push({
            key: p.name.text,
            value: {
              kind: "IdentifierExpr",
              name: p.name.text,
              span: this.getSpan(p),
            },
            span: this.getSpan(p),
          });
        } else if (ts.isSpreadAssignment(p)) {
          properties.push({
            key: "",
            value: this.convertExpression(p.expression),
            isSpread: true,
            span: this.getSpan(p),
          });
        }
      }
      return {
        kind: "RecordLiteralExpr",
        properties,
        span: this.getSpan(expr),
      };
    }

    // Spread Element (...expr)
    if (ts.isSpreadElement(expr)) {
      return this.convertExpression(expr.expression);
    }

    // Arrow Function
    if (ts.isArrowFunction(expr)) {
      const params = expr.parameters.map((p) => ({
        name: p.name.getText(this.sourceFile),
        typeAnnotation: p.type ? this.convertTypeNode(p.type) : this.makePrimitive("any"),
        span: this.getSpan(p),
      }));

      const body = ts.isBlock(expr.body)
        ? this.convertBlock(expr.body)
        : this.convertExpression(expr.body);

      return {
        kind: "ClosureExpr",
        params,
        returnType: expr.type ? this.convertTypeNode(expr.type) : null,
        body,
        span: this.getSpan(expr),
      };
    }

    // Fallback: literal nil
    return {
      kind: "LiteralExpr",
      literalKind: "nil",
      value: null,
      rawValue: "nil",
      span: this.getSpan(expr),
    };
  }

  private convertBinaryOp(kind: ts.SyntaxKind): BinaryOp {
    switch (kind) {
      case ts.SyntaxKind.PlusToken:
        return "+";
      case ts.SyntaxKind.MinusToken:
        return "-";
      case ts.SyntaxKind.AsteriskToken:
        return "*";
      case ts.SyntaxKind.SlashToken:
        return "/";
      case ts.SyntaxKind.PercentToken:
        return "%";
      case ts.SyntaxKind.EqualsEqualsToken:
      case ts.SyntaxKind.EqualsEqualsEqualsToken:
        return "==";
      case ts.SyntaxKind.ExclamationEqualsToken:
      case ts.SyntaxKind.ExclamationEqualsEqualsToken:
        return "!=";
      case ts.SyntaxKind.LessThanToken:
        return "<";
      case ts.SyntaxKind.LessThanEqualsToken:
        return "<=";
      case ts.SyntaxKind.GreaterThanToken:
        return ">";
      case ts.SyntaxKind.GreaterThanEqualsToken:
        return ">=";
      case ts.SyntaxKind.AmpersandAmpersandToken:
        return "and";
      case ts.SyntaxKind.BarBarToken:
        return "or";
      case ts.SyntaxKind.QuestionQuestionToken:
        return "??";
      default:
        return "==";
    }
  }

  private convertTypeNode(node: ts.TypeNode): TypeExpr {
    switch (node.kind) {
      case ts.SyntaxKind.StringKeyword:
        return this.makePrimitive("str", node);
      case ts.SyntaxKind.NumberKeyword:
        return this.makePrimitive("int", node);
      case ts.SyntaxKind.BooleanKeyword:
        return this.makePrimitive("bool", node);
      case ts.SyntaxKind.TypePredicate:
        return this.makePrimitive("bool", node);
      case ts.SyntaxKind.VoidKeyword:
        return this.makePrimitive("void", node);
      case ts.SyntaxKind.AnyKeyword:
      case ts.SyntaxKind.UnknownKeyword:
        return { kind: "NamedType", name: "unknown", span: this.getSpan(node) };
      case ts.SyntaxKind.ParenthesizedType: {
        const par = node as ts.ParenthesizedTypeNode;
        return this.convertTypeNode(par.type);
      }
      case ts.SyntaxKind.TypeOperator: {
        const op = node as ts.TypeOperatorNode;
        return this.convertTypeNode(op.type);
      }
      case ts.SyntaxKind.ArrayType: {
        const arr = node as ts.ArrayTypeNode;
        return {
          kind: "ArrayType",
          elementType: this.convertTypeNode(arr.elementType),
          span: this.getSpan(node),
        };
      }
      case ts.SyntaxKind.UnionType: {
        const union = node as ts.UnionTypeNode;
        const nonNulls = union.types.filter(
          (t) =>
            t.kind !== ts.SyntaxKind.NullKeyword &&
            t.kind !== ts.SyntaxKind.UndefinedKeyword &&
            !(ts.isLiteralTypeNode(t) && t.literal.kind === ts.SyntaxKind.NullKeyword),
        );
        if (nonNulls.length < union.types.length && nonNulls.length === 1) {
          return {
            kind: "OptionType",
            innerType: this.convertTypeNode(nonNulls[0]),
            span: this.getSpan(node),
          };
        }
        const typeTexts = union.types.map((t) => {
          const converted = this.convertTypeNode(t);
          if (converted.kind === "NamedType") return converted.name;
          if (converted.kind === "PrimitiveType") return converted.primitive;
          return "unknown";
        });
        if (typeTexts.some((t) => t.includes("{") || t.includes("&") || t.includes("\n"))) {
          return { kind: "NamedType", name: "unknown", span: this.getSpan(node) };
        }
        return { kind: "NamedType", name: typeTexts.join(" | "), span: this.getSpan(node) };
      }
      case ts.SyntaxKind.IntersectionType:
      case ts.SyntaxKind.TypeLiteral:
      case ts.SyntaxKind.TypeQuery:
        return { kind: "NamedType", name: "unknown", span: this.getSpan(node) };
      case ts.SyntaxKind.TypeReference: {
        const ref = node as ts.TypeReferenceNode;
        const typeName = ref.typeName.getText(this.sourceFile);
        if (typeName === "Array" && ref.typeArguments && ref.typeArguments.length === 1) {
          return {
            kind: "ArrayType",
            elementType: this.convertTypeNode(ref.typeArguments[0]),
            span: this.getSpan(node),
          };
        }
        if (typeName === "Option" && ref.typeArguments && ref.typeArguments.length === 1) {
          return {
            kind: "OptionType",
            innerType: this.convertTypeNode(ref.typeArguments[0]),
            span: this.getSpan(node),
          };
        }
        if (typeName === "Result" && ref.typeArguments && ref.typeArguments.length === 2) {
          return {
            kind: "ResultType",
            okType: this.convertTypeNode(ref.typeArguments[0]),
            errType: this.convertTypeNode(ref.typeArguments[1]),
            span: this.getSpan(node),
          };
        }
        return {
          kind: "NamedType",
          name: typeName,
          typeArgs: ref.typeArguments?.map((ta) => this.convertTypeNode(ta)),
          span: this.getSpan(node),
        };
      }
      default: {
        const text = node.getText(this.sourceFile);
        if (text.includes("{") || text.includes("&") || text.includes("\n")) {
          return { kind: "NamedType", name: "unknown", span: this.getSpan(node) };
        }
        return { kind: "NamedType", name: text, span: this.getSpan(node) };
      }
    }
  }

  private makePrimitive(primitive: PrimitiveType["primitive"] | "any", node?: ts.Node): TypeExpr {
    const span = node ? this.getSpan(node) : emptySpan();
    if (primitive === "any") {
      return { kind: "NamedType", name: "unknown", span };
    }
    return {
      kind: "PrimitiveType",
      primitive,
      span,
    };
  }
}
