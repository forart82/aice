#include "abilities/Levelable.hpp"

#include "loaders/ConfigLoader.hpp"

#include <algorithm>
#include <cmath>
#include <string>

namespace dof::abilities {

namespace {

std::int64_t readStep(const dof::loaders::ConfigLoader& config, int level) {
    const std::string key = "HERO_XP_LEVEL_" + std::to_string(level);
    return static_cast<std::int64_t>(config.getFloat(key));
}

}

void Levelable::loadFromConfig(const dof::loaders::ConfigLoader& config) {
    xpDeltaScale = config.getFloat("XP_DELTA_SCALE");
    xpDeltaMin   = config.getFloat("XP_DELTA_MIN");
    xpDeltaMax   = config.getFloat("XP_DELTA_MAX");
    qualityMult[0] = config.getFloat("XP_QUALITY_MULT_COMMON");
    qualityMult[1] = config.getFloat("XP_QUALITY_MULT_UNCOMMON");
    qualityMult[2] = config.getFloat("XP_QUALITY_MULT_RARE");

    stepCosts.clear();
    if (maxLevel > 1) stepCosts.reserve(static_cast<std::size_t>(maxLevel - 1));
    for (int n = 1; n < maxLevel; ++n) {
        // Floor each step to >= 1 so a config step cost of 0 can't make
        // experienceForNextLevel 0 (which would let one kill cascade the hero
        // up many levels, since experience >= 0 is always true).
        stepCosts.push_back(std::max<std::int64_t>(1, readStep(config, n)));
    }
    if (!stepCosts.empty()) {
        experienceForNextLevel = stepCosts.front();
    }
}

void Levelable::grantExperience(std::int64_t amount) {
    if (amount <= 0) return;
    if (level >= maxLevel) return;
    experience += amount;
    while (level < maxLevel && experience >= experienceForNextLevel) {
        experience -= experienceForNextLevel;
        ++level;
        const std::size_t idx = static_cast<std::size_t>(level - 1);
        if (idx < stepCosts.size()) {
            experienceForNextLevel = stepCosts[idx];
        } else {
            experienceForNextLevel =
                experienceForNextLevel + experienceForNextLevel / 2;
        }
    }
    if (level >= maxLevel) experience = 0;
}

void Levelable::reset() {
    level = 1;
    experience = 0;
    experienceForNextLevel = stepCosts.empty() ? 100 : stepCosts.front();
}

std::int64_t Levelable::computeKillExperience(int enemyLevel, int qualityTierIndex) const {
    // card-mpl0eo9k — pure compute path. Same formula as the original
    // `grantKillExperience` body sans the side-effect grant, so it can
    // be unit-tested without state mutation and reused by callers that
    // want to apply additional multipliers (kill streak, future events).
    if (enemyLevel <= 0) return 0;
    const int tierIdx = std::clamp(qualityTierIndex, 0,
                                    static_cast<int>(qualityMult.size()) - 1);
    const int delta = enemyLevel - level;
    double deltaMult = 1.0 + static_cast<double>(delta)
                              * static_cast<double>(xpDeltaScale);
    const double minClamp = static_cast<double>(xpDeltaMin);
    const double maxClamp = static_cast<double>(xpDeltaMax);
    if (deltaMult < minClamp) deltaMult = minClamp;
    if (deltaMult > maxClamp) deltaMult = maxClamp;
    const double levelSquared = static_cast<double>(enemyLevel) * enemyLevel;
    const double tierMult =
        static_cast<double>(qualityMult[static_cast<std::size_t>(tierIdx)]);
    const double raw = levelSquared * tierMult * deltaMult;
    const std::int64_t amount = static_cast<std::int64_t>(std::floor(raw));
    return amount > 0 ? amount : 0;
}

std::int64_t Levelable::grantKillExperience(int enemyLevel, int qualityTierIndex) {
    const std::int64_t amount = computeKillExperience(enemyLevel, qualityTierIndex);
    if (amount > 0) grantExperience(amount);
    return amount;
}

}
