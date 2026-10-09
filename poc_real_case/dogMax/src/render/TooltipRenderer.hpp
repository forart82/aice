#pragma once

#include "entities/QualityTier.hpp"
#include "render/ColorTheme.hpp"
#include "render/ShapeShaders.hpp"
#include "render/ui/UiTooltip.hpp"

#include <SFML/Graphics/Color.hpp>
#include <SFML/Graphics/Font.hpp>

#include <string>
#include <vector>

namespace dof::core { class World; }
namespace dof::hubs { class InventoryHub; class WeaponSlotHub; }
namespace dof::loaders { class ConfigLoader; class ShaderLoader; }
namespace sf { class RenderWindow; }

namespace dof::render {

struct UiState;

class TooltipRenderer {
public:
    TooltipRenderer(const dof::loaders::ConfigLoader& config, const ColorTheme& theme, const sf::Font& font,
                    const dof::loaders::ShaderLoader* shaders = nullptr);

    void render(sf::RenderWindow& window,
                const UiState& uiState,
                const dof::hubs::InventoryHub& inventoryHub,
                const dof::hubs::WeaponSlotHub& weaponSlotHub,
                const dof::core::World& world);

private:
    void renderTooltipLines(sf::RenderWindow& window, const std::string& title,
                            const std::vector<std::string>& lines, sf::Vector2f anchorUi,
                            sf::Color titleColor);
    sf::Color tierColor(dof::entities::QualityTier tier) const;

    const ColorTheme  theme;
    const sf::Font&   font;
    ui::UiTooltip     tooltip_;

    // Dark-cyberpunk neon: the tooltip frame glows through panel.frag when
    // UI_GLOW_ENABLE is set and the "panel" shader compiled. `glowColor` is the
    // canonical UI accent (never the per-item tier colour — tier stays on the
    // title text only). Null loader / disabled flag falls back to the flat frame.
    const dof::loaders::ShaderLoader* shadersPtr{nullptr};
    ShapeShaders                      shapeShaders;
    bool                              isGlowEnabled{false};
    sf::Color                         glowColor;
    float                             glowSpread{10.0f};
    int                               glowLayers{5};
    float                             glowAlpha{70.0f};
};

}
