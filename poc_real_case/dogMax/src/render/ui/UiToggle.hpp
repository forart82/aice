#pragma once

#include <SFML/Graphics/Color.hpp>
#include <SFML/Graphics/Rect.hpp>
#include <SFML/Graphics/RenderWindow.hpp>
#include <SFML/System/Vector2.hpp>

namespace dof::render::ui {

// On/off toggle (checkbox). Draws a square box on the left edge of `rect`,
// vertically centred, plus an inset "check" fill when on; the box body reuses
// ui::UiPanel so its fill + outline follow the same pixel-snapped path as every
// other panel-family widget. The label area to the right of the box is left for
// the CALLER to draw (see labelRect) — the widget carries no font. The caller
// owns the bool; draw() only reflects it — and owns enablement, which it passes
// to draw() AND hitTest() so a dimmed toggle can never stay clickable. A
// disabled toggle ignores `isHover`.
struct UiToggle {
    sf::Color boxOff;      // box fill when off
    sf::Color boxOn;       // box fill when on
    sf::Color boxHover;    // box fill when off and hovered
    sf::Color border;      // box outline
    sf::Color check;       // inset check fill drawn when on
    float     borderThickness{1.f};
    float     boxSize{16.f};    // square box edge length
    float     labelGap{6.f};    // gap between box and label area
    float     checkInset{4.f};  // inset of the check fill inside the box

    void draw(sf::RenderWindow& window, sf::FloatRect rect,
              bool isOn, bool isHover, bool isEnabled = true) const;

    // Pure geometry helpers.
    sf::FloatRect boxRect(sf::FloatRect rect) const;    // the square box
    sf::FloatRect labelRect(sf::FloatRect rect) const;  // caller's text area

    // Point-in-control test — the whole rect toggles (box + label). A const
    // member (not a static) so it matches every other ui:: hit-test; `isEnabled`
    // is deliberately NOT defaulted so the caller must pass draw()'s own flag.
    bool hitTest(sf::FloatRect rect, sf::Vector2f point, bool isEnabled) const;
};

} // namespace dof::render::ui
