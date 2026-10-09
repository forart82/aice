#pragma once

#include <array>
#include <cstdint>
#include <vector>

namespace dof::loaders { class ConfigLoader; }

namespace dof::abilities {

struct Levelable {
    int          level{1};
    std::int64_t experience{0};
    std::int64_t experienceForNextLevel{100};
    int          maxLevel{100};

    std::vector<std::int64_t> stepCosts;

    float xpDeltaScale{0.1f};
    float xpDeltaMin{0.1f};
    float xpDeltaMax{2.0f};
    std::array<float, 3> qualityMult{1.0f, 1.5f, 3.0f};

    void loadFromConfig(const dof::loaders::ConfigLoader& config);
    void grantExperience(std::int64_t amount);
    std::int64_t grantKillExperience(int enemyLevel, int qualityTierIndex);

    // card-mpl0eo9k — pure compute path so a caller (WeaponManager)
    // can apply a kill-streak multiplier to the raw XP value BEFORE
    // calling `grantExperience`. `grantKillExperience` keeps its
    // existing semantics (compute + grant in one shot) so direct
    // callers and existing tests continue to work unchanged.
    std::int64_t computeKillExperience(int enemyLevel, int qualityTierIndex) const;

    // Spec §Hero Death — Run restart resets level and XP to the
    // starter state. `stepCosts` and tuning values stay (those came
    // from config and are run-invariant). Sets `experienceForNextLevel`
    // back to the first step so the level-1 progress bar reads 0/100.
    void reset();
};

}
