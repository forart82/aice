# Feature TDD Specification: Boss Serpentine Health & Multi-Segment Contact Damage

> **Feature Identifier:** `docs/tdd/boss_serpentine_health_and_multi_segment_damage.tdd.md`  
> **Status:** Green (Verified)  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:**
  1. **Serpentine Boss Health Architecture:**
     Boss enemies mirror the player snake's biological vitality architecture. The boss head possesses its own dedicated health pool (`HeadHp`, `HeadMaxHp`), while each boss body segment possesses its own hit points (`Hp`, `MaxHp`, `HitFlash`). The boss's total `Hp` and `MaxHp` are the exact sum of the head and all active body segments. When the boss takes damage through `ApplyDamage` / `DamageHead`:
     - The body acts as the active reservoir/source of life.
     - Damage is absorbed starting from the posterior-most segment (`Segments[Segments.length - 1]`).
     - If incoming damage exceeds the last segment's remaining HP, that segment is consumed/severed (`pop()`) and excess damage cascades forward to preceding segments.
     - When all body segments are consumed, remaining damage reduces `HeadHp`.
     - The boss **ONLY** dies if there are **no more body parts (`Segments.length === 0`)** **AND** `HeadHp <= 0` (`Dead = true`).
  2. **Multi-Segment Boss Contact Damage:**
     When a boss snake (either its head or any of its trailing body segments) collides with the player's snake, it damages **EACH player body part touched**.
     - Mirrored after the player's self-collision mechanics (`resolveSelfCollision`), every touched player segment takes contact damage independently.
     - Each player segment maintains its own independent `BossHitCooldown` (0.5s), allowing sweeping boss strikes to hit multiple trailing segments simultaneously without artificial global lockouts.

- **Target Systems:**
  - `src/sim/Boss.ts`: `BossSegment` (`Hp`, `MaxHp`, `HitFlash`), `Boss` (`HeadHp`, `HeadMaxHp`, `ApplyDamage`, `DamageHead`, `DamageSegment`, `SeverFrom`, `Hp`, `MaxHp`)
  - `src/sim/SnakePlayer.ts`: `SnakeSegment` (`BossHitCooldown`)
  - `src/sim/CombatSystem.ts`: `resolveBoss` multi-segment collision resolution
  - `ORACLE.md`: Update Section 3.5 & Boss Combat specifications

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/BossSerpentineHealthAndDamage.test.ts`
- **Assertions:**
  1. `1.1 boss initializes with head health and individual segment health pools whose sum equals boss MaxHp` (**PASSED**)
  2. `1.2 boss head damage sources life from the last body segment forward, consuming segments until depleted` (**PASSED**)
  3. `1.3 boss survives when all body segments are severed if headHp > 0 and only dies when segments.length === 0 && headHp <= 0` (**PASSED**)
  4. `1.4 direct damage to a boss body segment severs that segment and all trailing segments` (**PASSED**)
  5. `1.5 boss head touching multiple player body parts damages each touched player segment independently` (**PASSED**)
  6. `1.6 boss body parts touching multiple player body parts damages each touched player segment independently` (**PASSED**)
  7. `1.7 each touched player segment obeys its own independent bossHitCooldown` (**PASSED**)

---

## 3. Implementation Details (Green Phase)

- **Files Modified:**
  - `src/sim/Boss.ts`:
    - Added `Hp`, `MaxHp`, `HitFlash` to `BossSegment`.
    - Added `HeadHp`, `HeadMaxHp` to `Boss`.
    - Implemented `InitSegmentHealth()`, `ApplyDamage()`, `DamageHead()`, `DamageSegment()`, `SeverFrom()`.
    - Updated `Hp` and `MaxHp` getters/setters.
  - `src/sim/SnakePlayer.ts`:
    - Added `BossHitCooldown` to `SnakeSegment` and decremented in `UpdateSegments`.
  - `src/sim/CombatSystem.ts`:
    - Refactored `resolveBoss` to query and damage ALL touched player segments for both boss head and boss body parts using spatial grid radius queries.
  - `ORACLE.md`:
    - Documented boss serpentine health pooling, life-sourcing, and multi-segment contact mechanics in Section 3.5.

---

## 4. Verification & Quality Check

```bash
npx vitest run src/tests/BossSerpentineHealthAndDamage.test.ts
npm run typecheck
./verify
```
