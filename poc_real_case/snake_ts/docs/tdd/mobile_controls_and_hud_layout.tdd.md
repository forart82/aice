# TDD Feature Specification: Mobile Touch Controls, Joypad Handedness & Accessible Smartphone HUD

> **Feature Identifier:** `mobile_controls_and_hud_layout`  
> **Target Version:** Ouroboros Galaxy 1.1.0  
> **Status:** Red -> Green -> Refactor Verified  
> **Standard:** Strict TDD Protocol (AGENTS.md / ORACLE.md)  

---

## 1. Feature Overview & Design Rationale

### 1.1 Virtual Joypad Default Orientation & Menu Option
- **Right-Handed (Default, `isLefty = false`)**:
  - Virtual Joystick is docked on the **Right Side** (`.touch-stick-zone` on bottom-right, right-thumb steering).
  - Action Buttons (Dash ⚡ and Skill ✨) are docked on the **Left Side** (`.touch-actions-zone` on bottom-left, left-thumb combat triggering).
- **Left-Handed (`isLefty = true`, Southpaw)**:
  - Virtual Joystick is docked on the **Left Side** (`.touch-stick-zone` on bottom-left, left-thumb steering).
  - Action Buttons (Dash ⚡ and Skill ✨) are docked on the **Right Side** (`.touch-actions-zone` on bottom-right, right-thumb combat triggering).
- **Settings Menu Dropdown (`SettingsScreen.ts`)**:
  - Clear dropdown option: `Joystick Position` -> `Right Side (Default)` (`lefty: false`) / `Left Side` (`lefty: true`).
  - Selecting an option immediately updates `InputManager.instance.setLefty()`, toggles `.lefty-mode` on `.touch-controls-layer`, and persists across app launches via `localStorage`.

### 1.2 Smartphone-Accessible Lab & Pause Controls
- Dedicated, prominent touch buttons for **`🧬 LAB`** and **`⏸️ PAUSE`**:
  - Minimum touch target: **44px × 44px** (meeting Mobile Ergonomics Standards).
  - High-visibility cybernetic glassmorphism with glowing cyan borders, backdrop blur, active scale compression (0.92x), and tactile audio feedback.
  - Safe-area notch and rounded-corner offsets (`var(--sat)`, `var(--sal)`, `var(--sar)`).
  - Tap events stop propagation to prevent accidental steering input.

---

## 2. Test Matrix (Red Phase)

1. **`MobileTouchControls.test.ts`**:
   - `SettingsScreen` joystick position dropdown updates `InputManager.isLefty` and toggles `.lefty-mode` on HUD.
   - Right-Handed default places `.touch-stick-zone` on the right side and `.touch-actions-zone` on the left side.
   - Left-Handed mode places `.touch-stick-zone` on the left side and `.touch-actions-zone` on the right side.
   - HUD Lab (`.btn-lab`) and Pause (`.btn-pause`) buttons are accessible, have minimum 44px touch targets on mobile, and trigger engine actions without triggering steering vectors.
2. **`ResponsiveLayout.test.ts`**:
   - `layoutTouchControls` calculates non-overlapping coordinates for Right-Handed (Stick on Right, Actions on Left) and Left-Handed (Stick on Left, Actions on Right).
3. **`Input.test.ts`**:
   - `InputManager.setLefty` updates state and persists to `localStorage`.
   - `TouchControls` multi-touch isolation tests.

---

## 3. Implementation Plan (Green Phase)

1. **`index.html`**:
   - Update CSS for `.touch-stick-zone` (default right), `.touch-actions-zone` (default left), and `.lefty-mode` class overrides.
   - Style `.hud-icon-btn` with 44px min size, cyber glass aesthetics, active state feedback on mobile.
2. **`src/ui/HudView.ts`**:
   - Align event handlers for right-handed default touch steering.
   - Prevent event propagation from HUD top buttons (`btn-lab`, `btn-pause`).
3. **`src/ui/screens/SettingsScreen.ts`**:
   - Add "Joystick Position" dropdown with "Right Side (Default)" and "Left Side".
   - Wire change event to `InputManager.instance.setLefty()`, `UiRoot.applyMetrics()`, and `saveSettings()`.
4. **`src/ui/ResponsiveLayout.ts` & `src/input/TouchControls.ts`**:
   - Update layout mathematics to reflect Right-Handed default and Left-Handed alternative.
