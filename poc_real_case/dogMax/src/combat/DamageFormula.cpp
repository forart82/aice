#include "combat/DamageFormula.hpp"

namespace dof::combat {

DamageResult computeDamage(float baseDamage,
                            std::span<const int>   diceFaces,
                            std::span<const float> diceMultipliers,
                            float dronMultiplier,
                            float critMultiplier,
                            bool  isCritical,
                            float diceProductFloor,
                            float damageFloor) {
    DamageResult result;
    int sum = 0;
    for (int face : diceFaces) sum += face;
    float product = 1.0f;
    for (float mult : diceMultipliers) product *= mult;

    const float sumClamped     = sum < 1 ? 1.0f : static_cast<float>(sum);
    const float productClamped = product < diceProductFloor ? diceProductFloor : product;
    const float dronClamped    = dronMultiplier < 1.0f ? 1.0f : dronMultiplier;

    float damage = baseDamage * sumClamped * productClamped * dronClamped;
    if (damage < damageFloor) damage = damageFloor;
    // Report the crit that was actually APPLIED. A weapon sitting on
    // WEAPON_CRIT_MULT_FLOOR (1.0) fails the strict `> 1.0f` gate, so the old
    // unconditional flag put a "!" crit marker on a hit that dealt exactly base
    // damage. The RNG draw is consumed either way, so stream stability is
    // unaffected by narrowing the flag.
    const bool isCriticalApplied = isCritical && critMultiplier > 1.0f;
    if (isCriticalApplied) damage *= critMultiplier;

    result.damage = damage;
    result.sumFaces = sum;
    result.productMultipliers = product;
    result.dronMultiplier = dronMultiplier;
    result.isCritical = isCriticalApplied;
    return result;
}

}
