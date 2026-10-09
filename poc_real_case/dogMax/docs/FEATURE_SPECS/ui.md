# UI Feature Spec

Updated: 2026-07-13

## Current Behavior

- Bespoke SFML UI is active.
- Sidebar, inventory, health/XP bars, dash charges, info bar, debug tabs,
  console overlay, component showcase, loot filter, tooltips, and enemy design
  editor exist.
- RmlUi is not the active UI direction.
- Death now produces an in-memory fatal-frame recap above every HUD and modal
  layer. The image marks the fatal enemy when visible, clamps the marker and
  labels it when off-screen, and preserves immutable enemy identity, level,
  tier or special kind, attack name, fatal damage, hero level, and run XP.

## Target Behavior

- UI should make build decisions fast under horde pressure.
- Important state must remain readable during dense combat.
- The accepted UI art direction is a dark-neon cockpit HUD: generated bitmap
  frame art provides texture and shape language, while live SFML widgets provide
  crisp readable state on top.
- The bottom combat infobar should use one composite bitmap frame where the
  healthbar forms the left physical end-cap and the infobar body continues
  right from it.
- The composite frame should preserve the full-height top and bottom rail art;
  do not hide ratio problems by cropping off the top of the source texture.
- The player info bar should read as one composed cockpit strip, not separate
  generic panels: a full-width XP rail, a left-anchor bitmap-backed health
  tank/core that physically starts the strip, weapon-slot bays, small stat
  modules, and a docked utility iconbar.
- The inventory should use the same manufactured cockpit language as the
  infobar: chamfered near-black metal, thin steel structure, restrained cyan
  state lines, copper fasteners/labels, and the canonical shader weapon glyphs.
- The health tank can be baked into the composite frame, but current HP must
  remain live: damage should visibly darken the emptied tank section.
- The health module should stay text-minimal: the percentage belongs inside
  an oval red-core monitor and should be drawn with pixel blocks, while the old
  level/core/exact-HP labels stay off the tank.
- The Vital Tank is stored healing, not a world pickup and not automatic
  regeneration. Enemies whose complete death outcome contains neither a weapon
  nor a die feed its reserve; holding `Q` transfers that reserve into missing HP
  and leaves any amount HP cannot accept stored.
- The reddish Vital reservoir occupies the lower chassis bay beneath the utility
  wall and first weapon slot, in the owner-approved location from
  `Screenshot_2026-07-13_16-50-43.png`. It must remain physically mounted to the
  infobar, with its integrated `Q` terminal and live fill/consume feedback, and
  must not crowd or redesign the far-left HP tank.
- Dash readiness should live inside the health core as a right-facing
  half-circle fluid tube recipient centered on the oval monitor, set into a
  dark physical mount that shares the infobar hardware language, replacing the
  separate dash pips.
- XP should sit as a physical glass tube in the middle of the longest straight
  top run of the infobar, not as a loose full-width line or detached text
  readout.
- The info bar should keep one compact three-by-three-capacity utility
  cartridge for inventory, loot filter, crafting, and help. It must be one
  manufactured part of the infobar chassis, physically joined to the dashbar,
  not floating glyphs, separate buttons, or a visible tic-tac-toe grid. Hover
  tooltips name each live icon.
- Menus opened from the infobar should deploy from its far-left end. The menu
  moves outward from that anchor and, when fully open, its bottom edge remains
  physically connected to the top edge of the infobar at the far-left side.
- Successful pickups should give compact feedback without opening a tutorial:
  the inventory icon gives a quick smooth glow-up pulse, and the same pickup
  sound plays.
- `Ctrl+H` is a library/gallery surface. Its `Icons` section documents the
  symbols visually, but gameplay tool activation belongs to the player info bar.
- The game should not use a first-run tutorial overlay. Discovery should come
  from world affordances, deliberate player experimentation, and concise action
  hints inside the menu the player chose to open.
- Open panels should carry their own bottom action footer so controls are taught
  in context instead of before the player needs them.

## Open Questions

- Which panel hints are truly useful, and which should stay hidden to preserve
  discovery?
- Which stats need to be visible during combat versus only in inventory?
- How should Dron, dice, and weapon synergies be explained visually?

## Do Not Do Yet

- Do not replace the UI toolkit.
- Do not add large static help screens as the primary onboarding solution.
