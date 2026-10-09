#pragma once

// card-mpkzixm3 — extracted from WorldRenderer so per-enemy body variation
// (level-band silhouette, special-enemy accents) stays out of the high-level
// world render loop. The struct + free functions stay stateless: every input
// the painter needs is loaded once via
// `loadEnemyBodyParams` and passed in by the caller.

#include "entities/EnemyTemplate.hpp"
#include "entities/QualityTier.hpp"
#include "render/ColorTheme.hpp"
#include "render/EnemyShapeCatalog.hpp"
#include "render/Filigree.hpp"
#include "render/OutlineIntensity.hpp"
#include "render/ShapeShaders.hpp"
#include "render/EnemyDeathPainter.hpp"

#include <SFML/Graphics/Color.hpp>

#include <vector>

namespace dof::entities { class Enemy; }
namespace dof::loaders  { class ConfigLoader; class ShaderLoader; }
namespace sf            { class RenderTarget; class Shader; }

namespace dof::render {

struct EnemyBodyParams {
    float interpolationAlpha{1.0f};
    // Tier-driven colour + scale stacks. Same values WorldRenderer
    // previously held as direct members — moved here so the painter
    // is self-contained.
    sf::Color              outlineCommon{};
    sf::Color              outlineUncommon{};
    sf::Color              outlineRare{};
    sf::Color              bodyFill{};
    int                    haloLayers{0};
    int                    haloRadiusStep{0};
    int                    haloAlphaBase{0};
    int                    haloThickness{0};

    float                  enemyRadius{0.0f};
    float                  tierVisualScaleCommon{1.0f};
    float                  tierVisualScaleUncommon{1.0f};
    float                  tierVisualScaleRare{1.0f};
    float                  bodyBrightnessCommon{1.0f};
    float                  bodyBrightnessUncommon{1.0f};
    float                  bodyBrightnessRare{1.0f};
    float                  auraRadiusCommon{1.0f};
    float                  auraRadiusUncommon{1.0f};
    float                  auraRadiusRare{1.0f};
    float                  auraAlphaCommon{1.0f};
    float                  auraAlphaUncommon{1.0f};
    float                  auraAlphaRare{1.0f};

    OutlineIntensityParams outlineIntensity{};
    // Palette inputs for enemy.frag — see ENEMY_SHADER_* in enemy.yaml.
    EnemyShaderPalette     shaderPalette{};
    FiligreeParams         filigreeParams{};
    ColorTheme             theme{};

    // Enemy death-ring VFX (was inline in WorldRenderer); moved
    // alongside the body painter so the explosion renderer can stay
    // in the same module.
    float                  deathAnimDuration{0.0f};
    float                  deathRingInnerStartRadius{0.0f};
    float                  deathRingInnerEndRadius{0.0f};
    float                  deathRingInnerStartAlpha{0.0f};
    float                  deathRingMidStartRadius{0.0f};
    float                  deathRingMidEndRadius{0.0f};
    float                  deathRingMidStartAlpha{0.0f};
    float                  deathRingOuterStartRadius{0.0f};
    float                  deathRingOuterEndRadius{0.0f};
    float                  deathRingOuterStartAlpha{0.0f};
    float                  deathRingOutlineThickness{0.0f};

    // card-mplgs9wc — fragmental shard layer atop the rings. Zero
    // shardCount keeps the legacy ring-only look.
    int                    deathShardCount{6};
    float                  deathShardSpeed{120.0f};
    float                  deathShardSize{6.0f};
    float                  deathShardStartAlpha{220.0f};
    float                  deathShardSpinDegrees{180.0f};
    // Shard quad aspect (height = size * ratio) + its rim thickness. Extracted
    // from EnemyDeathPainter.cpp literals (0.4f / 0.5f).
    float                  deathShardAspectRatio{0.4f};
    float                  deathShardOutlineThickness{0.5f};

    // card-mpmzdla5 — second fragment layer that reads as the enemy
    // BODY breaking into many triangular pieces. The shards above
    // look like industrial debris; these "body fragments" are big
    // triangular slabs in the enemy tier palette, fanning out from
    // the centre alongside the shards. Together they sell the "many
    // pieces" effect the user asked for.
    int                    deathBodyFragmentCount{14};
    float                  deathBodyFragmentSpeed{170.0f};
    float                  deathBodyFragmentLength{18.0f};
    float                  deathBodyFragmentWidth{10.0f};
    float                  deathBodyFragmentStartAlpha{230.0f};
    float                  deathBodyFragmentSpinDegrees{360.0f};
    // Body-fragment triangle rim thickness (0.8f literal in EnemyDeathPainter).
    float                  deathFragmentOutlineThickness{0.8f};

    // card-phaseC — warm-white VFX accent colours, externalised to
    // configs/enemy_body_vfx.yaml (no colour literal lives in source). The
    // first three tint the death-explosion layers (inner ring fill, shard
    // outline, body-fragment outline); the last is the level-band marker-dot
    // outline (was sf::Color::White in drawEnemyBody).
    sf::Color              deathInnerRingColor{};
    sf::Color              deathShardOutlineColor{};
    sf::Color              deathFragmentOutlineColor{};
    sf::Color              levelMarkerColor{};

    // card-mpkzixm3 / card-mpl8skw2 — tier-driven polygon table.
    // Common / Uncommon / Rare each pick their own polygon side
    // count so the silhouette ITSELF differentiates tiers (not just
    // the brightness + halo aura). Loaded from
    // `ENEMY_TIER_POLYGON_COMMON / _UNCOMMON / _RARE` in
    // `enemy.yaml`. Side counts < 3 are clamped up at render time.
    int                    tierPolygonCommon{3};
    int                    tierPolygonUncommon{5};
    int                    tierPolygonRare{7};
    // card-mpl8skw2 — level-band marker dots painted around the body
    // perimeter (one dot per band index, max ~4). Reads at a glance
    // as a level indicator without touching the silhouette shape.
    float                  levelMarkerDotRadius{2.0f};
    float                  levelMarkerDistanceMult{1.25f};
    // Outline thickness on each level-band marker dot (1.0f literal).
    float                  levelMarkerOutlineThickness{1.0f};

    // Phase 14 — per-kind body fill overrides. Loaded once from
    // enemy.yaml (`SPECIAL_<KIND>_BODY_R/G/B`) so the body painter
    // can branch on Enemy::specialKind() and paint the unique visual
    // identity for each spec L607-686 variant. Alpha defaults to 255
    // except for Glasswraith which carries an explicit
    // `SPECIAL_GLASSWRAITH_BODY_ALPHA` override to match the spec's
    // translucent body.
    // SDF shader (enemy.frag) — null falls back to polygon body.
    sf::Shader*            enemyShader{nullptr};
    ShapeShaders*          shapeShaders{nullptr};

    sf::Color              shockerBody{};
    sf::Color              shockerFiligree{};
    sf::Color              hexarchonBody{};
    sf::Color              voidcrawlerBody{};
    sf::Color              voidcrawlerEye{};
    sf::Color              glasswraithBody{};
    sf::Color              sentinelBody{};
    sf::Color              pactwalkerBody{};

    // Attack flash ring VFX — brief expanding ring when enemy strikes.
    float                  attackFlashDuration{0.0f};
    float                  attackFlashStartRadius{0.0f};
    float                  attackFlashEndRadius{0.0f};
    float                  attackFlashStartAlpha{0.0f};
    // Outline thickness on the attack-flash ring (3.0f literal).
    float                  attackFlashOutlineThickness{3.0f};
    sf::Color              attackFlashColor{};
    float                  attackFlashInnerRadiusScale{0.62f};
    float                  attackFlashFillAlpha{70.0f};

    // Spawn animation VFX — a Stargate-style portal opens in place and the
    // enemy fades in from it (rendered by EnemySpawnPainter). Driven by
    // huntable().spawnAnimTimer over spawnAnimDuration seconds.
    float                  spawnAnimDuration{0.0f};
    // Portal geometry: outer radius (world units) and a vertical squash so
    // the disc reads as lying on the ground.
    float                  spawnPortalRadius{75.0f};
    float                  spawnPortalVerticalScale{0.7f};
    float                  spawnPortalRimThickness{7.0f};
    float                  spawnPortalRimAlpha{255.0f};
    float                  spawnPortalHorizonAlpha{170.0f};
    // Stargate-blue energy colour of the event-horizon surface + rim.
    sf::Color              spawnPortalHorizon{80, 190, 255};
    // Phase fractions across the spawn timeline (0..1): the portal irises
    // open until OPEN_FRACTION, holds while the enemy fades in, then closes
    // after CLOSE_FRACTION.
    float                  spawnPortalOpenFraction{0.30f};
    float                  spawnPortalCloseFraction{0.82f};
    // Portal event-horizon void colour + outer-glow multipliers (were hard-
    // coded literals in EnemySpawnPainter.cpp: sf::Color(12,6,18), 1.8f, 0.2f,
    // 0.3f). The rest of the ENEMY_SPAWN_PORTAL_* family lives in enemy.yaml.
    sf::Color              spawnPortalVoidColor{12, 6, 18};
    float                  spawnPortalGlowThicknessMult{1.8f};
    float                  spawnPortalGlowRadiusMult{0.2f};
    float                  spawnPortalGlowAlphaMult{0.3f};
};

EnemyBodyParams loadEnemyBodyParams(const dof::loaders::ConfigLoader& config,
                                    const ColorTheme& theme);

// card-mpl8skw2 — pure helper. Returns the polygon side count for
// the given quality tier, gated by the config-driven table on
// EnemyBodyParams. Anything below 3 is clamped to 3 (SFML CircleShape
// minimum) so a misconfigured value never produces a degenerate
// silhouette.
int enemyPolygonSidesForTier(dof::entities::QualityTier tier,
                              int commonSides,
                              int uncommonSides,
                              int rareSides);

// card-mpl8skw2 — pure helper. Returns 0..4 marker count based on
// the enemy's level band (band 0 = L1-19, ..., band 4 = L80+). Used
// to paint that many small dots around the enemy silhouette for at-
// a-glance level identification.
int enemyLevelBandIndex(int level);

// When `enemyTemplate` is non-null AND `shapeCatalog` is non-empty, the
// body is painted from the per-enemy-type design YAML: the tier's authored
// shape (index into `shapeCatalog`), fill, outline colour and size override
// the tier defaults, and the halo + level dots follow the template outline.
// Passing nullptr / an empty catalog keeps the legacy SDF-shader / polygon
// fallback path, so existing callers and tests render unchanged.
void drawEnemyBody(sf::RenderTarget& window,
                   const dof::entities::Enemy& enemy,
                   const EnemyBodyParams& params,
                   const dof::entities::EnemyTemplate* enemyTemplate = nullptr,
                   const std::vector<EnemyShapeSpec>& shapeCatalog = {},
                   const dof::loaders::ShaderLoader* shadersPtr = nullptr,
                   float elapsed = 0.0f);

// drawEnemyDeathExplosion now lives in render/EnemyDeathPainter.hpp
// (re-included above) so death VFX stays separate from live body rendering.

// Draws the attack execution pulse if the enemy's attackFlashTimer is active.
// Called from drawEnemyBody — also exposed so tests can invoke it directly.
void drawEnemyAttackFlash(sf::RenderTarget& window,
                           const dof::entities::Enemy& enemy,
                           const EnemyBodyParams& params);

}
