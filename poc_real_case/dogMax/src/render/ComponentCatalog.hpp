#pragma once

#include <SFML/Graphics/Color.hpp>
#include <SFML/Graphics/Rect.hpp>

#include <functional>
#include <string>
#include <vector>

namespace dof::loaders { class ConfigLoader; class ShaderLoader; }
namespace dof::render  { class ShapeShaders; }
namespace sf { class RenderWindow; class Font; }

namespace dof::render {

// Everything one component demo needs to render itself into a gallery cell.
struct ComponentDemoContext {
    sf::RenderWindow&                 window;
    sf::FloatRect                     rect;
    const sf::Font&                   font;
    const dof::loaders::ConfigLoader& config;
    const dof::loaders::ShaderLoader* shaders{nullptr};       // needed by UiDiceCell demo
    dof::render::ShapeShaders*        shapeShaders{nullptr};  // needed by UiDiceCell demo
    // Single-accent chrome tokens, resolved once at the ctx build site so every
    // demo lambda draws its chrome from the shared accent set (electric blue)
    // instead of file-scope demo literals. `accent`/`accentDim` are the loud +
    // low-emphasis strokes; `panelBg` the framed-panel fill; `text`/`textDim`
    // the primary + muted label colours.
    sf::Color accent, accentDim, panelBg, text, textDim;
};

// One gallery entry: name + hover-tooltip text + a draw callback.
struct ComponentCatalogEntry {
    std::string name, tooltipTitle, tooltipBody;
    std::function<void(const ComponentDemoContext&)> drawDemo;
};

// Built once; every ui/* component (existing + newly folded) registers
// exactly one entry here so it automatically appears in the Ctrl+H →
// UI Kit → Components gallery tab.
const std::vector<ComponentCatalogEntry>& componentCatalogEntries();

} // namespace dof::render
