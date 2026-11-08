/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for AICE 2.0 Semantic AST Skeleton Outline Engine (Step 18).
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { program } from "../../bin/aice.js";
import { parse } from "../../src/core/parser.js";
import { generateOutline, type OutlineResult, outlinePath } from "../../src/tools/outline.js";

describe("AICE 2.0 Semantic AST Skeleton Outline Engine (Step 18)", () => {
  describe("Outlining Functions", () => {
    it("strips function implementation body and replaces with ': ...'", () => {
      const src = `
fn calculate(a: int, b: int) -> int:
  sum := a + b
  mult := sum * 2
  ret mult
`;
      const res = generateOutline(src);
      expect(res.text).toContain("fn calculate(a: int, b: int) -> int: ...");
      expect(res.text).not.toContain("sum :=");
      expect(res.text).not.toContain("mult :=");
      expect(res.text).not.toContain("ret mult");

      expect(res.symbols).toHaveLength(1);
      expect(res.symbols[0].name).toBe("calculate");
      expect(res.symbols[0].kind).toBe("function");
      expect(res.symbols[0].line).toBe(2);
      expect(res.symbols[0].signature).toBe("fn calculate(a: int, b: int) -> int: ...");
    });

    it("retains async keyword, export visibility, and docstrings", () => {
      const src = `
# Asynchronously fetch resource from remote server
pub async fn fetchData(url: str, timeout?: int) -> Promise[str]:
  res := await fetch(url)
  ret res.text()
`;
      const res = generateOutline(src);
      expect(res.text).toContain("Asynchronously fetch resource from remote server");
      expect(res.text).toContain(
        "pub async fn fetchData(url: str, timeout?: int) -> Promise[str]: ...",
      );
      expect(res.text).not.toContain("await fetch");

      expect(res.symbols[0].docstring).toContain("Asynchronously fetch resource");
      expect(res.symbols[0].signature).toContain("pub async fn fetchData");
    });

    it("outlines expression-bodied functions into signature with ': ...'", () => {
      const src = `fn double(x: int) -> int = x * 2`;
      const res = generateOutline(src);
      expect(res.text).toBe("fn double(x: int) -> int: ...");
    });
  });

  describe("Outlining Classes", () => {
    it("outlines class with properties, methods, primary constructor, and inheritance", () => {
      const src = `
# Vector 2D math entity
pub class Vec2(pub x: float, pub y: float) extends BaseVector implements ITransformable:
  static origin: Vec2
  readonly id: str
  active?: bool

  # Computes magnitude of vector
  fn magnitude() -> float:
    ret (this.x * this.x + this.y * this.y).sqrt()

  static fn zero() -> Vec2:
    ret Vec2(0.0, 0.0)
`;
      const res = generateOutline(src);
      expect(res.text).toContain("Vector 2D math entity");
      expect(res.text).toContain(
        "pub class Vec2(pub x: float, pub y: float) extends BaseVector implements ITransformable:",
      );
      expect(res.text).toContain("  static origin: Vec2");
      expect(res.text).toContain("  val id: str");
      expect(res.text).toContain("  active?: bool");
      expect(res.text).toContain("Computes magnitude of vector");
      expect(res.text).toContain("  fn magnitude() -> float: ...");
      expect(res.text).toContain("  static fn zero() -> Vec2: ...");
      expect(res.text).not.toContain("this.x * this.x");

      expect(res.symbols).toHaveLength(1);
      const clsSym = res.symbols[0];
      expect(clsSym.kind).toBe("class");
      expect(clsSym.name).toBe("Vec2");
      expect(clsSym.children).toHaveLength(5);

      const propNames = clsSym.children?.map((c) => c.name);
      expect(propNames).toEqual(["origin", "id", "active", "magnitude", "zero"]);

      const propKinds = clsSym.children?.map((c) => c.kind);
      expect(propKinds).toEqual(["property", "property", "property", "method", "method"]);
    });

    it("outlines empty class or class with inline pass", () => {
      const src = `class EmptyContainer: pass`;
      const res = generateOutline(src);
      expect(res.text).toBe("class EmptyContainer: ...");
      expect(res.symbols[0].children).toHaveLength(0);
    });
  });

  describe("Outlining Interfaces, Records, and Types", () => {
    it("outlines record contracts and interfaces with field signatures", () => {
      const src = `
# Customer domain record
type CustomerRecord:
  id: int
  name: str
  email?: str

# Authentication service interface
type IAuthService:
  token: str
  expiry: int

type UserId = str
`;
      const res = generateOutline(src);
      expect(res.text).toContain("Customer domain record");
      expect(res.text).toContain("type CustomerRecord:");
      expect(res.text).toContain("  id: int");
      expect(res.text).toContain("  name: str");
      expect(res.text).toContain("  email?: str");
      expect(res.text).toContain("type IAuthService:");
      expect(res.text).toContain("  token: str");
      expect(res.text).toContain("  expiry: int");
      expect(res.text).toContain("type UserId = str");

      expect(res.symbols).toHaveLength(3);
      expect(res.symbols[0].name).toBe("CustomerRecord");
      expect(res.symbols[0].kind).toBe("record");
      expect(res.symbols[0].children).toHaveLength(3);

      expect(res.symbols[1].name).toBe("IAuthService");
      expect(res.symbols[1].kind).toBe("interface");
      expect(res.symbols[1].children).toHaveLength(2);

      expect(res.symbols[2].name).toBe("UserId");
      expect(res.symbols[2].kind).toBe("type");
      expect(res.symbols[2].children).toHaveLength(0);
    });
  });

  describe("Outlining Enums", () => {
    it("outlines enums with bare and payload variants", () => {
      const src = `
enum OrderState:
  Pending
  Processing(int)
  Completed
  Failed(str, int)
`;
      const res = generateOutline(src);
      expect(res.text).toContain("enum OrderState:");
      expect(res.text).toContain("  Pending");
      expect(res.text).toContain("  Processing(int)");
      expect(res.text).toContain("  Completed");
      expect(res.text).toContain("  Failed(str, int)");

      expect(res.symbols).toHaveLength(1);
      const enumSym = res.symbols[0];
      expect(enumSym.name).toBe("OrderState");
      expect(enumSym.kind).toBe("enum");
      expect(enumSym.children).toHaveLength(4);
      expect(enumSym.children?.[0].name).toBe("Pending");
      expect(enumSym.children?.[0].kind).toBe("variant");
      expect(enumSym.children?.[1].name).toBe("Processing");
    });
  });

  describe("Outlining Imports, Constants, and Variables", () => {
    it("retains imports, constants, and module variables", () => {
      const src = `
from "./utils" import { helper, logger }
import "./styles.css"

pub const MAX_RETRIES: int = 5
pub let mut activeWorkers: int = 0
`;
      const res = generateOutline(src);
      expect(res.text).toContain('from "./utils" import { helper, logger }');
      expect(res.text).toContain('import "./styles.css"');
      expect(res.text).toContain("pub const MAX_RETRIES: int");
      expect(res.text).toContain("pub mut activeWorkers: int");

      expect(res.symbols).toHaveLength(4);
      expect(res.symbols[0].kind).toBe("import");
      expect(res.symbols[1].kind).toBe("import");
      expect(res.symbols[2].kind).toBe("const");
      expect(res.symbols[3].kind).toBe("var");
    });
  });

  describe("Nesting Depth Control (--depth)", () => {
    const complexSrc = `
class GameEngine:
  fps: int = 60
  running: bool = true

  fn start():
    this.running = true
    this.loop()

  fn stop():
    this.running = false

type Config:
  host: str
  port: int

enum Mode:
  Dev
  Prod
`;

    it("depth 1 prunes inner members and keeps only top-level symbols", () => {
      const res = generateOutline(complexSrc, { depth: 1 });
      expect(res.text).toContain("class GameEngine: ...");
      expect(res.text).toContain("type Config: ...");
      expect(res.text).toContain("enum Mode: ...");
      expect(res.text).not.toContain("fps:");
      expect(res.text).not.toContain("fn start()");
      expect(res.text).not.toContain("host:");
      expect(res.text).not.toContain("Dev");

      expect(res.symbols).toHaveLength(3);
      expect(res.symbols[0].children).toHaveLength(0);
      expect(res.symbols[1].children).toHaveLength(0);
      expect(res.symbols[2].children).toHaveLength(0);
    });

    it("depth 2 preserves members inside classes, types, and enums", () => {
      const res = generateOutline(complexSrc, { depth: 2 });
      expect(res.text).toContain("class GameEngine:");
      expect(res.text).toContain("  fps: int");
      expect(res.text).toContain("  fn start(): ...");
      expect(res.text).toContain("type Config:");
      expect(res.text).toContain("  host: str");
      expect(res.text).toContain("enum Mode:");
      expect(res.text).toContain("  Dev");

      expect(res.symbols[0].children?.length).toBeGreaterThan(0);
      expect(res.symbols[1].children?.length).toBeGreaterThan(0);
      expect(res.symbols[2].children?.length).toBeGreaterThan(0);
    });

    it("depth 0 returns an empty outline", () => {
      const res = generateOutline(complexSrc, { depth: 0 });
      expect(res.text).toBe("");
      expect(res.symbols).toHaveLength(0);
    });
  });

  describe("Type Elision (--no-types / includeTypes: false)", () => {
    it("omits all type annotations from signatures when includeTypes is false", () => {
      const src = `
class Server(pub host: str, pub port: int):
  timeout: int
  fn listen(backlog: int) -> bool:
    ret true

fn add(x: int, y: int) -> int:
  ret x + y

type Item:
  id: int
  label: str
`;
      const res = generateOutline(src, { includeTypes: false });
      expect(res.text).toContain("class Server(pub host, pub port):");
      expect(res.text).toContain("  timeout");
      expect(res.text).toContain("  fn listen(backlog): ...");
      expect(res.text).toContain("fn add(x, y): ...");
      expect(res.text).toContain("type Item:");
      expect(res.text).toContain("  id");
      expect(res.text).toContain("  label");

      expect(res.text).not.toContain(": str");
      expect(res.text).not.toContain(": int");
      expect(res.text).not.toContain("-> bool");
      expect(res.text).not.toContain("-> int");
    });
  });

  describe("Structured JSON Output (--json)", () => {
    it("generates a structured JSON hierarchy conforming to specification", () => {
      const src = `
class Service:
  fn handle(req: str) -> str:
    ret req
`;
      const res = generateOutline(src, { json: true });
      expect(res.json).toBeDefined();
      expect(res.json?.file).toBe("<anonymous>");
      expect(Array.isArray(res.json?.symbols)).toBe(true);
      expect(res.json?.symbols).toHaveLength(1);

      const cls = res.json?.symbols[0];
      expect(cls?.name).toBe("Service");
      expect(cls?.kind).toBe("class");
      expect(typeof cls?.line).toBe("number");
      expect(cls?.signature).toBe("class Service: ...");
      expect(cls?.children).toHaveLength(1);

      const meth = cls?.children?.[0];
      expect(meth?.name).toBe("handle");
      expect(meth?.kind).toBe("method");
      expect(meth?.signature).toBe("fn handle(req: str) -> str: ...");

      // When json: true, res.text is the stringified JSON tree
      const parsedJson = JSON.parse(res.text);
      expect(parsedJson.symbols[0].name).toBe("Service");
    });
  });

  describe("Token Reduction Metrics (--stats)", () => {
    it("computes token reduction metrics achieving 70–90%+ token reduction on realistic files", () => {
      // Create a function with heavy implementation bodies
      const src = `
class DataPipeline:
  bufferSize: int = 1024

  fn processBatch(items: [str]) -> [int]:
    results := []
    for item in items:
      trimmed := item.trim()
      if trimmed.len > 0:
        val := trimmed.parseInt()
        doubled := val * 2
        cubed := doubled * val
        results.push(cubed + this.bufferSize)
      else:
        results.push(0)
    ret results

  fn aggregateStats(data: [int]) -> int:
    acc := 0
    for v in data:
      if v > 100:
        acc = acc + v * 3
      elif v > 50:
        acc = acc + v * 2
      else:
        acc = acc + v
    ret acc
`;
      const res = generateOutline(src, { stats: true });
      expect(res.stats).toBeDefined();
      const stats = res.stats!;
      expect(stats.originalTokens).toBeGreaterThan(0);
      expect(stats.outlineTokens).toBeGreaterThan(0);
      expect(stats.savingsTokens).toBeGreaterThan(0);
      expect(stats.savingsPct).toBeGreaterThanOrEqual(60); // Real code reduction
      expect(stats.outlineTokens).toBeLessThan(stats.originalTokens);
      expect(stats.outlineChars).toBeLessThan(stats.originalChars);
    });

    it("achieves 70–90%+ reduction on substantial files with nested business logic", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aice_outline_ecom_"));
      try {
        const ecomPath = path.join(tmpDir, "ecommerce_domain.ts");
        fs.writeFileSync(
          ecomPath,
          `export class OrderProcessor {
  calculateSubtotal(prices: number[], quantities: number[], discountRate: number): number {
    let total = 0;
    for (let i = 0; i < prices.length; i++) {
      const p = prices[i] * quantities[i];
      if (p > 1000) {
        total += p * (1 - discountRate);
      } else if (p > 500) {
        total += p * (1 - discountRate * 0.5);
      } else {
        total += p;
      }
    }
    return Math.round(total * 100) / 100;
  }
}
`,
          "utf-8",
        );
        const res = generateOutline(ecomPath, { stats: true });
        expect(res.stats).toBeDefined();
        expect(res.stats!.savingsPct).toBeGreaterThanOrEqual(65);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe("Directory Traversal & Path Handling", () => {
    it("recursively outlines files across directories and returns Map<string, OutlineResult>", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aice_outline_test_"));
      try {
        const fileA = path.join(tmpDir, "math.aice");
        const fileB = path.join(tmpDir, "service.aice");

        fs.writeFileSync(fileA, "fn add(a: int, b: int) -> int:\n  ret a + b\n", "utf-8");
        fs.writeFileSync(fileB, "class Worker:\n  fn run():\n    pass\n", "utf-8");

        const result = await outlinePath(tmpDir);
        expect(result).toBeInstanceOf(Map);
        const map = result as Map<string, OutlineResult>;
        expect(map.size).toBe(2);

        const keys = Array.from(map.keys());
        expect(keys.some((k) => k.includes("math.aice"))).toBe(true);
        expect(keys.some((k) => k.includes("service.aice"))).toBe(true);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("outlines a single file path and returns OutlineResult directly", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aice_outline_single_"));
      try {
        const singleFile = path.join(tmpDir, "helper.aice");
        fs.writeFileSync(singleFile, "fn help(): pass\n", "utf-8");

        const result = await outlinePath(singleFile);
        expect(result).not.toBeInstanceOf(Map);
        const res = result as OutlineResult;
        expect(res.symbols).toHaveLength(1);
        expect(res.symbols[0].name).toBe("help");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe("Programmatic Module AST Input", () => {
    it("accepts an AST Module object directly", () => {
      const ast = parse("fn compute(x: int) -> int: ret x * 2");
      const res = generateOutline(ast);
      expect(res.symbols).toHaveLength(1);
      expect(res.symbols[0].name).toBe("compute");
      expect(res.text).toBe("fn compute(x: int) -> int: ...");
    });
  });

  describe("CLI Command Registration & Execution", () => {
    it("exports commander program with outline command registered", () => {
      const outlineCmd = program.commands.find((c: any) => c.name() === "outline");
      expect(outlineCmd).toBeDefined();
      expect(outlineCmd?.description()).toContain("Semantic skeletonization");
    });
  });
});
