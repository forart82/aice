# Feature TDD Specification: Deep Bug Audit & Defect Resolution: Input, Touch, Responsive Layout & Virtual Stick

> **Feature Identifier:** `docs/tdd/input_touch_virtual_stick_responsive_layout_audit.tdd.md`  
> **Status:** Green  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-1`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-10`](file:///home/forart/dev/snake_ts/AGENTS.md), & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Deep audit, defect discovery, and hardening across the unified input subsystem, touch controls, virtual joystick, responsive layout calculations, and HUD touch layer.
- **Target Systems:**
  - `src/input/InputManager.ts`: Multi-source arbitration, keyboard/gamepad/touch events, window blur, visibility change, and NaN sanitization.
  - `src/input/TouchControls.ts`: On-screen action buttons, multi-touch isolation, touch deduplication, NaN inset handling, and window blur reset.
  - `src/input/VirtualStick.ts`: Floating/dynamic origin joystick, multi-touch race condition prevention, NaN coordinate protection, and window blur release.
  - `src/ui/ResponsiveLayout.ts`: Dynamic scale curves, safe-area inset parsing, zero/NaN viewport resilience, and orientation reflow stabilization.
  - `src/ui/HudView.ts`: Pointer event deduplication (eliminating `pointer*` + `touch*` double-fire), pointerId tracking, lostpointercapture handling, and window blur cleanup.

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/InputTouchAndResponsiveLayoutAudit.test.ts`
- **Assertions:**
  1. **Window Blur & Tab Visibility Desync:**
     - `InputManager` clears all input sources (`sources[0]`, `sources[1]`, `sources[2]`), held actions (`dashHeld`, `skillHeld`, `dashTouch`, `skillTouch`), and pointer state on window `blur` and document `visibilitychange` (`document.visibilityState === 'hidden'`).
     - `VirtualStick` and `TouchControls` auto-release and reset their internal touch states on window `blur` or document hidden, preventing stuck steering or locked buttons.
     - VirtualStick and TouchControls accept new touches immediately after focus restoration without touchId locking.
  2. **Multi-Touch Race Conditions & Collision Hardening:**
     - Single touch point cannot claim multiple action buttons simultaneously even if hitting boundary overlap.
     - Extraneous touches cannot overwrite or hijack an active virtual joystick session.
     - Independent release of multi-touch buttons does not disrupt other held buttons.
  3. **Safe-Area, NaN & Zero Viewport Resilience:**
     - `TouchControls.updateLayout` with `NaN` or `<= 0` preserves valid button rects and does not poison hit testing.
     - `ResponsiveLayout.computeMetrics` with `NaN`, `0`, or negative dimensions safely falls back to standard viewport definitions without `NaN` propagation.
     - `ResponsiveLayout.layoutTouchControls` with non-finite space or insets guarantees all button and bounds coordinates remain strictly finite.
     - `VirtualStick` and `InputManager` sanitize non-finite (`NaN` / `Infinity`) coordinate inputs, preserving numerical stability.
  4. **Pointer Event Hardening & HUD Integration:**
     - Pointer capture and lostpointercapture cleanly release virtual stick without orphaned dragging state.
     - Pointer ID isolation ensures secondary touches do not clobber joystick origin or cause premature release.

---

## 3. Implementation Details (Green Phase)

- **Root Causes Discovered & Fixed:**
  1. **Window Blur / Visibility Desync**:
     - Alt-Tab or browser switching left keyboard keys and touch action flags permanently stuck `true`.
     - Fixed in `InputManager.clearAllInputs()`, `TouchControls.reset()`, and `VirtualStick.release()` by subscribing to `window.blur`, `window.pagehide`, and `document.visibilitychange`.
  2. **Multi-touch Overlap & Race Conditions**:
     - Rapid multi-finger gestures or border hits could claim multiple buttons simultaneously.
     - Fixed with distance-based touch disambiguation (`getDistSq`) and single-button-per-touch guarantees in `TouchControls`.
  3. **NaN/Zero Viewport & Orientation Change Poisoning**:
     - Headless environments or orientation changes temporarily returning zero or NaN dimensions would corrupt layout calculations.
     - Protected `ResponsiveLayout.computeMetrics` and `layoutTouchControls` with explicit `Number.isFinite()` and fallback clamps.
  4. **Pointer Event Clobbering in HUD**:
     - `HudView` did not bind `lostpointercapture`, causing virtual stick to remain dragged when pointer capture was lost.
     - Added `activePointerId` tracking, `lostpointercapture` listener, and blur listeners.

- **Files Modified:**
  - `docs/tdd/input_touch_virtual_stick_responsive_layout_audit.tdd.md`
  - `src/tests/InputTouchAndResponsiveLayoutAudit.test.ts`
  - `src/input/InputManager.ts`
  - `src/input/TouchControls.ts`
  - `src/input/VirtualStick.ts`
  - `src/ui/ResponsiveLayout.ts`
  - `src/ui/HudView.ts`

---

## 4. Verification & Quality Check

- **Unit Test Suite:** `src/tests/InputTouchAndResponsiveLayoutAudit.test.ts` (21/21 PASS)
- **TypeScript Check:** `npm run typecheck` (0 errors)
- **Quality Gate:** `./verify` PASS
