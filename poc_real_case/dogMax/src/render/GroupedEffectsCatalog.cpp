#include "render/GroupedEffectsCatalog.hpp"

#include "loaders/ConfigLoader.hpp"
#include "loaders/ShaderLoader.hpp"
#include "render/EffectUniforms.hpp"
#include "render/UiState.hpp"
#include "render/ui/UiScrollPanel.hpp"

#include <SFML/Graphics/RectangleShape.hpp>
#include <SFML/Graphics/RenderWindow.hpp>
#include <SFML/Graphics/Shader.hpp>

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <numbers>
#include <sstream>

namespace dof::render {

namespace {

sf::Color channelColor(float r, float g, float b) {
    auto ch = [](float v) { return static_cast<std::uint8_t>(std::clamp(v, 0.f, 1.f) * 255.f); };
    return sf::Color(ch(r), ch(g), ch(b));
}

// Parse "shaderName cr cg cb variant speed intensity" into a layer (position
// and size filled by the caller). Returns false if the spec is empty.
bool parseLayerSpec(const std::string& spec, EffectLayer& out) {
    std::istringstream ss(spec);
    float cr{1}, cg{1}, cb{1};
    if (!(ss >> out.shader)) return false;
    ss >> cr >> cg >> cb >> out.variant >> out.speed >> out.intensity;
    out.color = channelColor(cr, cg, cb);
    return true;
}

// Resolve a named pattern to a list of OUTER (relCx, relCy) positions.
std::vector<sf::Vector2f> resolvePattern(const std::string& pattern, float ringRadius) {
    using std::numbers::pi_v;
    const float pi = pi_v<float>;
    std::vector<sf::Vector2f> pts;

    auto ringAt = [&](int n, float startDeg) {
        for (int i = 0; i < n; ++i) {
            const float ang = (startDeg + 360.f * static_cast<float>(i) / static_cast<float>(n))
                              * pi / 180.f;
            pts.push_back({0.5f + ringRadius * std::cos(ang),
                           0.5f + ringRadius * std::sin(ang)});
        }
    };
    auto grid = [&](int cols, int rows, float spacing) {
        const float x0 = 0.5f - spacing * static_cast<float>(cols - 1) * 0.5f;
        const float y0 = 0.5f - spacing * static_cast<float>(rows - 1) * 0.5f;
        for (int ry = 0; ry < rows; ++ry)
            for (int cx = 0; cx < cols; ++cx)
                pts.push_back({x0 + spacing * static_cast<float>(cx),
                               y0 + spacing * static_cast<float>(ry)});
    };

    if (pattern == "ring3" || pattern == "trio") ringAt(3, -90.f);
    else if (pattern == "ring4")                 ringAt(4, -90.f);
    else if (pattern == "ring5" || pattern == "star5") ringAt(5, -90.f);
    else if (pattern == "ring6")                 ringAt(6, -90.f);
    else if (pattern == "ring8")                 ringAt(8, -90.f);
    else if (pattern == "ring10")                ringAt(10, -90.f);
    else if (pattern == "ring12")                ringAt(12, -90.f);
    else if (pattern == "cross")                 ringAt(4, -90.f);
    else if (pattern == "cross_diag")            ringAt(4, -45.f);
    else if (pattern == "grid2x2")               grid(2, 2, ringRadius * 1.4f);
    else if (pattern == "grid3x3")               grid(3, 3, ringRadius * 1.0f);
    else if (pattern == "grid2x3")               grid(3, 2, ringRadius * 1.1f);
    else if (pattern == "duo_h") {
        pts.push_back({0.5f - ringRadius, 0.5f});
        pts.push_back({0.5f + ringRadius, 0.5f});
    } else if (pattern == "duo_v") {
        pts.push_back({0.5f, 0.5f - ringRadius});
        pts.push_back({0.5f, 0.5f + ringRadius});
    } else {
        ringAt(8, -90.f); // unknown pattern → sensible default
    }
    return pts;
}

} // namespace

// ── Shared composite draw ────────────────────────────────────────────────────

void drawEffectLayers(sf::RenderWindow& window,
                      const std::vector<EffectLayer>& layers,
                      sf::Vector2f previewOrigin,
                      float previewSize,
                      const sf::Texture& uvTexture,
                      const dof::loaders::ShaderLoader& shaders,
                      float elapsed) {
    for (const EffectLayer& layer : layers) {
        const sf::Shader* sh = shaders.getShader(layer.shader);
        if (!sh) continue;

        const float layerPxSize = layer.relSize * previewSize;
        const float layerLeft = previewOrigin.x + layer.relCx * previewSize - layerPxSize * 0.5f;
        const float layerTop  = previewOrigin.y + layer.relCy * previewSize - layerPxSize * 0.5f;

        // Start at 0.3 so the effect is always visible (progress=0 → flash=0 →
        // invisible). `phase` pushes a layer BACK in the loop so a composed
        // effect's inner layers trail its outer ones instead of firing together.
        float progress = std::fmod(0.3f + elapsed * layer.speed * 0.25f - layer.phase, 1.0f);
        if (progress < 0.f) progress += 1.f;

        sf::RectangleShape quad{{layerPxSize, layerPxSize}};
        quad.setPosition({layerLeft, layerTop});
        // Bind the 1×1 dummy texture and set texture rect = layer size so SFML
        // interpolates gl_TexCoord[0].xy from {0,0} to {size,size} across the
        // quad — exactly what the shaders expect for UV mapping.
        quad.setTexture(&uvTexture);
        quad.setTextureRect(sf::IntRect{{0, 0},
            {static_cast<int>(layerPxSize), static_cast<int>(layerPxSize)}});

        applyEffectUniforms(*sh, {layerPxSize, layerPxSize}, layer.color,
                            progress, layer.variant, layer.speed, layer.intensity);

        sf::RenderStates rst;
        rst.shader    = sh;
        rst.blendMode = sf::BlendAdd;
        window.draw(quad, rst);
    }
}

GroupedEffectsCatalog::GroupedEffectsCatalog(const dof::loaders::ConfigLoader& cfg,
                                             const sf::Font& font)
    : font_{font}
    , chrome_{CatalogChrome::loadFromConfig(cfg)}
{
    buildTabCatalog(cfg, "GEF_200_",  tabs_[0]);
    buildTabCatalog(cfg, "GEF_500_",  tabs_[1]);
    buildTabCatalog(cfg, "GEF_1000_", tabs_[2]);

    if (dummyTex_.resize({1u, 1u})) {
        const std::array<std::uint8_t, 4> white{255u, 255u, 255u, 255u};
        dummyTex_.update(white.data());
    }
}

// ── Catalog parsing ──────────────────────────────────────────────────────────

void GroupedEffectsCatalog::buildTabCatalog(const dof::loaders::ConfigLoader& cfg,
                                            const char* prefix,
                                            std::vector<EffectCatalogEntry>& out) {
    // Read unconditionally: a missing count key is a broken config, not a
    // reason to silently fall back to a source-side default.
    const int count = cfg.getInt(std::string(prefix) + "COUNT");
    out.reserve(static_cast<size_t>(std::max(0, count)));

    for (int i = 1; i <= count; ++i) {
        char idx[16]; std::snprintf(idx, sizeof(idx), "%03d", i);
        const std::string base   = std::string(prefix) + idx + "_";
        const std::string nameK  = base + "NAME";
        const std::string dataK  = base + "DATA";
        const std::string outerK = base + "OUTER";
        const std::string centK  = base + "CENTER";
        if (!cfg.hasKey(nameK) || !cfg.hasKey(dataK) || !cfg.hasKey(outerK)) continue;

        // DATA: pattern [outerScale] [centerScale] [ringRadius]
        std::istringstream ds(cfg.getString(dataK));
        std::string pattern;
        float outerScale = 0.25f, centerScale = 0.40f, ringRadius = 0.33f;
        ds >> pattern;
        if (!(ds >> outerScale))  outerScale = 0.25f;
        if (!(ds >> centerScale)) centerScale = 0.40f;
        if (!(ds >> ringRadius))  ringRadius = 0.33f;

        EffectLayer outerSpec;
        if (!parseLayerSpec(cfg.getString(outerK), outerSpec)) continue;

        EffectCatalogEntry entry;
        entry.name = cfg.getString(nameK);

        for (const sf::Vector2f& p : resolvePattern(pattern, ringRadius)) {
            EffectLayer l = outerSpec;
            l.relCx = p.x; l.relCy = p.y; l.relSize = outerScale;
            entry.layers.push_back(l);
        }

        if (cfg.hasKey(centK)) {
            EffectLayer centerSpec;
            if (parseLayerSpec(cfg.getString(centK), centerSpec)) {
                centerSpec.relCx = 0.5f; centerSpec.relCy = 0.5f;
                centerSpec.relSize = centerScale;
                entry.layers.push_back(centerSpec);
            }
        }

        out.push_back(std::move(entry));
    }
}

const std::vector<EffectCatalogEntry>& GroupedEffectsCatalog::entriesForTab(int tab) const {
    return tabs_[static_cast<size_t>(std::clamp(tab, 0, 2))];
}

std::vector<std::string> GroupedEffectsCatalog::tabLabels() const {
    auto label = [this](const char* text, int tab) {
        return std::string(text) + " (" + std::to_string(entriesForTab(tab).size()) + ")";
    };
    return {label("200px", 0), label("500px", 1), label("1000px", 2)};
}

// ── Scroll ───────────────────────────────────────────────────────────────────

void GroupedEffectsCatalog::scrollBy(float delta, UiState& us) const {
    const int tab = std::clamp(us.groupedFxTabIndex, 0, 2);
    const float ch   = chrome_.contentHeight(static_cast<int>(entriesForTab(tab).size()));
    const float clip = chrome_.gridClipRect(panelRect_).size.y;
    us.groupedFxScrollOffset[tab] =
        ui::UiScrollPanel::clampOffset(us.groupedFxScrollOffset[tab] + delta, ch, clip);
}

void GroupedEffectsCatalog::clampScrollForTab(int tab, UiState& us) const {
    const int t = std::clamp(tab, 0, 2);
    const float ch   = chrome_.contentHeight(static_cast<int>(entriesForTab(t).size()));
    const float clip = chrome_.gridClipRect(panelRect_).size.y;
    us.groupedFxScrollOffset[t] =
        ui::UiScrollPanel::clampOffset(us.groupedFxScrollOffset[t], ch, clip);
}

bool GroupedEffectsCatalog::handleTabClick(sf::Vector2f uiPoint, UiState& us) {
    const int i = chrome_.tabAt(panelRect_, tabLabels(), uiPoint);
    if (i < 0) return false;
    us.groupedFxTabIndex = i;
    clampScrollForTab(i, us);
    return true;
}

// ── Top-level render ─────────────────────────────────────────────────────────

void GroupedEffectsCatalog::renderBody(sf::RenderWindow& window,
                                       const sf::View& uiView,
                                       UiState& us,
                                       const dof::loaders::ShaderLoader& shaders,
                                       float elapsedSeconds,
                                       sf::FloatRect rect) {
    panelRect_ = rect;
    chrome_.drawPanel(window, panelRect_);
    chrome_.drawTitle(window, font_, panelRect_, "GROUPED EFFECTS CATALOG");
    chrome_.drawTabs(window, font_, panelRect_, tabLabels(),
                     std::clamp(us.groupedFxTabIndex, 0, 2));
    drawGrid(window, uiView, us, shaders, elapsedSeconds);
}

// ── Draw helpers ─────────────────────────────────────────────────────────────

void GroupedEffectsCatalog::drawGrid(sf::RenderWindow& window,
                                     const sf::View& uiView,
                                     const UiState& us,
                                     const dof::loaders::ShaderLoader& shaders,
                                     float elapsed) const {
    const int tab = std::clamp(us.groupedFxTabIndex, 0, 2);
    const std::vector<EffectCatalogEntry>& entries = entriesForTab(tab);
    const int count = static_cast<int>(entries.size());
    if (count == 0) return;

    const float offset = us.groupedFxScrollOffset[tab];
    const sf::FloatRect clip = chrome_.gridClipRect(panelRect_);
    const float ch = chrome_.contentHeight(count);

    const sf::View saved = window.getView();
    ui::UiScrollPanel::applyClipView(window, clip, uiView, offset);

    for (int i = 0; i < count; ++i) {
        const sf::FloatRect cell = chrome_.cellRect(clip, i);
        chrome_.drawCell(window, cell);

        drawEffectLayers(window, entries[static_cast<size_t>(i)].layers,
                         chrome_.previewOrigin(cell), chrome_.previewSize,
                         dummyTex_, shaders, elapsed);

        chrome_.drawCellLabel(window, font_, cell, entries[static_cast<size_t>(i)].name);
    }

    window.setView(saved);
    chrome_.drawScrollbar(window, clip, offset, ch);
}

} // namespace dof::render
