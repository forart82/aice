#include "entities/Enemy.hpp"

namespace dof::entities {

Enemy::Enemy(dof::core::EntityId id, int enemyLevelInit, QualityTier tierInit)
    : identity(id), enemyLevel(enemyLevelInit), qualityTier(tierInit) {
    targetableComponent.id = id;
}

dof::core::EntityId Enemy::id() const { return identity; }
int Enemy::level() const { return enemyLevel; }
QualityTier Enemy::tier() const { return qualityTier; }
void Enemy::setTier(QualityTier value) { qualityTier = value; }

sf::Vector2f Enemy::spawnPosition() const { return spawnPositionValue; }
void Enemy::setSpawnPosition(sf::Vector2f value) { spawnPositionValue = value; }

bool Enemy::isElite() const { return qualityTier != QualityTier::Common; }

SpecialEnemyKind Enemy::specialKind() const { return specialKindValue; }
void Enemy::setSpecialKind(SpecialEnemyKind kind) { specialKindValue = kind; }

int  Enemy::lastHeroDashHitId() const { return lastHeroDashHitIdValue; }
void Enemy::setLastHeroDashHitId(int dashId) { lastHeroDashHitIdValue = dashId; }

dof::abilities::Moveable&   Enemy::moveable()   { return moveableComponent; }
dof::abilities::Walkable&   Enemy::walkable()   { return walkableComponent; }
dof::abilities::Huntable&   Enemy::huntable()   { return huntableComponent; }
dof::abilities::Damageable& Enemy::damageable() { return damageableComponent; }
dof::abilities::Deathable&  Enemy::deathable()  { return deathableComponent; }
dof::abilities::Targetable& Enemy::targetable() { return targetableComponent; }
dof::abilities::Aimable&    Enemy::aimable()    { return aimableComponent; }
dof::abilities::Dashable&   Enemy::dashState()  { return dashableComponent; }
dof::abilities::EnemyMind&  Enemy::mind()       { return mindComponent; }
dof::abilities::EnemyLoadout& Enemy::loadout()  { return loadoutComponent; }

const dof::abilities::Moveable&   Enemy::moveable()   const { return moveableComponent; }
const dof::abilities::Walkable&   Enemy::walkable()   const { return walkableComponent; }
const dof::abilities::Huntable&   Enemy::huntable()   const { return huntableComponent; }
const dof::abilities::Damageable& Enemy::damageable() const { return damageableComponent; }
const dof::abilities::Deathable&  Enemy::deathable()  const { return deathableComponent; }
const dof::abilities::Targetable& Enemy::targetable() const { return targetableComponent; }
const dof::abilities::Aimable&    Enemy::aimable()    const { return aimableComponent; }
const dof::abilities::Dashable&   Enemy::dashState()  const { return dashableComponent; }
const dof::abilities::EnemyMind&  Enemy::mind()       const { return mindComponent; }
const dof::abilities::EnemyLoadout& Enemy::loadout()  const { return loadoutComponent; }

}
