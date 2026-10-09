#include "render/WorldRenderer.hpp"

#include "combat/DodgeSystem.hpp"
#include "core/WorldEnvironment.hpp"
#include "core/World.hpp"
#include "entities/Enemy.hpp"
#include "entities/FloorItem.hpp"
#include "entities/Hero.hpp"
#include "entities/QualityTier.hpp"
#include "entities/SpecialEnemyKind.hpp"
#include "loaders/ConfigLoader.hpp"
#include "loaders/ShaderLoader.hpp"
#include "hubs/EvasionHub.hpp"
#include "render/BarLayout.hpp"
#include "render/GhostTrail.hpp"
#include "render/UiAccent.hpp"
#include "render/Filigree.hpp"
#include "render/EnemySpawnPainter.hpp"
#include "render/FloorItemPainter.hpp"
#include "render/OutlineIntensity.hpp"
#include "render/TexturePreparation.hpp"
#include "render/YSort.hpp"

#include <SFML/Graphics/Shader.hpp>
#include <SFML/Graphics/Texture.hpp>
#include <SFML/Graphics/Image.hpp>
#include <SFML/Graphics/CircleShape.hpp>
#include <SFML/Graphics/ConvexShape.hpp>
#include <SFML/Graphics/RectangleShape.hpp>
#include <SFML/Graphics/RenderStates.hpp>
#include <SFML/Graphics/RenderWindow.hpp>
#include <SFML/Graphics/Sprite.hpp>
#include <SFML/Graphics/Text.hpp>
#include <SFML/Graphics/VertexArray.hpp>

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <limits>
#include <numbers>
#include <stdexcept>
#include <sstream>
#include <string>
#include <vector>

namespace dof::render {

namespace {

sf::Color withAlphaScaled(sf::Color color, float alphaScale) {
    color.a = static_cast<std::uint8_t>(
        std::clamp(static_cast<float>(color.a) * alphaScale, 0.0f, 255.0f));
    return color;
}

sf::Image makeAlphaOutlineImage(const sf::Image& source, int radius) {
    const auto size = source.getSize();
    sf::Image outline(size, sf::Color::Transparent);
    if (radius <= 0 || size.x == 0u || size.y == 0u) return outline;
    const int radiusSquared = radius * radius;
    for (unsigned y = 0; y < size.y; ++y) {
        for (unsigned x = 0; x < size.x; ++x) {
            if (source.getPixel({x, y}).a != 0u) continue;
            std::uint8_t alpha = 0u;
            for (int offsetY = -radius; offsetY <= radius; ++offsetY) {
                for (int offsetX = -radius; offsetX <= radius; ++offsetX) {
                    if (offsetX * offsetX + offsetY * offsetY > radiusSquared) {
                        continue;
                    }
                    const int sampleX = static_cast<int>(x) + offsetX;
                    const int sampleY = static_cast<int>(y) + offsetY;
                    if (sampleX < 0 || sampleY < 0
                        || sampleX >= static_cast<int>(size.x)
                        || sampleY >= static_cast<int>(size.y)) {
                        continue;
                    }
                    alpha = std::max(alpha, source.getPixel({
                        static_cast<unsigned>(sampleX),
                        static_cast<unsigned>(sampleY)}).a);
                }
            }
            if (alpha != 0u) outline.setPixel(
                {x, y}, sf::Color{255u, 255u, 255u, alpha});
        }
    }
    return outline;
}

// Ground grid — the floor has to read as a floor (visual_identity.md Step 1,
// re-scoped for the code-drawn world).
//
// Step 1 was originally "crush the photoreal ground so it stops competing".
// With no ground texture left there is nothing to crush, and the problem
// inverted: a flat fill gives the eye nothing, so actors read as floating in a
// void and — worse for a game about movement — there is no motion cue at all.
// A player sprinting across empty black cannot tell they are moving.
//
// A sparse grid in WORLD space fixes both. It says "surface" without adding a
// competing subject, and because the lines are anchored to world coordinates
// they slide past as the hero moves, restoring the sense of speed the flat fill
// destroyed. Major lines every Nth cell give a coarser rhythm so the eye can
// judge distance, not just motion.
void drawGroundGrid(sf::RenderTarget& target, const sf::FloatRect& viewRect,
                    const WorldGridParams& grid) {
    if (!grid.isEnabled || grid.spacing <= 0.0f) return;
    // Only emit lines inside the view. The world is unbounded, so anything else
    // would be an unbounded amount of geometry.
    const float left   = std::floor(viewRect.position.x / grid.spacing) * grid.spacing;
    const float top    = std::floor(viewRect.position.y / grid.spacing) * grid.spacing;
    const float right  = viewRect.position.x + viewRect.size.x;
    const float bottom = viewRect.position.y + viewRect.size.y;

    sf::VertexArray lines(sf::PrimitiveType::Lines);
    const auto lineColor = [&](long long cellIndex) {
        sf::Color color = grid.color;
        // A major line every Nth cell. Guard the modulo: majorEvery 0 would
        // divide by zero, and 1 would make every line major, flattening the
        // rhythm the two weights exist to create.
        const bool isMajor = grid.majorEvery > 1
            && (cellIndex % grid.majorEvery) == 0;
        color.a = static_cast<std::uint8_t>(std::clamp(
            (isMajor ? grid.majorAlpha : grid.minorAlpha) * grid.subordinateScale,
            0.0f, 255.0f));
        return color;
    };
    for (float x = left; x <= right; x += grid.spacing) {
        const auto cell = static_cast<long long>(std::llround(x / grid.spacing));
        const sf::Color color = lineColor(cell);
        lines.append(sf::Vertex{{x, viewRect.position.y}, color});
        lines.append(sf::Vertex{{x, bottom}, color});
    }
    for (float y = top; y <= bottom; y += grid.spacing) {
        const auto cell = static_cast<long long>(std::llround(y / grid.spacing));
        const sf::Color color = lineColor(cell);
        lines.append(sf::Vertex{{viewRect.position.x, y}, color});
        lines.append(sf::Vertex{{right, y}, color});
    }
    target.draw(lines);
}

float tierVisualScaleFor(const dof::entities::Enemy& enemy, const EnemyBodyParams& params) {
    if (enemy.tier() == dof::entities::QualityTier::Uncommon) return params.tierVisualScaleUncommon;
    if (enemy.tier() == dof::entities::QualityTier::Rare) return params.tierVisualScaleRare;
    return params.tierVisualScaleCommon;
}

sf::Color outlineFor(const dof::entities::Enemy& enemy, const EnemyBodyParams& params) {
    if (enemy.tier() == dof::entities::QualityTier::Uncommon) return params.outlineUncommon;
    if (enemy.tier() == dof::entities::QualityTier::Rare) return params.outlineRare;
    return params.outlineCommon;
}

sf::Color fillFor(const dof::entities::Enemy& enemy, const EnemyBodyParams& params) {
    sf::Color fill = params.bodyFill;
    switch (enemy.specialKind()) {
        case dof::entities::SpecialEnemyKind::None: break;
        case dof::entities::SpecialEnemyKind::Shocker: fill = params.shockerBody; break;
        case dof::entities::SpecialEnemyKind::Hexarchon: fill = params.hexarchonBody; break;
        case dof::entities::SpecialEnemyKind::Voidcrawler: fill = params.voidcrawlerBody; break;
        case dof::entities::SpecialEnemyKind::Glasswraith: fill = params.glasswraithBody; break;
        case dof::entities::SpecialEnemyKind::TassideanSentinel: fill = params.sentinelBody; break;
        case dof::entities::SpecialEnemyKind::PactWalker: fill = params.pactwalkerBody; break;
    }
    return fill;
}

void addDisc(ui::QuadBatch& batch, sf::Vector2f centre, float radius, int sides, sf::Color color) {
    if (radius <= 0.0f) return;
    const int safeSides = std::max(3, sides);
    const float step = 2.0f * std::numbers::pi_v<float> / static_cast<float>(safeSides);
    for (int i = 0; i < safeSides; ++i) {
        const float a0 = static_cast<float>(i) * step;
        const float a1 = static_cast<float>(i + 1) * step;
        batch.addTriangle(centre,
                          {centre.x + std::cos(a0) * radius, centre.y + std::sin(a0) * radius},
                          {centre.x + std::cos(a1) * radius, centre.y + std::sin(a1) * radius}, color);
    }
}

void appendEnemyBodyLod(ui::QuadBatch& batch, const dof::entities::Enemy& enemy,
                        const EnemyBodyParams& params, int circleSides, int maxHaloLayers) {
    const SpawnInFactors spawn = computeSpawnInFactors(enemy, params);
    const sf::Vector2f position = enemy.moveable().interpolatedPosition(
        params.interpolationAlpha);
    const float scaledRadius = params.enemyRadius * tierVisualScaleFor(enemy, params);
    const sf::Color outline = outlineFor(enemy, params);
    float auraRadiusMult = params.auraRadiusCommon;
    float auraAlphaMult = params.auraAlphaCommon;
    float bodyBrightness = params.bodyBrightnessCommon;
    if (enemy.tier() == dof::entities::QualityTier::Uncommon) {
        auraRadiusMult = params.auraRadiusUncommon; auraAlphaMult = params.auraAlphaUncommon;
        bodyBrightness = params.bodyBrightnessUncommon;
    } else if (enemy.tier() == dof::entities::QualityTier::Rare) {
        auraRadiusMult = params.auraRadiusRare; auraAlphaMult = params.auraAlphaRare;
        bodyBrightness = params.bodyBrightnessRare;
    }
    const int haloLayers = std::min(params.haloLayers, std::max(0, maxHaloLayers));
    for (int layer = haloLayers; layer >= 1; --layer) {
        const float radius = scaledRadius + static_cast<float>(layer * params.haloRadiusStep) * auraRadiusMult;
        sf::Color glowColor = outline;
        glowColor.a = static_cast<std::uint8_t>(std::clamp(
            static_cast<float>(params.haloAlphaBase) / static_cast<float>(layer + 1)
                * auraAlphaMult * spawn.fade, 0.0f, 255.0f));
        addDisc(batch, position, radius, circleSides, glowColor);
    }
    if (maxHaloLayers == 0) {
        sf::Color swarmFill = fillFor(enemy, params);
        swarmFill.r = static_cast<std::uint8_t>(std::clamp(
            static_cast<float>(swarmFill.r) * bodyBrightness, 0.0f, 255.0f));
        swarmFill.g = static_cast<std::uint8_t>(std::clamp(
            static_cast<float>(swarmFill.g) * bodyBrightness, 0.0f, 255.0f));
        swarmFill.b = static_cast<std::uint8_t>(std::clamp(
            static_cast<float>(swarmFill.b) * bodyBrightness, 0.0f, 255.0f));
        addDisc(batch, position, scaledRadius, circleSides,
                withAlphaScaled(swarmFill, spawn.fade));
        return;
    }
    addDisc(batch, position, scaledRadius + std::max(0.0f, static_cast<float>(params.haloThickness)),
            circleSides, withAlphaScaled(outline, spawn.fade));
    sf::Color fill = fillFor(enemy, params);
    fill.r = static_cast<std::uint8_t>(std::clamp(static_cast<float>(fill.r) * bodyBrightness, 0.0f, 255.0f));
    fill.g = static_cast<std::uint8_t>(std::clamp(static_cast<float>(fill.g) * bodyBrightness, 0.0f, 255.0f));
    fill.b = static_cast<std::uint8_t>(std::clamp(static_cast<float>(fill.b) * bodyBrightness, 0.0f, 255.0f));
    addDisc(batch, position, scaledRadius, circleSides, withAlphaScaled(fill, spawn.fade));
}

}  // namespace

WorldRenderer::WorldRenderer(const dof::loaders::ConfigLoader& config,
                             const ColorTheme& themeInit,
                             const sf::Font& fontInit,
                             const dof::loaders::ShaderLoader* shaders,
                             std::uint64_t startupSeed,
                             const dof::core::WorldEnvironment& environment)
    : theme(themeInit), configRef(config), font(fontInit), enemyInfoBar(config),
      environmentRenderer(config, environment), shadersPtr(shaders) {
    blinkCycleSeconds = config.getFloat("ITEM_BLINK_CYCLE_SECONDS");
    blinkAlphaBase    = config.getFloat("ITEM_BLINK_ALPHA_BASE");
    blinkAlphaAmp     = config.getFloat("ITEM_BLINK_ALPHA_AMP");
    heroRadius        = config.getFloat("HERO_COLLISION_RADIUS");
    enemyRadius       = config.getFloat("ENEMY_COLLISION_RADIUS");
    heroHpBarWidth    = config.getFloat("HERO_HP_BAR_WIDTH");
    heroHpBarHeight   = config.getFloat("HERO_HP_BAR_HEIGHT");
    heroHpBarOffsetY  = config.getFloat("HERO_HP_BAR_OFFSET_Y");
    heroLocatorRadiusMultiplier = config.getFloat(
        "HERO_LOCATOR_RADIUS_MULTIPLIER");
    heroLocatorYScale = config.getFloat("HERO_LOCATOR_Y_SCALE");
    heroLocatorAlpha = config.getInt("HERO_LOCATOR_ALPHA");
    enemyHpBarWidth   = config.getFloat("ENEMY_HP_BAR_WIDTH");
    enemyHpBarHeight  = config.getFloat("ENEMY_HP_BAR_HEIGHT");
    enemyHpBarOffsetY = config.getFloat("ENEMY_HP_BAR_OFFSET_Y");
    enemyTierVisualScaleCommon   = config.getFloat("ENEMY_TIER_VISUAL_SCALE_COMMON");
    enemyTierVisualScaleUncommon = config.getFloat("ENEMY_TIER_VISUAL_SCALE_UNCOMMON");
    enemyTierVisualScaleRare     = config.getFloat("ENEMY_TIER_VISUAL_SCALE_RARE");
    enemyDeathAnimDuration       = config.getFloat("ENEMY_DEATH_ANIM_DURATION");
    enemyHpBarLevelLabelOffsetY  = config.getFloat("ENEMY_HP_BAR_LEVEL_LABEL_OFFSET_Y");
    hpBarLabelFontSize           = config.getFloat("UI_FONT_SIZE_SMALL");
    enemyOverlayChromeMaxVisible = config.getInt("ENEMY_OVERLAY_CHROME_MAX_VISIBLE");
    enemyOverlayTextMaxVisible   = config.getInt("ENEMY_OVERLAY_TEXT_MAX_VISIBLE");
    enemyBodyLodMinVisible       = config.getInt("ENEMY_BODY_LOD_MIN_VISIBLE");
    enemyBodyLodCircleSides      = config.getInt("ENEMY_BODY_LOD_CIRCLE_SIDES");
    enemyBodyLodHaloLayers       = config.getInt("ENEMY_BODY_LOD_HALO_LAYERS");
    viewCullPadding              = config.getFloat("THEME_VIEW_CULL_PADDING");
    enemyBodyParams              = loadEnemyBodyParams(config, themeInit);
    // Per-enemy-type design: the shape catalogue (shared SHAPE_NN_* keys in
    // the global config) plus every enemy template under the configured
    // directory. The live body painter reads these so a saved editor change
    // shows up on already-spawned enemies the next frame.
    enemyShapeCatalog            = loadEnemyShapeCatalog(config);
    enemyTemplates.loadDirectory(config.getString("ENEMY_TEMPLATE_DIR"));
    levelUpAuraParams            = loadLevelUpAuraParams(config);
    healthRamp = HealthRamp::loadFromConfig(config);
    uiAccent   = UiAccent::loadFromConfig(config);
    outlineIntensity = loadOutlineIntensityParams(config);
    filigreeParams   = loadFiligreeParams(config);
    buildGlow.isEnabled = config.getInt("HERO_BUILD_GLOW_ENABLE") != 0;
    buildGlow.luckReference = std::max(1.0f,
        config.getFloat("HERO_BUILD_GLOW_LUCK_REFERENCE"));
    buildGlow.gamma = std::max(0.01f, config.getFloat("HERO_BUILD_GLOW_GAMMA"));
    buildGlow.peakColor = sf::Color{
        static_cast<std::uint8_t>(config.getInt("HERO_BUILD_GLOW_PEAK_R")),
        static_cast<std::uint8_t>(config.getInt("HERO_BUILD_GLOW_PEAK_G")),
        static_cast<std::uint8_t>(config.getInt("HERO_BUILD_GLOW_PEAK_B"))};
    buildGlow.intensityGain = config.getFloat("HERO_BUILD_GLOW_INTENSITY_GAIN");
    heroSquashStrength = config.getFloat("HERO_HIT_SQUASH_STRENGTH");
    worldGrid.isEnabled = config.getInt("WORLD_NEON_GRID_ENABLE") != 0;
    worldGrid.spacing   = config.getFloat("WORLD_NEON_GRID_SPACING");
    worldGrid.majorEvery = config.getInt("WORLD_NEON_GRID_MAJOR_EVERY");
    worldGrid.minorAlpha = config.getFloat("WORLD_NEON_GRID_MINOR_ALPHA");
    worldGrid.majorAlpha = config.getFloat("WORLD_NEON_GRID_MAJOR_ALPHA");
    worldGrid.subordinateScale = config.getFloat("WORLD_NEON_SUBORDINATE_SCALE");
    worldGrid.color = sf::Color{
        static_cast<std::uint8_t>(config.getInt("WORLD_NEON_GRID_R")),
        static_cast<std::uint8_t>(config.getInt("WORLD_NEON_GRID_G")),
        static_cast<std::uint8_t>(config.getInt("WORLD_NEON_GRID_B"))};
    worldGroundColor = sf::Color{
        static_cast<std::uint8_t>(config.getInt("WORLD_NEON_GROUND_R")),
        static_cast<std::uint8_t>(config.getInt("WORLD_NEON_GROUND_G")),
        static_cast<std::uint8_t>(config.getInt("WORLD_NEON_GROUND_B"))};
    ghostStepOutline  = sf::Color{
        static_cast<std::uint8_t>(config.getInt("GHOST_TRAIL_OUTLINE_R")),
        static_cast<std::uint8_t>(config.getInt("GHOST_TRAIL_OUTLINE_G")),
        static_cast<std::uint8_t>(config.getInt("GHOST_TRAIL_OUTLINE_B"))};
    enemyDashGhostColor = sf::Color{
        static_cast<std::uint8_t>(config.getInt("ENEMY_DASH_GHOST_COLOR_R")),
        static_cast<std::uint8_t>(config.getInt("ENEMY_DASH_GHOST_COLOR_G")),
        static_cast<std::uint8_t>(config.getInt("ENEMY_DASH_GHOST_COLOR_B"))};
    // card-dash-vfx — dash motion-streak afterimage colour + count.
    dashTrailImages = config.getInt("DODGE_DASH_TRAIL_IMAGES");
    dashTrailColor  = sf::Color{
        static_cast<std::uint8_t>(config.getInt("DODGE_DASH_TRAIL_R")),
        static_cast<std::uint8_t>(config.getInt("DODGE_DASH_TRAIL_G")),
        static_cast<std::uint8_t>(config.getInt("DODGE_DASH_TRAIL_B")),
        static_cast<std::uint8_t>(config.getInt("DODGE_DASH_TRAIL_ALPHA"))};
    segmentedBar = ui::UiSegmentedBar::loadFromConfig(config);

    // The hero is code-drawn (see drawHeroBody), so the whole sprite-atlas load
    // is gone: no PNG, no chroma key, no 64-cell foot-registration scan, and no
    // CPU alpha-dilation pass to bake a rim texture. The rim is now an inward
    // outline, exactly as an enemy body draws one.
    heroSpriteSize      = config.getFloat("HERO_BODY_SIZE");
    heroSpriteOriginYRatio = config.getFloat("HERO_BODY_ORIGIN_Y_RATIO");
    heroShapeRotationOffsetDegrees =
        config.getFloat("HERO_BODY_ROTATION_OFFSET_DEG");
    heroRimRatio        = config.getFloat("HERO_BODY_RIM_RATIO");
    heroFormScale       = config.getFloat("HERO_FORM_SCALE");
    heroFormIndex       = config.getInt("HERO_FORM");
    heroFillColor       = sf::Color{
        static_cast<std::uint8_t>(config.getInt("HERO_FILL_R")),
        static_cast<std::uint8_t>(config.getInt("HERO_FILL_G")),
        static_cast<std::uint8_t>(config.getInt("HERO_FILL_B"))};
}

void WorldRenderer::setEvasionHub(const dof::hubs::EvasionHub& evasionHub) {
    evasionHubPtr = &evasionHub;
}

void WorldRenderer::setLuckHub(const dof::hubs::LuckHub& luckHub) {
    luckHubPtr = &luckHub;
}

void WorldRenderer::setDodgeSystem(const dof::combat::DodgeSystem& dodgeSystem) {
    dodgeSystemPtr = &dodgeSystem;
}

void WorldRenderer::render(sf::RenderTarget& window, const dof::core::World& world,
                           const sf::View& worldView, float simSeconds,
                           float interpolationAlpha) {
    currentInterpolationAlpha = std::clamp(interpolationAlpha, 0.0f, 1.0f);
    currentSimSeconds = simSeconds;
    enemyBodyParams.interpolationAlpha = currentInterpolationAlpha;
    window.setView(worldView);

    // §Render Order L334: solid black background before all world-space entities.
    // The code-drawn world has no ground texture, so this clear IS the ground.
    // It was a hard-coded black, which both violated the no-hard-coded-values
    // rule and made the one surface covering the whole screen the only thing in
    // the game nobody could tune.
    window.clear(worldGroundColor);

    const sf::FloatRect baseViewRect{
        {worldView.getCenter().x - worldView.getSize().x / 2.0f,
         worldView.getCenter().y - worldView.getSize().y / 2.0f},
        worldView.getSize()};
    const sf::FloatRect cullRect = padViewRect(baseViewRect, viewCullPadding);
    // Under everything: the grid is the ground surface, not an overlay.
    drawGroundGrid(window, baseViewRect, worldGrid);
    environmentRenderer.drawGround(window, std::numeric_limits<int>::min(),
                                   std::numeric_limits<int>::max());

    std::vector<WorldDrawableEntry> drawables;
    std::vector<std::size_t> visibleEnemyIndices;
    std::size_t insertionIndex = 0;

    const auto& environmentStamps = environmentRenderer.environment().state().stamps;
    const float stampLayerYBias = configRef.getFloat("WORLD_EDITOR_LAYER_Y_BIAS");
    for (std::size_t stampIndex = 0; stampIndex < environmentStamps.size(); ++stampIndex) {
        const auto& stamp = environmentStamps[stampIndex];
        if (stamp.layer < 0) continue;
        const float cullRadius = environmentRenderer.stampCullRadius(stampIndex);
        if (!isWithinViewRect(cullRect, stamp.position, cullRadius)) continue;
        drawables.push_back({stamp.position.y
                                 + static_cast<float>(stamp.layer) * stampLayerYBias,
                             insertionIndex++,
                             WorldDrawableKind::EnvironmentStamp,
                             stampIndex});
    }

    const auto& floorItems = world.floorItems();
    for (std::size_t itemIndex = 0; itemIndex < floorItems.size(); ++itemIndex) {
        const auto& floorItem = floorItems[itemIndex];
        if (!floorItem || floorItem->pickupable().isPickedUp) continue;
        const auto position = floorItem->position();
        if (!isWithinViewRect(cullRect, position, /*paddedRadius*/ 0.0f)) continue;
        drawables.push_back({computeYSortKeyFloor(position),
                             insertionIndex++,
                             WorldDrawableKind::FloorItem,
                             itemIndex});
    }

    const auto& enemies = world.enemies();
    for (std::size_t enemyIndex = 0; enemyIndex < enemies.size(); ++enemyIndex) {
        const auto& enemy = enemies[enemyIndex];
        if (!enemy) continue;
        const auto position = enemy->moveable().interpolatedPosition(currentInterpolationAlpha);
        if (!isWithinViewRect(cullRect, position, enemyRadius)) continue;
        visibleEnemyIndices.push_back(enemyIndex);
        const WorldDrawableKind kind = enemy->deathable().isDead
                                           ? WorldDrawableKind::EnemyDeathExplosion
                                           : WorldDrawableKind::EnemyBody;
        drawables.push_back({computeYSortKeyFeetBody(position, enemyRadius),
                             insertionIndex++,
                             kind,
                             enemyIndex});
    }

    {
        const auto& hero = world.hero();
        const auto position = hero.moveable().interpolatedPosition(currentInterpolationAlpha);
        if (isWithinViewRect(cullRect, position, heroRadius)) {
            drawables.push_back({computeYSortKeyFeetBody(position, heroRadius),
                                 insertionIndex++,
                                 WorldDrawableKind::HeroBody,
                                 /*sourceIndex*/ 0});
        }
    }

    sortDrawablesByFeetY(drawables);

    enemyBodyParams.enemyShader  = shadersPtr ? const_cast<sf::Shader*>(shadersPtr->getShader("enemy")) : nullptr;
    enemyBodyParams.shapeShaders = &shapeShaders;
    enemyBodyParams.attackFlashDuration    = configRef.getFloat("ENEMY_ATTACK_FLASH_DURATION");
    enemyBodyParams.attackFlashStartRadius = configRef.getFloat("ENEMY_ATTACK_FLASH_START_RADIUS");
    enemyBodyParams.attackFlashEndRadius   = configRef.getFloat("ENEMY_ATTACK_FLASH_END_RADIUS");
    enemyBodyParams.attackFlashStartAlpha  = configRef.getFloat("ENEMY_ATTACK_FLASH_START_ALPHA");

    const FloorItemPainterParams floorItemPainterParams{
        blinkCycleSeconds, blinkAlphaBase, blinkAlphaAmp,
        &shapeShaders,
        shadersPtr ? const_cast<sf::Shader*>(shadersPtr->getShader("die"))    : nullptr,
        &font,
        &enemyShapeCatalog,
        heroRimRatio};
    const bool useEnemyBodyLod = enemyBodyLodMinVisible > 0
                              && visibleEnemyIndices.size() >= static_cast<std::size_t>(enemyBodyLodMinVisible);
    ui::QuadBatch enemyBodyLodBatch;
    auto flushEnemyBodyLod = [&]() { enemyBodyLodBatch.flush(window); };
    for (const auto& entry : drawables) {
        switch (entry.kind) {
            case WorldDrawableKind::EnvironmentStamp:
                flushEnemyBodyLod();
                environmentRenderer.drawStamp(window, entry.sourceIndex);
                break;
            case WorldDrawableKind::FloorItem:
                flushEnemyBodyLod();
                drawFloorItemBody(window, *floorItems[entry.sourceIndex], simSeconds,
                                  floorItemPainterParams, theme, configRef);
                break;
            case WorldDrawableKind::EnemyBody: {
                const dof::entities::Enemy& bodyEnemy = *enemies[entry.sourceIndex];
                if (useEnemyBodyLod) {
                    appendEnemyBodyLod(enemyBodyLodBatch, bodyEnemy, enemyBodyParams,
                                       enemyBodyLodCircleSides, enemyBodyLodHaloLayers);
                } else {
                    flushEnemyBodyLod();
                    drawEnemySpawnPortal(window, bodyEnemy, enemyBodyParams);
                    const dof::entities::EnemyTemplate* tmpl =
                        bodyEnemy.specialKind() == dof::entities::SpecialEnemyKind::None
                            ? nullptr : enemyTemplates.findBySpecialKind(bodyEnemy.specialKind());
                    drawEnemyBody(window, bodyEnemy, enemyBodyParams,
                                  tmpl, enemyShapeCatalog, shadersPtr, simSeconds);
                }
                break;
            }
            case WorldDrawableKind::EnemyDeathExplosion:
                flushEnemyBodyLod();
                drawEnemyDeathExplosion(window, *enemies[entry.sourceIndex], enemyBodyParams);
                break;
            case WorldDrawableKind::HeroBody:
                flushEnemyBodyLod();
                drawHeroBody(window, world);
                break;
        }
    }
    flushEnemyBodyLod();

    const sf::Vector2f heroPosition = world.hero().moveable().interpolatedPosition(currentInterpolationAlpha);
    const sf::Color armedTelegraphBase{
        static_cast<std::uint8_t>(configRef.getInt("ENEMY_ARMED_TELEGRAPH_R")),
        static_cast<std::uint8_t>(configRef.getInt("ENEMY_ARMED_TELEGRAPH_G")),
        static_cast<std::uint8_t>(configRef.getInt("ENEMY_ARMED_TELEGRAPH_B"))};
    const float telegraphAlphaMin = configRef.getFloat("ENEMY_ARMED_TELEGRAPH_ALPHA_MIN");
    const float telegraphAlphaMax = configRef.getFloat("ENEMY_ARMED_TELEGRAPH_ALPHA_MAX");
    const float telegraphRingStart = configRef.getFloat("ENEMY_ARMED_TELEGRAPH_RING_START_RADIUS");
    const float telegraphRingEnd = configRef.getFloat("ENEMY_ARMED_TELEGRAPH_RING_END_RADIUS");
    const float telegraphRingThickness = configRef.getFloat("ENEMY_ARMED_TELEGRAPH_RING_THICKNESS");
    int windingEnemyCount = 0;
    for (const std::size_t enemyIndex : visibleEnemyIndices) {
        if (enemies[enemyIndex]->loadout().isArmedAttackWindingUp()) ++windingEnemyCount;
    }
    const int priorityThreshold = configRef.getInt("ENEMY_ARMED_TELEGRAPH_PRIORITY_THRESHOLD");
    for (const std::size_t enemyIndex : visibleEnemyIndices) {
        const auto& enemy = *enemies[enemyIndex];
        const auto& loadout = enemy.loadout();
        if (!loadout.isArmedAttackWindingUp()) continue;
        const float progress = std::clamp(loadout.armedAttackWindupProgress(), 0.0f, 1.0f);
        sf::Color danger = armedTelegraphBase;
        danger.a = static_cast<std::uint8_t>(std::clamp(
            telegraphAlphaMin + (telegraphAlphaMax - telegraphAlphaMin) * progress,
            0.0f, 255.0f));
        if (priorityThreshold > 0 && windingEnemyCount > priorityThreshold) {
            const bool isPriority = enemy.isElite()
                                 || enemy.specialKind() != dof::entities::SpecialEnemyKind::None;
            const float alphaMult = configRef.getFloat(isPriority
                ? "ENEMY_ARMED_TELEGRAPH_ELITE_ALPHA_MULT"
                : "ENEMY_ARMED_TELEGRAPH_COMMON_ALPHA_MULT");
            danger.a = static_cast<std::uint8_t>(std::clamp(
                static_cast<float>(danger.a) * alphaMult, 0.0f, 255.0f));
        }
        const sf::Vector2f origin = enemy.moveable().interpolatedPosition(currentInterpolationAlpha);
        const float attackRange = loadout.armedAttackRange();
        if (attackRange > 0.0f) {
            sf::Color rangeColor = danger;
            rangeColor.a = static_cast<std::uint8_t>(std::clamp(
                static_cast<float>(rangeColor.a)
                    * configRef.getFloat("ENEMY_ARMED_TELEGRAPH_RANGE_ALPHA_MULT"),
                0.0f, 255.0f));
            sf::CircleShape rangeBoundary(attackRange, 72);
            rangeBoundary.setOrigin({attackRange, attackRange});
            rangeBoundary.setPosition(origin);
            rangeBoundary.setFillColor(sf::Color::Transparent);
            rangeBoundary.setOutlineThickness(
                configRef.getFloat("ENEMY_ARMED_TELEGRAPH_RANGE_THICKNESS"));
            rangeBoundary.setOutlineColor(rangeColor);
            window.draw(rangeBoundary);
        }

        const sf::Vector2f toHero{heroPosition.x - origin.x, heroPosition.y - origin.y};
        const float heroDistance = std::sqrt(toHero.x * toHero.x + toHero.y * toHero.y);
        if (heroDistance > 0.0f) {
            sf::Color linkColor = danger;
            linkColor.a = static_cast<std::uint8_t>(std::clamp(
                static_cast<float>(linkColor.a)
                    * configRef.getFloat("ENEMY_ARMED_TELEGRAPH_LINK_ALPHA_MULT"),
                0.0f, 255.0f));
            const float linkWidth = configRef.getFloat("ENEMY_ARMED_TELEGRAPH_LINK_WIDTH");
            sf::RectangleShape link({heroDistance, linkWidth});
            link.setOrigin({0.0f, linkWidth * 0.5f});
            link.setPosition(origin);
            link.setRotation(sf::radians(std::atan2(toHero.y, toHero.x)));
            link.setFillColor(linkColor);
            window.draw(link);
        }
        const float radius = telegraphRingStart
                           + (telegraphRingEnd - telegraphRingStart) * progress;
        sf::CircleShape ring(radius, 40);
        ring.setOrigin({radius, radius});
        // The hit contract targets the hero's live centre, so the warning
        // closes on that exact point rather than decorating the attacker.
        ring.setPosition(heroPosition);
        ring.setFillColor(sf::Color::Transparent);
        ring.setOutlineThickness(telegraphRingThickness);
        ring.setOutlineColor(danger);
        window.draw(ring);

        const float attackerRadius = configRef.getFloat("ENEMY_ARMED_TELEGRAPH_ATTACKER_RADIUS");
        sf::CircleShape attackerRing(attackerRadius, 28);
        attackerRing.setOrigin({attackerRadius, attackerRadius});
        attackerRing.setPosition(origin);
        attackerRing.setFillColor(sf::Color{danger.r, danger.g, danger.b,
            static_cast<std::uint8_t>(static_cast<float>(danger.a) * 0.18f)});
        attackerRing.setOutlineThickness(telegraphRingThickness);
        attackerRing.setOutlineColor(danger);
        window.draw(attackerRing);

    }

    const sf::Color dashTelegraphBase{
        static_cast<std::uint8_t>(configRef.getInt("ENEMY_DASH_TELEGRAPH_R")),
        static_cast<std::uint8_t>(configRef.getInt("ENEMY_DASH_TELEGRAPH_G")),
        static_cast<std::uint8_t>(configRef.getInt("ENEMY_DASH_TELEGRAPH_B"))};

    // The unarmed charge continuously retargets the live hero until launch,
    // so this lane follows that target and shows the exact travel distance and
    // contact radius used by the committed dash. The compact bar above the
    // enemy communicates when it will launch; this geometry communicates where.
    for (const std::size_t enemyIndex : visibleEnemyIndices) {
        const auto& enemy = *enemies[enemyIndex];
        const auto& loadout = enemy.loadout();
        if (loadout.isArmed()
            || loadout.chargePhase() != dof::abilities::ChargePhase::WindUp) continue;

        const float progress = std::clamp(loadout.bodyCharge().progress(), 0.0f, 1.0f);
        sf::Color danger = dashTelegraphBase;
        danger.a = static_cast<std::uint8_t>(std::clamp(
            configRef.getFloat("ENEMY_DASH_TELEGRAPH_ALPHA_MIN")
                + (configRef.getFloat("ENEMY_DASH_TELEGRAPH_ALPHA_MAX")
                   - configRef.getFloat("ENEMY_DASH_TELEGRAPH_ALPHA_MIN")) * progress,
            0.0f, 255.0f));

        const sf::Vector2f origin = enemy.moveable().interpolatedPosition(currentInterpolationAlpha);
        const sf::Vector2f delta{heroPosition.x - origin.x, heroPosition.y - origin.y};
        const float targetDistance = std::sqrt(delta.x * delta.x + delta.y * delta.y);
        if (targetDistance <= 0.0f) continue;
        const sf::Vector2f direction{delta.x / targetDistance, delta.y / targetDistance};
        const float reach = configRef.getFloat("ENEMY_CHARGE_DASH_SPEED")
                          * configRef.getFloat("ENEMY_CHARGE_DASH_SECONDS");
        const float contactRadius = configRef.getFloat("ENEMY_DASH_CONTACT_RADIUS");
        const float laneWidth = contactRadius * 2.0f;

        sf::RectangleShape lane({reach, laneWidth});
        lane.setOrigin({0.0f, laneWidth * 0.5f});
        lane.setPosition(origin);
        lane.setRotation(sf::radians(std::atan2(direction.y, direction.x)));
        lane.setFillColor(sf::Color{danger.r, danger.g, danger.b,
            static_cast<std::uint8_t>(static_cast<float>(danger.a) * 0.16f)});
        lane.setOutlineColor(danger);
        lane.setOutlineThickness(configRef.getFloat("ENEMY_DASH_TELEGRAPH_THICKNESS"));
        window.draw(lane);

        const sf::Vector2f endpoint{origin.x + direction.x * reach,
                                    origin.y + direction.y * reach};
        sf::CircleShape contact(contactRadius, 36);
        contact.setOrigin({contactRadius, contactRadius});
        contact.setPosition(endpoint);
        contact.setFillColor(sf::Color{danger.r, danger.g, danger.b,
            static_cast<std::uint8_t>(static_cast<float>(danger.a) * 0.12f)});
        contact.setOutlineColor(danger);
        contact.setOutlineThickness(configRef.getFloat("ENEMY_DASH_TELEGRAPH_THICKNESS"));
        window.draw(contact);
    }

    for (const std::size_t enemyIndex : visibleEnemyIndices) {
        const auto& enemy = *enemies[enemyIndex];
        const auto& mind = enemy.mind();
        if (!mind.isOffensiveDashTelegraphing) continue;

        const float progress = mind.offensiveDashTelegraphTotal > 0.0f
            ? std::clamp(1.0f - mind.offensiveDashTelegraphTimer
                                / mind.offensiveDashTelegraphTotal, 0.0f, 1.0f)
            : 1.0f;
        sf::Color danger = dashTelegraphBase;
        danger.a = static_cast<std::uint8_t>(std::clamp(
            configRef.getFloat("ENEMY_DASH_TELEGRAPH_ALPHA_MIN")
                + (configRef.getFloat("ENEMY_DASH_TELEGRAPH_ALPHA_MAX")
                   - configRef.getFloat("ENEMY_DASH_TELEGRAPH_ALPHA_MIN")) * progress,
            0.0f, 255.0f));

        const sf::Vector2f origin = enemy.moveable().interpolatedPosition(currentInterpolationAlpha);
        const sf::Vector2f delta{mind.offensiveDashTargetPos.x - origin.x,
                                 mind.offensiveDashTargetPos.y - origin.y};
        const float targetDistance = std::sqrt(delta.x * delta.x + delta.y * delta.y);
        if (targetDistance <= 0.0f || mind.offensiveDashReach <= 0.0f) continue;
        const sf::Vector2f direction{delta.x / targetDistance, delta.y / targetDistance};
        const bool isDamagingDash = mind.offensiveDashContactRadius > 0.0f;
        const float laneWidth = isDamagingDash
            ? mind.offensiveDashContactRadius * 2.0f
            : configRef.getFloat("ENEMY_DASH_TELEGRAPH_MOVEMENT_WIDTH");
        sf::RectangleShape lane({mind.offensiveDashReach, laneWidth});
        lane.setOrigin({0.0f, laneWidth * 0.5f});
        lane.setPosition(origin);
        lane.setRotation(sf::radians(std::atan2(direction.y, direction.x)));
        lane.setFillColor(sf::Color{danger.r, danger.g, danger.b,
            static_cast<std::uint8_t>(static_cast<float>(danger.a) * 0.16f)});
        lane.setOutlineColor(danger);
        lane.setOutlineThickness(configRef.getFloat("ENEMY_DASH_TELEGRAPH_THICKNESS"));
        window.draw(lane);

        const sf::Vector2f endpoint{origin.x + direction.x * mind.offensiveDashReach,
                                    origin.y + direction.y * mind.offensiveDashReach};
        const float endpointRadius = isDamagingDash
            ? mind.offensiveDashContactRadius
            : configRef.getFloat("ENEMY_DASH_TELEGRAPH_MOVEMENT_ENDPOINT_RADIUS");
        sf::CircleShape contact(endpointRadius, 36);
        contact.setOrigin({endpointRadius, endpointRadius});
        contact.setPosition(endpoint);
        contact.setFillColor(sf::Color{danger.r, danger.g, danger.b,
            static_cast<std::uint8_t>(static_cast<float>(danger.a) * 0.12f)});
        contact.setOutlineColor(danger);
        contact.setOutlineThickness(configRef.getFloat("ENEMY_DASH_TELEGRAPH_THICKNESS"));
        window.draw(contact);
    }

    const float incomingAttack = world.hero().incomingAttackFlash();
    if (incomingAttack > 0.0f) {
        const float startRadius = configRef.getFloat("HERO_INCOMING_ATTACK_RING_START_RADIUS");
        const float endRadius = configRef.getFloat("HERO_INCOMING_ATTACK_RING_END_RADIUS");
        const float radius = endRadius + (startRadius - endRadius) * incomingAttack;
        sf::CircleShape ring(radius, 40);
        ring.setOrigin({radius, radius});
        ring.setPosition(heroPosition);
        ring.setFillColor(sf::Color{255, 130, 20,
            static_cast<std::uint8_t>(35.0f * incomingAttack)});
        ring.setOutlineColor(sf::Color{255, 190, 45,
            static_cast<std::uint8_t>(235.0f * incomingAttack)});
        ring.setOutlineThickness(configRef.getFloat("HERO_INCOMING_ATTACK_RING_THICKNESS"));
        window.draw(ring);

        const int tickCount = std::min(world.hero().incomingAttackCount(),
                                       configRef.getInt("HERO_INCOMING_ATTACK_TICK_MAX"));
        const float tickLength = configRef.getFloat("HERO_INCOMING_ATTACK_TICK_LENGTH");
        const float tickWidth = configRef.getFloat("HERO_INCOMING_ATTACK_TICK_WIDTH");
        for (int tick = 0; tick < tickCount; ++tick) {
            const float angle = static_cast<float>(tick) / static_cast<float>(std::max(1, tickCount))
                              * 6.2831853f;
            const sf::Vector2f direction{std::cos(angle), std::sin(angle)};
            sf::RectangleShape mark({tickLength, tickWidth});
            mark.setOrigin({0.0f, tickWidth * 0.5f});
            mark.setPosition({heroPosition.x + direction.x * radius,
                              heroPosition.y + direction.y * radius});
            mark.setRotation(sf::radians(angle));
            mark.setFillColor(sf::Color{255, 190, 45,
                static_cast<std::uint8_t>(235.0f * incomingAttack)});
            window.draw(mark);
        }

        const sf::Vector2f attackDirection = world.hero().incomingAttackDirection();
        const float directionLength = configRef.getFloat("HERO_INCOMING_ATTACK_DIRECTION_LENGTH");
        const float directionWidth = configRef.getFloat("HERO_INCOMING_ATTACK_DIRECTION_WIDTH");
        sf::RectangleShape directionMark({directionLength, directionWidth});
        directionMark.setOrigin({0.0f, directionWidth * 0.5f});
        directionMark.setPosition({heroPosition.x + attackDirection.x * radius,
                                   heroPosition.y + attackDirection.y * radius});
        directionMark.setRotation(sf::radians(std::atan2(attackDirection.y, attackDirection.x)));
        directionMark.setFillColor(sf::Color{255, 235, 150,
            static_cast<std::uint8_t>(255.0f * incomingAttack)});
        window.draw(directionMark);
    }

    const float avoidedAttack = world.hero().avoidedAttackFlash();
    if (avoidedAttack > 0.0f) {
        const float startRadius = configRef.getFloat("HERO_AVOIDED_ATTACK_RING_START_RADIUS");
        const float endRadius = configRef.getFloat("HERO_AVOIDED_ATTACK_RING_END_RADIUS");
        const float radius = endRadius + (startRadius - endRadius) * avoidedAttack;
        const sf::Color avoidedColor{
            static_cast<std::uint8_t>(configRef.getInt("HERO_AVOIDED_ATTACK_R")),
            static_cast<std::uint8_t>(configRef.getInt("HERO_AVOIDED_ATTACK_G")),
            static_cast<std::uint8_t>(configRef.getInt("HERO_AVOIDED_ATTACK_B")),
            static_cast<std::uint8_t>(255.0f * avoidedAttack)};
        sf::CircleShape ring(radius, 40);
        ring.setOrigin({radius, radius});
        ring.setPosition(heroPosition);
        ring.setFillColor(sf::Color::Transparent);
        ring.setOutlineColor(avoidedColor);
        ring.setOutlineThickness(configRef.getFloat("HERO_AVOIDED_ATTACK_RING_THICKNESS"));
        window.draw(ring);
    }

    const float incomingHit = world.hero().incomingHitFlash();
    if (incomingHit > 0.0f) {
        const float hitStrength = world.hero().incomingHitStrength();
        const float startRadius = configRef.getFloat("HERO_INCOMING_HIT_RING_START_RADIUS");
        const float endRadius = configRef.getFloat("HERO_INCOMING_HIT_RING_END_RADIUS");
        const float radius = endRadius + (startRadius - endRadius) * incomingHit;
        sf::CircleShape ring(radius, 40);
        ring.setOrigin({radius, radius});
        ring.setPosition(heroPosition);
        ring.setFillColor(sf::Color{255, 35, 20, static_cast<std::uint8_t>(
            std::clamp(55.0f * incomingHit * hitStrength, 0.0f, 255.0f))});
        ring.setOutlineColor(sf::Color{255, 235, 210, static_cast<std::uint8_t>(
            std::clamp(255.0f * incomingHit * hitStrength, 0.0f, 255.0f))});
        ring.setOutlineThickness(configRef.getFloat("HERO_INCOMING_HIT_RING_THICKNESS")
                               * hitStrength);
        window.draw(ring);
    }
    if (useEnemyBodyLod) {
        for (const std::size_t enemyIndex : visibleEnemyIndices) {
            drawEnemyAttackFlash(window, *enemies[enemyIndex], enemyBodyParams);
        }
    }

    // §VFX literals — the jump-shadow / berserk / jump-telegraph / landing-
    // shockwave draw values were hard-coded in the loops below; they now live
    // in enemy_body_vfx.yaml (CLAUDE.md config rule). WorldRenderer.hpp is out
    // of this card's scope, so they are read here as per-frame locals (a map
    // lookup each) rather than constructor-loaded members. Values are moved
    // verbatim — no visual change.
    const float     vfxWorldOutlineThickness   = configRef.getFloat("ENEMY_VFX_WORLD_OUTLINE_THICKNESS");
    const sf::Color vfxJumpGhostOutline{
        static_cast<std::uint8_t>(configRef.getInt("ENEMY_VFX_JUMP_GHOST_OUTLINE_R")),
        static_cast<std::uint8_t>(configRef.getInt("ENEMY_VFX_JUMP_GHOST_OUTLINE_G")),
        static_cast<std::uint8_t>(configRef.getInt("ENEMY_VFX_JUMP_GHOST_OUTLINE_B")),
        0};
    const float     vfxJumpShadowRadiusMult    = configRef.getFloat("ENEMY_VFX_JUMP_SHADOW_RADIUS_MULT");
    const sf::Color vfxJumpShadowColor{
        static_cast<std::uint8_t>(configRef.getInt("ENEMY_VFX_JUMP_SHADOW_COLOR_R")),
        static_cast<std::uint8_t>(configRef.getInt("ENEMY_VFX_JUMP_SHADOW_COLOR_G")),
        static_cast<std::uint8_t>(configRef.getInt("ENEMY_VFX_JUMP_SHADOW_COLOR_B")),
        static_cast<std::uint8_t>(configRef.getInt("ENEMY_VFX_JUMP_SHADOW_COLOR_A"))};
    const float     vfxBerserkPulseSpeed       = configRef.getFloat("ENEMY_VFX_BERSERK_PULSE_SPEED");
    const float     vfxBerserkAlphaBase        = configRef.getFloat("ENEMY_VFX_BERSERK_ALPHA_BASE");
    const float     vfxBerserkAlphaRange       = configRef.getFloat("ENEMY_VFX_BERSERK_ALPHA_RANGE");
    const float     vfxBerserkRingOffset       = configRef.getFloat("ENEMY_VFX_BERSERK_RING_OFFSET");
    const sf::Color vfxBerserkRingColor{
        static_cast<std::uint8_t>(configRef.getInt("ENEMY_VFX_BERSERK_RING_COLOR_R")),
        static_cast<std::uint8_t>(configRef.getInt("ENEMY_VFX_BERSERK_RING_COLOR_G")),
        static_cast<std::uint8_t>(configRef.getInt("ENEMY_VFX_BERSERK_RING_COLOR_B"))};
    const float     vfxJumpTelegraphPulseSpeed = configRef.getFloat("ENEMY_VFX_JUMP_TELEGRAPH_PULSE_SPEED");
    const float     vfxJumpTelegraphAlphaBase  = configRef.getFloat("ENEMY_VFX_JUMP_TELEGRAPH_ALPHA_BASE");
    const float     vfxJumpTelegraphAlphaRange = configRef.getFloat("ENEMY_VFX_JUMP_TELEGRAPH_ALPHA_RANGE");
    const float     vfxJumpTelegraphRingOffset = configRef.getFloat("ENEMY_VFX_JUMP_TELEGRAPH_RING_OFFSET");
    const float     vfxJumpTelegraphFillAlphaMult =
        configRef.getFloat("ENEMY_VFX_JUMP_TELEGRAPH_FILL_ALPHA_MULT");
    const sf::Color vfxJumpMarkerColor{
        static_cast<std::uint8_t>(configRef.getInt("ENEMY_VFX_JUMP_MARKER_COLOR_R")),
        static_cast<std::uint8_t>(configRef.getInt("ENEMY_VFX_JUMP_MARKER_COLOR_G")),
        static_cast<std::uint8_t>(configRef.getInt("ENEMY_VFX_JUMP_MARKER_COLOR_B"))};
    const float     vfxShockwaveGrowthMult     = configRef.getFloat("ENEMY_VFX_SHOCKWAVE_GROWTH_MULT");
    const float     vfxShockwaveFadeAlpha      = configRef.getFloat("ENEMY_VFX_SHOCKWAVE_FADE_ALPHA");

    for (const auto& enemy : enemies) {
        if (!enemy) continue;
        const auto& dash = enemy->dashState();
        if (!dash.isGhostActive()) continue;
        if (!isWithinViewRect(cullRect, dash.ghostOrigin, enemyRadius)) continue;
        const bool  isJump = enemy->mind().isActiveJump;
        const float alpha  = std::min(dash.ghostAlpha, 255.0f);
        sf::CircleShape ghostShape(enemyRadius);
        ghostShape.setOrigin({enemyRadius, enemyRadius});
        ghostShape.setPosition(dash.ghostOrigin);
        ghostShape.setFillColor(sf::Color(0, 0, 0, 0));
        sf::Color outline = isJump ? vfxJumpGhostOutline : enemyDashGhostColor;
        outline.a = static_cast<std::uint8_t>(alpha);
        ghostShape.setOutlineColor(outline);
        ghostShape.setOutlineThickness(vfxWorldOutlineThickness);
        window.draw(ghostShape);
    }

    for (const auto& enemy : enemies) {
        if (!enemy || !enemy->mind().isActiveJump) continue;
        const auto pos = enemy->moveable().interpolatedPosition(currentInterpolationAlpha);
        if (!isWithinViewRect(cullRect, pos, enemyRadius)) continue;
        sf::CircleShape shadow(enemyRadius * vfxJumpShadowRadiusMult);
        shadow.setOrigin({enemyRadius * vfxJumpShadowRadiusMult, enemyRadius * vfxJumpShadowRadiusMult});
        shadow.setPosition(pos);
        shadow.setFillColor(vfxJumpShadowColor);
        shadow.setOutlineColor(sf::Color(0, 0, 0, 0));
        window.draw(shadow);
    }

    for (const auto& enemy : enemies) {
        if (!enemy || !enemy->mind().isBerserk) continue;
        const auto position = enemy->moveable().interpolatedPosition(currentInterpolationAlpha);
        if (!isWithinViewRect(cullRect, position, enemyRadius)) continue;
        const float pulse  = 0.5f + 0.5f * std::sin(simSeconds * vfxBerserkPulseSpeed);
        const auto  alpha  = static_cast<std::uint8_t>(vfxBerserkAlphaBase + vfxBerserkAlphaRange * pulse);
        sf::CircleShape ring(enemyRadius + vfxBerserkRingOffset);
        ring.setOrigin({enemyRadius + vfxBerserkRingOffset, enemyRadius + vfxBerserkRingOffset});
        ring.setPosition(position);
        ring.setFillColor(sf::Color(0, 0, 0, 0));
        ring.setOutlineColor(sf::Color(vfxBerserkRingColor.r, vfxBerserkRingColor.g, vfxBerserkRingColor.b, alpha));
        ring.setOutlineThickness(vfxWorldOutlineThickness);
        window.draw(ring);
    }

    for (const auto& enemy : enemies) {
        if (!enemy || !enemy->mind().isJumpTelegraphing) continue;
        const auto target  = enemy->mind().jumpTargetPos;
        const float pulse  = 0.5f + 0.5f * std::sin(simSeconds * vfxJumpTelegraphPulseSpeed);
        const auto  alpha  = static_cast<std::uint8_t>(vfxJumpTelegraphAlphaBase + vfxJumpTelegraphAlphaRange * pulse);
        sf::CircleShape marker(enemyRadius + vfxJumpTelegraphRingOffset);
        marker.setOrigin({enemyRadius + vfxJumpTelegraphRingOffset, enemyRadius + vfxJumpTelegraphRingOffset});
        marker.setPosition(target);
        marker.setFillColor(sf::Color(vfxJumpMarkerColor.r, vfxJumpMarkerColor.g, vfxJumpMarkerColor.b,
                                      static_cast<std::uint8_t>(vfxJumpTelegraphFillAlphaMult * pulse)));
        marker.setOutlineColor(sf::Color(vfxJumpMarkerColor.r, vfxJumpMarkerColor.g, vfxJumpMarkerColor.b, alpha));
        marker.setOutlineThickness(vfxWorldOutlineThickness);
        window.draw(marker);
    }

    for (const auto& enemy : enemies) {
        if (!enemy || !enemy->mind().isJumpLanding) continue;
        const auto  pos      = enemy->moveable().interpolatedPosition(currentInterpolationAlpha);
        const float total    = enemy->mind().jumpLandingTotal;
        const float elapsed  = total - enemy->mind().jumpLandingTimer;
        const float frac     = (total > 0.0f) ? elapsed / total : 1.0f;
        const float ringR    = enemyRadius + frac * enemyRadius * vfxShockwaveGrowthMult;
        const auto  alpha    = static_cast<std::uint8_t>(vfxShockwaveFadeAlpha * (1.0f - frac));
        sf::CircleShape shockwave(ringR);
        shockwave.setOrigin({ringR, ringR});
        shockwave.setPosition(pos);
        shockwave.setFillColor(sf::Color(0, 0, 0, 0));
        shockwave.setOutlineColor(sf::Color(vfxJumpMarkerColor.r, vfxJumpMarkerColor.g, vfxJumpMarkerColor.b, alpha));
        shockwave.setOutlineThickness(vfxWorldOutlineThickness);
        window.draw(shockwave);
    }

    // §Render Order L333: floating overlays (healthbars) after the Y-sort pass.
    drawHeroHealthbar(window, world.hero());
    const int heroLevel = world.hero().levelable().level;
    const bool shouldDrawEnemyOverlayChrome =
        enemyOverlayChromeMaxVisible <= 0
        || visibleEnemyIndices.size() <= static_cast<std::size_t>(enemyOverlayChromeMaxVisible);
    if (shouldDrawEnemyOverlayChrome) {
        ui::QuadBatch enemyHealthbarBatch;
        for (const std::size_t enemyIndex : visibleEnemyIndices) {
            appendEnemyHealthbarChrome(window, enemyHealthbarBatch, *enemies[enemyIndex], heroLevel);
        }
        enemyHealthbarBatch.flush(window);
    }

    const bool shouldDrawEnemyOverlayText =
        shouldDrawEnemyOverlayChrome
        && (enemyOverlayTextMaxVisible <= 0
            || visibleEnemyIndices.size() <= static_cast<std::size_t>(enemyOverlayTextMaxVisible));
    if (shouldDrawEnemyOverlayText) {
        for (const std::size_t enemyIndex : visibleEnemyIndices) {
            drawEnemyHealthbarForeground(window, *enemies[enemyIndex], heroLevel);
        }
    }

    // Dash/dodge charges are now shown in the bottom info bar (the
    // WeaponSlotSidebar dash readout), not as world-space dots on the hero.
    // `dodgeSystemPtr` stays wired for other consumers; only the draw is gone.
}

void WorldRenderer::pushEnemyTemplateEdit(const dof::entities::EnemyTemplate& tmpl) {
    enemyTemplates.put(tmpl);
}

const dof::loaders::EnemyTemplateRegistry& WorldRenderer::templateRegistry() const {
    return enemyTemplates;
}

const std::vector<EnemyShapeSpec>& WorldRenderer::getShapeCatalog() const {
    return enemyShapeCatalog;
}

const EnemyBodyParams& WorldRenderer::getEnemyBodyParams() const {
    return enemyBodyParams;
}

} // namespace dof::render
