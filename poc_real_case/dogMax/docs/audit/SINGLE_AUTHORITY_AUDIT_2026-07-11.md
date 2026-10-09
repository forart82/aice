# Single-Authority Codebase Audit

Started: 2026-07-11
Status: Active

## Problem

Repeated changes may have added a newer implementation around an older one
instead of replacing it. The newer path can hide obsolete behavior until a
configuration change, missing connection, fallback, or later refactor exposes
the superseded implementation again.

This is a whole-codebase concern, not only a rendering concern. It includes:

- gameplay mechanics and rules;
- AI behaviors and state machines;
- input and interaction handling;
- inventory, equipment, crafting, and loot flows;
- configuration keys and loaders;
- managers, hubs, helpers, and data ownership;
- rendering, shaders, assets, and visual fallbacks;
- debug, compatibility, and experimental paths;
- duplicate models, state, calculations, and sources of truth.

## Authority Rule

Every behavior, mechanic, state transition, and visual result has one
authoritative implementation. A required technical fallback may use a different
rendering mechanism, but it must implement the same current behavior.
Superseded live code, configuration, and assets are removed rather than hidden.

## Evidence Standard

Code is removed or consolidated only when live callers, state ownership,
configuration consumption, and runtime behavior establish which path is
authoritative. Names such as `old`, `fallback`, or `legacy` are discovery clues,
not sufficient deletion evidence.

Each subsystem slice must record:

1. the competing paths found;
2. the authoritative path and why it is authoritative;
3. what was removed or consolidated;
4. verification performed;
5. remaining ambiguity or risk.

Archive material is historical reference and is excluded from live-code
duplication findings.

## Live Path Inventory

The first pass covered compiled sources under `src/`, flat runtime configuration
under `configs/`, runtime assets under `assets/`, build inputs, and current
direction documents. Discovery used call-site searches, configuration-consumer
searches, explicit legacy/fallback markers, duplicate factory entry points, and
runtime render selection branches. Archive and generated build trees were not
treated as live authorities.

## Completed Findings

### Enemy Attack Authority

Two complete attack rules were live behind `ENEMY_WEAPON_COMBAT_ENABLED`.
Weapon-equipped enemies used the current dice-paced weapon system, while
disabling the key restored `Huntable`'s older flat timed melee damage. Unarmed
enemies also changed between that melee path and the current body-charge path.

The armed weapon/dice path and unarmed charge path are authoritative because
they are the current loadout model and are independently configured, rendered,
and exercised by normal enemy spawning. The switch, flat damage/cooldown
configuration, `Huntable` timer state, old hit calculation, and inspector fields
were removed. A dev build, headless smoke, and forced 100-enemy offscreen smoke
passed.

### Dice Creation Authority

`DiceMaker::make` assigned an old random 60/30/10 tier and was retained only as
the starting point for `makeAtLevel`; normal loot used independent per-stat
quality rolls. Consequently console-spawned dice received only partial current
scaling and could expose the older quality model.

The loot quality pipeline is authoritative because both enemy loot routes use
it and it matches the weapon quality model. `make`, `makeRandom`, and the three
old tier-weight keys were removed. Loot and pinned-level cheat dice now share
`buildDice`, which owns all stat, tier, quality, naming, duration, and pickup
initialization. Dev build 163 passed.

### Enemy Body Authority

Every enemy kind has an authored template in `configs/enemies/`, including
`regular.yaml`, but the runtime deliberately passed no template for regular
enemies and drew the older generic shader/polygon body. At 600 visible enemies,
a second performance branch replaced every authored shape with a batched
low-sided disc.

The per-kind YAML templates are authoritative because they are the files edited
by the live enemy design editor and are present for every `SpecialEnemyKind`.
Regular enemies now resolve the `None` template like every special enemy;
missing templates fail clearly instead of silently restoring the generic body.
The alternate disc renderer, its state, and its three config keys were removed.
Dev build 164, headless smoke, and a 100-enemy offscreen render passed; the
stress capture is `/tmp/dogmax-authority-regular.png` and measured 65.566 total
render FPS in the offscreen environment.

## Retained Technical Fallbacks

Shaderless CPU drawing remains in weapon and dice presentation paths. These are
platform/render-capability fallbacks rather than alternate gameplay state, but
their geometry is not yet proven pixel-equivalent to the current shaders. They
remain an art-direction parity risk and should be handled as a focused rendering
slice rather than deleted without a supported no-shader replacement.

The accepted Pitchfork bitmap is now authoritative in inventory cells and the
inventory drag preview as well as for the starter floor pickup. The other nine
weapon types have no bitmap assets in `assets/`; their current shader glyphs
cannot be removed in favor of sprites until those replacement assets exist.

The enemy manager's no-hub spawn interval supports isolated bare-manager tests;
it is not selected by the wired `GameSession`. Alert fallback means movement
toward a broadcast location outside direct chase range, not an older AI model.
Both remain documented rather than deleted because current call and ownership
evidence does not prove them obsolete.
