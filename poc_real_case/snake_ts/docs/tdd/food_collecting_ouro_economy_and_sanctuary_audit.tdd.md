# Feature TDD Specification: Food Collecting, Ouro Economy & Sanctuary Meta-Progression Audit

> **Feature Identifier:** `docs/tdd/food_collecting_ouro_economy_and_sanctuary_audit.tdd.md`  
> **Status:** Red -> Green -> Verified  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Comprehensive automated audit and simulation harness for Food Collecting kinematics/hitboxes, ambient spawn distributions, 20-floor nourishment quota progression, in-run Ouro economy vs Cranial Lab shop prices, and persistent Ouroboros Shards Sanctuary meta-progression power curves.
- **Target Systems:** `src/sim/FoodItem.ts`, `src/sim/CombatSystem.ts`, `src/sim/GameEngine.ts`, `src/data/GameData.ts`, `src/data/MetaProgression.ts`, `src/sim/SnakePlayer.ts`, `src/sim/ai/AutonomousBotPlayer.ts`.
- **Mechanics Reference:** [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md) (Economy, Nutrient Drops, Sanctuary Blessings, Floor Nourishment Quotas).

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/FoodCollectingOuroEconomyAndSanctuaryAudit.test.ts`
- **Assertions:**
  1. **Food Density & Drop Catalog (9 Food Types):**
     - Verifies all 9 nutrient items (`apple`, `golden`, `potion`, `shield`, `bomb`, `chrono`, `shard`, `soul`, `prism`) have exact radius, XP/Ouro, score, heal, and ambient spawn weights.
     - Confirms weighted average ambient food value is exactly $1.815\text{ Ouro/item}$.
     - Confirms food spawn cap formula $\text{Cap}(f) = 9 + \min(6, f)$ and interval timer $1.35\text{s}$.
  2. **Kinematic Hitboxes & Attraction Physics:**
     - Confirms pickup hitbox reach $R_{\text{reach}} = R_{\text{head}} + 2 + R_{\text{food}}$.
     - Confirms inverse-linear magnetic pull formula $F = (1 - d/R_{\text{mag}}) \cdot 620$ with $\text{safeLen}$ protection against division by zero.
     - Confirms framerate-independent exponential drag decay $\text{drag} = 0.92^{60 \cdot \Delta t}$.
     - Confirms thermal cooking ($🍏 \to 🌟$) and Constriction loop fusion ($\ge 2\text{ items} \to 🔮$).
  3. **Nourishment Quota & Floor Timing:**
     - Verifies floor nourishment quota formula $Q(f) = 22 + 9(f - 1)$ for standard modes ($0$ for BossRush).
     - Verifies zero deadlock guarantee (fallback apple spawn when food count is 0).
  4. **In-Run Ouro vs Cranial Lab Pricing:**
     - Confirms per-floor income target ($60–90\text{ Ouro/floor}$, $\sim 1,500\text{ Ouro}$ total across 20 floors).
     - Confirms module cost $\text{Cost}(lvl, p) = 30 \cdot lvl + 15p$ and augment cost $\text{Cost}(lvl, p) = 40 \cdot lvl + 20p$.
  5. **Sanctuary Meta-Progression & Shard Economy:**
     - Confirms all 9 Sanctuary blessings, 5 socket blueprints, and 5 class unlock costs and cumulative power curves ($11,804\text{ Shards}$ total 100% completion).
     - Confirms Sharded Harvest greed scaling $+15\%$ per rank and persistent saving/loading.
  6. **Automated 20-Floor Economy Bot Simulations:**
     - Runs 20-floor autonomous sweeps across all 5 serpent classes (`emerald`, `stalker`, `hydra`, `storm`, `solar`).
     - Verifies full wallet solvency, upgrade purchasing, and zero deadlock progression.

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - `src/sim/CombatSystem.ts`: Explicitly handle `case 'prism'` in `eatFood()` with `player.heal(food.healAmount || 25)` and FX.
  - `src/tests/FoodCollectingOuroEconomyAndSanctuaryAudit.test.ts`: Automated bot simulation probe and comprehensive audit test suite.

---

## 4. Verification & Quality Check

```bash
npx vitest run src/tests/FoodCollectingOuroEconomyAndSanctuaryAudit.test.ts
./verify
```
