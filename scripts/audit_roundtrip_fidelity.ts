import * as fs from "node:fs";
import * as path from "node:path";
import { parse } from "../src/core/parser.js";
import { executeRoundtrip } from "../src/decompiler/roundtrip.js";
import { detectTargetFromPath, type TargetLanguage } from "../src/emitters/index.js";

const testCaseRoot = "/home/forart/dev/ail_test_case/src";

interface FileAuditResult {
  file: string;
  lang: string;
  decompileSuccess: boolean;
  parseSuccess: boolean;
  reemitSuccess: boolean;
  isIdentical: boolean;
  diffLines?: number;
  error?: string;
}

const supportedExtensions = [".ts", ".tsx", ".css", ".html", ".cpp", ".hpp", ".cc", ".cxx", ".h", ".cs"];

function findTargetFiles(dir: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findTargetFiles(full));
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      if (supportedExtensions.includes(ext) && !entry.name.endsWith(".ail")) {
        results.push(full);
      }
    }
  }
  return results.sort();
}

const allTargetFiles = findTargetFiles(testCaseRoot);
console.log(`Auditing bidirectional roundtrip across ${allTargetFiles.length} target files...`);

let totalDecompileOk = 0;
let totalParseOk = 0;
let totalReemitOk = 0;
let totalIdentical = 0;
const resultsByLang: Record<string, { total: number; decompileOk: number; parseOk: number; reemitOk: number; identical: number }> = {};

for (let i = 0; i < allTargetFiles.length; i++) {
  const targetFile = allTargetFiles[i];
  const targetLang = detectTargetFromPath(targetFile);
  const langKey = targetLang;

  if (!resultsByLang[langKey]) {
    resultsByLang[langKey] = { total: 0, decompileOk: 0, parseOk: 0, reemitOk: 0, identical: 0 };
  }
  resultsByLang[langKey].total++;

  try {
    const originalSource = fs.readFileSync(targetFile, "utf-8");
    const roundtripRes = executeRoundtrip(originalSource, targetLang, targetFile);
    totalDecompileOk++;
    resultsByLang[langKey].decompileOk++;

    // Test parse on roundtripRes.ail
    try {
      parse(roundtripRes.ail, `${targetFile}.ail`);
      totalParseOk++;
      resultsByLang[langKey].parseOk++;
    } catch (parseErr) {
      // Parse failed on generated AIL
    }

    if (roundtripRes.reconstructed) {
      totalReemitOk++;
      resultsByLang[langKey].reemitOk++;
    }

    if (roundtripRes.isIdentical) {
      totalIdentical++;
      resultsByLang[langKey].identical++;
    }
  } catch (err) {
    // Decompile or roundtrip crashed
  }
}

console.log("\n================================================================================");
console.log("=== BIDIRECTIONAL ROUNDTRIP FIDELITY AUDIT REPORT ===");
console.log("================================================================================");
console.log(`Total Target Files Audited: ${allTargetFiles.length}`);
console.log(`Direction 1 (Target -> AIL Decompile): ${totalDecompileOk}/${allTargetFiles.length} (${((totalDecompileOk / allTargetFiles.length) * 100).toFixed(1)}%)`);
console.log(`Decompiled AIL Parse Success:          ${totalParseOk}/${allTargetFiles.length} (${((totalParseOk / allTargetFiles.length) * 100).toFixed(1)}%)`);
console.log(`Direction 2 (AIL -> Target Re-emit):   ${totalReemitOk}/${allTargetFiles.length} (${((totalReemitOk / allTargetFiles.length) * 100).toFixed(1)}%)`);
console.log(`Bit-Identical Lossless Fidelity:       ${totalIdentical}/${allTargetFiles.length} (${((totalIdentical / allTargetFiles.length) * 100).toFixed(1)}%)`);
console.log("================================================================================\n");

console.log("Breakdown by Target Language:");
for (const [lang, stats] of Object.entries(resultsByLang)) {
  console.log(
    `  ${lang.padEnd(12)}: Total=${stats.total.toString().padStart(4)} | Decompile=${stats.decompileOk.toString().padStart(4)} (${((stats.decompileOk/stats.total)*100).toFixed(1)}%) | Parse=${stats.parseOk.toString().padStart(4)} (${((stats.parseOk/stats.total)*100).toFixed(1)}%) | Identical=${stats.identical.toString().padStart(4)} (${((stats.identical/stats.total)*100).toFixed(1)}%)`
  );
}
