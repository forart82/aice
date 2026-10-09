#pragma once

// card-mpl0eo9k — pure helper for rolling-window kill-streak XP
// multiplier. Returns the (newStreakCount, multiplier) pair so the
// caller can store both back on its own state without re-deriving the
// streak count from the multiplier (lossy). Behaviour:
// - First kill of the run (lastKillSimTime < 0): streak resets to 1,
//   multiplier = 1.0.
// - Kill inside the window (simTime - lastKillSimTime <= window):
//   streak += 1, multiplier = clamp(1 + (streak-1) * bonusPerKill,
//   1.0, maxMult).
// - Kill outside the window: streak resets to 1, multiplier = 1.0.

namespace dof::combat {

struct KillStreakOutcome {
    int   newStreak{1};
    float multiplier{1.0f};
};

KillStreakOutcome computeKillStreakMultiplier(double simTime,
                                               double lastKillSimTime,
                                               int   currentStreak,
                                               float windowSeconds,
                                               float bonusPerKill,
                                               float maxMultiplier);

}
