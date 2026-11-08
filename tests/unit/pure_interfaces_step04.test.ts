import { describe, expect, it } from "vitest";
import type { TypeDecl } from "../../src/core/ast.js";
import { parse } from "../../src/core/parser.js";
import { emitTarget } from "../../src/emitters/index.js";
import { TypeScriptEmitter } from "../../src/emitters/ts-emitter.js";

describe("Phase 0 Steps 0.4 & 0.6: Pure Interfaces & Optional Interface Fields", () => {
  it("parses optional fields with prop?: Type and emits pure interface without factory", () => {
    const src = `type Opts:
  width?: int
  height?: int
`;
    const mod = parse(src, "opts.ts.aice");
    expect(mod.items).toHaveLength(1);

    const typeDecl = mod.items[0] as TypeDecl;
    expect(typeDecl.kind).toBe("TypeDecl");
    expect(typeDecl.name).toBe("Opts");
    expect(typeDecl.fields).toHaveLength(2);

    expect(typeDecl.fields![0].name).toBe("width");
    expect(typeDecl.fields![0].isOptional).toBe(true);

    expect(typeDecl.fields![1].name).toBe("height");
    expect(typeDecl.fields![1].isOptional).toBe(true);

    // Emits pure interface when pureInterfaces: true is set
    const emitted = emitTarget(mod, "typescript", { pureInterfaces: true, watermark: false });
    expect(emitted).toBe(`export interface Opts {\n  width?: number;\n  height?: number;\n}\n`);
    expect(emitted).not.toContain("export function Opts");

    // Also via TypeScriptEmitter directly with pureInterfaces: true
    const directEmitted = TypeScriptEmitter.emit(mod, { pureInterfaces: true, watermark: false });
    expect(directEmitted).toBe(
      `export interface Opts {\n  width?: number;\n  height?: number;\n}\n`,
    );
    expect(directEmitted).not.toContain("export function Opts");
  });

  it("pureInterfaces: true does not emit factory functions for standard types", () => {
    const src = `type Foo:
  width: int
  height: int
`;
    const mod = parse(src, "foo.ts.aice");
    const emitted = emitTarget(mod, "typescript", { pureInterfaces: true, watermark: false });

    expect(emitted).toBe(`export interface Foo {\n  width: number;\n  height: number;\n}\n`);
    expect(emitted).not.toContain("export function Foo");
  });

  it("emits factory functions only when requested via pureInterfaces: false or default", () => {
    const src = `type Foo:
  width: int
  height: int
`;
    const mod = parse(src, "foo.ts.aice");

    const withDefault = emitTarget(mod, "typescript");
    expect(withDefault).toContain("export interface Foo {");
    expect(withDefault).toContain("export function Foo(width: number, height: number): Foo {");

    const withFalse = emitTarget(mod, "typescript", { pureInterfaces: false });
    expect(withFalse).toContain("export interface Foo {");
    expect(withFalse).toContain("export function Foo(width: number, height: number): Foo {");
  });

  it("handles mixed required and optional fields", () => {
    const src = `type UserConfig:
  id: str
  timeout?: int
  retries?: int = 3
`;
    const mod = parse(src, "config.ts.aice");
    const typeDecl = mod.items[0] as TypeDecl;
    expect(typeDecl.fields![0].isOptional).toBeUndefined();
    expect(typeDecl.fields![1].isOptional).toBe(true);
    expect(typeDecl.fields![2].isOptional).toBe(true);

    const emitted = emitTarget(mod, "typescript", { pureInterfaces: true });
    expect(emitted).toContain("id: string;");
    expect(emitted).toContain("timeout?: number;");
    expect(emitted).toContain("retries?: number;");
    expect(emitted).not.toContain("export function UserConfig");
  });
});
