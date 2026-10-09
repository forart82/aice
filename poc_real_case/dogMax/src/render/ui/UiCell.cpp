#include "render/ui/UiCell.hpp"
#include "render/ui/PixelSnap.hpp"

namespace dof::render::ui {

void UiCell::draw(sf::RenderWindow& window, sf::FloatRect rect,
                  bool hasContent, bool isHovered, bool isEnabled) const {
    // A disabled cell is inert: hover never reads back, so it keeps the idle
    // border whatever the pointer does. Its contents still show.
    drawBorderedRect(window, rect,
                     hasContent ? bgOccupied : bgEmpty,
                     (isHovered && isEnabled) ? borderHover : border,
                     borderThickness, true);
}

bool UiCell::hitTest(sf::FloatRect rect, sf::Vector2f point, bool isEnabled) const {
    return isEnabled && rect.contains(point);
}

} // namespace dof::render::ui
