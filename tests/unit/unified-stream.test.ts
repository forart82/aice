import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AiceMcpServer, type McpToolCallResult } from "../../src/mcp/server.js";
import { MANDATORY_AGENT_RULES_MARKDOWN } from "../../src/rules/mandatory-rules.js";
import {
  extractImportsFromFile,
  generateContext,
  generateMultiContext,
  parseTargetWithInlineSymbol,
  resolveImportPath,
  splitContextTargets,
} from "../../src/tools/context.js";
import { createFile, parseMultiFileCreateStream } from "../../src/tools/create.js";
import { parseMultiBlockSpliceStream, spliceBatch } from "../../src/tools/splice.js";
import { AICE_VERSION } from "../../src/version.js";

const CLI_ENTRY = path.resolve(process.cwd(), "bin/aice.ts");
const TSX_BIN = path.resolve(process.cwd(), "node_modules/.bin/tsx");

function runCli(args: string[], cwd: string, stdinInput?: string) {
  return spawnSync(TSX_BIN, [CLI_ENTRY, ...args], {
    cwd,
    input: stdinInput,
    encoding: "utf-8",
    env: { ...process.env },
  });
}

describe("AICE v0.9.23 Unified Multi-File Stream Engine & AIPL Dependency Bundler", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aice-v0923-stream-"));
    fs.writeFileSync(
      path.join(tmpDir, "aice.config.json"),
      JSON.stringify({ enabled: true, version: "0.9.23", idiomsEnabled: true }, null, 2),
      "utf-8",
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("Step 1: AIPL Import Extraction, Path Resolution & Downstream Callers", () => {
    it("parses single-line and multi-line AIPL import statements with accurate line spans and specifiers", () => {
      const aiplSource = [
        'import { Camera25D, projectIso } from "std/gfx25d/camera25d"',
        "import {",
        "  D2Model,",
        "  createD2Model,",
        "  stepD2Model",
        '} from "./world/d2_model"',
        'from "./world/d2_textures" import {',
        "  bakeD2Textures",
        "}",
        'import "./world/side_effect"',
        "import std.math.vec2",
        "",
        "pub fn main() -> int:",
        "  ret 0",
      ].join("\n");
      const imports = extractImportsFromFile("src/main.aipl", aiplSource);
      expect(imports.length).toBe(5);

      expect(imports[0]?.source).toBe("std/gfx25d/camera25d");
      expect(imports[0]?.specifiers.map((s) => s.name)).toEqual(["Camera25D", "projectIso"]);
      expect(imports[0]?.span.start.line).toBe(1);
      expect(imports[0]?.span.end.line).toBe(1);

      expect(imports[1]?.source).toBe("./world/d2_model");
      expect(imports[1]?.specifiers.map((s) => s.name)).toEqual([
        "D2Model",
        "createD2Model",
        "stepD2Model",
      ]);
      expect(imports[1]?.span.start.line).toBe(2);
      expect(imports[1]?.span.end.line).toBe(6);

      expect(imports[2]?.source).toBe("./world/d2_textures");
      expect(imports[2]?.specifiers.map((s) => s.name)).toEqual(["bakeD2Textures"]);
      expect(imports[2]?.span.start.line).toBe(7);
      expect(imports[2]?.span.end.line).toBe(9);

      expect(imports[3]?.source).toBe("./world/side_effect");
      expect(imports[3]?.span.start.line).toBe(10);
      expect(imports[3]?.span.end.line).toBe(10);

      expect(imports[4]?.source).toBe("std.math.vec2");
      expect(imports[4]?.span.start.line).toBe(11);
      expect(imports[4]?.span.end.line).toBe(11);
    });

    it("resolves .aipl, index.aipl, mod.aipl, and std/ standard library imports and tracks downstream callers", async () => {
      const stdDir = path.join(tmpDir, "std", "gfx25d");
      const worldDir = path.join(tmpDir, "src", "world");
      const pkgDir = path.join(tmpDir, "src", "pkg");
      fs.mkdirSync(stdDir, { recursive: true });
      fs.mkdirSync(worldDir, { recursive: true });
      fs.mkdirSync(pkgDir, { recursive: true });

      fs.writeFileSync(
        path.join(stdDir, "camera25d.aipl"),
        [
          "struct Camera25D(x: float, y: float, zoom: float)",
          "",
          "pub fn createCamera25D(x: float, y: float) -> Camera25D:",
          "  ret Camera25D(x, y, 1.0)",
        ].join("\n"),
        "utf-8",
      );

      fs.writeFileSync(
        path.join(worldDir, "d2_model.aipl"),
        [
          "struct DogState(hp: int, stamina: float)",
          "",
          "pub fn initDogState() -> DogState:",
          "  ret DogState(100, 50.0)",
        ].join("\n"),
        "utf-8",
      );

      fs.writeFileSync(
        path.join(worldDir, "d2_renderer.aipl"),
        [
          'import { DogState } from "./d2_model"',
          "",
          "pub fn renderD2Hud(state: DogState) -> str:",
          '  ret "HUD"',
        ].join("\n"),
        "utf-8",
      );

      fs.writeFileSync(
        path.join(pkgDir, "mod.aipl"),
        ["pub fn helperPkg() -> int:", "  ret 7"].join("\n"),
        "utf-8",
      );

      const mainAipl = path.join(tmpDir, "src", "main.aipl");
      fs.writeFileSync(
        mainAipl,
        [
          'import { Camera25D, createCamera25D } from "std/gfx25d/camera25d"',
          "import {",
          "  DogState,",
          "  initDogState",
          '} from "./world/d2_model"',
          'import { renderD2Hud } from "./world/d2_renderer"',
          'import { helperPkg } from "./pkg"',
          "",
          "pub fn main() -> int:",
          "  cam := createCamera25D(0.0, 0.0)",
          "  st := initDogState()",
          "  hud := renderD2Hud(st)",
          "  ret helperPkg()",
        ].join("\n"),
        "utf-8",
      );

      // Verify resolveImportPath directly
      expect(resolveImportPath("std/gfx25d/camera25d", mainAipl, tmpDir)).toBe(
        path.join(stdDir, "camera25d.aipl"),
      );
      expect(resolveImportPath("./world/d2_model", mainAipl, tmpDir)).toBe(
        path.join(worldDir, "d2_model.aipl"),
      );
      // Verify generateContext on main.aipl bundles local & std/ contracts
      const mainCtx = await generateContext(mainAipl, {
        symbol: "main",
        projectRoot: tmpDir,
      });
      expect(mainCtx.formattedBundle).toContain("# AICE Context Pack: src/main.aipl");
      expect(mainCtx.formattedBundle).toContain("std/gfx25d/camera25d");
      expect(mainCtx.formattedBundle).toContain("fn createCamera25D");
      expect(mainCtx.formattedBundle).toContain("struct Camera25D");
      expect(mainCtx.formattedBundle).toContain("./world/d2_model");
      expect(mainCtx.formattedBundle).toContain("fn initDogState");
      expect(mainCtx.formattedBundle).toContain("./world/d2_renderer");
      expect(mainCtx.formattedBundle).toContain("fn renderD2Hud");

      // Verify generateContext on d2_renderer.aipl reports src/main.aipl in Downstream Callers with call-site line
      const rendererCtx = await generateContext(path.join(worldDir, "d2_renderer.aipl"), {
        symbol: "renderD2Hud",
        projectRoot: tmpDir,
      });
      expect(rendererCtx.callers.length).toBe(1);
      expect(rendererCtx.callers[0]?.filePath).toBe("src/main.aipl");
      expect(rendererCtx.callers[0]?.callSiteLines).toContain(12);
      expect(rendererCtx.formattedBundle).toContain(
        "src/main.aipl imports: renderD2Hud (uses renderD2Hud at [L12])",
      );
    });

    it("verifies real aipl_dog main.aipl and d2_renderer.aipl context & callers when present on disk", async () => {
      const dogMain = "/home/forart/dev/aipl_dog/src/main.aipl";
      const dogRenderer = "/home/forart/dev/aipl_dog/src/world/d2_renderer.aipl";
      if (!fs.existsSync(dogMain) || !fs.existsSync(dogRenderer)) {
        return;
      }

      const mainCtx = await generateContext(dogMain, {
        symbol: "main",
        projectRoot: "/home/forart/dev/aipl_dog",
      });
      expect(mainCtx.formattedBundle).toContain("./world/d2_model");
      expect(mainCtx.formattedBundle).toContain("./world/d2_textures");
      expect(mainCtx.formattedBundle).toContain("./world/d2_renderer");
      expect(mainCtx.formattedBundle).toContain("std/gfx25d/camera25d");

      const hudCtx = await generateContext(dogRenderer, {
        symbol: "renderD2Hud",
        projectRoot: "/home/forart/dev/aipl_dog",
      });
      expect(hudCtx.formattedBundle).toContain("src/main.aipl imports:");
      expect(hudCtx.formattedBundle).toMatch(/uses renderD2Hud at \[L\d+\]/);
    });
  });

  describe("Step 2: Unified Mixed Create + Splice Stream & Single-Block Header Stripping", () => {
    it("parses mixed bare === file ===, :create, :overwrite, and :symbol headers in parseMultiBlockSpliceStream", () => {
      const stream = [
        "=== src/new_file.ts ===",
        "export const A = 1;",
        "=== src/created_explicit.ts:create ===",
        "export const B = 2;",
        "=== src/overwritten.ts:overwrite ===",
        "export const C = 3;",
        "=== src/existing.ts:Existing.run ===",
        "public run(): number { return 42; }",
      ].join("\n");

      const parsed = parseMultiBlockSpliceStream(stream);
      expect(parsed).not.toBeNull();
      expect(parsed?.batchItems?.length).toBe(4);
      expect(parsed?.batchItems?.[0]).toEqual({
        filePath: "src/new_file.ts",
        symbol: ":create",
        code: "export const A = 1;",
        create: true,
      });
      expect(parsed?.batchItems?.[1]).toEqual({
        filePath: "src/created_explicit.ts",
        symbol: "create",
        code: "export const B = 2;",
        create: true,
      });
      expect(parsed?.batchItems?.[2]).toEqual({
        filePath: "src/overwritten.ts",
        symbol: "overwrite",
        code: "export const C = 3;",
        create: true,
      });
      expect(parsed?.batchItems?.[3]).toEqual({
        filePath: "src/existing.ts",
        symbol: "Existing.run",
        code: "public run(): number { return 42; }",
        delete: undefined,
      });
    });

    it("executes mixed create + surgical splice in spliceBatch and rolls back all files atomically on error", async () => {
      const existingPath = path.join(tmpDir, "src", "board.ts");
      fs.mkdirSync(path.dirname(existingPath), { recursive: true });
      const initialBoard = [
        "export class Board {",
        "  public size(): number {",
        "    return 0;",
        "  }",
        "}",
        "",
      ].join("\n");
      fs.writeFileSync(existingPath, initialBoard, "utf-8");

      const newConstantsPath = path.join(tmpDir, "src", "constants.ts");
      const newThemePath = path.join(tmpDir, "src", "theme.css");

      const mixedStream = [
        "=== src/constants.ts ===",
        "export const GRID_SIZE = 64;",
        "=== src/theme.css:create ===",
        ".grid { display: grid; }",
        "=== src/board.ts:Board.size ===",
        "public size(): number {",
        "  return 64;",
        "}",
      ].join("\n");

      const batchRes = await spliceBatch(mixedStream, tmpDir);
      expect(batchRes.success).toBe(true);
      expect(batchRes.totalEdits).toBe(3);
      expect(fs.existsSync(newConstantsPath)).toBe(true);
      expect(fs.readFileSync(newConstantsPath, "utf-8")).toContain("export const GRID_SIZE = 64;");
      expect(fs.existsSync(newThemePath)).toBe(true);
      expect(fs.readFileSync(newThemePath, "utf-8")).toContain(".grid { display: grid; }");
      expect(fs.readFileSync(existingPath, "utf-8")).toContain("return 64;");

      // Now test atomic rollback across created, overwritten, and spliced files when a later block fails
      const rollbackNewPath = path.join(tmpDir, "src", "should_rollback.ts");
      const failingStream = [
        "=== src/should_rollback.ts ===",
        "export const TEMP = true;",
        "=== src/constants.ts:overwrite ===",
        "export const GRID_SIZE = 999;",
        "=== src/board.ts:NonExistentSymbol ===",
        "public broken(): void {}",
      ].join("\n");

      await expect(spliceBatch(failingStream, tmpDir)).rejects.toThrow();

      // Newly created file must be removed, overwritten file must be restored!
      expect(fs.existsSync(rollbackNewPath)).toBe(false);
      expect(fs.readFileSync(newConstantsPath, "utf-8")).toContain("export const GRID_SIZE = 64;");
    });

    it("strips single-block === <filePath> === header in createFile and CLI aice create <filePath> --stdin", async () => {
      const singlePath = path.join(tmpDir, "src", "single.ts");
      const res = await createFile(singlePath, {
        code: "=== src/single.ts ===\nexport const CLEAN = 123;\n",
        projectRoot: tmpDir,
      });
      expect(res.success).toBe(true);
      const written = fs.readFileSync(singlePath, "utf-8");
      expect(written).not.toContain("===");
      expect(written).toContain("export const CLEAN = 123;");

      // Test CLI `aice create <filePath> --stdin` with a single `=== <filePath> ===` header
      const cliSinglePath = path.join(tmpDir, "src", "cli_single.ts");
      const cliOut = runCli(
        ["create", "src/cli_single.ts", "--stdin"],
        tmpDir,
        "=== src/cli_single.ts ===\nexport const CLI_CLEAN = 456;\n",
      );
      expect(cliOut.status).toBe(0);
      const cliWritten = fs.readFileSync(cliSinglePath, "utf-8");
      expect(cliWritten).not.toContain("===");
      expect(cliWritten).toContain("export const CLI_CLEAN = 456;");
    });

    it("routes surgical === <filePath>:<symbol> === blocks passed to aice create --stdin into spliceBatch", () => {
      const targetPath = path.join(tmpDir, "src", "svc.ts");
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(
        targetPath,
        "export class Svc {\n  public ping(): string {\n    return 'old';\n  }\n}\n",
        "utf-8",
      );

      const streamInput = [
        "=== src/new_cfg.ts ===",
        "export const CFG_VER = 2;",
        "=== src/svc.ts:Svc.ping ===",
        "public ping(): string {",
        "  return 'new-pong';",
        "}",
      ].join("\n");

      expect(parseMultiFileCreateStream(streamInput)).toBeNull();

      const cliOut = runCli(["create", "--stdin"], tmpDir, streamInput);
      expect(cliOut.status).toBe(0);
      expect(fs.existsSync(path.join(tmpDir, "src", "new_cfg.ts"))).toBe(true);
      expect(fs.readFileSync(targetPath, "utf-8")).toContain("new-pong");
    });
  });

  describe("Step 3: True Multi-File aice context Stream (CLI & MCP) with Deduplicated Contracts", () => {
    it("merges and deduplicates Imported Dependency Contracts and Downstream Callers across multiple targets", async () => {
      const srcDir = path.join(tmpDir, "src");
      fs.mkdirSync(srcDir, { recursive: true });

      fs.writeFileSync(
        path.join(srcDir, "shared.ts"),
        "export interface Vec2 { x: number; y: number; }\nexport function addVec(a: Vec2, b: Vec2): Vec2 { return { x: a.x + b.x, y: a.y + b.y }; }\n",
        "utf-8",
      );

      fs.writeFileSync(
        path.join(srcDir, "a.ts"),
        'import { Vec2, addVec } from "./shared.js";\nexport function fnA(v: Vec2): Vec2 { return addVec(v, v); }\nexport function unusedA(): number { return 1; }\n',
        "utf-8",
      );

      fs.writeFileSync(
        path.join(srcDir, "b.ts"),
        'import { Vec2, addVec } from "./shared.js";\nexport function fnB(v: Vec2): Vec2 { return addVec(v, { x: 1, y: 1 }); }\n',
        "utf-8",
      );

      fs.writeFileSync(
        path.join(srcDir, "caller.ts"),
        'import { fnA } from "./a.js";\nimport { fnB } from "./b.js";\nexport function runAll(): void {\n  const r = fnA({ x: 1, y: 2 });\n  fnB(r);\n}\n',
        "utf-8",
      );

      expect(parseTargetWithInlineSymbol("src/a.ts:fnA", tmpDir)).toEqual({
        targetPath: "src/a.ts",
        inlineSymbol: "fnA",
      });

      // Single target keeps `# AICE Context Pack: ...`
      const singleCtx = await generateContext(path.join(srcDir, "a.ts"), {
        symbol: "fnA",
        projectRoot: tmpDir,
      });
      expect(singleCtx.formattedBundle).toContain("# AICE Context Pack: src/a.ts");

      // Multi-target emits `# AICE Multi-File Context Stream` with deduplicated `./shared.js`
      const multiCtx = await generateMultiContext(["src/a.ts:fnA", "src/b.ts:L1-L2"], {
        projectRoot: tmpDir,
      });
      expect(multiCtx.formattedBundle).toContain(
        "# AICE Multi-File Context Stream (2 targets: src/a.ts, src/b.ts)",
      );
      expect(multiCtx.dependencies.length).toBe(1);
      expect(multiCtx.dependencies[0]?.resolvedPath).toBe("src/shared.ts");
      const sharedMatches = multiCtx.formattedBundle.match(/### Dependency: `\.\//g) ?? [];
      expect(sharedMatches.length).toBe(1);
      expect(multiCtx.formattedBundle).toContain("### Target: `src/a.ts`");
      expect(multiCtx.formattedBundle).toContain("### Target: `src/b.ts`");
      expect(multiCtx.formattedBundle).toContain("## Downstream Callers");
      expect(multiCtx.formattedBundle).toContain("src/caller.ts");

      // CLI multi-target verification
      const cliOut = runCli(["context", "src/a.ts:fnA", "src/b.ts:L1-L2"], tmpDir);
      expect(cliOut.status).toBe(0);
      expect(cliOut.stdout).toContain("# AICE Multi-File Context Stream (2 targets: src/a.ts, src/b.ts)");

      // MCP `aice_context` with `paths: string[]` and space-separated `path`
      const server = new AiceMcpServer({ workspaceRoot: tmpDir });
      const mcpMultiPaths = (await server.handleRequest({
        jsonrpc: "2.0",
        id: 10,
        method: "tools/call",
        params: {
          name: "aice_context",
          arguments: {
            paths: ["src/a.ts:fnA", "src/b.ts:fnB"],
          },
        },
      })) as { result: McpToolCallResult };

      expect(mcpMultiPaths.result.isError).toBeFalsy();
      expect(mcpMultiPaths.result.content[0]?.text).toContain(
        "# AICE Multi-File Context Stream (2 targets: src/a.ts, src/b.ts)",
      );

      const mcpSpacePath = (await server.handleRequest({
        jsonrpc: "2.0",
        id: 12,
        method: "tools/call",
        params: {
          name: "aice_context",
          arguments: {
            path: "src/a.ts:fnA src/b.ts:fnB",
          },
        },
      })) as { result: McpToolCallResult };
      expect(mcpSpacePath.result.isError).toBeFalsy();
      expect(mcpSpacePath.result.content[0]?.text).toContain(
        "# AICE Multi-File Context Stream (2 targets: src/a.ts, src/b.ts)",
      );

      // MCP `aice_create` summary message matches clean CLI format
      const mcpCreateRes = (await server.handleRequest({
        jsonrpc: "2.0",
        id: 11,
        method: "tools/call",
        params: {
          name: "aice_create",
          arguments: {
            filePath: "src/clean_mcp.ts",
            code: "export const MCP_OK = true;\n",
          },
        },
      })) as { result: McpToolCallResult };

      expect(mcpCreateRes.result.isError).toBeFalsy();
      const summaryText = mcpCreateRes.result.content[0]?.text ?? "";
      expect(summaryText).toContain("✔ Created src/clean_mcp.ts");
      expect(summaryText).not.toContain("Native:");
      expect(summaryText).not.toContain("net saved: +0");
    });
  });

  describe("Step 4: Stream-First Mandatory Rules, Edge Cases & Version 0.9.24", () => {
    it("exports AICE_VERSION 0.9.24 and documents stream-first context and mixed splice in MANDATORY_AGENT_RULES_MARKDOWN", () => {
      expect(AICE_VERSION).toBe("0.9.24");
      expect(MANDATORY_AGENT_RULES_MARKDOWN).toContain("<!-- AICE:START v0.9.24 -->");
      expect(MANDATORY_AGENT_RULES_MARKDOWN).toContain("aice context f1:s1 f2:s2");
      expect(MANDATORY_AGENT_RULES_MARKDOWN).toContain("aice splice --stdin << 'EOF'");
    });
    it("handles AIPL block comments /* ... */, # line comments, and trailing semicolons in extractImportsFromFile", () => {
      const aiplPath = path.join(tmpDir, "src", "commented.aipl");
      fs.mkdirSync(path.dirname(aiplPath), { recursive: true });
      const aiplSource = [
        "import {",
        "  symA, # hash comment inside import",
        "  /* multi-line",
        "     block comment */ symB as aliasB,",
        "  symC /* inline block */",
        '} from "std/math";',
        'from "std/io" import { readAll, /* comment */ writeAll };',
        "import pkg.utils;",
      ].join("\n");
      fs.writeFileSync(aiplPath, aiplSource, "utf-8");

      const extracted = extractImportsFromFile(aiplPath);
      expect(extracted.length).toBe(3);
      expect(extracted[0]?.source).toBe("std/math");
      expect(extracted[0]?.span.start.line).toBe(1);
      expect(extracted[0]?.span.end.line).toBe(6);
      expect(extracted[0]?.specifiers.map((s) => ({ name: s.name, alias: s.alias }))).toEqual([
        { name: "symA", alias: undefined },
        { name: "symB", alias: "aliasB" },
        { name: "symC", alias: undefined },
      ]);
      expect(extracted[1]?.source).toBe("std/io");
      expect(extracted[1]?.specifiers.map((s) => s.name)).toEqual(["readAll", "writeAll"]);
      expect(extracted[2]?.source).toBe("pkg.utils");
    });

    it("handles splitContextTargets on markdown headings with Makefile, paths with spaces, and MCP single-file surgical create", async () => {
      fs.writeFileSync(path.join(tmpDir, "README.md"), "# Doc\n## Update Makefile\nRun make.\n", "utf-8");
      fs.writeFileSync(path.join(tmpDir, "Makefile"), "all:\n\techo ok\n", "utf-8");

      // Should NOT split `README.md:Update Makefile` into two targets even when `Makefile` exists in cwd
      expect(splitContextTargets("README.md:Update Makefile", tmpDir)).toEqual([
        "README.md:Update Makefile",
      ]);

      // Should NOT split `/tmp/.../my dir/file.ts:fnA` even when `/tmp/.../my` directory exists on disk
      fs.mkdirSync(path.join(tmpDir, "my"), { recursive: true });
      const spacedDir = path.join(tmpDir, "my dir");
      fs.mkdirSync(spacedDir, { recursive: true });
      const spacedFile = path.join(spacedDir, "file.ts");
      fs.writeFileSync(spacedFile, "export function fnA(): number { return 1; }\n", "utf-8");

      expect(splitContextTargets(`${spacedFile}:fnA`, tmpDir)).toEqual([`${spacedFile}:fnA`]);

      // Quoted paths with spaces should split cleanly into 2 unquoted targets
      const spacedFileB = path.join(spacedDir, "fileB.ts");
      fs.writeFileSync(spacedFileB, "export function fnB(): number { return 2; }\n", "utf-8");
      expect(splitContextTargets(`"${spacedFile}:fnA" "${spacedFileB}:fnB"`, tmpDir)).toEqual([
        `${spacedFile}:fnA`,
        `${spacedFileB}:fnB`,
      ]);

      // ClassName.markdown with >4 char method name matching extension must be treated as symbol edit when defaultFilePath is given
      const docEdit = parseMultiBlockSpliceStream(
        "=== Doc.markdown ===\npublic markdown(): string { return '# ok'; }",
        "src/doc.ts",
      );
      expect(docEdit?.singleFileEdits).toEqual([
        {
          symbol: "Doc.markdown",
          code: "public markdown(): string { return '# ok'; }",
          delete: undefined,
        },
      ]);

      // MCP aice_create with explicit filePath and single-file surgical `=== src/svc.ts:Svc.ping ===` routes to spliceBatch
      const svcPath = path.join(tmpDir, "src", "svc.ts");
      fs.mkdirSync(path.dirname(svcPath), { recursive: true });
      fs.writeFileSync(
        svcPath,
        "export class Svc {\n  public ping(): string {\n    return 'old';\n  }\n}\n",
        "utf-8",
      );
      const server = new AiceMcpServer({ workspaceRoot: tmpDir });
      const mcpSurgicalRes = (await server.handleRequest({
        jsonrpc: "2.0",
        id: 99,
        method: "tools/call",
        params: {
          name: "aice_create",
          arguments: {
            filePath: "src/svc.ts",
            code: "=== src/svc.ts:Svc.ping ===\npublic ping(): string {\n  return 'mcp-surgical-pong';\n}",
          },
        },
      })) as { result: McpToolCallResult };
      expect(mcpSurgicalRes.result.isError).toBeFalsy();
      expect(fs.readFileSync(svcPath, "utf-8")).toContain("mcp-surgical-pong");
      expect(fs.readFileSync(svcPath, "utf-8")).not.toContain("===");

      // MCP aice_create with filePath in subdirectory and bare `=== single.ts ===` header preserves subdirectory
      const mcpSubRes = (await server.handleRequest({
        jsonrpc: "2.0",
        id: 100,
        method: "tools/call",
        params: {
          name: "aice_create",
          arguments: {
            filePath: "src/sub/single.ts",
            code: "=== single.ts ===\nexport const SUB_OK = 77;\n",
          },
        },
      })) as { result: McpToolCallResult };
      expect(mcpSubRes.result.isError).toBeFalsy();
      const subFile = path.join(tmpDir, "src", "sub", "single.ts");
      expect(fs.existsSync(subFile)).toBe(true);
      expect(fs.readFileSync(subFile, "utf-8")).toContain("export const SUB_OK = 77;");
      expect(fs.readFileSync(subFile, "utf-8")).not.toContain("===");
    });
  });
});