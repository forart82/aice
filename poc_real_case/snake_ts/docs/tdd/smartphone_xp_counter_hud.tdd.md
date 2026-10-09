# Feature TDD Specification: Smartphone XP Counter HUD & Crystal-Clear XP Telemetry

> **Feature Identifier:** `docs/tdd/smartphone_xp_counter_hud.tdd.md`  
> **Status:** Green & Verified (50/50 Test Suites PASS, 668/668 Tests PASS, 100% Quality Gate PASS)  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](../AGENTS.md) & [`ORACLE.md`](../ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** 
  1. **Smartphone Viewport Visibility Fix**:
     - Removed `display: none;` on `.hud-layer.tier-phone .hud-xp-counter-wrap` in `index.html`.
     - Styled `.hud-xp-counter-wrap`, `.hud-xp-row`, `.hud-xp-badge`, `.hud-xp-val`, and the XP progress bar (`.xp-bar-wrap` & `.xp-bar-fill`) so it fits cleanly into the mobile vitals card without overflowing or overlapping controls.
  2. **Crystal-Clear XP Telemetry & Progress Bar**:
     - In `src/ui/HudView.ts`, updated XP display to show formatted progress: `${Math.floor(player.xp)} / ${Math.floor(player.xpToNext)}` and updated the `.xp-bar-fill` width dynamically via normalized `clamp01(curXp / xpToNext) * 100%`.
     - Provides instant visual clarity on progress toward level thresholds across all floors.
  3. **Animated Level-Up Pulse & Highlight**:
     - When pending level-ups are ready (`player.pendingLevelUps > 0`), dynamically triggers the `.level-up-ready` class on `.hud-lvl-badge` and `.hud-xp-counter-wrap`, running a cybernetic gold/magenta glow and scale pulse animation, displaying `LVL X ↑`.

- **Target Systems:**
  - `index.html` (CSS styling for `.hud-xp-counter-wrap`, `.hud-xp-row`, `.hud-xp-badge`, `.hud-xp-val`, `.xp-bar-wrap`, `.xp-bar-fill`, and `.level-up-ready` animations across desktop, tablet, and phone tiers)
  - `src/ui/HudView.ts` (DOM structure, telemetry binding, formatted XP string, XP progress fill sweep, level-up pulse toggle)
  - `src/tests/SmartphoneXpCounterHud.test.ts` (Dedicated TDD test suite verifying visibility, telemetry formatting, bar progress, and level-up pulse)
  - `src/tests/UiLayoutAudit.test.ts` (Conformance updates for formatted XP progression)
  - `src/tests/XpCounterAndProgressionAudit.test.ts` (Comprehensive regression suite)

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/SmartphoneXpCounterHud.test.ts`
- **Assertions:**
  1. **Phone Tier Visibility**: `.hud-xp-counter-wrap` is present, visible, and has appropriate structure on phone tier.
  2. **XP Telemetry Formatting**: Formats XP progression as `${curXp} / ${xpToNext}` (e.g. `240 / 100` or `0 / 100`).
  3. **XP Progress Bar Width**: `.xp-bar-fill` width reflects `MathX.clamp01(curXp / xpToNext) * 100%`.
  4. **Level-Up Ready State**: When `player.pendingLevelUps > 0`, `.hud-lvl-badge` and `.hud-xp-counter-wrap` receive the `.level-up-ready` class and level badge shows level up indicator `LVL X ↑`.
  5. **Level-Up Cleared State**: When `player.pendingLevelUps === 0`, `.level-up-ready` is removed and level badge returns to standard `LVL X`.

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - `docs/tdd/smartphone_xp_counter_hud.tdd.md`
  - `src/tests/SmartphoneXpCounterHud.test.ts`
  - `src/ui/HudView.ts`
  - `index.html`
  - `src/tests/UiLayoutAudit.test.ts`
  - `src/tests/XpCounterAndProgressionAudit.test.ts`

---

## 4. Verification & Quality Check

```bash
npx vitest run src/tests/SmartphoneXpCounterHud.test.ts
npm run typecheck
./verify
```
- Result: 100% PASS (50/50 test files, 668/668 tests, 0 TypeScript errors, production build verified).
