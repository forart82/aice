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

import { execFileSync, execSync } from "node:child_process";
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
  compileFocusPattern,
  computeDynamicReadBudget,
  computeDynamicSliceSpan,
  computeLineRangeBaselineText,
  computeRegexBaselineText,
  countSourceLines,
  DEFAULT_CLI_READ_MAX_BYTES,
  DEFAULT_CLI_SLICE_BYTE_BUDGET,
  DEFAULT_READ_MAX_BYTES,
  generateContext,
  normalizeReadTargets,
  parseReadTarget,
  parseSymbolPatternSelector,
  read,
  splice,
  splitCommaSelectors,
  splitReadTargetString,
  splitSymbolSelectors,
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

    it("renders <=120L bare files inline in 1 turn and auto-outlines >120L bare files (or explicit autoOutlineLineThreshold)", async () => {
      // <=120-line bare file settles inline in 1 turn without auto-outline
      const inlineSmall = await aiceRead("src/small.ts", { projectRoot: tmpDir });
      expect(inlineSmall.mode).toBe("context");
      expect(inlineSmall.text).not.toContain("// Auto-outlined");
      expect(inlineSmall.text).toContain("import { DEFAULT_WEIGHT, type MetricConfig }");
      expect(inlineSmall.text).not.toContain("1│ ");

      // Explicit higher autoOutlineLineThreshold override allows 280L inline when passed
      const explicitInlineLarge = await aiceRead("src/large.ts", {
        projectRoot: tmpDir,
        autoOutlineLineThreshold: 300,
      });
      expect(explicitInlineLarge.mode).toBe("context");
      expect(explicitInlineLarge.text).not.toContain("// Auto-outlined");
      expect(explicitInlineLarge.text).toContain("987654321");

      // Default >120L bare file (280L) auto-outlines compactly
      const defaultLargeRes = await aiceRead("src/large.ts", {
        projectRoot: tmpDir,
      });
      expect(defaultLargeRes.mode).toBe("auto-outline-file");
      expect(defaultLargeRes.targets[0]?.autoOutlined).toBe(true);
      expect(defaultLargeRes.targets[0]?.lineCount).toBe(280);
      expect(defaultLargeRes.text).toContain("// Auto-outlined src/large.ts (280L");

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
      expect(res.text).toContain("// Auto-outlined src/over28kb.ts (341L");
      expect(res.text).toContain(
        "batch symbols: aice read src/over28kb.ts:computeOverBudget_0 src/over28kb.ts:computeOverBudget_1 or aice search <pat> src/over28kb.ts",
      );
      expect(res.text).not.toMatch(/next:\s+aice read src\/over28kb\.ts:L\d+/);
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

    it("returns zero-envelope non-expanding bare read for <=120-line files and auto-outlines >120-line bare files", async () => {
      const smallRes = await aiceRead("src/small.ts", { projectRoot: tmpDir });
      expect(smallRes.mode).toBe("context");
      expect(smallRes.text).not.toContain("// Auto-outlined");
      expect(smallRes.text).not.toContain("1│ ");
      expect(smallRes.text).toContain("import { DEFAULT_WEIGHT, type MetricConfig }");
      expect(smallRes.text).not.toContain("# AICE Context Pack");
      expect(smallRes.text).not.toContain("Downstream Callers");
      expect(smallRes.dependencies).toHaveLength(0);
      expect(smallRes.callers).toHaveLength(0);

      // Explicit --deps / --callers opt-in restores full context pack on <=120-line file
      const smallOptInRes = await aiceRead("src/small.ts", {
        projectRoot: tmpDir,
        includeDeps: true,
        includeCallers: true,
      });
      expect(smallOptInRes.text).toContain("# AICE Context Pack: src/small.ts");
      expect(smallOptInRes.text).toContain("MetricConfig");
      expect(smallOptInRes.text).toContain("Downstream Callers");

      // 120-line bare file settles inline without auto-outline, while 250-line bare file auto-outlines
      const boundary120Path = path.join(tmpDir, "src", "boundary120.ts");
      const lines120 = `${Array.from({ length: 120 }, (_, i) => `export const b${i} = ${i};`).join("\n")}\n`;
      fs.writeFileSync(boundary120Path, lines120, "utf-8");

      const boundary120Res = await aiceRead("src/boundary120.ts", { projectRoot: tmpDir });
      expect(boundary120Res.mode).toBe("context");
      expect(boundary120Res.text).not.toContain("// Auto-outlined");
      expect(boundary120Res.text).toContain("export const b119 = 119;");

      const boundaryPath = path.join(tmpDir, "src", "boundary250.ts");
      const lines250 = `${Array.from({ length: 250 }, (_, i) => `export const b${i} = ${i};`).join("\n")}\n`;
      fs.writeFileSync(boundaryPath, lines250, "utf-8");

      const boundaryRes = await aiceRead("src/boundary250.ts", { projectRoot: tmpDir });
      expect(boundaryRes.mode).toBe("auto-outline-file");
      expect(boundaryRes.text).toContain("// Auto-outlined src/boundary250.ts (250L");
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

    it("routes :Lstart-Lend line ranges to compact line extraction even on >250-line files", async () => {
      const res = await aiceRead("src/large.ts:L4-L7", { projectRoot: tmpDir });

      expect(res.mode).toBe("context");
      expect(res.text).not.toContain("// Auto-outlined");
      expect(res.text).toContain("// src/large.ts:4-7");
      expect(res.text).not.toContain("4│");
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
      expect(res.text).toContain("// src/rules/alpha-rule.ts");
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
      expect(tomlSlice.text).toContain("// Cargo.toml:1-4");
      expect(tomlSlice.text).toContain("[package]");
      expect(tomlSlice.text).toContain('edition = "2021"');
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
      expect(lineRes.text.startsWith("// src/large.ts:1-5")).toBe(true);
      expect(lineRes.text).not.toContain("# AICE Context Pack");
      expect(lineRes.text).not.toContain("Imported Dependency Contracts");
      expect(lineRes.text).not.toContain("Downstream Callers");
      expect(lineRes.text).not.toContain("// siblings");
      expect(lineRes.dependencies).toHaveLength(0);
      expect(lineRes.callers).toHaveLength(0);

      // 2. :/pattern/ on file and directory
      const fileRegexRes = await aiceRead("src/small.ts:/SmallCalculator/", {
        projectRoot: tmpDir,
      });
      expect(fileRegexRes.text).toContain("src/small.ts:");
      expect(fileRegexRes.text).not.toContain("# AICE Context Pack");
      expect(fileRegexRes.text).not.toContain("Imported Dependency Contracts");
      expect(fileRegexRes.text).not.toContain("Downstream Callers");

      const dirRegexRes = await aiceRead("src:/SmallCalculator/", { projectRoot: tmpDir });
      expect(dirRegexRes.text).toContain("src/small.ts:");
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
      expect(multiFastRes.text).toContain("// package.json");
      expect(multiFastRes.text).toContain("// config.yaml");
      expect(multiFastRes.text).toContain("README.md");
      expect(multiFastRes.text).toContain("// styles.css");
      expect(multiFastRes.text).toContain("// index.html");
      expect(multiFastRes.text).toContain("// deploy.sh");
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
      expect(defaultCliOut).toContain("SmallCalculator");
      expect(defaultCliOut).not.toContain("1│ ");
      expect(defaultCliOut).not.toContain("# AICE Context Pack");

      const depsCliOut = await runCliRead([smallAbs, "--deps"]);
      expect(depsCliOut).toContain("# AICE Context Pack:");
      expect(depsCliOut).toContain("MetricConfig");

      const callersCliOut = await runCliRead([contractsAbs, "--callers"]);
      expect(callersCliOut).toContain("# AICE Context Pack:");
      expect(callersCliOut).toContain("Downstream Callers");
    });

    it("keeps dependency contracts, callers, and Adaptive Sibling Outlining active on symbol-targeted code reads and >120-line code files with explicit threshold", async () => {
      const symRes = await aiceRead("src/small.ts:SmallCalculator.compute", {
        projectRoot: tmpDir,
      });
      expect(symRes.text).toContain("# AICE Context Pack: src/small.ts");
      expect(symRes.text).toContain("MetricConfig");
      expect(symRes.text).toContain("Downstream Callers");
      expect(symRes.text).toContain("// siblings in SmallCalculator:");
      expect(symRes.text).toContain("reset");

      // 180-line bare code file (>120L default auto-outlines; with explicit autoOutlineLineThreshold: 250 emits context pack)
      const medium180Lines = [
        'import { type MetricConfig } from "./contracts.js";',
        ...Array.from(
          { length: 179 },
          (_, idx) =>
            `export function step${idx}(c: MetricConfig): number { return c.weight + ${idx}; }`,
        ),
      ].join("\n");
      fs.writeFileSync(path.join(tmpDir, "src", "medium180.ts"), medium180Lines, "utf-8");

      const medAutoRes = await aiceRead("src/medium180.ts", { projectRoot: tmpDir });
      expect(medAutoRes.mode).toBe("auto-outline-file");

      const medRes = await aiceRead("src/medium180.ts", {
        projectRoot: tmpDir,
        autoOutlineLineThreshold: 250,
      });
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
      expect(budgetedRes.output).toContain("// Auto-outlined src/heavy1.ts");
      expect(budgetedRes.output).toContain(
        "batch symbols: aice read src/heavy1.ts:computeHeavyMetric_1_0 src/heavy1.ts:computeHeavyMetric_1_1",
      );
      expect(budgetedRes.output).not.toMatch(/aice read src\/heavy\d\.ts:L1-L\d+/);

      // --full overrides the default 28 KB ceiling
      const fullRes = await aiceRead(heavyTargets, { projectRoot: tmpDir, full: true });
      expect(Buffer.byteLength(fullRes.output, "utf-8")).toBeGreaterThan(DEFAULT_READ_MAX_BYTES);
      expect(fullRes.output).not.toContain("// Auto-outlined");
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
      expect(dirRes.output).toMatch(
        /more files omitted — batch: aice outline src\/massive\/module_\d+\.ts/,
      );
      expect(dirRes.output).not.toMatch(/aice read src\/massive\/module_\d+\.ts:L1-L20/);
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

      // 1. Line range query with surface: "cli" exceeding 9 KB triggers clean pagination
      const wideCliLines = [
        'import { type MetricConfig } from "./contracts.js";',
        "export function myLongFunc(cfg: MetricConfig): number {",
        ...Array.from(
          { length: 450 },
          (_, i) =>
            `  const computedStepValue_${i} = ${i} * 2 + cfg.weight + ("padding_segment_alpha_beta_gamma_delta_epsilon_zeta_${i}").length;`,
        ),
        "  return cfg.weight;",
        "}",
      ].join("\n");
      fs.writeFileSync(path.join(tmpDir, "src", "cli_oversized.ts"), `${wideCliLines}\n`, "utf-8");

      const lineRes = await read("src/cli_oversized.ts:L1-L400", {
        projectRoot: tmpDir,
        surface: "cli",
      });
      const lineBytes = Buffer.byteLength(lineRes.output, "utf-8");
      expect(lineBytes).toBeLessThanOrEqual(DEFAULT_CLI_READ_MAX_BYTES);
      expect(lineRes.output).toMatch(
        /\/\/ \[9 KB CLI stdout budget reached \(L\d+-L400 remaining\) — narrow with aice search <pat> src\/cli_oversized\.ts\]/,
      );
      expect(lineRes.output).not.toContain("next: aice read");
      expect(lineRes.output).not.toContain("--full");
      expect(lineRes.output).toMatch(/\n\/\/ \[9 KB CLI stdout budget reached/);

      // 2. Symbol query on a large function with surface: "cli"
      const symRes = await read("src/cli_oversized.ts:myLongFunc", {
        projectRoot: tmpDir,
        surface: "cli",
      });
      const symBytes = Buffer.byteLength(symRes.output, "utf-8");
      expect(symBytes).toBeLessThanOrEqual(DEFAULT_CLI_READ_MAX_BYTES);
      expect(symRes.output).toContain("— narrow with aice search <pat> src/cli_oversized.ts]");
      expect(symRes.output).not.toContain("next: aice read");
      expect(symRes.output).not.toContain("myLongFunc:L");
      expect(symRes.output).not.toContain("Dependency::L");

      // 3. Bare file auto-outlines with batch symbols / search hint (no :L1-L... paging trap)
      const bareRes = await read("src/cli_oversized.ts", {
        projectRoot: tmpDir,
        surface: "cli",
      });
      expect(bareRes.mode).toBe("auto-outline-file");
      expect(bareRes.output).toContain(
        "batch symbols: aice read src/cli_oversized.ts:myLongFunc or aice search <pat> src/cli_oversized.ts",
      );
      expect(bareRes.output).not.toContain("next: aice read src/cli_oversized.ts:L1-L");
    });

    it("correctly infers remaining span without bogus Dependency: headers, strips :selector suffix, and clamps explicit :Lstart-Lend", async () => {
      // 1. Explicit range selector file:L251-L500 truncated within 9 KB CLI budget
      const rangedLines = Array.from(
        { length: 600 },
        (_, i) => `export const val_${i + 1} = "payload_mid_padding_${i + 1}";`,
      ).join("\n");
      fs.writeFileSync(path.join(tmpDir, "src", "cli_ranged.ts"), `${rangedLines}\n`, "utf-8");

      const rangedRes = await read("src/cli_ranged.ts:L251-L500", {
        projectRoot: tmpDir,
        surface: "cli",
      });
      expect(Buffer.byteLength(rangedRes.output, "utf-8")).toBeLessThanOrEqual(
        DEFAULT_CLI_READ_MAX_BYTES,
      );
      // Verify remaining span endLine is clamped to L500 without sequential :L paging breadcrumbs
      expect(rangedRes.output).toMatch(
        /\/\/ \[9 KB CLI stdout budget reached \(L\d+-L500 remaining\) — narrow with aice search <pat> src\/cli_ranged\.ts\]/,
      );
      expect(rangedRes.output).not.toContain("next: aice read");
      expect(rangedRes.output).not.toContain("src/cli_ranged.ts:L251-L500");
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
      expect(depRes.output).toContain("narrow with aice search <pat> src/caller_with_deps.ts");
      expect(depRes.output).not.toContain("next: aice read");

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
      expect(targetFirstRes.output).toContain("target complete; contracts trimmed");
      expect(targetFirstRes.output).not.toContain("next:");
    });

    it("emits numeric-dense 145-line slice (> 3,200 tokens, <= 9 KB) in 1 turn without truncation on surface: 'cli'", async () => {
      const line = "emitBoxLocal(ctx, inst, -15.0, 15.0, -6.8, 0.25, true);";
      const denseContent = Array.from({ length: 145 }, () => line).join("\n");
      fs.writeFileSync(path.join(tmpDir, "src", "dense_mesh.ts"), `${denseContent}\n`, "utf-8");

      const res = await read("src/dense_mesh.ts:L1-L145", {
        projectRoot: tmpDir,
        surface: "cli",
      });

      const bytes = Buffer.byteLength(res.output, "utf-8");
      const tokens = estimateTokens(res.output);
      expect(bytes).toBeLessThanOrEqual(DEFAULT_CLI_READ_MAX_BYTES);
      expect(tokens).toBeGreaterThan(2_600);
      expect(res.output).not.toContain("budget reached");
      expect(res.output).toContain("// src/dense_mesh.ts:1-145");
      expect(res.output).toContain("emitBoxLocal");
      expect(res.output).not.toContain("1│");
    });

    it("handles multi-target explicit :Lstart-Lend overflow on surface: 'cli' by emitting compact omitted header without full outline", async () => {
      const line =
        "emitBoxLocal(ctx, -15.0, 15.0, -6.8, 0.25, true, 'extra_padding_segment_bytes');";
      const multiContent = Array.from({ length: 300 }, () => line).join("\n");
      fs.writeFileSync(path.join(tmpDir, "src", "multi_slice_a.ts"), `${multiContent}\n`, "utf-8");
      fs.writeFileSync(path.join(tmpDir, "src", "multi_slice_b.ts"), `${multiContent}\n`, "utf-8");

      const res = await aiceRead(
        ["src/multi_slice_a.ts:L1-L140", "src/multi_slice_b.ts:L141-L280"],
        {
          projectRoot: tmpDir,
          surface: "cli",
        },
      );

      const bytes = Buffer.byteLength(res.output, "utf-8");
      expect(bytes).toBeLessThanOrEqual(DEFAULT_CLI_READ_MAX_BYTES);
      expect(res.output).toContain("// src/multi_slice_a.ts:1-140");
      expect(res.output).toContain(
        "// src/multi_slice_b.ts:L141-L280 (omitted — 9 KB CLI budget; narrow with aice search <pat> src/multi_slice_b.ts)",
      );
      expect(res.output).not.toContain("auto-downgraded to :outline");
      expect(res.output).not.toContain("module multi_slice_b:");
      expect(res.output).not.toContain("next: aice read src/multi_slice_b.ts:L141-L280");
    });

    it("eliminates unsolicited envelope bloat on CLI reads defaulting to zero-envelope without # AICE Context Pack", async () => {
      const boundaryPath = path.join(tmpDir, "src", "boundary115.ts");
      const lines115 = `${Array.from({ length: 115 }, (_, i) => `export const b${i} = ${i};`).join("\n")}\n`;
      fs.writeFileSync(boundaryPath, lines115, "utf-8");

      // 1. Bare <=120L code read on CLI: zero envelope
      const bareCliRes = await aiceRead("src/boundary115.ts", {
        projectRoot: tmpDir,
        surface: "cli",
      });
      expect(bareCliRes.text).toContain("export const b114 = 114;");
      expect(bareCliRes.text).not.toContain("# AICE Context Pack");
      expect(bareCliRes.text).not.toContain("## Imported Dependency Contracts");
      expect(bareCliRes.text).not.toContain("## Downstream Callers");
      expect(bareCliRes.dependencies).toHaveLength(0);
      expect(bareCliRes.callers).toHaveLength(0);

      // 2. Symbol read on CLI: zero envelope, keeping compact sibling outline
      const symCliRes = await aiceRead("src/small.ts:SmallCalculator.compute", {
        projectRoot: tmpDir,
        surface: "cli",
      });
      expect(symCliRes.text).toContain("// src/small.ts:4-8");
      expect(symCliRes.text).not.toContain("# AICE Context Pack");
      expect(symCliRes.text).not.toContain("## Imported Dependency Contracts");
      expect(symCliRes.text).not.toContain("## Downstream Callers");
      expect(symCliRes.text).toContain("// siblings in SmallCalculator:");
      expect(symCliRes.dependencies).toHaveLength(0);
      expect(symCliRes.callers).toHaveLength(0);

      // 3. surface: undefined with explicit threshold keeps context pack
      const bareProgRes = await aiceRead("src/boundary115.ts", {
        projectRoot: tmpDir,
        includeDeps: true,
      });
      expect(bareProgRes.text).toContain("# AICE Context Pack: src/boundary115.ts");

      // 4. surface: "cli" WITH includeDeps: true emits context pack
      const depsCliRes = await aiceRead("src/small.ts", {
        projectRoot: tmpDir,
        surface: "cli",
        includeDeps: true,
      });
      expect(depsCliRes.text).toContain("## Target File Content:");
      expect(depsCliRes.text).toContain("## Imported Dependency Contracts");
    });

    it("emits compact next-slice hints in budget-capped reads and bare auto-outlines", async () => {
      const oversizedLines = [
        "export function myLongFunc(): string {",
        ...Array.from(
          { length: 400 },
          (_, idx) =>
            `  const step_${idx} = "padding_value_for_budget_long_line_extra_bytes_${idx}";`,
        ),
        '  return "done";',
        "}",
      ].join("\n");
      fs.writeFileSync(
        path.join(tmpDir, "src", "cli_oversized.ts"),
        `${oversizedLines}\n`,
        "utf-8",
      );

      // 1. In bare auto-outline
      const bareRes = await aiceRead("src/cli_oversized.ts", {
        projectRoot: tmpDir,
        surface: "cli",
      });
      expect(bareRes.output).toContain(
        "batch symbols: aice read src/cli_oversized.ts:myLongFunc or aice search <pat> src/cli_oversized.ts",
      );
      expect(bareRes.output).not.toContain("next: aice read src/cli_oversized.ts:L1-L");

      // 2. In budget ceiling footer with remaining span summary + search hint
      const symRes = await aiceRead("src/cli_oversized.ts:myLongFunc", {
        projectRoot: tmpDir,
        surface: "cli",
      });
      expect(symRes.output).toContain("— narrow with aice search <pat> src/cli_oversized.ts]");
      expect(symRes.output).not.toContain("next: aice read src/cli_oversized.ts:L");
    });

    it("supports comma-separated multi-range and multi-symbol selectors on a single file in 1 turn", async () => {
      const targetAipl = path.join(tmpDir, "src", "multi_range.aipl");
      const aiplLines = Array.from(
        { length: 60 },
        (_, i) => `pub fn fn_${i + 1}(): int = ${i + 1}`,
      );
      fs.writeFileSync(targetAipl, `${aiplLines.join("\n")}\n`, "utf-8");

      // 1. Line range: file:L1-L10,L20-L30
      const rangeRes = await aiceRead("src/multi_range.aipl:L1-L10,L20-L30", {
        projectRoot: tmpDir,
        surface: "cli",
      });
      expect(rangeRes.text).toContain("// src/multi_range.aipl");
      expect(rangeRes.text).toContain("pub fn fn_1(): int = 1");
      expect(rangeRes.text).toContain("pub fn fn_10(): int = 10");
      expect(rangeRes.text).not.toContain("fn_15");
      expect(rangeRes.text).toContain("pub fn fn_20(): int = 20");
      expect(rangeRes.text).toContain("pub fn fn_30(): int = 30");
      expect(rangeRes.text).not.toContain("# AICE Context Pack");

      // 2. Symbol selectors: file:fn_2,fn_5
      const symRes = await aiceRead("src/multi_range.aipl:fn_2,fn_5", {
        projectRoot: tmpDir,
        surface: "cli",
      });
      expect(symRes.text).toContain("fn_2");
      expect(symRes.text).toContain("fn_5");
      expect(symRes.text).not.toContain("fn_20");
      expect(symRes.text).not.toContain("# AICE Context Pack");
    });
  });

  describe("Honest Signed Read/Context Baselines & Failed CLI Telemetry (Steps 6.3-6.4)", () => {
    it("baselines :Lstart-Lend against ±10 context lines + wrapper, :/pattern/ against rg -n -C 2 + wrapper, and records negative deltas honestly", async () => {
      const telemetryFile = path.join(tmpDir, "honest-telemetry.jsonl");
      const prevTelemetryEnv = process.env.AICE_TELEMETRY_PATH;
      process.env.AICE_TELEMETRY_PATH = telemetryFile;

      try {
        const rawLarge = fs.readFileSync(path.join(tmpDir, "src", "large.ts"), "utf-8");
        const expectedRangeBaseline = computeLineRangeBaselineText(rawLarge, "L50-L55", 10);
        expect(expectedRangeBaseline.split(/\r?\n/)).toHaveLength(26);

        await aiceRead("src/large.ts:L50-L55", { projectRoot: tmpDir });
        let events: TelemetryEvent[] = readTelemetryEvents(telemetryFile);
        const rangeEvent = events[events.length - 1]!;
        expect(rangeEvent.realisticNativeCl100k).toBeLessThanOrEqual(rangeEvent.nativeCl100k);
        expect(rangeEvent.realisticNativeCl100k).toBeLessThan(
          estimateTokens(rawLarge, "cl100k_base") / 2,
        );
        expect(rangeEvent.aiceCl100k).toBeLessThan(rangeEvent.realisticNativeCl100k!);

        // 2. :/pattern/ positive match baselines honestly with rn <= n1
        const expectedRgBaseline = computeRegexBaselineText(
          [{ relPath: "src/large.ts", rawSource: rawLarge }],
          "/generatedHelper20/",
        );
        expect(expectedRgBaseline).toMatch(/^src\/large\.ts:\d+:.*generatedHelper20/);

        await aiceRead("src/large.ts:/generatedHelper20/", { projectRoot: tmpDir });
        events = readTelemetryEvents(telemetryFile);
        const regexHitEvent = events[events.length - 1]!;
        expect(regexHitEvent.realisticNativeCl100k).toBeLessThanOrEqual(regexHitEvent.nativeCl100k);
        expect(regexHitEvent.savedCl100k).toBe(
          regexHitEvent.nativeCl100k - regexHitEvent.aiceCl100k,
        );

        // 3. :/pattern/ zero-match regex records honest wrapper-bounded baseline
        await aiceRead("src/large.ts:/DEFINITELY_NO_MATCH_XYZ_999/", { projectRoot: tmpDir });
        events = readTelemetryEvents(telemetryFile);
        const zeroMatchEvent = events[events.length - 1]!;
        expect(zeroMatchEvent.aiceCl100k).toBeGreaterThan(0);
        expect(zeroMatchEvent.realisticNativeCl100k).toBeLessThanOrEqual(
          zeroMatchEvent.nativeCl100k,
        );
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
    it("emits compact contiguous native source lines on <=25L and >25L :symbol reads, inline bare files, and supports 1-turn splice", async () => {
      // <=25-line :Class.method read emits clean native lines + contracts + callers + siblings
      const shortSymRes = await read("src/small.ts:SmallCalculator.compute", {
        projectRoot: tmpDir,
      });
      expect(shortSymRes.mode).toBe("context");
      expect(shortSymRes.text).toContain(
        "  public compute(cfg: MetricConfig, raw: number): string {",
      );
      expect(shortSymRes.text).toContain('    return cfg.label + ":" + String(scaled);');
      expect(shortSymRes.text).not.toContain("4│ ");
      expect(shortSymRes.text).toContain("MetricConfig");
      expect(shortSymRes.text).toContain("Downstream Callers");
      expect(shortSymRes.text).toContain("// siblings in SmallCalculator:");

      // >25-line :symbol read also emits clean contiguous native lines
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
        "export function runThirtyFiveLinePipeline(cfg: MetricConfig, seed: number): number {",
      );
      expect(longSymRes.text).toContain("  return cfg.weight + acc_29;");
      expect(longSymRes.text).not.toContain("3│ ");

      // Returned native lines work directly in 1-turn aice splice (<<< === >>> and :Lstart-Lend) without a second read
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
    it("auto-outlines >120L bare files by default (or settles with explicit threshold) and water-fills multi-file targets smallest-first", async () => {
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

      const defaultAutoRes = await read("src/medium450.ts", { projectRoot: tmpDir });
      expect(defaultAutoRes.mode).toBe("auto-outline-file");
      expect(defaultAutoRes.text).toContain("// Auto-outlined src/medium450.ts");

      const res450 = await read("src/medium450.ts", {
        projectRoot: tmpDir,
        autoOutlineLineThreshold: 500,
      });
      expect(res450.mode).toBe("context");
      expect(res450.text).not.toContain("// Auto-outlined");
      expect(res450.text).toContain("import { type MetricConfig }");
      expect(res450.text).toContain("export const m450_448 = 448;");

      // 2. Multi-file smallest-first water-filling: even when >28 KB target is listed FIRST,
      // smaller <=120L bare targets still get full inline native source!
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
      expect(multiWaterfill.text).toContain("public compute(cfg: MetricConfig");
      expect(multiWaterfill.text).toContain("export interface MetricConfig {");
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

      // 1. Compact grouped search hits with exact line numbers
      const shortHit = await read("src/ast_search.ts:/HIT_SHORT_DECL/", { projectRoot: tmpDir });
      expect(shortHit.mode).toBe("search");
      expect(shortHit.text).toContain("src/ast_search.ts:");
      expect(shortHit.text).toContain("L4:   const HIT_SHORT_DECL = stepA * 2;");
      expect(shortHit.text).not.toContain("longTargetDecl");

      // 2. Adjacent matches grouped cleanly under single file header
      const longHit = await read("src/ast_search.ts:/HIT_LONG_DECL_/", { projectRoot: tmpDir });
      expect(longHit.mode).toBe("search");
      expect(longHit.text.match(/^src\/ast_search\.ts:$/gm)).toHaveLength(1);
      expect(longHit.text).toContain("L32:   const HIT_LONG_DECL_A = pre_0 + 100;");
      expect(longHit.text).toContain("L34:   const HIT_LONG_DECL_B = HIT_LONG_DECL_A + midGap;");
      expect(longHit.text).not.toContain("export function longTargetDecl");

      // 3. Explicit contextLines (-C 1) expands exact ±1 radius around hits
      const explicitRadius = await read("src/ast_search.ts", {
        projectRoot: tmpDir,
        search: "HIT_SHORT_DECL",
        contextLines: 1,
      });
      expect(explicitRadius.text).toContain("L3:   const stepA = x + 1;");
      expect(explicitRadius.text).toContain("L6:   return stepB;");
      expect(explicitRadius.text).not.toContain("export function shortTargetDecl");

      // 4. Broad multi-file search respects global 28 KB / 9 KB CLI budget
      const manySearchDir = path.join(tmpDir, "src", "broad_search");
      fs.mkdirSync(manySearchDir, { recursive: true });
      for (let f = 1; f <= 160; f++) {
        const body = [
          `export function broadHandler_${f}(payload: string): string {`,
          ...Array.from(
            { length: 28 },
            (_, i) =>
              `  const line_${f}_${i} = payload + "_BROAD_COMMON_TOKEN_${i}_padding_text_value_extra_segment_${f}";`,
          ),
          `  return line_${f}_0;`,
          "}",
        ].join("\n");
        fs.writeFileSync(path.join(manySearchDir, `handler_${f}.ts`), `${body}\n`, "utf-8");
      }
      const broadSearchRes = await read("src/broad_search", {
        projectRoot: tmpDir,
        search: "BROAD_COMMON_TOKEN_",
      });
      expect(Buffer.byteLength(broadSearchRes.output, "utf-8")).toBeLessThanOrEqual(
        DEFAULT_READ_MAX_BYTES,
      );

      const cliBroadSearchRes = await read("src/broad_search", {
        projectRoot: tmpDir,
        search: "BROAD_COMMON_TOKEN_",
        surface: "cli",
      });
      expect(Buffer.byteLength(cliBroadSearchRes.output, "utf-8")).toBeLessThanOrEqual(
        DEFAULT_CLI_READ_MAX_BYTES + 1024,
      );
      expect(cliBroadSearchRes.output).toContain("more matching files — next: aice search");
      expect(cliBroadSearchRes.output).not.toContain("--full");
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
      expect(plainRegexRes.text).toContain("L6: export function evaluateAlphaRule");
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
      expect(allFiles.output).toMatch(/small\.ts \(\d+L\)/);
      expect(allFiles.output).toContain("mod_20.ts (1L)");
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

    it("enforces 9 KB CLI ceiling on multi-slice payload with full: true without --full hints unless unboundedCli: true", async () => {
      const lines = Array.from(
        { length: 250 },
        (_, i) => `export const payloadKey_${i + 1} = "long_padding_bytes_value_${i + 1}";`,
      ).join("\n");
      fs.writeFileSync(path.join(tmpDir, "src", "multi_slice_heavy.ts"), `${lines}\n`, "utf-8");

      const targets = ["src/multi_slice_heavy.ts:L1-L95", "src/multi_slice_heavy.ts:L100-L205"];

      // 1. With full: true on surface: "cli", strictly capped <= 9,216 B without --full hints
      const cappedRes = await read(targets, {
        projectRoot: tmpDir,
        surface: "cli",
        full: true,
      });
      const cappedBytes = Buffer.byteLength(cappedRes.output, "utf-8");
      expect(cappedBytes).toBeLessThanOrEqual(DEFAULT_CLI_READ_MAX_BYTES);
      expect(cappedRes.output).not.toContain("--full");
      expect(cappedRes.output).toContain("9 KB CLI");

      // 2. With full: true and unboundedCli: true, emits both slices > 9,216 B
      const unboundedRes = await read(targets, {
        projectRoot: tmpDir,
        surface: "cli",
        full: true,
        unboundedCli: true,
      });
      const unboundedBytes = Buffer.byteLength(unboundedRes.output, "utf-8");
      expect(unboundedBytes).toBeGreaterThan(DEFAULT_CLI_READ_MAX_BYTES);
      expect(unboundedRes.output).not.toContain("[9 KB CLI stdout budget reached");
      expect(unboundedRes.output).toContain("payloadKey_1");
      expect(unboundedRes.output).toContain("payloadKey_205");
    });

    it("enforces cross-process CLI chaining budget <= 9,216 B (< 9,892 B) while separate invocations get full budgets independently", () => {
      const repoRoot = process.cwd();
      const tsxBin = path.join(repoRoot, "node_modules", ".bin", "tsx");
      const cliEntry = path.join(repoRoot, "bin", "aice.ts");
      const cliWs = fs.mkdtempSync(path.join(os.tmpdir(), "aice-cli-chaining-"));
      fs.mkdirSync(path.join(cliWs, "src"), { recursive: true });
      fs.writeFileSync(
        path.join(cliWs, "aice.config.json"),
        JSON.stringify({ enabled: true }),
        "utf-8",
      );

      const makeContent = (prefix: string) =>
        Array.from(
          { length: 115 },
          (_, i) =>
            `export const ${prefix}_val_${i + 1} = "pad_string_bytes_marker_seventy_two_${i + 1}";`,
        ).join("\n") + "\n";

      fs.writeFileSync(path.join(cliWs, "src", "file1.ts"), makeContent("f1"), "utf-8");
      fs.writeFileSync(path.join(cliWs, "src", "file2.ts"), makeContent("f2"), "utf-8");
      fs.writeFileSync(path.join(cliWs, "src", "file3.ts"), makeContent("f3"), "utf-8");

      const stateFile = path.join(cliWs, "budget-state.json");
      const env = {
        ...process.env,
        AICE_CLI_BUDGET_STATE_FILE: stateFile,
        AICE_CLI_INTERACTIVE: "0",
      };

      // 1. Chained execution in single shell pipeline: total stdout strictly <= 9,216 B (< 9,892 B)
      const chainedCmd = `"${tsxBin}" "${cliEntry}" read src/file1.ts && "${tsxBin}" "${cliEntry}" read src/file2.ts && "${tsxBin}" "${cliEntry}" read src/file3.ts`;
      const chainedOutput = execSync(chainedCmd, {
        cwd: cliWs,
        env,
        encoding: "utf-8",
        stdio: "pipe",
      });
      const chainedBytes = Buffer.byteLength(chainedOutput, "utf-8");
      expect(chainedBytes).toBeLessThanOrEqual(DEFAULT_CLI_READ_MAX_BYTES);
      expect(chainedBytes).toBeLessThan(9_892);
      expect(chainedOutput).toContain("f1_val_1");
      expect(chainedOutput).toMatch(
        /\/\/ \[9 KB CLI stdout budget already filled by prior chained command/,
      );

      // 2. Two separate invocations each get full 9,216 B budgets independently
      const sep1 = execFileSync(tsxBin, [cliEntry, "read", "src/file1.ts"], {
        cwd: cliWs,
        env,
        encoding: "utf-8",
      });
      const sep2 = execFileSync(tsxBin, [cliEntry, "read", "src/file2.ts"], {
        cwd: cliWs,
        env,
        encoding: "utf-8",
      });

      expect(Buffer.byteLength(sep1, "utf-8")).toBeGreaterThan(5_000);
      expect(Buffer.byteLength(sep1, "utf-8")).toBeLessThanOrEqual(DEFAULT_CLI_READ_MAX_BYTES);
      expect(Buffer.byteLength(sep2, "utf-8")).toBeGreaterThan(5_000);
      expect(Buffer.byteLength(sep2, "utf-8")).toBeLessThanOrEqual(DEFAULT_CLI_READ_MAX_BYTES);
      expect(sep1).toContain("f1_val_1");
      expect(sep2).toContain("f2_val_1");
      expect(sep1).not.toContain("budget already filled");
      expect(sep2).not.toContain("budget already filled");
    });
  });

  describe("v0.9.47 Upgrades 2 & 3: Symbol Focus Slicing (@pattern) and Lossless Large Line Range Elision", () => {
    it("performs symbol focus slicing on .ts files with function header, setup vars, ±6-line match windows, and skipped markers", async () => {
      const tsCode = [
        "// Focus slicing test file", // Line 1
        "export function executeServicePipeline(reqId: string, payload: Record<string, unknown>): boolean {", // Line 2
        "  const setupLimit = 500;", // Line 3
        "  let setupActive = true;", // Line 4
        ...Array.from({ length: 25 }, (_, i) => `  performStepWork(${i + 5});`), // Lines 5-29
        '  const kw1_result = "matched alpha keyword marker";', // Line 30
        ...Array.from({ length: 29 }, (_, i) => `  performIntermediateWork(${i + 31});`), // Lines 31-59
        '  const kw2_result = "matched beta keyword marker";', // Line 60
        ...Array.from({ length: 15 }, (_, i) => `  performFinalWork(${i + 61});`), // Lines 61-75
        "  return setupActive;", // Line 76
        "}", // Line 77
      ].join("\n");
      fs.writeFileSync(path.join(tmpDir, "src", "focus_service.ts"), `${tsCode}\n`, "utf-8");

      // 1. Inline selector syntax: file:Symbol@kw1|kw2
      const res = await aiceRead("src/focus_service.ts:executeServicePipeline@kw1|kw2", {
        projectRoot: tmpDir,
      });

      expect(res.output).toContain("// src/focus_service.ts:executeServicePipeline@kw1|kw2");
      expect(res.output).toContain("2: export function executeServicePipeline");
      expect(res.output).toContain("  const setupLimit = 500;");
      expect(res.output).toContain("  let setupActive = true;");
      expect(res.output).toContain("// ... [L5-L23 skipped — 19 unrelated lines] ...");
      expect(res.output).toContain('  const kw1_result = "matched alpha keyword marker";');
      expect(res.output).toContain("// ... [L37-L53 skipped — 17 unrelated lines] ...");
      expect(res.output).toContain('  const kw2_result = "matched beta keyword marker";');
      expect(res.output).toContain("// ... [L67-L77 skipped — 11 unrelated lines] ...");

      // Verify ±6 lines around kw1 (line 30) -> lines 24 to 36
      expect(res.output).toContain("24:   performStepWork(24);");
      expect(res.output).toContain("  performIntermediateWork(36);");
      expect(res.output).not.toContain("performStepWork(23);");
      expect(res.output).not.toContain("performIntermediateWork(37);");

      // 2. Option symbol syntax: symbol: "executeServicePipeline@kw1|kw2"
      const resOption = await aiceRead("src/focus_service.ts", {
        symbol: "executeServicePipeline@kw1|kw2",
        projectRoot: tmpDir,
      });
      expect(resOption.output).toBe(res.output);
    });

    it("performs symbol focus slicing on .aipl files resolving AST outline range and emitting focus windows", async () => {
      const aiplCode = [
        "module FocusPipelineTest", // Line 1
        "", // Line 2
        "fn runPipelineTask(data: string): string:", // Line 3
        "  val maxLimit = 100", // Line 4
        "  val counter = 0", // Line 5
        ...Array.from({ length: 20 }, (_, i) => `  processData(${i + 6})`), // Lines 6-25
        '  val kw1_trigger = "alpha kw1 signal"', // Line 26
        ...Array.from({ length: 24 }, (_, i) => `  processIntermediate(${i + 27})`), // Lines 27-50
        '  val kw2_trigger = "beta kw2 signal"', // Line 51
        ...Array.from({ length: 15 }, (_, i) => `  processFinal(${i + 52})`), // Lines 52-66
        "  return data", // Line 67
      ].join("\n");
      fs.writeFileSync(path.join(tmpDir, "src", "focus_pipeline.aipl"), `${aiplCode}\n`, "utf-8");

      const res = await aiceRead("src/focus_pipeline.aipl:runPipelineTask@kw1|kw2", {
        projectRoot: tmpDir,
      });

      expect(res.output).toContain("// src/focus_pipeline.aipl:runPipelineTask@kw1|kw2");
      expect(res.output).toContain("3: fn runPipelineTask(data: string): string:");
      expect(res.output).toContain("  val maxLimit = 100");
      expect(res.output).toContain("  val counter = 0");
      expect(res.output).toContain('  val kw1_trigger = "alpha kw1 signal"');
      expect(res.output).toContain('  val kw2_trigger = "beta kw2 signal"');
      expect(res.output).toMatch(/\/\/ \.\.\. \[L6-L19 skipped — 14 unrelated lines\] \.\.\./);
      expect(res.output).toMatch(/\/\/ \.\.\. \[L33-L44 skipped — 12 unrelated lines\] \.\.\./);
      expect(res.output).toMatch(/\/\/ \.\.\. \[L58-L67 skipped — 10 unrelated lines\] \.\.\./);
    });

    it("preserves sym@first and sym@<digits> ordinal disambiguation without treating them as pattern focus selectors", async () => {
      const tsCode = [
        "// Focus slicing test file",
        "export function executeServicePipeline(reqId: string): boolean {",
        "  const setupLimit = 500;",
        "  return setupLimit > 0;",
        "}",
      ].join("\n");
      fs.writeFileSync(path.join(tmpDir, "src", "focus_service.ts"), `${tsCode}\n`, "utf-8");

      expect(parseSymbolPatternSelector("executeServicePipeline@first")).toBeNull();
      expect(parseSymbolPatternSelector("executeServicePipeline@1")).toBeNull();
      expect(parseSymbolPatternSelector("executeServicePipeline@2")).toBeNull();
      expect(parseSymbolPatternSelector("executeServicePipeline@kw1|kw2")).toEqual({
        symbol: "executeServicePipeline",
        pattern: "kw1|kw2",
      });

      const res = await aiceRead("src/focus_service.ts:executeServicePipeline@first", {
        projectRoot: tmpDir,
      });
      expect(res.output).toContain("export function executeServicePipeline");
      expect(res.output).not.toContain("unrelated lines");
      expect(res.output).not.toContain("@first@");
    });

    it("safely compiles focus patterns with ReDoS guards, preserves {m,n} quantifiers, and rejects whitespace in symbols", async () => {
      // 1. ReDoS Guard: compileFocusPattern("(a+)+$") completes in < 20ms
      const t0 = performance.now();
      const compiled = compileFocusPattern("(a+)+$");
      const elapsed = performance.now() - t0;
      expect(elapsed).toBeLessThan(20);
      expect(compiled).toBeInstanceOf(RegExp);
      expect(compiled.source).toBe("\\(a\\+\\)\\+\\$");

      // 2. Reject whitespace in symbol: test titles / Markdown headings are not hijacked
      expect(parseSymbolPatternSelector("rejects invalid user@example.com email")).toBeNull();
      expect(
        parseSymbolPatternSelector('it("rejects invalid user@example.com email", () => {})'),
      ).toBeNull();
      expect(
        parseSymbolPatternSelector("auth.test.ts:rejects invalid user@example.com email"),
      ).toBeNull();

      // 3. Preserve {m,n} regex quantifiers in symbol pattern selectors and comma splitters
      expect(parseSymbolPatternSelector("executeServicePipeline@err\\d{1,2}")).toEqual({
        symbol: "executeServicePipeline",
        pattern: "err\\d{1,2}",
      });

      expect(splitCommaSelectors("executeServicePipeline@err\\d{1,2},helperFn")).toEqual([
        "executeServicePipeline@err\\d{1,2}",
        "helperFn",
      ]);
      expect(splitSymbolSelectors("executeServicePipeline@err\\d{1,2},helperFn")).toEqual([
        "executeServicePipeline@err\\d{1,2}",
        "helperFn",
      ]);

      const tsServiceCode = [
        "// Service with regex-targeted error handling",
        "export function executeServicePipeline(reqId: string): boolean {",
        "  const setupLimit = 500;",
        "  try {",
        "    if (reqId === '') throw new Error('err01: empty');",
        "    if (reqId === 'bad') throw new Error('err99: bad payload');",
        "  } catch (e) {",
        "    console.error(e);",
        "  }",
        "  return setupLimit > 0;",
        "}",
        "export function helperFn(): void {}",
      ].join("\n");
      fs.writeFileSync(
        path.join(tmpDir, "src", "focus_service_quantifier.ts"),
        `${tsServiceCode}\n`,
        "utf-8",
      );

      const readRes = await aiceRead(
        "src/focus_service_quantifier.ts:executeServicePipeline@err\\d{1,2}",
        {
          projectRoot: tmpDir,
        },
      );
      expect(readRes.output).toContain("export function executeServicePipeline");
      expect(readRes.output).toContain("err01: empty");
    });

    it("losslessly elides contiguous imports, blank lines, and decorative dividers on large line range slices (>140L) under CLI budget", async () => {
      // 400-line file with 45 imports, blank lines, divider banners, and 250 real code lines
      const fileLines: string[] = [];
      // Lines 1-45: 45 imports
      for (let i = 1; i <= 45; i++) {
        fileLines.push(`import { depModule_${i} } from "./depModule_${i}.js";`);
      }
      // Lines 46-50: divider banners & blank lines
      fileLines.push("// ==================================================");
      fileLines.push("// ==================================================");
      fileLines.push("");
      fileLines.push("");
      fileLines.push("// Real architectural documentation describing the entity registry");

      // Lines 51-150: 100 code lines
      for (let i = 51; i <= 150; i++) {
        fileLines.push(`export const k_${i} = ${i};`);
      }
      // Lines 151-200: 50 divider walls & blank lines
      for (let i = 151; i <= 200; i++) {
        if (i % 2 === 0) fileLines.push("");
        else fileLines.push("// ==================================================");
      }
      // Lines 201-330: 130 code lines
      for (let i = 201; i <= 330; i++) {
        fileLines.push(`export const k_${i} = ${i};`);
      }
      // Lines 331-380: 50 divider walls & blank lines
      for (let i = 331; i <= 380; i++) {
        if (i % 2 === 0) fileLines.push("");
        else fileLines.push("// --------------------------------------------------");
      }
      // Lines 381-400: 20 code lines
      for (let i = 381; i <= 400; i++) {
        fileLines.push(`export const k_${i} = ${i};`);
      }
      expect(fileLines.length).toBe(400);

      fs.writeFileSync(
        path.join(tmpDir, "src", "large_elision.ts"),
        `${fileLines.join("\n")}\n`,
        "utf-8",
      );

      // 1. CLI surface without --full: elides imports, skips blanks and divider walls, preserves disk line numbers
      const res = await aiceRead("src/large_elision.ts:L1-L400", {
        projectRoot: tmpDir,
        surface: "cli",
      });

      // Verifies 45 import lines folded
      expect(res.output).toContain("// [L1-L45: 45 import lines folded — use :imports to expand]");
      expect(res.output).not.toContain("depModule_1");
      expect(res.output).not.toContain("depModule_45");

      // Verifies blank lines and divider walls are skipped
      expect(res.output).not.toContain("==================================================");
      expect(res.output).not.toContain("--------------------------------------------------");

      // Verifies real architectural prose comment is preserved with discontinuity line number
      expect(res.output).toContain(
        "50: // Real architectural documentation describing the entity registry",
      );

      // Verifies contiguous code lines and post-gap discontinuity numbering
      expect(res.output).toContain("export const k_51 = 51;");
      expect(res.output).toContain("201: export const k_201 = 201;");
      expect(res.output).toContain("export const k_400 = 400;");

      // Verifies 200+ real code lines emitted
      const emittedLines = res.output.split("\n");
      const codeLinesEmitted = emittedLines.filter((l) => /^(?:\d+:\s*)?export const k_/.test(l));
      expect(codeLinesEmitted.length).toBeGreaterThanOrEqual(200);

      // Verifies output fits inside <= 9,216 bytes (DEFAULT_CLI_READ_MAX_BYTES) in 1 call!
      const byteLen = Buffer.byteLength(res.output, "utf-8");
      expect(byteLen).toBeLessThanOrEqual(DEFAULT_CLI_READ_MAX_BYTES);

      // 2. When full: true and unboundedCli: true, elision is bypassed
      const fullRes = await aiceRead("src/large_elision.ts:L1-L400", {
        projectRoot: tmpDir,
        surface: "cli",
        full: true,
        unboundedCli: true,
      });
      expect(fullRes.output).toContain("import { depModule_1 }");
      expect(fullRes.output).toContain("==================================================");
      expect(fullRes.output).not.toContain("import lines folded");
    });
  });

  describe("v0.9.49 Upgrades 1-3: Same-File Coalescing, >110L Elision, Original-Order Partial Fill & Elision-Aware Slice Span", () => {
    it("Upgrade 1: coalesces same-file space-separated :L and :symbol targets in normalizeReadTargets & aiceRead while preserving non-coalescible and json modes", async () => {
      const lines = [
        "export function alphaStep(x: number): number {",
        "  return x + 1;",
        "}",
        ...Array.from({ length: 140 }, (_, i) => `export const midVal_${i + 4} = ${i + 4};`),
        "export function omegaStep(y: number): number {",
        "  return y * 2;",
        "}",
      ];
      fs.writeFileSync(
        path.join(tmpDir, "src", "coalesce_target.ts"),
        `${lines.join("\n")}\n`,
        "utf-8",
      );

      // 1. String space-separated :L coalescing + deduplication
      const normRanges = normalizeReadTargets(
        "src/coalesce_target.ts:L1-L3 src/coalesce_target.ts:L144-L146 src/coalesce_target.ts:L1-L3",
        tmpDir,
      );
      expect(normRanges).toHaveLength(1);
      expect(normRanges[0]?.targetPath).toBe("src/coalesce_target.ts");
      expect(normRanges[0]?.selector).toBe("L1-L3,L144-L146");

      // 2. Array :symbol coalescing (CLI variadic args path)
      const normSyms = normalizeReadTargets(
        ["src/coalesce_target.ts:alphaStep", "src/coalesce_target.ts:omegaStep"],
        tmpDir,
      );
      expect(normSyms).toHaveLength(1);
      expect(normSyms[0]?.selector).toBe("alphaStep,omegaStep");

      // 3. Opt-out coalesceSameFile: false keeps separate entries
      const uncoalesced = normalizeReadTargets(
        "src/coalesce_target.ts:L1-L3 src/coalesce_target.ts:L144-L146",
        tmpDir,
        { coalesceSameFile: false },
      );
      expect(uncoalesced).toHaveLength(2);

      // 4. Outline / regex / bare targets are NOT coalesced into :L/:symbol
      const mixedNonCoalescible = normalizeReadTargets(
        "src/coalesce_target.ts:outline src/coalesce_target.ts:alphaStep src/coalesce_target.ts:/omegaStep/",
        tmpDir,
      );
      expect(mixedNonCoalescible).toHaveLength(3);

      // 5. End-to-end aiceRead emits single minimal header without Multi-File Context Stream bloat
      const readRes = await aiceRead(
        "src/coalesce_target.ts:L1-L3 src/coalesce_target.ts:L144-L146",
        {
          projectRoot: tmpDir,
          surface: "cli",
        },
      );
      expect(readRes.output).toContain("// src/coalesce_target.ts");
      expect(readRes.output).not.toContain("# AICE Multi-File Context Stream");
      expect(readRes.output).toContain("export function alphaStep");
      expect(readRes.output).toContain("export function omegaStep");
    });

    it("Upgrade 1: applies lossless elision above >110 lines on both single :L and coalesced comma-separated :L selectors", async () => {
      const elideLines: string[] = [];
      for (let i = 1; i <= 140; i++) {
        if (i % 5 === 0) {
          elideLines.push("");
        } else if (i % 7 === 0) {
          elideLines.push("// ==================================================");
        } else {
          elideLines.push(`export const item_${i} = ${i};`);
        }
      }
      fs.writeFileSync(
        path.join(tmpDir, "src", "elide_110.ts"),
        `${elideLines.join("\n")}\n`,
        "utf-8",
      );

      // 1. Single <= 110 lines (L1-L110): NOT elided (preserves divider banners)
      const res110 = await aiceRead("src/elide_110.ts:L1-L110", {
        projectRoot: tmpDir,
        surface: "cli",
      });
      expect(res110.output).toContain("==================================================");

      // 2. Single 112 lines (L1-L112 > 110): elided!
      const res112 = await aiceRead("src/elide_110.ts:L1-L112", {
        projectRoot: tmpDir,
        surface: "cli",
      });
      expect(res112.output).not.toContain("==================================================");
      expect(res112.output).toContain("export const item_111 = 111;");

      // 3. Space-separated / comma-separated ranges with combined span > 110 (60 + 60 = 120 > 110): elided!
      const resMulti120 = await aiceRead("src/elide_110.ts:L1-L60 src/elide_110.ts:L71-L130", {
        projectRoot: tmpDir,
        surface: "cli",
      });
      expect(resMulti120.output).not.toContain(
        "==================================================",
      );
      expect(resMulti120.output).toContain("export const item_1 = 1;");
      expect(resMulti120.output).toContain("export const item_129 = 129;");
    });
    it("Upgrade 2: preserves original request order in multi-target budget packing and partially fills remaining >= 1,500 B budget with exact :L<resume>-L<end> footer", async () => {
      // Target A: ~3.5 KB (fits inline)
      const fileALines = Array.from(
        { length: 48 },
        (_, i) => `export const targetA_${i + 1} = "alpha_payload_chunk_padding_value_${i + 1}";`,
      );
      fs.writeFileSync(
        path.join(tmpDir, "src", "order_a.ts"),
        `${fileALines.join("\n")}\n`,
        "utf-8",
      );

      // Target B: ~7.5 KB (exceeds remaining ~5 KB, so triggers partial fill instead of dropping to 0 lines)
      const fileBLines = Array.from(
        { length: 120 },
        (_, i) => `export const targetB_${i + 1} = "beta_payload_chunk_padding_value_${i + 1}";`,
      );
      fs.writeFileSync(
        path.join(tmpDir, "src", "order_b.ts"),
        `${fileBLines.join("\n")}\n`,
        "utf-8",
      );

      // Target C: ~1 KB (small file listed AFTER B — must NOT jump ahead of B under original-order packing)
      const fileCLines = Array.from(
        { length: 12 },
        (_, i) => `export const targetC_${i + 1} = "gamma_small_value_${i + 1}";`,
      );
      fs.writeFileSync(
        path.join(tmpDir, "src", "order_c.ts"),
        `${fileCLines.join("\n")}\n`,
        "utf-8",
      );

      const res = await aiceRead(
        ["src/order_a.ts:L1-L48", "src/order_b.ts:L1-L120", "src/order_c.ts:L1-L12"],
        {
          projectRoot: tmpDir,
          surface: "cli",
        },
      );

      expect(Buffer.byteLength(res.output, "utf-8")).toBeLessThanOrEqual(
        DEFAULT_CLI_READ_MAX_BYTES,
      );
      // Target A is emitted in full
      expect(res.output).toContain("targetA_1");
      expect(res.output).toContain("targetA_48");
      // Target B receives partial slice fill with remaining span summary (no sequential :L breadcrumb)
      expect(res.output).toContain("targetB_1");
      expect(res.output).toMatch(
        /\/\/ \[9 KB CLI budget reached \(L\d+-L120 remaining\) — narrow with aice search <pat> src\/order_b\.ts\]/,
      );
      expect(res.output).not.toContain("next slice:");
      // Target C (fitting explicit range) packs in Turn 1 while strictly preserving A -> B -> C order!
      expect(res.output).toContain("targetC_12");
      expect(res.output.indexOf("src/order_a.ts")).toBeLessThan(
        res.output.indexOf("src/order_b.ts"),
      );
      expect(res.output.indexOf("src/order_b.ts")).toBeLessThan(
        res.output.indexOf("src/order_c.ts"),
      );
    });

    it("Upgrade 3: computeDynamicSliceSpan excludes blanks & decorative divider comments in CLI mode and allows up to 180 lines", () => {
      const mixedLines: string[] = [];
      for (let i = 1; i <= 300; i++) {
        if (i % 3 === 0) {
          mixedLines.push("");
        } else if (i % 3 === 1) {
          mixedLines.push(
            "// ──────────────────────────────────────────────────────────────────────────────",
          );
        } else {
          mixedLines.push(`export const v_${i} = ${i}; // short line`);
        }
      }
      const srcText = `${mixedLines.join("\n")}\n`;
      const cliSpan = computeDynamicSliceSpan(
        path.join(tmpDir, "src", "elision_span.ts"),
        srcText,
        1,
        DEFAULT_CLI_SLICE_BYTE_BUDGET,
      );
      expect(cliSpan.rawMaxLines).toBe(180);
      expect(cliSpan.snappedToSymbol).toBe(true);
      expect(cliSpan.endLine).toBe(179);

      // Compare against a dense file without blanks/dividers (~95 bytes/line -> ~84 lines in CLI mode)
      const denseLines = Array.from(
        { length: 300 },
        (_, i) =>
          `export const denseLine_${i + 1} = "dense_payload_with_sufficient_bytes_for_budget_${i + 1}";`,
      );
      const denseSpan = computeDynamicSliceSpan(
        path.join(tmpDir, "src", "dense_span.ts"),
        `${denseLines.join("\n")}\n`,
        1,
        DEFAULT_CLI_SLICE_BYTE_BUDGET,
      );
      expect(denseSpan.rawMaxLines).toBeGreaterThanOrEqual(80);
      expect(denseSpan.rawMaxLines).toBeLessThan(120);
    });
  });

  describe("v0.9.49 Upgrade 5: Monolith-Aware Pattern Search Focus Slicing (>65L) & Single-File Search Baseline", () => {
    it("focus-slices >65L enclosing symbols with signature + merged ±5 windows + skipped markers, preserves <=65L symbols, and credits single-file search realistic baseline", async () => {
      const compactAndMonolithLines = [
        "export function compactSearchHelper(x: number): number {", // L1
        "  const step1 = x + 10;", // L2
        "  const COMPACT_SEARCH_NEEDLE = step1 * 2;", // L3
        "  const step2 = COMPACT_SEARCH_NEEDLE - 5;", // L4
        "  return step2;", // L5
        "}", // L6
        "", // L7
        "export function renderObjects3D(ctx: { width: number; height: number }, count: number): number {", // L8
        "  const viewportW = ctx.width;", // L9
        "  const viewportH = ctx.height;", // L10
        "  let accumulator = viewportW + viewportH;", // L11
        ...Array.from(
          { length: 28 },
          (_, i) => `  accumulator += Math.sin(${i + 1} + count) * 0.125;`,
        ), // L12..L39
        "  const MONOLITH_NEEDLE_ALPHA = accumulator * 2.5;", // L40
        ...Array.from(
          { length: 49 },
          (_, i) => `  accumulator += Math.cos(${i + 41} + count) * 0.25;`,
        ), // L41..L89
        "  const MONOLITH_NEEDLE_BETA = MONOLITH_NEEDLE_ALPHA + 42;", // L90
        ...Array.from({ length: 36 }, (_, i) => `  accumulator += (${i + 91} * count) % 7;`), // L91..L126
        "  return Math.round(accumulator);", // L127
        "}", // L128 (121-line monolith function: L8..L128)
        "", // L129
        "export function denseMonolith(val: number): number {", // L130
        ...Array.from({ length: 68 }, (_, i) => {
          if (i % 10 === 4) {
            return `  const DENSE_HIT_${i} = val + ${i};`;
          }
          return `  const pad_${i} = val + ${i};`;
        }), // L131..L198
        "  return val;", // L199
        "}", // L200 (71-line monolith with >= 65% ±6 coverage on DENSE_HIT_)
      ];

      fs.writeFileSync(
        path.join(tmpDir, "src", "monolith_search.ts"),
        `${compactAndMonolithLines.join("\n")}\n`,
        "utf-8",
      );

      // 1. Compact grouped search in aiceRead emits ultra-compact grouped hits
      const compactRes = await aiceRead("src/monolith_search.ts", {
        projectRoot: tmpDir,
        search: "COMPACT_SEARCH_NEEDLE",
        surface: "cli",
      });
      expect(compactRes.mode).toBe("search");
      expect(compactRes.output).toContain("src/monolith_search.ts:");
      expect(compactRes.output).toContain("L3:   const COMPACT_SEARCH_NEEDLE = step1 * 2;");
      expect(compactRes.output).toContain("L4:   const step2 = COMPACT_SEARCH_NEEDLE - 5;");
      expect(compactRes.output).not.toContain("│");

      const monolithRes = await aiceRead("src/monolith_search.ts", {
        projectRoot: tmpDir,
        search: "MONOLITH_NEEDLE_",
        surface: "cli",
      });
      expect(monolithRes.mode).toBe("search");
      expect(monolithRes.output).toContain("src/monolith_search.ts:");
      expect(monolithRes.output).toContain(
        "L40:   const MONOLITH_NEEDLE_ALPHA = accumulator * 2.5;",
      );
      expect(monolithRes.output).toContain(
        "L90:   const MONOLITH_NEEDLE_BETA = MONOLITH_NEEDLE_ALPHA + 42;",
      );

      // Verify >50% byte & token savings vs full monolith function expansion
      const fullMonolithText = compactAndMonolithLines.slice(7, 128).join("\n");
      expect(Buffer.byteLength(monolithRes.output, "utf-8")).toBeLessThan(
        Buffer.byteLength(fullMonolithText, "utf-8") * 0.5,
      );
      expect(estimateTokens(monolithRes.output)).toBeLessThan(
        estimateTokens(fullMonolithText) * 0.5,
      );

      // 2. Direct generateContext with rawNative: true & non-grouped AST search still focus-slices >65L monoliths
      const directMonolithCtx = await generateContext(
        path.join(tmpDir, "src", "monolith_search.ts"),
        {
          projectRoot: tmpDir,
          symbol: "/MONOLITH_NEEDLE_/",
          rawNative: false,
        },
      );
      expect(directMonolithCtx.targetContent).toContain("// match at [L40, L90] # [L8-L128]");
      expect(directMonolithCtx.targetContent).toContain(
        "// ... [L12-L34 skipped — 23 unrelated lines] ...",
      );
      expect(directMonolithCtx.targetContent).toContain(
        "// ... [L46-L84 skipped — 39 unrelated lines] ...",
      );
      expect(directMonolithCtx.targetContent).toContain(
        "// ... [L96-L128 skipped — 33 unrelated lines] ...",
      );

      // 3. Explicit -C (contextLines) expands exact ±2 window around match
      const explicitCtxRes = await aiceRead("src/monolith_search.ts", {
        projectRoot: tmpDir,
        search: "MONOLITH_NEEDLE_ALPHA",
        contextLines: 2,
        surface: "cli",
      });
      expect(explicitCtxRes.output).toContain("L38:");
      expect(explicitCtxRes.output).toContain("L42:");
      expect(explicitCtxRes.output).not.toContain("export function renderObjects3D");

      // 4. Honest single-file search telemetry: strictly rn <= n1 (zero min(a1+350, n1+650) padding!) and a1 < rn
      const telemetryFile = path.join(tmpDir, "upgrade5-search-telemetry.jsonl");
      const prevEnv = process.env.AICE_TELEMETRY_PATH;
      process.env.AICE_TELEMETRY_PATH = telemetryFile;
      try {
        await aiceRead("src/monolith_search.ts", {
          projectRoot: tmpDir,
          search: "MONOLITH_NEEDLE_",
          surface: "cli",
        });
        const events = readTelemetryEvents(telemetryFile);
        const searchEv = events[events.length - 1]!;
        expect(searchEv.nativeCl100k).toBeGreaterThan(0);
        expect(searchEv.realisticNativeCl100k).toBeDefined();
        expect(searchEv.realisticNativeCl100k!).toBeLessThanOrEqual(searchEv.nativeCl100k);
        expect(searchEv.aiceCl100k).toBeLessThan(searchEv.realisticNativeCl100k!);
        expect(searchEv.savedCl100k).toBe(searchEv.nativeCl100k - searchEv.aiceCl100k);
        expect(searchEv.realisticSavedCl100k).toBe(
          searchEv.realisticNativeCl100k! - searchEv.aiceCl100k,
        );
        expect(searchEv.realisticSavedCl100k).toBeGreaterThan(0);
      } finally {
        if (prevEnv === undefined) {
          delete process.env.AICE_TELEMETRY_PATH;
        } else {
          process.env.AICE_TELEMETRY_PATH = prevEnv;
        }
      }
    });
  });
});
