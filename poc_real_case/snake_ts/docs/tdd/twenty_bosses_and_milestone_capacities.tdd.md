# Feature TDD Specification: 20 Bosses Catalog & Milestone Capacities Expansion

> **Feature Identifier:** `docs/tdd/twenty_bosses_and_milestone_capacities.tdd.md`  
> **Status:** Red (Test Suite Defined, Implementing Green Phase)  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** `AGENTS.md` (Strict TDD Protocol 3.0), `ORACLE.md` (SSOT)  

---

## 1. Feature Overview & Requirements

This feature expands *Ouroboros Ascension* to a 20-boss encounter progression, expands game mode ceilings, and implements a 4-tier milestone reward system for the Daily Challenge mode:

1. **20 Bosses Catalog Integrity & Modulo-20 Mapping**:
   - Expands `GameData.Bosses` from 8 to **20 unique boss archetypes**, each with custom base HP, HP per floor, radius, color, accent, and lore title.
   - `GameData.BossForFloor(floor)` indexes using `(floor - 1) % 20` with multi-cycle Roman numeral scaling (`cycle = Math.floor((floor - 1) / 20)`).
   - Boss Max HP scales deterministically: $\text{MaxHp} = \text{round}\left((\text{BaseHp} + \text{HpPerFloor} \times (\text{floor} - 1)) \times (1 + \text{cycle} \times 0.35)\right)$.

2. **Game Modes Expansion**:
   - `rogue`: Expands from 5 to **10 floors**.
   - `bossrush`: Expands from 8 to **20 floors** (1 boss per floor across the full 20-boss roster).
   - `daily`: Expands from 5 to **20 floors** (Full 20-floor Daily Challenge gauntlet).
   - `endless`: Remains $\infty$ (`Number.POSITIVE_INFINITY`).

3. **Daily Challenge 4-Tier Milestone Triggers & Escalating Rewards**:
   - **Tier 1 (Level 5 — Awakening)**: Base Cosmic Transcendence unlocked (+0% milestone bonus, 1.00x multiplier).
   - **Tier 2 (Level 10 — Ascension)**: Escalates capacity potency by **+50%** (1.50x multiplier).
   - **Tier 3 (Level 15 — Transcendence)**: Escalates capacity potency by **+100%** (2.00x multiplier).
   - **Tier 4 (Level 20 — Apex Singularity)**: Escalates capacity potency by **+150%** (2.50x multiplier).
   - Dynamic celebration banners, visual shockwaves, and audio cues upon crossing each milestone.
   - Direct multi-level leaps (e.g. jumping from Level 1 to 12) immediately resolve to the highest attained milestone tier.
   - Non-daily game modes (`rogue`, `bossrush`, `endless`) do not trigger Daily Milestones.

4. **24h Expiration & Milestone Persistence in `MetaProgression`**:
   - `DailyCapacityState` records `milestoneTier` (1..4), `milestoneLevel` (5, 10, 15, 20), and `milestoneBonus` (0.0, 0.5, 1.0, 1.5).
   - Milestone rank escalations preserve the original 24-hour expiration timestamp (`expiresAt`).
   - Full persistence across serialization (`MetaProgression.Save()`) and deserialization (`new MetaProgression()`).
   - Expired capacities (`now >= expiresAt`) are automatically cleaned up upon evaluation.
