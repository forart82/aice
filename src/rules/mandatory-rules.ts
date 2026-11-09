/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AICE 2.0 Mandatory Agent Rules Specification (v0.9.9).
 * Defines the zero-discovery, token-dense rules injected into AGENTS.md,
 * CLAUDE.md, and ~/.gemini/config/rules/aice.md.
 */

export const AICE_DIRECTIVE_START = "<!-- AICE:START -->";
export const AICE_DIRECTIVE_END = "<!-- AICE:END -->";

export const MANDATORY_AGENT_RULES_MARKDOWN = `${AICE_DIRECTIVE_START}
## AICE 2.0 — MANDATORY AST Creation, Exploration & Surgical Mutation Rules
**MANDATORY OVERRIDE**: For all 24 supported file extensions (.ts, .tsx, .d.ts, .js, .jsx, .mjs, .cjs, .py, .pyi, .rs, .go, .cpp, .cc, .cxx, .hpp, .h, .cs, .kt, .kts, .php, .html, .twig, .css, .json, .yaml, .yml), you **MUST** use AICE CLI (\`aice\`) or MCP tools instead of generic \`view_file\` / \`read_file\` / \`write_file\` / \`edit_file\` / \`replace_file_content\`:

### 0. Zero-Discovery & Zero-Probe Rule (Execute Immediately)
- **FORBIDDEN**: Never waste turns running \`aice --help\`, \`aice --version\`, \`which aice\`, \`ls -la\`, \`find .\`, or creating throwaway probe files.
- **Keep CoT Minimal**: Do not draft full file implementations in thinking tokens before calling \`aice\`. Stream code directly into \`aice create --stdin << 'EOF'\` and \`aice splice --stdin << 'EOF'\`.

### 1. Project Opt-Out Check
- Respect \`aice.config.json\` in workspace root:
  - If \`"enabled": false\`, bypass AICE completely and use native file tools.
  - If \`"idiomsEnabled": false\` (or \`"idioms": false\`), disable \`$idiom\` macros (\`--no-idioms\`).

### 2. Multi-File Creation in 1–2 Turns (\`from 0\` — 40-75% Output Token Savings)
- **Preferred Multi-File Heredoc Stream (Zero JSON Escaping)**: Create multiple files in a single turn using \`=== <filePath> ===\` headers inside \`aice create --stdin << 'EOF'\`:
  \`\`\`bash
  aice create --stdin << 'EOF'
  === src/models.ts ===
  pub interface Item { id: :$; count: :#; }
  pub class Inventory {
    priv items: Item[] = [];
    pub add(item: Item): :_ { this.items.push(item); }
    pub total(): :# { <- this.items.length; }
  }
  === src/theme.css ===
  .card { d:flex; fd:column; p:12px; bg:#07090f; c:#f8fafc; r:8px; }
  EOF
  \`\`\`
- **Batching Strategy**: Scaffold all project files in 1–2 \`aice create --stdin << 'EOF'\` calls (e.g. Batch 1: config/HTML/CSS/constants/models; Batch 2: core engine/UI/main) instead of 10+ separate single-file commands. Single-file one-liner: \`aice create <file> -c "<compact AICE>"\`.
- **NEVER overwrite existing files (>25 lines) with \`aice create\`**: Use \`aice splice\` for updates. For modular files (>150 lines), create clean methods or splice additions via \`aice splice\`.

### 3. Compact Hybrid Shorthand Cheat-Sheet (Mandatory inside \`aice create\` & \`aice splice\`)
- **Code Shorthands**:
  - Declarations & class members: \`pub async fn\`, \`pub fn\`, \`fn\`, \`pub class\`, \`pub interface\`, \`pub type\`, \`pub const\`, \`pub let\`, \`pub \`, \`priv \`, \`ro \`
  - Return: \`<- expr\` (replaces \`return expr\`)
  - Types: \`:#\` (\`: number\`), \`:$\` (\`: string\`), \`:?\` (\`: boolean\`), \`:_\` (\`: void\`), \`:*\` (\`: any\`), \`[#]\` (\`number[]\`), \`[$]\` (\`string[]\`)
- **CSS Shorthands**:
  - \`d:flex; fd:column; jc:space-between; ai:center; g:8px; p:12px; m:0; bg:#07090f; c:#f8fafc; r:8px; w:100%; h:100vh; pos:relative; fw:700; fs:14px;\`

### 4. 1-Turn Multi-File Exploration (85-90% Read Token Savings)
- **Multi-File Outline**: Run \`aice outline <file1> <file2> ...\` in 1 turn to get \`[Lstart-Lend]\` spans for all imports, types, class fields, and methods across multiple files.
- **Multi-Symbol Context**: Run \`aice context <file> -s "Sym1,Sym2"\` (or \`aice context f1.ts:Sym1 f2.ts:Sym2\`) to read only the exact methods you need to modify.
- **Skip Redundant Reads**: You do NOT need to run \`outline\` or \`context\` just to append to a file (\`:eof\`) or add a new field/method to a class (\`:ClassName.newMember\`).

### 5. 1-Turn Multi-Symbol & Cross-File Surgical Splicing (90%+ Edit Token Savings)
- **Multi-Block Heredoc Stream (Zero JSON Escaping)**: Apply multiple surgical edits across one or more files in **1 turn** using \`=== <filePath>:<symbol> ===\` headers (or \`=== <symbol> ===\` when \`<file>\` is passed):
  \`\`\`bash
  aice splice --stdin << 'EOF'
  === src/constants.ts:eof ===
  pub const COMBO_BONUS = 50;
  === src/board.ts:Board.isBoardEmpty ===
  pub isBoardEmpty(): :? {
    <- this.grid.every((row) => row.every((cell) => cell === null));
  }
  === src/game.ts:imports ===
  import { COMBO_BONUS, LINE_POINTS } from './constants';
  === src/game.ts:TetrisGame.combo ===
  priv combo: :# = -1;
  EOF
  \`\`\`
- **Supported \`<symbol>\` Selectors**:
  - \`<FuncOrClass.method>\` or \`<Class.field>\`: Replaces existing member OR **auto-inserts a new field/method into \`<Class>\`** if not yet present!
  - \`eof\` (or \`append\`): Appends code to the end of the file.
  - \`imports\`: Replaces the file's top import block.
  - \`L<start>-L<end>\`: Replaces exact 1-based inclusive line range.
  - Single-edit shorthand: \`aice splice <file> -s <symbol> -c "<replacement>"\` (or \`--delete\`).

### 6. Subagent Propagation (\`invoke_subagent\` / \`test-runner\` / \`fast-scout\` / \`code-surgeon\` / \`deep-auditor\`)
- ALL subagents (\`test-runner\`, \`fast-scout\`, \`code-surgeon\`, \`deep-auditor\`) **MUST** use \`aice outline\` and \`aice context\` instead of \`read_file\` / \`view_file\`, and \`aice create\` / \`aice splice\` instead of \`write_file\` / \`edit_file\`. Whenever spawning any subagent, explicitly include this requirement in its prompt.
${AICE_DIRECTIVE_END}`;

export const AICE_SYSTEM_DIRECTIVE = MANDATORY_AGENT_RULES_MARKDOWN;
export const CANONICAL_AICE_AGENT_DIRECTIVE = MANDATORY_AGENT_RULES_MARKDOWN;

export const ALWAYS_ON_AICE_RULE_FILE = `---
trigger: always_on
description: Mandatory AICE 2.0 token-efficient AST file creation, exploration, context, and surgical splicing rules
---

${MANDATORY_AGENT_RULES_MARKDOWN}
`;
