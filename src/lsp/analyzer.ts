/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Real-time In-Memory AIL Document Analyzer & Intelligence Engine.
 * Powers Diagnostics, Hover Cards, and Contextual Autocompletions.
 */

import type { Module } from "../core/ast.js";
import { parse } from "../core/parser.js";
import type { Span } from "../core/span.js";
import { TypeChecker } from "../typechecker/checker.js";
import { buildReportFromError } from "../typechecker/diagnostics.js";
import {
  type CompletionItem,
  CompletionItemKind,
  type Diagnostic,
  DiagnosticSeverity,
  type Hover,
  type Position,
} from "./protocol.js";

export interface AnalyzedDocument {
  uri: string;
  text: string;
  ast?: Module;
  diagnostics: Diagnostic[];
}

export class AilAnalyzer {
  private documents = new Map<string, AnalyzedDocument>();

  public setDocument(uri: string, text: string): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    let ast: Module | undefined;

    try {
      ast = parse(text, uri);
      const tc = new TypeChecker();
      tc.checkModule(ast);
    } catch (err) {
      const report = buildReportFromError(err, text, uri);
      for (const diag of report.diagnostics) {
        let message = diag.violation.message;
        if (diag.candidate_repair) {
          message += `\n\nSuggestion:\n${diag.candidate_repair.patch}`;
        }

        diagnostics.push({
          range: {
            start: {
              line: Math.max(0, diag.span.start.line - 1),
              character: Math.max(0, diag.span.start.column - 1),
            },
            end: {
              line: Math.max(0, diag.span.end.line - 1),
              character: Math.max(0, diag.span.end.column - 1),
            },
          },
          severity: DiagnosticSeverity.Error,
          code: diag.violation.code,
          source: "ail",
          message,
        });
      }
    }

    this.documents.set(uri, { uri, text, ast, diagnostics });
    return diagnostics;
  }

  public getDocument(uri: string): AnalyzedDocument | undefined {
    return this.documents.get(uri);
  }

  public removeDocument(uri: string): void {
    this.documents.delete(uri);
  }

  public getHover(uri: string, position: Position): Hover | null {
    const doc = this.documents.get(uri);
    if (!doc) return null;

    const line = doc.text.split("\n")[position.line] ?? "";
    const word = this.getWordAt(line, position.character);
    if (!word) return null;

    // 1. Primitive types
    const primitiveDocs: Record<string, string> = {
      int: "**Primitive Type `int`**: 64-bit signed integer. 1 BPE token in modern LLM vocabularies.",
      str: "**Primitive Type `str`**: UTF-8 immutable string. 1 BPE token in modern LLM vocabularies.",
      float: "**Primitive Type `float`**: 64-bit IEEE 754 floating point number.",
      num: "**Primitive Type `num`**: Universal numeric type (erases to `number` in JS/TS).",
      bool: "**Primitive Type `bool`**: Boolean value (`true` or `false`).",
      byte: "**Primitive Type `byte`**: 8-bit unsigned integer.",
      char: "**Primitive Type `char`**: Single Unicode scalar value.",
      void: "**Primitive Type `void`**: Unit type indicating no returned value.",
      nil: "**Primitive Type `nil`**: Absence of value or null pointer.",
      Option: "**Container Type `Option[T]`**: Algebraic optional value (`Some(T)` or `nil`).",
      Result:
        "**Container Type `Result[T, E]`**: Algebraic fallible result (`Ok(T)` or `Err(E)`). Use postfix `?` to unwrap safely.",
    };

    if (primitiveDocs[word]) {
      return {
        contents: {
          kind: "markdown",
          value: primitiveDocs[word],
        },
      };
    }

    // 2. Keywords
    const keywordDocs: Record<string, string> = {
      module: "**Keyword `module`**: Declares the canonical module namespace path.",
      from: "**Keyword `from`**: Specifies module dependency source path for imports.",
      import: "**Keyword `import`**: Imports symbols from an external module.",
      type: "**Keyword `type`**: Defines a strongly-typed record contract, enum, or type alias.",
      fn: "**Keyword `fn`**: Declares a function. Supports both block bodies (`:`) and single-expression bodies (`=`).",
      component:
        "**Keyword `component`**: Declares a declarative UI component with an indented layout tree.",
      style:
        "**Keyword `style`**: Declares a CSS stylesheet rule with zero-quote modern properties.",
      let: "**Keyword `let`**: Declares an immutable local variable binding.",
      mut: "**Keyword `mut`**: Declares a mutable variable binding (`let mut x = ...`).",
      ret: "**Keyword `ret`**: Explicitly returns a value from a function. In block functions, trailing expressions can omit `ret`.",
      if: "**Keyword `if`**: Boolean conditional branch.",
      elif: "**Keyword `elif`**: Else-if conditional branch.",
      else: "**Keyword `else`**: Fallback conditional branch.",
      match: "**Keyword `match`**: Pattern matching on algebraic sum types and literals.",
      case: "**Keyword `case`**: Pattern match clause (`case Pattern => expr`).",
    };

    if (keywordDocs[word]) {
      return {
        contents: {
          kind: "markdown",
          value: keywordDocs[word],
        },
      };
    }

    // 3. User-defined symbols in AST
    if (doc.ast) {
      for (const item of doc.ast.items) {
        if (item.kind === "TypeDecl" && item.name === word) {
          const fields =
            item.fields?.map((f) => `- \`${f.name}\`: \`${this.formatSpan(f.span)}\``) ?? [];
          const variants = item.variants?.map((v) => `- \`${v.name}\``) ?? [];
          const desc = item.isEnum
            ? `**Enum \`${word}\`**:\n${variants.join("\n")}`
            : `**Type \`${word}\`**:\n${fields.join("\n")}`;
          return {
            contents: {
              kind: "markdown",
              value: desc,
            },
          };
        }

        if (item.kind === "FunctionDecl" && item.name === word) {
          const params = item.params.map((p) => `${p.name}`).join(", ");
          return {
            contents: {
              kind: "markdown",
              value: `\`\`\`ail\nfn ${item.name}(${params})\n\`\`\`\nFunction declaration in module \`${doc.ast.path}\`.`,
            },
          };
        }

        if (item.kind === "ComponentDecl" && item.name === word) {
          const params = item.params.map((p) => `${p.name}`).join(", ");
          return {
            contents: {
              kind: "markdown",
              value: `\`\`\`ail\ncomponent ${item.name}(${params})\n\`\`\`\nDeclarative UI component.`,
            },
          };
        }
      }
    }

    return null;
  }

  public getCompletions(uri: string, position: Position): CompletionItem[] {
    const doc = this.documents.get(uri);
    const line = doc ? (doc.text.split("\n")[position.line] ?? "") : "";
    const prefix = line.slice(0, position.character);

    // 1. Dot-access canonical completions: obj.
    if (prefix.trimEnd().endsWith(".")) {
      return [
        { label: "length", kind: CompletionItemKind.Property, detail: "Length of string or array" },
        {
          label: "slice",
          kind: CompletionItemKind.Method,
          detail: "slice(start, end) -> str | [T]",
          // biome-ignore lint/suspicious/noTemplateCurlyInString: Standard LSP snippet syntax
          insertText: "slice(${1:start}, ${2:end})",
        },
        {
          label: "trim",
          kind: CompletionItemKind.Method,
          detail: "trim() -> str",
          insertText: "trim()",
        },
        {
          label: "toUpper",
          kind: CompletionItemKind.Method,
          detail: "toUpper() -> str",
          insertText: "toUpper()",
        },
        {
          label: "toLower",
          kind: CompletionItemKind.Method,
          detail: "toLower() -> str",
          insertText: "toLower()",
        },
        {
          label: "contains",
          kind: CompletionItemKind.Method,
          detail: "contains(sub:str) -> bool",
          // biome-ignore lint/suspicious/noTemplateCurlyInString: Standard LSP snippet syntax
          insertText: "contains(${1:sub})",
        },
        {
          label: "append",
          kind: CompletionItemKind.Method,
          detail: "append(item:T) -> [T]",
          // biome-ignore lint/suspicious/noTemplateCurlyInString: Standard LSP snippet syntax
          insertText: "append(${1:item})",
        },
        {
          label: "isEmpty",
          kind: CompletionItemKind.Method,
          detail: "isEmpty() -> bool",
          insertText: "isEmpty()",
        },
        {
          label: "isOk",
          kind: CompletionItemKind.Method,
          detail: "isOk() -> bool",
          insertText: "isOk()",
        },
        {
          label: "isErr",
          kind: CompletionItemKind.Method,
          detail: "isErr() -> bool",
          insertText: "isErr()",
        },
        {
          label: "unwrap",
          kind: CompletionItemKind.Method,
          detail: "unwrap() -> T",
          insertText: "unwrap()",
        },
      ];
    }

    const completions: CompletionItem[] = [];

    // 2. Keywords
    const keywords = [
      "module",
      "from",
      "import",
      "type",
      "fn",
      "component",
      "style",
      "let",
      "mut",
      "ret",
      "if",
      "elif",
      "else",
      "match",
      "case",
      "for",
      "in",
      "while",
    ];
    for (const kw of keywords) {
      completions.push({
        label: kw,
        kind: CompletionItemKind.Keyword,
        detail: "AIL Keyword",
      });
    }

    // 3. Built-in types
    const types = [
      "int",
      "str",
      "float",
      "bool",
      "num",
      "byte",
      "char",
      "void",
      "nil",
      "Option",
      "Result",
    ];
    for (const t of types) {
      completions.push({
        label: t,
        kind: CompletionItemKind.Class,
        detail: "AIL Builtin Type",
      });
    }

    // 4. Module symbols
    if (doc?.ast) {
      for (const item of doc.ast.items) {
        if (item.kind === "TypeDecl") {
          completions.push({
            label: item.name,
            kind: item.isEnum ? CompletionItemKind.Enum : CompletionItemKind.Interface,
            detail: `Type in ${doc.ast.path}`,
          });
        } else if (item.kind === "FunctionDecl") {
          completions.push({
            label: item.name,
            kind: CompletionItemKind.Function,
            detail: `fn in ${doc.ast.path}`,
          });
        } else if (item.kind === "ComponentDecl") {
          completions.push({
            label: item.name,
            kind: CompletionItemKind.Class,
            detail: `component in ${doc.ast.path}`,
          });
        }
      }
    }

    return completions;
  }

  private getWordAt(line: string, index: number): string | null {
    if (index < 0 || index > line.length) return null;
    const isIdent = (ch: string) => /[a-zA-Z0-9_]/.test(ch);

    let start = index;
    while (start > 0 && isIdent(line[start - 1])) {
      start--;
    }

    let end = index;
    while (end < line.length && isIdent(line[end])) {
      end++;
    }

    if (start === end) return null;
    return line.slice(start, end);
  }

  private formatSpan(span: Span): string {
    return `${span.file}:${span.start.line}:${span.start.column}`;
  }
}
