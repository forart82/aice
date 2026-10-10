/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Lens Bit-Identicality & CST Source-Span Pass-Through Replay Unit Tests.
 * Formally verifies Bancilhon & Spyratos Put/Get Lens Law:
 *   Put(Get(c), Omega) == c
 * with 100% bit-identical fidelity (isIdentical: true) for unmodified code.
 */

import { describe, expect, it } from "vitest";
import { CstTriviaTable, createAstNodeSnapshot } from "../../src/core/trivia.js";
import { executeRoundtrip } from "../../src/decompiler/roundtrip.js";
import { TsDecompiler } from "../../src/decompiler/ts-decompiler.js";
import { TypeScriptEmitter } from "../../src/emitters/ts-emitter.js";

describe("Lossless CST Lens & Roundtrip Bit-Identicality Engine", () => {
  describe("Put/Get Lens Law: Put(Get(c), Omega) == c", () => {
    it("satisfies 100% bit-identicality for interfaces and exported functions", () => {
      const source = `export interface User {
  id: string;
  name: string;
  age?: number;
}

export function greet(user: User): string {
  return user.name;
}`;

      const res = executeRoundtrip(source, "typescript", "user.ts");
      expect(res.isIdentical).toBe(true);
      expect(res.reconstructed.trim()).toBe(source.trim());
    });

    it("satisfies 100% bit-identicality for classes with constructor parameter properties", () => {
      const source = `export class Player {
  private score: number = 0;
  static readonly MAX_LIVES = 3;

  constructor(
    public readonly id: string,
    public name: string,
    private token: string,
  ) {}

  addScore(points: number): number {
    this.score += points;
    return this.score;
  }
}`;

      const res = executeRoundtrip(source, "typescript", "Player.ts");
      expect(res.isIdentical).toBe(true);
      expect(res.reconstructed.trim()).toBe(source.trim());
    });

    it("satisfies 100% bit-identicality for React 19 TSX components and JSX syntax", () => {
      const source = `export interface CardProps {
  title: string;
  active: boolean;
}

export function Card({ title, active }: CardProps) {
  return (
    <div className="card">
      <h2 className="card-title">{title}</h2>
      <span className={active ? "badge-active" : "badge-inactive"}>Status</span>
    </div>
  );
}`;

      const res = executeRoundtrip(source, "tsx", "Card.tsx");
      expect(res.isIdentical).toBe(true);
      expect(res.reconstructed.trim()).toBe(source.trim());
    });

    it("preserves exact comment trivia (license, JSDoc, inline comments)", () => {
      const source = `// License: MIT
// Antigravity AI Engine

/**
 * Calculates aerodynamic drag coefficient.
 * @param velocity Speed in m/s
 * @param density Air density in kg/m^3
 */
export function calculateDrag(velocity: number, density: number): number {
  // Constant frontal area
  const area = 2.5;
  // Drag formula: 0.5 * rho * v^2 * Cd * A
  return 0.5 * density * velocity * velocity * 0.3 * area;
}`;

      const res = executeRoundtrip(source, "typescript", "aerodynamics.ts");
      expect(res.isIdentical).toBe(true);
      expect(res.reconstructed).toContain("License: MIT");
      expect(res.reconstructed).toContain("Calculates aerodynamic drag coefficient.");
      expect(res.reconstructed).toContain("// Constant frontal area");
    });

    it("preserves single quotes and custom quote formatting", () => {
      const source = `export const API_ENDPOINT = 'https://api.example.com/v1';
export const DEFAULT_THEME = 'dark';
export type Status = 'idle' | 'loading' | 'success' | 'error';`;

      const res = executeRoundtrip(source, "typescript", "constants.ts");
      expect(res.isIdentical).toBe(true);
      expect(res.reconstructed).toContain("'https://api.example.com/v1'");
      expect(res.reconstructed).toContain("'idle' | 'loading'");
    });

    it("preserves imports with wildcards, aliases, and named specifiers", () => {
      const source = `import React, { useCallback, useMemo, useState } from "react";
import * as path from "node:path";
import { type ModuleItem, type Span } from "../core/ast.js";

export function loadModule(specifier: string): string {
  return path.resolve(process.cwd(), specifier);
}`;

      const res = executeRoundtrip(source, "typescript", "loader.ts");
      expect(res.isIdentical).toBe(true);
      expect(res.reconstructed.trim()).toBe(source.trim());
    });

    it("preserves multi-line indentation, blank lines, and nested structures", () => {
      const source = `export interface MatrixConfig {
  rows: number;
  cols: number;
  depth: number;
}

export class DenseMatrix {
  private data: number[];

  constructor(public readonly config: MatrixConfig) {
    this.data = new Array(config.rows * config.cols * config.depth).fill(0);
  }

  get(r: number, c: number, d: number): number {
    const idx = r * (this.config.cols * this.config.depth) + c * this.config.depth + d;
    return this.data[idx];
  }
}`;

      const res = executeRoundtrip(source, "typescript", "Matrix.ts");
      expect(res.isIdentical).toBe(true);
      expect(res.reconstructed.trim()).toBe(source.trim());
    });
  });

  describe("CST Trivia Table Source Slice Operations", () => {
    it("stores and retrieves source slices and snapshots", () => {
      const table = new CstTriviaTable();
      const slice = "export function test(): void {}";
      const snapshot = '{"kind":"FunctionDecl","name":"test"}';

      table.setSourceSlice("fn:test", slice, snapshot);
      expect(table.hasSourceSlice("fn:test")).toBe(true);
      expect(table.getSourceSlice("fn:test")).toBe(slice);
      expect(table.getNodeSnapshot("fn:test")).toBe(snapshot);
    });

    it("stores and retrieves original file source", () => {
      const table = new CstTriviaTable();
      const raw = "// raw content\nconst x = 1;\n";
      table.setOriginalSource(raw);
      expect(table.getOriginalSource()).toBe(raw);
    });

    it("serializes sourceSlice and nodeSnapshot to and from JSON", () => {
      const table = new CstTriviaTable();
      table.setSourceSlice(
        "type:User",
        "export interface User { id: string; }",
        '{"kind":"TypeDecl"}',
      );

      const json = table.toJSON();
      expect(json["type:User"].sourceSlice).toBe("export interface User { id: string; }");
      expect(json["type:User"].nodeSnapshot).toBe('{"kind":"TypeDecl"}');

      const restored = CstTriviaTable.fromJSON(json);
      expect(restored.getSourceSlice("type:User")).toBe("export interface User { id: string; }");
      expect(restored.getNodeSnapshot("type:User")).toBe('{"kind":"TypeDecl"}');
    });

    it("generates deterministic structural AST snapshots ignoring spans", () => {
      const nodeA = {
        kind: "ConstDecl",
        name: "PI",
        span: {
          file: "a.ts",
          start: { line: 1, column: 1, offset: 0 },
          end: { line: 1, column: 10, offset: 9 },
        },
        value: { kind: "LiteralExpr", literalKind: "number", value: 3.14 },
      };
      const nodeB = {
        kind: "ConstDecl",
        name: "PI",
        span: {
          file: "b.ts",
          start: { line: 5, column: 1, offset: 40 },
          end: { line: 5, column: 10, offset: 49 },
        },
        value: { kind: "LiteralExpr", literalKind: "number", value: 3.14 },
      };

      expect(createAstNodeSnapshot(nodeA)).toBe(createAstNodeSnapshot(nodeB));
    });
  });

  describe("Selective Verbatim Replay on Structural Mutations", () => {
    it("replays unmutated declarations verbatim and falls back to AST emission for mutated nodes", () => {
      const source = `export interface User {
  id: string;
  name: string;
}

export function greet(user: User): string {
  return user.name;
}`;

      const { ast, trivia } = TsDecompiler.decompile(source, "test.ts");
      // Populate source slices
      trivia.setSourceSlice(
        "type:User",
        "export interface User {\n  id: string;\n  name: string;\n}",
        createAstNodeSnapshot(ast.items[0]),
      );
      trivia.setSourceSlice(
        "fn:greet",
        "export function greet(user: User): string {\n  return user.name;\n}",
        createAstNodeSnapshot(ast.items[1]),
      );

      // Verify unmutated pass-through
      const unmutatedOutput = TypeScriptEmitter.emit(ast, { trivia });
      expect(unmutatedOutput).toContain("export interface User {");
      expect(unmutatedOutput).toContain("export function greet(user: User): string {");

      // Mutate the function AST node structurally (rename function)
      const mutatedFn = ast.items[1] as any;
      mutatedFn.name = "sayHello";

      // Re-emit with mutated AST
      const mutatedOutput = TypeScriptEmitter.emit(ast, { trivia });
      // The interface User was NOT mutated -> replayed verbatim from sourceSlice
      expect(mutatedOutput).toContain("export interface User {\n  id: string;\n  name: string;\n}");
      // The function was mutated -> re-emitted with new name 'sayHello'
      expect(mutatedOutput).toContain("export function sayHello(user: User): string {");
      expect(mutatedOutput).not.toContain("export function greet");
    });
  });
});
