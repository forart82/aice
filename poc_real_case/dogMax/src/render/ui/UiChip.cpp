#include "render/ui/UiChip.hpp"

#include "render/ColorTheme.hpp"
#include "render/ui/UiPanel.hpp"
#include "render/ui/PixelSnap.hpp"
#include "loaders/ConfigLoader.hpp"

#include <SFML/Graphics/CircleShape.hpp>
#include <SFML/Graphics/Font.hpp>
#include <SFML/Graphics/RenderWindow.hpp>
#include <SFML/Graphics/Text.hpp>

namespace dof::render::ui {

UiChip UiChip::loadFromConfig(const dof::loaders::ConfigLoader& config) {
    UiChip chip{};
    chip.accent          = UiAccent::loadFromConfig(config);
    chip.chamferOffset   = config.getFloat("UIR_CHAMFER_OFFSET");
    chip.height          = config.getFloat("UIR_CHIP_HEIGHT");
    chip.paddingX        = config.getFloat("UIR_CHIP_PADDING_X");
    chip.paddingY        = config.getFloat("UIR_CHIP_PADDING_Y");
    chip.fontSize        = static_cast<unsigned>(config.getInt("UIR_CHIP_FONT_SIZE"));
    chip.fill            = dof::render::readRgba(config, "UIR_CHIP_FILL");
    chip.text            = dof::render::readRgbPrefixed(config, "UIR_CHIP_TEXT");
    chip.statusDotRadius = config.getFloat("UIR_STATUS_DOT_RADIUS");
    return chip;
}

sf::FloatRect UiChip::rectFor(sf::FloatRect panel, const UiChip& style, float width) {
    // Chip sits flush against the top edge, inset by the chamfer, and
    // overhangs upward by half its height so it reads as a badge anchored
    // on the panel outline.
    const float y = panel.position.y - style.height * 0.5f;
    const float x = (style.anchor == Anchor::TopLeft)
        ? panel.position.x + style.chamferOffset
        : panel.position.x + panel.size.x - style.chamferOffset - width;
    return sf::FloatRect{{x, y}, {width, style.height}};
}

void UiChip::draw(sf::RenderWindow& window, sf::FloatRect panel, const sf::Font& font,
                  const std::string& label, float width, sf::Color dotColor) const {
    const sf::FloatRect chip = rectFor(panel, *this, width);

    // Chip body — composed from UiPanel so fill + outline follow the same
    // pixel-snapped path as every other panel-family component.
    ui::UiPanel body;
    body.background      = fill;
    body.border          = accent.full();
    body.borderThickness = accent.thicknessOutline;
    body.draw(window, chip);

    const bool hasDot = dotColor.a > 0 && statusDotRadius > 0.0f;
    if (hasDot) {
        sf::CircleShape dot(statusDotRadius, 12);
        dot.setOrigin({statusDotRadius, statusDotRadius});
        dot.setPosition({chip.position.x + paddingX + statusDotRadius,
                         chip.position.y + chip.size.y * 0.5f});
        dot.setFillColor(dotColor);
        dot.setOutlineColor(accent.full());
        // Clamp to ≥1 screen pixel so the dot ring never drops at fractional scale.
        dot.setOutlineThickness(clampedThickness(window, 1.0f));
        window.draw(dot);
    }

    if (!label.empty() && fontSize > 0) {
        sf::Text textShape(font, label, fontSize);
        textShape.setFillColor(text);
        const auto bounds = textShape.getLocalBounds();
        const float labelX = hasDot
            ? chip.position.x + paddingX + statusDotRadius * 2.0f + 4.0f
            : chip.position.x + paddingX;
        textShape.setPosition({labelX,
                               chip.position.y + (chip.size.y - bounds.size.y) * 0.5f - 2.0f});
        window.draw(textShape);
    }
}

} // namespace dof::render::ui
