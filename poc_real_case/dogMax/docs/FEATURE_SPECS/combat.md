# Combat Feature Spec

Updated: 2026-07-07

## Current Behavior

- Hero moves manually and attacks automatically through equipped weapons.
- Weapons use attack modes, cadence, range, crit, crit multiplier, and slotted
  dice.
- Damage uses weapon base damage, dice face sums, dice multipliers, Dron
  multiplier, and crit.
- Enemies chase, attack, die, drop loot, and can belong to quality tiers and
  special kinds.
- Dash is the active movement defense; the removed Active Doge helper is not a
  shipped mechanic.
- Large swarms use simulation and render LOD to preserve performance.

## Target Behavior

- Combat should feel like a horde ARPG first: movement, spacing, and build power
  must be readable under pressure.
- Each weapon/dice/Dron change should create an understandable combat effect.
- Special enemies should add recognizable tactical problems, not just more HP.

## Open Questions

- Which build identities should be taught first: crit, Dron, attack cadence,
  luck, powder crafting, or weapon shape?
- How much manual agency should the player have beyond movement/dash and
  inventory/build choices?
- Should enemies become more tactically varied before or after the first-run
  guidance pass?

## Do Not Do Yet

- Do not add more combat formulas until existing formulas are more visible to
  the player.
- Do not add manual skill bars unless the auto-attack horde identity is
  deliberately changed.
