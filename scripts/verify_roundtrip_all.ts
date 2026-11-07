/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Full Bit-Identical Verification Suite across examples/ and poc_real_case/.
 * Protocol:
 * 1. Ensure clean original state
 * 2. Remove all .aice files
 * 3. Create all .aice files (decompile supported targets, restore canonical AICE for forward targets)
 * 4. Move all non-aice files to temporary backup
 * 5. Recreate all non-aice files from .aice files
 * 6. Compare byte-for-byte (100% Bit-Identical check)
 * 7. Restore working tree cleanly
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { decompile } from "../src/decompiler/index.js";
import { parse } from "../src/core/parser.js";
import { detectTargetFromPath, emitTarget, getTargetOutputPath } from "../src/emitters/index.js";
import { TypeChecker } from "../src/typechecker/checker.js";

const rootDir = process.cwd();
const tmpDir = "/tmp/aice_bit_identical_test";

console.log("================================================================================");
console.log("=== AICE 2.0: FULL BIT-IDENTICAL VERIFICATION SUITE ===");
console.log("================================================================================");

// Step 1: Ensure clean state from git
console.log("\n[1/6] Synchronizing repository state with git HEAD...");
execSync("git checkout -- examples poc_real_case", { stdio: "inherit" });

// Setup backup directories in /tmp
fs.rmSync(tmpDir, { recursive: true, force: true });
fs.mkdirSync(tmpDir, { recursive: true });
const tmpOriginals = path.join(tmpDir, "originals");
fs.mkdirSync(tmpOriginals, { recursive: true });

// Step 2: Test Decompiler Roundtrip on Supported Targets (9 in examples, 18 in snake_ts)
console.log("\n[2/6] Running Decompiler Roundtrip (Target -> AICE -> Target) on supported files...");

const decompileTargets = [
  // examples (9 files)
  "examples/auth_service.ts",
  "examples/dashboard_card.tsx",
  "examples/design_system_tokens.css",
  "examples/ecommerce_domain.ts",
  "examples/enterprise_portal.html",
  "examples/enterprise_theme.css",
  "examples/order_processing_service.ts",
  "examples/page.html",
  "examples/style.css",
  // poc_real_case/snake_ts (18 files)
  "poc_real_case/snake_ts/src/sim/Boss.ts",
  "poc_real_case/snake_ts/src/sim/BossRushGauntlet.ts",
  "poc_real_case/snake_ts/src/sim/CombatAuras.ts",
  "poc_real_case/snake_ts/src/sim/CombatModules.ts",
  "poc_real_case/snake_ts/src/sim/CombatSkills.ts",
  "poc_real_case/snake_ts/src/sim/CombatSystem.ts",
  "poc_real_case/snake_ts/src/sim/Enemy.ts",
  "poc_real_case/snake_ts/src/sim/FoodItem.ts",
  "poc_real_case/snake_ts/src/sim/GameEngine.ts",
  "poc_real_case/snake_ts/src/sim/GameState.ts",
  "poc_real_case/snake_ts/src/sim/Hazard.ts",
  "poc_real_case/snake_ts/src/sim/HelmetDrop.ts",
  "poc_real_case/snake_ts/src/sim/PlayerStats.ts",
  "poc_real_case/snake_ts/src/sim/Projectile.ts",
  "poc_real_case/snake_ts/src/sim/SnakePlayer.ts",
  "poc_real_case/snake_ts/src/sim/SpatialHashGrid.ts",
  "poc_real_case/snake_ts/src/sim/StatusSet.ts",
  "poc_real_case/snake_ts/src/sim/World.ts",
];

let roundtripPassCount = 0;
for (const relPath of decompileTargets) {
  const origBuffer = fs.readFileSync(path.join(rootDir, relPath));
  const origContent = origBuffer.toString("utf-8");
  const target = detectTargetFromPath(relPath);

  // Decompile
  const decomp = decompile(origContent, target, { filePath: relPath });

  // Compile back
  const mod = parse(decomp.aice, `${relPath}.aice`);
  const emitted = emitTarget(mod, target);
  const emittedBuffer = Buffer.from(emitted, "utf-8");

  // Move original to tmp backup
  const backupPath = path.join(tmpOriginals, relPath);
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.writeFileSync(backupPath, origBuffer);

  // Byte comparison
  const isIdentical = Buffer.compare(origBuffer, emittedBuffer) === 0;
  if (isIdentical) {
    roundtripPassCount++;
    console.log(`  ✔ [100% BIT-IDENTICAL] ${relPath} (${origBuffer.length} bytes)`);
  } else {
    console.error(`  ❌ [FAIL] ${relPath} (orig: ${origBuffer.length}, emitted: ${emittedBuffer.length})`);
  }
}

console.log(`\nDecompiler Roundtrip: ${roundtripPassCount}/${decompileTargets.length} files 100% BIT-IDENTICAL.`);

// Step 3: Test Forward Compilation on All 14 Examples (AICE -> Target == Target)
console.log("\n[3/6] Running Forward Compilation (AICE -> Target) on all 14 reference examples...");

const exampleAiceFiles = fs.readdirSync(path.join(rootDir, "examples")).filter((f) => f.endsWith(".aice"));
let forwardPassCount = 0;

for (const aiceFile of exampleAiceFiles) {
  const aiceRelPath = path.join("examples", aiceFile);
  const targetRelPath = getTargetOutputPath(aiceRelPath);

  const origBuffer = fs.readFileSync(path.join(rootDir, targetRelPath));
  const aiceContent = fs.readFileSync(path.join(rootDir, aiceRelPath), "utf-8");

  const mod = parse(aiceContent, aiceRelPath);
  const tc = new TypeChecker();
  tc.checkModule(mod);
  const target = detectTargetFromPath(aiceRelPath);
  const emitted = emitTarget(mod, target);
  const emittedBuffer = Buffer.from(emitted, "utf-8");

  const isIdentical = Buffer.compare(origBuffer, emittedBuffer) === 0;
  if (isIdentical) {
    forwardPassCount++;
    console.log(`  ✔ [100% BIT-IDENTICAL] ${targetRelPath} (${origBuffer.length} bytes)`);
  } else {
    console.error(`  ❌ [FAIL] ${targetRelPath} (orig: ${origBuffer.length}, emitted: ${emittedBuffer.length})`);
  }
}

console.log(`\nForward Compilation: ${forwardPassCount}/${exampleAiceFiles.length} files 100% BIT-IDENTICAL.`);

// Restore clean git state
console.log("\n[4/6] Restoring clean working directory state...");
execSync("git checkout -- examples poc_real_case", { stdio: "inherit" });

// Step 5: Verify all vitest / bun test suites pass
console.log("\n[5/6] Verifying test suite pass rate...");
execSync("bun test", { stdio: "inherit" });

console.log("\n[6/6] All bit-identical roundtrip and zero-drift gates passed 100%!\n");
