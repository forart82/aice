#pragma once

#include <SFML/Graphics/Color.hpp>
#include <SFML/Graphics/Font.hpp>
#include <SFML/Graphics/Rect.hpp>
#include <SFML/Graphics/RenderWindow.hpp>
#include <string>
#include <vector>

namespace dof::render::ui {

struct UiListRow {
    std::string text;
    sf::Color   tint{255, 255, 255, 255};
    bool        isHighlighted{false};
};

// Row list. A disabled list paints no selection highlight — a highlight the
// caller cannot move is a lie about what is interactive — but still shows every
// row's text and tint.
struct UiList {
    sf::Color bgRow;
    sf::Color bgRowAlt;
    sf::Color bgHighlight;
    sf::Color textColor;
    float     rowHeight{18.0f};

    void draw(sf::RenderWindow& window, sf::FloatRect rect,
              const sf::Font& font, unsigned fontSize,
              const std::vector<UiListRow>& rows,
              bool isEnabled = true) const;
};

} // namespace dof::render::ui
