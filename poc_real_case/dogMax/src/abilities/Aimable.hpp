#pragma once

#include <SFML/System/Vector2.hpp>

namespace dof::abilities {

struct Aimable {
    sf::Vector2f aimDirection{0.0f, 1.0f};

    void aimAt(sf::Vector2f origin, sf::Vector2f target);
    void aimAlong(sf::Vector2f fallbackDirection);
};

}
