/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AICE 2.0 Mandatory Agent Rules Specification (v0.9.8).
 * Defines the zero-discovery, token-dense rules injected into AGENTS.md,
 * CLAUDE.md, and ~/.gemini/config/rules/aice.md.
 */

export const AICE_DIRECTIVE_START = "<!-- AICE:START -->";
export const AICE_DIRECTIVE_END = "<!-- AICE:END -->";

export const MANDATORY_AGENT_RULES_MARKDOWN = `${AICE_DIRECTIVE_START}
## AICE 2.0 — MANDATORY AST Creation, Exploration & Surgical Mutation Rules
**MANDATORY OVERRIDE**: For all 24 supported file extensions (.ts, .tsx, .d.ts, .js, .jsx, .mjs, .cjs, .py, .pyi, .rs, .go, .cpp, .cc, .cxx, .hpp, .h, .cs, .kt, .kts, .php, .html, .twig, .css, .json, .yaml, .yml), you **MUST** use AICE CLI (\`aice\`) or MCP tools instead of generic \`view_file\` / \`read_file\` / \`write_file\` / \`edit_file\` / \`replace_file_content\`:

### 0. Zero-Discovery Rule (DO NOT Run Help or Create Throwaway Files)
- **FORBIDDEN**: Never waste LLM turns running \`aice --help\`, \`aice create --help\`, \`aice splice --help\`, \`aice --version\`, or generating throwaway \`test.ts\` / probe files to inspect behavior.
- All syntax, shorthands, flags, and one-liners are completely documented below — execute immediately on target files.

### 1. Project Opt-Out Check
- Respect \`aice.config.json\` in workspace root:
  - If \`"enabled": false\`, bypass AICE completely and use native file tools.
  - If \`"idiomsEnabled": false\` (or \`"idioms": false\`), disable \`$idiom\` macros (\`--no-idioms\`).

### 2. Startup & New File Creation (\`from 0\` — 40-75% Output Token Savings)
- Use \`aice create <file> -c "<compact AICE>"\` (or \`aice create --batch - << 'EOF'\` / MCP \`aice_create\`) for new files.
- **NEVER overwrite existing files with \`aice create\`**: \`aice create\` strictly blocks rewriting existing files (>25 lines) to prevent accidental token blowup. Use \`aice splice\` for surgical updates.
- **Modular Creation for Large Files (>150 lines)**: Avoid massive monolithic JSON strings. Create compact skeletons + \`@idiom\` macros via \`aice create\`, then splice methods/fields via \`aice splice\`.
- **Multi-File Batch Creation**: Pipe JSON arrays via heredoc in a single turn:
  \`\`\`bash
  aice create --batch - << 'EOF'
  [
    {"filePath": "src/models.ts", "code": "pub class User { id: :$, name: :$ }"},
    {"filePath": "src/theme.css", "code": ".card { d:flex; fd:column; p:12px; bg:#07090f; c:#f8fafc; r:8px; }"}
  ]
  EOF
  \`\`\`

### 3. Compact Hybrid Shorthand Cheat-Sheet (Mandatory inside \`aice create\` & \`aice splice\`)
- **Code Shorthands**:
  - Functions & classes: \`pub async fn\`, \`pub fn\`, \`fn\`, \`pub class\`, \`pub const\`, \`pub let\`
  - Return: \`<- expr\` (replaces \`return expr\`)
  - Types: \`:#\` (\`: number\`), \`:$\` (\`: string\`), \`:?\` (\`: boolean\`), \`:_\` (\`: void\`), \`:*\` (\`: any\`), \`[#]\` (\`number[]\`), \`[$]\` (\`string[]\`)
- **CSS Shorthands**:
  - \`d:flex; fd:column; jc:space-between; ai:center; g:8px; p:12px; m:0; bg:#07090f; c:#f8fafc; r:8px; w:100%; h:100vh; pos:relative; fw:700; fs:14px;\`

### 4. Explore & Read Existing Files (85-90% Read Token Savings)
- Before calling \`read_file\` / \`view_file\` on any existing supported file, you **MUST** run \`aice outline <path>\` (or MCP \`aice_outline\`) for structure discovery + line ranges (\`[Lstart-Lend]\`) and \`aice context <file> -s <symbol>\` (or MCP \`aice_context\`) for 1-turn symbol-scoped code + dependency contracts.

### 5. Surgical Splicing Rules (90%+ Edit Token Savings)
- Modify functions, methods, fields, imports, or exact line ranges surgically:
  - **Function/Method**: \`aice splice <file> -s <FuncOrClass.method> --stdin << 'EOF'\`
  - **Class Field/Property**: \`aice splice <file> -s <ClassName.field> -c "<replacement>"\`
  - **Imports Block**: \`aice splice <file> -s imports -c "import ..."\`
  - **Line Range**: \`aice splice <file> -s L<start>-L<end> -c "<replacement>"\` (or \`-s "[L10-L15]"\`)
  - **Delete Member/Lines**: \`aice splice <file> -s <Class.field|Lstart-Lend> --delete\`
  - **Batch Splicing**: \`aice splice <file> --edits '[{"symbol":"Foo.bar","code":"..."},{"symbol":"L1-L1","delete":true}]'\`

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
