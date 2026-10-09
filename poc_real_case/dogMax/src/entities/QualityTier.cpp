#include "entities/QualityTier.hpp"

#include <algorithm>

namespace dof::entities {

const char* qualityTierName(QualityTier tier) {
    switch (tier) {
        case QualityTier::Common:   return "Common";
        case QualityTier::Uncommon: return "Uncommon";
        case QualityTier::Rare:     return "Rare";
    }
    return "Common";
}

QualityTier qualityTierFromScore(int qualityScore,
                                 int uncommonThreshold,
                                 int rareThreshold) {
    if (qualityScore < uncommonThreshold) return QualityTier::Common;
    if (qualityScore < rareThreshold)     return QualityTier::Uncommon;
    return QualityTier::Rare;
}

std::pair<int, int> qualityScoreRangeForTier(QualityTier tier,
                                             int uncommonThreshold,
                                             int rareThreshold) {
    const int clampedUncommon = std::max(2, uncommonThreshold);
    const int clampedRare     = std::max(clampedUncommon + 1, rareThreshold);
    switch (tier) {
        case QualityTier::Common:   return {1, clampedUncommon - 1};
        case QualityTier::Uncommon: return {clampedUncommon, clampedRare - 1};
        case QualityTier::Rare:     return {clampedRare, 100};
    }
    return {1, clampedUncommon - 1};
}

}
