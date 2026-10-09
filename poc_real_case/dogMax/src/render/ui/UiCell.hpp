#pragma once

#include <SFML/Graphics/Color.hpp>
#include <SFML/Graphics/Rect.hpp>
#include <SFML/Graphics/RenderWindow.hpp>
#include <SFML/System/Vector2.hpp>

namespace dof::render::ui {

// Grid slot — the inventory / weapon-grid cell. A disabled cell ignores
// `isHovered` (no hover border) and hitTest() reports no hit, so a cell painted
// as inert can never accept a click or a drop.
struct UiCell {
    sf::Color bgEmpty;
    sf::Color bgOccupied;
    sf::Color border;
    sf::Color borderHover;
    float     borderThickness{1.0f};

    void draw(sf::RenderWindow& window, sf::FloatRect rect,
              bool hasContent, bool isHovered, bool isEnabled = true) const;

    // Point-in-cell test — the whole rect is the target. `isEnabled` is
    // deliberately NOT defaulted so it must come from the same source draw()
    // got it from.
    bool hitTest(sf::FloatRect rect, sf::Vector2f point, bool isEnabled) const;
};

} // namespace dof::render::ui
