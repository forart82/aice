# AIL Language Support for VSCode & Cursor

Official Visual Studio Code and Cursor extension for **AIL (Abstract Intermediate Language) 2.0**.

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
  - `AIL: Compile Current File` (`ail.compile`)
  - `AIL: Start Bidirectional Watch Daemon` (`ail.watch`)
  - `AIL: Sync Target Changes to AIL` (`ail.sync`)
  - `AIL: Show AST Structural Outline` (`ail.outline`)
  - `AIL: Generate Bounded Context Pack` (`ail.context`)
  - `AIL: Scan Project Idioms ($idiom)` (`ail.idiomsScan`)
  - `AIL: Apply Project Idioms ($idiom)` (`ail.idiomsApply`)
  - `AIL: Check 4-Layer AI Shield Status` (`ail.shieldStatus`)
  - `AIL: Lock Target Files (chmod 444)` (`ail.shieldLock`)
  - `AIL: Unlock Target Files (chmod 644)` (`ail.shieldUnlock`)
  - `AIL: Run Symbol-Mapped Test Suite` (`ail.test`)
- **Status Bar Integration**: Clickable `$(zap) AIL` status bar indicator.
- **Configurable Toolchain**: `ail.executablePath` setting to customize the AIL CLI binary path.
- **Target File Associations**: Automatically activates for `.ail`, `.ts.ail`, `.tsx.ail`, `.js.ail`, `.mjs.ail`, `.cjs.ail`, `.py.ail`, `.go.ail`, `.rs.ail`, `.kt.ail`, `.kts.ail`, `.php.ail`, `.cpp.ail`, `.hpp.ail`, `.h.ail`, `.cc.ail`, `.cxx.ail`, `.cs.ail`, `.css.ail`, `.html.ail`, `.twig.ail`, `.json.ail`, `.yaml.ail`, `.yml.ail`.

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
   - Select `editors/vscode/vscode-ail-1.0.0.vsix`
