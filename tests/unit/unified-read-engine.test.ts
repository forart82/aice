/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit test suite for the AICE Pillar 1 Unified Read Engine (`src/tools/read.ts`):
 * - Inline selector parsing (`file:sym1,sym2`, `file:L10-L50`, `file:/pattern/`, `dir:/pattern/`, `file:outline`, `dir:outline`)
 * - Automatic directory structural outline (`aiceRead("src/rules")`, multi-directory `["src", "tests"]`)
 * - Automatic >250-line bare file structural outline with guidance header
 * - `--full` (`options.full: true`) override on >250-line files
 * - `<=250`-line bare file full context pack (including exact 250-line boundary)
 * - Explicit `:outline` selector and `options.outline: true`
 * - Exact line-range extraction (`:Lstart-Lend`)
 * - 4-tier ranked regex search (`:/pattern/` and `-s "/pattern/"`) across directories and files
 * - `:Class.method` slicing with Adaptive Sibling Outlining, dependency contracts, downstream callers, & shared `WorkspaceCallerScanCache`
 * - Mixed multi-target streams, workspace overview, `--json`, `--stats`, `maxTokens`, `includeCallers`, `idioms`, and disabled config enforcement
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { program } from "../../bin/aice.js";
import { AICE_DISABLED_MESSAGE } from "../../src/config/index.js";
import { readTelemetryEvents, type TelemetryEvent } from "../../src/telemetry/index.js";
import { estimateTokens } from "../../src/tokenomics/index.js";
import {
  aiceRead,
  computeDynamicReadBudget,
  computeDynamicSliceSpan,
  computeLineRangeBaselineText,
  computeRegexBaselineText,
  countSourceLines,
  DEFAULT_CLI_READ_MAX_BYTES,
  DEFAULT_READ_MAX_BYTES,
  generateContext,
  normalizeReadTargets,
  parseReadTarget,
  read,
  splice,
  splitReadTargetString,
} from "../../src/tools/index.js";

describe("Unified Read Engine (`aiceRead`)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aice-unified-read-"));
    fs.writeFileSync(
      path.join(tmpDir, "aice.config.json"),
      JSON.stringify(
        {
          enabled: true,
          idiomsEnabled: true,
          idioms: {
            $clampUnit: {
              name: "$clampUnit",
              kind: "expr",
              params: [{ name: "$0", kind: "expr" }],
              templateAice: "Math.min(Math.max($0, 0), 1)",
              occurrences: 3,
              tokensPerOccurrenceSaved: 5,
              netTokenSavings: 15,
            },
          },
        },
        null,
        2,
      ),
      "utf-8",
    );

    fs.mkdirSync(path.join(tmpDir, "src", "rules"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "tests"), { recursive: true });

    // Shared dependency contract (< 250 lines)
    fs.writeFileSync(
      path.join(tmpDir, "src", "contracts.ts"),
      [
        "export interface MetricConfig {",
        "  weight: number;",
        "  label: string;",
        "}",
        "",
        "export const DEFAULT_WEIGHT = 2;",
        "",
      ].join("\n"),
      "utf-8",
    );

    // Small file (<= 250 lines) with idiom usage & imports
    fs.writeFileSync(
      path.join(tmpDir, "src", "small.ts"),
      [
        'import { DEFAULT_WEIGHT, type MetricConfig } from "./contracts.js";',
        "",
        "export class SmallCalculator {",
        "  public compute(cfg: MetricConfig, raw: number): string {",
        "    const clamped = Math.min(Math.max(raw, 0), 1);",
        "    const scaled = clamped * (cfg.weight || DEFAULT_WEIGHT);",
        '    return cfg.label + ":" + String(scaled);',
        "  }",
        "",
        "  public reset(): void {}",
        "}",
        "",
      ].join("\n"),
      "utf-8",
    );

    // Directory files under src/rules
    fs.writeFileSync(
      path.join(tmpDir, "src", "rules", "alpha-rule.ts"),
      [
        "export interface RuleVerdict {",
        "  passed: boolean;",
        "  reason: string;",
        "}",
        "",
        "export function evaluateAlphaRule(input: string): RuleVerdict {",
        '  const marker = "UNIQUE_SEARCH_BEACON";',
        "  return { passed: input.includes(marker), reason: marker };",
        "}",
        "",
      ].join("\n"),
      "utf-8",
    );

    fs.writeFileSync(
      path.join(tmpDir, "src", "rules", "beta-rule.ts"),
      [
        "export class BetaRuleEngine {",
        "  public check(code: string): boolean {",
        "    return code.trim().length > 0;",
        "  }",
        "}",
        "",
      ].join("\n"),
      "utf-8",
    );

    // Large file (> 250 lines, specifically 280 lines) importing MetricConfig
    const largeLines: string[] = [
      'import { type MetricConfig } from "./contracts.js";',
      "",
      "export class LargeService {",
      "  public computeMetric(cfg: MetricConfig, factor: number): number {",
      "    const secretBodyMarker = 987654321;",
      "    return cfg.weight * factor + (secretBodyMarker - 987654321);",
      "  }",
      "",
      "  public helperSiblingA(flag: boolean): string {",
      '    return flag ? "on" : "off";',
      "  }",
      "",
      "  public helperSiblingB(): number {",
      "    return 42;",
      "  }",
      "}",
      "",
    ];
    let idx = 1;
    while (largeLines.length + 4 <= 280) {
      largeLines.push(`export function generatedHelper${idx}(val: number): number {`);
      largeLines.push(`  const localStep${idx} = val + ${idx};`);
      largeLines.push(`  return localStep${idx} * 2;`);
      largeLines.push("}");
      idx++;
    }
    while (largeLines.length < 280) {
      largeLines.push(`export const EXTRA_LINE_${largeLines.length} = ${largeLines.length};`);
    }
    const exact280Lines = `${largeLines.join("\n")}\n`;
    fs.writeFileSync(path.join(tmpDir, "src", "large.ts"), exact280Lines, "utf-8");

    // Downstream caller & test file under tests/
    fs.writeFileSync(
      path.join(tmpDir, "tests", "service.test.ts"),
      [
        'import { describe, expect, it } from "vitest";',
        'import { LargeService } from "../src/large.js";',
        'import { SmallCalculator } from "../src/small.js";',
        "",
        'describe("Service suite", () => {',
        '  it("TC-READ-001: exercises LargeService and SmallCalculator", () => {',
        "    const svc = new LargeService();",
        "    const calc = new SmallCalculator();",
        "    // comment mentioning UNIQUE_SEARCH_BEACON in test",
        '    expect(svc.computeMetric({ weight: 3, label: "m" }, 2)).toBe(6);',
        '    expect(calc.compute({ weight: 2, label: "c" }, 0.5)).toBe("c:1");',
        "  });",
        "});",
        "",
      ].join("\n"),
      "utf-8",
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("Inline selector & multi-target parsing", () => {
    it("splits inline selectors cleanly across symbols, ranges, regexes, and :outline", () => {
      expect(parseReadTarget("src/a.ts:fnA,fnB", tmpDir)).toEqual({
        raw: "src/a.ts:fnA,fnB",
        targetPath: "src/a.ts",
        inlineSelector: "fnA,fnB",
        explicitOutline: false,
      });

      expect(parseReadTarget("src/b.ts:L10-L50", tmpDir)).toEqual({
        raw: "src/b.ts:L10-L50",
        targetPath: "src/b.ts",
        inlineSelector: "L10-L50",
        explicitOutline: false,
      });

      expect(parseReadTarget("src/rules:/UNIQUE_SEARCH_BEACON/i", tmpDir)).toEqual({
        raw: "src/rules:/UNIQUE_SEARCH_BEACON/i",
        targetPath: "src/rules",
        inlineSelector: "/UNIQUE_SEARCH_BEACON/i",
        explicitOutline: false,
      });

      expect(parseReadTarget("src/small.ts:outline", tmpDir)).toEqual({
        raw: "src/small.ts:outline",
        targetPath: "src/small.ts",
        explicitOutline: true,
      });

      expect(parseReadTarget("src/rules:outline", tmpDir)).toEqual({
        raw: "src/rules:outline",
        targetPath: "src/rules",
        explicitOutline: true,
      });

      expect(parseReadTarget("C:\\repo\\src\\a.ts:MyClass.run", tmpDir)).toEqual({
        raw: "C:\\repo\\src\\a.ts:MyClass.run",
        targetPath: "C:\\repo\\src\\a.ts",
        inlineSelector: "MyClass.run",
        explicitOutline: false,
      });
    });

    it("preserves spaces inside inline /regex/ selectors while splitting multi-target streams", () => {
      expect(splitReadTargetString("src/rules:/aice read/", tmpDir)).toEqual([
        "src/rules:/aice read/",
      ]);
      expect(
        splitReadTargetString("src/rules:/aice read/ src/small.ts:L1-L5 src/rules", tmpDir),
      ).toEqual(["src/rules:/aice read/", "src/small.ts:L1-L5", "src/rules"]);

      const normalized = normalizeReadTargets(["src tests", "src/small.ts:outline"], tmpDir);
      expect(normalized.map((n) => ({ path: n.targetPath, outline: n.explicitOutline }))).toEqual([
        { path: "src", outline: false },
        { path: "tests", outline: false },
        { path: "src/small.ts", outline: true },
      ]);
    });

    it("counts source lines accurately with or without trailing newline", () => {
      expect(countSourceLines("")).toBe(0);
      expect(countSourceLines("one")).toBe(1);
      expect(countSourceLines("one\n")).toBe(1);
      expect(countSourceLines("one\r\n")).toBe(1);
      const exact250 = `${Array.from({ length: 250 }, (_, i) => `const v${i} = ${i};`).join("\n")}\n`;
      expect(countSourceLines(exact250)).toBe(250);
    });
  });

  describe("Automatic Engine Routing", () => {
    it("auto-outlines a directory target without dumping full file implementations", async () => {
      const res = await aiceRead("src/rules", { projectRoot: tmpDir });

      expect(res.mode).toBe("auto-outline-dir");
      expect(res.text).toContain("src/rules/alpha-rule.ts");
      expect(res.text).toContain("src/rules/beta-rule.ts");
      expect(res.text).toContain("evaluateAlphaRule");
      expect(res.text).toContain("BetaRuleEngine");
      // Body implementation constant inside evaluateAlphaRule should NOT be dumped in outline
      expect(res.text).not.toContain("UNIQUE_SEARCH_BEACON");
    });

    it("supports multi-directory read cleanly via array and space-separated string", async () => {
      const resArr = await aiceRead(["src/rules", "tests"], { projectRoot: tmpDir });
      expect(resArr.mode).toBe("auto-outline-dir");
      expect(resArr.text).toContain("src/rules/alpha-rule.ts");
      expect(resArr.text).toContain("src/rules/beta-rule.ts");
      expect(resArr.text).toContain("tests/service.test.ts");
      expect(resArr.text).toContain("TC-READ-001");

      const resStr = await aiceRead("src/rules tests", { projectRoot: tmpDir });
      expect(resStr.mode).toBe("auto-outline-dir");
      expect(resStr.stats.fileCount).toBe(3);
    });

    it("renders <=28 KB bare files inline in 1 turn and auto-outlines bare files exceeding the 28 KB budget (or explicit autoOutlineLineThreshold)", async () => {
      // 280-line (~8.5 KB) bare file fits comfortably in the 28 KB budget -> inline numbered native in 1 turn
      const inlineLarge = await aiceRead("src/large.ts", { projectRoot: tmpDir });
      expect(inlineLarge.mode).toBe("context");
      expect(inlineLarge.text).not.toContain("// Auto-outlined");
      expect(inlineLarge.text).toContain("1│ import { type MetricConfig }");
      expect(inlineLarge.text).toContain("987654321");

      // Explicit autoOutlineLineThreshold override is still honored when passed
      const explicitThresholdRes = await aiceRead("src/large.ts", {
        projectRoot: tmpDir,
        autoOutlineLineThreshold: 250,
      });
      expect(explicitThresholdRes.mode).toBe("auto-outline-file");
      expect(explicitThresholdRes.targets[0]?.autoOutlined).toBe(true);
      expect(explicitThresholdRes.targets[0]?.lineCount).toBe(280);
      expect(explicitThresholdRes.text).toContain(
        "// Auto-outlined (280 lines). Pass src/large.ts:<symbol>, src/large.ts:L<start>-L<end>, or --full for full source.",
      );

      // >28 KB bare file auto-outlines automatically with symbol-snapped next-slice hint
      const over28kbLines = [
        'import { type MetricConfig } from "./contracts.js";',
        ...Array.from(
          { length: 340 },
          (_, i) =>
            `export function computeOverBudget_${i}(cfg: MetricConfig): number { const secretOverBudget = 987654321; return cfg.weight + ${i} + (secretOverBudget - 987654321); }`,
        ),
      ].join("\n");
      fs.writeFileSync(path.join(tmpDir, "src", "over28kb.ts"), `${over28kbLines}\n`, "utf-8");

      const res = await aiceRead("src/over28kb.ts", { projectRoot: tmpDir });
      expect(res.mode).toBe("auto-outline-file");
      expect(res.targets[0]?.autoOutlined).toBe(true);
      expect(res.targets[0]?.lineCount).toBe(341);
      expect(res.text).toContain(
        "// Auto-outlined (341 lines). Pass src/over28kb.ts:<symbol>, src/over28kb.ts:L<start>-L<end>, or --full for full source.",
      );
      expect(res.text).toMatch(/next slice: aice read src\/over28kb\.ts:L1-L\d+/);
      expect(res.text).toContain("computeOverBudget_0");
      expect(res.text).not.toContain("987654321");
    });

    it("bypasses >28 KB auto-outline when options.full is true", async () => {
      const over28kbLines = [
        'import { type MetricConfig } from "./contracts.js";',
        ...Array.from(
          { length: 340 },
          (_, i) =>
            `export function computeOverBudgetFull_${i}(cfg: MetricConfig): number { const secretMarker = 987654321; return cfg.weight + ${i} + (secretMarker - 987654321); }`,
        ),
      ].join("\n");
      fs.writeFileSync(path.join(tmpDir, "src", "over28kb_full.ts"), `${over28kbLines}\n`, "utf-8");

      const res = await aiceRead("src/over28kb_full.ts", { projectRoot: tmpDir, full: true });

      expect(res.mode).toBe("context");
      expect(res.text).not.toContain("// Auto-outlined");
      expect(res.text).toContain("987654321");
      expect(res.dependencies.length).toBeGreaterThan(0);
      expect(res.text).toContain("MetricConfig");
    });

    it("returns zero-envelope fast path for <=150-line bare files and 1-turn numbered context pack for >150-line files within 28 KB", async () => {
      const smallRes = await aiceRead("src/small.ts", { projectRoot: tmpDir });
      expect(smallRes.mode).toBe("context");
      expect(smallRes.text).not.toContain("// Auto-outlined");
      expect(smallRes.text).toContain("// === src/small.ts ===");
      expect(smallRes.text).toContain("1│ import { DEFAULT_WEIGHT, type MetricConfig }");
      expect(smallRes.text).not.toContain("# AICE Context Pack");
      expect(smallRes.text).not.toContain("Downstream Callers");
      expect(smallRes.dependencies).toHaveLength(0);
      expect(smallRes.callers).toHaveLength(0);

      // Explicit --deps / --callers opt-in restores full context pack on <=150-line file
      const smallOptInRes = await aiceRead("src/small.ts", {
        projectRoot: tmpDir,
        includeDeps: true,
        includeCallers: true,
      });
      expect(smallOptInRes.text).toContain("# AICE Context Pack: src/small.ts");
      expect(smallOptInRes.text).toContain("MetricConfig");
      expect(smallOptInRes.text).toContain("Downstream Callers");

      // 250-line bare file within 28 KB gets full context pack with numbered native lines in 1 turn
      const boundaryPath = path.join(tmpDir, "src", "boundary250.ts");
      const lines250 = `${Array.from({ length: 250 }, (_, i) => `export const b${i} = ${i};`).join("\n")}\n`;
      fs.writeFileSync(boundaryPath, lines250, "utf-8");

      const boundaryRes = await aiceRead("src/boundary250.ts", { projectRoot: tmpDir });
      expect(boundaryRes.mode).toBe("context");
      expect(boundaryRes.text).not.toContain("// Auto-outlined");
      expect(boundaryRes.text).toContain("# AICE Context Pack: src/boundary250.ts");
      expect(boundaryRes.text).toContain("250│ export const b249 = 249;");
    });

    it("applies explicit outlinePath for :outline selector and options.outline: true without auto-outline banner", async () => {
      const inlineRes = await aiceRead("src/small.ts:outline", { projectRoot: tmpDir });
      expect(inlineRes.mode).toBe("outline");
      expect(inlineRes.text).not.toContain("// Auto-outlined");
      expect(inlineRes.text).toContain("SmallCalculator");
      expect(inlineRes.text).not.toContain("# AICE Context Pack");

      const flagRes = await aiceRead("src/small.ts", { projectRoot: tmpDir, outline: true });
      expect(flagRes.mode).toBe("outline");
      expect(flagRes.text).toContain("SmallCalculator");

      const dirInlineRes = await aiceRead("src/rules:outline", { projectRoot: tmpDir });
      expect(dirInlineRes.mode).toBe("outline");
      expect(dirInlineRes.text).toContain("evaluateAlphaRule");
    });

    it("routes :Lstart-Lend line ranges to numbered line extraction even on >250-line files", async () => {
      const res = await aiceRead("src/large.ts:L4-L7", { projectRoot: tmpDir });

      expect(res.mode).toBe("context");
      expect(res.text).not.toContain("// Auto-outlined");
      expect(res.text).toContain("4│");
      expect(res.text).toContain("987654321");
    });

    it("routes directory and file :/pattern/ queries to 4-tier ranked search", async () => {
      const dirInlineSearch = await aiceRead("src:/UNIQUE_SEARCH_BEACON/", {
        projectRoot: tmpDir,
      });
      expect(dirInlineSearch.mode).toBe("search");
      expect(dirInlineSearch.text).toContain("src/rules/alpha-rule.ts");
      expect(dirInlineSearch.text).toContain("UNIQUE_SEARCH_BEACON");

      // Across entire workspace, production hit in src/rules/alpha-rule.ts ranks before test comment hit
      const rootSearch = await aiceRead(".", {
        projectRoot: tmpDir,
        symbol: "/UNIQUE_SEARCH_BEACON/",
      });
      expect(rootSearch.mode).toBe("search");
      const prodIdx = rootSearch.text.indexOf("src/rules/alpha-rule.ts");
      const testIdx = rootSearch.text.indexOf("tests/service.test.ts");
      expect(prodIdx).toBeGreaterThanOrEqual(0);
      if (testIdx >= 0) {
        expect(prodIdx).toBeLessThan(testIdx);
      }

      const fileSearch = await aiceRead("src/large.ts:/secretBodyMarker/", {
        projectRoot: tmpDir,
      });
      expect(fileSearch.mode).toBe("search");
      expect(fileSearch.text).toContain("secretBodyMarker");
    });

    it("slices :Class.method with Adaptive Sibling Outlining, dependency contracts, and downstream callers", async () => {
      const res = await aiceRead("src/large.ts:LargeService.computeMetric", {
        projectRoot: tmpDir,
      });

      expect(res.mode).toBe("context");
      expect(res.text).toContain("computeMetric");
      expect(res.text).toContain("987654321");
      // Adaptive Sibling Outlining
      expect(res.text).toContain("// siblings in LargeService:");
      expect(res.text).toContain("helperSiblingA");
      expect(res.text).toContain("helperSiblingB");
      // Imported dependency contract
      expect(res.text).toContain("MetricConfig");
      // Downstream caller with call-site line
      expect(res.text).toContain("tests/service.test.ts");
      expect(res.callers.length).toBeGreaterThan(0);
    });

    it("handles mixed multi-target streams combining symbol slices, line ranges, and directory outlines", async () => {
      const res = await aiceRead(
        ["src/large.ts:LargeService.computeMetric", "src/small.ts:L3-L8", "src/rules"],
        { projectRoot: tmpDir },
      );

      expect(res.mode).toBe("mixed");
      expect(res.text).toContain("computeMetric");
      expect(res.text).toContain("SmallCalculator");
      expect(res.text).toContain("## Outlined Targets:");
      expect(res.text).toContain("src/rules/alpha-rule.ts");
      expect(res.text).toContain("evaluateAlphaRule");
    });

    it("slices test blocks by ID (:TC-READ-001) and Markdown headings (:Quick Start)", async () => {
      const testSlice = await aiceRead("tests/service.test.ts:TC-READ-001", {
        projectRoot: tmpDir,
      });
      expect(testSlice.mode).toBe("context");
      expect(testSlice.text).toContain("TC-READ-001");
      expect(testSlice.text).toContain("computeMetric");

      const readmePath = path.join(tmpDir, "README.md");
      fs.writeFileSync(
        readmePath,
        [
          "# Project Overview",
          "Intro text.",
          "",
          "## Quick Start",
          "Run `aice read src` to inspect the project.",
          "",
          "## License",
          "Apache-2.0",
          "",
        ].join("\n"),
        "utf-8",
      );
      const mdSlice = await aiceRead("README.md:Quick Start", { projectRoot: tmpDir });
      expect(mdSlice.mode).toBe("context");
      expect(mdSlice.text).toContain("Quick Start");
      expect(mdSlice.text).toContain("aice read src");
    });

    it("reconciles shared multi-symbol selectors across files and reports partial missing targets gracefully", async () => {
      const sharedSym = await aiceRead(["src/small.ts", "src/large.ts"], {
        projectRoot: tmpDir,
        symbol: "SmallCalculator.compute,LargeService.computeMetric",
      });
      expect(sharedSym.mode).toBe("context");
      expect(sharedSym.text).toContain("compute");
      expect(sharedSym.text).toContain("computeMetric");
      expect(sharedSym.text).not.toContain("// missing:");

      const partialMissing = await aiceRead(
        [
          { path: path.join(tmpDir, "src", "small.ts"), symbol: "SmallCalculator.compute" },
          { path: "src/nonexistent.ts" },
        ],
        { projectRoot: tmpDir },
      );
      expect(partialMissing.text).toContain("compute");
      expect(partialMissing.text).toContain("// not found: src/nonexistent.ts");
      expect(partialMissing.missingTargets).toEqual(["src/nonexistent.ts"]);
    });
  });

  describe("Options: workspace overview, json, stats, maxTokens, includeCallers, idioms, disabled gate", () => {
    it("supports omitted target for workspace overview", async () => {
      const res = await aiceRead(undefined, { projectRoot: tmpDir });
      expect(res.mode).toBe("workspace");
      expect(res.text).toContain("# AICE Directory Outline:");
      expect(res.text).toContain("src/contracts.ts");
      expect(res.text).toContain("src/small.ts");
    });

    it("supports options.json and options.stats on both context and outline routes", async () => {
      const over28JsonLines = Array.from(
        { length: 340 },
        (_, i) =>
          `export function jsonHeavyFn_${i}(label: string): string { return label + "_json_${i}"; }`,
      ).join("\n");
      fs.writeFileSync(
        path.join(tmpDir, "src", "over28kb_json.ts"),
        `${over28JsonLines}\n`,
        "utf-8",
      );

      const outlineJson = await aiceRead("src/over28kb_json.ts", {
        projectRoot: tmpDir,
        json: true,
        stats: true,
      });
      expect(outlineJson.jsonOutput).toBeDefined();
      const parsedOutline = JSON.parse(outlineJson.output) as {
        autoOutlined?: boolean;
        lineCount?: number;
        symbols: unknown[];
      };
      expect(parsedOutline.autoOutlined).toBe(true);
      expect(parsedOutline.lineCount).toBe(340);
      expect(Array.isArray(parsedOutline.symbols)).toBe(true);
      expect(outlineJson.stats.originalTokens).toBeGreaterThan(0);

      const ctxStats = await aiceRead("src/small.ts", {
        projectRoot: tmpDir,
        stats: true,
      });
      expect(ctxStats.statsText).toContain("📊 Context Pack Token Telemetry:");
      expect(ctxStats.output).toContain("📊 Context Pack Token Telemetry:");

      const multiCtxJson = await aiceRead(
        ["src/small.ts:SmallCalculator.compute", "src/large.ts:LargeService.computeMetric"],
        { projectRoot: tmpDir, json: true },
      );
      const parsedMulti = JSON.parse(multiCtxJson.output) as Array<{ targetPath: string }>;
      expect(Array.isArray(parsedMulti)).toBe(true);
      expect(parsedMulti).toHaveLength(2);
    });

    it("respects maxTokens, includeCallers: false, depth, and idioms toggles", async () => {
      const noCallers = await aiceRead("src/small.ts", {
        projectRoot: tmpDir,
        includeCallers: false,
        depth: 0,
      });
      expect(noCallers.callers).toHaveLength(0);
      expect(noCallers.dependencies).toHaveLength(0);

      const withIdioms = await aiceRead("src/small.ts", {
        projectRoot: tmpDir,
        idioms: true,
      });
      expect(withIdioms.text).toContain("$clampUnit");

      const withoutIdioms = await aiceRead("src/small.ts", {
        projectRoot: tmpDir,
        idioms: false,
      });
      expect(withoutIdioms.text).not.toContain("$clampUnit(");

      const bounded = await aiceRead("src/large.ts", {
        projectRoot: tmpDir,
        maxTokens: 45,
      });
      expect(bounded.tokenCount).toBeLessThanOrEqual(45);
      expect(bounded.text).toContain("truncated to fit maxTokens");
    });

    it("throws AICE_DISABLED_MESSAGE when aice.config.json has enabled: false", async () => {
      fs.writeFileSync(
        path.join(tmpDir, "aice.config.json"),
        JSON.stringify({ enabled: false }, null, 2),
        "utf-8",
      );
      await expect(aiceRead("src/small.ts", { projectRoot: tmpDir })).rejects.toThrow(
        AICE_DISABLED_MESSAGE,
      );
    });
  });

  describe("File Format Detection, Shebang & Passthrough Routing", () => {
    it("parses CITATION.cff cleanly as YAML without TypeScript decompiler mangling", async () => {
      const cffContent = [
        "cff-version: 1.2.0",
        'message: "If you use this software, please cite it as below."',
        'title: "AICE"',
        "version: 0.9.35",
        'repository-code: "https://github.com/forart82/aice"',
        "license: Apache-2.0",
      ].join("\n");
      fs.writeFileSync(path.join(tmpDir, "CITATION.cff"), cffContent, "utf-8");

      const res = await aiceRead("CITATION.cff", { projectRoot: tmpDir });
      expect(res.text).not.toContain("_ :=");
      expect(res.text).not.toContain("cff - version");
      expect(res.text).toContain("cff-version");
      expect(res.text).toContain("Apache-2.0");
    });

    it("detects extensionless #!/bin/sh scripts as shell and never mangles if/then/fi into _ := then", async () => {
      const hookContent = [
        "#!/bin/sh",
        "set -e",
        'if [ "$STAGED" = "1" ]; then',
        '  echo "staged changes detected"',
        "  exit 0",
        "fi",
      ].join("\n");
      const hookPath = path.join(tmpDir, ".git", "hooks", "pre-commit");
      fs.mkdirSync(path.dirname(hookPath), { recursive: true });
      fs.writeFileSync(hookPath, hookContent, "utf-8");

      const res = await aiceRead(".git/hooks/pre-commit", { projectRoot: tmpDir });
      expect(res.text).not.toContain("_ :=");
      expect(res.text).not.toContain("_ := then");
      expect(res.text).toContain('if [ "$STAGED" = "1" ]; then');
      expect(res.text).toContain("fi");
    });

    it("passes through unrecognized files cleanly with zero TS decompiler fallback noise", async () => {
      const tomlContent = [
        "[package]",
        'name = "sample-crate"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
        "[dependencies]",
        'serde = "1.0"',
      ].join("\n");
      fs.writeFileSync(path.join(tmpDir, "Cargo.toml"), tomlContent, "utf-8");

      const licenseContent = [
        "Apache License",
        "Version 2.0, January 2004",
        "http://www.apache.org/licenses/",
        "",
        "TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION",
      ].join("\n");
      fs.writeFileSync(path.join(tmpDir, "LICENSE"), licenseContent, "utf-8");

      const tomlRes = await aiceRead("Cargo.toml", { projectRoot: tmpDir });
      expect(tomlRes.text).not.toContain("_ :=");
      expect(tomlRes.text).not.toContain("[AICE AST Fallback]");
      expect(tomlRes.text).toContain("[package]");
      expect(tomlRes.text).toContain("serde");

      // Line-range slicing on passthrough
      const tomlSlice = await aiceRead("Cargo.toml:L1-L4", { projectRoot: tmpDir });
      expect(tomlSlice.text).toContain("1│ [package]");
      expect(tomlSlice.text).toContain('4│ edition = "2021"');
      expect(tomlSlice.text).not.toContain("serde");

      // Pattern search on passthrough
      const tomlSearch = await aiceRead("Cargo.toml:/dependencies/", { projectRoot: tmpDir });
      expect(tomlSearch.text).toContain("[dependencies]");

      // LICENSE passthrough
      const licRes = await aiceRead("LICENSE", { projectRoot: tmpDir });
      expect(licRes.text).not.toContain("_ :=");
      expect(licRes.text).not.toContain("class name:");
      expect(licRes.text).toContain("Apache License");
    });
  });

  describe("Zero-Envelope Fast Path, Opt-In Flags & Idioms Default (Steps 3.1-3.3)", () => {
    it("emits minimal // === header with zero envelope on :Lstart-Lend, :/pattern/, config/doc files, and <=150-line bare files", async () => {
      fs.writeFileSync(
        path.join(tmpDir, "package.json"),
        JSON.stringify({ name: "fast-pkg", version: "1.0.0" }, null, 2),
        "utf-8",
      );
      fs.writeFileSync(path.join(tmpDir, "config.yaml"), "port: 8080\nhost: localhost\n", "utf-8");
      fs.writeFileSync(path.join(tmpDir, "styles.css"), ".btn { color: #fff; }\n", "utf-8");
      fs.writeFileSync(path.join(tmpDir, "index.html"), "<div>Hello</div>\n", "utf-8");
      fs.writeFileSync(path.join(tmpDir, "deploy.sh"), "#!/usr/bin/env bash\necho ok\n", "utf-8");

      // 1. :Lstart-Lend line slice
      const lineRes = await aiceRead("src/large.ts:L1-L5", { projectRoot: tmpDir });
      expect(lineRes.text.startsWith("// === ")).toBe(true);
      expect(lineRes.text).not.toContain("# AICE Context Pack");
      expect(lineRes.text).not.toContain("Imported Dependency Contracts");
      expect(lineRes.text).not.toContain("Downstream Callers");
      expect(lineRes.text).not.toContain("// siblings in");
      expect(lineRes.dependencies).toHaveLength(0);
      expect(lineRes.callers).toHaveLength(0);

      // 2. :/pattern/ on file and directory
      const fileRegexRes = await aiceRead("src/small.ts:/SmallCalculator/", {
        projectRoot: tmpDir,
      });
      expect(fileRegexRes.text.startsWith("// === ")).toBe(true);
      expect(fileRegexRes.text).not.toContain("# AICE Context Pack");
      expect(fileRegexRes.text).not.toContain("Imported Dependency Contracts");
      expect(fileRegexRes.text).not.toContain("Downstream Callers");

      const dirRegexRes = await aiceRead("src:/SmallCalculator/", { projectRoot: tmpDir });
      expect(dirRegexRes.text.startsWith("// === ")).toBe(true);
      expect(dirRegexRes.text).not.toContain("# AICE Workspace Context");
      expect(dirRegexRes.text).not.toContain("Imported Dependency Contracts");
      expect(dirRegexRes.text).not.toContain("Downstream Callers");

      // 3. Multi-target stream of config, doc, script, style, and line-slice targets
      const multiFastRes = await aiceRead(
        [
          "package.json",
          "config.yaml",
          "README.md",
          "styles.css",
          "index.html",
          "deploy.sh",
          "src/small.ts:L1-L4",
        ],
        { projectRoot: tmpDir },
      );
      expect(multiFastRes.text).toContain("// === package.json ===");
      expect(multiFastRes.text).toContain("// === config.yaml ===");
      expect(multiFastRes.text).toContain("// === README.md ===");
      expect(multiFastRes.text).toContain("// === styles.css ===");
      expect(multiFastRes.text).toContain("// === index.html ===");
      expect(multiFastRes.text).toContain("// === deploy.sh ===");
      expect(multiFastRes.text).not.toContain("# AICE Multi-File Context Stream");
      expect(multiFastRes.text).not.toContain("Imported Dependency Contracts");
      expect(multiFastRes.text).not.toContain("Downstream Callers");
    });

    it("honors explicit --deps and --callers opt-in overrides via both programmatic API and CLI", async () => {
      // Programmatic opt-in on line slice & small file
      const depsSliceRes = await aiceRead("src/small.ts:L1-L8", {
        projectRoot: tmpDir,
        includeDeps: true,
      });
      expect(depsSliceRes.text).toContain("# AICE Context Pack: src/small.ts");
      expect(depsSliceRes.text).toContain("MetricConfig");
      expect(depsSliceRes.dependencies.length).toBeGreaterThan(0);

      const callersSmallRes = await aiceRead("src/contracts.ts", {
        projectRoot: tmpDir,
        includeCallers: true,
      });
      expect(callersSmallRes.text).toContain("# AICE Context Pack: src/contracts.ts");
      expect(callersSmallRes.text).toContain("Downstream Callers");
      expect(callersSmallRes.callers.length).toBeGreaterThan(0);

      // CLI flag wiring in bin/aice.ts (distinguishing omitted defaults vs explicit --deps / --callers)
      const smallAbs = path.join(tmpDir, "src", "small.ts");
      const contractsAbs = path.join(tmpDir, "src", "contracts.ts");
      const origLog = console.log;
      const runCliRead = async (cliArgs: string[]): Promise<string> => {
        const captured: string[] = [];
        console.log = (...items: unknown[]) => {
          captured.push(items.join(" "));
        };
        try {
          await program.parseAsync(["node", "aice", "read", ...cliArgs]);
        } finally {
          console.log = origLog;
        }
        return captured.join("\n");
      };

      const defaultCliOut = await runCliRead([smallAbs]);
      expect(defaultCliOut).toContain("// === ");
      expect(defaultCliOut).not.toContain("# AICE Context Pack");

      const depsCliOut = await runCliRead([smallAbs, "--deps"]);
      expect(depsCliOut).toContain("# AICE Context Pack:");
      expect(depsCliOut).toContain("MetricConfig");

      const callersCliOut = await runCliRead([contractsAbs, "--callers"]);
      expect(callersCliOut).toContain("# AICE Context Pack:");
      expect(callersCliOut).toContain("Downstream Callers");
    });

    it("keeps dependency contracts, callers, and Adaptive Sibling Outlining active on symbol-targeted code reads and >150-line code files", async () => {
      const symRes = await aiceRead("src/small.ts:SmallCalculator.compute", {
        projectRoot: tmpDir,
      });
      expect(symRes.text).toContain("# AICE Context Pack: src/small.ts");
      expect(symRes.text).toContain("MetricConfig");
      expect(symRes.text).toContain("Downstream Callers");
      expect(symRes.text).toContain("// siblings in SmallCalculator:");
      expect(symRes.text).toContain("reset");

      // 180-line bare code file (>150 and <=250 lines)
      const medium180Lines = [
        'import { type MetricConfig } from "./contracts.js";',
        ...Array.from(
          { length: 179 },
          (_, idx) =>
            `export function step${idx}(c: MetricConfig): number { return c.weight + ${idx}; }`,
        ),
      ].join("\n");
      fs.writeFileSync(path.join(tmpDir, "src", "medium180.ts"), medium180Lines, "utf-8");

      const medRes = await aiceRead("src/medium180.ts", { projectRoot: tmpDir });
      expect(medRes.text).toContain("# AICE Context Pack: src/medium180.ts");
      expect(medRes.text).toContain("MetricConfig");
      expect(medRes.dependencies.length).toBeGreaterThan(0);
    });

    it("defaults idiomsEnabled to false (no $idioms header bloat) unless --idioms or idiomsEnabled: true", async () => {
      // Overwrite aice.config.json WITHOUT idiomsEnabled (testing new opt-in default)
      fs.writeFileSync(
        path.join(tmpDir, "aice.config.json"),
        JSON.stringify(
          {
            enabled: true,
            idioms: {
              $clampUnit: {
                name: "$clampUnit",
                kind: "expr",
                params: [{ name: "$0", kind: "expr" }],
                templateAice: "Math.min(Math.max($0, 0), 1)",
                occurrences: 3,
                tokensPerOccurrenceSaved: 5,
                netTokenSavings: 15,
              },
            },
          },
          null,
          2,
        ),
        "utf-8",
      );

      const defaultSmall = await aiceRead("src/small.ts", { projectRoot: tmpDir });
      expect(defaultSmall.text).not.toContain("# @idioms available");
      expect(defaultSmall.text).not.toContain("Active Project Idioms");
      expect(defaultSmall.text).not.toContain("$clampUnit(");

      const defaultSym = await aiceRead("src/small.ts:SmallCalculator.compute", {
        projectRoot: tmpDir,
      });
      expect(defaultSym.text).not.toContain("# @idioms available");
      expect(defaultSym.text).not.toContain("Active Project Idioms");
      expect(defaultSym.text).not.toContain("$clampUnit(");

      // Explicit --idioms opt-in enables macro collapse & legend
      const optInSym = await aiceRead("src/small.ts:SmallCalculator.compute", {
        projectRoot: tmpDir,
        idioms: true,
      });
      expect(optInSym.text).toContain("$clampUnit(");
      expect(optInSym.text).toContain("Active Project Idioms");
    });
  });

  describe("Quoted Glob Expansion (Step 5.1)", () => {
    it("expands quoted globs deterministically, skips ignored dirs, and preserves :selector suffixes", async () => {
      fs.mkdirSync(path.join(tmpDir, "node_modules", "pkg"), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, "node_modules", "pkg", "ignored.ts"),
        "export const ignored = 1;\n",
        "utf-8",
      );
      fs.mkdirSync(path.join(tmpDir, "dist"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "dist", "bundle.ts"), "export const b = 1;\n", "utf-8");
      fs.writeFileSync(path.join(tmpDir, "README.md"), "# Project Readme\n", "utf-8");
      fs.writeFileSync(path.join(tmpDir, "CHANGELOG.md"), "# Changelog\n\n## v1.0.0\n", "utf-8");

      // Verify normalizeReadTargets sorts deterministically and skips node_modules / dist
      const srcExpanded = normalizeReadTargets("src/**/*.ts", tmpDir).map((t) => t.raw);
      expect(srcExpanded).toEqual([
        "src/contracts.ts",
        "src/large.ts",
        "src/rules/alpha-rule.ts",
        "src/rules/beta-rule.ts",
        "src/small.ts",
      ]);

      const testExpanded = normalizeReadTargets("tests/*.test.ts", tmpDir).map((t) => t.raw);
      expect(testExpanded).toEqual(["tests/service.test.ts"]);

      const mdExpanded = normalizeReadTargets("*.md", tmpDir).map((t) => t.raw);
      expect(mdExpanded).toEqual(["CHANGELOG.md", "README.md"]);

      // Selector preservation on globs
      const slicedGlobTargets = normalizeReadTargets("src/rules/*.ts:L1-L2", tmpDir).map(
        (t) => `${t.targetPath}:${t.selector}`,
      );
      expect(slicedGlobTargets).toEqual([
        "src/rules/alpha-rule.ts:L1-L2",
        "src/rules/beta-rule.ts:L1-L2",
      ]);

      // End-to-end aiceRead with quoted globs, ? and {a,b}
      const globSliceRes = await aiceRead("src/rules/*.ts:L1-L2", { projectRoot: tmpDir });
      expect(globSliceRes.text).toContain("RuleVerdict");
      expect(globSliceRes.text).toContain("BetaRuleEngine");

      const braceGlobRes = await aiceRead("src/{small,contracts}.ts:outline", {
        projectRoot: tmpDir,
      });
      expect(braceGlobRes.mode).toBe("outline");
      expect(braceGlobRes.text).toContain("SmallCalculator");
      expect(braceGlobRes.text).toContain("MetricConfig");

      const qmarkRes = await aiceRead("src/rules/alpha-rul?.ts", { projectRoot: tmpDir });
      expect(qmarkRes.text).toContain("evaluateAlphaRule");
      expect(qmarkRes.text).not.toContain("BetaRuleEngine");
    });
  });

  describe("Default 28 KB Stdout Budget & Pagination Hints (Steps 4.1-4.2)", () => {
    it("auto-downgrades overflow targets to :outline with next-slice hints <= 28 KB, while --full and --max-tokens override", async () => {
      const heavyTargets: string[] = [];
      for (let f = 1; f <= 4; f++) {
        const rel = `src/heavy${f}.ts`;
        heavyTargets.push(rel);
        const lines = Array.from(
          { length: 220 },
          (_, idx) =>
            `export function computeHeavyMetric_${f}_${idx}(inputValue: number): string { return "segment_${f}_${idx}_" + String(inputValue * ${idx + 1}); }`,
        ).join("\n");
        fs.writeFileSync(path.join(tmpDir, rel), `${lines}\n`, "utf-8");
      }

      const budgetedRes = await aiceRead(heavyTargets, { projectRoot: tmpDir });
      expect(Buffer.byteLength(budgetedRes.output, "utf-8")).toBeLessThanOrEqual(
        DEFAULT_READ_MAX_BYTES,
      );
      expect(budgetedRes.output).toContain("auto-downgraded to :outline");
      expect(budgetedRes.output).toMatch(/aice read src\/heavy\d\.ts:L1-L\d+/);

      // --full overrides the default 28 KB ceiling
      const fullRes = await aiceRead(heavyTargets, { projectRoot: tmpDir, full: true });
      expect(Buffer.byteLength(fullRes.output, "utf-8")).toBeGreaterThan(DEFAULT_READ_MAX_BYTES);
      expect(fullRes.output).not.toContain("auto-downgraded to :outline");

      // Explicit --max-tokens overrides the default 28 KB ceiling
      const customMaxRes = await aiceRead(heavyTargets, {
        projectRoot: tmpDir,
        maxTokens: 60_000,
      });
      expect(Buffer.byteLength(customMaxRes.output, "utf-8")).toBeGreaterThan(
        DEFAULT_READ_MAX_BYTES,
      );
    });

    it("caps massive directory outlines <= 28,672 bytes and emits exact next-target pagination hints", async () => {
      const massiveDir = path.join(tmpDir, "src", "massive");
      fs.mkdirSync(massiveDir, { recursive: true });
      for (let f = 1; f <= 45; f++) {
        const padded = String(f).padStart(3, "0");
        const exportedFns = Array.from(
          { length: 20 },
          (_, m) =>
            `export function handleMassiveEndpoint_${padded}_${m}(requestId: string, retryBudgetCount: number): boolean { return requestId.length > retryBudgetCount; }`,
        ).join("\n");
        fs.writeFileSync(path.join(massiveDir, `module_${padded}.ts`), `${exportedFns}\n`, "utf-8");
      }

      const dirRes = await aiceRead("src/massive", { projectRoot: tmpDir });
      expect(dirRes.mode).toBe("auto-outline-dir");
      expect(Buffer.byteLength(dirRes.output, "utf-8")).toBeLessThanOrEqual(DEFAULT_READ_MAX_BYTES);
      expect(dirRes.output).toMatch(/aice read src\/massive\/module_\d+\.ts:L1-L20/);
    });

    it("enforces Surface-Aware 9 KB CLI Anti-Middle-Truncation Cap (surface: 'cli') across bare, line, and symbol reads", async () => {
      const cliFileLines = [
        'import { type MetricConfig } from "./contracts.js";',
        "export function myLongFunc(cfg: MetricConfig): number {",
        ...Array.from(
          { length: 450 },
          (_, i) =>
            `  const computedStepValue_${i} = ${i} * 2 + cfg.weight; // payload line padding to exceed 9kb`,
        ),
        "  return cfg.weight;",
        "}",
      ].join("\n");
      fs.writeFileSync(path.join(tmpDir, "src", "cli_oversized.ts"), `${cliFileLines}\n`, "utf-8");

      // 1. Line range query with surface: "cli"
      const lineRes = await read("src/cli_oversized.ts:L1-L400", {
        projectRoot: tmpDir,
        surface: "cli",
      });
      const lineBytes = Buffer.byteLength(lineRes.output, "utf-8");
      expect(lineBytes).toBeLessThanOrEqual(DEFAULT_CLI_READ_MAX_BYTES);
      expect(lineRes.output).toContain(
        "// [9 KB CLI stdout budget reached — next slice: aice read src/cli_oversized.ts:L",
      );
      expect(lineRes.output).toContain("(or pass --full)]");
      expect(lineRes.output).toMatch(/\n\n\/\/ \[9 KB CLI stdout budget reached/);

      // 2. Symbol query on a large function with surface: "cli"
      const symRes = await read("src/cli_oversized.ts:myLongFunc", {
        projectRoot: tmpDir,
        surface: "cli",
      });
      const symBytes = Buffer.byteLength(symRes.output, "utf-8");
      expect(symBytes).toBeLessThanOrEqual(DEFAULT_CLI_READ_MAX_BYTES);
      expect(symRes.output).toContain(
        "// [9 KB CLI stdout budget reached — next slice: aice read src/cli_oversized.ts:L",
      );
      expect(symRes.output).not.toContain("myLongFunc:L");
      expect(symRes.output).not.toContain("Dependency::L");

      // 3. Bare file auto-outlines with 7.75 KB CLI sliceByteBudget hint footer
      const bareRes = await read("src/cli_oversized.ts", {
        projectRoot: tmpDir,
        surface: "cli",
      });
      expect(bareRes.mode).toBe("auto-outline-file");
      expect(bareRes.output).toContain("// Next slice: aice read src/cli_oversized.ts:L1-L");
      const nextSliceMatch = bareRes.output.match(
        /Next slice: aice read src\/cli_oversized\.ts:L1-L(\d+)/,
      );
      expect(nextSliceMatch).toBeTruthy();
      const endLineHint = Number(nextSliceMatch?.[1]);
      expect(endLineHint).toBeLessThanOrEqual(200);
    });

    it("correctly infers next window without bogus Dependency: headers, strips :selector suffix, and clamps explicit :Lstart-Lend", async () => {
      // 1. Explicit range selector file:L251-L500 truncated within 9 KB CLI budget
      const rangedLines = Array.from(
        { length: 600 },
        (_, i) => `export const val_${i + 1} = "payload_${i + 1}";`,
      ).join("\n");
      fs.writeFileSync(path.join(tmpDir, "src", "cli_ranged.ts"), `${rangedLines}\n`, "utf-8");

      const rangedRes = await read("src/cli_ranged.ts:L251-L500", {
        projectRoot: tmpDir,
        surface: "cli",
      });
      expect(Buffer.byteLength(rangedRes.output, "utf-8")).toBeLessThanOrEqual(
        DEFAULT_CLI_READ_MAX_BYTES,
      );
      expect(rangedRes.output).toContain(
        "// [9 KB CLI stdout budget reached — next slice: aice read src/cli_ranged.ts:L",
      );
      // Verify endLine is clamped to L500
      expect(rangedRes.output).toMatch(/next slice: aice read src\/cli_ranged\.ts:L\d+-L500\b/);
      expect(rangedRes.output).not.toContain("src/cli_ranged.ts:L251-L500:L");
      expect(rangedRes.output).not.toContain("Dependency::L");

      // 2. Truncating file:myLongFunc with dependency in output never produces Dependency::L...
      const depContent = Array.from({ length: 40 }, (_, i) => `export const dep_${i} = ${i};`).join(
        "\n",
      );
      fs.writeFileSync(path.join(tmpDir, "src", "dep_helper.ts"), `${depContent}\n`, "utf-8");

      const callerContent = [
        'import { dep_0 } from "./dep_helper.js";',
        "export function myFuncWithDeps(): void {",
        ...Array.from(
          { length: 350 },
          (_, i) => `  console.log("data_${i}_padding_long_string_bytes_" + dep_0);`,
        ),
        "}",
      ].join("\n");
      fs.writeFileSync(
        path.join(tmpDir, "src", "caller_with_deps.ts"),
        `${callerContent}\n`,
        "utf-8",
      );

      const depRes = await read("src/caller_with_deps.ts:myFuncWithDeps", {
        projectRoot: tmpDir,
        surface: "cli",
        includeDeps: true,
      });
      expect(Buffer.byteLength(depRes.output, "utf-8")).toBeLessThanOrEqual(
        DEFAULT_CLI_READ_MAX_BYTES,
      );
      expect(depRes.output).not.toContain("Dependency::L");
      expect(depRes.output).not.toContain("myFuncWithDeps:L");
      expect(depRes.output).toContain("## Target File Content:");
      expect(depRes.output).toContain("aice read src/caller_with_deps.ts:L");

      // 3. Target-first ordering: concise symbol in a file with > 10 KB of imported contracts emits 100% of target lines first
      const heavyDepExports = Array.from(
        { length: 45 },
        (_, i) =>
          `export function heavyHelper_${i}(paramAlpha_${i}: number, paramBeta_${i}: string, paramGamma_${i}: boolean, paramDelta_${i}: Record<string, number>, paramEpsilon_${i}: Array<string>): Promise<{ status_${i}: boolean; payload_${i}: string }> { return Promise.resolve({ status_${i}: paramGamma_${i}, payload_${i}: paramBeta_${i} + paramAlpha_${i} + paramDelta_${i} + paramEpsilon_${i}.length }); }`,
      ).join("\n");
      fs.writeFileSync(path.join(tmpDir, "src", "heavy_deps.ts"), `${heavyDepExports}\n`, "utf-8");
      const usedImports = Array.from({ length: 45 }, (_, i) => `heavyHelper_${i}`).join(", ");
      const callLines = Array.from({ length: 15 }, (_, row) => {
        const trio = [row * 3, row * 3 + 1, row * 3 + 2]
          .map((idx) => `heavyHelper_${idx}`)
          .join(", ");
        return `  void [${trio}];`;
      });
      const shortSymSource = [
        `import { ${usedImports} } from "./heavy_deps.js";`,
        "export function wireAllHelpers(): void {",
        ...callLines,
        '  console.log("FINAL_TARGET_LINE_MARKER");',
        "}",
      ].join("\n");
      fs.writeFileSync(
        path.join(tmpDir, "src", "short_sym_heavy_deps.ts"),
        `${shortSymSource}\n`,
        "utf-8",
      );

      const targetFirstRes = await read("src/short_sym_heavy_deps.ts:wireAllHelpers", {
        projectRoot: tmpDir,
        surface: "cli",
        includeDeps: true,
      });
      expect(Buffer.byteLength(targetFirstRes.output, "utf-8")).toBeLessThanOrEqual(
        DEFAULT_CLI_READ_MAX_BYTES,
      );
      expect(targetFirstRes.output).toContain("FINAL_TARGET_LINE_MARKER");
      expect(targetFirstRes.output.indexOf("## Target File Content:")).toBeLessThan(
        targetFirstRes.output.indexOf("## Imported Dependency Contracts"),
      );
      expect(targetFirstRes.output).toContain(
        "target content complete; trailing dependency/caller contracts trimmed",
      );
      expect(targetFirstRes.output).not.toContain("next slice:");
    });
  });

  describe("Honest Signed Read/Context Baselines & Failed CLI Telemetry (Steps 6.3-6.4)", () => {
    it("baselines :Lstart-Lend against ±10 context lines, :/pattern/ against rg -n matches, and records negative deltas honestly", async () => {
      const telemetryFile = path.join(tmpDir, "honest-telemetry.jsonl");
      const prevTelemetryEnv = process.env.AICE_TELEMETRY_PATH;
      process.env.AICE_TELEMETRY_PATH = telemetryFile;

      try {
        // 1. :Lstart-Lend on 320-line src/large.ts baselines against L40..L65 (50-10 .. 55+10), NOT all 320 lines!
        const rawLarge = fs.readFileSync(path.join(tmpDir, "src", "large.ts"), "utf-8");
        const expectedRangeBaseline = computeLineRangeBaselineText(rawLarge, "L50-L55", 10);
        expect(expectedRangeBaseline.split(/\r?\n/)).toHaveLength(26);

        await aiceRead("src/large.ts:L50-L55", { projectRoot: tmpDir });
        let events: TelemetryEvent[] = readTelemetryEvents(telemetryFile);
        const rangeEvent = events[events.length - 1]!;
        expect(rangeEvent.nativeChars).toBe(expectedRangeBaseline.length);
        expect(rangeEvent.nativeCl100k).toBe(estimateTokens(expectedRangeBaseline, "cl100k_base"));
        expect(rangeEvent.nativeChars).toBeLessThan(rawLarge.length / 4);

        // 2. :/pattern/ positive match baselines against rg -n `<relPath>:<lineNo>:<lineText>` lines only
        const expectedRgBaseline = computeRegexBaselineText(
          [{ relPath: "src/large.ts", rawSource: rawLarge }],
          "/generatedHelper20/",
        );
        expect(expectedRgBaseline).toMatch(/^src\/large\.ts:\d+:.*generatedHelper20/);

        await aiceRead("src/large.ts:/generatedHelper20/", { projectRoot: tmpDir });
        events = readTelemetryEvents(telemetryFile);
        const regexHitEvent = events[events.length - 1]!;
        expect(regexHitEvent.nativeChars).toBe(expectedRgBaseline.length);
        // Honest signed delta: single-line match has tiny rg -n baseline vs context window -> negative savedCl100k is NOT clamped to 0!
        expect(regexHitEvent.savedCl100k).toBe(
          regexHitEvent.nativeCl100k - regexHitEvent.aiceCl100k,
        );
        expect(regexHitEvent.savedCl100k).toBeLessThan(0);

        // 3. :/pattern/ zero-match regex has empty rg -n baseline (0 native tokens) and strictly negative savedCl100k
        await aiceRead("src/large.ts:/DEFINITELY_NO_MATCH_XYZ_999/", { projectRoot: tmpDir });
        events = readTelemetryEvents(telemetryFile);
        const zeroMatchEvent = events[events.length - 1]!;
        expect(zeroMatchEvent.nativeChars).toBe(0);
        expect(zeroMatchEvent.nativeCl100k).toBe(0);
        expect(zeroMatchEvent.aiceCl100k).toBeGreaterThan(0);
        expect(zeroMatchEvent.savedCl100k).toBeLessThan(0);
      } finally {
        if (prevTelemetryEnv === undefined) {
          delete process.env.AICE_TELEMETRY_PATH;
        } else {
          process.env.AICE_TELEMETRY_PATH = prevTelemetryEnv;
        }
      }
    });

    it("records failed CLI invocations (invalid options and missing target errors) as negative <cli-error> overhead", () => {
      const telemetryFile = path.join(tmpDir, "cli-error-telemetry.jsonl");
      const repoRoot = process.cwd();
      const tsxBin = path.join(repoRoot, "node_modules", ".bin", "tsx");
      const aiceBin = path.join(repoRoot, "bin", "aice.ts");

      // 1. Invalid CLI flag via Commander error handler
      let invalidFlagFailed = false;
      try {
        execFileSync(tsxBin, [aiceBin, "read", "--nonexistent-bogus-flag"], {
          cwd: tmpDir,
          env: { ...process.env, AICE_TELEMETRY_PATH: telemetryFile },
          stdio: "pipe",
        });
      } catch {
        invalidFlagFailed = true;
      }
      expect(invalidFlagFailed).toBe(true);

      // 2. Command action failure (missing file)
      let missingFileFailed = false;
      try {
        execFileSync(tsxBin, [aiceBin, "read", "does-not-exist-anywhere.ts"], {
          cwd: tmpDir,
          env: { ...process.env, AICE_TELEMETRY_PATH: telemetryFile },
          stdio: "pipe",
        });
      } catch {
        missingFileFailed = true;
      }
      expect(missingFileFailed).toBe(true);

      const errorEvents = readTelemetryEvents(telemetryFile).filter(
        (ev) => ev.filePath === "<cli-error>",
      );
      expect(errorEvents.length).toBeGreaterThanOrEqual(2);
      for (const ev of errorEvents) {
        expect(ev.surface).toBe("cli");
        expect(ev.nativeChars).toBe(0);
        expect(ev.nativeCl100k).toBe(0);
        expect(ev.aiceCl100k).toBeGreaterThan(0);
        expect(ev.savedCl100k).toBeLessThan(0);
      }
    });
  });

  describe("v0.9.37 Step 1: Default 1-Based Disk-Numbered Native Output & --dsl Opt-In", () => {
    it("emits exact 1-based disk-numbered native source lines on <=25L and >25L :symbol reads, inline bare files, and supports 1-turn splice", async () => {
      // <=25-line :Class.method read emits exact disk line numbers + contracts + callers + siblings
      const shortSymRes = await read("src/small.ts:SmallCalculator.compute", {
        projectRoot: tmpDir,
      });
      expect(shortSymRes.mode).toBe("context");
      expect(shortSymRes.text).toContain(
        "4│   public compute(cfg: MetricConfig, raw: number): string {",
      );
      expect(shortSymRes.text).toContain('7│     return cfg.label + ":" + String(scaled);');
      expect(shortSymRes.text).toContain("8│   }");
      expect(shortSymRes.text).toContain("MetricConfig");
      expect(shortSymRes.text).toContain("Downstream Callers");
      expect(shortSymRes.text).toContain("// siblings in SmallCalculator:");

      // >25-line :symbol read also emits exact 1-based disk-numbered native lines
      const thirtyFiveBody = Array.from(
        { length: 30 },
        (_, idx) => `  const acc_${idx} = seed + ${idx};`,
      );
      const longSymFile = [
        'import { type MetricConfig } from "./contracts.js";',
        "",
        "export function runThirtyFiveLinePipeline(cfg: MetricConfig, seed: number): number {",
        ...thirtyFiveBody,
        "  return cfg.weight + acc_29;",
        "}",
        "",
      ].join("\n");
      const longSymAbs = path.join(tmpDir, "src", "pipeline35.ts");
      fs.writeFileSync(longSymAbs, longSymFile, "utf-8");

      const longSymRes = await read("src/pipeline35.ts:runThirtyFiveLinePipeline", {
        projectRoot: tmpDir,
      });
      expect(longSymRes.text).toContain(
        "3│ export function runThirtyFiveLinePipeline(cfg: MetricConfig, seed: number): number {",
      );
      expect(longSymRes.text).toContain("34│   return cfg.weight + acc_29;");
      expect(longSymRes.text).toContain("35│ }");

      // Returned numbered native lines work directly in 1-turn aice splice (<<< === >>> and :Lstart-Lend) without a second read
      await splice(`${longSymAbs}:runThirtyFiveLinePipeline`, {
        code: [
          "<<<",
          "  return cfg.weight + acc_29;",
          "===",
          "  return cfg.weight * 2 + acc_29;",
          ">>>",
        ].join("\n"),
        projectRoot: tmpDir,
      });
      expect(fs.readFileSync(longSymAbs, "utf-8")).toContain("return cfg.weight * 2 + acc_29;");

      await splice(`${longSymAbs}:L34-L34`, {
        code: "  return cfg.weight * 3 + acc_29;",
        projectRoot: tmpDir,
      });
      expect(fs.readFileSync(longSymAbs, "utf-8")).toContain("return cfg.weight * 3 + acc_29;");

      // Opt-in dsl: true (--dsl) emits AICE shorthand decompilation, and direct generateContext() keeps legacy default
      const dslSymRes = await read("src/small.ts:SmallCalculator.compute", {
        projectRoot: tmpDir,
        dsl: true,
      });
      expect(dslSymRes.text).not.toContain("4│   public compute");
      expect(dslSymRes.text).toContain("compute(");

      const legacyDirectCtx = await generateContext(path.join(tmpDir, "src", "small.ts"), {
        symbol: "SmallCalculator.compute",
        projectRoot: tmpDir,
      });
      expect(legacyDirectCtx.targetContent).not.toContain("4│   public compute");
      expect(legacyDirectCtx.targetContent).toContain("compute(");
    });
  });

  describe("v0.9.37 Step 2: Coherent Dynamic Byte/Density & AST-Boundary Budgeting", () => {
    it("settles a 450-line (~16 KB) bare file inline in 1 turn and water-fills multi-file targets smallest-first", async () => {
      // 1. 450-line (~16 KB) bare file settles inline in 1 turn with numbered native lines
      const lines450 = [
        'import { type MetricConfig } from "./contracts.js";',
        ...Array.from(
          { length: 449 },
          (_, i) => `export const m450_${i} = ${i}; // compact line ${i}`,
        ),
      ].join("\n");
      const file450Abs = path.join(tmpDir, "src", "medium450.ts");
      fs.writeFileSync(file450Abs, `${lines450}\n`, "utf-8");
      const rawBytes450 = Buffer.byteLength(fs.readFileSync(file450Abs, "utf-8"), "utf-8");
      expect(rawBytes450).toBeGreaterThan(14_000);
      expect(rawBytes450).toBeLessThan(22_000);

      const res450 = await read("src/medium450.ts", { projectRoot: tmpDir });
      expect(res450.mode).toBe("context");
      expect(res450.text).not.toContain("// Auto-outlined");
      expect(res450.text).toContain("1│ import { type MetricConfig }");
      expect(res450.text).toContain("450│ export const m450_448 = 448;");

      // 2. Multi-file smallest-first water-filling: even when >28 KB target is listed FIRST,
      // smaller bare targets still get full inline numbered native source!
      const huge32kb = Array.from(
        { length: 340 },
        (_, i) =>
          `export function hugeWaterfillFn_${i}(inputText: string): string { return inputText + "_segment_${i}"; }`,
      ).join("\n");
      fs.writeFileSync(path.join(tmpDir, "src", "huge_first.ts"), `${huge32kb}\n`, "utf-8");

      const budgetCheck = computeDynamicReadBudget([
        { id: "huge", rawSource: huge32kb },
        { id: "small", rawSource: "export const s = 1;\n" },
        { id: "contracts", rawSource: "export const c = 2;\n" },
      ]);
      expect(budgetCheck.inlineIds.has("small")).toBe(true);
      expect(budgetCheck.inlineIds.has("contracts")).toBe(true);
      expect(budgetCheck.autoOutlineIds.has("huge")).toBe(true);

      const multiWaterfill = await read(["src/huge_first.ts", "src/small.ts", "src/contracts.ts"], {
        projectRoot: tmpDir,
      });
      expect(multiWaterfill.mode).toBe("mixed");
      expect(multiWaterfill.text).toContain("4│   public compute(cfg: MetricConfig");
      expect(multiWaterfill.text).toContain("1│ export interface MetricConfig {");
      expect(multiWaterfill.targets.find((t) => t.targetPath === "src/huge_first.ts")?.mode).toBe(
        "auto-outline-file",
      );
      expect(multiWaterfill.targets.find((t) => t.targetPath === "src/small.ts")?.mode).toBe(
        "context",
      );
    });

    it("snaps computeDynamicSliceSpan and pagination hints to complete top-level AST symbol boundaries", async () => {
      // Build 10 top-level functions of exactly 30 lines each (300 lines total)
      const fnBlocks: string[] = [];
      for (let f = 0; f < 10; f++) {
        fnBlocks.push(
          `export function blockFn_${f}(seedValue: number): number { // header padding for density budget calculation`,
        );
        for (let step = 1; step <= 28; step++) {
          fnBlocks.push(
            `  const localVal_${f}_${step} = seedValue + ${step} * ${f + 1}; // padded body statement line`,
          );
        }
        fnBlocks.push("}");
      }
      const snappedSrc = `${fnBlocks.join("\n")}\n`;
      const snappedAbs = path.join(tmpDir, "src", "snapped_blocks.ts");
      fs.writeFileSync(snappedAbs, snappedSrc, "utf-8");

      // Choose a sliceByteBudget whose rawMaxLines lands mid-function (e.g. around line 135 inside blockFn_4 [L121-L150])
      const avgLineBytes = Buffer.byteLength(snappedSrc, "utf-8") / 300;
      const midFunctionBudget = Math.floor(avgLineBytes * 135);
      const span1 = computeDynamicSliceSpan(snappedAbs, snappedSrc, 1, midFunctionBudget);
      expect(span1.snappedToSymbol).toBe(true);
      expect(span1.endLine).toBe(120); // Snaps cleanly to closing `}` of blockFn_3 at L120!

      const span2 = computeDynamicSliceSpan(
        snappedAbs,
        snappedSrc,
        span1.endLine + 1,
        midFunctionBudget,
      );
      expect(span2.startLine).toBe(121);
      expect(span2.snappedToSymbol).toBe(true);
      expect(span2.endLine).toBe(240); // Snaps cleanly to closing `}` of blockFn_7 at L240!

      // Giant monolithic class with no intermediate top-level boundary falls back to rawMaxLines cleanly
      const monolithLines = [
        "export class MonolithBlock {",
        ...Array.from(
          { length: 298 },
          (_, i) => `  public prop_${i} = ${i}; // padded field declaration inside monolith class`,
        ),
        "}",
      ].join("\n");
      const monolithSpan = computeDynamicSliceSpan(
        path.join(tmpDir, "src", "monolith.ts"),
        monolithLines,
        1,
        Math.floor((Buffer.byteLength(monolithLines, "utf-8") / 300) * 110),
      );
      expect(monolithSpan.snappedToSymbol).toBe(false);
      expect(monolithSpan.endLine).toBe(monolithSpan.rawMaxLines);
    });
  });

  describe("v0.9.37 Step 3: AST-Aware Search Context Windows, Merging & -C Override", () => {
    it("expands <=40-line enclosing declarations in full, falls back to ±10 lines on >40-line functions, merges overlaps, and honors contextLines", async () => {
      const searchTargetLines = [
        "// Header line 1",
        "export function shortTargetDecl(x: number): number {",
        "  const stepA = x + 1;",
        "  const HIT_SHORT_DECL = stepA * 2;",
        "  const stepB = HIT_SHORT_DECL + 3;",
        "  return stepB;",
        "}",
        "",
        "export function longTargetDecl(y: number): number {",
        ...Array.from({ length: 22 }, (_, i) => `  const pre_${i} = y + ${i};`),
        "  const HIT_LONG_DECL_A = pre_0 + 100;",
        "  const midGap = 1;",
        "  const HIT_LONG_DECL_B = HIT_LONG_DECL_A + midGap;",
        ...Array.from({ length: 24 }, (_, i) => `  const post_${i} = y - ${i};`),
        "  return post_23;",
        "}",
        "",
      ];
      fs.writeFileSync(
        path.join(tmpDir, "src", "ast_search.ts"),
        searchTargetLines.join("\n"),
        "utf-8",
      );

      // 1. <=40-line enclosing function expands to complete [L2-L7] declaration with numbered native lines
      const shortHit = await read("src/ast_search.ts:/HIT_SHORT_DECL/", { projectRoot: tmpDir });
      expect(shortHit.mode).toBe("search");
      expect(shortHit.text).toContain("# [L2-L7]");
      expect(shortHit.text).toContain("2│ export function shortTargetDecl(x: number): number {");
      expect(shortHit.text).toContain("4│   const HIT_SHORT_DECL = stepA * 2;");
      expect(shortHit.text).toContain("7│ }");
      expect(shortHit.text).not.toContain("longTargetDecl");

      // 2. >40-line function (50 lines) falls back to ±10 lines AND merges overlapping windows for HIT_LONG_DECL_A & HIT_LONG_DECL_B
      const longHit = await read("src/ast_search.ts:/HIT_LONG_DECL_/", { projectRoot: tmpDir });
      expect(longHit.mode).toBe("search");
      // Merged into a single window (only one `// match at` header) covering ±10 around L32..L34 -> [L22-L44]
      expect(longHit.text.match(/\/\/ match at \[/g)).toHaveLength(1);
      expect(longHit.text).toContain("# [L22-L44]");
      expect(longHit.text).toContain("32│   const HIT_LONG_DECL_A = pre_0 + 100;");
      expect(longHit.text).toContain("34│   const HIT_LONG_DECL_B = HIT_LONG_DECL_A + midGap;");
      expect(longHit.text).not.toContain("9│ export function longTargetDecl");

      // 3. Explicit contextLines (-C 2) overrides AST expansion to exact ±2 radius
      const explicitRadius = await read("src/ast_search.ts", {
        projectRoot: tmpDir,
        search: "HIT_SHORT_DECL",
        contextLines: 1,
      });
      // Hits at L4 and L5 with ±1 radius merge to [L3-L6] (omitting L2 signature & L7 closing brace)
      expect(explicitRadius.text).toContain("# [L3-L6]");
      expect(explicitRadius.text).not.toContain("2│ export function shortTargetDecl");

      // 4. Broad multi-file search respects global 28 KB budget
      const manySearchDir = path.join(tmpDir, "src", "broad_search");
      fs.mkdirSync(manySearchDir, { recursive: true });
      for (let f = 1; f <= 35; f++) {
        const body = [
          `export function broadHandler_${f}(payload: string): string {`,
          ...Array.from(
            { length: 28 },
            (_, i) =>
              `  const line_${f}_${i} = payload + "_BROAD_COMMON_TOKEN_${i}_padding_text_value";`,
          ),
          `  return line_${f}_0;`,
          "}",
        ].join("\n");
        fs.writeFileSync(path.join(manySearchDir, `handler_${f}.ts`), `${body}\n`, "utf-8");
      }
      const broadSearchRes = await read("src/broad_search", {
        projectRoot: tmpDir,
        search: "BROAD_COMMON_TOKEN_10",
      });
      expect(Buffer.byteLength(broadSearchRes.output, "utf-8")).toBeLessThanOrEqual(
        DEFAULT_READ_MAX_BYTES,
      );
    });
  });

  describe("v0.9.37 Step 4: Plain/Auto-Escaped search, filesWithMatches (-l), and <20ms Zero-AST filesOnly", () => {
    it("supports plain regex search, auto-escapes invalid regex to literal fallback, defaults empty targets to '.', and supports filesWithMatches", async () => {
      // Plain regex without /.../ wrappers + omitted targets defaults to "."
      const plainRegexRes = await read(undefined, {
        projectRoot: tmpDir,
        search: "evaluateAlphaRule\\(",
      });
      expect(plainRegexRes.mode).toBe("search");
      expect(plainRegexRes.text).toContain("src/rules/alpha-rule.ts");
      expect(plainRegexRes.text).toContain("6│ export function evaluateAlphaRule");

      // Invalid regex ("foo(bar" and "[unclosed") auto-escapes to literal match instead of throwing
      fs.writeFileSync(
        path.join(tmpDir, "src", "literal_weird.ts"),
        'export const weirdExpr = "foo(bar and [unclosed literal";\n',
        "utf-8",
      );
      const invalidParenSearch = await read(undefined, {
        projectRoot: tmpDir,
        search: "foo(bar",
      });
      expect(invalidParenSearch.mode).toBe("search");
      expect(invalidParenSearch.text).toContain("src/literal_weird.ts");
      expect(invalidParenSearch.text).toContain("foo(bar and [unclosed literal");

      const invalidBracketSearch = await read("src/literal_weird.ts", {
        projectRoot: tmpDir,
        search: "[unclosed",
      });
      expect(invalidBracketSearch.text).toContain("foo(bar and [unclosed literal");

      // filesWithMatches: true (-l) emits ranked relative file paths concisely
      const filesMatching = await read(undefined, {
        projectRoot: tmpDir,
        search: "UNIQUE_SEARCH_BEACON",
        filesWithMatches: true,
      });
      expect(filesMatching.mode).toBe("search");
      const matchedLines = filesMatching.output.trim().split("\n");
      expect(matchedLines).toEqual(["src/rules/alpha-rule.ts", "tests/service.test.ts"]);

      const filesMatchingJson = await read(undefined, {
        projectRoot: tmpDir,
        search: "UNIQUE_SEARCH_BEACON",
        filesWithMatches: true,
        json: true,
      });
      const parsedMatchJson = JSON.parse(filesMatchingJson.output) as {
        filesWithMatches: boolean;
        count: number;
        files: string[];
      };
      expect(parsedMatchJson.filesWithMatches).toBe(true);
      expect(parsedMatchJson.count).toBe(2);
      expect(parsedMatchJson.files[0]).toBe("src/rules/alpha-rule.ts");
    });

    it("discovers workspace files via filesOnly in <20ms without AST parsing, respects ignore rules, filters by filePattern/search, and avoids 15-file truncation", async () => {
      // Populate >20 workspace files + ignored node_modules / dist files
      fs.mkdirSync(path.join(tmpDir, "node_modules", "ignored_pkg"), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, "node_modules", "ignored_pkg", "index.js"),
        "module.exports = 1;\n",
        "utf-8",
      );
      fs.mkdirSync(path.join(tmpDir, "dist"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "dist", "out.js"), "export const x = 1;\n", "utf-8");
      fs.mkdirSync(path.join(tmpDir, "src", "extra"), { recursive: true });
      for (let i = 1; i <= 20; i++) {
        fs.writeFileSync(
          path.join(tmpDir, "src", "extra", `mod_${String(i).padStart(2, "0")}.ts`),
          `export const v${i} = ${i};\n`,
          "utf-8",
        );
      }

      const t0 = performance.now();
      const allFiles = await read(undefined, { projectRoot: tmpDir, filesOnly: true });
      const elapsedMs = performance.now() - t0;

      expect(allFiles.mode).toBe("files");
      expect(elapsedMs).toBeLessThan(50);
      // Lists all >20 files without 15-file truncation and skips node_modules & dist
      expect(allFiles.stats.fileCount).toBeGreaterThanOrEqual(25);
      expect(allFiles.output).not.toContain("node_modules");
      expect(allFiles.output).not.toContain("dist/out.js");
      expect(allFiles.output).toMatch(/src\/small\.ts \(\d+L, \d+\.\d+KB\)/);
      expect(allFiles.output).toContain("src/extra/mod_20.ts (1L, 0.1KB)");

      // Filter via filePattern glob
      const testOnly = await read(undefined, {
        projectRoot: tmpDir,
        filesOnly: true,
        filePattern: "*.test.ts",
      });
      expect(testOnly.output.trim().split("\n")).toHaveLength(1);
      expect(testOnly.output).toContain("tests/service.test.ts");

      // Filter via search fallback when filePattern is omitted
      const ruleSubstr = await read(undefined, {
        projectRoot: tmpDir,
        filesOnly: true,
        search: "alpha-rule",
      });
      expect(ruleSubstr.output.trim().split("\n")).toHaveLength(1);
      expect(ruleSubstr.output).toContain("src/rules/alpha-rule.ts");

      // Structured --json output on filesOnly
      const filesJson = await read("src/rules", {
        projectRoot: tmpDir,
        filesOnly: true,
        json: true,
      });
      const parsedFiles = JSON.parse(filesJson.output) as {
        mode: string;
        count: number;
        files: Array<{ path: string; lines: number; sizeKB: number }>;
      };
      expect(parsedFiles.mode).toBe("files");
      expect(parsedFiles.count).toBe(2);
      expect(parsedFiles.files.map((f) => f.path)).toEqual([
        "src/rules/alpha-rule.ts",
        "src/rules/beta-rule.ts",
      ]);
    });
  });
});
