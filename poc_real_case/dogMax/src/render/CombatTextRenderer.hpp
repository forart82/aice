#pragma once

#include "render/ColorTheme.hpp"

#include <SFML/Graphics/Color.hpp>
#include <SFML/Graphics/Font.hpp>

#include <array>

namespace dof::hubs { class DamageTextHub; class DronFloatTextHub; class XpFloatHub; }
namespace dof::loaders { class ConfigLoader; }
namespace sf { class RenderTarget; }

namespace dof::render {

class WeaponSlotLayout;

class CombatTextRenderer {
public:
    CombatTextRenderer(const dof::loaders::ConfigLoader& config, const ColorTheme& theme, const sf::Font& font);

    void drawWorldDamageText(sf::RenderTarget& window, const dof::hubs::DamageTextHub& damageTextHub);
    void drawWorldXpFloats(sf::RenderTarget& window, const dof::hubs::XpFloatHub& xpFloatHub);
    void drawUiDronLabels(sf::RenderTarget& window,
                          const dof::hubs::DronFloatTextHub& dronFloatTextHub,
                          const WeaponSlotLayout& weaponSlotLayout);

private:
    const ColorTheme theme;
    const sf::Font&  font;
    float            qualityTintBlend{0.0f};
    // SA25 — per-tier float-label palette, cached at ctor so render
    // doesn't string-format keys every frame. Indexed by the
    // `DronTier` enum value.
    std::array<sf::Color, 15> dronTierPalette;
};

}
