<!-- AICE:START -->
<!-- AICE:START v0.9.34 -->
## AICE 2.0 (v0.9.34) — MANDATORY AST Creation, Exploration & Surgical Mutation Rules
**MANDATORY OVERRIDE**: When active (see Rule 1), for all 33 supported file extensions (.ts, .tsx, .d.ts, .js, .jsx, .mjs, .cjs, .py, .pyi, .rs, .go, .cpp, .cc, .cxx, .hpp, .h, .cs, .kt, .kts, .php, .html, .twig, .css, .json, .yaml, .yml, .sh, .bash, .zsh, .ps1, .cmd, .bat, .md, .markdown, .aipl), you **MUST** use AICE CLI (`aice`) or MCP tools instead of generic `view_file` / `read_file` / `write_file` / `edit_file` / `replace_file_content`:
### 0. Zero-Discovery, Zero-Probe & Strict Shell Workaround Ban (`sed` / `ls` / `grep` Ban)
- **FORBIDDEN SHELL FILE-WRITING WORKAROUNDS**: NEVER execute shell scripts or commands to write or overwrite files (e.g. `python3 with open()`, `node fs.writeFileSync()`, `echo "..." > file`, `cat << 'EOF' > file`). Use `aice splice` (or unified alias `aice write`) for surgical updates, auto-creation, or full-file overwrites, `aice create --force` for full rewrites, or standard native file tools ONLY when in Non-AICE Bypass or Emergency Crash Fallback mode (Rule 1).
- **FORBIDDEN SHELL FILE-READING / SEARCHING WORKAROUNDS**: NEVER run `sed -n`, `awk`, `head`, `tail`, `cat`, `grep -n`, `grep -rn`, `grep -C`, `ls`, `ls -la`, `ls src`, `find`, `aice --help`, `aice --version`, `which aice`, or `git status` on supported files and directories (`aice context` works seamlessly across all 33 file extensions including `.aipl`):
  - Replace `ls src tests` -> `aice outline src tests`
  - Replace `sed -n '180,240p' file` -> `aice context <file> -s "L180-L240"`
  - Replace `sed -n '50,90p' file.aipl` -> `aice context file.aipl -s "L50-L90"`
  - Replace `grep -n "pattern" file` -> `aice outline <file>` (includes `test "..." # [Lstart-Lend]`, functions, labels, and Markdown headings) or `aice context <file> -s "<symbolOrTestId>"`
  - Replace `grep -n -C 10 "sym" file.aipl` -> `aice context file.aipl -s "sym"`
  - Replace `grep -rn "pattern" dir` -> `aice context <fileOrDir> -s "/<searchPattern>/"` (4-tier ranked: production declarations -> executable code -> comments -> tests/mocks, with exact call-site line numbers)
  - Replace `grep -rn "sym" src/` -> `aice context src -s "/sym/"`
### 1. Opt-In Activation Gate & Non-AICE Bypass (`aice.config.json`)
- **Opt-In Activation Gate**: AICE is **ONLY active** when the project folder (the same folder in which the agent is running) contains an `aice.config.json` file with `"enabled": true` (pre-provisioned in all AICE project folders such as `aice_*` / `aice`; do NOT waste a turn probing for it, and NEVER delete, overwrite, or count `aice.config.json` against project file limits).
- **Non-AICE Bypass**: If `aice.config.json` with `"enabled": true` is **not** present in the project folder (e.g. `*_nonaice` folders or when `"enabled": false`), bypass AICE completely and use standard native file tools (`write_file`, `edit_file`, `read_file`, `view_file`).
- **Emergency Self-Disabling Trigger & Crash Fallback**: If `aice` CLI or MCP fails, crashes, times out, or produces unresolvable syntax/AST errors that prevent editing or bootstrapping:
  1. You are explicitly authorized to disable AICE by running `aice disable` (or setting `"enabled": false` in `aice.config.json`).
  2. Fall back immediately to native file tools (`edit_file`, `write_file`, `read_file`, `view_file`) to repair the code, syntax, or compiler without hesitation.
  3. Once repairs are complete and tests pass, run `aice enable` to restore AST-accelerated mode.
- **Idioms Toggle**: If `"idiomsEnabled": false` (or `"idioms": false`), disable `$idiom` macros (`--no-idioms`).
### 2. Pillar 2 Unified Write — Multi-File Creation & Mixed Stream in 1–2 Turns (`from 0` — 40-75% Output Token Savings)
- **STRICT ANTI-LOOP MANDATE**: NEVER call `aice/aice_create`, `aice/aice_splice`, `aice/aice_write`, or `aice/aice_context` N times in a file-by-file loop! Always batch 2+ files into **1 single stream call** (either 1 Bash `aice splice --stdin << 'EOF'` / `aice write --stdin << 'EOF'` heredoc with zero JSON escaping, or 1 MCP `aice_splice`/`aice_write`/`aice_create` call with `=== <filePath> ===` headers in `code`).
- **Preferred Multi-File Heredoc Stream (Zero JSON Escaping)**: Write clean, native language syntax inside 1–2 `aice splice --stdin << 'EOF'` (or `aice write --stdin << 'EOF'` / `aice create --stdin << 'EOF'`) calls using `=== <filePath> ===` headers (auto-creating missing files & parent directories), then immediately run `npm install && npm run build` without running `ls`:
  ```bash
  aice create --stdin << 'EOF'
  === src/models.ts ===
  export interface Item { id: string; count: number; }
  export class Inventory {
    private items: Item[] = [];
    public add(item: Item): void { this.items.push(item); }
    public total(): number { return this.items.length; }
  }
  === src/theme.css ===
  * { box-sizing: border-box; margin: 0; padding: 0; }
  .card { display: flex; flex-direction: column; gap: 20px; padding: 16px; background: #070810; color: #f0f4fc; border-radius: 8px; }
  EOF
  ```
- **Surgical Updates vs Full-File Rewrites**:
  - **Surgical Updates (< 50% changed)**: Use `aice splice` / `aice write` (symbol edits, hunks `<<< === >>>`, or line ranges) — 90%+ edit token savings. For modular files (>150 lines), create clean methods or splice additions via `aice splice`.
  - **Full-File Replacement (> 50% changed or complete overhaul)**: Use `aice splice <file>` / `aice write <file>` without a selector/hunk (atomic full-file overwrite + auto-create), `=== <filePath>:overwrite ===` / `=== <filePath> ===` inside `aice splice --stdin`, or `aice create <file> --force` (pass `--force` / `--overwrite` if using `aice create` on existing files >25 lines).
### 3. Pillar 1 Unified Read — 1-Turn Multi-File Stream Exploration (85-90% Read Token Savings)
- **Default Multi-File `aice context` Stream**: Read multiple files, symbols, or line ranges in **1 single turn** with deduplicated dependency contracts, downstream callers, and **Adaptive Sibling Outlining** (enclosing class/interface sibling signatures auto-appended up to 20 symbols / ~150 tokens) via inline `file:sym1,sym2` or `file:Lstart-Lend` selectors:
  ```bash
  aice context f1:s1 f2:s2
  aice context src/a.aipl:fnA,fnB src/b.aipl:L10-L50 src/c.aipl
  ```
- **Zero-Read Splicing on Files You Just Created**: When upgrading files you ALREADY created in the current session, do **NOT** call `aice outline` or `aice context` — stream all surgical edits directly into `aice splice --stdin << 'EOF'` (putting `EOF` alone on its own line, followed by `npm run build` on the next line)!
- **Known Target Methods / Tests / Sections -> Direct `aice context`**: Call `aice context <file> -s "Class.m1,Class.m2"` (includes Adaptive Sibling Outlining + downstream caller line numbers `[L14]`), `aice context <testFile> -s "TC-MENU-001"`, `aice context <doc.md> -s "Heading"`, or `aice context <dir> -s "/pattern/"` (4-tier ranked search) directly without running `aice outline` first.
- **Unknown File or Directory Structure -> Multi-Target `aice outline`**: Run `aice outline src tests` or `aice outline <file1> <file2> ...` when exploring unfamiliar files or directories.
- **Skip Redundant Reads**: You do NOT need to run `outline` or `context` just to append to a file (`:eof`) or add a new field/method/section (`:ClassName.newMember` or `:New Heading`).

### 4. 1-Turn Unified Mixed Create + Hybrid Surgical Splice Stream (90%+ Edit Token Savings)
- **STRICT ANTI-LOOP MANDATE**: NEVER call `aice/aice_splice`, `aice/aice_write`, or `aice/aice_create` multiple times in a file-by-file loop! Combine all new/overwritten files (`=== <filePath> ===`), symbol edits (`=== <filePath>:<symbol> ===`), AST-scoped hunks (`<<< / === / >>>`), and line-range edits (`=== <filePath>:L<start>-L<end> ===`) into **1 single stream call**:
  ```bash
  aice splice --stdin << 'EOF'
  === src/new_helper.ts ===
  export const BONUS_MULTIPLIER = 2;
  === src/constants.ts:eof ===
  export const COMBO_BONUS = 50;
  === src/board.ts:Board.isBoardEmpty ===
  public isBoardEmpty(): boolean {
    return this.grid.every((row) => row.every((cell) => cell === null));
  }
  === src/engine.ts:GameEngine.step ===
  <<<
    this.tickCount += 1;
  ===
    this.tickCount += BONUS_MULTIPLIER;
  >>>
  === tests/board.test.ts:TC-BOARD-001 ===
  test("TC-BOARD-001: board starts empty", () => {
    expect(new Board().isBoardEmpty()).toBe(true);
  });
  === README.md:Architecture ===
  ## Architecture
  Modular deterministic board engine.
  EOF
  ```
- **Hybrid Splicing Modes & Supported `<symbol>` Selectors (`aice splice` & alias `aice write` / MCP `aice_splice` & `aice_write`)**:
  - **AST-Scoped Hunk Splicing (`<<< / === / >>>` inside `:symbol`)**: For 1–15 line edits inside a large function/method, target `=== <filePath>:<symbol> ===` (or `=== <filePath> ===`) and pass `<<<\n<search>\n===\n<replace>\n>>>` hunks — strictly scoped to that symbol's AST span and immune to line shifts!
  - **Numbered Line-Range Splicing (`:L<start>-L<end>`)**: Right after reading numbered `aice context` output (`35│ `), splice `=== <filePath>:L35-L42 ===` (gutter prefixes like `35│ ` are auto-stripped).
  - `=== <filePath> ===` (or `:create` / `:overwrite`): Auto-creates (including missing parent directories) or overwrites the target file atomically within the same `aice splice --stdin` / `aice write --stdin` batch.
  - `<FuncOrClass.method>` or `<Class.field>`: Replaces existing member OR **auto-inserts a new field/method into `<Class>`** if not yet present!
  - `<testIdOrTitle>`: Replaces matching `test(...)` / `it(...)` / `describe(...)` block by exact title or unique prefix/ID (e.g. `TC-MENU-001`).
  - `<Heading Title>` / `<function_or_label>`: Replaces or auto-appends Markdown `## Heading` sections (`.md`), shell/PowerShell functions (`.sh`, `.ps1`), or Batch `:label` blocks (`.cmd`, `.bat`).
  - `eof` (or `append`): Appends code to the end of the file.
  - `imports`: Updates/merges imports in the file's top import block (pass only the updated/added import line(s) or full block).
  - `@clone(SourceSym)`: Clones an existing function/method/symbol body as the starting template when splicing a new or target symbol (e.g. `=== src/service.ts:Service.retryFetch @clone(Service.fetch) ===`).
  - `@replace-docs` (or CLI `--no-preserve-docs` / MCP `preserveDocs: false`): Replaces existing leading JSDoc/docstring comments instead of preserving them when splicing a symbol.
  - Single-edit shorthand: `aice splice <file> -s <symbol> -c "<replacement>"` (or `aice write <file> -c "<fullContent>"`, or `--delete`).

### 5. Subagent Propagation & Swarm Worker Rules (`invoke_subagent` / `swarm add` / all subagents)
- ALL subagents and swarm workers (`test-runner`, `fast-scout`, `code-surgeon`, `deep-auditor`, `@worker`) **MUST** use `aice outline` and `aice context` instead of `read_file` / `view_file` / `grep` / `sed` / `ls`, and `aice splice` / `aice write` / `aice create` instead of `write_file` / `edit_file`. Whenever spawning any subagent, explicitly include this requirement in its prompt.
- **MANDATORY SWARM BRIEF RULE**: Whenever adding or briefing any swarm worker (`swarm add`), the coordinator **MUST** explicitly state in the brief: `"Use AICE (aice context / aice splice) for all file exploration and edits."` Coordinators must NEVER execute file-writing shell scripts (`python3 with open()`, `cat << 'EOF' > file`) directly.
<!-- AICE:END -->
