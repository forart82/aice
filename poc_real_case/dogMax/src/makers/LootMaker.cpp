#include "makers/LootMaker.hpp"

#include "helpers/RandomHelper.hpp"
#include "loaders/ConfigLoader.hpp"
#include "makers/DiceMaker.hpp"
#include "makers/WeaponMaker.hpp"

#include <algorithm>
#include <cmath>

namespace dof::makers {

LootMaker::LootMaker(const dof::loaders::ConfigLoader& config,
                     dof::helpers::RandomHelper& rng,
                     WeaponMaker& weaponMaker,
                     DiceMaker& diceMaker)
    : configRef(config), rngRef(rng), weaponMakerRef(weaponMaker), diceMakerRef(diceMaker) {
}

LootDrop LootMaker::rollDrop(dof::core::EntityId id, int enemyLevel, int qFloor,
                              int luckTotal, int enemyTierIndex) {
    const int weaponWeight = configRef.getInt("WEAPON_DROP_WEIGHT");
    const int diceWeight   = configRef.getInt("DICE_DROP_WEIGHT");
    const int totalWeight  = weaponWeight + diceWeight;
    LootDrop drop;
    if (totalWeight <= 0) {
        drop.kind   = LootDrop::Kind::Weapon;
        drop.weapon = weaponMakerRef.makeLootRandom(id, enemyLevel, qFloor, luckTotal, enemyTierIndex);
        return drop;
    }
    const int roll = rngRef.uniformInt(1, totalWeight);
    if (roll <= weaponWeight) {
        drop.kind   = LootDrop::Kind::Weapon;
        drop.weapon = weaponMakerRef.makeLootRandom(id, enemyLevel, qFloor, luckTotal, enemyTierIndex);
    } else {
        drop.kind = LootDrop::Kind::Dice;
        drop.dice = diceMakerRef.makeLootRandom(id, enemyLevel, qFloor);
    }
    return drop;
}

float LootMaker::computeDropChance(int luckTotal, int enemyTierIndex) const {
    const float baseChance = configRef.getFloat("BASE_DROP_CHANCE");
    const float maxChance = configRef.getFloat("MAX_DROP_CHANCE");
    const float luckBonus = configRef.getFloat("LUCK_DROP_BONUS");
    const float tierBonus = configRef.getFloat("TIER_DROP_BONUS");
    const float luckRef = std::max(1.0f, configRef.getFloat("LUCK_DROP_REFERENCE"));

    const float luckNorm = std::clamp(static_cast<float>(luckTotal) / luckRef,
                                       0.0f, 1.0f);
    const float tierNorm = std::clamp(static_cast<float>(enemyTierIndex) / 2.0f, 0.0f, 1.0f);
    const float chance   = baseChance
                         + luckBonus * luckNorm
                         + tierBonus * tierNorm;
    return std::clamp(chance, 0.0f, maxChance);
}

std::vector<LootDrop> LootMaker::rollAllDrops(int enemyLevel,
                                              int qFloor,
                                              bool isElite,
                                              const std::function<dof::core::EntityId()>& allocateId,
                                              int luckTotal,
                                              int enemyTierIndex) {
    std::vector<LootDrop> drops;
    drops.reserve(4);

    // Base drop — chance-gated by player luck + enemy tier.
    const float dropChance = computeDropChance(luckTotal, enemyTierIndex);
    if (rngRef.uniformFloat(0.0f, 1.0f) < dropChance) {
        drops.push_back(rollDrop(allocateId(), enemyLevel, qFloor, luckTotal, enemyTierIndex));
    }

    // Elite extras — guaranteed on top of the base chance.
    if (isElite) {
        const int eliteCount = configRef.getInt("ELITE_DROP_COUNT_BONUS");
        for (int i = 0; i < eliteCount; ++i) {
            drops.push_back(rollDrop(allocateId(), enemyLevel, qFloor, luckTotal, enemyTierIndex));
        }
    }
    return drops;
}

int   LootMaker::weaponDropWeight()    const { return configRef.getInt("WEAPON_DROP_WEIGHT"); }
int   LootMaker::diceDropWeight()      const { return configRef.getInt("DICE_DROP_WEIGHT"); }
int   LootMaker::eliteDropCountBonus() const { return configRef.getInt("ELITE_DROP_COUNT_BONUS"); }

}
