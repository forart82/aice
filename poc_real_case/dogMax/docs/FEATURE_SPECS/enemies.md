# Enemies Feature Spec

Updated: 2026-07-18

## Current World Behavior

- The farm-and-path authored world uses `OPENING_REGION_ENCOUNTER_COUNT: 0`.
- No authored enemies spawn in a normal new run.
- The earlier scout, d4 gate, group of three, road encounters, lake encounter,
  patrol placements, and Gloamwood population are superseded with the removed
  Region 1 composition.
- Enemy combat, loot, AI, special-kind, collision-separation, spatial-query,
  and high-density LOD systems remain available for later approved slices.
- The diagnostic `--perf-enemies=N` population remains available and is not an
  authored world encounter.

## Next Approval Boundary

Do not place a regional enemy encounter until the owner explicitly adds and
approves the world element that should contain it.
