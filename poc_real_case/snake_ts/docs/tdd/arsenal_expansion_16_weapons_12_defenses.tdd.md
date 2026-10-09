# Feature TDD Specification: Arsenal Expansion (16 Weapons & 12 Defenses)

> **Feature Identifier:** `docs/tdd/arsenal_expansion_16_weapons_12_defenses.tdd.md`  
> **Status:** Green & Refactored (141/141 Quality Gate Verified)  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](../AGENTS.md) & [`ORACLE.md#5.3`](../ORACLE.md)  

---

## 1. Feature Overview & Requirements

### 1.1 16 Modular Weapons
- 8 Kinetic Weapons: `turret`, `flak`, `scattershot`, `needler`, `mortar`, `sonic`, `gatling`, `caltrop`.
- 8 Elemental Weapons: `tesla`, `magma`, `cryo`, `venom`, `tachyon`, `plasma`, `singularity`, `solar`.

### 1.2 12 Defensive Systems
- 12 Defensive Modules: `shield`, `spikes`, `regen`, `magnet`, `chrono`, `nanite`, `reactive`, `magnetic_aegis`, `cryo_carapace`, `heatsink`, `cloak`, `emp_coil`.

### 1.3 Snake Lab Integration & Execution
- All 28 socket modules must be registered in `GameData.SocketModules` (`GameData.socketModules.Count === 28`).
- Installing each weapon/defense on `SnakePlayer` segments executes its behavioral update, projectile firing, or defensive trigger in `SnakePlayer.updateSocketModules()`.

---

## 2. Test Plan (Red-Green-Refactor)

- **Test File:** `src/tests/ArsenalExpansion.test.ts`
- **Assertions:**
  1. `it('1. registers all 16 modular weapons and 12 defensive systems in GameData (28 total modules)')`
  2. `it('2. allows installing kinetic and elemental weapons in offense slots')`
  3. `it('3. allows installing new defensive systems in defense slots and validates shield/plating triggers')`
  4. `it('4. executes weapons firing loop without simulation errors in 120Hz ticks')`
