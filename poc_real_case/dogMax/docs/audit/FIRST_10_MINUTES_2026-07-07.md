# First 10 Minutes Audit — 2026-07-07

## Scope

Product/onboarding audit of the current first-run flow. This is not a code
correctness audit; it checks whether a new player can understand the first loop
without already knowing the game.

## Method

- Captured offscreen no-input screenshots at 1 s, 5 s, and 10 s:
  `/tmp/dogmax-first-1s.png`, `/tmp/dogmax-first-5s.png`,
  `/tmp/dogmax-first-10s.png`.
- Read startup, input, help, pickup, interaction, wave, and render paths:
  `GameSession`, `GameSession_Events`, `GameSession_Render`,
  `GameSession_MouseEvents`, `PickupHub`, `InteractionController`,
  `EnemyManager`, and `assets/help.md`.

## Findings

### 1. Critical: the opening screen does not explain the first action

The first screen shows the hero, a floor item, HUD, and FPS. It does not tell the
player to move, why the floor item matters, how to pick it up, or what the goal
is. At 5 s and 10 s with no input, the scene is still visually static.

Why it matters:
The player can conclude the game is empty or broken before discovering the
starter loop.

Evidence:
The starter Pitchfork is deliberately spawned just outside pickup range:
`STARTER_PITCHFORK_OFFSET: 380` while `ITEM_PICKUP_RADIUS` is 360. This is a good
teaching setup, but there is no teaching layer attached to it.

### 2. Critical: the game is intentionally gated, but the gate is invisible

Enemies do not spawn until the player equips a weapon. The wave system checks the
weapon slots before spawning the first scout. This is correct design, but
invisible to a new player.

Why it matters:
If the player does not know they must pick up and equip the Pitchfork, nothing
pressures them and the horde-game promise does not start.

Evidence:
`EnemyManager::tickWaveSpawning` skips spawning while every weapon row is empty.
`PickupHub::tryAutoPickup` stores the starter weapon into inventory; it does not
equip it.

### 3. High: F1 help exists but is hidden and incomplete for the first loop

The F1 overlay explains movement, Space dash, auto-fire, camera zoom, console,
debug, restart, and quit. It does not explain:

- `I` opens inventory.
- Floor items auto-pick up into inventory.
- Right-click equips weapons and slots dice.
- Drag/drop is supported.
- `F` opens loot filter.
- `G` opens DiceCrafter.
- `X` powders/destroys hovered inventory items.
- The opening goal is to pick up and equip the Pitchfork.
- The D4 slot gate after the scout.

Why it matters:
The help overlay cannot currently teach the actual first 10 minutes even if the
player discovers F1.

### 4. High: pickup feedback is hidden behind a closed inventory

When the hero walks over the starter Pitchfork, it moves into the inventory. The
inventory is closed by default, and the player is not told that pickup succeeded
or that the item still needs to be equipped.

Why it matters:
The player may walk over the item, see it disappear, and not understand that it
became an inventory item.

### 5. High: the first D4/dice lesson is another hidden gate

After the first scout dies, the wave system waits for a D4 to be slotted before
the group wave. There is a 30 s timeout and a D4 re-drop safety path, but no
player-facing explanation.

Why it matters:
This is exactly where the game should teach the dice/build identity. Instead,
the player can miss the point of dice entirely.

### 6. Medium: the HUD does not show the current objective

The bottom bar exposes level, XP, HP, luck, powder, and dash charges. It does not
show the next task or why progression is stalled.

Why it matters:
The game has a strong sequence already: get Pitchfork, equip it, kill scout, slot
D4, survive group, enter normal swarm. A small objective readout would make that
sequence legible without adding a heavy tutorial.

### 7. Medium: the first-run build promise is delayed too long

The game already contains deep systems: weapon slots, dice, Dron, quality, luck,
powder, loot filter, and DiceCrafter. None are surfaced in the first static
screen.

Why it matters:
The target mix depends on the player quickly understanding that dogmax is about
build interactions, not only walking around a dark field.

## Recommended First Implementation Slice

Add a lightweight first-run objective/hint overlay. Do not build a large
tutorial system.

Suggested behavior:

1. On fresh run, show: `WASD: move to the glowing Pitchfork`.
2. After starter pickup, show: `I: open inventory. Right-click Pitchfork to equip`.
3. After first weapon equip, show: `Weapons fire automatically. Kill the scout`.
4. After D4 appears or is picked up, show: `Slot the D4 into the weapon dice cell`.
5. After a D4 is slotted or the timeout advances, show a short systems reminder:
   `Space=dash, F=loot filter, G=DiceCrafter, X=powder hovered inventory item`.

Superseded implementation note:

2026-07-07 later direction rejected a standalone first-run guide overlay. Use
the audit findings as problem evidence, but solve discoverability through grouped
vertical info-bar menu icons, `Ctrl+H -> Icons` visual references, and bottom
action footers inside opened panels.

Historical implementation shape:

- Prefer one small UI component rendered near the top-left or above the bottom
  HUD.
- Drive the hint from observable game state, not a saved tutorial flag.
- Use config keys for layout/text/colors if new tunables are needed.
- Keep F1 help as the full reference, but update `assets/help.md` in the same
  slice so the manual matches the real controls.

Likely files:

- `src/app/GameSession_Render.cpp`
- `src/render/UiState.hpp` if transient hint state is needed
- extension to existing infobar/panel renderers if that stays simpler
- `assets/help.md`
- `configs/ui.yaml` or `configs/theme.yaml` for any new tuning values

Verification:

- Build with `./bt dev`.
- Capture offscreen screenshots at 1 s, after pickup/equip if a deterministic
  path is available, and with F1 open.
- Confirm the first screenshot now contains a clear action prompt.
- Run a short headless smoke to ensure no startup regressions.
