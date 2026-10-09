#include "managers/WeaponManager.hpp"

#include "combat/HitStop.hpp"
#include "hubs/EffectBurstHub.hpp"

#include "audio/SpatialAudio.hpp"
#include "managers/EnemyManager.hpp"
#include "combat/AttackModes.hpp"
#include "combat/WeaponFiring.hpp"
#include "core/World.hpp"
#include "entities/Dice.hpp"
#include "entities/Enemy.hpp"
#include "entities/Hero.hpp"
#include "entities/Weapon.hpp"
#include "helpers/RandomHelper.hpp"
#include "hubs/AttackVfxHub.hpp"
#include "hubs/DamageTextHub.hpp"
#include "hubs/DronFloatTextHub.hpp"
#include "hubs/LuckHub.hpp"
#include "hubs/WeaponSlotHub.hpp"
#include "hubs/XpFloatHub.hpp"
#include "loaders/ConfigLoader.hpp"
#include "render/WeaponColors.hpp"
#include "combat/CritClamp.hpp"
#include "combat/DamageFormula.hpp"
#include "combat/KillStreak.hpp"

#include <utility>
#include <string_view>
#include <vector>

namespace dof::managers {

namespace {

// Applies one independent damage roll to `target` and returns the
// post-roll DamageResult. Side effects (XP grant + damage text) are
// the manager's job — this helper is just the damage formula step,
// sourced from the shared `dof::combat::rollWeaponDamage`.
struct RolledDamage {
    dof::combat::DamageResult result;
    float appliedDamage{0.0f};
    bool wasAliveBefore{false};
    bool isFatalHit{false};
};

RolledDamage applyDamageRoll(dof::entities::Enemy& target,
                              float baseDamage,
                              const dof::combat::DiceSlotSnapshot& diceSnapshot,
                              const dof::combat::DronResult& dronResult,
                              float critChance,
                              float critMult,
                              dof::helpers::RandomHelper& rng,
                              float diceProductFloor,
                              float damageFloor,
                              std::string_view attackName) {
    const auto damageResult = dof::combat::rollWeaponDamage(baseDamage,
                                                            diceSnapshot,
                                                            dronResult.multiplier,
                                                            critChance, critMult, rng,
                                                            diceProductFloor, damageFloor);
    RolledDamage rolled;
    rolled.result        = damageResult;
    rolled.wasAliveBefore = !target.damageable().isDead();
    rolled.appliedDamage = target.damageable().takeDamage(damageResult.damage, attackName);
    rolled.isFatalHit = rolled.wasAliveBefore && target.damageable().isDead();
    return rolled;
}

}

WeaponManager::WeaponManager(const dof::loaders::ConfigLoader& config,
                             dof::helpers::RandomHelper& rng,
                             dof::combat::DronDetector& dronDetector,
                             dof::hubs::WeaponSlotHub& weaponSlotHub,
                             dof::hubs::DamageTextHub& damageTextHub,
                             dof::hubs::DronFloatTextHub& dronFloatTextHub,
                             dof::hubs::LuckHub& luckHub,
                             dof::hubs::XpFloatHub& xpFloatHub)
    : configRef(config), rngRef(rng), dronDetectorRef(dronDetector),
      weaponSlotRef(weaponSlotHub), damageTextRef(damageTextHub),
      dronFloatTextRef(dronFloatTextHub), luckHubRef(luckHub), xpFloatRef(xpFloatHub) {
    faceCycleSeconds         = config.getFloat("DICE_FACE_CYCLE_SECONDS");
    critChanceCap            = config.getFloat("CRIT_CHANCE_CAP");
    diceProductFloor         = config.getFloat("DAMAGE_DICE_PRODUCT_FLOOR");
    damageFloor              = config.getFloat("DAMAGE_MINIMUM_FLOOR");
    killStreakWindowSeconds  = config.getFloat("XP_KILL_STREAK_WINDOW_SECONDS");
    killStreakBonusPerKill   = config.getFloat("XP_KILL_STREAK_BONUS_PER_KILL");
    killStreakMaxMult        = config.getFloat("XP_KILL_STREAK_MAX_MULT");
}

void WeaponManager::setAttackVfxHub(dof::hubs::AttackVfxHub* hub) { attackVfxHubPtr = hub; }
void WeaponManager::setEnemyManager(dof::managers::EnemyManager* mgr) { enemyManagerPtr = mgr; }
void WeaponManager::setSpatialAudio(dof::audio::SpatialAudio* audio) { spatialAudioPtr = audio; }

void WeaponManager::refreshPerFrameCachedConfig() {
    faceCycleSeconds = configRef.getFloat("DICE_FACE_CYCLE_SECONDS");
    hitStopDealtSeconds = configRef.getFloat("HIT_STOP_DEALT_SECONDS");
    burstHitName        = configRef.getString("BURST_HERO_HIT_NAME");
    burstHitRadius      = configRef.getFloat("BURST_HERO_HIT_RADIUS");
    heroWindupSeconds   = configRef.getFloat("HERO_ATTACK_WINDUP_SECONDS");
    heroAccentColor = sf::Color(
        static_cast<std::uint8_t>(configRef.getInt("HERO_OUTLINE_R")),
        static_cast<std::uint8_t>(configRef.getInt("HERO_OUTLINE_G")),
        static_cast<std::uint8_t>(configRef.getInt("HERO_OUTLINE_B")));
    critChanceCap    = configRef.getFloat("CRIT_CHANCE_CAP");
    diceProductFloor = configRef.getFloat("DAMAGE_DICE_PRODUCT_FLOOR");
    damageFloor      = configRef.getFloat("DAMAGE_MINIMUM_FLOOR");
    killStreakWindowSeconds = configRef.getFloat("XP_KILL_STREAK_WINDOW_SECONDS");
    killStreakBonusPerKill  = configRef.getFloat("XP_KILL_STREAK_BONUS_PER_KILL");
    killStreakMaxMult       = configRef.getFloat("XP_KILL_STREAK_MAX_MULT");
}

void WeaponManager::resetRunState() {
    simTimeAccumulator = 0.0;
    lastKillSimTime = -1.0;
    currentKillStreak = 0;
    firedShots = 0;
}

void WeaponManager::update(dof::core::World& world, float dt) {
    refreshPerFrameCachedConfig();
    // Spec §Hero Death L478: "Weapon cooldowns stop" when hero HP reaches
    // 0. Gate the entire per-frame entry: no cooldown advance, no dice
    // face cycling, no firing. Resumes naturally if the hero is revived
    // (no internal state needs clearing — countdowns simply hold).
    if (world.hero().damageable().isDead()) return;
    // card-mpl0eo9k — keep a monotonically-advancing sim clock so the
    // kill-streak math has a stable reference for the rolling window.
    // Survives across `restartRun` because restartRun does not destroy
    // the WeaponManager instance; the streak tail simply expires the
    // first kill after the restart since `lastKillSimTime` is far
    // behind the new `simTimeAccumulator`.
    simTimeAccumulator += static_cast<double>(dt);

    for (int row = 0; row < weaponSlotRef.rowCount(); ++row) {
        if (weaponSlotRef.isRowEmpty(row)) continue;
        tickDiceFaceCycle(row, dt);
        tickWeaponRow(world, row, dt);
    }
}

int WeaponManager::totalFiredShots() const { return firedShots; }

void WeaponManager::tickDiceFaceCycle(int rowIndex, float dt) {
    // Spec §Dices §Rolling L1111 — each equipped dice cycles on its
    // OWN cadence (per-instance accumulator). Frozen dice (hold-charge,
    // `countdownable().isFinished()`) are wholly paused: neither the
    // accumulator nor the face advances. `effectiveMinFace()` auto-
    // refreshes on a `WeaponSlotHub` epoch change.
    const int floorFace = luckHubRef.effectiveMinFace();
    for (int cell = 0; cell < weaponSlotRef.diceCellsPerRow(); ++cell) {
        auto* dice = weaponSlotRef.peekDice(rowIndex, cell);
        if (!dice) continue;
        if (dice->countdownable().isFinished()) continue;
        const float updated = dice->faceCycleAccumulator() + dt;
        if (updated < faceCycleSeconds) {
            dice->setFaceCycleAccumulator(updated);
            continue;
        }
        dice->setFaceCycleAccumulator(0.0f);
        const int minFace = floorFace > dice->faceCount() ? dice->faceCount() : floorFace;
        dice->setCurrentFace(rngRef.uniformInt(minFace, dice->faceCount()));
    }
}

std::vector<dof::entities::Dice*> WeaponManager::rowDicePointers(int rowIndex) {
    std::vector<dof::entities::Dice*> dice;
    for (int cell = 0; cell < weaponSlotRef.diceCellsPerRow(); ++cell) {
        auto* d = weaponSlotRef.peekDice(rowIndex, cell);
        if (d) dice.push_back(d);
    }
    return dice;
}

void WeaponManager::tickWeaponRow(dof::core::World& world, int rowIndex, float dt) {
    auto* weapon = weaponSlotRef.peek(rowIndex);
    if (!weapon) return;

    // Spec §Charged + §Effective APS — delegate the dice-pacing-wins rule
    // to the shared firing helpers so hero and enemy stay byte-identical.
    const auto dice = rowDicePointers(rowIndex);
    dof::combat::advanceWeaponCooldown(*weapon, dice, dt);
    if (!dof::combat::isWeaponCharged(*weapon, dice)) return;

    // Anticipation: a charged row telegraphs briefly before it commits
    // (visual_identity.md Step 9), so an attack has a readable beat instead of
    // materialising instantly.
    //
    // This costs the player no responsiveness: hero weapon rows auto-fire on
    // their own cooldown rather than on a keypress, so the wind-up delays a
    // timer the player never sees, not a button they pressed. A wind-up on a
    // player-triggered attack would read as input lag; this cannot.
    if (heroWindupSeconds > 0.0f) {
        if (rowWindupRemaining.size() <= static_cast<std::size_t>(rowIndex)) {
            rowWindupRemaining.resize(static_cast<std::size_t>(rowIndex) + 1u, 0.0f);
        }
        float& remaining = rowWindupRemaining[static_cast<std::size_t>(rowIndex)];
        if (remaining <= 0.0f) {
            remaining = heroWindupSeconds;
            return;
        }
        remaining -= dt;
        if (remaining > 0.0f) return;
        remaining = 0.0f;
    }
    fireRow(world, rowIndex);
}

void WeaponManager::fireRow(dof::core::World& world, int rowIndex) {
    auto* weapon = weaponSlotRef.peek(rowIndex);
    if (!weapon) return;

    // Spec §Attack §Attack mechanic L1443 — branch on the weapon's
    // declared mode; each mode produces its own target list. Single
    // Attack still uses the closest-target rule, so a fresh Pitchfork
    // behaves identically to the pre-SA6 build.
    const auto mode = weapon->attackType();
    sf::Vector2f swipeFireDirection{1.0f, 0.0f};
    auto targets = selectTargetsForWeapon(world, *weapon, swipeFireDirection);

    // Spec §Charged + §Hero Aim L1535: hold the charge if no target
    // is in range. Cooldown stays at the finished state so the next
    // tick re-enters and tries again. No firedShots, no dron text,
    // no VFX queue, no XP.
    if (targets.empty()) return;

    if (spatialAudioPtr) {
        spatialAudioPtr->playHeroAttack(mode, world.hero().moveable().position);
    }

    const auto rowDice     = rowDicePointers(rowIndex);
    const auto diceSnapshot = dof::combat::collectDiceSnapshot(rowDice);
    // SE7 / spec L1598 — clamp effective crit chance to `CRIT_CHANCE_CAP`
    // after dice contributions are summed in. The cap prevents a
    // late-game stack of high-crit dice from saturating at 1.0+
    // (every hit critical) and keeps a critical hit a meaningful event.
    // Spec L1586-1587: crit chance is the WEAPON's own base critChance plus
    // every slotted dice's critChance (clamped to CRIT_CHANCE_CAP); crit
    // multiplier is the weapon's own base crit plus the dice crit. Earlier
    // this seeded from a flat global COMBAT_CRIT_BASE_* constant, which made
    // every per-type weapon crit value (and the deliberate Pitchfork
    // critChance=0) dead at fire time.
    const float critChance = dof::combat::clampEffectiveCritChance(
        weapon->critChance(), diceSnapshot.critChance, critChanceCap);
    // Product, not sum: summing multipliers meant a neutral 1.0 die added a
    // full +1.0x and three dice added up to +9.0 instead of scaling.
    const float critMult   = weapon->crit() * diceSnapshot.critMult;
    // P1.1 — pattern detection must know each die's FACE COUNT so Hemidron's
    // "all-high / all-low" split is face-count-relative (a d100's midpoint is
    // 50, not the d6-era fixed 3). Build the counts parallel to
    // diceSnapshot.faces: rowDice has no null entries and collectDiceSnapshot
    // pushes one face per die in the same order, so index i lines up 1:1.
    std::vector<int> diceFaceCounts;
    diceFaceCounts.reserve(rowDice.size());
    for (const auto* slottedDice : rowDice) diceFaceCounts.push_back(slottedDice->faceCount());
    const auto dronResult  = dronDetectorRef.classify(diceSnapshot.faces, diceFaceCounts);
    const float baseDamageWithBonus = weapon->baseDamage();

    // Branch the damage-roll shape on mode. Single / Swipe / AOE
    // share one roll; MultiTarget rolls per-target; MultiSingle
    // rolls per-hit on the same target and shows a single summed
    // floating text (spec L1484).
    const bool sharedRoll = (mode == dof::entities::AttackType::Single)
                             || (mode == dof::entities::AttackType::Swipe)
                             || (mode == dof::entities::AttackType::Aoe);

    if (sharedRoll) {
        applyDamageSharedRoll(world, *weapon, targets, diceSnapshot, dronResult,
                              critChance, critMult, baseDamageWithBonus);
    } else if (mode == dof::entities::AttackType::MultiTarget) {
        applyDamageMultiTarget(world, *weapon, targets, diceSnapshot, dronResult,
                               critChance, critMult, baseDamageWithBonus);
    } else {
        applyDamageMultiSingle(world, *weapon, targets, diceSnapshot, dronResult,
                               critChance, critMult, baseDamageWithBonus);
    }

    dronFloatTextRef.spawn(rowIndex, {0.0f, 0.0f}, dronResult);
    spawnAttackVfx(world, *weapon, mode, swipeFireDirection, targets);

    dof::combat::resetWeaponCooldown(*weapon, rowDice);
    ++firedShots;
}

std::vector<dof::combat::HitTarget> WeaponManager::selectTargetsForWeapon(
    dof::core::World& world,
    const dof::entities::Weapon& weapon,
    sf::Vector2f& swipeFireDirection) const {
    const auto* targetGrid = enemyManagerPtr ? &enemyManagerPtr->spatialGrid() : nullptr;
    switch (weapon.attackType()) {
        case dof::entities::AttackType::Single:
            return targetGrid ? dof::combat::pickSingleTarget(world, *targetGrid, weapon)
                              : dof::combat::pickSingleTarget(world, weapon);
        case dof::entities::AttackType::Swipe:
            return targetGrid ? dof::combat::pickSwipeTargets(world, *targetGrid, weapon, swipeFireDirection)
                              : dof::combat::pickSwipeTargets(world, weapon, swipeFireDirection);
        case dof::entities::AttackType::MultiTarget:
            return targetGrid ? dof::combat::pickMultiTargets(world, *targetGrid, weapon)
                              : dof::combat::pickMultiTargets(world, weapon);
        case dof::entities::AttackType::MultiSingle:
            return targetGrid ? dof::combat::pickMultiSingleTargets(world, *targetGrid, weapon)
                              : dof::combat::pickMultiSingleTargets(world, weapon);
        case dof::entities::AttackType::Aoe:
            return targetGrid ? dof::combat::pickAoeTargets(world, *targetGrid, weapon)
                              : dof::combat::pickAoeTargets(world, weapon);
    }
    return {};
}

void WeaponManager::applyDamageSharedRoll(
    dof::core::World& world,
    const dof::entities::Weapon& weapon,
    std::vector<dof::combat::HitTarget>& targets,
    const dof::combat::DiceSlotSnapshot& diceSnapshot,
    const dof::combat::DronResult& dronResult,
    float critChance,
    float critMult,
    float baseDamageWithBonus) {
    const auto damageResult = dof::combat::rollWeaponDamage(baseDamageWithBonus,
                                                            diceSnapshot,
                                                            dronResult.multiplier,
                                                            critChance, critMult, rngRef,
                                                            diceProductFloor, damageFloor);
    const std::string attackName = dof::entities::weaponAttackName(weapon);
    for (auto& hit : targets) {
        if (!hit.enemy) continue;
        const bool wasAlive = !hit.enemy->damageable().isDead();
        if (!wasAlive) continue;
        if (enemyManagerPtr) {
            const sf::Vector2f heroPos = world.hero().moveable().position;
            if (enemyManagerPtr->tryConsumeDefensiveDash(*hit.enemy, heroPos)) {
                world.hero().notifyAttack();
                continue;
            }
        }
        const float applied = hit.enemy->damageable().takeDamage(damageResult.damage, attackName);
        if (enemyManagerPtr) enemyManagerPtr->notifyEnemyHit(*hit.enemy);
        // Impact freeze on a landed hero hit. Requests are max-wins, so a
        // multi-target swipe that resolves several hits this frame freezes once
        // rather than stacking into a lock-up.
        if (applied > 0.0f && hitStopPtr) hitStopPtr->request(hitStopDealtSeconds);
        // Burst tinted with the hero's own accent, so a landed hit reads as the
        // player's doing and stays inside the locked palette (Step 11).
        if (applied > 0.0f && effectBurstHubPtr) {
            effectBurstHubPtr->request(burstHitName,
                                       hit.enemy->moveable().position,
                                       heroAccentColor, burstHitRadius);
        }
        world.hero().notifyAttack();
        if (hit.enemy->damageable().isDead()) {
            grantKillXpWithStreak(world, *hit.enemy);
        }
        if (applied > 0.0f) {
            damageTextRef.spawnDamage(hit.enemy->moveable().position,
                                      applied,
                                      damageResult.isCritical,
                                      weapon.tier());
        }
    }
}

void WeaponManager::applyDamageMultiTarget(
    dof::core::World& world,
    const dof::entities::Weapon& weapon,
    std::vector<dof::combat::HitTarget>& targets,
    const dof::combat::DiceSlotSnapshot& diceSnapshot,
    const dof::combat::DronResult& dronResult,
    float critChance,
    float critMult,
    float baseDamageWithBonus) {
    const std::string attackName = dof::entities::weaponAttackName(weapon);
    for (auto& hit : targets) {
        if (!hit.enemy) continue;
        // Skip corpses BEFORE any roll, matching applyDamageSharedRoll. Both
        // tryConsumeDefensiveDash and applyDamageRoll draw from the shared RNG,
        // so rolling against an already-dead enemy here desynchronised the
        // stream against the sibling path for the same situation — the
        // deterministic-replay invariant the spawn path documents.
        if (hit.enemy->damageable().isDead()) continue;
        if (enemyManagerPtr) {
            const sf::Vector2f heroPos = world.hero().moveable().position;
            if (enemyManagerPtr->tryConsumeDefensiveDash(*hit.enemy, heroPos)) {
                world.hero().notifyAttack();
                continue;
            }
        }
        const auto rolled = applyDamageRoll(*hit.enemy, baseDamageWithBonus, diceSnapshot,
                                             dronResult, critChance, critMult, rngRef,
                                             diceProductFloor, damageFloor, attackName);
        if (enemyManagerPtr) enemyManagerPtr->notifyEnemyHit(*hit.enemy);
        world.hero().notifyAttack();
        if (rolled.isFatalHit) grantKillXpWithStreak(world, *hit.enemy);
        if (rolled.appliedDamage > 0.0f) {
            damageTextRef.spawnDamage(hit.enemy->moveable().position,
                                      rolled.appliedDamage,
                                      rolled.result.isCritical,
                                      weapon.tier());
        }
    }
}

void WeaponManager::applyDamageMultiSingle(
    dof::core::World& world,
    const dof::entities::Weapon& weapon,
    std::vector<dof::combat::HitTarget>& targets,
    const dof::combat::DiceSlotSnapshot& diceSnapshot,
    const dof::combat::DronResult& dronResult,
    float critChance,
    float critMult,
    float baseDamageWithBonus) {
    // MultiSingle: every entry points at the same enemy, but if it dies
    // mid-burst we re-route remaining hits to the next closest live target.
    float summedDamage = 0.0f;
    bool  summedCritical = false;
    const std::string attackName = dof::entities::weaponAttackName(weapon);
    sf::Vector2f textPosition = targets.front().enemy
                                    ? targets.front().enemy->moveable().position
                                    : world.hero().moveable().position;
    auto* currentTarget = targets.front().enemy;
    const auto* targetGrid = enemyManagerPtr ? &enemyManagerPtr->spatialGrid() : nullptr;
    for (std::size_t i = 0; i < targets.size(); ++i) {
        if (!currentTarget || currentTarget->damageable().isDead()) {
            auto nextList = targetGrid ? dof::combat::pickSingleTarget(world, *targetGrid, weapon)
                                       : dof::combat::pickSingleTarget(world, weapon);
            if (nextList.empty()) break;
            currentTarget = nextList.front().enemy;
            if (!currentTarget) break;
        }
        if (enemyManagerPtr) {
            const sf::Vector2f heroPos = world.hero().moveable().position;
            if (enemyManagerPtr->tryConsumeDefensiveDash(*currentTarget, heroPos)) {
                world.hero().notifyAttack();
                continue;
            }
        }
        const auto rolled = applyDamageRoll(*currentTarget, baseDamageWithBonus, diceSnapshot,
                                             dronResult, critChance, critMult, rngRef,
                                             diceProductFloor, damageFloor, attackName);
        if (enemyManagerPtr) enemyManagerPtr->notifyEnemyHit(*currentTarget);
        world.hero().notifyAttack();
        if (rolled.isFatalHit) grantKillXpWithStreak(world, *currentTarget);
        summedDamage   += rolled.appliedDamage;
        summedCritical = summedCritical || rolled.result.isCritical;
        // Anchor the floating text on whichever body absorbed the LAST hit so
        // the summed total floats off the right corpse if the target shifted.
        textPosition = currentTarget->moveable().position;
    }
    if (summedDamage > 0.0f) {
        damageTextRef.spawnDamage(textPosition, summedDamage, summedCritical, weapon.tier());
    }
}

void WeaponManager::spawnAttackVfx(dof::core::World& world,
                                   const dof::entities::Weapon& weapon,
                                   dof::entities::AttackType mode,
                                   sf::Vector2f swipeFireDirection,
                                   const std::vector<dof::combat::HitTarget>& targets) {
    if (!attackVfxHubPtr) return;

    const sf::Vector2f heroFeet = world.hero().moveable().position;
    const float range = weapon.rangeable().range;
    // Spec §VFX L1559: per-type colour comes from the weapon's base palette.
    const sf::Color paintColor = dof::render::weaponOutlineColor(configRef, weapon.type());
    const auto wtype = weapon.type();
    switch (mode) {
        case dof::entities::AttackType::Single: {
            const auto direction = targets.empty() ? sf::Vector2f{1.0f, 0.0f}
                                                    : targets.front().direction;
            attackVfxHubPtr->spawnSingle(heroFeet, direction, range, paintColor, wtype);
            break;
        }
        case dof::entities::AttackType::Swipe:
            attackVfxHubPtr->spawnSwipe(heroFeet, swipeFireDirection, range,
                                         weapon.swipeArcDegrees(), paintColor, wtype);
            break;
        case dof::entities::AttackType::MultiTarget: {
            std::vector<sf::Vector2f> targetPositions;
            targetPositions.reserve(targets.size());
            for (const auto& hit : targets) {
                if (hit.enemy) targetPositions.push_back(hit.enemy->moveable().position);
            }
            attackVfxHubPtr->spawnMultiTarget(heroFeet, std::move(targetPositions),
                                               range, paintColor, wtype);
            break;
        }
        case dof::entities::AttackType::MultiSingle: {
            const auto target = targets.empty() || !targets.front().enemy
                                   ? heroFeet
                                   : targets.front().enemy->moveable().position;
            attackVfxHubPtr->spawnMultiSingle(heroFeet, target,
                                                static_cast<int>(targets.size()),
                                                range, paintColor, wtype);
            break;
        }
        case dof::entities::AttackType::Aoe:
            attackVfxHubPtr->spawnAoe(heroFeet, range, paintColor, wtype);
            break;
    }
}

void WeaponManager::grantKillXpWithStreak(dof::core::World& world,
                                           const dof::entities::Enemy& enemy) {
    // card-mpl0eo9k — base kill XP comes from `computeKillExperience`
    // (no side effect). Rolling-window streak multiplier piles on
    // top: each kill within `killStreakWindowSeconds` of the previous
    // one bumps the multiplier by `killStreakBonusPerKill`, capped at
    // `killStreakMaxMult`. A gap longer than the window resets the
    // streak to 1 with a 1.0× multiplier. The boosted amount is what
    // both `grantExperience` and the on-screen `+N XP` float report.
    const auto base = world.hero().levelable().computeKillExperience(
        enemy.level(), static_cast<int>(enemy.tier()));
    if (base <= 0) return;
    const auto streak = dof::combat::computeKillStreakMultiplier(
        simTimeAccumulator,
        lastKillSimTime,
        currentKillStreak,
        killStreakWindowSeconds,
        killStreakBonusPerKill,
        killStreakMaxMult);
    currentKillStreak = streak.newStreak;
    lastKillSimTime   = simTimeAccumulator;
    const auto boosted = static_cast<std::int64_t>(
        static_cast<double>(base) * static_cast<double>(streak.multiplier));
    world.hero().levelable().grantExperience(boosted);
    // card-mpl8zfv4 — float spawns on the dying enemy's world
    // position (not the hero) so the player reads the kill site
    // directly. Streak index drives the per-event font + colour
    // bump for chained kills.
    xpFloatRef.spawnXp(enemy.moveable().position, boosted, currentKillStreak);
}

}
