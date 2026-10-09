# Feature TDD Specification: 8-Second Wave All-Boss Rush Arena & High-Stakes Victory/Defeat Engine

> **Feature Identifier:** `docs/tdd/boss_rush_gauntlet_and_high_stakes_arena.tdd.md`  
> **Status:** Green / Refactored  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

This feature implements the ultimate high-stakes endgame arena in *Ouroboros Ascension*:
- **Trigger**: Forging the 9th helmet opens an arena with all bosses in an 8-second wave.
- **Wave Pacing**: Every 8.0 seconds, the next apex boss archetype spawns into the arena in sequence:
  1. `Centipede` (Centipede Behemoth)
  2. `Gorgon` (Storm Gorgon)
  3. `Hydra Apex` (Quantum Hydra Apex)
  4. `Colossus` (Infernal Colossus)
  5. `Leviathan` (Astral Leviathan)
  6. `Chrono` (Chrono Wyrm)
  7. `Void Serpent` (Void Devourer)
  8. `Solar Chimera` (Volcanic Solar Chimera)
- **High-Stakes Defeat Condition**:
  - If the player dies (HP <= 0) while the Boss Rush Gauntlet is active:
  - High-Stakes Permaloss triggers immediately: `MetaProgression.instance.resetUniqueHelmets()`.
  - All 8 unique helmets are wiped from meta-progression back to `[]`!
- **Victory & Ascension Condition**:
  - Only if the player defeats all 8 bosses do they win the game and keep the 9th helmet.
  - When all 8 bosses are defeated:
    - Set `victory = true`.
    - Award 9th helmet permanently: `MetaProgression.instance.Has9thHelmet = true`.
    - Trigger game completion / ascension ending!

---

## 2. Architecture & Data Structures

### 2.1 `BossRushGauntletState`
```typescript
export interface BossRushGauntletState {
  active: boolean;
  waveIndex: number;      // 0 to 7
  waveTimer: number;      // counts down from 8.0s
  bossesSpawned: number;
  bossesDefeated: number;
  totalBosses: number;    // 8 bosses total
  allSpawned: boolean;
  victory: boolean;
  defeat: boolean;
}
```

### 2.2 `BossRushGauntlet` Class
- Located in `src/sim/BossRushGauntlet.ts`.
- Coordinates wave timers, boss spawning, death tracking, defeat permaloss, and ascension victory.
- Integrated into `GameEngine` lifecycle.

### 2.3 `MetaProgression` Integration
- `UniqueHelmets: (HelmetDef | string)[]` and `uniqueHelmets` getter/setter.
- `Has9thHelmet: boolean` and `has9thHelmet` getter/setter.
- `resetUniqueHelmets(): void` wiping `UniqueHelmets = []`, `Helmets = []`, `EquippedHelmetId = null`, `Has9thHelmet = false`.

---

## 3. Test Plan & Assertions (Red -> Green Phase)

Test Suite: `src/tests/BossRushGauntlet.test.ts`
1. **Initial State & Coordination**:
   - Starting the Gauntlet initializes `active = true`, `waveIndex = 0`, `waveTimer = 8.0`, `bossesSpawned = 1`, `bossesDefeated = 0`, `totalBosses = 8`, `allSpawned = false`.
   - Spawns the initial boss (Centipede) at wave 0. (PASS)
2. **8-Second Wave Timer & Subsequent Boss Spawns**:
   - Advancing time by 8.0 seconds triggers the next wave (waveIndex = 1, Gorgon).
   - Advancing through all 8 waves spawns each archetype in order, reaching `bossesSpawned = 8`, `allSpawned = true`. (PASS)
3. **Defeat Condition & High-Stakes Permaloss**:
   - Player HP reaching 0 while Gauntlet is active triggers `defeat = true`, `active = false`.
   - Calls `MetaProgression.instance.resetUniqueHelmets()`.
   - Verifies `MetaProgression.instance.UniqueHelmets` is wiped to empty `[]`. (PASS)
4. **Victory Condition & 9th Helmet Retention**:
   - Defeating all 8 bosses sets `victory = true`, `active = false`.
   - Sets `MetaProgression.instance.Has9thHelmet = true`.
   - Calls `engine.HandleGameOver(true)` with victory state. (PASS)
5. **GameEngine Coordination**:
   - `GameEngine.StartBossRushGauntlet()` initializes the gauntlet and updates it in `GameEngine.Step(dt)`. (PASS)

---

## 4. Verification & Quality Gate
- `npx vitest run src/tests/BossRushGauntlet.test.ts`: **5/5 PASS**
- `npm run typecheck`: **0 errors (Exit code 0)**
- Zero regressions across existing test suites (`SelfTest`, `GalaxyJumpAndUniqueHelmets`, `MetaProgression`).

