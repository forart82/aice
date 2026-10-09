#include "render/WorldRenderer.hpp"

#include "combat/DodgeSystem.hpp"
#include "core/World.hpp"
#include "entities/Enemy.hpp"
#include "entities/Hero.hpp"
#include "entities/QualityTier.hpp"
#include "hubs/EvasionHub.hpp"
#include "hubs/LuckHub.hpp"
#include "loaders/ConfigLoader.hpp"
#include "loaders/ShaderLoader.hpp"
#include "render/BarLayout.hpp"
#include "render/GhostTrail.hpp"
#include "render/LevelUpAura.hpp"
#include "render/OutlineIntensity.hpp"
#include "render/UiAccent.hpp"
#include "render/ui/UiPanel.hpp"
#include "render/ui/PixelSnap.hpp"

#include <SFML/Graphics/CircleShape.hpp>
#include <SFML/Graphics/ConvexShape.hpp>
#include <SFML/Graphics/Image.hpp>
#include <SFML/Graphics/RenderWindow.hpp>
#include <SFML/Graphics/Shader.hpp>
#include <SFML/Graphics/Sprite.hpp>
#include <SFML/Graphics/Text.hpp>
#include <SFML/Graphics/Texture.hpp>

#include <algorithm>
#include <cmath>
#include <sstream>
#include <stdexcept>

namespace dof::render {

namespace {

enum class LabelAnchor { Centre, RightEdge };

void drawHealthbarLabel(sf::RenderTarget& window,
                        const sf::Font& font,
                        const std::string& text,
                        float fontSize,
                        sf::Vector2f position,
                        sf::Color fill,
                        float alphaScalar,
                        LabelAnchor anchor = LabelAnchor::Centre) {
    sf::Text label(font, text, static_cast<unsigned>(fontSize));
    sf::Color resolvedFill = fill;
    resolvedFill.a = static_cast<std::uint8_t>(std::clamp(255.0f * alphaScalar, 0.0f, 255.0f));
    sf::Color resolvedOutline = sf::Color::Black;
    resolvedOutline.a = resolvedFill.a;
    label.setFillColor(resolvedFill);
    label.setOutlineColor(resolvedOutline);
    label.setOutlineThickness(1.0f);
    if (anchor == LabelAnchor::RightEdge) {
        const auto bounds = label.getLocalBounds();
        label.setOrigin({bounds.position.x + bounds.size.x,
                         bounds.position.y + bounds.size.y / 2.0f});
    } else {
        ui::centerOriginOf(label);
    }
    label.setPosition(position);
    window.draw(label);
}

float tierVisualScale(dof::entities::QualityTier tier,
                      float commonScale,
                      float uncommonScale,
                      float rareScale) {
    if (tier == dof::entities::QualityTier::Uncommon) return uncommonScale;
    if (tier == dof::entities::QualityTier::Rare)     return rareScale;
    return commonScale;
}

} // namespace

void WorldRenderer::drawHeroBody(sf::RenderTarget& window, const dof::core::World& world) {
    const auto& hero = world.hero();
    const auto position = hero.moveable().interpolatedPosition(currentInterpolationAlpha);
    // CODE-DRAWN HERO. The hero used to be an 8-direction sprite atlas — the
    // last texture left in the world/hero/enemy layer. It is now a silhouette
    // from the SAME shared shape catalog that draws enemy bodies and world
    // props, so every actor and object in the game is cut from one alphabet.
    //
    // What this trades away, stated plainly: the authored humanoid figure. What
    // it buys: the hero rotates CONTINUOUSLY to face its heading instead of
    // snapping between 8 atlas rows, the neon rim comes from an inward outline
    // rather than a pre-baked halo texture, and the startup cost of chroma-
    // keying and scanning 64 atlas cells for foot registration disappears.
    const auto velocity = hero.moveable().velocity;
    const bool isMoving = velocity.x != 0.0f || velocity.y != 0.0f;
    // Facing is movement state, not combat aim. Auto-targeting may change aim
    // every frame while stationary, which made the old atlas row flicker even
    // though the hero had not turned. Kept verbatim for the same reason.
    const sf::Vector2f facing = isMoving
        ? velocity
        : hero.inputable().lastNonZeroDirection;
    const float facingDegrees =
        std::atan2(facing.y, facing.x) * 180.0f / std::numbers::pi_v<float>
        + heroShapeRotationOffsetDegrees;

    // Walk cadence still comes from Hero::movementAnimationCycle, which is
    // distance-driven, so the gait stays locked to ground speed. It drives the
    // LIMBS now rather than a size pulse — a size pulse made the hero throb,
    // which is motion but not life.
    const float walkPhase = hero.movementAnimationCycle()
                          * 2.0f * std::numbers::pi_v<float>;

    // Squash/stretch on hit reaction (visual_identity.md Step 10). Driven off
    // the EXISTING incomingHitFlash decay rather than a new timer, so the
    // squash, the damage flash and the hit feedback all share one clock and
    // cannot drift apart.
    //
    // Volume-preserving — the body widens exactly as much as it flattens — so
    // the hero reads as compressing under an impact rather than simply being
    // drawn at the wrong size.
    const float hitSquash = hero.incomingHitFlash() * heroSquashStrength;
    const float squashY = 1.0f - hitSquash;
    const float squashX = (squashY > 0.01f) ? (1.0f / squashY) : 1.0f;

    const float heroBodyRadius = heroSpriteSize * 0.5f;
    // Stride settles rather than snapping: at a standstill the pose eases back
    // to neutral and the breath takes over, so stopping reads as a body coming
    // to rest instead of an animation being switched off.
    const float strideAmount = isMoving ? 1.0f : 0.0f;

    // Build heat drives both the halo colour below and the shader's core, so it
    // is computed once here rather than twice in two places that could drift.
    const bool isGhostStepActive = evasionHubPtr && evasionHubPtr->isFlashActive();
    const sf::Color activeOutline = isGhostStepActive ? ghostStepOutline : theme.heroOutline;
    float heroBuildEnergy = 0.0f;
    if (buildGlow.isEnabled && !isGhostStepActive && luckHubPtr) {
        const float luckNormalised = std::clamp(
            static_cast<float>(luckHubPtr->luckTotal()) / buildGlow.luckReference,
            0.0f, 1.0f);
        heroBuildEnergy = std::pow(luckNormalised, buildGlow.gamma);
    }
    sf::Shader* heroShader = shadersPtr
        ? const_cast<sf::Shader*>(shadersPtr->getShader("hero")) : nullptr;

    // One draw entry point, so the ghost trail and the dash afterimages below
    // keep working unchanged — they only ever varied position and tint.
    //
    // Drawn through a SHADER, in the same medium as the enemies. The hero was
    // previously flat filled polygons while every enemy had a turbulent
    // shader-rendered corona, which is why the enemies looked richer than the
    // protagonist. Matching the medium is what makes the hero belong.
    const auto drawHeroSprite = [&](sf::Vector2f at, sf::Color tint) {
        if (!heroShader) return;
        const float alphaScale = static_cast<float>(tint.a) / 255.0f;
        shapeShaders.drawHero(
            window, heroShader, at, heroSpriteSize * heroFormScale,
            {static_cast<float>(tint.r) / 255.0f * alphaScale,
             static_cast<float>(tint.g) / 255.0f * alphaScale,
             static_cast<float>(tint.b) / 255.0f * alphaScale},
            currentSimSeconds,
            facingDegrees * std::numbers::pi_v<float> / 180.0f,
            heroBuildEnergy, hero.incomingHitFlash(), heroFormIndex);
    };

    const float locatorRadius = heroRadius * heroLocatorRadiusMultiplier;
    sf::CircleShape locator(locatorRadius, 64u);
    locator.setOrigin({locatorRadius, locatorRadius});
    locator.setPosition(position);
    locator.setScale({1.0f, heroLocatorYScale});
    locator.setFillColor(sf::Color::Transparent);
    sf::Color locatorColor = activeOutline;
    locatorColor.a = static_cast<std::uint8_t>(heroLocatorAlpha);
    locator.setOutlineColor(locatorColor);
    locator.setOutlineThickness(static_cast<float>(theme.haloThickness));
    window.draw(locator);

    // Step 3 (visual identity) — the hero's rim outline came from a
    // pre-baked sprite alone, with no soft multi-layer glow behind it, while
    // every enemy gets one (EnemyBodyPainter's halo loop). That asymmetry
    // was the "hero and enemies don't read as one visual family" gap.
    // Reuses the exact same THEME_HALO_* keys enemies read, so thickness and
    // falloff behaviour are identical; only the outline colour (hue) differs
    // by role, per the Step 3 change spec.
    // Step 6 — build-reactive glow, the identity hook. The halo heats toward
    // HERO_BUILD_GLOW_PEAK_* as the equipped build's luck total rises, so the
    // hero's own look reports the player's build back to them. Driven by
    // dogmax's dice/luck system rather than health or combat, which is what
    // makes it unique rather than generically neon.
    //
    // Deliberately confined to the HALO. The locator ring and the sprite rim
    // both read from activeOutline, and modulating that would drift the hero's
    // silhouette colour — the one thing that must stay stable so the player can
    // always find themselves. Only the soft glow breathes.
    //
    // Ghost-step still wins: an active evade is state the player must read
    // instantly, and decoration must never overwrite a state signal.
    sf::Color haloColor = activeOutline;
    float haloIntensity = 1.0f;
    if (heroBuildEnergy > 0.0f) {
        const float heat = heroBuildEnergy;
        const auto mix = [&](std::uint8_t from, std::uint8_t to) {
            return static_cast<std::uint8_t>(std::clamp(
                static_cast<float>(from)
                    + (static_cast<float>(to) - static_cast<float>(from)) * heat,
                0.0f, 255.0f));
        };
        haloColor = sf::Color(mix(activeOutline.r, buildGlow.peakColor.r),
                              mix(activeOutline.g, buildGlow.peakColor.g),
                              mix(activeOutline.b, buildGlow.peakColor.b));
        haloIntensity = 1.0f + buildGlow.intensityGain * heat;
    }
    for (int layer = theme.haloLayers; layer >= 1; --layer) {
        const float radius = heroRadius
            + static_cast<float>(layer * theme.haloRadiusStep);
        sf::CircleShape glow(radius, 32u);
        glow.setOrigin({radius, radius});
        glow.setPosition(position);
        // Squashed into a GROUND POOL rather than left as a disc. The hero's
        // position is its feet, so a full circle sat on top of the legs and
        // swallowed them — invisible with a sprite whose art filled the disc,
        // obvious once the hero became a standing figure with visible legs.
        // Light pooling on the floor also reads as the body casting it.
        glow.setScale({1.0f, heroLocatorYScale});
        sf::Color glowColor = haloColor;
        // Intensity multiplies INSIDE the clamp: applied after the cast, a
        // strong build would overflow the byte and wrap to a dark halo.
        glowColor.a = static_cast<std::uint8_t>(std::clamp(
            static_cast<float>(theme.haloAlphaBase) / static_cast<float>(layer + 1)
                * haloIntensity,
            0.0f, 255.0f));
        glow.setFillColor(glowColor);
        window.draw(glow);
    }

    if (hero.isEvasionGhostActive() && hero.evasionGhostDurationSeconds() > 0.0f) {
        const float duration  = hero.evasionGhostDurationSeconds();
        const float remaining = hero.evasionGhostRemainingSeconds();
        const float age       = duration - remaining;
        const sf::Color ghostOutline = computeGhostTrailColor(
            ghostStepOutline, age, duration, hero.evasionGhostInitialAlpha());

        drawHeroSprite(hero.evasionGhostOrigin(), ghostOutline);
    }

    drawHeroSprite(position, activeOutline);

    // card-dash-vfx — dash motion-streak: a row of bright cyan afterimages
    // strung between the dash start point and the hero's live position so a
    // dash reads as a loud streak, not a single faint ghost. Drawn AFTER the
    // halo + body so it is never occluded by the hero's own glow; the
    // afterimage AT the hero fades to ~zero alpha, so the body stays clean.
    // Brightest at the tail (origin), giving the streak a clear direction.
    if (hero.isDashing() && dashTrailImages > 0) {
        const sf::Vector2f origin = hero.evasionGhostOrigin();
        for (int image = 0; image < dashTrailImages; ++image) {
            const float t = static_cast<float>(image + 1)
                          / static_cast<float>(dashTrailImages + 1);
            const sf::Vector2f at = {origin.x + (position.x - origin.x) * t,
                                     origin.y + (position.y - origin.y) * t};
            sf::Color color = dashTrailColor;
            color.a = static_cast<std::uint8_t>(
                static_cast<float>(dashTrailColor.a) * (1.0f - t));
            drawHeroSprite(at, color);
        }
    }

    drawHeroLevelUpAura(window, hero, heroRadius, levelUpAuraParams,
                        currentInterpolationAlpha);
}

void WorldRenderer::drawHeroHealthbar(sf::RenderTarget& window, const dof::entities::Hero& hero) {
    const auto& damageable = hero.damageable();
    if (damageable.isDead()) return;
    const auto position = hero.moveable().interpolatedPosition(currentInterpolationAlpha);
    const float heroVisualTopExtent = std::max(heroRadius,
                                                heroSpriteSize * heroSpriteOriginYRatio);
    const auto rect = BarLayout::computeHeroBarRect(position, heroVisualTopExtent,
                                                    heroHpBarWidth, heroHpBarHeight, heroHpBarOffsetY);
    const sf::FloatRect barRect{{rect.x, rect.y}, {rect.width, rect.height}};

    ui::UiPanel panel;
    panel.background     = theme.hpBarBg;
    panel.border          = uiAccent.full();
    panel.borderThickness = uiAccent.thicknessOutline;
    panel.isPixelSnapped  = false;
    panel.draw(window, barRect);

    const float ratio = std::clamp(damageable.healthRatio(), 0.0f, 1.0f);
    sf::Color emptyFill = theme.hpBarBg;
    emptyFill.a = 180;
    segmentedBar.draw(window, barRect, ratio, healthRamp.colorFor(ratio), emptyFill);

}

void WorldRenderer::appendEnemyHealthbarChrome(sf::RenderTarget& window,
                                               ui::QuadBatch& batch,
                                               const dof::entities::Enemy& enemy,
                                               int) {
    const auto& damageable = enemy.damageable();
    const auto& deathable  = enemy.deathable();
    const float alphaScalar = deathable.isDead
                                  ? BarLayout::computeFadeAlpha(deathable.deathTimer, enemyDeathAnimDuration)
                                  : 1.0f;
    if (alphaScalar <= 0.0f) return;

    const float scale = tierVisualScale(enemy.tier(),
                                        enemyTierVisualScaleCommon,
                                        enemyTierVisualScaleUncommon,
                                        enemyTierVisualScaleRare);
    const auto position = enemy.moveable().interpolatedPosition(currentInterpolationAlpha);
    const auto rect = BarLayout::computeEnemyBarRect(position, enemyRadius, scale,
                                                     enemyHpBarWidth, enemyHpBarHeight, enemyHpBarOffsetY);
    const sf::FloatRect barRect{{rect.x, rect.y}, {rect.width, rect.height}};

    const auto withAlpha = [alphaScalar](sf::Color color) {
        color.a = static_cast<std::uint8_t>(std::clamp(static_cast<float>(color.a) * alphaScalar, 0.0f, 255.0f));
        return color;
    };

    const sf::Color panelFill = withAlpha(theme.hpBarBg);
    const sf::Color panelBorder = withAlpha(uiAccent.full());
    const float borderThickness = ui::clampedThickness(window, uiAccent.thicknessOutline);
    batch.addRect(barRect, panelFill);
    batch.addRect({barRect.position, {barRect.size.x, borderThickness}}, panelBorder);
    batch.addRect({{barRect.position.x, barRect.position.y + barRect.size.y - borderThickness},
                   {barRect.size.x, borderThickness}}, panelBorder);
    batch.addRect({{barRect.position.x, barRect.position.y + borderThickness},
                   {borderThickness, barRect.size.y - 2.0f * borderThickness}}, panelBorder);
    batch.addRect({{barRect.position.x + barRect.size.x - borderThickness,
                    barRect.position.y + borderThickness},
                   {borderThickness, barRect.size.y - 2.0f * borderThickness}}, panelBorder);

    const float ratio = std::clamp(damageable.healthRatio(), 0.0f, 1.0f);
    sf::Color emptyFill = theme.hpBarBg;
    emptyFill.a = 180;
    segmentedBar.appendTo(window, batch, barRect, ratio,
                          withAlpha(healthRamp.colorFor(ratio)), withAlpha(emptyFill));
    enemyInfoBar.appendChrome(window, batch, enemy, barRect, scale, alphaScalar);
}

void WorldRenderer::drawEnemyHealthbarForeground(sf::RenderTarget& window,
                                                 const dof::entities::Enemy& enemy,
                                                 int heroLevel) {
    const auto& deathable  = enemy.deathable();
    const float alphaScalar = deathable.isDead
                                  ? BarLayout::computeFadeAlpha(deathable.deathTimer, enemyDeathAnimDuration)
                                  : 1.0f;
    if (alphaScalar <= 0.0f) return;

    const float scale = tierVisualScale(enemy.tier(),
                                        enemyTierVisualScaleCommon,
                                        enemyTierVisualScaleUncommon,
                                        enemyTierVisualScaleRare);
    const auto position = enemy.moveable().interpolatedPosition(currentInterpolationAlpha);
    const auto rect = BarLayout::computeEnemyBarRect(position, enemyRadius, scale,
                                                     enemyHpBarWidth, enemyHpBarHeight, enemyHpBarOffsetY);
    const sf::FloatRect barRect{{rect.x, rect.y}, {rect.width, rect.height}};

    if (enemy.level() > heroLevel) {
        std::ostringstream threatOut;
        threatOut << "▲ +" << (enemy.level() - heroLevel);
        drawHealthbarLabel(window, font, threatOut.str(), hpBarLabelFontSize,
                           BarLayout::computeEnemyLevelLabelPosition(rect, enemyHpBarLevelLabelOffsetY),
                           sf::Color{255, 205, 55}, alphaScalar);
    }

    // Equipment section: weapon cards (or the unarmed body-charge bar)
    // stacked below the health bar.
    enemyInfoBar.drawForeground(window, enemy, barRect, scale, alphaScalar);
}

} // namespace dof::render
