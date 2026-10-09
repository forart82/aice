# Feature TDD Specification: Autonomous Bot Cognitive Policy & Lookahead Upgrade

> **Feature Identifier:** `docs/tdd/autonomous_bot_cognitive_policy_and_lookahead.tdd.md`  
> **Status:** Green / Refactored (100% PASS)  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Upgraded `AutonomousBotPlayer.ts` with human-like cognitive policies, forward multi-step raycasting (3–5 steps ahead), flood-fill open space verification against self-entrapment and wall dead-ends, a survival state machine (Emergency Mode kiting with 3x potion/shield attraction, Tactical Combat Orbit at 150-250px), and a proactive, class-synergistic Cranial Lab Shopper.
- **Target Systems:**
  - `src/sim/ai/AutonomousBotPlayer.ts`: Cognitive steering, raycasting, flood-fill space verification, survival state machine, and synergistic cranial shopper.
  - `src/tests/AutonomousBotCognitivePolicy.test.ts`: Dedicated Vitest unit & integration suite.
- **Mechanics Reference:** [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)

### Key Requirements:
1. **Multi-Step Lookahead & Flood-Fill Space Verification:**
   - Multi-step forward raycasting (3–5 steps ahead along 16 radial candidate trajectories, step distance = 28px).
   - Collision and trap evaluation against arena boundaries, trailing serpent body coils/segments ($i \ge 3$), active hazards, and boss collision boxes.
   - Flood-fill / open maneuvering space verification: Computes reachable free space from predicted endpoints.
   - Rejects or heavily penalizes directions where open space < required clearance for serpent length ($L \times \text{spacing}$), preventing self-coiling entrapment and corner dead-ends.
2. **Human-Like Survival State Machine:**
   - **Emergency Mode (`HP < 35%` / `hpFrac < 0.35`):**
     - Prioritizes evasive kiting, dodging away from nearest enemies and bosses with amplified repulsion (2.8x).
     - Seeks health potions (`potion`) and shield orbs (`shield`) with **3x attractive force** (potion weight = 45.0, shield weight = 10.5).
   - **Tactical Combat Orbit:**
     - Orbits bosses at optimal weapon firing distance (**150–250px**, nominal $\approx 200\text{px}$).
     - Applies radial repulsion when closer than 150px (2.5x), radial attraction when further than 250px (1.5x), and balanced tangential orbital steering to circle the boss continuously while aligning weapon firing arcs.
   - **Normal / Foraging Mode:**
     - Sustenance farming, high-value food prioritization (Prisms, Shards, Golden Apples), and combat assault when safe.
3. **Proactive Cranial Lab Shopper:**
   - Triggers purchases proactively whenever Ouro $\ge 30$ and an upgrade tier is unlocked, prior to boss encounters and during progression.
   - Evaluates synergistic builds tailored to serpent class:
     - **Emerald / Hydra (Defense/Sustain):** Prioritizes defensive modules and augments (`shield`, `regen`, `spikes`, `nanite`, `chrono`, `horns`, `crest`).
     - **Stalker / Solar / Storm (Offense/Energy/DPS):** Prioritizes offensive modules and augments (`plasma`, `magma`, `tachyon`, `laser`, `turret`, `tesla`, `flak`, `scattershot`, `needler`, `fangs`, `maw`, `crown`).
   - Uses `player.SpendOuro()` and installs via `player.InstallHeadModule()` / `player.InstallHeadAugment()`.

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/AutonomousBotCognitivePolicy.test.ts`
- **Assertions:**
  1. `Multi-Step Lookahead & Space Verification`:
     - 1.1 Evaluates forward 3–5 step raycasting and steers away from paths heading directly into arena boundaries or corners.
     - 1.2 Detects narrow coils/loops created by trailing body segments and steers towards open space exceeding serpent length.
     - 1.3 Verifies flood-fill space verification prevents self-entrapment in tight U-turn pockets.
  2. `Human-Like Survival State Machine`:
     - 2.1 Enters Emergency Mode when HP < 35%, boosting potion and shield attraction weights by 3x.
     - 2.2 In Emergency Mode, kites away from encroaching enemies with amplified repulsive velocity.
     - 2.3 Engages bosses in Tactical Combat Orbit, maintaining 150–250px distance and orbiting tangentially.
     - 2.4 Pushes outward when < 150px from boss to avoid boss collision hull.
     - 2.5 Closes distance when further than 250px from boss.
  3. `Proactive & Synergistic Cranial Lab Shopper`:
     - 3.1 Proactively triggers purchases when Ouro >= 30 before boss encounters or in run.
     - 3.2 For Emerald and Hydra classes, prioritizes defensive armor, shields, and regen upgrades.
     - 3.3 For Stalker, Solar, and Storm classes, prioritizes offensive plasma, magma, lasers, and spitters.
     - 3.4 Exhausts available Ouro on synergistic items while maintaining atomic wallet integrity.

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - `src/sim/ai/AutonomousBotPlayer.ts`: Implementation of lookahead raycaster (`evaluateLookaheadAndSpace`), flood-fill space estimator (`sampleAccessibleSpace`), survival state machine (Emergency Mode, Combat Orbit, Foraging Mode), and class-synergistic Cranial Lab shopper (`evaluateLabPurchases`, `performLabPurchases`).
  - `src/tests/AutonomousBotCognitivePolicy.test.ts`: 12 comprehensive unit & integration tests.
  - `src/tests/MultiBotSwarmSweeps.test.ts`: Fixed typed signatures for constructor and method invocations.

---

## 4. Verification & Quality Check

```bash
npx vitest run src/tests/AutonomousBotCognitivePolicy.test.ts src/tests/AutonomousBotPlayerAndTelemetry.test.ts src/tests/AutonomousBotCampaign.test.ts src/tests/MultiBotSwarmSweeps.test.ts
npm run typecheck
```

**Quality Gate Results:**
- TypeScript Typecheck (`tsc --noEmit`): 100% PASS (0 errors)
- Vitest Bot Conformance Matrix: 4 test suites, 64 tests PASSED (100% PASS)
