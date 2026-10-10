/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Modern C++20 Decompiler (Reverse Transpiler) for AIL 2.0.
 * Parses C++ headers and source files (.cpp, .hpp, .cc, .cxx, .h),
 * extracts comments into CstTriviaTable, and produces an AIL Module AST.
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

export class CppDecompiler {
  private source: string;
  private filePath: string;
  private trivia = new CstTriviaTable();

  constructor(source: string, filePath = "source.cpp") {
    this.source = source;
    this.filePath = filePath;
  }

  decompile(): { ast: Module; trivia: CstTriviaTable } {
    const items: ModuleItem[] = [];
    const baseName =
      this.filePath
        .split(/[/\\]/)
        .pop()
        ?.replace(/\.(cpp|hpp|cc|cxx|h)(\.ail)?$/, "")
        .replace(/\.ail$/, "") ?? "source";

    let namespaceName: string | null = null;

    // Scan line-by-line / tokenizing
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

      // Collect line comments
      if (trimmed.startsWith("//")) {
        currentTrivia.push({
          kind: "LINE_COMMENT",
          content: trimmed,
        });
        i++;
        continue;
      }

      // Collect block comments
      if (trimmed.startsWith("/*")) {
        let blockComment = trimmed;
        while (!blockComment.includes("*/") && i + 1 < lines.length) {
          i++;
          blockComment += "\n" + lines[i];
        }
        currentTrivia.push({
          kind: blockComment.startsWith("/**") ? "DOCSTRING" : "BLOCK_COMMENT",
          content: blockComment,
        });
        i++;
        continue;
      }

      // #pragma once
      if (trimmed.startsWith("#pragma")) {
        i++;
        continue;
      }

      // #include <...> or #include "..."
      const includeMatch = trimmed.match(/^#include\s+["<]([^">]+)[">]/);
      if (includeMatch) {
        const importSrc = includeMatch[1];
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

      // namespace name {
      const nsMatch = trimmed.match(/^namespace\s+([a-zA-Z0-9_:]+)\s*\{?/);
      if (nsMatch) {
        namespaceName = nsMatch[1];
        i++;
        continue;
      }

      // enum class Name or enum Name
      const enumMatch = trimmed.match(
        /^enum(\s+class)?\s+([a-zA-Z0-9_]+)\s*(:\s*[a-zA-Z0-9_]+)?\s*\{?/,
      );
      if (enumMatch) {
        const enumName = enumMatch[2];
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

      // struct Name { ... };
      const structMatch = trimmed.match(
        /^struct\s+([a-zA-Z0-9_]+)(\s*:\s*(public|private|protected)?\s*([a-zA-Z0-9_:]+))?\s*\{?/,
      );
      if (structMatch && !trimmed.endsWith(");") && !trimmed.includes("(")) {
        const structName = structMatch[1];
        const nodeId = `type:${structName}`;
        this.attachTrivia(nodeId, currentTrivia);
        currentTrivia = [];

        // Collect body lines until matching '};'
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

      // class Name : public Base { ... };
      const classMatch = trimmed.match(
        /^class\s+([a-zA-Z0-9_]+)(\s*:\s*(public|private|protected)?\s*([a-zA-Z0-9_:]+))?\s*\{?/,
      );
      if (classMatch && !trimmed.endsWith(");") && !trimmed.includes("(")) {
        const className = classMatch[1];
        const baseClass = classMatch[4] || undefined;
        const nodeId = `class:${className}`;
        this.attachTrivia(nodeId, currentTrivia);
        currentTrivia = [];

        // Collect class body
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

        const parsedClass = this.parseClassMembers(className, baseClass, classLines);
        items.push(parsedClass);
        continue;
      }

      // constexpr / const declarations
      const constMatch = trimmed.match(
        /^(constexpr|const)\s+([a-zA-Z0-9_:<>*&]+)\s+([a-zA-Z0-9_]+)\s*=\s*(.+?);/,
      );
      if (constMatch) {
        const typeStr = constMatch[2];
        const constName = constMatch[3];
        const valStr = constMatch[4];
        const nodeId = `const:${constName}`;
        this.attachTrivia(nodeId, currentTrivia);
        currentTrivia = [];

        items.push({
          kind: "ConstDecl",
          name: constName,
          isExported: true,
          typeAnnotation: this.parseCppType(typeStr),
          value: this.parseCppExpr(valStr),
          span: emptySpan(this.filePath),
        });
        i++;
        continue;
      }

      // Free function definition or declaration:
      // ReturnType [ClassName::]fnName(params) [{ body }]
      const fnHeaderMatch = trimmed.match(
        /^((?:virtual|inline|static|explicit)\s+)?([a-zA-Z0-9_:<>*&]+)\s+(([a-zA-Z0-9_:]+::)?([a-zA-Z0-9_]+))\s*\(([^)]*)\)\s*(const)?\s*(\{|;)?/,
      );

      if (fnHeaderMatch && !trimmed.startsWith("return") && !trimmed.startsWith("if")) {
        const retTypeStr = fnHeaderMatch[2];
        const fullName = fnHeaderMatch[3];
        const shortName = fnHeaderMatch[5];
        const paramsRaw = fnHeaderMatch[6];
        const hasOpenBrace = trimmed.includes("{");
        const isSemi = trimmed.endsWith(";");

        const nodeId = `fn:${shortName}`;
        this.attachTrivia(nodeId, currentTrivia);
        currentTrivia = [];

        const params = this.parseCppParams(paramsRaw);
        const returnType = this.parseCppType(retTypeStr);

        let bodyStatements: Statement[] = [];
        if (hasOpenBrace) {
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
          bodyStatements = this.parseCppBlock(bodyLines);
        } else {
          i++;
        }

        items.push({
          kind: "FunctionDecl",
          name: shortName,
          typeParams: [],
          params,
          returnType,
          isExpressionBodied: false,
          body: {
            kind: "Block",
            statements: bodyStatements,
            span: emptySpan(this.filePath),
          },
          span: emptySpan(this.filePath),
        });
        continue;
      }

      // Fallback
      i++;
    }

    const modPath = namespaceName ? `${namespaceName}::${baseName}` : baseName;

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
      const match = trimmed.match(/^([a-zA-Z0-9_:<>*&]+)\s+([a-zA-Z0-9_]+)(\s*\{[^}]*\})?\s*;/);
      if (match) {
        const typeStr = match[1];
        const fieldName = match[2];
        fields.push({
          name: fieldName,
          typeAnnotation: this.parseCppType(typeStr),
          span: emptySpan(this.filePath),
        });
      }
    }
    return fields;
  }

  private parseClassMembers(
    className: string,
    baseClass: string | undefined,
    lines: string[],
  ): ClassDecl {
    const properties: PropertyDecl[] = [];
    const methods: MethodDecl[] = [];
    const primaryConstructor: ParamDecl[] = [];

    let isPublic = false;
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("/*")) {
        i++;
        continue;
      }

      if (trimmed === "public:") {
        isPublic = true;
        i++;
        continue;
      }
      if (trimmed === "private:" || trimmed === "protected:") {
        isPublic = false;
        i++;
        continue;
      }

      // Constructor: ClassName(params)
      const ctorMatch = trimmed.match(new RegExp(`^${className}\\s*\\(([^)]*)\\)`));
      if (ctorMatch) {
        const paramsRaw = ctorMatch[1];
        const ctorParams = this.parseCppParams(paramsRaw);
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
            statements: [],
            span: emptySpan(this.filePath),
          },
          span: emptySpan(this.filePath),
        });
        i++;
        continue;
      }

      // Destructor: ~ClassName()
      if (trimmed.startsWith(`~${className}`)) {
        i++;
        continue;
      }

      // Method: ReturnType methodName(params) [const] [{ ... }] [;]
      const methodMatch = trimmed.match(
        /^((?:virtual|inline|static|explicit)\s+)?([a-zA-Z0-9_:<>*&]+)\s+([a-zA-Z0-9_]+)\s*\(([^)]*)\)\s*(const)?/,
      );
      if (methodMatch && !trimmed.startsWith("return") && !trimmed.startsWith("if")) {
        const retTypeStr = methodMatch[2];
        const methodName = methodMatch[3];
        const paramsRaw = methodMatch[4];
        const params = this.parseCppParams(paramsRaw);
        const returnType = this.parseCppType(retTypeStr);

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
          bodyStatements = this.parseCppBlock(bodyLines);
        } else {
          i++;
        }

        methods.push({
          kind: "MethodDecl",
          name: methodName,
          isStatic: false,
          isAsync: false,
          isExpressionBodied: false,
          typeParams: [],
          params,
          returnType,
          body: {
            kind: "Block",
            statements: bodyStatements,
            span: emptySpan(this.filePath),
          },
          span: emptySpan(this.filePath),
        });
        continue;
      }

      // Field / Property: Type name [= val];
      const fieldMatch = trimmed.match(
        /^([a-zA-Z0-9_:<>*&]+)\s+([a-zA-Z0-9_]+)(\s*=\s*(.+?))?\s*;/,
      );
      if (fieldMatch) {
        const typeStr = fieldMatch[1];
        const propName = fieldMatch[2];
        const initValStr = fieldMatch[4];
        properties.push({
          kind: "PropertyDecl",
          name: propName,
          isStatic: false,
          isReadonly: false,
          typeAnnotation: this.parseCppType(typeStr),
          initialValue: initValStr ? this.parseCppExpr(initValStr) : undefined,
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
      primaryConstructor: primaryConstructor.length > 0 ? primaryConstructor : undefined,
      properties,
      methods,
      span: emptySpan(this.filePath),
    };
  }

  private parseCppParams(paramsRaw: string): ParamDecl[] {
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
          defVal = this.parseCppExpr(eqParts[1].trim());
        }

        // Clean pointer / reference from param name
        if (paramName.startsWith("*") || paramName.startsWith("&")) {
          paramName = paramName.slice(1);
        }

        const typeStr = parts.join(" ");
        return {
          name: paramName,
          typeAnnotation: this.parseCppType(typeStr),
          defaultValue: defVal,
          span: emptySpan(this.filePath),
        };
      });
  }

  private parseCppBlock(lines: string[]): Statement[] {
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
          value: exprStr ? this.parseCppExpr(exprStr) : null,
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

      // if (cond) { ... } or if (cond) stmt;
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
            value: retStr ? this.parseCppExpr(retStr) : null,
            span: emptySpan(this.filePath),
          });
        }

        statements.push({
          kind: "IfStmt",
          condition: this.parseCppExpr(condStr),
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
          condition: this.parseCppExpr(whileMatch[1]),
          body: {
            kind: "Block",
            statements: [],
            span: emptySpan(this.filePath),
          },
          span: emptySpan(this.filePath),
        });
        continue;
      }

      // Variable declaration: [const] Type name = expr;
      const varDeclMatch = trimmed.match(
        /^((?:const|auto|float|int|double|bool|std::string|string)\s+)+([a-zA-Z0-9_]+)\s*=\s*(.+?);/,
      );
      if (varDeclMatch) {
        const varName = varDeclMatch[2];
        const valStr = varDeclMatch[3];
        statements.push({
          kind: "LetBinding",
          name: varName,
          typeAnnotation: null,
          init: this.parseCppExpr(valStr),
          isMut: !trimmed.startsWith("const"),
          span: emptySpan(this.filePath),
        });
        continue;
      }

      // Assignment: target = expr; or target += expr;
      const assignMatch = trimmed.match(/^([a-zA-Z0-9_.\->[\]]+)\s*(\+=|-=|\*=|\/=|%=|=)\s*(.+?);/);
      if (assignMatch) {
        const target = assignMatch[1];
        const op = assignMatch[2] === "=" ? undefined : assignMatch[2];
        const valStr = assignMatch[3];
        statements.push({
          kind: "AssignStmt",
          target: this.parseCppExpr(target),
          op: (op as AssignOp) ?? "=",
          value: this.parseCppExpr(valStr),
          span: emptySpan(this.filePath),
        });
        continue;
      }

      // Expression statement (e.g. function call or method call)
      const cleanExpr = trimmed.replace(/;$/, "").trim();
      if (cleanExpr) {
        statements.push({
          kind: "ExprStmt",
          expr: this.parseCppExpr(cleanExpr),
          span: emptySpan(this.filePath),
        });
      }
    }

    return statements;
  }

  private parseCppExpr(exprStr: string): Expr {
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

    // Nullptr / NULL
    if (s === "nullptr" || s === "NULL") {
      return {
        kind: "LiteralExpr",
        literalKind: "nil",
        value: null,
        rawValue: "nil",
        span: emptySpan(this.filePath),
      };
    }

    // Binary expressions (simple split by + - * / && || == != <= >= < >)
    for (const op of ["||", "&&", "==", "!=", "<=", ">=", "<", ">", "+", "-", "*", "/", "%"]) {
      // Find operator outside parentheses
      const idx = this.findOperatorIndex(s, op);
      if (idx > 0) {
        const left = s.slice(0, idx).trim();
        const right = s.slice(idx + op.length).trim();
        return {
          kind: "BinaryExpr",
          left: this.parseCppExpr(left),
          operator: (op === "&&" ? "and" : op === "||" ? "or" : op) as BinaryOp,
          right: this.parseCppExpr(right),
          span: emptySpan(this.filePath),
        };
      }
    }

    // Unary expression: !x or -x
    if (s.startsWith("!") && s.length > 1) {
      return {
        kind: "UnaryExpr",
        operator: "not",
        operand: this.parseCppExpr(s.slice(1)),
        span: emptySpan(this.filePath),
      };
    }

    // Call expression: name(args)
    const callMatch = s.match(/^([a-zA-Z0-9_.:\->]+)\s*\((.*)\)$/);
    if (callMatch) {
      const calleeStr = callMatch[1];
      const argsRaw = callMatch[2];
      const args = this.splitArgs(argsRaw).map((a) => this.parseCppExpr(a));

      return {
        kind: "CallExpr",
        callee: this.parseCppExpr(calleeStr),
        args,
        span: emptySpan(this.filePath),
      };
    }

    // Member access: obj.prop or obj->prop
    const memberMatch = s.match(/^([a-zA-Z0-9_]+)(\.|->)([a-zA-Z0-9_]+)$/);
    if (memberMatch) {
      return {
        kind: "MemberAccessExpr",
        object: {
          kind: "IdentifierExpr",
          name: memberMatch[1],
          span: emptySpan(this.filePath),
        },
        property: memberMatch[3],
        isSafeNav: false,
        isOptional: false,
        span: emptySpan(this.filePath),
      };
    }

    // Array index: obj[idx]
    const indexMatch = s.match(/^([a-zA-Z0-9_]+)\[(.+)\]$/);
    if (indexMatch) {
      return {
        kind: "IndexExpr",
        object: {
          kind: "IdentifierExpr",
          name: indexMatch[1],
          span: emptySpan(this.filePath),
        },
        index: this.parseCppExpr(indexMatch[2]),
        span: emptySpan(this.filePath),
      };
    }

    // Identifier fallback
    return {
      kind: "IdentifierExpr",
      name: s.replace(/^this->/, ""),
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
        // Disambiguate pointer / reference
        if (op === "*" || op === "&") {
          if (i === 0) continue;
        }
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

  parseCppType(typeStr: string): TypeExpr {
    const clean = typeStr
      .replace(/^const\s+/, "")
      .replace(/\s+const$/, "")
      .replace(/&/g, "")
      .replace(/\*/g, "")
      .replace(/^struct\s+/, "")
      .replace(/^class\s+/, "")
      .trim();

    if (
      clean === "int" ||
      clean === "int32_t" ||
      clean === "int64_t" ||
      clean === "uint32_t" ||
      clean === "uint64_t" ||
      clean === "std::uint64_t" ||
      clean === "size_t" ||
      clean === "short" ||
      clean === "unsigned int"
    ) {
      return { kind: "PrimitiveType", primitive: "int", span: emptySpan(this.filePath) };
    }

    if (clean === "float") {
      return { kind: "PrimitiveType", primitive: "float", span: emptySpan(this.filePath) };
    }

    if (clean === "double") {
      return { kind: "PrimitiveType", primitive: "num", span: emptySpan(this.filePath) };
    }

    if (clean === "bool") {
      return { kind: "PrimitiveType", primitive: "bool", span: emptySpan(this.filePath) };
    }

    if (clean === "void") {
      return { kind: "PrimitiveType", primitive: "void", span: emptySpan(this.filePath) };
    }

    if (clean === "std::string" || clean === "string" || clean === "char*") {
      return { kind: "PrimitiveType", primitive: "str", span: emptySpan(this.filePath) };
    }

    if (clean === "char" || clean === "uint8_t" || clean === "byte") {
      return { kind: "PrimitiveType", primitive: "byte", span: emptySpan(this.filePath) };
    }

    // std::vector<T>
    const vecMatch = clean.match(/^(?:std::)?vector<(.+)>$/);
    if (vecMatch) {
      return {
        kind: "ArrayType",
        elementType: this.parseCppType(vecMatch[1]),
        span: emptySpan(this.filePath),
      };
    }

    // std::optional<T>, std::unique_ptr<T>, std::shared_ptr<T>
    const optMatch = clean.match(/^(?:std::)?(optional|unique_ptr|shared_ptr)<(.+)>$/);
    if (optMatch) {
      return {
        kind: "OptionType",
        innerType: this.parseCppType(optMatch[2]),
        span: emptySpan(this.filePath),
      };
    }

    return {
      kind: "NamedType",
      name: clean.replace(/::/g, "."),
      typeArgs: [],
      span: emptySpan(this.filePath),
    };
  }
}
