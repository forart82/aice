#pragma once

#include <SFML/Graphics/Color.hpp>
#include <SFML/Graphics/Rect.hpp>
#include <SFML/Graphics/View.hpp>

namespace sf { class RenderWindow; }

namespace dof::render::ui {

// Scroll panel helpers. Uses SFML view-based clipping: the content area is
// rendered through a sub-view whose viewport maps to the panel's content rect,
// so SFML naturally clips anything outside the panel. A thin scrollbar strip
// is painted on the right side.
//
// Usage pattern (caller) — argument lists transcribed from the declarations
// below; the old example named parameters neither function has and would not
// have compiled:
//   const sf::View saved = window.getView();          // the design-space uiView
//   const float contentH = computeContentHeight(...);
//   const float offset   = UiScrollPanel::clampOffset(rawOffset, contentH, clipRect.size.y);
//   UiScrollPanel::applyClipView(window, clipRect, saved, offset);
//   // ... draw scrollable content in design-space coords ...
//   window.setView(saved);
//   UiScrollPanel::drawScrollbar(window, clipRect, offset, contentH, barW, barColor);

struct UiScrollPanel {
    // Clamp `offset` so the content never scrolls past its bounds.
    static float clampOffset(float offset, float contentH, float clipH);

    // Switch the window's view to clip content draws to `clipRect` (design coords),
    // scrolled by `offset` pixels. `uiView` is the current design-space view so
    // we can compute the correct viewport fractions.
    // Call `window.setView(saved)` to restore.
    static void applyClipView(sf::RenderWindow& window,
                               const sf::FloatRect& clipRect,
                               const sf::View& uiView,
                               float scrollOffset);

    // Draw a proportional scrollbar strip on the right edge of `clipRect`
    // (in design coords, under the restored uiView). No-op when content fits.
    static void drawScrollbar(sf::RenderWindow& window,
                               const sf::FloatRect& clipRect,
                               float scrollOffset,
                               float contentH,
                               float barW,
                               sf::Color color);
};

} // namespace dof::render::ui
