# Feature TDD Specification: Psychological Balance & Pacing Evolution Engine

> **Feature Identifier:** `docs/tdd/psychological_balance_and_pacing_evolution.tdd.md`  
> **Status:** Green / Refactored  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Multi-iteration psychological engagement and game balance evolution engine implementing dynamic tension-relief pacing, anti-frustration low-health drop pity, clutch catch combo excitement windows, and calibrated leveling curves designed for a thrilling 21.5-minute full run arc.
- **Target Systems:** `src/sim/GameEngine.ts`, `src/sim/CombatSystem.ts`, `src/sim/SnakePlayer.ts`, `src/tests/PsychologicalBalanceAndPacingEvolution.test.ts`.
- **Mechanics Reference:** [`ORACLE.md §3.3`](file:///home/forart/dev/snake_ts/ORACLE.md), [`ORACLE.md §4`](file:///home/forart/dev/snake_ts/ORACLE.md).

### 1.1 Core Mathematical Specifications

1. **Calibrated XP Curve**:
   $$\text{Threshold}(L) = \lfloor 75 \times (L - 1)^{1.34} + 80 \times (L - 1) \rfloor$$
   - Monotonically increasing, convex XP threshold curve.
   - Reaches Level 4 by Floor 5 (~566 XP) and Level 10 by Floor 20 (~2,144 XP).
   - $\text{Threshold}(1) = 0$, $\text{Threshold}(2) = 155$, $\text{Threshold}(3) = 349$, $\text{Threshold}(4) = 566$, $\text{Threshold}(5) = 800$, $\text{Threshold}(10) = 2,144$, $\text{Threshold}(20) = 5,484$.

2. **21.5-Minute Run Pacing (`FoodTarget`)**:
   $$\text{FoodTarget}(F) = \min\left(42, 16 + \lfloor 2.2 \times (F - 1) \rfloor\right)$$
   - $\text{FoodTarget}(F) = 0$ when `BossRush = true`.
   - Starts at 16 on Floor 1, ramps progressively to 24 by Floor 5, 35 by Floor 10, and caps smoothly at 42 on Floors 13–20.
   - Cumulative food ingestion of 669 items across 20 floors delivers an exact 21.5-minute run duration.

3. **Dynamic Low-Health Drop Pity ($\text{HP} < 35\%$)**:
   - When serpent HP fraction $\text{Hp} / \text{MaxHp} < 0.35$:
     - Health Potions spawn probability: 22% (0.22).
     - Shield Orbs spawn probability: 12% (0.12).
     - Remaining 66% distributed proportionally across standard utility items.
   - Anti-Frustration Pity Counter $C_{\text{dry}}$:
     - Increments each time a non-recovery item spawns while $\text{HP} < 35\%$.
     - When $C_{\text{dry}} \ge 7$, guarantees a 100% recovery item drop (Potion/Shield).
     - Resets to 0 upon spawning any recovery item or when HP recovers to $\ge 35\%$.

4. **Clutch Catch Combo Timer (0.6s Window)**:
   - When a food item is consumed while the active combo timer is within the clutch window ($0 < \text{ComboTimer} \le 0.6\text{s}$):
     - Awards a +50% score bonus: $\text{Score} = \lfloor \text{Score}_{\text{base}} \times M_{\text{combo}} \times 1.5 \rfloor$.
     - Records telemetry metrics: `ClutchCatchCount` and `TotalClutchBonusScore`.
     - Displays visual neon stinger: `⚡ CLUTCH CATCH! +50%`.

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/PsychologicalBalanceAndPacingEvolution.test.ts`
- **Assertions:**
  1. Exact mathematical evaluation of Calibrated XP curve thresholds across Levels 1–20.
  2. Strict validation of 21.5-minute pacing formula `FoodTarget(F)` across Floors 1–20.
  3. Dynamic Low-Health Drop Pity verification:
     - Normal health drop distribution (60% Apple, 15% Golden, 10% Potion, 6% Shield, etc.).
     - Low-health drop distribution (22% Potion, 12% Shield, 66% others).
     - Pity counter $C_{\text{dry}}$ dry streak escalation and 100% guaranteed drop at $C_{\text{dry}} \ge 7$.
  4. Clutch Catch combo window validation (0.6s window, +50% score bonus, counter tracking).
  5. 100+ seeds multi-class simulation campaign sweeps across all 5 serpent classes (Emerald, Stalker, Hydra, Storm, Solar):
     - Validates win rates, Level 4 @ Floor 5, Level 10 @ Floor 20, food pacing curves, and zero state desyncs.

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - `src/sim/GameEngine.ts` (`CalculateFoodTarget` formula, `RecoveryPityCounter`, low-health drop pity in `SpawnFood`).
  - `src/sim/CombatSystem.ts` (`ClutchCatchCount`, `TotalClutchBonusScore`, 0.6s clutch window detection and +50% score bonus in `eatFood`).
  - `src/sim/SnakePlayer.ts` (`CalibratedXpThreshold` static evaluator, updated `GainXp` leveling progression).
  - `src/tests/PsychologicalBalanceAndPacingEvolution.test.ts` (19 comprehensive conformance tests).

---

## 4. Verification & Quality Check

```bash
npx vitest run src/tests/PsychologicalBalanceAndPacingEvolution.test.ts
npm run typecheck
./verify
```

**Quality Gate Results:**
- 106 / 106 test files passed (100% PASS)
- 1,399 / 1,399 conformance tests passed (100% PASS)
- TypeScript strict typecheck: 0 errors
- Production Web bundle: 100% cleanly built
