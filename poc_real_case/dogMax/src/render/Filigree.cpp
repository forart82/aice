#include "render/Filigree.hpp"

#include "loaders/ConfigLoader.hpp"

#include <SFML/Graphics/RectangleShape.hpp>
#include <SFML/Graphics/RenderTarget.hpp>

#include <algorithm>
#include <cmath>
#include <cstdint>

namespace dof::render {

namespace {

constexpr float kTwoPi = 6.28318530717958647692f;

}

FiligreeParams loadFiligreeParams(const dof::loaders::ConfigLoader& config) {
    return FiligreeParams{
        config.getInt("FILIGREE_ENABLE") != 0,
        config.getInt("FILIGREE_LINE_COUNT_COMMON"),
        config.getInt("FILIGREE_LINE_COUNT_UNCOMMON"),
        config.getInt("FILIGREE_LINE_COUNT_RARE"),
        config.getFloat("FILIGREE_RADIUS_MIN"),
        config.getFloat("FILIGREE_RADIUS_MAX"),
        config.getFloat("FILIGREE_LINE_LENGTH"),
        config.getFloat("FILIGREE_LINE_THICKNESS"),
        config.getInt("FILIGREE_ALPHA")};
}

int computeFiligreeLineCount(dof::entities::QualityTier tier, const FiligreeParams& params) {
    if (!params.isEnabled) return 0;
    switch (tier) {
        case dof::entities::QualityTier::Uncommon: return params.lineCountUncommon;
        case dof::entities::QualityTier::Rare:     return params.lineCountRare;
        case dof::entities::QualityTier::Common:
        default:                                   return params.lineCountCommon;
    }
}

sf::Color computeFiligreePaletteColor(dof::entities::QualityTier tier, const ColorTheme& theme, int alpha) {
    sf::Color color = theme.tierCommon;
    switch (tier) {
        case dof::entities::QualityTier::Uncommon: color = theme.tierUncommon; break;
        case dof::entities::QualityTier::Rare:     color = theme.tierRare;     break;
        case dof::entities::QualityTier::Common:
        default:                                   color = theme.tierCommon;   break;
    }
    color.a = static_cast<std::uint8_t>(std::clamp(alpha, 0, 255));
    return color;
}

void drawFiligree(sf::RenderTarget& target,
                  sf::Vector2f anchor,
                  dof::entities::QualityTier tier,
                  const FiligreeParams& params,
                  const ColorTheme& theme) {
    const int count = computeFiligreeLineCount(tier, params);
    if (count <= 0 || params.lineLength <= 0.0f || params.lineThickness <= 0.0f) return;

    const sf::Color color = computeFiligreePaletteColor(tier, theme, params.alpha);
    const float radiusSpan = std::max(0.0f, params.radiusMax - params.radiusMin);

    // Distribute lines evenly around the entity at alternating
    // (min .. max) radii so the pattern reads as a halo of short
    // tangent strokes rather than a regular ring. Determinism is
    // by index — no RNG so the pattern is identical across frames.
    for (int i = 0; i < count; ++i) {
        const float angle = (static_cast<float>(i) / static_cast<float>(count)) * kTwoPi;
        const float radiusOffset = (i % 2 == 0) ? 0.0f : radiusSpan;
        const float radius = params.radiusMin + radiusOffset;
        const float cosA = std::cos(angle);
        const float sinA = std::sin(angle);
        sf::RectangleShape line({params.lineLength, params.lineThickness});
        line.setOrigin({params.lineLength * 0.5f, params.lineThickness * 0.5f});
        line.setPosition({anchor.x + cosA * radius, anchor.y + sinA * radius});
        // Tangent orientation: rotate by angle + 90 deg so the line
        // runs perpendicular to the radius vector.
        line.setRotation(sf::degrees((angle * 180.0f / 3.14159265358979f) + 90.0f));
        line.setFillColor(color);
        target.draw(line);
    }
}

}
