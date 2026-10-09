# Feature TDD Specification: Combat Systems, Head-Centric Weapons, 28 Alchemical Fusions & Status Invariance

> **Feature Identifier:** `docs/tdd/combat_fusions_and_status_invariance.tdd.md`  
> **Status:** Green / Verified  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-11`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-12`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md#310`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

This specification defines the audit and comprehensive invariance test suite for **Step 3 of the Big Audit**:
- **Target Systems:**
  - `src/sim/CombatSystem.ts` — Core damage pipelines, bite rolling, projectile collision, chain lightning, explosion radii, combo scaling, and death processing.
  - `src/sim/CombatModules.ts` — Declarative module registry (16 weapons + 12 defenses = 28 total modules) executing strictly from Serpent Head.
  - `src/sim/CombatSkills.ts` — 5 class active skills (Verdant Bloom, Umbral Blink, Titan Roar, Chain Storm, Supernova) triggering strictly from Head position.
  - `src/sim/SnakePlayer.ts` — Serpentine vitality, life-sourcing from posterior segments, head vs. segment damage distribution, effective armor curves, and 28 Alchemical Fusions detection.
  - `src/sim/StatusSet.ts` — Status effect state machine tracking Chill/Slow, Freeze, Stun, Burn DoT, and Corrode/Mark debuffs.
  - `src/sim/Enemy.ts` & `src/sim/Boss.ts` — Hostile combat entities, vulnerability states, health scaling, and boss life-sourcing mechanics.
  - `src/sim/Projectile.ts` — Ballistic kinematics, homing guidance, and piercing tracking.
- **Mechanics Reference:**
  - [`ORACLE.md#38`](file:///home/forart/dev/snake_ts/ORACLE.md) — Serpentine Locomotion, Kinematic Tail-Whip Collisions, Damage Routing Multipliers.
  - [`ORACLE.md#39`](file:///home/forart/dev/snake_ts/ORACLE.md) — Tactical Autotomy Shockwave, Constriction Stasis & Astral Prism Singularity.
  - [`ORACLE.md#310`](file:///home/forart/dev/snake_ts/ORACLE.md) — Complete 28-Synergy Alchemical Cross-Module Fusion Matrix.
  - [`ORACLE.md#311`](file:///home/forart/dev/snake_ts/ORACLE.md) — Cranial Tactical Lab & Head-Centric Evolution (Rule 11 compliance).

---

## 2. Audit of Existing Combat Tests

An audit of the repository test suites and git history was conducted regarding `src/tests/CombatSystem.test.ts`, `src/tests/CombatSkills.test.ts`, and `src/tests/AlchemicalFusionsMatrixAudit.test.ts`:
1. **File Name Audit:**
   - The specific file names `src/tests/CombatSystem.test.ts`, `src/tests/CombatSkills.test.ts`, and `src/tests/AlchemicalFusionsMatrixAudit.test.ts` did not previously exist in the workspace.
2. **Existing Coverage Distribution:**
   - `src/tests/Complete28AlchemicalFusionsMatrix.test.ts` (71 lines): Validates the 28 Alchemical Fusions trigger detection matrix and a 12-fusion simultaneous synthesis test.
   - `src/tests/DeclarativeModuleRegistry.test.ts` (222 lines): Verifies declarative registration of all 16 weapons and 12 defenses in `ModuleActionRegistry`, head execution context, and class active skills invocation.
   - `src/tests/ActiveMechanicsAndFusions.test.ts` (255 lines): Verifies tactical autotomy, centripetal tail-whip, point-in-polygon constriction, and astral prism singularity fusion.
   - `src/tests/BodyLifeSourcingAndDefeat.test.ts` (144 lines): Verifies serpentine health reservoir mechanics and Phoenix Rebirth triggers.
   - `src/tests/BossSerpentineHealthAndDamage.test.ts` (139 lines): Verifies boss serpentine life-sourcing from posterior segments.
3. **Audit Findings & Expansion Requirement:**
   - While existing tests verified individual subsystems, no single test suite rigorously unified and verified the full end-to-end combat invariants:
     - All 28 Alchemical Fusions with exact prerequisites, symmetric reversal, activation/deactivation, and partner synergy mappings.
     - Head-centric firing invariant (Rule 11) for all 16 weapons and 5 active class skills, proving zero segment firing.
     - Ballistic projectile trajectories, exact piercing decrement, homing angle clamping, and explosive blast radii.
     - Serpentine damage routing (100% head vs 70% mob segment vs 55% boss segment), armor reduction curve clamping, critical strike multiplier scaling, and posterior life-sourcing cascades.
     - Status effect state machine: stacking rules, duration decay, immobility flags, damage amplification (+25% on Mark), and multi-target chain lightning escalation.

---

## 3. Test Plan & Invariance Assertions

The dedicated test suite `src/tests/CombatFusionsAndStatusInvariance.test.ts` authors comprehensive assertions across 4 major pillars:

### Pillar 1: Complete 28 Alchemical Cross-Module Fusion Matrix
1. **Exact 28 Table Invariance:** Verifies `GameData.AlchemicalFusions.length === 28`, 28 unique IDs, and valid metadata (`Id`, `Name`, `Icon`, `ModuleA`, `ModuleB`, `Desc`).
2. **Prerequisite & State Invariance for All 28 Fusions:**
   - Inactive with 0 modules installed.
   - Inactive with only Module A.
   - Inactive with only Module B.
   - Active when both Module A and Module B are installed.
   - Order-independent activation: installing B then A triggers active state.
   - Removal of either module immediately deactivates the fusion.
3. **Multi-Fusion Stacking:** Equipping 6 complementary modules synthesizes 12 simultaneous fusions without key collision or corruption.
4. **Autonomous Bot Partner Mapping Invariance:** Verifies `AutonomousBotPlayer.FusionPartnersMap` indexes all 28 fusions with complete two-way symmetric pairing for AI valuation.
5. **Cooldown & Level Multiplier Scaling:** Verifies offensive weapon damage and defensive barrier scaling with module level (`level * dmgBonus`).

### Pillar 2: Head-Centric Serpentine Arsenal (Rule 11 Compliance)
1. **Exclusive Head Origin Dispatch:** Verifies that `executeHeadModules` injects `isHead: true`, `originX = player.x`, `originY = player.y`, `angle = player.angle`, and all spawned projectiles/hazards match head coordinates.
2. **Zero Segment Sockets / Zero Segment Weapons:** Confirms segments do not execute weapons or host socket attachments.
3. **5 Class Active Skills Head Origin Invariance:**
   - Emerald (Verdant Bloom): Heals player and spawns 5 nutrient foods radially centered around Head `(px, py)`.
   - Stalker (Umbral Blink): Teleports 200px along Head heading `pa`, leaves 6 afterimages along path, shockwave at origin, shockwave at destination, and explodes at `(cx, cy)`.
   - Hydra (Titan Roar): Emits 230px radial shockwave and stun centered at Head `(px, py)`, buffing armor for 5s.
   - Storm (Chain Storm): Discharges 8-jump chain lightning originating at Head `(px, py)`.
   - Solar (Supernova): Unleashes 260px thermonuclear burst centered at Head `(px, py)`, burning enemies and cooking ambient food items.
4. **Projectile Trajectories & Ballistic Kinematics:** Verifies position advancement $x(t) = x_0 + v_x t$, $y(t) = y_0 + v_y t$.
5. **Pierce Count Tracking:** Verifies projectile pierce decreases upon collision with enemies, allowing penetration until pierce is exhausted.
6. **Homing Guidance Clamping:** Verifies projectile angle angular velocity is strictly clamped by $\pm \text{homing} \times \Delta t$ toward target.
7. **Radial Blast Explosion:** Verifies `explodeAt` impacts all living enemies and bosses within `radius + targetRadius`.

### Pillar 3: Serpentine Damage Pipeline & Life-Sourcing
1. **Damage Routing Distribution:**
   - Head hit: 100% incoming damage (`amount * 1.0`).
   - Body segment mob hit: 70% incoming damage (`amount * 0.7`).
   - Body segment boss hit: 55% incoming damage (`amount * 0.55`).
   - Direct projectile hit: 100% incoming damage (`amount * 1.0`).
2. **Armor Damage Reduction Curve:**
   - Formula: $\text{dealt} = \max(1, \lfloor \text{amount} \times (1 - \text{EffectiveArmor}) \rceil)$.
   - $\text{EffectiveArmor} = \text{clamp}(\text{Stats.Armor} + \text{SegmentArmorBonus} + \text{Buffs}, 0, 0.85)$.
   - Segment armor bonus: $\min(0.50, \text{segments.length} \times 0.03)$.
   - Verification across 0%, 20%, 50%, and hard cap 85%.
3. **Critical Strike Multiplier & Frenzy Doubling:**
   - Bite roll formula: $\text{dmg} = \text{BitePower} \times \text{multiplier} \times (\text{isCrit} ? \text{CritMult} : 1.0) \times (\text{Frenzy} ? 2.0 : 1.0)$.
   - Combo tier scaling ($2\times, 3\times, 4\times, 5\times, 6\times, 8\times$).
4. **Posterior Life-Sourcing Cascade & Defeat Condition:**
   - Head damage sources life starting from tail segment (`segments[N-1]`) forward.
   - Segment HP exhaustion severs/pops that segment and life sourcing cascades.
   - Head HP is only reduced when all body segments are exhausted (`segments.length === 0`).
   - Serpent only dies when `segments.length === 0 && headHp <= 0`.
   - Phoenix Rebirth triggers on lethal condition, consuming a charge and restoring full head HP and 2 growth segments.
5. **Boss Serpentine Life-Sourcing Parity:**
   - Serpentine bosses source damage from posterior segments forward.
   - Boss dies ONLY when `segments.length === 0 && headHp <= 0`.

### Pillar 4: Status Effect State Machine
1. **Chill / Slow:**
   - Timer takes $\max(\text{SlowTimer}, \text{seconds})$.
   - Speed factor takes $\min(\text{SlowFactor}, \text{factor})$ (stronger slow wins).
   - Speed multiplier reflects `SlowFactor` while active, reverts to `1.0` on expiry.
2. **Freeze & Stun:**
   - `Freeze(t)` and `Stun(t)` set timers to $\max(\text{current}, t)$.
   - `Immobile === true` whenever `FreezeTimer > 0` or `StunTimer > 0`.
   - Prevents movement and action updates while active.
3. **Burn DoT:**
   - Tracks `BurnTimer` and `BurnDps`.
   - Advances time via `Update(dt)`, accumulating `BurnDps * min(dt, BurnTimer)` damage.
   - Timer and DPS reset to 0 upon expiration.
4. **Corrode / Mark:**
   - Sets `MarkTimer`.
   - Multiplies damage taken by 1.25x (`DamageTakenMult === 1.25`) in `ApplyDamage`.
5. **Multi-Target Chain Lightning & Status Interactions:**
   - `chainLightning` jumps across up to $N$ unique targets without re-hitting the same target.
   - Escalating jump multiplier ($1.15\times$ per jump) when enabled.
   - Inflicts chill and lightning beam visual telemetry.
   - Target in stasis suffers 80% speed reduction and perimeter constriction damage.

---

## 4. Verification & Quality Check

```bash
# 1. Run dedicated test suite
npx vitest run src/tests/CombatFusionsAndStatusInvariance.test.ts

# 2. Strict Typecheck
npm run typecheck

# 3. Complete Quality Gate
./verify
```
