/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AICE 2.0 Project Idiom Subsystem.
 */

export type {
  IdiomOccurrence,
  ProjectIdiomDefinition,
  ProjectIdiomParam,
} from "../config/project-config.js";
export {
  type IdiomFileInput,
  type MineIdiomsOptions,
  type MineIdiomsResult,
  mineProjectIdioms,
} from "./idiom-miner.js";
export {
  type ApplyProjectIdiomsOptions,
  type ApplyProjectIdiomsResult,
  applyProjectIdiomsToDirectory,
  collapseAiceSourceIdioms,
  collapseModuleIdioms,
  expandAiceSourceIdioms,
  expandModuleIdioms,
  expandProjectIdiomsInDirectory,
  formatIdiomsMarkdownSection,
  type IdiomCacheData,
  IdiomCycleError,
  type IdiomReadResult,
  type IdiomUpdateResult,
  readProjectIdiom,
  scanProjectIdioms,
  updateProjectIdiom,
  validateIdiomDefinitions,
} from "./idiom-transform.js";
