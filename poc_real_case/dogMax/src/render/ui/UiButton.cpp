#include "render/ui/UiButton.hpp"
#include "render/ui/PixelSnap.hpp"
#include <SFML/Graphics/Text.hpp>

namespace dof::render::ui {

void UiButton::draw(sf::RenderWindow& window, sf::FloatRect rect,
                    const sf::Font& font, const std::string& label,
                    unsigned fontSize, bool isHovered, bool isEnabled) const {
    // A disabled button is inert: hover never reads back, so it paints the idle
    // fill, the idle text colour and the dim halo whatever the pointer does.
    const bool      showHover = isHovered && isEnabled;
    const sf::Color fill = showHover ? bgHover : bgNormal;
    const float     alpha = showHover ? glowAlphaHover : glowAlpha;
    const sf::FloatRect box = (glowSpread > 0.f && alpha > 0.f)
        ? drawGlowFrame(window, rect, fill, border, borderThickness,
                        glowLayers, glowSpread, alpha)
        : drawBorderedRect(window, rect, fill, border, borderThickness, true);

    sf::Text text(font, label, fontSize);
    text.setFillColor(showHover ? textHover : textNormal);

    centerOriginOf(text);
    text.setPosition({box.position.x + box.size.x / 2.f,
                      box.position.y + box.size.y / 2.f});
    window.draw(text);
}

bool UiButton::hitTest(sf::FloatRect rect, sf::Vector2f point, bool isEnabled) const {
    return isEnabled && rect.contains(point);
}

} // namespace dof::render::ui
