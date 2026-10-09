# 🔮 THE ORACLE: Single Source of Truth (SSOT) — dogmax

> **File Role:** Absolute Single Source of Truth for the game.
> **Status:** Active & Authoritative
> **Rule Level:** Mandatory & Co-Equal with the `AGENTS.md` TDD Protocol

---

## 📜 1. The Oracle Covenant

1. **Absolute authority.** A mechanic defined here **must** be implemented. A
   formula, constant or algorithm specified here **must** be the one the code
   uses.
2. **Synchronised implementation.** No gameplay logic exists in production
   without being documented here and verified by a TDD spec in `docs/tdd/`.
3. **Living chronology.** History, rationale, models and balance decisions are
   preserved here.
4. **Config invariant — dogmax-specific.** Every numeric constant lives in
   `configs/*.yaml`; source only reads it. The Oracle records the **key name and
   its meaning**, not a duplicated literal. A number appearing in both places
   that disagrees is a bug, and the config wins.
5. **Publishing & architecture invariants.** Asset rights
   ([`docs/ASSETS.md`](docs/ASSETS.md), Rule 9); viewport
   ([`docs/DEVICE_SPECS.md`](docs/DEVICE_SPECS.md), Rule 10); input abstraction
   (Rule 11); save integrity ([`docs/SAVE_SCHEMA.md`](docs/SAVE_SCHEMA.md),
   Rule 12); 60 FPS budget (Rule 13); `./verify` clean (Rule 14); Git commits
   (Rule 15).

### Relationship to the other design documents

| Document | Role |
|---|---|
| **`ORACLE.md`** (this) | **Binding.** What the game must do, in a form tests assert. |
| `GameDesign.md` (242K) | Deep reference and vocabulary. Not binding on its own. |
| `docs/GAME_PILLARS.md` | Product non-negotiables. |
| `docs/ROADMAP.md` | One active goal at a time. |
| `docs/DECISIONS.md` | Append-only decision log. |
| `configs/*.yaml` | The actual numbers. Authoritative for values. |

---

## 🧭 2. Game Overview & Core Concept

### 2.1 Title
**dogmax**

### 2.2 Genre & Concept
A 2D isometric, infinite-procedural, **dark-cyberpunk-neon roguelike / horde
ARPG**. The hero auto-attacks with **dice-modded weapons**, evades damage via the
**Doge** system, and progresses through cumulative-distance **levels**. Items drop
with stats scaled by **Quality × Item Level**.

### 2.3 Art Direction — binding
The world is **code-drawn dark-neon**: dark ground, everything readable carried
by neon strokes emitted from config.

**Correction (2026-08-20).** An earlier version of this section claimed "there is
no texture art in the world, hero or enemy layer". That is **false for the
ground** and the error is recorded rather than silently edited, because a wrong
statement in a binding SSOT is worse than a missing one — it gets acted upon.

Verified state:

| Layer | Texture-free? |
|---|---|
| Hero | ✅ Yes — code-drawn SDF forms (`assets/textures/enemies/` fully orphaned) |
| Enemies | ✅ Yes — shader-drawn rings and shape-catalog silhouettes |
| Props / paths / zone edges | ✅ Yes — shape catalog and neon polylines |
| **Ground materials** | ❌ **No — 22 ground PNGs still load** via `WORLD_ENVIRONMENT_MATERIAL_CATALOG` (`configs/world_editor.yaml`) into `WorldEnvironmentRenderer.cpp:1103` |

Removing the ground textures is a real remaining task, not a completed one. Until
then `assets/textures/world/ground/` is **load-bearing and must not be deleted**
in an asset cleanup.

> **Dark body first, light only at edges and seams.**
> The hero is a silhouette that light escapes from, not a light with a shape.

**Locked palette — three accent hues only:**

| Slot | Hue | Source key |
|---|---|---|
| Hero | orange ≈ 22° | `HERO_OUTLINE_R/G/B` |
| Enemy | magenta ≈ 338° (Rare = hot pink ≈ 329°) | `ENEMY_OUTLINE_*`, `ENEMY_OUTLINE_*_RARE` |
| World / props | cyan ≈ 185° | `WORLD_NEON_ZONE_EDGE_*` |

Health bars keep the green/yellow/red ramp: that is **semantic** colour
(good/warning/critical), a separate axis from the accent palette, and it is not a
palette violation.

`WORLD_NEON_SUBORDINATE_SCALE` multiplies every world-layer alpha, holding the
world below the actors **and below the bloom threshold**, which makes the
hierarchy structural rather than a matter of taste: actors bleed light, the world
does not.

### 2.4 Target Platforms & Performance
- **Platforms:** native desktop, Linux first. See `docs/PUBLISHING.md` for the
  honest constraints SFML imposes on web and mobile.
- **Frame rate:** 60 FPS with thousands of enemies on screen.
- **Design resolution:** `GLOBAL_SCREEN_WIDTH` × `GLOBAL_SCREEN_HEIGHT`,
  letterboxed to the window.

### 2.5 Core Loop
Move → auto-attack swarms → collect loot and dice → slot dice into weapons to
build synergies → level by distance → survive escalating density.

---

## ⚙️ 3. Authoritative Gameplay Mechanics

### 3.1 Determinism — binding
The RNG is **xoshiro128\*\* seeded by SplitMix64** (`DeterministicRandom`). It
replaced `std::mt19937_64` because the standard distributions are **not
reproducible across platforms**. A seed plus an input sequence must reproduce a
run exactly.

- `bernoulli(p)` **always draws**, even at p ≤ 0 or p ≥ 1. Early-returning at the
  boundaries consumed a different number of draws and shifted the entire stream
  when a config chance was toggled between 0.0 and 0.001.
- Simulation advances on a **fixed timestep** (`SIM_TICK_HZ`) and nowhere else.

### 3.2 Hit-stop — binding
A brief freeze on impact. Two properties are correctness, not taste:
- The countdown runs on **real time**; the simulation does not step while frozen,
  so a sim-time countdown could never expire.
- Requests are **max-wins**, never additive; a swipe hitting six enemies in one
  frame must freeze once.

### 3.3 Hero movement easing — binding
Hero-only acceleration/deceleration. `velocity` **is** the smoothing state, so
every hard stop keeps working. A rate of `0` means instant — enemies keep that
default so their attack wind-ups plant on the exact frame they always did.
The stop epsilon is gated on a **zero target** only; an unconditional snap fires
mid-reversal and makes turning stutter.

### 3.4 Enemy telegraph — binding
A charged enemy plants and telegraphs before committing. Readability of the swarm
depends on it (Pillar 1).

### 3.5 Build-reactive hero glow — the identity hook
The hero's halo heats toward `HERO_BUILD_GLOW_PEAK_*` as the equipped build's
luck total rises. Driven by dogmax's own dice/luck system rather than health or
time, which is what makes it unmistakably this game. It modulates the **halo
only** — never the silhouette colour, which must stay fixed so the player can
always find themselves.

---

## 📐 4. Authoritative Mathematical Formulas & Constants

Per Covenant rule 4 every row names the **config key**, never the literal. If a
row's expression and `configs/*.yaml` disagree, the config wins and the row is a
bug. Where a number in an expression has **no key**, it is hard-coded in source
and is listed in §4.10 as a standing Rule 8 violation, not silently normalised.

Notation: `Πx` = product over the slotted dice, `Σx` = sum over them,
`clamp(v, lo, hi)` = `min(max(v, lo), hi)`, `U[a, b]` = inclusive uniform integer
draw from `DeterministicRandom`.

### 4.1 Damage, crit and luck

| ID | Name | Expression | Config keys |
| :--- | :--- | :--- | :--- |
| `FORMULA_DAMAGE` | Weapon damage | `base × max(1, Σfaces) × max(floor, Πmults) × max(1, dron) × crit` | `DAMAGE_DICE_PRODUCT_FLOOR`, `DAMAGE_MINIMUM_FLOOR` |
| `FORMULA_CRIT_APPLIED` | Crit gate | crit applies only when `critMultiplier > 1.0` | `CRIT_CHANCE_CAP` |
| `FORMULA_CRIT_CHANCE` | Effective crit chance | `clamp(base + diceContribution, 0, cap)` | `CRIT_CHANCE_CAP` |
| `FORMULA_QUALITY_FLOOR` | Luck → drop quality | `clamp(floor(√luckTotal × scale), 0, 99)` | `LUCK_QUALITY_FLOOR_SCALE` |
| `FORMULA_MIN_FACE` | Luck → dice floor face | `max(1, floor(luckTotal × scale))` | `LUCK_DICE_FLOOR_SCALE` |
| `FORMULA_HERO_SCALING` | Hero per-level stat | `base × multiplier^(level−1)` — applied to **max health, pickup radius and move speed only** | `HERO_HEALTH_PER_LEVEL`, `HERO_PICKUP_PER_LEVEL`, `HERO_MOVE_PER_LEVEL` |
| `FORMULA_ENEMY_SCALING` | Enemy per-level stat | `base × multiplier^(level−1)` | `ENEMY_HEALTH_PER_LEVEL`, `ENEMY_SPEED_PER_LEVEL` |
| `FORMULA_HALO_FALLOFF` | Glow layer alpha | `alphaBase / (layer + 1)`, scaled by tier mult | `THEME_HALO_GLOW_ALPHA_BASE`, `THEME_HALO_GLOW_LAYERS` |
| `FORMULA_BLOOM_KEY` | Bloom bright-pass | `max(R,G,B) ≥ threshold` — **max channel, not luminance** | `BLOOM_BRIGHT_THRESHOLD` |

**Why `FORMULA_QUALITY_FLOOR` is a square root:** it makes the first luck dice
very valuable while the late stack saturates smoothly toward the clamp, instead
of slamming into it the moment a second Rare luck dice is equipped.

**Why `FORMULA_BLOOM_KEY` is max-channel:** Rec.601 luminance is green-weighted,
so hero orange scored 152 and enemy magenta 95 against a threshold of 200 — with
the result that **nothing in the game bloomed at all**. A pure magenta is
blinding and scores 105; a dull grey scores 128. Max channel tracks how bright a
saturated colour actually looks.

**Why enemy per-level speed is ≈1.02:** the world must stay kitable at level 99.
A 1.10 ramp had enemies outpacing the hero by level 10.

**Why `FORMULA_HERO_SCALING` omits damage:** `Hero::loadFromConfig` reads
`HERO_DAMAGE_PER_LEVEL` and then explicitly discards it (`(void)damagePerLevel`)
— hero damage lives on the equipped weapons and scales through
`WEAPON_DAMAGE_PER_LEVEL` instead. The key is **loaded but not applied**; see
§4.10.

### 4.2 XP and hero levelling — `src/abilities/Levelable.*`, `configs/xp.yaml`

| ID | Name | Expression | Config keys |
| :--- | :--- | :--- | :--- |
| `FORMULA_XP_KILL` | XP granted for one kill | `deltaMult = clamp(1 + (enemyLevel − heroLevel) × XP_DELTA_SCALE, XP_DELTA_MIN, XP_DELTA_MAX)`; `xp = max(0, floor(enemyLevel² × qualityMult[tier] × deltaMult))`; `xp = 0` when `enemyLevel ≤ 0` | `XP_DELTA_SCALE`, `XP_DELTA_MIN`, `XP_DELTA_MAX`, `XP_QUALITY_MULT_COMMON`, `XP_QUALITY_MULT_UNCOMMON`, `XP_QUALITY_MULT_RARE` |
| `FORMULA_XP_KILL_STREAK` | Rolling-window streak multiplier | inside the window (`simTime − lastKillSimTime ≤ window`): `streak += 1`, `mult = clamp(1 + (streak − 1) × bonusPerKill, 1, max(1, maxMult))`. Outside the window, or on the first kill of a run: `streak = 1`, `mult = 1` | `XP_KILL_STREAK_WINDOW_SECONDS`, `XP_KILL_STREAK_BONUS_PER_KILL`, `XP_KILL_STREAK_MAX_MULT` |
| `FORMULA_XP_LEVEL_STEP` | XP to advance level `N → N+1` | `step(N) = max(1, HERO_XP_LEVEL_N)` for `1 ≤ N < HERO_MAX_LEVEL`. Past the table the step grows `next = prev + prev / 2` (integer division) | `HERO_XP_LEVEL_1` … `HERO_XP_LEVEL_(HERO_MAX_LEVEL − 1)`, `HERO_MAX_LEVEL` |
| `FORMULA_XP_LEVEL_UP` | Level-up loop | while `level < maxLevel` and `experience ≥ experienceForNextLevel`: subtract the step, `level += 1`, take the next step. On reaching `maxLevel`, `experience` is pinned to 0 | `HERO_MAX_LEVEL` |

**Table-size invariant (assertable):** `Levelable::loadFromConfig` reads
`HERO_XP_LEVEL_N` for every `N` in `[1, HERO_MAX_LEVEL − 1]`. With
`HERO_MAX_LEVEL` at its current value, `configs/xp.yaml` must therefore contain
**exactly that many** `HERO_XP_LEVEL_*` keys with no gap — `ConfigLoader` crashes
early on a missing key rather than defaulting, so a short table is a startup
crash, not a silent balance drift. The `max(1, …)` floor exists so a step cost of
`0` cannot make one kill cascade the hero up many levels.

**Why the step floor is `max(1, …)` and not the raw value:** `experience ≥ 0` is
always true, so a zero step would satisfy the level-up condition forever.

**At the level cap XP is DISCARDED, not un-earned — binding, and observable.**
`computeKillExperience` still returns a positive amount at `level == maxLevel`,
and `WeaponManager` floats that streak-boosted amount on the dying enemy before
calling `grantExperience`, which then returns early. The player therefore sees a
nonzero `+N XP` float for a kill whose XP is thrown away. Whether that is the
intended feedback is a design question; the Oracle records what ships.

**Level-up side effect (binding):** `Hero::applyLevelScaling` refills health to
full on a level-up. This heal is exclusive to the level-up path — the equip-time
`rescaleEquippedWeapons` deliberately omits it so equip/unequip cannot be abused
as a free heal.

### 4.3 Enemy level by distance — `src/combat/EnemyLevelCurve.*`, `configs/enemy_levels.yaml`

The curve is a cumulative table of walked pixels, built once at construction and
looked up per spawn. `cum[1] = 0`; three bands stitch together:

| ID | Name | Expression | Config keys |
| :--- | :--- | :--- | :--- |
| `FORMULA_ENEMY_LEVEL_BAND_LINEAR` | Band 1 — levels `2 … LINEAR_END` | `cum[N] = cum[N−1] + LINEAR_STEP` | `ENEMY_LEVEL_LINEAR_STEP`, `ENEMY_LEVEL_LINEAR_END` |
| `FORMULA_ENEMY_LEVEL_BAND_EXP1` | Band 2 — levels `LINEAR_END+1 … EXP1_END` | `cum[N] = cum[N−1] + LINEAR_STEP × EXP1_FACTOR^(N − LINEAR_END)` | `ENEMY_LEVEL_EXP1_FACTOR`, `ENEMY_LEVEL_EXP1_END` |
| `FORMULA_ENEMY_LEVEL_BAND_EXP2` | Band 3 — levels `EXP1_END+1 … ENEMY_LEVEL_MAX` | `stepAtExp1End = LINEAR_STEP × EXP1_FACTOR^(EXP1_END − LINEAR_END)`; `cum[N] = cum[N−1] + stepAtExp1End × EXP2_FACTOR^(N − EXP1_END)` | `ENEMY_LEVEL_EXP2_FACTOR`, `ENEMY_LEVEL_MAX` |
| `FORMULA_ENEMY_LEVEL_FROM_DISTANCE` | Distance → spawn level | `level(d) = 1` for `d ≤ 0`, else `max{ N ∈ [1, ENEMY_LEVEL_MAX] : d ≥ cum[N] }` | `ENEMY_LEVEL_MAX` |
| `FORMULA_ENEMY_LEVEL_BUDGET` | Total walk budget | `cumulativeForLevel(ENEMY_LEVEL_MAX)`; out-of-range levels clamp to the nearest valid entry | `ENEMY_LEVEL_MAX` |

`ENEMY_LEVEL_MAX` is clamped to `≥ 1` in the constructor so a misconfigured `0`
or negative cannot underflow the table allocation.

**Level-cap asymmetry (recorded, not reconciled):** `ENEMY_LEVEL_MAX` and
`HERO_MAX_LEVEL` are different keys with different values — the enemy curve tops
out one level below the hero cap. Both are live; neither is derived from the
other.

**Spec disagreement — code wins.** `GameDesign.md` proposes
`EXP2_FACTOR = 1.05` in the same paragraph that pins the total walk budget at
≈28–30 M px. The two are mutually exclusive (1.05 overshoots the budget roughly
4×). The shipped value honours the **budget**, not the factor.

### 4.4 Enemy tier cadence and special-enemy gates

| ID | Name | Expression | Config keys |
| :--- | :--- | :--- | :--- |
| `FORMULA_TIER_QUINTILE` | Progress → cadence band | `progress = walkedFromHeroStart / cumulativeForLevel(ENEMY_LEVEL_MAX)`; `q = clamp(floor(progress × kQuintileCount), 0, kQuintileCount − 1)`, with `progress ≤ 0 → 0` and `progress ≥ 1 → kQuintileCount − 1` | `ENEMY_LEVEL_MAX`; *(`kQuintileCount` hard-coded — see §4.10)* |
| `FORMULA_TIER_ROLL` | Spawn tier | with `counter` = the 1-based index of the spawn about to fire: `counter mod rare(q) == 0 → Rare`; else `counter mod uncommon(q) == 0 → Uncommon`; else `Common`. A cadence of `0` disables that tier | `ENEMY_TIER_CADENCE_Q0_RARE` … `ENEMY_TIER_CADENCE_Q4_RARE`, `ENEMY_TIER_CADENCE_Q0_UNCOMMON` … `ENEMY_TIER_CADENCE_Q4_UNCOMMON` |
| `FORMULA_SPECIAL_GATE_GLASSWRAITH` | Per-spawn dice roll, tier-independent, evaluated **first** | `heroLevel ≥ gate ∧ oneIn > 0 ∧ randomFraction < 1 / oneIn` | `SPECIAL_GLASSWRAITH_ONE_IN`, `SPECIAL_GLASSWRAITH_HERO_LEVEL_GATE` |
| `FORMULA_SPECIAL_GATE_SHOCKER` | Uncommon-tier counter gate | `tier == Uncommon ∧ heroLevel ≥ gate ∧ (uncommonSinceLastShocker + 1) ≥ everyNth` | `SPECIAL_SHOCKER_EVERY_NTH_UNCOMMON`, `SPECIAL_SHOCKER_HERO_LEVEL_GATE` |
| `FORMULA_SPECIAL_GATE_VOIDCRAWLER` | Rare-tier counter gate, checked **before** Hexarchon | `tier == Rare ∧ heroLevel ≥ gate ∧ insideExclusionZone ∧ (rareSinceLastVoidcrawler + 1) ≥ everyNth` | `SPECIAL_VOIDCRAWLER_EVERY_NTH_RARE`, `SPECIAL_VOIDCRAWLER_HERO_LEVEL_GATE` |
| `FORMULA_SPECIAL_GATE_HEXARCHON` | Rare-tier counter gate | `tier == Rare ∧ heroLevel ≥ gate ∧ (rareSinceLastHexarchon + 1) ≥ everyNth` | `SPECIAL_HEXARCHON_EVERY_NTH_RARE`, `SPECIAL_HEXARCHON_HERO_LEVEL_GATE` |

**Gate ordering is binding, not incidental.** Glasswraith is rolled before any
tier test, so it can pre-empt a Shocker/Hexarchon/Voidcrawler slot. Voidcrawler
is tested before Hexarchon because its level gate is higher *and* it carries the
extra exclusion-zone constraint; when both Rare gates are open, Voidcrawler wins
the slot. Tassidean Sentinel and Pact-Walker have **no spawn gate at all** — see
§5.

### 4.5 Loot pipeline — `src/combat/LootRolls.*`, `src/makers/LootMaker.cpp`, `configs/loot.yaml`

| ID | Name | Expression | Config keys |
| :--- | :--- | :--- | :--- |
| `FORMULA_DROP_CHANCE` | Chance a kill drops anything | `luckNorm = clamp(luckTotal / LUCK_DROP_REFERENCE, 0, 1)`; `tierNorm = clamp(enemyTierIndex / 2, 0, 1)`; `chance = clamp(BASE + LUCK_BONUS × luckNorm + TIER_BONUS × tierNorm, 0, MAX)` | `BASE_DROP_CHANCE`, `LUCK_DROP_BONUS`, `TIER_DROP_BONUS`, `MAX_DROP_CHANCE`, `LUCK_DROP_REFERENCE` |
| `FORMULA_ELITE_EXTRA_DROPS` | Elite bonus | `isElite ⇔ tier ≠ Common` (so **every** Uncommon and Rare is an elite); an elite kill adds `ELITE_DROP_COUNT_BONUS` **guaranteed** drops on top of the chance-gated base drop | `ELITE_DROP_COUNT_BONUS` |
| `FORMULA_DROP_KIND` | Weapon vs dice | integer-weight draw: `roll = U[1, W + D]`; `roll ≤ W → Weapon`, else `Dice`. `W + D ≤ 0` degenerates to Weapon | `WEAPON_DROP_WEIGHT`, `DICE_DROP_WEIGHT` |
| `FORMULA_DROP_QUALITY_ROLL` | Item quality score | `q = U[max(1, clamp(qFloor, 0, 99)), 100]` — `qFloor` comes from `FORMULA_QUALITY_FLOOR` | `LUCK_QUALITY_FLOOR_SCALE` (via `qFloor`) |
| `FORMULA_ITEM_LEVEL` | Item level | `l = U[max(1, ⌈enemyLevel / 2⌉), max(1, enemyLevel)]`; degenerates to `{1}` at `enemyLevel ≤ 1` | *(no key — see §4.10)* |
| `FORMULA_STAT_QUALITY_ROLL` | Per-stat independent quality | `biasFloor = clamp(qFloor + TIER_STAT_BIAS × enemyTierIndex, 0, 99)`; each stat draws `q_stat = U[max(1, biasFloor), 100]` independently | `TIER_STAT_BIAS` |
| `FORMULA_SLOT_COUNT_WEIGHT` | Weapon slot-count draw | `qNorm = q / 100`; `lvlNorm = (itemLevel − 1) / 98`; `luckNorm = clamp(luckTotal / LUCK_REFERENCE, 0, 1)`; `w(n) = base[n] × (1 + α·qNorm + β·lvlNorm + γ·luckNorm)^(n − 2)`, then a cumulative weighted draw over the five tiers; a total weight of `0` degenerates to the minimum. `MIN`/`MAX` clamp the **result**, they do not bound the draw (see §4.10) | `DROP_WEIGHT_WEAPON_SLOTS_2` … `DROP_WEIGHT_WEAPON_SLOTS_6`, `WEAPON_SLOT_COUNT_QUALITY_ALPHA`, `WEAPON_SLOT_COUNT_LEVEL_BETA`, `WEAPON_SLOT_COUNT_LUCK_GAMMA`, `WEAPON_SLOT_COUNT_LUCK_REFERENCE`, `WEAPON_SLOT_COUNT_MIN`, `WEAPON_SLOT_COUNT_MAX` |
| `FORMULA_DICE_FACE_DRAW` | Dice face-count draw | weighted draw over the ten face counts, each gated by `DICE_LEVEL_GATE_*` against the source level (D4/D6 ungated). `DiceMaker` is confirmed to read every key listed; **the exact draw/gate arithmetic has not been read against source** and this row is sourced from `configs/dice.yaml`'s own comment | `DROP_WEIGHT_DICE_4` … `DROP_WEIGHT_DICE_100`, `DICE_LEVEL_GATE_D8` … `DICE_LEVEL_GATE_D100` |
| `FORMULA_STAT_FLOORS` | Post-scaling safety floors | each rolled stat is clamped up to its floor after quality/level scaling | `WEAPON_DAMAGE_FLOOR`, `WEAPON_APS_FLOOR`, `WEAPON_RANGE_FLOOR`, `WEAPON_CRIT_MULT_FLOOR`, `DICE_DAMAGE_MULT_FLOOR`, `DICE_CRIT_FLOOR`, `DICE_CRIT_CHANCE_FLOOR`, `DICE_EVASION_PER_SLOT_FLOOR` |
| `FORMULA_WEAPON_RANGE_LEVEL` | Range level scaling | `range = max(RANGE_FLOOR, baseRange × f(q_range) × itemLevel^P × qualityStatMult[tier])` — a power curve, unlike damage and APS which scale linearly in item level | `WEAPON_RANGE_LEVEL_POWER`, `WEAPON_RANGE_FLOOR`, `QUALITY_STAT_FACTOR_MIN` |
| `FORMULA_VOIDCRAWLER_DROP_FLOOR` | Voidcrawler drop override | every drop from a Voidcrawler replaces the luck-derived `qFloor` with the fixed override, so its quality roll is `U[floor, 100]` | `SPECIAL_VOIDCRAWLER_QUALITY_FLOOR` |

**There is no guaranteed base drop.** Every kill is chance-gated by
`FORMULA_DROP_CHANCE`; only `FORMULA_ELITE_EXTRA_DROPS` is unconditional. This
supersedes the flat bonus-drop constants described in `GameDesign.md`.

### 4.6 Quality tiers — `src/combat/QualityScale.*`, `src/entities/QualityTier.cpp`, `configs/quality.yaml`

| ID | Name | Expression | Config keys |
| :--- | :--- | :--- | :--- |
| `FORMULA_QUALITY_TIER` | Score → tier | `q < UNCOMMON_THRESHOLD → Common`; `q < RARE_THRESHOLD → Uncommon`; else `Rare`. The comparison is **strictly less than**, so each threshold is the first score of its own tier | `QUALITY_UNCOMMON_THRESHOLD`, `QUALITY_RARE_THRESHOLD` |
| `FORMULA_QUALITY_TIER_RANGE` | Tier → score band | `Common = [1, U−1]`, `Uncommon = [U, R−1]`, `Rare = [R, QUALITY_MAX_SCORE]`, with `U ≥ 2` and `R ≥ U+1` enforced | `QUALITY_UNCOMMON_THRESHOLD`, `QUALITY_RARE_THRESHOLD`, `QUALITY_MAX_SCORE` |
| `FORMULA_QUALITY_STAT_FACTOR` | Quality → retained fraction | `f(q) = MIN + (1 − MIN) × clamp(q, 1, 100)/100`, with `MIN` itself clamped to `[0, 1]` | `QUALITY_STAT_FACTOR_MIN` |
| `FORMULA_UNIVERSAL_MULTIPLIER` | Quality × level | `m = f(q) × max(1, itemLevel)` | `QUALITY_STAT_FACTOR_MIN` |
| `FORMULA_TIER_STAT_MULT` | Per-tier stat multiplier | `finalStat = baseRoll × m × qualityStatMult[tier]` — applied **independently** of `m` so a Rare reads as a strict upgrade over an Uncommon of the same item level | `QUALITY_STAT_MULT_COMMON`, `QUALITY_STAT_MULT_UNCOMMON`, `QUALITY_STAT_MULT_RARE` |

**Why the quality floor is a fraction and not `q/100`:** without
`QUALITY_STAT_FACTOR_MIN` a level-one item retained only `q/100` of its intended
stats, which made low-quality drops unplayable rather than merely worse.

**Two separate tier ladders, deliberately.** `QUALITY_STAT_MULT_*` (item stats)
and `XP_QUALITY_MULT_*` (kill XP) are different keys with different values. They
are kept apart so XP pacing and item balance can drift independently; a change to
one is **not** a licence to change the other.

### 4.7 Dron classification — `src/combat/DronDetector.*`, `configs/dron.yaml`, `configs/dron_patterns.yaml`

`classify(diceFaces, faceCounts)` builds a descending histogram of face
multiplicities and walks an **ordered predicate ladder**, highest multiplier
first. The order is binding: the first predicate that matches wins, so reordering
changes the payout of a roll even with every multiplier unchanged.

| ID | Name | Predicate (in evaluation order) | Config keys |
| :--- | :--- | :--- | :--- |
| `FORMULA_DRON_LADDER` | Tier resolution order | Hexadron (counts `{6}`) → Pentadron (`≥5` of a kind) → Twin-Tridron (`{3,3}`) → Quad-Duodron (`{4,2}`) → Omidron → Hemidron → Triduo-Dron (`{2,2,2}`) → Tetradron (`≥4`) → Lineadron → Split-Seqdron → Mixdron (full house: a `≥3` group plus a distinct `≥2` group) → Minidron → Tridron (`≥3`) → Duodron (`≥2`) → Voidron (fallback, silent) | `DRON_MULT_HEXADRON`, `DRON_MULT_PENTADRON`, `DRON_MULT_TWIN_TRIDRON`, `DRON_MULT_QUAD_DUODRON`, `DRON_MULT_OMIDRON`, `DRON_MULT_HEMIDRON`, `DRON_MULT_TRIDUO_DRON`, `DRON_MULT_TETRADRON`, `DRON_MULT_LINEADRON`, `DRON_MULT_SPLIT_SEQDRON`, `DRON_MULT_MIXDRON`, `DRON_MULT_MINIDRON`, `DRON_MULT_TRIDRON`, `DRON_MULT_DUODRON`, `DRON_MULT_VOIDRON` |
| `FORMULA_DRON_OMIDRON` | "Rainbow" — one die on every face of a span | `span = MAX_FACE − MIN_FACE + 1`; requires `count(faces) ≥ span`, exactly `span` distinct values, `min == MIN_FACE` and `max == MAX_FACE` | `DRON_OMIDRON_MIN_FACE`, `DRON_OMIDRON_MAX_FACE` |
| `FORMULA_DRON_HEMIDRON` | All-high or all-low, face-count relative | for each die `i`: `midpoint_i = faceCount_i × SPLIT_RATIO`; `allHigh` ⇔ every `face_i > midpoint_i`; `allLow` ⇔ every `face_i ≤ midpoint_i`. Requires `count(faces) ≥ 3`. With no per-die counts supplied, `DRON_OMIDRON_MAX_FACE` stands in as the canonical die size | `DRON_HEMIDRON_SPLIT_RATIO`, `DRON_OMIDRON_MAX_FACE` |
| `FORMULA_DRON_LINEADRON` | Long straight | a run of consecutive **distinct** faces of at least this length | `DRON_LINEADRON_STRAIGHT_LENGTH` |
| `FORMULA_DRON_MINIDRON` | Short straight | same predicate at the shorter length | `DRON_MINIDRON_STRAIGHT_LENGTH` |
| `FORMULA_DRON_APPLIED` | Dron in the damage formula | the resolved tier's multiplier enters `FORMULA_DAMAGE` as `max(1, dron)`; Voidron is flagged `isSilent` and spawns no float | *(see `FORMULA_DAMAGE`)* |

**Why the midpoint is face-count relative:** a fixed d6 threshold handed every
d100 roll an ≈83 % "all high" freebie, which made Hemidron worthless and the
tiers above it unreachable. Relative midpoints keep the classic d6 split while
making a d100 Hemidron a real achievement.

**Why Lineadron is tested before Split-Seqdron:** the ladder is
highest-multiplier-first, and the earlier order let the lower-paying
Split-Seqdron short-circuit a qualifying Lineadron.

### 4.8 Evasion (passive Doge) and the dash — `src/combat/EvasionCalculator.*`, `src/combat/DodgeSystem.*`

| ID | Name | Expression | Config keys |
| :--- | :--- | :--- | :--- |
| `FORMULA_EVADE_CHANCE` | Passive evade chance | `evade = clamp(1 − Π_i (1 − clamp(evasionPerSlot_i, 0, 1)), 0, clamp(EVASION_CAP, 0, 1))` | `EVASION_CAP` |
| `FORMULA_EVADE_VISUAL` | Evade feedback window | the hero outline flashes to the ghost colour for the flash duration and a fading trailing silhouette is drawn behind | `GHOST_TRAIL_FLASH_DURATION`, `GHOST_TRAIL_OUTLINE_R/G/B`, `GHOST_TRAIL_TRAIL_DURATION`, `GHOST_TRAIL_TRAIL_INITIAL_ALPHA` |
| `FORMULA_DOGE_BYPASS` | Hexarchon ignores evasion | a Hexarchon hit bypasses the evade roll entirely while `heroHealth / heroMaxHealth < threshold` | `SPECIAL_HEXARCHON_DOGE_BYPASS_HERO_HP_FRACTION` |
| `FORMULA_DASH_CHARGES` | Dash charge pool | pool starts full at `DODGE_MAX_CHARGES`. A dash consumes one charge and starts the **pool-wide** cooldown if it is not already running; each elapsed cooldown returns one charge (capped at max) and re-arms the timer only while charges are still missing | `DODGE_MAX_CHARGES`, `DODGE_CHARGE_COOLDOWN_SECONDS` |
| `FORMULA_DASH_KINEMATICS` | Dash burst | velocity is overridden along the input heading at `DODGE_DASH_SPEED` for `DODGE_DASH_DURATION_SECONDS`; reach = speed × duration | `DODGE_DASH_SPEED`, `DODGE_DASH_DURATION_SECONDS` |
| `FORMULA_DASH_IFRAMES` | Dash invulnerability | the hero takes zero damage for `DODGE_DASH_IFRAME_SECONDS` from dash start — deliberately longer than the burst so the landing is covered | `DODGE_DASH_IFRAME_SECONDS` |
| `FORMULA_DASH_THROUGH_DAMAGE` | Dash-through hit | an enemy whose body centre falls within the radius during the dash takes `frac × enemyMaxHealth` **once per dash** and is knocked back along the dash heading | `DODGE_DASH_DAMAGE_RADIUS`, `DODGE_DASH_DAMAGE_FRAC`, `DODGE_DASH_KNOCKBACK` |

**The cooldown is pool-wide, not per-charge — this is a design choice, not an
implementation detail.** Burning both charges back to back means the first refill
arrives one cooldown later and the second one cooldown after that, which keeps
the rhythm predictable instead of surprising the player with a double refill.

**Naming, binding:** the code says **Evasion** (`EVASION_CAP`,
`evasionPerSlot`, `EvasionCalculator`) where `GameDesign.md` says **Doge**
(`DOGE_CAP`, `dogePerSlot`); the values agree and the code names ship.
Separately, `configs/dodge.yaml` / `DodgeSystem` is the **dash**, not the passive
evade — the two systems share a near-identical word and must not be conflated.

### 4.9 Weapon firing and dice pacing — `src/combat/WeaponFiring.*`, `src/combat/AttackModes.*`

**Dice pacing wins.** With any dice slotted, the weapon's own APS countdown is
ignored entirely and firing is paced exclusively by the dice; with zero dice the
weapon countdown paces it. This is the whole of the rule and it is binding:

| ID | Name | Expression | Config keys |
| :--- | :--- | :--- | :--- |
| `FORMULA_WEAPON_PACING` | Cooldown advance | any dice slotted → advance **every** slotted dice countdown by `dt` and leave the weapon countdown alone; no dice → advance the weapon countdown only | `<TYPE>_APS`, `WEAPON_APS_PER_LEVEL`, `DICE_ROLL_DURATION_MIN`, `DICE_ROLL_DURATION_MAX` |
| `FORMULA_WEAPON_CHARGED` | Ready to fire | any dice slotted → charged ⇔ **every** slotted dice has finished; no dice → charged ⇔ the weapon countdown has finished | *(as above)* |
| `FORMULA_WEAPON_CHARGE_PROGRESS` | Charge bar fraction | any dice slotted → `min_i(progress_i)` (the slowest dice); no dice → the weapon countdown's progress | *(as above)* |
| `FORMULA_WEAPON_COOLDOWN_RESET` | Post-shot reset | weapon countdown duration is re-derived as `1 / effectiveAps` (`1` when `aps ≤ 0`), reset, and **every** slotted dice is reset. Resetting all dice is mandatory — skipping it desyncs a dice-slotted attacker after its first shot | `<TYPE>_APS`, `WEAPON_APS_PER_LEVEL`, `WEAPON_APS_FLOOR` |
| `FORMULA_DICE_SNAPSHOT` | Per-fire dice contribution | `faces = [faceValue(currentFace)]`, `mults = [damageMultiplier]`, `critChance = Σ diceCritChance` (**additive**), `critMult = Π diceCrit` (**multiplicative, identity 1.0**) | `DICE_DAMAGE_MULT_MIN/MAX`, `DICE_CRIT_MIN/MAX`, `DICE_CRIT_CHANCE_MIN/MAX` |
| `FORMULA_DICE_FACE_CYCLE` | Rolling animation | the displayed face advances every `DICE_FACE_CYCLE_SECONDS` while the dice countdown runs | `DICE_FACE_CYCLE_SECONDS` |
| `FORMULA_WEAPON_DAMAGE_ROLL` | One fire | draw `isCritical = bernoulli(critChance)` from `DeterministicRandom`, then evaluate `FORMULA_DAMAGE`. The bernoulli **always draws**, even at `p ≤ 0` or `p ≥ 1` (§3.1) | `DAMAGE_DICE_PRODUCT_FLOOR`, `DAMAGE_MINIMUM_FLOOR`, `CRIT_CHANCE_CAP` |

**Attack-mode target selection.** The mode helpers are pure — they select
targets and perform no damage roll, spawn no VFX and emit no XP:

| ID | Mode | Target set | Config keys |
| :--- | :--- | :--- | :--- |
| `FORMULA_TARGETS_SINGLE` | `SINGLE` | the closest enemy in range; 0 or 1 target | `<TYPE>_ATTACK_TYPE`, `<TYPE>_RANGE` |
| `FORMULA_TARGETS_SWIPE` | `SWIPE` | every enemy inside the arc centred on the fire direction, which is derived from the closest in-range enemy and shared by all targets so the VFX fan has one anchor | `<TYPE>_SWIPE_ARC_DEG` |
| `FORMULA_TARGETS_MULTI` | `MULTITARGET` | the `N` nearest **distinct** enemies; if fewer than `N` are in range the shortfall repeats hits on the closest, so the result is exactly `N` entries whenever any enemy is in range | `<TYPE>_MULTI_TARGET_MAX` |
| `FORMULA_TARGETS_MULTI_SINGLE` | `MULTISINGLE` | exactly `N` entries, all the **same** closest enemy; the manager rolls damage per entry but spawns one summed damage text | `<TYPE>_MULTI_SINGLE_MAX` |
| `FORMULA_TARGETS_AOE` | `AOE` | every enemy inside the weapon's range; one shared damage roll is applied to each | `<TYPE>_RANGE` |

`<TYPE>` is the weapon type prefix in `configs/weapon.yaml` (`PITCHFORK`,
`LONG_SWORD`, `GREAT_SWORD`, `HALBERD`, `QUARTERSTAFF`, `KNIVES`, `DAGGER`,
`MACE`, `WARHAMMER`, `BIG_AXE`). Every listed suffix exists for every type.

### 4.10 Constants still hard-coded in source — standing Rule 8 violations

Recorded rather than hidden. Each is a number that appears in an expression above
but has **no config key**, so source, not `configs/`, currently owns it:

| Where | Hard-coded value | Belongs in |
| :--- | :--- | :--- |
| `LootRolls::rollItemLevel` | the `⌈level/2⌉` lower-bound divisor | `configs/loot.yaml` |
| `LootRolls::rollQuality` / `rollStatQuality` | the `[0, 99]` clamp and the `100` upper bound (duplicates `QUALITY_MAX_SCORE`) | `configs/quality.yaml` |
| `LuckCalculator::qualityFloor` | the `99` clamp | `configs/luck.yaml` |
| `LootMaker::computeDropChance` | `tierNorm` divisor `2` (the tier-count − 1) | `configs/loot.yaml` |
| `TierCadence::kQuintileCount` | the band count `5` | `configs/enemy.yaml` |
| `EnemyManager::nextTier` | the `{100, 10}` cadence fallback, duplicated as `TierCadencePair`'s default member initialisers | `configs/enemy.yaml` |
| `Levelable` (header defaults) | `maxLevel{100}`, `xpDeltaScale{0.1}`, `xpDeltaMin{0.1}`, `xpDeltaMax{2.0}`, `qualityMult{1.0, 1.5, 3.0}` — the last **disagrees with `configs/xp.yaml`** | `configs/xp.yaml` |
| `Levelable::grantExperience` | the post-table step growth `prev + prev/2` (a 1.5× ramp) | `configs/xp.yaml` |
| `Levelable::reset` | the `100` fallback for `experienceForNextLevel` | `configs/xp.yaml` |
| `DronDetector::isSplitSequence` | faces `1,2,3` / `4,5,6` — a fixed d6 assumption, inconsistent with the config-driven Omidron span beside it | `configs/dron_patterns.yaml` |
| `DronDetector::isHemidron` | the `count(faces) ≥ 3` minimum | `configs/dron_patterns.yaml` |
| `DodgeSystem` (header defaults) | `maxCharges{2}`, `cooldownSeconds{2.0}` | `configs/dodge.yaml` |
| `EnemyLevelCurve` (header default) | `maxLevelValue{99}` | `configs/enemy_levels.yaml` |
| `WeaponFiring::resetWeaponCooldown` | the `1.0` fallback duration at `aps ≤ 0` | `configs/weapon.yaml` |
| `Weapon::setSlotCount` | the `2..6` clamp, duplicating `WEAPON_SLOT_COUNT_MIN/MAX` | `configs/loot.yaml` |
| `WeaponMaker` slot-count draw | the five-tier span itself (`array<double, 5>`, `idx + 2`, `return 2` / `return 6`) — the `MIN`/`MAX` keys clamp the result but never bound the draw | `configs/loot.yaml` |
| `WeaponMaker` slot-count norms | the `100` quality divisor and the `98` item-level span | `configs/loot.yaml` |

A default member initialiser that is always overwritten by `loadFromConfig` is
still a second owner of the number: it is what ships if the load path is ever
skipped, and `Levelable::qualityMult` proves the risk is real — its default
disagrees with the config the game actually runs on.

---

## 📊 5. Entities, Attributes & Balance Tables

### 5.1 Hero

| Attribute | Config key | Notes |
| :--- | :--- | :--- |
| Base max health | `HERO_HEALTH_MAX` | scaled by `FORMULA_HERO_SCALING`; refilled to full on level-up |
| Base move speed | `HERO_MOVE_SPEED` | scaled by `FORMULA_HERO_SCALING` |
| Collision radius | `HERO_COLLISION_RADIUS` | |
| Level cap | `HERO_MAX_LEVEL` | XP stops accruing at the cap |
| Per-level health / pickup / move | `HERO_HEALTH_PER_LEVEL`, `HERO_PICKUP_PER_LEVEL`, `HERO_MOVE_PER_LEVEL` | applied as `base × mult^(level−1)` |
| Per-level damage | `HERO_DAMAGE_PER_LEVEL` | **loaded and discarded** — weapon scaling supersedes it (§4.1) |
| Weapon rescale on level | `WEAPON_DAMAGE_PER_LEVEL`, `WEAPON_APS_PER_LEVEL`, `WEAPON_RANGE_PER_LEVEL`, `WEAPON_CRIT_CHANCE_PER_LEVEL`, `WEAPON_CRIT_MULT_PER_LEVEL` | every equipped weapon rescales alongside the hero |
| Levelling | `FORMULA_XP_KILL`, `FORMULA_XP_KILL_STREAK`, `FORMULA_XP_LEVEL_STEP` | XP is earned by kills; **world level is walked distance** (§4.3). At the cap, kill XP is still computed and floated but discarded (§4.2) |
| Defence | `FORMULA_EVADE_CHANCE`, `FORMULA_DASH_CHARGES`, `FORMULA_DASH_IFRAMES` | passive evade plus the active dash |
| Outline hue | `HERO_OUTLINE_R/G/B` | orange ≈ 22°, fixed — never modulated (§2.3, §3.5) |

**Behaviour.** Auto-attacks through the equipped weapon rows, one attack-mode
target set per row (§4.9). Movement is eased (§3.3). The build-reactive halo
heats with the equipped build's luck total and touches the halo only.

### 5.2 Enemy tiers

All three tiers share one base template and differ only by multiplier. The tier
is chosen at spawn by `FORMULA_TIER_ROLL`; the level by `FORMULA_ENEMY_LEVEL_FROM_DISTANCE`.

| Tier | Stat multiplier | Visual scale | Aura radius | Body brightness | Outline |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Common | `ENEMY_TIER_STAT_MULT_COMMON` | `ENEMY_TIER_VISUAL_SCALE_COMMON` | `ENEMY_AURA_RADIUS_MULT_COMMON` | `ENEMY_BODY_BRIGHTNESS_MULT_COMMON` | `ENEMY_OUTLINE_R/G/B` (magenta) |
| Uncommon | `ENEMY_TIER_STAT_MULT_UNCOMMON` | `ENEMY_TIER_VISUAL_SCALE_UNCOMMON` | `ENEMY_AURA_RADIUS_MULT_UNCOMMON` | `ENEMY_BODY_BRIGHTNESS_MULT_UNCOMMON` | inherits Common unless a template overrides |
| Rare | `ENEMY_TIER_STAT_MULT_RARE` | `ENEMY_TIER_VISUAL_SCALE_RARE` | `ENEMY_AURA_RADIUS_MULT_RARE` | `ENEMY_BODY_BRIGHTNESS_MULT_RARE` | `ENEMY_OUTLINE_R/G/B_RARE` (hot pink) — **but see the conflict below** |

Shared base attributes, tier-independent:

| Attribute | Config key |
| :--- | :--- |
| Base health / move speed | `ENEMY_BASE_HEALTH`, `ENEMY_BASE_MOVE_SPEED` |
| Attack range / chase range | `ENEMY_ATTACK_RANGE`, `ENEMY_CHASE_RANGE` |
| Chase deadzone | `ENEMY_DEADZONE_FACTOR` |
| Collision radius | `ENEMY_COLLISION_RADIUS` |
| Damage output multiplier / floor | `ENEMY_ATTACK_DAMAGE_MULT`, `ENEMY_ATTACK_MIN_DAMAGE` |
| Per-level health / speed | `ENEMY_HEALTH_PER_LEVEL`, `ENEMY_SPEED_PER_LEVEL` |
| Separation | `ENEMY_ENEMY_COLLISION_ENABLED`, `ENEMY_COLLISION_MAX_RESOLVE_COUNT` |

**Designer constraint, unvalidated by code:** `SPATIAL_GRID_CELL_SIZE` must equal
`2 × ENEMY_COLLISION_RADIUS`. `core::SpatialGrid` reads whatever the key holds
and does not check the relation, so the two keys must be tuned together.

**There is no `ENEMY_DAMAGE_PER_LEVEL`.** Enemy damage does not scale with level
in the shipped code; only health and speed do. `configs/enemy.yaml`'s own comment
block reasons at length about a 1.10 per-level damage curve that neither the
config nor the source contains.

**Rare outline conflict — unresolved, recorded.** Two different keys claim the
Rare outline colour on two different paths: `ENEMY_OUTLINE_*_RARE` in
`configs/enemy.yaml` (hot pink, read by `ColorTheme` and `EnemyManager`) and
`ENEMY_RARE_OUTLINE_*` in `configs/enemies/regular.yaml` (**gold**, read by the
`EnemyTemplateLoader` tier-override path for the body painter). Precedence between
the two render paths is **not verified here**. The gold value contradicts the
locked palette in §2.3, which retired gold precisely because it collided with the
hero's orange.

**Behaviour, all tiers.** Chase within `ENEMY_CHASE_RANGE`, hold at the deadzone,
telegraph before committing (§3.4), broadcast alerts to neighbours, and attack by
contact or with an equipped weapon. Enemy weapons fire through the same
`FORMULA_WEAPON_*` rules as the hero's, with a dron multiplier of 1.

### 5.3 Special enemies — `configs/enemies/`, `src/combat/SpecialEnemy*`

Each is a substitution applied to an already-tiered spawn: it inherits the
tier/level stats and then applies its own overrides. Body shape and palette come
from the per-kind YAML; stat overrides and gates from `configs/enemy.yaml`.

| Kind | Template | Spawn gate | Stat overrides | Special behaviour |
| :--- | :--- | :--- | :--- | :--- |
| **Shocker** | `shocker.yaml` — Sunburst body, cyan fill with pink filigree, one orbiting bolt layer in front | `FORMULA_SPECIAL_GATE_SHOCKER` (every Nth Uncommon, hero-level gated) | `SPECIAL_SHOCKER_HEALTH_MULT` | **Implemented.** On death, an AOE damages every *other* enemy in radius for a fraction of the **hero's** max health — a friendly explosion. `SPECIAL_SHOCKER_DEATH_AOE_RADIUS`, `SPECIAL_SHOCKER_DEATH_AOE_HERO_HP_FRACTION` |
| **Hexarchon** | `hexarchon.yaml` — Hexagram body, purple, one slow orb orbiting behind; Uncommon and Rare size overrides | `FORMULA_SPECIAL_GATE_HEXARCHON` (every Nth Rare, hero-level gated) | `SPECIAL_HEXARCHON_HEALTH_MULT`, `SPECIAL_HEXARCHON_DEADZONE_FACTOR` (replaces `ENEMY_DEADZONE_FACTOR` for this kind, keeping it at range) | **Implemented.** Its hits bypass evasion entirely while the hero is below `SPECIAL_HEXARCHON_DOGE_BYPASS_HERO_HP_FRACTION` of max HP (`FORMULA_DOGE_BYPASS`) |
| **Voidcrawler** | `voidcrawler.yaml` — EyeRift body, near-black fill, one static cyan eye glow in front | `FORMULA_SPECIAL_GATE_VOIDCRAWLER` (every Nth Rare, hero-level gated, **and** inside an exclusion zone); wins the slot over Hexarchon | `SPECIAL_VOIDCRAWLER_SPEED_MULT` (slower than baseline) | **Implemented.** Every drop skips the luck-derived quality floor and uses `SPECIAL_VOIDCRAWLER_QUALITY_FLOOR` instead (`FORMULA_VOIDCRAWLER_DROP_FLOOR`) |
| **Glasswraith** | `glasswraith.yaml` — EtherLens body, pale icy palette, shards popping up on an interval; explicit body alpha | `FORMULA_SPECIAL_GATE_GLASSWRAITH` (1-in-N per spawn, hero-level gated, **tier-independent and evaluated first**) | `SPECIAL_GLASSWRAITH_HEALTH_MULT` (below baseline) | **Partially implemented.** The gate, stat override and body all ship. The fracture-into-mirror-copies death behaviour described in `GameDesign.md` does **not** exist in source and has no config key |
| **Tassidean Sentinel** | `sentinel.yaml` — CosmicShield body, warm gold, one static ward ring behind | **None.** No `SPECIAL_SENTINEL_*` gate keys exist and `pickSpecialKind` never returns this kind | none — `loadSpecialEnemyStatOverride` returns defaults | **Not implemented.** The 3-phase invulnerability + push-pulse state machine is spec-deferred; mechanically it is a baseline enemy of its rolled tier. Only the body/palette keys ship |
| **Pact-Walker** | `pactwalker.yaml` — BipedRig body, muted earthen palette, no effect layers | **None.** No `SPECIAL_PACTWALKER_*` gate keys exist and `pickSpecialKind` never returns this kind | none — `loadSpecialEnemyStatOverride` returns defaults | **Not implemented.** NPC wander, hostile-on-attack and the black-powder drop are all spec-deferred; it reads as an ordinary enemy of its rolled tier |

**Sentinel and Pact-Walker are unreachable in normal play.** They exist as
`SpecialEnemyKind` values with authored bodies and can be placed by the
WorldEditor or a console spawn, but no gate in `pickSpecialKind` ever selects
them, so no run will produce one. This is a genuine Oracle-vs-`GameDesign.md`
divergence, recorded as the code behaves.

**Per-kind template keys.** Every file in `configs/enemies/` carries
`ENEMY_TYPE_ID`, `ENEMY_TYPE_NAME`, `ENEMY_SPECIAL_KIND`, `ENEMY_BODY_SHAPE`
(an index into `configs/enemy_shapes.yaml`), `ENEMY_BODY_SIZE`,
`ENEMY_OUTLINE_R/G/B`, `ENEMY_FILL_R/G/B` and `ENEMY_LAYER_COUNT`, plus
`ENEMY_LAYER_NN_*` blocks for each effect layer and optional
`ENEMY_UNCOMMON_*` / `ENEMY_RARE_*` tier overrides resolved at load time. The
non-special baseline lives in `regular.yaml`. These files are authored live
through the in-game enemy editor and written back, so they are data, not source.

---

## 📜 6. Development History & Design Decisions Log

| Date | Author | Decision | Rationale |
| :--- | :--- | :--- | :--- |
| 2026-08-07 | Creator + Agent | **Commit to dark-neon.** Ground/props crushed to near-black; neon carries readability; palette restricted to two or three accents. | The world rendered photoreal while actors carried neon — two art languages fighting, so silhouettes drowned in ground noise. |
| 2026-08-08 | Creator + Agent | **Rebuild the world from zero as code-drawn neon geometry.** "Darken, don't replace" is dead. | No per-pixel test on a composited frame can separate mid-bright texture from dim additive glow of the same hue; every gate that crushed the corn also destroyed the glow language. |
| 2026-08-08 | Agent | **Delete `WorldGradePipeline`.** | With no photoreal art it had no job, and an A/B proved it was net-negative — HP bars and damage numbers were readable with it off. |
| 2026-08-08 | Agent | **Bloom keys on max channel, not luminance.** | Nothing in the game was blooming; the metric was wrong for a saturated palette, not the threshold. |
| 2026-08-08 | Creator + Agent | **Rare enemies leave gold for hot pink.** | Gold sat in the hero's own orange family and was a fourth accent hue; the hero could not be found in a Rare-heavy pack. |
| 2026-08-11 | Agent | **Ground grid.** | A flat fill gave no motion cue at all — a player sprinting across empty black could not tell they were moving. |
| 2026-08-12 | Creator + Agent | **Hero form: dark plate with seam light, not soft energy.** | Four successive energy forms (core, flame, eye, blob) all read as generic. Dark cyberpunk is hard silhouette with light escaping panel gaps. |
| **2026-08-20** | **Creator + Agent** | **Adopt the dogV6 TDD + Oracle protocol**, retargeted to C++23/SFML 3. **Revokes** the previous "tests only when a bug is found" rule. | The two rules are exact inverses and cannot coexist; TDD plus an SSOT is the prerequisite for commercial release. |
| **2026-08-22** | **Agent** | **Extract §4 and §5 from the shipped code + `configs/`.** Formula and entity tables now name config KEYS, never literals; where `GameDesign.md` and the code disagreed, the **code** was recorded and the divergence stated. Constants still hard-coded in source are listed in §4.10 rather than papered over. | The tables were marked INCOMPLETE, so Rule 8's formula invariant had nothing to bind to — an Oracle that omits the balance curves cannot be the SSOT it claims to be. |

---

## 🔧 7. Audit backlog — known gaps against the new rules

These are honest gaps, recorded so they are not mistaken for compliance:

| Gap | Rule | Status |
| :--- | :--- | :--- |
| No test framework or suite existed before this import | 1–5, 14 | doctest + `./verify` added; suites pending |
| `docs/ASSETS.md` unpopulated — **~380 binary assets with unverified provenance** | 7, 9 | **Highest commercial risk.** Audit pending |
| Gameplay binds `sf::Keyboard` directly; no `VirtualInput` | 11 | Pending |
| No save system, so no schema version or migrations | 12 | Pending (rule binds when one exists) |
| Oracle formula/entity tables incomplete | 8 | Extraction from `GameDesign.md` + code pending |
| Mobile safe-area handling | 10 | Deferred by platform reality — see `docs/DEVICE_SPECS.md` |
