#include "render/EffectsCatalogWindow.hpp"

#include "loaders/ConfigLoader.hpp"
#include "loaders/ShaderLoader.hpp"
#include "render/UiState.hpp"
#include "render/ui/UiScrollPanel.hpp"

#include <SFML/Graphics/RenderWindow.hpp>

#include <algorithm>
#include <array>
#include <cstdint>
#include <sstream>
#include <stdexcept>

namespace dof::render {

EffectsCatalogWindow::EffectsCatalogWindow(const dof::loaders::ConfigLoader& cfg,
                                           const sf::Font& font)
    : font_{font}
    , chrome_{CatalogChrome::loadFromConfig(cfg)}
{
    // Order matters: the composed builders resolve each layer by small-effect
    // name against tabs_[0], so the Small catalog must exist first.
    buildSmallCatalog(cfg);
    buildComposedCatalog(cfg, "CEF_", "CEF_NOMINAL_RADIUS_PX", tabs_[1]);
    buildComposedCatalog(cfg, "LEF_", "LEF_NOMINAL_RADIUS_PX", tabs_[2]);
    // Create the 1×1 white dummy texture used to provide correct UV interpolation
    // to effect shaders (gl_TexCoord[0].xy needs to span 0→previewSize across the quad).
    // Silently skipped in headless/test contexts where no GL context exists.
    if (dummyTex_.resize({1u, 1u})) {
        const std::array<std::uint8_t, 4> white{255u, 255u, 255u, 255u};
        dummyTex_.update(white.data());
    }
}

// ── Catalog parsing ──────────────────────────────────────────────────────────

void EffectsCatalogWindow::buildSmallCatalog(const dof::loaders::ConfigLoader& cfg) {
    // Read unconditionally: a missing count key is a broken config, not a
    // reason to silently fall back to a source-side default.
    const int count = cfg.getInt("EFX_COUNT");
    // Guard the size_t cast: a negative EFX_COUNT would reserve a huge amount
    // and throw (the sibling GroupedEffectsCatalog already clamps like this).
    tabs_[0].reserve(static_cast<size_t>(std::max(0, count)));
    for (int i = 1; i <= count; ++i) {
        char idx[16]; std::snprintf(idx, sizeof(idx), "%03d", i);
        const std::string nk = std::string("EFX_") + idx + "_NAME";
        const std::string dk = std::string("EFX_") + idx + "_DATA";
        if (!cfg.hasKey(nk) || !cfg.hasKey(dk)) continue;
        // DATA: shaderName cr cg cb variant speed intensity duration category
        std::istringstream ss(cfg.getString(dk));
        EffectLayer layer;
        float cr{1}, cg{1}, cb{1}, dur{1};
        std::string cat;
        ss >> layer.shader >> cr >> cg >> cb
           >> layer.variant >> layer.speed >> layer.intensity >> dur >> cat;
        auto chan = [](float v){ return static_cast<std::uint8_t>(std::clamp(v,0.f,1.f)*255.f); };
        layer.color = sf::Color(chan(cr), chan(cg), chan(cb));
        // A small effect fills its whole preview box: one centred, full-size layer.
        layer.relCx = 0.5f; layer.relCy = 0.5f; layer.relSize = 1.0f;

        EffectCatalogEntry entry;
        entry.name = cfg.getString(nk);
        entry.layers.push_back(std::move(layer));
        tabs_[0].push_back(std::move(entry));
    }
}

void EffectsCatalogWindow::buildComposedCatalog(const dof::loaders::ConfigLoader& cfg,
                                                const char* prefix,
                                                const char* nominalRadiusKey,
                                                std::vector<EffectCatalogEntry>& out) {
    const int   count         = cfg.getInt(std::string(prefix) + "COUNT");
    const float nominalRadius = static_cast<float>(cfg.getInt(nominalRadiusKey));
    out.reserve(static_cast<size_t>(std::max(0, count)));

    for (int i = 1; i <= count; ++i) {
        char idx[16]; std::snprintf(idx, sizeof(idx), "%03d", i);
        const std::string base  = std::string(prefix) + idx;
        const std::string nameK = base + "_NAME";
        if (!cfg.hasKey(nameK)) continue;

        EffectCatalogEntry entry;
        entry.name = cfg.getString(nameK);

        // Every authored layer composites into the cell. Layer format:
        //   <small_effect_name> <sub_radius_px> <offset_x_px> <offset_y_px> <phase_0to1>
        // The shader/colour/variant/speed/intensity come from the named small
        // effect; this line supplies only the geometry and the time offset.
        for (int n = 0; cfg.hasKey(base + "_L" + std::to_string(n)); ++n) {
            std::istringstream ss(cfg.getString(base + "_L" + std::to_string(n)));
            std::string smallName;
            float subRadiusPx{0}, offsetXPx{0}, offsetYPx{0}, phase{0};
            ss >> smallName >> subRadiusPx >> offsetXPx >> offsetYPx >> phase;

            const EffectCatalogEntry* source = nullptr;
            for (const EffectCatalogEntry& candidate : tabs_[0])
                if (candidate.name == smallName) { source = &candidate; break; }
            // Crash early: a layer naming an effect that does not exist is an
            // authoring error, and silently dropping it is exactly how these
            // composed effects went unnoticed as single-layer for so long.
            if (!source || source->layers.empty())
                throw std::runtime_error("EffectsCatalogWindow: " + base + "_L"
                                         + std::to_string(n) + " names unknown effect '"
                                         + smallName + "'");

            EffectLayer layer = source->layers.front();
            // Sub-radius and offsets are authored in pixels against the tab's
            // nominal effect radius; the preview box represents that radius.
            layer.relSize = subRadiusPx / nominalRadius;
            layer.relCx   = 0.5f + offsetXPx / nominalRadius;
            layer.relCy   = 0.5f + offsetYPx / nominalRadius;
            layer.phase   = phase;
            entry.layers.push_back(std::move(layer));
        }

        out.push_back(std::move(entry));
    }
}

const std::vector<EffectCatalogEntry>& EffectsCatalogWindow::entriesForTab(int tab) const {
    return tabs_[static_cast<size_t>(std::clamp(tab, 0, 2))];
}

std::vector<std::string> EffectsCatalogWindow::tabLabels() const {
    auto label = [this](const char* text, int tab) {
        return std::string(text) + " (" + std::to_string(entriesForTab(tab).size()) + ")";
    };
    return {label("SMALL  50px", 0), label("MEDIUM 500px", 1), label("LARGE 1000px", 2)};
}

// ── Scroll ───────────────────────────────────────────────────────────────────

void EffectsCatalogWindow::scrollBy(float delta, UiState& us) const {
    const int tab = std::clamp(us.effectsCatalogTabIndex, 0, 2);
    const float ch   = chrome_.contentHeight(static_cast<int>(entriesForTab(tab).size()));
    const float clip = chrome_.gridClipRect(panelRect_).size.y;
    us.effectsCatalogScrollOffset[tab] =
        ui::UiScrollPanel::clampOffset(us.effectsCatalogScrollOffset[tab] + delta, ch, clip);
}

void EffectsCatalogWindow::clampScrollForTab(int tab, UiState& us) const {
    const int t = std::clamp(tab, 0, 2);
    const float ch   = chrome_.contentHeight(static_cast<int>(entriesForTab(t).size()));
    const float clip = chrome_.gridClipRect(panelRect_).size.y;
    us.effectsCatalogScrollOffset[t] =
        ui::UiScrollPanel::clampOffset(us.effectsCatalogScrollOffset[t], ch, clip);
}

bool EffectsCatalogWindow::handleTabClick(sf::Vector2f uiPoint, UiState& us) {
    const int i = chrome_.tabAt(panelRect_, tabLabels(), uiPoint);
    if (i < 0) return false;
    us.effectsCatalogTabIndex = i;
    clampScrollForTab(i, us);
    return true;
}

// ── Top-level render ─────────────────────────────────────────────────────────

void EffectsCatalogWindow::renderBody(sf::RenderWindow& window,
                                      const sf::View& uiView,
                                      const UiState& us,
                                      const dof::loaders::ShaderLoader& shaders,
                                      float elapsedSeconds,
                                      sf::FloatRect rect) {
    // Embedded in the unified Gallery content area: lay the catalog out inside
    // `rect` and draw everything EXCEPT the modal scrim (the host already drew
    // it). Not gated on isEffectsCatalogOpen — the host decides visibility.
    panelRect_ = rect;
    chrome_.drawPanel(window, panelRect_);
    chrome_.drawTitle(window, font_, panelRect_, "EFFECTS CATALOG");
    chrome_.drawTabs(window, font_, panelRect_, tabLabels(),
                     std::clamp(us.effectsCatalogTabIndex, 0, 2));
    drawGrid(window, uiView, us, shaders, elapsedSeconds);
}

// ── Draw helpers ─────────────────────────────────────────────────────────────

void EffectsCatalogWindow::drawGrid(sf::RenderWindow& window,
                                     const sf::View& uiView,
                                     const UiState& us,
                                     const dof::loaders::ShaderLoader& shaders,
                                     float elapsed) const
{
    const int tab = std::clamp(us.effectsCatalogTabIndex, 0, 2);
    const float offset = us.effectsCatalogScrollOffset[tab];

    const std::vector<EffectCatalogEntry>& entries = entriesForTab(tab);
    const int count = static_cast<int>(entries.size());
    if (count == 0) return;

    const sf::FloatRect clip = chrome_.gridClipRect(panelRect_);
    const float ch = chrome_.contentHeight(count);

    // Apply clip view — all content draws below are clipped to `clip`.
    const sf::View saved = window.getView();
    ui::UiScrollPanel::applyClipView(window, clip, uiView, offset);

    // Draw each cell in content coordinates (clip view will handle scroll).
    // Small entries carry one full-size layer, composed entries carry several —
    // the same composite loop covers both.
    for (int i = 0; i < count; ++i) {
        const sf::FloatRect cell = chrome_.cellRect(clip, i);
        chrome_.drawCell(window, cell);

        drawEffectLayers(window, entries[static_cast<size_t>(i)].layers,
                         chrome_.previewOrigin(cell), chrome_.previewSize,
                         dummyTex_, shaders, elapsed);

        // Effect name label — white text centred at the bottom of the cell.
        chrome_.drawCellLabel(window, font_, cell, entries[static_cast<size_t>(i)].name);
    }

    window.setView(saved);

    // Scrollbar drawn in restored uiView space.
    chrome_.drawScrollbar(window, clip, offset, ch);
}

} // namespace dof::render
