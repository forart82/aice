/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Bidirectional Roundtrip Transpilation & Lossless Lens Engine.
 * Verifies Bancilhon & Spyratos Put/Get Law:
 *   Put(Get(c), Omega) == c
 */

import ts from "../compat/typescript.js";
import type { Module } from "../core/ast.js";
import { parse, parseWithTrivia } from "../core/parser.js";
import { type CstTriviaTable, createAstNodeSnapshot, getNodeTriviaId } from "../core/trivia.js";
import { emitTarget, type TargetLanguage } from "../emitters/index.js";
import { AilGenerator } from "./ail-generator.js";
import { CppDecompiler } from "./cpp-decompiler.js";
import { CSharpDecompiler } from "./csharp-decompiler.js";
import { CssDecompiler } from "./css-decompiler.js";
import { HtmlDecompiler } from "./html-decompiler.js";
import { TsDecompiler } from "./ts-decompiler.js";

export interface RoundtripResult {
  target: TargetLanguage;
  original: string;
  ail: string;
  reconstructed: string;
  isIdentical: boolean;
  diff?: string;
  triviaEntriesCount: number;
}

export interface AilRoundtripResult {
  target: TargetLanguage;
  ailOriginal: string;
  targetReconstructed: string;
  ailReconstructed: string;
  isTargetIdentical: boolean;
  isAilIdentical: boolean;
}

export function executeRoundtrip(
  source: string,
  target: TargetLanguage,
  filePath = "source",
): RoundtripResult {
  let decompileResult: ReturnType<TsDecompiler["decompile"]>;

  switch (target) {
    case "typescript":
    case "tsx": {
      const decompiler = new TsDecompiler(source, filePath, { isTsx: target === "tsx" });
      decompileResult = decompiler.decompile();
      break;
    }
    case "css": {
      const decompiler = new CssDecompiler(source, filePath);
      decompileResult = decompiler.decompile();
      break;
    }
    case "cpp": {
      const decompiler = new CppDecompiler(source, filePath);
      decompileResult = decompiler.decompile();
      break;
    }
    case "csharp": {
      const decompiler = new CSharpDecompiler(source, filePath);
      decompileResult = decompiler.decompile();
      break;
    }
    case "html": {
      const decompiler = new HtmlDecompiler(source, filePath);
      decompileResult = decompiler.decompile();
      break;
    }
    default:
      throw new Error(`Unsupported target language for roundtrip: ${target}`);
  }

  const { ast, trivia } = decompileResult;

  // Preserve CST source slices & original source for lossless roundtrip
  trivia.setOriginalSource(source);
  if (target === "typescript" || target === "tsx") {
    preserveTypeScriptSourceSlices(source, ast, trivia, filePath, target === "tsx");
  }

  // Generate AIL source code
  const ailGenerator = new AilGenerator({ trivia });
  const ail = ailGenerator.generate(ast);

  // Put: Emit back to target language with trivia
  const reconstructed = emitTarget(ast, target, { trivia, watermark: false });

  // Normalize whitespace for diff comparison
  const normOriginal = normalizeWhitespace(source);
  const normReconstructed = normalizeWhitespace(reconstructed);
  const isIdentical = normOriginal === normReconstructed;

  let diff: string | undefined;
  if (!isIdentical) {
    diff = generateSimpleDiff(normOriginal, normReconstructed);
  }

  return {
    target,
    original: source,
    ail,
    reconstructed,
    isIdentical,
    diff,
    triviaEntriesCount: trivia.size(),
  };
}

export function executeAilRoundtrip(
  ailSource: string,
  target: TargetLanguage,
  filePath = "source.ail",
): AilRoundtripResult {
  const { ast, trivia } = parseWithTrivia(ailSource, filePath);
  const targetReconstructed = emitTarget(ast, target, { trivia, watermark: false });
  const reverseResult = executeRoundtrip(targetReconstructed, target, filePath);
  return {
    target,
    ailOriginal: ailSource,
    targetReconstructed,
    ailReconstructed: reverseResult.ail,
    isTargetIdentical: reverseResult.isIdentical,
    isAilIdentical: normalizeWhitespace(ailSource) === normalizeWhitespace(reverseResult.ail),
  };
}

function normalizeWhitespace(text: string): string {
  return text
    .trim()
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+$/gm, "");
}

function generateSimpleDiff(expected: string, actual: string): string {
  const expLines = expected.split("\n");
  const actLines = actual.split("\n");

  const diffLines: string[] = [];
  const max = Math.max(expLines.length, actLines.length);

  for (let i = 0; i < max; i++) {
    const exp = expLines[i] ?? "";
    const act = actLines[i] ?? "";
    if (exp !== act) {
      diffLines.push(`Line ${i + 1}:`);
      diffLines.push(`- ${exp}`);
      diffLines.push(`+ ${act}`);
    }
  }

  return diffLines.join("\n");
}

function preserveTypeScriptSourceSlices(
  source: string,
  ast: Module,
  trivia: CstTriviaTable,
  filePath: string,
  isTsx: boolean,
): void {
  const scriptKind = isTsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(filePath, source, ts.ScriptTarget.ES2022, true, scriptKind);

  for (const item of ast.items) {
    const matchingStmt = sf.statements.find(
      (s) => s.getFullStart() <= item.span.start.offset && item.span.end.offset <= s.getEnd(),
    );
    if (!matchingStmt) continue;

    const leadingComments = ts.getLeadingCommentRanges(source, matchingStmt.getFullStart());
    const start =
      leadingComments && leadingComments.length > 0
        ? leadingComments[0].pos
        : matchingStmt.getStart(sf);
    const trailingComments = ts.getTrailingCommentRanges(source, matchingStmt.getEnd());
    const end =
      trailingComments && trailingComments.length > 0
        ? trailingComments[trailingComments.length - 1].end
        : matchingStmt.getEnd();
    const stmtSlice = source.slice(start, end);

    if (ts.isVariableStatement(matchingStmt)) {
      if (matchingStmt.declarationList.declarations.length === 1) {
        const isConst = (matchingStmt.declarationList.flags & ts.NodeFlags.Const) !== 0;
        const decl = matchingStmt.declarationList.declarations[0];
        const name = ts.isIdentifier(decl.name) ? decl.name.text : decl.name.getText(sf);
        const nodeId = `${isConst ? "const" : "var"}:${name}`;
        trivia.setSourceSlice(nodeId, stmtSlice, createAstNodeSnapshot(item), item.span);
      } else {
        const decl = matchingStmt.declarationList.declarations.find(
          (d) => d.getStart(sf) <= item.span.start.offset && item.span.end.offset <= d.getEnd(),
        );
        if (decl) {
          const isConst = (matchingStmt.declarationList.flags & ts.NodeFlags.Const) !== 0;
          const name = ts.isIdentifier(decl.name) ? decl.name.text : decl.name.getText(sf);
          const nodeId = `${isConst ? "const" : "var"}:${name}`;
          const declSlice = source.slice(decl.getStart(sf), decl.getEnd());
          trivia.setSourceSlice(nodeId, declSlice, createAstNodeSnapshot(item), item.span);
        }
      }
    } else {
      const nodeId = getNodeTriviaId(item);
      if (nodeId) {
        trivia.setSourceSlice(nodeId, stmtSlice, createAstNodeSnapshot(item), item.span);
        if (item.kind === "ComponentDecl") {
          trivia.setSourceSlice(
            `fn:${item.name}`,
            stmtSlice,
            createAstNodeSnapshot(item),
            item.span,
          );
        }
      }
    }
  }
}
