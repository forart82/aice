/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 3 Test Suite: Content-Addressed AST Cache & Real-World Companion Idioms Trial.
 * Verifies:
 * 1. In-memory and disk AST cache hit/miss/invalidation and round-trip persistence (.aice-cache/ast-cache.json).
 * 2. Cross-file TypeChecker cache invalidation on disk modification via content-hash keys.
 * 3. End-to-end multi-file companion mode trial with idiom synthesis, cross-file typechecking,
 *    external target edits + reverse sync, and tokenomics auditing.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AiceAstCache,
  clearAstCache,
  computeSourceHash,
  getAstCacheStats,
  hasCached,
  invalidateCachedFile,
  loadAstCacheFromDisk,
  parseCached,
  saveAstCacheToDisk,
} from "../../src/cache/index.js";
import { loadProjectConfig } from "../../src/config/project-config.js";
import { scanProjectIdioms } from "../../src/idioms/idiom-transform.js";
import { auditTokenomics } from "../../src/tokenomics/index.js";
import { generateContext } from "../../src/tools/context.js";
import { splice } from "../../src/tools/splice.js";
import { TypeChecker } from "../../src/typechecker/checker.js";

describe("Phase 3: Content-Addressed AST Cache & On-the-Fly Idioms Trial", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aice-phase3-test-"));
    clearAstCache();
  });

  afterEach(() => {
    clearAstCache(tmpDir);
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  describe("1. Content-Addressed In-Memory and Disk AST Cache (`src/cache/`)", () => {
    it("computes deterministic SHA-256 source hash", () => {
      const sourceA = "fn add(a: int, b: int): int => a + b;";
      const sourceB = "fn add(a: int, b: int): int => a + b;";
      const sourceC = "fn add(a: int, b: int): int => a - b;";

      const hashA = computeSourceHash(sourceA);
      const hashB = computeSourceHash(sourceB);
      const hashC = computeSourceHash(sourceC);

      expect(hashA).toBe(hashB);
      expect(hashA).not.toBe(hashC);
      expect(hashA).toMatch(/^[a-f0-9]{64}$/);
    });

    it("tracks cache misses and hits with parseCached", () => {
      const source = "let x: int = 42;";
      const filePath = path.join(tmpDir, "demo.aice");

      expect(hasCached(source, filePath)).toBe(false);

      // 1st parse -> cache miss
      const ast1 = parseCached(source, filePath);
      expect(ast1.kind).toBe("Module");
      expect(hasCached(source, filePath)).toBe(true);

      const stats1 = getAstCacheStats();
      expect(stats1.misses).toBe(1);
      expect(stats1.hits).toBe(0);
      expect(stats1.size).toBe(1);

      // 2nd parse with identical source and path -> cache hit
      const ast2 = parseCached(source, filePath);
      expect(ast2.kind).toBe("Module");

      const stats2 = getAstCacheStats();
      expect(stats2.misses).toBe(1);
      expect(stats2.hits).toBe(1);
      expect(stats2.hitRate).toBe(0.5);
    });

    it("bypasses cache when bypassCache option is true", () => {
      const source = "let y: int = 100;";
      const filePath = path.join(tmpDir, "bypass.aice");

      parseCached(source, filePath, { bypassCache: true });
      expect(hasCached(source, filePath)).toBe(false);

      const stats = getAstCacheStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(1);
      expect(stats.size).toBe(0);
    });

    it("protects cached AST against external mutations by default (clone: true)", () => {
      const source = "let count: int = 0;";
      const filePath = path.join(tmpDir, "mutate.aice");

      const ast1 = parseCached(source, filePath);
      expect(ast1.items.length).toBe(1);

      // Mutate the returned AST
      (ast1.items as any).length = 0;
      expect(ast1.items.length).toBe(0);

      // Re-fetching from cache returns a fresh clone with intact items
      const ast2 = parseCached(source, filePath);
      expect(ast2.items.length).toBe(1);
    });

    it("allows bypassing clone via clone: false for high-throughput callers", () => {
      const source = "let z: int = 99;";
      const filePath = path.join(tmpDir, "fast.aice");

      const ast1 = parseCached(source, filePath, { clone: false });
      const ast2 = parseCached(source, filePath, { clone: false });
      expect(ast1).toBe(ast2);
    });

    it("invalidates cached file entries by file path", () => {
      const source = "let a: int = 1;";
      const filePath = path.join(tmpDir, "inval.aice");

      parseCached(source, filePath);
      expect(hasCached(source, filePath)).toBe(true);

      const removed = invalidateCachedFile(filePath);
      expect(removed).toBe(true);
      expect(hasCached(source, filePath)).toBe(false);

      // Subsequent invalidate returns false
      expect(invalidateCachedFile(filePath)).toBe(false);
    });

    it("persists AST cache to disk and reloads on fresh cache instance", () => {
      const source1 = "pub fn first() -> int = 1;";
      const file1 = path.join(tmpDir, "one.aice");
      const source2 = "pub fn second() -> int = 2;";
      const file2 = path.join(tmpDir, "two.aice");

      parseCached(source1, file1);
      parseCached(source2, file2);
      expect(getAstCacheStats().size).toBe(2);

      // Save to disk
      const savedPath = saveAstCacheToDisk(tmpDir);
      expect(fs.existsSync(savedPath)).toBe(true);
      expect(savedPath).toBe(path.join(tmpDir, ".aice-cache", "ast-cache.json"));

      // Wipe memory cache
      clearAstCache();
      expect(getAstCacheStats().size).toBe(0);
      expect(hasCached(source1, file1)).toBe(false);

      // Load from disk
      const loadedCount = loadAstCacheFromDisk(tmpDir);
      expect(loadedCount).toBe(2);
      expect(getAstCacheStats().size).toBe(2);
      expect(hasCached(source1, file1)).toBe(true);
      expect(hasCached(source2, file2)).toBe(true);

      // Fast hit from reloaded cache
      parseCached(source1, file1);
      expect(getAstCacheStats().hits).toBe(1);

      // clearAstCache with path cleans disk cache file
      clearAstCache(tmpDir);
      expect(fs.existsSync(savedPath)).toBe(false);
    });

    it("supports isolated AiceAstCache instances", () => {
      const cacheA = new AiceAstCache();
      const cacheB = new AiceAstCache();

      const source = "let inst = 1;";
      cacheA.parseCached(source, "file.aice");
      expect(cacheA.getAstCacheStats().size).toBe(1);
      expect(cacheB.getAstCacheStats().size).toBe(0);
    });
  });

  describe("2. Cross-File TypeChecker Invalidation on Disk Modification", () => {
    it("invalidates TypeChecker module environment cache when an imported file changes on disk", () => {
      const mathAicePath = path.join(tmpDir, "math_utils.aice");
      const mainAicePath = path.join(tmpDir, "main.aice");

      // Version 1: calculate returns int and accepts int
      const mathSourceV1 = `pub fn calculate(x: int) -> int = x * 2;\n`;
      fs.writeFileSync(mathAicePath, mathSourceV1, "utf-8");

      const mainSource = `import { calculate } from "./math_utils.aice";\nlet res = calculate(21);\n`;
      fs.writeFileSync(mainAicePath, mainSource, "utf-8");

      const checker = new TypeChecker();
      const mod1 = parseCached(mainSource, mainAicePath);
      expect(() => checker.checkModule(mod1)).not.toThrow();

      // Version 2: calculate signature changed on disk to accept string and return string
      const mathSourceV2 = `pub fn calculate(x: string) -> string = x;\n`;
      fs.writeFileSync(mathAicePath, mathSourceV2, "utf-8");

      // When main is checked again, content hash of math_utils.aice has changed.
      // TypeChecker's moduleEnvCache key (${resolvedAicePath}::${sourceHash}) detects the change,
      // even when reusing the exact same TypeChecker instance!
      const mod2 = parseCached(mainSource, mainAicePath, { bypassCache: true });
      expect(() => checker.checkModule(mod2)).toThrow(
        /Argument 1 of type 'int' is not assignable to expected type 'string'/,
      );
    });
  });

  describe("3. Real-World Multi-File On-the-Fly Idioms Trial", () => {
    it("executes full on-the-fly lifecycle: idiom discovery, context compression, splice mutation, and tokenomics", async () => {
      const targetProjectDir = path.join(tmpDir, "target_app");
      const targetSrc = path.join(targetProjectDir, "src");

      fs.mkdirSync(targetSrc, { recursive: true });

      // Create multi-file TypeScript application with repetitive validation patterns for idiom mining
      const authTs = `export function validateAuth(token: number) {
  if (token < 0) {
    console.error("error: negative value " + token);
    return null;
  }
  return token * 2;
}
`;
      const billingTs = `export function validateBilling(amount: number) {
  if (amount < 0) {
    console.error("error: negative value " + amount);
    return null;
  }
  return amount * 3;
}
`;
      const shippingTs = `export function validateShipping(weight: number) {
  if (weight < 0) {
    console.error("error: negative value " + weight);
    return null;
  }
  return weight * 4;
}
`;

      fs.writeFileSync(path.join(targetSrc, "auth.ts"), authTs, "utf-8");
      fs.writeFileSync(path.join(targetSrc, "billing.ts"), billingTs, "utf-8");
      fs.writeFileSync(path.join(targetSrc, "shipping.ts"), shippingTs, "utf-8");

      // Step A: Scan project idioms on-the-fly (zero .aice files written to disk)
      const scanRes = scanProjectIdioms(targetProjectDir, {
        minOccurrences: 2,
        minNetTokenSavings: 1,
      });

      expect(scanRes.synthesizedIdioms).toBeGreaterThan(0);

      // Target project remains 100% clean of .aice files
      const targetEntries = fs.readdirSync(targetSrc);
      expect(targetEntries.every((e) => !e.endsWith(".aice"))).toBe(true);

      const configPath = path.join(targetProjectDir, "aice.config.json");
      expect(fs.existsSync(configPath)).toBe(true);

      const config = loadProjectConfig(targetProjectDir);
      expect(config.idioms).toBeDefined();
      const idiomNames = Object.keys(config.idioms ?? {});
      expect(idiomNames.length).toBeGreaterThan(0);

      // Step B: On-the-fly context generation collapses idioms automatically
      const ctx = await generateContext(path.join(targetSrc, "billing.ts"), {
        symbol: "validateBilling",
        projectRoot: targetProjectDir,
      });
      expect(ctx.formattedBundle).toContain("$");

      // Step C: Splice in-place mutation using AICE + $idiom
      const firstIdiom = `$${idiomNames[0].replace(/^\$/, "")}`;
      const spliceRes = await splice(path.join(targetSrc, "billing.ts"), {
        symbol: "validateBilling",
        code: `pub fn validateBilling(amount: float) -> float?:\n  ${firstIdiom}(amount)\n  ret amount * 5\n`,
        projectRoot: targetProjectDir,
      });
      expect(spliceRes.modifiedCode).toContain("amount * 5");

      // Step D: Audit Tokenomics directly on native files + idioms
      const audit = auditTokenomics(targetProjectDir);
      expect(audit.files.length).toBeGreaterThan(0);
      expect(audit.aggregate.aiceCl100k).toBeGreaterThan(0);
      expect(audit.aggregate.targetCl100k).toBeGreaterThan(0);
      expect(audit.aggregate.charSavingsPct).toBeGreaterThan(0);
    });
  });
});
