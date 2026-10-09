#include "render/ui/UiTextInput.hpp"

#include "render/ui/PixelSnap.hpp"
#include "render/ui/UiPanel.hpp"

#include <SFML/Graphics/Text.hpp>

#include <algorithm>
#include <cmath>

namespace dof::render::ui {

void UiTextInput::draw(sf::RenderWindow& window, sf::FloatRect rect,
                       const sf::Font& font, unsigned fontSize,
                       const std::string& text, bool isFocused, int caretIndex,
                       const std::string& placeholder, bool isEnabled) const {
    if (rect.size.y <= 0.f) return;

    // A disabled input cannot take focus, so the focus border and the caret are
    // both suppressed whatever the caller's focus flag says.
    const bool showFocus = isFocused && isEnabled;

    // Box body composed from UiPanel — focus swaps the border colour.
    ui::UiPanel box;
    box.background      = bgColor;
    box.border          = showFocus ? borderFocused : borderNormal;
    box.borderThickness = borderThickness;
    box.draw(window, rect);

    const bool showPlaceholder = text.empty() && !placeholder.empty();
    const std::string& display = showPlaceholder ? placeholder : text;

    sf::Text glyphs(font, display, fontSize);
    glyphs.setFillColor(showPlaceholder ? placeholderColor : textColor);
    const sf::FloatRect bounds = glyphs.getLocalBounds();
    const float posX = rect.position.x + textPadding;
    const float midY = rect.position.y + rect.size.y * 0.5f;
    const float posY = midY - bounds.size.y * 0.5f - bounds.position.y;
    glyphs.setPosition({posX, posY});
    window.draw(glyphs);

    if (showFocus) {
        const int caret = std::clamp(caretIndex, 0, static_cast<int>(text.size()));
        // Placeholder never moves the caret: measure against the real text,
        // and when the buffer is empty pin the caret to the text start.
        float caretX = posX;
        if (!text.empty()) {
            caretX = glyphs.findCharacterPos(static_cast<std::size_t>(caret)).x;
        }
        const float lineH = font.getLineSpacing(fontSize);
        ui::drawThinQuad(window, {{caretX, midY - lineH * 0.5f}, {caretWidth, lineH}},
                         caretColor);
    }
}

int UiTextInput::caretIndexAtX(sf::FloatRect rect, const sf::Font& font, unsigned fontSize,
                               const std::string& text, float x) const {
    const int len = static_cast<int>(text.size());
    if (len == 0) return 0;

    sf::Text glyphs(font, text, fontSize);
    glyphs.setPosition({rect.position.x + textPadding, rect.position.y});

    int   best     = 0;
    float bestDist = std::abs(glyphs.findCharacterPos(0).x - x);
    for (int i = 1; i <= len; ++i) {
        const float slotX = glyphs.findCharacterPos(static_cast<std::size_t>(i)).x;
        const float dist  = std::abs(slotX - x);
        if (dist < bestDist) {
            bestDist = dist;
            best     = i;
        }
    }
    return best;
}

bool UiTextInput::applyKey(std::string& text, int& caret,
                           std::uint32_t unicode, sf::Keyboard::Key key) {
    const int len = static_cast<int>(text.size());
    caret = std::clamp(caret, 0, len);

    using K = sf::Keyboard::Key;
    switch (key) {
        case K::Backspace:
            if (caret > 0) {
                text.erase(static_cast<std::size_t>(caret - 1), 1);
                --caret;
                return true;
            }
            return false;
        case K::Delete:
            if (caret < len) {
                text.erase(static_cast<std::size_t>(caret), 1);
                return true;
            }
            return false;
        case K::Left:  if (caret > 0)   { --caret; } return false;
        case K::Right: if (caret < len) { ++caret; } return false;
        case K::Home:  caret = 0;   return false;
        case K::End:   caret = len; return false;
        default: break;
    }

    // Printable ASCII → insert at the caret. Control codes (Backspace 0x08,
    // Tab 0x09, Enter 0x0D, Delete 0x7F) and wider Unicode fall through so the
    // caret index stays a 1:1 char index that findCharacterPos can address.
    if (unicode >= 0x20 && unicode < 0x7F) {
        text.insert(static_cast<std::size_t>(caret), 1, static_cast<char>(unicode));
        ++caret;
        return true;
    }
    return false;
}

} // namespace dof::render::ui
