#include "makers/NameMaker.hpp"

#include "helpers/RandomHelper.hpp"
#include "loaders/NameLoader.hpp"

namespace dof::makers {

NameMaker::NameMaker(const dof::loaders::NameLoader& names,
                     dof::helpers::RandomHelper& rng,
                     float weaponFlavourSubstitutionChance)
    : namesRef(names),
      rngRef(rng),
      weaponFlavourChance(weaponFlavourSubstitutionChance) {}

const std::string& NameMaker::pickWithoutImmediateRepeat(const std::string& poolName) {
    static const std::string emptyFallback{};
    if (!namesRef.hasPool(poolName)) {
        return emptyFallback;
    }
    const auto& pool = namesRef.pool(poolName);
    if (pool.empty()) {
        return emptyFallback;
    }
    const int size = static_cast<int>(pool.size());
    int chosen = rngRef.uniformInt(0, size - 1);
    if (size > 1) {
        auto it = lastPickIndexByPool.find(poolName);
        if (it != lastPickIndexByPool.end() && it->second == chosen) {
            chosen = (chosen + 1) % size;
        }
    }
    lastPickIndexByPool[poolName] = chosen;
    return pool[chosen];
}

std::string NameMaker::makeWeaponName(dof::entities::WeaponType type) {
    const std::string& prefix = pickWithoutImmediateRepeat("weapon_prefix");
    const std::string& suffix = pickWithoutImmediateRepeat("weapon_suffix");
    std::string base;
    if (rngRef.bernoulli(weaponFlavourChance)) {
        base = pickWithoutImmediateRepeat("weapon_flavour");
    } else {
        base = dof::entities::weaponTypeName(type);
    }
    return prefix + " " + base + " " + suffix;
}

std::string NameMaker::makeDiceName(dof::entities::DiceFace face) {
    std::string poolKey = "dice_";
    poolKey += dof::entities::diceFaceLabel(face);
    const std::string& prefix = pickWithoutImmediateRepeat("dice_prefix");
    const std::string& base   = pickWithoutImmediateRepeat(poolKey);
    const std::string& suffix = pickWithoutImmediateRepeat("dice_suffix");
    return prefix + " " + base + " " + suffix;
}

}
