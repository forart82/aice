# Feature TDD Specification: Segregated Popin Views & Minimal HUD Header CSS

> **Feature Identifier:** `docs/tdd/segregated_popin_views_and_minimal_hud_header_css.tdd.md`  
> **Status:** Green  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Cybernetic CSS styling enhancements in `index.html` for segregated popin tab views (Mutations, Helmets, Statistics) with dedicated active tab glows, smooth view transition animations, and high-contrast clean layouts, alongside a streamlined HUD top-right header action row strictly presenting `[L]` (Lab) and `[P]` (Pause) with balanced spacing and responsive desktop/mobile layouts.
- **Target Systems:** `index.html`, `src/ui/HudView.ts`, `src/ui/screens/SnakeLabScreen.ts`, `src/ui/screens/StatsModalScreen.ts`.
- **Mechanics Reference:** [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md).

### Detailed Requirements:
1. **Popin Tab Views:**
   - Active tab glow for `🧬 Mutations` (cyan/emerald glow: `#00f0b5`), `🪖 Helmets` (amethyst/violet glow: `#c084fc`), and `📊 Statistics` (sky-blue/azure glow: `#38bdf8`).
   - Smooth view transitions between the 3 views (`@keyframes viewFadeIn`, smooth transform/opacity transitions).
   - High-contrast, clean layout for each view with obsidian glass panels, sharp luminous neon borders, and crisp typography.
2. **Streamlined HUD Header:**
   - Clean top-right actions row containing only `[L]` (Lab) and `[P]` (Pause) by hiding non-essential HUD action elements via CSS (`.hud-top-actions .btn-codex, .hud-top-actions .btn-stats, .hud-top-actions .hud-fps-wrap { display: none !important; }`).
   - Balanced spacing and responsive layout on mobile/desktop (min 44x44px touch targets, balanced 6px gaps, safe area insets).

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/SegregatedPopinViewsAndMinimalHudHeaderCss.test.ts`
- **Assertions:**
  1. Verifies dedicated active tab glowing states for `🧬 Mutations`, `🪖 Helmets`, and `📊 Statistics` tabs in `index.html`.
  2. Verifies smooth view transition keyframes and transition rules for popin sections.
  3. Verifies high-contrast, clean glassmorphic layout definitions for segregated popin views.
  4. Verifies streamlined HUD header rules hiding non-essential buttons in `.hud-top-actions` while strictly displaying `[L]` and `[P]`.
  5. Verifies balanced spacing, minimum 44px touch targets, and mobile/desktop responsive styles for `.hud-top-actions`.

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - `docs/tdd/segregated_popin_views_and_minimal_hud_header_css.tdd.md`: TDD specification and verification report.
  - `src/tests/SegregatedPopinViewsAndMinimalHudHeaderCss.test.ts`: 5 comprehensive unit test assertions.
  - `index.html`:
    - Updated `.hud-top-actions` rules to display only `[L]` (Lab) and `[P]` (Pause) with balanced spacing and min 44x44px touch targets.
    - Updated `.hud-layer.tier-phone .hud-top-actions` to enforce identical streamlined presentation on smartphone screens.
    - Added dedicated active tab glowing states for `🧬 Mutations` (`.btn-tab-lab.btn-primary`), `🪖 Helmets` (`.btn-tab-helmets.btn-primary`), and `📊 Statistics` (`.btn-tab-stats.btn-primary` / `.btn-tab-telemetry.btn-primary`).
    - Added smooth view transition keyframe `@keyframes viewFadeIn` and transitions on popin view panes.

---

## 4. Verification & Quality Check

```bash
npx vitest run src/tests/SegregatedPopinViewsAndMinimalHudHeaderCss.test.ts
# ✓ 5/5 tests passed

npm run typecheck
# ✓ 0 TypeScript errors

npm run build
# ✓ Production bundle compiled successfully
```
