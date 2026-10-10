import * as fs from "node:fs";
import * as path from "node:path";
import { parse } from "../src/core/parser.js";

const testCaseSrc = "/home/forart/dev/ail_test_case/src";

function findAilFiles(dir: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findAilFiles(fullPath));
    } else if (entry.name.endsWith(".ail")) {
      results.push(fullPath);
    }
  }
  return results.sort();
}

const files = findAilFiles(testCaseSrc);
console.log(`Found ${files.length} .ail files in ${testCaseSrc}`);

let successCount = 0;
let failCount = 0;
const failures: { file: string; error: string; code?: string }[] = [];
const errorPatterns: Record<string, number> = {};

for (const file of files) {
  try {
    const content = fs.readFileSync(file, "utf8");
    parse(content, file);
    successCount++;
  } catch (err: any) {
    failCount++;
    const errMsg = err?.message || String(err);
    const errCode = err?.code || "UNKNOWN";
    failures.push({ file: path.relative(testCaseSrc, file), error: errMsg, code: errCode });

    // Group error pattern by general message (stripping path/line info)
    const normalized = errMsg.replace(/ at .*$/, "").replace(/\n.*/s, "").trim();
    const key = `[${errCode}] ${normalized}`;
    errorPatterns[key] = (errorPatterns[key] || 0) + 1;
  }
}

console.log("\n========================================================");
console.log(`Total .ail files: ${files.length}`);
console.log(`Parse Successes:  ${successCount} (${((successCount / files.length) * 100).toFixed(2)}%)`);
console.log(`Parse Failures:   ${failCount} (${((failCount / files.length) * 100).toFixed(2)}%)`);
console.log("========================================================\n");

if (failCount > 0) {
  console.log("Top Error Patterns:");
  const sortedPatterns = Object.entries(errorPatterns).sort((a, b) => b[1] - a[1]);
  for (const [pat, count] of sortedPatterns.slice(0, 20)) {
    console.log(`  [${count}] ${pat}`);
  }

  console.log("\nFirst 10 Failures:");
  for (const f of failures.slice(0, 10)) {
    console.log(`  ${f.file} -> [${f.code}] ${f.error}`);
  }
}
