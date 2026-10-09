#include "render/ConfigTab.hpp"

#include "helpers/StringHelper.hpp"
#include "loaders/ConfigLoader.hpp"
#include "render/DebugPanel.hpp"
#include "render/UiAccent.hpp"
#include "render/ui/UiButton.hpp"
#include "render/ui/UiPanel.hpp"
#include "render/ui/UiTextInput.hpp"

#include <SFML/Graphics/Text.hpp>

#include <algorithm>
#include <cstdint>
#include <filesystem>
#include <set>

namespace dof::render {

namespace {

std::string stemOf(const std::string& sourceFilePath) {
    return std::filesystem::path(sourceFilePath).stem().string();
}

// Draw one row of text vertically centred in a rowH band at (x, y), matching
// the centring UiTextInput uses so text rows and the focused input line up.
void drawRowText(sf::RenderWindow& window, const sf::Font& font, unsigned textSize,
                 float x, float y, float rowH, const std::string& text, sf::Color color) {
    if (text.empty()) return;
    sf::Text glyphs(font, text, textSize);
    glyphs.setFillColor(color);
    const sf::FloatRect bounds = glyphs.getLocalBounds();
    glyphs.setPosition({x, y + rowH * 0.5f - bounds.size.y * 0.5f - bounds.position.y});
    window.draw(glyphs);
}

}

std::vector<std::string> listConfigFiles(const dof::loaders::ConfigLoader& loader) {
    std::set<std::string> uniqueStems;
    for (const auto& [key, entry] : loader.entries()) {
        if (!entry.sourceFile.empty()) {
            uniqueStems.insert(stemOf(entry.sourceFile));
        }
    }
    return std::vector<std::string>(uniqueStems.begin(), uniqueStems.end());
}

std::vector<std::string> listKeysForFile(const dof::loaders::ConfigLoader& loader,
                                           const std::string& sourceFileStem) {
    std::vector<std::string> result;
    for (const auto& [key, entry] : loader.entries()) {
        if (stemOf(entry.sourceFile) == sourceFileStem) {
            result.push_back(key);
        }
    }
    std::sort(result.begin(), result.end());
    return result;
}

std::string configRowKeyAt(const std::vector<ConfigRowBand>& bands, sf::Vector2f cursorUi) {
    for (const auto& band : bands) {
        if (cursorUi.x >= band.rect.position.x
            && cursorUi.x <  band.rect.position.x + band.rect.size.x
            && cursorUi.y >= band.rect.position.y
            && cursorUi.y <  band.rect.position.y + band.rect.size.y) {
            return band.key;
        }
    }
    return {};
}

int drawConfigTab(sf::RenderWindow& window,
                    const DebugPanelRects& rects,
                    const dof::loaders::ConfigLoader& loader,
                    const sf::Font& font,
                    unsigned textSize,
                    sf::Color textColor,
                    int scrollOffset,
                    const std::string& searchQuery,
                    const ConfigTabEditContext& edit,
                    std::vector<ConfigRowBand>* outRowBands,
                    sf::FloatRect* outSaveButtonRect) {
    if (outRowBands) outRowBands->clear();
    const std::string lowerQ = dof::helpers::toLower(searchQuery);

    // Single-accent collapse: every chrome colour below resolves to one of
    // the five tokens (accent / accent-dim / panel-bg / text / text-dim) so
    // the Config tab reads as one accent. accent = focused border + Save
    // border; accent-dim = normal border + button hover; panel-bg = every
    // field/button/body background; theme text/dim = all labels + caret.
    const UiAccent   accent = UiAccent::loadFromConfig(loader);
    const ColorTheme theme  = buildColorTheme(loader);
    const sf::Color  panelBg          = resolvePanelBackground(loader, "DEBUG_PANEL_BG");
    const sf::Color  accentColor      = accent.full();
    const sf::Color  inputBg          = panelBg;
    const sf::Color  inputBorderFocus = accent.full();
    const sf::Color  inputBorderDim   = accent.dim();
    const sf::Color  inputCaret       = theme.uiText;
    const sf::Color  inputTextColor   = theme.uiText;
    const sf::Color  inputPlaceholder = theme.uiDim;
    const sf::Color  buttonBg         = panelBg;
    const sf::Color  buttonHover      = accent.dim();
    const sf::Color  buttonLabel      = theme.uiText;
    const sf::Color  statusColor      = theme.uiText;

    ui::UiPanel{panelBg, sf::Color::Transparent, 0.0f}
        .draw(window, {{rects.panelX, rects.bodyY()},
                       {rects.panelWidth, rects.bodyHeight()}});

    const float rowH = static_cast<float>(textSize) + 4.0f;
    const float padX = 12.0f;
    const float padY = 8.0f;

    // Toolbar strip at the top of the body: Save button flush-right, the
    // transient status/confirmation banner on the left.
    const float toolbarH = rowH + 6.0f;
    const float saveW    = 64.0f;
    const sf::FloatRect saveRect{
        {rects.panelX + rects.panelWidth - padX - saveW, rects.bodyY() + 3.0f},
        {saveW, rowH}};
    if (outSaveButtonRect) *outSaveButtonRect = saveRect;
    // Status banner first (left side), then the Save button on top so a long
    // message (e.g. an apply-failure) can never hide or overdraw the button.
    if (!edit.statusMessage.empty()) {
        drawRowText(window, font, textSize, rects.panelX + padX, rects.bodyY() + 3.0f,
                    rowH, edit.statusMessage, statusColor);
    }
    const bool saveHovered =
        edit.mouseUi.x >= saveRect.position.x
        && edit.mouseUi.x <  saveRect.position.x + saveRect.size.x
        && edit.mouseUi.y >= saveRect.position.y
        && edit.mouseUi.y <  saveRect.position.y + saveRect.size.y;
    ui::UiButton{buttonBg, buttonHover, accentColor, buttonLabel, buttonLabel}
        .draw(window, saveRect, font, "Save", textSize, saveHovered);

    // Logical row model: one section header per config file, then a row per
    // key (search-filtered), then a blank separator. Overridden rows carry
    // the accent tint + a `*` marker so live-tuned keys stand out.
    struct Row { std::string text; sf::Color color; std::string key; bool isKeyRow; bool isOverridden; };
    std::vector<Row> rows;
    const auto files = listConfigFiles(loader);
    if (files.empty()) {
        rows.push_back({"<no configs loaded>", textColor, {}, false, false});
    } else {
        // Section headers ([file]) read the accent so they stand out as
        // chrome emphasis; overridden-key rows share the accent but stay
        // distinct via their `* KEY` marker.
        const sf::Color headerTint = accentColor;
        for (const auto& fileName : files) {
            rows.push_back({"[" + fileName + "]", headerTint, {}, false, false});
            for (const auto& key : listKeysForFile(loader, fileName)) {
                const std::string value = loader.getString(key);
                const bool isOverridden = loader.isUserOverride(key);
                if (!lowerQ.empty()
                    && dof::helpers::toLower(key + " " + value).find(lowerQ) == std::string::npos)
                    continue;
                const std::string line = std::string("  ") + (isOverridden ? "* " : "")
                                       + key + " = " + value;
                rows.push_back({line, isOverridden ? accentColor : textColor, key, true, isOverridden});
            }
            rows.push_back({{}, textColor, {}, false, false});
        }
    }

    const int totalLines = static_cast<int>(rows.size());
    const int start = std::clamp(scrollOffset, 0, totalLines);

    const float listX      = rects.panelX + padX;
    const float listW      = rects.panelWidth - 2.0f * padX;
    const float listTop    = rects.bodyY() + toolbarH;
    const float listBottom = rects.bodyY() + rects.bodyHeight() - padY;
    const float inputW     = listW * 0.42f;

    float y = listTop;
    for (int i = start; i < totalLines; ++i) {
        if (y + rowH > listBottom) break;  // manual clip to the list area
        const Row& row = rows[i];
        if (row.isKeyRow && outRowBands) {
            outRowBands->push_back({{{listX, y}, {listW, rowH}}, row.key, row.isOverridden});
        }
        const bool isFocusedRow =
            row.isKeyRow && !edit.focusedKey.empty() && row.key == edit.focusedKey;
        if (isFocusedRow) {
            // Left: "  KEY =" label; right: the editable value box (drawn last
            // so its fill covers any overflow from a long key label).
            drawRowText(window, font, textSize, listX, y, rowH,
                        std::string("  ") + row.key + " =", accentColor);
            const sf::FloatRect inputRect{{listX + listW - inputW, y}, {inputW, rowH}};
            ui::UiTextInput{inputBg, inputBorderDim, inputBorderFocus,
                            inputTextColor, inputPlaceholder, inputCaret}
                .draw(window, inputRect, font, textSize, edit.editBuffer, true, edit.caret, "value");
        } else {
            drawRowText(window, font, textSize, listX, y, rowH, row.text, row.color);
        }
        y += rowH;
    }

    return totalLines;
}

}
