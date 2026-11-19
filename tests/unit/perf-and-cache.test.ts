/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 4 tests: bounded LRU eviction, mtime+size+ino stale-cache safety,
 * exact BPE piece-cache parity, and lossless token-folding behavior.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getEncoding } from "js-tiktoken";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BoundedLruCache,
  FileStatLruCache,
  fastCloneAst,
  TwoGenBoundedCache,
} from "../../src/cache/index.js";
import {
  clearFileClassificationCache,
  getFileClassificationCacheStats,
  isLikelyBinaryDiskFile,
  isUniversalTextDiskFile,
  loadProjectConfig,
  readUniversalTextFileSync,
} from "../../src/config/index.js";
import { parse } from "../../src/core/parser.js";
import { AiceGenerator } from "../../src/decompiler/aice-generator.js";
import { emitTarget } from "../../src/emitters/index.js";
import {
  clearBpeTokenCaches,
  estimateTokens,
  getBpeTokenCacheStats,
} from "../../src/tokenomics/index.js";
import { scanWorkspaceCallers } from "../../src/tools/context/callers-and-workspace.js";
import {
  clearFileImportsCache,
  extractImportsFromFile,
  getFileImportsCacheStats,
} from "../../src/tools/context/imports-and-deps.js";
import { extractSymbolFromAiceSource } from "../../src/tools/context.js";
import {
  clearOutlineCache,
  generateOutline,
  getOutlineCacheStats,
} from "../../src/tools/outline.js";
import { clearDiscoveryFileMetaCache } from "../../src/tools/read/discovery.js";
import { aiceRead } from "../../src/tools/read.js";

describe("Phase 4: Bounded Caches, Stale-Cache Invalidation & Lossless Token Folding", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aice-perf-cache-"));
    fs.writeFileSync(
      path.join(tmpDir, "aice.config.json"),
      JSON.stringify({ enabled: true, idiomsEnabled: false }, null, 2),
      "utf-8",
    );
    clearFileClassificationCache();
    clearFileImportsCache();
    clearOutlineCache();
    clearDiscoveryFileMetaCache();
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  describe("BoundedLruCache & TwoGenBoundedCache eviction", () => {
    it("enforces strict maxEntries cap and evicts least-recently-used key", () => {
      const lru = new BoundedLruCache<string, number>(3);
      lru.set("a", 1);
      lru.set("b", 2);
      lru.set("c", 3);
      // Touch 'a' so 'b' becomes LRU
      expect(lru.get("a")).toBe(1);
      lru.set("d", 4);

      expect(lru.size).toBe(3);
      expect(lru.has("b")).toBe(false);
      expect(lru.get("a")).toBe(1);
      expect(lru.get("c")).toBe(3);
      expect(lru.get("d")).toBe(4);
      expect(lru.getStats().evictions).toBe(1);
    });

    it("caps TwoGenBoundedCache total entries strictly <= maxEntries", () => {
      const cache = new TwoGenBoundedCache<string, number>(8);
      for (let i = 0; i < 40; i++) {
        cache.set(`k${i}`, i);
        expect(cache.size).toBeLessThanOrEqual(cache.maxEntries);
      }
      expect(cache.get("k39")).toBe(39);
      expect(cache.get("k0")).toBeUndefined();
      expect(cache.getStats().evictions).toBeGreaterThan(0);
    });

    it("fastCloneAst deep-clones nested AST objects without sharing mutable references", () => {
      const orig = {
        kind: "BinaryExpr",
        left: { kind: "IdentifierExpr", name: "x" },
        args: [{ kind: "LiteralExpr", value: 1 }],
      };
      const copy = fastCloneAst(orig);
      expect(copy).toEqual(orig);
      copy.left.name = "y";
      if (copy.args[0]) copy.args[0].value = 99;
      expect(orig.left.name).toBe("x");
      expect(orig.args[0]?.value).toBe(1);
    });
  });

  describe("Exact BPE Token Estimation Cache", () => {
    it("matches raw js-tiktoken bit-for-bit across cl100k_base and o200k_base", () => {
      clearBpeTokenCaches();
      const rawCl = getEncoding("cl100k_base");
      const rawO2 = getEncoding("o200k_base");
      const samples = [
        "",
        "hello world",
        "export function computeDelta(a: number, b: number): number {\n  return (a - b) * 2;\n}\r\n",
        "🚀 日本語テスト — café naïve résumé 𝕳𝖊𝖑𝖑𝖔\n\t   multiple   spaces  \n",
        "a".repeat(200),
      ];

      for (const sample of samples) {
        expect(estimateTokens(sample, "cl100k_base")).toBe(rawCl.encode(sample).length);
        expect(estimateTokens(sample, "o200k_base")).toBe(rawO2.encode(sample).length);
      }

      // Second pass must hit whole-text bounded cache with identical results
      const statsBefore = getBpeTokenCacheStats();
      for (const sample of samples) {
        if (sample) {
          expect(estimateTokens(sample, "cl100k_base")).toBe(rawCl.encode(sample).length);
        }
      }
      const statsAfter = getBpeTokenCacheStats();
      expect(statsAfter.wholeText.hits).toBeGreaterThan(statsBefore.wholeText.hits);
      expect(statsAfter.wholeText.size).toBeLessThanOrEqual(statsAfter.wholeText.maxEntries);
    });
  });

  describe("mtime+size+ino Disk Cache Invalidation (Stale-Cache Safety)", () => {
    it("invalidates FileStatLruCache on file edit and atomic .tmp -> rename replacement", () => {
      const cache = new FileStatLruCache<string>(16);
      const fp = path.join(tmpDir, "sample.txt");
      fs.writeFileSync(fp, "abcd", "utf-8");
      const st1 = fs.statSync(fp);
      cache.setWithStat(fp, st1, "v1");
      expect(cache.getIfFresh(fp, st1)).toBe("v1");

      // Same-size atomic .tmp -> rename replacement (changes inode even within same ms)
      const tmpFp = `${fp}.tmp`;
      fs.writeFileSync(tmpFp, "wxyz", "utf-8");
      fs.renameSync(tmpFp, fp);
      const st2 = fs.statSync(fp);
      expect(cache.getIfFresh(fp, st2)).toBeUndefined();
    });

    it("invalidates file-classification cache when a text file becomes binary and back", () => {
      const fp = path.join(tmpDir, "payload.customblob");
      fs.writeFileSync(fp, "hello plain utf8 text\n", "utf-8");
      expect(isLikelyBinaryDiskFile(fp)).toBe(false);
      expect(isUniversalTextDiskFile(fp)).toBe(true);

      // Warm hit check
      const hitsBefore = getFileClassificationCacheStats().hits;
      expect(isLikelyBinaryDiskFile(fp)).toBe(false);
      expect(getFileClassificationCacheStats().hits).toBeGreaterThan(hitsBefore);

      // Replace atomically with NUL-byte binary payload of exact same byte length
      const tmpBin = `${fp}.tmp`;
      fs.writeFileSync(tmpBin, Buffer.from("hello\x00binary\x00payload!\n"));
      fs.renameSync(tmpBin, fp);

      expect(isLikelyBinaryDiskFile(fp)).toBe(true);
      expect(isUniversalTextDiskFile(fp)).toBe(false);
      expect(readUniversalTextFileSync(fp)).toBeUndefined();

      // Replace back with valid UTF-8 text
      const tmpTxt = `${fp}.tmp2`;
      fs.writeFileSync(tmpTxt, "restored valid utf8!!\n", "utf-8");
      fs.renameSync(tmpTxt, fp);
      expect(isLikelyBinaryDiskFile(fp)).toBe(false);
      expect(readUniversalTextFileSync(fp)?.text).toBe("restored valid utf8!!\n");
    });

    it("invalidates disk outline cache immediately when file content changes", () => {
      const fp = path.join(tmpDir, "calc.ts");
      fs.writeFileSync(fp, "export function alpha(x: number): number { return x + 1; }\n", "utf-8");

      const first = generateOutline(fp, { projectRoot: tmpDir });
      expect(first.text).toContain("fn alpha");
      expect(first.text).not.toContain("fn beta");

      // Second read hits cache
      const hitsBefore = getOutlineCacheStats().hits;
      const second = generateOutline(fp, { projectRoot: tmpDir });
      expect(second.text).toBe(first.text);
      expect(getOutlineCacheStats().hits).toBeGreaterThan(hitsBefore);

      // Atomic edit replaces alpha with beta
      const tmpFp = `${fp}.tmp`;
      fs.writeFileSync(
        tmpFp,
        "export function beta(x: number): number { return x * 2; }\n",
        "utf-8",
      );
      fs.renameSync(tmpFp, fp);

      const third = generateOutline(fp, { projectRoot: tmpDir });
      expect(third.text).toContain("fn beta");
      expect(third.text).not.toContain("fn alpha");
    });

    it("invalidates imports & workspace callers cache when imports change on disk", () => {
      const targetFp = path.join(tmpDir, "lib.ts");
      const callerFp = path.join(tmpDir, "app.ts");
      fs.writeFileSync(targetFp, "export function helper(): number { return 42; }\n", "utf-8");
      fs.writeFileSync(callerFp, "export const x = 1;\n", "utf-8");

      expect(extractImportsFromFile(callerFp)).toHaveLength(0);
      const hitsBefore = getFileImportsCacheStats().hits;
      expect(extractImportsFromFile(callerFp)).toHaveLength(0);
      expect(getFileImportsCacheStats().hits).toBeGreaterThan(hitsBefore);

      // Update app.ts to import helper from ./lib.js
      const tmpCaller = `${callerFp}.tmp`;
      fs.writeFileSync(
        tmpCaller,
        'import { helper } from "./lib.js";\nexport const y = helper();\n',
        "utf-8",
      );
      fs.renameSync(tmpCaller, callerFp);

      const updatedImports = extractImportsFromFile(callerFp);
      expect(updatedImports.length).toBe(1);
      expect(updatedImports[0]?.source).toBe("./lib.js");

      const callers = scanWorkspaceCallers(targetFp, tmpDir, loadProjectConfig(tmpDir), "helper");
      expect(callers.some((c) => c.filePath.endsWith("app.ts"))).toBe(true);
    });

    it("invalidates filesOnly discovery metadata cache when file line count changes", async () => {
      const fp = path.join(tmpDir, "notes.txt");
      fs.writeFileSync(fp, "line1\nline2\n", "utf-8");
      const res1 = await aiceRead(tmpDir, { filesOnly: true, projectRoot: tmpDir });
      expect(res1.text).toContain("notes.txt (2L)");

      const tmpFp = `${fp}.tmp`;
      fs.writeFileSync(tmpFp, "l1\nl2\nl3\nl4\nl5\n", "utf-8");
      fs.renameSync(tmpFp, fp);

      const res2 = await aiceRead(tmpDir, { filesOnly: true, projectRoot: tmpDir });
      expect(res2.text).toContain("notes.txt (5L)");
    });
  });

  describe("Lossless Token-Folding Improvements", () => {
    it("omits redundant module header on scoped AICE symbol slices while preserving full module headers", () => {
      const aiceSrc = [
        "module math_ops",
        "fn add(a:int, b:int) -> int:",
        "  a + b",
        "fn mul(a:int, b:int) -> int:",
        "  a * b",
      ].join("\n");
      const mod = parse(aiceSrc, "math_ops.aice");

      const fullGenerated = AiceGenerator.generate(mod);
      expect(fullGenerated).toContain("module math_ops");

      const slice = extractSymbolFromAiceSource(aiceSrc, "add", "math_ops.aice", mod);
      expect(slice).toContain("fn add(a:int, b:int) -> int:");
      expect(slice).not.toContain("module math_ops");
    });

    it("compacts consecutive single-line functions in outline while preserving spacing around classes", () => {
      const src = [
        "fn one(x: int) -> int:",
        "  ret x + 1",
        "fn two(x: int) -> int:",
        "  ret x + 2",
        "class Box:",
        "  size: int",
        "  fn get() -> int:",
        "    ret this.size",
      ].join("\n");
      const res = generateOutline(src);
      expect(res.text).toContain("fn one(x: int) -> int: ...\nfn two(x: int) -> int: ...");
      expect(res.text).toContain("\n\nclass Box:");
    });

    it("folds redundant blank separator lines between same-file slices in batched reads while preserving span headers", async () => {
      const fp = path.join(tmpDir, "multi_target_sample.ts");
      const lines: string[] = [];
      for (let i = 1; i <= 40; i++) {
        lines.push(`export const item${i} = ${i};`);
      }
      fs.writeFileSync(fp, `${lines.join("\n")}\n`, "utf-8");

      const res = await aiceRead(
        ["multi_target_sample.ts:L1-L3", "multi_target_sample.ts:L20-L22"],
        {
          projectRoot: tmpDir,
        },
      );
      expect(res.text).toContain("// multi_target_sample.ts:1-3");
      expect(res.text).toContain("// multi_target_sample.ts:20-22");
      expect(res.text).toContain("export const item3 = 3;\n// multi_target_sample.ts:20-22");
      expect(res.text).not.toContain("export const item3 = 3;\n\n// multi_target_sample.ts:20-22");
    });

    it("omits redundant blank lines in trivia-free AiceGenerator output while preserving lossless CSS/TS roundtrip", () => {
      const cssAice = 'module theme\nstyle ".card":\n  display: flex\n  padding: 12px\n';
      const mod = parse(cssAice, "theme.css.aice");
      const regenerated = AiceGenerator.generate(mod);
      expect(regenerated).toContain('module theme\nstyle ".card":');
      expect(regenerated).not.toContain('module theme\n\nstyle ".card":');

      const nativeCss = emitTarget(parse(regenerated, "theme.css.aice"), "css", {
        watermark: false,
      });
      expect(nativeCss).toContain("display: flex;");
      expect(nativeCss).toContain("padding: 12px;");
    });
  });
});
