#include "combat/TierCadence.hpp"

#include "loaders/ConfigLoader.hpp"

namespace dof::combat {

namespace {

const char* rareKeyFor(int quintile) {
    switch (quintile) {
        case 0: return "ENEMY_TIER_CADENCE_Q0_RARE";
        case 1: return "ENEMY_TIER_CADENCE_Q1_RARE";
        case 2: return "ENEMY_TIER_CADENCE_Q2_RARE";
        case 3: return "ENEMY_TIER_CADENCE_Q3_RARE";
        default: return "ENEMY_TIER_CADENCE_Q4_RARE";
    }
}

const char* uncommonKeyFor(int quintile) {
    switch (quintile) {
        case 0: return "ENEMY_TIER_CADENCE_Q0_UNCOMMON";
        case 1: return "ENEMY_TIER_CADENCE_Q1_UNCOMMON";
        case 2: return "ENEMY_TIER_CADENCE_Q2_UNCOMMON";
        case 3: return "ENEMY_TIER_CADENCE_Q3_UNCOMMON";
        default: return "ENEMY_TIER_CADENCE_Q4_UNCOMMON";
    }
}

}

TierCadence::TierCadence(const dof::loaders::ConfigLoader& config) {
    for (int q = 0; q < kQuintileCount; ++q) {
        bands[static_cast<size_t>(q)].rare     = config.getInt(rareKeyFor(q));
        bands[static_cast<size_t>(q)].uncommon = config.getInt(uncommonKeyFor(q));
    }
}

int TierCadence::quintileFor(float progress) {
    if (progress <= 0.0f) return 0;
    if (progress >= 1.0f) return kQuintileCount - 1;
    const int band = static_cast<int>(progress * static_cast<float>(kQuintileCount));
    if (band < 0) return 0;
    if (band >= kQuintileCount) return kQuintileCount - 1;
    return band;
}

TierCadencePair TierCadence::cadenceFor(float progress) const {
    return bands[static_cast<size_t>(quintileFor(progress))];
}

}
