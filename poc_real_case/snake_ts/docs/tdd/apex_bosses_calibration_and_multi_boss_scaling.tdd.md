# Feature TDD Specification: 20 Apex Bosses Calibration & Multi-Boss Scaling

> **Feature Identifier:** `docs/tdd/apex_bosses_calibration_and_multi_boss_scaling.tdd.md`  
> **Status:** Complete (100% Passing & Verified on ./verify)  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Calibrate HP and Damage curves for all 20 Apex Bosses across Floors 1–20, and calibrate multi-boss HP scaling on Floors 21+ with a 0.75x individual HP modifier in multi-boss spawns.
- **Target Systems:**
  - `src/data/GameData.ts`: Calibrated `BaseHp` and `HpPerFloor` curves for all 20 Bosses in `GameData.Bosses`.
  - `src/sim/Boss.ts`: Boss MaxHp calculation respecting native floor base HP, cycle scaling, and multi-boss scale modifier (`0.75x` in multi-boss encounters).
  - `src/sim/GameEngine.ts`: Spawning multi-bosses on Floors 21+ with `multiBossScale = 0.75`.
  - `ORACLE.md`: Updated Section 5.3 and 5.3.1 with exact 20-boss progression HP table, formulas, and multi-boss rules.
- **Mechanics Reference:** [`ORACLE.md#5.3`](file:///home/forart/dev/snake_ts/ORACLE.md)

### Calibrated Boss Progression Roster (Floors 1–20):
- **Early Bosses (Floors 1–5):**
  1. `centipede` (Floor 1): 450 HP (BaseHp: 450, HpPerFloor: 180)
  2. `gorgon` (Floor 2): 650 HP (BaseHp: 650, HpPerFloor: 220)
  3. `colossus` (Floor 3): 900 HP (BaseHp: 900, HpPerFloor: 280)
  4. `frostwyrm` (Floor 4): 1200 HP (BaseHp: 1200, HpPerFloor: 340)
  5. `chronowyrm` (Floor 5): 1500 HP (BaseHp: 1500, HpPerFloor: 400)
- **Mid Bosses (Floors 6–10):**
  6. `hivemind` (Floor 6): 1900 HP (BaseHp: 1900, HpPerFloor: 460)
  7. `superconductor_boss` (Floor 7): 2400 HP (BaseHp: 2400, HpPerFloor: 520)
  8. `leviathan` (Floor 8): 3000 HP (BaseHp: 3000, HpPerFloor: 580)
  9. `quantum_hydra` (Floor 9): 3700 HP (BaseHp: 3700, HpPerFloor: 650)
  10. `mirror_wyrm` (Floor 10): 4500 HP (BaseHp: 4500, HpPerFloor: 720)
- **Late Bosses (Floors 11–15):**
  11. `void_devourer` (Floor 11): 5400 HP (BaseHp: 5400, HpPerFloor: 800)
  12. `orbital_dreadnought` (Floor 12): 6400 HP (BaseHp: 6400, HpPerFloor: 880)
  13. `iron_juggernaut` (Floor 13): 7500 HP (BaseHp: 7500, HpPerFloor: 960)
  14. `solar_archon` (Floor 14): 8700 HP (BaseHp: 8700, HpPerFloor: 1050)
  15. `crystal_monolith` (Floor 15): 10000 HP (BaseHp: 10000, HpPerFloor: 1150)
- **Endgame Apex Bosses (Floors 16–20):**
  16. `tempest_siren` (Floor 16): 11500 HP (BaseHp: 11500, HpPerFloor: 1250)
  17. `nanite_titan` (Floor 17): 13200 HP (BaseHp: 13200, HpPerFloor: 1350)
  18. `phase_specter` (Floor 18): 15000 HP (BaseHp: 15000, HpPerFloor: 1450)
  19. `volcanic_chimera` (Floor 19): 17000 HP (BaseHp: 17000, HpPerFloor: 1550)
  20. `eternal_ouroboros` (Floor 20): 20000 HP (BaseHp: 20000, HpPerFloor: 1700)

### Multi-Boss Shared Health Scaling (Floors 21+):
- Spawning $N \ge 2$ simultaneous bosses applies individual HP modifier of `0.75x` (`multiBossScale = 0.75`).
- Total encounter health pool scales fairly while preventing bullet-sponge fatigue in dual, triple, and multi-boss rooms.

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/ApexBossesCalibrationAndMultiBossScaling.test.ts`
- **Assertions:**
  1. Validates all 20 bosses on Floor 1–20 spawn with exact calibrated MaxHp values: [450, 650, 900, 1200, 1500, 1900, 2400, 3000, 3700, 4500, 5400, 6400, 7500, 8700, 10000, 11500, 13200, 15000, 17000, 20000].
  2. Validates contact and attack damage curves scale smoothly across Floors 1–20.
  3. Validates multi-boss spawns on Floor 21+ apply the `0.75x` HP modifier to each spawned boss.
  4. Validates single boss spawns (e.g. Floor <= 20 or manual single boss spawn) use full `1.0x` HP multiplier.
  5. Validates cycle scaling on Floors 21+ ($C = \lfloor (\text{Floor}-1)/20 \rfloor$) correctly computes `(BaseHp + HpPerFloor * 20 * C) * (1 + 0.35 * C) * multiBossModifier`.

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - `src/data/GameData.ts`: Updated `Bosses` array with calibrated `BaseHp` and `HpPerFloor`.
  - `src/sim/Boss.ts`: Updated `Boss` constructor to calculate `MaxHp` with native base HP, cycle floors, and `multiBossScale` parameter.
  - `src/sim/GameEngine.ts`: Updated `SpawnBoss` to pass `multiBossScale = 0.75` for `spawnCount > 1`.
  - `ORACLE.md`: Updated Section 5.3 and 5.3.1 with exact boss values and formulas.

---

## 4. Verification & Quality Check

```bash
npx vitest run src/tests/ApexBossesCalibrationAndMultiBossScaling.test.ts
./verify
```
