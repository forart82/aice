<!-- AICE:START -->
<!-- AICE:START v0.9.20 -->
## AICE 2.0 (v0.9.20) — MANDATORY AST Creation, Exploration & Surgical Mutation Rules
**MANDATORY OVERRIDE**: When active (see Rule 1), for all 32 supported file extensions (.ts, .tsx, .d.ts, .js, .jsx, .mjs, .cjs, .py, .pyi, .rs, .go, .cpp, .cc, .cxx, .hpp, .h, .cs, .kt, .kts, .php, .html, .twig, .css, .json, .yaml, .yml, .sh, .bash, .zsh, .ps1, .cmd, .bat, .md, .markdown), you **MUST** use AICE CLI (`aice`) or MCP tools instead of generic `view_file` / `read_file` / `write_file` / `edit_file` / `replace_file_content`:

### 0. Zero-Discovery, Zero-Probe & Strict Shell Workaround Ban (`sed` / `ls` / `grep` Ban)
- **FORBIDDEN SHELL FILE-READING / SEARCHING WORKAROUNDS**: NEVER run `sed -n`, `awk`, `head`, `tail`, `cat`, `grep -n`, `grep -rn`, `grep -C`, `ls`, `ls -la`, `ls src`, `find`, `aice --help`, `aice --version`, `which aice`, or `git status` on supported files and directories:
  - Replace `ls src tests` -> `aice outline src tests`
  - Replace `sed -n '180,240p' file` -> `aice context <file> -s "L180-L240"`
  - Replace `grep -n "pattern" file` -> `aice outline <file>` (includes `test "..." # [Lstart-Lend]`, functions, labels, and Markdown headings) or `aice context <file> -s "<symbolOrTestId>"`
  - Replace `grep -rn "pattern" dir` -> `aice context <fileOrDir> -s "/<searchPattern>/"` (returns exact call-site line numbers and context)
- **Keep CoT Minimal**: Do not draft full file implementations in thinking tokens before calling `aice`. Stream code directly into `aice create --stdin << 'EOF'` and `aice splice --stdin << 'EOF'`.
- **Combine Install & Build in 1 Turn**: Always run `npm install && npm run build` in a **single** `run_command` call instead of splitting `npm install` and `npm run build` across 2 turns.
- **Stop Immediately After Final Build**: Once your final verification build (`npm run build` / `pytest` / `cargo test`) exits `0`, respond to the user immediately — NEVER run trailing `git status` or `ls` checks.

### 1. Project Activation Rule (`aice.config.json`)
- **Opt-In Activation Gate**: AICE is **ONLY active** when the project folder (the same folder in which the agent is running) contains an `aice.config.json` file with `"enabled": true` (pre-provisioned in all AICE project folders such as `aice_*` / `aice`; do NOT waste a turn probing for it, and NEVER delete, overwrite, or count `aice.config.json` against project file limits).
- **Non-AICE Bypass**: If `aice.config.json` with `"enabled": true` is **not** present in the project folder (e.g. `*_nonaice` folders or when `"enabled": false`), bypass AICE completely and use standard native file tools (`write_file`, `edit_file`, `read_file`, `view_file`).
- **Idioms Toggle**: If `"idiomsEnabled": false` (or `"idioms": false`), disable `$idiom` macros (`--no-idioms`).

### 2. Multi-File Creation in 1–2 Turns (`from 0` — 40-75% Output Token Savings)
- **Preferred Multi-File Heredoc Stream (Zero JSON Escaping)**: Write clean, native language syntax inside 1–2 `aice create --stdin << 'EOF'` calls using `=== <filePath> ===` headers (e.g. Batch 1: config/HTML/CSS/constants/models; Batch 2: core engine/UI/main/scripts/docs), then immediately run `npm install && npm run build` without running `ls`:
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

### 3. 1-Turn Exploration (85-90% Read Token Savings)
- **Zero-Read Splicing on Files You Just Created**: When upgrading files you ALREADY created in the current session, do **NOT** call `aice outline` or `aice context` — stream all surgical edits directly into `aice splice --stdin << 'EOF'` (putting `EOF` alone on its own line, followed by `npm run build` on the next line)!
- **Known Target Methods / Tests / Sections -> Direct `aice context`**: Call `aice context <file> -s "Class.m1,Class.m2"` (includes downstream caller call-site line numbers `[L14]`), `aice context <testFile> -s "TC-MENU-001"`, `aice context <doc.md> -s "Heading"`, or `aice context <dir> -s "/pattern/"` directly without running `aice outline` first.
- **Unknown File or Directory Structure -> Multi-Target `aice outline`**: Run `aice outline src tests` or `aice outline <file1> <file2> ...` when exploring unfamiliar files or directories.
- **Skip Redundant Reads**: You do NOT need to run `outline` or `context` just to append to a file (`:eof`) or add a new field/method/section (`:ClassName.newMember` or `:New Heading`).

### 4. 1-Turn Multi-Symbol & Cross-File Surgical Splicing (90%+ Edit Token Savings)
- **Multi-Block Heredoc Stream (Zero JSON Escaping)**: Apply all surgical edits across one or more files in **1 single turn** using `=== <filePath>:<symbol> ===` headers and clean native language syntax:
  ```bash
  aice splice --stdin << 'EOF'
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
