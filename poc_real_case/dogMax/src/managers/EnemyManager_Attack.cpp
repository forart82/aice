#include "managers/EnemyManager.hpp"

#include "combat/HitStop.hpp"
#include "hubs/EffectBurstHub.hpp"

#include "abilities/Rangeable.hpp"
#include "audio/SpatialAudio.hpp"
#include "combat/CritClamp.hpp"
#include "combat/WeaponFiring.hpp"
#include "core/World.hpp"
#include "entities/Dice.hpp"
#include "entities/Enemy.hpp"
#include "entities/Hero.hpp"
#include "entities/Weapon.hpp"
#include "helpers/DeterministicRandom.hpp"
#include "helpers/MathHelper.hpp"
#include "hubs/DamageTextHub.hpp"
#include "hubs/EvasionHub.hpp"
#include "hubs/AttackVfxHub.hpp"
#include "hubs/WeaponSlotHub.hpp"
#include "loaders/ConfigLoader.hpp"
#include "render/WeaponColors.hpp"

#include <algorithm>
#include <span>
#include <vector>

namespace dof::managers {

namespace {

float enemyRangeMultiplier(const dof::loaders::ConfigLoader& config,
                           dof::entities::WeaponType type) {
    using WT = dof::entities::WeaponType;
    switch (type) {
        case WT::Pitchfork:    return config.getFloat("ENEMY_RANGE_MULT_PITCHFORK");
        case WT::LongSword:    return config.getFloat("ENEMY_RANGE_MULT_LONG_SWORD");
        case WT::GreatSword:   return config.getFloat("ENEMY_RANGE_MULT_GREAT_SWORD");
        case WT::Halberd:      return config.getFloat("ENEMY_RANGE_MULT_HALBERD");
        case WT::Quarterstaff: return config.getFloat("ENEMY_RANGE_MULT_QUARTERSTAFF");
        case WT::Knives:       return config.getFloat("ENEMY_RANGE_MULT_KNIVES");
        case WT::Dagger:       return config.getFloat("ENEMY_RANGE_MULT_DAGGER");
        case WT::Mace:         return config.getFloat("ENEMY_RANGE_MULT_MACE");
        case WT::Warhammer:    return config.getFloat("ENEMY_RANGE_MULT_WARHAMMER");
        case WT::BigAxe:       return config.getFloat("ENEMY_RANGE_MULT_BIG_AXE");
    }
    return 1.0f;
}

}

float EnemyManager::scaledEnemyDamage(float damage) const {
    if (damage <= 0.0f) return 0.0f;
    return std::max(std::max(0.0f, enemyAttackMinDamage),
                    damage * std::max(0.0f, enemyAttackDamageMult));
}

bool EnemyManager::applyEnemyHitToHero(dof::entities::Enemy& enemy,
                                       dof::entities::Hero& hero,
                                       float damage, bool isCritical,
                                       std::string_view attackName) {
    const sf::Vector2f attackerDirection = dof::helpers::normalizeOrZero({
        enemy.moveable().position.x - hero.moveable().position.x,
        enemy.moveable().position.y - hero.moveable().position.y});
    hero.notifyIncomingAttack(attackerDirection);
    // Mirrors the legacy Huntable melee hit path: the hero's evasion is
    // rolled from its own equipped weapon/dice evasion (independent of what
    // the enemy attacks with), Hexarchon bypasses dodge below a HP floor,
    // dash i-frames swallow the hit (takeDamage returns 0), and the number +
    // death mark are gated on HP actually lost.
    const bool hexarchonBypassesDoge = [&]() {
        if (enemy.specialKind() != dof::entities::SpecialEnemyKind::Hexarchon) return false;
        const float threshold = configRef.getFloat("SPECIAL_HEXARCHON_DOGE_BYPASS_HERO_HP_FRACTION");
        if (threshold <= 0.0f) return false;
        return hero.damageable().healthRatio() < threshold;
    }();

    bool evaded = false;
    if (!hexarchonBypassesDoge && evasionHubPtr && weaponSlotHubPtr) {
        std::vector<float> evasionPerSlots;
        evasionPerSlots.reserve(static_cast<std::size_t>(weaponSlotHubPtr->rowCount() *
                                                      (weaponSlotHubPtr->diceCellsPerRow() + 1)));
        for (int row = 0; row < weaponSlotHubPtr->rowCount(); ++row) {
            const auto* weapon = weaponSlotHubPtr->peek(row);
            if (!weapon) continue;
            if (weapon->evasionBonus() > 0.0f)
                evasionPerSlots.push_back(weapon->evasionBonus());
            for (int cell = 0; cell < weaponSlotHubPtr->diceCellsPerRow(); ++cell) {
                if (const auto* dice = weaponSlotHubPtr->peekDice(row, cell))
                    evasionPerSlots.push_back(dice->evasionPerSlot());
            }
        }
        evaded = evasionHubPtr->tryEvade(rngRef, std::span<const float>(evasionPerSlots));
    }

    if (evaded) {
        hero.notifyEvasion(hero.moveable().position);
        hero.notifyAvoidedAttack();
        return false;
    }

    float resolvedDamage = scaledEnemyDamage(damage);
    if (wavePhase == WavePhase::ScoutAlive || wavePhase == WavePhase::GroupAlive) {
        const float openingCapFraction = std::max(
            0.0f, configRef.getFloat("OPENING_ENEMY_HIT_MAX_HERO_HP_FRACTION"));
        resolvedDamage = std::min(
            resolvedDamage, hero.damageable().maxHealth * openingCapFraction);
    }
    const int earlyHitCapMaxLevel =
        std::max(0, configRef.getInt("EARLY_ENEMY_HIT_CAP_MAX_LEVEL"));
    if (enemy.specialKind() == dof::entities::SpecialEnemyKind::None
        && enemy.level() >= 1
        && enemy.level() <= earlyHitCapMaxLevel) {
        float minimumHeroHealthForCap = 0.0f;
        switch (enemy.tier()) {
            case dof::entities::QualityTier::Common:
                minimumHeroHealthForCap = configRef.getFloat(
                    "EARLY_ENEMY_HIT_CAP_COMMON_MIN_HERO_HP");
                break;
            case dof::entities::QualityTier::Uncommon:
                minimumHeroHealthForCap = configRef.getFloat(
                    "EARLY_ENEMY_HIT_CAP_UNCOMMON_MIN_HERO_HP");
                break;
            case dof::entities::QualityTier::Rare:
                minimumHeroHealthForCap = configRef.getFloat(
                    "EARLY_ENEMY_HIT_CAP_RARE_MIN_HERO_HP");
                break;
        }
        if (hero.damageable().health > minimumHeroHealthForCap) {
            const float currentHealthCapFraction = std::clamp(
                configRef.getFloat("EARLY_ENEMY_HIT_MAX_CURRENT_HP_FRACTION"),
                0.0f,
                1.0f);
            resolvedDamage = std::min(
                resolvedDamage,
                hero.damageable().health * currentHealthCapFraction);
        }
    }
    const float applied = hero.damageable().takeDamage(resolvedDamage, attackName);
    if (applied > 0.0f) {
        const float heavyFraction = configRef.getFloat("HERO_INCOMING_HIT_HEAVY_HP_FRACTION");
        const bool isHeavy = hero.damageable().maxHealth > 0.0f
                          && applied / hero.damageable().maxHealth >= heavyFraction;
        const float strength = isCritical
            ? configRef.getFloat("HERO_INCOMING_HIT_CRITICAL_STRENGTH")
            : (isHeavy ? configRef.getFloat("HERO_INCOMING_HIT_HEAVY_STRENGTH") : 1.0f);
        hero.notifyIncomingHit(strength);
        // Impact freeze, scaled by the same strength scalar the shake and
        // damage text already use — a crit or a heavy hit should stop the world
        // harder than a graze (visual_identity.md Step 8).
        if (hitStopPtr) hitStopPtr->request(hitStopTakenSeconds * strength);
        if (effectBurstHubPtr) {
            effectBurstHubPtr->request(burstHurtName, hero.moveable().position,
                                       heroAccentColor, burstHurtRadius);
        }
        damageTextHubRef.spawnDamage(hero.moveable().position, applied, isCritical, enemy.tier());
        if (hero.damageable().isDead() && !hero.deathable().isDead) {
            hero.recordFatalEnemy(enemy, attackName, applied);
            hero.deathable().markDead();
        }
    } else {
        hero.notifyAvoidedAttack();
    }
    return applied > 0.0f;
}

bool EnemyManager::tickUnarmedCharge(dof::core::World& world, dof::entities::Enemy& enemy,
                                     float dt, float distanceToHeroSq) {
    auto& loadout = enemy.loadout();
    auto& charge  = loadout.bodyCharge();

    switch (loadout.chargePhase()) {
        case dof::abilities::ChargePhase::Idle: {
            // Wind up once the hero is close enough to commit to a lunge.
            const float trigger = configRef.getFloat("ENEMY_CHARGE_TRIGGER_RANGE");
            if (distanceToHeroSq <= trigger * trigger) {
                charge.setDuration(configRef.getFloat("ENEMY_CHARGE_WINDUP_SECONDS"));
                loadout.setChargePhase(dof::abilities::ChargePhase::WindUp);
                enemy.huntable().attackFlashTimer = attackFlashDuration;
                return true;  // freeze from this tick on
            }
            return false;  // keep chasing
        }
        case dof::abilities::ChargePhase::WindUp: {
            charge.advance(dt);
            if (!charge.isFinished()) return true;  // still telegraphing → frozen
            // Launch the lunge toward the hero; the shared Dashable arc (in
            // tickAi) moves the enemy and deals the collision damage.
            auto& hero = world.hero();
            const sf::Vector2f toHero{hero.moveable().position.x - enemy.moveable().position.x,
                                      hero.moveable().position.y - enemy.moveable().position.y};
            const sf::Vector2f dir = dof::helpers::normalizeOrZero(toHero);
            enemy.dashState().armDash(dir,
                                      configRef.getFloat("ENEMY_CHARGE_DASH_SPEED"),
                                      configRef.getFloat("ENEMY_CHARGE_DASH_SECONDS"),
                                      enemy.moveable().position,
                                      dashGhostDuration, dashGhostInitialAlpha);
            if (spatialAudioPtr) spatialAudioPtr->playEnemyUnarmedDash(enemy.moveable().position);
            charge.setDuration(configRef.getFloat("ENEMY_CHARGE_RECOVER_SECONDS"));
            loadout.setChargePhase(dof::abilities::ChargePhase::Recover);
            return true;  // dash owns the next ticks
        }
        case dof::abilities::ChargePhase::Recover: {
            charge.advance(dt);
            if (charge.isFinished()) loadout.setChargePhase(dof::abilities::ChargePhase::Idle);
            return false;  // free to reposition while recovering
        }
    }
    return false;
}

bool EnemyManager::tickArmedAttack(dof::core::World& world, dof::entities::Enemy& enemy,
                                   float dt, float distanceToHeroSq) {
    auto& hero = world.hero();
    auto& loadout = enemy.loadout();

    if (loadout.isArmedAttackWindingUp()) {
        loadout.advanceArmedAttackWindup(dt);
        enemy.moveable().velocity = {0.0f, 0.0f};
        if (loadout.armedAttackWindupProgress() < 1.0f) return true;

        const int weaponIndex = loadout.armedAttackWeaponIndex();
        auto* weapon = loadout.weaponAt(weaponIndex);
        const float committedRange = loadout.armedAttackRange();
        loadout.clearArmedAttackWindup();
        if (!weapon) return false;

        if (distanceToHeroSq > committedRange * committedRange) return false;
        auto dice = loadout.weaponDice(weaponIndex);
        const std::span<dof::entities::Dice* const> diceSpan(dice);
        const auto snapshot = dof::combat::collectDiceSnapshot(diceSpan);
        const float critChance = dof::combat::clampEffectiveCritChance(
            weapon->critChance(), snapshot.critChance, critChanceCap);
        const auto damage = dof::combat::rollWeaponDamage(
            weapon->baseDamage(), snapshot, 1.0f, critChance,
            weapon->crit() * snapshot.critMult, rngRef, diceProductFloor, damageFloor);
        enemy.huntable().attackFlashTimer = attackFlashDuration;
        if (spatialAudioPtr) {
            spatialAudioPtr->playEnemyAttack(weapon->attackType(), enemy.moveable().position);
        }
        applyEnemyHitToHero(enemy, hero, damage.damage, damage.isCritical,
                            dof::entities::weaponAttackName(*weapon));
        if (attackVfxHubPtr) {
            const sf::Vector2f origin = enemy.moveable().position;
            const sf::Vector2f target = hero.moveable().position;
            const sf::Vector2f delta{target.x - origin.x, target.y - origin.y};
            const float targetDistance = dof::helpers::lengthOf(delta);
            const sf::Vector2f direction = dof::helpers::normalizeOrZero(delta);
            const sf::Color color = dof::render::weaponOutlineColor(configRef, weapon->type());
            switch (weapon->attackType()) {
                case dof::entities::AttackType::Single:
                    attackVfxHubPtr->spawnSingle(origin, direction, targetDistance, color,
                                                  weapon->type(), false, true);
                    break;
                case dof::entities::AttackType::Swipe: {
                    const float radiusFraction = std::max(
                        configRef.getFloat("ATTACK_VFX_SWIPE_ARC_RADIUS_FRAC"), 0.01f);
                    attackVfxHubPtr->spawnSwipe(origin, direction,
                                                 targetDistance / radiusFraction,
                                                 weapon->swipeArcDegrees(), color,
                                                 weapon->type(), false, true);
                    break;
                }
                case dof::entities::AttackType::MultiTarget:
                    attackVfxHubPtr->spawnMultiTarget(origin, {target}, targetDistance, color,
                                                       weapon->type(), false, true);
                    break;
                case dof::entities::AttackType::MultiSingle:
                    attackVfxHubPtr->spawnMultiSingle(origin, target,
                        weapon->multiSingleMax(), targetDistance, color,
                        weapon->type(), false, true);
                    break;
                case dof::entities::AttackType::Aoe:
                    attackVfxHubPtr->spawnAoe(origin, targetDistance, color,
                                               weapon->type(), false, true, target);
                    break;
            }
        }
        dof::combat::resetWeaponCooldown(*weapon, diceSpan);
        return true;
    }

    const int weaponCount = enemy.loadout().weaponCount();
    for (int w = 0; w < weaponCount; ++w) {
        auto* weapon = enemy.loadout().weaponAt(w);
        if (!weapon) continue;

        // Each weapon paces independently (like two hero rows) through the
        // shared dice-pacing-wins helpers.
        auto dice = enemy.loadout().weaponDice(w);
        const std::span<dof::entities::Dice* const> diceSpan(dice);
        dof::combat::advanceWeaponCooldown(*weapon, diceSpan, dt);
        if (!dof::combat::isWeaponCharged(*weapon, diceSpan)) continue;

        // Charged but hero out of weapon range → hold the charge (do not
        // fire, do not reset), exactly like the hero holding with no target.
        const float range = weapon->rangeable().range
                          * std::max(0.0f, enemyRangeMultiplier(configRef, weapon->type()));
        if (distanceToHeroSq > range * range) continue;

        loadout.startArmedAttackWindup(w, armedAttackWindupSeconds, range);
        enemy.moveable().velocity = {0.0f, 0.0f};
        return true;
    }
    return false;
}

}
