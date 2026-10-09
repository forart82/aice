#include "render/DebugPanel.hpp"

#include "loaders/ConfigLoader.hpp"
#include "render/ColorTheme.hpp"
#include "render/UiAccent.hpp"
#include "render/ui/UiSearchField.hpp"

#include <SFML/Graphics/Font.hpp>
#include <SFML/Graphics/RenderWindow.hpp>

#include <cstdint>

namespace dof::render {

bool debugTabHasSearchBar(int tabIndex) {
    // Enemies=2, Weapons=3, Dices=4, Floor=5, Config=7
    return tabIndex == 2 || tabIndex == 3 || tabIndex == 4
        || tabIndex == 5 || tabIndex == 7;
}

void drawDebugSearchField(sf::RenderWindow& window,
                           const DebugPanelRects& rects,
                           const std::string& query,
                           bool isFocused,
                           const dof::loaders::ConfigLoader& config,
                           const sf::Font& font,
                           unsigned textSize) {
    const float height = rects.searchBarHeight;
    if (height <= 0.0f) return;

    // Single-accent collapse: focused border = accent, normal border =
    // accent-dim, background = panel-bg, text/placeholder/caret = theme
    // text/dim tokens — no per-field DEBUG_SEARCH_* swatches.
    const UiAccent   accent = UiAccent::loadFromConfig(config);
    const ColorTheme theme  = buildColorTheme(config);

    const sf::Color bg               = resolvePanelBackground(config, "DEBUG_PANEL_BG");
    const sf::Color borderFocused    = accent.full();
    const sf::Color borderNormal     = accent.dim();
    const sf::Color caretColor       = theme.uiText;
    const sf::Color textColor        = theme.uiText;
    const sf::Color placeholderColor = theme.uiDim;

    ui::UiSearchField{bg, borderNormal, borderFocused,
                       textColor, placeholderColor, caretColor}
        .draw(window,
              {{rects.panelX, rects.searchBarY()}, {rects.panelWidth, height}},
              font, textSize, query, isFocused);
}

}
