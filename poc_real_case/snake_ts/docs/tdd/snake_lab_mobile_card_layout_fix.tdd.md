# Feature TDD Specification: SnakeLab Mobile Card Vertical Stack Layout Architecture

> **Feature Identifier:** `docs/tdd/snake_lab_mobile_card_layout_fix.tdd.md`  
> **Status:** Green / Refactored  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Fix the card layout architecture in `SnakeLabScreen.ts` (`addIntegratedHeadModuleCard` and `addIntegratedHeadAugmentCard`, `renderHelmetVaultSection`, and `renderTelemetrySection`) to completely eliminate card text/button overlaps on mobile viewports (360px - 540px).
- **Target Systems:** `src/ui/screens/SnakeLabScreen.ts`, `src/tests/SnakeLabMobileCardLayout.test.ts`.
- **Mechanics & UI Specification:**
  1. **Row 1 (Header)**:
     - Left: Icon + Title (`🔥 Magma Vent`) with `font-size: 13px; font-weight: 700; color: #f8fafc;`.
     - Right: Clean Level Badge (`[🔒 LOCKED]` or `[🌟 UNLOCKED]` or `[LVL 1/3]`) with `font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 4px; flex-shrink: 0;`.
  2. **Row 2 (Benefit)**:
     - Single concise line (`Molten heat trail (+15 DPS)` or `Carapace energy barrier (+25 Shield HP)`) on its own full-width row with `font-size: 11px; color: #94a3b8; margin: 4px 0;`.
  3. **Row 3 (Challenge Track - when locked)**:
     - Feat description label: `🎯 Feat: UNLOCK: Slay 15 Swarmlings in a run` (`font-size: 10.5px; color: #fbbf24;`).
     - Sleek progress bar with current/target count and percentage badge (`font-size: 10px; color: #00f0b5;`).
     - Zero buttons on this row.
  4. **Row 4 (Purchase Action - when unlocked or upgrading)**:
     - Full-width or clean action button: `[ 💰 30 🪙 BUY TIER 1 ⚡ ]` or `[ 💰 30 🪙 (NEED 28 MORE) ]`.
     - When max level: `🌟 [MAX LEVEL]`.
  5. **Helmet Vault & Telemetry**:
     - Boss helmet cards and telemetry tiles structured with non-wrapping flex-shrink and responsive minmax grids to eliminate overlap on narrow mobile viewports.

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/SnakeLabMobileCardLayout.test.ts`
- **Assertions:**
  1. Header row segregates icon/title on left and level badge on right with `flex-shrink: 0`.
  2. Benefit description is positioned on its own full-width line below the header.
  3. Locked cards contain Feat description label (`🎯 Feat: ...`) and progress bar on Row 3, with zero buttons on Row 3.
  4. Purchase action badge/button is positioned as Row 4 with proper cost tags and states (`.cost-tag.affordable`, `.cost-tag.unaffordable`, `.cost-tag.tier-locked`, `.cost-tag.max-level`).
  5. Helmet cards and telemetry stat cards render cleanly without overflow or squished overlapping layouts on narrow mobile viewports.

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - `src/ui/screens/SnakeLabScreen.ts`: Updated `addIntegratedHeadModuleCard`, `addIntegratedHeadAugmentCard`, `renderHelmetVaultSection`, and `renderTelemetrySection` with 4-row vertical stack structure and responsive flex-shrink styles.
  - `src/ui/screens/StatsModalScreen.ts`: Corrected `armoryList` class to avoid duplicate `.global-meta-summary` query collisions.
  - `src/tests/SnakeLabMobileCardLayout.test.ts`: Authored comprehensive 6-test verification matrix.

---

## 4. Verification & Quality Check

```bash
npx vitest run src/tests/SnakeLabMobileCardLayout.test.ts
./verify
```

**Quality Gate Results:**
- TypeScript strict typecheck: 100% PASS
- Vitest suites: 93 test files passed (1,161 tests passed)
- Production bundle build: 100% PASS
