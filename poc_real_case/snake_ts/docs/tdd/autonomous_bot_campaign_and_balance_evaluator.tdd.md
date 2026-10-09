# Feature TDD Specification: Autonomous Bot Campaign Test Suite and Balance Evaluator

> **Feature Identifier:** `docs/tdd/autonomous_bot_campaign_and_balance_evaluator.tdd.md`  
> **Status:** Green & Verified  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Comprehensive automated test suite and balance evaluator running an autonomous intelligent bot through complete multi-floor campaigns, testing all 4 game modes (`rogue`, `endless`, `bossrush`, `daily`), verifying 20 Apex Boss encounters and Floor 21+ multi-boss escalations, logging telemetry, and asserting economic/progression balance criteria.
- **Target Systems:** `src/tests/AutonomousBotCampaign.test.ts`, `src/sim/`, `src/core/`, `src/data/`.
- **Mechanics Reference:** [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)

### Key Requirements:
1. **20-Floor Campaign & Apex Boss Progression:**
   - Autonomous bot navigates through 20 floors of encounters.
   - Verifies combat progression against all Apex Bosses: Centipede Behemoth (F1), Storm Gorgon (F2), Infernal Colossus (F3), Glacial Behemoth (F4), Chrono Wyrm (F5), Bio-Venom Hivemind (F6), Apex Superconductor (F7), Astral Leviathan (F8), Quantum Hydra (F9), Shadow Doppelgänger (F10), Void Devourer (F11), Magnetic Dreadnought (F12), Aegis Juggernaut (F13), Dyson Archon (F14), Prismatic Arachnid (F15), Tempest Siren (F16), Nanite Hive Titan (F17), Plasma Phase Specter (F18), Volcanic Chimera (F19), The Eternal Ouroboros (F20).
2. **Floor 21+ Multi-Boss Escalation:**
   - Verify dual-boss spawning on Floors 21-30 and tri-boss spawning on Floors 31-40.
   - Verify simultaneous boss stepping, combat state retention, and floor completion only after all active bosses are defeated.
3. **All 4 Game Modes Correctness:**
   - `rogue`: 10-floor standard run with draft level-ups and victory on Floor 10 boss defeat.
   - `endless`: Infinite floor scaling, verifying seamless progression past floor 20.
   - `bossrush`: 20 floors with immediate boss spawns (0 food required) and rapid boss gauntlet.
   - `daily`: 20 floors with deterministic seed and 4-tier Cosmic Special Capacity unlock/escalation at Levels 5, 10, 15, 20.
4. **Telemetry Collection & Logging:**
   - Capture run telemetry across all runs: floor reached, survival time, level, kills, food eaten, boss kills, max combo streak, Ouro collected/spent, upgrades purchased per floor, challenges unlocked.
5. **Balance Criteria Assertions:**
   - Ouro economy: Bot collects enough Ouro to purchase at least 1-2 upgrades per floor (35-80+ Ouro/floor).
   - Challenge unlock pacing: Challenges across Tiers 1-3 unlock smoothly with food, kill, boss, and length milestones.
   - Difficulty curve scaling: Progressive scaling of enemy stats and boss HP without unplayable spikes.

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/AutonomousBotCampaign.test.ts`
- **Assertions:**
  1. `1. 20-Floor Campaign & Apex Boss Progression`:
     - 1.1 Evaluates autonomous bot traversing all 20 floors with Apex Boss defeats.
     - 1.2 Verifies defeat of key Apex Bosses (Centipede, Gorgon, Colossus, Chrono Wyrm, Leviathan, Doppelgänger, Arachnid, Titan, Eternal Ouroboros).
     - 1.3 Verifies helmet drop creation and auto-collection upon boss defeat.
  2. `2. Floor 21+ Multi-Boss Gauntlet & Escalation`:
     - 2.1 Spawns dual bosses on Floors 21-30 and asserts concurrent combat engagement.
     - 2.2 Spawns tri bosses on Floors 31-40 and asserts concurrent combat engagement.
     - 2.3 Validates that floor remains active until all simultaneous bosses are eliminated.
  3. `3. Correctness Across All 4 Game Modes`:
     - 3.1 `rogue` mode: 10 floors, boss on each floor, victory on Floor 10 clear.
     - 3.2 `bossrush` mode: Immediate boss spawning without food threshold, clearing 20 bosses in sequence.
     - 3.3 `daily` mode: Seeded run unlocking Cosmic Special Capacities and escalating at Levels 5, 10, 15, 20.
     - 3.4 `endless` mode: Endless floor progression past Floor 20 with scaling difficulty.
  4. `4. Comprehensive Telemetry & Analytics Logging`:
     - 4.1 Collects detailed per-floor and end-of-run telemetry records.
     - 4.2 Aggregates telemetry across multiple seeds and evaluates performance bounds.
  5. `5. Game Balance Criteria & Progression Smoothness`:
     - 5.1 Ouro accumulation rate enables purchasing at least 1-2 upgrades per floor (35-80+ Ouro/floor).
     - 5.2 In-run challenges unlock progressively with serpent growth, food, kills, and bosses.
     - 5.3 Difficulty curves (enemy HP/dmg, boss HP) scale monotonically without discrete difficulty spikes.

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - `src/tests/AutonomousBotCampaign.test.ts` (13 comprehensive tests covering all 5 specification groups)
  - `docs/tdd/autonomous_bot_campaign_and_balance_evaluator.tdd.md`

---

## 4. Verification & Quality Check

```bash
npx vitest run src/tests/AutonomousBotCampaign.test.ts
./verify
```

### Actual Results:
- `AutonomousBotCampaign.test.ts`: 13/13 tests PASS.
- Full quality gate `./verify`: Strict Typecheck + All Vitest Suites (66 test files, 850 tests) PASS 100%.
