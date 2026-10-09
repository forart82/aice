#include "render/ui/UiSegmentedBar.hpp"

#include "loaders/ConfigLoader.hpp"
#include "render/ui/PixelSnap.hpp"
#include "render/ui/QuadBatch.hpp"

#include <SFML/Graphics/RenderTarget.hpp>

#include <algorithm>
#include <cmath>

namespace dof::render::ui {

UiSegmentedBar UiSegmentedBar::loadFromConfig(const dof::loaders::ConfigLoader& config) {
    UiSegmentedBar bar{};
    bar.segmentCount = config.getInt("UIR_SEGMENT_COUNT");
    bar.segmentGap   = config.getFloat("UIR_SEGMENT_GAP");
    return bar;
}

int UiSegmentedBar::litSegmentCount(float ratio, int segmentCount) {
    if (segmentCount <= 0) return 0;
    if (ratio <= 0.0f) return 0;
    if (ratio >= 1.0f) return segmentCount;
    // ceil so any non-zero ratio lights at least one cell — the
    // segmented bar should never read as "empty" when the entity
    // still has a sliver of HP / XP left.
    return std::min(segmentCount,
                    static_cast<int>(std::ceil(ratio * static_cast<float>(segmentCount))));
}

void UiSegmentedBar::draw(sf::RenderTarget& window, sf::FloatRect rect, float ratio,
                          sf::Color fillLit, sf::Color fillEmpty) const {
    if (segmentCount <= 0) return;
    const int n = segmentCount;
    const float gap = segmentGap;
    const float totalGap = gap * static_cast<float>(n - 1);
    const float cellW = (rect.size.x - totalGap) / static_cast<float>(n);
    if (cellW <= 0.0f) return;
    const int lit = litSegmentCount(ratio, n);
    for (int i = 0; i < n; ++i) {
        ui::drawThinQuad(
            window,
            {{rect.position.x + static_cast<float>(i) * (cellW + gap), rect.position.y},
             {cellW, rect.size.y}},
            i < lit ? fillLit : fillEmpty);
    }
}

void UiSegmentedBar::appendTo(sf::RenderTarget& window,
                              QuadBatch& batch,
                              sf::FloatRect rect,
                              float ratio,
                              sf::Color fillLit,
                              sf::Color fillEmpty) const {
    if (segmentCount <= 0) return;
    const int n = segmentCount;
    const float gap = segmentGap;
    const float totalGap = gap * static_cast<float>(n - 1);
    const float cellW = (rect.size.x - totalGap) / static_cast<float>(n);
    if (cellW <= 0.0f) return;
    const int lit = litSegmentCount(ratio, n);
    for (int i = 0; i < n; ++i) {
        const sf::FloatRect cell{
            {rect.position.x + static_cast<float>(i) * (cellW + gap), rect.position.y},
            {cellW, rect.size.y}};
        appendThinQuad(window, batch, cell, i < lit ? fillLit : fillEmpty);
    }
}

} // namespace dof::render::ui
