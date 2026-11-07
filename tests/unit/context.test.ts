/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for AICE 2.0 AI Context Packager Engine (Step 20).
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { program } from "../../bin/aice.js";
import {
  type ContextOptions,
  type ContextResult,
  generateContext,
  packageContext,
  packContext,
  resolveImportPath,
} from "../../src/tools/context.js";

describe("AICE 2.0 AI Context Packager Engine (Step 20)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aice-context-test-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  describe("Resolving Direct Local Dependencies", () => {
    it("extracts exported symbols and methods from local dependency into contract", async () => {
      const depPath = path.join(tmpDir, "dep.aice");
      fs.writeFileSync(
        depPath,
        `
# Computes sum of two integers
pub fn add(a: int, b: int) -> int:
  ret a + b

# 2D Vector mathematics utility
pub class MathHelper:
  fn multiply(x: int, y: int) -> int:
    ret x * y

# Private helper not exported
fn internalSecret():
  ret 42
`,
        "utf-8",
      );

      const mainPath = path.join(tmpDir, "main.aice");
      fs.writeFileSync(
        mainPath,
        `
from "./dep" import { add, MathHelper }

pub fn run():
  ret add(1, 2)
`,
        "utf-8",
      );

      const res = await generateContext(mainPath, { projectRoot: tmpDir });

      expect(res.targetPath).toBe("main.aice");
      expect(res.targetContent).toContain("pub fn run():");
      expect(res.dependencies).toHaveLength(1);

      const dep = res.dependencies[0];
      expect(dep.specifier).toBe("./dep");
      expect(dep.isExternal).toBe(false);
      expect(dep.resolvedPath).toBe("dep.aice");
      expect(dep.importedSymbols).toEqual(["add", "MathHelper"]);

      // Verify contract has exported symbols and docstrings, but omits internalSecret
      expect(dep.contract).toContain("Computes sum of two integers");
      expect(dep.contract).toContain("pub fn add(a: int, b: int) -> int: ...");
      expect(dep.contract).toContain("pub class MathHelper:");
      expect(dep.contract).toContain("fn multiply(x: int, y: int) -> int: ...");
      expect(dep.contract).not.toContain("internalSecret");

      // Verify formatted markdown bundle
      expect(res.formattedBundle).toContain("# AICE Context Pack: main.aice");
      expect(res.formattedBundle).toContain("## Imported Dependency Contracts (1):");
      expect(res.formattedBundle).toContain("### Dependency: `./dep` (`dep.aice`)");
      expect(res.formattedBundle).toContain("```aice");
      expect(res.formattedBundle).toContain("## Target File Content:");
      expect(res.formattedBundle).toContain("pub fn run():");
    });

    it("resolves dependency with .js extension to .ts in on-the-fly mode", async () => {
      const typesPath = path.join(tmpDir, "types.ts");
      fs.writeFileSync(
        typesPath,
        `export interface User {
  id: string;
  name: string;
}

export enum Role {
  Admin = "Admin",
  Member = "Member",
}
`,
        "utf-8",
      );

      const consumerPath = path.join(tmpDir, "consumer.ts");
      fs.writeFileSync(
        consumerPath,
        `import { User, Role } from "./types.js";

export function getUserName(u: User): string {
  return u.name;
}
`,
        "utf-8",
      );

      const res = await generateContext(consumerPath, { projectRoot: tmpDir });
      expect(res.dependencies).toHaveLength(1);
      expect(res.dependencies[0].specifier).toBe("./types.js");
      expect(res.dependencies[0].resolvedPath).toBe("types.ts");
      expect(res.dependencies[0].isExternal).toBe(false);
      expect(res.dependencies[0].contract).toContain("type User:");
      expect(res.dependencies[0].contract).toContain("id: str");
      expect(res.dependencies[0].contract).toContain("enum Role:");
    });

    it("aliases packContext and packageContext to generateContext", () => {
      expect(packContext).toBe(generateContext);
      expect(packageContext).toBe(generateContext);
    });
  });

  describe("External Library Imports", () => {
    it("categorizes node:* and external packages properly", async () => {
      const extFile = path.join(tmpDir, "external_test.aice");
      fs.writeFileSync(
        extFile,
        `
from "node:path" import { join, resolve }
from "react" import { useState, useEffect }
import "node:fs"

pub fn getPath():
  ret join("a", "b")
`,
        "utf-8",
      );

      const res = await generateContext(extFile, { projectRoot: tmpDir });

      expect(res.dependencies).toHaveLength(3);

      const nodePathDep = res.dependencies.find((d) => d.specifier === "node:path");
      expect(nodePathDep).toBeDefined();
      expect(nodePathDep?.isExternal).toBe(true);
      expect(nodePathDep?.resolvedPath).toBeUndefined();
      expect(nodePathDep?.importedSymbols).toEqual(["join", "resolve"]);
      expect(nodePathDep?.contract).toContain("node:path");
      expect(nodePathDep?.contract).toContain("join, resolve");

      const reactDep = res.dependencies.find((d) => d.specifier === "react");
      expect(reactDep).toBeDefined();
      expect(reactDep?.isExternal).toBe(true);
      expect(reactDep?.resolvedPath).toBeUndefined();
      expect(reactDep?.importedSymbols).toEqual(["useState", "useEffect"]);
      expect(reactDep?.contract).toContain("react");
      expect(reactDep?.contract).toContain("useState, useEffect");

      const nodeFsDep = res.dependencies.find((d) => d.specifier === "node:fs");
      expect(nodeFsDep).toBeDefined();
      expect(nodeFsDep?.isExternal).toBe(true);
      expect(nodeFsDep?.resolvedPath).toBeUndefined();
      expect(nodeFsDep?.importedSymbols).toEqual([]);
      expect(nodeFsDep?.contract).toContain('import "node:fs"');

      // Verify formattedBundle has external indication
      expect(res.formattedBundle).toContain("### Dependency: `node:path` (external)");
      expect(res.formattedBundle).toContain("### Dependency: `react` (external)");
      expect(res.formattedBundle).toContain("### Dependency: `node:fs` (external)");
    });
  });

  describe("Recursive Dependency Traversal with Depth and Cycle Protection", () => {
    it("limits discovery to depth 1 by default", async () => {
      const cPath = path.join(tmpDir, "c.aice");
      fs.writeFileSync(cPath, `pub fn funcC() -> int: ret 3\n`, "utf-8");

      const bPath = path.join(tmpDir, "b.aice");
      fs.writeFileSync(
        bPath,
        `
from "./c" import { funcC }
pub fn funcB() -> int: ret funcC()
`,
        "utf-8",
      );

      const aPath = path.join(tmpDir, "a.aice");
      fs.writeFileSync(
        aPath,
        `
from "./b" import { funcB }
pub fn funcA() -> int: ret funcB()
`,
        "utf-8",
      );

      const resDepth1 = await generateContext(aPath, { depth: 1, projectRoot: tmpDir });
      expect(resDepth1.dependencies).toHaveLength(1);
      expect(resDepth1.dependencies[0].specifier).toBe("./b");

      const resDepth2 = await generateContext(aPath, { depth: 2, projectRoot: tmpDir });
      expect(resDepth2.dependencies).toHaveLength(2);
      expect(resDepth2.dependencies.map((d) => d.specifier)).toEqual(["./b", "./c"]);
      expect(resDepth2.dependencies[1].contract).toContain("pub fn funcC() -> int: ...");
    });

    it("prevents infinite loops when dependencies have circular references", async () => {
      const loopAPath = path.join(tmpDir, "loopA.aice");
      const loopBPath = path.join(tmpDir, "loopB.aice");
      const loopCPath = path.join(tmpDir, "loopC.aice");

      fs.writeFileSync(
        loopAPath,
        `
from "./loopB" import { funcB }
pub fn funcA() -> int: ret funcB()
`,
        "utf-8",
      );

      fs.writeFileSync(
        loopBPath,
        `
from "./loopC" import { funcC }
pub fn funcB() -> int: ret funcC()
`,
        "utf-8",
      );

      fs.writeFileSync(
        loopCPath,
        `
from "./loopA" import { funcA }
pub fn funcC() -> int: ret funcA()
`,
        "utf-8",
      );

      // Traversal with depth 3 across circular graph
      const res = await generateContext(loopAPath, { depth: 3, projectRoot: tmpDir });

      // Should contain loopB and loopC without infinitely duplicating loopA
      expect(res.dependencies).toHaveLength(2);
      expect(res.dependencies.map((d) => d.specifier)).toEqual(["./loopB", "./loopC"]);
      expect(res.dependencies.find((d) => d.resolvedPath === "loopA.aice")).toBeUndefined();
    });
  });

  describe("Caller Discovery Across Sibling Workspace Files", () => {
    it("discovers downstream callers and their imported symbols across workspace", async () => {
      const mathPath = path.join(tmpDir, "math.aice");
      fs.writeFileSync(
        mathPath,
        `
pub fn add(a: int, b: int) -> int: ret a + b
pub fn sub(a: int, b: int) -> int: ret a - b
`,
        "utf-8",
      );

      const calcPath = path.join(tmpDir, "calc.aice");
      fs.writeFileSync(
        calcPath,
        `from "./math" import { add }
pub fn calc(): ret add(1, 2)
`,
        "utf-8",
      );

      const servicePath = path.join(tmpDir, "service.aice");
      fs.writeFileSync(
        servicePath,
        `from "./math" import { add, sub }
pub fn doService(): ret sub(5, 2)
`,
        "utf-8",
      );

      const unrelatedPath = path.join(tmpDir, "unrelated.aice");
      fs.writeFileSync(unrelatedPath, `pub fn unrelated(): ret 123\n`, "utf-8");

      const res = await generateContext(mathPath, {
        includeCallers: true,
        projectRoot: tmpDir,
      });

      expect(res.callers).toHaveLength(2);
      expect(res.callers.map((c) => c.filePath)).toEqual(["calc.aice", "service.aice"]);

      const calcCaller = res.callers.find((c) => c.filePath === "calc.aice");
      expect(calcCaller?.importedSymbols).toEqual(["add"]);
      expect(calcCaller?.line).toBe(1);

      const serviceCaller = res.callers.find((c) => c.filePath === "service.aice");
      expect(serviceCaller?.importedSymbols).toEqual(["add", "sub"]);
      expect(serviceCaller?.line).toBe(1);

      expect(res.formattedBundle).toContain("## Downstream Callers (2):");
      expect(res.formattedBundle).toContain("- `calc.aice` imports: `add`");
      expect(res.formattedBundle).toContain("- `service.aice` imports: `add, sub`");
    });

    it("skips caller lookup when includeCallers is false", async () => {
      const mathPath = path.join(tmpDir, "math.aice");
      fs.writeFileSync(mathPath, `pub fn add(a: int, b: int) -> int: ret a + b\n`, "utf-8");

      const calcPath = path.join(tmpDir, "calc.aice");
      fs.writeFileSync(
        calcPath,
        `from "./math" import { add }\npub fn calc(): ret add(1, 2)\n`,
        "utf-8",
      );

      const res = await generateContext(mathPath, {
        includeCallers: false,
        projectRoot: tmpDir,
      });

      expect(res.callers).toHaveLength(0);
      expect(res.formattedBundle).toContain("## Downstream Callers (0):");
      expect(res.formattedBundle).toContain("None");
    });
  });

  describe("Target Outline Mode (--outline-target)", () => {
    it("emits concise AST skeleton outline instead of full source when outlineTarget is true", async () => {
      const targetPath = path.join(tmpDir, "heavy.aice");
      fs.writeFileSync(
        targetPath,
        `
# Performs complex calculations
pub fn calculateMetrics(x: int, y: int) -> int:
  val step1 = x * 2
  val step2 = y * 3
  val sum = step1 + step2
  ret sum * 10
`,
        "utf-8",
      );

      const normalRes = await generateContext(targetPath, {
        outlineTarget: false,
        projectRoot: tmpDir,
      });
      expect(normalRes.targetContent).toContain("val step1 = x * 2");
      expect(normalRes.formattedBundle).toContain("val step1 = x * 2");
      expect(normalRes.targetOutline).toBeDefined();

      const outlineRes = await generateContext(targetPath, {
        outlineTarget: true,
        projectRoot: tmpDir,
      });
      expect(outlineRes.formattedBundle).toContain(
        "pub fn calculateMetrics(x: int, y: int) -> int: ...",
      );
      expect(outlineRes.formattedBundle).not.toContain("val step1 = x * 2");
      expect(outlineRes.formattedBundle).not.toContain("val step2 = y * 3");
    });
  });

  describe("Token Estimation & MaxTokens Bounding", () => {
    it("computes accurate token count and bounds context when maxTokens is specified", async () => {
      const targetPath = path.join(tmpDir, "large.aice");
      const lines = [
        "pub fn bigFunction():",
        ...Array.from({ length: 150 }, (_, i) => `  val line${i} = ${i} * 2`),
        "  ret 0",
      ];
      fs.writeFileSync(targetPath, lines.join("\n"), "utf-8");

      const normalRes = await generateContext(targetPath, { projectRoot: tmpDir });
      expect(normalRes.tokenCount).toBeGreaterThan(100);

      // Specify maxTokens limit that triggers outline fallback
      const outlineFallbackRes = await generateContext(targetPath, {
        maxTokens: 50,
        projectRoot: tmpDir,
      });
      expect(outlineFallbackRes.tokenCount).toBeLessThanOrEqual(50);
      expect(outlineFallbackRes.formattedBundle).toContain("pub fn bigFunction(): ...");

      // Specify strict maxTokens limit that triggers truncation
      const truncatedRes = await generateContext(targetPath, {
        maxTokens: 15,
        projectRoot: tmpDir,
      });
      expect(truncatedRes.tokenCount).toBeLessThanOrEqual(15);
      expect(truncatedRes.formattedBundle).toContain("truncated");
    });
  });

  describe("JSON Output Format", () => {
    it("outputs valid structured JSON bundle", async () => {
      const targetPath = path.join(tmpDir, "simple.aice");
      fs.writeFileSync(targetPath, `pub fn simple(): ret 1\n`, "utf-8");

      const res = await generateContext(targetPath, {
        json: true,
        projectRoot: tmpDir,
      });

      expect(res).toHaveProperty("targetPath");
      expect(res).toHaveProperty("targetContent");
      expect(res).toHaveProperty("dependencies");
      expect(res).toHaveProperty("callers");
      expect(res).toHaveProperty("formattedBundle");
      expect(res).toHaveProperty("tokenCount");

      const jsonStr = JSON.stringify(res);
      const parsed = JSON.parse(jsonStr);
      expect(parsed.targetPath).toBe("simple.aice");
    });
  });

  describe("CLI Command Registration and Execution", () => {
    it("registers context command in commander program", () => {
      const contextCmd = program.commands.find((c) => c.name() === "context");
      expect(contextCmd).toBeDefined();
      expect(contextCmd?.description()).toContain("Dependency contract packager");

      const options = contextCmd?.options.map((o) => o.name());
      expect(options).toContain("depth");
      expect(options).toContain("no-callers");
      expect(options).toContain("outline-target");
      expect(options).toContain("max-tokens");
      expect(options).toContain("json");
      expect(options).toContain("stats");
    });

    it("executes CLI context packaging command with stdout capture", async () => {
      const depPath = path.join(tmpDir, "cli_dep.aice");
      fs.writeFileSync(depPath, `pub fn add(a: int, b: int) -> int: ret a + b\n`, "utf-8");

      const mainPath = path.join(tmpDir, "cli_main.aice");
      fs.writeFileSync(
        mainPath,
        `from "./cli_dep" import { add }\npub fn run(): ret add(1, 2)\n`,
        "utf-8",
      );

      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => {
        logs.push(args.join(" "));
      };

      try {
        await program.parseAsync([
          "node",
          "aice",
          "context",
          mainPath,
          "--depth",
          "1",
          "--no-callers",
        ]);
      } finally {
        console.log = origLog;
      }

      const output = logs.join("\n");
      expect(output).toContain("# AICE Context Pack:");
      expect(output).toContain("### Dependency: `./cli_dep`");
      expect(output).toContain("pub fn add(a: int, b: int) -> int: ...");
    });

    it("executes CLI context packaging with --json flag", async () => {
      const mainPath = path.join(tmpDir, "cli_json.aice");
      fs.writeFileSync(mainPath, `pub fn ping(): ret "pong"\n`, "utf-8");

      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => {
        logs.push(args.join(" "));
      };

      try {
        await program.parseAsync(["node", "aice", "context", mainPath, "--json"]);
      } finally {
        console.log = origLog;
      }

      const output = logs.join("\n");
      const parsed = JSON.parse(output);
      expect(parsed).toHaveProperty("targetPath");
      expect(parsed).toHaveProperty("targetContent");
      expect(parsed).toHaveProperty("dependencies");
    });

    it("executes CLI context packaging with --stats flag", async () => {
      const mainPath = path.join(tmpDir, "cli_stats.aice");
      fs.writeFileSync(mainPath, `pub fn statsFn(): ret 42\n`, "utf-8");

      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => {
        logs.push(args.join(" "));
      };

      try {
        await program.parseAsync(["node", "aice", "context", mainPath, "--stats"]);
      } finally {
        console.log = origLog;
      }

      const output = logs.join("\n");
      expect(output).toContain("📊 Context Pack Token Telemetry:");
      expect(output).toContain("Total pack tokens:");
    });
  });
});
