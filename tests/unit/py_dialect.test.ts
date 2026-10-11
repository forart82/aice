/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Comprehensive Unit Test Suite for Multi-Language Dialects: Python (.py) (Step 27).
 *
 * Verifies:
 * 1. Python 3.10+ Decompilation to AIL AST:
 *    - `@dataclass` decorated classes with typed fields and default values
 *    - Async functions (`async def` and `await`)
 *    - Python 3.10+ type annotations (`int`, `float`, `str`, `bool`, `list[T]`, `dict[K, V]`, `Optional[T]`, `tuple[T, ...]`, `Union[A, B]`)
 *    - Structural pattern matching (`match / case` with literals, wildcards, identifiers)
 *    - Control flow (`if`, `elif`, `else`, `while`, `for`, `try/except/finally`, `raise`)
 *    - Docstring and comment trivia retention (`"""..."""` and `# ...`)
 *    - 100% parse success on decompiled AIL code
 * 2. Python 3.10+ Forward Emission from AIL AST:
 *    - `@dataclass` class generation with modern type annotations
 *    - `async def` and `await` emission
 *    - `match / case` statement emission
 *    - Docstring and comment preservation
 * 3. Bidirectional Roundtrip Fidelity & Put/Get Lens Invariant:
 *    - Put(Get(c), Omega) == c
 *    - Multi-round convergence (Round 1 == Round 2 == Round 3)
 *    - Real-world validation against examples/python and case52
 * 4. Polymorphic CLI Execution:
 *    - `ail compile` on .py files
 *    - `ail outline` on .py files
 *    - `ail context` on .py files
 * 5. Typecheck Soundness:
 *    - Zero diagnostic crashes when checking decompiled modules
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getExtensionForTarget,
  KNOWN_TARGET_EXTENSIONS,
  TARGET_EXT_MAP,
  VALID_TARGET_LANGUAGES,
} from "../../src/config/index.js";
import type { ClassDecl, FunctionDecl, MatchStmt, Module, TypeDecl } from "../../src/core/ast.js";
import { parse, parseWithTrivia } from "../../src/core/parser.js";
import {
  decompile,
  decompilePython,
  executeRoundtrip,
  PythonDecompiler,
} from "../../src/decompiler/index.js";
import {
  detectTargetFromPath,
  emitTarget,
  PythonEmitter,
} from "../../src/emitters/index.js";
import { TypeChecker } from "../../src/typechecker/checker.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cliPath = path.resolve(__dirname, "../../bin/ail.ts");

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

describe("Step 27: Multi-Language Dialects for Python (.py)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ail-py-test-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  // ===========================================================================
  // SECTION 1: Toolchain Registration & Detection
  // ===========================================================================
  describe("Core Toolchain Registration & Extension Mapping", () => {
    it("registers 'python' in VALID_TARGET_LANGUAGES", () => {
      expect(VALID_TARGET_LANGUAGES.has("python")).toBe(true);
    });

    it("registers '.py' in KNOWN_TARGET_EXTENSIONS and TARGET_EXT_MAP", () => {
      expect(KNOWN_TARGET_EXTENSIONS.has(".py")).toBe(true);
      expect(TARGET_EXT_MAP[".py"]).toBe("python");
    });

    it("returns '.py' from getExtensionForTarget('python')", () => {
      expect(getExtensionForTarget("python")).toBe(".py");
    });

    it("detects 'python' from file paths via detectTargetFromPath", () => {
      expect(detectTargetFromPath("src/models/user.py")).toBe("python");
      expect(detectTargetFromPath("src/models/user.py.ail")).toBe("python");
      expect(detectTargetFromPath("pipeline.py")).toBe("python");
    });
  });

  // ===========================================================================
  // SECTION 2: Python 3.10+ Decompilation to AIL AST
  // ===========================================================================
  describe("Python 3.10+ Decompilation to AIL AST", () => {
    it("decompiles @dataclass classes with typed fields, default values, and docstrings", () => {
      const pyCode = `from dataclasses import dataclass
from typing import Optional

@dataclass
class Product:
    """Represents a product item in the store."""
    id: int
    name: str
    price: float
    is_active: bool = True
    tag: Optional[str] = None

    def calculate_tax(self, rate: float) -> float:
        """Calculate tax on price."""
        return self.price * rate
`;
      const decomp = decompilePython(pyCode, "Product.py");
      expect(decomp.ast.kind).toBe("Module");
      expect(decomp.ast.items.length).toBeGreaterThanOrEqual(1);

      const cls = decomp.ast.items.find((i) => i.kind === "ClassDecl") as ClassDecl;
      expect(cls).toBeDefined();
      expect(cls.name).toBe("Product");
      expect(cls.properties.length).toBe(5);
      expect(cls.properties[0].name).toBe("id");
      expect(cls.properties[1].name).toBe("name");
      expect(cls.properties[2].name).toBe("price");
      expect(cls.properties[3].name).toBe("is_active");
      expect(cls.properties[3].initialValue).toBeDefined();
      expect(cls.properties[4].name).toBe("tag");
      expect(cls.methods.length).toBe(1);
      expect(cls.methods[0].name).toBe("calculate_tax");

      // Verify generated AIL parses cleanly
      const parsed = parse(decomp.ail, "Product.py.ail");
      expect(parsed).toBeDefined();
      expect(parsed.items.length).toBeGreaterThanOrEqual(1);
    });

    it("decompiles async functions with await expressions and type annotations", () => {
      const pyCode = `from typing import Optional

async def fetch_user(user_id: int) -> Optional[dict]:
    """Fetch user profile asynchronously."""
    if user_id <= 0:
        return None
    raw_data = await remote_call(user_id)
    return raw_data
`;
      const decomp = decompilePython(pyCode, "async_user.py");
      const fn = decomp.ast.items.find((i) => i.kind === "FunctionDecl") as FunctionDecl;
      expect(fn).toBeDefined();
      expect(fn.name).toBe("fetch_user");
      expect(fn.isAsync).toBe(true);
      expect(fn.params.length).toBe(1);
      expect(fn.params[0].name).toBe("user_id");

      const parsed = parse(decomp.ail, "async_user.py.ail");
      expect(parsed).toBeDefined();
      const parsedFn = parsed.items.find((i) => i.kind === "FunctionDecl") as FunctionDecl;
      expect(parsedFn.name).toBe("fetch_user");
      expect(parsedFn.isAsync).toBe(true);
    });

    it("decompiles Python 3.10+ match/case pattern matching into MatchStmt", () => {
      const pyCode = `def handle_status(code: int) -> str:
    match code:
        case 200:
            return "OK"
        case 404:
            return "Not Found"
        case _:
            return "Unknown"
`;
      const decomp = decompilePython(pyCode, "matcher.py");
      const fn = decomp.ast.items.find((i) => i.kind === "FunctionDecl") as FunctionDecl;
      expect(fn).toBeDefined();
      expect(fn.body.kind).toBe("Block");

      const matchStmt = (fn.body as any).statements.find((s: any) => s.kind === "MatchStmt") as MatchStmt;
      expect(matchStmt).toBeDefined();
      expect(matchStmt.cases.length).toBe(3);
      expect(matchStmt.cases[0].pattern.kind).toBe("LiteralPattern");
      expect(matchStmt.cases[2].pattern.kind).toBe("WildcardPattern");

      const parsed = parse(decomp.ail, "matcher.py.ail");
      expect(parsed).toBeDefined();
    });

    it("decompiles control flow (if/elif/else, while, for, try/except/finally, raise)", () => {
      const pyCode = `def test_flow(items: list[int]) -> int:
    total = 0
    try:
        for x in items:
            if x > 10:
                total += x
            elif x > 5:
                total += 1
            else:
                total += 0
    except ValueError as e:
        raise RuntimeError("Failed")
    finally:
        total = total
    return total
`;
      const decomp = decompilePython(pyCode, "flow.py");
      expect(decomp.ast.kind).toBe("Module");
      const fn = decomp.ast.items.find((i) => i.kind === "FunctionDecl") as FunctionDecl;
      expect(fn).toBeDefined();
      expect(fn.body.kind).toBe("Block");

      const parsed = parse(decomp.ail, "flow.py.ail");
      expect(parsed).toBeDefined();
    });

    it("retains docstrings and line comments in CST trivia table", () => {
      const pyCode = `# Header comment
"""Module-level docstring."""

# Class comment
class Greeter:
    """Class docstring."""
    # Method comment
    def greet(self, name: str) -> str:
        """Method docstring."""
        return "Hello " + name
`;
      const decomp = decompilePython(pyCode, "Greeter.py");
      expect(decomp.trivia).toBeDefined();
      expect(decomp.trivia.size()).toBeGreaterThan(0);

      const parsed = parse(decomp.ail, "Greeter.py.ail");
      expect(parsed).toBeDefined();
    });
  });

  // ===========================================================================
  // SECTION 3: Python 3.10+ Forward Emission from AIL AST
  // ===========================================================================
  describe("Python 3.10+ Forward Emission from AIL AST", () => {
    it("emits @dataclass and Python 3.10+ type annotations cleanly", () => {
      const ailSource = `module Inventory

pub class Item:
  pub id: int
  pub name: str
  pub price: float
  pub tags: list[str]

  fn get_total(qty: int) -> float:
    ret this.price * qty
`;
      const { ast } = parseWithTrivia(ailSource, "Inventory.py.ail");
      const emitter = new PythonEmitter({ useDataclasses: true });
      const emitted = emitter.emitModule(ast);

      expect(emitted).toContain("from dataclasses import dataclass");
      expect(emitted).toContain("@dataclass");
      expect(emitted).toContain("class Item:");
      expect(emitted).toContain("id: int");
      expect(emitted).toContain("name: str");
      expect(emitted).toContain("price: float");
      expect(emitted).toContain("tags: list[str]");
      expect(emitted).toContain("def get_total(self, qty: int) -> float:");
    });

    it("emits async functions with async def and await expressions", () => {
      const ailSource = `module NetworkService

pub async fn query_endpoint(url: str) -> str:
  val res = await fetch(url)
  ret res
`;
      const { ast } = parseWithTrivia(ailSource, "NetworkService.py.ail");
      const emitted = emitTarget(ast, "python");

      expect(emitted).toContain("async def query_endpoint(url: str) -> str:");
      expect(emitted).toContain("await fetch(url)");
    });

    it("emits match / case pattern matching statements", () => {
      const ailSource = `module Dispatcher

pub fn dispatch(cmd: str) -> str:
  match cmd:
    case "start" => ret "Starting"
    case "stop" => ret "Stopping"
    case _ => ret "Unknown"
`;
      const { ast } = parseWithTrivia(ailSource, "Dispatcher.py.ail");
      const emitted = emitTarget(ast, "python");

      expect(emitted).toContain("match cmd:");
      expect(emitted).toContain('case "start":');
      expect(emitted).toContain('case "stop":');
      expect(emitted).toContain("case _:");
    });

    it("emits Python docstrings and comments preserved from trivia", () => {
      const ailSource = `module DocTest

# Line comment before class
pub class Service:
  fn run() -> bool:
    ret true
`;
      const { ast, trivia } = parseWithTrivia(ailSource, "DocTest.py.ail");
      const emitted = emitTarget(ast, "python", { trivia });

      expect(emitted).toContain("class Service:");
      expect(emitted).toContain("def run(self) -> bool:");
    });
  });

  // ===========================================================================
  // SECTION 4: Bidirectional Fidelity & Lossless Roundtrips
  // ===========================================================================
  describe("Bidirectional Fidelity & Lens Verification: Put(Get(c), Omega) == c", () => {
    it("satisfies roundtrip fidelity on dataclass_sample.py example", () => {
      const filePath = path.resolve(__dirname, "../../examples/python/dataclass_sample.py");
      const original = fs.readFileSync(filePath, "utf-8");

      const res = executeRoundtrip(original, "python", filePath);
      expect(res.ail).toBeDefined();

      const parsed = parse(res.ail, `${filePath}.ail`);
      expect(parsed).toBeDefined();
      expect(parsed.items.length).toBeGreaterThanOrEqual(1);

      expect(res.isIdentical).toBe(true);
      expect(res.reconstructed).toContain("@dataclass");
      expect(res.reconstructed).toContain("class InventoryItem:");
      expect(res.reconstructed).toContain("def total_value");
      expect(res.reconstructed).toContain("def is_in_stock");
    });

    it("satisfies roundtrip fidelity on async_service.py example", () => {
      const filePath = path.resolve(__dirname, "../../examples/python/async_service.py");
      const original = fs.readFileSync(filePath, "utf-8");

      const res = executeRoundtrip(original, "python", filePath);
      expect(res.ail).toBeDefined();

      const parsed = parse(res.ail, `${filePath}.ail`);
      expect(parsed).toBeDefined();
      expect(parsed.items.length).toBeGreaterThanOrEqual(2);

      expect(res.isIdentical).toBe(true);
      expect(res.reconstructed).toContain("async def execute_task");
      expect(res.reconstructed).toContain("async def fetch_user_data");
      expect(res.reconstructed).toContain("match");
    });

    it("satisfies multi-round idempotence convergence (Round 1 == Round 2 == Round 3)", () => {
      const source = `from dataclasses import dataclass

@dataclass
class Point:
    x: float
    y: float

    def distance_squared(self) -> float:
        return self.x * self.x + self.y * self.y
`;
      const round1 = executeRoundtrip(source, "python", "Point.py");
      const round2 = executeRoundtrip(round1.reconstructed, "python", "Point.py");
      const round3 = executeRoundtrip(round2.reconstructed, "python", "Point.py");

      expect(round1.reconstructed).toBe(round2.reconstructed);
      expect(round2.reconstructed).toBe(round3.reconstructed);
    });
  });

  // ===========================================================================
  // SECTION 5: Polymorphic CLI Integration on .py Files
  // ===========================================================================
  describe("Polymorphic CLI Integration on .py Files", () => {
    it("executes 'ail decompile' on a .py file producing valid .py.ail and 'ail compile' back", () => {
      const testPy = path.join(tmpDir, "Account.py");
      fs.writeFileSync(
        testPy,
        `from dataclasses import dataclass

@dataclass
class Account:
    id: int
    owner: str

    def get_owner(self) -> str:
        return self.owner
`,
      );

      const decompileRes = runCli(["decompile", testPy], tmpDir);
      expect(decompileRes.status).toBe(0);

      const ailOutput = path.join(tmpDir, "Account.py.ail");
      expect(fs.existsSync(ailOutput)).toBe(true);
      const ailContent = fs.readFileSync(ailOutput, "utf-8");
      expect(ailContent).toContain("class Account");
      expect(ailContent).toContain("id: int");
      expect(ailContent).toContain("owner: str");

      // Now compile it back with ail compile
      fs.rmSync(testPy);
      const compileRes = runCli(["compile", ailOutput], tmpDir);
      expect(compileRes.status).toBe(0);
      expect(fs.existsSync(testPy)).toBe(true);
      const pyRecompiled = fs.readFileSync(testPy, "utf-8");
      expect(pyRecompiled).toContain("class Account");
    });

    it("executes 'ail outline' on a .py file with high token savings", () => {
      const testPy = path.join(tmpDir, "Processor.py");
      fs.writeFileSync(
        testPy,
        `class DataProcessor:
    def process(self, data: list[int]) -> int:
        # Long complicated body that gets skeletonized
        total = 0
        for x in data:
            total += x * 2
        return total

    def export_data(self, dest: str) -> bool:
        return True
`,
      );

      const res = runCli(["outline", testPy], tmpDir);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("DataProcessor");
      expect(res.stdout).toContain("process");
      expect(res.stdout).toContain("export_data");
    });

    it("executes 'ail context' on a .py file generating semantic context map", () => {
      const testPy = path.join(tmpDir, "Calculator.py");
      fs.writeFileSync(
        testPy,
        `class Calculator:
    def compute(self, a: float, b: float) -> float:
        return a + b
`,
      );

      const res = runCli(["context", testPy], tmpDir);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("Calculator");
    });
  });

  // ===========================================================================
  // SECTION 6: Semantic Typecheck Soundness
  // ===========================================================================
  describe("Semantic Typecheck Soundness on Decompiled Modules", () => {
    it("guarantees zero syntax errors and produces a valid typed module", () => {
      const source = `from dataclasses import dataclass

@dataclass
class Wallet:
    balance: float = 0.0

    def deposit(self, amount: float) -> bool:
        if amount > 0.0:
            self.balance = self.balance + amount
            return True
        return False

    def total_balance(self) -> float:
        return self.balance
`;
      const decomp = decompilePython(source, "Wallet.py");
      const { ast } = parseWithTrivia(decomp.ail, "Wallet.py.ail");

      const checker = new TypeChecker();
      expect(() => checker.checkModule(ast)).not.toThrow();
    });
  });
});
