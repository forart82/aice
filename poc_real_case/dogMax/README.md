# dogMax

Auto-attack roguelike. C++23 + SFML 3. Dark cyberpunk neon aesthetic.

## ⚠️ Read first — the binding rules

As of 2026-08-20 this project runs under a strict protocol. These two documents
are **mandatory and non-negotiable**, and they outrank everything else here:

- **[`AGENTS.md`](AGENTS.md)** — the TDD protocol. No production code without a
  failing test first. Every feature gets a spec in `docs/tdd/`. Every task passes
  `./verify` before it is committed.
- **[`ORACLE.md`](ORACLE.md)** — the Single Source of Truth. A mechanic or formula
  written there is what the game must implement.

This **reversed** the project's previous testing rule ("tests only when a bug is
found"). A standing suite is now maintained under `tests/`.

```bash
./verify        # the quality gate: build tests -Werror, run them, build release
./bt            # build + launch
./runGame       # launch the newest snapshot
```

## Direction Docs

Use these before starting product work:

- `docs/GAME_PILLARS.md` — one-page product truth.
- `docs/CURRENT_GAME_STATE.md` — what exists now.
- `docs/TARGET_EXPERIENCE.md` — what the player should feel.
- `docs/ROADMAP.md` — small Now / Next / Later roadmap.
- `docs/DECISIONS.md` — durable product/workflow decisions.
- `docs/FEATURE_SPECS/` — short current/target/open-question specs by system.

## Build & Run

```bash
./bt              # release build → build/ + a stamped dogmax-<timestamp> snapshot
./bt dev          # fast iteration build → build-dev/ (-O1 -g0, no snapshot)
./runGame         # launch the newest stamped snapshot
```

Play directly from the build tree with `(cd build && ./dogmax)`.

## Using this project on another PC

The whole project — code, full git history, and the Claude Code session
memory — travels through git. Claude's durable memory normally lives outside
the repo (`~/.claude/projects/<key>/memory`), so it is mirrored here under
`.claude/memory/` and tracked in git.

On a fresh machine:

```bash
git clone https://github.com/forart82/dogmax.git
cd dogmax
./scripts/sync-memory.sh   # link Claude's memory dir to the repo copy
```

After that, `MEMORY.md` and the session logs load exactly as on the original
machine, and any new memory Claude writes lands back in the repo to be
committed and pushed.

---

## WHAT EXISTS IN THE GAME

### Core Loop

- **App** → boots window, owns GameSession
- **GameSession** → fixed-hz simulate (60 Hz) + variable render
- **Clock** → tick / delta time
- **World** → owns Hero + all entity IDs
- **SpatialGrid** → fast radius queries for enemies/items

---

### Entities

| Entity | Key stats |
|---|---|
| **Hero** | HP 1000, move 500 px/s, pickup radius 360 px, max level 100 |
| **Enemy** | HP, level, tier (Common/Uncommon/Rare), special kind |
| **Weapon** | type, baseDamage, APS, range, crit%, crit×, up to 6 dice slots |
| **Dice** | face count, damageMultiplier, crit, critChance, luck |
| **FloorItem** | holds Weapon or Dice, dropped on enemy death |

**Enemy special kinds:** Shocker · Glasswraith · Hexarchon · Tassidean Sentinel · Voidcrawler · Pact-Walker

---

### Abilities (mixins on entities)

`Aimable` `Countdownable` `Damageable` `Deathable`
`Huntable` `Inputable` `Levelable` `Moveable`
`Pickupable` `Rangeable` `Targetable` `Walkable`

---

## FORMULAS (all verified in production code)

### Damage

```
damage = baseDamage × Σfaces × Πmultipliers × dronMultiplier
if isCritical: damage ×= critMultiplier
floor at max(1.0)
```

- `Σfaces` = sum of all slotted dice face values (clamped ≥ 1)
- `Πmultipliers` = product of all dice `damageMultiplier` fields (clamped ≥ 0.1)
- `dronMultiplier` = Dron combo multiplier (clamped ≥ 1.0)
- `critMultiplier` = weapon's crit× stat (applied only when isCritical)

Source: `src/combat/DamageFormula.cpp`

---

### Crit Chance

```
effectiveCritChance = clamp(weaponCritChance + Σdice.critChance,  0,  0.75)
```

Cap is `CRIT_CHANCE_CAP = 0.75` from `configs/combat.yaml`.

Source: `src/combat/CritClamp.hpp`

---

### Hero Stat Scaling per Level

```
stat(level) = baseStat × multiplier^(level − 1)
```

| Stat | Base | Per-level multiplier |
|---|---|---|
| Max HP | 1000 | 1.11 |
| Move speed | 500 px/s | 1.02 |
| Pickup radius | 360 px | 1.02 |

Source: `src/entities/Hero.cpp`, `configs/hero.yaml`

---

### Weapon Stat Scaling per Level

```
stat(level) = baseStat × multiplier^(level − 1)
```

Multipliers from `configs/weapon.yaml`:
`WEAPON_DAMAGE_PER_LEVEL` · `WEAPON_APS_PER_LEVEL` · `WEAPON_RANGE_PER_LEVEL`
`WEAPON_CRIT_CHANCE_PER_LEVEL` · `WEAPON_CRIT_MULT_PER_LEVEL`

Source: `src/entities/Weapon.cpp::applyLevelScaling`

---

### Enemy Level from Distance (3-band curve)

```
Band 1 (level 2 … linearEnd):
    step(N) = linearStep

Band 2 (linearEnd+1 … exp1End):
    step(N) = linearStep × exp1Factor^(N − linearEnd)

Band 3 (exp1End+1 … maxLevel):
    step(N) = step(exp1End) × exp2Factor^(N − exp1End)

cumulative[N] = Σ step(2…N)   [total px walked to reach level N]
levelFromDistance(d) = highest N where d ≥ cumulative[N]
maxLevel = 99
```

Source: `src/combat/EnemyLevelCurve.cpp`, `configs/enemy_levels.yaml`

---

### Enemy Tier Cadence (5 quintiles)

Run distance split into 5 equal quintiles (0–4). Each quintile has its own
`rare` and `uncommon` thresholds:

```
spawnCounter % cadence.rare     == 0  →  Rare
spawnCounter % cadence.uncommon == 0  →  Uncommon
else                                  →  Common
```

Source: `src/combat/TierCadence.cpp`, `configs/enemy.yaml`

---

### XP on Kill

```
delta     = enemy.level − hero.level
deltaMult = clamp(1 + delta × 0.1,  min=1.0,  max=2.0)
xp        = floor(enemy.level² × qualityMult × deltaMult)
```

| Enemy tier | qualityMult |
|---|---|
| Common | 1.0 |
| Uncommon | 3.0 |
| Rare | 9.0 |

Source: `src/abilities/Levelable.cpp`, `configs/xp.yaml`

---

### Kill Streak XP Multiplier

```
if time since last kill ≤ 1.0 s:
    streak += 1
else:
    streak = 1

xpMultiplier = clamp(1 + (streak − 1) × 0.25,  min=1.0,  max=3.0)
```

Source: `src/combat/KillStreak.cpp`, `configs/xp.yaml`

---

### Quality Tiers

Quality `q` rolled uniformly ∈ [1, 100]:

```
q ∈ [  1,  39]  →  Common
q ∈ [ 40,  79]  →  Uncommon
q ∈ [ 80, 100]  →  Rare
```

**Universal multiplier** (scales all loot stats):

```
m = max(0.01,  (q / 100) × itemLevel)
```

**Per-tier stat multiplier** (stacked on top of m):

| Tier | Multiplier |
|---|---|
| Common | 1.0× |
| Uncommon | 1.4× |
| Rare | 2.0× |

```
finalStat = baseRoll × m × qualityMult[tier]
```

Source: `src/combat/QualityScale.cpp`, `configs/quality.yaml`

---

### Loot Drop Rolls

```
itemLevel = uniformInt(⌈enemyLevel / 2⌉,  enemyLevel)
q         = uniformInt(max(1, qFloor),    100)
```

`qFloor` is set by the Luck system (see below).

Source: `src/combat/LootRolls.cpp`

---

### Luck → Quality Floor

`luckTotal` = sum of `luck` stat across all slotted dice.

```
qFloor           = clamp(floor(√luckTotal × 9.0),  0,  99)
effectiveMinFace = max(1,  floor(luckTotal × 0.05))
```

| luckTotal | qFloor |
|---|---|
| 1 | 9 |
| 25 | 45 |
| 78 | ~79 (Rare floor) |
| 121 | 99 (cap) |

Source: `src/combat/LuckCalculator.cpp`, `configs/luck.yaml`

---

### Evasion

**Passive** (from slotted dice, heterogeneous product form):

```
evasion = min(0.75,  1 − Π_i (1 − evasionPerSlot_i))
```

Degenerates to `1 − (1 − p)^n` when all slots have the same value.

Source: `src/combat/EvasionCalculator.cpp`, `configs/evasion.yaml`

---

### Dodge (Space key)

```
maxCharges     = 2
cooldown       = 2.0 s per charge  (sequential refill)
dashDuration   = 0.18 s
dashSpeed      = 800 px/s   →   ~144 px per dash
```

Source: `configs/dodge.yaml`

---

### Powder on Destroy

```
weaponPowder = round(POWDER_STAT_FACTOR
               × (baseDamage + APS + crit + critChance + range × POWDER_WEAPON_RANGE_SCALE))

dicePowder   = round(POWDER_STAT_FACTOR
               × (damageMultiplier + crit + critChance × POWDER_DICE_CRIT_CHANCE_SCALE + luck + 1))

result = clamp(rounded,  1,  POWDER_PER_DESTROY_CAP)
```

Note: the `+ 1` for dice counts the face as 1 stat unit (not its numeric value).

Source: `src/combat/PowderCalculator.cpp`, `configs/powder.yaml`

---

### Dron Combos

Computed from the set of face values currently showing across all slotted dice.
Priority-ordered — first match wins:

| Tier | Pattern (dice face values) | Multiplier |
|---|---|---|
| **Hexadron** | 6-of-a-kind | **40×** |
| **Pentadron** | 5-of-a-kind | 30× |
| **Twin-Tridron** | two different 3-of-a-kinds (3+3) | 25× |
| **Quad-Duodron** | 4+2 | 22× |
| **Omidron** | exactly 6 dice showing faces {1,2,3,4,5,6} | 20× |
| **Hemidron** | all dice ≤ 3, OR all dice ≥ 4 | 18× |
| **Triduo-Dron** | three different pairs (2+2+2) | 15× |
| **Tetradron** | 4-of-a-kind | 12× |
| **Lineadron** | any 5 consecutive face values | 10× |
| **Split-Seqdron** | {1,2,3} AND {4,5,6} all present | 8× |
| **Mixdron** | full house (3+2) | 5× |
| **Minidron** | any 4 consecutive face values | 3× |
| **Tridron** | 3-of-a-kind | 2.5× |
| **Duodron** | pair | 2× |
| **Voidron** | no pattern | 1× (silent, no float shown) |

Source: `src/combat/DronDetector.cpp`, `configs/dron.yaml`

---

### Weapon Base Stats (10 types)

| Weapon | Damage range | APS | Range | Crit× | Crit% | Attack mode |
|---|---|---|---|---|---|---|
| Pitchfork | 5–15 | 0.8 | 450 | 1.0 | 0% | SINGLE |
| Long Sword | 10–22 | 1.2 | 550 | 1.5 | 5% | SWIPE |
| Great Sword | 18–40 | 0.8 | 550 | 1.5 | 5% | SWIPE |
| ... (10 types total — see configs/weapon.yaml) | | | | | | |

Attack modes: `SINGLE` · `SWIPE` (multi-target arc) · `AOE` (area detonation)
`MULTISINGLE` (charge burst) · `VOLLEY_DRON` (Dron-linked volley)

Source: `configs/weapon.yaml`, `src/combat/AttackModes.hpp`

---

## SYSTEMS OVERVIEW

### Managers

| Manager | Role |
|---|---|
| **WeaponManager** | Tick rows, fire volleys, dice face cycle |
| **EnemyManager** | Spawn, AI tick, special kind overrides, loot drops |
| **HeroManager** | Movement, level-up, death |
| **FloorItemManager** | Floor item lifetime, despawn |

### Hubs (stateful stores)

| Hub | Holds |
|---|---|
| **WeaponSlotHub** | Equipped weapons + dice per slot |
| **InventoryHub** | Bag grid (weapons + dice), auto-sort |
| **InventoryDestroyer** | Destroy item → PowderHub |
| **LuckHub** | Aggregated luck total from all dice |
| **PowderHub** | Powder stacks by colour |
| **PickupHub** | Auto-pickup floor items |
| **AttackVfxHub** | Attack shape VFX event queue |
| **DamageTextHub** | Floating damage number queue |
| **XpFloatHub** | XP float text queue |
| **EvasionHub** | Evade cooldown + ghost trail state |

### Render

| System | Role |
|---|---|
| **WorldRenderer** | Master render pass |
| **EnemyBodyPainter** | SDF neon-outline bodies, per-tier tint |
| **FloorPainter** | Floor shader: black + shimmer + fog bands |
| **BloomPipeline** | Bright-extract → Gaussian blur → additive blend |
| **GhostTrail** | Cyan evasion dash trail VFX |
| **AttackVfxRenderer** | Attack shape VFX |
| **CombatTextRenderer** | Floating damage + XP numbers |
| **WeaponSlotSidebar** | Right-side weapon + dice panel |
| **InventoryRenderer** | Bag grid, drag+drop, destroy flash |
| **TooltipRenderer** | Hover tooltip (item stats) |
| **DebugPanel** | F1 debug window (Entity / Item / Perf / Config / Console tabs) |
| **ConsoleOverlay** | `^` in-game live console |
| **VersionOverlay** | vMAJOR.MINOR.BUILD corner HUD |
| **Camera** | Follow-target + scroll zoom |

---

## CONFIGS (`configs/*.yaml`)

All gameplay tuning here. Nothing hard-coded in source.

`combat` `debug` `diagnostics` `dice` `dice_crafter` `dodge` `dron`
`dron_patterns` `effects_catalog` `enemy` `enemy_ai_tuning`
`enemy_body_vfx` `enemy_charge` `enemy_combat` `enemy_dash`
`enemy_info_bar` `enemy_levels` `enemy_mind` `enemy_shapes`
`enemy_shapes_extra` `evasion` `hero` `hero_skeleton` `infobar`
`inventory` `loot` `loot_filter` `luck` `names` `powder` `quality`
`settings` `showcase` `theme` `tooltip` `ui` `version` `waves`
`weapon` `weapon_shapes_gallery` `weaponslot` `window` `xp`

---

## ASSETS

- `assets/shaders/` — GLSL (body SDF, floor shimmer, fog, bloom)
- `assets/fonts/` — TTF fonts
- `assets/names/` — name pool files for procedural weapon names
