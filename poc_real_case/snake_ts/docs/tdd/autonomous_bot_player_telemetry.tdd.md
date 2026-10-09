# Feature TDD Specification: Autonomous Bot Player and Telemetry Engine

> **Feature Identifier:** `docs/tdd/autonomous_bot_player_telemetry.tdd.md`  
> **Status:** Green / Refactored (100% PASS)  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Production-grade Autonomous Bot Player driving continuous potential field vector navigation, tactical combat triggers, and strategic in-run Cranial Mutation Lab upgrades, paired with a comprehensive Telemetry Engine recording milestones, economic flow, boss encounters, and balance indices.
- **Target Systems:**
  - `src/sim/ai/AutonomousBotPlayer.ts`: Potential field navigator, threat repulsion, combat targeting, bite/weapon aiming, tactical dash/skill executor, and Cranial Lab upgrade agent.
  - `src/sim/ai/BotTelemetryLogger.ts`: Milestone logger, damage/ouro ledger, boss encounter analytics, currency velocity, difficulty progression, survivability index calculator, and export formatting.
  - `src/sim/ai/index.ts`: Module exports.
  - `src/tests/AutonomousBotPlayerAndTelemetry.test.ts`: Dedicated Vitest test suite.
- **Mechanics Reference:** [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)

### Key Requirements:
1. **AutonomousBotPlayer Potential Field Steering:**
   - Attractive vector towards prioritized food (Prisms, Shards, Potions when injured, Golden Apples, Apples).
   - Repulsive vectors away from arena borders, serpent self-body coils/segments, active hazard zones/beams/magma, and enemy collision hulls.
   - Smooth resultant vector normalization and feeding into `ScriptedInput` / `IInput`.
2. **Combat & Tactical Triggers:**
   - Target acquisition: prioritizes vulnerable bosses or nearest high-threat hostile enemies.
   - Bite & weapon firing arc alignment towards target heading.
   - `player.TriggerDash()` activation when cornered/surrounded by multiple enemies or closing in on a vulnerable boss.
   - `player.TriggerSkill()` / `Combat.ActivateSkill()` activation when ready and hostile threats are engaged.
3. **Strategic Cranial Mutation Lab Agent:**
   - Queries `MetaProgression.Instance.IsTierUnlocked(id, tier, context)` for module and augment viability.
   - Determines affordable head weapons (`turret`, `tesla`, `magma`, `venom`, `tachyon`, `cryo`, `plasma`, `flak`, `scattershot`, `needler`), defensive bio-organs (`shield`, `spikes`, `regen`, `magnet`, `chrono`, `nanite`), and cranial bio-augments (`fangs`, `maw`, `horns`, `laser`, `crown`).
   - Automatically executes transactions via `player.SpendOuro()` and `player.InstallHeadModule()` / `player.InstallHeadAugment()`.
4. **BotTelemetryLogger Milestone & Balance Metrics:**
   - Milestone tracking: Floor number, clear time, serpent length, peak length, Ouro collected, Ouro spent in lab, upgrades unlocked vs purchased, damage dealt vs damage taken, boss defeat durations, and outcomes.
   - Balance metrics computation:
     - `Currency Velocity`: Ouro earned per second, Ouro reinvestment ratio.
     - `Difficulty Progression`: Damage received scaling per floor, encounter clear durations.
     - `Survivability Index`: Ratio of damage dealt to damage taken normalized, close call counts.
     - `Effective DPS` & `Clear Rate`.
   - Structured JSON export and formatted ASCII/Markdown summary reports.

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/AutonomousBotPlayerAndTelemetry.test.ts`
- **Assertions:**
  1. `Potential Field Vector Navigation`:
     - 1.1 Attracts towards nearest high-priority food items (Prisms, Potions when injured, Shards).
     - 1.2 Generates repulsive forces pushing away from arena boundaries.
     - 1.3 Generates repulsive forces pushing away from self-body segments (avoiding self-collision/knotting).
     - 1.4 Repels from hazard beams, magma zones, and enemy projectiles.
  2. `Combat Targeting & Tactical Triggers`:
     - 2.1 Aligns direction towards boss/enemy when engaging in combat.
     - 2.2 Triggers tactical dash (`TriggerDash()`) when surrounded by >= 2 close hostiles or closing in on vulnerable boss.
     - 2.3 Triggers class skill (`TriggerSkill()`) when off cooldown in combat.
  3. `Strategic Cranial Mutation Lab Agent`:
     - 3.1 Identifies tier-unlocked affordable head modules and cranial augments.
     - 3.2 Purchases upgrades using `player.SpendOuro()` and installs them via `player.InstallHeadModule()` and `player.InstallHeadAugment()`.
     - 3.3 Rejects locked tiers and unaffordable upgrades without corrupting wallet.
  4. `Structured Telemetry Logging & Milestones`:
     - 4.1 Logs run milestones across floors (floor, clear time, length, peak length, ouro collected/spent, damage dealt/taken).
     - 4.2 Records boss encounters with fight duration, damage stats, and victory/defeat outcome.
     - 4.3 Logs upgrade events (modules, augments, cards) with cost and timestamp.
  5. `Balance Metrics & Telemetry Reports`:
     - 5.1 Computes Currency Velocity (Ouro/sec, reinvestment ratio).
     - 5.2 Computes Difficulty Progression and Survivability Index.
     - 5.3 Produces JSON export and ASCII/Markdown summary report tables.

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - `src/sim/ai/AutonomousBotPlayer.ts`: Complete implementation of potential field navigation, combat steering, tactical dash/skill evaluation, and Cranial Lab upgrade agent.
  - `src/sim/ai/BotTelemetryLogger.ts`: Complete implementation of milestone tracking, boss encounters, upgrade ledgers, balance metric calculations (currency velocity, reinvestment ratio, survivability index, effective DPS, clear rate), and JSON/Markdown export.
  - `src/sim/ai/index.ts`: Module export hub.
  - `src/sim/SnakePlayer.ts`: Added `TriggerDash()`, `TriggerSkill()`, and `SetHeadAugmentLevel()` ergonomics methods.
  - `src/tests/AutonomousBotPlayerAndTelemetry.test.ts`: 16 comprehensive unit & integration tests.

---

## 4. Verification & Quality Check

```bash
npx vitest run src/tests/AutonomousBotPlayerAndTelemetry.test.ts
./verify
```

**Quality Gate Results:**
- TypeScript Typecheck (`tsc --noEmit`): 100% PASS (0 errors)
- Vitest Conformance Matrix: 67 test files, 866 tests PASSED (100% PASS)
- Production Web Build (`npm run build`): 100% PASS
