# Visual Identity Pass — World, Hero, Enemies

Updated: 2026-08-11

## Target

Find a unique, identifiable visual design and world-creation approach that:

1. Gives dogmax its own recognizable style — a player should be able to tell
   it's dogmax at a glance.
2. Respects the dark-neon art direction (see `docs/GAME_PILLARS.md`).
3. Looks professional in both static image and motion — not poor, not boring.

Scope is **world (ground/environment/props), hero, and enemies only**. UI,
inventory, and other windows are explicitly out of scope — see
`docs/FEATURE_SPECS/ui.md` for UI work.

## Baseline Diagnosis (Step 0, 2026-08-07)

Offscreen captures of the farm region at seed 1 showed the real problem, and it
is not a missing effect:

- The world renders **photoreal**: detailed cobblestone, corn rows, wood cart
  and well, in a mid-tone brown/tan/grey palette.
- The hero **already carries** an orange rim-outline glow, and props **already**
  carry cyan edge glow.
- Those two languages fight. Neon overlay sits on top of a photoreal base with
  as much contrast detail as the actors themselves, so the hero silhouette gets
  lost in ground noise and the screen reads busy *and* flat at the same time.

This is why previously-tried effects work did not move the needle: neon was
being added to a photoreal base that competes with it. The fix is **commitment
to one language**, not more effects.

## Decision (2026-08-07, owner)

**dogmax commits to dark-neon.** Ground and props are crushed toward near-black,
desaturated, low-detail; neon outlines and glow carry all readability; the
palette is restricted to two or three accent hues.

Consequence: existing photoreal textures are **darkened and flattened by shader
and tint, not replaced**. Asset quality stops being the limiting factor, which
directly answers the "not enough assets" constraint.

## Decision superseded (2026-08-08, owner)

**The world is rebuilt from zero as code-drawn neon geometry.** The "darken, do
not replace" clause above is dead. Ground, paths and props are shapes plus neon
strokes emitted by the renderer from config — no texture art in the world layer.
See `docs/DECISIONS.md`, 2026-08-08.

This lands for one reason: the corrective approach could not work. No per-pixel
test on a composited frame separates mid-bright photoreal texture from dim
additive glow of the same hue, so every gate tight enough to crush the corn crop
also destroyed halos, damage text and attack VFX. With no photoreal art left,
the correction has no job — `WorldGradePipeline`, `world_grade.frag` and all
`WORLD_GRADE_*` keys are deleted. An A/B in the empty world confirmed the pass
was net-negative: with it off, HP bars and damage numbers are readable again and
nothing is lost.

**What this does to the remaining steps:**

- **Steps 1 and 2 are historical.** Their mechanism is gone with the grade pass.
  What survives is the three-hue palette (hero orange 22°, enemy magenta 338°,
  world/prop cyan 185°) — that still governs everything drawn.
- **Step 3 stands unchanged.** Hero and enemies were never texture-based; the
  accepted halo treatment is exactly the language the world now joins.
- **Step 4 is now authoring, not correction** — build props as code-drawn neon
  geometry, subordinate to actors. It cannot be judged until the world has
  content again.
- **Step 5 loses its premise.** It was a unified grade over photoreal art plus
  neon. With no grade pass and no photoreal art, only the bloom half remains.
- **Step 6 is unaffected** — build-reactive glow needs no world art.
- **New work sits ahead of Step 4:** ground and zone rendering as code-drawn
  neon, and a stamp catalog schema that carries shape parameters instead of a
  PNG path.

## Protocol

Step-by-step. Each step is one small change with its own build-and-look
checkpoint and an accept/reject gate before the next step starts. The order is
**look first, motion later**: the art-language steps are the ones that address
the actual complaint and are verifiable in a screenshot. Motion polish comes
after the look is locked, and its gates require playing the build rather than
looking at a still.

If a step is rejected, iterate on that step — do not continue, because later
steps assume earlier ones are locked.

Tools: `./bt dev` for iteration builds, `visual-check` for screenshot capture,
`smoke-test` for headless perf checks under enemy load. Every tunable goes into
`configs/` (or `configs/effects/`) per the no-hardcoded-values rule.

### Step 0 — Baseline capture — DONE (accepted 2026-08-07)

Captured at seed 1: `step0_t1.5`, `step0_t4`, `step0_t8`, `step0_zoom`
(`--camera-zoom=2.6`). Findings recorded in "Baseline Diagnosis" above.

### Step 1 — World flattening — DONE (accepted 2026-08-07)

**Change:** crush ground and terrain toward near-black and desaturated. Reduce
perceived texture detail/contrast so the ground reads as backdrop rather than as
competing subject. Tint/darken via config, not by replacing art.

**Config:** `configs/` world/ground tint, saturation, brightness values.

**Test:** `./bt dev`, then `visual-check` at default zoom and `--camera-zoom=2.6`
with `--seed=1` — identical flags to the Step 0 baseline.

**Checklist:**
- [x] Hero silhouette now separates instantly from the ground.
- [x] Ground still readable as ground (paths vs. off-path still legible).
- [x] Does not read as "just darker" — texture noise/contrast is genuinely
  reduced, not only dimmed.
- [x] Compare directly against `step0_zoom.png`.

**Gate:** accept/reject the crush amount. This is the step that decides whether
the dark-neon commitment actually works with the current assets.

### Step 2 — Palette discipline — DONE (accepted 2026-08-07)

**Change:** restrict the whole scene to a dark base plus two or three neon
accent hues. Remove stray mid-tone browns/greys that survived Step 1.

Implemented as a hue+brightness gate on the existing `WORLD_GRADE_*` saturation
mask (`assets/shaders/world_grade.frag`, `src/render/WorldGradePipeline.*`):
a saturated pixel only stays protected as neon if its hue also sits near one
of the three locked accent hues AND its brightness clears a floor. The
brightness term was required because the corn-husk crop texture is itself a
saturated ~25° orange, almost the same hue as the 22° hero accent — hue alone
could not separate a photoreal crop from the hero's paint; hue plus "hero
paint is max-brightness, crop texture is ~40% brightness" could.

**Locked hue set:** hero orange (22°, from `HERO_OUTLINE` 255,120,40), enemy
magenta (338°, from `ENEMY_OUTLINE` 200,40,100), world/prop cyan (185°,
matches existing prop edge-glow art). Tolerance 10°, softness 8°, brightness
floor 0.75.

**Config:** `configs/theme.yaml` — `WORLD_GRADE_PALETTE_HUE_{0,1,2}`,
`WORLD_GRADE_PALETTE_HUE_TOLERANCE`, `WORLD_GRADE_PALETTE_HUE_SOFTNESS`,
`WORLD_GRADE_NEON_MIN_VALUE`.

**Test:** `./bt dev`, `visual-check` a full region.

**Checklist:**
- [x] Countable accent hues — two or three, not a spread.
- [x] Accents land on things that matter (hero, enemies, loot, path), not on
  arbitrary scenery.
- [x] Scene reads as authored, not as a darkened photo.

**Gate:** accept/reject the chosen hue set. This locks the palette for every
later step. **Hue set accepted; the crush is NOT settled.** The brightness
floor that made stray saturated texture crush correctly also destroyed the
game's soft-glow language, and was removed during Step 3 (see above). The
three-hue palette stands, but the corn crop and similar saturated texture
render bright again. Dark ground *and* live glow needs the grade pass to run
on the ground layer before entities and glow draw on top — a render-order
change, not a shader tweak. Unresolved; revisit at Step 5.

### Step 2b — Hero identity (the hero's form) — NOT STARTED

**Numbered 2b deliberately.** It belongs before Step 3, but Steps 3-11 are
referenced by name across the commit history and this document, and renumbering
them would silently invalidate every one of those references.

**Why this step exists.** The protocol had a hole. Four steps touch the hero —
3 (unified glow), 6 (build-reactive glow), 7-10 (motion) — and every one governs
how the hero is *lit* or how it *moves*. **None of them decides what the hero
is.** The plan silently assumed the sprite atlas answered that, so no step owned
the silhouette. The no-texture directive destroyed that assumption: the hero had
to become drawn geometry, and a form was picked (Kite, `HERO_BODY_SHAPE_INDEX`
13) inside what was meant to be a mechanical de-texturing slice, with no gate.
That is the one design decision in this pass that was taken without the owner.

**It sits before Step 3 for a structural reason.** Step 3's gate asks "do hero
and enemies read as one visual family?" That question cannot be answered while
the hero's form is unsettled — which is exactly why Step 3's earlier acceptance
no longer holds: it was accepted when the hero was a humanoid sprite.

**Change:** deliberately design the hero's silhouette, rather than inheriting a
catalog index chosen for convenience. The hero is the one thing on screen the
player looks at 100% of the time, so this is arguably the highest-leverage
decision in the whole protocol.

Open questions this step must answer, not assume:
- Catalog pick, or a purpose-built hero shape? Every other actor is cut from the
  shared 60-shape alphabet; the hero being the one authored exception may be
  exactly right, or may break the "one alphabet" idea that makes the look cohere.
- How much silhouette complexity survives at gameplay zoom, where the hero is
  roughly 150 world px on a ~1900 px screen?
- Should the hero read as a *creature* at all, or is an abstract craft-like glyph
  the honest answer for a game with no character art?
- Does the form still read when the build-reactive glow (Step 6) is at full heat
  and the body is surrounded by its own light?

**Config:** `configs/hero.yaml` — `HERO_BODY_SHAPE_INDEX`,
`HERO_BODY_ROTATION_OFFSET_DEG`, `HERO_BODY_SIZE`, `HERO_BODY_RIM_RATIO`,
`HERO_BODY_WALK_PULSE`, `HERO_FILL_*`, `HERO_OUTLINE_*`.

**Test:** `./bt`, then `visual-check` at `--camera-zoom=2.6` (form), at `1.0`
(gameplay legibility), and inside a swarm with several enemies of every tier.
Facing legibility needs the game played, not a still.

**Checklist:**
- [ ] The hero is instantly findable at gameplay zoom, before colour is
  considered — the silhouette alone should do it.
- [ ] Facing is readable at a glance, standing still and moving.
- [ ] The form survives a swarm: still identifiable with enemies overlapping it.
- [ ] It does not read as an enemy — no enemy silhouette should be confusable
  with it, at any tier.
- [ ] It still reads at full build-glow heat, not swallowed by its own halo.
- [ ] It is a form worth looking at for a whole run.

**Gate:** accept/reject the hero's form. This locks the subject of Step 3, so
Step 3 must be re-verified against whatever is accepted here — its earlier
acceptance was against the retired sprite hero and does not carry over.

### Step 3 — Unified outline/glow on hero + enemies — ACCEPTANCE LAPSED, re-verify after Step 2b

**Change:** the hero's existing orange rim outline becomes a consistent,
deliberate treatment applied identically across the hero and every enemy type
(hue differing by role, thickness/behaviour identical).

Every enemy already drew a multi-layer falloff glow halo behind its body
(`EnemyBodyPainter.cpp`, driven by `THEME_HALO_*`); the hero only had a static
pre-baked rim-outline sprite and a thin ground locator ring — no soft glow.
That asymmetry was the actual "hero and enemies don't read as one visual
family" gap. `WorldRenderer::drawHeroBody` (`WorldRenderer_EntityDraw.cpp`)
now draws the identical halo loop — same `THEME_HALO_GLOW_LAYERS` /
`_RADIUS_STEP` / `_ALPHA_BASE` keys, same falloff math — using the hero's
outline colour (hue differs by role: orange for hero vs the tier hues for
enemies, thickness/behaviour identical since the code path is now shared).

Known scope: the glow radius is `heroRadius` (the small collision-circle
radius), so it rings the hero's feet rather than wrapping the taller sprite
silhouette. Enemies are squat circular bodies so their halo naturally wraps
their whole visible shape; the hero's does not yet. Owner picked "accept
as-is" for the halo *size* specifically when asked — that is not the same as
the Step 3 gate itself, which the owner has not yet reviewed.

**Test:** `./bt dev`, `visual-check` hero plus several enemy types together, and
with `--perf-enemies=N` for a dense pack.

Two defects surfaced only once the step was actually tested against a pack,
and both were fixed inside this step:

1. The `WORLD_GRADE_NEON_MIN_VALUE` brightness floor added in Step 2 was
   crushing every soft glow in the game — halos, damage text, XP floats,
   attack VFX. Brightness runs backwards as a discriminator: glow falloff is
   dimmer than the texture the floor was meant to exclude, so it spared bright
   core strokes and destroyed the soft glow around them. Removed, not tuned.
   Corn renders bright again as a result; see the Step 2 note below.
2. Halo alpha stacked toward opaque across a pack (`THEME_HALO_GLOW_ALPHA_BASE`
   150 over five layers, times a 2.2x Rare mult), fusing a swarm into one
   field. Base dropped to 55 and tier alpha mults pulled in.

Rare enemies also moved out of gold (~48°, inside the hero's own orange
family, and a fourth accent hue) into hot pink `255,60,160` (~329°), so
enemies hold magenta + cyan and the hero owns orange alone.

**Checklist — owner-verified against a 12-enemy three-tier swarm:**
- [x] Hero and all enemy types read as one visual family.
- [x] Outline distinguishes hero from enemy instantly by hue.
- [x] Silhouettes readable at gameplay zoom and under swarm density.
- [x] Does not clash with damage-flash/hit-feedback colours.

**Gate:** accept/reject the outline style. Accepted 2026-08-08 — but that
acceptance **has lapsed**: it was given when the hero was a humanoid sprite
atlas, and the hero is now drawn geometry. "Hero and all enemy types read as one
visual family" is a claim about a subject that no longer exists, so this step
must be re-verified once Step 2b settles the hero's form. The enemy half of the
step is unaffected.

**Open, deliberately deferred:** loot/quality Rare (`quality.yaml`, 255,215,50)
is still gold, so enemy Rare and loot Rare no longer share a colour. Outside
this pass's world/hero/enemy scope — changing it reaches tooltips, auras and
damage text.

### Step 4 — Prop and scenery treatment — IMPLEMENTED, pending owner verification

**Change:** bring the existing cyan prop edge glow in line with the Step 3
system — props glow, but dimmer than actors, so they read as world rather than
competing with characters.

**Test:** `./bt dev`, `visual-check` a region with several prop stamps plus the
hero.

**Checklist:**
- [ ] Props read as the same family as hero/enemies but clearly subordinate.
- [ ] No prop outshines the hero.
- [ ] Landmarks still stand out enough to be worth navigating toward.

**Gate:** accept/reject prop glow intensity.

### Step 5 — Bloom (grade half deleted) — IMPLEMENTED, pending owner verification

**Change:** single bloom threshold plus one colour grade applied uniformly
across world, hero, and enemies. Tune the existing GPU bloom by config rather
than per-object hacks.

**Config:** `configs/effects/` — bloom threshold, grade values.

**Test:** `./bt dev`, `visual-check` a full scene.

**Checklist:**
- [ ] Scene reads as one coherent image.
- [ ] Neon still pops against the dark base — not washed out or over-bloomed.
- [ ] Hero, enemies, and ground all remain distinguishable at a glance.

**Gate:** accept/reject the grade — this is the "does it finally look
professional" checkpoint.

### Step 6 — Build-reactive glow (identity hook) — IMPLEMENTED, pending owner verification

**Change:** hero/world glow hue or intensity shifts with the player's current
dice/loot/luck build state. This is the mechanically unique hook — no other
game's look is driven by dogmax's build system — and it is what makes the game
identifiable rather than generically neon.

**Test:** `./bt dev`, change build mid-run, observe glow response.

**Checklist:**
- [ ] Noticeable but not distracting during combat.
- [ ] Reads as "my build is doing this," not random flicker.
- [ ] Stays inside the Step 2 palette.

**Gate:** accept/reject. If rejected, Steps 1-5 still stand as the shipped look.

### Step 7 — Hero movement easing — IMPLEMENTED, pending owner verification (needs playing)

**Change:** hero acceleration/deceleration instead of instantly snapping to full
speed. **Hero only** — `HeroManager.cpp:89`.

Deliberately narrow: `EnemyManager_Ai.cpp` and `EnemyManager_Attack.cpp` contain
roughly a dozen `velocity = {0,0}` writes that are **gameplay locks** (attack
wind-up, alert freeze, stagger), not movement intent. Routing those through
smoothing would make enemies glide during attack telegraphs — an AI-readability
regression against Pillar 1 wearing a visual-polish hat. Dash writes
(`HeroManager.cpp:86`, `EnemyManager_Ai.cpp:200/225`) must also stay instant or
they stop reading as dashes.

Two correctness requirements: `WorldRenderer_EntityDraw.cpp:88` and
`HeroManager.cpp:94` read `.velocity` for facing/animation and must read the
**integrated** velocity, not the target, or the hero faces where it intends to go
rather than where it is going; and `Moveable::teleportTo` must zero the smoothed
value too.

**Test:** `./bt dev`, then **play it** — this is not screenshot-verifiable.

**Checklist:**
- [ ] Hero start/stop feels weighted, not instant.
- [ ] No input lag — still responsive.
- [ ] Dash still reads as an instant burst.
- [ ] Enemy attack telegraphs still plant firmly (unchanged).

**Gate:** accept/reject curve shape. Enemy easing, if wanted, is a separate
later step with its own gate.

### Step 8 — Hit-stop — IMPLEMENTED, pending owner verification (needs playing)

**Change:** brief time-freeze (config-driven, roughly 2-4 frames) on
hero-deals-hit and hero-takes-hit, before knockback resolves.

**Config:** `configs/combat.yaml` freeze duration.

**Test:** `./bt dev`, play: attack an enemy, get hit.

**Checklist:**
- [ ] Impact feels punchier, not "attack passes through."
- [ ] Not long enough to read as lag.
- [ ] Holds up at high enemy density.

**Gate:** tune duration, accept/reject.

### Step 9 — Anticipation frames — IMPLEMENTED, pending owner verification (needs playing)

**Change:** short wind-up before hero and enemy attacks fire instead of an
instant strike.

**Test:** `./bt dev`, play: trigger hero attack, watch enemy telegraph.

**Checklist:**
- [ ] Attacks readable a beat before landing (supports the readable-swarm
  pillar).
- [ ] No perceived input delay on the hero's own attacks.
- [ ] Enemy telegraph distinct enough to react to.

**Gate:** accept/reject timing, separately for hero and enemy.

### Step 10 — Squash/stretch and screen shake — IMPLEMENTED, pending owner verification (needs playing)

**Change:** scale-based squash/stretch on hero landing, hit reaction, and enemy
death pop; camera shake on hits with a cap so stacked shake cannot become
unreadable.

**Config:** `configs/` shake magnitude/duration, stretch intensity.

**Test:** `./bt dev`, play: dash, get hit by a cluster, kill enemies.

**Checklist:**
- [ ] Impacts read as impacts, not sprite flicker.
- [ ] Death has a beat rather than just disappearing.
- [ ] Not cartoonish — still in dark-neon tone.
- [ ] Swarm density does not stack shake into chaos.

**Gate:** accept/reject intensities.

### Step 11 — Particle bursts on state transitions — IMPLEMENTED, pending owner verification

**Change:** particle emit on hero spawn/dash/hit/pickup and enemy
spawn/hit/death. World/actor only.

**Test:** `./bt dev` plus `smoke-test` with `--perf-enemies=N`.

**Checklist:**
- [ ] Each transition has a distinct burst.
- [ ] No frame-rate regression under load (check perf report).
- [ ] Particles never obscure gameplay-critical information.
- [ ] Particles stay inside the Step 2 palette.

**Gate:** accept/reject per transition.

## Process notes

- Each accepted step gets its own commit, so any step can be bisected or
  reverted cleanly.
- A rejected step is iterated, not skipped past.
- This spec does not change `docs/ROADMAP.md`'s current `Now` goal. Promote this
  pass to `Now` explicitly if it becomes the active product goal.


## Implementation status (2026-08-08)

Every step 0-11 is now implemented. **Steps 0-3 are owner-accepted. Steps 4-11
are NOT** — they were built and verified for correctness in one long session,
but their gates have not been run with the owner. Nothing below is signed off.

What "verified" means per step, honestly:

| Step | Verification actually performed |
|---|---|
| 4 Props | Screenshot at gameplay zoom; smoke test |
| 5 Bloom | Screenshot with all three tiers, props and a zone in frame |
| 6 Build glow | Screenshot of the PEAK state via a throwaway diagnostic build that forced heat to 1.0. The live ramp needs dice equipped in a real run — unverified |
| 7 Easing | Headless self-test only. Feel is unverified |
| 8 Hit-stop | Headless self-test reaches full simulated duration, proving the freeze expires rather than deadlocking. Feel is unverified |
| 9 Anticipation | Headless self-test only. Feel is unverified |
| 10 Shake + squash | Headless self-test + composed screenshot. Neither shake nor squash is visible in a still — feel is unverified |
| 11 Bursts | Screenshot showing live hit flashes and death rings |

Two new slices were added ahead of Step 4 by the code-drawn-world decision and
are also implemented but unverified: neon zone boundaries, and neon props placed
through the existing stamp catalog via a `shape:<index>` entry.

Deliberately not done, and why:

- **Enemy death scale pop** (part of Step 10). `EnemyDeathPainter` already runs a
  dedicated death animation with shards, rings and body fragments; a scale pop on
  top would fight it rather than add to it.
- **Loot/quality Rare is still gold** while enemy Rare moved to hot pink, so the
  two no longer match. Outside this pass's world/hero/enemy scope — changing it
  reaches tooltips, auras and damage text.
- **Zone texture support still exists** in `drawZone`. Nothing uses it now, but
  removing it would orphan ~100 lines of tile-variation code; that is a cleanup
  slice, not part of this pass.

---

## Step 0 re-run and the no-texture pass (2026-08-11)

The owner directed a restart from Step 0 with one added constraint: **no
textures**. A six-agent deep scan audited every texture dependency and the
protocol's own claims against the source. It found three things this document
was asserting that were **false**:

1. *"Ground, paths and props are shapes plus neon strokes — no texture art in
   the world layer."* The material catalog still eagerly decoded 21 PNGs, 9 of
   13 stamp catalog entries were PNG-backed, and **every world path threw**
   `"World path requires an atlas"` without a 6x6 atlas image — a texture was
   mandatory to draw a world at all.
2. *"Step 3 stands unchanged. Hero and enemies were never texture-based."* True
   of enemies, false of the hero, which was an 8-direction sprite atlas.
3. Steps 9, 10 and 11 were recorded as implemented but were partial — hero
   wind-up only, hit-reaction squash only, 3 of 7 burst transitions.

**Re-baseline.** Captured at seed 1, empty world. The honest finding is not a
polish problem: at gameplay zoom the game is nearly empty — a small hero, a few
tiny rings, pure black. Absence, not ugliness.

**What the pass changed.** The world/hero/enemy layer now loads no image at all:

| Was | Now |
|---|---|
| 9 PNG stamp catalog entries | `shape:<index>` silhouettes, config only |
| Ground = hard-coded `sf::Color::Black` | `WORLD_NEON_GROUND_*` |
| Paths = 6x6 atlas, threw without one | Corridor of two glowing edges |
| Zone edge stroke | Generalised to a shared open/closed polyline |
| Hero = 8-direction sprite atlas | Directional silhouette from the shared catalog |
| Attack VFX = white PNG weapon | Deleted; code-drawn shapes already ran beneath it |
| Floor loot = PNG weapon sprite | Tier-tinted silhouette, type picks the shape |

Everything on screen is now cut from one alphabet: the shared shape catalog
draws the hero, the enemies, the props and the loot.

**The one real trade.** The hero lost its authored humanoid figure and is now an
abstract directional glyph. That is a genuine loss of character read, it was
forced by the no-texture constraint, and it is the owner's to accept or reject.
`HERO_BODY_SHAPE_INDEX` selects any of the 60 silhouettes.

**Known and still open:**
- Enemy bodies drawn through the SDF shader render as near-white rings, which is
  a fourth colour outside the locked palette.
- Loot Rare is still gold while enemy Rare is hot pink.
- Path corridor edges splay at very sharp corners (offset polyline, no mitre limit).
- Steps 9-11 remain partial as listed above.
- UI still uses textures. Out of scope by design.
