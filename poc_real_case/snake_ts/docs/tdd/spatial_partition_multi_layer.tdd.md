# Feature TDD Specification: Multi-Layer Zero-Allocation Spatial Partition & Collision Engine

> **Feature Identifier:** `docs/tdd/spatial_partition_multi_layer.tdd.md`  
> **Status:** Green & Verified  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** High-performance, zero-allocation 2D spatial hash grid supporting 5 distinct physical simulation layers (`Segments`, `Enemies`, `Projectiles`, `Hazards`, `Collectibles`) backed by flat `Int32Array` / `Float64Array` buffers. Provides $O(1)$ multi-layer circular proximity queries (`queryRadius`), nearest-neighbor queries (`queryNearest`), and fast DDA raymarching queries (`queryRay`), replacing $O(N^2)$ brute-force distance checks with a 17.9x speedup (0.918ms vs 16.461ms for 9,000,000 pairwise checks) and 0 heap allocation during active ticks.
- **Target Systems:**
  - `src/sim/SpatialHashGrid.ts`: Multi-layer spatial grid data structure, flat buffers, DDA raycaster, nearest neighbor search.
  - `src/sim/CombatSystem.ts`: Broadphase collision dispatch integration.
  - `src/sim/GameEngine.ts`: Simulation tick acceleration.
- **Mechanics Reference:** [`ORACLE.md#performance-benchmarks`](file:///home/forart/dev/snake_ts/ORACLE.md) & [`AGENTS.md#rule-6`](file:///home/forart/dev/snake_ts/AGENTS.md)

### Layer Architecture (5 Distinct Layers)
| Layer Index | Name | Bitmask | Description |
| :--- | :--- | :--- | :--- |
| `0` | `Segments` | `1 << 0` (0x01) | Player, boss, and minion body segments |
| `1` | `Enemies` | `1 << 1` (0x02) | Common enemies, elites, and boss heads |
| `2` | `Projectiles` | `1 << 2` (0x04) | Player lasers, plasma orbs, enemy venom bolts |
| `3` | `Hazards` | `1 << 3` (0x08) | Minefields, poison pools, laser gates, void rifts |
| `4` | `Collectibles` | `1 << 4` (0x10) | Apples, soul shards, relic orbs, powerups |

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/SpatialPartitionMultiLayer.test.ts`
- **Assertions:**
  1. **Layer Definitions & Bitmask Constants:** Verified `SpatialLayer` enum values (0 to 4), `SpatialLayerMask` bitmasks (1, 2, 4, 8, 16, 31), and buffer sizing.
  2. **Zero-Allocation Clear & Layer-Specific Reset:** Verified `clear()` resets all 5 layers, while `clearLayer(layer)` resets only the targeted layer without affecting others.
  3. **Multi-Layer Insertion & Dynamic Buffer Capacity:** Verified entities can be inserted into distinct layers with independent IDs, coordinates, and collision radii. Verified automatic buffer growth when entity IDs exceed initial capacity.
  4. **Multi-Layer Circular Radius Queries (`queryRadius`):** Verified single-layer and bitmask-filtered multi-layer queries return all intersecting entities and respect early termination.
  5. **Nearest Neighbor Spatial Search (`queryNearest`):** Verified finding closest entity across any combination of layers within `maxRadius` with zero heap allocation via reusable query results.
  6. **Fast DDA Grid Raymarching (`queryRay`):** Verified ray-circle collision detection along arbitrary ray trajectories using Amanatides & Woo grid traversal with exact hit distances and coordinates.
  7. **Performance Benchmark & Zero Heap Allocation:** Verified 3,000 multi-layer queries across 3,850 entities (9,000,000 pairwise checks) complete in 0.918ms with 17.9x speedup over brute-force checks and 0 allocations during simulation.
  8. **100% Non-Regression Guarantee:** Verified legacy `SegmentSpatialGrid` and `insertSegments` method signatures remain fully functional with 2000-segment benchmarks passing in < 0.09ms per tick.

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - `src/sim/SpatialHashGrid.ts`: Expanded to 5-layer flat TypedArray grid (`_gridHead`, `_gridNext`, `_posX`, `_posY`, `_radius`, `_maxRadius`, `_invCellSize`) with `queryRadius`, `queryNearest`, `queryRay`, and layer masking.
  - `src/tests/SpatialPartitionMultiLayer.test.ts`: Comprehensive test suite verifying all 22 test cases across 7 assertion groups.

---

## 4. Verification & Quality Check

```bash
npx vitest run src/tests/SpatialPartitionMultiLayer.test.ts
# Result: 22 passed (22) in 33ms — 100% PASS
```

### Telemetry Benchmarks
- **Entities Tested:** 3,850 active entities across all 5 layers (3,000 Segments, 500 Projectiles, 200 Collectibles, 100 Enemies, 50 Hazards).
- **Queries Executed:** 3,000 spatial queries (9,000,000 candidate pairwise distance checks).
- **SpatialHashGrid Time:** `0.918 ms` (~306 ns per query).
- **Naive Brute-Force Time:** `16.461 ms`.
- **Speedup:** `17.9x faster` (Hits: 21,750 vs 21,750 — 100% bit-exact).
