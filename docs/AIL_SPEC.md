# AIL Language Specification (Version 2.0 - BPE-Tuned Standard)

> **Status**: Official Normative Specification  
> **Theoretical Basis**: Intent-Based Intermediate Representation, BPE Token Economics, Asymmetric Lens Calculus, and Side-by-Side Defense-in-Depth Architecture  
> **Target Runtimes**: TypeScript (ES2022/NodeNext/TSX), Python (3.12+), C++ (C++20), Rust (2021), Go (1.22+), HTML5/CSS3  

---

## 1. Formal Grammar (EBNF)

AIL uses an **Indentation-Delimited Surface Grammar** backed by a two-stage lexer that converts layout into logical `NEWLINE`, `INDENT`, and `DEDENT` tokens. The grammar is **permissive**: it optionally accepts curly braces `{}` and semicolons `;` when operating in whitespace-sensitive patch environments.

```ebnf
(* Top-level Module *)
Module              ::= "module" ModulePath NEWLINE ModuleItem*
ModulePath          ::= IDENT ("/" IDENT)*
ModuleItem          ::= ImportDecl 
                      | TypeDecl 
                      | ClassDecl 
                      | FunctionDecl 
                      | ComponentDecl 
                      | StyleDecl 
                      | TokenSheetDecl 
                      | VarDecl

(* Imports & Dependencies *)
ImportDecl          ::= "from" STRING "import" (IDENT ("," IDENT)* | "*") NEWLINE

(* Type & Struct Declarations *)
TypeDecl            ::= "type" IDENT TypeParams? ":" (NEWLINE INDENT FieldList DEDENT | InlineFieldList NEWLINE)
                      | "enum" IDENT TypeParams? ":" NEWLINE INDENT EnumVariants DEDENT
TypeParams          ::= "[" IDENT ("," IDENT)* "]"
FieldList           ::= (FieldDecl NEWLINE)+
InlineFieldList     ::= FieldDecl ("," FieldDecl)*
FieldDecl           ::= IDENT Sigil? (":" TypeExpr)? ("=" Expr)?
Sigil               ::= "!s" | "!i" | "!f" | "!b" | "!" | "?"
EnumVariants        ::= (IDENT ("(" (TypeExpr ("," TypeExpr)*)? ")")? NEWLINE)+

(* Class & Dual-Case Property Declarations *)
ClassDecl           ::= "class" IDENT ("extends" IDENT)? ":" NEWLINE INDENT ClassMember+ DEDENT
ClassMember         ::= PropertyDecl | MethodDecl | ConstructorDecl
PropertyDecl        ::= "prop" IDENT ("," IDENT)? (":" TypeExpr)? ("=" Expr)? NEWLINE
                      | IDENT (":" TypeExpr)? ("=" Expr)? NEWLINE
ConstructorDecl     ::= "constructor" "(" ParamList? ")" ":" NEWLINE Block
MethodDecl          ::= "fn" IDENT "(" ParamList? ")" ("->" TypeExpr)? ":" NEWLINE Block
                      | "fn" IDENT "(" ParamList? ")" ("->" TypeExpr)? "=" Expr NEWLINE

(* Type Expressions *)
TypeExpr            ::= PrimitiveType
                      | ArrayType
                      | RecordType
                      | ResultType
                      | OptionType
                      | RefinementType
                      | NamedType

PrimitiveType       ::= "str" | "int" | "float" | "num" | "bool" | "byte" | "char" | "void" | "nil"
ArrayType           ::= "[" TypeExpr "]"
RecordType          ::= "{" (IDENT ":" TypeExpr ("," IDENT ":" TypeExpr)*)? "}"
ResultType          ::= "Result" "[" TypeExpr "," TypeExpr "]"
OptionType          ::= TypeExpr "?" | "Option" "[" TypeExpr "]"
RefinementType      ::= "{" IDENT ":" PrimitiveType "|" Expr "}"
NamedType           ::= IDENT ("[" TypeExpr ("," TypeExpr)* "]")?

(* Function Declarations *)
FunctionDecl        ::= "fn" IDENT "(" ParamList? ")" ("->" TypeExpr)? ":" NEWLINE Block
                      | "fn" IDENT "(" ParamList? ")" ("->" TypeExpr)? "=" Expr NEWLINE
ParamList           ::= Param ("," Param)*
Param               ::= IDENT (":" TypeExpr)? ("=" Expr)?

(* Statements & Blocks *)
Block               ::= INDENT Statement+ DEDENT
Statement           ::= LetBinding
                      | MutBinding
                      | DestructureBinding
                      | AssignStmt
                      | ReturnStmt
                      | ExprStmt
                      | IfStmt
                      | MatchStmt
                      | ForStmt
                      | WhileStmt

(* Keywordless Declarations (Go/Ocaml-style BPE compression) *)
LetBinding          ::= IDENT (":" TypeExpr)? ":=" Expr NEWLINE
                      | "let" IDENT (":" TypeExpr)? "=" Expr NEWLINE       (* Backward-compatible *)
MutBinding          ::= IDENT (":" TypeExpr)? "::=" Expr NEWLINE
                      | "let" "mut" IDENT (":" TypeExpr)? "=" Expr NEWLINE (* Backward-compatible *)

(* Vector / Tuple Destructuring *)
DestructureBinding  ::= "[" IDENT ("," IDENT)* "]" (":=" | "::=") Expr NEWLINE
AssignStmt          ::= (IDENT | "[" IDENT ("," IDENT)* "]") ("=" | "+=" | "-=" | "*=" | "/=") Expr NEWLINE
ReturnStmt          ::= "ret" Expr? NEWLINE
ExprStmt            ::= Expr NEWLINE  (* Trailing expression in block body acts as implicit return *)

IfStmt              ::= "if" Expr ":" NEWLINE Block ("elif" Expr ":" NEWLINE Block)* ("else" ":" NEWLINE Block)?
MatchStmt           ::= "match" Expr ":" NEWLINE INDENT (MatchCase)+ DEDENT
MatchCase           ::= Pattern "=>" (Expr NEWLINE | NEWLINE Block)
Pattern             ::= Literal | IDENT | IDENT "(" (Pattern ("," Pattern)*)? ")" | "_"

ForStmt             ::= "for" IDENT "in" Expr ":" NEWLINE Block
WhileStmt           ::= "while" Expr ":" NEWLINE Block

(* Expressions (Infix Precedence via Pratt Parsing) *)
Expr                ::= BinaryExpr | UnaryExpr | PostfixExpr | PrimaryExpr
PostfixExpr         ::= PrimaryExpr "?"                  (* Try unwrap Result/Option *)
                      | PrimaryExpr "(" ArgList? ")"     (* Call or Positional Struct Constructor *)
                      | PrimaryExpr "." IDENT            (* Property Access *)
                      | PrimaryExpr "[" Expr "]"         (* Indexing *)

BinaryExpr          ::= Expr BinaryOp Expr
BinaryOp            ::= "+" | "-" | "*" | "/" | "%"
                      | "==" | "!=" | "<" | "<=" | ">" | ">="
                      | "and" | "or" | "??"

UnaryExpr           ::= ("not" | "-") Expr

PrimaryExpr         ::= Literal
                      | IDENT
                      | "(" Expr ")"
                      | "[" (Expr ("," Expr)*)? "]"      (* Array / Tuple Literal *)
                      | "{" (RecordEntry ("," RecordEntry)*)? "}" (* Record Literal with Spread & Shorthand *)
                      | IDENT "(" (Expr ("," Expr)*)? ")" (* Positional Struct Constructor *)

RecordEntry         ::= "..." Expr                       (* Record Spread & Structural Update *)
                      | IDENT (":" Expr)?                (* Supports { key } punning shorthand *)
Literal             ::= NUMBER | STRING | BOOLEAN | NIL | HEX_COLOR

(* Declarative UI Component DSL (56% Token Reduction vs JSX) *)
ComponentDecl       ::= "component" IDENT ("(" ParamList? ")")? ":" NEWLINE INDENT LayoutNode+ DEDENT
LayoutNode          ::= IDENT ("(" AttrList? ")")? (":" (NEWLINE INDENT LayoutNode+ DEDENT | STRING))? NEWLINE
AttrList            ::= Attr ("," Attr)*
Attr                ::= IDENT ("=" Expr)?

(* Style & Design Token Sheet Declarations *)
TokenSheetDecl      ::= "tokens" IDENT ("[" IDENT "]")? ":" NEWLINE INDENT (IDENT ":" TokenValue NEWLINE)+ DEDENT
StyleDecl           ::= "style" StyleSelector ":" (NEWLINE INDENT StylePropList DEDENT | InlineStylePropList NEWLINE)
StyleSelector       ::= IDENT | CLASS_NAME | ID_NAME | PSEUDO_CLASS | STRING
StylePropList       ::= (StyleProperty NEWLINE)+
InlineStylePropList ::= StyleProperty (";" StyleProperty)*
StyleProperty       ::= StylePropName ":" StylePropValue
                      | LayoutMacro NEWLINE
LayoutMacro         ::= "fl-row" | "fl-col" | "fl-center"
StylePropName       ::= PropertyAlias | IDENT | CSS_VAR | STRING
PropertyAlias       ::= "bg" | "bgc" | "bkg" | "rad" | "sh" | "disp" | "pos" | "p" | "m"
                      | "w" | "h" | "min-w" | "max-w" | "min-h" | "max-h"
                      | "f" | "fz" | "fw" | "lh" | "ls" | "ta" | "td" | "tt"
                      | "c" | "cur" | "op" | "trans" | "anim" | "b" | "bb" | "bt" | "bl" | "br"
                      | "fl" | "fld" | "flw" | "fls" | "flg" | "jc" | "ai" | "ac" | "gap" | "z"
StylePropValue      ::= HEX_COLOR | NUMBER | IDENT | DIMENSION | COMPOUND_CSS | STRING
```

---

## 2. Canonical Intent Standard Library & Arithmetic DSL

To eliminate LLM API hallucinations and redundant boilerplate, AIL exposes univalent canonical operations and global math builtins that lower directly to native target expressions without runtime dependencies:

### 2.1 Canonical Standard Library (CSL)
| Canonical AIL Operation | Semantics | Emitted TypeScript (ES2022) | Emitted Python (3.12+) | Emitted C++ (C++20) |
| :--- | :--- | :--- | :--- | :--- |
| `str.slice(start, end)` | Half-open $[start, end)$, negative index safe | `str.slice(start, end)` | `str[start:end]` | `str.substr(start, end - start)` |
| `str.at(index)` | Character at 0-based offset | `str.at(index)` | `str[index]` | `str[index]` |
| `str.len` | UTF-8 codepoint length | `str.length` | `len(str)` | `str.length()` |
| `str.concat(other)` | Pure string concatenation | `str + other` | `str + other` | `str + other` |
| `str.toInt()` | Fallible parse integer | `parseIntResult(str)` | `int(str)` (guarded) | `std::stoi(str)` |
| `list.len` | Element count | `list.length` | `len(list)` | `list.size()` |
| `list.get(index)` | Option-returning safe lookup | `list.at(index) ?? null` | `list[index] if ... else None` | `list.at(index)` |
| `list.slice(start, end)`| Pure immutable subarray | `list.slice(start, end)` | `list[start:end]` | vector slice subrange |
| `list.append(item)` | Pure immutable append | `[...list, item]` | `[*list, item]` | push to copy |
| `list.isEmpty()` | True iff length is 0 | `list.length === 0` | `len(list) == 0` | `list.empty()` |
| `val?` | Postfix unwrap early return | `if (!res.ok) return res; res.value` | `if not res.get("ok"): return res` | `if (!res.has_value()) return res;` |

### 2.2 Vector & Arithmetic Compression DSL
Built-in global math functions compile directly to native math calls, eliminating repetitive `Math.` prefixes (saving ~2 tokens per math call):
- `min(a, b)` $\to$ `Math.min(a, b)` / `std::min(a, b)` / `min(a, b)`
- `max(a, b)` $\to$ `Math.max(a, b)` / `std::max(a, b)` / `max(a, b)`
- `clamp(x, min, max)` $\to$ `Math.max(min, Math.min(max, x))` / `std::clamp(x, min, max)`
- `hypot(dx, dy)` $\to$ `Math.hypot(dx, dy)` / `std::hypot(dx, dy)`
- `floor(x)`, `ceil(x)`, `round(x)`, `abs(x)`, `sqrt(x)`
- `sin(r)`, `cos(r)`, `tan(r)`, `atan2(y, x)`, `asin(v)`, `acos(v)`, `pow(b, e)`

---

## 3. Type Calculus & Sound Refinement Specifications

### 3.1 Base Types & Subtyping Lattice
```
                    Any / Unknown
                          |
         +----------------+----------------+
         |                |                |
        Num             String            Bool
       /   \              |                |
     Int   Float         Char             Unit
      |      |
      +------+
         |
        Nil
```
- **Zero Implicit Coercion**: `"5" + 2` is rejected at compile time. Strict explicit parsing `str.toInt()? + 2` is enforced.
- **Strict Boolean Conditionals**: All `if` and `while` conditions must evaluate strictly to `bool`. Passing numbers, strings, or collections triggers compile-time rejection.

### 3.2 SMT-Backed Refinement Solving
Refinements are restricted to **Quantifier-Free Linear Integer Arithmetic (QF-LIA)** and **Equality with Uninterpreted Functions (EUF)**:
$$\tau \triangleq \{ v : B \mid \phi(v) \}$$
Subtyping judgment:
$$\frac{\text{UNSAT}\left( \llbracket \Gamma \rrbracket \wedge \phi_1(v) \wedge \neg \phi_2(v) \right)}{\Gamma \vdash \{ v : B \mid \phi_1(v) \} \le \{ v : B \mid \phi_2(v) \}}$$
Compile-time bounds checking eliminates out-of-bounds indexing and division-by-zero panics before code generation.

---

## 4. Lossless Lens Theorems & CST Trivia Equations

The bidirectional transpiler is governed by the Bancilhon-Spyratos Constant Complement Theorem:
$$C \xrightarrow{\sim} A \times \Omega$$
where $C$ is the target source file, $A$ is the AIL semantic AST, and $\Omega$ is the `CstTriviaTable`.

### 4.1 The Lens Stability Law (GetPut)
$$\forall c \in C, \quad \text{Put}(\text{Get}(c), \Omega(c)) \equiv c$$
An unmutated target file decompiled to AIL and re-emitted produces a **byte-for-byte identical file with 0 git diff**.

### 4.2 The Lens Correctness Law (PutGet)
$$\forall a \in A, \forall \omega \in \Omega, \quad \text{Get}(\text{Put}(a, \omega)) \equiv a$$
Updating the AIL AST and emitting target code preserves all semantic edits when re-read into AIL.

---

## 5. Side-by-Side 4-Layer Defense-in-Depth Architecture

To avoid breaking existing build pipelines (Vite, Cargo, CMake, Bun, Next.js), relative imports, and git history, AIL operates **side-by-side**:
```
project/src/
├── Controller.ts           <-- Read-only lock (chmod 444). Hidden from AI agents.
└── Controller.ts.ail       <-- VISIBLE to AI as single authoritative source of truth.
```

### The 4 Layers of Protection:
1. **IDE Sibling Conditional Exclusion (`.vscode/settings.json`)**:
   Uses `"**/*.ts": { "when": "$(basename).ts.ail" }`. Hides target files from file trees, fuzzy finders, and symbol indexing in Cursor, VS Code, and Windsurf.
2. **Universal AI Agent Ignores (`.cursorignore`, `.geminiignore`, `.aiderignore`, `.agentignore`)**:
   Prevents agent exploration tools (`grep`, `find`, `list_dir`) and codebase vector embeddings from indexing target files.
3. **Cognitive Lockdown Directives (`AGENTS.md`, `.cursorrules`)**:
   Instructs AI agents that target files are read-only generated artifacts and all edits must be made directly in `*.ail` files.
4. **Filesystem Permission Locks (`chmod 444`) & Watch Daemon (`ail watch`)**:
   Generated target files are locked to read-only (`0o444`). Direct edit attempts fail with `EACCES`. The `ail watch` daemon atomically unlocks target files, recompiles them in $< 5\text{ms}$, and relocks them, preserving instant Hot Module Reloading (HMR).

---

## 6. Empirical Tokenomics Benchmarks

### 6.1 Table 1: All 14 Reference Examples (`examples/`)
Audited via `js-tiktoken` with `--check-drift` enforcing **100% zero target drift**:

| File | Target Lang | Target cl100k | AIL cl100k | cl100k Savings | Target o200k | AIL o200k | o200k Savings | Char Savings |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| `design_system_tokens.css` | CSS3 | 4,097 | 3,312 | **-19.2%** | 4,098 | 3,331 | **-18.7%** | -35.0% |
| `enterprise_theme.css` | CSS3 | 6,297 | 4,869 | **-22.7%** | 6,299 | 4,935 | **-21.7%** | -40.1% |
| `style.css` | CSS3 | 67 | 59 | **-11.9%** | 67 | 59 | **-11.9%** | -31.9% |
| `gateway_service.go` | Go | 514 | 246 | **-52.1%** | 523 | 253 | **-51.6%** | -52.3% |
| `enterprise_portal.html` | HTML5 | 7,102 | 4,873 | **-31.4%** | 7,094 | 4,855 | **-31.6%** | -26.1% |
| `page.html` | HTML5 | 171 | 132 | **-22.8%** | 172 | 132 | **-23.3%** | -12.3% |
| `data_pipeline_models.py` | Python | 4,096 | 3,415 | **-16.6%** | 4,093 | 3,618 | **-11.6%** | -23.2% |
| `server.py` | Python | 143 | 128 | **-10.5%** | 146 | 129 | **-11.6%** | -20.4% |
| `stream_processor_engine.py` | Python | 5,048 | 4,180 | **-17.2%** | 4,927 | 4,196 | **-14.8%** | -22.1% |
| `dashboard_card.tsx` | React TSX | 106 | 47 | **-55.7%** | 112 | 48 | **-57.1%** | -58.2% |
| `order_engine.rs` | Rust | 562 | 343 | **-39.0%** | 565 | 348 | **-38.4%** | -46.3% |
| `auth_service.ts` | TypeScript | 263 | 175 | **-33.5%** | 274 | 181 | **-33.9%** | -41.1% |
| `ecommerce_domain.ts` | TypeScript | 5,429 | 3,567 | **-34.3%** | 5,438 | 3,649 | **-32.9%** | -39.7% |
| `order_processing_service.ts` | TypeScript | 5,834 | 4,234 | **-27.4%** | 5,799 | 4,282 | **-26.2%** | -33.5% |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **TOTAL (14 Projects)** | **Aggregated** | **39,729** | **29,580** | **-25.5%** | **39,607** | **30,016** | **-24.2%** | **-31.8%** |

### 6.2 Table 2: Real-World Production Projects (`poc_real_case/`)
Audited across 67 production files from Raylib C++, SFML C++, and Canvas TypeScript games:

| Project | Target Lang | Target cl100k | AIL cl100k | cl100k Savings | Target o200k | AIL o200k | o200k Savings | Char Savings |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| `dogMax` (27 files) | C++20 | 8,349 | 4,488 | **-46.2%** | 8,364 | 4,488 | **-46.3%** | -56.1% |
| `snake_pp` (22 files) | C++20 | 8,065 | 2,948 | **-63.4%** | 8,183 | 2,989 | **-63.5%** | -66.8% |
| `snake_ts` (18 files) | TypeScript | 87,759 | 65,333 | **-25.6%** | 87,962 | 65,481 | **-25.6%** | -27.9% |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **TOTAL (3 Projects / 67 Files)** | **Aggregated** | **104,173** | **72,769** | **-30.1%** | **104,509** | **72,958** | **-30.2%** | **-33.8%** |

### 6.3 Table 3: 100-Case Deep Twinless On-the-Fly Benchmark (`docs/BENCHMARK_100_ON_THE_FLY.md`)
Evaluated across **100 distinct cases & situations** comparing **Without AIL (Raw Native Baseline)** vs. **With AIL On-the-Fly (`mode: "twinless"`)**:
- **Pass Rate**: **100 / 100 (100.0%)** with **0 `.ail` files created on disk**
- **Win Rate vs. Without AIL**: **100 / 100 (100.0%)**
- **Total Tokens Without AIL**: **107,421 tokens**
- **Total Tokens With AIL On-the-Fly**: **34,110 tokens**
- **Total Net Tokens Saved**: **73,311 tokens (-68.25% overall reduction, -74.49% mean per-case reduction)**

---

## 7. Twinless On-the-Fly Mode & Smart Multi-File Idioms Specification

In addition to Side-by-Side mode, AIL 2.0 supports **Twinless On-the-Fly Mode** (`"mode": "twinless"` in `ail.config.json`):
1. **Zero `.ail` Files on Disk**: All source files remain in their native target formats (`*.ts`, `*.tsx`, `*.py`, `*.go`, `*.rs`, `*.cpp`, `*.cs`, `*.kt`, `*.php`, `*.css`, `*.html`).
2. **In-RAM Decompilation & `$idiom` Collapsing**: `ail outline <file>` and `ail context <file> [-s <symbol>]` decompile native files in memory and collapse active project `$idioms` on-the-fly.
3. **Smart Multi-File Idioms (`ail idioms scan | read | update | on | off`)**:
   - `ail idioms scan` mines repeated expressions (including nested compound calls) and statement blocks directly from native files via structural anti-unification and stores SHA-256 content-addressed provenance in `.ail-cache/idioms.json`.
   - `ail idioms read $name` reports the idiom template, parameter list, and every `file:line` occurrence with bound call-site arguments across the codebase.
   - `ail idioms update $name "<newTemplate>" [--params <spec>]` rewrites all occurrences across all native files in a single atomic transaction, supporting parameter reordering, duplication, arity reduction/expansion with defaults, capture-avoiding alpha-renaming, recursion cycle detection (`IdiomCycleError`), and atomic multi-file rollback on failure.
4. **Forgiving Direct-to-Native Surgical Splice (`ail splice`)**:
   - Accepts pure AIL, AIL with `$idioms`, raw native target code, or hybrid "Frankenstein" syntax, plus `--body` and `--batch` multi-file atomic splices.
   - Replaces only the exact AST declaration byte-span in the native file, guaranteeing 100% bit-identical preservation of all surrounding comments, decorators, and formatting.

---

## 8. CLI Toolchain & Workflow Specification

The `ail` binary provides a comprehensive CLI for Twinless On-the-Fly workflows, Side-by-Side adoption, live development, compilation, and automated self-repair:

```bash
# Twinless On-the-Fly & Smart Multi-File Idioms
ail shield apply [dir] --twinless    # Configure Twinless mode (zero .ail files on disk)
ail outline <nativeFile> [--stats]   # On-the-fly structural skeleton (85-95% token reduction)
ail context <nativeFile> [-s <sym>]  # On-the-fly dependency & symbol-scoped AIL context with $idioms
ail splice <nativeFile> -s <sym> -c <code> # Direct-to-native surgical AST splice (AIL, $idioms, raw, hybrid)
ail idioms scan [dir]                # Mine multi-file idioms from native code into ail.config.json
ail idioms read '$name' [dir]        # List all file:line occurrences & bound arguments across files
ail idioms update '$name' "<tpl>"    # Atomically rewrite all idiom occurrences across native files
ail idioms <on|off> [dir]            # Toggle on-the-fly $idiom collapsing in ail.config.json

# Side-by-side adoption & live development
ail adopt [dir] [-c <concurrency>]   # Ingests codebase, generates shields, and locks target files
ail watch [dir]                      # Sub-5ms incremental watch daemon preserving HMR
ail dev [dir]                        # Alias for watch
ail eject [dir] [--remove-ail]       # Restores target files to chmod 644 and removes shields
ail shield <apply|remove|status|lock|unlock> [dir]

# Compilation & Decompilation
ail compile <file.ail>               # Compiles single AIL file to target language
ail compile-all [dir]                # Recursively compiles all .ail files across project
ail clean [dir]                      # Cleans generated target files
ail decompile <targetFile>           # Decompiles target file into .ail

# Quality Gates, Benchmarks & Diagnostics
bun run benchmark:100                # Executes the 100-Case Deep Twinless On-the-Fly Benchmark
ail verify <file.ail> [--json]       # Verifies types, immutability, and syntax soundness
ail fix <file.ail> [--dry-run]       # Autonomously self-repairs fixable diagnostics
ail roundtrip <targetFile>           # Verifies Put/Get lens identity (Put(Get(c), Omega) == c)
ail tokens [file|dir]                # Audits token efficiency for a specific file or folder (with subfolders)
ail verify-tokenomics [dir] --check-drift # Audits token savings and enforces zero target drift
ail lsp                              # Starts Language Server Protocol over stdio
ail mcp                              # Starts Model Context Protocol server over stdio
```

