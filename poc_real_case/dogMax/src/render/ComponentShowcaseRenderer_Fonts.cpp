#include "render/ComponentShowcaseRenderer.hpp"
#include "render/ColorTheme.hpp"
#include "render/UiAccent.hpp"
#include "render/UiState.hpp"
#include "render/ui/PixelSnap.hpp"
#include "render/ui/UiCell.hpp"
#include "render/ui/UiPanel.hpp"
#include "render/ui/UiScrollPanel.hpp"
#include <SFML/Graphics/RectangleShape.hpp>
#include <SFML/Graphics/Text.hpp>

namespace dof::render {
namespace {
// The font sample glyphs demonstrate each typeface, so their colour is CONTENT
// (a near-white ink) and is kept as a literal — it is not chrome.
const sf::Color kSampleColor {215, 215, 225, 255};
const char* kSample = "The quick brown fox  0123456789  !@#$%";

constexpr float kListRatio = 0.58f; // left column as fraction of content width
constexpr float kPanelGap  = 10.f;
constexpr float kUsageRowH = 22.f;
constexpr float kCheckSize = 11.f;

// Every chrome colour on the Fonts tab collapses onto the shared single accent
// (electric blue) + panel-bg + text tokens. Resolved once from config per draw.
struct FontsChrome {
    sf::Color separator;   // row divider hairline  -> dim accent
    sf::Color name;        // font-name label       -> primary text
    sf::Color scrollbar;   // scrollbar strip       -> accent
    sf::Color selectedRow; // selected-row wash     -> dim accent
    sf::Color checkOn;     // checkbox lit / active  -> accent
    sf::Color checkOff;    // checkbox unlit fill    -> panel-bg
    sf::Color checkBorder; // checkbox stroke        -> dim accent
    sf::Color panelBorder; // usage-panel frame      -> accent
    sf::Color usageLabel;  // usage label text       -> primary text
    sf::Color panelHeader; // selected-font header   -> accent
    sf::Color prompt;      // empty-state prompt     -> muted text
};

FontsChrome buildFontsChrome(const dof::loaders::ConfigLoader& cfg) {
    const UiAccent   accent  = UiAccent::loadFromConfig(cfg);
    const ColorTheme theme   = buildColorTheme(cfg);
    const sf::Color  panelBg = resolvePanelBackground(cfg, "SHOWCASE_PANEL_BG");
    return {accent.dim(), theme.uiText, accent.full(), accent.dim(), accent.full(),
            panelBg, accent.dim(), accent.full(), theme.uiText, accent.full(),
            theme.uiDim};
}

// Compute left-column rect from content area.
sf::FloatRect listColumn(sf::FloatRect content) {
    const float w = content.size.x * kListRatio - kPanelGap * 0.5f;
    return {content.position, {w, content.size.y}};
}

// Compute right-panel rect from content area.
sf::FloatRect rightPanel(sf::FloatRect content) {
    const float lw = content.size.x * kListRatio - kPanelGap * 0.5f;
    return {{content.position.x + lw + kPanelGap, content.position.y},
            {content.size.x - lw - kPanelGap, content.size.y}};
}

void drawUsagePanel(sf::RenderWindow& window, sf::FloatRect rect,
                    const sf::Font& font, const std::string& fontName,
                    std::uint32_t usageMask, const FontsChrome& chrome) {
    // The usage panel background is the showcased UiPanel primitive.
    const ui::UiPanel usagePanel{chrome.checkOff, chrome.panelBorder, 1.f, true};
    usagePanel.draw(window, rect);

    float y = rect.position.y + 10.f;
    const float x = rect.position.x + 10.f;

    sf::Text header(font, fontName, 10);
    header.setFillColor(chrome.panelHeader);
    header.setPosition(ui::pixelSnap({x, y}));
    window.draw(header);
    y += 16.f;

    sf::Text sub(font, "Where used:", 9);
    sub.setFillColor(chrome.usageLabel);
    sub.setPosition(ui::pixelSnap({x, y}));
    window.draw(sub);
    y += 18.f;

    const auto& labels = ComponentShowcaseRenderer::fontUsageLabels();
    // A usage checkbox is a UiCell: "occupied" == this game context is tagged.
    const ui::UiCell checkCell{chrome.checkOff, chrome.checkOn,
                               chrome.checkBorder, chrome.checkOn, 1.f};
    for (int i = 0; i < static_cast<int>(labels.size()); ++i) {
        const bool on = (usageMask >> i) & 1u;

        checkCell.draw(window,
            sf::FloatRect{{x, y + (kUsageRowH - kCheckSize) * 0.5f},
                          {kCheckSize, kCheckSize}}, on, false);

        sf::Text label(font, labels[i], 10);
        label.setFillColor(on ? chrome.checkOn : chrome.usageLabel);
        label.setPosition(ui::pixelSnap({x + kCheckSize + 6.f, y + 2.f}));
        window.draw(label);

        y += kUsageRowH;
    }
}
} // namespace

// ─────────────────────────────────────────────────────────────────────────────

const std::vector<std::string>& ComponentShowcaseRenderer::fontUsageLabels() {
    static const std::vector<std::string> kLabels{
        "HUD",
        "Damage Text",
        "XP Floats",
        "Inventory",
        "Tooltip",
        "Debug Panel",
        "Default UI",
    };
    return kLabels;
}

// Scrollable font list (left) + usage multi-select panel (right).
// Click a row to select; right panel shows checkboxes for each game context.
// Click the same row again to deselect (toggle).
void ComponentShowcaseRenderer::drawFontsTab(sf::RenderWindow& window,
                                             sf::FloatRect content,
                                             const sf::Font& font,
                                             const GalleryContext& ctx) {
    UiState& us = *ctx.uiState;
    const FontsChrome chrome = buildFontsChrome(config_);

    if (showcaseFonts_.empty()) {
        sf::Text msg(font, "No fonts found in assets/fonts/showcase/", 14);
        msg.setFillColor(kSampleColor);
        msg.setPosition(ui::pixelSnap({content.position.x + 16.f, content.position.y + 16.f}));
        window.draw(msg);
        return;
    }

    const int n = static_cast<int>(showcaseFonts_.size());
    if (static_cast<int>(us.galleryFontUsageMasks.size()) < n)
        us.galleryFontUsageMasks.resize(n, 0u);

    const sf::FloatRect lRect = listColumn(content);
    const sf::FloatRect rRect = rightPanel(content);

    // ── scrollable font list ─────────────────────────────────────────────────
    const float availW   = lRect.size.x - 12.f;
    const float contentH = static_cast<float>(n) * fontRowH_ + 16.f;
    float& scroll = us.galleryFontsScroll;
    scroll = ui::UiScrollPanel::clampOffset(scroll, contentH, lRect.size.y);

    const sf::View saved = window.getView();
    ui::UiScrollPanel::applyClipView(window, lRect, *ctx.uiView, scroll);

    float y = lRect.position.y + 8.f;
    for (int i = 0; i < n; ++i) {
        const auto& entry = showcaseFonts_[i];
        const bool selected = (us.galleryFontClickedIndex == i);

        if (selected) {
            sf::RectangleShape hl;
            hl.setPosition(ui::pixelSnap({lRect.position.x, y}));
            hl.setSize({availW, fontRowH_ - 1.f});
            hl.setFillColor(chrome.selectedRow);
            window.draw(hl);
        }

        sf::RectangleShape sep;
        sep.setPosition(ui::pixelSnap({lRect.position.x + 12.f, y}));
        sep.setSize({availW - 12.f, 1.f});
        sep.setFillColor(chrome.separator);
        window.draw(sep);

        sf::Text name(font, entry.name, 9);
        name.setFillColor(selected ? chrome.checkOn : chrome.name);
        name.setPosition(ui::pixelSnap({lRect.position.x + 12.f, y + 4.f}));
        window.draw(name);

        sf::Text sample(*entry.font, kSample, 13);
        sample.setFillColor(kSampleColor);
        const sf::FloatRect bounds = sample.getLocalBounds();
        const float sampleW    = bounds.position.x + bounds.size.x;
        const float maxSampleW = availW - 150.f;
        // maxSampleW > 0 guard: at a very narrow window it goes negative, which
        // would apply a negative (mirrored) scale instead of shrinking to fit.
        if (sampleW > maxSampleW && sampleW > 0.f && maxSampleW > 0.f)
            sample.setScale({maxSampleW / sampleW, 1.f});
        sample.setPosition(ui::pixelSnap({lRect.position.x + 162.f, y + 4.f}));
        window.draw(sample);

        y += fontRowH_;
    }

    window.setView(saved);
    ui::UiScrollPanel::drawScrollbar(window, lRect, scroll, contentH, 8.f, chrome.scrollbar);

    // ── right panel ──────────────────────────────────────────────────────────
    const int sel = us.galleryFontClickedIndex;
    if (sel >= 0 && sel < n) {
        drawUsagePanel(window, rRect, font,
                       showcaseFonts_[sel].name,
                       us.galleryFontUsageMasks[sel], chrome);
    } else {
        // Empty-state prompt panel — the showcased UiPanel primitive.
        const ui::UiPanel promptPanel{chrome.checkOff, chrome.panelBorder, 1.f, true};
        promptPanel.draw(window, rRect);

        sf::Text prompt(font, "Click a font\nto tag usage", 10);
        prompt.setFillColor(chrome.prompt);
        prompt.setPosition(ui::pixelSnap(
            {rRect.position.x + 10.f, rRect.position.y + 10.f}));
        window.draw(prompt);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Hit-test helpers called by ComponentShowcaseRenderer::handleClick.

int ComponentShowcaseRenderer::hitTestFontRow(sf::FloatRect content,
                                              float scroll,
                                              sf::Vector2f uiPoint) const {
    const sf::FloatRect lr = listColumn(content);
    if (!lr.contains(uiPoint)) return -1;
    const float rel = uiPoint.y - (lr.position.y + 8.f) + scroll;
    if (rel < 0.f) return -1;
    const int idx = static_cast<int>(rel / fontRowH_);
    if (idx < 0 || idx >= static_cast<int>(showcaseFonts_.size())) return -1;
    return idx;
}

int ComponentShowcaseRenderer::hitTestFontUsage(sf::FloatRect content,
                                                sf::Vector2f uiPoint) const {
    const sf::FloatRect rr = rightPanel(content);
    if (!rr.contains(uiPoint)) return -1;
    // checkboxes start after: top-pad(10) + header(16) + "where used"(18) = 44px
    const float checkY0 = rr.position.y + 44.f;
    const float rel     = uiPoint.y - checkY0;
    if (rel < 0.f) return -1;
    const int slot  = static_cast<int>(rel / kUsageRowH);
    const int count = static_cast<int>(fontUsageLabels().size());
    if (slot < 0 || slot >= count) return -1;
    return slot;
}
} // namespace dof::render
