# Feature TDD Specification: Endgame, 20 Apex Bosses, Multi-Boss Escalation, Boss Rush & Meta-Progression Invariance

> **Feature Identifier:** `docs/tdd/endgame_bosses_and_meta_progression_invariance.tdd.md`  
> **Status:** Green (100% Quality Gate Passed)  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md#the-grand-finale-the-9th-celestial-helmet-galaxy-jump--the-boss-rush-gauntlet`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Comprehensive mechanic invariance, mathematical formulation consistency, and progression integrity audit across the endgame systems of *Ouroboros Ascension*: all 20 Serpentine Apex Bosses, multi-boss escalation (Floor 21+), the 8-second wave Boss Rush Gauntlet, Galaxy Jump prestige sacrifice math, the 8 Unique Relic Helmets & 9th Omni-Helmet Celestial Crown, Cranial Mutation Lab challenge gates, and Sanctuary 14 meta-upgrades.
- **Target Systems:**
  - `src/sim/Boss.ts` (Serpentine kinematics, vertebral HP distribution, phase triggers, damage routing)
  - `src/sim/BossRushGauntlet.ts` (8-second wave cadence, 1800x1800 arena, 0.70x HP scaling, permaloss & victory)
  - `src/sim/GameEngine.ts` (ActiveBosses management, multi-boss escalation, FloorClear/Victory transitions)
  - `src/data/UniqueHelmetsData.ts` (8 Unique Relic Helmets, 9th Omni-Crown, prestige formula, sacrifice scoring)
  - `src/data/MetaProgression.ts` (Challenge matrix, Tiers 1-4 unlocks, Galaxy Jump, Shard persistence)
  - `src/data/GameData.ts` (20 Boss archetypes, 14 Sanctuary meta-upgrades, socket modules)
- **Mechanics Reference:**
  - [`ORACLE.md#table-53-authoritative-boss-archetypes-ssot`](file:///home/forart/dev/snake_ts/ORACLE.md)
  - [`ORACLE.md#6-sanctuary-meta-progression-shop`](file:///home/forart/dev/snake_ts/ORACLE.md)
  - [`ORACLE.md#the-grand-finale-the-9th-celestial-helmet-galaxy-jump--the-boss-rush-gauntlet`](file:///home/forart/dev/snake_ts/ORACLE.md)

---

## 2. Test Plan & Assertions

- **Test Suite Location:** `src/tests/EndgameBossesAndMetaProgressionInvariance.test.ts`
- **Audit Target Areas & Assertions:**
  1. **20 Apex Boss Guardians & Serpentine Kinematics:**
     - All 20 Bosses instantiate with exact archetype identifiers, health scaling, and serpentine segment count.
     - Vertebral health distribution assigns unit HP across segments such that `HeadHp + sum(segments.Hp) === MaxHp` and `Hp === MaxHp`.
     - Segment radii taper from `baseRad` toward the tail down along the spine ($R \ge 8$).
     - Serpentine kinematics maintain follow-the-leader chain during movement simulation.
     - Phase 2 transition activates strictly when HP falls to `<= 50% MaxHp`, setting `AttackTimer` to 0.9s and triggering `OnPhaseChange`.
     - Damage to head routes from tail forward, popping depleted segments until lone head remains.
  2. **Multi-Boss Escalation (Floors 21+):**
     - Single-boss spawning on Floors 1-20.
     - Escalating horde on Floors 21+: 2 bosses (F21-30), 3 bosses (F31-40), 4 bosses (F41-50), 5 bosses (F51-60), 6 bosses (F61+).
     - Multi-bosses spawn with `0.75` HP scaling and perimeter safe-distance distribution ($> 100\text{ px}$ spacing).
     - Sequential defeat handling: floor clear is gated until every active boss is eliminated.
  3. **Boss Rush Gauntlet (Floor 99 Celestial Rift):**
     - Arena operates at $1800 \times 1800\text{ px}$ scale.
     - Wave timer counts down with 8.0-second cadence through all 8 canonical archetypes.
     - Gauntlet bosses apply $0.70\times$ calibrated HP scaling.
     - Player defeat triggers High-Stakes Permaloss: `MetaProgression.UniqueHelmets` is wiped to `[]`.
     - Gauntlet victory permanently retains the 9th Omni-Helmet ("The Celestial Crown of the Eternal Ouroboros").
  4. **Galaxy Jump Prestige Formula & Sacred Invariants:**
     - Prestige Multiplier obeys $P_{\text{mult}} = 1 + 0.5 \times N_{\text{helmets}} + 0.1 \times \text{Floor}$.
     - Sacrifice score scales by item value ($50 \times \text{affixes} + 10 \times \text{floor} + \text{power}$) and rarity multipliers ($1.0, 1.5, 2.5, 4.0, 7.0$).
     - Manifestation probability adheres to $P = 1 - \exp(-S / 800)$ (milestone $P(800) = 63.2\%$).
     - Consolation bonus on failed roll ($\lfloor S \times 2.5 \rfloor$ Ouro, $\lfloor S / 20 \rfloor$ Shards).
     - Standard helmets are consumed; persistent Shards, Ouro, and unlocked Unique Helmets are preserved.
  5. **8 Unique Relic Helmets & 9th Omni-Helmet Synthesis:**
     - Exactly 8 unique helmets with canonical IDs, aliases, gold-brown cosmic aesthetic, and unique signature capacities.
     - 9th Celestial Crown requires 8/8 unique helmets collected; cannot forge before 100% completion.
     - 9th Omni-Helmet aggregates stat sums across all 8 relics and activates all 8 signature abilities.
  6. **Cranial Mutation Lab & Challenge Unlock Gates:**
     - Starter defaults unlock strictly Tier 1 Turret and Tier 1 Shield.
     - Tiers 1-3 challenge matrix validates kills, combos, bestiary hunts, and scaled serpent length requirements.
     - Module pricing formula: $30 \times \text{lvl} + p \times 15$.
     - Augment pricing formula: $40 \times \text{lvl} + p \times 20$.
  7. **Sanctuary Shop 14 Meta-Upgrades:**
     - 9 Core Blessings and 5 Blueprint Unlocks verified against ORACLE specs.
     - Cost scaling follows $\lfloor \text{BaseCost} \times \text{CostMult}^{\text{level}} \rceil$.
     - Max rank caps enforce `Infinity` cost and prevent further purchases.

---

## 3. Implementation Details & Test Results

- **Files Created:**
  - [`docs/tdd/endgame_bosses_and_meta_progression_invariance.tdd.md`](file:///home/forart/dev/snake_ts/docs/tdd/endgame_bosses_and_meta_progression_invariance.tdd.md)
  - [`src/tests/EndgameBossesAndMetaProgressionInvariance.test.ts`](file:///home/forart/dev/snake_ts/src/tests/EndgameBossesAndMetaProgressionInvariance.test.ts)
- **Verification Results:**
  - `npx vitest run src/tests/EndgameBossesAndMetaProgressionInvariance.test.ts`: **23/23 tests PASSED (100%)**
  - `npm run typecheck`: **Strict zero-error compilation (0 errors)**
  - `./verify`: **162/162 test files PASSED, 2179/2179 tests PASSED, Vite production build PASSED**
