# Feature TDD Specification: 8 Apex Boss Guardians & Multi-Phase Encounters

> **Feature Identifier:** `docs/tdd/apex_boss_guardians_and_encounters.tdd.md`  
> **Status:** Green & Refactored (145/145 Quality Gate Verified)  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](../AGENTS.md) & [`ORACLE.md#5.2`](../ORACLE.md)  

---

## 1. Feature Overview & Requirements

### 1.1 The 8 Apex Boss Roster
- Complete 8-boss roster in `GameData.Bosses` (`GameData.Bosses.length === 8`).
  1. `centipede` (Centipede Behemoth)
  2. `gorgon` (Storm Gorgon)
  3. `colossus` (Infernal Colossus)
  4. `frostwyrm` (Glacial Behemoth)
  5. `chronowyrm` (Chrono Wyrm)
  6. `hivemind` (Bio-Venom Hivemind)
  7. `superconductor_boss` (Apex Superconductor)
  8. `leviathan` (Astral Leviathan)

### 1.2 Multi-Phase AI & Encounters
- All 8 bosses transition to Phase 2 at $\le 50\%$ HP, escalating attack rates and releasing signature secondary hazards / bullet patterns.
- `GameData.BossForFloor(floor)` correctly cycles through all 8 boss guardians.

---

## 2. Test Plan (Red-Green-Refactor)

- **Test File:** `src/tests/ApexBossGuardians.test.ts`
- **Assertions:**
  1. `it('1. registers all 8 apex boss guardians in GameData with appropriate stats and titles')`
  2. `it('2. instantiates each of the 8 boss archetypes with appropriate health scaling and behaviors')`
  3. `it('3. transitions bosses to Phase 2 at 50% HP and triggers attack escalation')`
  4. `it('4. executes 120Hz fixed updates for all 8 bosses without runtime errors')`
