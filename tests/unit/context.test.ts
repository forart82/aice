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
import { estimateTokens } from "../../src/tokenomics/index.js";
import {
  buildSiblingOutline,
  doesFileStemMatchQuery,
  extractPatternMatchesDetailed,
  extractPrimaryQueryKeyword,
  generateContext,
  generateMultiContext,
  generateWorkspaceContext,
  isCommentLine,
  isTestOrMockPath,
  packageContext,
  packContext,
} from "../../src/tools/context.js";
import { outlinePath } from "../../src/tools/outline.js";

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

    it("ranks file name match > production code > comments > mock/test files", async () => {
      const srcDir = path.join(tmpDir, "src");
      const testDir = path.join(tmpDir, "tests");
      fs.mkdirSync(srcDir, { recursive: true });
      fs.mkdirSync(testDir, { recursive: true });

      const tier1Path = path.join(srcDir, "order_gateway.ts");
      fs.writeFileSync(tier1Path, "export const ROUTE = '/orders';\n", "utf-8");

      const tier2Path = path.join(srcDir, "processor.ts");
      fs.writeFileSync(
        tier2Path,
        "export function order_gateway(req: any) {\n  return req.id;\n}\n",
        "utf-8",
      );

      const tier3Path = path.join(srcDir, "helper.ts");
      fs.writeFileSync(
        tier3Path,
        "// TODO: route through order_gateway when ready\nexport const V = 1;\n",
        "utf-8",
      );

      const tier4Path = path.join(testDir, "order_gateway.test.ts");
      fs.writeFileSync(
        tier4Path,
        "describe('order_gateway mock test', () => {\n  it('checks mock', () => {});\n});\n",
        "utf-8",
      );

      const res = await generateContext(tmpDir, {
        symbol: "/order_gateway/",
      });

      const body = res.formattedBundle;
      const posTier1 = body.indexOf("order_gateway.ts");
      const posTier2 = body.indexOf("processor.ts");
      const posTier3 = body.indexOf("helper.ts");
      const posTier4 = body.indexOf("order_gateway.test.ts");

      expect(posTier1).toBeGreaterThanOrEqual(0);
      expect(posTier2).toBeGreaterThanOrEqual(0);
      expect(posTier3).toBeGreaterThanOrEqual(0);
      expect(posTier4).toBeGreaterThanOrEqual(0);

      expect(posTier1).toBeLessThan(posTier2);
      expect(posTier2).toBeLessThan(posTier3);
      expect(posTier3).toBeLessThan(posTier4);
    });
  });
});

describe("Adaptive Sibling Outlining", () => {
  const mk = (names: string[]) => ({
    name: "Svc",
    kind: "class",
    line: 1,
    signature: "class Svc",
    children: names.map((n, i) => ({
      name: n,
      kind: "method",
      line: i + 2,
      signature: `${n}(): void`,
    })),
  });

  it("lists siblings excluding the target", () => {
    const out = buildSiblingOutline([mk(["a", "b", "c"])], "Svc.b");
    expect(out).toContain("a(): void");
    expect(out).toContain("c(): void");
    expect(out).not.toContain("b(): void");
  });

  it("returns empty for top-level selectors", () => {
    expect(buildSiblingOutline([mk(["a"])], "Svc")).toBe("");
  });

  it("caps at 20 symbols and reports remainder", () => {
    const names = Array.from({ length: 40 }, (_, i) => `m${i}`);
    const out = buildSiblingOutline([mk(names)], "Svc.m0");
    expect(out.split("\n").filter((l) => l.includes("(): void")).length).toBeLessThanOrEqual(20);
    expect(out).toMatch(/\(\+ \d+ other methods\)/);
  });

  it("appends siblings in generateContext for Class.method", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aice-sib-"));
    try {
      const f = path.join(tmp, "svc.ts");
      fs.writeFileSync(
        f,
        "export class Svc {\n  alpha(): number { return 1; }\n  beta(): number { return 2; }\n}\n",
      );
      const res = await generateContext(f, { projectRoot: tmp, symbol: "Svc.alpha" });
      expect(JSON.stringify(res)).toContain("beta");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("deduplicates sibling outline per parent on multi-selector Class.m1,Class.m2 and excludes all queried targets", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aice-sib-multi-"));
    try {
      const f = path.join(tmp, "ledger.ts");
      fs.writeFileSync(
        f,
        [
          "export class Ledger {",
          "  credit(amount: number): number { return amount; }",
          "  debit(amount: number): number { return -amount; }",
          "  balance(): number { return 0; }",
          "  auditTrail(): string[] { return []; }",
          "}",
        ].join("\n"),
        "utf-8",
      );
      const res = await generateContext(f, {
        projectRoot: tmp,
        symbol: "Ledger.credit,Ledger.debit",
      });
      const headerMatches = res.targetContent.match(/\/\/ siblings in Ledger:/g) ?? [];
      expect(headerMatches).toHaveLength(1);
      const sibSection = res.targetContent.split("// siblings in Ledger:")[1] ?? "";
      expect(sibSection).toContain("balance");
      expect(sibSection).toContain("auditTrail");
      expect(sibSection).not.toContain("credit(");
      expect(sibSection).not.toContain("debit(");
      // Also verify module header is not duplicated across multi-symbol slices
      const moduleMatches = res.targetContent.match(/^module\s+/gm) ?? [];
      expect(moduleMatches.length).toBeLessThanOrEqual(1);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("resolves enclosing parent siblings for bare member queries while keeping top-level queries clean", () => {
    const symbols = [
      mk(["alpha", "beta", "gamma"]),
      {
        name: "topHelper",
        kind: "function",
        line: 20,
        signature: "pub fn topHelper(): void",
        children: [],
      },
    ];
    expect(buildSiblingOutline(symbols, "topHelper")).toBe("");
    expect(buildSiblingOutline(symbols, "Svc")).toBe("");
    const bareMemberOut = buildSiblingOutline(symbols, "alpha");
    expect(bareMemberOut).toContain("// siblings in Svc:");
    expect(bareMemberOut).toContain("beta(): void");
    expect(bareMemberOut).toContain("gamma(): void");
    expect(bareMemberOut).not.toContain("alpha(): void");
  });

  it("strictly enforces <= 150 tokens even when sibling signatures are extremely long", () => {
    const hugeChildren = Array.from({ length: 30 }, (_, i) => ({
      name: `veryLongMethodName_${i}`,
      kind: "method",
      line: i + 2,
      signature: `pub async fn veryLongMethodName_${i}(firstConfigParam: Record<string, Array<Map<string, number>>>, secondCallbackHandler: (ctx: ExecutionContext, payload: Uint8Array) => Promise<ResultEnvelope<number>>) -> Promise<ResultEnvelope<boolean>>: ...`,
      children: [],
    }));
    const out = buildSiblingOutline(
      [
        {
          name: "MegaService",
          kind: "class",
          line: 1,
          signature: "pub class MegaService",
          children: hugeChildren,
        },
      ],
      "MegaService.veryLongMethodName_0",
    );
    expect(out).toContain("// siblings in MegaService:");
    expect(out).toMatch(/\(\+ \d+ other methods\)/);
    expect(estimateTokens(out)).toBeLessThanOrEqual(150);
  });

  it("supports Rust generic/enum/orphan impl blocks + snake_case sibling exclusion and Go cross-file receiver methods", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aice-sib-polyglot-"));
    try {
      const rsFile = path.join(tmp, "engine.rs");
      fs.writeFileSync(
        rsFile,
        [
          "pub struct Engine<T> {",
          "    pub factor: i32,",
          "}",
          "",
          "impl<T> Engine<T> {",
          "    pub fn compute_velocity(&self, dt: i32) -> i32 {",
          "        return self.factor * dt;",
          "    }",
          "    pub fn reset_state(&mut self) -> i32 {",
          "        return 0;",
          "    }",
          "}",
          "",
          "pub enum Mode {",
          "    Fast,",
          "    Safe,",
          "}",
          "",
          "impl Mode {",
          "    pub fn is_fast(&self) -> bool {",
          "        return true;",
          "    }",
          "    pub fn label(&self) -> i32 {",
          "        return 1;",
          "    }",
          "}",
        ].join("\n"),
        "utf-8",
      );

      const rsRes = await generateContext(rsFile, {
        projectRoot: tmp,
        symbol: "Engine.compute_velocity",
      });
      expect(rsRes.targetContent).toContain("// siblings in Engine:");
      const rsSib = rsRes.targetContent.split("// siblings in Engine:")[1] ?? "";
      expect(rsSib).toContain("resetState");
      expect(rsSib).not.toContain("computeVelocity");

      const enumImplRes = await generateContext(rsFile, {
        projectRoot: tmp,
        symbol: "Mode.is_fast",
      });
      expect(enumImplRes.targetContent).toContain("// siblings in Mode:");
      expect(enumImplRes.targetContent).toContain("label");

      const goFile = path.join(tmp, "handlers.go");
      fs.writeFileSync(
        goFile,
        [
          "package server",
          "",
          "func (s *Gateway) HandlePing() int {",
          "    return 200",
          "}",
          "",
          "func (s *Gateway) Shutdown() int {",
          "    return 0",
          "}",
        ].join("\n"),
        "utf-8",
      );

      const goRes = await generateContext(goFile, {
        projectRoot: tmp,
        symbol: "Gateway.HandlePing",
      });
      expect(goRes.targetContent).toContain("// siblings in Gateway:");
      expect(goRes.targetContent).toContain("shutdown");
      expect(goRes.targetContent).not.toMatch(/\/\/\s+.*handlePing/i);

      const pyFile = path.join(tmp, "worker.py");
      fs.writeFileSync(
        pyFile,
        [
          "class Pipeline:",
          "    def ingest(self, x: int) -> int:",
          "        return x + 1",
          "    def flush(self) -> int:",
          "        return 0",
        ].join("\n"),
        "utf-8",
      );
      const pyRes = await generateContext(pyFile, {
        projectRoot: tmp,
        symbol: "Pipeline.ingest",
      });
      expect(pyRes.targetContent).toContain("// siblings in Pipeline:");
      expect(pyRes.targetContent).toContain("flush");
      expect(pyRes.targetContent).not.toMatch(/\/\/\s+.*ingest/);

      const mdFile = path.join(tmp, "SPEC.md");
      fs.writeFileSync(
        mdFile,
        "# Spec\n\n## Overview\nIntro text.\n\n## Architecture\nLayered design.\n",
        "utf-8",
      );
      const mdRes = await generateContext(mdFile, {
        projectRoot: tmp,
        symbol: "Architecture",
      });
      expect(mdRes.targetContent).toContain("## Architecture");
      expect(mdRes.targetContent).toContain("Layered design.");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("4-Tier Search Ranking, Multi-Target Resilience & External Root Isolation", () => {
  it("extracts clean keywords from escaped regexes and prevents extension false-positive matches", () => {
    expect(extractPrimaryQueryKeyword("/\\border_gateway\\b/")).toBe("order_gateway");
    expect(extractPrimaryQueryKeyword("/export\\s+class\\s+RiskEngine/")).toBe("RiskEngine");
    expect(doesFileStemMatchQuery("src/foo.ts", "ts")).toBe(false);
    expect(doesFileStemMatchQuery("src/core/risk_engine.ts", "RiskEngine")).toBe(true);
    expect(doesFileStemMatchQuery("src/order_gateway.ts", "order_gateway")).toBe(true);
  });

  it("avoids false positives in isTestOrMockPath and isCommentLine across languages", () => {
    expect(isTestOrMockPath("src/contest.ts")).toBe(false);
    expect(isTestOrMockPath("src/inspector.ts")).toBe(false);
    expect(isTestOrMockPath("src/latest.ts")).toBe(false);
    expect(isTestOrMockPath("src/specifier.ts")).toBe(false);
    expect(
      isTestOrMockPath("/tmp/benchmarks/run-1/src/engine.ts", "/tmp/benchmarks/run-1"),
    ).toBe(false);
    expect(isTestOrMockPath("tests/engine.ts")).toBe(true);
    expect(isTestOrMockPath("src/engine.spec.ts")).toBe(true);
    expect(isTestOrMockPath("src/mock_engine.ts")).toBe(true);
    expect(isTestOrMockPath("src/test_engine.py")).toBe(true);

    expect(isCommentLine("# Architecture Overview", "README.md")).toBe(false);
    expect(isCommentLine("#[derive(Debug, Clone)]", "src/lib.rs")).toBe(false);
    expect(isCommentLine("#include <vector>", "src/main.cpp")).toBe(false);
    expect(isCommentLine("--remaining;", "src/loop.ts")).toBe(false);
    expect(isCommentLine("# Python comment", "src/app.py")).toBe(true);
    expect(isCommentLine("-- SQL comment", "schema.sql")).toBe(true);
  });

  it("falls back gracefully to literal matching on invalid regex while rejecting catastrophic ReDoS", () => {
    const hit = extractPatternMatchesDetailed("const val = foo(bar + 1);\n", "/foo(bar/");
    expect(hit).toBeDefined();
    expect(hit?.formattedText).toContain("foo(bar + 1)");
    expect(() => extractPatternMatchesDetailed("aaaa", "/(a+)+$/")).toThrow(
      /Unsafe or overly complex regex/,
    );
  });

  it("annotates per-window call-site line numbers, sorts ties deterministically, and bounds maxTokens cleanly", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aice-rank-edges-"));
    try {
      const srcDir = path.join(tmp, "src");
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(
        path.join(srcDir, "b_worker.ts"),
        [
          "export function runJob() {",
          "  const targetToken = 1;",
          "  const pad1 = 1;",
          "  const pad2 = 2;",
          "  const pad3 = 3;",
          "  const pad4 = 4;",
          "  const pad5 = 5;",
          "  const pad6 = 6;",
          "  const targetToken2 = targetToken + 1;",
          "  return targetToken2;",
          "}",
        ].join("\n"),
        "utf-8",
      );
      fs.writeFileSync(
        path.join(srcDir, "a_worker.ts"),
        "export function initJob() {\n  const targetToken = 2;\n  return targetToken;\n}\n",
        "utf-8",
      );

      const res = await generateWorkspaceContext(tmp, { symbol: "/\\btargetToken\\b/" });
      expect(res.formattedBundle).toContain("(src/b_worker.ts:2)");
      expect(res.formattedBundle).toContain("(src/b_worker.ts:9)");
      expect(res.formattedBundle.indexOf("src/a_worker.ts")).toBeLessThan(
        res.formattedBundle.indexOf("src/b_worker.ts"),
      );

      const bounded = await generateWorkspaceContext(tmp, {
        symbol: "/\\btargetToken\\b/",
        maxTokens: 90,
      });
      expect(bounded.tokenCount).toBeLessThanOrEqual(90);
      const fenceCount = (bounded.formattedBundle.match(/^```/gm) ?? []).length;
      expect(fenceCount % 2).toBe(0);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("handles partial multi-symbol matches, cross-file symbol unions, 0-match regex summaries, and partial multi-path outlines", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aice-multi-resilience-"));
    try {
      const f1 = path.join(tmp, "alpha.ts");
      const f2 = path.join(tmp, "beta.ts");
      fs.writeFileSync(
        f1,
        "export function keepOne(): number { return 1; }\nexport function keepTwo(): number { return 2; }\n",
        "utf-8",
      );
      fs.writeFileSync(f2, "export function onlyInBeta(): string { return 'ok'; }\n", "utf-8");

      // 1. Single-file partial match returns found slices + // missing:
      const partial = await generateContext(f1, {
        projectRoot: tmp,
        symbol: "keepOne,deletedLegacyFn,keepTwo",
      });
      expect(partial.targetContent).toContain("keepOne");
      expect(partial.targetContent).toContain("keepTwo");
      expect(partial.targetContent).toContain("// missing: deletedLegacyFn");

      // 2. Cross-file multi-context union resolves symbols split across f1 and f2 without false // missing:
      const cross = await generateMultiContext([f1, f2], {
        projectRoot: tmp,
        symbol: "keepOne,onlyInBeta",
      });
      expect(cross.formattedBundle).toContain("keepOne");
      expect(cross.formattedBundle).toContain("onlyInBeta");
      expect(cross.formattedBundle).not.toContain("// missing:");

      // 3. Multi-file regex search compacts 0-match files into a 1-line summary
      const regexMulti = await generateMultiContext([f1, f2], {
        projectRoot: tmp,
        symbol: "/onlyInBeta/",
      });
      expect(regexMulti.formattedBundle).toContain("onlyInBeta");
      expect(regexMulti.formattedBundle).toContain("// 0 matches in: alpha.ts");

      // 4. Multi-path outlinePath tolerates missing paths when >=1 path exists
      const outMap = await outlinePath([f1, path.join(tmp, "missing_file.ts")], {
        projectRoot: tmp,
      });
      expect(outMap instanceof Map).toBe(true);
      if (outMap instanceof Map) {
        expect(outMap.size).toBe(2);
        const vals = Array.from(outMap.values()).map((v) => v.text);
        expect(vals.some((t) => t.includes("keepOne"))).toBe(true);
        expect(vals.some((t) => t.includes("// not found:"))).toBe(true);
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("matches collapsed $idiom regexes with --idioms and keeps >=8-file wildcard directory context compact", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aice-idiom-wildcard-"));
    try {
      fs.writeFileSync(
        path.join(tmp, "aice.config.json"),
        JSON.stringify(
          {
            enabled: true,
            idiomsEnabled: true,
            idioms: {
              $guardPositive: {
                name: "$guardPositive",
                params: [{ name: "$0" }],
                kind: "stmt",
                templateAice: "if $0 <= 0:\n  ret 0",
                occurrences: 3,
                tokensPerOccurrenceSaved: 6,
              },
            },
          },
          null,
          2,
        ),
        "utf-8",
      );
      const ledgerFile = path.join(tmp, "ledger.ts");
      fs.writeFileSync(
        ledgerFile,
        "export function settle(amount: number): number {\n  if (amount <= 0) {\n    return 0;\n  }\n  return amount;\n}\n",
        "utf-8",
      );

      const idiomRegexRes = await generateContext(ledgerFile, {
        projectRoot: tmp,
        idioms: true,
        symbol: "/\\$guardPositive/",
      });
      expect(idiomRegexRes.targetContent).toContain("$guardPositive");

      for (let i = 0; i < 10; i++) {
        fs.writeFileSync(
          path.join(tmp, `mod_${i}.ts`),
          `export class Service${i} {\n  run(x: number): number { return x + ${i}; }\n  stop(): void {}\n}\n`,
          "utf-8",
        );
      }
      const wildcardDir = await generateWorkspaceContext(tmp, { symbol: "*" });
      expect(wildcardDir.formattedBundle.length).toBeLessThan(4096);
      expect(wildcardDir.formattedBundle).toContain("Service0");
      expect(wildcardDir.formattedBundle).toContain("Service9");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
