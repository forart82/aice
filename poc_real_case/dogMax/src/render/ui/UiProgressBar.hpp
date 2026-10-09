#pragma once

#include <SFML/Graphics/Color.hpp>
#include <SFML/Graphics/Rect.hpp>
#include <SFML/Graphics/RenderWindow.hpp>

namespace dof::render::ui {

struct UiProgressBar {
    sf::Color track;
    sf::Color fill;

    void drawHorizontal(sf::RenderWindow& window, sf::FloatRect rect, float progress) const;
    void drawVertical(sf::RenderWindow& window, sf::FloatRect rect, float progress) const;

    // Testable pure helpers — geometry only, no rendering.
    static sf::FloatRect computeHorizontalFill(sf::FloatRect rect, float progress);
    // Fills from the top edge downward (progress=1 → full height).
    static sf::FloatRect computeVerticalFill(sf::FloatRect rect, float progress);
};

} // namespace dof::render::ui
