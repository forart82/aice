#pragma once

#include "entities/Weapon.hpp"

#include <SFML/Graphics/Color.hpp>

namespace dof::loaders { class ConfigLoader; }

namespace dof::render {

sf::Color weaponOutlineColor(const dof::loaders::ConfigLoader& config, dof::entities::WeaponType type);
sf::Color weaponFillColor(const dof::loaders::ConfigLoader& config, dof::entities::WeaponType type);

}
