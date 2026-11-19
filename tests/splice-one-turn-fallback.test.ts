import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { saveProjectConfig } from "../src/config/index.js";
import { applyHunksToScope, spliceBatch, splice as spliceFile } from "../src/tools/splice.js";

describe("1-Turn Safe Splice Recovery & Zero-Corruption Guards", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aice-splice-1turn-"));
    saveProjectConfig(tmpDir, { enabled: true, idiomsEnabled: false });
    process.env.AICE_TELEMETRY_DIR = path.join(tmpDir, ".telemetry");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("1. ±2..4 boundary candidate disambiguation", () => {
    it("disambiguates CSS off-by-1 closing brace without swallowing following rule (ovh styles.css:L612-L621 pattern)", async () => {
      const cssFile = path.join(tmpDir, "styles.css");
      const original = [
        "@media (max-width: 860px) {",
        "  .nav-links {",
        "    display: none;",
        "    gap: 0.35rem;",
        "    padding: 0.9rem 1rem 1.1rem;",
        "    background: rgba(6, 9, 19, 0.98);",
        "    backdrop-filter: blur(22px);",
        "    border: 1px solid var(--border-glass-hover);",
        "    border-radius: var(--radius-md);",
        "    box-shadow: 0 24px 48px rgba(2, 4, 10, 0.88);",
        "    z-index: 99;",
        "  }",
        "",
        "  .site-header.is-menu-open .nav-links {",
        "    display: flex;",
        "  }",
        "}",
        "",
      ].join("\n");
      fs.writeFileSync(cssFile, original, "utf-8");

      // L4-L12 accidentally includes L12 ("  }"), which previously conflicted with L4-L14 eating ".site-header..."
      await spliceFile(cssFile, {
        symbol: "L4-L12",
        projectRoot: tmpDir,
        idioms: false,
        code: [
          "    padding: 0.9rem 1rem 1.1rem;",
          "    background: #070b15;",
          "    border: 1px solid var(--border-glass-hover);",
          "    border-radius: var(--radius-md);",
          "    box-shadow: 0 24px 48px rgba(2, 4, 10, 0.92);",
          "    z-index: 99;",
        ].join("\n"),
      });

      const updated = fs.readFileSync(cssFile, "utf-8");
      expect(updated).toContain("background: #070b15;");
      expect(updated).toContain(
        "  .site-header.is-menu-open .nav-links {\n    display: flex;\n  }",
      );
      expect(updated.match(/\{/g)?.length).toBe(updated.match(/\}/g)?.length);
    });

    it("disambiguates JS function across surrounding blank lines and adjacent if-block (ovh playground.js:L1425-L1433 pattern)", async () => {
      const jsFile = path.join(tmpDir, "playground.js");
      const original = [
        "(function (root) {",
        "  root.AiplShowcaseApp = {};",
        "",
        "  function boot() {",
        "    initCompare();",
        "    initPlayground();",
        "  }",
        "",
        "  if (typeof document !== 'undefined') {",
        "    boot();",
        "  }",
        "})(this);",
        "",
      ].join("\n");
      fs.writeFileSync(jsFile, original, "utf-8");

      // L3-L9 starts on blank L3 and bleeds into L9 ("if (typeof document !== 'undefined') {")
      await spliceFile(jsFile, {
        symbol: "L3-L9",
        projectRoot: tmpDir,
        code: [
          "  function boot() {",
          "    initCompare();",
          "    initStdlibAtlas();",
          "    initPlayground();",
          "  }",
        ].join("\n"),
      });

      const updated = fs.readFileSync(jsFile, "utf-8");
      expect(updated).toContain("root.AiplShowcaseApp = {};\n\n  function boot() {");
      expect(updated).toContain("initStdlibAtlas();");
      expect(updated).toContain("  }\n\n  if (typeof document !== 'undefined') {");
    });

    it("recovers multi-line comma CSS selector without nesting or leaving dangling comma (ovh styles.css:L455-L470 pattern)", async () => {
      const cssFile = path.join(tmpDir, "brand.css");
      const original = [
        ".brand {",
        "  flex-shrink: 0;",
        "}",
        "",
        ".brand-mark img,",
        ".brand-mark svg {",
        "  width: 30px;",
        "  height: 30px;",
        "  display: block;",
        "}",
        "",
        ".brand-sub {",
        "  font-size: 0.72rem;",
        "  color: var(--ink-muted);",
        "}",
        "",
        ".nav-links {",
        "  display: flex;",
        "}",
        "",
      ].join("\n");
      fs.writeFileSync(cssFile, original, "utf-8");

      // L7-L16 starts inside .brand-mark svg { and ends on blank L16
      await spliceFile(cssFile, {
        symbol: "L7-L16",
        projectRoot: tmpDir,
        idioms: false,
        code: [
          ".brand-prism-icon {",
          "  width: 30px;",
          "  height: 30px;",
          "}",
          "",
          ".brand-sub {",
          "  font-size: 0.75rem;",
          "  color: var(--ink-muted);",
          "}",
        ].join("\n"),
      });

      const updated = fs.readFileSync(cssFile, "utf-8");
      expect(updated).not.toContain(".brand-mark img,");
      expect(updated).not.toContain(".brand-mark svg");
      expect(updated).toContain(".brand {\n  flex-shrink: 0;\n}\n\n.brand-prism-icon {");
      expect(updated).toContain(
        "font-size: 0.75rem;\n  color: var(--ink-muted);\n}\n\n.nav-links {",
      );
    });

    it("never merges preceding '}' with following 'if {' on half-open 1-line TS range (ts_3d_world WorldSaveCodec.ts:L423-L424 pattern)", async () => {
      const tsFile = path.join(tmpDir, "WorldSaveCodec.ts");
      const original = [
        "export function validatePlayer(player: { maxHp?: number; currentHp?: number }, errors: string[]): void {",
        "  if (typeof player.maxHp !== 'number' || player.maxHp <= 0) {",
        "    errors.push('maxHp must be > 0');",
        "  }",
        "  const maxHp = typeof player.maxHp === 'number' && Number.isFinite(player.maxHp) ? player.maxHp : 0;",
        "  if (typeof player.currentHp !== 'number' || player.currentHp > maxHp) {",
        "    errors.push('currentHp out of range');",
        "  }",
        "}",
        "",
      ].join("\n");
      fs.writeFileSync(tsFile, original, "utf-8");

      // L5-L6 accidentally spans L6 ("if (typeof player.currentHp ...) {")
      await spliceFile(tsFile, {
        symbol: "L5-L6",
        projectRoot: tmpDir,
        code: [
          "  const maxHp =",
          "    typeof player.maxHp === 'number' && Number.isFinite(player.maxHp) ? player.maxHp : 0;",
        ].join("\n"),
      });

      const updated = fs.readFileSync(tsFile, "utf-8");
      expect(updated).toContain(
        "    errors.push('maxHp must be > 0');\n  }\n  const maxHp =\n    typeof player.maxHp",
      );
      expect(updated).toContain(
        "  if (typeof player.currentHp !== 'number' || player.currentHp > maxHp) {",
      );
    });

    it("recovers off-by-3..4 shifted object/IIFE ranges cleanly (ovh playground.js & aipl-web.js patterns)", async () => {
      const catalogFile = path.join(tmpDir, "catalog.js");
      const catalogOrig = [
        "const CATALOG = [",
        "  {",
        "    domain: 'math',",
        "    module: 'std/math/vec',",
        "    title: 'Vectors',",
        "  },",
        "  {",
        "    domain: 'phys',",
        "    module: 'std/phys/rapier',",
        "    title: 'Physics',",
        "  },",
        "  {",
        "    domain: 'ecs',",
        "    module: 'std/ecs/ecs_world',",
        "    title: 'Archetype ECS World',",
        "  },",
        "];",
        "",
      ].join("\n");
      fs.writeFileSync(catalogFile, catalogOrig, "utf-8");

      // Off by +3 lines at start (L9 instead of L12) and +2 lines at end (L14 instead of L16)
      await spliceFile(catalogFile, {
        symbol: "L9-L14",
        projectRoot: tmpDir,
        code: [
          "  {",
          "    domain: 'ecs',",
          "    module: 'std/ecs/ecs_world',",
          "    title: 'Archetype ECS World',",
          "  },",
          "  {",
          "    domain: 'ecs',",
          "    module: 'std/gfx/gpu_shader',",
          "    title: 'WGSL Shaders',",
          "  },",
        ].join("\n"),
      });

      const updatedCatalog = fs.readFileSync(catalogFile, "utf-8");
      expect(updatedCatalog).toContain("module: 'std/phys/rapier'");
      expect(updatedCatalog).toContain("module: 'std/ecs/ecs_world'");
      expect(updatedCatalog).toContain("module: 'std/gfx/gpu_shader'");

      const wasmFile = path.join(tmpDir, "aipl-web.js");
      const wasmOrig = [
        "export class AiplWeb {",
        "  init(bytes) {",
        "    this.initPromise = (async () => {",
        "      if (!bytes) {",
        "        throw new Error('No wasm binary');",
        "      }",
        "",
        "      const { instance } = await WebAssembly.instantiate(bytes, {});",
        "      this.isReady = true;",
        "    })();",
        "  }",
        "}",
        "",
      ].join("\n");
      fs.writeFileSync(wasmFile, wasmOrig, "utf-8");

      // Off by +4 at start (L4 instead of L8) and +1 at end (L9 instead of L10)
      await spliceFile(wasmFile, {
        symbol: "L4-L9",
        projectRoot: tmpDir,
        code: [
          "      const { instance } = await WebAssembly.instantiate(bytes, {});",
          "      this.wasmInstance = instance;",
          "      this.isReady = true;",
          "    })();",
        ].join("\n"),
      });

      const updatedWasm = fs.readFileSync(wasmFile, "utf-8");
      expect(updatedWasm).toContain("throw new Error('No wasm binary');");
      expect(updatedWasm).toContain("this.wasmInstance = instance;");
    });

    it("refuses to guess when unwrap-vs-keep bare block boundary candidates are genuinely ambiguous", async () => {
      const ambigFile = path.join(tmpDir, "ambig.ts");
      const original = [
        "export function outer(): number {",
        "  {",
        "    const inner = 1;",
        "  }",
        "  return 0;",
        "}",
        "",
      ].join("\n");
      fs.writeFileSync(ambigFile, original, "utf-8");

      await expect(
        spliceFile(ambigFile, {
          symbol: "L2-L3",
          projectRoot: tmpDir,
          code: "    const inner = 2;",
        }),
      ).rejects.toThrow(/Ambiguous ±2 boundary alignments/);
      expect(fs.readFileSync(ambigFile, "utf-8")).toBe(original);
    });
  });

  describe("2. ±20 unique-anchor shift for non-declaration :Lstart-Lend edits", () => {
    it("shifts non-declaration edits within ±20 lines when anchors (>=8 chars) match uniquely and syntax is valid", async () => {
      const tsFile = path.join(tmpDir, "loop.ts");
      const filler = Array.from({ length: 16 }, (_, i) => `  const pad${i} = ${i};`);
      const original = [
        "export function updateGame(state: { mode: number; score: number; tick: number }): number {",
        ...filler,
        "  if (state.mode === 0) {",
        "    state.score = 0;",
        "    return state.tick + 1;",
        "  }",
        "  if (state.mode === 2) {",
        "    state.score += 10;",
        "    return state.score;",
        "  }",
        "  return 0;",
        "}",
        "",
      ].join("\n");
      fs.writeFileSync(tsFile, original, "utf-8");

      // Actual block is at L18-L21; request L4-L8 (shifted by 14 lines, within ±20)
      await spliceFile(tsFile, {
        symbol: "L4-L8",
        projectRoot: tmpDir,
        code: [
          "  if (state.mode === 0) {",
          "    state.score = 100;",
          "    state.tick += 2;",
          "    return state.tick + 1;",
          "  }",
        ].join("\n"),
      });

      const updated = fs.readFileSync(tsFile, "utf-8");
      expect(updated).toContain("const pad3 = 3;");
      expect(updated).toContain("const pad7 = 7;");
      expect(updated).toContain(
        "state.score = 100;\n    state.tick += 2;\n    return state.tick + 1;",
      );
    });

    it("recovers AIPL non-declaration block shifted by 20 lines (ovh game.aipl:L652-L664 pattern)", async () => {
      const aiplFile = path.join(tmpDir, "game.aipl");
      const original = [
        "fn stepGame(g: GameState) -> int:",
        "  if g.mode == 0:",
        '    let startPressed = isKeyJustPressed("Space") or isMouseButtonPressed(0)',
        "    if startPressed:",
        "      g.mode = 1",
        "      let _ = beginWave(g, 1)",
        "    ret 0",
        "",
        "  if g.mode == 2:",
        "    mut chosen = -1",
        '    if isKeyJustPressed("1"):',
        "      chosen = g.upgA",
        '    elif isKeyJustPressed("2"):',
        "      chosen = g.upgB",
        '    elif isKeyJustPressed("3"):',
        "      chosen = g.upgC",
        "    if chosen >= 0:",
        "      let _ = applyUpgradeChoice(g, chosen)",
        "    ret 0",
        "",
        "  if g.mode == 3:",
        '    if isKeyJustPressed("Enter"):',
        "      let best = if g.score > g.bestScore: g.score else: g.bestScore",
        "      g.bestScore = best",
        "    ret 0",
        "  ret 0",
        "",
      ].join("\n");
      fs.writeFileSync(aiplFile, original, "utf-8");

      // Actual block is L2-L7; agent passes L22-L25 (+20 shift into middle of g.mode == 3)
      await spliceFile(aiplFile, {
        symbol: "L22-L25",
        projectRoot: tmpDir,
        code: [
          "  if g.mode == 0:",
          "    let tAng = float(g.tick) * 0.025",
          "    g.aimDirX = cos(tAng)",
          '    let startPressed = isKeyJustPressed("Space") or isMouseButtonPressed(0)',
          "    if startPressed:",
          "      g.mode = 1",
          "      let _ = beginWave(g, 1)",
          "    ret 0",
        ].join("\n"),
      });

      const updated = fs.readFileSync(aiplFile, "utf-8");
      expect(updated).toContain("let tAng = float(g.tick) * 0.025");
      expect(updated).toContain('  if g.mode == 3:\n    if isKeyJustPressed("Enter"):');
    });

    it("refuses to shift when non-declaration anchors appear multiple times in ±20 window", async () => {
      const tsFile = path.join(tmpDir, "dup.ts");
      const original = [
        "export function run(x: number): number {",
        "  if (x > 10) {",
        "    const tag = 'alpha';",
        "    return x + 100;",
        "  }",
        "  if (x > 10) {",
        "    const tag = 'alpha';",
        "    return x + 100;",
        "  }",
        "  const pre = x + 1;",
        "  if (x > 20) {",
        "    const a = x * 2;",
        "    const b = a + 1;",
        "    const c = b + 1;",
        "    const d = c + 1;",
        "    const e = d + 1;",
        "    return e;",
        "  }",
        "  return x;",
        "}",
        "",
      ].join("\n");
      fs.writeFileSync(tsFile, original, "utf-8");

      // L10-L12 slices across `const pre` + `if (x > 20) {` (closing `}` is at L18, outside ±4),
      // while `if (x > 10) {` .. `return x + 100;\n}` appears TWICE in the ±20 window -> must refuse to guess!
      await expect(
        spliceFile(tsFile, {
          symbol: "L10-L12",
          projectRoot: tmpDir,
          code: [
            "  if (x > 10) {",
            "    const tag = 'updated';",
            "    return x + 100;",
            "  }",
          ].join("\n"),
        }),
      ).rejects.toThrow(/Line-range splice/);
      expect(fs.readFileSync(tsFile, "utf-8")).toBe(original);
    });
  });

  describe("3. 5th hunk pass in applyHunksToScope (normalized interior whitespace)", () => {
    it("matches unique normalized interior whitespace hunk and validates syntax", async () => {
      const tsFile = path.join(tmpDir, "aligned.ts");
      const original = [
        "export class Matrix {",
        "  compute(a: number, b: number): number {",
        "    const   alpha   =   a  *  2;",
        "    const   beta    =   b  +  alpha;",
        "    return beta;",
        "  }",
        "}",
        "",
      ].join("\n");
      fs.writeFileSync(tsFile, original, "utf-8");

      await spliceFile(tsFile, {
        symbol: "Matrix.compute",
        projectRoot: tmpDir,
        code: [
          "<<<",
          "const alpha = a * 2;",
          "const beta = b + alpha;",
          "===",
          "const alpha = a * 3;",
          "const beta = b + alpha + 1;",
          ">>>",
        ].join("\n"),
      });

      const updated = fs.readFileSync(tsFile, "utf-8");
      expect(updated).toContain("    const alpha = a * 3;\n    const beta = b + alpha + 1;");
    });

    it("rejects ambiguous interior whitespace matches and rejects invalid syntax in Pass 5", () => {
      const dupScope = [
        "function demo(a: number) {",
        "  const   x  =  a + 1;",
        "  if (a > 0) {",
        "    const x = a + 1;", // wait: exact match would hit this if search is single-spaced, so make both multi-spaced!
        "  }",
        "}",
      ]
        .join("\n")
        .replace("const x = a + 1;", "const  x   =   a + 1;");

      expect(() =>
        applyHunksToScope(
          dupScope,
          [{ search: "const x = a + 1;", replace: "const x = a + 2;" }],
          "demo",
          "demo.ts",
          "typescript",
        ),
      ).toThrow(/Ambiguous hunk/);

      const singleScope = [
        "function demo(a: number): number {",
        "  const   x   =   a + 1;",
        "  return x;",
        "}",
      ].join("\n");

      expect(() =>
        applyHunksToScope(
          singleScope,
          [{ search: "const x = a + 1;", replace: "const x = (((" }],
          "demo",
          "demo.ts",
          "typescript",
        ),
      ).toThrow(/Hunk search block not found/);
    });
  });

  describe("4. Full-file === file === syntax error hint", () => {
    it("keeps rejecting broken full-file syntax and appends concise line-fix / :sym / :L tip", async () => {
      const targetFp = path.join(tmpDir, "broken.ts");
      fs.writeFileSync(targetFp, "export const ok = 1;\n", "utf-8");

      await expect(
        spliceBatch(`=== ${targetFp} ===\nexport function broken( {\n  return 1;\n}\n`, {
          projectRoot: tmpDir,
        }),
      ).rejects.toThrow(
        /Failed pre-write syntax validation[\s\S]*Tip: Fix the syntax error[\s\S]*:L<start>-L<end>/,
      );

      // Existing file must remain 100% untouched
      expect(fs.readFileSync(targetFp, "utf-8")).toBe("export const ok = 1;\n");

      const newFp = path.join(tmpDir, "new-broken.ts");
      await expect(
        spliceFile(newFp, {
          projectRoot: tmpDir,
          code: "export const bad = ((1 + 2;\n",
        }),
      ).rejects.toThrow(/Failed pre-write syntax validation[\s\S]*Tip: Fix the syntax error/);
      expect(fs.existsSync(newFp)).toBe(false);
    });
  });
});
