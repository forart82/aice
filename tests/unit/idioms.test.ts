/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for AICE 2.0 Project Idiom Subsystem.
 */

import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { tokenize } from "../../src/core/lexer.js";
import { parse } from "../../src/core/parser.js";
import {
  mineProjectIdioms,
  expandModuleIdioms,
  expandAiceSourceIdioms,
  collapseAiceSourceIdioms,
  applyProjectIdiomsToDirectory,
  expandProjectIdiomsInDirectory,
  formatIdiomsMarkdownSection,
  type ProjectIdiomDefinition,
} from "../../src/idioms/index.js";
import { emitTarget } from "../../src/emitters/index.js";
import { check } from "../../src/typechecker/checker.js";
import {
  loadProjectConfig,
  saveProjectConfig,
  validateProjectConfig,
} from "../../src/config/project-config.js";
import { templateCache } from "../../src/idioms/idiom-transform.js";

describe("AICE 2.0 Project Idioms Subsystem", () => {
  describe("1. Core Lexer & Parser: $ Identifier Support", () => {
    it("scans $idiomName and $0 holes as IDENT tokens", () => {
      const code = "$guardOk($0, $1)";
      const tokens = tokenize(code);

      expect(tokens[0].kind).toBe("IDENT");
      expect(tokens[0].value).toBe("$guardOk");

      expect(tokens[1].kind).toBe("LPAREN");

      expect(tokens[2].kind).toBe("IDENT");
      expect(tokens[2].value).toBe("$0");

      expect(tokens[3].kind).toBe("COMMA");

      expect(tokens[4].kind).toBe("IDENT");
      expect(tokens[4].value).toBe("$1");

      expect(tokens[5].kind).toBe("RPAREN");
    });

    it("scans standalone $ as DOLLAR operator", () => {
      const tokens = tokenize("$ 123");
      expect(["DOLLAR", "IDENT"]).toContain(tokens[0].kind);
      expect(tokens[0].value).toBe("$");
    });

    it("parses $idiom call expressions into AST CallExpr with IdentifierExpr callee", () => {
      const code = "fn test():\n  $guardOk(status, 200)\n";
      const mod = parse(code);
      const fn = mod.items[0] as any;
      const stmt = fn.body.statements[0];

      expect(stmt.kind).toBe("ExprStmt");
      expect(stmt.expr.kind).toBe("CallExpr");
      expect(stmt.expr.callee.kind).toBe("IdentifierExpr");
      expect(stmt.expr.callee.name).toBe("$guardOk");
      expect(stmt.expr.args).toHaveLength(2);
      expect(stmt.expr.args[0].name).toBe("status");
      expect(stmt.expr.args[1].value).toBe(200);
    });
  });

  describe("2. Project Config: Idioms Schema & Serialization", () => {
    it("validates valid idiom definitions", () => {
      const idiom: ProjectIdiomDefinition = {
        name: "$guardOk",
        kind: "stmt",
        params: [{ name: "$0" }, { name: "$1" }],
        templateAice: "if res.status != $0: ret err($1)",
        occurrences: 5,
        tokensPerOccurrenceSaved: 8,
        netTokenSavings: 34,
      };

      expect(() => {
        validateProjectConfig({
          mode: "side-by-side",
          idioms: {
            $guardOk: idiom,
          },
        });
      }).not.toThrow();
    });

    it("throws on invalid idiom definitions", () => {
      expect(() => {
        validateProjectConfig({
          mode: "side-by-side",
          idioms: {
            // @ts-expect-error test invalid kind
            invalid: { name: "invalid", kind: "unknown", params: [] },
          },
        });
      }).toThrow(/Invalid idiom/);
    });

    it("loads, saves, and merges idioms in aice.config.json", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aice-idiom-cfg-"));
      try {
        const idiom: ProjectIdiomDefinition = {
          name: "$checkErr",
          kind: "stmt",
          params: [{ name: "$0" }],
          templateAice: "if err != nil: ret $0",
          occurrences: 4,
          tokensPerOccurrenceSaved: 6,
          netTokenSavings: 20,
        };

        saveProjectConfig(tmpDir, {
          mode: "side-by-side",
          idioms: { $checkErr: idiom },
        });

        const loaded = loadProjectConfig(tmpDir);
        expect(loaded.idioms).toBeDefined();
        expect(loaded.idioms?.$checkErr).toEqual(idiom);

        // Update with an additional idiom
        const idiom2: ProjectIdiomDefinition = {
          name: "$logInfo",
          kind: "expr",
          params: [{ name: "$0" }],
          templateAice: "logger.info($0)",
          occurrences: 10,
          tokensPerOccurrenceSaved: 5,
          netTokenSavings: 45,
        };

        saveProjectConfig(tmpDir, {
          idioms: {
            ...loaded.idioms,
            $logInfo: idiom2,
          },
        });

        const loaded2 = loadProjectConfig(tmpDir);
        expect(Object.keys(loaded2.idioms ?? {})).toHaveLength(2);
        expect(loaded2.idioms?.$checkErr.name).toBe("$checkErr");
        expect(loaded2.idioms?.$logInfo.name).toBe("$logInfo");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe("3. Idiom Miner: Repetitive Statements, Blocks, and Expressions", () => {
    it("mines repetitive multi-statement blocks with parameterized holes", () => {
      const file1 = `
module app.service1
fn handleA(ctx: any, req: any):
  if req.status != 200:
    logger.error("request failed: " + req.id)
    ret Result.err("request A failed")
  ret nil
`;
      const file2 = `
module app.service2
fn handleB(ctx: any, req: any):
  if req.status != 404:
    logger.error("request failed: " + req.id)
    ret Result.err("request B failed")
  ret nil
`;
      const file3 = `
module app.service3
fn handleC(ctx: any, req: any):
  if req.status != 500:
    logger.error("request failed: " + req.id)
    ret Result.err("request C failed")
  ret nil
`;

      const result = mineProjectIdioms(
        [
          { filePath: "s1.aice", source: file1 },
          { filePath: "s2.aice", source: file2 },
          { filePath: "s3.aice", source: file3 },
        ],
        {
          minOccurrences: 3,
          minNetTokenSavings: 1, // lowered threshold for unit test
        },
      );

      expect(result.candidatesEvaluated).toBeGreaterThan(0);
      const minedNames = Object.keys(result.idioms);
      expect(minedNames.length).toBeGreaterThan(0);

      const firstIdiom = result.idioms[minedNames[0]];
      expect(firstIdiom.name.startsWith("$")).toBe(true);
      expect(firstIdiom.occurrences).toBe(3);
      expect(firstIdiom.netTokenSavings).toBeGreaterThan(0);
      expect(firstIdiom.params.length).toBeGreaterThanOrEqual(1);
    });

    it("enforces strict BPE token gate and rejects non-saving short patterns", () => {
      // Repetitive tiny expression: x + 1 (takes more tokens to call $add(x) than raw x + 1)
      const tiny1 = "module t1\nfn f1(x:int): ret x + 1\n";
      const tiny2 = "module t2\nfn f2(y:int): ret y + 1\n";
      const tiny3 = "module t3\nfn f3(z:int): ret z + 1\n";

      const result = mineProjectIdioms(
        [
          { filePath: "t1.aice", source: tiny1 },
          { filePath: "t2.aice", source: tiny2 },
          { filePath: "t3.aice", source: tiny3 },
        ],
        {
          minOccurrences: 3,
          minNetTokenSavings: 10,
        },
      );

      // Tiny patterns should not pass token gate (or are filtered by >= 16 chars)
      expect(Object.keys(result.idioms).length).toBe(0);
    });

    it("mines alpha-normalized local variables across functions without creating hole parameters for internal variables", () => {
      const file1 = `
module app.worker1
fn runA(id: str):
  let tempA = fetch(id)
  logger.info("processing record: " + tempA)
  save(tempA)
  ret nil
`;
      const file2 = `
module app.worker2
fn runB(id: str):
  let tempB = fetch(id)
  logger.info("processing record: " + tempB)
  save(tempB)
  ret nil
`;
      const file3 = `
module app.worker3
fn runC(id: str):
  let tempC = fetch(id)
  logger.info("processing record: " + tempC)
  save(tempC)
  ret nil
`;

      const result = mineProjectIdioms(
        [
          { filePath: "w1.aice", source: file1 },
          { filePath: "w2.aice", source: file2 },
          { filePath: "w3.aice", source: file3 },
        ],
        {
          minOccurrences: 3,
          minNetTokenSavings: 1,
        },
      );

      const idiomKeys = Object.keys(result.idioms);
      expect(idiomKeys.length).toBeGreaterThan(0);
      const alphaIdiom = Object.values(result.idioms).find(
        (i) => i.kind === "block" && i.templateAice.includes("_loc0"),
      );
      expect(alphaIdiom!.templateAice).toMatch(/(_loc0\s*:=\s*fetch\(|let _loc0\s*=\s*fetch\()/);
      expect(alphaIdiom!.templateAice).toContain("save(_loc0)");
      // Only holes should be parameter, _loc0 must NOT be a param
      expect(alphaIdiom!.params.every((p) => p.name !== "_loc0")).toBe(true);
      expect(
        alphaIdiom!.params.every(
          (p) => p.name !== "tempA" && p.name !== "tempB" && p.name !== "tempC",
        ),
      ).toBe(true);
    });
  });

  describe("4. Idiom Transform: Expand & Collapse AST and Source", () => {
    const guardIdiom: ProjectIdiomDefinition = {
      name: "$guardStatus",
      kind: "stmt",
      params: [{ name: "$0" }, { name: "$1" }],
      templateAice: "if res.status != $0:\n  ret err($1)",
      occurrences: 3,
      tokensPerOccurrenceSaved: 8,
      netTokenSavings: 20,
    };

    it("collapses repetitive code into idiom calls in AICE source", () => {
      const source = `
module app.handler

fn handle():
  if res.status != 200:
    ret err("bad status")
  ret ok
`;
      const { aice, collapsedCount } = collapseAiceSourceIdioms(source, {
        $guardStatus: guardIdiom,
      });

      expect(collapsedCount).toBe(1);
      expect(aice).toContain('$guardStatus(200, "bad status")');
      expect(aice).not.toContain("if res.status != 200");
    });

    it("expands idiom calls back into canonical AICE code", () => {
      const source = `
module app.handler

fn handle():
  $guardStatus(404, "not found")
  ret ok
`;
      const { aice, expandedCount } = expandAiceSourceIdioms(source, {
        $guardStatus: guardIdiom,
      });

      expect(expandedCount).toBe(1);
      expect(aice).toContain("if res.status != 404:");
      expect(aice).toContain('ret err("not found")');
      expect(aice).not.toContain("$guardStatus");
    });

    it("collapses and expands compound expression idioms", () => {
      const exprIdiom: ProjectIdiomDefinition = {
        name: "$sendJson",
        kind: "expr",
        params: [{ name: "$0" }, { name: "$1" }],
        templateAice: "res.status($0).json($1)",
        occurrences: 4,
        tokensPerOccurrenceSaved: 7,
        netTokenSavings: 25,
      };

      const source = `
module app.api

fn respond():
  _ := res.status(200).json(payload)
`;
      const { aice: collapsed, collapsedCount } = collapseAiceSourceIdioms(source, {
        $sendJson: exprIdiom,
      });

      expect(collapsedCount).toBe(1);
      expect(collapsed).toContain("$sendJson(200, payload)");

      const { aice: expanded, expandedCount } = expandAiceSourceIdioms(collapsed, {
        $sendJson: exprIdiom,
      });

      expect(expandedCount).toBe(1);
      expect(expanded).toContain("res.status(200).json(payload)");
    });

    it("respects outer-scope escape safety: variable referenced after window is NOT collapsed", () => {
      const blockIdiom: ProjectIdiomDefinition = {
        name: "$fetchAndSave",
        kind: "block",
        params: [{ name: "$0" }],
        templateAice:
          'let _loc0 = fetch($0)\nlogger.info("processing record: " + _loc0)\nsave(_loc0)',
        occurrences: 3,
        tokensPerOccurrenceSaved: 10,
        netTokenSavings: 30,
      };

      // In this function, tempVar escapes the window because it is returned after the 3 statements!
      const escapingSource = `
module app.safe
fn handleEscaping(id: str):
  let tempVar = fetch(id)
  logger.info("processing record: " + tempVar)
  save(tempVar)
  ret tempVar
`;

      const { collapsedCount: escapedCollapsed } = collapseAiceSourceIdioms(escapingSource, {
        $fetchAndSave: blockIdiom,
      });
      expect(escapedCollapsed).toBe(0);

      // In this function, tempVar does NOT escape the window!
      const nonEscapingSource = `
module app.safe
fn handleNonEscaping(id: str):
  let tempVar = fetch(id)
  logger.info("processing record: " + tempVar)
  save(tempVar)
  ret nil
`;

      const { collapsedCount: nonEscapedCollapsed, aice } = collapseAiceSourceIdioms(
        nonEscapingSource,
        {
          $fetchAndSave: blockIdiom,
        },
      );
      expect(nonEscapedCollapsed).toBe(1);
      expect(aice).toContain("$fetchAndSave(id)");
    });
  });

  describe("5. Typechecker & Emitter Integration", () => {
    const fetchIdiom: ProjectIdiomDefinition = {
      name: "$fetchData",
      kind: "expr",
      params: [{ name: "$0" }],
      templateAice: "fetch($0)",
      occurrences: 3,
      tokensPerOccurrenceSaved: 5,
      netTokenSavings: 15,
    };

    it("typechecks code containing idiom calls via expanded AST", () => {
      const code = `
module app.client

fn load(url: str):
  res := $fetchData(url)
`;
      const mod = parse(code);
      // TypeChecker should auto-expand $fetchData without errors
      expect(() => {
        check(mod, { idioms: { $fetchData: fetchIdiom } });
      }).not.toThrow();
    });

    it("emits valid target code (TypeScript) expanding idioms", () => {
      const code = `
module app.client

fn load(url: str):
  res := $fetchData(url)
`;
      const mod = parse(code);
      const emittedTs = emitTarget(mod, "typescript", {
        idioms: { $fetchData: fetchIdiom },
      });

      expect(emittedTs).toContain("fetch(url)");
      expect(emittedTs).not.toContain("$fetchData");
    });

    it("expands multiple block idiom calls within the same block with disambiguated bindings and typechecks + emits cleanly", () => {
      const calcIdiom: ProjectIdiomDefinition = {
        name: "$computeAndLog",
        kind: "block",
        params: [{ name: "$0" }],
        templateAice: "let _loc0 = $0 * 2\nlogValue(_loc0)",
        occurrences: 4,
        tokensPerOccurrenceSaved: 8,
        netTokenSavings: 30,
      };

      const source = `
module app.pipeline

fn logValue(val: int):
  ret

fn run():
  $computeAndLog(10)
  $computeAndLog(20)
  $computeAndLog(30)
`;

      const mod = parse(source);
      const expandedMod = expandModuleIdioms(mod, { $computeAndLog: calcIdiom });

      // Check the function body has disambiguated local variable names
      const fn = expandedMod.items[1] as any;
      const stmts = fn.body.statements;
      // 3 calls * 2 statements each = 6 statements
      expect(stmts).toHaveLength(6);
      expect(stmts[0].kind).toBe("LetBinding");
      expect(stmts[0].name).toBe("_loc0");
      expect(stmts[2].kind).toBe("LetBinding");
      expect(stmts[2].name).toBe("_loc0_2");
      expect(stmts[4].kind).toBe("LetBinding");
      expect(stmts[4].name).toBe("_loc0_3");

      // Verify typechecking passes without duplicate identifier errors
      expect(() => {
        check(mod, { idioms: { $computeAndLog: calcIdiom } });
      }).not.toThrow();

      // Verify emitter produces valid TypeScript containing all disambiguated identifiers
      const emittedTs = emitTarget(mod, "typescript", {
        idioms: { $computeAndLog: calcIdiom },
      });
      expect(emittedTs).toContain("_loc0");
      expect(emittedTs).toContain("_loc0_2");
      expect(emittedTs).toContain("_loc0_3");
      expect(emittedTs).not.toContain("$computeAndLog");
    });
  });

  describe("6. Workspace Application & Markdown Documentation", () => {
    it("formats markdown documentation section for active idioms", () => {
      const idioms: Record<string, ProjectIdiomDefinition> = {
        $guard: {
          name: "$guard",
          kind: "stmt",
          params: [{ name: "$0" }],
          templateAice: "if err != nil: ret $0",
          occurrences: 5,
          tokensPerOccurrenceSaved: 7,
          netTokenSavings: 30,
        },
      };

      const md = formatIdiomsMarkdownSection(idioms);
      expect(md).toContain("### Active Project Idioms");
      expect(md).toContain("`$guard($0)`");
      expect(md).toContain("saves ~7 tokens/use");
    });

    it("applies project idioms to workspace directory and collapses files", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aice-ws-idioms-"));
      const srcDir = path.join(tmpDir, "src");
      fs.mkdirSync(srcDir, { recursive: true });

      try {
        saveProjectConfig(tmpDir, {
          mode: "side-by-side",
          sourceDir: "src",
        });

        const template = (status: number, msg: string) => `
module app.h${status}

fn handle():
  if res.status != ${status}:
    logger.error("failed status: " + res.status)
    ret err("${msg}")
  ret nil
`;
        fs.writeFileSync(path.join(srcDir, "h1.aice"), template(200, "status 200"), "utf-8");
        fs.writeFileSync(path.join(srcDir, "h2.aice"), template(404, "status 404"), "utf-8");
        fs.writeFileSync(path.join(srcDir, "h3.aice"), template(500, "status 500"), "utf-8");

        const result = applyProjectIdiomsToDirectory(tmpDir, {
          minOccurrences: 3,
          minNetTokenSavings: 1,
        });

        expect(result.modifiedFiles.length).toBe(3);
        expect(result.totalCollapsedCalls).toBe(3);

        // Check that files on disk now contain the idiom call
        const fileContent = fs.readFileSync(path.join(srcDir, "h1.aice"), "utf-8");
        const idiomName = Object.keys(result.idioms)[0];
        expect(fileContent).toContain(idiomName);

        // Test expanding idioms back in directory
        const expandResult = expandProjectIdiomsInDirectory(tmpDir);
        expect(expandResult.expandedFiles).toBe(3);
        expect(expandResult.expandedCalls).toBe(3);

        const restoredContent = fs.readFileSync(path.join(srcDir, "h1.aice"), "utf-8");
        expect(restoredContent).toContain("if res.status != 200:");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe("7. Deep Audit Fixes & Regressions", () => {
    it("expands nested expressions and block idioms with recursion protection", () => {
      const idioms: Record<string, ProjectIdiomDefinition> = {
        $add: {
          name: "$add",
          kind: "expr",
          params: [
            { name: "$0", type: "int" },
            { name: "$1", type: "int" },
          ],
          templateAice: "$0 + $1",
          description: "adds two numbers",
          tokensPerOccurrenceSaved: 2,
          netTokenSavings: 2,
          occurrences: 1,
        },
        $add3: {
          name: "$add3",
          kind: "expr",
          params: [
            { name: "$0", type: "int" },
            { name: "$1", type: "int" },
            { name: "$2", type: "int" },
          ],
          templateAice: "$add($0, $add($1, $2))",
          description: "adds three numbers via nested idiom",
          tokensPerOccurrenceSaved: 4,
          netTokenSavings: 4,
          occurrences: 1,
        },
        $nestedStmt: {
          name: "$nestedStmt",
          kind: "stmt",
          params: [
            { name: "$0", type: "int" },
            { name: "$1", type: "int" },
            { name: "$2", type: "int" },
          ],
          templateAice: "let sum = $add3($0, $1, $2)",
          description: "stmt calling nested expr idiom",
          tokensPerOccurrenceSaved: 6,
          netTokenSavings: 6,
          occurrences: 1,
        },
        $cycleA: {
          name: "$cycleA",
          kind: "expr",
          params: [{ name: "$0", type: "int" }],
          templateAice: "$cycleB($0)",
          description: "cyclical A",
          tokensPerOccurrenceSaved: 1,
          netTokenSavings: 1,
          occurrences: 1,
        },
        $cycleB: {
          name: "$cycleB",
          kind: "expr",
          params: [{ name: "$0", type: "int" }],
          templateAice: "$cycleA($0)",
          description: "cyclical B",
          tokensPerOccurrenceSaved: 1,
          netTokenSavings: 1,
          occurrences: 1,
        },
      };

      const code = "module test\n\nfn test():\n  $nestedStmt(10, 20, 30)\n";
      const { aice } = expandAiceSourceIdioms(code, idioms);
      expect(aice).toContain("sum :=");
      expect(aice).toContain("10 + (20 + 30)");

      // Cycle protection test: terminates cleanly at depth limit without crashing
      const cycleCode = "module test\n\nfn cycle():\n  let val = $cycleA(42)\n";
      expect(() => expandAiceSourceIdioms(cycleCode, idioms)).not.toThrow();
    });

    it("supports PostfixTryExpr and IndexExpr inside idioms and respects escape analysis", () => {
      const idioms: Record<string, ProjectIdiomDefinition> = {
        $tryLookup: {
          name: "$tryLookup",
          kind: "expr",
          params: [
            { name: "$0", type: "any" },
            { name: "$1", type: "int" },
          ],
          templateAice: "fetchItem($0)?[ $1 ]",
          description: "fetch then index with try unwrap",
          tokensPerOccurrenceSaved: 4,
          netTokenSavings: 4,
          occurrences: 1,
        },
      };

      const code = "module test\n\nfn test():\n  let item = $tryLookup(target, 0)\n";
      const { aice } = expandAiceSourceIdioms(code, idioms);
      expect(aice).toContain("fetchItem(target)?[0]");

      // Idiom miner supports AST with PostfixTryExpr and IndexExpr
      const inputs = [
        {
          filePath: "f1.aice",
          source: "module f1\nfn run():\n  let item = fetchItem(a)?[0]\n  log(item)\n",
        },
        {
          filePath: "f2.aice",
          source: "module f2\nfn run2():\n  let item = fetchItem(b)?[0]\n  log(item)\n",
        },
      ];
      expect(() =>
        mineProjectIdioms(inputs, { minOccurrences: 2, minNetTokenSavings: 0 }),
      ).not.toThrow();
    });

    it("preserves exposed non-internal variables while disambiguating internal _loc variables", () => {
      const idioms: Record<string, ProjectIdiomDefinition> = {
        $calcWithExposed: {
          name: "$calcWithExposed",
          kind: "block",
          params: [{ name: "$0", type: "int" }],
          templateAice: "let _loc0 = compute($0)\nlet out = _loc0 * 2",
          description: "block idiom exposing out",
          tokensPerOccurrenceSaved: 10,
          netTokenSavings: 10,
          occurrences: 2,
        },
      };

      // 1. When out is referenced downstream, it is not renamed to out_2
      const code1 = "module test\n\nfn test():\n  $calcWithExposed(10)\n  let finalVal = out + 5\n";
      const { aice: aice1 } = expandAiceSourceIdioms(code1, idioms);
      expect(aice1).toContain("out := _loc0 * 2");
      expect(aice1).not.toContain("out_2");

      // 2. When called multiple times, internal _loc0 is disambiguated to _loc0_2
      const code2 = "module test\n\nfn test():\n  $calcWithExposed(10)\n  $calcWithExposed(20)\n";
      const { aice: aice2 } = expandAiceSourceIdioms(code2, idioms);
      expect(aice2).toContain("_loc0_2");
    });

    it("enforces multi-statement full span coverage and re-checks token gate after greedy non-overlapping selection", () => {
      const inputs = [
        {
          filePath: "m1.aice",
          source: `module m1
fn worker1():
  let x = fetch(1)
  logger.info(x)
  save(x)
  ret nil
`,
        },
        {
          filePath: "m2.aice",
          source: `module m2
fn worker2():
  let x = fetch(2)
  logger.info(x)
  save(x)
  ret nil
`,
        },
        {
          filePath: "m3.aice",
          source: `module m3
fn worker3():
  let x = fetch(3)
  logger.info(x)
  save(x)
  ret nil
`,
        },
      ];
      const result = mineProjectIdioms(inputs, { minOccurrences: 3, minNetTokenSavings: 1 });
      const minedKeys = Object.keys(result.idioms);
      expect(minedKeys.length).toBeGreaterThan(0);

      // Verify that collapsing multi-statement window replaces entire span cleanly
      const { aice, collapsedCount } = collapseAiceSourceIdioms(inputs[0].source, result.idioms);
      expect(collapsedCount).toBeGreaterThanOrEqual(1);
      expect(aice).toContain(minedKeys[0]);
    });

    it("caps templateCache at 500 entries with FIFO/LRU eviction of oldest items", () => {
      templateCache.clear();
      expect(templateCache.size).toBe(0);

      for (let i = 0; i < 520; i++) {
        const defs: Record<string, ProjectIdiomDefinition> = {
          [`$dummy_${i}`]: {
            name: `$dummy_${i}`,
            kind: "expr",
            params: [{ name: "$0", type: "int" }],
            templateAice: `$0 + ${i}`,
            description: `dummy ${i}`,
            tokensPerOccurrenceSaved: 1,
            netTokenSavings: 1,
            occurrences: 1,
          },
        };
        expandAiceSourceIdioms(`fn f():\n  let x = $dummy_${i}(1)\n`, defs);
      }

      expect(templateCache.size).toBe(500);
      expect(templateCache.has("$dummy_0::expr::$0 + 0")).toBe(false);
      expect(templateCache.has("$dummy_519::expr::$0 + 519")).toBe(true);
    });
  });
});
