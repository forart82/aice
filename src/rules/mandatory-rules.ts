/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AICE Mandatory Agent Rules Specification (Compact <= 900 B / <= 300 BPE Token 2-Tool Cheat-Card).
 * Defines the single-file rule block injected into workspace AGENTS.md (and optional CLAUDE.md).
 */

import { AICE_VERSION } from "../version.js";

export const AICE_LEGACY_DIRECTIVE_START = "<!-- AICE:START -->";
export const AICE_VERSIONED_DIRECTIVE_START = `<!-- AICE:START v${AICE_VERSION} -->`;
export const AICE_DIRECTIVE_START = AICE_VERSIONED_DIRECTIVE_START;
export const AICE_DIRECTIVE_END = "<!-- AICE:END -->";

export const MANDATORY_AGENT_RULES_MARKDOWN = `${AICE_VERSIONED_DIRECTIVE_START}
## AICE (v${AICE_VERSION})
- Gate: ONLY if \`aice.config.json\` has \`"enabled": true\`; blocker: \`aice disable\` / \`aice enable\`.
### Batch Read & Splice
- ONLY aice read/search/find (aice_read) & aice splice/aice write (aice_splice); no shell writes or \`sed\`/\`grep\`/\`cat\`/\`find\`.
- Read: \`aice read f1:sym f2:L1-L50\`, quote 'f:/a|b/', \`aice search <pat> [dir]\`, \`aice find -d 2\`.
- No paging: NEVER walk \`:L1-L150\` -> \`:L151-L300\` across turns; batch \`f:sym1 f:sym2\` (or multi-file) in 1 \`aice read\` or \`aice search <pat> f\`.
- Splice: \`aice splice --stdin << 'EOF'\` (=== f:sym ===, === f:L1-L20 ===, --delete, === f ===), multi-line \`<<< === >>>\` (no 1L).
- Briefs: "Use AICE (aice read / aice splice) for all file exploration and edits."
${AICE_DIRECTIVE_END}`;

export const ALWAYS_ON_AICE_RULE_FILE = `---
trigger: always_on
description: AICE Mandatory AST Creation, Exploration & Surgical Splicing Rules (v${AICE_VERSION})
---

${MANDATORY_AGENT_RULES_MARKDOWN}
`;

export const CANONICAL_AICE_AGENT_DIRECTIVE = MANDATORY_AGENT_RULES_MARKDOWN;
export const AICE_SYSTEM_DIRECTIVE = MANDATORY_AGENT_RULES_MARKDOWN;
