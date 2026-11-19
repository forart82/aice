import * as fs from "node:fs";
import * as path from "node:path";
import ts from "typescript-legacy";
import { describe, expect, it } from "vitest";
import * as binAiceBarrel from "../../bin/aice.js";
import { normalizeCliContextFlag } from "../../src/cli/telemetry-and-flags.js";
import * as cliEntryBarrel from "../../src/cli.js";
import type { FunctionDecl, MemberAccessExpr, ReturnStmt } from "../../src/core/ast.js";
import { parseExpr } from "../../src/core/parser/expressions.js";
import { Parser } from "../../src/core/parser/parser-class.js";
import * as parserBarrel from "../../src/core/parser.js";
import {
  compileFocusPattern,
  detectContiguousImportBlock,
  extractSymbolFocusSlice,
  formatLargeLineRangeWithElision,
  isDecorativeDividerComment,
  parseSymbolPatternSelector,
} from "../../src/tools/context/focus-and-elision.js";
import {
  doesFileStemMatchQuery,
  extractPatternMatchesDetailed,
  extractPrimaryQueryKeyword,
  hasCatastrophicNestedQuantifiers,
  isCommentLine,
  isDeclarationLine,
  isExactDefinitionLine,
  isTestOrMockPath,
} from "../../src/tools/context/pattern-search.js";
import * as contextBarrel from "../../src/tools/context.js";
import {
  closeUnclosedMarkdownFence,
  computeDynamicReadBudget,
  computeDynamicSliceSpan,
} from "../../src/tools/read/dynamic-budget.js";
import {
  expandBracePatterns,
  globPatternToRegExp,
  parseReadTarget,
  splitCommaSelectors,
  splitReadTargetString,
} from "../../src/tools/read/target-parsing.js";
import * as readBarrel from "../../src/tools/read.js";
import {
  applyHunksToScope,
  buildEmptySpliceBlockError,
  containsHunkMarkers,
  extractHunkBlocks,
  stripNumberedGutterPrefixes,
} from "../../src/tools/splice/hunks.js";
import {
  isCreateOrOverwriteSymbol,
  parseMultiBlockSpliceStream,
  splitInlineFileSelector,
} from "../../src/tools/splice/stream-parser.js";
import * as spliceBarrel from "../../src/tools/splice.js";

const REPO_ROOT = process.cwd();

interface ImportEdge {
  from: string;
  to: string;
  isTypeOnly: boolean;
}

/**
 * Extracts all relative import/export edges from a TypeScript file using the TS AST
 * so strings/comments never produce false positives and multi-line imports are exact.
 */
function collectRelativeEdges(absFile: string): ImportEdge[] {
  const source = fs.readFileSync(absFile, "utf-8");
  const sf = ts.createSourceFile(absFile, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const dir = path.dirname(absFile);
  const edges: ImportEdge[] = [];

  const resolveSpec = (spec: string): string | null => {
    if (!spec.startsWith(".")) return null;
    const base = path.resolve(dir, spec);
    const candidates = [
      base.replace(/\.js$/, ".ts"),
      base.replace(/\.mjs$/, ".ts"),
      base,
      `${base}.ts`,
      path.join(base, "index.ts"),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c) && fs.statSync(c).isFile()) {
        return path.resolve(c);
      }
    }
    return null;
  };

  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
      const target = resolveSpec(stmt.moduleSpecifier.text);
      if (target) {
        const clause = stmt.importClause;
        const isTypeOnly = Boolean(
          clause?.isTypeOnly ||
            (clause?.namedBindings &&
              ts.isNamedImports(clause.namedBindings) &&
              !clause.name &&
              clause.namedBindings.elements.length > 0 &&
              clause.namedBindings.elements.every((el) => el.isTypeOnly)),
        );
        edges.push({ from: absFile, to: target, isTypeOnly });
      }
    } else if (
      ts.isExportDeclaration(stmt) &&
      stmt.moduleSpecifier &&
      ts.isStringLiteral(stmt.moduleSpecifier)
    ) {
      const target = resolveSpec(stmt.moduleSpecifier.text);
      if (target) {
        const isTypeOnly = Boolean(
          stmt.isTypeOnly ||
            (stmt.exportClause &&
              ts.isNamedExports(stmt.exportClause) &&
              stmt.exportClause.elements.length > 0 &&
              stmt.exportClause.elements.every((el) => el.isTypeOnly)),
        );
        edges.push({ from: absFile, to: target, isTypeOnly });
      }
    }
  }

  return edges;
}

/**
 * Runs 3-color DFS cycle detection over a closed set of TypeScript files.
 * Returns an array of detected cycles (each formatted as relA -> relB -> ... -> relA).
 */
function findImportCycles(absFiles: string[], includeTypeOnly: boolean): string[] {
  const fileSet = new Set(absFiles.map((f) => path.resolve(f)));
  const adj = new Map<string, string[]>();
  for (const f of fileSet) {
    const edges = collectRelativeEdges(f)
      .filter((e) => (includeTypeOnly || !e.isTypeOnly) && fileSet.has(e.to))
      .map((e) => e.to);
    adj.set(f, [...new Set(edges)]);
  }

  const color = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];
  const cycles: string[] = [];

  const dfs = (node: string) => {
    color.set(node, 1);
    stack.push(node);
    for (const next of adj.get(node) ?? []) {
      const state = color.get(next) ?? 0;
      if (state === 1) {
        const idx = stack.indexOf(next);
        const cycle = [...stack.slice(idx), next].map((p) =>
          path.relative(REPO_ROOT, p).replace(/\\/g, "/"),
        );
        cycles.push(cycle.join(" -> "));
      } else if (state === 0) {
        dfs(next);
      }
    }
    stack.pop();
    color.set(node, 2);
  };

  for (const f of fileSet) {
    if ((color.get(f) ?? 0) === 0) {
      dfs(f);
    }
  }
  return cycles;
}

function listTsFilesInDir(relDir: string): string[] {
  const absDir = path.join(REPO_ROOT, relDir);
  return fs
    .readdirSync(absDir)
    .filter((f) => f.endsWith(".ts"))
    .sort()
    .map((f) => path.join(absDir, f));
}

describe("Phase 3 Modular Barrels: Export Parity, Acyclic DAGs & Extracted Submodule Unit Tests", () => {
  describe("1. Barrel Export Completeness & Slim Barrel Contracts (5 Modularized Trees)", () => {
    it("src/tools/splice.ts re-exports all 27 runtime exports from 11 submodules", () => {
      const submodules = listTsFilesInDir("src/tools/splice").map((p) => path.basename(p));
      expect(submodules).toEqual([
        "ast-helpers.ts",
        "batch.ts",
        "dialect-splice.ts",
        "hunks.ts",
        "line-range-splice.ts",
        "native-ast-splice.ts",
        "native-orchestrator.ts",
        "span-locators.ts",
        "stream-parser.ts",
        "ts-and-script-spans.ts",
        "types.ts",
      ]);

      const expectedExports = [
        "applyHunksToScope",
        "buildEmptySpliceBlockError",
        "containsHunkMarkers",
        "dedentCode",
        "extractHunkBlocks",
        "extractNativeTestBlocks",
        "extractScriptOrMarkdownSymbols",
        "findSpliceTargetSymbol",
        "generateUnifiedDiff",
        "getLineEnd",
        "getNodeEndOffset",
        "getStatementEndOffset",
        "indentCode",
        "inferSnippetParamArity",
        "isCreateOrOverwriteSymbol",
        "locateImportBlockSpan",
        "locateNativeDeclarationSpan",
        "locateScriptOrMarkdownSpan",
        "matchNativeTestBlockSpan",
        "parseMultiBlockSpliceStream",
        "splice",
        "spliceBatch",
        "spliceNativeSource",
        "spliceNativeSymbolFromExpandedAst",
        "spliceSource",
        "splitInlineFileSelector",
        "stripNumberedGutterPrefixes",
      ];

      expect(Object.keys(spliceBarrel).sort()).toEqual(expectedExports);
      for (const name of expectedExports) {
        expect(typeof (spliceBarrel as Record<string, unknown>)[name]).toBe("function");
      }
      expect(spliceBarrel.applyHunksToScope).toBe(applyHunksToScope);
      expect(spliceBarrel.parseMultiBlockSpliceStream).toBe(parseMultiBlockSpliceStream);

      const barrelLines = fs
        .readFileSync(path.join(REPO_ROOT, "src/tools/splice.ts"), "utf-8")
        .split(/\r?\n/).length;
      expect(barrelLines).toBeLessThanOrEqual(80);
    });

    it("src/tools/context.ts re-exports all 34 runtime exports from 8 submodules", () => {
      const submodules = listTsFilesInDir("src/tools/context").map((p) => path.basename(p));
      expect(submodules).toEqual([
        "callers-and-workspace.ts",
        "focus-and-elision.ts",
        "honest-baseline.ts",
        "imports-and-deps.ts",
        "orchestrator.ts",
        "pattern-search.ts",
        "targets-and-merge.ts",
        "types.ts",
      ]);

      const expectedExports = [
        "buildSiblingOutline",
        "compileFocusPattern",
        "computeHonestReadBaselineText",
        "computeLineRangeBaselineText",
        "computeRegexBaselineText",
        "computeRegexContextBaselineText",
        "detectContiguousImportBlock",
        "doesFileStemMatchQuery",
        "extractImportsFromFile",
        "extractPatternMatchesDetailed",
        "extractPrimaryQueryKeyword",
        "extractSymbolFocusSlice",
        "extractSymbolFromAiceSource",
        "formatCompactBareFileSource",
        "formatLargeLineRangeWithElision",
        "generateContext",
        "generateMultiContext",
        "generateWorkspaceContext",
        "isCommentLine",
        "isDeclarationLine",
        "isDecorativeDividerComment",
        "isExactDefinitionLine",
        "isTestOrMockPath",
        "mergeMultiContextResults",
        "normalizeGrepBreAlternation",
        "packContext",
        "packageContext",
        "parseSymbolPatternSelector",
        "parseTargetWithInlineSymbol",
        "resolveFirstActionableSymbol",
        "resolveImportPath",
        "scanDirectoryForTargets",
        "splitContextTargets",
        "splitSymbolSelectors",
      ];

      expect(Object.keys(contextBarrel).sort()).toEqual(expectedExports);
      for (const name of expectedExports) {
        expect(typeof (contextBarrel as Record<string, unknown>)[name]).toBe("function");
      }
      expect(contextBarrel.extractPatternMatchesDetailed).toBe(extractPatternMatchesDetailed);
      expect(contextBarrel.extractSymbolFocusSlice).toBe(extractSymbolFocusSlice);

      const barrelLines = fs
        .readFileSync(path.join(REPO_ROOT, "src/tools/context.ts"), "utf-8")
        .split(/\r?\n/).length;
      expect(barrelLines).toBeLessThanOrEqual(80);
    });

    it("src/tools/read.ts re-exports all 21 runtime exports from 6 submodules", () => {
      const submodules = listTsFilesInDir("src/tools/read").map((p) => path.basename(p));
      expect(submodules).toEqual([
        "discovery.ts",
        "dynamic-budget.ts",
        "engine.ts",
        "search.ts",
        "target-parsing.ts",
        "types-and-budgets.ts",
      ]);

      const expectedExports = [
        "DEFAULT_AUTO_OUTLINE_LINE_THRESHOLD",
        "DEFAULT_CLI_READ_MAX_BYTES",
        "DEFAULT_CLI_READ_MAX_TOKENS",
        "DEFAULT_CLI_READ_SOFT_BYTE_CAP",
        "DEFAULT_CLI_READ_SOFT_TOKEN_CAP",
        "DEFAULT_CLI_SLICE_BYTE_BUDGET",
        "DEFAULT_READ_MAX_BYTES",
        "DEFAULT_READ_MAX_TOKENS",
        "DEFAULT_READ_SOFT_BYTE_CAP",
        "DEFAULT_READ_SOFT_TOKEN_CAP",
        "DEFAULT_SLICE_BYTE_BUDGET",
        "aiceRead",
        "computeDynamicReadBudget",
        "computeDynamicSliceSpan",
        "countSourceLines",
        "normalizeReadTargets",
        "parseReadTarget",
        "read",
        "resolveEffectiveReadBudgets",
        "splitCommaSelectors",
        "splitReadTargetString",
      ];

      expect(Object.keys(readBarrel).sort()).toEqual(expectedExports);
      expect(readBarrel.DEFAULT_CLI_READ_MAX_BYTES).toBe(9_216);
      expect(readBarrel.DEFAULT_READ_MAX_BYTES).toBe(28_672);
      expect(readBarrel.computeDynamicReadBudget).toBe(computeDynamicReadBudget);
      expect(readBarrel.parseReadTarget).toBe(parseReadTarget);

      const barrelLines = fs
        .readFileSync(path.join(REPO_ROOT, "src/tools/read.ts"), "utf-8")
        .split(/\r?\n/).length;
      expect(barrelLines).toBeLessThanOrEqual(70);
    });

    it("src/core/parser.ts re-exports all 5 runtime exports from 7 submodules", () => {
      const submodules = listTsFilesInDir("src/core/parser").map((p) => path.basename(p));
      expect(submodules).toEqual([
        "core.ts",
        "declarations.ts",
        "expressions.ts",
        "parser-class.ts",
        "statements.ts",
        "trivia.ts",
        "ui-and-styles.ts",
      ]);

      expect(Object.keys(parserBarrel).sort()).toEqual([
        "Parser",
        "ParserError",
        "Precedence",
        "parse",
        "parseWithTrivia",
      ]);
      expect(parserBarrel.Parser).toBe(Parser);

      const barrelLines = fs
        .readFileSync(path.join(REPO_ROOT, "src/core/parser.ts"), "utf-8")
        .split(/\r?\n/).length;
      expect(barrelLines).toBeLessThanOrEqual(25);
    });

    it("bin/aice.ts + src/cli/*.ts export exact CLI API and register core subcommands", () => {
      const submodules = listTsFilesInDir("src/cli").map((p) => path.basename(p));
      expect(submodules).toEqual([
        "admin-commands.ts",
        "compile-commands.ts",
        "mcp-and-bench-commands.ts",
        "read-commands.ts",
        "splice-commands.ts",
        "telemetry-and-flags.ts",
        "utility-commands.ts",
      ]);

      expect(Object.keys(binAiceBarrel).sort()).toEqual([
        "executeCompile",
        "normalizeCliContextFlag",
        "program",
        "recordCliFailureTelemetry",
      ]);
      expect(cliEntryBarrel.program).toBe(binAiceBarrel.program);
      expect(binAiceBarrel.normalizeCliContextFlag).toBe(normalizeCliContextFlag);

      const commandNames = binAiceBarrel.program.commands.map((c) => c.name());
      for (const required of [
        "read",
        "search",
        "find",
        "splice",
        "mcp",
        "enable",
        "disable",
        "config",
        "agents",
        "gain",
        "analyze",
      ]) {
        expect(commandNames).toContain(required);
      }

      const barrelLines = fs
        .readFileSync(path.join(REPO_ROOT, "bin/aice.ts"), "utf-8")
        .split(/\r?\n/).length;
      expect(barrelLines).toBeLessThanOrEqual(180);
    });
  });

  describe("2. Acyclic Import DAG Verification (Zero Circular Dependencies)", () => {
    const modularTrees: Array<{ label: string; files: string[] }> = [
      {
        label: "splice tree (src/tools/splice.ts + src/tools/splice/*.ts)",
        files: [
          path.join(REPO_ROOT, "src/tools/splice.ts"),
          ...listTsFilesInDir("src/tools/splice"),
        ],
      },
      {
        label: "context tree (src/tools/context.ts + src/tools/context/*.ts)",
        files: [
          path.join(REPO_ROOT, "src/tools/context.ts"),
          ...listTsFilesInDir("src/tools/context"),
        ],
      },
      {
        label: "read tree (src/tools/read.ts + src/tools/read/*.ts)",
        files: [path.join(REPO_ROOT, "src/tools/read.ts"), ...listTsFilesInDir("src/tools/read")],
      },
      {
        label: "parser tree (src/core/parser.ts + src/core/parser/*.ts)",
        files: [path.join(REPO_ROOT, "src/core/parser.ts"), ...listTsFilesInDir("src/core/parser")],
      },
      {
        label: "CLI tree (bin/aice.ts + src/cli/*.ts)",
        files: [path.join(REPO_ROOT, "bin/aice.ts"), ...listTsFilesInDir("src/cli")],
      },
    ];

    for (const tree of modularTrees) {
      it(`has 0 runtime and 0 type-level circular dependencies in ${tree.label}`, () => {
        expect(findImportCycles(tree.files, false)).toEqual([]);
        expect(findImportCycles(tree.files, true)).toEqual([]);
      });
    }

    it("prevents any submodule from back-importing its own parent barrel", () => {
      for (const tree of modularTrees) {
        const firstFile = tree.files[0];
        expect(firstFile).toBeDefined();
        if (!firstFile) continue;
        const barrelAbs = path.resolve(firstFile);
        for (const submoduleAbs of tree.files.slice(1)) {
          const edges = collectRelativeEdges(submoduleAbs);
          const backEdges = edges.filter((e) => e.to === barrelAbs);
          expect(backEdges).toEqual([]);
        }
      }
    });
  });

  describe("3. Direct Submodule Unit Tests", () => {
    it("splice/hunks.ts: strips numbered gutters, parses hunks, applies indent-shifted edits, and reports empty-block errors", () => {
      const numbered = "12│ const a = 1;\n13│ const b = 2;";
      expect(stripNumberedGutterPrefixes(numbered)).toBe("const a = 1;\nconst b = 2;");

      const hunkSnippet = [
        "<<<",
        "  const total = a + b;",
        "  return total;",
        "===",
        "  const total = (a + b) * 2;",
        "  return total;",
        ">>>",
      ].join("\n");
      expect(containsHunkMarkers(hunkSnippet)).toBe(true);
      expect(containsHunkMarkers("const x = 1;")).toBe(false);

      const blocks = extractHunkBlocks(hunkSnippet);
      expect(blocks).toHaveLength(1);
      expect(blocks[0]?.search).toContain("const total = a + b;");
      expect(blocks[0]?.replace).toContain("(a + b) * 2");

      // Scope has deeper 4-space indentation than the 2-space hunk: whitespace fallback must preserve 4-space indent
      const scope = [
        "function calc(a: number, b: number) {",
        "    const total = a + b;",
        "    return total;",
        "}",
      ].join("\n");
      const applied = applyHunksToScope(scope, blocks, "calc", "src/math.ts", "typescript");
      expect(applied).toContain("    const total = (a + b) * 2;");
      expect(applied).toContain("    return total;");

      const emptyErr = buildEmptySpliceBlockError("src/math.ts", "calc");
      expect(emptyErr).toBeInstanceOf(Error);
      expect(emptyErr.message).toContain("src/math.ts");
      expect(emptyErr.message).toContain("calc");
    });

    it("splice/stream-parser.ts: classifies create/overwrite selectors, splits inline selectors, and parses multi-block streams", () => {
      expect(isCreateOrOverwriteSymbol("create")).toBe(true);
      expect(isCreateOrOverwriteSymbol("overwrite")).toBe(true);
      expect(isCreateOrOverwriteSymbol("myFunc")).toBe(false);

      expect(splitInlineFileSelector("src/app.ts:Game.step")).toEqual({
        filePath: "src/app.ts",
        inlineSelector: "Game.step",
      });
      expect(splitInlineFileSelector("src/app.ts:L10-L25")).toEqual({
        filePath: "src/app.ts",
        inlineSelector: "L10-L25",
      });
      expect(splitInlineFileSelector("Makefile:L1-L3")).toEqual({
        filePath: "Makefile",
        inlineSelector: "L1-L3",
      });

      const stream = [
        "=== src/new_file.ts ===",
        "export const ANSWER = 42;",
        "=== src/app.ts:compute ===",
        "export function compute() { return 42; }",
        "=== src/old.ts:legacyFn === --delete",
        "=== src/notes.toml:L2-L4 ===",
        'mode = "fast"',
      ].join("\n");
      const parsed = parseMultiBlockSpliceStream(stream);
      expect(parsed).not.toBeNull();
      expect(parsed?.batchItems).toHaveLength(4);
      expect(parsed?.batchItems?.[0]?.filePath).toBe("src/new_file.ts");
      expect(parsed?.batchItems?.[1]?.symbol).toBe("compute");
      expect(parsed?.batchItems?.[2]?.delete).toBe(true);
      expect(parsed?.batchItems?.[3]?.symbol).toBe("L2-L4");
    });

    it("context/pattern-search.ts: blocks catastrophic ReDoS, classifies lines, and ranks Tier 1 definitions above usages", () => {
      expect(hasCatastrophicNestedQuantifiers("(a+)+$")).toBe(true);
      expect(hasCatastrophicNestedQuantifiers("computeTokenBudget")).toBe(false);

      expect(extractPrimaryQueryKeyword("/computeBudget\\(/")).toBe("computeBudget");
      expect(doesFileStemMatchQuery("src/tools/budget.ts", "budget")).toBe(true);
      expect(isTestOrMockPath("tests/unit/budget.test.ts")).toBe(true);
      expect(isTestOrMockPath("src/tools/budget.ts")).toBe(false);
      expect(isCommentLine("  // helper comment", "src/a.ts")).toBe(true);
      expect(isCommentLine("export function run() {}", "src/a.ts")).toBe(false);
      expect(isDeclarationLine("export function computeBudget(n: number) {", "src/a.ts")).toBe(
        true,
      );
      expect(
        isExactDefinitionLine("export function computeBudget(n: number) {", "computeBudget"),
      ).toBe(true);

      const sampleSource = [
        "// computeBudget comment mention",
        "const x = computeBudget(10);",
        "export function computeBudget(n: number): number {",
        "  return n * 2;",
        "}",
      ].join("\n");

      const detail = extractPatternMatchesDetailed(sampleSource, "computeBudget", 1, {
        filePath: "src/budget.ts",
      });
      expect(detail).toBeDefined();
      expect(detail?.formattedText).toContain("export function computeBudget");

      const usageOnly = extractPatternMatchesDetailed(
        "const x = computeBudget(10);\n",
        "computeBudget",
        1,
        { filePath: "src/caller.ts" },
      );
      expect(detail).toBeDefined();
      expect(usageOnly).toBeDefined();
      if (detail && usageOnly) {
        expect(detail.maxScore).toBeGreaterThan(usageOnly.maxScore);
      }

      expect(() => extractPatternMatchesDetailed(sampleSource, "/(a+)+$/")).toThrow(/Unsafe/i);
    });

    it("context/focus-and-elision.ts: parses :sym@pattern, elides large ranges, and extracts focused symbol windows", () => {
      expect(parseSymbolPatternSelector("Engine.tick@collision")).toEqual({
        symbol: "Engine.tick",
        pattern: "collision",
      });
      expect(parseSymbolPatternSelector("L1-L20")).toBeNull();
      expect(parseSymbolPatternSelector("fn@clone(other)")).toBeNull();
      expect(parseSymbolPatternSelector("fn@first")).toBeNull();

      // Uppercase => case-sensitive; lowercase => case-insensitive; invalid regex => literal fallback
      expect(compileFocusPattern("TokenBudget").flags).not.toContain("i");
      expect(compileFocusPattern("tokenbudget").flags).toContain("i");
      expect(compileFocusPattern("[unclosed(literal").test("x [unclosed(literal y")).toBe(true);

      expect(isDecorativeDividerComment("// ========================")).toBe(true);
      expect(isDecorativeDividerComment("// actual note 123")).toBe(false);

      const rawLines = [
        ...Array.from({ length: 32 }, (_, i) => `import { m${i} } from "./m${i}.js";`),
        "",
        "// =========================",
        "export const VALUE = 1;",
      ];
      expect(detectContiguousImportBlock(rawLines, 1, rawLines.length)).toEqual({
        impStart: 1,
        impEnd: 32,
      });
      const elided = formatLargeLineRangeWithElision(rawLines, 1, rawLines.length);
      expect(elided).toContain("32 import lines folded");
      expect(elided).toContain("VALUE = 1");
      expect(elided).not.toContain("=========================");

      const bigFnLines = [
        "export function processOrder(orderId: string): number {",
        "  let score = 0;",
        ...Array.from({ length: 40 }, (_, i) => `  score += ${i + 1};`),
        '  const needleTag = "SPECIAL_FOCUS_TOKEN";',
        "  if (needleTag.length > 0) score += 100;",
        ...Array.from({ length: 30 }, (_, i) => `  score += ${i + 100};`),
        "  return score;",
        "}",
      ];
      const focusOut = extractSymbolFocusSlice(
        bigFnLines.join("\n"),
        "src/orders.ts",
        "processOrder",
        "SPECIAL_FOCUS_TOKEN",
      );
      expect(focusOut).toContain("export function processOrder");
      expect(focusOut).toContain("SPECIAL_FOCUS_TOKEN");
    });

    it("read/target-parsing.ts: splits comma selectors, parses read targets, and expands glob braces", () => {
      expect(splitCommaSelectors('foo, bar, /a,b/, "c,d", {e,f}')).toEqual([
        "foo",
        "bar",
        "/a,b/",
        '"c,d"',
        "{e,f}",
      ]);

      const parsed = parseReadTarget("src/app.ts:GameEngine.step@collision");
      expect(parsed.targetPath).toBe("src/app.ts");
      expect(parsed.inlineSelector).toBe("GameEngine.step@collision");

      expect(splitReadTargetString("src/a.ts:fnA src/b.ts:L1-L20")).toEqual([
        "src/a.ts:fnA",
        "src/b.ts:L1-L20",
      ]);

      expect(expandBracePatterns("src/{tools,core}/*.{ts,tsx}")).toEqual([
        "src/tools/*.ts",
        "src/tools/*.tsx",
        "src/core/*.ts",
        "src/core/*.tsx",
      ]);
      const re = globPatternToRegExp("src/**/*.test.ts");
      expect(re.test("src/unit/foo.test.ts")).toBe(true);
      expect(re.test("src/unit/foo.ts")).toBe(false);
    });

    it("read/dynamic-budget.ts: performs smallest-first water-filling, AST-snapped slice spans, and fence closure", () => {
      const budget = computeDynamicReadBudget(
        [
          { id: "huge.ts", rawBytes: 40_000, lineCount: 900 },
          { id: "small.ts", rawBytes: 600, lineCount: 20 },
          { id: "medium.ts", rawBytes: 2_000, lineCount: 60 },
        ],
        {
          maxBytes: 9_216,
          softByteCap: 8_704,
          maxTokens: 5_000,
          softTokenCap: 4_600,
        },
      );
      expect(budget.inlineIds.has("small.ts")).toBe(true);
      expect(budget.inlineIds.has("medium.ts")).toBe(true);
      expect(budget.autoOutlineIds.has("huge.ts")).toBe(true);

      const bigSource = Array.from(
        { length: 240 },
        (_, i) => `export function fn_${i}(x: number): number { return x + ${i}; }`,
      ).join("\n");
      const span = computeDynamicSliceSpan("src/many.ts", bigSource, 1, 6_912);
      expect(span.startLine).toBe(1);
      expect(span.endLine).toBeGreaterThanOrEqual(80);
      expect(span.endLine).toBeLessThanOrEqual(180);

      expect(closeUnclosedMarkdownFence("```ts\nconst x = 1;")).toMatch(/```\s*$/);
      expect(closeUnclosedMarkdownFence("```ts\nconst x = 1;\n```")).toBe(
        "```ts\nconst x = 1;\n```",
      );
    });

    it("core/parser/expressions.ts: parses :: scope access with isScopeAccess=true vs . member access", () => {
      // Direct parseExpr test on `A::B::C`
      const parser = Parser.fromSource("A::B::C", "scope.aice");
      const expr = parseExpr(parser);
      expect(expr.kind).toBe("MemberAccessExpr");
      const outer = expr as MemberAccessExpr;
      expect(outer.property).toBe("C");
      expect(outer.isScopeAccess).toBe(true);
      expect(outer.object.kind).toBe("MemberAccessExpr");
      const inner = outer.object as MemberAccessExpr;
      expect(inner.property).toBe("B");
      expect(inner.isScopeAccess).toBe(true);

      // Contrast with dot member access (`obj.field`) which must NOT set isScopeAccess
      const dotExpr = parseExpr(Parser.fromSource("obj.field", "dot.aice")) as MemberAccessExpr;
      expect(dotExpr.kind).toBe("MemberAccessExpr");
      expect(dotExpr.property).toBe("field");
      expect(dotExpr.isScopeAccess).toBeUndefined();

      // Full module parse preserving :: inside function body and type annotations
      const mod = parserBarrel.parse(
        "fn getVal(x: std::string) -> std::string:\n  ret std::cmp::min(x, a.b)\n",
        "scope_mod.aice",
      );
      expect(mod.items).toHaveLength(1);
      const fn = mod.items[0] as FunctionDecl;
      expect(fn.params[0]?.typeAnnotation?.kind).toBe("NamedType");
      if (fn.params[0]?.typeAnnotation?.kind === "NamedType") {
        expect(fn.params[0].typeAnnotation.name).toBe("std::string");
      }
      expect(fn.body.kind).toBe("Block");
      const retStmt = (fn.body.kind === "Block" ? fn.body.statements[0] : undefined) as ReturnStmt;
      expect(retStmt.value?.kind).toBe("CallExpr");
      if (retStmt.value?.kind === "CallExpr") {
        const callee = retStmt.value.callee as MemberAccessExpr;
        expect(callee.isScopeAccess).toBe(true);
        expect(callee.property).toBe("min");
        const secondArg = retStmt.value.args[1] as MemberAccessExpr;
        expect(secondArg.isScopeAccess).toBeUndefined();
      }
    });

    it("cli/telemetry-and-flags.ts: normalizes MCP-style flags for CLI read/search/find while leaving other commands untouched", () => {
      expect(
        normalizeCliContextFlag(
          ["read", "src", "--files-only=true", "--context-lines=5", "--max-tokens=4000"],
          { from: "user" },
        ),
      ).toEqual(["read", "src", "--files", "-C", "5", "--max-tokens=4000"]);

      // False boolean flags are dropped cleanly
      expect(
        normalizeCliContextFlag(["read", "src/app.ts", "--files-only=false", "--no-files"], {
          from: "user",
        }),
      ).toEqual(["read", "src/app.ts"]);

      // Non-read subcommands pass through unmodified
      const spliceArgs = ["splice", "src/app.ts", "--files-only=true"];
      expect(normalizeCliContextFlag(spliceArgs, { from: "user" })).toEqual(spliceArgs);

      // Arguments after `--` terminator are never rewritten
      expect(
        normalizeCliContextFlag(["search", "--", "--context-lines=5"], { from: "user" }),
      ).toEqual(["search", "--", "--context-lines=5"]);
    });
  });
});
