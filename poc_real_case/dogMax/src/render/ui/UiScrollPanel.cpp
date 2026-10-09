#include "render/ui/UiScrollPanel.hpp"

#include "render/ui/PixelSnap.hpp"

#include <SFML/Graphics/RenderWindow.hpp>

#include <algorithm>

namespace dof::render::ui {

float UiScrollPanel::clampOffset(float offset, float contentH, float clipH) {
    const float maxOffset = std::max(0.0f, contentH - clipH);
    return std::clamp(offset, 0.0f, maxOffset);
}

void UiScrollPanel::applyClipView(sf::RenderWindow& window,
                                   const sf::FloatRect& clipRect,
                                   const sf::View& uiView,
                                   float scrollOffset)
{
    // uiView maps design coords to a letterbox viewport on the physical window.
    // Compute the fraction of the viewport that `clipRect` occupies.
    const sf::FloatRect vp   = uiView.getViewport();
    const sf::Vector2f  ds   = uiView.getSize();
    // Guard the only unprotected divisor in the toolkit: a zero-size view would
    // make every viewport fraction below NaN and hand that straight to setViewport.
    if (ds.x <= 0.f || ds.y <= 0.f) return;

    // Normalize clipRect within the design space → then map to the viewport.
    const float nx = vp.position.x + (clipRect.position.x / ds.x) * vp.size.x;
    const float ny = vp.position.y + (clipRect.position.y / ds.y) * vp.size.y;
    const float nw = (clipRect.size.x / ds.x) * vp.size.x;
    const float nh = (clipRect.size.y / ds.y) * vp.size.y;

    sf::View contentView;
    contentView.setSize({clipRect.size.x, clipRect.size.y});
    // Centre moves down by scrollOffset so the visible window shows from offset.
    contentView.setCenter({clipRect.position.x + clipRect.size.x * 0.5f,
                           clipRect.position.y + clipRect.size.y * 0.5f + scrollOffset});
    contentView.setViewport({{nx, ny}, {nw, nh}});
    window.setView(contentView);
}

void UiScrollPanel::drawScrollbar(sf::RenderWindow& window,
                                   const sf::FloatRect& clipRect,
                                   float scrollOffset,
                                   float contentH,
                                   float barW,
                                   sf::Color color)
{
    if (contentH <= clipRect.size.y) return;  // content fits — no scrollbar

    const float ratio     = clipRect.size.y / contentH;
    const float thumbH    = std::max(20.0f, clipRect.size.y * ratio);
    const float trackH    = std::max(0.0f, clipRect.size.y - thumbH);
    const float maxOffset = contentH - clipRect.size.y;
    // Clamp here rather than trusting the caller to have called clampOffset:
    // everything it needs is already a parameter, and an unclamped offset drew
    // the thumb outside its own track.
    const float offset    = clampOffset(scrollOffset, contentH, clipRect.size.y);
    const float thumbY    = clipRect.position.y + (offset / maxOffset) * trackH;
    const float thumbX    = clipRect.position.x + clipRect.size.x - barW;

    ui::drawThinQuad(window, {{thumbX, thumbY}, {barW, thumbH}}, color);
}

} // namespace dof::render::ui
