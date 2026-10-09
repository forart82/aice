#include "managers/EnemyManager.hpp"

#include "entities/Enemy.hpp"
#include "core/World.hpp"
#include "entities/Hero.hpp"
#include "helpers/MathHelper.hpp"

#include <algorithm>
#include <cmath>
#include <numbers>
#include <unordered_map>

namespace dof::managers {

void EnemyManager::resolveEnemyCollisions(dof::core::World& world) {
    // Rationale: Positional collision resolution between grounded enemies.
    // Pushes overlapping enemies symmetrically apart by half the overlap each
    // along their center axis. This prevents the swarm from merging into a single
    // visual blob.
    // Constraints: Only runs if enabled via config (`isEnemyEnemyCollisionEnabled`).
    // Dead/dying, rising, and airborne (dashing/jumping) enemies are exempt.
    // Side-effects: Mutates enemy positions and updates spatial structures.
    if (!isEnemyEnemyCollisionEnabled) return;
    if (enemyCollisionMaxResolveCount > 0
        && world.enemies().size() > static_cast<std::size_t>(enemyCollisionMaxResolveCount)) {
        return;
    }
    // Each enemy body has radius `collisionRadius` (uniform — stamped per spawn,
    // not tier-scaled), so two centres must stay at least `2 * collisionRadius`
    // apart for the bodies not to overlap.
    const float minDistance = collisionRadius * 2.0f;
    if (minDistance <= 0.0f) return;
    const float minDistanceSq = minDistance * minDistance;

    // Build a LOCAL grid rather than reusing the member `grid`. The member is
    // already current — `update` rebuilds it from post-AI positions right
    // before this call — but it holds the FULL live roster. Separation needs a
    // filtered roster: the loop below drops dead, still-rising and airborne
    // enemies so their trajectories are not disturbed, and only a grid built
    // from that same subset returns neighbour ids that are all resolvable.
    dof::core::SpatialGrid separationGrid(grid.cellSize());
    std::unordered_map<std::uint64_t, dof::entities::Enemy*> enemyById;
    enemyById.reserve(world.enemies().size());
    for (auto& enemyPtr : world.enemies()) {
        if (!enemyPtr) continue;
        dof::entities::Enemy& enemy = *enemyPtr;
        // Skip enemies that don't take part in grounded separation this frame:
        // dead/fading, still rising through the spawn portal (parity with the
        // tickAi spawn-anim gate), or airborne on a jump/dash arc (so the
        // trajectory is not disturbed mid-flight).
        if (enemy.deathable().isDead) continue;
        if (enemy.huntable().spawnAnimTimer > 0.0f) continue;
        if (enemy.dashState().isDashing) continue;
        separationGrid.insert(enemy.id(), enemy.moveable().position);
        enemyById.emplace(enemy.id().value, &enemy);
    }

    for (auto& enemyPtr : world.enemies()) {
        if (!enemyPtr) continue;
        dof::entities::Enemy& a = *enemyPtr;
        if (enemyById.find(a.id().value) == enemyById.end()) continue;  // excluded above
        const auto neighbours = separationGrid.queryRadius(a.moveable().position, minDistance);
        for (const auto neighbourId : neighbours) {
            // Resolve each unordered pair exactly once (lower id drives the push).
            if (neighbourId.value <= a.id().value) continue;
            auto it = enemyById.find(neighbourId.value);
            if (it == enemyById.end()) continue;
            dof::entities::Enemy& b = *it->second;

            const sf::Vector2f preA = a.moveable().position;
            const sf::Vector2f preB = b.moveable().position;
            const float dx = preB.x - preA.x;
            const float dy = preB.y - preA.y;
            const float distSq = dx * dx + dy * dy;
            if (distSq >= minDistanceSq) continue;  // not overlapping

            float distance = std::sqrt(distSq);
            sf::Vector2f pushDirection;
            if (distance > 1e-4f) {
                pushDirection = {dx / distance, dy / distance};
            } else {
                // Centres coincide — the separating axis is undefined. Pick a
                // deterministic direction from the id pair (Weyl hash of the
                // XOR) so the split is stable and reproducible across runs.
                const double h = static_cast<double>(a.id().value ^ b.id().value) * 0.61803398875;
                const float angle = static_cast<float>((h - std::floor(h)) *
                                                       (2.0 * std::numbers::pi));
                pushDirection = {std::cos(angle), std::sin(angle)};
                distance = 0.0f;
            }
            // Symmetric resolution: each enemy moves half the overlap apart.
            const float halfOverlap = (minDistance - distance) * 0.5f;
            a.moveable().position = {preA.x - pushDirection.x * halfOverlap,
                                     preA.y - pushDirection.y * halfOverlap};
            b.moveable().position = {preB.x + pushDirection.x * halfOverlap,
                                     preB.y + pushDirection.y * halfOverlap};
            // Keep both off the water and re-sync each targeting anchor.
            commitGroundedMove(a);
            commitGroundedMove(b);
        }
    }
}

} // namespace dof::managers
