# Feature TDD Specification: Multi-Boss Escalation & 20-Floor Sequence

> **Feature Identifier:** `docs/tdd/multi_boss_escalation_and_floor20.tdd.md`  
> **Status:** Green (100% Passed & Quality Gate Verified)  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** `AGENTS.md` (Strict TDD Protocol 3.0), `ORACLE.md` (SSOT)  

---

## 1. Feature Overview & Requirements

This feature implements multi-boss escalation across higher floor tiers in *Ouroboros Ascension* along with diverse challenge condition verifications across Tiers 1, 2, and 3:

1. **20-Floor Single Boss Sequence (Floors 1 to 20)**:
   - Floors 1 through 20 spawn exactly **1 boss per floor**, deterministically mapping to `GameData.BossForFloor(floor)` across the entire 20-boss roster.
   - Bosses cycle through all 20 unique apex archetypes (`centipede`, `gorgon`, `colossus`, `frostwyrm`, `chronowyrm`, `hivemind`, `superconductor_boss`, `leviathan`, `quantum_hydra`, `mirror_wyrm`, `void_devourer`, `orbital_dreadnought`, `iron_juggernaut`, `solar_archon`, `crystal_monolith`, `tempest_siren`, `nanite_titan`, `phase_specter`, `volcanic_chimera`, `eternal_ouroboros`).

2. **Floors 21–30 Dual Boss Escalation**:
   - Floors 21 through 30 spawn **2 random bosses simultaneously** upon boss trigger (`spawnBoss()`).
   - Both bosses are independently active, positioned with spatial offsets, and update their multi-phase behaviors simultaneously.

3. **Floors 31–40 Tri Boss Escalation**:
   - Floors 31 through 40 spawn **3 random bosses simultaneously** upon boss trigger.
   - All 3 bosses are independently active, spaced across the arena, and engage the serpent concurrently.

4. **Multi-Boss Defeat Gate**:
   - Clearing a multi-boss floor requires defeating **all active bosses** on that floor.
   - Defeating one boss of a pair/trio awards individual loot (helmets, ouro, score, foods) but does **not** trigger `FloorClear` or end the run while other bosses remain alive.
   - The floor advances (`GameState.FloorClear`) only once `Bosses.length === 0`.

5. **Diverse Mixed Challenge Progression Across Tiers 1, 2, and 3**:
   - Verification and support of diverse challenge requirements across all 3 tiers:
     - **Food Collection**: e.g. `crown`, `crest` (Tier 1: 300, Tier 2: 800, Tier 3: 1500 foods).
     - **Enemy Kills**: e.g. `flak`, `scattershot` (Tier 1: 50/75/80, Tier 2: 150/200/250/300, Tier 3: 350/500/600/800/1000 kills).
     - **Bosses Defeated**: e.g. `shield`, `horns`, `nanite` (Tier 1: 1, Tier 2: 6/8/10, Tier 3: 15/16/18/20 bosses).
     - **Specific Boss Defeats**: e.g. `maw` (centipede), `flak` (gorgon), `needler` (colossus), `chrono` (chronowyrm), `turret` (superconductor), `magma` (leviathan), `cryo` (doppelganger / eternal ouroboros), `laser` (colossus / frostwyrm / eternal ouroboros), `visor` (centipede / gorgon / leviathan).
     - **Combo Streaks**: e.g. `needler`, `tesla`, `fangs`, `flak`, `magnet` (Tier 1: 20x, Tier 2: 14x/20x/22x/30x/45x, Tier 3: 35x/40x/60x/75x combo).
     - **Serpent Length**: e.g. `magma` (250), `cryo` (350), `plasma` (450), `chrono` (500), `tachyon` (600), `nanite` (700/1000/1500), `maw` (300/650/1200), `scattershot` (600/1000), `shield` (1200), `regen` (200/500/1500), `magnet` (250/500/1500).

---

## 2. Test Plan & Assertions (Red & Green Phases)

- **Test Suite Location:** `src/tests/MultiBossEscalationAndFloor20.test.ts`
- **Results:** 14 / 14 Tests Passing (100% PASS)
- **Suite Breakdown:**
  1. `1. 20-Floor Single Boss Sequence`:
     - 1.1 Verifies floors 1 through 20 spawn exactly 1 boss per floor corresponding to `GameData.BossForFloor(f)`.
     - 1.2 Verifies single boss defeat on floors 1-20 clears floor and advances state.
  2. `2. Floors 21-30 Dual Boss Escalation`:
     - 2.1 Spawns exactly 2 random bosses simultaneously on floors 21-30 with spatial separation.
     - 2.2 Verifies both bosses update their entrance/AI loops concurrently in `GameEngine.Step`.
  3. `3. Floors 31-40 Tri Boss Escalation`:
     - 3.1 Spawns exactly 3 random bosses simultaneously on floors 31-40.
     - 3.2 Verifies all 3 bosses step concurrently and update multi-phase combat.
  4. `4. Multi-Boss Defeat Gate`:
     - 4.1 Defeating 1 of 2 bosses on Floor 25 keeps floor active in `GameState.Playing` and retains remaining boss.
     - 4.2 Defeating 3 bosses sequentially on Floor 35 clears floor only after 3rd boss falls.
  5. `5. Diverse Mixed Challenges Across Tiers 1, 2, and 3`:
     - 5.1 Food collection challenge unlocks (300 / 800 / 1500 foods) in-run and post-run via `RunSummary`.
     - 5.2 Enemy kill count challenge unlocks (50 / 150 / 350 kills).
     - 5.3 Boss kill count challenge unlocks (1 / 3 / 6 bosses).
     - 5.4 Specific boss archetype defeat unlocks (`centipede`, `gorgon`, `leviathan`, `colossus`, `frostwyrm`, `eternal_ouroboros`).
     - 5.5 Combo streak challenge unlocks (20x / 45x / 75x combo).
     - 5.6 Serpent length milestone challenge unlocks (250, 350, 450, 500, 600, 700, 1000, 1500).

---

## 3. Verification & Quality Gate Metrics

- **TypeScript Typecheck (`npm run typecheck`):** 0 Errors (100% Strict Type Safety)
- **Vitest Conformance Suites (`npm test`):** 56 / 56 test files passed, 741 / 741 unit and integration tests passed.
- **Production Bundle Build (`npm run build`):** 100% PASS (Zero Warnings/Errors).
- **Quality Gate (`./verify`):** 100% PASS.
