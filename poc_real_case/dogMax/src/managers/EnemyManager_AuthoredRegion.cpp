#include "managers/EnemyManager.hpp"

#include "core/World.hpp"
#include "core/WorldEnvironment.hpp"
#include "entities/Enemy.hpp"
#include "entities/Hero.hpp"
#include "loaders/ConfigLoader.hpp"

#include <algorithm>
#include <cmath>
#include <stdexcept>
#include <string>

namespace dof::managers {

namespace {

dof::entities::QualityTier parseAuthoredTier(const std::string& token) {
    if (token == "COMMON") return dof::entities::QualityTier::Common;
    if (token == "UNCOMMON") return dof::entities::QualityTier::Uncommon;
    if (token == "RARE") return dof::entities::QualityTier::Rare;
    throw std::runtime_error("Invalid authored encounter tier: " + token);
}

}

void EnemyManager::synchronizeWorldEditorEnemies(
        dof::core::World& world,
        const dof::core::WorldEnvironment& environment) {
    worldEditorEnvironmentPtr = &environment;
    auto& enemies = world.enemies();
    std::erase_if(enemies, [&](const auto& enemy) {
        return enemy && std::ranges::find(
            worldEditorEnemyIds, enemy->id().value) != worldEditorEnemyIds.end();
    });
    for (const auto enemyId : worldEditorEnemyIds) {
        authoredEnemyStates.erase(enemyId);
        enemyAiDeferredSeconds.erase(enemyId);
        // Also drop the alert entry. resetSpawnState clears this map wholesale
        // and warns that a recycled id would inherit a stale alert target and
        // path incorrectly; every WorldEditor resync otherwise leaked one entry
        // per removed enemy for the rest of the session.
        alertTargetMap.erase(enemyId);
    }
    spawnCounter = std::max(0, spawnCounter
        - static_cast<int>(worldEditorEnemyIds.size()));
    worldEditorEnemyIds.clear();

    for (const auto& definition : environment.state().enemies) {
        const auto tier = static_cast<dof::entities::QualityTier>(
            std::clamp(definition.tier, 0, 2));
        auto authoredEnemy = std::make_unique<dof::entities::Enemy>(
            world.allocateId(), std::max(1, definition.level), tier);
        authoredEnemy->moveable().teleportTo(definition.position);
        authoredEnemy->setSpawnPosition(definition.position);
        authoredEnemy->targetable().anchorPosition = definition.position;
        authoredEnemy->targetable().collisionRadius = collisionRadius;
        applyTierAndLevel(*authoredEnemy, std::max(1, definition.level), tier);
        dof::entities::SpecialEnemyKind kind = dof::entities::SpecialEnemyKind::None;
        if (definition.typeId != "regular") {
            if (!dof::entities::parseSpecialEnemyKindToken(definition.typeId, kind)) {
                throw std::runtime_error(
                    "Invalid WorldEditor enemy type: " + definition.typeId);
            }
            authoredEnemy->setSpecialKind(kind);
            applySpecialEnemyOverride(*authoredEnemy);
        }
        authoredEnemy->huntable().spawnAnimTimer = 0.0f;
        authoredEnemy->huntable().hasPlayedSpawnPortalCloseSound = true;
        rollEnemyLoadout(world, *authoredEnemy);
        worldEditorEnemyIds.push_back(authoredEnemy->id().value);
        world.enemies().push_back(std::move(authoredEnemy));
        ++spawnCounter;
    }
    rebuildSpatialGrid(world);
    areWorldEditorEnemiesSynchronized = true;
}

namespace {

sf::Vector2f normalizeOrFallback(sf::Vector2f value,
                                 sf::Vector2f fallback) {
    const float length = std::sqrt(value.x * value.x + value.y * value.y);
    return length > 0.0001f ? value / length : fallback;
}

}

void EnemyManager::loadAuthoredEncounterDefinitions() {
    authoredEncounters.clear();
    const int encounterCount = configRef.getInt(
        "OPENING_REGION_ENCOUNTER_COUNT");
    if (encounterCount < 0) {
        throw std::runtime_error("Opening-region encounter count cannot be negative");
    }
    if (encounterCount == 0) return;
    if (encounterCount < 3) {
        throw std::runtime_error(
            "Region 1 needs opening, group, and exploration encounters");
    }
    authoredPatrolSpeedFraction = configRef.getFloat(
        "OPENING_REGION_ENEMY_PATROL_SPEED_FRACTION");
    authoredDefensiveOffset = configRef.getFloat(
        "OPENING_REGION_ENEMY_DEFENSIVE_OFFSET");
    if (authoredPatrolSpeedFraction <= 0.0f
        || authoredPatrolSpeedFraction >= 1.0f
        || authoredDefensiveOffset <= 0.0f) {
        throw std::runtime_error("Invalid authored enemy movement tuning");
    }
    authoredEncounters.reserve(static_cast<std::size_t>(encounterCount));
    for (int index = 0; index < encounterCount; ++index) {
        const std::string prefix = "OPENING_REGION_ENCOUNTER_"
                                 + std::to_string(index);
        AuthoredEncounterDefinition definition;
        definition.centre = {
            configRef.getFloat(prefix + "_X"),
            configRef.getFloat(prefix + "_Y")};
        definition.count = configRef.getInt(prefix + "_COUNT");
        definition.level = configRef.getInt(prefix + "_LEVEL");
        definition.tier = parseAuthoredTier(
            configRef.getString(prefix + "_TIER"));
        definition.spacing = configRef.getFloat(prefix + "_SPACING");
        definition.activationRadius = configRef.getFloat(
            prefix + "_ACTIVATION_RADIUS");
        definition.patrolRadius = configRef.getFloat(
            prefix + "_PATROL_RADIUS");
        if (definition.count <= 0 || definition.level <= 0
            || definition.spacing <= 0.0f
            || definition.activationRadius <= 0.0f
            || definition.activationRadius > chaseRange
            || definition.patrolRadius <= 0.0f) {
            throw std::runtime_error(
                "Invalid authored encounter definition: " + prefix);
        }
        authoredEncounters.push_back(definition);
    }
    if (authoredEncounters[0].count != 1
        || authoredEncounters[1].count != waveGroupSize) {
        throw std::runtime_error(
            "Opening encounter counts must match the one-scout/three-enemy contract");
    }
}

void EnemyManager::placeAuthoredEnemy(
    dof::core::World& world, sf::Vector2f position, int level,
    dof::entities::QualityTier tier, int encounterIndex) {
    auto enemy = std::make_unique<dof::entities::Enemy>(
        world.allocateId(), level, tier);
    enemy->moveable().teleportTo(position);
    enemy->setSpawnPosition(position);
    enemy->targetable().anchorPosition = position;
    enemy->targetable().collisionRadius = collisionRadius;
    applyTierAndLevel(*enemy, level, tier);
    enemy->huntable().spawnAnimTimer = 0.0f;
    enemy->huntable().hasPlayedSpawnPortalCloseSound = true;
    const std::uint64_t enemyId = enemy->id().value;
    const float phase = static_cast<float>((enemyId * 37u) % 628u) * 0.01f;
    authoredEnemyStates.emplace(enemyId, AuthoredEnemyState{
        encounterIndex, position, position, phase,
        encounterIndex == 0, false});
    world.enemies().push_back(std::move(enemy));
    ++spawnCounter;
}

void EnemyManager::ensureAuthoredRegionEnemies(dof::core::World& world) {
    if (!areWorldEditorEnemiesSynchronized && worldEditorEnvironmentPtr) {
        synchronizeWorldEditorEnemies(world, *worldEditorEnvironmentPtr);
    }
    if (isAuthoredRegionPlaced) return;
    if (authoredEncounters.empty()) {
        isAuthoredRegionPlaced = true;
        wavePhase = WavePhase::Exploration;
        return;
    }
    openingGroupEnemyIds.clear();
    for (std::size_t encounterIndex = 0u;
         encounterIndex < authoredEncounters.size(); ++encounterIndex) {
        const auto& definition = authoredEncounters[encounterIndex];
        const int columns = std::max(1, static_cast<int>(std::ceil(
            std::sqrt(static_cast<float>(definition.count)))));
        const int rows = (definition.count + columns - 1) / columns;
        for (int member = 0; member < definition.count; ++member) {
            const int column = member % columns;
            const int row = member / columns;
            const sf::Vector2f offset{
                (static_cast<float>(column)
                 - static_cast<float>(columns - 1) * 0.5f)
                    * definition.spacing,
                (static_cast<float>(row)
                 - static_cast<float>(rows - 1) * 0.5f)
                    * definition.spacing};
            placeAuthoredEnemy(world, definition.centre + offset,
                               definition.level, definition.tier,
                               static_cast<int>(encounterIndex));
            const std::uint64_t enemyId = world.enemies().back()->id().value;
            if (encounterIndex == 0u) openingScoutEnemyId = enemyId;
            if (encounterIndex == 1u) {
                openingGroupEnemyIds.push_back(enemyId);
            }
        }
    }
    isAuthoredRegionPlaced = true;
    wavePhase = WavePhase::ScoutAlive;
}

void EnemyManager::activateAuthoredEncounter(int encounterIndex) {
    for (auto& [enemyId, state] : authoredEnemyStates) {
        (void)enemyId;
        if (state.encounterIndex == encounterIndex) {
            state.isActive = true;
            state.hasSeenHero = true;
        }
    }
}

bool EnemyManager::prepareAuthoredEnemyForAi(
    dof::core::World& world, dof::entities::Enemy& enemy, float dt) {
    const auto stateIterator = authoredEnemyStates.find(enemy.id().value);
    if (stateIterator == authoredEnemyStates.end()) return true;
    auto& state = stateIterator->second;
    const auto& definition = authoredEncounters[static_cast<std::size_t>(
        state.encounterIndex)];
    const sf::Vector2f heroPosition = world.hero().moveable().position;
    const sf::Vector2f fromEncounter = heroPosition - definition.centre;
    const float encounterDistanceSquared = fromEncounter.x * fromEncounter.x
                                         + fromEncounter.y * fromEncounter.y;
    const bool isEncounterUnlocked = state.encounterIndex == 0
        || (state.encounterIndex == 1 && wavePhase == WavePhase::GroupAlive)
        || (state.encounterIndex >= 2 && wavePhase == WavePhase::Exploration);
    if (!state.isActive && isEncounterUnlocked
        && encounterDistanceSquared
            <= definition.activationRadius * definition.activationRadius) {
        activateAuthoredEncounter(state.encounterIndex);
    }

    const sf::Vector2f fromHero = heroPosition - enemy.moveable().position;
    const float heroDistanceSquared = fromHero.x * fromHero.x
                                    + fromHero.y * fromHero.y;
    if (state.isActive && heroDistanceSquared > chaseRange * chaseRange) {
        state.isActive = false;
        state.hasSeenHero = true;
        const sf::Vector2f away = normalizeOrFallback(
            state.homePosition - heroPosition, {1.0f, 0.0f});
        const float side = (enemy.id().value % 2u == 0u) ? 1.0f : -1.0f;
        const sf::Vector2f perpendicular{-away.y * side, away.x * side};
        state.defensivePosition = state.homePosition
                                + away * authoredDefensiveOffset
                                + perpendicular * authoredDefensiveOffset * 0.55f;
    }
    if (state.isActive) return true;

    state.patrolPhase += dt * (state.hasSeenHero ? 0.35f : 0.18f);
    const sf::Vector2f patrolOffset{
        std::cos(state.patrolPhase) * definition.patrolRadius,
        std::sin(state.patrolPhase) * definition.patrolRadius * 0.65f};
    const sf::Vector2f target = state.hasSeenHero
        ? state.defensivePosition : state.homePosition + patrolOffset;
    const sf::Vector2f toTarget = target - enemy.moveable().position;
    const float targetDistanceSquared = toTarget.x * toTarget.x
                                      + toTarget.y * toTarget.y;
    if (targetDistanceSquared > collisionRadius * collisionRadius) {
        const sf::Vector2f direction = normalizeOrFallback(toTarget, {0.0f, 0.0f});
        enemy.moveable().velocity = direction
            * enemy.moveable().moveSpeed * authoredPatrolSpeedFraction;
        enemy.moveable().advance(dt);
        commitGroundedMove(enemy);
    } else {
        enemy.moveable().velocity = {0.0f, 0.0f};
    }
    return false;
}

}
