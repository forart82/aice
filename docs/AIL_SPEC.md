# AIL Language Specification (Version 2.0 - BPE-Tuned Standard)

> **Status**: Official Normative Specification  
> **Theoretical Basis**: Intent-Based Intermediate Representation, BPE Token Economics, and Asymmetric Lens Calculus  
> **Target Runtimes**: TypeScript (ES2022/NodeNext/TSX), Python (3.12+), Rust (2021), HTML5/CSS3  

---

## 1. Formal Grammar (EBNF)

AIL uses an **Indentation-Delimited Surface Grammar** backed by a two-stage lexer that converts layout into logical `NEWLINE`, `INDENT`, and `DEDENT` tokens. The grammar is **permissive**: it optionally accepts curly braces `{}` and semicolons `;` when operating in whitespace-sensitive patch environments.

```ebnf
(* Top-level Module *)
Module          ::= "module" ModulePath NEWLINE ModuleItem*
ModulePath      ::= IDENT ("/" IDENT)*
ModuleItem      ::= ImportDecl | TypeDecl | FunctionDecl | ComponentDecl | StyleDecl

(* Imports & Dependencies *)
ImportDecl      ::= "from" STRING "import" (IDENT ("," IDENT)* | "*") NEWLINE

(* Type & Struct Declarations *)
TypeDecl        ::= "type" IDENT TypeParams? ":" (NEWLINE INDENT FieldList DEDENT | InlineFieldList NEWLINE)
                  | "enum" IDENT TypeParams? ":" NEWLINE INDENT EnumVariants DEDENT
TypeParams      ::= "[" IDENT ("," IDENT)* "]"
FieldList       ::= (FieldDecl NEWLINE)+
InlineFieldList ::= FieldDecl ("," FieldDecl)*
FieldDecl       ::= IDENT Sigil? (":" TypeExpr)? ("=" Expr)?
Sigil           ::= "!s" | "!i" | "!f" | "!b" | "!" | "?"
EnumVariants    ::= (IDENT ("(" (TypeExpr ("," TypeExpr)*)? ")")? NEWLINE)+

(* Type Expressions *)
TypeExpr        ::= PrimitiveType
                  | ArrayType
                  | RecordType
                  | ResultType
                  | OptionType
                  | RefinementType
                  | NamedType

PrimitiveType   ::= "str" | "int" | "float" | "num" | "bool" | "byte" | "char" | "void" | "nil"
ArrayType       ::= "[" TypeExpr "]"
RecordType      ::= "{" (IDENT ":" TypeExpr ("," IDENT ":" TypeExpr)*)? "}"
ResultType      ::= "Result" "[" TypeExpr "," TypeExpr "]"
OptionType      ::= TypeExpr "?" | "Option" "[" TypeExpr "]"
RefinementType  ::= "{" IDENT ":" PrimitiveType "|" Expr "}"
NamedType       ::= IDENT ("[" TypeExpr ("," TypeExpr)* "]")?

(* Function Declarations *)
FunctionDecl    ::= "fn" IDENT "(" ParamList? ")" ("->" TypeExpr)? ":" NEWLINE Block
                  | "fn" IDENT "(" ParamList? ")" ("->" TypeExpr)? "=" Expr NEWLINE
ParamList       ::= Param ("," Param)*
Param           ::= IDENT (":" TypeExpr)? ("=" Expr)?

(* Statements & Blocks *)
Block           ::= INDENT Statement+ DEDENT
Statement       ::= LetBinding
                  | ValBinding
                  | MutBinding
                  | AssignStmt
                  | ReturnStmt
                  | ExprStmt
                  | IfStmt
                  | MatchStmt
                  | ForStmt

LetBinding      ::= "let" IDENT (":" TypeExpr)? "=" Expr NEWLINE
ValBinding      ::= "val" IDENT (":" TypeExpr)? "=" Expr NEWLINE
MutBinding      ::= "mut" IDENT (":" TypeExpr)? "=" Expr NEWLINE
AssignStmt      ::= IDENT "=" Expr NEWLINE
ReturnStmt      ::= "ret" Expr? NEWLINE
ExprStmt        ::= Expr NEWLINE  (* Trailing expression in block body acts as implicit return *)

IfStmt          ::= "if" Expr ":" NEWLINE Block ("elif" Expr ":" NEWLINE Block)* ("else" ":" NEWLINE Block)?
MatchStmt       ::= "match" Expr ":" NEWLINE INDENT (MatchCase)+ DEDENT
MatchCase       ::= Pattern "=>" (Expr NEWLINE | NEWLINE Block)
Pattern         ::= Literal | IDENT | IDENT "(" (Pattern ("," Pattern)*)? ")" | "_"

ForStmt         ::= "for" IDENT "in" Expr ":" NEWLINE Block

(* Expressions (Infix Precedence via Pratt Parsing) *)
Expr            ::= BinaryExpr | UnaryExpr | PostfixExpr | PrimaryExpr
PostfixExpr     ::= PrimaryExpr "?"                  (* Try unwrap Result/Option *)
                  | PrimaryExpr "(" ArgList? ")"     (* Call or Positional Struct Constructor *)
                  | PrimaryExpr "." IDENT            (* Property Access *)
                  | PrimaryExpr "[" Expr "]"         (* Indexing *)

BinaryExpr      ::= Expr BinaryOp Expr
BinaryOp        ::= "+" | "-" | "*" | "/" | "%"
                  | "==" | "!=" | "<" | "<=" | ">" | ">="
                  | "and" | "or" | "??"

UnaryExpr       ::= ("not" | "-") Expr

PrimaryExpr     ::= Literal
                  | IDENT
                  | "(" Expr ")"
                  | "[" (Expr ("," Expr)*)? "]"      (* Array Literal *)
                  | "{" (RecordEntry ("," RecordEntry)*)? "}" (* Record Literal with Spread & Shorthand *)
                  | IDENT "(" (Expr ("," Expr)*)? ")" (* Positional Struct Constructor *)
RecordEntry     ::= "..." Expr                       (* Record Spread & Structural Update *)
                  | IDENT (":" Expr)?                (* Supports { key } punning shorthand *)
Literal         ::= NUMBER | STRING | BOOLEAN | NIL | HEX_COLOR

(* Declarative UI Component DSL (56% Token Reduction vs JSX) *)
ComponentDecl   ::= "component" IDENT ("(" ParamList? ")")? ":" NEWLINE INDENT LayoutNode+ DEDENT
LayoutNode      ::= IDENT ("(" AttrList? ")")? (":" (NEWLINE INDENT LayoutNode+ DEDENT | STRING))? NEWLINE
AttrList        ::= Attr ("," Attr)*
Attr            ::= IDENT ("=" Expr)?

(* Style Declarations (Hyper-Dense CSS Property Aliases & Tokens) *)
StyleDecl       ::= "style" StyleSelector ":" (NEWLINE INDENT StylePropList DEDENT | InlineStylePropList NEWLINE)
StyleSelector   ::= IDENT | CLASS_NAME | ID_NAME | PSEUDO_CLASS | STRING
StylePropList   ::= (StyleProperty NEWLINE)+
InlineStylePropList ::= StyleProperty (";" StyleProperty)*
StyleProperty   ::= StylePropName ":" StylePropValue
StylePropName   ::= PropertyAlias | IDENT | CSS_VAR | STRING
PropertyAlias   ::= "bg" | "bgc" | "bkg" | "rad" | "sh" | "disp" | "pos" | "p" | "m"
                  | "w" | "h" | "min-w" | "max-w" | "min-h" | "max-h"
                  | "f" | "fz" | "fw" | "lh" | "ls" | "ta" | "td" | "tt"
                  | "c" | "cur" | "op" | "trans" | "anim" | "b" | "bb" | "bt" | "bl" | "br"
                  | "fl" | "fld" | "flw" | "fls" | "flg" | "jc" | "ai" | "ac" | "gap" | "z"
StylePropValue  ::= HEX_COLOR | NUMBER | IDENT | DIMENSION | COMPOUND_CSS | STRING
```

---

## 2. Canonical Intent Standard Library (CSL)

To eliminate LLM API hallucinations (such as confusing JavaScript's `slice`, `substr`, and `substring`), AIL exposes univalent canonical operations that lower to verified target code:

| Canonical AIL Operation | Semantics | Emitted TypeScript (ES2022) | Emitted Python (3.12+) |
| :--- | :--- | :--- | :--- |
| `str.slice(start, end)` | Half-open $[start, end)$, negative index safe | `str.slice(start, end)` | `str[start:end]` |
| `str.at(index)` | Character at 0-based offset | `str.at(index)` | `str[index]` |
| `str.len` | UTF-8 codepoint length | `str.length` | `len(str)` |
| `str.concat(other)` | Pure string concatenation | `str + other` | `str + other` |
| `str.toInt()` | Fallible parse integer | `parseIntResult(str)` | `int(str)` (guarded) |
| `list.len` | Element count | `list.length` | `len(list)` |
| `list.get(index)` | Option-returning safe lookup | `list.at(index) ?? null` | `list[index] if ... else None` |
| `list.slice(start, end)`| Pure immutable subarray | `list.slice(start, end)` | `list[start:end]` |
| `list.append(item)` | Pure immutable append | `[...list, item]` | `[*list, item]` |
| `list.isEmpty()` | True iff length is 0 | `list.length === 0` | `len(list) == 0` |
| `val?` | Postfix unwrap early return | `if (!res.ok) return res; res.value` | `if not res.get("ok"): return res` |

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
$$\forall c \in C, \quad \text{put}(\text{get}(c), \text{trivia}(c)) \equiv c$$
An unmutated target file decompiled to AIL and re-emitted produces a **byte-for-byte identical file with 0 git diff**.

### 4.2 The Lens Correctness Law (PutGet)
$$\forall a \in A, \forall \omega \in \Omega, \quad \text{get}(\text{put}(a, \omega)) \equiv a$$
Updating the AIL AST and emitting target code preserves all semantic edits when re-read into AIL.

---

## 5. Empirical Tokenomics Benchmarks

Empirical BPE token counts measured via `js-tiktoken` across OpenAI `cl100k_base` (GPT-4 / Claude-class) and `o200k_base` (GPT-4o / Gemini-class) subword vocabularies across all 14 real-world reference codebases:

| File | Target Lang | Target cl100k | AIL cl100k | cl100k Savings | Target o200k | AIL o200k | o200k Savings | Char Savings |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| `gateway_service.go` | Go | 514 | 250 | **-51.4%** | 523 | 257 | **-50.9%** | -51.7% |
| `dashboard_card.tsx` | React TSX | 106 | 47 | **-55.7%** | 112 | 48 | **-57.1%** | -57.5% |
| `auth_service.ts` | TypeScript | 300 | 176 | **-41.3%** | 311 | 182 | **-41.5%** | -47.9% |
| `order_engine.rs` | Rust | 562 | 348 | **-38.1%** | 565 | 353 | **-37.5%** | -45.6% |
| `ecommerce_domain.ts` | TypeScript | 5,429 | 3,594 | **-33.8%** | 5,438 | 3,676 | **-32.4%** | -39.4% |
| `enterprise_portal.html` | HTML5 | 7,102 | 4,899 | **-31.0%** | 7,094 | 4,881 | **-31.2%** | -24.3% |
| `order_processing_service.ts` | TypeScript | 5,834 | 4,299 | **-26.3%** | 5,799 | 4,347 | **-25.0%** | -32.6% |
| `page.html` | HTML5 | 171 | 132 | **-22.8%** | 172 | 132 | **-23.3%** | -12.3% |
| `data_pipeline_models.py` | Python | 4,096 | 3,452 | **-15.7%** | 4,093 | 3,655 | **-10.7%** | -22.5% |
| `stream_processor_engine.py` | Python | 5,048 | 4,281 | **-15.2%** | 4,927 | 4,297 | **-12.8%** | -20.5% |
| `enterprise_theme.css` | CSS3 | 6,297 | 5,380 | **-14.6%** | 6,299 | 5,443 | **-13.6%** | -27.4% |
| `design_system_tokens.css` | CSS3 | 4,097 | 3,511 | **-14.3%** | 4,098 | 3,526 | **-14.0%** | -26.0% |
| `style.css` | CSS3 | 67 | 59 | **-11.9%** | 67 | 59 | **-11.9%** | -31.9% |
| `server.py` | Python | 143 | 130 | **-9.1%** | 146 | 131 | **-10.3%** | -19.3% |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **TOTAL (All 14 Projects)** | **Aggregated** | **39,766** | **30,558** | **-23.2%** | **39,644** | **30,987** | **-21.8%** | **-28.7%** |

---

## 6. Automated Tokenomics CI Quality Gate & Regression Engine

The AIL compiler toolchain provides first-class verification of token savings and target drift via `ail verify-tokenomics`:

```bash
# Verify savings and check for zero target drift:
ail verify-tokenomics examples --check-drift

# Enforce a minimum savings threshold in CI (exits with non-zero code on violation):
ail verify-tokenomics examples --min-savings 20 --check-drift

# Output machine-readable JSON telemetry for automated LLM self-repair:
ail verify-tokenomics examples --json
```

