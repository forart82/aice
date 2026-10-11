/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Comprehensive Bidirectional Fidelity & Lens Verification Integration Test Suite.
 *
 * Validates the complete bidirectional adoption pipeline:
 *   1. Direction 1: Target -> AIL (Decompilation & 100% Parse Success Rate)
 *   2. Direction 2: AIL -> Target (Re-emission & Semantic Reconstruction)
 *   3. Put/Get Lens Law: Put(Get(c), Omega) == c (Bit-Identical Lossless Fidelity)
 *   4. Multi-Round Stability & Idempotence (Round 1 == Round 2, Zero Drift)
 *   5. Real-World Case Studies across TypeScript, TSX, CSS, HTML, C++, and C#
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { parse, parseWithTrivia, Parser } from "../../src/core/parser.js";
import {
  decompile,
  executeAilRoundtrip,
  executeRoundtrip,
  type RoundtripResult,
} from "../../src/decompiler/index.js";
import { detectTargetFromPath, emitTarget, type TargetLanguage } from "../../src/emitters/index.js";
import { TypeChecker } from "../../src/typechecker/checker.js";

describe("Bidirectional Fidelity & Multi-Round Verification Engine", () => {
  // ===========================================================================
  // SECTION 1: Direction 1 - Target -> AIL Decompilation & 100% Parse Success
  // ===========================================================================
  describe("Direction 1: Target -> AIL Decompilation & 100% Parse Success", () => {
    it("decompiles TypeScript with contextual keywords ('val', 'mut', 'pub') into 100% valid parseable AIL", () => {
      const tsCode = `
export interface DataPoint {
  val: number;
  mut: boolean;
  pub: string;
}

export function computeMetric(points: DataPoint[]): number {
  let total = 0;
  for (const p of points) {
    if (p.mut) {
      total += p.val;
    }
  }
  return total;
}
`;
      const decomp = decompile(tsCode, "typescript", { filePath: "Metric.ts" });
      expect(decomp.ail).toBeDefined();
      expect(decomp.ail.length).toBeGreaterThan(0);

      // Must parse cleanly with 100% success
      const parsedAst = parse(decomp.ail, "Metric.ts.ail");
      expect(parsedAst).toBeDefined();
      expect(parsedAst.kind).toBe("Module");
      expect(parsedAst.items.length).toBeGreaterThan(0);
    });

    it("decompiles TypeScript with 'nil' union types, ellipsis function types, and destructuring into valid AIL", () => {
      const tsCode = `
export type NullableHandler = ((...args: string[]) => void) | null | undefined;

export interface EventBus {
  subscribers: Record<string, NullableHandler>;
  dispatch(event: string, ...payload: string[]): void;
}

export function runEvents(bus: EventBus, items: [string, string][]): void {
  for (const [key, value] of items) {
    const handler = bus.subscribers[key];
    if (handler) {
      handler(value);
    }
  }
}
`;
      const decomp = decompile(tsCode, "typescript", { filePath: "EventBus.ts" });
      const parsedAst = parse(decomp.ail, "EventBus.ts.ail");
      expect(parsedAst).toBeDefined();
      expect(parsedAst.items.length).toBeGreaterThanOrEqual(2);
    });

    it("decompiles React 19 TSX components with JSX hierarchy into 100% parseable AIL DSL", () => {
      const tsxCode = `
import React from "react";

export interface ModalProps {
  title: string;
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

export function Modal({ title, isOpen, onClose, children }: ModalProps) {
  if (!isOpen) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-container" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h3>{title}</h3>
          <button className="btn-close" onClick={onClose}>Close</button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
`;
      const decomp = decompile(tsxCode, "tsx", { filePath: "Modal.tsx" });
      const parsedAst = parse(decomp.ail, "Modal.tsx.ail");
      expect(parsedAst).toBeDefined();
      expect(parsedAst.items.some((i) => i.kind === "ComponentDecl" || i.kind === "FunctionDecl")).toBe(true);
    });

    it("decompiles C# domain classes, properties, and match expressions into 100% parseable AIL", () => {
      const csCode = `
using System;

namespace Game.Combat
{
    public class CombatEntity
    {
        public string Name { get; set; }
        public int Health { get; set; } = 100;
        public bool IsAlive => Health > 0;

        public void TakeDamage(int amount)
        {
            Health = Math.Max(0, Health - amount);
        }

        public string EvaluateThreat(int distance)
        {
            if (distance < 5)
            {
                return "CRITICAL";
            }
            else if (distance < 15)
            {
                return "MODERATE";
            }
            else
            {
                return "LOW";
            }
        }
    }
}
`;
      const decomp = decompile(csCode, "csharp", { filePath: "CombatEntity.cs" });
      const parsedAst = parse(decomp.ail, "CombatEntity.cs.ail");
      expect(parsedAst).toBeDefined();
      expect(parsedAst.items.some((i) => i.kind === "ClassDecl")).toBe(true);
    });

    it("decompiles C++ headers and methods with math helpers into 100% parseable AIL", () => {
      const cppCode = `
#include <cmath>
#include <string>

class VectorMath {
public:
    static float Distance(float x1, float y1, float x2, float y2) {
        float dx = x2 - x1;
        float dy = y2 - y1;
        return std::sqrt(dx * dx + dy * dy);
    }

    static float Clamp(float v, float minVal, float maxVal) {
        if (v < minVal) return minVal;
        if (v > maxVal) return maxVal;
        return v;
    }
};
`;
      const decomp = decompile(cppCode, "cpp", { filePath: "VectorMath.cpp" });
      const parsedAst = parse(decomp.ail, "VectorMath.cpp.ail");
      expect(parsedAst).toBeDefined();
      expect(parsedAst.items.some((i) => i.kind === "ClassDecl")).toBe(true);
    });

    it("decompiles CSS responsive token rules into 100% parseable AIL style blocks", () => {
      const cssCode = `
:root {
  --primary-color: #3b82f6;
  --spacing-md: 16px;
}

.hero-banner {
  display: flex;
  flex-direction: column;
  padding: var(--spacing-md);
  background-color: var(--primary-color);
}
`;
      const decomp = decompile(cssCode, "css", { filePath: "theme.css" });
      const parsedAst = parse(decomp.ail, "theme.css.ail");
      expect(parsedAst).toBeDefined();
      expect(parsedAst.items.some((i) => i.kind === "StyleDecl")).toBe(true);
    });

    it("decompiles HTML5 markup into 100% parseable AIL declarative layout nodes", () => {
      const htmlCode = `
<section class="card-grid">
  <article class="card">
    <h2>Feature One</h2>
    <p>High-performance compiler architecture.</p>
  </article>
</section>
`;
      const decomp = decompile(htmlCode, "html", { filePath: "page.html" });
      const parsedAst = parse(decomp.ail, "page.html.ail");
      expect(parsedAst).toBeDefined();
    });
  });

  // ===========================================================================
  // SECTION 2: Put/Get Lens Invariant: Put(Get(c), Omega) == c
  // ===========================================================================
  describe("Direction 2 & Lens Invariant: Put(Get(c), Omega) == c", () => {
    it("guarantees 100% bit-identical lossless roundtrip for TypeScript with comments and types", () => {
      const originalTs = `/**
 * @license Apache-2.0
 * Core Simulation Vector Contract
 */
export interface Vector2D {
  x: number;
  y: number;
}

export function addVectors(a: Vector2D, b: Vector2D): Vector2D {
  return {
    x: a.x + b.x,
    y: a.y + b.y,
  };
}
`;
      const res = executeRoundtrip(originalTs, "typescript", "Vector.ts");
      expect(res.triviaEntriesCount).toBeGreaterThan(0);
      expect(res.isIdentical).toBe(true);
      expect(res.reconstructed.trim()).toBe(originalTs.trim());
    });

    it("guarantees 100% bit-identical lossless roundtrip for React 19 TSX components", () => {
      const originalTsx = `export interface CardProps {
  title: string;
  count: number;
}

export function StatCard({ title, count }: CardProps) {
  return (
    <div className="stat-card">
      <span className="title">{title}</span>
      <span className="count">{count}</span>
    </div>
  );
}
`;
      const res = executeRoundtrip(originalTsx, "tsx", "StatCard.tsx");
      expect(res.isIdentical).toBe(true);
      expect(res.reconstructed.trim()).toBe(originalTsx.trim());
    });

    it("guarantees 100% bit-identical lossless roundtrip for CSS stylesheets", () => {
      const originalCss = `body {
  margin: 0;
  padding: 0;
}

.container {
  display: flex;
  gap: 12px;
}
`;
      const res = executeRoundtrip(originalCss, "css", "layout.css");
      expect(res.isIdentical).toBe(true);
      expect(res.reconstructed.trim()).toBe(originalCss.trim());
    });

    it("guarantees 100% bit-identical lossless roundtrip for HTML documents", () => {
      const originalHtml = `<div class="hero">
  <h1>Welcome to AIL</h1>
  <p>Homoiconic bidirectional programming language.</p>
</div>
`;
      const res = executeRoundtrip(originalHtml, "html", "index.html");
      expect(res.isIdentical).toBe(true);
      expect(res.reconstructed.trim()).toBe(originalHtml.trim());
    });
  });

  // ===========================================================================
  // SECTION 3: Multi-Round Idempotence & Zero Drift Stability
  // ===========================================================================
  describe("Multi-Round Stability & Idempotence (Convergence)", () => {
    it("converges to zero drift across multiple roundtrips: Round 1 == Round 2 == Round 3", () => {
      const source = `export interface Config {
  host: string;
  port: number;
  ssl: boolean;
}

export function formatUrl(config: Config): string {
  const protocol = config.ssl ? "https" : "http";
  return protocol + "://" + config.host + ":" + config.port;
}
`;
      // Round 1
      const round1 = executeRoundtrip(source, "typescript", "config.ts");
      expect(round1.isIdentical).toBe(true);

      // Round 2 (Put(Get(Reconstructed)))
      const round2 = executeRoundtrip(round1.reconstructed, "typescript", "config.ts");
      expect(round2.isIdentical).toBe(true);
      expect(round2.reconstructed).toBe(round1.reconstructed);

      // Round 3
      const round3 = executeRoundtrip(round2.reconstructed, "typescript", "config.ts");
      expect(round3.isIdentical).toBe(true);
      expect(round3.reconstructed).toBe(round1.reconstructed);
    });

    it("satisfies AIL-first roundtrip: AIL -> Target -> AIL (executeAilRoundtrip)", () => {
      const ailSource = `pub type Player:
  id: str
  level: int = 1
  score: float = 0.0

pub fn advanceLevel(p: Player) -> Player:
  ret p
`;
      const res = executeAilRoundtrip(ailSource, "typescript", "player.ts.ail");
      expect(res.targetReconstructed).toBeDefined();
      expect(res.targetReconstructed.length).toBeGreaterThan(0);
      expect(res.ailReconstructed).toBeDefined();
      // Verifies that the decompiled reverse result parses cleanly
      const reparsed = parse(res.ailReconstructed, "player.ts.ail");
      expect(reparsed).toBeDefined();
    });
  });

  // ===========================================================================
  // SECTION 4: Real-World Case Studies across Diverse Repositories
  // ===========================================================================
  describe("Real-World Case Studies from /home/forart/dev/ail_test_case", () => {
    const testCaseSrc = "/home/forart/dev/ail_test_case/src";

    it("verifies 100% parse success on complex TypeScript math modules (case03 MathX.ts)", () => {
      const targetPath = path.join(testCaseSrc, "case03/src/core/MathX.ts");
      if (!fs.existsSync(targetPath)) return;

      const original = fs.readFileSync(targetPath, "utf-8");
      const roundtripRes = executeRoundtrip(original, "typescript", targetPath);

      // Decompilation succeeded
      expect(roundtripRes.ail).toBeDefined();

      // Parse decompiled AIL
      const parsedAst = parse(roundtripRes.ail, `${targetPath}.ail`);
      expect(parsedAst).toBeDefined();

      // Put/Get identity
      expect(roundtripRes.isIdentical).toBe(true);
    });

    it("verifies 100% parse success on vector physics modules (case03 Vec2.ts)", () => {
      const targetPath = path.join(testCaseSrc, "case03/src/core/Vec2.ts");
      if (!fs.existsSync(targetPath)) return;

      const original = fs.readFileSync(targetPath, "utf-8");
      const roundtripRes = executeRoundtrip(original, "typescript", targetPath);

      expect(roundtripRes.isIdentical).toBe(true);
      const parsedAst = parse(roundtripRes.ail, `${targetPath}.ail`);
      expect(parsedAst).toBeDefined();
    });

    it("verifies React 19 TSX real-world application components (case49 App.tsx)", () => {
      const targetPath = path.join(testCaseSrc, "case49/src/App.tsx");
      if (!fs.existsSync(targetPath)) return;

      const original = fs.readFileSync(targetPath, "utf-8");
      const roundtripRes = executeRoundtrip(original, "tsx", targetPath);

      expect(roundtripRes.isIdentical).toBe(true);
      const parsedAst = parse(roundtripRes.ail, `${targetPath}.ail`);
      expect(parsedAst).toBeDefined();
    });

    it("verifies C++ helper utilities decompilation and semantic re-emission (case42 StringHelper.cpp)", () => {
      const targetPath = path.join(testCaseSrc, "case42/src/helpers/StringHelper.cpp");
      if (!fs.existsSync(targetPath)) return;

      const original = fs.readFileSync(targetPath, "utf-8");
      const roundtripRes = executeRoundtrip(original, "cpp", targetPath);

      // Must decompile without crash
      expect(roundtripRes.ail).toBeDefined();
      // Generated AIL must parse
      const parsedAst = parse(roundtripRes.ail, `${targetPath}.ail`);
      expect(parsedAst).toBeDefined();
      // Must re-emit valid C++ code
      expect(roundtripRes.reconstructed).toContain("namespace dof");
      expect(roundtripRes.reconstructed).toContain("std::string trim");
    });

    it("verifies C# domain entities decompilation and semantic re-emission (case43 FoodItem.cs)", () => {
      const targetPath = path.join(testCaseSrc, "case43/godot/src/Sim/FoodItem.cs");
      if (!fs.existsSync(targetPath)) return;

      const original = fs.readFileSync(targetPath, "utf-8");
      const roundtripRes = executeRoundtrip(original, "csharp", targetPath);

      expect(roundtripRes.ail).toBeDefined();
      const parsedAst = parse(roundtripRes.ail, `${targetPath}.ail`);
      expect(parsedAst).toBeDefined();
      expect(roundtripRes.reconstructed).toContain("FoodItem");
    });

    it("verifies PHP 8 domain entities decompilation and semantic re-emission (case51 Order.php)", () => {
      const targetPath = path.join(testCaseSrc, "case51/Order.php");
      if (!fs.existsSync(targetPath)) return;

      const original = fs.readFileSync(targetPath, "utf-8");
      const roundtripRes = executeRoundtrip(original, "php", targetPath);

      expect(roundtripRes.ail).toBeDefined();
      const parsedAst = parse(roundtripRes.ail, `${targetPath}.ail`);
      expect(parsedAst).toBeDefined();
      expect(roundtripRes.reconstructed).toContain("class Order");
      expect(roundtripRes.reconstructed).toContain("__construct");
      expect(roundtripRes.reconstructed).toContain("match");
    });

    it("verifies PHP 8 service layer decompilation and semantic re-emission (case51 CustomerService.php)", () => {
      const targetPath = path.join(testCaseSrc, "case51/CustomerService.php");
      if (!fs.existsSync(targetPath)) return;

      const original = fs.readFileSync(targetPath, "utf-8");
      const roundtripRes = executeRoundtrip(original, "php", targetPath);

      expect(roundtripRes.ail).toBeDefined();
      const parsedAst = parse(roundtripRes.ail, `${targetPath}.ail`);
      expect(parsedAst).toBeDefined();
      expect(roundtripRes.reconstructed).toContain("class CustomerService");
      expect(roundtripRes.reconstructed).toContain("getOrderTotal");
    });

    it("verifies Python 3.10+ dataclasses decompilation and semantic re-emission (case52 UserEntity.py)", () => {
      const targetPath = path.join(testCaseSrc, "case52/UserEntity.py");
      if (!fs.existsSync(targetPath)) return;

      const original = fs.readFileSync(targetPath, "utf-8");
      const roundtripRes = executeRoundtrip(original, "python", targetPath);

      expect(roundtripRes.ail).toBeDefined();
      const parsedAst = parse(roundtripRes.ail, `${targetPath}.ail`);
      expect(parsedAst).toBeDefined();
      expect(roundtripRes.isIdentical).toBe(true);
      expect(roundtripRes.reconstructed).toContain("@dataclass");
      expect(roundtripRes.reconstructed).toContain("class UserEntity");
    });

    it("verifies Python 3.10+ async functions and pattern matching decompilation (case52 AsyncPipeline.py)", () => {
      const targetPath = path.join(testCaseSrc, "case52/AsyncPipeline.py");
      if (!fs.existsSync(targetPath)) return;

      const original = fs.readFileSync(targetPath, "utf-8");
      const roundtripRes = executeRoundtrip(original, "python", targetPath);

      expect(roundtripRes.ail).toBeDefined();
      const parsedAst = parse(roundtripRes.ail, `${targetPath}.ail`);
      expect(parsedAst).toBeDefined();
      expect(roundtripRes.isIdentical).toBe(true);
      expect(roundtripRes.reconstructed).toContain("async def");
      expect(roundtripRes.reconstructed).toContain("match");
    });

    it("verifies Kotlin 1.9/2.x data classes and decompilation (case53 ProductEntity.kt)", () => {
      const targetPath = path.join(testCaseSrc, "case53/ProductEntity.kt");
      if (!fs.existsSync(targetPath)) return;

      const original = fs.readFileSync(targetPath, "utf-8");
      const roundtripRes = executeRoundtrip(original, "kotlin", targetPath);

      expect(roundtripRes.ail).toBeDefined();
      const parsedAst = parse(roundtripRes.ail, `${targetPath}.ail`);
      expect(parsedAst).toBeDefined();
      expect(roundtripRes.isIdentical).toBe(true);
      expect(roundtripRes.reconstructed).toContain("data class ProductEntity");
      expect(roundtripRes.reconstructed).toContain("formattedPrice");
    });

    it("verifies Kotlin 1.9/2.x interfaces and coroutines decompilation (case53 ProductRepository.kt)", () => {
      const targetPath = path.join(testCaseSrc, "case53/ProductRepository.kt");
      if (!fs.existsSync(targetPath)) return;

      const original = fs.readFileSync(targetPath, "utf-8");
      const roundtripRes = executeRoundtrip(original, "kotlin", targetPath);

      expect(roundtripRes.ail).toBeDefined();
      const parsedAst = parse(roundtripRes.ail, `${targetPath}.ail`);
      expect(parsedAst).toBeDefined();
      expect(roundtripRes.isIdentical).toBe(true);
      expect(roundtripRes.reconstructed).toContain("interface ProductRepository");
      expect(roundtripRes.reconstructed).toContain("suspend fun findById");
      expect(roundtripRes.reconstructed).toContain("class InMemoryProductRepository");
    });
  });

  // ===========================================================================
  // SECTION 5: Diagnostics & Semantic Typecheck Soundness
  // ===========================================================================
  describe("Absence of Syntax Diagnostics & Semantic Typecheck Soundness", () => {
    it("guarantees zero syntax errors and produces a valid typed module", () => {
      const source = `
export interface WeaponStats {
  damage: number;
  rateOfFire: number;
  ammoCapacity: number;
}

export class Weapon {
  stats: WeaponStats;
  currentAmmo: number;

  constructor(stats: WeaponStats) {
    this.stats = stats;
    this.currentAmmo = stats.ammoCapacity;
  }

  fire(): boolean {
    if (this.currentAmmo > 0) {
      this.currentAmmo -= 1;
      return true;
    }
    return false;
  }
}
`;
      const decomp = decompile(source, "typescript", { filePath: "Weapon.ts" });
      const { ast } = parseWithTrivia(decomp.ail, "Weapon.ts.ail");

      // Verify sound type checking runs without fatal exceptions
      const checker = new TypeChecker();
      expect(() => checker.checkModule(ast)).not.toThrow();
    });
  });
});
