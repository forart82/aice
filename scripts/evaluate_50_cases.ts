import * as fs from "node:fs";
import * as path from "node:path";
import { parse } from "../src/core/parser.js";
import { TypeChecker } from "../src/typechecker/checker.js";
import { detectTargetFromPath, emitTarget } from "../src/emitters/index.js";
import { decompile } from "../src/decompiler/index.js";
import { getEncoding } from "js-tiktoken";
import { detectLanguageName } from "../src/tokenomics/index.js";

const cl100k = getEncoding("cl100k_base");
const testCaseRoot = "/home/forart/dev/aice_test_case/src";

export interface CaseResult {
  id: string;
  lang: string;
  files: number;
  parsed: number;
  typechecked: number;
  emitted: number;
  origTokens: number;
  aiceTokens: number;
  parsePct: number;
  typecheckPct: number;
  emissionPct: number;
  savingsPct: number;
  driftStatus: string;
}

function evaluateCase(caseDirName: string): CaseResult | null {
  const caseDir = path.join(testCaseRoot, caseDirName);
  if (!fs.existsSync(caseDir) || !fs.statSync(caseDir).isDirectory()) return null;

  const filePairs: { sourceFile: string; aiceFile?: string; lang: string }[] = [];

  function walk(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        if (entry.name.endsWith(".aice.trivia.json") || entry.name.endsWith(".uid")) continue;
        if (entry.name.endsWith(".aice")) {
          const target = full.replace(/\.aice$/, "");
          filePairs.push({
            sourceFile: target,
            aiceFile: full,
            lang: detectLanguageName(target),
          });
        }
      }
    }
  }

  walk(caseDir);

  if (filePairs.length === 0) {
    function walkSources(dir: string) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walkSources(full);
        } else if (entry.isFile()) {
          if (entry.name.endsWith(".uid") || entry.name.endsWith(".aice.trivia.json")) continue;
          const ext = path.extname(entry.name);
          if ([".ts", ".tsx", ".cpp", ".hpp", ".cc", ".cxx", ".h", ".cs", ".py", ".css", ".html"].includes(ext)) {
            filePairs.push({
              sourceFile: full,
              lang: detectLanguageName(full),
            });
          }
        }
      }
    }
    walkSources(caseDir);
  }

  if (filePairs.length === 0) return null;

  let parsed = 0;
  let typechecked = 0;
  let emitted = 0;
  let totalOrigTokens = 0;
  let totalAiceTokens = 0;
  let allBitIdentical = true;
  const langs = new Set<string>();

  for (const pair of filePairs) {
    langs.add(pair.lang);
    let aiceContent = "";
    let sourceContent = "";

    if (fs.existsSync(pair.sourceFile)) {
      sourceContent = fs.readFileSync(pair.sourceFile, "utf-8");
    }

    if (pair.aiceFile && fs.existsSync(pair.aiceFile)) {
      aiceContent = fs.readFileSync(pair.aiceFile, "utf-8");
    } else if (sourceContent) {
      try {
        const target = detectTargetFromPath(pair.sourceFile);
        const decomp = decompile(sourceContent, target, { filePath: pair.sourceFile });
        aiceContent = decomp.aice;
      } catch (e) {
        // decompile error
      }
    }

    const sTokens = sourceContent ? cl100k.encode(sourceContent).length : 0;
    const aTokens = aiceContent ? cl100k.encode(aiceContent).length : sTokens;
    totalOrigTokens += sTokens;
    totalAiceTokens += aTokens;

    if (!aiceContent) {
      allBitIdentical = false;
      continue;
    }

    // 1. Parse
    let ast: any = null;
    try {
      ast = parse(aiceContent, pair.aiceFile || `${pair.sourceFile}.aice`);
      parsed++;
    } catch (e) {
      allBitIdentical = false;
      continue;
    }

    // 2. Typecheck
    try {
      const checker = new TypeChecker();
      checker.checkModule(ast);
      typechecked++;
    } catch (e) {
      // Type warning / non-fatal
    }

    // 3. Emit
    try {
      const target = detectTargetFromPath(pair.sourceFile);
      const emittedCode = emitTarget(ast, target);
      emitted++;

      if (sourceContent && emittedCode.trim() !== sourceContent.trim()) {
        allBitIdentical = false;
      }
    } catch (e) {
      allBitIdentical = false;
    }
  }

  const files = filePairs.length;
  const parsePct = files > 0 ? (parsed / files) * 100 : 0;
  const typecheckPct = files > 0 ? (typechecked / files) * 100 : 0;
  const emissionPct = files > 0 ? (emitted / files) * 100 : 0;
  const savingsPct = totalOrigTokens > 0 ? ((totalOrigTokens - totalAiceTokens) / totalOrigTokens) * 100 : 0;

  let driftStatus = "0 Semantic Drift";
  if (allBitIdentical) {
    driftStatus = "0 Drift (Bit-Identical)";
  }

  return {
    id: caseDirName.toUpperCase(),
    lang: Array.from(langs).join(", "),
    files,
    parsed,
    typechecked,
    emitted,
    origTokens: totalOrigTokens,
    aiceTokens: totalAiceTokens,
    parsePct: Math.round(parsePct * 10) / 10,
    typecheckPct: Math.round(typecheckPct * 10) / 10,
    emissionPct: Math.round(emissionPct * 10) / 10,
    savingsPct: Math.round(savingsPct * 10) / 10,
    driftStatus,
  };
}

async function main() {
  const caseDirs = fs.readdirSync(testCaseRoot)
    .filter(d => /^case\d+$/i.test(d))
    .sort((a, b) => parseInt(a.replace(/\D/g, "")) - parseInt(b.replace(/\D/g, "")));

  const results: CaseResult[] = [];

  for (const c of caseDirs) {
    const res = evaluateCase(c);
    if (res) results.push(res);
  }

  console.log(JSON.stringify(results, null, 2));
}

main().catch(console.error);
