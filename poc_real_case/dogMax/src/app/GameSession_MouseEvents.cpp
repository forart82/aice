#include "app/GameSession.hpp"

#include "render/DebugPanel.hpp"
#include "render/LootFilterLayout.hpp"

#include <SFML/Graphics/RenderWindow.hpp>
#include <SFML/Window/Event.hpp>
#include <SFML/Window/Keyboard.hpp>
#include <SFML/Window/Mouse.hpp>

#include <algorithm>
#include <cmath>
#include <string>

namespace dof::app {

void GameSession::finishMouseGesturesBeforeHelp(sf::RenderWindow* window) {
    // Help is modal, so finish every gesture before it starts swallowing mouse
    // releases. This prevents editor selections, marquee/pan, debug-panel and
    // settings drags from remaining armed after Help closes.
    if (worldEditor && worldEditor->isOpen()) {
        worldEditor->handleMouseReleased(sf::Mouse::Button::Left);
        worldEditor->handleMouseReleased(sf::Mouse::Button::Middle);
    }
    uiState.isDraggingDebugPanel = false;
    uiState.settingsDragRow = -1;
    uiState.hover = {};

    // Inventory drags temporarily own the item payload. Complete them through
    // the controller rather than clearing UiState directly, which would lose
    // the moved-out item.
    if (window && uiState.drag.isActive() && interactionController
        && inventoryLayout && weaponSlotLayout) {
        const sf::Vector2i pixel = sf::Mouse::getPosition(*window);
        interactionController->updateMouseUi(mapWindowPixelToUi(*window, pixel));
        interactionController->handleLeftRelease(
            *inventoryLayout, *weaponSlotLayout, mapWindowPixelToWorld(*window, pixel));
    }
}

void GameSession::processMouseEvent(const sf::Event& eventRef, sf::RenderWindow& window) {
    if (uiState.isHelpVisible) {
        if (const auto* wheel = eventRef.getIf<sf::Event::MouseWheelScrolled>()) {
            if (helpOverlay) helpOverlay->scrollBy(wheel->delta > 0.0f ? -1 : 1);
            return;
        }
        if (const auto* pressed = eventRef.getIf<sf::Event::MouseButtonPressed>()) {
            if (pressed->button == sf::Mouse::Button::Left && weaponSlotLayout) {
                const sf::Vector2f cursorUi = mapWindowPixelToUi(window, pressed->position);
                if (weaponSlotLayout->actionAt(cursorUi) == dof::render::InfoBarAction::Help) {
                    uiState.isHelpVisible = false;
                }
            }
            return;
        }
        if (eventRef.is<sf::Event::Resized>()) handleWindowResized(window);
        return;
    }
    if (worldEditor && worldEditor->isOpen()) {
        const bool isControlHeld = sf::Keyboard::isKeyPressed(sf::Keyboard::Key::LControl)
                                || sf::Keyboard::isKeyPressed(sf::Keyboard::Key::RControl);
        const bool isShiftHeld = sf::Keyboard::isKeyPressed(sf::Keyboard::Key::LShift)
                              || sf::Keyboard::isKeyPressed(sf::Keyboard::Key::RShift);
        const bool isAltHeld = sf::Keyboard::isKeyPressed(sf::Keyboard::Key::LAlt)
                            || sf::Keyboard::isKeyPressed(sf::Keyboard::Key::RAlt);
        if (const auto* moved = eventRef.getIf<sf::Event::MouseMoved>()) {
            worldEditor->handleMouseMoved(
                mapWindowPixelToWorld(window, moved->position),
                mapWindowPixelToUi(window, moved->position), camera->currentZoom());
            camera->setFocus(worldEditor->cameraFocus());
            return;
        }
        if (const auto* pressed = eventRef.getIf<sf::Event::MouseButtonPressed>()) {
            worldEditor->handleMousePressed(
                pressed->button, mapWindowPixelToWorld(window, pressed->position),
                mapWindowPixelToUi(window, pressed->position), camera->currentZoom());
            if (worldEditor->consumeHelpRequest()) {
                finishMouseGesturesBeforeHelp(&window);
                uiState.isHelpVisible = true;
            }
            return;
        }
        if (const auto* released = eventRef.getIf<sf::Event::MouseButtonReleased>()) {
            worldEditor->handleMouseReleased(released->button);
            return;
        }
        if (const auto* wheel = eventRef.getIf<sf::Event::MouseWheelScrolled>()) {
            worldEditor->handleMouseMoved(
                mapWindowPixelToWorld(window, wheel->position),
                mapWindowPixelToUi(window, wheel->position), camera->currentZoom());
            if (!worldEditor->handleWheel(wheel->delta, isControlHeld,
                                          isShiftHeld, isAltHeld)) {
                const float zoomStep = configLoader.getFloat("CAMERA_ZOOM_STEP");
                const float zoomOutMultiplier = configLoader.getFloat(
                    "WORLD_EDITOR_CAMERA_ZOOM_OUT_MULTIPLIER");
                camera->zoomBy(wheel->delta > 0.0f ? zoomStep : 1.0f / zoomStep,
                    configLoader.getFloat("CAMERA_ZOOM_MIN")
                        / std::max(1.0f, zoomOutMultiplier),
                    configLoader.getFloat("CAMERA_ZOOM_MAX"));
            }
            return;
        }
        if (eventRef.is<sf::Event::Resized>()) handleWindowResized(window);
        return;
    }
    // Phase G (G-misc) — while the player Settings/Theme window is open it
    // consumes mouse events over its own rect (and every move/release during a
    // slider drag) so a drag never leaks to the world or another panel; events
    // outside the window — and Resized — fall through to the handlers below.
    if (uiState.isSettingsOpen && handleSettingsMouseEvent(eventRef, window)) return;

    if (eventRef.is<sf::Event::MouseMoved>()) {
        handleMouseMoved(eventRef, window);
        return;
    }
    if (eventRef.is<sf::Event::MouseButtonPressed>()) {
        handleMouseButtonPressed(eventRef, window);
        return;
    }
    if (eventRef.is<sf::Event::MouseButtonReleased>()) {
        handleMouseButtonReleased(eventRef, window);
        return;
    }
    if (eventRef.is<sf::Event::MouseWheelScrolled>()) {
        handleMouseWheelScrolled(eventRef, window);
        return;
    }
    if (eventRef.is<sf::Event::Resized>()) {
        handleWindowResized(window);
    }
}

void GameSession::handleMouseMoved(const sf::Event& eventRef, sf::RenderWindow& window) {
    const auto* mouseMove = eventRef.getIf<sf::Event::MouseMoved>();
    if (!mouseMove) return;

    const sf::Vector2f cursorUi = mapWindowPixelToUi(window, mouseMove->position);
    interactionController->updateMouseUi(cursorUi);
    if (uiState.isDraggingDebugPanel && debugPanel) {
        // Translate from the drag-start anchor so the cursor stays pinned on
        // whatever pixel of the handle it grabbed.
        const sf::Vector2f delta = cursorUi - uiState.debugPanelDragStartMouse;
        const sf::Vector2f desired = uiState.debugPanelDragStartOffset + delta;
        const auto probeRects = uiState.isDebugPanelMinimised
            ? debugPanel->computeMinimisedRects(uiDesignSize, desired)
            : debugPanel->computeRects(uiDesignSize, desired);
        uiState.debugPanelOffset = dof::render::clampDebugPanelOffset(
            desired, uiDesignSize, probeRects.panelWidth, probeRects.panelHeight);
    }
    if (inventoryLayout && weaponSlotLayout) {
        const sf::Vector2f cursorWorld = camera
            ? mapWindowPixelToWorld(window, mouseMove->position)
            : sf::Vector2f{0.0f, 0.0f};
        interactionController->updateHover(*inventoryLayout, *weaponSlotLayout, cursorWorld);
    }
    // Track which debug tab the cursor hovers over for UiTab hover highlight.
    if (uiState.isDebugPanelVisible && debugPanel) {
        const auto tabRects = uiState.isDebugPanelMinimised
            ? debugPanel->computeMinimisedRects(uiDesignSize, uiState.debugPanelOffset)
            : debugPanel->computeRects(uiDesignSize, uiState.debugPanelOffset);
        uiState.hoveredDebugTabIndex = dof::render::debugPanelTabIndexAt(tabRects, cursorUi);
    } else {
        uiState.hoveredDebugTabIndex = -1;
    }
}

void GameSession::handleMouseButtonPressed(const sf::Event& eventRef, sf::RenderWindow& window) {
    const auto* mousePress = eventRef.getIf<sf::Event::MouseButtonPressed>();
    if (!mousePress) return;

    const sf::Vector2f cursorUi = mapWindowPixelToUi(window, mousePress->position);
    interactionController->updateMouseUi(cursorUi);

    // Ctrl+H unified Gallery — left-click routes to the category +
    // sub-tab strips so the player can switch category (Game Art /
    // UI Kit) and sub-tab. Consumes the click while the modal is open.
    if (uiState.isShowcaseOpen && componentShowcaseRenderer
        && mousePress->button == sf::Mouse::Button::Left) {
        componentShowcaseRenderer->handleClick(cursorUi, uiState);
        // Route to Effects inner tabs (Small/Medium/Large) when Effects sub-tab active.
        const int sub = uiState.gallerySubTab[uiState.galleryCategory];
        if (uiState.galleryCategory == 0 && sub == 2 && effectsCatalogWindow)
            effectsCatalogWindow->handleTabClick(cursorUi, uiState);
        if (uiState.galleryCategory == 2 && groupedEffectsCatalog)
            groupedEffectsCatalog->handleTabClick(cursorUi, uiState);
        return;
    }

    if (mousePress->button == sf::Mouse::Button::Left && weaponSlotLayout) {
        const auto action = weaponSlotLayout->actionAt(cursorUi);
        if (action != dof::render::InfoBarAction::None) {
            switch (action) {
                case dof::render::InfoBarAction::Inventory:
                    uiState.isInventoryOpen = !uiState.isInventoryOpen;
                    return;
                case dof::render::InfoBarAction::LootFilter:
                    uiState.isLootFilterOpen = !uiState.isLootFilterOpen;
                    if (!uiState.isLootFilterOpen) {
                        uiState.isLootFilterQualityFocused = false;
                        uiState.isLootFilterLevelFocused = false;
                    }
                    return;
                case dof::render::InfoBarAction::DiceCrafter:
                    uiState.isDiceCrafterOpen = !uiState.isDiceCrafterOpen;
                    return;
                case dof::render::InfoBarAction::Help:
                    if (!uiState.isHelpVisible) finishMouseGesturesBeforeHelp(&window);
                    uiState.isHelpVisible = !uiState.isHelpVisible;
                    return;
                case dof::render::InfoBarAction::None:
                    break;
            }
        }
    }
    // Loot filter popup click handling: chip toggles + field focus.
    // Runs before all other left-click handlers so the popup consumes its
    // area exclusively while open.
    if (uiState.isLootFilterOpen && lootFilterLayout
        && mousePress->button == sf::Mouse::Button::Left) {
        // UNSET button: wipe every chip + threshold, reset the numeric input
        // buffers, and re-sweep (now a no-op).
        if (lootFilterLayout->unsetButtonContains(cursorUi)) {
            lootFilter.clear();
            uiState.lootFilterQualityInput = "0";
            uiState.lootFilterLevelInput   = "0";
            uiState.isLootFilterQualityFocused = false;
            uiState.isLootFilterLevelFocused   = false;
            applyLootFilterToInventory();
            return;
        }
        const auto qRect = lootFilterLayout->qualityFieldRect();
        const auto lRect = lootFilterLayout->levelFieldRect();
        if (qRect.contains(cursorUi)) {
            uiState.isLootFilterQualityFocused = true;
            uiState.isLootFilterLevelFocused   = false;
            return;
        }
        if (lRect.contains(cursorUi)) {
            uiState.isLootFilterQualityFocused = false;
            uiState.isLootFilterLevelFocused   = true;
            return;
        }
        const int wIdx = lootFilterLayout->weaponChipIndexAt(cursorUi);
        if (wIdx >= 0) {
            const auto wtype = dof::render::kWeaponChipTypes[wIdx];
            if (lootFilter.weaponTypes.count(wtype)) lootFilter.weaponTypes.erase(wtype);
            else                                      lootFilter.weaponTypes.insert(wtype);
            applyLootFilterToInventory();
            return;
        }
        const int dIdx = lootFilterLayout->diceChipIndexAt(cursorUi);
        if (dIdx >= 0) {
            const auto face = dof::render::kDiceChipFaces[dIdx];
            if (lootFilter.diceTypes.count(face)) lootFilter.diceTypes.erase(face);
            else                                   lootFilter.diceTypes.insert(face);
            applyLootFilterToInventory();
            return;
        }
        // Click outside chips and fields: unfocus input fields.
        uiState.isLootFilterQualityFocused = false;
        uiState.isLootFilterLevelFocused   = false;
    }
    // DiceCrafter panel click handling: slot eject + REFACE / EVOLVE buttons.
    // Runs before debug-panel and inventory handlers so the panel consumes its
    // own area exclusively while open.
    if (uiState.isDiceCrafterOpen && diceCrafterPanel
        && mousePress->button == sf::Mouse::Button::Left) {
        // Face cell click: select which face to reface.
        const int faceCell = diceCrafterPanel->faceCellIndexAt(cursorUi);
        if (faceCell >= 1 && diceCrafterHub.isSlotFilled()) {
            uiState.selectedDiceCrafterFace = (uiState.selectedDiceCrafterFace == faceCell)
                                        ? -1 : faceCell;  // toggle on re-click
            diceCrafterResultText.clear();
            return;
        }
        if (diceCrafterPanel->slotHit(cursorUi)) {
            // Slot click: eject the slotted dice back to inventory, but only
            // when a free inventory slot exists.
            if (diceCrafterHub.isSlotFilled() && inventoryHub
                && inventoryHub->firstEmptySlot() >= 0) {
                auto rejected = inventoryHub->storeItemAtFirstEmpty(
                    dof::hubs::InventoryItem::makeDice(diceCrafterHub.extractDice()));
                // The firstEmptySlot() guard above is this sink's own
                // precondition for a die, so nothing comes back; if it ever
                // does, the floor keeps it rather than the parameter eating it.
                if (!rejected.isEmpty())
                    interactionController->dropItemToFloor(std::move(rejected),
                                                           currentCursorWorld(window));
                diceCrafterResultText.clear();
                uiState.selectedDiceCrafterFace = -1;
            }
            return;
        }
        const int refaceIdx = diceCrafterPanel->refaceButtonIndexAt(cursorUi);
        if (refaceIdx >= 0 && diceCrafterHub.isSlotFilled() && powderHub
            && uiState.selectedDiceCrafterFace >= 1) {
            const auto native = dof::entities::powderColorForDice(
                diceCrafterHub.peekedDice()->face());
            const auto tiers = dof::hubs::refaceTiersFor(native);
            if (refaceIdx < static_cast<int>(tiers.size())) {
                const auto result = diceCrafterHub.attemptReface(
                    *powderHub, tiers[static_cast<std::size_t>(refaceIdx)],
                    uiState.selectedDiceCrafterFace, rng, configLoader);
                diceCrafterResultText = dof::hubs::diceCraftResultLabel(result);
            }
            return;
        }
        if (diceCrafterPanel->evolveButtonHit(cursorUi) && powderHub) {
            const auto result = diceCrafterHub.attemptEvolve(*powderHub, rng, configLoader);
            diceCrafterResultText = dof::hubs::diceCraftResultLabel(result);
            return;
        }
    }
    // DiceCrafter QoL right-click routing: while the DiceCrafter is open a
    // right-click on a die targets the DiceCrafter slot instead of a weapon's
    // dice slot (the default right-click behaviour).
    if (uiState.isDiceCrafterOpen && diceCrafterPanel && inventoryHub
        && mousePress->button == sf::Mouse::Button::Right) {
        // Quick-return: right-clicking the filled DiceCrafter slot sends the
        // die back to the inventory, if a free slot exists.
        if (diceCrafterPanel->slotHit(cursorUi) && diceCrafterHub.isSlotFilled()) {
            if (inventoryHub->firstEmptySlot() >= 0) {
                auto rejected = inventoryHub->storeItemAtFirstEmpty(
                    dof::hubs::InventoryItem::makeDice(diceCrafterHub.extractDice()));
                if (!rejected.isEmpty())
                    interactionController->dropItemToFloor(std::move(rejected),
                                                           currentCursorWorld(window));
                diceCrafterResultText.clear();
                uiState.selectedDiceCrafterFace = -1;
            }
            return;
        }
        // Smart-DiceCrafter: right-clicking a die in the open inventory sends
        // it straight to the DiceCrafter slot.
        if (uiState.isInventoryOpen && inventoryLayout) {
            const int rawSlot = inventoryLayout->slotIndexAt(cursorUi);
            const int slot = rawSlot >= 0 ? inventoryHub->resolvePrimarySlot(rawSlot) : -1;
            // Presence, not vacancy: `isSlotEmpty` now answers "can an item go
            // here", so only `peekItem` still means "there is a die here".
            const auto* item = slot >= 0 ? inventoryHub->peekItem(slot) : nullptr;
            if (item && item->isDice()) {
                auto dice = inventoryHub->takeDiceFrom(slot);
                // takeDiceFrom just freed a grid slot, so the evicted die
                // always has somewhere to go here.
                if (auto evicted = diceCrafterHub.insertDice(std::move(dice))) {
                    auto rejected = inventoryHub->storeItemAtFirstEmpty(
                        dof::hubs::InventoryItem::makeDice(std::move(evicted)));
                    if (!rejected.isEmpty())
                        interactionController->dropItemToFloor(std::move(rejected),
                                                               currentCursorWorld(window));
                }
                diceCrafterResultText.clear();
                uiState.selectedDiceCrafterFace = -1;
                return;
            }
        }
    }
    // Spec §Tabs §Tab Switch L2862 — clicking a tab header switches the
    // active panel content.
    if (uiState.isDebugPanelVisible && debugPanel
        && mousePress->button == sf::Mouse::Button::Left) {
        // B-UX-1 — pick the rects helper that matches the currently-rendered
        // state so the minimise button click lands when the panel is collapsed.
        const auto rects = uiState.isDebugPanelMinimised
            ? debugPanel->computeMinimisedRects(uiDesignSize, uiState.debugPanelOffset)
            : debugPanel->computeRects(uiDesignSize, uiState.debugPanelOffset);
        if (dof::render::debugPanelDragHandleContains(rects, cursorUi)) {
            uiState.isDraggingDebugPanel       = true;
            uiState.debugPanelDragStartMouse   = cursorUi;
            uiState.debugPanelDragStartOffset  = uiState.debugPanelOffset;
            return;
        }
        if (dof::render::debugPanelMinimiseButtonContains(rects, cursorUi)) {
            uiState.isDebugPanelMinimised = !uiState.isDebugPanelMinimised;
            uiState.debugExpandedRowIndex = -1;
            uiState.debugExpandAnimSeconds = 0.0f;
            uiState.debugHeroExpandedRowIndex = -1;
            uiState.debugHeroExpandAnimSeconds = 0.0f;
            uiState.debugWeaponsExpandedRowIndex = -1;
            uiState.debugWeaponsExpandAnimSeconds = 0.0f;
            uiState.debugDicesExpandedRowIndex = -1;
            uiState.debugDicesExpandAnimSeconds = 0.0f;
            uiState.debugFloorExpandedRowIndex = -1;
            uiState.debugFloorExpandAnimSeconds = 0.0f;
            if (debugPanel) debugPanel->cancelConfigEdit();
            return;
        }
        if (!uiState.isDebugPanelMinimised) {
            const int tabIdx = dof::render::debugPanelTabIndexAt(rects, cursorUi);
            if (tabIdx >= 0) {
                if (uiState.debugActiveTabIndex != tabIdx && debugPanel) {
                    debugPanel->scrollToTop();
                    uiState.debugExpandedRowIndex = -1;
                    uiState.debugExpandAnimSeconds = 0.0f;
                    uiState.debugHeroExpandedRowIndex = -1;
                    uiState.debugHeroExpandAnimSeconds = 0.0f;
                    uiState.debugWeaponsExpandedRowIndex = -1;
                    uiState.debugWeaponsExpandAnimSeconds = 0.0f;
                    uiState.debugDicesExpandedRowIndex = -1;
                    uiState.debugDicesExpandAnimSeconds = 0.0f;
                    uiState.debugFloorExpandedRowIndex = -1;
                    uiState.debugFloorExpandAnimSeconds = 0.0f;
                }
                uiState.debugActiveTabIndex = tabIdx;
                uiState.debugSearchQuery.clear();
                uiState.isDebugSearchFocused = false;
                if (debugPanel) debugPanel->cancelConfigEdit();
                return;
            }
            // Search bar click-to-focus.
            if (debugPanel && dof::render::debugTabHasSearchBar(uiState.debugActiveTabIndex)) {
                const float sbH = debugPanel->searchBarHeight();
                auto searchRects = rects;
                searchRects.searchBarHeight = sbH;
                const sf::FloatRect searchBarRect{
                    {searchRects.panelX, searchRects.searchBarY()},
                    {searchRects.panelWidth, sbH}};
                if (searchBarRect.contains(cursorUi)) {
                    uiState.isDebugSearchFocused = true;
                    return;
                }
                uiState.isDebugSearchFocused = false;
            }
            if (uiState.debugActiveTabIndex == 7 && handleConfigTabClick(cursorUi)) {
                return;
            }
            if (uiState.debugActiveTabIndex == 2 && debugPanel) {
                const int rowIdx = dof::render::entityInspectorRowIndexAt(
                    debugPanel->lastEnemyRowBands(), cursorUi);
                if (rowIdx >= 0) {
                    if (uiState.debugExpandedRowIndex == rowIdx) {
                        uiState.debugExpandedRowIndex = -1;
                    } else {
                        uiState.debugExpandedRowIndex = rowIdx;
                    }
                    uiState.debugExpandAnimSeconds = 0.0f;
                    return;
                }
            }
            if (uiState.debugActiveTabIndex == 1 && debugPanel) {
                const int rowIdx = dof::render::entityInspectorRowIndexAt(
                    debugPanel->lastHeroRowBands(), cursorUi);
                if (rowIdx >= 0) {
                    if (uiState.debugHeroExpandedRowIndex == rowIdx) {
                        uiState.debugHeroExpandedRowIndex = -1;
                    } else {
                        uiState.debugHeroExpandedRowIndex = rowIdx;
                    }
                    uiState.debugHeroExpandAnimSeconds = 0.0f;
                    return;
                }
            }
            if (uiState.debugActiveTabIndex >= 3 && uiState.debugActiveTabIndex <= 5 && debugPanel) {
                const auto& bands = uiState.debugActiveTabIndex == 3
                    ? debugPanel->lastWeaponsRowBands()
                    : (uiState.debugActiveTabIndex == 4
                        ? debugPanel->lastDicesRowBands()
                        : debugPanel->lastFloorRowBands());
                const int rowIdx = dof::render::entityInspectorRowIndexAt(bands, cursorUi);
                if (rowIdx >= 0) {
                    int* expanded = uiState.debugActiveTabIndex == 3
                        ? &uiState.debugWeaponsExpandedRowIndex
                        : (uiState.debugActiveTabIndex == 4
                            ? &uiState.debugDicesExpandedRowIndex
                            : &uiState.debugFloorExpandedRowIndex);
                    float* seconds = uiState.debugActiveTabIndex == 3
                        ? &uiState.debugWeaponsExpandAnimSeconds
                        : (uiState.debugActiveTabIndex == 4
                            ? &uiState.debugDicesExpandAnimSeconds
                            : &uiState.debugFloorExpandAnimSeconds);
                    *expanded = *expanded == rowIdx ? -1 : rowIdx;
                    *seconds = 0.0f;
                    return;
                }
            }
            // Speed-control strip — [−] / [+] buttons step by 0.2 in [0, 4].
            if (debugPanel) {
                auto speedRects = rects;
                speedRects.speedStripHeight = debugPanel->speedStripHeight();
                const auto decR = dof::render::computeSpeedDecButtonRect(speedRects);
                const auto incR = dof::render::computeSpeedIncButtonRect(speedRects);
                const float timeScaleStep     = configLoader.getFloat("GAME_TIME_SCALE_STEP");
                const float timeScaleRounding = configLoader.getFloat("GAME_TIME_SCALE_ROUNDING");
                const float timeScaleMin      = configLoader.getFloat("GAME_TIME_SCALE_MIN");
                const float timeScaleMax      = configLoader.getFloat("GAME_TIME_SCALE_MAX");
                if (decR.contains(cursorUi)) {
                    const float next = std::round((uiState.gameTimeScale - timeScaleStep)
                                                  * timeScaleRounding) / timeScaleRounding;
                    uiState.gameTimeScale = next < timeScaleMin ? timeScaleMin : next;
                    return;
                }
                if (incR.contains(cursorUi)) {
                    const float next = std::round((uiState.gameTimeScale + timeScaleStep)
                                                  * timeScaleRounding) / timeScaleRounding;
                    uiState.gameTimeScale = next > timeScaleMax ? timeScaleMax : next;
                    return;
                }
            }
        }
    }
    if (mousePress->button == sf::Mouse::Button::Left && inventoryLayout && weaponSlotLayout) {
        interactionController->handleLeftClick(*inventoryLayout, *weaponSlotLayout);
    } else if (mousePress->button == sf::Mouse::Button::Right && inventoryLayout && weaponSlotLayout) {
        interactionController->handleRightClick(*inventoryLayout, *weaponSlotLayout);
    }
}

void GameSession::handleMouseButtonReleased(const sf::Event& eventRef, sf::RenderWindow& window) {
    const auto* mouseRelease = eventRef.getIf<sf::Event::MouseButtonReleased>();
    if (!mouseRelease || mouseRelease->button != sf::Mouse::Button::Left) return;

    if (uiState.isDraggingDebugPanel) {
        uiState.isDraggingDebugPanel = false;
        return;
    }
    // DiceCrafter slot drop: drag a dice from inventory and release over the
    // DiceCrafter slot to insert it.
    if (uiState.isDiceCrafterOpen && diceCrafterPanel && uiState.drag.isActive()
        && uiState.drag.payload.isDice()) {
        const sf::Vector2f releaseUi = mapWindowPixelToUi(window, mouseRelease->position);
        if (diceCrafterPanel->slotHit(releaseUi) && inventoryHub) {
            // Refuse the swap when the evicted die has nowhere to go: a die
            // that lands in the crafter pushes the previous one into the grid,
            // and this drag can come from a weapon dice cell, which frees no
            // inventory slot — so a genuinely full grid is reachable here.
            // Without this the swap would still be safe (the grid hands the
            // die back and it goes to the floor) but the player would find a
            // die on the ground instead of an untouched crafter. The sibling
            // click paths pre-check firstEmptySlot() the same way.
            if (diceCrafterHub.isSlotFilled() && inventoryHub->firstEmptySlot() < 0) {
                return;
            }
            if (auto evicted = diceCrafterHub.insertDice(std::move(uiState.drag.payload.dice))) {
                auto rejected = inventoryHub->storeItemAtFirstEmpty(
                    dof::hubs::InventoryItem::makeDice(std::move(evicted)));
                if (!rejected.isEmpty())
                    interactionController->dropItemToFloor(std::move(rejected),
                                                           currentCursorWorld(window));
            }
            uiState.drag.payload = dof::hubs::InventoryItem{};
            uiState.drag.clear();
            diceCrafterResultText.clear();
            uiState.selectedDiceCrafterFace = -1;
            return;
        }
    }
    if (inventoryLayout && weaponSlotLayout) {
        interactionController->updateMouseUi(mapWindowPixelToUi(window, mouseRelease->position));
        interactionController->handleLeftRelease(*inventoryLayout, *weaponSlotLayout,
                                                  currentCursorWorld(window));
    }
}

void GameSession::handleMouseWheelScrolled(const sf::Event& eventRef, sf::RenderWindow& window) {
    const auto* wheel = eventRef.getIf<sf::Event::MouseWheelScrolled>();
    if (!wheel) return;

    // card-mpkd92tu — when the console is focused, redirect the wheel to the
    // scrollback instead of the camera zoom.
    if (uiState.isConsoleFocused && console) {
        const int step = configLoader.getInt("CONSOLE_SCROLL_WHEEL_LINES");
        console->scrollBy(wheel->delta > 0.0f ? step : -step);
        return;
    }
    // Unified Gallery (Ctrl+H) wheel routing: modal content consumes the wheel
    // so the camera never zooms underneath.
    if (uiState.isShowcaseOpen) {
        const int cat = uiState.galleryCategory;
        const int sub = uiState.gallerySubTab[cat];
        if (cat == 0 && sub == 2 && effectsCatalogWindow) {
            const float step = configLoader.getFloat("EFX_CATALOG_SCROLL_STEP");
            effectsCatalogWindow->scrollBy(wheel->delta > 0.0f ? -step : step, uiState);
            return;
        }
        if (cat == 1 && sub == 1) {
            const float step = configLoader.getFloat("UI_SCROLL_STEP_DEFAULT");
            uiState.galleryFontsScroll += wheel->delta > 0.0f ? -step : step;
            return;
        }
        if (cat == 2 && groupedEffectsCatalog) {
            const float step = configLoader.getFloat("EFX_CATALOG_SCROLL_STEP");
            groupedEffectsCatalog->scrollBy(wheel->delta > 0.0f ? -step : step, uiState);
            return;
        }
    }
    if (uiState.isHelpVisible && helpOverlay) {
        helpOverlay->scrollBy(wheel->delta > 0.0f ? -1 : 1);
        return;
    }
    if (uiState.isDebugPanelVisible
        && !uiState.isDebugPanelMinimised
        && debugPanel) {
        const sf::Vector2f cursorUi = mapWindowPixelToUi(window, wheel->position);
        const auto panelRects = debugPanel->computeRects(uiDesignSize, uiState.debugPanelOffset);
        const bool insidePanel =
            cursorUi.x >= panelRects.panelX
            && cursorUi.x <  panelRects.panelX + panelRects.panelWidth
            && cursorUi.y >= panelRects.panelY
            && cursorUi.y <  panelRects.panelY + panelRects.panelHeight;
        if (insidePanel) {
            const int step = configLoader.getInt("DEBUG_PANEL_SCROLL_WHEEL_LINES");
            debugPanel->scrollBy(wheel->delta > 0.0f ? -step : step);
            return;
        }
    }
    if (camera) {
        const float zoomStep = configLoader.getFloat("CAMERA_ZOOM_STEP");
        camera->zoomBy(wheel->delta > 0.0f ? zoomStep : 1.0f / zoomStep);
    }
}

void GameSession::handleWindowResized(sf::RenderWindow& window) {
    // SA36 — refuse OS resize requests that would shrink the window below
    // `WINDOW_MIN_WIDTH/HEIGHT`.
    const auto requested = window.getSize();
    const auto limits = dof::render::loadWindowSizeLimits(configLoader);
    // card-mpl88am9 — keep the OS-chosen size and rely on existing letterbox
    // viewports; only the SA36 minimum-floor clamp survives.
    const auto clamped = dof::render::clampWindowSize(requested, limits);
    if (clamped != requested) {
        window.setSize(clamped);
    }
    rebuildUiView(clamped);
    if (weaponSlotLayout) {
        weaponSlotLayout->setWindowSize(uiDesignSize);
    }
    if (inventoryLayout) {
        inventoryLayout->setWindowSize(uiDesignSize);
        if (weaponSlotLayout) {
            inventoryLayout->setSidebarWidth(weaponSlotLayout->sidebarWidth());
        }
    }
}

}
