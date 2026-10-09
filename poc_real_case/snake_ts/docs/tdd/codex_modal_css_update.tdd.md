# Feature TDD Specification: Codex Modal CSS Polish, Scrollable Card Content & Section Bottom Clearance

> **Feature Identifier:** `docs/tdd/codex_modal_css_update.tdd.md`  
> **Status:** Green (100% Verified)  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Update `.codex-card-body`, `.codex-modal`, `.codex-body-section`, `.codex-tips-block`, `.codex-table-wrap`, and `.codex-card.expanded` in `index.html` to provide scrollable opened card content with full visibility, sleek custom scrollbars, and proper bottom clearance for all nested tables and sections.
- **Target Systems:** Presentation CSS layer (`index.html`), Codex HelpScreen UI (`src/ui/screens/HelpScreen.ts`), and test suites (`InteractiveCodexHelpScreen.test.ts`, `HelpScreenMobilePolishAndDevChecklist.test.ts`).
- **Requirements Matrix:**
  1. **Scrollable Opened Card Content with Full Visibility**:
     - `.codex-card-body`:
       ```css
       display: none;
       max-height: 60vh !important;
       max-height: 60dvh !important;
       overflow-y: auto !important;
       -webkit-overflow-scrolling: touch;
       overscroll-behavior-y: contain;
       padding: 14px 14px 40px 14px !important;
       border-top: 1px solid rgba(0, 240, 181, 0.25);
       background: rgba(6, 14, 28, 0.95);
       font-size: clamp(12px, 2.5vw, 13.5px);
       line-height: 1.5;
       text-align: left;
       color: #e2e8f0;
       box-sizing: border-box !important;
       scrollbar-width: thin;
       scrollbar-color: rgba(0, 240, 181, 0.5) rgba(4, 9, 18, 0.7);
       ```
     - Sleek Custom Scrollbar on `.codex-card-body`:
       ```css
       .codex-card-body::-webkit-scrollbar {
         width: 6px;
       }
       .codex-card-body::-webkit-scrollbar-track {
         background: rgba(4, 9, 18, 0.7);
         border-radius: 3px;
       }
       .codex-card-body::-webkit-scrollbar-thumb {
         background: rgba(0, 240, 181, 0.5);
         border-radius: 3px;
         border: 1px solid rgba(0, 240, 181, 0.8);
       }
       ```
  2. **Table & Section Bottom Clearance**:
     - `.codex-body-section`, `.codex-tips-block`, `.codex-table-wrap`: Ensure `margin-bottom: 16px;` and `box-sizing: border-box;` so all table rows (`Pause / Menu`, `Codex Guide`, `Steer Heading`, `Dash Boost`, `Active Skill`, `Mutation Lab`) are 100% visible and accessible.
  3. **Card Spacing & Glow**:
     - `.codex-card.expanded`: `border-color: #00f0b5; box-shadow: 0 0 24px rgba(0, 240, 181, 0.3); background: rgba(12, 26, 48, 0.95);`

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/InteractiveCodexHelpScreen.test.ts`, `src/tests/HelpScreenMobilePolishAndDevChecklist.test.ts`
- **Assertions:**
  1. `index.html` contains scrollable `.codex-card-body` rules (`max-height: 60vh !important`, `max-height: 60dvh !important`, `overflow-y: auto !important`, `padding: 14px 14px 40px 14px !important`, `border-top: 1px solid rgba(0, 240, 181, 0.25)`, `background: rgba(6, 14, 28, 0.95)`, `box-sizing: border-box !important`, `scrollbar-color: rgba(0, 240, 181, 0.5) rgba(4, 9, 18, 0.7)`).
  2. `index.html` contains custom scrollbar pseudo-element styles for `.codex-card-body::-webkit-scrollbar`, `::-webkit-scrollbar-track`, and `::-webkit-scrollbar-thumb`.
  3. `index.html` contains `.codex-body-section`, `.codex-tips-block`, and `.codex-table-wrap` with `margin-bottom: 16px` and `box-sizing: border-box`.
  4. `index.html` contains `.codex-card.expanded` with `border-color: #00f0b5` and `box-shadow: 0 0 24px rgba(0, 240, 181, 0.3)`.
  5. All table rows (`Pause / Menu`, `Codex Guide`, `Steer Heading`, `Dash Boost`, `Active Skill`, `Mutation Lab`) are rendered and accessible in the DOM.
  6. Exclusive single-accordion behavior (opening a card closes other cards, clicking it collapses it).
  7. Full verify suite passes (`./verify`).

---

## 3. Implementation Details (Green Phase)

- **Files Modified:**
  - `index.html`: Updated CSS rules for `.codex-card-body`, scrollbar styling, `.codex-body-section`, `.codex-tips-block`, `.codex-table-wrap`, and `.codex-card.expanded`.
  - `src/tests/InteractiveCodexHelpScreen.test.ts`: Updated unit test assertions to match the scrollable opened card content rules, all table rows accessibility, and bottom clearance specifications.
  - `src/tests/HelpScreenMobilePolishAndDevChecklist.test.ts`: Added scrollable card-body and all table rows assertions.

---

## 4. Verification & Quality Check

```bash
./verify
```
**Results:** 100% PASS — 46/46 test files, strict typecheck, and production bundle build passed.
