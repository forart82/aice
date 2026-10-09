#pragma once
#include <SFML/System/Vector2.hpp>

namespace dof::abilities {

struct Dashable {
    bool         hasBeenHit{false};
    bool         isDashing{false};
    bool         hasDealtContactDamage{false}; // true once per dash to prevent multi-hit
    sf::Vector2f dashDirection{0.0f, 0.0f};
    float        dashSpeed{0.0f};
    float        dashTimeRemaining{0.0f};
    float        defensiveCooldown{0.0f};
    float        offensiveCooldown{0.0f};
    sf::Vector2f ghostOrigin{0.0f, 0.0f};
    float        ghostTimeRemaining{0.0f};
    float        ghostTotalDuration{0.0f};
    float        ghostAlpha{0.0f};
    float        ghostInitialAlpha{0.0f};

    void armDash(sf::Vector2f dir, float speed, float duration,
                 sf::Vector2f origin, float ghostDuration, float ghostInitAlpha);
    void advanceCooldowns(float dt);
    void advanceDash(float dt);
    void advanceGhost(float dt);
    bool isGhostActive() const;
};

}  // namespace dof::abilities
