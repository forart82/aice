#include "managers/EnemyManager.hpp"

#include "core/World.hpp"
#include "entities/Enemy.hpp"
#include "entities/Hero.hpp"
#include "hubs/DamageTextHub.hpp"

#include <cmath>

// card-dash-through — the offensive half of the hero dash. Kept in its own
// translation unit so dash-through damage stays separate from spawn and AI.
namespace dof::managers {

void EnemyManager::applyHeroDashDamage(dof::core::World& world) {
    auto& hero = world.hero();
    // Only a live dash deals dash-through damage. The hero's invulnerability
    // window may outlast the burst, but the *damage* tracks the burst so it
    // reads on screen as "ran them over", not a lingering aura.
    if (!hero.isDashing()) return;

    const int          currentDashId = hero.dashId();
    const sf::Vector2f heroPosition  = hero.moveable().position;

    // Knockback heading = the dash direction (unit vector recovered from the
    // dash velocity). A degenerate zero velocity simply applies no shove.
    sf::Vector2f knockbackDirection{0.0f, 0.0f};
    const sf::Vector2f dashVel = hero.dashVelocity();
    const float dashMagnitude  = std::sqrt(dashVel.x * dashVel.x + dashVel.y * dashVel.y);
    if (dashMagnitude > 0.0001f) {
        knockbackDirection = {dashVel.x / dashMagnitude, dashVel.y / dashMagnitude};
    }

    const float radiusSquared = dashThroughRadius * dashThroughRadius;

    const auto nearbyIds = grid.queryRadius(heroPosition, dashThroughRadius);
    for (const auto id : nearbyIds) {
        const auto it = spatialGridEnemyById.find(id.value);
        if (it == spatialGridEnemyById.end()) continue;
        auto& enemy = *it->second;
        if (enemy.deathable().isDead || enemy.damageable().isDead()) continue;
        // Hit-once-per-dash: skip an enemy this dash already ran through.
        if (enemy.lastHeroDashHitId() == currentDashId) continue;

        const sf::Vector2f enemyPosition = enemy.moveable().position;
        const float deltaX = enemyPosition.x - heroPosition.x;
        const float deltaY = enemyPosition.y - heroPosition.y;
        if (deltaX * deltaX + deltaY * deltaY > radiusSquared) continue;

        enemy.setLastHeroDashHitId(currentDashId);

        const float damage  = enemy.damageable().maxHealth * dashThroughDamageFrac;
        const float applied = enemy.damageable().takeDamage(damage);
        if (applied > 0.0f) {
            // Floating number shows HP actually removed (Visual-Component rule).
            damageTextHubRef.spawnDamage(enemyPosition, applied,
                                         /*isCritical*/ false, enemy.tier());
        }
        // A dash-through kill is still a kill: credit XP here, same as the
        // Shocker-chain path — the death-detection pass below only handles
        // markDead/loot and never grants XP itself.
        if (enemy.damageable().isDead()) {
            grantChainKillExperience(world, enemy);
        }

        // Shove the enemy along the dash heading. Death + loot are handled by
        // the standard death-detection pass at the next update tick (same as
        // a weapon kill), so this pass intentionally does not markDead here.
        const sf::Vector2f shoved = {enemyPosition.x + knockbackDirection.x * dashThroughKnockback,
                                     enemyPosition.y + knockbackDirection.y * dashThroughKnockback};
        enemy.moveable().position = shoved;
        enemy.targetable().anchorPosition = shoved;
    }
}

}
