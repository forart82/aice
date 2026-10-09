#pragma once

#include <utility>

namespace dof::entities {

enum class QualityTier { Common, Uncommon, Rare };

const char* qualityTierName(QualityTier tier);

QualityTier qualityTierFromScore(int qualityScore,
                                 int uncommonThreshold,
                                 int rareThreshold);

std::pair<int, int> qualityScoreRangeForTier(QualityTier tier,
                                             int uncommonThreshold,
                                             int rareThreshold);

}
