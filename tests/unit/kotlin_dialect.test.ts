/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Comprehensive Unit Test Suite for Multi-Language Dialects: Kotlin (.kt, .kts) (Step 28).
 *
 * Verifies:
 * 1. Kotlin Decompilation to AIL AST:
 *    - Package declarations and imports
 *    - Data classes with primary constructors and default arguments
 *    - Standard classes, interfaces, enum classes, and objects
 *    - Functions and suspend fun coroutines
 *    - Single-expression functions
 *    - Kotlin `when` expressions & statements
 *    - Kotlin type system (Int, Long, Float, Double, String, Boolean, List<T>, Map<K, V>, T?, Unit)
 *    - Null-safe operators: ?. (safe call) and ?: (elvis)
 *    - KDoc docstrings (/** ... * /) and comments (//) trivia retention
 *    - 100% parse success on decompiled AIL code
 * 2. Kotlin Forward Emission:
 *    - Canonical idiomatic Kotlin 1.9 / 2.x formatting
 *    - Data classes, interfaces, enum classes
 *    - Coroutines (suspend fun)
 *    - When expressions
 *    - Preserved trivia
 * 3. Bidirectional Roundtrip Fidelity & Put/Get Lens Invariant:
 *    - Put(Get(c), Omega) == c
 *    - Multi-round convergence (Round 1 == Round 2 == Round 3)
 *    - Verification on examples/kotlin and case53
 * 4. Polymorphic CLI Execution:
 *    - `ail compile` on .kt files
 *    - `ail outline` on .kt files
 *    - `ail context` on .kt files
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
import { emptySpan } from "../../src/core/span.js";
import {
  decompile,
  decompileKotlin,
  executeRoundtrip,
  KotlinDecompiler,
} from "../../src/decompiler/index.js";
import {
  detectTargetFromPath,
  emitTarget,
  KotlinEmitter,
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

describe("Step 28: Multi-Language Dialects for Mobile / Android (.kt, .kts)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ail-kt-test-"));
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
    it("recognizes .kt and .kts extensions via detectTargetFromPath", () => {
      expect(detectTargetFromPath("App.kt")).toBe("kotlin");
      expect(detectTargetFromPath("build.gradle.kts")).toBe("kotlin");
      expect(detectTargetFromPath("src/domain/User.kt.ail")).toBe("kotlin");
    });

    it("registers 'kotlin' in VALID_TARGET_LANGUAGES", () => {
      expect(VALID_TARGET_LANGUAGES.has("kotlin")).toBe(true);
    });

    it("registers .kt and .kts in KNOWN_TARGET_EXTENSIONS", () => {
      expect(KNOWN_TARGET_EXTENSIONS.has(".kt")).toBe(true);
      expect(KNOWN_TARGET_EXTENSIONS.has(".kts")).toBe(true);
    });

    it("maps .kt and .kts to 'kotlin' in TARGET_EXT_MAP", () => {
      expect(TARGET_EXT_MAP[".kt"]).toBe("kotlin");
      expect(TARGET_EXT_MAP[".kts"]).toBe("kotlin");
    });

    it("returns .kt for target 'kotlin' in getExtensionForTarget", () => {
      expect(getExtensionForTarget("kotlin")).toBe(".kt");
    });

    it("dispatches emitTarget to KotlinEmitter", () => {
      const mod: Module = {
        kind: "Module",
        path: "Test.kt",
        items: [
          {
            kind: "ConstDecl",
            name: "MAX_RETRIES",
            isExported: true,
            value: {
              kind: "LiteralExpr",
              literalKind: "number",
              value: 3,
              rawValue: "3",
              span: { file: "Test.kt", start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 1, offset: 1 } },
            },
            span: { file: "Test.kt", start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 1, offset: 1 } },
          },
        ],
        span: { file: "Test.kt", start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 1, offset: 1 } },
      };

      const emitted = emitTarget(mod, "kotlin");
      expect(emitted).toContain("val MAX_RETRIES = 3");
    });

    it("dispatches decompile to decompileKotlin", () => {
      const code = `
package com.demo

val STATUS: String = "READY"
`;
      const result = decompile(code, "kotlin", { filePath: "demo.kt" });
      expect(result.ast).toBeDefined();
      expect(result.ail).toContain('STATUS: str = "READY"');
    });
  });

  // ===========================================================================
  // SECTION 2: Kotlin Decompilation to AIL AST
  // ===========================================================================
  describe("Kotlin Decompilation (Kotlin -> AIL)", () => {
    it("decompiles package and import statements", () => {
      const code = `
package com.example.service

import java.util.UUID
import kotlinx.coroutines.flow.Flow
import com.example.model.User as AppUser

val VERSION = "1.0.0"
`;
      const result = decompileKotlin(code, "service.kt");
      expect(result.ast.items.some((i) => i.kind === "ImportDecl")).toBe(true);
      expect(result.trivia.getTrivia("mod:package")).toBeDefined();
      const parsedAst = parse(result.ail, "service.kt.ail");
      expect(parsedAst).toBeDefined();
    });

    it("decompiles data class with primary constructor and default arguments", () => {
      const code = `
package com.example.model

/**
 * User representation entity.
 */
data class User(
    val id: String,
    val name: String,
    val age: Int = 18,
    val isActive: Boolean = true,
    val bio: String? = null
)
`;
      const result = decompileKotlin(code, "User.kt");
      const typeItem = result.ast.items.find((i) => i.kind === "TypeDecl") as TypeDecl | undefined;
      expect(typeItem).toBeDefined();
      expect(typeItem?.name).toBe("User");
      expect(typeItem?.fields?.length).toBe(5);

      const parsedAst = parse(result.ail, "User.kt.ail");
      expect(parsedAst).toBeDefined();
    });

    it("decompiles standard class with methods and primary constructor", () => {
      const code = `
package com.example.calc

class Calculator(val factor: Double = 1.0) {
    fun multiply(x: Double, y: Double): Double {
        return x * y * factor
    }

    fun square(x: Double): Double = x * x
}
`;
      const result = decompileKotlin(code, "Calculator.kt");
      const classItem = result.ast.items.find((i) => i.kind === "ClassDecl") as ClassDecl | undefined;
      expect(classItem).toBeDefined();
      expect(classItem?.name).toBe("Calculator");
      expect(classItem?.methods.length).toBe(2);

      const parsedAst = parse(result.ail, "Calculator.kt.ail");
      expect(parsedAst).toBeDefined();
    });

    it("decompiles interface with suspend fun coroutine declarations", () => {
      const code = `
package com.example.repo

interface UserRepository {
    suspend fun findById(id: String): String?
    suspend fun save(name: String): Boolean
}
`;
      const result = decompileKotlin(code, "UserRepository.kt");
      const iface = result.ast.items.find((i) => i.kind === "ClassDecl") as ClassDecl | undefined;
      expect(iface).toBeDefined();
      expect(iface?.name).toBe("UserRepository");
      expect(iface?.methods.length).toBe(2);
      expect(iface?.methods.every((m) => m.isAsync)).toBe(true);

      const parsedAst = parse(result.ail, "UserRepository.kt.ail");
      expect(parsedAst).toBeDefined();
    });

    it("decompiles enum class into AIL enum TypeDecl", () => {
      const code = `
package com.example.state

enum class OrderStatus {
    PENDING,
    PROCESSING,
    SHIPPED,
    DELIVERED,
    CANCELLED
}
`;
      const result = decompileKotlin(code, "OrderStatus.kt");
      const enumItem = result.ast.items.find((i) => i.kind === "TypeDecl") as TypeDecl | undefined;
      expect(enumItem).toBeDefined();
      expect(enumItem?.isEnum).toBe(true);
      expect(enumItem?.variants?.length).toBe(5);

      const parsedAst = parse(result.ail, "OrderStatus.kt.ail");
      expect(parsedAst).toBeDefined();
    });

    it("decompiles Kotlin when expressions and statements", () => {
      const code = `
package com.example.util

fun evaluateGrade(score: Int): String {
    return when (score) {
        100 -> "PERFECT"
        90 -> "EXCELLENT"
        else -> "GOOD"
    }
}
`;
      const result = decompileKotlin(code, "Grade.kt");
      const fn = result.ast.items.find((i) => i.kind === "FunctionDecl") as FunctionDecl | undefined;
      expect(fn).toBeDefined();

      const parsedAst = parse(result.ail, "Grade.kt.ail");
      expect(parsedAst).toBeDefined();
    });

    it("decompiles elvis operator ?: and safe call ?.", () => {
      const code = `
package com.example.safety

fun getLength(str: String?): Int {
    val length = str?.length ?: 0
    return length
}
`;
      const result = decompileKotlin(code, "Safety.kt");
      const fn = result.ast.items.find((i) => i.kind === "FunctionDecl") as FunctionDecl | undefined;
      expect(fn).toBeDefined();

      const parsedAst = parse(result.ail, "Safety.kt.ail");
      expect(parsedAst).toBeDefined();
      expect(result.ail).toContain("??");
    });

    it("decompiles string templates with expressions", () => {
      const code = `
package com.example.text

fun formatGreeting(name: String, count: Int): String {
    return "Hello $name, you have $count items"
}
`;
      const result = decompileKotlin(code, "Greeting.kt");
      const parsedAst = parse(result.ail, "Greeting.kt.ail");
      expect(parsedAst).toBeDefined();
    });

    it("decompiles control flow: if/else, while, for, try/catch/finally", () => {
      const code = `
package com.example.flow

fun testControl(items: List<String>): Int {
    var count = 0
    for (item in items) {
        count += 1
    }

    while (count > 0) {
        count -= 1
    }

    try {
        if (count == 0) {
            return 1
        } else {
            return 2
        }
    } catch (e: Exception) {
        return -1
    } finally {
        count = 0
    }
}
`;
      const result = decompileKotlin(code, "Flow.kt");
      const parsedAst = parse(result.ail, "Flow.kt.ail");
      expect(parsedAst).toBeDefined();
    });
  });

  // ===========================================================================
  // SECTION 3: Kotlin Forward Emission
  // ===========================================================================
  describe("Kotlin Forward Emission (AIL -> Kotlin)", () => {
    it("emits data class from TypeDecl with fields", () => {
      const mod: Module = {
        kind: "Module",
        path: "User.kt",
        items: [
          {
            kind: "TypeDecl",
            name: "User",
            isEnum: false,
            typeParams: [],
            fields: [
              {
                name: "id",
                typeAnnotation: { kind: "PrimitiveType", primitive: "str", span: emptySpan() },
                span: emptySpan(),
              },
              {
                name: "age",
                typeAnnotation: { kind: "PrimitiveType", primitive: "int", span: emptySpan() },
                defaultValue: { kind: "LiteralExpr", literalKind: "number", value: 18, rawValue: "18", span: emptySpan() },
                span: emptySpan(),
              },
            ],
            span: emptySpan(),
          },
        ],
        span: emptySpan(),
      };

      const emitted = KotlinEmitter.emit(mod);
      expect(emitted).toContain("data class User(");
      expect(emitted).toContain("val id: String");
      expect(emitted).toContain("val age: Int = 18");
    });

    it("emits suspend fun coroutines when isAsync is true", () => {
      const mod: Module = {
        kind: "Module",
        path: "Api.kt",
        items: [
          {
            kind: "FunctionDecl",
            name: "fetchData",
            isExported: true,
            isAsync: true,
            params: [
              {
                name: "url",
                typeAnnotation: { kind: "PrimitiveType", primitive: "str", span: emptySpan() },
                span: emptySpan(),
              },
            ],
            returnType: { kind: "PrimitiveType", primitive: "str", span: emptySpan() },
            body: {
              kind: "Block",
              statements: [
                {
                  kind: "ReturnStmt",
                  value: { kind: "IdentifierExpr", name: "url", span: emptySpan() },
                  span: emptySpan(),
                },
              ],
              span: emptySpan(),
            },
            isExpressionBodied: false,
            span: emptySpan(),
          },
        ],
        span: emptySpan(),
      };

      const emitted = KotlinEmitter.emit(mod);
      expect(emitted).toContain("suspend fun fetchData(url: String): String {");
    });

    it("emits Kotlin when statement from MatchStmt", () => {
      const mod: Module = {
        kind: "Module",
        path: "Test.kt",
        items: [
          {
            kind: "FunctionDecl",
            name: "checkCode",
            isExported: true,
            isAsync: false,
            params: [
              {
                name: "code",
                typeAnnotation: { kind: "PrimitiveType", primitive: "int", span: emptySpan() },
                span: emptySpan(),
              },
            ],
            returnType: { kind: "PrimitiveType", primitive: "str", span: emptySpan() },
            body: {
              kind: "Block",
              statements: [
                {
                  kind: "MatchStmt",
                  target: { kind: "IdentifierExpr", name: "code", span: emptySpan() },
                  cases: [
                    {
                      pattern: {
                        kind: "LiteralPattern",
                        value: { kind: "LiteralExpr", literalKind: "number", value: 200, rawValue: "200", span: emptySpan() },
                        span: emptySpan(),
                      },
                      body: {
                        kind: "Block",
                        statements: [
                          {
                            kind: "ReturnStmt",
                            value: { kind: "LiteralExpr", literalKind: "string", value: "OK", rawValue: '"OK"', span: emptySpan() },
                            span: emptySpan(),
                          },
                        ],
                        span: emptySpan(),
                      },
                      span: emptySpan(),
                    },
                    {
                      pattern: { kind: "WildcardPattern", span: emptySpan() },
                      body: {
                        kind: "Block",
                        statements: [
                          {
                            kind: "ReturnStmt",
                            value: { kind: "LiteralExpr", literalKind: "string", value: "ERROR", rawValue: '"ERROR"', span: emptySpan() },
                            span: emptySpan(),
                          },
                        ],
                        span: emptySpan(),
                      },
                      span: emptySpan(),
                    },
                  ],
                  span: emptySpan(),
                },
              ],
              span: emptySpan(),
            },
            isExpressionBodied: false,
            span: emptySpan(),
          },
        ],
        span: emptySpan(),
      };

      const emitted = KotlinEmitter.emit(mod);
      expect(emitted).toContain("when (code) {");
      expect(emitted).toContain("200 -> return \"OK\"");
      expect(emitted).toContain("else -> return \"ERROR\"");
    });
  });

  // ===========================================================================
  // SECTION 4: Bidirectional Roundtrip Fidelity & Put/Get Lens Invariant
  // ===========================================================================
  describe("Bidirectional Roundtrip Fidelity: Put(Get(c), Omega) == c", () => {
    it("guarantees 100% bit-identical roundtrip for UserEntity.kt", () => {
      const originalPath = path.resolve(__dirname, "../../examples/kotlin/UserEntity.kt");
      const source = fs.readFileSync(originalPath, "utf-8");

      const result = executeRoundtrip(source, "kotlin", originalPath);
      expect(result.isIdentical).toBe(true);
      expect(result.diff).toBeUndefined();

      // Decompiled AIL must be 100% parseable
      const parsedAst = parse(result.ail, `${originalPath}.ail`);
      expect(parsedAst).toBeDefined();
    });

    it("guarantees 100% bit-identical roundtrip for NetworkClient.kt", () => {
      const originalPath = path.resolve(__dirname, "../../examples/kotlin/NetworkClient.kt");
      const source = fs.readFileSync(originalPath, "utf-8");

      const result = executeRoundtrip(source, "kotlin", originalPath);
      expect(result.isIdentical).toBe(true);
      expect(result.diff).toBeUndefined();

      const parsedAst = parse(result.ail, `${originalPath}.ail`);
      expect(parsedAst).toBeDefined();
    });

    it("satisfies multi-round convergence (Round 1 == Round 2 == Round 3)", () => {
      const originalPath = path.resolve(__dirname, "../../examples/kotlin/UserEntity.kt");
      const source = fs.readFileSync(originalPath, "utf-8");

      const round1 = executeRoundtrip(source, "kotlin", originalPath);
      const round2 = executeRoundtrip(round1.reconstructed, "kotlin", originalPath);
      const round3 = executeRoundtrip(round2.reconstructed, "kotlin", originalPath);

      expect(round1.reconstructed).toBe(round2.reconstructed);
      expect(round2.reconstructed).toBe(round3.reconstructed);
    });

    it("verifies roundtrip on case53 ProductEntity.kt", () => {
      const targetPath = "/home/forart/dev/ail_test_case/src/case53/ProductEntity.kt";
      if (!fs.existsSync(targetPath)) return;

      const source = fs.readFileSync(targetPath, "utf-8");
      const result = executeRoundtrip(source, "kotlin", targetPath);

      expect(result.isIdentical).toBe(true);
      const parsedAst = parse(result.ail, `${targetPath}.ail`);
      expect(parsedAst).toBeDefined();
    });

    it("verifies roundtrip on case53 ProductRepository.kt", () => {
      const targetPath = "/home/forart/dev/ail_test_case/src/case53/ProductRepository.kt";
      if (!fs.existsSync(targetPath)) return;

      const source = fs.readFileSync(targetPath, "utf-8");
      const result = executeRoundtrip(source, "kotlin", targetPath);

      expect(result.isIdentical).toBe(true);
      const parsedAst = parse(result.ail, `${targetPath}.ail`);
      expect(parsedAst).toBeDefined();
    });
  });

  // ===========================================================================
  // SECTION 5: Polymorphic CLI Execution
  // ===========================================================================
  describe("Polymorphic CLI Execution on Kotlin Files", () => {
    it("executes 'ail outline' on Kotlin file with semantic token reduction", () => {
      const ktFile = path.resolve(__dirname, "../../examples/kotlin/UserEntity.kt");
      const res = runCli(["outline", ktFile]);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("UserEntity");
    });

    it("executes 'ail context' on Kotlin file", () => {
      const ktFile = path.resolve(__dirname, "../../examples/kotlin/NetworkClient.kt");
      const res = runCli(["context", ktFile]);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("NetworkClient");
    });

    it("executes 'ail compile' on Kotlin file", () => {
      const testKt = path.join(tmpDir, "Sample.kt");
      fs.writeFileSync(
        testKt,
        `
package com.demo

data class Sample(val id: String)
`,
        "utf-8",
      );

      // Decompile side-by-side: generates Sample.kt.ail
      const decompileRes = runCli(["decompile", testKt], tmpDir);
      expect(decompileRes.status).toBe(0);

      const companionAil = `${testKt}.ail`;
      expect(fs.existsSync(companionAil)).toBe(true);

      // Compile companion .ail back to target
      const compRes = runCli(["compile", companionAil], tmpDir);
      expect(compRes.status).toBe(0);
      expect(fs.existsSync(testKt)).toBe(true);
    });
  });

  // ===========================================================================
  // SECTION 6: Soundness & Typecheck Validation
  // ===========================================================================
  describe("Typecheck Soundness on Decompiled Modules", () => {
    it("guarantees zero fatal diagnostics when typechecking decompiled Kotlin module", () => {
      const originalPath = path.resolve(__dirname, "../../examples/kotlin/UserEntity.kt");
      const source = fs.readFileSync(originalPath, "utf-8");

      const decomp = decompileKotlin(source, originalPath);
      const tc = new TypeChecker();
      expect(() => tc.checkModule(decomp.ast)).not.toThrow();
    });
  });
});
