#include "render/EnemyBodyPainter.hpp"

#include "render/EnemyEffectRenderer.hpp"
#include "render/EnemyShapeCatalog.hpp"
#include "render/EnemySpawnPainter.hpp"
#include "entities/Enemy.hpp"
#include "entities/EnemyTemplate.hpp"
#include "entities/QualityTier.hpp"
#include "entities/SpecialEnemyKind.hpp"
#include "loaders/ConfigLoader.hpp"

#include <SFML/Graphics/CircleShape.hpp>
#include <SFML/Graphics/ConvexShape.hpp>
#include <SFML/Graphics/RenderWindow.hpp>

#include <algorithm>
#include <cmath>
#include <cstdint>

namespace dof::render {

namespace {

float tierVisualScale(dof::entities::QualityTier tier,
                      float commonScale,
                      float uncommonScale,
                      float rareScale) {
    if (tier == dof::entities::QualityTier::Uncommon) return uncommonScale;
    if (tier == dof::entities::QualityTier::Rare)     return rareScale;
    return commonScale;
}

}

EnemyBodyParams loadEnemyBodyParams(const dof::loaders::ConfigLoader& config,
                                    const ColorTheme& theme) {
    EnemyBodyParams params;
    params.outlineCommon   = theme.enemyOutlineCommon;
    params.outlineUncommon = theme.enemyOutlineUncommon;
    params.outlineRare     = theme.enemyOutlineRare;
    params.bodyFill        = theme.enemyFill;
    params.haloLayers      = theme.haloLayers;
    params.haloRadiusStep  = theme.haloRadiusStep;
    params.haloAlphaBase   = theme.haloAlphaBase;
    params.haloThickness   = theme.haloThickness;

    params.enemyRadius              = config.getFloat("ENEMY_COLLISION_RADIUS");
    params.tierVisualScaleCommon    = config.getFloat("ENEMY_TIER_VISUAL_SCALE_COMMON");
    params.tierVisualScaleUncommon  = config.getFloat("ENEMY_TIER_VISUAL_SCALE_UNCOMMON");
    params.tierVisualScaleRare      = config.getFloat("ENEMY_TIER_VISUAL_SCALE_RARE");
    params.bodyBrightnessCommon     = config.getFloat("ENEMY_BODY_BRIGHTNESS_MULT_COMMON");
    params.bodyBrightnessUncommon   = config.getFloat("ENEMY_BODY_BRIGHTNESS_MULT_UNCOMMON");
    params.bodyBrightnessRare       = config.getFloat("ENEMY_BODY_BRIGHTNESS_MULT_RARE");
    params.auraRadiusCommon         = config.getFloat("ENEMY_AURA_RADIUS_MULT_COMMON");
    params.auraRadiusUncommon       = config.getFloat("ENEMY_AURA_RADIUS_MULT_UNCOMMON");
    params.auraRadiusRare           = config.getFloat("ENEMY_AURA_RADIUS_MULT_RARE");
    params.auraAlphaCommon          = config.getFloat("ENEMY_AURA_ALPHA_MULT_COMMON");
    params.auraAlphaUncommon        = config.getFloat("ENEMY_AURA_ALPHA_MULT_UNCOMMON");
    params.auraAlphaRare            = config.getFloat("ENEMY_AURA_ALPHA_MULT_RARE");

    params.outlineIntensity = loadOutlineIntensityParams(config);
    // Palette discipline (Step 2): the enemy shader used to hard-code white and
    // a cyan wash, so the brightest part of every enemy read as a colour outside
    // the locked palette. Now config, so the enemy's own hue carries the body.
    params.shaderPalette.coreWhite = config.getFloat("ENEMY_SHADER_CORE_WHITE");
    params.shaderPalette.peakWhite = config.getFloat("ENEMY_SHADER_PEAK_WHITE");
    params.shaderPalette.chargedColor = sf::Glsl::Vec3(
        config.getFloat("ENEMY_SHADER_CHARGED_R") / 255.0f,
        config.getFloat("ENEMY_SHADER_CHARGED_G") / 255.0f,
        config.getFloat("ENEMY_SHADER_CHARGED_B") / 255.0f);
    params.filigreeParams   = loadFiligreeParams(config);
    params.theme            = theme;

    params.tierPolygonCommon   = config.getInt("ENEMY_TIER_POLYGON_COMMON");
    params.tierPolygonUncommon = config.getInt("ENEMY_TIER_POLYGON_UNCOMMON");
    params.tierPolygonRare     = config.getInt("ENEMY_TIER_POLYGON_RARE");
    params.levelMarkerDotRadius     = config.getFloat("ENEMY_LEVEL_MARKER_DOT_RADIUS");
    params.levelMarkerDistanceMult  = config.getFloat("ENEMY_LEVEL_MARKER_DISTANCE_MULT");
    params.levelMarkerOutlineThickness = config.getFloat("ENEMY_VFX_LEVEL_MARKER_OUTLINE_THICKNESS");

    params.deathAnimDuration            = config.getFloat("ENEMY_DEATH_ANIM_DURATION");
    params.deathRingInnerStartRadius    = config.getFloat("ENEMY_DEATH_RING_INNER_START_RADIUS");
    params.deathRingInnerEndRadius      = config.getFloat("ENEMY_DEATH_RING_INNER_END_RADIUS");
    params.deathRingInnerStartAlpha     = config.getFloat("ENEMY_DEATH_RING_INNER_START_ALPHA");
    params.deathRingMidStartRadius      = config.getFloat("ENEMY_DEATH_RING_MID_START_RADIUS");
    params.deathRingMidEndRadius        = config.getFloat("ENEMY_DEATH_RING_MID_END_RADIUS");
    params.deathRingMidStartAlpha       = config.getFloat("ENEMY_DEATH_RING_MID_START_ALPHA");
    params.deathRingOuterStartRadius    = config.getFloat("ENEMY_DEATH_RING_OUTER_START_RADIUS");
    params.deathRingOuterEndRadius      = config.getFloat("ENEMY_DEATH_RING_OUTER_END_RADIUS");
    params.deathRingOuterStartAlpha     = config.getFloat("ENEMY_DEATH_RING_OUTER_START_ALPHA");
    params.deathRingOutlineThickness    = config.getFloat("ENEMY_DEATH_RING_OUTLINE_THICKNESS");

    params.deathShardCount        = config.getInt("ENEMY_DEATH_SHARD_COUNT");
    params.deathShardSpeed        = config.getFloat("ENEMY_DEATH_SHARD_SPEED");
    params.deathShardSize         = config.getFloat("ENEMY_DEATH_SHARD_SIZE");
    params.deathShardStartAlpha   = config.getFloat("ENEMY_DEATH_SHARD_START_ALPHA");
    params.deathShardSpinDegrees  = config.getFloat("ENEMY_DEATH_SHARD_SPIN_DEGREES");
    params.deathShardAspectRatio      = config.getFloat("ENEMY_VFX_DEATH_SHARD_ASPECT_RATIO");
    params.deathShardOutlineThickness = config.getFloat("ENEMY_VFX_DEATH_SHARD_OUTLINE_THICKNESS");

    params.deathBodyFragmentCount         = config.getInt("ENEMY_DEATH_BODY_FRAGMENT_COUNT");
    params.deathBodyFragmentSpeed         = config.getFloat("ENEMY_DEATH_BODY_FRAGMENT_SPEED");
    params.deathBodyFragmentLength        = config.getFloat("ENEMY_DEATH_BODY_FRAGMENT_LENGTH");
    params.deathBodyFragmentWidth         = config.getFloat("ENEMY_DEATH_BODY_FRAGMENT_WIDTH");
    params.deathBodyFragmentStartAlpha    = config.getFloat("ENEMY_DEATH_BODY_FRAGMENT_START_ALPHA");
    params.deathBodyFragmentSpinDegrees   = config.getFloat("ENEMY_DEATH_BODY_FRAGMENT_SPIN_DEGREES");
    params.deathFragmentOutlineThickness  = config.getFloat("ENEMY_VFX_DEATH_FRAGMENT_OUTLINE_THICKNESS");

    // Phase 14 — per-kind body fill overrides loaded from enemy.yaml
    // so the body painter can branch on Enemy::specialKind() and
    // paint the unique visual identity for each spec L607-686 variant.
    auto readSpecialRgb = [&](const std::string& base) {
        return sf::Color{
            static_cast<std::uint8_t>(config.getInt(base + "_R")),
            static_cast<std::uint8_t>(config.getInt(base + "_G")),
            static_cast<std::uint8_t>(config.getInt(base + "_B"))};
    };
    params.shockerBody       = readSpecialRgb("SPECIAL_SHOCKER_BODY");
    params.shockerFiligree   = readSpecialRgb("SPECIAL_SHOCKER_FILIGREE");
    params.hexarchonBody     = readSpecialRgb("SPECIAL_HEXARCHON_BODY");
    params.voidcrawlerBody   = readSpecialRgb("SPECIAL_VOIDCRAWLER_BODY");
    params.voidcrawlerEye    = readSpecialRgb("SPECIAL_VOIDCRAWLER_EYE");
    params.glasswraithBody   = readSpecialRgb("SPECIAL_GLASSWRAITH_BODY");
    params.glasswraithBody.a = static_cast<std::uint8_t>(config.getInt("SPECIAL_GLASSWRAITH_BODY_ALPHA"));
    params.sentinelBody      = readSpecialRgb("SPECIAL_SENTINEL_BODY");
    params.pactwalkerBody    = readSpecialRgb("SPECIAL_PACTWALKER_BODY");

    // card-phaseC — warm-white VFX accent colours from enemy_body_vfx.yaml.
    // readSpecialRgb appends _R/_G/_B, so each base key resolves to its RGB
    // triple. Three tint the death-explosion layers; one is the level marker.
    params.deathInnerRingColor       = readSpecialRgb("ENEMY_VFX_DEATH_INNER_RING");
    params.deathShardOutlineColor    = readSpecialRgb("ENEMY_VFX_DEATH_SHARD_OUTLINE");
    params.deathFragmentOutlineColor = readSpecialRgb("ENEMY_VFX_DEATH_FRAGMENT_OUTLINE");
    params.levelMarkerColor          = readSpecialRgb("ENEMY_VFX_LEVEL_MARKER");

    params.attackFlashDuration    = config.getFloat("ENEMY_ATTACK_FLASH_DURATION");
    params.attackFlashStartRadius = config.getFloat("ENEMY_ATTACK_FLASH_START_RADIUS");
    params.attackFlashEndRadius   = config.getFloat("ENEMY_ATTACK_FLASH_END_RADIUS");
    params.attackFlashStartAlpha  = config.getFloat("ENEMY_ATTACK_FLASH_START_ALPHA");
    params.attackFlashOutlineThickness = config.getFloat("ENEMY_VFX_ATTACK_FLASH_OUTLINE_THICKNESS");
    params.attackFlashColor = readSpecialRgb("ENEMY_VFX_ATTACK_FLASH");
    params.attackFlashInnerRadiusScale = config.getFloat("ENEMY_VFX_ATTACK_FLASH_INNER_RADIUS_SCALE");
    params.attackFlashFillAlpha = config.getFloat("ENEMY_VFX_ATTACK_FLASH_FILL_ALPHA");

    params.spawnAnimDuration         = config.getFloat("ENEMY_SPAWN_ANIM_DURATION");
    params.spawnPortalRadius         = config.getFloat("ENEMY_SPAWN_PORTAL_RADIUS");
    params.spawnPortalVerticalScale  = config.getFloat("ENEMY_SPAWN_PORTAL_VERTICAL_SCALE");
    params.spawnPortalRimThickness   = config.getFloat("ENEMY_SPAWN_PORTAL_RIM_THICKNESS");
    params.spawnPortalRimAlpha       = config.getFloat("ENEMY_SPAWN_PORTAL_RIM_ALPHA");
    params.spawnPortalHorizonAlpha   = config.getFloat("ENEMY_SPAWN_PORTAL_HORIZON_ALPHA");
    params.spawnPortalOpenFraction   = config.getFloat("ENEMY_SPAWN_PORTAL_OPEN_FRACTION");
    params.spawnPortalCloseFraction  = config.getFloat("ENEMY_SPAWN_PORTAL_CLOSE_FRACTION");
    params.spawnPortalHorizon        = sf::Color{
        static_cast<std::uint8_t>(config.getInt("ENEMY_SPAWN_PORTAL_HORIZON_R")),
        static_cast<std::uint8_t>(config.getInt("ENEMY_SPAWN_PORTAL_HORIZON_G")),
        static_cast<std::uint8_t>(config.getInt("ENEMY_SPAWN_PORTAL_HORIZON_B"))};
    params.spawnPortalVoidColor      = sf::Color{
        static_cast<std::uint8_t>(config.getInt("ENEMY_SPAWN_PORTAL_VOID_COLOR_R")),
        static_cast<std::uint8_t>(config.getInt("ENEMY_SPAWN_PORTAL_VOID_COLOR_G")),
        static_cast<std::uint8_t>(config.getInt("ENEMY_SPAWN_PORTAL_VOID_COLOR_B"))};
    params.spawnPortalGlowThicknessMult = config.getFloat("ENEMY_SPAWN_PORTAL_GLOW_THICKNESS_MULT");
    params.spawnPortalGlowRadiusMult    = config.getFloat("ENEMY_SPAWN_PORTAL_GLOW_RADIUS_MULT");
    params.spawnPortalGlowAlphaMult     = config.getFloat("ENEMY_SPAWN_PORTAL_GLOW_ALPHA_MULT");

    return params;
}

int enemyPolygonSidesForTier(dof::entities::QualityTier tier,
                              int commonSides,
                              int uncommonSides,
                              int rareSides) {
    // card-mpl8skw2 — tier-driven silhouette. SFML CircleShape needs
    // >= 3 corners; clamp every band to that floor so a misconfigured
    // value still renders a legal polygon.
    int sides = commonSides;
    if (tier == dof::entities::QualityTier::Uncommon) sides = uncommonSides;
    else if (tier == dof::entities::QualityTier::Rare) sides = rareSides;
    return std::max(3, sides);
}

int enemyLevelBandIndex(int level) {
    // card-mpl8skw2 — 0..4 bands matching the spec breakpoints
    // (L1-19 / L20-39 / L40-59 / L60-79 / L80+). Negative levels
    // are coerced to band 0 so a degenerate input still has a sane
    // dot count.
    if (level < 20)  return 0;
    if (level < 40)  return 1;
    if (level < 60)  return 2;
    if (level < 80)  return 3;
    return 4;
}

// Multiplies a colour's alpha by `fade` (0..1), clamped to a valid byte.
static sf::Color withFadedAlpha(sf::Color color, float fade) {
    color.a = static_cast<std::uint8_t>(
        std::clamp(static_cast<float>(color.a) * fade, 0.0f, 255.0f));
    return color;
}

void drawEnemyBody(sf::RenderTarget& window,
                   const dof::entities::Enemy& enemy,
                   const EnemyBodyParams& params,
                   const dof::entities::EnemyTemplate* enemyTemplate,
                   const std::vector<EnemyShapeSpec>& shapeCatalog,
                   const dof::loaders::ShaderLoader* shadersPtr,
                   float elapsed) {
    // While the spawn anim runs the body fades in IN PLACE on top of the
    // portal (drawn just before this), so the enemy materialises from it.
    const SpawnInFactors spawn = computeSpawnInFactors(enemy, params);
    const auto position = enemy.moveable().interpolatedPosition(
        params.interpolationAlpha);
    sf::Color outline = params.outlineCommon;
    float auraRadiusMult = params.auraRadiusCommon;
    float auraAlphaMult  = params.auraAlphaCommon;
    float bodyBrightness = params.bodyBrightnessCommon;
    if (enemy.tier() == dof::entities::QualityTier::Uncommon) {
        outline         = params.outlineUncommon;
        auraRadiusMult  = params.auraRadiusUncommon;
        auraAlphaMult   = params.auraAlphaUncommon;
        bodyBrightness  = params.bodyBrightnessUncommon;
    } else if (enemy.tier() == dof::entities::QualityTier::Rare) {
        outline         = params.outlineRare;
        auraRadiusMult  = params.auraRadiusRare;
        auraAlphaMult   = params.auraAlphaRare;
        bodyBrightness  = params.bodyBrightnessRare;
    }

    const float visualScale = tierVisualScale(enemy.tier(),
                                              params.tierVisualScaleCommon,
                                              params.tierVisualScaleUncommon,
                                              params.tierVisualScaleRare);
    float scaledRadius = params.enemyRadius * visualScale;

    // Per-enemy-type design template (the per-type YAML the editor writes):
    // when one exists for this enemy's kind it overrides the tier outline
    // colour and authored body size. `outline` and `scaledRadius` drive the
    // halo aura and the level-marker dots below, so those follow the template
    // automatically. The shape + fill are applied at the body draw branch.
    const dof::entities::EnemyTierDesign* design = nullptr;
    if (enemyTemplate != nullptr && !shapeCatalog.empty()) {
        design       = &enemyTemplate->forTier(enemy.tier());
        outline      = design->outline;
        scaledRadius = design->bodySize;
    }

    // card-mpl8skw2 — silhouette side count is now driven by TIER
    // (Common / Uncommon / Rare each pick their own), so the player
    // reads the tier from the shape itself at a glance — independent
    // of the brightness + halo aura. Level shows up via marker dots
    // painted around the silhouette below.
    const int polygonSides = enemyPolygonSidesForTier(enemy.tier(),
                                                       params.tierPolygonCommon,
                                                       params.tierPolygonUncommon,
                                                       params.tierPolygonRare);
    const int levelBand = enemyLevelBandIndex(enemy.level());

    if (design && params.shapeShaders && shadersPtr)
        drawEnemyEffectLayers(window, position, design->layers, shadersPtr,
                              *params.shapeShaders, elapsed, true);

    // Smooth halo circles (32 sides) regardless of shader state — at the
    // halo's enlarged radius even a 16-gon shows visible facets. The body
    // silhouette still encodes tier via `polygonSides` when the SDF
    // shader is unavailable.
    const std::size_t haloSides = std::size_t{32};
    for (int layer = params.haloLayers; layer >= 1; --layer) {
        const float radius = scaledRadius
            + static_cast<float>(layer * params.haloRadiusStep) * auraRadiusMult;
        sf::CircleShape glow(radius, haloSides);
        glow.setOrigin({radius, radius});
        glow.setPosition(position);
        sf::Color glowColor = outline;
        const float baseAlpha = static_cast<float>(params.haloAlphaBase)
            / static_cast<float>(layer + 1);
        glowColor.a = static_cast<std::uint8_t>(
            std::clamp(baseAlpha * auraAlphaMult * spawn.fade, 0.0f, 255.0f));
        glow.setFillColor(glowColor);
        window.draw(glow);
    }

    // ── Enemy body: SDF shader or polygon fallback ───────────────────
    // The SDF shader has no alpha input, so while the enemy is fading in
    // from the spawn portal (fade < 1) fall back to the polygon path, which
    // honours the fade. The shader resumes once the enemy is fully formed.
    const bool isFadingIn = spawn.fade < 1.0f;
    if (design != nullptr) {
        // Template path: paint the authored silhouette from the shape
        // catalogue, mirroring the gallery the user approved (ConvexShape
        // fill + neon outline + optional inner core). spawn.fade is honoured
        // so template enemies still materialise out of the spawn portal.
        const int shapeIndex = std::clamp(design->bodyShape, 0,
                                          static_cast<int>(shapeCatalog.size()) - 1);
        const EnemyShapeSpec& spec = shapeCatalog[static_cast<std::size_t>(shapeIndex)];
        const std::vector<sf::Vector2f> outlinePoints =
            buildEnemyShapeOutline(spec, scaledRadius);
        sf::ConvexShape body(outlinePoints.size());
        for (std::size_t p = 0; p < outlinePoints.size(); ++p) {
            body.setPoint(p, {position.x + outlinePoints[p].x,
                              position.y + outlinePoints[p].y});
        }
        body.setFillColor(withFadedAlpha(design->fill, spawn.fade));
        const float outlineMult = computeOutlineIntensityMult(
            enemy.tier(), false, params.outlineIntensity);
        body.setOutlineThickness(static_cast<float>(-params.haloThickness) * outlineMult);
        body.setOutlineColor(withFadedAlpha(outline, spawn.fade));
        window.draw(body);
        if (spec.coreRadius > 0.0f) {
            const float coreRadius = scaledRadius * spec.coreRadius;
            sf::CircleShape core(coreRadius, std::size_t{24});
            core.setOrigin({coreRadius, coreRadius});
            core.setPosition(position);
            core.setFillColor(withFadedAlpha(outline, spawn.fade));
            window.draw(core);
        }
    } else if (params.enemyShader && params.shapeShaders && !isFadingIn) {
        params.shapeShaders->drawEnemy(window, params.enemyShader, position,
                                       scaledRadius * 2.0f,
                                       colorToGlsl(outline), 0.f,
                                       params.shaderPalette);
    } else {
        sf::CircleShape body(scaledRadius, static_cast<std::size_t>(polygonSides));
        body.setOrigin({scaledRadius, scaledRadius});
        body.setPosition(position);
        sf::Color fill = params.bodyFill;
        switch (enemy.specialKind()) {
            case dof::entities::SpecialEnemyKind::None:              break;
            case dof::entities::SpecialEnemyKind::Shocker:           fill = params.shockerBody;     break;
            case dof::entities::SpecialEnemyKind::Hexarchon:         fill = params.hexarchonBody;   break;
            case dof::entities::SpecialEnemyKind::Voidcrawler:       fill = params.voidcrawlerBody; break;
            case dof::entities::SpecialEnemyKind::Glasswraith:       fill = params.glasswraithBody; break;
            case dof::entities::SpecialEnemyKind::TassideanSentinel: fill = params.sentinelBody;    break;
            case dof::entities::SpecialEnemyKind::PactWalker:        fill = params.pactwalkerBody;  break;
        }
        fill.r = static_cast<std::uint8_t>(std::clamp(static_cast<float>(fill.r) * bodyBrightness, 0.0f, 255.0f));
        fill.g = static_cast<std::uint8_t>(std::clamp(static_cast<float>(fill.g) * bodyBrightness, 0.0f, 255.0f));
        fill.b = static_cast<std::uint8_t>(std::clamp(static_cast<float>(fill.b) * bodyBrightness, 0.0f, 255.0f));
        body.setFillColor(withFadedAlpha(fill, spawn.fade));
        const float outlineMult = computeOutlineIntensityMult(
            enemy.tier(), false, params.outlineIntensity);
        body.setOutlineThickness(static_cast<float>(-params.haloThickness) * outlineMult);
        body.setOutlineColor(withFadedAlpha(outline, spawn.fade));
        window.draw(body);
    }

    drawFiligree(window, position, enemy.tier(), params.filigreeParams, params.theme);

    // card-mpl8skw2 — level-band marker dots arranged around the
    // body so the player can read the enemy's level band (0..4)
    // independently of the tier silhouette. Zero dots for band 0
    // (low-level enemies stay clean); up to 4 dots evenly spaced
    // around the silhouette for the top band.
    if (levelBand > 0 && params.levelMarkerDotRadius > 0.0f) {
        const float dotRadius      = params.levelMarkerDotRadius;
        const float markerDistance = scaledRadius * params.levelMarkerDistanceMult;
        const float angleStep      = (2.0f * 3.14159265358979f) / static_cast<float>(levelBand);
        for (int i = 0; i < levelBand; ++i) {
            const float angle = -1.5707963f + static_cast<float>(i) * angleStep;
            const sf::Vector2f offset{
                std::cos(angle) * markerDistance,
                std::sin(angle) * markerDistance};
            sf::CircleShape dot(dotRadius, 8);
            dot.setOrigin({dotRadius, dotRadius});
            dot.setPosition({position.x + offset.x, position.y + offset.y});
            dot.setFillColor(withFadedAlpha(outline, spawn.fade));
            dot.setOutlineThickness(params.levelMarkerOutlineThickness);
            dot.setOutlineColor(withFadedAlpha(params.levelMarkerColor, spawn.fade));
            window.draw(dot);
        }
    }

    drawEnemyAttackFlash(window, enemy, params);

    if (design && params.shapeShaders && shadersPtr)
        drawEnemyEffectLayers(window, position, design->layers, shadersPtr,
                              *params.shapeShaders, elapsed, false);
}

void drawEnemyAttackFlash(sf::RenderTarget& window,
                           const dof::entities::Enemy& enemy,
                           const EnemyBodyParams& params) {
    if (params.attackFlashDuration <= 0.0f) return;
    const float timer = enemy.huntable().attackFlashTimer;
    if (timer <= 0.0f) return;

    const float t      = 1.0f - (timer / params.attackFlashDuration);
    const float radius = params.attackFlashStartRadius
        + (params.attackFlashEndRadius - params.attackFlashStartRadius) * t;
    const float alpha  = params.attackFlashStartAlpha * (1.0f - t);
    if (alpha <= 0.0f || radius <= 0.0f) return;

    sf::Color ringColor = params.attackFlashColor;
    ringColor.a = static_cast<std::uint8_t>(std::clamp(alpha, 0.0f, 255.0f));

    sf::CircleShape core(radius * params.attackFlashInnerRadiusScale, 32);
    const float coreRadius = radius * params.attackFlashInnerRadiusScale;
    core.setOrigin({coreRadius, coreRadius});
    const sf::Vector2f position = enemy.moveable().interpolatedPosition(
        params.interpolationAlpha);
    core.setPosition(position);
    sf::Color coreColor = params.attackFlashColor;
    coreColor.a = static_cast<std::uint8_t>(std::clamp(
        params.attackFlashFillAlpha * (1.0f - t), 0.0f, 255.0f));
    core.setFillColor(coreColor);
    window.draw(core);

    sf::CircleShape ring(radius, 32);
    ring.setOrigin({radius, radius});
    ring.setPosition(position);
    ring.setFillColor(sf::Color::Transparent);
    ring.setOutlineThickness(params.attackFlashOutlineThickness);
    ring.setOutlineColor(ringColor);
    window.draw(ring);

    const float innerRadius = radius * params.attackFlashInnerRadiusScale;
    sf::CircleShape innerRing(innerRadius, 32);
    innerRing.setOrigin({innerRadius, innerRadius});
    innerRing.setPosition(position);
    innerRing.setFillColor(sf::Color::Transparent);
    innerRing.setOutlineThickness(params.attackFlashOutlineThickness * 0.7f);
    innerRing.setOutlineColor(ringColor);
    window.draw(innerRing);
}

}
