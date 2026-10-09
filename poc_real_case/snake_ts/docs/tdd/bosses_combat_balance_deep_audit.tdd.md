# Feature TDD Specification: Bosses & Apex Guardians Combat Balance Deep Audit

> **Feature Identifier:** `docs/tdd/bosses_combat_balance_deep_audit.tdd.md`  
> **Status:** Red -> Green -> Refactored  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md#5.3`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Deep algorithmic and automated bot simulation audit of Bosses & Apex Guardians Combat Balance across Floors 5, 10, 15, and 20, as well as multi-boss escalations (Floors 21–40).
- **Core Audits:**
  1. **Archetype Behaviors & Multi-Boss Scaling**: Centipede Behemoth / Prime, Storm Gorgon / Hydra Guardian, Mirror Wyrm / Phantom Weaver, Infernal Colossus / Magma Behemoth, and multi-boss escalation in `src/sim/Boss.ts`.
  2. **Health Scaling, Enrage Timers & Damage Formulas**: Base HP and HP per floor scaling formula, Phase 2 enrage transitions at <= 50% HP with 0.9s immediate attack reset, contact damage formula ($16 + 3 \times \text{Floor}$), and projectile damage ($18 + 2 \times \text{Floor}$).
  3. **Telegraph Windows & Kinematic Speeds vs Hitboxes**: Reaction and escape window verification for hazard telegraphs (0.75s–1.15s) and bullet speeds (150–240 px/s) vs player movement speed (190 px/s) and player hitbox ($R=14\text{px}$, $D=28\text{px}$).
  4. **Modular Segment Damage vs Head Damage**: Serpentine modular damage routing, player head bite vs body segment bite damage and risk trade-off, dashing invulnerability, and downstream segment severing.
  5. **50-Seed Bot Simulation Sweeps**: Automated bot runs across 50 deterministic seeds per milestone floor (Floor 5, 10, 15, 20, 25) measuring win rates, TTK (min, max, mean, median, std dev), player HP retention, and phase synchronization integrity.
- **Target Systems:**
  - `src/sim/Boss.ts` (Archetype AI, kinematics, telegraphs, phase transitions, multi-boss HP modifier)
  - `src/sim/CombatSystem.ts` (Collision hulls, head vs segment bites, contact damage routing, dashing immunity)
  - `src/sim/ai/AutonomousBotPlayer.ts` (Combat steering, threat repulsion, tactical dashing, cranial lab upgrades)
  - `src/tests/BossCombatBalanceDeepAudit.test.ts` (Comprehensive 50-seed simulation and mathematical assertion suite)
- **Mechanics Reference:** [`ORACLE.md#3.5`](file:///home/forart/dev/snake_ts/ORACLE.md#3.5-modular-segment--head-health-kinematics), [`ORACLE.md#5.3`](file:///home/forart/dev/snake_ts/ORACLE.md#5.3-boss-guardians-20-apex-bosses--multi-boss-escalation), [`ORACLE.md#5.3.1`](file:///home/forart/dev/snake_ts/ORACLE.md#5.3.1-multi-boss-escalation-rule-floors-21)

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/BossCombatBalanceDeepAudit.test.ts`
- **Assertions:**
  1. **Boss Archetype Mechanics & Multi-Boss Escalation Verification**:
     - Floor 1 Centipede Behemoth (Prime): 16 segments, 3-way spread (P1) -> 5-way spread (P2) with 185 px/s speed.
     - Floor 5 Chrono Wyrm: 22 segments, double-spiral temporal orbs, 0.8s chrono ground telegraphs.
     - Floor 9 Quantum Hydra: 14-22 segments, 3700 base HP, quantum phase coils.
     - Floor 10 Shadow Doppelgänger (Phantom Weaver): 4500 base HP, mirror trajectory and shadow daggers.
     - Floor 15 Prismatic Arachnid: 10,000 base HP, rotating crystal prism matrices.
     - Floor 19 Volcanic Chimera (Magma Behemoth): 17,000 base HP, magma fountains and obsidian boulders.
     - Floor 20 The Eternal Ouroboros: 20,000 base HP, 40px radius, full bullet hell climax.
     - Floor 21-30 Dual Boss Escalation: 2 simultaneous bosses with 0.75x MultiBossScale HP.
     - Floor 31-40 Tri Boss Escalation: 3 simultaneous bosses with 0.75x MultiBossScale HP.
  2. **Health Scaling, Enrage Timers & Damage Formulation Matrix**:
     - HP formula monotonicity and cycle scaling.
     - Phase 2 transition triggered exactly at `<= 50% HP`.
     - Enrage immediate attack reset to `0.9s`.
     - Contact damage strictly equals $16 + \text{Floor} \times 3$.
     - Bullet damage strictly equals $18 + \text{Floor} \times 2$.
  3. **Telegraph Windows & Kinematic Speeds vs Hitboxes**:
     - Escape window calculations confirm player base speed (190 px/s) can safely exit 40-52px radius hazard zones within 0.75s-1.15s telegraphs with $>0.40\text{s}$ reaction cushion.
     - Projectile speed ratio to player speed allows viable dodge corridors.
  4. **Modular Serpentine Segment Damage vs Head Damage**:
     - Head bite inflicts 100% damage and takes full contact damage.
     - Body segment bite inflicts 45% damage and takes 55% contact damage.
     - Dashing grants complete contact damage immunity during attack runs.
     - Segment HP exhaustion causes clean downstream severing, protecting the serpent head.
  5. **50-Seed Automated Bot Simulation Sweeps & TTK Distributions**:
     - Floor 5 (Chrono Wyrm): 50 seeds, TTK metrics, >90% bot win rate.
     - Floor 10 (Shadow Doppelgänger): 50 seeds, TTK metrics, >85% bot win rate.
     - Floor 15 (Prismatic Arachnid): 50 seeds, TTK metrics, >80% bot win rate.
     - Floor 20 (The Eternal Ouroboros): 50 seeds, TTK metrics, >75% bot win rate.
     - Floor 25 (Dual Boss Escalation): 50 seeds, TTK metrics, >70% bot win rate.
     - Zero NaN coordinates, zero arena out-of-bounds clipping, zero phase transition desyncs.

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - `src/tests/BossCombatBalanceDeepAudit.test.ts`
  - `src/sim/Boss.ts` (if any adjustments or documentation additions are needed)
  - `src/sim/CombatSystem.ts` (if any adjustments or documentation additions are needed)

---

## 4. Verification & Quality Check

```bash
npx vitest run src/tests/BossCombatBalanceDeepAudit.test.ts
npm run typecheck
./verify
```
