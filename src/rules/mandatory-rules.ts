/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AICE Mandatory Agent Rules Specification (Compact <= 650 BPE Token 2-Tool Cheat-Card).
 * Defines the single-file rule block injected into workspace AGENTS.md (and optional CLAUDE.md).
 */

import { AICE_VERSION } from "../version.js";

export const AICE_DIRECTIVE_START = "<!-- AICE:START -->";
export const AICE_VERSIONED_DIRECTIVE_START = `<!-- AICE:START v${AICE_VERSION} -->`;
export const AICE_DIRECTIVE_END = "<!-- AICE:END -->";

export const MANDATORY_AGENT_RULES_MARKDOWN = `${AICE_DIRECTIVE_START}
${AICE_VERSIONED_DIRECTIVE_START}
## AICE (v${AICE_VERSION}) — 2-Tool AST Cheat-Card
**MANDATORY OVERRIDE**: Active (Rule 1) across all 33 supported file extensions (.ts, .tsx, .d.ts, .js, .jsx, .mjs, .cjs, .py, .pyi, .rs, .go, .cpp, .cc, .cxx, .hpp, .h, .cs, .kt, .kts, .php, .html, .twig, .css, .json, .yaml, .yml, .sh, .bash, .zsh, .ps1, .cmd, .bat, .md, .markdown, .aipl): use ONLY \`aice read\`/\`search\`/\`find\` (MCP \`aice_read\`) & \`aice splice\`/\`aice write\` (MCP \`aice_splice\`), never native file tools.
### 1. Opt-In Activation Gate & Non-AICE Bypass
- Gate: Active ONLY when \`aice.config.json\` has \`"enabled": true\`; skip if missing/\`false\`. \`$idioms\` OFF (\`--idioms\` opt-in).
- Bypass: Board-only swarm monitors/coordinators & non-file Q&A have zero overhead.
- Fallback: Crash/blocker -> \`aice disable\` -> native tools -> \`aice enable\`.
### 2. Batch Read & Splice (No Shell Workarounds)
- Ban: No shell writes (\`python3 with open\`, \`cat << 'EOF' >\`, \`echo >\`); NEVER run \`sed -n\` or grep/awk/head/tail/cat/ls/find on supported files.
- Read: 1-turn numbered native \`aice read src tests\`, \`aice read f1:sym f2:L1-L50\` (\`--dsl\`, Adaptive Sibling Outlining; CLI <=9KB/<=150L slice, MCP <=28KB), \`aice search <pat> [dir]\` (\`grep\`, \`-C\`, \`-l\`, or 4-tier ranked \`aice read <fileOrDir> -s "/<searchPattern>/"\`), \`aice find [glob] [dir]\` (\`tree\`); MCP \`aice_read\` (\`search\`, \`contextLines\`, \`filesOnly\`, \`dsl\`).
- Splice: 1-call \`aice splice --stdin << 'EOF'\` with \`=== <file> ===\`, \`:symbol\` (\`@clone(SourceSym)\`, \`@replace-docs\`), \`:Lstart-Lend\`, \`<<< === >>>\` hunks, \`:eof\`, \`:imports\`.
### 3. Subagent Propagation
- Coding subagents/\`swarm add\` briefs MUST state: \`"Use AICE (aice read / aice splice) for all file exploration and edits."\`
${AICE_DIRECTIVE_END}`;

export const ALWAYS_ON_AICE_RULE_FILE = `---
trigger: always_on
description: AICE Mandatory AST Creation, Exploration & Surgical Splicing Rules (v${AICE_VERSION})
---

${MANDATORY_AGENT_RULES_MARKDOWN}
`;

export const CANONICAL_AICE_AGENT_DIRECTIVE = MANDATORY_AGENT_RULES_MARKDOWN;
export const AICE_SYSTEM_DIRECTIVE = MANDATORY_AGENT_RULES_MARKDOWN;
