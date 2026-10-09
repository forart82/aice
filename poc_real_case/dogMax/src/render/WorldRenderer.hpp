#pragma once

#include "render/BarLayout.hpp"
#include "render/ColorTheme.hpp"
#include "loaders/EnemyTemplateLoader.hpp"
#include "render/EnemyBodyPainter.hpp"
#include "render/EnemyInfoBar.hpp"
#include "render/EnemyShapeCatalog.hpp"
#include "render/Filigree.hpp"
#include "render/HealthColor.hpp"
#include "render/LevelUpAura.hpp"
#include "render/OutlineIntensity.hpp"
#include "render/ShapeShaders.hpp"
#include "render/UiAccent.hpp"
#include "render/WorldEnvironmentRenderer.hpp"
#include "render/ui/QuadBatch.hpp"
#include "render/ui/UiSegmentedBar.hpp"

#include <SFML/Graphics/Color.hpp>
#include <SFML/Graphics/Font.hpp>
#include <SFML/Graphics/Texture.hpp>
#include <SFML/Graphics/View.hpp>
#include <SFML/System/Vector2.hpp>

#include <array>
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

namespace dof::core    { class World; class WorldEnvironment; }
namespace dof::combat  { class DodgeSystem; }
namespace dof::entities { class Enemy; class FloorItem; class Hero; }
namespace dof::hubs    { class EvasionHub; class LuckHub; }
namespace dof::loaders { class ConfigLoader; class ShaderLoader; }
namespace sf           { class RenderTarget; }

namespace dof::render {

// Build-reactive hero glow (visual_identity.md Step 6). The hero's halo heats
// up with equipped build strength — the one part of the look driven by dogmax's
// own dice/luck system rather than by health or combat, and so the part no
// other game's visuals can coincidentally resemble.
struct BuildGlowParams {
    bool      isEnabled{false};
    float     luckReference{1.0f};
    float     gamma{1.0f};
    sf::Color peakColor{sf::Color::White};
    float     intensityGain{0.0f};
};

// The ground grid. Anchored to WORLD coordinates so it slides past as the hero
// moves — with a flat fill and no texture there is otherwise no motion cue at
// all, which matters more in a game about movement than any amount of polish.
struct WorldGridParams {
    bool      isEnabled{false};
    float     spacing{0.0f};
    int       majorEvery{0};
    float     minorAlpha{0.0f};
    float     majorAlpha{0.0f};
    float     subordinateScale{1.0f};
    sf::Color color{sf::Color::White};
};

class WorldRenderer {
public:
    WorldRenderer(const dof::loaders::ConfigLoader& config,
                  const ColorTheme& theme,
                  const sf::Font& font,
                  const dof::loaders::ShaderLoader* shaders,
                  std::uint64_t startupSeed,
                  const dof::core::WorldEnvironment& environment);

    void render(sf::RenderTarget& window, const dof::core::World& world,
                const sf::View& worldView, float simSeconds,
                float interpolationAlpha);
    void setEvasionHub(const dof::hubs::EvasionHub& evasionHub);
    void setLuckHub(const dof::hubs::LuckHub& luckHub);
    void setDodgeSystem(const dof::combat::DodgeSystem& dodgeSystem);

    // For the Ctrl+E enemy design editor: push a live edit and read state.
    void pushEnemyTemplateEdit(const dof::entities::EnemyTemplate& tmpl);
    const dof::loaders::EnemyTemplateRegistry& templateRegistry() const;
    const std::vector<EnemyShapeSpec>& getShapeCatalog() const;
    const EnemyBodyParams& getEnemyBodyParams() const;
    const WorldEnvironmentRenderer& environmentVisuals() const {
        return environmentRenderer;
    }

private:
    void drawHeroBody(sf::RenderTarget& window, const dof::core::World& world);
    void drawHeroHealthbar(sf::RenderTarget& window, const dof::entities::Hero& hero);
    void appendEnemyHealthbarChrome(sf::RenderTarget& window, ui::QuadBatch& batch,
                                    const dof::entities::Enemy& enemy, int heroLevel);
    void drawEnemyHealthbarForeground(sf::RenderTarget& window,
                                      const dof::entities::Enemy& enemy, int heroLevel);

    const ColorTheme                  theme;
    const dof::loaders::ConfigLoader& configRef;
    const sf::Font&                   font;
    HealthRamp                        healthRamp;
    EnemyInfoBar                      enemyInfoBar;
    UiAccent                          uiAccent;
    ui::UiSegmentedBar                segmentedBar{};
    OutlineIntensityParams            outlineIntensity;
    FiligreeParams                    filigreeParams;
    EnemyBodyParams                   enemyBodyParams;
    dof::loaders::EnemyTemplateRegistry enemyTemplates;
    std::vector<EnemyShapeSpec>       enemyShapeCatalog;
    LevelUpAuraParams                 levelUpAuraParams;
    const dof::hubs::EvasionHub*      evasionHubPtr{nullptr};
    // Build state for the reactive hero glow. Non-owning, and re-set by
    // applyConfigToRenderers alongside the other hub pointers.
    const dof::hubs::LuckHub*         luckHubPtr{nullptr};
    BuildGlowParams                   buildGlow{};
    // Peak vertical squash on a full-strength incoming hit.
    float                             heroSquashStrength{0.0f};
    // The world's ground. With no ground texture this clear colour is the
    // entire backdrop the neon is read against.
    sf::Color                         worldGroundColor{sf::Color::Black};
    WorldGridParams                   worldGrid{};
    const dof::combat::DodgeSystem*   dodgeSystemPtr{nullptr};
    sf::Color                         ghostStepOutline;
    sf::Color                         enemyDashGhostColor;
    // card-dash-vfx — dash motion-streak afterimage (see dodge.yaml).
    int                               dashTrailImages{0};
    sf::Color                         dashTrailColor;
    float blinkCycleSeconds;
    float blinkAlphaBase;
    float blinkAlphaAmp;
    float heroRadius;
    float enemyRadius;
    float heroHpBarWidth;
    float heroHpBarHeight;
    float heroHpBarOffsetY;
    float heroLocatorRadiusMultiplier{1.25f};
    float heroLocatorYScale{0.45f};
    int   heroLocatorAlpha{180};
    float enemyHpBarWidth;
    float enemyHpBarHeight;
    float enemyHpBarOffsetY;
    float enemyTierVisualScaleCommon;
    float enemyTierVisualScaleUncommon;
    float enemyTierVisualScaleRare;
    float enemyDeathAnimDuration;
    float enemyHpBarLevelLabelOffsetY;
    float hpBarLabelFontSize;
    int   enemyOverlayChromeMaxVisible;
    int   enemyOverlayTextMaxVisible;
    int   enemyBodyLodMinVisible;
    int   enemyBodyLodCircleSides;
    int   enemyBodyLodHaloLayers;
    float viewCullPadding;
    float currentInterpolationAlpha{1.0f};
    // Code-drawn hero. heroSpriteSize is kept as the body's on-screen DIAMETER
    // (it was the atlas cell height) so every existing consumer — the healthbar
    // layout's visual-top-extent among them — keeps the same number.
    float                            heroSpriteSize{150.0f};
    float                            heroSpriteOriginYRatio{0.88f};
    float                            heroShapeRotationOffsetDegrees{0.0f};
    // Hero form size as a multiple of HERO_BODY_SIZE: the shader draws its
    // corona out to the quad edge, so the quad must be larger than the body.
    float                            heroFormScale{1.0f};
    // Which hero form the shader draws — see HERO_FORM in hero.yaml.
    int                              heroFormIndex{0};
    // Sim clock for the idle breath, so a standing hero still lives.
    float                            currentSimSeconds{0.0f};
    float                            heroRimRatio{0.0f};
    sf::Color                        heroFillColor{sf::Color::Black};
    WorldEnvironmentRenderer         environmentRenderer;
    ShapeShaders                      shapeShaders;
    const dof::loaders::ShaderLoader* shadersPtr{nullptr};
};

} // namespace dof::render
