#include "render/ui/UiBarChart.hpp"

#include "render/ui/PixelSnap.hpp"

#include <SFML/Graphics/RenderWindow.hpp>

#include <algorithm>

namespace dof::render::ui {

void UiBarChart::draw(sf::RenderWindow& window, sf::FloatRect rect,
                      const std::vector<float>& values) const {
    draw(window, rect, values, {});
}

void UiBarChart::draw(sf::RenderWindow& window, sf::FloatRect rect,
                      const std::vector<float>& values,
                      const std::vector<sf::Color>& perBarFill) const {
    const std::size_t n = values.size();
    if (n == 0) return;
    const float totalGap = gap * static_cast<float>(n - 1);
    const float barW = (rect.size.x - totalGap) / static_cast<float>(n);
    if (barW <= 0.0f) return;

    for (std::size_t i = 0; i < n; ++i) {
        const float x = rect.position.x + static_cast<float>(i) * (barW + gap);
        const float ratio = std::clamp(values[i], 0.0f, 1.0f);
        const float fillH = rect.size.y * ratio;

        // Track (full-height background of this bar column).
        ui::drawThinQuad(window, {{x, rect.position.y}, {barW, rect.size.y}}, track);

        // Filled portion, grown up from the bottom edge.
        if (fillH > 0.0f) {
            ui::drawThinQuad(
                window,
                {{x, rect.position.y + rect.size.y - fillH}, {barW, fillH}},
                i < perBarFill.size() ? perBarFill[i] : fill);
        }
    }
}

} // namespace dof::render::ui
