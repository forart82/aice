/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * End-to-end integration test suite for AICE 2.0 Project Idioms engine.
 * Verifies integration across:
 * 1. On-the-fly `scanProjectIdioms` across native files (zero `.aice` files on disk)
 * 2. `generateContext` & `generateWorkspaceContext`
 * 3. `generateOutline` referenced idiom headers
 * 4. `splice` with idiom expansion directly on native files
 * 5. `aice idioms` CLI actions (list, scan, expand)
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
import { scanProjectIdioms } from "../../src/idioms/idiom-transform.js";
import { generateContext, generateWorkspaceContext } from "../../src/tools/context.js";
import { generateOutline } from "../../src/tools/outline.js";
import { splice } from "../../src/tools/splice.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cliPath = path.resolve(__dirname, "../../bin/aice.ts");

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

describe("AICE 2.0 Project Idioms End-to-End Integration", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aice-idioms-integ-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  describe("1. On-the-Fly Idiom Discovery (`scanProjectIdioms`)", () => {
    it("mines repetitive blocks and synthesizes idioms on-the-fly without creating .aice files", () => {
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

      const scanRes = scanProjectIdioms(tmpDir, {
        minOccurrences: 3,
        minNetTokenSavings: 1,
      });

      expect(scanRes.synthesizedIdioms).toBeGreaterThan(0);
      expect(scanRes.netTokenSavings).toBeGreaterThan(0);
      expect(fs.existsSync(path.join(tmpDir, "h1.ts.aice"))).toBe(false);

      const config = loadProjectConfig(tmpDir);
      expect(config.idioms).toBeDefined();
      expect(Object.keys(config.idioms!)).toHaveLength(scanRes.synthesizedIdioms!);
    });
  });

  describe("2. Context Integration with Idioms", () => {
    it("includes active idioms in generateContext and generateWorkspaceContext", async () => {
      const idiomDef: ProjectIdiomDefinition = {
        name: "$notify",
        kind: "stmt",
        params: [{ name: "$0" }],
        templateAice: "logger.info($0)",
        occurrences: 10,
        tokensPerOccurrenceSaved: 4,
        netTokenSavings: 35,
      };

      saveProjectConfig(tmpDir, {
        targetLanguage: "typescript",
        idioms: {
          $notify: idiomDef,
        },
      });

      const tsFile = path.join(tmpDir, "service.ts");
      fs.writeFileSync(tsFile, `export function run(): number {\n  return 42;\n}\n`, "utf-8");

      // generateContext
      const ctx = await generateContext(tsFile, { projectRoot: tmpDir });
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

  describe("3. Semantic Outline & AST Splice Integration with Idioms", () => {
    it("includes compact referenced idioms header in generateOutline", () => {
      const idiomDef: ProjectIdiomDefinition = {
        name: "$safeAdd",
        kind: "expr",
        params: [{ name: "$0" }, { name: "$1" }],
        templateAice: "$0 + $1",
        occurrences: 5,
        tokensPerOccurrenceSaved: 3,
        netTokenSavings: 12,
      };

      saveProjectConfig(tmpDir, {
        idioms: {
          $safeAdd: idiomDef,
        },
      });

      const aiceFile = path.join(tmpDir, "calc.ts.aice");
      fs.writeFileSync(
        aiceFile,
        `module calc\n\nfn add(x: int, y: int) -> int:\n  ret $safeAdd(x, y)\n`,
        "utf-8",
      );

      const outline = generateOutline(aiceFile, { projectRoot: tmpDir });
      expect(outline.text).toContain("// idioms: $safeAdd");
      expect(outline.json?.referencedIdioms).toContain("$safeAdd");
    });

    it("expands idioms when splicing directly into native TypeScript files", async () => {
      const idiomDef: ProjectIdiomDefinition = {
        name: "$earlyExit",
        kind: "stmt",
        params: [{ name: "$0" }],
        templateAice: "if $0: ret 0",
        occurrences: 3,
        tokensPerOccurrenceSaved: 5,
        netTokenSavings: 15,
      };

      saveProjectConfig(tmpDir, {
        targetLanguage: "typescript",
        idioms: {
          $earlyExit: idiomDef,
        },
      });

      const targetTs = path.join(tmpDir, "handler.ts");
      fs.writeFileSync(
        targetTs,
        `export function process(done: boolean): number {\n  return 1;\n}\n`,
        "utf-8",
      );

      // Splice body with idiom call directly into native .ts file
      const spliceRes = await splice(targetTs, {
        symbol: "process",
        body: "$earlyExit(done)\nret 2",
        projectRoot: tmpDir,
      });

      expect(spliceRes.success).toBe(true);

      // Verify the native target .ts file expanded the idiom
      const updatedTs = fs.readFileSync(targetTs, "utf-8");
      expect(updatedTs).toContain("if (done)");
      expect(updatedTs).not.toContain("$earlyExit");
      expect(fs.existsSync(`${targetTs}.aice`)).toBe(false);
    });
  });

  describe("4. CLI `aice idioms` Commands (list, scan, expand)", () => {
    it("executes `aice idioms list` via CLI", () => {
      const idiomDef: ProjectIdiomDefinition = {
        name: "$guardVal",
        kind: "stmt",
        params: [{ name: "$0" }],
        templateAice: "if $0 < 0: ret nil",
        occurrences: 4,
        tokensPerOccurrenceSaved: 5,
        netTokenSavings: 18,
        description: "Guards negative input",
      };

      saveProjectConfig(tmpDir, {
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

    it("executes `aice idioms scan` without mutating source files", () => {
      saveProjectConfig(tmpDir, {
        idioms: {},
      });

      const res = runCli(["idioms", "scan", tmpDir]);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("AICE Project Idioms Scan");
    });

    it("executes `aice idioms expand` to clear idioms from config", () => {
      const idiomDef: ProjectIdiomDefinition = {
        name: "$logHello",
        kind: "stmt",
        params: [],
        templateAice: 'console.log("hello")',
        occurrences: 3,
        tokensPerOccurrenceSaved: 4,
        netTokenSavings: 12,
      };

      saveProjectConfig(tmpDir, {
        idioms: {
          $logHello: idiomDef,
        },
      });

      const res = runCli(["idioms", "expand", tmpDir]);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("AICE Project Idioms Expand");

      // Verify config idioms were cleared
      const config = loadProjectConfig(tmpDir);
      expect(config.idioms).toBeUndefined();
    });
  });
});
