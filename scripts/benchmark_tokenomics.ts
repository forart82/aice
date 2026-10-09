import fs from "node:fs";
import path from "node:path";
import { getEncoding } from "js-tiktoken";

const cl100k = getEncoding("cl100k_base");
const o200k = getEncoding("o200k_base");

interface BenchmarkRow {
  name: string;
  targetLang: string;
  ailChars: number;
  targetChars: number;
  charSavingsPct: number;
  ailCl100k: number;
  targetCl100k: number;
  cl100kSavingsPct: number;
  ailO200k: number;
  targetO200k: number;
  o200kSavingsPct: number;
}

const examplesDir = path.resolve("examples");
const files = fs.readdirSync(examplesDir).filter((f) => f.endsWith(".ail"));

const results: BenchmarkRow[] = [];

for (const ailFile of files) {
  const targetFile = ailFile.replace(/\.ail$/, "");
  const ailPath = path.join(examplesDir, ailFile);
  const targetPath = path.join(examplesDir, targetFile);

  if (!fs.existsSync(targetPath)) {
    continue;
  }

  const ailContent = fs.readFileSync(ailPath, "utf-8");
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

  const ailChars = ailContent.length;
  const targetChars = targetContent.length;
  const charSavingsPct = ((targetChars - ailChars) / targetChars) * 100;

  const ailCl100k = cl100k.encode(ailContent).length;
  const targetCl100k = cl100k.encode(targetContent).length;
  const cl100kSavingsPct = ((targetCl100k - ailCl100k) / targetCl100k) * 100;

  const ailO200k = o200k.encode(ailContent).length;
  const targetO200k = o200k.encode(targetContent).length;
  const o200kSavingsPct = ((targetO200k - ailO200k) / targetO200k) * 100;

  results.push({
    name: targetFile,
    targetLang,
    ailChars,
    targetChars,
    charSavingsPct,
    ailCl100k,
    targetCl100k,
    cl100kSavingsPct,
    ailO200k,
    targetO200k,
    o200kSavingsPct,
  });
}

// Sort by language then name
results.sort((a, b) => a.targetLang.localeCompare(b.targetLang) || a.name.localeCompare(b.name));

console.log(
  "| File | Target Lang | Target cl100k | AIL cl100k | cl100k Savings | Target o200k | AIL o200k | o200k Savings | Char Savings |",
);
console.log(
  "| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |",
);

let totalAilChars = 0;
let totalTargetChars = 0;
let totalAilCl100k = 0;
let totalTargetCl100k = 0;
let totalAilO200k = 0;
let totalTargetO200k = 0;

for (const r of results) {
  totalAilChars += r.ailChars;
  totalTargetChars += r.targetChars;
  totalAilCl100k += r.ailCl100k;
  totalTargetCl100k += r.targetCl100k;
  totalAilO200k += r.ailO200k;
  totalTargetO200k += r.targetO200k;

  console.log(
    `| \`${r.name}\` | ${r.targetLang} | ${r.targetCl100k.toLocaleString()} | ${r.ailCl100k.toLocaleString()} | **${r.cl100kSavingsPct >= 0 ? "-" : "+"}${Math.abs(r.cl100kSavingsPct).toFixed(1)}%** | ${r.targetO200k.toLocaleString()} | ${r.ailO200k.toLocaleString()} | **${r.o200kSavingsPct >= 0 ? "-" : "+"}${Math.abs(r.o200kSavingsPct).toFixed(1)}%** | ${r.charSavingsPct >= 0 ? "-" : "+"}${Math.abs(r.charSavingsPct).toFixed(1)}% |`,
  );
}

const totalCharSavingsPct =
  ((totalTargetChars - totalAilChars) / totalTargetChars) * 100;
const totalCl100kSavingsPct =
  ((totalTargetCl100k - totalAilCl100k) / totalTargetCl100k) * 100;
const totalO200kSavingsPct =
  ((totalTargetO200k - totalAilO200k) / totalTargetO200k) * 100;

console.log(
  "| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |",
);
console.log(
  `| **TOTAL (All 12 Projects)** | **Aggregated** | **${totalTargetCl100k.toLocaleString()}** | **${totalAilCl100k.toLocaleString()}** | **-${totalCl100kSavingsPct.toFixed(1)}%** | **${totalTargetO200k.toLocaleString()}** | **${totalAilO200k.toLocaleString()}** | **-${totalO200kSavingsPct.toFixed(1)}%** | **-${totalCharSavingsPct.toFixed(1)}%** |`,
);
