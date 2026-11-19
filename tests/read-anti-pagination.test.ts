import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { computeProjectSystemicEconomics, readTelemetryEvents } from "../src/telemetry/index.js";
import { aiceRead, DEFAULT_CLI_READ_MAX_BYTES } from "../src/tools/read.js";

const SEQUENTIAL_SLICE_TRAP_RE = /next(?:\s+slice)?:\s+aice read\s+[^\s]+:L\d+/i;

describe("v0.9.52 Read Anti-Pagination, 1-Turn Priority Batch Packing & Zero Single-File Loss", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aice-anti-paging-"));
    fs.mkdirSync(path.join(tmpDir, "src", "contracts"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "src", "engine"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "site"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "tools"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "aice.config.json"),
      `${JSON.stringify({ enabled: true, idiomsEnabled: false }, null, 2)}\n`,
      "utf-8",
    );

    // 1. Small config & code files (<=120L)
    fs.writeFileSync(
      path.join(tmpDir, "src", "small-config.ts"),
      `${[
        "export interface AppBootOptions {",
        "  readonly port: number;",
        "  readonly host: string;",
        "}",
        "",
        "export function createDefaultBootOptions(): AppBootOptions {",
        '  return { port: 3000, host: "127.0.0.1" };',
        "}",
      ].join("\n")}\n`,
      "utf-8",
    );

    fs.writeFileSync(
      path.join(tmpDir, "src", "contracts", "IValidator.ts"),
      `${[
        "/**",
        " * Validation contract for world state snapshots.",
        " */",
        "export interface ValidationIssue {",
        "  readonly path: string;",
        "  readonly message: string;",
        "}",
        "",
        "export interface IValidator<T> {",
        "  validate(input: T): readonly ValidationIssue[];",
        "  isValid(input: T): boolean;",
        "}",
      ].join("\n")}\n`,
      "utf-8",
    );

    fs.writeFileSync(
      path.join(tmpDir, "site", "manifest.json"),
      `${JSON.stringify(
        {
          name: "anti-paging-demo",
          version: "1.0.0",
          icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }],
        },
        null,
        2,
      )}\n`,
      "utf-8",
    );

    // 2. Oversized TypeScript file (>120L) with imports + interfaces + concrete functions
    const engineLines = [
      'import type { AppBootOptions } from "../small-config.js";',
      "",
      "export interface FrameMetrics {",
      "  readonly frameId: number;",
      "  readonly elapsedMs: number;",
      "}",
      "",
      "export function initializeWorldKernel(opts: AppBootOptions): FrameMetrics {",
      "  const portWeight = opts.port * 2;",
      "  return { frameId: 1, elapsedMs: portWeight * 0.01 };",
      "}",
      "",
      "export function stepWorldSimulation(prev: FrameMetrics, dtMs: number): FrameMetrics {",
      "  return { frameId: prev.frameId + 1, elapsedMs: prev.elapsedMs + dtMs };",
      "}",
      "",
      ...Array.from(
        { length: 160 },
        (_, idx) =>
          `export function computeSubSystem_${idx}(seed: number): number { const k = seed + ${idx}; return k * 3; }`,
      ),
    ];
    fs.writeFileSync(
      path.join(tmpDir, "src", "engine", "world-kernel.ts"),
      `${engineLines.join("\n")}\n`,
      "utf-8",
    );

    // 3. Oversized class with multiple methods (for budget-capped class method hints)
    const bigClassLines = [
      "export class MatrixTransformPipeline {",
      "  public composeProjection(fovRad: number, aspect: number): number[] {",
      ...Array.from(
        { length: 95 },
        (_, i) => `    const projStep_${i} = fovRad * aspect + ${i}.123456789;`,
      ),
      "    return [fovRad, aspect, projStep_0];",
      "  }",
      "",
      "  public invertRigidBody(mat: readonly number[]): number[] {",
      ...Array.from(
        { length: 95 },
        (_, i) => `    const invStep_${i} = (mat[0] ?? 1) * ${i + 1}.987654321;`,
      ),
      "    return [invStep_0];",
      "  }",
      "}",
    ];
    fs.writeFileSync(
      path.join(tmpDir, "src", "engine", "matrix-pipeline.ts"),
      `${bigClassLines.join("\n")}\n`,
      "utf-8",
    );

    // 4. Oversized Python & AIPL & IIFE JS code files
    const pyLines = [
      "import os",
      "import sys",
      "",
      "def build_step_manifest(root_dir: str) -> dict:",
      '    return {"root": root_dir, "ok": True}',
      "",
      "def verify_step_gates(manifest: dict) -> bool:",
      '    return bool(manifest.get("ok"))',
      "",
      ...Array.from(
        { length: 140 },
        (_, i) => `def helper_gate_${i}(val: int) -> int:\n    return val + ${i}`,
      ),
    ];
    fs.writeFileSync(
      path.join(tmpDir, "tools", "step_runner.py"),
      `${pyLines.join("\n")}\n`,
      "utf-8",
    );

    const aiplLines = [
      "module GameSimulation",
      "",
      "struct Vec2:",
      "  x: float",
      "  y: float",
      "",
      "pub fn advance_particle(p: Vec2, dt: float) -> Vec2:",
      "  return Vec2 { x: p.x + dt, y: p.y + dt }",
      "",
      "pub fn collide_bounds(p: Vec2, limit: float) -> bool:",
      "  return p.x > limit",
      "",
      ...Array.from({ length: 135 }, (_, i) => `pub fn rule_tick_${i}(v: int) -> int = v + ${i}`),
    ];
    fs.writeFileSync(path.join(tmpDir, "site", "sim.aipl"), `${aiplLines.join("\n")}\n`, "utf-8");

    const iifeJsLines = [
      "(function () {",
      '  "use strict";',
      "  function escapePlaygroundHtml(raw) {",
      '    return String(raw).replace(/&/g, "&amp;");',
      "  }",
      "  function renderTokenComparison(rows) {",
      "    return rows.map(escapePlaygroundHtml).join('\\n');",
      "  }",
      ...Array.from(
        { length: 150 },
        (_, i) => `  const entry_${i} = "ui_label_padding_value_${i}";`,
      ),
      "  window.pg = { escapePlaygroundHtml, renderTokenComparison };",
      "})();",
    ];
    fs.writeFileSync(
      path.join(tmpDir, "site", "playground.js"),
      `${iifeJsLines.join("\n")}\n`,
      "utf-8",
    );

    // 5. Oversized symbolless CSS & Markdown files (>120L)
    const cssLines = Array.from(
      { length: 180 },
      (_, i) => `.neon-panel-${i} { color: #00ffcc; padding: ${(i % 8) + 2}px; }`,
    );
    fs.writeFileSync(path.join(tmpDir, "site", "styles.css"), `${cssLines.join("\n")}\n`, "utf-8");

    const mdLines = [
      "# System Architecture Specification",
      "",
      ...Array.from(
        { length: 75 },
        (_, i) =>
          `## Section ${i + 1}: Subsystem Invariant\nAll transitions in stage ${i + 1} are deterministic.`,
      ),
    ];
    fs.writeFileSync(path.join(tmpDir, "ORACLE.md"), `${mdLines.join("\n")}\n`, "utf-8");

    // 6. Dense <=115L bare file (~7.8 KB) that enters executeContextStream without pre-classification >120L outline
    const dense110Lines = Array.from(
      { length: 110 },
      (_, i) =>
        `export function denseHandler_${i}(payload: string): string { return payload + "_dense_segment_padding_${i}_extra"; }`,
    );
    fs.writeFileSync(
      path.join(tmpDir, "src", "engine", "dense-under-120.ts"),
      `${dense110Lines.join("\n")}\n`,
      "utf-8",
    );
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("Finding 1: Zero sequential :L1-L140 pagination hints across code & symbolless files", () => {
    it("emits real AST callable symbol batch hints on >120L TS, Python, AIPL, and IIFE JS auto-outlines without :L1-L... traps", async () => {
      const tsRes = await aiceRead("src/engine/world-kernel.ts", {
        projectRoot: tmpDir,
        surface: "cli",
      });
      expect(tsRes.mode).toBe("auto-outline-file");
      expect(tsRes.output).toContain(
        "batch symbols: aice read src/engine/world-kernel.ts:initializeWorldKernel src/engine/world-kernel.ts:stepWorldSimulation or aice search <pat> src/engine/world-kernel.ts",
      );
      expect(tsRes.output).not.toMatch(SEQUENTIAL_SLICE_TRAP_RE);
      // Never suggests import specifiers as symbols
      expect(tsRes.output).not.toContain("world-kernel.ts:../small-config");

      const pyRes = await aiceRead("tools/step_runner.py", {
        projectRoot: tmpDir,
        surface: "cli",
      });
      expect(pyRes.output).toContain(
        "batch symbols: aice read tools/step_runner.py:build_step_manifest tools/step_runner.py:verify_step_gates or aice search <pat> tools/step_runner.py",
      );
      expect(pyRes.output).not.toMatch(SEQUENTIAL_SLICE_TRAP_RE);

      const aiplRes = await aiceRead("site/sim.aipl", {
        projectRoot: tmpDir,
        surface: "cli",
      });
      expect(aiplRes.output).toContain("batch symbols: aice read site/sim.aipl:");
      expect(aiplRes.output).not.toContain("site/sim.aipl:GameSimulation");
      expect(aiplRes.output).not.toMatch(SEQUENTIAL_SLICE_TRAP_RE);

      const iifeRes = await aiceRead("site/playground.js", {
        projectRoot: tmpDir,
        surface: "cli",
      });
      expect(iifeRes.output).toContain(
        "batch symbols: aice read site/playground.js:escapePlaygroundHtml site/playground.js:renderTokenComparison or aice search <pat> site/playground.js",
      );
      expect(iifeRes.output).not.toMatch(SEQUENTIAL_SLICE_TRAP_RE);
    });

    it("guides symbolless auto-outlines (CSS, Markdown) and explicit :L overflows to aice search without linear breadcrumbs", async () => {
      const cssRes = await aiceRead("site/styles.css", {
        projectRoot: tmpDir,
        surface: "cli",
      });
      expect(cssRes.mode).toBe("auto-outline-file");
      expect(cssRes.output).toContain("— narrow with aice search <pat> site/styles.css");
      expect(cssRes.output).not.toContain("batch symbols:");
      expect(cssRes.output).not.toMatch(SEQUENTIAL_SLICE_TRAP_RE);

      const mdRes = await aiceRead("ORACLE.md", {
        projectRoot: tmpDir,
        surface: "cli",
      });
      expect(mdRes.output).toContain("— narrow with aice search <pat> ORACLE.md");
      expect(mdRes.output).not.toContain("batch symbols:");
      expect(mdRes.output).not.toMatch(SEQUENTIAL_SLICE_TRAP_RE);

      const rangeOverflow = await aiceRead("src/engine/world-kernel.ts:L1-L175", {
        projectRoot: tmpDir,
        surface: "cli",
        maxBytes: 2_800,
      });
      expect(Buffer.byteLength(rangeOverflow.output, "utf-8")).toBeLessThanOrEqual(2_800);
      expect(rangeOverflow.output).toMatch(
        /\(L\d+-L175 remaining\) — narrow with aice search <pat> src\/engine\/world-kernel\.ts/,
      );
      expect(rangeOverflow.output).not.toMatch(SEQUENTIAL_SLICE_TRAP_RE);

      // Oversized class read suggests child methods rather than repeating the class or :L slices
      const classOverflow = await aiceRead(
        "src/engine/matrix-pipeline.ts:MatrixTransformPipeline",
        {
          projectRoot: tmpDir,
          surface: "cli",
          maxBytes: 3_200,
        },
      );
      expect(Buffer.byteLength(classOverflow.output, "utf-8")).toBeLessThanOrEqual(3_200);
      expect(classOverflow.output).toContain(
        "batch symbols: aice read src/engine/matrix-pipeline.ts:MatrixTransformPipeline.composeProjection src/engine/matrix-pipeline.ts:MatrixTransformPipeline.invertRigidBody",
      );
      expect(classOverflow.output).not.toMatch(SEQUENTIAL_SLICE_TRAP_RE);
    });
  });

  describe("Finding 2: Multi-target 1-turn priority batch packing (< 9,216 B CLI ceiling)", () => {
    it("packs small bare files and :sym/:L selectors FIRST and auto-outlines >120L bare files in 1 turn (< 9,216 B)", async () => {
      const batchRes = await aiceRead(
        [
          "src/small-config.ts",
          "src/engine/world-kernel.ts",
          "tools/step_runner.py:build_step_manifest",
          "site/styles.css",
          "site/manifest.json",
        ],
        {
          projectRoot: tmpDir,
          surface: "cli",
        },
      );

      const outBytes = Buffer.byteLength(batchRes.output, "utf-8");
      expect(outBytes).toBeLessThanOrEqual(DEFAULT_CLI_READ_MAX_BYTES);
      expect(batchRes.output).not.toMatch(SEQUENTIAL_SLICE_TRAP_RE);

      // Small files & explicit :sym target are returned in full in Turn 1
      expect(batchRes.output).toContain("createDefaultBootOptions");
      expect(batchRes.output).toContain("def build_step_manifest(root_dir: str) -> dict:");
      expect(batchRes.output).toContain('"anti-paging-demo"');

      // Both oversized bare files are cleanly auto-outlined in Turn 1 without dropping later targets
      expect(batchRes.output).toContain("// Auto-outlined src/engine/world-kernel.ts");
      expect(batchRes.output).toContain("// Auto-outlined site/styles.css");
    });

    it("never lets an oversized bare file in executeContextStream swallow the 9 KB ceiling or starve subsequent :sym and small-file targets", async () => {
      // Force all 4 targets into executeContextStream (dense <=120L bare file + autoOutlineBareFiles: false)
      const streamRes = await aiceRead(
        [
          "src/small-config.ts",
          "src/engine/dense-under-120.ts",
          "src/engine/world-kernel.ts:stepWorldSimulation",
          "site/manifest.json",
        ],
        {
          projectRoot: tmpDir,
          surface: "cli",
          autoOutlineBareFiles: false,
        },
      );

      const bytes = Buffer.byteLength(streamRes.output, "utf-8");
      expect(bytes).toBeLessThanOrEqual(DEFAULT_CLI_READ_MAX_BYTES);
      expect(streamRes.output).not.toMatch(SEQUENTIAL_SLICE_TRAP_RE);

      // Explicit :sym (f3) and small bare files (f1, f4) are ALL present in full in 1 turn!
      expect(streamRes.output).toContain("createDefaultBootOptions");
      expect(streamRes.output).toContain("export function stepWorldSimulation");
      expect(streamRes.output).toContain('"anti-paging-demo"');

      // Oversized bare f2 is auto-outlined in-place rather than partial-filling & dropping f3/f4
      expect(streamRes.output).toContain(
        "// Auto-outlined src/engine/dense-under-120.ts (110L, >9 KB CLI) — batch symbols: aice read src/engine/dense-under-120.ts:denseHandler_0 src/engine/dense-under-120.ts:denseHandler_1",
      );
      expect(streamRes.targets[1]?.autoOutlined).toBe(true);

      // Original request order f1 -> f2 -> f3 -> f4 is preserved
      const idx1 = streamRes.output.indexOf("src/small-config.ts");
      const idx2 = streamRes.output.indexOf("Auto-outlined src/engine/dense-under-120.ts");
      const idx3 = streamRes.output.indexOf("src/engine/world-kernel.ts");
      const idx4 = streamRes.output.indexOf("site/manifest.json");
      expect(idx1).toBeGreaterThanOrEqual(0);
      expect(idx2).toBeGreaterThan(idx1);
      expect(idx3).toBeGreaterThan(idx2);
      expect(idx4).toBeGreaterThan(idx3);
    });
  });

  describe("Single-file read & small-slice loss elimination (zero singleFileReadLossCalls)", () => {
    it("records zero single-file read losses across bare small files, whole-file :L ranges, sub-slices, symbols, and auto-outlines", async () => {
      const telDir = fs.mkdtempSync(path.join(os.tmpdir(), "aice-anti-paging-tel-"));
      const telPath = path.join(telDir, "gains.jsonl");
      const prevTelPath = process.env.AICE_TELEMETRY_PATH;
      process.env.AICE_TELEMETRY_PATH = telPath;

      try {
        const targetsToVerify = [
          "src/small-config.ts",
          "src/small-config.ts:L1-L50",
          "src/small-config.ts:L1-L120",
          "src/contracts/IValidator.ts",
          "src/contracts/IValidator.ts:L1-L40",
          "src/contracts/IValidator.ts:L1-L120",
          "site/manifest.json",
          "site/manifest.json:L1-L20",
          "src/engine/world-kernel.ts",
          "src/engine/world-kernel.ts:initializeWorldKernel",
          "src/engine/world-kernel.ts:L1-L25",
          "tools/step_runner.py",
          "site/styles.css",
        ];

        for (const t of targetsToVerify) {
          await aiceRead(t, { projectRoot: tmpDir, surface: "cli" });
        }

        const events = readTelemetryEvents(telPath);
        expect(events.length).toBe(targetsToVerify.length);

        for (const ev of events) {
          const rn = ev.realisticNativeCl100k ?? ev.nativeCl100k;
          expect(ev.aiceCl100k).toBeLessThanOrEqual(rn);
        }

        const econ = computeProjectSystemicEconomics(events, []);
        expect(econ.singleFileReadLossCalls).toBe(0);
        expect(econ.singleFileReadLossPct).toBe(0);
        expect(econ.netEndToEndSavedCl100k).toBeGreaterThan(0);
        expect(econ.costWeightedNetDeltaCl100k).toBeGreaterThan(0);
      } finally {
        if (prevTelPath === undefined) {
          delete process.env.AICE_TELEMETRY_PATH;
        } else {
          process.env.AICE_TELEMETRY_PATH = prevTelPath;
        }
        fs.rmSync(telDir, { recursive: true, force: true });
      }
    });
  });
});
