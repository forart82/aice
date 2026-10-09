# Feature TDD Specification: Human-Like Bot Behavior & Anomaly Audit

> **Feature Identifier:** `docs/tdd/human_like_bot_behavior_and_anomaly_audit.tdd.md`  
> **Status:** Green  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Comprehensive automated test suite and behavioral anomaly audit for `AutonomousBotPlayer` verifying human-like situational decision-making, self-trap prevention at extreme lengths, emergency survival mode, proactive lab transactions, tactical boss kiting, and zero-anomaly 20-floor campaign execution.
- **Target Systems:**
  - `src/sim/ai/AutonomousBotPlayer.ts` (Potential field navigation, lookahead raycasting, survival state machine, tactical combat orbit, proactive Cranial Lab buyer)
  - `src/sim/GameEngine.ts` (120 Hz deterministic simulation, boss spawns, floor transitions)
  - `src/sim/SnakePlayer.ts` (Kinematics, inverse kinematics, Ouro transactions, head modules)
  - `src/data/MetaProgression.ts` (In-run unlock challenges, tier caps)
- **Mechanics Reference:** [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md) § Autonomous Bot Controller & SSOT balance formulas.

---

## 2. Test Plan & Assertions (Red/Green Phase)

- **Test Suite Location:** `src/tests/HumanLikeBotBehaviorAndAnomalyAudit.test.ts`
- **Assertions:**
  1. **Self-Trap Prevention at Long Lengths (50, 100, 200 segments):**
     - Bot steers away from self-body coils in tight bottlenecks.
     - Multi-step lookahead raycasts open clearance and prevents self-constriction.
     - Zero NaN coordinates and zero self-collision traps.
  2. **Emergency Survival State Machine (HP < 35%):**
     - Potion attraction boosted by 3x (weight 45x) when HP < 35%.
     - Bot flees away from threats and avoids direct combat charges when critical.
     - Transitions back to offensive orbit once HP recovers.
  3. **Proactive Cranial Lab Purchasing (0 Hoarding Anomalies):**
     - Bot spends Ouro proactively as soon as balance >= 30 without hoarding.
     - Prioritizes class synergies (Emerald/Hydra defense, Stalker/Solar offense).
     - Atomic deductions enforce valid non-negative balances.
  4. **Boss Charge Dodging & Tactical Orbit Firing (150–250px):**
     - Repels radially outward if closer than 150px from boss.
     - Pulls radially inward if further than 250px from boss.
     - Applies tangential orbital vector in the 150–250px sweet spot.
     - Detects telegraphed charge hazards and applies orthogonal evasion.
  5. **20-Floor Full Campaign Simulation Trace:**
     - Simulates complete traversal across Floors 1 to 20.
     - Defeats all 20 Apex Bosses up to The Eternal Ouroboros.
     - Asserts 0 critical anomalies (zero NaNs, zero deadlocks, zero hoarding, victory achieved).

---

## 3. Implementation Details

- **Files Created/Modified:**
  - `src/tests/HumanLikeBotBehaviorAndAnomalyAudit.test.ts` (Comprehensive 5-section audit suite)
  - `docs/tdd/human_like_bot_behavior_and_anomaly_audit.tdd.md` (Living TDD specification)

---

## 4. Verification & Quality Check

```bash
npx vitest run src/tests/HumanLikeBotBehaviorAndAnomalyAudit.test.ts
./verify
```
