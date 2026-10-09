#include "render/ui/UiScrim.hpp"

#include <SFML/Graphics/RectangleShape.hpp>

namespace dof::render::ui {

void UiScrim::draw(sf::RenderWindow& window, sf::FloatRect bounds) const {
    if (bounds.size.x <= 0.f || bounds.size.y <= 0.f) return;

    sf::RectangleShape dim(bounds.size);
    dim.setPosition(bounds.position);
    dim.setFillColor(color);
    dim.setOutlineThickness(0.f);
    window.draw(dim);
}

} // namespace dof::render::ui
