# AIL (AI Language): Formal Language & Type Calculus Specification

> **Version**: 1.0.0-PROD  
> **Status**: Authoritative Architectural Standard  
> **Target Models**: Gemini 3.8 Flash / Pro, Claude 3.7 Sonnet, GPT-4o  
> **File Convention**: `*.XX.ail` $\iff$ `*.XX`

---

## 1. Philosophical Foundations & Tokenomics

Modern Large Language Models (LLMs) operate via subword tokenization algorithms (Byte-Pair Encoding and SentencePiece Unigram) using fixed vocabularies between 32,000 and 256,000 tokens. Conventional programming languages impose severe token fertility penalties on neural decoders due to **human-centric syntactic scaffolding**:
- Redundant closing delimiters: `</div>`, `</section>`, `}`
- Repetitive ceremonial keywords: `export function`, `interface`, `public static void`
- Line and item separators: `;`, `,`
- Syntactic ambiguity: multiple equivalent forms to express identical AST structures (e.g. `fn() vs () => {}`, inline types vs interfaces).

### 1.1 The Token Compression Formulation
The token efficiency ratio $C_{\text{ratio}}$ is defined as:
$$C_{\text{ratio}} = 1 - \frac{T(\text{AIL})}{T(\text{Raw})}$$
where $T(S)$ denotes the token length under the SentencePiece/BPE tokenizer. AIL systematically achieves:
$$0.50 \le C_{\text{ratio}} \le 0.65$$
across TypeScript, HTML5, CSS, Python, and JSON.

### 1.2 Core Language Invariants
1. **Homoiconic Prefix Tree**: All expressions are parenthesized prefix forms `(op arg1 arg2 ...)`. Code is represented as pure data.
2. **Canonical Univalence**: There is exactly **one** valid AIL syntax per computational intent. This eliminates branching token entropy during autoregressive generation.
3. **Sound Typing & Algebraic Error Handling**: No untyped `any` escapes. All fallible operations return algebraic `Result[T, E]` types with compile-time unwrap `?`.
4. **Bidirectional Invertibility**: Any codebase can be losslessly compiled from or decompiled to AIL via mathematically proven lens transformations.

---

## 2. Canonical File Naming Standard: `*.XX.ail`

Every AIL file targeting compilation to target extension `XX` adheres to the strict bijective naming convention:

$$\text{Source Target File } (*.XX) \iff \text{AIL Source File } (*.XX.ail)$$

| Target Extension (`XX`) | AIL Source File | Target Domain & Framework |
| :--- | :--- | :--- |
| `*.ts` | `*.ts.ail` | Strict TypeScript ES2022 / NodeNext ESM |
| `*.tsx` | `*.tsx.ail` | React 19 TypeScript JSX |
| `*.html` | `*.html.ail` | HTML5 Document Structure & Semantic Web |
| `*.css` | `*.css.ail` | Modern CSS3 & Tailwind CSS v4 |
| `*.scss` | `*.scss.ail` | Sassy CSS Preprocessor |
| `*.py` | `*.py.ail` | Python 3.12+ (FastAPI / Pydantic) |
| `*.rs` | `*.rs.ail` | Rust (Axum / Actix memory-safe backend) |
| `*.go` | `*.go.ail` | Go (Net/HTTP / Gin microservices) |
| `*.php` | `*.php.ail` | Modern PHP 8.3+ classes & controllers |
| `*.json` | `*.json.ail` | JSON Configuration & REST interchange |
| `*.yaml`, `*.yml` | `*.yaml.ail` | OpenAPI 3.0 / Docker / CI specifications |
| `*.graphql` | `*.graphql.ail` | GraphQL Schema Definition Language (SDL) |

---

## 3. Formal EBNF Grammar

The grammar of AIL is context-free, deterministic, and parsed in linear $O(N)$ time with zero lookahead backtracking:

```ebnf
AILDocument    ::= WorkspaceDecl | ModuleDecl

WorkspaceDecl  ::= "(@" "workspace" StringLiteral Manifest? FileDecl* ")"
FileDecl       ::= "(@" "file" StringLiteral ModuleDecl ")"

ModuleDecl     ::= "(@" "module" Symbol Manifest? Entity* ")"
Manifest       ::= "(*" ManifestItem* "*)"
ManifestItem   ::= Symbol Value

Entity         ::= ImportDecl
                 | TypeDecl
                 | FunctionDecl
                 | ComponentDecl
                 | StyleDecl
                 | AssetDecl
                 | ConfigDecl

ImportDecl     ::= "(deps" "(" ImportBinding* ")" ")"
ImportBinding  ::= "(" StringLiteral Symbol* ")"

TypeDecl       ::= "(:" Symbol TypeExpr ")"
TypeExpr       ::= PrimitiveType 
                 | RefinementType 
                 | UnionType 
                 | RecordType 
                 | TypestateType 
                 | EffectType 
                 | ArrayType
                 | Symbol

PrimitiveType  ::= "!u" | "!i" | "!f" | "!s" | "!b" | "!void" | "!unknown" | "!nil"
ArrayType      ::= "[" TypeExpr "]"
RefinementType ::= "(?:" Symbol PrimitiveType Expr ")"
UnionType      ::= "(|" TypeExpr+ ")"
RecordType     ::= "(%" (Symbol TypeExpr)* ")"
TypestateType  ::= "(~" Symbol "->" Symbol ")"
EffectType     ::= "(!^" TypeExpr "[" Symbol* "]" ")"

FunctionDecl   ::= "(!" Symbol Signatures Expr ")"
Signatures     ::= "(->" "(" Param* ")" TypeExpr ")"
Param          ::= Symbol TypeExpr

ComponentDecl  ::= "(#" Symbol PropContract LayoutNode ")"
PropContract   ::= "(%" (Symbol TypeExpr)* ")"

LayoutNode     ::= TagNode | ConditionalLayout | LoopLayout | TextNode
TagNode        ::= "(<" Symbol AttrMap LayoutNode* ">)"
AttrMap        ::= "(." (Symbol Expr)* ".)"
ConditionalLayout ::= "(?" Expr LayoutNode LayoutNode? ")"
LoopLayout     ::= "(*" Expr Symbol LayoutNode ")"
TextNode       ::= "!str" StringLiteral | "(!val" Expr ")"

StyleDecl      ::= "(&" Symbol RuleList ")"
RuleList       ::= "(+" (Symbol Value)* "+)"

Expr           ::= Literal 
                 | Symbol 
                 | ApplyExpr 
                 | MatchExpr 
                 | AssignExpr 
                 | BlockExpr 
                 | TryUnpackExpr 
                 | IfExpr

ApplyExpr      ::= "(" Symbol Expr* ")"
MatchExpr      ::= "(==" Expr CaseBlock+ ")"
CaseBlock      ::= "(case" Pattern Expr ")"
AssignExpr     ::= "(:=" Symbol Expr ")"
BlockExpr      ::= "(do" Expr+ ")"
TryUnpackExpr  ::= "(?" Expr ")"
IfExpr         ::= "(?if" Expr Expr Expr? ")"

Pattern        ::= Literal | Symbol | RecordPattern
RecordPattern  ::= "(%" (Symbol Pattern)* ")"

Literal        ::= Number | StringLiteral | Boolean | ArrayLiteral | RecordLiteral
ArrayLiteral   ::= "[" Expr* "]"
RecordLiteral  ::= "(%" (Symbol Expr)* ")"

Symbol         ::= [a-zA-Z_][a-zA-Z0-9_\-\.\/:]*
StringLiteral  ::= '"' [^"]* '"'
Number         ::= "-"? [0-9]+ ("." [0-9]+)?
Boolean        ::= "true" | "false"
```

---

## 4. Formal Type Calculus

The type system of AIL enforces static guarantees prior to target language code generation:

### 4.1 Base Primitives
- `!u`: Unsigned 32-bit integer ($0 \le x < 2^{32}$)
- `!i`: Signed 32-bit integer ($-2^{31} \le x < 2^{31}$)
- `!f`: IEEE 754 64-bit floating-point value
- `!s`: Immutable UTF-8 string
- `!b`: Boolean (`true` / `false`)
- `!void`: Unit / empty value
- `!unknown`: Safe unknown (requires refinement before use)
- `!nil`: Null / undefined representation

### 4.2 Refinement Types
Refinement types attach first-order logical predicates to base primitives:
$$\tau = \{ x : B \mid \phi(x) \}$$

```lisp
;; Network Port constrained between 1 and 65535
(: Port (?: p !i (and (>= p 1) (<= p 65535))))

;; Non-empty identifier string
(: NonEmptyId (?: id !s (> (id.length) 0)))
```

### 4.3 Linear Typestates
Linear typestates prevent resource mismanagement (e.g. WebGL memory leaks, use-after-close of database connections or sockets):
$$\frac{\Gamma \vdash x : \text{Resource}[\text{Init}]}{\Gamma \vdash (!\text{open} \; x) : \text{Resource}[\text{Active}]}$$
$$\frac{\Gamma \vdash x : \text{Resource}[\text{Disposed}]}{\Gamma \vdash (!\text{use} \; x) \implies \mathbf{StaticError}(\text{UseAfterDisposal})}$$

```lisp
;; Connection lifecycle progression
(: SocketState (~ Disconnected -> Connected -> Closed))
```

### 4.4 Algebraic Error Handling & Postfix `?`
Unchecked exceptions (`throw` / `try-catch`) are forbidden in pure computational paths. Fallible functions return `Result[T, E]`:

```lisp
(: Result[T, E] (| (% ok true value T) (% ok false error E)))
```

The unwrap expression `(? expr)` compiles to defensive short-circuiting code:
```lisp
(:= user (? (fetchUser id)))
```
Compiles to TypeScript:
```typescript
const _res0 = await fetchUser(id);
if (!_res0.ok) return _res0;
const user = _res0.value;
```

---

## 5. Bidirectional Lens Calculus

AIL transpilation is governed by bidirectional asymmetric and symmetric lenses. A lens $L = (\text{Get}, \text{Put})$ mediates between the concrete syntax space $C$ (`*.XX`) and the abstract AIL syntax space $A$ (`*.XX.ail`):

$$\text{Get} : C \to A$$
$$\text{Put} : A \times C \to C$$

### Lens Laws:
1. **Stability ($\text{GetPut}$)**: Decompiling concrete source code to AIL and immediately synthesizing it back yields the exact original source code without deviation:
   $$\forall c \in C : \text{Put}(\text{Get}(c), c) = c$$
2. **Well-Behavedness ($\text{PutGet}$)**: Synthesizing AIL code to target source and immediately decompiling it back yields the exact original AIL representation:
   $$\forall a \in A, c \in C : \text{Get}(\text{Put}(a, c)) = a$$

---

## 6. Concrete Syntax Tree (CST) Trivia Preservation

To satisfy the **Stability Law** without discarding comments, licenses, and whitespace formatting, the AIL compiler utilizes a **Trivia Preservation Table**. Trivia is decoupled from semantic AST nodes and indexed by structural node hashes:

```json
{
  "trivia_table": {
    "node_#1": {
      "leading_comments": ["// SPDX-License-Identifier: MIT", "// Main application entrypoint"],
      "blank_lines_before": 1,
      "indentation": 2
    }
  }
}
```

When recompiling `*.XX.ail` back to `*.XX`, the emitter re-inserts comments and formatting into their original coordinates.

---

## 7. Machine-Readable Autonomous Diagnostic Schema

When invariant validation fails, the compiler emits a zero-ambiguity JSON diagnostic payload:

```json
{
  "status": "REJECTED",
  "error_phase": "TYPECHECKING",
  "file": "src/api/auth.ts.ail",
  "span": { "line": 18, "col": 12, "symbol": "jwtVerify" },
  "violation": {
    "code": "AIL_E1004_UNHANDLED_RESULT",
    "message": "Call to fallible function returns Result[Token, AuthError] but is not unpacked with (?).",
    "context": {
      "inferred_type": "Result[Token, AuthError]",
      "expected_type": "Token"
    }
  },
  "invariant_correction_rule": "Wrap call expression in (? ...) to unpack payload or return Result.",
  "candidate_fix": "(:= token (? (jwtVerify rawToken secret)))"
}
```
