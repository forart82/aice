#pragma once

#include "render/ColorTheme.hpp"
#include "render/EnemyShapeCatalog.hpp"

#include <vector>

namespace dof::entities { class FloorItem; }
namespace dof::loaders  { class ConfigLoader; }
namespace dof::render   { class ShapeShaders; }
namespace sf            { class Font; class RenderTarget; class Shader; class Texture; }

namespace dof::render {

struct FloorItemPainterParams {
    float          blinkCycleSeconds;
    float          blinkAlphaBase;
    float          blinkAlphaAmp;
    ShapeShaders*  shapeShaders  = nullptr;
    sf::Shader*    dieShader     = nullptr;
    const sf::Font* font         = nullptr;
    // Shared silhouette alphabet — the same one hero, enemies and world props
    // are cut from, so a dropped weapon belongs to the same world as everything
    // else on screen.
    const std::vector<EnemyShapeSpec>* shapeCatalog = nullptr;
    float          glyphRimRatio = 0.0f;
};

void drawFloorItemBody(sf::RenderTarget& window,
                       const dof::entities::FloorItem& floorItem,
                       float simSeconds,
                       const FloorItemPainterParams& params,
                       const ColorTheme& theme,
                       const dof::loaders::ConfigLoader& config);

}
