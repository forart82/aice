#include "render/HelpOverlay.hpp"

#include "loaders/ConfigLoader.hpp"
#include "render/ui/UiPanel.hpp"

#include <SFML/Graphics/CircleShape.hpp>
#include <SFML/Graphics/RectangleShape.hpp>
#include <SFML/Graphics/RenderWindow.hpp>
#include <SFML/Graphics/Text.hpp>

#include <algorithm>
#include <cstdint>
#include <fstream>
#include <sstream>

namespace dof::render {

namespace {

std::string stripTrailingWhitespace(std::string s) {
    while (!s.empty() && (s.back() == ' ' || s.back() == '\t' || s.back() == '\r')) s.pop_back();
    return s;
}

bool startsWithExact(const std::string& s, const std::string& prefix) {
    if (s.size() < prefix.size()) return false;
    return std::equal(prefix.begin(), prefix.end(), s.begin());
}

}

std::vector<HelpOverlay::DocLine> parseHelpMarkdown(const std::string& markdownText) {
    std::vector<HelpOverlay::DocLine> out;
    std::stringstream stream(markdownText);
    std::string line;
    while (std::getline(stream, line)) {
        const std::string trimmed = stripTrailingWhitespace(line);
        if (trimmed.empty()) {
            out.push_back({HelpOverlay::LineKind::Spacer, std::string{}});
            continue;
        }
        // Two leading `#` BEFORE one leading `#` so the longer match
        // wins for `## subtitle` (otherwise it would route to H1 with
        // the second `#` left in the body text).
        if (startsWithExact(trimmed, "## ")) {
            out.push_back({HelpOverlay::LineKind::Heading2, trimmed.substr(3)});
            continue;
        }
        if (startsWithExact(trimmed, "# ")) {
            out.push_back({HelpOverlay::LineKind::Heading1, trimmed.substr(2)});
            continue;
        }
        if (trimmed.find(" :: ") != std::string::npos) {
            out.push_back({HelpOverlay::LineKind::Shortcut, trimmed});
            continue;
        }
        out.push_back({HelpOverlay::LineKind::Body, trimmed});
    }
    return out;
}

HelpOverlay::HelpOverlay(const dof::loaders::ConfigLoader& config,
                         const ColorTheme& themeInit,
                         const sf::Font& fontInit)
    : theme(themeInit), font(fontInit) {
    panelBg = resolvePanelBackground(config, "HELP_OVERLAY_BG");
    panelOutline = sf::Color{
        static_cast<std::uint8_t>(config.getInt("HELP_OVERLAY_OUTLINE_R")),
        static_cast<std::uint8_t>(config.getInt("HELP_OVERLAY_OUTLINE_G")),
        static_cast<std::uint8_t>(config.getInt("HELP_OVERLAY_OUTLINE_B"))};
    widthFraction    = config.getFloat("HELP_OVERLAY_WIDTH_FRAC");
    heightFraction   = config.getFloat("HELP_OVERLAY_HEIGHT_FRAC");
    paddingX         = config.getFloat("HELP_OVERLAY_PADDING_X");
    paddingY         = config.getFloat("HELP_OVERLAY_PADDING_Y");
    titleFontSize    = config.getFloat("HELP_OVERLAY_TITLE_FONT_SIZE");
    heading1FontSize = config.getFloat("HELP_OVERLAY_HEADING1_FONT_SIZE");
    heading2FontSize = config.getFloat("HELP_OVERLAY_HEADING2_FONT_SIZE");
    lineFontSize     = config.getFloat("HELP_OVERLAY_LINE_FONT_SIZE");
    lineSpacing      = config.getFloat("HELP_OVERLAY_LINE_SPACING");
    shortcutKeyWidth = config.getFloat("HELP_OVERLAY_SHORTCUT_KEY_WIDTH");
    scrollbarWidth   = config.getFloat("HELP_OVERLAY_SCROLLBAR_WIDTH");
    // Single-accent chrome collapse (Phase B) — headings (text + the
    // section dot) were a distinct HELP_OVERLAY_HEADING lavender; they now
    // read the canonical UI accent like every other framed surface. The
    // heading-vs-body hierarchy survives via the larger heading font + the
    // accent dot, so no dedicated heading hue is needed. Loaded fresh (not
    // from the `accent` member, which is assigned further down) so this stays
    // independent of member-init ordering.
    headingColor = UiAccent::loadFromConfig(config).full();

    // card-mpl9hhw6 v2 T-UIR-help — accent outline + title/status chip
    // vocabulary loaded once so the F1 overlay reads as part of the v2
    // framed surface set (sidebar / inventory / tooltip).
    accent = UiAccent::loadFromConfig(config);
    chip   = ui::UiChip::loadFromConfig(config);

    // Load the canonical help text. The working directory is the
    // build root at runtime (`build/`), and `assets/help.md` is
    // copied there by the CMake post-build step alongside the
    // shaders, so a relative read against `assets/help.md` resolves
    // in both the live game and a headless self-test run.
    loadHelpMarkdown("assets/help.md");
}

void HelpOverlay::loadHelpMarkdown(const std::string& path) {
    std::ifstream stream(path);
    if (!stream.is_open()) {
        // Fall back to a single body line that tells the player why
        // the panel is empty so the regression is visible rather than
        // silent. The full message is short on purpose — a long
        // failure mode is itself a regression signal.
        docLineStorage = {{LineKind::Body,
                            std::string{"help.md missing — check assets directory"}}};
        return;
    }
    std::stringstream sink;
    sink << stream.rdbuf();
    docLineStorage = parseHelpMarkdown(sink.str());
}

void HelpOverlay::scrollBy(int delta) {
    scrollOffsetLines = std::max(0, scrollOffsetLines + delta);
}

const std::vector<HelpOverlay::DocLine>& HelpOverlay::docLines() const { return docLineStorage; }

void HelpOverlay::render(sf::RenderWindow& window, sf::Vector2u windowSize) const {
    const float winW = static_cast<float>(windowSize.x);
    const float winH = static_cast<float>(windowSize.y);
    const float panelW = winW * widthFraction;
    const float panelH = winH * heightFraction;
    const float originX = (winW - panelW) * 0.5f;
    const float originY = (winH - panelH) * 0.5f;

    // card-mpl9hhw6 v2 T-UIR-help — chamfered chrome panel + title
    // chip (top-left) + status chip (top-right) replace the v1 flat
    // panel rect + drawPanelTitleBand. The chips sit ON the chamfered
    // outline so the F1 overlay matches the rest of the v2 framed
    // surfaces (sidebar / inventory / tooltip).
    const sf::FloatRect panelRect{{originX, originY}, {panelW, panelH}};
    ui::UiPanel panel;
    panel.background      = panelBg;
    panel.border          = accent.full();
    panel.borderThickness = accent.thicknessOutline;
    panel.draw(window, panelRect);

    const float titleChipW  = 96.0f;
    const float statusChipW = 132.0f;
    ui::UiChip titleChip = chip;
    titleChip.anchor = ui::UiChip::Anchor::TopLeft;
    titleChip.draw(window, panelRect, font, "HELP", titleChipW);
    ui::UiChip statusChip = chip;
    statusChip.anchor = ui::UiChip::Anchor::TopRight;
    // Status dot reads the accent (chrome) rather than a neutral text swatch,
    // matching the single-accent chip vocabulary of the other overlays.
    statusChip.draw(window, panelRect, font, "HELP KEY", statusChipW, accent.full());

    // Body starts below the chip overhang (chip overhangs by half its
    // height above the panel + sits flush with the top edge, so the
    // safe content origin is paddingY beneath the panel top).
    const float bodyTopY    = originY + paddingY + chip.height * 0.5f;
    const float bodyBottomY = originY + panelH - paddingY;

    // Clamp the scroll offset to the last full page so the panel
    // never displays an empty area below the final line.
    const int totalLines = static_cast<int>(docLineStorage.size());
    const auto lineAdvance = [&](LineKind kind) {
        switch (kind) {
            case LineKind::Heading1: return heading1FontSize + lineSpacing;
            case LineKind::Heading2: return heading2FontSize + lineSpacing;
            case LineKind::Shortcut:
            case LineKind::Body: return lineFontSize + lineSpacing;
            case LineKind::Spacer: return lineFontSize * 0.5f + lineSpacing;
        }
        return lineFontSize + lineSpacing;
    };
    const float availableBodyHeight = bodyBottomY - bodyTopY;
    float lastPageHeight = 0.0f;
    int maxOffset = totalLines;
    while (maxOffset > 0) {
        const float nextHeight = lineAdvance(docLineStorage[maxOffset - 1].kind);
        if (lastPageHeight + nextHeight > availableBodyHeight && maxOffset < totalLines) break;
        lastPageHeight += nextHeight;
        --maxOffset;
    }
    maxOffset = std::max(0, maxOffset);
    if (scrollOffsetLines > maxOffset) scrollOffsetLines = maxOffset;

    float cursorY = bodyTopY;
    int lastVisibleIndex = scrollOffsetLines - 1;
    for (int index = scrollOffsetLines; index < totalLines; ++index) {
        const auto& docLine = docLineStorage[index];
        float fontSize = lineFontSize;
        sf::Color color = theme.uiDim;
        switch (docLine.kind) {
            case LineKind::Heading1:
                fontSize = heading1FontSize;
                color    = headingColor;
                break;
            case LineKind::Heading2:
                fontSize = heading2FontSize;
                color    = headingColor;
                break;
            case LineKind::Shortcut:
                fontSize = lineFontSize;
                color    = theme.uiText;
                break;
            case LineKind::Body:
                fontSize = lineFontSize;
                color    = theme.uiText;
                break;
            case LineKind::Spacer:
                cursorY += lineFontSize * 0.5f + lineSpacing;
                continue;
        }
        if (cursorY + fontSize > bodyBottomY) break;
        // card-mpl9hhw6 v2 T-UIR-help — coloured dot prefix on every
        // heading line, sitting just left of the body padding so the
        // doc reads as a structured outline (gcmenu.png reference:
        // section headers carry an accent indicator).
        if (docLine.kind == LineKind::Heading1 || docLine.kind == LineKind::Heading2) {
            const float dotRadius = 3.0f;
            sf::CircleShape dot(dotRadius, 12);
            dot.setOrigin({dotRadius, dotRadius});
            dot.setPosition({originX + paddingX - 8.0f,
                             cursorY + fontSize * 0.5f});
            dot.setFillColor(headingColor);
            window.draw(dot);
        }
        if (docLine.kind == LineKind::Shortcut) {
            const std::size_t separator = docLine.text.find(" :: ");
            const std::string keys = docLine.text.substr(0, separator);
            const std::string action = docLine.text.substr(separator + 4);
            const float rowHeight = lineFontSize + lineSpacing * 0.5f;
            sf::Color keyBackground = accent.dim();
            keyBackground.a = static_cast<std::uint8_t>(keyBackground.a / 3);
            sf::RectangleShape keyPanel({shortcutKeyWidth, rowHeight});
            keyPanel.setPosition({originX + paddingX, cursorY});
            keyPanel.setFillColor(keyBackground);
            keyPanel.setOutlineColor(accent.dim());
            keyPanel.setOutlineThickness(accent.thicknessHairline);
            window.draw(keyPanel);

            sf::Text keyText(font, keys, static_cast<unsigned>(lineFontSize));
            keyText.setPosition({originX + paddingX + lineSpacing, cursorY});
            keyText.setFillColor(headingColor);
            window.draw(keyText);

            sf::Text actionText(font, action, static_cast<unsigned>(lineFontSize));
            actionText.setPosition({originX + paddingX + shortcutKeyWidth + paddingX,
                                    cursorY});
            actionText.setFillColor(color);
            window.draw(actionText);
        } else {
            sf::Text textLine(font, docLine.text, static_cast<unsigned>(fontSize));
            textLine.setPosition({originX + paddingX, cursorY});
            textLine.setFillColor(color);
            window.draw(textLine);
        }
        cursorY += fontSize + lineSpacing;
        lastVisibleIndex = index;
    }

    if (totalLines > 0 && lastVisibleIndex - scrollOffsetLines + 1 < totalLines) {
        const float trackWidth = scrollbarWidth;
        const float trackHeight = bodyBottomY - bodyTopY;
        const int visibleLines = std::max(1, lastVisibleIndex - scrollOffsetLines + 1);
        const float thumbHeight = trackHeight
            * static_cast<float>(visibleLines) / static_cast<float>(totalLines);
        const float scrollProgress = maxOffset > 0
            ? static_cast<float>(scrollOffsetLines) / static_cast<float>(maxOffset)
            : 0.0f;
        const float trackX = originX + panelW - paddingX * 0.5f;
        sf::RectangleShape track({trackWidth, trackHeight});
        track.setPosition({trackX, bodyTopY});
        track.setFillColor(accent.dim());
        window.draw(track);
        sf::RectangleShape thumb({trackWidth, thumbHeight});
        thumb.setPosition({trackX, bodyTopY + (trackHeight - thumbHeight) * scrollProgress});
        thumb.setFillColor(accent.full());
        window.draw(thumb);
    }
}

}
