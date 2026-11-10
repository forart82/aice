import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { KNOWN_TARGET_EXTENSIONS } from "../../src/config/project-config.js";
import { MANDATORY_AGENT_RULES_MARKDOWN } from "../../src/rules/mandatory-rules.js";
import {
  extractSymbolFromAiceSource,
  generateContext,
  generateWorkspaceContext,
  scanDirectoryForTargets,
} from "../../src/tools/context.js";
import { createBatch, createFile } from "../../src/tools/create.js";
import { generateOutline } from "../../src/tools/outline.js";
import {
  isHybridOrNativeSource,
  preprocessHybridAndIdiomsLossless,
} from "../../src/tools/preprocessor.js";
import { spliceSource } from "../../src/tools/splice.js";
import { validateNativeSyntax } from "../../src/tools/syntax-validator.js";
import { AICE_VERSION } from "../../src/version.js";

describe("AICE v0.9.22 AIPL Multi-Line & Tuple-Struct Parser, Recursive Directory Regex Search & Zero-Grep Hardening", () => {
  describe("Step 1: Multi-line AIPL fn signatures & single/multi-line tuple structs", () => {
    it("accepts multi-line fn signatures without false-positive colon warnings on the opening line", () => {
      const code = `module Renderer

pub fn renderD2Hud(
  texs: D2UpgradeTextures,
  hero: HeroState,
  cam: Camera25D,
  fps: float
): int:
  let x = 10
  ret x
`;
      const res = validateNativeSyntax(code, "aipl", "d2_renderer.aipl");
      expect(res.valid).toBe(true);
      expect(res.diagnostics).toHaveLength(0);

      const outline = generateOutline(code, "d2_renderer.aipl");
      const hudFn = outline.symbols.find((s) => s.name === "renderD2Hud");
      expect(hudFn).toBeDefined();
      expect(hudFn?.line).toBe(3);
      expect(hudFn?.endLine).toBe(10);
      expect(hudFn?.signature).toContain(
        "fn renderD2Hud(texs: D2UpgradeTextures, hero: HeroState, cam: Camera25D, fps: float): int",
      );

      const extracted = extractSymbolFromAiceSource(code, "renderD2Hud", "d2_renderer.aipl");
      expect(extracted).toContain("pub fn renderD2Hud(");
      expect(extracted).toContain("let x = 10");
      expect(extracted).toContain("ret x");
    });

    it("still flags a multi-line fn signature when the closing line lacks a trailing colon", () => {
      const badCode = `module Renderer

pub fn brokenMultiLine(
  a: int,
  b: int
) -> int
  ret a + b
`;
      const res = validateNativeSyntax(badCode, "aipl", "broken.aipl");
      expect(res.valid).toBe(false);
      expect(
        res.diagnostics.some((d) =>
          d.includes("AIPL function signature must end with ':' before indented body"),
        ),
      ).toBe(true);
    });

    it("accepts single-line and multi-line tuple/record structs without requiring a trailing colon", () => {
      const tupleStructCode = `module Gfx25dLight25d

pub struct PointLight25D(wx: float, wy: float, wz: float, radius: float, color: Color, intensity: float, flickerAmp: float, flickerSpeed: float)

pub struct D2RenderEngine(
  heroRig: IsoSpriteRig25D,
  skeletonRig: IsoSpriteRig25D,
  timeSec: float
)

pub fn getRadius(light: PointLight25D): float:
  ret light.radius
`;
      const res = validateNativeSyntax(tupleStructCode, "aipl", "light25d.aipl");
      expect(res.valid).toBe(true);
      expect(res.diagnostics).toHaveLength(0);

      const outline = generateOutline(tupleStructCode, "light25d.aipl");
      const pl = outline.symbols.find((s) => s.name === "PointLight25D");
      expect(pl).toBeDefined();
      expect(pl?.children?.length).toBe(8);
      const eng = outline.symbols.find((s) => s.name === "D2RenderEngine");
      expect(eng).toBeDefined();
      expect(eng?.line).toBe(5);
      expect(eng?.endLine).toBe(9);
      expect(eng?.children?.length).toBe(3);

      const extractedEng = extractSymbolFromAiceSource(
        tupleStructCode,
        "D2RenderEngine",
        "light25d.aipl",
      );
      expect(extractedEng).toContain("pub struct D2RenderEngine(");
      expect(extractedEng).toContain("timeSec: float");
      expect(extractedEng.trim().endsWith(")")).toBe(true);
    });

    it("produces 0 false-positive syntax diagnostics on real light25d.aipl and d2_renderer.aipl files if present", () => {
      const candidateFiles = [
        "/home/forart/dev/aipl/std/gfx25d/light25d.aipl",
        "/home/forart/dev/aipl_dog/src/world/d2_renderer.aipl",
      ];
      for (const filePath of candidateFiles) {
        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath, "utf-8");
          const res = validateNativeSyntax(content, "aipl", filePath);
          expect(res.diagnostics).toEqual([]);
          expect(res.valid).toBe(true);
        }
      }
    });

    it("handles default string arguments with parentheses, colons, and // URLs, single-line tuple field lookups, module/struct name collisions, and tuple-struct field splicing", () => {
      const trickyAipl = [
        "module D2Tilemap",
        "",
        "pub struct PointLight25D(wx: float, wy: float, wz: float) // 2.5D point light",
        "",
        "pub struct D2Tilemap(",
        "  tileWidth: float, // width in pixels",
        "  tileHeight: float",
        ")",
        "",
        "pub fn logWithUrl(",
        '  prefix: str = "(info):",',
        '  endpoint: str = "http://localhost:8080/api"',
        "): int:",
        "  ret 0",
        "",
        "pub fn afterLog(): int:",
        "  ret 1",
        "",
      ].join("\n");
      const valRes = validateNativeSyntax(trickyAipl, "aipl", "d2_tilemap.aipl");
      expect(valRes.diagnostics).toEqual([]);
      expect(valRes.valid).toBe(true);

      const outline = generateOutline(trickyAipl, "d2_tilemap.aipl");
      const modSym = outline.symbols.find((s) => s.kind === "module" && s.name === "D2Tilemap");
      const structSym = outline.symbols.find((s) => s.kind === "class" && s.name === "D2Tilemap");
      expect(modSym?.line).toBe(1);
      expect(modSym?.endLine).toBe(1);
      expect(structSym?.line).toBe(5);
      expect(structSym?.endLine).toBe(8);
      expect(structSym?.children?.[0]?.signature).toBe("val tileWidth: float");

      const logFn = outline.symbols.find((s) => s.name === "logWithUrl");
      expect(logFn).toBeDefined();
      expect(logFn?.signature).toContain('prefix: str = "(info):"');
      expect(logFn?.signature).toContain('endpoint: str = "http://localhost:8080/api"');
      expect(logFn?.signature).toContain("): int");
      const afterFn = outline.symbols.find((s) => s.name === "afterLog");
      expect(afterFn).toBeDefined();

      // Single-line tuple struct field lookup
      const wxField = extractSymbolFromAiceSource(
        trickyAipl,
        "PointLight25D.wx",
        "d2_tilemap.aipl",
      );
      expect(wxField).toContain("wx: float");

      // Multi-line tuple struct field auto-append
      const appendedMulti = spliceSource(
        trickyAipl,
        "D2Tilemap.gridTilesX",
        "gridTilesX: int",
        false,
        "d2_tilemap.aipl",
      );
      expect(appendedMulti.success).toBe(true);
      expect(appendedMulti.modifiedCode).toContain("tileHeight: float,\n  gridTilesX: int\n)");
      expect(
        validateNativeSyntax(appendedMulti.modifiedCode, "aipl", "d2_tilemap.aipl").valid,
      ).toBe(true);

      // Single-line tuple struct field auto-append
      const appendedSingle = spliceSource(
        trickyAipl,
        "PointLight25D.radius",
        "radius: float",
        false,
        "d2_tilemap.aipl",
      );
      expect(appendedSingle.success).toBe(true);
      expect(appendedSingle.modifiedCode).toContain(
        "pub struct PointLight25D(wx: float, wy: float, wz: float, radius: float)",
      );
    });
  });

  describe("Step 2: Recursive Directory Regex Search in aice context <dir> -s '/pattern/'", () => {
    it("recursively traverses subdirectories up to depth 5 across all 33 extensions and formats matches with [L<line>]", async () => {
      expect(KNOWN_TARGET_EXTENSIONS.size).toBeGreaterThanOrEqual(33);
      expect(KNOWN_TARGET_EXTENSIONS.has(".aipl")).toBe(true);

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aice-v0922-dirsearch-"));
      try {
        const srcWorldDir = path.join(tmpDir, "src", "world");
        const deepDir = path.join(tmpDir, "src", "a", "b", "c", "d");
        fs.mkdirSync(srcWorldDir, { recursive: true });
        fs.mkdirSync(deepDir, { recursive: true });

        const rendererPath = path.join(srcWorldDir, "d2_renderer.aipl");
        const prefixLines = Array.from({ length: 464 }, (_, i) => `// line ${i + 1}`);
        const rendererContent = [
          ...prefixLines,
          "// Renders the iconic Diablo 2 Dual Orbs & Action Belt HUD",
          "pub fn renderD2Hud(",
          "  texs: D2UpgradeTextures,",
          "  hero: HeroState,",
          "  cam: Camera25D,",
          "  fps: float",
          "): int:",
          "  ret 0",
          "",
        ].join("\n");
        fs.writeFileSync(rendererPath, rendererContent, "utf-8");

        const deepScript = path.join(deepDir, "helper.sh");
        fs.writeFileSync(
          deepScript,
          "#!/usr/bin/env bash\nrenderD2Hud_hook() {\n  echo ok\n}\n",
          "utf-8",
        );

        const targets = scanDirectoryForTargets(path.join(tmpDir, "src"), 5);
        expect(targets).toContain(rendererPath);
        expect(targets).toContain(deepScript);

        const ctxRes = await generateWorkspaceContext(path.join(tmpDir, "src"), {
          symbol: "/renderD2Hud/",
          projectRoot: tmpDir,
        });
        expect(ctxRes.formattedBundle).toContain("### src/world/d2_renderer.aipl [L466]");
        expect(ctxRes.formattedBundle).toContain("src/world/d2_renderer.aipl:466");
        expect(ctxRes.formattedBundle).toContain("pub fn renderD2Hud(");
        expect(ctxRes.formattedBundle).toContain("### src/a/b/c/d/helper.sh [L2]");

        const singleSymCtx = await generateContext(rendererPath, {
          symbol: "renderD2Hud",
          projectRoot: tmpDir,
          includeCallers: false,
        });
        expect(singleSymCtx.formattedBundle).toContain("pub fn renderD2Hud(");
        expect(singleSymCtx.formattedBundle).toContain("ret 0");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe("Step 3: Zero-Grep & Zero-Sed Directives in MANDATORY_AGENT_RULES_MARKDOWN (v0.9.24)", () => {
    it("bumps version to 0.9.24 and includes explicit .aipl grep/sed replacement directives", () => {
      expect(AICE_VERSION).toBe("0.9.24");
      expect(MANDATORY_AGENT_RULES_MARKDOWN).toContain("<!-- AICE:START v0.9.24 -->");
      expect(MANDATORY_AGENT_RULES_MARKDOWN).toContain(
        'Replace `grep -n -C 10 "sym" file.aipl` -> `aice context file.aipl -s "sym"`',
      );
      expect(MANDATORY_AGENT_RULES_MARKDOWN).toContain(
        'Replace `grep -rn "sym" src/` -> `aice context src -s "/sym/"`',
      );
      expect(MANDATORY_AGENT_RULES_MARKDOWN).toContain(
        "Replace `sed -n '50,90p' file.aipl` -> `aice context file.aipl -s \"L50-L90\"`",
      );
      expect(MANDATORY_AGENT_RULES_MARKDOWN).toContain(
        "works seamlessly across all 33 file extensions including `.aipl`",
      );
    });
  });

  describe("Step 4: Native .aipl aice create & createBatch fast-path", () => {
    it("creates .aipl files cleanly via createFile and createBatch without invoking the AICE EBNF parser", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aice-aipl-create-"));
      try {
        fs.writeFileSync(
          path.join(tmpDir, "aice.config.json"),
          JSON.stringify({ enabled: true, version: "0.9.22" }, null, 2),
          "utf-8",
        );

        const aiplCode = [
          "import world/d2_world",
          "import entities/d2_hero",
          "",
          "pub struct FidelityCheck(passed: bool, label: str)",
          "",
          "fn main(): int:",
          "  let world = initD2World()",
          "  mut hero = spawnHero(world.campFireX, world.campFireY)",
          '  assert(world.campFireX > 0.0 and hero.hp > 0.0, "World and hero initialized")',
          '  println("D2 Resurrected fidelity verified")',
          "  ret 0",
        ].join("\n");

        expect(isHybridOrNativeSource(aiplCode, "aipl")).toBe(true);
        expect(preprocessHybridAndIdiomsLossless(aiplCode, "aipl")).toBe(aiplCode);

        const targetFile = path.join(tmpDir, "src", "test_d2_resurrected_fidelity.aipl");
        const res = await createFile(targetFile, {
          code: aiplCode,
          projectRoot: tmpDir,
        });
        expect(res.success).toBe(true);
        expect(res.targetLanguage).toBe("aipl");
        expect(fs.readFileSync(targetFile, "utf-8")).toBe(`${aiplCode}\n`);

        const batchStream = ["=== src/batch_check.aipl ===", aiplCode].join("\n");
        const batchRes = await createBatch(batchStream, { projectRoot: tmpDir });
        expect(batchRes.success).toBe(true);
        expect(batchRes.totalFiles).toBe(1);
        expect(fs.readFileSync(path.join(tmpDir, "src", "batch_check.aipl"), "utf-8")).toBe(
          `${aiplCode}\n`,
        );

        // Also verify pre-write syntax validation catches broken .aipl syntax
        await expect(
          createFile(path.join(tmpDir, "src", "broken.aipl"), {
            code: "fn main(): int\n  ret 0\n",
            projectRoot: tmpDir,
          }),
        ).rejects.toThrow(/Failed pre-write syntax validation/);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
