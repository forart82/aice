#include "render/DamageTextQualityTint.hpp"

#include <algorithm>

namespace dof::render {

namespace {

sf::Color tierPaletteFor(dof::entities::QualityTier tier, const ColorTheme& theme) {
    switch (tier) {
        case dof::entities::QualityTier::Uncommon: return theme.tierUncommon;
        case dof::entities::QualityTier::Rare:     return theme.tierRare;
        case dof::entities::QualityTier::Common:
        default:                                   return theme.tierCommon;
    }
}

std::uint8_t blendChannel(std::uint8_t base, std::uint8_t tier, float blend) {
    const float mixed = static_cast<float>(base) * (1.0f - blend)
                      + static_cast<float>(tier) * blend;
    return static_cast<std::uint8_t>(std::clamp(mixed, 0.0f, 255.0f));
}

}

sf::Color tintByQuality(sf::Color base,
                        dof::entities::QualityTier sourceTier,
                        float blend,
                        const ColorTheme& theme) {
    const float clampedBlend = std::clamp(blend, 0.0f, 1.0f);
    if (clampedBlend == 0.0f) return base;
    const sf::Color tier = tierPaletteFor(sourceTier, theme);
    return sf::Color{
        blendChannel(base.r, tier.r, clampedBlend),
        blendChannel(base.g, tier.g, clampedBlend),
        blendChannel(base.b, tier.b, clampedBlend),
        base.a};
}

}
