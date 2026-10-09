# Feature TDD Specification: Active Combat Mechanics & 28 Alchemical Fusions

> **Feature Identifier:** `docs/tdd/active_combat_mechanics_and_alchemical_fusions.tdd.md`  
> **Status:** Green & Reconciled (100% Quality Gate Verified)  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](../AGENTS.md) & [`ORACLE.md#3.1,3.4,3.5,3.7-3.10`](../ORACLE.md)  

---

## 1. Feature Overview & Requirements (Big Audit Step 1 Alignment)

### 1.1 Tactical Autotomy (Voluntary Tail Jettison) — ORACLE.md §3.7
- **Requirement:** `player.autotomy(world)` jettisons rear segments $k \dots N-1$ where $k = \max(1, \lfloor N/2 \rfloor)$.
- **Assertion:** Triggers an $80\text{ damage}$ ablative shockwave in a $140\text{px}$ radius via `world.combat.explodeAt(...)`, grants $1.2\text{s}$ i-frames, and provides $+45\%$ turning agility ($\omega_{\text{turn}}$) for $4.0\text{s}$.
- **Reconciliation:** Ensure `World` exposes `combat` / `Combat` getter referencing `Game.Combat`, allowing `player.autotomy(world)` to reliably trigger the ablative shockwave explosion against nearby enemies, and expose `GameEngine.requestAutotomy()`.

### 1.2 Centripetal Tail-Whip Collisions & Deflection — ORACLE.md §3.8
- **Requirement:** Tangential velocity scales down the spine ($v_i = \|\vec{v}_{\text{head}}\| + \omega \cdot (i \cdot d_{\text{segment}})$). Trailing segment ($i \ge 2$) collisions deal kinetic blunt damage scaled by $1.0 + 0.85 \cdot (v_i / v_{\text{head}})^2$.
- **Knockback Assertion:** Knocks enemies back by $180\text{px}$ radially away from the impacting segment center.
- **Deflection Assertion:** High-velocity trailing segments ($i \ge 2$) deflect incoming light projectiles without taking segment damage.

### 1.3 Closed-Loop Ouroboros Constriction & Astral Prism — ORACLE.md §3.9
- **Requirement:** When head approaches within $R_{\text{snap}} = 28\text{px}$ of segment $k \ge 3$, a closed loop is detected.
- **Assertion:** Winding number algorithm identifies enclosed enemies, applies stasis ($-80\%$ move speed, `stasisTimer = 2.0s`) and crushing DPS, and automatically fuses captured foods into an **Astral Prism** (+15 Ouro, +500 Score, +300% XP bonus & instant Overdrive frenzy).
- **Prism Consumption Assertion:** Ingesting an Astral Prism grants instant Overdrive frenzy charge (`frenzyTimer = frenzyMaxDuration`).

### 1.4 The 28-Synergy Alchemical Cross-Module Fusion Matrix — ORACLE.md §3.10
- **Requirement:** All 28 unique fusion IDs in `GameData.AlchemicalFusions` map 1:1 to ORACLE.md §3.10.
- **Assertion:** Active fusion detection checks prerequisite module pairs on Serpent Head (`player.getActiveAlchemicalFusions()`).

---

## 2. Test Plan (Red-Green-Refactor)

- **Test File:** `src/tests/ActiveMechanicsAndFusions.test.ts`
- **Assertions:**
  1. `it('1. triggers tactical autotomy, shedding rear segments with ablative shockwave and agility surge')`
  2. `it('1b. executes autotomy shockwave explosion through World context dealing damage to nearby enemies')`
  3. `it('2. calculates centripetal tail-whip velocity and applies kinetic blunt damage multiplier')`
  4. `it('2b. knocks enemy back 180px and deflects light projectiles on high-velocity tail segment')`
  5. `it('3. detects closed-loop constriction via point-in-polygon and crushes trapped enemies')`
  6. `it('3b. checkConstriction sets stasis on trapped enemies and automatically triggers food fusion')`
  7. `it('4. compresses trapped food into an Astral Prism with high-value XP bonus and instant Overdrive')`
  8. `it('4b. ingesting Astral Prism grants instant Overdrive frenzy charge')`
  9. `it('5. evaluates active alchemical fusions across installed Head module pairs')`
  10. `it('6. verifies GameEngine.requestAutotomy triggers autotomy and reduces segments')`

---

## 3. Execution & Verification Results

- **RED Phase:** Confirmed failure on all 5 newly authored assertions (1b, 2b, 3b, 4b, 6).
- **GREEN Phase:** Implemented minimal corrective fixes:
  - `World.ts`: Added `combat` and `Combat` getters referencing `Game.Combat`.
  - `SnakePlayer.ts`: Updated `Autotomy` shockwave execution through `world.combat`, added 180px radial knockback to `ResolveTailWhipCollision`.
  - `CombatSystem.ts`: Added fast-moving tail segment light projectile deflection, instant Overdrive frenzy on Astral Prism collection, and stasis + automatic food-to-prism fusion in `checkConstriction`. Added fallback loop detection for unstepped spatial grids.
  - `GameEngine.ts`: Added `RequestAutotomy()` and `requestAutotomy()`.
- **Quality Gate:** 10/10 tests in `ActiveMechanicsAndFusions.test.ts` PASS. Strict typecheck clean.


