# Roadmap

Updated: 2026-07-19

This roadmap is intentionally small. It is not a kanban replacement. It exists
to prevent the project from becoming an unbounded idea pile.

## Now

Only one active product goal should be worked at a time.

**Current goal: prove the five-minute authored-world loop on Region 1.**

Use Ctrl+M and its large searchable hierarchy gallery to find materials, then
switch to the recent-five gallery and improve one gameplay-screen-sized
path/environment cell in no more than five minutes. Keep a selected thumbnail
as the repeated placement brush, draw overlapping transparent floor zones, set
their z-order, inspect the Alt+Shift+W/C authoring layers, and judge the real SFML
screenshot without editing C++ or transcribing coordinates. Environment
movement constraints remain off during composition. Do not add a green, blue,
tan, or additional purple map element to the saved live world until this exact
loop and path slice are approved.

## Next

- **Loot clarity pass**
  Make item comparison, socket decisions, powder decisions, and filtering faster.

- **Special enemy identity pass**
  Ensure every special enemy has a readable silhouette, threat, and counterplay.

- **Build feedback pass**
  Make Dron patterns, dice multipliers, crit, luck, and kill streaks obvious
  enough that the player can intentionally chase them.

- **Stability/performance guardrails**
  Keep the 5000-enemy harness available and run it before large render/sim
  changes.

- **Weapon attack/range validation**
  Recheck every weapon archetype end to end: target acquisition, attack
  triggering, configured range, and effective hit geometry must agree. Start by
  reproducing the reported dagger behavior where it appears not to attack.

- **Dashbar charge-use visualization**
  Improve how the dashbar communicates charge consumption and recharge so the
  used and refilling portions remain immediately readable in the current HUD.

- **Spatial-audio boundary and direction validation**
  Confirm that sources outside the visible screen are silent and that audible
  sources to the hero's left, right, top, or bottom are spatialized from the
  corresponding direction.

- **Background-music and one-shot coexistence**
  Reproduce the reported interruption where background music stops when another
  sound plays, especially the pickup cue. Verify that music streaming and every
  one-shot sound use independent playback paths, then confirm pickups, dash,
  combat, level-up, and death cues never stop or restart the seamless music loop.
  Preserve the frequency-zoning and mixing contract in
  `docs/FEATURE_SPECS/audio.md`.

- **Enemy combat-feedback outcome QA**
  Visually verify the complete feedback contract in isolated forced states:
  normal hit, heavy/critical hit, evasion, dash invulnerability, simultaneous
  resolutions, and representative thrust, swipe, targeted, and AOE weapon
  archetypes. Confirm amber resolution, cyan avoidance, red-white HP loss,
  count ticks, source direction, and weapon-specific execution geometry agree
  with the actual outcome before treating the combat-feedback replacement as
  fully validated.

## Later

- Audio and music.
- Villages, vendors, NPCs, and faction-like structures.
- Stronger long-run progression outside a single run.
- More authored enemy families and biome/event identity.
- Richer lore delivery around Veros fragments, dice, and the Mother-of-Chaos /
  Tassides-of-Order spine.

## Parking Lot Rules

- New ideas go in `Later` only if they fit the pillars.
- An idea moves to `Next` only when it supports the active product problem.
- An idea moves to `Now` only when it can be implemented and verified as one
  coherent slice.
