#include "hubs/AttackVfxHub.hpp"

#include "hubs/EventLifetime.hpp"
#include "loaders/ConfigLoader.hpp"

#include <algorithm>
#include <utility>

namespace dof::hubs {

AttackVfxHub::AttackVfxHub(const dof::loaders::ConfigLoader& config) {
    durationSingle      = config.getFloat("ATTACK_VFX_DURATION_SINGLE");
    durationSwipe       = config.getFloat("ATTACK_VFX_DURATION_SWIPE");
    durationMultiTarget = config.getFloat("ATTACK_VFX_DURATION_MULTITARGET");
    durationMultiSingle = config.getFloat("ATTACK_VFX_DURATION_MULTISINGLE");
    durationAoe         = config.getFloat("ATTACK_VFX_DURATION_AOE");
    enemyDurationMultiplier = config.getFloat("ENEMY_ATTACK_VFX_DURATION_MULTIPLIER");
}

float AttackVfxHub::durationFor(dof::entities::AttackType mode) const {
    switch (mode) {
        case dof::entities::AttackType::Single:      return durationSingle;
        case dof::entities::AttackType::Swipe:       return durationSwipe;
        case dof::entities::AttackType::MultiTarget: return durationMultiTarget;
        case dof::entities::AttackType::MultiSingle: return durationMultiSingle;
        case dof::entities::AttackType::Aoe:         return durationAoe;
    }
    return durationSingle;
}

void AttackVfxHub::spawnSingle(sf::Vector2f heroFeet, sf::Vector2f direction,
                                float range, sf::Color color,
                                dof::entities::WeaponType weaponType,
                                bool isHeroAnchored, bool isEnemyAttack) {
    AttackVfxEvent event;
    event.mode           = dof::entities::AttackType::Single;
    event.weaponTypeHint = weaponType;
    event.isHeroAnchored = isHeroAnchored;
    event.originWorld    = heroFeet;
    event.direction      = direction;
    event.range          = range;
    event.color          = color;
    event.isEnemyAttack  = isEnemyAttack;
    event.executionTarget = {heroFeet.x + direction.x * range,
                             heroFeet.y + direction.y * range};
    event.duration       = durationSingle * (isEnemyAttack ? enemyDurationMultiplier : 1.0f);
    activeEvents.push_back(std::move(event));
}

void AttackVfxHub::spawnSwipe(sf::Vector2f heroFeet, sf::Vector2f direction,
                               float range, float arcDegrees, sf::Color color,
                               dof::entities::WeaponType weaponType,
                               bool isHeroAnchored, bool isEnemyAttack) {
    AttackVfxEvent event;
    event.mode           = dof::entities::AttackType::Swipe;
    event.weaponTypeHint = weaponType;
    event.isHeroAnchored = isHeroAnchored;
    event.originWorld    = heroFeet;
    event.direction      = direction;
    event.range          = range;
    event.arcDegrees     = arcDegrees;
    event.color          = color;
    event.isEnemyAttack  = isEnemyAttack;
    event.executionTarget = {heroFeet.x + direction.x * range,
                             heroFeet.y + direction.y * range};
    event.duration       = durationSwipe * (isEnemyAttack ? enemyDurationMultiplier : 1.0f);
    activeEvents.push_back(std::move(event));
}

void AttackVfxHub::spawnMultiTarget(sf::Vector2f heroFeet,
                                     std::vector<sf::Vector2f> targets,
                                     float range, sf::Color color,
                                     dof::entities::WeaponType weaponType,
                                     bool isHeroAnchored, bool isEnemyAttack) {
    AttackVfxEvent event;
    event.mode           = dof::entities::AttackType::MultiTarget;
    event.weaponTypeHint = weaponType;
    event.isHeroAnchored = isHeroAnchored;
    event.originWorld    = heroFeet;
    event.radialTargets  = std::move(targets);
    event.range          = range;
    event.color          = color;
    event.isEnemyAttack  = isEnemyAttack;
    if (!event.radialTargets.empty()) event.executionTarget = event.radialTargets.front();
    event.duration       = durationMultiTarget * (isEnemyAttack ? enemyDurationMultiplier : 1.0f);
    activeEvents.push_back(std::move(event));
}

void AttackVfxHub::spawnMultiSingle(sf::Vector2f heroFeet, sf::Vector2f target,
                                     int hitCount, float range, sf::Color color,
                                     dof::entities::WeaponType weaponType,
                                     bool isHeroAnchored, bool isEnemyAttack) {
    AttackVfxEvent event;
    event.mode           = dof::entities::AttackType::MultiSingle;
    event.weaponTypeHint = weaponType;
    event.isHeroAnchored = isHeroAnchored;
    event.originWorld    = heroFeet;
    event.stabTarget     = target;
    event.stabCount      = std::max(1, hitCount);
    event.range          = range;
    event.color          = color;
    event.isEnemyAttack  = isEnemyAttack;
    event.executionTarget = target;
    event.duration       = durationMultiSingle * (isEnemyAttack ? enemyDurationMultiplier : 1.0f);
    activeEvents.push_back(std::move(event));
}

void AttackVfxHub::spawnAoe(sf::Vector2f heroFeet, float range, sf::Color color,
                              dof::entities::WeaponType weaponType,
                              bool isHeroAnchored, bool isEnemyAttack,
                              sf::Vector2f executionTarget) {
    AttackVfxEvent event;
    event.mode           = dof::entities::AttackType::Aoe;
    event.weaponTypeHint = weaponType;
    // Ground-slam types (Mace, Warhammer) and thrown types (BigAxe)
    // stay at the impact point in world space. Spin attacks (Halberd,
    // Quarterstaff) follow the hero since the hero IS spinning in place.
    const bool isGroundSlam = (weaponType == dof::entities::WeaponType::Mace
                                || weaponType == dof::entities::WeaponType::Warhammer);
    const bool isThrownAxe  = (weaponType == dof::entities::WeaponType::BigAxe);
    event.isHeroAnchored = isHeroAnchored && !isGroundSlam && !isThrownAxe;
    event.originWorld    = heroFeet;
    event.range          = range;
    event.color          = color;
    event.isEnemyAttack  = isEnemyAttack;
    event.executionTarget = executionTarget;
    event.duration       = durationAoe * (isEnemyAttack ? enemyDurationMultiplier : 1.0f);
    activeEvents.push_back(std::move(event));
}

void AttackVfxHub::update(float dt) {
    ageAndExpire(activeEvents, dt, [](const AttackVfxEvent& event) { return event.duration; });
}

const std::vector<AttackVfxEvent>& AttackVfxHub::events() const { return activeEvents; }
void AttackVfxHub::clear() { activeEvents.clear(); }

}
