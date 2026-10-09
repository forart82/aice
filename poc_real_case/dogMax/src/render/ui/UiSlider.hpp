#pragma once

#include <SFML/Graphics/Color.hpp>
#include <SFML/Graphics/Rect.hpp>
#include <SFML/Graphics/RenderWindow.hpp>
#include <SFML/System/Vector2.hpp>

namespace dof::render::ui {

// Horizontal slider — a thin centred track with a filled portion up to the
// knob, plus a draggable knob for a value in [0,1]. The knob body reuses
// ui::UiPanel for a crisp pixel-snapped outline. The CALLER owns the value and
// the drag flag: valueAtX maps a pointer x back to [0,1] and knobRect gives the
// knob's rect for hit-testing. The knob centre travels the track inset by half
// a knob width at each end, so value 0 and 1 sit fully inside `rect`.
struct UiSlider {
    sf::Color track;         // full track background
    sf::Color fill;          // filled portion left of the knob
    sf::Color knob;          // knob fill when idle
    sf::Color knobDragging;  // knob fill while dragged
    sf::Color border;        // knob outline
    float     trackThickness{4.f};   // height of the centred track line
    float     knobWidth{10.f};
    float     knobHeight{16.f};
    float     borderThickness{1.f};

    void draw(sf::RenderWindow& window, sf::FloatRect rect,
              float value, bool isDragging, bool isEnabled = true) const;

    // Pure helpers — const members so they read knobWidth/knobHeight/track.
    float         valueAtX(sf::FloatRect rect, float x) const;      // -> [0,1]
    sf::FloatRect knobRect(sf::FloatRect rect, float value) const;
    sf::FloatRect trackRect(sf::FloatRect rect) const;             // thin centred bar

    // A slider has TWO targets, and they mean different interactions: grabbing
    // the knob starts a drag, clicking the track jumps the value. They are
    // deliberately disjoint (the knob wins where they overlap) and each matches
    // exactly what draw() paints — never the fatter `rect` band, which is blank.
    // A caller wanting a taller click lane hit-tests its own row rect and then
    // asks hitTestKnob whether that click was a grab. `isEnabled` is not
    // defaulted so it must come from the same source draw() got it from.
    bool hitTestKnob(sf::FloatRect rect, float value, sf::Vector2f point,
                     bool isEnabled) const;
    bool hitTestTrack(sf::FloatRect rect, float value, sf::Vector2f point,
                      bool isEnabled) const;
};

} // namespace dof::render::ui
