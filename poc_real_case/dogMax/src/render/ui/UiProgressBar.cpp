#include "render/ui/UiProgressBar.hpp"

#include "render/ui/PixelSnap.hpp"

#include <algorithm>

namespace dof::render::ui {

sf::FloatRect UiProgressBar::computeHorizontalFill(sf::FloatRect rect, float progress) {
    const float p = std::clamp(progress, 0.f, 1.f);
    return {{rect.position.x, rect.position.y}, {rect.size.x * p, rect.size.y}};
}

sf::FloatRect UiProgressBar::computeVerticalFill(sf::FloatRect rect, float progress) {
    const float p = std::clamp(progress, 0.f, 1.f);
    return {{rect.position.x, rect.position.y}, {rect.size.x, rect.size.y * p}};
}

void UiProgressBar::drawHorizontal(sf::RenderWindow& window,
                                   sf::FloatRect rect, float progress) const {
    ui::drawThinQuad(window, rect, track);

    const auto fillRect = computeHorizontalFill(rect, progress);
    if (fillRect.size.x > 0.f) {
        ui::drawThinQuad(window, fillRect, fill);
    }
}

void UiProgressBar::drawVertical(sf::RenderWindow& window,
                                  sf::FloatRect rect, float progress) const {
    ui::drawThinQuad(window, rect, track);

    const auto fillRect = computeVerticalFill(rect, progress);
    if (fillRect.size.y > 0.f) {
        ui::drawThinQuad(window, fillRect, fill);
    }
}

} // namespace dof::render::ui
