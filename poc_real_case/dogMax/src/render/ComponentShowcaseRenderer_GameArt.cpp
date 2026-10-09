#include "render/ComponentShowcaseRenderer.hpp"
#include "render/ColorTheme.hpp"
#include "render/EnemyShapeCatalog.hpp"
#include "render/UiAccent.hpp"
#include "render/UiState.hpp"
#include "render/WeaponSprite.hpp"
#include "render/ui/PixelSnap.hpp"
#include "entities/Weapon.hpp"
#include "loaders/ConfigLoader.hpp"

#include <SFML/Graphics/CircleShape.hpp>
#include <SFML/Graphics/ConvexShape.hpp>
#include <SFML/Graphics/Text.hpp>

#include <algorithm>
#include <cmath>

namespace dof::render {
namespace {

// Per-theme game-art CONTENT colours: the shape silhouette outline, fill and
// core. The gallery cell chrome (background + border) is NOT here — it is
// collapsed onto the shared single accent and threaded in at draw time, so the
// frame reads uniform while each theme keeps its own vivid silhouette.
struct TabPalette {
    sf::Color outline;
    sf::Color fill;
    sf::Color coreColor;
};

// Classic — cyan/dark-teal (original gallery look)
const TabPalette kClassic{
    {80,  220, 240, 255},
    {18,  45,  58,  220},
    {255, 90,  170, 255}
};
// Cyber — hot-magenta/dark-violet
const TabPalette kCyber{
    {255, 50,  200, 255},
    {30,  10,  50,  220},
    {80,  200, 255, 255}
};
// Void — toxic-green/deep-black
const TabPalette kVoid{
    {40,  255, 100, 255},
    {8,   24,  12,  220},
    {200, 50,  255, 255}
};
// Mech — amber/dark-metal
const TabPalette kMech{
    {255, 150, 30,  255},
    {32,  24,  10,  220},
    {255, 220, 60,  255}
};
// Cosmic — violet/deep-void
const TabPalette kCosmic{
    {180, 60,  255, 255},
    {18,  6,   32,  220},
    {255, 80,  150, 255}
};

struct GridCell { sf::FloatRect cell; sf::FloatRect shape; sf::FloatRect label; };

std::vector<GridCell> layoutGrid(sf::FloatRect content, int count, int cols, float labelH) {
    std::vector<GridCell> out;
    if (count <= 0) return out;
    cols = std::max(1, std::min(cols, count));
    const int rows = (count + cols - 1) / cols;
    const float gap = 10.f, pad = 10.f;
    const float cw = (content.size.x - 2.f * pad - static_cast<float>(cols - 1) * gap)
                     / static_cast<float>(cols);
    const float ch = (content.size.y - 2.f * pad - static_cast<float>(rows - 1) * gap)
                     / static_cast<float>(rows);
    for (int i = 0; i < count; ++i) {
        const int r = i / cols, c = i % cols;
        const sf::FloatRect cell{
            {content.position.x + pad + static_cast<float>(c) * (cw + gap),
             content.position.y + pad + static_cast<float>(r) * (ch + gap)}, {cw, ch}};
        const sf::FloatRect shape{
            {cell.position.x + 8.f, cell.position.y + 8.f},
            {cell.size.x - 16.f, cell.size.y - 16.f - labelH}};
        const sf::FloatRect label{
            {cell.position.x, cell.position.y + cell.size.y - labelH}, {cell.size.x, labelH}};
        out.push_back({cell, shape, label});
    }
    return out;
}

// A gallery cell's chrome is the fill + 4-quad border idiom now single-sourced
// in ui::drawBorderedRect (screen-pixel-snapped so it stays crisp at any window
// size). Background + border are the shared single-accent chrome tokens
// (panel-bg fill, dim-accent border), passed in so the frame reads uniform
// across themes. The demo shape/silhouette is drawn on top by the caller.
void drawCellBg(sf::RenderWindow& window, sf::FloatRect cell,
                sf::Color cellBg, sf::Color cellBorder) {
    ui::drawBorderedRect(window, cell, cellBg, cellBorder, 1.f, true);
}

void drawLabel(sf::RenderWindow& window, const sf::Font& font,
               sf::FloatRect rect, const std::string& text, sf::Color col) {
    sf::Text t(font, text, 11);
    t.setFillColor(col);
    const auto b = t.getLocalBounds();
    t.setPosition(ui::pixelSnap(
        {rect.position.x + (rect.size.x - b.size.x) * 0.5f - b.position.x,
         rect.position.y + (rect.size.y - b.size.y) * 0.5f - b.position.y}));
    window.draw(t);
}

void drawShapeCell(sf::RenderWindow& window, const sf::Font& font,
                   const GridCell& gc, const EnemyShapeSpec& spec,
                   const TabPalette& pal, const std::string& category,
                   sf::Color cellBg, sf::Color cellBorder,
                   std::vector<ShowcaseDemo>& demos) {
    drawCellBg(window, gc.cell, cellBg, cellBorder);
    const float radius = std::min(gc.shape.size.x, gc.shape.size.y) * 0.42f;
    const sf::Vector2f ctr{gc.shape.position.x + gc.shape.size.x * 0.5f,
                           gc.shape.position.y + gc.shape.size.y * 0.5f};
    const auto pts = buildEnemyShapeOutline(spec, radius);
    if (!pts.empty()) {
        sf::ConvexShape poly;
        poly.setPointCount(pts.size());
        for (std::size_t k = 0; k < pts.size(); ++k) poly.setPoint(k, pts[k]);
        poly.setPosition(ctr);
        poly.setFillColor(pal.fill);
        poly.setOutlineThickness(ui::clampedThickness(window, 2.f));
        poly.setOutlineColor(pal.outline);
        window.draw(poly);
    }
    if (spec.coreRadius > 0.f) {
        const float cr = radius * spec.coreRadius;
        sf::CircleShape core(cr);
        core.setOrigin({cr, cr});
        core.setPosition(ctr);
        core.setFillColor(pal.coreColor);
        window.draw(core);
    }
    drawLabel(window, font, gc.label, spec.name, pal.outline);
    demos.push_back({gc.cell, spec.name, category + ": " + spec.name});
}

void drawGalleryGrid(sf::RenderWindow& window, const sf::Font& font,
                     sf::FloatRect content, const std::vector<EnemyShapeSpec>& specs,
                     int startIdx, int count, int cols,
                     const TabPalette& pal, const std::string& category,
                     sf::Color cellBg, sf::Color cellBorder,
                     std::vector<ShowcaseDemo>& demos) {
    const int end    = std::min(startIdx + count, static_cast<int>(specs.size()));
    const int actual = end - startIdx;
    if (actual <= 0) return;
    const auto cells = layoutGrid(content, actual, cols, 20.f);
    for (int i = 0; i < actual; ++i)
        drawShapeCell(window, font, cells[static_cast<std::size_t>(i)],
                      specs[static_cast<std::size_t>(startIdx + i)],
                      pal, category, cellBg, cellBorder, demos);
}

} // namespace

void ComponentShowcaseRenderer::drawWeaponsTab(sf::RenderWindow& window,
                                               sf::FloatRect content,
                                               const sf::Font& font,
                                               UiState& us) {
    const int sub            = std::clamp(us.weaponsSubTab, 0, 2);
    const sf::FloatRect iStrip   = innerTabRect(content);
    const sf::FloatRect iContent = innerContentRect(content);
    tabs_.draw(window, iStrip, font, 11, weaponsInnerLabels(), sub,
               tabs_.hitTest(iStrip, weaponsInnerLabels(), mouseUi_, /*isEnabled=*/true));

    // Shared single-accent cell chrome: panel-bg fill, dim-accent border.
    const UiAccent  accent      = UiAccent::loadFromConfig(config_);
    const sf::Color cellBg      = resolvePanelBackground(config_, "SHOWCASE_PANEL_BG");
    const sf::Color cellBorder  = accent.dim();

    if (sub == 0) {
        const int count = dof::entities::weaponTypeCount();
        const auto cells = layoutGrid(iContent, count, 5, 20.f);
        for (int i = 0; i < count; ++i) {
            const auto type = dof::entities::weaponTypeAtIndex(i);
            drawCellBg(window, cells[static_cast<std::size_t>(i)].cell, cellBg, cellBorder);
            drawWeaponSprite(window, cells[static_cast<std::size_t>(i)].shape, type, config_);
            const std::string name = dof::entities::weaponTypeName(type);
            drawLabel(window, font, cells[static_cast<std::size_t>(i)].label,
                      name, kClassic.outline);
            demosThisFrame_.push_back({cells[static_cast<std::size_t>(i)].cell, name,
                "Classic: " + name + "\nIn-game weapon silhouette."});
        }
    } else if (sub == 1) {
        const int count = dof::entities::weaponTypeCount();
        const auto cells = layoutGrid(iContent, count, 5, 20.f);
        for (int i = 0; i < count; ++i) {
            const auto type = dof::entities::weaponTypeAtIndex(i);
            drawCellBg(window, cells[static_cast<std::size_t>(i)].cell, cellBg, cellBorder);
            drawWeaponSprite(window, cells[static_cast<std::size_t>(i)].shape, type, config_);
            const std::string name = dof::entities::weaponTypeName(type);
            drawLabel(window, font, cells[static_cast<std::size_t>(i)].label,
                      name, kCyber.outline);
            demosThisFrame_.push_back({cells[static_cast<std::size_t>(i)].cell, name,
                "Cyber: " + name});
        }
    } else {
        const int count = dof::entities::weaponTypeCount();
        const auto cells = layoutGrid(iContent, count, 5, 20.f);
        for (int i = 0; i < count; ++i) {
            const auto type = dof::entities::weaponTypeAtIndex(i);
            drawCellBg(window, cells[static_cast<std::size_t>(i)].cell, cellBg, cellBorder);
            drawWeaponSprite(window, cells[static_cast<std::size_t>(i)].shape, type, config_);
            const std::string name = dof::entities::weaponTypeName(type);
            drawLabel(window, font, cells[static_cast<std::size_t>(i)].label,
                      name, kVoid.outline);
            demosThisFrame_.push_back({cells[static_cast<std::size_t>(i)].cell, name,
                "Void: " + name});
        }
    }
}

void ComponentShowcaseRenderer::drawEnemiesTab(sf::RenderWindow& window,
                                               sf::FloatRect content,
                                               const sf::Font& font,
                                               const std::vector<EnemyShapeSpec>& catalog,
                                               UiState& us) {
    const int sub            = std::clamp(us.enemiesSubTab, 0, 2);
    const sf::FloatRect iStrip   = innerTabRect(content);
    const sf::FloatRect iContent = innerContentRect(content);
    tabs_.draw(window, iStrip, font, 11, enemiesInnerLabels(), sub,
               tabs_.hitTest(iStrip, enemiesInnerLabels(), mouseUi_, /*isEnabled=*/true));

    const int t1 = config_.getInt("ENEMY_SHAPE_TAB1_COUNT");
    const int t2 = config_.getInt("ENEMY_SHAPE_TAB2_COUNT");
    const int t3 = config_.getInt("ENEMY_SHAPE_TAB3_COUNT");

    // Shared single-accent cell chrome: panel-bg fill, dim-accent border.
    const UiAccent  accent      = UiAccent::loadFromConfig(config_);
    const sf::Color cellBg      = resolvePanelBackground(config_, "SHOWCASE_PANEL_BG");
    const sf::Color cellBorder  = accent.dim();

    if (sub == 0) {
        drawGalleryGrid(window, font, iContent, catalog,
                        0, t1, 5, kClassic, "Primordial", cellBg, cellBorder, demosThisFrame_);
    } else if (sub == 1) {
        drawGalleryGrid(window, font, iContent, catalog,
                        t1, t2, 5, kMech, "Mech", cellBg, cellBorder, demosThisFrame_);
    } else {
        drawGalleryGrid(window, font, iContent, catalog,
                        t1 + t2, t3, 5, kCosmic, "Cosmic", cellBg, cellBorder, demosThisFrame_);
    }
}
} // namespace dof::render
