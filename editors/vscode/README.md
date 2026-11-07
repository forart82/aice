# AICE Language Support for VSCode & Cursor

Official Visual Studio Code and Cursor extension for **AICE (AI Context Engine) 2.0**.

---

## Features

- **Full Syntax Highlighting & Idiom Mining**: Colorizes keywords (`module`, `from`, `import`, `type`, `fn`, `component`, `style`, `let`, `mut`, `val`, `prop`, `class`, `interface`, `enum`, `struct`, `pub`, `ret`, `if`, `match`, `async`, `await`, etc.), types (`int`, `str`, `float`, `bool`, `num`, `Option`, `Result`, `Vec2`, `Vec3`, `Color`, fixed-width ints/floats `i8`..`u64`..`f64`, `Any`), idioms (`$idiom`, `$1`), operators (`::=`, `:=`, `~>`, etc.), CSS properties, strings, numbers, hex colors, and comments (`#`, `//`, `/* */`).
- **Complete LSP Intelligence**:
  - **Diagnostics & Autonomous Self-Repair**: Real-time syntax and type error reports with 1-click QuickFix code action repair.
  - **Hover Cards**: Contextual documentation for keywords, types, and active project idioms (`$idiom`) with token savings metrics.
  - **Autocomplete**: Triggered on `.`, `:`, ` `, and `$` for keywords, types, members, and project idioms.
  - **Document Formatting**: Canonical AST formatting via `textDocument/formatting`.
  - **Document Symbols**: Hierarchical AST outline structure for classes, functions, components, types, and variables.
  - **Go to Definition**: Jump directly to definitions for functions, types, components, and class members.
- **Integrated Toolchain Commands**:
  - `AICE: Compile Current File` (`aice.compile`)
  - `AICE: Start Bidirectional Watch Daemon` (`aice.watch`)
  - `AICE: Sync Target Changes to AICE` (`aice.sync`)
  - `AICE: Show AST Structural Outline` (`aice.outline`)
  - `AICE: Generate Bounded Context Pack` (`aice.context`)
  - `AICE: Scan Project Idioms ($idiom)` (`aice.idiomsScan`)
  - `AICE: Apply Project Idioms ($idiom)` (`aice.idiomsApply`)
  - `AICE: Check 4-Layer AI Shield Status` (`aice.shieldStatus`)
  - `AICE: Lock Target Files (chmod 444)` (`aice.shieldLock`)
  - `AICE: Unlock Target Files (chmod 644)` (`aice.shieldUnlock`)
  - `AICE: Run Symbol-Mapped Test Suite` (`aice.test`)
- **Status Bar Integration**: Clickable `$(zap) AICE` status bar indicator.
- **Configurable Toolchain**: `aice.executablePath` setting to customize the AICE CLI binary path.
- **Target File Associations**: Automatically activates for `.aice`, `.ts.aice`, `.tsx.aice`, `.js.aice`, `.mjs.aice`, `.cjs.aice`, `.py.aice`, `.go.aice`, `.rs.aice`, `.kt.aice`, `.kts.aice`, `.php.aice`, `.cpp.aice`, `.hpp.aice`, `.h.aice`, `.cc.aice`, `.cxx.aice`, `.cs.aice`, `.css.aice`, `.html.aice`, `.twig.aice`, `.json.aice`, `.yaml.aice`, `.yml.aice`.

---

## Installation

### From VSIX Package

1. Package the extension using:
   ```bash
   bun run package:vscode
   ```
2. In VSCode or Cursor:
   - Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on macOS)
   - Type `Extensions: Install from VSIX...`
   - Select `editors/vscode/vscode-aice-1.0.0.vsix`
