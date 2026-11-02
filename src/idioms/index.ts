/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AIL 2.0 Project Idiom Subsystem.
 */

export type { ProjectIdiomDefinition, ProjectIdiomParam } from "../config/project-config.js";
export {
  mineProjectIdioms,
  type MineIdiomsOptions,
  type MineIdiomsResult,
  type IdiomFileInput,
} from "./idiom-miner.js";
export {
  expandModuleIdioms,
  collapseModuleIdioms,
  expandAilSourceIdioms,
  collapseAilSourceIdioms,
  applyProjectIdiomsToDirectory,
  expandProjectIdiomsInDirectory,
  formatIdiomsMarkdownSection,
  type ApplyProjectIdiomsOptions,
  type ApplyProjectIdiomsResult,
} from "./idiom-transform.js";
