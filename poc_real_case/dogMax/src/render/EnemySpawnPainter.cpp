#include "render/EnemySpawnPainter.hpp"

#include "entities/Enemy.hpp"
#include "entities/QualityTier.hpp"

#include <SFML/Graphics/CircleShape.hpp>
#include <SFML/Graphics/RenderWindow.hpp>

#include <algorithm>
#include <cstdint>

namespace dof::render {

namespace {

std::uint8_t toByte(float value) {
    return static_cast<std::uint8_t>(std::clamp(value, 0.0f, 255.0f));
}

}  // namespace

SpawnInFactors computeSpawnInFactors(const dof::entities::Enemy& enemy,
                                     const EnemyBodyParams& params) {
    SpawnInFactors factors;  // steady state: solid, portal closed
    if (params.spawnAnimDuration <= 0.0f) return factors;
    const float timer = enemy.huntable().spawnAnimTimer;
    if (timer <= 0.0f) return factors;

    // t: 0 at spawn instant (timer == duration), 1 at anim end (timer == 0).
    const float t      = std::clamp(1.0f - (timer / params.spawnAnimDuration), 0.0f, 1.0f);
    const float openF  = std::clamp(params.spawnPortalOpenFraction, 0.0f, 1.0f);
    const float closeF = std::clamp(params.spawnPortalCloseFraction, 0.0f, 1.0f);

    // Portal openness: ramp up during the open phase, hold at 1 while the
    // enemy fades in, ramp back down during the close phase.
    float openness;
    if (t < openF) {
        openness = (openF > 0.0f) ? t / openF : 1.0f;
    } else if (t < closeF) {
        openness = 1.0f;
    } else {
        openness = (closeF < 1.0f) ? (1.0f - t) / (1.0f - closeF) : 0.0f;
    }
    factors.portalOpenness = std::clamp(openness, 0.0f, 1.0f);

    // Fade: enemy materialises in place over the [openF, closeF] hold window.
    // 0 while the portal is still opening, 1 once fully formed.
    float fade;
    if (t <= openF) {
        fade = 0.0f;
    } else if (t >= closeF || closeF <= openF) {
        fade = 1.0f;
    } else {
        fade = (t - openF) / (closeF - openF);
    }
    factors.fade = fade;
    return factors;
}

void drawEnemySpawnPortal(sf::RenderTarget& window,
                          const dof::entities::Enemy& enemy,
                          const EnemyBodyParams& params) {
    if (params.spawnAnimDuration <= 0.0f) return;
    const SpawnInFactors spawn = computeSpawnInFactors(enemy, params);
    if (spawn.portalOpenness <= 0.0f) return;

    const auto  position = enemy.spawnPosition();
    // The portal dilates open (radius 0 -> full) — an iris, not a fade. Held
    // at full while the enemy materialises, then irises back shut.
    const float radius = params.spawnPortalRadius * spawn.portalOpenness;
    if (radius <= 0.0f) return;

    // Squash vertically so the disc reads as a portal lying on the ground
    // rather than a flat coin facing the camera.
    const float yScale = std::clamp(params.spawnPortalVerticalScale, 0.05f, 1.0f);

    // Resolve neon outline color by quality tier
    sf::Color neonColor = params.outlineCommon;
    if (enemy.tier() == dof::entities::QualityTier::Uncommon) {
        neonColor = params.outlineUncommon;
    } else if (enemy.tier() == dof::entities::QualityTier::Rare) {
        neonColor = params.outlineRare;
    }

    // 1. Dark Void Center (Event Horizon)
    sf::CircleShape horizon(radius, 48);
    horizon.setOrigin({radius, radius});
    horizon.setScale({1.0f, yScale});
    horizon.setPosition(position);
    // Dark cyberpunk void color (very dark violet/black)
    sf::Color voidColor = params.spawnPortalVoidColor;
    voidColor.a = toByte(params.spawnPortalHorizonAlpha * spawn.portalOpenness);
    horizon.setFillColor(voidColor);
    window.draw(horizon);

    // 2. Outer Neon Bloom Glow (Wider, low-alpha rim for glowing effect)
    const float glowThickness = params.spawnPortalRimThickness * params.spawnPortalGlowThicknessMult;
    const float glowRadius = radius + glowThickness * params.spawnPortalGlowRadiusMult;
    sf::CircleShape glowRim(glowRadius, 48);
    glowRim.setOrigin({glowRadius, glowRadius});
    glowRim.setScale({1.0f, yScale});
    glowRim.setPosition(position);
    glowRim.setFillColor(sf::Color::Transparent);
    glowRim.setOutlineThickness(glowThickness);
    sf::Color glowColor = neonColor;
    glowColor.a = toByte(params.spawnPortalRimAlpha * params.spawnPortalGlowAlphaMult * spawn.portalOpenness);
    glowRim.setOutlineColor(glowColor);
    window.draw(glowRim);

    // 3. Core Neon Rim (The main solid outline)
    sf::CircleShape rim(radius, 48);
    rim.setOrigin({radius, radius});
    rim.setScale({1.0f, yScale});
    rim.setPosition(position);
    rim.setFillColor(sf::Color::Transparent);
    rim.setOutlineThickness(params.spawnPortalRimThickness);
    sf::Color coreRimColor = neonColor;
    coreRimColor.a = toByte(params.spawnPortalRimAlpha * spawn.portalOpenness);
    rim.setOutlineColor(coreRimColor);
    window.draw(rim);

    // 4. White Core Flare (Thin bright center line to make the neon "pop")
    // max(0) so a sub-pixel portal radius during iris open/close doesn't make
    // the flare radius negative.
    const float flareRadius = std::max(0.0f, radius - 1.0f);
    sf::CircleShape flare(flareRadius, 48);
    flare.setOrigin({flareRadius, flareRadius});
    flare.setScale({1.0f, yScale});
    flare.setPosition(position);
    flare.setFillColor(sf::Color::Transparent);
    flare.setOutlineThickness(1.5f);
    sf::Color flareColor = sf::Color::White;
    flareColor.a = toByte(180.0f * spawn.portalOpenness);
    flare.setOutlineColor(flareColor);
    window.draw(flare);
}

}  // namespace dof::render
