#include "combat/KillStreak.hpp"

#include <algorithm>

namespace dof::combat {

KillStreakOutcome computeKillStreakMultiplier(double simTime,
                                               double lastKillSimTime,
                                               int   currentStreak,
                                               float windowSeconds,
                                               float bonusPerKill,
                                               float maxMultiplier) {
    KillStreakOutcome out;
    if (lastKillSimTime < 0.0 || windowSeconds <= 0.0f) {
        out.newStreak  = 1;
        out.multiplier = 1.0f;
        return out;
    }
    const double dt = simTime - lastKillSimTime;
    if (dt > static_cast<double>(windowSeconds)) {
        out.newStreak  = 1;
        out.multiplier = 1.0f;
        return out;
    }
    const int boostedStreak = currentStreak + 1;
    out.newStreak = boostedStreak;
    const float raw = 1.0f + static_cast<float>(boostedStreak - 1) * bonusPerKill;
    const float floorMult = 1.0f;
    const float ceilMult  = std::max(floorMult, maxMultiplier);
    out.multiplier = std::clamp(raw, floorMult, ceilMult);
    return out;
}

}
