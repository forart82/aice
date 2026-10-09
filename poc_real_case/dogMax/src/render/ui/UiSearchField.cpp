#include "render/ui/UiSearchField.hpp"

#include "render/ui/PixelSnap.hpp"

#include <SFML/Graphics/Text.hpp>

namespace dof::render::ui {

void UiSearchField::draw(sf::RenderWindow& window, sf::FloatRect rect,
                          const sf::Font& font, unsigned fontSize,
                          const std::string& query, bool isFocused,
                          bool isEnabled) const {
    if (rect.size.y <= 0.0f) return;

    // A disabled field cannot take focus, so the focus border and the caret are
    // both suppressed whatever the caller's focus flag says.
    const bool showFocus = isFocused && isEnabled;

    // Border composed as pixel-snapped quads (like every other bordered
    // component) — SFML's setOutlineThickness path drops sub-pixel edges at
    // fractional window/letterbox scale.
    ui::drawBorderedRect(window, rect, bgColor,
                         showFocus ? borderFocused : borderNormal,
                         borderThickness, true);

    const bool isEmpty = query.empty();
    const std::string display = isEmpty ? "Search..." : query;
    const sf::Color   color   = isEmpty ? placeholderColor : textColor;

    // Render at exactly the size the caller asked for. This used to silently
    // subtract 2, so a field and a ui::UiTextInput handed the same fontSize
    // drew at different sizes despite documenting one shared contract.
    sf::Text label(font, display, fontSize);
    label.setFillColor(color);

    const sf::FloatRect bounds = label.getLocalBounds();
    const float midY = rect.position.y + rect.size.y * 0.5f;
    label.setPosition({rect.position.x + textPadding,
                       midY - bounds.size.y * 0.5f - bounds.position.y});
    window.draw(label);

    if (showFocus) {
        const float caretX = rect.position.x + textPadding + bounds.size.x + 2.0f;
        ui::drawThinQuad(window,
                         {{caretX, rect.position.y + 3.0f}, {1.5f, rect.size.y - 6.0f}},
                         caretColor);
    }
}

} // namespace dof::render::ui
