#pragma once

#include "render/CatalogChrome.hpp"

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

// One sub-effect quad inside a catalog cell. Several of these composite
// together to form a single catalog entry — spatially for grouped effects
// (e.g. 8 outer rings + 1 center) and concentrically for composed medium/large
// effects (nested radii, staggered in time by `phase`).
//
// Shared by BOTH catalog windows: GroupedEffectsCatalog and
// EffectsCatalogWindow. It lives in this header because the grouped catalog was
// the first consumer, not because it is grouped-specific.
struct EffectLayer {
    std::string shader;
    sf::Color   color;
    float       variant{0}, speed{1}, intensity{1};
    float       relCx{0.5f}, relCy{0.5f};  // center in [0,1] of preview
    float       relSize{0.25f};            // size as fraction of previewSize
    float       phase{0};                  // progress offset in [0,1): delays this layer
};

// One catalog cell: a display name plus the layers that composite into it.
// A single-layer entry is the degenerate case (used by the Small effects tab).
struct EffectCatalogEntry {
    std::string              name;
    std::vector<EffectLayer> layers;
};

// Draw every layer of one cell as an additively-blended shader quad, positioned
// and sized relative to a `previewSize`-square preview box at `previewOrigin`.
// Shared by both catalog windows so the composite loop exists exactly once.
void drawEffectLayers(sf::RenderWindow& window,
                      const std::vector<EffectLayer>& layers,
                      sf::Vector2f previewOrigin,
                      float previewSize,
                      const sf::Texture& uvTexture,
                      const dof::loaders::ShaderLoader& shaders,
                      float elapsed);

// Gallery tab renderer for "grouped" effects: each cell composites MULTIPLE
// shader quads arranged spatially (ring/cross/grid patterns) into one preview.
// Three size tabs (200px / 500px / 1000px), each up to 100 entries, parsed from
// config prefixes GEF_200_ / GEF_500_ / GEF_1000_.
// The frame/tabs/cell chrome is composed from the shared CatalogChrome; this
// class owns only the catalog data and the multi-layer per-cell preview.
class GroupedEffectsCatalog {
public:
    GroupedEffectsCatalog(const dof::loaders::ConfigLoader& config, const sf::Font& font);

    void renderBody(sf::RenderWindow& window,
                    const sf::View& uiView,
                    UiState& uiState,
                    const dof::loaders::ShaderLoader& shaders,
                    float elapsedSeconds,
                    sf::FloatRect rect);

    void scrollBy(float delta, UiState& uiState) const;
    void clampScrollForTab(int tab, UiState& uiState) const;
    bool handleTabClick(sf::Vector2f uiPoint, UiState& us);

    sf::FloatRect panelRect() const { return panelRect_; }

private:
    void buildTabCatalog(const dof::loaders::ConfigLoader& cfg, const char* prefix,
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
    sf::Texture     dummyTex_;

    std::array<std::vector<EffectCatalogEntry>, 3> tabs_;

    sf::FloatRect panelRect_;
};

} // namespace dof::render
