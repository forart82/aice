# 🧪 Feature TDD Specification: Streamlined Lab Menu, Helmet Inventory & Mobile Touch Redesign

> **Feature Identifier:** `streamlined_lab_and_mobile_touch_controls`  
> **Rule Reference:** [`AGENTS.md#rule-1`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-3`](file:///home/forart/dev/snake_ts/AGENTS.md), [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  
> **Status:** 100% VERIFIED & CONFORMANCE PASSED  
> **Created:** 2026-08-27  

---

## 1. Feature Description & Architectural Scope

### 1.1 Streamlined Cranial Lab & Helmet Inventory (`SnakeLabScreen.ts`)
- **Single Tactical Focus:** Since upgrades apply directly to the Serpent Head (which powers the whole organism), remove legacy body segment pagination, socket replacement modals, and redundant sub-menus.
- **Integrated Helmet Vault & Inventory:** 
  - Added two top navigation tabs:
    1. **`[ 🧬 Cranial Lab ]`**: High-tech mutation panel for Cranial Augmentations, Offensive Head Weapons, and Defensive Bio-Organs with dynamic scaled XP prices.
    2. **`[ 🪖 Helmet Vault (${count}) ]`**: Full visual inventory of unlocked Boss Helmets (`COMMON`, `UNCOMMON`, `RARE`, `EPIC`, `MYTHIC`), showing active equipped stats, procedural lore descriptions, and one-tap Equip / Unequip actions.
- **Cybernetic Neon Visuals:** Clean glassmorphism cards, rarity-coded borders, responsive layout adapting to mobile portrait (9:16) and desktop ultrawide (21:9).

### 1.2 Full-Screen Mobile Touch Steering & Bottom-Center Buttons (`HudView.ts`, `TouchControls.ts`, `VirtualStick.ts`, `ResponsiveLayout.ts`)
- **Full-Screen Drag / Steering:** Removed fixed static joystick constraints. On smartphones/touch devices, players can touch and drag anywhere across the screen area to steer the serpent.
- **Disappearing Floating Joypad:** The joystick origin dynamically floats to the initial touch position and stays invisible or subtly indicates steering direction, eliminating visual clutter.
- **Bottom-Center Dual Action Buttons:**
  - Repositioned Dash ⚡ and Active Skill ✨ to the bottom-center of the screen on smartphones.
  - Symmetrically spaced around screen center X (`viewportWidth * 0.5`), reachable by both left and right thumbs.
  - Safe-area notch and home indicator offset compensation (`--sab`, `safeArea.bottom`).

---

## 2. Test Plan (Red-Green-Refactor)

1. **`test_lab_screen_tabs_and_helmet_inventory`**:
   - Verified `SnakeLabScreen` renders tab bar with `[ 🧬 Cranial Lab ]` and `[ 🪖 Helmet Vault ]`.
   - Verified selecting Helmet tab displays all unlocked helmets from `MetaProgression.Helmets`.
   - Verified equip and unequip actions correctly update `MetaProgression.EquippedHelmetId` and `player.EquippedHelmet`.
2. **`test_fullscreen_touch_steering`**:
   - Verified `VirtualStick` / touch drag allows dynamic steering from any screen quadrant without boundary clamping.
3. **`test_bottom_center_touch_action_buttons`**:
   - Verified `ResponsiveLayout.layoutTouchControls` and `TouchControls` position Dash and Skill buttons symmetrically around `viewportWidth * 0.5` at the bottom of the viewport.
   - Verified button touch dispatch fires edge-triggered events on `InputManager` with `stopPropagation` preventing steer jitter.
4. **`test_full_quality_gate`**:
   - 100% PASS across all 21 Vitest suites (243 tests), strict TypeScript typechecks, and production bundle builds via `./verify`.

---

## 3. Implementation Checklist

- [x] Update `src/ui/screens/SnakeLabScreen.ts` with simplified layout, tabs, and integrated Helmet Vault.
- [x] Update `src/input/TouchControls.ts` and `src/ui/ResponsiveLayout.ts` for bottom-center action button layout.
- [x] Update `src/ui/HudView.ts` for full-screen touch steering and bottom-center action button DOM styling.
- [x] Update / author automated conformance tests in `src/tests/CranialLabAndBossHelmets.test.ts` and `src/tests/MobileTouchControls.test.ts`.
- [x] Run full `./verify` quality gate (243/243 tests PASS).
