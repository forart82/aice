#pragma once

// Internal helpers shared between EnemyDesignEditor.cpp and
// EnemyDesignEditor_Layers.cpp. NOT part of the public editor API — this
// header only exists so the editor translation units share one palette + one
// set of small draw helpers instead of duplicating them.

#include "render/ui/UiButton.hpp"
#include "render/ui/UiLabel.hpp"

#include <SFML/Graphics/Color.hpp>
#include <SFML/Graphics/Font.hpp>
#include <SFML/Graphics/Rect.hpp>
#include <SFML/Graphics/RenderWindow.hpp>
#include <SFML/System/Vector2.hpp>

#include <cmath>
#include <cstdio>
#include <string>

namespace dof::loaders { class ConfigLoader; }

namespace dof::render::editor {

// Runtime editor chrome palette. The former hard-coded neon-purple constexpr
// palette was a parallel accent that violated both the single-dark-blue-accent
// chrome goal and the no-hard-coded-config rule. Every colour here now derives
// from the canonical config tokens (UiAccent + THEME_PANEL_BG + THEME_UI_TEXT),
// loaded once in the editor ctor via loadEditorPalette and threaded through the
// draw helpers below.
struct EditorPalette {
    sf::Color panelFill;
    sf::Color panelOutline;
    sf::Color accent;
    sf::Color buttonBg;
    sf::Color buttonHover;
    sf::Color text;
    sf::Color selected;
};

// Build the editor palette from the canonical UI tokens. Defined in
// EnemyDesignEditor.cpp so this header stays include-light.
EditorPalette loadEditorPalette(const dof::loaders::ConfigLoader& config);

inline constexpr float kRowH = 30.f;
inline constexpr float kListItemH = 26.f;

inline bool contains(sf::FloatRect r, sf::Vector2f p) {
    return p.x >= r.position.x && p.x <= r.position.x + r.size.x &&
           p.y >= r.position.y && p.y <= r.position.y + r.size.y;
}

inline void drawButton(sf::RenderWindow& window, const sf::Font& font,
                       const EditorPalette& palette, sf::FloatRect r,
                       const std::string& label, bool hovered) {
    ui::UiButton{palette.buttonBg, palette.buttonHover, palette.panelOutline,
                 palette.text, sf::Color::White}
        .draw(window, r, font, label, 14u, hovered);
}

inline void drawLabel(sf::RenderWindow& window, const sf::Font& font,
                      sf::FloatRect r, const std::string& text,
                      ui::TextAlign align, unsigned size, sf::Color color) {
    ui::UiLabel{color, size, align}.draw(window, r, font, text);
}

inline std::string formatFloat(float v) {
    float rounded = std::round(v * 10.f) / 10.f;
    char buf[32];
    std::snprintf(buf, sizeof(buf), "%.1f", rounded);
    return buf;
}

} // namespace dof::render::editor
