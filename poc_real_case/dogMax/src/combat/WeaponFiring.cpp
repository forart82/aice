#include "combat/WeaponFiring.hpp"

#include "entities/Dice.hpp"
#include "entities/Weapon.hpp"
#include "helpers/RandomHelper.hpp"

namespace dof::combat {

void advanceWeaponCooldown(dof::entities::Weapon& weapon,
                           std::span<dof::entities::Dice* const> dice,
                           float dt) {
    bool anySlotted = false;
    for (auto* d : dice) {
        if (!d) continue;
        anySlotted = true;
        d->countdownable().advance(dt);
    }
    // With no dice the weapon's own APS countdown paces firing; with any
    // dice slotted the weapon countdown is deliberately not advanced.
    if (!anySlotted) weapon.countdownable().advance(dt);
}

bool isWeaponCharged(const dof::entities::Weapon& weapon,
                     std::span<dof::entities::Dice* const> dice) {
    bool anySlotted = false;
    for (auto* d : dice) {
        if (!d) continue;
        anySlotted = true;
        if (!d->countdownable().isFinished()) return false;
    }
    if (anySlotted) return true;
    return weapon.countdownable().isFinished();
}

float weaponChargeProgress(const dof::entities::Weapon& weapon,
                           std::span<dof::entities::Dice* const> dice) {
    bool anySlotted = false;
    float minDiceProgress = 1.0f;
    for (auto* d : dice) {
        if (!d) continue;
        anySlotted = true;
        const float p = d->countdownable().progress();
        if (p < minDiceProgress) minDiceProgress = p;
    }
    if (anySlotted) return minDiceProgress;
    return weapon.countdownable().progress();
}

void resetWeaponCooldown(dof::entities::Weapon& weapon,
                         std::span<dof::entities::Dice* const> dice) {
    const float effectiveAps = weapon.attacksPerSecond();
    if (effectiveAps > 0.0f) {
        weapon.countdownable().setDuration(1.0f / effectiveAps);
    } else {
        weapon.countdownable().setDuration(1.0f);
    }
    weapon.countdownable().reset();
    for (auto* d : dice) {
        if (d) d->countdownable().reset();
    }
}

DiceSlotSnapshot collectDiceSnapshot(std::span<dof::entities::Dice* const> dice) {
    DiceSlotSnapshot snapshot;
    for (auto* d : dice) {
        if (!d) continue;
        snapshot.faces.push_back(d->faceValue(d->currentFace()));
        snapshot.mults.push_back(d->damageMultiplier());
        snapshot.critChance += d->critChance();
        snapshot.critMult   *= d->crit();
    }
    return snapshot;
}

DamageResult rollWeaponDamage(float baseDamage,
                              const DiceSlotSnapshot& diceSnapshot,
                              float dronMultiplier,
                              float critChance,
                              float critMultiplier,
                              dof::helpers::RandomHelper& rng,
                              float diceProductFloor,
                              float damageFloor) {
    const bool isCritical = rng.bernoulli(critChance);
    return computeDamage(baseDamage,
                         diceSnapshot.faces,
                         diceSnapshot.mults,
                         dronMultiplier,
                         critMultiplier, isCritical,
                         diceProductFloor, damageFloor);
}

}
