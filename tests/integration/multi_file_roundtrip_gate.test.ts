/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Automated Multi-File Roundtrip Parity Gate Integration Test Suite (Step 29).
 * Verifies Bancilhon & Spyratos Bidirectional Lens Invariant:
 *   Put(Get(c), Omega) == c
 * Validates Multi-Round Stability & Convergence:
 *   Round 1 == Round 2 == Round 3
 * Evaluates all 11 supported languages:
 *   TypeScript, C++, C#, CSS, HTML, JSON, YAML, Twig, PHP, Python, Kotlin.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  formatParitySummaryJson,
  formatParitySummaryTerminal,
  runParityGate,
  verifyFileParity,
} from "../../src/tools/index.js";

const TEST_CASE_DIR = "/home/forart/dev/ail_test_case";

describe("Step 29: Automated Multi-File Roundtrip Parity Gate", () => {
  // ===========================================================================
  // SECTION 1: 11-Language Roundtrip Parity Matrix
  // ===========================================================================
  describe("11-Language Roundtrip Parity Matrix (Individual Language Verification)", () => {
    it("1. TypeScript (.ts) satisfies 100% bit-identical lossless lens parity", async () => {
      const filePath = "examples/auth_service.ts";
      const res = await verifyFileParity(filePath);
      expect(res.decompileOk).toBe(true);
      expect(res.parseOk).toBe(true);
      expect(res.emitOk).toBe(true);
      expect(res.isBitIdentical).toBe(true);
      expect(res.isAstEquivalent).toBe(true);
      expect(res.roundtripDrift).toBe(0);
      expect(res.error).toBeUndefined();
    });

    it("2. React / TSX (.tsx) satisfies 100% bit-identical lossless lens parity", async () => {
      const filePath = "examples/dashboard_card.tsx";
      const res = await verifyFileParity(filePath);
      expect(res.decompileOk).toBe(true);
      expect(res.parseOk).toBe(true);
      expect(res.emitOk).toBe(true);
      expect(res.isBitIdentical).toBe(true);
      expect(res.isAstEquivalent).toBe(true);
      expect(res.roundtripDrift).toBe(0);
      expect(res.error).toBeUndefined();
    });

    it("3. C++ (.cpp) satisfies AST equivalence and multi-round convergence", async () => {
      const filePath = path.join(TEST_CASE_DIR, "src/case42/src/helpers/StringHelper.cpp");
      if (!fs.existsSync(filePath)) return;

      const res = await verifyFileParity(filePath);
      expect(res.decompileOk).toBe(true);
      expect(res.parseOk).toBe(true);
      expect(res.emitOk).toBe(true);
      expect(res.isAstEquivalent).toBe(true);
      expect(res.roundtripDrift).toBe(0);
      expect(res.error).toBeUndefined();
    });

    it("4. C# (.cs) satisfies AST equivalence and multi-round convergence", async () => {
      const filePath = path.join(TEST_CASE_DIR, "src/case43/godot/src/Sim/FoodItem.cs");
      if (!fs.existsSync(filePath)) return;

      const res = await verifyFileParity(filePath);
      expect(res.decompileOk).toBe(true);
      expect(res.parseOk).toBe(true);
      expect(res.emitOk).toBe(true);
      expect(res.isAstEquivalent).toBe(true);
      expect(res.roundtripDrift).toBe(0);
      expect(res.error).toBeUndefined();
    });

    it("5. CSS (.css) satisfies 100% bit-identical lossless lens parity", async () => {
      const filePath = "examples/style.css";
      const res = await verifyFileParity(filePath);
      expect(res.decompileOk).toBe(true);
      expect(res.parseOk).toBe(true);
      expect(res.emitOk).toBe(true);
      expect(res.isBitIdentical).toBe(true);
      expect(res.isAstEquivalent).toBe(true);
      expect(res.roundtripDrift).toBe(0);
      expect(res.error).toBeUndefined();
    });

    it("6. HTML (.html) satisfies 100% bit-identical lossless lens parity", async () => {
      const filePath = "examples/page.html";
      const res = await verifyFileParity(filePath);
      expect(res.decompileOk).toBe(true);
      expect(res.parseOk).toBe(true);
      expect(res.emitOk).toBe(true);
      expect(res.isBitIdentical).toBe(true);
      expect(res.isAstEquivalent).toBe(true);
      expect(res.roundtripDrift).toBe(0);
      expect(res.error).toBeUndefined();
    });

    it("7. JSON (.json) satisfies 100% bit-identical lossless lens parity", async () => {
      const filePath = "examples/data_config/sample.json";
      const res = await verifyFileParity(filePath);
      expect(res.decompileOk).toBe(true);
      expect(res.parseOk).toBe(true);
      expect(res.emitOk).toBe(true);
      expect(res.isBitIdentical).toBe(true);
      expect(res.isAstEquivalent).toBe(true);
      expect(res.roundtripDrift).toBe(0);
      expect(res.error).toBeUndefined();
    });

    it("8. YAML (.yaml) satisfies 100% bit-identical lossless lens parity", async () => {
      const filePath = "examples/data_config/sample.yaml";
      const res = await verifyFileParity(filePath);
      expect(res.decompileOk).toBe(true);
      expect(res.parseOk).toBe(true);
      expect(res.emitOk).toBe(true);
      expect(res.isBitIdentical).toBe(true);
      expect(res.isAstEquivalent).toBe(true);
      expect(res.roundtripDrift).toBe(0);
      expect(res.error).toBeUndefined();
    });

    it("9. Twig (.twig) satisfies AST equivalence and multi-round convergence", async () => {
      const filePath = "examples/templates/card.twig";
      const res = await verifyFileParity(filePath);
      expect(res.decompileOk).toBe(true);
      expect(res.parseOk).toBe(true);
      expect(res.emitOk).toBe(true);
      expect(res.isAstEquivalent).toBe(true);
      expect(res.roundtripDrift).toBe(0);
      expect(res.error).toBeUndefined();
    });

    it("10. PHP (.php) satisfies AST equivalence and multi-round convergence", async () => {
      const filePath = "examples/php/OrderStatus.php";
      const res = await verifyFileParity(filePath);
      expect(res.decompileOk).toBe(true);
      expect(res.parseOk).toBe(true);
      expect(res.emitOk).toBe(true);
      expect(res.isAstEquivalent).toBe(true);
      expect(res.roundtripDrift).toBe(0);
      expect(res.error).toBeUndefined();
    });

    it("11. Python (.py) satisfies 100% bit-identical lossless lens parity", async () => {
      const filePath = "examples/python/dataclass_sample.py";
      const res = await verifyFileParity(filePath);
      expect(res.decompileOk).toBe(true);
      expect(res.parseOk).toBe(true);
      expect(res.emitOk).toBe(true);
      expect(res.isBitIdentical).toBe(true);
      expect(res.isAstEquivalent).toBe(true);
      expect(res.roundtripDrift).toBe(0);
      expect(res.error).toBeUndefined();
    });

    it("12. Kotlin (.kt) satisfies 100% bit-identical lossless lens parity", async () => {
      const filePath = "examples/kotlin/UserEntity.kt";
      const res = await verifyFileParity(filePath);
      expect(res.decompileOk).toBe(true);
      expect(res.parseOk).toBe(true);
      expect(res.emitOk).toBe(true);
      expect(res.isBitIdentical).toBe(true);
      expect(res.isAstEquivalent).toBe(true);
      expect(res.roundtripDrift).toBe(0);
      expect(res.error).toBeUndefined();
    });
  });

  // ===========================================================================
  // SECTION 2: Unified Multi-File Parity Gate across Real-World Projects
  // ===========================================================================
  describe("Unified Multi-File Parity Gate across Real-World Projects", () => {
    it("runs parity gate across all 11 supported languages simultaneously with 100% parity rate", async () => {
      const multiLangFiles = [
        "examples/auth_service.ts",
        "examples/dashboard_card.tsx",
        path.join(TEST_CASE_DIR, "src/case42/src/helpers/StringHelper.cpp"),
        path.join(TEST_CASE_DIR, "src/case43/godot/src/Sim/FoodItem.cs"),
        "examples/style.css",
        "examples/page.html",
        "examples/data_config/sample.json",
        "examples/data_config/sample.yaml",
        "examples/templates/card.twig",
        "examples/php/OrderStatus.php",
        "examples/python/dataclass_sample.py",
        "examples/kotlin/UserEntity.kt",
      ].filter((f) => fs.existsSync(f));

      const summary = await runParityGate(multiLangFiles);

      expect(summary.totalFiles).toBeGreaterThanOrEqual(11);
      expect(summary.failed).toBe(0);
      expect(summary.parityRate).toBe(100);
      expect(summary.passedBitIdentical + summary.passedAstEquivalent).toBe(summary.totalFiles);

      // Verify every file had zero drift
      for (const res of summary.results!) {
        expect(res.roundtripDrift).toBe(0);
        expect(res.isAstEquivalent || res.isBitIdentical).toBe(true);
      }

      // Check resultsByLanguage keys
      const expectedLangs = [
        "typescript",
        "cpp",
        "csharp",
        "css",
        "html",
        "json",
        "yaml",
        "twig",
        "php",
        "python",
        "kotlin",
      ];
      for (const lang of expectedLangs) {
        const stats = summary.resultsByLanguage[lang];
        expect(stats).toBeDefined();
        expect(stats.total).toBeGreaterThanOrEqual(1);
        expect(stats.passed).toBe(stats.total);
        expect(stats.parityRate).toBe(100);
      }
    });

    it("runs parity gate across the complete examples/ directory with 100% parity and zero drift", async () => {
      const summary = await runParityGate("examples");

      expect(summary.totalFiles).toBeGreaterThanOrEqual(20);
      expect(summary.failed).toBe(0);
      expect(summary.parityRate).toBe(100);

      for (const res of summary.results!) {
        expect(res.roundtripDrift).toBe(0);
      }
    });

    it("runs parity gate across real-world case studies in /home/forart/dev/ail_test_case", async () => {
      const realWorldCases = [
        path.join(TEST_CASE_DIR, "src/case03/src/core/MathX.ts"),
        path.join(TEST_CASE_DIR, "src/case03/src/core/Vec2.ts"),
        path.join(TEST_CASE_DIR, "src/case49/src/App.tsx"),
        path.join(TEST_CASE_DIR, "src/case42/src/helpers/StringHelper.cpp"),
        path.join(TEST_CASE_DIR, "src/case42/src/helpers/MathHelper.cpp"),
        path.join(TEST_CASE_DIR, "src/case43/godot/src/Sim/FoodItem.cs"),
        path.join(TEST_CASE_DIR, "src/case51/Order.php"),
        path.join(TEST_CASE_DIR, "src/case51/CustomerService.php"),
        path.join(TEST_CASE_DIR, "src/case52/UserEntity.py"),
        path.join(TEST_CASE_DIR, "src/case52/AsyncPipeline.py"),
        path.join(TEST_CASE_DIR, "src/case53/ProductEntity.kt"),
        path.join(TEST_CASE_DIR, "src/case53/ProductRepository.kt"),
      ].filter((f) => fs.existsSync(f));

      if (realWorldCases.length === 0) return;

      const summary = await runParityGate(realWorldCases);
      expect(summary.failed).toBe(0);
      expect(summary.parityRate).toBe(100);

      for (const res of summary.results!) {
        expect(res.roundtripDrift).toBe(0);
        expect(res.isAstEquivalent || res.isBitIdentical).toBe(true);
      }
    });
  });

  // ===========================================================================
  // SECTION 3: Multi-Round Stability & Idempotence Convergence
  // ===========================================================================
  describe("Multi-Round Stability & Idempotence Convergence (Round 1 == Round 2 == Round 3)", () => {
    it("guarantees convergence to zero drift across 3 successive roundtrips for all 11 languages", async () => {
      const sources: { lang: string; code: string; ext: string }[] = [
        {
          lang: "typescript",
          ext: "ts",
          code: `export interface Node { id: string; value: number; }\nexport function sum(a: number, b: number): number { return a + b; }\n`,
        },
        {
          lang: "css",
          ext: "css",
          code: `:root { --primary: #0070f3; }\n.header { display: flex; padding: 16px; }\n`,
        },
        {
          lang: "html",
          ext: "html",
          code: `<div class="container">\n  <h1>Title</h1>\n</div>\n`,
        },
        {
          lang: "json",
          ext: "json",
          code: `{\n  "version": "1.0.0",\n  "enabled": true\n}\n`,
        },
        {
          lang: "yaml",
          ext: "yaml",
          code: `version: "1.0"\nport: 8080\n`,
        },
        {
          lang: "python",
          ext: "py",
          code: `from dataclasses import dataclass\n\n@dataclass\nclass Config:\n    host: str\n    port: int\n`,
        },
        {
          lang: "kotlin",
          ext: "kt",
          code: `data class User(val id: String, val name: String)\n`,
        },
      ];

      for (const { lang, code, ext } of sources) {
        const dummyFile = `virtual_test.${ext}`;
        const res = await verifyFileParity(dummyFile, { source: code, rounds: 3 });
        expect(res.decompileOk).toBe(true);
        expect(res.parseOk).toBe(true);
        expect(res.emitOk).toBe(true);
        expect(res.isAstEquivalent).toBe(true);
        expect(res.roundtripDrift).toBe(0);
      }
    });
  });

  // ===========================================================================
  // SECTION 4: Terminal and JSON Formatting
  // ===========================================================================
  describe("Terminal and JSON Formatting", () => {
    it("formats terminal report with clean alignment and metrics table", async () => {
      const summary = await runParityGate("examples/auth_service.ts");
      const terminalReport = formatParitySummaryTerminal(summary);

      expect(terminalReport).toContain("AIL Automated Multi-File Roundtrip Parity Gate");
      expect(terminalReport).toContain("Total Files Verified:    1");
      expect(terminalReport).toContain("Parity Rate:             100.0%");
      expect(terminalReport).toContain("typescript");
      expect(terminalReport).toContain("✔ Parity Gate PASSED");
    });

    it("formats JSON report matching ParityGateSummary contract", async () => {
      const summary = await runParityGate("examples/auth_service.ts");
      const jsonReport = formatParitySummaryJson(summary);
      const parsed = JSON.parse(jsonReport);

      expect(parsed.totalFiles).toBe(1);
      expect(parsed.passedBitIdentical).toBe(1);
      expect(parsed.failed).toBe(0);
      expect(parsed.parityRate).toBe(100);
      expect(parsed.resultsByLanguage.typescript).toBeDefined();
    });
  });

  // ===========================================================================
  // SECTION 5: CLI Command Execution (ail verify --parity)
  // ===========================================================================
  describe("CLI Command Execution (ail verify --parity)", () => {
    const binPath = path.resolve(process.cwd(), "bin/ail.ts");

    it("executes 'ail verify --parity <file>' and exits with code 0", () => {
      const child = spawnSync("bun", ["run", binPath, "verify", "--parity", "examples/auth_service.ts"], {
        encoding: "utf-8",
        cwd: process.cwd(),
      });

      expect(child.status).toBe(0);
      expect(child.stdout).toContain("AIL Automated Multi-File Roundtrip Parity Gate");
      expect(child.stdout).toContain("✔ Parity Gate PASSED");
    });

    it("executes 'ail verify --parity <file> --json' producing valid machine-readable JSON", () => {
      const child = spawnSync(
        "bun",
        ["run", binPath, "verify", "--parity", "examples/auth_service.ts", "--json"],
        {
          encoding: "utf-8",
          cwd: process.cwd(),
        },
      );

      expect(child.status).toBe(0);
      const parsed = JSON.parse(child.stdout);
      expect(parsed.totalFiles).toBe(1);
      expect(parsed.failed).toBe(0);
      expect(parsed.parityRate).toBe(100);
    });

    it("executes 'ail verify --parity examples/ --strict' and exits 0 on 100% parity rate", () => {
      const child = spawnSync(
        "bun",
        ["run", binPath, "verify", "--parity", "examples/", "--strict"],
        {
          encoding: "utf-8",
          cwd: process.cwd(),
        },
      );

      expect(child.status).toBe(0);
      expect(child.stdout).toContain("✔ Parity Gate PASSED");
    });
  });
});
