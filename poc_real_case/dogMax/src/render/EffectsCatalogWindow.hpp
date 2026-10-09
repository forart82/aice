#pragma once

#include "render/CatalogChrome.hpp"
#include "render/GroupedEffectsCatalog.hpp"  // EffectLayer / EffectCatalogEntry / drawEffectLayers

#include <SFML/Graphics/Color.hpp>
#include <SFML/Graphics/Font.hpp>
#include <SFML/Graphics/Rect.hpp>
#include <SFML/Graphics/Texture.hpp>

#include <array>
#include <string>
#include <vector>

namespace dof::loaders { class ConfigLoader; class ShaderLoader; }
namespace sf           { class RenderWindow; class View; }

namespace dof::render {

struct UiState;

// Effects Catalog. Three tabs (Small 50px / Medium 500px / Large 1000px) show
// all 300 named effects in a scrollable grid. Each cell renders the effect's
// GLSL shaders live (progress loops 0→1 continuously) so the player sees every
// effect in action.
//
// Small effects are single-shader. Medium and Large are COMPOSED: each is
// authored in config as a stack of layers (CEF_nnn_L0/_L1/_L2, LEF_nnn_L0/…)
// naming a small effect, its sub-radius in pixels, an offset, and a phase
// delay. Every layer is drawn, concentrically and additively, staggered in
// time by its phase — a composed cell is a composite, not one representative
// shader.
//
// Navigation (inside the Ctrl+H gallery, Game Art → Effects sub-tab):
//   Tab / 1 2 3     — switch between Small / Medium / Large tab
//   Mouse wheel     — scroll the grid
//
// Scroll state lives in UiState (effectsCatalogScrollOffset[3]) so tab
// switches preserve per-tab positions and the window itself is stateless.
// The frame/tabs/cell chrome is composed from the shared CatalogChrome; this
// class owns only the catalog data and the live per-cell shader preview.
class EffectsCatalogWindow {
public:
    EffectsCatalogWindow(const dof::loaders::ConfigLoader& config, const sf::Font& font);

    // Embed the catalog body (panel + size-tabs + live shader grid, NO scrim
    // and NOT gated on a standalone open flag) inside `rect`. Used by the
    // unified Gallery window's "Effects" sub-tab so the catalog renders into a
    // shared content area instead of its own full-screen window.
    void renderBody(sf::RenderWindow& window,
                    const sf::View& uiView,
                    const UiState& uiState,
                    const dof::loaders::ShaderLoader& shaders,
                    float elapsedSeconds,
                    sf::FloatRect rect);

    // Advance the scroll offset for the active tab (clamped). Called from
    // the wheel event handler when the catalog is open.
    void scrollBy(float delta, UiState& uiState) const;

    // Clamp scroll on tab switch (content height may differ per tab).
    void clampScrollForTab(int tab, UiState& uiState) const;

    // Hit-test the three size-tabs (Small/Medium/Large) drawn inside panelRect_.
    // Updates us.effectsCatalogTabIndex and clamps scroll if a tab was clicked.
    // Returns true if the click landed on a tab.
    bool handleTabClick(sf::Vector2f uiPoint, UiState& us);

    // Accessor: panel rect in UI design coords.
    sf::FloatRect panelRect() const { return panelRect_; }

private:
    // Parse the single-layer Small effects (EFX_*) into tabs_[0]. Must run
    // before the composed builders — they resolve their layers by small-effect
    // NAME against the entries this produces.
    void buildSmallCatalog(const dof::loaders::ConfigLoader& cfg);

    // Parse a composed tab (`prefix` is "CEF_" or "LEF_") into `out`. Each
    // layer's sub-radius is expressed in pixels against `nominalRadiusKey`'s
    // value, which is what turns it into a fraction of the preview box.
    void buildComposedCatalog(const dof::loaders::ConfigLoader& cfg,
                              const char* prefix,
                              const char* nominalRadiusKey,
                              std::vector<EffectCatalogEntry>& out);

    const std::vector<EffectCatalogEntry>& entriesForTab(int tab) const;

    // The three size-tab labels — shared by the tab strip draw and its
    // hit-test. Non-static: the entry counts come from the parsed catalog.
    std::vector<std::string> tabLabels() const;

    void drawGrid(sf::RenderWindow& window,
                  const sf::View& uiView,
                  const UiState& us,
                  const dof::loaders::ShaderLoader& shaders,
                  float elapsed) const;

    const sf::Font& font_;
    CatalogChrome   chrome_;

    // 1×1 white dummy texture — provides correct UV interpolation to the
    // effect shaders (gl_TexCoord[0].xy / u_resolution needs 0→previewSize
    // across the quad; without a bound texture SFML gives UV={0,0} everywhere).
    sf::Texture dummyTex_;

    // 0 = Small (single-layer), 1 = Medium composed, 2 = Large composed.
    std::array<std::vector<EffectCatalogEntry>, 3> tabs_;

    sf::FloatRect panelRect_;
};

} // namespace dof::render
