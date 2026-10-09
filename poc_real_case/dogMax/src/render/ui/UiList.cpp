#include "render/ui/UiList.hpp"
#include "render/ui/PixelSnap.hpp"
#include <SFML/Graphics/RectangleShape.hpp>
#include <SFML/Graphics/Text.hpp>
#include <cmath>

namespace dof::render::ui {

void UiList::draw(sf::RenderWindow& window, sf::FloatRect rect,
                  const sf::Font& font, unsigned fontSize,
                  const std::vector<UiListRow>& rows, bool isEnabled) const {
    const sf::FloatRect snapped = pixelSnap(rect);
    const float snappedRowH = std::floor(rowHeight);
    if (snappedRowH < 1.0f) return;

    const int maxRows = static_cast<int>(snapped.size.y / snappedRowH);

    // Snap row seams to integer SCREEN pixels (not design-space floor) so
    // adjacent row backgrounds don't leave a half-pixel gap at fractional
    // letterbox scales.
    const auto [screenScaleX, screenScaleY] = screenScales(window);

    for (int i = 0; i < maxRows && i < static_cast<int>(rows.size()); ++i) {
        const UiListRow& row = rows[static_cast<std::size_t>(i)];

        const float rowTop = snapped.position.y + static_cast<float>(i) * snappedRowH;
        const float rx = screenPixelSnap(snapped.position.x, screenScaleX);
        const float ry = screenPixelSnap(rowTop, screenScaleY);
        const float rw = screenPixelSnap(snapped.position.x + snapped.size.x, screenScaleX) - rx;
        const float rh = screenPixelSnap(rowTop + snappedRowH, screenScaleY) - ry;
        const sf::FloatRect rowRect{{rx, ry}, {rw, rh}};

        sf::Color rowBg;
        // A disabled list cannot change its selection, so it paints none.
        if (row.isHighlighted && isEnabled) {
            rowBg = bgHighlight;
        } else if (i % 2 == 0) {
            rowBg = bgRowAlt;
        } else {
            rowBg = bgRow;
        }

        sf::RectangleShape bg;
        bg.setPosition(rowRect.position);
        bg.setSize(rowRect.size);
        bg.setFillColor(rowBg);
        bg.setOutlineThickness(0.f);
        window.draw(bg);

        sf::Text label(font, row.text, fontSize);
        sf::Color labelColor = textColor;
        labelColor.r = static_cast<std::uint8_t>(labelColor.r * row.tint.r / 255);
        labelColor.g = static_cast<std::uint8_t>(labelColor.g * row.tint.g / 255);
        labelColor.b = static_cast<std::uint8_t>(labelColor.b * row.tint.b / 255);
        labelColor.a = static_cast<std::uint8_t>(labelColor.a * row.tint.a / 255);
        label.setFillColor(labelColor);

        const sf::FloatRect bounds = label.getLocalBounds();
        const float textH = bounds.position.y + bounds.size.y;
        const float y = std::floor(rowRect.position.y + (snappedRowH - textH) / 2.f);
        label.setPosition({rowRect.position.x + 2.f, y});
        window.draw(label);
    }
}

} // namespace dof::render::ui
