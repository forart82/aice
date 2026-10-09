#include "combat/PowderCalculator.hpp"

#include "entities/Dice.hpp"
#include "entities/Weapon.hpp"
#include "loaders/ConfigLoader.hpp"

#include <algorithm>
#include <cmath>

namespace dof::combat {

namespace {

// SE8 — `powder = clamp(1, POWDER_PER_DESTROY_CAP, round(POWDER_STAT_FACTOR * sum))`.
// Centralises the factor + cap so both weapon + dice paths land at
// the same shape without each maintaining its own clamp pair.
int finaliseHarvest(float statSum, const dof::loaders::ConfigLoader& config) {
    const float statFactor   = config.getFloat("POWDER_STAT_FACTOR");
    const int   perDestroyCap = config.getInt  ("POWDER_PER_DESTROY_CAP");
    const int   rounded       = static_cast<int>(std::round(statSum * statFactor));
    return std::clamp(rounded, 1, perDestroyCap);
}

}

int powderForWeapon(const dof::entities::Weapon& weapon,
                    const dof::loaders::ConfigLoader& config) {
    const float rangeScale = config.getFloat("POWDER_WEAPON_RANGE_SCALE");
    const float sum = weapon.baseDamage()
                    + weapon.attacksPerSecond()
                    + weapon.crit()
                    + weapon.critChance()
                    + weapon.rangeable().range * rangeScale;
    return finaliseHarvest(sum, config);
}

int powderForDice(const dof::entities::Dice& dice,
                  const dof::loaders::ConfigLoader& config) {
    const float critChanceScale = config.getFloat("POWDER_DICE_CRIT_CHANCE_SCALE");
    const float sum = dice.damageMultiplier()
                    + dice.crit()
                    + dice.critChance() * critChanceScale
                    + static_cast<float>(dice.luck())
                    // Spec L2153: the dice face "counts as 1× stat" — it contributes
                    // a single stat unit, NOT its numeric magnitude (a d100 must add
                    // 1, not 100, otherwise the face term swamps every real stat).
                    + 1.0f;
    return finaliseHarvest(sum, config);
}

}
