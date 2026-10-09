#include "render/AttackVfxShapes.hpp"

#include "helpers/MathHelper.hpp"

#include <SFML/Graphics/ConvexShape.hpp>
#include <SFML/Graphics/RectangleShape.hpp>
#include <SFML/Graphics/RenderWindow.hpp>

#include <algorithm>
#include <cmath>

namespace dof::render {

namespace {

constexpr float kTau = 6.28318530717958647692f;

float lerp(float a, float b, float t) { return a + (b - a) * t; }

sf::Color withAlpha(sf::Color c, float alphaScalar) {
    c.a = static_cast<std::uint8_t>(std::clamp(alphaScalar * 255.0f, 0.0f, 255.0f));
    return c;
}

void drawStrip(sf::RenderTarget& window, sf::Vector2f origin, sf::Vector2f dir,
               float length, float width, sf::Color color) {
    if (length <= 0.0f || width <= 0.0f) return;
    sf::RectangleShape strip({length, width});
    strip.setOrigin({0.0f, width * 0.5f});
    strip.setPosition(origin);
    strip.setRotation(sf::degrees(dof::helpers::radiansToDegrees(std::atan2(dir.y, dir.x))));
    strip.setFillColor(color);
    window.draw(strip);
}

// Draws an arc as a polyline of short rectangular segments.
// revealFraction in [0,1] controls how much of the arc has been "swept".
void drawArcLine(sf::RenderTarget& window, sf::Vector2f origin, float aimAngle,
                 float arcRadians, float radius, float thickness, int segments,
                 float revealFraction, sf::Color color) {
    if (segments < 2 || radius <= 0.0f) return;
    const float startAngle = aimAngle - arcRadians * 0.5f;
    const int   drawn      = std::max(2, static_cast<int>(static_cast<float>(segments) * revealFraction));
    for (int i = 0; i < drawn; ++i) {
        const float t0 = static_cast<float>(i)     / static_cast<float>(segments);
        // Cap the final strip at the actual revealed fraction rather than
        // the next fixed segment boundary, so a fully-revealed arc
        // (revealFraction==1) sweeps its full arcRadians instead of
        // stopping 1/segments short at the leading tip.
        const float t1 = std::min(static_cast<float>(i + 1) / static_cast<float>(segments), revealFraction);
        const float a0 = startAngle + arcRadians * t0;
        const float a1 = startAngle + arcRadians * t1;
        const sf::Vector2f p0{origin.x + std::cos(a0) * radius,
                               origin.y + std::sin(a0) * radius};
        const sf::Vector2f p1{origin.x + std::cos(a1) * radius,
                               origin.y + std::sin(a1) * radius};
        const sf::Vector2f seg{p1.x - p0.x, p1.y - p0.y};
        const float segLen = dof::helpers::lengthOf(seg);
        if (segLen <= 0.0f) continue;
        const sf::Vector2f segDir{seg.x / segLen, seg.y / segLen};
        drawStrip(window, p0, segDir, segLen + 1.0f, thickness, color);
    }
}

void drawCircleRing(sf::RenderTarget& window, sf::Vector2f origin, float radius,
                    float thickness, int segments, sf::Color color) {
    if (segments < 3 || radius <= 0.0f) return;
    sf::ConvexShape ring;
    ring.setPointCount(static_cast<std::size_t>(segments));
    for (int i = 0; i < segments; ++i) {
        const float angle = (static_cast<float>(i) / static_cast<float>(segments)) * kTau;
        ring.setPoint(static_cast<std::size_t>(i),
                      {origin.x + std::cos(angle) * radius,
                       origin.y + std::sin(angle) * radius});
    }
    ring.setFillColor(sf::Color::Transparent);
    ring.setOutlineColor(color);
    ring.setOutlineThickness(thickness);
    window.draw(ring);
}

void drawNeonRing(sf::RenderTarget& window, sf::Vector2f origin, float radius,
                  float thickness, int segments, sf::Color color,
                  float glowMult, float glowAlpha) {
    drawCircleRing(window, origin, radius, thickness * glowMult,
                   segments, withAlpha(color, glowAlpha));
    drawCircleRing(window, origin, radius, thickness, segments, color);
}

// Cross / X mark at a position (two diagonal strips).
void drawSlashMark(sf::RenderTarget& window, sf::Vector2f pos, float size,
                   float thickness, sf::Color color) {
    const float half = size * 0.5f;
    const sf::Vector2f diagA{ 0.7071f,  0.7071f};
    const sf::Vector2f diagB{-0.7071f,  0.7071f};
    drawStrip(window, {pos.x - diagA.x * half, pos.y - diagA.y * half}, diagA,
              size, thickness, color);
    drawStrip(window, {pos.x - diagB.x * half, pos.y - diagB.y * half}, diagB,
              size, thickness, color);
}

}  // namespace

// ---- Pitchfork — three-pronged fork thrust ----
void drawForkAttack(sf::RenderTarget& window, sf::Vector2f origin, sf::Vector2f direction,
                    float range, float lifeRatio, sf::Color color,
                    const VfxShapeParams& p) {
    const float alpha  = lerp(p.forkShaftAlphaStart, p.forkShaftAlphaEnd, lifeRatio);
    const float length = range;
    const float gA     = alpha * p.glowAlphaMult;
    const sf::Color core = withAlpha(color, alpha);
    const sf::Color glow = withAlpha(color, gA);

    // Shaft
    drawStrip(window, origin, direction, length, p.forkShaftWidth * p.glowThicknessMult, glow);
    drawStrip(window, origin, direction, length, p.forkShaftWidth, core);

    // Tip prongs — branch at the end of the shaft
    const float tineLen  = range * p.forkTineLengthFrac;
    const float tineRad  = dof::helpers::degreesToRadians(p.forkTineAngleDeg);
    const sf::Vector2f tipCenter{origin.x + direction.x * length,
                                  origin.y + direction.y * length};
    const float baseAngle = std::atan2(direction.y, direction.x);
    for (int i = -1; i <= 1; ++i) {
        const float angle = baseAngle + static_cast<float>(i) * tineRad;
        const sf::Vector2f tineDir{std::cos(angle), std::sin(angle)};
        drawStrip(window, tipCenter, tineDir, tineLen,
                  p.forkShaftWidth * p.forkTineWidthMult * p.glowThicknessMult, glow);
        drawStrip(window, tipCenter, tineDir, tineLen,
                  p.forkShaftWidth * p.forkTineWidthMult, core);
    }
}

// ---- Sword swipe — sweeping neon arc outline ----
void drawSwordSwipe(sf::RenderTarget& window, sf::Vector2f origin, sf::Vector2f direction,
                    float range, float arcDegrees, float lifeRatio, sf::Color color,
                    const VfxShapeParams& p) {
    const float alpha    = lerp(p.swipeArcAlphaStart, p.swipeArcAlphaEnd, lifeRatio);
    const float radius   = range * p.swipeArcRadiusFrac;
    const float arcRad   = dof::helpers::degreesToRadians(arcDegrees);
    const float aimAngle = std::atan2(direction.y, direction.x);
    // Progressive sweep: reveal arc from trailing to leading edge.
    const float reveal   = std::clamp(lifeRatio * p.swipeRevealCurveMult, 0.0f, 1.0f);
    const sf::Color core = withAlpha(color, alpha);
    const sf::Color glow = withAlpha(color, alpha * p.glowAlphaMult);

    drawArcLine(window, origin, aimAngle, arcRad, radius,
                p.swipeArcThickness * p.glowThicknessMult,
                p.swipeArcSegments, reveal, glow);
    drawArcLine(window, origin, aimAngle, arcRad, radius,
                p.swipeArcThickness, p.swipeArcSegments, reveal, core);

    // Thin lines from origin to arc edges for the "trail" feel
    const float edgeFade = alpha * p.swipeEdgeFadeMult;
    const float startAngle = aimAngle - arcRad * 0.5f;
    // Track the arc's actual live leading tip (drawArcLine sweeps forward
    // from startAngle), not a fixed midpoint-relative angle — otherwise the
    // trail line runs ahead of/behind the arc's real edge mid-sweep.
    const float endAngle   = startAngle + arcRad * reveal;
    for (const float a : {startAngle, endAngle}) {
        const sf::Vector2f edgeDir{std::cos(a), std::sin(a)};
        drawStrip(window, origin, edgeDir, radius,
                  p.swipeArcThickness * 0.5f * p.glowThicknessMult,
                  withAlpha(color, edgeFade * p.glowAlphaMult));
        drawStrip(window, origin, edgeDir, radius,
                  p.swipeArcThickness * 0.5f, withAlpha(color, edgeFade));
    }
}

// ---- Knives — burst of radial lines + slash marks at targets ----
void drawKnivesSlash(sf::RenderTarget& window, sf::Vector2f origin,
                     const std::vector<sf::Vector2f>& targets,
                     float lifeRatio, sf::Color color, const VfxShapeParams& p) {
    if (targets.empty()) return;
    const float alpha = lerp(p.knifeAlphaStart, p.knifeAlphaEnd, lifeRatio);
    const sf::Color core = withAlpha(color, alpha);
    const sf::Color glow = withAlpha(color, alpha * p.glowAlphaMult);

    for (const auto& target : targets) {
        const sf::Vector2f delta{target.x - origin.x, target.y - origin.y};
        const float dist = dof::helpers::lengthOf(delta);
        if (dist <= 0.0f) continue;
        const sf::Vector2f dir{delta.x / dist, delta.y / dist};

        // Thin line from hero toward target
        drawStrip(window, origin, dir, dist,
                  p.knifeLineThickness * p.glowThicknessMult, glow);
        drawStrip(window, origin, dir, dist, p.knifeLineThickness, core);

        // Slash X mark at target
        const float slashAlpha = alpha * p.knifeSlashAlphaMult;
        drawSlashMark(window, target, p.knifeSlashSize * p.glowThicknessMult * p.knifeSlashSizeDampingMult,
                      p.knifeSlashThickness * p.glowThicknessMult,
                      withAlpha(color, slashAlpha * p.glowAlphaMult));
        drawSlashMark(window, target, p.knifeSlashSize,
                      p.knifeSlashThickness, withAlpha(color, slashAlpha));
    }
}

// ---- Dagger — rapid angled stabs at single target ----
void drawDaggerBurst(sf::RenderTarget& window, sf::Vector2f origin, sf::Vector2f target,
                     int stabCount, float lifeRatio, sf::Color color,
                     const VfxShapeParams& p) {
    const sf::Vector2f delta{target.x - origin.x, target.y - origin.y};
    const float dist = dof::helpers::lengthOf(delta);
    if (dist <= 0.0f) return;
    const sf::Vector2f baseDir{delta.x / dist, delta.y / dist};
    const float baseAngle = std::atan2(baseDir.y, baseDir.x);
    const float alpha     = lerp(p.daggerAlphaStart, p.daggerAlphaEnd, lifeRatio);
    const float spreadRad = dof::helpers::degreesToRadians(p.daggerSpreadDeg);
    // Each stab gets a progressively larger angle offset within the spread cone,
    // and fades as the burst progresses — fastest stab (i=0) is brightest.
    for (int i = 0; i < stabCount; ++i) {
        const float t     = stabCount > 1
                            ? static_cast<float>(i) / static_cast<float>(stabCount - 1)
                            : 0.5f;
        const float angle = baseAngle + (t - 0.5f) * spreadRad;
        const sf::Vector2f stabDir{std::cos(angle), std::sin(angle)};
        const float aScaled = alpha * lerp(p.daggerFadeStartMult, p.daggerFadeEndMult, t);
        drawStrip(window, origin, stabDir, dist,
                  p.daggerStabWidth * p.glowThicknessMult,
                  withAlpha(color, aScaled * p.glowAlphaMult));
        drawStrip(window, origin, stabDir, dist,
                  p.daggerStabWidth, withAlpha(color, aScaled));
    }
}

// ---- Halberd / Quarterstaff — 360° spin circle rings ----
void drawSpinAttack(sf::RenderTarget& window, sf::Vector2f origin, float range,
                    float lifeRatio, sf::Color color, const VfxShapeParams& p) {
    const float alpha = lerp(p.spinAlphaStart, p.spinAlphaEnd, lifeRatio);
    // Multiple rings at staggered radii (inner to outer)
    for (int r = 0; r < p.spinRingCount; ++r) {
        const float frac  = p.spinInnerRadiusFrac + (1.0f - p.spinInnerRadiusFrac)
                             * (static_cast<float>(r) / std::max(1.0f, static_cast<float>(p.spinRingCount - 1)));
        const float radius = range * frac;
        const float rAlpha = alpha * lerp(p.spinRingAlphaInnerMult, p.spinRingAlphaOuterMult, frac);
        drawNeonRing(window, origin, radius, p.spinRingThickness, 32,
                     withAlpha(color, rAlpha), p.glowThicknessMult, p.glowAlphaMult);
    }
    // Radial spokes — rotating as lifeRatio advances
    const float spokeLen   = range * (1.0f - p.spinInnerRadiusFrac);
    const float spokeStart = range * p.spinInnerRadiusFrac;
    const float rotation   = lifeRatio * kTau * 0.5f;
    for (int s = 0; s < p.spinSpokeCount; ++s) {
        const float angle = rotation + (static_cast<float>(s) / static_cast<float>(p.spinSpokeCount)) * kTau;
        const sf::Vector2f spokeDir{std::cos(angle), std::sin(angle)};
        const sf::Vector2f spokeOrigin{origin.x + spokeDir.x * spokeStart,
                                        origin.y + spokeDir.y * spokeStart};
        drawStrip(window, spokeOrigin, spokeDir, spokeLen,
                  p.spinRingThickness * p.glowThicknessMult,
                  withAlpha(color, alpha * 0.4f * p.glowAlphaMult));
        drawStrip(window, spokeOrigin, spokeDir, spokeLen,
                  p.spinRingThickness * 0.5f, withAlpha(color, alpha * 0.4f));
    }
}

// ---- Mace / Warhammer — ground smash shockwave ----
// Damage is instant at fire time, so the VFX flashes the FULL impact
// zone at t=0 then fades. This makes it immediately clear which enemies
// were hit rather than implying a ring "arriving" at each enemy.
void drawSmashAttack(sf::RenderTarget& window, sf::Vector2f origin, float range,
                     float lifeRatio, sf::Color color, const VfxShapeParams& p) {
    const float alpha    = lerp(p.smashAlphaStart, p.smashAlphaEnd, lifeRatio);
    const float spokeLen = range * p.smashSpokeLengthFrac;
    // Radial spokes at full length from t=0
    for (int s = 0; s < p.smashSpokeCount; ++s) {
        const float angle = (static_cast<float>(s) / static_cast<float>(p.smashSpokeCount)) * kTau;
        const sf::Vector2f dir{std::cos(angle), std::sin(angle)};
        drawStrip(window, origin, dir, spokeLen,
                  p.smashSpokeWidth * p.glowThicknessMult,
                  withAlpha(color, alpha * p.glowAlphaMult));
        drawStrip(window, origin, dir, spokeLen,
                  p.smashSpokeWidth, withAlpha(color, alpha));
    }
    // Outer ring at full radius from t=0
    drawNeonRing(window, origin, range, p.smashRingThickness, 28,
                 withAlpha(color, alpha * 0.8f), p.glowThicknessMult, p.glowAlphaMult);
}

// ---- BigAxe — world-anchored expanding pulse circle ----
void drawPulseAttack(sf::RenderTarget& window, sf::Vector2f origin, float range,
                     float lifeRatio, sf::Color color, const VfxShapeParams& p) {
    const float alpha  = lerp(p.pulseAlphaStart, p.pulseAlphaEnd, lifeRatio);
    const float radius = range * std::clamp(lifeRatio * 1.1f, 0.0f, 1.0f);
    drawNeonRing(window, origin, radius, p.pulseRingThickness, 32,
                 withAlpha(color, alpha), p.glowThicknessMult, p.glowAlphaMult);
    // Secondary trailing ring (smaller, fades faster)
    const float trailRadius = radius * 0.7f;
    const float trailAlpha  = alpha * 0.5f;
    if (trailAlpha > 0.02f) {
        drawCircleRing(window, origin, trailRadius, p.pulseRingThickness * 0.6f, 28,
                       withAlpha(color, trailAlpha));
    }
}

}
