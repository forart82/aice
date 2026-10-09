#include "app/GameSession.hpp"

#include "combat/PowderCalculator.hpp"
#include "entities/PowderColor.hpp"
#include "helpers/StringHelper.hpp"
#include "render/ConfigTab.hpp"

#include <SFML/Graphics/RenderWindow.hpp>
#include <SFML/Window/Event.hpp>
#include <SFML/Window/Keyboard.hpp>
#include <SFML/Window/Mouse.hpp>

#include <string>

namespace dof::app {

void GameSession::applyKeyboardInputsToHero() {
    if (!worldInstance) return;
    auto& input = worldInstance->hero().inputable();
    // Deterministic diagonal movement for the rendering regression smoke. It
    // exercises continuous camera tracking without depending on window focus
    // or synthetic OS events.
    if (options.isSelfTestMoving) {
        input.isPressedW = false;
        input.isPressedA = false;
        input.isPressedS = true;
        input.isPressedD = true;
        return;
    }
    // Real-hardware polling only makes sense for a focused, on-screen
    // window; headless has no keyboard.
    if (options.isHeadless) {
        return;
    }
    // Spec §Console — typing into the console must not move the hero.
    // Zero the four input axes so the hero stops cleanly the instant
    // the user focuses the console (and does not drift if they hold W
    // before typing). Phase G5 — the same guard covers an active editable
    // Config-tab row so typing a value (e.g. "wasd" into a string key) never
    // walks the hero. Phase G (G-misc) — and the open player Settings panel,
    // so tuning the UI live never nudges the hero underneath it.
    if ((worldEditor && worldEditor->isOpen())
        || uiState.isHelpVisible || uiState.isConsoleFocused || uiState.isSettingsOpen
        || (debugPanel && debugPanel->isConfigEditActive())) {
        input.isPressedW = false;
        input.isPressedA = false;
        input.isPressedS = false;
        input.isPressedD = false;
        return;
    }
    // W is also the Ctrl+W catalog-window combo. Suppress the movement
    // poll while either Control key is held so opening the catalog never
    // nudges the hero north.
    const bool isControlHeld = sf::Keyboard::isKeyPressed(sf::Keyboard::Key::LControl)
                               || sf::Keyboard::isKeyPressed(sf::Keyboard::Key::RControl);
    input.isPressedW = sf::Keyboard::isKeyPressed(sf::Keyboard::Key::W) && !isControlHeld;
    input.isPressedA = sf::Keyboard::isKeyPressed(sf::Keyboard::Key::A);
    input.isPressedS = sf::Keyboard::isKeyPressed(sf::Keyboard::Key::S);
    input.isPressedD = sf::Keyboard::isKeyPressed(sf::Keyboard::Key::D);
}

sf::Vector2f GameSession::currentCursorWorld(sf::RenderWindow& window) const {
    if (!camera) return {0.0f, 0.0f};
    const sf::Vector2i pixel = sf::Mouse::getPosition(window);
    return mapWindowPixelToWorld(window, pixel);
}

sf::Vector2f GameSession::mapWindowPixelToWorld(sf::RenderWindow& window,
                                                 sf::Vector2i pixel) const {
    if (!camera) return {0.0f, 0.0f};
    sf::View view = camera->activeView();
    const sf::IntRect viewport = dof::render::computeIntegerLetterbox(
        window.getSize(), camera->designSize());
    const sf::Vector2u windowSize = window.getSize();
    view.setViewport({
        {static_cast<float>(viewport.position.x) / static_cast<float>(windowSize.x),
         static_cast<float>(viewport.position.y) / static_cast<float>(windowSize.y)},
        {static_cast<float>(viewport.size.x) / static_cast<float>(windowSize.x),
         static_cast<float>(viewport.size.y) / static_cast<float>(windowSize.y)}});
    return window.mapPixelToCoords(pixel, view);
}

void GameSession::rebuildUiView(sf::Vector2u windowSize) {
    if (uiDesignSize.x == 0u || uiDesignSize.y == 0u) {
        uiDesignSize = sf::Vector2u{static_cast<unsigned>(configLoader.getInt("UI_DESIGN_WIDTH")),
                                      static_cast<unsigned>(configLoader.getInt("UI_DESIGN_HEIGHT"))};
    }
    uiView = sf::View(sf::FloatRect{{0.0f, 0.0f},
                                     {static_cast<float>(uiDesignSize.x),
                                      static_cast<float>(uiDesignSize.y)}});
    uiView.setViewport(dof::render::computeLetterboxViewport(
        windowSize.x, windowSize.y, uiDesignSize.x, uiDesignSize.y));
}

sf::Vector2f GameSession::mapWindowPixelToUi(sf::RenderWindow& window, sf::Vector2i pixel) const {
    return window.mapPixelToCoords(pixel, uiView);
}

void GameSession::applyLootFilterToInventory() {
    if (!lootFilter.isActive() || !inventoryHub || !powderHub) return;
    for (int i = 0; i < inventoryHub->slotCount(); ++i) {
        const auto* item = inventoryHub->peekItem(i);
        if (!item || item->isEmpty()) continue;
        if (!lootFilter.matchesInventoryItem(*item)) continue;
        if (item->isWeapon()) {
            const int amount = dof::combat::powderForWeapon(*item->weapon, configLoader);
            const auto color = dof::entities::powderColorForWeapon(item->weapon->type());
            powderHub->addPowder(color, amount);
        } else if (item->isDice()) {
            const int amount = dof::combat::powderForDice(*item->dice, configLoader);
            const auto color = dof::entities::powderColorForDice(item->dice->face());
            powderHub->addPowder(color, amount);
        }
        inventoryHub->takeItemFrom(i);
    }
}

bool GameSession::handleConfigTabClick(sf::Vector2f cursorUi) {
    if (!debugPanel) return false;
    // Save button — persist every override to the `_overrides.yaml` sidecar
    // (reuses the console `save` path) and show a confirmation banner.
    const sf::FloatRect saveRect = debugPanel->configSaveButtonRect();
    if (saveRect.size.x > 0.0f
        && cursorUi.x >= saveRect.position.x
        && cursorUi.x <  saveRect.position.x + saveRect.size.x
        && cursorUi.y >= saveRect.position.y
        && cursorUi.y <  saveRect.position.y + saveRect.size.y) {
        const int written = configLoader.saveOverrides();
        if (written < 0) {
            debugPanel->setConfigStatus("save failed: could not write "
                                        + configLoader.overridesFilePath().string());
        } else {
            debugPanel->setConfigStatus("saved " + std::to_string(written) + " override(s)");
        }
        return true;
    }
    // Value row — focus it for editing, seeded with the current value. Editing
    // a row steals focus from the key filter so the two never fight for input.
    const std::string key =
        dof::render::configRowKeyAt(debugPanel->lastConfigRowBands(), cursorUi);
    if (!key.empty()) {
        uiState.isDebugSearchFocused = false;
        debugPanel->beginConfigEdit(key, configLoader.getString(key));
        return true;
    }
    // Click anywhere else in the Config body cancels an in-progress edit.
    if (debugPanel->isConfigEditActive()) debugPanel->cancelConfigEdit();
    return false;
}

bool GameSession::handleConfigEditKey(sf::Keyboard::Key key) {
    if (!debugPanel || !debugPanel->isConfigEditActive()) return false;
    using K = sf::Keyboard::Key;
    if (key == K::Enter) {
        const std::string editKey   = debugPanel->configEditKeyName();
        const std::string candidate = dof::helpers::trim(debugPanel->configEditText());
        if (configLoader.isOverrideValueValid(editKey, candidate)) {
            // setOverride raises the dirty edge; the run loop re-applies config
            // next frame so the change shows live. The row repainting with the
            // new value + `*` override mark is the confirmation (no banner).
            configLoader.setOverride(editKey, candidate);
        } else {
            debugPanel->setConfigStatus("rejected: invalid value for " + editKey);
        }
        debugPanel->cancelConfigEdit();
        return true;
    }
    if (key == K::Escape) {
        debugPanel->cancelConfigEdit();
        return true;
    }
    // Backspace / Delete / arrows / Home / End edit the buffer in place;
    // printable characters arrive via TextEntered, not here. Every key is
    // swallowed (return true) while a row is focused so none leaks to a hero
    // hotkey (I / G / X / Space / Num tab-switch, …).
    debugPanel->applyConfigEditKey(0, key);
    return true;
}

bool GameSession::handleSettingsMouseEvent(const sf::Event& eventRef, sf::RenderWindow& window) {
    if (!settingsPanel) return false;
    const auto& rows = settingsPanel->rows();
    const auto rowKey = [&](int i) { return rows[static_cast<std::size_t>(i)].configKey; };

    // Move: while a slider row is armed, retarget its value from the cursor x
    // (UiSlider::valueAtX under the hood) — the drag may travel outside the
    // window and still track. Over the window (or during a drag) keep
    // uiState.mouseUi current for the panel's own hover, since the modal
    // guard skips the interaction controller's updateMouseUi. Moves elsewhere
    // fall through so world/inventory hover stays live.
    if (auto* mouseMove = eventRef.getIf<sf::Event::MouseMoved>()) {
        const sf::Vector2f cursorUi = mapWindowPixelToUi(window, mouseMove->position);
        if (uiState.settingsDragRow >= 0
            && uiState.settingsDragRow < static_cast<int>(rows.size())) {
            uiState.mouseUi = cursorUi;
            configLoader.setOverride(
                rowKey(uiState.settingsDragRow),
                std::to_string(settingsPanel->sliderValueAt(uiState.settingsDragRow, cursorUi.x)));
            return true;
        }
        if (settingsPanel->contains(cursorUi)) { uiState.mouseUi = cursorUi; return true; }
        return false;
    }

    if (auto* mousePress = eventRef.getIf<sf::Event::MouseButtonPressed>()) {
        const sf::Vector2f cursorUi = mapWindowPixelToUi(window, mousePress->position);
        if (!settingsPanel->contains(cursorUi)) return false;   // clicks outside pass through
        uiState.mouseUi = cursorUi;
        if (mousePress->button != sf::Mouse::Button::Left) return true;  // swallow non-left in-panel
        // Save — persist every override to _overrides.yaml + confirm.
        if (settingsPanel->saveButtonContains(cursorUi)) {
            const int written = configLoader.saveOverrides();
            uiState.settingsStatus = written < 0
                ? std::string("save failed")
                : ("Saved " + std::to_string(written) + " override(s)");
            return true;
        }
        // Slider band — arm the drag and jump the value to the click x.
        const int sliderRow = settingsPanel->sliderRowAt(cursorUi);
        if (sliderRow >= 0) {
            uiState.settingsDragRow = sliderRow;
            configLoader.setOverride(rowKey(sliderRow),
                                     std::to_string(settingsPanel->sliderValueAt(sliderRow, cursorUi.x)));
            return true;
        }
        // Toggle box — flip the bound 0/1 flag.
        const int toggleRow = settingsPanel->toggleRowAt(cursorUi);
        if (toggleRow >= 0) {
            const bool isOn = configLoader.getInt(rowKey(toggleRow)) != 0;
            configLoader.setOverride(rowKey(toggleRow), isOn ? "0" : "1");
            return true;
        }
        return true;   // click on chrome (title/label) — swallow, don't leak
    }

    if (auto* mouseRelease = eventRef.getIf<sf::Event::MouseButtonReleased>()) {
        if (mouseRelease->button == sf::Mouse::Button::Left && uiState.settingsDragRow >= 0) {
            uiState.settingsDragRow = -1;
            return true;
        }
        return false;
    }

    // Swallow the wheel over the window so the camera never zooms underneath.
    if (auto* wheel = eventRef.getIf<sf::Event::MouseWheelScrolled>()) {
        return settingsPanel->contains(mapWindowPixelToUi(window, wheel->position));
    }
    return false;   // Resized + anything else falls through
}

}
