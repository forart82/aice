#pragma once

#include <SFML/Graphics/Color.hpp>
#include <SFML/System/Vector2.hpp>

#include <array>

namespace dof::loaders { class ConfigLoader; }
namespace sf { class RenderWindow; }

namespace dof::render::ui {

// Pointy-top hexagon cell — the hex chip used by dice slots and any other
// hex-tiled UI. Plain style-holder: the caller sets radius + outline
// thickness (often per-cell) and supplies fill/outline colours at draw
// time. Ported from the former free functions drawHexCell/hexCellVertices.
struct UiHexCell {
    float radius{0.0f};
    float outlineThickness{0.0f};

    // Load the canonical radius + outline thickness from config
    // (UIR_HEX_CELL_RADIUS / UIR_HEX_CELL_OUTLINE_THICKNESS).
    static UiHexCell loadFromConfig(const dof::loaders::ConfigLoader& config);

    // Pure geometry helper — the six pointy-top vertices around `centre`.
    // Testable without a render context; kept static so callers can
    // lay out without drawing.
    static std::array<sf::Vector2f, 6> hexCellVertices(sf::Vector2f centre, float radius);

    // Draw the hexagon at `centre` with this cell's radius + outline
    // thickness, using the caller-supplied fill and outline colours.
    void draw(sf::RenderWindow& window, sf::Vector2f centre,
              sf::Color fill, sf::Color outline) const;

    // Real point-in-hexagon test against the SAME six vertices draw() paints,
    // so the target can never disagree with the painted shape (approximating a
    // hex with its bounding rect accepts the four corners the hex does not
    // cover). `isEnabled` is deliberately NOT defaulted so a dimmed cell cannot
    // stay droppable.
    bool hitTest(sf::Vector2f centre, sf::Vector2f point, bool isEnabled) const;
};

} // namespace dof::render::ui
