/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AIL 2.0 Project Idiom Subsystem.
 */

export type {
  ProjectIdiomDefinition,
  ProjectIdiomParam,
  IdiomOccurrence,
} from "../config/project-config.js";
export {
  mineProjectIdioms,
  type MineIdiomsOptions,
  type MineIdiomsResult,
  type IdiomFileInput,
} from "./idiom-miner.js";
export {
  IdiomCycleError,
  validateIdiomDefinitions,
  expandModuleIdioms,
  collapseModuleIdioms,
  expandAilSourceIdioms,
  collapseAilSourceIdioms,
  scanProjectIdioms,
  readProjectIdiom,
  updateProjectIdiom,
  applyProjectIdiomsToDirectory,
  expandProjectIdiomsInDirectory,
  formatIdiomsMarkdownSection,
  type ApplyProjectIdiomsOptions,
  type ApplyProjectIdiomsResult,
  type IdiomCacheData,
  type IdiomReadResult,
  type IdiomUpdateResult,
} from "./idiom-transform.js";
