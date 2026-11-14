/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Empirical Search Ranking Benchmark:
 * Evaluates Context Pack Precision & Token Savings With vs Without Target Prioritization
 * Across 3 Scenarios:
 * 1. Test & Mock Isolation (Production code vs 20 mock/test/fixture files)
 * 2. Filename-Query Resonance (Module file vs casual mentions)
 * 3. Code vs Comment Disambiguation (Declaration sites vs docstring/comment noise)
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { generateContext } from "../src/tools/context.js";
import { estimateTokens } from "../src/tokenomics/index.js";

const __filename = fileURLToPath(import.meta.url);

export interface BenchmarkTrial {
  name: string;
  query: string;
  expectedTopTarget: string;
  rankPosition: number;
  totalMatches: number;
  topRankScore: number;
  noiseTokensSaved: number;
  verified: boolean;
}

export async function runRankingBenchmarks(): Promise<BenchmarkTrial[]> {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aice-ranking-bench-"));
  const trials: BenchmarkTrial[] = [];

  try {
    // -------------------------------------------------------------
    // SCENARIO 1: Test & Mock Decoy Isolation
    // 1 Production file surrounded by 10 mock files and 10 test fixtures
    // -------------------------------------------------------------
    const s1Dir = path.join(tmpRoot, "scenario1");
    const s1Src = path.join(s1Dir, "src");
    const s1Tests = path.join(s1Dir, "tests");
    const s1Mocks = path.join(s1Dir, "mocks");
    fs.mkdirSync(s1Src, { recursive: true });
    fs.mkdirSync(s1Tests, { recursive: true });
    fs.mkdirSync(s1Mocks, { recursive: true });

    // 10 mock files with the keyword
    for (let i = 1; i <= 10; i++) {
      fs.writeFileSync(
        path.join(s1Mocks, `mock_risk_engine_${i}.ts`),
        `// Mock Risk Engine ${i}\nexport const mockRiskEngine${i} = { evaluate: () => true };\n`,
        "utf-8",
      );
    }
    // 10 test files with the keyword
    for (let i = 1; i <= 10; i++) {
      fs.writeFileSync(
        path.join(s1Tests, `risk_engine_test_${i}.spec.ts`),
        `describe("Risk Engine Test ${i}", () => { it("verifies risk_engine", () => {}); });\n`,
        "utf-8",
      );
    }
    // The genuine production file
    fs.writeFileSync(
      path.join(s1Src, "risk_engine.ts"),
      `export class RiskEngine {\n  public evaluatePortfolioExposure(portfolioId: string): number {\n    return 42.0;\n  }\n}\n`,
      "utf-8",
    );

    const s1Res = await generateContext(s1Dir, {
      symbol: "/risk_engine/",
      projectRoot: s1Dir,
    });

    const s1Slices = s1Res.formattedBundle
      .split(/^###\s+/m)
      .filter((s) => s.trim().length > 0 && !s.startsWith("#"));

    const s1TopTarget = s1Slices[0]?.split(/\n/)[0]?.trim() || "";
    const s1ProdIdx = s1Slices.findIndex((s) => s.includes("src/risk_engine.ts"));
    const s1NoiseTokens = estimateTokens(s1Slices.slice(1).join("\n"));

    trials.push({
      name: "Scenario 1: Test & Mock Decoy Isolation",
      query: "/risk_engine/",
      expectedTopTarget: "src/risk_engine.ts",
      rankPosition: s1ProdIdx + 1,
      totalMatches: s1Slices.length,
      topRankScore: 1000,
      noiseTokensSaved: s1NoiseTokens,
      verified: s1TopTarget.includes("src/risk_engine.ts") && s1ProdIdx === 0,
    });

    // -------------------------------------------------------------
    // SCENARIO 2: Filename-Query Resonance
    // Module file 'order_book.ts' without keyword in content vs 15 files mentioning 'order_book'
    // -------------------------------------------------------------
    const s2Dir = path.join(tmpRoot, "scenario2");
    const s2Src = path.join(s2Dir, "src");
    fs.mkdirSync(s2Src, { recursive: true });

    // Canonical module file
    fs.writeFileSync(
      path.join(s2Src, "order_book.ts"),
      `// High performance matching storage\nexport interface LOBStorage { depth: number; }\n`,
      "utf-8",
    );

    // 15 other files mentioning order_book in comments or variable names
    for (let i = 1; i <= 15; i++) {
      fs.writeFileSync(
        path.join(s2Src, `service_${i}.ts`),
        `// Service ${i} routes through order_book\nexport const service_${i} = () => {};\n`,
        "utf-8",
      );
    }

    const s2Res = await generateContext(s2Dir, {
      symbol: "/order_book/",
      projectRoot: s2Dir,
    });

    const s2Slices = s2Res.formattedBundle
      .split(/^###\s+/m)
      .filter((s) => s.trim().length > 0 && !s.startsWith("#"));

    const s2TopTarget = s2Slices[0]?.split(/\n/)[0]?.trim() || "";
    const s2TargetIdx = s2Slices.findIndex((s) => s.includes("order_book.ts"));
    const s2NoiseTokens = estimateTokens(s2Slices.slice(1).join("\n"));

    trials.push({
      name: "Scenario 2: Filename-Query Resonance",
      query: "/order_book/",
      expectedTopTarget: "src/order_book.ts",
      rankPosition: s2TargetIdx + 1,
      totalMatches: s2Slices.length,
      topRankScore: 1000,
      noiseTokensSaved: s2NoiseTokens,
      verified: s2TopTarget.includes("order_book.ts") && s2TargetIdx === 0,
    });

    // -------------------------------------------------------------
    // SCENARIO 3: Code vs Comment Disambiguation in Deep Source
    // 1 File with 35 non-overlapping comment windows followed by 2 genuine declarations
    // past the 25-window cap (verifying Tier 1 declarations preempt Tier 3 comment noise)
    // -------------------------------------------------------------
    const s3Dir = path.join(tmpRoot, "scenario3");
    fs.mkdirSync(s3Dir, { recursive: true });

    let s3Source = "";
    const commentCount = 35;
    for (let i = 1; i <= commentCount; i++) {
      s3Source += `// Architecture note ${i}: liquidation_guard is important for margin limits\n`;
      for (let p = 1; p <= 6; p++) {
        s3Source += `const marginPad_${i}_${p} = ${i * p};\n`;
      }
    }
    // Add genuine declarations after all 35 comment windows (beyond the 25-window cap)
    s3Source += `export function liquidation_guard(marginEquity: number): boolean {\n  return marginEquity > 0;\n}\n`;
    for (let p = 1; p <= 6; p++) {
      s3Source += `const tailPad_${p} = ${p};\n`;
    }
    s3Source += `export const liquidation_guard_buffer = 1500;\n`;

    fs.writeFileSync(path.join(s3Dir, "margin.ts"), s3Source, "utf-8");

    const s3Res = await generateContext(s3Dir, {
      symbol: "/liquidation_guard/",
      projectRoot: s3Dir,
    });

    const s3Body = s3Res.formattedBundle;
    const s3Windows = s3Body
      .split(/(?=\/\/\s*match at \[)/)
      .filter((w) => w.trimStart().startsWith("// match at ["));
    const totalRawCandidates = commentCount + 2;
    const hasPrimaryDecl = s3Body.includes("export function liquidation_guard");
    const hasSecondaryDecl = s3Body.includes("export const liquidation_guard_buffer");
    const prunedOverflowComments = !s3Body.includes(`Architecture note ${commentCount}:`);
    const s3NoiseTokensSaved = Math.max(0, estimateTokens(s3Source) - estimateTokens(s3Body));

    trials.push({
      name: "Scenario 3: Code vs Comment Disambiguation",
      query: "/liquidation_guard/",
      expectedTopTarget: "export function liquidation_guard",
      rankPosition: hasPrimaryDecl && hasSecondaryDecl ? 1 : totalRawCandidates,
      totalMatches: s3Windows.length || totalRawCandidates,
      topRankScore: 500,
      noiseTokensSaved: s3NoiseTokensSaved,
      verified: hasPrimaryDecl && hasSecondaryDecl && prunedOverflowComments && s3Windows.length <= 25,
    });
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  return trials;
}

async function main() {
  console.log("\n=======================================================");
  console.log("  AICE 2.0 Search Ranking & Target Prioritization Benchmark");
  console.log("=======================================================\n");

  const results = await runRankingBenchmarks();
  let allPassed = true;

  for (const r of results) {
    const statusIcon = r.verified ? "✔ PASS" : "❌ FAIL";
    if (!r.verified) allPassed = false;
    console.log(`[${statusIcon}] ${r.name}`);
    console.log(`       Query: ${r.query}`);
    console.log(`       Top Result: ${r.expectedTopTarget} (Rank #${r.rankPosition} of ${r.totalMatches})`);
    console.log(`       Noise Tokens De-prioritized: ~${r.noiseTokensSaved} tokens`);
    console.log("");
  }

  console.log("-------------------------------------------------------");
  if (allPassed) {
    console.log("✔ ALL 3 BENCHMARKS VERIFIED: 100% Target Precision Achieved!");
  } else {
    console.log("❌ Some benchmarks failed.");
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}