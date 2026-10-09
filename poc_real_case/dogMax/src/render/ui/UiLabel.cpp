#include "render/ui/UiLabel.hpp"
#include "render/ui/PixelSnap.hpp"
#include <SFML/Graphics/Text.hpp>
#include <cmath>

namespace dof::render::ui {

void UiLabel::draw(sf::RenderWindow& window, sf::FloatRect rect,
                   const sf::Font& font, const std::string& text) const {
    const sf::FloatRect snapped = pixelSnap(rect);

    sf::Text label(font, text, fontSize);
    label.setFillColor(color);

    const sf::FloatRect bounds = label.getLocalBounds();
    const float textW = bounds.position.x + bounds.size.x;
    const float textH = bounds.position.y + bounds.size.y;

    float x{};
    switch (align) {
        case TextAlign::Left:
            x = snapped.position.x + 2.f;
            break;
        case TextAlign::Center:
            x = std::floor(snapped.position.x + (snapped.size.x - textW) / 2.f);
            break;
        case TextAlign::Right:
            x = std::floor(snapped.position.x + snapped.size.x - 2.f - textW);
            break;
    }

    const float y = std::floor(snapped.position.y + (snapped.size.y - textH) / 2.f);

    label.setPosition({x, y});
    window.draw(label);
}

} // namespace dof::render::ui
