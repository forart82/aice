#include "render/ComponentShowcaseRenderer.hpp"
#include "render/ComponentCatalog.hpp"
#include "render/ColorTheme.hpp"
#include "render/ShapeShaders.hpp"
#include "render/UiAccent.hpp"
#include "render/ui/PixelSnap.hpp"
#include <SFML/Graphics/Text.hpp>

#include <algorithm>

namespace dof::render {
namespace {

// Draw the outer frame + title for one demo cell. Returns the inner
// rect (below the title strip) the live demo should be drawn into. The frame
// stroke + title colour are single-accent chrome tokens threaded from the
// caller (dim accent for the subordinate cell frame, primary text for titles).
sf::FloatRect drawCellFrame(sf::RenderWindow& window, sf::FloatRect cell,
                            const sf::Font& font, const std::string& title,
                            sf::Color frameBorder, sf::Color titleColor) {
    // Border-only frame (transparent fill) via the single-sourced 4-quad border
    // idiom, so the live demo shows through. drawBorderedRect returns the
    // screen-snapped rect it drew; reuse it for the title + inner content rect.
    const sf::FloatRect f = ui::drawBorderedRect(
        window, cell, sf::Color::Transparent, frameBorder, 1.f, true);
    sf::Text label(font, title, 12);
    label.setFillColor(titleColor);
    label.setPosition(ui::pixelSnap({f.position.x + 8.f, f.position.y + 6.f}));
    window.draw(label);
    return ui::pixelSnap({{f.position.x + 8.f, f.position.y + 28.f},
                          {f.size.x - 16.f, f.size.y - 36.f}});
}

} // namespace

void ComponentShowcaseRenderer::drawComponentsTab(sf::RenderWindow& window,
                                                  sf::FloatRect content,
                                                  const sf::Font& font) {
    // Data-driven grid: every registered ui/* component gets one cell. Rows
    // grow to fit the entry count so new components appear automatically
    // (no fixed slot ceiling). One ShapeShaders instance serves the
    // UiDiceCell demo; shaders stay null so it draws its fallback path.
    const std::vector<ComponentCatalogEntry>& entries = componentCatalogEntries();
    const int count = static_cast<int>(entries.size());
    if (count == 0) return;

    const int cols = std::max(1, static_cast<int>(demoCols_));
    const int rows = (count + cols - 1) / cols;
    const float cellW = content.size.x / static_cast<float>(cols);
    const float cellH = content.size.y / static_cast<float>(rows);

    // Single-accent chrome tokens, resolved once for the whole grid: every demo
    // cell frame + every demo lambda reads its chrome from this shared set so
    // the gallery collapses onto the electric-blue accent.
    const UiAccent  accent  = UiAccent::loadFromConfig(config_);
    const ColorTheme theme  = buildColorTheme(config_);
    const sf::Color panelBg = resolvePanelBackground(config_, "SHOWCASE_PANEL_BG");

    ShapeShaders shapeShaders;

    for (int i = 0; i < count; ++i) {
        const int col = i % cols;
        const int row = i / cols;
        const sf::FloatRect cellRect{
            {content.position.x + static_cast<float>(col) * cellW + 6.f,
             content.position.y + static_cast<float>(row) * cellH + 6.f},
            {cellW - 12.f, cellH - 12.f}};

        const ComponentCatalogEntry& entry = entries[static_cast<std::size_t>(i)];
        const sf::FloatRect inner = drawCellFrame(window, cellRect, font, entry.name,
                                                  accent.dim(), theme.uiText);
        const ComponentDemoContext ctx{window, inner, font, config_, nullptr, &shapeShaders,
                                       accent.full(), accent.dim(), panelBg,
                                       theme.uiText, theme.uiDim};
        entry.drawDemo(ctx);
        demosThisFrame_.push_back({inner, entry.tooltipTitle, entry.tooltipBody});
    }
}
} // namespace dof::render
