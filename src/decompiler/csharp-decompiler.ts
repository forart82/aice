/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Modern C# Decompiler (Reverse Transpiler) for AICE 2.0.
 * Parses C# source files (.cs), extracts comments and XML documentation into
 * CstTriviaTable, and produces an AICE Module AST.
 */

import type {
  AssignOp,
  BinaryOp,
  Block,
  ClassDecl,
  Expr,
  FieldDecl,
  IfStmt,
  MethodDecl,
  Module,
  ModuleItem,
  ParamDecl,
  PropertyDecl,
  RecordProperty,
  Statement,
  TemplateLiteralExpr,
  TypeExpr,
} from "../core/ast.js";
import { emptySpan, type Span } from "../core/span.js";
import { CstTriviaTable, type TriviaItem } from "../core/trivia.js";

export class CSharpDecompiler {
  private trivia: CstTriviaTable;
  private filePath: string;
  private source: string;
  private inClosure = false;

  constructor(source: string, filePath = "source.cs") {
    this.source = source;
    this.filePath = filePath;
    this.trivia = new CstTriviaTable();
  }

  public decompile(): { ast: Module; trivia: CstTriviaTable } {
    const rawLines = this.source.split(/\r?\n/);
    const items: ModuleItem[] = [];

    const baseName = this.filePath
      .replace(/^.*[\\/]/, "")
      .replace(/\.cs$/i, "")
      .toLowerCase();

    let namespaceName = "";
    let currentTrivia: TriviaItem[] = [];
    let i = 0;

    while (i < rawLines.length) {
      const line = rawLines[i];

      // XML Doc comments (/// ...)
      if (line.trim().startsWith("///")) {
        currentTrivia.push({
          kind: "DOCSTRING",
          content: line.trim().replace(/^\/\/\/\s*/, ""),
        });
        i++;
        continue;
      }

      // Line comments (// ...)
      if (line.trim().startsWith("//")) {
        currentTrivia.push({
          kind: "LINE_COMMENT",
          content: line.trim(),
        });
        i++;
        continue;
      }

      // Block comments (/* ... */)
      if (line.trim().startsWith("/*")) {
        let blockComment = line.trim();
        while (!blockComment.includes("*/") && i + 1 < rawLines.length) {
          i++;
          blockComment += "\n" + rawLines[i];
        }
        currentTrivia.push({
          kind: "BLOCK_COMMENT",
          content: blockComment,
        });
        i++;
        continue;
      }

      const trimmed = this.stripLineComment(line).trim();

      if (!trimmed) {
        i++;
        continue;
      }

      // using Directive
      const usingMatch = trimmed.match(/^using\s+([a-zA-Z0-9_.]+)\s*;/);
      if (usingMatch) {
        const importPath = usingMatch[1];
        const importNodeId = `import:${importPath}`;
        this.attachTrivia(importNodeId, currentTrivia);
        currentTrivia = [];

        items.push({
          kind: "ImportDecl",
          source: importPath,
          specifiers: [],
          span: emptySpan(this.filePath),
        });
        i++;
        continue;
      }

      // namespace declaration: file-scoped or block
      const nsMatch = trimmed.match(/^namespace\s+([a-zA-Z0-9_.]+)\s*[;{]?/);
      if (nsMatch) {
        namespaceName = namespaceName ? `${namespaceName}.${nsMatch[1]}` : nsMatch[1];
        i++;
        continue;
      }

      if (trimmed === "}" || trimmed === "{") {
        i++;
        continue;
      }

      // enum declaration
      const enumMatch = trimmed.match(
        /^(?:public|internal|private)?\s*enum\s+([a-zA-Z0-9_]+)\s*(?::\s*[a-zA-Z0-9_]+)?\s*\{?/,
      );
      if (enumMatch) {
        const enumName = enumMatch[1];
        const enumNodeId = `type:${enumName}`;
        this.attachTrivia(enumNodeId, currentTrivia);
        currentTrivia = [];

        const { bodyLines, nextIdx } = this.collectBracedBlock(rawLines, i);
        i = nextIdx;

        const variants: { name: string; span: Span }[] = [];
        for (const bl of bodyLines) {
          this.extractEnumVariants(bl, variants);
        }

        items.push({
          kind: "TypeDecl",
          isEnum: true,
          name: enumName,
          typeParams: [],
          variants,
          span: emptySpan(this.filePath),
        });
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

        const { bodyLines, nextIdx } = this.collectBracedBlock(rawLines, i);
        i = nextIdx;

        const fields = this.parseStructFields(bodyLines);
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

        const { bodyLines, nextIdx } = this.collectBracedBlock(rawLines, i);
        i = nextIdx;

        const parsedClass = this.parseClassMembers(className, baseClass, implementsList, bodyLines);
        items.push(parsedClass);
        continue;
      }

      i++;
    }

    const modPath = namespaceName ? namespaceName : baseName;

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

  private stripLineComment(line: string): string {
    let inString = false;
    let quoteChar = "";
    let isVerbatim = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inString) {
        if (isVerbatim) {
          if (ch === '"' && line[i + 1] === '"') {
            i++;
          } else if (ch === '"') {
            inString = false;
          }
        } else {
          if (ch === "\\") {
            i++;
          } else if (ch === quoteChar) {
            inString = false;
          }
        }
      } else {
        if (ch === "@" && line[i + 1] === '"') {
          inString = true;
          isVerbatim = true;
          quoteChar = '"';
          i++;
        } else if (ch === '"' || ch === "'") {
          inString = true;
          isVerbatim = false;
          quoteChar = ch;
        } else if (ch === "/" && line[i + 1] === "/") {
          return line.slice(0, i);
        }
      }
    }
    return line;
  }

  private extractEnumVariants(text: string, variants: { name: string; span: Span }[]): void {
    const clean = this.stripLineComment(text)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .trim();
    if (!clean) return;

    for (const part of clean.split(",")) {
      const trimmedPart = part.trim();
      if (!trimmedPart || trimmedPart === "{" || trimmedPart === "}") continue;
      const identMatch = trimmedPart.match(/^([a-zA-Z0-9_]+)/);
      if (identMatch) {
        variants.push({
          name: identMatch[1],
          span: emptySpan(this.filePath),
        });
      }
    }
  }

  private collectBracedBlock(
    lines: string[],
    startIdx: number,
  ): { bodyLines: string[]; nextIdx: number } {
    let lineIdx = startIdx;
    while (lineIdx < lines.length && !lines[lineIdx].includes("{")) {
      lineIdx++;
    }
    if (lineIdx >= lines.length) {
      return { bodyLines: [], nextIdx: startIdx + 1 };
    }

    const firstLine = lines[lineIdx];
    const openBraceIdx = firstLine.indexOf("{");
    const afterOpen = firstLine.slice(openBraceIdx + 1);

    let braceCount = 1;
    let inString = false;
    let quoteChar = "";
    let isVerbatim = false;
    let inBlockComment = false;

    // Check if it closes on the same line
    for (let c = 0; c < afterOpen.length; c++) {
      const ch = afterOpen[c];
      if (inBlockComment) {
        if (ch === "*" && afterOpen[c + 1] === "/") {
          inBlockComment = false;
          c++;
        }
        continue;
      }
      if (inString) {
        if (isVerbatim) {
          if (ch === '"' && afterOpen[c + 1] === '"') c++;
          else if (ch === '"') inString = false;
        } else {
          if (ch === "\\") c++;
          else if (ch === quoteChar) inString = false;
        }
      } else {
        if (ch === "/" && afterOpen[c + 1] === "*") {
          inBlockComment = true;
          c++;
        } else if (ch === "/" && afterOpen[c + 1] === "/") {
          break;
        } else if (ch === "@" && afterOpen[c + 1] === '"') {
          inString = true;
          isVerbatim = true;
          quoteChar = '"';
          c++;
        } else if (ch === '"' || ch === "'") {
          inString = true;
          isVerbatim = false;
          quoteChar = ch;
        } else if (ch === "{") {
          braceCount++;
        } else if (ch === "}") {
          braceCount--;
          if (braceCount === 0) {
            const sameLineContent = afterOpen.slice(0, c);
            return { bodyLines: [sameLineContent], nextIdx: lineIdx + 1 };
          }
        }
      }
    }

    const bodyLines: string[] = [];
    if (afterOpen.trim().length > 0) {
      bodyLines.push(afterOpen);
    }

    lineIdx++;
    while (braceCount > 0 && lineIdx < lines.length) {
      const l = lines[lineIdx];
      let lineAccum = "";
      for (let c = 0; c < l.length; c++) {
        const ch = l[c];
        if (inBlockComment) {
          lineAccum += ch;
          if (ch === "*" && l[c + 1] === "/") {
            inBlockComment = false;
            lineAccum += l[c + 1];
            c++;
          }
          continue;
        }
        if (inString) {
          lineAccum += ch;
          if (isVerbatim) {
            if (ch === '"' && l[c + 1] === '"') {
              lineAccum += l[c + 1];
              c++;
            } else if (ch === '"') {
              inString = false;
            }
          } else {
            if (ch === "\\") {
              if (c + 1 < l.length) {
                lineAccum += l[c + 1];
                c++;
              }
            } else if (ch === quoteChar) {
              inString = false;
            }
          }
        } else {
          if (ch === "/" && l[c + 1] === "*") {
            inBlockComment = true;
            lineAccum += ch + l[c + 1];
            c++;
          } else if (ch === "/" && l[c + 1] === "/") {
            break;
          } else if (ch === "@" && l[c + 1] === '"') {
            inString = true;
            isVerbatim = true;
            quoteChar = '"';
            lineAccum += ch + l[c + 1];
            c++;
          } else if (ch === '"' || ch === "'") {
            inString = true;
            isVerbatim = false;
            quoteChar = ch;
            lineAccum += ch;
          } else if (ch === "{") {
            braceCount++;
            lineAccum += ch;
          } else if (ch === "}") {
            braceCount--;
            if (braceCount === 0) {
              bodyLines.push(lineAccum);
              return { bodyLines, nextIdx: lineIdx + 1 };
            }
            lineAccum += ch;
          } else {
            lineAccum += ch;
          }
        }
      }
      bodyLines.push(lineAccum);
      lineIdx++;
    }

    return { bodyLines, nextIdx: lineIdx };
  }

  private attachTrivia(nodeId: string, triviaItems: TriviaItem[]): void {
    for (const item of triviaItems) {
      this.trivia.addLeadingTrivia(nodeId, item);
    }
  }

  private parseLeadingMember(line: string): {
    modifiers: string[];
    typeStr: string;
    name: string;
    remainder: string;
  } | null {
    let s = line.trim();
    const MODIFIERS = new Set([
      "public",
      "private",
      "protected",
      "internal",
      "static",
      "readonly",
      "const",
      "volatile",
      "override",
      "virtual",
      "sealed",
      "abstract",
      "async",
      "new",
      "extern",
      "unsafe",
      "partial",
    ]);

    const modifiers: string[] = [];
    while (true) {
      const m = s.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s+/);
      if (m && MODIFIERS.has(m[1])) {
        modifiers.push(m[1]);
        s = s.slice(m[0].length).trimStart();
      } else {
        break;
      }
    }

    if (!s) return null;
    let typeEnd = 0;
    if (s.startsWith("var ") || s.startsWith("var\t")) {
      typeEnd = 3;
    } else if (s[0] === "(") {
      let depth = 0;
      while (typeEnd < s.length) {
        if (s[typeEnd] === "(") depth++;
        else if (s[typeEnd] === ")") {
          depth--;
          if (depth === 0) {
            typeEnd++;
            break;
          }
        }
        typeEnd++;
      }
    } else {
      const identMatch = s.match(/^[a-zA-Z_][a-zA-Z0-9_.]*/);
      if (!identMatch) return null;
      typeEnd = identMatch[0].length;
      if (typeEnd < s.length && s[typeEnd] === "<") {
        let depth = 0;
        while (typeEnd < s.length) {
          if (s[typeEnd] === "<") depth++;
          else if (s[typeEnd] === ">") {
            depth--;
            if (depth === 0) {
              typeEnd++;
              break;
            }
          }
          typeEnd++;
        }
      }
    }

    while (typeEnd < s.length) {
      if (s[typeEnd] === "?") {
        typeEnd++;
      } else if (s[typeEnd] === "[") {
        const closeIdx = s.indexOf("]", typeEnd);
        if (closeIdx === -1) break;
        typeEnd = closeIdx + 1;
      } else {
        break;
      }
    }

    const typeStr = s.slice(0, typeEnd).trim();
    const restAfterType = s.slice(typeEnd).trimStart();

    const nameMatch = restAfterType.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*(.*)/s);
    if (!nameMatch) return null;

    const name = nameMatch[1];
    const remainder = nameMatch[2];

    return { modifiers, typeStr, name, remainder };
  }

  private parseStructFields(lines: string[]): FieldDecl[] {
    const fields: FieldDecl[] = [];
    for (const line of lines) {
      const trimmed = this.stripLineComment(line).trim();
      if (!trimmed || trimmed === "{" || trimmed === "}" || trimmed.includes("(")) {
        continue;
      }
      const mem = this.parseLeadingMember(trimmed);
      if (mem && mem.name !== "struct" && mem.name !== "class") {
        fields.push({
          name: mem.name,
          typeAnnotation: this.parseCSharpType(mem.typeStr),
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

      if (trimmed.startsWith("/*")) {
        let blockComment = trimmed;
        while (!blockComment.includes("*/") && i + 1 < lines.length) {
          i++;
          blockComment += "\n" + lines[i];
        }
        memberTrivia.push({
          kind: "BLOCK_COMMENT",
          content: blockComment,
        });
        i++;
        continue;
      }

      // Check for nested classes/structs and skip them
      const nestedClassMatch = trimmed.match(
        /^(?:public|internal|private|protected)?\s*(?:sealed|static|partial|abstract|\s)*\s*(?:class|struct)\s+([a-zA-Z0-9_]+)/,
      );
      if (nestedClassMatch) {
        const { nextIdx } = this.collectBracedBlock(lines, i);
        i = nextIdx;
        continue;
      }

      // Join multi-line member signature if needed
      let fullLine = trimmed;
      let lineIdx = i;
      if (fullLine.includes("(") && !fullLine.includes(")") && !fullLine.includes(";")) {
        while (lineIdx + 1 < lines.length) {
          lineIdx++;
          fullLine += " " + lines[lineIdx].trim();
          if (lines[lineIdx].includes(")")) break;
        }
      }

      // Constructor: [public|private] ClassName(params) [: base(...)] [{ body }]
      const ctorMatch = fullLine.match(
        new RegExp(`^(?:public|internal|private|protected)?\\s*${className}\\s*\\(([^)]*)\\)`),
      );
      if (ctorMatch) {
        const paramsRaw = ctorMatch[1];
        const ctorParams = this.parseCSharpParams(paramsRaw);

        let bodyStatements: Statement[] = [];
        if (!fullLine.endsWith(";")) {
          const { bodyLines, nextIdx } = this.collectBracedBlock(lines, lineIdx);
          i = nextIdx;
          bodyStatements = this.parseCSharpBlock(bodyLines);
        } else {
          i = lineIdx + 1;
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

      const mem = this.parseLeadingMember(fullLine);
      if (mem && mem.name !== "class" && mem.name !== "struct" && mem.name !== "enum") {
        const isStatic = mem.modifiers.includes("static");
        const isReadonly = mem.modifiers.includes("readonly") || mem.modifiers.includes("const");

        // 1. Method
        if (mem.remainder.startsWith("(")) {
          const parenRes = this.extractBalancedParen(mem.remainder, 0);
          if (parenRes) {
            const paramsRaw = parenRes.content;
            const afterParen = mem.remainder.slice(parenRes.endIndex + 1).trim();

            if (afterParen.startsWith("=>")) {
              let exprBody = afterParen.slice(2).trim();
              if (!this.isStatementComplete(exprBody)) {
                while (lineIdx + 1 < lines.length) {
                  lineIdx++;
                  exprBody += "\n" + lines[lineIdx];
                  if (this.isStatementComplete(exprBody)) break;
                }
              }
              i = lineIdx + 1;
              exprBody = exprBody.replace(/;$/, "").trim();

              const nodeId = `method:${className}.${mem.name}`;
              this.attachTrivia(nodeId, memberTrivia);
              memberTrivia = [];

              methods.push({
                kind: "MethodDecl",
                name: mem.name,
                isStatic,
                isAsync: mem.modifiers.includes("async"),
                isExpressionBodied: true,
                typeParams: [],
                params: this.parseCSharpParams(paramsRaw),
                returnType: this.parseCSharpType(mem.typeStr),
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
              continue;
            } else {
              let bodyStatements: Statement[] = [];
              if (afterParen !== ";" && !fullLine.endsWith(";")) {
                const { bodyLines, nextIdx } = this.collectBracedBlock(lines, lineIdx);
                i = nextIdx;
                bodyStatements = this.parseCSharpBlock(bodyLines);
              } else {
                i = lineIdx + 1;
              }

              const nodeId = `method:${className}.${mem.name}`;
              this.attachTrivia(nodeId, memberTrivia);
              memberTrivia = [];

              methods.push({
                kind: "MethodDecl",
                name: mem.name,
                isStatic,
                isAsync: mem.modifiers.includes("async"),
                isExpressionBodied: false,
                typeParams: [],
                params: this.parseCSharpParams(paramsRaw),
                returnType: this.parseCSharpType(mem.typeStr),
                body: {
                  kind: "Block",
                  statements: bodyStatements,
                  span: emptySpan(this.filePath),
                },
                span: emptySpan(this.filePath),
              });
              continue;
            }
          }
        }

        // 2. Field or Property
        let propLine = fullLine;
        const hasAccessorBlock =
          (!fullLine.includes("=") ||
            (fullLine.includes("{") && fullLine.indexOf("{") < fullLine.indexOf("="))) &&
          (fullLine.includes("{") ||
            (lineIdx + 1 < lines.length && lines[lineIdx + 1].trim().startsWith("{")));
        if (hasAccessorBlock) {
          const { bodyLines, nextIdx } = this.collectBracedBlock(lines, lineIdx);
          i = nextIdx;
          propLine = fullLine + " " + bodyLines.join(" ");
        } else if (!propLine.includes(";")) {
          while (lineIdx + 1 < lines.length) {
            lineIdx++;
            propLine += " " + lines[lineIdx].trim();
            if (lines[lineIdx].includes(";")) break;
          }
          i = lineIdx + 1;
        } else {
          i = lineIdx + 1;
        }
        propLine = this.stripLineComment(propLine).trim();

        const nodeId = `field:${className}.${mem.name}`;
        this.attachTrivia(nodeId, memberTrivia);
        memberTrivia = [];

        // Expression-bodied property: => expr;
        if (
          propLine.includes("=>") &&
          !propLine.includes("get =>") &&
          !propLine.includes("set =>")
        ) {
          const bodyStr = propLine
            .slice(propLine.indexOf("=>") + 2)
            .replace(/;$/, "")
            .trim();
          properties.push({
            kind: "PropertyDecl",
            name: mem.name,
            isStatic,
            isReadonly: true,
            typeAnnotation: this.parseCSharpType(mem.typeStr),
            initialValue: this.parseCSharpExpr(bodyStr),
            span: emptySpan(this.filePath),
          });
          continue;
        }

        // Initialized field / const: = expr;
        if (
          propLine.includes("=") &&
          (!propLine.includes("{") || propLine.indexOf("=") < propLine.indexOf("{"))
        ) {
          const eqIdx = propLine.indexOf("=");
          const initValStr = propLine
            .slice(eqIdx + 1)
            .replace(/;$/, "")
            .trim();
          properties.push({
            kind: "PropertyDecl",
            name: mem.name,
            isStatic,
            isReadonly,
            typeAnnotation: this.parseCSharpType(mem.typeStr),
            initialValue: this.parseCSharpExpr(initValStr),
            span: emptySpan(this.filePath),
          });
          continue;
        }

        // Property with { get => ...; set => ...; } or { get; set; }
        if (propLine.includes("{")) {
          let initialValue: Expr | undefined;
          const getMatch = propLine.match(/get\s*=>\s*(.+?);/);
          if (getMatch) {
            initialValue = this.parseCSharpExpr(getMatch[1].trim());
          }
          const hasOnlyGet = propLine.includes("{ get;") && !propLine.includes("set;");
          properties.push({
            kind: "PropertyDecl",
            name: mem.name,
            isStatic,
            isReadonly: isReadonly || hasOnlyGet,
            typeAnnotation: this.parseCSharpType(mem.typeStr),
            ...(initialValue ? { initialValue } : {}),
            span: emptySpan(this.filePath),
          });
          continue;
        }

        // Plain uninitialized field
        properties.push({
          kind: "PropertyDecl",
          name: mem.name,
          isStatic,
          isReadonly,
          typeAnnotation: this.parseCSharpType(mem.typeStr),
          span: emptySpan(this.filePath),
        });
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
      primaryConstructor: undefined,
      properties,
      methods,
      span: emptySpan(this.filePath),
    };
  }

  private splitBySemicolon(line: string): string[] {
    const parts: string[] = [];
    let cur = "";
    let parenDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;
    let inString = false;
    let quoteChar = "";

    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"' || c === "'") {
        let backslashCount = 0;
        let k = i - 1;
        while (k >= 0 && line[k] === "\\") {
          backslashCount++;
          k--;
        }
        if (backslashCount % 2 === 0) {
          if (!inString) {
            inString = true;
            quoteChar = c;
          } else if (quoteChar === c) {
            inString = false;
          }
        }
      }
      if (inString) {
        cur += c;
        continue;
      }

      if (c === "(") parenDepth++;
      else if (c === ")") parenDepth--;
      else if (c === "[") bracketDepth++;
      else if (c === "]") bracketDepth--;
      else if (c === "{") braceDepth++;
      else if (c === "}") braceDepth--;

      if (c === ";" && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
        if (cur.trim()) parts.push(cur.trim() + ";");
        cur = "";
      } else {
        cur += c;
      }
    }
    if (cur.trim()) parts.push(cur.trim());
    return parts;
  }

  private isStatementComplete(s: string): boolean {
    const trimmed = s.trim();
    if (!trimmed.endsWith(";")) {
      if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
        // block
      } else {
        return false;
      }
    }
    let parenDepth = 0;
    let braceDepth = 0;
    let bracketDepth = 0;
    let inString = false;
    let quoteChar = "";

    for (let j = 0; j < trimmed.length; j++) {
      const c = trimmed[j];
      if (c === '"' || c === "'") {
        let backslashCount = 0;
        let k = j - 1;
        while (k >= 0 && trimmed[k] === "\\") {
          backslashCount++;
          k--;
        }
        if (backslashCount % 2 === 0) {
          if (!inString) {
            inString = true;
            quoteChar = c;
          } else if (quoteChar === c) {
            inString = false;
          }
        }
      }
      if (inString) continue;
      if (c === "(") parenDepth++;
      else if (c === ")") parenDepth--;
      else if (c === "{") braceDepth++;
      else if (c === "}") braceDepth--;
      else if (c === "[") bracketDepth++;
      else if (c === "]") bracketDepth--;
    }
    return parenDepth <= 0 && braceDepth <= 0 && bracketDepth <= 0;
  }

  private parseCSharpCaseLabel(
    line: string,
  ): { kind: "case"; value: string; rest: string } | { kind: "default"; rest: string } | null {
    const trimmed = line.trim();
    if (trimmed.startsWith("default:")) {
      return { kind: "default", rest: trimmed.slice(8).trim() };
    }
    if (trimmed.startsWith("default") && /^\s*:\s*/.test(trimmed.slice(7))) {
      const colonIdx = trimmed.indexOf(":");
      return { kind: "default", rest: trimmed.slice(colonIdx + 1).trim() };
    }
    if (trimmed.startsWith("case ") || trimmed.startsWith("case\t")) {
      let inStr = false;
      let quoteChar = "";
      let colonIdx = -1;
      for (let c = 5; c < trimmed.length; c++) {
        const ch = trimmed[c];
        if (ch === '"' || ch === "'") {
          if (!inStr) {
            inStr = true;
            quoteChar = ch;
          } else if (quoteChar === ch) {
            inStr = false;
          }
        } else if (!inStr && ch === ":") {
          colonIdx = c;
          break;
        }
      }
      if (colonIdx !== -1) {
        return {
          kind: "case",
          value: trimmed.slice(5, colonIdx).trim(),
          rest: trimmed.slice(colonIdx + 1).trim(),
        };
      }
    }
    return null;
  }

  private findLastMemberDot(s: string): { dotIdx: number; isSafeNav: boolean } | null {
    let parenDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;
    let inStr = false;
    let qChar = "";

    for (let j = s.length - 1; j >= 0; j--) {
      const c = s[j];
      if (c === '"' || c === "'") {
        let bsCount = 0;
        let k = j - 1;
        while (k >= 0 && s[k] === "\\") {
          bsCount++;
          k--;
        }
        if (bsCount % 2 === 0) {
          if (!inStr) {
            inStr = true;
            qChar = c;
          } else if (qChar === c) {
            inStr = false;
          }
        }
      }
      if (inStr) continue;
      if (c === ")") parenDepth++;
      else if (c === "(") parenDepth--;
      else if (c === "]") bracketDepth++;
      else if (c === "[") bracketDepth--;
      else if (c === "}") braceDepth++;
      else if (c === "{") braceDepth--;

      if (parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
        if (c === ".") {
          const isSafeNav = j > 0 && s[j - 1] === "?";
          return { dotIdx: j, isSafeNav };
        }
      }
    }
    return null;
  }

  private findMatchingOpenParen(s: string): number {
    if (!s.endsWith(")")) return -1;
    let depth = 0;
    let inStr = false;
    let qChar = "";
    for (let i = s.length - 1; i >= 0; i--) {
      const c = s[i];
      if (c === '"' || c === "'") {
        let bsCount = 0;
        let k = i - 1;
        while (k >= 0 && s[k] === "\\") {
          bsCount++;
          k--;
        }
        if (bsCount % 2 === 0) {
          if (!inStr) {
            inStr = true;
            qChar = c;
          } else if (qChar === c) {
            inStr = false;
          }
        }
      }
      if (inStr) continue;
      if (c === ")") depth++;
      else if (c === "(") {
        depth--;
        if (depth === 0) return i;
      }
    }
    return -1;
  }

  private parseInterpolatedString(s: string): TemplateLiteralExpr | null {
    let prefix = "";
    if (s.startsWith('$"')) prefix = '$"';
    else if (s.startsWith('$@"')) prefix = '$@"';
    else if (s.startsWith('@$"')) prefix = '@$"';
    else return null;

    if (!s.endsWith('"') || s.length < prefix.length + 1) return null;

    const isVerbatim = prefix.includes("@");
    const content = s.slice(prefix.length, -1);

    const quasis: string[] = [];
    const expressions: Expr[] = [];
    let curQuasi = "";
    let i = 0;

    while (i < content.length) {
      const c = content[i];
      if (c === "{" && content[i + 1] === "{") {
        curQuasi += "{";
        i += 2;
        continue;
      }
      if (c === "}" && content[i + 1] === "}") {
        curQuasi += "}";
        i += 2;
        continue;
      }
      if (c === "{") {
        quasis.push(curQuasi);
        curQuasi = "";
        i++;
        const exprStart = i;
        let braceDepth = 1;
        let inExprStr = false;
        let exprQuote = "";
        while (i < content.length && braceDepth > 0) {
          const ec = content[i];
          if (ec === '"' || ec === "'") {
            let bsCount = 0;
            let k = i - 1;
            while (k >= exprStart && content[k] === "\\") {
              bsCount++;
              k--;
            }
            if (bsCount % 2 === 0) {
              if (!inExprStr) {
                inExprStr = true;
                exprQuote = ec;
              } else if (exprQuote === ec) {
                inExprStr = false;
              }
            }
          }
          if (!inExprStr) {
            if (ec === "{") braceDepth++;
            else if (ec === "}") braceDepth--;
          }
          if (braceDepth > 0) i++;
        }
        let exprCode = content.slice(exprStart, i).trim();
        const colonIdx = exprCode.indexOf(":");
        if (colonIdx !== -1 && !exprCode.includes("?") && !exprCode.includes("=>")) {
          exprCode = exprCode.slice(0, colonIdx).trim();
        }
        expressions.push(this.parseCSharpExpr(exprCode));
        i++; // skip '}'
        continue;
      }

      if (isVerbatim && c === '"' && content[i + 1] === '"') {
        curQuasi += '"';
        i += 2;
        continue;
      }
      if (!isVerbatim && c === "\\" && i + 1 < content.length) {
        curQuasi += content[i + 1];
        i += 2;
        continue;
      }
      curQuasi += c;
      i++;
    }

    quasis.push(curQuasi);
    return {
      kind: "TemplateLiteralExpr",
      quasis,
      expressions,
      span: emptySpan(this.filePath),
    };
  }

  private parseCSharpBlock(lines: string[]): Statement[] {
    const statements: Statement[] = [];

    // Pre-split lines that contain single-line try { ... } catch (...) { ... } or multiple statements
    const expandedLines: string[] = [];
    for (const l of lines) {
      const stripped = this.stripLineComment(l);
      const trimmed = stripped.trim();
      if (trimmed.startsWith("try") && trimmed.includes("catch")) {
        const catchIdx = stripped.indexOf("catch");
        expandedLines.push(stripped.slice(0, catchIdx).trim());
        expandedLines.push(stripped.slice(catchIdx).trim());
      } else if (
        !trimmed.startsWith("if") &&
        !trimmed.startsWith("while") &&
        !trimmed.startsWith("for") &&
        !trimmed.startsWith("foreach") &&
        !trimmed.startsWith("switch") &&
        !trimmed.startsWith("try") &&
        !trimmed.startsWith("using") &&
        !trimmed.startsWith("unchecked")
      ) {
        const parts = this.splitBySemicolon(stripped);
        if (parts.length > 1) {
          expandedLines.push(...parts);
        } else {
          expandedLines.push(l);
        }
      } else {
        expandedLines.push(l);
      }
    }

    for (let i = 0; i < expandedLines.length; i++) {
      const rawLine = expandedLines[i];
      let trimmed = this.stripLineComment(rawLine).trim();

      if (!trimmed || trimmed === "{" || trimmed === "}") {
        continue;
      }

      if (trimmed.startsWith("/*")) {
        while (!expandedLines[i].includes("*/") && i + 1 < expandedLines.length) {
          i++;
        }
        continue;
      }

      if (trimmed === "unchecked") {
        continue;
      }

      if (trimmed.startsWith("unchecked")) {
        const withoutUnchecked = trimmed.replace(/^unchecked\s*/, "").trim();
        if (withoutUnchecked.startsWith("{") && withoutUnchecked.endsWith("}")) {
          statements.push(...this.parseCSharpBlock([withoutUnchecked.slice(1, -1)]));
          continue;
        } else if (withoutUnchecked.startsWith("{") || withoutUnchecked === "") {
          continue;
        } else {
          trimmed = withoutUnchecked;
        }
      }

      if (
        trimmed.startsWith("using var ") ||
        (trimmed.startsWith("using ") && !trimmed.includes("(") && trimmed.includes("="))
      ) {
        trimmed = trimmed.replace(/^using\s+/, "");
      }

      if (
        trimmed.startsWith("{") &&
        (trimmed.endsWith("}") || trimmed.endsWith("};")) &&
        !trimmed.includes("=>")
      ) {
        const inner = trimmed.replace(/^\{/, "").replace(/\};?$/, "").trim();
        if (inner) {
          statements.push(...this.parseCSharpBlock(this.splitBySemicolon(inner)));
        }
        continue;
      }

      // return [expr];
      if (
        trimmed.startsWith("return") &&
        (trimmed === "return;" || trimmed.startsWith("return ") || trimmed.startsWith("return\t"))
      ) {
        let returnLine = trimmed;
        let lineIdx = i;
        if (!returnLine.endsWith(";")) {
          while (lineIdx + 1 < expandedLines.length) {
            lineIdx++;
            returnLine += " " + this.stripLineComment(expandedLines[lineIdx]).trim();
            if (expandedLines[lineIdx].includes(";")) break;
          }
        }
        i = lineIdx;
        const valStr = returnLine
          .replace(/^return\s*/, "")
          .replace(/;$/, "")
          .trim();
        statements.push({
          kind: "ReturnStmt",
          value: valStr ? this.parseCSharpExpr(valStr) : null,
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

      // if (cond) { ... } [else if (cond) { ... }]* [else { ... }]
      if (trimmed.startsWith("if") && (trimmed.startsWith("if ") || trimmed.startsWith("if("))) {
        let ifLine = trimmed;
        let lineIdx = i;
        if (
          !ifLine.includes(")") ||
          this.extractBalancedParen(ifLine, ifLine.indexOf("(")) === null
        ) {
          while (lineIdx + 1 < expandedLines.length) {
            lineIdx++;
            ifLine += " " + this.stripLineComment(expandedLines[lineIdx]).trim();
            if (this.extractBalancedParen(ifLine, ifLine.indexOf("(")) !== null) break;
          }
        }

        const parenRes = this.extractBalancedParen(ifLine, ifLine.indexOf("("));
        if (parenRes) {
          const condStr = parenRes.content;
          const rest = ifLine.slice(parenRes.endIndex + 1).trim();

          let thenStatements: Statement[] = [];
          let elseBranch: Block | null = null;

          if (
            rest === "{" ||
            (!rest &&
              lineIdx + 1 < expandedLines.length &&
              expandedLines[lineIdx + 1].trim().startsWith("{"))
          ) {
            const startAt = rest === "{" ? lineIdx : lineIdx + 1;
            const { bodyLines, nextIdx } = this.collectBracedBlock(expandedLines, startAt);
            thenStatements = this.parseCSharpBlock(bodyLines);
            lineIdx = nextIdx - 1;
          } else if (rest.startsWith("{")) {
            const { bodyLines, nextIdx } = this.collectBracedBlock(
              [rest, ...expandedLines.slice(lineIdx + 1)],
              0,
            );
            thenStatements = this.parseCSharpBlock(bodyLines);
            lineIdx += nextIdx - 1;
          } else if (rest.startsWith("return")) {
            const retStr = rest
              .replace(/^return\s*/, "")
              .replace(/;$/, "")
              .trim();
            thenStatements = [
              {
                kind: "ReturnStmt",
                value: retStr ? this.parseCSharpExpr(retStr) : null,
                span: emptySpan(this.filePath),
              },
            ];
          } else if (
            rest.includes(" else ") ||
            rest.includes(";else ") ||
            rest.includes("; else ")
          ) {
            const elseMatch = rest.match(/;\s*else\s+(.*)$/);
            if (elseMatch) {
              const thenPart = rest.slice(0, elseMatch.index).trim();
              let elsePart = elseMatch[1].trim();
              if (elsePart.startsWith("{") && elsePart.endsWith("}")) {
                elsePart = elsePart.slice(1, -1).trim();
              }
              thenStatements = this.parseCSharpBlock(
                this.splitBySemicolon(thenPart.endsWith(";") ? thenPart : thenPart + ";"),
              );
              elseBranch = {
                kind: "Block",
                statements: this.parseCSharpBlock(
                  this.splitBySemicolon(elsePart.endsWith(";") ? elsePart : elsePart + ";"),
                ),
                span: emptySpan(this.filePath),
              };
            } else {
              thenStatements = this.parseCSharpBlock([rest]);
            }
          } else if (rest && rest !== ";") {
            thenStatements = this.parseCSharpBlock([rest]);
          } else if (!rest && lineIdx + 1 < expandedLines.length) {
            lineIdx++;
            thenStatements = this.parseCSharpBlock([expandedLines[lineIdx].trim()]);
          }

          const elifBranches: Array<{ condition: Expr; body: Block; span: Span }> = [];

          while (lineIdx + 1 < expandedLines.length) {
            const nextTrimmed = this.stripLineComment(expandedLines[lineIdx + 1]).trim();
            if (nextTrimmed.startsWith("else if") || nextTrimmed.startsWith("else\tif")) {
              lineIdx++;
              let elifLine = nextTrimmed;
              if (
                !elifLine.includes(")") ||
                this.extractBalancedParen(elifLine, elifLine.indexOf("(")) === null
              ) {
                while (lineIdx + 1 < expandedLines.length) {
                  lineIdx++;
                  elifLine += " " + this.stripLineComment(expandedLines[lineIdx]).trim();
                  if (this.extractBalancedParen(elifLine, elifLine.indexOf("(")) !== null) break;
                }
              }
              const elifParen = this.extractBalancedParen(elifLine, elifLine.indexOf("("));
              if (elifParen) {
                const elifCond = elifParen.content;
                const elifRest = elifLine.slice(elifParen.endIndex + 1).trim();
                let elifStmts: Statement[] = [];
                if (
                  elifRest === "{" ||
                  (!elifRest &&
                    lineIdx + 1 < expandedLines.length &&
                    expandedLines[lineIdx + 1].trim().startsWith("{"))
                ) {
                  const startAt = elifRest === "{" ? lineIdx : lineIdx + 1;
                  const { bodyLines, nextIdx } = this.collectBracedBlock(expandedLines, startAt);
                  elifStmts = this.parseCSharpBlock(bodyLines);
                  lineIdx = nextIdx - 1;
                } else if (elifRest.startsWith("{")) {
                  const { bodyLines, nextIdx } = this.collectBracedBlock(
                    [elifRest, ...expandedLines.slice(lineIdx + 1)],
                    0,
                  );
                  elifStmts = this.parseCSharpBlock(bodyLines);
                  lineIdx += nextIdx - 1;
                } else if (elifRest && elifRest !== ";") {
                  elifStmts = this.parseCSharpBlock([elifRest]);
                } else if (!elifRest && lineIdx + 1 < expandedLines.length) {
                  lineIdx++;
                  elifStmts = this.parseCSharpBlock([expandedLines[lineIdx].trim()]);
                }
                elifBranches.push({
                  condition: this.parseCSharpExpr(elifCond),
                  body: { kind: "Block", statements: elifStmts, span: emptySpan(this.filePath) },
                  span: emptySpan(this.filePath),
                });
              }
            } else if (
              nextTrimmed === "else" ||
              nextTrimmed.startsWith("else ") ||
              nextTrimmed.startsWith("else{")
            ) {
              lineIdx++;
              const elseRest = nextTrimmed.slice(4).trim();
              let elseStmts: Statement[] = [];
              if (
                elseRest === "{" ||
                (!elseRest &&
                  lineIdx + 1 < expandedLines.length &&
                  expandedLines[lineIdx + 1].trim().startsWith("{"))
              ) {
                const startAt = elseRest === "{" ? lineIdx : lineIdx + 1;
                const { bodyLines, nextIdx } = this.collectBracedBlock(expandedLines, startAt);
                elseStmts = this.parseCSharpBlock(bodyLines);
                lineIdx = nextIdx - 1;
              } else if (elseRest.startsWith("{")) {
                const { bodyLines, nextIdx } = this.collectBracedBlock(
                  [elseRest, ...expandedLines.slice(lineIdx + 1)],
                  0,
                );
                elseStmts = this.parseCSharpBlock(bodyLines);
                lineIdx += nextIdx - 1;
              } else if (elseRest && elseRest !== ";") {
                elseStmts = this.parseCSharpBlock([elseRest]);
              } else if (!elseRest && lineIdx + 1 < expandedLines.length) {
                lineIdx++;
                elseStmts = this.parseCSharpBlock([expandedLines[lineIdx].trim()]);
              }
              elseBranch = {
                kind: "Block",
                statements: elseStmts,
                span: emptySpan(this.filePath),
              };
              break;
            } else {
              break;
            }
          }

          i = lineIdx;
          statements.push({
            kind: "IfStmt",
            condition: this.parseCSharpExpr(condStr),
            thenBranch: {
              kind: "Block",
              statements: thenStatements,
              span: emptySpan(this.filePath),
            },
            elifBranches,
            elseBranch,
            span: emptySpan(this.filePath),
          });
          continue;
        }
      }

      // while (cond) { ... }
      if (
        trimmed.startsWith("while") &&
        (trimmed.startsWith("while ") || trimmed.startsWith("while("))
      ) {
        let whileLine = trimmed;
        let lineIdx = i;
        if (
          !whileLine.includes(")") ||
          this.extractBalancedParen(whileLine, whileLine.indexOf("(")) === null
        ) {
          while (lineIdx + 1 < expandedLines.length) {
            lineIdx++;
            whileLine += " " + this.stripLineComment(expandedLines[lineIdx]).trim();
            if (this.extractBalancedParen(whileLine, whileLine.indexOf("(")) !== null) break;
          }
        }

        const parenRes = this.extractBalancedParen(whileLine, whileLine.indexOf("("));
        if (parenRes) {
          const condStr = parenRes.content;
          const rest = whileLine.slice(parenRes.endIndex + 1).trim();
          let bodyStmts: Statement[] = [];
          if (
            rest === "{" ||
            (!rest &&
              lineIdx + 1 < expandedLines.length &&
              expandedLines[lineIdx + 1].trim().startsWith("{"))
          ) {
            const startAt = rest === "{" ? lineIdx : lineIdx + 1;
            const { bodyLines, nextIdx } = this.collectBracedBlock(expandedLines, startAt);
            bodyStmts = this.parseCSharpBlock(bodyLines);
            lineIdx = nextIdx - 1;
          } else if (rest.startsWith("{")) {
            const { bodyLines, nextIdx } = this.collectBracedBlock(
              [rest, ...expandedLines.slice(lineIdx + 1)],
              0,
            );
            bodyStmts = this.parseCSharpBlock(bodyLines);
            lineIdx += nextIdx - 1;
          } else if (rest && rest !== ";") {
            bodyStmts = this.parseCSharpBlock([rest]);
          } else if (!rest && lineIdx + 1 < expandedLines.length) {
            lineIdx++;
            bodyStmts = this.parseCSharpBlock([expandedLines[lineIdx].trim()]);
          }

          i = lineIdx;
          statements.push({
            kind: "WhileStmt",
            condition: this.parseCSharpExpr(condStr),
            body: {
              kind: "Block",
              statements: bodyStmts,
              span: emptySpan(this.filePath),
            },
            span: emptySpan(this.filePath),
          });
          continue;
        }
      }

      // foreach (var item in list) { ... }
      if (
        trimmed.startsWith("foreach") &&
        (trimmed.startsWith("foreach ") || trimmed.startsWith("foreach("))
      ) {
        const parenRes = this.extractBalancedParen(trimmed, trimmed.indexOf("("));
        if (parenRes) {
          const content = parenRes.content.trim();
          const inIdx = content.indexOf(" in ");
          if (inIdx !== -1) {
            const left = content.slice(0, inIdx).trim();
            const iterStr = content.slice(inIdx + 4).trim();
            const leftParts = left.split(/\s+/);
            const varName = leftParts[leftParts.length - 1];
            const rest = trimmed.slice(parenRes.endIndex + 1).trim();
            let lineIdx = i;
            let bodyStmts: Statement[] = [];
            if (
              rest === "{" ||
              (!rest &&
                lineIdx + 1 < expandedLines.length &&
                expandedLines[lineIdx + 1].trim().startsWith("{"))
            ) {
              const startAt = rest === "{" ? lineIdx : lineIdx + 1;
              const { bodyLines, nextIdx } = this.collectBracedBlock(expandedLines, startAt);
              bodyStmts = this.parseCSharpBlock(bodyLines);
              lineIdx = nextIdx - 1;
            } else if (rest.startsWith("{")) {
              const { bodyLines, nextIdx } = this.collectBracedBlock(
                [rest, ...expandedLines.slice(lineIdx + 1)],
                0,
              );
              bodyStmts = this.parseCSharpBlock(bodyLines);
              lineIdx += nextIdx - 1;
            } else if (rest && rest !== ";") {
              bodyStmts = this.parseCSharpBlock([rest]);
            } else if (!rest && lineIdx + 1 < expandedLines.length) {
              lineIdx++;
              bodyStmts = this.parseCSharpBlock([expandedLines[lineIdx].trim()]);
            }

            i = lineIdx;
            statements.push({
              kind: "ForStmt",
              variable: varName,
              iterable: this.parseCSharpExpr(iterStr),
              body: {
                kind: "Block",
                statements: bodyStmts,
                span: emptySpan(this.filePath),
              },
              span: emptySpan(this.filePath),
            });
            continue;
          }
        }
      }

      // for (int i = 0; i < n; i++) stmt;
      if (trimmed.startsWith("for") && (trimmed.startsWith("for ") || trimmed.startsWith("for("))) {
        const parenRes = this.extractBalancedParen(trimmed, trimmed.indexOf("("));
        if (parenRes) {
          const clauses = parenRes.content.split(";");
          const condStr = clauses[1] ? clauses[1].trim() : "true";
          const rest = trimmed.slice(parenRes.endIndex + 1).trim();
          let lineIdx = i;
          let bodyStmts: Statement[] = [];
          if (
            rest === "{" ||
            (!rest &&
              lineIdx + 1 < expandedLines.length &&
              expandedLines[lineIdx + 1].trim().startsWith("{"))
          ) {
            const startAt = rest === "{" ? lineIdx : lineIdx + 1;
            const { bodyLines, nextIdx } = this.collectBracedBlock(expandedLines, startAt);
            bodyStmts = this.parseCSharpBlock(bodyLines);
            lineIdx = nextIdx - 1;
          } else if (rest.startsWith("{")) {
            const { bodyLines, nextIdx } = this.collectBracedBlock(
              [rest, ...expandedLines.slice(lineIdx + 1)],
              0,
            );
            bodyStmts = this.parseCSharpBlock(bodyLines);
            lineIdx += nextIdx - 1;
          } else if (rest && rest !== ";") {
            bodyStmts = this.parseCSharpBlock([rest]);
          } else if (!rest && lineIdx + 1 < expandedLines.length) {
            lineIdx++;
            bodyStmts = this.parseCSharpBlock([expandedLines[lineIdx].trim()]);
          }

          i = lineIdx;
          statements.push({
            kind: "WhileStmt",
            condition: this.parseCSharpExpr(condStr),
            body: {
              kind: "Block",
              statements: bodyStmts,
              span: emptySpan(this.filePath),
            },
            span: emptySpan(this.filePath),
          });
          continue;
        }
      }

      // try { ... } catch (...) { ... } [finally { ... }]
      if (
        trimmed.startsWith("try") &&
        (trimmed === "try" || trimmed.startsWith("try ") || trimmed.startsWith("try{"))
      ) {
        let lineIdx = i;
        const tryRest = trimmed.slice(3).trim();
        let tryStmts: Statement[] = [];
        if (
          tryRest === "{" ||
          (!tryRest &&
            lineIdx + 1 < expandedLines.length &&
            expandedLines[lineIdx + 1].trim().startsWith("{"))
        ) {
          const { bodyLines, nextIdx } = this.collectBracedBlock(expandedLines, lineIdx);
          tryStmts = this.parseCSharpBlock(bodyLines);
          lineIdx = nextIdx - 1;
        } else if (tryRest.startsWith("{")) {
          const { bodyLines, nextIdx } = this.collectBracedBlock(
            [tryRest, ...expandedLines.slice(lineIdx + 1)],
            0,
          );
          tryStmts = this.parseCSharpBlock(bodyLines);
          lineIdx += nextIdx - 1;
        }

        let catchParam = "err";
        let catchStmts: Statement[] | undefined;
        let finallyStmts: Statement[] | undefined;

        while (lineIdx + 1 < expandedLines.length) {
          const nextTrimmed = this.stripLineComment(expandedLines[lineIdx + 1]).trim();
          if (nextTrimmed.startsWith("catch")) {
            lineIdx++;
            const catchRest = nextTrimmed.slice(5).trim();
            const parenRes = catchRest.startsWith("(")
              ? this.extractBalancedParen(catchRest, 0)
              : null;
            if (parenRes) {
              const catchDecl = parenRes.content.trim();
              const words = catchDecl.split(/\s+/);
              if (words.length > 1) {
                catchParam = words[words.length - 1];
              }
            }
            const afterCatch = parenRes ? catchRest.slice(parenRes.endIndex + 1).trim() : catchRest;
            if (
              afterCatch === "{" ||
              (!afterCatch &&
                lineIdx + 1 < expandedLines.length &&
                expandedLines[lineIdx + 1].trim().startsWith("{"))
            ) {
              const { bodyLines, nextIdx } = this.collectBracedBlock(expandedLines, lineIdx);
              catchStmts = this.parseCSharpBlock(bodyLines);
              lineIdx = nextIdx - 1;
            } else if (afterCatch.startsWith("{")) {
              const { bodyLines, nextIdx } = this.collectBracedBlock(
                [afterCatch, ...expandedLines.slice(lineIdx + 1)],
                0,
              );
              catchStmts = this.parseCSharpBlock(bodyLines);
              lineIdx += nextIdx - 1;
            } else {
              catchStmts = [];
            }
          } else if (nextTrimmed.startsWith("finally")) {
            lineIdx++;
            const finRest = nextTrimmed.slice(7).trim();
            if (
              finRest === "{" ||
              (!finRest &&
                lineIdx + 1 < expandedLines.length &&
                expandedLines[lineIdx + 1].trim().startsWith("{"))
            ) {
              const { bodyLines, nextIdx } = this.collectBracedBlock(expandedLines, lineIdx);
              finallyStmts = this.parseCSharpBlock(bodyLines);
              lineIdx = nextIdx - 1;
            } else if (finRest.startsWith("{")) {
              const { bodyLines, nextIdx } = this.collectBracedBlock(
                [finRest, ...expandedLines.slice(lineIdx + 1)],
                0,
              );
              finallyStmts = this.parseCSharpBlock(bodyLines);
              lineIdx += nextIdx - 1;
            } else {
              finallyStmts = [];
            }
            break;
          } else {
            break;
          }
        }

        let finalTryStmts = tryStmts;
        if (this.inClosure && tryStmts.length > 1) {
          finalTryStmts = [
            {
              kind: "ExprStmt",
              expr: {
                kind: "CallExpr",
                callee: {
                  kind: "ClosureExpr",
                  params: [],
                  returnType: null,
                  body: {
                    kind: "Block",
                    statements: tryStmts,
                    span: emptySpan(this.filePath),
                  },
                  span: emptySpan(this.filePath),
                },
                args: [],
                span: emptySpan(this.filePath),
              },
              span: emptySpan(this.filePath),
            },
          ];
        }

        i = lineIdx;
        statements.push({
          kind: "TryStmt",
          tryBlock: { kind: "Block", statements: finalTryStmts, span: emptySpan(this.filePath) },
          catchParam: catchStmts !== undefined ? catchParam : undefined,
          catchBlock:
            catchStmts !== undefined
              ? { kind: "Block", statements: catchStmts, span: emptySpan(this.filePath) }
              : undefined,
          finallyBlock:
            finallyStmts !== undefined
              ? { kind: "Block", statements: finallyStmts, span: emptySpan(this.filePath) }
              : undefined,
          span: emptySpan(this.filePath),
        });
        continue;
      }

      // using (var res = ...) { ... } or using (expr) { ... }
      if (trimmed.startsWith("using") && /using\s*\(/.test(trimmed)) {
        let usingLine = trimmed;
        let lineIdx = i;
        if (
          !usingLine.includes(")") ||
          this.extractBalancedParen(usingLine, usingLine.indexOf("(")) === null
        ) {
          while (lineIdx + 1 < expandedLines.length) {
            lineIdx++;
            usingLine += " " + this.stripLineComment(expandedLines[lineIdx]).trim();
            if (this.extractBalancedParen(usingLine, usingLine.indexOf("(")) !== null) break;
          }
        }

        const parenRes = this.extractBalancedParen(usingLine, usingLine.indexOf("("));
        if (parenRes) {
          const resDecl = parenRes.content.trim();
          const rest = usingLine.slice(parenRes.endIndex + 1).trim();

          let bodyLines: string[] = [];
          if (
            rest === "{" ||
            (!rest &&
              lineIdx + 1 < expandedLines.length &&
              expandedLines[lineIdx + 1].trim().startsWith("{"))
          ) {
            const res = this.collectBracedBlock(expandedLines, lineIdx);
            bodyLines = res.bodyLines;
            lineIdx = res.nextIdx - 1;
          } else if (rest.startsWith("{")) {
            const res = this.collectBracedBlock([rest, ...expandedLines.slice(lineIdx + 1)], 0);
            bodyLines = res.bodyLines;
            lineIdx += res.nextIdx - 1;
          } else if (rest && rest !== ";") {
            bodyLines = [rest];
          } else if (!rest && lineIdx + 1 < expandedLines.length) {
            lineIdx++;
            bodyLines = [expandedLines[lineIdx].trim()];
          }

          i = lineIdx;

          if (resDecl) {
            const declStmt = this.parseCSharpBlock([
              resDecl.endsWith(";") ? resDecl : resDecl + ";",
            ]);
            statements.push(...declStmt);
          }
          if (bodyLines.length > 0) {
            statements.push(...this.parseCSharpBlock(bodyLines));
          }
          continue;
        }
      }

      // switch (expr) { case ...: ... }
      if (
        trimmed.startsWith("switch") &&
        (trimmed.startsWith("switch ") || trimmed.startsWith("switch("))
      ) {
        let switchLine = trimmed;
        let lineIdx = i;
        if (
          !switchLine.includes(")") ||
          this.extractBalancedParen(switchLine, switchLine.indexOf("(")) === null
        ) {
          while (lineIdx + 1 < expandedLines.length) {
            lineIdx++;
            switchLine += " " + this.stripLineComment(expandedLines[lineIdx]).trim();
            if (this.extractBalancedParen(switchLine, switchLine.indexOf("(")) !== null) break;
          }
        }

        const parenRes = this.extractBalancedParen(switchLine, switchLine.indexOf("("));
        if (parenRes) {
          const targetExpr = this.parseCSharpExpr(parenRes.content);
          const rest = switchLine.slice(parenRes.endIndex + 1).trim();

          let bodyLines: string[] = [];
          if (
            rest === "{" ||
            (!rest &&
              lineIdx + 1 < expandedLines.length &&
              expandedLines[lineIdx + 1].trim().startsWith("{"))
          ) {
            const res = this.collectBracedBlock(expandedLines, lineIdx);
            bodyLines = res.bodyLines;
            lineIdx = res.nextIdx - 1;
          } else if (rest.startsWith("{")) {
            const res = this.collectBracedBlock([rest, ...expandedLines.slice(lineIdx + 1)], 0);
            bodyLines = res.bodyLines;
            lineIdx += res.nextIdx - 1;
          }

          i = lineIdx;

          // Parse case and default clauses
          interface SwitchCaseGroup {
            kind: "case" | "default";
            values: string[];
            lines: string[];
          }

          const groups: SwitchCaseGroup[] = [];
          let curGroup: SwitchCaseGroup | null = null;
          let braceDepth = 0;

          for (const bl of bodyLines) {
            const stripped = this.stripLineComment(bl).trim();
            if (!stripped) continue;

            if (braceDepth === 0) {
              const caseLabel = this.parseCSharpCaseLabel(stripped);
              if (caseLabel) {
                if (caseLabel.kind === "case") {
                  if (curGroup && curGroup.lines.length > 0) {
                    groups.push(curGroup);
                    curGroup = { kind: "case", values: [caseLabel.value], lines: [] };
                  } else if (curGroup && curGroup.kind === "case") {
                    curGroup.values.push(caseLabel.value);
                  } else {
                    if (curGroup) groups.push(curGroup);
                    curGroup = { kind: "case", values: [caseLabel.value], lines: [] };
                  }
                  if (caseLabel.rest) {
                    curGroup.lines.push(caseLabel.rest);
                  }
                  continue;
                } else if (caseLabel.kind === "default") {
                  if (curGroup) groups.push(curGroup);
                  curGroup = { kind: "default", values: [], lines: [] };
                  if (caseLabel.rest) {
                    curGroup.lines.push(caseLabel.rest);
                  }
                  continue;
                }
              }
            }

            for (const ch of stripped) {
              if (ch === "{") braceDepth++;
              else if (ch === "}") braceDepth--;
            }

            if (curGroup) {
              curGroup.lines.push(stripped);
            }
          }
          if (curGroup) {
            groups.push(curGroup);
          }

          // Build IfStmt from groups
          let ifStmt: IfStmt | null = null;
          let defaultStmts: Statement[] | undefined;

          for (const g of groups) {
            let cleanLines = g.lines.map((l) => l.trim()).filter((l) => l && l !== "break;");
            if (
              cleanLines.length >= 2 &&
              cleanLines[0] === "{" &&
              cleanLines[cleanLines.length - 1] === "}"
            ) {
              cleanLines = cleanLines.slice(1, -1);
            }
            const caseStmts = this.parseCSharpBlock(cleanLines);

            if (g.kind === "default") {
              defaultStmts = caseStmts;
              continue;
            }

            if (g.values.length === 0) continue;

            let cond: Expr = {
              kind: "BinaryExpr",
              operator: "==",
              left: targetExpr,
              right: this.parseCSharpExpr(g.values[0]),
              span: emptySpan(this.filePath),
            };
            for (let v = 1; v < g.values.length; v++) {
              cond = {
                kind: "BinaryExpr",
                operator: "or",
                left: cond,
                right: {
                  kind: "BinaryExpr",
                  operator: "==",
                  left: targetExpr,
                  right: this.parseCSharpExpr(g.values[v]),
                  span: emptySpan(this.filePath),
                },
                span: emptySpan(this.filePath),
              };
            }

            const bodyBlock: Block = {
              kind: "Block",
              statements: caseStmts,
              span: emptySpan(this.filePath),
            };

            if (!ifStmt) {
              ifStmt = {
                kind: "IfStmt",
                condition: cond,
                thenBranch: bodyBlock,
                elifBranches: [],
                elseBranch: null,
                span: emptySpan(this.filePath),
              };
            } else {
              ifStmt.elifBranches.push({
                condition: cond,
                body: bodyBlock,
                span: emptySpan(this.filePath),
              });
            }
          }

          if (ifStmt) {
            if (defaultStmts !== undefined) {
              ifStmt.elseBranch = {
                kind: "Block",
                statements: defaultStmts,
                span: emptySpan(this.filePath),
              };
            }
            statements.push(ifStmt);
          } else if (defaultStmts) {
            statements.push(...defaultStmts);
          }
          continue;
        }
      }

      // Collect multiline statement until complete
      let stmtLine = trimmed;
      if (!this.isStatementComplete(stmtLine)) {
        let lineIdx = i;
        while (lineIdx + 1 < expandedLines.length) {
          lineIdx++;
          stmtLine += " " + this.stripLineComment(expandedLines[lineIdx]).trim();
          if (this.isStatementComplete(stmtLine)) break;
        }
        i = lineIdx;
      }

      // Split multiple semicolon-separated statements if present
      if (stmtLine.includes(";") && !stmtLine.endsWith(";")) {
        const parts = this.splitBySemicolon(stmtLine);
        if (parts.length > 1) {
          for (const p of parts) {
            if (p.trim()) {
              statements.push(...this.parseCSharpBlock([p.trim()]));
            }
          }
          continue;
        }
      }

      // Local variable declaration: Type a = 1, b = 2; or Type a;
      const local = this.parseLeadingMember(stmtLine);
      if (
        local &&
        !stmtLine.startsWith("this.") &&
        !stmtLine.startsWith("return") &&
        !stmtLine.startsWith("case") &&
        !stmtLine.startsWith("throw") &&
        !stmtLine.startsWith("yield") &&
        (local.remainder.startsWith("=") ||
          local.remainder.startsWith(";") ||
          local.remainder.startsWith(","))
      ) {
        const cleanRemainder = local.remainder.replace(/;$/, "").trim();
        // Split comma-separated declarations (e.g. "= 1, b = 2, c = 3")
        const decls: Array<{ name: string; initStr: string | null }> = [];
        if (cleanRemainder.startsWith("=")) {
          const afterEq = cleanRemainder.slice(1).trim();
          const parts = this.splitArgs(afterEq);
          decls.push({ name: local.name, initStr: parts[0] });
          for (let pi = 1; pi < parts.length; pi++) {
            const p = parts[pi].trim();
            const eqIdx = p.indexOf("=");
            if (eqIdx !== -1) {
              decls.push({ name: p.slice(0, eqIdx).trim(), initStr: p.slice(eqIdx + 1).trim() });
            } else {
              decls.push({ name: p, initStr: null });
            }
          }
        } else if (cleanRemainder.startsWith(",")) {
          decls.push({ name: local.name, initStr: null });
          const parts = this.splitArgs(cleanRemainder.slice(1).trim());
          for (const p of parts) {
            const eqIdx = p.indexOf("=");
            if (eqIdx !== -1) {
              decls.push({ name: p.slice(0, eqIdx).trim(), initStr: p.slice(eqIdx + 1).trim() });
            } else {
              decls.push({ name: p.trim(), initStr: null });
            }
          }
        } else {
          decls.push({ name: local.name, initStr: null });
        }

        for (const d of decls) {
          statements.push({
            kind: "LetBinding",
            name: d.name,
            typeAnnotation: null,
            init: d.initStr
              ? this.parseCSharpExpr(d.initStr)
              : {
                  kind: "LiteralExpr",
                  literalKind: "nil",
                  value: null,
                  rawValue: "nil",
                  span: emptySpan(this.filePath),
                },
            isMut: true,
            span: emptySpan(this.filePath),
          });
        }
        continue;
      }

      // Increment/decrement statement: target++; or ++target;
      const incMatch = stmtLine.match(/^(\+\+|--)?([a-zA-Z0-9_.[\]]+)(\+\+|--)?;$/);
      if (incMatch && (incMatch[1] || incMatch[3])) {
        const op = (incMatch[1] || incMatch[3]) === "++" ? "+=" : "-=";
        const target = incMatch[2].trim();
        statements.push({
          kind: "AssignStmt",
          target: this.parseCSharpExpr(target),
          op: op as AssignOp,
          value: {
            kind: "LiteralExpr",
            literalKind: "number",
            value: 1,
            rawValue: "1",
            span: emptySpan(this.filePath),
          },
          span: emptySpan(this.filePath),
        });
        continue;
      }

      // Assignment: target = expr; or target += expr;
      const assignMatch = stmtLine.match(
        /^([a-zA-Z0-9_.[\]\s,]+?)\s*(\+=|-=|\*=|\/=|%=|=)\s*(.+?);$/,
      );
      if (assignMatch) {
        const target = assignMatch[1].trim();
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
      const exprStr = stmtLine.replace(/;$/, "").trim();
      if (exprStr) {
        statements.push({
          kind: "ExprStmt",
          expr: this.parseCSharpExpr(exprStr),
          span: emptySpan(this.filePath),
        });
      }
    }

    return statements;
  }

  public parseCSharpExpr(exprStr: string): Expr {
    let s = exprStr.trim();
    if (!s) {
      return {
        kind: "LiteralExpr",
        literalKind: "nil",
        value: null,
        rawValue: "nil",
        span: emptySpan(this.filePath),
      };
    }

    // Strip C# out / ref parameter modifiers: out int x -> x, out SfxClip[] set -> set, ref x -> x
    s = s.replace(/^(?:out|ref)\s+(?:[a-zA-Z0-9_<>[\]?]+\s+)?/, "").trim();

    // Strip C# named arguments: godMode: true -> true
    const namedArgMatch = s.match(/^([a-zA-Z0-9_]+)\s*:\s*(.+)$/);
    if (namedArgMatch && !this.findTernaryIndices(s)) {
      s = namedArgMatch[2].trim();
    }

    // Strip redundant outer parentheses if balanced across entire expr
    while (s.startsWith("(") && s.endsWith(")")) {
      const parenRes = this.extractBalancedParen(s, 0);
      if (parenRes && parenRes.endIndex === s.length - 1) {
        s = parenRes.content.trim();
      } else {
        break;
      }
    }

    // Unwrap C-style casts: (float)x, (int)x, (double?)x, (ulong)x, etc.
    const castMatch = s.match(
      /^\((?:int|long|float|double|uint|ulong|short|ushort|byte|sbyte|char|bool|[A-Z][a-zA-Z0-9_]*)\??\)\s*(.+)$/,
    );
    if (castMatch) {
      return this.parseCSharpExpr(castMatch[1]);
    }

    // Strip ++ or -- prefix/suffix
    s = s
      .replace(/^\+\+|^--/, "")
      .replace(/\+\+$|--$/, "")
      .trim();

    // String literal: regular and verbatim
    const regularStrMatch = s.match(/^"(?:\\.|[^"\\])*"$/);
    if (regularStrMatch) {
      return {
        kind: "LiteralExpr",
        literalKind: "string",
        value: s.slice(1, -1),
        rawValue: s,
        span: emptySpan(this.filePath),
      };
    }
    const verbatimStrMatch = s.match(/^@"(?:""|[^"])*"$/);
    if (verbatimStrMatch) {
      const unescaped = s.slice(2, -1).replace(/""/g, '"');
      return {
        kind: "LiteralExpr",
        literalKind: "string",
        value: unescaped,
        rawValue: JSON.stringify(unescaped),
        span: emptySpan(this.filePath),
      };
    }

    // Interpolated string literal: $"..." or $@"...":
    const interpolated = this.parseInterpolatedString(s);
    if (interpolated) {
      return interpolated;
    }

    // Char literal
    const charMatch = s.match(/^'(?:\\.|[^'\\])'$/);
    if (charMatch) {
      return {
        kind: "LiteralExpr",
        literalKind: "string",
        value: s.slice(1, -1),
        rawValue: JSON.stringify(s.slice(1, -1)),
        span: emptySpan(this.filePath),
      };
    }

    // Number literal (support f, ULL, LL, L, U suffixes)
    const cleanNum = s.replace(/(?:ULL|LL|UL|f|F|d|D|m|M|L|U)$/, "");
    if (/^-?[0-9]+(\.[0-9]+)?$/.test(cleanNum) || /^0x[0-9a-fA-F]+$/i.test(cleanNum)) {
      return {
        kind: "LiteralExpr",
        literalKind: "number",
        value: Number(cleanNum),
        rawValue: cleanNum,
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

    // null / default
    if (s === "null" || s === "default") {
      return {
        kind: "LiteralExpr",
        literalKind: "nil",
        value: null,
        rawValue: "nil",
        span: emptySpan(this.filePath),
      };
    }

    // Array allocation: new Type[size] (without { ... })
    const arrayAllocMatch = s.match(/^new\s+([a-zA-Z0-9_<>?[\]\s]+)\[([^\]]*)\]$/);
    if (arrayAllocMatch) {
      return {
        kind: "ArrayLiteralExpr",
        elements: [],
        span: emptySpan(this.filePath),
      };
    }

    // Object initializer: new ClassName(...) { Prop = Val, ... }
    const objInitMatch = s.match(/^new\s+([a-zA-Z0-9_.]+)(?:\([^)]*\))?\s*\{([\s\S]*)\}$/);
    if (objInitMatch && !s.includes("get;") && !s.includes("set;")) {
      const inner = objInitMatch[2].trim();
      if (inner.includes("=")) {
        const propParts = this.splitArgs(inner);
        const properties: RecordProperty[] = [];
        for (const part of propParts) {
          const eqIdx = part.indexOf("=");
          if (eqIdx !== -1) {
            const key = part.slice(0, eqIdx).trim();
            const valStr = part.slice(eqIdx + 1).trim();
            properties.push({
              key,
              value: this.parseCSharpExpr(valStr),
              isSpread: false,
              span: emptySpan(this.filePath),
            });
          }
        }
        return {
          kind: "RecordLiteralExpr",
          properties,
          span: emptySpan(this.filePath),
        };
      }
    }

    // Array / Collection literal: new Type[] { ... }, new[] { ... }, or { ... }
    const newArrayMatch = s.match(/^(?:new\s+(?:[a-zA-Z0-9_<>?[\]]+\s*)?)?\{([\s\S]*)\}$/);
    if (newArrayMatch && !s.includes("=") && !s.includes("get;")) {
      const inner = newArrayMatch[1].trim();
      const elements = inner ? this.splitArgs(inner).map((e) => this.parseCSharpExpr(e)) : [];
      return {
        kind: "ArrayLiteralExpr",
        elements,
        span: emptySpan(this.filePath),
      };
    }

    // new List<T>() or new HashSet<T>() or new Dictionary<K, V>()
    if (/^new\s+(?:List|IList|IEnumerable|Dictionary|HashSet)<[^>]+>\s*\(\s*\)$/.test(s)) {
      return {
        kind: "ArrayLiteralExpr",
        elements: [],
        span: emptySpan(this.filePath),
      };
    }

    // new Dictionary<...>() { { "k", v }, ... }
    if (s.startsWith("new Dictionary<")) {
      return {
        kind: "ArrayLiteralExpr",
        elements: [],
        span: emptySpan(this.filePath),
      };
    }

    // Lambda / anonymous function: () => { ... } or (x) => expr or x => expr
    const arrowIdx = this.findOperatorIndex(s, "=>");
    if (arrowIdx !== -1) {
      const left = s.slice(0, arrowIdx).trim();
      const right = s.slice(arrowIdx + 2).trim();
      const params = this.parseCSharpParams(left.replace(/^\(/, "").replace(/\)$/, ""));

      let body: Block | Expr;
      if (right.startsWith("{") && right.endsWith("}")) {
        const inner = right.slice(1, -1);
        const prevInClosure = this.inClosure;
        this.inClosure = true;
        body = {
          kind: "Block",
          statements: this.parseCSharpBlock(inner.split(/\r?\n/)),
          span: emptySpan(this.filePath),
        };
        this.inClosure = prevInClosure;
      } else {
        body = this.parseCSharpExpr(right);
      }

      return {
        kind: "ClosureExpr",
        params,
        returnType: null,
        body,
        span: emptySpan(this.filePath),
      };
    }

    // new ClassName<...>(args) or new ClassName(args)
    const newGenericCallMatch = s.match(/^new\s+([a-zA-Z0-9_.]+)(?:<[^>]+>)?\s*\((.*)\)$/);
    if (newGenericCallMatch) {
      const className = newGenericCallMatch[1];
      const argsRaw = newGenericCallMatch[2];
      const args = this.splitArgs(argsRaw).map((a) => this.parseCSharpExpr(a));
      return {
        kind: "CallExpr",
        callee: {
          kind: "IdentifierExpr",
          name: className,
          span: emptySpan(this.filePath),
        },
        args,
        span: emptySpan(this.filePath),
      };
    }

    // Ternary expression: cond ? whenTrue : whenFalse
    const ternaryIndices = this.findTernaryIndices(s);
    if (ternaryIndices) {
      const condStr = s.slice(0, ternaryIndices.questionIdx).trim();
      const whenTrueStr = s.slice(ternaryIndices.questionIdx + 1, ternaryIndices.colonIdx).trim();
      const whenFalseStr = s.slice(ternaryIndices.colonIdx + 1).trim();

      return {
        kind: "BinaryExpr",
        operator: "or",
        left: {
          kind: "BinaryExpr",
          operator: "and",
          left: this.parseCSharpExpr(condStr),
          right: this.parseCSharpExpr(whenTrueStr),
          span: emptySpan(this.filePath),
        },
        right: this.parseCSharpExpr(whenFalseStr),
        span: emptySpan(this.filePath),
      };
    }

    // Binary expressions
    for (const op of [
      "||",
      "&&",
      "==",
      "!=",
      ">>>",
      ">>",
      "<<",
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
    if (s.endsWith(")") && s.includes("(")) {
      const openIdx = this.findMatchingOpenParen(s);
      if (openIdx > 0) {
        const calleeStr = s.slice(0, openIdx).trim();
        const argsRaw = s.slice(openIdx + 1, s.length - 1);
        const args = this.splitArgs(argsRaw).map((a) => this.parseCSharpExpr(a));

        // new ClassName(args)
        const newMatch = calleeStr.match(/^new\s+([a-zA-Z0-9_.]+)(?:<[^>]+>)?$/);
        if (newMatch) {
          return {
            kind: "CallExpr",
            callee: {
              kind: "IdentifierExpr",
              name: newMatch[1],
              span: emptySpan(this.filePath),
            },
            args,
            span: emptySpan(this.filePath),
          };
        }

        return {
          kind: "CallExpr",
          callee: this.parseCSharpExpr(calleeStr),
          args,
          span: emptySpan(this.filePath),
        };
      }
    }

    // Member access: obj.prop or obj?.prop
    const dotRes = this.findLastMemberDot(s);
    if (dotRes && dotRes.dotIdx > 0 && dotRes.dotIdx < s.length - 1) {
      const objStr = s.slice(0, dotRes.isSafeNav ? dotRes.dotIdx - 1 : dotRes.dotIdx).trim();
      const propStr = s.slice(dotRes.dotIdx + 1).trim();
      if (/^[a-zA-Z0-9_]+$/.test(propStr) && objStr.length > 0) {
        return {
          kind: "MemberAccessExpr",
          object: this.parseCSharpExpr(objStr),
          property: propStr,
          isSafeNav: dotRes.isSafeNav,
          isOptional: false,
          span: emptySpan(this.filePath),
        };
      }
    }

    // Array index: obj[idx] or multidimensional obj[i, j] -> obj[i][j]
    const indexMatch = s.match(/^([a-zA-Z0-9_.]+?)\[(.+)\]$/);
    if (indexMatch) {
      const indices = this.splitArgs(indexMatch[2]);
      let objExpr = this.parseCSharpExpr(indexMatch[1]);
      for (const idx of indices) {
        objExpr = {
          kind: "IndexExpr",
          object: objExpr,
          index: this.parseCSharpExpr(idx),
          span: emptySpan(this.filePath),
        };
      }
      return objExpr;
    }

    // Identifier fallback
    return {
      kind: "IdentifierExpr",
      name: s,
      span: emptySpan(this.filePath),
    };
  }

  private findTernaryIndices(s: string): { questionIdx: number; colonIdx: number } | null {
    let parenDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;
    let inString = false;
    let questionIdx = -1;

    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if ((c === '"' || c === "'") && (i === 0 || s[i - 1] !== "\\")) {
        inString = !inString;
        continue;
      }
      if (inString) continue;

      if (c === "(") parenDepth++;
      else if (c === ")") parenDepth--;
      else if (c === "[") bracketDepth++;
      else if (c === "]") bracketDepth--;
      else if (c === "{") braceDepth++;
      else if (c === "}") braceDepth--;

      if (parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
        if (c === "?" && s[i + 1] !== "?" && s[i + 1] !== "." && (i === 0 || s[i - 1] !== "?")) {
          if (questionIdx === -1) {
            questionIdx = i;
          }
        } else if (c === ":" && questionIdx !== -1) {
          return { questionIdx, colonIdx: i };
        }
      }
    }
    return null;
  }

  private findOperatorIndex(expr: string, op: string): number {
    let parenDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;
    let inString = false;
    let quoteChar = "";

    for (let i = expr.length - 1; i >= 0; i--) {
      const char = expr[i];
      if (char === '"' || char === "'") {
        let backslashCount = 0;
        let k = i - 1;
        while (k >= 0 && expr[k] === "\\") {
          backslashCount++;
          k--;
        }
        if (backslashCount % 2 === 0) {
          if (!inString) {
            inString = true;
            quoteChar = char;
          } else if (quoteChar === char) {
            inString = false;
          }
        }
      }
      if (inString) continue;

      if (char === ")") parenDepth++;
      else if (char === "(") parenDepth--;
      else if (char === "]") bracketDepth++;
      else if (char === "[") bracketDepth--;
      else if (char === "}") braceDepth++;
      else if (char === "{") braceDepth--;

      if (
        i <= expr.length - op.length &&
        parenDepth === 0 &&
        bracketDepth === 0 &&
        braceDepth === 0 &&
        expr.slice(i, i + op.length) === op
      ) {
        return i;
      }
    }
    return -1;
  }

  private splitArgs(argsStr: string): string[] {
    const args: string[] = [];
    let cur = "";
    let parenDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;
    let genericDepth = 0;
    let inString = false;

    for (let i = 0; i < argsStr.length; i++) {
      const c = argsStr[i];
      if (c === '"' && (i === 0 || argsStr[i - 1] !== "\\")) {
        inString = !inString;
        cur += c;
        continue;
      }
      if (inString) {
        cur += c;
        continue;
      }

      if (c === "(") parenDepth++;
      else if (c === ")") parenDepth--;
      else if (c === "[") bracketDepth++;
      else if (c === "]") bracketDepth--;
      else if (c === "{") braceDepth++;
      else if (c === "}") braceDepth--;
      else if (
        c === "<" &&
        argsStr[i + 1] !== "=" &&
        (i === 0 || argsStr[i - 1] !== "=") &&
        i > 0 &&
        /[a-zA-Z0-9_>]/.test(argsStr[i - 1]) &&
        i + 1 < argsStr.length &&
        /[a-zA-Z_]/.test(argsStr[i + 1])
      ) {
        genericDepth++;
      } else if (
        c === ">" &&
        genericDepth > 0 &&
        (i === 0 || (argsStr[i - 1] !== "=" && argsStr[i - 1] !== "-"))
      ) {
        genericDepth--;
      }

      if (
        c === "," &&
        parenDepth === 0 &&
        bracketDepth === 0 &&
        braceDepth === 0 &&
        genericDepth === 0
      ) {
        if (cur.trim()) args.push(cur.trim());
        cur = "";
      } else {
        cur += c;
      }
    }

    if (cur.trim()) args.push(cur.trim());
    return args;
  }

  private parseCSharpParams(paramsRaw: string): ParamDecl[] {
    if (!paramsRaw.trim()) return [];
    return this.splitArgs(paramsRaw)
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => {
        let clean = p
          .replace(/^params\s+/, "")
          .replace(/^out\s+/, "")
          .replace(/^ref\s+/, "")
          .replace(/^in\s+/, "");
        let defaultValue: Expr | undefined;
        if (clean.includes("=")) {
          const eqIdx = clean.indexOf("=");
          defaultValue = this.parseCSharpExpr(clean.slice(eqIdx + 1).trim());
          clean = clean.slice(0, eqIdx).trim();
        }
        const mem = this.parseLeadingMember(clean);
        if (mem) {
          return {
            kind: "ParamDecl" as const,
            name: mem.name,
            typeAnnotation: this.parseCSharpType(mem.typeStr),
            defaultValue,
            span: emptySpan(this.filePath),
          };
        }
        const parts = clean.split(/\s+/);
        const name = parts[parts.length - 1];
        const typeStr = parts.slice(0, -1).join(" ");
        return {
          kind: "ParamDecl" as const,
          name,
          typeAnnotation: typeStr ? this.parseCSharpType(typeStr) : null,
          defaultValue,
          span: emptySpan(this.filePath),
        };
      });
  }

  private extractBalancedParen(
    str: string,
    openIndex: number,
  ): { content: string; endIndex: number } | null {
    if (str[openIndex] !== "(") return null;
    let depth = 1;
    let inString = false;
    const start = openIndex + 1;

    for (let i = start; i < str.length; i++) {
      const c = str[i];
      if (c === '"' && (i === 0 || str[i - 1] !== "\\")) {
        inString = !inString;
        continue;
      }
      if (inString) continue;

      if (c === "(") depth++;
      else if (c === ")") {
        depth--;
        if (depth === 0) {
          return { content: str.slice(start, i), endIndex: i };
        }
      }
    }
    return null;
  }

  private parseCSharpType(typeStr: string): TypeExpr {
    const clean = typeStr
      .trim()
      .replace(/^readonly\s+/, "")
      .replace(/^ref\s+/, "")
      .replace(/^out\s+/, "")
      .replace(/^in\s+/, "")
      .replace(/^const\s+/, "");

    // C# primitives to AICE types
    switch (clean) {
      case "int":
      case "uint":
      case "short":
      case "ushort":
      case "byte":
      case "sbyte":
      case "long":
      case "ulong":
        return {
          kind: "NamedType",
          name: "int",
          typeArgs: [],
          span: emptySpan(this.filePath),
        };
      case "float":
      case "double":
      case "decimal":
        return {
          kind: "NamedType",
          name: "num",
          typeArgs: [],
          span: emptySpan(this.filePath),
        };
      case "string":
        return {
          kind: "NamedType",
          name: "str",
          typeArgs: [],
          span: emptySpan(this.filePath),
        };
      case "bool":
        return {
          kind: "NamedType",
          name: "bool",
          typeArgs: [],
          span: emptySpan(this.filePath),
        };
      case "void":
        return {
          kind: "NamedType",
          name: "void",
          typeArgs: [],
          span: emptySpan(this.filePath),
        };
      case "object":
        return {
          kind: "NamedType",
          name: "any",
          typeArgs: [],
          span: emptySpan(this.filePath),
        };
      case "Result":
        return {
          kind: "ResultType",
          okType: { kind: "NamedType", name: "any", typeArgs: [], span: emptySpan(this.filePath) },
          errType: { kind: "NamedType", name: "any", typeArgs: [], span: emptySpan(this.filePath) },
          span: emptySpan(this.filePath),
        };
    }

    // 2D Array type: T[,]
    if (clean.endsWith("[,]")) {
      const elemTypeStr = clean.slice(0, -3);
      return {
        kind: "ArrayType",
        elementType: {
          kind: "ArrayType",
          elementType: this.parseCSharpType(elemTypeStr),
          span: emptySpan(this.filePath),
        },
        span: emptySpan(this.filePath),
      };
    }

    // Array type: T[]
    if (clean.endsWith("[]")) {
      const elemTypeStr = clean.slice(0, -2);
      return {
        kind: "ArrayType",
        elementType: this.parseCSharpType(elemTypeStr),
        span: emptySpan(this.filePath),
      };
    }

    // Nullable: T?
    if (clean.endsWith("?") && clean.length > 1) {
      const innerTypeStr = clean.slice(0, -1);
      return {
        kind: "OptionType",
        innerType: this.parseCSharpType(innerTypeStr),
        span: emptySpan(this.filePath),
      };
    }

    // Generic types Name<T1, T2>
    const genMatch = clean.match(/^([a-zA-Z0-9_.]+)<(.+)>$/);
    if (genMatch) {
      const baseName = genMatch[1];
      const typeArgsRaw = genMatch[2];

      if (
        baseName === "List" ||
        baseName === "IList" ||
        baseName === "IEnumerable" ||
        baseName === "HashSet" ||
        baseName === "ISet"
      ) {
        return {
          kind: "ArrayType",
          elementType: this.parseCSharpType(typeArgsRaw),
          span: emptySpan(this.filePath),
        };
      }

      if (baseName === "Nullable") {
        return {
          kind: "OptionType",
          innerType: this.parseCSharpType(typeArgsRaw),
          span: emptySpan(this.filePath),
        };
      }

      const typeArgs = this.splitArgs(typeArgsRaw).map((a) => this.parseCSharpType(a));
      return {
        kind: "NamedType",
        name: baseName,
        typeArgs,
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
