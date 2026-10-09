# Instruction

> This document is the canonical design spec for **dogmax**. The game is a 2D isometric, infinite-procedural, dark-cyberpunk-neon roguelike. The [Hero](:hero) auto-attacks with **dice-modded** [Weapons](:weapons), evades incoming damage via [Doge](:doge-system), and progresses through cumulative-distance [Levels](:level-system). [Items](:loot) drop with stats scaled by [Quality](:quality-system) × [Item Level](::item-level).
>
> The 'What' and 'Why' of the game lives here; the 'How' (engine, files, code) lives in the source tree alongside this file. Every [Entity](::entity), [Ability](:abilities), and system mentioned here is the **authoritative description**. If the code disagrees with this document, the code is updated, not the spec.

# Implementation Reconciliation (2026-06-21)

> A full audit of the last development cycle (see `docs/audit/2026-06-21-2day-audit.md`)
> reconciled this spec against the shipped code. Where the code **deliberately
> evolved** (tuning, new systems), the spec below has been updated to match the
> running game. Where the spec describes a feature the code does **not yet
> implement**, it is listed as PLANNED here rather than silently claiming it
> ships. Body sections elsewhere were corrected in place; the lists below capture
> the structural gaps that don't live on a single line.

> **Reconciliation 2026-07-04 — spec aligned to shipped code after plan-execution
> phases 0–C.** A second reconciliation pass followed four landed phases. **Phase 0**
> made the game launch off-box and repaired CI / lint. **Phase A** fixed four P0
> gameplay bugs: permanent item loss on a full-grid drop, the opening D4 group
> gate, the DiceCrafter d100 panel-overlap, and the
> **weapon level-scaling never firing on equip** — a weapon first equipped at the
> level cap was left ~`1.10^99` under-powered; the Hero now rescales equipped
> weapons on every weapon-slot change, with the full-HP heal kept exclusive to the
> level-up path. **Phase B** restored the endgame chase and fixed progression math:
> Hemidron became face-count-relative, the L40 XP cliff was removed (monotonic
> ramp), and `HERO_HEALTH_PER_LEVEL` (1.15 → 1.11), `ENEMY_SPAWN_INTERVAL`
> (1.0 → 0.5 s) and enemy base move speed (300 → 330) were retuned. **Phase C**
> swept rule violations and dead code. Body sections and the lists below were
> updated to match; per-value corrections are noted inline.

> **Reconciliation 2026-07-06 — stabilization pass.** A large stabilization pass
> landed: a headless-launch crash was fixed, config values were extracted, and a
> block of dead code was deleted. The removed code includes the **entire
> automation / E2E cluster** — `SyntheticInput`, the automation server,
> `CommandDispatcher`, the GIF recorder, the `--automation` / `--port` flags, and
> `configs/automation.yaml` — and the **Active Doge helper**
> `src/combat/ActiveEvasion.hpp` with its `ACTIVE_EVASION_WINDOW` /
> `ACTIVE_EVASION_BONUS` config keys, a mechanic that was **never wired into any
> live code path**. The "Automation API" shipped bullet was therefore dropped and
> [Active Doge](::active-doge) is now marked REMOVED. There is no standing test
> suite (tests are bug-triggered only); see git history.

## Shipped systems now reflected in the spec (were undocumented)

- **Fog-of-war**: a revealed-mask render-texture sampled by the floor shader;
  movement-driven reveal ramp/decay with a teleport guard.
- **Wave intro**: a scout wave → group wave → continuous-spawn hand-off precedes
  the steady-state [Spawning](::spawning) loop (`configs/waves.yaml`).
- **Enemy-design system**: per-type YAML templates (`configs/enemies/*.yaml`) drive
  body shape/size/colour and a stack of **effect layers** (static / orbit / popup
  motions, `configs/effects/*`), authored live in a **Ctrl+E modal design editor**.
  Regular (non-special) enemies keep the SDF neon-circle path; only the six special
  kinds are template-driven.
- **Dodge / dash**: Spacebar triggers a movement **dash** (`DODGE_MAX_CHARGES = 2`,
  `DODGE_DASH_SPEED`, cooldown refill) with a HUD charge-dot row and a cyan ghost
  trail. (Distinct from the removed [Active Doge](::active-doge) evade-chance tap below.)
- **Version HUD**: `vMAJOR.MINOR.BUILD` bottom-right.
- **Per-stat quality + drop-chance**: each dropped item rolls 5 independent
  per-stat quality scores (each driving its own universal multiplier); drops are
  gated by `computeDropChance` (base + luck + enemy-tier bonuses) rather than a
  flat guaranteed-drop + bonus-roll model. The illustrative drop-weight tables in
  [Loot](:loot) are superseded by `configs/weapon.yaml` + `configs/dice.yaml`.
- **Kill-streak XP multiplier** (phase B): kills chained within
  `XP_KILL_STREAK_WINDOW_SECONDS` compound an XP multiplier
  (`+XP_KILL_STREAK_BONUS_PER_KILL` per kill, capped at `XP_KILL_STREAK_MAX_MULT`);
  a gap longer than the window resets it. The boosted amount is what both the XP
  bar and the floating "+N XP" report. Canonical at [Leveling & XP](::leveling-xp).
- **DiceCrafter crafting verbs** (phase A/B, `configs/dice_crafter.yaml`): a
  powder-fuelled panel with **REFACE** (re-roll one face, now **keep-max** — never
  regresses a face) and **EVOLVE** (chance to grow the die one face-tier). This is
  the real path to a perfect d100, superseding the spec's informal "3 reds + 1 blue"
  crafting note. Canonical at [Dice Crafter](::dice-crafter).
- **Strict D4-gated three-wave opening** (`configs/waves.yaml`): the wave FSM
  advances Scout → Group only once the player slots the opening D4, records the
  exact three group members, and starts continuous spawning only after all three
  reach zero HP. There is no timeout path that can bypass the group.
- **Dice level gates** (`configs/dice.yaml`): a face cannot drop until the level
  reaches `DICE_LEVEL_GATE_D<N>` (D4/D6 ungated; d100 unlocks at 80, not 100).
- **Weapon level-scaling on equip** (phase A): equipped weapons rescale on every
  weapon-slot change, not only on hero level-up — fixes endgame weapons equipped at
  the cap being left un-scaled.
- **Hemidron face-count-relative** (phase B, `configs/dron_patterns.yaml`): the
  all-high / all-low split is now `faceCount · DRON_HEMIDRON_SPLIT_RATIO` per die
  (not a fixed d6 `>3`), so a six-d100 build no longer auto-hits Hemidron ~83 % of
  rolls. Dron detection also tests Lineadron (×10) before Split-Seqdron (×8).

## PLANNED — described in this spec but NOT yet implemented

- **Tridron enemy** (the H2 enemy section): no such `SpecialEnemyKind` exists. (The
  "Tridron" in code is an unrelated [Dron Multiplier](:dron-multiplier-system) tier.)
- **Tassidean Sentinel** and **Pact-Walker** special mechanics: spawn as baseline
  Rare stubs; their phase/invuln/neutral-until-provoked behaviours are deferred.
- **Active Doge** (Spacebar evade-chance tap, +`ACTIVE_EVASION_BONUS` for one hit):
  **REMOVED 2026-07-06 — never shipped.** The mechanic was never wired into a live
  code path; the helper `src/combat/ActiveEvasion.hpp` and its
  `ACTIVE_EVASION_WINDOW` / `ACTIVE_EVASION_BONUS` keys were deleted. Spacebar
  drives the movement dash above. Retained here as an aspirational design target
  only; canonical note at [Active Doge](::active-doge).
- **Floor field-types / tile-atlas** and emissive floor **filigree**: the floor is
  a procedural Voronoi cracked-stone shader, not an atlas of field types.
- **Ambient wildlife**, **Points of Interest / ancient ruins**: not implemented.
  Water features (lakes, rivers, cascades, bridges) were removed from the game
  entirely — the world is open ground with no water barrier — and are no longer
  part of the design.
- **Villages / NPCs / vendors** (the [Villages](:villages), [NPCs](:npcs) sections):
  not implemented. No village generation, NPC AI, faction reputation, or vendor
  trade loop ships; the world is open ground with only the debug village-spawner
  tool stubbed. Kept as a design target.
- **Auto-powder filter** (the [Auto-Destroy on Pickup](::auto-destroy-on-pickup)
  section): not implemented. `AUTO_POWDER_BELOW_QUALITY` is not present in
  `configs/inventory.yaml`; every pickup goes to the [Inventory](:inventory). (The
  shipped `configs/loot_filter.yaml` drives a separate loot-filter popup, not this
  pickup-time auto-conversion.)
- **Hero death leaderboard + full run-summary panel**: only a "GAME OVER" + level/XP
  panel with Enter-to-restart ships.
- **Bloom-scales-with-zoom**, and bloom in general, ship **disabled** (`BLOOM_ENABLE: 0`).
- **Audio — Music / full SFX / Volume mixing** (the
  [Aesthetic & Audio](#aesthetic--audio) section): only the fixed pickup SFX ships.
  Music, combat SFX, UI SFX, and volume/mix controls remain deferred design targets.

## Terminology / value notes (code is canonical)

- The code uses **"Evasion"** (`EVASION_CAP`, `evasionPerSlot`, `EvasionCalculator`)
  where this spec says **"Doge"** (`DOGE_CAP`, `dogePerSlot`); the values agree.
- The [Debug Mode](:debug-mode) panel ships **8 tabs** (General, Hero, Enemies,
  Weapons, Dices, Floor, Performance, Config), not 3.
- The Ctrl+H gallery has a **third category, Grouped FX**, beyond Game Art / UI Kit.
- The enemy **"Lv N"** label renders **centered above** the healthbar (not to its left);
  the XP bar height is **18 px** (not 28).
- Weapon **slot-count** normalizes by the dropped **item's** level (`(itemLevel−1)/98`),
  not hero level; the starter Pitchfork has no `isStarter` flag — it is a separate
  `makeStarterPitchfork` path that never enters the drop/re-roll pipeline.

## Reading Order

- Start with [World](:world) and [Global Design](:global-design) to absorb the aesthetic foundation.
- Read [Hero](:hero) and [Enemy](:enemy) to understand the central combat loop.
- Walk through [Weapons](:weapons), [Dices](:dices), and [Dron Multiplier System](:dron-multiplier-system) to grasp damage flow.
- Cross [Quality System](:quality-system), [Level System](:level-system), [Luck System](:luck-system) to see how stats are derived.
- Visit [Inventory](:inventory), [Weaponslot](:weaponslot), [Diceslot](:diceslot) for equipment flow.
- Finish with [Roadmap](:roadmap) for the implementation phases.

## Cross-Reference Syntax

> Every defined term in this document is reachable via an internal link. The number of leading colons in the link target tells the reader which heading depth the term lives at.

- `[Label](:slug)` — points at an H1 section (e.g. `[Hero](:hero)` → `# Hero`)
- `[Label](::slug)` — points at an H2 subsection (e.g. `[Field Types](::field-types)` → `## Field Types`)
- `[Label](:::slug)` — points at an H3 entry, including deep cross-references (e.g. `[Hexadron](:::hexadron)` → `### Hexadron`)

Rules:

- The `slug` is the heading text lowercased, with `&` dropped and every non-alphanumeric run collapsed to a single hyphen (so `Aesthetic & Audio` → `aesthetic-audio`, `Lore & Setting` → `lore-setting`).
- Every keyword used in the prose is cross-linked at first mention in a section; the reader can follow any link to reach the term's canonical definition.
- A full backing index of every anchor is maintained in [Appendix C — Glossary Cross-Reference](:appendix-c-glossary-cross-reference); mdvault-style editors can validate every link against this list.
- If a term is not yet linked, it either is being introduced in the current paragraph or is intentionally informal — the [Glossary](:glossary) is the fall-back lookup in either case.

## Reserved Tags

Tags annotate a section's intent. A tag is the literal token `@name` (no spaces, no parentheses). Tags MUST be placed on the line **directly above** an H1, H2, or H3 header. Multiple tags may share a single line — separate them with one or more spaces. The underlying markdown stays valid plain markdown.

Syntax rules:

- Each tag matches `@[A-Za-z0-9_-]+`
- The whole tag line must consist only of tag tokens — any other content on the line disables chip rendering
- The tag line must immediately precede a heading (no blank line between the tag line and the heading)
- A heading without a preceding tag line is untagged; this is the default state for every section

Defined tags:

- `@rewrite` — Complete structural rewrite of the codebase for this section.
- `@improve` — Refactor and optimize existing code for this section without changing behavior.
- `@update` — Adapt the code to incorporate new information, dependencies, or requirements.
- `@performance` — Check and verify the runtime performance of the section. Profile the relevant code path, confirm it stays within the section's budget (frame time, allocations, draw calls, network round-trips, whichever the section commits to), and flag any regression before merging.

Example:

```
@rewrite @improve
## Some Section
```

```
@performance
## Spatial Grid
```

## Vocabulary Conventions

- An **[Entity](::entity)** is anything that participates in the game world: the [Hero](:hero), [Enemies](:enemy), [Weapons](:weapons), [Dices](:dices), [NPCs](:npcs), [Ambient](::ambient) wildlife, [Powder](:powder-system) stacks.
- An **[Ability](:abilities)** is a stand-alone trait that an Entity inherits; it never knows about concrete entity types.
- A **stat** is a single numeric value on an Entity that participates in formulas (`damage`, `health`, `aps`, `crit`, `luck`).
- A **trigger** is a moment where a system fires (e.g. a [Weapon](:weapons) trigger when its [Countdownable](::countdownable) reaches 0).
- A **slot** is a UI cell that can hold one Entity of a fixed type (a [Weaponslot](:weaponslot) cell holds a [Weapon](:weapons); a [Diceslot](:diceslot) cell holds a [Dice](:dices)).

---

# World

> Infinite 2D isometric map. Procedural floor of large procedural fields. Art direction: **Dark Cyberpunk Outline Neon Glowing** — bodies and surfaces dark, blackish, or transparent, accented by bright outline glow.

- Infinity
- 2D
- Isometric
- Procedural
- Big procedural shaped fields ([Body Design](::body-design))
- [Outline](::outline)
- Populated by [Procedural Topography](::procedural-topography), [Points of Interest](::points-of-interest), [Ambient Wildlife](::ambient-wildlife)
- Punctuated by rare [Villages](:villages) at long real-time travel distance from the [Hero](:hero)'s start position

## Field Types

> The world is partitioned into large biome-like fields by the [Floor Shader](::floor-shader). Each field is a coherent block of texture and lighting that may span several screens.

### Earth

- Default biome
- Dark brown earth tiles dominate
- Densest near the [Hero](:hero) start position
- Hosts [Bunny](:::bunny) and [Bird](:::bird) ambient wildlife
- Common spawn zone for [Common](:::common-tier) [Enemies](:enemy)

### Golden Earth

- Warm tan variation
- Mid-distance band
- Slightly elevated [Item Level](::item-level) drops

### Very Dark Earth

- Shadow / depth patches
- Indicates nearby [Ancient Ruins](:::ancient-ruins) or [Hexarchon](::hexarchon) spawn zones

### Cobblestone

- Stone patches near [Villages](:villages) and [Tassides Civilisation Remnants](::tassides-civilisation-remnants)
- Marks safe-haven proximity

### Dark Patterned Stone

- Ancient construction motifs
- Frequently borders [Ancient Ruins](:::ancient-ruins)

### Marble

- Rare biome tile
- Visual sign of higher-tier loot bias

### Dark Green Moss / Swamp

- Damp lowland field
- Slows the [Hero](:hero) by 5 %
- Hosts unique [Ambient Wildlife](::ambient-wildlife) variants

### Bright Green Grass

- Open meadow biome
- Common around [Villages](:villages)
- Frequented by ambient [Bunny](:::bunny) and [Bird](:::bird)

## Procedural Variation

> Each field is generated from a weighted style palette. The same biome can pull from multiple [Field Types](::field-types) to produce natural visual variation.

- Tile style weights are configurable per style block
- Style blocks shift smoothly across biome bands so transitions are not sharp
- Random local accents (single-tile flowers, cracks, neon residue) seed visual interest
- The variation system is the foundation for the [Biome Bands](::biome-bands) concept in [World Generation](:world-generation)

## Floor Shader

> The infinite floor is one quad sized to the camera each frame, sampled in world space so the floor pattern is stable as the [Hero](:hero) moves.

- Quad expanded by 1024 px padding each side so edges never appear in the [Camera](:window-camera) frustum
- Reconstructs world position from the quad's UVs
- Samples the tile atlas with a hash-based weighted pick of [Field Types](::field-types)
- Adds emissive accents (low-frequency neon filigree) so the floor itself participates in the [Cyberpunk](::cyberpunk) aesthetic
- All animations are GPU-only — zero CPU per-tile cost

## Boundaries

> The world has no boundary. Movement is unbounded in all 8 [Directions](:directions).

- Camera follows the [Hero](:hero) and snaps to whole world-pixels to avoid floor shimmer
- Zoom changes the visible area but never the world extent
- Item / enemy world coordinates stored as 32-bit floats; precision adequate for normal play durations — no world-coordinate refactor in [Roadmap](:roadmap)

---

# Lore & Setting

> The game is set in the shattered universe of the [Ancients](::ancients). The [Hero](:hero) begins as an ordinary [Farmer](::farmer) whose workday is violently interrupted by a threat he does not understand. He grabs his nearby [Pitchfork](::pitchfork) to survive, and only later encounters the [Dices](:dices) scattered through the [World](:world) as fragments of the lost [Veros](::veros). The fiction frames every mechanical system without making the Farmer knowledgeable about it at the start.

- All in-fiction names appearing in other sections (Veros, Ancients, Shattering, Farmer, Tassides) are defined canonically here
- This section is the lore anchor; mechanical sections only cross-link back ([Lore & Setting](:lore-setting))
- The tone is gritty Dark-Age fantasy fused with the [Cyberpunk](::cyberpunk) visual identity — ruined antiquity lit by neon survival

## Veros

> Artifacts of pure probability forged by the [Ancients](::ancients). Each intact Veros was a self-contained ordering principle — a sphere of crystallised chance that bent local reality to its rolls.

- A single Veros, intact, ordered an entire province of the old world
- After the [Shattering](::shattering) no intact Veros remains in the [World](:world)
- Every [Dice](:dices) the [Hero](:hero) collects is a splinter of a Veros — its face count, colour, and statistical bias inherited from the parent artifact
- The [Powder](:powder-system) released by destroying items is the residual Veros-dust of those splinters

## Ancients

> The vanished progenitor civilisation that forged the [Veros](::veros) and inscribed the laws of probability upon the [World](:world). Their script is the [Filigree](::filigree) seen on high-tier items and ruined surfaces.

- Long predate any current [NPCs](:npcs) or [Villages](:villages)
- Their only remnants are scattered ruins — see [Tassides Civilisation Remnants](::tassides-civilisation-remnants) and [Ancient Ruins](:::ancient-ruins)
- The [Tassidean Sentinel](::tassidean-sentinel) is the last extant guardian of an Ancients site
- Ancient construction motifs appear on [Dark Patterned Stone](:::dark-patterned-stone) and along the [Cobblestone](:::cobblestone) approaches to ruins

## Shattering

> The cataclysm that fractured every [Veros](::veros) and scattered the splinters across the [World](:world). The current age is the long aftermath — the "Chaos" — in which probability has slipped its bonds.

- Marks the boundary between the [Ancients](::ancients) age and the present
- Cause is unknown in-fiction; the [Tassides Civilisation Remnants](::tassides-civilisation-remnants) hold fragments of its record
- The unstable spawn cadence of [Enemies](:enemy), the chaotic [Dron Multiplier System](:dron-multiplier-system) triggers, and the existence of [Special Enemies](:special-enemies) are all consequences of the Shattering
- The [Hero](:hero)'s goal — never explicitly stated in HUD or tutorial — is to gather enough [Dices](:dices) to reconstitute a Veros

## Farmer

> The [Hero](:hero) the player controls. A simple farmer attacked at home by something unknown; he takes up his worn work [Pitchfork](::pitchfork) because it is the only protection at hand, and that ordinary act begins the trouble.

- Has no martial training; combat skill grows entirely through [Level System](:level-system) and equipment
- Begins the game unarmed beside a single [Pitchfork](::pitchfork) and with zero [Dices](:dices)
- The "starter pitchfork outside pickup range with blink-blink effect" directive ([Roadmap](:roadmap)) is the in-fiction survival response to the first unknown attack
- All other in-fiction biography is intentionally absent — the player projects onto the [Farmer](::farmer)

## Tassides Civilisation Remnants

> Ruined outposts of the long-dead Tassides — an inheritor culture that came after the [Ancients](::ancients) but before the [Villages](:villages) that now exist.

- Visually marked by [Dark Patterned Stone](:::dark-patterned-stone) and approach paths of [Cobblestone](:::cobblestone)
- Guarded by [Tassidean Sentinel](::tassidean-sentinel) enemies
- Carry [Filigree](::filigree) script linking them to the [Ancients](::ancients) lineage
- A spawn anchor for [Very Dark Earth](:::very-dark-earth) field zones

## Dices as Veros Fragments

> Every mechanical property of a [Dice](:dices) is a fictional consequence of its origin as a splinter.

- Higher face count → larger surviving fragment → rarer drop and wider result range; roll time remains an independent property
- Colour per face count ([Powder System](:powder-system) canonical mapping) is the spectral signature of the parent Veros
- The [Dron Multiplier System](:dron-multiplier-system) combinations are the Ancients' lost notations — when reassembled by chance, they briefly restore a fragment of the old probability calculus and detonate the bonus multiplier

---

# Global Design

> The visual identity of the game is dense, low-contrast in the body, and high-contrast in the outline. Everything reads as "dark mass with glowing edge."

## Cyberpunk

> **Low-reflectivity, matte-black surfaces** for high-contrast silhouettes; form defined by **high-frequency neon outlines** and luminescent filigree. **Hard-surface medieval geometry** layered with **vibrant light-trails** over brutalist textures — circuit-driven gothic interface.

- Applied to every [Entity](::entity), surface, and UI panel
- The [Hero](:hero), [Enemies](:enemy), [Weapons](:weapons), [Dices](:dices), [NPCs](:npcs) all share the same body-vs-edge contrast logic

## Neon

> An inert noble gas which, when electrified in vacuum, ignites into a vibrant, piercing glow that cuts through the darkness.

- The colour vocabulary for [Outline](::outline) and emissive accents
- Saturated hues only: cyan, magenta, electric green, hot pink, neon orange
- Forbidden colours: muted earth tones, pastel washes (those live on the floor)

## Dark

> Low-luminance neutral tone. Subtle specular highlights and tonal shifts let the eye resolve depth, volume, and structure within shadows.

- Body fill of every [Entity](::entity)
- Never pure black — a slight blue / violet tint keeps shapes legible
- Combined with [Outline](::outline) for the signature dual-tone silhouette

## Outline

> High-intensity emissive stroke on the [Body Design](::body-design) boundary. Post-process bloom filter generates Gaussian-blurred light bleed that softens the [Body Design](::body-design)-to-background transition.

- All entities have an [Outline](::outline) intensity proportional to their importance and quality tier
- Higher [Quality](:quality-system) → brighter outline
- [Charged](::charged) [Weapons](:weapons) bump their outline by 50 % to draw the eye to ready triggers
- Bloom radius and intensity are global parameters with cinematic defaults
- The "make the glowing bigger" directive in [Roadmap](:roadmap) Phase 3 raises both radius and intensity to be more impactful

## Body Design

> The physical mass defining an [Entity](::entity) form.

- The interior dark fill of every [Entity](::entity)
- Holds [Item Type](::itemable) visual cues without overwhelming the [Outline](::outline)
- For [Weapons](:weapons): silhouette suggests the weapon class (e.g. straight blade vs hooked axe)
- For [Dices](:dices): cube / polyhedron silhouette suggests face count
- For [Enemies](:enemy): a body silhouette that scales with [Quality](:quality-system) tier

## Bloom Strength

> The post-processing bloom radius and intensity applied to all neon outlines. Canonical for both visual and audio-team reference.

- Default radius: **4 px**
- Default intensity: **0.85**
- [Roadmap](:roadmap) Phase 3 directs an increase ("make the glowing bigger") so neon traces are immediately visible at default zoom
- Bloom uses a GPU bright pass followed by horizontal and vertical blur at a
  configured downsample factor; it never reads the live framebuffer back to CPU.
- Bloom is applied to the physical-pixel world surface before presentation; the
  separate UI layer remains bloom-free for crispness.

## Outline Intensity

> Per-entity emissive multiplier applied to the [Outline](::outline) before bloom.

- Tied to [Quality](:quality-system) tier — canonical per-tier values in [Tier Multiplier Reference](::tier-multiplier-reference) (Outline Intensity row)
- [Charged](::charged) state bumps the multiplier by +0.5 transient until the next fire
- [Doge](:doge-system) evade events flash the outline to white-cyan for 0.15 s

## Filigree

> Decorative high-frequency neon line work overlaid on key surfaces.

- Appears on [Weapons](:weapons) at high item levels
- Appears on [Tassides Civilisation Remnants](::tassides-civilisation-remnants) ruins as scriptural markings
- Used sparingly so [Body Design](::body-design) silhouettes stay clear

## Visual Hierarchy

> The order in which the eye is meant to read each frame.

- **First read:** the [Hero](:hero) — always brightest outline at frame centre
- **Second read:** nearby [Enemies](:enemy) — high-contrast bodies, colour-coded outlines per tier
- **Third read:** the [Weaponslot](:weaponslot) sidebar — pulses on [Charged](::charged) events
- **Fourth read:** floor [Items](:loot) — dim until proximity radius
- **Fifth read:** [Ambient Wildlife](::ambient-wildlife) and biome detail — always present, never demanding

## Render Order

> Painter-algorithm draw order for every world-space [Entity](::entity): whatever is **in front of** the [Hero](:hero) occludes the Hero; whatever is **behind** is occluded by the Hero. Distinct from [Visual Hierarchy](::visual-hierarchy) (attentional priority, not pixel layering).

- **Sort key:** each renderable's **world-Y anchor** (the sprite's feet / bottom edge in world coordinates)
- **Behind the Hero** (smaller Y, further up the screen from the player's viewpoint) → drawn **first**, so the Hero and anything further down can paint over it
- **In front of the Hero** (larger Y, further down the screen) → drawn **last**, so it covers the Hero and everything behind
- The Hero is **not** privileged — it participates in the same Y-sort as every other [Entity](::entity) ([Enemies](:enemy), [NPCs](:npcs), [Ambient Wildlife](::ambient-wildlife), dropped [Items](:loot), [Tassides Civilisation Remnants](::tassides-civilisation-remnants), [Buildings](::buildings)) — no per-class layer hacks
- Equal-Y ties are resolved by stable insertion order (FIFO of the spatial grid bucket) so frame-to-frame swaps never cause z-fighting flicker
- **Per-entity internal painter order** (sprite body → [Outline](::outline) → [Filigree](::filigree) → floating overlays such as [Hero Healthbar](:::hero-healthbar) / [Enemy Healthbar](::enemy-healthbar) → [Damage Text](::damage-text)) is preserved **within** that entity's Y-sort slot; the global rule only governs the relative order of entity stacks, never their internal layers
- **Floor pass** ([Field Types](::field-types), [Floor Shader](::floor-shader), [Procedural Variation](::procedural-variation), [Lines (Debug)](::lines-debug), floor decals from [Floor Drop](::weapon-floor-drop)) draws **before** the first entity in the Y-sort
- **UI pass** ([Weaponslot](:weaponslot), [Inventory](:inventory), [XP Bar](:::xp-bar), [Hover Tooltip](::hover-tooltip), [Help Overlay](::help-overlay), [Console](:console), [Debug Mode](:debug-mode) overlays) draws **after** every world-space entity, in screen space, on top of the bloom pass
- **Bloom / post-processing** sits between the world-entity pass and the UI pass so neon outlines glow but UI text stays crisp
- **Culling:** the Y-sort runs once per frame over only the entities that intersect the [Continuous Camera](::continuous-camera) view rect — off-screen bodies skip the sort entirely
- Replaces any earlier implicit "drawn after / drawn before" wording elsewhere in the document: those phrases describe **internal** stacking within an entity, never global cross-entity order

## Colour Palette

> Master swatch of every load-bearing colour in the game.

### Quality Tier Colours

- Common — soft electric blue
- Uncommon — electric green
- Rare — electric red
- Mythic — gold-white (placeholder past Rare)

### UI Panel Colours

- Inventory background — deep violet near-black
- Sidebar background — same family, slightly different alpha
- Slot fill — muted purple
- Slot outline — bright purple for inventory slots; reddish purple for weapon slots
- Dice slot outline — bright blue
- Progress bar fill — phosphor green

### Damage Text Colours

- Normal hit — white
- Heavy hit — orange-amber
- Critical hit — hot red
- Outline — black, for legibility against the floor

### Dron Float Text Colour

- Gold (used for [Dron](:dron-multiplier-system) names floating above the [Weaponslot](:weaponslot))
- Duration canonical at [Floating Text](::floating-text) (`SLOT_FLOAT_TEXT_DURATION`)

### Debug Overlay Colours

- Attack range — bright green
- Pickup range — yellow
- Chase range — orange
- Enemy attack range — red
- Debug text — lime green

### Powder Colours (Palette)

- Canonical per-source colour mapping: [Powder Colours](::powder-colours) inside [Powder System](:powder-system)
- Do not restate the dice-face / weapon colour list here — it lives at the canonical anchor

---

# Hero

> The [User](::user)'s avatar. Auto-attacks with equipped [Weapons](:weapons), evades via [Doge](:doge-system), and gains [Levels](:level-system) by killing [Enemies](:enemy).

- [Moveable](::moveable)
- [Inputable](::inputable)
- [Aimable](::aimable)
- [Targetable](::targetable)
- [Pickupable](::pickupable)
- [Damageable](::damageable)
- [Deathable](::deathable)
- [Levelable](::levelable)
- [Doge](::doge)
- Spawns at the start position with full health (default max canonical at [Health](::health))
- Carries equipped Weapons in the [Weaponslot](:weaponslot) sidebar (slot count canonical there)
- Carries items in the [Inventory](:inventory) plus an extra [Powder Column](::powder-column) (capacity canonical at [Slot Layout](::slot-layout))
- Cannot deal damage directly — only equipped Weapons attack on the [Hero](:hero)'s behalf

## Movement

- Direction comes from [Inputable](::inputable) reading WASD
- Holding two perpendicular keys yields a diagonal, normalised so diagonals are not faster than cardinals
- Holding two opposite keys cancels the older press (e.g. holding W then S retains S until S is released)
- Move speed default 500 world units/second
- Movement is paused while the [Hero](:hero) is dead

## Health

- Default max health 1000
- Damage from [Enemy](:enemy) melee is reduced by potential [Doge](:doge-system) evade
- Current and maximum health are surfaced via the [Hero Healthbar](:::hero-healthbar) floating above the sprite
- Reaching zero triggers [Deathable](::deathable), which freezes the world until restart or reload

### Hero Healthbar

- Position: centred horizontally on the [Hero](:hero) sprite's local origin
- Vertical offset: 40 px above the sprite top edge (world-space, so it tracks the Hero under [Continuous Camera](::continuous-camera) movement)
- Bar dimensions: 200 px wide × 14 px tall
- **Canonical healthbar colour ramp** (shared with [Enemy Healthbar](::enemy-healthbar)): background fill dark `#202028`; foreground blends green → yellow → red driven by `currentHP / maxHP` — `> 50 %` green, `25–50 %` yellow, `< 25 %` red
- **Health number label**: centred on the bar reading `<currentHP> / <maxHP>` (integer values, rounded; white text with a 1 px dark outline for legibility against any field colour)
- Always rendered while the Hero is alive — does **not** auto-hide on full health, so the player can read exact HP at any time
- Drawn after the Hero sprite and before [Damage Text](::damage-text) so floating damage numbers stack readably on top
- The Hero's own [Level](:level-system) is intentionally **not** on this bar — lives in [XP Bar](:::xp-bar) at bottom-centre to avoid duplicating screen real estate

## Leveling & XP

- Sole XP source: each [Enemy](:enemy) on death grants XP via the level-and-quality formula below
- **XP grant formula:**
  - `delta = enemy.level − hero.level`
  - `deltaMult = clamp(1 + delta × xp.deltaScale, xp.deltaMin, xp.deltaMax)`
  - `xp = floor(enemy.level² × qualityMult × deltaMult)`
- `qualityMult` values: see [Tier Multiplier Reference](::tier-multiplier-reference)
- Config knobs (all in `xp.yaml`): `deltaScale = 0.1` · `deltaMin = 1.0` · `deltaMax = 2.0` · per-tier `qualityMult` (Common / Uncommon / Rare = `1.0 / 3.0 / 9.0`, matching the enemy stat-multiplier ladder)
- Effect: enemy 10+ levels above hero → ×2.0 grant; enemy 10+ levels below hero → ×1.0 grant (baseline floor — never below the same-level reward, so killing low-level enemies always yields the per-level baseline XP)
- **Kill-streak multiplier** (`xp.yaml`): each kill chained within `XP_KILL_STREAK_WINDOW_SECONDS = 1.0 s` of the previous one bumps a streak multiplier by `XP_KILL_STREAK_BONUS_PER_KILL = 0.25`, capped at `XP_KILL_STREAK_MAX_MULT = 3.0`; a gap longer than the window resets it to ×1. The streak multiplier is applied on top of `deltaMult` / `qualityMult`, and the boosted amount is what both the [XP Bar](:::xp-bar) and the floating "+N XP" tag report (chained kills also recolour the float gold and grow its font)
- XP table is loaded at start as 99 per-level step costs and converted into cumulative thresholds in the [Hero](:hero)'s [Levelable](::levelable) state — full table at [XP Step Costs](::xp-step-costs-levels-1-99) in Appendix A
- Curve (canonical at [XP Step Costs (Levels 1–99)](::xp-step-costs-levels-1-99)): Phase 1 (L1–39) is `kills(N) = 300 · 1.0705^(N−1)`, `step(N) = round(kills · N²)`; Phase 2 (L40–99) is a pure geometric ramp `step(N) = round(step(39) · 1.06^(N−39))` **anchored at the Phase-1 endpoint** so the two phases join **without the old L39→L40 cliff**. The table is strictly non-decreasing across all 99 levels and stored as `int64` (late-game steps exceed 32-bit range). Cumulative L1→L99 ≈ `3.48 B` XP (~40–45 h of active combat)
- Level cap is 100 (`HERO_MAX_LEVEL`); every hero/enemy/item stat curve uses the `(level − 1)` exponent, so the top level L100 = `base · multiplier^99`. Prose that treats "L99" as the top level is shorthand for the last *step* (L99→L100), not the cap
- Progress to next level is rendered by [XP Bar](:::xp-bar) at the bottom centre of the UI
- `xpRequired(N) = cumulative[N-1]` from the loaded table
- `progress = clamp((xp − prev) / (next − prev), 0, 1)`
- Future bonus XP sources (quests, vendor turn-in) are explicitly excluded — see [Roadmap](:roadmap) Phase 12 [Villages](:villages) which only allows trade

### XP Bar

- Centred at the bottom of the UI view, `8 px` above the screen edge
- Fixed size: `600 × 18 px` (`XP_BAR_WIDTH`, `XP_BAR_HEIGHT`, `XP_BAR_MARGIN_BOTTOM` in `xp.yaml`)
- Background `rgba(20, 20, 40, 200)` · fill `rgba(80, 160, 255, 230)` · text `rgba(255, 255, 255, 255)`
- Text overlay shows `Lvl <N> <current> / <max> XP`

## Equipment

> The [Hero](:hero) does not carry equipment in the classical sense; equipped [Weapons](:weapons) live in the [Weaponslot](:weaponslot) sidebar, and equipped [Dices](:dices) live in [Diceslot](:diceslot) cells inside each weapon slot.

- Weapon slot count: see [Weaponslot](:weaponslot)
- Each equipped [Weapon](:weapons) auto-fires when [Charged](::charged) (or when all its slotted [Dices](:dices) have completed their roll if it has any)
- Right-clicking an [Inventory](:inventory) item auto-equips it to the first compatible empty slot
- Right-clicking a sidebar item auto-unequips it back to the [Inventory](:inventory)

## Hero Death

- Triggered when the [Hero](:hero)'s [Damageable](::damageable) reaches 0
- Pauses the world: [Enemy](:enemy) AI, [Weapon](:weapons) cooldowns, and pickup logic all stop
- Plays a slow desaturation fade
- Death restart screen, leaderboard ping, run summary panel

## Starter Loadout

- A starting **Pitchfork** [Weapon](:weapons) **spawned on the floor next to the [Hero](:hero) but outside the [Pickup Radius](::pickup)**
- **Spawn timing: the starter Pitchfork is present on the very first frame the Hero becomes interactable** — no delayed spawn, no spawn-on-first-input fallback
- The Pitchfork carries a **visual blink effect** so the player understands they must walk over to pick it up
- NO auto-equip on game start — the Hero actively chooses to walk to and pick up the first weapon
- Blink VFX: 1.4-second cycle, 50 % duty, outline alpha modulated by `0.7 + 0.3·sin(t·π)`
- Once picked up, the Pitchfork enters the [Inventory](:inventory); equipping it requires another action (right-click or drag to sidebar)
- **Starter damage floor: the starting Pitchfork has at least 10 base damage.** Its damage roll is clamped to the upper half of the normal [Pitchfork](::pitchfork) range so the first weapon never feels under-powered. Regular floor-drop Pitchforks elsewhere in the world keep their full 5–15 range.
- **Starter slot count: the starting Pitchfork has exactly 2 [Diceslot](:diceslot) cells** — the [Slot Counts](::slot-counts) weighted roll is bypassed for the starter instance. Regular floor-drop [Pitchforks](::pitchfork) follow the normal slot-count distribution (`2..6`, modulated by [Quality](:quality-system) / [Hero Level](::hero-level) / [Luck](:luck-system)).

## Hero Aim

> When a [Weapon](:weapons) needs a target, the system computes the [Hero](:hero)'s aim direction.

- If [Enemies](:enemy) are inside the Weapon's [Rangeable](::rangeable) circle, aim = direction to the closest one
- Otherwise **no aim is computed and no [Attack](:attack) fires**; the Weapon stays [Charged](::charged) (hold-charge) until an [Enemy](:enemy) enters range — see [Charged](::charged)
- Aim is recomputed every fire, never per-frame, to avoid jitter

---

# Enemy

> Hostile [Entities](::entity) that spawn around the [Hero](:hero), chase, and melee.

- [Walkable](::walkable)
- [Huntable](::huntable)
- [Aimable](::aimable)
- [Targetable](::targetable)
- [Damageable](::damageable)
- [Deathable](::deathable)
- [Qualityable](::qualityable)
- Default health 30, base damage 10, move speed 330
- Attack range 280 px, chase range 2600 px, attack cooldown 1.1 s
- Population is capped at `MAX_ENEMIES = 5000` simultaneous live [Enemies](:enemy) in the world; once reached, no new spawns occur until existing [Enemies](:enemy) die (see [Spawning](::spawning) for spawn pacing)
- On death, drops a [Loot](:loot) item and grants XP to the [Hero](:hero)

## Composition

- A standard [Enemy](:enemy) is a thin combiner of the above [Abilities](:abilities)
- A [Special Enemy](:special-enemies) extends this set with one or more themed abilities
- All [Enemies](:enemy) carry a [Quality Tier](::tier-thresholds) that affects size, colour, and stat multipliers

## Spawning

> The [EnemyHub](::entity) maintains a steady population of hostile [Entities](::entity) by spawning periodically around the [Hero](:hero).

- Steady-state spawn interval `ENEMY_SPAWN_INTERVAL = 0.5 s`
- **Wave intro** (`configs/waves.yaml`): the run opens with a strict scripted hand-off before steady-state spawning. A single **Scout** spawns `WAVE_SCOUT_DELAY_SECONDS = 1.0 s` after the first [Weapon](:weapons) is equipped and drops exactly one D4 with a fixed 1.2-second roll; no random or recovery drop is added to that death. A **Group** of `WAVE_GROUP_SIZE = 3` spawns from the same direction only once the player slots that D4 (`WavePhase::DiceEquipWait`). Continuous spawning begins only after those exact three tracked enemies reach zero HP; ignoring or powdering the D4 cannot bypass the group
- Population cap `MAX_ENEMIES` — see canonical definition in [Enemy](:enemy) core stats
- Spawn position chosen on a polar disc around the Hero
- Inner radius `ENEMY_SPAWN_MIN_RADIUS = 3000 px` and outer radius `ENEMY_SPAWN_RADIUS = 5000 px` ensure new [Enemies](:enemy) appear off-screen and walk toward the Hero
- Spawn is retried (up to 10 times) to avoid placing inside an exclusion disc (radius `ENEMY_SPAWN_EXCLUSION_RADIUS = 1000 px`) centred on the **spawn position** (NOT death position) of a recently-killed Enemy; created the moment that Enemy dies. Forces fresh spawns from unexplored ground, pushing the player into new directions instead of farming the same patch
- **Spawn pressure wave (rear-bias):** with probability `ENEMY_SPAWN_REAR_BIAS_WEIGHT` (0.65) the spawn angle is drawn from a wedge **behind** the [Hero](:hero)'s current movement direction — `atan2(heroMoveDir) + π ± ENEMY_SPAWN_REAR_ARC_HALF_DEG` (70 °). The remaining 0.35 probability draws from a fully uniform random angle. Net effect: enemies preferentially materialise in the wake of the hero's movement, forming a pressure wave that rewards forward momentum — a hero who stops and camps faces threats from every direction; one who keeps moving faces a concentrated rear threat that can be outrun

## Tier Cadence

> Quality tier for a new spawn is determined by a counter modulo schedule.

- Counter is incremented on every spawn
- **Counter % `RARE_CADENCE_AT_QUINTILE` == 0** → spawn is **Rare**
- Else if **Counter % `UNCOMMON_CADENCE_AT_QUINTILE` == 0** → spawn is **Uncommon**
- Else → spawn is **Common**
- **Distance-quintile scaling (REVISED for 40-hour pacing):** the cadence moduli scale with the [Hero](:hero)'s current cumulative walked distance, measured as a quintile of `cum[99]` from [Level by Distance](::level-by-distance):
  - Quintile 0 (cum ≤ 20 %): `RARE_CADENCE = 300`, `UNCOMMON_CADENCE = 30` — expected mix per 300 spawns: 1 Rare + 9 Uncommon + 290 Common
  - Quintile 1 (cum 20–40 %): `RARE_CADENCE = 200`, `UNCOMMON_CADENCE = 20`
  - Quintile 2 (cum 40–60 %): `RARE_CADENCE = 100`, `UNCOMMON_CADENCE = 10` — matches the prior universal cadence
  - Quintile 3 (cum 60–80 %): `RARE_CADENCE = 75`, `UNCOMMON_CADENCE = 8`
  - Quintile 4 (cum 80–100 %): `RARE_CADENCE = 50`, `UNCOMMON_CADENCE = 7`
- The Tier cadence interacts with [Quality System](:quality-system) to set the [Enemy](:enemy)'s `q` and visuals

## Level by Distance

> An [Enemy](:enemy) spawned far from the [Hero](:hero)'s start position is higher level.

- A per-level distance step is read from the config table (one step per level from 2 to 100)
- The cumulative sum of steps `cumᵥ` is computed
- `level = max v such that dist(spawn, heroStart) ≥ cumᵥ`
- An [Enemy](:enemy)'s base stats are scaled by `factor^(level-1)` for health, damage, and speed (separate factors per stat)
- **Per-stat factors (REVISED for 40-hour pacing):** health factor `1.12`, damage factor `1.10`, speed factor `1.02`
- **Speed-factor rationale:** `1.02` keeps L99 enemy speed under 7× the [Hero](:hero) (~3 600 u/s) while preserving "they catch you eventually" pressure; a steeper factor outpaces the Hero's `500 u/s` by L10 and makes the world unkitable by L20
- **Distance-step curve (REVISED for 40-hour walk-distance target):** the `cumᵥ` distance-to-level table in `configs/enemy_levels.yaml` previously reached enemy-L99 at ~3.9 M px (~2 h 16 m of walking at default speed, only ~5 % of the intended 40 h). The revised curve is piecewise:
  - L2–L10 linear at step = 30 000 px (cum[10] ≈ 270 000 px ≈ first ~6 h walked-time)
  - L11–L40 exponential: `step(N) = 30 000 · 1.08^(N-10)` (cum[40] ≈ 3.7 M px ≈ ~14 h)
  - L41–L99 exponential: `step(N) = step(40) · 1.01^(N-40)` (cum[99] ≈ 28–30 M px ≈ 38–40 h). The `1.01` factor (shipped as `ENEMY_LEVEL_EXP2_FACTOR` in `enemy_levels.yaml`) is what actually reaches the 38–40 h cumulative target; a steeper `1.05` would overshoot to ~110 M px (~150 h), so the hour/px target above is the binding constraint.
- Revision lives in `configs/enemy_levels.yaml` and is documented here as the spec contract (the L11–40 band factor is exposed as `ENEMY_LEVEL_EXP1_FACTOR = 1.08`)

## Enemy Healthbar

- Position: centred horizontally on the [Enemy](:enemy) sprite's local origin
- Vertical offset: 30 px above the sprite top edge, scaled by the per-tier **visual scale** in [Tier Multiplier Reference](::tier-multiplier-reference) so larger Rare bodies do not overlap their own bar
- Bar dimensions: 140 px wide × 10 px tall — deliberately smaller than the [Hero Healthbar](:::hero-healthbar) so the on-screen Enemy population (up to `MAX_ENEMIES`; see Enemy) does not flood the view with UI
- Healthbar colour ramp identical to [Hero Healthbar](:::hero-healthbar) (background, fill, thresholds); do not restate values here
- **Level number label**: rendered to the left of the bar as `Lv <N>` where `N` is the [Enemy Level](::enemy-level) (1 – 100), white text with a 1 px dark outline
- **Health number label**: centred on the bar reading `<currentHP> / <maxHP>` (integer values, rounded; white text with a 1 px dark outline)
- Both labels use a small bitmap font sized to stay legible across the full [Zoom](::zoom) range (clamp values canonical there)
- The bar fades out together with the [Enemy Death](::enemy-death) explosion (`u_duration = ENEMY_DEATH_ANIM_DURATION`; canonical there) — it is removed the same frame the body is removed from the spatial grid
- Always visible while the Enemy is alive; does **not** auto-hide on full health so the player can scan threat levels without having to land a hit first
- Drawn after the Enemy sprite and before [Damage Text](::damage-text) so incoming damage numbers stack readably on top

## Enemy Body Shader

> Every [Enemy](:enemy) body is rendered by a single per-entity GLSL fragment shader (`enemy.frag`) that composites a neon SDF silhouette over an animated fog cloud. The shader covers all enemy types via a type-select uniform.

### SDF Silhouettes

- Uniform `u_enemy` (integer 0–6) selects one of seven convex SDF silhouettes: `Base` / `Shocker` / `Glasswraith` / `Hexarchon` / `Sentinel` / `Voidcrawler` / `PactWalker`
- The silhouette is a layered SDF artistry build: core body, inner structural lines, optional eye or ring accents, neon outline stroke
- `u_color` (vec3) sets the hue of the neon outline; each enemy type and quality tier has a distinct colour assigned by [Colour Palette](::colour-palette)
- `u_charged` (0–1) shifts the outline hue toward cyan `(0.31, 0.90, 1.0)` and brightens the glow during the melee wind-up telegraph so the player can read an incoming attack before it lands
- `u_speed` modulates time-driven animation rate (idle drift, charge pulse) per-enemy as configured

### Animated Fog Cloud

- Each enemy body is wrapped in a drifting, dim-coloured fog cloud rendered in the enemy's local space so the cloud moves with the body
- Generated via 3-octave fractional Brownian motion (fbm): two animated noise fields — `fp = p · 1.8 + u_time · 0.10` and `fp2 = p · 0.9 − u_time · 0.07 + (3.1, 7.4)` — multiplied together for a churning, non-repeating look
- Radial envelope `env = 1 − length(p) · 1.05` (squared) makes the fog densest at the body centre and zero at the silhouette edge, so it never halos past the outline
- `fog = clamp(fbm(fp) · fbm(fp2) · env² · 3.0, 0, 1)` ; fog colour is the enemy hue dimmed to `hue · (0.12 + fog · 0.28)` with alpha `fog · 0.72`
- The neon SDF stroke layer is composited on top via `finalAlpha = max(fogAlpha, sdfAlpha)`, so the outline always wins and the fog fills the interior
- Driven entirely by `u_time`; `u_charged` does **not** affect the fog — the charge telegraph is SDF-only, keeping the fog readable as ambient mood rather than combat signal

## AI

> An [Enemy](:enemy) chases the [Hero](:hero) when in [Chasable Range](::huntable) and melees when in [Attackable Range](::aimable).

- **Chase phase:** if `dist² ≤ chaseRange²`, the Enemy moves toward the [Hero](:hero)
- **Deadzone:** within `0.45 · attackRange` the Enemy stops moving but still attacks (avoids visual jitter when overlapping)
- **Melee phase:** if `dist² ≤ attackRange²`, the Enemy's attack timer accumulates; on reaching cooldown, it deals damage and resets the timer
- Outside chase range, the Enemy idles (but in a real-world play frame this almost never happens because of the spawn radius)

### Unpredictable Behaviours

> Six RNG-gated behaviours layer on top of basic chase/melee to make each [Enemy](:enemy) feel distinct and prevent the player from exploiting a predictable approach pattern. All are independently config-driven and combine freely.

#### Offensive Dash (Lunge)

- Triggers during chase when hero distance is in the band `ENEMY_DASH_RANGE_MIN` (200 px) – `ENEMY_DASH_RANGE_MAX` (600 px) and the offensive cooldown has expired (`ENEMY_DASH_COOLDOWN` = 5.0 s)
- Rolls `ENEMY_DASH_OFFENSIVE_CHANCE` (0.30); on success the Enemy dashes **straight toward** the hero at `ENEMY_DASH_OFFENSIVE_SPEED` (800 px/s) for `ENEMY_DASH_OFFENSIVE_DURATION` (0.30 s)
- Produces an orange ghost trail: alpha `ENEMY_DASH_GHOST_INITIAL_ALPHA` (180), decay duration `ENEMY_DASH_GHOST_DURATION` (0.4 s), colour RGB `255 / 140 / 0`
- See [Contact Damage](::contact-damage) for the shared in-dash hit rule

#### Defensive Dash (Evade Sidestep)

- Fires **only after the Enemy has been hit** (guarded by `hasBeenHit` flag, set by `notifyEnemyHit`)
- Rolls `ENEMY_DASH_DEFENSIVE_CHANCE` (0.30); on success the Enemy dashes **perpendicular** to the hero→enemy axis, left or right chosen randomly (50 / 50), at `ENEMY_DASH_DEFENSIVE_SPEED` (600 px/s) for `ENEMY_DASH_DEFENSIVE_DURATION` (0.25 s)
- A failed roll still consumes the full cooldown (`ENEMY_DASH_COOLDOWN` = 5.0 s), so the Enemy cannot spam-roll on every incoming hit
- See [Contact Damage](::contact-damage) for the shared in-dash hit rule

#### Jump Leap (Telegraphed)

- Triggers during chase when hero distance is in `ENEMY_JUMP_RANGE_MIN` (620 px) – `ENEMY_JUMP_RANGE_MAX` (1400 px) and jump cooldown has expired (`ENEMY_JUMP_COOLDOWN` = 4.0 s)
- Rolls `ENEMY_JUMP_CHANCE` (0.28); on success the Enemy **freezes** and records the hero's current position as `jumpTargetPos`, then counts down `ENEMY_JUMP_TELEGRAPH_DURATION` (0.35 s) — a visible wind-up cue the player can read and dodge
- After the telegraph the Enemy launches toward `jumpTargetPos` at `ENEMY_JUMP_SPEED` (1400 px/s), flagged as `isActiveJump`, until it reaches the target — flight time is computed as `distance ÷ ENEMY_JUMP_SPEED` (there is **no** `ENEMY_JUMP_DURATION` config key); the target is **fixed at launch** so the leap is dodgeable by moving
- Ghost trail: alpha `ENEMY_JUMP_GHOST_ALPHA` (210), duration `ENEMY_JUMP_GHOST_DURATION` (0.5 s)
- See [Contact Damage](::contact-damage) for the shared in-dash hit rule

#### Juke (Approach Weave)

- Triggers periodically during chase when `jukeCooldown` expires (`ENEMY_JUKE_COOLDOWN` = 2.2 s); rolls `ENEMY_JUKE_CHANCE` (0.04)
- On success, deflects the approach vector by `ENEMY_JUKE_ANGLE_DEG` (55 °) to a randomly-signed perpendicular for `ENEMY_JUKE_DURATION` (0.38 s)
- Makes the approach weave left/right rather than beelining, defeating naive "stand still and shoot" strategies

#### Strafe (Lateral Orbit)

- Active when the Enemy is within attack range but not in the melee deadzone, specifically in `ENEMY_STRAFE_MIN_DIST` (80 px) – `ENEMY_STRAFE_MAX_DIST` (220 px)
- The Enemy moves laterally (perpendicular to the hero→enemy axis) instead of standing still; direction flips every `ENEMY_STRAFE_SWITCH_INTERVAL` (0.9 s), active for up to `ENEMY_STRAFE_DURATION` (1.8 s) total
- Speed is `ENEMY_STRAFE_SPEED_FRAC` (0.45) of the Enemy's base move speed
- Orbiting behaviour makes the Enemy harder to kite while waiting out attack cooldowns

#### Berserk (Sub-25 % HP Rage)

- Active whenever `0 < healthRatio < ENEMY_BERSERK_HP_FRAC` (0.25) — re-latched every tick
- Chase speed multiplied by `ENEMY_BERSERK_SPEED_MULT` (1.55); effective attack cooldown compressed by `ENEMY_BERSERK_ATTACK_COOLDOWN_MULT` (0.55, applied as scaled Δt)
- Low-health enemies become noticeably faster and more aggressive — do not leave wounded enemies alive

### Contact Damage

> Any dash or jump deals one point of contact damage if the Enemy body enters the hero's personal space during the movement.

- Threshold radius: `ENEMY_DASH_CONTACT_RADIUS` (110 px) from the hero's centre
- Damage: `ENEMY_DASH_CONTACT_DAMAGE_FRAC` (0.05) × hero **max HP** (i.e. 5 % max health per hit, regardless of current HP)
- Fires **at most once per dash / leap** (guarded by `contactDamageDealt` flag per movement instance); a single dash cannot multi-hit
- Contact damage can kill the hero; it spawns a damage number tinted by the Enemy's quality tier
- Applies during [Offensive Dash](::offensive-dash-lunge), [Defensive Dash](::defensive-dash-evade-sidestep), and [Jump Leap](::jump-leap-telegraphed)

### Enemy Call / Alert System

- When an Enemy first enters the [Hero](:hero)'s chase range (transition idle → chasing), it **broadcasts an alert** to every idle Enemy within `ENEMY_CALL_RANGE` (3000 px — must exceed `ENEMY_CHASE_RANGE` so the alert reaches enemies beyond the chase bubble)
- The broadcast fires **once per chase entry** — not every frame — so it cannot spam-refresh alerted targets
- Alerted Enemies leave idle and move toward the broadcaster's world position at the moment of the first broadcast; the target is **fixed** so the follower always has a stable convergence point even as the broadcaster moves
- Once an alerted Enemy arrives within `2 × ENEMY_COLLISION_RADIUS` of the alert target it stops and waits; its alert entry is retained so re-alerting cannot immediately restart the movement
- Enemies already within the [Hero](:hero)'s own chase range are **not eligible** for alerting — normal chase takes priority and overrides any existing alert
- **Purpose**: groups idle pack members into a coordinated wave without flocking math — the first scout to enter chase range pulls its nearby allies into the fight

## Collisions

> [Enemy](:enemy)-Enemy and [Hero](:hero)-Enemy overlaps are resolved each frame via a spatial grid.

- Spatial grid cell size matches `2 · ENEMY_COLLISION_RADIUS` (default 100 px) for cheap neighbour lookups
- Pairwise overlap `overlap = 2R − d`; each Enemy is pushed `overlap/2` along `(Δ/d)`
- For Hero-Enemy, the Hero is rigid and the Enemy absorbs the full `overlap`
- Collision is purely positional — does not alter velocity or AI state

## Enemy Death

- Memorises the dead [Enemy](:enemy)'s **original spawn position** (the world coordinate where it first appeared — NOT the coordinate where it died) into the [Spawn Exclusion FIFO](:::spawn-exclusion-fifo); future spawn attempts inside that disc are rejected so the [Hero](:hero) is pushed toward unexplored ground
- Grants `floor(enemy.level² × qualityMult × deltaMult)` XP to the [Hero](:hero) via [Levelable](::levelable) (see [Leveling & XP](::leveling-xp) for full formula)
- Rolls one or more [Loot](:loot) drops at the death position
- Spawns a 6-vertex explosion quad rendered through the explosion shader with `u_time = elapsed`, `u_duration = ENEMY_DEATH_ANIM_DURATION = 0.55 s`
- The explosion blends three rings (inner blob, ring 1, ring 2) with [Quality](:quality-system)-tinted hues
- The body itself is removed from the spatial grid the same frame

### Spawn Exclusion FIFO

- Memorises up to 5000 recent **spawn positions** of [Enemies](:enemy) that have since died — entry **written at the moment of death**, value stored is the original spawn coordinate (never the death coordinate). The 5000 cap matches `MAX_ENEMIES` so the buffer can hold one entry per live Enemy without overflow
- Future spawn attempts that fall within `ENEMY_SPAWN_EXCLUSION_RADIUS` of any cached position are rejected and re-rolled (up to 10 retries — radius canonical at [Spawning](::spawning))
- **Player-direction rationale**: locking the disc to the **original spawn point** stops re-spawning on swept-clean ground while unexplored directions stay spawn-eligible — fresh threats arrive only from new ground, pushing the [Hero](:hero) to advance instead of grinding in place
- The FIFO is cleared on world load so the first Enemy of a run is never gated by a stale entry

---

# Special Enemies

> Themed variants that extend the base [Enemy](:enemy) with unique mechanics, drops, and visual identity. Each appears under specific spawn conditions and contributes to the dark-cyberpunk-neon mood.

- Special enemies share the base [Abilities](:abilities) of an [Enemy](:enemy)
- Each adds one or more unique [Abilities](:abilities) or modifiers
- Spawn cadence is layered onto the base [Tier Cadence](::tier-cadence): special enemies replace some `Rare` slots and some `Uncommon` slots

## Shocker

> Cyberpunk neon-skinned grunt that releases an AOE shock on death.

- Visual: white-cyan body with crackling magenta filigree
- Base stats identical to a Common [Enemy](:enemy) but with +15 % health
- On death, fires a 200 px AOE shock that deals 50 % of the [Hero](:hero)'s health-fraction damage to any [Enemy](:enemy) in range (friendly AOE — Shockers can clear adjacent enemies)
- Drops a [Dice](:dices) with elevated luck stat
- Spawn condition: replaces every 7th Uncommon spawn after [Hero](:hero) level ≥ 3 — gate prevents Shockers in the first 3 minutes before the player learns the friendly-AOE death pulse

## Glasswraith

> High-evasion phantom that drops quality-pickup shards and shatters into mirror-copies on death.

- Visual: translucent body with neon-cyan rim, drifts rather than walks
- Health is lower than Common (75 %) but evasion is 35 %
- Evasion bypasses single-target [Weapons](:weapons) but is fully countered by [AOE Attack](:::aoe-attack) [Weapons](:weapons)
- On death, fractures into **3 mirror-copies** at 50 % parent health, 50 % parent damage, 50 % parent size; mirror-copies do not themselves split on death
- Mirror-copies inherit the parent's 35 % evasion and the same [AOE Attack](:::aoe-attack) counter rule
- On death, drops a **[Quality Shard](::quality-shard)** — consumable that raises the [Hero](:hero)'s next [Loot](:loot) `qFloor` by 10 (dropped by the original parent only, not by mirror-copies)
- Spawn condition: 1-in-1000 chance per spawn after [Hero](:hero) level 5

## Hexarchon

> Six-faced spawn-host that triggers Dron-style multipliers on the host's drop table.

- Visual: floating hexagonal sigil with neon-violet outline; rotates as it pursues
- Base health is 4× Common; AI deadzone is widened to 0.6 · attackRange so it keeps distance
- When the Hexarchon dies, it rolls a virtual six-sided dice; the rolled face determines a Dron tier (1=Voidron, …, 6=Hexadron) and applies the matching multiplier to the dropped loot's stats
- `lootStats ← lootStats · dronMult` at drop time
- Drops a guaranteed [Dice](:dices) with face count `min(roll·10, 100)`
- Spawn condition: replaces every 50th Rare spawn after [Hero](:hero) level ≥ 15 — gate blocks early-game one-shots from Dron-multiplied drops before [Weaponslot](:weaponslot) loadout exists

## Tassidean Sentinel

> Ancient-civilisation guardian that appears near [Tassides Civilisation Remnants](::tassides-civilisation-remnants).

- Visual: armoured silhouette with luminescent script across the body
- Health pool is split into 3 staggered phases — between phases it briefly stops to "recompile" (1.0 s of invulnerability)
- Each phase end emits an outgoing wave that pushes [Enemies](:enemy) back by 100 px
- Drops a [Weapon](:weapons) with guaranteed Rare quality
- Spawn condition: appears only near ruins

## Voidcrawler

> Elite spawner that haunts [Spawn Exclusion FIFO](:::spawn-exclusion-fifo) zones and biases every drop toward the Rare [Quality](:quality-system) tier.

- Visual: matte-black silhouette with a single bright cyan eye
- Walks at 75 % of normal Enemy speed
- Every 5 s it spawns a Common minion at its position
- Drops a [Dice](:dices) with elevated `damageMultiplier`
- **Quality bias**: every drop from a Voidcrawler skips the normal quality roll and uses `qFloor = 80` ([Rare](:quality-system) tier minimum); the rolled quality is `clamp(80 + U[0, 20], 80, 100)`
- Spawn condition: replaces every 200th Rare spawn AND inside a recent exclusion zone AND [Hero](:hero) level ≥ 25 — gate prevents guaranteed Rare-floor drops from trivialising the early-game gear curve

## Tridron

> Evolved three-faced Dron-host variant — a mid-tier escalation between the common enemy and the full [Hexarchon](::hexarchon).

- Visual: triangular sigil with neon-violet / amber outline; slightly smaller than the Hexarchon, faster approach
- Health: 2.5× Common (versus Hexarchon's 4×) — a credible threat that players can still dispatch quickly
- On death, rolls a virtual 3-sided die (faces 1–3); the rolled face maps to Dron tier (1 = Duodron, 2 = Tridron-native, 3 = Hexadron partial) and applies that multiplier (×2.5 base) to the dropped loot's stats
- Drops a guaranteed [Dice](:dices) with face count `min(roll · 6, 60)` — less extreme than the Hexarchon's cap of 100 but still above baseline
- Spawn condition: replaces every 25th Rare spawn after [Hero](:hero) level ≥ 8 — sits between the common cadence and the Hexarchon's every-50th rule, giving players a softer Dron-drop on-ramp before Hexarchons appear

## Pact-Walker

> Neutral [Entity](::entity) that turns hostile only when provoked.

- Visual: cloaked figure with subtle gold filigree
- Initial state: idle, wanders gently like an [NPC](:npcs)
- Becomes hostile if the [Hero](:hero) attacks while within 250 px
- When killed, drops a [Powder](:powder-system) stack of black (Weapon-type) powder regardless of equipment
- Friendly Pact-Walkers may give the [Hero](:hero) a small one-time XP bounty in exchange for currency

## Drop Bias

- Shocker → [Dice](:dices) with high luck
- Glasswraith → consumable [Quality Shard](::quality-shard)
- Tridron → guaranteed [Dice](:dices) with ×2.5 Dron-multiplied stats
- Hexarchon → guaranteed Dice with high face count and Dron-multiplied stats
- Tassidean Sentinel → guaranteed Rare [Weapon](:weapons)
- Voidcrawler → Dice with high `damageMultiplier`; every drop is Rare-floor (`qFloor = 80`)
- Pact-Walker → black [Powder](:powder-system)

---

# NPCs

> Non-hostile humans inhabiting [Villages](:villages). The [Hero](:hero) interacts via the [Interactable](::interactable) ability.

- [Walkable](::walkable)
- [Targetable](::targetable) — but never [Aimable](::aimable) by [Hero](:hero) [Weapons](:weapons) (they are immune to incidental fire)
- [Interactable](::interactable)
- Some are [Vendors](::vendor)

## Behavior

> Wanders within a village's bounded area; pauses to gesture; reacts to [Hero](:hero) proximity.

- Idle wander uses simple pathfinding within village boundaries
- Reacts to the Hero within a 200 px proximity disc (faces the Hero, animates a slight head turn)
- Names are pulled from a pool of cyberpunk-medieval first names

## Wandering & Boundaries

- An NPC never crosses the village outline
- Buildings within the village are [Solid](::solid) — pathfinding routes around them
- Wander destinations are sampled randomly inside the polygon, weighted away from buildings

## Interaction Loop

- Trigger condition: [Hero](:hero) within 120 px of the NPC for at least 0.3 s
- Pressing F opens a modal panel anchored over the NPC
- The panel shows the NPC's name, role, and a contextual menu (Talk / Trade / Leave)
- Closing the panel returns control to the world

## Reputation

> A per-NPC and per-village faction tag, influencing pricing and dialogue. Single source of truth for both the four-value enum and the per-rep price modifier.

- Reputation values: Hostile, Neutral (default), Friendly, Trusted
- Earning rep: completing minor on-NPC requests, donating Powder, returning lost dice
- **Price modifier per rep** (applied to base vendor price):
  - Hostile — `+50 %` (or refuses trade entirely; ambient mood drops)
  - Neutral — `±0 %`
  - Friendly — `−10 %`
  - Trusted — `−20 %` (also unlocks unique inventory rolls)
- The price modifier composes with the tier price multiplier — see [Pricing](::pricing) for the full formula

## Vendors

### Blacksmith

- Visual: muscular silhouette with a glowing forge behind
- Buys [Weapons](:weapons) at a fraction of their derived stat value
- Sells one rotating stock of [Weapons](:weapons) per in-game day
- Stock quality scales with the [Hero](:hero)'s current level
- Refuses to buy [Dices](:dices)

### Pharmacist

- Visual: hooded figure surrounded by glass bottles
- Buys and sells **[Health Potions](:::health-potion)** and restorative consumables
- The [Hero](:hero) does not currently have a usable consumable inventory; potions are a placeholder until that system is built

### Collector

- Visual: spectacled figure with a counter full of dice
- Buys [Dices](:dices) at price weighted by face count and quality
- Sells rotating dice stock — often the rare face counts (d42, d60, d100) that almost never drop
- Refuses to buy [Weapons](:weapons)

### Health Potion

- Consumable that restores a fraction of [Hero](:hero) max health
- Tier scales: small (10 %), medium (25 %), large (50 %)
- Bought from [Pharmacist](:::pharmacist); usable from [Inventory](:inventory)

### Vendor Inventory Refresh

- Each vendor's stock refreshes on a configurable schedule
- The default is one refresh per real-life 5 minutes of play time
- Refreshing closes any open trade modal to avoid stale display

---

# Weapons

> Plural of [Weapon](:weapons).

## Weapon

- [Entity](::entity)
- [Aimable](::aimable)
- [Pickupable](::pickupable)
- [Slotable](::slotable)
- [Collectingable](::collectingable)
- [Dropable](::dropable)
- [Storable](::storable)
- [Countdownable](::countdownable)

## Charged

> A [Weapon](:weapons) is charged when its [Countdownable](::countdownable) timer hits 0. This makes the Weapon available for an [Aimable](::aimable) action and highlights the Weapon in the [Weaponslot](:weaponslot).

- A Weapon with no slotted [Dices](:dices) charges on its own cooldown (`1 / aps`)
- A Weapon with one or more slotted [Dices](:dices) charges only when **every** slotted [Dice](:dices) has completed its roll
- The slowest equipped Dice paces the firing rhythm: `effectiveAps = 1 / max(rollDuration)` — see [Effective APS](:::effective-aps)
- The weapon's own `aps` stat is ignored while any Dice is slotted; it resumes only when all dice are removed
- **Charged ≠ fired.** Reaching the [Charged](::charged) state only makes the Weapon *eligible* to fire. The actual [Attack](:attack) requires a [Targetable](::targetable) [Enemy](:enemy) inside the Weapon's [Rangeable](::rangeable) circle (see [Attack mechanic](::attack-mechanic))
- **Hold-charge while idle.** If no Enemy is in range when the Weapon becomes Charged, the Weapon does **not** fire and does **not** discharge. It remains Charged — cooldown frozen, Charged visuals still active — and the queued Attack executes on the first frame an Enemy enters range
- **Dice-slotted weapons hold the same way.** Every slotted Dice's frozen face value is preserved across the wait; the buffered roll is consumed by the eventual Attack, and only then does each Dice start its next roll
- **Cooldown / dice re-roll restart only on actual fire**, never on the moment the Weapon first becomes Charged; a held Charged Weapon cannot stack a second charge
- Charged state is shown by:
  - Slot outline pulse
  - Progress bar full
  - Brief outline brightness boost on the Weapon sprite
  - The pulse and brightness boost continue for the entire hold-charge wait, signalling to the player that the Weapon is armed and waiting on a target

## Weapon Stats & Dice Improvement

> The weapon "archetype" system (Basic / Heavy / Reach / Exotic groupings and their per-archetype Diceslot-fill bonus curves) was REMOVED in the restart-#4 rebuild (2026-06-10). A [Weapon](:weapons) is distinguished only by its TYPE (Pitchfork, Long Sword, …) and that type's base stats. This section replaces it. **Provisional — this weapon↔dice model may be reworked.**

- A [Weapon](:weapons) carries **base** stats: base `damage`, base `critMultiplier`, base `critChance`.
- Equipped [Dice](:dices) **improve** those three base stats — the dice are the upgrade mechanism. `damage` / `critMultiplier` / `critChance` start at the weapon type's base and are raised by the equipped dice's contributions.
- **Attacks-per-second is NOT improved by dice.** A weapon's fire cadence is replaced directly by the **slowest equipped dice's roll time** — the dice roll cadence IS the fire cadence. (An empty weapon falls back to its own base cadence.)
- There is no per-archetype slot-fill bonus, no `archetype.yaml`, and no Basic/Heavy/Reach/Exotic classification anywhere.
- Residual archetype cross-references elsewhere in this spec (weapon-naming flavour pools, filigree overlays, the final-damage-pipeline archetype step) are reconciled per-phase as the weapon + dice cards are built (new kanban phases P6/P7), not in this reset edit.

## Pitchfork

> First weapon in the game. Spawned on the floor next to the [Hero](:hero), outside [Pickup Radius](::pickup), with [Starter Loadout](::starter-loadout) blink VFX so the player learns to pick up.

- [Single Attack](:::single-attack)
- [Slow attack speed](:::slow-attack-speed)
- [Medium attack range](:::medium-attack-range)
- Base damage range: 5–15
- **Starter-instance floor: when this Pitchfork is the one spawned by Starter Loadout for the Hero, its damage is clamped to a minimum of 10 (effective range 10–15). All other Pitchfork drops keep the full 5–15 range.**
- **Starter-instance slot count: the Starter Loadout Pitchfork has exactly 2 [Diceslot](:diceslot) cells (weighted [Slot Counts](::slot-counts) roll bypassed). All other Pitchfork drops roll their slot count via the normal `2..6` distribution.**
- Drop rarity: extremely common (highest drop weight)
- Role: introductory weapon; teaches the Hero the pickup → equip → fire loop
- Visual: three-pronged silhouette with red-orange outline

## Long Sword

- [Swipe Attack](:::swipe-attack)
- 90°
- [Medium attack speed](:::medium-attack-speed)
- [Medium attack range](:::medium-attack-range)
- Base damage range: 10–22
- Role: balanced melee swipe; reliable mid-range option
- Visual: elongated blade with cyan outline

## Great Sword

- [Swipe Attack](:::swipe-attack)
- 180°
- [Slow attack speed](:::slow-attack-speed)
- [Medium attack range](:::medium-attack-range)
- Base damage range: 18–40
- Role: high single-hit damage with broad arc
- Visual: massive blade with purple outline

## Halberd

- [AOE Attack](:::aoe-attack) — 360° spin
- Damages every enemy in range with a full circle spin strike
- [Medium attack speed](:::medium-attack-speed)
- [Large attack range](:::large-attack-range)
- Base damage range: 12–28
- Role: crowd control spin; clears surrounding enemies
- Visual: pole-arm with amber outline; spin VFX shows concentric rings + rotating spokes

## Quarterstaff

- [AOE Attack](:::aoe-attack) — 360° spin
- Damages every enemy in range with a fast full circle spin
- [Fast attack speed](:::fast-attack-speed)
- [Large attack range](:::large-attack-range)
- Base damage range: 5–12
- Role: rapid-fire 360° sweeper
- Visual: thin pole with bright blue outline; spin VFX shows concentric rings + rotating spokes

## Knives

- [Multi Target Attack](:::multi-target-attack)
- Max target number: 4
- [Slow attack speed](:::slow-attack-speed)
- [Large attack range](:::large-attack-range)
- Base damage range: 2–6
- Role: ranged spread / crowd thinner
- Visual: triple-blade fan with bright yellow outline

## Dagger

- [Multi Single Attack](:::multi-single-attack)
- Max attack per action: 3
- [Slow attack speed](:::slow-attack-speed)
- [Short attack range](:::short-attack-range)
- Base damage range: 3–8
- Role: burst single-target finisher
- Visual: small blade with crimson outline

## Mace

- [AOE Attack](:::aoe-attack)
- [Fast attack speed](:::fast-attack-speed)
- [Short attack range](:::short-attack-range)
- Base damage range: 15–30
- Role: melee AOE crowd clear
- Visual: spiked head with amber-brown outline

## Warhammer

- [AOE Attack](:::aoe-attack)
- [Fast attack speed](:::fast-attack-speed)
- [Short attack range](:::short-attack-range)
- Base damage range: 20–40
- Role: heavy single-pulse melee AOE
- Visual: massive head with silver outline

## Big Axe

- [AOE Attack](:::aoe-attack)
- [Medium attack speed](:::medium-attack-speed)
- [Large attack range](:::large-attack-range)
- Base damage range: 20–45
- Role: ranged AOE finisher
- Visual: heavy axe with deep red outline

## Weapon Naming

> Each [Weapon](:weapons) is given a randomised name at drop time, built from three pools: prefix + base + suffix.

- **Base pool** — the 10 implemented types: `Pitchfork`, `Long Sword`, `Great Sword`, `Halberd`, `Quarterstaff`, `Knives`, `Dagger`, `Mace`, `Warhammer`, `Big Axe`
- **Flavour pool** — extra synonym names that share a base type's stats but read uniquely: `Scythe`, `Flail`, `Spear`, `Cleaver`, `Glaive`, `Sabre`, `Falchion`, `Trident`, `Cudgel`, `Battleaxe`, `Maul`, `Reaper`, `Sickle`
- **Prefix pool** — tier-flavoured adjectives: `Ancient`, `Gilded`, `Rusted`, `Voidforged`, `Forgotten`, `Glowing`, `Cyber-etched`, `Storm-bound`, `Cursed`, `Hallowed`, `Shattered`, `Pristine`, `Tarnished`, `Whispering`
- **Suffix pool** — Dron / fate / cosmic nouns: `of Fate`, `of Chaos`, `of Alea`, `of Hexadron`, `of Voidron`, `of the Wraith`, `of the Sentinel`, `of the Tassides`, `of Echoes`, `of Sparks`, `of Rune`, `of Silence`
- Names are sourced from `assets/names/*.names` text pools loaded by `NameLoader` at startup
- Prefix + suffix are independent uniform draws; the base is gated by [Drop Weights — Weapon Type](::drop-weights-weapon-type)
- Final form examples: `Ancient Long Sword of Hexadron`, `Cyber-etched Scythe of Alea`, `Whispering Cudgel of the Tassides`

## Slot Counts

> The number of [Diceslot](:diceslot) cells a [Weapon](:weapons) provides. Range is **2..6 inclusive**; no [Weapon](:weapons) ever drops with fewer than 2 slots.

- Drop pool is heavily weighted toward 2 slots; higher counts are progressively rarer
- Base drop weights (pre-modulation):
  - 2 slots — 4000
  - 3 slots — 30
  - 4 slots — 15
  - 5 slots — 2
  - 6 slots — 1
- The effective per-drop distribution is **modulated by [Quality](:quality-system), [Hero Level](::hero-level), and [Luck](:luck-system)** — see [Drop Weights — Slot Count](::drop-weights-slot-count) for the formula. Higher q / lvl / luck biases the pick toward higher slot counts
- [Starter Loadout](::starter-loadout) [Pitchfork](::pitchfork) is hard-clamped to exactly **2 slots** — the weighted roll is bypassed for the starter instance
- Higher slot counts dramatically increase [Dron Multiplier System](:dron-multiplier-system) chances and total `Σface` / `Πmult` damage potential

## Pickup Animation

- On pickup from the floor, the [Weapon](:weapons) plays a short rise + fade-into-inventory animation
- Animation duration: `ITEM_PICKUP_DURATION` (canonical at [Pickup](::pickup))
- The [Weapon](:weapons) becomes interactable in the [Inventory](:inventory) as soon as the animation finishes
- Optional small "lift" arc for visual polish

## Weapon Floor Drop

- A [Weapon](:weapons) dropped from the [Inventory](:inventory) outside the panel lands on the floor at the cursor world position
- A [Weapon](:weapons) released over the [Weaponslot](:weaponslot) sidebar is equipped; over the [Inventory](:inventory) it is sorted into the nearest empty slot
- All [Weapons](:weapons) on the floor render with their [Outline](::outline) and a soft floor decal so they remain visible at distance

## Weapon Overlap-Free Rendering

- Per-slot scaling ensures the [Weapon](:weapons) sprite fits the slot's weapon zone
- Rotation is locked to 90° (sprite horizontal) for visual uniformity
- The [Roadmap](:roadmap) Phase 3 directs a fix where slot edges are respected by all rendered sprites (no bleed)

---

# Dices

> Plural of [Dice](:dices).

## Dice

- [Entity](::entity)
- [Pickupable](::pickupable)
- [Socketable](::socketable)
- [Collectingable](::collectingable)
- [Dropable](::dropable)
- [Storable](::storable)
- [Countdownable](::countdownable)
- Modifies its host [Weapon](:weapons)'s damage when equipped via [Σface × Πmult](::damage-modifier)

## Faces

### d4

- Tetrahedron silhouette
- Most common drop weight
- Powder colour: red (see [Powder System](:powder-system))
- Suggested names: `Tetrahedron`, `Quad`, `Pyrite Die`, `Spark`

### d6

- Hexahedron silhouette
- Common
- Powder colour: yellow
- Suggested names: `Hexahedron`, `Cube`, `Slatestone`, `Fortune`

### d8

- Octahedron silhouette
- Uncommon
- Powder colour: cyan
- Suggested names: `Octahedron`, `Diamond`, `Quartzlight`, `Eight-Eye`

### d12

- Dodecahedron silhouette
- Rare
- Powder colour: green
- Suggested names: `Dodecahedron`, `Twelvefold`, `Verdant`, `Sigil-12`

### d20

- Icosahedron silhouette
- Rare
- Powder colour: blue
- Suggested names: `Icosahedron`, `Score`, `Skyforge`, `Sigil-20`

### d24

- 24-faced trapezohedron silhouette
- Very rare
- Powder colour: magenta
- Suggested names: `Tetraicosahedron`, `Two-Dozen`, `Crimsonglass`

### d30

- 30-faced rhombic silhouette
- Very rare
- Powder colour: purple
- Suggested names: `Triacontahedron`, `Thirtyfold`, `Violetshard`

### d42

- 42-faced silhouette
- Extremely rare
- Powder colour: orange
- Suggested names: `Quadracontadihedron`, `Forty-Two`, `Sunsplint`

### d60

- 60-faced silhouette
- Extremely rare
- Powder colour: pink
- Suggested names: `Hexacontahedron`, `Pinkrune`, `Cloudwheel`

### d100

- 100-faced silhouette
- Rarest
- Powder colour: white
- Suggested names: `Hecatohedron`, `Century`, `Voidmirror`

## Dice Naming

- Each face count pulls from its dedicated name pool (see [Faces](::faces))
- **Prefix pool** — quality-flavoured adjectives: `Cracked`, `Polished`, `Ancient`, `Voidforged`, `Etched`, `Pristine`, `Forgotten`, `Glowing`, `Tarnished`, `Whispering`
- **Suffix pool** — face / cosmic / fortune nouns: `of Fortune`, `of the Storm`, `of Alea`, `of Fate`, `of Chaos`, `of Hexadron`, `of Voidron`, `of the Wraith`, `of Echoes`, `of Sparks`, `of Rune`, `of Silence`
- Names are sourced from `assets/names/*.names` text pools loaded by `NameLoader` at startup
- Prefix + suffix are independent uniform draws; the base (face count) is gated by [Drop Weights — Dice Face](::drop-weights-dice-face)
- Final form examples: `Polished Icosahedron of Fortune`, `Voidforged Hecatohedron of Voidron`, `Whispering Tetrahedron of Chaos`

## Rolling

- Face value cycles every 0.1 s while [Equipped](:::equipped) (gives the visual impression of rolling)
- On Countdownable completion, the face value freezes and contributes to the [Weapon](:weapons)'s fire computation
- After firing, the Dice is restarted (its Countdownable reloops for the next cycle)
- An unequipped Dice does NOT cycle face values; the displayed face is stable

### Countdown Bar

> Each equipped [Dice](:dices) renders its own countdown bar inside its [Diceslot](:diceslot) cell, independent of the [Weapon](:weapons)'s [Progress Bar](::progress-bar).

- Bar depletes left-to-right over the dice's roll duration
- Resets and restarts immediately after the host [Weapon](:weapons) fires
- Colour matches the dice's quality tier (Common = white · Uncommon = blue · Rare = gold)
- Unequipped dice show no bar (timer is inactive)

### Roll Duration

> The total time a [Dice](:dices) takes to complete one roll. This is the [Countdownable](::countdownable) length — independent of the 0.1 s face-cycle that drives the visual.

- Roll duration is a per-instance stat rolled at make-time in the range **`0.9 s` – `2.4 s`**
- Every face count uses the same roll-time distribution: a roll remains one roll whether the Dice is a d4 or d100
- The host [Weapon](:weapons) waits for the slowest equipped [Dice](:dices) before becoming [Charged](::charged), independent of those Dices' face counts
- Roll duration is independent of the [Damage Modifier](::damage-modifier) and [Crit / Crit Chance / Luck Stats](::crit-crit-chance-luck-stats) — it does not bias the math, only the tempo

### Effective APS

> When [Dices](:dices) are slotted, the [Weapon](:weapons)'s base `aps` is overridden by the slowest dice's roll duration.

- `effectiveAps = 1 / max(rollDuration)` across all slotted Dices
- The [Weapon](:weapons) fires at most once per `max(rollDuration)` seconds, regardless of its own `aps` stat
- With no slotted Dices, the weapon fires at its own cooldown: `period = 1 / aps`
- Adding a slower [Dice](:dices) lowers `effectiveAps`; removing the slowest Dice snaps `effectiveAps` to the new maximum
- Recalculated immediately whenever a Dice is equipped or unequipped

### Equipped

- A [Dice](:dices) is "equipped" when it lives in a [Diceslot](:diceslot) inside an [Equipped](:::equipped) [Weapon](:weapons) on the [Weaponslot](:weaponslot) sidebar
- Equipped state drives the face-cycle animation and the contribution to the [Weapon](:weapons)'s fire
- Unequipping (drag out / right-click) freezes the dice immediately

## Damage Modifier

> An equipped [Dice](:dices) carries a `damageMultiplier` stat. The host [Weapon](:weapons)'s damage becomes a product of base, sum-of-faces, and product-of-multipliers.

- `damage = max(1, baseDamage · max(1, Σ face) · max(0.1, Π mult))`
- Each [Dice](:dices) contributes both its current face value and its damageMultiplier
- The clamp `max(1, …)` keeps the formula safe when there are 0 active dice (e.g. they all just finished and were reset simultaneously)
- The clamp `max(0.1, …)` keeps a "bad" set of multipliers from zeroing damage

## Crit / Crit Chance / Luck Stats

- `crit` — added to the [Weapon](:weapons)'s base crit multiplier when this [Dice](:dices) is slotted
- `critChance` — added to the [Weapon](:weapons)'s base crit chance when this [Dice](:dices) is slotted
- `luck` — contributes to the [Hero](:hero)'s [Luck System](:luck-system) total

## Color Per Type

> Each face count has a thematic colour. The colour appears in:

- The [Dice](:dices)'s [Outline](::outline) on the floor
- The [Powder](:powder-system) produced when the Dice is destroyed
- The tooltip header when hovering the Dice

| Face count | Colour |
|---|---|
| d4 | red |
| d6 | yellow |
| d8 | cyan |
| d12 | green |
| d20 | blue |
| d24 | magenta |
| d30 | purple |
| d42 | orange |
| d60 | pink |
| d100 | white |

## Floor Drop / Pickup

- A [Dice](:dices) on the floor renders with its tier outline and face colour
- Pickup is the same proximity flow as [Weapons](:weapons) — radius and rules canonical at [Pickup](::pickup)
- Pickup is refused if the [Inventory](:inventory) is full
- Dropping a [Dice](:dices) outside any UI panel returns it to the floor at the cursor world position

## Drop Weights

> The weighted drop table for face counts when a [Dice](:dices) is rolled by [Loot](:loot). Canonical home is [Drop Weights — Dice Face](::drop-weights-dice-face) inside [Loot](:loot); this anchor exists so the per-face [Faces](::faces) entries above can cross-link to a Dice-local heading.

- See [Drop Weights — Dice Face](::drop-weights-dice-face) for the full table with percentages and design notes

---

# Dron Multiplier System

> A meta-multiplier triggered when the **rolled face values of all equipped [Dices](:dices) in a single [Weaponslot](:weaponslot)** match one of 15 named combinations. The highest-tier match wins and multiplies the [Weapon](:weapons)'s damage at fire time. Tied to the project's identity as a dice-driven roguelike.

## How It Works

- A [Weapon](:weapons) becomes [Charged](::charged) only when every slotted [Dice](:dices) has finished rolling
- At that moment, the face values of every slotted [Dice](:dices) are read
- The Dron detection algorithm walks the 15 named patterns top-down (highest multiplier first) and stops at the first match
- The matched [Dron Tier](::tiers) supplies a `dronMult` value
- The matched `dronMult` feeds the Dron-view formula at [Math Callout](::math-callout); the [Critical Hits](::critical-hits) factor is applied afterwards, producing the canonical `final` of [Final Damage Pipeline](::final-damage-pipeline)
- The matched tier's name is rendered as a floating label over the [Weaponslot](:weaponslot) in fancy text with fade-in / fade-out
- The matched tier's multiplier value is rendered as a second floating label
- The [Voidron](:::voidron) tier (×1) is the universal fallback and is **silent** — no name or multiplier label is shown
- All Dron labels share `SLOT_FLOAT_TEXT_DURATION` (canonical at [Floating Text](::floating-text))
- The label colour matches the [Dron Float Text Colour](:::dron-float-text-colour) palette (gold)

## Tiers

> The 15 Dron tiers in descending order of multiplier. Multiplier values live in `configs/dron.yaml` (`DRON_MULT_<TIER>`); the structural detection thresholds — straight lengths, Omidron span, and the [Hemidron](:::hemidron) split ratio — live in `configs/dron_patterns.yaml`, so tier balance can be retuned without touching source.

### Hexadron

- 6-of-a-kind
- Example roll: `6-6-6-6-6-6`
- Probability: 0.013 %
- Multiplier: ×40 — at 0.013 % probability ×40 keeps Hexadron a celebrated jackpot without one-shotting late-game encounters
- Visual: explosive gold flash + screen-edge shock
- Naming: from "hex" (six) + "dron" (dice combination)

### Pentadron

- 5-of-a-kind
- Example roll: `1-1-1-1-1-4`
- Probability: 0.40 %
- Multiplier: ×30 — preserves the Hexadron → Pentadron ratio at ~1.33
- Visual: gold flash with dim outer ring

### Twin-Tridron

- 3-of-a-kind + 3-of-a-kind
- Example roll: `2-2-2-5-5-5`
- Probability: 0.64 %
- Multiplier: ×25 — preserves the monotonic ladder under Hexadron and Pentadron
- Visual: dual-toned gold flash

### Quad-Duodron

- 4-of-a-kind + 1 pair
- Example roll: `3-3-3-3-6-6`
- Probability: 0.96 %
- Multiplier: ×22 — preserves the monotonic ladder under Twin-Tridron
- Visual: amber sparkle around the [Weapon](:weapons)

### Omidron

- Full straight (1–6)
- Example roll: `1-2-3-4-5-6`
- Probability: 1.54 %
- Multiplier: ×20
- Visual: rainbow trail across the [Weapon](:weapons) sprite

### Hemidron

- All dice **high** or all dice **low**, where the split is **face-count-relative**: a die is high when its value `>` `faceCount · DRON_HEMIDRON_SPLIT_RATIO` (`DRON_HEMIDRON_SPLIT_RATIO = 0.5`, `configs/dron_patterns.yaml`), else low. For a d6 the midpoint is 3 (the classic `>3` / `≤3` split); for a d100 it is 50. This replaced a fixed d6-style `>3` threshold that made a six-d100 build read "all high" ~83 % of rolls (a near-constant ×18 that short-circuited every lower tier and voided the perfect-d100 chase); face-relative drops that to ~1.6 %
- Example roll (d6): `1-2-1-3-2-3` (all ≤ 3)
- Probability: 3.12 % for six d6 (varies by die type — a six-d100 all-high/all-low is ~1.6 %)
- Multiplier: ×18
- Visual: split-tone flash (cool / warm depending on high vs low)

### Triduo-Dron

- Three distinct pairs
- Example roll: `2-2-4-4-5-5`
- Probability: 3.86 %
- Multiplier: ×15
- Visual: triple-burst short flash

### Tetradron

- 4-of-a-kind (spare dice vary)
- Example roll: `4-4-4-4-1-2`
- Probability: 4.82 %
- Multiplier: ×12
- Visual: bold yellow flash

### Lineadron

- Straight of 5
- Example roll: `1-2-3-4-5-x`
- Probability: 7.72 %
- Multiplier: ×10
- Visual: linear yellow trail

### Split-Seqdron

- Two straights of 3
- Example roll: `1-2-3` & `4-5-6` (paired)
- Probability: 10.2 %
- Multiplier: ×8
- Visual: dual short trails

### Mixdron

- Full house (3 + 2)
- Example roll: `5-5-5-2-2-x`
- Probability: 11.57 %
- Multiplier: ×5
- Visual: warm orange flash

### Minidron

- Straight of 4
- Example roll: `2-3-4-5-x-x`
- Probability: 25.93 %
- Multiplier: ×3
- Visual: light yellow accent

### Tridron

- Three of a kind (spare dice vary; no higher matching pattern present)
- Example roll: `7-7-7-2-4-x`
- Multiplier: ×2.5 — explicit reward for landing three matching faces; sits between Minidron (straight, ×3) and Duodron (pair, ×2)
- Visual: warm amber accent
- Naming: from "tri" (three) + "dron" (dice combination)

### Duodron

- Any pair (two or more dice sharing the same face; the lowest explicit matching tier)
- Example roll: `1-1-3-3-x-x`
- Probability: 44.37 %
- Multiplier: ×2
- Visual: thin gold accent

### Voidron

- Any roll (the silent default)
- Example roll: `x-x-x-x-x-x`
- Probability: 100 %
- Multiplier: ×1
- Visual: **none** — the [Voidron](:::voidron) tier never displays a label

## Detection Order

- The system walks the 15 tiers in the order shown (highest multiplier first)
- The first match wins; lower tiers that would also fit are ignored
- Because detection is highest-first, a roll that satisfies **both** [Lineadron](:::lineadron) (×10, a straight of 5) and [Split-Seqdron](:::split-seqdron) (×8, two straights of 3) is classified as the higher **Lineadron** — Lineadron is tested first. (The two tiers were previously inverted in order; the fix ships in phase B.) Likewise six perfect d100 read as `sortedCounts = {6}` → [Hexadron](:::hexadron) ×40, which is checked before [Hemidron](:::hemidron), so an all-100 roll is the jackpot, not a Hemidron
- This guarantees deterministic, designer-friendly priority

## Display

- A floating label appears centred above the firing [Weaponslot](:weaponslot)
- Text style: bold, gold colour, large size, with neon glow
- Animation: 0.2 s fade-in, 1.0 s hold, 0.3 s fade-out (total = `SLOT_FLOAT_TEXT_DURATION`; canonical at [Floating Text](::floating-text))
- A second smaller label below shows the multiplier value (`×40`, `×30`, …) — bare `×N` glyph format is RESERVED for the tier multiplier; the dedup event counter uses a distinct parenthesised form (see [Float Label Dedup](::float-label-dedup)) so the two never collide visually
- [Voidron](:::voidron) silently bypasses the label so the visual is reserved for noteworthy events
- The float text never blocks the underlying [Damage Text Colours](:::damage-text-colours) numbers; both can stack

## Float Label Dedup

> Visual throttling on Dron float labels so high-frequency low-tier events do not bury the rare-tier signal. With 8 [Weaponslot](:weaponslot) rows firing at up to [Medium attack speed](:::medium-attack-speed) (~1.6 APS each), raw Dron event rate can exceed 12 events / sec — well past `SLOT_FLOAT_TEXT_DURATION` (canonical at [Floating Text](::floating-text)). Without dedup, the screen floods with [Duodron](:::duodron) (44 %) and [Minidron](:::minidron) (26 %) labels and the rare tiers become invisible.

- Per Weaponslot, at most ONE active low-tier dedup label at a time
- If the next Dron event in that slot matches the currently displayed tier, the existing label's counter increments (rendered with a PARENTHESISED count suffix as `Duodron (×3)`, `Minidron (×2)`, etc. — the parentheses are mandatory because the bare `×N` glyph is reserved by [Display](::display) for the tier multiplier label) and its lifetime resets to the full `SLOT_FLOAT_TEXT_DURATION` (canonical at [Floating Text](::floating-text))
- If the next event is a DIFFERENT tier:
  - If the new tier is HIGHER than the displayed one, the existing low-tier label is replaced immediately by a fresh label for the new tier (carry no counter from the previous label)
  - If the new tier is LOWER or EQUAL to the displayed one, the new event is silently dropped on the visual layer; the displayed label keeps its existing counter and timer
- Always-show tiers — **shipped behaviour now renders every non-Voidron tier's label**: `DRON_FLOAT_ALWAYS_SHOW_TIERS` in `configs/dron.yaml` lists Hexadron … Duodron, so only [Voidron](:::voidron) stays silent (the per-row dedup above still applies — one active label per [Weaponslot](:weaponslot) row, higher tier replaces, equal tier bumps the counter). The tiers below were the original high-tier guarantees and remain never-collapsed:
  - [Hexadron](:::hexadron)
  - [Pentadron](:::pentadron)
  - [Twin-Tridron](:::twin-tridron)
  - [Quad-Duodron](:::quad-duodron)
  - [Omidron](:::omidron)
- An always-show tier label CAN stack visually on top of a dedup label in the same Weaponslot — the layout reserves a second slot above the dedup row for these rare events
- The dedup applies ONLY to the visual layer; the `dronMult` damage path runs for every fire unchanged — see [Math Callout](::math-callout)
- [Voidron](:::voidron) remains silent under this system — no counter, no label, ever, exactly as in [How It Works](::how-it-works)
- Designer note: the always-show vs dedup split is `// tunable` — moving [Mixdron](:::mixdron) or [Tetradron](:::tetradron) to the always-show list is a one-line config flip if playtests show those tiers also feel notable

## Math Callout

- `damage = max(1, base · max(1, Σ face) · max(0.1, Π mult) · dronMult)` (Dron-system view, pre-crit; crit factor is applied subsequently — see [Final Damage Pipeline](::final-damage-pipeline) for the canonical `final` formula)
- `base` — the [Weapon](:weapons)'s `baseDamage` (already scaled by [Quality](:quality-system) × [Item Level](::item-level))
- `Σ face` — sum of all slotted [Dices](:dices)' current face values
- `Π mult` — product of all slotted [Dices](:dices)' `damageMultiplier` stats
- `dronMult` — the matched tier's multiplier (1 if no tier above [Voidron](:::voidron))

## Relationship to Luck

- The [Luck System](:luck-system) raises the **minimum** face value that any [Dice](:dices) can roll, increasing the chance of pairs, full houses, and straights
- Higher Luck biases the distribution toward higher tiers
- Luck does **not** directly add to `dronMult` — it shapes the distribution of inputs

## Relationship to Quality and Level

- A higher-Quality [Dice](:dices) rolls a fewer-second duration, so the [Dron](:dron-multiplier-system) detection runs more often per unit time
- A higher-[Item Level](::item-level) [Dice](:dices) has higher `damageMultiplier`, increasing `Π mult` for a given combination
- Together, Quality × Level × Dron is the core damage compounding loop

## Combinations With Slot Count

- The number of slotted [Dices](:dices) gates which tiers are reachable. Slot range is **2..6** ([Slot Counts](::slot-counts) — the 1-slot tier is no longer dropped)
  - 2 slots (floor): a single pair triggers a [Duodron](:::duodron) upgrade (strict two-pair is impossible with only 2 dice; treat the 2-slot case as a single-pair upgrade, `// tunable`). Otherwise falls through to [Voidron](:::voidron)
  - 3 slots: pairs common, three-of-a-kind possible; [Tetradron](:::tetradron) and above unreachable
  - 4 slots: most tiers become reachable
  - 5–6 slots: every tier from [Hexadron](:::hexadron) down is reachable
- This is the strategic reason higher-slot [Weapons](:weapons) are dramatically rarer in [Slot Counts](::slot-counts)

---

# Doge System

> The [Hero](:hero)'s passive evasion system. Each successful Doge fully cancels one incoming [Enemy](:enemy) hit.

## Doge Concept

- Evasion is not perfect immunity; it is a probabilistic gate
- Doge is the second defensive layer behind [Damageable](::damageable) (the first being raw HP)
- A Doge event flashes the [Hero](:hero)'s outline white-cyan and shifts the body by a few pixels in a ghost-step shader

## Doge Source

- Doge stat is aggregated from every equipped [Dice](:dices) on the [Weaponslot](:weaponslot) sidebar
- Each [Dice](:dices) carries an inherent `dogePerSlot`
- Some [Weapons](:weapons) can add a baseline Doge bonus when equipped (e.g. light weapons like Dagger or Knives)
- [Special Enemies](:special-enemies) like the [Glasswraith](::glasswraith) may drop Doge-boosting items

## Formula Callout

- `dogeChance = 1 − (1 − dogePerSlot)^slots`
- Where `slots` is the count of [Diceslot](:diceslot) cells contributing
- This is the probability that **at least one** of the contributing slots blocks the incoming hit
- The formula is monotonic increasing in `dogePerSlot` and in `slots`

## Doge Visual

- On a successful Doge, the [Hero](:hero) renders with a cyan outline flash
- A short trailing copy of the [Hero](:hero) sprite renders behind, fading out over 0.15 s
- A subtle "whiff" sound plays

## Limits

- Hard cap `DOGE_CAP = 0.75` (`// tunable`) — single source of truth for the maximum reachable Doge chance, referenced by [Formula Callout](::formula-callout)
- The passive [Formula Callout](::formula-callout) result is clamped against `DOGE_CAP` before damage application
- Above the cap, additional Doge sources are wasted (or reroute to a tangential stat)
- The cap exists so the [Hero](:hero) never feels invincible and skill-based positioning stays relevant

## Counter

- Some [Special Enemies](:special-enemies) bypass Doge
- The [Hexarchon](::hexarchon) ignores Doge if the [Hero](:hero) is below 30 % HP
- The [Tassidean Sentinel](::tassidean-sentinel) ignores Doge during its phase-end pulse
- These counters protect the threat curve at high gear levels

## Active Doge

> **REMOVED (2026-07-06) — never shipped.** Active Doge was a planned skill-tap
> evade bonus: a well-timed key press inside an enemy's pre-hit window would raise
> [Doge](:doge-system) chance for that single check. A helper
> (`src/combat/ActiveEvasion.hpp`) and the config keys `ACTIVE_EVASION_WINDOW` /
> `ACTIVE_EVASION_BONUS` once existed, but the mechanic was **never wired into any
> live code path**; the 2026-07-06 stabilization pass deleted the helper and the
> keys. `Spacebar` drives the movement **dash**, not an evade tap. This heading is
> retained only so existing `[Active Doge]` cross-references stay reachable; see
> git history for the removed design.

## Relationship to Combat Pipeline

- Doge is checked **before** damage application
- If Doge succeeds, the damage is zeroed and the [Hero](:hero) doesn't take an [Enemy](:enemy) hit
- If Doge fails, full damage is applied via [Damageable](::damageable)
- Doge events also trigger a brief [Hero](:hero) attack-flash bump, giving offensive feedback as well

---

# Attack

> The act of an [Aimable](::aimable) [Entity](::entity) firing at a [Targetable](::targetable) [Entity](::entity).

## Attack mechanic

> Attacks are triggered by [Aimable](::aimable) when a [Targetable](::targetable) [Entity](::entity) is in [Rangeable](::rangeable). The attacker checks whether one or more [Charged](::charged) [Weapons](:weapons) are available, then performs the attack based on each [Weapon](:weapons)'s [Attack Types](::attack-types).

- The [Hero](:hero) is the only [Aimable](::aimable) holder of Weapons; [Enemies](:enemy) attack via their own AI loop (see [AI](::ai))
- Multiple Weapons charging on the same frame fire as a coordinated batch (see [Smart Batch Assignment](::smart-batch-assignment))
- Single-target and AOE attacks may run concurrently in the same frame
- Aim direction is recomputed at fire time, not per-frame, to avoid jitter
- If a Weapon is Charged but no [Targetable](::targetable) [Enemy](:enemy) is in [Rangeable](::rangeable), the [Attack](:attack) is deferred — the Weapon holds the charge (see Charged) and fires on the first frame an [Enemy](:enemy) enters range. Multiple held Weapons release together via the same [Smart Batch Assignment](::smart-batch-assignment) path on the trigger frame

## Attack Types

### Single Attack

- Hits only one [Target](::target) — the closest in range
- Used by [Pitchfork](::pitchfork)
- A straightforward shader-based attack animation: triangle-strip stab from the [Hero](:hero) to the target
- The [Pitchfork](::pitchfork) adds two diverging side prongs for visual variety

### Swipe Attack

- Circular sweep
- Angle ∈ {45°, 90°, 180°, 360°} depending on the [Weapon](:weapons)
- Sweeps clockwise from left to right starting at the first [Target](::target)
- Shader-based fan animation; radius grows during the sweep
- [Multitarget](::multitarget) — any [Enemy](:enemy) within the arc gets hit
- [Impassable](::impassable) — the swipe cannot pass through an enemy that blocks the line of attack
- Used by [Long Sword](::long-sword), [Great Sword](::great-sword), [Halberd](::halberd), [Quarterstaff](::quarterstaff)
- Arc inclusion math: `θ = arccos(clamp(û · f̂, −1, 1)); hit ⇔ θ ≤ halfRad`

### Multi Target Attack

- Hits multiple distinct [Targets](::targets) inside [Rangeable](::rangeable) at once
- Max target number per [Weapon](:weapons)
- If fewer alive [Enemies](:enemy) than the max, all are hit
- Falls back to repeating on the same [Target](::target) if [Targets](::targets) are exhausted
- Used by [Knives](::knives) (max 4)
- Shader-based spread fan radiating from the [Hero](:hero) in all directions

### Multi Single Attack

- Hits the same [Target](::target) multiple times in one action
- Max attacks per action per [Weapon](:weapons)
- The damage shown on the floating text is the **total** (damage × hits)
- Used by [Dagger](::dagger) (max 3)
- Shader animation: stacked triangle-strip stabs at the target

### AOE Attack

- Hits every [Targetable](::targetable) [Entity](::entity) inside the [Rangeable](::rangeable) circle
- Shader animation: expanding ring centred on the [Hero](:hero)
- Duration is longer than other modes (0.50 s vs 0.28 s) to convey impact
- Used by [Mace](::mace), [Warhammer](::warhammer), [Big Axe](::big-axe)

## Attack Speeds

### Slow attack speed

- ≈ 0.8 attacks per second
- Used by [Pitchfork](::pitchfork), [Great Sword](::great-sword), [Halberd](::halberd) (slow variants)

### Medium attack speed

- ≈ 1.2 attacks per second
- Used by [Long Sword](::long-sword), [Big Axe](::big-axe)

### Fast attack speed

- ≈ 1.6 attacks per second
- Used by [Quarterstaff](::quarterstaff), [Mace](::mace), [Warhammer](::warhammer)

## Attack Ranges

### Short attack range

- 300 px
- Used by [Dagger](::dagger), [Mace](::mace), [Warhammer](::warhammer)

### Medium attack range

- 450 px
- Used by [Pitchfork](::pitchfork), [Long Sword](::long-sword), [Great Sword](::great-sword)

### Large attack range

- 600 px
- Used by [Halberd](::halberd), [Quarterstaff](::quarterstaff), [Knives](::knives), [Big Axe](::big-axe)

## Attack Hero Aim

- Computed at fire time
- Primary: vector from [Hero](:hero) to the closest [Enemy](:enemy) within [Weapon](:weapons) range
- No fallback: if no Enemy is in range, the [Attack](:attack) does not fire and the [Weapon](:weapons) holds its [Charged](::charged) state until an Enemy enters range — see [Charged](::charged)
- The aim direction is shared across all [Weapons](:weapons) firing in the same frame (single recompute per batch)

## Smart Batch Assignment

> When multiple single-target [Weapons](:weapons) become [Charged](::charged) on the same frame, an overkill-minimising algorithm picks which weapon targets which enemy.

- **Free-target Weapons** ([Swipe Attack](:::swipe-attack), [AOE Attack](:::aoe-attack), [Multi Target Attack](:::multi-target-attack)) fire immediately without an assigned target
- **Single-target Weapons** ([Single Attack](:::single-attack), [Multi Single Attack](:::multi-single-attack)) enter the assignment pool
- The pool is sorted by ascending damage; enemies in range are sorted by ascending HP
- For each [Enemy](:enemy) in HP order:
  - **Step A:** pick the single unused [Weapon](:weapons) with `damage ≥ HP` and minimum overkill (`damage − HP`). Assign it; mark Enemy covered.
  - **Step B:** if no single weapon kills, accumulate the smallest available Weapons until `Σ damage ≥ HP`. Assign each to this Enemy. Mark covered.
- Leftover Weapons are routed to the first uncovered Enemy (so cooldowns + flashes still trigger)
- The algorithm minimises wasted damage and keeps the [Dron](:dron-multiplier-system) cadence smooth

## VFX

- [Single Attack](:::single-attack) / [Multi Single Attack](:::multi-single-attack): triangle-strip stab; [Pitchfork](::pitchfork) adds side prongs
- [Swipe Attack](:::swipe-attack): 20-segment TriangleFan, radius grows from 18 % to 73 % of range, alpha fades from 58 % to 0
- [AOE Attack](:::aoe-attack): 30-segment ring strip; outer alpha from 62 % to 0; duration 0.50 s
- [Multi Target Attack](:::multi-target-attack) (Knives-style spread): N radial lines, length 12 % to 67 % of range
- Per-type colour is taken from the [Weapon](:weapons)'s base palette so every type has a recognisable signature

## Damage Text

- Normal hit: white, size 100
- Heavy hit (damage ≥ THRESHOLD_HEAVY): orange-amber, size 140
- Critical hit (damage ≥ THRESHOLD_CRITICAL): hot red, size 140
- Outline: black
- Lifetime: 1.0 s, fades out with `alpha = 255 · (1 − progress)`
- Floats upward with a small horizontal jitter

## Critical Hits

> A crit roll on hit that multiplies damage by the [Weapon](:weapons)'s `crit` value.

- Crit chance is the Weapon's base `critChance` plus every slotted [Dice](:dices)'s `critChance`, clamped via `effectiveCritChance = min(CRIT_CHANCE_CAP, critChance)` with `CRIT_CHANCE_CAP = 0.75` (`// tunable`) — prevents 100 % crit saturation at L99
- Crit multiplier is the Weapon's base `crit` plus every slotted [Dice](:dices)'s `crit`
- `roll ∼ U[0, 1); isCrit = roll < effectiveCritChance; finalDamage *= isCrit ? crit : 1`
- The [Archetype Slot Bonus](:::archetype-slot-bonus) Exotic curve and the per-level [Weapon Per-Level Multipliers](:::weapon-per-level-multipliers) for `critChance` BOTH feed `critChance` before the `CRIT_CHANCE_CAP` clamp is applied
- Crit triggers the [Critical Hit](::critical-hits) damage text style (red, large)

---

# Weaponslot

> Permanent right-side sidebar of the UI. Holds equipped [Weapons](:weapons) and their slotted [Dices](:dices). Always visible regardless of [Inventory](:inventory) open state.

- 8 weapon rows
- Each row contains a weapon zone, a dice zone, and a progress bar
- Drop target for [Dragable](::dragable) [Weapons](:weapons) and [Dices](:dices)
- [Charged](::charged) highlight on the row's outline when ready
- Houses the floating [Dron Multiplier System](:dron-multiplier-system) names

## Layout

- Top 60 % — weapon zone (the equipped [Weapon](:weapons) sprite)
- Middle 30 % — dice zone (six [Diceslot](:diceslot) cells)
- Bottom 10 % — progress bar (8 px strip)

## Weapon Zone

- Holds the equipped [Weapon](:weapons) sprite
- Sprite rotated 90° so all weapons read horizontal across slots
- Scale fits the slot width with 95 % padding to keep the sprite from touching outlines
- [Charged](::charged) state: outline pulses with the [Outline Intensity](::outline-intensity) bump

## Dice Zone

- Six [Diceslot](:diceslot) cells arranged horizontally
- Cell size scales with the number of provided dice slots on the [Weapon](:weapons)
- A [Weapon](:weapons) with fewer than 6 slots leaves the surplus cells visually disabled
- Each cell shows the slotted [Dice](:dices)'s rolling face value

## Progress Bar

- Shows the [Charged](::charged) progress for the [Weapon](:weapons)
- Width = `slotWidth · (1 − progress)` — fills from right to left as the cooldown elapses
- Highlights at progress = 1 (slot is ready)
- For [Weapons](:weapons) with slotted [Dices](:dices), the progress shown is `min(dice.progress)` so the slowest [Dice](:dices) drives the visible bar

## Floating Text

> Text rendered above the slot for the [Dron Multiplier System](:dron-multiplier-system) and damage events. **Canonical** for `SLOT_FLOAT_TEXT_DURATION` and `SLOT_FLOAT_TEXT_COLOR`.

- Damage numbers float upward from the slot on each successful hit
- Dron names ([Hexadron](:::hexadron), [Pentadron](:::pentadron), …) float as larger text with fade-in / fade-out for `SLOT_FLOAT_TEXT_DURATION = 1.5 s`
- Colour `SLOT_FLOAT_TEXT_COLOR` = gold ([Dron Float Text Colour](:::dron-float-text-colour))
- The multiplier value (e.g. `×40`) renders just below the Dron name with the same animation
- Texts never overlap awkwardly — z-order is name → multiplier → damage stack
- The [Voidron](:::voidron) tier is silent and renders neither name nor multiplier

## Slot Overlap-Free Rendering

- Sprite scaling enforces the 95 % padding
- The slot polygon is the absolute clip boundary — no part of the [Weapon](:weapons) sprite renders outside it
- The [Roadmap](:roadmap) Phase 3 "no weapon overlap inside weaponslot" task hardens this rule

## Equipping

- Drag a [Weapon](:weapons) from the [Inventory](:inventory) or floor over a row and release
- The row becomes "equipped" — the Weapon's `isEquipped` flag flips
- A previously equipped Weapon in that row is evicted to the Inventory (or floor if Inventory is full)
- The Weapon's [Countdownable](::countdownable) starts fresh
- Newly equipped [Weapons](:weapons) receive a small starting offset (`filledBefore / slotCount`) so multiple new weapons don't fire simultaneously the first time

## Equipped Hero Reference

- Each equipped [Weapon](:weapons) is also pushed into the [Hero](:hero)'s `m_equippedWeapons` list

## Weapon Unequipping

- Right-click on the equipped [Weapon](:weapons) → it returns to the [Inventory](:inventory)
- Drag it out of the row to another row → it swaps rows
- Drag it outside any UI panel → it floor-drops at the cursor world position

---

# Diceslot

> A single dice cell inside a [Weaponslot](:weaponslot) row. Holds one [Dice](:dices).

- [Slotable](::slotable) and [Socketable](::socketable) target
- Six cells per [Weapon](:weapons) (visually; logically up to the [Weapon](:weapons)'s `m_maxSlots`)
- Drop target with a +15 px expanded margin for easier UX
- Cell size scales with the number of slots so smaller-slot [Weapons](:weapons) get larger cells

## Capacity

- A [Weapon](:weapons)'s slot count is decided at drop time (see [Slot Counts](::slot-counts))
- The [Weaponslot](:weaponslot) row visually displays all 6 cells, with the surplus disabled for [Weapons](:weapons) with fewer slots
- A [Dice](:dices) can be moved between cells of the same [Weapon](:weapons) or across [Weapons](:weapons)

## Roll Cycle

- A [Dice](:dices) in a [Diceslot](:diceslot) starts a [Countdownable](::countdownable) on equip
- Face values cycle every 0.1 s while the roll is in progress
- Each Dice renders its own [Countdown Bar](:::countdown-bar) inside the cell, showing individual roll progress
- On [Countdownable](::countdownable) completion, the Dice freezes its face value and the host [Weapon](:weapons) becomes [Charged](::charged) if all slotted [Dices](:dices) are done
- The frozen face values **persist** through any hold-charge wait (see [Charged](::charged)); each Dice only starts its next roll after the host Weapon actually fires
- The host Weapon's `effectiveAps` is recalculated on every equip/unequip (see [Effective APS](:::effective-aps))

## Snap & Margin

- The cell's drop zone is expanded by 15 px on every side
- This lets the player aim "roughly" at the cell without needing pixel-perfect placement
- The drop algorithm picks the first cell that contains the cursor; if none, it falls back to the row's outer drop zone and the first empty cell

## Visual Equip State

- Rotation 0° (dice are always oriented "face up")
- Scale fits the cell with `cellSize / 256` (assets are sized for 256 px reference)
- Centred inside the cell
- Outline matches the [Dice](:dices)'s tier colour

## Empty State

- Empty cells render a neutral outline
- The vertical 6-px progress strip on the right of the cell is collapsed to height 0

## Dice Unequipping

- Drag out of the cell to another [Diceslot](:diceslot) → moves the [Dice](:dices)
- Drag onto the [Inventory](:inventory) → unequip and store
- Drag outside any UI panel → floor-drop
- Right-click → auto-unequip to [Inventory](:inventory)

---

# Quality System

> Each [Item](:loot) and [Enemy](:enemy) carries a quality `q ∈ [1, 100]`, which combined with the [Item Level](::item-level) `l` produces the universal stat multiplier.

## Tier Thresholds

> Two configurable thresholds split the `q` range into three tiers.

- `q < QUALITY_UNCOMMON_THRESHOLD = 40` → **Common**
- `q < QUALITY_RARE_THRESHOLD = 80` → **Uncommon**
- Otherwise → **Rare**

## Tier Visuals

### Common Tier

- Outline colour: soft electric blue
- Body: standard
- Drop frequency: very high
- Powder colour: matches the source item type (see [Powder System](:powder-system))

### Uncommon Tier

- Outline colour: electric green
- Body: slightly brighter
- Drop frequency: medium
- Aura visible on [Enemies](:enemy) (translucent CircleShape around the sprite)

### Rare Tier

- Outline colour: electric red
- Body: brightest
- Drop frequency: rare
- Aura visible on [Enemies](:enemy); larger and more intense than Uncommon

## Stat Multiplier

> The universal multiplier applied to every stat at make-time.

- `qualityFactor = QUALITY_STAT_FACTOR_MIN + (1 − QUALITY_STAT_FACTOR_MIN) · (q / 100)`
- `m = qualityFactor · l`
- `q` — the rolled quality (raw integer, NOT the tier multiplier — see clarification bullet below)
- `l` — the [Item Level](::item-level)
- `QUALITY_STAT_FACTOR_MIN = 0.65` keeps the worst roll playable while the best roll retains the full base stat
- Every base stat passes through `m` before being clamped to its individual floor (e.g. APS ≥ 0.01, range ≥ 50)
- **`qualityMult` interaction (canonical resolution of a prior spec ambiguity):** items also receive a SEPARATE `qualityMult` factor at make-time (Common 1.0 / Uncommon 1.4 / Rare 2.0 — canonical at [Tier Multiplier Reference](::tier-multiplier-reference)). The two factors are applied INDEPENDENTLY, not nested: `finalStat = base · m · qualityMult` at make-time. The raw `q` value interpolates the playable `qualityFactor`; the tier bucket the overall `q` falls into drives the separate `qualityMult` factor multiplicatively on top.

## Tier Multiplier Reference

> **Single source of truth** for every per-tier numeric multiplier in the game. Four independent families — each one is canonical at this anchor; every other section cross-links here instead of restating the values.

| Family | Common | Uncommon | Rare | Applied to | Used by |
|---|---:|---:|---:|---|---|
| **`qualityMult` (item / XP)** | 1.0 | 1.4 | 2.0 | Item base stats at make-time; [Hero](:hero) XP grant per kill | [Leveling & XP](::leveling-xp), [Enemy Level](::enemy-level), [Item Config Multipliers](::item-config-multipliers) |
| **Enemy stat multiplier** | 1× | 3× | 9× | [Enemy](:enemy) health and damage only (squared on top of `qualityMult`) | [Relationship to Enemy](::relationship-to-enemy), [Enemy Level](::enemy-level) |
| **Visual scale** | 1.0× | 1.5× | 2.5× | [Enemy](:enemy) body sprite and [Enemy Healthbar](::enemy-healthbar) vertical offset | [Enemy Healthbar](::enemy-healthbar), [Tier Visuals](::tier-visuals) |
| **[Outline Intensity](::outline-intensity)** | 1.0× | 1.4× | 2.0× | Per-entity emissive multiplier before bloom (post-process) | [Outline Intensity](::outline-intensity), [Tier Visuals](::tier-visuals) |
| **Vendor price multiplier** | ×1 | ×4 | ×20 | [Vendor](::vendor) buy price (sell = ½ buy); applied per item tier | [Pricing](::pricing) |

- All four families share the same tier boundaries from [Tier Thresholds](::tier-thresholds) (`q < 40` Common, `q < 80` Uncommon, else Rare) — never re-declare thresholds elsewhere
- When a section needs to mention a tier's multiplier, link to this table rather than reprint the values; the four families are independent and have drifted in the past — keeping them in one table prevents future drift
- The `qualityMult` family multiplies item base stats at make-time and the [Hero](:hero) XP grant per kill — it is applied as a SEPARATE factor alongside the [Stat Multiplier](::stat-multiplier) `m` (`finalStat = base · m · qualityMult`), NOT nested inside `m`. The raw `q` integer interpolates from the configured playable baseline to the full base stat; the tier bucket of that `q` drives the separate `qualityMult` factor. The other three families are visual or enemy-only and never touch item stat scaling.

## Relationship to Enemy

- [Enemies](:enemy) have a tier from the [Tier Cadence](::tier-cadence) counter
- The tier picks the **enemy stat multiplier** and **visual scale** rows in [Tier Multiplier Reference](::tier-multiplier-reference)
- The tier visuals (aura colour, body scale) are applied at make-time

## Quality Relationship to Loot

- A drop's `q` is rolled in `U[qFloor, 100]` where `qFloor` is set by the [Luck System](:luck-system)
- The `q` then drives both the tier visuals and the universal stat multiplier
- Higher [Hero](:hero) luck → higher floor → bias toward Uncommon and Rare drops

## Relationship to Powder

- When an item is destroyed via the [Powder System](:powder-system), its powder colour is independent of quality — it is the **item type's** colour
- The **quantity** of powder is the sum of all the item's stats (so higher-quality / higher-level items yield more powder)

## Visual Verification

- The [Tier Visuals](::tier-visuals) palette is also used in tooltip headers, [Inventory](:inventory) slot tints, and [Damage Text](::damage-text) when applicable

---

# Level System

> Levels apply to the [Hero](:hero), to [Enemies](:enemy), and to [Items](:loot). Each level scales the relevant base stats.

## Hero Level

> The [Hero](:hero)'s [Levelable](::levelable) state.

- Default level 1, cap 100 (`HERO_MAX_LEVEL`)
- Per-level stat scaling (`configs/hero.yaml`): every hero stat grows as `stat(level) = base · multiplier^(level − 1)`, so L100 = `base · multiplier^99`. Multipliers: `HERO_HEALTH_PER_LEVEL = 1.11`, `HERO_DAMAGE_PER_LEVEL = 1.10`, `HERO_PICKUP_PER_LEVEL = 1.02`, `HERO_MOVE_PER_LEVEL = 1.02`. Health-per-level was lowered `1.15 → 1.11` (phase B) so hero HP growth tracks enemy damage growth (`1.10`) instead of running away — late-game survival drift falls from ~78× to ~2.4× by L99, keeping the endgame lethal. On level-up the hero is fully healed to the new max HP
- XP gained only by killing [Enemies](:enemy); each kill grants `floor(enemy.level² × qualityMult × deltaMult)` XP, then multiplied by the [kill-streak](::leveling-xp) factor
  - `delta = enemy.level − hero.level`; `deltaMult = clamp(1 + delta × 0.1, 1.0, 2.0)` (configurable via `xp.yaml`; floor at 1.0 keeps the per-level baseline as the hard minimum so weak-enemy kills never grant zero)
  - `qualityMult` values: see [Tier Multiplier Reference](::tier-multiplier-reference)
- XP table is a configurable list of 99 per-level step costs, summed into cumulative thresholds at load
- `xpProgress(L) = clamp((xp − cum[L−1]) / (cum[L] − cum[L−1]), 0, 1)`
- The [XP Bar](:::xp-bar) shows current level + numerical progress

## Enemy Level

> An [Enemy](:enemy)'s level, derived from spawn distance.

- Each level from 2 to 100 has a configurable distance step
- The cumulative sum is computed at load
- `level = max v such that dist(spawn, heroStart) ≥ cum[v]`
- Capped at 100
- Stats scale via `factor^(level-1)` for health, damage, and speed (separate factors per stat)

## Item Level

> The level attached to a freshly-minted [Item](:loot).

- Rolled in `U_int[max(1, ⌈enemyLevel / 2⌉), enemyLevel]` at drop time
- Combined with quality via `m = (QUALITY_STAT_FACTOR_MIN + (1 − QUALITY_STAT_FACTOR_MIN) · q/100) · l` — canonical at [Stat Multiplier](::stat-multiplier)
- Higher [Item Level](::item-level) generally produces stronger items
- The lower bound (`⌈enemyLevel / 2⌉`) blocks worst-case L1-drops from high-level enemies; per-enemy variance is at most ~4× on `m` (vs ~enemyLevel×), collapsing the "huge damage gap" complaint. Early-game viability rides the spawn-distance ramp, not drop variance

## Cross-System Multiplier

- The universal `m` (canonical at [Stat Multiplier](::stat-multiplier)) is the central mathematical glue
- It is applied uniformly to every base stat on every item
- This single multiplier connects [Quality System](:quality-system), [Level System](:level-system), and [Luck System](:luck-system) into a coherent damage and drop loop

## Item Config Multipliers

> The simplified weapon config schema.

- Today's config has per-level base stats (e.g. `WEAPON_TYPE0_LEVEL1_DMG_MIN`, `WEAPON_TYPE0_LEVEL2_DMG_MIN`, …) for many levels per type
- The simplified schema collapses this to **one base-stat line per type** plus a global per-stat **level multiplier**
- `stat = baseStat · levelMultiplier · level`
- This is the same formula structure as the existing universal `m` multiplier, but the rule is applied at the type level rather than per-level
- Migration: replace per-level rows with single base + multiplier; tests guard against off-by-one in stat scaling

### Weapon Per-Level Multipliers

> The canonical per-stat `levelMultiplier` values used by the schema above. They apply uniformly to every [Weapon](:weapons) type — archetype-independent. See [Appendix A](:appendix-a-reference-data) for the same table in reference form.

| Stat | Per-level multiplier | Notes |
|---|---|---|
| `damage` | × 1.10 | applied to `minDamage` and `maxDamage`; `1.10^98 ≈ 1.3 × 10⁴` at L99 keeps the curve in range so the Quality × Dron stack doesn't explode |
| `aps` (attacks per second) | × 1.10 | faster fire cadence at higher levels |
| `critChance` | × 1.10 | curve must not saturate before L99 for any non-zero base `critChance`; preserves Crit as a meaningful build dimension across 40 h |
| `critMult` | × 1.15 | crit hits also grow in magnitude |
| `range` | × 1.05 | gentle reach growth; preserves archetype identity |

- Formula: `stat(level) = baseStat · multiplier^(level − 1)` (level 1 = base; level 2 = base × multiplier; …)
- Tuned so a Rare L1 Weapon and a Common mid-level Weapon feel comparable, preserving the [Quality System](:quality-system) ↔ [Level System](:level-system) trade-off
- Cross-link: see also [Cross-System Multiplier](::cross-system-multiplier) for the per-instance quality × level factor `m`

## Level-Up Effects

- Pulse outline brightness on the [Hero](:hero) for 0.5 s
- Update the [XP Bar](:::xp-bar) text immediately
- Brief level-up SFX
- Optional stat-allocation prompt at certain milestones

---

# Luck System

> Aggregated stat that biases drop quality and [Dron](:dron-multiplier-system) rolls in the [Hero](:hero)'s favour.

## Luck Source

> Luck is provided exclusively by equipped [Dices](:dices).

- Each [Dice](:dices) carries a `luck` stat rolled at make-time within `[0, 10]`
- [Special Enemies](:special-enemies) may drop luck-enhancing consumables
- A [Weapon](:weapons) itself does **not** carry luck; only [Dices](:dices) do

## Aggregation

> Luck is summed across **every equipped [Dice](:dices) on the sidebar**.

- Implemented as a sum over all [Weaponslot](:weaponslot) rows × every [Diceslot](:diceslot) cell × every slotted Dice
- Recomputed lazily when a Dice is equipped or unequipped, or at drop time
- Maximum total luck depends on slot count and roll distribution — no hard cap

## Drop Floor

> Luck raises the minimum quality of new drops along a square-root curve so late-game luck still allows variance.

- `qFloor = clamp(⌊sqrt(luckTotal) · LUCK_QUALITY_FLOOR_SCALE⌋, 0, 99)`
- `LUCK_QUALITY_FLOOR_SCALE = 9.0` by default (`// tunable`)
- The roll for new item quality is then `q ∼ U[qFloor, 100]` (uniform integer)
- Square-root replaces linear on purpose: linear let Luck ≥ 80 force every drop to Rare, collapsing late-run variance. The new curve preserves a gap to the 100 cap even at extreme Luck
- Reference points at the default scale: Luck 1 → qFloor 9 ; Luck 10 → qFloor 28 ; Luck 25 → qFloor 45 ; Luck 50 → qFloor 63 ; Luck 100 → qFloor 90
- Luck 25 guarantees every drop is at least Uncommon (`q ≥ 40`); Luck ~78 guarantees Rare (`q ≥ 80`) — was Luck 40 / Luck 80 under linear scaling, so high-Luck builds stretch further before saturating

## Dice Roll Minimum

> Luck also raises the minimum face value of a [Dice](:dices) roll, biasing the [Dron](:dron-multiplier-system) distribution.

- `effectiveMinFace = max(1, ⌊luckTotal · LUCK_DICE_FLOOR_SCALE⌋)`
- The [Dice](:dices)'s rolled face is then clamped to `[effectiveMinFace, faces]`
- This shifts the probability distribution of pairs, full houses, and straights upward without affecting the [Dron](:dron-multiplier-system) detection algorithm itself
- The clamp applies **after** the Dron multiplier so the modifier remains predictable

## Luck Relationship to Loot

- Luck floor + uniform draw on `[qFloor, 100]` is the cleanest possible way to bias quality without changing rarity tables
- Luck does not influence which item type (weapon vs dice) drops; that is governed by [Drop Roll](::drop-roll)
- Luck does not influence the face count of dropped [Dices](:dices); that is governed by [Drop Weights](::drop-weights)
- Luck **does** bias the [Slot Counts](::slot-counts) picker upward via the `luckNorm` term in [Slot Count Modulation by Quality, Level, and Luck](:::slot-count-modulation-by-quality-level-and-luck) — higher aggregate luck → higher probability of multi-slot [Weapon](:weapons) drops

## Relationship to Dron

- Higher luck → higher minimum face value → more pairs / straights → more frequent high-tier [Dron](:dron-multiplier-system) events
- The interaction creates a virtuous loop: better dice → better quality drops → better dice → stronger combos

## Relationship to Hero

- The [Hero](:hero) has no innate luck — every point comes from equipped [Dices](:dices)
- Strategic implication: trading damage stats for luck stats is a real build choice

---

# Loot

> The drop pipeline that runs whenever an [Enemy](:enemy) dies. A per-kill drop-chance gate plus a cascade of weighted decision stages produce **0 to N** items per kill (0 when the gate fails and the kill grants no elite extras), scaled by [Quality System](:quality-system), [Level System](:level-system), and [Luck System](:luck-system).

## Loot Pipeline Overview

> A per-kill **drop-chance gate** decides whether any base item drops at all (there is **no** guaranteed base drop); on success the roll cascades through weapon-vs-dice, per-type/slot/face weights, and per-stat quality. Keys live in `configs/loot.yaml` (drop chance, weights, quality bias, elite extras, floors), `configs/weapon.yaml`, and `configs/dice.yaml`.

```
Enemy dies
   ↓
┌─ Drop-Chance gate — computeDropChance(luckTotal, enemyTier)     [configs/loot.yaml]
│    luckNorm   = clamp(luckTotal / LUCK_DROP_REFERENCE, 0, 1)
│    tierNorm   = enemyTierIndex / 2        (Common 0 · Uncommon 0.5 · Rare 1)
│    dropChance = clamp(BASE_DROP_CHANCE + LUCK_DROP_BONUS·luckNorm
│                       + TIER_DROP_BONUS·tierNorm, 0, MAX_DROP_CHANCE)
│    roll U[0,1) < dropChance ?   yes → one base drop   no → no base drop
│   ↓ (on a successful roll — and once per guaranteed elite extra below)
├─ Stage 1: Weapon vs Dice (WEAPON_DROP_WEIGHT, DICE_DROP_WEIGHT)
│ ├─ if rolled ≤ WEAPON_DROP_WEIGHT → spawn Weapon → Stage 2a + 2b
│ └─ else → spawn Dice → Stage 2c
│
├─ Stage 2a: Weapon Type (DROP_WEIGHT_WEAPON_<TYPE>, 10 types)
│ Stage 2b: Weapon Slot Count (DROP_WEIGHT_WEAPON_SLOTS_<2..6>, modulated by q / itemLevel / luck)
│ Stage 2c: Dice Face (DROP_WEIGHT_DICE_<4..100>, 10 faces)
│ ↓
│ Per-stat Quality (5 independent rolls; biasFloor = luck floor + TIER_STAT_BIAS·enemyTier)
│ Item Level (U_int[max(1, ⌈enemyLevel/2⌉), enemyLevel] — canonical at Item Level)
│ Stats (m = playable qualityFactor · itemLevel, applied per stat)
│
└─ Elite Extras (ELITE_DROP_COUNT_BONUS) — GUARANTEED, on top of the chance roll
   └─ if elite → N guaranteed extra drops → each re-enters Stage 1 … stats
```

> Expected base drops per kill (chance-gated; canonical formula at [Bonus Drop](::bonus-drop), elite extras at [Elite Extra Drops](::elite-extra-drops)):
> - **Low luck, Common enemy** — `dropChance = 0.25` → ≈ **0.25 items**
> - **Mid luck, Uncommon enemy** — `0.25 + 0.25 + 0.15 = 0.65` → ≈ **0.65 items**
> - **Max luck, Rare enemy** — `0.25 + 0.50 + 0.30 = 1.05` clamped to `0.95` → ≈ **0.95 items**
> - **Elite (max luck + tier)** — `0.95` chance + `1` guaranteed extra → ≈ **1.95 items**

## Drop Roll

> Stage 1 of the [Loot Pipeline](::loot-pipeline-overview). First decision: do we drop a [Weapon](:weapons) or a [Dice](:dices)?

- The pipeline weights `WEAPON_DROP_WEIGHT` vs `DICE_DROP_WEIGHT` (both integers) and rolls one
- If weapon: `WeaponMaker.make(enemyLevel, luckTotal)`
- If dice: `DiceMaker.make(enemyLevel, luckTotal)`
- Each maker is responsible for type-selection, slot-count selection (weapons), face-count selection (dice), and the [Quality System](:quality-system) + [Item Level](::item-level) roll
- `WEAPON_DROP_WEIGHT = 50000` and `DICE_DROP_WEIGHT = 50000` produce a 50/50 split; raising one biases the pool
- The two keys are **integers** (not floats); they form a ratio, not probabilities
- The weapon-vs-dice ratio only decides *which* item type spawns **when a base drop occurs**; whether a base drop occurs at all is decided upstream by the [Drop-Chance gate](::bonus-drop). The old "one guaranteed drop per kill" assumption no longer holds — low-luck / low-tier kills frequently drop nothing
- Historical note: an even earlier schema used float `WEAPON_DROP_CHANCE` + `DICE_DROP_CHANCE` as independent per-kill probabilities; replaced by the integer-ratio form so exactly one type is chosen per drop

## Drop Position

- The dropped item appears at the [Enemy](:enemy)'s death position
- The item lies on the floor until the [Hero](:hero) walks within `ITEM_PICKUP_RADIUS` (canonical at [Pickup](::pickup))
- The item's [Outline](::outline) brightens with its [Quality](:quality-system) tier
- The world layer must render floor items so they are visible (see [Roadmap](:roadmap) Phase 1)

## Bonus Drop

> The per-kill **drop-chance gate** — the entry to the [Loot Pipeline](::loot-pipeline-overview) and the canonical home of the drop-chance formula. It **replaces** the old guaranteed-base-drop + `ENEMY_BONUS_DROP_CHANCE` / `ELITE_BONUS_DROP_CHANCE` bonus-roll recursion; those two keys no longer exist. (The heading is retained so existing cross-references resolve.)

- On every [Enemy](:enemy) death a single roll `U[0, 1)` is compared against a computed `dropChance`. On success one base item enters the [Drop Roll](::drop-roll) pipeline; otherwise the kill drops no base item (the [Elite Extra Drops](::elite-extra-drops) below are separate and guaranteed)
- `dropChance = clamp(BASE_DROP_CHANCE + LUCK_DROP_BONUS · luckNorm + TIER_DROP_BONUS · tierNorm, 0, MAX_DROP_CHANCE)`
- `luckNorm = clamp(luckTotal / LUCK_DROP_REFERENCE, 0, 1)` — investing in [Luck](:luck-system) dice lifts the base rate
- `tierNorm = enemyTierIndex / 2` — `Common = 0`, `Uncommon = 0.5`, `Rare = 1`; hunting stronger enemies lifts the rate
- Shipped defaults (`configs/loot.yaml`): `BASE_DROP_CHANCE = 0.25` · `LUCK_DROP_BONUS = 0.50` · `TIER_DROP_BONUS = 0.30` · `MAX_DROP_CHANCE = 0.95` · `LUCK_DROP_REFERENCE = 100`
- Calibration: low-luck Common ≈ `0.25`; mid-luck Uncommon ≈ `0.65`; max-luck Rare saturates at the `0.95` cap
- Design intent: removing the guaranteed base drop makes low-investment play drop fewer items while a lucky, well-geared player farming Rare enemies approaches the cap — drop *rate* is now something the player earns through [Luck](:luck-system) and target choice

## Elite Extra Drops

> Stage 4 of the [Loot Pipeline](::loot-pipeline-overview). Elites additionally grant a configurable number of guaranteed extra drops.

- `ELITE_DROP_COUNT_BONUS` extra drops per elite kill (default `1`) — an **Elite** is any [Enemy](:enemy) whose tier is not Common (Uncommon or Rare)
- Each extra drop is **guaranteed** (not chance-gated) and independently runs the full [Drop Roll](::drop-roll) → weights → per-stat quality path
- Because the elite extras sit on top of the [Drop-Chance gate](::bonus-drop), an elite at max luck + tier averages ≈ `1.95` items per kill (`0.95` base chance + `1` guaranteed extra) — a meaningful but not overwhelming bonus over the `0.95` a common kill can reach

## Quality Floor

> Luck-driven floor on the rolled quality, set by a square-root curve (see [Drop Floor](::drop-floor) for the canonical statement).

- `qFloor = clamp(⌊sqrt(luckTotal) · LUCK_QUALITY_FLOOR_SCALE⌋, 0, 99)`
- `q ∼ U[qFloor, 100]` integer
- **Per-stat quality (shipped):** each dropped item rolls **5 independent** per-stat quality scores, each `q_stat ∼ U[biasFloor, 100]`, where `biasFloor = clamp(qFloor + TIER_STAT_BIAS · enemyTierIndex, 0, 99)` (`TIER_STAT_BIAS = 25` in `configs/loot.yaml`). Enemy tier lifts the lower bound (Common `+0`, Uncommon `+25`, Rare `+50`), clamped to 99 so even a Rare source keeps variance. Each per-stat score drives that stat's own multiplier `m`
- The roll then drives the tier and `m` (see [Quality System](:quality-system))
- `LUCK_QUALITY_FLOOR_SCALE` default canonical at [Drop Floor](::drop-floor); threshold keys `QUALITY_UNCOMMON_THRESHOLD` / `QUALITY_RARE_THRESHOLD` canonical at [Tier Thresholds](::tier-thresholds) — do not restate values here

## Drop Weights — Weapon Type

> Stage 2a of the [Loot Pipeline](::loot-pipeline-overview). Per-type weights for the weapon roll (`DROP_WEIGHT_WEAPON_<TYPE>` in `configs/weapon.yaml`). Total weight `Σ = 14800`; percentages below are `weight / Σ`.

| Weapon | Weight | % of weapon drops |
|---|---:|---:|
| [Pitchfork](::pitchfork) | 5000 | 33.78 % |
| [Long Sword](::long-sword) | 1500 | 10.14 % |
| [Great Sword](::great-sword) | 400 | 2.70 % |
| [Halberd](::halberd) | 800 | 5.41 % |
| [Quarterstaff](::quarterstaff) | 1800 | 12.16 % |
| [Knives](::knives) | 1200 | 8.11 % |
| [Dagger](::dagger) | 2000 | 13.51 % |
| [Mace](::mace) | 1300 | 8.78 % |
| [Big Axe](::big-axe) | 300 | 2.03 % |
| [Warhammer](::warhammer) | 500 | 3.38 % |

- The starter [Pitchfork](::pitchfork) is still the single most common drop, but the spread is far flatter than the old ~90 % skew — commodity weapons (Pitchfork, Dagger, Quarterstaff, Long Sword) together dominate while Great Sword / Big Axe / Warhammer stay rare
- Designers can re-tune any row in `configs/weapon.yaml` without touching code

## Drop Weights — Slot Count

> Stage 2b of the [Loot Pipeline](::loot-pipeline-overview). How many [Diceslot](:diceslot) cells the dropped [Weapon](:weapons) provides. Slot range is **2..6**; the 1-slot tier was removed. Base total weight `Σ = 4048` (pre-modulation).

| Slots | Base weight | Base % of weapon drops |
|---:|---:|---:|
| 2 | 4000 | 98.81 % |
| 3 | 30 | 0.741 % |
| 4 | 15 | 0.371 % |
| 5 | 2 | 0.0494 % |
| 6 | 1 | 0.0247 % |

- 2-slot weapons dominate at base; 6-slot weapons are trophies — under 1 in 4 000 drops at zero modulation
- [Starter Loadout](::starter-loadout) [Pitchfork](::pitchfork) bypasses this table and is hard-set to 2 slots
- Strategic reason high-slot weapons matter for the [Dron Multiplier System](:dron-multiplier-system) — more slots reach more combinations

### Slot Count Modulation by Quality, Level, and Luck

> The base weights above are the **floor distribution**. Each drop modulates them with the dropped item's own [Item Level](::item-level), the drop's rolled [Quality](:quality-system), and the Hero's aggregated [Luck](:luck-system). Higher inputs shift probability mass toward higher slot counts. **The level term normalizes by the *item's* level, not the Hero's.**

- Formula, applied per slot tier `n ∈ {2..6}`:
  - `effectiveWeight[n] = baseWeight[n] · (1 + α·qNorm + β·lvlNorm + γ·luckNorm)^(n − 2)`
- Normalised inputs:
  - `qNorm = q / 100` where `q ∈ [1, 100]` is the rolled [Quality](:quality-system) value
  - `lvlNorm = (itemLevel − 1) / 98` — normalized over the 99-step [Item Level](::item-level) table (L1 = 0, L99 = 1); it is the **dropped item's own level**, NOT the Hero's level
  - `luckNorm = clamp(luckTotal / WEAPON_SLOT_COUNT_LUCK_REFERENCE, 0, 1)` where `WEAPON_SLOT_COUNT_LUCK_REFERENCE = 100`, `// tunable`
- Default tunables (`// tunable`):
  - `α = 0.3` (quality weight)
  - `β = 0.5` (level weight)
  - `γ = 0.4` (luck weight)
- The exponent `(n − 2)` makes 2-slot weights unchanged (multiplier `= 1`) while every higher tier scales geometrically — modulation only ever lifts the tail, never depresses the floor
- After modulation, a fresh weighted pick is performed over `effectiveWeight[2..6]` to choose the slot count
- The modulation runs **per drop**, not per session; a high-quality, high-[Item Level](::item-level) drop pulls aggressively toward 4–6 slots — the pull comes from the *item's* level, so drops from high-level enemies trend to more slots regardless of the Hero's own level
- [Starter Loadout](::starter-loadout) is exempt — starter [Pitchfork](::pitchfork) is hard-set to 2 slots regardless of inputs

## Drop Weights — Dice Face

> Stage 2c of the [Loot Pipeline](::loot-pipeline-overview). Which face count a dropped [Dice](:dices) gets (`DROP_WEIGHT_DICE_<N>` in `configs/dice.yaml`). Total weight `Σ = 7642`.

| Face | Weight | % of dice drops |
|---:|---:|---:|
| d4 | 4000 | 52.34 % |
| d6 | 2200 | 28.79 % |
| d8 | 800 | 10.47 % |
| d12 | 300 | 3.93 % |
| d20 | 180 | 2.36 % |
| d24 | 80 | 1.05 % |
| d30 | 50 | 0.654 % |
| d42 | 20 | 0.262 % |
| d60 | 10 | 0.131 % |
| d100 | 2 | 0.026 % |

- Three commodities (d4 / d6 / d8) account for ≈ 92 % of all dice drops
- d100 carries weight `2` of `7642` — roughly 1 in 3 800 dice drops, a designer-flagged "lifetime" item
- **Level gate:** a face cannot drop until the level reaches `DICE_LEVEL_GATE_D<N>` (`configs/dice.yaml`) — d4 / d6 are ungated; `d8 ≥ 8`, `d12 ≥ 12`, `d20 ≥ 20`, `d24 ≥ 24`, `d30 ≥ 30`, `d42 ≥ 42`, `d60 ≥ 60`, and **d100 unlocks at level 80** (deliberately below 100). Faces below their gate are excluded from the weighted roll
- The face count alone does not set the [Dice](:dices)'s power; quality and item level do — but high face count widens the rolled `Σface` range

## Drop Weight Notes

> Cross-system invariants for the four drop weight families.

- All drop-weight keys are **INTEGER** (not float)
- Each weight is a relative ratio against the others in the same family — absolute magnitude does not matter
- Multiplying every weight in a family by the same scalar leaves the resulting distribution unchanged
- Re-tuning is safe: change any single weight, the others auto-rebalance proportionally
- Per-family weights are independent — re-tuning [Drop Weights — Weapon Type](::drop-weights-weapon-type) does not affect [Drop Weights — Slot Count](::drop-weights-slot-count) or [Drop Weights — Dice Face](::drop-weights-dice-face)
- Stage 1 (`WEAPON_DROP_WEIGHT` vs `DICE_DROP_WEIGHT`) and Stages 2a–2c are independent: a 50/50 weapon-vs-dice split with biased per-type weights still produces the same 50/50 split, just biased within each pool
- The bonus chance keys ([Bonus Drop](::bonus-drop)) are **FLOAT** probabilities in `[0, 1]`, not weights — different rules apply

## Pickup

- Walking inside `ITEM_PICKUP_RADIUS = 360 px` of a floor item triggers automatic pickup if the [Inventory](:inventory) has space
- If full, the item stays on the floor until Inventory frees up
- Pickup is an [Activeable](::activeable) probe from the [Hero](:hero) toward [Collectingable](::collectingable) [Entities](::entity)
- The pickup animation runs for `ITEM_PICKUP_DURATION = 0.3 s` (a short lift + fade into Inventory)

---

# Powder System

> Destroy items and convert them into coloured **powder** that lives in the [Inventory](:inventory) and can later be used for crafting, trade, or as a currency.

## Powder Concept

- The [Hero](:hero) accumulates many low-tier items over time; without a sink, the [Inventory](:inventory) clogs
- Powder is the universal sink: convert N items into one stack of powder of the matching colour
- Powder is a fungible commodity per colour — stacks combine
- The destruction is instant and irreversible

## Inventory UI

> A single-column strip on the **left side** of the [Inventory](:inventory) panel.

- Three buttons, top to bottom:
  - Button 1 — **Destroy all Common items**
  - Button 2 — **Destroy all Uncommon items**
  - Button 3 — **Destroy all Rare items**
- Each button's icon shows a small item silhouette with its tier outline colour
- Hover tooltip lists the count and types of items that would be destroyed

## Conversion Rules

- Clicking Button 1 destroys every item in the [Inventory](:inventory) whose tier is Common
- Clicking Button 2 destroys every Uncommon item
- Clicking Button 3 destroys every Rare item
- Equipped items on the [Weaponslot](:weaponslot) sidebar are **NEVER** destroyed
- Powder colour is determined by the source item's type (see [Powder Colours](::powder-colours))

## Powder Quantity

- `powder = min(POWDER_PER_DESTROY_CAP, round(0.5 · Σ stat))` where the sum runs over every numeric stat on the item
- `POWDER_PER_DESTROY_CAP = 500` (`// tunable`) — soft cap; one late-game Rare destruction can't flood crafting / vendor economy with thousands of units
- The `0.5` factor halves raw yield; combined with the cap, powder stays an economy resource, not runaway currency
- For [Weapons](:weapons): damage, aps, crit, critChance, range
- For [Dices](:dices): damageMultiplier, crit, critChance, luck (and face count counts as 1× stat)
- Quality-tier multiplier already applied (since stats are post-`m`)
- Bonus powder per stat exceeding configured thresholds — placeholder for future balance

## Powder Colours

- d4 → red
- d6 → yellow
- d8 → cyan
- d12 → green
- d20 → blue
- d24 → magenta
- d30 → purple
- d42 → orange
- d60 → pink
- d100 → white
- Any [Weapon](:weapons) (type 0–11) → black
- Other future item types (consumables, special items) → palette TBD

## Storage

> Powder stacks live in regular [Inventory](:inventory) slots.

- Stack quantity is shown as a small number in the slot corner
- Stacks of the same colour merge automatically when added
- A stack can be dragged to the floor like any other item (it becomes a floor pickup)
- Stacks can be sold to [NPCs](:npcs) for currency
- Stacks can be combined with other powders for crafting

## Future Uses

- Crafting: the shipped **[Dice Crafter](::dice-crafter)** spends powder to REFACE and EVOLVE dice — the concrete realization of the old "combine 3 reds + 1 blue → new dice" sketch
- Currency: vendors accept specific colours (PLANNED — no [Villages](:villages) / vendors yet)
- Special effect: drinking a stack of pink powder restores 5 % luck (PLANNED)

## Dice Crafter

> A powder-fuelled crafting panel (`configs/dice_crafter.yaml`) that upgrades a single [Dice](:dices) in place. It is the real path to a perfect d100 and supersedes the informal "3 reds + 1 blue" recipe sketch under [Future Uses](::future-uses).

- Two verbs, each costing [Powder](:powder-system):
  - **REFACE** — re-roll the value of one selected face. Cost `DICE_CRAFTER_REFACE_COST = 1` powder per attempt. **Keep-max: a reface never regresses a face** — the kept value is `max(newRoll, oldValue)`, so refacing a 95 can only hold or improve it, never fall back to a worse roll (this monotonic behaviour is a shipped phase-B fix; it previously overwrote unconditionally and could regress a good face)
  - **EVOLVE** — attempt to grow the die one face-tier (d4 → d6 → … → d100). Cost `DICE_CRAFTER_EVOLVE_COST = 3` powder of the **next** tier per attempt; success is probabilistic and the odds fall steeply as the die grows: `DICE_CRAFTER_EVOLVE_CHANCE_D4 = 0.15` down to `D60 = 0.02`, with `D100 = 0.0` (a d100 is terminal — it cannot evolve further). Retrying with more powder is the intended grind loop
- The perfect-d100 chase is therefore: EVOLVE a die up the tiers, then REFACE each face toward 100 — because reface is monotonic, repeated refacing converges every face to 100 with no risk of backsliding
- A DiceCrafter die does not roll, so no face is "current"; the player clicks a face to mark it as the REFACE target (blue selection ring). The face-cell grid is bounded and adapts cell size / column count to the die's face count so even a d100 fits without overlapping the REFACE / EVOLVE buttons (phase A UI fix)

## Relationship to Inventory

- Powder column occupies the **left side** of the [Inventory](:inventory) panel
- It is always present when the [Inventory](:inventory) is open
- The 4 × 7 grid of regular slots remains unchanged; the column is an extra ~80 px strip

## Auto-Destroy on Pickup

> **PLANNED — not yet implemented.** `AUTO_POWDER_BELOW_QUALITY` is absent from `configs/inventory.yaml`; every [Pickup](::pickup) currently enters the [Inventory](:inventory). Design target: a player-configurable filter that converts low-quality drops directly into matching powder at pickup time, skipping [Inventory](:inventory) and removing the manual destroy step. Aimed at the late game where the [Pitchfork](::pitchfork) is still the most common single weapon drop (≈ 34 %) and d4/d6/d8 are ≈ 92 % of dice drops (see [Drop Weights — Weapon Type](::drop-weights-weapon-type), [Drop Weights — Dice Face](::drop-weights-dice-face)) and the player has stopped reading low-tier drops. (The shipped `configs/loot_filter.yaml` drives a separate loot-filter popup, not this pickup-time auto-conversion.)

- Single threshold key in `inventory.yaml`: `AUTO_POWDER_BELOW_QUALITY` — integer in `[0, 100]`, default `40` (`// tunable`) — the `40` default auto-skips all Common drops at pickup so the player isn't forced into "configure or drown in trash"
- When `AUTO_POWDER_BELOW_QUALITY = 0` the filter is disabled and every [Pickup](::pickup) goes to Inventory; set to `0` explicitly to opt out of the default Common-skip behaviour
- When `AUTO_POWDER_BELOW_QUALITY = T` with `T > 0`, on Pickup:
  - If the rolled `quality < T`, the item is routed through the standard [Conversion Rules](::conversion-rules) pipeline directly into the matching powder stack — the item never occupies an Inventory slot
  - If `quality ≥ T`, the item enters Inventory normally
- Suggested presets:
  - `40` — skip all Common drops (anything below the Uncommon threshold)
  - `80` — skip Common AND Uncommon; keep only Rare
- Configurable live via the [Console](:console): `inventory.AUTO_POWDER_BELOW_QUALITY=40`
- Feedback VFX: a small `+N powder` floating tag appears at the pickup position for 0.4 s when an item is auto-routed, using the matching powder colour from [Powder Colours](::powder-colours), so the player still gets visual confirmation
- If the powder stack would exceed any future per-stack [Powder Quantity](::powder-quantity) cap, the item falls back to floor like a normal full-inventory pickup (forward-compatible — no cap exists today)
- The [Starter Loadout](::starter-loadout) [Pitchfork](::pitchfork) BYPASSES the filter regardless of threshold — the introductory weapon must always reach the [Hero](:hero) so the pickup-then-equip flow can teach itself
- Filter runs ONLY on Pickup; items already in Inventory are unaffected (manual destroy via [Inventory UI](::inventory-ui) is still the route for those)
- The filter respects the same [Pickup Radius](::pickup) and proximity rules as normal pickup; this is purely a routing decision after the pickup event fires

---

# Inventory

> The [Hero](:hero)'s on-person storage of unequipped [Items](:loot). Toggled with the `I` key.

- Is [Storable](::storable)
- Shows [Collectingable](::collectingable) [Entities](::entity)
- Has a cell design — 4 rows × 7 columns of slots
- Drag-and-drop in/out via [Dragable](::dragable) + [Dropable](::dropable)
- Dropping outside the panel → floor drop via [Drop](::dropable)
- Left strip hosts the [Powder Column](::powder-column)

## Slot Layout

- 4 rows × 7 columns = 28 regular slots
- Slot size 220 px
- Slot padding 20 px between cells
- Panel centred on the UI view
- Slot outlines use the [UI Panel Colours](:::ui-panel-colours) palette

## Drag and Drop

> Left-click on an [Inventory](:inventory) slot grabs the item; release determines the destination.

- Drag start: cursor "lifts" the item; the original slot becomes empty
- Drag movement: item floats at the cursor with a small offset
- Drag release:
  - Over another [Inventory](:inventory) slot → swap (or move if target empty)
  - Over the [Weaponslot](:weaponslot) sidebar → equip the item
  - Over a [Diceslot](:diceslot) cell → equip the dice into that cell
  - Over neither panel (outside both) → floor drop at cursor world position

## Inventory Floor Drop

- Released over empty space → item leaves the [Inventory](:inventory) and lands on the floor at the cursor world position
- The floor copy renders with the item's outline
- The [Hero](:hero) can pick it back up by walking into its [Pickup Radius](::pickup)

## Powder Column

> The 3-button vertical strip on the left of the panel.

- Always visible when the [Inventory](:inventory) is open
- Each button is large enough to accept a click without precision aim
- Hover tooltip on each button lists candidate items
- Click confirms instantly (no double-click — destruction is irreversible by design)

## Right-Click Auto-Equip

- Right-click a [Weapon](:weapons) → equips to the first empty [Weaponslot](:weaponslot) row
- Right-click a [Dice](:dices) → equips to the first empty [Diceslot](:diceslot) cell on the first equipped [Weapon](:weapons)
- If no compatible empty slot is found, the click is ignored (visual flash on the item)

## Capacity Logic

- `hasSpace()` returns true if any [Inventory](:inventory) slot has `content == nullptr`
- When [Inventory](:inventory) is full, [Pickup](::pickup) is refused and the floor item remains
- Powder stacks count as slot-occupying items, but each colour can use a single slot due to stacking

## Sorting

- "Sort by tier" button at the top-right
- "Sort by type" button
- Auto-sort on item arrival is opt-in via a settings flag

---

# World Generation

> The procedural generator responsible for populating the infinite world with terrain, flora, water, and ruins.

## Procedural Topography

### Trees

- Dense in earth biomes; sparser in stone
- Visual: silhouette with dark cyan neon outline
- Solid — block movement
- Cluster sizes follow a Poisson distribution
- Drops: rare wood resource

### Flowers

- Decorative, non-solid
- Small splashes of neon colour amid the dark floor
- Random per-tile placement weighted by biome
- Some flowers are pickable for minor health restoration

### Mountains

- Large impassable masses
- Visual: jagged silhouette with electric purple outline
- Solid — block movement
- Force pathfinding to route around them

## Points of Interest

### Ancient Ruins

- Crumbled architecture from a lost civilisation
- Visual: stone silhouettes overgrown with dark moss + neon-violet filigree
- Solid — outer walls block movement, inner courtyards are walkable
- Spawn condition: random across the world, denser near the world's "ancient bands"

### Tassidean Outpost

- Specific themed ruin type tied to the [Tassidean Sentinel](::tassidean-sentinel) lore and the [Tassides Civilisation Remnants](::tassides-civilisation-remnants) culture
- Visual: marble pillars and obelisks with luminescent script
- Always carries a [Tassidean Sentinel](::tassidean-sentinel) special enemy nearby
- Provide lore plaques readable by the [Hero](:hero)

## Ambient Wildlife

> Non-hostile creatures that react to the [Hero](:hero)'s presence.

### Bunny

- Small, fast, harmless
- Visual: small dark silhouette with electric green outline
- Flees the [Hero](:hero) at 200 px proximity
- On contact, drops a small fluff resource (no combat)

### Bird

- Flies above terrain, not solid to the [Hero](:hero)
- Visual: silhouette with neon-cyan wings
- Flies in flocks; flocks scatter on [Hero](:hero) approach
- Cosmetic only

### Owl

- Nocturnal, perches on [Ancient Ruins](:::ancient-ruins)
- Visual: large silhouette with neon-violet eyes
- Cosmetic; signals proximity to ruins

### Fox

- Roams biome transitions
- Visual: small silhouette with neon-amber outline
- Mildly skittish; flees if attacked
- Cosmetic; could provide lore

### Behavior Common to All

- All wildlife uses [Ambient](::ambient) ability
- They never deal damage to the [Hero](:hero)
- They never block movement (transparent to collisions)
- They contribute to the dark-cyberpunk-but-also-natural mood

## Solid / Impassable

- [Trees](:::trees), [Mountains](:::mountains) are Solid
- The [Solid](::solid) ability handles the rendering and collision contract
- Solid features participate in [Pathfinding](:pathfinding)

## Biome Bands

> The world is partitioned into distance-based biome bands.

- Band 1 (0–5000 px from start) — earth dominant, common biomes, easy enemies
- Band 2 (5000–15 000 px) — moss + grass introduced, uncommon enemies more frequent
- Band 3 (15 000–50 000 px) — cobblestone + ruins appear, Tassides remnants begin
- Band 4 (50 000+ px) — voidcrawler density rises, ancient ruins frequent

Bands shift biome palette, drop quality (via Item Level rolls), and enemy density.

---

# Villages

> Rare safe-havens inhabited by [NPCs](:npcs). The first village is far from the [Hero](:hero)'s start.

## Spacing

- The first village spawns at a distance equivalent to roughly **1 hour of continuous walking** at default move speed
- `firstVillageDist ≈ HERO_MOVE_SPEED · 3600 s · 0.85` (allowing for natural slow-downs)
- Subsequent villages spawn at decreasing minimum distances (1 hour → 30 minutes → 20 minutes …) as the world grows old

## Procedural Layout

> A village is generated as a polygon containing buildings, paths, NPCs, and props.

- Polygon size scales with population
- Buildings are placed avoiding overlap and respecting path clearance
- NPCs are spawned at building doorways with wandering boundaries
- Paths connect all buildings; no NPC is unreachable

## Pathways

- Cobblestone with a faint neon glow underfoot
- Wide enough for the [Hero](:hero) to pass two abreast (visual convention)
- Lead from village entrance through every public building

## Buildings

### Forge (Blacksmith)

- Central building, visible from village entrance
- Hosts the [Blacksmith](:::blacksmith) NPC
- Visual: anvil silhouette + neon-orange flame
- Exterior is Solid; the doorway is the interaction trigger

### Apothecary (Pharmacist)

- Side-street building with hanging neon herbs
- Hosts the [Pharmacist](:::pharmacist) NPC
- Visual: mortar and pestle silhouette
- Inner shelves stocked with bottles for visual richness

### Reliquary (Collector)

- Quieter side building
- Hosts the [Collector](:::collector) NPC
- Visual: rows of dice silhouettes in a glass display
- The signature building for [Dice](:dices) economy

### Inn

- Rest mechanic: pay currency to restore [Hero](:hero) HP to full
- Visual: warm orange neon over a chimney
- Hosts an Innkeeper NPC (no trade, just service)

## NPC Roster

- Exactly 3 mandatory vendor NPCs per village: [Blacksmith](:::blacksmith), [Pharmacist](:::pharmacist), [Collector](:::collector)
- Additional ambient villagers (1–6 per village) wander the streets
- Quest-giver NPC subset

## Pricing

> Vendor prices scale with the [Hero](:hero)'s [Quality System](:quality-system) tier and current [Reputation](::reputation).

- Base price formula: `price = floor(Σ stat · tierPriceMultiplier · (1 + reputationModifier))`
- `tierPriceMultiplier` values: see **Vendor price multiplier** row of [Tier Multiplier Reference](::tier-multiplier-reference)
- `reputationModifier` values: see [Reputation](::reputation) — do not restate per-rep percentages here
- Sell prices are half the corresponding buy price

## Village Spawner Tool

> A debug-only button (see [Debug Mode](:debug-mode)) that instantly spawns a village next to the [Hero](:hero).

- Useful for testing the generator without the 1-hour walk
- Spawns a freshly-generated village polygon centred 200 px in front of the [Hero](:hero)
- Marks the spawned village as `debug` so it does not enter the world's village-spacing record

---

# Pathfinding

> The system that lets [Enemies](:enemy), [NPCs](:npcs), and wildlife navigate around [Solid](::solid) obstacles.

## Algorithm

> A* or NavMesh — the choice is made at implementation time.

- **A*** — grid-based, simple to implement, good for sparse obstacles
- **NavMesh** — polygon-based, smoother paths, better for dense urban (village) areas
- Likely choice: A* for the open world, NavMesh inside villages

## Solid Trait

- The [Solid](::solid) ability marks an [Entity](::entity) as blocking
- The pathfinder reads `Solid` flags from the world and routes around them
- Static features ([Trees](:::trees), [Mountains](:::mountains)) are baked into the navmesh at world generation time
- Dynamic features (other [Enemies](:enemy), [NPCs](:npcs)) are not baked; the pathfinder handles them on the fly via local avoidance

## Enemies

> [Enemies](:enemy) use pathfinding to chase the [Hero](:hero) without getting stuck on terrain.

- Path is recomputed periodically (e.g. every 0.5 s of pursuit) or when the local context changes
- Outside chase range, [Enemies](:enemy) idle without pathfinding
- Some [Special Enemies](:special-enemies) bypass certain obstacles (e.g. [Voidcrawler](::voidcrawler) walks through trees)

## NPC Pathfinding

> [NPCs](:npcs) wander within their [Village](:villages) boundaries.

- The pathfinder respects building walls and water
- Wander destinations are chosen randomly inside the village polygon
- NPCs slow down or stop when the [Hero](:hero) is interacting

## Lines (Debug)

- The [Debug Mode](:debug-mode) [Entity Inspector](::entity-inspector) draws each tracked entity's current planned path as a coloured polyline
- Lines are colour-coded: green = enemy chase, yellow = NPC wander, cyan = ambient

## Performance

- Pathfinding is cheap because most [Entities](::entity) are short-pathed (a few hundred pixels at most)
- A* is acceptable for sub-millisecond paths in typical play
- Spatial grid integration with the existing [SpatialGrid](::collisions) for collision queries

---

# Keyboard

> Device the [User](::user) uses to communicate with the application.

- Uses [KeyMap](::keymap)
- All bindings are configurable

## KeyMap

### W

- Move the [Hero](:hero) to the [North](::north)

### A

- Move the [Hero](:hero) to the [West](::west)

### S

- Move the [Hero](:hero) to the [South](::south)

### D

- Move the [Hero](:hero) to the [Est](::est)

### Spacebar

- Trigger the movement **dash** (`DODGE_MAX_CHARGES` charges, cooldown refill, cyan ghost trail). (The former [Active Doge](::active-doge) evade-tap was removed — it never shipped.)

### I

- Toggle the [Inventory](:inventory) panel
- Same key closes the panel
- Right-click auto-equip remains available without opening the panel

### F

- Interact with the nearest [Interactable](::interactable) [NPC](:npcs)
- Trigger condition: see canonical [Interaction Loop](::interaction-loop)
- Opens the trade / dialogue modal

### Comma

- Hot reload — calls `Game::reload()`
- Re-runs init: reloads all configs, rebuilds entities, restarts state
- Used by designers to apply config edits live

### Ctrl + R

- Same hot reload as Comma
- Distinct binding so muscle memory from other engines transfers
- ALSO triggers `restartRun`: clears the live world (enemies, floor items, transient hubs), drains Inventory + WeaponSlot rows, respawns the Hero at level 1 with full HP at the configured spawn point, and respawns the starter Pitchfork on the floor — the loadout-preservation behaviour that previously survived Ctrl+R was scrapped (card-mpo9ws1q) because it made the "restart" verb feel a lie
- The console config overrides survive — `loadDirectoryPreservingOverrides` keeps any keys the user typed into the console intact when re-reading disk values

### Ctrl + O

- Toggle [Debug Mode](:debug-mode)
- Reveals world overlays (range circles, level zones, FPS counter, etc.)

### F5

- Close the window (immediate exit)
- For quick debug iteration

### Escape

- If [HelpHub](::help-overlay) is visible, close it first
- Else close the window
- The two-step close lets the [Hero](:hero) dismiss help without quitting
- Re-enters the close behaviour described in [Roadmap](:roadmap) Phase 1

### Grave (`)

- Toggle the in-game [Console](:console)
- Only active when [Debug Mode](:debug-mode) is visible
- Reuses the same key as Counter-Strike's classic developer console

### Numeric 1..8

- Quick-equip a [Weapon](:weapons) from the corresponding [Weaponslot](:weaponslot) row
- Currently unused; reserved for future bindings

### Tab

- Autocomplete inside the [Console](:console)
- Reserved; not bound globally

## Hold Behaviour

- Holding multiple direction keys produces normalised diagonal movement
- Holding two opposite keys retains the most recent press

## Repeat Behaviour

- Movement keys produce smooth velocity (no per-press tick)
- I, F, Ctrl+O, etc. respond on press only (no repeat)

## Modifier Convention

- Ctrl modifies a small set of keys: O (debug), R (reload future)
- Shift, Alt are currently unused

---

# Mouse

> Device the [User](::user) uses to communicate with the application.

- Uses [MouseMap](::mousemap)
- The mouse position is tracked in both **UI view** and **world view** coordinates; UI panels use the former, world entities the latter

## MouseMap

### Left click

- On press → [Dragable](::dragable)
- On release → [Dropable](::dropable)
- Used for: dragging [Inventory](:inventory) items, dragging [Weapons](:weapons), dragging [Dices](:dices)
- Used for: clicking [Debug Mode](:debug-mode) panel tabs and buttons

### Right click

- Routed first to [Weaponslot](:weaponslot), then to [Inventory](:inventory)
- Typical use: auto-unequip a sidebar item → returns to Inventory
- Auto-equip an Inventory item → goes to first matching sidebar slot

### Wheel

- Help overlay visible → scrolls the help
- Over [Debug Mode](:debug-mode) panel → scrolls the panel
- Otherwise → adjusts world [Zoom](::zoom) (step / clamp canonical there)
- Zoom in / out preserves world centre

### Hover

- Triggers a [Tooltip](::hover-tooltip) on the hovered item
- Tooltip shows item name, stats, and quality
- Hover margin: 30 px (so the tooltip pops as the cursor approaches)

## Cursor State

> The cursor visually shifts to indicate interactivity.

- Default — arrow
- Over an [Interactable](::interactable) [NPC](:npcs) — speech bubble icon
- Over a sidebar slot — hand icon
- During drag — grabbing-hand icon

## Drag Mechanics

> [Dragable](::dragable) preserves the grab-point offset.

- On press, store `offset = entity.position − mouse.position`
- Each frame during drag, set `entity.position = mouse.position + offset`
- Release triggers the [Dropable](::dropable) flow

## Double Click

- Reserved for future shortcuts (e.g. double-click an item to instantly send it to vendor)
- Currently no double-click behaviour beyond what the OS provides

## Hover Tooltip

> The [TooltipHub](::hover-tooltip) renders the floating panel that describes a hovered item.

- Anchored to the cursor with `TOOLTIP_OFFSET_X = 20 px`
- Padding 16 px
- Background: dark violet near-black
- Outline: bright violet
- Text shows item name (gold), stats (light blue), and per-stat-coloured numbers

---

# Directions

> Eight cardinal + intercardinal directions used by [Inputable](::inputable) and other systems.

## North

- In a 2D world this represents the −y coordinate

## North West

- In a 2D world this represents the −x −y coordinate

## West

- In a 2D world this represents the −x coordinate

## South West

- In a 2D world this represents the −x +y coordinate

## South

- In a 2D world this represents the +y coordinate

## South Est

- In a 2D world this represents the +x +y coordinate

## Est

- In a 2D world this represents the +x coordinate

## North Est

- In a 2D world this represents the +x −y coordinate

## Combining Directions

- Two perpendicular directions held simultaneously combine into a diagonal vector
- The vector is normalised so diagonal speed is identical to cardinal speed (no √2 boost)
- Two opposite directions cancel — the most recent press wins

---

# Window & Camera

> The render window and the two camera views used to display the world and the UI.

## Aspect-Letterbox

> The render area is letterboxed to a fixed aspect ratio.

- Target ratio: `GLOBAL_SCREEN_WIDTH / GLOBAL_SCREEN_HEIGHT = 3840 / 2176 ≈ 1.764`
- If the window is wider → vertical letterbox bars on the sides
- If taller → horizontal bars on top and bottom
- The render area always preserves the design aspect

## Continuous Camera

> The player view follows the render-interpolated [Hero](:hero) continuously.

- Simulation keeps previous and current actor positions; rendering interpolates
  between them using the fixed-step clock remainder.
- World coordinates are not rounded or pixel-snapped. Snapping the camera at
  arbitrary zoom creates visible sampling steps instead of removing shimmer.
- The complete world pass renders into an integer-sized physical-pixel surface
  matching the letterboxed viewport, then that surface is copied 1:1 into the
  window. UI remains a separate, crisp design-space pass.
- Repeating floor coordinates are anchored to absolute world space, and painted
  world textures use alpha-safe mipmaps so minification remains stable while
  the camera moves.

## Zoom

> The player view zoom level adjusts the visible world area.

- Default: 1.0 (`CAMERA_ZOOM_DEFAULT` in window.yaml — the world renders at design-pixel scale; the earlier 2.0 default was deliberately changed to 1.0)
- Step: 1.15 per mouse-wheel tick
- Clamp: `[0.25, 20.0]`
- Zoom centre is the render-interpolated [Hero](:hero)

## Auto-Fill on Resize

> When the window is resized, UI panels stretch to fill the available space if there is enough room.

- The height axis is rarely the constraint; UI fills top-to-bottom when possible
- The width axis is the constraint for most layouts; auto-fill checks whether each panel has enough room to grow before changing the layout ratio
- If the window is too small, panels keep their compact arrangement (no fill)
- The [Inventory](:inventory) panel auto-centres after fill
- The [Weaponslot](:weaponslot) sidebar grows in slot height, never width (width is fixed by the design)

## Two Views

- **player view** — pans with the [Hero](:hero), scales with zoom, rendered first (world layer)
- **UI view** — fixed to the window, never pans or zooms, rendered second (HUD layer)
- The [TooltipHub](::hover-tooltip) and [Debug Mode](:debug-mode) live in the UI view
- The [WeaponSlotHub](:weaponslot) sidebar and [XP Bar](:::xp-bar) live in the UI view
- The [Hero](:hero), [Enemies](:enemy), [Items](:loot), [Ambient Wildlife](::ambient-wildlife) live in the player view

---

# Debug Mode

> The in-game developer overlay. Toggled with Ctrl+O.

- Reveals world overlays for ranges and zones
- Adds a tabbed panel showing entity tables, performance stats, and config values
- Hosts the [Console](:console)
- Hosts the [Village Spawner](::village-spawner-button)

## Always-On FPS Counter

> Permanently fixed to the top-right corner of the screen, regardless of [Debug Mode](:debug-mode) state.

- Visible at all times, even outside debug
- Updated each frame: `fps = 1 / realDelta`
- Renders with a small black outline so it stays legible against any floor biome
- Uses a small monospaced font for fast scanning

## Entity Inspector

> Real-time data overlays on top of all entities while [Debug Mode](:debug-mode) is open.

- Each entity displays:
  - Current health (with max)
  - Active timers (cooldowns, charge progress)
  - Equipped items (for [Hero](:hero); slotted [Dices](:dices) for [Weapons](:weapons))
  - Exact world coordinates (x, y)
  - Active [Quality](:quality-system) tier
  - Active [Item Level](::item-level)
  - Active [Doge](:doge-system) chance (for [Hero](:hero))
- Pathfinding lines drawn from each [Enemy](:enemy) and [NPC](:npcs) to their current goal
- Inspector text uses the [Debug Overlay Colours](:::debug-overlay-colours) palette

## World Overlays

> Rangeable circles drawn around relevant entities.

- [Hero](:hero) attack range — bright green
- Hero pickup range — yellow
- [Enemy](:enemy) chase range — orange (light)
- Enemy attack range — red
- Enemy level zones — rainbow-coloured concentric circles centred on Hero start
- Spawn zone (inner / outer radius) — dim outlines
- All overlays are translucent so they don't fight with gameplay

## Tabs

### Entity Tab

- Lists every alive [Enemy](:enemy) with health, level, tier, and position
- Lists the [Hero](:hero) with full inspector data
- Lists floor [Items](:loot) and their quality

### Performance Tab

- FPS history graph (last 120 frames)
- Per-system update time (Manager, Hub, Grid)
- Spatial grid cell counts
- Memory allocation rate

### Config Tab

- Lists every loaded config file
- Allows expanding a file to see its keys and values
- Read-only here; edit via [Console](:console)
- Doubles as a quick reference for `key = value` lookups

### Tab Switch

- The [Roadmap](:roadmap) Phase 3 task hardens the tab-switch click handler (currently misbehaves on click)
- Tab headers are 30 px tall, full-width buttons across the panel top

## Village Spawner Button

- A clickable button in the debug panel
- On click, runs the [Village Generator](:villages) and places a fresh village 200 px in front of the [Hero](:hero)
- The spawned village is marked `debug` and excluded from the world's spacing rules

## Art Gallery

> A unified in-game asset browser toggled by **Ctrl+H**. Provides live, animated previews of every weapon shape, enemy silhouette, shader effect, UI component, and loaded font — no separate windows. Replaces the former standalone Ctrl+W / Ctrl+E / Ctrl+S windows which have been removed.

### Navigation

- **Tab** key cycles the top-level category (currently: Game Art / UI Kit)
- Number keys **1 / 2 / 3** select the sub-tab within the active category (also mouse-clickable)
- Mouse wheel scrolls any scrollable sub-tab
- Each category remembers its last-active sub-tab between visits
- Closed by pressing **Ctrl+H** again, pressing Escape, or clicking outside the modal

### Game Art Category

Three sub-tabs covering every hand-authored or procedural visual asset:

**Weapons (sub-tab 1):** Grid of every [Weapon](:weapons) type (3 columns), each cell rendering the in-game weapon silhouette at standardised scale with a name label below. Hover tooltip: `"Weapon: <name> — In-game silhouette shape preview."` Use this tab to audit weapon shape readability and compare silhouette distinctiveness side-by-side.

**Enemies (sub-tab 2):** Grid of the full procedural enemy silhouette catalogue (5 columns). Each cell runs the [Enemy Body Shader](::enemy-body-shader) with a representative hue and name label, showing the convex SDF body + neon outline + animated fog cloud at idle. Quality-tier colour variants are not previewed here — this tab shows the canonical shape per enemy type.

**Effects (sub-tab 3):** Live animated shader catalogue across three size classes, each shown in a scrollable grid. Up to 300 named effects total:
- **Small 50 px (≤ 100 entries)** — config prefix `EFX_###_*`
- **Medium 500 px (≤ 100 entries)** — config prefix `CEF_###_*`
- **Large 1000 px (≤ 100 entries)** — config prefix `LEF_###_*`

Each cell renders its `.frag` shader live with configured `u_color / u_progress / u_variant / u_speed / u_intensity`, blended additively. Per-size-class scroll offsets are preserved. Config keys: `EFX_CATALOG_*` group.

### UI Kit Category

Two sub-tabs showcasing interactive UI component demos and the loaded font library:

**Components (sub-tab 1):** Scrollable showcase of every reusable UI widget (`UiTab`, `UiTooltip`, `UiButton`, panel chrome variants, hex cells, segmented bars, etc.) with hover tooltips describing each. Use this tab to validate component styling and hover states during UI iteration.

**Fonts (sub-tab 2):** Scrollable list of up to 100 TTF fonts loaded from `assets/fonts/showcase/` (sorted deterministically by filename), each entry rendering a sample phrase in its own typeface at a readable point size. Scroll via `SHOWCASE_FONTS_SCROLL_SPEED`. Font files added to the directory appear automatically on next launch.

## Help Overlay

> [HelpHub](::help-overlay) renders the in-game help markdown.

- Triggered by an on-screen Help button (top corner) or by clicking the help icon
- Renders `assets/help.md` with markdown-style headings and lists
- Scrollable via mouse wheel
- Closed by clicking outside or pressing Escape

## Console Stub

- Toggle via Grave key (only when [Debug Mode](:debug-mode) is visible)
- See full spec at [Console](:console)

---

# Console

> In-game developer console for inspecting and changing config values without a rebuild.

## Activation

- Press Grave (`) while [Debug Mode](:debug-mode) is visible to toggle
- Console opens as a translucent overlay at the top of the screen (Counter-Strike style)
- Console closes on a second Grave press or on Escape

## Console Visual

- Translucent dark-violet background panel
- Monospaced text
- Output area scrolls; input area is a single line at the bottom
- Cursor blinks at standard rate
- Bright cyan caret on the input line
- Console height — 40 % of the screen

## Command Grammar

### all

- Dumps every config key from every loaded config file
- Output is paginated; for now scrolls indefinitely
- Useful as a high-level dump

### config:NAME

- Dumps every key in the file named `NAME` (without `.yaml` extension)
- Example: `config:enemy` lists every key from `enemy.yaml`
- Output format: `KEY = value` per line

### KEY

- Looks up the single key by name
- If only one config file has that key, output is `value`
- If multiple files share the key name (collision), output is `NAME.KEY = value` for each file
- Example collision handling: `QUALITY_UNCOMMON_THRESHOLD` could exist in multiple files; the console shows all of them

### NAME.KEY:value (lookup)

- Explicit dump form
- Equivalent to `KEY` when only one file has it
- Useful for scripting and clarity

### KEY=value

- Sets the key value in memory (and persisted back to the file via ConfigLoader save)
- Effect is immediate — many systems re-read config keys per frame, so the change applies instantly
- For values that cache (rare), a [Comma](:::comma) reload picks them up

### NAME.KEY=value (set)

- Explicit set form
- Required when the key exists in multiple files
- Example: `enemy.ENEMY_BASE_DAMAGE=20`

## Autocomplete

- Pressing Tab cycles candidates that match the current input prefix
- Pressing Tab again cycles to the next candidate
- Pressing Shift+Tab cycles backward
- Candidates are pulled from the union of all config keys + the static command set (`all`, `config:`)
- The selected candidate is highlighted in the input line

## History

- Up arrow recalls previous commands
- Down arrow forward-walks the history
- History persists across [Comma](:::comma) reloads but not across game restarts

## Output Style

- Each output line is prefixed by a small chevron
- Error messages render in red
- Success messages render in green
- Normal output renders in white
- Long values may wrap to a fixed indent

## Future Commands

- `help` — list all commands
- `spawn enemy <type>` — debug spawn
- `spawn village` — alias for [Village Spawner](::village-spawner-button)
- `teleport x y` — move the [Hero](:hero) to a coordinate
- `clear` — clear the output area
- `bind` — rebind a key

---

# Abilities

> The complete inventory of stand-alone behaviour classes that [Entities](::entity) inherit. Each ability is a single concern, never knows about other abilities or about the wider game.

## Action vs Trigger Split

> Abilities are loosely categorised by whether they actively *do* something each frame (action) or whether they hold data / fire callbacks (trigger).

- **Action abilities** include [Moveable](::moveable), [Inputable](::inputable), [Aimable](::aimable), [Dragable](::dragable), [Countdownable](::countdownable). They run logic.
- **Trigger / state abilities** include [Damageable](::damageable), [Deathable](::deathable), [Targetable](::targetable), [Slotable](::slotable), [Socketable](::socketable), [Rangeable](::rangeable), [Qualityable](::qualityable), [Levelable](::levelable). They hold state and fire callbacks.
- Some abilities straddle the line (e.g. [Pickupable](::pickupable) holds a flag but its `pickup()` is an explicit trigger).
- The action / trigger split is a soft categorisation — every ability inherits the same `Baseable` contract.

## Moveable

- The [User](::user) can move the [Entity](::entity) to 8 different [Directions](:directions) by using a [Keyboard](:keyboard)
- Directions can be combined
- Holding two opposite Directions (e.g. [North](::north) and [South](::south)) at the same time stops the one that was activated first
- Implementation rationale: bind a [Transformable](::transformable) target; apply `position += direction · speed · Δt` per frame

## Inputable

- Reads [Keyboard](:keyboard) state for movement
- Returns a normalised direction vector each frame
- Used by the [Hero](:hero) only; [Enemies](:enemy) use [Huntable](::huntable) instead

## Walkable

- Can move
- [Huntable](::huntable) requires [Walkable](::walkable) — chase doesn't make sense if the [Enemy](:enemy) can't move

## Huntable

- [Rangeable](::rangeable)
- [Activeable](::activeable)
- Moves toward the [Hero](:hero)'s last known position (which is [Targetable](::targetable))
- Used by [Enemies](:enemy) for the chase phase of [AI](::ai)

## Aimable

- [Activeable](::activeable)
- [Rangeable](::rangeable)
- Executes an attack against a [Targetable](::targetable) [Entity](::entity)
- Used by [Hero](:hero) [Weapons](:weapons) and by [Enemies](:enemy) (melee swing on the [Hero](:hero))

## Targetable

- [Passivable](::passivable)
- Returns the position of an [Entity](::entity) to go to (or to attack)
- Used by [Hero](:hero), [Enemies](:enemy), [NPCs](:npcs), and floor [Items](:loot)

## Damageable

- Holds health / maxHealth
- `takeDamage(amount)` clamps health ≥ 0
- `isDead()` returns true when health ≤ 0
- `heal(amount)` adds back up to maxHealth
- `healthRatio` returns health / maxHealth
- Used by [Hero](:hero), [Enemies](:enemy)

## Deathable

- One-shot `onDeath` callback fired once when [Damageable](::damageable) reaches 0
- A `m_deadTriggered` flag guards against re-firing
- Used by [Hero](:hero) and [Enemies](:enemy)

## Pickupable

- [Rangeable](::rangeable)
- [Activeable](::activeable)
- Picks up [Collectingable](::collectingable) [Entities](::entity)
- Pickup moves the [Entity](::entity) into the [Inventory](:inventory)
- **Routing exception:** [Auto-Destroy on Pickup](::auto-destroy-on-pickup) may divert sub-threshold drops directly into the matching [Powder System](:powder-system) stack without ever entering the [Inventory](:inventory); the [Starter Loadout](::starter-loadout) [Pitchfork](::pitchfork) is exempt from this exception
- Used by floor [Items](:loot)

## Collectingable

- [Passivable](::passivable)
- An [Entity](::entity) which can be picked up
- Used by floor [Weapons](:weapons), [Dices](:dices), and [Powder](:powder-system) stacks

## Storable

- [Passivable](::passivable)
- Catches a [Dropable](::dropable) [Entity](::entity)
- Used by [Inventory](:inventory) slots and [Weaponslot](:weaponslot) cells

## Dropable

- An [Entity](::entity) which can be dropped
- Release uses the cursor position
- Must be captured by a [Storable](::storable) or it reverts to its source
- Used by every dragged [Item](:loot)

## Dragable

- Binds the [Entity](::entity) to the mouse cursor and follows it
- Grab-point offset is preserved (no snap-to-cursor)
- Used by [Weapons](:weapons), [Dices](:dices), and [Powder](:powder-system) stacks

## Rangeable

- Circle centred on an [Entity](::entity)'s position
- Has a radius
- Visible only in [Debug Mode](:debug-mode)
- Used by [Weapons](:weapons) (attack range), [Enemies](:enemy) (chase / attack range), [Hero](:hero) (pickup range)

## Slotable

- An [Entity](::entity) which can be placed into a [Weaponslot](:weaponslot)
- Currently only [Weapons](:weapons) are [Slotable](::slotable)

## Socketable

- An [Entity](::entity) which can be placed into a [Diceslot](:diceslot)
- Currently only [Dices](:dices) are [Socketable](::socketable)
- A [Weapon](:weapons) cannot be socketed; a [Dice](:dices) cannot be slotted on the [Weaponslot](:weaponslot) directly

## Countdownable

- Is related to a base value of an [Entity](::entity)
- Counts down until 0
- Restart is triggered (for [Weapons](:weapons) without dice, the timer loops on its own; for Weapons with dice, each dice loops separately)
- Used by Weapons and [Dices](:dices)

## Qualityable

- Stores quality `q ∈ [1, 100]` and [Item Level](::item-level) `l`
- Derives a tier (Common / Uncommon / Rare) from configurable thresholds
- Universal multiplier `m` (canonical at [Stat Multiplier](::stat-multiplier)) applied to stats
- Used by [Weapons](:weapons), [Dices](:dices), [Enemies](:enemy)

## Levelable

- Stores level + cumulative XP
- Table-driven (per-level steps prefix-summed into thresholds)
- Falls back to exponential `base · (g^L − 1) / (g − 1)` when no table is given
- Used by [Hero](:hero) and any future XP-gaining [Entity](::entity)

## Passivable

- Ability which responds to [Activeable](::activeable) probes
- Example: [Huntable](::huntable) probes for [Targetable](::targetable) [Entities](::entity)
- Example: [Pickupable](::pickupable) probes for [Collectingable](::collectingable) [Entities](::entity) when in [Rangeable](::rangeable)
- Pure marker — does not run logic itself; the [Activeable](::activeable) does the probing

## Activeable

- Ability which probes for [Passivable](::passivable) to trigger actions
- Owns the probe radius and the activation logic
- Used by [Huntable](::huntable) (probing [Targetable](::targetable) [Hero](:hero)), [Pickupable](::pickupable) (probing [Collectingable](::collectingable) [Items](:loot))

## Solid

- Marks an [Entity](::entity) as impassable to movement
- Used by [Trees](:::trees), [Mountains](:::mountains)
- Read by the [Pathfinding](:pathfinding) system to bake the navmesh
- Read by direct collision checks for the [Hero](:hero) and [Enemies](:enemy) (per-frame, cheap)

## Doge

- See [Doge System](:doge-system)
- Holds a `dogePerSlot` value
- Used by [Dices](:dices) (one stat among many) and some [Weapons](:weapons)

## Interactable

> Marks an [Entity](::entity) as the target of the F key.

- Holds an `onInteract` callback
- Triggered when the [Hero](:hero) presses F while in proximity
- Used by [NPCs](:npcs), [Doors](::doors-future), and interactive ruins

## Vendor

> Sub-trait of [Interactable](::interactable) that adds a trade interface.

- Owns a buy list and a sell list
- Owns a [Reputation](::reputation) link for price modifiers
- Used by [Blacksmith](:::blacksmith), [Pharmacist](:::pharmacist), [Collector](:::collector)

## Ambient

> Marker for non-hostile background wildlife.

- Used by [Bunny](:::bunny), [Bird](:::bird), [Owl](:::owl), [Fox](:::fox)
- Drives the flee-on-proximity logic
- Filtered out by all hostile probes (e.g. [Hero](:hero) [Weapons](:weapons) never auto-target [Ambient](::ambient) entities)

## Itemable

> Marker ability tagging an [Entity](::entity) as a categorisable game item.

- Holds an `ItemType` enum (`NONE`, `WEAPON`, `DICE`, `POWDER`, `POTION`)
- Used by [Weapons](:weapons) and [Dices](:dices) for category-driven UI behaviour
- Tooltip, [Inventory](:inventory) sorting, and [Powder System](:powder-system) all read `ItemType` to branch logic

## Transformable

> Underlying SFML class that holds position / rotation / scale.

- Not strictly an ability in our taxonomy (it's an SFML primitive), but referenced here for completeness
- Many abilities (Movable, Draggable, NumberAnimatable) bind a `Transformable*` to operate on

## ShaderAnimatable

- Maintains a shader time accumulator
- Sets uniforms (time, health ratio, attack flash) on the bound shader each frame
- Used by [Hero](:hero), [Enemies](:enemy), [Weapons](:weapons), [Dices](:dices)

## NumberAnimatable

- Renders a numeric text label following a bound transform
- Used by [Dices](:dices) to render the rolling face value
- Used by [Powder](:powder-system) stacks to render the stack quantity

## Textable

- A SFML text wrapper with origin centred for stable rotation / scale
- Base class for [DamageText](:::damage-text-colours) and floating slot text

## ShaderableRectangle

- Drawable rect + GLSL fragment shader
- Used by [Hero](:hero), [Enemies](:enemy), [Weapons](:weapons), [Dices](:dices) for all visual rendering

## Doors (Future)

> [Interactable](::interactable) door entities placed in [Villages](:villages) and [Ancient Ruins](:::ancient-ruins).

- Open / close on F key interaction
- Solid when closed, non-solid when open
- Some doors are locked and require a key item

---

# Combinations

> The cross-mechanic relationships that emerge from the systems above.

## Final Damage Pipeline

> The single equation that connects every offensive system.

- `final = max(1, base · max(1, Σ face) · max(0.1, Π mult) · dronMult · critIfRolled)`
- `base` — [Weapon](:weapons) `baseDamage` after [Quality System](:quality-system) `m`
- `Σ face` — sum of slotted [Dices](:dices)' current face values
- `Π mult` — product of slotted [Dices](:dices)' `damageMultiplier`
- `dronMult` — winner of [Dron Multiplier System](:dron-multiplier-system) tier detection
- `critIfRolled` — `Weapon.crit + Σ Dice.crit` if a crit was rolled, else 1
- The [Archetype Slot Bonus](:::archetype-slot-bonus) is applied to `base` (and to `aps` / `range` / `critChance` for the relevant archetypes) before `base` enters the formula; it is the ONLY archetype-driven stat modifier in the design
- All steps clamp to safe floors so no single bad roll zeros the damage

## Drop Pipeline

> The flow from kill to [Inventory](:inventory).

- `kill → dropChanceGate → weaponVsDice → typeRoll → slotCountOrFaceRoll → perStatQualityRoll → playable qualityFactor · itemLevel → applyToStat → spawn`
- The `dropChanceGate` (canonical at [Bonus Drop](::bonus-drop)) decides whether *any* base item drops — `clamp(BASE_DROP_CHANCE + LUCK_DROP_BONUS·luckNorm + TIER_DROP_BONUS·tierNorm, 0, MAX_DROP_CHANCE)`; a failed gate ends the pipeline with no drop (elite extras are guaranteed and re-enter at `weaponVsDice`)
- The `qFloor` step injects [Luck](:luck-system) into the quality roll, now rolled **independently per stat** and tier-lifted by `TIER_STAT_BIAS`
- The `applyToStat` step uses the universal `m` multiplier
- The pipeline is identical for [Weapons](:weapons) and [Dices](:dices); only the type and slot/face roll differ

## Defense Pipeline

> The order in which a hit on the [Hero](:hero) is processed.

- `incomingDamage → dogeCheck → if !doge: damageable.takeDamage(amount)`
- `dogeCheck` is the [Doge System](:doge-system) formula
- If dogeed, the [Hero](:hero) takes zero damage and the [Outline](::outline) flashes
- If not dogeed, full damage is applied

## Stat Cycle

> The virtuous (or vicious) loop that drives progression.

- Better dice → better [Dron](:dron-multiplier-system) combos → bigger damage → faster kills → more loot → better dice
- Better quality drops → bigger raw damage from `m` → faster kills → bigger XP per second → higher level → higher [Item Level](::item-level) → bigger `m`
- The loop is balanced by [Tier Cadence](::tier-cadence) (Rare/Uncommon spawns rare) and [Drop Weights](::drop-weights) (low-face dice common, high-face rare)

## Build Dimensions

> The strategic choices a [Hero](:hero) makes.

- **Raw damage** — stack [Weapons](:weapons) with high base damage and [Dices](:dices) with high `damageMultiplier`
- **Crit** — stack Dices with high `crit` and `critChance` for high-roll damage spikes
- **Luck** — stack Dices with high `luck` to bias future drops higher
- **Doge** — stack Dices with high `dogePerSlot` to survive longer
- **Speed** — pick high-APS Weapons to fire more often (more Dron rolls per second)
- **Slot count** — chase 6-slot Weapons for maximum [Dron](:dron-multiplier-system) tier reachability
- **Archetype commitment** — pick a [Weapon Archetype](::weapon-archetypes) and lean into its [Archetype Slot Bonus](:::archetype-slot-bonus); a 2-slot empty Heavy [Big Axe](::big-axe) yields a ×1.30 raw multiplier without ever rolling a [Dron](:dron-multiplier-system) tier, while a fully-slotted Basic [Long Sword](::long-sword) gains +30 % APS

## Counter-Builds (Future)

- [Special Enemies](:special-enemies) that bypass specific stat investments
- Bosses with damage caps (forcing crit / luck builds over raw)
- Glasswraith's evasion encourages [AOE Attack](:::aoe-attack) [Weapons](:weapons)

---

# Roadmap

> The implementation phases. Each phase is a discrete, testable chunk of work.

## Phase 1 — Visibility

> The shortest path from "Hero spawns" to "player can identify, walk to, and pick up the first weapon." Two of the four bullets below correspond to **open entries in [Implementation Anomalies](:implementation-anomalies)** — they are the spec contract for those fixes.

- **Render world items (`drawWorldLayer` gap).** Floor [Items](:loot) must visibly appear in the world pass. Acceptance: a dropped weapon at any world coordinate is visible from the [Window & Camera](:window-camera) at default zoom; the [Outline](::outline) intensity follows the [Quality](:quality-system) tier; the sprite participates in the [Render Order](::render-order) Y-sort like any other [Entity](::entity), with no per-class layer hack.
- **Starter Pitchfork on floor with blink VFX, no auto-equip.** Canonical: [Starter Loadout](::starter-loadout). Linked anomaly: [Starter Pitchfork — Missing First-Frame Spawn](::starter-pitchfork-missing-first-frame-spawn). Acceptance: on `Game::init()` completion exactly one Pitchfork instance exists on the floor with the starter clamp applied — damage ≥ 10, exactly 2 [Diceslot](:diceslot) cells, blink VFX active at the 1.4-second / 50 %-duty cycle, position outside [Pickup Radius](::pickup); the instance is flagged `isStarter` so its damage / slot clamps are not re-rolled by the normal drop pipeline.
- **Diagonal movement speed normalised.** Canonical: [Combining Directions](::combining-directions). Linked anomaly: [Diagonal Movement Speed (`√2` boost)](::diagonal-movement-speed-2-boost). Acceptance: for every pair of perpendicular WASD keys held simultaneously, `speed(diagonal) == speed(cardinal) ± 0.5 %`. The summed input vector is normalised before scaling by `moveSpeed` (default `500 u/s` per [Movement](::movement)).
- **Escape key two-step.** Canonical: [Keyboard](:keyboard) escape binding. Acceptance: first Escape press closes any open [Help Overlay](::help-overlay) / modal panel; second Escape press closes the application window. The two steps are independent — pressing Escape with no overlay open goes straight to window close, and pressing Escape with an overlay open never closes the window.
- **Pickup proximity flow end-to-end.** Acceptance: walking inside `ITEM_PICKUP_RADIUS` (canonical at [Pickup](::pickup)) of the starter [Pitchfork](::pitchfork) triggers the pickup animation (`ITEM_PICKUP_DURATION`, canonical at [Pickup](::pickup)), moves the item into the [Inventory](:inventory), and stops the blink VFX; a second weapon dropped on the floor after the starter has been picked up follows the same flow with no special-case behaviour.

## Phase 2 — Inventory

- Drag-and-drop between [Inventory](:inventory) slots
- Right-click auto-equip to [Weaponslot](:weaponslot) / [Diceslot](:diceslot)
- Right-click auto-unequip from sidebar back to [Inventory](:inventory)
- Tooltip on hover for all [Items](:loot)

## Phase 3 — UI Polish

- Tab switch fix in the [Debug Mode](:debug-mode) panel (clicking a tab header switches content)
- Bigger neon glow (raise [Bloom Strength](::bloom-strength) defaults; see [Outline Intensity](::outline-intensity))
- No-overlap rendering inside [Weaponslot](:weaponslot) rows ([Overlap-Free Rendering](::slot-overlap-free-rendering))

## Phase 4 — Console

- Grave (^) key in [Debug Mode](:debug-mode) opens the [Console](:console)
- Implement `all`, `config:NAME`, `KEY`, `NAME.KEY`, `KEY=value`, `NAME.KEY=value`
- zsh-style autocomplete on Tab
- Up/Down history recall

## Phase 5 — Powder System

- Add the [Powder Column](::powder-column) to the [Inventory](:inventory)
- Implement the 3 destroy buttons (Common / Uncommon / Rare)
- Implement per-type powder colour pipeline
- Powder stacks behave like normal [Inventory](:inventory) items
- Powder is droppable to the floor

## Phase 6 — Dron Multiplier

- Implement the 14-tier detection algorithm
- Float `Dron name + multiplier` label above the [Weaponslot](:weaponslot) row
- Apply `dronMult` to the final damage formula
- Silent [Voidron](:::voidron) tier

## Phase 7 — Names

- New weapon name pool: Pitchfork, Long Sword, Great Sword, Halberd, Quarterstaff, Knives, Dagger, Mace, Warhammer, Big Axe, plus flavour entries (Scythe, Flail, Spear, etc.)
- New dice name pool: Tetrahedron, Hexahedron, Octahedron, Dodecahedron, Icosahedron, plus invented names for higher faces
- Apply names to drops; ensure pool randomness without immediate repeats
- Simplify the per-level weapon config to one base-stats row per type + level multiplier (see [Item Config Multipliers](::item-config-multipliers))

## Phase 8 — Window Auto-Fill

- Resize-aware UI scaling
- Width-conditional fill (fill if there is enough space)
- Height fill from top to bottom
- Verify the [Inventory](:inventory) and [Weaponslot](:weaponslot) keep their layout on small windows

## Phase 9 — Reload

- Wire `Ctrl+R` to call `Game::reload()` (same as Comma)
- Verify both keys produce identical behaviour
- Note: this is a config hot-reload, NOT a full game-state reset
- Update [Help Overlay](::help-overlay) text

## Phase 10 — World Generation

- Implement [Trees](:::trees), [Flowers](:::flowers), [Mountains](:::mountains)
- Implement [Ancient Ruins](:::ancient-ruins), [Tassides Civilisation Remnants](::tassides-civilisation-remnants)
- Implement [Ambient Wildlife](::ambient-wildlife) ([Bunny](:::bunny), [Bird](:::bird), [Owl](:::owl), [Fox](:::fox))
- Apply [Solid](::solid) trait to terrain blockers

## Phase 11 — Pathfinding

- Pick algorithm (A* or NavMesh) for open world
- NavMesh for [Villages](:villages)
- Bake static obstacles into the navmesh
- [Enemies](:enemy) route around obstacles
- [NPCs](:npcs) wander within village boundaries
- Debug lines for current paths

## Phase 12 — Villages

- Spacing rule (1-hour-walk for first; decreasing for subsequent)
- Procedural village layouts
- [Forge / Apothecary / Reliquary / Inn](::buildings)
- [Vendor NPCs](::vendors) with stock rotation
- [Reputation](::reputation) system

## Phase 13 — Doge System

- Implement the Doge stat aggregation
- Implement the `evade = 1 − (1 − dogePerSlot)^slots` formula
- Apply Doge check before damage application
- Ghost-step shader animation on successful evade

## Phase 14 — Special Enemies

- Implement [Shocker](::shocker), [Glasswraith](::glasswraith), [Hexarchon](::hexarchon), [Tassidean Sentinel](::tassidean-sentinel), [Voidcrawler](::voidcrawler), [Pact-Walker](::pact-walker)
- Spawn-condition rules layered on top of [Tier Cadence](::tier-cadence)
- Themed drops per special enemy

## Phase 15 — Dev Tools

- FPS counter top-right (always on)
- Entity Inspector panel (full detail per entity)
- Village Spawner button in [Debug Mode](:debug-mode) panel

## Phase 16 — Audio (Future)

- Ambient music layers per [Biome Bands](::biome-bands)
- Combat ramp SFX
- Dice clatter on roll
- Hit / crit sound differentiation

## Phase 17 — Persistence (Future)

- Save / load the [Hero](:hero) state, [Inventory](:inventory), and [Weaponslot](:weaponslot) loadout
- Save / load the explored world (or just the seed)
- Cloud sync placeholder

## Phase 18 — Balance & Polish (Future)

- Iteration on damage curves, drop rates, level scaling
- Cinematic polish on visuals (more bloom, more flicker, more emissive accents)
- Performance pass for 60 FPS sustained at 5000 [Enemies](:enemy)

---

# Implementation Anomalies

> Tracking record of known drift between this spec and the running code in `src/`. Each entry names the canonical anchor that defines the intended behaviour, the observed behaviour in code, and the fix direction. Anomalies are resolved when the code matches the spec; resolved entries are deleted (not archived) — git history is the audit trail.

> The spec wins: **code is updated to match this document, never the reverse**.

No active anomalies. All previously identified implementation anomalies have been successfully resolved, calibrated, and verified against the running codebase.

---

# Naming Conventions

> The rules that govern how we name things in design and (mirrored) in code.

## Entity / Hub / Manager / Loader / Helper / Globals

- **Entity** — properties + constructor; minimal methods. Examples: [Hero](:hero), [Enemy](:enemy), [Weapon](:weapons), [Dice](:dices).
- **Hub** — handles actions between 2+ entities. Examples: AttackEffectHub, ItemHub, WeaponSlotHub.
- **Manager** — per-entity tick. Examples: HeroManager, EnemyManager, WeaponManager, DiceManager.
- **Loader** — loads assets / configs. Examples: ConfigLoader, NameLoader, TextureLoader, FontLoader.
- **Helper** — pure functions. Examples: RandomHelper.
- **Globals** — namespaced global variables. Examples: WindowGlobals.

## Ability Suffix

- Every ability ends with `-able`: [Moveable](::moveable), [Damageable](::damageable), [Targetable](::targetable), [Dragable](::dragable), etc.
- The suffix is mandatory and signals "thing-that-can-do-X" without coupling to a specific entity.

## Base Prefix

- Abstract base classes are prefixed with `Base`: BaseEntity, BaseHub, BaseManager, BaseLoader, BaseMaker.
- This makes the intent (root of a family) immediately visible.

---

# Aesthetic & Audio

> Visual polish and audio design. Currently a placeholder; full design lives in this section as the audio team picks up the project.

## Bloom Strength (Audio)

- Canonical definition + numeric defaults: [Bloom Strength](::bloom-strength)
- Do not restate values here

## Outline Intensity (Audio)

- Per-entity emissive multiplier applied before bloom
- See [Outline Intensity](::outline-intensity)

## Filigree Density

- High-frequency neon line work on Rare-tier items
- Density scales with [Quality](:quality-system) tier
- Avoids overwhelming the [Body Design](::body-design)

## Music

> Layered ambient + combat ramp.

- Ambient layer: low-tempo synth pads matched to the [Biome Bands](::biome-bands)
- Combat ramp: faster percussion overlays during [Enemy](:enemy) density spikes
- Crossfade between layers smooth over 1.5 s
- Per-biome unique themes

## SFX

> Sound effects per action.

- Dice clatter on every roll start
- Weapon-specific swing SFX (8 distinct sound families)
- Crit hit "snap" overlay
- Pickup "ping"
- Equip "click"
- Dron-tier-specific fanfares (Hexadron gets a chord; lower tiers a chirp)

## Volume Mixing

- Three volume sliders: master, music, SFX
- Defaults: master 100 %, music 70 %, SFX 100 %

## Accessibility

- Toggleable damage text size for readability
- Optional outline-thickness boost for contrast
- Reduced-motion mode that disables some screen flashes

---

# Glossary

> Alphabetised entry list of every term used in this document.

## Ambient (Glossary)

- Non-hostile background wildlife; never deals damage. See [Ambient](::ambient).

## Ancients (Lore)

- Vanished progenitor civilisation that forged the [Veros](::veros). See [Ancients](::ancients).

## Body Design (Glossary)

- Physical mass defining an [Entity](::entity) form. See [Body Design](::body-design).

## Bonus Drop (Glossary)

- Per-enemy chance to grant an extra drop on top of base [Drop Roll](::drop-roll). See [Bonus Drop](::bonus-drop).

## Charged (Glossary)

- [Weapon](:weapons) state when its [Countdownable](::countdownable) timer hits 0. See [Charged](::charged).

## Critical Hit

- Roll that multiplies damage by the [Weapon](:weapons)'s crit value. See [Critical Hits](::critical-hits).

## Doge (Glossary)

- [Hero](:hero)'s evasion ability. See [Doge System](:doge-system).

## Farmer (Lore)

- [Hero](:hero)'s in-fiction identity: ordinary farmer forced to defend his home from an unknown attack. See [Farmer](::farmer).

## Dron

- Multiplier triggered by named combinations of [Dice](:dices) face values. See [Dron Multiplier System](:dron-multiplier-system).

## Duodron (Glossary)

- Dron tier × 2; two pairs of dice values.
- See [Duodron](:::duodron).

## Elite

- An [Enemy](:enemy) whose [Quality](:quality-system) tier is not Common (Uncommon or Rare).
- See [Tier Cadence](::tier-cadence).

## Entity

- A game-world object: [Hero](:hero), [Enemies](:enemy), [Weapons](:weapons), [Dices](:dices), [NPCs](:npcs), [Powder](:powder-system) stacks, [Ambient](::ambient) wildlife.

## Floor Drop (Glossary)

- Releasing an item outside any UI panel; lands at cursor world position. See [Floor Drop](::inventory-floor-drop).

## Hemidron (Glossary)

- Dron tier × 18; all dice high or all dice low, with a **face-count-relative** split (a die is high when its value > `faceCount · 0.5`).
- See [Hemidron](:::hemidron).

## Hexadron (Glossary)

- Dron tier × 40; six-of-a-kind.
- See [Hexadron](:::hexadron).

## Impassable

- Cannot pass through an enemy (referenced in [Swipe Attack](:::swipe-attack) mechanics).

## Inventory (Glossary)

- [Hero](:hero)'s on-person storage of unequipped items. See [Inventory](:inventory).

## Item Level (Glossary)

- Integer on a freshly minted item; combines with [Quality](:quality-system) for stat scaling. See [Item Level](::item-level).

## Lineadron (Glossary)

- Dron tier × 10; a straight of five dice values.
- See [Lineadron](:::lineadron).

## Luck

- Stat on [Dices](:dices); raises [Quality](:quality-system) floor and minimum face of rolls. See [Luck System](:luck-system).

## Minidron (Glossary)

- Dron tier × 3; straight of four dice values.
- See [Minidron](:::minidron).

## Mixdron (Glossary)

- Dron tier × 5; full house (3 + 2 dice values).
- See [Mixdron](:::mixdron).

## Multitarget

- Can hit multiple [Targets](::targets).
- See [Multi Target Attack](:::multi-target-attack).

## Omidron (Glossary)

- Dron tier × 20; full straight 1–6.
- See [Omidron](:::omidron).

## Pentadron (Glossary)

- Dron tier × 30; five-of-a-kind.
- See [Pentadron](:::pentadron).

## Powder

- Coloured material from destroying items. See [Powder System](:powder-system).

## Quality (Glossary)

- Random value `q ∈ [1, 100]` determining tier and stat scaling. See [Quality System](:quality-system).

## Quad-Duodron (Glossary)

- Dron tier × 22; four-of-a-kind plus a pair.
- See [Quad-Duodron](:::quad-duodron).

## Solid (Glossary)

- Marks an [Entity](::entity) as impassable to movement. See [Solid](::solid).

## Split-Seqdron (Glossary)

- Dron tier × 8; two straights of three.
- See [Split-Seqdron](:::split-seqdron).

## Target

- A [Targetable](::targetable) [Entity](::entity).
- See [Targetable](::targetable).

## Targets

- Plural of [Target](::target).

## Shattering (Lore)

- Cataclysm that fractured every [Veros](::veros); splinters became [Dices](:dices). See [Shattering](::shattering).

## Tassides

- Ancient civilisation whose ruins dot the world. See [Tassides Civilisation Remnants](::tassides-civilisation-remnants).

## Tetradron (Glossary)

- Dron tier × 12; four-of-a-kind (spare dice vary).
- See [Tetradron](:::tetradron).

## Triduo-Dron (Glossary)

- Dron tier × 15; three distinct pairs.
- See [Triduo-Dron](:::triduo-dron).

## Twin-Tridron (Glossary)

- Dron tier × 25; two three-of-a-kinds.
- See [Twin-Tridron](:::twin-tridron).

## User

- The human interacting with the application via [Keyboard](:keyboard) and [Mouse](:mouse).

## Vendor (Glossary)

- Specialised [NPC](:npcs) that buys and sells.
- See [Vendor](::vendor).

## Veros (Lore)

- Artifacts of pure probability forged by [Ancients](::ancients); splinters drop as [Dices](:dices). See [Veros](::veros).

## Voidron (Glossary)

- Dron tier × 1; the silent universal fallback for any roll.
- See [Voidron](:::voidron).

## XP

- Experience points; gained only by killing [Enemies](:enemy). See [Leveling & XP](::leveling-xp).

## Weapon (Glossary)

- An [Entity](::entity) that auto-fires on charge.
- See [Weapons](:weapons).

## Weapons (Glossary)

- Plural of [Weapon](:weapons).

## Quality Shard

- Consumable from [Glasswraith](::glasswraith) that raises next drop's [Quality](:quality-system) floor.

---

# Appendix A — Reference Data

> Quick-glance numeric reference; values tunable.
>
> **SSOT discipline:** Glossary subsections restate defaults for fast lookup; authoritative declarations live in the main body (e.g. [Health](::health), [Pickup](::pickup), [Floating Text](::floating-text)). **If a Glossary value disagrees with the main-body canonical, the main-body value wins** — Glossary is rebuilt from canonical, never the reverse. Sibling `(Ref)` subsections (e.g. [Drop Weights — Weapon Type (Ref)](::drop-weights-weapon-type-ref)) use the stricter no-restatement form and only link to canonical.

## Hero (Glossary)

- Default health: 1000
- Default move speed: 500
- Default collision radius: 46
- Max level: 100 (`HERO_MAX_LEVEL`)
- Per-level multipliers: HP ×1.11, damage ×1.10, pickup ×1.02, move ×1.02 — canonical at [Hero Level](::hero-level)

## Enemy (Glossary)

- Default health: 30
- Default base damage: 10
- Default move speed: 330
- Attack range: 280
- Chase range: 2600
- Collision radius: 50
- Attack cooldown: 1.1 s
- Spawn interval: 0.5 s
- Spawn radius (inner / outer): 3000 / 5000
- Spawn exclusion radius (`ENEMY_SPAWN_EXCLUSION_RADIUS`; disc is created on enemy death, centred on the dead enemy's **spawn** position, not its death position): 1000
- Spawn exclusion FIFO capacity: 5000 entries (matches `MAX_ENEMIES`)
- Max simultaneous: 5000

## Item

- Pickup radius: 360
- Hover margin: 30
- Pickup animation duration: 0.3 s

## UI

- Inventory: 4 × 7 cells
- Slot size: 220 px, padding 20 px
- WeaponSlot count: 8
- Dice per weapon slot: up to 6
- Damage text lifetime: 1.0 s
- Slot float text duration: 1.5 s
- Window zoom default / step / min / max: 2.0 / 1.15 / 0.25 / 20.0
- [Hero Healthbar](:::hero-healthbar): 200 × 14 px, 40 px above sprite, label `<currentHP> / <maxHP>`
- [Enemy Healthbar](::enemy-healthbar): 140 × 10 px, 30 px above sprite (× quality visual scale), labels `Lv <N>` (left) and `<currentHP> / <maxHP>` (centre)
- Healthbar fill ramp + background: canonical at [Hero Healthbar](:::hero-healthbar)

## Drop Weights — Weapon Type (Ref)

- Canonical table (totals, weights, percentages): [Drop Weights — Weapon Type](::drop-weights-weapon-type) inside [Loot](:loot)
- Do not restate `Σ` or per-row percentages here — those drift if rebalanced

## Drop Weights — Weapon Slot Count

- Canonical table + formula: [Drop Weights — Slot Count](::drop-weights-slot-count) inside [Loot](:loot)
- Canonical modulation formula: [Slot Count Modulation by Quality, Level, and Luck](:::slot-count-modulation-by-quality-level-and-luck)
- Canonical starter-instance rule: [Starter Loadout](::starter-loadout)
- Do not restate slot range, base weights, or percentages here

## Drop Weights — Dice Face (Ref)

- Canonical table: [Drop Weights — Dice Face](::drop-weights-dice-face) inside [Loot](:loot)
- Canonical face list with descriptions: [Faces](::faces) inside [Dices](:dices)
- Do not restate `Σ` or per-face percentages here

## Quality (Ref)

- Canonical thresholds and multipliers: [Quality System](:quality-system)
- Tier thresholds canonical at [Tier Thresholds](::tier-thresholds) (`q < 40` Common, `q < 80` Uncommon, else Rare)
- All per-tier multipliers (`qualityMult`, enemy stat mult, visual scale, [Outline Intensity](::outline-intensity)) canonical at [Tier Multiplier Reference](::tier-multiplier-reference) — do not restate values here

## Level

- Enemy level factors — canonical at [Level by Distance](::level-by-distance) inside [Enemy](:enemy); do not restate per-stat factors here
- Hero XP table: full step costs at [XP Step Costs](::xp-step-costs-levels-1-99); cumulative thresholds computed at runtime from `xp.yaml`

## XP Step Costs (Levels 1–99)

> XP required to advance from level N to N+1. Canonical source: `configs/xp.yaml`, keys `HERO_XP_LEVEL_1 … HERO_XP_LEVEL_99`, stored as **int64** (late-game steps exceed 32-bit range from ~L90). The full 99-row table lives in that config; the formula + waypoints below reproduce it.

**Curve** (same-level Common baseline, `deltaMult = 1.0`, `qualityMult = 1.0`) — tuned for the ~40-hour play-time target ([Hero Level](::hero-level) cap 100):
- **Phase 1 (L1–39):** `kills(N) = 300 × 1.0705^(N−1)`, then `step(N) = round(kills(N) × N²)` — 300 kills at L1 → 4 001 kills at L39
- **Phase 2 (L40–99):** a pure geometric ramp `step(N) = round(step(39) × 1.06^(N−39))`, **anchored at the Phase-1 endpoint** `step(39)`. The `N²` shaping is intentionally dropped in this phase so the late game tapers instead of exploding past the 40 h budget
- The table is **strictly monotonic (non-decreasing) across all 99 levels** — the old L39→L40 discontinuity (a 9.5× drop from `6 074 968` to `640 000` that made L40 a wall and L40→41 trivial) is gone; the pivot ratio is a gentle `1.06`, not a cliff
- Higher-level enemies, Rare quality, and [kill streaks](::leveling-xp) all reduce the kills needed (the grant is multiplied by `deltaMult`, `qualityMult`, and the kill-streak factor)

> **Storage note:** `HERO_XP_LEVEL_*` are `int64` in `configs/xp.yaml` (not float, not 32-bit int) — `HERO_XP_LEVEL_99 = 200 399 166`, and cumulative sums grow into the billions, so the values are read as 64-bit integers.

**Spot-check waypoints** (shipped `step(N)` from `configs/xp.yaml`):

| Level | `step(N)` |
|------:|----------:|
| 1     | 300 |
| 10    | 55 386 |
| 20    | 437 853 |
| 39    | 6 074 968 |
| 40    | 6 439 466 |
| 60    | 20 652 240 |
| 80    | 66 234 532 |
| 99    | 200 399 166 |

- L40 no longer dips below L39 (`6 439 466 ≥ 6 074 968`); L99 is the largest step and there is no dip anywhere in L1..L99
- Cumulative XP L1→L99 ≈ `3 481 698 034` (~3.48 B) — at ~2 same-level kills/sec ≈ 40–45 h to L99 in active combat

## Weapon Per-Level Multipliers (Ref)

- Canonical table + formula: [Weapon Per-Level Multipliers](:::weapon-per-level-multipliers) inside [Level System](:level-system)
- Do not restate per-stat multipliers or the formula here

## Dron Multipliers

- Canonical table with all 15 tiers, probabilities, multipliers, and visuals: [Tiers](::tiers) inside [Dron Multiplier System](:dron-multiplier-system)
- Range spans Hexadron (×40) down to Voidron (×1); multipliers live in `configs/dron.yaml`, detection thresholds in `configs/dron_patterns.yaml`

## Powder Colours by Source

- Canonical table: [Powder Colours](::powder-colours) inside [Powder System](:powder-system)
- Mapping: d-faces span red → white in spectrum order; all [Weapons](:weapons) yield black

## Debug Colours

- Attack range green (0, 220, 80, 200)
- Pickup range yellow (240, 220, 0, 180)
- Chase range orange (255, 140, 0, 140)
- Enemy attack red (220, 40, 40, 200)
- Debug text lime (220, 255, 80, 230)

---

# Appendix B — Mental Model

> The author's mental model for how systems compose. Useful for onboarding.

## "Why Dice?"

- Dice transform raw damage into a roll: the same [Weapon](:weapons) varies its damage from fire to fire based on the slotted [Dice](:dices) faces.
- Slotting multiple dice multiplies the variance — and triggers the [Dron Multiplier System](:dron-multiplier-system) when combinations align.
- Dice are the central RNG vehicle; without them the [Hero](:hero) is a flat DPS column.

## "Why Quality × Level?"

- One multiplier (`m = playable qualityFactor · itemLevel` — canonical at [Stat Multiplier](::stat-multiplier)) is mathematically simple without allowing low-quality opening items to collapse toward zero.
- It collapses an otherwise two-dimensional progression into a single scalar.
- It composes cleanly with [Luck System](:luck-system) (raises `q`) and [Item Level](::item-level) (raises `l`).

## "Why Dron?"

- Dron rewards investment in slot count and luck.
- It creates "wow" moments — `Hexadron ×40` is rare but transformative.
- It connects directly to dice mechanics without inventing a new layer.

## "Why a sidebar?"

- The [Weaponslot](:weaponslot) sidebar is always visible because the [Hero](:hero) is always being attacked.
- It surfaces the rhythm of fire (progress bars), the current dice rolls (face values), and the latest [Dron](:dron-multiplier-system) event (floating text).
- A toggled inventory has no place for time-sensitive state.

## "Why Powder?"

- Inventory bloat is the natural enemy of a loot-focused game.
- Powder converts low-value items into a fungible commodity without bookkeeping.
- The destruction is a meaningful choice — irreversible, instant, with a colour mapping that ties back to the source.

## "Why a Console?"

- Designers and players alike benefit from runtime tuning.
- The console makes the config visible and editable without restarts or rebuilds.
- It is gated behind [Debug Mode](:debug-mode) so casual play is unaffected.

## "Why Villages?"

- Villages are the safe pocket in an otherwise hostile world.
- Vendors recycle the loot economy: the [Hero](:hero) can convert [Powder](:powder-system) into rare [Dices](:dices) (via the [Collector](:::collector)) without grinding.
- Villages give the world a sense of place — they break up the infinite procedural sameness.

---

# Appendix C — Glossary Cross-Reference

> Quick anchor reference for every concept link target in this document.

## H1 anchors (`[Label](:slug)`)

- [Instruction](:instruction)
- [World](:world)
- [Lore & Setting](:lore-setting)
- [Global Design](:global-design)
- [Hero](:hero)
- [Enemy](:enemy)
- [Special Enemies](:special-enemies)
- [NPCs](:npcs)
- [Weapons](:weapons)
- [Dices](:dices)
- [Dron Multiplier System](:dron-multiplier-system)
- [Doge System](:doge-system)
- [Attack](:attack)
- [Weaponslot](:weaponslot)
- [Diceslot](:diceslot)
- [Quality System](:quality-system)
- [Level System](:level-system)
- [Luck System](:luck-system)
- [Loot](:loot)
- [Powder System](:powder-system)
- [Inventory](:inventory)
- [World Generation](:world-generation)
- [Villages](:villages)
- [Pathfinding](:pathfinding)
- [Keyboard](:keyboard)
- [Mouse](:mouse)
- [Directions](:directions)
- [Window & Camera](:window-camera)
- [Debug Mode](:debug-mode)
- [Console](:console)
- [Abilities](:abilities)
- [Combinations](:combinations)
- [Roadmap](:roadmap)
- [Implementation Anomalies](:implementation-anomalies)
- [Naming Conventions](:naming-conventions)
- [Aesthetic & Audio](:aesthetic-audio)
- [Glossary](:glossary)
- [Appendix A — Reference Data](:appendix-a-reference-data)
- [Appendix B — Mental Model](:appendix-b-mental-model)
- [Appendix C — Glossary Cross-Reference](:appendix-c-glossary-cross-reference)
- [Appendix D — Open Questions](:appendix-d-open-questions)
- [Appendix E — Forbidden Patterns](:appendix-e-forbidden-patterns)
- [Appendix F — Implementation Touchstones](:appendix-f-implementation-touchstones)
- [Appendix G — Pre-Implementation Checklist](:appendix-g-pre-implementation-checklist)
- [Appendix H — Closing Notes](:appendix-h-closing-notes)
- [Appendix I — Drop Weight Evolution](:appendix-i-drop-weight-evolution)
- [Appendix J — Cross-Cutting Mechanics Not Yet Surfaced Above](:appendix-j-cross-cutting-mechanics-not-yet-surfaced-above)
- [Appendix K — Formulas & Weights Index](:appendix-k-formulas-weights-index)

## Dron tier H3 anchors (`[Label](:::slug)`)

- [Hexadron](:::hexadron)
- [Pentadron](:::pentadron)
- [Twin-Tridron](:::twin-tridron)
- [Quad-Duodron](:::quad-duodron)
- [Omidron](:::omidron)
- [Hemidron](:::hemidron)
- [Triduo-Dron](:::triduo-dron)
- [Tetradron](:::tetradron)
- [Lineadron](:::lineadron)
- [Split-Seqdron](:::split-seqdron)
- [Mixdron](:::mixdron)
- [Minidron](:::minidron)
- [Duodron](:::duodron)
- [Voidron](:::voidron)

## Attack-type H3 anchors

- [Single Attack](:::single-attack)
- [Swipe Attack](:::swipe-attack)
- [Multi Target Attack](:::multi-target-attack)
- [Multi Single Attack](:::multi-single-attack)
- [AOE Attack](:::aoe-attack)

## Attack-speed H3 anchors

- [Slow attack speed](:::slow-attack-speed)
- [Medium attack speed](:::medium-attack-speed)
- [Fast attack speed](:::fast-attack-speed)

## Attack-range H3 anchors

- [Short attack range](:::short-attack-range)
- [Medium attack range](:::medium-attack-range)
- [Large attack range](:::large-attack-range)

---

# Appendix D — Open Questions

> Design-team questions tracked with explicit status: **ANSWERED** (resolved, pointer to canonical), **DEFERRED** (postponed, reason given), **PARTIALLY ANSWERED** (one dimension resolved, another pending), **OPEN** (undecided, design input needed). Resolved entries are deleted only once the canonical spec absorbs them.

- **Should [Powder](:powder-system) stack quantities have a cap?** — **PARTIALLY ANSWERED**. Per-destroy yield is capped at `POWDER_PER_DESTROY_CAP = 500` (canonical at [Powder Quantity](::powder-quantity)) and the [Auto-Destroy on Pickup](::auto-destroy-on-pickup) filter throttles inflow, but the per-stack ceiling itself is still **OPEN**. Revisit when [Inventory](:inventory) flood becomes observable in playtest.
- **Should the [Console](:console) support multi-line scripts?** — **DEFERRED**. Reason: `# Console` is scoped to single-line interactive commands ([Command Grammar](::command-grammar)). Multi-line scripts would introduce a scripting-language surface area that the spec does not currently want to commit to. Revisit only if designers report a recurring workflow that needs it.
- **Should [Doge](:doge-system) be visible as a stat bar in the UI?** — **DEFERRED**. Reason: the [Doge System](:doge-system) surfaces evade state through the [Doge Visual](::doge-visual) outline flash, not a persistent bar — the spec deliberately keeps the UI sparse ([Visual Hierarchy](::visual-hierarchy)). Adding a stat bar would compete with the [Weaponslot](:weaponslot) sidebar for attentional priority.
- **Should [Special Enemies](:special-enemies) telegraph their abilities visually before they fire?** — **DEFERRED**. Reason: current spec relies on per-enemy [Body Design](::body-design) and [Filigree](::filigree) for identification, not pre-cast tells. Telegraphs are a separate skill-expression axis worth revisiting once the [Special Enemies](:special-enemies) roster stabilises and playtest shows readability issues.
- **Should villages have a procedural inn that lets the [Hero](:hero) rest?** — **ANSWERED**. Canonical: [Inn](:::inn) inside [Buildings](::buildings) (under [Villages](:villages)). The Inn exists and is scoped to the rest mechanic; the loot-crate extension question is tracked separately in [Open Drop Weight Questions](::open-drop-weight-questions).
- **Should the world contain seasonal events or time-of-day cycles?** — **DEFERRED**. Reason: out of current Phase 1–18 scope (no biome/lighting cycle in [World Generation](:world-generation) or [Floor Shader](::floor-shader)). Revisit as a post-Phase-18 content layer if the project has shipped and is in long-tail content mode.
- **Should the [Hero](:hero) have a base health regeneration rate?** — **DEFERRED**. Reason: combat-loop intent in [Hero](:hero) and [Doge System](:doge-system) is "evade or die"; passive regen would soften the loop and reduce the strategic weight of [Doge](:doge-system) builds. Re-open only if a specific roguelike-progression hook needs it (e.g. a between-village heal).
- **Should there be a hard cap on simultaneous floor items in the world?** — **OPEN**. The [Bonus Drop](::bonus-drop) and [Elite Extra Drops](::elite-extra-drops) stages can compound at high density, and `MAX_ENEMIES = 5000` (canonical at [Enemy](:enemy)) means worst-case ~14 000 floor items co-exist if every drop is uncollected. Decide between (a) cap + cull-oldest, (b) cap + reject-new, (c) no cap + accept the render cost. Design input needed before Phase 18 performance pass.

---

# Appendix E — Forbidden Patterns

> Design choices the project will not make.

- No pay-to-win mechanics; all progression is in-game
- No subscription or microtransaction model; one-time install
- No mandatory online connection; play is fully offline-capable
- No PvP combat
- No mod store integration in the core executable
- No mandatory tutorial; the game teaches via the [Starter Loadout](::starter-loadout) and [Help Overlay](::help-overlay)
- No skill trees in the traditional sense; build is expressed via [Weapons](:weapons) + [Dices](:dices) choices, not unlocks
- No leveling beyond 100
- No procedural enemy randomness beyond what [Quality System](:quality-system) + [Tier Cadence](::tier-cadence) + [Special Enemies](:special-enemies) already provide

---

# Appendix F — Implementation Touchstones

> When the implementation team has a design question, these touchstones are the answer.

- **"What does Hexadron do?"** — see [Hexadron](:::hexadron); multiplier × 40, silent visual on [Voidron](:::voidron) only.
- **"How is dice damage computed?"** — see [Final Damage Pipeline](::final-damage-pipeline); the canonical formula.
- **"What colour is d20 powder?"** — see [Powder Colours](::powder-colours); blue.
- **"What's the spawn rule for a Hexarchon?"** — see [Hexarchon](::hexarchon); replaces every 50th Rare spawn.
- **"How does luck improve drops?"** — see [Drop Floor](::drop-floor); `qFloor = clamp(⌊sqrt(luck) · scale⌋, 0, 99)` (square-root curve; default `scale = 9.0`).
- **"Where does the dice damage formula apply Dron?"** — see [Math Callout](::math-callout) inside [Dron Multiplier System](:dron-multiplier-system); after `Σ face · Π mult`.
- **"What's the slot-count range for a weapon?"** — see [Slot Counts](::slot-counts); range `2..6`, base distribution favours 2-slot, per-drop modulated upward by [Quality](:quality-system) / [Hero Level](::hero-level) / [Luck](:luck-system). Starter [Pitchfork](::pitchfork) is hard-clamped to 2.
- **"What if no enemies are in range when a weapon charges?"** — see [Charged](::charged); the [Weapon](:weapons) holds its [Charged](::charged) state (cooldown frozen, dice faces preserved) and fires on the first frame an [Enemy](:enemy) enters range — no fallback shot in the last input direction.
- **"Where is the FPS counter rendered?"** — see [Always-On FPS Counter](::always-on-fps-counter); top-right, regardless of [Debug Mode](:debug-mode).
- **"What does Ctrl+R do today?"** — see [Roadmap](:roadmap) Phase 9; not yet wired; planned to mirror Comma reload.

---

# Appendix G — Pre-Implementation Checklist

> Before starting implementation on any phase from the [Roadmap](:roadmap), the team verifies:

- The phase's section in this document is current and reviewed
- All cross-references in that section resolve (no broken slugs)
- Numeric defaults are documented in [Appendix A](:appendix-a-reference-data)
- Test cases are listed
- The phase does not silently depend on a `` feature from a later phase
- The phase respects the [Forbidden Patterns](:appendix-e-forbidden-patterns)

---

# Appendix H — Closing Notes

> GameDesign.md is the design source-of-truth. Keep it in sync with implementation. When in doubt, update this document first, then the code.

- The document is intentionally verbose so that every cross-system relationship is documented in one place.
- The colon-anchor cross-references mean any mdvault editor will validate the document's internal coherence.
- The [Roadmap](:roadmap) phases are sequential by default but can be parallelised when the dependencies allow.
- The `@rewrite`, `@improve`, `@update` header tags are the contract that this document is a forward-looking spec, not a backward-looking bug list.

---

# Appendix I — Drop Weight Evolution

> Chronological summary of drop-weight schema evolution; reference for historical commits and future re-tuning.

## V1 — Independent Probabilities

> First attempt — two floats; weapon and dice as independent per-kill chances.

- `WEAPON_DROP_CHANCE` — float `[0, 1]`
- `DICE_DROP_CHANCE` — float `[0, 1]`
- Bug: not mutually exclusive, possible to roll nothing OR roll both
- Bug: hard to reason about total drops per kill

## V2 — Integer Ratio + Bonus Floats

> Two integer weights form a ratio; always exactly one drop per kill, ratio biases weapon vs dice.

- `WEAPON_DROP_WEIGHT` — integer (default `1`)
- `DICE_DROP_WEIGHT` — integer (default `1`)
- Plus float chances for the second drop **(RETIRED in V5 — no longer read by the game):**
  - `ENEMY_BONUS_DROP_CHANCE`
  - `ELITE_BONUS_DROP_CHANCE`
- Plus integer count for guaranteed extras on elite:
  - `ELITE_DROP_COUNT_BONUS` — default canonical at [Elite Extra Drops](::elite-extra-drops)
- This was the drop-count schema through V4; the guaranteed-base-drop + bonus-float second-drop model was replaced by the chance-gated **V5** below

## V3 — Per-Type Weights

> Per-weapon-type and per-dice-face weights (Stages 2a–2c).

- `DROP_WEIGHT_WEAPON_<TYPE>` — 10 keys, integers
- `DROP_WEIGHT_DICE_<N>` — 10 keys, integers
- Weapon types initially 8; expanded to 12 after the type split (Long Sword, Great Sword, Quarterstaff, Big Axe added); later reduced to 10 (Sword and Small Axe removed)
- Total weight is read-only; designers re-tune individual weights

## V4 — Slot Count Weights

> Third weapon axis — [Diceslot](:diceslot) count on the dropped [Weapon](:weapons).

- Originally `DROP_WEIGHT_WEAPON_SLOTS_<1..6>` — 6 keys, integers — with a 1-slot tier dominating (≈ 93 % of drops, mean ≈ 1.07)
- **V4.1 (current):** 1-slot tier removed; key range is now `DROP_WEIGHT_WEAPON_SLOTS_<2..6>` — 5 keys, integers. Base weights `2=4000, 3=30, 4=15, 5=2, 6=1` (`Σ = 4048`). Base mean slot count ≈ 2.017
- **V4.1 (current):** per-drop weights are no longer used directly; they are **modulated** by [Quality](:quality-system), the dropped item's own [Item Level](::item-level), and [Luck](:luck-system) via [Slot Count Modulation by Quality, Level, and Luck](:::slot-count-modulation-by-quality-level-and-luck) before the weighted pick — high-quality, high-item-level, high-luck drops shift the distribution toward multi-slot weapons (the level term normalizes by `(itemLevel − 1) / 98`, NOT by Hero level)
- [Starter Loadout](::starter-loadout) [Pitchfork](::pitchfork) bypasses the weighted roll and is hard-clamped to exactly 2 slots
- This was the last drop-*weight* expansion; the next change (**V5**) reworked the drop-*count* model rather than the weights

## V5 — Chance-Gated Drop (current)

> Reworks the drop-*count* model: the guaranteed base drop and the V2 bonus-float second-drop roll are removed. Whether any base item drops is now a single luck- and enemy-tier-scaled chance.

- New keys (`configs/loot.yaml`): `BASE_DROP_CHANCE = 0.25`, `LUCK_DROP_BONUS = 0.50`, `TIER_DROP_BONUS = 0.30`, `MAX_DROP_CHANCE = 0.95`, `LUCK_DROP_REFERENCE = 100`
- `dropChance = clamp(BASE_DROP_CHANCE + LUCK_DROP_BONUS·luckNorm + TIER_DROP_BONUS·tierNorm, 0, MAX_DROP_CHANCE)` — canonical at [Bonus Drop](::bonus-drop)
- Removed keys: `ENEMY_BONUS_DROP_CHANCE`, `ELITE_BONUS_DROP_CHANCE` (the V2 bonus floats)
- `ELITE_DROP_COUNT_BONUS` survives — elite extras are still guaranteed, now stacked on top of the chance roll
- Adds per-stat quality bias: `TIER_STAT_BIAS = 25` lifts each of the 5 independent per-stat quality floors by enemy tier (canonical at [Quality Floor](::quality-floor))
- This is the active drop-count schema

## Stat Config Simplification

> Parallel simplification of the weapon stat config.

- Earlier schema had per-level rows for every weapon stat (DMG MIN/MAX for level 1, level 2, …, level 100 × 12 types). Total ≈ 16 000 lines in `weapon.yaml`.
- Current schema has one base-stat row per type plus a global per-stat **level multiplier** (`WEAPON_LEVEL_MULTIPLIER_DAMAGE` etc.; canonical values at [Weapon Per-Level Multipliers](:::weapon-per-level-multipliers))
- Total weapon.yaml is now ≈ 3 700 lines
- See [Item Config Multipliers](::item-config-multipliers) for the math
- This refactor lives behind the universal `m` (canonical at [Stat Multiplier](::stat-multiplier)) used by [Quality System](:quality-system)

## Open Drop Weight Questions

> Questions raised during the drop-weight design pass. Status: **ANSWERED** (resolved, pointer to canonical), **DEFERRED** (postponed, reason given), **OPEN** (undecided, design input needed).

- **Should [Special Enemies](:special-enemies) have their own weighted drop tables that bias toward thematic items?** — **ANSWERED**. Canonical thematic bias rules live at [Drop Bias](::drop-bias) inside [Special Enemies](:special-enemies). The bias is per-special-enemy and runs *alongside* (not instead of) the regular drop pipeline; each entry there names the thematic skew (luck Dice, high-face Dice, Quality Shard, Rare-floor, etc.). No additional weighted table is needed.
- **Should there be a "guaranteed first-of-a-type" mechanic (Pity Timer) so the [Hero](:hero) never goes more than N kills without a Rare drop?** — **DEFERRED**. Reason: [Tier Cadence](::tier-cadence) already guarantees a deterministic Rare on every 100th spawn, which functions as a soft pity for the player's perceived rate. A second pity layer on top of drop weights would couple two probability systems and make balance harder. Revisit only if playtest shows long Rare droughts inside individual play sessions.
- **Should drop weights re-tune based on the [Hero](:hero)'s current level (low levels favour Common drops, high levels favour Rare)?** — **PARTIALLY ANSWERED** (slot-count dimension) + **DEFERRED** (tier dimension). Slot-count drop weights are now level-modulated via [Slot Count Modulation by Quality, Level, and Luck](:::slot-count-modulation-by-quality-level-and-luck) (the `lvlNorm` term). Tier (Common/Uncommon/Rare) drop bias remains driven by [Luck](:luck-system) only — not by Hero level directly. The tier-by-Hero-level sub-question is **DEFERRED** because lifting `qFloor` with Hero level would compress the [Quality System](:quality-system) ↔ [Level System](:level-system) trade-off the spec deliberately preserves. Re-open only if playtest shows late-game Common drops feel punishing.
- **Should there be a separate Stage 5 (special drops: [Quality Shard](::quality-shard), powder, currency)?** — **ANSWERED**. Special drops already fire outside the four staged pipeline through per-enemy rules: [Quality Shard](::quality-shard) from [Glasswraith](::glasswraith), [Powder](:powder-system) via [Conversion Rules](::conversion-rules) (not as drops, but as item-destruction yield), currency TBD. No "Stage 5" is needed — the existing pattern (per-enemy / per-system custom logic) is the canonical channel for these.
- **Should the [Inn](:::inn) at a [Village](:villages) sell pre-rolled "loot crates" that follow a different weight table?** — **DEFERRED**. Reason: the [Inn](:::inn) is currently scoped to the rest mechanic only ([Buildings](::buildings) → Inn). Adding a loot-crate vendor would duplicate the [Blacksmith](:::blacksmith) / [Collector](:::collector) trade loop with a randomised wrapper, which the spec does not yet have a strategic role for. Re-open when there is a vendor-overlap problem to solve.

## Drop Weight Master Table

> All currently-active drop-weight keys at a glance.

| Family | Key range | Type | Stage |
|---|---|---|---|
| Weapon vs Dice | `WEAPON_DROP_WEIGHT`, `DICE_DROP_WEIGHT` | INTEGER | 1 |
| Weapon Type | `DROP_WEIGHT_WEAPON_<TYPE>` × 10 | INTEGER | 2a |
| Weapon Slots | `DROP_WEIGHT_WEAPON_SLOTS_<2..6>` × 5 | INTEGER | 2b |
| Dice Face | `DROP_WEIGHT_DICE_<N>` × 10 | INTEGER | 2c |
| Drop Chance (gate) | `BASE_DROP_CHANCE`, `LUCK_DROP_BONUS`, `TIER_DROP_BONUS`, `MAX_DROP_CHANCE`, `LUCK_DROP_REFERENCE` | FLOAT | gate |
| Elite Extras | `ELITE_DROP_COUNT_BONUS` | INTEGER | 4 |
| Luck Floor | `LUCK_QUALITY_FLOOR_SCALE` | FLOAT | quality |
| Quality Bias | `TIER_STAT_BIAS` | INTEGER | quality |

The **V5** rework dropped the bonus-float pair (`ENEMY_BONUS_DROP_CHANCE`, `ELITE_BONUS_DROP_CHANCE`) and added the five FLOAT drop-chance keys plus the INTEGER `TIER_STAT_BIAS`. The weight-family key counts are unchanged — weapon-vs-dice 2, weapon type 10, slots 5, dice face 10 (all INTEGER) — and `ELITE_DROP_COUNT_BONUS` (INTEGER) survives.

---

# Appendix J — Cross-Cutting Mechanics Not Yet Surfaced Above

> Smaller cross-section systems, collected here for searchability.

## Spatial Grid

> Bucketed neighbour lookup for [Enemy](:enemy) collision resolution.

- Cell size `SPATIAL_GRID_CELL_SIZE = 100 px` (must equal `2 · ENEMY_COLLISION_RADIUS`)
- Rebuilt every frame from the Enemy list
- Reduces pair checks from O(N²) to O(N) for typical play densities
- Supports up to `MAX_ENEMIES` simultaneous enemies at stable 60 FPS — value canonical at Enemy

## Smart Batch Firing

> Handles multiple [Weapons](:weapons) becoming [Charged](::charged) in the same frame.

- Phase 1: `tickWeapon` on each row updates timers and shader uniforms
- Phase 2: ready weapons go into a `ReadyWeapon` list
- Phase 3: `batchFire` runs `assignWeapons` for single-target weapons; free-target weapons fire immediately
- See [Smart Batch Assignment](::smart-batch-assignment) for the overkill-minimising algorithm

## Hot-Reload via Comma Key

> Live config tuning shortcut.

- `,` key triggers `Game::reload()` (full re-init)
- Re-reads every `.yaml` file, rebuilds all entities, restarts hubs
- A second binding (`Ctrl+R`) is reserved for the same action — currently unwired (see [Roadmap](:roadmap) Phase 9)
- Most numeric config keys can also be re-tuned via the [Console](:console) without a full reload

## Hero Attack Flash

> Visual feedback on [Weapon](:weapons) hit.

- `Hero::notifyAttack()` is called once per landed hit
- Sets `attackFlash = 1.0`
- Decays linearly at `4·Δt` per frame (full decay in ≈ 0.25 s)
- Drives the `u_attacking` shader uniform on the [Hero](:hero)'s body shader
- Independent of the [Weapon](:weapons)'s own `attackFlash`, which drives the weapon sprite's pulse

## Per-Weapon Pickup Distance Note

> [Pickup Radius](::pickup) is global, not per-weapon.

- All [Items](:loot) on the floor share the same `ITEM_PICKUP_RADIUS` (canonical value at [Pickup](::pickup))
- Future design may differentiate (e.g. magnets for high-luck), see open questions

## Slot Float Text

> Floating text above a [Weaponslot](:weaponslot) row per fire; per-slot dedup via [Float Label Dedup](::float-label-dedup).

- Damage number rendered immediately on every fire (never deduped)
- Dron name + multiplier rendered for non-[Voidron](:::voidron) tiers, throttled through Float Label Dedup: same-tier repeats increment a counter, lower-or-equal tiers are silently dropped, the five always-show tiers ([Hexadron](:::hexadron) / [Pentadron](:::pentadron) / [Twin-Tridron](:::twin-tridron) / [Quad-Duodron](:::quad-duodron) / [Omidron](:::omidron)) bypass dedup
- Duration and colour canonical at [Floating Text](::floating-text) — do not restate values here
- Multiple consecutive fires stack vertically in the float queue ONLY when not collapsed by Float Label Dedup (e.g. damage numbers always stack; deduped low-tier Dron labels do not)

## Damage Text Tiers

> Visual tiers for normal / heavy / critical damage.

- Below `DAMAGE_TEXT_THRESHOLD_HEAVY = 15`: white text, size 100
- Between heavy and critical: orange text, size 140
- Above `DAMAGE_TEXT_THRESHOLD_CRITICAL = 30`: hot red text, size 140
- Lifetime `DAMAGE_TEXT_LIFETIME = 1.0 s`
- Float speed `DAMAGE_TEXT_MOVE_SPEED = 80 px/s`
- Random horizontal jitter `U[−0.5, 0.5]` keeps stacked hits readable

## Item Hover Margin

> Hover tooltip triggers slightly outside the item's visual bounds.

- Expansion `ITEM_HOVER_MARGIN = 30 px` around every floor item's [Body Design](::body-design)
- Lets the cursor approach without precision aim
- Same margin used for [Diceslot](:diceslot) drop zones (+15 px each side)

---

# Appendix K — Formulas & Weights Index

> Read-only catalog of every formula and weight / distribution table, indexed by canonical anchor. Values are NOT restated here — follow the cross-link. If a catalog entry disagrees with the canonical anchor, the canonical wins (rebuilt from the body, never the reverse). Sibling discipline: [Appendix A — Reference Data](:appendix-a-reference-data) holds quick-lookup defaults; this appendix holds symbolic relationships and the table inventory.

## Combat — Final Damage Pipeline

- **Final damage** — `final = max(1, base · max(1, Σ face) · max(0.1, Π mult) · dronMult · critIfRolled)` — canonical at [Final Damage Pipeline](::final-damage-pipeline)
- **Pre-Dron damage (Dices view)** — `damage = max(1, baseDamage · max(1, Σ face) · max(0.1, Π mult))` — canonical at [Damage Modifier](::damage-modifier)
- **Pre-crit damage (Dron view)** — `damage = max(1, base · max(1, Σ face) · max(0.1, Π mult) · dronMult)` — canonical at [Math Callout](::math-callout) (Dron)
- **Critical hit roll** — `roll ∼ U[0, 1); isCrit = roll < critChance; finalDamage *= isCrit ? crit : 1` — canonical at [Critical Hits](::critical-hits)
- **Effective APS (slotted weapon)** — `effectiveAps = 1 / max(rollDuration)` over slotted [Dices](:dices) — canonical at [Effective APS](:::effective-aps)
- **Period (unslotted weapon)** — `period = 1 / aps` — canonical at [Effective APS](:::effective-aps)

## Combat — Defense

- **Passive Doge** — `dogeChance = 1 − (1 − dogePerSlot)^slots` — canonical at [Formula Callout](::formula-callout)
- **Defense pipeline** — `incomingDamage → dogeCheck → if !doge: damageable.takeDamage(amount)` — canonical at [Defense Pipeline](::defense-pipeline)

## Quality / Level — Stat Multiplier

- **Universal stat multiplier `m`** — `m = playable qualityFactor · itemLevel` — canonical at [Stat Multiplier](::stat-multiplier)
- **Item stat compose at make-time** — `finalStat = base · m · qualityMult` (the two factors are independent, not nested — see [Stat Multiplier](::stat-multiplier) clarification bullet)
- **Tier thresholds** — `q < QUALITY_UNCOMMON_THRESHOLD` → Common; `q < QUALITY_RARE_THRESHOLD` → Uncommon; else Rare — canonical at [Tier Thresholds](::tier-thresholds)
- **Item Level roll** — `itemLevel ∼ U_int[max(1, ⌈enemyLevel/2⌉), enemyLevel]` — canonical at [Item Level](::item-level)
- **Per-stat level curve** — `stat(level) = baseStat · multiplier^(level − 1)` — canonical at [Weapon Per-Level Multipliers](:::weapon-per-level-multipliers)

## Luck — Drop Influence

- **Quality floor (sqrt curve)** — `qFloor = clamp(⌊sqrt(luckTotal) · LUCK_QUALITY_FLOOR_SCALE⌋, 0, 99)` — canonical at [Drop Floor](::drop-floor)
- **Quality roll** — `q ∼ U[qFloor, 100]` (uniform integer) — canonical at [Drop Floor](::drop-floor)
- **Dice roll minimum** — `effectiveMinFace = max(1, ⌊luckTotal · LUCK_DICE_FLOOR_SCALE⌋)` — canonical at [Dice Roll Minimum](::dice-roll-minimum)
- **Slot-count modulation** — `effectiveWeight[n] = baseWeight[n] · (1 + α·qNorm + β·lvlNorm + γ·luckNorm)^(n − 2)` — canonical at [Slot Count Modulation by Quality, Level, and Luck](:::slot-count-modulation-by-quality-level-and-luck)

## Loot — Drop Pipeline

- **Drop pipeline (flow)** — `kill → dropChanceGate → weaponVsDice → typeRoll → slotCountOrFaceRoll → perStatQualityRoll → m → applyToStat → spawn` — canonical at [Drop Pipeline](::drop-pipeline)
- **Drop-chance gate** — `dropChance = clamp(BASE_DROP_CHANCE + LUCK_DROP_BONUS·luckNorm + TIER_DROP_BONUS·tierNorm, 0, MAX_DROP_CHANCE)`; a base drop occurs when `roll ∼ U[0, 1) < dropChance` — canonical at [Bonus Drop](::bonus-drop)
- **Elite extra drops** — `extras = ELITE_DROP_COUNT_BONUS` per elite kill — canonical at [Elite Extra Drops](::elite-extra-drops)
- **Voidcrawler quality override** — `q = clamp(80 + U[0, 20], 80, 100)` — canonical at [Voidcrawler](::voidcrawler)

## XP & Leveling

- **XP grant per kill** — `xp = floor(enemy.level² × qualityMult × deltaMult)` — canonical at [Leveling & XP](::leveling-xp)
- **Delta modifier** — `delta = enemy.level − hero.level`; `deltaMult = clamp(1 + delta × xp.deltaScale, xp.deltaMin, xp.deltaMax)` — canonical at [Leveling & XP](::leveling-xp)
- **XP threshold lookup** — `xpRequired(N) = cumulative[N-1]` — canonical at [Leveling & XP](::leveling-xp)
- **XP bar progress** — `progress = clamp((xp − prev) / (next − prev), 0, 1)` — canonical at [Leveling & XP](::leveling-xp)
- **Level-up progress (Hero)** — `xpProgress(L) = clamp((xp − cum[L−1]) / (cum[L] − cum[L−1]), 0, 1)` — canonical at [Hero Level](::hero-level)
- **Curve Phase 1 (L1–39)** — `kills(N) = 300 × 1.0705^(N−1)` — canonical at [XP Step Costs (Levels 1–99)](::xp-step-costs-levels-1-99)
- **Curve Phase 2 (L40–99)** — `step(N) = round(step(39) × 1.06^(N−39))` (geometric, anchored at L39; strictly monotonic, no L40 cliff) — canonical at [XP Step Costs (Levels 1–99)](::xp-step-costs-levels-1-99)
- **Per-step XP (Phase 1 only)** — `step(N) = round(kills(N) × N²)`; Phase 2 uses the geometric form above — canonical at [XP Step Costs (Levels 1–99)](::xp-step-costs-levels-1-99)

## Enemy — Spawn & Level

- **Enemy level by distance** — `level = max v such that dist(spawn, heroStart) ≥ cum[v]` — canonical at [Enemy Level](::enemy-level)
- **Per-stat enemy scaling** — `stat = baseStat · factor^(level − 1)` — canonical at [Enemy Level](::enemy-level)
- **Collision overlap resolution** — `overlap = 2R − d`; each [Enemy](:enemy) pushed `overlap/2` along `(Δ/d)` — canonical at [Collisions](::collisions)
- **Spawn exclusion radius rejection** — spawn attempts within `ENEMY_SPAWN_EXCLUSION_RADIUS` of any cached prior-enemy spawn position are rejected (up to 10 retries) — canonical at [Spawning](::spawning)

## Misc

- **Damage text alpha fade** — `alpha = 255 · (1 − progress)` — canonical at [Damage Text](::damage-text)

---

## Drop Weights & Distribution Tables

> Every weighted distribution and stat-coefficient table, indexed by canonical anchor. Totals (`Σ`) and per-row percentages are NOT restated here — follow the link.

### Loot — Drop Weight Tables

- **Stage 1: Weapon vs Dice ratio** — keys `WEAPON_DROP_WEIGHT` / `DICE_DROP_WEIGHT` — canonical at [Drop Roll](::drop-roll)
- **Stage 2a: Weapon Type weight table** — 10 rows — canonical at [Drop Weights — Weapon Type](::drop-weights-weapon-type)
- **Stage 2b: Slot Count base weight table** — 5 rows (slots 2..6) — canonical at [Drop Weights — Slot Count](::drop-weights-slot-count)
- **Stage 2b: Slot Count modulation by Q / L / Luck** — formula + tunables `α`, `β`, `γ` — canonical at [Slot Count Modulation by Quality, Level, and Luck](:::slot-count-modulation-by-quality-level-and-luck)
- **Stage 2c: Dice Face weight table** — 10 rows (d4..d100) — canonical at [Drop Weights — Dice Face](::drop-weights-dice-face)
- **Drop-chance gate** — `BASE_DROP_CHANCE`, `LUCK_DROP_BONUS`, `TIER_DROP_BONUS`, `MAX_DROP_CHANCE`, `LUCK_DROP_REFERENCE` — canonical at [Bonus Drop](::bonus-drop)
- **Stage 4: Elite extra drop count** — `ELITE_DROP_COUNT_BONUS` — canonical at [Elite Extra Drops](::elite-extra-drops)
- **Drop-weight invariants (integer, ratio semantics, per-family independence)** — canonical at [Drop Weight Notes](::drop-weight-notes)

### Quality / Tier Multiplier Tables

- **Tier Multiplier Reference (4 families)** — `qualityMult`, enemy stat multiplier, visual scale, [Outline Intensity](::outline-intensity), vendor price multiplier — canonical at [Tier Multiplier Reference](::tier-multiplier-reference)

### Weapon / Dice Per-Level Coefficients

- **Per-stat level multiplier table (5 stats)** — `damage`, `aps`, `critChance`, `critMult`, `range` — canonical at [Weapon Per-Level Multipliers](:::weapon-per-level-multipliers)

### Dron Multiplier Probabilities

- **15-tier Dron probability + multiplier list** — name, example roll, probability, multiplier, visual per tier — canonical at [Tiers](::tiers) (entries [Hexadron](:::hexadron) ×40 through [Voidron](:::voidron) ×1)
- **Dron detection precedence** — top-down highest-tier-first walk — canonical at [Detection Order](::detection-order)
- **Dron float dedup / always-show split** — per-slot dedup rules + 5 always-show tier list — canonical at [Float Label Dedup](::float-label-dedup)

### Luck — Tunables

- **`LUCK_QUALITY_FLOOR_SCALE` (sqrt curve)** — quality floor scale — canonical at [Drop Floor](::drop-floor)
- **`LUCK_DICE_FLOOR_SCALE`** — dice roll minimum scale — canonical at [Dice Roll Minimum](::dice-roll-minimum)

### XP — Step Cost Table

- **Per-level step cost (Levels 1–99)** — full 99-row table loaded as cumulative thresholds at startup — canonical at [XP Step Costs (Levels 1–99)](::xp-step-costs-levels-1-99)

### Glossary Quick-Reference Bundles

- **Hero / Enemy / Item / UI default-value sheet** — bulk numeric quick-lookup under SSOT disclaimer — canonical at [Appendix A — Reference Data](:appendix-a-reference-data)

---

---
