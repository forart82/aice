/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Modern C++20 Decompiler (Reverse Transpiler) for AICE 2.0.
 * Parses C++ headers and source files (.cpp, .hpp, .cc, .cxx, .h),
 * extracts comments into CstTriviaTable, and produces an AICE Module AST.
 */

import { emptySpan } from '../core/span.js';
import { CstTriviaTable, type TriviaItem } from '../core/trivia.js';
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
  WhileStmt,
} from '../core/ast.js';

export class CppDecompiler {
  private source: string;
  private filePath: string;
  private trivia: CstTriviaTable;

  constructor(source: string, filePath = 'source.cpp') {
    this.source = source;
    this.filePath = filePath;
    this.trivia = new CstTriviaTable();
  }

  private replaceScopeResolution(s: string): string {
    let res = '';
    let inStr = false;
    let qChar = '';
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '"' || c === "'") {
        let bs = 0;
        let k = i - 1;
        while (k >= 0 && s[k] === '\\') {
          bs++;
          k--;
        }
        if (bs % 2 === 0) {
          if (!inStr) {
            inStr = true;
            qChar = c;
          } else if (qChar === c) {
            inStr = false;
          }
        }
      }
      if (!inStr && s.slice(i, i + 2) === '::') {
        res += '.';
        i++;
        continue;
      }
      res += c;
    }
    return res;
  }

  private extractBalancedParen(
    str: string,
    openIdx: number,
  ): { content: string; endIndex: number } | null {
    let depth = 0;
    let inString = false;
    let quoteChar = '';

    for (let i = openIdx; i < str.length; i++) {
      const c = str[i];
      if (c === '"' || c === "'") {
        let bsCount = 0;
        let k = i - 1;
        while (k >= openIdx && str[k] === '\\') {
          bsCount++;
          k--;
        }
        if (bsCount % 2 === 0) {
          if (!inString) {
            inString = true;
            quoteChar = c;
          } else if (quoteChar === c) {
            inString = false;
          }
        }
      }
      if (inString) continue;

      if (c === '(') depth++;
      else if (c === ')') {
        depth--;
        if (depth === 0) {
          return { content: str.slice(openIdx + 1, i), endIndex: i };
        }
      }
    }
    return null;
  }

  private findMatchingOpenParen(s: string): number {
    if (!s.endsWith(')')) return -1;
    let depth = 0;
    let inStr = false;
    let qChar = '';
    for (let i = s.length - 1; i >= 0; i--) {
      const c = s[i];
      if (c === '"' || c === "'") {
        let bs = 0;
        let k = i - 1;
        while (k >= 0 && s[k] === '\\') {
          bs++;
          k--;
        }
        if (bs % 2 === 0) {
          if (!inStr) {
            inStr = true;
            qChar = c;
          } else if (qChar === c) {
            inStr = false;
          }
        }
      }
      if (inStr) continue;
      if (c === ')') depth++;
      else if (c === '(') {
        depth--;
        if (depth === 0) return i;
      }
    }
    return -1;
  }

  private findLastMemberDot(s: string): { dotIdx: number } | null {
    let parenDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;
    let inStr = false;
    let qChar = '';
    for (let j = s.length - 1; j >= 0; j--) {
      const c = s[j];
      if (c === '"' || c === "'") {
        let bs = 0;
        let k = j - 1;
        while (k >= 0 && s[k] === '\\') {
          bs++;
          k--;
        }
        if (bs % 2 === 0) {
          if (!inStr) {
            inStr = true;
            qChar = c;
          } else if (qChar === c) {
            inStr = false;
          }
        }
      }
      if (inStr) continue;
      if (c === ')') parenDepth++;
      else if (c === '(') parenDepth--;
      else if (c === ']') bracketDepth++;
      else if (c === '[') bracketDepth--;
      else if (c === '}') braceDepth++;
      else if (c === '{') braceDepth--;
      if (parenDepth === 0 && bracketDepth === 0 && braceDepth === 0 && c === '.') {
        return { dotIdx: j };
      }
    }
    return null;
  }

  private findHeaderOpenBraceIndex(line: string): number {
    const firstParen = line.indexOf('(');
    if (firstParen === -1) return 0;
    let depth = 0;
    let inQuote: string | null = null;
    for (let j = firstParen; j < line.length; j++) {
      const ch = line[j];
      if (inQuote) {
        if (ch === '\\' && j + 1 < line.length) {
          j++;
        } else if (ch === inQuote) {
          inQuote = null;
        }
      } else {
        if (ch === '"' || ch === "'") {
          inQuote = ch;
        } else if (ch === '(') {
          depth++;
        } else if (ch === ')') {
          depth--;
          if (depth === 0) {
            return j + 1;
          }
        }
      }
    }
    return 0;
  }

  private collectBracedBlock(
    lines: string[],
    startIdx: number,
    startCharIdx: number = 0,
  ): { bodyLines: string[]; nextIdx: number } {
    let braceCount = 0;
    let started = false;
    let startLine = -1;
    let startChar = -1;
    const bodyLines: string[] = [];
    let inBlockComment = false;

    for (let i = startIdx; i < lines.length; i++) {
      const line = lines[i];
      let j = (i === startIdx) ? startCharIdx : 0;
      while (j < line.length) {
        if (!inBlockComment && line.slice(j, j + 2) === '/*') {
          inBlockComment = true;
          j += 2;
          continue;
        }
        if (inBlockComment && line.slice(j, j + 2) === '*/') {
          inBlockComment = false;
          j += 2;
          continue;
        }
        if (inBlockComment) {
          j++;
          continue;
        }
        if (line.slice(j, j + 2) === '//') break;

        const char = line[j];
        if (char === '"' || char === "'") {
          const q = char;
          j++;
          while (j < line.length && line[j] !== q) {
            if (line[j] === '\\' && j + 1 < line.length) j++;
            j++;
          }
          j++;
          continue;
        }

        if (char === '{') {
          braceCount++;
          if (!started) {
            started = true;
            startLine = i;
            startChar = j;
            j++;
            continue;
          }
        } else if (char === '}') {
          braceCount--;
          if (started && braceCount === 0) {
            if (startLine === i) {
              const inner = line.slice(startChar + 1, j).trim();
              if (inner.length > 0) bodyLines.push(inner);
            } else {
              const beforeClose = line.slice(0, j);
              if (beforeClose.trim().length > 0) bodyLines.push(beforeClose);
            }
            return { bodyLines, nextIdx: i + 1 };
          }
        }
        j++;
      }
      if (started && braceCount > 0) {
        if (i === startLine) {
          const afterOpen = line.slice(startChar + 1);
          if (afterOpen.trim().length > 0) bodyLines.push(afterOpen);
        } else {
          bodyLines.push(line);
        }
      }
    }
    return { bodyLines, nextIdx: lines.length };
  }

  private splitArgs(argsStr: string): string[] {
    const args: string[] = [];
    let cur = '';
    let parenDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;
    let inString = false;
    for (let i = 0; i < argsStr.length; i++) {
      const c = argsStr[i];
      if (c === '"') {
        inString = !inString;
        cur += c;
        continue;
      }
      if (inString) {
        cur += c;
        continue;
      }
      if (c === '(') parenDepth++;
      else if (c === ')') parenDepth--;
      else if (c === '[') bracketDepth++;
      else if (c === ']') bracketDepth--;
      else if (c === '{') braceDepth++;
      else if (c === '}') braceDepth--;
      if (c === ',' && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
        if (cur.trim()) args.push(cur.trim());
        cur = '';
      } else {
        cur += c;
      }
    }
    if (cur.trim()) args.push(cur.trim());
    return args;
  }

  public parseCppType(typeStr: string): TypeExpr {
    let clean = typeStr
      .replace(/^const\s+/, '')
      .replace(/\s+const$/, '')
      .replace(/&/g, '')
      .replace(/\*/g, '')
      .replace(/^struct\s+/, '')
      .replace(/^class\s+/, '')
      .replace(/^inline\s+/, '')
      .replace(/^static\s+/, '')
      .trim();

    clean = clean.replace(/<>/g, '');

    const genericMatch = clean.match(/^([a-zA-Z0-9_:]+)<([\s\S]+)>$/);
    if (genericMatch) {
      const baseName = genericMatch[1].replace(/::/g, '.');
      const argsStr = genericMatch[2].trim();
      const typeArgs = argsStr ? this.splitArgs(argsStr).map((a) => this.parseCppType(a)) : [];
      if (baseName === 'std.vector' || baseName === 'vector') {
        return {
          kind: 'ArrayType',
          elementType:
            typeArgs[0] ?? { kind: 'PrimitiveType', primitive: 'any', span: emptySpan(this.filePath) },
          span: emptySpan(this.filePath),
        };
      }
      if (
        baseName === 'std.optional' ||
        baseName === 'optional' ||
        baseName === 'std.unique_ptr' ||
        baseName === 'unique_ptr' ||
        baseName === 'std.shared_ptr' ||
        baseName === 'shared_ptr'
      ) {
        return {
          kind: 'OptionType',
          innerType:
            typeArgs[0] ?? { kind: 'PrimitiveType', primitive: 'any', span: emptySpan(this.filePath) },
          span: emptySpan(this.filePath),
        };
      }
      return {
        kind: 'NamedType',
        name: baseName,
        typeArgs: typeArgs.length > 0 ? typeArgs : undefined,
        span: emptySpan(this.filePath),
      };
    }

    if (
      clean === 'int' ||
      clean === 'int32_t' ||
      clean === 'int64_t' ||
      clean === 'uint32_t' ||
      clean === 'uint64_t' ||
      clean === 'std::uint64_t' ||
      clean === 'size_t' ||
      clean === 'short' ||
      clean === 'unsigned int'
    ) {
      return { kind: 'PrimitiveType', primitive: 'int', span: emptySpan(this.filePath) };
    }
    if (clean === 'float') return { kind: 'PrimitiveType', primitive: 'float', span: emptySpan(this.filePath) };
    if (clean === 'double') return { kind: 'PrimitiveType', primitive: 'num', span: emptySpan(this.filePath) };
    if (clean === 'bool') return { kind: 'PrimitiveType', primitive: 'bool', span: emptySpan(this.filePath) };
    if (clean === 'void') return { kind: 'PrimitiveType', primitive: 'void', span: emptySpan(this.filePath) };
    if (clean === 'std::string' || clean === 'string' || clean === 'char*') {
      return { kind: 'PrimitiveType', primitive: 'str', span: emptySpan(this.filePath) };
    }
    if (clean === 'char' || clean === 'uint8_t' || clean === 'byte') {
      return { kind: 'PrimitiveType', primitive: 'byte', span: emptySpan(this.filePath) };
    }

    return {
      kind: 'NamedType',
      name: clean.replace(/::/g, '.'),
      typeArgs: [],
      span: emptySpan(this.filePath),
    };
  }


  private isStatementComplete(s: string): boolean {
    let parenDepth = 0;
    let braceDepth = 0;
    let bracketDepth = 0;
    let inString = false;
    let questionCount = 0;
    let colonCount = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '"' && (i === 0 || s[i - 1] !== '\\')) {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (c === '(') parenDepth++;
      else if (c === ')') parenDepth--;
      else if (c === '{') braceDepth++;
      else if (c === '}') braceDepth--;
      else if (c === '[') bracketDepth++;
      else if (c === ']') bracketDepth--;
      if (parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
        if (c === '?' && s[i + 1] !== '?' && s[i + 1] !== '.' && (i === 0 || s[i - 1] !== '?')) {
          questionCount++;
        } else if (c === ':' && s[i + 1] !== ':' && (i === 0 || s[i - 1] !== ':')) {
          colonCount++;
        }
      }
    }
    if (parenDepth > 0 || bracketDepth > 0 || braceDepth > 0) return false;
    if (questionCount > colonCount) return false;
    const trimmed = s.trim();
    return trimmed.endsWith(';') || trimmed.endsWith('}');
  }

  private findTernaryIndices(s: string): { questionIdx: number; colonIdx: number } | null {
    let parenDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;
    let inString = false;
    let questionIdx = -1;

    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if ((c === '"' || c === "'") && (i === 0 || s[i - 1] !== '\\')) {
        inString = !inString;
        continue;
      }
      if (inString) continue;

      if (c === '(') parenDepth++;
      else if (c === ')') parenDepth--;
      else if (c === '[') bracketDepth++;
      else if (c === ']') bracketDepth--;
      else if (c === '{') braceDepth++;
      else if (c === '}') braceDepth--;

      if (parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
        if (c === '?' && s[i + 1] !== '?' && s[i + 1] !== '.' && (i === 0 || s[i - 1] !== '?')) {
          if (questionIdx === -1) {
            questionIdx = i;
          }
        } else if (c === ':' && questionIdx !== -1) {
          return { questionIdx, colonIdx: i };
        }
      }
    }
    return null;
  }

  public parseCppExpr(exprStr: string): Expr {
    let s = exprStr.trim();
    if (!s) {
      return { kind: 'LiteralExpr', literalKind: 'nil', value: null, rawValue: 'nil', span: emptySpan(this.filePath) };
    }

    // Strip static_cast and other casts safely with balanced parens
    while (s.includes('static_cast<') || s.includes('dynamic_cast<') || s.includes('reinterpret_cast<') || s.includes('const_cast<')) {
      const match = s.match(/(?:static_cast|dynamic_cast|reinterpret_cast|const_cast)<[^>]+>\s*\(/);
      if (!match || match.index === undefined) break;
      const startIdx = match.index;
      const openParenIdx = startIdx + match[0].length - 1;
      const parenRes = this.extractBalancedParen(s, openParenIdx);
      if (!parenRes) break;
      s = s.slice(0, startIdx) + parenRes.content + s.slice(parenRes.endIndex + 1);
    }
    // Strip template parameters on function calls or types: make_unique<T>(...) or limits<T>::
    s = s.replace(/<[a-zA-Z0-9_:*&\s,]+>\s*(?=\(|::|\.)/g, '');
    s = s.replace(/<[a-zA-Z0-9_:*&\s,]+>\s*\(/g, '(');
    // Lambda expression: [&]() { ... } or [](...) { ... }
    const lambdaMatch = s.match(/^\[[^\]]*\]\s*(?:\(([^)]*)\))?\s*(?:->\s*[a-zA-Z0-9_:<>*&]+\s*)?\{([\s\S]*)\}$/);
    if (lambdaMatch) {
      const paramsRaw = lambdaMatch[1] ?? '';
      const innerBody = lambdaMatch[2];
      const bodyLines = innerBody.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const stmts = this.parseCppBlock(bodyLines);
      return {
        kind: 'ClosureExpr',
        params: this.parseCppParams(paramsRaw),
        returnType: null,
        body: { kind: 'Block', statements: stmts, span: emptySpan(this.filePath) },
        span: emptySpan(this.filePath),
      };
    }
    // Replace TypeName{args} with TypeName(args)
    while (/([a-zA-Z0-9_.]+)\s*\{([^{}]*)\}/.test(s)) {
      s = s.replace(/([a-zA-Z0-9_.]+)\s*\{([^{}]*)\}/g, '$1($2)');
    }
    // Strip number suffixes
    s = s.replace(/\b(\d+(?:\.\d+)?)[fFdD]\b/g, '$1');
    s = s.replace(/\b(\d+)(?:ull|ll|ul|u|l)\b/gi, '$1');
    // Replace scope resolution :: outside of strings
    s = this.replaceScopeResolution(s);
    // Replace arrow ->
    s = s.replace(/->/g, '.');
    // Strip dereference * on identifiers
    s = s.replace(/(?<=[(,;\s])\*([a-zA-Z0-9_]+)/g, '$1');
    // Strip leading * dereference and & address-of
    if (s.startsWith('*') && s.length > 1 && !s.slice(1).startsWith('=')) {
      s = s.slice(1).trim();
    }
    if (s.startsWith('&') && s.length > 1 && !s.slice(1).startsWith('=')) {
      s = s.slice(1).trim();
    }
    s = s.replace(/^this\./, '');

    // Strip std::string(...) / std.string(...) / string(...) string constructors
    while (/(?:std\.string|std::string|\bstring)\s*\(/.test(s)) {
      const match = s.match(/(?:std\.string|std::string|\bstring)\s*\(/);
      if (!match || match.index === undefined) break;
      const startIdx = match.index;
      const openParenIdx = startIdx + match[0].length - 1;
      const parenRes = this.extractBalancedParen(s, openParenIdx);
      if (!parenRes) break;
      s = s.slice(0, startIdx) + parenRes.content + s.slice(parenRes.endIndex + 1);
    }

    // Unwrap outer parens: (expr)
    while (s.startsWith('(') && this.extractBalancedParen(s, 0)?.endIndex === s.length - 1) {
      s = s.slice(1, -1).trim();
    }

    // String literal
    if (s.startsWith('"') && s.endsWith('"')) {
      return {
        kind: 'LiteralExpr',
        literalKind: 'string',
        value: s.slice(1, -1),
        rawValue: s,
        span: emptySpan(this.filePath),
      };
    }

    // Number literal
    const cleanNum = s.replace(/(?:ULL|LL|UL|ull|ll|ul|f|F|d|D|m|M|L|l|U|u)$/, '');
    if (/^-?[0-9]+(\.[0-9]+)?$/.test(cleanNum) || /^0x[0-9a-fA-F]+$/i.test(cleanNum)) {
      return {
        kind: 'LiteralExpr',
        literalKind: 'number',
        value: Number(cleanNum),
        rawValue: cleanNum,
        span: emptySpan(this.filePath),
      };
    }

    if (s === 'true' || s === 'false') {
      return { kind: 'LiteralExpr', literalKind: 'boolean', value: s === 'true', rawValue: s, span: emptySpan(this.filePath) };
    }
    if (s === 'nullptr' || s === 'NULL') {
      return { kind: 'LiteralExpr', literalKind: 'nil', value: null, rawValue: 'nil', span: emptySpan(this.filePath) };
    }

    // Array / initializer list literal { a, b, c }
    if (s.startsWith('{') && s.endsWith('}')) {
      const inner = s.slice(1, -1).trim();
      const elements = inner ? this.splitArgs(inner).map((e) => this.parseCppExpr(e)) : [];
      return {
        kind: 'ArrayLiteralExpr',
        elements,
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
        kind: 'BinaryExpr',
        operator: 'or',
        left: {
          kind: 'BinaryExpr',
          operator: 'and',
          left: this.parseCppExpr(condStr),
          right: this.parseCppExpr(whenTrueStr),
          span: emptySpan(this.filePath),
        },
        right: this.parseCppExpr(whenFalseStr),
        span: emptySpan(this.filePath),
      };
    }

    // Binary expressions
    for (const op of ['||', '&&', '==', '!=', '<=', '>=', '<', '>', '+', '-', '*', '/', '%']) {
      const idx = this.findOperatorIndex(s, op);
      if (idx > 0) {
        const left = s.slice(0, idx).trim();
        const right = s.slice(idx + op.length).trim();
        return {
          kind: 'BinaryExpr',
          left: this.parseCppExpr(left),
          operator: op === '&&' ? 'and' : op === '||' ? 'or' : (op as BinaryOp),
          right: this.parseCppExpr(right),
          span: emptySpan(this.filePath),
        };
      }
    }

    if (s.startsWith('!') && s.length > 1) {
      return {
        kind: 'UnaryExpr',
        operator: 'not',
        operand: this.parseCppExpr(s.slice(1)),
        span: emptySpan(this.filePath),
      };
    }

    // Call expr
    if (s.endsWith(')') && s.includes('(')) {
      const openIdx = this.findMatchingOpenParen(s);
      if (openIdx > 0) {
        const calleeStr = s.slice(0, openIdx).trim();
        const argsRaw = s.slice(openIdx + 1, s.length - 1);
        const args = this.splitArgs(argsRaw).map((a) => this.parseCppExpr(a));
        return {
          kind: 'CallExpr',
          callee: this.parseCppExpr(calleeStr),
          args,
          span: emptySpan(this.filePath),
        };
      }
    }

    // Member access
    const dotRes = this.findLastMemberDot(s);
    if (dotRes && dotRes.dotIdx > 0 && dotRes.dotIdx < s.length - 1) {
      const objStr = s.slice(0, dotRes.dotIdx).trim();
      const propStr = s.slice(dotRes.dotIdx + 1).trim();
      if (/^[a-zA-Z0-9_]+$/.test(propStr) && objStr.length > 0) {
        return {
          kind: 'MemberAccessExpr',
          object: this.parseCppExpr(objStr),
          property: propStr,
          isSafeNav: false,
          isOptional: false,
          span: emptySpan(this.filePath),
        };
      }
    }

    // Array index
    const indexMatch = s.match(/^([a-zA-Z0-9_.]+)\[(.+)\]$/);
    if (indexMatch) {
      return {
        kind: 'IndexExpr',
        object: this.parseCppExpr(indexMatch[1]),
        index: this.parseCppExpr(indexMatch[2]),
        span: emptySpan(this.filePath),
      };
    }

    return {
      kind: 'IdentifierExpr',
      name: s,
      span: emptySpan(this.filePath),
    };
  }

  private findOperatorIndex(expr: string, op: string): number {
    let parenDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;
    let inString = false;
    for (let k = expr.length - 1; k > expr.length - op.length; k--) {
      const c = expr[k];
      if (c === ')') parenDepth++;
      else if (c === '(') parenDepth--;
      else if (c === ']') bracketDepth++;
      else if (c === '[') bracketDepth--;
      else if (c === '}') braceDepth++;
      else if (c === '{') braceDepth--;
    }
    for (let i = expr.length - op.length; i >= 0; i--) {
      const char = expr[i];
      if (char === '"') inString = !inString;
      if (inString) continue;
      if (char === ')') parenDepth++;
      else if (char === '(') parenDepth--;
      else if (char === ']') bracketDepth++;
      else if (char === '[') bracketDepth--;
      else if (char === '}') braceDepth++;
      else if (char === '{') braceDepth--;

      if (parenDepth === 0 && bracketDepth === 0 && braceDepth === 0 && expr.slice(i, i + op.length) === op) {
        if (op === '*' || op === '&') {
          if (i === 0) continue;
        }
        return i;
      }
    }
    return -1;
  }

  private parseCppParams(paramsRaw: string): ParamDecl[] {
    if (!paramsRaw.trim()) return [];
    return this.splitArgs(paramsRaw)
      .map((p) => p.trim())
      .filter((p) => p.length > 0)
      .map((p) => {
        let defVal: Expr | undefined;
        let mainPart = p.trim();
        const eqIdx = mainPart.indexOf('=');
        if (eqIdx !== -1) {
          const defStr = mainPart.slice(eqIdx + 1).trim();
          mainPart = mainPart.slice(0, eqIdx).trim();
          if (defStr) {
            defVal = this.parseCppExpr(defStr);
          }
        }
        const parts = mainPart.split(/\s+/);
        let paramName = parts.pop() || 'arg';
        if (paramName.startsWith('*') || paramName.startsWith('&')) {
          paramName = paramName.slice(1);
        }
        paramName = paramName.replace(/\)$/, '').trim();
        let typeStr = parts.join(' ');
        if (!typeStr) {
          typeStr = paramName;
          paramName = 'arg';
        }
        return {
          name: paramName,
          typeAnnotation: this.parseCppType(typeStr),
          defaultValue: defVal,
          span: emptySpan(this.filePath),
        };
      });
  }

  private attachTrivia(nodeId: string, triviaItems: TriviaItem[]): void {
    for (const item of triviaItems) {
      this.trivia.addLeadingTrivia(nodeId, item);
    }
  }

  private stripLineComment(line: string): string {
    let inString = false;
    let quote = '';
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if ((c === '"' || c === "'") && (i === 0 || line[i - 1] !== '\\')) {
        if (!inString) {
          inString = true;
          quote = c;
        } else if (c === quote) {
          inString = false;
        }
      }
      if (!inString && c === '/' && line[i + 1] === '/') {
        return line.slice(0, i);
      }
    }
    return line;
  }

  private parseCppBlock(lines: string[]): Statement[] {
    const statements: Statement[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = this.stripLineComment(lines[i]);
      let trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed === '{' || trimmed === '}')
        continue;

      if (trimmed.startsWith('return')) {
        let retLine = trimmed;
        let lineIdx = i;
        if (!this.isStatementComplete(retLine)) {
          while (lineIdx + 1 < lines.length) {
            lineIdx++;
            retLine += ' ' + this.stripLineComment(lines[lineIdx]).trim();
            if (this.isStatementComplete(retLine)) break;
          }
          i = lineIdx;
        }
        const exprStr = retLine.replace(/^return\s*/, '').replace(/;$/, '').trim();
        statements.push({
          kind: 'ReturnStmt',
          value: exprStr ? this.parseCppExpr(exprStr) : null,
          span: emptySpan(this.filePath),
        });
        continue;
      }

      // Try statement: try { ... } catch (...) { ... }
      if (trimmed.startsWith('try') && (trimmed === 'try' || trimmed.startsWith('try ') || trimmed.startsWith('try{'))) {
        let lineIdx = i;
        const tryRest = trimmed.slice(3).trim();
        let tryStmts: Statement[] = [];
        const tryHasOpenBrace = tryRest.startsWith('{') || (!tryRest && lineIdx + 1 < lines.length && lines[lineIdx + 1].trim().startsWith('{'));
        if (tryHasOpenBrace) {
          const { bodyLines, nextIdx } = this.collectBracedBlock(lines, lineIdx);
          tryStmts = this.parseCppBlock(bodyLines);
          lineIdx = nextIdx - 1;
        }

        let catchParam = 'err';
        let catchStmts: Statement[] | undefined = undefined;
        while (lineIdx + 1 < lines.length) {
          const nextTrimmed = this.stripLineComment(lines[lineIdx + 1]).trim();
          if (nextTrimmed.startsWith('catch')) {
            lineIdx++;
            const parenRes = this.extractBalancedParen(nextTrimmed, nextTrimmed.indexOf('('));
            if (parenRes) {
              const pStr = parenRes.content.trim();
              const pParts = pStr.split(/\s+/);
              catchParam = pParts.pop()?.replace(/^[*&]+/, '') || 'err';
            }
            const startChar = this.findHeaderOpenBraceIndex(lines[lineIdx]);
            const { bodyLines, nextIdx } = this.collectBracedBlock(lines, lineIdx, startChar);
            catchStmts = this.parseCppBlock(bodyLines);
            lineIdx = nextIdx - 1;
            break;
          } else {
            break;
          }
        }
        i = lineIdx;
        statements.push({
          kind: 'TryStmt',
          tryBlock: { kind: 'Block', statements: tryStmts, span: emptySpan(this.filePath) },
          catchParam: catchStmts !== undefined ? catchParam : undefined,
          catchBlock: catchStmts !== undefined ? { kind: 'Block', statements: catchStmts, span: emptySpan(this.filePath) } : undefined,
          span: emptySpan(this.filePath),
        });
        continue;
      }

      if (trimmed === 'break;') {
        statements.push({ kind: 'BreakStmt', span: emptySpan(this.filePath) });
        continue;
      }
      if (trimmed === 'continue;') {
        statements.push({ kind: 'ContinueStmt', span: emptySpan(this.filePath) });
        continue;
      }

      // If statement
      if (trimmed.startsWith('if') && (trimmed.startsWith('if ') || trimmed.startsWith('if('))) {
        let ifLine = trimmed;
        let lineIdx = i;
        while (!ifLine.includes(')') || this.extractBalancedParen(ifLine, ifLine.indexOf('(')) === null) {
          if (lineIdx + 1 >= lines.length) break;
          lineIdx++;
          ifLine += ' ' + lines[lineIdx].trim();
        }
        const parenRes = this.extractBalancedParen(ifLine, ifLine.indexOf('('));
        if (parenRes) {
          let condStr = parenRes.content;
          const declCondMatch = condStr.match(/^(?:(?:const\s+)?auto(?:\s*\*|\s*&)?|[a-zA-Z0-9_:]+[\s*&]+)\s*([a-zA-Z0-9_]+)\s*=\s*(.+)$/);
          if (declCondMatch) {
            const varName = declCondMatch[1];
            const initStr = declCondMatch[2];
            statements.push({
              kind: 'LetBinding',
              name: varName,
              typeAnnotation: null,
              init: this.parseCppExpr(initStr),
              isMut: false,
              span: emptySpan(this.filePath),
            });
            condStr = varName;
          }
          const rest = ifLine.slice(parenRes.endIndex + 1).trim();
          let thenStmts: Statement[] = [];
          const hasOpenBrace = rest.startsWith('{') || (lineIdx + 1 < lines.length && lines[lineIdx + 1].trim().startsWith('{'));
          if (hasOpenBrace) {
            const startChar = this.findHeaderOpenBraceIndex(lines[lineIdx]);
            const { bodyLines, nextIdx } = this.collectBracedBlock(lines, lineIdx, startChar);
            i = nextIdx - 1;
            thenStmts = this.parseCppBlock(bodyLines);
          } else if (rest.startsWith('return')) {
            i = lineIdx;
            const retStr = rest.replace(/^return\s*/, '').replace(/;$/, '').trim();
            thenStmts.push({
              kind: 'ReturnStmt',
              value: retStr ? this.parseCppExpr(retStr) : null,
              span: emptySpan(this.filePath),
            });
          } else if (rest && rest !== ';') {
            i = lineIdx;
            thenStmts = this.parseCppBlock([rest.endsWith(';') ? rest : rest + ';']);
          } else if (lineIdx + 1 < lines.length) {
            lineIdx++;
            i = lineIdx;
            thenStmts = this.parseCppBlock([lines[lineIdx]]);
          } else {
            i = lineIdx;
          }
          const ifStmt: IfStmt = {
            kind: 'IfStmt',
            condition: this.parseCppExpr(condStr),
            thenBranch: { kind: 'Block', statements: thenStmts, span: emptySpan(this.filePath) },
            elifBranches: [],
            elseBranch: null,
            span: emptySpan(this.filePath),
          };

          // Handle else if / else
          while (i + 1 < lines.length) {
            const nextTrimmed = lines[i + 1].trim();
            if (nextTrimmed.startsWith('else if') || nextTrimmed.startsWith('else if(')) {
              i++;
              let elifLine = nextTrimmed;
              let elifLineIdx = i;
              while (!elifLine.includes(')') || this.extractBalancedParen(elifLine, elifLine.indexOf('(')) === null) {
                if (elifLineIdx + 1 >= lines.length) break;
                elifLineIdx++;
                elifLine += ' ' + lines[elifLineIdx].trim();
              }
              const elifParenRes = this.extractBalancedParen(elifLine, elifLine.indexOf('('));
              if (elifParenRes) {
                const elifCondStr = elifParenRes.content;
                const elifRest = elifLine.slice(elifParenRes.endIndex + 1).trim();
                let elifStmts: Statement[] = [];
                const elifHasOpenBrace = elifRest.startsWith('{') || (elifLineIdx + 1 < lines.length && lines[elifLineIdx + 1].trim().startsWith('{'));
                if (elifHasOpenBrace) {
                  const startChar = this.findHeaderOpenBraceIndex(lines[elifLineIdx]);
                  const { bodyLines, nextIdx } = this.collectBracedBlock(lines, elifLineIdx, startChar);
                  i = nextIdx - 1;
                  elifStmts = this.parseCppBlock(bodyLines);
                } else if (elifRest && elifRest !== ';') {
                  i = elifLineIdx;
                  elifStmts = this.parseCppBlock([elifRest.endsWith(';') ? elifRest : elifRest + ';']);
                }
                ifStmt.elifBranches.push({
                  condition: this.parseCppExpr(elifCondStr),
                  body: { kind: 'Block', statements: elifStmts, span: emptySpan(this.filePath) },
                  span: emptySpan(this.filePath),
                });
              }
            } else if (nextTrimmed.startsWith('else')) {
              i++;
              const elseRest = nextTrimmed.replace(/^else\s*/, '').trim();
              let elseStmts: Statement[] = [];
              const elseHasOpenBrace = elseRest.startsWith('{') || (i + 1 < lines.length && lines[i + 1].trim().startsWith('{'));
              if (elseHasOpenBrace) {
                const { bodyLines, nextIdx } = this.collectBracedBlock(lines, i);
                i = nextIdx - 1;
                elseStmts = this.parseCppBlock(bodyLines);
              } else if (elseRest && elseRest !== ';') {
                elseStmts = this.parseCppBlock([elseRest.endsWith(';') ? elseRest : elseRest + ';']);
              } else if (i + 1 < lines.length) {
                i++;
                elseStmts = this.parseCppBlock([lines[i]]);
              }
              ifStmt.elseBranch = { kind: 'Block', statements: elseStmts, span: emptySpan(this.filePath) };
              break;
            } else {
              break;
            }
          }
          statements.push(ifStmt);
          continue;
        }
      }

      // While statement
      if (trimmed.startsWith('while') && (trimmed.startsWith('while ') || trimmed.startsWith('while('))) {
        let whileLine = trimmed;
        let lineIdx = i;
        while (!whileLine.includes(')') || this.extractBalancedParen(whileLine, whileLine.indexOf('(')) === null) {
          if (lineIdx + 1 >= lines.length) break;
          lineIdx++;
          whileLine += ' ' + lines[lineIdx].trim();
        }
        const parenRes = this.extractBalancedParen(whileLine, whileLine.indexOf('('));
        if (parenRes) {
          let condStr = parenRes.content;
          const declCondMatch = condStr.match(/^(?:(?:const\s+)?auto(?:\s*\*|\s*&)?|[a-zA-Z0-9_:]+[\s*&]+)\s*([a-zA-Z0-9_]+)\s*=\s*(.+)$/);
          let varName: string | undefined;
          let initStr: string | undefined;
          if (declCondMatch) {
            varName = declCondMatch[1];
            initStr = declCondMatch[2];
            statements.push({
              kind: 'LetBinding',
              name: varName,
              typeAnnotation: null,
              init: this.parseCppExpr(initStr),
              isMut: true,
              span: emptySpan(this.filePath),
            });
            condStr = varName;
          }
          const rest = whileLine.slice(parenRes.endIndex + 1).trim();
          let bodyStmts: Statement[] = [];
          const hasOpenBrace = rest.startsWith('{') || (lineIdx + 1 < lines.length && lines[lineIdx + 1].trim().startsWith('{'));
          if (hasOpenBrace) {
            const startChar = this.findHeaderOpenBraceIndex(lines[lineIdx]);
            const { bodyLines, nextIdx } = this.collectBracedBlock(lines, lineIdx, startChar);
            i = nextIdx - 1;
            bodyStmts = this.parseCppBlock(bodyLines);
          } else if (rest && rest !== ';') {
            i = lineIdx;
            bodyStmts = this.parseCppBlock([rest.endsWith(';') ? rest : rest + ';']);
          } else if (lineIdx + 1 < lines.length) {
            lineIdx++;
            i = lineIdx;
            bodyStmts = this.parseCppBlock([lines[lineIdx]]);
          } else {
            i = lineIdx;
          }
          if (varName && initStr) {
            bodyStmts.push({
              kind: 'AssignStmt',
              target: { kind: 'IdentifierExpr', name: varName, span: emptySpan(this.filePath) },
              op: '=',
              value: this.parseCppExpr(initStr),
              span: emptySpan(this.filePath),
            });
          }
          statements.push({
            kind: 'WhileStmt',
            condition: this.parseCppExpr(condStr),
            body: { kind: 'Block', statements: bodyStmts, span: emptySpan(this.filePath) },
            span: emptySpan(this.filePath),
          });
          continue;
        }
      }

      // Switch statement -> IfStmt
      if (trimmed.startsWith('switch') && (trimmed.startsWith('switch ') || trimmed.startsWith('switch('))) {
        let switchLine = trimmed;
        let lineIdx = i;
        while (!switchLine.includes(')') || this.extractBalancedParen(switchLine, switchLine.indexOf('(')) === null) {
          if (lineIdx + 1 >= lines.length) break;
          lineIdx++;
          switchLine += ' ' + lines[lineIdx].trim();
        }
        const parenRes = this.extractBalancedParen(switchLine, switchLine.indexOf('('));
        if (parenRes) {
          const targetStr = parenRes.content.trim();
          const targetExpr = this.parseCppExpr(targetStr);
          const { bodyLines, nextIdx } = this.collectBracedBlock(lines, lineIdx);
          i = nextIdx - 1;

          // Parse case groups
          interface CaseGroup { kind: 'case' | 'default'; values: string[]; lines: string[] }
          const groups: CaseGroup[] = [];
          let curGroup: CaseGroup | null = null;
          for (const l of bodyLines) {
            const strp = l.trim();
            if (!strp) continue;
            const caseMatch = strp.match(/^cases+([^:]+):s*(.*)$/);
            const defMatch = strp.match(/^defaults*:s*(.*)$/);
            if (caseMatch) {
              if (!curGroup || curGroup.kind !== 'case' || curGroup.lines.length > 0) {
                curGroup = { kind: 'case', values: [], lines: [] };
                groups.push(curGroup);
              }
              curGroup.values.push(caseMatch[1].trim());
              if (caseMatch[2]) curGroup.lines.push(caseMatch[2]);
            } else if (defMatch) {
              curGroup = { kind: 'default', values: [], lines: [] };
              groups.push(curGroup);
              if (defMatch[1]) curGroup.lines.push(defMatch[1]);
            } else if (curGroup) {
              curGroup.lines.push(strp);
            }
          }

          let ifStmt: IfStmt | null = null;
          let defaultStmts: Statement[] | undefined = undefined;
          for (const g of groups) {
            const cleanLines = g.lines.filter((l) => l && l !== 'break;');
            const cStmts = this.parseCppBlock(cleanLines);
            if (g.kind === 'default') {
              defaultStmts = cStmts;
              continue;
            }
            if (g.values.length === 0) continue;
            let cond: Expr = {
              kind: 'BinaryExpr',
              operator: '==',
              left: targetExpr,
              right: this.parseCppExpr(g.values[0]),
              span: emptySpan(this.filePath),
            };
            for (let v = 1; v < g.values.length; v++) {
              cond = {
                kind: 'BinaryExpr',
                operator: 'or',
                left: cond,
                right: {
                  kind: 'BinaryExpr',
                  operator: '==',
                  left: targetExpr,
                  right: this.parseCppExpr(g.values[v]),
                  span: emptySpan(this.filePath),
                },
                span: emptySpan(this.filePath),
              };
            }
            if (!ifStmt) {
              ifStmt = {
                kind: 'IfStmt',
                condition: cond,
                thenBranch: { kind: 'Block', statements: cStmts, span: emptySpan(this.filePath) },
                elifBranches: [],
                elseBranch: null,
                span: emptySpan(this.filePath),
              };
            } else {
              ifStmt.elifBranches.push({
                condition: cond,
                body: { kind: 'Block', statements: cStmts, span: emptySpan(this.filePath) },
                span: emptySpan(this.filePath),
              });
            }
          }
          if (ifStmt) {
            if (defaultStmts && defaultStmts.length > 0) {
              ifStmt.elseBranch = { kind: 'Block', statements: defaultStmts, span: emptySpan(this.filePath) };
            }
            statements.push(ifStmt);
          }
          continue;
        }
      }

      // For statement
      if (trimmed.startsWith('for') && (trimmed.startsWith('for ') || trimmed.startsWith('for('))) {
        let forLine = trimmed;
        let lineIdx = i;
        while (!forLine.includes(')') || this.extractBalancedParen(forLine, forLine.indexOf('(')) === null) {
          if (lineIdx + 1 >= lines.length) break;
          lineIdx++;
          forLine += ' ' + lines[lineIdx].trim();
        }
        const parenRes = this.extractBalancedParen(forLine, forLine.indexOf('('));
        if (parenRes) {
          const header = parenRes.content.trim();
          let varName = 'i';
          let iterableExpr: Expr;
          if (header.includes(':')) {
            // Range-based for: (auto item : items)
            const colonIdx = header.indexOf(':');
            const left = header.slice(0, colonIdx).trim();
            const right = header.slice(colonIdx + 1).trim();
            varName = left.replace(/.*[\s*&]/, '').trim() || 'item';
            iterableExpr = this.parseCppExpr(right);
          } else {
            // C-style for: (int i = 0; i < count; ++i)
            const parts = header.split(';');
            const initPart = parts[0]?.trim() ?? '';
            const condPart = parts[1]?.trim() ?? '';
            const initMatch = initPart.match(/([a-zA-Z0-9_]+)\s*=\s*(.+)$/);
            if (initMatch) {
              varName = initMatch[1];
              const startVal = initMatch[2].trim();
              const condMatch = condPart.match(/<=\s*(.+)$|<(?!<)\s*(.+)$/);
              const endVal = condMatch ? (condMatch[1] ?? condMatch[2]).trim() : '';
              if (startVal === '0' && endVal) {
                iterableExpr = {
                  kind: 'CallExpr',
                  callee: { kind: 'IdentifierExpr', name: 'range', span: emptySpan(this.filePath) },
                  args: [this.parseCppExpr(endVal)],
                  span: emptySpan(this.filePath),
                };
              } else if (endVal) {
                iterableExpr = {
                  kind: 'CallExpr',
                  callee: { kind: 'IdentifierExpr', name: 'range', span: emptySpan(this.filePath) },
                  args: [this.parseCppExpr(startVal), this.parseCppExpr(endVal)],
                  span: emptySpan(this.filePath),
                };
              } else {
                iterableExpr = {
                  kind: 'CallExpr',
                  callee: { kind: 'IdentifierExpr', name: 'range', span: emptySpan(this.filePath) },
                  args: [{ kind: 'LiteralExpr', literalKind: 'number', value: 0, rawValue: '0', span: emptySpan(this.filePath) }],
                  span: emptySpan(this.filePath),
                };
              }
            } else {
              iterableExpr = {
                kind: 'CallExpr',
                callee: { kind: 'IdentifierExpr', name: 'range', span: emptySpan(this.filePath) },
                args: [{ kind: 'LiteralExpr', literalKind: 'number', value: 0, rawValue: '0', span: emptySpan(this.filePath) }],
                span: emptySpan(this.filePath),
              };
            }
          }
          const rest = forLine.slice(parenRes.endIndex + 1).trim();
          let bodyStmts: Statement[] = [];
          const hasOpenBrace = rest.startsWith('{') || (lineIdx + 1 < lines.length && lines[lineIdx + 1].trim().startsWith('{'));
          if (hasOpenBrace) {
            const startChar = this.findHeaderOpenBraceIndex(lines[lineIdx]);
            const { bodyLines, nextIdx } = this.collectBracedBlock(lines, lineIdx, startChar);
            i = nextIdx - 1;
            bodyStmts = this.parseCppBlock(bodyLines);
          } else if (rest && rest !== ';') {
            i = lineIdx;
            bodyStmts = this.parseCppBlock([rest.endsWith(';') ? rest : rest + ';']);
          } else if (lineIdx + 1 < lines.length) {
            lineIdx++;
            i = lineIdx;
            bodyStmts = this.parseCppBlock([lines[lineIdx]]);
          } else {
            i = lineIdx;
          }
          statements.push({
            kind: 'ForStmt',
            variable: varName,
            iterable: iterableExpr,
            body: { kind: 'Block', statements: bodyStmts, span: emptySpan(this.filePath) },
            span: emptySpan(this.filePath),
          });
          continue;
        }
      }

      // Increment/decrement statement: target++; or ++target;
      const incMatch = trimmed.match(/^(\+\+|--)?([a-zA-Z0-9_.[\]]+)(\+\+|--)?;$/);
      if (incMatch && (incMatch[1] || incMatch[3])) {
        const op = (incMatch[1] || incMatch[3]) === '++' ? '+=' : '-=';
        const target = incMatch[2].trim();
        statements.push({
          kind: 'AssignStmt',
          target: this.parseCppExpr(target),
          op: op as AssignOp,
          value: { kind: 'LiteralExpr', literalKind: 'number', value: 1, rawValue: '1', span: emptySpan(this.filePath) },
          span: emptySpan(this.filePath),
        });
        continue;
      }

      // Collect multiline statement if incomplete
      let stmtLine = trimmed;
      if (!this.isStatementComplete(stmtLine)) {
        let lineIdx = i;
        while (lineIdx + 1 < lines.length) {
          lineIdx++;
          stmtLine += '\n' + lines[lineIdx].trim();
          if (this.isStatementComplete(stmtLine)) break;
        }
        i = lineIdx;
      }

      // Uniform init declaration: Type name{ elements };
      const uniformDeclMatch = stmtLine.match(
        /^(?:(?:const|static|auto|inline|constexpr|volatile)\s+)*([a-zA-Z0-9_:<>*&,\s]+?)\s+([a-zA-Z0-9_]+)\s*\{([^}]*)\}\s*;$/,
      );
      if (uniformDeclMatch && !stmtLine.startsWith('return')) {
        const varName = uniformDeclMatch[2];
        const inner = uniformDeclMatch[3].trim();
        const elements = inner ? this.splitArgs(inner).map((e) => this.parseCppExpr(e)) : [];
        statements.push({
          kind: 'LetBinding',
          name: varName,
          typeAnnotation: null,
          init: {
            kind: 'ArrayLiteralExpr',
            elements,
            span: emptySpan(this.filePath),
          },
          isMut: !stmtLine.startsWith('const'),
          span: emptySpan(this.filePath),
        });
        continue;
      }

      // Variable declaration: Type name = expr;
      const varDeclMatch = stmtLine.match(
        /^(?:(?:const|static|auto|inline|constexpr|volatile)\s+)*([a-zA-Z0-9_:<>*&]+(?:\s*[*&]+)?)\s+[*&]*([a-zA-Z0-9_]+)\s*=\s*([\s\S]+?);$/,
      );
      if (varDeclMatch && !stmtLine.startsWith('return') && !stmtLine.startsWith('ret ')) {
        const varName = varDeclMatch[2];
        const valStr = varDeclMatch[3];
        statements.push({
          kind: 'LetBinding',
          name: varName,
          typeAnnotation: null,
          init: this.parseCppExpr(valStr),
          isMut: !stmtLine.startsWith('const'),
          span: emptySpan(this.filePath),
        });
        continue;
      }

      // ctor declaration: Type name(args);
      const ctorVarMatch = stmtLine.match(
        /^(?:(?:const|static|auto|inline|constexpr|volatile)\s+)*([a-zA-Z0-9_:<>*&]+)\s+([a-zA-Z0-9_]+)\s*\(([^;]*)\)\s*;$/,
      );
      if (
        ctorVarMatch &&
        !stmtLine.startsWith('return') &&
        !stmtLine.startsWith('if') &&
        !stmtLine.startsWith('while') &&
        !stmtLine.startsWith('throw')
      ) {
        const typeStr = ctorVarMatch[1];
        const varName = ctorVarMatch[2];
        const argsStr = ctorVarMatch[3];
        statements.push({
          kind: 'LetBinding',
          name: varName,
          typeAnnotation: null,
          init: {
            kind: 'CallExpr',
            callee: {
              kind: 'IdentifierExpr',
              name: typeStr.replace(/::/g, '.').replace(/<.*>/, ''),
              span: emptySpan(this.filePath),
            },
            args: this.splitArgs(argsStr).map((a) => this.parseCppExpr(a)),
            span: emptySpan(this.filePath),
          },
          isMut: true,
          span: emptySpan(this.filePath),
        });
        continue;
      }

      // Bare declaration: Type name;
      const bareVarMatch = stmtLine.match(
        /^(?:(?:const|static|auto|inline|constexpr|volatile)\s+)*([a-zA-Z0-9_:<>*&]+)\s+([a-zA-Z0-9_]+)\s*;$/,
      );
      if (
        bareVarMatch &&
        !stmtLine.startsWith('return') &&
        !stmtLine.startsWith('break') &&
        !stmtLine.startsWith('continue')
      ) {
        const varName = bareVarMatch[2];
        statements.push({
          kind: 'LetBinding',
          name: varName,
          typeAnnotation: null,
          init: {
            kind: 'LiteralExpr',
            literalKind: 'nil',
            value: null,
            rawValue: 'nil',
            span: emptySpan(this.filePath),
          },
          isMut: true,
          span: emptySpan(this.filePath),
        });
        continue;
      }

      // Assignment: target = expr;
      const assignMatch = stmtLine.match(/^([a-zA-Z0-9_.\->[\]]+)\s*(\+=|-=|\*=|\/=|%=|=)\s*([\s\S]+?);$/);
      if (assignMatch) {
        const target = assignMatch[1];
        const op = assignMatch[2] === '=' ? undefined : assignMatch[2];
        const valStr = assignMatch[3];
        statements.push({
          kind: 'AssignStmt',
          target: this.parseCppExpr(target),
          op: (op as AssignOp) ?? '=',
          value: this.parseCppExpr(valStr),
          span: emptySpan(this.filePath),
        });
        continue;
      }

      const cleanExpr = stmtLine.replace(/;$/, '').trim();
      if (cleanExpr) {
        statements.push({
          kind: 'ExprStmt',
          expr: this.parseCppExpr(cleanExpr),
          span: emptySpan(this.filePath),
        });
      }
    }
    return statements;
  }
  private parseStructFields(lines: string[]): FieldDecl[] {
    const fields: FieldDecl[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.includes('('))
        continue;
      const match = trimmed.match(
        /^([a-zA-Z0-9_:<>*&]+)\s+([a-zA-Z0-9_]+)(?:\{[^}]*\})?(?:\s*=\s*.+?)?\s*;/,
      );
      if (match) {
        fields.push({
          name: match[2],
          typeAnnotation: this.parseCppType(match[1]),
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
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      let trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*')) {
        i++;
        continue;
      }
      if (trimmed === 'public:' || trimmed === 'private:' || trimmed === 'protected:') {
        i++;
        continue;
      }

      if (
        trimmed.endsWith('= delete;') ||
        trimmed.endsWith('= default;') ||
        trimmed.startsWith('friend ') ||
        trimmed.startsWith('using ') ||
        /operator\s*[^a-zA-Z0-9_]/.test(trimmed)
      ) {
        i++;
        continue;
      }

      let fullLine = trimmed;
      let lineIdx = i;
      if (
        fullLine.includes('(') &&
        (!fullLine.includes(')') || (!fullLine.includes(';') && !fullLine.includes('{')))
      ) {
        while (lineIdx + 1 < lines.length) {
          lineIdx++;
          fullLine += ' ' + lines[lineIdx].trim();
          if (fullLine.includes(')') && (fullLine.includes(';') || fullLine.includes('{'))) break;
        }
      }

      // Constructor
      const ctorMatch = fullLine.match(new RegExp(`^${className}\\s*\\(([^)]*)\\)`));
      if (ctorMatch) {
        const hasBody =
          fullLine.includes('{') || (lineIdx + 1 < lines.length && lines[lineIdx + 1].trim().startsWith('{'));
        if (hasBody) {
          const { nextIdx } = this.collectBracedBlock(lines, lineIdx);
          i = nextIdx;
        } else {
          i = lineIdx + 1;
        }
        methods.push({
          kind: 'MethodDecl',
          name: 'constructor',
          isStatic: false,
          isAsync: false,
          isExpressionBodied: true,
          typeParams: [],
          params: this.parseCppParams(ctorMatch[1]),
          returnType: null,
          body: { kind: 'LiteralExpr', literalKind: 'nil', value: null, rawValue: 'nil', span: emptySpan(this.filePath) },
          span: emptySpan(this.filePath),
        });
        continue;
      }

      if (fullLine.startsWith(`~${className}`)) {
        i = lineIdx + 1;
        continue;
      }

      // Method
      const methodMatch = fullLine.match(
        /^((?:virtual|inline|static|explicit|const|constexpr)\s+)*([a-zA-Z0-9_:<>*&]+)\s+([a-zA-Z0-9_]+)\s*\(([^)]*)\)\s*(const|noexcept|\s+)*(\{|;)?/,
      );
      if (methodMatch && !fullLine.startsWith('return') && !fullLine.startsWith('if')) {
        const retTypeStr = methodMatch[2];
        const methodName = methodMatch[3];
        const paramsRaw = methodMatch[4];
        const hasBody =
          fullLine.includes('{') || (lineIdx + 1 < lines.length && lines[lineIdx + 1].trim().startsWith('{'));
        let bodyStatements: Statement[] = [];
        if (hasBody) {
          const { bodyLines, nextIdx } = this.collectBracedBlock(lines, lineIdx);
          i = nextIdx;
          bodyStatements = this.parseCppBlock(bodyLines);
        } else {
          i = lineIdx + 1;
        }
        const isEmpty = !hasBody || bodyStatements.length === 0;
        methods.push({
          kind: 'MethodDecl',
          name: methodName,
          isStatic: false,
          isAsync: false,
          isExpressionBodied: isEmpty,
          typeParams: [],
          params: this.parseCppParams(paramsRaw),
          returnType: this.parseCppType(retTypeStr),
          body: isEmpty
            ? ({ kind: 'LiteralExpr', literalKind: 'nil', value: null, rawValue: 'nil', span: emptySpan(this.filePath) } as any)
            : { kind: 'Block', statements: bodyStatements, span: emptySpan(this.filePath) },
          span: emptySpan(this.filePath),
        });
        continue;
      }

      // Property
      const fieldMatch = fullLine.match(
        /^((?:static|mutable|const|constexpr)\s+)*([a-zA-Z0-9_:<>*&]+)\s+([a-zA-Z0-9_]+)(?:\{([^}]*)\})?(?:\s*=\s*(.+?))?\s*;/,
      );
      if (fieldMatch) {
        const typeStr = fieldMatch[2];
        const propName = fieldMatch[3];
        const initValStr = fieldMatch[4] ?? fieldMatch[5];
        properties.push({
          kind: 'PropertyDecl',
          name: propName,
          isStatic: false,
          isReadonly: false,
          typeAnnotation: this.parseCppType(typeStr),
          initialValue: initValStr ? this.parseCppExpr(initValStr) : undefined,
          span: emptySpan(this.filePath),
        });
        i = lineIdx + 1;
        continue;
      }
      i = lineIdx + 1;
    }

    return {
      kind: 'ClassDecl',
      name: className,
      isExported: true,
      typeParams: [],
      extends: baseClass,
      primaryConstructor: undefined,
      properties,
      methods,
      span: emptySpan(this.filePath),
    };
  }

  public decompile(): { ast: Module; trivia: CstTriviaTable } {
    const items: ModuleItem[] = [];
    const baseName =
      this.filePath
        .split(/[/\\]/)
        .pop()
        ?.replace(/\.(cpp|hpp|cc|cxx|h)(\.aice)?$/, '')
        .replace(/\.aice$/, '') ?? 'source';
    let namespaceName: string | null = null;
    const lines = this.source.split('\n');
    let currentTrivia: TriviaItem[] = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      if (line.trim().startsWith('//')) {
        currentTrivia.push({
          kind: 'LINE_COMMENT',
          content: line.trim(),
        });
        i++;
        continue;
      }

      if (line.trim().startsWith('/*')) {
        let blockComment = line.trim();
        while (!blockComment.includes('*/') && i + 1 < lines.length) {
          i++;
          blockComment += '\n' + lines[i];
        }
        currentTrivia.push({
          kind: 'BLOCK_COMMENT',
          content: blockComment,
        });
        i++;
        continue;
      }

      let trimmed = this.stripLineComment(line).trim();
      if (!trimmed || trimmed.startsWith('#pragma')) {
        i++;
        continue;
      }

      const includeMatch = trimmed.match(/^#include\s+["<]([^">]+)[">]/);
      if (includeMatch) {
        const header = includeMatch[1];
        if (['string', 'iostream', 'vector', 'cmath', 'memory', 'algorithm', 'utility', 'cstdint', 'stdexcept'].includes(header)) {
          i++;
          continue;
        }
        const incNodeId = `import:${header}`;
        this.attachTrivia(incNodeId, currentTrivia);
        currentTrivia = [];
        items.push({
          kind: 'ImportDecl',
          source: header,
          specifiers: [],
          span: emptySpan(this.filePath),
        });
        i++;
        continue;
      }

      const nsMatch = trimmed.match(/^namespace\s+([a-zA-Z0-9_:]+)\s*\{?/);
      if (nsMatch) {
        namespaceName = nsMatch[1];
        i++;
        continue;
      }

      // enum
      const enumMatch = trimmed.match(/^enum(\s+class)?\s+([a-zA-Z0-9_]+)\s*(:\s*[a-zA-Z0-9_]+)?/);
      if (enumMatch) {
        const enumName = enumMatch[2];
        const { bodyLines, nextIdx } = this.collectBracedBlock(lines, i);
        i = nextIdx;
        const cleanStr = bodyLines
          .map((l) => l.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').trim())
          .filter(Boolean)
          .join(' ');
        const variants = cleanStr
          .split(',')
          .map((v) => v.trim())
          .filter((v) => v.length > 0)
          .map((v) => {
            const varName = v.split('=')[0].trim().replace(/^[{}]/, '').trim();
            return { name: varName, span: emptySpan(this.filePath) };
          })
          .filter((v) => v.name.length > 0);
        const enumNodeId = `type:${enumName}`;
        this.attachTrivia(enumNodeId, currentTrivia);
        currentTrivia = [];
        items.push({
          kind: 'TypeDecl',
          isEnum: true,
          name: enumName,
          typeParams: [],
          variants,
          span: emptySpan(this.filePath),
        });
        continue;
      }

      // struct
      const structMatch = trimmed.match(
        /^struct\s+([a-zA-Z0-9_]+)(\s*:\s*(public|private|protected)?\s*([a-zA-Z0-9_:]+))?\s*\{?/,
      );
      if (structMatch && !trimmed.endsWith(');') && !trimmed.includes('(')) {
        const structName = structMatch[1];
        const { bodyLines, nextIdx } = this.collectBracedBlock(lines, i);
        i = nextIdx;
        const fields = this.parseStructFields(bodyLines);
        const structNodeId = `type:${structName}`;
        this.attachTrivia(structNodeId, currentTrivia);
        currentTrivia = [];
        items.push({
          kind: 'TypeDecl',
          isEnum: false,
          name: structName,
          typeParams: [],
          fields,
          span: emptySpan(this.filePath),
        });
        continue;
      }

      // class
      const classMatch = trimmed.match(
        /^class\s+([a-zA-Z0-9_]+)(\s*:\s*(public|private|protected)?\s*([a-zA-Z0-9_:]+))?\s*\{?/,
      );
      if (classMatch && !trimmed.endsWith(');') && !trimmed.includes('(')) {
        const className = classMatch[1];
        const baseClass = classMatch[4] ? classMatch[4].replace(/::/g, '.') : undefined;
        const { bodyLines, nextIdx } = this.collectBracedBlock(lines, i);
        i = nextIdx;
        const parsedClass = this.parseClassMembers(className, baseClass, bodyLines);
        const classNodeId = `class:${className}`;
        this.attachTrivia(classNodeId, currentTrivia);
        currentTrivia = [];
        items.push(parsedClass);
        continue;
      }

      // constexpr / const
      const constMatch = trimmed.match(
        /^(constexpr|const)\s+([a-zA-Z0-9_:<>*&]+)\s+([a-zA-Z0-9_]+)\s*=\s*(.+?);/,
      );
      if (constMatch) {
        const constName = constMatch[3];
        const constNodeId = `const:${constName}`;
        this.attachTrivia(constNodeId, currentTrivia);
        currentTrivia = [];
        items.push({
          kind: 'ConstDecl',
          name: constName,
          isExported: true,
          typeAnnotation: this.parseCppType(constMatch[2]),
          value: this.parseCppExpr(constMatch[4]),
          span: emptySpan(this.filePath),
        });
        i++;
        continue;
      }

      let fullLine = trimmed;
      let lineIdx = i;
      if (
        fullLine.includes('(') &&
        (!fullLine.includes(')') || (!fullLine.includes(';') && !fullLine.includes('{')))
      ) {
        while (lineIdx + 1 < lines.length) {
          lineIdx++;
          fullLine += ' ' + lines[lineIdx].trim();
          if (fullLine.includes(')') && (fullLine.includes(';') || fullLine.includes('{'))) break;
        }
      }

      // Constructor in .cpp: ClassName::ClassName(...)
      const ctorDefMatch = fullLine.match(
        /^(([a-zA-Z0-9_:]+::)?([a-zA-Z0-9_]+))\s*::\s*\3\s*\(([^)]*)\)/,
      );
      if (ctorDefMatch) {
        const className = ctorDefMatch[3];
        const paramsRaw = ctorDefMatch[4];
        const hasOpenBrace =
          fullLine.includes('{') || (lineIdx + 1 < lines.length && lines[lineIdx + 1].trim().startsWith('{'));
        let bodyStatements: Statement[] = [];
        if (hasOpenBrace) {
          const { bodyLines, nextIdx } = this.collectBracedBlock(lines, lineIdx);
          i = nextIdx;
          bodyStatements = this.parseCppBlock(bodyLines);
        } else {
          i = lineIdx + 1;
        }
        const fnNodeId = `fn:${className}`;
        this.attachTrivia(fnNodeId, currentTrivia);
        currentTrivia = [];
        items.push({
          kind: 'FunctionDecl',
          name: className,
          typeParams: [],
          params: this.parseCppParams(paramsRaw),
          returnType: { kind: 'PrimitiveType', primitive: 'void', span: emptySpan(this.filePath) },
          isExpressionBodied: false,
          body: { kind: 'Block', statements: bodyStatements, span: emptySpan(this.filePath) },
          span: emptySpan(this.filePath),
        });
        continue;
      }

      // Free function / method
      const fnHeaderMatch = fullLine.match(
        /^((?:virtual|inline|static|explicit|const|constexpr)\s+)*([a-zA-Z0-9_:<>*&]+)\s+(([a-zA-Z0-9_:]+::)?([a-zA-Z0-9_]+))\s*\(([^)]*)\)\s*(const|noexcept|\s+)*(\{|;)?/,
      );
      if (fnHeaderMatch && !fullLine.startsWith('return') && !fullLine.startsWith('if')) {
        const retTypeStr = fnHeaderMatch[2];
        const shortName = fnHeaderMatch[5];
        const paramsRaw = fnHeaderMatch[6];
        const hasOpenBrace =
          fullLine.includes('{') || (lineIdx + 1 < lines.length && lines[lineIdx + 1].trim().startsWith('{'));
        let bodyStatements: Statement[] = [];
        if (hasOpenBrace) {
          const { bodyLines, nextIdx } = this.collectBracedBlock(lines, lineIdx);
          i = nextIdx;
          bodyStatements = this.parseCppBlock(bodyLines);
        } else {
          i = lineIdx + 1;
        }
        const fnNodeId = `fn:${shortName}`;
        this.attachTrivia(fnNodeId, currentTrivia);
        currentTrivia = [];
        const isSingleReturn = bodyStatements.length === 1 && bodyStatements[0]?.kind === 'ReturnStmt' && Boolean((bodyStatements[0] as any).value);
        items.push({
          kind: 'FunctionDecl',
          name: shortName,
          typeParams: [],
          params: this.parseCppParams(paramsRaw),
          returnType: this.parseCppType(retTypeStr),
          isExpressionBodied: Boolean(isSingleReturn),
          body: isSingleReturn ? (bodyStatements[0] as any).value : { kind: 'Block', statements: bodyStatements, span: emptySpan(this.filePath) },
          span: emptySpan(this.filePath),
        });
        continue;
      }

      i = lineIdx + 1;
    }

    const modPath = namespaceName ? namespaceName : baseName;
    return {
      ast: { kind: 'Module', path: modPath, items, span: emptySpan(this.filePath) },
      trivia: this.trivia,
    };
  }
}

export function decompileCpp(source: string, filePath = 'source.cpp'): { ast: Module; trivia: CstTriviaTable } {
  return new CppDecompiler(source, filePath).decompile();
}
