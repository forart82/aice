/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Modern C# Decompiler (Reverse Transpiler) for AIL 2.0.
 * Parses C# source files (.cs), extracts comments and XML documentation into
 * CstTriviaTable, and produces an AIL Module AST.
 */

import type {
  ArrayLiteralExpr,
  AssignOp,
  AssignStmt,
  BinaryExpr,
  BinaryOp,
  Block,
  BreakStmt,
  CallExpr,
  ClassDecl,
  ConstDecl,
  ContinueStmt,
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
  MemberAccessExpr,
  MethodDecl,
  Module,
  ModuleItem,
  ParamDecl,
  PropertyDecl,
  ReturnStmt,
  Statement,
  TypeDecl,
  TypeExpr,
  UnaryExpr,
  VarDecl,
  WhileStmt,
} from "../core/ast.js";
import { emptySpan, type Span } from "../core/span.js";
import { CstTriviaTable, type TriviaItem, type TriviaKind } from "../core/trivia.js";

export class CSharpDecompiler {
  private source: string;
  private filePath: string;
  private trivia = new CstTriviaTable();

  constructor(source: string, filePath = "source.cs") {
    this.source = source;
    this.filePath = filePath;
  }

  decompile(): { ast: Module; trivia: CstTriviaTable } {
    const items: ModuleItem[] = [];
    const baseName =
      this.filePath
        .split(/[/\\]/)
        .pop()
        ?.replace(/\.cs(\.ail)?$/, "")
        .replace(/\.ail$/, "") ?? "source";

    let namespaceName: string | null = null;

    const lines = this.source.split("\n");
    let currentTrivia: TriviaItem[] = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();

      // Skip blank lines
      if (!trimmed) {
        i++;
        continue;
      }

      // XML Doc comments (/// ...)
      if (trimmed.startsWith("///")) {
        const docText = trimmed.replace(/^\/\/\/\s*/, "");
        currentTrivia.push({
          kind: "DOCSTRING",
          content: docText,
        });
        i++;
        continue;
      }

      // Line comments (// ...)
      if (trimmed.startsWith("//")) {
        currentTrivia.push({
          kind: "LINE_COMMENT",
          content: trimmed,
        });
        i++;
        continue;
      }

      // Block comments (/* ... */)
      if (trimmed.startsWith("/*")) {
        let blockComment = trimmed;
        while (!blockComment.includes("*/") && i + 1 < lines.length) {
          i++;
          blockComment += "\n" + lines[i];
        }
        currentTrivia.push({
          kind: "BLOCK_COMMENT",
          content: blockComment,
        });
        i++;
        continue;
      }

      // using Directive
      const usingMatch = trimmed.match(/^using\s+([a-zA-Z0-9_.]+)\s*;/);
      if (usingMatch) {
        const importSrc = usingMatch[1];
        const importDecl: ImportDecl = {
          kind: "ImportDecl",
          source: importSrc,
          specifiers: [],
          span: emptySpan(this.filePath),
        };
        const nodeId = `import:${importSrc}`;
        this.attachTrivia(nodeId, currentTrivia);
        currentTrivia = [];
        items.push(importDecl);
        i++;
        continue;
      }

      // namespace declaration: file-scoped or block
      const nsMatch = trimmed.match(/^namespace\s+([a-zA-Z0-9_.]+)\s*[;{]?/);
      if (nsMatch) {
        namespaceName = nsMatch[1];
        i++;
        continue;
      }

      // enum declaration
      const enumMatch = trimmed.match(
        /^(?:public|internal|private)?\s*enum\s+([a-zA-Z0-9_]+)\s*\{?/,
      );
      if (enumMatch) {
        const enumName = enumMatch[1];
        const enumNodeId = `type:${enumName}`;
        this.attachTrivia(enumNodeId, currentTrivia);
        currentTrivia = [];

        let enumBody = trimmed.includes("{") ? trimmed.slice(trimmed.indexOf("{") + 1) : "";
        while (!enumBody.includes("}") && i + 1 < lines.length) {
          i++;
          enumBody += " " + lines[i];
        }
        enumBody = enumBody.replace(/\};?.*$/, "").trim();

        const variants = enumBody
          .split(",")
          .map((v) => v.trim())
          .filter((v) => v.length > 0 && !v.startsWith("//"))
          .map((v) => {
            const varName = v.split("=")[0].trim();
            return {
              name: varName,
              span: emptySpan(this.filePath),
            };
          });

        items.push({
          kind: "TypeDecl",
          isEnum: true,
          name: enumName,
          typeParams: [],
          variants,
          span: emptySpan(this.filePath),
        });
        i++;
        continue;
      }

      // struct declaration
      const structMatch = trimmed.match(
        /^(?:public|internal|private)?\s*(?:readonly)?\s*struct\s+([a-zA-Z0-9_]+)\s*\{?/,
      );
      if (structMatch) {
        const structName = structMatch[1];
        const structNodeId = `type:${structName}`;
        this.attachTrivia(structNodeId, currentTrivia);
        currentTrivia = [];

        const structLines: string[] = [];
        let braceCount = trimmed.includes("{") ? 1 : 0;
        let lineIdx = i;

        if (trimmed.includes("{")) {
          structLines.push(trimmed.slice(trimmed.indexOf("{") + 1));
        }

        while (braceCount > 0 || (lineIdx === i && !trimmed.includes("{"))) {
          lineIdx++;
          if (lineIdx >= lines.length) break;
          const l = lines[lineIdx];
          for (const char of l) {
            if (char === "{") braceCount++;
            if (char === "}") braceCount--;
          }
          if (braceCount > 0) {
            structLines.push(l);
          } else {
            structLines.push(l.slice(0, l.lastIndexOf("}")));
            break;
          }
        }
        i = lineIdx + 1;

        const fields = this.parseStructFields(structLines);
        items.push({
          kind: "TypeDecl",
          isEnum: false,
          name: structName,
          typeParams: [],
          fields,
          span: emptySpan(this.filePath),
        });
        continue;
      }

      // class declaration: [public|internal] [sealed|static|partial|abstract]* class ClassName [: Heritage]
      const classMatch = trimmed.match(
        /^(?:public|internal|private)?\s*(?:sealed|static|partial|abstract|\s)*\s*class\s+([a-zA-Z0-9_]+)(?:\s*:\s*([^{]+))?\s*\{?/,
      );
      if (classMatch) {
        const className = classMatch[1];
        const heritage = classMatch[2]?.trim();
        const baseClass = heritage ? heritage.split(",")[0].trim() : undefined;
        const implementsList =
          heritage && heritage.includes(",")
            ? heritage
                .split(",")
                .slice(1)
                .map((s) => s.trim())
            : undefined;

        const classNodeId = `class:${className}`;
        this.attachTrivia(classNodeId, currentTrivia);
        currentTrivia = [];

        const classLines: string[] = [];
        let braceCount = trimmed.includes("{") ? 1 : 0;
        let lineIdx = i;

        if (trimmed.includes("{")) {
          classLines.push(trimmed.slice(trimmed.indexOf("{") + 1));
        }

        while (braceCount > 0 || (lineIdx === i && !trimmed.includes("{"))) {
          lineIdx++;
          if (lineIdx >= lines.length) break;
          const l = lines[lineIdx];
          for (const char of l) {
            if (char === "{") braceCount++;
            if (char === "}") braceCount--;
          }
          if (braceCount > 0) {
            classLines.push(l);
          } else {
            classLines.push(l.slice(0, l.lastIndexOf("}")));
            break;
          }
        }
        i = lineIdx + 1;

        const parsedClass = this.parseClassMembers(
          className,
          baseClass,
          implementsList,
          classLines,
        );
        items.push(parsedClass);
        continue;
      }

      i++;
    }

    const modPath = namespaceName ? `${namespaceName}.${baseName}` : baseName;

    return {
      ast: {
        kind: "Module",
        path: modPath,
        items,
        span: emptySpan(this.filePath),
      },
      trivia: this.trivia,
    };
  }

  private attachTrivia(nodeId: string, triviaItems: TriviaItem[]): void {
    for (const item of triviaItems) {
      this.trivia.addLeadingTrivia(nodeId, item);
    }
  }

  private parseStructFields(lines: string[]): FieldDecl[] {
    const fields: FieldDecl[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (
        !trimmed ||
        trimmed.startsWith("//") ||
        trimmed.startsWith("/*") ||
        trimmed.includes("(")
      ) {
        continue;
      }
      const match = trimmed.match(
        /^(?:public|private|internal)?\s*([a-zA-Z0-9_<>?[\]]+)\s+([a-zA-Z0-9_]+)\s*(?:=\s*(.+?))?;/,
      );
      if (match) {
        const typeStr = match[1];
        const fieldName = match[2];
        fields.push({
          name: fieldName,
          typeAnnotation: this.parseCSharpType(typeStr),
          span: emptySpan(this.filePath),
        });
      }
    }
    return fields;
  }

  private parseClassMembers(
    className: string,
    baseClass: string | undefined,
    implementsList: string[] | undefined,
    lines: string[],
  ): ClassDecl {
    const properties: PropertyDecl[] = [];
    const methods: MethodDecl[] = [];
    let primaryConstructor: ParamDecl[] | undefined;

    let memberTrivia: TriviaItem[] = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();

      if (!trimmed) {
        i++;
        continue;
      }

      if (trimmed.startsWith("///")) {
        memberTrivia.push({
          kind: "DOCSTRING",
          content: trimmed.replace(/^\/\/\/\s*/, ""),
        });
        i++;
        continue;
      }

      if (trimmed.startsWith("//")) {
        memberTrivia.push({
          kind: "LINE_COMMENT",
          content: trimmed,
        });
        i++;
        continue;
      }

      // Constructor: public ClassName(params) [{ body }]
      const ctorMatch = trimmed.match(
        new RegExp(`^(?:public|internal|private)?\\s*${className}\\s*\\(([^)]*)\\)`),
      );
      if (ctorMatch) {
        const paramsRaw = ctorMatch[1];
        const ctorParams = this.parseCSharpParams(paramsRaw);

        let bodyStatements: Statement[] = [];
        if (trimmed.includes("{")) {
          const bodyLines: string[] = [];
          let braceCount = 1;
          bodyLines.push(trimmed.slice(trimmed.indexOf("{") + 1));
          let lineIdx = i;

          while (braceCount > 0 && lineIdx + 1 < lines.length) {
            lineIdx++;
            const l = lines[lineIdx];
            for (const char of l) {
              if (char === "{") braceCount++;
              if (char === "}") braceCount--;
            }
            if (braceCount > 0) {
              bodyLines.push(l);
            } else {
              bodyLines.push(l.slice(0, l.lastIndexOf("}")));
              break;
            }
          }
          i = lineIdx + 1;
          bodyStatements = this.parseCSharpBlock(bodyLines);
        } else {
          i++;
        }

        const nodeId = `method:${className}.constructor`;
        this.attachTrivia(nodeId, memberTrivia);
        memberTrivia = [];

        methods.push({
          kind: "MethodDecl",
          name: "constructor",
          isStatic: false,
          isAsync: false,
          isExpressionBodied: false,
          typeParams: [],
          params: ctorParams,
          returnType: null,
          body: {
            kind: "Block",
            statements: bodyStatements,
            span: emptySpan(this.filePath),
          },
          span: emptySpan(this.filePath),
        });
        continue;
      }

      // Expression-bodied Method: public static bool Num(double v) => expr;
      const exprMethodMatch = trimmed.match(
        /^(?:public|internal|private)?\s*(?:static|async|virtual|override|sealed|\s)*\s*([a-zA-Z0-9_<>?[\]]+)\s+([a-zA-Z0-9_]+)\s*\(([^)]*)\)\s*=>\s*(.+?);/,
      );
      if (exprMethodMatch) {
        const retTypeStr = exprMethodMatch[1];
        const methodName = exprMethodMatch[2];
        const paramsRaw = exprMethodMatch[3];
        const exprBody = exprMethodMatch[4];
        const isStaticMethod = trimmed.includes("static");

        const nodeId = `method:${className}.${methodName}`;
        this.attachTrivia(nodeId, memberTrivia);
        memberTrivia = [];

        methods.push({
          kind: "MethodDecl",
          name: methodName,
          isStatic: isStaticMethod,
          isAsync: false,
          isExpressionBodied: true,
          typeParams: [],
          params: this.parseCSharpParams(paramsRaw),
          returnType: this.parseCSharpType(retTypeStr),
          body: {
            kind: "Block",
            statements: [
              {
                kind: "ReturnStmt",
                value: this.parseCSharpExpr(exprBody),
                span: emptySpan(this.filePath),
              },
            ],
            span: emptySpan(this.filePath),
          },
          span: emptySpan(this.filePath),
        });
        i++;
        continue;
      }

      // Block-bodied Method: public ReturnType MethodName(params) { body }
      const methodMatch = trimmed.match(
        /^(?:public|internal|private)?\s*(?:static|async|virtual|override|sealed|\s)*\s*([a-zA-Z0-9_<>?[\]]+)\s+([a-zA-Z0-9_]+)\s*\(([^)]*)\)/,
      );
      if (methodMatch && !trimmed.startsWith("return") && !trimmed.startsWith("if")) {
        const retTypeStr = methodMatch[1];
        const methodName = methodMatch[2];
        const paramsRaw = methodMatch[3];

        let bodyStatements: Statement[] = [];
        if (trimmed.includes("{")) {
          const bodyLines: string[] = [];
          let braceCount = 1;
          bodyLines.push(trimmed.slice(trimmed.indexOf("{") + 1));
          let lineIdx = i;

          while (braceCount > 0 && lineIdx + 1 < lines.length) {
            lineIdx++;
            const l = lines[lineIdx];
            for (const char of l) {
              if (char === "{") braceCount++;
              if (char === "}") braceCount--;
            }
            if (braceCount > 0) {
              bodyLines.push(l);
            } else {
              bodyLines.push(l.slice(0, l.lastIndexOf("}")));
              break;
            }
          }
          i = lineIdx + 1;
          bodyStatements = this.parseCSharpBlock(bodyLines);
        } else {
          i++;
        }

        const nodeId = `method:${className}.${methodName}`;
        this.attachTrivia(nodeId, memberTrivia);
        memberTrivia = [];

        const isStaticMethod = trimmed.includes("static");

        methods.push({
          kind: "MethodDecl",
          name: methodName,
          isStatic: isStaticMethod,
          isAsync: false,
          isExpressionBodied: false,
          typeParams: [],
          params: this.parseCSharpParams(paramsRaw),
          returnType: this.parseCSharpType(retTypeStr),
          body: {
            kind: "Block",
            statements: bodyStatements,
            span: emptySpan(this.filePath),
          },
          span: emptySpan(this.filePath),
        });
        continue;
      }

      // Constant: public const double Eps = 0.0001;
      const constMatch = trimmed.match(
        /^(?:public|internal|private)?\s*const\s+([a-zA-Z0-9_<>?[\]]+)\s+([a-zA-Z0-9_]+)\s*=\s*(.+?);/,
      );
      if (constMatch) {
        const typeStr = constMatch[1];
        const propName = constMatch[2];
        const initValStr = constMatch[3];

        const nodeId = `field:${className}.${propName}`;
        this.attachTrivia(nodeId, memberTrivia);
        memberTrivia = [];

        properties.push({
          kind: "PropertyDecl",
          name: propName,
          typeAnnotation: this.parseCSharpType(typeStr),
          initialValue: this.parseCSharpExpr(initValStr),
          isReadonly: true,
          isStatic: true,
          span: emptySpan(this.filePath),
        });
        i++;
        continue;
      }

      // Property or Field:
      // public double X;
      // public string Type { get; set; }
      // public int Count => items.Count;
      const propMatch = trimmed.match(
        /^(?:public|internal|private)?\s*(?:static|readonly|\s)*\s*([a-zA-Z0-9_<>?[\]]+)\s+([a-zA-Z0-9_]+)\s*(\{[^}]*\}|=>\s*.+?;|=(.+?);|;)/,
      );
      if (propMatch && !trimmed.includes("(")) {
        const typeStr = propMatch[1];
        const propName = propMatch[2];
        const tail = propMatch[3];
        const isStaticProp = trimmed.includes("static");
        const isReadonlyProp = trimmed.includes("readonly") || tail.startsWith("=>");
        let initVal: Expr | undefined;

        if (tail.startsWith("=>")) {
          const bodyStr = tail
            .replace(/^=>\s*/, "")
            .replace(/;$/, "")
            .trim();
          initVal = this.parseCSharpExpr(bodyStr);
        } else if (tail.startsWith("=")) {
          const bodyStr = tail.replace(/^=\s*/, "").replace(/;$/, "").trim();
          initVal = this.parseCSharpExpr(bodyStr);
        }

        const nodeId = `field:${className}.${propName}`;
        this.attachTrivia(nodeId, memberTrivia);
        memberTrivia = [];

        properties.push({
          kind: "PropertyDecl",
          name: propName,
          isStatic: isStaticProp,
          isReadonly: isReadonlyProp,
          typeAnnotation: this.parseCSharpType(typeStr),
          initialValue: initVal,
          span: emptySpan(this.filePath),
        });
        i++;
        continue;
      }

      i++;
    }

    return {
      kind: "ClassDecl",
      name: className,
      isExported: true,
      typeParams: [],
      extends: baseClass,
      implements: implementsList,
      primaryConstructor,
      properties,
      methods,
      span: emptySpan(this.filePath),
    };
  }

  private parseCSharpParams(paramsRaw: string): ParamDecl[] {
    if (!paramsRaw.trim()) return [];
    return paramsRaw
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p.length > 0)
      .map((p) => {
        const parts = p.split(/\s+/);
        let paramName = parts.pop() || "arg";
        let defVal: Expr | undefined;

        if (paramName.includes("=")) {
          const eqParts = paramName.split("=");
          paramName = eqParts[0].trim();
          defVal = this.parseCSharpExpr(eqParts[1].trim());
        }

        const typeStr = parts.join(" ");
        return {
          name: paramName,
          typeAnnotation: this.parseCSharpType(typeStr),
          defaultValue: defVal,
          span: emptySpan(this.filePath),
        };
      });
  }

  private parseCSharpBlock(lines: string[]): Statement[] {
    const statements: Statement[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (
        !trimmed ||
        trimmed.startsWith("//") ||
        trimmed.startsWith("/*") ||
        trimmed === "{" ||
        trimmed === "}"
      ) {
        continue;
      }

      // return [expr];
      if (trimmed.startsWith("return")) {
        const exprStr = trimmed
          .replace(/^return\s*/, "")
          .replace(/;$/, "")
          .trim();
        statements.push({
          kind: "ReturnStmt",
          value: exprStr ? this.parseCSharpExpr(exprStr) : null,
          span: emptySpan(this.filePath),
        });
        continue;
      }

      // break;
      if (trimmed === "break;") {
        statements.push({
          kind: "BreakStmt",
          span: emptySpan(this.filePath),
        });
        continue;
      }

      // continue;
      if (trimmed === "continue;") {
        statements.push({
          kind: "ContinueStmt",
          span: emptySpan(this.filePath),
        });
        continue;
      }

      // if (cond) return val; or if (cond) { ... }
      const ifMatch = trimmed.match(/^if\s*\((.+?)\)\s*(.*)/);
      if (ifMatch) {
        const condStr = ifMatch[1];
        const rest = ifMatch[2].trim();
        const thenBranch: Block = {
          kind: "Block",
          statements: [],
          span: emptySpan(this.filePath),
        };

        if (rest.startsWith("return")) {
          const retStr = rest
            .replace(/^return\s*/, "")
            .replace(/;$/, "")
            .trim();
          thenBranch.statements.push({
            kind: "ReturnStmt",
            value: retStr ? this.parseCSharpExpr(retStr) : null,
            span: emptySpan(this.filePath),
          });
        }

        statements.push({
          kind: "IfStmt",
          condition: this.parseCSharpExpr(condStr),
          thenBranch,
          elifBranches: [],
          elseBranch: null,
          span: emptySpan(this.filePath),
        });
        continue;
      }

      // while (cond)
      const whileMatch = trimmed.match(/^while\s*\((.+?)\)/);
      if (whileMatch) {
        statements.push({
          kind: "WhileStmt",
          condition: this.parseCSharpExpr(whileMatch[1]),
          body: {
            kind: "Block",
            statements: [],
            span: emptySpan(this.filePath),
          },
          span: emptySpan(this.filePath),
        });
        continue;
      }

      // Variable declaration: Type name = expr; or var name = expr;
      const varDeclMatch = trimmed.match(
        /^(?:var|[a-zA-Z0-9_<>?[\]]+)\s+([a-zA-Z0-9_]+)\s*=\s*(.+?);/,
      );
      if (varDeclMatch && !trimmed.startsWith("this.") && !trimmed.startsWith("return")) {
        const varName = varDeclMatch[1];
        const valStr = varDeclMatch[2];
        statements.push({
          kind: "LetBinding",
          name: varName,
          typeAnnotation: null,
          init: this.parseCSharpExpr(valStr),
          isMut: true,
          span: emptySpan(this.filePath),
        });
        continue;
      }

      // Assignment: target = expr; or target += expr;
      const assignMatch = trimmed.match(/^([a-zA-Z0-9_.[\]]+)\s*(\+=|-=|\*=|\/=|%=|=)\s*(.+?);/);
      if (assignMatch) {
        const target = assignMatch[1];
        const op = assignMatch[2] === "=" ? undefined : assignMatch[2];
        const valStr = assignMatch[3];
        statements.push({
          kind: "AssignStmt",
          target: this.parseCSharpExpr(target),
          op: (op as AssignOp) ?? "=",
          value: this.parseCSharpExpr(valStr),
          span: emptySpan(this.filePath),
        });
        continue;
      }

      // Expression statement
      const cleanExpr = trimmed.replace(/;$/, "").trim();
      if (cleanExpr) {
        statements.push({
          kind: "ExprStmt",
          expr: this.parseCSharpExpr(cleanExpr),
          span: emptySpan(this.filePath),
        });
      }
    }

    return statements;
  }

  private parseCSharpExpr(exprStr: string): Expr {
    const s = exprStr.trim();

    // String literal
    if (s.startsWith('"') && s.endsWith('"')) {
      return {
        kind: "LiteralExpr",
        literalKind: "string",
        value: s.slice(1, -1),
        rawValue: s,
        span: emptySpan(this.filePath),
      };
    }

    // Number literal
    if (/^-?[0-9]+(\.[0-9]+)?f?$/.test(s)) {
      return {
        kind: "LiteralExpr",
        literalKind: "number",
        value: Number.parseFloat(s.replace(/f$/, "")),
        rawValue: s,
        span: emptySpan(this.filePath),
      };
    }

    // Boolean literal
    if (s === "true" || s === "false") {
      return {
        kind: "LiteralExpr",
        literalKind: "boolean",
        value: s === "true",
        rawValue: s,
        span: emptySpan(this.filePath),
      };
    }

    // null
    if (s === "null") {
      return {
        kind: "LiteralExpr",
        literalKind: "nil",
        value: null,
        rawValue: "nil",
        span: emptySpan(this.filePath),
      };
    }

    // Binary expressions
    for (const op of [
      "||",
      "&&",
      "==",
      "!=",
      "<=",
      ">=",
      "<",
      ">",
      "+",
      "-",
      "*",
      "/",
      "%",
      "??",
    ]) {
      const idx = this.findOperatorIndex(s, op);
      if (idx > 0) {
        const left = s.slice(0, idx).trim();
        const right = s.slice(idx + op.length).trim();
        return {
          kind: "BinaryExpr",
          left: this.parseCSharpExpr(left),
          operator: (op === "&&" ? "and" : op === "||" ? "or" : op) as BinaryOp,
          right: this.parseCSharpExpr(right),
          span: emptySpan(this.filePath),
        };
      }
    }

    // Unary expression: !x or -x
    if (s.startsWith("!") && s.length > 1) {
      return {
        kind: "UnaryExpr",
        operator: "not",
        operand: this.parseCSharpExpr(s.slice(1)),
        span: emptySpan(this.filePath),
      };
    }

    // Call expression: name(args)
    const callMatch = s.match(/^([a-zA-Z0-9_.]+)\s*\((.*)\)$/);
    if (callMatch) {
      const calleeStr = callMatch[1];
      const argsRaw = callMatch[2];
      const args = this.splitArgs(argsRaw).map((a) => this.parseCSharpExpr(a));

      return {
        kind: "CallExpr",
        callee: this.parseCSharpExpr(calleeStr),
        args,
        span: emptySpan(this.filePath),
      };
    }

    // Member access: obj.prop
    const memberMatch = s.match(/^([a-zA-Z0-9_]+)\.([a-zA-Z0-9_]+)$/);
    if (memberMatch) {
      return {
        kind: "MemberAccessExpr",
        object: {
          kind: "IdentifierExpr",
          name: memberMatch[1],
          span: emptySpan(this.filePath),
        },
        property: memberMatch[2],
        isSafeNav: false,
        isOptional: false,
        span: emptySpan(this.filePath),
      };
    }

    // Array index: obj[idx]
    const indexMatch = s.match(/^([a-zA-Z0-9_.]+?)\[(.+)\]$/);
    if (indexMatch) {
      return {
        kind: "IndexExpr",
        object: this.parseCSharpExpr(indexMatch[1]),
        index: this.parseCSharpExpr(indexMatch[2]),
        span: emptySpan(this.filePath),
      };
    }

    // Identifier fallback
    return {
      kind: "IdentifierExpr",
      name: s.replace(/^this\./, ""),
      span: emptySpan(this.filePath),
    };
  }

  private findOperatorIndex(expr: string, op: string): number {
    let parenDepth = 0;
    for (let i = expr.length - op.length; i >= 0; i--) {
      const char = expr[i];
      if (char === ")") parenDepth++;
      if (char === "(") parenDepth--;

      if (parenDepth === 0 && expr.slice(i, i + op.length) === op) {
        return i;
      }
    }
    return -1;
  }

  private splitArgs(argsStr: string): string[] {
    const args: string[] = [];
    let cur = "";
    let parenDepth = 0;

    for (let i = 0; i < argsStr.length; i++) {
      const c = argsStr[i];
      if (c === "(" || c === "{" || c === "[") parenDepth++;
      if (c === ")" || c === "}" || c === "]") parenDepth--;

      if (c === "," && parenDepth === 0) {
        if (cur.trim()) args.push(cur.trim());
        cur = "";
      } else {
        cur += c;
      }
    }
    if (cur.trim()) args.push(cur.trim());
    return args;
  }

  parseCSharpType(typeStr: string): TypeExpr {
    const clean = typeStr
      .replace(/^readonly\s+/, "")
      .replace(/^const\s+/, "")
      .replace(/^static\s+/, "")
      .trim();

    if (
      clean === "int" ||
      clean === "uint" ||
      clean === "long" ||
      clean === "ulong" ||
      clean === "short" ||
      clean === "ushort" ||
      clean === "nint" ||
      clean === "nuint"
    ) {
      return { kind: "PrimitiveType", primitive: "int", span: emptySpan(this.filePath) };
    }

    if (clean === "float") {
      return { kind: "PrimitiveType", primitive: "float", span: emptySpan(this.filePath) };
    }

    if (clean === "double" || clean === "decimal") {
      return { kind: "PrimitiveType", primitive: "num", span: emptySpan(this.filePath) };
    }

    if (clean === "bool") {
      return { kind: "PrimitiveType", primitive: "bool", span: emptySpan(this.filePath) };
    }

    if (clean === "string") {
      return { kind: "PrimitiveType", primitive: "str", span: emptySpan(this.filePath) };
    }

    if (clean === "char") {
      return { kind: "PrimitiveType", primitive: "char", span: emptySpan(this.filePath) };
    }

    if (clean === "byte" || clean === "sbyte") {
      return { kind: "PrimitiveType", primitive: "byte", span: emptySpan(this.filePath) };
    }

    if (clean === "void") {
      return { kind: "PrimitiveType", primitive: "void", span: emptySpan(this.filePath) };
    }

    // List<T>, IList<T>, IEnumerable<T>, T[]
    if (clean.endsWith("[]")) {
      const elemType = clean.slice(0, -2);
      return {
        kind: "ArrayType",
        elementType: this.parseCSharpType(elemType),
        span: emptySpan(this.filePath),
      };
    }

    const listMatch = clean.match(/^(?:List|IList|IEnumerable|IReadOnlyList)<(.+)>$/);
    if (listMatch) {
      return {
        kind: "ArrayType",
        elementType: this.parseCSharpType(listMatch[1]),
        span: emptySpan(this.filePath),
      };
    }

    // Nullable<T> or T?
    if (clean.endsWith("?")) {
      const inner = clean.slice(0, -1);
      return {
        kind: "OptionType",
        innerType: this.parseCSharpType(inner),
        span: emptySpan(this.filePath),
      };
    }

    const nullableMatch = clean.match(/^Nullable<(.+)>$/);
    if (nullableMatch) {
      return {
        kind: "OptionType",
        innerType: this.parseCSharpType(nullableMatch[1]),
        span: emptySpan(this.filePath),
      };
    }

    return {
      kind: "NamedType",
      name: clean,
      typeArgs: [],
      span: emptySpan(this.filePath),
    };
  }
}
