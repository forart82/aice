# World Feature Spec

Updated: 2026-07-22

## Current Behavior

- `docs/visuals/region1.png` is the authoritative Region 1 composition.
- The live authored world contains only its purple starting farm and brown path
  network.
- The farm is a normal editable stamp, initially 6000 by 4000 world units,
  building-free, centred at world origin, and anchored at its visual centre.
- The hero starts at the farm centre. Legacy farm, path, well, cart, and authored
  environment movement restrictions are removed while the world is rebuilt;
  hero and enemy movement is temporarily unrestricted by environment geometry.
- The main path and right branch use editable continuous world-space control
  points. Their dirt texture has feathered edges.
- No tiled world floor, fence, forest, natural boundary, lake, cultivated area,
  construction, sign, transition, or authored encounter is approved. One
  direct gallery image and seven dead-tree catalog stamps are saved as live
  editor-QA placements, not accepted Region 1 composition.
- World rendering remains direct 2D SFML with interpolated camera and actors.

## In-Game Editing Contract

- Ctrl+M opens a modal continuous-world editor and pauses simulation. It is not
  a tile editor.
- Paths support editable/movable intention points, insertion, width, alpha,
  walkability metadata, atlas selection, and explicit z-index.
- The material catalog may pair one repeating zone floor with one compatible
  6x6 path atlas. Alt+M cycles the same named environment style for paths and
  zones, while three-field legacy materials and direct gallery assets remain
  available. Every paired atlas is compatibility-checked when the renderer
  loads, so an invalid style fails clearly instead of appearing in the editor.
- Paths default to `worn_farm_track_modules_6x6_hq_v2.png`; another square 6x6 gallery
  atlas using the same row-major grammar can replace it. Cell 0 is straight and
  cells 2-11 are two-port curve alternatives whose painted headings are
  measured independently. Only populated cells are available to the resolver,
  so a straight-only atlas can only produce a straight path. Clicked points
  remain unchanged as player intention data. Starting with the second point,
  the renderer rebuilds a separate resolved module chain, automatically choosing
  straight or curved cells that best follow the intention. Painted port
  positions and directions are measured from each cell: every module begins at
  the preceding module's exact exit port and inherits that port's heading. Port
  planes clip and normalize both pieces, so neighboring modules touch without
  gaps or overdraw; candidates that would collide with an earlier non-neighbor
  module are rejected. Cell 0 derives one exact straight axis from its two
  measured ports. Long spans repeat modules, and the final module count is
  whichever places the resolved endpoint at the smallest absolute distance from
  the final intention point. Adding later points or changing the atlas
  re-resolves the complete chain rather than destructively moving the saved
  intention points.
- Choosing a compatible atlas while the Path tool has no selected path arms it
  for the next path. Alt+P continues one selected path from its last point;
  Alt+Shift+P explicitly starts a new one. Each placed or moved point updates
  the module layout immediately.
- Zones support arbitrary polygon points, Ground/Forest/Water/Field/Blocked
  identity, optional material or any gallery image as a repeating floor,
  feather, alpha, walkability, collision metadata, and explicit z-index.
  Overlapping transparent zones are rendered in z-order, so floors can stack.
  Repeated gallery floors use a phase-shifted, softly blended macro-tile to
  suppress obvious repetition without changing source-detail scale. The farm is an ordinary centred ground
  stamp; when it shares a layer with a path it draws afterward and masks the road
  at the authored terrain entrance.
- Scenery stamps support catalog selection or direct asset-gallery placement,
  free placement, movement, uniform/non-uniform scale, rotation, mirroring,
  alpha, Y layer, and live collision radius.
- Alt+Shift+T or the Enemy toolbar button places persistent authored Regular,
  Shocker, Glasswraith, Hexarchon, Tassidean Sentinel, Voidcrawler, and
  Pact-Walker spawns. Alt+N cycles kind. Enemy spawns participate in selection,
  marquee/group movement, snapping, duplicate/delete, undo/redo, save/restore,
  and reconcile live while gameplay remains paused.
- The asset gallery is a separate editor window with two modes. Large mode
  exposes the complete nested `assets/` folder hierarchy, searches filenames
  and folder paths, shows all descendant images when a parent folder is selected,
  lazily loads visible thumbnails, scrolls independently,
  clips every thumbnail row and folder label to its frame, and refreshes from
  Alt+Shift+B or its button. Small mode is docked at the top and shows the five
  most recently used images so repeated construction does not require browsing again.
- Selecting a thumbnail keeps that asset attached to the mouse as a persistent
  brush for repeated click or drag placement. Clicking the selected thumbnail
  again, or pressing Escape outside search, clears the brush.
- Gallery stamps persist their stable `assets/...` path and base world width,
  not a refresh-sensitive list index. Images with green chroma in at least
  three corners are cleaned automatically in both thumbnail and world render;
  ordinary green environment art is left unchanged.
- Selection, empty-space drag marquee selection, select-all, multi-object dragging,
  duplication, deletion, shared compatible property edits, undo/redo, snapping,
  grid size/visibility, camera pan/zoom, save, and restore are live. Movement
  preserves the cursor's grab offset; grid steps are relative to the drag start,
  then nearby object and zone edges/centres align magnetically. A zone can be
  grabbed directly while either Select or Zone is active. WASD or
  arrows move the editor camera, Shift accelerates it, and the editor-only
  zoom-out range is five times the gameplay range for broad composition. Alt+Q
  closes the editor, restores gameplay zoom limits, and snaps back to the hero.
- A compact desktop-style File/Edit/View/Help menu and icon tool bar expose the
  four world tools and common actions without covering the world. Its smaller
  inspector embeds a categorized, independently scrollable action list that
  changes for the active tool, selected path, zone, stamp, point, or group; hovering
  a tool also explains its behavior. Every editor command uses
  Alt plus one letter from A-Z, with Alt+Shift+letter supplying the paired
  reverse or secondary action. Alt+H or F1 opens the categorized complete
  shortcut reference and blocks edits until Alt+H, F1, or Escape closes it.
- Alt+Shift+W independently overlays walkable geometry in green and
  non-walkable geometry in orange. Alt+Shift+C overlays authored blocking zones
  and stamp collision radii in red. The properties persist for future
  reactivation, but neither overlay currently constrains hero or enemy movement.
- Alt+S atomically writes the three flat world values in
  `configs/world_editor.yaml`, mirrors them into the running build, and leaves
  unrelated config overrides untouched. There is no external scene, tile map,
  export pipeline, manual coordinate transcription, or required compile in the
  ordinary world-authoring loop.
- `docs/visuals/region1.png` remains the human composition reference; the actual
  SFML frame is the appearance and placement authority.

## Next Approval Boundary

Approve the farm and complete brown path before implementing any green, blue,
tan, or additional purple element.
