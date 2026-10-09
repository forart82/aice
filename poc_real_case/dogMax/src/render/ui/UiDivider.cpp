#include "render/ui/UiDivider.hpp"

#include "render/ui/PixelSnap.hpp"

namespace dof::render::ui {

void UiDivider::drawVertical(sf::RenderWindow& window,
                              float x, float y, float height) const {
    ui::drawThinQuad(window, {{x, y}, {thickness, height}}, color);
}

void UiDivider::drawHorizontal(sf::RenderWindow& window,
                                float x, float y, float width) const {
    ui::drawThinQuad(window, {{x, y}, {width, thickness}}, color);
}

} // namespace dof::render::ui
