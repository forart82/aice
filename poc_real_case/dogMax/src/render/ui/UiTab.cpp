#include "render/ui/UiTab.hpp"
#include "render/ui/PixelSnap.hpp"
#include <SFML/Graphics/Text.hpp>
#include <cmath>

namespace dof::render::ui {

void UiTab::draw(sf::RenderWindow& window, sf::FloatRect stripRect,
                 const sf::Font& font, unsigned fontSize,
                 const std::vector<std::string>& labels,
                 int activeIndex, int hoveredIndex, bool isEnabled) const {
    if (labels.empty()) return;
    // A disabled strip is inert: no tab can be picked, so none paints hover.
    const int liveHovered = isEnabled ? hoveredIndex : -1;
    const float tabW = stripRect.size.x / static_cast<float>(labels.size());
    const auto [sx, sy] = screenScales(window);
    for (int i = 0; i < static_cast<int>(labels.size()); ++i) {
        // Snap each tab's edges here rather than letting drawBorderedRect snap a
        // rebuilt tabRect: a tab's right edge uses (i+1)*tabW, the exact same
        // expression as the next tab's left edge, so adjacent tabs snap to the
        // same screen pixel and abut with no gap. Reconstructing the right edge
        // as position.x + size.x inside the helper would differ by a float ULP
        // and could crack that abutment — so snap here and pass shouldPixelSnap
        // false (already snapped); the helper still owns the fill + 4-quad border.
        const float x = screenPixelSnap(stripRect.position.x + static_cast<float>(i) * tabW,     sx);
        const float y = screenPixelSnap(stripRect.position.y,                                    sy);
        const float w = screenPixelSnap(stripRect.position.x + static_cast<float>(i + 1) * tabW, sx) - x;
        const float h = screenPixelSnap(stripRect.position.y + stripRect.size.y,                 sy) - y;
        const bool isActive  = (i == activeIndex);
        const bool isHovered = (i == liveHovered);
        const sf::Color bg = isActive ? bgActive : (isHovered ? bgHover : bgInactive);
        drawBorderedRect(window, {{x, y}, {w, h}}, bg, border, borderThickness, false);

        sf::Text label(font, labels[i], fontSize);
        label.setFillColor(isActive ? textActive : textInactive);
        centerOriginOf(label);
        label.setPosition(pixelSnap({x + w / 2.f, y + h / 2.f}));
        window.draw(label);
    }
}

int UiTab::hitTest(sf::FloatRect stripRect, const std::vector<std::string>& labels,
                   sf::Vector2f point, bool isEnabled) const {
    if (!isEnabled) return -1;
    if (labels.empty()) return -1;
    if (point.y < stripRect.position.y || point.y >= stripRect.position.y + stripRect.size.y) return -1;
    if (point.x < stripRect.position.x || point.x >= stripRect.position.x + stripRect.size.x) return -1;
    const float tabW = stripRect.size.x / static_cast<float>(labels.size());
    const int idx = static_cast<int>((point.x - stripRect.position.x) / tabW);
    if (idx < 0 || idx >= static_cast<int>(labels.size())) return -1;
    return idx;
}

} // namespace dof::render::ui
