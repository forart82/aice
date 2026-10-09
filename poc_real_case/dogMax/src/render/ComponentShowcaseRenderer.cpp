#include "render/ComponentShowcaseRenderer.hpp"
#include "render/ColorTheme.hpp"
#include "render/UiAccent.hpp"
#include "render/EnemyShapeCatalog.hpp"
#include "render/EffectsCatalogWindow.hpp"
#include "render/GroupedEffectsCatalog.hpp"
#include "render/UiState.hpp"
#include "loaders/ConfigLoader.hpp"
#include "render/ui/PixelSnap.hpp"
#include <SFML/Graphics/RectangleShape.hpp>
#include <SFML/Graphics/RenderWindow.hpp>
#include <algorithm>
#include <cstdio>
#include <filesystem>
#include <iostream>
#include <stdexcept>

namespace dof::render {

const std::vector<std::string>& ComponentShowcaseRenderer::categoryLabels() {
    static const std::vector<std::string> labels{"Game Art", "UI Kit", "Grouped FX", "Icons"};
    return labels;
}
const std::vector<std::string>& ComponentShowcaseRenderer::subTabLabels(int category) {
    static const std::vector<std::string> gameArt{"Weapons", "Enemies", "Effects"};
    static const std::vector<std::string> uiKit{"Components", "Fonts"};
    static const std::vector<std::string> grouped{"200px (100)", "500px (100)", "1000px (100)"};
    static const std::vector<std::string> icons{"Utility"};
    if (category == 0) return gameArt;
    if (category == 1) return uiKit;
    if (category == 2) return grouped;
    return icons;
}
const std::vector<std::string>& ComponentShowcaseRenderer::weaponsInnerLabels() {
    static const std::vector<std::string> labels{"Classic", "Cyber", "Void"};
    return labels;
}
const std::vector<std::string>& ComponentShowcaseRenderer::enemiesInnerLabels() {
    static const std::vector<std::string> labels{"Primordial", "Mech", "Cosmic"};
    return labels;
}

ComponentShowcaseRenderer::ComponentShowcaseRenderer(
    const dof::loaders::ConfigLoader& config, const ColorTheme& theme, const sf::Font& defaultFont)
    : config_(config), defaultFont_(&defaultFont) {
    panelW_    = config.getFloat("SHOWCASE_PANEL_W");
    panelH_    = config.getFloat("SHOWCASE_PANEL_H");
    tabHeight_ = config.getFloat("SHOWCASE_TAB_HEIGHT");
    padding_   = config.getFloat("SHOWCASE_PADDING");
    demoRows_  = config.getFloat("SHOWCASE_DEMO_ROWS");
    demoCols_  = config.getFloat("SHOWCASE_DEMO_COLS");
    fontRowH_  = config.getFloat("SHOWCASE_FONT_ROW_HEIGHT");
    iconCardW_ = config.getFloat("SHOWCASE_ICON_CARD_W");
    iconCardH_ = config.getFloat("SHOWCASE_ICON_CARD_H");
    iconCardGap_ = config.getFloat("SHOWCASE_ICON_CARD_GAP");
    iconBox_ = config.getFloat("SHOWCASE_ICON_BOX");
    iconFontSize_ = static_cast<unsigned>(config.getInt("SHOWCASE_ICON_FONT_SIZE"));
    iconTitleFontSize_ = static_cast<unsigned>(config.getInt("SHOWCASE_ICON_TITLE_FONT_SIZE"));
    iconBodyFontSize_ = static_cast<unsigned>(config.getInt("SHOWCASE_ICON_BODY_FONT_SIZE"));
    iconIntro_ = config.getString("SHOWCASE_ICON_INTRO");
    iconCards_[static_cast<std::size_t>(ShowcaseIcon::Inventory)] = {
        config.getString("SHOWCASE_ICON_INVENTORY_SYMBOL"),
        config.getString("SHOWCASE_ICON_INVENTORY_TITLE"),
        config.getString("SHOWCASE_ICON_INVENTORY_BODY")};
    iconCards_[static_cast<std::size_t>(ShowcaseIcon::LootFilter)] = {
        config.getString("SHOWCASE_ICON_FILTER_SYMBOL"),
        config.getString("SHOWCASE_ICON_FILTER_TITLE"),
        config.getString("SHOWCASE_ICON_FILTER_BODY")};
    iconCards_[static_cast<std::size_t>(ShowcaseIcon::DiceCrafter)] = {
        config.getString("SHOWCASE_ICON_CRAFT_SYMBOL"),
        config.getString("SHOWCASE_ICON_CRAFT_TITLE"),
        config.getString("SHOWCASE_ICON_CRAFT_BODY")};
    iconCards_[static_cast<std::size_t>(ShowcaseIcon::Help)] = {
        config.getString("SHOWCASE_ICON_HELP_SYMBOL"),
        config.getString("SHOWCASE_ICON_HELP_TITLE"),
        config.getString("SHOWCASE_ICON_HELP_BODY")};

    // Single-accent chrome collapse: the gallery frame, nav-tab strip and
    // tooltip all read the shared electric-blue accent + panel-bg + text
    // tokens instead of per-surface SHOWCASE_* colours. Built once here.
    const UiAccent  accent  = UiAccent::loadFromConfig(config);
    const sf::Color panelBg = resolvePanelBackground(config, "SHOWCASE_PANEL_BG");

    panel_.background      = panelBg;
    panel_.border          = accent.full();
    panel_.borderThickness = config.getFloat("SHOWCASE_PANEL_BORDER_THICKNESS");
    tabs_.bgInactive   = panelBg;
    tabs_.bgActive     = accent.dim();
    tabs_.bgHover      = panelBg;            // hovered inactive tab stays panel-bg family
    tabs_.border       = accent.full();
    tabs_.textInactive = theme.uiDim;
    tabs_.textActive   = theme.uiText;
    tabs_.borderThickness = panel_.borderThickness;
    tooltip_.panel.background     = panelBg;
    tooltip_.panel.border         = accent.full();
    tooltip_.panel.borderThickness = panel_.borderThickness;
    tooltip_.titleColor  = theme.uiText;
    tooltip_.bodyColor   = theme.uiDim;
    tooltip_.maxWidth      = config.getFloat("SHOWCASE_TOOLTIP_MAX_W");
    tooltip_.padding       = config.getFloat("SHOWCASE_TOOLTIP_PADDING");
    tooltip_.titleFontSize = config.getFloat("SHOWCASE_TOOLTIP_TITLE_SIZE");
    tooltip_.bodyFontSize  = config.getFloat("SHOWCASE_TOOLTIP_BODY_SIZE");
    tooltip_.lineHeight    = config.getFloat("SHOWCASE_TOOLTIP_LINE_H");
    // Generic shape-demo swatch: outline on the loud accent, fill on panel-bg.
    shapeOutline_ = accent.full();
    shapeFill_    = panelBg;

    // Load gallery-only weapon shapes from weapon_shapes_gallery.yaml.
    const int wcount = config.getInt("WEAPON_GALLERY_COUNT");
    weaponGalleryCatalog_.reserve(static_cast<std::size_t>(std::max(0, wcount)));
    for (int i = 0; i < wcount; ++i) {
        char prefix[32];
        std::snprintf(prefix, sizeof(prefix), "WG_%02d_", i);
        const std::string base = prefix;
        EnemyShapeSpec spec;
        spec.name            = config.getString(base + "NAME");
        spec.form            = parseShapeForm(config.getString(base + "FORM"));
        spec.count           = config.getInt(base + "N");
        spec.inner           = config.getFloat(base + "INNER");
        spec.aspect          = config.getFloat(base + "ASPECT");
        spec.rotationDegrees = config.getFloat(base + "ROTATION_DEG");
        spec.coreRadius      = config.getFloat(base + "CORE");
        weaponGalleryCatalog_.push_back(std::move(spec));
    }

    // Deterministic font listing: sort paths so the 100-font list is stable.
    const std::filesystem::path dir{"assets/fonts/showcase"};
    std::vector<std::filesystem::path> paths;
    if (std::filesystem::is_directory(dir)) {
        for (const auto& entry : std::filesystem::directory_iterator(dir))
            if (entry.path().extension() == ".ttf") paths.push_back(entry.path());
    }
    std::sort(paths.begin(), paths.end());
    for (const auto& p : paths) {
        auto fe = std::make_unique<sf::Font>();
        if (fe->openFromFile(p.string()))
            showcaseFonts_.push_back({p.stem().string(), std::move(fe)});
        else {
            std::cerr << "[showcase] failed to load " << p << "\n";
            throw std::runtime_error("ComponentShowcaseRenderer: failed to load font '" + p.string() + "'");
        }
    }
}

sf::FloatRect ComponentShowcaseRenderer::panelRect(sf::Vector2f viewSize) const {
    return ui::pixelSnap({{(viewSize.x - panelW_) / 2.f, (viewSize.y - panelH_) / 2.f}, {panelW_, panelH_}});
}
sf::FloatRect ComponentShowcaseRenderer::categoryStripRect(sf::FloatRect p) const {
    return ui::pixelSnap({{p.position.x, p.position.y}, {p.size.x, tabHeight_}});
}
sf::FloatRect ComponentShowcaseRenderer::subTabStripRect(sf::FloatRect p) const {
    return ui::pixelSnap({{p.position.x, p.position.y + tabHeight_}, {p.size.x, tabHeight_}});
}
sf::FloatRect ComponentShowcaseRenderer::contentRect(sf::FloatRect p) const {
    return ui::pixelSnap({{p.position.x, p.position.y + 2.f * tabHeight_},
                          {p.size.x, p.size.y - 2.f * tabHeight_}});
}
sf::FloatRect ComponentShowcaseRenderer::innerTabRect(sf::FloatRect content) const {
    return ui::pixelSnap({{content.position.x, content.position.y},
                          {content.size.x, tabHeight_}});
}
sf::FloatRect ComponentShowcaseRenderer::innerContentRect(sf::FloatRect content) const {
    return ui::pixelSnap({{content.position.x, content.position.y + tabHeight_},
                          {content.size.x, content.size.y - tabHeight_}});
}

void ComponentShowcaseRenderer::advance(sf::Vector2f mouseUi) {
    mouseUi_ = mouseUi;
    hoveredElement_ = -1;
    for (int i = 0; i < static_cast<int>(demosThisFrame_.size()); ++i) {
        const auto& r = demosThisFrame_[i].rect;
        if (mouseUi.x >= r.position.x && mouseUi.x < r.position.x + r.size.x &&
            mouseUi.y >= r.position.y && mouseUi.y < r.position.y + r.size.y) {
            hoveredElement_ = i; break;
        }
    }
}

void ComponentShowcaseRenderer::handleClick(sf::Vector2f uiPoint, UiState& uiState) {
    const sf::FloatRect panel = panelRect(lastViewSize_);
    // Every strip in the showcase is always live: the gallery has no disabled
    // mode, so all four hit-tests below pass a literal true — matching the
    // default the matching tabs_.draw() calls take.
    const int catHit = tabs_.hitTest(categoryStripRect(panel), categoryLabels(), uiPoint,
                                     /*isEnabled=*/true);
    if (catHit >= 0) {
        uiState.galleryCategory   = catHit;
        uiState.showcaseActiveTab = uiState.gallerySubTab[catHit];
        return;
    }
    const int cat = std::clamp(uiState.galleryCategory, 0, kGalleryCategoryCount - 1);
    const int subHit = tabs_.hitTest(subTabStripRect(panel), subTabLabels(cat), uiPoint,
                                     /*isEnabled=*/true);
    if (subHit >= 0) {
        uiState.gallerySubTab[cat] = subHit;
        uiState.showcaseActiveTab  = subHit;
        return;
    }
    const sf::FloatRect content = contentRect(panel);
    if (cat == 3) return;

    // Third-level inner tabs (only active for Game Art → Weapons or Enemies).
    if (cat == 0) {
        const int sub = std::clamp(uiState.gallerySubTab[0], 0, 2);
        if (sub == 0) {  // Weapons inner tab
            const int hit = tabs_.hitTest(innerTabRect(content), weaponsInnerLabels(), uiPoint,
                                          /*isEnabled=*/true);
            if (hit >= 0) { uiState.weaponsSubTab = hit; return; }
        } else if (sub == 1) {  // Enemies inner tab
            const int hit = tabs_.hitTest(innerTabRect(content), enemiesInnerLabels(), uiPoint,
                                          /*isEnabled=*/true);
            if (hit >= 0) { uiState.enemiesSubTab = hit; return; }
        }
    }
    // UI Kit → Fonts: font row selection + usage checkbox toggles.
    if (cat == 1 && uiState.gallerySubTab[1] == 1) {
        const int n = static_cast<int>(uiState.galleryFontUsageMasks.size());

        // Usage checkbox click (right panel) — only when a font is selected.
        if (uiState.galleryFontClickedIndex >= 0) {
            const int slot = hitTestFontUsage(content, uiPoint);
            if (slot >= 0) {
                const int sel = uiState.galleryFontClickedIndex;
                if (sel < n)
                    uiState.galleryFontUsageMasks[sel] ^= (1u << slot);
                return;
            }
        }

        // Font row click (left column) — toggle selection.
        const int row = hitTestFontRow(content, uiState.galleryFontsScroll, uiPoint);
        if (row >= 0) {
            uiState.galleryFontClickedIndex =
                (uiState.galleryFontClickedIndex == row) ? -1 : row;
        }
    }
}

void ComponentShowcaseRenderer::draw(sf::RenderWindow& window, const GalleryContext& ctx) {
    lastViewSize_ = ctx.viewSize;
    UiState& us = *ctx.uiState;
    const int cat = std::clamp(us.galleryCategory, 0, kGalleryCategoryCount - 1);
    const auto& subLabels = subTabLabels(cat);
    const int sub = std::clamp(us.gallerySubTab[cat], 0, static_cast<int>(subLabels.size()) - 1);

    sf::RectangleShape scrim;
    scrim.setPosition({0.f, 0.f}); scrim.setSize(ctx.viewSize);
    scrim.setFillColor({0, 0, 0, 140}); window.draw(scrim);

    const sf::FloatRect panel   = panelRect(ctx.viewSize);
    const sf::FloatRect catRect = categoryStripRect(panel);
    const sf::FloatRect subRect = subTabStripRect(panel);
    const sf::FloatRect content = contentRect(panel);
    panel_.draw(window, panel);

    // Hover is resolved through the same hit-test handleClick() uses, with the
    // same enablement, so the highlighted tab is always the clickable one.
    hoveredCategory_ = tabs_.hitTest(catRect, categoryLabels(), mouseUi_, /*isEnabled=*/true);
    tabs_.draw(window, catRect, *defaultFont_, 13, categoryLabels(), cat, hoveredCategory_);
    hoveredSubTab_ = tabs_.hitTest(subRect, subLabels, mouseUi_, /*isEnabled=*/true);
    tabs_.draw(window, subRect, *defaultFont_, 12, subLabels, sub, hoveredSubTab_);

    demosThisFrame_.clear();
    static const std::vector<EnemyShapeSpec> kEmptyCatalog;
    if (cat == 0) {  // Game Art
        if      (sub == 0) drawWeaponsTab(window, content, *defaultFont_, us);
        else if (sub == 1) drawEnemiesTab(window, content, *defaultFont_,
                                          ctx.enemyCatalog ? *ctx.enemyCatalog : kEmptyCatalog,
                                          us);
        else if (ctx.effects && ctx.uiView && ctx.shaders)
            ctx.effects->renderBody(window, *ctx.uiView, us, *ctx.shaders, ctx.elapsed, content);
    } else if (cat == 1) {  // UI Kit
        if (sub == 0) drawComponentsTab(window, content, *defaultFont_);
        else          drawFontsTab(window, content, *defaultFont_, ctx);
    } else if (cat == 2) {  // Grouped FX
        if (ctx.groupedFx && ctx.uiView && ctx.shaders)
            ctx.groupedFx->renderBody(window, *ctx.uiView, us, *ctx.shaders, ctx.elapsed, content);
    } else {  // Icons
        drawIconsTab(window, content, *defaultFont_);
    }

    if (hoveredElement_ >= 0 && hoveredElement_ < static_cast<int>(demosThisFrame_.size())) {
        const auto& demo = demosThisFrame_[hoveredElement_];
        tooltip_.draw(window, {demo.rect.position.x + demo.rect.size.x, demo.rect.position.y},
                      *defaultFont_, demo.tooltipTitle, demo.tooltipBody, ctx.viewSize);
    }
}
} // namespace dof::render
