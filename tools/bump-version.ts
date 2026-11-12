#!/usr/bin/env node
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AICE Version Bumper SSOT Utility.
 * Automatically increments version and keeps package.json, src/version.ts,
 * CITATION.cff, README.md, install.sh, and workspace agent rules in sync.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const pkgPath = path.join(rootDir, "package.json");
const versionTsPath = path.join(rootDir, "src", "version.ts");
const citationPath = path.join(rootDir, "CITATION.cff");
const readmePath = path.join(rootDir, "README.md");
const installShPath = path.join(rootDir, "install.sh");

const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
const currentVersion = pkg.version as string;

const bumpType = process.argv[2] || "patch";
let nextVersion = "";

if (/^\d+\.\d+\.\d+$/.test(bumpType)) {
  nextVersion = bumpType;
} else {
  const [major, minor, patch] = currentVersion.split(".").map(Number);
  if (bumpType === "major") {
    nextVersion = `${major + 1}.0.0`;
  } else if (bumpType === "minor") {
    nextVersion = `${major}.${minor + 1}.0`;
  } else if (bumpType === "patch") {
    nextVersion = `${major}.${minor}.${patch + 1}`;
  } else {
    console.error(`❌ Invalid bump type or version: '${bumpType}'. Use patch | minor | major | <X.Y.Z>`);
    process.exit(1);
  }
}

console.log(`Bumping AICE: v${currentVersion} -> v${nextVersion}...`);

// 1. package.json
pkg.version = nextVersion;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf-8");

// 2. src/version.ts
const versionTs = fs.readFileSync(versionTsPath, "utf-8");
fs.writeFileSync(
  versionTsPath,
  versionTs.replace(/(?:export|pub)\s+const\s+AICE_VERSION\s*=\s*"[^"]+"/, `export const AICE_VERSION = "${nextVersion}";`),
  "utf-8"
);

// 3. CITATION.cff
if (fs.existsSync(citationPath)) {
  const cff = fs.readFileSync(citationPath, "utf-8");
  fs.writeFileSync(
    citationPath,
    cff.replace(/version: \d+\.\d+\.\d+/, `version: ${nextVersion}`),
    "utf-8"
  );
}

// 4. README.md
if (fs.existsSync(readmePath)) {
  let readme = fs.readFileSync(readmePath, "utf-8");
  readme = readme
    .replace(/Version: \d+\.\d+\.\d+/g, `Version: ${nextVersion}`)
    .replace(/Version-\d+\.\d+\.\d+-00bcd4\.svg/g, `Version-${nextVersion}-00bcd4.svg`)
    .replace(/version = \{\d+\.\d+\.\d+\}/g, `version = {${nextVersion}}`)
    .replace(new RegExp(`v${currentVersion.replace(/\./g, "\\.")}`, "g"), `v${nextVersion}`);
  fs.writeFileSync(readmePath, readme, "utf-8");
}

// 5. install.sh
if (fs.existsSync(installShPath)) {
  let installSh = fs.readFileSync(installShPath, "utf-8");
  installSh = installSh.replace(new RegExp(`v${currentVersion.replace(/\./g, "\\.")}`, "g"), `v${nextVersion}`);
  fs.writeFileSync(installShPath, installSh, "utf-8");
}

// 6. Dynamic import for syncProjectWorkspaceRules to ensure it loads new version
const { syncProjectWorkspaceRules } = await import("../src/config/project-config.js");
syncProjectWorkspaceRules(rootDir, true);

console.log(`✔ Successfully bumped AICE to v${nextVersion}!`);
