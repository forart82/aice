#pragma once

#include <SFML/Graphics/Color.hpp>
#include <SFML/Graphics/Font.hpp>
#include <SFML/Graphics/Rect.hpp>
#include <SFML/Graphics/RenderWindow.hpp>
#include <string>

namespace dof::render::ui {

// Single-line text search / filter field.
// Draws: background + focused/unfocused border, placeholder or typed query,
// and a blinking-caret proxy (static 1.5px rect) when focused. Text renders at
// exactly the `fontSize` the caller hands draw() — same contract as
// ui::UiTextInput. A disabled field cannot take focus, so it paints the
// unfocused border and no caret whatever `isFocused` says.
struct UiSearchField {
    sf::Color bgColor;
    sf::Color borderNormal;
    sf::Color borderFocused;
    sf::Color textColor;
    sf::Color placeholderColor;
    sf::Color caretColor;
    float     borderThickness{1.0f};
    float     textPadding{6.0f};

    void draw(sf::RenderWindow& window, sf::FloatRect rect,
              const sf::Font& font, unsigned fontSize,
              const std::string& query, bool isFocused,
              bool isEnabled = true) const;
};

} // namespace dof::render::ui
