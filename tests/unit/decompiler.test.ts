/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for Multi-Language Decompilers (Phase 2.1).
 */

import { describe, expect, it } from "vitest";
import { parse } from "../../src/core/parser.js";
import { CssDecompiler } from "../../src/decompiler/css-decompiler.js";
import { HtmlDecompiler } from "../../src/decompiler/html-decompiler.js";
import { decompile } from "../../src/decompiler/index.js";
import { TsDecompiler } from "../../src/decompiler/ts-decompiler.js";
import { TypeChecker } from "../../src/typechecker/checker.js";

describe("TypeScript & TSX Decompiler", () => {
  it("decompiles TypeScript interfaces into AIL TypeDecl", () => {
    const tsCode = `
export interface UserProfile {
  id: string;
  name: string;
  age: number;
  isActive: boolean;
}
`;
    const decompiler = new TsDecompiler(tsCode, "user.ts");
    const { ast } = decompiler.decompile();

    expect(ast.items).toHaveLength(1);
    const item = ast.items[0];
    expect(item.kind).toBe("TypeDecl");
    if (item.kind === "TypeDecl") {
      expect(item.name).toBe("UserProfile");
      expect(item.fields).toHaveLength(4);
      expect(item.fields?.[0].name).toBe("id");
      expect(item.fields?.[0].typeAnnotation.kind).toBe("PrimitiveType");
      expect(item.fields?.[2].name).toBe("age");
    }
  });

  it("extracts JSDoc comments into CstTriviaTable", () => {
    const tsCode = `
/**
 * Authentication service contract
 */
export interface AuthToken {
  token: string;
}
`;
    const decompiler = new TsDecompiler(tsCode, "auth.ts");
    const { ast, trivia } = decompiler.decompile();

    expect(ast.items).toHaveLength(1);
    const entry = trivia.getTrivia("type:AuthToken");
    expect(entry).toBeDefined();
    expect(entry?.leading[0].kind).toBe("DOCSTRING");
    expect(entry?.leading[0].content).toContain("Authentication service contract");
  });

  it("decompiles TypeScript functions and control flow", () => {
    const tsCode = `
export function computeTotal(basePrice: number, quantity: number, isVip: boolean): number {
  const subtotal = basePrice * quantity;
  if (isVip) {
    return subtotal * 0.8;
  }
  return subtotal;
}
`;
    const decompiler = new TsDecompiler(tsCode, "pricing.ts");
    const { ast } = decompiler.decompile();

    expect(ast.items).toHaveLength(1);
    const fn = ast.items[0];
    expect(fn.kind).toBe("FunctionDecl");
    if (fn.kind === "FunctionDecl") {
      expect(fn.name).toBe("computeTotal");
      expect(fn.params).toHaveLength(3);
      expect(fn.params[0].name).toBe("basePrice");
      expect(fn.params[2].name).toBe("isVip");
    }
  });

  it("decompiles React TSX components into AIL ComponentDecl", () => {
    const tsxCode = `
export interface CardProps {
  title: string;
  badge: string;
}

export function Card({ title, badge }: CardProps) {
  return (
    <div className="card-container">
      <h2 className="title">{title}</h2>
      <span className="badge">{badge}</span>
    </div>
  );
}
`;
    const result = decompile(tsxCode, "tsx", { filePath: "card.tsx" });
    expect(result.ail).toContain("type CardProps:");
    expect(result.ail).toContain("component Card(title:str, badge:str):");
    expect(result.ail).toContain('div(class: "card-container"):');
    expect(result.ail).toContain('h2(class: "title"): "{title}"');

    // Verify generated AIL parses and typechecks
    const mod = parse(result.ail, "card.tsx.ail");
    const tc = new TypeChecker();
    tc.checkModule(mod);
    expect(mod.items).toHaveLength(2);
  });
});

describe("CSS Decompiler", () => {
  it("decompiles CSS rules and custom properties", () => {
    const cssCode = `
:root {
  --primary-color: #3b82f6;
  margin: 0;
}

.button-primary {
  display: flex;
  color: #fff;
  padding: 12px;
}
`;
    const decompiler = new CssDecompiler(cssCode, "styles.css");
    const { ast } = decompiler.decompile();

    expect(ast.items).toHaveLength(2);
    expect(ast.items[0].kind).toBe("StyleDecl");
    if (ast.items[0].kind === "StyleDecl") {
      expect(ast.items[0].name).toBe(":root");
      expect(ast.items[0].properties).toHaveLength(2);
    }
    if (ast.items[1].kind === "StyleDecl") {
      expect(ast.items[1].name).toBe(".button-primary");
      expect(ast.items[1].properties).toHaveLength(3);
    }
  });
});

describe("HTML5 Decompiler", () => {
  it("decompiles HTML markup into AIL Component layout", () => {
    const htmlCode = `
<div class="hero-section" id="hero">
  <h1>Welcome to AIL</h1>
  <p>Universal Token-Dense Language</p>
</div>
`;
    const decompiler = new HtmlDecompiler(htmlCode, "index.html");
    const { ast } = decompiler.decompile();

    expect(ast.items).toHaveLength(1);
    const comp = ast.items[0];
    expect(comp.kind).toBe("ComponentDecl");
    if (comp.kind === "ComponentDecl") {
      expect(comp.layout).toHaveLength(1);
      const rootDiv = comp.layout[0];
      expect(rootDiv.tag).toBe("div");
      expect(rootDiv.attributes).toHaveLength(2);
      expect(rootDiv.children).toHaveLength(2);
      expect(rootDiv.children[0].tag).toBe("h1");
      expect(rootDiv.children[0].textLiteral).toBe("Welcome to AIL");
    }
  });
});
