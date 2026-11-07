/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Real-time In-Memory AICE Document Analyzer & Intelligence Engine.
 * Powers Diagnostics, Hover Cards, and Contextual Autocompletions.
 */

import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { findProjectRoot, loadProjectConfig } from "../config/index.js";
import type { ProjectIdiomDefinition } from "../config/project-config.js";
import type { Module } from "../core/ast.js";
import { parse } from "../core/parser.js";
import type { Span } from "../core/span.js";
import { expandModuleIdioms } from "../idioms/index.js";
import { formatAiceSource } from "../tools/fmt.js";
import { TypeChecker } from "../typechecker/checker.js";
import { attemptSelfRepair, buildReportFromError } from "../typechecker/diagnostics.js";
import {
  type CodeAction,
  type CompletionItem,
  CompletionItemKind,
  type Diagnostic,
  DiagnosticSeverity,
  type DocumentSymbol,
  type Hover,
  type Location,
  type Position,
  type Range,
  SymbolKind,
  type TextEdit,
} from "./protocol.js";

export interface AnalyzedDocument {
  uri: string;
  text: string;
  ast?: Module;
  diagnostics: Diagnostic[];
}

export class AiceAnalyzer {
  private documents = new Map<string, AnalyzedDocument>();
  private idioms?: Record<string, ProjectIdiomDefinition>;

  public setIdioms(idioms: Record<string, ProjectIdiomDefinition>): void {
    this.idioms = idioms;
  }

  public getIdiomsForUri(uri: string): Record<string, ProjectIdiomDefinition> {
    if (this.idioms && Object.keys(this.idioms).length > 0) {
      return this.idioms;
    }
    try {
      let filePath: string;
      if (uri.startsWith("file://")) {
        filePath = fileURLToPath(uri);
      } else {
        filePath = uri;
      }
      const dir = path.dirname(filePath);
      if (!dir || dir === path.parse(dir).root) {
        return {};
      }
      const root = findProjectRoot(dir);
      if (!root || root === path.parse(root).root) {
        return {};
      }
      const config = loadProjectConfig(root);
      return config.idioms ?? {};
    } catch {
      return {};
    }
  }

  public setDocument(uri: string, text: string): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    let ast: Module | undefined;

    try {
      ast = parse(text, uri);
      const idioms =
        text.includes("$") || (this.idioms && Object.keys(this.idioms).length > 0)
          ? this.getIdiomsForUri(uri)
          : {};
      const expandedAst =
        idioms && Object.keys(idioms).length > 0 ? expandModuleIdioms(ast, idioms) : ast;
      const tc = new TypeChecker();
      tc.checkModule(expandedAst);
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
          source: "aice",
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

    // 0. Project Idioms ($idiom)
    const idioms = this.getIdiomsForUri(uri);
    const cleanWord = word.replace(/^\$/, "");
    const idiomDef =
      word.startsWith("$") || word in idioms || cleanWord in idioms
        ? (idioms[word] ?? idioms[cleanWord] ?? idioms[`$${cleanWord}`])
        : undefined;

    if (idiomDef) {
      const savingsTokens = idiomDef.tokensPerOccurrenceSaved ?? 0;
      const netSavings = idiomDef.netTokenSavings ?? 0;
      const paramsList = idiomDef.params ? idiomDef.params.map((p) => p.name).join(", ") : "";
      const markdown = [
        `**Project Idiom \`$${cleanWord}\`** (${idiomDef.kind})`,
        `- Parameters: \`(${paramsList})\``,
        `- Token savings: saves ~${savingsTokens} tokens/use, ${netSavings} net BPE tokens`,
        `\`\`\`aice\n${idiomDef.templateAice}\n\`\`\``,
      ].join("\n\n");
      return {
        contents: {
          kind: "markdown",
          value: markdown,
        },
      };
    }

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
              value: `\`\`\`aice\nfn ${item.name}(${params})\n\`\`\`\nFunction declaration in module \`${doc.ast.path}\`.`,
            },
          };
        }

        if (item.kind === "ComponentDecl" && item.name === word) {
          const params = item.params.map((p) => `${p.name}`).join(", ");
          return {
            contents: {
              kind: "markdown",
              value: `\`\`\`aice\ncomponent ${item.name}(${params})\n\`\`\`\nDeclarative UI component.`,
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
        detail: "AICE Keyword",
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
        detail: "AICE Builtin Type",
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

    // 5. Active Project Idioms ($name)
    const idioms = this.getIdiomsForUri(uri);
    for (const [name, def] of Object.entries(idioms)) {
      const cleanName = name.startsWith("$") ? name : `$${name}`;
      completions.push({
        label: cleanName,
        kind: CompletionItemKind.Snippet,
        detail: `Project Idiom (${def.kind}): ${def.templateAice}`,
        documentation: {
          kind: "markdown",
          value: `**Template:**\n\`\`\`aice\n${def.templateAice}\n\`\`\`\nSaves ~${def.tokensPerOccurrenceSaved ?? 0} tokens/use.`,
        },
      });
    }

    return completions;
  }

  public getDocumentSymbols(uri: string): DocumentSymbol[] {
    const doc = this.documents.get(uri);
    if (!doc) return [];

    let mod = doc.ast;
    if (!mod) {
      try {
        mod = parse(doc.text, uri);
      } catch {
        return [];
      }
    }

    const toRange = (span: Span): Range => ({
      start: {
        line: Math.max(0, span.start.line - 1),
        character: Math.max(0, span.start.column - 1),
      },
      end: {
        line: Math.max(0, span.end.line - 1),
        character: Math.max(0, span.end.column - 1),
      },
    });

    const symbols: DocumentSymbol[] = [];

    for (const item of mod.items) {
      switch (item.kind) {
        case "TypeDecl": {
          const children: DocumentSymbol[] = [];
          if (item.isEnum && item.variants) {
            for (const v of item.variants) {
              children.push({
                name: v.name,
                kind: SymbolKind.Constant,
                range: toRange(v.span),
                selectionRange: toRange(v.span),
              });
            }
          } else if (item.fields) {
            for (const f of item.fields) {
              children.push({
                name: f.name,
                kind: SymbolKind.Field,
                range: toRange(f.span),
                selectionRange: toRange(f.span),
              });
            }
          }
          symbols.push({
            name: item.name,
            detail: item.isEnum ? "enum" : "type",
            kind: item.isEnum ? SymbolKind.Enum : SymbolKind.Struct,
            range: toRange(item.span),
            selectionRange: toRange(item.span),
            children: children.length > 0 ? children : undefined,
          });
          break;
        }

        case "ClassDecl": {
          const children: DocumentSymbol[] = [];
          if (item.properties) {
            for (const p of item.properties) {
              children.push({
                name: p.name,
                kind: SymbolKind.Property,
                range: toRange(p.span),
                selectionRange: toRange(p.span),
              });
            }
          }
          if (item.methods) {
            for (const m of item.methods) {
              const params = m.params.map((p) => p.name).join(", ");
              children.push({
                name: m.name,
                detail: `(${params})`,
                kind: SymbolKind.Method,
                range: toRange(m.span),
                selectionRange: toRange(m.span),
              });
            }
          }
          symbols.push({
            name: item.name,
            detail: "class",
            kind: SymbolKind.Class,
            range: toRange(item.span),
            selectionRange: toRange(item.span),
            children: children.length > 0 ? children : undefined,
          });
          break;
        }

        case "FunctionDecl": {
          const params = item.params.map((p) => p.name).join(", ");
          symbols.push({
            name: item.name,
            detail: `(${params})`,
            kind: SymbolKind.Function,
            range: toRange(item.span),
            selectionRange: toRange(item.span),
          });
          break;
        }

        case "ComponentDecl": {
          const params = item.params.map((p) => p.name).join(", ");
          symbols.push({
            name: item.name,
            detail: `(${params})`,
            kind: SymbolKind.Class,
            range: toRange(item.span),
            selectionRange: toRange(item.span),
          });
          break;
        }

        case "ConstDecl": {
          symbols.push({
            name: item.name,
            kind: SymbolKind.Constant,
            range: toRange(item.span),
            selectionRange: toRange(item.span),
          });
          break;
        }

        case "VarDecl": {
          symbols.push({
            name: item.name,
            kind: SymbolKind.Variable,
            range: toRange(item.span),
            selectionRange: toRange(item.span),
          });
          break;
        }
      }
    }

    return symbols;
  }

  public formatDocument(uri: string, options?: { indent?: string }): TextEdit[] {
    const doc = this.documents.get(uri);
    if (!doc) return [];

    let formatted: string;
    try {
      formatted = formatAiceSource(doc.text, {
        indent: options?.indent ? options.indent.length : undefined,
      });
    } catch {
      return [];
    }

    if (formatted === doc.text) return [];

    const lines = doc.text.split("\n");
    const lastLine = Math.max(0, lines.length - 1);
    const lastChar = lines[lastLine]?.length ?? 0;

    return [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: lastLine, character: lastChar },
        },
        newText: formatted,
      },
    ];
  }

  public getCodeActions(uri: string, _range: Range): CodeAction[] {
    const doc = this.documents.get(uri);
    if (!doc) return [];

    const repairRes = attemptSelfRepair(doc.text, uri);
    if (repairRes.modified && repairRes.repairs.length > 0) {
      const lines = doc.text.split("\n");
      const lastLine = Math.max(0, lines.length - 1);
      const lastChar = lines[lastLine]?.length ?? 0;

      const title =
        repairRes.repairs
          .map((r) => r.description)
          .filter(Boolean)
          .join("; ") || "Apply AICE autonomous self-repair";

      return [
        {
          title,
          kind: "quickfix",
          isPreferred: true,
          edit: {
            changes: {
              [uri]: [
                {
                  range: {
                    start: { line: 0, character: 0 },
                    end: { line: lastLine, character: lastChar },
                  },
                  newText: repairRes.finalSource,
                },
              ],
            },
          },
        },
      ];
    }

    return [];
  }

  public getDefinition(uri: string, position: Position): Location | null {
    const doc = this.documents.get(uri);
    if (!doc) return null;

    const line = doc.text.split("\n")[position.line] ?? "";
    const word = this.getWordAt(line, position.character);
    if (!word) return null;

    let mod = doc.ast;
    if (!mod) {
      try {
        mod = parse(doc.text, uri);
      } catch {
        return null;
      }
    }

    const toRange = (span: Span): Range => ({
      start: {
        line: Math.max(0, span.start.line - 1),
        character: Math.max(0, span.start.column - 1),
      },
      end: {
        line: Math.max(0, span.end.line - 1),
        character: Math.max(0, span.end.column - 1),
      },
    });

    const cleanWord = word.startsWith("$") ? word.slice(1) : word;

    for (const item of mod.items) {
      if ("name" in item && (item.name === word || item.name === cleanWord)) {
        return { uri, range: toRange(item.span) };
      }
      if (item.kind === "ClassDecl") {
        if (item.properties) {
          for (const p of item.properties) {
            if (p.name === word) return { uri, range: toRange(p.span) };
          }
        }
        if (item.methods) {
          for (const m of item.methods) {
            if (m.name === word) return { uri, range: toRange(m.span) };
          }
        }
      }
      if (item.kind === "TypeDecl") {
        if (item.variants) {
          for (const v of item.variants) {
            if (v.name === word) return { uri, range: toRange(v.span) };
          }
        }
        if (item.fields) {
          for (const f of item.fields) {
            if (f.name === word) return { uri, range: toRange(f.span) };
          }
        }
      }
    }

    return null;
  }

  private getWordAt(line: string, index: number): string | null {
    if (index < 0 || index > line.length) return null;
    const isIdent = (ch: string) => /[a-zA-Z0-9_$]/.test(ch);

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
