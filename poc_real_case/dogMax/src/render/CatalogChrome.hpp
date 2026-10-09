#pragma once

#include "render/ui/UiCell.hpp"
#include "render/ui/UiPanel.hpp"
#include "render/ui/UiTab.hpp"

#include <SFML/Graphics/Color.hpp>
#include <SFML/Graphics/Font.hpp>
#include <SFML/Graphics/Rect.hpp>

#include <string>
#include <vector>

namespace dof::loaders { class ConfigLoader; }
namespace sf           { class RenderWindow; }

namespace dof::render {

// Shared window chrome for the two grid-catalog windows — EffectsCatalogWindow
// and GroupedEffectsCatalog. They are the same shape (a bordered panel with an
// accent title, a 3-way size-tab strip, and a scrollable grid of bordered
// cells) and differ only in their data and their per-cell preview. This owns
// everything they share: the ui:: primitives (UiPanel frame, UiTab strip,
// UiCell backgrounds), the layout math (tab-strip rect, grid clip rect, content
// height, per-cell rects), and the scrollbar. Each window keeps its own grid
// loop and calls drawCell()/drawCellLabel() around its own preview draw.
//
// The frame/tab border + the title accent track the shared UiAccent theme (so
// the twins read as the same set as every other window); genuinely
// catalog-specific sizes and fills stay in the EFX_CATALOG_* keys.
struct CatalogChrome {
    // ui:: primitives, styled once from config.
    ui::UiPanel panel;   // frame: bg fill + accent border
    ui::UiTab   tab;      // 3-way size-tab strip
    ui::UiCell  cell;     // grid cell background + dim border

    // Colours the ui:: primitives don't own.
    sf::Color titleColor;      // accent-coloured heading
    sf::Color scrollbarColor;  // scrollbar strip
    sf::Color labelColor;      // cell-name label text

    // Layout metrics (catalog-specific sizes; from EFX_CATALOG_* keys).
    float    padding{16.f};
    float    tabHeight{38.f};
    float    cellWidth{190.f};
    float    cellHeight{190.f};
    float    cellGap{10.f};
    float    previewSize{130.f};
    int      gridCols{5};
    float    scrollbarWidth{8.f};
    unsigned titleFontSize{16};
    unsigned labelFontSize{11};

    static CatalogChrome loadFromConfig(const dof::loaders::ConfigLoader& cfg);

    // ── Layout ──────────────────────────────────────────────────────────────
    float         titleBandHeight() const;
    float         contentHeight(int entryCount) const;
    sf::FloatRect tabStripRect(sf::FloatRect panelRect) const;
    sf::FloatRect gridClipRect(sf::FloatRect panelRect) const;
    sf::FloatRect cellRect(sf::FloatRect clip, int index) const;
    sf::Vector2f  previewOrigin(sf::FloatRect cellRect) const;

    // ── Draw ────────────────────────────────────────────────────────────────
    void drawPanel(sf::RenderWindow& window, sf::FloatRect panelRect) const;
    void drawTitle(sf::RenderWindow& window, const sf::Font& font,
                   sf::FloatRect panelRect, const std::string& title) const;
    void drawTabs(sf::RenderWindow& window, const sf::Font& font,
                  sf::FloatRect panelRect, const std::vector<std::string>& labels,
                  int activeIndex) const;
    // Which tab (0..N-1) the point lands on, or -1. Uses the same strip rect the
    // tabs are drawn in, so clicks map exactly to what is on screen.
    int  tabAt(sf::FloatRect panelRect, const std::vector<std::string>& labels,
               sf::Vector2f uiPoint) const;
    void drawCell(sf::RenderWindow& window, sf::FloatRect cellRect) const;
    void drawCellLabel(sf::RenderWindow& window, const sf::Font& font,
                       sf::FloatRect cellRect, const std::string& name) const;
    void drawScrollbar(sf::RenderWindow& window, sf::FloatRect clip,
                       float scrollOffset, float contentH) const;
};

} // namespace dof::render
