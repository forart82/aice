/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Bidirectional Roundtrip Transpilation & Put/Get Verification Tests (Phase 2.1).
 */

import { describe, expect, it } from "vitest";
import { executeAilRoundtrip, executeRoundtrip } from "../../src/decompiler/roundtrip.js";

describe("Bidirectional Roundtrip Lens Engine", () => {
  it("satisfies Put(Get(c), Omega) == c for CSS stylesheets", () => {
    const originalCss = `body {
  margin: 0;
  padding: 0;
  color: #fff;
}

.card {
  display: flex;
  padding: 16px;
}`;

    const res = executeRoundtrip(originalCss, "css", "theme.css");
    expect(res.target).toBe("css");
    expect(res.ail).toContain("style body:");
    expect(res.ail).toContain('style ".card":');
    expect(res.isIdentical).toBe(true);
  });

  it("satisfies Put(Get(c), Omega) == c for HTML5 documents", () => {
    const originalHtml = `<div class="container">
  <h1>Page Title</h1>
  <p>Hello world</p>
</div>`;

    const res = executeRoundtrip(originalHtml, "html", "page.html");
    expect(res.target).toBe("html");
    expect(res.ail).toContain('div(class: "container"):');
    expect(res.ail).toContain('h1: "Page Title"');
    expect(res.isIdentical).toBe(true);
  });

  it("preserves TypeScript interface contracts and function logic across roundtrips", () => {
    const originalTs = `export interface User {
  id: string;
  name: string;
}

export function greet(user: User): string {
  return user.name;
}`;

    const res = executeRoundtrip(originalTs, "typescript", "greet.ts");
    expect(res.reconstructed).toContain("export interface User {");
    expect(res.reconstructed).toContain("id: string;");
    expect(res.reconstructed).toContain("export function greet(user: User): string {");
    expect(res.reconstructed).toContain("return user.name;");
  });

  it("preserves React 19 TSX component structure and attributes across roundtrips", () => {
    const originalTsx = `export interface ButtonProps {
  label: string;
}

export function Button({ label }: ButtonProps) {
  return (
    <button className="btn">
      <span>{label}</span>
    </button>
  );
}`;

    const res = executeRoundtrip(originalTsx, "tsx", "Button.tsx");
    expect(res.ail).toContain("type ButtonProps:");
    expect(res.ail).toContain("component Button(label:str):");
    expect(res.reconstructed).toContain("export function Button({ label }: ButtonProps) {");
    expect(res.reconstructed).toContain('<button className="btn">');
    expect(res.reconstructed).toContain("<span>{label}</span>");
  });

  it("preserves JSDoc comments through CST trivia table", () => {
    const originalTs = `/**
 * Core User Profile Interface
 */
export interface UserProfile {
  id: string;
}
`;

    const res = executeRoundtrip(originalTs, "typescript", "profile.ts");
    expect(res.triviaEntriesCount).toBeGreaterThan(0);
    expect(res.reconstructed).toContain("Core User Profile Interface");
  });

  it("decompiles and roundtrips TypeScript classes with properties and methods", () => {
    const originalTs = `export class Hazard {
  radius: number = 20;
  life: number = 5;
  static defaultSpeed: number = 10;
  update(dt: number): void {
    return dt;
  }
}`;

    const res = executeRoundtrip(originalTs, "typescript", "Hazard.ts");
    expect(res.ail).toContain("pub class Hazard:");
    expect(res.ail).toContain("radius: int = 20");
    expect(res.ail).toContain("life: int = 5");
    expect(res.ail).toContain("static defaultSpeed: int = 10");
    expect(res.ail).toContain("fn update(dt:int) -> void = dt");
    expect(res.reconstructed).toContain("export class Hazard");
    expect(res.reconstructed).toContain("radius: number = 20;");
    expect(res.reconstructed).toContain("update(dt: number): void {");
  });

  it("decompiles and roundtrips string literal unions as type aliases without synthetic enums", () => {
    const originalTs = `export type WaveShape = "sine" | "square" | "sawtooth" | "triangle";`;

    const res = executeRoundtrip(originalTs, "typescript", "WaveShape.ts");
    expect(res.ail).toContain('type WaveShape = "sine" | "square" | "sawtooth" | "triangle"');
    expect(res.reconstructed).toContain(
      'export type WaveShape = "sine" | "square" | "sawtooth" | "triangle";',
    );
  });

  it("decompiles and roundtrips classes with getters, setters, and expression bodies", () => {
    const originalTs = `export class Vector2D {
  _x: number = 0;
  get x(): number {
    return this._x;
  }
  set x(val: number) {
    this._x = val;
  }
  get length(): number {
    return this._x * this._x;
  }
}`;

    const res = executeRoundtrip(originalTs, "typescript", "Vector2D.ts");
    expect(res.ail).toContain("prop _x, x: int = 0");
    expect(res.ail).toContain("get length() -> int = this._x * this._x");
    expect(res.reconstructed).toContain("get x() { return this._x; }");
    expect(res.reconstructed).toContain("set x(v: number) { this._x = v; }");
  });

  it("satisfies Put(Get(c), Omega) == c for keywordless := and ::= variable declarations", () => {
    const originalTs = `export function computeState(initial: number): number {
  const x = 42;
  let y = initial;
  const name: string = "AIL";
  let active: boolean = true;
  return (x + y);
}`;

    const res = executeRoundtrip(originalTs, "typescript", "state.ts");
    expect(res.ail).toContain("x := 42");
    expect(res.ail).toContain("y ::= initial");
    expect(res.ail).toContain('name: str := "AIL"');
    expect(res.ail).toContain("active: bool ::= true");
    expect(res.reconstructed).toContain("const x = 42;");
    expect(res.reconstructed).toContain("let y = initial;");
    expect(res.reconstructed).toContain('const name: string = "AIL";');
    expect(res.reconstructed).toContain("let active: boolean = true;");
    expect(res.isIdentical).toBe(true);
  });

  it("satisfies Put(Get(c), Omega) == c for dual-case property accessors (prop X, x syntax)", () => {
    const originalTs = `export class PlayerTransform {
  X: number = 0;
  get x() { return this.X; }
  set x(v: number) { this.X = v; }
  Speed: number = 10;
  get speed() { return this.Speed; }
  set speed(v: number) { this.Speed = v; }
}`;

    const res = executeRoundtrip(originalTs, "typescript", "PlayerTransform.ts");
    expect(res.ail).toContain("prop X, x: int = 0");
    expect(res.ail).toContain("prop Speed, speed: int = 10");
    expect(res.reconstructed).toContain("X: number = 0;");
    expect(res.reconstructed).toContain("get x() { return this.X; }");
    expect(res.reconstructed).toContain("set x(v: number) { this.X = v; }");
    expect(res.reconstructed).toContain("Speed: number = 10;");
    expect(res.reconstructed).toContain("get speed() { return this.Speed; }");
    expect(res.reconstructed).toContain("set speed(v: number) { this.Speed = v; }");
    expect(res.isIdentical).toBe(true);
  });

  it("satisfies Put(Get(c), Omega) == c for vector destructuring ([x, y] := [1, 2])", () => {
    const originalTs = `export function unpackCoordinates(): number {
  const [x, y] = [10, 20];
  let [dx, dy] = [1, 2];
  return dx;
}`;

    const res = executeRoundtrip(originalTs, "typescript", "coords.ts");
    expect(res.ail).toContain("[x, y] := [10, 20]");
    expect(res.ail).toContain("[dx, dy] ::= [1, 2]");
    expect(res.reconstructed).toContain("const [x, y] = [10, 20];");
    expect(res.reconstructed).toContain("let [dx, dy] = [1, 2];");
    expect(res.isIdentical).toBe(true);
  });

  it("satisfies Put(Get(c), Omega) == c for math builtins (min, max, hypot, clamp)", () => {
    const originalTs = `export function computeKinematics(x: number, y: number, rawVal: number): number {
  const low = Math.min(x, y);
  const high = Math.max(x, y);
  const dist = Math.hypot(x, y);
  const clamped = Math.max(0, Math.min(100, rawVal));
  return clamped;
}`;

    const res = executeRoundtrip(originalTs, "typescript", "kinematics.ts");
    expect(res.ail).toContain("min(x, y)");
    expect(res.ail).toContain("max(x, y)");
    expect(res.ail).toContain("hypot(x, y)");
    expect(res.ail).toContain("clamp(rawVal, 0, 100)");
    expect(res.reconstructed).toContain("const low = Math.min(x, y);");
    expect(res.reconstructed).toContain("const high = Math.max(x, y);");
    expect(res.reconstructed).toContain("const dist = Math.hypot(x, y);");
    expect(res.reconstructed).toContain("const clamped = Math.max(0, Math.min(100, rawVal));");
    expect(res.isIdentical).toBe(true);
  });

  it("satisfies Put(Get(c), Omega) == c for CSS layout macros (fl-row, fl-col, fl-center)", () => {
    const originalCss = `.row-box {
  display: flex;
  flex-direction: row;
}

.col-box {
  display: flex;
  flex-direction: column;
}

.centered-card {
  display: flex;
  align-items: center;
  justify-content: center;
}`;

    const res = executeRoundtrip(originalCss, "css", "layout.css");
    expect(res.ail).toContain('style ".row-box":');
    expect(res.ail).toContain("fl-row");
    expect(res.ail).toContain('style ".col-box":');
    expect(res.ail).toContain("fl-col");
    expect(res.ail).toContain('style ".centered-card":');
    expect(res.ail).toContain("fl-center");
    expect(res.isIdentical).toBe(true);
  });

  it("satisfies Put(Get(c), Omega) == c for CSS token sheets and unit annotations", () => {
    const originalCss = `:root {
  --spacing-1: 0.25rem;
  --spacing-2: 0.5rem;
  --spacing-3: 0.75rem;
}`;

    const res = executeRoundtrip(originalCss, "css", "tokens.css");
    expect(res.ail).toContain("tokens spacing[rem]: 1: 0.25, 2: 0.5, 3: 0.75");
    expect(res.reconstructed).toContain("--spacing-1: 0.25rem;");
    expect(res.reconstructed).toContain("--spacing-2: 0.5rem;");
    expect(res.reconstructed).toContain("--spacing-3: 0.75rem;");
    expect(res.isIdentical).toBe(true);
  });

  it("satisfies Get(Put(a)) == a lens invariant for AIL constructs across targets", () => {
    const ailCss = `module theme

style ".header":
  fl-row
  padding: 10px
`;
    const cssRes = executeAilRoundtrip(ailCss, "css", "theme.ail");
    expect(cssRes.targetReconstructed).toContain("display: flex;");
    expect(cssRes.targetReconstructed).toContain("flex-direction: row;");
    expect(cssRes.ailReconstructed).toContain("fl-row");
    expect(cssRes.isTargetIdentical).toBe(true);
    expect(cssRes.isAilIdentical).toBe(true);
  });
});
