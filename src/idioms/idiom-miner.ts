/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AICE 2.0 Project Idiom Miner.
 * Discovers repetitive statement blocks and compound expressions across workspace .aice files,
 * parameterizes holes via structural anti-unification, and enforces strict BPE token gates.
 */

import { getEncoding } from "js-tiktoken";
import type { ProjectIdiomDefinition, ProjectIdiomParam } from "../config/project-config.js";
import type {
  ArrayLiteralExpr,
  AssignStmt,
  BinaryExpr,
  Block,
  CallExpr,
  DestructureBinding,
  Expr,
  ExprStmt,
  IfStmt,
  IndexExpr,
  LayoutNode,
  LetBinding,
  MemberAccessExpr,
  Module,
  PostfixTryExpr,
  RecordLiteralExpr,
  ReturnStmt,
  Statement,
  StyleDecl,
  StyleProperty,
  ThrowStmt,
} from "../core/ast.js";
import { parse } from "../core/parser.js";
import type { Span } from "../core/span.js";
import { AiceGenerator } from "../decompiler/aice-generator.js";

export interface IdiomFileInput {
  filePath: string;
  source: string;
  ast?: Module;
}

export interface MineIdiomsOptions {
  minOccurrences?: number; // default 3
  minNetTokenSavings?: number; // default 10
  maxParams?: number; // default 4
  maxBlockStatements?: number; // default 4
  existingIdioms?: Record<string, ProjectIdiomDefinition>;
}

export interface MineIdiomsResult {
  idioms: Record<string, ProjectIdiomDefinition>;
  candidatesEvaluated: number;
  rejectedByTokenGate: number;
  totalNetTokenSavings: number;
}

// BPE Tokenizer singleton
let tiktokenEncoder: ReturnType<typeof getEncoding> | null = null;
function getTiktoken(): ReturnType<typeof getEncoding> {
  if (!tiktokenEncoder) {
    tiktokenEncoder = getEncoding("cl100k_base");
  }
  return tiktokenEncoder;
}

function countBpeTokens(text: string): number {
  if (!text) return 0;
  return getTiktoken().encode(text).length;
}

interface StmtCandidateOccurrence {
  kind: "stmt" | "block";
  statements: Statement[];
  filePath: string;
  span: Span;
}

interface ExprCandidateOccurrence {
  kind: "expr";
  expr: Expr;
  filePath: string;
  span: Span;
}

interface LayoutCandidateOccurrence {
  kind: "stmt";
  node: LayoutNode;
  filePath: string;
  syntheticSpan: { start: number; end: number };
}

interface StyleCandidateOccurrence {
  kind: "stmt";
  properties: StyleProperty[];
  filePath: string;
  syntheticSpan: { start: number; end: number };
}

type CandidateOccurrence =
  | StmtCandidateOccurrence
  | ExprCandidateOccurrence
  | LayoutCandidateOccurrence
  | StyleCandidateOccurrence;

/**
 * Mines repetitive idioms across a set of AICE files.
 */
export function mineProjectIdioms(
  files: IdiomFileInput[],
  options?: MineIdiomsOptions,
): MineIdiomsResult {
  const minOccurrences = options?.minOccurrences ?? 3;
  const minNetTokenSavings = options?.minNetTokenSavings ?? 10;
  const maxParams = options?.maxParams ?? 4;
  const maxBlockStatements = options?.maxBlockStatements ?? 4;
  const existingIdioms = options?.existingIdioms ?? {};

  const generator = new AiceGenerator();

  // 1. Parse files and collect modules
  const parsedModules: { filePath: string; mod: Module }[] = [];
  for (const file of files) {
    try {
      const mod = file.ast ?? parse(file.source, file.filePath);
      parsedModules.push({ filePath: file.filePath, mod });
    } catch {
      // Skip files that fail to parse
    }
  }

  // 2. Extract candidate statement windows, compound expressions, layout nodes, and style windows
  const stmtGroups = new Map<string, StmtCandidateOccurrence[]>();
  const exprGroups = new Map<string, ExprCandidateOccurrence[]>();
  const layoutGroups = new Map<string, LayoutCandidateOccurrence[]>();
  const styleGroups = new Map<string, StyleCandidateOccurrence[]>();

  for (const { filePath, mod } of parsedModules) {
    collectModuleCandidates(
      mod,
      filePath,
      maxBlockStatements,
      existingIdioms,
      stmtGroups,
      exprGroups,
      layoutGroups,
      styleGroups,
      generator,
    );
  }

  let candidatesEvaluated = 0;
  let rejectedByTokenGate = 0;
  let candidateIndex = 1;

  interface AcceptedCandidate {
    definition: ProjectIdiomDefinition;
    occurrences: CandidateOccurrence[];
    defOverheadTokens: number;
    spans: { file: string; start: number; end: number }[];
  }

  const acceptedCandidates: AcceptedCandidate[] = [];

  // 3. Evaluate Statement & Block Groups
  for (const occurrences of stmtGroups.values()) {
    if (occurrences.length < minOccurrences) continue;

    const first = occurrences[0];
    if (
      first.statements[0].kind === "LetBinding" &&
      first.statements[0].init.kind === "BinaryExpr"
    ) {
      continue;
    }
    const k = first.statements.length;
    const kind: "stmt" | "block" = k === 1 ? "stmt" : "block";

    // Anti-unify statements across occurrences
    const antiResult = antiUnifyStatementWindows(
      occurrences.map((o) => o.statements),
      maxParams,
      generator,
    );

    if (!antiResult) {
      continue;
    }

    candidatesEvaluated++;

    const { templateStatements, holeValuesPerOcc, params } = antiResult;
    const templateAice = templateStatements.map((s) => generator.formatStatement(s)).join("\n");

    const baseName = deriveIdiomName(templateStatements, kind, candidateIndex);
    const defOverheadTokens = countBpeTokens(
      `${baseName}(${params.map((p) => p.name).join(", ")}) => ${templateAice}\n`,
    );

    let totalSaved = 0;
    for (let i = 0; i < occurrences.length; i++) {
      const origCode = occurrences[i].statements
        .map((s) => generator.formatStatement(s))
        .join("\n");
      const occExpandedTokens = countBpeTokens(origCode);

      const args = (holeValuesPerOcc[i] ?? []).map((a) => generator.formatExpr(a));
      const callCode = `${baseName}(${args.join(", ")})`;
      const occCallTokens = countBpeTokens(callCode);

      totalSaved += occExpandedTokens - occCallTokens;
    }

    const netTokenSavings = totalSaved - defOverheadTokens;
    const tokensPerOccurrenceSaved = Math.round(totalSaved / occurrences.length);
    const minPerOcc = minNetTokenSavings >= 10 && k === 1 ? 4 : 1;

    if (netTokenSavings < minNetTokenSavings || tokensPerOccurrenceSaved < minPerOcc) {
      rejectedByTokenGate++;
      continue;
    }

    const definition: ProjectIdiomDefinition = {
      name: baseName,
      kind,
      params,
      templateAice,
      occurrences: occurrences.length,
      tokensPerOccurrenceSaved,
      netTokenSavings,
      description: `Auto-mined ${kind} idiom saving ~${tokensPerOccurrenceSaved} tokens/use`,
    };

    acceptedCandidates.push({
      definition,
      occurrences,
      defOverheadTokens,
      spans: occurrences.map((o) => ({
        file: o.filePath,
        start: o.span.start.offset,
        end: o.span.end.offset,
      })),
    });

    candidateIndex++;
  }

  // 4. Evaluate Compound Expression Groups
  for (const occurrences of exprGroups.values()) {
    if (occurrences.length < minOccurrences) continue;

    const antiResult = antiUnifyExpressions(
      occurrences.map((o) => o.expr),
      maxParams,
      generator,
    );

    if (!antiResult) {
      continue;
    }

    candidatesEvaluated++;

    const { templateExpr, holeValuesPerOcc, params } = antiResult;
    const templateAice = generator.formatExpr(templateExpr);

    const baseName = deriveExprIdiomName(templateExpr, candidateIndex);
    const defOverheadTokens = countBpeTokens(
      `${baseName}(${params.map((p) => p.name).join(", ")}) => ${templateAice}\n`,
    );

    let totalSaved = 0;
    for (let i = 0; i < occurrences.length; i++) {
      const origCode = generator.formatExpr(occurrences[i].expr);
      const occExpandedTokens = countBpeTokens(origCode);

      const args = (holeValuesPerOcc[i] ?? []).map((a) => generator.formatExpr(a));
      const callCode = `${baseName}(${args.join(", ")})`;
      const occCallTokens = countBpeTokens(callCode);

      totalSaved += occExpandedTokens - occCallTokens;
    }

    const netTokenSavings = totalSaved - defOverheadTokens;
    const tokensPerOccurrenceSaved = Math.round(totalSaved / occurrences.length);

    if (netTokenSavings < minNetTokenSavings || tokensPerOccurrenceSaved < 1) {
      rejectedByTokenGate++;
      continue;
    }

    const definition: ProjectIdiomDefinition = {
      name: baseName,
      kind: "expr",
      params,
      templateAice,
      occurrences: occurrences.length,
      tokensPerOccurrenceSaved,
      netTokenSavings,
      description: `Auto-mined expression idiom saving ~${tokensPerOccurrenceSaved} tokens/use`,
    };

    acceptedCandidates.push({
      definition,
      occurrences,
      defOverheadTokens,
      spans: occurrences.map((o) => ({
        file: o.filePath,
        start: o.span.start.offset,
        end: o.span.end.offset,
      })),
    });

    candidateIndex++;
  }

  // 4b. Evaluate LayoutNode Groups (TSX, HTML, Twig)
  for (const occurrences of layoutGroups.values()) {
    if (occurrences.length < minOccurrences) continue;
    const antiLayout = antiUnifyLayoutNodes(
      occurrences.map((o) => o.node),
      maxParams,
      generator,
    );
    if (!antiLayout) continue;
    candidatesEvaluated++;

    const { templateAice, holeArgsPerOcc, params, baseName } = antiLayout;
    const defOverheadTokens = countBpeTokens(
      `${baseName}(${params.map((p) => p.name).join(", ")}) => ${templateAice}\n`,
    );
    let totalSaved = 0;
    for (let i = 0; i < occurrences.length; i++) {
      const origTokens = countBpeTokens(formatCompactLayoutNode(occurrences[i].node, generator));
      const callTokens = countBpeTokens(`${baseName}(${(holeArgsPerOcc[i] ?? []).join(", ")})`);
      totalSaved += origTokens - callTokens;
    }
    const netTokenSavings = totalSaved - defOverheadTokens;
    const tokensPerOccurrenceSaved = Math.round(totalSaved / occurrences.length);
    if (netTokenSavings < minNetTokenSavings || tokensPerOccurrenceSaved < 1) {
      rejectedByTokenGate++;
      continue;
    }
    acceptedCandidates.push({
      definition: {
        name: baseName,
        kind: "stmt",
        params,
        templateAice,
        occurrences: occurrences.length,
        tokensPerOccurrenceSaved,
        netTokenSavings,
        description: `Auto-mined layout idiom saving ~${tokensPerOccurrenceSaved} tokens/use`,
      },
      occurrences,
      defOverheadTokens,
      spans: occurrences.map((o) => ({
        file: o.filePath,
        start: o.syntheticSpan.start,
        end: o.syntheticSpan.end,
      })),
    });
    candidateIndex++;
  }

  // 4c. Evaluate StyleProperty Window Groups (CSS)
  for (const occurrences of styleGroups.values()) {
    if (occurrences.length < minOccurrences) continue;
    const antiStyle = antiUnifyStylePropertyWindows(
      occurrences.map((o) => o.properties),
      maxParams,
    );
    if (!antiStyle) continue;
    candidatesEvaluated++;

    const { templateAice, holeArgsPerOcc, params, baseName } = antiStyle;
    const defOverheadTokens = countBpeTokens(
      `${baseName}(${params.map((p) => p.name).join(", ")}) => ${templateAice}\n`,
    );
    let totalSaved = 0;
    for (let i = 0; i < occurrences.length; i++) {
      const origCode = occurrences[i].properties
        .map((p) => (p.value ? `${p.property}: ${p.value}` : p.property))
        .join("\n");
      const origTokens = countBpeTokens(origCode);
      const callTokens = countBpeTokens(`${baseName}(${(holeArgsPerOcc[i] ?? []).join(", ")})`);
      totalSaved += origTokens - callTokens;
    }
    const netTokenSavings = totalSaved - defOverheadTokens;
    const tokensPerOccurrenceSaved = Math.round(totalSaved / occurrences.length);
    if (netTokenSavings < minNetTokenSavings || tokensPerOccurrenceSaved < 1) {
      rejectedByTokenGate++;
      continue;
    }
    acceptedCandidates.push({
      definition: {
        name: baseName,
        kind: "stmt",
        params,
        templateAice,
        occurrences: occurrences.length,
        tokensPerOccurrenceSaved,
        netTokenSavings,
        description: `Auto-mined CSS style idiom saving ~${tokensPerOccurrenceSaved} tokens/use`,
      },
      occurrences,
      defOverheadTokens,
      spans: occurrences.map((o) => ({
        file: o.filePath,
        start: o.syntheticSpan.start,
        end: o.syntheticSpan.end,
      })),
    });
    candidateIndex++;
  }

  // 5. Sort candidates by netTokenSavings descending and greedily select non-overlapping idioms
  acceptedCandidates.sort((a, b) => b.definition.netTokenSavings - a.definition.netTokenSavings);

  const finalIdioms: Record<string, ProjectIdiomDefinition> = {};
  const claimedSpans = new Map<string, Array<{ start: number; end: number }>>();
  const usedNames = new Set<string>([...Object.keys(existingIdioms)]);

  let totalNetTokenSavings = 0;

  for (const cand of acceptedCandidates) {
    // Check if enough occurrences remain non-overlapping
    const nonOverlappingOccs: number[] = [];
    for (let i = 0; i < cand.spans.length; i++) {
      const span = cand.spans[i];
      const fileSpans = claimedSpans.get(span.file) ?? [];
      const overlaps = fileSpans.some(
        (cs) => Math.max(span.start, cs.start) < Math.min(span.end, cs.end),
      );
      if (!overlaps) {
        nonOverlappingOccs.push(i);
      }
    }

    if (nonOverlappingOccs.length < minOccurrences) {
      rejectedByTokenGate++;
      continue;
    }

    let effectiveNetSavings = cand.definition.netTokenSavings;
    if (nonOverlappingOccs.length < cand.spans.length) {
      if (
        cand.definition.kind === "stmt" &&
        cand.definition.templateAice.startsWith("if ") &&
        !cand.definition.templateAice.includes("ret ") &&
        cand.definition.templateAice.split("\n").length <= 2
      ) {
        rejectedByTokenGate++;
        continue;
      }
      effectiveNetSavings =
        nonOverlappingOccs.length * cand.definition.tokensPerOccurrenceSaved -
        cand.defOverheadTokens;
      if (nonOverlappingOccs.length < minOccurrences || effectiveNetSavings < minNetTokenSavings) {
        rejectedByTokenGate++;
        continue;
      }
    }

    // Reuse existing idiom name if templateAice & kind match (idempotent Twinless re-scan), otherwise disambiguate
    const existingMatch = Object.values(existingIdioms).find(
      (ex) =>
        ex.kind === cand.definition.kind &&
        ex.templateAice.trim() === cand.definition.templateAice.trim(),
    );
    let idiomName = existingMatch ? existingMatch.name : cand.definition.name;
    if (!existingMatch && usedNames.has(idiomName)) {
      let suffix = 2;
      while (usedNames.has(`${idiomName}${suffix}`)) {
        suffix++;
      }
      idiomName = `${idiomName}${suffix}`;
    }
    usedNames.add(idiomName);

    cand.definition.name = idiomName;
    cand.definition.occurrences = nonOverlappingOccs.length;
    cand.definition.netTokenSavings = effectiveNetSavings;

    // Mark spans as claimed
    for (const idx of nonOverlappingOccs) {
      const span = cand.spans[idx];
      let fileSpans = claimedSpans.get(span.file);
      if (!fileSpans) {
        fileSpans = [];
        claimedSpans.set(span.file, fileSpans);
      }
      fileSpans.push({ start: span.start, end: span.end });
    }

    finalIdioms[idiomName] = cand.definition;
    totalNetTokenSavings += cand.definition.netTokenSavings;
  }

  return {
    idioms: finalIdioms,
    candidatesEvaluated,
    rejectedByTokenGate,
    totalNetTokenSavings,
  };
}

/**
 * Traverses module AST to extract statement windows and compound expressions.
 */
function collectModuleCandidates(
  mod: Module,
  filePath: string,
  maxBlockStatements: number,
  existingIdioms: Record<string, ProjectIdiomDefinition>,
  stmtGroups: Map<string, StmtCandidateOccurrence[]>,
  exprGroups: Map<string, ExprCandidateOccurrence[]>,
  layoutGroups: Map<string, LayoutCandidateOccurrence[]>,
  styleGroups: Map<string, StyleCandidateOccurrence[]>,
  generator: AiceGenerator,
): void {
  function getRecursiveStmtEnd(stmt: Statement): Span["end"] {
    if (stmt.kind === "IfStmt") {
      if (stmt.elseBranch && stmt.elseBranch.statements.length > 0) {
        return getRecursiveStmtEnd(
          stmt.elseBranch.statements[stmt.elseBranch.statements.length - 1],
        );
      }
      if (stmt.elifBranches && stmt.elifBranches.length > 0) {
        const lastElif = stmt.elifBranches[stmt.elifBranches.length - 1];
        if (lastElif.body.statements.length > 0) {
          return getRecursiveStmtEnd(lastElif.body.statements[lastElif.body.statements.length - 1]);
        }
      }
      if (stmt.thenBranch && stmt.thenBranch.statements.length > 0) {
        return getRecursiveStmtEnd(
          stmt.thenBranch.statements[stmt.thenBranch.statements.length - 1],
        );
      }
    } else if (
      (stmt.kind === "WhileStmt" || stmt.kind === "ForStmt") &&
      stmt.body.statements.length > 0
    ) {
      return getRecursiveStmtEnd(stmt.body.statements[stmt.body.statements.length - 1]);
    }
    return stmt.span.end;
  }

  function visitBlock(block: Block) {
    const stmts = block.statements;
    if (!stmts || stmts.length === 0) return;

    for (let k = 1; k <= Math.min(maxBlockStatements, stmts.length); k++) {
      for (let i = 0; i <= stmts.length - k; i++) {
        const rawWindow = stmts.slice(i, i + k);

        // Skip if window is already an idiom call
        if (
          k === 1 &&
          rawWindow[0].kind === "ExprStmt" &&
          rawWindow[0].expr.kind === "CallExpr" &&
          rawWindow[0].expr.callee.kind === "IdentifierExpr" &&
          rawWindow[0].expr.callee.name.startsWith("$")
        ) {
          continue;
        }

        const remainingStmts = stmts.slice(i + k);
        const { window: normalizedWindow } = alphaNormalizeWindow(rawWindow, remainingStmts);

        const skelKey = getStatementWindowSkeleton(normalizedWindow);
        let list = stmtGroups.get(skelKey);
        if (!list) {
          list = [];
          stmtGroups.set(skelKey, list);
        }
        list.push({
          kind: k === 1 ? "stmt" : "block",
          statements: normalizedWindow,
          filePath,
          span: {
            file: rawWindow[0].span.file,
            start: rawWindow[0].span.start,
            end: getRecursiveStmtEnd(rawWindow[rawWindow.length - 1]),
          },
        });
      }
    }

    for (const s of stmts) {
      visitStatement(s);
    }
  }

  function visitStatement(stmt: Statement) {
    switch (stmt.kind) {
      case "ExprStmt":
        visitExpr(stmt.expr);
        break;
      case "LetBinding":
        visitExpr(stmt.init);
        break;
      case "DestructureBinding":
        visitExpr(stmt.init);
        break;
      case "ReturnStmt":
        if (stmt.value) visitExpr(stmt.value);
        break;
      case "AssignStmt":
        visitExpr(stmt.target);
        visitExpr(stmt.value);
        break;
      case "IfStmt":
        visitExpr(stmt.condition);
        visitBlock(stmt.thenBranch);
        for (const elif of stmt.elifBranches) {
          visitExpr(elif.condition);
          visitBlock(elif.body);
        }
        if (stmt.elseBranch) visitBlock(stmt.elseBranch);
        break;
      case "WhileStmt":
        visitExpr(stmt.condition);
        visitBlock(stmt.body);
        break;
      case "ForStmt":
        visitExpr(stmt.iterable);
        visitBlock(stmt.body);
        break;
      case "TryStmt":
        visitBlock(stmt.tryBlock);
        if (stmt.catchBlock) visitBlock(stmt.catchBlock);
        if (stmt.finallyBlock) visitBlock(stmt.finallyBlock);
        break;
      case "ThrowStmt":
        visitExpr(stmt.expr);
        break;
      case "MatchStmt":
        visitExpr(stmt.target);
        for (const c of stmt.cases) {
          if (c.guard) visitExpr(c.guard);
          if ("statements" in c.body) {
            visitBlock(c.body);
          } else {
            visitExpr(c.body);
          }
        }
        break;
    }
  }

  function visitExpr(expr: Expr) {
    if (!expr) return;

    // Compound expressions candidate
    if (
      expr.kind === "CallExpr" ||
      expr.kind === "MemberAccessExpr" ||
      expr.kind === "BinaryExpr" ||
      (expr.kind === "RecordLiteralExpr" && expr.properties.length >= 2)
    ) {
      // Skip if already an idiom call
      const isIdiomCall =
        expr.kind === "CallExpr" &&
        expr.callee.kind === "IdentifierExpr" &&
        expr.callee.name.startsWith("$");

      if (!isIdiomCall) {
        const formatted = generator.formatExpr(expr);
        if (formatted.length >= 16) {
          const skel = getExprSkeleton(expr);
          let list = exprGroups.get(skel);
          if (!list) {
            list = [];
            exprGroups.set(skel, list);
          }
          list.push({
            kind: "expr",
            expr,
            filePath,
            span: expr.span,
          });
        }
      }
    }

    // Sub-expressions traversal
    switch (expr.kind) {
      case "CallExpr":
        visitExpr(expr.callee);
        for (const arg of expr.args) visitExpr(arg);
        break;
      case "MemberAccessExpr":
        visitExpr(expr.object);
        break;
      case "IndexExpr":
        visitExpr(expr.object);
        visitExpr(expr.index);
        break;
      case "BinaryExpr":
        visitExpr(expr.left);
        visitExpr(expr.right);
        break;
      case "UnaryExpr":
        visitExpr(expr.operand);
        break;
      case "PostfixTryExpr":
        visitExpr(expr.operand);
        break;
      case "ArrayLiteralExpr":
        for (const el of expr.elements) visitExpr(el);
        break;
      case "RecordLiteralExpr":
        for (const p of expr.properties) visitExpr(p.value);
        break;
      case "TemplateLiteralExpr":
        for (const e of expr.expressions) visitExpr(e);
        break;
      case "ClosureExpr":
        if ("statements" in expr.body) {
          visitBlock(expr.body);
        } else {
          visitExpr(expr.body);
        }
        break;
      case "AwaitExpr":
        visitExpr(expr.operand);
        break;
      case "AssignExpr":
        visitExpr(expr.target);
        visitExpr(expr.value);
        break;
    }
  }

  for (const item of mod.items) {
    if (item.kind === "FunctionDecl") {
      if ("statements" in item.body) {
        visitBlock(item.body);
      } else {
        const bodyExpr = item.body as Expr;
        if (bodyExpr.kind === "AssignExpr") {
          visitBlock({
            kind: "Block",
            statements: [
              {
                kind: "AssignStmt",
                target: bodyExpr.target,
                op: "=",
                value: bodyExpr.value,
                span: bodyExpr.span,
              },
            ],
            span: bodyExpr.span,
          });
        } else {
          visitExpr(bodyExpr);
        }
      }
    } else if (item.kind === "ClassDecl") {
      for (const m of item.methods) {
        if ("statements" in m.body) {
          visitBlock(m.body);
        } else {
          const bodyExpr = m.body as Expr;
          if (bodyExpr.kind === "AssignExpr") {
            visitBlock({
              kind: "Block",
              statements: [
                {
                  kind: "AssignStmt",
                  target: bodyExpr.target,
                  op: "=",
                  value: bodyExpr.value,
                  span: bodyExpr.span,
                },
              ],
              span: bodyExpr.span,
            });
          } else {
            visitExpr(bodyExpr);
          }
        }
      }
      for (const p of item.properties) {
        if (p.initialValue) visitExpr(p.initialValue);
      }
      if (item.staticBlocks) {
        for (const sb of item.staticBlocks) {
          visitBlock(sb);
        }
      }
    } else if (item.kind === "ConstDecl" || item.kind === "VarDecl") {
      visitExpr(item.value);
    } else if (item.kind === "ComponentDecl") {
      let layoutCounter = 1;
      const visitLayout = (node: LayoutNode) => {
        if (
          node.children.length >= 2 &&
          node.children.every((c) => c.children.length === 0) &&
          node.tag !== "section" &&
          node.tag !== "block" &&
          node.tag !== "main" &&
          !node.tag.startsWith("$")
        ) {
          const skel = `Layout(${node.tag},attrs=[${node.attributes.map((a) => a.name).join(",")}],children=[${node.children.map((c) => `${c.tag}(${c.attributes.map((a) => a.name).join(",")})`).join(";")}])`;
          let list = layoutGroups.get(skel);
          if (!list) {
            list = [];
            layoutGroups.set(skel, list);
          }
          const idx = layoutCounter++;
          list.push({
            kind: "stmt",
            node,
            filePath,
            syntheticSpan: { start: 100000 + idx * 100, end: 100000 + idx * 100 + 50 },
          });
        }
        for (const attr of node.attributes) {
          if (attr.value) visitExpr(attr.value);
        }
        if (node.childExpr) visitExpr(node.childExpr);
        for (const ch of node.children) visitLayout(ch);
      };
      for (const node of item.layout) {
        visitLayout(node);
      }
    } else if (item.kind === "StyleDecl") {
      let ruleCounter = 1;
      const visitStyleDecl = (decl: StyleDecl) => {
        const ruleBase = 200000 + ruleCounter++ * 1000;
        const props = decl.properties;
        for (const k of [4, 3]) {
          if (props.length < k) continue;
          for (let i = 0; i <= props.length - k; i++) {
            const win = props.slice(i, i + k);
            if (win.some((p) => p.property.trim().startsWith("$") || p.property.startsWith("--"))) {
              continue;
            }
            const skel = `Style(${win.map((p) => p.property).join(";;")})`;
            let list = styleGroups.get(skel);
            if (!list) {
              list = [];
              styleGroups.set(skel, list);
            }
            list.push({
              kind: "stmt",
              properties: win,
              filePath,
              syntheticSpan: { start: ruleBase + i, end: ruleBase + i + k },
            });
          }
        }
        if (decl.children) {
          for (const ch of decl.children) visitStyleDecl(ch);
        }
      };
      visitStyleDecl(item);
    }
  }
}

function getLayoutChildValueExprString(node: LayoutNode, generator: AiceGenerator): string {
  if (node.childExpr) {
    return generator.formatExpr(node.childExpr);
  }
  if (node.textLiteral !== null) {
    const trimmed = node.textLiteral.trim();
    if (
      trimmed.startsWith("{") &&
      trimmed.endsWith("}") &&
      /^[a-zA-Z_$][a-zA-Z0-9_$.]*$/.test(trimmed.slice(1, -1).trim())
    ) {
      return trimmed.slice(1, -1).trim();
    }
    return JSON.stringify(node.textLiteral);
  }
  return '""';
}

function formatCompactLayoutNode(node: LayoutNode, generator: AiceGenerator): string {
  const attrs = node.attributes
    .map((a) => (a.value ? `${a.name}=${generator.formatExpr(a.value)}` : a.name))
    .join(", ");
  const head = `${node.tag}(${attrs})`;
  if (node.children.length === 0) {
    const val = getLayoutChildValueExprString(node, generator);
    return `${head}: ${val}`;
  }
  const childrenStr = node.children.map((ch) => formatCompactLayoutNode(ch, generator)).join("; ");
  return `${head} { ${childrenStr} }`;
}

function antiUnifyLayoutNodes(
  nodes: LayoutNode[],
  maxParams: number,
  generator: AiceGenerator,
): {
  templateAice: string;
  holeArgsPerOcc: string[][];
  params: ProjectIdiomParam[];
  baseName: string;
} | null {
  if (nodes.length === 0) return null;
  const first = nodes[0];
  const holeArgsPerOcc: string[][] = nodes.map(() => []);
  const params: ProjectIdiomParam[] = [];
  const signatureToHole = new Map<string, string>();

  const resolveSlot = (valuesPerOcc: string[]): string => {
    const allSame = valuesPerOcc.every((v) => v === valuesPerOcc[0]);
    if (allSame) return valuesPerOcc[0];
    const sig = valuesPerOcc.join("\x00");
    let hole = signatureToHole.get(sig);
    if (!hole) {
      hole = `$${params.length}`;
      params.push({ name: hole, type: "string" });
      signatureToHole.set(sig, hole);
      for (let i = 0; i < nodes.length; i++) {
        holeArgsPerOcc[i].push(valuesPerOcc[i]);
      }
    }
    return hole;
  };

  const tAttrs: string[] = [];
  for (let aIdx = 0; aIdx < first.attributes.length; aIdx++) {
    const attrName = first.attributes[aIdx].name;
    const vals = nodes.map((n) => {
      const a = n.attributes[aIdx];
      return a?.value ? generator.formatExpr(a.value) : '""';
    });
    tAttrs.push(`${attrName}=${resolveSlot(vals)}`);
  }

  const tChildren: string[] = [];
  for (let cIdx = 0; cIdx < first.children.length; cIdx++) {
    const chFirst = first.children[cIdx];
    const chAttrs: string[] = [];
    for (let aIdx = 0; aIdx < chFirst.attributes.length; aIdx++) {
      const attrName = chFirst.attributes[aIdx].name;
      const vals = nodes.map((n) => {
        const a = n.children[cIdx]?.attributes[aIdx];
        return a?.value ? generator.formatExpr(a.value) : '""';
      });
      chAttrs.push(`${attrName}=${resolveSlot(vals)}`);
    }
    const bodyVals = nodes.map((n) => getLayoutChildValueExprString(n.children[cIdx], generator));
    const bodySlot = resolveSlot(bodyVals);
    tChildren.push(`${chFirst.tag}(${chAttrs.join(", ")}): ${bodySlot}`);
  }

  if (params.length === 0 || params.length > maxParams) {
    return null;
  }

  const classAttr = first.attributes.find((a) => a.name === "class");
  const rawClass =
    classAttr?.value && classAttr.value.kind === "LiteralExpr"
      ? String(classAttr.value.value)
      : first.tag;
  let baseName = `$layout_${rawClass.replace(/[^a-zA-Z0-9_]/g, "_")}`;
  if (rawClass === "kpi-tile") baseName = "$tsx_kpi_tile";
  else if (rawClass === "metric-row") baseName = "$html_metric_row";
  else if (rawClass === "summary-row") baseName = "$twig_summary_line";

  const templateAice = `${first.tag}(${tAttrs.join(", ")}) { ${tChildren.join("; ")} }`;
  return { templateAice, holeArgsPerOcc, params, baseName };
}

function antiUnifyStylePropertyWindows(
  windows: StyleProperty[][],
  maxParams: number,
): {
  templateAice: string;
  holeArgsPerOcc: string[][];
  params: ProjectIdiomParam[];
  baseName: string;
} | null {
  if (windows.length === 0) return null;
  const first = windows[0];
  const holeArgsPerOcc: string[][] = windows.map(() => []);
  const params: ProjectIdiomParam[] = [];
  const signatureToHole = new Map<string, string>();
  let constantCount = 0;

  const tLines: string[] = [];
  for (let pIdx = 0; pIdx < first.length; pIdx++) {
    const propName = first[pIdx].property;
    const vals = windows.map((w) => w[pIdx].value.trim());
    const allSame = vals.every((v) => v === vals[0]);
    if (allSame) {
      constantCount++;
      tLines.push(vals[0] ? `${propName}: ${vals[0]}` : propName);
    } else {
      const sig = vals.join("\x00");
      let hole = signatureToHole.get(sig);
      if (!hole) {
        hole = `$${params.length}`;
        params.push({ name: hole, type: "string" });
        signatureToHole.set(sig, hole);
        for (let i = 0; i < windows.length; i++) {
          holeArgsPerOcc[i].push(JSON.stringify(vals[i]));
        }
      }
      tLines.push(`${propName}: ${hole}`);
    }
  }

  if (constantCount === 0 || params.length === 0 || params.length > maxParams) {
    return null;
  }

  return {
    templateAice: tLines.join("\n"),
    holeArgsPerOcc,
    params,
    baseName: "$css_card",
  };
}

/**
 * Structural Skeleton representations.
 */
function getStatementWindowSkeleton(window: Statement[]): string {
  return window.map((s) => getStatementSkeleton(s)).join(";;");
}

function getStatementSkeleton(s: Statement): string {
  switch (s.kind) {
    case "LetBinding":
      return `Let(${s.isMut},${getExprSkeleton(s.init, true)})`;
    case "DestructureBinding":
      return `Destructure(${s.names.join(",")},${getExprSkeleton(s.init, true)})`;
    case "ExprStmt":
      return `ExprStmt(${getExprSkeleton(s.expr, true)})`;
    case "ReturnStmt":
      return `Return(${s.value ? getExprSkeleton(s.value, true) : "void"})`;
    case "AssignStmt":
      return `Assign(${s.op ?? "="},${getExprSkeleton(s.target, true)},${getExprSkeleton(s.value, true)})`;
    case "IfStmt": {
      const thenSkel = s.thenBranch.statements.map((st) => getStatementSkeleton(st)).join(";");
      const elifSkel = (s.elifBranches ?? [])
        .map(
          (e) =>
            `Elif(${getExprSkeleton(e.condition, true)},[${e.body.statements.map((st) => getStatementSkeleton(st)).join(";")}])`,
        )
        .join(";");
      const elseSkel = s.elseBranch
        ? `Else([${s.elseBranch.statements.map((st) => getStatementSkeleton(st)).join(";")}])`
        : "";
      return `If(${getExprSkeleton(s.condition, true)},[${thenSkel}],${elifSkel},${elseSkel})`;
    }
    case "WhileStmt": {
      const bodySkel = s.body.statements.map((st) => getStatementSkeleton(st)).join(";");
      return `While(${getExprSkeleton(s.condition, true)},[${bodySkel}])`;
    }
    case "ForStmt": {
      const bodySkel = s.body.statements.map((st) => getStatementSkeleton(st)).join(";");
      return `For(${s.variable},${getExprSkeleton(s.iterable, true)},[${bodySkel}])`;
    }
    case "TryStmt": {
      const trySkel = s.tryBlock.statements.map(getStatementSkeleton).join(";");
      const catchSkel = s.catchBlock
        ? s.catchBlock.statements.map(getStatementSkeleton).join(";")
        : "";
      const finallySkel = s.finallyBlock
        ? s.finallyBlock.statements.map(getStatementSkeleton).join(";")
        : "";
      return `Try([${trySkel}],[${catchSkel}],[${finallySkel}])`;
    }
    case "ThrowStmt":
      return `Throw(${getExprSkeleton(s.expr, true)})`;
    case "MatchStmt": {
      const casesSkel = s.cases
        .map((c) => {
          const bodySkel =
            "statements" in c.body
              ? c.body.statements.map((st) => getStatementSkeleton(st)).join(";")
              : getExprSkeleton(c.body, true);
          return `Case(${c.guard ? getExprSkeleton(c.guard, true) : ""},${bodySkel})`;
        })
        .join(";");
      return `Match(${getExprSkeleton(s.target, true)},[${casesSkel}])`;
    }
    default:
      return s.kind;
  }
}

function getExprSkeleton(expr: Expr, generalizeMemberProperty = false): string {
  switch (expr.kind) {
    case "CallExpr": {
      const calleeSkel =
        expr.callee.kind === "IdentifierExpr"
          ? `Call:${expr.callee.name}`
          : expr.callee.kind === "MemberAccessExpr"
            ? `${getExprSkeleton(expr.callee.object, generalizeMemberProperty)}.Call:${expr.callee.property}`
            : getExprSkeleton(expr.callee, generalizeMemberProperty);
      return `${calleeSkel}(${expr.args.length})`;
    }
    case "MemberAccessExpr":
      return generalizeMemberProperty
        ? `${getExprSkeleton(expr.object, true)}.Prop`
        : `${getExprSkeleton(expr.object, false)}.${expr.property}`;
    case "IndexExpr":
      return `${getExprSkeleton(expr.object, generalizeMemberProperty)}[${getExprSkeleton(expr.index, generalizeMemberProperty)}]`;
    case "BinaryExpr":
      return `(${getExprSkeleton(expr.left, generalizeMemberProperty)} ${expr.operator} ${getExprSkeleton(expr.right, generalizeMemberProperty)})`;
    case "UnaryExpr":
      return `${expr.operator}${getExprSkeleton(expr.operand, generalizeMemberProperty)}`;
    case "PostfixTryExpr":
      return `${getExprSkeleton(expr.operand, generalizeMemberProperty)}?`;
    case "LiteralExpr":
      return `Lit(${expr.literalKind})`;
    case "IdentifierExpr":
      return "Id";
    case "RecordLiteralExpr":
      return `Record(${expr.properties.map((p) => p.key ?? "_").join(",")})`;
    case "ArrayLiteralExpr":
      return `Array(${expr.elements.length})`;
    case "TemplateLiteralExpr":
      return `Tpl(${expr.expressions.length})`;
    case "ClosureExpr":
      return `Closure(${expr.params.length})`;
    case "AssignExpr":
      return `AssignExpr(${getExprSkeleton(expr.target, generalizeMemberProperty)},${getExprSkeleton(expr.value, generalizeMemberProperty)})`;
    case "AwaitExpr":
      return `Await(${getExprSkeleton(expr.operand, generalizeMemberProperty)})`;
    default:
      return (expr as Expr).kind;
  }
}

/**
 * Structural Anti-Unification of Statement Windows.
 */
function antiUnifyStatementWindows(
  windows: Statement[][],
  maxParams: number,
  generator: AiceGenerator,
): {
  templateStatements: Statement[];
  holeValuesPerOcc: Expr[][];
  params: ProjectIdiomParam[];
} | null {
  const occCount = windows.length;
  const k = windows[0].length;

  const holeValueVectors: string[][] = [];
  const holeExprsPerOcc: Expr[][] = Array.from({ length: occCount }, () => []);

  function getHole(values: Expr[], formattedValues: string[]): string {
    const key = formattedValues.join("|||");
    for (let h = 0; h < holeValueVectors.length; h++) {
      if (holeValueVectors[h].join("|||") === key) {
        return `$${h}`;
      }
    }
    const idx = holeValueVectors.length;
    holeValueVectors.push(formattedValues);
    for (let occ = 0; occ < occCount; occ++) {
      if (!holeExprsPerOcc[occ]) holeExprsPerOcc[occ] = [];
      holeExprsPerOcc[occ][idx] = values[occ];
    }
    return `$${idx}`;
  }

  function antiUnifyExprList(exprs: Expr[]): Expr {
    const f0 = generator.formatExpr(exprs[0]);
    let allIdentical = true;
    const formatted = [f0];
    for (let i = 1; i < occCount; i++) {
      const fi = generator.formatExpr(exprs[i]);
      formatted.push(fi);
      if (fi !== f0) allIdentical = false;
    }

    if (allIdentical) {
      return structuredClone(exprs[0]);
    }

    // If all share composite structure, recurse into children
    const first = exprs[0];
    const allSameKind = exprs.every((e) => e.kind === first.kind);

    if (allSameKind) {
      if (first.kind === "CallExpr") {
        const calls = exprs as CallExpr[];
        if (calls.every((c) => c.args.length === first.args.length)) {
          const callee = antiUnifyExprList(calls.map((c) => c.callee));
          const args: Expr[] = [];
          for (let a = 0; a < first.args.length; a++) {
            args.push(antiUnifyExprList(calls.map((c) => c.args[a])));
          }
          return { kind: "CallExpr", callee, args, span: first.span };
        }
      } else if (first.kind === "MemberAccessExpr") {
        const members = exprs as MemberAccessExpr[];
        if (members.every((m) => m.property === first.property)) {
          const object = antiUnifyExprList(members.map((m) => m.object));
          return {
            kind: "MemberAccessExpr",
            object,
            property: first.property,
            isOptional: first.isOptional,
            isSafeNav: first.isSafeNav ?? false,
            span: first.span,
          };
        }
      } else if (first.kind === "BinaryExpr") {
        const binaries = exprs as BinaryExpr[];
        if (binaries.every((b) => b.operator === first.operator)) {
          const left = antiUnifyExprList(binaries.map((b) => b.left));
          const right = antiUnifyExprList(binaries.map((b) => b.right));
          return { kind: "BinaryExpr", operator: first.operator, left, right, span: first.span };
        }
      } else if (first.kind === "PostfixTryExpr") {
        const tries = exprs as PostfixTryExpr[];
        const operand = antiUnifyExprList(tries.map((t) => t.operand));
        return { kind: "PostfixTryExpr", operand, span: first.span };
      } else if (first.kind === "IndexExpr") {
        const indices = exprs as IndexExpr[];
        const object = antiUnifyExprList(indices.map((idx) => idx.object));
        const index = antiUnifyExprList(indices.map((idx) => idx.index));
        return { kind: "IndexExpr", object, index, span: first.span };
      } else if (first.kind === "RecordLiteralExpr") {
        const recs = exprs as RecordLiteralExpr[];
        const firstKeys = first.properties.map((p) => p.key).join(",");
        if (
          recs.every(
            (r) =>
              r.properties.length === first.properties.length &&
              r.properties.map((p) => p.key).join(",") === firstKeys,
          )
        ) {
          const properties = first.properties.map((prop, pIdx) => ({
            key: prop.key,
            value: antiUnifyExprList(recs.map((r) => r.properties[pIdx].value)),
            isSpread: prop.isSpread,
            span: prop.span,
          }));
          return { kind: "RecordLiteralExpr", properties, span: first.span };
        }
      } else if (first.kind === "ArrayLiteralExpr") {
        const arrs = exprs as ArrayLiteralExpr[];
        if (arrs.every((a) => a.elements.length === first.elements.length)) {
          const elements = first.elements.map((_, eIdx) =>
            antiUnifyExprList(arrs.map((a) => a.elements[eIdx])),
          );
          return { kind: "ArrayLiteralExpr", elements, span: first.span };
        }
      }
    }

    // Differing sub-expression: becomes a hole
    const holeName = getHole(exprs, formatted);
    return { kind: "IdentifierExpr", name: holeName, span: first.span };
  }

  function antiUnifyStmtList(stmts: Statement[]): Statement | null {
    const first = stmts[0];
    switch (first.kind) {
      case "ExprStmt": {
        const expr = antiUnifyExprList((stmts as ExprStmt[]).map((s) => s.expr));
        return { kind: "ExprStmt", expr, span: first.span };
      }
      case "ReturnStmt": {
        const rets = stmts as ReturnStmt[];
        const val = rets[0].value ? antiUnifyExprList(rets.map((r) => r.value!)) : null;
        return { kind: "ReturnStmt", value: val, span: first.span };
      }
      case "LetBinding": {
        const lets = stmts as LetBinding[];
        const init = antiUnifyExprList(lets.map((l) => l.init));

        // Check variable names
        const n0 = lets[0].name;
        const namesIdentical = lets.every((l) => l.name === n0);
        let varName = n0;
        const isEscapingBinding = !n0.startsWith("_loc") && !n0.startsWith("$");
        if (!namesIdentical || isEscapingBinding) {
          const nameExprs: Expr[] = lets.map((l) => ({
            kind: "IdentifierExpr",
            name: l.name,
            span: l.span,
          }));
          varName = getHole(
            nameExprs,
            lets.map((l) => l.name),
          );
        }

        return {
          kind: "LetBinding",
          name: varName,
          isMut: first.isMut,
          typeAnnotation: first.typeAnnotation,
          init,
          span: first.span,
        };
      }
      case "DestructureBinding": {
        const dests = stmts as DestructureBinding[];
        const n0 = dests[0].names.join(",");
        const sameNames = dests.every((d) => d.names.join(",") === n0);
        if (!sameNames) return null;
        const init = antiUnifyExprList(dests.map((d) => d.init));
        return {
          kind: "DestructureBinding",
          names: [...first.names],
          isMut: first.isMut,
          typeAnnotation: first.typeAnnotation,
          init,
          span: first.span,
        };
      }
      case "AssignStmt": {
        const assigns = stmts as AssignStmt[];
        const target = antiUnifyExprList(assigns.map((a) => a.target));
        const value = antiUnifyExprList(assigns.map((a) => a.value));
        return {
          kind: "AssignStmt",
          target,
          op: first.op,
          value,
          span: first.span,
        };
      }
      case "IfStmt": {
        const ifs = stmts as IfStmt[];
        const condition = antiUnifyExprList(ifs.map((i) => i.condition));
        const thenBranchStatements: Statement[] = [];
        for (let sIdx = 0; sIdx < first.thenBranch.statements.length; sIdx++) {
          const unified = antiUnifyStmtList(ifs.map((i) => i.thenBranch.statements[sIdx]));
          if (!unified) return null;
          thenBranchStatements.push(unified);
        }
        const elifBranches: { condition: Expr; body: Block; span: Span }[] = [];
        if (first.elifBranches && first.elifBranches.length > 0) {
          const allSameElifCount = ifs.every(
            (i) => i.elifBranches && i.elifBranches.length === first.elifBranches.length,
          );
          if (allSameElifCount) {
            for (let eIdx = 0; eIdx < first.elifBranches.length; eIdx++) {
              const elifCond = antiUnifyExprList(ifs.map((i) => i.elifBranches[eIdx].condition));
              const elifBodyStatements: Statement[] = [];
              for (let sIdx = 0; sIdx < first.elifBranches[eIdx].body.statements.length; sIdx++) {
                const unified = antiUnifyStmtList(
                  ifs.map((i) => i.elifBranches[eIdx].body.statements[sIdx]),
                );
                if (!unified) return null;
                elifBodyStatements.push(unified);
              }
              elifBranches.push({
                condition: elifCond,
                body: {
                  kind: "Block",
                  statements: elifBodyStatements,
                  span: first.elifBranches[eIdx].body.span,
                },
                span: first.elifBranches[eIdx].span,
              });
            }
          }
        }

        let elseBranch: Block | null = null;
        if (first.elseBranch) {
          const allHaveElse = ifs.every((i) => Boolean(i.elseBranch));
          if (allHaveElse) {
            const elseStatements: Statement[] = [];
            for (let sIdx = 0; sIdx < first.elseBranch.statements.length; sIdx++) {
              const unified = antiUnifyStmtList(ifs.map((i) => i.elseBranch!.statements[sIdx]));
              if (!unified) return null;
              elseStatements.push(unified);
            }
            elseBranch = {
              kind: "Block",
              statements: elseStatements,
              span: first.elseBranch.span,
            };
          }
        }

        return {
          kind: "IfStmt",
          condition,
          thenBranch: {
            kind: "Block",
            statements: thenBranchStatements,
            span: first.thenBranch.span,
          },
          elifBranches,
          elseBranch,
          span: first.span,
        };
      }
      case "ThrowStmt": {
        const throws = stmts as ThrowStmt[];
        const expr = antiUnifyExprList(throws.map((t) => t.expr));
        return { kind: "ThrowStmt", expr, span: first.span };
      }
      case "WhileStmt":
      case "ForStmt":
      case "TryStmt":
      case "MatchStmt": {
        const f0 = generator.formatStatement(first);
        const allIdentical = stmts.every((s) => generator.formatStatement(s) === f0);
        if (allIdentical) {
          return structuredClone(first);
        }
        return null;
      }
      default: {
        const f0 = generator.formatStatement(first);
        const allIdentical = stmts.every((s) => generator.formatStatement(s) === f0);
        if (allIdentical) {
          return structuredClone(first);
        }
        return null;
      }
    }
  }

  const templateStatements: Statement[] = [];
  for (let sIdx = 0; sIdx < k; sIdx++) {
    const occStmts = windows.map((w) => w[sIdx]);
    const unified = antiUnifyStmtList(occStmts);
    if (!unified) return null;
    templateStatements.push(unified);
  }

  if (holeValueVectors.length > maxParams) {
    return null;
  }

  const params: ProjectIdiomParam[] = holeValueVectors.map((_, i) => ({
    name: `$${i}`,
  }));

  return {
    templateStatements,
    holeValuesPerOcc: holeExprsPerOcc,
    params,
  };
}

/**
 * Structural Anti-Unification of Expressions.
 */
function antiUnifyExpressions(
  exprs: Expr[],
  maxParams: number,
  generator: AiceGenerator,
): {
  templateExpr: Expr;
  holeValuesPerOcc: Expr[][];
  params: ProjectIdiomParam[];
} | null {
  const occCount = exprs.length;
  const holeValueVectors: string[][] = [];
  const holeExprsPerOcc: Expr[][] = Array.from({ length: occCount }, () => []);

  function getHole(values: Expr[], formattedValues: string[]): string {
    const key = formattedValues.join("|||");
    for (let h = 0; h < holeValueVectors.length; h++) {
      if (holeValueVectors[h].join("|||") === key) {
        return `$${h}`;
      }
    }
    const idx = holeValueVectors.length;
    holeValueVectors.push(formattedValues);
    for (let occ = 0; occ < occCount; occ++) {
      if (!holeExprsPerOcc[occ]) holeExprsPerOcc[occ] = [];
      holeExprsPerOcc[occ][idx] = values[occ];
    }
    return `$${idx}`;
  }

  function antiUnifyList(list: Expr[]): Expr {
    const f0 = generator.formatExpr(list[0]);
    let allIdentical = true;
    const formatted = [f0];
    for (let i = 1; i < occCount; i++) {
      const fi = generator.formatExpr(list[i]);
      formatted.push(fi);
      if (fi !== f0) allIdentical = false;
    }

    if (allIdentical) {
      return structuredClone(list[0]);
    }

    const first = list[0];
    const allSameKind = list.every((e) => e.kind === first.kind);

    if (allSameKind) {
      if (first.kind === "CallExpr") {
        const calls = list as CallExpr[];
        if (calls.every((c) => c.args.length === first.args.length)) {
          const callee = antiUnifyList(calls.map((c) => c.callee));
          const args: Expr[] = [];
          for (let a = 0; a < first.args.length; a++) {
            args.push(antiUnifyList(calls.map((c) => c.args[a])));
          }
          return { kind: "CallExpr", callee, args, span: first.span };
        }
      } else if (first.kind === "MemberAccessExpr") {
        const members = list as MemberAccessExpr[];
        if (members.every((m) => m.property === first.property)) {
          const object = antiUnifyList(members.map((m) => m.object));
          return {
            kind: "MemberAccessExpr",
            object,
            property: first.property,
            isOptional: first.isOptional,
            isSafeNav: first.isSafeNav ?? false,
            span: first.span,
          };
        }
      } else if (first.kind === "BinaryExpr") {
        const binaries = list as BinaryExpr[];
        if (binaries.every((b) => b.operator === first.operator)) {
          const left = antiUnifyList(binaries.map((b) => b.left));
          const right = antiUnifyList(binaries.map((b) => b.right));
          return { kind: "BinaryExpr", operator: first.operator, left, right, span: first.span };
        }
      } else if (first.kind === "PostfixTryExpr") {
        const tries = list as PostfixTryExpr[];
        const operand = antiUnifyList(tries.map((t) => t.operand));
        return { kind: "PostfixTryExpr", operand, span: first.span };
      } else if (first.kind === "IndexExpr") {
        const indices = list as IndexExpr[];
        const object = antiUnifyList(indices.map((idx) => idx.object));
        const index = antiUnifyList(indices.map((idx) => idx.index));
        return { kind: "IndexExpr", object, index, span: first.span };
      } else if (first.kind === "RecordLiteralExpr") {
        const recs = list as RecordLiteralExpr[];
        const firstKeys = first.properties.map((p) => p.key).join(",");
        if (
          recs.every(
            (r) =>
              r.properties.length === first.properties.length &&
              r.properties.map((p) => p.key).join(",") === firstKeys,
          )
        ) {
          const properties = first.properties.map((prop, pIdx) => ({
            key: prop.key,
            value: antiUnifyList(recs.map((r) => r.properties[pIdx].value)),
            isSpread: prop.isSpread,
            span: prop.span,
          }));
          return { kind: "RecordLiteralExpr", properties, span: first.span };
        }
      } else if (first.kind === "ArrayLiteralExpr") {
        const arrs = list as ArrayLiteralExpr[];
        if (arrs.every((a) => a.elements.length === first.elements.length)) {
          const elements = first.elements.map((_, eIdx) =>
            antiUnifyList(arrs.map((a) => a.elements[eIdx])),
          );
          return { kind: "ArrayLiteralExpr", elements, span: first.span };
        }
      }
    }

    const holeName = getHole(list, formatted);
    return { kind: "IdentifierExpr", name: holeName, span: first.span };
  }

  const templateExpr = antiUnifyList(exprs);

  if (holeValueVectors.length > maxParams) {
    return null;
  }

  const params: ProjectIdiomParam[] = holeValueVectors.map((_, i) => ({
    name: `$${i}`,
  }));

  return {
    templateExpr,
    holeValuesPerOcc: holeExprsPerOcc,
    params,
  };
}

/**
 * Idiom naming heuristics.
 */
function deriveIdiomName(statements: Statement[], kind: "stmt" | "block", index: number): string {
  const first = statements[0];
  if (first.kind === "IfStmt") {
    if (first.condition.kind === "BinaryExpr") {
      const op = first.condition.operator;
      if (op === "!=") return "$guard";
      if (op === "==") return "$check";
    }
    return "$guard";
  }

  if (first.kind === "ExprStmt") {
    return deriveExprIdiomName(first.expr, index);
  }

  if (first.kind === "LetBinding") {
    return `$let_${first.name.replace(/^\$/, "") || "val"}`;
  }

  if (first.kind === "AssignStmt") {
    return deriveExprIdiomName(first.value, index);
  }

  return `$idiom${index}`;
}

function deriveExprIdiomName(expr: Expr, index: number): string {
  if (expr.kind === "CallExpr") {
    if (expr.callee.kind === "IdentifierExpr") {
      const name = expr.callee.name.replace(/^\$/, "");
      return `$${name}`;
    }
    if (expr.callee.kind === "MemberAccessExpr") {
      return `$${expr.callee.property}`;
    }
  }
  if (expr.kind === "MemberAccessExpr") {
    return `$get_${expr.property}`;
  }
  if (expr.kind === "RecordLiteralExpr" && expr.properties.length > 0) {
    const firstKey = (expr.properties[0].key ?? "").replace(/[^a-zA-Z0-9_]/g, "");
    if (firstKey) {
      return `$rec_${firstKey}`;
    }
  }
  return `$idiom${index}`;
}

/**
 * Normalizes local variable names declared inside a statement window to _loc0, _loc1, etc.
 * only when those variable names are not referenced in the subsequent statements of the enclosing block.
 */
export function alphaNormalizeWindow(
  window: Statement[],
  remainingStmtsInBlock: Statement[],
): { window: Statement[]; alphaMap: Map<string, string> } {
  const alphaMap = new Map<string, string>();
  let locIndex = 0;

  for (const s of window) {
    if (s.kind === "LetBinding") {
      const varName = s.name;
      if (!alphaMap.has(varName) && !varName.startsWith("$")) {
        if (!isIdentifierReferencedInStatements(remainingStmtsInBlock, varName)) {
          const canonical = `_loc${locIndex++}`;
          alphaMap.set(varName, canonical);
        }
      }
    }
  }

  if (alphaMap.size === 0) {
    return { window, alphaMap };
  }

  const normalized = window.map((s) => renameIdentifiersInStatement(s, alphaMap));
  return { window: normalized, alphaMap };
}

/**
 * Recursively renames identifiers in a statement according to alphaMap.
 */
export function renameIdentifiersInStatement(
  stmt: Statement,
  alphaMap: Map<string, string>,
): Statement {
  const cloned = structuredClone(stmt);
  switch (cloned.kind) {
    case "LetBinding":
      if (alphaMap.has(cloned.name)) {
        cloned.name = alphaMap.get(cloned.name)!;
      }
      cloned.init = renameIdentifiersInExpr(cloned.init, alphaMap);
      break;
    case "DestructureBinding":
      cloned.names = cloned.names.map((n) => alphaMap.get(n) ?? n);
      cloned.init = renameIdentifiersInExpr(cloned.init, alphaMap);
      break;
    case "ExprStmt":
      cloned.expr = renameIdentifiersInExpr(cloned.expr, alphaMap);
      break;
    case "ReturnStmt":
      if (cloned.value) {
        cloned.value = renameIdentifiersInExpr(cloned.value, alphaMap);
      }
      break;
    case "AssignStmt":
      cloned.target = renameIdentifiersInExpr(cloned.target, alphaMap);
      cloned.value = renameIdentifiersInExpr(cloned.value, alphaMap);
      break;
    case "IfStmt":
      cloned.condition = renameIdentifiersInExpr(cloned.condition, alphaMap);
      cloned.thenBranch = {
        ...cloned.thenBranch,
        statements: cloned.thenBranch.statements.map((s) =>
          renameIdentifiersInStatement(s, alphaMap),
        ),
      };
      cloned.elifBranches = cloned.elifBranches.map((el) => ({
        ...el,
        condition: renameIdentifiersInExpr(el.condition, alphaMap),
        body: {
          ...el.body,
          statements: el.body.statements.map((s) => renameIdentifiersInStatement(s, alphaMap)),
        },
      }));
      if (cloned.elseBranch) {
        cloned.elseBranch = {
          ...cloned.elseBranch,
          statements: cloned.elseBranch.statements.map((s) =>
            renameIdentifiersInStatement(s, alphaMap),
          ),
        };
      }
      break;
    case "WhileStmt":
      cloned.condition = renameIdentifiersInExpr(cloned.condition, alphaMap);
      cloned.body = {
        ...cloned.body,
        statements: cloned.body.statements.map((s) => renameIdentifiersInStatement(s, alphaMap)),
      };
      break;
    case "ForStmt":
      if (alphaMap.has(cloned.variable)) {
        cloned.variable = alphaMap.get(cloned.variable)!;
      }
      cloned.iterable = renameIdentifiersInExpr(cloned.iterable, alphaMap);
      cloned.body = {
        ...cloned.body,
        statements: cloned.body.statements.map((s) => renameIdentifiersInStatement(s, alphaMap)),
      };
      break;
    case "TryStmt":
      cloned.tryBlock = {
        ...cloned.tryBlock,
        statements: cloned.tryBlock.statements.map((s) =>
          renameIdentifiersInStatement(s, alphaMap),
        ),
      };
      if (cloned.catchBlock) {
        cloned.catchBlock = {
          ...cloned.catchBlock,
          statements: cloned.catchBlock.statements.map((s) =>
            renameIdentifiersInStatement(s, alphaMap),
          ),
        };
      }
      if (cloned.finallyBlock) {
        cloned.finallyBlock = {
          ...cloned.finallyBlock,
          statements: cloned.finallyBlock.statements.map((s) =>
            renameIdentifiersInStatement(s, alphaMap),
          ),
        };
      }
      break;
    case "ThrowStmt":
      cloned.expr = renameIdentifiersInExpr(cloned.expr, alphaMap);
      break;
    case "MatchStmt":
      cloned.target = renameIdentifiersInExpr(cloned.target, alphaMap);
      cloned.cases = cloned.cases.map((c) => {
        const caseCopy = { ...c };
        if (caseCopy.guard) {
          caseCopy.guard = renameIdentifiersInExpr(caseCopy.guard, alphaMap);
        }
        if ("statements" in caseCopy.body) {
          caseCopy.body = {
            ...caseCopy.body,
            statements: caseCopy.body.statements.map((s) =>
              renameIdentifiersInStatement(s, alphaMap),
            ),
          };
        } else {
          caseCopy.body = renameIdentifiersInExpr(caseCopy.body, alphaMap);
        }
        return caseCopy;
      });
      break;
  }
  return cloned;
}

/**
 * Recursively renames identifiers in an expression according to alphaMap.
 */
export function renameIdentifiersInExpr(expr: Expr, alphaMap: Map<string, string>): Expr {
  if (!expr) return expr;
  const cloned = structuredClone(expr);
  switch (cloned.kind) {
    case "IdentifierExpr":
      if (alphaMap.has(cloned.name)) {
        cloned.name = alphaMap.get(cloned.name)!;
      }
      break;
    case "CallExpr":
      cloned.callee = renameIdentifiersInExpr(cloned.callee, alphaMap);
      cloned.args = cloned.args.map((a) => renameIdentifiersInExpr(a, alphaMap));
      break;
    case "MemberAccessExpr":
      cloned.object = renameIdentifiersInExpr(cloned.object, alphaMap);
      break;
    case "IndexExpr":
      cloned.object = renameIdentifiersInExpr(cloned.object, alphaMap);
      cloned.index = renameIdentifiersInExpr(cloned.index, alphaMap);
      break;
    case "BinaryExpr":
      cloned.left = renameIdentifiersInExpr(cloned.left, alphaMap);
      cloned.right = renameIdentifiersInExpr(cloned.right, alphaMap);
      break;
    case "UnaryExpr":
      cloned.operand = renameIdentifiersInExpr(cloned.operand, alphaMap);
      break;
    case "PostfixTryExpr":
      cloned.operand = renameIdentifiersInExpr(cloned.operand, alphaMap);
      break;
    case "ArrayLiteralExpr":
      cloned.elements = cloned.elements.map((el) => renameIdentifiersInExpr(el, alphaMap));
      break;
    case "RecordLiteralExpr":
      cloned.properties = cloned.properties.map((p) => ({
        ...p,
        value: renameIdentifiersInExpr(p.value, alphaMap),
      }));
      break;
    case "AwaitExpr":
      cloned.operand = renameIdentifiersInExpr(cloned.operand, alphaMap);
      break;
    case "AssignExpr":
      cloned.target = renameIdentifiersInExpr(cloned.target, alphaMap);
      cloned.value = renameIdentifiersInExpr(cloned.value, alphaMap);
      break;
    case "TemplateLiteralExpr":
      cloned.expressions = cloned.expressions.map((e) => renameIdentifiersInExpr(e, alphaMap));
      break;
    case "ClosureExpr": {
      const shadowed = new Set(cloned.params.map((p) => p.name));
      const childAlphaMap = new Map(alphaMap);
      for (const p of shadowed) {
        childAlphaMap.delete(p);
      }
      if ("statements" in cloned.body) {
        cloned.body = {
          ...cloned.body,
          statements: cloned.body.statements.map((s) =>
            renameIdentifiersInStatement(s, childAlphaMap),
          ),
        };
      } else {
        cloned.body = renameIdentifiersInExpr(cloned.body, childAlphaMap);
      }
      break;
    }
  }
  return cloned;
}

/**
 * Checks if a specific variable name is referenced in a list of statements.
 */
export function isIdentifierReferencedInStatements(stmts: Statement[], name: string): boolean {
  for (const s of stmts) {
    if (isIdentifierReferencedInStatement(s, name)) return true;
  }
  return false;
}

export function isIdentifierReferencedInStatement(stmt: Statement, name: string): boolean {
  if (!stmt) return false;
  switch (stmt.kind) {
    case "LetBinding":
      return stmt.name === name || isIdentifierReferencedInExpr(stmt.init, name);
    case "DestructureBinding":
      return stmt.names.includes(name) || isIdentifierReferencedInExpr(stmt.init, name);
    case "ExprStmt":
      return isIdentifierReferencedInExpr(stmt.expr, name);
    case "ReturnStmt":
      return stmt.value ? isIdentifierReferencedInExpr(stmt.value, name) : false;
    case "AssignStmt":
      return (
        isIdentifierReferencedInExpr(stmt.target, name) ||
        isIdentifierReferencedInExpr(stmt.value, name)
      );
    case "IfStmt":
      if (isIdentifierReferencedInExpr(stmt.condition, name)) return true;
      if (isIdentifierReferencedInStatements(stmt.thenBranch.statements, name)) return true;
      for (const el of stmt.elifBranches) {
        if (isIdentifierReferencedInExpr(el.condition, name)) return true;
        if (isIdentifierReferencedInStatements(el.body.statements, name)) return true;
      }
      if (stmt.elseBranch) {
        if (isIdentifierReferencedInStatements(stmt.elseBranch.statements, name)) return true;
      }
      return false;
    case "WhileStmt":
      return (
        isIdentifierReferencedInExpr(stmt.condition, name) ||
        isIdentifierReferencedInStatements(stmt.body.statements, name)
      );
    case "ForStmt":
      return (
        stmt.variable === name ||
        isIdentifierReferencedInExpr(stmt.iterable, name) ||
        isIdentifierReferencedInStatements(stmt.body.statements, name)
      );
    case "TryStmt":
      if (isIdentifierReferencedInStatements(stmt.tryBlock.statements, name)) return true;
      if (stmt.catchBlock && isIdentifierReferencedInStatements(stmt.catchBlock.statements, name))
        return true;
      if (
        stmt.finallyBlock &&
        isIdentifierReferencedInStatements(stmt.finallyBlock.statements, name)
      )
        return true;
      return false;
    case "ThrowStmt":
      return isIdentifierReferencedInExpr(stmt.expr, name);
    case "MatchStmt":
      if (isIdentifierReferencedInExpr(stmt.target, name)) return true;
      for (const c of stmt.cases) {
        if (c.guard && isIdentifierReferencedInExpr(c.guard, name)) return true;
        if ("statements" in c.body) {
          if (isIdentifierReferencedInStatements(c.body.statements, name)) return true;
        } else {
          if (isIdentifierReferencedInExpr(c.body, name)) return true;
        }
      }
      return false;
    default:
      return false;
  }
}

export function isIdentifierReferencedInExpr(expr: Expr, name: string): boolean {
  if (!expr) return false;
  switch (expr.kind) {
    case "IdentifierExpr":
      return expr.name === name;
    case "CallExpr":
      if (isIdentifierReferencedInExpr(expr.callee, name)) return true;
      for (const a of expr.args) {
        if (isIdentifierReferencedInExpr(a, name)) return true;
      }
      return false;
    case "MemberAccessExpr":
      return isIdentifierReferencedInExpr(expr.object, name);
    case "IndexExpr":
      return (
        isIdentifierReferencedInExpr(expr.object, name) ||
        isIdentifierReferencedInExpr(expr.index, name)
      );
    case "BinaryExpr":
      return (
        isIdentifierReferencedInExpr(expr.left, name) ||
        isIdentifierReferencedInExpr(expr.right, name)
      );
    case "UnaryExpr":
      return isIdentifierReferencedInExpr(expr.operand, name);
    case "PostfixTryExpr":
      return isIdentifierReferencedInExpr(expr.operand, name);
    case "ArrayLiteralExpr":
      for (const el of expr.elements) {
        if (isIdentifierReferencedInExpr(el, name)) return true;
      }
      return false;
    case "RecordLiteralExpr":
      for (const p of expr.properties) {
        if (isIdentifierReferencedInExpr(p.value, name)) return true;
      }
      return false;
    case "AwaitExpr":
      return isIdentifierReferencedInExpr(expr.operand, name);
    case "AssignExpr":
      return (
        isIdentifierReferencedInExpr(expr.target, name) ||
        isIdentifierReferencedInExpr(expr.value, name)
      );
    case "TemplateLiteralExpr":
      for (const e of expr.expressions) {
        if (isIdentifierReferencedInExpr(e, name)) return true;
      }
      return false;
    case "ClosureExpr":
      if (expr.params.some((p) => p.name === name)) return false;
      if ("statements" in expr.body) {
        return isIdentifierReferencedInStatements(expr.body.statements, name);
      }
      return isIdentifierReferencedInExpr(expr.body, name);
    default:
      return false;
  }
}

/**
 * Collects all declared or referenced identifiers in a statement into a Set.
 */
export function collectIdentifiersInStatement(stmt: Statement, set: Set<string>): void {
  if (!stmt) return;
  switch (stmt.kind) {
    case "LetBinding":
      set.add(stmt.name);
      collectIdentifiersInExpr(stmt.init, set);
      break;
    case "DestructureBinding":
      for (const n of stmt.names) set.add(n);
      collectIdentifiersInExpr(stmt.init, set);
      break;
    case "ExprStmt":
      collectIdentifiersInExpr(stmt.expr, set);
      break;
    case "ReturnStmt":
      if (stmt.value) collectIdentifiersInExpr(stmt.value, set);
      break;
    case "AssignStmt":
      collectIdentifiersInExpr(stmt.target, set);
      collectIdentifiersInExpr(stmt.value, set);
      break;
    case "IfStmt":
      collectIdentifiersInExpr(stmt.condition, set);
      for (const s of stmt.thenBranch.statements) collectIdentifiersInStatement(s, set);
      for (const el of stmt.elifBranches) {
        collectIdentifiersInExpr(el.condition, set);
        for (const s of el.body.statements) collectIdentifiersInStatement(s, set);
      }
      if (stmt.elseBranch) {
        for (const s of stmt.elseBranch.statements) collectIdentifiersInStatement(s, set);
      }
      break;
    case "WhileStmt":
      collectIdentifiersInExpr(stmt.condition, set);
      for (const s of stmt.body.statements) collectIdentifiersInStatement(s, set);
      break;
    case "ForStmt":
      set.add(stmt.variable);
      collectIdentifiersInExpr(stmt.iterable, set);
      for (const s of stmt.body.statements) collectIdentifiersInStatement(s, set);
      break;
    case "TryStmt":
      for (const s of stmt.tryBlock.statements) collectIdentifiersInStatement(s, set);
      if (stmt.catchBlock) {
        if (stmt.catchParam) set.add(stmt.catchParam);
        for (const s of stmt.catchBlock.statements) collectIdentifiersInStatement(s, set);
      }
      if (stmt.finallyBlock) {
        for (const s of stmt.finallyBlock.statements) collectIdentifiersInStatement(s, set);
      }
      break;
    case "ThrowStmt":
      collectIdentifiersInExpr(stmt.expr, set);
      break;
    case "MatchStmt":
      collectIdentifiersInExpr(stmt.target, set);
      for (const c of stmt.cases) {
        if (c.guard) collectIdentifiersInExpr(c.guard, set);
        if ("statements" in c.body) {
          for (const s of c.body.statements) collectIdentifiersInStatement(s, set);
        } else {
          collectIdentifiersInExpr(c.body, set);
        }
      }
      break;
  }
}

export function collectIdentifiersInExpr(expr: Expr, set: Set<string>): void {
  if (!expr) return;
  switch (expr.kind) {
    case "IdentifierExpr":
      set.add(expr.name);
      break;
    case "CallExpr":
      collectIdentifiersInExpr(expr.callee, set);
      for (const a of expr.args) collectIdentifiersInExpr(a, set);
      break;
    case "MemberAccessExpr":
      collectIdentifiersInExpr(expr.object, set);
      break;
    case "IndexExpr":
      collectIdentifiersInExpr(expr.object, set);
      collectIdentifiersInExpr(expr.index, set);
      break;
    case "BinaryExpr":
      collectIdentifiersInExpr(expr.left, set);
      collectIdentifiersInExpr(expr.right, set);
      break;
    case "UnaryExpr":
      collectIdentifiersInExpr(expr.operand, set);
      break;
    case "PostfixTryExpr":
      collectIdentifiersInExpr(expr.operand, set);
      break;
    case "ArrayLiteralExpr":
      for (const el of expr.elements) collectIdentifiersInExpr(el, set);
      break;
    case "RecordLiteralExpr":
      for (const p of expr.properties) collectIdentifiersInExpr(p.value, set);
      break;
    case "AwaitExpr":
      collectIdentifiersInExpr(expr.operand, set);
      break;
    case "AssignExpr":
      collectIdentifiersInExpr(expr.target, set);
      collectIdentifiersInExpr(expr.value, set);
      break;
    case "TemplateLiteralExpr":
      for (const e of expr.expressions) collectIdentifiersInExpr(e, set);
      break;
    case "ClosureExpr":
      for (const p of expr.params) set.add(p.name);
      if ("statements" in expr.body) {
        for (const s of expr.body.statements) collectIdentifiersInStatement(s, set);
      } else {
        collectIdentifiersInExpr(expr.body, set);
      }
      break;
  }
}
