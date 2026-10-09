#include "render/DebugPanel.hpp"
#include "render/ui/UiPanel.hpp"
#include "render/ui/UiLabel.hpp"

namespace dof::render {

void DebugPanel::drawDragHandle(sf::RenderWindow& window,
                                 const DebugPanelRects& rects) const {
    const auto r = computeDebugPanelDragHandleRect(rects);
    // Chamfered chip identical to the tab chips; bounds unchanged so
    // hit-test (debugPanelDragHandleContains) still lands correctly.
    ui::UiPanel{minimiseButtonBg, panelBorder, panelBorderThickness}
        .draw(window, r);
    ui::UiLabel{minimiseButtonLabel, textSize, ui::TextAlign::Center}
        .draw(window, r, font, ":");
}

void DebugPanel::drawMinimiseButton(sf::RenderWindow& window,
                                     const DebugPanelRects& rects,
                                     bool isMinimised) const {
    const auto r = computeDebugPanelMinimiseButtonRect(rects);
    ui::UiPanel{minimiseButtonBg, panelBorder, panelBorderThickness}
        .draw(window, r);
    ui::UiLabel{minimiseButtonLabel, textSize, ui::TextAlign::Center}
        .draw(window, r, font, isMinimised ? "+" : "_");
}

}
