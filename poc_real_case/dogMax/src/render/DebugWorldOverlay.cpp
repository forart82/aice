#include "render/DebugWorldOverlay.hpp"

#include "combat/EnemyLevelCurve.hpp"
#include "core/World.hpp"
#include "entities/Enemy.hpp"
#include "entities/Hero.hpp"
#include "abilities/Rangeable.hpp"
#include "entities/Weapon.hpp"
#include "loaders/ConfigLoader.hpp"
#include "managers/EnemyManager.hpp"

#include <SFML/Graphics/CircleShape.hpp>
#include <SFML/Graphics/VertexArray.hpp>

#include <algorithm>
#include <cmath>

namespace dof::render {

std::size_t debugExclusionTailStart(std::size_t count, std::size_t cap) {
    return (count > cap) ? (count - cap) : 0;
}

namespace {

// Show all active exclusion zones (up to the FIFO max of 5000).
constexpr std::size_t kMaxExclusionCircles = 5000;

void drawRing(sf::RenderTarget& window,
               sf::Vector2f position,
               float radius,
               sf::Color colour,
               float outlineThickness = 1.5f) {
    if (radius <= 0.0f) return;
    sf::CircleShape ring(radius);
    ring.setOrigin({radius, radius});
    ring.setPosition(position);
    ring.setFillColor(sf::Color::Transparent);
    ring.setOutlineColor(colour);
    ring.setOutlineThickness(outlineThickness);
    ring.setPointCount(48);
    window.draw(ring);
}

void drawFilledDisc(sf::RenderTarget& window,
                    sf::Vector2f position,
                    float radius,
                    sf::Color colour) {
    if (radius <= 0.0f) return;
    sf::CircleShape disc(radius);
    disc.setOrigin({radius, radius});
    disc.setPosition(position);
    disc.setFillColor(colour);
    disc.setOutlineThickness(0.0f);
    disc.setPointCount(32);
    window.draw(disc);
}

void drawLine(sf::RenderTarget& window,
                sf::Vector2f from,
                sf::Vector2f to,
                sf::Color colour) {
    sf::VertexArray line(sf::PrimitiveType::Lines, 2);
    line[0].position = from;
    line[1].position = to;
    line[0].color    = colour;
    line[1].color    = colour;
    window.draw(line);
}

float maxEquippedWeaponRange(const dof::entities::Hero& hero) {
    float best = 0.0f;
    for (const auto* weapon : hero.equippedWeapons()) {
        if (weapon) best = std::max(best, weapon->rangeable().range);
    }
    return best;
}

}

void drawDebugWorldOverlays(sf::RenderTarget& window,
                              const dof::core::World& world,
                              const dof::loaders::ConfigLoader& configLoader,
                              const dof::managers::EnemyManager& enemyManager,
                              float interpolationAlpha,
                              std::uint64_t startupSeed) {
    const auto& hero = world.hero();
    const auto heroPosition = hero.moveable().interpolatedPosition(interpolationAlpha);

    // Spec L2828 — hero attack range — bright green.
    const float weaponRange = maxEquippedWeaponRange(hero);
    drawRing(window, heroPosition, weaponRange, sf::Color{120, 255, 120, 110}, 2.0f);

    // Spec L2829 — hero pickup range — yellow.
    drawRing(window, heroPosition, hero.pickupable().pickupRadius,
              sf::Color{255, 220, 80, 130}, 2.0f);

    // Spec L2830-2831 — enemy chase + attack rings (orange / red).
    // Cyan ring = alert broadcast zone (ENEMY_CALL_RANGE), drawn only
    // for enemies actively chasing so the zone shows exactly who is
    // currently capable of alerting idle neighbours.
    const float callRange = configLoader.getFloat("ENEMY_CALL_RANGE");
    for (const auto& enemyPtr : world.enemies()) {
        if (!enemyPtr) continue;
        if (enemyPtr->deathable().isDead) continue;
        const auto enemyPos = enemyPtr->moveable().interpolatedPosition(
            interpolationAlpha);
        drawRing(window, enemyPos, enemyPtr->huntable().chaseRange,
                  sf::Color{255, 170, 80, 70}, 1.0f);
        drawRing(window, enemyPos, enemyPtr->huntable().attackRange,
                  sf::Color{255, 60, 60, 110}, 1.5f);
        // Pathfinding stand-in (spec L2821): line from each enemy to
        // the hero (its current chase target) until the proper A*/
        // NavMesh path (audit §3.7) lands.
        drawLine(window, enemyPos, heroPosition, sf::Color{200, 200, 255, 70});

        // Alert broadcast ring — cyan, shown only when enemy is chasing.
        const float dx = heroPosition.x - enemyPos.x;
        const float dy = heroPosition.y - enemyPos.y;
        const float cr = enemyPtr->huntable().chaseRange;
        if (dx * dx + dy * dy <= cr * cr) {
            drawRing(window, enemyPos, callRange, sf::Color{80, 200, 255, 55}, 1.5f);
        }
    }

    // Spec L2832 — enemy level zones — rainbow concentric circles
    // centred on the hero start. SE1 — rings now sit at the
    // piecewise distance-step cumulative values for levels
    // 2/3/4/5/6/7, so the rainbow tracks the real level zones
    // instead of evenly-spaced multiples that no longer match the
    // curve.
    const dof::combat::EnemyLevelCurve levelCurve(configLoader);
    const sf::Color rainbow[6] = {
        sf::Color{255,  80,  80,  60},
        sf::Color{255, 180,  60,  60},
        sf::Color{255, 255,  60,  60},
        sf::Color{ 80, 255,  80,  60},
        sf::Color{ 80, 180, 255,  60},
        sf::Color{200,  80, 255,  60},
    };
    for (int i = 1; i <= 6; ++i) {
        const float radius = levelCurve.cumulativeForLevel(i + 1);
        if (radius > 0.0f) drawRing(window, {0.0f, 0.0f}, radius, rainbow[i - 1], 1.0f);
    }

    // Spec L2833 — spawn zone inner / outer radius — dim outlines.
    const float spawnMin = configLoader.getFloat("ENEMY_SPAWN_MIN_RADIUS");
    const float spawnMax = configLoader.getFloat("ENEMY_SPAWN_RADIUS");
    drawRing(window, heroPosition, spawnMin, sf::Color{180, 180, 180, 80}, 1.0f);
    drawRing(window, heroPosition, spawnMax, sf::Color{120, 120, 120, 80}, 1.0f);

    // Spawn-exclusion dead zones — semi-transparent filled discs mark
    // positions where enemies were killed/spawned and are forbidden as
    // new spawn candidates within ENEMY_SPAWN_EXCLUSION_RADIUS. Only
    // the 50 most-recent entries are drawn to cap cost in long sessions.
    const float exclusionRadius =
        configLoader.getFloat("ENEMY_SPAWN_EXCLUSION_RADIUS");
    const auto& exclusions = enemyManager.spawnExclusions();
    const std::size_t tailStart =
        debugExclusionTailStart(exclusions.size(), kMaxExclusionCircles);
    for (std::size_t i = tailStart; i < exclusions.size(); ++i) {
        const sf::Vector2f pos = exclusions[i];
        // Zone disc — very transparent red fill.
        drawFilledDisc(window, pos, exclusionRadius,
                       sf::Color{220, 60, 60, 40});
        // Centre dot — marks the exact kill position.
        drawFilledDisc(window, pos, 8.0f, sf::Color{220, 60, 60, 120});
    }
}

}
