# AIL Language Support for VSCode & Cursor

Official Visual Studio Code and Cursor extension for **AIL (Abstract Intermediate Language) 2.0**.

---

## Features

- **Full Syntax Highlighting**: Colorizes keywords (`module`, `from`, `import`, `type`, `fn`, `component`, `style`, `let`, `mut`, `ret`, `if`, `match`), types (`int`, `str`, `float`, `bool`, `num`, `Option`, `Result`), CSS properties, strings, numbers, hex colors, and comments (`#`, `//`, `/* */`).
- **Indentation & Block Handling**: Automatic 2-space indentation upon pressing Enter after `:` on function, type, component, style, and control flow blocks.
- **Bracket Matching & Auto-Closing**: Smart auto-closing for parentheses, square brackets, curly braces, and string quotes.
- **Productivity Snippets**: Instant template snippets for `fn`, `fne` (single-expression functions), `type`, `comp` (UI component layout), `style`, `if`, `match`, and `module`.
- **Target File Associations**: Automatically activates for `.ail`, `.ts.ail`, `.tsx.ail`, `.py.ail`, `.html.ail`, and `.css.ail`.

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
