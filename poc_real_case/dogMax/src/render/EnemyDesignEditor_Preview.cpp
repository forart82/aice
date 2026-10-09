#include "render/EnemyDesignEditor.hpp"

#include "entities/EnemyTemplate.hpp"
#include "render/EnemyBodyPainter.hpp"
#include "render/EnemyDesignEditorShared.hpp"
#include "render/EnemyEffectRenderer.hpp"
#include "render/EnemyShapeCatalog.hpp"
#include "render/ShapeShaders.hpp"
#include "render/WorldRenderer.hpp"
#include "render/ui/UiPanel.hpp"
#include "loaders/ShaderLoader.hpp"

#include <SFML/Graphics/CircleShape.hpp>
#include <SFML/Graphics/ConvexShape.hpp>
#include <SFML/Graphics/RectangleShape.hpp>
#include <SFML/Graphics/RenderTexture.hpp>
#include <SFML/Graphics/RenderWindow.hpp>
#include <SFML/Graphics/Sprite.hpp>
#include <SFML/Graphics/View.hpp>

#include <algorithm>
#include <cstdint>

namespace dof::render {

using namespace dof::render::editor;

namespace {

// Draw the template-driven body at center on target (halo + shape + core +
// effect layers). Mirrors the template path of drawEnemyBody without needing
// a live Enemy object.
void drawPreviewBody(sf::RenderTarget& target,
                     sf::Vector2f center,
                     const dof::entities::EnemyTierDesign& design,
                     const EnemyBodyParams& params,
                     const std::vector<EnemyShapeSpec>& shapeCatalog,
                     const dof::loaders::ShaderLoader* shaders,
                     ShapeShaders* shapeShaders,
                     float elapsed) {
    if (shapeCatalog.empty()) return;

    const sf::Color outline = design.outline;
    const float radius = design.bodySize;

    // Effect layers behind the body (z < 0).
    if (shapeShaders && shaders)
        drawEnemyEffectLayers(target, center, design.layers, shaders,
                              *shapeShaders, elapsed, true);

    // Halo glow rings.
    for (int layer = params.haloLayers; layer >= 1; --layer) {
        const float r = radius
            + static_cast<float>(layer * params.haloRadiusStep);
        sf::CircleShape glow(r, 32);
        glow.setOrigin({r, r});
        glow.setPosition(center);
        sf::Color gc = outline;
        gc.a = static_cast<std::uint8_t>(
            std::clamp(static_cast<float>(params.haloAlphaBase)
                       / static_cast<float>(layer + 1),
                       0.0f, 255.0f));
        glow.setFillColor(gc);
        target.draw(glow);
    }

    // Body silhouette from the shape catalogue.
    const int shapeIndex = std::clamp(design.bodyShape, 0,
                                      static_cast<int>(shapeCatalog.size()) - 1);
    const EnemyShapeSpec& spec = shapeCatalog[static_cast<std::size_t>(shapeIndex)];
    const std::vector<sf::Vector2f> pts = buildEnemyShapeOutline(spec, radius);
    sf::ConvexShape body(pts.size());
    for (std::size_t i = 0; i < pts.size(); ++i)
        body.setPoint(i, {center.x + pts[i].x, center.y + pts[i].y});
    body.setFillColor(design.fill);
    body.setOutlineThickness(static_cast<float>(-params.haloThickness));
    body.setOutlineColor(outline);
    target.draw(body);

    // Optional accent core dot.
    if (spec.coreRadius > 0.0f) {
        const float cr = radius * spec.coreRadius;
        sf::CircleShape core(cr, 24);
        core.setOrigin({cr, cr});
        core.setPosition(center);
        core.setFillColor(outline);
        target.draw(core);
    }

    // Effect layers in front of the body (z >= 0).
    if (shapeShaders && shaders)
        drawEnemyEffectLayers(target, center, design.layers, shaders,
                              *shapeShaders, elapsed, false);
}

} // namespace

void EnemyDesignEditor::renderPreview(sf::RenderWindow& window, float elapsed) {
    if (currentTypeIndex < 0) return;
    if (worldRendererRef.getShapeCatalog().empty()) return;

    // `elapsed` is clock.simulatedSeconds() — ABSOLUTE time since start, the
    // same value drawEnemyBody receives on the live path, not a per-frame
    // delta. Accumulating it made the preview's effect clock grow
    // quadratically (and it was never reset between editor sessions), so the
    // preview strobed instead of matching what the game renders.

    // Lazy-initialize / resize the render texture.
    const unsigned sz = static_cast<unsigned>(previewSize_);
    if (previewTexture_.getSize() != sf::Vector2u{sz, sz})
        previewTexture_ = sf::RenderTexture({sz, sz});

    // Render enemy body into the texture.
    previewTexture_.clear(sf::Color{8, 5, 20});

    const sf::Vector2f center{previewSize_ / 2.f, previewSize_ / 2.f};
    const dof::entities::EnemyTierDesign& tier =
        currentTierIndex == 1 ? currentEdit.uncommon :
        currentTierIndex == 2 ? currentEdit.rare :
        currentEdit.common;

    const EnemyBodyParams& params = worldRendererRef.getEnemyBodyParams();
    const auto& catalog = worldRendererRef.getShapeCatalog();
    ShapeShaders* ss = const_cast<ShapeShaders*>(params.shapeShaders);

    drawPreviewBody(previewTexture_, center, tier, params, catalog,
                    &shadersRef, ss, elapsed);

    previewTexture_.display();

    // Blit the texture into the editor panel.
    sf::Sprite sprite(previewTexture_.getTexture());
    sprite.setPosition(previewRect_.position);
    window.draw(sprite);

    // Border around the preview.
    sf::RectangleShape border{previewRect_.size};
    border.setPosition(previewRect_.position);
    border.setFillColor(sf::Color::Transparent);
    border.setOutlineColor(palette_.panelOutline);
    border.setOutlineThickness(1.f);
    window.draw(border);
}

} // namespace dof::render
