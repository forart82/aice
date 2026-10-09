#include "render/ConsoleOverlay.hpp"

#include "app/Console.hpp"
#include "app/ConsoleCheatTooltip.hpp"
#include "loaders/ConfigLoader.hpp"
#include "render/ColorTheme.hpp"
#include "render/UiAccent.hpp"
#include "render/UiState.hpp"
#include "render/ui/UiChip.hpp"
#include "render/ui/UiDivider.hpp"
#include "render/ui/UiLabel.hpp"
#include "render/ui/UiPanel.hpp"

#include <SFML/Graphics/Text.hpp>

#include <algorithm>
#include <string>

namespace dof::render {

ConsoleOverlayRects computeConsoleOverlayRects(sf::Vector2u windowSize,
                                                 float widthFrac,
                                                 float heightFrac,
                                                 float inputLineHeight,
                                                 float dropdownRowHeight) {
    ConsoleOverlayRects rects;
    const auto w = static_cast<float>(windowSize.x);
    const auto h = static_cast<float>(windowSize.y);
    rects.panelWidth      = w * widthFrac;
    rects.panelHeight     = h * heightFrac;
    rects.panelX          = (w - rects.panelWidth) * 0.5f;
    // Spec L2919 — pinned to the top edge of the screen (no vertical
    // centring). A small top margin keeps the panel off the bezel AND
    // leaves room for the title/status chip badges that overhang upward
    // by chipHeight*0.5 (= 10 px by default). The 12 px margin below
    // clears that overhang with 2 px of headroom for the chip's own
    // accent outline.
    rects.panelY          = 12.0f;
    rects.inputLineHeight = inputLineHeight;
    rects.outputHeight    = std::max(0.0f, rects.panelHeight - inputLineHeight);
    rects.dropdownRowHeight = dropdownRowHeight;
    return rects;
}

ConsoleOverlay::ConsoleOverlay(const dof::loaders::ConfigLoader& config, const sf::Font& fontRef)
    : font(fontRef),
      widthFrac(config.getFloat("CONSOLE_OVERLAY_WIDTH_FRAC")),
      heightFrac(config.getFloat("CONSOLE_OVERLAY_HEIGHT_FRAC")),
      inputLineHeight(static_cast<float>(config.getInt("CONSOLE_INPUT_HEIGHT"))),
      dropdownRowHeight(static_cast<float>(config.getInt("CONSOLE_DROPDOWN_ROW_HEIGHT"))),
      textSize(static_cast<unsigned>(config.getInt("DEBUG_PANEL_TEXT_SIZE"))),
      panelBg(resolvePanelBackground(config, "CONSOLE_OUTPUT_BG")),
      panelBorder(UiAccent::loadFromConfig(config).full()),
      panelBorderThickness(UiAccent::loadFromConfig(config).thicknessOutline),
      // Single-accent chrome collapse (Phase B): the input strip, dropdown
      // container, caret + selected-row highlight were distinct hues (violet
      // fills, cyan caret, purple highlight). They now read the shared
      // panel-bg / accent tokens so the console chrome matches every other
      // framed surface. Neutral log text (input/output/dropdown) and the
      // per-level error/success colours stay — those are semantic, not chrome.
      inputBg(resolvePanelBackground(config, "CONSOLE_OUTPUT_BG")),
      inputText(readRgbPrefixed(config, "CONSOLE_INPUT_TEXT")),
      caretColor(UiAccent::loadFromConfig(config).full()),
      outputBg(readRgbPrefixed(config, "CONSOLE_OUTPUT_BG",
                                config.getInt("CONSOLE_OUTPUT_BG_ALPHA"))),
      outputText(readRgbPrefixed(config, "CONSOLE_OUTPUT_TEXT")),
      errorText(readRgbPrefixed(config, "CONSOLE_ERROR_TEXT")),
      successText(readRgbPrefixed(config, "CONSOLE_SUCCESS_TEXT")),
      dropdownBg(resolvePanelBackground(config, "CONSOLE_OUTPUT_BG")),
      dropdownRowHighlight(UiAccent::loadFromConfig(config).dim()),
      dropdownText(readRgbPrefixed(config, "CONSOLE_DROPDOWN_TEXT")),
      inputPrefix(config.getString("CONSOLE_INPUT_PREFIX")),
      outputPrefix(config.getString("CONSOLE_OUTPUT_PREFIX")) {
    // Shared ui/* design tokens. The accent outline drives the frame,
    // the dropdown neon hover edge, and the cheat-tooltip outline; the
    // two chips are the corner title/status badges (replacing the old
    // PanelChromeV2 drawTitleChip/drawStatusChip free functions).
    accent = UiAccent::loadFromConfig(config);
    titleChip = ui::UiChip::loadFromConfig(config);
    titleChip.anchor = ui::UiChip::Anchor::TopLeft;
    statusChip = ui::UiChip::loadFromConfig(config);
    statusChip.anchor = ui::UiChip::Anchor::TopRight;
}

ConsoleOverlayRects ConsoleOverlay::computeRects(sf::Vector2u windowSize) const {
    return computeConsoleOverlayRects(windowSize, widthFrac, heightFrac,
                                        inputLineHeight, dropdownRowHeight);
}

void ConsoleOverlay::render(sf::RenderWindow& window,
                              const UiState& uiState,
                              const dof::app::Console& console) {
    if (!uiState.isConsoleVisible) return;
    const auto viewSize = window.getView().getSize();
    const auto rects = computeRects(sf::Vector2u{static_cast<unsigned>(viewSize.x),
                                                  static_cast<unsigned>(viewSize.y)});

    // Terminal frame — a square-cornered UiPanel with the accent outline
    // (drawFlatPanel never actually chamfered despite its name, so UiPanel
    // is a faithful replacement).
    const sf::FloatRect panelRect{{rects.panelX, rects.panelY},
                                   {rects.panelWidth, rects.panelHeight}};
    ui::UiPanel{panelBg, panelBorder, panelBorderThickness}.draw(window, panelRect);

    drawOutputArea(window, rects, console);
    drawInputLine(window, rects, console);
    drawDropdown(window, rects, console);
    drawCheatTooltip(window, rects, console);

    // Title chip top-left ("CONSOLE") + status chip top-right (scrollback
    // line count). Painted AFTER the inner contents so the chips overhang
    // the outline cleanly without the input/output bg rects clipping them.
    const float titleChipWidth  = 110.0f;
    const float statusChipWidth = 110.0f;
    titleChip.draw(window, panelRect, font, "CONSOLE", titleChipWidth);
    const std::string statusLabel =
        std::to_string(console.outputLines().size()) + " lines";
    // Status dot reads the accent (chrome), not the success-green — the line
    // count is a chrome affordance, not a semantic log-level signal.
    statusChip.draw(window, panelRect, font, statusLabel, statusChipWidth, accent.full());
}

void ConsoleOverlay::drawOutputArea(sf::RenderWindow& window,
                                       const ConsoleOverlayRects& rects,
                                       const dof::app::Console& console) const {
    // The panel body painted upstream in `render()` (via UiPanel) already
    // fills the output region with `panelBg`; scrollback text reads
    // against that fill (no separate output-bg overpaint).

    const auto& lines = console.outputLines();
    // Bottom-anchored scrollback: newest line sits flush with the input
    // edge; older lines stack upward. Lines that fall off the top edge
    // are clipped naturally because we stop drawing once `y` goes above
    // the panel top. `Console::scrollOffset` shifts the window further
    // back into history — every offset line is skipped before the visible
    // window starts (card-mpkd92tu).
    const float lineHeight = static_cast<float>(textSize) + 4.0f;
    float y = rects.inputY() - lineHeight - 2.0f;
    auto it = lines.rbegin();
    for (int skip = console.scrollOffset();
         skip > 0 && it != lines.rend();
         --skip, ++it) {}
    for (; it != lines.rend(); ++it) {
        if (y < rects.panelY) break;
        const auto& line = *it;
        sf::Color colour = outputText;
        std::string prefix = outputPrefix + std::string(" ");
        switch (line.kind) {
            case dof::app::ConsoleLineKind::Input:   colour = inputText;  prefix = inputPrefix + " "; break;
            case dof::app::ConsoleLineKind::Output:  colour = outputText;                              break;
            case dof::app::ConsoleLineKind::Error:   colour = errorText;                               break;
            case dof::app::ConsoleLineKind::Success: colour = successText;                             break;
        }
        // Per-line UiLabel — each scrollback line carries its own log-kind
        // colour, so a per-line label (not a single UiList) is the fit.
        // The rect x is panelX+6 so UiLabel's Left-align +2 inset lands the
        // text at panelX+8 (the old hand-placed x).
        const sf::FloatRect lineRect{{rects.panelX + 6.0f, y},
                                      {rects.panelWidth, lineHeight}};
        ui::UiLabel{colour, textSize, ui::TextAlign::Left}
            .draw(window, lineRect, font, prefix + line.text);
        y -= lineHeight;
    }
}

void ConsoleOverlay::drawInputLine(sf::RenderWindow& window,
                                      const ConsoleOverlayRects& rects,
                                      const dof::app::Console& console) const {
    // Input-line background — panel-bg fill with a dim-accent border. The
    // strip now shares the panel-bg token, so an accent-dim outline supplies
    // the separation the old distinct violet fill used to (the divider
    // between the scrollback and the live input line).
    const sf::FloatRect inputRect{{rects.panelX, rects.inputY()},
                                   {rects.panelWidth, rects.inputLineHeight}};
    ui::UiPanel{inputBg, accent.dim(), panelBorderThickness}
        .draw(window, inputRect);

    // Prefix the live input with the configured input prefix (same glyph
    // the scrollback uses for past Input lines) so the input line stays
    // config-driven with no hard-coded glyph.
    const std::string inputStr = inputPrefix + std::string(" ") + console.input();
    ui::UiLabel{inputText, textSize, ui::TextAlign::Left}
        .draw(window, inputRect, font, inputStr);

    // Spec §Console Visual L2909 — bright cyan caret on the input line,
    // parked just past the typed text. `sf::Text` here is only measured
    // (not drawn) to find the text width; the caret itself is a 2px
    // vertical UiDivider bar.
    sf::Text measure(font, inputStr, textSize);
    const auto bounds = measure.getLocalBounds();
    const float caretX = rects.panelX + 8.0f + bounds.size.x + 2.0f;
    ui::UiDivider{caretColor, 2.0f}
        .drawVertical(window, caretX, rects.inputY() + 4.0f, static_cast<float>(textSize) + 2.0f);
}

void ConsoleOverlay::drawCheatTooltip(sf::RenderWindow& window,
                                       const ConsoleOverlayRects& rects,
                                       const dof::app::Console& console) const {
    const auto text = dof::app::consoleCheatTooltip(console.input());
    if (text.empty()) return;

    int lineCount = 1;
    for (char c : text) { if (c == '\n') ++lineCount; }
    const float lineHeight = static_cast<float>(textSize) + 4.0f;
    const float paddingX   = 10.0f;
    const float paddingY   = 6.0f;
    const float panelHeight = paddingY * 2.0f + lineHeight * static_cast<float>(lineCount);
    const float panelWidth  = rects.panelWidth;

    // Anchored just under the dropdown (if visible) so the tooltip
    // never overlaps the suggestion rows.
    const float dropdownH = rects.dropdownHeight(static_cast<int>(console.suggestions().size()));
    const float yTop = rects.inputBottom() + dropdownH + 4.0f;

    const sf::FloatRect tooltipRect{{rects.panelX, yTop}, {panelWidth, panelHeight}};
    ui::UiPanel{panelBg, accent.full(), accent.thicknessOutline}
        .draw(window, tooltipRect);

    // UiLabel Left-align insets x by +2, so a rect at panelX+paddingX-2
    // lands the text at panelX+paddingX. The label block's height matches
    // the interior so vertical centring lands it at ~yTop+paddingY (the
    // old hand-placed top-left origin).
    const sf::FloatRect labelRect{{rects.panelX + paddingX - 2.0f, yTop},
                                   {panelWidth, panelHeight}};
    // Neutral body text — the cheat tooltip is a chrome help affordance, not
    // a log-level line, so it reads the standard output-text token rather than
    // the success-green reserved for actual Success log entries.
    ui::UiLabel{outputText, textSize, ui::TextAlign::Left}
        .draw(window, labelRect, font, text);
}

void ConsoleOverlay::drawDropdown(sf::RenderWindow& window,
                                     const ConsoleOverlayRects& rects,
                                     const dof::app::Console& console) const {
    const auto& items = console.suggestions();
    if (items.empty()) return;
    const float h = rects.dropdownHeight(static_cast<int>(items.size()));
    if (h <= 0.0f) return;

    // Dropdown container — UiPanel with the frame border at hairline width.
    const sf::FloatRect dropdownRect{{rects.panelX, rects.inputBottom()},
                                      {rects.panelWidth, h}};
    ui::UiPanel{dropdownBg, panelBorder, 1.0f}.draw(window, dropdownRect);

    const int selected = console.suggestionIndex();
    for (int i = 0; i < static_cast<int>(items.size()); ++i) {
        const float rowY = rects.inputBottom() + rects.dropdownRowHeight * static_cast<float>(i);
        if (i == selected) {
            // Full-row highlight fill — a borderless UiPanel.
            const sf::FloatRect rowRect{{rects.panelX, rowY},
                                         {rects.panelWidth, rects.dropdownRowHeight}};
            ui::UiPanel{dropdownRowHighlight, sf::Color::Transparent, 1.0f}
                .draw(window, rowRect);
            // Thin neon bar on the LEFT edge of the highlighted row — a
            // vertical UiDivider gives a clearer hover affordance on top of
            // the full-row fill. Inset by `accent.thicknessOutline` so the
            // bar paints just INSIDE the outline rather than on it.
            ui::UiDivider{accent.full(), 1.0f}
                .drawVertical(window, rects.panelX + accent.thicknessOutline,
                              rowY, rects.dropdownRowHeight);
        }
        // Row label — inset x by 10 so UiLabel's +2 lands at panelX+12
        // (the old hand-placed text x).
        const sf::FloatRect labelRect{{rects.panelX + 10.0f, rowY},
                                       {rects.panelWidth, rects.dropdownRowHeight}};
        ui::UiLabel{dropdownText, textSize, ui::TextAlign::Left}
            .draw(window, labelRect, font, items[static_cast<std::size_t>(i)]);
    }
}

}
