# AIL: AI Language & Bidirectional Compiler Engine

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![TypeScript 5.8+](https://img.shields.io/badge/TypeScript-5.8%2B-blue)](https://www.typescriptlang.org/)
[![Node.js 22/24](https://img.shields.io/badge/Node.js-22%20%7C%2024-green)](https://nodejs.org/)
[![Vitest](https://img.shields.io/badge/Vitest-3.0%2B-yellow)](https://vitest.dev/)
[![Biome](https://img.shields.io/badge/Biome-2.5-orange)](https://biomejs.dev/)

> **A token-efficient, strongly-typed, homoiconic S-expression language and bidirectional compiler engineered for autonomous AI code generation, zero-loss roundtripping, and deep semantic debugging.**

---

## 🚀 The `*.XX.ail` Standard

Every AIL file targeting a specific programming or markup language adheres to the strict bijective standard:

$$\text{Source Target File } (*.XX) \iff \text{AIL Source File } (*.XX.ail)$$

```
my-project/
├── src/
│   ├── index.ts               <--->   index.ts.ail       (TypeScript ES2022)
│   ├── App.tsx                <--->   App.tsx.ail        (React 19 JSX)
│   └── styles.css             <--->   styles.css.ail     (CSS3 / Tailwind v4)
├── public/
│   └── index.html             <--->   index.html.ail     (HTML5 Document)
├── server/
│   ├── main.py                <--->   main.py.ail        (Python FastAPI)
│   └── handler.go             <--->   handler.go.ail     (Go compiled service)
└── config/
    └── settings.json          <--->   settings.json.ail  (JSON Configuration)
```

---

## ⚡ Key Architectural Advantages

1. **50% – 65% Token Compression**:
   Eliminates closing XML/HTML tags (`</div>`), curly braces (`}`), line terminators (`;`), commas (`,`), and boilerplate keywords (`function`, `interface`).
2. **Homoiconic S-Expressions**:
   Code is represented as a pure prefix syntax tree `(op arg1 arg2 ...)`. AI models avoid delimiter mismatch and syntax hallucinations.
3. **Sound Static Typing & Refinement Calculus**:
   Compile-time bounded arithmetic predicates `(?: p !i (and (>= p 1) (<= p 65535)))`, linear typestates `(~ Open -> Closed)`, and algebraic effect tracking `[!io, !dom]`.
4. **Algebraic Error Handling**:
   Replaces unchecked `try/catch` with `Result[T, E]` and compile-time postfix unwrap `?`.
5. **Lossless Bidirectional Lenses with CST Trivia Preservation**:
   Comments, docstrings, formatting, and licensing headers are preserved in a CST Trivia Table, mathematically guaranteeing:
   $$\text{Put}(\text{Get}(c), c) \equiv c$$
6. **Structured Machine-Readable Diagnostics**:
   Emits zero-ambiguity JSON diagnostic telemetry with exact line/column spans, failing invariants, and candidate fixes for automated 1-step AI self-repair.

---

## 💻 CLI Commands

The `ail` compiler is globally accessible via terminal:

### 1. Single-File Compilation & Decompilation
```bash
# Compile AIL file to target language:
ail compile src/index.ts.ail       # Emits: src/index.ts
ail compile public/index.html.ail  # Emits: public/index.html

# Decompile target language file into AIL:
ail decompile src/index.ts         # Emits: src/index.ts.ail
ail decompile public/index.html    # Emits: public/index.html.ail
```

### 2. Whole-Project Recursive Compilation & Decompilation
```bash
# Compile all *.XX.ail files across a project folder:
ail compile-all ./src

# Decompile all target files in a project into *.XX.ail:
ail decompile-all ./src

# Live continuous hot-reloading:
ail compile-all ./src --watch
```

### 3. Static Invariant Verification & Diagnostics
```bash
# Verify type, typestate, and refinement invariants:
ail verify src/index.ts.ail

# Output machine-readable JSON telemetry for AI agents:
ail verify src/index.ts.ail --json
```

### 4. Mathematical Lens Proof & Tokenomics Benchmarking
```bash
# Run bidirectional lens identity verification (Put(Get(c), c) == c):
ail roundtrip-test ./src

# Benchmark BPE / SentencePiece token savings:
ail benchmark src/index.ts
```

---

## 📚 Documentation
- [**AIL Formal Specification & Type Calculus**](docs/AIL_SPEC.md)
- [**AI Agent System Prompt (Gemini / Claude / GPT)**](docs/AI_SYSTEM_PROMPT.md)
- [**CST Trivia Preservation Specification**](docs/CST_TRIVIA_SPEC.md)

---

## 🛠️ Development & Testing

```bash
# Run unit & property-based tests:
npm test

# Run strict typecheck:
npm run check

# Format & Lint with Biome:
npm run lint
```
