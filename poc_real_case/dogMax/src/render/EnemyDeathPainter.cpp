#include "render/EnemyDeathPainter.hpp"

#include "render/EnemyBodyPainter.hpp"
#include "combat/EnemyExplosion.hpp"
#include "entities/Enemy.hpp"
#include "entities/QualityTier.hpp"

#include <SFML/Graphics/CircleShape.hpp>
#include <SFML/Graphics/ConvexShape.hpp>
#include <SFML/Graphics/RectangleShape.hpp>
#include <SFML/Graphics/RenderWindow.hpp>

#include <algorithm>
#include <cmath>
#include <cstdint>

namespace dof::render {

void drawEnemyDeathExplosion(sf::RenderTarget& window,
                             const dof::entities::Enemy& enemy,
                             const EnemyBodyParams& params) {
    if (params.deathAnimDuration <= 0.0f) return;
    const float t = enemy.deathable().deathTimer / params.deathAnimDuration;
    const auto position = enemy.moveable().interpolatedPosition(
        params.interpolationAlpha);
    sf::Color tierTint = params.outlineCommon;
    if (enemy.tier() == dof::entities::QualityTier::Uncommon) tierTint = params.outlineUncommon;
    else if (enemy.tier() == dof::entities::QualityTier::Rare) tierTint = params.outlineRare;

    const auto drawRing = [&](float startRadius, float endRadius, float startAlpha,
                              const sf::Color& color, bool isFilled) {
        const auto ring = dof::combat::computeExplosionRing(t, startRadius, endRadius, startAlpha);
        if (ring.alpha <= 0.0f || ring.radius <= 0.0f) return;
        sf::CircleShape shape(ring.radius, 32);
        shape.setOrigin({ring.radius, ring.radius});
        shape.setPosition(position);
        sf::Color resolved = color;
        resolved.a = static_cast<std::uint8_t>(std::clamp(ring.alpha, 0.0f, 255.0f));
        if (isFilled) {
            shape.setFillColor(resolved);
            shape.setOutlineThickness(0.0f);
        } else {
            shape.setFillColor(sf::Color::Transparent);
            shape.setOutlineThickness(params.deathRingOutlineThickness);
            shape.setOutlineColor(resolved);
        }
        window.draw(shape);
    };

    drawRing(params.deathRingOuterStartRadius, params.deathRingOuterEndRadius,
             params.deathRingOuterStartAlpha, tierTint, false);
    drawRing(params.deathRingMidStartRadius,   params.deathRingMidEndRadius,
             params.deathRingMidStartAlpha,    tierTint, false);
    drawRing(params.deathRingInnerStartRadius, params.deathRingInnerEndRadius,
             params.deathRingInnerStartAlpha,
             params.deathInnerRingColor, true);

    // card-mplgs9wc — fragmental shard layer. N small rotated quads
    // fan out from the death position so the explosion reads as a
    // bursting body, not just three concentric rings.
    if (params.deathShardCount > 0 && params.deathShardSize > 0.0f) {
        for (int i = 0; i < params.deathShardCount; ++i) {
            const auto shard = dof::combat::computeExplosionShard(
                i, params.deathShardCount, t,
                params.deathShardSpeed,
                params.deathShardStartAlpha,
                params.deathShardSpinDegrees);
            if (shard.alpha <= 0.0f) continue;
            const float size = params.deathShardSize;
            sf::RectangleShape quad({size, size * params.deathShardAspectRatio});
            quad.setOrigin({size * 0.5f, size * params.deathShardAspectRatio * 0.5f});
            quad.setPosition({position.x + shard.offsetX, position.y + shard.offsetY});
            quad.setRotation(sf::degrees(shard.rotationDegrees));
            sf::Color shardColor = tierTint;
            shardColor.a = static_cast<std::uint8_t>(std::clamp(shard.alpha, 0.0f, 255.0f));
            quad.setFillColor(shardColor);
            quad.setOutlineThickness(params.deathShardOutlineThickness);
            sf::Color outlineCol = params.deathShardOutlineColor;
            outlineCol.a = shardColor.a;
            quad.setOutlineColor(outlineCol);
            window.draw(quad);
        }
    }

    // card-mpmzdla5 — body-fragment layer. N tall isoceles triangles
    // fan out from the death position alongside the shards, reading
    // as the enemy body shattering. Each triangle's apex points away
    // from the centre; spin + outward distance + fade share the same
    // `computeExplosionShard` math so all three layers (rings, shards,
    // body fragments) decay on the same timeline.
    if (params.deathBodyFragmentCount > 0 && params.deathBodyFragmentLength > 0.0f) {
        for (int i = 0; i < params.deathBodyFragmentCount; ++i) {
            const auto fragment = dof::combat::computeExplosionShard(
                i, params.deathBodyFragmentCount, t,
                params.deathBodyFragmentSpeed,
                params.deathBodyFragmentStartAlpha,
                params.deathBodyFragmentSpinDegrees);
            if (fragment.alpha <= 0.0f) continue;
            const float halfWidth = params.deathBodyFragmentWidth * 0.5f;
            const float length    = params.deathBodyFragmentLength;
            sf::ConvexShape tri(3);
            // Local coordinates with apex pointing in the +x direction
            // before rotation. The shard helper already places the
            // fragment at the radial angle; setting rotation to the
            // shard's spin lets each triangle tumble visibly while
            // travelling outward.
            tri.setPoint(0, sf::Vector2f{length,     0.0f});
            tri.setPoint(1, sf::Vector2f{0.0f,     -halfWidth});
            tri.setPoint(2, sf::Vector2f{0.0f,      halfWidth});
            tri.setOrigin({0.0f, 0.0f});
            tri.setPosition({position.x + fragment.offsetX,
                              position.y + fragment.offsetY});
            // Angle the apex along the outward radial vector so the
            // fragment LOOKS like a chunk of body flying away rather
            // than a quad sliding sideways. Spin from the helper is
            // added on top so each fragment also tumbles.
            const float radialAngleRadians = (2.0f * 3.14159265358979f)
                * static_cast<float>(i)
                / static_cast<float>(params.deathBodyFragmentCount);
            const float radialAngleDegrees = radialAngleRadians * 180.0f / 3.14159265358979f;
            tri.setRotation(sf::degrees(radialAngleDegrees + fragment.rotationDegrees));
            sf::Color fragmentColor = tierTint;
            fragmentColor.a = static_cast<std::uint8_t>(std::clamp(fragment.alpha, 0.0f, 255.0f));
            tri.setFillColor(fragmentColor);
            sf::Color fragmentOutline = params.deathFragmentOutlineColor;
            fragmentOutline.a = fragmentColor.a;
            tri.setOutlineThickness(params.deathFragmentOutlineThickness);
            tri.setOutlineColor(fragmentOutline);
            window.draw(tri);
        }
    }
}

}
