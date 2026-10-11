# STRICT SCOPE ISOLATION & CONFINEMENT INVARIANT

> [!CAUTION]
> **MANDATORY CONFINEMENT INVARIANT**: The AI agent is strictly confined to its active working directory (`.`) and its subdirectories. Under no circumstances may the AI inspect, read, search, list, reference, import, or write to any location outside this boundary.

---

## 1. Absolute Root-World Boundary
- **Isolated Sandbox**: Treat the active working directory as the absolute root of your universe.
- **Zero Awareness of Outer Environment**:
  - You must never attempt to discover, inspect, or know the name, path, or contents of the parent directory or any containing folder.
  - You must never attempt to discover, list, or know the names, paths, or contents of any sibling or adjacent directories.
  - You must operate exclusively using relative paths rooted at `./` and descending into local subdirectories.
- **Forbidden Navigation**:
  - The use of `..`, parent references, or absolute paths ascending above the active directory is strictly forbidden.
  - Commands that list or navigate parent structures (e.g. `ls ..`, `cd ..`, `find ..`, or commands attempting to inspect outer surroundings) are prohibited.

---

## 2. Complete Self-Containment
- All source files, build configurations, scripts, dependencies, documentation, and tests must reside entirely within the active directory and its subdirectories.
- The AI must rely solely and exclusively on local information contained inside the active directory tree to reason, design, implement, build, and test.

---

## 3. Pre-Action Verification Protocol
Before executing any tool or command (`view_file`, `run_command`, `write_to_file`, `replace_file_content`, etc.):
1. **Scope Check**: Confirm that all targeted file paths and command operations resolve strictly within `./` or its descendants.
2. **Immediate Rejection**: If an operation references any parent, external, or out-of-boundary path, halt and refuse the out-of-boundary operation immediately.

<!-- >>> AIL-COGNITIVE-RULE-START >>> -->
# AIL Project Directives & Dialect Specification for AI Coding Agents

> **CRITICAL DIRECTIVE**: This project is authoritatively developed in AIL (*.ail).
> Target files (`*.ts`, `*.tsx`, `*.css`, `*.html`, `*.py`, `*.cpp`, `*.hpp`, `*.h`, etc.) are **machine-generated, read-only build artifacts** (`chmod 444`).

## 1. Core Directives:
1. **Source of Truth**: Always read, inspect, create, and modify `*.ail` source files.
2. **Never Edit Target Files Directly**: Any changes made directly to target files will fail with OS permissions (`EACCES`) or be overwritten by the AIL compiler (`ail compile` or `ail compile-all`).
3. **Stack Trace Path Translation**: When runtime errors, test failures, compiler diagnostics, or user prompts reference a target file (e.g. `engine.ts:338` or `main.ts:12`), **DO NOT OPEN OR INSPECT THE TARGET FILE**. You MUST translate the path to its `.ail` sibling and inspect `engine.ts.ail` instead!
4. **No Target Shell Inspection**: Never inspect or dump target files via shell commands (e.g. DO NOT run `git diff <file.ts>` or `cat <file.ts>`). Work strictly with `*.ail` source files.
5. **Targeted Compilation**: Compile only modified source files with `ail compile <path/to/file.ail>`. Never run `compile-all` for single-file bug fixes.
6. **Verification & Testing**: Build with `npm run build` and run test suites (`npm test`). Once tests pass, task is complete.
7. **Verification & Auto-Repair**: Run `ail verify <file.ail> --json` to test code, or `ail fix <file.ail>` to autonomously repair violations.

## 2. AIL 2.0 Dialect Syntax Cheatsheet:
- **Canonical File Naming**: Always name files with target extension before `.ail` (e.g. `src/App.tsx.ail`, `src/sim/Boss.ts.ail`, `src/styles.css.ail`).
- **Keywordless Bindings** (no `let` or `const`):
  - `x := expr` -> immutable variable binding (replaces `const x = ...`)
  - `y ::= expr` -> mutable variable binding (replaces `let y = ...`)
  - `x: int := 42` -> typed immutable binding
  - `y: str ::= ""` -> typed mutable binding
- **Vector Destructuring & Math**:
  - `[x, y] := [10, 20]` (immutable destructuring)
  - `[x, y] ::= [0, 0]` (mutable destructuring)
  - `[x, y] += [dx, dy]` (vector compound assignment)
  - Canonical math builtins (no `Math.` prefix): `min(a, b)`, `max(a, b)`, `clamp(val, min, max)`, `hypot(dx, dy)`, `floor(x)`, `ceil(x)`, `round(x)`, `abs(x)`, `sqrt(x)`, `sin(r)`, `cos(r)`, `atan2(y, x)`
- **Class Dual-Case Properties**:
  - `prop X, x: type = init` -> synthesizes field `X` and getter/setter `x` in emitted TypeScript/C++
- **Single-Token Types & Sigils**:
  - Types: `int`, `str`, `float`, `bool`, `num`, `byte`, `char`, `void`, `nil` (never use `i32` or `f64`)
  - Struct sigils: `type User: id!s, name!s, age!i = 0, active!b = true, role? = "member"`
- **Functions & Trailing Returns**:
  - Concise: `fn add(a:int, b:int) = a + b`
  - Block: `fn process(n:int) -> int:` followed by 2-space indented block with trailing expression return
- **Algebraic Error Handling**:
  - Return `Result[T, E]`. Use postfix `?` for early return (never use `try/catch` or `throw`)
- **Declarative UI Component DSL**:
  - `component Button(label:str):` with indented layout hierarchy (never emit closing XML tags like `</div>`)
- **CSS Layout Macros & Tokens**:
  - Layout macros: `fl-row`, `fl-col`, `fl-center`
  - Token unit deduplication: `tokens spacing[rem]: 1: 0.25, 2: 0.5`
<!-- <<< AIL-COGNITIVE-RULE-END <<< -->
