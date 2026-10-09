#pragma once

#include <vector>

namespace dof::loaders { class ConfigLoader; }

namespace dof::combat {

// SE1 — piecewise distance-step curve for enemy spawn levels.
// Replaces the flat `ENEMY_LEVEL_DISTANCE_STEP` constant. Three
// bands: linear, exponential, exponential. The cumulative table is
// built once at construction from five tunables in
// `configs/enemy_levels.yaml`; runtime cost is O(1) lookup per
// spawn via `levelFromDistance`.
class EnemyLevelCurve {
public:
    explicit EnemyLevelCurve(const dof::loaders::ConfigLoader& config);

    // Returns the enemy level (in [1, maxLevel()]) for a hero-relative
    // walked distance. Implementation walks the cumulative table from
    // the back so high-level zones hit in O(1) for the common case;
    // worst-case is O(maxLevel) which is bounded by 99.
    int levelFromDistance(float distance) const;

    // Inverse: cumulative px to reach `level`. `cumulativeForLevel(1)`
    // is 0; `cumulativeForLevel(maxLevel())` is the spec-targeted
    // 28-30 M px. Out-of-range levels clamp to the nearest valid.
    float cumulativeForLevel(int level) const;

    int   maxLevel() const;

private:
    int                maxLevelValue{99};
    std::vector<float> cumulative;  // size = maxLevel + 1; cumulative[0] is unused
};

}
