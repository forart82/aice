#pragma once

#include "entities/Weapon.hpp"
#include "render/ColorTheme.hpp"
#include "render/UiAccent.hpp"
#include "render/ui/UiLabel.hpp"
#include "render/ui/UiList.hpp"
#include "render/ui/UiPanel.hpp"
#include "render/ShapeShaders.hpp"
#include "render/widgets/UiDiceCell.hpp"

#include <SFML/Graphics/Color.hpp>
#include <SFML/Graphics/Font.hpp>
#include <SFML/Graphics/Rect.hpp>
#include <SFML/Graphics/Texture.hpp>

namespace dof::entities { class Dice; }
namespace dof::hubs    { class InventoryHub; class PowderHub; }
namespace dof::loaders { class ConfigLoader; class ShaderLoader; }
namespace sf           { class RenderWindow; }

namespace dof::render {

class InventoryLayout;
struct UiState;

// Component-based pixel-perfect inventory panel opened with Ctrl+K.
// Uses InventoryLayout for all geometry so sort/drag/destroy route
// through InteractionController unchanged.
// Renders exclusively with dof::render::ui primitives — no custom shaders.
class InventoryRenderer {
public:
    InventoryRenderer(const dof::loaders::ConfigLoader& config,
                           const ColorTheme& theme,
                           const sf::Font& font,
                           const dof::loaders::ShaderLoader* shaders = nullptr);

    void render(sf::RenderWindow& window,
                const dof::hubs::InventoryHub& hub,
                InventoryLayout& layout,
                const dof::hubs::PowderHub* powderHub,
                const UiState& uiState);

    void  advance(float dt);
    void  triggerDestroyFlash(int tierIndex);
    float flashSecondsForTier(int tierIndex) const;

private:
    void drawScrim(sf::RenderWindow& window, const InventoryLayout& layout);
    void drawPanel(sf::RenderWindow& window, const InventoryLayout& layout);
    void drawSortButtons(sf::RenderWindow& window, const InventoryLayout& layout,
                         const dof::hubs::InventoryHub& hub, const UiState& uiState);
    void drawPowderColumn(sf::RenderWindow& window, const InventoryLayout& layout,
                          const dof::hubs::PowderHub* powderHub, const UiState& uiState);
    void drawSlots(sf::RenderWindow& window, const dof::hubs::InventoryHub& hub,
                   const InventoryLayout& layout, const UiState& uiState);
    void drawActionHint(sf::RenderWindow& window, const InventoryLayout& layout);
    void drawDragPayload(sf::RenderWindow& window, const UiState& uiState);
    void drawWeaponGlyph(sf::RenderWindow& window, const sf::FloatRect& rect,
                         dof::entities::WeaponType type);
    void drawDiceGlyph(sf::RenderWindow& window, const sf::FloatRect& rect,
                       const dof::entities::Dice& dice);


    const sf::Font&                   font;
    const dof::loaders::ConfigLoader& config;
    ColorTheme                        theme;

    UiAccent     accent;
    ui::UiPanel  panel;
    ui::UiList   powderList;

    sf::Color accentColor;
    sf::Color scrimColor;
    sf::Color destroyFlashColor;
    sf::Texture cockpitTexture;
    float     flashInitialSeconds{0.25f};
    float     flashSecondsByTier[3]{0.0f, 0.0f, 0.0f};
    float     deployProgress{0.0f};
    float     deployOpenSeconds{0.32f};
    float     deployCloseSeconds{0.22f};
    bool      shouldDeployOpen{false};

    // Canonical dice rendering — the same widgets::UiDiceCell the weapon-slot
    // sidebar uses, so an inventoried die reads identically to an equipped one
    // (shader die when the "die" shader is loaded, fallback hex otherwise).
    // Configured in the ctor body; drawn by drawDiceGlyph with the countdown
    // strip suppressed (a stored die is static).
    const dof::loaders::ShaderLoader* shadersPtr{nullptr};
    ShapeShaders                      shapeShaders;
    widgets::UiDiceCell               diceCell;
};

} // namespace dof::render
