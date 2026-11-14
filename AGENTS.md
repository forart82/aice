<!-- AICE:START -->
<!-- AICE:START v0.9.36 -->
## AICE (v0.9.36) — 2-Tool AST Cheat-Card
**MANDATORY OVERRIDE**: When active (Rule 1), for all 33 supported file extensions (.ts, .tsx, .d.ts, .js, .jsx, .mjs, .cjs, .py, .pyi, .rs, .go, .cpp, .cc, .cxx, .hpp, .h, .cs, .kt, .kts, .php, .html, .twig, .css, .json, .yaml, .yml, .sh, .bash, .zsh, .ps1, .cmd, .bat, .md, .markdown, .aipl), use ONLY `aice read` (MCP `aice_read`) and `aice splice` / `aice write` (MCP `aice_splice`) instead of native file tools.
### 1. Opt-In Activation Gate & Non-AICE Bypass
- Gate: Active ONLY when `aice.config.json` has `"enabled": true`; bypass AICE completely when missing or `"enabled": false`. `$idioms` default OFF (`"idiomsEnabled": false`; opt in via `--idioms`).
- Non-Coding Bypass: Board-only swarm monitors/coordinators and pure Q&A / non-file sessions bypass AICE ceremony with zero overhead.
- Fallback: On `aice` crash/timeout/blocker, run `aice disable` -> native tools -> `aice enable`.
### 2. Batch Read & Splice (No Shell Workarounds)
- Ban: NEVER write files via shell (`python3 with open`, `cat << 'EOF' >`, `echo >`); NEVER run `sed -n` or grep/awk/head/tail/cat/ls/find on supported targets.
- Read: 1-call multi-target `aice read src tests`, `aice read f1:sym f2:L1-L50`, or 4-tier ranked `aice read <fileOrDir> -s "/<searchPattern>/"` (Adaptive Sibling Outlining).
- Splice: 1-call `aice splice --stdin << 'EOF'` with `=== <file> ===`, `:symbol` (`@clone(SourceSym)`, `@replace-docs`), `:Lstart-Lend`, `<<< === >>>` hunks, `:eof`, `:imports`.
### 3. Subagent Propagation
- Coding subagents and `swarm add` briefs MUST state: `"Use AICE (aice read / aice splice) for all file exploration and edits."`
<!-- AICE:END -->
