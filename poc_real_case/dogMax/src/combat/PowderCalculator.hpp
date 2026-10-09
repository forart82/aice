#pragma once

namespace dof::entities { class Weapon; class Dice; }
namespace dof::loaders  { class ConfigLoader; }

namespace dof::combat {

// Powder yield for destroying a weapon (GameDesign §Powder Quantity).
// SE8 (spec L2160-2167) — the raw stat sum gets multiplied by
// POWDER_STAT_FACTOR and clamped at [1, POWDER_PER_DESTROY_CAP]:
//   sum   = damage + aps + crit + critChance + range * POWDER_WEAPON_RANGE_SCALE
//   yield = clamp(1, POWDER_PER_DESTROY_CAP, round(POWDER_STAT_FACTOR * sum))
// All four scales live in `configs/powder.yaml` (CLAUDE.md
// "Configuration & Variables" rule).
int powderForWeapon(const dof::entities::Weapon& weapon,
                    const dof::loaders::ConfigLoader& config);

// Powder yield for destroying a dice. Same SE8 final-clamp shape
// applied to the per-dice stat sum:
//   sum   = damageMultiplier + crit + critChance * POWDER_DICE_CRIT_CHANCE_SCALE
//           + luck + faceCount
//   yield = clamp(1, POWDER_PER_DESTROY_CAP, round(POWDER_STAT_FACTOR * sum))
// (evasionPerSlot is intentionally excluded — spec L2149 omits it.)
int powderForDice(const dof::entities::Dice& dice,
                  const dof::loaders::ConfigLoader& config);

}
