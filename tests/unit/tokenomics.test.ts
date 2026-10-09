/**
 * Unit tests for Automated Tokenomics CI Quality Gate & Regression Engine.
 */

import { describe, expect, it } from "vitest";
import {
  auditTokenomics,
  calculateFileTokenomics,
  formatTokenomicsMarkdownTable,
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
    expect(table).toContain("**TOTAL (14 Projects)**");
  });
});
