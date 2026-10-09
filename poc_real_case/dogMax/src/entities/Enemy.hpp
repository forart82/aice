#pragma once

#include "abilities/Aimable.hpp"
#include "abilities/Damageable.hpp"
#include "abilities/Dashable.hpp"
#include "abilities/Deathable.hpp"
#include "abilities/EnemyLoadout.hpp"
#include "abilities/EnemyMind.hpp"
#include "abilities/Huntable.hpp"
#include "abilities/Moveable.hpp"
#include "abilities/Targetable.hpp"
#include "abilities/Walkable.hpp"
#include "core/EntityId.hpp"
#include "entities/QualityTier.hpp"
#include "entities/SpecialEnemyKind.hpp"

#include <SFML/System/Vector2.hpp>

namespace dof::entities {

class Enemy {
public:
    Enemy(dof::core::EntityId id, int enemyLevel, QualityTier tier);

    dof::core::EntityId        id() const;
    int                        level() const;
    QualityTier                tier() const;
    // Re-stamps the quality tier after construction. Used by the
    // enemy-design editor preview to force a known tier so a preview
    // can drive the per-tier design deterministically — mirrors
    // setSpecialKind below.
    void                       setTier(QualityTier value);

    sf::Vector2f               spawnPosition() const;
    void                       setSpawnPosition(sf::Vector2f value);

    bool                       isElite() const;

    SpecialEnemyKind           specialKind() const;
    void                       setSpecialKind(SpecialEnemyKind kind);

    // card-dash-through — id of the most recent hero dash that has
    // already damaged this enemy. The dash-through pass damages an enemy
    // only when the hero's live `dashId()` differs from this, then stamps
    // it, so one dash hits each enemy at most once while a later dash
    // (new id) can hit it again. Defaults to 0; the first dash is id 1.
    int                        lastHeroDashHitId() const;
    void                       setLastHeroDashHitId(int dashId);

    dof::abilities::Moveable&    moveable();
    dof::abilities::Walkable&    walkable();
    dof::abilities::Huntable&    huntable();
    dof::abilities::Damageable&  damageable();
    dof::abilities::Deathable&   deathable();
    dof::abilities::Targetable&  targetable();
    dof::abilities::Aimable&     aimable();
    dof::abilities::Dashable&    dashState();
    dof::abilities::EnemyMind&   mind();
    dof::abilities::EnemyLoadout& loadout();

    const dof::abilities::Moveable&    moveable() const;
    const dof::abilities::Walkable&    walkable() const;
    const dof::abilities::Huntable&    huntable() const;
    const dof::abilities::Damageable&  damageable() const;
    const dof::abilities::Deathable&   deathable() const;
    const dof::abilities::Targetable&  targetable() const;
    const dof::abilities::Aimable&     aimable() const;
    const dof::abilities::Dashable&    dashState() const;
    const dof::abilities::EnemyMind&   mind() const;
    const dof::abilities::EnemyLoadout& loadout() const;

private:
    dof::core::EntityId         identity;
    int                         enemyLevel{1};
    QualityTier                 qualityTier{QualityTier::Common};
    SpecialEnemyKind            specialKindValue{SpecialEnemyKind::None};
    int                         lastHeroDashHitIdValue{0};
    sf::Vector2f                spawnPositionValue{0.0f, 0.0f};
    dof::abilities::Moveable    moveableComponent;
    dof::abilities::Walkable    walkableComponent;
    dof::abilities::Huntable    huntableComponent;
    dof::abilities::Damageable  damageableComponent;
    dof::abilities::Deathable   deathableComponent;
    dof::abilities::Targetable  targetableComponent;
    dof::abilities::Aimable     aimableComponent;
    dof::abilities::Dashable    dashableComponent;
    dof::abilities::EnemyMind   mindComponent;
    dof::abilities::EnemyLoadout loadoutComponent;
};

}
