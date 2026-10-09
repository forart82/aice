# Feature TDD Specification: Modular Segment Health System, Head Health & XP State Counter

> **Feature Identifier:** `docs/tdd/modular_segment_health_and_xp_counter.tdd.md`  
> **Status:** Green & Verified (14/14 Tests PASS, 100% Quality Gate PASS)  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](../AGENTS.md) & [`ORACLE.md#3.5`](../ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** 
  1. **Head Health Pool**:
     - The anatomical serpent head possesses dedicated `HeadHp` and `HeadMaxHp` attributes (`HeadMaxHp = 2 * BaseSegmentHp`).
     - Total health pool is the cumulative sum of head health and all body parts:
       $$HP_{\text{total}} = \text{HeadHp} + \sum_{i=0}^{N-1} \text{segment}[i].Hp$$
       $$HP_{\max} = \text{HeadMaxHp} + \sum_{i=0}^{N-1} \text{segment}[i].MaxHp$$
     - When the head is destroyed (`HeadHp <= 0`), the player dies immediately (`Alive = false`, unless Phoenix revive is active).
  2. **Top-to-Bottom Sequential Healing**:
     - When `Heal(amount)` is called, health refills strictly sequentially from anterior (head) to posterior (tail):
       1. Head (`HeadHp` up to `HeadMaxHp`)
       2. Segment 0 (`segment[0].Hp` up to `MaxHp`)
       3. Segment 1 ... Segment $N-1$ until `amount` is fully consumed.
  3. **Full-Body Self-Collision Damage (Head & Body Parts)**:
     - Head touching trailing segment $k \ge 3$ inflicts self-damage to both touched segment and head.
     - Body segment $i$ touching non-adjacent segment $j$ ($|i - j| \ge 3$) inflicts self-damage to BOTH touched body segments.
     - Does NOT use single `break;` or a single global `InvulnerableTimer` lockout: every body part touched in multi-segment crossings takes damage, gated by per-segment `selfHitCooldown`.
     - Emits localized `SELF-BITE!` floating text, spark particles, hit sound, hurt event, and breaks active combo multiplier streak.
  4. **Collision Damage Routing**:
     - Enemy head-to-head bite $\to$ `player.damageHead(cdam)`.
     - Enemy touching body segment $s$ $\to$ `player.damageSegment(s, cdam * 0.7)`.
     - Projectile hitting head $\to$ `player.damageHead(p.damage)`.
     - Projectile hitting body segment $s$ $\to$ `player.damageSegment(s, p.damage)`.
     - Boss hitting head $\to$ `player.damageHead(bcdam)`.
     - Boss touching body segment $s$ $\to$ `player.damageSegment(s, bcdam * 0.55)`.
     - Global / direct player damage absorbs via shields and damages foremost active part.
  5. **Segment Damage & Severing Mechanics**:
     - When any segment takes damage and its `Hp <= 0`, that segment is destroyed and all trailing attached segments are severed and lost (`Segments.splice(i)`).
     - Installed socket modules on severed segments are lost with the segment.
  6. **XP State Counter Telemetry**:
     - Real-time digital XP state counter tracking total collected XP and level progression.

- **Target Systems:**
  - `src/sim/SnakePlayer.ts` (`HeadHp`, `HeadMaxHp`, `BaseSegmentHp`, `SelfHitCooldown`, `HeadSelfHitCooldown`, total HP getters/setters, top-to-bottom `Heal`, `DamageHead`, `DamageSegment`, `SeverFrom`)
  - `src/sim/CombatSystem.ts` (`resolveSelfCollision` with multi-body checks, `resolveEnemies`, `resolveBoss`, `updateProjectiles` collision routing, localized FX, sound, combo break)
  - `src/tests/SegmentHealthAndXp.test.ts` (14 comprehensive TDD test assertions)

- **Mechanics Reference:** [`ORACLE.md#3.5`](../ORACLE.md#3.5-modular-segment--head-health-kinematics) & [`ORACLE.md#3.6`](../ORACLE.md#3.6-xp-state-counter-telemetry)

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/SegmentHealthAndXp.test.ts`
- **Assertions:**
  1. **Head Health Initialization & Cumulative Total HP**:
     - `HeadMaxHp === 2 * BaseSegmentHp` and `HeadHp === HeadMaxHp`.
     - `player.Hp === HeadHp + sum(segments.Hp)` and `player.MaxHp === HeadMaxHp + sum(segments.MaxHp)`.
  2. **Top-to-Bottom Sequential Healing**:
     - Damages head and segments, heals partial amount, asserts head fills first to max before downstream segments receive health.
  3. **Head Destruction & Defeat Rule**:
     - Inflicting fatal damage to head (`damageHead(fatal)`) results in `HeadHp === 0` and `alive === false`.
  4. **Phoenix Rebirth Revival on Head Destruction**:
     - Phoenix charge revives player from head destruction, restoring full `HeadHp` and starter segments.
  5. **Head Self-Collision Damage on Trailing Segments & Head**:
     - Head overlapping trailing segment ($k \ge 3$) inflicts self-damage to both touched segment and head, resets combo.
  6. **Body-on-Body Non-Adjacent Segment Collision**:
     - Segment $i$ overlapping non-adjacent segment $j$ ($|i - j| \ge 3$) damages both body segments $i$ and $j$.
  7. **Multi-Segment Self-Crossing without Break or Global Lockout**:
     - Head overlapping multiple trailing segments simultaneously damages all touched segments in the same resolution step.
  8. **Enemy Collision Damage Routing (Head vs Body)**:
     - Enemy head bite damages head; enemy touching body segment damages that segment.
  9. **Projectile Collision Damage Routing (Head vs Body)**:
     - Projectile hitting head damages head; projectile hitting body segment damages that segment.
  10. **Boss Collision Damage Routing**:
      - Boss contact damages head on head-to-head collision and body segments proportionally.
  11. **Automatic Growth on Food Consumption**:
      - Eating food adds body segments and expands cumulative MaxHp and Hp pool.
  12. **Segment Damage & Downstream Severing**:
      - Fatal damage to middle segment severs all downstream segments while preserving upstream segments and head.
  13. **Loss of Socketed Hardpoint Modules on Severed Segments**:
      - Socketed modules on severed wagons are destroyed.
  14. **XP State Counter Accumulation**:
      - Accurately tracks accumulated XP and level-ups.

---

## 3. Implementation Details (Green Phase)

- **Files Modified:**
  - `src/sim/SnakePlayer.ts`:
    - Added `SelfHitCooldown` property on `SnakeSegment` and `HeadSelfHitCooldown` on `SnakePlayer`.
    - Added `setInvulnerable = true` parameter to `DamageHead` and `DamageSegment` to support suppression of global i-frames during self-collision.
    - Updated `Hp` setter to dynamically upscale `MaxHp` if large health values are assigned (e.g. test harnesses / god mode).
    - Implemented shield absorption across `DamageHead` and `DamageSegment`.
  - `src/sim/CombatSystem.ts`:
    - Implemented multi-part self-collision in `resolveSelfCollision`: checks Head against trailing segments ($k \ge 3$) and body segment $i$ against non-adjacent segment $j$ ($j \ge i + 3$).
    - Routed contact damage in `resolveEnemies`: head bites $\to$ `damageHead`, body contact $\to$ `damageSegment(s, cdam * 0.7)`.
    - Routed projectiles in `updateProjectiles`: head hits $\to$ `damageHead`, body hits $\to$ `damageSegment(s, p.damage)`.
    - Routed boss damage in `resolveBoss`: head contact $\to$ `damageHead(bcdam)`, body contact $\to$ `damageSegment(s, bcdam * 0.55)`.
  - `src/tests/SegmentHealthAndXp.test.ts`:
    - Author of 14 comprehensive unit tests verifying all 6 core requirements and edge cases.

---

## 4. Verification & Quality Check

```bash
npx vitest run src/tests/SegmentHealthAndXp.test.ts # 14/14 PASS
./verify # 16/16 Test Files, 165/165 Tests PASS, Zero Errors Typecheck & Bundle
```
