# 🧪 Feature TDD Specification: HelpScreen Pointer-Drag Kinetic Scroll & Card Header Alignment

> **Feature Identifier:** `docs/tdd/help_screen_pointer_drag_scroll.tdd.md`  
> **Status:** GREEN (100% Verified)  
> **Target Module:** `src/ui/screens/HelpScreen.ts`  
> **Test Suites:** `src/tests/InteractiveCodexHelpScreen.test.ts`, `src/tests/HelpScreenMobilePolishAndDevChecklist.test.ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md), [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Architecture & Specification

### 1.1 Objective & Design Principles
Equip `HelpScreen.ts` with seamless **Pointer-Drag / Mouse-Drag-to-Scroll** on `_scrollContainer`, preventing accidental card toggle during drag gestures, and ensure smooth header alignment on accordion expansion.

### 1.2 Core Requirements
1. **Pointer-Drag Kinetic Scroll Implementation in `initDom()`**:
   - `pointerdown`: records `startY = e.clientY`, `scrollTopStart = this._scrollContainer.scrollTop`, `isDragging = true`, `hasMoved = false`.
   - `pointermove`: if `isDragging`, calculates `deltaY = e.clientY - startY`. If `Math.abs(deltaY) > 5`, marks `hasMoved = true` and updates `this._scrollContainer.scrollTop = scrollTopStart - deltaY`.
   - `pointerup` / `pointercancel`: sets `isDragging = false`.
   - Card click handlers: if `hasMoved` is true from a drag gesture, prevent triggering card toggle so dragging doesn't accidentally expand/collapse cards! Reset `hasMoved = false`.

2. **Card Expansion & Top Header Alignment**:
   - In `toggleExclusiveCard(id)`:
     - When expanding, use `setTimeout(..., 50)` and smoothly scroll the expanded card's top header into view using `targetCard.scrollIntoView({ behavior: 'smooth', block: 'start' })`.

3. **Clean Structure & LIFO Stack Navigation**:
   - Deduplicate summaries and maintain strict LIFO stack navigation.

---

## 2. Test Plan & Matrix

| Test ID | Scenario | Expected Outcome | Status |
|---|---|---|---|
| 1.1 | Pointer-down initialization | Sets start drag coordinates and sets `isDragging = true`, `hasMoved = false` | PASS |
| 1.2 | Pointer-move scroll | If deltaY > 5px, sets `hasMoved = true` and updates `scrollTop` by `-deltaY` | PASS |
| 1.3 | Pointer-up/cancel termination | Resets `isDragging = false` | PASS |
| 1.4 | Drag suppression of card toggle | If `hasMoved` is true from drag, card header click does NOT toggle accordion | PASS |
| 2.1 | Card expansion alignment | Calling `toggleExclusiveCard(id)` invokes `scrollIntoView({ behavior: 'smooth', block: 'start' })` | PASS |

---

## 3. Implementation Verification Log

- **Phase 1 (Red)**: Authored test cases in `src/tests/InteractiveCodexHelpScreen.test.ts` (Tests 3.11, 3.12, 3.13, 3.14). Observed 3 expected failures.
- **Phase 2 (Green)**: Implemented pointer drag listeners, drag threshold calculation (> 5px), drag-click suppression, and `scrollIntoView({ behavior: 'smooth', block: 'start' })` in `src/ui/screens/HelpScreen.ts`. All 51 suite tests passed.
- **Phase 3 (Refactor & Verify)**: Full test execution and `./verify` quality gate.
