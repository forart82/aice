#pragma once

// Spec §Debug Mode §Tabs §Config Tab L2853-2858 — lists every loaded
// config file, with an inline `KEY = value` dump per file. Phase G5 makes
// the rows EDITABLE in-game: click a row to focus a ui::UiTextInput seeded
// with the current value (Enter commits an override, Esc cancels), and a
// ui::UiButton persists every override via ConfigLoader::saveOverrides.
// Overridden rows are marked with an accent tint + `*`. The tab is
// immediate-mode: the CALLER (DebugPanel) owns the edit state and the click
// bands; this draw call renders from them and writes the bands back.

#include <SFML/Graphics/Color.hpp>
#include <SFML/Graphics/Font.hpp>
#include <SFML/Graphics/Rect.hpp>
#include <SFML/Graphics/RenderWindow.hpp>
#include <SFML/System/Vector2.hpp>

#include <string>
#include <vector>

namespace dof::loaders { class ConfigLoader; }
namespace dof::render  { struct DebugPanelRects; }

namespace dof::render {

// Pure helpers — testable.
std::vector<std::string> listConfigFiles(const dof::loaders::ConfigLoader& loader);
std::vector<std::string> listKeysForFile(const dof::loaders::ConfigLoader& loader,
                                           const std::string& sourceFileStem);

// One clickable config-value row painted last frame. The click handler
// hit-tests `rect` (UI design coords) to learn which `key` the user picked;
// `isOverridden` only drives the row's paint, not the hit-test.
struct ConfigRowBand {
    sf::FloatRect rect;
    std::string   key;
    bool          isOverridden{false};
};

// Edit + toolbar state handed to the Config-tab renderer. `focusedKey` is
// empty when no row is being edited; when set, that row draws a text input
// seeded with `editBuffer` (caret at `caret`). `statusMessage` is the
// transient Save/validation banner; `mouseUi` drives the Save button hover.
struct ConfigTabEditContext {
    std::string  focusedKey;
    std::string  editBuffer;
    int          caret{0};
    std::string  statusMessage;
    sf::Vector2f mouseUi{0.0f, 0.0f};
};

// Return the key of the band under `cursorUi`, or an empty string when the
// cursor is not over any row. Pure — testable without a render context.
std::string configRowKeyAt(const std::vector<ConfigRowBand>& bands, sf::Vector2f cursorUi);

// Draw the Config tab. `edit` supplies the focused row + toolbar state;
// `outRowBands` (nullable) receives one band per painted value row and
// `outSaveButtonRect` (nullable) receives the Save button rect, both for
// next-frame click hit-testing. Returns the total logical row count for the
// caller's scroll clamp. Colours are read from the loader (DEBUG_SEARCH_* /
// DEBUG_PANEL_* keys) so the tab restyles with the rest of the debug panel.
int drawConfigTab(sf::RenderWindow& window,
                    const DebugPanelRects& rects,
                    const dof::loaders::ConfigLoader& loader,
                    const sf::Font& font,
                    unsigned textSize,
                    sf::Color textColor,
                    int scrollOffset,
                    const std::string& searchQuery,
                    const ConfigTabEditContext& edit,
                    std::vector<ConfigRowBand>* outRowBands = nullptr,
                    sf::FloatRect* outSaveButtonRect = nullptr);

}
