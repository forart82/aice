#include "combat/EnemyLevelCurve.hpp"

#include "loaders/ConfigLoader.hpp"

#include <algorithm>
#include <cmath>

namespace dof::combat {

EnemyLevelCurve::EnemyLevelCurve(const dof::loaders::ConfigLoader& config) {
    const float linearStep = config.getFloat("ENEMY_LEVEL_LINEAR_STEP");
    const int   linearEnd  = config.getInt  ("ENEMY_LEVEL_LINEAR_END");
    const float exp1Factor = config.getFloat("ENEMY_LEVEL_EXP1_FACTOR");
    const int   exp1End    = config.getInt  ("ENEMY_LEVEL_EXP1_END");
    const float exp2Factor = config.getFloat("ENEMY_LEVEL_EXP2_FACTOR");
    // Clamp to >= 1 so a misconfigured ENEMY_LEVEL_MAX (0 or negative) can't
    // underflow the size_t cast into a huge allocation, nor make cumulative[1]
    // an out-of-bounds write on a size-1 vector.
    maxLevelValue          = std::max(1, config.getInt("ENEMY_LEVEL_MAX"));

    cumulative.assign(static_cast<size_t>(maxLevelValue) + 1, 0.0f);
    if (maxLevelValue >= 1) cumulative[1] = 0.0f;

    // L2..linearEnd: linear step at `linearStep`. cumulative[N] is
    // the px walked from the hero spawn to reach level N.
    for (int level = 2; level <= linearEnd && level <= maxLevelValue; ++level) {
        cumulative[static_cast<size_t>(level)] =
            cumulative[static_cast<size_t>(level - 1)] + linearStep;
    }

    // L(linearEnd+1)..exp1End: step(N) = linearStep * exp1Factor^(N - linearEnd).
    for (int level = linearEnd + 1; level <= exp1End && level <= maxLevelValue; ++level) {
        const float exponent = static_cast<float>(level - linearEnd);
        const float step     = linearStep * std::pow(exp1Factor, exponent);
        cumulative[static_cast<size_t>(level)] =
            cumulative[static_cast<size_t>(level - 1)] + step;
    }

    // L(exp1End+1)..maxLevel: step(N) = step(exp1End) * exp2Factor^(N - exp1End).
    const float stepAtExp1End = linearStep * std::pow(exp1Factor, static_cast<float>(exp1End - linearEnd));
    for (int level = exp1End + 1; level <= maxLevelValue; ++level) {
        const float exponent = static_cast<float>(level - exp1End);
        const float step     = stepAtExp1End * std::pow(exp2Factor, exponent);
        cumulative[static_cast<size_t>(level)] =
            cumulative[static_cast<size_t>(level - 1)] + step;
    }
}

int EnemyLevelCurve::levelFromDistance(float distance) const {
    if (distance <= 0.0f) return 1;
    // Walk from the back: the spawn ring at the player's current
    // distance sits near the active level zone, so the loop usually
    // hits within a handful of iterations on a typical play session.
    for (int level = maxLevelValue; level >= 1; --level) {
        if (distance >= cumulative[static_cast<size_t>(level)]) return level;
    }
    return 1;
}

float EnemyLevelCurve::cumulativeForLevel(int level) const {
    if (level <= 1) return 0.0f;
    if (level > maxLevelValue) return cumulative[static_cast<size_t>(maxLevelValue)];
    return cumulative[static_cast<size_t>(level)];
}

int EnemyLevelCurve::maxLevel() const { return maxLevelValue; }

}
