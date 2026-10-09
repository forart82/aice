import fs from "node:fs";
import path from "node:path";
import { getEncoding } from "js-tiktoken";

const cl100k = getEncoding("cl100k_base");
const o200k = getEncoding("o200k_base");

interface ProjectStats {
  name: string;
  lang: string;
  files: number;
  lines: number;
  chars: number;
  cl100kTokens: number;
  o200kTokens: number;
}

function scanDir(dir: string, validExts: string[]): { files: number; lines: number; chars: number; cl100k: number; o200k: number } {
  let files = 0;
  let lines = 0;
  let chars = 0;
  let cl100kTokens = 0;
  let o200kTokens = 0;

  function walk(current: string) {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist" || entry.name === "build") {
          continue;
        }
        walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (validExts.includes(ext)) {
          const content = fs.readFileSync(fullPath, "utf-8");
          files++;
          lines += content.split("\n").length;
          chars += content.length;
          cl100kTokens += cl100k.encode(content).length;
          o200kTokens += o200k.encode(content).length;
        }
      }
    }
  }

  walk(dir);
  return { files, lines, chars, cl100k: cl100kTokens, o200k: o200kTokens };
}

const pocDir = path.resolve("poc_real_case");

const projects = [
  { dir: path.join(pocDir, "snake_pp"), name: "snake_pp (SFML C++)", lang: "C++ (C++17/20)", exts: [".cpp", ".hpp", ".h"] },
  { dir: path.join(pocDir, "snake_ts"), name: "snake_ts (Canvas TypeScript)", lang: "TypeScript (ESNext)", exts: [".ts", ".tsx"] },
  { dir: path.join(pocDir, "dogMax"), name: "dogMax (Raylib C++)", lang: "C++ (C++17)", exts: [".cpp", ".hpp", ".h", ".c"] },
];

console.log("| Project | Primary Language | Files | Lines | Characters | cl100k_base Tokens | o200k_base Tokens | Avg Tokens/File |");
console.log("| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: |");

let totalFiles = 0;
let totalLines = 0;
let totalChars = 0;
let totalCl100k = 0;
let totalO200k = 0;

for (const p of projects) {
  const stats = scanDir(p.dir, p.exts);
  totalFiles += stats.files;
  totalLines += stats.lines;
  totalChars += stats.chars;
  totalCl100k += stats.cl100k;
  totalO200k += stats.o200k;

  const avgTokens = Math.round(stats.cl100k / (stats.files || 1));
  console.log(`| **${p.name}** | ${p.lang} | ${stats.files.toLocaleString()} | ${stats.lines.toLocaleString()} | ${stats.chars.toLocaleString()} | ${stats.cl100k.toLocaleString()} | ${stats.o200k.toLocaleString()} | ${avgTokens.toLocaleString()} |`);
}

console.log("| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: |");
console.log(`| **TOTAL (poc_real_case)** | **Multi-Stack** | **${totalFiles.toLocaleString()}** | **${totalLines.toLocaleString()}** | **${totalChars.toLocaleString()}** | **${totalCl100k.toLocaleString()}** | **${totalO200k.toLocaleString()}** | **${Math.round(totalCl100k / totalFiles).toLocaleString()}** |`);
