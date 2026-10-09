#pragma once

#include "entities/Weapon.hpp"
#include "loaders/ConfigLoader.hpp"

namespace dof::makers::detail {

// Per-weapon-type config key bundles. Extracted from WeaponMaker so the
// switch tables live in one place — a new weapon type only requires
// adding one entry here.

struct WeaponTypeStatsKeys {
    const char* baseMin;
    const char* baseMax;
    const char* aps;
    const char* range;
    const char* critMult;
    const char* critChance;
    const char* dropWeight;
};

struct AttackTypeKeys {
    const char* attackType;
    const char* swipeArcDegrees;
    const char* multiTargetMax;
    const char* multiSingleMax;
};

WeaponTypeStatsKeys statsKeysFor(dof::entities::WeaponType type);
AttackTypeKeys      attackKeysFor(dof::entities::WeaponType type);
const char*         evasionBonusKeyFor(dof::entities::WeaponType type);

void applyAttackKeys(const dof::loaders::ConfigLoader& config,
                     dof::entities::Weapon& weapon,
                     dof::entities::WeaponType type);

void applyEvasionBonus(const dof::loaders::ConfigLoader& config,
                       dof::entities::Weapon& weapon,
                       dof::entities::WeaponType type);

}
