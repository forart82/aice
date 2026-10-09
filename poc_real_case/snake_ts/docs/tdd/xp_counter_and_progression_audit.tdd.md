# Feature TDD Specification: XP Counter & Level Progression Audit

> **Feature Identifier:** `docs/tdd/xp_counter_and_progression_audit.tdd.md`  
> **Status:** Green & Verified (17/17 Tests PASS, 100% Quality Gate PASS — 50/50 Test Files, 668/668 Tests)  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](../AGENTS.md) & [`ORACLE.md#3.6`](../ORACLE.md)  

---

## 1. Feature Overview & Requirements

This feature audit verifies the core math, simulation mechanics, item rewards, perk scaling, multi-level queueing, and HUD telemetry presentation for the **XP Counter & Level Progression System** in *Ouroboros Ascension*.

### Core Specifications:
1. **Mathematical XP Thresholds**:
   - Oracle SSOT Level-Up Threshold Formula:
     $$\text{XP}_{\text{req}}(\text{level}) = \lfloor 100 \times \text{level}^{1.45} \rfloor$$
   - Verified across Levels 1 through 20 with monotonic strict positivity and positive second derivative.
   - Dynamic simulation recurrence in `SnakePlayer`:
     $$\text{XpToNext}_{L+1} = \lfloor \text{XpToNext}_L \times 1.32 + 45 + 0.5 \rfloor$$
2. **XP Reward Sources & Modifiers**:
   - Food ingestion: Apple (+15), Golden (+45), Potion (+10), Shield (+12), Bomb (+20), Chrono (+18), Shard (+22), Soul Remnant (+35), Astral Prism (+75).
   - Enemy kills: Scarab (18), Swarmling (9), Spitter (22), Phantom (24), Drone (28), Brute (45).
   - Soul Harvest relic bonus ($+60\%$ per stack) on enemy kill XP.
   - Gourmand perk stacks ($+20\%$ per card stack up to $+80\%$) modifying `player.Stats.XpGain`.
   - Overdrive Frenzy (2x) triggered at high combos.
3. **Multi-Level-Up Queueing**:
   - Substantial XP rewards cleanly trigger multi-tier level increments in a single simulation step.
   - `PendingLevelUps` increments accurately while deducting tiered thresholds and preserving fractional remainder XP.
   - Guard limit protection ensuring robust loop termination ($< 50$ iterations per step).
4. **HUD XP Counter Telemetry & Responsive Layout**:
   - Digital XP state counter (`.hud-xp-counter-wrap`, `.hud-xp-val`) rendering real-time XP reserve as `curXp / xpToNext`.
   - Progression ratio computation ($\text{XP} / \text{XpToNext}$).
   - Phone, tablet, and desktop responsive tier lifecycle validation.
   - Stylesheet verification: `index.html` does NOT hide `.hud-xp-counter-wrap` on `tier-phone`.

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/XpCounterAndProgressionAudit.test.ts`
- **Assertion Groups:**
  1. **Section 1: Oracle & Simulation XP Progression Formulas (Levels 1 to 20)**:
     - 1.1: Evaluates exact mathematical values of $\lfloor 100 \times \text{level}^{1.45} \rfloor$ for $L \in [1, 20]$.
     - 1.2: Asserts strict monotonicity and positive second-order derivative (convex scaling curve).
     - 1.3: Simulates step-by-step `SnakePlayer` dynamic `XpToNext` escalation curve across 20 levels.
  2. **Section 2: XP Gain Sources, Relic Multipliers & Perk Scaling**:
     - 2.1: Ingestion of all 9 food variants awards exact calibrated base XP.
     - 2.2: Slain enemies yield canonical base XP across all 6 mob archetypes.
     - 2.3: Soul Harvest relic scales kill XP by $+60\%$ per stack.
     - 2.4: Gourmand card stacks (+20% to +80%) scale all food and combat XP intake.
     - 2.5: Overdrive Frenzy state activation and 2x combat multiplier synergy.
  3. **Section 3: Multi-Level-Up Queueing & Residual Invariants**:
     - 3.1: Large instantaneous XP lump-sums trigger multi-level transitions in a single atomic step.
     - 3.2: `PendingLevelUps` accurately queues multiple draft opportunities.
     - 3.3: Invariant check: Residual `player.Xp` is strictly $< \text{XpToNext}$.
     - 3.4: Cumulative `TotalXpCollected` is strictly preserved across multi-level jumps.
     - 3.5: Edge cases: Zero XP, negative values, and loop guard limits.
  4. **Section 4: HUD XP Counter Rendering & Multi-Tier Responsive Visibility**:
     - 4.1: `HudView` DOM initialization contains `.hud-xp-counter-wrap` and `.hud-xp-val`.
     - 4.2: Real-time update updates `.hud-xp-val` with `curXp / xpToNext` and level badge.
     - 4.3: Telemetry ratio calculation ($\text{curXp} / \text{nextXp}$) reflects true progress.
     - 4.4: Responsive layout tier transitions (`tier-phone`, `tier-tablet`, `tier-desktop`) maintain HUD integrity.
     - 4.5: Mobile stylesheet check confirms `index.html` maintains phone visibility for `.hud-xp-counter-wrap`.

---

## 3. Implementation Details (Green Phase)

- **Authoring File:** `src/tests/XpCounterAndProgressionAudit.test.ts`
- **Dependencies:** `vitest`, `MockDom`, `SnakePlayer`, `CombatSystem`, `GameEngine`, `HudView`, `ResponsiveLayout`, `GameData`, `MathX`, `SaveIO`, `MetaProgression`.

---

## 4. Verification & Quality Check

```bash
npx vitest run src/tests/XpCounterAndProgressionAudit.test.ts # 17/17 PASS
./verify # 50/50 Test Files, 668/668 Tests PASS, 100% Quality Gate PASS
```
