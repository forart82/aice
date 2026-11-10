/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Compatibility shim providing the TypeScript AST & Compiler API, plus bounded
 * LRU SourceFile memoization and single-pass symbol/import/test indexing.
 * In TypeScript 7+, the compiler binary is native; the AST parser is provided via typescript-legacy.
 */
import { createHash } from "node:crypto";
import * as path from "node:path";
import ts from "typescript-legacy";
import type { ImportDecl } from "../core/ast.js";

export interface TsDeclarationSpanInfo {
  name: string;
  kind: string;
  startLine: number;
  endLine: number;
  parentName?: string;
}

export interface TsTestBlockSpanInfo {
  id?: string;
  title: string;
  fullTitle: string;
  kind: "test" | "describe";
  startLine: number;
  endLine: number;
}

export interface TsFastImportEntry {
  source: string;
  specifiers: Array<{ name: string; alias?: string }>;
  isTypeOnly: boolean;
  startLine: number;
  endLine: number;
}

export interface TsFileSymbolIndex {
  sourceFile: ts.SourceFile;
  topLevelByName: Map<string, TsDeclarationSpanInfo[]>;
  membersByQualifiedName: Map<string, TsDeclarationSpanInfo[]>;
  orderedTopLevel: TsDeclarationSpanInfo[];
  testBlocks: TsTestBlockSpanInfo[];
  imports: TsFastImportEntry[];
}

const TS_LIKE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"]);

export function isTsLikeFilePath(filePath?: string): boolean {
  if (!filePath || filePath.startsWith("<")) return false;
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".d.ts")) return true;
  return TS_LIKE_EXTENSIONS.has(path.extname(lower));
}

function resolveScriptKind(filePath: string): ts.ScriptKind {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (lower.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".cjs")) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

function makeSourceCacheKey(source: string, scriptKind: ts.ScriptKind): string {
  const digest = createHash("sha256").update(source, "utf-8").digest("hex").slice(0, 20);
  return `${scriptKind}:${source.length}:${digest}`;
}

const MAX_TS_AST_CACHE = 24;
const sourceFileCache = new Map<string, ts.SourceFile>();
const symbolIndexCache = new Map<string, TsFileSymbolIndex>();

function touchLru<V>(map: Map<string, V>, key: string, val: V, maxEntries: number): void {
  if (map.has(key)) {
    map.delete(key);
  } else if (map.size >= maxEntries) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
  map.set(key, val);
}

export function getCachedTsSourceFile(
  source: string,
  filePath = "temp.ts",
  explicitScriptKind?: ts.ScriptKind,
): ts.SourceFile {
  const scriptKind = explicitScriptKind ?? resolveScriptKind(filePath);
  const key = makeSourceCacheKey(source, scriptKind);
  const cached = sourceFileCache.get(key);
  if (cached) {
    touchLru(sourceFileCache, key, cached, MAX_TS_AST_CACHE);
    return cached;
  }
  const sf = ts.createSourceFile(
    path.basename(filePath || "temp.ts"),
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  touchLru(sourceFileCache, key, sf, MAX_TS_AST_CACHE);
  return sf;
}

function nodeLineSpan(sf: ts.SourceFile, node: ts.Node): { startLine: number; endLine: number } {
  const startPos = node.getStart(sf);
  const rawEnd = node.getEnd();
  const endPos = rawEnd > startPos ? rawEnd - 1 : startPos;
  return {
    startLine: sf.getLineAndCharacterOfPosition(startPos).line + 1,
    endLine: sf.getLineAndCharacterOfPosition(endPos).line + 1,
  };
}

function normalizePropertyName(sf: ts.SourceFile, propName?: ts.PropertyName): string | null {
  if (!propName) return null;
  if (
    ts.isIdentifier(propName) ||
    ts.isStringLiteral(propName) ||
    ts.isNumericLiteral(propName) ||
    ts.isNoSubstitutionTemplateLiteral(propName)
  ) {
    return propName.text;
  }
  return propName.getText(sf);
}

function detectTestRunnerCall(expr: ts.Expression): "describe" | "test" | null {
  if (ts.isIdentifier(expr)) {
    if (expr.text === "describe") return "describe";
    if (expr.text === "test" || expr.text === "it") return "test";
    return null;
  }
  if (ts.isPropertyAccessExpression(expr)) {
    return detectTestRunnerCall(expr.expression);
  }
  if (ts.isCallExpression(expr)) {
    return detectTestRunnerCall(expr.expression);
  }
  if (ts.isTaggedTemplateExpression(expr)) {
    return detectTestRunnerCall(expr.tag);
  }
  return null;
}

export function getCachedTsSymbolIndex(source: string, filePath = "temp.ts"): TsFileSymbolIndex {
  const scriptKind = resolveScriptKind(filePath);
  const key = makeSourceCacheKey(source, scriptKind);
  const cached = symbolIndexCache.get(key);
  if (cached) {
    touchLru(symbolIndexCache, key, cached, MAX_TS_AST_CACHE);
    return cached;
  }

  const sf = getCachedTsSourceFile(source, filePath, scriptKind);
  const topLevelByName = new Map<string, TsDeclarationSpanInfo[]>();
  const membersByQualifiedName = new Map<string, TsDeclarationSpanInfo[]>();
  const orderedTopLevel: TsDeclarationSpanInfo[] = [];
  const testBlocks: TsTestBlockSpanInfo[] = [];
  const imports: TsFastImportEntry[] = [];

  const addTopLevel = (info: TsDeclarationSpanInfo) => {
    orderedTopLevel.push(info);
    let list = topLevelByName.get(info.name);
    if (!list) {
      list = [];
      topLevelByName.set(info.name, list);
    }
    list.push(info);
  };

  const addMember = (parentName: string, info: TsDeclarationSpanInfo) => {
    const qual = `${parentName}.${info.name}`;
    let list = membersByQualifiedName.get(qual);
    if (!list) {
      list = [];
      membersByQualifiedName.set(qual, list);
    }
    list.push(info);
  };

  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
      const span = nodeLineSpan(sf, stmt);
      const specifiers: Array<{ name: string; alias?: string }> = [];
      const clause = stmt.importClause;
      let isTypeOnly = Boolean(clause?.isTypeOnly);
      if (clause) {
        if (clause.name) {
          specifiers.push({ name: clause.name.text });
        }
        if (clause.namedBindings) {
          if (ts.isNamespaceImport(clause.namedBindings)) {
            specifiers.push({ name: "*", alias: clause.namedBindings.name.text });
          } else if (ts.isNamedImports(clause.namedBindings)) {
            const elements = clause.namedBindings.elements;
            if (elements.length > 0 && elements.every((e) => e.isTypeOnly)) {
              isTypeOnly = true;
            }
            for (const el of elements) {
              const orig = el.propertyName ? el.propertyName.text : el.name.text;
              const alias = el.propertyName ? el.name.text : undefined;
              specifiers.push({ name: orig, ...(alias ? { alias } : {}) });
            }
          }
        }
      }
      imports.push({
        source: stmt.moduleSpecifier.text,
        specifiers,
        isTypeOnly,
        ...span,
      });
      continue;
    }

    if (
      ts.isExportDeclaration(stmt) &&
      stmt.moduleSpecifier &&
      ts.isStringLiteral(stmt.moduleSpecifier)
    ) {
      const span = nodeLineSpan(sf, stmt);
      const specifiers: Array<{ name: string; alias?: string }> = [];
      let isTypeOnly = Boolean(stmt.isTypeOnly);
      if (stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
        const elements = stmt.exportClause.elements;
        if (elements.length > 0 && elements.every((e) => e.isTypeOnly)) {
          isTypeOnly = true;
        }
        for (const el of elements) {
          const orig = el.propertyName ? el.propertyName.text : el.name.text;
          const alias = el.propertyName ? el.name.text : undefined;
          specifiers.push({ name: orig, ...(alias ? { alias } : {}) });
        }
      } else {
        specifiers.push({ name: "*" });
      }
      imports.push({
        source: stmt.moduleSpecifier.text,
        specifiers,
        isTypeOnly,
        ...span,
      });
      continue;
    }

    if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      const span = nodeLineSpan(sf, stmt);
      addTopLevel({ name: stmt.name.text, kind: "function", ...span });
      continue;
    }

    if (ts.isClassDeclaration(stmt) && stmt.name) {
      const clsName = stmt.name.text;
      const span = nodeLineSpan(sf, stmt);
      addTopLevel({ name: clsName, kind: "class", ...span });
      for (const m of stmt.members) {
        if (ts.isConstructorDeclaration(m)) {
          const mSpan = nodeLineSpan(sf, m);
          addMember(clsName, {
            name: "constructor",
            kind: "method",
            parentName: clsName,
            ...mSpan,
          });
          addMember(clsName, { name: "init", kind: "method", parentName: clsName, ...mSpan });
        } else if (
          ts.isMethodDeclaration(m) ||
          ts.isGetAccessorDeclaration(m) ||
          ts.isSetAccessorDeclaration(m) ||
          ts.isPropertyDeclaration(m)
        ) {
          const mName = normalizePropertyName(sf, m.name);
          if (mName) {
            const mKind = ts.isPropertyDeclaration(m) ? "property" : "method";
            const mSpan = nodeLineSpan(sf, m);
            addMember(clsName, { name: mName, kind: mKind, parentName: clsName, ...mSpan });
          }
        }
      }
      continue;
    }

    if (ts.isInterfaceDeclaration(stmt)) {
      const ifaceName = stmt.name.text;
      const span = nodeLineSpan(sf, stmt);
      addTopLevel({ name: ifaceName, kind: "interface", ...span });
      for (const m of stmt.members) {
        if (ts.isPropertySignature(m) || ts.isMethodSignature(m)) {
          const mName = normalizePropertyName(sf, m.name);
          if (mName) {
            const mSpan = nodeLineSpan(sf, m);
            addMember(ifaceName, { name: mName, kind: "field", parentName: ifaceName, ...mSpan });
          }
        }
      }
      continue;
    }

    if (ts.isTypeAliasDeclaration(stmt)) {
      const span = nodeLineSpan(sf, stmt);
      addTopLevel({ name: stmt.name.text, kind: "type", ...span });
      if (ts.isTypeLiteralNode(stmt.type)) {
        const tName = stmt.name.text;
        for (const m of stmt.type.members) {
          if (ts.isPropertySignature(m) || ts.isMethodSignature(m)) {
            const mName = normalizePropertyName(sf, m.name);
            if (mName) {
              const mSpan = nodeLineSpan(sf, m);
              addMember(tName, { name: mName, kind: "field", parentName: tName, ...mSpan });
            }
          }
        }
      }
      continue;
    }

    if (ts.isEnumDeclaration(stmt)) {
      const enumName = stmt.name.text;
      const span = nodeLineSpan(sf, stmt);
      addTopLevel({ name: enumName, kind: "enum", ...span });
      for (const m of stmt.members) {
        const mName = normalizePropertyName(sf, m.name);
        if (mName) {
          const mSpan = nodeLineSpan(sf, m);
          addMember(enumName, { name: mName, kind: "variant", parentName: enumName, ...mSpan });
        }
      }
      continue;
    }

    if (ts.isVariableStatement(stmt)) {
      const decls = stmt.declarationList.declarations;
      const isConst = (stmt.declarationList.flags & ts.NodeFlags.Const) !== 0;
      for (const decl of decls) {
        const span = decls.length === 1 ? nodeLineSpan(sf, stmt) : nodeLineSpan(sf, decl);
        if (ts.isIdentifier(decl.name)) {
          const dName = decl.name.text;
          const isFnInit =
            decl.initializer &&
            (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer));
          const kind = isFnInit ? "function" : isConst ? "const" : "var";
          addTopLevel({ name: dName, kind, ...span });
          if (decl.initializer && ts.isObjectLiteralExpression(decl.initializer)) {
            for (const p of decl.initializer.properties) {
              if (
                ts.isPropertyAssignment(p) ||
                ts.isShorthandPropertyAssignment(p) ||
                ts.isMethodDeclaration(p)
              ) {
                const pName = normalizePropertyName(sf, p.name);
                if (pName) {
                  const pSpan = nodeLineSpan(sf, p);
                  addMember(dName, { name: pName, kind: "field", parentName: dName, ...pSpan });
                }
              }
            }
          }
        }
      }
    }
  }

  if (/\b(?:describe|test|it)\b/.test(source)) {
    const visitTestStatements = (stmts: readonly ts.Statement[], suiteStack: string[]) => {
      for (const st of stmts) {
        if (!ts.isExpressionStatement(st) || !ts.isCallExpression(st.expression)) continue;
        const call = st.expression;
        const runnerKind = detectTestRunnerCall(call.expression);
        if (!runnerKind || call.arguments.length === 0) continue;
        const firstArg = call.arguments[0];
        let title: string | null = null;
        if (ts.isStringLiteral(firstArg) || ts.isNoSubstitutionTemplateLiteral(firstArg)) {
          title = firstArg.text;
        } else if (ts.isTemplateExpression(firstArg)) {
          title = firstArg.getText(sf).slice(1, -1);
        }
        if (!title) continue;
        const span = nodeLineSpan(sf, st);
        const idMatch = title.match(/^([A-Za-z]{2,}(?:-[A-Za-z0-9_]+)+)\b/);
        const fullTitle = suiteStack.length > 0 ? `${suiteStack.join(" > ")} > ${title}` : title;
        testBlocks.push({
          ...(idMatch ? { id: idMatch[1] } : {}),
          title,
          fullTitle,
          kind: runnerKind,
          ...span,
        });
        if (runnerKind === "describe") {
          const cb = call.arguments[call.arguments.length - 1];
          if (
            cb &&
            (ts.isArrowFunction(cb) || ts.isFunctionExpression(cb)) &&
            ts.isBlock(cb.body)
          ) {
            visitTestStatements(cb.body.statements, [...suiteStack, title]);
          }
        }
      }
    };
    visitTestStatements(sf.statements, []);
  }

  const index: TsFileSymbolIndex = {
    sourceFile: sf,
    topLevelByName,
    membersByQualifiedName,
    orderedTopLevel,
    testBlocks,
    imports,
  };
  touchLru(symbolIndexCache, key, index, MAX_TS_AST_CACHE);
  return index;
}

export function extractFastTsImports(source: string, filePath = "temp.ts"): ImportDecl[] {
  const entries = getCachedTsSymbolIndex(source, filePath).imports;
  return entries.map((imp) => {
    const impSpan = {
      file: filePath,
      start: { line: imp.startLine, column: 1, offset: 0 },
      end: { line: imp.endLine, column: 1, offset: 0 },
    };
    return {
      kind: "ImportDecl",
      source: imp.source,
      specifiers: imp.specifiers.map((s) => ({
        name: s.name,
        ...(s.alias ? { alias: s.alias } : {}),
        span: impSpan,
      })),
      span: impSpan,
    };
  });
}

export default ts;
