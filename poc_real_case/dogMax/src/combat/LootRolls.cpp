#include "combat/LootRolls.hpp"

#include "helpers/RandomHelper.hpp"

#include <algorithm>

namespace dof::combat {

int rollQuality(dof::helpers::RandomHelper& rng, int qFloor) {
    // SA26 / spec §Quality L1718: `q ∈ [1, 100]`. The clamp first lifts
    // a negative floor up to 0 so callers can pass an un-clipped luck
    // delta, then `std::max(1, …)` enforces the lower spec bound so a
    // luck-less roll (qFloor = 0) still lands at ≥ 1 — never 0.
    const int clampedFloor = std::clamp(qFloor, 0, 99);
    return rng.uniformInt(std::max(1, clampedFloor), 100);
}

int rollItemLevel(dof::helpers::RandomHelper& rng, int enemyLevel) {
    // SE10 / spec L1846 — lower bound rises to `⌈enemyLevel / 2⌉` so
    // late-game drops can't roll an L1 itemLevel that would feel
    // useless against the enemies dropping them. Equivalent to
    // `(enemyLevel + 1) / 2` in integer arithmetic. The floor at 1
    // covers the enemyLevel ≤ 1 corner case.
    const int upper = std::max(1, enemyLevel);
    const int lower = std::max(1, (enemyLevel + 1) / 2);
    return rng.uniformInt(lower, upper);
}

int rollStatQuality(dof::helpers::RandomHelper& rng, int biasFloor) {
    // Per-stat independent quality roll. biasFloor lifts the lower bound
    // so enemy tier + luck jointly push every stat toward the top of its range.
    const int floor = std::clamp(biasFloor, 0, 99);
    return rng.uniformInt(std::max(1, floor), 100);
}

}
