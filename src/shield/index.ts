/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AIL 2.0 AI Exclusion & Cognitive Shield Generator (Step 4).
 */

import * as fs from "node:fs";
import * as path from "node:path";

export * from "./ai-shield.js";
export * from "./fs-lock.js";

/**
 * Transparent Permission Elevation file writing utility.
 * Safely writes generated target files by temporarily elevating write permissions
 * if the file is currently locked (chmod 444 / (mode & 0o222) === 0).
 * Creates parent directory recursively if it does not exist.
 */
export function safeWriteTargetFile(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (fs.existsSync(filePath)) {
    const stat = fs.statSync(filePath);
    const isReadOnly = (stat.mode & 0o222) === 0;
    if (isReadOnly) {
      fs.chmodSync(filePath, 0o644);
      try {
        fs.writeFileSync(filePath, content, "utf-8");
      } finally {
        fs.chmodSync(filePath, 0o444);
      }
    } else {
      fs.writeFileSync(filePath, content, "utf-8");
    }
  } else {
    fs.writeFileSync(filePath, content, "utf-8");
  }
}

