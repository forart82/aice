# Feature TDD Specification: Codex Card, Body, Drawer, Table & Scroll CSS Expansion Guarantee

> **Feature Identifier:** `docs/tdd/codex_card_and_scroll_css_update.tdd.md`  
> **Status:** 100% Green & Verified  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Audit and perfect the CSS in `index.html` to guarantee that ANY card on ANY level that can be opened expands to the 100% full length of its content without height clipping, fixed ceiling boundaries, or nested scrollbars.
- **Target Systems:** `index.html`, `src/ui/screens/HelpScreen.ts`, `src/tests/InteractiveCodexHelpScreen.test.ts`, `src/tests/HelpScreenMobilePolishAndDevChecklist.test.ts`
- **Detailed Requirements:**
  1. **Card & Card Body Expansion Guarantee:**
     - `.codex-card`:
       ```css
       flex: 0 0 auto;
       flex-shrink: 0;
       width: 100%;
       height: auto !important;
       min-height: 60px;
       background: rgba(10, 22, 42, 0.8);
       border: 1px solid rgba(0, 240, 181, 0.25);
       border-radius: 12px;
       margin-bottom: 10px;
       overflow: hidden;
       touch-action: pan-y !important;
       box-sizing: border-box !important;
       transition: border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
       ```
     - `.codex-card.expanded`:
       ```css
       flex: 0 0 auto;
       flex-shrink: 0;
       border-color: #00f0b5;
       box-shadow: 0 0 24px rgba(0, 240, 181, 0.3), 0 8px 32px rgba(0, 0, 0, 0.6);
       background: rgba(10, 22, 42, 0.95);
       height: auto !important;
       max-height: none !important;
       width: 100%;
       margin-top: 6px;
       margin-bottom: 16px;
       ```
     - `.codex-card-body`:
       ```css
       display: none;
       height: auto !important;
       max-height: none !important;
       overflow: visible !important;
       touch-action: pan-y !important;
       padding: 16px !important;
       border-top: 1px solid rgba(0, 240, 181, 0.25);
       background: rgba(6, 14, 28, 0.95);
       font-size: clamp(12px, 2.5vw, 13.5px);
       line-height: 1.5;
       text-align: left;
       color: #e2e8f0;
       box-sizing: border-box !important;
       width: 100% !important;
       ```
  2. **Nested Details, Drawers, and Tables:**
     - `.codex-formula-drawer`, `.codex-formula-drawer[open]`:
       ```css
       height: auto !important;
       max-height: none !important;
       overflow: visible !important;
       overflow-y: visible !important;
       width: 100%;
       ```
     - `.formula-block`:
       ```css
       height: auto !important;
       max-height: none !important;
       overflow: visible !important;
       width: 100%;
       ```
     - `.codex-table-wrap`:
       ```css
       width: 100%;
       height: auto !important;
       overflow-x: auto;
       overflow-y: visible !important;
       margin: 12px 0;
       border-radius: 8px;
       border: 1px solid rgba(0, 240, 181, 0.25);
       box-sizing: border-box;
       ```
     - `.codex-table`, `.cyber-table`:
       ```css
       width: 100%;
       height: auto !important;
       border-collapse: collapse;
       ```
  3. **Single Master Scroll Container:**
     - `.codex-scroll-container`:
       ```css
       flex: 1 1 auto !important;
       min-height: 0 !important;
       overflow-y: auto !important;
       -webkit-overflow-scrolling: touch;
       touch-action: pan-y !important;
       padding: 14px 16px 80px 16px !important;
       ```

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/InteractiveCodexHelpScreen.test.ts`, `src/tests/HelpScreenMobilePolishAndDevChecklist.test.ts`
- **Assertions:**
  1. `index.html` contains `.codex-card` with `height: auto !important;`, `box-sizing: border-box !important;`, `touch-action: pan-y !important;`.
  2. `index.html` contains `.codex-card.expanded` with `height: auto !important;`, `max-height: none !important;`, `border-color: #00f0b5;`.
  3. `index.html` contains `.codex-card-body` with `height: auto !important;`, `max-height: none !important;`, `overflow: visible !important;`, `width: 100% !important;`.
  4. `index.html` contains `.codex-formula-drawer` & `.codex-formula-drawer[open]` with `height: auto !important;`, `max-height: none !important;`, `overflow-y: visible !important;`, `width: 100%;`.
  5. `index.html` contains `.formula-block` with `height: auto !important;`, `max-height: none !important;`, `overflow: visible !important;`, `width: 100%;`.
  6. `index.html` contains `.codex-table-wrap` with `height: auto !important;`, `overflow-y: visible !important;`, `overflow-x: auto;`.
  7. `index.html` contains `.cyber-table` and `.codex-table` with `height: auto !important;` and `width: 100%;`.
  8. `index.html` contains `.codex-scroll-container` with `flex: 1 1 auto !important;`, `min-height: 0 !important;`, `overflow-y: auto !important;`, `-webkit-overflow-scrolling: touch;`, `touch-action: pan-y !important;`, `padding: 14px 16px 80px 16px !important;`.

---

## 3. Implementation Details (Green Phase)

- **Files Modified:**
  - `index.html`: Updated CSS rules for `.codex-card`, `.codex-card.expanded`, `.codex-card-body`, `.codex-formula-drawer`, `.codex-formula-drawer[open]`, `.formula-block`, `.codex-table-wrap`, `.cyber-table`, `.codex-table`, `.codex-scroll-container`.
  - `src/tests/InteractiveCodexHelpScreen.test.ts`: Added/updated unit test assertions validating all CSS rules, DOM expansion guarantees, and single-scroll architecture across all 6 categories and 16 articles.
  - `src/tests/HelpScreenMobilePolishAndDevChecklist.test.ts`: Added/updated unit test assertions validating single-scroll architecture, 80px clearance, and zero nested scroll traps.

---

## 4. Verification & Quality Check

```bash
# Executed Quality Gate:
./verify
```

- **TypeScript Typecheck (`tsc --noEmit`):** 100% PASS (Zero Errors)
- **Vitest Conformance Suites:** 47/47 test files passed, 632/632 unit & conformance tests passed (100% PASS)
- **Vite Production Bundle Build:** 100% PASS
