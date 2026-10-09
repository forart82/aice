#include "combat/QualityScale.hpp"

#include "entities/QualityTier.hpp"
#include "loaders/ConfigLoader.hpp"

#include <algorithm>

namespace dof::combat {

float qualityStatFactor(int qualityScore, float minimumFactor) {
    const float qPart = static_cast<float>(std::clamp(qualityScore, 1, 100)) / 100.0f;
    const float minimum = std::clamp(minimumFactor, 0.0f, 1.0f);
    return minimum + (1.0f - minimum) * qPart;
}

float universalMultiplier(int qualityScore, int itemLevel, float minimumFactor) {
    return qualityStatFactor(qualityScore, minimumFactor)
         * static_cast<float>(std::max(1, itemLevel));
}

float qualityStatMultiplier(dof::entities::QualityTier tier,
                            const dof::loaders::ConfigLoader& config) {
    switch (tier) {
        case dof::entities::QualityTier::Uncommon:
            return config.getFloat("QUALITY_STAT_MULT_UNCOMMON");
        case dof::entities::QualityTier::Rare:
            return config.getFloat("QUALITY_STAT_MULT_RARE");
        case dof::entities::QualityTier::Common:
        default:
            return config.getFloat("QUALITY_STAT_MULT_COMMON");
    }
}

}
