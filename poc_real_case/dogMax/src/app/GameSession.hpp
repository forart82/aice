#pragma once

#include "app/AppOptions.hpp"
#include "app/Console.hpp"
#include "audio/LevelUpAudio.hpp"
#include "audio/BackgroundMusic.hpp"
#include "audio/PickupAudio.hpp"
#include "audio/SpatialAudio.hpp"
#include "game/EffectsManager.hpp"
#include "render/EffectsRenderer.hpp"
#include "combat/DodgeSystem.hpp"
#include "combat/HitStop.hpp"
#include "combat/DronDetector.hpp"
#include "core/Clock.hpp"
#include "core/World.hpp"
#include "core/WorldEnvironment.hpp"
#include "helpers/RandomHelper.hpp"
#include "hubs/AttackVfxHub.hpp"
#include "hubs/DamageTextHub.hpp"
#include "hubs/EffectBurstHub.hpp"
#include "hubs/EvasionHub.hpp"
#include "hubs/DronFloatTextHub.hpp"
#include "hubs/InventoryHub.hpp"
#include "hubs/LootFilter.hpp"
#include "hubs/LuckHub.hpp"
#include "hubs/PickupHub.hpp"
#include "hubs/PowderHub.hpp"
#include "hubs/VitalityTank.hpp"
#include "hubs/WeaponSlotHub.hpp"
#include "hubs/XpFloatHub.hpp"
#include "loaders/ConfigLoader.hpp"
#include "loaders/FontLoader.hpp"
#include "loaders/NameLoader.hpp"
#include "loaders/ShaderLoader.hpp"
#include "makers/DiceMaker.hpp"
#include "makers/LootMaker.hpp"
#include "makers/NameMaker.hpp"
#include "makers/WeaponMaker.hpp"
#include "managers/EnemyManager.hpp"
#include "managers/FloorItemManager.hpp"
#include "managers/HeroManager.hpp"
#include "managers/WeaponManager.hpp"
#include "render/AttackVfxRenderer.hpp"
#include "render/BloomPipeline.hpp"
#include "render/Camera.hpp"
#include "render/CursorState.hpp"
#include "render/Letterbox.hpp"
#include "render/ResizeArbitration.hpp"
#include "render/ColorTheme.hpp"
#include "render/CombatTextRenderer.hpp"
#include "render/ConsoleOverlay.hpp"
#include "render/DebugPanel.hpp"
#include "render/FpsHistory.hpp"
#include "render/HelpOverlay.hpp"
#include "render/InteractionController.hpp"
#include "render/InventoryLayout.hpp"
#include "render/LootFilterLayout.hpp"
#include "render/LootFilterOverlay.hpp"
#include "render/InventoryRenderer.hpp"
#include "render/ComponentShowcaseRenderer.hpp"
#include "render/TooltipRenderer.hpp"
#include "render/UiRenderer.hpp"
#include "render/DiceCrafterPanel.hpp"
#include "render/SettingsPanel.hpp"
#include "render/EnemyDesignEditor.hpp"
#include "render/EnemyShapeCatalog.hpp"
#include "render/EffectsCatalogWindow.hpp"
#include "render/GroupedEffectsCatalog.hpp"
#include "render/UiState.hpp"
#include "render/VersionOverlay.hpp"
#include "hubs/DiceCrafterHub.hpp"
#include "render/WeaponSlotLayout.hpp"
#include "render/WeaponSlotSidebar.hpp"
#include "render/WorldRenderer.hpp"
#include "render/WorldEditor.hpp"
#include "render/WorldRenderSurface.hpp"

#include <SFML/Graphics/RenderWindow.hpp>
#include <SFML/Graphics/View.hpp>
#include <SFML/Window/Cursor.hpp>
#include <SFML/Window/Keyboard.hpp>

#include <array>
#include <memory>
#include <optional>

namespace sf { class Event; }

namespace dof::app {

class GameSession {
public:
    explicit GameSession(const AppOptions& options);

    int run();

    void stepSimulation(float dt);
    // `,` key hot-reload: re-read every config from disk while KEEPING
    // console `set` overrides (Phase G4), rebuild the color theme, then
    // re-apply config to every renderer so the on-screen UI restyles
    // live. `windowSize` is the caller's live window size (the comma
    // handler passes `window->getSize()`) — needed to rebuild the camera
    // + UI letterbox viewport at the correct resolution.
    void reloadConfig(sf::Vector2u windowSize);

    // Spec §Hero Death — restart helper invoked by the Enter key while
    // the hero is dead and by the Ctrl+R restart key. Wipes
    // the live world, resets hero level/HP/position, clears UI hubs,
    // and re-spawns the starter Pitchfork on the floor.
    void restartRun();

    dof::core::World& world() { return *worldInstance; }
    dof::loaders::ConfigLoader& config() { return configLoader; }

private:
    void initializeShaders();
    // Constructs (or reconstructs) every renderer + camera + UI layout
    // from the current ConfigLoader + colorTheme. Called once at launch
    // and again on every `,` / Ctrl+R reload so a config change restyles
    // the live UI. Idempotent — re-invoking simply replaces the owned
    // renderer objects, capturing fresh config values (Phase G4).
    void applyConfigToRenderers(sf::Vector2u windowSize);
    void spawnStarterPitchfork();
    void preloadPerformanceEnemies();
    void processWindowEvents(sf::RenderWindow& window);
    // Shared one-event handler — the body extracted from the former poll
    // loop. Driven by `processWindowEvents`, once per real OS event.
    void processEvent(const sf::Event& eventRef, sf::RenderWindow* window);
    // Mouse / wheel / resize half of `processEvent`, split into its own
    // TU so event routing stays focused. Called from `processEvent`
    // after the keyboard + text handlers.
    void processMouseEvent(const sf::Event& eventRef, sf::RenderWindow& window);
    void handleMouseMoved(const sf::Event& eventRef, sf::RenderWindow& window);
    void handleMouseButtonPressed(const sf::Event& eventRef, sf::RenderWindow& window);
    void handleMouseButtonReleased(const sf::Event& eventRef, sf::RenderWindow& window);
    void handleMouseWheelScrolled(const sf::Event& eventRef, sf::RenderWindow& window);
    void handleWindowResized(sf::RenderWindow& window);
    void handleKeyPressed(const sf::Event& eventRef, sf::RenderWindow* window);
    void handleTextEntered(const sf::Event& eventRef);
    void renderFrame(sf::RenderWindow& window, float currentFps);
    void applyKeyboardInputsToHero();
    void finishMouseGesturesBeforeHelp(sf::RenderWindow* window);

    // Phase G5 — editable Config tab (debug panel). `handleConfigTabClick`
    // hit-tests a left-click on the Config tab against the Save button + the
    // value-row bands the panel captured last frame: Save persists overrides,
    // a row focuses it for editing, a click elsewhere unfocuses. Returns true
    // when it consumed the click. `handleConfigEditKey` routes one key press
    // to the focused editable row (Enter commits a validated override, Esc
    // cancels, edit keys mutate the buffer); returns true while a row is
    // focused so the key is swallowed and never leaks to a hero hotkey. Both
    // live in GameSession_Input.cpp to keep the event routing cohesive.
    bool handleConfigTabClick(sf::Vector2f cursorUi);
    bool handleConfigEditKey(sf::Keyboard::Key key);

    // Phase G (G-misc) — player Settings/Theme panel mouse routing. While
    // `uiState.isSettingsOpen`, this consumes mouse move/press/release/wheel
    // so a slider drag never leaks to the world or another panel: a press on
    // a slider band arms `uiState.settingsDragRow` + jumps the value, a drag
    // (move) retargets it, a press on a toggle box flips its 0/1, and the
    // Save button persists via ConfigLoader::saveOverrides. Every value edit
    // goes through ConfigLoader::setOverride, whose per-frame dirty ->
    // applyConfigToRenderers makes it live. Returns true when it consumed the
    // event (Resized always falls through). Lives in GameSession_Input.cpp so
    // settings routing remains separate from raw mouse dispatch.
    bool handleSettingsMouseEvent(const sf::Event& eventRef, sf::RenderWindow& window);
    sf::Vector2f currentCursorWorld(sf::RenderWindow& window) const;
    sf::Vector2f mapWindowPixelToWorld(sf::RenderWindow& window,
                                       sf::Vector2i pixel) const;
    // Part 2 — UI-space mouse mapping. Converts a raw window-pixel
    // position (as reported by SFML mouse events) into the UI design
    // coordinate space by inverting the `uiView`'s letterbox viewport.
    sf::Vector2f mapWindowPixelToUi(sf::RenderWindow& window, sf::Vector2i pixel) const;
    // Part 2 — rebuilds `uiView` for the given live window size, using
    // the configured UI design dimensions + letterbox viewport.
    void rebuildUiView(sf::Vector2u windowSize);

    // `SpawnWeapon=N` / `SpawnEnemy=N` / `SpawnDice=N` console cheats.
    // Caller already validated `level` ∈ [1, 100] (the parser refuses
    // other values). Spawns the entity beside the hero at a deterministic
    // offset (east by `ITEM_PICKUP_RADIUS + INV_CONSOLE_SPAWN_BAND_PX`)
    // so the spawn starts safely outside the auto-pickup ring.
    // T-CHEAT-spawn-type-arg — `typeName` is the canonical lowercase
    // token from `ConsoleCommand::spawnTypeName` (empty = random).
    void dispatchSpawnWeapon(int level, const std::string& typeName = {});
    void dispatchSpawnEnemy(int level, const std::string& typeName = {});
    void dispatchSpawnDice(int level, const std::string& typeName = {});

    AppOptions                                       options;
    dof::loaders::ConfigLoader                       configLoader;
    dof::loaders::FontLoader                         fontLoader;
    dof::loaders::ShaderLoader                       shaderLoader;
    dof::helpers::RandomHelper                       rng;
    dof::core::Clock                                 clock;
    std::unique_ptr<dof::core::World>                worldInstance;
    std::unique_ptr<dof::core::WorldEnvironment>         worldEnvironment;
    dof::managers::HeroManager                       heroManager;
    std::unique_ptr<dof::managers::EnemyManager>     enemyManager;
    dof::managers::FloorItemManager                  floorItemManager;
    dof::hubs::PickupHub                             pickupHub;
    std::unique_ptr<dof::audio::PickupAudio>         pickupAudio;
    std::unique_ptr<dof::audio::LevelUpAudio>        levelUpAudio;
    std::unique_ptr<dof::audio::SpatialAudio>        spatialAudio;
    std::unique_ptr<dof::audio::BackgroundMusic>     backgroundMusic;
    dof::loaders::NameLoader                         nameLoader;
    std::unique_ptr<dof::makers::NameMaker>          nameMaker;
    std::unique_ptr<dof::makers::WeaponMaker>        weaponMaker;
    std::unique_ptr<dof::makers::DiceMaker>          diceMaker;
    std::unique_ptr<dof::makers::LootMaker>          lootMaker;
    std::unique_ptr<dof::hubs::InventoryHub>         inventoryHub;
    std::unique_ptr<dof::hubs::WeaponSlotHub>        weaponSlotHub;
    std::unique_ptr<dof::combat::DronDetector>       dronDetector;
    // card-mpkz662b part 1b — new active Doge (Space-key dash).
    std::unique_ptr<dof::combat::DodgeSystem>        dodgeSystem;
    // Impact freeze (visual_identity.md Step 8). Owned by value here rather
    // than by a manager because it gates the simulation clock itself, which is
    // this class's own loop.
    dof::combat::HitStop                            hitStop;
    // Transition bursts queued by managers, drained into the effects
    // renderer each frame so simulation never touches render code.
    dof::hubs::EffectBurstHub                       effectBurstHub;
    // Converts a burst's radius into camera trauma, so a bigger impact
    // shakes harder without every call site carrying its own shake value.
    float                                           cameraShakeTraumaPerBurstPixel{0.0f};
    std::unique_ptr<dof::hubs::DamageTextHub>        damageTextHub;
    std::unique_ptr<dof::hubs::DronFloatTextHub>     dronFloatTextHub;
    std::unique_ptr<dof::hubs::AttackVfxHub>         attackVfxHub;
    std::unique_ptr<dof::hubs::EvasionHub>              evasionHub;
    std::unique_ptr<dof::hubs::LuckHub>              luckHub;
    std::unique_ptr<dof::hubs::XpFloatHub>           xpFloatHub;
    std::unique_ptr<dof::hubs::PowderHub>            powderHub;
    std::unique_ptr<dof::hubs::VitalityTank>         vitalityTank;
    std::unique_ptr<dof::managers::WeaponManager>    weaponManager;
    dof::render::UiState                             uiState;
    std::unique_ptr<dof::render::InteractionController> interactionController;
    dof::render::ColorTheme                          colorTheme;
    std::unique_ptr<dof::render::Camera>             camera;
    std::unique_ptr<dof::render::WorldRenderer>      worldRenderer;
    std::unique_ptr<dof::render::WorldEditor>        worldEditor;
    dof::render::WorldRenderSurface                  worldRenderSurface;
    std::unique_ptr<dof::render::UiRenderer>         uiRenderer;
    std::unique_ptr<dof::render::InventoryLayout>    inventoryLayout;
    std::unique_ptr<dof::render::WeaponSlotLayout>   weaponSlotLayout;
    std::unique_ptr<dof::render::InventoryRenderer>     inventoryRenderer;
    std::unique_ptr<dof::render::ComponentShowcaseRenderer>  componentShowcaseRenderer;
    std::unique_ptr<dof::render::WeaponSlotSidebar>  weaponSlotSidebar;
    std::unique_ptr<dof::render::TooltipRenderer>    tooltipRenderer;
    std::unique_ptr<dof::render::CombatTextRenderer> combatTextRenderer;
    std::unique_ptr<dof::render::AttackVfxRenderer>  attackVfxRenderer;
    std::unique_ptr<dof::render::EffectsRenderer>    effectsRenderer;
    std::unique_ptr<dof::game::EffectsManager>       effectsManager;
    std::unique_ptr<dof::render::BloomPipeline>      bloomPipeline;
    std::unique_ptr<dof::render::DebugPanel>         debugPanel;
    std::unique_ptr<dof::render::ConsoleOverlay>     consoleOverlay;
    std::unique_ptr<dof::render::FpsHistory>         fpsHistory;
    std::unique_ptr<dof::render::HelpOverlay>        helpOverlay;
    std::unique_ptr<dof::render::VersionOverlay>     versionOverlay;
    // DiceCrafter (G key): hub holds the slotted dice; panel renders and
    // hit-tests the DiceCrafter window. `diceCrafterResultText` carries the last
    // operation's human-readable outcome for one-frame display.
    dof::hubs::DiceCrafterHub                              diceCrafterHub;
    std::unique_ptr<dof::render::DiceCrafterPanel>         diceCrafterPanel;
    std::string                                      diceCrafterResultText;
    // Phase G (G-misc) — player Settings/Theme window (P key). Rebuilt by
    // applyConfigToRenderers on every config change so its styling tracks the
    // live theme; open flag + drag row live in uiState.
    std::unique_ptr<dof::render::SettingsPanel>           settingsPanel;
    // Ctrl+E Enemy Design Editor — modal per-type YAML design tool.
    std::unique_ptr<dof::render::EnemyDesignEditor>       enemyDesignEditor;
    // Ctrl+E enemy-shape gallery: catalog of procedural symmetric silhouettes
    // + its modal preview panel.
    std::vector<dof::render::EnemyShapeSpec>              enemyShapeCatalog;
    // Ctrl+S Effects Catalog — three-tab scrollable window with live shader previews.
    std::unique_ptr<dof::render::EffectsCatalogWindow>     effectsCatalogWindow;
    std::unique_ptr<dof::render::GroupedEffectsCatalog>    groupedEffectsCatalog;
    // Loot filter: data model + layout + overlay renderer.
    dof::hubs::LootFilter                            lootFilter;
    std::unique_ptr<dof::render::LootFilterLayout>   lootFilterLayout;
    std::unique_ptr<dof::render::LootFilterOverlay>  lootFilterOverlay;
    // Applies lootFilter to the current inventory contents (powder-
    // converts all matching slots). Called on filter change.
    void applyLootFilterToInventory();
    std::unique_ptr<dof::app::Console>               console;
    // SA34 — cursor cache. SFML 3 builds an `sf::Cursor` per system
    // type; we build each one lazily on first request and reuse it
    // every frame. Sized to cover every `sf::Cursor::Type` enumerator
    // (SizeAll == 17 in this SFML build) — indexing by enum value must
    // never exceed the array bound.
    std::array<std::optional<sf::Cursor>, static_cast<std::size_t>(sf::Cursor::Type::NotAllowed) + 1> cachedCursors;
    // Part 2 — UI design viewport. Built at the configured
    // `UI_DESIGN_WIDTH/HEIGHT`; rebuilt on every window resize so the
    // letterbox viewport tracks the live window dimensions. Every UI
    // pass (UiRenderer / WeaponSlotSidebar /
    // TooltipRenderer / DebugPanel / HelpOverlay) runs under this view
    // so UI elements scale uniformly with the window.
    sf::View      uiView;
    sf::Vector2u  uiDesignSize{0u, 0u};
    bool shouldQuit{false};
    int  lastHeroDashSoundId{0};
    bool wasHeroDeadForSfx{false};

    // Counts down from WINDOW_INITIAL_FOCUS_FRAMES to 0; requestFocus()
    // is called each frame while > 0, then stops. Reset to 0 early when
    // a FocusGained event arrives so we don't keep re-requesting needlessly.
    int                   initialFocusFramesLeft_{0};
};

}
