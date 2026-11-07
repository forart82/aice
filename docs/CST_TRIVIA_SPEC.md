# Concrete Syntax Tree (CST) Trivia Preservation Specification

> **Purpose**: Defines the lossless trivia preservation architecture guaranteeing mathematical satisfaction of the **Stability Law**:  
> $$\text{Put}(\text{Get}(c), c) \equiv c$$

---

## 1. Problem Statement

Standard Abstract Syntax Trees (ASTs) strip away non-semantic tokens:
- Single-line comments: `// ...`, `# ...`
- Multi-line & JSDoc / TSDoc blocks: `/* ... */`, `/** ... */`
- Licensing headers: `SPDX-License-Identifier`, copyright banners
- Indentation styles: tabs vs spaces, 2 vs 4 spaces
- Blank line distributions between declarations

When conventional transpilers re-emit code from an AST, they generate freshly formatted text that wipes out developer comments, copyright notices, and local formatting conventions.

---

## 2. Trivia Architecture in AICE

AICE decouples semantic AST nodes from lexical trivia using a **Node-Indexed Trivia Table**:

```mermaid
flowchart LR
    Source["Original Source (index.ts)"] --> Lexer["Trivia-Aware Lexer"]
    Lexer --> AST["AICE Semantic AST (*.ts.aice)"]
    Lexer --> TriviaTable["CST Trivia Table (*.ts.aice.trivia.json)"]
    
    AST --> Emitter["Bidirectional Lens Emitter"]
    TriviaTable --> Emitter
    Emitter --> Reconstructed["Lossless Reconstruction (index.ts)"]
```

### 2.1 The Trivia Table Schema
Each trivia entry is anchored to an unambiguous structural node path or unique AST node ID:

```typescript
export interface TriviaEntry {
  nodeId: string;                     // e.g. "module.entity[0].fn.name"
  leadingTrivia?: TriviaItem[];       // Comments & formatting before the node
  trailingTrivia?: TriviaItem[];      // Comments & formatting after the node
  indentation?: string;               // e.g. "  " or "    "
  newlineCount?: number;              // Number of blank lines preceding
}

export type TriviaKind = 
  | "LINE_COMMENT" 
  | "BLOCK_COMMENT" 
  | "DOCSTRING" 
  | "LICENSE_HEADER" 
  | "DIRECTIVE";

export interface TriviaItem {
  kind: TriviaKind;
  text: string;
  line: number;
  col: number;
}
```

### 2.2 Inline Trivia Manifest Representation
For single-file compilation where external sidecar files are unwanted, AICE allows embedding the trivia table directly inside the module manifest:

```text
module app/service

trivia:
  "fn:startService":
    leading: "// SPDX-License-Identifier: MIT\n// Core service definition"
    trailing: "// Inline explanation"

fn startService() -> void:
  console.log("Service started")
```


---

## 3. The 4-Step Lossless Synthesis Algorithm

1. **Extraction (`Get: Source -> AICE + Trivia`)**:
   - The language parser identifies all comments and whitespace tokens.
   - Comments preceding an AST statement are bound to `leadingTrivia`.
   - Trailing same-line comments are bound to `trailingTrivia`.
   - The semantic AICE tree is emitted clean and token-dense.

2. **Mutation**:
   - The AI agent or developer edits the AICE file. Node additions generate clean code; unmutated nodes retain their trivia bindings.

3. **Re-insertion (`Put: AICE + Trivia -> Source`)**:
   - The emitter traverses the AICE AST.
   - Before emitting each statement, it outputs `leadingTrivia` with original comment syntax (`//`, `/* */`, or `#`).
   - The emitter formats the statement respecting the recorded indentation style.
   - It appends any `trailingTrivia`.

4. **Identity Verification Gate**:
   - For any unmutated file:
     $$\text{assert}(\text{Put}(\text{Get}(c), \Omega(c)) \equiv c)$$
   - If diff is detected, the verification gate aborts with an AST misalignment trace.

---

## 4. Modern Inlined Comments Architecture & Zero Clutter Standard

In AICE 2.0, all comments (JSDoc, block comments, license headers) are translated and inlined directly into `*.aice` source files as standard `#` comments:

```
src/sim/
├── Boss.ts                  # Read-only target source (chmod 444)
└── Boss.ts.aice              # Authoritative AICE source with inlined comments
```

### Key Principles:
1. **Strict Extension Standard**: Every AICE file strictly ends with `*.aice`. No external `.json` sidecars pollute the project directory.
2. **Direct Human & AI Visibility**: Comments reside directly in `*.aice` where developers and AI models can inspect, understand, and update them naturally.
3. **Clean Ejection**: When running `aice eject --remove-aice`, only `.aice` files need to be pruned.

