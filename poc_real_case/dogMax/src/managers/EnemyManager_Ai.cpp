#include "managers/EnemyManager.hpp"

#include "audio/SpatialAudio.hpp"
#include "entities/Dice.hpp"
#include "loaders/ConfigLoader.hpp"
#include "entities/Weapon.hpp"
#include "hubs/DamageTextHub.hpp"
#include "hubs/EvasionHub.hpp"
#include "hubs/WeaponSlotHub.hpp"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <memory>
#include <numbers>
#include <span>
#include <unordered_map>
#include <vector>

#include "core/SpatialGrid.hpp"
#include "core/World.hpp"
#include "entities/Hero.hpp"
#include "helpers/MathHelper.hpp"
#include "helpers/RandomHelper.hpp"
#include "loaders/ConfigLoader.hpp"

namespace dof::managers {

namespace {

float scaleByEliteTier(const dof::entities::Enemy& enemy,
                       float base,
                       float specialMult,
                       float rareMult,
                       float uncommonMult) {
    if (enemy.specialKind() != dof::entities::SpecialEnemyKind::None) {
        return base * specialMult;
    }
    if (enemy.isElite()) {
        return base * (enemy.tier() == dof::entities::QualityTier::Rare
                           ? rareMult
                           : uncommonMult);
    }
    return base;
}

}

void EnemyManager::tickAi(dof::core::World& world, dof::entities::Enemy& enemy, float dt) {
    if (enemy.huntable().attackFlashTimer > 0.0f)
        enemy.huntable().attackFlashTimer = std::max(0.0f, enemy.huntable().attackFlashTimer - dt);

    auto& dash = enemy.dashState();
    auto& mind = enemy.mind();

    dash.advanceCooldowns(dt);
    dash.advanceGhost(dt);
    mind.advanceTimers(dt);

    auto& hero = world.hero();
    if (hero.damageable().isDead()) return;
    if (!prepareAuthoredEnemyForAi(world, enemy, dt)) return;

    if (tickActiveJumpArc(world, enemy, dt)) return;
    if (!dash.isDashing) mind.isActiveJump = false;

    if (tickActiveDash(world, enemy, dt)) return;

    if (tickOffensiveDashTelegraph(enemy)) return;

    if (tickJumpTelegraph(enemy)) return;

    const auto  heroPos    = hero.moveable().position;
    const auto  enemyPos   = enemy.moveable().position;
    const float dx         = heroPos.x - enemyPos.x;
    const float dy         = heroPos.y - enemyPos.y;
    const float distanceSq = dx * dx + dy * dy;
    const float dist       = std::sqrt(distanceSq);

    if (enemy.loadout().isArmedAttackWindingUp()) {
        tickArmedAttack(world, enemy, dt, distanceSq);
        enemy.moveable().velocity = {0.0f, 0.0f};
        return;
    }

    // Berserk — re-latched each tick so it activates/deactivates with HP.
    const float hpRatio = enemy.damageable().healthRatio();
    mind.isBerserk = (hpRatio > 0.0f && hpRatio < berserkHpFrac);

    // Unarmed enemies (weapon combat on) charge the hero instead of the
    // generic dash/jump AI and the flat melee. Winding up freezes the enemy
    // so the telegraph reads; the lunge is then a normal Dashable arc.
    if (!enemy.loadout().isArmed()) {
        if (tickUnarmedCharge(world, enemy, dt, distanceSq)) {
            enemy.moveable().velocity = {0.0f, 0.0f};
            return;
        }
    }

    // Rationale: Scale dash and jump stats dynamically based on Elite and Special kinds.
    // Elites (Uncommon/Rare) and Special enemies are designed to be significantly more
    // mobile and aggressive, making encounters much more challenging for the player.
    // Constraints: Relies on cached config values (jumpChance, jumpCooldown, etc.) as the baseline.
    const float effectiveJumpChance = std::min(1.0f, scaleByEliteTier(
        enemy, jumpChance, specialJumpChanceMult, rareJumpChanceMult, uncommonJumpChanceMult));
    const float effectiveJumpCooldown = scaleByEliteTier(
        enemy, jumpCooldown, specialJumpCooldownMult, rareJumpCooldownMult, uncommonJumpCooldownMult);
    const float effectiveDashChance = std::min(1.0f, scaleByEliteTier(
        enemy, dashOffensiveChance, specialDashChanceMult, rareDashChanceMult, uncommonDashChanceMult));
    const float effectiveDashCooldown = scaleByEliteTier(
        enemy, dashCooldown, specialDashCooldownMult, rareDashCooldownMult, uncommonDashCooldownMult);

    // Jump — long-range leap, triggers outside offensive-dash band.
    if (dist >= jumpRangeMin && dist <= jumpRangeMax && mind.jumpCooldown <= 0.0f) {
        if (rngRef.bernoulli(static_cast<double>(effectiveJumpChance))) {
            mind.jumpCooldown = effectiveJumpCooldown;
            mind.jumpTargetPos         = heroPos;
            mind.jumpTelegraphTimer    = jumpTelegraphDuration;
            mind.isJumpTelegraphing    = true;
            enemy.moveable().velocity  = {0.0f, 0.0f};
            return;
        } else {
            // Rationale: Consumes a minor retry cooldown on roll failure instead of the full
            // cooldown duration. This makes the enemy retry the action sooner when the player
            // remains within the range band, keeping engagement high and gameplay challenging.
            mind.jumpCooldown = jumpRetryCooldown;
        }
    }

    // Offensive dash — lunge toward hero when in the configured range band.
    {
        if (dist >= dashRangeMin && dist <= dashRangeMax && dash.offensiveCooldown <= 0.0f) {
            if (rngRef.bernoulli(static_cast<double>(effectiveDashChance))) {
                dash.offensiveCooldown = effectiveDashCooldown;
                mind.isOffensiveDashTelegraphing = true;
                mind.offensiveDashTelegraphTotal = std::max(0.0f, dashOffensiveWindup);
                mind.offensiveDashTelegraphTimer = mind.offensiveDashTelegraphTotal;
                mind.offensiveDashTargetPos = heroPos;
                mind.offensiveDashReach = dashOffensiveSpeed * dashOffensiveDuration;
                // Armed enemies use this generic dash only to reposition; their
                // weapon wind-up owns the damaging attack. A zero radius lets
                // the renderer communicate movement without painting a false
                // contact-damage footprint.
                mind.offensiveDashContactRadius = enemy.loadout().isArmed()
                    ? 0.0f : dashContactRadius;
                enemy.moveable().velocity = {0.0f, 0.0f};
                return;
            } else {
                // Rationale: Retries the dash check in 0.5 seconds on roll failure rather than
                // locking the enemy out of dashing for the full cooldown period, increasing tactical threat.
                dash.offensiveCooldown = dashRetryCooldown;
            }
        }
    }

    const bool isInChaseRange = (distanceSq <= chaseRange * chaseRange);

    if (isInChaseRange) {
        if (alertMaxBroadcastsPerFrame <= 0
            || alertBroadcastsThisFrame < alertMaxBroadcastsPerFrame) {
            ++alertBroadcastsThisFrame;
            broadcastAlert(world, enemy);
        }
        alertTargetMap.erase(enemy.id().value);

        tickChaseMovement(enemy, dt, dx, dy, distanceSq, dist);
        tickAttack(world, enemy, dt, distanceSq);
    } else {
        tickAlertFallback(enemy, dt);
    }
}

void EnemyManager::applyDashContactDamage(dof::core::World& world, dof::entities::Enemy& enemy) {
    auto& dash = enemy.dashState();
    if (dash.hasDealtContactDamage) return;
    if (enemy.loadout().isArmed()) return;

    auto& hero = world.hero();
    const auto  ePos = enemy.moveable().position;
    const auto  hPos = hero.moveable().position;
    const float cdx  = ePos.x - hPos.x;
    const float cdy  = ePos.y - hPos.y;
    if (cdx * cdx + cdy * cdy > dashContactRadius * dashContactRadius) return;

    dash.hasDealtContactDamage = true;
    applyEnemyHitToHero(enemy, hero,
                        hero.damageable().maxHealth * dashContactDamageFrac,
                        /*isCritical=*/false, unarmedChargeAttackName);
}

bool EnemyManager::tickActiveJumpArc(dof::core::World& world,
                                      dof::entities::Enemy& enemy,
                                      float dt) {
    auto& dash = enemy.dashState();
    auto& mind = enemy.mind();
    if (!(dash.isDashing && mind.isActiveJump)) return false;

    const bool wasAirborne = dash.isDashing;
    dash.advanceDash(dt);
    enemy.moveable().velocity = {dash.dashDirection.x * dash.dashSpeed,
                                  dash.dashDirection.y * dash.dashSpeed};
    enemy.moveable().advance(dt);
    commitGroundedMove(enemy);
    applyDashContactDamage(world, enemy);

    // Dash just ended → snap to target, start landing shockwave.
    if (wasAirborne && !dash.isDashing) {
        mind.isActiveJump             = false;
        enemy.moveable().position     = mind.jumpTargetPos;
        commitGroundedMove(enemy);
        mind.isJumpLanding            = true;
        mind.jumpLandingTotal         = jumpLandingDuration;
        mind.jumpLandingTimer         = jumpLandingDuration;
    }
    return true;
}

bool EnemyManager::tickActiveDash(dof::core::World& world,
                                  dof::entities::Enemy& enemy,
                                  float dt) {
    auto& dash = enemy.dashState();
    if (!dash.isDashing) return false;

    dash.advanceDash(dt);
    enemy.moveable().velocity = {dash.dashDirection.x * dash.dashSpeed,
                                  dash.dashDirection.y * dash.dashSpeed};
    enemy.moveable().advance(dt);
    commitGroundedMove(enemy);
    applyDashContactDamage(world, enemy);
    return true;
}

bool EnemyManager::tickOffensiveDashTelegraph(dof::entities::Enemy& enemy) {
    auto& mind = enemy.mind();
    if (!mind.isOffensiveDashTelegraphing) return false;

    enemy.moveable().velocity = {0.0f, 0.0f};
    if (mind.offensiveDashTelegraphTimer > 0.0f) return true;

    mind.isOffensiveDashTelegraphing = false;
    const sf::Vector2f origin = enemy.moveable().position;
    const sf::Vector2f direction = dof::helpers::normalizeOrZero({
        mind.offensiveDashTargetPos.x - origin.x,
        mind.offensiveDashTargetPos.y - origin.y});
    enemy.dashState().armDash(direction, dashOffensiveSpeed, dashOffensiveDuration,
                              origin, dashGhostDuration, dashGhostInitialAlpha);
    if (spatialAudioPtr && !enemy.loadout().isArmed()) {
        spatialAudioPtr->playEnemyUnarmedDash(origin);
    }
    return true;
}

bool EnemyManager::tickJumpTelegraph(dof::entities::Enemy& enemy) {
    auto& dash = enemy.dashState();
    auto& mind = enemy.mind();
    if (!mind.isJumpTelegraphing) return false;

    // Jump telegraph phase: enemy frozen, yellow ring at hero position.
    if (mind.jumpTelegraphTimer <= 0.0f) {
        // Launch arc — duration = dist/speed so enemy lands exactly on target.
        mind.isJumpTelegraphing = false;
        mind.isActiveJump       = true;
        const auto  ePos = enemy.moveable().position;
        const auto  tgt  = mind.jumpTargetPos;
        const float jdx  = tgt.x - ePos.x;
        const float jdy  = tgt.y - ePos.y;
        const float dist = std::sqrt(jdx * jdx + jdy * jdy);
        const float dur  = (dist > 0.0f) ? dist / jumpSpeed : 0.1f;
        const sf::Vector2f dir = dof::helpers::normalizeOrZero({jdx, jdy});
        mind.jumpStartPos = ePos;
        dash.armDash(dir, jumpSpeed, dur, ePos, jumpGhostDuration, jumpGhostAlpha);
        if (spatialAudioPtr) spatialAudioPtr->playEnemyJump(ePos);
    }
    enemy.moveable().velocity = {0.0f, 0.0f};
    return true;
}

void EnemyManager::tickChaseMovement(dof::entities::Enemy& enemy,
                                     float dt,
                                     float dx,
                                     float dy,
                                     float distanceSq,
                                     float dist) {
    auto& mind = enemy.mind();
    float effectiveDeadzoneFactor = deadzoneFactor;
    if (enemy.specialKind() == dof::entities::SpecialEnemyKind::Hexarchon) {
        const float hexFactor = configRef.getFloat("SPECIAL_HEXARCHON_DEADZONE_FACTOR");
        if (hexFactor > 0.0f) effectiveDeadzoneFactor = hexFactor;
    }
    const float deadzone = attackRange * effectiveDeadzoneFactor;

    if (distanceSq > deadzone * deadzone) {
        // CHASE — moving toward the hero.
        if (!mind.isJuking && mind.jukeCooldown <= 0.0f) {
            const float effectiveJukeChance = std::min(1.0f, scaleByEliteTier(
                enemy, jukeChance, specialJukeChanceMult, rareJukeChanceMult, uncommonJukeChanceMult));
            if (rngRef.bernoulli(static_cast<double>(effectiveJukeChance))) {
                const float sign = rngRef.bernoulli(0.5) ? 1.0f : -1.0f;
                mind.jukePerp   = {-dy / (dist + 1e-6f) * sign, dx / (dist + 1e-6f) * sign};
                mind.jukeTimer  = jukeDuration;
                mind.jukeCooldown = jukeCooldownDuration;
                mind.isJuking   = true;
            }
        }

        sf::Vector2f direction = dof::helpers::normalizeOrZero({dx, dy});
        if (mind.isJuking) {
            const float rad = jukeAngleDeg * (std::numbers::pi_v<float> / 180.0f);
            const float c   = std::cos(rad);
            const float s   = std::sin(rad) *
                (mind.jukePerp.x * direction.y - mind.jukePerp.y * direction.x >= 0.0f ? 1.0f : -1.0f);
            direction = dof::helpers::normalizeOrZero({
                c * direction.x - s * direction.y,
                s * direction.x + c * direction.y
            });
        } else if (dist < flankMaxDistance && dist > attackRange) {
            // Stable deterministic flank offset from enemy id.
            float blend = 1.0f;
            if (dist > flankMidDistance) {
                blend = (flankMaxDistance - dist) / flankBlendDivisor;
            } else {
                blend = (dist - attackRange) / (flankMidDistance - attackRange);
            }
            blend = std::max(0.0f, std::min(1.0f, blend));

            const double hFlank = static_cast<double>(enemy.id().value ^ 0x5E5C0DE) * 0.61803398875;
            const float flankRoll = static_cast<float>(hFlank - std::floor(hFlank));
            const float maxFlankAngleDeg = flankMaxAngleDeg;
            const float flankAngleDeg = (flankRoll - 0.5f) * 2.0f * maxFlankAngleDeg * blend;
            const float rad = flankAngleDeg * (std::numbers::pi_v<float> / 180.0f);
            const float c   = std::cos(rad);
            const float s   = std::sin(rad);
            direction = dof::helpers::normalizeOrZero({
                c * direction.x - s * direction.y,
                s * direction.x + c * direction.y
            });
        }

        enemy.moveable().setVelocityFromDirection(direction);
        if (mind.isBerserk) {
            enemy.moveable().velocity.x *= berserkSpeedMult;
            enemy.moveable().velocity.y *= berserkSpeedMult;
        }
        enemy.moveable().advance(dt);
        commitGroundedMove(enemy);
    } else {
        // DEADZONE — in attack range but not yet at melee range.
        const bool inStrafeRange = (dist >= strafeMinDist && dist <= strafeMaxDist);
        if (inStrafeRange) {
            if (!mind.isStrafing) {
                mind.strafeTimer       = strafeDuration;
                mind.strafeSwitchTimer = strafeSwitchInterval;
                mind.isStrafing        = true;
            }
            if (mind.strafeSwitchTimer <= 0.0f) {
                mind.strafeDir        = -mind.strafeDir;
                mind.strafeSwitchTimer = strafeSwitchInterval;
            }
            const sf::Vector2f perp = dof::helpers::normalizeOrZero(
                {-dy * mind.strafeDir, dx * mind.strafeDir});
            const float strafeSpeed = enemy.moveable().moveSpeed * strafeSpeedFrac;
            enemy.moveable().velocity = {perp.x * strafeSpeed, perp.y * strafeSpeed};
            enemy.moveable().advance(dt);
            commitGroundedMove(enemy);
        } else {
            mind.isStrafing           = false;
            enemy.moveable().velocity = {0.0f, 0.0f};
        }
    }
}

void EnemyManager::tickAttack(dof::core::World& world,
                              dof::entities::Enemy& enemy,
                              float dt,
                              float distanceSq) {
    if (enemy.loadout().isArmed()) {
        // Armed enemies fire their weapons at the hero (dice-paced and
        // weapon-range-gated). Unarmed attacks are handled by the charge path.
        tickArmedAttack(world, enemy, dt, distanceSq);
    }
}

void EnemyManager::tickAlertFallback(dof::entities::Enemy& enemy, float dt) {
    auto it = alertTargetMap.find(enemy.id().value);
    if (it == alertTargetMap.end()) return;

    const sf::Vector2f target  = it->second;
    const float        tx      = target.x - enemy.moveable().position.x;
    const float        ty      = target.y - enemy.moveable().position.y;
    const float        tDistSq = tx * tx + ty * ty;
    const float        arrivalR = collisionRadius * 2.0f;
    if (tDistSq > arrivalR * arrivalR) {
        enemy.moveable().setVelocityFromDirection(dof::helpers::normalizeOrZero({tx, ty}));
        enemy.moveable().advance(dt);
        commitGroundedMove(enemy);
    } else {
        enemy.moveable().velocity = {0.0f, 0.0f};
    }
}

void EnemyManager::broadcastAlert(const dof::core::World& world,
                                   const dof::entities::Enemy& caller) {
    const float callRange = configRef.getFloat("ENEMY_CALL_RANGE");
    if (callRange <= 0.0f) return;
    const float callRangeSq = callRange * callRange;
    const auto  callerPos   = caller.moveable().position;
    const auto  heroPos     = world.hero().moveable().position;

    const auto nearbyIds = grid.queryRadius(callerPos, callRange + alertQueryMovementSlack);
    for (const auto id : nearbyIds) {
        if (id == caller.id()) continue;
        const auto it = spatialGridEnemyById.find(id.value);
        if (it == spatialGridEnemyById.end()) continue;
        dof::entities::Enemy* other = it->second;
        if (!other || other->deathable().isDead) continue;
        const float hx = heroPos.x - other->moveable().position.x;
        const float hy = heroPos.y - other->moveable().position.y;
        if (hx * hx + hy * hy <= chaseRange * chaseRange) continue;
        const float ddx = other->moveable().position.x - callerPos.x;
        const float ddy = other->moveable().position.y - callerPos.y;
        if (ddx * ddx + ddy * ddy > callRangeSq) continue;
        if (auto authored = authoredEnemyStates.find(other->id().value);
            authored != authoredEnemyStates.end()) {
            const int encounterIndex = authored->second.encounterIndex;
            const bool isEncounterUnlocked = encounterIndex == 0
                || (encounterIndex == 1
                    && wavePhase == WavePhase::GroupAlive)
                || (encounterIndex >= 2
                    && wavePhase == WavePhase::Exploration);
            if (!isEncounterUnlocked) continue;
            authored->second.isActive = true;
            authored->second.hasSeenHero = true;
        }
        alertTargetMap.insert_or_assign(other->id().value, callerPos);
    }
}

void EnemyManager::applyTierAndLevel(dof::entities::Enemy& enemy, int enemyLevel, dof::entities::QualityTier tier) {
    const int safeLevel = std::max(1, enemyLevel);
    const float factorHealth = std::pow(healthPerLevel, static_cast<float>(safeLevel - 1));
    const float factorSpeed  = std::pow(speedPerLevel,  static_cast<float>(safeLevel - 1));
    float tierMultiplier = tierStatMultCommon;
    if (tier == dof::entities::QualityTier::Uncommon)   tierMultiplier = tierStatMultUncommon;
    else if (tier == dof::entities::QualityTier::Rare)  tierMultiplier = tierStatMultRare;
    enemy.damageable().setMaxHealth(baseHealth * factorHealth * tierMultiplier);
    enemy.moveable().moveSpeed = baseSpeed * factorSpeed;
    enemy.walkable().walkSpeed = enemy.moveable().moveSpeed;
    enemy.huntable().chaseRange = chaseRange;
    enemy.huntable().attackRange = attackRange;
    enemy.huntable().deadzoneFactor = deadzoneFactor;
}

}
