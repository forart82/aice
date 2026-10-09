#pragma once

namespace dof::helpers { class DeterministicRandom; using RandomHelper = DeterministicRandom; }

namespace dof::combat {

// Loot Pipeline Stage 2 rolls (spec §Loot Pipeline + §Quality Floor + §Item Level).
//
// rollQuality(rng, qFloor) draws q ~ U_int[clamp(qFloor, 0, 99), 100].
// rollItemLevel(rng, enemyLevel) draws l ~ U_int[ceil(enemyLevel/2), enemyLevel]
// (spec L1846, SE10). Lower bound rises to half the enemy level so a
// late-game kill cannot drop an L1 item. For enemyLevel ≤ 1 the range
// degenerates to {1}.
// rollStatQuality(rng, biasFloor) draws q ~ U_int[clamp(biasFloor, 0, 99), 100]
// for per-stat independent quality rolls. biasFloor = qFloor + tierBias so
// luck + enemy tier jointly lift the lower bound of every stat roll.
int rollQuality(dof::helpers::RandomHelper& rng, int qFloor);
int rollItemLevel(dof::helpers::RandomHelper& rng, int enemyLevel);
int rollStatQuality(dof::helpers::RandomHelper& rng, int biasFloor);

}
