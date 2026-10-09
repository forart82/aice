# Decisions

This file records product and workflow decisions that should survive context
loss. Keep entries short.

## 2026-07-22: Resolve Paths From Intention Through The Selected Atlas

Why:
Directly treating every click as final geometry produced stretched spans,
manual curve modes, and connections that did not respect the painted modules.

Decision:
Keep player clicks as immutable intention points. From the second point onward,
automatically rebuild a connected chain from the populated straight and curve
cells in the selected 6x6 atlas. Measure each painted port's position and
heading, join exit to entry on one clipped shared plane, reject non-neighbor
collisions, repeat whole modules for distance, and choose the attainable
endpoint with the smallest absolute error. Rebuild from the original intentions
whenever points or atlas selection change.

Use atlas alpha as the single scan-and-render geometry authority. Two-port cells
declare connectivity only; their painted silhouettes command the actual port
positions and headings. Reject cells whose opaque road mask enters the required
cell-edge guard. Higher-detail atlas revisions must preserve the approved alpha
geometry exactly, while a shared port profile normalizes both alpha and color at
every connection.

Tradeoff:
The resolved road may move away from the exact cursor trace, and an atlas with
fewer populated shapes deliberately produces a more constrained path.

## 2026-07-19: Treat Farm And Enemies As Ordinary WorldEditor Data

Why:
The fixed farm renderer and separate encounter-only enemy configuration made
core world content impossible to manipulate through the normal authoring loop.

Decision:
Persist the start farm as a centred ground stamp and individual enemy spawns as
WorldEditor elements. Default every path to the worn-farm-track module atlas,
whose topology chooses its straight, corner, junction, crossroad, and end-cap
art. Keep the compact recent-assets Gallery at the top of the viewport.

Tradeoff:
Farm deletion and enemy repositioning are now deliberate editor actions, so
undo/restore and atomic save are the recovery path instead of protected
special-case runtime code.

## 2026-07-19: Author The Continuous World In-Game

Why:
Creating one world element through isolated image generation, manually copied
coordinates, C++ rendering changes, compilation, and screenshots took more than
an hour while still producing repetitive, disconnected scenery. Tile-oriented
editors also do not match dogMax's curved, painterly, continuous world.

Decision:
Use a deliberately narrow in-game Ctrl+M authoring mode as the sole live
environment workflow. Edit smooth paths, organic polygon zones, and freely
transformed complete scenery stamps against the actual SFML world; share that
one model with rendering and collision, and save it atomically as flat YAML.
Browse the real `assets/` hierarchy in a separate searchable large gallery,
then switch to a compact recent-five gallery while composing. A selected image
remains a persistent placement brush until its thumbnail is clicked again or
the brush is cancelled. Gallery images can become either freely placed scenery
or repeating polygon floors; transparent floors stack through explicit z-order.
Persist asset paths rather than gallery indices so refresh and folder changes
cannot alter existing placements. Keep walkability and collision as separate
toggleable authoring overlays, but temporarily remove their runtime movement
effect—including the old farm, cart, well, and path restrictions—until the
world has been deliberately rebuilt.
Keep `region1.png` as the human composition reference, not a runtime parser or
manual coordinate-transcription source.

Tradeoff:
The project owns a larger two-mode editor surface and its persistence contract, but an
ordinary camera-sized world edit no longer requires C++, compilation, external
scene conversion, or AI interpretation of exact geometry. New visual kit art
remains a separate art-directed task; the editor accelerates composition but
does not make mismatched assets acceptable. During this temporary authoring
phase the game has no environment traversal boundaries, so collision must be
reactivated deliberately from the new metadata rather than restoring legacy
farm-specific mechanics.

## 2026-07-18: Make region1.png The Region 1 Layout Authority

Why:
The owner can communicate the fixed world reliably through one simple colored
image and wants each mapped element approved in isolation before composition
continues.

Decision:
Use `docs/visuals/region1.png` as the authoritative Region 1 composition.
Purple is the starting farm, brown is the path network, dark green is forest or
natural boundary, blue is water, tan is cultivated or human-made space, and
transparent black is undefined space. Transcribe the image directly into flat
2D configuration; the current slice contains only the clockwise-rotated farm
and the complete brown main path plus right branch.

Tradeoff:
The PNG does not encode final artwork or collision by itself, so source-pixel
scale and centreline points are recorded explicitly in YAML and verified with
runtime screenshots. No other color may be implemented before the path is
approved.

## 2026-07-18: Remove Blender From World Production

Why:
The owner wants the fixed 2D world built and judged directly, without a 3D
scene or export step between an abstract edit and the game.

Decision:
Remove the active Blender scene, exporter, build command, generated layout
YAML, and review render. Keep a simple colored layout image for human
communication, edit matching live placement directly in
`configs/world_opening.yaml`, and use 2D runtime screenshots as the spatial and
visual authority.

Tradeoff:
There is no 3D overview or automatic image-to-runtime conversion, but the world
workflow is smaller, explicit, and aligned with the actual SFML presentation.

## 2026-07-18: Reset World Composition To The Farm Only

Why:
The full Region 1 composition had become visually and spatially confused, so
adjusting more dependent elements would make the baseline harder to judge.

Decision:
Remove the path, fences, tiled exterior floor, lake, forest, signs, scenery,
region transition, and authored encounters. Keep only the building-free farm
plate, centred at world origin at its existing physical scale and orientation,
with fitted cart and well collision. Rebuild outward one owner-approved world
element at a time.

Tradeoff:
The playable journey and combat population are temporarily absent, but the
project regains one clear composition authority. This decision supersedes the
live implementation portions of the older Region 1 decisions below; those
entries remain only as history.

## 2026-07-18: Make The Opening Farm Building-Free And Path-Facing

Why:
The fixed world can now be composed one element at a time, and the farmhouse,
barn, old fence arrangement, and farm orientation made the farm entrance fight
the authored outgoing trail.

Decision:
Remove both farm buildings and their live render/collision/configuration paths.
Rotate the approved farm plate and its collision anchors exactly 90 degrees
counter-clockwise around the hero/farm origin, preserve its physical scale, and
replace the old boundary with proportionally scaled short fence panels whose
north-side opening meets the first trail segment.

Tradeoff:
The opening loses two large landmarks, but gains a cleaner farm composition and
an entrance that reads in the same direction as the fixed path.

## 2026-07-18: Use A Primitive Map As Region 1's Human Layout Contract

Why:
Painted concept images and raw coordinate lists were difficult for the owner to
edit precisely or communicate back through a later AI session.

Decision:
Use a simple colored image as Region 1's human-editable layout contract.
Rectangles mean human constructions or cultivated plots,
circles mean zones/groups/encounters, and lines mean routes, boundaries, or
repeated sequences; color disambiguates the subtype through the embedded
legend. Stable IDs, `data-kind` values, and a fixed map scale make later edits
interpretable; matching runtime placement is authored directly in flat YAML.

Tradeoff:
The abstract map cannot communicate final materials or atmosphere, but it makes
topology and placement easy to revise while the live raster atlas and SFML
screenshots remain the visual-quality authority.

## 2026-07-18: Simplify Region 1 Around Four Strong 2D Scenes

Why:
The complete river-and-waterfall chain, constant 70-metre corridor, full lake
circuit, mountain enclosure, and early Region 2 reveal spread the art effort
across too many dependent landmarks before one gameplay screen reached an
acceptable visual standard.

Decision:
Replace that target with an authored hybrid-2D region built around the opening
farm, connecting trail, optional Shroudwater shore, and Gloamwood entrance. Keep
two fields, the opening attack, one signed junction, eight
lake enemies, small fishing jetty, fixed encounters, permanent clears, natural
limits, and full backtracking. Remove both waterfalls, the continuous river,
river bridge, complete lake circuit, long boardwalk, boat, full burned-village
reveal, interiors, continuous mountain enclosure, minor branches, and excess
signage from the replacement target. Use 60–70 metre major combat clearings but
20–35 metre travel spaces instead of making the whole journey equally wide.

Tradeoff:
The world loses several spectacle landmarks, but the smaller asset vocabulary
allows deliberate composition and much higher visual quality. Approve one final
gameplay-scale farm screen before extending the art language to the rest of the
region.

## 2026-07-18: Author The World And Its Enemy Population

Why:
The generated road and continuous enemy spawning made the opening difficult to
compose, read, and remember. They also weakened the consequence of choosing a
route because threats could be recreated around or behind the player.

Decision:
Region 1 and the first ten minutes use one fixed farm-to-Gloamwood layout with a
single optional Shroudwater branch, natural corridor limits, full backtracking,
and fixed enemy populations at fixed initial positions. Enemies activate through
opening gates or region proximity, may patrol and reposition defensively, never
respawn, and never silently despawn; only death loot remains dynamic. Future
regions should follow authored one-direction journey logic unless a later
explicit decision replaces it.

Tradeoff:
Authored regions require deliberate layout, encounter, and asset work instead
of seed variation, but gain reliable pacing, storytelling, visual composition,
and persistent player consequence.

## 2026-07-14: Use One Stable World Presentation Pipeline

Why:
At low zoom, high-frequency floor, fence, and farmhouse texels changed sampling
phase while the camera moved. Linear filtering alone could not represent many
source texels per screen pixel, camera snapping introduced visible steps, and
CPU framebuffer bloom amplified brightness changes and frame stalls.

Decision:
Render the world into an integer physical-pixel surface and present it 1:1,
while the UI remains separate. Follow render-interpolated positions without
world pixel snapping, anchor repeating UVs in world space, generate alpha-safe
mipmaps for painted world assets, and run bloom only through GPU render passes.
The removed snapping and CPU-bloom implementations are not compatibility modes.

Tradeoff:
Startup performs texture dilation and mip generation, and bloom owns several
GPU buffers, but motion remains stable across zoom and avoids per-frame GPU-to-
CPU readback.

## 2026-07-14: Keep The Opening Mundane Until The Attack

Why:
The Farmer was incorrectly presented as beginning beside a reactive Veros wound,
which made him appear connected to or knowledgeable about the supernatural event
before the run starts.

Decision:
The Farmer begins in an ordinary farm and is attacked by something he does not
understand. He grabs the nearby Pitchfork as an improvised survival response;
the wider Veros and dice lore is discovered later. The eastern yard contains a
normal stone-and-timber well, not a magical site.

Tradeoff:
The opening loses an immediate occult landmark, but gains a clearer escalation
from ordinary life into unexplained danger.

## 2026-07-13: Opening Loot Must Be Weak But Playable

Why:
The old `q/100` quality factor allowed level-one weapon stats to retain almost
none of their base value, producing 1-damage drops beside a 10–15 damage
starter. Higher-face dice were also forced toward longer roll times even though
face count should describe result range, not physical roll duration.

Decision:
Interpolate item quality from a configured 0.65 playable baseline to 1.0, keep
a 5-damage weapon safety floor, and give critical and dice multipliers useful
minimums. Roll every die in the same 0.9–2.4 second range regardless of face
count; lower roll time is always better. The first Scout death is a separate
teaching contract: it drops exactly one d4 with a fixed 1.2-second roll and
never creates a second recovery die.

Tradeoff:
Opening Common drops retain meaningful variance but are less disposable.
Weapon archetypes still balance around effective attack output, so multi-hit
and area weapons may show less per-hit damage than the starter.

## 2026-07-07: Add Lightweight Direction Docs

Why:
The project has become too large to steer from memory, a giant spec, archived
kanbans, or git history alone.

Decision:
Use `docs/GAME_PILLARS.md`, `docs/CURRENT_GAME_STATE.md`,
`docs/TARGET_EXPERIENCE.md`, `docs/ROADMAP.md`, `docs/DECISIONS.md`, and
`docs/FEATURE_SPECS/` as the small daily operating layer.

Tradeoff:
This adds a few docs, but avoids returning to giant kanbans or asking the AI to
infer product direction from commit history.

## 2026-07-07: Git Is Current-State Truth, Not Product Vision

Why:
Git history accurately records what happened, but it does not explain what the
game should become next.

Decision:
Use git commits and live source for shipped facts. Use the direction docs for
product intent. Use `GameDesign.md` for detailed design vocabulary. Treat
archives as reference-only.

Tradeoff:
Future AI sessions must consult more than one source, but each source has a
clear job.

## 2026-07-07: No Large Kanban Revival

Why:
The old kanban workflow created too much process overhead and too many parallel
ideas for a project with limited daily human attention.

Decision:
Use the roadmap's `Now / Next / Later` structure. Keep exactly one active
product goal in `Now`.

Tradeoff:
This sacrifices fine-grained task inventory in favor of better focus.

## 2026-07-07: Optimize For One-Hour Sessions

Why:
The owner usually has about one hour per day and limited concentration for this
project.

Decision:
Default each session to one player-visible improvement, one verification path,
one commit, and one short doc update only if direction changed.

Tradeoff:
Some large features will take multiple slices, but the project remains easier to
resume after interruptions.

## 2026-07-07: Prefer Earned Discovery Over First-Run Tutorials

Why:
The game should reward players who invest attention and experiment. A dedicated
first-run guide risks flattening discovery and can make the opening feel like
instruction-following instead of play.

Decision:
Do not use a standalone first-run tutorial overlay. Put global utility access in
one compact vertical info-bar icon stack with hover names, put those same icons
in the non-functional `Ctrl+H -> Icons` library for recognition, and put action
hints at the bottom of the specific menu window where those actions matter.

Tradeoff:
Some players will take longer to understand the systems, but the players who do
learn them are more likely to feel ownership of that knowledge.

## 2026-07-08: Codex Workflow Prioritizes Guided Single-Slice Work

Why:
The earlier Claude workflow used aggressive parallel agents and broad task
fan-out. That produced throughput, but it also expanded the project size and
architecture too quickly for the owner to keep a clear overview with limited
daily time and concentration.

Decision:
Codex should use `AGENTS.md` as the compact project guidance layer. Default to
one main-thread slice, one active product goal, and no mandatory parallel
editing agents. The assistant's job is to guide the owner, protect the overview,
and use the direction docs as the daily map.

Tradeoff:
This sacrifices some parallel speed in favor of control, clarity, and easier
resumption after interruptions.

## 2026-07-09: Keep The Dark-Neon Cockpit HUD Art Direction

Why:
The generated bitmap HUD frame and darker neon texture pass make the game feel
less like a prototype and more like its own horde ARPG. The UI still needs to be
fast to read under pressure, so the art pass cannot become decorative clutter.

Decision:
Use a dark-neon cockpit HUD direction for player-facing combat UI. Generated
bitmap frames may provide the material and silhouette language, but live SFML
widgets remain responsible for readable state. The player info bar should keep a
full-width XP rail, weapon-slot bays, a compact health pool, small stat modules,
and a docked inventory/filter/DiceCrafter/help iconbar.

Tradeoff:
This commits to a stronger visual identity, but future UI work must check
screenshots so texture, glow, text, icons, and gameplay state do not overlap or
reduce readability.

## 2026-07-11: Enforce One Authoritative Implementation

Why:
Repeated redesigns and mechanic changes can leave superseded live paths hidden
behind newer layers. A later wiring or configuration change can then expose old
behavior again.

Decision:
Audit the complete live codebase, not only rendering. Every mechanic, state
transition, calculation, interaction, AI behavior, and visual result must have
one authoritative implementation. Required technical fallbacks must reproduce
the current behavior; obsolete code, configs, and assets are removed.

Tradeoff:
The audit must proceed by verified subsystem slices because deleting paths based
only on similar names would risk removing intentional platform fallbacks or
distinct gameplay responsibilities.

## 2026-07-12: Separate Enemy Facts From Immediate Danger

Why:
At ordinary swarm size, full enemy equipment cards and long-lived weapon VFX
obscured the hero while still failing to match the direct range-checked enemy
hit contract. Weapon cooldown bars also looked like attack countdowns even
though a ready weapon could remain held indefinitely.

Decision:
Keep persistent enemy information compact: a slim health bar, a relative-level
warning only above the hero's level, distinct weapon and dice symbols, and one
yellow segment per ready weapon. Imminent armed attacks use a separate red
language that marks the attacker and tightens on the hero during the real
wind-up; actual HP loss produces a short hero-centred impact confirmation.
Weapon-shaped enemy post-hit VFX must not imply geometry the damage mechanic
does not enforce.

Tradeoff:
The swarm view no longer exposes exact enemy HP, item names, dice faces, or
cooldown progress. Those details remain inspector-level information so combat
can prioritize health state, relative danger, equipment presence, readiness,
and immediate threats.

## 2026-07-13: Enemy Attack Feedback Answers Outcome And Direction

Why:
Dense combat can resolve several attacks in the same fraction of a second.
Independent identical flashes do not tell the player how many attacks resolved,
where they came from, or whether they were avoided versus damaging.

Decision:
Merge near-simultaneous enemy resolutions into one hero-centred signal: amber
means attack resolution, radial ticks show count, and one directional notch
shows the averaged source direction. Cyan means evaded or dash-invulnerable;
red-white means HP loss, with heavier and critical impacts gaining intensity.
When many enemies wind up together, common warnings dim while elite and special
warnings retain priority. Enemy reach is weapon-specific rather than one global
bonus, while dropped items preserve their real range.

Tradeoff:
A merged signal deliberately summarizes a burst instead of identifying every
individual attacker. Persistent attacker rings and weapon-specific spatial
execution sounds retain local identity without restoring crossing beams.

## 2026-07-13: Mount Vitality Below The Utility Bay

Why:
Placing a second tank beside the red HP tank crowded the most important combat
readout and weakened the established left health-core silhouette. The lower
chassis region marked in `Screenshot_2026-07-13_16-50-43.png` already provides
a readable manufactured bay without displacing another live instrument.

Decision:
Mount the Vital Tank horizontally beneath the utility wall and first weapon
slot. Keep HP and its dash-core assembly unchanged. The Vital Tank uses reddish
fluid, an integrated `Q` terminal, and live fill/consume feedback; it never
returns to a side-by-side or dual-tank health-core layout.

Tradeoff:
Vitality is farther from the HP percentage than a combined health module would
be, but both remain in the same continuous infobar and the primary health state
keeps its existing clarity.

## 2026-08-08: Build The World From Zero In Code-Drawn Neon Geometry

Why:
The visual identity pass opened on the premise that dogmax had to live with
photoreal world art it could not replace — "existing photoreal textures are
darkened and flattened by shader and tint, not replaced" — because the asset
supply was the binding constraint. Steps 1 and 2 built a full-screen
`WorldGradePipeline` to crush that art toward dark-neon. It never fully worked:
no per-pixel test on a composited frame can separate a mid-bright photoreal
texture from a dim additive glow of the same hue, so every gate tight enough to
kill the corn crop also ate the game's soft-glow language, damage text and
attack VFX. The owner emptied the world instead and chose to author it fresh in
the dark-neon language.

Decision:
The world is built from zero as code-drawn neon geometry — ground, paths and
props are shapes plus neon strokes emitted by the renderer from config, not
textured art. There is nothing photoreal left to correct, so the corrective
grade pass is gone: `WorldGradePipeline`, `world_grade.frag` and every
`WORLD_GRADE_*` key are deleted. Enemy shape specs
(`EnemyShapeCatalog::buildEnemyShapeOutline`) are the shared primitive, so the
world is drawn in the same language as hero and enemies rather than a parallel
system.

Tradeoff:
The WorldEditor's texture-driven stamp catalog no longer matches what the
renderer wants — code-drawn props need a shape-id-plus-parameters record where
the schema currently holds a PNG path, so the catalog and its editor UI have to
change. Existing photoreal assets under `assets/textures/world/` stop being the
art path. In exchange the asset-supply constraint disappears entirely, the world
matches the accepted hero/enemy treatment for free, and one whole post-process
stage leaves the frame.

## 2026-08-20: Adopt Strict TDD + The Oracle SSOT, Retargeted To C++/SFML

Why:
The project had no test framework, no test suite, and an explicit rule forbidding
proactive tests — a rule that made sense while the game was an exploratory
rebuild, and that becomes untenable the moment commercial release is the goal. A
horde ARPG whose damage, luck, levelling and drop curves are all pure functions
is unusually well suited to testing, and leaving that untested was giving away
the one advantage a deterministic, fixed-timestep, seeded-RNG codebase has.

The ruleset was imported from the dogV6 project's first commit (`0c8259a`), where
it was written for TypeScript/Phaser/Vitest. Every technology binding was
retargeted to C++23/SFML 3/doctest/CMake; the rules themselves are unchanged in
force.

Decision:
`AGENTS.md` (the 15-rule TDD protocol) and `ORACLE.md` (the Single Source of
Truth for mechanics and formulas) are now the binding authorities for this
project, above `CLAUDE.md`. No production code is written without a failing test
first. Every feature carries a spec in `docs/tdd/`. Every task passes `./verify`
— tests built with warnings-as-errors, run headlessly through CTest, then a clean
release build — before it is committed.

This **revokes** the previous rule that tests are written only in response to a
bug and that no standing suite is maintained. The two are exact inverses; the
reversal is recorded in `CLAUDE.md` and `ORACLE.md` rather than being quietly
overwritten, so future readers can see that the change was deliberate.

Three rules were re-scoped rather than copied as theatre, because they were
written for a browser game and are simply false for a native SFML build:
smartphone safe-areas (SFML has no supported web target and only experimental
Android), the browser audio-unlock lifecycle (replaced with resource release on
focus loss), and the web/Capacitor/Tauri publishing pipeline (replaced with the
actually reachable desktop targets).

Tradeoff:
Every future change costs more up front — a spec, a failing test, then the code.
That is the intended cost: it is what converts "it looked right on my machine"
into something a buyer can rely on. The largest immediate liability this surfaced
is not code but assets: roughly 380 binary files (206 png, 120 ttf, 33 jpg, 19
wav, 2 mp3) have no recorded provenance, and under Rule 7 none of them may ship
commercially until each one's licence is verified or the file is deleted.
