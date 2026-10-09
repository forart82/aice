# Feature TDD Specification: Multi-Bot Swarm Sweeps & Behavioral Anomaly Probes (100+ Seeds)

> **Feature Identifier:** `docs/tdd/multi_bot_swarm_and_anomaly_probes_100_seeds.tdd.md`  
> **Status:** Green & Refactored  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Comprehensive multi-bot autonomous swarm sweeps and rigorous behavioral anomaly stress tests across 100+ discrete seeds (125 seeds across all 5 serpent classes: Emerald, Stalker, Hydra, Storm, Solar) auditing simulation edge cases, numerical stability, physical constraints, memory leak bounds, and spatial partitioning.
- **Target Systems:**
  - `src/sim/ai/AutonomousBotPlayer.ts`: Autonomous potential field navigation, multi-step lookahead raycasting, and tactical triggers.
  - `src/sim/ai/BehavioralAnomalyDetector.ts`: Real-time anomaly detection suite tracking self-traps, hazard pathing, hoarding, wasted abilities, potion neglect, NaN numerics, OOB escapes, and segment detachment.
  - `src/sim/SpatialHashGrid.ts`: Multi-layer broadphase spatial partitioning, nearest-neighbor searches, DDA raymarching, and capacity scaling under extreme/malformed query bounds.
  - `src/sim/SnakePlayer.ts`: Inverse kinematics distance constraints, rapid 120Hz oscillating steering, simultaneous Dash + Skill activations, and wall deflection.
  - `src/sim/GameEngine.ts`: Headless simulation step stability, floor transitions, multi-boss escalation, and zero-freeze guarantees.
- **Mechanics Reference:** [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Locations:**
  - `src/tests/MultiBotSwarmAnomalyProbes100Seeds.test.ts`
  - `src/tests/SpatialPartitionMultiLayer.test.ts`
- **Audit Points & Assertions:**
  1. **Multi-Bot Swarm 100+ Seed Sweep:** Run 125 discrete seeds (25 seeds per class across Emerald, Stalker, Hydra, Storm, Solar) simulating 120+ fixed 120Hz frames per run.
  2. **Numerical & Vector NaN Probe:** Assert $X, Y, \theta, \theta_{\text{target}}, V_x, V_y, \text{Hp}, \text{MaxHp}, \text{Ouro}$ and all segment coordinates are finite ($!Number.isNaN$ and $Number.isFinite$) across every step.
  3. **Arena Boundary & Out-of-Bounds Probe:** Assert serpent head and body segments remain within arena margins $[0, \text{ArenaW}] \times [0, \text{ArenaH}]$ with boundary clamping/deflection.
  4. **Body Segment Distance & Detachment Probe:** Assert consecutive segment distance $\|P_{i-1} - P_i\| \le 2.5 \times \text{SegmentSpacing}$ at all times without detachment or coordinate corruption.
  5. **Segment Array Integrity & Non-Negative Count:** Assert $Segments.length \ge 0$, no null/undefined entries, and peak length monotonic tracking.
  6. **Rapid 120Hz Oscillating Steering Stress Test:** Subject serpent to extreme direction thrashing ($[-1, 1], [1, -1], [0, 0], [10^6, 10^6], [NaN, NaN]$) confirming smooth angular interpolation and zero NaN propagation.
  7. **Simultaneous Dash + Skill Stress Test:** Trigger simultaneous Dash and Skill on the exact same frame across all 5 classes under wall collision and hazard contact.
  8. **Extreme Edge Wall & Corner Collision:** Slam serpent into all 4 walls and 4 corners at $2.5\times$ dash boost velocity from 8 orthogonal and diagonal angles ($0^\circ, 45^\circ, 90^\circ, 135^\circ, 180^\circ, 225^\circ, 270^\circ, 315^\circ$), verifying tangent deflection without boundary penetration.
  9. **Spatial Hash Grid Malformed & Boundary Stress Test:** Test `SpatialHashGrid` with NaN/Infinity coordinates, negative radii, extreme densities ($> 5000$ entities), out-of-bounds raymarching, and zero-length rays.
  10. **Zero Memory Leak & Finite Heap Growth:** Assert object pools and entity arrays (projectiles, hazards, foods, particles) do not leak dead instances across 100+ consecutive seed executions.

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - `docs/tdd/multi_bot_swarm_and_anomaly_probes_100_seeds.tdd.md`: TDD specification and verification record.
  - `src/sim/SpatialHashGrid.ts`: Enhanced input sanitation guards for non-finite queries, NaN coords, negative radii, and zero-length rays in `insert()`, `queryRadius()`, `queryNearest()`, and `queryRay()`.
  - `src/sim/ai/BehavioralAnomalyDetector.ts`: Extended `AnomalyType` enum and added physical/simulation integrity checks (`ANOMALY_NAN_NUMERIC`, `ANOMALY_OUT_OF_BOUNDS`, `ANOMALY_SEGMENT_DETACHMENT`, `ANOMALY_CORRUPTED_SEGMENT_COUNT`).
  - `src/tests/MultiBotSwarmAnomalyProbes100Seeds.test.ts`: Dedicated 16-test suite executing 125 seeds across all 5 serpent classes and comprehensive edge-case stress probes.

---

## 4. Verification & Quality Check

```bash
npx vitest run src/tests/MultiBotSwarmAnomalyProbes100Seeds.test.ts
npm run typecheck
./verify
```

### Verification Results
- **TypeScript Typecheck:** 100% PASS (`tsc --noEmit` with 0 errors).
- **MultiBotSwarmAnomalyProbes100Seeds:** 16/16 tests PASS across 125 seeds.
- **Repository Quality Gate (`./verify`):** 100/100 test files PASS (1,322 / 1,322 tests passing), Production Web Build PASS.
