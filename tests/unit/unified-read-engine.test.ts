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
  computeLineRangeBaselineText,
  computeRegexBaselineText,
  countSourceLines,
  DEFAULT_READ_MAX_BYTES,
  normalizeReadTargets,
  parseReadTarget,
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

    it("auto-outlines bare files exceeding 250 lines with guidance header", async () => {
      const res = await aiceRead("src/large.ts", { projectRoot: tmpDir });

      expect(res.mode).toBe("auto-outline-file");
      expect(res.targets[0]?.autoOutlined).toBe(true);
      expect(res.targets[0]?.lineCount).toBe(280);
      expect(res.text).toContain(
        "// Auto-outlined (280 lines). Pass src/large.ts:<symbol>, src/large.ts:L<start>-L<end>, or --full for full source.",
      );
      expect(res.text).toContain("LargeService");
      expect(res.text).toContain("computeMetric");
      // Local implementation secret inside computeMetric is omitted in skeleton outline
      expect(res.text).not.toContain("987654321");
    });

    it("bypasses >250-line auto-outline when options.full is true", async () => {
      const res = await aiceRead("src/large.ts", { projectRoot: tmpDir, full: true });

      expect(res.mode).toBe("context");
      expect(res.text).not.toContain("// Auto-outlined");
      expect(res.text).toContain("987654321");
      expect(res.dependencies.length).toBeGreaterThan(0);
      expect(res.text).toContain("MetricConfig");
    });

    it("returns zero-envelope fast path for <=150-line bare files and full context pack for 151..250-line bare files", async () => {
      const smallRes = await aiceRead("src/small.ts", { projectRoot: tmpDir });
      expect(smallRes.mode).toBe("context");
      expect(smallRes.text).not.toContain("// Auto-outlined");
      expect(smallRes.text).toContain("// === src/small.ts ===");
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

      // Exact 250-line boundary file (>150 and <=250 lines) ending with \n gets full context pack
      const boundaryPath = path.join(tmpDir, "src", "boundary250.ts");
      const lines250 = `${Array.from({ length: 250 }, (_, i) => `export const b${i} = ${i};`).join("\n")}\n`;
      fs.writeFileSync(boundaryPath, lines250, "utf-8");

      const boundaryRes = await aiceRead("src/boundary250.ts", { projectRoot: tmpDir });
      expect(boundaryRes.mode).toBe("context");
      expect(boundaryRes.text).not.toContain("// Auto-outlined");
      expect(boundaryRes.text).toContain("# AICE Context Pack: src/boundary250.ts");
      expect(boundaryRes.text).toContain("b249");
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
      const outlineJson = await aiceRead("src/large.ts", {
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
      expect(parsedOutline.lineCount).toBe(280);
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
      expect(budgetedRes.output).toMatch(/aice read src\/heavy\d\.ts:L1-L150/);

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
      expect(dirRes.output).toMatch(/aice read src\/massive\/module_\d+\.ts:L1-L150/);
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
});
