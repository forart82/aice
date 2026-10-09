/**
 * Unit tests for Automated Tokenomics CI Quality Gate & Regression Engine.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  auditTokenomics,
  calculateFileTokenomics,
  formatProjectsTerminalTable,
  formatSingleFileSummary,
  formatTokenomicsMarkdownTable,
  formatTokenomicsTerminalTable,
} from "../../src/tokenomics/index.js";

describe("Tokenomics CI Quality Gate & Regression Engine", () => {
  it("calculates accurate tokenomics for code snippets", () => {
    const targetCode = `export interface UserProfile {\n  id: string;\n  name: string;\n  isActive: boolean;\n}`;
    const ailCode = `type UserProfile: id!s, name!s, isActive!b`;

    const res = calculateFileTokenomics(ailCode, targetCode, "user.ts");

    expect(res.targetChars).toBeGreaterThan(res.ailChars);
    expect(res.charSavingsPct).toBeGreaterThan(40);
    expect(res.targetCl100k).toBeGreaterThan(res.ailCl100k);
    expect(res.cl100kSavingsPct).toBeGreaterThan(25);
    expect(res.targetO200k).toBeGreaterThan(res.ailO200k);
    expect(res.o200kSavingsPct).toBeGreaterThan(25);
    expect(res.drift).toBe(false);
  });

  it("audits examples directory with zero drift and positive token savings", () => {
    const report = auditTokenomics("examples", {
      minSavings: 20,
      checkDrift: true,
    });

    expect(report.files.length).toBe(14);
    expect(report.status).toBe("SUCCESS");
    expect(report.driftDetected).toBe(false);
    expect(report.passedThreshold).toBe(true);

    expect(report.aggregate.targetCl100k).toBeGreaterThan(35000);
    expect(report.aggregate.ailCl100k).toBeLessThan(report.aggregate.targetCl100k);
    expect(report.aggregate.cl100kSavingsPct).toBeGreaterThan(20);
    expect(report.aggregate.o200kSavingsPct).toBeGreaterThan(20);
    expect(report.aggregate.charSavingsPct).toBeGreaterThan(25);
  });

  it("fails verification when minSavings threshold is not satisfied", () => {
    const report = auditTokenomics("examples", {
      minSavings: 90, // Unreasonable 90% threshold to test failure trigger
      checkDrift: true,
    });

    expect(report.status).toBe("FAILURE");
    expect(report.passedThreshold).toBe(false);
    expect(report.minSavingsRequired).toBe(90);
  });

  it("formats markdown table with language breakdown and totals", () => {
    const report = auditTokenomics("examples");
    const table = formatTokenomicsMarkdownTable(report);

    expect(table).toContain("| File | Target Lang | Target cl100k |");
    expect(table).toContain("`style.css`");
    expect(table).toContain("`gateway_service.go`");
    expect(table).toContain("`ecommerce_domain.ts`");
    expect(table).toContain("**TOTAL (14 Files)**");
  });

  it("audits a specific single adopted .ts file", () => {
    const report = auditTokenomics("examples/ecommerce_domain.ts", {
      checkDrift: true,
    });

    expect(report.files.length).toBe(1);
    const f = report.files[0];
    expect(f.file).toBe("ecommerce_domain.ts");
    expect(f.targetLang).toBe("TypeScript");
    expect(f.cl100kSavingsPct).toBeGreaterThan(20);
    expect(f.drift).toBe(false);
    expect(report.status).toBe("SUCCESS");
  });

  it("audits a specific single adopted .ail file", () => {
    const report = auditTokenomics("examples/ecommerce_domain.ts.ail", {
      checkDrift: true,
    });

    expect(report.files.length).toBe(1);
    const f = report.files[0];
    expect(f.file).toBe("ecommerce_domain.ts");
    expect(f.targetLang).toBe("TypeScript");
    expect(f.cl100kSavingsPct).toBeGreaterThan(20);
    expect(f.drift).toBe(false);
    expect(report.status).toBe("SUCCESS");
  });

  it("audits an unadopted file on-the-fly in memory", () => {
    const tmpFile = path.join(os.tmpdir(), `test_unadopted_${Date.now()}.ts`);
    const tsCode = `export interface Product {\n  id: string;\n  name: string;\n  price: number;\n  inStock: boolean;\n}\n`;
    fs.writeFileSync(tmpFile, tsCode, "utf-8");

    try {
      const report = auditTokenomics(tmpFile);
      expect(report.files.length).toBe(1);
      const f = report.files[0];
      expect(f.targetLang).toBe("TypeScript");
      expect(f.targetCl100k).toBeGreaterThan(0);
      expect(f.ailCl100k).toBeGreaterThan(0);
      expect(report.status).toBe("SUCCESS");
    } finally {
      if (fs.existsSync(tmpFile)) {
        fs.unlinkSync(tmpFile);
      }
    }
  });

  it("audits a folder with nested subfolders recursively", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ail_subfolders_"));
    const nestedDir = path.join(tmpDir, "level1", "level2");
    fs.mkdirSync(nestedDir, { recursive: true });

    const file1 = path.join(tmpDir, "Root.ts");
    const file2 = path.join(nestedDir, "Nested.ts");

    fs.writeFileSync(file1, "export class Root { public x: number = 10; }\n", "utf-8");
    fs.writeFileSync(file2, "export class Nested { public y: string = 'hello'; }\n", "utf-8");

    try {
      const report = auditTokenomics(tmpDir);
      expect(report.files.length).toBe(2);
      expect(report.aggregate.targetCl100k).toBeGreaterThan(0);
      expect(report.aggregate.ailCl100k).toBeGreaterThan(0);
      expect(report.status).toBe("SUCCESS");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("formats single file summary card with high density metrics", () => {
    const report = auditTokenomics("examples/ecommerce_domain.ts", {
      checkDrift: true,
    });
    const summary = formatSingleFileSummary(report.files[0], { useColor: false });

    expect(summary).toContain("AIL Token Efficiency Audit: ecommerce_domain.ts");
    expect(summary).toContain("Target Language:         TypeScript");
    expect(summary).toContain("Tokens (cl100k_base):");
    expect(summary).toContain("Tokens (o200k_base):");
    expect(summary).toContain("Raw Characters:");
    expect(summary).toContain("Drift Status:            ✔ ZERO DRIFT (Lossless Bit-Identical)");
    expect(summary).toContain("┌─");
    expect(summary).toContain("└─");
  });

  it("renders responsive terminal table across different widths without distortion", () => {
    const report = auditTokenomics("examples");

    // Standard width (80 cols)
    const table80 = formatTokenomicsTerminalTable(report, { width: 80, useColor: false });
    expect(table80).toContain("AIL 2.0 Token Efficiency Audit");
    expect(table80).toContain("TOTAL (14 Files)");
    const lines80 = table80.split("\n");
    // Verify every line has the exact same visible length
    const len80 = lines80[0].length;
    for (const l of lines80) {
      expect(l.length).toBe(len80);
    }

    // Wide width (120 cols)
    const table120 = formatTokenomicsTerminalTable(report, { width: 120, useColor: false });
    expect(table120).toContain("Char Sav");
    const lines120 = table120.split("\n");
    const len120 = lines120[0].length;
    for (const l of lines120) {
      expect(l.length).toBe(len120);
    }

    // Compact width (72 cols)
    const table72 = formatTokenomicsTerminalTable(report, { width: 72, useColor: false });
    const lines72 = table72.split("\n");
    const len72 = lines72[0].length;
    for (const l of lines72) {
      expect(l.length).toBe(len72);
    }
  });

  it("renders responsive projects terminal table", () => {
    const report = auditTokenomics("poc_real_case");
    const table = formatProjectsTerminalTable(report, { width: 90, useColor: false });

    expect(table).toContain("AIL 2.0 Project Tokenomics Summary");
    expect(table).toContain("dogMax");
    expect(table).toContain("snake_pp");
    expect(table).toContain("snake_ts");
    expect(table).toContain("TOTAL (3)");

    const lines = table.split("\n");
    const firstLen = lines[0].length;
    for (const l of lines) {
      expect(l.length).toBe(firstLen);
    }
  });
});
