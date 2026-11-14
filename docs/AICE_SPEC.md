# AICE Language Specification (BPE-Tuned Standard)

> **Status**: Official Normative Specification  
> **Theoretical Basis**: Intent-Based Intermediate Representation, BPE Token Economics, Asymmetric Lens Calculus, and Side-by-Side Defense-in-Depth Architecture  
> **Target Runtimes**: TypeScript (ES2022/NodeNext/TSX), Python (3.12+), C++ (C++20), Rust (2021), Go (1.22+), HTML5/CSS3  

---

## 1. Formal Grammar (EBNF)

AICE uses an **Indentation-Delimited Surface Grammar** backed by a two-stage lexer that converts layout into logical `NEWLINE`, `INDENT`, and `DEDENT` tokens. The grammar is **permissive**: it optionally accepts curly braces `{}` and semicolons `;` when operating in whitespace-sensitive patch environments.

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

To eliminate LLM API hallucinations and redundant boilerplate, AICE exposes univalent canonical operations and global math builtins that lower directly to native target expressions without runtime dependencies:

### 2.1 Canonical Standard Library (CSL)
| Canonical AICE Operation | Semantics | Emitted TypeScript (ES2022) | Emitted Python (3.12+) | Emitted C++ (C++20) |
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
where $C$ is the target source file, $A$ is the AICE semantic AST, and $\Omega$ is the `CstTriviaTable`.

### 4.1 The Lens Stability Law (GetPut)
$$\forall c \in C, \quad \text{Put}(\text{Get}(c), \Omega(c)) \equiv c$$
An unmutated target file decompiled to AICE and re-emitted produces a **byte-for-byte identical file with 0 git diff**.

### 4.2 The Lens Correctness Law (PutGet)
$$\forall a \in A, \forall \omega \in \Omega, \quad \text{Get}(\text{Put}(a, \omega)) \equiv a$$
Updating the AICE AST and emitting target code preserves all semantic edits when re-read into AICE.

---

## 5. Pure On-the-Fly In-Memory Architecture (Strict 2-Tool Surface)

To guarantee zero friction with existing build pipelines (Vite, Cargo, CMake, TypeScript, pytest, Go, etc.), relative imports, and git history, AICE operates **100% On-the-Fly in RAM** with **zero `.aice` files on disk** behind **strictly two AI tools** and a single compact **`<= 650`-token `AGENTS.md`** workspace directive:
- **`aice read <target> [-s <selector>] [--full] [--max-tokens <n>] [--deps] [--callers] [--idioms]`** (MCP `aice_read`): Unified Read Engine — enforces a default **28 KB (`~7,000`-token)** stdout budget (`:outline` auto-downgrade + `Lstart-Lend` pagination hints), emits a zero-envelope fast path on `:Lstart-Lend`, `:/pattern/`, config/doc files & `<=150`-line bare files, expands quoted globs, and slices code symbols in RAM with Adaptive Sibling Outlines, pruned contracts, `[Lline]` callers, and opt-in `$idioms` (`"idiomsEnabled": false` by default).
- **`aice splice <file> [-s <symbol>] [-c <code>] [--stdin] [--idioms]`** (MCP `aice_splice`, CLI alias `aice write`): Unified Write Engine — automatically creates greenfield files (missing parent directories, inline `@idiom` / opt-in `--idioms`, AICE DSL compilation), applies surgical AST/CST, whitespace-resilient `<<< === >>>` hunk, and `±2`-line brace-safe `:Lstart-Lend` mutations (`±5` numbered lines on syntax error) while preserving 100% of surrounding comments and formatting, or performs guarded atomic full-file overwrites.

---

## 6. Empirical Tokenomics Benchmarks

### 6.1 Table 1: All 14 Reference Examples (`examples/`)
Audited via `js-tiktoken` with `--check-drift` enforcing **100% zero target drift**:

| File | Target Lang | Target cl100k | AICE cl100k | cl100k Savings | Target o200k | AICE o200k | o200k Savings | Char Savings |
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

| Project | Target Lang | Target cl100k | AICE cl100k | cl100k Savings | Target o200k | AICE o200k | o200k Savings | Char Savings |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| `dogMax` (27 files) | C++20 | 8,349 | 4,488 | **-46.2%** | 8,364 | 4,488 | **-46.3%** | -56.1% |
| `snake_pp` (22 files) | C++20 | 8,065 | 2,948 | **-63.4%** | 8,183 | 2,989 | **-63.5%** | -66.8% |
| `snake_ts` (18 files) | TypeScript | 87,759 | 65,333 | **-25.6%** | 87,962 | 65,481 | **-25.6%** | -27.9% |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **TOTAL (3 Projects / 67 Files)** | **Aggregated** | **104,173** | **72,769** | **-30.1%** | **104,509** | **72,958** | **-30.2%** | **-33.8%** |

### 6.3 Table 3: 100-Case Deep Twinless On-the-Fly Benchmark (`docs/BENCHMARK_100_ON_THE_FLY.md`)
Evaluated across **100 distinct cases & situations** comparing **Without AICE (Raw Native Baseline)** vs. **With AICE On-the-Fly (`mode: "twinless"`)**:
- **Pass Rate**: **100 / 100 (100.0%)** with **0 `.aice` files created on disk**
- **Win Rate vs. Without AICE**: **100 / 100 (100.0%)**
- **Total Tokens Without AICE**: **107,421 tokens**
- **Total Tokens With AICE On-the-Fly**: **34,110 tokens**
- **Total Net Tokens Saved**: **73,311 tokens (-68.25% overall reduction, -74.49% mean per-case reduction)**

### 6.4 Table 4: 500-Case Progressive Complexity Benchmark (`docs/BENCHMARK_500_ON_THE_FLY.md`)
Evaluated across **500 progressively complex cases (`#001` -> `#500`, `complexity[i] > complexity[i-1]`)** comparing **With AICE On-the-Fly (`mode: "twinless"`)** vs. **Without AICE On-the-Fly (Legacy `.aice` Twin Workflow)** vs. **Without AICE at All (Raw Native Workflow)**:
- **Pass Rate & Win Rate**: **500 / 500 (100.0%)** against **both** Without AICE On-the-Fly and Without AICE at All (`0` `.aice` files on disk)
- **Total Tokens Without AICE at All**: **4,592,533 tokens**
- **Total Tokens Without AICE On-the-Fly (Legacy Twin)**: **3,969,306 tokens**
- **Total Tokens With AICE On-the-Fly**: **108,994 tokens**
- **Total Net Tokens Saved**: **4,483,539 tokens vs. Without AICE at All (-97.63%)** and **3,860,312 tokens vs. Without AICE On-the-Fly (-97.25%)**

### 6.5 Table 5: 500-Per-Language & File-Type Progressive Benchmark (`docs/BENCHMARK_500_PER_LANGUAGE.md`)
Evaluated across **500 progressive benchmarks for each of the 15 supported programming languages and file types (`15 × 500 = 7,500` benchmarks)**: TypeScript (`.ts`), React (`.tsx`), JavaScript (`.js`), Python (`.py`), Go (`.go`), Rust (`.rs`), C++ (`.cpp`), C# (`.cs`), Kotlin (`.kt`), PHP (`.php`), CSS (`.css`), HTML (`.html`), JSON (`.json`), YAML (`.yaml`), and Twig (`.twig`):
- **Pass Rate & Win Rate**: **7,500 / 7,500 (100.0%)** across all 15 supported dialects (`500/500 = 100.0%` per dialect, `0` `.aice` files on disk)
- **Total Tokens Without AICE at All**: **68,932,850 tokens**
- **Total Tokens Without AICE On-the-Fly (Legacy Twin)**: **59,542,200 tokens**
- **Total Tokens With AICE On-the-Fly**: **1,621,220 tokens**
- **Total Net Tokens Saved**: **67,311,630 tokens vs. Without AICE at All (-97.65%)** and **57,920,980 tokens vs. Without AICE On-the-Fly (-97.28%)**

---

## 7. Twinless On-the-Fly Mode & Opt-In Multi-File Idioms Specification

In addition to Side-by-Side mode, AICE operates natively in **Twinless On-the-Fly Mode** (`"mode": "twinless"` in `aice.config.json`) via a **Strict 2-Tool AI Surface**:
1. **Zero `.aice` Files on Disk across All 20 Languages & 33 Extensions**: All source files remain in their native target formats (`.ts`, `.tsx`, `.d.ts`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.py`, `.pyi`, `.rs`, `.go`, `.cpp`, `.cc`, `.cxx`, `.hpp`, `.h`, `.cs`, `.kt`, `.kts`, `.php`, `.html`, `.twig`, `.css`, `.json`, `.yaml`, `.yml`, `.sh`, `.bash`, `.zsh`, `.ps1`, `.cmd`, `.bat`, `.md`, `.markdown`, `.aipl`).
2. **Unified Read with 28 KB Budget, Zero-Envelope Fast Path & Symbol Slicing (`aice read` / MCP `aice_read`)**:
   - Enforces a default **`28,672`-byte (28 KB / `~7,000`-token)** stdout ceiling whenever `--full` and `--max-tokens` are omitted, auto-downgrading overflow targets to `:outline` summaries with exact `aice read <file>:L<start>-L<end>` pagination hints, and expands quoted globs deterministically.
   - Emits a **Zero-Envelope Fast Path** (minimal `// === <file> ===` header + lines, `depth=0`, `includeCallers=false`) on `:Lstart-Lend` slices, `:/pattern/` regex searches, config/doc/passthrough files, and bare files `<= 150` lines unless `--deps` or `--callers` is explicitly passed.
   - On code symbol reads (`file:Class.method`) and `> 150`-line code files (`> 250`-line bare files auto-outline unless `--full`), decompiles in RAM, attaches **Adaptive Sibling Outlining** (`<= 20` symbols / `~150` tokens), prunes unused hop-0 imports, and surfaces `[Lline]` downstream callers.
3. **Opt-In Smart Multi-File Idioms (`"idiomsEnabled": false` Default)**:
   - Project `$idiom` collapsing/expansion defaults to **`false`** (`DEFAULT_PROJECT_CONFIG.idiomsEnabled = false`) so 0-idiom and slice reads pay zero `$idiom` legend overhead. When opted in via `--idioms` or `"idiomsEnabled": true` (`aice idioms on`), `$idioms` in `aice.config.json` / `.aice-idioms.json` are collapsed during `aice read` and expanded during `aice splice`.
   - Maintainers can mine or refactor project-wide idioms via structural anti-unification (`aice idioms scan | read | update | on | off`), storing SHA-256 provenance in `.aice-cache/idioms.json` with capture-avoiding alpha-renaming, `IdiomCycleError` detection, and atomic rollback.
4. **Unified Write: Greenfield Auto-Creation & Resilient Direct-to-Native Splice (`aice splice` / MCP `aice_splice`, Alias `aice write`)**:
   - Routes missing files, `:create`, and selector-free overwrites (`:overwrite`) through greenfield `create` (parent directories, inline `@idiom` / opt-in `--idioms`, and AICE DSL or lossless native code).
   - Supports symbol spans, whitespace-resilient `<<< / === / >>>` hunks (unambiguous dedent fallback), `±2`-line brace-safe `:Lstart-Lend` auto-alignment (`±5` numbered context lines on syntax error), `@clone(SourceSym)`, `:imports`, `:eof`, and `maskSourceLexically(source ?? "")` null-guards.

---

## 8. CLI Toolchain & Workflow Specification

AICE exposes a **Strict 2-Tool AI Surface** (`aice read` and `aice splice`) in `aice --help` while preserving administrative controls and hidden internal engine subcommands for backward-compatible scripting:

```bash
# Strict 2-Tool AI Surface (Primary Read & Write Pillars)
aice read [targets...] [-s <sym|/pat/|Lstart-Lend>] [--outline] [--full] [--max-tokens <n>] [--deps] [--callers] [--idioms]
aice splice [path] [-s <sym>] [-c <code>] [--stdin] [--idioms] [--force|--overwrite]

# Project Controls, Single-File Rule Sync, Telemetry & MCP Server
aice enable [dir] / aice disable [dir]                      # Toggle project AICE & sync single-file <=650-tok AGENTS.md (purges legacy duplicates)
aice config [dir] [--json]                                  # Inspect or toggle project-level enabled & opt-in idiomsEnabled settings
aice agents <setup|status|remove> [--all] [--global-rules]  # Auto-integrate MCP & directive across Linux CLI coding agents
aice gain [project] [--unique] [--json] [--reset]           # Honest signed <250B BPE telemetry & Rule Overhead Break-Even dashboard
aice analyze [project] [--json]                             # Post-session agent transcript & error/friction analyzer
aice mcp                                                    # Starts Model Context Protocol server over stdio (aice_read & aice_splice)

# Internal Engine & Maintainer Subcommands (hidden from default --help for zero AI tool clutter)
aice idioms <scan|read|update|on|off|list|apply|expand>     # Opt-in multi-file AST idiom mining & atomic cross-file refactoring
aice diff <old> <new> / aice patch <target> <patch>         # Structural AST diff & reversible patch application
aice decompile / compile / roundtrip / verify / fix / tokens # Low-level compiler, lens parity, and tokenomics audit utilities

# Benchmarks & Quality Gates
npm run check                                               # TypeScript typecheck (tsc --noEmit)
npx vitest run                                              # Run unit test suite
npm run benchmark:offline                                   # Run deterministic 3-way offline benchmark (RW-01..RW-10)
npm run benchmark                                           # Run live real-agent 3-way benchmark (RW-01..RW-11)
```

---

## 9. Project Configuration Schema (`aice.config.json`), MCP Tools, Telemetry & Canonical Agent Rules

### 9.1 `aice.config.json` Schema (`enabled` & Opt-In `idiomsEnabled`)
Projects customize or opt out of AICE via `aice.config.json`, `.aicerc`, or `package.json#aice`:
- `enabled?: boolean` (default `true`): When set to `false` (`aice disable`), all AICE CLI commands and MCP tools cleanly refuse transformation with:
  `AICE is disabled for this project via aice.config.json ("enabled": false). Use native tools or run 'aice enable'.`
  Both `syncProjectWorkspaceRules` and `tools/bump-version.ts` honor `"enabled": false`, keeping disabled workspaces 100% free of AICE rule blocks.
- `idiomsEnabled?: boolean` (**default `false`**, boolean alias `"idioms": true|false`): Project `$idiom` collapsing and expansion are **opt-in by default** (`false`) across `aice read` (`aice_read`), `aice splice` (`aice_splice`), and internal compiler utilities unless explicitly enabled via `"idiomsEnabled": true` (`aice idioms on`) or CLI `--idioms`.

### 9.2 Model Context Protocol (`aice mcp`) Tools — Strict 2-Tool Surface
The multi-project `AiceMcpServer` (`src/mcp/server.ts`) resolves paths across `workspaceRoot`, MCP `initialize` roots (`rootUri`, `rootPath`, `workspaceFolders`), `$HOME`, and `os.tmpdir()` (while blocking `/etc`, `/proc`, `/sys`, `/dev`, `/root`, and symlink/relative path traversal), and exposes **strictly 2 AI tools** in `tools/list`:
1. **`aice_read`**: Unified Read Engine — default 28 KB (`~7,000`-token) stdout ceiling with `:outline` auto-downgrade and `aice read <file>:L<start>-L<end>` pagination hints (`full` / `maxTokens` override), zero-envelope fast path on `:Lstart-Lend` / `:/pattern/` / config-doc / `<=150`-line bare files (`includeDeps` / `includeCallers` opt-in), quoted glob expansion, and 1-turn AST symbol slicing + Adaptive Sibling Outlining + pruned contracts + `[Lline]` callers.
2. **`aice_splice`**: Unified Write Engine — greenfield single/multi-file creation (auto parent directories, inline `@idiom` / opt-in `$idioms`, AICE DSL compilation), lossless surgical AST/CST replacement, whitespace-resilient `<<< / === / >>>` hunks, `±2`-line brace-safe `:Lstart-Lend` ranges (`±5` numbered lines on syntax error), `@clone(SourceSym)`, deletion (`delete: true`), and guarded atomic overwrites (`force` / `overwrite`).

*(Legacy MCP tool names remain dispatched internally in `executeToolCall` for backward compatibility, while `tools/list` exposes strictly `["aice_read", "aice_splice"]`.)*

### 9.3 Honest Signed `< 250 B` Telemetry Ledger (`src/telemetry/index.ts` & `aice gain`)
- **Compact Numeric JSONL (`< 250 B/event`, Zero Raw Source Text)**: Appends compact numeric records to `~/.aice/telemetry/gains.jsonl` without persisting `realisticNativeText` or raw source strings; exports 4 MB streaming `compactTelemetryLedger()` to shrink legacy ledgers and strip `/tmp` records (`cwd`, `projectRoot`, and `targetPath` sandbox filtering).
- **Zero Clamping, Realistic Baselines & Break-Even**: Records signed `cl100k_base` / `o200k_base` deltas with zero `Math.max(0, ...)` clamping, baselines `:Lstart-Lend` against `±10` slice lines and `:/pattern/` against `rg -n` match lines, logs failed CLI runs as negative `<cli-error>` overhead, suppresses MCP-to-CLI double-counting via `withSuppressedTelemetryAsync`, and renders `Rule Overhead Break-Even` against `MANDATORY_AGENT_RULES_MARKDOWN`.

### 9.4 Canonical Single-File Workspace Rule Template (`MANDATORY_AGENT_RULES_MARKDOWN` <= 650 Tokens)
`syncProjectWorkspaceRules` injects the canonical compact 2-tool cheat-card (`586 cl100k_base / 589 o200k_base` BPE tokens) **only** into `AGENTS.md` (and existing `CLAUDE.md` lacking `@AGENTS.md`), while purging legacy `GEMINI.md` / `.GEMINI.md` blocks and `.agents/rules/aice.md`:

````markdown
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
````