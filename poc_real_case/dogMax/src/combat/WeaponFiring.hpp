#pragma once

#include "combat/DamageFormula.hpp"

#include <span>
#include <vector>

namespace dof::entities { class Weapon; class Dice; }
namespace dof::helpers { class DeterministicRandom; using RandomHelper = DeterministicRandom; }

namespace dof::combat {

// Aggregated per-fire contribution of the dice slotted into one weapon:
// the rolled face values, damage multipliers, and summed crit chance /
// crit multiplier. Built once per fire and fed into `rollWeaponDamage`.
struct DiceSlotSnapshot {
    std::vector<int>   faces;
    std::vector<float> mults;
    float              critChance{0.0f};
    // MULTIPLICATIVE identity, not 0. Dice crit values are multipliers
    // (DICE_CRIT_MIN 1.2 .. MAX 3.0), so they compose by product the same way
    // dice damage multipliers already do in computeDamage.
    float              critMult{1.0f};
};

// Entity-agnostic weapon+dice firing rules, shared by the hero
// (`WeaponManager`, keyed on a `WeaponSlotHub` row) and by enemies
// (`EnemyManager`, keyed on a weapon's `attachedDicePeek()`). Every
// function takes the weapon plus a span of the dice slotted into it
// (null entries are skipped), so neither storage layout leaks in.
//
// Spec §Charged + §Effective APS: when any dice is slotted the weapon's
// own APS countdown is ignored and firing is paced exclusively by the
// slowest dice (charged only when EVERY slotted dice has finished its
// roll); with zero dice the weapon's own countdown paces it.

// Advance the cooldown by `dt`: the weapon countdown when no dice are
// slotted, otherwise each slotted dice's countdown.
void advanceWeaponCooldown(dof::entities::Weapon& weapon,
                           std::span<dof::entities::Dice* const> dice,
                           float dt);

// True when the weapon is ready to fire under the dice-pacing-wins rule.
bool isWeaponCharged(const dof::entities::Weapon& weapon,
                     std::span<dof::entities::Dice* const> dice);

// Charge fraction in [0,1] for the charge bar: the slowest dice's
// progress when dice are slotted, else the weapon countdown's progress.
float weaponChargeProgress(const dof::entities::Weapon& weapon,
                           std::span<dof::entities::Dice* const> dice);

// Reset after a shot: re-derive the weapon countdown duration from its
// current APS, reset the weapon countdown, and reset EVERY slotted dice.
// Resetting all dice is mandatory — a dice-slotted attacker that skips it
// desyncs after its first shot.
void resetWeaponCooldown(dof::entities::Weapon& weapon,
                         std::span<dof::entities::Dice* const> dice);

// Gather the dice contributions for one fire (faces / mults / crit sums).
DiceSlotSnapshot collectDiceSnapshot(std::span<dof::entities::Dice* const> dice);

// Pure damage roll: roll the crit bernoulli and run `computeDamage`. No
// target, no side effects — the caller applies the returned damage. The
// hero passes its live dron multiplier; enemies pass 1.0f (no dron).
DamageResult rollWeaponDamage(float baseDamage,
                              const DiceSlotSnapshot& diceSnapshot,
                              float dronMultiplier,
                              float critChance,
                              float critMultiplier,
                              dof::helpers::RandomHelper& rng,
                              float diceProductFloor,
                              float damageFloor);

}
