/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Comprehensive regression suite covering:
 * - ConditionalExpr ternary preservation (falsy 0 / "" / false / null) across parser, decompiler, AICE generator & all 8 emitters
 * - TS Decompiler expressions: satisfies, import.meta / new.target, delete, void, tagged templates, ++/--, unary ~/+, side-effect comma exprs
 * - Context engine: split import type + value import contract recompute, multi-symbol error vs comma test titles, ReDoS & invalid regex errors,
 *   valid symbols named invalid/missing/unknown/nonExistent, idioms:false with maxTokens, multi-context maxTokens & fast JSON/config reads
 * - Tokenomics hash-keyed LRU accuracy, AiceAstCache LRU recency refresh, TypeChecker scoped type aliases, and Telemetry env/char/control-byte guards
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vm from "node:vm";
import { describe, expect, it } from "vitest";
import { AiceAstCache } from "../../src/cache/disk-cache.js";
import { saveProjectConfig } from "../../src/config/project-config.js";
import { parse } from "../../src/core/parser.js";
import { decompile } from "../../src/decompiler/index.js";
import { emitTarget } from "../../src/emitters/index.js";
import {
  analyzeProject,
  computeTelemetryEvent,
  isTestEnvWithoutExplicitTelemetry,
} from "../../src/telemetry/index.js";
import { estimateTokens } from "../../src/tokenomics/index.js";
import { generateContext, generateMultiContext } from "../../src/tools/context.js";
import { lookupTypeAlias, TypeCheckError, TypeChecker } from "../../src/typechecker/index.js";

describe("Core AST, TS Decompiler, Emitters, Context, Cache & Telemetry Regressions", () => {
  describe("1. ConditionalExpr Ternary Preservation (Falsy Branch Soundness)", () => {
    it("preserves falsy whenTrue values (0, '', false, null) across TS -> AICE -> TS execution", () => {
      const tsSource = `
export function pickZero(flag: boolean): number {
  const v = flag ? 0 : 42;
  return v;
}
export function pickEmpty(flag: boolean): string {
  const v = flag ? "" : "fallback";
  return v;
}
export function pickFalse(flag: boolean): boolean {
  const v = flag ? false : true;
  return v;
}
export function pickNull(flag: boolean): string | null {
  const v = flag ? null : "present";
  return v;
}
`;
      const decompiled = decompile(tsSource, "typescript", { filePath: "ternary.ts" });
      expect(decompiled.aice).toContain("?");
      expect(decompiled.aice).not.toContain("_ternary");

      const reparsed = parse(decompiled.aice, "ternary.aice");
      new TypeChecker().check(reparsed);
      const emittedTs = emitTarget(reparsed, "typescript");

      expect(emittedTs).toContain("flag ? 0 : 42");
      expect(emittedTs).toContain('flag ? "" : "fallback"');
      expect(emittedTs).toContain("flag ? false : true");
      expect(emittedTs).toContain('flag ? null : "present"');

      const jsExecutable = emitTarget(reparsed, "javascript").replace(/^export\s+/gm, "");
      const sandbox: Record<string, unknown> = {};
      vm.createContext(sandbox);
      vm.runInContext(
        `${jsExecutable}\nglobalThis.results = [pickZero(true), pickZero(false), pickEmpty(true), pickEmpty(false), pickFalse(true), pickFalse(false), pickNull(true), pickNull(false)];`,
        sandbox,
      );
      expect(sandbox.results).toEqual([0, 42, "", "fallback", false, true, null, "present"]);
    });

    it("emits idiomatic conditional expressions across Python, Rust, Go, C++, C#, Kotlin, and PHP", () => {
      const aiceMod = parse(
        "pub fn choose(c: bool) -> int:\n  out := c ? 0 : 7\n  ret out\n",
        "choose.aice",
      );

      expect(emitTarget(aiceMod, "python")).toContain("0 if c else 7");
      expect(emitTarget(aiceMod, "rust")).toMatch(/if\s+c\s*\{\s*0\s*\}\s*else\s*\{\s*7\s*\}/);
      expect(emitTarget(aiceMod, "go")).toContain("func() int64");
      expect(emitTarget(aiceMod, "cpp")).toContain("c ? 0 : 7");
      expect(emitTarget(aiceMod, "csharp")).toContain("c ? 0 : 7");
      expect(emitTarget(aiceMod, "kotlin")).toContain("if (c) 0 else 7");
      expect(emitTarget(aiceMod, "php")).toContain("$c ? 0 : 7");
    });
  });

  describe("2. TS Decompiler Non-Lossy Expressions & Operators", () => {
    it("preserves satisfies, import.meta, new.target, delete, void, tagged templates, ++/--, ~/+, and comma side effects", () => {
      const tsSource = `
export const CONFIG = { port: 8080, host: "localhost" } satisfies Record<string, unknown>;

export function metaUrl(): string {
  return import.meta.url;
}

export class GuardedCtor {
  readonly createdViaNew: boolean;
  constructor() {
    this.createdViaNew = Boolean(new.target);
  }
}

export function cleanProp(bag: Record<string, number>): boolean {
  void console.debug("cleaning");
  return delete bag.temp;
}

export function buildQuery(table: string, id: number): string {
  const tag = (strings: TemplateStringsArray, ...vals: unknown[]) =>
    strings[0] + String(vals[0]) + strings[1] + String(vals[1]);
  return tag\`SELECT * FROM \${table} WHERE id = \${id}\`;
}

export function stepCounters(raw: string): number {
  let n = +raw;
  const before = n++;
  const after = ++n;
  const dec = --n;
  const postDec = n--;
  const mask = -1;
  const seq = ((n += 5), n * 2);
  return before + after + dec + postDec + mask + seq;
}
`;
      const decompiled = decompile(tsSource, "typescript", { filePath: "exprs.ts" });
      expect(decompiled.aice).toContain("8080");
      expect(decompiled.aice).toContain("import.meta.url");
      expect(decompiled.aice).toContain("new.target");

      const reparsed = parse(decompiled.aice, "exprs.aice");
      new TypeChecker().check(reparsed);
      const emittedJs = emitTarget(reparsed, "javascript");

      expect(emittedJs).toContain("port: 8080");
      expect(emittedJs).toContain("import.meta.url");
      expect(emittedJs).toContain("new.target");
      expect(emittedJs).toContain("delete bag.temp");
      expect(emittedJs).toMatch(/void\s*\(?console\.debug/);
      expect(emittedJs).toMatch(/tag`SELECT \* FROM \$\{table\} WHERE id = \$\{id\}`/);

      const runnable = emittedJs
        .replace(/^export\s+/gm, "")
        .replace(/import\.meta\.url/g, '"file:///test.js"');
      const sandbox: Record<string, unknown> = { console: { debug: () => {} } };
      vm.createContext(sandbox);
      vm.runInContext(
        `${runnable}
const sampleBag = { temp: 1, keep: 2 };
const deleted = cleanProp(sampleBag);
globalThis.out = {
  port: CONFIG.port,
  url: metaUrl(),
  viaNew: new GuardedCtor().createdViaNew,
  deleted,
  hasTemp: "temp" in sampleBag,
  query: buildQuery("users", 9),
  counters: stepCounters("3"),
};`,
        sandbox,
      );

      expect(sandbox.out).toEqual({
        port: 8080,
        url: "file:///test.js",
        viaNew: true,
        deleted: true,
        hasTemp: false,
        query: "SELECT * FROM users WHERE id = 9",
        counters: 31,
      });
    });
  });

  describe("3. Context Engine Regressions (`src/tools/context.ts`)", () => {
    it("recomputes dependency contract when merging split `import type` and value `import` from the same module", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aice-ctx-split-import-"));
      try {
        saveProjectConfig(tmpDir, { enabled: true, mode: "twinless" });
        const depFile = path.join(tmpDir, "dep.ts");
        const entryFile = path.join(tmpDir, "entry.ts");

        fs.writeFileSync(
          depFile,
          "export interface EngineConfig {\n  fps: number;\n}\nexport function createDefaultConfig(): EngineConfig {\n  return { fps: 60 };\n}\n",
          "utf-8",
        );
        fs.writeFileSync(
          entryFile,
          'import type { EngineConfig } from "./dep.js";\nimport { createDefaultConfig } from "./dep.js";\n\nexport function initEngine(): EngineConfig {\n  return createDefaultConfig();\n}\n',
          "utf-8",
        );

        const ctx = await generateContext(entryFile, { depth: 1, includeCallers: false });
        expect(ctx.dependencies).toHaveLength(1);
        expect(ctx.dependencies[0].importedSymbols).toEqual(
          expect.arrayContaining(["EngineConfig", "createDefaultConfig"]),
        );
        expect(ctx.dependencies[0].contract).toContain("EngineConfig");
        expect(ctx.dependencies[0].contract).toContain("createDefaultConfig");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("throws on missing symbols in multi-symbol selector while supporting comma-containing test titles and prefix-named symbols", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aice-ctx-selectors-"));
      try {
        saveProjectConfig(tmpDir, { enabled: true, mode: "twinless" });
        const targetFile = path.join(tmpDir, "handlers.test.ts");
        fs.writeFileSync(
          targetFile,
          `export function validHandler(): number { return 1; }
export function invalidTokenCheck(): boolean { return false; }
export function missingFieldFallback(): string { return "none"; }
export function unknownKindGuard(): number { return 0; }
export function nonExistentKeyMapper(): number { return 2; }

describe("Comma suite", () => {
  it("TC-COMMA-99: parses alpha, beta, and gamma", () => {
    expect(validHandler()).toBe(1);
  });
});
`,
          "utf-8",
        );

        await expect(
          generateContext(targetFile, {
            symbol: "validHandler,totallyAbsentSymbol",
            depth: 0,
            includeCallers: false,
          }),
        ).rejects.toThrow(/totallyAbsentSymbol/);

        const commaRes = await generateContext(targetFile, {
          symbol: "TC-COMMA-99: parses alpha, beta, and gamma",
          depth: 0,
          includeCallers: false,
        });
        expect(commaRes.formattedBundle).toContain("TC-COMMA-99");

        for (const symName of [
          "invalidTokenCheck",
          "missingFieldFallback",
          "unknownKindGuard",
          "nonExistentKeyMapper",
        ]) {
          const okRes = await generateContext(targetFile, {
            symbol: symName,
            depth: 0,
            includeCallers: false,
          });
          expect(okRes.formattedBundle).toContain(symName);
        }

        await expect(
          generateContext(targetFile, {
            symbol: "nonExistentGhostFunction",
            depth: 0,
            includeCallers: false,
          }),
        ).rejects.toThrow(/not found/i);

        await expect(
          generateContext(targetFile, {
            symbol: "/[unclosed/",
            depth: 0,
            includeCallers: false,
          }),
        ).rejects.toThrow(/Invalid regex selector/);

        await expect(
          generateContext(targetFile, {
            symbol: "/(a+)+$/",
            depth: 0,
            includeCallers: false,
          }),
        ).rejects.toThrow(/Unsafe or overly complex regex selector/);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("honors idioms:false under maxTokens truncation, enforces multi-context maxTokens, and reads JSON configs fast", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aice-ctx-budget-"));
      try {
        saveProjectConfig(tmpDir, {
          enabled: true,
          mode: "twinless",
          idiomsEnabled: true,
          idioms: {
            $incByTwo: {
              name: "$incByTwo",
              kind: "expr",
              params: [{ name: "$0" }],
              templateAice: "$0 + 2",
              occurrences: 5,
              tokensPerOccurrenceSaved: 2,
              netTokenSavings: 10,
            },
          },
        });

        const bigFile = path.join(tmpDir, "big.ts");
        const lines = Array.from(
          { length: 40 },
          (_, i) => `export function fnItem${i}(x: number): number { return x + 2 + ${i}; }`,
        ).join("\n");
        fs.writeFileSync(bigFile, `${lines}\n`, "utf-8");

        const singleTruncated = await generateContext(bigFile, {
          depth: 0,
          includeCallers: false,
          idioms: false,
          maxTokens: 120,
        });
        expect(singleTruncated.formattedBundle).not.toContain("## Project Idioms");

        const secondFile = path.join(tmpDir, "second.ts");
        fs.writeFileSync(secondFile, `${lines}\n`, "utf-8");
        const multiTruncated = await generateMultiContext([bigFile, secondFile], {
          depth: 0,
          includeCallers: false,
          maxTokens: 180,
        });
        expect(multiTruncated.formattedBundle).toContain("truncated");

        const pkgJson = path.join(tmpDir, "package.json");
        const tsCfgJson = path.join(tmpDir, "tsconfig.json");
        fs.writeFileSync(pkgJson, JSON.stringify({ name: "fast-json", version: "1.0.0" }), "utf-8");
        fs.writeFileSync(tsCfgJson, JSON.stringify({ compilerOptions: { strict: true } }), "utf-8");

        const t0 = performance.now();
        const jsonCtx = await generateMultiContext([pkgJson, tsCfgJson]);
        const elapsedMs = performance.now() - t0;
        expect(jsonCtx.formattedBundle).toContain("fast-json");
        expect(jsonCtx.formattedBundle).toContain("compilerOptions");
        expect(elapsedMs).toBeLessThan(2000);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe("4. Tokenomics, AiceAstCache LRU, TypeChecker Alias Isolation & Telemetry", () => {
    it("hashes >128-char strings in estimateTokens without collisions", () => {
      const longA = `${"alpha token sequence ".repeat(20)}TAIL_A`;
      const longB = `${"alpha token sequence ".repeat(20)}TAIL_B_EXTRA_WORDS`;
      expect(longA.length).toBeGreaterThan(128);
      const countA1 = estimateTokens(longA, "cl100k_base");
      const countA2 = estimateTokens(longA, "cl100k_base");
      const countB = estimateTokens(longB, "cl100k_base");
      expect(countA1).toBe(countA2);
      expect(countB).toBeGreaterThan(countA1);
    });

    it("refreshes LRU recency on AiceAstCache hits so hot entries are not evicted", () => {
      const cache = new AiceAstCache(2);
      cache.parseCached("fn a() -> int:\n  ret 1\n", "/virtual/a.aice");
      cache.parseCached("fn b() -> int:\n  ret 2\n", "/virtual/b.aice");
      expect(cache.getAstCacheStats().misses).toBe(2);

      cache.parseCached("fn a() -> int:\n  ret 1\n", "/virtual/a.aice");
      expect(cache.getAstCacheStats().hits).toBe(1);

      cache.parseCached("fn c() -> int:\n  ret 3\n", "/virtual/c.aice");
      cache.parseCached("fn a() -> int:\n  ret 1\n", "/virtual/a.aice");
      expect(cache.getAstCacheStats().hits).toBe(2);

      const missesBeforeB = cache.getAstCacheStats().misses;
      cache.parseCached("fn b() -> int:\n  ret 2\n", "/virtual/b.aice");
      expect(cache.getAstCacheStats().misses).toBe(missesBeforeB + 1);
    });

    it("isolates type aliases per TypeChecker.check() invocation without global registry pollution", () => {
      const modA = parse(
        "type ScopedId = int\nfn readId(x: ScopedId) -> int:\n  ret x\n",
        "modA.aice",
      );
      new TypeChecker().check(modA);
      expect(lookupTypeAlias("ScopedId")).toBeUndefined();

      const modB = parse(
        "type ScopedId = str\nfn badReturn(x: ScopedId) -> int:\n  ret x\n",
        "modB.aice",
      );
      expect(() => new TypeChecker().check(modB)).toThrow(TypeCheckError);
    });

    it("unifies isTestEnvWithoutExplicitTelemetry, honors nativeChars, and strips trailing control bytes in analyzeProject", () => {
      const savedEnv = {
        AICE_TELEMETRY_PATH: process.env.AICE_TELEMETRY_PATH,
        AICE_TELEMETRY_ERRORS_PATH: process.env.AICE_TELEMETRY_ERRORS_PATH,
        AICE_HOME: process.env.AICE_HOME,
      };
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aice-telemetry-guards-"));
      try {
        delete process.env.AICE_TELEMETRY_PATH;
        delete process.env.AICE_TELEMETRY_ERRORS_PATH;
        delete process.env.AICE_HOME;
        expect(isTestEnvWithoutExplicitTelemetry()).toBe(true);
        expect(isTestEnvWithoutExplicitTelemetry("/tmp/custom.jsonl")).toBe(false);

        process.env.AICE_HOME = tmpDir;
        expect(isTestEnvWithoutExplicitTelemetry()).toBe(false);
        delete process.env.AICE_HOME;

        process.env.AICE_TELEMETRY_ERRORS_PATH = path.join(tmpDir, "errors.jsonl");
        expect(isTestEnvWithoutExplicitTelemetry()).toBe(false);
        delete process.env.AICE_TELEMETRY_ERRORS_PATH;

        const ev = computeTelemetryEvent({
          targetPath: tmpDir,
          projectRoot: tmpDir,
          filePath: "<directory>",
          operation: "outline",
          nativeText: "",
          nativeChars: 12_345,
          nativeCl100k: 3_000,
          nativeO200k: 2_940,
          aiceText: "// === a.ts ===\nfn a(): ...",
          aiceCl100k: 10,
        });
        expect(ev.nativeChars).toBe(12_345);
        expect(ev.savedChars).toBe(12_345 - ev.aiceChars);

        const projDir = path.join(tmpDir, "ctrl_proj");
        const brainDir = path.join(tmpDir, "brain", "conv-1", ".system_generated", "logs");
        fs.mkdirSync(projDir, { recursive: true });
        fs.mkdirSync(brainDir, { recursive: true });
        fs.writeFileSync(path.join(projDir, "index.ts"), "export const x = 1;\n", "utf-8");

        const stepLine = JSON.stringify({
          type: "USER_INPUT",
          created_at: "2026-11-10T12:00:00Z",
          content: `Command Working Directory: ${projDir}\u001b\u0007\n`,
        });
        const respLine = JSON.stringify({
          type: "PLANNER_RESPONSE",
          created_at: "2026-11-10T12:00:05Z",
          usage: { input_tokens: 100, output_tokens: 25 },
          tool_calls: [],
        });
        fs.writeFileSync(
          path.join(brainDir, "transcript.jsonl"),
          `${stepLine}\n${respLine}\n`,
          "utf-8",
        );

        const report = analyzeProject({
          project: projDir,
          telemetryPath: path.join(tmpDir, "gains.jsonl"),
          transcriptsDir: path.join(tmpDir, "brain"),
        });
        expect(report.sessionSummary.sessionCount).toBe(1);
      } finally {
        for (const [k, v] of Object.entries(savedEnv)) {
          if (v === undefined) delete process.env[k];
          else process.env[k] = v;
        }
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
