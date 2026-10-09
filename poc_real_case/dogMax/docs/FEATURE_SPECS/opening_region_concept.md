# Opening Region — Farm And Path Slice

Status: live approval slice.

[Open the authoritative Region 1 layout](../visuals/region1.png)

[Farm/path connection](../visuals/region1_path_connection_runtime.png) ·
[Right-branch junction](../visuals/region1_path_junction_runtime.png)

## Confirmed Layout Legend

- Transparent black: undefined space.
- Purple circle: starting farm.
- Brown line: road/path network.
- Dark green fill or line: forest/natural mass or boundary.
- Blue oval: water.
- Tan rectangle: cultivated or human-made area.

These meanings were confirmed by the owner on 2026-07-18. The PNG is the
authoritative composition for Region 1.

## Current Player-Facing World

Only two mapped elements are live: the purple starting farm and the complete
brown path network. The farm is centred at world origin, building-free, rotated
90 degrees clockwise from the previous approval slice. All old farm, cart,
well, path, and authored-environment movement restrictions are temporarily
removed while the world is composed in-game.

The brown geometry has been migrated into editable continuous world-space
control points. It contains the complete curved main route from the farm to the
top edge and the single right branch exactly where it separates in the image.
Players and enemies can currently walk anywhere. Ctrl+M can adjust path shape
directly against the live renderer without manual transcription, while
Alt+Shift+W/C show saved walkability and collision-authoring metadata that will later
define deliberate traversal boundaries.

No green forest/boundary, blue water, tan cultivated/construction area, fence,
sign, scenery, enemy encounter, or transition is live.

## Approval Boundary

Do not implement another Region 1 color or element until the owner approves the
farm rotation, path connection, full route shape, and right branch in the 2D
game.
