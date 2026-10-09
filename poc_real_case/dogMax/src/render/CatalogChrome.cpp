#include "render/CatalogChrome.hpp"

#include "loaders/ConfigLoader.hpp"
#include "render/ColorTheme.hpp"
#include "render/UiAccent.hpp"
#include "render/ui/UiScrollPanel.hpp"

#include <SFML/Graphics/RenderWindow.hpp>
#include <SFML/Graphics/Text.hpp>

#include <algorithm>

namespace dof::render {

CatalogChrome CatalogChrome::loadFromConfig(const dof::loaders::ConfigLoader& cfg) {
    const UiAccent   accent = UiAccent::loadFromConfig(cfg);
    const ColorTheme theme  = buildColorTheme(cfg);
    // Single shared panel-body swatch — every chrome fill collapses onto it so
    // the catalog reads as the same set as every other window.
    const sf::Color  panelBg = resolvePanelBackground(cfg, "EFX_CATALOG_BG");

    CatalogChrome c;

    // Frame: shared panel-bg fill, shared-accent border. isPixelSnapped
    // stays true — this is screen-space chrome, so the border must stay crisp.
    c.panel.background      = panelBg;
    c.panel.border          = accent.full();
    c.panel.borderThickness = accent.thicknessOutline;

    // Tab strip: collapsed onto the single accent. Active tab is dim accent,
    // inactive is the panel-bg swatch; active text is the theme text colour,
    // inactive is the muted text colour. No hover state is tracked for these
    // tabs, so bgHover mirrors bgActive (never shown).
    c.tab.bgInactive     = panelBg;
    c.tab.bgActive       = accent.dim();
    c.tab.bgHover        = c.tab.bgActive;
    c.tab.border         = accent.full();
    c.tab.textInactive   = theme.uiDim;
    c.tab.textActive     = theme.uiText;
    c.tab.borderThickness = accent.thicknessOutline;

    // Grid cells: shared panel-bg fill, dim-accent resting stroke, full-accent
    // hover stroke (borderHover promotes to the loud accent on hover).
    c.cell.bgEmpty        = panelBg;
    c.cell.bgOccupied     = panelBg;
    c.cell.border         = accent.dim();
    c.cell.borderHover    = accent.full();
    c.cell.borderThickness = accent.thicknessHairline;

    c.titleColor     = accent.full();
    c.scrollbarColor = accent.full();
    c.labelColor     = theme.uiText;

    c.padding        = cfg.getFloat("EFX_CATALOG_PADDING");
    c.tabHeight      = cfg.getFloat("EFX_CATALOG_TAB_H");
    c.cellWidth      = cfg.getFloat("EFX_CATALOG_CELL_W");
    c.cellHeight     = cfg.getFloat("EFX_CATALOG_CELL_H");
    c.cellGap        = cfg.getFloat("EFX_CATALOG_CELL_GAP");
    c.previewSize    = cfg.getFloat("EFX_CATALOG_PREVIEW_SIZE");
    c.gridCols       = std::max(1, cfg.getInt("EFX_CATALOG_GRID_COLS"));
    c.scrollbarWidth = cfg.getFloat("EFX_CATALOG_SCROLLBAR_W");
    c.titleFontSize  = static_cast<unsigned>(cfg.getFloat("EFX_CATALOG_TITLE_FONT_SIZE"));
    c.labelFontSize  = static_cast<unsigned>(cfg.getFloat("EFX_CATALOG_LABEL_FONT_SIZE"));
    return c;
}

// ── Layout ───────────────────────────────────────────────────────────────────

float CatalogChrome::titleBandHeight() const {
    return static_cast<float>(titleFontSize) + 14.f;
}

float CatalogChrome::contentHeight(int entryCount) const {
    if (entryCount <= 0) return 0.f;
    const int rows = (entryCount + gridCols - 1) / gridCols;
    return static_cast<float>(rows) * cellHeight
         + static_cast<float>(rows - 1) * cellGap;
}

sf::FloatRect CatalogChrome::tabStripRect(sf::FloatRect panelRect) const {
    return {{panelRect.position.x + padding,
             panelRect.position.y + padding + titleBandHeight()},
            {panelRect.size.x - 2.f * padding, tabHeight}};
}

sf::FloatRect CatalogChrome::gridClipRect(sf::FloatRect panelRect) const {
    // Grid sits below the tab strip (separated by one padding gap) and above the
    // panel's bottom padding; the scrollbar column is reserved on the right.
    const float top  = tabStripRect(panelRect).position.y + tabHeight + padding;
    const float left = panelRect.position.x + padding;
    const float w    = panelRect.size.x - 2.f * padding - scrollbarWidth - 4.f;
    const float h    = (panelRect.position.y + panelRect.size.y - padding) - top;
    return {{left, top}, {w, h}};
}

sf::FloatRect CatalogChrome::cellRect(sf::FloatRect clip, int index) const {
    const int row = index / gridCols;
    const int col = index % gridCols;
    return {{clip.position.x + static_cast<float>(col) * (cellWidth + cellGap),
             clip.position.y + static_cast<float>(row) * (cellHeight + cellGap)},
            {cellWidth, cellHeight}};
}

sf::Vector2f CatalogChrome::previewOrigin(sf::FloatRect cell) const {
    const float offX = (cellWidth - previewSize) * 0.5f;
    const float offY = (cellHeight - previewSize - static_cast<float>(labelFontSize) - 10.f) * 0.5f;
    return {cell.position.x + offX, cell.position.y + offY};
}

// ── Draw ─────────────────────────────────────────────────────────────────────

void CatalogChrome::drawPanel(sf::RenderWindow& window, sf::FloatRect panelRect) const {
    panel.draw(window, panelRect);
}

void CatalogChrome::drawTitle(sf::RenderWindow& window, const sf::Font& font,
                              sf::FloatRect panelRect, const std::string& title) const {
    sf::Text txt{font, title, titleFontSize};
    txt.setFillColor(titleColor);
    txt.setPosition({panelRect.position.x + padding, panelRect.position.y + padding});
    window.draw(txt);
}

void CatalogChrome::drawTabs(sf::RenderWindow& window, const sf::Font& font,
                             sf::FloatRect panelRect, const std::vector<std::string>& labels,
                             int activeIndex) const {
    tab.draw(window, tabStripRect(panelRect), font, labelFontSize, labels, activeIndex, -1);
}

int CatalogChrome::tabAt(sf::FloatRect panelRect, const std::vector<std::string>& labels,
                         sf::Vector2f uiPoint) const {
    // Catalog tab strips are always live — the chrome has no disabled mode —
    // so enablement is a literal true, matching drawTabs()' default.
    return tab.hitTest(tabStripRect(panelRect), labels, uiPoint, /*isEnabled=*/true);
}

void CatalogChrome::drawCell(sf::RenderWindow& window, sf::FloatRect rect) const {
    cell.draw(window, rect, /*hasContent=*/true, /*isHovered=*/false);
}

void CatalogChrome::drawCellLabel(sf::RenderWindow& window, const sf::Font& font,
                                  sf::FloatRect rect, const std::string& name) const {
    sf::Text lbl{font, name, labelFontSize};
    lbl.setFillColor(labelColor);
    const auto lb = lbl.getLocalBounds();
    lbl.setPosition({rect.position.x + (cellWidth - lb.size.x) * 0.5f - lb.position.x,
                     rect.position.y + cellHeight - lb.size.y - lb.position.y - 6.f});
    window.draw(lbl);
}

void CatalogChrome::drawScrollbar(sf::RenderWindow& window, sf::FloatRect clip,
                                  float scrollOffset, float contentH) const {
    ui::UiScrollPanel::drawScrollbar(window, clip, scrollOffset, contentH,
                                     scrollbarWidth, scrollbarColor);
}

} // namespace dof::render
