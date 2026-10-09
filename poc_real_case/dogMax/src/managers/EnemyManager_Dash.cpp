#include "managers/EnemyManager.hpp"

#include "entities/Enemy.hpp"
#include "helpers/MathHelper.hpp"
#include "helpers/RandomHelper.hpp"
#include "hubs/WeaponSlotHub.hpp"
#include "loaders/ConfigLoader.hpp"

#include <cmath>

// Enemy dash system and miscellaneous helpers split out of EnemyManager.cpp so
// dash behavior stays separate from spawn/death management.
namespace dof::managers {

// --- Dash system ---

bool EnemyManager::tryConsumeDefensiveDash(dof::entities::Enemy& enemy,
                                            sf::Vector2f heroPos) {
    auto& dash = enemy.dashState();
    if (!dash.hasBeenHit)           return false;
    if (dash.defensiveCooldown > 0) return false;

    // Rationale: Scale defensive dash statistics dynamically based on Elite and Special properties.
    // Uncommon, Rare, and Special enemies are highly evasive and can weave away from danger with higher
    // frequency, presenting a more dynamic threat to single-target weapons.
    // Constraints: Uses the cached config values (ENEMY_DASH_DEFENSIVE_CHANCE and dashCooldown) as baseline.
    float chance = configRef.getFloat("ENEMY_DASH_DEFENSIVE_CHANCE");
    float cd = dashCooldown;

    if (enemy.specialKind() != dof::entities::SpecialEnemyKind::None) {
        chance = std::min(1.0f, chance * specialDefensiveDashChanceMult); // 60% default chance
        cd *= specialDefensiveDashCooldownMult; // 2.5s default cooldown
    } else if (enemy.isElite()) {
        if (enemy.tier() == dof::entities::QualityTier::Rare) {
            chance = std::min(1.0f, chance * rareDefensiveDashChanceMult); // 54% default chance
            cd *= rareDefensiveDashCooldownMult; // 3.0s default cooldown
        } else { // Uncommon
            chance = std::min(1.0f, chance * uncommonDefensiveDashChanceMult); // 42% default chance
            cd *= uncommonDefensiveDashCooldownMult; // 4.0s default cooldown
        }
    }

    if (!rngRef.bernoulli(static_cast<double>(chance))) {
        // Failed roll still burns the cooldown so the check retries in cd seconds,
        // not on every bullet frame.
        dash.defensiveCooldown = cd;
        return false;
    }

    dash.defensiveCooldown = cd;

    // Sidestep perpendicular to the hero→enemy attack axis.
    const sf::Vector2f enemyPos = enemy.moveable().position;
    const float ax = enemyPos.x - heroPos.x;
    const float ay = enemyPos.y - heroPos.y;
    const float len = std::sqrt(ax * ax + ay * ay);
    sf::Vector2f perp{0.0f, 1.0f};
    if (len > 0.001f) {
        // Two perpendicular options: (ay/len, -ax/len) and (-ay/len, ax/len).
        // Use the RNG to pick a side so the evade direction is unpredictable.
        perp = rngRef.bernoulli(0.5f)
            ? sf::Vector2f{ ay / len, -ax / len}
            : sf::Vector2f{-ay / len,  ax / len};
    }

    dash.armDash(perp, dashDefensiveSpeed, dashDefensiveDuration,
                 enemyPos, dashGhostDuration, dashGhostInitialAlpha);
    return true;
}

void EnemyManager::notifyEnemyHit(dof::entities::Enemy& enemy) {
    enemy.dashState().hasBeenHit = true;
}

// --- AI tuning load (kept here so the EnemyManager.cpp ctor stays focused) ---

// Reads the Elite/Special AI aggression multipliers + flank geometry from
// configs/enemy_ai_tuning.yaml. Called once from the EnemyManager ctor.
void EnemyManager::loadAiTuning(const dof::loaders::ConfigLoader& config) {
    // Offensive jump + dash scaling — Special enemies.
    specialJumpChanceMult      = config.getFloat("ENEMY_AI_SPECIAL_JUMP_CHANCE_MULT");
    specialJumpCooldownMult    = config.getFloat("ENEMY_AI_SPECIAL_JUMP_COOLDOWN_MULT");
    specialDashChanceMult      = config.getFloat("ENEMY_AI_SPECIAL_DASH_CHANCE_MULT");
    specialDashCooldownMult    = config.getFloat("ENEMY_AI_SPECIAL_DASH_COOLDOWN_MULT");
    // Offensive jump + dash scaling — Rare elites.
    rareJumpChanceMult         = config.getFloat("ENEMY_AI_RARE_JUMP_CHANCE_MULT");
    rareJumpCooldownMult       = config.getFloat("ENEMY_AI_RARE_JUMP_COOLDOWN_MULT");
    rareDashChanceMult         = config.getFloat("ENEMY_AI_RARE_DASH_CHANCE_MULT");
    rareDashCooldownMult       = config.getFloat("ENEMY_AI_RARE_DASH_COOLDOWN_MULT");
    // Offensive jump + dash scaling — Uncommon elites.
    uncommonJumpChanceMult     = config.getFloat("ENEMY_AI_UNCOMMON_JUMP_CHANCE_MULT");
    uncommonJumpCooldownMult   = config.getFloat("ENEMY_AI_UNCOMMON_JUMP_COOLDOWN_MULT");
    uncommonDashChanceMult     = config.getFloat("ENEMY_AI_UNCOMMON_DASH_CHANCE_MULT");
    uncommonDashCooldownMult   = config.getFloat("ENEMY_AI_UNCOMMON_DASH_COOLDOWN_MULT");
    // Roll-failure retry cooldowns.
    jumpRetryCooldown          = config.getFloat("ENEMY_AI_JUMP_RETRY_COOLDOWN");
    dashRetryCooldown          = config.getFloat("ENEMY_AI_DASH_RETRY_COOLDOWN");
    // Juke chance scaling by rank.
    specialJukeChanceMult      = config.getFloat("ENEMY_AI_SPECIAL_JUKE_CHANCE_MULT");
    rareJukeChanceMult         = config.getFloat("ENEMY_AI_RARE_JUKE_CHANCE_MULT");
    uncommonJukeChanceMult     = config.getFloat("ENEMY_AI_UNCOMMON_JUKE_CHANCE_MULT");
    // Flank approach geometry.
    flankMaxDistance           = config.getFloat("ENEMY_AI_FLANK_MAX_DISTANCE");
    flankMidDistance           = config.getFloat("ENEMY_AI_FLANK_MID_DISTANCE");
    flankBlendDivisor          = config.getFloat("ENEMY_AI_FLANK_BLEND_DIVISOR");
    flankMaxAngleDeg           = config.getFloat("ENEMY_AI_FLANK_MAX_ANGLE_DEG");
    // Defensive dash scaling (on-hit sidestep).
    specialDefensiveDashChanceMult    = config.getFloat("ENEMY_AI_SPECIAL_DEF_DASH_CHANCE_MULT");
    specialDefensiveDashCooldownMult  = config.getFloat("ENEMY_AI_SPECIAL_DEF_DASH_COOLDOWN_MULT");
    rareDefensiveDashChanceMult       = config.getFloat("ENEMY_AI_RARE_DEF_DASH_CHANCE_MULT");
    rareDefensiveDashCooldownMult     = config.getFloat("ENEMY_AI_RARE_DEF_DASH_COOLDOWN_MULT");
    uncommonDefensiveDashChanceMult   = config.getFloat("ENEMY_AI_UNCOMMON_DEF_DASH_CHANCE_MULT");
    uncommonDefensiveDashCooldownMult = config.getFloat("ENEMY_AI_UNCOMMON_DEF_DASH_COOLDOWN_MULT");
}

// --- Misc helpers (moved from EnemyManager.cpp to keep responsibilities narrow) ---

std::string EnemyManager::wavePhaseString() const {
    switch (wavePhase) {
    case WavePhase::Idle:          return "Idle";
    case WavePhase::ScoutAlive:    return "ScoutAlive";
    case WavePhase::DiceEquipWait: return "DiceEquipWait";
    case WavePhase::GroupAlive:    return "GroupAlive";
    case WavePhase::Exploration:   return "Exploration";
    }
    return "Unknown";
}

bool EnemyManager::hasAnyRequiredDiceSlotted() const {
    if (!weaponSlotHubPtr) return false;
    for (int r = 0; r < weaponSlotHubPtr->rowCount(); ++r) {
        for (int c = 0; c < weaponSlotHubPtr->diceCellsPerRow(); ++c) {
            const auto* dice = weaponSlotHubPtr->peekDice(r, c);
            if (dice && dice->face() == waveRequiredDiceFace) return true;
        }
    }
    return false;
}

}  // namespace dof::managers
