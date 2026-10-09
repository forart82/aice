#include "app/GameSession.hpp"

#include "entities/FloorItem.hpp"
#include "entities/Hero.hpp"
#include "entities/Weapon.hpp"

#include <SFML/Graphics/Image.hpp>
#include <SFML/Graphics/RenderWindow.hpp>
#include <SFML/Graphics/Texture.hpp>
#include <SFML/System/Sleep.hpp>
#include <SFML/Window/Event.hpp>
#include <SFML/Window/Keyboard.hpp>
#include <SFML/Window/Mouse.hpp>

#include <chrono>
#include <cmath>
#include <filesystem>
#include <iostream>
#include <numbers>
#include <string>
#include <thread>
#include <utility>

namespace dof::app {

GameSession::GameSession(const AppOptions& opts)
    : options(opts),
      rng(opts.seed),
      clock(60) {
    configLoader.loadDirectory(options.configDirectory);
    // Hero skeletal-animation clips live in configs/anim/. Merge them into the
    // main keyspace (preserving overrides, like configs/effects/) BEFORE the
    // WorldRenderer ctor loads the clips. Each file carries a unique ANM_*
    // prefix so the merged flat keyspace never collides across clips.
    const std::filesystem::path animCfgDir =
        std::filesystem::path(options.configDirectory) / "anim";
    if (std::filesystem::exists(animCfgDir))
        configLoader.loadDirectoryPreservingOverrides(animCfgDir);
    clock.setHertz(configLoader.getInt("SIM_TICK_HZ"));
    clock.setMaxDeltaSeconds(configLoader.getFloat("CLOCK_MAX_DELTA_SECONDS"));

    if (!fontLoader.loadFromFile(configLoader.getString("UI_FONT_PATH"))) {
        throw std::runtime_error("GameSession: failed to load UI font");
    }

    auto hero = std::make_unique<dof::entities::Hero>(configLoader);
    worldInstance = std::make_unique<dof::core::World>(std::move(hero));
    worldEnvironment = std::make_unique<dof::core::WorldEnvironment>(configLoader);
    if (options.hasHeroPositionOverride) {
        worldInstance->hero().moveable().teleportTo({
            options.heroPositionOverrideX,
            options.heroPositionOverrideY});
    }
    damageTextHub = std::make_unique<dof::hubs::DamageTextHub>(configLoader, rng);
    enemyManager = std::make_unique<dof::managers::EnemyManager>(configLoader, rng, *damageTextHub);
    nameLoader.loadDirectory(configLoader.getString("NAMES_ASSET_DIRECTORY"));
    nameMaker = std::make_unique<dof::makers::NameMaker>(
        nameLoader, rng, configLoader.getFloat("WEAPON_FLAVOUR_SUBSTITUTION_CHANCE"));
    weaponMaker = std::make_unique<dof::makers::WeaponMaker>(configLoader, rng, nameMaker.get());
    diceMaker = std::make_unique<dof::makers::DiceMaker>(configLoader, rng, nameMaker.get());
    lootMaker = std::make_unique<dof::makers::LootMaker>(configLoader, rng, *weaponMaker, *diceMaker);
    inventoryHub = std::make_unique<dof::hubs::InventoryHub>(configLoader);
    weaponSlotHub = std::make_unique<dof::hubs::WeaponSlotHub>(configLoader);
    // SA28 / spec §Weaponslot L1652-1653 — wire the Hero's read-only
    // equipped-weapon mirror to the slot hub. The Hero was allocated
    // before the hub existed (line 44), so the back-pointer is set
    // here. WeaponSlotHub stays the source of truth; the Hero only
    // exposes a snapshot for level-up rescale (SA16) and any future
    // consumer that owns a Hero reference without a hub reference.
    worldInstance->hero().attachWeaponSlot(*weaponSlotHub);
    dronDetector = std::make_unique<dof::combat::DronDetector>(configLoader);
    // card-mpkz662b part 1b — new active Doge (Space-key dash). State
    // lives outside the Hero so equipment-modifier hooks can re-tune
    // the charge pool / cooldown later without entity-side churn.
    dodgeSystem  = std::make_unique<dof::combat::DodgeSystem>(configLoader);
    dronFloatTextHub = std::make_unique<dof::hubs::DronFloatTextHub>(configLoader);
    attackVfxHub = std::make_unique<dof::hubs::AttackVfxHub>(configLoader);
    evasionHub = std::make_unique<dof::hubs::EvasionHub>(configLoader);
    luckHub = std::make_unique<dof::hubs::LuckHub>(configLoader, *weaponSlotHub);
    xpFloatHub = std::make_unique<dof::hubs::XpFloatHub>(configLoader);
    powderHub = std::make_unique<dof::hubs::PowderHub>();
    vitalityTank = std::make_unique<dof::hubs::VitalityTank>(configLoader);
    if (!options.isHeadless) {
        pickupAudio = std::make_unique<dof::audio::PickupAudio>(configLoader);
        levelUpAudio = std::make_unique<dof::audio::LevelUpAudio>(configLoader);
        spatialAudio = std::make_unique<dof::audio::SpatialAudio>(configLoader);
        backgroundMusic = std::make_unique<dof::audio::BackgroundMusic>(configLoader);
    }
    enemyManager->setEvasionContext(*evasionHub, *weaponSlotHub);
    enemyManager->setLootContext(*lootMaker, *luckHub);
    enemyManager->setVitalityTank(*vitalityTank);
    enemyManager->setEquipContext(*weaponMaker, *diceMaker);
    enemyManager->setXpRewardContext(*xpFloatHub);
    enemyManager->setSpatialAudio(spatialAudio.get());
    enemyManager->setAttackVfxHub(attackVfxHub.get());
    enemyManager->synchronizeWorldEditorEnemies(*worldInstance, *worldEnvironment);
    weaponManager = std::make_unique<dof::managers::WeaponManager>(configLoader, rng, *dronDetector,
                                                                    *weaponSlotHub, *damageTextHub,
                                                                    *dronFloatTextHub, *luckHub, *xpFloatHub);
    // SA6 follow-up — wire the AttackVfxHub into WeaponManager::fireRow
    // so per-mode VFX events queue every shot. AttackVfxRenderer (built
    // in `run()` once the window exists) drains the events each frame.
    weaponManager->setAttackVfxHub(attackVfxHub.get());
    // Wire EnemyManager so WeaponManager fireRow can call the defensive
    // dash check before applying damage to each hit enemy.
    weaponManager->setEnemyManager(enemyManager.get());
    weaponManager->setSpatialAudio(spatialAudio.get());
    // Impact freeze (visual_identity.md Step 8): both hit directions request
    // it, GameSession owns it because it gates the clock.
    weaponManager->setHitStop(&hitStop);
    enemyManager->setHitStop(&hitStop);
    weaponManager->setEffectBurstHub(&effectBurstHub);
    enemyManager->setEffectBurstHub(&effectBurstHub);
    cameraShakeTraumaPerBurstPixel =
        configLoader.getFloat("CAMERA_SHAKE_TRAUMA_PER_BURST_PIXEL");
    interactionController = std::make_unique<dof::render::InteractionController>(
        *worldInstance, *inventoryHub, *weaponSlotHub, uiState, configLoader);
    interactionController->setPowderHub(*powderHub);
    colorTheme = dof::render::buildColorTheme(configLoader);

    // Spec §Console L2891-2987 — owns input-line state + scrollback log
    // + history + autocomplete. Constructed early so the console is
    // available for the whole session. Caps come from `debug.yaml`.
    console = std::make_unique<dof::app::Console>(
        configLoader.getInt("CONSOLE_OUTPUT_LINES_MAX"),
        configLoader.getInt("CONSOLE_HISTORY_CAP"),
        configLoader.getInt("CONSOLE_SUGGESTION_LIMIT"));
    // Wire the loader so typing-time autocomplete refreshes the
    // dropdown suggestions automatically on every keystroke (the
    // ConsoleOverlay renders the list — see render/ConsoleOverlay.cpp).
    console->attachLoader(configLoader);

    spawnStarterPitchfork();
    preloadPerformanceEnemies();

    // Load GLSL shaders only when a window (and thus a live GL context) is
    // actually wanted — the same guard run() uses for the window itself
    // (`wantWindow = !options.isHeadless || options.isOffscreen`). A truly
    // headless run (--headless without --offscreen) creates no window and has
    // no GL context, so initializeShaders()'s hasSystemSupport() probe
    // (sf::Shader::isAvailable()) would abort on a display-less host. Offscreen
    // still renders into a hidden window with a real context and builds every
    // shader-consuming renderer, so it must keep loading its shaders.
    if (!options.isHeadless || options.isOffscreen) {
        initializeShaders();
    }
}

void GameSession::preloadPerformanceEnemies() {
    if (options.performanceEnemyCount <= 0) return;

    auto& heroDamage = worldInstance->hero().damageable();
    const float benchmarkHeroHealth = configLoader.getFloat("PERF_SWARM_HERO_MAX_HEALTH");
    if (benchmarkHeroHealth > 0.0f) {
        heroDamage.setMaxHealth(benchmarkHeroHealth);
    }
    heroDamage.setInvulnerable(configLoader.getFloat("PERF_SWARM_HERO_INVULNERABLE_SECONDS"));

    auto& enemies = worldInstance->enemies();
    enemies.reserve(enemies.size() + static_cast<std::size_t>(options.performanceEnemyCount));

    const sf::Vector2f heroPosition = worldInstance->hero().moveable().position;
    const float radiusX = configLoader.getFloat("PERF_SWARM_RADIUS_X");
    const float radiusY = configLoader.getFloat("PERF_SWARM_RADIUS_Y");
    const float minRadiusFrac = configLoader.getFloat("PERF_SWARM_MIN_RADIUS_FRAC");
    const int enemyLevel = configLoader.getInt("PERF_SWARM_ENEMY_LEVEL");
    const float goldenAngle = std::numbers::pi_v<float> * (3.0f - std::sqrt(5.0f));

    for (int i = 0; i < options.performanceEnemyCount; ++i) {
        const float progress = (static_cast<float>(i) + 0.5f)
                             / static_cast<float>(options.performanceEnemyCount);
        const float radial = minRadiusFrac + (1.0f - minRadiusFrac) * std::sqrt(progress);
        const float angle = static_cast<float>(i) * goldenAngle;
        const sf::Vector2f offset{
            std::cos(angle) * radiusX * radial,
            std::sin(angle) * radiusY * radial};
        enemyManager->spawnAt(*worldInstance, heroPosition + offset, enemyLevel);
        if (!enemies.empty()) {
            enemies.back()->huntable().spawnAnimTimer = 0.0f;
            if (!options.attackShowcaseWeapon.empty()) {
                dof::entities::WeaponType weaponType;
                if (!dof::entities::parseWeaponTypeToken(options.attackShowcaseWeapon, weaponType)) {
                    throw std::runtime_error("Unknown attack showcase weapon: "
                                             + options.attackShowcaseWeapon);
                }
                enemies.back()->loadout().takeWeapons();
                enemies.back()->loadout().addWeapon(weaponMaker->makeAtLevel(
                    worldInstance->allocateId(), weaponType, enemyLevel));
            }
        }
    }
}

void GameSession::initializeShaders() {
    std::filesystem::path shaderDir = "assets/shaders";
    if (!std::filesystem::exists(shaderDir)) {
        shaderDir = "../assets/shaders";
    }
    // No GLSL support on this GPU/driver/context — every renderer already has a
    // shaderless fallback, so skip loading with one clean line instead of 20
    // "failed to compile" errors.
    if (!shaderLoader.hasSystemSupport()) {
        std::cerr << "[dogmax] shaders unavailable on this GPU/driver — "
                     "running with shaderless fallbacks." << std::endl;
        return;
    }
    const auto efxDir = shaderDir / "effects";
    const std::pair<const char*, std::filesystem::path> shaders[] = {
        {"desaturation", shaderDir / "desaturation.frag"},
        {"die",          shaderDir / "die.frag"},
        {"enemy",        shaderDir / "enemy.frag"},
        {"hero",         shaderDir / "hero.frag"},
        {"bloom_bright", shaderDir / "bloom_bright.frag"},
        {"bloom_blur",   shaderDir / "bloom_blur.frag"},
        // Effects library — 10 base fragment shaders for the 100-effect catalog.
        {"effect_ring",    efxDir / "effect_ring.frag"},
        {"effect_spark",   efxDir / "effect_spark.frag"},
        {"effect_glow",    efxDir / "effect_glow.frag"},
        {"effect_slash",   efxDir / "effect_slash.frag"},
        {"effect_orb",     efxDir / "effect_orb.frag"},
        {"effect_smoke",   efxDir / "effect_smoke.frag"},
        {"effect_bolt",    efxDir / "effect_bolt.frag"},
        {"effect_shatter", efxDir / "effect_shatter.frag"},
        {"effect_flame",   efxDir / "effect_flame.frag"},
        {"effect_vortex",  efxDir / "effect_vortex.frag"},
    };
    // Load each shader independently: one shader failing to compile (e.g. a
    // driver-specific GLSL quirk) must not skip all the others. Only the
    // offending shader is named, and its consumer falls back to shaderless.
    for (const auto& [name, path] : shaders) {
        try {
            shaderLoader.loadShader(name, path);
        } catch (const std::exception& e) {
            std::cerr << "[dogmax] shader '" << name << "' failed to load: "
                      << e.what() << " (using fallback)" << std::endl;
        }
    }
}

void GameSession::applyConfigToRenderers(sf::Vector2u windowSize) {
    const bool wasWorldEditorOpen = worldEditor && worldEditor->isOpen();
    const sf::Vector2f previousWorldEditorFocus = worldEditor
        ? worldEditor->cameraFocus() : sf::Vector2f{};
    // Build the renderer and both objects that retain references into it as one
    // local lifetime group. Only publish the group after every constructor
    // succeeds; a failed live apply therefore leaves the old, internally
    // consistent group alive, with its editor-open state available for retry.
    auto nextCamera = std::make_unique<dof::render::Camera>(configLoader);
    if (options.cameraZoomOverride > 0.0f) {
        nextCamera->setZoom(options.cameraZoomOverride);
    }
    auto nextWorldRenderer = std::make_unique<dof::render::WorldRenderer>(
        configLoader, colorTheme, fontLoader.font(), &shaderLoader, options.seed,
        *worldEnvironment);
    if (evasionHub) nextWorldRenderer->setEvasionHub(*evasionHub);
    // Build-reactive hero glow (visual_identity.md Step 6) reads equipped
    // build strength straight off LuckHub at render time.
    if (luckHub) nextWorldRenderer->setLuckHub(*luckHub);
    // card-mpmzn7np — wire the DodgeSystem so the world renderer can
    // paint the per-charge HUD dots below the hero each frame.
    if (dodgeSystem) nextWorldRenderer->setDodgeSystem(*dodgeSystem);
    auto nextWorldEditor = std::make_unique<dof::render::WorldEditor>(
        configLoader, *worldEnvironment, nextWorldRenderer->environmentVisuals(),
        fontLoader.font(), [this] {
            if (enemyManager && worldInstance && worldEnvironment) {
                enemyManager->synchronizeWorldEditorEnemies(
                    *worldInstance, *worldEnvironment);
            }
        });
    // Both launch flags are consumed ONCE. applyConfigToRenderers reruns on
    // every config-dirty edge, every `,` and every Ctrl+R — so left latched,
    // --world-editor re-opened the editor after the user closed it (discarding
    // the camera focus), and --world-editor-save-on-start rewrote
    // configs/world_editor.yaml on every one of those rebuilds. That file holds
    // hand-authored level design, so a repeated automatic write is destructive.
    if (wasWorldEditorOpen) nextWorldEditor->openAt(previousWorldEditorFocus);
    else if (std::exchange(options.isWorldEditorOpen, false)) {
        nextWorldEditor->openAt(worldInstance->hero().moveable().position);
    }
    if (std::exchange(options.isWorldEditorSaveOnStart, false)) nextWorldEditor->save();
    // Ctrl+E Enemy Design Editor — modal per-type YAML design tool that
    // pushes live edits back into the world renderer's template registry.
    auto nextEnemyDesignEditor = std::make_unique<dof::render::EnemyDesignEditor>(
        fontLoader.font(),
        configLoader,
        *nextWorldRenderer,
        shaderLoader,
        configLoader.getString("ENEMY_TEMPLATE_DIR"),
        "build/configs/enemies",
        configLoader.getFloat("ENEMY_EDITOR_PREVIEW_SIZE"));
    // Destroy dependants before their old owner, then publish the complete new
    // group. The local editor references remain valid after their renderer's
    // unique_ptr is moved into the session.
    worldEditor.reset();
    enemyDesignEditor.reset();
    camera = std::move(nextCamera);
    worldRenderer = std::move(nextWorldRenderer);
    worldEditor = std::move(nextWorldEditor);
    enemyDesignEditor = std::move(nextEnemyDesignEditor);

    uiRenderer = std::make_unique<dof::render::UiRenderer>(configLoader, colorTheme, fontLoader.font(), &shaderLoader);
    // Part 2 — every UI layout receives the UI design size, not the
    // live window size. The `uiView` letterboxes the window to this
    // design space so each layout's spec-pixel constants render at a
    // uniform on-screen scale regardless of window dimensions.
    uiDesignSize = sf::Vector2u{static_cast<unsigned>(configLoader.getInt("UI_DESIGN_WIDTH")),
                                  static_cast<unsigned>(configLoader.getInt("UI_DESIGN_HEIGHT"))};
    rebuildUiView(windowSize);
    weaponSlotLayout = std::make_unique<dof::render::WeaponSlotLayout>(configLoader, uiDesignSize);
    inventoryLayout = std::make_unique<dof::render::InventoryLayout>(configLoader, uiDesignSize,
                                                                      weaponSlotLayout->sidebarWidth(),
                                                                      weaponSlotLayout->barBottomReservation());
    inventoryRenderer = std::make_unique<dof::render::InventoryRenderer>(
        configLoader, colorTheme, fontLoader.font(), &shaderLoader);
    if (interactionController) interactionController->setInventoryRenderer(*inventoryRenderer);
    weaponSlotSidebar = std::make_unique<dof::render::WeaponSlotSidebar>(configLoader, colorTheme, fontLoader.font(), &shaderLoader);
    tooltipRenderer = std::make_unique<dof::render::TooltipRenderer>(configLoader, colorTheme, fontLoader.font(), &shaderLoader);
    combatTextRenderer = std::make_unique<dof::render::CombatTextRenderer>(configLoader, colorTheme, fontLoader.font());
    attackVfxRenderer = std::make_unique<dof::render::AttackVfxRenderer>(configLoader);
    bloomPipeline = std::make_unique<dof::render::BloomPipeline>(configLoader,
                                                                 shaderLoader);
    debugPanel = std::make_unique<dof::render::DebugPanel>(configLoader, fontLoader.font(), &shaderLoader);
    // Seed the live drag offset from the panel's configured initial
    // position so first-paint reads from the same source of truth
    // (debug.yaml) the panel chrome uses.
    uiState.debugPanelOffset = debugPanel->initialOffset();
    // Spec §Console L2912-2989 — console renders as an overlay
    // independent of the tabbed debug panel. Built here (after
    // `fontLoader` + `configLoader` are live) and drained each frame
    // in `renderFrame`.
    consoleOverlay = std::make_unique<dof::render::ConsoleOverlay>(configLoader, fontLoader.font());
    // Spec §Tabs §Performance Tab L2848 — FPS history graph holds the
    // last 120 frames. Allocated once at setup; ticked once per frame
    // in `renderFrame` so a cold reload preserves a continuous window
    // across the reload (Comma key).
    fpsHistory = std::make_unique<dof::render::FpsHistory>(configLoader.getInt("FPS_HISTORY_BUFFER_LENGTH"));
    helpOverlay = std::make_unique<dof::render::HelpOverlay>(configLoader, colorTheme, fontLoader.font());
    // Bottom-right build-version label. VERSION_BUILD comes from the dest-only
    // build/configs/version_build.yaml the CMake post-build step bumps each relink.
    versionOverlay = std::make_unique<dof::render::VersionOverlay>(configLoader, fontLoader.font());
    // Loot filter popup — layout + renderer.
    lootFilterLayout  = std::make_unique<dof::render::LootFilterLayout>(configLoader);
    lootFilterOverlay = std::make_unique<dof::render::LootFilterOverlay>(configLoader, fontLoader.font());
    // DiceCrafter panel (G key).
    diceCrafterPanel = std::make_unique<dof::render::DiceCrafterPanel>(configLoader, fontLoader.font());
    // Phase G (G-misc) — player Settings/Theme window (P key). Rebuilt here on
    // every config change, so its captured geometry + colours (incl. the
    // THEME_PANEL_BG fill and UI_ACCENT stroke it shares) track the live theme.
    settingsPanel = std::make_unique<dof::render::SettingsPanel>(configLoader, fontLoader.font());

    // Effects library — small (50px) renderer + medium/large composers + gameplay facade.
    // configs/effects/ sub-directory is loaded here so the main configLoader has the
    // EFX_* and CEF_*/LEF_* keys before the catalog objects parse them.
    const std::filesystem::path efxCfgDir = std::filesystem::path(options.configDirectory) / "effects";
    // Phase G4 — preserving variant: a plain loadDirectory() here would
    // CLEAR the console-override set (and drop the launch-restored
    // overrides) every time this runs, including on each `,` / Ctrl+R
    // re-apply. The preserving load keeps overrides intact and — because
    // it is not the top-level load — never repoints saveOverrides' home
    // directory to configs/effects.
    if (std::filesystem::exists(efxCfgDir))
        configLoader.loadDirectoryPreservingOverrides(efxCfgDir);
    // EffectsManager owns a reference to EffectsRenderer. Construct and
    // publish them as a pair so either the complete old pair or complete new
    // pair survives an exception.
    auto nextEffectsRenderer = std::make_unique<dof::render::EffectsRenderer>(
        configLoader, shaderLoader);
    auto nextEffectsManager = std::make_unique<dof::game::EffectsManager>(
        *nextEffectsRenderer);
    effectsManager.reset();
    effectsRenderer = std::move(nextEffectsRenderer);
    effectsManager = std::move(nextEffectsManager);

    // Ctrl+S Effects Catalog — built after the effects library so the
    // configLoader already holds all EFX_* / CEF_* / LEF_* keys.
    effectsCatalogWindow = std::make_unique<dof::render::EffectsCatalogWindow>(configLoader, fontLoader.font());
    groupedEffectsCatalog = std::make_unique<dof::render::GroupedEffectsCatalog>(
        configLoader, fontLoader.font());
    // Enemy-shape catalog — loaded once; the unified Gallery's Enemies sub-tab
    // renders these silhouettes (the standalone Ctrl+E panel was removed).
    enemyShapeCatalog = dof::render::loadEnemyShapeCatalog(configLoader);

    // Ctrl+H unified Gallery — scans assets/fonts/showcase/ once at
    // construction and hosts all five sub-tabs.
    componentShowcaseRenderer = std::make_unique<dof::render::ComponentShowcaseRenderer>(
        configLoader, colorTheme, fontLoader.font());

    // Phase G5 — the renderers now reflect the current config, so lower the
    // dirty edge. Covers every caller: launch, the `,` / Ctrl+R reloads, and
    // the per-frame live re-apply GameSession runs after an editable-row or
    // console `set` override. A persisted override restored during a load
    // sets the edge (via markAsUserOverride) before we get here; clearing it
    // now means the run loop never triggers a redundant restyle on frame 1.
    configLoader.clearConfigDirty();
}

}
