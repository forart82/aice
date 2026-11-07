/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 0 TDD Suite: Twinless On-the-Fly Mode (Zero .aice Files on Disk)
 * Covers:
 * - Category D: "Frankenstein syntax" forgiving `aice splice` directly on native files (.ts, .py) + symbol-scoped context
 * - Category E: Surgical byte-span isolation & 100% bit-identical trivia preservation on native files
 * - Category F: Multi-file batch splice (`spliceBatch` & `aice splice --batch`) with atomic rollback
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
import { generateContext } from "../../src/tools/context.js";
import { splice, spliceBatch } from "../../src/tools/splice.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const cliPath = path.resolve(repoRoot, "bin/aice.ts");

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
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aice-twinless-otf-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  describe("Category D: Forgiving 'Frankenstein Syntax' Direct-to-Native Splice & Symbol-Scoped Context", () => {
    it("splices a pure native .ts file with (1) pure AICE + $idioms, (2) raw TypeScript, and (3) hybrid Frankenstein syntax with zero .aice files created", async () => {
      const srcDir = path.join(tmpDir, "src");
      fs.mkdirSync(srcDir, { recursive: true });

      const guardIdiom: ProjectIdiomDefinition = {
        name: "$guardMin",
        kind: "stmt",
        params: [{ name: "$0" }, { name: "$1" }],
        templateAice: "if $0 < $1:\n  ret $1",
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

      // Subcase 1: Pure AICE + $idiom
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
      expect(fs.existsSync(`${tsFile}.aice`)).toBe(false);
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

      // Subcase 3: Hybrid "Frankenstein" syntax mixing TS braces/semicolons/const/destructuring with AICE `:=`, `ret`, and `$guardMin`
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

    it("splices a pure native Python (.py) file directly using AICE + $idioms and hybrid Python/AICE syntax without creating a .aice file", async () => {
      const srcDir = path.join(tmpDir, "src");
      fs.mkdirSync(srcDir, { recursive: true });

      const guardIdiom: ProjectIdiomDefinition = {
        name: "$guardNonNeg",
        kind: "stmt",
        params: [{ name: "$0" }],
        templateAice: "if $0 < 0:\n  ret 0",
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

      // 1. Pure AICE + $idiom
      await splice(pyFile, {
        projectRoot: tmpDir,
        symbol: "compute_velocity",
        code: `fn compute_velocity(v: float, dt: float) -> float:
  $guardNonNeg(dt)
  step := v * dt
  ret step`,
      });

      expect(fs.existsSync(`${pyFile}.aice`)).toBe(false);
      let pyAfter = fs.readFileSync(pyFile, "utf-8");
      expect(pyAfter).toContain("# Physics header comment");
      expect(pyAfter).toContain("if dt < 0:");
      expect(pyAfter).toContain("return 0");
      expect(pyAfter).toContain("def keep_untouched(x: int) -> int:");

      // 2. Hybrid Python `def` + list comprehension + AICE `:=`, `ret`, and `$guardNonNeg`
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


    it("packages symbol-scoped on-the-fly AICE context (`-s <symbol>`) from a native .ts file with collapsed $idioms", async () => {
      const srcDir = path.join(tmpDir, "src");
      fs.mkdirSync(srcDir, { recursive: true });

      const guardIdiom: ProjectIdiomDefinition = {
        name: "$guardAlive",
        kind: "stmt",
        params: [{ name: "$0" }],
        templateAice: "if $0 <= 0:\n  ret 0",
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

      // Scoped context must contain the decompiled AICE with collapsed $guardAlive for updateMovement
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

  describe("Category G: Real-World E2E Proof on Native TypeScript Project (Zero .aice Files + `tsc --noEmit`)", () => {
    it("runs full Twinless workflow (Idiom Scan -> Context -> Multi-File Idiom Update -> Direct Native Splice -> tsc --noEmit) on native TypeScript modules", async () => {
      const srcCoreDir = path.join(tmpDir, "src", "core");
      const srcSimDir = path.join(tmpDir, "src", "sim");
      fs.mkdirSync(srcCoreDir, { recursive: true });
      fs.mkdirSync(srcSimDir, { recursive: true });

      fs.writeFileSync(
        path.join(srcCoreDir, "Vec2.ts"),
        `export class Vec2 {
  X: number;
  Y: number;

  constructor(x: number = 0, y: number = 0) {
    this.X = x;
    this.Y = y;
  }

  Add(other: Vec2): Vec2 {
    if (!Number.isFinite(other.X)) {
      return new Vec2(this.X, this.Y);
    }
    return new Vec2(this.X + other.X, this.Y + other.Y);
  }

  Sub(other: Vec2): Vec2 {
    if (!Number.isFinite(other.Y)) {
      return new Vec2(this.X, this.Y);
    }
    return new Vec2(this.X - other.X, this.Y - other.Y);
  }

  Scale(s: number): Vec2 {
    if (!Number.isFinite(s)) {
      return new Vec2(this.X, this.Y);
    }
    return new Vec2(this.X * s, this.Y * s);
  }
}
`,
        "utf-8",
      );

      fs.writeFileSync(
        path.join(srcSimDir, "StatusSet.ts"),
        `export class StatusSet {
  FreezeTimer: number = 0;
  StunTimer: number = 0;
  MarkTimer: number = 0;

  Update(dt: number): void {
    if (this.FreezeTimer > 0) {
      this.FreezeTimer = Math.max(0, this.FreezeTimer - dt);
    }
    if (this.StunTimer > 0) {
      this.StunTimer = Math.max(0, this.StunTimer - dt);
    }
    if (this.MarkTimer > 0) {
      this.MarkTimer = Math.max(0, this.MarkTimer - dt);
    }
  }

  Freeze(seconds: number): void {
    this.FreezeTimer = Math.max(this.FreezeTimer, seconds);
  }

  get_Immobile(): boolean {
    return this.FreezeTimer > 0 || this.StunTimer > 0;
  }

  get_SpeedMult(): number {
    return this.FreezeTimer > 0 ? 0.5 : 1.0;
  }

  get_DamageTakenMult(): number {
    return this.MarkTimer > 0 ? 1.25 : 1.0;
  }

  get_immobile(): boolean {
    return this.get_Immobile();
  }

  get_speedMult(): number {
    return this.get_SpeedMult();
  }

  get_damageTakenMult(): boolean | number {
    return this.get_DamageTakenMult();
  }
}
`,
        "utf-8",
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

      // 1. Scan idioms directly on native .ts files (must automatically discover $guard in Vec2.ts and $guard2 in StatusSet.ts!)
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
      const statusGuard = scanRes.idioms.$guard.templateAice.includes("max(0")
        ? "$guard"
        : "$guard2";

      const statusSetPath = path.join(srcSimDir, "StatusSet.ts");

      // 2. On-the-fly context on StatusSet.ts collapses auto-mined statusGuard (`if $0 > 0: $0 = max(0, $0 - dt)`)
      const ctx = await generateContext(statusSetPath, { projectRoot: tmpDir });
      expect(ctx.targetContent).toContain(`${statusGuard}(this.FreezeTimer)`);
      expect(ctx.targetContent).toContain(`${statusGuard}(this.StunTimer)`);
      expect(ctx.targetContent).toContain(`${statusGuard}(this.MarkTimer)`);

      // 3. Multi-file idiom update on auto-mined statusGuard across StatusSet.ts
      const updateRes = await updateProjectIdiom(
        tmpDir,
        statusGuard,
        "if $0 > 0:\n  $0 = max(0, $0 - dt * 1.25)",
      );
      expect(updateRes.updatedOccurrences).toBe(3);
      expect(fs.readFileSync(statusSetPath, "utf-8")).toContain("dt * 1.25");

      // 4. Surgically splice StatusSet.Freeze using compressed AICE + auto-mined statusGuard
      await splice(statusSetPath, {
        projectRoot: tmpDir,
        symbol: "StatusSet.Freeze",
        code: `pub fn Freeze(seconds: float) -> void:
  dt := 0.0
  ${statusGuard}(this.FreezeTimer)
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

      // Verify zero .aice files exist anywhere in tmpDir
      const findAiceFiles = (dir: string): string[] => {
        const out: string[] = [];
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) out.push(...findAiceFiles(full));
          else if (entry.name.endsWith(".aice")) out.push(full);
        }
        return out;
      };
      expect(findAiceFiles(tmpDir)).toHaveLength(0);

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

  describe("Category H: Surgical Slicing & Splicing Across All Non-Code & Systems Dialects (.css, .json, .yaml, .html, .twig, .rs, .go)", () => {
    it("surgically slices and splices .css rules, .json/.yaml dot-paths, .html elements, .twig blocks, and Rust/Go try-catch blocks with zero .aice files", async () => {
      // 1. CSS rule slicing & surgical splice
      const cssPath = path.join(tmpDir, "theme.css");
      fs.writeFileSync(
        cssPath,
        `.btn-primary {\n  display: flex;\n  padding: 8px;\n}\n\n.card-panel {\n  margin: 16px;\n}\n`,
        "utf-8",
      );
      const cssCtx = await generateContext(cssPath, { symbol: ".btn-primary", projectRoot: tmpDir });
      expect(cssCtx.targetContent).toContain("btn-primary");
      expect(cssCtx.targetContent).not.toContain("card-panel");
      await splice(cssPath, {
        projectRoot: tmpDir,
        symbol: ".btn-primary",
        code: `style .btn-primary:\n  display: "grid"\n  padding: "24px"`,
      });
      const updatedCss = fs.readFileSync(cssPath, "utf-8");
      expect(updatedCss).toContain("24px");
      expect(updatedCss).toContain(".card-panel");

      // 2. JSON dot-path slicing & surgical splice
      const jsonPath = path.join(tmpDir, "config.json");
      fs.writeFileSync(
        jsonPath,
        JSON.stringify(
          {
            services: {
              auth: { host: "auth.local", port: 8080 },
              billing: { host: "billing.local", port: 8081 },
            },
          },
          null,
          2,
        ),
        "utf-8",
      );
      const jsonCtx = await generateContext(jsonPath, {
        symbol: "services.auth",
        projectRoot: tmpDir,
      });
      expect(jsonCtx.targetContent).toContain("auth.local");
      expect(jsonCtx.targetContent).not.toContain("billing.local");
      await splice(jsonPath, {
        projectRoot: tmpDir,
        symbol: "services.auth",
        code: `{ host: "auth.v2.internal", port: 9443 }`,
      });
      const updatedJson = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
      expect(updatedJson.services.auth.port).toBe(9443);
      expect(updatedJson.services.billing.port).toBe(8081);

      // 3. YAML key slicing & surgical splice
      const yamlPath = path.join(tmpDir, "service.yaml");
      fs.writeFileSync(
        yamlPath,
        `database:\n  host: db.local\n  port: 5432\ncache:\n  host: redis.local\n  port: 6379\n`,
        "utf-8",
      );
      const yamlCtx = await generateContext(yamlPath, {
        symbol: "database",
        projectRoot: tmpDir,
      });
      expect(yamlCtx.targetContent).toContain("db.local");
      expect(yamlCtx.targetContent).not.toContain("redis.local");
      await splice(yamlPath, {
        projectRoot: tmpDir,
        symbol: "database",
        code: `{ host: "db-primary.internal", port: 6432 }`,
      });
      const updatedYaml = fs.readFileSync(yamlPath, "utf-8");
      expect(updatedYaml).toContain("6432");
      expect(updatedYaml).toContain("redis.local");

      // 4. HTML #id slicing & surgical splice
      const htmlPath = path.join(tmpDir, "view.html");
      fs.writeFileSync(
        htmlPath,
        `<main>\n  <section id="hero"><h1>Old Hero</h1></section>\n  <footer id="foot"><p>Keep Footer</p></footer>\n</main>\n`,
        "utf-8",
      );
      const htmlCtx = await generateContext(htmlPath, {
        symbol: "#hero",
        projectRoot: tmpDir,
      });
      expect(htmlCtx.targetContent).toContain("Old Hero");
      expect(htmlCtx.targetContent).not.toContain("Keep Footer");
      await splice(htmlPath, {
        projectRoot: tmpDir,
        symbol: "#hero",
        code: `<section id="hero"><h1>New Hero 2026</h1></section>`,
      });
      const updatedHtml = fs.readFileSync(htmlPath, "utf-8");
      expect(updatedHtml).toContain("New Hero 2026");
      expect(updatedHtml).toContain("Keep Footer");

      // 5. Twig block slicing & surgical splice
      const twigPath = path.join(tmpDir, "page.twig");
      fs.writeFileSync(
        twigPath,
        `{% block header %}<header><h1>Old Twig Header</h1></header>{% endblock %}\n{% block footer %}<footer>Keep Twig Footer</footer>{% endblock %}\n`,
        "utf-8",
      );
      const twigCtx = await generateContext(twigPath, {
        symbol: "block:header",
        projectRoot: tmpDir,
      });
      expect(twigCtx.targetContent).toContain("Old Twig Header");
      expect(twigCtx.targetContent).not.toContain("Keep Twig Footer");
      const twigBareCtx = await generateContext(twigPath, {
        symbol: "header",
        projectRoot: tmpDir,
      });
      expect(twigBareCtx.targetContent).toContain("Old Twig Header");
      expect(twigBareCtx.targetContent).not.toContain("Keep Twig Footer");
      await splice(twigPath, {
        projectRoot: tmpDir,
        symbol: "block:header",
        code: `block(name: "header"):\n  header:\n    h1: "Upgraded Twig Header"`,
      });
      const updatedTwig = fs.readFileSync(twigPath, "utf-8");
      expect(updatedTwig).toContain("Upgraded Twig Header");
      expect(updatedTwig).toContain("Keep Twig Footer");

      // 6. Rust & Go try/catch/finally + break/continue emission via surgical splice
      const rsPath = path.join(tmpDir, "worker.rs");
      fs.writeFileSync(
        rsPath,
        `pub fn process_job(limit: i64) -> i64 {\n    return limit;\n}\n`,
        "utf-8",
      );
      await splice(rsPath, {
        projectRoot: tmpDir,
        symbol: "process_job",
        code: `pub fn process_job(limit: int) -> int:\n  try:\n    mut i := 0\n    while i < limit:\n      i = i + 1\n      if i == 2:\n        continue\n      if i > 10:\n        break\n    ret i\n  catch err:\n    ret -1`,
      });
      const updatedRs = fs.readFileSync(rsPath, "utf-8");
      expect(updatedRs).toContain("continue;");
      expect(updatedRs).toContain("break;");

      const goPath = path.join(tmpDir, "worker.go");
      fs.writeFileSync(
        goPath,
        `package main\n\nfunc ProcessJob(limit int) int {\n\treturn limit\n}\n`,
        "utf-8",
      );
      await splice(goPath, {
        projectRoot: tmpDir,
        symbol: "ProcessJob",
        code: `pub fn ProcessJob(limit: int) -> int:\n  try:\n    mut i := 0\n    while i < limit:\n      i = i + 1\n      if i == 2:\n        continue\n      if i > 10:\n        break\n    ret i\n  catch err:\n    ret -1`,
      });
      const updatedGo = fs.readFileSync(goPath, "utf-8");
      expect(updatedGo).toContain("continue");
      expect(updatedGo).toContain("break");
    });

    it("handles nested Twig blocks (depth >= 3), HTML tags with '>' in quoted attributes & void elements, YAML anchors/aliases, and native data idiom scan/update", async () => {
      // 1. Nested Twig blocks of depth >= 3
      const nestedTwigPath = path.join(tmpDir, "nested.twig");
      fs.writeFileSync(
        nestedTwigPath,
        [
          `{% block main %}`,
          `  {% block header %}`,
          `    {% block brand %}<span>Old Brand</span>{% endblock %}`,
          `  {% endblock %}`,
          `  <p>Main Body Before</p>`,
          `{% endblock %}`,
          `{% block sidebar %}<aside>Keep Sidebar</aside>{% endblock %}`,
        ].join("\n"),
        "utf-8",
      );
      await splice(nestedTwigPath, {
        projectRoot: tmpDir,
        symbol: "block:main",
        code: `block(name: "main"):\n  div#main-upgraded:\n    p: "Main Body Upgraded"`,
      });
      const afterNestedTwig = fs.readFileSync(nestedTwigPath, "utf-8");
      expect(afterNestedTwig).toContain("Main Body Upgraded");
      expect(afterNestedTwig).not.toContain("Main Body Before");
      expect(afterNestedTwig).toContain("Keep Sidebar");

      // 2. HTML with '>' inside quoted attribute strings, nested identical tags of depth > 4, and HTML5 void element (<input>)
      const complexHtmlPath = path.join(tmpDir, "complex.html");
      fs.writeFileSync(
        complexHtmlPath,
        [
          `<main>`,
          `  <div data-expr="a > b" id="deep-box" title="x > y">`,
          `    <div data-d="1"><div data-d="2"><div data-d="3"><div data-d="4" data-cmp="10 > 5">Deep Old</div></div></div></div>`,
          `  </div>`,
          `  <input data-rule="len > 0" id="email-field" type="email">`,
          `  <footer id="keep-foot">Footer Intact</footer>`,
          `</main>`,
        ].join("\n"),
        "utf-8",
      );
      await splice(complexHtmlPath, {
        projectRoot: tmpDir,
        symbol: "#deep-box",
        code: `div#deep-box:\n  span: "Deep Replaced"`,
      });
      await splice(complexHtmlPath, {
        projectRoot: tmpDir,
        symbol: "#email-field",
        code: `<input id="email-field" type="email" required>`,
      });
      const afterComplexHtml = fs.readFileSync(complexHtmlPath, "utf-8");
      expect(afterComplexHtml).toContain("Deep Replaced");
      expect(afterComplexHtml).not.toContain("Deep Old");
      expect(afterComplexHtml).toContain("required");
      expect(afterComplexHtml).toContain("Footer Intact");

      // 3. YAML with anchors (&def_cfg), merge aliases (<<: *def_cfg), comments, and --append
      const anchorYamlPath = path.join(tmpDir, "anchored.yaml");
      fs.writeFileSync(
        anchorYamlPath,
        [
          `# Global defaults`,
          `defaults: &def_cfg`,
          `  timeout: 5000`,
          `  retries: 3`,
          `services:`,
          `  # Auth service`,
          `  auth:`,
          `    <<: *def_cfg`,
          `    host: auth.local`,
          `    port: 8080`,
          `  billing:`,
          `    <<: *def_cfg`,
          `    host: billing.local`,
          `    port: 8081`,
        ].join("\n") + "\n",
        "utf-8",
      );
      await splice(anchorYamlPath, {
        projectRoot: tmpDir,
        symbol: "services.auth",
        code: `{ host: "auth.v2.internal", port: 9443 }`,
      });
      await splice(anchorYamlPath, {
        projectRoot: tmpDir,
        append: true,
        code: `pub const metrics = { enabled: true, port: 9090 }`,
      });
      const afterAnchorYaml = fs.readFileSync(anchorYamlPath, "utf-8");
      expect(afterAnchorYaml).toContain("# Global defaults");
      expect(afterAnchorYaml).toContain("&def_cfg");
      expect(afterAnchorYaml).toContain("<<: *def_cfg");
      expect(afterAnchorYaml).toContain("auth.v2.internal");
      expect(afterAnchorYaml).toContain("9443");
      expect(afterAnchorYaml).toContain("billing.local");
      expect(afterAnchorYaml).toContain("metrics:");
      expect(afterAnchorYaml).toContain("9090");

      // 4. Native YAML/JSON workspace idiom scan & update without watermarks
      const dataWs = path.join(tmpDir, "data_ws");
      fs.mkdirSync(dataWs, { recursive: true });
      const epJson = JSON.stringify(
        {
          svcA: { host: "a.internal", port: 8080, tls: true, retries: 3, timeoutMs: 5000 },
          svcB: { host: "b.internal", port: 8081, tls: true, retries: 3, timeoutMs: 5000 },
          svcC: { host: "c.internal", port: 8082, tls: true, retries: 3, timeoutMs: 5000 },
        },
        null,
        2,
      );
      fs.writeFileSync(path.join(dataWs, "endpoints.json"), epJson, "utf-8");
      const scannedData = scanProjectIdioms(dataWs, { minOccurrences: 3, minNetTokenSavings: 2 });
      const minedIdiomNames = Object.keys(scannedData.idioms);
      expect(minedIdiomNames.length).toBeGreaterThan(0);
      const recIdiom = minedIdiomNames[0];
      const updData = await updateProjectIdiom(
        dataWs,
        recIdiom,
        "{ host: $0, port: $1, tls: true, retries: 5, timeoutMs: 9000 }",
      );
      expect(updData.updatedOccurrences).toBe(3);
      const updatedEndpoints = JSON.parse(
        fs.readFileSync(path.join(dataWs, "endpoints.json"), "utf-8"),
      );
      expect(updatedEndpoints.svcA.retries).toBe(5);
      expect(updatedEndpoints.svcB.timeoutMs).toBe(9000);
      expect(updatedEndpoints.svcC.retries).toBe(5);
    });
  });
});

