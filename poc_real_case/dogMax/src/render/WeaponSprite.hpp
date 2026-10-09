#pragma once

#include "entities/Weapon.hpp"

#include <SFML/Graphics/Color.hpp>
#include <SFML/Graphics/Rect.hpp>

namespace dof::loaders { class ConfigLoader; }
namespace sf { class RenderTarget; }

namespace dof::render {

// Draws the configured V3 artwork for a gameplay weapon, fitted inside rect.
// Textures are loaded once on first use and missing assets fail clearly.
void drawWeaponSprite(sf::RenderTarget& window,
                      const sf::FloatRect& rect,
                      dof::entities::WeaponType type,
                      const dof::loaders::ConfigLoader& config,
                      sf::Color tint = sf::Color::White,
                      float rotationDegrees = 0.0f);

} // namespace dof::render
