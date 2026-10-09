#pragma once

#include <SFML/Graphics/Color.hpp>
#include <SFML/Graphics/RenderWindow.hpp>

namespace dof::render::ui {

struct UiDivider {
    sf::Color color;
    float     thickness{1.0f};

    void drawVertical(sf::RenderWindow& window, float x, float y, float height) const;
    void drawHorizontal(sf::RenderWindow& window, float x, float y, float width) const;
};

} // namespace dof::render::ui
