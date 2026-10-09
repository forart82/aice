#pragma once

#include <SFML/Graphics/Color.hpp>
#include <SFML/System/Vector2.hpp>

#include <vector>

namespace sf { class RenderTarget; }

namespace dof::render {

// Drawing parameters loaded from config — passed into each draw call to
// keep all shape helpers pure functions with no global state.
struct VfxShapeParams {
    // Pitchfork fork
    float forkTineAngleDeg;
    float forkTineLengthFrac;
    float forkShaftWidth;
    float forkShaftAlphaStart;
    float forkShaftAlphaEnd;
    float forkTineWidthMult;

    // Sword swipe arc
    int   swipeArcSegments;
    float swipeArcThickness;
    float swipeArcAlphaStart;
    float swipeArcAlphaEnd;
    float swipeArcRadiusFrac;
    float swipeRevealCurveMult;
    float swipeEdgeFadeMult;

    // Knives slash marks at targets
    float knifeSlashSize;
    float knifeSlashThickness;
    float knifeLineThickness;
    float knifeAlphaStart;
    float knifeAlphaEnd;
    float knifeSlashAlphaMult;
    float knifeSlashSizeDampingMult;

    // Dagger rapid-stab burst
    float daggerSpreadDeg;
    float daggerStabWidth;
    float daggerAlphaStart;
    float daggerAlphaEnd;
    float daggerFadeStartMult;
    float daggerFadeEndMult;

    // AOE spin (Halberd / Quarterstaff)
    int   spinRingCount;
    int   spinSpokeCount;
    float spinInnerRadiusFrac;
    float spinAlphaStart;
    float spinAlphaEnd;
    float spinRingThickness;
    float spinRingAlphaInnerMult;
    float spinRingAlphaOuterMult;

    // AOE smash (Mace / Warhammer)
    int   smashSpokeCount;
    float smashSpokeLengthFrac;
    float smashSpokeWidth;
    float smashRingThickness;
    float smashAlphaStart;
    float smashAlphaEnd;

    // AOE pulse (BigAxe — world-anchored expanding circle)
    float pulseRingThickness;
    float pulseAlphaStart;
    float pulseAlphaEnd;

    // Neon glow halo multipliers (shared by all shapes)
    float glowThicknessMult;
    float glowAlphaMult;
};

// ---- per-mode draw functions ----

void drawForkAttack(sf::RenderTarget& window, sf::Vector2f origin, sf::Vector2f direction,
                    float range, float lifeRatio, sf::Color color,
                    const VfxShapeParams& p);

void drawSwordSwipe(sf::RenderTarget& window, sf::Vector2f origin, sf::Vector2f direction,
                    float range, float arcDegrees, float lifeRatio, sf::Color color,
                    const VfxShapeParams& p);

void drawKnivesSlash(sf::RenderTarget& window, sf::Vector2f origin,
                     const std::vector<sf::Vector2f>& targets,
                     float lifeRatio, sf::Color color, const VfxShapeParams& p);

void drawDaggerBurst(sf::RenderTarget& window, sf::Vector2f origin, sf::Vector2f target,
                     int stabCount, float lifeRatio, sf::Color color,
                     const VfxShapeParams& p);

void drawSpinAttack(sf::RenderTarget& window, sf::Vector2f origin, float range,
                    float lifeRatio, sf::Color color, const VfxShapeParams& p);

void drawSmashAttack(sf::RenderTarget& window, sf::Vector2f origin, float range,
                     float lifeRatio, sf::Color color, const VfxShapeParams& p);

void drawPulseAttack(sf::RenderTarget& window, sf::Vector2f origin, float range,
                     float lifeRatio, sf::Color color, const VfxShapeParams& p);

}
