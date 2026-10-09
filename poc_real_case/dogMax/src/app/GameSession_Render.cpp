#include "app/GameSession.hpp"

#include "diagnostics/FrameProfiler.hpp"
#include "render/DebugWorldOverlay.hpp"

#include <SFML/Graphics/RenderWindow.hpp>

#include <chrono>

namespace dof::app {

namespace {

template <typename Fn>
float measureMilliseconds(Fn&& fn) {
    const auto start = std::chrono::steady_clock::now();
    fn();
    const auto end = std::chrono::steady_clock::now();
    return std::chrono::duration<float, std::milli>(end - start).count();
}

}

void GameSession::renderFrame(sf::RenderWindow& window, float currentFps) {
    auto& hero = worldInstance->hero();
    const float interpolationAlpha = std::clamp(clock.interpolationAlpha(), 0.0f, 1.0f);
    const sf::Vector2f heroRenderPosition = hero.moveable().interpolatedPosition(
        interpolationAlpha);
    if (worldEditor && worldEditor->isOpen()) camera->setFocus(worldEditor->cameraFocus());
    else camera->followTarget(heroRenderPosition);
    window.clear(colorTheme.windowBackground);
    auto worldView = camera->activeView();
    sf::RenderTexture& worldTarget = worldRenderSurface.beginFrame(
        window.getSize(), camera->designSize(), worldView);
    dof::diagnostics::setWorldRenderMs(measureMilliseconds([&] {
        worldRenderer->render(worldTarget, *worldInstance, worldView,
                              clock.simulatedSeconds(), interpolationAlpha);
    }));
    worldTarget.setView(worldView);
    if (worldEditor && worldEditor->isOpen()) {
        worldEditor->drawWorldOverlay(worldTarget, worldView);
    }
    // Spec §Debug Mode §World Overlays L2824-2834 — translucent range
    // rings + level zones + spawn-ring outlines paint over the world
    // view while the debug panel is visible. Sits ahead of damage
    // text + attack VFX so the overlay reads "behind" floating
    // numbers rather than on top of them.
    if (uiState.isDebugPanelVisible) {
        dof::render::drawDebugWorldOverlays(worldTarget, *worldInstance,
            configLoader, *enemyManager, interpolationAlpha, options.seed);
    }
    combatTextRenderer->drawWorldDamageText(worldTarget, *damageTextHub);
    combatTextRenderer->drawWorldXpFloats(worldTarget, *xpFloatHub);
    // SA6 follow-up — paint per-mode attack VFX after the world entity
    // pass but before bloom. Pass live hero position so hero-anchored
    // animations follow a moving hero instead of the fire-time snapshot.
    if (attackVfxRenderer && attackVfxHub)
        attackVfxRenderer->drawAll(worldTarget, *attackVfxHub,
                                    heroRenderPosition);
    // Effects library — small quads drawn additive over the world before bloom.
    if (effectsManager) effectsManager->draw(worldTarget, worldView);
    // Spec §Render Order L336: bloom post-process sits between the
    // world entity pass and the UI pass — neon outlines glow but the
    // UI text painted below stays crisp. No-op when BLOOM_ENABLE=0.
    const int bloomMaxEnemies = configLoader.getInt("BLOOM_MAX_ENEMIES");
    worldRenderSurface.finishFrame();
    const sf::Texture* presentedWorld = &worldTarget.getTexture();
    if (bloomPipeline
        && (bloomMaxEnemies < 0
            || worldInstance->enemies().size() <= static_cast<std::size_t>(bloomMaxEnemies))) {
        presentedWorld = &bloomPipeline->compose(*presentedWorld,
                                                 worldRenderSurface.size());
    }
    worldRenderSurface.drawToWindow(window, *presentedWorld);

    // Window-space view used only by death-recap coordinate mapping. The world
    // itself rendered into the integer physical-pixel surface above.
    const sf::IntRect worldWindowRect = worldRenderSurface.windowRect();
    const sf::Vector2u windowSize = window.getSize();
    sf::View worldWindowView = worldView;
    worldWindowView.setViewport({
        {static_cast<float>(worldWindowRect.position.x) / static_cast<float>(windowSize.x),
         static_cast<float>(worldWindowRect.position.y) / static_cast<float>(windowSize.y)},
        {static_cast<float>(worldWindowRect.size.x) / static_cast<float>(windowSize.x),
         static_cast<float>(worldWindowRect.size.y) / static_cast<float>(windowSize.y)}});
    // Part 2 — UI pass runs under the design-sized letterbox view.
    // Every UI renderer below sees `window.getView().getSize()` ==
    // (UI_DESIGN_WIDTH, UI_DESIGN_HEIGHT). The viewport was rebuilt on
    // Resized so the same view-rect maps to the new window pixels.
    window.setView(uiView);
    uiRenderer->render(window, currentFps);
    // Inventory (I) — component-based pixel-perfect panel.
    // Draw before the infobar so deployment rises from behind its far-left
    // chassis and the open panel stays physically docked to the top edge.
    if (inventoryRenderer && inventoryHub && inventoryLayout) {
        inventoryRenderer->render(window, *inventoryHub, *inventoryLayout,
                                       powderHub.get(), uiState);
    }
    weaponSlotSidebar->render(window, *weaponSlotHub, *weaponSlotLayout, uiState,
                              worldInstance->hero(), *luckHub, *powderHub, *dodgeSystem,
                              vitalityTank ? vitalityTank->fillRatio() : 0.0f);
    combatTextRenderer->drawUiDronLabels(window, *dronFloatTextHub, *weaponSlotLayout);

    // Spec §Debug Mode + §Console — the debug panel (tabbed window)
    // and the console overlay are independent components now. Both
    // render after the inventory pass so their translucent
    // rectangles read cleanly against the UI underneath.
    if (debugPanel) {
        if (fpsHistory) fpsHistory->push(currentFps);
        dof::render::DebugRenderContext context;
        context.world                = worldInstance.get();
        context.evasionHub           = evasionHub.get();
        context.configLoader         = &configLoader;
        context.fpsHistory           = fpsHistory.get();
        context.frameTimings         = dof::diagnostics::frameTimings();
        context.spatialGridCellCount = enemyManager ? enemyManager->spatialGrid().cellCount() : 0;
        // card-mpl1ldva — Weapons + Dices tabs scan inventory + sidebar.
        context.inventoryHub         = inventoryHub.get();
        context.weaponSlotHub        = weaponSlotHub.get();
        // card-mpl1x8l8 — Hero stats panel reads luck + walks sidebar.
        context.luckHub              = luckHub.get();
        debugPanel->render(window, uiState, context);
    }
    if (consoleOverlay && console) consoleOverlay->render(window, uiState, *console);
    // Loot filter popup — drawn after console overlay, under help overlay
    // so the help key always reads on top.
    if (uiState.isLootFilterOpen && lootFilterLayout && lootFilterOverlay) {
        lootFilterOverlay->draw(window, *lootFilterLayout, lootFilter,
                                 uiState.isLootFilterQualityFocused,
                                 uiState.isLootFilterLevelFocused,
                                 uiState.lootFilterQualityInput,
                                 uiState.lootFilterLevelInput);
    }
    // DiceCrafter panel (G key) — modal overlay drawn after all other UI
    // panels so it sits on top. Passes the last result text so the panel
    // can render the one-frame outcome label. Pass uiState to support
    // dynamic hover state detection for slots, face cells, and action buttons.
    if (uiState.isDiceCrafterOpen && diceCrafterPanel && powderHub) {
        diceCrafterPanel->render(window, diceCrafterHub, *powderHub, diceCrafterResultText,
                           uiState, uiState.selectedDiceCrafterFace);
    }
    // Phase G (G-misc) — player Settings/Theme window (P key). Drawn after the
    // other panels so it reads on top; reads live config values for its slider
    // positions + toggle state, and the drag row + Save banner from uiState.
    if (uiState.isSettingsOpen && settingsPanel) {
        settingsPanel->render(window, configLoader, uiState.mouseUi,
                              uiState.settingsDragRow, uiState.settingsStatus);
    }
    // Ctrl+E Enemy Design Editor — modal panel for per-type YAML design
    // editing. Drawn on top of the other UI panels.
    if (uiState.isEnemyEditorOpen && enemyDesignEditor) {
        const sf::Vector2f viewSize{static_cast<float>(configLoader.getInt("UI_DESIGN_WIDTH")),
                                    static_cast<float>(configLoader.getInt("UI_DESIGN_HEIGHT"))};
        enemyDesignEditor->render(window, uiState, uiView, viewSize, clock.simulatedSeconds());
    }
    if (worldEditor && worldEditor->isOpen()) {
        worldEditor->drawPanel(window, uiDesignSize);
    }
    // Ctrl+H unified Gallery — one modal window with a two-level tab nav
    // (Game Art: Weapons|Enemies|Effects, UI Kit: Components|Fonts). Drawn on
    // top of the other UI panels. Replaces the former standalone Ctrl+W /
    // Ctrl+E / Ctrl+S windows; the Effects sub-tab embeds the effects catalog
    // body, so the shader loader + ui view + elapsed time are passed through.
    if (uiState.isShowcaseOpen && componentShowcaseRenderer) {
        const sf::Vector2f viewSize{static_cast<float>(configLoader.getInt("UI_DESIGN_WIDTH")),
                                    static_cast<float>(configLoader.getInt("UI_DESIGN_HEIGHT"))};
        dof::render::GalleryContext gctx;
        gctx.viewSize     = viewSize;
        gctx.uiView       = &uiView;
        gctx.uiState      = &uiState;
        gctx.shaders      = &shaderLoader;
        gctx.elapsed      = clock.simulatedSeconds();
        gctx.enemyCatalog = &enemyShapeCatalog;
        gctx.effects      = effectsCatalogWindow.get();
        gctx.groupedFx    = groupedEffectsCatalog.get();
        componentShowcaseRenderer->draw(window, gctx);
    }
    // Tooltip — hover info must read on top of every panel it can appear
    // over (inventory, debug panel, console, loot filter, dicecrafter,
    // editors, gallery), so it draws last among panels, just under the
    // always-on-top help overlay below.
    if (!uiState.isHelpVisible && !(worldEditor && worldEditor->isOpen())) {
        tooltipRenderer->render(window, uiState, *inventoryHub, *weaponSlotHub, *worldInstance);
    }
    // SA33 — help overlay sits on top of every UI pass (incl. debug
    // panel) so Help always reads against the current frame.
    if (uiState.isHelpVisible && helpOverlay) helpOverlay->render(window, uiDesignSize);
    // Bottom-right build-version label — drawn last in the UI pass so it sits
    // above every panel and always reads against the current frame.
    if (versionOverlay) versionOverlay->render(window, uiDesignSize);
    // Death recap is the terminal UI state: capture the complete fatal frame
    // once, then paint its annotated image above the infobar and every modal.
    uiRenderer->renderHeroDeathOverlay(window, *worldInstance, worldWindowView);
    // SA34 / spec §Mouse L2660-2667 — refresh the platform cursor based
    // on what the cursor is over (Hand on hover regions, SizeAll while
    // dragging, Arrow otherwise). The pure mapping lives in
    // `render::pickCursorType`; the cached `sf::Cursor` instances are
    // built lazily on first request and reused frame to frame.
    {
        const auto desired = dof::render::pickCursorType(uiState);
        auto& slot = cachedCursors[static_cast<int>(desired)];
        if (!slot.has_value()) slot = sf::Cursor::createFromSystem(desired);
        if (slot.has_value()) window.setMouseCursor(*slot);
    }
    window.display();
}

}
