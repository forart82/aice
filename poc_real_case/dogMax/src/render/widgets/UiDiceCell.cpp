#include "render/widgets/UiDiceCell.hpp"

#include "entities/Dice.hpp"
#include "loaders/ShaderLoader.hpp"
#include "render/ShapeShaders.hpp"
#include "render/ui/UiHexCell.hpp"

#include <SFML/Graphics/RenderWindow.hpp>
#include <SFML/Graphics/Text.hpp>

#include <algorithm>
#include <cstdint>
#include <sstream>

namespace dof::render::widgets {

sf::Vector2f UiDiceCell::computeHexCentre(sf::FloatRect cellRect) {
    return {cellRect.position.x + cellRect.size.x * 0.5f,
            cellRect.position.y + cellRect.size.y * 0.5f};
}

float UiDiceCell::computeHexRadius(sf::FloatRect cellRect, float widthFactor,
                                    float heightFactor, float minRadius) {
    const float fromWidth  = cellRect.size.x * widthFactor;
    const float fromHeight = cellRect.size.y * heightFactor;
    // Clamp to at least minRadius px: a degenerate rect yields zero radius
    // which hexCellVertices does not guard against and emits a degenerate hexagon.
    return std::max(minRadius, std::min(fromWidth, fromHeight));
}

sf::FloatRect UiDiceCell::computeCountdownBarRect(sf::FloatRect cellRect,
                                                    float barThickness,
                                                    float barPad,
                                                    float progress) {
    const float maxLen  = cellRect.size.y - barPad * 2.0f;
    const float visible = maxLen * (1.0f - std::clamp(progress, 0.f, 1.f));
    const float x = cellRect.position.x + cellRect.size.x - barThickness - barPad;
    const float y = cellRect.position.y + barPad + (maxLen - visible);
    return {{x, y}, {barThickness, visible}};
}

bool UiDiceCell::hitTest(sf::FloatRect cellRect, sf::Vector2f point, bool isEnabled) const {
    ui::UiHexCell hex;
    hex.radius = computeHexRadius(cellRect, hexRadiusWidthFactor,
                                  hexRadiusHeightFactor, hexRadiusMin);
    return hex.hitTest(computeHexCentre(cellRect), point, isEnabled);
}

void UiDiceCell::draw(sf::RenderWindow& window, sf::FloatRect cellRect,
                      const dof::entities::Dice* dice,
                      sf::Color faceColor,
                      bool isCharged,
                      sf::Color chargedOutline,
                      const sf::Font& font,
                      const dof::loaders::ShaderLoader* shaders,
                      dof::render::ShapeShaders& shapeShaders) const {
    // Centre + radius come from the same two helpers hitTest() uses, so the
    // painted hex and the droppable hex are the same shape by construction.
    const sf::Vector2f centre = computeHexCentre(cellRect);
    ui::UiHexCell hex;
    hex.radius = computeHexRadius(cellRect, hexRadiusWidthFactor,
                                  hexRadiusHeightFactor, hexRadiusMin);

    if (!dice) {
        sf::Color outline = emptyOutline;
        outline.a = static_cast<std::uint8_t>(emptyOutline.a / 2);
        hex.outlineThickness = emptyOutlineThickness;
        hex.draw(window, centre, emptyFill, outline);
        return;
    }

    sf::Shader* dieShader = shaders
        ? const_cast<sf::Shader*>(shaders->getShader("die")) : nullptr;
    if (dieShader) {
        const float dieSize = hex.radius * 2.0f;
        shapeShaders.drawDie(window, dieShader, centre, dieSize,
                             dice->face(), dof::render::colorToGlsl(faceColor),
                             isCharged ? 1.f : 0.f);
    } else {
        const int chargedAlpha = std::min(255, fallbackFillAlpha + chargedFillAlphaBoost);
        sf::Color fill         = faceColor;
        fill.a = static_cast<std::uint8_t>(isCharged ? chargedAlpha : fallbackFillAlpha);
        const sf::Color outlineCol = isCharged ? chargedOutline : faceColor;
        hex.outlineThickness = isCharged ? chargedOutlineThickness : outlineThickness;
        hex.draw(window, centre, fill, outlineCol);
    }

    // Face value label — shows the rolled value of the current face.
    std::ostringstream faceText;
    faceText << dice->faceValue(dice->currentFace());
    sf::Text faceLabel(font, faceText.str(), faceValueFontSize);
    auto bounds = faceLabel.getLocalBounds();
    faceLabel.setOrigin({bounds.position.x + bounds.size.x * 0.5f,
                          bounds.position.y + bounds.size.y * 0.5f});
    faceLabel.setPosition(centre);
    faceLabel.setFillColor(labelColor);
    window.draw(faceLabel);

    // Per-cell countdown strip — vertical bar pinned to the right edge.
    // Length = cellHeight × (1 − progress) so it drains downward. Suppressed
    // by callers that render a static (non-counting) die — see showCountdownBar.
    if (showCountdownBar) {
        const auto barRect = computeCountdownBarRect(cellRect, countdownBarThickness,
                                                     barPad, dice->countdownable().progress());
        if (barRect.size.x > 0.f && barRect.size.y > 0.f) {
            sf::RectangleShape bar(barRect.size);
            bar.setPosition(barRect.position);
            bar.setFillColor(faceColor);
            bar.setOutlineThickness(0.f);
            window.draw(bar);
        }
    }
}

} // namespace dof::render::widgets
