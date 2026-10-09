#pragma once

#include "entities/Dice.hpp"
#include "entities/Weapon.hpp"

#include <string>
#include <unordered_map>

namespace dof::loaders { class NameLoader; }
namespace dof::helpers { class DeterministicRandom; using RandomHelper = DeterministicRandom; }

namespace dof::makers {

class NameMaker {
public:
    NameMaker(const dof::loaders::NameLoader& names,
              dof::helpers::RandomHelper& rng,
              float weaponFlavourSubstitutionChance);

    std::string makeWeaponName(dof::entities::WeaponType type);
    std::string makeDiceName(dof::entities::DiceFace face);

private:
    const std::string& pickWithoutImmediateRepeat(const std::string& poolName);

    const dof::loaders::NameLoader&          namesRef;
    dof::helpers::RandomHelper&              rngRef;
    float                                    weaponFlavourChance;
    std::unordered_map<std::string, int>     lastPickIndexByPool;
};

}
