#pragma once

#include "entities/QualityTier.hpp"
#include "render/ColorTheme.hpp"

#include <SFML/Graphics/Color.hpp>
#include <SFML/System/Vector2.hpp>

namespace dof::loaders { class ConfigLoader; }
namespace sf { class RenderTarget; }

namespace dof::render {

// Spec §Filigree L306-312 + §Aesthetic & Audio §Filigree Density
// L3485-3489. Decorative high-frequency neon line work overlaid on
// key surfaces. The overlay is purely visual flair — short tangent
// lines drawn at small radii around an anchor in the tier palette.
//
// Pure params + per-tier line count + palette lookup live here so
// they can be unit-tested without instantiating SFML state; the
// actual draw call lives in `drawFiligree` and is exercised at the
// integration / render layer.
struct FiligreeParams {
    bool  isEnabled;
    int   lineCountCommon;
    int   lineCountUncommon;
    int   lineCountRare;
    float radiusMin;
    float radiusMax;
    float lineLength;
    float lineThickness;
    int   alpha;
};

FiligreeParams loadFiligreeParams(const dof::loaders::ConfigLoader& config);

int computeFiligreeLineCount(dof::entities::QualityTier tier, const FiligreeParams& params);

sf::Color computeFiligreePaletteColor(dof::entities::QualityTier tier, const ColorTheme& theme, int alpha);

// Procedural overlay around `anchor` in world space. Deterministic
// for a given (anchor, tier) so the pattern does not jitter between
// frames. No-ops when the params disable the effect or the tier
// resolves to zero lines.
void drawFiligree(sf::RenderTarget& target,
                  sf::Vector2f anchor,
                  dof::entities::QualityTier tier,
                  const FiligreeParams& params,
                  const ColorTheme& theme);

}
