#pragma once

#include <array>

namespace dof::loaders { class ConfigLoader; }

namespace dof::combat {

// SE2 / spec L523-534 — distance-quintile tier cadence. The hero's
// cumulative walked-distance progress (relative to cum[maxLevel])
// falls into Q0..Q4; each quintile carries its own `(rare, uncommon)`
// cadence pair so deeper quintiles roll Rare + Uncommon spawns more
// frequently than the early-game quintiles.
struct TierCadencePair {
    int rare{100};
    int uncommon{10};
};

class TierCadence {
public:
    static constexpr int kQuintileCount = 5;

    explicit TierCadence(const dof::loaders::ConfigLoader& config);

    // Map a [0, 1] progress fraction to a quintile band index. Clamps
    // out-of-range inputs: progress <= 0 → 0; progress >= 1 → 4.
    static int quintileFor(float progress);

    // Returns the cadence pair for the resolved quintile.
    TierCadencePair cadenceFor(float progress) const;

private:
    std::array<TierCadencePair, kQuintileCount> bands{};
};

}
