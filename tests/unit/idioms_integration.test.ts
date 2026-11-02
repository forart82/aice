/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * End-to-end integration test suite for AIL 2.0 Project Idioms engine.
 * Verifies integration across:
 * 1. `ail adopt --idioms` & ingestProjectSideBySide
 * 2. `AilWatcher` incremental compilation and config hot-reload
 * 3. `compileAilFile` in test runner
 * 4. `generateContext` & `generateWorkspaceContext`
 * 5. `generateOutline` referenced idiom headers
 * 6. `splice` with compile expansion
 * 7. `ail idioms` CLI actions (list, scan, apply, expand)
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadProjectConfig,
  saveProjectConfig,
  type ProjectIdiomDefinition,
} from "../../src/config/project-config.js";
import { ingestProjectSideBySide } from "../../src/transpiler/parallel-ingest.js";
import { AilWatcher } from "../../src/watcher/ail-watch.js";
import { compileAilFile } from "../../src/runner/test-runner.js";
import { generateContext, generateWorkspaceContext } from "../../src/tools/context.js";
import { generateOutline } from "../../src/tools/outline.js";
import { splice } from "../../src/tools/splice.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cliPath = path.resolve(__dirname, "../../bin/ail.ts");

function runCli(args: string[], cwd?: string): { status: number; stdout: string; stderr: string } {
  const result = spawnSync("bun", [cliPath, ...args], {
    cwd: cwd ?? process.cwd(),
    encoding: "utf-8",
    env: { ...process.env },
  });
  return {
    status: result.status ?? 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("AIL 2.0 Project Idioms End-to-End Integration", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ail-idioms-integ-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  describe("1. Ingestion & Adoption with Idioms (`ail adopt --idioms`)", () => {
    it("mines repetitive blocks and synthesizes idioms during adoption", async () => {
      // Create source files with repetitive logic
      const tsCode1 = `export function handleA(x: number) {
  if (x < 0) {
    console.error("negative: " + x);
    return null;
  }
  return x * 2;
}
`;
      const tsCode2 = `export function handleB(x: number) {
  if (x < 0) {
    console.error("negative: " + x);
    return null;
  }
  return x * 3;
}
`;
      const tsCode3 = `export function handleC(x: number) {
  if (x < 0) {
    console.error("negative: " + x);
    return null;
  }
  return x * 4;
}
`;

      fs.writeFileSync(path.join(tmpDir, "h1.ts"), tsCode1, "utf-8");
      fs.writeFileSync(path.join(tmpDir, "h2.ts"), tsCode2, "utf-8");
      fs.writeFileSync(path.join(tmpDir, "h3.ts"), tsCode3, "utf-8");

      const summary = await ingestProjectSideBySide({
        dir: tmpDir,
        idioms: true,
        minIdiomOccurrences: 3,
        minIdiomSavings: 1,
      });

      expect(summary.totalIngested).toBe(3);
      expect(fs.existsSync(path.join(tmpDir, "h1.ts.ail"))).toBe(true);

      // Verify shield created and updated with idioms section if idioms synthesized
      if (summary.idiomsSynthesized && summary.idiomsSynthesized > 0) {
        expect(summary.idiomTokenSavings).toBeGreaterThan(0);
        const config = loadProjectConfig(tmpDir);
        expect(config.idioms).toBeDefined();
        expect(Object.keys(config.idioms!)).toHaveLength(summary.idiomsSynthesized);

        const agentsMd = fs.readFileSync(path.join(tmpDir, "AGENTS.md"), "utf-8");
        expect(agentsMd).toContain("Active Project Idioms");
      }
    });

    it("supports CLI `ail adopt --idioms` flag", () => {
      const tsCode = `export function compute(a: number) {
  if (a < 0) {
    throw new Error("invalid a");
  }
  return a + 1;
}
`;
      fs.writeFileSync(path.join(tmpDir, "math.ts"), tsCode, "utf-8");

      const res = runCli(["adopt", tmpDir, "--idioms", "--no-lock"]);
      expect(res.status).toBe(0);
      expect(fs.existsSync(path.join(tmpDir, "math.ts.ail"))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, "AGENTS.md"))).toBe(true);
    });
  });

  describe("2. AilWatcher Incremental Compilation with Idioms", () => {
    it("compiles .ail with idiom calls into expanded target TypeScript code", async () => {
      const idiomDef: ProjectIdiomDefinition = {
        name: "$guardPositive",
        kind: "stmt",
        params: [{ name: "$0" }],
        templateAil: "if $0 <= 0:\n  ret 0",
        occurrences: 4,
        tokensPerOccurrenceSaved: 6,
        netTokenSavings: 20,
      };

      saveProjectConfig(tmpDir, {
        mode: "side-by-side",
        targetLanguage: "typescript",
        idioms: {
          $guardPositive: idiomDef,
        },
      });

      const ailCode = `module math.calc

fn calculate(val: int) -> int:
  $guardPositive(val)
  ret val * 2
`;
      const ailFile = path.join(tmpDir, "calc.ts.ail");
      fs.writeFileSync(ailFile, ailCode, "utf-8");

      const watcher = new AilWatcher({
        dir: tmpDir,
        lockTargets: false,
      });

      const compileRes = await watcher.compileFile(ailFile);
      expect(compileRes.success).toBe(true);

      const targetTs = fs.readFileSync(path.join(tmpDir, "calc.ts"), "utf-8");
      // The idiom was expanded during emit
      expect(targetTs).toContain("val <= 0");
      expect(targetTs).not.toContain("$guardPositive");
    });

    it("hot-reloads ail.config.json when idioms are added or updated at runtime", async () => {
      saveProjectConfig(tmpDir, {
        mode: "side-by-side",
        targetLanguage: "typescript",
        idioms: {},
      });

      const watcher = new AilWatcher({
        dir: tmpDir,
        lockTargets: false,
      });

      expect(watcher.config.idioms).toEqual({});

      // Update ail.config.json with a new idiom
      const newIdiom: ProjectIdiomDefinition = {
        name: "$logNotice",
        kind: "stmt",
        params: [{ name: "$0" }],
        templateAil: 'console.log("NOTICE: " + $0)',
        occurrences: 3,
        tokensPerOccurrenceSaved: 5,
        netTokenSavings: 15,
      };

      // Ensure timestamp is strictly higher
      const configPath = path.join(tmpDir, "ail.config.json");
      const updatedConfig = {
        mode: "side-by-side",
        targetLanguage: "typescript",
        idioms: {
          $logNotice: newIdiom,
        },
      };
      fs.writeFileSync(configPath, JSON.stringify(updatedConfig, null, 2), "utf-8");
      const futureTime = (Date.now() + 2000) / 1000;
      fs.utimesSync(configPath, futureTime, futureTime);

      const ailCode = `module logger

fn report(msg: str):
  $logNotice(msg)
  ret nil
`;
      const ailFile = path.join(tmpDir, "log.ts.ail");
      fs.writeFileSync(ailFile, ailCode, "utf-8");

      const compileRes = await watcher.compileFile(ailFile);
      expect(compileRes.success).toBe(true);

      // Verify watcher hot-reloaded the new idiom
      expect(watcher.config.idioms?.$logNotice).toBeDefined();

      const targetTs = fs.readFileSync(path.join(tmpDir, "log.ts"), "utf-8");
      expect(targetTs).toContain("console.log");
      expect(targetTs).toContain('"NOTICE: " + msg');
    });
  });

  describe("3. Test Runner & Context Integration with Idioms", () => {
    it("compiles .ail files containing idioms in compileAilFile", () => {
      const idiomDef: ProjectIdiomDefinition = {
        name: "$checkEq",
        kind: "stmt",
        params: [{ name: "$0" }, { name: "$1" }],
        templateAil: "if $0 != $1:\n  ret nil",
        occurrences: 5,
        tokensPerOccurrenceSaved: 7,
        netTokenSavings: 25,
      };

      saveProjectConfig(tmpDir, {
        mode: "side-by-side",
        targetLanguage: "typescript",
        idioms: {
          $checkEq: idiomDef,
        },
      });

      const ailFile = path.join(tmpDir, "test_check.ts.ail");
      fs.writeFileSync(
        ailFile,
        `module test_check\n\nfn runTest(a: int, b: int):\n  $checkEq(a, b)\n  ret true\n`,
        "utf-8",
      );

      const targetTs = path.join(tmpDir, "test_check.ts");
      const res = compileAilFile(ailFile, {
        targetPath: targetTs,
        projectRoot: tmpDir,
      });

      expect(res.compiled).toBe(true);
      const emittedTs = fs.readFileSync(targetTs, "utf-8");
      expect(emittedTs).toContain("a !== b");
      expect(emittedTs).not.toContain("$checkEq");
    });

    it("includes active idioms in generateContext and generateWorkspaceContext", async () => {
      const idiomDef: ProjectIdiomDefinition = {
        name: "$notify",
        kind: "stmt",
        params: [{ name: "$0" }],
        templateAil: "logger.info($0)",
        occurrences: 10,
        tokensPerOccurrenceSaved: 4,
        netTokenSavings: 35,
      };

      saveProjectConfig(tmpDir, {
        mode: "side-by-side",
        targetLanguage: "typescript",
        idioms: {
          $notify: idiomDef,
        },
      });

      const ailFile = path.join(tmpDir, "service.ts.ail");
      fs.writeFileSync(ailFile, `module service\n\nfn run():\n  ret 42\n`, "utf-8");

      // generateContext
      const ctx = await generateContext(ailFile, { projectRoot: tmpDir });
      expect(ctx.idioms).toBeDefined();
      expect(ctx.idioms?.$notify).toBeDefined();
      expect(ctx.formattedBundle).toContain("Active Project Idioms");
      expect(ctx.formattedBundle).toContain("$notify");

      // generateWorkspaceContext
      const wsCtx = await generateWorkspaceContext(tmpDir, { projectRoot: tmpDir });
      expect(wsCtx.idioms).toBeDefined();
      expect(wsCtx.formattedBundle).toContain("Active Project Idioms");
      expect(wsCtx.formattedBundle).toContain("$notify");
    });
  });

  describe("4. Semantic Outline & AST Splice Integration with Idioms", () => {
    it("includes compact referenced idioms header in generateOutline", () => {
      const idiomDef: ProjectIdiomDefinition = {
        name: "$safeAdd",
        kind: "expr",
        params: [{ name: "$0" }, { name: "$1" }],
        templateAil: "$0 + $1",
        occurrences: 5,
        tokensPerOccurrenceSaved: 3,
        netTokenSavings: 12,
      };

      saveProjectConfig(tmpDir, {
        mode: "side-by-side",
        idioms: {
          $safeAdd: idiomDef,
        },
      });

      const ailFile = path.join(tmpDir, "calc.ts.ail");
      fs.writeFileSync(
        ailFile,
        `module calc\n\nfn add(x: int, y: int) -> int:\n  ret $safeAdd(x, y)\n`,
        "utf-8",
      );

      const outline = generateOutline(ailFile, { projectRoot: tmpDir });
      expect(outline.text).toContain("// idioms: $safeAdd");
      expect(outline.json?.referencedIdioms).toContain("$safeAdd");
    });

    it("expands idioms when splicing and compiling target files", async () => {
      const idiomDef: ProjectIdiomDefinition = {
        name: "$earlyExit",
        kind: "stmt",
        params: [{ name: "$0" }],
        templateAil: "if $0: ret 0",
        occurrences: 3,
        tokensPerOccurrenceSaved: 5,
        netTokenSavings: 15,
      };

      saveProjectConfig(tmpDir, {
        mode: "side-by-side",
        targetLanguage: "typescript",
        idioms: {
          $earlyExit: idiomDef,
        },
      });

      const ailFile = path.join(tmpDir, "handler.ts.ail");
      const targetTs = path.join(tmpDir, "handler.ts");

      fs.writeFileSync(
        ailFile,
        `module handler\n\nfn process(done: bool) -> int:\n  ret 1\n`,
        "utf-8",
      );
      fs.writeFileSync(targetTs, `export function process(done: boolean): number {\n  return 1;\n}\n`, "utf-8");

      // Splice body with idiom call
      const spliceRes = await splice(ailFile, {
        symbol: "process",
        body: "$earlyExit(done)\nret 2",
        compile: true,
        projectRoot: tmpDir,
      });

      expect(spliceRes.success).toBe(true);

      // Verify the .ail file preserves the unexpanded idiom
      const updatedAil = fs.readFileSync(ailFile, "utf-8");
      expect(updatedAil).toContain("$earlyExit(done)");

      // Verify the emitted target .ts file expanded the idiom
      const updatedTs = fs.readFileSync(targetTs, "utf-8");
      expect(updatedTs).toContain("if (done)");
      expect(updatedTs).not.toContain("$earlyExit");
    });
  });

  describe("5. CLI `ail idioms` Commands (list, scan, apply, expand)", () => {
    it("executes `ail idioms list` via CLI", () => {
      const idiomDef: ProjectIdiomDefinition = {
        name: "$guardVal",
        kind: "stmt",
        params: [{ name: "$0" }],
        templateAil: "if $0 < 0: ret nil",
        occurrences: 4,
        tokensPerOccurrenceSaved: 5,
        netTokenSavings: 18,
        description: "Guards negative input",
      };

      saveProjectConfig(tmpDir, {
        mode: "side-by-side",
        idioms: {
          $guardVal: idiomDef,
        },
      });

      const res = runCli(["idioms", "list", tmpDir]);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("$guardVal");
      expect(res.stdout).toContain("Guards negative input");

      const jsonRes = runCli(["idioms", "list", tmpDir, "--json"]);
      expect(jsonRes.status).toBe(0);
      const parsed = JSON.parse(jsonRes.stdout);
      expect(parsed.$guardVal).toBeDefined();
    });

    it("executes `ail idioms scan` without mutating files", () => {
      saveProjectConfig(tmpDir, {
        mode: "side-by-side",
        idioms: {},
      });

      const res = runCli(["idioms", "scan", tmpDir]);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("AIL Project Idioms Scan");
    });

    it("executes `ail idioms expand` to clear idioms from config", () => {
      const idiomDef: ProjectIdiomDefinition = {
        name: "$logHello",
        kind: "stmt",
        params: [],
        templateAil: 'console.log("hello")',
        occurrences: 3,
        tokensPerOccurrenceSaved: 4,
        netTokenSavings: 12,
      };

      saveProjectConfig(tmpDir, {
        mode: "side-by-side",
        idioms: {
          $logHello: idiomDef,
        },
      });

      const res = runCli(["idioms", "expand", tmpDir]);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("AIL Project Idioms Expand");

      // Verify config idioms were cleared
      const config = loadProjectConfig(tmpDir);
      expect(config.idioms).toBeUndefined();
    });
  });
});
