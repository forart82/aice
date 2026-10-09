# Feature TDD Specification: Mobile Touch Gamepad & Responsive HUD Layout

> **Feature Identifier:** `docs/tdd/mobile_touch_controls_and_hud_layout.tdd.md`  
> **Status:** GREEN & REFACTORED  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-1`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-6`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & User Problem

### User Problem Statement
1. In mobile / smartphone emulated viewports, there was no visible gamepad / virtual directional steering controls for controlling the serpent with touch or mouse.
2. Action buttons (Dash ⚡ and Skill ✨) were missing dedicated on-screen touch pads in the lower-right quadrant.
3. In portrait mode, the Floor / Mission progress banner (`FLOOR 1 Nourishment X / Y`) was positioned in the dead center of the screen, obstructing the arena, player serpent, and food.
4. Bottom controls hint displayed desktop keyboard shortcuts (`[WASD / ARROWS] Steer • [SPACE] Dash...`) on mobile screens and conflicted with bottom safe-area insets.
5. Top safe-area margins needed clear hardware punch-hole, dynamic island, and notch clearance.

### Requirements & Solutions
1. **Interactive Virtual Steering Gamepad (D-Pad / Virtual Joystick)**:
   - Provided a responsive on-screen steering gamepad in the lower-left quadrant ($x: 0\% - 45\%$, $y: 50\% - 100\%$) with a glowing neon circular base, 4-direction indicators (▲ ▼ ◄ ►), and an analog thumb knob that follows pointer/touch drag.
   - Dispatches normalized directional vectors to `InputManager`.
2. **On-Screen Action Buttons (Dash ⚡ & Skill ✨)**:
   - Provided large, accessible touch action buttons in the lower-right quadrant ($x: 70\% - 100\%$, $y: 60\% - 100\%$) with live cooldown sweep animations and active press feedback.
   - Supports Lefty mode (mirroring joystick to right, buttons to left).
3. **HUD Header Grouping & Top Docking in Portrait Mode**:
   - Wrapped the top HUD in `.hud-header-group` so `hud-mission-portrait-row` is docked directly beneath vitals/combo at the top of the viewport, leaving the entire arena and gameplay field completely open.
4. **Mobile Responsive Typography & Safe Areas**:
   - Applied `--sat` / `--sab` safe area insets to avoid notch and home indicator collisions.
   - Hid redundant desktop hotkey brackets on mobile touch devices.

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** [`src/tests/MobileTouchControls.test.ts`](file:///home/forart/dev/snake_ts/src/tests/MobileTouchControls.test.ts)
- **Assertions:**
  1. `TouchControls` / `HudView` properly instantiates DOM elements for Virtual Joystick (base ring, knob, direction pips) and Action Buttons (Dash, Skill).
  2. Joystick touch/pointer drag calculates normalized steering vector $(\text{dirX}, \text{dirY})$ and updates `InputManager`.
  3. Action buttons (Dash, Skill) trigger `InputManager.onPadTouchAction` on touch start and release on touch end.
  4. Lefty mode correctly swaps joystick to right quadrant and buttons to left quadrant.
  5. Portrait mode HUD groups the Mission / Floor row under top header, ensuring clean visibility of the entire arena.
  6. Desktop keyboard hints are replaced with mobile guidance on touch viewports.

---

## 3. Implementation Details (Green & Refactor Phase)

- **Files Implemented:**
  - `src/ui/HudView.ts`: Header group grouping, interactive touch layer, virtual joystick with direction arrows & knob drag, touch action buttons with live sweeps.
  - `src/ui/ResponsiveLayout.ts`: Auto-enables touch mode for all mobile and portrait viewports.
  - `src/main.ts`: URL query parameter screen routing on startup (`?screen=combat`, `?screen=class`, `?screen=sanctuary`, `?screen=lab`).
  - `index.html`: Cyberpunk neon CSS styling for the gamepad, direction pips, action buttons, safe areas, and portrait layout.
  - `emulator.html`: Interactive smartphone emulator harness with device frame, screen switches, and orientation toggling.

---

## 4. Verification & Quality Check

```bash
npx vitest run src/tests/MobileTouchControls.test.ts
./verify
```
- **Result:** 100% Quality Gate PASS (17 test files, 212 tests pass, zero TypeScript errors, clean production bundle).
