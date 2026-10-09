#pragma once

#include <SFML/Graphics/Color.hpp>
#include <SFML/Graphics/Font.hpp>
#include <SFML/Graphics/Rect.hpp>
#include <SFML/Graphics/RenderWindow.hpp>
#include <cstdint>
#include <string>

namespace dof::render::ui {

enum class TextAlign : std::uint8_t { Left, Center, Right };

struct UiLabel {
    sf::Color color;
    unsigned  fontSize{11};
    TextAlign align{TextAlign::Left};

    void draw(sf::RenderWindow& window, sf::FloatRect rect,
              const sf::Font& font, const std::string& text) const;
};

} // namespace dof::render::ui
