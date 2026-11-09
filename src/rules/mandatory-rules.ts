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

### 0. Zero-Discovery, Zero-Probe & Minimum-Turn Execution Rules
- **FORBIDDEN COMMANDS**: Never waste turns running \`aice --help\`, \`aice --version\`, \`which aice\`, \`ls -la\`, \`ls src\`, \`find .\`, \`git status\`, or creating throwaway probe files.
- **Keep CoT Minimal**: Do not draft full file implementations in thinking tokens before calling \`aice\`. Stream code directly into \`aice create --stdin << 'EOF'\` and \`aice splice --stdin << 'EOF'\`.
- **Combine Install & Build in 1 Turn**: Always run \`npm install && npm run build\` in a **single** \`run_command\` call instead of splitting \`npm install\` and \`npm run build\` across 2 turns.
- **Stop Immediately After Final Build**: Once your final verification build (\`npm run build\` / \`pytest\` / \`cargo test\`) exits \`0\`, respond to the user immediately — NEVER run trailing \`git status\` or \`ls\` checks.

### 1. Project Opt-Out Check
- Respect \`aice.config.json\` in workspace root:
  - If \`"enabled": false\`, bypass AICE completely and use native file tools.
  - If \`"idiomsEnabled": false\` (or \`"idioms": false\`), disable \`$idiom\` macros (\`--no-idioms\`).

### 2. Multi-File Creation in 1–2 Turns (\`from 0\` — 40-75% Output Token Savings)
- **Preferred Multi-File Heredoc Stream (Zero JSON Escaping)**: Create all project files in 1–2 \`aice create --stdin << 'EOF'\` calls using \`=== <filePath> ===\` headers (e.g. Batch 1: config/HTML/CSS/constants/models; Batch 2: core engine/UI/main), then immediately run \`npm install && npm run build\` without running \`ls\`:
  \`\`\`bash
  aice create --stdin << 'EOF'
  === src/models.ts ===
  pub interface Item { id:$; count:#; }
  pub class Inventory {
    priv items: Item[] = [];
    pub add(item: Item):_ { this.items.push(item); }
    pub total():# { <- this.items.length; }
  }
  === src/theme.css ===
  * { bs:border-box; m:0; p:0; }
  .card { d:flex; fd:column; jc:center; ai:center; g:20px; p:16px; bg:#070810; c:#f0f4fc; r:8px; w:100%; mh:100vh; pos:relative; bd:1px solid #1e2340; ta:center; tt:uppercase; ls:2px; ov:hidden; cur:pointer; }
  EOF
  \`\`\`
- **NEVER overwrite existing files (>25 lines) with \`aice create\`**: Use \`aice splice\` for updates. For modular files (>150 lines), create clean methods or splice additions via \`aice splice\`.

### 3. MANDATORY Compact Hybrid Shorthands inside \`aice create\` & \`aice splice\`
You **MUST** actively write compact hybrid shorthands inside \`aice create\` and \`aice splice\` payloads instead of verbose native keywords (AICE compiles them losslessly to clean native TypeScript/JS/Python/Rust/Go/CSS on disk):
- **Declarations & Modifiers**: \`pub class\`, \`pub interface\`, \`pub type\`, \`pub enum\`, \`pub const\`, \`pub let\`, \`pub fn\`, \`pub async fn\`, \`fn\`, \`pub \`, \`priv \`, \`ro \`, \`pub ro \`, \`priv ro \`
- **Variables & Returns**: \`x := expr\` (\`const x = expr\`), \`i ::= 0\` (\`let i = 0\`, including \`for (i ::= 0; ...)\`), \`<- expr\` (\`return expr\`), \`<-;\` (\`return;\`)
- **Type Sigils (attach directly with single colon — NO space before sigil)**: \`:#\` (\`: number\`), \`:$\` (\`: string\`), \`:?\` (\`: boolean\`), \`:_\` (\`: void\`), \`:*\` (\`: any\`), \`:#[][]\` (\`: number[][]\`), \`:[#]\` (\`: number[]\`), \`:[$]\` (\`: string[]\`), \`(:$ | null)[][]\` (\`(string | null)[][]\`)
- **CSS Shorthands**: \`d:flex;\` (\`display: flex;\`), \`fd:column;\` (\`flex-direction: column;\`), \`jc:center;\` (\`justify-content: center;\`), \`ai:center;\` (\`align-items: center;\`), \`g:20px;\` (\`gap\`), \`p:16px;\` (\`padding\`), \`m:0;\` (\`margin\`), \`mb:12px;\` (\`margin-bottom\`), \`mt:8px;\` (\`margin-top\`), \`bg:#070810;\` (\`background\`), \`c:#f0f4fc;\` (\`color\`), \`r:8px;\` (\`border-radius\`), \`bd:1px solid #333;\` (\`border\`), \`bs:border-box;\` (\`box-sizing: border-box;\`), \`w:100%;\` (\`width\`), \`h:100%;\` (\`height\`), \`mh:100vh;\` (\`min-height\`), \`pos:relative;\` (\`position\`), \`z:10;\` (\`z-index\`), \`ov:hidden;\` (\`overflow: hidden;\`), \`op:0.9;\` (\`opacity\`), \`tr:all 0.2s;\` (\`transition\`), \`sh:0 0 10px #0ff;\` (\`box-shadow\`), \`ts:0 0 8px #0ff;\` (\`text-shadow\`), \`fs:14px;\` (\`font-size\`), \`fw:700;\` (\`font-weight\`), \`ff:sans-serif;\` (\`font-family\`), \`lh:1.5;\` (\`line-height\`), \`ls:2px;\` (\`letter-spacing\`), \`ta:center;\` (\`text-align: center;\`), \`tt:uppercase;\` (\`text-transform: uppercase;\`), \`cur:pointer;\` (\`cursor: pointer;\`), \`pe:none;\` (\`pointer-events: none;\`), \`bf:blur(6px);\` (\`backdrop-filter\`)

### 4. 1-Turn Exploration (85-90% Read Token Savings)
- **Known Target Methods -> Direct \`aice context\`**: When you already know the target \`Class.method\` names (e.g. in files you just created or from the prompt spec), call \`aice context <file> -s "Class.m1,Class.m2"\` directly **without** running \`aice outline\` first.
- **Unknown File Structure -> Multi-File \`aice outline\`**: Only run \`aice outline <file1> <file2> ...\` when exploring unfamiliar files.
- **Skip Redundant Reads**: You do NOT need to run \`outline\` or \`context\` just to append to a file (\`:eof\`) or add a new field/method to a class (\`:ClassName.newMember\`).

### 5. 1-Turn Multi-Symbol & Cross-File Surgical Splicing (90%+ Edit Token Savings)
- **Multi-Block Heredoc Stream (Zero JSON Escaping)**: Apply all surgical edits across one or more files in **1 single turn** using \`=== <filePath>:<symbol> ===\` headers and compact hybrid shorthands:
  \`\`\`bash
  aice splice --stdin << 'EOF'
  === src/constants.ts:eof ===
  pub const COMBO_BONUS = 50;
  === src/board.ts:Board.isBoardEmpty ===
  pub isBoardEmpty():? {
    <- this.grid.every((row) => row.every((cell) => cell === null));
  }
  === src/game.ts:imports ===
  import { COMBO_BONUS, LINE_POINTS } from './constants';
  === src/game.ts:TetrisGame.combo ===
  priv combo:# = -1;
  EOF
  \`\`\`
- **Supported \`<symbol>\` Selectors**:
  - \`<FuncOrClass.method>\` or \`<Class.field>\`: Replaces existing member OR **auto-inserts a new field/method into \`<Class>\`** if not yet present!
  - \`eof\` (or \`append\`): Appends code to the end of the file.
  - \`imports\`: Updates/merges imports in the file's top import block.
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
