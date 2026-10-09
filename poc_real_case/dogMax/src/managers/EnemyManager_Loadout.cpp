#include "managers/EnemyManager.hpp"

#include "core/World.hpp"
#include "entities/Dice.hpp"
#include "entities/Enemy.hpp"
#include "entities/Weapon.hpp"
#include "helpers/DeterministicRandom.hpp"
#include "hubs/LuckHub.hpp"
#include "loaders/ConfigLoader.hpp"
#include "makers/DiceMaker.hpp"
#include "makers/WeaponMaker.hpp"

#include <algorithm>
#include <memory>
#include <vector>

namespace dof::managers {

void EnemyManager::rollEnemyLoadout(dof::core::World& world, dof::entities::Enemy& enemy) {
    // No equip context leaves the enemy unarmed; the authoritative unarmed
    // charge behavior still applies.
    if (!weaponMakerPtr || !diceMakerPtr) return;

    // Armed roll. An enemy that rolls unarmed keeps an empty loadout and
    // will charge the hero instead (see EnemyManager_Attack.cpp).
    if (!rngRef.bernoulli(configRef.getFloat("ENEMY_ARMED_PROBABILITY"))) return;

    // Weapon count: weighted 1-vs-2, clamped to the config cap.
    const int maxWeapons = std::max(1, configRef.getInt("ENEMY_MAX_WEAPONS"));
    const int weight1 = std::max(0, configRef.getInt("ENEMY_WEAPON_COUNT_WEIGHT_1"));
    const int weight2 = std::max(0, configRef.getInt("ENEMY_WEAPON_COUNT_WEIGHT_2"));
    int weaponCount = 1;
    const int weightTotal = weight1 + weight2;
    if (weightTotal > 0 && rngRef.uniformInt(1, weightTotal) > weight1) weaponCount = 2;
    weaponCount = std::min(weaponCount, maxWeapons);

    // Same maker inputs the loot pipeline uses, so enemy gear and the loot
    // it eventually drops are the same kind of instances.
    const int qFloor    = luckHubPtr ? luckHubPtr->qualityFloor() : 0;
    const int luckTotal = luckHubPtr ? luckHubPtr->luckTotal() : 0;
    const int tierIndex = static_cast<int>(enemy.tier());

    const int diceMin = std::max(0, configRef.getInt("ENEMY_DICE_COUNT_MIN"));
    const int diceMax = std::max(diceMin, configRef.getInt("ENEMY_DICE_COUNT_MAX"));

    for (int w = 0; w < weaponCount; ++w) {
        auto weapon = weaponMakerPtr->makeLootRandom(world.allocateId(), enemy.level(),
                                                     qFloor, luckTotal, tierIndex);
        if (!weapon) continue;

        // Per-weapon dice count, clamped to what the weapon's slots allow.
        const int diceCount = std::min(rngRef.uniformInt(diceMin, diceMax), weapon->slotCount());
        std::vector<std::unique_ptr<dof::entities::Dice>> dice;
        dice.reserve(static_cast<size_t>(std::max(0, diceCount)));
        for (int d = 0; d < diceCount; ++d) {
            auto die = diceMakerPtr->makeLootRandom(world.allocateId(), enemy.level(), qFloor);
            if (die) dice.push_back(std::move(die));
        }
        if (!dice.empty()) weapon->attachDice(std::move(dice));

        enemy.loadout().addWeapon(std::move(weapon));
    }
}

}
