// Spawn-exclusion FIFO (spec §Spawn Exclusion FIFO). An entry is written when
// an enemy dies — the value is that enemy's ORIGINAL spawn position, not where
// it fell — so the area is remembered as a recent kill zone.
// `isExcludedSpawn` answers "is this position inside one of those zones?";
// `pickSpecialForSpawn` uses it to gate special-enemy substitution, and the
// debug overlay paints the zones. The procedural ring spawner that also read
// this lived in this file and was removed as unreachable; the FIFO is not
// affected by that removal and stays live.
#include "managers/EnemyManager.hpp"

namespace dof::managers {

bool EnemyManager::isExcludedSpawn(sf::Vector2f candidate) const {
    if (spawnExclusionRadius <= 0.0f) return false;
    const float thresholdSq = spawnExclusionRadius * spawnExclusionRadius;
    for (const auto& dead : spawnExclusionFifo) {
        const float dx = candidate.x - dead.x;
        const float dy = candidate.y - dead.y;
        if (dx * dx + dy * dy <= thresholdSq) return true;
    }
    return false;
}

void EnemyManager::recordSpawnExclusion(sf::Vector2f spawnPosition) {
    if (spawnExclusionFifoSize <= 0) return;
    spawnExclusionFifo.push_back(spawnPosition);
    while (static_cast<int>(spawnExclusionFifo.size()) > spawnExclusionFifoSize) {
        spawnExclusionFifo.pop_front();
    }
}

} // namespace dof::managers
