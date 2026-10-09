#include "managers/EnemyManager.hpp"

#include "hubs/EffectBurstHub.hpp"

#include "audio/SpatialAudio.hpp"
#include "combat/SpecialEnemyStats.hpp"
#include "core/World.hpp"
#include "diagnostics/FrameProfiler.hpp"
#include "entities/Dice.hpp"
#include "entities/Hero.hpp"
#include "helpers/MathHelper.hpp"
#include "helpers/RandomHelper.hpp"
#include "hubs/DamageTextHub.hpp"
#include "hubs/EvasionHub.hpp"
#include "hubs/LuckHub.hpp"
#include "hubs/VitalityTank.hpp"
#include "hubs/WeaponSlotHub.hpp"
#include "hubs/XpFloatHub.hpp"
#include "loaders/ConfigLoader.hpp"
#include "makers/LootMaker.hpp"

#include <algorithm>
#include <chrono>
#include <cstdint>
#include <stdexcept>
#include <vector>

namespace dof::managers {

EnemyManager::EnemyManager(const dof::loaders::ConfigLoader& config,
                           dof::helpers::RandomHelper& rng,
                           dof::hubs::DamageTextHub& damageTextHub)
    : configRef(config), rngRef(rng), damageTextHubRef(damageTextHub),
      grid(config.getFloat("SPATIAL_GRID_CELL_SIZE")) {
    spawnExclusionRadius   = config.getFloat("ENEMY_SPAWN_EXCLUSION_RADIUS");
    spawnExclusionFifoSize = config.getInt("ENEMY_SPAWN_EXCLUSION_FIFO_SIZE");
    baseHealth      = config.getFloat("ENEMY_BASE_HEALTH");
    baseSpeed       = config.getFloat("ENEMY_BASE_MOVE_SPEED");
    chaseRange      = config.getFloat("ENEMY_CHASE_RANGE");
    attackRange     = config.getFloat("ENEMY_ATTACK_RANGE");
    attackFlashDuration  = config.getFloat("ENEMY_ATTACK_FLASH_DURATION");
    armedAttackWindupSeconds = config.getFloat("ENEMY_ARMED_ATTACK_WINDUP_SECONDS");
    critChanceCap        = config.getFloat("CRIT_CHANCE_CAP");
    diceProductFloor     = config.getFloat("DAMAGE_DICE_PRODUCT_FLOOR");
    damageFloor          = config.getFloat("DAMAGE_MINIMUM_FLOOR");
    enemyAttackDamageMult = config.getFloat("ENEMY_ATTACK_DAMAGE_MULT");
    enemyAttackMinDamage = config.getFloat("ENEMY_ATTACK_MIN_DAMAGE");
    collisionRadius      = config.getFloat("ENEMY_COLLISION_RADIUS");
    // getBool fail-fasts on anything that is not 1/true/TRUE/yes or
    // 0/false/FALSE/no; the old getFloat route silently accepted 0.4 as
    // "enabled" and compared a float with !=.
    isEnemyEnemyCollisionEnabled = config.getBool("ENEMY_ENEMY_COLLISION_ENABLED");
    enemyCollisionMaxResolveCount = config.getInt("ENEMY_COLLISION_MAX_RESOLVE_COUNT");
    enemyAiMaxUpdatesPerFrame = config.getInt("ENEMY_AI_MAX_UPDATES_PER_FRAME");
    deadzoneFactor  = config.getFloat("ENEMY_DEADZONE_FACTOR");
    healthPerLevel  = config.getFloat("ENEMY_HEALTH_PER_LEVEL");
    speedPerLevel   = config.getFloat("ENEMY_SPEED_PER_LEVEL");
    levelCurve  = std::make_unique<dof::combat::EnemyLevelCurve>(config);
    tierCadence = std::make_unique<dof::combat::TierCadence>(config);
    deathAnimDuration = config.getFloat("ENEMY_DEATH_ANIM_DURATION");
    spawnAnimDuration = config.getFloat("ENEMY_SPAWN_ANIM_DURATION");
    spawnPortalCloseFraction = config.getFloat("ENEMY_SPAWN_PORTAL_CLOSE_FRACTION");
    tierStatMultCommon   = config.getFloat("ENEMY_TIER_STAT_MULT_COMMON");
    tierStatMultUncommon = config.getFloat("ENEMY_TIER_STAT_MULT_UNCOMMON");
    tierStatMultRare     = config.getFloat("ENEMY_TIER_STAT_MULT_RARE");
    heroStart = {config.getFloat("HERO_START_X"), config.getFloat("HERO_START_Y")};
    // Phase 14 — Special Enemy gate parameters loaded once at ctor so
    // the substitution predicate runs lock-free per spawn.
    specialGates = dof::combat::SpecialEnemyGateParams::loadFromConfig(config);
    specialCounters.reset();
    waveGroupSize          = config.getInt("WAVE_GROUP_SIZE");
    const std::string waveDiceFaceToken =
        std::to_string(config.getInt("WAVE_REQUIRED_DICE_FACE_COUNT"));
    if (!dof::entities::parseDiceFaceCountToken(waveDiceFaceToken, waveRequiredDiceFace)) {
        throw std::runtime_error("EnemyManager: invalid WAVE_REQUIRED_DICE_FACE_COUNT");
    }
    waveRequiredDiceRollDuration = config.getFloat("WAVE_REQUIRED_DICE_ROLL_DURATION_SECONDS");
    dashCooldown           = config.getFloat("ENEMY_DASH_COOLDOWN");
    dashRangeMin           = config.getFloat("ENEMY_DASH_RANGE_MIN");
    dashRangeMax           = config.getFloat("ENEMY_DASH_RANGE_MAX");
    dashOffensiveChance    = config.getFloat("ENEMY_DASH_OFFENSIVE_CHANCE");
    dashOffensiveSpeed     = config.getFloat("ENEMY_DASH_OFFENSIVE_SPEED");
    dashOffensiveDuration  = config.getFloat("ENEMY_DASH_OFFENSIVE_DURATION");
    dashOffensiveWindup    = config.getFloat("ENEMY_DASH_OFFENSIVE_WINDUP_SECONDS");
    dashDefensiveSpeed     = config.getFloat("ENEMY_DASH_DEFENSIVE_SPEED");
    dashDefensiveDuration  = config.getFloat("ENEMY_DASH_DEFENSIVE_DURATION");
    dashGhostDuration         = config.getFloat("ENEMY_DASH_GHOST_DURATION");
    dashGhostInitialAlpha     = config.getFloat("ENEMY_DASH_GHOST_INITIAL_ALPHA");
    strafeSpeedFrac           = config.getFloat("ENEMY_STRAFE_SPEED_FRAC");
    strafeMinDist             = config.getFloat("ENEMY_STRAFE_MIN_DIST");
    strafeMaxDist             = config.getFloat("ENEMY_STRAFE_MAX_DIST");
    strafeDuration            = config.getFloat("ENEMY_STRAFE_DURATION");
    strafeSwitchInterval      = config.getFloat("ENEMY_STRAFE_SWITCH_INTERVAL");
    berserkHpFrac             = config.getFloat("ENEMY_BERSERK_HP_FRAC");
    berserkSpeedMult          = config.getFloat("ENEMY_BERSERK_SPEED_MULT");
    jukeChance                = config.getFloat("ENEMY_JUKE_CHANCE");
    jukeCooldownDuration      = config.getFloat("ENEMY_JUKE_COOLDOWN");
    jukeDuration              = config.getFloat("ENEMY_JUKE_DURATION");
    jukeAngleDeg              = config.getFloat("ENEMY_JUKE_ANGLE_DEG");
    jumpChance            = config.getFloat("ENEMY_JUMP_CHANCE");
    jumpCooldown          = config.getFloat("ENEMY_JUMP_COOLDOWN");
    jumpRangeMin          = config.getFloat("ENEMY_JUMP_RANGE_MIN");
    jumpRangeMax          = config.getFloat("ENEMY_JUMP_RANGE_MAX");
    jumpTelegraphDuration = config.getFloat("ENEMY_JUMP_TELEGRAPH_DURATION");
    jumpSpeed             = config.getFloat("ENEMY_JUMP_SPEED");
    jumpGhostDuration     = config.getFloat("ENEMY_JUMP_GHOST_DURATION");
    jumpGhostAlpha        = config.getFloat("ENEMY_JUMP_GHOST_ALPHA");
    jumpLandingDuration   = config.getFloat("ENEMY_JUMP_LANDING_DURATION");
    dashContactRadius     = config.getFloat("ENEMY_DASH_CONTACT_RADIUS");
    dashContactDamageFrac = config.getFloat("ENEMY_DASH_CONTACT_DAMAGE_FRAC");
    unarmedChargeAttackName = config.getString("ENEMY_UNARMED_CHARGE_ATTACK_NAME");
    // card-dash-through — hero dash-through-damage tunables (dodge.yaml).
    dashThroughRadius     = config.getFloat("DODGE_DASH_DAMAGE_RADIUS");
    dashThroughDamageFrac = config.getFloat("DODGE_DASH_DAMAGE_FRAC");
    dashThroughKnockback  = config.getFloat("DODGE_DASH_KNOCKBACK");
    alertMaxBroadcastsPerFrame = config.getInt("ENEMY_ALERT_MAX_BROADCASTS_PER_FRAME");
    loadAiTuning(config);  // Elite/Special AI multipliers + flank geometry (enemy_ai_tuning.yaml).
    loadAuthoredEncounterDefinitions();
}

void EnemyManager::refreshPerFrameCachedConfig() {
    attackFlashDuration       = configRef.getFloat("ENEMY_ATTACK_FLASH_DURATION");
    hitStopTakenSeconds       = configRef.getFloat("HIT_STOP_TAKEN_SECONDS");
    burstHurtName             = configRef.getString("BURST_HERO_HURT_NAME");
    burstHurtRadius           = configRef.getFloat("BURST_HERO_HURT_RADIUS");
    burstDeathName            = configRef.getString("BURST_ENEMY_DEATH_NAME");
    burstDeathRadius          = configRef.getFloat("BURST_ENEMY_DEATH_RADIUS");
    const auto readRgb = [&](const char* r, const char* g, const char* b) {
        return sf::Color(static_cast<std::uint8_t>(configRef.getInt(r)),
                         static_cast<std::uint8_t>(configRef.getInt(g)),
                         static_cast<std::uint8_t>(configRef.getInt(b)));
    };
    enemyTierColors[0] = readRgb("ENEMY_OUTLINE_R", "ENEMY_OUTLINE_G", "ENEMY_OUTLINE_B");
    enemyTierColors[1] = readRgb("ENEMY_OUTLINE_R_UNCOMMON", "ENEMY_OUTLINE_G_UNCOMMON",
                                 "ENEMY_OUTLINE_B_UNCOMMON");
    enemyTierColors[2] = readRgb("ENEMY_OUTLINE_R_RARE", "ENEMY_OUTLINE_G_RARE",
                                 "ENEMY_OUTLINE_B_RARE");
    heroAccentColor = sf::Color(
        static_cast<std::uint8_t>(configRef.getInt("HERO_OUTLINE_R")),
        static_cast<std::uint8_t>(configRef.getInt("HERO_OUTLINE_G")),
        static_cast<std::uint8_t>(configRef.getInt("HERO_OUTLINE_B")));
    armedAttackWindupSeconds  = configRef.getFloat("ENEMY_ARMED_ATTACK_WINDUP_SECONDS");
    critChanceCap             = configRef.getFloat("CRIT_CHANCE_CAP");
    diceProductFloor          = configRef.getFloat("DAMAGE_DICE_PRODUCT_FLOOR");
    damageFloor               = configRef.getFloat("DAMAGE_MINIMUM_FLOOR");
    enemyAttackDamageMult     = configRef.getFloat("ENEMY_ATTACK_DAMAGE_MULT");
    enemyAttackMinDamage      = configRef.getFloat("ENEMY_ATTACK_MIN_DAMAGE");
    enemyCollisionMaxResolveCount = configRef.getInt("ENEMY_COLLISION_MAX_RESOLVE_COUNT");
    enemyAiMaxUpdatesPerFrame = configRef.getInt("ENEMY_AI_MAX_UPDATES_PER_FRAME");
    dashOffensiveChance       = configRef.getFloat("ENEMY_DASH_OFFENSIVE_CHANCE");
    dashOffensiveWindup       = configRef.getFloat("ENEMY_DASH_OFFENSIVE_WINDUP_SECONDS");
    unarmedChargeAttackName = configRef.getString("ENEMY_UNARMED_CHARGE_ATTACK_NAME");
    spawnAnimDuration = configRef.getFloat("ENEMY_SPAWN_ANIM_DURATION");
    spawnPortalCloseFraction = configRef.getFloat("ENEMY_SPAWN_PORTAL_CLOSE_FRACTION");
    alertMaxBroadcastsPerFrame = configRef.getInt("ENEMY_ALERT_MAX_BROADCASTS_PER_FRAME");
    loadAiTuning(configRef);
}

void EnemyManager::refreshAlertQueryMovementSlack(const dof::core::World& world, float dt) {
    float maxStepSpeed = std::max({jumpSpeed,
                                   dashOffensiveSpeed,
                                   dashDefensiveSpeed,
                                   configRef.getFloat("ENEMY_CHARGE_DASH_SPEED")});
    for (const auto& enemy : world.enemies()) {
        if (!enemy || enemy->deathable().isDead || enemy->damageable().isDead()) continue;
        maxStepSpeed = std::max(maxStepSpeed, enemy->moveable().moveSpeed * std::max(1.0f, berserkSpeedMult));
    }
    alertQueryMovementSlack = std::max(0.0f, maxStepSpeed * std::max(0.0f, dt)) + collisionRadius * 2.0f;
}

void EnemyManager::update(dof::core::World& world, float dt) {
    refreshPerFrameCachedConfig();
    alertBroadcastsThisFrame = 0;
    tickWaveSpawning(world);
    refreshAlertQueryMovementSlack(world, dt);

    // Spec §Appendix J §Spatial Grid: rebuild before the AI tick
    // so any consumer that wants neighbour lookups (this frame's
    // collision resolution, batch firing, etc.) sees an up-to-date
    // bucket layout. Dead enemies are skipped — they're already
    // out of the gameplay loop and would only pollute the buckets
    // they happened to die in.
    rebuildSpatialGrid(world);

    // Snapshot the "dead before this tick" set BEFORE firing any death
    // branch so a Shocker AOE that kills a neighbour later in the same
    // tick does NOT recursively trigger that neighbour's own AOE this
    // frame (spec L621 fires once per Shocker, not per chain hop).
    processEnemyDeaths(world);
    auto& enemies = world.enemies();
    const bool isAiLimited = enemyAiMaxUpdatesPerFrame > 0
                          && enemies.size() > static_cast<std::size_t>(enemyAiMaxUpdatesPerFrame);
    const std::size_t aiStart = enemies.empty() ? 0 : enemyAiUpdateCursor % enemies.size();
    const std::size_t aiSlots =
        isAiLimited ? static_cast<std::size_t>(enemyAiMaxUpdatesPerFrame) : enemies.size();
    for (std::size_t offset = 0; offset < enemies.size(); ++offset) {
        const std::size_t enemyIndex = isAiLimited
            ? (aiStart + offset) % enemies.size()
            : offset;
        auto& enemy = enemies[enemyIndex];
        if (enemy->deathable().isDead) {
            enemyAiDeferredSeconds.erase(enemy->id().value);
            enemy->deathable().advance(dt);
            continue;
        }
        // A 0-HP enemy killed earlier in THIS same frame (e.g. by a Shocker
        // death-AOE above) is damageable-dead but not yet deathable-marked
        // until next frame's pre-AI snapshot — skip its AI so it can't chase
        // or land an attack on its dying frame.
        if (enemy->damageable().isDead()) {
            enemyAiDeferredSeconds.erase(enemy->id().value);
            continue;
        }
        auto& hunt = enemy->huntable();
        auto& spawnTimer = hunt.spawnAnimTimer;
        if (spawnTimer > 0.0f) {
            const float previousTimer = spawnTimer;
            spawnTimer = std::max(0.0f, spawnTimer - dt);
            if (spatialAudioPtr && !hunt.hasPlayedSpawnPortalCloseSound
                && spawnAnimDuration > 0.0f) {
                const float beforeProgress =
                    std::clamp(1.0f - previousTimer / spawnAnimDuration, 0.0f, 1.0f);
                const float afterProgress =
                    std::clamp(1.0f - spawnTimer / spawnAnimDuration, 0.0f, 1.0f);
                const float closeFraction = std::clamp(spawnPortalCloseFraction, 0.0f, 1.0f);
                if (beforeProgress < closeFraction && afterProgress >= closeFraction) {
                    spatialAudioPtr->playPortalClose(enemy->spawnPosition());
                    hunt.hasPlayedSpawnPortalCloseSound = true;
                }
            }
            continue;
        }
        if (isAiLimited && offset >= aiSlots) {
            enemyAiDeferredSeconds[enemy->id().value] += std::max(0.0f, dt);
            continue;
        }
        float effectiveDt = dt;
        if (const auto deferred = enemyAiDeferredSeconds.find(enemy->id().value);
            deferred != enemyAiDeferredSeconds.end()) {
            effectiveDt += deferred->second;
            enemyAiDeferredSeconds.erase(deferred);
        }
        tickAi(world, *enemy, effectiveDt);
    }
    if (isAiLimited && !enemies.empty()) {
        enemyAiUpdateCursor = (aiStart + aiSlots) % enemies.size();
    } else {
        enemyAiUpdateCursor = 0;
    }
    // AI movement has changed positions; refresh before grid-backed hero dash
    // damage and any later systems that query this frame's enemy locations.
    rebuildSpatialGrid(world);
    // card-dash-through — apply the hero's offensive dash damage + knockback
    // after every enemy has taken its AI step, so the shove acts on settled
    // positions and the subsequent collision pass resolves any overlap.
    applyHeroDashDamage(world);
    // Enemy-vs-enemy separation: resolve body overlaps AFTER every enemy has
    // taken its AI step this frame, so the push acts on final positions and is
    // not re-overwritten by a later chase/strafe move within the same tick.
    resolveEnemyCollisions(world);
    world.removeDeadEnemies(deathAnimDuration);
    // Third and final rebuild of the tick, and the one every between-update
    // reader observes. Load-bearing: `removeDeadEnemies` just erased the
    // owning unique_ptrs of the fully-faded enemies, so without this the grid
    // would keep returning ids that no longer resolve against
    // `world.enemies()` — including to WeaponManager, which targets through
    // `spatialGrid()` between updates.
    rebuildSpatialGrid(world);
}

void EnemyManager::tickWaveSpawning(dof::core::World& world) {
    ensureAuthoredRegionEnemies(world);
    if (weaponSlotHubPtr != nullptr) {
        // The enemies are physically present from region load. These phases
        // only unlock their authored behaviour; no portal spawn is involved.
        switch (wavePhase) {
        case WavePhase::Idle:
            break;
        case WavePhase::ScoutAlive:
            if (openingScoutEnemyId != 0u) {
                const auto scout = std::find_if(
                    world.enemies().begin(), world.enemies().end(),
                    [&](const auto& enemy) {
                        return enemy && enemy->id().value == openingScoutEnemyId;
                    });
                if (scout == world.enemies().end()
                    || (*scout)->damageable().isDead()) {
                    openingScoutEnemyId = 0u;
                    wavePhase = WavePhase::DiceEquipWait;
                }
            } else {
                wavePhase = WavePhase::DiceEquipWait;
            }
            break;
        case WavePhase::DiceEquipWait:
            if (hasAnyRequiredDiceSlotted()) {
                activateAuthoredEncounter(1);
                wavePhase = WavePhase::GroupAlive;
            }
            break;
        case WavePhase::GroupAlive: {
            const bool isWholeOpeningGroupDead = !openingGroupEnemyIds.empty()
                && std::all_of(openingGroupEnemyIds.begin(), openingGroupEnemyIds.end(),
                    [&](std::uint64_t groupEnemyId) {
                        const auto member = std::find_if(
                            world.enemies().begin(), world.enemies().end(),
                            [groupEnemyId](const auto& enemy) {
                                return enemy && enemy->id().value == groupEnemyId;
                            });
                        return member == world.enemies().end()
                            || (*member)->damageable().isDead();
                    });
            if (isWholeOpeningGroupDead) {
                openingGroupEnemyIds.clear();
                wavePhase = WavePhase::Exploration;
            }
            break;
        }
        case WavePhase::Exploration:
            break;
        }
    }
}

void EnemyManager::processEnemyDeaths(dof::core::World& world) {
    std::vector<dof::entities::Enemy*> deadAtTickStart;
    for (auto& enemy : world.enemies()) {
        if (enemy->damageable().isDead() && !enemy->deathable().isDead) {
            deadAtTickStart.push_back(enemy.get());
        }
    }
    for (auto* enemy : deadAtTickStart) {
        if (spatialAudioPtr) spatialAudioPtr->playEnemyDeath(enemy->moveable().position);
        // Death burst tinted with the dying enemy's OWN tier colour, so a Rare
        // kill reads differently from a Common one and the burst can never
        // drift outside the locked palette as tiers are re-tuned (Step 11).
        if (effectBurstHubPtr) {
            effectBurstHubPtr->request(burstDeathName, enemy->moveable().position,
                                       tierOutlineColor(enemy->tier()),
                                       burstDeathRadius);
        }
        enemy->deathable().markDead();
        recordSpawnExclusion(enemy->spawnPosition());
        if (enemy->specialKind() == dof::entities::SpecialEnemyKind::Shocker) {
            triggerShockerDeathAOE(world, *enemy);
        }
        const bool didDropEquipment = spawnDeathLoot(world, *enemy);
        if (!didDropEquipment && vitalityTankPtr) {
            vitalityTankPtr->addEmptyKillCharge();
        }
    }
}

void EnemyManager::spawnAt(dof::core::World& world,
                           sf::Vector2f spawnPosition,
                           int explicitLevel) {
    const int enemyLevel = (explicitLevel > 0) ? explicitLevel : computeLevelFromDistance(spawnPosition);
    const auto tier = nextTier(spawnPosition);
    auto enemy = std::make_unique<dof::entities::Enemy>(world.allocateId(), enemyLevel, tier);
    enemy->moveable().teleportTo(spawnPosition);
    enemy->setSpawnPosition(spawnPosition);
    enemy->targetable().anchorPosition = spawnPosition;
    enemy->targetable().collisionRadius = collisionRadius;
    applyTierAndLevel(*enemy, enemyLevel, tier);
    enemy->huntable().spawnAnimTimer = spawnAnimDuration;
    enemy->huntable().hasPlayedSpawnPortalCloseSound = false;
    // Phase 14 — Special Enemy substitution. Picks a Special kind for
    // this slot per the gate predicate; non-None applies the per-kind
    // stat overrides on top of the baseline tier values.
    const auto special = pickSpecialForSpawn(tier, spawnPosition, world);
    enemy->setSpecialKind(special);
    if (special != dof::entities::SpecialEnemyKind::None) {
        applySpecialEnemyOverride(*enemy);
    }
    rollEnemyLoadout(world, *enemy);
    if (spatialAudioPtr) spatialAudioPtr->playPortalOpen(spawnPosition);
    world.enemies().push_back(std::move(enemy));
    ++spawnCounter;
}

void EnemyManager::spawnAt(
    dof::core::World& world, sf::Vector2f spawnPosition,
    int level, dof::entities::QualityTier tier) {
    auto enemy = std::make_unique<dof::entities::Enemy>(world.allocateId(), level, tier);
    enemy->moveable().teleportTo(spawnPosition);
    enemy->setSpawnPosition(spawnPosition);
    enemy->targetable().anchorPosition = spawnPosition;
    enemy->targetable().collisionRadius = collisionRadius;
    applyTierAndLevel(*enemy, level, tier);
    enemy->huntable().spawnAnimTimer = spawnAnimDuration;
    enemy->huntable().hasPlayedSpawnPortalCloseSound = false;
    rollEnemyLoadout(world, *enemy);
    if (spatialAudioPtr) spatialAudioPtr->playPortalOpen(spawnPosition);
    world.enemies().push_back(std::move(enemy));
    ++spawnCounter;
}

dof::entities::SpecialEnemyKind EnemyManager::pickSpecialForSpawn(dof::entities::QualityTier tier,
                                                                    sf::Vector2f spawnPosition,
                                                                    const dof::core::World& world) {
    const bool insideExclusion = isExcludedSpawn(spawnPosition);
    const int heroLevel = world.hero().levelable().level;
    // Only Glasswraith consumes RNG; defer roll so non-eligible spawns
    // leave the stream untouched (deterministic-replay invariant). The
    // 1.0f sentinel always fails `< 1/N` inside pickSpecialKind.
    const float roll = (heroLevel >= specialGates.glasswraithHeroLevelGate)
                           ? rngRef.uniformFloat(0.0f, 1.0f)
                           : 1.0f;
    auto kind = dof::combat::pickSpecialKind(tier, specialCounters, heroLevel,
                                              insideExclusion, roll, specialGates);
    // Increment the per-tier counters for the slot just claimed; reset
    // the matching counter when a special fires so the "every Nth"
    // cycle restarts.
    if (tier == dof::entities::QualityTier::Uncommon) {
        if (kind == dof::entities::SpecialEnemyKind::Shocker) {
            specialCounters.uncommonSinceLastShocker = 0;
        } else {
            ++specialCounters.uncommonSinceLastShocker;
        }
    } else if (tier == dof::entities::QualityTier::Rare) {
        if (kind == dof::entities::SpecialEnemyKind::Hexarchon) {
            specialCounters.rareSinceLastHexarchon = 0;
        } else {
            ++specialCounters.rareSinceLastHexarchon;
        }
        if (kind == dof::entities::SpecialEnemyKind::Voidcrawler) {
            specialCounters.rareSinceLastVoidcrawler = 0;
        } else {
            ++specialCounters.rareSinceLastVoidcrawler;
        }
    }
    return kind;
}

void EnemyManager::applySpecialKindAfterSpawn(dof::entities::Enemy& enemy) {
    applySpecialEnemyOverride(enemy);
}

void EnemyManager::applySpecialEnemyOverride(dof::entities::Enemy& enemy) {
    const auto override = dof::combat::loadSpecialEnemyStatOverride(enemy.specialKind(), configRef);
    if (override.healthMultiplier > 0.0f && override.healthMultiplier != 1.0f) {
        const float scaled = enemy.damageable().maxHealth * override.healthMultiplier;
        enemy.damageable().maxHealth = scaled;
        enemy.damageable().health    = scaled;
    }
    if (override.speedMultiplier > 0.0f && override.speedMultiplier != 1.0f) {
        enemy.moveable().moveSpeed *= override.speedMultiplier;
    }
    // deadzoneFactor override is consumed by tickAi (per-enemy
    // deadzone widen). Stored on the Enemy via specialKind so AI
    // can re-look it up without keeping an Override-by-ID map.
}

int EnemyManager::totalSpawns() const { return spawnCounter; }

// EnemyManager::tickAi lives in EnemyManager_Ai.cpp (chase / attack /
// Doge-evasion behaviour) so spawn / death / loot stay isolated here.

void EnemyManager::setEvasionContext(dof::hubs::EvasionHub& evasionHub,
                                  const dof::hubs::WeaponSlotHub& weaponSlotHub) {
    evasionHubPtr       = &evasionHub;
    weaponSlotHubPtr = &weaponSlotHub;
}

void EnemyManager::setLootContext(dof::makers::LootMaker& lootMaker,
                                  dof::hubs::LuckHub& luckHub) {
    lootMakerPtr = &lootMaker;
    luckHubPtr   = &luckHub;
}

void EnemyManager::setVitalityTank(dof::hubs::VitalityTank& vitalityTank) {
    vitalityTankPtr = &vitalityTank;
}

void EnemyManager::setXpRewardContext(dof::hubs::XpFloatHub& xpFloatHub) {
    xpFloatHubPtr = &xpFloatHub;
}

void EnemyManager::setSpatialAudio(dof::audio::SpatialAudio* audio) {
    spatialAudioPtr = audio;
}

void EnemyManager::setEquipContext(dof::makers::WeaponMaker& weaponMaker,
                                   dof::makers::DiceMaker& diceMaker) {
    weaponMakerPtr = &weaponMaker;
    diceMakerPtr   = &diceMaker;
}

int EnemyManager::computeLevelFromDistance(sf::Vector2f spawnPosition) const {
    const float distance = dof::helpers::distanceBetween(spawnPosition, heroStart);
    if (!levelCurve) return 1;
    return levelCurve->levelFromDistance(distance);
}

dof::entities::QualityTier EnemyManager::nextTier(sf::Vector2f spawnPosition) {
    // `++spawnCounter` itself lives in `spawnAt` (post-spawn);
    // here we peek at the next counter value to decide the tier
    // for the spawn that's about to fire.
    const int counter = spawnCounter + 1;
    // SE2 — distance-quintile cadence. Spawn position's walked
    // distance (from hero start) gives the progress fraction
    // against `cum[maxLevel]`; that picks the cadence quintile.
    // Pre-SE2 the cadence was a hard-coded `% 100` / `% 10` that
    // ignored hero progress entirely.
    float progress = 0.0f;
    if (levelCurve && tierCadence) {
        const float walked = dof::helpers::distanceBetween(spawnPosition, heroStart);
        const float budget = levelCurve->cumulativeForLevel(levelCurve->maxLevel());
        progress = (budget > 0.0f) ? (walked / budget) : 0.0f;
    }
    const dof::combat::TierCadencePair cadence = tierCadence
        ? tierCadence->cadenceFor(progress)
        : dof::combat::TierCadencePair{100, 10};
    if (cadence.rare > 0 && counter % cadence.rare == 0)
        return dof::entities::QualityTier::Rare;
    if (cadence.uncommon > 0 && counter % cadence.uncommon == 0)
        return dof::entities::QualityTier::Uncommon;
    return dof::entities::QualityTier::Common;
}


const std::deque<sf::Vector2f>& EnemyManager::spawnExclusions() const {
    return spawnExclusionFifo;
}

void EnemyManager::resetSpawnState() {
    spawnCounter = 0;
    // spawnExclusionFifo is intentionally NOT cleared here: exclusion zones
    // are keyed on the kill history across the whole session, not a single
    // run. Clearing on respawn caused zones to vanish on death.
    grid.clear();
    specialCounters.reset();
    wavePhase           = WavePhase::Idle;
    openingGroupEnemyIds.clear();
    openingScoutEnemyId = 0u;
    isAuthoredRegionPlaced = false;
    areWorldEditorEnemiesSynchronized = false;
    worldEditorEnemyIds.clear();
    authoredEnemyStates.clear();

    // Rationale: Stale alert targets from the previous game session/run must be purged
    // to prevent newly spawned enemies from immediately marching toward stale alert coordinates.
    // Constraints: Must be cleared entirely during spawning state reset. Because entity IDs
    // can be recycled across session resets, failing to clear this map would cause immediate
    // incorrect pathing if a newly spawned enemy is assigned a recycled ID that has a lingering alert.
    // Side-effects: Discards all active alerts, forcing all enemies to start in their default
    // unalerted state upon session reset.
    alertTargetMap.clear();
    enemyAiUpdateCursor = 0;
    enemyAiDeferredSeconds.clear();
}

const dof::core::SpatialGrid& EnemyManager::spatialGrid() const {
    return grid;
}

void EnemyManager::rebuildSpatialGrid(dof::core::World& world) {
    const auto start = std::chrono::steady_clock::now();
    grid.clear();
    spatialGridEnemyById.clear();
    spatialGridEnemyById.reserve(world.enemies().size());
    for (auto& enemy : world.enemies()) {
        if (enemy->deathable().isDead) continue;
        grid.insert(enemy->id(), enemy->moveable().position);
        spatialGridEnemyById.emplace(enemy->id().value, enemy.get());
    }
    const auto end = std::chrono::steady_clock::now();
    dof::diagnostics::addGridRebuildMs(
        std::chrono::duration<float, std::milli>(end - start).count());
}

void EnemyManager::commitGroundedMove(dof::entities::Enemy& enemy) {
    // Pin the targeting anchor to the freshly-moved position.
    enemy.targetable().anchorPosition = enemy.moveable().position;
}

sf::Color EnemyManager::tierOutlineColor(dof::entities::QualityTier tier) const {
    if (tier == dof::entities::QualityTier::Uncommon) return enemyTierColors[1];
    if (tier == dof::entities::QualityTier::Rare)     return enemyTierColors[2];
    return enemyTierColors[0];
}

}
