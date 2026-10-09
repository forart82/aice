#pragma once

#include "core/EntityId.hpp"

#include <SFML/System/Vector2.hpp>

namespace dof::abilities {

struct Targetable {
    dof::core::EntityId id{0};
    sf::Vector2f        anchorPosition{0.0f, 0.0f};
    float               collisionRadius{0.0f};
};

}
