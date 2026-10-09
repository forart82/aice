# Feature TDD Specification: Core Simulation & Kinematics Architecture Refactoring

> **Feature Identifier:** `docs/tdd/architecture_simulation_refactoring.tdd.md`  
> **Status:** Green / Refactored (100% Passing Strict Typecheck & Complete Verification Gate)  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-1`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-3`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-6`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-10`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Step 5 of the Big Audit focuses on structural maintainability, readability, strict type safety, and modular decoupling across the Core Simulation & Kinematics Architecture (`src/sim/`, `src/core/`).
- **Target Systems:**
  - `src/core/MathX.ts` & `src/core/Vec2.ts`: Mathematical utility extensions (`distSq`, `dist`, `circleOverlap`, `decayTimer`, `clampToBounds`, `distanceToCoords`).
  - `src/core/Contracts.ts` & `src/core/Services.ts`: Strict service contracts (`IDamageable`, `ISimEngine`, `IUiRoot`, generic `IServiceContainer`).
  - `src/sim/World.ts`: Centralized static typed accessors (`World.getPlayer`, `World.getFoods`, `World.getEnemies`, `World.getProjectiles`, `World.getBosses`, `World.getHazards`) to eliminate repetitive defensive boilerplate and `as any` casts.
  - `src/sim/SpatialHashGrid.ts`: Elimination of loose `any` signatures in `queryRadius` overload implementations.
  - `src/sim/CombatModules.ts` & `src/sim/CombatSkills.ts`: Elimination of 40+ instances of `as any` when accessing world entities.
  - `src/sim/SnakePlayer.ts`: Strict typing of `ISteerInput`, `EquippedHelmet`, `Services`, `TriggerSkill`, `Autotomy`, `ResolveTailWhipCollision`, and declarative timer decay.
  - `src/sim/CombatSystem.ts`: Strict typing of `engine?: GameEngine`, `getActiveBosses`, `checkEncirclement`, `applyConstrictionDamage`, and projectile filtration.
  - `src/sim/Boss.ts` & `src/sim/Enemy.ts`: Strict typing of `ITelegraphAttack[]`, `IDamageable`, and declarative timer decay.
  - `src/sim/GameEngine.ts` & `src/sim/BossRushGauntlet.ts`: Strict typing of `saveIO`, `uiRoot`, `engine`, and helmet inventory checks.
- **Architectural Constraints:**
  - Strict preservation of ALL public methods, properties, getters, setters, and aliases (100% backwards compatibility).
  - Absolute Headless Independence (Rule 6: Zero DOM/browser types in `src/core/` and `src/sim/`).
  - Zero changes to physical formulas, balance values, or kinematic constants from `ORACLE.md`.

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/SimulationArchitectureRefactoring.test.ts`
- **Assertions:**
  1. **MathX & Vec2 Extensions**:
     - `MathX.distSq(x1, y1, x2, y2)` computes exact squared Euclidean distance matching `(x2-x1)^2 + (y2-y1)^2`.
     - `MathX.dist(x1, y1, x2, y2)` computes hypotenuse length with NaN safety.
     - `MathX.circleOverlap(x1, y1, r1, x2, y2, r2)` accurately determines intersecting and non-intersecting radial bounds.
     - `MathX.decayTimer(timer, dt)` decrements timers monotonically down to exactly zero without negative drift.
     - `MathX.clampToBounds(x, y, margin, width, height)` clamps coordinates inside boundary margins.
     - `Vec2.distanceToCoords(x, y)` and `Vec2.distanceSquaredToCoords(x, y)` compute distance without vector allocation.
  2. **World Typed Accessors**:
     - `World.getPlayer(world)` returns the player instance safely from both camelCase and PascalCase properties.
     - `World.getEnemies(world)`, `World.getBosses(world)`, `World.getProjectiles(world)`, `World.getFoods(world)`, `World.getHazards(world)` return guaranteed arrays even when properties are empty or null.
  3. **SnakePlayer & Kinematic Contracts**:
     - `SnakePlayer.update(dt, steer, arenaW, arenaH, world)` accepts typed `ISteerInput` and preserves deflection kinetics.
     - `SnakePlayer.EquipHelmet` and `SnakePlayer.helmet` getter/setter operate with strict `HelmetDef | null` type safety.
     - `SnakePlayer.TriggerSkill`, `Autotomy`, and `ResolveTailWhipCollision` accept typed references and preserve identical combat values.
  4. **SpatialHashGrid Overload Strictness**:
     - `SpatialHashGrid.queryRadius` executes correctly without `any` parameter types across single-layer and multi-layer masks.
  5. **CombatSystem & CombatModules Modular Decoupling**:
     - `getActiveBosses(world)` operates safely without `any` parameter types.
     - `CombatSystem.Engine` is strongly typed to `GameEngine`.
     - `CombatModules` executes head module actions through `World` accessors with zero `as any` casts.
     - `Boss.telegraphs` strongly typed to `ITelegraphAttack[]`.
  6. **Non-Regression & Conformance**:
     - Full conformance matrix passes across `SelfTest.test.ts`, `CombatFusionsAndStatusInvariance.test.ts`, and `KinematicsAndCollisionInvariance.test.ts`.

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - `src/core/MathX.ts`: Added zero-allocation distance, overlap, decay, and clamp functions with Rule 10 docstrings and aliases.
  - `src/core/Vec2.ts`: Added `distanceToCoords` / `distanceSquaredToCoords` avoiding intermediate vector object allocations.
  - `src/core/Contracts.ts`: Added `IDamageable`, `ISimEngine`, `IUiRoot`.
  - `src/core/Services.ts`: Generic `IServiceContainer<TEngine, TMeta>`.
  - `src/sim/World.ts`: Added static accessor methods `World.getPlayer`, `World.getFoods`, `World.getEnemies`, `World.getBosses`, `World.getProjectiles`, `World.getHazards`, `World.getNearestFood`.
  - `src/sim/SpatialHashGrid.ts`: Cleaned up multi-layer callback type signature overloads.
  - `src/sim/CombatModules.ts`: Replaced 30+ instances of `(ctx.world as any)` with static `World` accessors.
  - `src/sim/CombatSkills.ts`: Replaced 15+ instances of `(world as any)` with static `World` accessors.
  - `src/sim/SnakePlayer.ts`: Added `ISteerInput`, `IHelmetLike`, strongly typed `ResolveTailWhipCollision`, `Autotomy`.
  - `src/sim/CombatSystem.ts`: Strongly typed `engine?: GameEngine`, `getActiveBosses`, `checkEncirclement`, `applyConstrictionDamage`, and `fuseEncircledFoodIntoPrism`.
  - `src/sim/Boss.ts`: Defined `ITelegraphAttack` supporting radial, cone, and line attacks.
  - `src/sim/Enemy.ts`: Typed `TakeDamage` source.
  - `src/sim/GameEngine.ts`: Safely narrowed options in constructor and `Services.registerEngineProvider`.
  - `src/sim/BossRushGauntlet.ts`: Type safe helmet push.
  - `src/tests/SimulationArchitectureRefactoring.test.ts`: Dedicated 12-test suite for refactored simulation architecture.

---

## 4. Verification & Quality Check

```bash
# 1. Vitest Suite
npx vitest run src/tests/SimulationArchitectureRefactoring.test.ts src/tests/SelfTest.test.ts src/tests/CombatFusionsAndStatusInvariance.test.ts src/tests/KinematicsAndCollisionInvariance.test.ts
# Result: 4 test files, 95/95 tests PASS (0 failures)

# 2. Strict Typecheck
npm run typecheck
# Result: tsc --noEmit: 100% PASS (Zero Errors)

# 3. Complete Quality Gate
./verify
# Result: 100% PASS
```
