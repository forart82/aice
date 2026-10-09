#include "abilities/Inputable.hpp"

#include "helpers/MathHelper.hpp"

namespace dof::abilities {

sf::Vector2f Inputable::resolveDirection() {
    float dx = 0.0f;
    float dy = 0.0f;
    if (isPressedD) dx += 1.0f;
    if (isPressedA) dx -= 1.0f;
    if (isPressedS) dy += 1.0f;
    if (isPressedW) dy -= 1.0f;
    sf::Vector2f raw{dx, dy};
    if (dx == 0.0f && dy == 0.0f) return sf::Vector2f{0.0f, 0.0f};
    auto unit = dof::helpers::normalizeOrZero(raw);
    lastNonZeroDirection = unit;
    return unit;
}

void Inputable::clearKeys() {
    isPressedW = false;
    isPressedA = false;
    isPressedS = false;
    isPressedD = false;
}

}
