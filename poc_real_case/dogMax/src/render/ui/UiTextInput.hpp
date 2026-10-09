#pragma once

#include <SFML/Graphics/Color.hpp>
#include <SFML/Graphics/Font.hpp>
#include <SFML/Graphics/Rect.hpp>
#include <SFML/Graphics/RenderWindow.hpp>
#include <SFML/Window/Keyboard.hpp>

#include <cstdint>
#include <string>

namespace dof::render::ui {

// Single-line editable text box — background, focus-aware border, the typed
// text (or a placeholder when empty), and a caret at `caretIndex` when focused.
// The box body reuses ui::UiPanel for the shared pixel-snapped fill + outline.
// The widget is stateless: the CALLER owns the string, the caret index and the
// focus flag. caretIndexAtX() maps a click x to a caret slot; applyKey() is an
// optional pure helper that mutates a caller's string + caret for one key/char
// event. Text renders at exactly the `fontSize` handed to draw() — the same
// contract as ui::UiSearchField. A disabled input cannot take focus, so it
// paints the unfocused border and no caret whatever `isFocused` says.
struct UiTextInput {
    sf::Color bgColor;
    sf::Color borderNormal;
    sf::Color borderFocused;
    sf::Color textColor;
    sf::Color placeholderColor;
    sf::Color caretColor;
    float     borderThickness{1.f};
    float     textPadding{6.f};
    float     caretWidth{1.5f};

    void draw(sf::RenderWindow& window, sf::FloatRect rect,
              const sf::Font& font, unsigned fontSize,
              const std::string& text, bool isFocused, int caretIndex,
              const std::string& placeholder = std::string(),
              bool isEnabled = true) const;

    // Caret slot in [0, text.size()] whose glyph edge is nearest to `x`.
    int caretIndexAtX(sf::FloatRect rect, const sf::Font& font, unsigned fontSize,
                      const std::string& text, float x) const;

    // Optional stateless edit helper: apply one key/char event to the caller's
    // buffer + caret. `unicode` is the codepoint from an SFML TextEntered event
    // (0 when only a key is supplied); `key` handles Backspace/Delete/Left/
    // Right/Home/End. ASCII-printable codepoints (0x20..0x7E) are inserted at
    // the caret; wider Unicode is left to callers that manage their own buffer.
    // Returns true when the text buffer changed (caret-only moves return false
    // but still update `caret`).
    static bool applyKey(std::string& text, int& caret,
                         std::uint32_t unicode, sf::Keyboard::Key key);
};

} // namespace dof::render::ui
