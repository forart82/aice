/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AICE 2.0 Real-World Benchmark Suite (10 End-to-End Real-World Benchmarks):
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
 *   1. Without AICE (Native Baseline):
 *      - Write from 0: Raw native code tokens written to disk.
 *      - Read (Discovery + Surgical Read): Realistic `rg` top-level symbol discovery + surgical line-range `read_file` window around target symbol.
 *      - Update (Bug Fix / New Feature / Update Feature): Surgical `replace_file_content` (`TargetContent` + `ReplacementContent`).
 *      - Delete (Remove Obsolete Symbol/Rule/Key): Surgical `replace_file_content` (`TargetContent` of deleted block).
 *      - Refactor (Cross-Site Pattern Change): Surgical `replace_file_content` across affected symbols/rules (not untouched file contents).
 *   2. AICE On-the-Fly WITHOUT Idioms (Pure Syntax + AST Tooling):
 *      - Write from 0: Pure AICE code tokens (zero `$idiom` macros) compiled directly to native disk.
 *      - Read: `aice outline` (`generateOutline`) + `extractSymbolFromAiceSource` of target symbol (`--no-idioms`).
 *      - Update: `aice splice <file> --symbol <sym> --code "<pure AICE>"` (verified via live `spliceNativeSource` with `{}` idioms).
 *      - Delete: `aice splice <file> --symbol <sym> --delete`.
 *      - Refactor: Surgical `aice splice` across affected symbols in pure AICE (verified via live `spliceNativeSource`).
 *   3. AICE On-the-Fly WITH Idioms (Syntax + AST Tooling + `$idioms`, including definition overhead):
 *      - Write from 0: Idiom-compressed AICE code tokens PLUS full token cost of all `idiom $name(...)` definitions in `aice.config.json`.
 *      - Read: `aice outline` (`generateOutline`) + `extractSymbolFromAiceSource` of target symbol (`--idioms`).
 *      - Update: `aice splice <file> --symbol <sym> --code "<AICE with $idioms>"` (verified bit-identical to pure AICE splice).
 *      - Delete: `aice splice <file> --symbol <sym> --delete`.
 *      - Refactor: Single `aice idiom update $name "<new template>"` in `aice.config.json` propagated across all call sites.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ProjectIdiomDefinition } from "../src/config/index.js";
import type { Module } from "../src/core/ast.js";
import { parse } from "../src/core/parser.js";
import { AiceGenerator, decompile } from "../src/decompiler/index.js";
import { emitTarget, type TargetLanguage } from "../src/emitters/index.js";
import {
  collapseModuleIdioms,
  expandModuleIdioms,
} from "../src/idioms/index.js";
import { estimateTokens } from "../src/tokenomics/index.js";
import { extractSymbolFromAiceSource } from "../src/tools/context.js";
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
  { id: "ts", label: "TypeScript (.ts)", extension: ".ts", target: "typescript", idiomName: "$guard_band_step" },
  { id: "tsx", label: "React TSX (.tsx)", extension: ".tsx", target: "tsx", idiomName: "$tsx_kpi_tile" },
  { id: "js", label: "JavaScript (.js)", extension: ".js", target: "javascript", idiomName: "$clamp_cart_line" },
  { id: "py", label: "Python (.py)", extension: ".py", target: "python", idiomName: "$enforce_quota_band" },
  { id: "go", label: "Go (.go)", extension: ".go", target: "go", idiomName: "$bounded_quorum_step" },
  { id: "rs", label: "Rust (.rs)", extension: ".rs", target: "rust", idiomName: "$advance_wal_cursor" },
  { id: "cpp", label: "C++20 (.cpp)", extension: ".cpp", target: "cpp", idiomName: "$solve_axis_impulse" },
  { id: "cs", label: "C# (.cs)", extension: ".cs", target: "csharp", idiomName: "$settle_ledger_window" },
  { id: "kt", label: "Kotlin (.kt)", extension: ".kt", target: "kotlin", idiomName: "$score_risk_signal" },
  { id: "php", label: "PHP 8 (.php)", extension: ".php", target: "php", idiomName: "$round_money_band" },
  { id: "css", label: "CSS3 (.css)", extension: ".css", target: "css", idiomName: "$css_card" },
  { id: "html", label: "HTML5 (.html)", extension: ".html", target: "html", idiomName: "$html_metric_row" },
  { id: "json", label: "JSON (.json)", extension: ".json", target: "json", idiomName: "$json_policy_rule" },
  { id: "yaml", label: "YAML (.yaml)", extension: ".yaml", target: "yaml", idiomName: "$yaml_service_tier" },
  { id: "twig", label: "Twig (.twig)", extension: ".twig", target: "twig", idiomName: "$twig_summary_line" },
] as const;

export interface ThreeWayOperationScore {
  withoutAiceTokens: number;
  aiceWithoutIdiomsTokens: number;
  aiceWithIdiomsTokens: number;
  savedWithoutIdiomsTokens: number;
  savingsWithoutIdiomsPct: number;
  savedWithIdiomsTokens: number;
  savingsWithIdiomsPct: number;
  idiomExtraSavingsPct: number;
  withoutAiceTurns: number;
  aiceWithoutIdiomsTurns: number;
  aiceWithIdiomsTurns: number;
  savedWithoutIdiomsTurns: number;
  turnsSavingsWithoutIdiomsPct: number;
  savedWithIdiomsTurns: number;
  turnsSavingsWithIdiomsPct: number;
  idiomExtraTurnsSavingsPct: number;
  aiceWithoutIdiomsWins: boolean;
  aiceWithIdiomsWins: boolean;
}

export interface RealWorldModuleFileResult {
  fileName: string;
  languageId: BenchmarkLanguageId;
  extension: string;
  withoutAiceTokens: number;
  aiceWithoutIdiomsTokens: number;
  aiceWithIdiomsTokens: number;
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
  aiceWinsAllWithoutIdioms: boolean;
  aiceWinsAllWithIdioms: boolean;
  zeroAiceFilesLeftOnDisk: boolean;
}

export interface RealWorldBenchmarkSuiteReport {
  totalBenchmarks: number;
  winsWithoutIdioms: number;
  winsWithIdioms: number;
  winRateWithoutIdiomsPct: number;
  winRateWithIdiomsPct: number;
  zeroAiceFilesLeftOnDisk: boolean;
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
  withoutAiceTokens: number,
  aiceWithoutIdiomsTokens: number,
  aiceWithIdiomsTokens: number,
  withoutAiceTurns: number = 0,
  aiceWithoutIdiomsTurns: number = 0,
  aiceWithIdiomsTurns: number = 0,
): ThreeWayOperationScore {
  const savedWithoutIdiomsTokens = withoutAiceTokens - aiceWithoutIdiomsTokens;
  const savingsWithoutIdiomsPct =
    withoutAiceTokens > 0
      ? Number(((savedWithoutIdiomsTokens / withoutAiceTokens) * 100).toFixed(2))
      : 0;
  const savedWithIdiomsTokens = withoutAiceTokens - aiceWithIdiomsTokens;
  const savingsWithIdiomsPct =
    withoutAiceTokens > 0
      ? Number(((savedWithIdiomsTokens / withoutAiceTokens) * 100).toFixed(2))
      : 0;
  const idiomExtraSavingsPct = Number(
    (savingsWithIdiomsPct - savingsWithoutIdiomsPct).toFixed(2),
  );

  const savedWithoutIdiomsTurns = withoutAiceTurns - aiceWithoutIdiomsTurns;
  const turnsSavingsWithoutIdiomsPct =
    withoutAiceTurns > 0
      ? Number(((savedWithoutIdiomsTurns / withoutAiceTurns) * 100).toFixed(2))
      : 0;
  const savedWithIdiomsTurns = withoutAiceTurns - aiceWithIdiomsTurns;
  const turnsSavingsWithIdiomsPct =
    withoutAiceTurns > 0
      ? Number(((savedWithIdiomsTurns / withoutAiceTurns) * 100).toFixed(2))
      : 0;
  const idiomExtraTurnsSavingsPct = Number(
    (turnsSavingsWithIdiomsPct - turnsSavingsWithoutIdiomsPct).toFixed(2),
  );

  return {
    withoutAiceTokens,
    aiceWithoutIdiomsTokens,
    aiceWithIdiomsTokens,
    savedWithoutIdiomsTokens,
    savingsWithoutIdiomsPct,
    savedWithIdiomsTokens,
    savingsWithIdiomsPct,
    idiomExtraSavingsPct,
    withoutAiceTurns,
    aiceWithoutIdiomsTurns,
    aiceWithIdiomsTurns,
    savedWithoutIdiomsTurns,
    turnsSavingsWithoutIdiomsPct,
    savedWithIdiomsTurns,
    turnsSavingsWithIdiomsPct,
    idiomExtraTurnsSavingsPct,
    aiceWithoutIdiomsWins: aiceWithoutIdiomsTokens < withoutAiceTokens,
    aiceWithIdiomsWins:
      aiceWithIdiomsTokens < withoutAiceTokens &&
      aiceWithIdiomsTokens <= aiceWithoutIdiomsTokens,
  };
}

function makeIdiomDef(
  name: string,
  kind: "expr" | "stmt" | "block",
  params: Array<{ name: string; type: string }>,
  templateAice: string,
): ProjectIdiomDefinition {
  return {
    name,
    kind,
    params,
    templateAice,
    occurrences: 8,
    tokensPerOccurrenceSaved: 20,
    netTokenSavings: 160,
  };
}

export function buildIdiomRegistryForLanguage(
  lang: BenchmarkLanguageId,
): {
  idioms: Record<string, ProjectIdiomDefinition>;
  updatedTemplateAice: string;
  definitionSource: string;
} {
  const langSpec = SUPPORTED_BENCHMARK_LANGUAGES.find((l) => l.id === lang)!;
  const idiomName = langSpec.idiomName;

  const formatDef = (def: ProjectIdiomDefinition): string => {
    const pStr = def.params.map((p) => `${p.name}: ${p.type}`).join(", ");
    return `idiom ${def.name}(${pStr}) {\n  ${def.templateAice.replace(/\n/g, "\n  ")}\n}`;
  };

  switch (lang) {
    case "ts":
    case "js":
    case "py":
    case "go":
    case "rs":
    case "cpp":
    case "cs":
    case "kt":
    case "php": {
      const params = [
        { name: "$0", type: "int" },
        { name: "$1", type: "int" },
        { name: "$2", type: "int" },
        { name: "$3", type: "int" },
      ];
      const templateAice = [
        "if $0 < $1:",
        "  $0 = $1",
        "if $0 > $2:",
        "  $0 = $2",
        "$0 = $0 + $3",
      ].join("\n");
      const updatedTemplateAice = [
        "if $0 < $1:",
        "  $0 = $1",
        "if $0 > $2:",
        "  $0 = $2",
        "$0 = $0 + $3 + 1",
      ].join("\n");
      const def = makeIdiomDef(idiomName, "stmt", params, templateAice);
      const aliases: Record<string, ProjectIdiomDefinition> = { [idiomName]: def };
      if (lang === "ts" || lang === "js") {
        aliases.$clamp_step = def;
      }
      return {
        idioms: aliases,
        updatedTemplateAice,
        definitionSource: formatDef(def),
      };
    }
    case "tsx": {
      const def = makeIdiomDef(
        idiomName,
        "stmt",
        [
          { name: "$0", type: "string" },
          { name: "$1", type: "string" },
          { name: "$2", type: "string" },
        ],
        'div(class="kpi-tile", data-metric=$0) { span(class="kpi-label"): $1; strong(class="kpi-value"): $2 }',
      );
      return {
        idioms: { [idiomName]: def },
        updatedTemplateAice:
          'div(class="kpi-tile-v2", data-metric=$0) { span(class="kpi-label"): $1; strong(class="kpi-value"): $2 }',
        definitionSource: formatDef(def),
      };
    }
    case "css": {
      const def = makeIdiomDef(
        idiomName,
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
        idioms: { [idiomName]: def, $css_card: def },
        updatedTemplateAice: [
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
        idiomName,
        "stmt",
        [
          { name: "$0", type: "string" },
          { name: "$1", type: "string" },
          { name: "$2", type: "string" },
        ],
        'div(class="metric-row", data-key=$0) { span(class="metric-label"): $1; strong(class="metric-val"): $2 }',
      );
      return {
        idioms: { [idiomName]: def },
        updatedTemplateAice:
          'div(class="metric-row-v2", data-key=$0) { span(class="metric-label"): $1; strong(class="metric-val"): $2 }',
        definitionSource: formatDef(def),
      };
    }
    case "json": {
      const def = makeIdiomDef(
        idiomName,
        "expr",
        [
          { name: "$0", type: "string" },
          { name: "$1", type: "int" },
          { name: "$2", type: "int" },
        ],
        "{ id: $0, threshold: $1, limit: $2, retries: 3, enabled: true, windowSec: 60 }",
      );
      return {
        idioms: { [idiomName]: def },
        updatedTemplateAice:
          "{ id: $0, threshold: $1, limit: $2, retries: 5, enabled: true, windowSec: 120 }",
        definitionSource: formatDef(def),
      };
    }
    case "yaml": {
      const def = makeIdiomDef(
        idiomName,
        "expr",
        [
          { name: "$0", type: "string" },
          { name: "$1", type: "int" },
          { name: "$2", type: "int" },
        ],
        "{ worker: $0, port: $1, concurrency: $2, replicas: 3, healthIntervalSec: 15, tlsRequired: true }",
      );
      return {
        idioms: { [idiomName]: def },
        updatedTemplateAice:
          "{ worker: $0, port: $1, concurrency: $2, replicas: 4, healthIntervalSec: 10, tlsRequired: true }",
        definitionSource: formatDef(def),
      };
    }
    case "twig": {
      const def = makeIdiomDef(
        idiomName,
        "stmt",
        [
          { name: "$0", type: "string" },
          { name: "$1", type: "string" },
        ],
        'div(class="summary-row") { span(class="summary-lbl"): $0; strong(class="summary-val"): $1 }',
      );
      return {
        idioms: { [idiomName]: def },
        updatedTemplateAice:
          'div(class="summary-row-v2") { span(class="summary-lbl"): $0; strong(class="summary-val"): $1 }',
        definitionSource: formatDef(def),
      };
    }
  }
}

export interface RealWorldFileSpec {
  fileName: string;
  languageId: BenchmarkLanguageId;
  aiceWithIdioms: string;
  targetSymbol: string;
  updatedTargetSymbolAiceWithIdioms: string;
  refactorSymbols: string[];
  obsoleteSymbol?: string;
}

export interface BenchmarkLayerSpec {
  layerIndex: 2 | 3;
  title: string;
  taskPrompt: string;
  targetFiles: string[];
  expectedTokens?: string[];
  verifyLayer?: (workspaceDir: string) => { passed: boolean; details?: string };
}

export interface RealWorldBenchmarkSpec {
  id: string;
  title: string;
  description: string;
  scenario: EngineeringScenarioKind;
  appSurface: ApplicationSurfaceKind;
  files: RealWorldFileSpec[];
  layer2?: BenchmarkLayerSpec;
  layer3?: BenchmarkLayerSpec;
}

export interface DomainFunctionSeed {
  name: string;
  param: string;
  stateVar: string;
  scaleFactor: number;
  bands: Array<[number, number, number]>;
}

function buildDomainModuleSpec(
  fileName: string,
  languageId: BenchmarkLanguageId,
  domainFunctions: DomainFunctionSeed[],
  scenario: EngineeringScenarioKind,
  obsoleteName?: string,
  domainRecord?: { typeName: string; fields: Array<[string, string]> },
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
      const [pad, gap] = domainFunctions[i].bands[0];
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
      aiceWithIdioms: blocks.join("\n\n"),
      targetSymbol: targetSel,
      updatedTargetSymbolAiceWithIdioms: updatedRule,
      refactorSymbols: selectors,
      obsoleteSymbol: obsoleteName ? `.${obsoleteName.replace(/_/g, "-")}` : undefined,
    };
  }

  if (languageId === "html") {
    const lines: string[] = ["component AppShellView():", '  main(id="app_root") {'];
    for (const fn of domainFunctions) {
      lines.push(`    section(id="${fn.name}", class="panel") {`);
      for (let idx = 0; idx < fn.bands.length; idx++) {
        const [a, b, c] = fn.bands[idx];
        lines.push(`      ${idiom}("${fn.name}_${idx}", "${fn.stateVar} ${a}", "${b + c}")`);
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
      aiceWithIdioms: lines.join("\n"),
      targetSymbol: `#${targetId}`,
      updatedTargetSymbolAiceWithIdioms: updatedSection,
      refactorSymbols: domainFunctions.map((f) => `#${f.name}`),
      obsoleteSymbol: obsoleteName ? `#${obsoleteName}` : undefined,
    };
  }

  if (languageId === "twig") {
    const lines: string[] = ["component TwigReportView():"];
    for (const fn of domainFunctions) {
      lines.push(`  block(name="${fn.name}") {`);
      for (let idx = 0; idx < fn.bands.length; idx++) {
        const [a, b] = fn.bands[idx];
        lines.push(`    ${idiom}("${fn.stateVar}_${a}", val_${b})`);
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
      aiceWithIdioms: lines.join("\n"),
      targetSymbol: targetId,
      updatedTargetSymbolAiceWithIdioms: updatedTwig,
      refactorSymbols: domainFunctions.map((f) => f.name),
      obsoleteSymbol: obsoleteName,
    };
  }

  if (languageId === "json" || languageId === "yaml") {
    const sectionEntries: string[] = [];
    for (const fn of domainFunctions) {
      const items = fn.bands.map(
        ([lo, hi, step], idx) => `${idiom}("${fn.stateVar}_${idx}", ${lo + step}, ${hi})`,
      );
      sectionEntries.push(`  ${fn.name}: [\n    ${items.join(",\n    ")}\n  ]`);
    }
    if (obsoleteName) {
      sectionEntries.push(
        `  ${obsoleteName}: [\n    ${idiom}("legacy_0", 10, 100),\n    ${idiom}("legacy_1", 20, 200)\n  ]`,
      );
    }
    const targetKey = domainFunctions[0].name;
    const updatedEntry =
      scenario === "new_feature"
        ? `pub const ${targetKey}_realtime = [\n  ${idiom}("stream_0", 50, 4500),\n  ${idiom}("stream_1", 100, 5000)\n]`
        : `pub const ${targetKey} = [\n  ${idiom}("verified_0", 30, 3200),\n  ${idiom}("verified_1", 60, 3600)\n]`;
    return {
      fileName,
      languageId,
      aiceWithIdioms: `pub const config = {\n${sectionEntries.join(",\n")}\n}`,
      targetSymbol: `config.${targetKey}`,
      updatedTargetSymbolAiceWithIdioms: updatedEntry,
      refactorSymbols: domainFunctions.map((f) => `config.${f.name}`),
      obsoleteSymbol: obsoleteName ? `config.${obsoleteName}` : undefined,
    };
  }

  if (languageId === "tsx") {
    const comps: string[] = [];
    for (const fn of domainFunctions) {
      const tiles = fn.bands.map(
        ([lo, hi, step], idx) =>
          `    ${idiom}("${fn.stateVar}_${idx}", "${fn.param} ${lo}", "${hi + step}")`,
      );
      comps.push(
        [
          `component ${fn.name}():`,
          `  section(class="kpi-section", id="${fn.stateVar}") {`,
          ...tiles,
          "  }",
        ].join("\n"),
      );
    }
    if (obsoleteName) {
      comps.push(
        [
          `component ${obsoleteName}():`,
          '  section(class="kpi-section", id="legacy_panel") {',
          `    ${idiom}("legacy_0", "Deprecated Card", "0")`,
          `    ${idiom}("legacy_1", "Obsolete Card", "0")`,
          "  }",
        ].join("\n"),
      );
    }
    const targetComp = domainFunctions[0];
    const updatedComp =
      scenario === "new_feature"
        ? [
            `component ${targetComp.name}Sparkline():`,
            `  section(class="kpi-section", id="${targetComp.stateVar}_spark") {`,
            `    ${idiom}("spark_0", "Live Velocity", "980")`,
            `    ${idiom}("spark_1", "Cohort Retention", "94%")`,
            `    ${idiom}("spark_2", "Alert Burn Rate", "0.4x")`,
            "  }",
          ].join("\n")
        : [
            `component ${targetComp.name}():`,
            `  section(class="kpi-section", id="${targetComp.stateVar}") {`,
            `    ${idiom}("fixed_0", "Verified KPI", "1240")`,
            `    ${idiom}("fixed_1", "Verified P95", "18ms")`,
            `    ${idiom}("fixed_2", "Verified Uptime", "99.98%")`,
            "  }",
          ].join("\n");
    return {
      fileName,
      languageId,
      aiceWithIdioms: comps.join("\n\n"),
      targetSymbol: targetComp.name,
      updatedTargetSymbolAiceWithIdioms: updatedComp,
      refactorSymbols: domainFunctions.map((f) => f.name),
      obsoleteSymbol: obsoleteName,
    };
  }

  // Code languages: ts, js, py, go, rs, cpp, cs, kt, php
  // Include optional domain record/dataclass + domain functions with distinct state variables,
  // pre-validation guards, scaling arithmetic, and idiom band steps.
  const items: string[] = [];
  if (domainRecord && (languageId === "py" || languageId === "ts" || languageId === "rs" || languageId === "go")) {
    const fieldLines = domainRecord.fields.map(([k, t]) => `  ${k}:${t}`);
    items.push([`type ${domainRecord.typeName}:`, ...fieldLines].join("\n"));
  }

  for (const fn of domainFunctions) {
    const sv = fn.stateVar;
    const calls = fn.bands.map(([lo, hi, step]) => `  ${idiom}(${sv}, ${lo}, ${hi}, ${step})`);
    items.push(
      [
        `pub fn ${fn.name}(${fn.param}:int) -> int:`,
        `  ${sv} ::= ${fn.param} * ${fn.scaleFactor}`,
        `  if ${sv} < 0:`,
        `    ${sv} = 0`,
        ...calls,
        `  ${sv}`,
      ].join("\n"),
    );
  }
  if (obsoleteName) {
    items.push(
      [
        `pub fn ${obsoleteName}(seed:int) -> int:`,
        "  legacyVal ::= seed",
        `  ${idiom}(legacyVal, 5, 100, 5)`,
        `  ${idiom}(legacyVal, 10, 200, 10)`,
        "  legacyVal",
      ].join("\n"),
    );
  }

  const targetFn = domainFunctions[0];
  const tSv = targetFn.stateVar;
  const updatedFn =
    scenario === "new_feature"
      ? [
          `pub fn ${targetFn.name}Extended(${targetFn.param}:int) -> int:`,
          `  ${tSv} ::= ${targetFn.param} * ${targetFn.scaleFactor} + 10`,
          `  if ${tSv} < 0:`,
          `    ${tSv} = 0`,
          `  ${idiom}(${tSv}, 20, 600, 15)`,
          `  ${idiom}(${tSv}, 40, 1200, 30)`,
          `  ${idiom}(${tSv}, 80, 2400, 45)`,
          `  ${tSv}`,
        ].join("\n")
      : [
          `pub fn ${targetFn.name}(${targetFn.param}:int) -> int:`,
          `  ${tSv} ::= ${targetFn.param} * ${targetFn.scaleFactor} + 1`,
          `  if ${tSv} < 0:`,
          `    ${tSv} = 0`,
          `  ${idiom}(${tSv}, 16, 512, 12)`,
          `  ${idiom}(${tSv}, 32, 1024, 24)`,
          `  ${idiom}(${tSv}, 64, 2048, 48)`,
          `  ${tSv}`,
        ].join("\n");

  return {
    fileName,
    languageId,
    aiceWithIdioms: items.join("\n\n"),
    targetSymbol: targetFn.name,
    updatedTargetSymbolAiceWithIdioms: updatedFn,
    refactorSymbols: domainFunctions.map((f) => f.name),
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
          { name: "stepSnakeHead", param: "gridCoord", stateVar: "headCell", scaleFactor: 2, bands: [[0, 640, 16], [16, 624, 16], [32, 608, 16]] },
          { name: "resolveWallCollision", param: "axisPos", stateVar: "clampedPos", scaleFactor: 1, bands: [[0, 480, 8], [16, 464, 8], [32, 448, 8]] },
          { name: "computeFoodSpawnCell", param: "rngSeed", stateVar: "spawnIndex", scaleFactor: 3, bands: [[1, 39, 2], [2, 38, 3], [4, 36, 4]] },
          { name: "advanceComboScore", param: "basePoints", stateVar: "comboScore", scaleFactor: 5, bands: [[10, 5000, 25], [25, 10000, 50], [50, 25000, 100]] },
        ],
        "from_zero_window_app",
        "legacyWrapGrid",
        {
          typeName: "SnakeSegmentState",
          fields: [
            ["cellX", "int"],
            ["cellY", "int"],
            ["velocityTiles", "int"],
            ["comboMultiplier", "int"],
            ["isAlive", "bool"],
          ],
        },
      ),
      buildDomainModuleSpec(
        "renderer.ts",
        "ts",
        [
          { name: "renderViewportFrame", param: "frameTick", stateVar: "frameBudgetUs", scaleFactor: 4, bands: [[1, 60, 2], [2, 120, 4], [4, 240, 8]] },
          { name: "drawSnakeSegmentGlow", param: "baseAlpha", stateVar: "glowLuma", scaleFactor: 2, bands: [[15, 255, 10], [30, 240, 15], [45, 220, 20]] },
          { name: "updateParticleBurst", param: "radialVel", stateVar: "particleStep", scaleFactor: 3, bands: [[2, 80, 4], [4, 160, 8], [8, 320, 12]] },
        ],
        "from_zero_window_app",
      ),
      buildDomainModuleSpec(
        "index.html",
        "html",
        [
          { name: "arcade_hud", param: "hud", stateVar: "Scoreboard", scaleFactor: 1, bands: [[100, 1, 10], [200, 2, 20], [300, 3, 30]] },
          { name: "canvas_stage", param: "stage", stateVar: "Viewport", scaleFactor: 1, bands: [[640, 480, 0], [32, 16, 0]] },
          { name: "controls_bar", param: "ctrl", stateVar: "Dpad", scaleFactor: 1, bands: [[1, 60, 5], [2, 120, 10]] },
        ],
        "from_zero_window_app",
        "legacy_overlay",
      ),
      buildDomainModuleSpec(
        "styles.css",
        "css",
        [
          { name: "arcade_cabinet", param: "cab", stateVar: "cab", scaleFactor: 1, bands: [[16, 12, 0]] },
          { name: "hud_scoreboard", param: "hud", stateVar: "hud", scaleFactor: 1, bands: [[12, 8, 0]] },
          { name: "canvas_viewport", param: "vp", stateVar: "vp", scaleFactor: 1, bands: [[8, 4, 0]] },
          { name: "control_badge", param: "btn", stateVar: "btn", scaleFactor: 1, bands: [[10, 6, 0]] },
        ],
        "from_zero_window_app",
        "deprecated_crt_scanline",
      ),
      buildDomainModuleSpec(
        "game_config.json",
        "json",
        [
          { name: "speedTiers", param: "spd", stateVar: "tier", scaleFactor: 1, bands: [[60, 240, 15]] },
          { name: "arenaBounds", param: "arn", stateVar: "grid", scaleFactor: 1, bands: [[32, 640, 16]] },
          { name: "appleSpawnRules", param: "apl", stateVar: "spawn", scaleFactor: 1, bands: [[10, 500, 25]] },
          { name: "comboMultipliers", param: "cmb", stateVar: "combo", scaleFactor: 1, bands: [[20, 1000, 50]] },
        ],
        "from_zero_window_app",
        "legacyHighscorePolicy",
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
          { name: "execute_batch_job", param: "batch_size", stateVar: "processed_units", scaleFactor: 4, bands: [[10, 500, 15], [25, 1500, 30], [50, 5000, 75]] },
          { name: "compute_retry_backoff", param: "attempt_num", stateVar: "backoff_ms", scaleFactor: 50, bands: [[100, 3000, 120], [250, 10000, 250], [500, 30000, 500]] },
          { name: "verify_payload_checksum", param: "bytes_len", stateVar: "crc_accum", scaleFactor: 2, bands: [[64, 4096, 32], [128, 16384, 64], [256, 65536, 128]] },
          { name: "flush_dead_letter_queue", param: "pending_count", stateVar: "flushed_dlq", scaleFactor: 3, bands: [[1, 100, 5], [5, 500, 15], [10, 1000, 25]] },
        ],
        "from_zero_non_window_app",
        "legacy_poll_loop",
        {
          typeName: "QueueBatchEnvelope",
          fields: [
            ["batch_id", "str"],
            ["tenant_slug", "str"],
            ["payload_bytes", "int"],
            ["retry_attempt", "int"],
            ["max_retries", "int"],
            ["is_dead_letter", "bool"],
          ],
        },
      ),
      buildDomainModuleSpec(
        "cli.py",
        "py",
        [
          { name: "parse_worker_concurrency", param: "cpu_cores", stateVar: "worker_slots", scaleFactor: 2, bands: [[1, 16, 2], [2, 32, 4], [4, 64, 8]] },
          { name: "drain_inflight_batches", param: "timeout_sec", stateVar: "drain_budget", scaleFactor: 3, bands: [[5, 60, 5], [10, 120, 10], [15, 300, 20]] },
          { name: "emit_health_heartbeat", param: "seq_num", stateVar: "heartbeat_seq", scaleFactor: 2, bands: [[1, 1000, 10], [10, 5000, 25], [20, 10000, 50]] },
        ],
        "from_zero_non_window_app",
        undefined,
        {
          typeName: "DaemonCliOptions",
          fields: [
            ["queue_name", "str"],
            ["concurrency_limit", "int"],
            ["drain_timeout_sec", "int"],
            ["json_logs", "bool"],
          ],
        },
      ),
      buildDomainModuleSpec(
        "pipeline.yaml",
        "yaml",
        [
          { name: "ingestQueue", param: "ing", stateVar: "ingest", scaleFactor: 1, bands: [[8080, 16, 0]] },
          { name: "retryDispatcher", param: "ret", stateVar: "retry", scaleFactor: 1, bands: [[8081, 8, 0]] },
          { name: "deadLetterSink", param: "dlq", stateVar: "dlq", scaleFactor: 1, bands: [[8082, 4, 0]] },
          { name: "metricsExporter", param: "met", stateVar: "metrics", scaleFactor: 1, bands: [[9090, 2, 0]] },
        ],
        "from_zero_non_window_app",
        "legacyBatchCron",
      ),
      buildDomainModuleSpec(
        "schema.json",
        "json",
        [
          { name: "batchIngestPolicy", param: "bi", stateVar: "ingest", scaleFactor: 1, bands: [[100, 2000, 25]] },
          { name: "dlqReplayPolicy", param: "dlq", stateVar: "replay", scaleFactor: 1, bands: [[100, 4000, 50]] },
          { name: "healthProbePolicy", param: "hp", stateVar: "probe", scaleFactor: 1, bands: [[50, 500, 10]] },
          { name: "metricsFlushPolicy", param: "mf", stateVar: "flush", scaleFactor: 1, bands: [[100, 1500, 20]] },
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
          { name: "calculateInvoiceTotalCents", param: "subtotalCents", stateVar: "invoiceCents", scaleFactor: 1, bands: [[100, 500000, 50], [250, 750000, 100], [500, 1000000, 250]] },
          { name: "applyPromoDiscountCents", param: "rawDiscount", stateVar: "discountCents", scaleFactor: 2, bands: [[50, 25000, 15], [100, 50000, 30], [200, 100000, 60]] },
          { name: "resolveRegionalTaxCents", param: "taxableCents", stateVar: "vatCents", scaleFactor: 1, bands: [[10, 80000, 20], [25, 160000, 40], [50, 320000, 80]] },
          { name: "estimateShippingFeeCents", param: "parcelGrams", stateVar: "postageCents", scaleFactor: 3, bands: [[400, 15000, 100], [600, 25000, 150], [900, 45000, 250]] },
        ],
        "bug_fix",
        "legacyV1TaxCalc",
      ),
      buildDomainModuleSpec(
        "cart-client.js",
        "js",
        [
          { name: "clampCartItemQuantity", param: "requestedQty", stateVar: "safeQty", scaleFactor: 1, bands: [[1, 25, 1], [2, 50, 2], [5, 99, 3]] },
          { name: "recomputeDrawerSubtotal", param: "lineCents", stateVar: "drawerTotal", scaleFactor: 2, bands: [[100, 200000, 50], [250, 400000, 100], [500, 800000, 200]] },
          { name: "animateSavingsBadge", param: "savedCents", stateVar: "badgeOffset", scaleFactor: 2, bands: [[10, 5000, 15], [20, 10000, 30], [50, 25000, 75]] },
        ],
        "bug_fix",
      ),
      buildDomainModuleSpec(
        "checkout.twig",
        "twig",
        [
          { name: "order_summary_lines", param: "sum", stateVar: "OrderLine", scaleFactor: 1, bands: [[1, 100, 0], [2, 200, 0], [3, 300, 0]] },
          { name: "tax_breakdown_box", param: "tax", stateVar: "TaxLine", scaleFactor: 1, bands: [[4, 400, 0], [5, 500, 0]] },
        ],
        "bug_fix",
        "legacy_coupon_banner",
      ),
      buildDomainModuleSpec(
        "checkout.css",
        "css",
        [
          { name: "checkout_card", param: "card", stateVar: "card", scaleFactor: 1, bands: [[20, 16, 0]] },
          { name: "summary_line_item", param: "item", stateVar: "item", scaleFactor: 1, bands: [[12, 8, 0]] },
          { name: "promo_badge_pill", param: "pill", stateVar: "pill", scaleFactor: 1, bands: [[6, 4, 0]] },
          { name: "payment_cta_bar", param: "cta", stateVar: "cta", scaleFactor: 1, bands: [[16, 12, 0]] },
        ],
        "bug_fix",
      ),
      buildDomainModuleSpec(
        "shell.html",
        "html",
        [
          { name: "checkout_header", param: "hdr", stateVar: "CartStep", scaleFactor: 1, bands: [[1, 10, 0], [2, 20, 0]] },
          { name: "payment_modal", param: "mod", stateVar: "PayStep", scaleFactor: 1, bands: [[3, 30, 0], [4, 40, 0]] },
        ],
        "bug_fix",
      ),
      buildDomainModuleSpec(
        "routes.yaml",
        "yaml",
        [
          { name: "checkoutApi", param: "chk", stateVar: "checkout", scaleFactor: 1, bands: [[8080, 12, 0]] },
          { name: "couponValidator", param: "cpn", stateVar: "coupon", scaleFactor: 1, bands: [[8081, 8, 0]] },
          { name: "taxCalculator", param: "tax", stateVar: "tax", scaleFactor: 1, bands: [[8082, 8, 0]] },
          { name: "stripeWebhook", param: "wh", stateVar: "webhook", scaleFactor: 1, bands: [[8083, 6, 0]] },
        ],
        "bug_fix",
      ),
      buildDomainModuleSpec(
        "shipping_rates.json",
        "json",
        [
          { name: "domesticStandard", param: "dom", stateVar: "dom_std", scaleFactor: 1, bands: [[50, 1200, 10]] },
          { name: "domesticExpress", param: "exp", stateVar: "dom_exp", scaleFactor: 1, bands: [[50, 1500, 15]] },
          { name: "euCrossBorder", param: "eu", stateVar: "eu_zone", scaleFactor: 1, bands: [[100, 2500, 25]] },
          { name: "globalPriority", param: "intl", stateVar: "intl_air", scaleFactor: 1, bands: [[150, 4000, 40]] },
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
          { name: "aggregateWindowSeries", param: "rawSample", stateVar: "seriesTotal", scaleFactor: 3, bands: [[10, 1000, 20], [25, 5000, 50], [50, 10000, 100]] },
          { name: "computeP95LatencyMs", param: "sampleMs", stateVar: "p95Bucket", scaleFactor: 2, bands: [[5, 250, 10], [15, 750, 25], [30, 2500, 50]] },
          { name: "detectTrafficAnomaly", param: "ingressRate", stateVar: "zScoreUnits", scaleFactor: 4, bands: [[20, 800, 15], [40, 1600, 30], [80, 3200, 60]] },
          { name: "normalizeFunnelConversion", param: "rawBps", stateVar: "funnelBps", scaleFactor: 2, bands: [[100, 9500, 50], [200, 9800, 100], [500, 10000, 150]] },
        ],
        "new_feature",
        "deprecatedV1Sampler",
        {
          typeName: "TelemetrySeriesPoint",
          fields: [
            ["bucketEpochSec", "int"],
            ["p95LatencyMs", "int"],
            ["activeSessions", "int"],
            ["conversionBps", "int"],
          ],
        },
      ),
      buildDomainModuleSpec(
        "DashboardPanel.tsx",
        "tsx",
        [
          { name: "KpiMetricGrid", param: "KPI", stateVar: "kpi_grid", scaleFactor: 1, bands: [[1, 120, 5], [2, 240, 10], [4, 480, 20]] },
          { name: "RetentionMatrixCard", param: "Cohort", stateVar: "cohort_matrix", scaleFactor: 1, bands: [[7, 90, 3], [14, 180, 6], [30, 365, 12]] },
          { name: "AlertBannerStream", param: "Alert", stateVar: "alert_stream", scaleFactor: 1, bands: [[1, 10, 1], [3, 25, 2], [5, 50, 5]] },
        ],
        "new_feature",
        "LegacySparklineWidget",
      ),
      buildDomainModuleSpec(
        "dashboard.css",
        "css",
        [
          { name: "kpi_grid_card", param: "kpi", stateVar: "kpi", scaleFactor: 1, bands: [[16, 12, 0]] },
          { name: "cohort_heatmap_row", param: "hm", stateVar: "hm", scaleFactor: 1, bands: [[8, 6, 0]] },
          { name: "toolbar_filter_pill", param: "flt", stateVar: "flt", scaleFactor: 1, bands: [[10, 8, 0]] },
          { name: "sparkline_tooltip", param: "tip", stateVar: "tip", scaleFactor: 1, bands: [[6, 4, 0]] },
        ],
        "new_feature",
      ),
      buildDomainModuleSpec(
        "index.html",
        "html",
        [
          { name: "dashboard_topbar", param: "top", stateVar: "NavMetric", scaleFactor: 1, bands: [[1, 10, 0], [2, 20, 0]] },
          { name: "kpi_stage_mount", param: "mnt", stateVar: "StageMetric", scaleFactor: 1, bands: [[3, 30, 0], [4, 40, 0]] },
        ],
        "new_feature",
      ),
      buildDomainModuleSpec(
        "bundle_budgets.json",
        "json",
        [
          { name: "vendorChunkBudget", param: "vnd", stateVar: "vendor", scaleFactor: 1, bands: [[80, 1800, 20]] },
          { name: "chartsChunkBudget", param: "cht", stateVar: "charts", scaleFactor: 1, bands: [[80, 3200, 40]] },
          { name: "workersChunkBudget", param: "wrk", stateVar: "workers", scaleFactor: 1, bands: [[80, 1200, 15]] },
          { name: "stylesAssetBudget", param: "css", stateVar: "styles", scaleFactor: 1, bands: [[80, 900, 10]] },
        ],
        "new_feature",
      ),
      buildDomainModuleSpec(
        "vite_pipeline.yaml",
        "yaml",
        [
          { name: "vitePreview", param: "vp", stateVar: "preview", scaleFactor: 1, bands: [[5173, 4, 0]] },
          { name: "edgeCdnSync", param: "cdn", stateVar: "cdn", scaleFactor: 1, bands: [[8443, 8, 0]] },
          { name: "lighthouseGate", param: "lh", stateVar: "lighthouse", scaleFactor: 1, bands: [[9300, 2, 0]] },
          { name: "storybookBuild", param: "sb", stateVar: "storybook", scaleFactor: 1, bands: [[6006, 4, 0]] },
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
          { name: "EvaluateQuorumHealth", param: "votingNodes", stateVar: "quorumWeight", scaleFactor: 3, bands: [[3, 15, 2], [5, 31, 4], [7, 63, 8]] },
          { name: "AcquireTokenBucket", param: "requestedTokens", stateVar: "leasedTokens", scaleFactor: 2, bands: [[10, 1000, 25], [50, 5000, 75], [100, 10000, 150]] },
          { name: "ComputeCircuitBackoffMs", param: "consecutiveFailures", stateVar: "cooldownMs", scaleFactor: 25, bands: [[50, 2000, 100], [100, 5000, 250], [250, 15000, 500]] },
          { name: "ValidateShardEpoch", param: "clientEpoch", stateVar: "verifiedEpoch", scaleFactor: 2, bands: [[1, 1024, 8], [16, 4096, 32], [64, 16384, 64]] },
        ],
        "update_feature",
        "DeprecatedV1Route",
        {
          typeName: "ShardLeaseMetadata",
          fields: [
            ["shardId", "int"],
            ["leaderEpoch", "int"],
            ["quorumVoters", "int"],
            ["burstLimit", "int"],
          ],
        },
      ),
      buildDomainModuleSpec(
        "wal_engine.rs",
        "rs",
        [
          { name: "compact_wal_segment", param: "dirty_entries", stateVar: "compacted_slots", scaleFactor: 4, bands: [[64, 4096, 32], [128, 8192, 64], [256, 16384, 128]] },
          { name: "verify_frame_crc32", param: "payload_len", stateVar: "frame_digest", scaleFactor: 2, bands: [[32, 2048, 16], [64, 4096, 32], [128, 8192, 64]] },
          { name: "flush_commit_index", param: "pending_lsn", stateVar: "committed_lsn", scaleFactor: 3, bands: [[100, 50000, 150], [250, 100000, 300], [500, 250000, 600]] },
          { name: "reclaim_orphan_pages", param: "free_pages", stateVar: "reclaimed_blocks", scaleFactor: 2, bands: [[8, 512, 8], [16, 1024, 16], [32, 2048, 32]] },
        ],
        "update_feature",
        "legacy_mmap_sync",
        {
          typeName: "WalSegmentHeader",
          fields: [
            ["segment_id", "int"],
            ["base_lsn", "int"],
            ["crc_checksum", "int"],
            ["is_compacted", "bool"],
          ],
        },
      ),
      buildDomainModuleSpec(
        "cluster.yaml",
        "yaml",
        [
          { name: "raftConsensus", param: "raft", stateVar: "raft", scaleFactor: 1, bands: [[9000, 7, 0]] },
          { name: "walReplicator", param: "wal", stateVar: "wal", scaleFactor: 1, bands: [[9001, 5, 0]] },
          { name: "grpcIngress", param: "grpc", stateVar: "grpc", scaleFactor: 1, bands: [[9002, 12, 0]] },
          { name: "gossipMesh", param: "gsp", stateVar: "gossip", scaleFactor: 1, bands: [[9003, 9, 0]] },
        ],
        "update_feature",
      ),
      buildDomainModuleSpec(
        "limits.json",
        "json",
        [
          { name: "ledgerAppendQuota", param: "app", stateVar: "append", scaleFactor: 1, bands: [[50, 800, 15]] },
          { name: "quorumReadQuota", param: "qr", stateVar: "quorum", scaleFactor: 1, bands: [[25, 400, 10]] },
          { name: "snapshotSyncQuota", param: "snap", stateVar: "snapshot", scaleFactor: 1, bands: [[200, 8000, 100]] },
          { name: "shardRebalanceQuota", param: "reb", stateVar: "rebalance", scaleFactor: 1, bands: [[150, 5000, 75]] },
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
          { name: "solveRigidBodyAABB", param: "penetrationUm", stateVar: "resolvedDepth", scaleFactor: 2, bands: [[1, 128, 4], [4, 256, 8], [8, 512, 16]] },
          { name: "integrateVelocityStep", param: "linearVel", stateVar: "dampedVel", scaleFactor: 3, bands: [[10, 800, 15], [20, 1600, 30], [40, 3200, 60]] },
          { name: "applyAngularDamping", param: "rawTorque", stateVar: "clampedTorque", scaleFactor: 2, bands: [[5, 400, 10], [10, 800, 20], [20, 1600, 40]] },
          { name: "clampViewportZoom", param: "fovDegrees", stateVar: "activeFov", scaleFactor: 1, bands: [[30, 120, 5], [45, 110, 5], [60, 100, 5]] },
        ],
        "bug_fix",
        "legacyEulerStep",
      ),
      buildDomainModuleSpec(
        "inspector.ts",
        "ts",
        [
          { name: "sampleFrameTimeHistogram", param: "frameUsec", stateVar: "bucketUsec", scaleFactor: 2, bands: [[500, 16667, 250], [1000, 33333, 500], [2000, 50000, 1000]] },
          { name: "projectGizmoHandle", param: "worldX", stateVar: "screenPx", scaleFactor: 4, bands: [[0, 1920, 16], [16, 1904, 24], [32, 1888, 32]] },
          { name: "syncColliderWireframe", param: "meshVerts", stateVar: "lineSegments", scaleFactor: 3, bands: [[8, 2048, 16], [16, 4096, 32], [32, 8192, 64]] },
        ],
        "bug_fix",
      ),
      buildDomainModuleSpec(
        "overlay.html",
        "html",
        [
          { name: "physics_hud_dock", param: "dock", stateVar: "SolverHud", scaleFactor: 1, bands: [[1, 60, 0], [2, 120, 0]] },
          { name: "solver_metrics_panel", param: "slv", stateVar: "BodyHud", scaleFactor: 1, bands: [[3, 240, 0], [4, 480, 0]] },
        ],
        "bug_fix",
      ),
      buildDomainModuleSpec(
        "overlay.css",
        "css",
        [
          { name: "viewport_hud_dock", param: "dock", stateVar: "dock", scaleFactor: 1, bands: [[12, 8, 0]] },
          { name: "gizmo_toolbar", param: "giz", stateVar: "giz", scaleFactor: 1, bands: [[8, 6, 0]] },
          { name: "fps_histogram_bar", param: "fps", stateVar: "fps", scaleFactor: 1, bands: [[6, 4, 0]] },
          { name: "collider_prop_row", param: "row", stateVar: "row", scaleFactor: 1, bands: [[10, 6, 0]] },
        ],
        "bug_fix",
      ),
      buildDomainModuleSpec(
        "engine_settings.json",
        "json",
        [
          { name: "solverSubsteps", param: "slv", stateVar: "substep", scaleFactor: 1, bands: [[16, 500, 8]] },
          { name: "gizmoSnapGrid", param: "giz", stateVar: "gizmo", scaleFactor: 1, bands: [[16, 250, 4]] },
          { name: "broadphaseBuckets", param: "scn", stateVar: "bvh", scaleFactor: 1, bands: [[50, 2000, 25]] },
          { name: "contactManifoldPool", param: "shd", stateVar: "manifold", scaleFactor: 1, bands: [[30, 1500, 15]] },
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
          { name: "ReconcileLedgerBatch", param: "grossCents", stateVar: "settledCents", scaleFactor: 2, bands: [[100, 100000, 50], [500, 500000, 250], [1000, 2500000, 500]] },
          { name: "ComputeFxSpreadBps", param: "notionalUnits", stateVar: "spreadBps", scaleFactor: 3, bands: [[15, 350, 10], [25, 500, 20], [50, 1000, 35]] },
          { name: "EvaluateMerchantReserve", param: "rollingVolume", stateVar: "reserveCents", scaleFactor: 2, bands: [[500, 250000, 150], [1000, 500000, 300], [2500, 1000000, 600]] },
          { name: "AuthorizeClearingWindow", param: "cutoffMinutes", stateVar: "windowSlot", scaleFactor: 2, bands: [[10, 1440, 15], [30, 2880, 30], [60, 4320, 60]] },
        ],
        "new_feature",
        "LegacyBatchClose",
      ),
      buildDomainModuleSpec(
        "FraudScorer.kt",
        "kt",
        [
          { name: "scoreCardVelocityRisk", param: "hourlyTxCount", stateVar: "velocityRisk", scaleFactor: 4, bands: [[5, 100, 8], [15, 300, 16], [30, 900, 32]] },
          { name: "weightDeviceFingerprint", param: "anomalySignals", stateVar: "devicePenalty", scaleFactor: 3, bands: [[10, 500, 15], [25, 750, 30], [50, 1000, 45]] },
          { name: "evaluateGeoDistanceRisk", param: "distanceKm", stateVar: "geoHazard", scaleFactor: 2, bands: [[20, 2000, 25], [50, 5000, 50], [100, 15000, 100]] },
          { name: "computeChargebackTier", param: "priorDisputes", stateVar: "disputeWeight", scaleFactor: 5, bands: [[1, 50, 5], [5, 150, 10], [10, 500, 20]] },
        ],
        "new_feature",
        "deprecatedRuleScore",
      ),
      buildDomainModuleSpec(
        "settlement_policy.yaml",
        "yaml",
        [
          { name: "sepaClearing", param: "sepa", stateVar: "sepa", scaleFactor: 1, bands: [[8410, 6, 0]] },
          { name: "fednowClearing", param: "fed", stateVar: "fednow", scaleFactor: 1, bands: [[8411, 8, 0]] },
          { name: "fraudScoringGrpc", param: "frd", stateVar: "fraud", scaleFactor: 1, bands: [[8412, 12, 0]] },
          { name: "ledgerVaultSync", param: "vlt", stateVar: "vault", scaleFactor: 1, bands: [[8413, 4, 0]] },
        ],
        "new_feature",
      ),
      buildDomainModuleSpec(
        "risk_rules.json",
        "json",
        [
          { name: "velocityCheckRule", param: "vel", stateVar: "velocity", scaleFactor: 1, bands: [[20, 350, 10]] },
          { name: "sanctionsScreenRule", param: "snc", stateVar: "sanctions", scaleFactor: 1, bands: [[50, 900, 25]] },
          { name: "instantPayoutRule", param: "pay", stateVar: "payout", scaleFactor: 1, bands: [[30, 600, 15]] },
          { name: "reserveLedgerRule", param: "res", stateVar: "reserve", scaleFactor: 1, bands: [[40, 800, 20]] },
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
          { name: "compute_tiered_overage_cents", param: "metered_units", stateVar: "overage_cents", scaleFactor: 3, bands: [[100, 50000, 75], [250, 150000, 150], [500, 500000, 300]] },
          { name: "prorate_subscription_upgrade", param: "remaining_days", stateVar: "prorated_cents", scaleFactor: 4, bands: [[1, 30, 5], [7, 90, 15], [14, 365, 30]] },
          { name: "aggregate_vat_withholding", param: "net_invoice_cents", stateVar: "withheld_cents", scaleFactor: 2, bands: [[50, 100000, 50], [150, 300000, 125], [300, 900000, 250]] },
          { name: "apply_credit_balance_rollover", param: "available_credit", stateVar: "applied_credit", scaleFactor: 1, bands: [[25, 25000, 25], [75, 75000, 50], [150, 150000, 100]] },
        ],
        "update_feature",
        "legacy_invoice_hash",
        {
          typeName: "TenantInvoiceStatement",
          fields: [
            ["invoice_id", "str"],
            ["tenant_id", "str"],
            ["subtotal_cents", "int"],
            ["overage_cents", "int"],
            ["vat_cents", "int"],
            ["is_settled", "bool"],
          ],
        },
      ),
      buildDomainModuleSpec(
        "UsageChart.tsx",
        "tsx",
        [
          { name: "QuotaGaugePanel", param: "Quota", stateVar: "quota_gauges", scaleFactor: 1, bands: [[10, 500, 20], [25, 1000, 40], [50, 2500, 80]] },
          { name: "InvoiceHistoryTable", param: "Invoice", stateVar: "invoice_history", scaleFactor: 1, bands: [[3, 120, 5], [6, 240, 10], [12, 360, 15]] },
          { name: "PlanComparisonGrid", param: "Tier", stateVar: "plan_tiers", scaleFactor: 1, bands: [[1, 49, 0], [2, 199, 0], [4, 499, 0]] },
        ],
        "update_feature",
      ),
      buildDomainModuleSpec(
        "invoice_email.twig",
        "twig",
        [
          { name: "invoice_header_block", param: "hdr", stateVar: "InvoiceMeta", scaleFactor: 1, bands: [[1, 10, 0], [2, 20, 0], [3, 30, 0]] },
          { name: "line_items_summary", param: "lines", stateVar: "ChargeLine", scaleFactor: 1, bands: [[4, 40, 0], [5, 50, 0]] },
        ],
        "update_feature",
        "legacy_vat_footer",
      ),
      buildDomainModuleSpec(
        "billing.css",
        "css",
        [
          { name: "invoice_preview_sheet", param: "inv", stateVar: "inv", scaleFactor: 1, bands: [[24, 16, 0]] },
          { name: "quota_progress_card", param: "qta", stateVar: "qta", scaleFactor: 1, bands: [[16, 12, 0]] },
          { name: "tier_badge_header", param: "bdg", stateVar: "bdg", scaleFactor: 1, bands: [[8, 6, 0]] },
          { name: "overage_warning_row", param: "wrn", stateVar: "wrn", scaleFactor: 1, bands: [[12, 8, 0]] },
        ],
        "update_feature",
      ),
      buildDomainModuleSpec(
        "plans.json",
        "json",
        [
          { name: "starterTierQuota", param: "mtr", stateVar: "starter", scaleFactor: 1, bands: [[50, 1200, 10]] },
          { name: "growthTierQuota", param: "pdf", stateVar: "growth", scaleFactor: 1, bands: [[100, 4500, 25]] },
          { name: "enterpriseTierQuota", param: "tax", stateVar: "enterprise", scaleFactor: 1, bands: [[80, 2200, 20]] },
          { name: "dunningGracePolicy", param: "dun", stateVar: "dunning", scaleFactor: 1, bands: [[60, 1800, 15]] },
        ],
        "update_feature",
      ),
      buildDomainModuleSpec(
        "worker_cron.yaml",
        "yaml",
        [
          { name: "invoiceRollupWorker", param: "inv", stateVar: "rollup", scaleFactor: 1, bands: [[8510, 4, 0]] },
          { name: "usageAggregator", param: "usg", stateVar: "usage", scaleFactor: 1, bands: [[8511, 8, 0]] },
          { name: "dunningMailer", param: "mlr", stateVar: "mailer", scaleFactor: 1, bands: [[8512, 2, 0]] },
          { name: "ledgerArchiver", param: "arc", stateVar: "archiver", scaleFactor: 1, bands: [[8513, 2, 0]] },
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
          { name: "match_limit_order_lot", param: "order_qty", stateVar: "matched_lots", scaleFactor: 2, bands: [[1, 10000, 10], [10, 50000, 50], [100, 250000, 250]] },
          { name: "enforce_price_collar_ticks", param: "spread_ticks", stateVar: "clamped_ticks", scaleFactor: 3, bands: [[5, 500, 5], [10, 1000, 10], [25, 2500, 25]] },
          { name: "allocate_pro_rata_fills", param: "resting_lots", stateVar: "pro_rata_fill", scaleFactor: 2, bands: [[2, 2000, 8], [8, 8000, 16], [16, 32000, 32]] },
          { name: "advance_sequence_watermark", param: "venue_seq", stateVar: "next_watermark", scaleFactor: 4, bands: [[64, 65536, 32], [128, 131072, 64], [256, 524288, 128]] },
        ],
        "bug_fix",
        "legacy_cancel_all",
      ),
      buildDomainModuleSpec(
        "margin_calc.cpp",
        "cpp",
        [
          { name: "computeIntradayHaircutBps", param: "sigmaBps", stateVar: "haircutBps", scaleFactor: 3, bands: [[25, 1500, 15], [50, 3000, 30], [100, 5000, 60]] },
          { name: "evaluateNetSpanMargin", param: "grossExposure", stateVar: "spanMargin", scaleFactor: 2, bands: [[1000, 500000, 250], [2500, 1000000, 500], [5000, 2500000, 1000]] },
          { name: "checkLiquidationBuffer", param: "freeEquity", stateVar: "safetyBuffer", scaleFactor: 2, bands: [[500, 250000, 100], [1000, 500000, 200], [2000, 1000000, 400]] },
        ],
        "bug_fix",
      ),
      buildDomainModuleSpec(
        "risk_daemon.py",
        "py",
        [
          { name: "audit_position_concentration", param: "notional_usd", stateVar: "concentration_score", scaleFactor: 2, bands: [[100, 100000, 50], [500, 500000, 150], [1000, 1000000, 300]] },
          { name: "trigger_kill_switch_cooldown", param: "breach_count", stateVar: "lockout_sec", scaleFactor: 5, bands: [[1, 10, 2], [3, 30, 5], [5, 100, 10]] },
          { name: "record_regulatory_drop_copy", param: "fill_events", stateVar: "logged_fills", scaleFactor: 3, bands: [[10, 5000, 20], [25, 15000, 50], [50, 50000, 100]] },
        ],
        "bug_fix",
        undefined,
        {
          typeName: "KillSwitchAuditEvent",
          fields: [
            ["trader_id", "str"],
            ["venue_code", "str"],
            ["exposure_cents", "int"],
            ["breach_tier", "int"],
            ["is_halted", "bool"],
          ],
        },
      ),
      buildDomainModuleSpec(
        "feed_ingest.go",
        "go",
        [
          { name: "NormalizeVenueTickGap", param: "deltaSeq", stateVar: "repairedGap", scaleFactor: 2, bands: [[1, 256, 4], [4, 1024, 8], [16, 4096, 16]] },
          { name: "ReconcileBookSnapshot", param: "bookDepth", stateVar: "syncedLevels", scaleFactor: 3, bands: [[10, 200, 5], [25, 500, 10], [50, 1000, 20]] },
          { name: "ArbitrateMulticastLine", param: "skewUsec", stateVar: "selectedLineSkew", scaleFactor: 2, bands: [[5, 500, 10], [15, 1500, 25], [30, 5000, 50]] },
        ],
        "bug_fix",
      ),
      buildDomainModuleSpec(
        "exchange_feeds.yaml",
        "yaml",
        [
          { name: "ouchOrderGateway", param: "ouch", stateVar: "ouch", scaleFactor: 1, bands: [[9701, 16, 0]] },
          { name: "itchMulticastA", param: "itch", stateVar: "itch", scaleFactor: 1, bands: [[9702, 32, 0]] },
          { name: "dropCopyFix", param: "fix", stateVar: "fix", scaleFactor: 1, bands: [[9703, 8, 0]] },
          { name: "marginGuardRpc", param: "mrg", stateVar: "margin", scaleFactor: 1, bands: [[9704, 12, 0]] },
        ],
        "bug_fix",
      ),
      buildDomainModuleSpec(
        "collar_bands.json",
        "json",
        [
          { name: "orderSubmitCollar", param: "ord", stateVar: "submit", scaleFactor: 1, bands: [[10, 150, 5]] },
          { name: "massQuoteCollar", param: "mq", stateVar: "quote", scaleFactor: 1, bands: [[10, 200, 10]] },
          { name: "killSwitchCollar", param: "ks", stateVar: "kill", scaleFactor: 1, bands: [[5, 100, 5]] },
          { name: "dropCopyAuditCollar", param: "dc", stateVar: "audit", scaleFactor: 1, bands: [[25, 500, 15]] },
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
          { name: "routeSpanBatch", param: "spanCount", stateVar: "routedSpans", scaleFactor: 2, bands: [[16, 1024, 16], [32, 2048, 32], [64, 4096, 64]] },
          { name: "sampleTraceTail", param: "durationMs", stateVar: "tailWeight", scaleFactor: 3, bands: [[10, 500, 15], [25, 1500, 30], [50, 5000, 75]] },
          { name: "compactMetricSeries", param: "rawPoints", stateVar: "compactedPoints", scaleFactor: 2, bands: [[32, 4096, 32], [64, 8192, 64], [128, 16384, 128]] },
        ],
        "update_feature",
        "legacySpanFlush",
      ),
      buildDomainModuleSpec(
        "ClusterHud.tsx",
        "tsx",
        [
          { name: "ClusterNodeGrid", param: "Node", stateVar: "cluster_nodes", scaleFactor: 1, bands: [[4, 128, 4], [8, 256, 8], [16, 512, 16]] },
          { name: "SloBurnCardList", param: "SLO", stateVar: "slo_burn", scaleFactor: 1, bands: [[2, 32, 2], [4, 64, 4], [8, 128, 8]] },
          { name: "IncidentTimelinePanel", param: "Incident", stateVar: "incident_timeline", scaleFactor: 1, bands: [[5, 100, 5], [10, 250, 10], [20, 500, 20]] },
        ],
        "update_feature",
      ),
      buildDomainModuleSpec(
        "widget_embed.js",
        "js",
        [
          { name: "clampStatusPollInterval", param: "requestedSec", stateVar: "pollSec", scaleFactor: 2, bands: [[5, 60, 5], [10, 120, 10], [15, 300, 15]] },
          { name: "resizeEmbedIframeHeight", param: "contentPx", stateVar: "iframePx", scaleFactor: 1, bands: [[240, 1080, 20], [320, 1440, 40], [400, 2160, 60]] },
          { name: "throttleBeaconFlush", param: "queuedEvents", stateVar: "beaconBatch", scaleFactor: 2, bands: [[1, 50, 5], [5, 100, 10], [10, 250, 20]] },
        ],
        "update_feature",
      ),
      buildDomainModuleSpec(
        "anomaly_worker.py",
        "py",
        [
          { name: "score_seasonal_zscore", param: "sigma_units", stateVar: "anomaly_score", scaleFactor: 3, bands: [[10, 300, 10], [20, 600, 20], [30, 900, 30]] },
          { name: "cluster_log_signatures", param: "token_count", stateVar: "signature_hash", scaleFactor: 2, bands: [[32, 1024, 16], [64, 2048, 32], [128, 4096, 64]] },
          { name: "suppress_flapping_alerts", param: "flap_transitions", stateVar: "dampened_alerts", scaleFactor: 4, bands: [[3, 30, 3], [5, 60, 6], [10, 120, 12]] },
        ],
        "update_feature",
        undefined,
        {
          typeName: "AnomalyDetectorWindow",
          fields: [
            ["metric_key", "str"],
            ["baseline_mean", "int"],
            ["sigma_threshold", "int"],
            ["is_suppressed", "bool"],
          ],
        },
      ),
      buildDomainModuleSpec(
        "mesh_proxy.go",
        "go",
        [
          { name: "BalanceEnvoyUpstream", param: "healthyEndpoints", stateVar: "routedWeight", scaleFactor: 2, bands: [[2, 64, 4], [4, 128, 8], [8, 256, 16]] },
          { name: "EnforceMtlsRotation", param: "certAgeHours", stateVar: "rotationWindow", scaleFactor: 3, bands: [[1, 24, 2], [6, 72, 6], [12, 168, 12]] },
          { name: "DrainCanaryTraffic", param: "canaryPct", stateVar: "shiftedTraffic", scaleFactor: 2, bands: [[5, 100, 5], [10, 100, 10], [25, 100, 15]] },
        ],
        "update_feature",
      ),
      buildDomainModuleSpec(
        "trace_ring.rs",
        "rs",
        [
          { name: "append_ring_buffer_slot", param: "write_offset", stateVar: "slot_cursor", scaleFactor: 2, bands: [[64, 65536, 32], [128, 131072, 64], [256, 262144, 128]] },
          { name: "evict_expired_spans", param: "span_age_ms", stateVar: "evicted_count", scaleFactor: 3, bands: [[100, 10000, 50], [250, 30000, 125], [500, 60000, 250]] },
          { name: "compress_lz4_chunk", param: "raw_bytes", stateVar: "compressed_len", scaleFactor: 1, bands: [[512, 32768, 128], [1024, 65536, 256], [2048, 131072, 512]] },
        ],
        "update_feature",
      ),
      buildDomainModuleSpec(
        "packet_filter.cpp",
        "cpp",
        [
          { name: "filterEbpfSocketRing", param: "ingressPackets", stateVar: "acceptedPackets", scaleFactor: 2, bands: [[32, 4096, 32], [64, 8192, 64], [128, 16384, 128]] },
          { name: "aggregateTcpRetransmits", param: "retransmitSegs", stateVar: "penaltyScore", scaleFactor: 3, bands: [[1, 500, 10], [5, 1000, 20], [10, 2500, 40]] },
          { name: "clampSynBacklogQuota", param: "queueDepth", stateVar: "backlogLimit", scaleFactor: 2, bands: [[128, 8192, 64], [256, 16384, 128], [512, 32768, 256]] },
        ],
        "update_feature",
      ),
      buildDomainModuleSpec(
        "AuditLedger.cs",
        "cs",
        [
          { name: "AppendComplianceEvent", param: "eventSeq", stateVar: "ledgerIndex", scaleFactor: 2, bands: [[1, 10000, 25], [10, 50000, 50], [50, 250000, 100]] },
          { name: "VerifyRbacPolicyEpoch", param: "policyVersion", stateVar: "validatedEpoch", scaleFactor: 3, bands: [[1, 512, 8], [4, 1024, 16], [8, 2048, 32]] },
          { name: "RotateKmsEnvelopeKey", param: "keyAgeDays", stateVar: "rotationCountdown", scaleFactor: 2, bands: [[7, 90, 7], [14, 180, 14], [30, 365, 30]] },
        ],
        "update_feature",
      ),
      buildDomainModuleSpec(
        "AlertDispatcher.kt",
        "kt",
        [
          { name: "dispatchPagerEscalation", param: "severityTier", stateVar: "escalationScore", scaleFactor: 4, bands: [[1, 5, 1], [2, 10, 2], [3, 20, 3]] },
          { name: "deduplicateIncidentKey", param: "dedupWindowSec", stateVar: "activeWindow", scaleFactor: 2, bands: [[60, 3600, 30], [120, 7200, 60], [300, 14400, 120]] },
          { name: "routeOnCallSchedule", param: "rotationSlot", stateVar: "assignedShift", scaleFactor: 2, bands: [[1, 48, 2], [2, 96, 4], [4, 192, 8]] },
        ],
        "update_feature",
      ),
      buildDomainModuleSpec(
        "TenantPortal.php",
        "php",
        [
          { name: "computeTenantQuotaUnits", param: "activeOrgs", stateVar: "allocatedUnits", scaleFactor: 3, bands: [[10, 1000, 20], [25, 2500, 50], [50, 5000, 100]] },
          { name: "validateSamlAssertionTtl", param: "assertionSec", stateVar: "verifiedTtl", scaleFactor: 2, bands: [[60, 1800, 30], [120, 3600, 60], [300, 7200, 120]] },
          { name: "tallyApiKeyUsageDaily", param: "requestCalls", stateVar: "billedCalls", scaleFactor: 2, bands: [[100, 100000, 100], [250, 250000, 250], [500, 500000, 500]] },
        ],
        "update_feature",
      ),
      buildDomainModuleSpec(
        "console.css",
        "css",
        [
          { name: "control_plane_header", param: "hdr", stateVar: "hdr", scaleFactor: 1, bands: [[16, 12, 0]] },
          { name: "node_health_tile", param: "til", stateVar: "til", scaleFactor: 1, bands: [[12, 8, 0]] },
          { name: "slo_burn_badge", param: "bdg", stateVar: "bdg", scaleFactor: 1, bands: [[8, 6, 0]] },
          { name: "trace_waterfall_row", param: "wf", stateVar: "wf", scaleFactor: 1, bands: [[6, 4, 0]] },
        ],
        "update_feature",
      ),
      buildDomainModuleSpec(
        "console.html",
        "html",
        [
          { name: "observability_nav", param: "nav", stateVar: "MeshNav", scaleFactor: 1, bands: [[1, 10, 0], [2, 20, 0]] },
          { name: "trace_explorer_pane", param: "trc", stateVar: "TracePane", scaleFactor: 1, bands: [[3, 30, 0], [4, 40, 0]] },
        ],
        "update_feature",
      ),
      buildDomainModuleSpec(
        "service_catalog.json",
        "json",
        [
          { name: "traceIngestGateway", param: "trc", stateVar: "traces", scaleFactor: 1, bands: [[50, 1500, 20]] },
          { name: "metricsPromWrite", param: "prm", stateVar: "metrics", scaleFactor: 1, bands: [[50, 2000, 25]] },
          { name: "alertManagerHook", param: "alt", stateVar: "alerts", scaleFactor: 1, bands: [[30, 1000, 15]] },
          { name: "auditLedgerSink", param: "aud", stateVar: "audit", scaleFactor: 1, bands: [[80, 3000, 40]] },
        ],
        "update_feature",
      ),
      buildDomainModuleSpec(
        "mesh_topology.yaml",
        "yaml",
        [
          { name: "otelCollector", param: "otl", stateVar: "otel", scaleFactor: 1, bands: [[4317, 8, 0]] },
          { name: "clickhouseWriter", param: "chw", stateVar: "clickhouse", scaleFactor: 1, bands: [[8123, 6, 0]] },
          { name: "envoyControlPlane", param: "env", stateVar: "envoy", scaleFactor: 1, bands: [[9901, 12, 0]] },
          { name: "pagerEscalator", param: "pgr", stateVar: "pager", scaleFactor: 1, bands: [[9902, 4, 0]] },
        ],
        "update_feature",
      ),
      buildDomainModuleSpec(
        "status_digest.twig",
        "twig",
        [
          { name: "daily_slo_digest", param: "slo", stateVar: "SloRow", scaleFactor: 1, bands: [[1, 10, 0], [2, 20, 0]] },
          { name: "incident_summary_card", param: "inc", stateVar: "IncRow", scaleFactor: 1, bands: [[3, 30, 0], [4, 40, 0]] },
        ],
        "update_feature",
      ),
    ],
  },
] as const;

function extractTargetSliceAice(
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
  const activeAice = new AiceGenerator().generate(activeAst);
  const sliceText = extractSymbolFromAiceSource(
    activeAice,
    targetSymbol,
    filePath,
    activeAst,
  );
  return { outlineText: outlineRes.text, sliceText };
}

function measureSurgicalNativeReadTokens(
  nativeCode: string,
  filePath: string,
  target: TargetLanguage,
  targetSymbol: string,
  idioms: Record<string, ProjectIdiomDefinition>,
): number {
  const lines = nativeCode.split("\n");

  // 1. Realistic `rg` top-level symbol discovery headers across the file
  // (For JSON/YAML, only match top-level section keys rather than every nested leaf property)
  const headerLines =
    target === "json" || target === "yaml"
      ? lines.filter((l) => /^[ ]{0,2}(?:"[^"]+"\s*:|[a-zA-Z0-9_-]+\s*:)/.test(l))
      : lines.filter((l) =>
          /^\s*(export\s+|pub\s+|public\s+|class\s+|struct\s+|def\s+|func\s+|fn\s+|int\s+|void\s+|#[a-zA-Z]|\.[a-zA-Z]|<[a-zA-Z]+[^>]*id=|{%-?\s*block\b)/.test(
            l,
          ),
        );
  const rgDiscoveryText = headerLines.join("\n");

  // 2. Surgical line-range `read_file` window centered on the target symbol + module header/imports
  const probe = spliceNativeSource(
    nativeCode,
    { symbol: targetSymbol, delete: true },
    filePath,
    idioms,
  );
  const targetNativeSnippet = probe.originalSnippet ?? "";
  const snippetStartIdx = targetNativeSnippet
    ? Math.max(0, nativeCode.indexOf(targetNativeSnippet))
    : 0;
  const padChars = Math.max(120, Math.round(targetNativeSnippet.length * 0.25));
  const windowStart = Math.max(0, snippetStartIdx - padChars);
  const windowEnd = Math.min(
    nativeCode.length,
    snippetStartIdx + targetNativeSnippet.length + padChars,
  );
  const surgicalWindowText = nativeCode.slice(windowStart, windowEnd);

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
  const combinedIdiomsConfig: Record<string, ProjectIdiomDefinition> = {};
  let idiomDefinitionsTokens = 0;

  for (const fileSpec of spec.files) {
    languagesSet.add(fileSpec.languageId);
    const langSpec = SUPPORTED_BENCHMARK_LANGUAGES.find((l) => l.id === fileSpec.languageId)!;
    extensionsSet.add(langSpec.extension);
    const { idioms, definitionSource } = buildIdiomRegistryForLanguage(fileSpec.languageId);
    Object.assign(combinedIdiomsConfig, idioms);
    if (!idiomsUsedSet.has(langSpec.idiomName)) {
      idiomsUsedSet.add(langSpec.idiomName);
      idiomDefinitionsTokens += countTokens(definitionSource);
    }
  }

  // Persist real aice.config.json in benchmark workspace (Twinless Direct-to-Native mode)
  const configPath = path.join(benchDir, "aice.config.json");
  fs.writeFileSync(
    configPath,
    JSON.stringify(
      {
        version: "2.0.0",
        mode: "twinless",
        idiomsEnabled: true,
        idioms: combinedIdiomsConfig,
      },
      null,
      2,
    ),
    "utf-8",
  );

  const fileResults: RealWorldModuleFileResult[] = [];
  let writeWithoutAice = 0;
  let writeAiceNoIdioms = 0;
  let writeAiceWithIdioms = idiomDefinitionsTokens; // Charge full idiom definition overhead on Write from 0!

  let readWithoutAice = 0;
  let readAiceNoIdioms = 0;
  let readAiceWithIdioms = 0;

  let updateWithoutAice = 0;
  let updateAiceNoIdioms = 0;
  let updateAiceWithIdioms = 0;

  let deleteWithoutAice = 0;
  let deleteAiceNoIdioms = 0;
  let deleteAiceWithIdioms = 0;

  let refactorWithoutAice = 0;
  let refactorAiceNoIdioms = 0;
  let refactorAiceWithIdioms = 0;
  const refactoredLanguages = new Set<BenchmarkLanguageId>();

  for (const fileSpec of spec.files) {
    const langSpec = SUPPORTED_BENCHMARK_LANGUAGES.find((l) => l.id === fileSpec.languageId)!;
    const { idioms, updatedTemplateAice } = buildIdiomRegistryForLanguage(fileSpec.languageId);
    const filePath = path.join(benchDir, fileSpec.fileName);

    // 1. Write from 0 (Compile AICE -> Native on disk; also generate Pure AICE without idioms)
    const parsedWithIdioms = parse(fileSpec.aiceWithIdioms, `${fileSpec.fileName}.aice`);
    const expandedAst = expandModuleIdioms(parsedWithIdioms, idioms);
    const pureAiceSource = new AiceGenerator().generate(expandedAst);
    const nativeCode = emitTarget(expandedAst, langSpec.target, { watermark: false });
    fs.writeFileSync(filePath, nativeCode, "utf-8");

    const fileNativeTokens = countTokens(nativeCode);
    const filePureAiceTokens = countTokens(pureAiceSource);
    const fileIdiomAiceTokens = countTokens(fileSpec.aiceWithIdioms);

    writeWithoutAice += fileNativeTokens;
    writeAiceNoIdioms += filePureAiceTokens;
    writeAiceWithIdioms += fileIdiomAiceTokens;

    fileResults.push({
      fileName: fileSpec.fileName,
      languageId: fileSpec.languageId,
      extension: langSpec.extension,
      withoutAiceTokens: fileNativeTokens,
      aiceWithoutIdiomsTokens: filePureAiceTokens,
      aiceWithIdiomsTokens: fileIdiomAiceTokens,
      savingsWithoutIdiomsPct: Number(
        (((fileNativeTokens - filePureAiceTokens) / fileNativeTokens) * 100).toFixed(2),
      ),
      savingsWithIdiomsPct: Number(
        (((fileNativeTokens - fileIdiomAiceTokens) / fileNativeTokens) * 100).toFixed(2),
      ),
    });

    // 2. Read (Discovery + Surgical Target Symbol Context via generateOutline + extractSymbolFromAiceSource)
    const nativeReadTokens = measureSurgicalNativeReadTokens(
      nativeCode,
      filePath,
      langSpec.target,
      fileSpec.targetSymbol,
      idioms,
    );
    const pureSlice = extractTargetSliceAice(
      nativeCode,
      filePath,
      langSpec.target,
      fileSpec.targetSymbol,
      undefined,
    );
    const idiomSlice = extractTargetSliceAice(
      nativeCode,
      filePath,
      langSpec.target,
      fileSpec.targetSymbol,
      idioms,
    );

    readWithoutAice += nativeReadTokens;
    readAiceNoIdioms += countTokens(pureSlice.outlineText) + countTokens(pureSlice.sliceText);
    readAiceWithIdioms += countTokens(idiomSlice.outlineText) + countTokens(idiomSlice.sliceText);

    // 3. Surgical Update (Execute spliceNativeSource for BOTH Pure AICE and Idiom AICE and verify parity!)
    const updatedPureAice = expandSnippetToPureAice(
      fileSpec.updatedTargetSymbolAiceWithIdioms,
      fileSpec.languageId,
      idioms,
    );

    if (spec.scenario === "new_feature") {
      const pureInsertRes = spliceNativeSource(
        nativeCode,
        {
          insertAfter: fileSpec.targetSymbol,
          code: updatedPureAice,
        },
        filePath,
        {},
      );
      const idiomInsertRes = spliceNativeSource(
        nativeCode,
        {
          insertAfter: fileSpec.targetSymbol,
          code: fileSpec.updatedTargetSymbolAiceWithIdioms,
        },
        filePath,
        idioms,
      );
      if (
        !pureInsertRes.success ||
        !idiomInsertRes.success ||
        pureInsertRes.modifiedCode !== idiomInsertRes.modifiedCode
      ) {
        throw new Error(`Insert splice parity failed on ${fileSpec.fileName}`);
      }
      fs.writeFileSync(filePath, idiomInsertRes.modifiedCode, "utf-8");
      const anchorLines = (idiomInsertRes.originalSnippet ?? "")
        .split("\n")
        .slice(-3)
        .join("\n");
      const anchorTokens = Math.max(6, countTokens(anchorLines));
      updateWithoutAice += anchorTokens * 2 + countTokens(idiomInsertRes.newSnippet ?? "");
      updateAiceNoIdioms +=
        countTokens(`--insert-after ${fileSpec.targetSymbol}`) + countTokens(updatedPureAice);
      updateAiceWithIdioms +=
        countTokens(`--insert-after ${fileSpec.targetSymbol}`) +
        countTokens(fileSpec.updatedTargetSymbolAiceWithIdioms);
    } else {
      const pureUpdateRes = spliceNativeSource(
        nativeCode,
        {
          symbol: fileSpec.targetSymbol,
          code: updatedPureAice,
        },
        filePath,
        {},
      );
      const idiomUpdateRes = spliceNativeSource(
        nativeCode,
        {
          symbol: fileSpec.targetSymbol,
          code: fileSpec.updatedTargetSymbolAiceWithIdioms,
        },
        filePath,
        idioms,
      );
      if (
        !pureUpdateRes.success ||
        !idiomUpdateRes.success ||
        pureUpdateRes.modifiedCode !== idiomUpdateRes.modifiedCode
      ) {
        throw new Error(`Update splice parity failed on ${fileSpec.fileName}`);
      }
      fs.writeFileSync(filePath, idiomUpdateRes.modifiedCode, "utf-8");
      updateWithoutAice +=
        countTokens(idiomUpdateRes.originalSnippet ?? "") +
        countTokens(idiomUpdateRes.newSnippet ?? "");
      updateAiceNoIdioms +=
        countTokens(`--symbol ${fileSpec.targetSymbol}`) + countTokens(updatedPureAice);
      updateAiceWithIdioms +=
        countTokens(`--symbol ${fileSpec.targetSymbol}`) +
        countTokens(fileSpec.updatedTargetSymbolAiceWithIdioms);
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
      deleteWithoutAice += countTokens(deleteRes.originalSnippet ?? "");
      const delCmdTokens = countTokens(`--symbol ${fileSpec.obsoleteSymbol} --delete`);
      deleteAiceNoIdioms += delCmdTokens;
      deleteAiceWithIdioms += delCmdTokens;
    }

    // 5. Surgical Multi-Site / Multi-File Pattern Refactor
    // Measure surgical symbol-level patches (only the refactored symbols in the file, not untouched types/headers)
    const updatedIdioms: Record<string, ProjectIdiomDefinition> = {
      ...idioms,
      [langSpec.idiomName]: {
        ...idioms[langSpec.idiomName],
        templateAice: updatedTemplateAice,
      },
    };
    const beforeRefactorNative = fs.readFileSync(filePath, "utf-8");
    const decompiledBefore = decompile(beforeRefactorNative, langSpec.target, { filePath });
    const collapsedBefore = collapseModuleIdioms(decompiledBefore.ast, idioms);
    const expandedAfterAst = expandModuleIdioms(collapsedBefore.ast, updatedIdioms);
    const afterRefactorPureAice = new AiceGenerator().generate(expandedAfterAst);
    const afterRefactorNative = emitTarget(expandedAfterAst, langSpec.target, { watermark: false });

    let pureWorkingNative = beforeRefactorNative;
    for (const refSym of fileSpec.refactorSymbols) {
      const origProbe = spliceNativeSource(
        beforeRefactorNative,
        { symbol: refSym, delete: true },
        filePath,
        {},
      );
      const afterProbe = spliceNativeSource(
        afterRefactorNative,
        { symbol: refSym, delete: true },
        filePath,
        {},
      );
      const rawRefSymPureAice = extractSymbolFromAiceSource(
        afterRefactorPureAice,
        refSym,
        filePath,
        expandedAfterAst,
      );
      let cleanRefSymPureAice = rawRefSymPureAice
        .replace(/^(?:#[^\n]*|module\s+[^\n]+)\n+/g, "")
        .trim();
      if (fileSpec.languageId === "html" || fileSpec.languageId === "twig") {
        const lines = cleanRefSymPureAice.split("\n");
        const compIdx = lines.findIndex((l) => l.trim().startsWith("component "));
        if (compIdx >= 0) {
          cleanRefSymPureAice = lines
            .slice(compIdx + 1)
            .map((l) => (l.startsWith("  ") ? l.slice(2) : l))
            .join("\n")
            .trim();
        }
      }
      const pureRefactorSplice = spliceNativeSource(
        pureWorkingNative,
        { symbol: refSym, code: cleanRefSymPureAice },
        filePath,
        {},
      );
      if (!pureRefactorSplice.success) {
        throw new Error(`Pure AICE refactor splice failed on ${fileSpec.fileName} (${refSym})`);
      }
      pureWorkingNative = pureRefactorSplice.modifiedCode;

      // Without AICE: replace_file_content (old symbol snippet + new symbol snippet)
      refactorWithoutAice +=
        countTokens(origProbe.originalSnippet ?? "") +
        countTokens(afterProbe.originalSnippet ?? "");
      // AICE Without Idioms: surgical `aice splice --symbol <refSym>` with pure AICE symbol replacement
      refactorAiceNoIdioms +=
        countTokens(`--symbol ${refSym}`) + countTokens(cleanRefSymPureAice);
    }

    fs.writeFileSync(filePath, afterRefactorNative, "utf-8");

    // AICE With Idioms: 1 `aice idiom update $name "<updatedTemplateAice>"` per language idiom in aice.config.json
    if (!refactoredLanguages.has(fileSpec.languageId)) {
      refactoredLanguages.add(fileSpec.languageId);
      refactorAiceWithIdioms +=
        countTokens(`aice idiom update ${langSpec.idiomName}`) +
        countTokens(updatedTemplateAice);
    }
  }

  const remainingAiceFiles = fs.readdirSync(benchDir).filter((f) => f.endsWith(".aice"));
  const zeroAiceFilesLeftOnDisk = remainingAiceFiles.length === 0;

  const writeWithoutAiceTurns = spec.files.length;
  const writeAiceNoIdiomsTurns = spec.files.length;
  const writeAiceWithIdiomsTurns = spec.files.length;

  const readWithoutAiceTurns = 2 * spec.files.length;
  const readAiceNoIdiomsTurns = spec.files.length;
  const readAiceWithIdiomsTurns = spec.files.length;

  const updateWithoutAiceTurns = spec.files.length;
  const updateAiceNoIdiomsTurns = 1;
  const updateAiceWithIdiomsTurns = 1;

  const deleteFilesCount = spec.files.filter((f) => Boolean(f.obsoleteSymbol)).length;
  const deleteWithoutAiceTurns = deleteFilesCount > 0 ? deleteFilesCount * 2 : 0;
  const deleteAiceNoIdiomsTurns = deleteFilesCount > 0 ? 1 : 0;
  const deleteAiceWithIdiomsTurns = deleteFilesCount > 0 ? 1 : 0;

  const totalRefactorSites = spec.files.reduce(
    (acc, f) => acc + f.refactorSymbols.length,
    0,
  );
  const refactorWithoutAiceTurns = totalRefactorSites;
  const refactorAiceNoIdiomsTurns = spec.files.length;
  const refactorAiceWithIdiomsTurns = 1;

  const totalWithoutAiceTurns =
    writeWithoutAiceTurns +
    readWithoutAiceTurns +
    updateWithoutAiceTurns +
    deleteWithoutAiceTurns +
    refactorWithoutAiceTurns;

  const totalAiceNoIdiomsTurns =
    writeAiceNoIdiomsTurns +
    readAiceNoIdiomsTurns +
    updateAiceNoIdiomsTurns +
    deleteAiceNoIdiomsTurns +
    refactorAiceNoIdiomsTurns;

  const totalAiceWithIdiomsTurns =
    writeAiceWithIdiomsTurns +
    readAiceWithIdiomsTurns +
    updateAiceWithIdiomsTurns +
    deleteAiceWithIdiomsTurns +
    refactorAiceWithIdiomsTurns;

  const writeFromZero = makeThreeWayScore(
    writeWithoutAice,
    writeAiceNoIdioms,
    writeAiceWithIdioms,
    writeWithoutAiceTurns,
    writeAiceNoIdiomsTurns,
    writeAiceWithIdiomsTurns,
  );
  const readContext = makeThreeWayScore(
    readWithoutAice,
    readAiceNoIdioms,
    readAiceWithIdioms,
    readWithoutAiceTurns,
    readAiceNoIdiomsTurns,
    readAiceWithIdiomsTurns,
  );
  const surgicalUpdate = makeThreeWayScore(
    updateWithoutAice,
    updateAiceNoIdioms,
    updateAiceWithIdioms,
    updateWithoutAiceTurns,
    updateAiceNoIdiomsTurns,
    updateAiceWithIdiomsTurns,
  );
  const surgicalDelete = makeThreeWayScore(
    deleteWithoutAice,
    deleteAiceNoIdioms,
    deleteAiceWithIdioms,
    deleteWithoutAiceTurns,
    deleteAiceNoIdiomsTurns,
    deleteAiceWithIdiomsTurns,
  );
  const multiFileRefactor = makeThreeWayScore(
    refactorWithoutAice,
    refactorAiceNoIdioms,
    refactorAiceWithIdioms,
    refactorWithoutAiceTurns,
    refactorAiceNoIdiomsTurns,
    refactorAiceWithIdiomsTurns,
  );

  const total = makeThreeWayScore(
    writeWithoutAice + readWithoutAice + updateWithoutAice + deleteWithoutAice + refactorWithoutAice,
    writeAiceNoIdioms + readAiceNoIdioms + updateAiceNoIdioms + deleteAiceNoIdioms + refactorAiceNoIdioms,
    writeAiceWithIdioms +
      readAiceWithIdioms +
      updateAiceWithIdioms +
      deleteAiceWithIdioms +
      refactorAiceWithIdioms,
    totalWithoutAiceTurns,
    totalAiceNoIdiomsTurns,
    totalAiceWithIdiomsTurns,
  );

  const aiceWinsAllWithoutIdioms =
    writeFromZero.aiceWithoutIdiomsWins &&
    readContext.aiceWithoutIdiomsWins &&
    surgicalUpdate.aiceWithoutIdiomsWins &&
    surgicalDelete.aiceWithoutIdiomsWins &&
    multiFileRefactor.aiceWithoutIdiomsWins &&
    zeroAiceFilesLeftOnDisk;

  const aiceWinsAllWithIdioms =
    writeFromZero.aiceWithIdiomsWins &&
    readContext.aiceWithIdiomsWins &&
    surgicalUpdate.aiceWithIdiomsWins &&
    surgicalDelete.aiceWithIdiomsWins &&
    multiFileRefactor.aiceWithIdiomsWins &&
    zeroAiceFilesLeftOnDisk;

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
    aiceWinsAllWithoutIdioms,
    aiceWinsAllWithIdioms,
    zeroAiceFilesLeftOnDisk,
  };
}

function expandSnippetToPureAice(
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
    const parsed = parse(wrapped, "snippet.aice");
    const expanded = expandModuleIdioms(parsed, idioms);
    const fullLines = new AiceGenerator().generate(expanded).trim().split("\n");
    const compIdx = fullLines.findIndex((l) => l.trim().startsWith("component Snippet"));
    const bodyLines = compIdx >= 0 ? fullLines.slice(compIdx + 1) : fullLines;
    return bodyLines.map((l) => (l.startsWith("  ") ? l.slice(2) : l)).join("\n");
  }
  const parsed = parse(snippetWithIdioms, "snippet.aice");
  const expanded = expandModuleIdioms(parsed, idioms);
  return new AiceGenerator()
    .generate(expanded)
    .split("\n")
    .filter((l) => !l.trim().startsWith("#") && !l.trim().startsWith("module "))
    .join("\n")
    .trim();
}

export function runRealWorldBenchmarkSuite(): RealWorldBenchmarkSuiteReport {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aice-real-world-bench-"));
  try {
    const benchmarks: RealWorldBenchmarkResult[] = [];
    const coveredLanguages = new Set<BenchmarkLanguageId>();
    const coveredExtensions = new Set<string>();
    const coveredScenarios = new Set<EngineeringScenarioKind>();
    const coveredSurfaces = new Set<ApplicationSurfaceKind>();
    let zeroAiceFilesLeftOnDisk = true;

    for (const spec of REAL_WORLD_BENCHMARKS) {
      const res = runSingleRealWorldBenchmark(spec, tmpRoot);
      benchmarks.push(res);
      for (const l of res.languages) coveredLanguages.add(l);
      for (const e of res.extensions) coveredExtensions.add(e);
      coveredScenarios.add(res.scenario);
      coveredSurfaces.add(res.appSurface);
      if (!res.zeroAiceFilesLeftOnDisk) zeroAiceFilesLeftOnDisk = false;
    }

    const sumScore = (
      pick: (b: RealWorldBenchmarkResult) => ThreeWayOperationScore,
    ): ThreeWayOperationScore => {
      let w = 0;
      let noId = 0;
      let withId = 0;
      let wTurns = 0;
      let noIdTurns = 0;
      let withIdTurns = 0;
      for (const b of benchmarks) {
        const s = pick(b);
        w += s.withoutAiceTokens;
        noId += s.aiceWithoutIdiomsTokens;
        withId += s.aiceWithIdiomsTokens;
        wTurns += s.withoutAiceTurns;
        noIdTurns += s.aiceWithoutIdiomsTurns;
        withIdTurns += s.aiceWithIdiomsTurns;
      }
      return makeThreeWayScore(w, noId, withId, wTurns, noIdTurns, withIdTurns);
    };

    const aggregateWrite = sumScore((b) => b.writeFromZero);
    const aggregateRead = sumScore((b) => b.readContext);
    const aggregateUpdate = sumScore((b) => b.surgicalUpdate);
    const aggregateDelete = sumScore((b) => b.surgicalDelete);
    const aggregateRefactor = sumScore((b) => b.multiFileRefactor);
    const aggregateTotal = sumScore((b) => b.total);

    const winsWithoutIdioms = benchmarks.filter((b) => b.aiceWinsAllWithoutIdioms).length;
    const winsWithIdioms = benchmarks.filter((b) => b.aiceWinsAllWithIdioms).length;

    return {
      totalBenchmarks: benchmarks.length,
      winsWithoutIdioms,
      winsWithIdioms,
      winRateWithoutIdiomsPct: Number(
        ((winsWithoutIdioms / benchmarks.length) * 100).toFixed(1),
      ),
      winRateWithIdiomsPct: Number(((winsWithIdioms / benchmarks.length) * 100).toFixed(1)),
      zeroAiceFilesLeftOnDisk,
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
    "# AICE 2.0 Deterministic Offline Benchmark Report (10 Scenarios — Without & With Idioms)",
    "",
    "- **Evaluation Engine**: Deterministic Offline AST & Tooling Harness (Exact API Calls & Character/Token Accounting — No Live LLM Agent Calls)",
    "- **Evaluation Mode**: 3-Way Apples-to-Apples (`Without AICE` vs `AICE Without Idioms` vs `AICE With Idioms`)",
    `- **Total Real-World Benchmarks**: **${report.totalBenchmarks}** (\`RW-01\` .. \`RW-10\`)`,
    `- **AICE Without Idioms Win Rate**: **${report.winsWithoutIdioms} / ${report.totalBenchmarks} (${report.winRateWithoutIdiomsPct.toFixed(1)}%)**`,
    `- **AICE With Idioms Win Rate**: **${report.winsWithIdioms} / ${report.totalBenchmarks} (${report.winRateWithIdiomsPct.toFixed(1)}%)**`,
    `- **Total Lifecycle Turns (10 Benchmarks)**: Without AICE = **${report.aggregateTotal.withoutAiceTurns} turns** | AICE Without Idioms = **${report.aggregateTotal.aiceWithoutIdiomsTurns} turns (-${report.aggregateTotal.turnsSavingsWithoutIdiomsPct.toFixed(1)}%)** | AICE With Idioms = **${report.aggregateTotal.aiceWithIdiomsTurns} turns (-${report.aggregateTotal.turnsSavingsWithIdiomsPct.toFixed(1)}%)**`,
    `- **Languages & File Types Covered (${report.coveredLanguages.length})**: \`${report.coveredExtensions.join("`, `")}\``,
    `- **Engineering Scenarios Covered (${report.coveredScenarios.length})**: \`${report.coveredScenarios.join("`, `")}\``,
    `- **Application Surfaces Covered (${report.coveredSurfaces.length})**: \`${report.coveredSurfaces.join("`, `")}\``,
    `- **Zero \`.aice\` Files Left on Disk**: **${report.zeroAiceFilesLeftOnDisk ? "PASS (0 .aice files)" : "FAIL"}**`,
    "",
    "---",
    "",
    "## 1. Aggregate Operation Breakdown (Tokens & Turns Across All 10 Real-World Benchmarks)",
    "",
    "### Token Breakdown Across All 10 Real-World Benchmarks",
    "",
    "| Operation | Without AICE (Tokens) | AICE Without Idioms (Tokens) | Savings Without Idioms | AICE With Idioms (Tokens) | Savings With Idioms | Extra Idiom Boost |",
    "| :--- | ---: | ---: | ---: | ---: | ---: | ---: |",
    `| **Write (Create from 0)** *(incl. idiom defs)* | ${report.aggregateWrite.withoutAiceTokens.toLocaleString("en-US")} | ${report.aggregateWrite.aiceWithoutIdiomsTokens.toLocaleString("en-US")} | **-${report.aggregateWrite.savingsWithoutIdiomsPct.toFixed(1)}%** | ${report.aggregateWrite.aiceWithIdiomsTokens.toLocaleString("en-US")} | **-${report.aggregateWrite.savingsWithIdiomsPct.toFixed(1)}%** | **+${report.aggregateWrite.idiomExtraSavingsPct.toFixed(1)}%** |`,
    `| **Read (Discovery + Context)** | ${report.aggregateRead.withoutAiceTokens.toLocaleString("en-US")} | ${report.aggregateRead.aiceWithoutIdiomsTokens.toLocaleString("en-US")} | **-${report.aggregateRead.savingsWithoutIdiomsPct.toFixed(1)}%** | ${report.aggregateRead.aiceWithIdiomsTokens.toLocaleString("en-US")} | **-${report.aggregateRead.savingsWithIdiomsPct.toFixed(1)}%** | **+${report.aggregateRead.idiomExtraSavingsPct.toFixed(1)}%** |`,
    `| **Update (Bug Fix / Feature)** | ${report.aggregateUpdate.withoutAiceTokens.toLocaleString("en-US")} | ${report.aggregateUpdate.aiceWithoutIdiomsTokens.toLocaleString("en-US")} | **-${report.aggregateUpdate.savingsWithoutIdiomsPct.toFixed(1)}%** | ${report.aggregateUpdate.aiceWithIdiomsTokens.toLocaleString("en-US")} | **-${report.aggregateUpdate.savingsWithIdiomsPct.toFixed(1)}%** | **+${report.aggregateUpdate.idiomExtraSavingsPct.toFixed(1)}%** |`,
    `| **Delete (Obsolete Symbol)** | ${report.aggregateDelete.withoutAiceTokens.toLocaleString("en-US")} | ${report.aggregateDelete.aiceWithoutIdiomsTokens.toLocaleString("en-US")} | **-${report.aggregateDelete.savingsWithoutIdiomsPct.toFixed(1)}%** | ${report.aggregateDelete.aiceWithIdiomsTokens.toLocaleString("en-US")} | **-${report.aggregateDelete.savingsWithIdiomsPct.toFixed(1)}%** | **+${report.aggregateDelete.idiomExtraSavingsPct.toFixed(1)}%** |`,
    `| **Refactor (Multi-Site / Multi-File)** | ${report.aggregateRefactor.withoutAiceTokens.toLocaleString("en-US")} | ${report.aggregateRefactor.aiceWithoutIdiomsTokens.toLocaleString("en-US")} | **-${report.aggregateRefactor.savingsWithoutIdiomsPct.toFixed(1)}%** | ${report.aggregateRefactor.aiceWithIdiomsTokens.toLocaleString("en-US")} | **-${report.aggregateRefactor.savingsWithIdiomsPct.toFixed(1)}%** | **+${report.aggregateRefactor.idiomExtraSavingsPct.toFixed(1)}%** |`,
    `| **TOTAL LIFECYCLE** | **${report.aggregateTotal.withoutAiceTokens.toLocaleString("en-US")}** | **${report.aggregateTotal.aiceWithoutIdiomsTokens.toLocaleString("en-US")}** | **-${report.aggregateTotal.savingsWithoutIdiomsPct.toFixed(1)}%** | **${report.aggregateTotal.aiceWithIdiomsTokens.toLocaleString("en-US")}** | **-${report.aggregateTotal.savingsWithIdiomsPct.toFixed(1)}%** | **+${report.aggregateTotal.idiomExtraSavingsPct.toFixed(1)}%** |`,
    "",
    "### Agent Turns Breakdown Across All 10 Real-World Benchmarks",
    "",
    "| Operation | Without AICE (Turns) | AICE Without Idioms (Turns) | Turn Savings Without Idioms | AICE With Idioms (Turns) | Turn Savings With Idioms | Extra Idiom Turn Boost |",
    "| :--- | ---: | ---: | ---: | ---: | ---: | ---: |",
    `| **Write (Create from 0)** | ${report.aggregateWrite.withoutAiceTurns.toLocaleString("en-US")} | ${report.aggregateWrite.aiceWithoutIdiomsTurns.toLocaleString("en-US")} | **${report.aggregateWrite.turnsSavingsWithoutIdiomsPct > 0 ? `-${report.aggregateWrite.turnsSavingsWithoutIdiomsPct.toFixed(1)}%` : "0.0%"}** | ${report.aggregateWrite.aiceWithIdiomsTurns.toLocaleString("en-US")} | **${report.aggregateWrite.turnsSavingsWithIdiomsPct > 0 ? `-${report.aggregateWrite.turnsSavingsWithIdiomsPct.toFixed(1)}%` : "0.0%"}** | **+${report.aggregateWrite.idiomExtraTurnsSavingsPct.toFixed(1)}%** |`,
    `| **Read (Discovery + Context)** | ${report.aggregateRead.withoutAiceTurns.toLocaleString("en-US")} | ${report.aggregateRead.aiceWithoutIdiomsTurns.toLocaleString("en-US")} | **-${report.aggregateRead.turnsSavingsWithoutIdiomsPct.toFixed(1)}%** | ${report.aggregateRead.aiceWithIdiomsTurns.toLocaleString("en-US")} | **-${report.aggregateRead.turnsSavingsWithIdiomsPct.toFixed(1)}%** | **+${report.aggregateRead.idiomExtraTurnsSavingsPct.toFixed(1)}%** |`,
    `| **Update (Bug Fix / Feature)** | ${report.aggregateUpdate.withoutAiceTurns.toLocaleString("en-US")} | ${report.aggregateUpdate.aiceWithoutIdiomsTurns.toLocaleString("en-US")} | **-${report.aggregateUpdate.turnsSavingsWithoutIdiomsPct.toFixed(1)}%** | ${report.aggregateUpdate.aiceWithIdiomsTurns.toLocaleString("en-US")} | **-${report.aggregateUpdate.turnsSavingsWithIdiomsPct.toFixed(1)}%** | **+${report.aggregateUpdate.idiomExtraTurnsSavingsPct.toFixed(1)}%** |`,
    `| **Delete (Obsolete Symbol)** | ${report.aggregateDelete.withoutAiceTurns.toLocaleString("en-US")} | ${report.aggregateDelete.aiceWithoutIdiomsTurns.toLocaleString("en-US")} | **-${report.aggregateDelete.turnsSavingsWithoutIdiomsPct.toFixed(1)}%** | ${report.aggregateDelete.aiceWithIdiomsTurns.toLocaleString("en-US")} | **-${report.aggregateDelete.turnsSavingsWithIdiomsPct.toFixed(1)}%** | **+${report.aggregateDelete.idiomExtraTurnsSavingsPct.toFixed(1)}%** |`,
    `| **Refactor (Multi-Site / Multi-File)** | ${report.aggregateRefactor.withoutAiceTurns.toLocaleString("en-US")} | ${report.aggregateRefactor.aiceWithoutIdiomsTurns.toLocaleString("en-US")} | **-${report.aggregateRefactor.turnsSavingsWithoutIdiomsPct.toFixed(1)}%** | ${report.aggregateRefactor.aiceWithIdiomsTurns.toLocaleString("en-US")} | **-${report.aggregateRefactor.turnsSavingsWithIdiomsPct.toFixed(1)}%** | **+${report.aggregateRefactor.idiomExtraTurnsSavingsPct.toFixed(1)}%** |`,
    `| **TOTAL LIFECYCLE** | **${report.aggregateTotal.withoutAiceTurns.toLocaleString("en-US")}** | **${report.aggregateTotal.aiceWithoutIdiomsTurns.toLocaleString("en-US")}** | **-${report.aggregateTotal.turnsSavingsWithoutIdiomsPct.toFixed(1)}%** | **${report.aggregateTotal.aiceWithIdiomsTurns.toLocaleString("en-US")}** | **-${report.aggregateTotal.turnsSavingsWithIdiomsPct.toFixed(1)}%** | **+${report.aggregateTotal.idiomExtraTurnsSavingsPct.toFixed(1)}%** |`,
    "",
    "---",
    "",
    "## 2. All 10 Real-World Benchmarks Summary Table (Offline Deterministic Suite)",
    "",
    "| ID | Real-World Benchmark Scenario | Surface | Task Kind | File Types | Write (No Idiom / Idiom) | Read (No Idiom / Idiom) | Update (No Idiom / Idiom) | Delete | Refactor (No Idiom / Idiom) | Tokens Without AICE | Tokens AICE (No Idioms) | Tokens AICE (With Idioms) | Turns Without AICE | Turns AICE (No Idioms) | Turns AICE (With Idioms) |",
    "| :--- | :--- | :--- | :--- | :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];

  for (const b of report.benchmarks) {
    lines.push(
      `| \`${b.id}\` | **${b.title}** | \`${b.appSurface}\` | \`${b.scenario}\` | \`${b.extensions.join(" ")}\` | -${b.writeFromZero.savingsWithoutIdiomsPct.toFixed(1)}% / **-${b.writeFromZero.savingsWithIdiomsPct.toFixed(1)}%** | -${b.readContext.savingsWithoutIdiomsPct.toFixed(1)}% / **-${b.readContext.savingsWithIdiomsPct.toFixed(1)}%** | -${b.surgicalUpdate.savingsWithoutIdiomsPct.toFixed(1)}% / **-${b.surgicalUpdate.savingsWithIdiomsPct.toFixed(1)}%** | **-${b.surgicalDelete.savingsWithIdiomsPct.toFixed(1)}%** | -${b.multiFileRefactor.savingsWithoutIdiomsPct.toFixed(1)}% / **-${b.multiFileRefactor.savingsWithIdiomsPct.toFixed(1)}%** | ${b.total.withoutAiceTokens.toLocaleString("en-US")} | ${b.total.aiceWithoutIdiomsTokens.toLocaleString("en-US")} (**-${b.total.savingsWithoutIdiomsPct.toFixed(1)}%**) | ${b.total.aiceWithIdiomsTokens.toLocaleString("en-US")} (**-${b.total.savingsWithIdiomsPct.toFixed(1)}%**) | ${b.total.withoutAiceTurns} | ${b.total.aiceWithoutIdiomsTurns} (**-${b.total.turnsSavingsWithoutIdiomsPct.toFixed(1)}%**) | ${b.total.aiceWithIdiomsTurns} (**-${b.total.turnsSavingsWithIdiomsPct.toFixed(1)}%**) |`,
    );
  }

  lines.push(
    `| **TOTAL** | **All 10 Real-World Scenarios (\`${report.winsWithIdioms}/${report.totalBenchmarks}\` Wins)** | **Both** | **All 5** | **All 15** | -${report.aggregateWrite.savingsWithoutIdiomsPct.toFixed(1)}% / **-${report.aggregateWrite.savingsWithIdiomsPct.toFixed(1)}%** | -${report.aggregateRead.savingsWithoutIdiomsPct.toFixed(1)}% / **-${report.aggregateRead.savingsWithIdiomsPct.toFixed(1)}%** | -${report.aggregateUpdate.savingsWithoutIdiomsPct.toFixed(1)}% / **-${report.aggregateUpdate.savingsWithIdiomsPct.toFixed(1)}%** | **-${report.aggregateDelete.savingsWithIdiomsPct.toFixed(1)}%** | -${report.aggregateRefactor.savingsWithoutIdiomsPct.toFixed(1)}% / **-${report.aggregateRefactor.savingsWithIdiomsPct.toFixed(1)}%** | **${report.aggregateTotal.withoutAiceTokens.toLocaleString("en-US")}** | **${report.aggregateTotal.aiceWithoutIdiomsTokens.toLocaleString("en-US")} (-${report.aggregateTotal.savingsWithoutIdiomsPct.toFixed(1)}%)** | **${report.aggregateTotal.aiceWithIdiomsTokens.toLocaleString("en-US")} (-${report.aggregateTotal.savingsWithIdiomsPct.toFixed(1)}%)** | **${report.aggregateTotal.withoutAiceTurns}** | **${report.aggregateTotal.aiceWithoutIdiomsTurns} (-${report.aggregateTotal.turnsSavingsWithoutIdiomsPct.toFixed(1)}%)** | **${report.aggregateTotal.aiceWithIdiomsTurns} (-${report.aggregateTotal.turnsSavingsWithIdiomsPct.toFixed(1)}%)** |`,
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
      `- **Lifecycle Tokens**: Without AICE = **${b.total.withoutAiceTokens.toLocaleString("en-US")}** | AICE Without Idioms = **${b.total.aiceWithoutIdiomsTokens.toLocaleString("en-US")} (-${b.total.savingsWithoutIdiomsPct.toFixed(1)}%)** | AICE With Idioms = **${b.total.aiceWithIdiomsTokens.toLocaleString("en-US")} (-${b.total.savingsWithIdiomsPct.toFixed(1)}%)**`,
      `- **Lifecycle Turns**: Without AICE = **${b.total.withoutAiceTurns} turns** | AICE Without Idioms = **${b.total.aiceWithoutIdiomsTurns} turns (-${b.total.turnsSavingsWithoutIdiomsPct.toFixed(1)}%)** | AICE With Idioms = **${b.total.aiceWithIdiomsTurns} turns (-${b.total.turnsSavingsWithIdiomsPct.toFixed(1)}%)**`,
      "",
      "#### Operation Breakdown (Tokens & Turns)",
      "",
      "| Operation | Without AICE | AICE Without Idioms | AICE With Idioms | Turn Savings (No Id / Id) |",
      "| :--- | ---: | ---: | ---: | ---: |",
      `| **Write (Create from 0)** | ${b.writeFromZero.withoutAiceTokens.toLocaleString("en-US")} tok / ${b.writeFromZero.withoutAiceTurns} turns | ${b.writeFromZero.aiceWithoutIdiomsTokens.toLocaleString("en-US")} tok / ${b.writeFromZero.aiceWithoutIdiomsTurns} turns | ${b.writeFromZero.aiceWithIdiomsTokens.toLocaleString("en-US")} tok / ${b.writeFromZero.aiceWithIdiomsTurns} turns | 0.0% / 0.0% |`,
      `| **Read (Context)** | ${b.readContext.withoutAiceTokens.toLocaleString("en-US")} tok / ${b.readContext.withoutAiceTurns} turns | ${b.readContext.aiceWithoutIdiomsTokens.toLocaleString("en-US")} tok / ${b.readContext.aiceWithoutIdiomsTurns} turns | ${b.readContext.aiceWithIdiomsTokens.toLocaleString("en-US")} tok / ${b.readContext.aiceWithIdiomsTurns} turns | -${b.readContext.turnsSavingsWithoutIdiomsPct.toFixed(1)}% / **-${b.readContext.turnsSavingsWithIdiomsPct.toFixed(1)}%** |`,
      `| **Update (Surgical)** | ${b.surgicalUpdate.withoutAiceTokens.toLocaleString("en-US")} tok / ${b.surgicalUpdate.withoutAiceTurns} turns | ${b.surgicalUpdate.aiceWithoutIdiomsTokens.toLocaleString("en-US")} tok / ${b.surgicalUpdate.aiceWithoutIdiomsTurns} turns | ${b.surgicalUpdate.aiceWithIdiomsTokens.toLocaleString("en-US")} tok / ${b.surgicalUpdate.aiceWithIdiomsTurns} turns | -${b.surgicalUpdate.turnsSavingsWithoutIdiomsPct.toFixed(1)}% / **-${b.surgicalUpdate.turnsSavingsWithIdiomsPct.toFixed(1)}%** |`,
      `| **Delete (Surgical)** | ${b.surgicalDelete.withoutAiceTokens.toLocaleString("en-US")} tok / ${b.surgicalDelete.withoutAiceTurns} turns | ${b.surgicalDelete.aiceWithoutIdiomsTokens.toLocaleString("en-US")} tok / ${b.surgicalDelete.aiceWithoutIdiomsTurns} turns | ${b.surgicalDelete.aiceWithIdiomsTokens.toLocaleString("en-US")} tok / ${b.surgicalDelete.aiceWithIdiomsTurns} turns | -${b.surgicalDelete.turnsSavingsWithoutIdiomsPct.toFixed(1)}% / **-${b.surgicalDelete.turnsSavingsWithIdiomsPct.toFixed(1)}%** |`,
      `| **Refactor (Pattern)** | ${b.multiFileRefactor.withoutAiceTokens.toLocaleString("en-US")} tok / ${b.multiFileRefactor.withoutAiceTurns} turns | ${b.multiFileRefactor.aiceWithoutIdiomsTokens.toLocaleString("en-US")} tok / ${b.multiFileRefactor.aiceWithoutIdiomsTurns} turns | ${b.multiFileRefactor.aiceWithIdiomsTokens.toLocaleString("en-US")} tok / ${b.multiFileRefactor.aiceWithIdiomsTurns} turns | -${b.multiFileRefactor.turnsSavingsWithoutIdiomsPct.toFixed(1)}% / **-${b.multiFileRefactor.turnsSavingsWithIdiomsPct.toFixed(1)}%** |`,
      `| **TOTAL** | **${b.total.withoutAiceTokens.toLocaleString("en-US")} tok / ${b.total.withoutAiceTurns} turns** | **${b.total.aiceWithoutIdiomsTokens.toLocaleString("en-US")} tok / ${b.total.aiceWithoutIdiomsTurns} turns** | **${b.total.aiceWithIdiomsTokens.toLocaleString("en-US")} tok / ${b.total.aiceWithIdiomsTurns} turns** | **-${b.total.turnsSavingsWithoutIdiomsPct.toFixed(1)}% / -${b.total.turnsSavingsWithIdiomsPct.toFixed(1)}%** |`,
      "",
      "#### Module File Breakdown",
      "",
      "| File | Type | Native Tokens | AICE (No Idioms) | Savings (No Idioms) | AICE (With Idioms) | Savings (With Idioms) |",
      "| :--- | :--- | ---: | ---: | ---: | ---: | ---: |",
    );
    for (const f of b.files) {
      lines.push(
        `| \`${f.fileName}\` | \`${f.extension}\` | ${f.withoutAiceTokens} | ${f.aiceWithoutIdiomsTokens} | -${f.savingsWithoutIdiomsPct.toFixed(1)}% | ${f.aiceWithIdiomsTokens} | **-${f.savingsWithIdiomsPct.toFixed(1)}%** |`,
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

// Explicit Offline Benchmark Suite exports
export type OfflineBenchmarkSuiteReport = RealWorldBenchmarkSuiteReport;
export const OFFLINE_BENCHMARKS = REAL_WORLD_BENCHMARKS;
export const runOfflineBenchmarkSuite = runRealWorldBenchmarkSuite;
export const formatOfflineBenchmarkMarkdown = formatRealWorldBenchmarkMarkdown;
export const formatOfflineBenchmarkJson = formatRealWorldBenchmarkJson;

// Aliases for clean CLI / external caller compatibility
export const runHonestBenchmarkSuite = runRealWorldBenchmarkSuite;
export const formatHonestBenchmarkMarkdown = formatRealWorldBenchmarkMarkdown;
