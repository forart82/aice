#pragma once

#include <SFML/Graphics/BlendMode.hpp>
#include <SFML/Graphics/Color.hpp>
#include <SFML/Graphics/Rect.hpp>
#include <SFML/Graphics/RectangleShape.hpp>
#include <SFML/Graphics/RenderTarget.hpp>
#include <SFML/Graphics/Text.hpp>
#include <SFML/System/Vector2.hpp>
#include "render/ui/QuadBatch.hpp"
#include <algorithm>
#include <cmath>

namespace dof::render::ui {

inline sf::Vector2f pixelSnap(sf::Vector2f v) {
    return {std::floor(v.x), std::floor(v.y)};
}

inline sf::FloatRect pixelSnap(sf::FloatRect r) {
    return {
        {std::floor(r.position.x), std::floor(r.position.y)},
        {std::floor(r.size.x), std::floor(r.size.y)}
    };
}

// Returns the minimum design-unit thickness that renders as ≥1 screen pixel.
// Pure overload is testable without a window; RenderTarget overload reads scale
// from the active view (viewport fraction × window pixels / design units).
inline float clampedThicknessPure(float windowPixelW, float viewportFrac,
                                   float viewDesignW, float designThickness) {
    // Zero means BORDERLESS and must stay zero. Without this escape the
    // one-screen-pixel floor below turned a configured thickness of 0 into a
    // visible border on every panel-family widget.
    if (designThickness <= 0.f) return 0.f;
    const float scaleX = (viewportFrac > 0.f && viewDesignW > 0.f)
        ? windowPixelW * viewportFrac / viewDesignW
        : 1.f;
    const float minDesign = (scaleX > 0.f) ? (1.f / scaleX) : designThickness;
    return std::max(minDesign, designThickness);
}

inline float clampedThickness(const sf::RenderTarget& window, float designThickness) {
    const auto& view = window.getView();
    return clampedThicknessPure(
        static_cast<float>(window.getSize().x),
        view.getViewport().size.x,
        view.getSize().x,
        designThickness);
}

// Returns screen-pixels-per-design-unit {sx, sy} for the active view.
// Used to screen-pixel-snap border quad positions — prevents the half-pixel
// boundary edge case where a 1-screen-pixel quad lands on two pixel centres
// and neither is rasterised by the OpenGL top-left fill rule.
inline sf::Vector2f screenScales(const sf::RenderTarget& window) {
    const auto& view = window.getView();
    const float sx = (view.getViewport().size.x > 0.f && view.getSize().x > 0.f)
        ? static_cast<float>(window.getSize().x) * view.getViewport().size.x / view.getSize().x
        : 1.f;
    const float sy = (view.getViewport().size.y > 0.f && view.getSize().y > 0.f)
        ? static_cast<float>(window.getSize().y) * view.getViewport().size.y / view.getSize().y
        : 1.f;
    return {sx > 0.f ? sx : 1.f, sy > 0.f ? sy : 1.f};
}

// Snap a design-space coordinate to the nearest integer screen pixel.
inline float screenPixelSnap(float designCoord, float scale) {
    return (scale > 0.f) ? std::round(designCoord * scale) / scale : designCoord;
}

inline void centerOriginOf(sf::Text& text) {
    const sf::FloatRect bounds = text.getLocalBounds();
    text.setOrigin({bounds.position.x + bounds.size.x / 2.f,
                    bounds.position.y + bounds.size.y / 2.f});
}

// Fills `rect`, then draws its outline as 4 explicit border quads, and returns
// the rect actually drawn — callers reuse the returned rect to centre a label /
// content inside the exact pixels that were filled.
//
// The 4 quads (top/bottom/left/right) keep the outline ≥1 screen pixel at any
// view scale, avoiding SFML setOutlineThickness precision loss at sub-pixel
// design-unit sizes.
//
// When `shouldPixelSnap` is true the rect edges are snapped to integer screen
// pixels first. Plain design-pixel floor (pixelSnap) is insufficient: at some
// window sizes integer design coords land on half-screen-pixel boundaries,
// putting a quad edge exactly on a pixel centre — the OpenGL top-left fill rule
// then renders neither adjacent pixel and the border vanishes. Screen-space
// chrome wants this snap; world-space chrome drawn under a panning/zooming
// camera (e.g. a healthbar) must NOT snap — it would jitter every frame — so it
// passes false to draw the raw float rect.
inline sf::FloatRect drawBorderedRect(sf::RenderTarget& window,
                                      const sf::FloatRect& rect,
                                      const sf::Color& fill,
                                      const sf::Color& border,
                                      float borderThickness,
                                      bool shouldPixelSnap) {
    float x, y, w, h;
    if (shouldPixelSnap) {
        const auto [sx, sy] = screenScales(window);
        x = screenPixelSnap(rect.position.x,                 sx);
        y = screenPixelSnap(rect.position.y,                 sy);
        w = screenPixelSnap(rect.position.x + rect.size.x,   sx) - x;
        h = screenPixelSnap(rect.position.y + rect.size.y,   sy) - y;
    } else {
        x = rect.position.x; y = rect.position.y;
        w = rect.size.x;     h = rect.size.y;
    }

    sf::RectangleShape fillShape;
    fillShape.setPosition({x, y});
    fillShape.setSize({w, h});
    fillShape.setFillColor(fill);
    fillShape.setOutlineThickness(0.f);
    window.draw(fillShape);

    const float t = clampedThickness(window, borderThickness);
    auto drawQuad = [&](float qx, float qy, float qw, float qh) {
        sf::RectangleShape q;
        q.setPosition({qx, qy}); q.setSize({qw, qh});
        q.setFillColor(border);  q.setOutlineThickness(0.f);
        window.draw(q);
    };
    // Never let the side quads take a negative height: when the rect is
    // shorter than two border widths (t is inflated to at least one screen
    // pixel, so a small window scale reaches this), h - 2t goes negative and
    // SFML renders the quad inverted — painting a bar ABOVE the rect.
    const float sideHeight = std::max(0.f, h - 2.f * t);
    drawQuad(x,         y,         w,         t        ); // top
    drawQuad(x,         y + h - t, w,         t        ); // bottom
    drawQuad(x,         y + t,     t,     sideHeight   ); // left
    drawQuad(x + w - t, y + t,     t,     sideHeight   ); // right

    return {{x, y}, {w, h}};
}

// Draw a single filled quad whose edges are snapped to integer screen pixels
// and whose width/height are each guaranteed ≥1 screen pixel. This is the
// shared primitive for THIN lines/fills that have no border of their own —
// dividers, bar tracks/fills, carets, scrollbar thumbs, segmented-bar cells.
// Plain design-space rects at those thin sizes drop out at fractional view
// scale (a <1-screen-pixel dimension rounds to zero, or straddles a pixel
// centre and the OpenGL top-left fill rule rasterises neither neighbour). A
// zero input dimension stays zero (nothing to draw); a positive-but-thin
// dimension is floored to exactly one physical pixel on its own axis.
inline void drawThinQuad(sf::RenderTarget& window, const sf::FloatRect& rect,
                         const sf::Color& color) {
    const auto [sx, sy] = screenScales(window);
    const float x = screenPixelSnap(rect.position.x,               sx);
    const float y = screenPixelSnap(rect.position.y,               sy);
    float w = screenPixelSnap(rect.position.x + rect.size.x, sx) - x;
    float h = screenPixelSnap(rect.position.y + rect.size.y, sy) - y;
    if (rect.size.x > 0.f) w = std::max(w, 1.f / sx); // ≥1 screen px wide
    if (rect.size.y > 0.f) h = std::max(h, 1.f / sy); // ≥1 screen px tall
    sf::RectangleShape q;
    q.setPosition({x, y});
    q.setSize({w, h});
    q.setFillColor(color);
    q.setOutlineThickness(0.f);
    window.draw(q);
}

inline void appendThinQuad(sf::RenderTarget& window, QuadBatch& batch,
                           const sf::FloatRect& rect, const sf::Color& color) {
    const auto [sx, sy] = screenScales(window);
    const float x = screenPixelSnap(rect.position.x,               sx);
    const float y = screenPixelSnap(rect.position.y,               sy);
    float w = screenPixelSnap(rect.position.x + rect.size.x, sx) - x;
    float h = screenPixelSnap(rect.position.y + rect.size.y, sy) - y;
    if (rect.size.x > 0.f) w = std::max(w, 1.f / sx);
    if (rect.size.y > 0.f) h = std::max(h, 1.f / sy);
    batch.addRect({{x, y}, {w, h}}, color);
}

// Aligned neon glow frame. Draws, in order:
//   1. an OUTWARD additive halo — concentric hollow accent bands expanding
//      beyond the rect edge, fading with distance, additively blended so they
//      accumulate into a soft neon bloom that lives ONLY outside the panel;
//   2. the panel fill;
//   3. a crisp accent border snapped exactly ON the rect edge (drawBorderedRect).
// Because the hard border sits on the rect edge — the same edge the panel's
// content is laid out to — frame and content stay aligned (unlike a chamfered
// SDF shader whose visible edge is inset). Aspect-independent: works on a wide
// info bar and a square panel alike.
//
// `glowSpread` is how far (design px) the halo reaches past the edge;
// `glowLayers` is the number of bands (more = smoother); `glowAlpha` is the
// innermost band's alpha (0-255) before additive accumulation.
// Returns the aligned box rect actually drawn (from drawBorderedRect), so a
// caller can centre a label inside the exact pixels that were filled.
inline sf::FloatRect drawGlowFrame(sf::RenderTarget& window, const sf::FloatRect& rect,
                          const sf::Color& fill, const sf::Color& accent,
                          float borderThickness, int glowLayers,
                          float glowSpread, float glowAlpha) {
    if (glowLayers > 0 && glowSpread > 0.f && glowAlpha > 0.f) {
        const float step = glowSpread / static_cast<float>(glowLayers);
        // Outer band first (faintest) so nearer-edge bands accumulate on top.
        for (int i = glowLayers; i >= 1; --i) {
            const float m  = step * static_cast<float>(i);           // offset past edge
            const float bw = step + 1.0f;                            // band width
            // Fade: inner band (i=1) brightest, outer (i=glowLayers) faintest.
            const float t = static_cast<float>(i - 1) / static_cast<float>(glowLayers);
            sf::Color c = accent;
            c.a = static_cast<std::uint8_t>(std::clamp(glowAlpha * (1.0f - t) * (1.0f - t),
                                                       0.0f, 255.0f));
            const sf::FloatRect band{{rect.position.x - m, rect.position.y - m},
                                     {rect.size.x + 2.0f * m, rect.size.y + 2.0f * m}};
            auto addQuad = [&](float qx, float qy, float qw, float qh) {
                sf::RectangleShape q({qw, qh});
                q.setPosition({qx, qy});
                q.setFillColor(c);
                q.setOutlineThickness(0.f);
                window.draw(q, sf::BlendAdd);
            };
            addQuad(band.position.x, band.position.y, band.size.x, bw);                       // top
            addQuad(band.position.x, band.position.y + band.size.y - bw, band.size.x, bw);    // bottom
            addQuad(band.position.x, band.position.y, bw, band.size.y);                       // left
            addQuad(band.position.x + band.size.x - bw, band.position.y, bw, band.size.y);    // right
        }
    }
    return drawBorderedRect(window, rect, fill, accent, borderThickness, true);
}

} // namespace dof::render::ui
