#pragma once

#include <SFML/Graphics/Color.hpp>
#include <SFML/Graphics/Rect.hpp>
#include <SFML/Graphics/RenderWindow.hpp>

namespace dof::render::ui {

// Full-bounds dim overlay — a single filled RGBA rect painted over `bounds`
// (typically the whole UI viewport) to dim everything behind a modal window.
// Single-sources the hand-rolled "draw a translucent black rect behind the
// modal" idiom that windows currently duplicate. The alpha channel of `color`
// controls how dark the dim reads; the caller supplies it from config.
struct UiScrim {
    sf::Color color{0, 0, 0, 160};  // translucent black by default

    void draw(sf::RenderWindow& window, sf::FloatRect bounds) const;
};

} // namespace dof::render::ui
