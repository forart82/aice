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
  AssignExpr,
  AssignOp,
  AssignStmt,
  AwaitExpr,
  BinaryOp,
  Block,
  BreakStmt,
  ClassDecl,
  ComponentDecl,
  ConstDecl,
  ContinueStmt,
  DestructureBinding,
  Expr,
  FieldDecl,
  FunctionDecl,
  IfStmt,
  ImportDecl,
  ImportSpecifier,
  LayoutNode,
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
  Statement,
  TemplateLiteralExpr,
  ThrowStmt,
  TryStmt,
  TupleType,
  TypeDecl,
  TypeExpr,
  VarDecl,
  WhileStmt,
} from "../core/ast.js";
import { createPosition, createSpan, emptySpan, mergeSpans, type Span } from "../core/span.js";
import { CstTriviaTable, type TriviaItem, type TriviaKind } from "../core/trivia.js";

const TS_MATH_BUILTINS = new Set([
  "abs",
  "floor",
  "ceil",
  "round",
  "min",
  "max",
  "sqrt",
  "hypot",
  "sin",
  "cos",
  "atan2",
  "pow",
]);

export interface TsDecompilerOptions {
  modulePath?: string;
  isTsx?: boolean;
  convertStringUnionsToEnum?: boolean;
}

export class TsDecompiler {
  private source: string;
  private filePath: string;
  private isTsx: boolean;
  private convertStringUnionsToEnum: boolean;
  private sourceFile!: ts.SourceFile;
  private trivia = new CstTriviaTable();
  private knownTypeNames = new Set<string>();
  private currentScopeVars: Set<string>[] = [];
  private variableScopeStack: Map<string, "number" | "string" | "boolean" | "other">[] = [
    new Map(),
  ];
  private inClosureDepth = 0;

  private pushScope(params: readonly (ts.ParameterDeclaration | ts.BindingElement)[] = []): void {
    const scope = new Set<string>();
    const varTypes = new Map<string, "number" | "string" | "boolean" | "other">();
    for (const p of params) {
      if (ts.isIdentifier(p.name)) {
        const name = p.name.text;
        scope.add(name);
        if ("type" in p && p.type) {
          if (p.type.kind === ts.SyntaxKind.NumberKeyword) varTypes.set(name, "number");
          else if (p.type.kind === ts.SyntaxKind.StringKeyword) varTypes.set(name, "string");
          else if (p.type.kind === ts.SyntaxKind.BooleanKeyword) varTypes.set(name, "boolean");
        }
      }
    }
    this.currentScopeVars.push(scope);
    this.variableScopeStack.push(varTypes);
  }

  private popScope(): void {
    this.currentScopeVars.pop();
    if (this.variableScopeStack.length > 1) {
      this.variableScopeStack.pop();
    }
  }

  private registerVarType(name: string, type: "number" | "string" | "boolean" | "other"): void {
    const current = this.variableScopeStack[this.variableScopeStack.length - 1];
    if (current) {
      current.set(name, type);
    }
  }

  private getVarType(name: string): "number" | "string" | "boolean" | "other" | undefined {
    for (let i = this.variableScopeStack.length - 1; i >= 0; i--) {
      const t = this.variableScopeStack[i].get(name);
      if (t) return t;
    }
    return undefined;
  }

  private trackDeclaration(decl: ts.VariableDeclaration): void {
    if (!ts.isIdentifier(decl.name)) return;
    const name = decl.name.text;
    let typeCat: "number" | "string" | "boolean" | "other" | undefined;
    if (decl.type) {
      if (decl.type.kind === ts.SyntaxKind.NumberKeyword) typeCat = "number";
      else if (decl.type.kind === ts.SyntaxKind.StringKeyword) typeCat = "string";
      else if (decl.type.kind === ts.SyntaxKind.BooleanKeyword) typeCat = "boolean";
    } else if (decl.initializer) {
      if (ts.isNumericLiteral(decl.initializer)) typeCat = "number";
      else if (
        ts.isStringLiteral(decl.initializer) ||
        ts.isNoSubstitutionTemplateLiteral(decl.initializer) ||
        ts.isTemplateExpression(decl.initializer)
      ) {
        typeCat = "string";
      } else if (
        decl.initializer.kind === ts.SyntaxKind.TrueKeyword ||
        decl.initializer.kind === ts.SyntaxKind.FalseKeyword
      ) {
        typeCat = "boolean";
      }
    }
    if (typeCat) {
      this.registerVarType(name, typeCat);
    }
  }

  constructor(source: string, filePath = "source.ts", options: TsDecompilerOptions = {}) {
    this.source = source;
    this.filePath = filePath;
    this.isTsx = options.isTsx ?? (filePath.endsWith(".tsx") || source.includes("<"));
    this.convertStringUnionsToEnum = options.convertStringUnionsToEnum ?? false;
  }

  static decompile(
    source: string,
    filePath = "source.ts",
    options: TsDecompilerOptions = {},
  ): { ast: Module; trivia: CstTriviaTable } {
    return new TsDecompiler(source, filePath, options).decompile();
  }

  decompile(): { ast: Module; trivia: CstTriviaTable } {
    this.knownTypeNames.clear();
    this.variableScopeStack = [new Map()];
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
    const baseName =
      this.filePath
        .split(/[/\\]/)
        .pop()
        ?.replace(/\.(tsx?|jsx?)$/, "")
        .replace(/\.ail$/, "") ?? "main";
    const cleanModPath = baseName;

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

    if (ts.isExportDeclaration(stmt)) {
      return this.convertExportDeclaration(stmt);
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

    if (ts.isExpressionStatement(stmt)) {
      return {
        kind: "ConstDecl",
        name: "_",
        isExported: false,
        value: this.convertExpression(stmt.expression),
        span: this.getSpan(stmt),
      };
    }

    if (ts.isIfStatement(stmt)) {
      const cond = this.convertExpression(stmt.expression);
      let thenExpr: Expr | null = null;
      if (ts.isExpressionStatement(stmt.thenStatement)) {
        thenExpr = this.convertExpression(stmt.thenStatement.expression);
      } else if (
        ts.isBlock(stmt.thenStatement) &&
        stmt.thenStatement.statements.length === 1 &&
        ts.isExpressionStatement(stmt.thenStatement.statements[0])
      ) {
        thenExpr = this.convertExpression(stmt.thenStatement.statements[0].expression);
      }
      if (thenExpr) {
        return {
          kind: "ConstDecl",
          name: "_",
          isExported: false,
          value: {
            kind: "BinaryExpr",
            operator: "and",
            left: cond,
            right: thenExpr,
            span: this.getSpan(stmt),
          },
          span: this.getSpan(stmt),
        };
      }
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
          isDefault: true,
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

  private convertExportDeclaration(stmt: ts.ExportDeclaration): ImportDecl | null {
    const moduleSpecifier = stmt.moduleSpecifier;
    if (!moduleSpecifier || !ts.isStringLiteral(moduleSpecifier)) return null;

    const source = moduleSpecifier.text;
    const nodeId = `export:${source}`;
    this.extractComments(stmt, nodeId);

    const specifiers: ImportSpecifier[] = [];

    if (!stmt.exportClause) {
      // export * from './foo'
      specifiers.push({
        name: "*",
        isWildcard: true,
        span: this.getSpan(stmt),
      });
    } else if (ts.isNamespaceExport(stmt.exportClause)) {
      // export * as bar from './foo'
      specifiers.push({
        name: "*",
        alias: stmt.exportClause.name.text,
        isWildcard: true,
        span: this.getSpan(stmt.exportClause),
      });
    } else if (ts.isNamedExports(stmt.exportClause)) {
      // export { a, b as c } from './foo'
      for (const el of stmt.exportClause.elements) {
        specifiers.push({
          name: (el.propertyName ?? el.name).text,
          alias: el.propertyName ? el.name.text : undefined,
          span: this.getSpan(el),
        });
      }
    }

    return {
      kind: "ImportDecl",
      source,
      specifiers,
      isExported: true,
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

    // Optional legacy conversion of string literal union -> Enum (disabled by default)
    if (this.convertStringUnionsToEnum && ts.isUnionTypeNode(stmt.type)) {
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

    // Standard type alias (preserves string literal unions as type aliases)
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
            isOptional: p.questionToken ? true : undefined,
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
    const isAsync = stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)
      ? true
      : undefined;
    const returnType = stmt.type ? this.convertTypeNode(stmt.type) : null;
    this.pushScope(stmt.parameters);
    const body = stmt.body
      ? this.convertBlock(stmt.body)
      : { kind: "Block" as const, statements: [], span: emptySpan() };
    this.popScope();

    // Detect if single return expression
    if (
      body.statements.length === 1 &&
      body.statements[0].kind === "ReturnStmt" &&
      body.statements[0].value
    ) {
      return {
        kind: "FunctionDecl",
        name,
        isAsync,
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
      isAsync,
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
    const staticBlocks: Block[] = [];
    let primaryConstructor: ParamDecl[] | undefined;

    for (const member of stmt.members) {
      if (ts.isPropertyDeclaration(member)) {
        const propName = ts.isIdentifier(member.name)
          ? member.name.text
          : member.name.getText(this.sourceFile);
        const pNodeId = `field:${name}.${propName}`;
        this.extractComments(member, pNodeId);

        const isStatic =
          member.modifiers?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword) ?? false;
        const isReadonly =
          member.modifiers?.some((m) => m.kind === ts.SyntaxKind.ReadonlyKeyword) ?? false;
        let typeAnn = member.type ? this.convertTypeNode(member.type) : undefined;
        if (member.questionToken && typeAnn) {
          typeAnn = {
            kind: "OptionType",
            innerType: typeAnn,
            span: this.getSpan(member),
          };
        }
        const initialValue = member.initializer
          ? this.convertExpression(member.initializer)
          : undefined;

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

        const hasParamProps = member.parameters.some((p) =>
          p.modifiers?.some(
            (m) =>
              m.kind === ts.SyntaxKind.PublicKeyword || m.kind === ts.SyntaxKind.ReadonlyKeyword,
          ),
        );
        const isEmptyBody = !member.body || member.body.statements.length === 0;

        if (hasParamProps && isEmptyBody) {
          primaryConstructor = member.parameters.map((p) => {
            const pName = ts.isIdentifier(p.name) ? p.name.text : p.name.getText(this.sourceFile);
            const isPub = p.modifiers?.some((m) => m.kind === ts.SyntaxKind.PublicKeyword) ?? true;
            const isRo =
              p.modifiers?.some((m) => m.kind === ts.SyntaxKind.ReadonlyKeyword) ?? false;
            return {
              name: pName,
              typeAnnotation: p.type ? this.convertTypeNode(p.type) : this.makePrimitive("any"),
              defaultValue: p.initializer ? this.convertExpression(p.initializer) : undefined,
              isOptional: p.questionToken ? true : undefined,
              isPub,
              isReadonly: isRo,
              span: this.getSpan(p),
            };
          });
          continue;
        }

        let isSimplePropertyAssignCtor = false;
        if (
          member.body &&
          member.body.statements.length === member.parameters.length &&
          member.parameters.length > 0
        ) {
          const allAssignments = member.body.statements.every((s, idx) => {
            if (!ts.isExpressionStatement(s) || !ts.isBinaryExpression(s.expression)) return false;
            const bin = s.expression;
            if (bin.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return false;
            if (!ts.isPropertyAccessExpression(bin.left)) return false;
            if (bin.left.expression.kind !== ts.SyntaxKind.ThisKeyword) return false;
            const paramName = ts.isIdentifier(member.parameters[idx].name)
              ? member.parameters[idx].name.text
              : "";
            const leftPropName = bin.left.name.text;
            const rightName = ts.isIdentifier(bin.right) ? bin.right.text : "";
            return leftPropName === paramName && rightName === paramName;
          });
          if (allAssignments) {
            const propMap = new Map(properties.map((p) => [p.name, p]));
            if (
              member.parameters.every((p) => ts.isIdentifier(p.name) && propMap.has(p.name.text))
            ) {
              isSimplePropertyAssignCtor = true;
            }
          }
        }

        if (isSimplePropertyAssignCtor) {
          const propMap = new Map(properties.map((p) => [p.name, p]));
          const assignedPropNames = new Set<string>();
          primaryConstructor = member.parameters.map((p) => {
            const pName = ts.isIdentifier(p.name) ? p.name.text : p.name.getText(this.sourceFile);
            assignedPropNames.add(pName);
            const matchedProp = propMap.get(pName);
            return {
              name: pName,
              typeAnnotation: p.type
                ? this.convertTypeNode(p.type)
                : (matchedProp?.typeAnnotation ?? this.makePrimitive("any")),
              defaultValue: p.initializer
                ? this.convertExpression(p.initializer)
                : matchedProp?.initialValue,
              isOptional: p.questionToken ? true : undefined,
              isPub: true,
              isReadonly: matchedProp?.isReadonly ?? false,
              span: this.getSpan(p),
            };
          });
          for (let i = properties.length - 1; i >= 0; i--) {
            if (assignedPropNames.has(properties[i].name)) {
              properties.splice(i, 1);
            }
          }
          continue;
        }

        const params: ParamDecl[] = member.parameters.map((p) => {
          const pName = ts.isIdentifier(p.name) ? p.name.text : p.name.getText(this.sourceFile);
          return {
            name: pName,
            typeAnnotation: p.type ? this.convertTypeNode(p.type) : this.makePrimitive("any"),
            defaultValue: p.initializer ? this.convertExpression(p.initializer) : undefined,
            isOptional: p.questionToken ? true : undefined,
            span: this.getSpan(p),
          };
        });

        this.pushScope(member.parameters);
        const body: Block = member.body
          ? this.convertBlock(member.body)
          : { kind: "Block" as const, statements: [], span: this.getSpan(member) };
        this.popScope();

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

        const isStatic =
          member.modifiers?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword) ?? false;
        const isAsync =
          member.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ?? false;
        const params: ParamDecl[] = member.parameters.map((p) => {
          const pName = ts.isIdentifier(p.name) ? p.name.text : p.name.getText(this.sourceFile);
          return {
            name: pName,
            typeAnnotation: p.type ? this.convertTypeNode(p.type) : this.makePrimitive("any"),
            defaultValue: p.initializer ? this.convertExpression(p.initializer) : undefined,
            isOptional: p.questionToken ? true : undefined,
            span: this.getSpan(p),
          };
        });

        this.pushScope(member.parameters);
        const returnType = member.type ? this.convertTypeNode(member.type) : null;
        let isExpressionBodied = false;
        let body: Block | Expr;

        if (member.body && member.body.statements.length === 1) {
          const singleStmt = member.body.statements[0];
          if (
            ts.isReturnStatement(singleStmt) &&
            singleStmt.expression &&
            !(
              ts.isBinaryExpression(singleStmt.expression) &&
              singleStmt.expression.operatorToken.kind === ts.SyntaxKind.CommaToken
            )
          ) {
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
        this.popScope();

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
          isOptional: p.questionToken ? true : undefined,
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
      } else if (ts.isClassStaticBlockDeclaration(member)) {
        staticBlocks.push(this.convertBlock(member.body));
      }
    }

    // Compact dual-case property accessors (e.g., property X and getter/setter x, or vice versa)
    const methodsToRemove = new Set<MethodDecl>();
    for (const prop of properties) {
      const propClean = prop.name.replace(/^_+/, "").toLowerCase();
      const matchingGetters = methods.filter(
        (m) =>
          !methodsToRemove.has(m) &&
          m.accessor === "get" &&
          m.name.replace(/^_+/, "").toLowerCase() === propClean &&
          m.name !== prop.name &&
          !properties.some((other) => other !== prop && other.name === m.name) &&
          this.isSimplePropertyGetter(m, prop.name, prop.isStatic, name),
      );
      for (const getter of matchingGetters) {
        const setter = methods.find(
          (m) =>
            !methodsToRemove.has(m) &&
            m.accessor === "set" &&
            m.name === getter.name &&
            this.isSimplePropertySetter(m, prop.name, prop.isStatic, name),
        );
        if (setter || prop.isReadonly) {
          if (!prop.aliases) {
            prop.aliases = [];
          }
          if (!prop.aliases.includes(getter.name)) {
            prop.aliases.push(getter.name);
          }
          if (!prop.typeAnnotation && getter.returnType) {
            prop.typeAnnotation = getter.returnType;
          }
          methodsToRemove.add(getter);
          if (setter) {
            methodsToRemove.add(setter);
          }
        }
      }
    }
    const finalMethods = methods.filter((m) => !methodsToRemove.has(m));

    return {
      kind: "ClassDecl",
      name,
      isExported,
      typeParams,
      primaryConstructor,
      extends: extendsName,
      implements: implementsList.length > 0 ? implementsList : undefined,
      properties,
      methods: finalMethods,
      staticBlocks: staticBlocks.length > 0 ? staticBlocks : undefined,
      span: this.getSpan(stmt),
    };
  }

  private isSimplePropertyGetter(
    m: MethodDecl,
    propName: string,
    isStatic: boolean,
    className: string,
  ): boolean {
    let expr: Expr | null = null;
    if (m.isExpressionBodied && !("statements" in m.body)) {
      expr = m.body as Expr;
    } else if ("statements" in m.body && m.body.statements.length === 1) {
      const stmt = m.body.statements[0];
      if (stmt.kind === "ReturnStmt") {
        expr = stmt.value;
      }
    }
    if (!expr) return false;
    if (isStatic) {
      return (
        (expr.kind === "MemberAccessExpr" &&
          expr.object.kind === "IdentifierExpr" &&
          expr.object.name === className &&
          expr.property === propName) ||
        (expr.kind === "IdentifierExpr" && expr.name === propName)
      );
    }
    return (
      (expr.kind === "MemberAccessExpr" &&
        expr.object.kind === "IdentifierExpr" &&
        expr.object.name === "this" &&
        expr.property === propName) ||
      (expr.kind === "IdentifierExpr" && expr.name === propName)
    );
  }

  private isSimplePropertySetter(
    m: MethodDecl,
    propName: string,
    isStatic: boolean,
    className: string,
  ): boolean {
    if (m.params.length !== 1) return false;
    const paramName = m.params[0].name;
    let target: Expr | null = null;
    let value: Expr | null = null;

    if (m.isExpressionBodied && !("statements" in m.body)) {
      if (m.body.kind === "AssignExpr") {
        target = m.body.target;
        value = m.body.value;
      }
    } else if ("statements" in m.body && m.body.statements.length === 1) {
      const stmt = m.body.statements[0];
      if (stmt.kind === "AssignStmt") {
        target = stmt.target;
        value = stmt.value;
      }
    }
    if (!target || !value) return false;
    if (value.kind !== "IdentifierExpr" || value.name !== paramName) return false;

    if (isStatic) {
      return (
        (target.kind === "MemberAccessExpr" &&
          target.object.kind === "IdentifierExpr" &&
          target.object.name === className &&
          target.property === propName) ||
        (target.kind === "IdentifierExpr" && target.name === propName)
      );
    }
    return (
      (target.kind === "MemberAccessExpr" &&
        target.object.kind === "IdentifierExpr" &&
        target.object.name === "this" &&
        target.property === propName) ||
      (target.kind === "IdentifierExpr" && target.name === propName)
    );
  }

  private convertVariableStatement(stmt: ts.VariableStatement): ModuleItem[] {
    const isExported = stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
    const isConst = (stmt.declarationList.flags & ts.NodeFlags.Const) !== 0;
    const items: ModuleItem[] = [];

    for (const decl of stmt.declarationList.declarations) {
      if (ts.isObjectBindingPattern(decl.name)) {
        let baseObjExpr: Expr;
        if (decl.initializer && ts.isIdentifier(decl.initializer)) {
          baseObjExpr = {
            kind: "IdentifierExpr",
            name: decl.initializer.text,
            span: this.getSpan(decl.initializer),
          };
        } else if (decl.initializer) {
          const tempName = "_destruct";
          items.push({
            kind: isConst ? "ConstDecl" : "VarDecl",
            name: tempName,
            isExported: false,
            isMut: !isConst,
            value: this.convertExpression(decl.initializer),
            span: this.getSpan(decl),
          });
          baseObjExpr = {
            kind: "IdentifierExpr",
            name: tempName,
            span: this.getSpan(decl),
          };
        } else {
          baseObjExpr = {
            kind: "LiteralExpr",
            literalKind: "nil",
            value: null,
            rawValue: "nil",
            span: this.getSpan(decl),
          };
        }

        for (const el of decl.name.elements) {
          if (ts.isBindingElement(el)) {
            const propName =
              el.propertyName && ts.isIdentifier(el.propertyName)
                ? el.propertyName.text
                : ts.isIdentifier(el.name)
                  ? el.name.text
                  : el.name.getText(this.sourceFile);
            const varName = ts.isIdentifier(el.name)
              ? el.name.text
              : el.name.getText(this.sourceFile);

            const accessExpr: Expr = {
              kind: "MemberAccessExpr",
              object: baseObjExpr,
              property: propName,
              isSafeNav: false,
              span: this.getSpan(el),
            };

            if (isConst) {
              items.push({
                kind: "ConstDecl",
                name: varName,
                isExported,
                value: accessExpr,
                span: this.getSpan(el),
              });
            } else {
              items.push({
                kind: "VarDecl",
                name: varName,
                isExported,
                isMut: true,
                value: accessExpr,
                span: this.getSpan(el),
              });
            }
          }
        }
        continue;
      }

      const name = ts.isIdentifier(decl.name) ? decl.name.text : decl.name.getText(this.sourceFile);
      const nodeId = `${isConst ? "const" : "var"}:${name}`;
      this.extractComments(stmt, nodeId);
      this.trackDeclaration(decl);

      const typeAnn = decl.type ? this.convertTypeNode(decl.type) : undefined;
      const value: Expr = decl.initializer
        ? this.convertExpression(decl.initializer)
        : {
            kind: "LiteralExpr",
            literalKind: "nil",
            value: null,
            rawValue: "nil",
            span: this.getSpan(decl),
          };

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
            this.trackDeclaration(decl);
            const isMut = (stmt.declarationList.flags & ts.NodeFlags.Const) === 0;
            let init: Expr;
            if (decl.initializer) {
              init = this.convertExpression(decl.initializer);
            } else if (decl.type && decl.type.kind === ts.SyntaxKind.NumberKeyword) {
              init = {
                kind: "LiteralExpr",
                literalKind: "number",
                value: 0,
                rawValue: "0",
                span: this.getSpan(decl),
              };
            } else if (decl.type && decl.type.kind === ts.SyntaxKind.BooleanKeyword) {
              init = {
                kind: "LiteralExpr",
                literalKind: "boolean",
                value: false,
                rawValue: "false",
                span: this.getSpan(decl),
              };
            } else if (decl.type && decl.type.kind === ts.SyntaxKind.StringKeyword) {
              init = {
                kind: "LiteralExpr",
                literalKind: "string",
                value: "",
                rawValue: '""',
                span: this.getSpan(decl),
              };
            } else if (
              decl.type &&
              (decl.type.kind === ts.SyntaxKind.UndefinedKeyword ||
                (ts.isUnionTypeNode(decl.type) &&
                  decl.type.types.some((t) => t.kind === ts.SyntaxKind.UndefinedKeyword)))
            ) {
              init = {
                kind: "IdentifierExpr",
                name: "undefined",
                span: this.getSpan(decl),
              };
            } else {
              init = {
                kind: "LiteralExpr",
                literalKind: "nil",
                value: null,
                rawValue: "nil",
                span: this.getSpan(decl),
              };
            }
            statements.push({
              kind: "LetBinding",
              name: decl.name.text,
              isMut: isMut || !decl.initializer,
              typeAnnotation: decl.type ? this.convertTypeNode(decl.type) : null,
              init,
              span: this.getSpan(decl),
            });
          } else if (ts.isArrayBindingPattern(decl.name)) {
            const isMut = (stmt.declarationList.flags & ts.NodeFlags.Const) === 0;
            const names: string[] = [];
            for (const el of decl.name.elements) {
              if (ts.isBindingElement(el)) {
                if (ts.isIdentifier(el.name)) {
                  names.push(el.name.text);
                } else {
                  names.push(el.name.getText(this.sourceFile));
                }
              }
            }
            const init = decl.initializer
              ? this.convertExpression(decl.initializer)
              : {
                  kind: "LiteralExpr" as const,
                  literalKind: "nil" as const,
                  value: null,
                  rawValue: "nil",
                  span: this.getSpan(decl),
                };
            if (this.inClosureDepth > 0) {
              const tempName = `_${names.filter(Boolean).join("_") || "destruct"}`;
              statements.push({
                kind: "LetBinding",
                name: tempName,
                isMut,
                typeAnnotation: null,
                init,
                span: this.getSpan(decl),
              });
              names.forEach((name, idx) => {
                if (!name) return;
                statements.push({
                  kind: "LetBinding",
                  name,
                  isMut,
                  typeAnnotation: null,
                  init: {
                    kind: "IndexExpr",
                    object: {
                      kind: "IdentifierExpr",
                      name: tempName,
                      span: this.getSpan(decl),
                    },
                    index: {
                      kind: "LiteralExpr",
                      literalKind: "number",
                      value: idx,
                      rawValue: String(idx),
                      span: this.getSpan(decl),
                    },
                    span: this.getSpan(decl),
                  },
                  span: this.getSpan(decl),
                });
              });
            } else {
              statements.push({
                kind: "DestructureBinding",
                names,
                isMut,
                init,
                span: this.getSpan(decl),
              });
            }
          }
        }
        continue;
      }
      const s = this.convertStatement(stmt);
      if (Array.isArray(s)) {
        statements.push(...s);
      } else if (s) {
        statements.push(s);
      }
    }
    return {
      kind: "Block",
      statements,
      span: this.getSpan(block),
    };
  }

  private collapseStatementsForClosure(stmts: Statement[], span: Span): Statement[] {
    if (this.inClosureDepth === 0 || stmts.length <= 1) {
      return stmts;
    }

    const exprs: Expr[] = [];
    for (const s of stmts) {
      if (s.kind === "ExprStmt") {
        exprs.push(s.expr);
      } else if (s.kind === "AssignStmt") {
        exprs.push({
          kind: "AssignExpr",
          target: s.target,
          op: s.op,
          value: s.value,
          span: s.span,
        });
      } else {
        return stmts;
      }
    }

    if (exprs.length === stmts.length) {
      return [
        {
          kind: "ExprStmt",
          expr: {
            kind: "ArrayLiteralExpr",
            elements: exprs,
            span,
          },
          span,
        },
      ];
    }

    return stmts;
  }

  private convertStatement(stmt: ts.Statement): Statement | Statement[] | null {
    if (ts.isVariableStatement(stmt)) {
      const decl = stmt.declarationList.declarations[0];
      if (decl && ts.isIdentifier(decl.name)) {
        this.trackDeclaration(decl);
        const isMut = (stmt.declarationList.flags & ts.NodeFlags.Const) === 0;
        let init: Expr;
        if (decl.initializer) {
          init = this.convertExpression(decl.initializer);
        } else if (decl.type && decl.type.kind === ts.SyntaxKind.NumberKeyword) {
          init = {
            kind: "LiteralExpr",
            literalKind: "number",
            value: 0,
            rawValue: "0",
            span: this.getSpan(decl),
          };
        } else if (decl.type && decl.type.kind === ts.SyntaxKind.BooleanKeyword) {
          init = {
            kind: "LiteralExpr",
            literalKind: "boolean",
            value: false,
            rawValue: "false",
            span: this.getSpan(decl),
          };
        } else if (decl.type && decl.type.kind === ts.SyntaxKind.StringKeyword) {
          init = {
            kind: "LiteralExpr",
            literalKind: "string",
            value: "",
            rawValue: '""',
            span: this.getSpan(decl),
          };
        } else if (
          decl.type &&
          (decl.type.kind === ts.SyntaxKind.UndefinedKeyword ||
            (ts.isUnionTypeNode(decl.type) &&
              decl.type.types.some((t) => t.kind === ts.SyntaxKind.UndefinedKeyword)))
        ) {
          init = {
            kind: "IdentifierExpr",
            name: "undefined",
            span: this.getSpan(decl),
          };
        } else {
          init = {
            kind: "LiteralExpr",
            literalKind: "nil",
            value: null,
            rawValue: "nil",
            span: this.getSpan(decl),
          };
        }
        return {
          kind: "LetBinding",
          name: decl.name.text,
          isMut: isMut || !decl.initializer,
          typeAnnotation: decl.type ? this.convertTypeNode(decl.type) : null,
          init,
          span: this.getSpan(stmt),
        };
      } else if (decl && ts.isArrayBindingPattern(decl.name)) {
        const isMut = (stmt.declarationList.flags & ts.NodeFlags.Const) === 0;
        const names: string[] = [];
        for (const el of decl.name.elements) {
          if (ts.isBindingElement(el)) {
            if (ts.isIdentifier(el.name)) {
              names.push(el.name.text);
            } else {
              names.push(el.name.getText(this.sourceFile));
            }
          }
        }
        const init = decl.initializer
          ? this.convertExpression(decl.initializer)
          : {
              kind: "LiteralExpr" as const,
              literalKind: "nil" as const,
              value: null,
              rawValue: "nil",
              span: this.getSpan(decl),
            };
        if (this.inClosureDepth > 0) {
          const tempName = `_${names.filter(Boolean).join("_") || "destruct"}`;
          const unrolled: Statement[] = [
            {
              kind: "LetBinding",
              name: tempName,
              isMut,
              typeAnnotation: null,
              init,
              span: this.getSpan(stmt),
            },
          ];
          names.forEach((name, idx) => {
            if (!name) return;
            unrolled.push({
              kind: "LetBinding",
              name,
              isMut,
              typeAnnotation: null,
              init: {
                kind: "IndexExpr",
                object: {
                  kind: "IdentifierExpr",
                  name: tempName,
                  span: this.getSpan(stmt),
                },
                index: {
                  kind: "LiteralExpr",
                  literalKind: "number",
                  value: idx,
                  rawValue: String(idx),
                  span: this.getSpan(stmt),
                },
                span: this.getSpan(stmt),
              },
              span: this.getSpan(stmt),
            });
          });
          return unrolled;
        }
        return {
          kind: "DestructureBinding",
          names,
          isMut,
          init,
          span: this.getSpan(stmt),
        };
      } else if (decl && ts.isObjectBindingPattern(decl.name)) {
        const isMut = (stmt.declarationList.flags & ts.NodeFlags.Const) === 0;
        const unrolled: Statement[] = [];
        let baseObjExpr: Expr;

        if (decl.initializer && ts.isIdentifier(decl.initializer)) {
          baseObjExpr = {
            kind: "IdentifierExpr",
            name: decl.initializer.text,
            span: this.getSpan(decl.initializer),
          };
        } else if (decl.initializer) {
          const tempName = "_destruct";
          unrolled.push({
            kind: "LetBinding",
            name: tempName,
            isMut: false,
            typeAnnotation: null,
            init: this.convertExpression(decl.initializer),
            span: this.getSpan(stmt),
          });
          baseObjExpr = {
            kind: "IdentifierExpr",
            name: tempName,
            span: this.getSpan(stmt),
          };
        } else {
          baseObjExpr = {
            kind: "LiteralExpr",
            literalKind: "nil",
            value: null,
            rawValue: "nil",
            span: this.getSpan(stmt),
          };
        }

        for (const el of decl.name.elements) {
          if (ts.isBindingElement(el)) {
            const propName =
              el.propertyName && ts.isIdentifier(el.propertyName)
                ? el.propertyName.text
                : ts.isIdentifier(el.name)
                  ? el.name.text
                  : el.name.getText(this.sourceFile);
            const varName = ts.isIdentifier(el.name)
              ? el.name.text
              : el.name.getText(this.sourceFile);

            unrolled.push({
              kind: "LetBinding",
              name: varName,
              isMut,
              typeAnnotation: null,
              init: {
                kind: "MemberAccessExpr",
                object: baseObjExpr,
                property: propName,
                isSafeNav: false,
                span: this.getSpan(el),
              },
              span: this.getSpan(el),
            });
          }
        }
        return unrolled.length === 1 ? unrolled[0] : unrolled;
      }
    }

    if (ts.isReturnStatement(stmt)) {
      if (stmt.expression && ts.isConditionalExpression(stmt.expression)) {
        return this.convertConditionalReturn(stmt.expression, this.getSpan(stmt));
      }
      if (
        stmt.expression &&
        ts.isBinaryExpression(stmt.expression) &&
        stmt.expression.operatorToken.kind === ts.SyntaxKind.CommaToken
      ) {
        const exprs: ts.Expression[] = [];
        let curr: ts.Expression = stmt.expression;
        while (
          ts.isBinaryExpression(curr) &&
          curr.operatorToken.kind === ts.SyntaxKind.CommaToken
        ) {
          exprs.unshift(curr.right);
          curr = curr.left;
        }
        exprs.unshift(curr);
        const retExpr = exprs.pop()!;
        const stmts: Statement[] = exprs.map((e) => ({
          kind: "ExprStmt" as const,
          expr: this.convertExpression(e),
          span: this.getSpan(e),
        }));
        stmts.push({
          kind: "ReturnStmt",
          value: this.convertExpression(retExpr),
          span: this.getSpan(stmt),
        });
        return stmts;
      }
      let retValue: Expr | null = stmt.expression ? this.convertExpression(stmt.expression) : null;
      if (!retValue && this.inClosureDepth > 0) {
        retValue = {
          kind: "LiteralExpr",
          literalKind: "nil",
          value: null,
          rawValue: "nil",
          span: this.getSpan(stmt),
        };
      }
      return {
        kind: "ReturnStmt",
        value: retValue,
        span: this.getSpan(stmt),
      };
    }

    if (ts.isIfStatement(stmt)) {
      const condition = this.ensureBooleanCondition(stmt.expression);
      let thenBranch: Block;
      if (ts.isBlock(stmt.thenStatement)) {
        thenBranch = this.convertBlock(stmt.thenStatement);
      } else {
        const single = this.convertStatement(stmt.thenStatement);
        const stmts = Array.isArray(single) ? single : single ? [single] : [];
        thenBranch = {
          kind: "Block" as const,
          statements: stmts,
          span: this.getSpan(stmt.thenStatement),
        };
      }

      let elseBranch: Block | null = null;
      const elifBranches: { condition: Expr; body: Block; span: Span }[] = [];

      let currentElse: ts.Statement | undefined = stmt.elseStatement;
      while (currentElse && ts.isIfStatement(currentElse)) {
        let elifBody: Block;
        if (ts.isBlock(currentElse.thenStatement)) {
          elifBody = this.convertBlock(currentElse.thenStatement);
        } else {
          const single = this.convertStatement(currentElse.thenStatement);
          const stmts = Array.isArray(single) ? single : single ? [single] : [];
          elifBody = {
            kind: "Block" as const,
            statements: stmts,
            span: this.getSpan(currentElse.thenStatement),
          };
        }
        const elifCond = this.ensureBooleanCondition(currentElse.expression);
        elifBranches.push({
          condition: elifCond,
          body: elifBody,
          span: this.getSpan(currentElse),
        });
        currentElse = currentElse.elseStatement;
      }

      if (currentElse) {
        if (ts.isBlock(currentElse)) {
          elseBranch = this.convertBlock(currentElse);
        } else {
          const single = this.convertStatement(currentElse);
          const stmts = Array.isArray(single) ? single : single ? [single] : [];
          elseBranch = {
            kind: "Block" as const,
            statements: stmts,
            span: this.getSpan(currentElse),
          };
        }
      }

      if (this.inClosureDepth > 0) {
        thenBranch.statements = this.collapseStatementsForClosure(
          thenBranch.statements,
          thenBranch.span,
        );
        for (const eb of elifBranches) {
          eb.body.statements = this.collapseStatementsForClosure(
            eb.body.statements,
            eb.body.span,
          );
        }
        if (elseBranch) {
          elseBranch.statements = this.collapseStatementsForClosure(
            elseBranch.statements,
            elseBranch.span,
          );
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
      const decl = stmt.initializer.declarations[0];
      if (decl && ts.isObjectBindingPattern(decl.name)) {
        const loopVar = "_item";
        const bodyBlock = ts.isBlock(stmt.statement)
          ? this.convertBlock(stmt.statement)
          : { kind: "Block" as const, statements: [], span: emptySpan() };

        const destructStatements: Statement[] = [];
        for (const el of decl.name.elements) {
          if (ts.isBindingElement(el)) {
            const propName =
              el.propertyName && ts.isIdentifier(el.propertyName)
                ? el.propertyName.text
                : ts.isIdentifier(el.name)
                  ? el.name.text
                  : el.name.getText(this.sourceFile);
            const varName = ts.isIdentifier(el.name)
              ? el.name.text
              : el.name.getText(this.sourceFile);

            destructStatements.push({
              kind: "LetBinding",
              name: varName,
              isMut: false,
              typeAnnotation: null,
              init: {
                kind: "MemberAccessExpr",
                object: {
                  kind: "IdentifierExpr",
                  name: loopVar,
                  span: this.getSpan(el),
                },
                property: propName,
                isSafeNav: false,
                span: this.getSpan(el),
              },
              span: this.getSpan(el),
            });
          }
        }

        bodyBlock.statements.unshift(...destructStatements);

        return {
          kind: "ForStmt",
          variable: loopVar,
          iterable: this.convertExpression(stmt.expression),
          body: bodyBlock,
          span: this.getSpan(stmt),
        };
      }

      const varName = decl?.name.getText(this.sourceFile) ?? "item";
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
        condition: this.ensureBooleanCondition(stmt.expression),
        body: ts.isBlock(stmt.statement)
          ? this.convertBlock(stmt.statement)
          : { kind: "Block" as const, statements: [], span: emptySpan() },
        span: this.getSpan(stmt),
      };
    }

    if (ts.isExpressionStatement(stmt)) {
      return this.convertExpressionToStatement(stmt.expression);
    }

    if (ts.isBlock(stmt)) {
      return this.convertBlock(stmt).statements;
    }

    if (ts.isForStatement(stmt)) {
      let initStmt: Statement | null = null;
      if (stmt.initializer) {
        if (ts.isVariableDeclarationList(stmt.initializer)) {
          const decl = stmt.initializer.declarations[0];
          if (decl && ts.isIdentifier(decl.name)) {
            const init = decl.initializer
              ? this.convertExpression(decl.initializer)
              : {
                  kind: "LiteralExpr" as const,
                  literalKind: "number" as const,
                  value: 0,
                  rawValue: "0",
                  span: this.getSpan(decl),
                };
            initStmt = {
              kind: "LetBinding",
              name: decl.name.text,
              isMut: true,
              typeAnnotation: decl.type ? this.convertTypeNode(decl.type) : null,
              init,
              span: this.getSpan(stmt.initializer),
            };
          }
        } else if (ts.isExpression(stmt.initializer)) {
          initStmt = this.convertExpressionToStatement(stmt.initializer);
        }
      }

      const condition: Expr = stmt.condition
        ? this.ensureBooleanCondition(this.convertExpression(stmt.condition))
        : {
            kind: "LiteralExpr",
            literalKind: "boolean",
            value: true,
            rawValue: "true",
            span: this.getSpan(stmt),
          };

      let body: Block;
      if (ts.isBlock(stmt.statement)) {
        body = this.convertBlock(stmt.statement);
      } else {
        const single = this.convertStatement(stmt.statement);
        const stmts = Array.isArray(single) ? single : single ? [single] : [];
        body = {
          kind: "Block",
          statements: stmts,
          span: this.getSpan(stmt.statement),
        };
      }

      if (stmt.incrementor) {
        const incStmt = this.convertExpressionToStatement(stmt.incrementor);
        body.statements.push(incStmt);
      }

      const whileStmt: WhileStmt = {
        kind: "WhileStmt",
        condition,
        body,
        span: this.getSpan(stmt),
      };

      if (initStmt) {
        return [initStmt, whileStmt];
      }
      return whileStmt;
    }

    if (ts.isSwitchStatement(stmt)) {
      const target = this.convertExpression(stmt.expression);

      let hasFallthroughOrComplex = this.inClosureDepth > 0;
      for (let i = 0; i < stmt.caseBlock.clauses.length; i++) {
        const clause = stmt.caseBlock.clauses[i];
        if (ts.isCaseClause(clause)) {
          const isSimple =
            ts.isStringLiteral(clause.expression) ||
            ts.isNumericLiteral(clause.expression) ||
            clause.expression.kind === ts.SyntaxKind.TrueKeyword ||
            clause.expression.kind === ts.SyntaxKind.FalseKeyword ||
            clause.expression.kind === ts.SyntaxKind.NullKeyword ||
            ts.isIdentifier(clause.expression);
          if (!isSimple) {
            hasFallthroughOrComplex = true;
            break;
          }
          const nonBreak = clause.statements.filter(
            (s, idx) => !(idx === clause.statements.length - 1 && ts.isBreakStatement(s))
          );
          if (nonBreak.length === 0 && i < stmt.caseBlock.clauses.length - 1) {
            hasFallthroughOrComplex = true;
            break;
          }
        }
      }

      if (hasFallthroughOrComplex) {
        interface LoweredBranch {
          conditions: Expr[];
          isDefault: boolean;
          statements: Statement[];
          span: Span;
        }

        const branches: LoweredBranch[] = [];
        let pendingConditions: Expr[] = [];
        let pendingIsDefault = false;

        for (const clause of stmt.caseBlock.clauses) {
          const cSpan = this.getSpan(clause);
          if (ts.isCaseClause(clause)) {
            const caseExpr = this.convertExpression(clause.expression);
            pendingConditions.push({
              kind: "BinaryExpr",
              left: target,
              operator: "==",
              right: caseExpr,
              span: cSpan,
            });
          } else {
            pendingIsDefault = true;
          }

          const nonBreakStatements: ts.Statement[] = [];
          for (let i = 0; i < clause.statements.length; i++) {
            const s = clause.statements[i];
            if (i === clause.statements.length - 1 && ts.isBreakStatement(s)) {
              continue;
            }
            nonBreakStatements.push(s);
          }

          if (nonBreakStatements.length > 0) {
            const clauseStmts: Statement[] = [];
            for (const s of nonBreakStatements) {
              const converted = this.convertStatement(s);
              if (Array.isArray(converted)) {
                clauseStmts.push(...converted);
              } else if (converted) {
                clauseStmts.push(converted);
              }
            }

            const finalStmts = this.collapseStatementsForClosure(clauseStmts, cSpan);

            branches.push({
              conditions: pendingConditions,
              isDefault: pendingIsDefault,
              statements: finalStmts,
              span: cSpan,
            });

            pendingConditions = [];
            pendingIsDefault = false;
          }
        }

        const defaultBranch = branches.find((b) => b.isDefault);
        const conditionalBranches = branches.filter((b) => !b.isDefault && b.conditions.length > 0);

        if (conditionalBranches.length === 0) {
          if (defaultBranch) {
            return defaultBranch.statements;
          }
          return null;
        }

        const combineConditions = (conds: Expr[], span: Span): Expr => {
          if (conds.length === 1) return conds[0];
          let res = conds[0];
          for (let i = 1; i < conds.length; i++) {
            res = {
              kind: "BinaryExpr",
              left: res,
              operator: "or",
              right: conds[i],
              span,
            };
          }
          return res;
        };

        const first = conditionalBranches[0];
        const thenCondition = combineConditions(first.conditions, first.span);
        const thenBranch: Block = {
          kind: "Block",
          statements: first.statements,
          span: first.span,
        };

        const elifBranches: { condition: Expr; body: Block; span: Span }[] = [];
        for (let i = 1; i < conditionalBranches.length; i++) {
          const b = conditionalBranches[i];
          elifBranches.push({
            condition: combineConditions(b.conditions, b.span),
            body: {
              kind: "Block",
              statements: b.statements,
              span: b.span,
            },
            span: b.span,
          });
        }

        const elseBranch: Block | null = defaultBranch
          ? {
              kind: "Block",
              statements: defaultBranch.statements,
              span: defaultBranch.span,
            }
          : null;

        return {
          kind: "IfStmt",
          condition: thenCondition,
          thenBranch,
          elifBranches,
          elseBranch,
          span: this.getSpan(stmt),
        };
      }

      const cases: MatchCase[] = [];

      for (const clause of stmt.caseBlock.clauses) {
        let pattern: Pattern;
        if (ts.isCaseClause(clause)) {
          const expr = this.convertExpression(clause.expression);
          if (expr.kind === "LiteralExpr") {
            pattern = { kind: "LiteralPattern", value: expr, span: expr.span };
          } else if (expr.kind === "IdentifierExpr") {
            pattern = { kind: "IdentifierPattern", name: expr.name, span: expr.span };
          } else {
            pattern = {
              kind: "IdentifierPattern",
              name: clause.expression.getText(this.sourceFile),
              span: this.getSpan(clause.expression),
            };
          }
        } else {
          // default clause
          pattern = { kind: "WildcardPattern", span: this.getSpan(clause) };
        }

        const clauseStmts: Statement[] = [];
        for (let i = 0; i < clause.statements.length; i++) {
          const s = clause.statements[i];
          if (i === clause.statements.length - 1 && ts.isBreakStatement(s)) {
            continue;
          }
          const converted = this.convertStatement(s);
          if (Array.isArray(converted)) {
            clauseStmts.push(...converted);
          } else if (converted) {
            clauseStmts.push(converted);
          }
        }

        cases.push({
          pattern,
          body: {
            kind: "Block",
            statements: clauseStmts,
            span: this.getSpan(clause),
          },
          span: this.getSpan(clause),
        });
      }

      return {
        kind: "MatchStmt",
        target,
        cases,
        span: this.getSpan(stmt),
      };
    }

    if (ts.isTryStatement(stmt)) {
      if (this.inClosureDepth > 0) {
        const unrolled: Statement[] = [];
        for (const s of stmt.tryBlock.statements) {
          const res = this.convertStatement(s);
          if (Array.isArray(res)) unrolled.push(...res);
          else if (res) unrolled.push(res);
        }
        return unrolled;
      }
      const tryBlock = this.convertBlock(stmt.tryBlock);
      let catchParam: string | undefined;
      let catchBlock: Block | undefined;
      let finallyBlock: Block | undefined;

      if (stmt.catchClause) {
        if (
          stmt.catchClause.variableDeclaration &&
          ts.isIdentifier(stmt.catchClause.variableDeclaration.name)
        ) {
          catchParam = stmt.catchClause.variableDeclaration.name.text;
        }
        catchBlock = this.convertBlock(stmt.catchClause.block);
      }

      if (stmt.finallyBlock) {
        finallyBlock = this.convertBlock(stmt.finallyBlock);
      }

      return {
        kind: "TryStmt",
        tryBlock,
        catchParam,
        catchBlock,
        finallyBlock,
        span: this.getSpan(stmt),
      };
    }

    if (ts.isThrowStatement(stmt)) {
      return {
        kind: "ThrowStmt",
        expr: this.convertExpression(stmt.expression),
        span: this.getSpan(stmt),
      };
    }

    if (ts.isBreakStatement(stmt)) {
      return {
        kind: "BreakStmt",
        span: this.getSpan(stmt),
      };
    }

    if (ts.isContinueStatement(stmt)) {
      return {
        kind: "ContinueStmt",
        span: this.getSpan(stmt),
      };
    }

    return null;
  }

  private convertExpressionToStatement(expr: ts.Expression): Statement {
    const span = this.getSpan(expr);

    // Check for assignment: target = value or compound assignment target += value
    if (ts.isBinaryExpression(expr)) {
      const assignOp = this.convertAssignOp(expr.operatorToken.kind);
      if (assignOp) {
        const target = this.convertExpression(expr.left);
        if (assignOp === "=" && ts.isConditionalExpression(expr.right)) {
          return this.convertConditionalAssign(target, expr.right, span);
        }
        return {
          kind: "AssignStmt",
          target,
          op: assignOp,
          value: this.convertExpression(expr.right),
          span,
        };
      }
    }

    // Check for increment / decrement: i++ or i--
    if (
      (ts.isPostfixUnaryExpression(expr) || ts.isPrefixUnaryExpression(expr)) &&
      (expr.operator === ts.SyntaxKind.PlusPlusToken ||
        expr.operator === ts.SyntaxKind.MinusMinusToken)
    ) {
      const target = this.convertExpression(expr.operand);
      const op: BinaryOp = expr.operator === ts.SyntaxKind.PlusPlusToken ? "+" : "-";
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
            span,
          },
          span,
        },
        span,
      };
    }

    return {
      kind: "ExprStmt",
      expr: this.convertExpression(expr),
      span,
    };
  }

  private isNumericName(name: string): boolean {
    const lower = name.toLowerCase();
    return (
      lower === "flags" ||
      lower === "count" ||
      lower === "length" ||
      lower === "len" ||
      lower === "size" ||
      lower === "total" ||
      lower === "offset" ||
      lower === "index" ||
      lower === "idx" ||
      lower === "num" ||
      lower === "code" ||
      lower === "depth" ||
      lower === "level" ||
      lower === "counter" ||
      lower === "retries" ||
      lower === "retrycount" ||
      lower === "status" ||
      lower === "statuscode" ||
      lower.endsWith("count") ||
      lower.endsWith("size") ||
      lower.endsWith("length") ||
      lower.endsWith("index") ||
      lower.endsWith("offset")
    );
  }

  private isNumericExpr(cond: Expr, tsExpr?: ts.Expression): boolean {
    if (tsExpr) {
      if (ts.isNumericLiteral(tsExpr)) return true;
      if (ts.isBinaryExpression(tsExpr)) {
        const op = tsExpr.operatorToken.kind;
        if (
          op === ts.SyntaxKind.AmpersandToken ||
          op === ts.SyntaxKind.BarToken ||
          op === ts.SyntaxKind.CaretToken ||
          op === ts.SyntaxKind.LessThanLessThanToken ||
          op === ts.SyntaxKind.GreaterThanGreaterThanToken ||
          op === ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken ||
          op === ts.SyntaxKind.PlusToken ||
          op === ts.SyntaxKind.MinusToken ||
          op === ts.SyntaxKind.AsteriskToken ||
          op === ts.SyntaxKind.SlashToken ||
          op === ts.SyntaxKind.PercentToken ||
          op === ts.SyntaxKind.AsteriskAsteriskToken
        ) {
          return true;
        }
      }
      if (ts.isPrefixUnaryExpression(tsExpr)) {
        const op = tsExpr.operator;
        if (
          op === ts.SyntaxKind.PlusToken ||
          op === ts.SyntaxKind.MinusToken ||
          op === ts.SyntaxKind.TildeToken
        ) {
          return true;
        }
      }
      if (ts.isPropertyAccessExpression(tsExpr)) {
        const prop = tsExpr.name.text;
        if (
          prop === "length" ||
          prop === "size" ||
          prop === "byteLength" ||
          prop === "charCount" ||
          prop === "count"
        ) {
          return true;
        }
      }
      if (ts.isIdentifier(tsExpr)) {
        const typeCat = this.getVarType(tsExpr.text);
        if (typeCat === "number") return true;
        if (typeCat && typeCat !== "number") return false;
        if (this.isNumericName(tsExpr.text)) return true;
      }
    }

    if (
      cond.kind === "LiteralExpr" &&
      (cond.literalKind === "number" || typeof cond.value === "number")
    ) {
      return true;
    }
    if (cond.kind === "BinaryExpr") {
      const op = cond.operator;
      if (
        op === "&" ||
        op === "|" ||
        op === "^" ||
        op === "<<" ||
        op === ">>" ||
        op === ">>>" ||
        op === "+" ||
        op === "-" ||
        op === "*" ||
        op === "/" ||
        op === "%" ||
        op === "**"
      ) {
        return true;
      }
    }
    if (cond.kind === "MemberAccessExpr") {
      const prop = cond.property;
      if (
        prop === "length" ||
        prop === "size" ||
        prop === "byteLength" ||
        prop === "charCount" ||
        prop === "count"
      ) {
        return true;
      }
    }
    if (cond.kind === "IdentifierExpr") {
      const typeCat = this.getVarType(cond.name);
      if (typeCat === "number") return true;
      if (this.isNumericName(cond.name)) return true;
    }
    return false;
  }

  private isStringExpr(cond: Expr, tsExpr?: ts.Expression): boolean {
    if (cond.kind === "TemplateLiteralExpr") return true;
    if (tsExpr) {
      if (
        ts.isStringLiteral(tsExpr) ||
        ts.isNoSubstitutionTemplateLiteral(tsExpr) ||
        ts.isTemplateExpression(tsExpr)
      ) {
        return true;
      }
      if (ts.isIdentifier(tsExpr)) {
        const typeCat = this.getVarType(tsExpr.text);
        if (typeCat === "string") return true;
      }
    }
    if (
      cond.kind === "LiteralExpr" &&
      (cond.literalKind === "string" || typeof cond.value === "string")
    ) {
      return true;
    }
    if (cond.kind === "IdentifierExpr") {
      const typeCat = this.getVarType(cond.name);
      if (typeCat === "string") return true;
    }
    return false;
  }

  private isTsNode(node: unknown): node is ts.Node {
    return typeof node === "object" && node !== null && typeof (node as any).kind === "number";
  }

  private ensureBooleanCondition(expr: ts.Expression): Expr;
  private ensureBooleanCondition(cond: Expr, tsExpr?: ts.Expression): Expr;
  private ensureBooleanCondition(first: Expr | ts.Expression, second?: ts.Expression): Expr {
    let cond: Expr;
    let tsExpr: ts.Expression | undefined;

    if (this.isTsNode(first)) {
      tsExpr = first as ts.Expression;
      cond = this.convertExpression(tsExpr);
    } else {
      cond = first as Expr;
      tsExpr = second;
    }

    if (tsExpr && ts.isParenthesizedExpression(tsExpr)) {
      while (tsExpr && ts.isParenthesizedExpression(tsExpr)) {
        tsExpr = tsExpr.expression;
      }
    }

    // Logical binary expressions (and / or) -> recursively ensure both sides
    if (
      cond.kind === "BinaryExpr" &&
      (cond.operator === "and" ||
        cond.operator === "or" ||
        cond.operator === "&&" ||
        cond.operator === "||")
    ) {
      let tsLeft: ts.Expression | undefined;
      let tsRight: ts.Expression | undefined;
      if (tsExpr && ts.isBinaryExpression(tsExpr)) {
        tsLeft = tsExpr.left;
        tsRight = tsExpr.right;
      }
      return {
        ...cond,
        left: this.ensureBooleanCondition(cond.left, tsLeft),
        right: this.ensureBooleanCondition(cond.right, tsRight),
      };
    }

    // Already a comparison, relational, or null-coalescing
    if (
      cond.kind === "BinaryExpr" &&
      (cond.operator === "==" ||
        cond.operator === "!=" ||
        cond.operator === "<" ||
        cond.operator === "<=" ||
        cond.operator === ">" ||
        cond.operator === ">=" ||
        cond.operator === "??" ||
        cond.operator === "in" ||
        cond.operator === "instanceof")
    ) {
      return cond;
    }

    // Boolean literal
    if (
      cond.kind === "LiteralExpr" &&
      (cond.literalKind === "boolean" || typeof cond.value === "boolean")
    ) {
      return cond;
    }

    // If it's a unary 'not'
    if (cond.kind === "UnaryExpr" && (cond.operator === "not" || cond.operator === "!")) {
      let innerTs: ts.Expression | undefined;
      if (tsExpr && ts.isPrefixUnaryExpression(tsExpr)) {
        innerTs = tsExpr.operand;
      }
      if (this.isNumericExpr(cond.operand, innerTs)) {
        return {
          kind: "BinaryExpr",
          operator: "==",
          left: cond.operand,
          right: {
            kind: "LiteralExpr",
            literalKind: "number",
            value: 0,
            rawValue: "0",
            span: cond.span,
          },
          span: cond.span,
        };
      }
      if (this.isStringExpr(cond.operand, innerTs)) {
        return {
          kind: "BinaryExpr",
          operator: "==",
          left: cond.operand,
          right: {
            kind: "LiteralExpr",
            literalKind: "string",
            value: "",
            rawValue: '""',
            span: cond.span,
          },
          span: cond.span,
        };
      }
      return cond;
    }

    // Numeric expression: lower to expr != 0
    if (this.isNumericExpr(cond, tsExpr)) {
      return {
        kind: "BinaryExpr",
        operator: "!=",
        left: cond,
        right: {
          kind: "LiteralExpr",
          literalKind: "number",
          value: 0,
          rawValue: "0",
          span: cond.span,
        },
        span: cond.span,
      };
    }

    // String expression: lower to expr != ""
    if (this.isStringExpr(cond, tsExpr)) {
      return {
        kind: "BinaryExpr",
        operator: "!=",
        left: cond,
        right: {
          kind: "LiteralExpr",
          literalKind: "string",
          value: "",
          rawValue: '""',
          span: cond.span,
        },
        span: cond.span,
      };
    }

    return cond;
  }

  private convertConditionalReturn(expr: ts.ConditionalExpression, span: Span): IfStmt {
    const condition = this.ensureBooleanCondition(expr.condition);
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
        condition: this.ensureBooleanCondition(currentElse.condition),
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
    const condition = this.ensureBooleanCondition(expr.condition);
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
        condition: this.ensureBooleanCondition(currentElse.condition),
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
        rawValue: expr.text.includes("\n") ? `"""\n${expr.text}\n"""` : JSON.stringify(expr.text),
        span: this.getSpan(expr),
      };
    }

    if (ts.isTemplateExpression(expr)) {
      const quasis: string[] = [
        (expr.head as any).rawText ?? expr.head.text.replace(/`/g, "\\`"),
      ];
      const expressions: Expr[] = [];

      for (const span of expr.templateSpans) {
        expressions.push(this.convertExpression(span.expression));
        quasis.push(
          (span.literal as any).rawText ?? span.literal.text.replace(/`/g, "\\`"),
        );
      }

      return {
        kind: "TemplateLiteralExpr",
        quasis,
        expressions,
        span: this.getSpan(expr),
      };
    }

    if (ts.isNumericLiteral(expr)) {
      return {
        kind: "LiteralExpr",
        literalKind: "number",
        value: Number(expr.text),
        rawValue: expr.getText(this.sourceFile) || expr.text,
        span: this.getSpan(expr),
      };
    }

    if (ts.isRegularExpressionLiteral(expr)) {
      const text = expr.text;
      const lastSlash = text.lastIndexOf("/");
      const pattern = lastSlash > 0 ? text.slice(1, lastSlash) : text.slice(1);
      const flags = lastSlash > 0 ? text.slice(lastSlash + 1) : "";
      const args: Expr[] = [
        {
          kind: "LiteralExpr",
          literalKind: "string",
          value: pattern,
          rawValue: JSON.stringify(pattern),
          span: this.getSpan(expr),
        },
      ];
      if (flags.length > 0) {
        args.push({
          kind: "LiteralExpr",
          literalKind: "string",
          value: flags,
          rawValue: JSON.stringify(flags),
          span: this.getSpan(expr),
        });
      }
      return {
        kind: "CallExpr",
        callee: {
          kind: "IdentifierExpr",
          name: "RegExp",
          span: this.getSpan(expr),
        },
        args,
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

    if (expr.kind === ts.SyntaxKind.SuperKeyword) {
      return {
        kind: "IdentifierExpr",
        name: "super",
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
      const cond = this.ensureBooleanCondition(expr.condition);
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

    // Binary Expressions or Assignment Expressions
    if (ts.isBinaryExpression(expr)) {
      const assignOp = this.convertAssignOp(expr.operatorToken.kind);
      if (assignOp) {
        return {
          kind: "AssignExpr",
          target: this.convertExpression(expr.left),
          op: assignOp,
          value: this.convertExpression(expr.right),
          span: this.getSpan(expr),
        };
      }

      if (expr.operatorToken.kind === ts.SyntaxKind.CommaToken) {
        return this.convertExpression(expr.right);
      }

      if (expr.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
        return {
          kind: "BinaryExpr",
          operator: "and",
          left: this.convertExpression(expr.left),
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

    // Await Expressions
    if (ts.isAwaitExpression(expr)) {
      return {
        kind: "AwaitExpr",
        operand: this.convertExpression(expr.expression),
        span: this.getSpan(expr),
      };
    }

    // Call Expressions
    if (ts.isCallExpression(expr)) {
      // Check for Math builtins (min, max, hypot, clamp, etc.)
      if (
        ts.isPropertyAccessExpression(expr.expression) &&
        ts.isIdentifier(expr.expression.expression) &&
        expr.expression.expression.text === "Math"
      ) {
        const fnName = expr.expression.name.text;

        // Check for clamp pattern 1: Math.max(min, Math.min(max, val))
        if (fnName === "max" && expr.arguments.length === 2) {
          const second = expr.arguments[1];
          if (
            ts.isCallExpression(second) &&
            ts.isPropertyAccessExpression(second.expression) &&
            ts.isIdentifier(second.expression.expression) &&
            second.expression.expression.text === "Math" &&
            second.expression.name.text === "min" &&
            second.arguments.length === 2
          ) {
            const minVal = this.convertExpression(expr.arguments[0]);
            const maxVal = this.convertExpression(second.arguments[0]);
            const val = this.convertExpression(second.arguments[1]);
            return {
              kind: "CallExpr",
              callee: {
                kind: "IdentifierExpr",
                name: "clamp",
                span: this.getSpan(expr.expression),
              },
              args: [val, minVal, maxVal],
              span: this.getSpan(expr),
            };
          }
        }

        // Check for clamp pattern 2: Math.min(Math.max(val, min), max)
        if (fnName === "min" && expr.arguments.length === 2) {
          const first = expr.arguments[0];
          if (
            ts.isCallExpression(first) &&
            ts.isPropertyAccessExpression(first.expression) &&
            ts.isIdentifier(first.expression.expression) &&
            first.expression.expression.text === "Math" &&
            first.expression.name.text === "max" &&
            first.arguments.length === 2
          ) {
            const val = this.convertExpression(first.arguments[0]);
            const minVal = this.convertExpression(first.arguments[1]);
            const maxVal = this.convertExpression(expr.arguments[1]);
            return {
              kind: "CallExpr",
              callee: {
                kind: "IdentifierExpr",
                name: "clamp",
                span: this.getSpan(expr.expression),
              },
              args: [val, minVal, maxVal],
              span: this.getSpan(expr),
            };
          }
        }

        const isShadowed = this.currentScopeVars.some((scope) => scope.has(fnName));
        if (TS_MATH_BUILTINS.has(fnName) && !isShadowed) {
          return {
            kind: "CallExpr",
            callee: {
              kind: "IdentifierExpr",
              name: fnName,
              span: this.getSpan(expr.expression),
            },
            args: expr.arguments.map((a) => this.convertExpression(a)),
            span: this.getSpan(expr),
          };
        }
      }

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
      if (expr.name.text === "value") {
        let inner: ts.Expression = expr.expression;
        if (ts.isParenthesizedExpression(inner)) {
          inner = inner.expression;
        }
        if (ts.isAsExpression(inner) && inner.type.kind === ts.SyntaxKind.AnyKeyword) {
          return {
            kind: "PostfixTryExpr",
            operand: this.convertExpression(inner.expression),
            span: this.getSpan(expr),
          };
        }
      }
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
        if (ts.isPropertyAssignment(p) && p.name) {
          let key: string;
          if (ts.isIdentifier(p.name)) {
            key = p.name.text;
          } else if (ts.isNumericLiteral(p.name)) {
            key = p.name.text;
          } else if (ts.isStringLiteral(p.name) || ts.isNoSubstitutionTemplateLiteral(p.name)) {
            key = p.name.text;
          } else if (ts.isComputedPropertyName(p.name)) {
            if (
              ts.isNumericLiteral(p.name.expression) ||
              ts.isStringLiteral(p.name.expression) ||
              ts.isNoSubstitutionTemplateLiteral(p.name.expression)
            ) {
              key = p.name.expression.text;
            } else {
              key = p.name.getText(this.sourceFile);
            }
          } else {
            key = p.name.getText(this.sourceFile);
          }
          properties.push({
            key,
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
      return {
        kind: "UnaryExpr",
        operator: "...",
        operand: this.convertExpression(expr.expression),
        span: this.getSpan(expr),
      };
    }

    // JSX Element, Self-Closing Element, or Fragment -> Literal nil
    if (
      ts.isJsxElement(expr) ||
      ts.isJsxSelfClosingElement(expr) ||
      ts.isJsxFragment(expr)
    ) {
      return {
        kind: "LiteralExpr",
        literalKind: "nil",
        value: null,
        rawValue: "nil",
        span: this.getSpan(expr),
      };
    }

    // Arrow Function
    if (ts.isArrowFunction(expr)) {
      const params = expr.parameters.map((p) => ({
        name: p.name.getText(this.sourceFile),
        typeAnnotation: p.type ? this.convertTypeNode(p.type) : null,
        defaultValue: p.initializer ? this.convertExpression(p.initializer) : undefined,
        isOptional: p.questionToken ? true : undefined,
        span: this.getSpan(p),
      }));

      let body: Block | Expr;
      if (ts.isBlock(expr.body)) {
        this.inClosureDepth++;
        try {
          body = this.convertBlock(expr.body);
        } finally {
          this.inClosureDepth--;
        }
      } else {
        body = this.convertExpression(expr.body);
      }

      return {
        kind: "ClosureExpr",
        params,
        returnType: expr.type ? this.convertTypeNode(expr.type) : null,
        body,
        span: this.getSpan(expr),
      };
    }

    // Function Expression
    if (ts.isFunctionExpression(expr)) {
      const params = expr.parameters.map((p) => ({
        name: p.name.getText(this.sourceFile),
        typeAnnotation: p.type ? this.convertTypeNode(p.type) : null,
        defaultValue: p.initializer ? this.convertExpression(p.initializer) : undefined,
        isOptional: p.questionToken ? true : undefined,
        span: this.getSpan(p),
      }));

      let body: Block;
      if (expr.body) {
        this.inClosureDepth++;
        try {
          body = this.convertBlock(expr.body);
        } finally {
          this.inClosureDepth--;
        }
      } else {
        body = { kind: "Block" as const, statements: [], span: this.getSpan(expr) };
      }

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
      case ts.SyntaxKind.AsteriskAsteriskToken:
        return "**";
      case ts.SyntaxKind.AmpersandToken:
        return "&";
      case ts.SyntaxKind.BarToken:
        return "|";
      case ts.SyntaxKind.CaretToken:
        return "^";
      case ts.SyntaxKind.LessThanLessThanToken:
        return "<<";
      case ts.SyntaxKind.GreaterThanGreaterThanToken:
        return ">>";
      case ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken:
        return ">>>";
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
      case ts.SyntaxKind.InKeyword:
        return "in";
      case ts.SyntaxKind.InstanceOfKeyword:
        return "instanceof";
      default:
        throw new Error(
          `Unsupported binary operator syntax kind: ${kind} (${ts.SyntaxKind[kind] ?? "unknown"})`,
        );
    }
  }

  private convertAssignOp(kind: ts.SyntaxKind): AssignOp | null {
    switch (kind) {
      case ts.SyntaxKind.EqualsToken:
        return "=";
      case ts.SyntaxKind.PlusEqualsToken:
        return "+=";
      case ts.SyntaxKind.MinusEqualsToken:
        return "-=";
      case ts.SyntaxKind.AsteriskEqualsToken:
        return "*=";
      case ts.SyntaxKind.SlashEqualsToken:
        return "/=";
      case ts.SyntaxKind.PercentEqualsToken:
        return "%=";
      case ts.SyntaxKind.BarEqualsToken:
        return "|=";
      case ts.SyntaxKind.CaretEqualsToken:
        return "^=";
      case ts.SyntaxKind.AmpersandEqualsToken:
        return "&=";
      case ts.SyntaxKind.LessThanLessThanEqualsToken:
        return "<<=";
      case ts.SyntaxKind.GreaterThanGreaterThanEqualsToken:
        return ">>=";
      case ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken:
        return ">>>=";
      case ts.SyntaxKind.AsteriskAsteriskEqualsToken:
        return "**=";
      default:
        return null;
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
      case ts.SyntaxKind.NullKeyword:
      case ts.SyntaxKind.UndefinedKeyword:
        return this.makePrimitive("nil", node);
      case ts.SyntaxKind.AnyKeyword:
      case ts.SyntaxKind.UnknownKeyword:
        return { kind: "NamedType", name: "unknown", span: this.getSpan(node) };
      case ts.SyntaxKind.LiteralType: {
        const litNode = node as ts.LiteralTypeNode;
        const lit = litNode.literal;
        if (ts.isStringLiteral(lit) || ts.isNoSubstitutionTemplateLiteral(lit)) {
          return {
            kind: "NamedType",
            name: JSON.stringify(lit.text),
            span: this.getSpan(node),
          };
        }
        if (ts.isNumericLiteral(lit)) {
          return {
            kind: "NamedType",
            name: lit.text,
            span: this.getSpan(node),
          };
        }
        if (ts.isPrefixUnaryExpression(lit)) {
          if (lit.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(lit.operand)) {
            return {
              kind: "NamedType",
              name: `-${lit.operand.text}`,
              span: this.getSpan(node),
            };
          }
          if (lit.operator === ts.SyntaxKind.PlusToken && ts.isNumericLiteral(lit.operand)) {
            return {
              kind: "NamedType",
              name: lit.operand.text,
              span: this.getSpan(node),
            };
          }
          return {
            kind: "NamedType",
            name: lit.getText(this.sourceFile),
            span: this.getSpan(node),
          };
        }
        if (lit.kind === ts.SyntaxKind.TrueKeyword) {
          return {
            kind: "NamedType",
            name: "true",
            span: this.getSpan(node),
          };
        }
        if (lit.kind === ts.SyntaxKind.FalseKeyword) {
          return {
            kind: "NamedType",
            name: "false",
            span: this.getSpan(node),
          };
        }
        if (lit.kind === ts.SyntaxKind.NullKeyword) {
          return {
            kind: "PrimitiveType",
            primitive: "nil",
            span: this.getSpan(node),
          };
        }
        return {
          kind: "NamedType",
          name: lit.getText(this.sourceFile),
          span: this.getSpan(node),
        };
      }
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
      case ts.SyntaxKind.TupleType: {
        const tuple = node as ts.TupleTypeNode;
        return {
          kind: "TupleType",
          elementTypes: tuple.elements.map((el) => {
            if (ts.isNamedTupleMember(el)) {
              return this.convertTypeNode(el.type);
            }
            return this.convertTypeNode(el);
          }),
          span: this.getSpan(node),
        };
      }
      case ts.SyntaxKind.UnionType: {
        const union = node as ts.UnionTypeNode;
        if (union.types.length === 2) {
          const resType = this.tryExtractResultType(union.types[0], union.types[1], node);
          if (resType) return resType;
        }
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
          if (converted.kind === "RecordType") {
            const fields = converted.fields
              .map((f) => `${f.name}${f.isOptional ? "?" : ""}: ${this.typeExprToAilText(f.type)}`)
              .join(", ");
            return `{ ${fields} }`;
          }
          return "unknown";
        });
        if (typeTexts.some((t) => t.includes("&") || t.includes("\n"))) {
          return { kind: "NamedType", name: "unknown", span: this.getSpan(node) };
        }
        return { kind: "NamedType", name: typeTexts.join(" | "), span: this.getSpan(node) };
      }
      case ts.SyntaxKind.IntersectionType:
      case ts.SyntaxKind.TypeQuery:
        return { kind: "NamedType", name: "unknown", span: this.getSpan(node) };
      case ts.SyntaxKind.TypeLiteral: {
        const typeLiteral = node as ts.TypeLiteralNode;
        const fields: { name: string; type: TypeExpr; isOptional?: boolean; span: Span }[] = [];
        for (const member of typeLiteral.members) {
          if (ts.isPropertySignature(member) && member.name) {
            const name = member.name.getText(this.sourceFile);
            const type = member.type
              ? this.convertTypeNode(member.type)
              : { kind: "PrimitiveType" as const, primitive: "any", span: this.getSpan(member) };
            const isOptional = !!member.questionToken;
            fields.push({
              name,
              type,
              isOptional: isOptional || undefined,
              span: this.getSpan(member),
            });
          }
        }
        if (fields.length > 0) {
          return { kind: "RecordType", fields, span: this.getSpan(node) };
        }
        return { kind: "NamedType", name: "any", span: this.getSpan(node) };
      }
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

  private tryExtractResultType(t0: ts.TypeNode, t1: ts.TypeNode, node: ts.Node): TypeExpr | null {
    if (!ts.isTypeLiteralNode(t0) || !ts.isTypeLiteralNode(t1)) return null;

    const inspect = (tl: ts.TypeLiteralNode) => {
      let isOk: boolean | null = null;
      let valNode: ts.TypeNode | null = null;
      for (const m of tl.members) {
        if (ts.isPropertySignature(m) && m.name && ts.isIdentifier(m.name)) {
          if (m.name.text === "ok" && m.type && ts.isLiteralTypeNode(m.type)) {
            if (m.type.literal.kind === ts.SyntaxKind.TrueKeyword) isOk = true;
            if (m.type.literal.kind === ts.SyntaxKind.FalseKeyword) isOk = false;
          }
          if (m.name.text === "value" && m.type) valNode = m.type;
          if (m.name.text === "error" && m.type) valNode = m.type;
        }
      }
      return { isOk, valNode };
    };

    const r0 = inspect(t0);
    const r1 = inspect(t1);
    if (r0.isOk === true && r1.isOk === false && r0.valNode && r1.valNode) {
      return {
        kind: "ResultType",
        okType: this.convertTypeNode(r0.valNode),
        errType: this.convertTypeNode(r1.valNode),
        span: this.getSpan(node),
      };
    }
    if (r0.isOk === false && r1.isOk === true && r0.valNode && r1.valNode) {
      return {
        kind: "ResultType",
        okType: this.convertTypeNode(r1.valNode),
        errType: this.convertTypeNode(r0.valNode),
        span: this.getSpan(node),
      };
    }
    return null;
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

  private typeExprToAilText(t: TypeExpr): string {
    switch (t.kind) {
      case "PrimitiveType":
        return t.primitive;
      case "NamedType":
        return t.name;
      case "ArrayType":
        return `[${this.typeExprToAilText(t.elementType)}]`;
      case "TupleType":
        return `[${t.elementTypes.map((e) => this.typeExprToAilText(e)).join(", ")}]`;
      case "OptionType":
        return `${this.typeExprToAilText(t.innerType)}?`;
      case "ResultType":
        return `Result[${this.typeExprToAilText(t.okType)}, ${this.typeExprToAilText(t.errType)}]`;
      case "RecordType": {
        const fields = t.fields
          .map((f) => `${f.name}${f.isOptional ? "?" : ""}: ${this.typeExprToAilText(f.type)}`)
          .join(", ");
        return `{ ${fields} }`;
      }
      default:
        return "any";
    }
  }
}
