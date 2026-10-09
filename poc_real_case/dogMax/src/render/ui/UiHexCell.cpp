#include "render/ui/UiHexCell.hpp"

#include "render/ui/PixelSnap.hpp"
#include "loaders/ConfigLoader.hpp"

#include <SFML/Graphics/ConvexShape.hpp>
#include <SFML/Graphics/RenderWindow.hpp>

#include <cmath>

namespace dof::render::ui {

UiHexCell UiHexCell::loadFromConfig(const dof::loaders::ConfigLoader& config) {
    UiHexCell cell{};
    cell.radius           = config.getFloat("UIR_HEX_CELL_RADIUS");
    cell.outlineThickness = config.getFloat("UIR_HEX_CELL_OUTLINE_THICKNESS");
    return cell;
}

std::array<sf::Vector2f, 6> UiHexCell::hexCellVertices(sf::Vector2f centre, float radius) {
    // Pointy-top hexagon: vertex 0 at top (-90 deg), each subsequent
    // vertex rotated 60 deg clockwise. Caller paints in order so the
    // ConvexShape draws as a convex polygon.
    std::array<sf::Vector2f, 6> verts{};
    for (int i = 0; i < 6; ++i) {
        const float angle = -1.5707963f + static_cast<float>(i) * (3.14159265358979f / 3.0f);
        verts[static_cast<std::size_t>(i)] = sf::Vector2f{
            centre.x + radius * std::cos(angle),
            centre.y + radius * std::sin(angle)};
    }
    return verts;
}

bool UiHexCell::hitTest(sf::Vector2f centre, sf::Vector2f point, bool isEnabled) const {
    if (!isEnabled || radius <= 0.0f) return false;

    // Convex-polygon test over the painted vertices: the point is inside when it
    // lies on the same side of all six edges. hexCellVertices walks the corners
    // in a single consistent winding, so every interior cross product is >= 0.
    const auto verts = hexCellVertices(centre, radius);
    for (std::size_t i = 0; i < verts.size(); ++i) {
        const sf::Vector2f a = verts[i];
        const sf::Vector2f b = verts[(i + 1) % verts.size()];
        const float cross = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
        if (cross < 0.0f) return false;
    }
    return true;
}

void UiHexCell::draw(sf::RenderWindow& window, sf::Vector2f centre,
                     sf::Color fill, sf::Color outline) const {
    const auto verts = hexCellVertices(centre, radius);
    sf::ConvexShape hex;
    hex.setPointCount(verts.size());
    for (std::size_t i = 0; i < verts.size(); ++i) hex.setPoint(i, verts[i]);
    hex.setFillColor(fill);
    hex.setOutlineColor(outline);
    // Clamp to ≥1 screen pixel: SFML's convex-outline rasteriser drops
    // sub-pixel outline edges at fractional window/letterbox scale.
    hex.setOutlineThickness(clampedThickness(window, outlineThickness));
    window.draw(hex);
}

} // namespace dof::render::ui
