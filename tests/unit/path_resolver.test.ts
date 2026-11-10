/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Comprehensive Unit Tests for Step 23: Polymorphic Path Resolver across all CLI commands.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_IGNORED_SCAN_DIRECTORIES,
  isSameOrDescendant,
  PASSTHROUGH_FILENAMES,
  resolvePathTargets,
  scanDirectoryFiles,
} from "../../src/config/path-resolver.js";
import { saveProjectConfig } from "../../src/config/project-config.js";
import { generateContext } from "../../src/tools/context.js";
import { diffFiles } from "../../src/tools/diff-patch.js";
import { formatAicePath } from "../../src/tools/fmt.js";
import { outlinePath } from "../../src/tools/outline.js";

describe("Step 23: Polymorphic Path Resolver Engine", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aice-path-resolver-test-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  describe("1. Resolving Omitted or Empty Arguments", () => {
    it("resolves omitted argument to config.sourceDir when it exists", () => {
      const srcDir = path.join(tmpDir, "src");
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(
        path.join(srcDir, "math.aice"),
        "pub fn add(a: int, b: int) -> int:\n  ret a + b\n",
      );

      saveProjectConfig(tmpDir, {
        mode: "side-by-side",
        sourceDir: "src",
      });

      const res = resolvePathTargets(undefined, { projectRoot: tmpDir });

      expect(res.isOmitted).toBe(true);
      expect(res.isDirectory).toBe(true);
      expect(res.isSingleFile).toBe(false);
      expect(res.resolvedPath).toBe(srcDir);
      expect(res.projectRoot).toBe(tmpDir);
      expect(res.config.sourceDir).toBe("src");
      expect(res.files).toHaveLength(1);
      expect(res.files[0]).toBe(path.join(srcDir, "math.aice"));
    });

    it("resolves omitted argument to projectRoot when sourceDir does not exist on disk", () => {
      fs.writeFileSync(path.join(tmpDir, "root.aice"), "pub fn hello() -> str:\n  ret 'hello'\n");

      saveProjectConfig(tmpDir, {
        mode: "side-by-side",
        sourceDir: "non_existent_src",
      });

      const res = resolvePathTargets(undefined, { projectRoot: tmpDir });

      expect(res.isOmitted).toBe(true);
      expect(res.isDirectory).toBe(true);
      expect(res.isSingleFile).toBe(false);
      expect(res.resolvedPath).toBe(tmpDir);
      expect(res.files).toHaveLength(1);
      expect(res.files[0]).toBe(path.join(tmpDir, "root.aice"));
    });

    it("falls back to projectRoot files when sourceDir exists but contains no .aice files", () => {
      const srcDir = path.join(tmpDir, "src");
      fs.mkdirSync(srcDir, { recursive: true });
      // srcDir has no .aice files
      fs.writeFileSync(path.join(tmpDir, "main.aice"), "pub fn start():\n  ret nil\n");

      saveProjectConfig(tmpDir, {
        mode: "side-by-side",
        sourceDir: "src",
      });

      const res = resolvePathTargets(undefined, { projectRoot: tmpDir });

      expect(res.isOmitted).toBe(true);
      expect(res.isDirectory).toBe(true);
      expect(res.resolvedPath).toBe(tmpDir);
      expect(res.files).toHaveLength(1);
      expect(res.files[0]).toBe(path.join(tmpDir, "main.aice"));
    });

    it("treats empty string or whitespace as omitted argument", () => {
      const srcDir = path.join(tmpDir, "src");
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(path.join(srcDir, "demo.aice"), "pub fn demo():\n  ret 1\n");

      saveProjectConfig(tmpDir, { sourceDir: "src" });

      const resEmpty = resolvePathTargets("", { projectRoot: tmpDir });
      const resWhitespace = resolvePathTargets("   ", { projectRoot: tmpDir });

      expect(resEmpty.isOmitted).toBe(true);
      expect(resWhitespace.isOmitted).toBe(true);
      expect(resEmpty.files).toHaveLength(1);
      expect(resWhitespace.files).toHaveLength(1);
    });
  });

  describe("2. Resolving Single Files", () => {
    it("resolves single .aice file", () => {
      const filePath = path.join(tmpDir, "calc.aice");
      fs.writeFileSync(filePath, "pub fn calc():\n  ret 100\n");

      const res = resolvePathTargets(filePath, { projectRoot: tmpDir });

      expect(res.isSingleFile).toBe(true);
      expect(res.isDirectory).toBe(false);
      expect(res.isOmitted).toBe(false);
      expect(res.resolvedPath).toBe(filePath);
      expect(res.files).toEqual([filePath]);
      expect(res.projectRoot).toBe(tmpDir);
    });

    it("resolves single target file (e.g. .ts, .tsx, .py)", () => {
      const tsPath = path.join(tmpDir, "helper.ts");
      fs.writeFileSync(tsPath, "export function helper() { return 42; }");

      const res = resolvePathTargets(tsPath, { projectRoot: tmpDir });

      expect(res.isSingleFile).toBe(true);
      expect(res.isDirectory).toBe(false);
      expect(res.isOmitted).toBe(false);
      expect(res.resolvedPath).toBe(tsPath);
      expect(res.files).toEqual([tsPath]);
    });

    it("resolves dual-extension files (*.ts.aice, *.tsx.aice)", () => {
      const dualPath = path.join(tmpDir, "App.tsx.aice");
      fs.writeFileSync(dualPath, "pub fn App():\n  ret nil\n");

      const res = resolvePathTargets(dualPath, { projectRoot: tmpDir });

      expect(res.isSingleFile).toBe(true);
      expect(res.isDirectory).toBe(false);
      expect(res.files).toEqual([dualPath]);
    });

    it("marks non-existent file path with extension as single file target", () => {
      const missingPath = path.join(tmpDir, "missing.aice");
      const res = resolvePathTargets(missingPath, { projectRoot: tmpDir });

      expect(res.isSingleFile).toBe(true);
      expect(res.isDirectory).toBe(false);
      expect(res.resolvedPath).toBe(missingPath);
      expect(res.files).toEqual([missingPath]);
    });
  });

  describe("3. Resolving Directory Recursively & Filtering", () => {
    it("recursively traverses nested directories and collects .aice files", () => {
      const sub1 = path.join(tmpDir, "sub1");
      const sub2 = path.join(sub1, "sub2");
      fs.mkdirSync(sub2, { recursive: true });

      fs.writeFileSync(path.join(tmpDir, "root.aice"), "fn r(): ret 0");
      fs.writeFileSync(path.join(sub1, "level1.aice"), "fn l1(): ret 1");
      fs.writeFileSync(path.join(sub2, "level2.aice"), "fn l2(): ret 2");

      const res = resolvePathTargets(tmpDir, { projectRoot: tmpDir });

      expect(res.isDirectory).toBe(true);
      expect(res.isSingleFile).toBe(false);
      expect(res.files).toHaveLength(3);
      expect(res.files).toContain(path.join(tmpDir, "root.aice"));
      expect(res.files).toContain(path.join(sub1, "level1.aice"));
      expect(res.files).toContain(path.join(sub2, "level2.aice"));
    });

    it("strictly excludes node_modules, .git, dist, build, .aice-build, and .agents directories", () => {
      const ignoredDirs = [
        "node_modules",
        ".git",
        "dist",
        "build",
        ".aice-build",
        ".agents",
        ".next",
        ".turbo",
        "coverage",
      ];

      for (const d of ignoredDirs) {
        const ignoredPath = path.join(tmpDir, d);
        fs.mkdirSync(ignoredPath, { recursive: true });
        fs.writeFileSync(path.join(ignoredPath, "ignored.aice"), "fn ignored(): ret nil");
      }

      const validDir = path.join(tmpDir, "src");
      fs.mkdirSync(validDir, { recursive: true });
      fs.writeFileSync(path.join(validDir, "valid.aice"), "fn valid(): ret 1");

      const res = resolvePathTargets(tmpDir, { projectRoot: tmpDir });

      expect(res.files).toHaveLength(1);
      expect(res.files[0]).toBe(path.join(validDir, "valid.aice"));
    });

    it("ignores .trivia.json and .aice.trivia.json files", () => {
      const srcDir = path.join(tmpDir, "src");
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(path.join(srcDir, "valid.aice"), "fn v(): ret 1");
      fs.writeFileSync(path.join(srcDir, "valid.trivia.json"), '{"trivia":[]}');
      fs.writeFileSync(path.join(srcDir, "valid.aice.trivia.json"), '{"trivia":[]}');

      const res = resolvePathTargets(srcDir, { projectRoot: tmpDir });

      expect(res.files).toHaveLength(1);
      expect(res.files[0]).toBe(path.join(srcDir, "valid.aice"));
    });

    it("includes target files when includeTargets is true and no .aice files exist", () => {
      const srcDir = path.join(tmpDir, "src");
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(path.join(srcDir, "app.ts"), "export const a = 1;");
      fs.writeFileSync(path.join(srcDir, "component.tsx"), "export const C = () => null;");
      fs.writeFileSync(path.join(srcDir, "script.py"), "def run(): pass");
      fs.writeFileSync(path.join(srcDir, "notes.txt"), "some notes");

      const res = resolvePathTargets(srcDir, {
        includeTargets: true,
        projectRoot: tmpDir,
      });

      expect(res.files).toHaveLength(3);
      expect(res.files).toContain(path.join(srcDir, "app.ts"));
      expect(res.files).toContain(path.join(srcDir, "component.tsx"));
      expect(res.files).toContain(path.join(srcDir, "script.py"));
      expect(res.files).not.toContain(path.join(srcDir, "notes.txt"));
    });

    it("prioritizes .aice files over target files even when includeTargets is true", () => {
      const srcDir = path.join(tmpDir, "src");
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(path.join(srcDir, "app.aice"), "pub fn a(): ret 1");
      fs.writeFileSync(path.join(srcDir, "app.ts"), "export const a = 1;");

      const res = resolvePathTargets(srcDir, {
        includeTargets: true,
        projectRoot: tmpDir,
      });

      expect(res.files).toHaveLength(1);
      expect(res.files[0]).toBe(path.join(srcDir, "app.aice"));
    });

    it("supports custom file extensions filtering", () => {
      const srcDir = path.join(tmpDir, "src");
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(path.join(srcDir, "a.ts.aice"), "fn a(): ret 1");
      fs.writeFileSync(path.join(srcDir, "b.py.aice"), "fn b(): ret 2");
      fs.writeFileSync(path.join(srcDir, "c.aice"), "fn c(): ret 3");

      const res = resolvePathTargets(srcDir, {
        extensions: [".ts.aice"],
        projectRoot: tmpDir,
      });

      expect(res.files).toHaveLength(1);
      expect(res.files[0]).toBe(path.join(srcDir, "a.ts.aice"));
    });
  });

  describe("4. Resolving Across Project Modes (Side-by-Side vs Isolated)", () => {
    it("resolves correctly in side-by-side mode", () => {
      saveProjectConfig(tmpDir, {
        mode: "side-by-side",
        sourceDir: "src",
      });

      const srcDir = path.join(tmpDir, "src");
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(
        path.join(srcDir, "math.ts.aice"),
        "pub fn add(a: int, b: int) -> int:\n  ret a + b\n",
      );

      const res = resolvePathTargets(undefined, { projectRoot: tmpDir });

      expect(res.config.mode).toBe("side-by-side");
      expect(res.config.isolated).toBe(false);
      expect(res.files).toHaveLength(1);
      expect(res.files[0]).toBe(path.join(srcDir, "math.ts.aice"));
    });

    it("resolves correctly in isolated mode and ignores custom outDir", () => {
      const customOut = ".my-build-artifacts";
      saveProjectConfig(tmpDir, {
        mode: "isolated",
        sourceDir: "src",
        outDir: customOut,
      });

      const srcDir = path.join(tmpDir, "src");
      const outDir = path.join(tmpDir, customOut);
      fs.mkdirSync(srcDir, { recursive: true });
      fs.mkdirSync(outDir, { recursive: true });

      fs.writeFileSync(path.join(srcDir, "index.aice"), "pub fn main(): ret nil");
      fs.writeFileSync(path.join(outDir, "emitted.ts"), "export const x = 1;");
      fs.writeFileSync(path.join(outDir, "leaked.aice"), "fn leaked(): ret nil");

      const res = resolvePathTargets(undefined, { projectRoot: tmpDir });

      expect(res.config.mode).toBe("isolated");
      expect(res.config.isolated).toBe(true);
      expect(res.config.outDir).toBe(customOut);
      expect(res.files).toHaveLength(1);
      expect(res.files[0]).toBe(path.join(srcDir, "index.aice"));
    });
  });

  describe("5. CLI Tooling Integration with Polymorphic Arguments", () => {
    it("outlinePath accepts directory or single file seamlessly", async () => {
      const srcDir = path.join(tmpDir, "src");
      fs.mkdirSync(srcDir, { recursive: true });
      const f1 = path.join(srcDir, "f1.aice");
      const f2 = path.join(srcDir, "f2.aice");
      fs.writeFileSync(f1, "pub fn f1() -> int:\n  ret 1\n");
      fs.writeFileSync(f2, "pub fn f2() -> int:\n  ret 2\n");

      // Single file outline
      const singleRes = await outlinePath(f1);
      expect(singleRes).not.toBeInstanceOf(Map);
      if (!(singleRes instanceof Map)) {
        expect(singleRes.text).toContain("pub fn f1() -> int: ...");
      }

      // Directory outline
      const dirRes = await outlinePath(srcDir);
      expect(dirRes).toBeInstanceOf(Map);
      if (dirRes instanceof Map) {
        expect(dirRes.size).toBe(2);
      }
    });

    it("formatAicePath formats directory recursively or single file", async () => {
      const srcDir = path.join(tmpDir, "src");
      fs.mkdirSync(srcDir, { recursive: true });
      const f1 = path.join(srcDir, "unformatted1.aice");
      const f2 = path.join(srcDir, "unformatted2.aice");
      fs.writeFileSync(f1, "fn a(  x : int )->int:\n ret x\n");
      fs.writeFileSync(f2, "fn b(  y : int )->int:\n ret y\n");

      const results = await formatAicePath(srcDir, { write: true });
      expect(Array.isArray(results)).toBe(true);
      if (Array.isArray(results)) {
        expect(results).toHaveLength(2);
        for (const r of results) {
          expect(r.isFormatted).toBe(false);
          expect(fs.readFileSync(r.filePath, "utf-8")).toContain("fn ");
        }
      }
    });

    it("diffFiles operates cleanly on single file or directory", async () => {
      const f1 = path.join(tmpDir, "orig.aice");
      const f2 = path.join(tmpDir, "modified.aice");
      fs.writeFileSync(f1, "pub fn calculate():\n  ret 1\n");
      fs.writeFileSync(f2, "pub fn calculate():\n  ret 2\n");

      const diffRes = await diffFiles(f1, f2);
      expect(diffRes.changes).toHaveLength(1);
      expect(diffRes.changes[0].name).toBe("calculate");
      expect(diffRes.changes[0].change).toBe("modified");
      expect(diffRes.unifiedDiff).toContain("-  ret 1");
      expect(diffRes.unifiedDiff).toContain("+  ret 2");
    });

    it("generateContext packages workspace overview when target is omitted or directory", async () => {
      const srcDir = path.join(tmpDir, "src");
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(path.join(srcDir, "util.aice"), "pub fn utilHelper() -> int:\n  ret 42\n");
      fs.writeFileSync(
        path.join(srcDir, "main.aice"),
        'from "./util" import { utilHelper }\npub fn start():\n  ret utilHelper()\n',
      );

      saveProjectConfig(tmpDir, {
        mode: "side-by-side",
        sourceDir: "src",
      });

      // Pass undefined to generateContext
      const wsContext = await generateContext(undefined, { projectRoot: tmpDir });

      expect(wsContext.formattedBundle).toContain("# AICE Workspace Overview Context Pack:");
      expect(wsContext.formattedBundle).toContain("## Project Configuration:");
      expect(wsContext.formattedBundle).toContain("## Workspace Files (2):");
      expect(wsContext.formattedBundle).toContain("util.aice");
      expect(wsContext.formattedBundle).toContain("main.aice");
      expect(wsContext.formattedBundle).toContain("## Module Outlines:");
      expect(wsContext.formattedBundle).toContain("pub fn utilHelper() -> int: ...");
      expect(wsContext.tokenCount).toBeGreaterThan(0);

      // Pass directory to generateContext
      const dirContext = await generateContext(srcDir, { projectRoot: tmpDir });
      expect(dirContext.formattedBundle).toContain("# AICE Workspace Overview Context Pack:");
      expect(dirContext.tokenCount).toBeGreaterThan(0);
    });

    it("DEFAULT_IGNORED_SCAN_DIRECTORIES contains all standard build & metadata folders", () => {
      expect(DEFAULT_IGNORED_SCAN_DIRECTORIES.has("node_modules")).toBe(true);
      expect(DEFAULT_IGNORED_SCAN_DIRECTORIES.has(".git")).toBe(true);
      expect(DEFAULT_IGNORED_SCAN_DIRECTORIES.has("dist")).toBe(true);
      expect(DEFAULT_IGNORED_SCAN_DIRECTORIES.has("build")).toBe(true);
      expect(DEFAULT_IGNORED_SCAN_DIRECTORIES.has(".aice-build")).toBe(true);
      expect(DEFAULT_IGNORED_SCAN_DIRECTORIES.has(".aice-cache")).toBe(true);
      expect(DEFAULT_IGNORED_SCAN_DIRECTORIES.has(".agents")).toBe(true);
      expect(DEFAULT_IGNORED_SCAN_DIRECTORIES.has(".next")).toBe(true);
      expect(DEFAULT_IGNORED_SCAN_DIRECTORIES.has(".turbo")).toBe(true);
      expect(DEFAULT_IGNORED_SCAN_DIRECTORIES.has("coverage")).toBe(true);
    });
  });

  describe("6. End-to-End CLI Execution Testing with Polymorphic Arguments", () => {
    const cliPath = path.resolve(process.cwd(), "bin/aice.ts");
    const tsxBin = path.resolve(process.cwd(), "node_modules/.bin/tsx");

    function runCli(args: string[], cwd: string) {
      return spawnSync(tsxBin, [cliPath, ...args], {
        cwd,
        encoding: "utf-8",
        timeout: 60000,
        stdio: ["ignore", "pipe", "pipe"],
      });
    }
    it("compile: compiles all files when target is omitted", () => {
      const srcDir = path.join(tmpDir, "src");
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(path.join(srcDir, "a.aice"), "pub fn a() -> int:\n  ret 1\n");
      fs.writeFileSync(path.join(srcDir, "b.aice"), "pub fn b() -> int:\n  ret 2\n");
      saveProjectConfig(tmpDir, { mode: "side-by-side", sourceDir: "src" });

      const res = runCli(["compile"], tmpDir);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("✔ Compiled");
      expect(fs.existsSync(path.join(srcDir, "a.ts"))).toBe(true);
      expect(fs.existsSync(path.join(srcDir, "b.ts"))).toBe(true);
    });

    it("compile: compiles a single file when single file target is provided", () => {
      const srcDir = path.join(tmpDir, "src");
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(path.join(srcDir, "single.aice"), "pub fn s() -> int:\n  ret 42\n");
      fs.writeFileSync(path.join(srcDir, "other.aice"), "pub fn o() -> int:\n  ret 99\n");
      saveProjectConfig(tmpDir, { mode: "side-by-side", sourceDir: "src" });

      const res = runCli(["compile", "src/single.aice"], tmpDir);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("✔ Compiled src/single.aice");
      expect(fs.existsSync(path.join(srcDir, "single.ts"))).toBe(true);
      expect(fs.existsSync(path.join(srcDir, "other.ts"))).toBe(false);
    });

    it("compile: compiles a directory when directory target is provided", () => {
      const srcDir = path.join(tmpDir, "src");
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(path.join(srcDir, "d1.aice"), "pub fn d1(): ret nil");
      saveProjectConfig(tmpDir, { mode: "side-by-side", sourceDir: "src" });

      const res = runCli(["compile", "src"], tmpDir);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("✔ Compiled");
      expect(fs.existsSync(path.join(srcDir, "d1.ts"))).toBe(true);
    });

    it("compile-all: aliases compile with directory or default argument", () => {
      const srcDir = path.join(tmpDir, "src");
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(path.join(srcDir, "legacy.aice"), "pub fn legacy(): ret 0");
      saveProjectConfig(tmpDir, { mode: "side-by-side", sourceDir: "src" });

      const res = runCli(["compile-all"], tmpDir);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("✔ Compiled");
      expect(fs.existsSync(path.join(srcDir, "legacy.ts"))).toBe(true);
    });

    it("outline: outlines all files in sourceDir when target is omitted", () => {
      const srcDir = path.join(tmpDir, "src");
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(path.join(srcDir, "mod.aice"), "pub fn modFn() -> int:\n  ret 10\n");
      saveProjectConfig(tmpDir, { mode: "side-by-side", sourceDir: "src" });

      const res = runCli(["outline"], tmpDir);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("pub fn modFn() -> int: ...");
    });

    it("fmt: formats all .aice files in workspace when target is omitted", () => {
      const srcDir = path.join(tmpDir, "src");
      fs.mkdirSync(srcDir, { recursive: true });
      const badAice = path.join(srcDir, "bad.aice");
      fs.writeFileSync(badAice, "fn unformatted(  x : int )->int:\n ret x\n");
      saveProjectConfig(tmpDir, { mode: "side-by-side", sourceDir: "src" });

      const res = runCli(["fmt"], tmpDir);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("Formatted");
      const formatted = fs.readFileSync(badAice, "utf-8");
      expect(formatted).toContain("fn unformatted(x: int) -> int:\n  ret x");
    });

    it("context: packages workspace overview context when target is omitted", () => {
      const srcDir = path.join(tmpDir, "src");
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(path.join(srcDir, "comp.aice"), "pub fn comp(): ret 1");
      saveProjectConfig(tmpDir, { mode: "side-by-side", sourceDir: "src" });

      const res = runCli(["context"], tmpDir);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("# AICE Workspace Overview Context Pack:");
      expect(res.stdout).toContain("## Project Configuration:");
      expect(res.stdout).toContain("## Workspace Files (1):");
      expect(res.stdout).toContain("comp.aice");
    });
  });

  describe("7. Path Hierarchy & Symlink Cycle Protection", () => {
    it("isSameOrDescendant accurately determines path hierarchies", () => {
      const parent = path.join(tmpDir, "base");
      const child = path.join(tmpDir, "base/sub/file.ts");
      const sibling = path.join(tmpDir, "base-other/file.ts");

      expect(isSameOrDescendant(parent, parent)).toBe(true);
      expect(isSameOrDescendant(parent, child)).toBe(true);
      expect(isSameOrDescendant(parent, sibling)).toBe(false);
      expect(isSameOrDescendant(undefined, child)).toBe(false);
      expect(isSameOrDescendant("/", child)).toBe(false);
    });

    it("prevents recursive loop when cyclic symlink exists inside scanned directory", () => {
      const srcDir = path.join(tmpDir, "src");
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(path.join(srcDir, "valid.ts"), "export function valid() { return 1; }");

      try {
        const cyclePath = path.join(srcDir, "self_cycle");
        fs.symlinkSync(tmpDir, cyclePath, "dir");
      } catch {
        return;
      }

      const config = saveProjectConfig(tmpDir, { sourceDir: "src" });
      const files = scanDirectoryFiles(srcDir, { includeTargets: true }, config, tmpDir);

      expect(files).toEqual([path.join(srcDir, "valid.ts")]);
    });

    it("coexists .aice and unpaired native target files when includeTargets is true while deduplicating .aice twins", () => {
      const srcDir = path.join(tmpDir, "src");
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(path.join(srcDir, "paired.aice"), "pub fn p(): ret 1");
      fs.writeFileSync(path.join(srcDir, "paired.ts"), "export const p = () => 1;");
      fs.writeFileSync(path.join(srcDir, "unpaired.py"), "def u(): return 2\n");

      const res = resolvePathTargets(srcDir, { includeTargets: true, projectRoot: tmpDir });
      expect(res.files).toEqual([
        path.join(srcDir, "paired.aice"),
        path.join(srcDir, "unpaired.py"),
      ]);
    });

    it("includes nested metadata files unless excludeMetadata is true while skipping root metadata by default", () => {
      const pkgDir = path.join(tmpDir, "packages", "web");
      fs.mkdirSync(pkgDir, { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "package.json"), '{"name":"root"}');
      fs.writeFileSync(path.join(pkgDir, "package.json"), '{"name":"web"}');
      fs.writeFileSync(path.join(pkgDir, "tsconfig.json"), '{"compilerOptions":{}}');
      fs.writeFileSync(path.join(pkgDir, "AGENTS.md"), "# Nested Agents\n");
      fs.writeFileSync(path.join(pkgDir, "index.ts"), "export const web = true;\n");

      const defaultScan = resolvePathTargets(tmpDir, { includeTargets: true, projectRoot: tmpDir });
      expect(defaultScan.files).not.toContain(path.join(tmpDir, "package.json"));
      expect(defaultScan.files).toContain(path.join(pkgDir, "package.json"));
      expect(defaultScan.files).toContain(path.join(pkgDir, "tsconfig.json"));
      expect(defaultScan.files).toContain(path.join(pkgDir, "AGENTS.md"));

      const excludedScan = resolvePathTargets(tmpDir, {
        includeTargets: true,
        excludeMetadata: true,
        projectRoot: tmpDir,
      });
      expect(excludedScan.files).not.toContain(path.join(pkgDir, "package.json"));
      expect(excludedScan.files).not.toContain(path.join(pkgDir, "tsconfig.json"));
      expect(excludedScan.files).not.toContain(path.join(pkgDir, "AGENTS.md"));
      expect(excludedScan.files).toContain(path.join(pkgDir, "index.ts"));
    });

    it("recognizes non-existent extensionless PASSTHROUGH_FILENAMES as single-file targets", () => {
      for (const name of ["Makefile", "Dockerfile", ".gitignore"]) {
        expect(PASSTHROUGH_FILENAMES.has(name)).toBe(true);
        const target = path.join(tmpDir, name);
        const res = resolvePathTargets(target, { projectRoot: tmpDir });
        expect(res.isSingleFile).toBe(true);
        expect(res.isDirectory).toBe(false);
        expect(res.files).toEqual([target]);
      }
    });
  });
});
