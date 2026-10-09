#include "render/DebugPanel.hpp"
#include "render/ui/UiPanel.hpp"
#include "render/ui/UiLabel.hpp"

#include <cstdio>
#include <string>

namespace dof::render {

sf::FloatRect computeSpeedDecButtonRect(const DebugPanelRects& rects) {
    return {{rects.panelX, rects.speedStripY()},
            {rects.speedStripHeight, rects.speedStripHeight}};
}

sf::FloatRect computeSpeedIncButtonRect(const DebugPanelRects& rects) {
    return {{rects.panelX + rects.panelWidth - rects.speedStripHeight, rects.speedStripY()},
            {rects.speedStripHeight, rects.speedStripHeight}};
}

void DebugPanel::drawSpeedStrip(sf::RenderWindow& window,
                                 const DebugPanelRects& rects,
                                 float timeScale) const {
    if (rects.speedStripHeight <= 0.0f) return;

    const sf::FloatRect stripRect{{rects.panelX, rects.speedStripY()},
                                   {rects.panelWidth, rects.speedStripHeight}};
    // Flat background for the strip interior (no chamfer needed here).
    ui::UiPanel{outputBg, sf::Color::Transparent, 0.0f}.draw(window, stripRect);

    const auto drawChip = [&](const sf::FloatRect& r, const char* glyph) {
        ui::UiPanel{minimiseButtonBg, panelBorder, panelBorderThickness}
            .draw(window, r);
        ui::UiLabel{minimiseButtonLabel, textSize, ui::TextAlign::Center}
            .draw(window, r, font, glyph);
    };

    drawChip(computeSpeedDecButtonRect(rects), "-");
    drawChip(computeSpeedIncButtonRect(rects), "+");

    char buf[32];
    std::snprintf(buf, sizeof(buf), "Speed: %.1fx", timeScale);
    ui::UiLabel{outputText, textSize, ui::TextAlign::Center}
        .draw(window, stripRect, font, buf);
}

}
