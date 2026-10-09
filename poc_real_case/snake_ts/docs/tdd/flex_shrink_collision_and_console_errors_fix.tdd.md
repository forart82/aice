# Feature TDD Specification: Flex-Shrink Collision & Console Errors Fix

> **Feature Identifier:** `docs/tdd/flex_shrink_collision_and_console_errors_fix.tdd.md`  
> **Status:** 100% Green & Verified  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Fix flexbox item collision / unexpected shrinking when expanding cards inside `.codex-scroll-container` by enforcing non-shrinking flex styles (`flex: 0 0 auto !important; flex-shrink: 0 !important;`) on `.codex-card`, `.codex-card.expanded`, and `.codex-hub-card`. Eliminate console errors (404 favicon and font preload/display warnings) by adding inline SVG data-URI favicons and ensuring `display=swap` on Google Font links in both `index.html` and `emulator.html`.
- **Target Files:**
  - `index.html`
  - `emulator.html`
  - `src/tests/InteractiveCodexHelpScreen.test.ts`
  - `src/tests/HelpScreenMobilePolishAndDevChecklist.test.ts`
  - `src/tests/EmulatorAndHtmlIntegrity.test.ts`

- **Detailed Requirements:**
  1. **Flexbox Flow & Non-Shrinking Card Expansion:**
     - In `index.html`, `.codex-card` has:
       ```css
       flex: 0 0 auto !important;
       flex-shrink: 0 !important;
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
     - In `index.html`, `.codex-card.expanded` has:
       ```css
       flex: 0 0 auto !important;
       flex-shrink: 0 !important;
       border-color: #00f0b5;
       box-shadow: 0 0 24px rgba(0, 240, 181, 0.3), 0 8px 32px rgba(0, 0, 0, 0.6);
       background: rgba(10, 22, 42, 0.95);
       height: auto !important;
       max-height: none !important;
       width: 100%;
       margin-top: 6px;
       margin-bottom: 16px;
       ```
     - In `index.html`, `.codex-hub-card` has:
       ```css
       flex: 0 0 auto !important;
       flex-shrink: 0 !important;
       min-height: 76px;
       height: auto !important;
       ...
       ```
     - Ensure `.codex-scroll-container` has:
       `display: flex !important; flex-direction: column !important; flex: 1 1 auto !important; min-height: 0 !important; overflow-y: auto !important; -webkit-overflow-scrolling: touch; padding: 14px 16px 80px 16px !important; box-sizing: border-box !important;`
     - Ensure `.codex-card-body` has:
       `height: auto !important; max-height: none !important; overflow: visible !important; width: 100% !important; padding: 16px !important; box-sizing: border-box !important;`
  2. **Eliminate Console Errors (Favicon 404 & Font Preload Fallbacks):**
     - In both `index.html` and `emulator.html`, add the inline SVG favicon:
       `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🐍</text></svg>">`
     - In Google Font `<link>` tags, ensure `display=swap` is present.

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suites:**
  - `src/tests/InteractiveCodexHelpScreen.test.ts`
  - `src/tests/HelpScreenMobilePolishAndDevChecklist.test.ts`
  - `src/tests/EmulatorAndHtmlIntegrity.test.ts`
- **Assertions:**
  1. `index.html` defines `.codex-card` with `flex: 0 0 auto !important;` and `flex-shrink: 0 !important;`.
  2. `index.html` defines `.codex-card.expanded` with `flex: 0 0 auto !important;` and `flex-shrink: 0 !important;`.
  3. `index.html` defines `.codex-hub-card` with `flex: 0 0 auto !important;` and `flex-shrink: 0 !important;` and `height: auto !important;`.
  4. `index.html` defines `.codex-scroll-container` with `display: flex !important;`, `flex-direction: column !important;`, `flex: 1 1 auto !important;`, `min-height: 0 !important;`, `overflow-y: auto !important;`, `-webkit-overflow-scrolling: touch;`, `padding: 14px 16px 80px 16px !important;`, `box-sizing: border-box !important;`.
  5. `index.html` defines `.codex-card-body` with `height: auto !important;`, `max-height: none !important;`, `overflow: visible !important;`, `width: 100% !important;`, `padding: 16px !important;`, `box-sizing: border-box !important;`.
  6. `index.html` contains inline SVG favicon `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🐍</text></svg>">`.
  7. `emulator.html` contains inline SVG favicon `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🐍</text></svg>">`.
  8. Google font link tags in `index.html` and `emulator.html` contain `display=swap`.

---

## 3. Implementation Details (Green Phase)

- `index.html`:
  - Added inline SVG data-URI favicon.
  - Verified `display=swap` on Google Fonts link tag.
  - Updated `.codex-card` and `.codex-card.expanded` with `flex: 0 0 auto !important; flex-shrink: 0 !important;`.
  - Updated `.codex-hub-card` with `flex: 0 0 auto !important; flex-shrink: 0 !important; height: auto !important;`.
  - Enforced `display: flex !important; flex-direction: column !important;` on `.codex-scroll-container`.
  - Confirmed `.codex-card-body` retains `height: auto !important; max-height: none !important; overflow: visible !important; width: 100% !important; padding: 16px !important; box-sizing: border-box !important;`.
- `emulator.html`:
  - Added inline SVG data-URI favicon `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🐍</text></svg>">`.
  - Verified `display=swap` on Google Fonts link tag.
- `src/tests/EmulatorAndHtmlIntegrity.test.ts`:
  - Created conformance test suite verifying SVG favicons, `display=swap`, non-shrinking flex styles, and scroll container bounds.
- `src/tests/InteractiveCodexHelpScreen.test.ts` & `src/tests/HelpScreenMobilePolishAndDevChecklist.test.ts`:
  - Updated CSS assertion matches to expect `!important` on `flex: 0 0 auto` and `flex-shrink: 0`.

---

## 4. Verification & Quality Check

```bash
./verify
```

- **TypeScript Typecheck (`tsc --noEmit`):** 100% PASS (Zero Errors)
- **Vitest Conformance Suites:** 48/48 test files passed, 637/637 unit & conformance tests passed (100% PASS)
- **Vite Production Bundle Build:** 100% PASS
