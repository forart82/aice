/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AICE Pillar 1: Unified Read Engine (`aice read` / MCP `aice_read`).
 *
 * Thin public barrel re-exporting all Unified Read Engine constants, types, and functions
 * from cohesive submodules under `src/tools/read/`.
 */

export type { DiscoveredWorkspaceFile } from "./read/discovery.js";
export {
  computeDynamicReadBudget,
  computeDynamicSliceSpan,
  type DynamicReadBudgetAllocation,
  type DynamicReadBudgetCandidate,
  type DynamicReadBudgetResult,
  type DynamicSliceSpanResult,
} from "./read/dynamic-budget.js";
export { aiceRead, read } from "./read/engine.js";
export {
  normalizeReadTargets,
  parseReadTarget,
  splitCommaSelectors,
  splitReadTargetString,
} from "./read/target-parsing.js";
export {
  countSourceLines,
  DEFAULT_AUTO_OUTLINE_LINE_THRESHOLD,
  DEFAULT_CLI_READ_MAX_BYTES,
  DEFAULT_CLI_READ_MAX_TOKENS,
  DEFAULT_CLI_READ_SOFT_BYTE_CAP,
  DEFAULT_CLI_READ_SOFT_TOKEN_CAP,
  DEFAULT_CLI_SLICE_BYTE_BUDGET,
  DEFAULT_READ_MAX_BYTES,
  DEFAULT_READ_MAX_TOKENS,
  DEFAULT_READ_SOFT_BYTE_CAP,
  DEFAULT_READ_SOFT_TOKEN_CAP,
  DEFAULT_SLICE_BYTE_BUDGET,
  type EffectiveReadBudgets,
  type NormalizedReadTarget,
  type ParsedReadTarget,
  type ReadOptions,
  type ReadResult,
  type ReadRouteMode,
  type ReadStats,
  type ReadTargetInput,
  type ReadTargetObject,
  type ReadTargetSummary,
  resolveEffectiveReadBudgets,
} from "./read/types-and-budgets.js";
