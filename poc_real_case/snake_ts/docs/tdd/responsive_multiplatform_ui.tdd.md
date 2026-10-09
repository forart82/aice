# Feature TDD Specification: Universal Responsive Multi-Screen UI

> **Feature Identifier:** `docs/tdd/responsive_multiplatform_ui.tdd.md`  
> **Status:** GREEN & REFACTORED  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-6`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **Problem Addressed:** Previous UI engines struggled on varied aspect ratios (16:9, 21:9 ultrawide, 32:9, 4:3, 9:16 mobile portrait), resulting in stretched HUD elements and overlapping action buttons.
- **Solution:** A unified `ResponsiveLayout` engine computing dynamic UI matrix scales and quadrant bounding boxes with safe-area notch padding.
- **Target Systems:** `src/ui/ResponsiveLayout.ts`, `src/ui/HudView.ts`, `src/render/Ctx2D.ts`.

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** [`src/tests/UiLayoutAudit.test.ts`](file:///home/forart/dev/snake_ts/src/tests/UiLayoutAudit.test.ts)
- **Assertions:**
  1. Valid aspect mode categorization across all tested viewports.
  2. Bounded scaling factor between 0.65 and 3.0.
  3. No intersection/overlap between HUD top bars and bottom touch buttons.
  4. Safe-area notch offsets properly applied on mobile aspect ratios.

---

## 3. Implementation Details (Green Phase)

- **Files Implemented:**
  - `src/ui/ResponsiveLayout.ts`
  - `src/ui/HudView.ts`
  - `src/input/VirtualStick.ts`
  - `src/input/TouchControls.ts`

---

## 4. Verification & Quality Check

```bash
npx vitest run src/tests/UiLayoutAudit.test.ts
npm run typecheck
```
- **Result:** 33/33 Tests PASS (100%).
