/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 0 TDD Suite: Twinless On-the-Fly Mode (Zero .ail Files on Disk)
 * Covers:
 * - Category D: "Frankenstein syntax" forgiving `ail splice` directly on native files (.ts, .py) + symbol-scoped context
 * - Category E: Surgical byte-span isolation & 100% bit-identical trivia preservation on native files
 * - Category F: Multi-file batch splice (`spliceBatch` & `ail splice --batch`) with atomic rollback
 * - Category G: Real-world E2E proof on `poc_real_case/snake_ts` native files with `tsc --noEmit` verification & Twinless Shield
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadProjectConfig,
  saveProjectConfig,
  type ProjectIdiomDefinition,
} from "../../src/config/project-config.js";
import {
  scanProjectIdioms,
  updateProjectIdiom,
} from "../../src/idioms/index.js";
import { applyAiShield } from "../../src/shield/index.js";
import { generateContext } from "../../src/tools/context.js";
import { splice, spliceBatch } from "../../src/tools/splice.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const cliPath = path.resolve(repoRoot, "bin/ail.ts");

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

describe("Twinless On-the-Fly Mode (Direct Native Read, Context, & Surgical Splice)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ail-twinless-otf-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  describe("Category D: Forgiving 'Frankenstein Syntax' Direct-to-Native Splice & Symbol-Scoped Context", () => {
    it("splices a pure native .ts file with (1) pure AIL + $idioms, (2) raw TypeScript, and (3) hybrid Frankenstein syntax with zero .ail files created", async () => {
      const srcDir = path.join(tmpDir, "src");
      fs.mkdirSync(srcDir, { recursive: true });

      const guardIdiom: ProjectIdiomDefinition = {
        name: "$guardMin",
        kind: "stmt",
        params: [{ name: "$0" }, { name: "$1" }],
        templateAil: "if $0 < $1:\n  ret $1",
        occurrences: 3,
        tokensPerOccurrenceSaved: 6,
        netTokenSavings: 18,
      };

      saveProjectConfig(tmpDir, {
        mode: "twinless",
        sourceDir: "src",
        idiomsEnabled: true,
        idioms: { $guardMin: guardIdiom },
      });

      const tsFile = path.join(srcDir, "combat.ts");
      fs.writeFileSync(
        tsFile,
        `export class CombatMath {
  public calcDamage(raw: number, armor: number): number {
    return raw - armor;
  }

  public calcHeal(amount: number, bonus: number): number {
    return amount + bonus;
  }

  public calcShield(base: number, mult: number): number {
    return base * mult;
  }
}
`,
        "utf-8",
      );

      // Subcase 1: Pure AIL + $idiom
      await splice(tsFile, {
        projectRoot: tmpDir,
        symbol: "CombatMath.calcDamage",
        code: `pub fn calcDamage(raw: float, armor: float) -> float:
  $guardMin(raw, 0)
  net := raw - armor
  $guardMin(net, 1)
  ret net`,
      });

      let content = fs.readFileSync(tsFile, "utf-8");
      expect(fs.existsSync(`${tsFile}.ail`)).toBe(false);
      expect(content).toContain("if (raw < 0)");
      expect(content).toContain("if (net < 1)");
      expect(content).toContain("return net;");

      // Subcase 2: Raw native TypeScript syntax fallback (zero retries)
      await splice(tsFile, {
        projectRoot: tmpDir,
        symbol: "CombatMath.calcHeal",
        code: `public calcHeal(amount: number, bonus: number): number {
    const total = amount + bonus * 2;
    if (total <= 0) {
      return 0;
    }
    return total;
  }`,
      });

      content = fs.readFileSync(tsFile, "utf-8");
      expect(content).toContain("const total = amount + bonus * 2;");

      // Subcase 3: Hybrid "Frankenstein" syntax mixing TS braces/semicolons/const/destructuring with AIL `:=`, `ret`, and `$guardMin`
      await splice(tsFile, {
        projectRoot: tmpDir,
        symbol: "CombatMath.calcShield",
        body: `const { b, m } = { b: base, m: mult };
scaled := b * m;
const boosted = scaled + 10;
$guardMin(boosted, 25);
ret boosted;`,
      });

      content = fs.readFileSync(tsFile, "utf-8");
      expect(content).not.toContain("$guardMin");
      expect(content).toContain("scaled = b * m");
      expect(content).toContain("boosted = scaled + 10");
      expect(content).toContain("if (boosted < 25)");
      expect(content).toContain("return 25;");
      expect(content).toContain("return boosted;");
    });

    it("splices a pure native Python (.py) file directly using AIL + $idioms and hybrid Python/AIL syntax without creating a .ail file", async () => {
      const srcDir = path.join(tmpDir, "src");
      fs.mkdirSync(srcDir, { recursive: true });

      const guardIdiom: ProjectIdiomDefinition = {
        name: "$guardNonNeg",
        kind: "stmt",
        params: [{ name: "$0" }],
        templateAil: "if $0 < 0:\n  ret 0",
        occurrences: 3,
        tokensPerOccurrenceSaved: 5,
        netTokenSavings: 15,
      };

      saveProjectConfig(tmpDir, {
        mode: "twinless",
        sourceDir: "src",
        targetLanguage: "python",
        idiomsEnabled: true,
        idioms: { $guardNonNeg: guardIdiom },
      });

      const pyFile = path.join(srcDir, "physics.py");
      fs.writeFileSync(
        pyFile,
        `# Physics header comment
def compute_velocity(v: float, dt: float) -> float:
    return v * dt

def keep_untouched(x: int) -> int:
    return x + 42
`,
        "utf-8",
      );

      // 1. Pure AIL + $idiom
      await splice(pyFile, {
        projectRoot: tmpDir,
        symbol: "compute_velocity",
        code: `fn compute_velocity(v: float, dt: float) -> float:
  $guardNonNeg(dt)
  step := v * dt
  ret step`,
      });

      expect(fs.existsSync(`${pyFile}.ail`)).toBe(false);
      let pyAfter = fs.readFileSync(pyFile, "utf-8");
      expect(pyAfter).toContain("# Physics header comment");
      expect(pyAfter).toContain("if dt < 0:");
      expect(pyAfter).toContain("return 0");
      expect(pyAfter).toContain("def keep_untouched(x: int) -> int:");

      // 2. Hybrid Python `def` + list comprehension + AIL `:=`, `ret`, and `$guardNonNeg`
      await splice(pyFile, {
        projectRoot: tmpDir,
        symbol: "compute_velocity",
        code: `def compute_velocity(v: float, dt: float) -> float:
    $guardNonNeg(dt)
    samples = [i * 2 for i in range(3)]
    step := v * dt + len(samples)
    ret step`,
      });

      pyAfter = fs.readFileSync(pyFile, "utf-8");
      expect(pyAfter).toContain("if dt < 0:");
      expect(pyAfter).toContain("list(map((lambda i: (i * 2)), range(3)))");
      expect(pyAfter).toContain("step = (v * dt) + len(samples)");
      expect(pyAfter).toContain("return step");
    });


    it("packages symbol-scoped on-the-fly AIL context (`-s <symbol>`) from a native .ts file with collapsed $idioms", async () => {
      const srcDir = path.join(tmpDir, "src");
      fs.mkdirSync(srcDir, { recursive: true });

      const guardIdiom: ProjectIdiomDefinition = {
        name: "$guardAlive",
        kind: "stmt",
        params: [{ name: "$0" }],
        templateAil: "if $0 <= 0:\n  ret 0",
        occurrences: 3,
        tokensPerOccurrenceSaved: 5,
        netTokenSavings: 15,
      };

      saveProjectConfig(tmpDir, {
        mode: "twinless",
        sourceDir: "src",
        idiomsEnabled: true,
        idioms: { $guardAlive: guardIdiom },
      });

      const tsFile = path.join(srcDir, "actor.ts");
      fs.writeFileSync(
        tsFile,
        `export class Actor {
  public updateMovement(hp: number, speed: number): number {
    if (hp <= 0) {
      return 0;
    }
    return speed * 2;
  }

  public veryLongUnrelatedMethod(a: number, b: number, c: number): number {
    const x = a + b;
    const y = b + c;
    const z = x * y;
    return z + a - c;
  }
}
`,
        "utf-8",
      );

      const fullCtx = await generateContext(tsFile, { projectRoot: tmpDir });
      const scopedCtx = await generateContext(tsFile, {
        projectRoot: tmpDir,
        symbol: "Actor.updateMovement",
      });

      // Scoped context must contain the decompiled AIL with collapsed $guardAlive for updateMovement
      expect(scopedCtx.targetContent).toContain("$guardAlive(hp)");
      expect(scopedCtx.targetContent).toContain("updateMovement");
      // And it must NOT include the body of veryLongUnrelatedMethod
      expect(scopedCtx.targetContent).not.toContain("z := x * y");
      expect(scopedCtx.tokenCount!).toBeLessThan(fullCtx.tokenCount!);
    });
  });

  describe("Category E: Surgical Byte-Span Isolation & 100% Bit-Identical Trivia Preservation", () => {
    it("preserves 100% bit-identical bytes before and after the spliced method in a native .ts file with JSDoc, complex generics, regexes, and overloaded top-level vs class method names", async () => {
      const srcDir = path.join(tmpDir, "src");
      fs.mkdirSync(srcDir, { recursive: true });
      saveProjectConfig(tmpDir, { mode: "twinless", sourceDir: "src" });

      const prefixBytes = `/**
 * ============================================================================
 * CRITICAL HEADER COMMENT — MUST REMAIN 100% BIT-IDENTICAL
 * Complex Regex: /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$/gi
 * ============================================================================
 */

export type ComplexGenericMap<K extends string, V> = ReadonlyMap<
  K,
  ReadonlyArray<Promise<{ readonly id: K; readonly payload: V | null }>>
>;

export const SLASH_REGEX = /^\\/api\\/v[0-9]+\\/(users|items)\\/([0-9a-f-]{36})$/i;

/**
 * Top-level overloaded function named \`step\` — MUST NOT BE TOUCHED when splicing GameEngine.step!
 */
export function step(globalTick: number): number {
  return globalTick + 1;
}

export function LogStep(): MethodDecorator {
  return (_target, _key, descriptor) => descriptor;
}

export class GameEngine {
  private tickCount = 0;

  /**
   * Method overload signature headers — MUST NOT BE OVERWRITTEN when splicing implementation!
   */
  public step(dt: number): number;
  public step(dt: number, scale?: number): number;

  /**
   * JSDoc & Decorator directly attached to GameEngine.step — MUST REMAIN 100% BIT-IDENTICAL!
   * @param dt Delta time in seconds
   */
  @LogStep()
`;

      const originalTargetMethod = `  public step(dt: number): number {
    this.tickCount += 1;
    return this.tickCount * dt;
  }`;

      const suffixBytes = `

  /**
   * Trailing method after step — MUST REMAIN 100% BIT-IDENTICAL!
   */
  public render<T extends Record<string, unknown>>(frame: T): string {
    const clean = String(frame).replace(/\\s+/g, " ");
    return \`[Frame \${this.tickCount}]: \${clean}\`;
  }
}
`;

      const fullOriginal = `${prefixBytes}${originalTargetMethod}${suffixBytes}`;
      const tsFile = path.join(srcDir, "engine.ts");
      fs.writeFileSync(tsFile, fullOriginal, "utf-8");

      await splice(tsFile, {
        projectRoot: tmpDir,
        symbol: "GameEngine.step",
        code: `pub fn step(dt: float) -> float:
  self.tickCount += 2
  ret self.tickCount * dt * 0.5`,
      });

      const modifiedNative = fs.readFileSync(tsFile, "utf-8");

      // 1. Every single byte in prefixBytes (including file header, ComplexGenericMap, SLASH_REGEX, top-level step(), overload headers, JSDoc, and @LogStep() decorator) MUST be 100% bit-identical!
      expect(modifiedNative.startsWith(prefixBytes)).toBe(true);

      // 2. Every single byte in suffixBytes (including trailing JSDoc, generic render<T>, regex, template literal) MUST be 100% bit-identical!
      expect(modifiedNative.endsWith(suffixBytes)).toBe(true);

      // 3. The middle spliced method has the new logic and preserved `public` visibility
      const middleReplaced = modifiedNative.slice(
        prefixBytes.length,
        modifiedNative.length - suffixBytes.length,
      );
      expect(middleReplaced).toContain("public step(");
      expect(middleReplaced).toContain("this.tickCount += 2");
      expect(middleReplaced).toContain("this.tickCount * dt * 0.5");
    });
  });

  describe("Category F: Multi-File Batch Splice with Atomic Rollback", () => {
    it("applies multi-file batch splices atomically and rolls back all files if any splice in the batch fails", async () => {
      const srcDir = path.join(tmpDir, "src");
      fs.mkdirSync(srcDir, { recursive: true });
      saveProjectConfig(tmpDir, { mode: "twinless", sourceDir: "src" });

      const file1 = path.join(srcDir, "serviceA.ts");
      const file2 = path.join(srcDir, "serviceB.ts");

      const orig1 = `export function alpha(x: number): number {
  return x + 1;
}
`;
      const orig2 = `export function beta(y: number): number {
  return y + 2;
}
`;
      fs.writeFileSync(file1, orig1, "utf-8");
      fs.writeFileSync(file2, orig2, "utf-8");

      // 1. Failing batch: second item references a non-existent symbol -> must roll back file1!
      await expect(
        spliceBatch(
          [
            {
              filePath: file1,
              symbol: "alpha",
              code: "pub fn alpha(x: int) -> int = x + 100",
            },
            {
              filePath: file2,
              symbol: "nonExistentSymbol",
              code: "pub fn nonExistentSymbol() -> int = 0",
            },
          ],
          { projectRoot: tmpDir },
        ),
      ).rejects.toThrow(/nonExistentSymbol/);

      // Verify file1 was rolled back to exact original bytes
      expect(fs.readFileSync(file1, "utf-8")).toBe(orig1);
      expect(fs.readFileSync(file2, "utf-8")).toBe(orig2);

      // 2. Successful batch across both files (via CLI `--batch`)
      const batchSpecFile = path.join(tmpDir, "batch.json");
      fs.writeFileSync(
        batchSpecFile,
        JSON.stringify([
          {
            filePath: file1,
            symbol: "alpha",
            code: "pub fn alpha(x: int) -> int = x + 100",
          },
          {
            filePath: file2,
            symbol: "beta",
            code: "pub fn beta(y: int) -> int = y + 200",
          },
        ]),
        "utf-8",
      );

      const cliRes = runCli(["splice", "--batch", batchSpecFile], tmpDir);
      expect(cliRes.status).toBe(0);

      expect(fs.readFileSync(file1, "utf-8")).toContain("x + 100");
      expect(fs.readFileSync(file2, "utf-8")).toContain("y + 200");
    });
  });

  describe("Category G: Real-World E2E Proof on `poc_real_case/snake_ts` (Zero .ail Files + `tsc --noEmit`)", () => {
    it("runs full Twinless workflow (Shield -> Idiom Scan -> Context -> Multi-File Idiom Update -> Direct Native Splice -> tsc --noEmit) on real snake_ts modules", async () => {
      const srcCoreDir = path.join(tmpDir, "src", "core");
      const srcSimDir = path.join(tmpDir, "src", "sim");
      fs.mkdirSync(srcCoreDir, { recursive: true });
      fs.mkdirSync(srcSimDir, { recursive: true });

      // Copy real native .ts files (NO .ail files!) from poc_real_case/snake_ts
      const snakeRoot = path.join(repoRoot, "poc_real_case", "snake_ts");
      fs.copyFileSync(
        path.join(snakeRoot, "src", "core", "MathX.ts"),
        path.join(srcCoreDir, "MathX.ts"),
      );
      fs.copyFileSync(
        path.join(snakeRoot, "src", "core", "Vec2.ts"),
        path.join(srcCoreDir, "Vec2.ts"),
      );
      fs.copyFileSync(
        path.join(snakeRoot, "src", "sim", "StatusSet.ts"),
        path.join(srcSimDir, "StatusSet.ts"),
      );
      fs.copyFileSync(
        path.join(snakeRoot, "src", "sim", "PlayerStats.ts"),
        path.join(srcSimDir, "PlayerStats.ts"),
      );

      // Write tsconfig.json for strict verification
      fs.writeFileSync(
        path.join(tmpDir, "tsconfig.json"),
        JSON.stringify(
          {
            compilerOptions: {
              target: "ES2022",
              module: "ESNext",
              moduleResolution: "bundler",
              strict: false,
              noEmit: true,
              skipLibCheck: true,
            },
            include: ["src/**/*.ts"],
          },
          null,
          2,
        ),
        "utf-8",
      );

      // 1. Apply Twinless AI Shield
      const shieldRes = await applyAiShield(tmpDir, { twinless: true });
      expect(shieldRes.activeShields.length).toBeGreaterThan(0);
      const agentsMd = fs.readFileSync(path.join(tmpDir, "AGENTS.md"), "utf-8");
      expect(agentsMd).toContain("Twinless");
      // Native files must NOT be hidden in .cursorignore in twinless mode
      if (fs.existsSync(path.join(tmpDir, ".cursorignore"))) {
        expect(fs.readFileSync(path.join(tmpDir, ".cursorignore"), "utf-8")).not.toContain("*.ts");
      }

      // 2. Scan idioms directly on native snake_ts files (must automatically discover $guard in Vec2.ts and $guard2 in StatusSet.ts!)
      saveProjectConfig(tmpDir, {
        mode: "twinless",
        sourceDir: "src",
        idiomsEnabled: true,
      });
      const scanRes = scanProjectIdioms(tmpDir, {
        minOccurrences: 3,
        minNetTokenSavings: 3,
      });
      expect(scanRes.idioms.$guard).toBeDefined();
      expect(scanRes.idioms.$guard2).toBeDefined();

      const statusSetPath = path.join(srcSimDir, "StatusSet.ts");

      // 3. On-the-fly context on StatusSet.ts collapses auto-mined $guard2 (`if $0 > 0: $0 = max(0, $0 - dt)`)
      const ctx = await generateContext(statusSetPath, { projectRoot: tmpDir });
      expect(ctx.targetContent).toContain("$guard2(this.FreezeTimer)");
      expect(ctx.targetContent).toContain("$guard2(this.StunTimer)");
      expect(ctx.targetContent).toContain("$guard2(this.MarkTimer)");

      // 4. Multi-file idiom update on auto-mined $guard2 across StatusSet.ts
      const updateRes = await updateProjectIdiom(
        tmpDir,
        "$guard2",
        "if $0 > 0:\n  $0 = max(0, $0 - dt * 1.25)",
      );
      expect(updateRes.updatedOccurrences).toBe(3);
      expect(fs.readFileSync(statusSetPath, "utf-8")).toContain("dt * 1.25");

      // 5. Surgically splice StatusSet.Freeze using compressed AIL + auto-mined $guard2
      await splice(statusSetPath, {
        projectRoot: tmpDir,
        symbol: "StatusSet.Freeze",
        code: `pub fn Freeze(seconds: float) -> void:
  dt := 0.0
  $guard2(this.FreezeTimer)
  this.FreezeTimer = max(this.FreezeTimer, seconds * 1.5)`,
      });

      expect(fs.readFileSync(statusSetPath, "utf-8")).toContain("seconds * 1.5");


      // Also fix the 3 delegating getters in StatusSet.ts via spliceBatch so tsc --noEmit passes cleanly
      await spliceBatch(
        [
          {
            filePath: statusSetPath,
            symbol: "StatusSet.get_immobile",
            code: "fn get_immobile() -> bool = self.get_Immobile()",
          },
          {
            filePath: statusSetPath,
            symbol: "StatusSet.get_speedMult",
            code: "fn get_speedMult() -> float = self.get_SpeedMult()",
          },
          {
            filePath: statusSetPath,
            symbol: "StatusSet.get_damageTakenMult",
            code: "fn get_damageTakenMult() -> float = self.get_DamageTakenMult()",
          },
        ],
        { projectRoot: tmpDir },
      );

      // Verify zero .ail files exist anywhere in tmpDir
      const findAilFiles = (dir: string): string[] => {
        const out: string[] = [];
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) out.push(...findAilFiles(full));
          else if (entry.name.endsWith(".ail")) out.push(full);
        }
        return out;
      };
      expect(findAilFiles(tmpDir)).toHaveLength(0);

      // 6. Run `tsc --noEmit` to prove the resulting native TypeScript compiles with 0 errors!
      const tscBin = path.join(repoRoot, "node_modules", ".bin", "tsc");
      const tscRes = spawnSync(tscBin, ["--noEmit", "-p", path.join(tmpDir, "tsconfig.json")], {
        cwd: tmpDir,
        encoding: "utf-8",
      });
      expect(tscRes.stdout + tscRes.stderr).toBe("");
      expect(tscRes.status).toBe(0);
    });
  });
});
