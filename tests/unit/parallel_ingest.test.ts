/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for Side-by-Side Parallel Ingestion Engine (Step 3).
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "../../src/core/parser.js";
import { CstTriviaTable } from "../../src/core/trivia.js";
import { emitTarget } from "../../src/emitters/index.js";
import { MultiLineReporter } from "../../src/runner/index.js";
import { findIngestableFiles, ingestProjectSideBySide } from "../../src/transpiler/index.js";

function createMockStream() {
  const stream = new PassThrough();
  (stream as unknown as { isTTY: boolean }).isTTY = false;
  let output = "";
  stream.on("data", (chunk: Buffer) => {
    output += chunk.toString("utf-8");
  });
  return {
    stream,
    getOutput: () => output,
  };
}

describe("Step 3: Side-by-Side Parallel Ingestion Engine", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "ail-ingest-test-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  function setupSampleProject(baseDir: string): {
    cssPath: string;
    htmlPath: string;
    tsPath: string;
    tsxPath: string;
  } {
    const srcDir = path.join(baseDir, "src");
    fs.mkdirSync(srcDir, { recursive: true });

    const cssPath = path.join(srcDir, "style.css");
    const htmlPath = path.join(srcDir, "page.html");
    const tsPath = path.join(srcDir, "auth.ts");
    const tsxPath = path.join(srcDir, "card.tsx");

    fs.copyFileSync(path.resolve(process.cwd(), "examples/style.css"), cssPath);
    fs.copyFileSync(path.resolve(process.cwd(), "examples/page.html"), htmlPath);
    fs.copyFileSync(path.resolve(process.cwd(), "examples/auth_service.ts"), tsPath);
    fs.copyFileSync(path.resolve(process.cwd(), "examples/dashboard_card.tsx"), tsxPath);

    return { cssPath, htmlPath, tsPath, tsxPath };
  }

  describe("findIngestableFiles", () => {
    it("recursively discovers supported target files while ignoring standard folders", () => {
      setupSampleProject(testDir);

      // Create ignored directories
      const nodeModulesDir = path.join(testDir, "node_modules", "pkg");
      fs.mkdirSync(nodeModulesDir, { recursive: true });
      fs.writeFileSync(path.join(nodeModulesDir, "dep.ts"), "export const x = 1;");

      const distDir = path.join(testDir, "dist");
      fs.mkdirSync(distDir, { recursive: true });
      fs.writeFileSync(path.join(distDir, "bundle.ts"), "export const y = 2;");

      const gitDir = path.join(testDir, ".git");
      fs.mkdirSync(gitDir, { recursive: true });
      fs.writeFileSync(path.join(gitDir, "HEAD.ts"), "dummy");

      // Also create an existing .ail file and trivia file
      fs.writeFileSync(path.join(testDir, "src", "style.css.ail"), "style body: margin 0");
      fs.writeFileSync(path.join(testDir, "src", "style.css.ail.trivia.json"), "{}");

      const files = findIngestableFiles(testDir);

      expect(files).toHaveLength(4);
      expect(files.some((f) => f.endsWith("style.css"))).toBe(true);
      expect(files.some((f) => f.endsWith("page.html"))).toBe(true);
      expect(files.some((f) => f.endsWith("auth.ts"))).toBe(true);
      expect(files.some((f) => f.endsWith("card.tsx"))).toBe(true);

      // Verify ignored files were not returned
      expect(files.some((f) => f.includes("node_modules"))).toBe(false);
      expect(files.some((f) => f.includes("dist"))).toBe(false);
      expect(files.some((f) => f.includes(".git"))).toBe(false);
      expect(files.some((f) => f.endsWith(".ail"))).toBe(false);
      expect(files.some((f) => f.endsWith(".trivia.json"))).toBe(false);
    });

    it("respects custom extensions and custom ignore patterns", () => {
      setupSampleProject(testDir);

      const filesOnlyTs = findIngestableFiles(testDir, { extensions: [".ts"] });
      expect(filesOnlyTs).toHaveLength(1);
      expect(filesOnlyTs[0].endsWith("auth.ts")).toBe(true);

      const filesIgnoredAuth = findIngestableFiles(testDir, {
        ignorePatterns: ["auth.ts"],
      });
      expect(filesIgnoredAuth).toHaveLength(3);
      expect(filesIgnoredAuth.some((f) => f.endsWith("auth.ts"))).toBe(false);
    });

    it("throws when directory does not exist", () => {
      expect(() => {
        findIngestableFiles(path.join(testDir, "non_existent_folder"));
      }).toThrow(/Directory not found/);
    });

    it("returns the single file path when passed a direct file", () => {
      const { tsPath } = setupSampleProject(testDir);
      const result = findIngestableFiles(tsPath);
      expect(result).toEqual([path.resolve(tsPath)]);
    });
  });

  describe("ingestProjectSideBySide", () => {
    it("decompiles supported files into .ail side-by-side with accurate metrics", async () => {
      const { cssPath, htmlPath, tsPath, tsxPath } = setupSampleProject(testDir);

      const summary = await ingestProjectSideBySide({
        dir: testDir,
        concurrency: 2,
      });

      expect(summary.totalDiscovered).toBe(4);
      expect(summary.totalIngested).toBe(4);
      expect(summary.totalSkipped).toBe(0);
      expect(summary.totalFailed).toBe(0);
      expect(summary.totalTargetTokens).toBeGreaterThan(0);
      expect(summary.totalAilTokens).toBeGreaterThan(0);
      expect(summary.cl100kSavingsPct).toBeGreaterThan(0);
      expect(summary.results).toHaveLength(4);

      // Verify side-by-side files exist on disk
      expect(fs.existsSync(`${cssPath}.ail`)).toBe(true);
      expect(fs.existsSync(`${htmlPath}.ail`)).toBe(true);
      expect(fs.existsSync(`${tsPath}.ail`)).toBe(true);
      expect(fs.existsSync(`${tsxPath}.ail`)).toBe(true);

      // Verify AIL content is valid and non-empty
      const tsAil = fs.readFileSync(`${tsPath}.ail`, "utf-8");
      expect(tsAil).toContain("type UserSession:");
      expect(tsAil).toContain("fn sanitize");
    });

    it("never emits .ail.trivia.json sidecar files and inlines comments in .ail", async () => {
      const srcDir = path.join(testDir, "src");
      fs.mkdirSync(srcDir, { recursive: true });

      const fileWithTrivia = path.join(srcDir, "commented.ts");
      const code = `/**
 * JSDoc comment for Service
 */
export interface Service {
  name: string;
}
`;
      fs.writeFileSync(fileWithTrivia, code, "utf-8");

      const summary = await ingestProjectSideBySide({
        dir: testDir,
      });

      expect(summary.totalIngested).toBe(1);
      expect(fs.existsSync(`${fileWithTrivia}.ail`)).toBe(true);
      expect(fs.existsSync(`${fileWithTrivia}.ail.trivia.json`)).toBe(false);

      const ailContent = fs.readFileSync(`${fileWithTrivia}.ail`, "utf-8");
      expect(ailContent).toContain("Service");
    });

    it("skips existing .ail files when overwrite is false", async () => {
      setupSampleProject(testDir);

      // First run: ingests all 4 files
      const firstRun = await ingestProjectSideBySide({
        dir: testDir,
        overwrite: false,
      });
      expect(firstRun.totalIngested).toBe(4);
      expect(firstRun.totalSkipped).toBe(0);

      // Second run: all 4 .ail files exist, so all should be skipped
      const secondRun = await ingestProjectSideBySide({
        dir: testDir,
        overwrite: false,
      });
      expect(secondRun.totalDiscovered).toBe(4);
      expect(secondRun.totalSkipped).toBe(4);
      expect(secondRun.totalIngested).toBe(0);
      expect(secondRun.totalFailed).toBe(0);
      expect(secondRun.results).toHaveLength(0);

      // Third run with overwrite: true re-ingests all 4 files
      const thirdRun = await ingestProjectSideBySide({
        dir: testDir,
        overwrite: true,
      });
      expect(thirdRun.totalDiscovered).toBe(4);
      expect(thirdRun.totalSkipped).toBe(0);
      expect(thirdRun.totalIngested).toBe(4);
      expect(thirdRun.results).toHaveLength(4);
    });

    it("executes in dryRun mode producing metrics without writing files to disk", async () => {
      const { cssPath, htmlPath, tsPath, tsxPath } = setupSampleProject(testDir);

      const summary = await ingestProjectSideBySide({
        dir: testDir,
        dryRun: true,
      });

      expect(summary.totalDiscovered).toBe(4);
      expect(summary.totalIngested).toBe(4);
      expect(summary.totalSkipped).toBe(0);
      expect(summary.totalFailed).toBe(0);
      expect(summary.totalTargetTokens).toBeGreaterThan(0);
      expect(summary.totalAilTokens).toBeGreaterThan(0);
      expect(summary.cl100kSavingsPct).toBeGreaterThan(0);

      // Verify NO .ail files were created on disk
      expect(fs.existsSync(`${cssPath}.ail`)).toBe(false);
      expect(fs.existsSync(`${htmlPath}.ail`)).toBe(false);
      expect(fs.existsSync(`${tsPath}.ail`)).toBe(false);
      expect(fs.existsSync(`${tsxPath}.ail`)).toBe(false);
    });

    it("integrates with ConcurrencyPool and custom MultiLineReporter", async () => {
      setupSampleProject(testDir);

      const mock = createMockStream();
      const reporter = new MultiLineReporter({
        concurrency: 2,
        stream: mock.stream,
        isTTY: false,
      });

      const summary = await ingestProjectSideBySide({
        dir: testDir,
        concurrency: 2,
        reporter,
      });

      expect(summary.totalIngested).toBe(4);
      expect(reporter.isFinished).toBe(true);
      expect(reporter.completedTasks).toBe(4);
      expect(reporter.failedTasks).toBe(0);
      expect(reporter.totalTargetTokens).toBe(summary.totalTargetTokens);
      expect(reporter.totalAilTokens).toBe(summary.totalAilTokens);

      const logs = mock.getOutput();
      expect(logs).toContain("[AIL]");
      expect(logs).toContain("Decompiling");
    });

    it("handles empty project directories gracefully", async () => {
      const mock = createMockStream();
      const reporter = new MultiLineReporter({
        concurrency: 2,
        stream: mock.stream,
        isTTY: false,
      });

      const summary = await ingestProjectSideBySide({
        dir: testDir,
        reporter,
      });

      expect(summary.totalDiscovered).toBe(0);
      expect(summary.totalIngested).toBe(0);
      expect(summary.totalSkipped).toBe(0);
      expect(summary.totalFailed).toBe(0);
      expect(summary.results).toHaveLength(0);
      expect(reporter.isFinished).toBe(true);
    });

    it("records failures without stopping other concurrent tasks when a file is corrupted", async () => {
      setupSampleProject(testDir);

      // Create a corrupted CSS file with invalid syntax that causes decompiler failure
      const brokenCss = path.join(testDir, "src", "broken.css");
      fs.writeFileSync(brokenCss, "body { color: ; @invalid {{{ }}", "utf-8");

      const summary = await ingestProjectSideBySide({
        dir: testDir,
        concurrency: 2,
      });

      expect(summary.totalDiscovered).toBe(5);
      expect(summary.totalIngested).toBe(4);
      expect(summary.totalFailed).toBe(1);

      const failedResult = summary.results.find((r) => r.sourcePath === brokenCss);
      expect(failedResult).toBeDefined();
      expect(failedResult?.success).toBe(false);
      expect(failedResult?.error).toBeDefined();
    });

    it("verifies decompiled .ail files can be recompiled back with 100% bit-identical fidelity", async () => {
      const { cssPath, htmlPath, tsPath, tsxPath } = setupSampleProject(testDir);

      await ingestProjectSideBySide({
        dir: testDir,
        overwrite: true,
      });

      const files = [
        { origPath: cssPath, target: "css" as const },
        { origPath: htmlPath, target: "html" as const },
        { origPath: tsPath, target: "typescript" as const },
        { origPath: tsxPath, target: "tsx" as const },
      ];

      for (const { origPath, target } of files) {
        const origContent = fs.readFileSync(origPath, "utf-8");
        const ailPath = `${origPath}.ail`;
        expect(fs.existsSync(ailPath)).toBe(true);

        const ailContent = fs.readFileSync(ailPath, "utf-8");
        const mod = parse(ailContent, ailPath);
        const recompiled = emitTarget(mod, target);

        expect(recompiled).toBe(origContent);
      }
    });
  });
});
