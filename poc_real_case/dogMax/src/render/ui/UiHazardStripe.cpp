#include "render/ui/UiHazardStripe.hpp"

#include "loaders/ConfigLoader.hpp"
#include "render/ColorTheme.hpp"

#include <SFML/Graphics/ConvexShape.hpp>
#include <SFML/Graphics/RectangleShape.hpp>
#include <SFML/Graphics/RenderWindow.hpp>

#include <cmath>
#include <utility>
#include <vector>

namespace dof::render::ui {

namespace {

// Sutherland-Hodgman clip of `poly` against one half-plane defined by
// `keep(p) >= 0`. `intersect(a, b)` returns the edge crossing point.
template <typename KeepFn, typename IntersectFn>
std::vector<sf::Vector2f> clipHalfPlane(const std::vector<sf::Vector2f>& poly,
                                        KeepFn keep, IntersectFn intersect) {
    std::vector<sf::Vector2f> out;
    if (poly.empty()) return out;
    out.reserve(poly.size() + 2);
    for (std::size_t i = 0; i < poly.size(); ++i) {
        const sf::Vector2f& a = poly[(i + poly.size() - 1) % poly.size()];
        const sf::Vector2f& b = poly[i];
        const bool aIn = keep(a);
        const bool bIn = keep(b);
        if (bIn) {
            if (!aIn) out.push_back(intersect(a, b));
            out.push_back(b);
        } else if (aIn) {
            out.push_back(intersect(a, b));
        }
    }
    return out;
}

// Clip `poly` against the axis-aligned `rect` using four half-plane
// passes (left, right, top, bottom). Returns the clipped polygon —
// empty if the input lies entirely outside the rect.
std::vector<sf::Vector2f> clipPolygonToRect(std::vector<sf::Vector2f> poly,
                                            sf::FloatRect rect) {
    const float left   = rect.position.x;
    const float right  = rect.position.x + rect.size.x;
    const float top    = rect.position.y;
    const float bottom = rect.position.y + rect.size.y;
    auto lerpX = [](sf::Vector2f p1, sf::Vector2f p2, float x) {
        const float dx = p2.x - p1.x;
        if (std::abs(dx) < 1e-6f) return sf::Vector2f{x, p1.y};
        const float k = (x - p1.x) / dx;
        return sf::Vector2f{x, p1.y + k * (p2.y - p1.y)};
    };
    auto lerpY = [](sf::Vector2f p1, sf::Vector2f p2, float y) {
        const float dy = p2.y - p1.y;
        if (std::abs(dy) < 1e-6f) return sf::Vector2f{p1.x, y};
        const float k = (y - p1.y) / dy;
        return sf::Vector2f{p1.x + k * (p2.x - p1.x), y};
    };
    poly = clipHalfPlane(poly,
        [left](sf::Vector2f p) { return p.x >= left; },
        [&](sf::Vector2f p1, sf::Vector2f p2) { return lerpX(p1, p2, left); });
    poly = clipHalfPlane(poly,
        [right](sf::Vector2f p) { return p.x <= right; },
        [&](sf::Vector2f p1, sf::Vector2f p2) { return lerpX(p1, p2, right); });
    poly = clipHalfPlane(poly,
        [top](sf::Vector2f p) { return p.y >= top; },
        [&](sf::Vector2f p1, sf::Vector2f p2) { return lerpY(p1, p2, top); });
    poly = clipHalfPlane(poly,
        [bottom](sf::Vector2f p) { return p.y <= bottom; },
        [&](sf::Vector2f p1, sf::Vector2f p2) { return lerpY(p1, p2, bottom); });
    return poly;
}

} // namespace

UiHazardStripe UiHazardStripe::loadFromConfig(const dof::loaders::ConfigLoader& config) {
    UiHazardStripe s{};
    s.period       = config.getFloat("UIR_HAZARD_STRIPE_PERIOD");
    s.stripeA      = dof::render::readRgbPrefixed(config, "UIR_HAZARD_STRIPE_A");
    s.stripeB      = dof::render::readRgbPrefixed(config, "UIR_HAZARD_STRIPE_B");
    s.angleDegrees = config.getFloat("UIR_HAZARD_STRIPE_ANGLE_DEG");
    return s;
}

void UiHazardStripe::draw(sf::RenderWindow& window, sf::FloatRect rect) const {
    // Base wash so the stripes read as cut-outs in the dark.
    sf::RectangleShape bg({rect.size.x, rect.size.y});
    bg.setPosition({rect.position.x, rect.position.y});
    bg.setFillColor(stripeB);
    window.draw(bg);
    if (period <= 0.0f) return;
    if (rect.size.x <= 0.0f || rect.size.y <= 0.0f) return;
    // Diagonal bars, PRE-CLIPPED to `rect` so the stripes never bleed
    // over neighbouring UI. Each stripe is a parallelogram: we step its
    // base along the perpendicular axis in increments of `period`, build
    // a 4-vertex shape crossing the rect, clip it against the four rect
    // edges via Sutherland-Hodgman, then paint the clipped polygon.
    const float angleRad = angleDegrees * 3.14159265358979f / 180.0f;
    const float dx = std::cos(angleRad);
    const float dy = std::sin(angleRad);
    // Perpendicular axis we step along to lay out successive stripes.
    const float px = -dy;
    const float py =  dx;
    const float barWidth = period * 0.5f;
    // Half-length of each stripe spans the rect's diagonal so the polygon
    // definitely covers the rect interior before clipping.
    const float halfLen = std::sqrt(rect.size.x * rect.size.x +
                                     rect.size.y * rect.size.y);
    const sf::Vector2f centre{rect.position.x + rect.size.x * 0.5f,
                              rect.position.y + rect.size.y * 0.5f};
    const float startT = -halfLen;
    const float endT   =  halfLen;
    for (float tOff = startT; tOff < endT; tOff += period) {
        const sf::Vector2f base{centre.x + px * tOff, centre.y + py * tOff};
        const float halfW = barWidth * 0.5f;
        const sf::Vector2f a{base.x + px * halfW - dx * halfLen,
                             base.y + py * halfW - dy * halfLen};
        const sf::Vector2f b{base.x + px * halfW + dx * halfLen,
                             base.y + py * halfW + dy * halfLen};
        const sf::Vector2f c{base.x - px * halfW + dx * halfLen,
                             base.y - py * halfW + dy * halfLen};
        const sf::Vector2f d{base.x - px * halfW - dx * halfLen,
                             base.y - py * halfW - dy * halfLen};
        std::vector<sf::Vector2f> poly{a, b, c, d};
        const auto clipped = clipPolygonToRect(std::move(poly), rect);
        if (clipped.size() < 3) continue;
        sf::ConvexShape bar;
        bar.setPointCount(clipped.size());
        for (std::size_t i = 0; i < clipped.size(); ++i) {
            bar.setPoint(i, clipped[i]);
        }
        bar.setFillColor(stripeA);
        window.draw(bar);
    }
}

} // namespace dof::render::ui
