#include "combat/AttackModes.hpp"

#include "core/SpatialGrid.hpp"
#include "core/World.hpp"
#include "entities/Enemy.hpp"
#include "entities/Hero.hpp"
#include "entities/Weapon.hpp"
#include "helpers/MathHelper.hpp"

#include <algorithm>
#include <cmath>
#include <unordered_map>

namespace dof::combat {

namespace {

struct EnemyDistance {
    dof::entities::Enemy* enemy;
    float                 distanceSquared;
};

// Gather every alive enemy inside `range` together with its squared
// distance to the hero, sorted by ascending distance.
std::vector<EnemyDistance> gatherSortedEnemiesInRange(dof::core::World& world,
                                                      sf::Vector2f heroPosition,
                                                      float range) {
    const float rangeSquared = range * range;
    std::vector<EnemyDistance> result;
    result.reserve(world.enemies().size());
    for (auto& enemy : world.enemies()) {
        if (!enemy) continue;
        // Both predicates, matching EnemyManager.cpp:151. `deathable().isDead`
        // is a flag set by the once-per-frame death sweep; `damageable().isDead()`
        // is health <= 0. Between a kill and the next sweep they disagree, and
        // gathering on the flag alone handed corpses back as live targets.
        if (enemy->deathable().isDead || enemy->damageable().isDead()) continue;
        const float dsq = dof::helpers::distanceSquared(enemy->moveable().position, heroPosition);
        if (dsq <= rangeSquared) result.push_back({enemy.get(), dsq});
    }
    std::sort(result.begin(), result.end(),
              [](const EnemyDistance& a, const EnemyDistance& b) {
                  return a.distanceSquared < b.distanceSquared;
              });
    return result;
}

std::vector<EnemyDistance> gatherSortedEnemiesInRange(dof::core::World& world,
                                                      const dof::core::SpatialGrid& grid,
                                                      sf::Vector2f heroPosition,
                                                      float range) {
    const float rangeSquared = range * range;
    std::unordered_map<std::uint64_t, dof::entities::Enemy*> enemyById;
    enemyById.reserve(world.enemies().size());
    for (auto& enemy : world.enemies()) {
        if (!enemy) continue;
        // Both predicates, matching EnemyManager.cpp:151. `deathable().isDead`
        // is a flag set by the once-per-frame death sweep; `damageable().isDead()`
        // is health <= 0. Between a kill and the next sweep they disagree, and
        // gathering on the flag alone handed corpses back as live targets.
        if (enemy->deathable().isDead || enemy->damageable().isDead()) continue;
        enemyById.emplace(enemy->id().value, enemy.get());
    }

    const auto ids = grid.queryRadius(heroPosition, range);
    std::vector<EnemyDistance> result;
    result.reserve(ids.size());
    for (const auto id : ids) {
        const auto it = enemyById.find(id.value);
        if (it == enemyById.end()) continue;
        auto* enemy = it->second;
        const float dsq = dof::helpers::distanceSquared(enemy->moveable().position, heroPosition);
        if (dsq <= rangeSquared) result.push_back({enemy, dsq});
    }
    std::sort(result.begin(), result.end(),
              [](const EnemyDistance& a, const EnemyDistance& b) {
                  return a.distanceSquared < b.distanceSquared;
              });
    return result;
}

sf::Vector2f directionFromHero(const dof::entities::Enemy& enemy,
                               sf::Vector2f heroPosition) {
    const sf::Vector2f delta{enemy.moveable().position.x - heroPosition.x,
                              enemy.moveable().position.y - heroPosition.y};
    return dof::helpers::normalizeOrZero(delta);
}

}

std::vector<HitTarget> pickSingleTarget(dof::core::World& world,
                                        const dof::entities::Weapon& weapon) {
    const auto heroPosition = world.hero().moveable().position;
    const float range = weapon.rangeable().range;
    const auto sorted = gatherSortedEnemiesInRange(world, heroPosition, range);
    if (sorted.empty()) return {};
    return {HitTarget{sorted.front().enemy, directionFromHero(*sorted.front().enemy, heroPosition)}};
}

std::vector<HitTarget> pickSingleTarget(dof::core::World& world,
                                        const dof::core::SpatialGrid& grid,
                                        const dof::entities::Weapon& weapon) {
    const auto heroPosition = world.hero().moveable().position;
    const float range = weapon.rangeable().range;
    const auto sorted = gatherSortedEnemiesInRange(world, grid, heroPosition, range);
    if (sorted.empty()) return {};
    return {HitTarget{sorted.front().enemy, directionFromHero(*sorted.front().enemy, heroPosition)}};
}

std::vector<HitTarget> pickSwipeTargets(dof::core::World& world,
                                        const dof::entities::Weapon& weapon,
                                        sf::Vector2f& fireDirectionOut) {
    const auto heroPosition = world.hero().moveable().position;
    const float range = weapon.rangeable().range;
    const auto sorted = gatherSortedEnemiesInRange(world, heroPosition, range);
    if (sorted.empty()) { fireDirectionOut = {0.0f, 0.0f}; return {}; }

    // Spec §Hero Aim L1530-1536 + §Swipe L1464: the aim direction is
    // the unit vector hero -> closest enemy. The cone is symmetric
    // around it with full width `arcDegrees`; targets inside the
    // half-arc on either side are hit. A 360° arc degenerates to
    // "every enemy in range" so the angle math is a free pass-through
    // (cos(180°) = -1; û·f̂ is always >= -1).
    const sf::Vector2f fireDirection = directionFromHero(*sorted.front().enemy, heroPosition);
    fireDirectionOut = fireDirection;
    const float halfRadians = dof::helpers::degreesToRadians(weapon.swipeArcDegrees() * 0.5f);
    const float cosThreshold = std::cos(halfRadians);

    std::vector<HitTarget> hits;
    hits.reserve(sorted.size());
    for (const auto& entry : sorted) {
        const auto direction = directionFromHero(*entry.enemy, heroPosition);
        const float dot = direction.x * fireDirection.x + direction.y * fireDirection.y;
        // Spec L1469: `hit ⇔ θ ≤ halfRad`, equivalent to `cos θ ≥ cos halfRad`.
        if (dot + 1e-4f >= cosThreshold) {
            hits.push_back({entry.enemy, direction});
        }
    }
    return hits;
}

std::vector<HitTarget> pickSwipeTargets(dof::core::World& world,
                                        const dof::core::SpatialGrid& grid,
                                        const dof::entities::Weapon& weapon,
                                        sf::Vector2f& fireDirectionOut) {
    const auto heroPosition = world.hero().moveable().position;
    const float range = weapon.rangeable().range;
    const auto sorted = gatherSortedEnemiesInRange(world, grid, heroPosition, range);
    if (sorted.empty()) { fireDirectionOut = {0.0f, 0.0f}; return {}; }

    const sf::Vector2f fireDirection = directionFromHero(*sorted.front().enemy, heroPosition);
    fireDirectionOut = fireDirection;
    const float halfRadians = dof::helpers::degreesToRadians(weapon.swipeArcDegrees() * 0.5f);
    const float cosThreshold = std::cos(halfRadians);

    std::vector<HitTarget> hits;
    hits.reserve(sorted.size());
    for (const auto& entry : sorted) {
        const auto direction = directionFromHero(*entry.enemy, heroPosition);
        const float dot = direction.x * fireDirection.x + direction.y * fireDirection.y;
        if (dot + 1e-4f >= cosThreshold) {
            hits.push_back({entry.enemy, direction});
        }
    }
    return hits;
}

std::vector<HitTarget> pickMultiTargets(dof::core::World& world,
                                         const dof::entities::Weapon& weapon) {
    const auto heroPosition = world.hero().moveable().position;
    const float range = weapon.rangeable().range;
    const auto sorted = gatherSortedEnemiesInRange(world, heroPosition, range);
    if (sorted.empty()) return {};
    const int maxHits = weapon.multiTargetMax();
    std::vector<HitTarget> hits;
    hits.reserve(static_cast<std::size_t>(maxHits));
    // Spec L1473: distinct targets first, in ascending-distance order.
    for (const auto& entry : sorted) {
        if (static_cast<int>(hits.size()) >= maxHits) break;
        hits.push_back({entry.enemy, directionFromHero(*entry.enemy, heroPosition)});
    }
    // Fewer enemies than maxHits: cycle through all in-range enemies
    // round-robin so every target is hit before any is hit twice.
    const int numEnemies = static_cast<int>(sorted.size());
    while (static_cast<int>(hits.size()) < maxHits) {
        const int idx = static_cast<int>(hits.size()) % numEnemies;
        const auto& entry = sorted[static_cast<std::size_t>(idx)];
        hits.push_back({entry.enemy, directionFromHero(*entry.enemy, heroPosition)});
    }
    return hits;
}

std::vector<HitTarget> pickMultiTargets(dof::core::World& world,
                                        const dof::core::SpatialGrid& grid,
                                        const dof::entities::Weapon& weapon) {
    const auto heroPosition = world.hero().moveable().position;
    const float range = weapon.rangeable().range;
    const auto sorted = gatherSortedEnemiesInRange(world, grid, heroPosition, range);
    if (sorted.empty()) return {};
    const int maxHits = weapon.multiTargetMax();
    std::vector<HitTarget> hits;
    hits.reserve(static_cast<std::size_t>(maxHits));
    for (const auto& entry : sorted) {
        if (static_cast<int>(hits.size()) >= maxHits) break;
        hits.push_back({entry.enemy, directionFromHero(*entry.enemy, heroPosition)});
    }
    const int numEnemies = static_cast<int>(sorted.size());
    while (static_cast<int>(hits.size()) < maxHits) {
        const int idx = static_cast<int>(hits.size()) % numEnemies;
        const auto& entry = sorted[static_cast<std::size_t>(idx)];
        hits.push_back({entry.enemy, directionFromHero(*entry.enemy, heroPosition)});
    }
    return hits;
}

std::vector<HitTarget> pickMultiSingleTargets(dof::core::World& world,
                                                const dof::entities::Weapon& weapon) {
    const auto heroPosition = world.hero().moveable().position;
    const float range = weapon.rangeable().range;
    const auto sorted = gatherSortedEnemiesInRange(world, heroPosition, range);
    if (sorted.empty()) return {};
    const int maxHits = weapon.multiSingleMax();
    std::vector<HitTarget> hits;
    hits.reserve(static_cast<std::size_t>(maxHits));
    // Spec L1482: same target N times. We attach the closest enemy to
    // every entry; the manager applies an independent damage roll per
    // entry and sums them into a single floating text. If the target
    // is killed mid-burst the manager re-routes the remainder via the
    // hit pipeline; here we only pin the initial target.
    auto* closest = sorted.front().enemy;
    for (int i = 0; i < maxHits; ++i) {
        hits.push_back({closest, directionFromHero(*closest, heroPosition)});
    }
    return hits;
}

std::vector<HitTarget> pickMultiSingleTargets(dof::core::World& world,
                                              const dof::core::SpatialGrid& grid,
                                              const dof::entities::Weapon& weapon) {
    const auto heroPosition = world.hero().moveable().position;
    const float range = weapon.rangeable().range;
    const auto sorted = gatherSortedEnemiesInRange(world, grid, heroPosition, range);
    if (sorted.empty()) return {};
    const int maxHits = weapon.multiSingleMax();
    std::vector<HitTarget> hits;
    hits.reserve(static_cast<std::size_t>(maxHits));
    auto* closest = sorted.front().enemy;
    for (int i = 0; i < maxHits; ++i) {
        hits.push_back({closest, directionFromHero(*closest, heroPosition)});
    }
    return hits;
}

std::vector<HitTarget> pickAoeTargets(dof::core::World& world,
                                       const dof::entities::Weapon& weapon) {
    const auto heroPosition = world.hero().moveable().position;
    const float range = weapon.rangeable().range;
    const auto sorted = gatherSortedEnemiesInRange(world, heroPosition, range);
    std::vector<HitTarget> hits;
    hits.reserve(sorted.size());
    for (const auto& entry : sorted) {
        hits.push_back({entry.enemy, directionFromHero(*entry.enemy, heroPosition)});
    }
    return hits;
}

std::vector<HitTarget> pickAoeTargets(dof::core::World& world,
                                      const dof::core::SpatialGrid& grid,
                                      const dof::entities::Weapon& weapon) {
    const auto heroPosition = world.hero().moveable().position;
    const float range = weapon.rangeable().range;
    const auto sorted = gatherSortedEnemiesInRange(world, grid, heroPosition, range);
    std::vector<HitTarget> hits;
    hits.reserve(sorted.size());
    for (const auto& entry : sorted) {
        hits.push_back({entry.enemy, directionFromHero(*entry.enemy, heroPosition)});
    }
    return hits;
}

}
