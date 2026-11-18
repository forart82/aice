import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setProjectAiceEnabled } from "../src/config/project-config.js";
import { loadTelemetryEvents } from "../src/telemetry/index.js";
import { estimateTokens } from "../src/tokenomics/index.js";
import { computeHonestReadBaselineText } from "../src/tools/context.js";
import { aiceRead } from "../src/tools/read.js";

function cl100k(text: string): number {
  return estimateTokens(text, "cl100k_base");
}

function cliCallTokens(cmd: string, stdout: string): number {
  const req = JSON.stringify({
    CommandLine: cmd,
    WaitMsBeforeAsync: 5000,
    toolSummary: "Run command",
  });
  return cl100k(`${req}\nCommand exited with code 0.\n\nCommand output:\n${stdout}`);
}

function mcpReadCallTokens(args: Record<string, unknown>, stdout: string): number {
  return cl100k(`${JSON.stringify(args)}\n${stdout}`);
}

describe("Real-World Read/Search/Find BPE Token Reduction & R1-R5 Regression Suite", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aice-realworld-read-"));
    setProjectAiceEnabled(tmpDir, true);

    fs.mkdirSync(path.join(tmpDir, "src", "config"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "src", "engine"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "src", "services", "deep", "nested"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "empty_dir"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "scripts"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "docs"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "android", "app", "src", "main", "java", "com", "neon"), {
      recursive: true,
    });
    fs.mkdirSync(
      path.join(
        tmpDir,
        "node_modules",
        "@capacitor",
        "android",
        "capacitor",
        "src",
        "main",
        "java",
        "com",
        "getcapacitor",
      ),
      { recursive: true },
    );
    fs.mkdirSync(path.join(tmpDir, "node_modules", "@capacitor", "cli", "dist"), {
      recursive: true,
    });

    // 1a. Small clean 55-line TS file (no license header)
    const themeLines = [
      'export const THEME_ACCENT = "#00f5d4";',
      "export const FRAME_BUDGET_MS = 16.67;",
      "",
      "export interface NeonPalette {",
      "  obsidianBg: string;",
      "  magentaLaser: string;",
      "  emeraldGlow: string;",
      "  groundPoolDelta: number;",
      "}",
      "",
      "export function createDefaultPalette(): NeonPalette {",
      "  return {",
      '    obsidianBg: "#020306",',
      '    magentaLaser: "#ff007f",',
      "    emeraldGlow: THEME_ACCENT,",
      "    groundPoolDelta: 0.315,",
      "  };",
      "}",
      ...Array.from(
        { length: 36 },
        (_, i) =>
          `export function scaleLuminanceStep_${i}(base: number): number { return Math.min(1, base * ${(1 + i * 0.02).toFixed(2)}); }`,
      ),
    ];
    fs.writeFileSync(
      path.join(tmpDir, "src", "config", "theme.ts"),
      `${themeLines.join("\n")}\n`,
      "utf-8",
    );

    // 1b. Small 75-line TS file WITH @license header and decorative dividers
    const licensedLines = [
      "/**",
      " * @license",
      " * Copyright (c) 2026 Neon Grid Studio",
      " * SPDX-License-Identifier: Apache-2.0",
      " */",
      "",
      "// ============================================================================",
      "// Audio Synthesis Constants",
      "// ============================================================================",
      "export const PENTATONIC_RATIOS = [1.0, 1.125, 1.25, 1.5, 1.667] as const;",
      ...Array.from(
        { length: 64 },
        (_, i) =>
          `export function computeEnvelopeSample_${i}(t: number): number { return Math.exp(-t * ${i + 1}); }`,
      ),
    ];
    fs.writeFileSync(
      path.join(tmpDir, "src", "config", "audio.ts"),
      `${licensedLines.join("\n")}\n`,
      "utf-8",
    );

    // 2. Large >300L monolith TS file (360 lines) with imports, class methods, and search targets
    const monolithLines = [
      ...Array.from(
        { length: 10 },
        (_, i) => `import { scaleLuminanceStep_${i} } from "../config/theme.js";`,
      ),
      'import { THEME_ACCENT, FRAME_BUDGET_MS, type NeonPalette } from "../config/theme.js";',
      "",
      "export class WorldRenderer {",
      "  private frameCount = 0;",
      "",
      "  public renderFrame(palette: NeonPalette, dtMs: number): number {",
      "    const clampedDt = Math.min(dtMs, FRAME_BUDGET_MS);",
      "    this.frameCount += 1;",
      "    const accentBoost = palette.emeraldGlow === THEME_ACCENT ? 1.25 : 1.0;",
      "    return clampedDt * accentBoost + scaleLuminanceStep_0(0.5);",
      "  }",
      "",
      "  public resizeViewport(width: number, height: number): string {",
      "    return `${Math.max(1, width)}x${Math.max(1, height)}`;",
      "  }",
      "",
      "  public dispose(): void {",
      "    this.frameCount = 0;",
      "  }",
      "}",
      "",
      ...Array.from({ length: 328 }, (_, i) => {
        const fnIdx = Math.floor(i / 8);
        const mod = i % 8;
        if (mod === 0) {
          return `export function computeMeshPass_${fnIdx}(seed: number, budget = FRAME_BUDGET_MS): number {`;
        }
        if (mod === 7) {
          return "  return acc;\n}";
        }
        if (mod === 1) {
          return `  let acc = seed + ${fnIdx};`;
        }
        return `  acc = (acc * 1.03125 + ${mod}) % Math.max(1, budget);`;
      }),
    ];
    fs.writeFileSync(
      path.join(tmpDir, "src", "engine", "renderer.ts"),
      `${monolithLines.join("\n")}\n`,
      "utf-8",
    );

    // Deep nested file for `find --depth` testing
    fs.writeFileSync(
      path.join(tmpDir, "src", "services", "deep", "nested", "worker.ts"),
      "export const DEEP_WORKER = true;\n",
      "utf-8",
    );

    // Extra files so workspace has >20 files for find grouping
    for (let i = 1; i <= 14; i++) {
      fs.writeFileSync(
        path.join(tmpDir, "src", "services", `svc_${String(i).padStart(2, "0")}.ts`),
        `export function runSvc_${i}(v: number): number {\n  return v + ${i};\n}\n`,
        "utf-8",
      );
    }

    // Python, Markdown, Kotlin
    fs.writeFileSync(
      path.join(tmpDir, "scripts", "build_assets.py"),
      [
        "FRAME_BUDGET_MS = 16.67",
        "",
        "def pack_sprite_atlas(width: int, height: int, gutter: int = 2) -> dict:",
        '    return {"w": width + gutter * 2, "h": height + gutter * 2, "budget": FRAME_BUDGET_MS}',
        "",
        ...Array.from(
          { length: 30 },
          (_, i) => `def helper_stage_${i}(x: int) -> int:\n    return x + ${i}`,
        ),
      ].join("\n") + "\n",
      "utf-8",
    );

    fs.writeFileSync(
      path.join(tmpDir, "docs", "GUIDE.md"),
      [
        "# Architecture & Rendering Guide",
        "",
        "## Frame Budget Rules",
        "Maintain `FRAME_BUDGET_MS <= 16.67` across Android and desktop targets.",
        "",
        "## Touch Ergonomics",
        "Enforce 48dp minimum touch targets and radial joystick deadzones.",
        ...Array.from(
          { length: 24 },
          (_, i) => `- Invariant ${i + 1}: clamp delta-time spikes before physics integration.`,
        ),
      ].join("\n") + "\n",
      "utf-8",
    );

    fs.writeFileSync(
      path.join(tmpDir, "android", "app", "src", "main", "java", "com", "neon", "MainActivity.kt"),
      [
        "package com.neon",
        "",
        "class MainActivity {",
        "  fun currentFrameBudget(): Double {",
        "    return 16.67",
        "  }",
        ...Array.from({ length: 22 }, (_, i) => `  fun stageMetric_${i}(v: Int): Int = v + ${i}`),
        "}",
      ].join("\n") + "\n",
      "utf-8",
    );
    // R3: Broad extensions (.java, .pro, .kts, .gradle, .xml, .properties, .webmanifest, .example, .cjs, .ini)
    const bridgeJavaLines = [
      "package com.neon;",
      "",
      "import java.util.Map;",
      "",
      "public class BridgePlugin {",
      "  private boolean initialized = false;",
      "",
      "  public void loadPlugin() {",
      "    this.initialized = true;",
      "  }",
      "",
      "  public String handleInvoke(String action, Map<String, Object> payload) {",
      '    if (!this.initialized) return "ERR_NOT_READY";',
      '    return "OK:" + action + ":JAVA_BRIDGE_MARKER";',
      "  }",
      ...Array.from(
        { length: 130 },
        (_, i) => `  public int computeMetric_${i}(int v) { return v + ${i}; }`,
      ),
      "}",
    ];
    fs.writeFileSync(
      path.join(
        tmpDir,
        "android",
        "app",
        "src",
        "main",
        "java",
        "com",
        "neon",
        "BridgePlugin.java",
      ),
      `${bridgeJavaLines.join("\n")}\n`,
      "utf-8",
    );

    fs.writeFileSync(
      path.join(tmpDir, "android", "app", "proguard-rules.pro"),
      "-keep class com.neon.** { *; }\n-dontwarn com.getcapacitor.**\n",
      "utf-8",
    );
    fs.writeFileSync(
      path.join(tmpDir, "android", "build.gradle.kts"),
      'plugins {\n  id("com.android.application") version "8.5.0" apply false\n}\n',
      "utf-8",
    );
    fs.writeFileSync(
      path.join(tmpDir, "android", "settings.gradle"),
      "rootProject.name = 'neon-grid'\ninclude ':app'\n",
      "utf-8",
    );
    fs.writeFileSync(
      path.join(tmpDir, "android", "app", "src", "main", "AndroidManifest.xml"),
      '<?xml version="1.0" encoding="utf-8"?>\n<manifest package="com.neon"><application android:label="NeonGrid"/></manifest>\n',
      "utf-8",
    );
    fs.writeFileSync(
      path.join(tmpDir, "android", "gradle.properties"),
      "org.gradle.jvmargs=-Xmx2048m\nandroid.useAndroidX=true\n",
      "utf-8",
    );
    fs.writeFileSync(
      path.join(tmpDir, "manifest.webmanifest"),
      JSON.stringify({ name: "Neon Grid", display: "standalone", orientation: "landscape" }),
      "utf-8",
    );
    fs.writeFileSync(
      path.join(tmpDir, ".env.example"),
      "PUBLIC_API_URL=https://api.example.com\nENABLE_AUDIO=1\n",
      "utf-8",
    );
    fs.writeFileSync(
      path.join(tmpDir, "postcss.config.cjs"),
      "module.exports = { plugins: {} };\n",
      "utf-8",
    );
    fs.writeFileSync(path.join(tmpDir, "editor.ini"), "[core]\nindent_size = 2\n", "utf-8");

    // Extensionless scripts (`verify`, `new-project`)
    fs.writeFileSync(
      path.join(tmpDir, "verify"),
      "#!/usr/bin/env bash\nset -euo pipefail\necho 'VERIFY_GATE_OK'\n",
      { encoding: "utf-8", mode: 0o755 },
    );
    fs.writeFileSync(
      path.join(tmpDir, "new-project"),
      "#!/usr/bin/env python3\ndef bootstrap_project(name: str) -> str:\n    return f'created:{name}'\n",
      { encoding: "utf-8", mode: 0o755 },
    );

    // Worktree `.git` gitfile + lockfiles (`package-lock.json`, `bun.lock`) + binary file (must ALL be skipped in find/search)
    fs.writeFileSync(
      path.join(tmpDir, ".git"),
      "gitdir: /tmp/parent-repo/.git/worktrees/swarm-worker\n",
      "utf-8",
    );
    fs.writeFileSync(
      path.join(tmpDir, "package-lock.json"),
      JSON.stringify({ name: "lock", lockfileVersion: 3, packages: {} }, null, 2),
      "utf-8",
    );
    fs.writeFileSync(
      path.join(tmpDir, "bun.lock"),
      '{\n  "lockfileVersion": 1,\n  "workspaces": {}\n}\n',
      "utf-8",
    );
    fs.writeFileSync(path.join(tmpDir, "icon.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]));

    // Explicit node_modules/@capacitor/... targets
    fs.writeFileSync(
      path.join(
        tmpDir,
        "node_modules",
        "@capacitor",
        "android",
        "capacitor",
        "src",
        "main",
        "java",
        "com",
        "getcapacitor",
        "CapConfig.java",
      ),
      [
        "package com.getcapacitor;",
        "public class CapConfig {",
        "  private boolean allowMixedContent = false;",
        "  public boolean isMixedContentAllowed() {",
        "    return this.allowMixedContent;",
        "  }",
        "}",
      ].join("\n") + "\n",
      "utf-8",
    );
    fs.writeFileSync(
      path.join(tmpDir, "node_modules", "@capacitor", "cli", "dist", "index.js"),
      'export const CAPACITOR_DIST_VERSION = "6.1.0";\n',
      "utf-8",
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("1. eliminates single-file negative-delta bloat across <=120L TS, licensed TS, MD, Python & Kotlin (Non-Expansion Invariant)", async () => {
    const cases = [
      "src/config/theme.ts",
      "src/config/audio.ts",
      "docs/GUIDE.md",
      "scripts/build_assets.py",
      "android/app/src/main/java/com/neon/MainActivity.kt",
    ];

    for (const rel of cases) {
      const raw = fs.readFileSync(path.join(tmpDir, rel), "utf-8");
      const res = await aiceRead(rel, { projectRoot: tmpDir, surface: "cli" });

      // Zero decorative bloat & zero unrequested sibling outlines
      expect(res.output).not.toContain("│");
      expect(res.output).not.toContain("// ===");
      expect(res.output).not.toContain("// siblings");

      // Non-expansion invariant: raw AICE output tokens <= raw file tokens
      expect(cl100k(res.output)).toBeLessThanOrEqual(cl100k(raw));

      // End-to-end tool call tokens strictly beat native read_file
      const nativeReadBaseline = computeHonestReadBaselineText({
        rawSource: raw,
        relPath: rel,
        mode: "file",
        includeToolWrapper: true,
      });
      const aiceTotal = cliCallTokens(`aice read ${rel}`, res.output);
      const nativeTotal = cl100k(nativeReadBaseline);
      expect(aiceTotal).toBeLessThan(nativeTotal);
    }

    // Licensed file specifically strips @license + decorative dividers -> strictly fewer tokens than raw file
    const rawAudio = fs.readFileSync(path.join(tmpDir, "src/config/audio.ts"), "utf-8");
    const audioRes = await aiceRead("src/config/audio.ts", { projectRoot: tmpDir, surface: "cli" });
    expect(cl100k(audioRes.output)).toBeLessThan(cl100k(rawAudio));
    // Verify interior divider skipping emits exact disk-line discontinuity marker (L10: PENTATONIC_RATIOS)
    expect(audioRes.output).toContain("// src/config/audio.ts:7-74");
    expect(audioRes.output).toContain("10: export const PENTATONIC_RATIOS");

    // Micro 5-line file with @license (L1) + interior divider (L3): NEVER silently shifts L4 to apparent L3!
    const demo5Path = path.join(tmpDir, "src", "demo5.ts");
    const demo5Raw =
      [
        "/** @license SPDX-License-Identifier: Apache-2.0 */",
        "export const A = 1;",
        "// ==================================================",
        "export const B = 2;",
        "export const C = 3;",
      ].join("\n") + "\n";
    fs.writeFileSync(demo5Path, demo5Raw, "utf-8");
    const demo5Res = await aiceRead("src/demo5.ts", { projectRoot: tmpDir, surface: "cli" });
    expect(cl100k(demo5Res.output)).toBeLessThanOrEqual(cl100k(demo5Raw));
    if (demo5Res.output.startsWith("// src/demo5.ts:2-5")) {
      expect(demo5Res.output).toContain("4: export const B = 2;");
    } else {
      // Fallback to unmodified raw source anchored at L1
      expect(demo5Res.output.split("\n")[3]).toBe("export const B = 2;");
    }
    const demo5Nat = computeHonestReadBaselineText({
      rawSource: demo5Raw,
      relPath: "src/demo5.ts",
      mode: "file",
      includeToolWrapper: true,
    });
    expect(mcpReadCallTokens({ path: "src/demo5.ts" }, demo5Res.output)).toBeLessThan(
      cl100k(demo5Nat),
    );

    // :symbol containing an interior decorative divider also emits exact disk-line discontinuity marker
    const divSymPath = path.join(tmpDir, "src", "div_sym.ts");
    fs.writeFileSync(
      divSymPath,
      [
        "export function computeWithDivider(x: number): number {",
        "  const a = x + 1;",
        "  // ==================================================",
        "  const b = a * 2;",
        "  return b;",
        "}",
      ].join("\n") + "\n",
      "utf-8",
    );
    const divSymRes = await aiceRead("src/div_sym.ts:computeWithDivider", {
      projectRoot: tmpDir,
      surface: "cli",
    });
    expect(divSymRes.output).toContain("// src/div_sym.ts:1-6");
    expect(divSymRes.output).toContain("4:   const b = a * 2;");
  });

  it("2. auto-outlines >300L monolith bare reads with 60-90% BPE token reduction vs native read_file", async () => {
    const rel = "src/engine/renderer.ts";
    const raw = fs.readFileSync(path.join(tmpDir, rel), "utf-8");
    const res = await aiceRead(rel, { projectRoot: tmpDir, surface: "cli" });

    expect(res.mode).toBe("auto-outline-file");
    expect(res.output).toContain("WorldRenderer");
    expect(res.output).toContain("renderFrame");
    expect(res.output).toMatch(/\[L\d+-L\d+\]/);

    const nativeBaseline = computeHonestReadBaselineText({
      rawSource: raw,
      relPath: rel,
      mode: "file",
      includeToolWrapper: true,
    });
    const aiceTok = cliCallTokens(`aice read ${rel}`, res.output);
    const nativeTok = cl100k(nativeBaseline);
    const savingsRatio = (nativeTok - aiceTok) / nativeTok;
    expect(savingsRatio).toBeGreaterThanOrEqual(0.6);
  });

  it("3. beats surgical read_file on :symbol, :Lstart-Lend, R4 partial comma-batch symbols, and R4 comma-joined multi-file slices", async () => {
    const rendererRel = "src/engine/renderer.ts";
    const rawRenderer = fs.readFileSync(path.join(tmpDir, rendererRel), "utf-8");

    // 3a. :symbol slice vs rg locate + surgical read_file
    const symRes = await aiceRead(`${rendererRel}:WorldRenderer.renderFrame`, {
      projectRoot: tmpDir,
      surface: "cli",
    });
    expect(symRes.output).toContain("renderFrame(palette: NeonPalette");
    expect(symRes.output).toContain("// siblings in WorldRenderer:");
    expect(symRes.output).not.toContain("│");
    const nativeSymBaseline = computeHonestReadBaselineText({
      rawSource: rawRenderer,
      relPath: rendererRel,
      symbolSelector: "WorldRenderer.renderFrame",
      mode: "slice",
      includeToolWrapper: true,
    });
    expect(
      cliCallTokens(`aice read ${rendererRel}:WorldRenderer.renderFrame`, symRes.output),
    ).toBeLessThan(cl100k(nativeSymBaseline));

    // 3b. :Lstart-Lend slice (with >=5 import block folding & zero sibling outline bloat)
    const rangeRes = await aiceRead(`${rendererRel}:L1-L35`, {
      projectRoot: tmpDir,
      surface: "cli",
    });
    expect(rangeRes.output).toContain("// src/engine/renderer.ts:1-35");
    expect(rangeRes.output).not.toContain("// siblings");
    expect(rangeRes.output).not.toContain("│");
    const nativeRangeBaseline = computeHonestReadBaselineText({
      rawSource: rawRenderer,
      relPath: rendererRel,
      symbolSelector: "L1-L35",
      mode: "slice",
      includeToolWrapper: true,
    });
    expect(cliCallTokens(`aice read ${rendererRel}:L1-L35`, rangeRes.output)).toBeLessThan(
      cl100k(nativeRangeBaseline),
    );

    // 3c (R4). Comma-batched symbols with 1 missing symbol -> soft partial match instead of failing whole call
    const partialSymRes = await aiceRead(
      `${rendererRel}:WorldRenderer.renderFrame,WorldRenderer.resizeViewport,WorldRenderer.deletedGhostMethod,WorldRenderer.dispose`,
      { projectRoot: tmpDir, surface: "cli" },
    );
    expect(partialSymRes.output).toContain("renderFrame");
    expect(partialSymRes.output).toContain("resizeViewport");
    expect(partialSymRes.output).toContain("dispose");
    expect(partialSymRes.output).toContain("// not found: WorldRenderer.deletedGhostMethod");

    // 3d (R4). Comma-joined multi-file target string splits cleanly into 2 files in 1 turn
    const commaMultiTarget = "src/config/theme.ts:L1-L18,src/engine/renderer.ts:L12-L28";
    const commaMultiRes = await aiceRead(commaMultiTarget, {
      projectRoot: tmpDir,
      surface: "cli",
    });
    expect(commaMultiRes.output).toContain("// src/config/theme.ts:1-18");
    expect(commaMultiRes.output).toContain("// src/engine/renderer.ts:12-28");
    const rawTheme = fs.readFileSync(path.join(tmpDir, "src/config/theme.ts"), "utf-8");
    const natMultiTok =
      cl100k(
        computeHonestReadBaselineText({
          rawSource: rawTheme,
          relPath: "src/config/theme.ts",
          symbolSelector: "L1-L18",
          mode: "slice",
          includeToolWrapper: true,
        }),
      ) +
      cl100k(
        computeHonestReadBaselineText({
          rawSource: rawRenderer,
          relPath: rendererRel,
          symbolSelector: "L12-L28",
          mode: "slice",
          includeToolWrapper: true,
        }),
      );
    expect(cliCallTokens(`aice read ${commaMultiTarget}`, commaMultiRes.output)).toBeLessThan(
      natMultiTok,
    );
  });

  it("4. beats multiple native read_file calls on polyglot batch reads and directory reads", async () => {
    const batchTargets = [
      "src/config/theme.ts:createDefaultPalette",
      "scripts/build_assets.py:pack_sprite_atlas",
      "docs/GUIDE.md",
      "android/app/src/main/java/com/neon/BridgePlugin.java:handleInvoke",
    ];
    const batchRes = await aiceRead(batchTargets, { projectRoot: tmpDir, surface: "cli" });
    expect(batchRes.output).toContain("createDefaultPalette");
    expect(batchRes.output).toContain("pack_sprite_atlas");
    expect(batchRes.output).toContain("Architecture & Rendering Guide");
    expect(batchRes.output).toContain("JAVA_BRIDGE_MARKER");

    let nativeSum = 0;
    for (const t of batchTargets) {
      const [fp, sym] = t.split(":");
      const raw = fs.readFileSync(path.join(tmpDir, fp!), "utf-8");
      nativeSum += cl100k(
        computeHonestReadBaselineText({
          rawSource: raw,
          relPath: fp,
          symbolSelector: sym,
          mode: sym ? "slice" : "file",
          includeToolWrapper: true,
        }),
      );
    }
    expect(cliCallTokens(`aice read ${batchTargets.join(" ")}`, batchRes.output)).toBeLessThan(
      nativeSum,
    );

    // Directory structural read beats fd + surgical file previews
    const dirRes = await aiceRead("src/services", { projectRoot: tmpDir, surface: "cli" });
    expect(dirRes.mode).toBe("auto-outline-dir");
    expect(dirRes.output).toContain("runSvc_1");
    const svcFiles = fs
      .readdirSync(path.join(tmpDir, "src", "services"))
      .filter((n) => n.endsWith(".ts"))
      .map((n) => ({
        relPath: `src/services/${n}`,
        rawSource: fs.readFileSync(path.join(tmpDir, "src", "services", n), "utf-8"),
      }));
    const dirBaseline = computeHonestReadBaselineText({
      relPath: "src/services",
      workspaceFiles: svcFiles,
      mode: "outline-dir",
      includeToolWrapper: true,
    });
    expect(cliCallTokens("aice read src/services", dirRes.output)).toBeLessThan(
      cl100k(dirBaseline),
    );
  });

  it("5. fixes R1 multi-dir search, R2 0-match '.' & grep-BRE '\\|', R5 unclosed '/foo' hint, and beats rg -n -C 2", async () => {
    // R1: Multi-dir search where first dir has 0 matches must still search all remaining dirs without :outline downgrades
    const multiDirSearch = await aiceRead(["empty_dir", "src", "scripts", "docs"], {
      projectRoot: tmpDir,
      search: "FRAME_BUDGET_MS",
      surface: "cli",
    });
    expect(multiDirSearch.mode).toBe("search");
    expect(multiDirSearch.output).toContain("src/config/theme.ts:");
    expect(multiDirSearch.output).toContain("src/engine/renderer.ts:");
    expect(multiDirSearch.output).toContain("scripts/build_assets.py:");
    expect(multiDirSearch.output).toContain("docs/GUIDE.md:");
    expect(multiDirSearch.output).not.toContain(":L1-L160");
    expect(multiDirSearch.output).not.toContain("Auto-outlined");

    const allSearchedEntries = [
      "src/config/theme.ts",
      "src/engine/renderer.ts",
      "scripts/build_assets.py",
      "docs/GUIDE.md",
    ].map((rel) => ({
      relPath: rel,
      rawSource: fs.readFileSync(path.join(tmpDir, rel), "utf-8"),
    }));
    const rgBaseline = computeHonestReadBaselineText({
      relPath: "empty_dir src scripts docs",
      workspaceFiles: allSearchedEntries,
      symbolSelector: "/FRAME_BUDGET_MS/",
      mode: "search",
      includeToolWrapper: true,
    });
    expect(
      cliCallTokens(
        'aice search "FRAME_BUDGET_MS" empty_dir src scripts docs',
        multiDirSearch.output,
      ),
    ).toBeLessThan(cl100k(rgBaseline));

    // R1: Mixed file + dir and overlapping dirs deduplicate canonical files cleanly
    const overlapSearch = await aiceRead(["src/config/theme.ts", "src/config", "src"], {
      projectRoot: tmpDir,
      search: "THEME_ACCENT",
      surface: "cli",
    });
    expect(overlapSearch.output.match(/^src\/config\/theme\.ts:$/gm)).toHaveLength(1);

    // R2: 0-match on '.' has clean `in .` message without empty `// ===  ===`
    const zeroDot = await aiceRead(".", {
      projectRoot: tmpDir,
      search: "DEFINITELY_ABSENT_TOKEN_999",
      surface: "cli",
    });
    expect(zeroDot.output).toBe("// 0 matches for 'DEFINITELY_ABSENT_TOKEN_999' in .");
    expect(zeroDot.output).not.toContain("// ===");

    // R2: Grep-BRE `\|` alternation works in both search option and inline :/a\|b/ selector
    const breSearch = await aiceRead("src/config", {
      projectRoot: tmpDir,
      search: "PENTATONIC_RATIOS\\|createDefaultPalette",
      surface: "cli",
    });
    expect(breSearch.output).toContain("PENTATONIC_RATIOS");
    expect(breSearch.output).toContain("createDefaultPalette");

    // R5: Unquoted shell pipe split `file:/NON_EXISTENT` gives clear quoting guidance
    await expect(
      aiceRead("src/engine/renderer.ts:/NON_EXISTENT_LEFT_BRANCH", {
        projectRoot: tmpDir,
        surface: "cli",
      }),
    ).rejects.toThrow(/Quote regex selectors containing '\|' in shell/);

    // R5: When left branch exists, routes to search instead of failing literal symbol '/FRAME_BUDGET_MS'
    const unclosedHit = await aiceRead("src/engine/renderer.ts:/FRAME_BUDGET_MS", {
      projectRoot: tmpDir,
      surface: "cli",
    });
    expect(unclosedHit.mode).toBe("search");
    expect(unclosedHit.output).toContain("FRAME_BUDGET_MS");
  });

  it("6. bounds directory traversal with maxDepth on find, skips lockfiles/binaries, and beats fd in BPE tokens", async () => {
    const shallowFind = await aiceRead(".", {
      projectRoot: tmpDir,
      filesOnly: true,
      maxDepth: 2,
      surface: "cli",
    });
    expect(shallowFind.mode).toBe("files");
    expect(shallowFind.output).toContain("verify");
    expect(shallowFind.output).toContain("docs/GUIDE.md");
    expect(shallowFind.output).not.toContain("package-lock.json");
    expect(shallowFind.output).not.toContain("bun.lock");
    expect(shallowFind.output).not.toContain(".git (");
    expect(shallowFind.output).not.toMatch(/(?:^|, )\.git\b/m);
    expect(shallowFind.output).not.toContain("icon.png");
    expect(shallowFind.output).not.toContain("node_modules");

    const parsedShallowJson = JSON.parse(
      (
        await aiceRead(".", {
          projectRoot: tmpDir,
          filesOnly: true,
          maxDepth: 2,
          json: true,
        })
      ).output,
    ) as { files: Array<{ path: string }> };
    const bareFdShallow = computeHonestReadBaselineText({
      relPath: ".",
      projectRoot: tmpDir,
      mode: "files",
      maxDepth: 2,
      filePaths: parsedShallowJson.files.map((f) => f.path),
      includeToolWrapper: false,
    });
    // Bare unwrapped `aice find -d 2` stdout beats bare unwrapped `fd -d 2` stdout too!
    expect(cl100k(shallowFind.output)).toBeLessThan(cl100k(bareFdShallow));

    const fdShallowBaseline = computeHonestReadBaselineText({
      relPath: ".",
      projectRoot: tmpDir,
      mode: "files",
      maxDepth: 2,
      filePaths: parsedShallowJson.files.map((f) => f.path),
      includeToolWrapper: true,
    });
    expect(cliCallTokens("aice find -d 2", shallowFind.output)).toBeLessThan(
      cl100k(fdShallowBaseline),
    );
    // Full workspace tree (>25 files) uses compact directory grouping and beats fd
    const fullFind = await aiceRead(".", {
      projectRoot: tmpDir,
      filesOnly: true,
      surface: "cli",
    });
    expect(fullFind.output).toContain("worker.ts");
    const parsedFullJson = JSON.parse(
      (await aiceRead(".", { projectRoot: tmpDir, filesOnly: true, json: true })).output,
    ) as { files: Array<{ path: string }> };
    const fdFullBaseline = computeHonestReadBaselineText({
      relPath: ".",
      projectRoot: tmpDir,
      mode: "files",
      filePaths: parsedFullJson.files.map((f) => f.path),
      includeToolWrapper: true,
    });
    expect(cliCallTokens("aice find", fullFind.output)).toBeLessThan(cl100k(fdFullBaseline));
  });

  it("7. supports .java, .pro, .kts, .gradle, .xml, .properties, .webmanifest, .example, extensionless scripts & explicit node_modules/<pkg> (R3)", async () => {
    const javaRel = "android/app/src/main/java/com/neon/BridgePlugin.java";
    // >120L Java file auto-outlines structurally with class & method ranges
    const javaOutline = await aiceRead(javaRel, { projectRoot: tmpDir, surface: "cli" });
    expect(javaOutline.mode).toBe("auto-outline-file");
    expect(javaOutline.output).toContain("class BridgePlugin");
    expect(javaOutline.output).toContain("handleInvoke");

    // Surgical :method slice on .java file
    const javaMethod = await aiceRead(`${javaRel}:handleInvoke`, {
      projectRoot: tmpDir,
      surface: "cli",
    });
    expect(javaMethod.output).toContain("JAVA_BRIDGE_MARKER");

    // Extensionless scripts (`verify` and `new-project`) + config extensions
    for (const extTarget of [
      "verify",
      "new-project",
      "android/app/proguard-rules.pro",
      "android/build.gradle.kts",
      "android/settings.gradle",
      "android/app/src/main/AndroidManifest.xml",
      "android/gradle.properties",
      "manifest.webmanifest",
      ".env.example",
      "postcss.config.cjs",
      "editor.ini",
    ]) {
      const r = await aiceRead(extTarget, { projectRoot: tmpDir, surface: "cli" });
      expect(r.output.length).toBeGreaterThan(10);
      expect(r.output).not.toContain("│");
    }

    // Explicit node_modules/@capacitor/... search, find, and read are NEVER filtered to 0 matches!
    const nmSearch = await aiceRead("node_modules/@capacitor/android", {
      projectRoot: tmpDir,
      search: "isMixedContentAllowed",
      surface: "cli",
    });
    expect(nmSearch.output).toContain("CapConfig.java:");
    expect(nmSearch.output).toContain("isMixedContentAllowed");

    const nmDistSearch = await aiceRead("node_modules/@capacitor/cli", {
      projectRoot: tmpDir,
      search: "CAPACITOR_DIST_VERSION",
      surface: "cli",
    });
    expect(nmDistSearch.output).toContain("dist/index.js:");
    expect(nmDistSearch.output).toContain("6.1.0");

    const nmFind = await aiceRead("node_modules/@capacitor", {
      projectRoot: tmpDir,
      filesOnly: true,
      surface: "cli",
    });
    expect(nmFind.output).toContain("CapConfig.java");
    expect(nmFind.output).toContain("index.js");
  });
  it("8. records strictly honest unwrapped telemetry (n1 === rawFile, rn <= n1, zero wrapper inflation, 0-match negative delta)", async () => {
    const telemetryFile = path.join(tmpDir, "telemetry", "gains.jsonl");
    const prevEnv = process.env.AICE_TELEMETRY_PATH;
    process.env.AICE_TELEMETRY_PATH = telemetryFile;
    try {
      const rawTheme = fs.readFileSync(path.join(tmpDir, "src/config/theme.ts"), "utf-8");
      await aiceRead("src/config/theme.ts", { projectRoot: tmpDir, surface: "cli" });
      await aiceRead("src/config/audio.ts", { projectRoot: tmpDir, surface: "cli" });
      await aiceRead("src/engine/renderer.ts", { projectRoot: tmpDir, surface: "cli" });
      await aiceRead("src/engine/renderer.ts:L15-L30", { projectRoot: tmpDir, surface: "cli" });
      await aiceRead("src", {
        projectRoot: tmpDir,
        search: "FRAME_BUDGET_MS",
        surface: "cli",
      });
      await aiceRead(".", {
        projectRoot: tmpDir,
        filesOnly: true,
        maxDepth: 2,
        surface: "cli",
      });
      await aiceRead("src", {
        projectRoot: tmpDir,
        search: "ZERO_MATCH_SENTINEL_XYZ_999",
        surface: "cli",
      });

      const events = loadTelemetryEvents(telemetryFile);
      expect(events.length).toBe(7);

      // Clean <=120L file: n1 === rn === exact raw file tokens (no {"Path":...} or 1: wrapper inflation!)
      expect(events[0]?.nativeCl100k).toBe(cl100k(rawTheme));
      expect(events[0]?.realisticNativeCl100k).toBe(cl100k(rawTheme));
      expect(events[0]?.aiceCl100k).toBeLessThanOrEqual(events[0]!.realisticNativeCl100k!);

      // Licensed file, monolith auto-outline, :L slice, search, and find -d 2 ALL beat unwrapped rn strictly!
      for (const idx of [1, 2, 3, 4, 5]) {
        const ev = events[idx]!;
        expect(ev.realisticNativeCl100k).toBeDefined();
        expect(ev.realisticNativeCl100k!).toBeLessThanOrEqual(ev.nativeCl100k);
        expect(ev.aiceCl100k).toBeLessThan(ev.realisticNativeCl100k!);
      }
      expect(events[5]?.filePath).toBe("<workspace-files>");

      // Zero-match search: rn === 0 (no {"CommandLine":...} wrapper padding!) -> negative realisticSavedCl100k
      const zeroEv = events[6]!;
      expect(zeroEv.realisticNativeCl100k).toBe(0);
      expect(zeroEv.realisticSavedCl100k).toBe(-zeroEv.aiceCl100k);
      expect(zeroEv.realisticSavedCl100k!).toBeLessThan(0);
    } finally {
      if (prevEnv === undefined) {
        delete process.env.AICE_TELEMETRY_PATH;
      } else {
        process.env.AICE_TELEMETRY_PATH = prevEnv;
      }
    }
  });
});
