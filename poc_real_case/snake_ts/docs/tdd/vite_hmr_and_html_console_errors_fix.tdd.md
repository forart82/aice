# Feature TDD Specification: Vite HMR Dynamic Port & HTML Resource / Font Fallback Fixes

> **Feature Identifier:** `docs/tdd/vite_hmr_and_html_console_errors_fix.tdd.md`  
> **Status:** Green / Refactored  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Eliminate browser console errors and connection issues:
  1. Fix WebSocket connection refused errors (`ws://localhost:3000`) by setting `server.hmr.clientPort: undefined` in `vite.config.ts` so Vite connects to the active dynamic server port when port 3000 is occupied.
  2. Remove 404 network errors in `index.html` from nonexistent `/favicon.png` and `/icon.png` links, relying on the inline SVG data-URI icon.
  3. Ensure all root CSS `font-family` declarations in `index.html` and `emulator.html` include robust system fallbacks (`'Chakra Petch', 'Orbitron', 'Rajdhani', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`).
- **Target Systems:**
  - `vite.config.ts`
  - `index.html`
  - `emulator.html`
  - `src/tests/EmulatorAndHtmlIntegrity.test.ts`

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/EmulatorAndHtmlIntegrity.test.ts`
- **Assertions:**
  1. `index.html` does NOT contain references to `/favicon.png` or `/icon.png`.
  2. `index.html` and `emulator.html` maintain clean inline SVG favicon data-URIs.
  3. `vite.config.ts` contains `hmr: { clientPort: undefined }` within `server` options.
  4. `index.html` and `emulator.html` CSS specify robust system font fallbacks containing `'Chakra Petch', 'Orbitron', 'Rajdhani', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`.

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - `vite.config.ts`: Added `server.hmr.clientPort = undefined`.
  - `index.html`: Removed `<link rel="icon" type="image/png" href="/favicon.png">` and `<link rel="apple-touch-icon" href="/icon.png">`. Updated font-family rules to have full fallback stack.
  - `emulator.html`: Updated body font-family rule to include full fallback stack.
  - `src/tests/EmulatorAndHtmlIntegrity.test.ts`: Added assertions 6, 7, and 8.

---

## 4. Verification & Quality Check

```bash
npx vitest run src/tests/EmulatorAndHtmlIntegrity.test.ts # 8 passed
./verify # 100% Quality Gate PASS
```

