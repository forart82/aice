# Feature TDD Specification: Boss Helmets, Cranial Mutation Lab, and Drop Systems Automated Bot Simulation Audit

> **Feature Identifier:** `docs/tdd/boss_helmets_and_cranial_lab_simulation_audit.tdd.md`  
> **Status:** Green (100% Quality Gate Pass)  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-1`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-3`](file:///home/forart/dev/snake_ts/AGENTS.md), [`ORACLE.md#311-cranial-tactical-lab--challenge-gated-tier-progression`](file:///home/forart/dev/snake_ts/ORACLE.md), [`ORACLE.md#312-boss-helmet-equipment--persistent-meta-progression`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Comprehensive automated simulation sweep and architectural audit of Boss Helmets, Cranial Mutation Lab, and Drop Systems across all 20 Apex Boss archetypes and 5 serpent classes.
- **Target Systems:**
  - `src/data/Helmets.ts`: Procedural generation across 20 boss archetypes, 5 rarity tiers, 13 stat affixes, rarity distribution curves.
  - `src/sim/HelmetDrop.ts`: Physical in-world floating drop entity, collision math, auto-vacuum safety.
  - `src/sim/PlayerStats.ts` & `src/sim/SnakePlayer.ts`: 13-affix stat stacking, max HP distribution to head/segments, effective armor clamping, hpRegen ticks, thorns reflection.
  - `src/data/MetaProgression.ts`: Cranial Lab slotting, scaled purchase costs ($30 \cdot \text{lvl} + 15p$ / $40 \cdot \text{lvl} + 20p$), single-challenge unlocks, dynamic arena length scaling with 10ner rounding.
  - `src/platform/SaveIO.ts`: CRC32 checksums, schema v1->v2 migrations, helmet inventory and equipped loadout persistence.
  - `src/sim/ai/AutonomousBotPlayer.ts`: Automated multi-floor campaign simulation probes with zero NaNs, zero exceptions, and full telemetry tracking.

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/BossHelmetsAndCranialLabSimulationAudit.test.ts`
- **Assertions:**
  1. **Boss Helmet Generation & Non-NaN Affix Audit:**
     - 2,000+ Monte Carlo samples across all 20 boss archetypes and 5 rarity tiers produce 0 NaN or undefined stats.
     - Affix counts scale deterministically with rarity (Common=1, Uncommon=2, Rare=3, Epic=4, Legendary=4, Mythic=5).
     - Rarity roll distribution matches `FORMULA_HELMET_RARITY` ($F1: [60, 35, 5, 0, 0]\%$, $F2: [0, 50, 35, 15, 0]\%$, $F3+: [0, 0, 45, 40, 15]\%$).
     - All 20 boss archetypes generate valid thematic prefixes, nouns, and icons with zero fallback generic degradation.
  2. **In-World Drop Physics & Vacuum Safety Audit:**
     - Defeated floor bosses spawn physical `HelmetDrop` entities with non-NaN velocity, position, and pulse.
     - Player head collision collects the drop immediately.
     - Auto-vacuum guarantees zero lost helmets on floor advance and game over transitions.
  3. **Player Stat Stacking & Passive Synergy Audit:**
     - Equipped helmet stats accurately stack additively/multiplicatively with base stats, relics, and alchemical fusions.
     - Max HP properly divides among head (2x) and body segments without fractional loss.
     - Effective armor strictly clamps to $[0, 0.85]$.
     - HpRegen correctly replenishes player HP in `UpdatePassives` every 3.0s.
  4. **Cranial Lab Price Escalation & Challenge Unlocks Audit:**
     - Head module purchase price strictly follows $\text{Cost}(\text{lvl}, p) = 30 \times \text{lvl} + p \times 15$.
     - Head augment purchase price strictly follows $\text{Cost}(\text{lvl}, p) = 40 \times \text{lvl} + p \times 20$.
     - Starter unlocks strictly default to `{ turret: 1, shield: 1 }` on clean run start.
     - Dynamic length challenges evaluate with strict 10ner rounding across diverse arena dimensions ($1600 \times 960, 960 \times 640, 540 \times 960, 360 \times 540$).
  5. **Persistence & Save/Load Roundtrip Audit:**
     - `SaveIO.saveMeta` and `SaveIO.loadMeta` preserve complete helmet inventories and equipped loadout across full serialization cycles with CRC32 integrity verification.
  6. **Autonomous Bot Full-Run Simulation Probe:**
     - `AutonomousBotPlayer` traverses campaign floors, defeats apex bosses, collects helmet drops, equips helmets, and buys cranial upgrades with 0 fatal errors, 0 NaN coordinates, and 100% telemetry consistency.

---

## 3. Implementation Details (Green Phase)

- Author `src/tests/BossHelmetsAndCranialLabSimulationAudit.test.ts`.
- Run Vitest suite and verify 100% PASS.

---

## 4. Verification & Quality Check

```bash
./verify
```
