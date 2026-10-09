# Feature TDD Specification: GameEngine State Machine, Floor Transitions, Pause Handling, and Simulation Edge Cases Audit

> **Feature Identifier:** `docs/tdd/game_engine_state_machine_and_edge_cases_audit.tdd.md`  
> **Status:** Green / Verified (100% PASS)  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Comprehensive multi-vector audit of the simulation state machine, floor transitions, pause/unpause lifecycle, simultaneous entity deaths, floor transitions with active projectiles/hazards/telegraphs, replay determinism, and save state integrity.
- **Target Systems:** `src/sim/GameEngine.ts`, `src/sim/GameState.ts`, `src/sim/CombatSystem.ts`, `src/ui/screens/`, `src/platform/SaveIO.ts`.
- **Mechanics Reference:** [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md) § Game Loop, Simulation Timing, State Machine, Progression.

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/GameEngineStateMachineAndEdgeCasesAudit.test.ts`
- **Assertions:**
  1. **State Machine Transitions:**
     - Transitions from Menu -> ClassSelect -> Playing -> Paused -> Playing -> LevelUp -> Playing -> FloorClear -> AdvanceFloor (Playing) -> Victory / GameOver follow exact expected state invariants.
     - `ShowMenu()` gracefully abandons active run, commits partial records, stops music and disables boss mode.
     - Re-triggering `StartRun()` while active properly cleans up previous entities and resets timers.
  2. **Pause / Unpause Edge Cases & Modals:**
     - In-game pause modal, settings, help, and lab unpause paths properly reset accumulator to prevent time-dilation / speedburst jumps upon resumption.
     - Pausing during FloorClear freezes timers and entity motion cleanly.
     - Toggling pause from sub-modals (Settings -> Help -> Resume) restores the active run without abandoning or soft-locking.
  3. **Simultaneous Death Scenarios:**
     - Simultaneous zero-HP frame between Player and Boss deterministically resolves Player death priority (Defeat / GameOver) without crash or state desync.
     - Phoenix Revive relic triggers before death check, consuming 1 charge, healing player, and continuing combat or transitioning to FloorClear if Boss also dies.
     - Simultaneous death of Player and regular enemies on last floor clear condition evaluates defeat cleanly.
  4. **Floor Transitions with Active Projectiles / Hazards / Telegraphs:**
     - Active enemy projectiles, plasma orbs, homing darts, magma hazards, laser zones, and telegraphs are cleanly eradicated upon `AdvanceFloor()`, ensuring zero ghost damage on subsequent floors.
     - Uncollected HelmetDrops on board are automatically vacuumed into player inventory upon floor advance.
     - FloorFoodProgress is reset to 0, FoodTarget is recomputed, and player receives 50% max HP heal.
  5. **Replay Determinism & Save State Reload Integrity:**
     - Seeded run replays with identical scripted input sequences produce 100% bit-exact parity across player position, score, combo, floor food progress, and RNG call counts.
     - SaveIO correctly handles corrupted JSON, truncated checksums, and schema migrations without runtime exceptions or state corruption.

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - `src/tests/GameEngineStateMachineAndEdgeCasesAudit.test.ts`
  - `src/sim/GameEngine.ts` (if any bugs or accumulator edge cases identified)

---

## 4. Verification & Quality Check

```bash
npx vitest run src/tests/GameEngineStateMachineAndEdgeCasesAudit.test.ts
./verify
```
