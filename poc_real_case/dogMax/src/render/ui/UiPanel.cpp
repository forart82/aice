#include "render/ui/UiPanel.hpp"
#include "render/ui/PixelSnap.hpp"

namespace dof::render::ui {

void UiPanel::draw(sf::RenderTarget& window, sf::FloatRect rect) const {
    // A panel is a filled, bordered rect. isPixelSnapped is false for
    // world-space chrome (drawn under a panning/zooming camera, e.g. a
    // healthbar) so the border isn't screen-pixel-snapped and won't jitter;
    // true for screen-space chrome so the border stays crisp at any window
    // size. drawBorderedRect owns the snap + fill + 4-quad border.
    drawBorderedRect(window, rect, background, border, borderThickness, isPixelSnapped);
}

} // namespace dof::render::ui
