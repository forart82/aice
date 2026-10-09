#include "app/GameSession.hpp"

#include "app/ConsoleToggle.hpp"
#include "entities/Dice.hpp"
#include "entities/Enemy.hpp"
#include "entities/FloorItem.hpp"
#include "entities/Hero.hpp"
#include "entities/SpecialEnemyKind.hpp"
#include "entities/Weapon.hpp"
#include "diagnostics/FrameProfiler.hpp"

#include <SFML/Graphics/Image.hpp>
#include <SFML/Graphics/RenderWindow.hpp>
#include <SFML/Graphics/Texture.hpp>
#include <SFML/System/Sleep.hpp>
#include <SFML/Window/Event.hpp>
#include <SFML/Window/Keyboard.hpp>

#include <algorithm>
#include <chrono>
#include <exception>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <limits>
#include <string>
#include <thread>

namespace dof::app {

namespace {

float currentRealDelta(std::chrono::steady_clock::time_point& last) {
    const auto now = std::chrono::steady_clock::now();
    const auto delta = std::chrono::duration<float>(now - last).count();
    last = now;
    return delta;
}

template <typename Fn>
float measureMilliseconds(Fn&& fn) {
    const auto start = std::chrono::steady_clock::now();
    fn();
    const auto end = std::chrono::steady_clock::now();
    return std::chrono::duration<float, std::milli>(end - start).count();
}

struct PerformanceRunStats {
    int frameSamples{0};
    int simSamples{0};
    int renderSamples{0};
    std::size_t maxEnemyCount{0};
    float simulatedSeconds{0.0f};
    double enemyManagerSum{0.0};
    double enemyManagerMax{0.0};
    double weaponManagerSum{0.0};
    double weaponManagerMax{0.0};
    double hubUpdateSum{0.0};
    double hubUpdateMax{0.0};
    double gridRebuildSum{0.0};
    double gridRebuildMax{0.0};
    double worldRenderSum{0.0};
    double worldRenderMax{0.0};
    double totalRenderFrameSum{0.0};
    double totalRenderFrameMax{0.0};

    void record(dof::diagnostics::FrameTimings timings,
                bool hasWindow,
                float totalRenderFrameMs,
                std::size_t enemyCount,
                float seconds) {
        ++frameSamples;
        maxEnemyCount = std::max(maxEnemyCount, enemyCount);
        simulatedSeconds = seconds;

        const bool hasSimSample = timings.enemyManagerMs > 0.0f
                               || timings.weaponManagerMs > 0.0f
                               || timings.hubUpdateMs > 0.0f
                               || timings.gridRebuildMs > 0.0f;
        if (hasSimSample) {
            ++simSamples;
            enemyManagerSum += timings.enemyManagerMs;
            enemyManagerMax = std::max(enemyManagerMax, static_cast<double>(timings.enemyManagerMs));
            weaponManagerSum += timings.weaponManagerMs;
            weaponManagerMax = std::max(weaponManagerMax, static_cast<double>(timings.weaponManagerMs));
            hubUpdateSum += timings.hubUpdateMs;
            hubUpdateMax = std::max(hubUpdateMax, static_cast<double>(timings.hubUpdateMs));
            gridRebuildSum += timings.gridRebuildMs;
            gridRebuildMax = std::max(gridRebuildMax, static_cast<double>(timings.gridRebuildMs));
        }

        if (hasWindow) {
            ++renderSamples;
            worldRenderSum += timings.worldRenderMs;
            worldRenderMax = std::max(worldRenderMax, static_cast<double>(timings.worldRenderMs));
            totalRenderFrameSum += totalRenderFrameMs;
            totalRenderFrameMax = std::max(totalRenderFrameMax, static_cast<double>(totalRenderFrameMs));
        }
    }
};

double average(double sum, int count) {
    return count > 0 ? sum / static_cast<double>(count) : 0.0;
}

double fpsFromMs(double milliseconds) {
    return milliseconds > std::numeric_limits<double>::epsilon()
               ? 1000.0 / milliseconds
               : 0.0;
}

void writePerformanceReport(const std::string& path,
                            const PerformanceRunStats& stats,
                            int requestedEnemies) {
    std::ostream* output = &std::cout;
    std::ofstream file;
    if (!path.empty()) {
        const std::filesystem::path reportPath(path);
        if (reportPath.has_parent_path()) {
            std::filesystem::create_directories(reportPath.parent_path());
        }
        file.open(reportPath);
        if (!file) {
            throw std::runtime_error("failed to write performance report: " + path);
        }
        output = &file;
    }

    const double avgRender = average(stats.worldRenderSum, stats.renderSamples);
    *output << std::fixed << std::setprecision(3)
            << "dogmax performance report\n"
            << "requested_enemies: " << requestedEnemies << '\n'
            << "max_enemy_count: " << stats.maxEnemyCount << '\n'
            << "simulated_seconds: " << stats.simulatedSeconds << '\n'
            << "frame_samples: " << stats.frameSamples << '\n'
            << "sim_samples: " << stats.simSamples << '\n'
            << "render_samples: " << stats.renderSamples << '\n'
            << "avg_enemy_manager_ms: " << average(stats.enemyManagerSum, stats.simSamples) << '\n'
            << "max_enemy_manager_ms: " << stats.enemyManagerMax << '\n'
            << "avg_weapon_manager_ms: " << average(stats.weaponManagerSum, stats.simSamples) << '\n'
            << "max_weapon_manager_ms: " << stats.weaponManagerMax << '\n'
            << "avg_hub_update_ms: " << average(stats.hubUpdateSum, stats.simSamples) << '\n'
            << "max_hub_update_ms: " << stats.hubUpdateMax << '\n'
            << "avg_grid_rebuild_ms: " << average(stats.gridRebuildSum, stats.simSamples) << '\n'
            << "max_grid_rebuild_ms: " << stats.gridRebuildMax << '\n'
            << "avg_world_render_ms: " << avgRender << '\n'
            << "max_world_render_ms: " << stats.worldRenderMax << '\n'
            << "estimated_world_render_fps: " << fpsFromMs(avgRender) << '\n'
            << "avg_total_render_frame_ms: "
            << average(stats.totalRenderFrameSum, stats.renderSamples) << '\n'
            << "max_total_render_frame_ms: " << stats.totalRenderFrameMax << '\n'
            << "estimated_total_render_frame_fps: "
            << fpsFromMs(average(stats.totalRenderFrameSum, stats.renderSamples)) << '\n';
}

}



int GameSession::run() {
    sf::Vector2u windowSize{static_cast<unsigned>(configLoader.getInt("WINDOW_WIDTH")),
                             static_cast<unsigned>(configLoader.getInt("WINDOW_HEIGHT"))};
    std::unique_ptr<sf::RenderWindow> window;
    // Offscreen mode renders into a never-shown window so GIF capture and
    // screenshots produce real rendered pixels without a visible window
    // popping on screen — a headless GIF/screenshot run with no UI footprint.
    const bool wantWindow = !options.isHeadless || options.isOffscreen;
    if (wantWindow) {
        window = std::make_unique<sf::RenderWindow>(sf::VideoMode(windowSize),
                                                     configLoader.getString("WINDOW_TITLE"));
        if (options.isOffscreen) window->setVisible(false);
        window->setVerticalSyncEnabled(configLoader.getInt("WINDOW_VSYNC") != 0);
        int limit = configLoader.getInt("WINDOW_FRAME_LIMIT");
        // Vsync is inactive for hidden offscreen windows (no display to sync to),
        // so apply an explicit cap to keep the offscreen frame rate bounded.
        if (options.isOffscreen) {
            const int cap = configLoader.getInt("OFFSCREEN_FPS_CAP");
            if (cap > 0) limit = cap;
        }
        if (limit > 0) window->setFramerateLimit(static_cast<unsigned>(limit));
        // card-mpl1oj89 — request platform focus immediately after
        // window creation so the keyboard cursor doesn't stay bound
        // to whatever editable widget had focus before the launcher
        // ran. SFML's `requestFocus` is a hint to the WM; on most
        // platforms it grabs focus on the first paint, on others
        // (some tiling WMs) it raises an attention indicator the user
        // can act on. Either way, the previous "open the game, type,
        // text goes into VS Code" footgun goes away.
        // A hidden offscreen window must never grab the user's focus.
        if (!options.isOffscreen) window->requestFocus();
        applyConfigToRenderers(windowSize);
    }

    auto lastWall = std::chrono::steady_clock::now();
    float fps = 0.0f;
    auto fpsAccumulator = std::chrono::steady_clock::now();
    int framesSinceMeasure = 0;
    const int headlessSleepMs = configLoader.getInt("HEADLESS_TICK_SLEEP_MS");
    const bool isPerformanceRun = options.performanceEnemyCount > 0
                               || !options.performanceReportPath.empty();
    PerformanceRunStats performanceStats;
    // card-mpl9dq9y — the one-shot requestFocus at window creation
    // sometimes fires before the WM has mapped the window (X11/
    // Wayland tile-WMs commonly delay map), so the grab never lands.
    // Re-call requestFocus each frame until the window acknowledges
    // focus (FocusGained event resets the counter to 0) or until the
    // config budget expires. WINDOW_INITIAL_FOCUS_FRAMES defaults to
    // 120 (~2 s at 60 fps) to cover slow/tiling compositors.
    initialFocusFramesLeft_ =
        options.isOffscreen ? 0 : configLoader.getInt("WINDOW_INITIAL_FOCUS_FRAMES");

    while (!shouldQuit) {
        dof::diagnostics::resetFrameTimings();
        if (window && initialFocusFramesLeft_ > 0) {
            window->requestFocus();
            --initialFocusFramesLeft_;
        }
        if (window) processWindowEvents(*window);
        // A Closed event shuts down the native window immediately. Do not run
        // one final simulation/render pass against that closed graphics
        // context; leave the loop at the same boundary where quit was raised.
        if (shouldQuit || (window && !window->isOpen())) break;

        // Phase G5 — a live config edit (editable Config tab commit or a
        // console `set`) raised the dirty edge during event handling. Re-apply
        // config to every renderer so the change shows THIS frame — this is
        // what makes an in-game tweak (and console `set`) restyle live without
        // a manual `,` reload. Wrapped in try/catch: an override a getter
        // later fails to parse (e.g. a stray `set NUMERIC=abc`) must never
        // crash the loop. Renderer/dependant lifetime groups are constructed
        // before publication, so a mid-throw cannot leave an editor or manager
        // referencing a destroyed renderer. The panel drag offset + body
        // scroll are saved/restored so the restyle never yanks the debug panel
        // back to its spawn spot or jumps the Config list to the top mid-edit.
        if (window && configLoader.isConfigDirty()) {
            const auto savedPanelOffset = uiState.debugPanelOffset;
            const int  savedScroll = debugPanel ? debugPanel->scrollOffset() : 0;
            try {
                applyConfigToRenderers(window->getSize());
                configLoader.clearConfigDirty();
            } catch (const std::exception& e) {
                std::cerr << "WARNING: live config apply failed: " << e.what() << std::endl;
                if (debugPanel) debugPanel->setConfigStatus(std::string("apply failed: ") + e.what());
            }
            uiState.debugPanelOffset = savedPanelOffset;
            if (debugPanel) debugPanel->scrollBy(savedScroll);
        }

        const float realDelta = currentRealDelta(lastWall);
        // Hit-stop counts down on REAL time: while it is frozen the simulation
        // does not step, so a sim-time countdown would never expire and the
        // first hit of the run would lock the game.
        hitStop.advanceRealTime(realDelta);
        // Debug speed scale: 0 = frozen, 1 = normal, 4 = 4× speed.
        // Impact freeze multiplies in as a hard zero, so it stacks with the
        // debug scale instead of fighting it.
        clock.accumulate(realDelta * uiState.gameTimeScale
                         * (hitStop.isFrozen() ? 0.0f : 1.0f));
        while (clock.consumeStep()) {
            stepSimulation(clock.fixedDt());
        }

        float totalRenderFrameMs = 0.0f;
        if (window) {
            totalRenderFrameMs = measureMilliseconds([&] {
                renderFrame(*window, fps);
            });
            ++framesSinceMeasure;
            const auto now = std::chrono::steady_clock::now();
            const auto diff = std::chrono::duration<float>(now - fpsAccumulator).count();
            if (diff >= 0.5f) {
                fps = static_cast<float>(framesSinceMeasure) / diff;
                framesSinceMeasure = 0;
                fpsAccumulator = now;
            }
        } else {
            std::this_thread::sleep_for(std::chrono::milliseconds(headlessSleepMs));
        }

        if (isPerformanceRun) {
            performanceStats.record(dof::diagnostics::frameTimings(),
                                    window != nullptr,
                                    totalRenderFrameMs,
                                    worldInstance->enemies().size(),
                                    clock.simulatedSeconds());
        }

        if (options.selfTestDurationSeconds > 0.0f
            && clock.simulatedSeconds() >= options.selfTestDurationSeconds) {
            shouldQuit = true;
        }

        if (window && !options.screenshotPath.empty()
            && clock.simulatedSeconds() >= options.screenshotDelaySeconds) {
            sf::Texture grab(window->getSize());
            grab.update(*window);
            (void)grab.copyToImage().saveToFile(options.screenshotPath);
            shouldQuit = true;
        }
    }

    if (isPerformanceRun) {
        writePerformanceReport(options.performanceReportPath,
                               performanceStats,
                               options.performanceEnemyCount);
    }

    return 0;
}

void GameSession::reloadConfig(sf::Vector2u windowSize) {
    // `,` hot-reload (Phase G4). Use the PRESERVING load so a prior
    // console `set` survives the reload (the old plain loadDirectory here
    // silently cleared every override). Rebuild the color theme from the
    // refreshed values, then re-apply config to the renderers so every UI
    // panel restyles live — previously the renderers captured their
    // colors/sizes only at construction, so a config change never showed
    // on screen until the next launch.
    configLoader.loadDirectoryPreservingOverrides(options.configDirectory);
    colorTheme = dof::render::buildColorTheme(configLoader);
    if (evasionHub) evasionHub->refreshConfig(configLoader);
    if (diceMaker) diceMaker->refreshConfig();
    if (worldEnvironment) worldEnvironment->load(configLoader);
    applyConfigToRenderers(windowSize);
}

void GameSession::stepSimulation(float dt) {
    // Presentation drain — MUST stay above every early return below.
    //
    // This ran at the end of the function and that was a real bug: the
    // world-editor branch and the two hero-death returns all skip the rest of
    // the step. The killing blow queues the hero-hurt burst and then the death
    // return fires in the same tick, so the single most important impact in a
    // run never played; and advanceShake is the only thing that decays trauma,
    // so a death or an editor session froze the camera at a constant offset.
    //
    // Draining at the TOP means a burst queued this tick plays on the next one.
    // One tick of latency at 60 Hz is imperceptible, and it buys the guarantee
    // that the queue is always serviced no matter which branch the step takes.
    //
    // Camera shake is fed from the same queue, so impact size drives shake size
    // with no second event path to keep in sync. Trauma is capped inside Camera,
    // so a swarm cannot stack it into an unreadable screen.
    if (camera) {
        for (const auto& burst : effectBurstHub.drain()) {
            camera->addShakeTrauma(burst.radius * cameraShakeTraumaPerBurstPixel);
        }
        camera->advanceShake(dt);
    }
    if (effectsRenderer) {
        for (const auto& burst : effectBurstHub.drain()) {
            effectsRenderer->play(burst.effectName, burst.position,
                                  burst.radius, 0.0f, &burst.color);
        }
    }
    effectBurstHub.clear();

    auto& hero = worldInstance->hero();
    hero.moveable().beginSimulationStep();
    for (const auto& enemy : worldInstance->enemies()) {
        if (enemy) enemy->moveable().beginSimulationStep();
    }
    if (spatialAudio) {
        spatialAudio->setListenerPosition(hero.moveable().position);
        spatialAudio->cleanup();
    }
    applyKeyboardInputsToHero();
    if (worldEditor && worldEditor->isOpen()) {
        if (!uiState.isHelpVisible) {
            worldEditor->updateCamera(dt, camera ? camera->currentZoom() : 1.0f);
        }
        auto& input = hero.inputable();
        input.isPressedW = false;
        input.isPressedA = false;
        input.isPressedS = false;
        input.isPressedD = false;
        return;
    }
    const bool isGameplayKeyBlocked = options.isHeadless
        || uiState.isConsoleFocused
        || uiState.isSettingsOpen
        || uiState.isDebugSearchFocused
        || uiState.isLootFilterQualityFocused
        || uiState.isLootFilterLevelFocused
        || (debugPanel && debugPanel->isConfigEditActive());
    if (!isGameplayKeyBlocked && vitalityTank
        && sf::Keyboard::isKeyPressed(sf::Keyboard::Key::Q)) {
        vitalityTank->transferTo(hero.damageable(), dt);
    }
    // Spec §Hero Death L478: world freezes when the hero dies — every
    // per-frame world tick stops *except* HeroManager. HeroManager keeps
    // running because it advances `deathable().deathTimer` (the source
    // of truth for the fade ramp) and decays the attack/level-up flash
    // channels so they fade cleanly on the killing blow. Individual
    // sub-system gates (PickupHub, WeaponManager, EnemyManager::tickAi)
    // remain as belt-and-suspenders.
    heroManager.update(hero, dt);
    hero.targetable().anchorPosition = hero.moveable().position;
    if (spatialAudio) {
        spatialAudio->setListenerPosition(hero.moveable().position);
        if (hero.dashId() != lastHeroDashSoundId) {
            lastHeroDashSoundId = hero.dashId();
            if (lastHeroDashSoundId > 0) spatialAudio->playHeroDash(hero.moveable().position);
        }
    }
    if (heroManager.consumeLevelUpEvent() && levelUpAudio) {
        levelUpAudio->play();
    }
    if (uiState.inventoryPickupPulseSeconds > 0.0f) {
        uiState.inventoryPickupPulseSeconds = std::max(0.0f, uiState.inventoryPickupPulseSeconds - dt);
    }
    auto isHeroDeadAndNotify = [&]() {
        const bool isHeroDead = hero.damageable().isDead();
        if (spatialAudio && isHeroDead && !wasHeroDeadForSfx) {
            spatialAudio->playHeroDeath(hero.moveable().position);
        }
        wasHeroDeadForSfx = isHeroDead;
        return isHeroDead;
    };
    if (isHeroDeadAndNotify()) return;
    dof::diagnostics::setEnemyManagerMs(measureMilliseconds([&] {
        enemyManager->update(*worldInstance, dt);
    }));
    if (isHeroDeadAndNotify()) return;
    floorItemManager.update(*worldInstance, dt);
    const auto pickupResult = pickupHub.tryAutoPickup(
        *worldInstance,
        *inventoryHub,
        powderHub.get(),
        &configLoader,
        lootFilter.isActive() ? &lootFilter : nullptr);
    if (pickupResult.pickedUp) {
        uiState.inventoryPickupPulseSeconds = configLoader.getFloat("INFOBAR_ACTION_PICKUP_PULSE_SECONDS");
        if (pickupAudio) pickupAudio->play();
    }
    dof::diagnostics::setWeaponManagerMs(measureMilliseconds([&] {
        weaponManager->update(*worldInstance, dt);
    }));
    dof::diagnostics::setHubUpdateMs(measureMilliseconds([&] {
        damageTextHub->update(dt);
        dronFloatTextHub->update(dt);
        xpFloatHub->update(dt);
        if (attackVfxHub) attackVfxHub->update(dt);
        if (evasionHub) evasionHub->advanceFlash(dt);
    }));
    // T-P5-destroy-buttons-hover-flash — tick the per-tier destroy-
    // button flash decay timers from the simulation step so the pulse
    // duration matches sim cadence and stays stable regardless of frame
    // rate. The renderer is built lazily by `applyConfigToRenderers`
    // (after the window exists), so a null check guards the pre-render
    // sim-only path used by headless / self-test cold starts.
    if (inventoryRenderer) inventoryRenderer->advance(dt);
    if (componentShowcaseRenderer) componentShowcaseRenderer->advance(uiState.mouseUi);
    if (effectsManager) effectsManager->tick(dt);
    // card-mpkz662b part 1b — tick the dash charge cooldown. Runs
    // every fixed sim step so the refill cadence matches the
    // simulation clock, not the render frame rate.
    if (dodgeSystem) dodgeSystem->update(dt);
    // card-mpmzs1j5 — advance the Enemies-tab click-to-expand reveal
    // timer. Pure monotone clamp into [0, duration]; the renderer
    // reads `seconds / duration` per frame to map to a revealed-line
    // count. Only ticks when a drawer is open (idle state holds the
    // timer at 0 so a fresh expand starts from a clean ramp).
    if (debugPanel && uiState.debugExpandedRowIndex >= 0) {
        uiState.debugExpandAnimSeconds = dof::render::clampDebugExpandAnim(
            uiState.debugExpandAnimSeconds, dt, debugPanel->rowExpandAnimDuration());
    }
    // card-mpoa5j47 — Hero-tab drawer reveal timer (independent).
    if (debugPanel && uiState.debugHeroExpandedRowIndex >= 0) {
        uiState.debugHeroExpandAnimSeconds = dof::render::clampDebugExpandAnim(
            uiState.debugHeroExpandAnimSeconds, dt, debugPanel->rowExpandAnimDuration());
    }
    if (debugPanel && uiState.debugWeaponsExpandedRowIndex >= 0) {
        uiState.debugWeaponsExpandAnimSeconds = dof::render::clampDebugExpandAnim(
            uiState.debugWeaponsExpandAnimSeconds, dt, debugPanel->rowExpandAnimDuration());
    }
    if (debugPanel && uiState.debugDicesExpandedRowIndex >= 0) {
        uiState.debugDicesExpandAnimSeconds = dof::render::clampDebugExpandAnim(
            uiState.debugDicesExpandAnimSeconds, dt, debugPanel->rowExpandAnimDuration());
    }
    if (debugPanel && uiState.debugFloorExpandedRowIndex >= 0) {
        uiState.debugFloorExpandAnimSeconds = dof::render::clampDebugExpandAnim(
            uiState.debugFloorExpandAnimSeconds, dt, debugPanel->rowExpandAnimDuration());
    }
    // Ctrl+E Enemy Design Editor — count down the "Saved!" flash timer so
    // the confirmation indicator fades after a successful YAML write.
    if (uiState.enemyEditorSavedFlash > 0.f)
        uiState.enemyEditorSavedFlash -= dt;
}

void GameSession::restartRun() {
    // Spec §Hero Death / §Ctrl + R — full run reset: clear live world
    // entities (enemies + floor items), reset hero to level-1 base
    // stats at the configured spawn position, wipe ephemeral combat
    // text / xp float hubs, reset enemy spawn cadence, respawn the
    // starter Pitchfork, AND drain InventoryHub + WeaponSlotHub so
    // the next run starts at zero loadout (card-mpo9ws1q).
    //
    // The prior "preserve loadout" behaviour was a half-step that
    // left earned weapons / dice / inventory items in place after
    // Ctrl+R, which the user reported as broken — pressing the
    // restart key while still seeing previous-run loot in the
    // sidebar made the "restart" verb feel a lie. Draining the
    // loadout here in `restartRun` keeps a single restart path
    // with a clean fresh-run invariant.
    auto& hero = worldInstance->hero();
    // card-mpmzxm2n — flow Ctrl+R-preserved overrides into Hero before
    // respawn rebuilds level-1 stats. Without this refresh, console
    // tweaks to `HERO_MOVE_SPEED` / `HERO_HEALTH_MAX` / etc never reach
    // the live hero because the ctor-time cache wins over the
    // ConfigLoader's overridden values.
    hero.refreshBaseStatsFromConfig(configLoader);
    hero.moveable().teleportTo({configLoader.getFloat("HERO_START_X"),
                                 configLoader.getFloat("HERO_START_Y")});
    hero.respawn();
    lastHeroDashSoundId = hero.dashId();
    wasHeroDeadForSfx = false;
    worldInstance->clearTransients();
    enemyManager->resetSpawnState();
    if (weaponManager) weaponManager->resetRunState();
    if (damageTextHub)    damageTextHub->clear();
    if (dronFloatTextHub) dronFloatTextHub->clear();
    if (xpFloatHub)       xpFloatHub->clear();
    if (attackVfxHub)     attackVfxHub->clear();
    // Without this a burst queued on the frame the hero died survives the
    // restart and replays at last-run world coordinates on the first step of
    // the new one, dragging its camera trauma along with it.
    effectBurstHub.clear();
    // card-mpo9ws1q — wipe inventory + every weapon row (which also
    // takes any dice riding inside the equipped weapons via
    // `unequipFrom`'s auto-drain). The cell-by-cell `unslotDice`
    // pass runs FIRST so floor-dropped dice from a still-equipped
    // weapon do not get re-attached during the unequip drain. Uses
    // the existing tested hub APIs so no new public surface lands.
    if (weaponSlotHub) {
        const int rowCount  = weaponSlotHub->rowCount();
        const int cellCount = weaponSlotHub->diceCellsPerRow();
        for (int row = 0; row < rowCount; ++row) {
            for (int cell = 0; cell < cellCount; ++cell) {
                (void)weaponSlotHub->unslotDice(row, cell);
            }
            (void)weaponSlotHub->unequipFrom(row);
        }
    }
    if (inventoryHub) {
        for (int slot = 0; slot < inventoryHub->slotCount(); ++slot) {
            (void)inventoryHub->takeItemFrom(slot);
        }
    }
    // A die left sitting in the DiceCrafter slot otherwise survives Ctrl+R,
    // contradicting the zero-loadout invariant above; discard it along with
    // the stale result label / selected-face UI state.
    if (diceCrafterHub.isSlotFilled()) (void)diceCrafterHub.extractDice();
    diceCrafterResultText.clear();
    uiState.selectedDiceCrafterFace = -1;
    spawnStarterPitchfork();
    // card-mpkz662b part 1b — fresh run starts with a full dash pool.
    if (dodgeSystem) dodgeSystem->reset();
    if (vitalityTank) vitalityTank->reset();
    // Reset loot filter so a new run starts with no active filter.
    lootFilter = {};
    uiState.isLootFilterOpen            = false;
    uiState.isLootFilterQualityFocused  = false;
    uiState.isLootFilterLevelFocused    = false;
    uiState.lootFilterQualityInput      = "0";
    uiState.lootFilterLevelInput        = "0";
    // Cancel any in-flight drag — stale drag payloads reference items that
    // were just wiped above, so leaving them alive causes a null-deref in
    // the renderer on the next frame.
    uiState.cancelDrag();
}




void GameSession::spawnStarterPitchfork() {
    auto starter = weaponMaker->makeStarterPitchfork(worldInstance->allocateId());
    const sf::Vector2f offset{
        configLoader.getFloat("STARTER_PITCHFORK_OFFSET_X"),
        configLoader.getFloat("STARTER_PITCHFORK_OFFSET_Y")};
    const auto heroPosition = worldInstance->hero().moveable().position;
    const sf::Vector2f spawn = heroPosition + offset;
    auto floorItem = std::make_unique<dof::entities::FloorItem>(
        worldInstance->allocateId(), spawn, std::move(starter), true);
    worldInstance->floorItems().push_back(std::move(floorItem));
}

namespace {
bool isSpawnLevelInRange(int level, int maxLevel) { return level >= 1 && level <= maxLevel; }

sf::Vector2f computeCheatSpawnPos(const dof::core::World& world,
                                   const dof::loaders::ConfigLoader& cfg) {
    const float pickupRadius = cfg.getFloat("ITEM_PICKUP_RADIUS");
    const float spawnBand    = cfg.getFloat("CONSOLE_SPAWN_BAND_PX");
    const auto heroPosition  = world.hero().moveable().position;
    return {heroPosition.x + pickupRadius + spawnBand, heroPosition.y};
}
}

void GameSession::dispatchSpawnWeapon(int level, const std::string& typeName) {
    if (!weaponMaker || !worldInstance) return;
    if (!isSpawnLevelInRange(level, configLoader.getInt("HERO_MAX_LEVEL"))) {
        if (console) {
            console->log(dof::app::ConsoleLineKind::Error,
                          "spawn level out of range: " + std::to_string(level));
        }
        return;
    }
    // T-CHEAT-spawn-type-arg — `typeName` is a canonical lowercase
    // token (parser already validated it); empty means "random pick".
    dof::entities::WeaponType type{};
    if (typeName.empty()) {
        type = weaponMaker->pickWeightedType();
    } else if (!dof::entities::parseWeaponTypeToken(typeName, type)) {
        if (console) {
            console->log(dof::app::ConsoleLineKind::Error,
                          "unknown weapon type: " + typeName);
        }
        return;
    }
    auto weapon = weaponMaker->makeAtLevel(worldInstance->allocateId(), type, level);
    // SE6 mirror — cheats bump quality so the SE6 Auto-Destroy on
    // Pickup filter does not silently route a cheat-spawned item to
    // powder. The spec-rolled qFloor path lives in `spawn_loot_drop`.
    weapon->setQualityScore(configLoader.getInt("QUALITY_MAX_SCORE"));
    const std::string spawnedName = weapon->displayName();
    const auto spawnPos = computeCheatSpawnPos(*worldInstance, configLoader);
    auto floorItem = std::make_unique<dof::entities::FloorItem>(worldInstance->allocateId(),
                                                                  spawnPos, std::move(weapon), false);
    worldInstance->floorItems().push_back(std::move(floorItem));
    if (console) {
        console->log(dof::app::ConsoleLineKind::Success,
                      "spawned " + spawnedName + " (Lv " + std::to_string(level) + ")");
    }
}

void GameSession::dispatchSpawnEnemy(int level, const std::string& typeName) {
    if (!enemyManager || !worldInstance) return;
    if (!isSpawnLevelInRange(level, configLoader.getInt("HERO_MAX_LEVEL"))) {
        if (console) {
            console->log(dof::app::ConsoleLineKind::Error,
                          "spawn level out of range: " + std::to_string(level));
        }
        return;
    }
    // T-CHEAT-spawn-type-arg — pin a Special Enemy kind when the user
    // provided the optional 2nd arg. Tier is fixed by the kind: Rare
    // for Hexarchon / TassideanSentinel, Uncommon for the others
    // (matches the canonical tier each kind substitutes in the
    // SpecialEnemyGates predicate). Plain `SpawnEnemy=N` stays
    // Common as before.
    dof::entities::SpecialEnemyKind specialKind = dof::entities::SpecialEnemyKind::None;
    auto tier = dof::entities::QualityTier::Common;
    if (!typeName.empty()) {
        if (!dof::entities::parseSpecialEnemyKindToken(typeName, specialKind)) {
            if (console) {
                console->log(dof::app::ConsoleLineKind::Error,
                              "unknown enemy kind: " + typeName);
            }
            return;
        }
        switch (specialKind) {
            case dof::entities::SpecialEnemyKind::Hexarchon:
            case dof::entities::SpecialEnemyKind::TassideanSentinel:
                tier = dof::entities::QualityTier::Rare;
                break;
            default:
                tier = dof::entities::QualityTier::Uncommon;
                break;
        }
    }
    const auto spawnPos = computeCheatSpawnPos(*worldInstance, configLoader);
    enemyManager->spawnAt(*worldInstance, spawnPos, level, tier);
    if (specialKind != dof::entities::SpecialEnemyKind::None) {
        // The 4-arg spawnAt path skips the gate predicate (cheat
        // route), so push the special kind + per-kind stat overrides
        // explicitly. The freshly-pushed enemy is the back of the
        // world's enemy vector.
        if (!worldInstance->enemies().empty()) {
            auto& freshly = worldInstance->enemies().back();
            if (freshly) {
                freshly->setSpecialKind(specialKind);
                enemyManager->applySpecialKindAfterSpawn(*freshly);
            }
        }
    }
    if (console) {
        const std::string label = specialKind == dof::entities::SpecialEnemyKind::None
            ? std::string{"enemy"}
            : std::string(dof::entities::specialEnemyKindLabel(specialKind));
        console->log(dof::app::ConsoleLineKind::Success,
                      "spawned " + label + " (Lv " + std::to_string(level) + ")");
    }
}

void GameSession::dispatchSpawnDice(int level, const std::string& typeName) {
    if (!diceMaker || !worldInstance) return;
    if (!isSpawnLevelInRange(level, configLoader.getInt("HERO_MAX_LEVEL"))) {
        if (console) {
            console->log(dof::app::ConsoleLineKind::Error,
                          "spawn level out of range: " + std::to_string(level));
        }
        return;
    }
    dof::entities::DiceFace face{};
    if (typeName.empty()) {
        face = diceMaker->pickWeightedFace();
    } else if (!dof::entities::parseDiceFaceCountToken(typeName, face)) {
        if (console) {
            console->log(dof::app::ConsoleLineKind::Error,
                          "unknown dice face count: " + typeName);
        }
        return;
    }
    auto dice = diceMaker->makeAtLevel(worldInstance->allocateId(), face, level);
    dice->setQualityScore(configLoader.getInt("QUALITY_MAX_SCORE"));
    const std::string spawnedName = dice->displayName();
    const auto spawnPos = computeCheatSpawnPos(*worldInstance, configLoader);
    auto floorItem = std::make_unique<dof::entities::FloorItem>(worldInstance->allocateId(),
                                                                  spawnPos, std::move(dice));
    worldInstance->floorItems().push_back(std::move(floorItem));
    if (console) {
        console->log(dof::app::ConsoleLineKind::Success,
                      "spawned " + spawnedName + " (Lv " + std::to_string(level) + ")");
    }
}

}
