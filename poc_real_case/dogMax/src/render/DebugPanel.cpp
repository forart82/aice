#include "render/DebugPanel.hpp"

#include "loaders/ConfigLoader.hpp"
#include "loaders/ShaderLoader.hpp"
#include "render/ColorTheme.hpp"
#include "render/ConfigTab.hpp"
#include "render/EntityInspectorTab.hpp"
#include "render/ItemInspectorTab.hpp"
#include "render/PerformanceTab.hpp"
#include "render/UiAccent.hpp"
#include "render/UiState.hpp"
#include "render/ui/PixelSnap.hpp"
#include "render/ui/UiPanel.hpp"
#include "render/ui/UiLabel.hpp"
#include "render/ui/UiScrollPanel.hpp"
#include "render/ui/UiTab.hpp"
#include "render/ui/UiTextInput.hpp"

#include <array>

namespace dof::render {

namespace {

// Spec §Tabs L2840-2858 (minus Console which lives in `ConsoleOverlay`).
// card-mpl1ldva added Weapons + Dices; card-mpl1zaar added Floor;
// card-mpl9it01 splits Entity into General / Hero / Enemies so each
// concern has its own page.
const std::array<const char*, kDebugPanelTabCount> kTabNames = {
    "General", "Hero", "Enemies", "Weapons", "Dices", "Floor", "Performance", "Config"
};

// Single-accent collapse for the inspector-tab row chrome. Every expand
// context (Hero/Enemies/Item tabs) exposes the same four style fields;
// this drives them all off the two tokens the consumer already holds so
// the tables read as one accent: base row + drawer = panel-bg, alternate
// zebra stripe + row divider = accent-dim.
template <typename ExpandContext>
void applyRowChrome(ExpandContext& expand, sf::Color panelBackground, sf::Color accentDimColor) {
    expand.zebraEvenBg = panelBackground;
    expand.zebraOddBg  = accentDimColor;
    expand.rowDivider  = accentDimColor;
    expand.drawerBg    = panelBackground;
}

}

DebugPanelRects computeDebugPanelRects(sf::Vector2u windowSize,
                                        float widthFrac,
                                        float heightFrac,
                                        float tabStripHeight,
                                        float offsetX,
                                        float offsetY) {
    DebugPanelRects rects;
    const auto w = static_cast<float>(windowSize.x);
    const auto h = static_cast<float>(windowSize.y);
    rects.panelWidth  = w * widthFrac;
    rects.panelHeight = h * heightFrac;
    rects.panelX = offsetX;
    rects.panelY = offsetY;
    rects.tabStripHeight = tabStripHeight;
    // Drag handle (left square) and minimise button (right square) each
    // steal one tab-strip-height square, so the remaining width is
    // shared equally across the tab headers.
    const float availableForTabs = rects.panelWidth - 2.0f * tabStripHeight;
    rects.tabWidth = availableForTabs > 0.0f
        ? availableForTabs / static_cast<float>(kDebugPanelTabCount)
        : 0.0f;
    return rects;
}

DebugPanelRects computeDebugPanelMinimisedRects(sf::Vector2u windowSize,
                                                  float widthFrac,
                                                  float tabStripHeight,
                                                  float offsetX,
                                                  float offsetY) {
    // Minimised height is just the tab strip — the body collapses
    // entirely. Same offset semantics as the expanded rect so the
    // panel does not appear to jump when toggling minimise.
    DebugPanelRects rects;
    const auto w = static_cast<float>(windowSize.x);
    rects.panelWidth  = w * widthFrac;
    rects.panelHeight = tabStripHeight;
    rects.panelX = offsetX;
    rects.panelY = offsetY;
    rects.tabStripHeight = tabStripHeight;
    const float availableForTabs = rects.panelWidth - 2.0f * tabStripHeight;
    rects.tabWidth = availableForTabs > 0.0f
        ? availableForTabs / static_cast<float>(kDebugPanelTabCount)
        : 0.0f;
    return rects;
}

sf::FloatRect computeDebugPanelMinimiseButtonRect(const DebugPanelRects& rects) {
    sf::FloatRect r;
    r.position = sf::Vector2f{rects.panelX + rects.panelWidth - rects.tabStripHeight,
                                rects.panelY};
    r.size = sf::Vector2f{rects.tabStripHeight, rects.tabStripHeight};
    return r;
}

sf::FloatRect computeDebugPanelDragHandleRect(const DebugPanelRects& rects) {
    sf::FloatRect r;
    r.position = sf::Vector2f{rects.panelX, rects.panelY};
    r.size = sf::Vector2f{rects.tabStripHeight, rects.tabStripHeight};
    return r;
}

bool debugPanelMinimiseButtonContains(const DebugPanelRects& rects, sf::Vector2f cursorUi) {
    const auto r = computeDebugPanelMinimiseButtonRect(rects);
    return cursorUi.x >= r.position.x
        && cursorUi.x <  r.position.x + r.size.x
        && cursorUi.y >= r.position.y
        && cursorUi.y <  r.position.y + r.size.y;
}

bool debugPanelDragHandleContains(const DebugPanelRects& rects, sf::Vector2f cursorUi) {
    const auto r = computeDebugPanelDragHandleRect(rects);
    return cursorUi.x >= r.position.x
        && cursorUi.x <  r.position.x + r.size.x
        && cursorUi.y >= r.position.y
        && cursorUi.y <  r.position.y + r.size.y;
}

sf::Vector2f clampDebugPanelOffset(sf::Vector2f desired,
                                    sf::Vector2u uiDesignSize,
                                    float panelWidth,
                                    float panelHeight) {
    const float maxX = static_cast<float>(uiDesignSize.x) - panelWidth;
    const float maxY = static_cast<float>(uiDesignSize.y) - panelHeight;
    sf::Vector2f out = desired;
    if (out.x < 0.0f)        out.x = 0.0f;
    else if (out.x > maxX)   out.x = maxX > 0.0f ? maxX : 0.0f;
    if (out.y < 0.0f)        out.y = 0.0f;
    else if (out.y > maxY)   out.y = maxY > 0.0f ? maxY : 0.0f;
    return out;
}

int clampDebugPanelScroll(int desiredOffset, int totalLines, int visibleLines) {
    // card-mpkwdbzn — clamp into [0, max(0, totalLines - visibleLines)].
    const int safeTotal   = totalLines   > 0 ? totalLines   : 0;
    const int safeVisible = visibleLines > 0 ? visibleLines : 0;
    const int maxOffset   = safeTotal - safeVisible > 0 ? safeTotal - safeVisible : 0;
    if (desiredOffset < 0)         return 0;
    if (desiredOffset > maxOffset) return maxOffset;
    return desiredOffset;
}

int debugPanelTabIndexAt(const DebugPanelRects& rects, sf::Vector2f cursorUi) {
    if (rects.tabWidth <= 0.0f || rects.tabStripHeight <= 0.0f) return -1;
    if (cursorUi.y < rects.panelY || cursorUi.y >= rects.panelY + rects.tabStripHeight) return -1;
    if (debugPanelDragHandleContains(rects, cursorUi)) return -1;
    if (debugPanelMinimiseButtonContains(rects, cursorUi)) return -1;
    const float tabsLeft = rects.panelX + rects.tabStripHeight;
    if (cursorUi.x < tabsLeft) return -1;
    const float localX = cursorUi.x - tabsLeft;
    const int idx = static_cast<int>(localX / rects.tabWidth);
    if (idx < 0 || idx >= kDebugPanelTabCount) return -1;
    return idx;
}

DebugPanel::DebugPanel(const dof::loaders::ConfigLoader& config, const sf::Font& fontRef,
                       const dof::loaders::ShaderLoader* shaders)
    : font(fontRef),
      widthFrac(config.getFloat("DEBUG_PANEL_WIDTH_FRAC")),
      heightFrac(config.getFloat("DEBUG_PANEL_HEIGHT_FRAC")),
      tabStripHeight(static_cast<float>(config.getInt("DEBUG_PANEL_TAB_HEIGHT"))),
      initialOffsetX(static_cast<float>(config.getInt("DEBUG_PANEL_INITIAL_OFFSET_X"))),
      initialOffsetY(static_cast<float>(config.getInt("DEBUG_PANEL_INITIAL_OFFSET_Y"))),
      textSize(static_cast<unsigned>(config.getInt("DEBUG_PANEL_TEXT_SIZE"))),
      panelBg(resolvePanelBackground(config, "DEBUG_PANEL_BG")),
      panelBorder(UiAccent::loadFromConfig(config).full()),
      panelBorderThickness(UiAccent::loadFromConfig(config).thicknessOutline),
      shadersPtr(shaders),
      isGlowEnabled(config.getInt("UI_GLOW_ENABLE") != 0),
      glowSpread(config.getFloat("UI_GLOW_SPREAD")),
      glowLayers(config.getInt("UI_GLOW_LAYERS")),
      glowAlpha(config.getFloat("UI_GLOW_ALPHA")),
      // Single-accent collapse: every chrome surface below reads one of the
      // five tokens (accent / accent-dim / panel-bg / text / text-dim) rather
      // than a per-surface DEBUG_* swatch. tabBg/outputBg/minimiseButtonBg all
      // resolve to the shared panel-bg; tabActive/hover to the accent bands;
      // labels to theme.uiText/uiDim.
      accentDim(UiAccent::loadFromConfig(config).dim()),
      tabBg(resolvePanelBackground(config, "DEBUG_PANEL_BG")),
      tabActive(UiAccent::loadFromConfig(config).dim()),
      tabHover(UiAccent::loadFromConfig(config).full()),
      tabLabel(readRgbPrefixed(config, "THEME_UI_TEXT")),
      tabLabelDim(readRgbPrefixed(config, "THEME_UI_DIM")),
      outputBg(resolvePanelBackground(config, "DEBUG_PANEL_BG")),
      outputText(readRgbPrefixed(config, "THEME_UI_TEXT")),
      minimiseButtonBg(resolvePanelBackground(config, "DEBUG_PANEL_BG")),
      minimiseButtonLabel(readRgbPrefixed(config, "THEME_UI_TEXT")),
      rowExpandAnimDurationSeconds(config.getFloat("DEBUG_PANEL_ROW_EXPAND_ANIM_SECONDS")),
      searchBarHeightPx(config.getFloat("DEBUG_SEARCH_BAR_HEIGHT")),
      speedStripHeightPx(config.getFloat("DEBUG_SPEED_STRIP_HEIGHT")),
      perfGraphGoodFpsThreshold(static_cast<float>(config.getInt("DEBUG_PERF_GRAPH_GOOD_FPS_THRESHOLD"))),
      perfGraphGoodColor(readRgbPrefixed(config, "DEBUG_PERF_GRAPH_GOOD")),
      perfGraphBadColor(readRgbPrefixed(config, "DEBUG_PERF_GRAPH_BAD")) {
}

DebugPanelRects DebugPanel::computeRects(sf::Vector2u windowSize, sf::Vector2f offset) const {
    return computeDebugPanelRects(windowSize, widthFrac, heightFrac, tabStripHeight,
                                   offset.x, offset.y);
}

DebugPanelRects DebugPanel::computeMinimisedRects(sf::Vector2u windowSize, sf::Vector2f offset) const {
    return computeDebugPanelMinimisedRects(windowSize, widthFrac, tabStripHeight,
                                              offset.x, offset.y);
}

void DebugPanel::scrollBy(int lineDelta) {
    bodyScrollOffset += lineDelta;
    if (bodyScrollOffset < 0) bodyScrollOffset = 0;
}

void DebugPanel::scrollToTop() { bodyScrollOffset = 0; }

bool DebugPanel::applyConfigEditKey(std::uint32_t unicode, sf::Keyboard::Key key) {
    if (!configEditActive) return false;
    return ui::UiTextInput::applyKey(configEditText_, configEditCaret_, unicode, key);
}

void DebugPanel::render(sf::RenderWindow& window,
                          const UiState& uiState,
                          const DebugRenderContext& context) {
    if (!uiState.isDebugPanelVisible) return;
    const auto viewSize = window.getView().getSize();
    const auto windowSize = sf::Vector2u{static_cast<unsigned>(viewSize.x),
                                          static_cast<unsigned>(viewSize.y)};
    const bool isMinimised = uiState.isDebugPanelMinimised;
    auto rects = isMinimised
        ? computeMinimisedRects(windowSize, uiState.debugPanelOffset)
        : computeRects(windowSize, uiState.debugPanelOffset);
    if (debugTabHasSearchBar(uiState.debugActiveTabIndex))
        rects.searchBarHeight = searchBarHeightPx;
    if (!isMinimised)
        rects.speedStripHeight = speedStripHeightPx;
    drawBackground(window, rects);
    drawTabStrip(window, rects, uiState.debugActiveTabIndex,
                  uiState.hoveredDebugTabIndex, isMinimised);
    if (isMinimised) return;
    if (debugTabHasSearchBar(uiState.debugActiveTabIndex) && context.configLoader)
        drawDebugSearchField(window, rects, uiState.debugSearchQuery,
                             uiState.isDebugSearchFocused,
                             *context.configLoader, font, textSize);

    const float lineHeight = static_cast<float>(textSize) + 4.0f;
    const int visibleLines = lineHeight > 0.0f
        ? static_cast<int>(rects.bodyHeight() / lineHeight)
        : 0;
    int producedLines = 0;
    // card-mpmzs1j5 — clear stale row bands for inactive tabs.
    if (uiState.debugActiveTabIndex != 2) enemyRowBands.clear();
    if (uiState.debugActiveTabIndex != 1) heroRowBands.clear();
    if (uiState.debugActiveTabIndex != 3) weaponsRowBands.clear();
    if (uiState.debugActiveTabIndex != 4) dicesRowBands.clear();
    if (uiState.debugActiveTabIndex != 5) floorRowBands.clear();
    if (uiState.debugActiveTabIndex != 7) configRowBands.clear();
    switch (uiState.debugActiveTabIndex) {
        case 0:
            if (context.world) {
                producedLines = drawGeneralTab(window, rects, *context.world,
                                                 context.weaponSlotHub,
                                                 font, textSize, outputText,
                                                 bodyScrollOffset,
                                                 panelBg, accentDim);
            } else {
                drawPlaceholderBody(window, rects, "General — <world unavailable>");
            }
            break;
        case 1:
            if (context.world) {
                HeroTabExpandContext expand;
                expand.expandedRowIndex     = uiState.debugHeroExpandedRowIndex;
                expand.animSeconds          = uiState.debugHeroExpandAnimSeconds;
                expand.animDurationSeconds  = rowExpandAnimDurationSeconds;
                applyRowChrome(expand, panelBg, accentDim);
                producedLines = drawHeroTab(window, rects, *context.world,
                                              context.evasionHub,
                                              context.weaponSlotHub,
                                              context.luckHub,
                                              font, textSize, outputText,
                                              bodyScrollOffset,
                                              expand, &heroRowBands);
            } else {
                drawPlaceholderBody(window, rects, "Hero — <world unavailable>");
            }
            break;
        case 2:
            if (context.world) {
                EnemiesTabExpandContext expand;
                expand.expandedRowIndex     = uiState.debugExpandedRowIndex;
                expand.animSeconds          = uiState.debugExpandAnimSeconds;
                expand.animDurationSeconds  = rowExpandAnimDurationSeconds;
                applyRowChrome(expand, panelBg, accentDim);
                producedLines = drawEnemiesTab(window, rects, *context.world,
                                                 font, textSize, outputText,
                                                 bodyScrollOffset,
                                                 expand,
                                                 uiState.debugSearchQuery,
                                                 &enemyRowBands);
            } else {
                enemyRowBands.clear();
                drawPlaceholderBody(window, rects, "Enemies — <world unavailable>");
            }
            break;
        case 3:
            if (context.world) {
                ItemTabExpandContext expand;
                expand.expandedRowIndex    = uiState.debugWeaponsExpandedRowIndex;
                expand.animSeconds         = uiState.debugWeaponsExpandAnimSeconds;
                expand.animDurationSeconds = rowExpandAnimDurationSeconds;
                applyRowChrome(expand, panelBg, accentDim);
                producedLines = drawWeaponsInspectorTab(window, rects, *context.world,
                                                          context.inventoryHub,
                                                          context.weaponSlotHub,
                                                          font, textSize, outputText,
                                                          bodyScrollOffset,
                                                          expand,
                                                          uiState.debugSearchQuery,
                                                          &weaponsRowBands);
            } else {
                weaponsRowBands.clear();
                drawPlaceholderBody(window, rects, "Weapons — <world unavailable>");
            }
            break;
        case 4:
            if (context.world) {
                ItemTabExpandContext expand;
                expand.expandedRowIndex    = uiState.debugDicesExpandedRowIndex;
                expand.animSeconds         = uiState.debugDicesExpandAnimSeconds;
                expand.animDurationSeconds = rowExpandAnimDurationSeconds;
                applyRowChrome(expand, panelBg, accentDim);
                producedLines = drawDicesInspectorTab(window, rects, *context.world,
                                                        context.inventoryHub,
                                                        context.weaponSlotHub,
                                                        font, textSize, outputText,
                                                        bodyScrollOffset,
                                                        expand,
                                                        uiState.debugSearchQuery,
                                                        &dicesRowBands);
            } else {
                dicesRowBands.clear();
                drawPlaceholderBody(window, rects, "Dices — <world unavailable>");
            }
            break;
        case 5:
            if (context.world) {
                ItemTabExpandContext expand;
                expand.expandedRowIndex    = uiState.debugFloorExpandedRowIndex;
                expand.animSeconds         = uiState.debugFloorExpandAnimSeconds;
                expand.animDurationSeconds = rowExpandAnimDurationSeconds;
                applyRowChrome(expand, panelBg, accentDim);
                producedLines = drawFloorItemsInspectorTab(window, rects, *context.world,
                                                             font, textSize, outputText,
                                                             bodyScrollOffset,
                                                             expand,
                                                             uiState.debugSearchQuery,
                                                             &floorRowBands);
            } else {
                floorRowBands.clear();
                drawPlaceholderBody(window, rects, "Floor — <world unavailable>");
            }
            break;
        case 6:
            producedLines = drawPerformanceTab(window, rects,
                                                 context.fpsHistory,
                                                 context.frameTimings,
                                                 context.spatialGridCellCount,
                                                 font, textSize, outputText,
                                                 bodyScrollOffset,
                                                 perfGraphGoodFpsThreshold,
                                                 perfGraphGoodColor,
                                                 perfGraphBadColor,
                                                 panelBg);
            break;
        case 7:
            if (context.configLoader) {
                ConfigTabEditContext edit;
                edit.focusedKey    = configEditActive ? configEditKeyName_ : std::string();
                edit.editBuffer    = configEditText_;
                edit.caret         = configEditCaret_;
                edit.statusMessage = configStatusText;
                edit.mouseUi       = uiState.mouseUi;
                producedLines = drawConfigTab(window, rects, *context.configLoader,
                                                font, textSize, outputText,
                                                bodyScrollOffset,
                                                uiState.debugSearchQuery,
                                                edit, &configRowBands,
                                                &configSaveButtonRect_);
            } else {
                configRowBands.clear();
                drawPlaceholderBody(window, rects, "Config — <loader unavailable>");
            }
            break;
        default: break;
    }
    bodyScrollOffset = clampDebugPanelScroll(bodyScrollOffset, producedLines, visibleLines);
    // Proportional scrollbar on the right edge of the body.
    if (producedLines > 0) {
        const float lh = lineHeight;
        ui::UiScrollPanel::drawScrollbar(
            window,
            {{rects.panelX, rects.bodyY()}, {rects.panelWidth, rects.bodyHeight()}},
            static_cast<float>(bodyScrollOffset) * lh,
            static_cast<float>(producedLines) * lh,
            6.0f,
            accentDim);
    }
    if (!isMinimised)
        drawSpeedStrip(window, rects, uiState.gameTimeScale);
}

void DebugPanel::drawBackground(sf::RenderWindow& window, const DebugPanelRects& rects) const {
    const sf::FloatRect rect{{rects.panelX, rects.panelY},
                             {rects.panelWidth, rects.panelHeight}};
    // Dark-cyberpunk neon: aligned glow frame — crisp accent border on the
    // panel rect edge (matching the debug content) + an outward additive halo,
    // gated on UI_GLOW_ENABLE. Replaces the old chamfered panel.frag shader
    // (inset edge → misaligned). Flat UiPanel is the exact fallback.
    if (isGlowEnabled) {
        ui::drawGlowFrame(window, rect, panelBg, panelBorder, panelBorderThickness,
                          glowLayers, glowSpread, glowAlpha);
    } else {
        ui::UiPanel{panelBg, panelBorder, panelBorderThickness}.draw(window, rect);
    }
}

void DebugPanel::drawTabStrip(sf::RenderWindow& window,
                                const DebugPanelRects& rects,
                                int activeTabIndex,
                                int hoveredTabIndex,
                                bool isMinimised) const {
    drawDragHandle(window, rects);
    const float tabsLeft = rects.panelX + rects.tabStripHeight;
    const sf::FloatRect stripRect{
        {tabsLeft, rects.panelY},
        {rects.panelWidth - 2.0f * rects.tabStripHeight, rects.tabStripHeight}};
    const std::vector<std::string> labels(kTabNames.begin(), kTabNames.end());
    ui::UiTab{tabBg, tabActive, tabHover, panelBorder, tabLabelDim, tabLabel,
              panelBorderThickness}
        .draw(window, stripRect, font, textSize, labels, activeTabIndex, hoveredTabIndex);
    drawMinimiseButton(window, rects, isMinimised);
}

void DebugPanel::drawPlaceholderBody(sf::RenderWindow& window,
                                        const DebugPanelRects& rects,
                                        const std::string& labelStr) const {
    // Flat body background via UiPanel (no chamfer needed for the interior).
    ui::UiPanel{outputBg, sf::Color::Transparent, 0.0f}
        .draw(window, {{rects.panelX, rects.bodyY()},
                       {rects.panelWidth, rects.bodyHeight()}});

    // Label at top-left of the body area.
    const sf::FloatRect textRect{
        {rects.panelX + 16.0f, rects.bodyY() + 16.0f},
        {rects.panelWidth - 32.0f, static_cast<float>(textSize) + 4.0f}};
    ui::UiLabel{outputText, textSize, ui::TextAlign::Left}
        .draw(window, textRect, font, labelStr);
}

}
