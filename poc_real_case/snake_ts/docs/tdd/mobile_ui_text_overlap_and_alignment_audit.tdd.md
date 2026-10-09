# Feature TDD Specification: Mobile UI Text Overlap & Alignment Audit

> **Feature Identifier:** `docs/tdd/mobile_ui_text_overlap_and_alignment_audit.tdd.md`  
> **Status:** GREEN & REFACTORED  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-1`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-6`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Problem Statement

### Problem Statement
In mobile/smartphone viewports:
1. **Top Vitals Text Overflow**: `_hpText` displayed `112 / 112 (👑 Head: 56/56 • 🟢 Body: 56/56)`, which overflowed the top-left vitals card boundary on mobile screens.
2. **Top-Row Card Height Misalignment**: Top-left vitals was ~28px tall while top-right combo column was ~65px tall, causing uneven vertical alignment across the top bar.
3. **Touch Controls Leaking into Modals**: The virtual joystick and touch action buttons remained visible while modals (Class Select, Sanctuary, Mutation Lab, Settings, Draft) were active.
4. **Modal Bottom Button Overlap**: In Class Select and Sanctuary screens, the bottom action buttons (`ASCEND NOW`, `BACK`, `RETURN TO MENU`) overlapped the lowest scrollable items due to missing bottom scroll padding.

---

## 2. Architecture & Design Specification

### A. Compact Phone Vitals Formatting in `HudView.refresh()`
- On `tier-phone`: Display concise health string `${curHp} / ${maxHp}` without parenthesized verbose breakdowns.
- On `tier-tablet` and `tier-desktop`: Retain full detailed breakdown `${curHp} / ${maxHp} (👑 Head: ... • 🟢 Body: ...)`.

### B. Single-Row Balanced Top Status Bar on Phone
- Structure `.hud-layer.tier-phone .hud-top-row` so left vitals, center mission, and right combo/score pills have balanced heights (~32-36px).
- Right column on phone arranges stats horizontally: `[🔥 COMBO 0x] [SCORE 0] [💎 0] [🧬] [⏸]`.

### C. Touch Controls Modal Dismissal in `UiRoot` & `HudView`
- When any modal screen is open (`_currentScreen !== null`), automatically set `.touch-controls-layer { display: none; }` so touch pads never leak into modal menus.
- When combat resumes and modals close, restore touch controls display if `isTouchActive`.

### D. Modal Scroll Container Padding
- Ensure `.class-grid`, `.sanctuary-grid`, and modal scroll bodies have `padding-bottom: 90px;` so all items can be scrolled fully above fixed bottom action buttons on mobile screens.

---

## 3. Test Plan & Conformance Assertions (Red Phase)

- **Test File:** [`src/tests/UiTextOverlapAndAlignment.test.ts`](file:///home/forart/dev/snake_ts/src/tests/UiTextOverlapAndAlignment.test.ts)
- **Assertions:**
  1. Phone tier formats HP text compactly without Head/Body parenthesized overflow.
  2. Desktop/Tablet tiers retain detailed Head/Body breakdown text.
  3. Opening a modal screen hides the touch controls layer.
  4. Closing modal and resuming combat restores touch controls layer.
  5. Modal scrollable containers have adequate bottom padding to prevent overlap with sticky buttons.

---

## 4. Verification Gate

```bash
npx vitest run src/tests/UiTextOverlapAndAlignment.test.ts
./verify
```
- **Result:** 100% Quality Gate PASS (19 test files, 220 tests pass, zero TypeScript errors, clean production bundle).
