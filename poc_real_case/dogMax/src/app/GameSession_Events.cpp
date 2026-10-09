#include "app/GameSession.hpp"

#include "app/ConsoleToggle.hpp"
#include "render/DebugPanel.hpp"
#include "render/LootFilterLayout.hpp"
#include <cstdio>

#include <SFML/Graphics/RenderWindow.hpp>
#include <SFML/Window/Event.hpp>
#include <SFML/Window/Keyboard.hpp>
#include <SFML/Window/Mouse.hpp>

#include <algorithm>
#include <string>

namespace dof::app {

void GameSession::processWindowEvents(sf::RenderWindow& window) {
    // Drain the window's event queue and route each event through the
    // shared `processEvent` handler.
    while (auto event = window.pollEvent()) {
        processEvent(*event, &window);
    }
}

// Shared one-event handler, extracted from the poll-loop body.
// The `window` parameter is passed as a pointer (and can be nullptr) to support headless
// / windowless key handling (e.g. key-driven panel toggles) without requiring a
// graphics window context to be initialized on headless environments. Mouse events still
// require a non-null window to correctly map pixels to world/UI coordinates.
void GameSession::processEvent(const sf::Event& eventRef, sf::RenderWindow* window) {
    if (eventRef.is<sf::Event::Closed>()) {
        shouldQuit = true;
        if (window) window->close();
        return;
    }
    // Window received OS focus — stop the startup requestFocus retry loop.
    if (eventRef.is<sf::Event::FocusGained>()) {
        initialFocusFramesLeft_ = 0;
        return;
    }
    if (eventRef.is<sf::Event::KeyPressed>()) {
        handleKeyPressed(eventRef, window);
        return;
    }
    if (eventRef.is<sf::Event::TextEntered>()) {
        if (uiState.isHelpVisible) return;
        if (worldEditor && worldEditor->isOpen()) {
            if (const auto* entered = eventRef.getIf<sf::Event::TextEntered>()) {
                worldEditor->handleTextEntered(entered->unicode);
            }
            return;
        }
        handleTextEntered(eventRef);
        return;
    }
    // Mouse / wheel / resize events are handled in the split TU.
    if (window) {
        // Ctrl+E Enemy Design Editor is modal: consume mouse clicks + wheel
        // before any panel below it sees them. Kept here instead of the mouse
        // router so modal editor priority stays next to keyboard routing.
        if (uiState.isEnemyEditorOpen && enemyDesignEditor) {
            if (auto* mousePress = eventRef.getIf<sf::Event::MouseButtonPressed>()) {
                enemyDesignEditor->handleClick(
                    mapWindowPixelToUi(*window, mousePress->position), uiState);
                return;
            }
            if (auto* wheel = eventRef.getIf<sf::Event::MouseWheelScrolled>()) {
                enemyDesignEditor->handleScroll(wheel->delta, uiState);
                return;
            }
        }
        processMouseEvent(eventRef, *window);
    }
}

void GameSession::handleKeyPressed(const sf::Event& eventRef, sf::RenderWindow* window) {
    const auto* keyEvent = eventRef.getIf<sf::Event::KeyPressed>();
    if (!keyEvent) return;

    using K = sf::Keyboard::Key;
    const bool isWorldEditorOpen = worldEditor && worldEditor->isOpen();
    if (isWorldEditorOpen && uiState.isHelpVisible) {
        if ((keyEvent->code == K::H && keyEvent->alt)
            || keyEvent->code == K::F1 || keyEvent->code == K::Escape) {
            uiState.isHelpVisible = false;
        }
        return;
    }
    if (isWorldEditorOpen) {
        if ((keyEvent->code == K::H && keyEvent->alt) || keyEvent->code == K::F1) {
            finishMouseGesturesBeforeHelp(window);
            uiState.isHelpVisible = true;
            return;
        }
        if (keyEvent->code == K::Q && keyEvent->alt) {
            worldEditor->close();
            if (camera && worldInstance) {
                camera->setZoom(camera->currentZoom());
                camera->followTarget(worldInstance->hero().moveable().position);
            }
            return;
        }
        worldEditor->handleKey(keyEvent->code, keyEvent->control,
                               keyEvent->shift, keyEvent->alt);
        return;
    }
    if (keyEvent->code == K::F1) {
        const bool shouldShowHelp = !uiState.isHelpVisible;
        if (shouldShowHelp) finishMouseGesturesBeforeHelp(window);
        uiState.isHelpVisible = shouldShowHelp;
        return;
    }
    if (uiState.isHelpVisible) {
        if (keyEvent->code == K::Escape) uiState.isHelpVisible = false;
        return;
    }
    if (keyEvent->code == K::M && keyEvent->control && worldEditor) {
        uiState.isEnemyEditorOpen = false;
        uiState.isShowcaseOpen = false;
        uiState.isSettingsOpen = false;
        uiState.isInventoryOpen = false;
        uiState.isLootFilterOpen = false;
        uiState.isDiceCrafterOpen = false;
        uiState.isConsoleVisible = false;
        uiState.isConsoleFocused = false;
        uiState.hover = {};
        const sf::Vector2f focus = camera ? camera->focusPosition()
            : worldInstance->hero().moveable().position;
        worldEditor->openAt(focus);
        return;
    }
    // Ctrl+O = debug panel toggle. Grave (backtick) = console overlay toggle
    // (alias of `^`; see TextEntered for AZERTY).
    if (keyEvent->code == K::O && keyEvent->control) {
        uiState.isDebugPanelVisible = !uiState.isDebugPanelVisible;
        if (debugPanel) debugPanel->cancelConfigEdit();
        return;
    }
    if (keyEvent->code == K::H && keyEvent->control) {
        uiState.isShowcaseOpen = !uiState.isShowcaseOpen;
        return;
    }
    if (keyEvent->code == K::E && keyEvent->control) {
        uiState.isEnemyEditorOpen = !uiState.isEnemyEditorOpen;
        return;
    }
    // Gallery keyboard nav (while open): Tab cycles category; number keys
    // choose the sub-tab within the active category.
    if (uiState.isShowcaseOpen) {
        if (keyEvent->code == K::Tab) {
            uiState.galleryCategory = (uiState.galleryCategory + 1) % dof::render::kGalleryCategoryCount;
            uiState.showcaseActiveTab = uiState.gallerySubTab[uiState.galleryCategory];
            return;
        }
        int picked = -1;
        if (keyEvent->code == K::Num1 || keyEvent->code == K::Numpad1) picked = 0;
        else if (keyEvent->code == K::Num2 || keyEvent->code == K::Numpad2) picked = 1;
        else if (keyEvent->code == K::Num3 || keyEvent->code == K::Numpad3) picked = 2;
        if (picked >= 0) {
            const int cat = std::clamp(uiState.galleryCategory, 0,
                                        dof::render::kGalleryCategoryCount - 1);
            const int maxSub = static_cast<int>(
                dof::render::ComponentShowcaseRenderer::subTabLabels(cat).size()) - 1;
            if (picked <= maxSub) {
                uiState.gallerySubTab[cat] = picked;
                uiState.showcaseActiveTab = picked;
            }
            return;
        }
    }
    if (keyEvent->code == K::F) {
        uiState.isLootFilterOpen = !uiState.isLootFilterOpen;
        if (!uiState.isLootFilterOpen) {
            uiState.isLootFilterQualityFocused = false;
            uiState.isLootFilterLevelFocused   = false;
        }
        return;
    }
    // Loot filter field: Backspace edits the focused input; Enter/Escape
    // unfocuses. Handled before the console gate.
    if (uiState.isLootFilterOpen
        && (uiState.isLootFilterQualityFocused || uiState.isLootFilterLevelFocused)) {
        if (keyEvent->code == K::Backspace) {
            auto& buf = uiState.isLootFilterQualityFocused
                        ? uiState.lootFilterQualityInput
                        : uiState.lootFilterLevelInput;
            if (buf.size() > 1) buf.pop_back();
            else buf = "0";
            auto safeParseFilter = [](const std::string& s, int fallback) -> int {
                if (s.empty()) return fallback;
                try { return std::stoi(s); } catch (...) { return fallback; }
            };
            const int qualityMax = configLoader.getInt("QUALITY_MAX_SCORE");
            const int levelMax   = configLoader.getInt("HERO_MAX_LEVEL");
            const int q = std::clamp(safeParseFilter(uiState.lootFilterQualityInput, qualityMax), 0, qualityMax);
            const int l = std::clamp(safeParseFilter(uiState.lootFilterLevelInput, levelMax),     0, levelMax);
            lootFilter.maxQuality = q;
            lootFilter.maxLevel   = l;
            applyLootFilterToInventory();
            return;
        }
        if (keyEvent->code == K::Enter || keyEvent->code == K::Escape) {
            uiState.isLootFilterQualityFocused = false;
            uiState.isLootFilterLevelFocused   = false;
            return;
        }
    }
    if (keyEvent->code == K::Grave) {
        uiState.isConsoleVisible = !uiState.isConsoleVisible;
        uiState.isConsoleFocused = uiState.isConsoleVisible;
        if (uiState.isConsoleFocused) {
            uiState.isDebugSearchFocused = false;
            uiState.isLootFilterQualityFocused = false;
            uiState.isLootFilterLevelFocused = false;
            if (debugPanel) debugPanel->cancelConfigEdit();
        }
        return;
    }
    // Console focused: Up/Down navigates suggestions/history; Tab accepts or
    // cycles autocomplete.
    if (uiState.isConsoleFocused && console) {
        if (keyEvent->code == K::Escape) {
            uiState.isConsoleVisible = false;
            uiState.isConsoleFocused = false;
            console->clearSuggestions();
            return;
        }
        if (keyEvent->code == K::Enter) {
            if (!console->acceptSelectedSuggestion()) {
                const auto cmd = console->submit(configLoader);
                if (cmd.kind == dof::app::ConsoleCommandKind::SpawnWeapon) {
                    dispatchSpawnWeapon(cmd.spawnLevel, cmd.spawnTypeName);
                } else if (cmd.kind == dof::app::ConsoleCommandKind::SpawnEnemy) {
                    dispatchSpawnEnemy(cmd.spawnLevel, cmd.spawnTypeName);
                } else if (cmd.kind == dof::app::ConsoleCommandKind::SpawnDice) {
                    dispatchSpawnDice(cmd.spawnLevel, cmd.spawnTypeName);
                }
            }
            return;
        }
        if (keyEvent->code == K::Backspace) { console->backspace(); return; }
        if (keyEvent->code == K::Up) {
            if (!console->suggestions().empty()) console->moveSuggestionPrevious();
            else console->recallPrevious();
            return;
        }
        if (keyEvent->code == K::Down) {
            if (!console->suggestions().empty()) console->moveSuggestionNext();
            else console->recallNext();
            return;
        }
        if (keyEvent->code == K::Tab) {
            if (!console->acceptSelectedSuggestion())
                console->cycleAutocomplete(configLoader, keyEvent->shift);
            return;
        }
        if (keyEvent->code == K::PageUp) {
            console->scrollBy(configLoader.getInt("CONSOLE_SCROLL_PAGE_LINES"));
            return;
        }
        if (keyEvent->code == K::PageDown) {
            console->scrollBy(-configLoader.getInt("CONSOLE_SCROLL_PAGE_LINES"));
            return;
        }
        if (keyEvent->code == K::Home) {
            console->scrollBy(configLoader.getInt("CONSOLE_OUTPUT_LINES_MAX"));
            return;
        }
        if (keyEvent->code == K::End) {
            console->scrollToBottom();
            return;
        }
        return;
    }
    if (uiState.isDebugPanelVisible) {
        if (debugPanel && debugPanel->isConfigEditActive()
            && handleConfigEditKey(keyEvent->code)) {
            return;
        }
        auto switchTab = [&](int idx) {
            if (uiState.debugActiveTabIndex != idx) {
                if (debugPanel) debugPanel->scrollToTop();
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
                uiState.debugSearchQuery.clear();
                uiState.isDebugSearchFocused = false;
                if (debugPanel) debugPanel->cancelConfigEdit();
            }
            uiState.debugActiveTabIndex = idx;
        };
        if (keyEvent->code == K::Num1) { switchTab(0); return; }
        if (keyEvent->code == K::Num2) { switchTab(1); return; }
        if (keyEvent->code == K::Num3) { switchTab(2); return; }
        if (keyEvent->code == K::Num4) { switchTab(3); return; }
        if (keyEvent->code == K::Num5) { switchTab(4); return; }
        if (keyEvent->code == K::Num6) { switchTab(5); return; }
        if (keyEvent->code == K::Num7) { switchTab(6); return; }
        if (keyEvent->code == K::Num8) { switchTab(7); return; }
        if (keyEvent->code == K::Slash
            && dof::render::debugTabHasSearchBar(uiState.debugActiveTabIndex)) {
            uiState.isDebugSearchFocused = true;
            return;
        }
        if (uiState.isDebugSearchFocused) {
            if (keyEvent->code == K::Escape) {
                uiState.debugSearchQuery.clear();
                uiState.isDebugSearchFocused = false;
                if (debugPanel) debugPanel->scrollToTop();
                return;
            }
            if (keyEvent->code == K::Backspace) {
                if (!uiState.debugSearchQuery.empty()) {
                    uiState.debugSearchQuery.pop_back();
                    if (debugPanel) debugPanel->scrollToTop();
                }
                return;
            }
        }
        if (debugPanel && keyEvent->code == K::PageUp) {
            debugPanel->scrollBy(configLoader.getInt("DEBUG_PANEL_SCROLL_PAGE_LINES"));
            return;
        }
        if (debugPanel && keyEvent->code == K::PageDown) {
            debugPanel->scrollBy(-configLoader.getInt("DEBUG_PANEL_SCROLL_PAGE_LINES"));
            return;
        }
        if (debugPanel && keyEvent->code == K::Home) {
            debugPanel->scrollToTop();
            return;
        }
        if (debugPanel && keyEvent->code == K::End) {
            debugPanel->scrollBy(configLoader.getInt("DEBUG_PANEL_SCROLL_END_JUMP_LINES"));
            return;
        }
    }
    if (keyEvent->code == K::Escape) {
        if (uiState.isLootFilterOpen) {
            uiState.isLootFilterOpen = false;
            uiState.isLootFilterQualityFocused = false;
            uiState.isLootFilterLevelFocused   = false;
        }
        uiState.isInventoryOpen = false;
        uiState.isShowcaseOpen = false;
        uiState.isSettingsOpen = false;
        uiState.settingsDragRow = -1;
    }
    if (keyEvent->code == K::I && !uiState.isDebugSearchFocused) {
        uiState.isInventoryOpen = !uiState.isInventoryOpen;
        return;
    }
    if (keyEvent->code == K::G && !uiState.isDebugSearchFocused) {
        uiState.isDiceCrafterOpen = !uiState.isDiceCrafterOpen;
        return;
    }
    if (keyEvent->code == K::P && !uiState.isDebugSearchFocused) {
        uiState.isSettingsOpen = !uiState.isSettingsOpen;
        uiState.settingsDragRow = -1;
        if (uiState.isSettingsOpen) uiState.settingsStatus.clear();
        return;
    }
    if (keyEvent->code == K::X
        && !uiState.isDebugSearchFocused
        && uiState.isInventoryOpen) {
        interactionController->destroyHoveredInventoryItem();
        return;
    }
    if (keyEvent->code == K::Comma && !uiState.isDebugSearchFocused && window) {
        reloadConfig(window->getSize());
    }
    if (keyEvent->code == K::Space && !uiState.isDebugSearchFocused
        && dodgeSystem && worldInstance) {
        auto& hero = worldInstance->hero();
        if (!hero.damageable().isDead()) {
            const auto direction = hero.inputable().resolveDirection();
            if ((direction.x != 0.0f || direction.y != 0.0f)
                && dodgeSystem->tryConsumeCharge()) {
                const float duration = configLoader.getFloat("DODGE_DASH_DURATION_SECONDS");
                const float speed    = configLoader.getFloat("DODGE_DASH_SPEED");
                const float iframes  = configLoader.getFloat("DODGE_DASH_IFRAME_SECONDS");
                hero.triggerDash(direction, duration, speed, iframes);
            }
        }
    }
    if (keyEvent->code == K::R && keyEvent->control && !uiState.isDebugSearchFocused) {
        configLoader.loadDirectoryPreservingOverrides(options.configDirectory);
        colorTheme = dof::render::buildColorTheme(configLoader);
        if (evasionHub) evasionHub->refreshConfig(configLoader);
        if (diceMaker) diceMaker->refreshConfig();
        restartRun();
        if (window) applyConfigToRenderers(window->getSize());
    }
    if (keyEvent->code == K::Enter && !uiState.isDebugSearchFocused
        && worldInstance->hero().damageable().isDead()) {
        restartRun();
    }
}

void GameSession::handleTextEntered(const sf::Event& eventRef) {
    const auto* textEvent = eventRef.getIf<sf::Event::TextEntered>();
    if (!textEvent) return;

    // Spec §Console L2906 — TextEntered feeds the input. The caret `^`
    // doubles as the AZERTY console toggle.
    const auto unicode = textEvent->unicode;
    const auto toggle  = dof::app::toggleConsoleOnCaret(unicode, uiState.isConsoleVisible);
    if (toggle.handled) {
        uiState.isConsoleVisible = toggle.nowVisible;
        uiState.isConsoleFocused = toggle.nowVisible;
        if (toggle.nowVisible) {
            uiState.isDebugSearchFocused = false;
            uiState.isLootFilterQualityFocused = false;
            uiState.isLootFilterLevelFocused = false;
            if (debugPanel) debugPanel->cancelConfigEdit();
        }
        if (console && !toggle.nowVisible) console->clearSuggestions();
        return;
    }
    if (uiState.isConsoleFocused && console
        && unicode >= 0x20 && unicode < 0x7F
        && unicode != '`' && unicode != '^') {
        console->appendInput(static_cast<char>(unicode));
        return;
    }
    // Config editing is the highest-priority debug-panel text target. Keep
    // TextEntered exclusive so an overlapping popup cannot receive the same
    // keystroke and trigger a second mutation.
    if (debugPanel && debugPanel->isConfigEditActive()
        && unicode >= 0x20 && unicode < 0x7F
        && unicode != '`' && unicode != '^') {
        debugPanel->applyConfigEditKey(unicode, sf::Keyboard::Key::Unknown);
        return;
    }
    // Debug search field: printable ASCII except / (which opened it).
    if (uiState.isDebugSearchFocused
        && unicode >= 0x20 && unicode < 0x7F
        && unicode != '`' && unicode != '^' && unicode != '/') {
        uiState.debugSearchQuery += static_cast<char>(unicode);
        if (debugPanel) debugPanel->scrollToTop();
        return;
    }
    // Loot filter digit input into focused quality / level field.
    if (uiState.isLootFilterOpen
        && (uiState.isLootFilterQualityFocused || uiState.isLootFilterLevelFocused)
        && unicode >= '0' && unicode <= '9') {
        auto& buf = uiState.isLootFilterQualityFocused
                    ? uiState.lootFilterQualityInput
                    : uiState.lootFilterLevelInput;
        if (buf == "0") buf.clear();
        if (buf.size() < 3) buf += static_cast<char>(unicode);
        int val = buf.empty() ? 0 : std::stoi(buf);
        const int cap = uiState.isLootFilterQualityFocused
                        ? configLoader.getInt("QUALITY_MAX_SCORE")
                        : configLoader.getInt("HERO_MAX_LEVEL");
        if (val > cap) { val = cap; buf = std::to_string(cap); }
        auto& filterField = uiState.isLootFilterQualityFocused
                            ? lootFilter.maxQuality : lootFilter.maxLevel;
        filterField = val;
        applyLootFilterToInventory();
    }
}

}
