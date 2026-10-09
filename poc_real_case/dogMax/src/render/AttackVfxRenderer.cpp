#include "render/AttackVfxRenderer.hpp"

#include "hubs/AttackVfxHub.hpp"
#include "loaders/ConfigLoader.hpp"
#include "render/AttackVfxShapes.hpp"
#include "render/WeaponSprite.hpp"

#include <SFML/Graphics/RenderWindow.hpp>
#include <SFML/Graphics/CircleShape.hpp>
#include <SFML/Graphics/RectangleShape.hpp>

#include <algorithm>
#include <cmath>

namespace dof::render {

AttackVfxRenderer::AttackVfxRenderer(const dof::loaders::ConfigLoader& cfg)
    : configRef(cfg) {
    weaponSpriteSize = cfg.getFloat("ATTACK_VFX_WEAPON_SPRITE_SIZE");
    weaponSpriteTravel = cfg.getFloat("ATTACK_VFX_WEAPON_SPRITE_TRAVEL");
    enemyWeaponSpriteSize = cfg.getFloat("ENEMY_ATTACK_VFX_WEAPON_SPRITE_SIZE");
    enemyTraceLifeFraction = cfg.getFloat("ENEMY_ATTACK_TRACE_LIFE_FRACTION");
    enemyTraceWidth = cfg.getFloat("ENEMY_ATTACK_TRACE_WIDTH");
    enemyImpactRadius = cfg.getFloat("ENEMY_ATTACK_TRACE_IMPACT_RADIUS");
    enemyImpactThickness = cfg.getFloat("ENEMY_ATTACK_TRACE_IMPACT_THICKNESS");
    enemyTraceColor = sf::Color{
        static_cast<std::uint8_t>(cfg.getInt("ENEMY_ATTACK_TRACE_R")),
        static_cast<std::uint8_t>(cfg.getInt("ENEMY_ATTACK_TRACE_G")),
        static_cast<std::uint8_t>(cfg.getInt("ENEMY_ATTACK_TRACE_B"))};
    // Pitchfork fork
    params.forkTineAngleDeg    = cfg.getFloat("ATTACK_VFX_FORK_TINE_ANGLE_DEG");
    params.forkTineLengthFrac  = cfg.getFloat("ATTACK_VFX_FORK_TINE_LENGTH_FRAC");
    params.forkShaftWidth      = cfg.getFloat("ATTACK_VFX_FORK_SHAFT_WIDTH");
    params.forkShaftAlphaStart = cfg.getFloat("ATTACK_VFX_FORK_ALPHA_START");
    params.forkShaftAlphaEnd   = cfg.getFloat("ATTACK_VFX_FORK_ALPHA_END");
    params.forkTineWidthMult   = cfg.getFloat("ATTACK_VFX_FORK_TINE_WIDTH_MULT");

    // Sword swipe arc
    params.swipeArcSegments   = cfg.getInt("ATTACK_VFX_SWIPE_ARC_SEGMENTS");
    params.swipeArcThickness  = cfg.getFloat("ATTACK_VFX_SWIPE_ARC_THICKNESS");
    params.swipeArcAlphaStart = cfg.getFloat("ATTACK_VFX_SWIPE_ARC_ALPHA_START");
    params.swipeArcAlphaEnd   = cfg.getFloat("ATTACK_VFX_SWIPE_ARC_ALPHA_END");
    params.swipeArcRadiusFrac = cfg.getFloat("ATTACK_VFX_SWIPE_ARC_RADIUS_FRAC");
    params.swipeRevealCurveMult = cfg.getFloat("ATTACK_VFX_SWIPE_REVEAL_CURVE_MULT");
    params.swipeEdgeFadeMult    = cfg.getFloat("ATTACK_VFX_SWIPE_EDGE_FADE_MULT");

    // Knives
    params.knifeSlashSize      = cfg.getFloat("ATTACK_VFX_KNIFE_SLASH_SIZE");
    params.knifeSlashThickness = cfg.getFloat("ATTACK_VFX_KNIFE_SLASH_THICKNESS");
    params.knifeLineThickness  = cfg.getFloat("ATTACK_VFX_KNIFE_LINE_THICKNESS");
    params.knifeAlphaStart     = cfg.getFloat("ATTACK_VFX_KNIFE_ALPHA_START");
    params.knifeAlphaEnd       = cfg.getFloat("ATTACK_VFX_KNIFE_ALPHA_END");
    params.knifeSlashAlphaMult       = cfg.getFloat("ATTACK_VFX_KNIFE_SLASH_ALPHA_MULT");
    params.knifeSlashSizeDampingMult = cfg.getFloat("ATTACK_VFX_KNIFE_SLASH_SIZE_DAMPING_MULT");

    // Dagger
    params.daggerSpreadDeg  = cfg.getFloat("ATTACK_VFX_DAGGER_SPREAD_DEG");
    params.daggerStabWidth  = cfg.getFloat("ATTACK_VFX_DAGGER_STAB_WIDTH");
    params.daggerAlphaStart = cfg.getFloat("ATTACK_VFX_DAGGER_ALPHA_START");
    params.daggerAlphaEnd   = cfg.getFloat("ATTACK_VFX_DAGGER_ALPHA_END");
    params.daggerFadeStartMult = cfg.getFloat("ATTACK_VFX_DAGGER_FADE_START_MULT");
    params.daggerFadeEndMult   = cfg.getFloat("ATTACK_VFX_DAGGER_FADE_END_MULT");

    // Spin (Halberd / Quarterstaff)
    params.spinRingCount       = cfg.getInt("ATTACK_VFX_SPIN_RING_COUNT");
    params.spinSpokeCount      = cfg.getInt("ATTACK_VFX_SPIN_SPOKE_COUNT");
    params.spinInnerRadiusFrac = cfg.getFloat("ATTACK_VFX_SPIN_INNER_RADIUS_FRAC");
    params.spinAlphaStart      = cfg.getFloat("ATTACK_VFX_SPIN_ALPHA_START");
    params.spinAlphaEnd        = cfg.getFloat("ATTACK_VFX_SPIN_ALPHA_END");
    params.spinRingThickness   = cfg.getFloat("ATTACK_VFX_SPIN_RING_THICKNESS");
    params.spinRingAlphaInnerMult = cfg.getFloat("ATTACK_VFX_SPIN_RING_ALPHA_INNER_MULT");
    params.spinRingAlphaOuterMult = cfg.getFloat("ATTACK_VFX_SPIN_RING_ALPHA_OUTER_MULT");

    // Smash (Mace / Warhammer)
    params.smashSpokeCount      = cfg.getInt("ATTACK_VFX_SMASH_SPOKE_COUNT");
    params.smashSpokeLengthFrac = cfg.getFloat("ATTACK_VFX_SMASH_SPOKE_LENGTH_FRAC");
    params.smashSpokeWidth      = cfg.getFloat("ATTACK_VFX_SMASH_SPOKE_WIDTH");
    params.smashRingThickness   = cfg.getFloat("ATTACK_VFX_SMASH_RING_THICKNESS");
    params.smashAlphaStart      = cfg.getFloat("ATTACK_VFX_SMASH_ALPHA_START");
    params.smashAlphaEnd        = cfg.getFloat("ATTACK_VFX_SMASH_ALPHA_END");

    // Pulse (BigAxe)
    params.pulseRingThickness = cfg.getFloat("ATTACK_VFX_PULSE_RING_THICKNESS");
    params.pulseAlphaStart    = cfg.getFloat("ATTACK_VFX_PULSE_ALPHA_START");
    params.pulseAlphaEnd      = cfg.getFloat("ATTACK_VFX_PULSE_ALPHA_END");

    // Shared neon glow halo
    params.glowThicknessMult = cfg.getFloat("ATTACK_VFX_GLOW_THICKNESS_MULT");
    params.glowAlphaMult     = cfg.getFloat("ATTACK_VFX_GLOW_ALPHA_MULT");
}

void AttackVfxRenderer::drawAll(sf::RenderTarget& window,
                                 const dof::hubs::AttackVfxHub& hub,
                                 sf::Vector2f currentHeroFeet) const {
    using WT = dof::entities::WeaponType;
    for (const auto& ev : hub.events()) {
        const float life = std::clamp(ev.age / std::max(0.001f, ev.duration), 0.0f, 1.0f);
        // Hero-anchored events draw at the CURRENT hero position so the
        // VFX follows a moving hero. World-anchored events (BigAxe pulse)
        // use the fire-time origin stored in originWorld.
        const sf::Vector2f origin = ev.isHeroAnchored ? currentHeroFeet : ev.originWorld;

        if (ev.isEnemyAttack && enemyTraceLifeFraction > 0.0f
            && life < enemyTraceLifeFraction) {
            sf::Vector2f target = ev.executionTarget;
            if (ev.mode == dof::entities::AttackType::Swipe) {
                target = {origin.x + ev.direction.x * ev.range * params.swipeArcRadiusFrac,
                          origin.y + ev.direction.y * ev.range * params.swipeArcRadiusFrac};
            }
            const sf::Vector2f delta{target.x - origin.x, target.y - origin.y};
            const float distance = std::sqrt(delta.x * delta.x + delta.y * delta.y);
            if (distance > 0.0f) {
                const float fade = 1.0f - life / enemyTraceLifeFraction;
                sf::Color traceColor = enemyTraceColor;
                traceColor.a = static_cast<std::uint8_t>(255.0f * fade);
                sf::RectangleShape trace({distance, enemyTraceWidth});
                trace.setOrigin({0.0f, enemyTraceWidth * 0.5f});
                trace.setPosition(origin);
                trace.setRotation(sf::radians(std::atan2(delta.y, delta.x)));
                trace.setFillColor(traceColor);
                window.draw(trace);

                sf::CircleShape impact(enemyImpactRadius, 28);
                impact.setOrigin({enemyImpactRadius, enemyImpactRadius});
                impact.setPosition(target);
                impact.setFillColor(sf::Color::Transparent);
                impact.setOutlineThickness(enemyImpactThickness);
                impact.setOutlineColor(traceColor);
                window.draw(impact);
            }
        }

        sf::Vector2f weaponDirection = ev.direction;
        if (weaponDirection.x == 0.0f && weaponDirection.y == 0.0f) {
            const sf::Vector2f target = ev.mode == dof::entities::AttackType::MultiSingle
                ? ev.stabTarget
                : (!ev.radialTargets.empty() ? ev.radialTargets.front() : origin);
            const float dx = target.x - origin.x;
            const float dy = target.y - origin.y;
            const float length = std::sqrt(dx * dx + dy * dy);
            weaponDirection = length > 0.0f ? sf::Vector2f{dx / length, dy / length}
                                             : sf::Vector2f{1.0f, 0.0f};
        }
        // The swung/thrust weapon used to be painted here as a PNG sprite,
        // tinted pure white — both a texture and a fourth colour outside the
        // locked palette, on the most frequently drawn effect in the game.
        // Deleted rather than replaced: the switch immediately below already
        // dispatches to fully code-drawn, palette-tinted attack shapes
        // (drawForkAttack, drawSwordSwipe, drawKnivesSlash, ...), so the
        // replacement was already running underneath the art the whole time.
        switch (ev.mode) {
            case dof::entities::AttackType::Single:
                // weaponDirection, not ev.direction: the zero-vector fallback
                // above is what points at the real target. atan2(0,0) is 0, so
                // the raw vector drew the shaft due east while the weapon
                // sprite pointed correctly.
                drawForkAttack(window, origin, weaponDirection, ev.range, life,
                               ev.color, params);
                break;

            case dof::entities::AttackType::Swipe:
                drawSwordSwipe(window, origin, weaponDirection, ev.range,
                               ev.arcDegrees, life, ev.color, params);
                break;

            case dof::entities::AttackType::MultiTarget:
                drawKnivesSlash(window, origin, ev.radialTargets, life,
                                ev.color, params);
                break;

            case dof::entities::AttackType::MultiSingle: {
                // Stab target also needs to shift with the hero so the
                // burst stays on the (possibly moving) enemy relative position.
                const sf::Vector2f heroOffset = ev.isHeroAnchored
                    ? sf::Vector2f{currentHeroFeet.x - ev.originWorld.x,
                                   currentHeroFeet.y - ev.originWorld.y}
                    : sf::Vector2f{0.0f, 0.0f};
                const sf::Vector2f target{ev.stabTarget.x + heroOffset.x,
                                           ev.stabTarget.y + heroOffset.y};
                drawDaggerBurst(window, origin, target, ev.stabCount, life,
                                ev.color, params);
                break;
            }

            case dof::entities::AttackType::Aoe:
                if (ev.weaponTypeHint == WT::Halberd
                    || ev.weaponTypeHint == WT::Quarterstaff) {
                    drawSpinAttack(window, origin, ev.range, life, ev.color, params);
                } else if (ev.weaponTypeHint == WT::BigAxe) {
                    drawPulseAttack(window, origin, ev.range, life, ev.color, params);
                } else {
                    drawSmashAttack(window, origin, ev.range, life, ev.color, params);
                }
                break;
        }
    }
}

}
