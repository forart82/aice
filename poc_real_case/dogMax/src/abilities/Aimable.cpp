#include "abilities/Aimable.hpp"

#include "helpers/MathHelper.hpp"

namespace dof::abilities {

void Aimable::aimAt(sf::Vector2f origin, sf::Vector2f target) {
    sf::Vector2f delta{target.x - origin.x, target.y - origin.y};
    auto unit = dof::helpers::normalizeOrZero(delta);
    if (unit.x == 0.0f && unit.y == 0.0f) return;
    aimDirection = unit;
}

void Aimable::aimAlong(sf::Vector2f fallbackDirection) {
    auto unit = dof::helpers::normalizeOrZero(fallbackDirection);
    if (unit.x == 0.0f && unit.y == 0.0f) return;
    aimDirection = unit;
}

}
