#pragma once

#include <SFML/Graphics/Color.hpp>
#include <SFML/Graphics/Rect.hpp>
#include <SFML/Graphics/RenderTarget.hpp>

namespace dof::render::ui {

struct UiPanel {
    sf::Color background;
    sf::Color border;
    float     borderThickness{1.0f};
    // Screen-space chrome wants pixel-snapped borders (crisp at any window
    // size). World-space chrome (drawn under the camera view, e.g. a
    // healthbar) must NOT snap to screen pixels — snapping under a panning/
    // zooming view would jitter the rect every frame. Off = draw the raw
    // float rect, no snap.
    bool      isPixelSnapped{true};

    void draw(sf::RenderTarget& window, sf::FloatRect rect) const;
};

} // namespace dof::render::ui
