#include "managers/EnemyManager.hpp"

#include "combat/SpecialEnemyStats.hpp"
#include "core/World.hpp"
#include "entities/Dice.hpp"
#include "entities/FloorItem.hpp"
#include "entities/Weapon.hpp"
#include "hubs/DamageTextHub.hpp"
#include "hubs/LuckHub.hpp"
#include "hubs/XpFloatHub.hpp"
#include "loaders/ConfigLoader.hpp"
#include "makers/LootMaker.hpp"

namespace dof::managers {

void EnemyManager::triggerShockerDeathAOE(dof::core::World& world,
                                           const dof::entities::Enemy& shocker) {
    const float radius = configRef.getFloat("SPECIAL_SHOCKER_DEATH_AOE_RADIUS");
    const float hpFrac = configRef.getFloat("SPECIAL_SHOCKER_DEATH_AOE_HERO_HP_FRACTION");
    if (radius <= 0.0f || hpFrac <= 0.0f) return;
    const float heroMaxHp = world.hero().damageable().maxHealth;
    const float damage = heroMaxHp * hpFrac;
    if (damage <= 0.0f) return;
    const auto centre = shocker.moveable().position;
    const float radiusSq = radius * radius;
    const auto nearbyIds = grid.queryRadius(centre, radius);
    for (const auto id : nearbyIds) {
        if (id == shocker.id()) continue;
        const auto it = spatialGridEnemyById.find(id.value);
        if (it == spatialGridEnemyById.end()) continue;
        auto* other = it->second;
        if (!other) continue;
        if (other->damageable().isDead()) continue;
        if (other->deathable().isDead) continue;
        const auto& pos = other->moveable().position;
        const float dx = pos.x - centre.x;
        const float dy = pos.y - centre.y;
        if (dx * dx + dy * dy > radiusSq) continue;
        const float applied = other->damageable().takeDamage(damage);
        // card-mpo9q5ih — a chain kill is still a kill: credit XP for the kill.
        if (other->damageable().isDead()) {
            grantChainKillExperience(world, *other);
        }
        if (applied > 0.0f) {
            damageTextHubRef.spawnDamage(pos, applied, /*isCritical=*/true, shocker.tier());
        }
    }
}

void EnemyManager::grantChainKillExperience(dof::core::World& world,
                                             const dof::entities::Enemy& victim) {
    const std::int64_t amount = world.hero().levelable().grantKillExperience(
        victim.level(), static_cast<int>(victim.tier()));
    if (amount > 0 && xpFloatHubPtr != nullptr) {
        xpFloatHubPtr->spawnXp(victim.moveable().position, amount, 1);
    }
}

bool EnemyManager::spawnDeathLoot(dof::core::World& world, dof::entities::Enemy& enemy) {
    // Wave intro: force-drop the required dice when the scout dies.
    const auto authoredState = authoredEnemyStates.find(enemy.id().value);
    if ((wavePhase == WavePhase::ScoutAlive
         || wavePhase == WavePhase::DiceEquipWait)
        && authoredState != authoredEnemyStates.end()
        && authoredState->second.encounterIndex == 0) {
        dropOpeningDiceAt(world, enemy.moveable().position);
        return true;
    }

    // Equipment-based drop: an armed enemy drops the EXACT weapons (and their
    // dice) it fought with — the real instances, moved out of its loadout, so
    // "attacked with a sword → drops that sword" is literal. Guaranteed,
    // independent of the chance-gated random roll below.
    const bool wasArmed = enemy.loadout().isArmed();
    bool didDropEquipment = false;
    if (wasArmed) {
        const auto pos = enemy.moveable().position;
        for (auto& weapon : enemy.loadout().takeWeapons()) {
            if (!weapon) continue;
            // Detach the dice first so each drops as its own floor item.
            for (auto& die : weapon->takeAttachedDice()) {
                if (!die) continue;
                world.floorItems().push_back(std::make_unique<dof::entities::FloorItem>(
                    world.allocateId(), pos, std::move(die)));
                didDropEquipment = true;
            }
            world.floorItems().push_back(std::make_unique<dof::entities::FloorItem>(
                world.allocateId(), pos, std::move(weapon), /*isStarter*/ false));
            didDropEquipment = true;
        }
        // User choice: armed enemies drop equipment AND still roll random loot,
        // unless this switch suppresses the random roll for armed enemies.
        if (configRef.getBool("ENEMY_DROP_SUPPRESS_RANDOM_WHEN_ARMED")) {
            return didDropEquipment;
        }
    }

    if (!lootMakerPtr || !luckHubPtr) return didDropEquipment;
    int qFloor = luckHubPtr->qualityFloor();
    if (enemy.specialKind() == dof::entities::SpecialEnemyKind::Voidcrawler) {
        const int voidcrawlerFloor = configRef.getInt("SPECIAL_VOIDCRAWLER_QUALITY_FLOOR");
        if (voidcrawlerFloor > qFloor) qFloor = voidcrawlerFloor;
    }
    qFloor = std::clamp(qFloor, 0, 99);
    auto drops = lootMakerPtr->rollAllDrops(enemy.level(), qFloor,
                                            enemy.isElite(),
                                            [&world]() { return world.allocateId(); },
                                            luckHubPtr->luckTotal(),
                                            static_cast<int>(enemy.tier()));
    const auto deathPos = enemy.moveable().position;
    for (auto& drop : drops) {
        if (drop.kind == dof::makers::LootDrop::Kind::Weapon && drop.weapon) {
            auto floorItem = std::make_unique<dof::entities::FloorItem>(world.allocateId(),
                                                                        deathPos,
                                                                        std::move(drop.weapon),
                                                                        /*isStarter*/ false);
            world.floorItems().push_back(std::move(floorItem));
            didDropEquipment = true;
        } else if (drop.kind == dof::makers::LootDrop::Kind::Dice && drop.dice) {
            auto floorItem = std::make_unique<dof::entities::FloorItem>(world.allocateId(),
                                                                        deathPos,
                                                                        std::move(drop.dice));
            world.floorItems().push_back(std::move(floorItem));
            didDropEquipment = true;
        }
    }
    return didDropEquipment;
}

void EnemyManager::dropOpeningDiceAt(dof::core::World& world, sf::Vector2f position) {
    auto dice = std::make_unique<dof::entities::Dice>(
        world.allocateId(), waveRequiredDiceFace);
    dice->setDisplayName(dof::entities::diceFaceLabel(waveRequiredDiceFace));
    dice->countdownable().setDuration(waveRequiredDiceRollDuration);
    dice->setEvasionPerSlot(configRef.getFloat("WAVE_REQUIRED_DICE_EVASION_PER_SLOT"));
    dice->pickupable().pickupRadius = configRef.getFloat("ITEM_PICKUP_RADIUS");
    world.floorItems().push_back(std::make_unique<dof::entities::FloorItem>(
        world.allocateId(), position, std::move(dice)));
}

}
