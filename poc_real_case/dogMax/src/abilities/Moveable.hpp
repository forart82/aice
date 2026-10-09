#pragma once

#include <SFML/System/Vector2.hpp>

namespace dof::abilities {

struct Moveable {
    sf::Vector2f position{0.0f, 0.0f};
    sf::Vector2f previousPosition{0.0f, 0.0f};
    sf::Vector2f velocity{0.0f, 0.0f};
    float        moveSpeed{0.0f};
    // Movement easing (visual_identity.md Step 7). Per-second approach rates
    // toward the target velocity; `velocity` itself is the smoothing state, so
    // every existing hard stop (teleportTo, death, respawn) keeps working
    // unchanged. A rate of 0 means INSTANT, so any Moveable nobody configures —
    // every enemy — behaves exactly as before.
    float        accelerationRate{0.0f};
    float        decelerationRate{0.0f};
    float        stopEpsilon{0.0f};

    void beginSimulationStep();
    void teleportTo(sf::Vector2f target);
    void advance(float dt);
    void setVelocityFromDirection(sf::Vector2f unitDirection);
    void approachVelocityFromDirection(sf::Vector2f unitDirection, float dt);
    sf::Vector2f interpolatedPosition(float alpha) const;
};

}
