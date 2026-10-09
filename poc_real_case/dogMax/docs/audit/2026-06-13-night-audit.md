# Night Audit — 2026-06-13

Autonomous deep audit of the whole codebase (bugs + incoherences) followed by a
formula/coherence pass against `GameDesign.md`, then verification and fixes.
Driven by 13 read-only sub-agents over disjoint slices (8 within-file logic +
5 cross-file/formula), every finding then **verified against source** by the
main thread before any edit (per the project's hard lesson that sub-agent
"bugs" are mostly false positives).

Baseline at start: **932 doctests + 30/30 E2E green.**
After fixes: **934 doctests + 30/30 E2E green.**

---

## FIXED this session (committed)

| # | Area | Fix | Commit subject |
|---|------|-----|----------------|
| 1 | combat/PowderCalculator | dice face was added as its **magnitude** (d100 → +100) to the powder stat-sum; spec L2153 says it "counts as 1× stat" → add `1.0f`. 3 test expectations corrected. | `B-AUDIT-POWDER+SPAWN` |
| 2 | managers/EnemyManager | `spawnAt` declared `unique_ptr<Enemy>` but always `return nullptr` (enemy is moved into the world). Every caller ignores the return → changed both overloads to `void`, removed dead `raw` lines. | `B-AUDIT-POWDER+SPAWN` |
| 3 | managers/WeaponManager | **crit roll ignored the weapon's own crit.** `fireRow` seeded crit chance/mult from flat globals (`COMBAT_CRIT_BASE_CHANCE=0.05`, `_MULT=2.0`) + dice, never `weapon->crit()/critChance()`. Spec L1586-1587 + `weapon.config` per-type crit (and the deliberate Pitchfork `critChance=0`) prove weapon crit must feed the roll. Now uses weapon crit; removed the two dead globals + config keys. 2 gating tests (proven fail-before/pass-after). | `B-AUDIT-CRIT` |
| 4 | GameDesign.md | 4 self-contradicting spec lines aligned to their canonical anchors (qualityMult 1.5/3.0→1.4/2.0; item-level overview bound; bonus-drop 0.3/0.7→0.15/0.50; enemy step factor 1.05→1.01). Doc-only. | `B-AUDIT-SPEC` |

The crit fix (#3) is the night's most important: it was a real, silent
gameplay bug — every weapon crit at the same flat 0.05/2.0 regardless of its
per-type stats, and the starter Pitchfork crit at 5% despite being configured
to never crit.

---

## VERIFIED CORRECT (checked against spec+config, no change needed)

The formula core is in good shape. Confirmed matching `GameDesign.md`:

- **Damage formula** = `max(1, base · max(1,Σface) · max(0.1,Πmult) · max(1,dron))`, ×crit if critical — matches Math Callout L1357 / Damage Modifier L1131.
- **Dron multiplier** applied **once** per fire (classify runs once; shared-roll modes reuse one result; no per-hit dron² compounding). All 15 tier multipliers in `dron.config` match the spec §Tiers table.
- **Quality multiplier IS wired** into live damage (`WeaponMaker`/`DiceMaker` stamp `base · m · qualityMult`). The old "qualityMultiplier hardcoded 1.f" memory note is **stale** — the restored build wired it.
- **Universal multiplier** `m = max(0.01, (q/100)·l)` matches L1758/L1835; applied consistently to hero, enemy, and item.
- **Quality tier thresholds** (`q<40`, `q<80`) + boundary operator match quality.config + spec; **quality stat mult** 1.0/1.4/2.0 matches the canonical table.
- **Luck**: drop-floor `clamp(⌊√luck · 9⌋, 0, 99)` and dice-roll-minimum match L1904/L1915; reference points reproduce.
- **XP**: 99-level curve monotonic; deltaMult `clamp(1+Δ·0.1, 1, 2)`; bar fill `clamp(xp/needed, 0, 1)` — all match.
- **Loot**: `RandomHelper::uniformInt` is inclusive `[lo,hi]`; subtractive weighted-pick is correct; quality floor takes the higher of luck-floor vs special override; elite/bonus stage order matches L1962-1966; slot-count modulation **shape** matches L2061.
- **Evasion**: per-slot survival product `1 − Π(1 − clamp(dpsᵢ))` clamped to `[0, EVASION_CAP]` is correct.
- **Powder** (post-fix): colour map, conversion (equipped never destroyed), factor+cap all match.
- **Config coherence**: **no missing keys** (every `getX("KEY")` resolves; the 2 version keys are `hasKey`-guarded), **no type/shape mismatches**, **no enum-parse silent-miss** in current tokens.
- **Logic slices** (abilities, core, entities, makers, hubs, automation, app, helpers, render): no real defects beyond the `spawnAt` return type. JSON parser, GIF/LZW encoder, console, RNG bounds, iterator-erase loops all sound.

---

## CATALOG — needs the user's judgment (NOT changed unilaterally)

These are real divergences, but they are **balance / design / unbuilt-feature**
decisions that change game feel or scope. Each is left as-is with a
recommendation; none is a crash or correctness bug.

### Balance: config drop-weight tables vs spec tables
- **Weapon-type weights** (`weapon.config`): config is a smooth gradient
  (Pitchfork 5000 … BigAxe 300, Σ=17700); spec L2024 says Pitchfork should
  dominate at ~84% (10000 of 11900). Config makes Pitchfork only ~28%.
  Spec prose L2037 says "starter Pitchfork is the most common drop" — true by a
  hair in config, but not dominant. **Recommendation:** if you want the
  Pitchfork-dominant early game the spec describes, restore the spec weights;
  if the gradient is the intended re-tune, ratify it by updating the spec table.
  (Spec L2038 marks these "designer-tunable".)
- **Dice-face weights** (`dice.config`): config fattens the rare tail ~10× vs
  spec (d100 ≈ 1/3821 vs spec's 1/6557; d12/d20 several× more common).
  **Recommendation:** same — pick a canonical side. Pure balance.

### Balance: XP per-tier multiplier
- `xp.config` grants XP at **1.0 / 3.0 / 9.0** per tier (the enemy-stat ladder),
  while the canonical Tier Multiplier Reference says the `qualityMult` family
  (item **and** XP) is 1.0 / 1.4 / 2.0. The config **documents** this as a
  deliberate deviation. **Recommendation:** keep as-is (it's an intentional,
  documented XP curve) but either split the spec table into separate item/XP
  families to remove the contradiction, or revert the config if 1/1.4/2 was
  intended for XP too. Left untouched because it is deliberate + documented.

### Formula: slot-count level term
- `WeaponMaker::pickSlotCount` uses `lvlNorm = (itemLevel-1)/98`; spec L2064
  says `currentHeroLevel/100`. Hero level isn't plumbed to the picker, and a
  code comment claims the formula was "pinned" deliberately. **Recommendation:**
  decide whether slot-count should scale with hero level (spec) or item level
  (current). Threading hero level in is a small feature, not a bug fix — left
  for your call.

### Design: hero-level vs item-level weapon scaling (possible double-count)
- `Hero::applyLevelScaling` re-scales each equipped weapon's baseDamage by
  `damagePerLevel^(heroLevel-1)` on every level-up, on top of the item-level
  `m` already baked at make-time. Spec places "Weapon Per-Level Multipliers"
  under the **Item Level** section. If "level" means item level, driving it from
  hero level diverges (and stacks with `m`). **Recommendation:** confirm intent;
  this is the m-formula tension already noted in project memory.

### Feature: Active Doge / Evasion (unwired)
- `ActiveEvasion::activeEvasionChance()` exists with config keys
  (`ACTIVE_EVASION_BONUS`, `ACTIVE_EVASION_WINDOW`) but has **zero production
  callers** — the live evade path applies passive only. Spec L1436 makes the
  key-tap active-doge bonus canonical. Spacebar currently drives a charge-based
  movement **dash** (`DodgeSystem`), which has no spec section. **Recommendation:**
  decide whether the dash is an intended addition (then document it + bind
  active-doge to its own input) or whether Space should be the spec's
  active-doge evasion. Wiring it is feature work, deferred for your decision.

### Feature: Auto-Destroy on Pickup (unbuilt)
- Spec §"Auto-Destroy on Pickup" (L2194-2211) defines `AUTO_POWDER_BELOW_QUALITY`
  routing; there is **no config key and no code**. Known unbuilt feature, not a
  contradiction. **Recommendation:** build it as its own card when ready.

### Naming: Doge ↔ Evasion
- Spec vocabulary is "Doge / dogePerSlot / DOGE_CAP"; code+config use
  "Evasion / evasionPerSlot / EVASION_CAP" (values identical, 0.75). Separately
  `DodgeSystem`/`dodge.config` reuse the "Dodge" name for the dash. Pure naming;
  **recommendation:** pick one term project-wide.

### Hardcoded floors (rule-adjacent, low impact)
- `DamageFormula.cpp:18` bakes the dice-product floor `0.1f`; `QualityScale.cpp:13`
  bakes the universal-mult floor `0.01f`. Both are pure free functions with no
  ConfigLoader, so moving these to config means threading a config dependency
  into the damage path. They only bite on degenerate inputs valid configs never
  produce. **Recommendation:** leave unless you want strict config-purity; the
  signature churn outweighs the benefit.

### Dead config keys (24, harmless)
Keys defined but read by no source file (incoherence, not a bug):
- `evasion.config`: `ACTIVE_EVASION_BONUS`, `ACTIVE_EVASION_WINDOW` (see Active Doge above)
- `theme.config`: `HEALTHBAR_CORNER_TICK_LENGTH/_THICKNESS`, the 14-key
  `PANEL_CHROME_*` v1 block (superseded by `PanelChromeV2`/`UIR_*`)
- `weapon.config`: `ITEM_BLINK_DUTY` (siblings are read, this one isn't)
- `enemy.config`: `SPECIAL_GLASSWRAITH_MIRROR_COUNT/_STAT_MULT`,
  `SPECIAL_PACTWALKER_HOSTILE_RANGE`,
  `SPECIAL_SENTINEL_PHASE_COUNT/_INVULN_SECONDS/_PUSH_DISTANCE`
  (these represent unimplemented special-enemy behaviours — keep as design
  intent or delete with the feature)

**Recommendation:** the `PANEL_CHROME_*` v1 block is safe to delete now
(definitively superseded); the special-enemy keys document unbuilt behaviour and
should stay until those behaviours are built or cut.
