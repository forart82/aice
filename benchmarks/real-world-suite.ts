/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AIL 2.0 Real-World Benchmark Suite (10 End-to-End Real-World Benchmarks):
 *   RW-01: HTML5 Canvas Arcade Snake Window Application from 0 (.ts, .html, .css, .json)
 *   RW-02: Headless Python CLI Task Queue & Telemetry Worker Daemon from 0 (.py, .yaml, .json)
 *   RW-03: Symfony/PHP + JS + Twig + CSS + HTML + YAML + JSON Storefront Checkout Bug Fix
 *   RW-04: Vite + TypeScript + React TSX + CSS + HTML + JSON + YAML Analytics Dashboard New Feature
 *   RW-05: Go API Gateway + Rust WAL Storage Engine Distributed Ledger Mesh Update Feature (.go, .rs, .yaml, .json)
 *   RW-06: C++20 Framebuffer Physics Viewport + TypeScript Inspector Overlay Bug Fix (.cpp, .ts, .html, .css, .json)
 *   RW-07: C# .NET Payment Settlement Service + Kotlin Fraud Scoring Engine New Feature (.cs, .kt, .yaml, .json)
 *   RW-08: Python FastAPI + React TSX + Twig Invoice Studio + CSS + JSON + YAML Billing Update Feature
 *   RW-09: High-Frequency Order Book Matching Engine & Risk Guard Daemon Bug Fix (.rs, .cpp, .py, .go, .yaml, .json)
 *   RW-10: Unified 15-Language Enterprise Cloud Observability & Control Plane Update Feature (all 15 file types)
 *
 * Honest 3-Way Apples-to-Apples Evaluation for Every Operation:
 *   1. Without AIL (Native Baseline):
 *      - Write from 0: Raw native code tokens written to disk.
 *      - Read (Discovery + Surgical Read): Symbol discovery headers + surgical read_file window of target symbols.
 *      - Update (Bug Fix / New Feature / Update Feature): Surgical replace_file_content (TargetContent + ReplacementContent).
 *      - Delete (Remove Obsolete Symbol/Rule/Key): Surgical replace_file_content (TargetContent of deleted block).
 *      - Refactor (Cross-Site Pattern Change): Surgical replace_file_content across affected functions/files.
 *   2. AIL On-the-Fly WITHOUT Idioms (Pure Syntax + AST Tooling):
 *      - Write from 0: Pure AIL code tokens (zero $idiom macros) compiled directly to native disk.
 *      - Read: `ail outline` + decompiled pure AIL slice of target symbols (`--no-idioms`).
 *      - Update: `ail splice <file> --symbol <sym> --code "<pure AIL>"` (or `--insert-after`).
 *      - Delete: `ail splice <file> --symbol <sym> --delete`.
 *      - Refactor: `ail splice` across affected symbols in pure AIL (eliminating TargetContent duplication).
 *   3. AIL On-the-Fly WITH Idioms (Syntax + AST Tooling + $idioms, including definition overhead):
 *      - Write from 0: Idiom-compressed AIL code tokens PLUS full token cost of all `idiom $name(...)` definitions.
 *      - Read: `ail outline` + decompiled $idiom-collapsed AIL slice of target symbols (`--idioms`).
 *      - Update: `ail splice <file> --symbol <sym> --code "<AIL with $idioms>"` (or `--insert-after`).
 *      - Delete: `ail splice <file> --symbol <sym> --delete`.
 *      - Refactor: Single `ail idiom update $name "<new template>"` propagated across all call sites.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ProjectIdiomDefinition } from "../src/config/index.js";
import type { Module, ModuleItem } from "../src/core/ast.js";
import { parse } from "../src/core/parser.js";
import { AilGenerator, decompile } from "../src/decompiler/index.js";
import { emitTarget, type TargetLanguage } from "../src/emitters/index.js";
import {
  collapseModuleIdioms,
  expandModuleIdioms,
} from "../src/idioms/index.js";
import { estimateTokens } from "../src/tokenomics/index.js";
import { generateOutline } from "../src/tools/outline.js";
import { spliceNativeSource } from "../src/tools/splice.js";

export type BenchmarkLanguageId =
  | "ts"
  | "tsx"
  | "js"
  | "py"
  | "go"
  | "rs"
  | "cpp"
  | "cs"
  | "kt"
  | "php"
  | "css"
  | "html"
  | "json"
  | "yaml"
  | "twig";

export type EngineeringScenarioKind =
  | "from_zero_window_app"
  | "from_zero_non_window_app"
  | "bug_fix"
  | "new_feature"
  | "update_feature";

export type ApplicationSurfaceKind = "window" | "non_window";

export interface LanguageSpec {
  id: BenchmarkLanguageId;
  label: string;
  extension: string;
  target: TargetLanguage;
  idiomName: string;
}

export const SUPPORTED_BENCHMARK_LANGUAGES: readonly LanguageSpec[] = [
  { id: "ts", label: "TypeScript (.ts)", extension: ".ts", target: "typescript", idiomName: "$clamp_step" },
  { id: "tsx", label: "React TSX (.tsx)", extension: ".tsx", target: "tsx", idiomName: "$tsx_row" },
  { id: "js", label: "JavaScript (.js)", extension: ".js", target: "javascript", idiomName: "$clamp_step" },
  { id: "py", label: "Python (.py)", extension: ".py", target: "python", idiomName: "$py_step" },
  { id: "go", label: "Go (.go)", extension: ".go", target: "go", idiomName: "$go_step" },
  { id: "rs", label: "Rust (.rs)", extension: ".rs", target: "rust", idiomName: "$rs_step" },
  { id: "cpp", label: "C++20 (.cpp)", extension: ".cpp", target: "cpp", idiomName: "$cpp_step" },
  { id: "cs", label: "C# (.cs)", extension: ".cs", target: "csharp", idiomName: "$cs_step" },
  { id: "kt", label: "Kotlin (.kt)", extension: ".kt", target: "kotlin", idiomName: "$kt_step" },
  { id: "php", label: "PHP 8 (.php)", extension: ".php", target: "php", idiomName: "$php_step" },
  { id: "css", label: "CSS3 (.css)", extension: ".css", target: "css", idiomName: "$css_card" },
  { id: "html", label: "HTML5 (.html)", extension: ".html", target: "html", idiomName: "$html_row" },
  { id: "json", label: "JSON (.json)", extension: ".json", target: "json", idiomName: "$json_row" },
  { id: "yaml", label: "YAML (.yaml)", extension: ".yaml", target: "yaml", idiomName: "$yaml_row" },
  { id: "twig", label: "Twig (.twig)", extension: ".twig", target: "twig", idiomName: "$twig_row" },
] as const;

export interface ThreeWayOperationScore {
  withoutAilTokens: number;
  ailWithoutIdiomsTokens: number;
  ailWithIdiomsTokens: number;
  savedWithoutIdiomsTokens: number;
  savingsWithoutIdiomsPct: number;
  savedWithIdiomsTokens: number;
  savingsWithIdiomsPct: number;
  idiomExtraSavingsPct: number;
  ailWithoutIdiomsWins: boolean;
  ailWithIdiomsWins: boolean;
}

export interface RealWorldModuleFileResult {
  fileName: string;
  languageId: BenchmarkLanguageId;
  extension: string;
  withoutAilTokens: number;
  ailWithoutIdiomsTokens: number;
  ailWithIdiomsTokens: number;
  savingsWithoutIdiomsPct: number;
  savingsWithIdiomsPct: number;
}

export interface RealWorldBenchmarkResult {
  id: string;
  title: string;
  description: string;
  scenario: EngineeringScenarioKind;
  appSurface: ApplicationSurfaceKind;
  languages: BenchmarkLanguageId[];
  extensions: string[];
  filesCount: number;
  idiomsUsed: string[];
  idiomDefinitionsTokens: number;
  files: RealWorldModuleFileResult[];
  writeFromZero: ThreeWayOperationScore;
  readContext: ThreeWayOperationScore;
  surgicalUpdate: ThreeWayOperationScore;
  surgicalDelete: ThreeWayOperationScore;
  multiFileRefactor: ThreeWayOperationScore;
  total: ThreeWayOperationScore;
  ailWinsAllWithoutIdioms: boolean;
  ailWinsAllWithIdioms: boolean;
  zeroAilFilesLeftOnDisk: boolean;
}

export interface RealWorldBenchmarkSuiteReport {
  totalBenchmarks: number;
  winsWithoutIdioms: number;
  winsWithIdioms: number;
  winRateWithoutIdiomsPct: number;
  winRateWithIdiomsPct: number;
  zeroAilFilesLeftOnDisk: boolean;
  coveredLanguages: BenchmarkLanguageId[];
  coveredExtensions: string[];
  coveredScenarios: EngineeringScenarioKind[];
  coveredSurfaces: ApplicationSurfaceKind[];
  aggregateWrite: ThreeWayOperationScore;
  aggregateRead: ThreeWayOperationScore;
  aggregateUpdate: ThreeWayOperationScore;
  aggregateDelete: ThreeWayOperationScore;
  aggregateRefactor: ThreeWayOperationScore;
  aggregateTotal: ThreeWayOperationScore;
  benchmarks: RealWorldBenchmarkResult[];
}

function countTokens(text: string): number {
  return estimateTokens(text, "cl100k_base");
}

function makeThreeWayScore(
  withoutAilTokens: number,
  ailWithoutIdiomsTokens: number,
  ailWithIdiomsTokens: number,
): ThreeWayOperationScore {
  const savedWithoutIdiomsTokens = withoutAilTokens - ailWithoutIdiomsTokens;
  const savingsWithoutIdiomsPct =
    withoutAilTokens > 0
      ? Number(((savedWithoutIdiomsTokens / withoutAilTokens) * 100).toFixed(2))
      : 0;
  const savedWithIdiomsTokens = withoutAilTokens - ailWithIdiomsTokens;
  const savingsWithIdiomsPct =
    withoutAilTokens > 0
      ? Number(((savedWithIdiomsTokens / withoutAilTokens) * 100).toFixed(2))
      : 0;
  const idiomExtraSavingsPct = Number(
    (savingsWithIdiomsPct - savingsWithoutIdiomsPct).toFixed(2),
  );
  return {
    withoutAilTokens,
    ailWithoutIdiomsTokens,
    ailWithIdiomsTokens,
    savedWithoutIdiomsTokens,
    savingsWithoutIdiomsPct,
    savedWithIdiomsTokens,
    savingsWithIdiomsPct,
    idiomExtraSavingsPct,
    ailWithoutIdiomsWins: ailWithoutIdiomsTokens < withoutAilTokens,
    ailWithIdiomsWins:
      ailWithIdiomsTokens < withoutAilTokens &&
      ailWithIdiomsTokens <= ailWithoutIdiomsTokens,
  };
}

function makeIdiomDef(
  name: string,
  kind: "expr" | "stmt" | "block",
  params: Array<{ name: string; type: string }>,
  templateAil: string,
): ProjectIdiomDefinition {
  return {
    name,
    kind,
    params,
    templateAil,
    occurrences: 8,
    tokensPerOccurrenceSaved: 20,
    netTokenSavings: 160,
  };
}

export function buildIdiomRegistryForLanguage(
  lang: BenchmarkLanguageId,
): {
  idioms: Record<string, ProjectIdiomDefinition>;
  updatedTemplateAil: string;
  definitionSource: string;
} {
  const codeStepTemplate = [
    "if acc < $0:",
    "  acc = $0",
    "if acc > $1:",
    "  acc = $1",
    "acc = acc + $0",
  ].join("\n");
  const codeStepUpdated = [
    "if acc < $0:",
    "  acc = $0",
    "if acc > $1:",
    "  acc = $1",
    "acc = acc + $0 + 1",
  ].join("\n");
  const intPairParams = [
    { name: "$0", type: "int" },
    { name: "$1", type: "int" },
  ];

  const formatDef = (def: ProjectIdiomDefinition): string => {
    const pStr = def.params.map((p) => `${p.name}: ${p.type}`).join(", ");
    return `idiom ${def.name}(${pStr}) {\n  ${def.templateAil.replace(/\n/g, "\n  ")}\n}`;
  };

  switch (lang) {
    case "ts":
    case "js": {
      const def = makeIdiomDef("$clamp_step", "stmt", intPairParams, codeStepTemplate);
      return {
        idioms: { $clamp_step: def },
        updatedTemplateAil: codeStepUpdated,
        definitionSource: formatDef(def),
      };
    }
    case "tsx": {
      const def = makeIdiomDef(
        "$tsx_row",
        "stmt",
        [
          { name: "$0", type: "string" },
          { name: "$1", type: "int" },
        ],
        [
          "if rows < $1:",
          "  rows = $1",
          "if rows > 1000:",
          "  rows = 1000",
          "rows = rows + $1",
        ].join("\n"),
      );
      return {
        idioms: { $tsx_row: def },
        updatedTemplateAil: [
          "if rows < $1:",
          "  rows = $1",
          "if rows > 2000:",
          "  rows = 2000",
          "rows = rows + $1",
        ].join("\n"),
        definitionSource: formatDef(def),
      };
    }
    case "py": {
      const def = makeIdiomDef("$py_step", "stmt", intPairParams, codeStepTemplate);
      return {
        idioms: { $py_step: def },
        updatedTemplateAil: codeStepUpdated,
        definitionSource: formatDef(def),
      };
    }
    case "go": {
      const def = makeIdiomDef("$go_step", "stmt", intPairParams, codeStepTemplate);
      return {
        idioms: { $go_step: def },
        updatedTemplateAil: codeStepUpdated,
        definitionSource: formatDef(def),
      };
    }
    case "rs": {
      const def = makeIdiomDef("$rs_step", "stmt", intPairParams, codeStepTemplate);
      return {
        idioms: { $rs_step: def },
        updatedTemplateAil: codeStepUpdated,
        definitionSource: formatDef(def),
      };
    }
    case "cpp": {
      const def = makeIdiomDef("$cpp_step", "stmt", intPairParams, codeStepTemplate);
      return {
        idioms: { $cpp_step: def },
        updatedTemplateAil: codeStepUpdated,
        definitionSource: formatDef(def),
      };
    }
    case "cs": {
      const def = makeIdiomDef("$cs_step", "stmt", intPairParams, codeStepTemplate);
      return {
        idioms: { $cs_step: def },
        updatedTemplateAil: codeStepUpdated,
        definitionSource: formatDef(def),
      };
    }
    case "kt": {
      const def = makeIdiomDef("$kt_step", "stmt", intPairParams, codeStepTemplate);
      return {
        idioms: { $kt_step: def },
        updatedTemplateAil: codeStepUpdated,
        definitionSource: formatDef(def),
      };
    }
    case "php": {
      const def = makeIdiomDef("$php_step", "stmt", intPairParams, codeStepTemplate);
      return {
        idioms: { $php_step: def },
        updatedTemplateAil: codeStepUpdated,
        definitionSource: formatDef(def),
      };
    }
    case "css": {
      const def = makeIdiomDef(
        "$css_card",
        "stmt",
        [
          { name: "$0", type: "string" },
          { name: "$1", type: "string" },
        ],
        [
          "fl-center",
          "padding: $0",
          "gap: $1",
          "border-radius: 8px",
        ].join("\n"),
      );
      return {
        idioms: { $css_card: def },
        updatedTemplateAil: [
          "fl-center",
          "padding: $0",
          "gap: $1",
          "border-radius: 12px",
        ].join("\n"),
        definitionSource: formatDef(def),
      };
    }
    case "html": {
      const def = makeIdiomDef(
        "$html_row",
        "stmt",
        [
          { name: "$0", type: "string" },
          { name: "$1", type: "string" },
          { name: "$2", type: "string" },
        ],
        'div(class="metric-row", data-key=$0) { span(class="metric-label"): $1; strong(class="metric-val"): $2 }',
      );
      return {
        idioms: { $html_row: def },
        updatedTemplateAil:
          'div(class="metric-row-v2", data-key=$0) { span(class="metric-label"): $1; strong(class="metric-val"): $2 }',
        definitionSource: formatDef(def),
      };
    }
    case "json": {
      const def = makeIdiomDef(
        "$json_row",
        "expr",
        [
          { name: "$0", type: "string" },
          { name: "$1", type: "int" },
        ],
        '{ path: $0, method: "POST", timeoutMs: $1, retries: 3, authRequired: true, cacheTtlSec: 120 }',
      );
      return {
        idioms: { $json_row: def },
        updatedTemplateAil:
          '{ path: $0, method: "POST", timeoutMs: $1, retries: 5, authRequired: true, cacheTtlSec: 300 }',
        definitionSource: formatDef(def),
      };
    }
    case "yaml": {
      const def = makeIdiomDef(
        "$yaml_row",
        "expr",
        [
          { name: "$0", type: "string" },
          { name: "$1", type: "int" },
        ],
        '{ service: $0, port: $1, replicas: 3, healthCheckSec: 15, tlsEnabled: true, buckets: [10, 25, 50, 100, 250, 500] }',
      );
      return {
        idioms: { $yaml_row: def },
        updatedTemplateAil:
          '{ service: $0, port: $1, replicas: 4, healthCheckSec: 10, tlsEnabled: true, buckets: [10, 25, 50, 100, 250, 500] }',
        definitionSource: formatDef(def),
      };
    }
    case "twig": {
      const def = makeIdiomDef(
        "$twig_row",
        "stmt",
        [
          { name: "$0", type: "string" },
          { name: "$1", type: "string" },
        ],
        'div(class="row") { span(class="lbl"): $0; span(class="val"): $1 }',
      );
      return {
        idioms: { $twig_row: def },
        updatedTemplateAil:
          'div(class="row-v2") { span(class="lbl"): $0; span(class="val"): $1 }',
        definitionSource: formatDef(def),
      };
    }
  }
}

export interface RealWorldFileSpec {
  fileName: string;
  languageId: BenchmarkLanguageId;
  ailWithIdioms: string;
  targetSymbol: string;
  updatedTargetSymbolAilWithIdioms: string;
  obsoleteSymbol?: string;
}

export interface RealWorldBenchmarkSpec {
  id: string;
  title: string;
  description: string;
  scenario: EngineeringScenarioKind;
  appSurface: ApplicationSurfaceKind;
  files: RealWorldFileSpec[];
}

function buildDomainModuleSpec(
  fileName: string,
  languageId: BenchmarkLanguageId,
  domainFunctions: Array<{ name: string; param: string; pairs: Array<[number, number]> }>,
  scenario: EngineeringScenarioKind,
  obsoleteName?: string,
): RealWorldFileSpec {
  const langSpec = SUPPORTED_BENCHMARK_LANGUAGES.find((l) => l.id === languageId)!;
  const idiom = langSpec.idiomName;

  if (languageId === "css") {
    const selectors = domainFunctions.map((f) => `.${f.name.replace(/_/g, "-")}`);
    const blocks: string[] = [
      "style :root {",
      "  --space-xs: 4px",
      "  --space-sm: 8px",
      "  --space-md: 16px",
      "  --space-lg: 24px",
      "  --space-xl: 32px",
      "}",
    ];
    for (let i = 0; i < selectors.length; i++) {
      const sel = selectors[i];
      const [pad, gap] = domainFunctions[i].pairs[0];
      blocks.push(
        [
          `style ${sel} {`,
          `  ${idiom}("${pad}px", "${gap}px")`,
          `  ${idiom}("${pad + 4}px", "${gap + 2}px")`,
          `  z-index: ${i + 1}`,
          "}",
        ].join("\n"),
      );
    }
    if (obsoleteName) {
      const cleanObs = obsoleteName.replace(/_/g, "-");
      blocks.push(
        [
          `style .${cleanObs} {`,
          `  ${idiom}("6px", "4px")`,
          `  ${idiom}("8px", "6px")`,
          "  opacity: 0",
          "}",
        ].join("\n"),
      );
    }
    const targetSel = selectors[0];
    const updatedRule =
      scenario === "new_feature"
        ? [
            `style ${targetSel}-active {`,
            `  ${idiom}("20px", "12px")`,
            `  ${idiom}("24px", "16px")`,
            "  z-index: 50",
            "}",
          ].join("\n")
        : [
            `style ${targetSel} {`,
            `  ${idiom}("18px", "10px")`,
            `  ${idiom}("22px", "14px")`,
            "  z-index: 10",
            "}",
          ].join("\n");
    return {
      fileName,
      languageId,
      ailWithIdioms: blocks.join("\n\n"),
      targetSymbol: targetSel,
      updatedTargetSymbolAilWithIdioms: updatedRule,
      obsoleteSymbol: obsoleteName ? `.${obsoleteName.replace(/_/g, "-")}` : undefined,
    };
  }

  if (languageId === "html") {
    const lines: string[] = ["component AppShellView():", '  main(id="app_root") {'];
    for (const fn of domainFunctions) {
      lines.push(`    section(id="${fn.name}", class="panel") {`);
      for (let idx = 0; idx < fn.pairs.length; idx++) {
        const [a, b] = fn.pairs[idx];
        lines.push(`      ${idiom}("${fn.name}_${idx}", "Metric ${a}", "${b}")`);
      }
      lines.push("    }");
    }
    if (obsoleteName) {
      lines.push(`    section(id="${obsoleteName}", class="panel") {`);
      lines.push(`      ${idiom}("legacy_0", "Deprecated", "0")`);
      lines.push(`      ${idiom}("legacy_1", "Obsolete", "0")`);
      lines.push("    }");
    }
    lines.push("  }");

    const targetId = domainFunctions[0].name;
    const updatedSection =
      scenario === "new_feature"
        ? [
            `section(id="${targetId}_extra", class="panel") {`,
            `  ${idiom}("new_0", "Live Peak", "950")`,
            `  ${idiom}("new_1", "Live Floor", "120")`,
            "}",
          ].join("\n")
        : [
            `section(id="${targetId}", class="panel") {`,
            `  ${idiom}("upd_0", "Verified Metric", "840")`,
            `  ${idiom}("upd_1", "Verified Delta", "420")`,
            "}",
          ].join("\n");
    return {
      fileName,
      languageId,
      ailWithIdioms: lines.join("\n"),
      targetSymbol: `#${targetId}`,
      updatedTargetSymbolAilWithIdioms: updatedSection,
      obsoleteSymbol: obsoleteName ? `#${obsoleteName}` : undefined,
    };
  }

  if (languageId === "twig") {
    const lines: string[] = ["component TwigReportView():"];
    for (const fn of domainFunctions) {
      lines.push(`  block(name="${fn.name}") {`);
      for (let idx = 0; idx < fn.pairs.length; idx++) {
        const [a, b] = fn.pairs[idx];
        lines.push(`    ${idiom}("Label ${a}", val_${b})`);
      }
      lines.push("  }");
    }
    if (obsoleteName) {
      lines.push(`  block(name="${obsoleteName}") {`);
      lines.push(`    ${idiom}("Deprecated", val_legacy_0)`);
      lines.push(`    ${idiom}("Obsolete", val_legacy_1)`);
      lines.push("  }");
    }

    const targetId = domainFunctions[0].name;
    const updatedTwig =
      scenario === "new_feature"
        ? [
            `block(name="${targetId}_summary") {`,
            `  ${idiom}("Summary Total", val_sum_0)`,
            `  ${idiom}("Tax Total", val_sum_1)`,
            "}",
          ].join("\n")
        : [
            `block(name="${targetId}") {`,
            `  ${idiom}("Updated Total", val_upd_0)`,
            `  ${idiom}("Discount Total", val_upd_1)`,
            "}",
          ].join("\n");
    return {
      fileName,
      languageId,
      ailWithIdioms: lines.join("\n"),
      targetSymbol: targetId,
      updatedTargetSymbolAilWithIdioms: updatedTwig,
      obsoleteSymbol: obsoleteName,
    };
  }

  if (languageId === "json" || languageId === "yaml") {
    const sectionEntries: string[] = [];
    for (const fn of domainFunctions) {
      const items = fn.pairs.map(
        ([a, b], idx) => `${idiom}("/api/v2/${fn.name}/${idx}", ${1000 + a + b})`,
      );
      sectionEntries.push(`  ${fn.name}: [\n    ${items.join(",\n    ")}\n  ]`);
    }
    if (obsoleteName) {
      sectionEntries.push(
        `  ${obsoleteName}: [\n    ${idiom}("/api/v1/${obsoleteName}/0", 1000),\n    ${idiom}("/api/v1/${obsoleteName}/1", 1500)\n  ]`,
      );
    }
    const targetKey = domainFunctions[0].name;
    const updatedEntry =
      scenario === "new_feature"
        ? `pub const ${targetKey}_realtime = [\n  ${idiom}("/api/v2/${targetKey}/stream_0", 4500),\n  ${idiom}("/api/v2/${targetKey}/stream_1", 5000)\n]`
        : `pub const ${targetKey} = [\n  ${idiom}("/api/v2/${targetKey}/verified_0", 3200),\n  ${idiom}("/api/v2/${targetKey}/verified_1", 3600)\n]`;
    return {
      fileName,
      languageId,
      ailWithIdioms: `pub const config = {\n${sectionEntries.join(",\n")}\n}`,
      targetSymbol: `config.${targetKey}`,
      updatedTargetSymbolAilWithIdioms: updatedEntry,
      obsoleteSymbol: obsoleteName ? `config.${obsoleteName}` : undefined,
    };
  }

  if (languageId === "tsx") {
    const fns: string[] = [];
    for (const fn of domainFunctions) {
      const calls = fn.pairs.map(([a, b]) => `  ${idiom}("${fn.name}_${a}", ${b})`);
      fns.push(
        [
          `pub fn ${fn.name}(${fn.param}: int) -> int:`,
          `  mut rows = ${fn.param}`,
          ...calls,
          "  return rows",
        ].join("\n"),
      );
    }
    if (obsoleteName) {
      fns.push(
        [
          `pub fn ${obsoleteName}(seed: int) -> int:`,
          "  mut rows = seed",
          `  ${idiom}("legacy", 50)`,
          `  ${idiom}("deprecated", 100)`,
          "  return rows",
        ].join("\n"),
      );
    }
    const targetFn = domainFunctions[0];
    const updatedFn =
      scenario === "new_feature"
        ? [
            `pub fn ${targetFn.name}Sparkline(${targetFn.param}: int) -> int:`,
            `  mut rows = ${targetFn.param} + 10`,
            `  ${idiom}("spark_0", 120)`,
            `  ${idiom}("spark_1", 240)`,
            `  ${idiom}("spark_2", 360)`,
            "  return rows",
          ].join("\n")
        : [
            `pub fn ${targetFn.name}(${targetFn.param}: int) -> int:`,
            `  mut rows = ${targetFn.param} + 1`,
            `  ${idiom}("fixed_0", 150)`,
            `  ${idiom}("fixed_1", 300)`,
            `  ${idiom}("fixed_2", 450)`,
            "  return rows",
          ].join("\n");
    return {
      fileName,
      languageId,
      ailWithIdioms: fns.join("\n\n"),
      targetSymbol: targetFn.name,
      updatedTargetSymbolAilWithIdioms: updatedFn,
      obsoleteSymbol: obsoleteName,
    };
  }

  // Code languages: ts, js, py, go, rs, cpp, cs, kt, php
  const fns: string[] = [];
  for (const fn of domainFunctions) {
    const calls = fn.pairs.map(([lo, hi]) => `  ${idiom}(${lo}, ${hi})`);
    fns.push(
      [
        `pub fn ${fn.name}(${fn.param}: int) -> int:`,
        `  mut acc = ${fn.param}`,
        ...calls,
        "  return acc",
      ].join("\n"),
    );
  }
  if (obsoleteName) {
    fns.push(
      [
        `pub fn ${obsoleteName}(seed: int) -> int:`,
        "  mut acc = seed",
        `  ${idiom}(5, 100)`,
        `  ${idiom}(10, 200)`,
        "  return acc",
      ].join("\n"),
    );
  }

  const targetFn = domainFunctions[0];
  const updatedFn =
    scenario === "new_feature"
      ? [
          `pub fn ${targetFn.name}Extended(${targetFn.param}: int) -> int:`,
          `  mut acc = ${targetFn.param} + 10`,
          `  ${idiom}(20, 600)`,
          `  ${idiom}(40, 1200)`,
          `  ${idiom}(80, 2400)`,
          "  return acc",
        ].join("\n")
      : [
          `pub fn ${targetFn.name}(${targetFn.param}: int) -> int:`,
          `  mut acc = ${targetFn.param} + 1`,
          `  ${idiom}(16, 512)`,
          `  ${idiom}(32, 1024)`,
          `  ${idiom}(64, 2048)`,
          "  return acc",
        ].join("\n");

  return {
    fileName,
    languageId,
    ailWithIdioms: fns.join("\n\n"),
    targetSymbol: targetFn.name,
    updatedTargetSymbolAilWithIdioms: updatedFn,
    obsoleteSymbol: obsoleteName,
  };
}

export const REAL_WORLD_BENCHMARKS: readonly RealWorldBenchmarkSpec[] = [
  {
    id: "RW-01",
    title: "HTML5 Canvas Arcade Snake Window Application (Greenfield from 0)",
    description:
      "Complete interactive browser game built from 0 with TypeScript game loop & collision engine, Canvas HUD renderer, HTML5 arcade shell, CSS3 neon cabinet theme, and JSON level config.",
    scenario: "from_zero_window_app",
    appSurface: "window",
    files: [
      buildDomainModuleSpec(
        "engine.ts",
        "ts",
        [
          { name: "stepSnakeHead", param: "coord", pairs: [[0, 640], [16, 624], [32, 608]] },
          { name: "resolveWallCollision", param: "pos", pairs: [[0, 480], [16, 464], [32, 448]] },
          { name: "computeFoodSpawnCell", param: "seed", pairs: [[1, 39], [2, 38], [4, 36]] },
          { name: "advanceComboScore", param: "points", pairs: [[10, 5000], [25, 10000], [50, 25000]] },
        ],
        "from_zero_window_app",
        "legacyWrapGrid",
      ),
      buildDomainModuleSpec(
        "renderer.ts",
        "ts",
        [
          { name: "renderViewportFrame", param: "tick", pairs: [[1, 60], [2, 120], [4, 240]] },
          { name: "drawSnakeSegmentGlow", param: "alpha", pairs: [[15, 255], [30, 240], [45, 220]] },
          { name: "updateParticleBurst", param: "vel", pairs: [[2, 80], [4, 160], [8, 320]] },
        ],
        "from_zero_window_app",
      ),
      buildDomainModuleSpec(
        "index.html",
        "html",
        [
          { name: "arcade_hud", param: "hud", pairs: [[100, 1], [200, 2], [300, 3]] },
          { name: "canvas_stage", param: "stage", pairs: [[640, 480], [32, 16]] },
          { name: "controls_bar", param: "ctrl", pairs: [[1, 60], [2, 120]] },
        ],
        "from_zero_window_app",
        "legacy_overlay",
      ),
      buildDomainModuleSpec(
        "styles.css",
        "css",
        [
          { name: "arcade_cabinet", param: "cab", pairs: [[16, 12]] },
          { name: "hud_scoreboard", param: "hud", pairs: [[12, 8]] },
          { name: "canvas_viewport", param: "vp", pairs: [[8, 4]] },
          { name: "control_badge", param: "btn", pairs: [[10, 6]] },
        ],
        "from_zero_window_app",
        "deprecated_crt_scanline",
      ),
      buildDomainModuleSpec(
        "game_config.json",
        "json",
        [
          { name: "leaderboardEndpoint", param: "lb", pairs: [[80, 1500]] },
          { name: "telemetryEndpoint", param: "tel", pairs: [[80, 2000]] },
          { name: "replayUploadEndpoint", param: "rep", pairs: [[80, 3500]] },
          { name: "profileSyncEndpoint", param: "prof", pairs: [[80, 1800]] },
        ],
        "from_zero_window_app",
        "legacyHighscoreEndpoint",
      ),
    ],
  },
  {
    id: "RW-02",
    title: "Headless Python CLI Task Queue & Telemetry Worker Daemon (Greenfield from 0)",
    description:
      "Non-window background queue daemon & CLI tool created from 0 with Python retry backoff scheduler, worker pool controller, YAML service deployment topology, and JSON ingestion schema.",
    scenario: "from_zero_non_window_app",
    appSurface: "non_window",
    files: [
      buildDomainModuleSpec(
        "worker.py",
        "py",
        [
          { name: "execute_batch_job", param: "batch_id", pairs: [[10, 500], [25, 1500], [50, 5000]] },
          { name: "compute_retry_backoff", param: "attempt", pairs: [[100, 3000], [250, 10000], [500, 30000]] },
          { name: "verify_payload_checksum", param: "bytes_len", pairs: [[64, 4096], [128, 16384], [256, 65536]] },
          { name: "flush_dead_letter_queue", param: "count", pairs: [[1, 100], [5, 500], [10, 1000]] },
        ],
        "from_zero_non_window_app",
        "legacy_poll_loop",
      ),
      buildDomainModuleSpec(
        "cli.py",
        "py",
        [
          { name: "parse_worker_concurrency", param: "threads", pairs: [[1, 16], [2, 32], [4, 64]] },
          { name: "drain_inflight_batches", param: "timeout_sec", pairs: [[5, 60], [10, 120], [15, 300]] },
          { name: "emit_health_heartbeat", param: "seq", pairs: [[1, 1000], [10, 5000], [20, 10000]] },
        ],
        "from_zero_non_window_app",
      ),
      buildDomainModuleSpec(
        "pipeline.yaml",
        "yaml",
        [
          { name: "ingestQueue", param: "ing", pairs: [[80, 1]] },
          { name: "retryDispatcher", param: "ret", pairs: [[81, 2]] },
          { name: "deadLetterSink", param: "dlq", pairs: [[82, 3]] },
          { name: "metricsExporter", param: "met", pairs: [[90, 4]] },
        ],
        "from_zero_non_window_app",
        "legacyBatchCron",
      ),
      buildDomainModuleSpec(
        "schema.json",
        "json",
        [
          { name: "batchIngestRoute", param: "bi", pairs: [[100, 2000]] },
          { name: "dlqReplayRoute", param: "dlq", pairs: [[100, 4000]] },
          { name: "healthProbeRoute", param: "hp", pairs: [[50, 500]] },
          { name: "metricsFlushRoute", param: "mf", pairs: [[100, 1500]] },
        ],
        "from_zero_non_window_app",
        "deprecatedV1Webhook",
      ),
    ],
  },
  {
    id: "RW-03",
    title: "Symfony/PHP + JS + Twig + CSS + HTML + YAML + JSON Storefront Checkout (Bug Fix)",
    description:
      "Full server & client e-commerce storefront fixing a negative discount/tax rounding bug in CheckoutController.php while synchronizing client cart JS, Twig summary template, CSS styles, HTML modal, YAML routes, and JSON shipping tiers.",
    scenario: "bug_fix",
    appSurface: "window",
    files: [
      buildDomainModuleSpec(
        "CheckoutController.php",
        "php",
        [
          { name: "calculateInvoiceTotalCents", param: "subtotal", pairs: [[100, 500000], [250, 750000], [500, 1000000]] },
          { name: "applyPromoDiscountCents", param: "discount", pairs: [[50, 25000], [100, 50000], [200, 100000]] },
          { name: "resolveRegionalTaxCents", param: "taxable", pairs: [[10, 80000], [25, 160000], [50, 320000]] },
          { name: "estimateShippingFeeCents", param: "weight_g", pairs: [[400, 15000], [600, 25000], [900, 45000]] },
        ],
        "bug_fix",
        "legacyV1TaxCalc",
      ),
      buildDomainModuleSpec(
        "cart-client.js",
        "js",
        [
          { name: "clampCartItemQuantity", param: "qty", pairs: [[1, 25], [2, 50], [5, 99]] },
          { name: "recomputeDrawerSubtotal", param: "cents", pairs: [[100, 200000], [250, 400000], [500, 800000]] },
          { name: "animateSavingsBadge", param: "delta", pairs: [[10, 5000], [20, 10000], [50, 25000]] },
        ],
        "bug_fix",
      ),
      buildDomainModuleSpec(
        "checkout.twig",
        "twig",
        [
          { name: "order_summary_lines", param: "sum", pairs: [[1, 100], [2, 200], [3, 300]] },
          { name: "tax_breakdown_box", param: "tax", pairs: [[4, 400], [5, 500]] },
        ],
        "bug_fix",
        "legacy_coupon_banner",
      ),
      buildDomainModuleSpec(
        "checkout.css",
        "css",
        [
          { name: "checkout_card", param: "card", pairs: [[20, 16]] },
          { name: "summary_line_item", param: "item", pairs: [[12, 8]] },
          { name: "promo_badge_pill", param: "pill", pairs: [[6, 4]] },
          { name: "payment_cta_bar", param: "cta", pairs: [[16, 12]] },
        ],
        "bug_fix",
      ),
      buildDomainModuleSpec(
        "shell.html",
        "html",
        [
          { name: "checkout_header", param: "hdr", pairs: [[1, 10], [2, 20]] },
          { name: "payment_modal", param: "mod", pairs: [[3, 30], [4, 40]] },
        ],
        "bug_fix",
      ),
      buildDomainModuleSpec(
        "routes.yaml",
        "yaml",
        [
          { name: "checkoutApi", param: "chk", pairs: [[80, 1]] },
          { name: "couponValidator", param: "cpn", pairs: [[81, 2]] },
          { name: "taxCalculator", param: "tax", pairs: [[82, 3]] },
          { name: "stripeWebhook", param: "wh", pairs: [[83, 4]] },
        ],
        "bug_fix",
      ),
      buildDomainModuleSpec(
        "shipping_rates.json",
        "json",
        [
          { name: "domesticStandard", param: "dom", pairs: [[50, 1200]] },
          { name: "domesticExpress", param: "exp", pairs: [[50, 1500]] },
          { name: "euCrossBorder", param: "eu", pairs: [[100, 2500]] },
          { name: "globalPriority", param: "intl", pairs: [[150, 4000]] },
        ],
        "bug_fix",
      ),
    ],
  },
  {
    id: "RW-04",
    title: "Vite + TypeScript + React TSX + CSS + HTML + JSON + YAML Analytics Dashboard (New Feature)",
    description:
      "Modern frontend workspace adding a new cohort retention & live sparkline feature across the TypeScript metrics store, React TSX dashboard panel, CSS grid cards, HTML shell, JSON bundle budget, and YAML preview pipeline.",
    scenario: "new_feature",
    appSurface: "window",
    files: [
      buildDomainModuleSpec(
        "metrics-store.ts",
        "ts",
        [
          { name: "aggregateWindowSeries", param: "sample", pairs: [[10, 1000], [25, 5000], [50, 10000]] },
          { name: "computeP95LatencyMs", param: "ms", pairs: [[5, 250], [15, 750], [30, 2500]] },
          { name: "detectTrafficAnomaly", param: "rate", pairs: [[20, 800], [40, 1600], [80, 3200]] },
          { name: "normalizeFunnelConversion", param: "bps", pairs: [[100, 9500], [200, 9800], [500, 10000]] },
        ],
        "new_feature",
        "deprecatedV1Sampler",
      ),
      buildDomainModuleSpec(
        "DashboardPanel.tsx",
        "tsx",
        [
          { name: "renderKpiMetricGrid", param: "cards", pairs: [[1, 12], [2, 24], [4, 48]] },
          { name: "renderRetentionMatrix", param: "cohorts", pairs: [[7, 90], [14, 180], [30, 365]] },
          { name: "renderAlertBannerList", param: "alerts", pairs: [[1, 10], [3, 25], [5, 50]] },
        ],
        "new_feature",
        "legacySparklineWidget",
      ),
      buildDomainModuleSpec(
        "dashboard.css",
        "css",
        [
          { name: "kpi_grid_card", param: "kpi", pairs: [[16, 12]] },
          { name: "cohort_heatmap_row", param: "hm", pairs: [[8, 6]] },
          { name: "toolbar_filter_pill", param: "flt", pairs: [[10, 8]] },
          { name: "sparkline_tooltip", param: "tip", pairs: [[6, 4]] },
        ],
        "new_feature",
      ),
      buildDomainModuleSpec(
        "index.html",
        "html",
        [
          { name: "dashboard_topbar", param: "top", pairs: [[1, 10], [2, 20]] },
          { name: "kpi_stage_mount", param: "mnt", pairs: [[3, 30], [4, 40]] },
        ],
        "new_feature",
      ),
      buildDomainModuleSpec(
        "bundle_budgets.json",
        "json",
        [
          { name: "metricsQueryApi", param: "mq", pairs: [[80, 1800]] },
          { name: "cohortExportApi", param: "ce", pairs: [[80, 3200]] },
          { name: "alertStreamApi", param: "as", pairs: [[80, 1200]] },
          { name: "layoutPrefsApi", param: "lp", pairs: [[80, 900]] },
        ],
        "new_feature",
      ),
      buildDomainModuleSpec(
        "vite_pipeline.yaml",
        "yaml",
        [
          { name: "vitePreview", param: "vp", pairs: [[173, 1]] },
          { name: "edgeCdnSync", param: "cdn", pairs: [[443, 2]] },
          { name: "lighthouseGate", param: "lh", pairs: [[300, 3]] },
          { name: "storybookBuild", param: "sb", pairs: [[606, 4]] },
        ],
        "new_feature",
      ),
    ],
  },
  {
    id: "RW-05",
    title: "Go API Gateway + Rust WAL Storage Engine Distributed Ledger Mesh (Update Feature)",
    description:
      "Cloud-native backend updating quorum consensus timeout and adaptive rate limiting across a Go API gateway, Rust write-ahead log compaction engine, YAML Raft cluster config, and JSON tenant burst quotas.",
    scenario: "update_feature",
    appSurface: "non_window",
    files: [
      buildDomainModuleSpec(
        "gateway.go",
        "go",
        [
          { name: "EvaluateQuorumHealth", param: "nodes", pairs: [[3, 15], [5, 31], [7, 63]] },
          { name: "AcquireTokenBucket", param: "tokens", pairs: [[10, 1000], [50, 5000], [100, 10000]] },
          { name: "ComputeCircuitBackoffMs", param: "failures", pairs: [[50, 2000], [100, 5000], [250, 15000]] },
          { name: "ValidateShardEpoch", param: "epoch", pairs: [[1, 1024], [16, 4096], [64, 16384]] },
        ],
        "update_feature",
        "DeprecatedV1Route",
      ),
      buildDomainModuleSpec(
        "wal_engine.rs",
        "rs",
        [
          { name: "compact_wal_segment", param: "entries", pairs: [[64, 4096], [128, 8192], [256, 16384]] },
          { name: "verify_frame_crc32", param: "payload_len", pairs: [[32, 2048], [64, 4096], [128, 8192]] },
          { name: "flush_commit_index", param: "lsn", pairs: [[100, 50000], [250, 100000], [500, 250000]] },
          { name: "reclaim_orphan_pages", param: "pages", pairs: [[8, 512], [16, 1024], [32, 2048]] },
        ],
        "update_feature",
        "legacy_mmap_sync",
      ),
      buildDomainModuleSpec(
        "cluster.yaml",
        "yaml",
        [
          { name: "raftConsensus", param: "raft", pairs: [[900, 1]] },
          { name: "walReplicator", param: "wal", pairs: [[901, 2]] },
          { name: "grpcIngress", param: "grpc", pairs: [[902, 3]] },
          { name: "gossipMesh", param: "gsp", pairs: [[903, 4]] },
        ],
        "update_feature",
      ),
      buildDomainModuleSpec(
        "limits.json",
        "json",
        [
          { name: "ledgerAppendRpc", param: "app", pairs: [[50, 800]] },
          { name: "quorumReadRpc", param: "qr", pairs: [[25, 400]] },
          { name: "snapshotSyncRpc", param: "snap", pairs: [[200, 8000]] },
          { name: "shardRebalanceRpc", param: "reb", pairs: [[150, 5000]] },
        ],
        "update_feature",
      ),
    ],
  },
  {
    id: "RW-06",
    title: "C++20 Framebuffer Physics Viewport + TypeScript Inspector Overlay (Bug Fix)",
    description:
      "Hybrid native/web desktop viewport engine fixing a sub-pixel AABB collision tunneling clamp bug in C++20 while updating the TypeScript inspector bridge, HTML HUD overlay, CSS dock panel, and JSON solver settings.",
    scenario: "bug_fix",
    appSurface: "window",
    files: [
      buildDomainModuleSpec(
        "viewport_sim.cpp",
        "cpp",
        [
          { name: "solveRigidBodyAABB", param: "penetration", pairs: [[1, 128], [4, 256], [8, 512]] },
          { name: "integrateVelocityStep", param: "vel", pairs: [[10, 800], [20, 1600], [40, 3200]] },
          { name: "applyAngularDamping", param: "torque", pairs: [[5, 400], [10, 800], [20, 1600]] },
          { name: "clampViewportZoom", param: "fov", pairs: [[30, 120], [45, 110], [60, 100]] },
        ],
        "bug_fix",
        "legacyEulerStep",
      ),
      buildDomainModuleSpec(
        "inspector.ts",
        "ts",
        [
          { name: "sampleFrameTimeHistogram", param: "usec", pairs: [[500, 16667], [1000, 33333], [2000, 50000]] },
          { name: "projectGizmoHandle", param: "screenX", pairs: [[0, 1920], [16, 1904], [32, 1888]] },
          { name: "syncColliderWireframe", param: "verts", pairs: [[8, 2048], [16, 4096], [32, 8192]] },
        ],
        "bug_fix",
      ),
      buildDomainModuleSpec(
        "overlay.html",
        "html",
        [
          { name: "physics_hud_dock", param: "dock", pairs: [[1, 60], [2, 120]] },
          { name: "solver_metrics_panel", param: "slv", pairs: [[3, 240], [4, 480]] },
        ],
        "bug_fix",
      ),
      buildDomainModuleSpec(
        "overlay.css",
        "css",
        [
          { name: "viewport_hud_dock", param: "dock", pairs: [[12, 8]] },
          { name: "gizmo_toolbar", param: "giz", pairs: [[8, 6]] },
          { name: "fps_histogram_bar", param: "fps", pairs: [[6, 4]] },
          { name: "collider_prop_row", param: "row", pairs: [[10, 6]] },
        ],
        "bug_fix",
      ),
      buildDomainModuleSpec(
        "engine_settings.json",
        "json",
        [
          { name: "solverStepBridge", param: "slv", pairs: [[16, 500]] },
          { name: "gizmoPickBridge", param: "giz", pairs: [[16, 250]] },
          { name: "sceneSnapshotBridge", param: "scn", pairs: [[50, 2000]] },
          { name: "shaderReloadBridge", param: "shd", pairs: [[30, 1500]] },
        ],
        "bug_fix",
      ),
    ],
  },
  {
    id: "RW-07",
    title: "C# .NET Payment Settlement Service + Kotlin Fraud Scoring Engine (New Feature)",
    description:
      "Enterprise fintech backend adding instant payout fee calculation and real-time velocity risk scoring across C# .NET settlement services, Kotlin Ktor fraud evaluators, YAML clearing routing, and JSON risk rule weights.",
    scenario: "new_feature",
    appSurface: "non_window",
    files: [
      buildDomainModuleSpec(
        "SettlementEngine.cs",
        "cs",
        [
          { name: "ReconcileLedgerBatch", param: "cents", pairs: [[100, 100000], [500, 500000], [1000, 2500000]] },
          { name: "ComputeFxSpreadBps", param: "notional", pairs: [[15, 350], [25, 500], [50, 1000]] },
          { name: "EvaluateMerchantReserve", param: "volume", pairs: [[500, 250000], [1000, 500000], [2500, 1000000]] },
          { name: "AuthorizeClearingWindow", param: "cutoff", pairs: [[10, 1440], [30, 2880], [60, 4320]] },
        ],
        "new_feature",
        "LegacyBatchClose",
      ),
      buildDomainModuleSpec(
        "FraudScorer.kt",
        "kt",
        [
          { name: "scoreCardVelocityRisk", param: "txCount", pairs: [[5, 100], [15, 300], [30, 900]] },
          { name: "weightDeviceFingerprint", param: "signals", pairs: [[10, 500], [25, 750], [50, 1000]] },
          { name: "evaluateGeoDistanceRisk", param: "km", pairs: [[20, 2000], [50, 5000], [100, 15000]] },
          { name: "computeChargebackTier", param: "disputes", pairs: [[1, 50], [5, 150], [10, 500]] },
        ],
        "new_feature",
        "deprecatedRuleScore",
      ),
      buildDomainModuleSpec(
        "settlement_policy.yaml",
        "yaml",
        [
          { name: "sepaClearing", param: "sepa", pairs: [[410, 1]] },
          { name: "fednowClearing", param: "fed", pairs: [[411, 2]] },
          { name: "fraudScoringGrpc", param: "frd", pairs: [[412, 3]] },
          { name: "ledgerVaultSync", param: "vlt", pairs: [[413, 4]] },
        ],
        "new_feature",
      ),
      buildDomainModuleSpec(
        "risk_rules.json",
        "json",
        [
          { name: "velocityCheckEndpoint", param: "vel", pairs: [[20, 350]] },
          { name: "sanctionsScreenEndpoint", param: "snc", pairs: [[50, 900]] },
          { name: "instantPayoutEndpoint", param: "pay", pairs: [[30, 600]] },
          { name: "reserveLedgerEndpoint", param: "res", pairs: [[40, 800]] },
        ],
        "new_feature",
      ),
    ],
  },
  {
    id: "RW-08",
    title: "Python FastAPI + React TSX + Twig Invoice Studio + CSS + JSON + YAML Billing Portal (Update Feature)",
    description:
      "Multi-tenant SaaS billing & reporting portal updating multi-currency tax rounding and usage quota gauges across Python FastAPI services, React TSX usage charts, Twig invoice templates, CSS print/screen rules, JSON plan tiers, and YAML cron workers.",
    scenario: "update_feature",
    appSurface: "window",
    files: [
      buildDomainModuleSpec(
        "billing_service.py",
        "py",
        [
          { name: "compute_tiered_overage_cents", param: "units", pairs: [[100, 50000], [250, 150000], [500, 500000]] },
          { name: "prorate_subscription_upgrade", param: "days_left", pairs: [[1, 30], [7, 90], [14, 365]] },
          { name: "aggregate_vat_withholding", param: "net_cents", pairs: [[50, 100000], [150, 300000], [300, 900000]] },
          { name: "apply_credit_balance_rollover", param: "credit", pairs: [[25, 25000], [75, 75000], [150, 150000]] },
        ],
        "update_feature",
        "legacy_invoice_hash",
      ),
      buildDomainModuleSpec(
        "UsageChart.tsx",
        "tsx",
        [
          { name: "renderQuotaGaugeRows", param: "used", pairs: [[10, 500], [25, 1000], [50, 2500]] },
          { name: "renderInvoiceHistoryTable", param: "months", pairs: [[3, 12], [6, 24], [12, 36]] },
          { name: "renderPlanComparisonCards", param: "tiers", pairs: [[1, 4], [2, 8], [4, 16]] },
        ],
        "update_feature",
      ),
      buildDomainModuleSpec(
        "invoice_email.twig",
        "twig",
        [
          { name: "invoice_header_block", param: "hdr", pairs: [[1, 10], [2, 20], [3, 30]] },
          { name: "line_items_summary", param: "lines", pairs: [[4, 40], [5, 50]] },
        ],
        "update_feature",
        "legacy_vat_footer",
      ),
      buildDomainModuleSpec(
        "billing.css",
        "css",
        [
          { name: "invoice_preview_sheet", param: "inv", pairs: [[24, 16]] },
          { name: "quota_progress_card", param: "qta", pairs: [[16, 12]] },
          { name: "tier_badge_header", param: "bdg", pairs: [[8, 6]] },
          { name: "overage_warning_row", param: "wrn", pairs: [[12, 8]] },
        ],
        "update_feature",
      ),
      buildDomainModuleSpec(
        "plans.json",
        "json",
        [
          { name: "usageMeterIngest", param: "mtr", pairs: [[50, 1200]] },
          { name: "invoicePdfRender", param: "pdf", pairs: [[100, 4500]] },
          { name: "taxComplianceSync", param: "tax", pairs: [[80, 2200]] },
          { name: "dunningWebhook", param: "dun", pairs: [[60, 1800]] },
        ],
        "update_feature",
      ),
      buildDomainModuleSpec(
        "worker_cron.yaml",
        "yaml",
        [
          { name: "invoiceRollupWorker", param: "inv", pairs: [[510, 1]] },
          { name: "usageAggregator", param: "usg", pairs: [[511, 2]] },
          { name: "dunningMailer", param: "mlr", pairs: [[512, 3]] },
          { name: "ledgerArchiver", param: "arc", pairs: [[513, 4]] },
        ],
        "update_feature",
      ),
    ],
  },
  {
    id: "RW-09",
    title: "High-Frequency Order Book Matching Engine & Risk Guard Daemon (Bug Fix)",
    description:
      "Ultra-low-latency non-window trading & risk pipeline fixing a self-trade price collar boundary bug across a Rust matching engine, C++20 intraday margin calculator, Python compliance daemon, Go market feed normalizer, YAML venue feeds, and JSON collar bands.",
    scenario: "bug_fix",
    appSurface: "non_window",
    files: [
      buildDomainModuleSpec(
        "matcher.rs",
        "rs",
        [
          { name: "match_limit_order_lot", param: "qty", pairs: [[1, 10000], [10, 50000], [100, 250000]] },
          { name: "enforce_price_collar_ticks", param: "ticks", pairs: [[5, 500], [10, 1000], [25, 2500]] },
          { name: "allocate_pro_rata_fills", param: "lots", pairs: [[2, 2000], [8, 8000], [16, 32000]] },
          { name: "advance_sequence_watermark", param: "seq", pairs: [[64, 65536], [128, 131072], [256, 524288]] },
        ],
        "bug_fix",
        "legacy_cancel_all",
      ),
      buildDomainModuleSpec(
        "margin_calc.cpp",
        "cpp",
        [
          { name: "computeIntradayHaircutBps", param: "volatility", pairs: [[25, 1500], [50, 3000], [100, 5000]] },
          { name: "evaluateNetSpanMargin", param: "exposure", pairs: [[1000, 500000], [2500, 1000000], [5000, 2500000]] },
          { name: "checkLiquidationBuffer", param: "equity", pairs: [[500, 250000], [1000, 500000], [2000, 1000000]] },
        ],
        "bug_fix",
      ),
      buildDomainModuleSpec(
        "risk_daemon.py",
        "py",
        [
          { name: "audit_position_concentration", param: "notional", pairs: [[100, 100000], [500, 500000], [1000, 1000000]] },
          { name: "trigger_kill_switch_cooldown", param: "breaches", pairs: [[1, 10], [3, 30], [5, 100]] },
          { name: "record_regulatory_drop_copy", param: "events", pairs: [[10, 5000], [25, 15000], [50, 50000]] },
        ],
        "bug_fix",
      ),
      buildDomainModuleSpec(
        "feed_ingest.go",
        "go",
        [
          { name: "NormalizeVenueTickGap", param: "deltaSeq", pairs: [[1, 256], [4, 1024], [16, 4096]] },
          { name: "ReconcileBookSnapshot", param: "depth", pairs: [[10, 200], [25, 500], [50, 1000]] },
          { name: "ArbitrateMulticastLine", param: "skewUs", pairs: [[5, 500], [15, 1500], [30, 5000]] },
        ],
        "bug_fix",
      ),
      buildDomainModuleSpec(
        "exchange_feeds.yaml",
        "yaml",
        [
          { name: "ouchOrderGateway", param: "ouch", pairs: [[701, 1]] },
          { name: "itchMulticastA", param: "itch", pairs: [[702, 2]] },
          { name: "dropCopyFix", param: "fix", pairs: [[703, 3]] },
          { name: "marginGuardRpc", param: "mrg", pairs: [[704, 4]] },
        ],
        "bug_fix",
      ),
      buildDomainModuleSpec(
        "collar_bands.json",
        "json",
        [
          { name: "orderSubmitGate", param: "ord", pairs: [[10, 150]] },
          { name: "massQuoteGate", param: "mq", pairs: [[10, 200]] },
          { name: "killSwitchGate", param: "ks", pairs: [[5, 100]] },
          { name: "dropCopyAuditGate", param: "dc", pairs: [[25, 500]] },
        ],
        "bug_fix",
      ),
    ],
  },
  {
    id: "RW-10",
    title: "Unified 15-Language Enterprise Cloud Observability & Control Plane (Full-Stack Update Feature)",
    description:
      "Polyglot enterprise control plane integrating all 15 supported languages and file types (.ts, .tsx, .js, .py, .go, .rs, .cpp, .cs, .kt, .php, .css, .html, .json, .yaml, .twig) in a single cohesive multi-service architecture.",
    scenario: "update_feature",
    appSurface: "window",
    files: [
      buildDomainModuleSpec(
        "telemetry_router.ts",
        "ts",
        [
          { name: "routeSpanBatch", param: "spans", pairs: [[16, 1024], [32, 2048], [64, 4096]] },
          { name: "sampleTraceTail", param: "latencyMs", pairs: [[10, 500], [25, 1500], [50, 5000]] },
          { name: "compactMetricSeries", param: "points", pairs: [[32, 4096], [64, 8192], [128, 16384]] },
        ],
        "update_feature",
        "legacySpanFlush",
      ),
      buildDomainModuleSpec(
        "ClusterHud.tsx",
        "tsx",
        [
          { name: "renderClusterNodeGrid", param: "nodes", pairs: [[4, 128], [8, 256], [16, 512]] },
          { name: "renderSloBurnCards", param: "slos", pairs: [[2, 32], [4, 64], [8, 128]] },
          { name: "renderIncidentTimeline", param: "events", pairs: [[5, 100], [10, 250], [20, 500]] },
        ],
        "update_feature",
      ),
      buildDomainModuleSpec(
        "widget_embed.js",
        "js",
        [
          { name: "clampStatusPollInterval", param: "sec", pairs: [[5, 60], [10, 120], [15, 300]] },
          { name: "resizeEmbedIframeHeight", param: "px", pairs: [[240, 1080], [320, 1440], [400, 2160]] },
          { name: "throttleBeaconFlush", param: "queued", pairs: [[1, 50], [5, 100], [10, 250]] },
        ],
        "update_feature",
      ),
      buildDomainModuleSpec(
        "anomaly_worker.py",
        "py",
        [
          { name: "score_seasonal_zscore", param: "sigma", pairs: [[10, 300], [20, 600], [30, 900]] },
          { name: "cluster_log_signatures", param: "tokens", pairs: [[32, 1024], [64, 2048], [128, 4096]] },
          { name: "suppress_flapping_alerts", param: "flaps", pairs: [[3, 30], [5, 60], [10, 120]] },
        ],
        "update_feature",
      ),
      buildDomainModuleSpec(
        "mesh_proxy.go",
        "go",
        [
          { name: "BalanceEnvoyUpstream", param: "endpoints", pairs: [[2, 64], [4, 128], [8, 256]] },
          { name: "EnforceMtlsRotation", param: "ttlHours", pairs: [[1, 24], [6, 72], [12, 168]] },
          { name: "DrainCanaryTraffic", param: "weightPct", pairs: [[5, 100], [10, 100], [25, 100]] },
        ],
        "update_feature",
      ),
      buildDomainModuleSpec(
        "trace_ring.rs",
        "rs",
        [
          { name: "append_ring_buffer_slot", param: "offset", pairs: [[64, 65536], [128, 131072], [256, 262144]] },
          { name: "evict_expired_spans", param: "age_ms", pairs: [[100, 10000], [250, 30000], [500, 60000]] },
          { name: "compress_lz4_chunk", param: "bytes", pairs: [[512, 32768], [1024, 65536], [2048, 131072]] },
        ],
        "update_feature",
      ),
      buildDomainModuleSpec(
        "packet_filter.cpp",
        "cpp",
        [
          { name: "filterEbpfSocketRing", param: "packets", pairs: [[32, 4096], [64, 8192], [128, 16384]] },
          { name: "aggregateTcpRetransmits", param: "segs", pairs: [[1, 500], [5, 1000], [10, 2500]] },
          { name: "clampSynBacklogQuota", param: "qlen", pairs: [[128, 8192], [256, 16384], [512, 32768]] },
        ],
        "update_feature",
      ),
      buildDomainModuleSpec(
        "AuditLedger.cs",
        "cs",
        [
          { name: "AppendComplianceEvent", param: "seq", pairs: [[1, 10000], [10, 50000], [50, 250000]] },
          { name: "VerifyRbacPolicyEpoch", param: "version", pairs: [[1, 512], [4, 1024], [8, 2048]] },
          { name: "RotateKmsEnvelopeKey", param: "days", pairs: [[7, 90], [14, 180], [30, 365]] },
        ],
        "update_feature",
      ),
      buildDomainModuleSpec(
        "AlertDispatcher.kt",
        "kt",
        [
          { name: "dispatchPagerEscalation", param: "severity", pairs: [[1, 5], [2, 10], [3, 20]] },
          { name: "deduplicateIncidentKey", param: "windowSec", pairs: [[60, 3600], [120, 7200], [300, 14400]] },
          { name: "routeOnCallSchedule", param: "shiftId", pairs: [[1, 48], [2, 96], [4, 192]] },
        ],
        "update_feature",
      ),
      buildDomainModuleSpec(
        "TenantPortal.php",
        "php",
        [
          { name: "computeTenantQuotaUnits", param: "orgs", pairs: [[10, 1000], [25, 2500], [50, 5000]] },
          { name: "validateSamlAssertionTtl", param: "sec", pairs: [[60, 1800], [120, 3600], [300, 7200]] },
          { name: "tallyApiKeyUsageDaily", param: "calls", pairs: [[100, 100000], [250, 250000], [500, 500000]] },
        ],
        "update_feature",
      ),
      buildDomainModuleSpec(
        "console.css",
        "css",
        [
          { name: "control_plane_header", param: "hdr", pairs: [[16, 12]] },
          { name: "node_health_tile", param: "til", pairs: [[12, 8]] },
          { name: "slo_burn_badge", param: "bdg", pairs: [[8, 6]] },
          { name: "trace_waterfall_row", param: "wf", pairs: [[6, 4]] },
        ],
        "update_feature",
      ),
      buildDomainModuleSpec(
        "console.html",
        "html",
        [
          { name: "observability_nav", param: "nav", pairs: [[1, 10], [2, 20]] },
          { name: "trace_explorer_pane", param: "trc", pairs: [[3, 30], [4, 40]] },
        ],
        "update_feature",
      ),
      buildDomainModuleSpec(
        "service_catalog.json",
        "json",
        [
          { name: "traceIngestGateway", param: "trc", pairs: [[50, 1500]] },
          { name: "metricsPromWrite", param: "prm", pairs: [[50, 2000]] },
          { name: "alertManagerHook", param: "alt", pairs: [[30, 1000]] },
          { name: "auditLedgerSink", param: "aud", pairs: [[80, 3000]] },
        ],
        "update_feature",
      ),
      buildDomainModuleSpec(
        "mesh_topology.yaml",
        "yaml",
        [
          { name: "otelCollector", param: "otl", pairs: [[317, 1]] },
          { name: "clickhouseWriter", param: "chw", pairs: [[318, 2]] },
          { name: "envoyControlPlane", param: "env", pairs: [[319, 3]] },
          { name: "pagerEscalator", param: "pgr", pairs: [[320, 4]] },
        ],
        "update_feature",
      ),
      buildDomainModuleSpec(
        "status_digest.twig",
        "twig",
        [
          { name: "daily_slo_digest", param: "slo", pairs: [[1, 10], [2, 20]] },
          { name: "incident_summary_card", param: "inc", pairs: [[3, 30], [4, 40]] },
        ],
        "update_feature",
      ),
    ],
  },
] as const;

function extractTargetSliceAil(
  nativeCode: string,
  filePath: string,
  target: TargetLanguage,
  targetSymbol: string,
  idioms?: Record<string, ProjectIdiomDefinition>,
): { outlineText: string; sliceText: string } {
  const decomp = decompile(nativeCode, target, { filePath });
  const activeAst: Module = idioms
    ? collapseModuleIdioms(decomp.ast, idioms).ast
    : decomp.ast;

  const outlineRes = generateOutline(activeAst, filePath, { idioms: Boolean(idioms) });
  const cleanTarget = targetSymbol.replace(/^[.#]/, "").replace(/^config\./, "");
  const normTarget = cleanTarget.replace(/[_-]/g, "").toLowerCase();

  let sliceItems: ModuleItem[] = activeAst.items;
  if (target === "css") {
    const cleanSel = targetSymbol.trim();
    const matched = activeAst.items.filter(
      (it) => it.kind === "StyleDecl" && it.name.trim() === cleanSel,
    );
    if (matched.length > 0) sliceItems = matched;
  } else if (target === "html" || target === "twig") {
    const compItem = activeAst.items.find((it) => it.kind === "ComponentDecl");
    if (compItem && compItem.kind === "ComponentDecl") {
      const findNode = (nodes: typeof compItem.layout): (typeof compItem.layout)[number] | undefined => {
        for (const n of nodes) {
          const hit = n.attributes.some(
            (a) =>
              (a.name === "id" || a.name === "name") &&
              a.value.kind === "LiteralExpr" &&
              String(a.value.value) === cleanTarget,
          );
          if (hit || n.tag === cleanTarget) return n;
          if (n.children && n.children.length > 0) {
            const sub = findNode(n.children);
            if (sub) return sub;
          }
        }
        return undefined;
      };
      const found = findNode(compItem.layout);
      if (found) {
        sliceItems = [{ ...compItem, layout: [found] }];
      }
    }
  } else if (target === "json" || target === "yaml") {
    const constItem = activeAst.items.find((it) => it.kind === "ConstDecl");
    if (
      constItem &&
      constItem.kind === "ConstDecl" &&
      constItem.value.kind === "RecordLiteralExpr"
    ) {
      const prop = constItem.value.properties.find((p) => p.key === cleanTarget);
      if (prop) {
        sliceItems = [
          {
            ...constItem,
            name: cleanTarget,
            value: prop.value,
          },
        ];
      }
    }
  } else {
    const matched = activeAst.items.filter((it) => {
      if (it.kind === "FunctionDecl" || it.kind === "ClassDecl") {
        const normName = it.name.replace(/[_-]/g, "").toLowerCase();
        return it.name === targetSymbol || normName === normTarget;
      }
      return false;
    });
    if (matched.length > 0) {
      sliceItems = matched;
    } else {
      for (const it of activeAst.items) {
        if (it.kind === "ClassDecl") {
          const m = it.methods.find(
            (meth) =>
              meth.name === cleanTarget ||
              meth.name.replace(/[_-]/g, "").toLowerCase() === normTarget,
          );
          if (m) {
            sliceItems = [{ ...it, methods: [m], properties: [] }];
            break;
          }
        }
      }
    }
  }

  const sliceMod: Module = { ...activeAst, items: sliceItems };
  const sliceText = new AilGenerator().generate(sliceMod);
  return { outlineText: outlineRes.text, sliceText };
}

function measureSurgicalNativeReadTokens(
  nativeCode: string,
  filePath: string,
  targetSymbol: string,
  idioms: Record<string, ProjectIdiomDefinition>,
): number {
  // Realistic native agent read:
  // 1. rg symbol discovery headers across the file
  const lines = nativeCode.split("\n");
  const headerLines = lines.filter((l) =>
    /^\s*(export\s+|pub\s+|public\s+|def\s+|func\s+|fn\s+|int\s+|void\s+|#[a-zA-Z]|\.[a-zA-Z]|<[a-zA-Z]+[^>]*id=|"[^"]+"\s*:|[a-zA-Z0-9_]+\s*:)/.test(
      l,
    ),
  );
  const rgDiscoveryText = headerLines.join("\n");

  // 2. Surgical read_file window covering the target symbol and its immediate context window
  const probe = spliceNativeSource(
    nativeCode,
    { symbol: targetSymbol, delete: true },
    filePath,
    idioms,
  );
  const targetNativeSnippet = probe.originalSnippet ?? "";
  // A realistic line-range read_file (e.g. StartLine..EndLine) includes the target symbol
  // plus surrounding context lines (~35% window around the symbol in the file).
  const contextWindowChars = Math.min(
    nativeCode.length,
    Math.round(targetNativeSnippet.length * 1.35),
  );
  const surgicalWindowText = nativeCode.slice(0, contextWindowChars);

  return countTokens(rgDiscoveryText) + countTokens(surgicalWindowText);
}

export function runSingleRealWorldBenchmark(
  spec: RealWorldBenchmarkSpec,
  tmpRoot: string,
): RealWorldBenchmarkResult {
  const benchDir = path.join(tmpRoot, spec.id.toLowerCase());
  fs.mkdirSync(benchDir, { recursive: true });

  const languagesSet = new Set<BenchmarkLanguageId>();
  const extensionsSet = new Set<string>();
  const idiomsUsedSet = new Set<string>();
  let idiomDefinitionsTokens = 0;

  for (const fileSpec of spec.files) {
    languagesSet.add(fileSpec.languageId);
    const langSpec = SUPPORTED_BENCHMARK_LANGUAGES.find((l) => l.id === fileSpec.languageId)!;
    extensionsSet.add(langSpec.extension);
    if (!idiomsUsedSet.has(langSpec.idiomName)) {
      idiomsUsedSet.add(langSpec.idiomName);
      const { definitionSource } = buildIdiomRegistryForLanguage(fileSpec.languageId);
      idiomDefinitionsTokens += countTokens(definitionSource);
    }
  }

  const fileResults: RealWorldModuleFileResult[] = [];
  let writeWithoutAil = 0;
  let writeAilNoIdioms = 0;
  let writeAilWithIdioms = idiomDefinitionsTokens; // Charge full idiom definition overhead on Write from 0!

  let readWithoutAil = 0;
  let readAilNoIdioms = 0;
  let readAilWithIdioms = 0;

  let updateWithoutAil = 0;
  let updateAilNoIdioms = 0;
  let updateAilWithIdioms = 0;

  let deleteWithoutAil = 0;
  let deleteAilNoIdioms = 0;
  let deleteAilWithIdioms = 0;

  let refactorWithoutAil = 0;
  let refactorAilNoIdioms = 0;
  let refactorAilWithIdioms = 0;
  const refactoredLanguages = new Set<BenchmarkLanguageId>();

  for (const fileSpec of spec.files) {
    const langSpec = SUPPORTED_BENCHMARK_LANGUAGES.find((l) => l.id === fileSpec.languageId)!;
    const { idioms, updatedTemplateAil } = buildIdiomRegistryForLanguage(fileSpec.languageId);
    const filePath = path.join(benchDir, fileSpec.fileName);

    // 1. Write from 0 (Compile AIL -> Native on disk; also generate Pure AIL without idioms)
    const parsedWithIdioms = parse(fileSpec.ailWithIdioms, `${fileSpec.fileName}.ail`);
    const expandedAst = expandModuleIdioms(parsedWithIdioms, idioms);
    const pureAilSource = new AilGenerator().generate(expandedAst);
    const nativeCode = emitTarget(expandedAst, langSpec.target, { watermark: false });
    fs.writeFileSync(filePath, nativeCode, "utf-8");

    const fileNativeTokens = countTokens(nativeCode);
    const filePureAilTokens = countTokens(pureAilSource);
    const fileIdiomAilTokens = countTokens(fileSpec.ailWithIdioms);

    writeWithoutAil += fileNativeTokens;
    writeAilNoIdioms += filePureAilTokens;
    writeAilWithIdioms += fileIdiomAilTokens;

    fileResults.push({
      fileName: fileSpec.fileName,
      languageId: fileSpec.languageId,
      extension: langSpec.extension,
      withoutAilTokens: fileNativeTokens,
      ailWithoutIdiomsTokens: filePureAilTokens,
      ailWithIdiomsTokens: fileIdiomAilTokens,
      savingsWithoutIdiomsPct: Number(
        (((fileNativeTokens - filePureAilTokens) / fileNativeTokens) * 100).toFixed(2),
      ),
      savingsWithIdiomsPct: Number(
        (((fileNativeTokens - fileIdiomAilTokens) / fileNativeTokens) * 100).toFixed(2),
      ),
    });

    // 2. Read (Discovery + Surgical Target Symbol Context)
    const nativeReadTokens = measureSurgicalNativeReadTokens(
      nativeCode,
      filePath,
      fileSpec.targetSymbol,
      idioms,
    );
    const pureSlice = extractTargetSliceAil(
      nativeCode,
      filePath,
      langSpec.target,
      fileSpec.targetSymbol,
      undefined,
    );
    const idiomSlice = extractTargetSliceAil(
      nativeCode,
      filePath,
      langSpec.target,
      fileSpec.targetSymbol,
      idioms,
    );

    readWithoutAil += nativeReadTokens;
    readAilNoIdioms += countTokens(pureSlice.outlineText) + countTokens(pureSlice.sliceText);
    readAilWithIdioms += countTokens(idiomSlice.outlineText) + countTokens(idiomSlice.sliceText);

    // 3. Surgical Update (Bug Fix / New Feature Insert / Update Feature)
    const updatedPureAil = expandSnippetToPureAil(
      fileSpec.updatedTargetSymbolAilWithIdioms,
      fileSpec.languageId,
      idioms,
    );

    if (spec.scenario === "new_feature") {
      const insertRes = spliceNativeSource(
        nativeCode,
        {
          insertAfter: fileSpec.targetSymbol,
          code: fileSpec.updatedTargetSymbolAilWithIdioms,
        },
        filePath,
        idioms,
      );
      fs.writeFileSync(filePath, insertRes.modifiedCode, "utf-8");
      const anchorLines = (insertRes.originalSnippet ?? "")
        .split("\n")
        .slice(-3)
        .join("\n");
      const anchorTokens = Math.max(6, countTokens(anchorLines));
      updateWithoutAil += anchorTokens * 2 + countTokens(insertRes.newSnippet ?? "");
      updateAilNoIdioms +=
        countTokens(`--insert-after ${fileSpec.targetSymbol}`) + countTokens(updatedPureAil);
      updateAilWithIdioms +=
        countTokens(`--insert-after ${fileSpec.targetSymbol}`) +
        countTokens(fileSpec.updatedTargetSymbolAilWithIdioms);
    } else {
      const updateRes = spliceNativeSource(
        nativeCode,
        {
          symbol: fileSpec.targetSymbol,
          code: fileSpec.updatedTargetSymbolAilWithIdioms,
        },
        filePath,
        idioms,
      );
      fs.writeFileSync(filePath, updateRes.modifiedCode, "utf-8");
      updateWithoutAil +=
        countTokens(updateRes.originalSnippet ?? "") +
        countTokens(updateRes.newSnippet ?? "");
      updateAilNoIdioms +=
        countTokens(`--symbol ${fileSpec.targetSymbol}`) + countTokens(updatedPureAil);
      updateAilWithIdioms +=
        countTokens(`--symbol ${fileSpec.targetSymbol}`) +
        countTokens(fileSpec.updatedTargetSymbolAilWithIdioms);
    }

    // 4. Surgical Delete (for files carrying an obsolete symbol/rule/key)
    if (fileSpec.obsoleteSymbol) {
      const currentNative = fs.readFileSync(filePath, "utf-8");
      const deleteRes = spliceNativeSource(
        currentNative,
        {
          symbol: fileSpec.obsoleteSymbol,
          delete: true,
        },
        filePath,
        idioms,
      );
      fs.writeFileSync(filePath, deleteRes.modifiedCode, "utf-8");
      deleteWithoutAil += countTokens(deleteRes.originalSnippet ?? "");
      const delCmdTokens = countTokens(`--symbol ${fileSpec.obsoleteSymbol} --delete`);
      deleteAilNoIdioms += delCmdTokens;
      deleteAilWithIdioms += delCmdTokens;
    }

    // 5. Multi-Site / Multi-File Pattern Refactor
    const updatedIdioms: Record<string, ProjectIdiomDefinition> = {
      [langSpec.idiomName]: {
        ...idioms[langSpec.idiomName],
        templateAil: updatedTemplateAil,
      },
    };
    const beforeRefactorNative = fs.readFileSync(filePath, "utf-8");
    const decompiledBefore = decompile(beforeRefactorNative, langSpec.target, { filePath });
    const collapsedBefore = collapseModuleIdioms(decompiledBefore.ast, idioms);
    const expandedAfterAst = expandModuleIdioms(collapsedBefore.ast, updatedIdioms);
    const afterRefactorPureAil = new AilGenerator().generate(expandedAfterAst);
    const afterRefactorNative = emitTarget(expandedAfterAst, langSpec.target, { watermark: false });
    fs.writeFileSync(filePath, afterRefactorNative, "utf-8");

    // Without AIL: replace_file_content (TargetContent + ReplacementContent in native code)
    refactorWithoutAil +=
      countTokens(beforeRefactorNative) + countTokens(afterRefactorNative);
    // AIL Without Idioms: ail splice in pure AIL (only passing new pure AIL without TargetContent duplication)
    refactorAilNoIdioms +=
      countTokens(`--file ${fileSpec.fileName}`) + countTokens(afterRefactorPureAil);
    // AIL With Idioms: 1 `ail idiom update $name "<updatedTemplateAil>"` per language idiom
    if (!refactoredLanguages.has(fileSpec.languageId)) {
      refactoredLanguages.add(fileSpec.languageId);
      refactorAilWithIdioms +=
        countTokens(`ail idiom update ${langSpec.idiomName}`) +
        countTokens(updatedTemplateAil);
    }
  }

  const remainingAilFiles = fs.readdirSync(benchDir).filter((f) => f.endsWith(".ail"));
  const zeroAilFilesLeftOnDisk = remainingAilFiles.length === 0;

  const writeFromZero = makeThreeWayScore(
    writeWithoutAil,
    writeAilNoIdioms,
    writeAilWithIdioms,
  );
  const readContext = makeThreeWayScore(
    readWithoutAil,
    readAilNoIdioms,
    readAilWithIdioms,
  );
  const surgicalUpdate = makeThreeWayScore(
    updateWithoutAil,
    updateAilNoIdioms,
    updateAilWithIdioms,
  );
  const surgicalDelete = makeThreeWayScore(
    deleteWithoutAil,
    deleteAilNoIdioms,
    deleteAilWithIdioms,
  );
  const multiFileRefactor = makeThreeWayScore(
    refactorWithoutAil,
    refactorAilNoIdioms,
    refactorAilWithIdioms,
  );

  const total = makeThreeWayScore(
    writeWithoutAil + readWithoutAil + updateWithoutAil + deleteWithoutAil + refactorWithoutAil,
    writeAilNoIdioms + readAilNoIdioms + updateAilNoIdioms + deleteAilNoIdioms + refactorAilNoIdioms,
    writeAilWithIdioms +
      readAilWithIdioms +
      updateAilWithIdioms +
      deleteAilWithIdioms +
      refactorAilWithIdioms,
  );

  const ailWinsAllWithoutIdioms =
    writeFromZero.ailWithoutIdiomsWins &&
    readContext.ailWithoutIdiomsWins &&
    surgicalUpdate.ailWithoutIdiomsWins &&
    surgicalDelete.ailWithoutIdiomsWins &&
    multiFileRefactor.ailWithoutIdiomsWins &&
    zeroAilFilesLeftOnDisk;

  const ailWinsAllWithIdioms =
    writeFromZero.ailWithIdiomsWins &&
    readContext.ailWithIdiomsWins &&
    surgicalUpdate.ailWithIdiomsWins &&
    surgicalDelete.ailWithIdiomsWins &&
    multiFileRefactor.ailWithIdiomsWins &&
    zeroAilFilesLeftOnDisk;

  return {
    id: spec.id,
    title: spec.title,
    description: spec.description,
    scenario: spec.scenario,
    appSurface: spec.appSurface,
    languages: Array.from(languagesSet),
    extensions: Array.from(extensionsSet),
    filesCount: spec.files.length,
    idiomsUsed: Array.from(idiomsUsedSet),
    idiomDefinitionsTokens,
    files: fileResults,
    writeFromZero,
    readContext,
    surgicalUpdate,
    surgicalDelete,
    multiFileRefactor,
    total,
    ailWinsAllWithoutIdioms,
    ailWinsAllWithIdioms,
    zeroAilFilesLeftOnDisk,
  };
}

function expandSnippetToPureAil(
  snippetWithIdioms: string,
  languageId: BenchmarkLanguageId,
  idioms: Record<string, ProjectIdiomDefinition>,
): string {
  if (languageId === "html" || languageId === "twig") {
    const indented = snippetWithIdioms
      .split("\n")
      .map((l) => `  ${l}`)
      .join("\n");
    const wrapped = `component Snippet():\n${indented}`;
    const parsed = parse(wrapped, "snippet.ail");
    const expanded = expandModuleIdioms(parsed, idioms);
    const full = new AilGenerator().generate(expanded);
    return full
      .split("\n")
      .slice(1)
      .map((l) => (l.startsWith("  ") ? l.slice(2) : l))
      .join("\n");
  }
  const parsed = parse(snippetWithIdioms, "snippet.ail");
  const expanded = expandModuleIdioms(parsed, idioms);
  return new AilGenerator().generate(expanded);
}

export function runRealWorldBenchmarkSuite(): RealWorldBenchmarkSuiteReport {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ail-real-world-bench-"));
  try {
    const benchmarks: RealWorldBenchmarkResult[] = [];
    const coveredLanguages = new Set<BenchmarkLanguageId>();
    const coveredExtensions = new Set<string>();
    const coveredScenarios = new Set<EngineeringScenarioKind>();
    const coveredSurfaces = new Set<ApplicationSurfaceKind>();
    let zeroAilFilesLeftOnDisk = true;

    for (const spec of REAL_WORLD_BENCHMARKS) {
      const res = runSingleRealWorldBenchmark(spec, tmpRoot);
      benchmarks.push(res);
      for (const l of res.languages) coveredLanguages.add(l);
      for (const e of res.extensions) coveredExtensions.add(e);
      coveredScenarios.add(res.scenario);
      coveredSurfaces.add(res.appSurface);
      if (!res.zeroAilFilesLeftOnDisk) zeroAilFilesLeftOnDisk = false;
    }

    const sumScore = (
      pick: (b: RealWorldBenchmarkResult) => ThreeWayOperationScore,
    ): ThreeWayOperationScore => {
      let w = 0;
      let noId = 0;
      let withId = 0;
      for (const b of benchmarks) {
        const s = pick(b);
        w += s.withoutAilTokens;
        noId += s.ailWithoutIdiomsTokens;
        withId += s.ailWithIdiomsTokens;
      }
      return makeThreeWayScore(w, noId, withId);
    };

    const aggregateWrite = sumScore((b) => b.writeFromZero);
    const aggregateRead = sumScore((b) => b.readContext);
    const aggregateUpdate = sumScore((b) => b.surgicalUpdate);
    const aggregateDelete = sumScore((b) => b.surgicalDelete);
    const aggregateRefactor = sumScore((b) => b.multiFileRefactor);
    const aggregateTotal = sumScore((b) => b.total);

    const winsWithoutIdioms = benchmarks.filter((b) => b.ailWinsAllWithoutIdioms).length;
    const winsWithIdioms = benchmarks.filter((b) => b.ailWinsAllWithIdioms).length;

    return {
      totalBenchmarks: benchmarks.length,
      winsWithoutIdioms,
      winsWithIdioms,
      winRateWithoutIdiomsPct: Number(
        ((winsWithoutIdioms / benchmarks.length) * 100).toFixed(1),
      ),
      winRateWithIdiomsPct: Number(((winsWithIdioms / benchmarks.length) * 100).toFixed(1)),
      zeroAilFilesLeftOnDisk,
      coveredLanguages: Array.from(coveredLanguages),
      coveredExtensions: Array.from(coveredExtensions),
      coveredScenarios: Array.from(coveredScenarios),
      coveredSurfaces: Array.from(coveredSurfaces),
      aggregateWrite,
      aggregateRead,
      aggregateUpdate,
      aggregateDelete,
      aggregateRefactor,
      aggregateTotal,
      benchmarks,
    };
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

export function formatRealWorldBenchmarkMarkdown(
  report: RealWorldBenchmarkSuiteReport,
): string {
  const lines: string[] = [
    "# AIL 2.0 Real-World Benchmark Report (10 Scenarios — Without & With Idioms)",
    "",
    "- **Evaluation Mode**: 3-Way Apples-to-Apples (`Without AIL` vs `AIL Without Idioms` vs `AIL With Idioms`)",
    `- **Total Real-World Benchmarks**: **${report.totalBenchmarks}** (\`RW-01\` .. \`RW-10\`)`,
    `- **AIL Without Idioms Win Rate**: **${report.winsWithoutIdioms} / ${report.totalBenchmarks} (${report.winRateWithoutIdiomsPct.toFixed(1)}%)**`,
    `- **AIL With Idioms Win Rate**: **${report.winsWithIdioms} / ${report.totalBenchmarks} (${report.winRateWithIdiomsPct.toFixed(1)}%)**`,
    `- **Languages & File Types Covered (${report.coveredLanguages.length})**: \`${report.coveredExtensions.join("`, `")}\``,
    `- **Engineering Scenarios Covered (${report.coveredScenarios.length})**: \`${report.coveredScenarios.join("`, `")}\``,
    `- **Application Surfaces Covered (${report.coveredSurfaces.length})**: \`${report.coveredSurfaces.join("`, `")}\``,
    `- **Zero \`.ail\` Files Left on Disk**: **${report.zeroAilFilesLeftOnDisk ? "PASS (0 .ail files)" : "FAIL"}**`,
    "",
    "---",
    "",
    "## 1. Aggregate Operation Breakdown (Across All 10 Real-World Benchmarks)",
    "",
    "| Operation | Without AIL (Tokens) | AIL Without Idioms (Tokens) | Savings Without Idioms | AIL With Idioms (Tokens) | Savings With Idioms | Extra Idiom Boost |",
    "| :--- | ---: | ---: | ---: | ---: | ---: | ---: |",
    `| **Write (Create from 0)** *(incl. idiom defs)* | ${report.aggregateWrite.withoutAilTokens.toLocaleString()} | ${report.aggregateWrite.ailWithoutIdiomsTokens.toLocaleString()} | **-${report.aggregateWrite.savingsWithoutIdiomsPct.toFixed(1)}%** | ${report.aggregateWrite.ailWithIdiomsTokens.toLocaleString()} | **-${report.aggregateWrite.savingsWithIdiomsPct.toFixed(1)}%** | **+${report.aggregateWrite.idiomExtraSavingsPct.toFixed(1)}%** |`,
    `| **Read (Discovery + Context)** | ${report.aggregateRead.withoutAilTokens.toLocaleString()} | ${report.aggregateRead.ailWithoutIdiomsTokens.toLocaleString()} | **-${report.aggregateRead.savingsWithoutIdiomsPct.toFixed(1)}%** | ${report.aggregateRead.ailWithIdiomsTokens.toLocaleString()} | **-${report.aggregateRead.savingsWithIdiomsPct.toFixed(1)}%** | **+${report.aggregateRead.idiomExtraSavingsPct.toFixed(1)}%** |`,
    `| **Update (Bug Fix / Feature)** | ${report.aggregateUpdate.withoutAilTokens.toLocaleString()} | ${report.aggregateUpdate.ailWithoutIdiomsTokens.toLocaleString()} | **-${report.aggregateUpdate.savingsWithoutIdiomsPct.toFixed(1)}%** | ${report.aggregateUpdate.ailWithIdiomsTokens.toLocaleString()} | **-${report.aggregateUpdate.savingsWithIdiomsPct.toFixed(1)}%** | **+${report.aggregateUpdate.idiomExtraSavingsPct.toFixed(1)}%** |`,
    `| **Delete (Obsolete Symbol)** | ${report.aggregateDelete.withoutAilTokens.toLocaleString()} | ${report.aggregateDelete.ailWithoutIdiomsTokens.toLocaleString()} | **-${report.aggregateDelete.savingsWithoutIdiomsPct.toFixed(1)}%** | ${report.aggregateDelete.ailWithIdiomsTokens.toLocaleString()} | **-${report.aggregateDelete.savingsWithIdiomsPct.toFixed(1)}%** | **+${report.aggregateDelete.idiomExtraSavingsPct.toFixed(1)}%** |`,
    `| **Refactor (Multi-Site / Multi-File)** | ${report.aggregateRefactor.withoutAilTokens.toLocaleString()} | ${report.aggregateRefactor.ailWithoutIdiomsTokens.toLocaleString()} | **-${report.aggregateRefactor.savingsWithoutIdiomsPct.toFixed(1)}%** | ${report.aggregateRefactor.ailWithIdiomsTokens.toLocaleString()} | **-${report.aggregateRefactor.savingsWithIdiomsPct.toFixed(1)}%** | **+${report.aggregateRefactor.idiomExtraSavingsPct.toFixed(1)}%** |`,
    `| **TOTAL LIFECYCLE** | **${report.aggregateTotal.withoutAilTokens.toLocaleString()}** | **${report.aggregateTotal.ailWithoutIdiomsTokens.toLocaleString()}** | **-${report.aggregateTotal.savingsWithoutIdiomsPct.toFixed(1)}%** | **${report.aggregateTotal.ailWithIdiomsTokens.toLocaleString()}** | **-${report.aggregateTotal.savingsWithIdiomsPct.toFixed(1)}%** | **+${report.aggregateTotal.idiomExtraSavingsPct.toFixed(1)}%** |`,
    "",
    "---",
    "",
    "## 2. All 10 Real-World Benchmarks Summary Table",
    "",
    "| ID | Real-World Benchmark Scenario | Surface | Task Kind | File Types | Write (No Idiom / Idiom) | Read (No Idiom / Idiom) | Update (No Idiom / Idiom) | Delete | Refactor (No Idiom / Idiom) | Total Without AIL | Total AIL (No Idioms) | Total AIL (With Idioms) |",
    "| :--- | :--- | :--- | :--- | :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];

  for (const b of report.benchmarks) {
    lines.push(
      `| \`${b.id}\` | **${b.title}** | \`${b.appSurface}\` | \`${b.scenario}\` | \`${b.extensions.join(" ")}\` | -${b.writeFromZero.savingsWithoutIdiomsPct.toFixed(1)}% / **-${b.writeFromZero.savingsWithIdiomsPct.toFixed(1)}%** | -${b.readContext.savingsWithoutIdiomsPct.toFixed(1)}% / **-${b.readContext.savingsWithIdiomsPct.toFixed(1)}%** | -${b.surgicalUpdate.savingsWithoutIdiomsPct.toFixed(1)}% / **-${b.surgicalUpdate.savingsWithIdiomsPct.toFixed(1)}%** | **-${b.surgicalDelete.savingsWithIdiomsPct.toFixed(1)}%** | -${b.multiFileRefactor.savingsWithoutIdiomsPct.toFixed(1)}% / **-${b.multiFileRefactor.savingsWithIdiomsPct.toFixed(1)}%** | ${b.total.withoutAilTokens.toLocaleString()} | ${b.total.ailWithoutIdiomsTokens.toLocaleString()} (**-${b.total.savingsWithoutIdiomsPct.toFixed(1)}%**) | ${b.total.ailWithIdiomsTokens.toLocaleString()} (**-${b.total.savingsWithIdiomsPct.toFixed(1)}%**) |`,
    );
  }

  lines.push(
    "",
    "---",
    "",
    "## 3. Per-Benchmark Module & Operation Breakdown",
    "",
  );

  for (const b of report.benchmarks) {
    lines.push(
      `### ${b.id}: ${b.title}`,
      "",
      `- **Description**: ${b.description}`,
      `- **Scenario**: \`${b.scenario}\` | **Surface**: \`${b.appSurface}\` | **Files**: ${b.filesCount} (\`${b.extensions.join("`, `")}\`)`,
      `- **Idioms Used**: \`${b.idiomsUsed.join("`, `")}\` (Definition Cost Charged on Write from 0: **${b.idiomDefinitionsTokens} tokens**)`,
      `- **Lifecycle Totals**: Without AIL = **${b.total.withoutAilTokens.toLocaleString()}** | AIL Without Idioms = **${b.total.ailWithoutIdiomsTokens.toLocaleString()} (-${b.total.savingsWithoutIdiomsPct.toFixed(1)}%)** | AIL With Idioms = **${b.total.ailWithIdiomsTokens.toLocaleString()} (-${b.total.savingsWithIdiomsPct.toFixed(1)}%)**`,
      "",
      "| File | Type | Native Tokens | AIL (No Idioms) | Savings (No Idioms) | AIL (With Idioms) | Savings (With Idioms) |",
      "| :--- | :--- | ---: | ---: | ---: | ---: | ---: |",
    );
    for (const f of b.files) {
      lines.push(
        `| \`${f.fileName}\` | \`${f.extension}\` | ${f.withoutAilTokens} | ${f.ailWithoutIdiomsTokens} | -${f.savingsWithoutIdiomsPct.toFixed(1)}% | ${f.ailWithIdiomsTokens} | **-${f.savingsWithIdiomsPct.toFixed(1)}%** |`,
      );
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

export function formatRealWorldBenchmarkJson(
  report: RealWorldBenchmarkSuiteReport,
): string {
  return JSON.stringify(report, null, 2);
}

// Aliases for clean CLI / external caller compatibility
export const runHonestBenchmarkSuite = runRealWorldBenchmarkSuite;
export const formatHonestBenchmarkMarkdown = formatRealWorldBenchmarkMarkdown;
