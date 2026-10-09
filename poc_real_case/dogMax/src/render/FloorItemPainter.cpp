#include "render/FloorItemPainter.hpp"

#include <SFML/Graphics/ConvexShape.hpp>

#include "entities/Dice.hpp"
#include "entities/FloorItem.hpp"
#include "entities/QualityTier.hpp"
#include "entities/Weapon.hpp"
#include "loaders/ConfigLoader.hpp"
#include "render/DiceColor.hpp"
#include "render/Filigree.hpp"
#include "render/LootAuraTint.hpp"
#include "render/OutlineIntensity.hpp"
#include "render/ShapeShaders.hpp"
#include "render/WeaponColors.hpp"

#include <SFML/Graphics/CircleShape.hpp>
#include <SFML/Graphics/Font.hpp>
#include <SFML/Graphics/RectangleShape.hpp>
#include <SFML/Graphics/RenderWindow.hpp>
#include <SFML/Graphics/Sprite.hpp>
#include <SFML/Graphics/Text.hpp>
#include <SFML/Graphics/Texture.hpp>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <sstream>

namespace dof::render {

namespace {

sf::Color floorItemOutlineColor(dof::entities::QualityTier tier,
                                 const ColorTheme& theme,
                                 sf::Color typeOutline) {
    switch (tier) {
        case dof::entities::QualityTier::Uncommon: return theme.tierUncommon;
        case dof::entities::QualityTier::Rare:     return theme.tierRare;
        case dof::entities::QualityTier::Common:
        default:                                   return typeOutline;
    }
}

void drawAmbientGlow(sf::RenderTarget& window, sf::Vector2f pos,
                     sf::Color color, float radius, int layers,
                     float alphaScalar, float radiusMult, float alphaMult) {
    for (int layer = layers; layer >= 1; --layer) {
        const float r = radius * (1.0f + static_cast<float>(layer) * 0.18f * radiusMult);
        sf::CircleShape glow(r, 8);
        glow.setOrigin({r, r});
        glow.setPosition(pos);
        sf::Color c = color;
        const float a = std::max(0.0f, alphaScalar) * 80.0f / static_cast<float>(layer + 1);
        c.a = static_cast<std::uint8_t>(std::clamp(a * alphaMult, 0.0f, 255.0f));
        glow.setFillColor(c);
        window.draw(glow);
    }
}

} // namespace

// Draw a floor item as a code-drawn neon glyph. The weapon type picks the
// silhouette so a mace and a dagger stay distinguishable on the ground with no
// art, and the tier colour tints it so rarity still reads at a glance.
void drawFloorItemGlyph(sf::RenderTarget& window, sf::Vector2f position,
                        float radius, sf::Color color, int shapeSeed,
                        const std::vector<EnemyShapeSpec>* catalog,
                        float rimRatio) {
    if (!catalog || catalog->empty() || radius <= 0.0f) return;
    const std::size_t index =
        static_cast<std::size_t>(shapeSeed) % catalog->size();
    const std::vector<sf::Vector2f> outline =
        buildEnemyShapeOutline((*catalog)[index], radius);
    if (outline.empty()) return;
    sf::ConvexShape glyph(outline.size());
    for (std::size_t point = 0; point < outline.size(); ++point) {
        glyph.setPoint(point, {position.x + outline[point].x,
                               position.y + outline[point].y});
    }
    glyph.setFillColor(sf::Color::Transparent);
    glyph.setOutlineColor(color);
    glyph.setOutlineThickness(-radius * rimRatio);
    window.draw(glyph);
}

void drawFloorItemBody(sf::RenderTarget& window,
                       const dof::entities::FloorItem& floorItem,
                       float simSeconds,
                       const FloorItemPainterParams& params,
                       const ColorTheme& theme,
                       const dof::loaders::ConfigLoader& config) {
    const float angularRate  = 2.0f * 3.14159265358979f / std::max(0.01f, params.blinkCycleSeconds);
    const float alphaScalar  = params.blinkAlphaBase + params.blinkAlphaAmp * std::sin(simSeconds * angularRate);
    const float unit         = 12.0f;
    const float bodySize     = unit * 2.5f;

    const dof::entities::QualityTier tier =
        floorItem.kind() == dof::entities::FloorItemKind::Weapon
            ? (floorItem.weapon() ? floorItem.weapon()->tier() : dof::entities::QualityTier::Common)
            : (floorItem.dice()   ? floorItem.dice()->tier()   : dof::entities::QualityTier::Common);

    const LootAuraTint       auraTint      = computeLootAuraTint(tier, config);
    const OutlineIntensityParams opParams  = loadOutlineIntensityParams(config);
    const float outlineMult               = computeOutlineIntensityMult(tier, false, opParams);
    const float scaledOutline             = 2.0f * outlineMult;
    const FiligreeParams filigreeParams   = loadFiligreeParams(config);
    const auto position                   = floorItem.position();

    // ── Weapon ──────────────────────────────────────────────────────────
    if (floorItem.kind() == dof::entities::FloorItemKind::Weapon) {
        const auto* weapon      = floorItem.weapon();
        const auto  type        = weapon ? weapon->type() : dof::entities::WeaponType::Pitchfork;
        const sf::Color outline = floorItemOutlineColor(tier, theme, weaponOutlineColor(config, type));

        drawAmbientGlow(window, position, outline, bodySize * 0.5f,
                        theme.haloLayers, alphaScalar, auraTint.radiusMult, auraTint.alphaMult);

        // Floor loot was the last texture drawn into the world layer: a PNG
        // weapon sprite. It is now a silhouette from the shared shape catalog,
        // like every other object in the game, tinted with the item's own tier
        // colour so the drop still reads its rarity at a glance. The weapon
        // TYPE selects the silhouette, so a mace and a dagger stay
        // distinguishable on the ground without any art.
        drawFloorItemGlyph(window, position, bodySize * 0.5f, outline,
                           static_cast<int>(type), params.shapeCatalog,
                           params.glyphRimRatio);

        drawFiligree(window, position, tier, filigreeParams, theme);

        if (weapon) {
            const auto& attached = weapon->attachedDicePeek();
            int aliveCount = 0;
            for (const auto& d : attached) if (d) ++aliveCount;
            if (aliveCount > 0) {
                const float dr  = unit * 0.22f;
                const float gap = dr * 0.6f;
                const float totalW = static_cast<float>(aliveCount) * (dr * 2.0f)
                                     + static_cast<float>(aliveCount - 1) * gap;
                float dotX = position.x - totalW * 0.5f + dr;
                const float dotY = position.y + unit * 0.95f;
                for (const auto& d : attached) {
                    if (!d) continue;
                    sf::CircleShape marker(dr, 8);
                    marker.setOrigin({dr, dr});
                    marker.setPosition({dotX, dotY});
                    marker.setFillColor(diceColorForFace(config, d->face()));
                    marker.setOutlineThickness(1.0f);
                    marker.setOutlineColor(theme.uiText);
                    window.draw(marker);
                    dotX += dr * 2.0f + gap;
                }
            }
        }
        return;
    }

    // ── Dice ─────────────────────────────────────────────────────────────
    const auto* dice = floorItem.dice();
    if (!dice) return;

    const sf::Color diceOutline = floorItemOutlineColor(tier, theme, theme.pitchforkOutline);
    const sf::Color faceColor   = diceColorForFace(config, dice->face());

    for (int layer = theme.haloLayers; layer >= 1; --layer) {
        const float a = std::max(0.0f, alphaScalar) *
                        static_cast<float>(theme.haloAlphaBase) /
                        static_cast<float>(layer + 1);
        const float r = unit * 1.2f * (1.0f + static_cast<float>(layer) * 0.18f * auraTint.radiusMult);
        sf::CircleShape glow(r, 6);
        glow.setOrigin({r, r});
        glow.setPosition(position);
        sf::Color gc = diceOutline;
        gc.a = static_cast<std::uint8_t>(std::clamp(a * auraTint.alphaMult, 0.0f, 255.0f));
        glow.setFillColor(gc);
        window.draw(glow);
    }

    if (params.dieShader && params.shapeShaders) {
        params.shapeShaders->drawDie(window, params.dieShader,
                                     position, bodySize, dice->face(), colorToGlsl(faceColor));
    } else {
        sf::CircleShape body(unit * 1.2f, 6);
        body.setOrigin({unit * 1.2f, unit * 1.2f});
        body.setPosition(position);
        sf::Color fill = diceOutline; fill.a = 80;
        body.setFillColor(fill);
        body.setOutlineThickness(scaledOutline);
        sf::Color oc = diceOutline;
        oc.a = static_cast<std::uint8_t>(std::clamp(255.0f * alphaScalar, 0.0f, 255.0f));
        body.setOutlineColor(oc);
        window.draw(body);
    }

    if (params.font) {
        std::ostringstream oss;
        // Rolled VALUE of the up face (faceted faces rewrite values), not index.
        oss << dice->faceValue(dice->currentFace());
        sf::Text faceLabel(*params.font, oss.str(), 10);
        auto bounds = faceLabel.getLocalBounds();
        // SFML 3 local bounds carry a glyph-bearing offset in `position`; every
        // other centring site in the renderer subtracts it. Ignoring it here
        // left the floor die's face number visibly off-centre.
        faceLabel.setOrigin({bounds.position.x + bounds.size.x * 0.5f,
                             bounds.position.y + bounds.size.y * 0.5f});
        faceLabel.setPosition(position);
        faceLabel.setFillColor(theme.uiText);
        window.draw(faceLabel);
    }

    drawFiligree(window, position, tier, filigreeParams, theme);
}

} // namespace dof::render
