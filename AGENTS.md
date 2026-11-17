<!-- AICE:START -->
<!-- AICE:START v0.9.50 -->
## AICE (v0.9.50) — 2-Tool AST Cheat-Card
**MANDATORY OVERRIDE**: Active across all 33 supported file extensions (code, .sh, .bash, .zsh, .ps1, .cmd, .bat, .md, .markdown, .aipl): use ONLY `aice read`/`search`/`find` (MCP `aice_read`) & `aice splice`/`aice write` (MCP `aice_splice`), never native file tools.
### 1. Opt-In Activation Gate & Non-AICE Bypass
- Gate: Active ONLY when `aice.config.json` has `"enabled": true`; skip if missing/false. `$idioms` OFF (`--idioms` opt-in).
- Bypass: Board-only swarm monitors/coordinators & non-file Q&A have zero overhead.
- Fallback: Crash/blocker -> `aice disable` -> native tools -> `aice enable`.
### 2. Batch Read & Splice (No Shell Workarounds)
- Ban: No shell writes (`python3 with open`, `cat << 'EOF' >`, `echo >`); NEVER run `sed -n` or grep/awk/head/tail/cat/ls/find on supported files.
- Read (`<=9KB` / `~145L`/call on CLI & MCP): Prefer 1-turn numbered native `aice read src tests`, `aice read f1:sym f2:L1-L50` (Adaptive Sibling Outlining), `aice search <pat> [dir]` (4-tier ranked `aice read <fileOrDir> -s "/<searchPattern>/"`), `aice find [glob] [dir]` (or MCP `aice_read` with `search`, `contextLines`, `filesOnly`, `--dsl`); batch `:sym`/`:L` (`f:L1-L50,L200-L250`, `f:sym@kw`), read `>120L` solo, no daisy-chain `:L` (use `:symbol`/`search` or parallel 1-turn slices).
- Splice: Prefer 1-call `aice splice --stdin << 'EOF'` (or MCP `aice_splice` `=== <file>:<sym> ===` in `code`, not `edits`) with `=== <file> ===` (creates/overwrites; `:overwrite` for empty), `:symbol` (`@clone(SourceSym)`, `@replace-docs`), `:Lstart-Lend` (inclusive; `--delete` to remove), `<<< === >>>`, `:eof`, `:imports`.
### 3. Subagent Propagation
- Coding subagents/`swarm add` briefs MUST state: `"Use AICE (aice read / aice splice) for all file exploration and edits."`
<!-- AICE:END -->
