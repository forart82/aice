# Current Game State

Updated: 2026-07-22

This is the short factual snapshot of what dogmax is today. Git history remains
the authority for exact implementation details.

## Project State

- C++23 / SFML 3 game with bespoke SFML UI.
- Fixed-step simulation, interpolated camera/actors, world-space ground UVs,
  alpha-safe mipmaps, and GPU-only bloom are active.
- Archive material is reference-only. Runtime source and flat YAML configs are
  the shipped truth.

## Shipped Core

- Hero movement, camera follow, dash charges, pickup, XP, level scaling, HP,
  death/restart, weapons, dice sockets, Dron patterns, loot, luck, powder,
  inventory, crafting, and the Vital Tank exist.
- Enemies have combat AI, attacks, alert calls, collision, death/loot, special
  behaviors, high-density LOD, and spatial-grid queries.
- Dark-neon world/UI rendering, health bars, damage feedback, fog, audio,
  debugging tools, component showcase, enemy design editor, and continuous
  in-game world environment editor exist.
- The 5000-enemy benchmark remains available through `--perf-enemies=N` and
  `--perf-report-path=PATH`. Offscreen visual checks can set deterministic
  camera zoom and a diagnostic hero position.

## Current World Slice

- `docs/visuals/region1.png` is the confirmed Region 1 layout. Purple means the
  starting farm, brown means paths, green means forest/natural mass or boundary,
  blue means water, tan means cultivated/human-made space, and transparent black
  means undefined space.
- Only the purple farm and complete brown path network are live. The main route
  follows the image from the farm to its top edge, and the one right branch is
  present at the same relative junction.
- The building-free farm is a normal editable WorldEditor stamp, initially
  6000 by 4000 world units and centred at world origin. Old farm, cart,
  well, path, and environment movement constraints are removed temporarily;
  the hero and enemies can move anywhere while the authored world is rebuilt.
- The existing path centreline was migrated losslessly into the live world
  environment model. The player can move through the farm, main corridor, and
  branch.
- Green, blue, tan, and every additional mapped region remain unapproved. Live
  gallery QA has saved one direct image stamp and seven dead-tree catalog
  stamps around the farm; treat these as editor-test placements until the owner
  explicitly accepts or removes them.
- Ctrl+M pauses gameplay and edits continuous paths, stackable transparent
  polygon floors/zones, and freely transformed scenery stamps directly against
  the real renderer with explicit z-order. Its separate gallery has a large
  searchable `assets/` hierarchy browser and a top-docked small recent-five
  working mode; selected thumbnails remain active until deselected.
  WASD/arrows move the editor camera, Alt+Q closes and returns it to the hero,
  and Alt+Shift+W/C reveal walkability and collision-authoring metadata.
  A compact desktop-style File/Edit/View/Help menu and icon tool bar expose the
  main workflow, with hover guidance and a categorized scrollable action list that
  follows the active tool or selected world element;
  categorized full Help remains available on Alt+H/F1. Selecting a parent Gallery
  folder shows images from its complete child tree. WorldEditor can zoom out five
  times farther than gameplay, and selected stamp outlines use their transformed
  visual bounds rather than the stamp's ground anchor.
  All editor commands still use Alt+A-Z, with Shift selecting paired actions;
  Alt+S saves atomically to `configs/world_editor.yaml`. Grid-relative and
  nearby edge/centre magnetic snapping keep zones and stamps aligned without
  jumping away from their grab point. Existing zones can be moved directly in
  either Select or Zone mode. Empty-space dragging creates
  a multi-object marquee selection, and compatible commands apply to the whole
  group. Paths default to the geometry-locked worn-farm-track 6x6 atlas.
  Free-form clicked points remain intention data while a separate live resolver
  chooses among the atlas's populated straight and curve cells, repeats whole
  modules for long spans, and joins measured painted ports and their measured
  headings exactly. Shared port
  planes prevent seam gaps/overdraw, and self-overlapping candidates are
  rejected. The closest attainable endpoint wins, and changing the atlas
  rebuilds the same intention under the new atlas's available shapes. Runtime
  screenshots remain the spatial and visual approval authority. The Enemy tool
  places all seven configured enemy identities as persistent, selectable authored spawns;
  they support marquee/group movement, snapping, duplicate/delete, and undo/redo.

## Known Product Gaps

- The clockwise farm orientation, path connection, complete main curve, and
  right branch need owner approval before another mapped element is authored.
- Forests, natural boundaries, water, cultivated/human-made areas, scenery,
  enemies, landmarks, and later regions are intentionally absent.
- Loot comparison/filtering and some special-enemy identities still need clearer
  player-facing communication.
- Audio remains incomplete compared with the intended world and combat density.
- Authored walkability and collision metadata is intentionally visual-only until
  enough of the world has been composed to reintroduce traversal boundaries.

## Daily Development Constraint

Prefer one clear player-visible improvement and one verification path per
session unless the owner explicitly asks for a larger replacement.
