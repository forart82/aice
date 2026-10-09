/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Bidirectional Roundtrip Transpilation & Put/Get Verification Tests (Phase 2.1).
 */

import { describe, expect, it } from "vitest";
import { executeRoundtrip } from "../../src/decompiler/roundtrip.js";

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

  it("decompiles and roundtrips string literal unions as enums without parser failure", () => {
    const originalTs = `export type WaveShape = "sine" | "square" | "sawtooth" | "triangle";`;

    const res = executeRoundtrip(originalTs, "typescript", "WaveShape.ts");
    expect(res.ail).toContain("enum WaveShape:");
    expect(res.ail).toContain("sine");
    expect(res.ail).toContain("square");
    expect(res.reconstructed).toContain('export type WaveShape = "sine" | "square" | "sawtooth" | "triangle";');
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
    expect(res.ail).toContain("get x() -> int = this._x");
    expect(res.ail).toContain("set x(val:int) = this._x = val");
    expect(res.ail).toContain("get length() -> int = this._x * this._x");
    expect(res.reconstructed).toContain("get x(): number {");
    expect(res.reconstructed).toContain("set x(val: number) {");
  });
});
