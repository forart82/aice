#pragma once

#include <SFML/System/Vector2.hpp>

namespace dof::abilities {

struct Inputable {
    bool isPressedW{false};
    bool isPressedA{false};
    bool isPressedS{false};
    bool isPressedD{false};
    sf::Vector2f lastNonZeroDirection{0.0f, 1.0f};

    sf::Vector2f resolveDirection();
    void clearKeys();
};

}
