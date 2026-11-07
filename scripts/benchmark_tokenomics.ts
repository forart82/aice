import fs from "node:fs";
import path from "node:path";
import { getEncoding } from "js-tiktoken";

const cl100k = getEncoding("cl100k_base");
const o200k = getEncoding("o200k_base");

interface BenchmarkRow {
  name: string;
  targetLang: string;
  aiceChars: number;
  targetChars: number;
  charSavingsPct: number;
  aiceCl100k: number;
  targetCl100k: number;
  cl100kSavingsPct: number;
  aiceO200k: number;
  targetO200k: number;
  o200kSavingsPct: number;
}

const examplesDir = path.resolve("examples");
const files = fs.readdirSync(examplesDir).filter((f) => f.endsWith(".aice"));

const results: BenchmarkRow[] = [];

for (const aiceFile of files) {
  const targetFile = aiceFile.replace(/\.aice$/, "");
  const aicePath = path.join(examplesDir, aiceFile);
  const targetPath = path.join(examplesDir, targetFile);

  if (!fs.existsSync(targetPath)) {
    continue;
  }

  const aiceContent = fs.readFileSync(aicePath, "utf-8");
  const targetContent = fs.readFileSync(targetPath, "utf-8");

  const ext = path.extname(targetFile);
  const targetLang =
    ext === ".ts"
      ? "TypeScript"
      : ext === ".tsx"
        ? "React TSX"
        : ext === ".py"
          ? "Python"
          : ext === ".css"
            ? "CSS3"
            : ext === ".html"
              ? "HTML5"
              : ext;

  const aiceChars = aiceContent.length;
  const targetChars = targetContent.length;
  const charSavingsPct = ((targetChars - aiceChars) / targetChars) * 100;

  const aiceCl100k = cl100k.encode(aiceContent).length;
  const targetCl100k = cl100k.encode(targetContent).length;
  const cl100kSavingsPct = ((targetCl100k - aiceCl100k) / targetCl100k) * 100;

  const aiceO200k = o200k.encode(aiceContent).length;
  const targetO200k = o200k.encode(targetContent).length;
  const o200kSavingsPct = ((targetO200k - aiceO200k) / targetO200k) * 100;

  results.push({
    name: targetFile,
    targetLang,
    aiceChars,
    targetChars,
    charSavingsPct,
    aiceCl100k,
    targetCl100k,
    cl100kSavingsPct,
    aiceO200k,
    targetO200k,
    o200kSavingsPct,
  });
}

// Sort by language then name
results.sort((a, b) => a.targetLang.localeCompare(b.targetLang) || a.name.localeCompare(b.name));

console.log(
  "| File | Target Lang | Target cl100k | AICE cl100k | cl100k Savings | Target o200k | AICE o200k | o200k Savings | Char Savings |",
);
console.log(
  "| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |",
);

let totalAiceChars = 0;
let totalTargetChars = 0;
let totalAiceCl100k = 0;
let totalTargetCl100k = 0;
let totalAiceO200k = 0;
let totalTargetO200k = 0;

for (const r of results) {
  totalAiceChars += r.aiceChars;
  totalTargetChars += r.targetChars;
  totalAiceCl100k += r.aiceCl100k;
  totalTargetCl100k += r.targetCl100k;
  totalAiceO200k += r.aiceO200k;
  totalTargetO200k += r.targetO200k;

  console.log(
    `| \`${r.name}\` | ${r.targetLang} | ${r.targetCl100k.toLocaleString()} | ${r.aiceCl100k.toLocaleString()} | **${r.cl100kSavingsPct >= 0 ? "-" : "+"}${Math.abs(r.cl100kSavingsPct).toFixed(1)}%** | ${r.targetO200k.toLocaleString()} | ${r.aiceO200k.toLocaleString()} | **${r.o200kSavingsPct >= 0 ? "-" : "+"}${Math.abs(r.o200kSavingsPct).toFixed(1)}%** | ${r.charSavingsPct >= 0 ? "-" : "+"}${Math.abs(r.charSavingsPct).toFixed(1)}% |`,
  );
}

const totalCharSavingsPct =
  ((totalTargetChars - totalAiceChars) / totalTargetChars) * 100;
const totalCl100kSavingsPct =
  ((totalTargetCl100k - totalAiceCl100k) / totalTargetCl100k) * 100;
const totalO200kSavingsPct =
  ((totalTargetO200k - totalAiceO200k) / totalTargetO200k) * 100;

console.log(
  "| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |",
);
console.log(
  `| **TOTAL (All 12 Projects)** | **Aggregated** | **${totalTargetCl100k.toLocaleString()}** | **${totalAiceCl100k.toLocaleString()}** | **-${totalCl100kSavingsPct.toFixed(1)}%** | **${totalTargetO200k.toLocaleString()}** | **${totalAiceO200k.toLocaleString()}** | **-${totalO200kSavingsPct.toFixed(1)}%** | **-${totalCharSavingsPct.toFixed(1)}%** |`,
);
