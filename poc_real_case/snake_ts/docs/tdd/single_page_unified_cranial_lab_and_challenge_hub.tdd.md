# Feature TDD Specification: Single-Page Unified Cranial Mutation Lab, Challenge Tracker & Telemetry Hub

> **Feature Identifier:** `docs/tdd/single_page_unified_cranial_lab_and_challenge_hub.tdd.md`  
> **Status:** Refactored / Green (100% Pass)  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Target File:** `src/ui/screens/SnakeLabScreen.ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Merged the previously segmented tabs (Bio-Lab, Helmets, Challenges, Telemetry) into ONE single comprehensive, fluidly scrollable master page within `SnakeLabScreen.ts`.
- **Target Systems:** `src/ui/screens/SnakeLabScreen.ts`, `src/tests/SinglePageUnifiedSnakeLab.test.ts`.
- **Mechanics Reference:** [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md) (Cranial Mutation Lab, Boss Helmets, In-Run Challenges, Telemetry & Affordances).

### Core Architecture of the Single Integrated Page:
1. **TOP SECTION: In-Run Expedition Vitals & Telemetry Bar**:
   - Quick chips: Floor 🏛️, Ouro Wallet 🪙 (`.lab-stat-chip-ouro`), Length 🐍, Score ⭐, HP ❤️, Combo ⚡.
   - Comprehensive Telemetry Summary:
     - Vitals Grid (`.stats-vitals-grid` / `.run-telemetry-grid`)
     - Nourishment & Harvest Breakdown (`.food-breakdown-grid`: Apples, Golden, Potions, Shards, Prisms)
     - Hostile Bestiary Eliminations (`.bestiary-grid`: Swarmlings, Scarabs, Spitters, Phantoms, Arc Drones, Magma Brutes)
2. **HELMET BAR: Boss Helmet Vault**:
   - Active equipped helmet card (`.equipped-helmet-card`) with unequip action (`.btn-unequip-helmet`).
   - Quick vault drawer displaying collected boss helmets with instant equip/unequip buttons (`.btn-equip-helmet`).
3. **MAIN BODY: Unified Cranial Mutation & Challenge Card Grid**:
   - ⚔️ Offensive Weapons (Head Mounted: Turret, Tesla, Magma, Venom, Tachyon, Cryo, Plasma, Flak, Scattershot, Needler)
   - 🛡️ Defensive Bio-Organs (Head Mounted: Shield, Spikes, Regen, Magnet, Chrono, Nanite)
   - 🧬 Cranial Bio-Augmentations (Fangs, Maw, Horns, Laser, Crown)
4. **INTEGRATED CHALLENGE & REWARD ON EVERY CARD**:
   - **Locked Tier**: Shows lock badge `🔒 [TIER N LOCKED]`, challenge requirement text (e.g. `Grow Serpent to Length 140`), live cyber-gradient progress bar (`.challenge-progress-bar`) with exact ratio and percentage, click toast explaining feat and error sound.
   - **Unlocked / Starter Tier**: Displays module stat preview, current level (`[LVL 1/3]`), interactive Buy/Upgrade button with exact cost (e.g. `💰 30 OURO [UPGRADE]`), affordable cyan/green glow (`[BUY ⚡]`) or unaffordable breakdown (`[NEED X MORE OURO]`), click toast on insufficient funds or purchase completion on sufficient funds.
   - **Max Level**: Golden `🌟 [MAX LEVEL]` badge with max level toast.
5. **BOTTOM BAR**:
   - Prominent `DEPLOY / RESUME EXPEDITION ⚡` action button (`.btn-deploy-serpent`).

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/SinglePageUnifiedSnakeLab.test.ts`
- **Assertions:**
  1. Single master page renders all sections simultaneously: Vitals/Telemetry, Helmet Vault, Offensive Weapons, Defensive Bio-Organs, and Cranial Bio-Augmentations.
  2. Telemetry summary renders food breakdown counts (Apples, Golden, Potions, Shards, Prisms) and bestiary kills (Swarmlings, Scarabs, Spitters, Phantoms, Drones, Brutes).
  3. Boss Helmet Vault displays active equipped helmet and quick vault grid for collected helmets.
  4. Locked upgrade cards integrate challenge requirements and cyber progress bars with exact percentage and ratio.
  5. Unlocked upgrade cards display level badges, dynamic pricing, and interactive purchase affordances.
  6. Max level items render golden `[MAX LEVEL]` badges.
  7. Deploy button triggers level-up completion or in-run resume.
  8. Full backward compatibility with existing tab navigation and quick jump controls.

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - `src/ui/screens/SnakeLabScreen.ts`
  - `src/tests/SinglePageUnifiedSnakeLab.test.ts`
  - `docs/tdd/single_page_unified_cranial_lab_and_challenge_hub.tdd.md`

---

## 4. Verification & Quality Check

```bash
npx vitest run src/tests/SinglePageUnifiedSnakeLab.test.ts
./verify
```

**Quality Gate Verification Results:**
- TypeScript Typecheck (`tsc --noEmit`): 100% PASS (0 errors)
- Vitest Automated Test Suites (80 test files, 1016 tests): 100% PASS (0 failures)
- Production Web Bundle Build (`npm run build`): 100% PASS
