/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 0 TDD Suite: Smart Multi-File Idioms Engine (Twinless Native-First Mode)
 * Covers:
 * - Category A: Native-first idiom discovery & SHA-256 provenance index (.aice-cache/idioms.json)
 * - Category B: Instant On/Off Toggle (aice idioms on/off, --idioms/--no-idioms, stale AI memory grace)
 * - Category C: Multi-file idiom read & smart multi-file idiom update (reordering, hygiene, cycle detection, atomic rollback)
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  isProjectIdiomsEnabled,
  loadProjectConfig,
  type ProjectIdiomDefinition,
  saveProjectConfig,
  setProjectIdiomsEnabled,
} from "../../src/config/project-config.js";
import {
  expandAiceSourceIdioms,
  IdiomCycleError,
  readProjectIdiom,
  scanProjectIdioms,
  updateProjectIdiom,
  validateIdiomDefinitions,
} from "../../src/idioms/index.js";
import { generateContext } from "../../src/tools/context.js";
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

describe("Smart Multi-File Idioms Engine (Twinless Native-First Mode)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aice-smart-idioms-"));
  });

  afterEach(() => {
    try {
      // Restore write permissions in case a rollback test locked a file
      const walkUnlock = (dir: string) => {
        if (!fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) walkUnlock(full);
          else {
            try {
              fs.chmodSync(full, 0o644);
            } catch {
              // ignore
            }
          }
        }
      };
      walkUnlock(tmpDir);
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  describe("Category A: Native-First Idiom Discovery & Provenance Cache", () => {
    it("discovers idioms directly across pure native .ts files with zero .aice files on disk and writes provenance to .aice-cache/idioms.json", () => {
      const srcDir = path.join(tmpDir, "src");
      fs.mkdirSync(srcDir, { recursive: true });

      const rendererA = `export class CircleRenderer {
  public drawRing(ctx: any, x: number, y: number, r: number): void {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 6.283185);
    ctx.fill();
    ctx.closePath();
  }
}
`;
      const rendererB = `export class NodeRenderer {
  public drawNode(ctx: any, px: number, py: number, rad: number): void {
    ctx.beginPath();
    ctx.arc(px, py, rad, 0, 6.283185);
    ctx.fill();
    ctx.closePath();
  }
}
`;
      const rendererC = `export class ParticleRenderer {
  public drawParticle(ctx: any, cx: number, cy: number, size: number): void {
    ctx.beginPath();
    ctx.arc(cx, cy, size, 0, 6.283185);
    ctx.fill();
    ctx.closePath();
  }
}
`;

      fs.writeFileSync(path.join(srcDir, "CircleRenderer.ts"), rendererA, "utf-8");
      fs.writeFileSync(path.join(srcDir, "NodeRenderer.ts"), rendererB, "utf-8");
      fs.writeFileSync(path.join(srcDir, "ParticleRenderer.ts"), rendererC, "utf-8");

      const scanRes = scanProjectIdioms(tmpDir, {
        minOccurrences: 3,
        minNetTokenSavings: 5,
      });

      expect(Object.keys(scanRes.idioms).length).toBeGreaterThanOrEqual(1);
      expect(scanRes.totalNetTokenSavings).toBeGreaterThan(0);

      // Verify zero .aice files were created on disk
      const allFiles = fs.readdirSync(srcDir);
      expect(allFiles.some((f) => f.endsWith(".aice"))).toBe(false);

      // Verify aice.config.json persisted the discovered idioms
      const config = loadProjectConfig(tmpDir);
      expect(config.idioms).toBeDefined();
      expect(Object.keys(config.idioms!).length).toBeGreaterThanOrEqual(1);

      // Verify .aice-cache/idioms.json exists and records fileHashes + occurrence provenance
      const cacheFile = path.join(tmpDir, ".aice-cache", "idioms.json");
      expect(fs.existsSync(cacheFile)).toBe(true);
      const cacheData = JSON.parse(fs.readFileSync(cacheFile, "utf-8"));
      expect(cacheData.fileHashes).toBeDefined();
      expect(Object.keys(cacheData.fileHashes).length).toBe(3);
      expect(cacheData.occurrences).toBeDefined();

      const firstIdiomName = Object.keys(scanRes.idioms)[0];
      const occs = cacheData.occurrences[firstIdiomName];
      expect(Array.isArray(occs)).toBe(true);
      expect(occs.length).toBe(3);
      expect(occs[0].filePath).toBeDefined();
      expect(occs[0].startLine).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(occs[0].args)).toBe(true);
    });

    it("invalidates stale SHA-256 provenance cache automatically when a human edits a native file on disk mid-session", () => {
      const srcDir = path.join(tmpDir, "src");
      fs.mkdirSync(srcDir, { recursive: true });

      const guardIdiom: ProjectIdiomDefinition = {
        name: "$guardPos",
        kind: "stmt",
        params: [{ name: "$0" }, { name: "$1" }],
        templateAice: "if $0 <= 0:\n  ret $1",
        occurrences: 2,
        tokensPerOccurrenceSaved: 6,
        netTokenSavings: 12,
      };
      saveProjectConfig(tmpDir, {
        mode: "twinless",
        sourceDir: "src",
        idiomsEnabled: true,
        idioms: { $guardPos: guardIdiom },
      });

      const file1 = path.join(srcDir, "calc.ts");
      fs.writeFileSync(
        file1,
        `export function computeA(x: number): number {
  if (x <= 0) {
    return -1;
  }
  return x * 10;
}
`,
        "utf-8",
      );

      // First read populates cache
      const read1 = readProjectIdiom(tmpDir, "$guardPos");
      expect(read1.totalOccurrences).toBe(1);
      expect(read1.occurrences[0].args).toEqual(["x", "-1"]);

      // Human edits calc.ts directly on disk to add a second occurrence and change -1 to -99
      fs.writeFileSync(
        file1,
        `export function computeA(x: number): number {
  if (x <= 0) {
    return -99;
  }
  return x * 10;
}

export function computeB(y: number): number {
  if (y <= 0) {
    return 0;
  }
  return y + 5;
}
`,
        "utf-8",
      );

      // Second read must detect SHA-256 mismatch and re-index live
      const read2 = readProjectIdiom(tmpDir, "$guardPos");
      expect(read2.totalOccurrences).toBe(2);
      expect(read2.occurrences[0].args).toEqual(["x", "-99"]);
      expect(read2.occurrences[1].args).toEqual(["y", "0"]);
    });
  });

  describe("Category B: Instant On/Off Switch & Stale AI Memory Grace", () => {
    it("toggles idioms on and off via API and CLI (`aice idioms off` / `aice idioms on`) and respects --idioms / --no-idioms flags", async () => {
      const srcDir = path.join(tmpDir, "src");
      fs.mkdirSync(srcDir, { recursive: true });

      const arcIdiom: ProjectIdiomDefinition = {
        name: "$drawCircle",
        kind: "block",
        params: [{ name: "$0" }, { name: "$1" }, { name: "$2" }, { name: "$3" }],
        templateAice: "$0.beginPath()\n$0.arc($1, $2, $3, 0, 6.28)\n$0.fill()",
        occurrences: 3,
        tokensPerOccurrenceSaved: 12,
        netTokenSavings: 36,
      };

      saveProjectConfig(tmpDir, {
        mode: "twinless",
        sourceDir: "src",
        idiomsEnabled: true,
        idioms: { $drawCircle: arcIdiom },
      });

      const tsFile = path.join(srcDir, " hud.ts".trim());
      fs.writeFileSync(
        tsFile,
        `export function renderDot(ctx: any, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, 6.28);
  ctx.fill();
}
`,
        "utf-8",
      );

      // 1. Default ON: context and outline include $drawCircle
      const ctxOn = await generateContext(tsFile, { projectRoot: tmpDir });
      expect(ctxOn.targetContent).toContain("$drawCircle(ctx, x, y, r)");
      expect(ctxOn.formattedBundle).toContain("### Active Project Idioms");

      const outOn = generateOutline(tsFile, { projectRoot: tmpDir });
      expect(outOn.referencedIdioms).toContain("$drawCircle");
      expect(outOn.text).toContain("// idioms: $drawCircle");

      // 2. Per-call override `--no-idioms` (idioms: false) while config is still ON
      const ctxOverrideOff = await generateContext(tsFile, {
        projectRoot: tmpDir,
        idioms: false,
      });
      expect(ctxOverrideOff.targetContent).not.toContain("$drawCircle");
      expect(ctxOverrideOff.targetContent).toContain("ctx.beginPath()");
      expect(ctxOverrideOff.formattedBundle).not.toContain("### Active Project Idioms");

      // 3. Switch OFF globally via CLI `aice idioms off`
      const offRes = runCli(["idioms", "off", tmpDir]);
      expect(offRes.status).toBe(0);
      const cfgAfterOff = loadProjectConfig(tmpDir);
      expect(isProjectIdiomsEnabled(cfgAfterOff)).toBe(false);

      // Context & Outline now omit idioms by default
      const ctxOff = await generateContext(tsFile, { projectRoot: tmpDir });
      expect(ctxOff.targetContent).not.toContain("$drawCircle");
      expect(ctxOff.formattedBundle).not.toContain("### Active Project Idioms");

      const outOff = generateOutline(tsFile, { projectRoot: tmpDir });
      expect(outOff.referencedIdioms ?? []).toHaveLength(0);

      // Per-call override `--idioms` (idioms: true) while config is OFF
      const ctxOverrideOn = await generateContext(tsFile, {
        projectRoot: tmpDir,
        idioms: true,
      });
      expect(ctxOverrideOn.targetContent).toContain("$drawCircle(ctx, x, y, r)");

      // 4. Stale AI Memory Grace: even when idioms are OFF, `splice` still expands $drawCircle!
      await splice(tsFile, {
        projectRoot: tmpDir,
        symbol: "renderDot",
        body: "$drawCircle(ctx, x + 1, y + 1, r * 2)",
      });

      const updatedNative = fs.readFileSync(tsFile, "utf-8");
      expect(updatedNative).not.toContain("$drawCircle");
      expect(updatedNative).toContain("ctx.beginPath()");
      expect(updatedNative).toContain("ctx.arc(x + 1, y + 1, r * 2, 0, 6.28)");

      // 5. Switch ON globally via setProjectIdiomsEnabled / CLI `aice idioms on`
      setProjectIdiomsEnabled(tmpDir, true);
      expect(isProjectIdiomsEnabled(loadProjectConfig(tmpDir))).toBe(true);
    });
  });

  describe("Category C: Multi-File Idiom Read, Smart Multi-File Update, Hygiene, Cycles & Rollback", () => {
    it("reads all occurrences across multiple native files and updates them all in one shot with parameter reordering, duplication, and nested expressions", async () => {
      const srcDir = path.join(tmpDir, "src");
      fs.mkdirSync(srcDir, { recursive: true });

      const guardIdiom: ProjectIdiomDefinition = {
        name: "$clampAssign",
        kind: "stmt",
        params: [{ name: "$0" }, { name: "$1" }, { name: "$2" }],
        templateAice: "if $0 > $1:\n  $0 = $2",
        occurrences: 3,
        tokensPerOccurrenceSaved: 8,
        netTokenSavings: 24,
      };

      saveProjectConfig(tmpDir, {
        mode: "twinless",
        sourceDir: "src",
        idiomsEnabled: true,
        idioms: { $clampAssign: guardIdiom },
      });

      const fileA = path.join(srcDir, "player.ts");
      const fileB = path.join(srcDir, "enemy.ts");

      fs.writeFileSync(
        fileA,
        `// Header comment in player.ts
export class Player {
  hp = 100;
  mana = 50;

  public capStats(maxHp: number, maxMana: number): void {
    if (this.hp > maxHp) {
      this.hp = maxHp;
    }
    if (this.mana > maxMana) {
      this.mana = 0;
    }
  }
}
`,
        "utf-8",
      );

      fs.writeFileSync(
        fileB,
        `// Header comment in enemy.ts
export class Enemy {
  speed = 10;

  public limitSpeed(cap: number, fallback: number): void {
    if (this.speed > cap) {
      this.speed = fallback;
    }
  }
}
`,
        "utf-8",
      );

      // 1. Multi-file read
      const readRes = readProjectIdiom(tmpDir, "$clampAssign");
      expect(readRes.totalOccurrences).toBe(3);
      expect(readRes.filesCount).toBe(2);
      expect(readRes.formattedReport).toContain("$clampAssign");
      expect(readRes.formattedReport).toContain("player.ts");
      expect(readRes.formattedReport).toContain("enemy.ts");

      // 2. Dry-run update (reorders $2 and $1, duplicates $0)
      const newTemplate = "if $0 > $1:\n  $0 = ($2 + $1) - $0";
      const dryRes = await updateProjectIdiom(tmpDir, "$clampAssign", newTemplate, {
        dryRun: true,
      });
      expect(dryRes.updatedOccurrences).toBe(3);
      expect(dryRes.modifiedFiles).toHaveLength(2);
      // Verify disk was NOT touched during dryRun
      expect(fs.readFileSync(fileB, "utf-8")).toContain("this.speed = fallback;");

      // 3. Live multi-file update
      const liveRes = await updateProjectIdiom(tmpDir, "$clampAssign", newTemplate, {
        dryRun: false,
      });
      expect(liveRes.updatedOccurrences).toBe(3);
      expect(liveRes.modifiedFiles).toHaveLength(2);

      const updatedA = fs.readFileSync(fileA, "utf-8");
      const updatedB = fs.readFileSync(fileB, "utf-8");

      // Header comments preserved
      expect(updatedA).toContain("// Header comment in player.ts");
      expect(updatedB).toContain("// Header comment in enemy.ts");

      // Updated logic in both files with reordered/duplicated parameters
      expect(updatedA).toContain("maxHp + maxHp - this.hp");
      expect(updatedA).toContain("0 + maxMana - this.mana");
      expect(updatedB).toContain("fallback + cap - this.speed");

      // Config template updated
      const updatedCfg = loadProjectConfig(tmpDir);
      expect(updatedCfg.idioms?.$clampAssign.templateAice).toBe(newTemplate);
    });

    it("enforces hygienic alpha-renaming when an idiom template local variable collides with call-site arguments or scope variables", () => {
      const idioms: Record<string, ProjectIdiomDefinition> = {
        $swapAdd: {
          name: "$swapAdd",
          kind: "block",
          params: [{ name: "$0" }, { name: "$1" }],
          templateAice: "tmp := $0 + 1\n$1 = tmp * 2",
          occurrences: 3,
          tokensPerOccurrenceSaved: 8,
          netTokenSavings: 24,
        },
      };

      // Caller already has a variable named `tmp` AND passes `tmp` as $0!
      const aiceSource = `fn compute(x: int) -> int:
  tmp := x * 10
  out ::= 0
  $swapAdd(tmp, out)
  ret tmp + out
`;

      const expanded = expandAiceSourceIdioms(aiceSource, idioms);
      expect(expanded.expandedCount).toBe(1);
      // The template's internal `tmp` must be alpha-renamed (e.g. tmp_1) so it does not shadow or clobber caller's `tmp`!
      expect(expanded.aice).toContain("tmp := x * 10");
      expect(expanded.aice).toMatch(/tmp_\d+\s*:=\s*tmp\s*\+\s*1/);
      expect(expanded.aice).toMatch(/out\s*=\s*tmp_\d+\s*\*\s*2/);
      expect(expanded.aice).toContain("tmp + out");
    });

    it("detects direct and mutual recursion cycles in idiom definitions and throws IdiomCycleError", async () => {
      const directCycle: Record<string, ProjectIdiomDefinition> = {
        $selfLoop: {
          name: "$selfLoop",
          kind: "stmt",
          params: [{ name: "$0" }],
          templateAice: "$selfLoop($0)",
          occurrences: 3,
          tokensPerOccurrenceSaved: 5,
          netTokenSavings: 15,
        },
      };

      expect(() => validateIdiomDefinitions(directCycle)).toThrow(IdiomCycleError);
      expect(() => expandAiceSourceIdioms("fn f():\n  $selfLoop(1)\n", directCycle)).toThrow(
        IdiomCycleError,
      );

      const mutualCycle: Record<string, ProjectIdiomDefinition> = {
        $ping: {
          name: "$ping",
          kind: "stmt",
          params: [{ name: "$0" }],
          templateAice: "$pong($0)",
          occurrences: 3,
          tokensPerOccurrenceSaved: 5,
          netTokenSavings: 15,
        },
        $pong: {
          name: "$pong",
          kind: "stmt",
          params: [{ name: "$0" }],
          templateAice: "$ping($0)",
          occurrences: 3,
          tokensPerOccurrenceSaved: 5,
          netTokenSavings: 15,
        },
      };

      expect(() => validateIdiomDefinitions(mutualCycle)).toThrow(IdiomCycleError);

      // Updating an existing idiom to create a cycle must also throw IdiomCycleError
      saveProjectConfig(tmpDir, {
        mode: "twinless",
        idioms: {
          $alpha: {
            name: "$alpha",
            kind: "stmt",
            params: [{ name: "$0" }],
            templateAice: "$beta($0)",
            occurrences: 3,
            tokensPerOccurrenceSaved: 5,
            netTokenSavings: 15,
          },
          $beta: {
            name: "$beta",
            kind: "stmt",
            params: [{ name: "$0" }],
            templateAice: "print($0)",
            occurrences: 3,
            tokensPerOccurrenceSaved: 5,
            netTokenSavings: 15,
          },
        },
      });

      await expect(updateProjectIdiom(tmpDir, "$beta", "$alpha($0)")).rejects.toThrow(
        IdiomCycleError,
      );
    });

    it("atomically rolls back all files and config if a multi-file idiom update fails mid-flight", async () => {
      const srcDir = path.join(tmpDir, "src");
      fs.mkdirSync(srcDir, { recursive: true });

      const guardIdiom: ProjectIdiomDefinition = {
        name: "$resetIfNeg",
        kind: "stmt",
        params: [{ name: "$0" }],
        templateAice: "if $0 < 0:\n  $0 = 0",
        occurrences: 2,
        tokensPerOccurrenceSaved: 6,
        netTokenSavings: 12,
      };

      saveProjectConfig(tmpDir, {
        mode: "twinless",
        sourceDir: "src",
        idiomsEnabled: true,
        idioms: { $resetIfNeg: guardIdiom },
      });

      const file1 = path.join(srcDir, "a_first.ts");
      const file2 = path.join(srcDir, "b_second.ts");

      const orig1 = `export function stepA(x: number): number {
  if (x < 0) {
    x = 0;
  }
  return x;
}
`;
      const orig2 = `export function stepB(y: number): number {
  if (y < 0) {
    y = 0;
  }
  return y;
}
`;
      fs.writeFileSync(file1, orig1, "utf-8");
      fs.writeFileSync(file2, orig2, "utf-8");

      // Prime provenance cache before locking file2
      readProjectIdiom(tmpDir, "$resetIfNeg");

      // 1. Pre-flight invalid template syntax failure
      await expect(
        updateProjectIdiom(tmpDir, "$resetIfNeg", "if $0 < 0:\n  @@@INVALID_SYNTAX@@@"),
      ).rejects.toThrow();

      expect(fs.readFileSync(file1, "utf-8")).toBe(orig1);
      expect(fs.readFileSync(file2, "utf-8")).toBe(orig2);

      // 2. Mid-flight disk write failure after file1 has already been overwritten on disk
      if (typeof process.getuid === "function" && process.getuid() !== 0) {
        fs.chmodSync(file2, 0o444);
        try {
          await expect(
            updateProjectIdiom(tmpDir, "$resetIfNeg", "if $0 <= 0:\n  $0 = 1"),
          ).rejects.toThrow();
        } finally {
          fs.chmodSync(file2, 0o644);
        }

        // Verify file1 (which was written before file2 failed), file2, and config remain 100% untouched
        expect(fs.readFileSync(file1, "utf-8")).toBe(orig1);
        expect(fs.readFileSync(file2, "utf-8")).toBe(orig2);
        expect(loadProjectConfig(tmpDir).idioms?.$resetIfNeg.templateAice).toBe(
          "if $0 < 0:\n  $0 = 0",
        );
      }
    });

    it("resolves project root when scanning a subdirectory (e.g. 'src/') and reading from root", () => {
      const srcDir = path.join(tmpDir, "src");
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, "package.json"),
        JSON.stringify({ name: "sub-test" }),
        "utf-8",
      );

      const tsCode = `export class Audio {
  playA() {
    if (!this.ready || !this.ctx || !this.gain) {
      return;
    }
    this.ctx.start(1);
  }
  playB() {
    if (!this.ready || !this.ctx || !this.gain) {
      return;
    }
    this.ctx.start(2);
  }
  playC() {
    if (!this.ready || !this.ctx || !this.gain) {
      return;
    }
    this.ctx.start(3);
  }
}
`;
      fs.writeFileSync(path.join(srcDir, "audio.ts"), tsCode, "utf-8");

      const scanRes = scanProjectIdioms(srcDir, { minOccurrences: 3, minNetTokenSavings: 5 });
      expect(scanRes.synthesizedIdioms).toBeGreaterThanOrEqual(1);
      expect(fs.existsSync(path.join(tmpDir, "aice.config.json"))).toBe(true);
      expect(fs.existsSync(path.join(srcDir, "aice.config.json"))).toBe(false);

      const firstIdiom = Object.keys(scanRes.idioms)[0];
      const readRes = readProjectIdiom(tmpDir, firstIdiom);
      expect(readRes.totalOccurrences).toBe(3);
      expect(readRes.occurrences[0].filePath).toBe("src/audio.ts");
    });
  });
});
