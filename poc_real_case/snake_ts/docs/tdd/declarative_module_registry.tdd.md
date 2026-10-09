# Feature TDD Specification: Declarative Module Action Registry & Modular Combat Sub-Engines

> **Feature Identifier:** `docs/tdd/declarative_module_registry.tdd.md`  
> **Status:** Green / Verified  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Unify tactical Head modules and Segment socket execution across all 28 modules (16 weapons: 8 kinetic + 8 elemental, and 12 defensive systems) into a high-performance declarative `ModuleActionRegistry`. Decouple combat sub-engines into dedicated modules (`CombatModules.ts`, `CombatAuras.ts`, `CombatSkills.ts`), cleanly integrated into `CombatSystem.ts` while eliminating unreferenced duplicate implementations.
- **Target Systems:** `src/sim/CombatModules.ts`, `src/sim/CombatAuras.ts`, `src/sim/CombatSkills.ts`, `src/sim/CombatSystem.ts`
- **Mechanics Reference:** [`ORACLE.md#socket-modules`](file:///home/forart/dev/snake_ts/ORACLE.md) & [`ORACLE.md#combat-system`](file:///home/forart/dev/snake_ts/ORACLE.md)

### Detailed Requirements:
1. **Declarative `ModuleActionRegistry`**:
   - Centralized dictionary/map of module handlers for all 28 socket modules (16 weapons + 12 defenses).
   - Unified execution interface `(ctx: ModuleActionContext) => void` supporting both Head Module and Segment Socket execution.
   - Context supplies origin coordinates `(x, y)`, orientation `angle`, module level, `isHead` flag, damage bonus multiplier, timer state, and game world references (`enemies`, `boss`, `projectiles`, `hazards`, `foods`).
2. **All 16 Weapons (8 Kinetic + 8 Elemental)**:
   - **Kinetic**: `turret`, `flak`, `scattershot`, `needler`, `mortar`, `sonic`, `gatling`, `caltrop`.
   - **Elemental**: `tesla`, `magma`, `cryo`, `venom`, `tachyon`, `plasma`, `singularity`, `solar`.
   - Exact mathematical models for targeting, projectile speeds, spread distributions, damage formulas, beam intersections, AoE radii, and status effects.
3. **All 12 Defenses**:
   - `shield`, `spikes`, `regen`, `magnet`, `chrono`, `nanite`, `reactive`, `magnetic_aegis`, `cryo_carapace`, `heatsink`, `cloak`, `emp_coil`.
   - Absorption, regeneration, food pulling, time dilation projectile damping, EMP waves, and thermal venting.
4. **Modular Sub-Engine Integration**:
   - `CombatModules.ts`: Core registry and module action dispatchers.
   - `CombatAuras.ts`: Passive relic auras (`frostbite`, `eternalCoil`, `orbitalFangs`, `singularity`) and relic attacks (`venomSpit`, `dragonsBreath`, `thunder`).
   - `CombatSkills.ts`: Active class skills (`verdantBloom`, `umbralBlink`, `titanRoar`, `chainStorm`, `supernova`).
   - `CombatSystem.ts`: Clean facade delegating to sub-engines while preserving 100% backward-compatible public APIs.
5. **100% Non-Regression & Bit-Exactness**:
   - Zero divergence across golden traces (`ParityTest`), balance probes (`PlayTest`), active mechanics, cards/relics, and unit tests.

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/DeclarativeModuleRegistry.test.ts`
- **Assertions:**
  1. `ModuleActionRegistry` contains registered handlers for all 28 socket modules (16 weapons + 12 defenses).
  2. All 16 weapons execute correctly with proper projectile spawning, beam raycasting, hazard placement, and cooldown handling for both Head and Segment contexts.
  3. All 12 defensive systems execute correctly (shield regen, pulse shockwaves, time dilation bullet dampening, EMP bullet clearing, ambient thermal venting, cryogenic chill aura).
  4. Modular sub-engines (`updateAuras`, `updateRelicAttacks`, `activateSkill`) execute seamlessly through `CombatSystem` delegation.
  5. 28 alchemical cross-fusions detection and synergy execution remain 100% compliant.
  6. Zero-regression across full test gate (`./verify`, `ParityTest`, `PlayTest`).

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - `src/sim/CombatModules.ts` (New declarative module registry & executors)
  - `src/sim/CombatAuras.ts` (Sub-engine for passive auras & relic auto-attacks)
  - `src/sim/CombatSkills.ts` (Sub-engine for class active skills)
  - `src/sim/CombatSystem.ts` (Facade refactored to delegate cleanly)
  - Remove deprecated unreferenced `CombatSystem.Auras.ts` & `CombatSystem.Skills.ts`

---

## 4. Verification & Quality Check

```bash
npx vitest run src/tests/DeclarativeModuleRegistry.test.ts
# ✓ 5 tests passed (100% PASS)

npx vitest run src/tests/DeclarativeModuleRegistry.test.ts src/tests/ActiveMechanicsAndFusions.test.ts src/tests/ArsenalExpansion.test.ts src/tests/WeaponsAndDefensePlaytest.test.ts src/tests/CardsAndRelicsIntegrity.test.ts src/tests/ParityTest.test.ts src/tests/PlayTest.test.ts
# ✓ 7 test suites, 69 tests passed (100% PASS)
```
