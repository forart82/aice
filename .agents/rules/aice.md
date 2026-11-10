---
trigger: always_on
description: AICE 2.0 Mandatory AST Creation, Exploration & Surgical Splicing Rules (v0.9.23)
---

<!-- AICE:START -->
<!-- AICE:START v0.9.23 -->
## AICE 2.0 (v0.9.23) — MANDATORY AST Creation, Exploration & Surgical Mutation Rules
**MANDATORY OVERRIDE**: When active (see Rule 1), for all 33 supported file extensions (.ts, .tsx, .d.ts, .js, .jsx, .mjs, .cjs, .py, .pyi, .rs, .go, .cpp, .cc, .cxx, .hpp, .h, .cs, .kt, .kts, .php, .html, .twig, .css, .json, .yaml, .yml, .sh, .bash, .zsh, .ps1, .cmd, .bat, .md, .markdown, .aipl), you **MUST** use AICE CLI (`aice`) or MCP tools instead of generic `view_file` / `read_file` / `write_file` / `edit_file` / `replace_file_content`:
### 0. Zero-Discovery, Zero-Probe & Strict Shell Workaround Ban (`sed` / `ls` / `grep` Ban)
- **FORBIDDEN SHELL FILE-READING / SEARCHING WORKAROUNDS**: NEVER run `sed -n`, `awk`, `head`, `tail`, `cat`, `grep -n`, `grep -rn`, `grep -C`, `ls`, `ls -la`, `ls src`, `find`, `aice --help`, `aice --version`, `which aice`, or `git status` on supported files and directories (`aice context` works seamlessly across all 33 file extensions including `.aipl`):
  - Replace `ls src tests` -> `aice outline src tests`
  - Replace `sed -n '180,240p' file` -> `aice context <file> -s "L180-L240"`
  - Replace `sed -n '50,90p' file.aipl` -> `aice context file.aipl -s "L50-L90"`
  - Replace `grep -n "pattern" file` -> `aice outline <file>` (includes `test "..." # [Lstart-Lend]`, functions, labels, and Markdown headings) or `aice context <file> -s "<symbolOrTestId>"`
  - Replace `grep -n -C 10 "sym" file.aipl` -> `aice context file.aipl -s "sym"`
  - Replace `grep -rn "pattern" dir` -> `aice context <fileOrDir> -s "/<searchPattern>/"` (returns exact call-site line numbers and context)
  - Replace `grep -rn "sym" src/` -> `aice context src -s "/sym/"`
- **Opt-In Activation Gate**: AICE is **ONLY active** when the project folder (the same folder in which the agent is running) contains an `aice.config.json` file with `"enabled": true` (pre-provisioned in all AICE project folders such as `aice_*` / `aice`; do NOT waste a turn probing for it, and NEVER delete, overwrite, or count `aice.config.json` against project file limits).
- **Non-AICE Bypass**: If `aice.config.json` with `"enabled": true` is **not** present in the project folder (e.g. `*_nonaice` folders or when `"enabled": false`), bypass AICE completely and use standard native file tools (`write_file`, `edit_file`, `read_file`, `view_file`).
- **Idioms Toggle**: If `"idiomsEnabled": false` (or `"idioms": false`), disable `$idiom` macros (`--no-idioms`).

### 2. Multi-File Creation & Unified Mixed Stream in 1–2 Turns (`from 0` — 40-75% Output Token Savings)
- **Preferred Multi-File Heredoc Stream (Zero JSON Escaping)**: Write clean, native language syntax inside 1–2 `aice create --stdin << 'EOF'` or `aice splice --stdin << 'EOF'` calls using `=== <filePath> ===` headers (e.g. Batch 1: config/HTML/CSS/constants/models; Batch 2: core engine/UI/main/scripts/docs), then immediately run `npm install && npm run build` without running `ls`:
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
- **NEVER overwrite existing files (>25 lines) with `aice create`**: Use `aice splice` for updates. For modular files (>150 lines), create clean methods or splice additions via `aice splice`.

### 3. 1-Turn Multi-File Stream Exploration (85-90% Read Token Savings)
- **Default Multi-File `aice context` Stream**: Read multiple files, symbols, or line ranges in **1 single turn** with deduplicated dependency contracts and downstream callers via inline `file:sym1,sym2` or `file:Lstart-Lend` selectors:
  ```bash
  aice context f1:s1 f2:s2
  aice context src/a.aipl:fnA,fnB src/b.aipl:L10-L50 src/c.aipl
  ```
- **Zero-Read Splicing on Files You Just Created**: When upgrading files you ALREADY created in the current session, do **NOT** call `aice outline` or `aice context` — stream all surgical edits directly into `aice splice --stdin << 'EOF'` (putting `EOF` alone on its own line, followed by `npm run build` on the next line)!
- **Known Target Methods / Tests / Sections -> Direct `aice context`**: Call `aice context <file> -s "Class.m1,Class.m2"` (includes downstream caller call-site line numbers `[L14]`), `aice context <testFile> -s "TC-MENU-001"`, `aice context <doc.md> -s "Heading"`, or `aice context <dir> -s "/pattern/"` directly without running `aice outline` first.
- **Unknown File or Directory Structure -> Multi-Target `aice outline`**: Run `aice outline src tests` or `aice outline <file1> <file2> ...` when exploring unfamiliar files or directories.
- **Skip Redundant Reads**: You do NOT need to run `outline` or `context` just to append to a file (`:eof`) or add a new field/method/section (`:ClassName.newMember` or `:New Heading`).

### 4. 1-Turn Unified Mixed Create + Surgical Splice Stream (90%+ Edit Token Savings)
- **Default Multi-Block Heredoc Stream (Mixing New `=== file ===` & Edited `=== file:sym ===` Blocks in 1 Turn)**: Apply both new file creations (`=== <filePath> ===` or `=== <filePath>:create ===`) and surgical edits (`=== <filePath>:<symbol> ===`) across multiple files in **1 single turn**:
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
  === tests/board.test.ts:TC-BOARD-001 ===
  test("TC-BOARD-001: board starts empty", () => {
    expect(new Board().isBoardEmpty()).toBe(true);
  });
  === README.md:Architecture ===
  ## Architecture
  Modular deterministic board engine.
  EOF
  ```
- **Supported `<symbol>` Selectors**:
  - `=== <filePath> ===` (or `:create` / `:overwrite`): Creates or overwrites the target file atomically within the same `aice splice --stdin` batch.
  - `<FuncOrClass.method>` or `<Class.field>`: Replaces existing member OR **auto-inserts a new field/method into `<Class>`** if not yet present!
  - `<testIdOrTitle>`: Replaces matching `test(...)` / `it(...)` / `describe(...)` block by exact title or unique prefix/ID (e.g. `TC-MENU-001`).
  - `<Heading Title>` / `<function_or_label>`: Replaces or auto-appends Markdown `## Heading` sections (`.md`), shell/PowerShell functions (`.sh`, `.ps1`), or Batch `:label` blocks (`.cmd`, `.bat`).
  - `eof` (or `append`): Appends code to the end of the file.
  - `imports`: Updates/merges imports in the file's top import block (pass only the updated/added import line(s) or full block).
  - `L<start>-L<end>`: Replaces exact 1-based inclusive line range.
  - Single-edit shorthand: `aice splice <file> -s <symbol> -c "<replacement>"` (or `--delete`).

### 5. Subagent Propagation (`invoke_subagent` / `test-runner` / `fast-scout` / `code-surgeon` / `deep-auditor`)
- ALL subagents (`test-runner`, `fast-scout`, `code-surgeon`, `deep-auditor`) **MUST** use `aice outline` and `aice context` instead of `read_file` / `view_file` / `grep` / `sed` / `ls`, and `aice create` / `aice splice` instead of `write_file` / `edit_file`. Whenever spawning any subagent, explicitly include this requirement in its prompt.
<!-- AICE:END -->
