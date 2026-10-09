# Feature TDD Specification: Kinematics, Movement, Serpentine Physics, Constriction & Collision Invariance

> **Feature Identifier:** `docs/tdd/kinematics_and_collision_invariance.tdd.md`  
> **Status:** Green / Complete (34/34 Tests Passing)  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-1`](../AGENTS.md#rule-1), [`AGENTS.md#rule-2`](../AGENTS.md#rule-2), [`AGENTS.md#rule-8`](../AGENTS.md#rule-8), [`AGENTS.md#rule-10`](../AGENTS.md#rule-10), [`ORACLE.md#3.7-3.9`](../ORACLE.md)  

---

## 1. Feature Overview & Requirements

This test suite audits and guarantees the non-negotiable physical and kinematic invariants of **Ouroboros Ascension**, ensuring that core movement, steering, vertebral follow kinematics, closed-loop constriction, emergency autotomy, centripetal tail-whip physics, and arena boundary collision handling remain strictly intact, mathematically precise, and resilient against regressions.

### Target Systems
- `src/sim/SnakePlayer.ts`: Serpentine steering, angular turn limits ($\omega_{\text{turn}}$), inverse kinematics (IK), autotomy, tail whip tangential velocity, boundary deflection & clamping.
- `src/sim/CombatSystem.ts`: Closed-loop point-in-polygon constriction detection, stasis induction, crushing damage, light projectile deflection by tail segments.
- `src/sim/Enemy.ts` & `src/sim/Boss.ts`: Stasis movement speed scaling ($-80\%$, `stasisMult = 0.2`), radial knockback displacement ($180\text{px}$).

### Invariance Pillars

#### Pillar 1: Angular Velocity Limits & Steering ($\omega_{\text{turn}}$)
- **Base Steering Speed:** $\omega_0 = 9.5\text{ rad/s}$ (`TurnSpeed`).
- **Agility Surge Multiplier:** $+45\%$ angular speed ($\omega = 1.45 \times \omega_0 = 13.775\text{ rad/s}$) during active `AgilitySurgeTimer > 0`.
- **Dash Steering Penalty:** $0.65\times$ angular turn speed during active `IsDashing`.
- **Heading Clamping & Delta:** Heading correction strictly limits angular rotation per tick: $\Delta \theta = \text{angleDelta}(\theta, \theta_{\text{target}}) \times \text{clamp}(\omega \cdot \Delta t, 0, 1)$.
- **Angle Normalization:** Heading angle remains strictly normalized in $(-\pi, \pi]$ radians.
- **Input Invariance:** When steering input is inactive or magnitude $\le 0.001$, `TargetAngle` remains unchanged.

#### Pillar 2: Serpentine Distance Constraints (Gauss-Seidel Inverse Kinematics)
- **Vertebral Distance Conservation:** For every segment $i \in [0, N-1]$, distance constraint $\|P_{i-1} - P_i\| = d_{\text{spacing}} = 15\text{px}$ is enforced.
- **High-Velocity Invariance:** Under maximum dash velocity ($v = 2.5 \times 195 = 487.5\text{px/s}$) and violent $180^\circ$ heading reversals, segment-to-segment distance never exceeds $15.001\text{px}$ after relaxation.
- **Vertebral Diameter Tapering:** Body segments taper gradually from neck to tail according to $R_i = R_{\text{base}} \times (1.0 - 0.4 \times i / N)$, where $R_{\text{base}} = 11\text{px}$.
- **Numerical Stability:** Segments recover gracefully from non-finite coordinates or zero distances without NaN corruption.

#### Pillar 3: Closed-Loop Constriction Ray-Casting (Point-in-Polygon Topology)
- **Topological Closure:** Head approaching within $R_{\text{snap}} = 41\text{px}$ ($R_{\text{head}} + R_{\text{seg}} + 16\text{px}$) of any trailing segment $k \ge 3$ closes a polygon loop $\mathcal{P} = [S_{\text{head}}, S_0, S_1, \dots, S_k]$.
- **Ray-Casting Point-in-Polygon:** Standard winding/ray-intersection algorithm detects containment of entities inside the convex or non-convex serpentine polygon.
- **Temporal Stasis:** Enclosed enemies receive `stasisTimer = 2.0s` (bosses `1.0s`), which scales move speed by exactly $0.2\times$ ($-80\%$ speed reduction).
- **Crushing Damage Over Time:** Trapped enemies suffer perimeter crushing damage: $\text{CrushDamage} = (120 + 15 \times N) \times \text{DamageBonus}$.
- **Singularity Fusion:** Trapped food pickups are compressed into an **Astral Prism** (🔮).

#### Pillar 4: Tactical Autotomy (Voluntary Emergency Tail Jettison)
- **Severing Boundary:** Jettisons segments from index $k = \max(1, \lfloor N/2 \rfloor)$ to $N-1$, leaving exactly $k$ segments intact.
- **Minimum Segment Guard:** At $N \le 1$, autotomy returns 0 and does not sever the last segment.
- **Emergency i-Frames:** Sets `InvulnerableTimer = 1.2s`.
- **Agility Surge:** Sets `AgilitySurgeTimer = 4.0s`, unlocking $+45\%$ turn rate.
- **Ablative Shockwave:** Detonates an explosion at the cut segment with radius $140\text{px}$ dealing $80 \times \text{DamageBonus}$ damage.
- **Vitality Resynchronization:** Head and remaining segment health, max health, and cumulative HP are atomically resynchronized.

#### Pillar 5: Centripetal Tail-Whip Collisions ($v = \omega \cdot r$)
- **Centripetal Tangential Velocity:** Segment tangential velocity scales down the spine:
  $$v_i = v_{\text{head}} + \omega_{\text{turn}} \cdot (i \cdot d_{\text{spacing}})$$
- **Quadratic Kinetic Multiplier:** Colliding trailing segments ($i \ge 2$) deal blunt kinetic damage:
  $$\text{Damage}_{\text{whip}} = \text{BitePower} \times \left(1.0 + 0.85 \cdot \left(\frac{v_i}{v_{\text{head}}}\right)^2\right)$$
- **180px Radial Knockback:** Enemy position is knocked backward by exactly $180\text{px}$ along the normalized radial vector from the colliding segment: $\vec{P}_{\text{enemy}}' = \vec{P}_{\text{enemy}} + \hat{n} \times 180$.
- **Light Projectile Deflection:** Fast-moving trailing segments ($i \ge 2$) during active agility surge immediately neutralize light enemy projectiles ($\text{damage} < 45$, non-boss) without taking player damage.

#### Pillar 6: Boundary Collisions & Damping
- **Arena Containment:** Head position is strictly clamped to $[m, W - m] \times [m, H - m]$ where $m = R_{\text{head}}$, preventing coordinate escape.
- **Sliding Tangent Deflection:** Tangential projection vector $T = V - (V \cdot N)N$ steers the serpent parallel to the wall, preserving forward velocity.
- **Perpendicular Head-On Deflection:** Head-on impact with normal $N = (n_x, n_y)$ deflects to tangent $(-n_y, n_x)$, eliminating stalling or infinite bouncing.
- **Composite Corner Deflection & Separation Nudge:** Simultaneous contact with adjacent walls applies an inward $1.0\text{px}$ separation nudge and a composite diagonal normal $N = (n_x \frac{\sqrt{2}}{2}, n_y \frac{\sqrt{2}}{2})$ deflection.
- **Inward Steering Preservation:** When the player steers inward away from the wall ($V_{\text{target}} \cdot N \ge 0$), `TargetAngle` is strictly preserved, allowing immediate escape.

---

## 2. Test Plan & Assertions

Dedicated test suite location: `src/tests/KinematicsAndCollisionInvariance.test.ts`.

### Test Suite Structure
1. **Angular Velocity Limits & Steering Kinematics**
   - Heading rotation rate clamping under 45°, 90°, 135°, and 180° inputs.
   - Dash turn speed damping factor ($0.65\times$).
   - Agility surge turn speed amplification ($1.45\times$).
   - Combined dash + agility surge turn rate ($1.45 \times 0.65 = 0.9425\times$).
   - Shortest angular path selection across $\pm \pi$ branch cut.
   - Inactive or deadband input preservation of `TargetAngle`.

2. **Serpentine Vertebral Distance Constraints (Gauss-Seidel IK)**
   - Strict inter-segment distance preservation ($\|P_{i-1} - P_i\| \le 15.001\text{px}$) across 200 simulation ticks at cruise speed.
   - High-speed dash distance preservation ($v = 487.5\text{px/s}$).
   - $180^\circ$ violent direction reversal distance preservation without segment overlap collapse or explosion.
   - Tapered radius progression down vertebral spine ($R_i = 11 \times (1 - 0.4 i / N)$).
   - Recovery from corrupted or displaced segment coordinates back to valid spacing.

3. **Closed-Loop Ouroboros Constriction Topology**
   - Point-in-polygon encirclement detection for circular 12-point loop.
   - Point-in-polygon containment for non-convex / oval / arbitrary serpentine loops.
   - Exclusion of entities strictly outside the loop boundary.
   - Temporal stasis application (`stasisTimer = 2.0s`) reducing enemy movement speed by exactly $80\%$ (`stasisMult = 0.2`).
   - Crushing damage scaling formula application: $(120 + 15 \times N) \times \text{DamageBonus}$.
   - Boss stasis application (`stasisTimer = 1.0s`, `stasisMult = 0.2`).
   - Food singularity compression into Astral Prism.

4. **Tactical Autotomy Tail Jettison & Agility Surge**
   - Half-length severing formula: $k = \max(1, \lfloor N/2 \rfloor)$ across odd and even segment lengths ($N=2, 3, 4, 7, 10, 15, 20$).
   - Boundary condition: $N \le 1$ segments returns 0 and does not sever.
   - Invulnerability window grant: `InvulnerableTimer = 1.2s`.
   - Agility surge activation: `AgilitySurgeTimer = 4.0s` providing $1.45\times$ turn rate.
   - Ablative shockwave explosion: $140\text{px}$ radius, $80\text{ damage}$ via `world.combat.explodeAt`.
   - Cumulative HP, HeadMaxHp, and segment array synchronization after cut.

5. **Centripetal Tail-Whip Collisions & Projectile Deflection**
   - Spine tangential velocity formula verification: $v_i = v_{\text{head}} + \omega_{\text{turn}} \cdot (i \cdot d_{\text{spacing}})$.
   - Quadratic kinetic multiplier verification: $\text{mult} = 1.0 + 0.85 \cdot (v_i / v_{\text{head}})^2$.
   - Tail-whip hit deals scaled damage and knocks enemy back by exactly $180\text{px}$.
   - Radial knockback direction points directly along $(P_{\text{enemy}} - P_{\text{segment}})$.
   - Deflection of light hostile projectiles ($\text{damage} < 45$) by trailing segments ($i \ge 2$) during agility surge.
   - Heavy projectiles ($\text{damage} \ge 45$) or boss projectiles penetrate and damage segments.

6. **Boundary Collisions, Damping & Escapability**
   - Coordinate clamping: Head never escapes $[m, W - m] \times [m, H - m]$ across left, right, top, bottom borders.
   - Oblique wall impact sliding: Heading angle aligns with wall tangent.
   - Head-on wall impact deflection: Heading deflects to perpendicular tangent without coordinate stall.
   - Simultaneous 2-wall corner collision: Diagonal composite normal deflection and separation nudge unpins head.
   - Escape ergonomics: Inward steering angle is strictly preserved when player steers away from the boundary.

---

## 3. Implementation Details

- **Test File Authoring:** `src/tests/KinematicsAndCollisionInvariance.test.ts`.
- **Zero Production Mutation Invariant:** All existing production formulas, constants, and behaviors in `SnakePlayer.ts`, `CombatSystem.ts`, `Enemy.ts`, and `Boss.ts` are validated for strict conformance without altering balance.

---

## 4. Verification & Quality Gate

```bash
npx vitest run src/tests/KinematicsAndCollisionInvariance.test.ts
npm run typecheck
./verify
```
